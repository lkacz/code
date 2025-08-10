// Nowy styl / pełny ekran inspirowany Diamonds Explorer
console.log('[MiniMiner] start styled');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', {alpha:false});
let W=0,H=0,DPR=1; function resize(){ DPR=Math.max(1,Math.min(2,window.devicePixelRatio||1)); canvas.width=Math.floor(window.innerWidth*DPR); canvas.height=Math.floor(window.innerHeight*DPR); canvas.style.width=window.innerWidth+'px'; canvas.style.height=window.innerHeight+'px'; ctx.setTransform(DPR,0,0,DPR,0,0); W=window.innerWidth; H=window.innerHeight; } window.addEventListener('resize',resize,{passive:true}); resize();

// --- Świat (łagodniejsze biomy: równiny / wzgórza / góry) ---
const CHUNK_W=64; const WORLD_H=140; const TILE=20; const SURFACE_GRASS_DEPTH=1; const SAND_DEPTH=8;
const T={AIR:0,GRASS:1,SAND:2,STONE:3,DIAMOND:4,WOOD:5,LEAF:6,SNOW:7};
const INFO={0:{hp:0,color:null,drop:null},1:{hp:2,color:'#2e8b2e',drop:'grass'},2:{hp:2,color:'#c2b280',drop:'sand'},3:{hp:6,color:'#777',drop:'stone'},4:{hp:10,color:'#3ef',drop:'diamond'},5:{hp:4,color:'#8b5a2b',drop:'wood'},6:{hp:1,color:'#2faa2f',drop:'leaf'},7:{hp:2,color:'#eee',drop:'snow'}};
const SNOW_LINE=14; // wysokość (im mniejsze y tym wyżej) dla śniegu na wierzchu
let worldSeed = 12345; // aktualne ziarno
function setSeedFromInput(){ const inp=document.getElementById('seedInput'); if(!inp) return; let v=inp.value.trim(); if(!v||v==='auto'){ worldSeed = Math.floor(Math.random()*1e9); inp.value=String(worldSeed); } else { // hash tekstu
	let h=0; for(let i=0;i<v.length;i++){ h=(h*131 + v.charCodeAt(i))>>>0; } worldSeed = h||1; }
}
setSeedFromInput();
function randSeed(n){ // deterministyczny hash z ziarnem świata
	const x=Math.sin(n*127.1 + worldSeed*0.000123)*43758.5453; return x-Math.floor(x);
}
function valueNoise(x, wavelength, off){ const p=x/wavelength; const i=Math.floor(p); const f=p-i; const a=randSeed(i+off); const b=randSeed(i+1+off); // smoothstep
	const u=f*f*(3-2*f); return a + (b-a)*u; }
function biomeType(x){ // 0 równiny 1 wzgórza 2 góry
	const v=valueNoise(x,220,900); if(v<0.35) return 0; if(v<0.7) return 1; return 2; }
function surfaceHeight(x){
	const biome=biomeType(x);
	const base = 24
		+ valueNoise(x,80,200)*4
		+ valueNoise(x,30,300)*3
		+ valueNoise(x,12,400)*2;
	let h=base;
	if(biome===0){ // równiny – wyrównuj
		h = 26 + valueNoise(x,100,500)*2 + valueNoise(x,40,600);
	} else if(biome===1){ // wzgórza
		h = base - 2 - valueNoise(x,60,700)*2;
	} else { // góry
		h = base - 6 - valueNoise(x,120,800)*4 - valueNoise(x,50,900)*3; // niższe y => wyżej
	}
	if(h<6) h=6; if(h>40) h=40; return Math.floor(h);
}
function diamondChance(y){ const d=y-(SURFACE_GRASS_DEPTH+SAND_DEPTH); if(d<0) return 0; return Math.min(0.002 + d*0.0009, 0.05);} 
const world=new Map(); function ck(x){return 'c'+x;} function tileIndex(x,y){return y*CHUNK_W+x;}
function ensureChunk(cx){ const k=ck(cx); if(world.has(k)) return world.get(k); const arr=new Uint8Array(CHUNK_W*WORLD_H);
	// wypełnienie gruntu
	for(let lx=0; lx<CHUNK_W; lx++){
		const wx=cx*CHUNK_W+lx; const s=surfaceHeight(wx);
		for(let y=0;y<WORLD_H;y++){
			let t=T.AIR; if(y>=s){ const depth=y-s; const snowy=s<SNOW_LINE; if(depth<SURFACE_GRASS_DEPTH) t=snowy?T.SNOW:T.GRASS; else if(!snowy && depth<SURFACE_GRASS_DEPTH+SAND_DEPTH && s>20) t=T.SAND; else t=(randSeed(wx*13.37 + y*0.7) < diamondChance(y)?T.DIAMOND:T.STONE); }
			arr[tileIndex(lx,y)]=t;
		}
	}
	// drzewa po wypełnieniu (aby nie nadpisywać później)
	for(let lx=0; lx<CHUNK_W; lx++){
		const wx=cx*CHUNK_W+lx; const s=surfaceHeight(wx); if(s<2) continue; const biome=biomeType(wx);
		const chance = (biome===0?0.12:biome===1?0.08:0.05); if(randSeed(wx*1.777) > chance) continue;
		// nie stawiaj jeśli tuż obok duże zróżnicowanie wysokości (krawędź klifu)
		const sL=surfaceHeight(wx-1), sR=surfaceHeight(wx+1); if(Math.abs(s-sL)>6 || Math.abs(s-sR)>6) continue;
		const variant = (biome===2?'conifer': biome===1? (randSeed(wx+300)>0.5?'oak':'tallOak') : (randSeed(wx+500)<0.15?'megaOak':'oak'));
		buildTree(arr,lx,s,variant,wx);
	}
	world.set(k,arr); return arr; }

function buildTree(arr,lx,s,variant,wx){
	// s = y top ground block; trunk goes upward (towards smaller y)
	function put(localX,y,t){ if(y>=0 && y<WORLD_H && localX>=0 && localX<CHUNK_W){ if(arr[tileIndex(localX,y)]===T.AIR) arr[tileIndex(localX,y)]=t; }}
	const snowy = s < SNOW_LINE;
	if(variant==='conifer'){
		const trunkH=5+Math.floor(randSeed(wx+10)*4); // 5..8
		for(let i=0;i<trunkH;i++){ const ty=s-1-i; if(ty<0) break; put(lx,ty,T.WOOD); }
		const crownH=trunkH+1; for(let dy=0; dy<crownH; dy++){ const radius=Math.max(0, Math.floor((crownH-dy)/3)); const cy=s-1-trunkH+1 - dy; if(cy<0) break; for(let dx=-radius; dx<=radius; dx++){ if(randSeed(wx*3.1 + dy*7 + dx*11) < 0.85){ put(lx+dx,cy, (snowy && dy<2)?T.SNOW:T.LEAF); } } }
		if(snowy) put(lx, s-1-trunkH, T.SNOW);
	} else if(variant==='megaOak'){
		const trunkH=6+Math.floor(randSeed(wx+20)*5); for(let i=0;i<trunkH;i++){ const ty=s-1-i; if(ty<0) break; put(lx,ty,T.WOOD); }
		const spread=3+Math.floor(randSeed(wx+40)*2); const top=s-1-trunkH; for(let dy=-spread; dy<=spread; dy++){ for(let dx=-spread; dx<=spread; dx++){ const dist=Math.abs(dx)+Math.abs(dy)*0.7; if(dist<=spread+ (randSeed(wx+dx*13+dy*17)-0.5)){ put(lx+dx, top+dy, T.LEAF); } } }
	} else if(variant==='tallOak'){
		const trunkH=7+Math.floor(randSeed(wx+60)*4); for(let i=0;i<trunkH;i++){ const ty=s-1-i; if(ty<0) break; put(lx,ty,T.WOOD); }
		const top=s-1-trunkH; const spread=2; for(let dy=-2; dy<=2; dy++){ for(let dx=-spread; dx<=spread; dx++){ if(Math.abs(dx)+Math.abs(dy)*0.9<=spread+0.3){ put(lx+dx, top+dy, T.LEAF); } } }
	} else { // oak
		const trunkH=4+Math.floor(randSeed(wx+80)*3); for(let i=0;i<trunkH;i++){ const ty=s-1-i; if(ty<0) break; put(lx,ty,T.WOOD); }
		const top=s-1-trunkH; const spread=2; for(let dy=-2; dy<=2; dy++){ for(let dx=-spread; dx<=spread; dx++){ if(Math.abs(dx)+Math.abs(dy)*0.8<=spread+ (randSeed(wx+dx*31+dy*19)-0.4)){ put(lx+dx, top+dy, T.LEAF); } } }
	}
}
function getTile(x,y){ if(y<0||y>=WORLD_H) return T.AIR; const cx=Math.floor(x/CHUNK_W); const lx=((x%CHUNK_W)+CHUNK_W)%CHUNK_W; const ch=ensureChunk(cx); return ch[tileIndex(lx,y)]; }
function setTile(x,y,v){ if(y<0||y>=WORLD_H) return; const cx=Math.floor(x/CHUNK_W); const lx=((x%CHUNK_W)+CHUNK_W)%CHUNK_W; const ch=ensureChunk(cx); ch[tileIndex(lx,y)]=v; }

// --- Gracz / inwentarz ---
const player={x:0,y:0,w:0.7,h:0.95,vx:0,vy:0,onGround:false,facing:1,tool:'basic'}; const tools={basic:1,stone:2,diamond:4}; const inv={grass:0,sand:0,stone:0,diamond:0,wood:0,leaf:0,snow:0,tools:{stone:false,diamond:false}}; function canCraftStone(){return inv.stone>=10;} function craftStone(){ if(canCraftStone()){ inv.stone-=10; inv.tools.stone=true; msg('Kilof kamienny (2)'); updateInventory(); }} function canCraftDiamond(){return inv.diamond>=5;} function craftDiamond(){ if(canCraftDiamond()){ inv.diamond-=5; inv.tools.diamond=true; msg('Kilof diamentowy (3)'); updateInventory(); }}

// Input + tryby specjalne
const keys={}; let godMode=false; const keysOnce=new Set();
function updateGodBtn(){ const b=document.getElementById('godBtn'); if(!b) return; b.classList.toggle('toggled',godMode); b.textContent='Bóg: '+(godMode?'ON':'OFF'); }
function toggleGod(){ godMode=!godMode; updateGodBtn(); msg('Tryb boga '+(godMode?'ON':'OFF')); }
function toggleMap(){ revealAll=!revealAll; const b=document.getElementById('mapBtn'); if(b){ b.classList.toggle('toggled',revealAll); b.textContent='Mapa: '+(revealAll?'ON':'OFF'); } msg('Mapa '+(revealAll?'ON':'OFF')); }
function centerCam(){ camSX=player.x - (W/(TILE*zoom))/2; camSY=player.y - (H/(TILE*zoom))/2; camX=camSX; camY=camSY; msg('Wyśrodkowano'); }
function toggleHelp(){ const h=document.getElementById('help'); const show=h.style.display!=='block'; h.style.display=show?'block':'none'; document.getElementById('helpBtn').setAttribute('aria-expanded', String(show)); }
window.addEventListener('keydown',e=>{ const k=e.key.toLowerCase(); keys[k]=true; if(['1','2','3'].includes(e.key)){ if(e.key==='1') player.tool='basic'; if(e.key==='2'&&inv.tools.stone) player.tool='stone'; if(e.key==='3'&&inv.tools.diamond) player.tool='diamond'; updateInventory(); }
	if(k==='g'&&!keysOnce.has('g')){ toggleGod(); keysOnce.add('g'); }
	if(k==='m'&&!keysOnce.has('m')){ toggleMap(); keysOnce.add('m'); }
	if(k==='c'&&!keysOnce.has('c')){ centerCam(); keysOnce.add('c'); }
	if(k==='h'&&!keysOnce.has('h')){ toggleHelp(); keysOnce.add('h'); }
	if(['arrowup','w',' '].includes(k)) e.preventDefault(); });
window.addEventListener('keyup',e=>{ const k=e.key.toLowerCase(); keys[k]=false; keysOnce.delete(k); });

// Kierunek kopania
let mineDir={dx:1,dy:0}; document.querySelectorAll('.dirbtn').forEach(b=>{ b.addEventListener('click',()=>{ mineDir.dx=+b.getAttribute('data-dx'); mineDir.dy=+b.getAttribute('data-dy'); document.querySelectorAll('.dirbtn').forEach(o=>o.classList.remove('sel')); b.classList.add('sel'); }); }); document.querySelector('.dirbtn[data-dx="1"][data-dy="0"]').classList.add('sel');

// Pad dotykowy
function bindPad(){ document.querySelectorAll('#pad .btn').forEach(btn=>{ const code=btn.getAttribute('data-key'); if(!code) return; btn.addEventListener('pointerdown',ev=>{ ev.preventDefault(); keys[code.toLowerCase()]=true; btn.classList.add('on'); if(code==='ArrowUp') keys['w']=true; }); ['pointerup','pointerleave','pointercancel'].forEach(evName=> btn.addEventListener(evName,()=>{ keys[code.toLowerCase()]=false; btn.classList.remove('on'); if(code==='ArrowUp') keys['w']=false; })); }); } bindPad();

// Kamera
let camX=0,camY=0,camSX=0,camSY=0; let zoom=1; function ensureChunks(){ const pcx=Math.floor(player.x/CHUNK_W); for(let d=-2; d<=2; d++) ensureChunk(pcx+d); }

// Fizyka
const MOVE={ACC:32,FRICTION:28,MAX:6,JUMP:-9,GRAV:20}; let jumpPrev=false; function physics(dt){ let input=0; if(keys['a']||keys['arrowleft']) input-=1; if(keys['d']||keys['arrowright']) input+=1; if(input!==0) player.facing=input; const target=input*MOVE.MAX; const diff=target-player.vx; const accel=MOVE.ACC*dt*Math.sign(diff); if(target!==0){ if(Math.abs(accel)>Math.abs(diff)) player.vx=target; else player.vx+=accel; } else { const fr=MOVE.FRICTION*dt; if(Math.abs(player.vx)<=fr) player.vx=0; else player.vx-=fr*Math.sign(player.vx); } const jumpNow=(keys['w']||keys['arrowup']||keys[' ']); if(jumpNow && !jumpPrev && (player.onGround || godMode)){ player.vy=MOVE.JUMP; player.onGround=false; } jumpPrev=jumpNow; player.vy+=MOVE.GRAV*dt; if(player.vy>20) player.vy=20; player.x += player.vx*dt; collide('x'); player.y += player.vy*dt; collide('y'); const tX=player.x - (W/(TILE*zoom))/2 + player.w/2; const tY=player.y - (H/(TILE*zoom))/2 + player.h/2; camSX += (tX-camSX)*Math.min(1,dt*8); camSY += (tY-camSY)*Math.min(1,dt*8); camX=camSX; camY=camSY; ensureChunks(); revealAround(); }
function collide(axis){ const w=player.w/2,h=player.h/2; if(axis==='x'){ const minX=Math.floor(player.x-w), maxX=Math.floor(player.x+w), minY=Math.floor(player.y-h), maxY=Math.floor(player.y+h); for(let y=minY;y<=maxY;y++){ for(let x=minX;x<=maxX;x++){ const t=getTile(x,y); if(t!==T.AIR){ if(player.vx>0) player.x = x - w - 0.001; if(player.vx<0) player.x = x + 1 + w + 0.001; } } } } else { const minX=Math.floor(player.x-w), maxX=Math.floor(player.x+w), minY=Math.floor(player.y-h), maxY=Math.floor(player.y+h); player.onGround=false; for(let y=minY;y<=maxY;y++){ for(let x=minX;x<=maxX;x++){ const t=getTile(x,y); if(t!==T.AIR){ if(player.vy>0){ player.y = y - h - 0.001; player.vy=0; player.onGround=true; } if(player.vy<0){ player.y = y + 1 + h + 0.001; player.vy=0; } } } } } }

// Mgła / widoczność
let revealAll=false; const seen=new Set(); function key(x,y){ return x+','+y; } function revealAround(){ const r=10; for(let dx=-r; dx<=r; dx++){ for(let dy=-r; dy<=r; dy++){ if(dx*dx+dy*dy<=r*r) seen.add(key(Math.floor(player.x+dx),Math.floor(player.y+dy))); } } }

// Kopanie (kierunkowe)
// Kopanie + upadek drzew
let mining=false,mineTimer=0,mineTx=0,mineTy=0; const mineBtn=document.getElementById('mineBtn');
mineBtn.addEventListener('pointerdown',e=>{ e.preventDefault(); startMine(); });
window.addEventListener('pointerup',()=>{ mining=false; mineBtn.classList.remove('on'); });
function startMine(){ const tx=Math.floor(player.x + mineDir.dx + (mineDir.dx>0?player.w/2:mineDir.dx<0?-player.w/2:0)); const ty=Math.floor(player.y + mineDir.dy); const t=getTile(tx,ty); if(t===T.AIR) return; mining=true; mineTimer=0; mineTx=tx; mineTy=ty; mineBtn.classList.add('on'); if(godMode) instantBreak(); }
function instantBreak(){ if(getTile(mineTx,mineTy)===T.AIR){ mining=false; mineBtn.classList.remove('on'); return; } const tId=getTile(mineTx,mineTy); if(tId===T.WOOD && isTreeBase(mineTx,mineTy)){ if(startTreeFall(mineTx,mineTy)){ mining=false; mineBtn.classList.remove('on'); return; } } const info=INFO[tId]; const drop=info.drop; setTile(mineTx,mineTy,T.AIR); if(drop) inv[drop]=(inv[drop]||0)+1; mining=false; mineBtn.classList.remove('on'); updateInventory(); }
// Falling tree system
const fallingTrees=[]; // {baseX,baseY,tiles:[{rx,ry,t}],start,duration,dir,awarded}
function isTreeBase(x,y){ // base when wood and above is wood, below not wood (ground) and side leaves/wood optional
	if(getTile(x,y)!==T.WOOD) return false; if(getTile(x,y-1)!==T.WOOD) return false; const below=getTile(x,y+1); return (below!==T.WOOD); }
function collectTreeTiles(x,y){ const stack=[[x,y]]; const vis=new Set(); const out=[]; let guard=0; while(stack.length){ const [cx,cy]=stack.pop(); const k=cx+','+cy; if(vis.has(k)) continue; const tt=getTile(cx,cy); if(!(tt===T.WOOD||tt===T.LEAF||tt===T.SNOW)) continue; vis.add(k); out.push({x:cx,y:cy,t:tt}); setTile(cx,cy,T.AIR); if(++guard>600) break; stack.push([cx+1,cy]); stack.push([cx-1,cy]); stack.push([cx,cy+1]); stack.push([cx,cy-1]); stack.push([cx,cy-2]); }
	return out.map(o=>({rx:o.x-x, ry:o.y-y, t:o.t})); }
function startTreeFall(bx,by){ const tiles=collectTreeTiles(bx,by); if(!tiles.length) return false; fallingTrees.push({baseX:bx,baseY:by,tiles,start:performance.now(),duration:1000,dir:player.facing||1,awarded:false}); return true; }
function awardTree(tr){ if(tr.awarded) return; tr.awarded=true; let wood=0,leaf=0,snow=0; tr.tiles.forEach(t=>{ if(t.t===T.WOOD) wood++; else if(t.t===T.LEAF) leaf++; else if(t.t===T.SNOW) snow++; }); inv.wood+=wood; inv.leaf+=leaf; inv.snow+=snow; updateInventory(); }
function updateFallingTrees(now){ for(let i=fallingTrees.length-1;i>=0;i--){ const tr=fallingTrees[i]; const p=(now-tr.start)/tr.duration; if(p>=1){ awardTree(tr); fallingTrees.splice(i,1); } } }
function drawFallingTrees(now){ fallingTrees.forEach(tr=>{ const p=Math.min(1,(now-tr.start)/tr.duration); const angle=p*Math.PI/2*tr.dir; ctx.save(); ctx.translate((tr.baseX+0.5)*TILE,(tr.baseY+0.5)*TILE); ctx.rotate(angle); tr.tiles.forEach(tk=>{ const col=INFO[tk.t].color; if(!col) return; ctx.fillStyle=col; const x=(tk.rx-0.5)*TILE; const y=(tk.ry-0.5)*TILE; ctx.fillRect(x,y,TILE,TILE); }); ctx.restore(); }); }
function updateMining(dt){ if(!mining) return; if(getTile(mineTx,mineTy)===T.AIR){ mining=false; mineBtn.classList.remove('on'); return; } if(godMode){ instantBreak(); return; } mineTimer += dt * tools[player.tool]; const curId=getTile(mineTx,mineTy); const info=INFO[curId]; const need=Math.max(0.1, info.hp/6); if(mineTimer>=need){ if(curId===T.WOOD && isTreeBase(mineTx,mineTy)){ if(startTreeFall(mineTx,mineTy)){ mining=false; mineBtn.classList.remove('on'); return; } } const drop=info.drop; setTile(mineTx,mineTy,T.AIR); if(drop) inv[drop]=(inv[drop]||0)+1; mining=false; mineBtn.classList.remove('on'); updateInventory(); } }

// Render
function draw(){ const now=performance.now(); ctx.fillStyle='#0b0f16'; ctx.fillRect(0,0,W,H); const viewX=Math.ceil(W/(TILE*zoom)); const viewY=Math.ceil(H/(TILE*zoom)); const sx=Math.floor(camX)-1; const sy=Math.floor(camY)-1; ctx.save(); ctx.scale(zoom,zoom); ctx.translate(-camX*TILE,-camY*TILE); for(let y=sy; y<sy+viewY+2; y++){ for(let x=sx; x<sx+viewX+2; x++){ const t=getTile(x,y); if(t===T.AIR) continue; if(!revealAll && !seen.has(key(x,y))){ ctx.fillStyle='rgba(0,0,0,.6)'; ctx.fillRect(x*TILE,y*TILE,TILE,TILE); continue; } ctx.fillStyle=INFO[t].color; ctx.fillRect(x*TILE,y*TILE,TILE,TILE); } } drawFallingTrees(now); const px=(player.x-player.w/2)*TILE; const py=(player.y-player.h/2)*TILE; ctx.fillStyle='#ffd37f'; ctx.fillRect(px,py,player.w*TILE,player.h*TILE); if(mining){ ctx.strokeStyle='#fff'; ctx.strokeRect(mineTx*TILE+1,mineTy*TILE+1,TILE-2,TILE-2); const info=INFO[getTile(mineTx,mineTy)]||{hp:1}; const need=Math.max(0.1,info.hp/6); const p=mineTimer/need; ctx.fillStyle='rgba(255,255,255,.3)'; ctx.fillRect(mineTx*TILE, mineTy*TILE + (1-p)*TILE, TILE, p*TILE); } ctx.restore(); updateFallingTrees(now); }

// UI aktualizacja
const el={grass:document.getElementById('grass'),sand:document.getElementById('sand'),stone:document.getElementById('stone'),diamond:document.getElementById('diamond'),wood:document.getElementById('wood'),snow:document.getElementById('snow'),pick:document.getElementById('pick'),fps:document.getElementById('fps'),msg:document.getElementById('messages')}; function updateInventory(){ el.grass.textContent=inv.grass; el.sand.textContent=inv.sand; el.stone.textContent=inv.stone; el.diamond.textContent=inv.diamond; el.wood.textContent=inv.wood; if(el.snow) el.snow.textContent=inv.snow; el.pick.textContent=player.tool; document.getElementById('craftStone').disabled=!canCraftStone(); document.getElementById('craftDiamond').disabled=!canCraftDiamond(); }
document.getElementById('craftStone').addEventListener('click', craftStone); document.getElementById('craftDiamond').addEventListener('click', craftDiamond);
// Menu / przyciski
document.getElementById('mapBtn')?.addEventListener('click',toggleMap);
const godBtn=document.getElementById('godBtn'); if(godBtn) godBtn.addEventListener('click',toggleGod);
updateGodBtn();
const menuBtn=document.getElementById('menuBtn'); const menuPanel=document.getElementById('menuPanel');
function closeMenu(){ menuPanel.hidden=true; menuBtn.setAttribute('aria-expanded','false'); }
menuBtn?.addEventListener('click',()=>{ const vis=menuPanel.hidden; menuPanel.hidden=!vis; menuBtn.setAttribute('aria-expanded', String(vis)); });
document.addEventListener('click',e=>{ if(!menuPanel || menuPanel.hidden) return; if(menuPanel.contains(e.target)||menuBtn.contains(e.target)) return; closeMenu(); });
document.getElementById('radarMenuBtn')?.addEventListener('click',()=>{ radarFlash=performance.now()+1500; closeMenu(); });
// Regeneracja świata z nowym ziarnem
document.getElementById('regenBtn')?.addEventListener('click',()=>{ setSeedFromInput(); regenWorld(); closeMenu(); });
function regenWorld(){ world.clear(); seen.clear(); mining=false; inv.grass=inv.sand=inv.stone=inv.diamond=inv.wood=inv.leaf=inv.snow=0; inv.tools.stone=inv.tools.diamond=false; player.tool='basic'; updateInventory(); placePlayer(true); msg('Nowy świat seed '+worldSeed); }
document.getElementById('centerBtn').addEventListener('click',()=>{ camSX=player.x - (W/(TILE*zoom))/2; camSY=player.y - (H/(TILE*zoom))/2; camX=camSX; camY=camSY; });
document.getElementById('helpBtn').addEventListener('click',()=>{ const h=document.getElementById('help'); const show=h.style.display!=='block'; h.style.display=show?'block':'none'; document.getElementById('helpBtn').setAttribute('aria-expanded', String(show)); });
const radarBtn=document.getElementById('radarBtn'); radarBtn.addEventListener('click',()=>{ radarFlash=performance.now()+1500; }); let radarFlash=0;
function msg(t){ el.msg.textContent=t; clearTimeout(msg._t); msg._t=setTimeout(()=>{ el.msg.textContent=''; },4000); }

// FPS
let frames=0,lastFps=performance.now(); function updateFps(now){ frames++; if(now-lastFps>1000){ el.fps.textContent=frames+' FPS'; frames=0; lastFps=now; }}

// Spawn
function placePlayer(skipMsg){ const x=0; ensureChunk(0); let y=0; while(y<WORLD_H-1 && getTile(x,y)===T.AIR) y++; player.x=x+0.5; player.y=y-1; revealAround(); camSX=player.x - (W/(TILE*zoom))/2; camSY=player.y - (H/(TILE*zoom))/2; camX=camSX; camY=camSY; if(!skipMsg) msg('Seed '+worldSeed); }
placePlayer(); updateInventory(); updateGodBtn(); msg('Sterowanie: A/D/W + ⛏️ / klik. G=Bóg (nieskończone skoki), M=Mapa, C=Centrum, H=Pomoc');

// Pętla
let last=performance.now(); function loop(ts){ const dt=Math.min(0.05,(ts-last)/1000); last=ts; physics(dt); updateMining(dt); draw(); if(ts<radarFlash){ radarBtn.classList.add('pulse'); } else radarBtn.classList.remove('pulse'); updateFps(ts); requestAnimationFrame(loop); } requestAnimationFrame(loop);
