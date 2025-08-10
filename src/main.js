// Nowy styl / pełny ekran inspirowany Diamonds Explorer
console.log('[MiniMiner] start styled');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', {alpha:false});
let W=0,H=0,DPR=1; function resize(){ DPR=Math.max(1,Math.min(2,window.devicePixelRatio||1)); canvas.width=Math.floor(window.innerWidth*DPR); canvas.height=Math.floor(window.innerHeight*DPR); canvas.style.width=window.innerWidth+'px'; canvas.style.height=window.innerHeight+'px'; ctx.setTransform(DPR,0,0,DPR,0,0); W=window.innerWidth; H=window.innerHeight; } window.addEventListener('resize',resize,{passive:true}); resize();

// --- Świat (łagodniejsze biomy: równiny / wzgórza / góry) ---
const {CHUNK_W,WORLD_H,TILE,SURFACE_GRASS_DEPTH,SAND_DEPTH,T,INFO,SNOW_LINE,isSolid} = MM;
const {worldGen:WG} = MM; const {surfaceHeight, biomeType, randSeed, diamondChance} = WG;
let worldSeed = WG.worldSeed;
function setSeedFromInput(){ WG.setSeedFromInput(); worldSeed=WG.worldSeed; }
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
// Blink + cape
let blinkStart=0, blinking=false, nextBlink=performance.now()+2000+Math.random()*3000; const BLINK_DUR=160; function updateBlink(now){ if(!blinking && now>nextBlink){ blinking=true; blinkStart=now; } if(blinking && now>blinkStart+BLINK_DUR){ blinking=false; nextBlink=now+2000+Math.random()*4000; } }
// Cape physics: chain with gravity that droops when idle and streams when moving
const CAPE_SEGMENTS=MM.CAPE.SEGMENTS; 
const CAPE_ANCHOR_FRAC=MM.CAPE.ANCHOR_FRAC; // 0 = top of body, 1 = bottom. Middle requested.
const cape=[]; function initScarf(){ // keep name used elsewhere
	cape.length=0; for(let i=0;i<CAPE_SEGMENTS;i++) cape.push({x:player.x,y:player.y,vx:0,vy:0}); }
function updateCape(dt){
	if(!cape.length) return;
	const anchorX=player.x;
		const anchorY=player.y - player.h/2 + player.h * CAPE_ANCHOR_FRAC; // middle of character
	const speed=Math.min(1, Math.abs(player.vx)/MOVE.MAX);
	const time=performance.now();
	const targetFlare = 0.2 + 0.55*speed; // horizontal spread cap (meters)
	const segLen=0.16; // desired base link length
	cape[0].x=anchorX; cape[0].y=anchorY;
	// Predict target positions via simple semi-rigid chain, then relax with springs
	for(let i=1;i<CAPE_SEGMENTS;i++){
		const prev=cape[i-1]; const seg=cape[i];
		// base desired direction: backward relative to facing and slightly downward
		const backDirX = -player.facing; // -1 or 1
		const flareFactor = (i/(CAPE_SEGMENTS-1))*targetFlare;
		const wind = Math.sin(time/400 + i*0.7)*0.02 + Math.sin(time/1300 + i)*0.01; // subtle
		const idleSway = (1-speed)*Math.sin(time/700 + i)*0.015;
		const desiredX = prev.x + backDirX*flareFactor + wind;
		const desiredY = prev.y + 0.05 + (i/(CAPE_SEGMENTS-1))*0.15 + idleSway; // droop increases with depth
		// integrate toward desired with damping
		seg.x += (desiredX - seg.x)*Math.min(1, dt*6);
		seg.y += (desiredY - seg.y)*Math.min(1, dt*6);
	}
	// Length constraint (2 iterations)
	for(let it=0; it<2; it++){
		for(let i=1;i<CAPE_SEGMENTS;i++){
			const prev=cape[i-1]; const seg=cape[i];
			let dx=seg.x-prev.x, dy=seg.y-prev.y; let d=Math.hypot(dx,dy); if(d===0){ d=0.0001; dx=0.0001; }
			const excess = d - segLen; if(Math.abs(excess)>0.0005){ const k=excess/d; seg.x -= dx*k; seg.y -= dy*k; }
		}
	}
	// Collision with solid tiles: push segments above ground so cape doesn't appear over solid surfaces
	for(let i=1;i<CAPE_SEGMENTS;i++){
		const seg=cape[i]; const tx=Math.floor(seg.x); const ty=Math.floor(seg.y);
		if(isSolid(getTile(tx,ty))){
			// push upward just above tile top
			seg.y = ty - 0.02; // slight gap
			// optional horizontal nudge away from entering block face
			const blockCenter=tx+0.5; if(seg.x>blockCenter) seg.x=Math.min(seg.x, tx+1.02); else seg.x=Math.max(seg.x, tx-0.02);
		}
	}
	// Re-tighten after collision adjustments (1 pass)
	for(let i=1;i<CAPE_SEGMENTS;i++){
		const prev=cape[i-1]; const seg=cape[i]; let dx=seg.x-prev.x, dy=seg.y-prev.y; let d=Math.hypot(dx,dy); if(d===0) d=0.0001; const excess=d-segLen; if(excess>0){ const k=excess/d; seg.x -= dx*k; seg.y -= dy*k; }
	}
	// Prevent forward flip: ensure chain x does not pass anchor direction
	for(let i=1;i<CAPE_SEGMENTS;i++){ const prev=cape[i-1]; const seg=cape[i]; if(player.facing>0 && seg.x>prev.x) seg.x=prev.x; if(player.facing<0 && seg.x<prev.x) seg.x=prev.x; }
	// Gentle settling when almost idle: extra downward pull
	if(speed<0.1){ for(let i=1;i<CAPE_SEGMENTS;i++){ cape[i].y += dt*0.4*(i/(CAPE_SEGMENTS-1)); } }
}
function drawCape(){ if(!cape.length) return; const wTop=0.10, wBot=0.24; const leftPts=[], rightPts=[]; for(let i=0;i<CAPE_SEGMENTS;i++){ const cur=cape[i]; const next=cape[Math.min(CAPE_SEGMENTS-1,i+1)]; let dx=next.x-cur.x, dy=next.y-cur.y; const d=Math.hypot(dx,dy)||1; dx/=d; dy/=d; const t=i/(CAPE_SEGMENTS-1); const w=wTop + (wBot-wTop)*t; const px=-dy*w; const py=dx*w; leftPts.push({x:cur.x+px,y:cur.y+py}); rightPts.push({x:cur.x-px,y:cur.y-py}); }
	// Build path
	ctx.fillStyle='#b91818'; ctx.beginPath(); ctx.moveTo(leftPts[0].x*TILE,leftPts[0].y*TILE); for(let i=1;i<leftPts.length;i++) ctx.lineTo(leftPts[i].x*TILE,leftPts[i].y*TILE); for(let i=rightPts.length-1;i>=0;i--) ctx.lineTo(rightPts[i].x*TILE,rightPts[i].y*TILE); ctx.closePath();
	ctx.fill(); ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.lineWidth=1; ctx.beginPath(); for(let i=0;i<leftPts.length;i++) ctx.lineTo(leftPts[i].x*TILE,leftPts[i].y*TILE); ctx.stroke(); }
function drawPlayer(){ drawCape(); const bodyX=(player.x-player.w/2)*TILE; const bodyY=(player.y-player.h/2)*TILE; const bw=player.w*TILE, bh=player.h*TILE; ctx.fillStyle='#f4c05a'; ctx.fillRect(bodyX,bodyY,bw,bh); ctx.strokeStyle='#4b3212'; ctx.lineWidth=2; ctx.strokeRect(bodyX,bodyY,bw,bh); const eyeW=6, eyeHOpen=6; let eyeH=eyeHOpen; if(blinking){ const p=(performance.now()-blinkStart)/BLINK_DUR; const tri=p<0.5? (p*2) : (1-(p-0.5)*2); eyeH = Math.max(1, eyeHOpen * (1-tri)); } const eyeY=bodyY + bh*0.35; const eyeOffsetX=bw*0.18; const pupilW=2; const pupilShift=player.facing*1.5; function eye(cx){ ctx.fillStyle='#fff'; ctx.fillRect(cx-eyeW/2, eyeY-eyeH/2, eyeW, eyeH); if(eyeH>2){ ctx.fillStyle='#111'; ctx.fillRect(cx - pupilW/2 + pupilShift, eyeY - Math.min(eyeH/2-1,2), pupilW, Math.min(eyeH-2,4)); } } eye(bodyX+bw/2-eyeOffsetX); eye(bodyX+bw/2+eyeOffsetX); ctx.fillStyle='rgba(0,0,0,0.25)'; const shw=bw*0.6; ctx.beginPath(); ctx.ellipse(player.x*TILE, (player.y+player.h/2)*TILE+2, shw/2, 4,0,0,Math.PI*2); ctx.fill(); }

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
function collide(axis){ const w=player.w/2,h=player.h/2; if(axis==='x'){ const minX=Math.floor(player.x-w), maxX=Math.floor(player.x+w), minY=Math.floor(player.y-h), maxY=Math.floor(player.y+h); for(let y=minY;y<=maxY;y++){ for(let x=minX;x<=maxX;x++){ const t=getTile(x,y); if(isSolid(t)){ if(player.vx>0) player.x = x - w - 0.001; if(player.vx<0) player.x = x + 1 + w + 0.001; } } } } else { const minX=Math.floor(player.x-w), maxX=Math.floor(player.x+w), minY=Math.floor(player.y-h), maxY=Math.floor(player.y+h); player.onGround=false; for(let y=minY;y<=maxY;y++){ for(let x=minX;x<=maxX;x++){ const t=getTile(x,y); if(isSolid(t)){ if(player.vy>0){ player.y = y - h - 0.001; player.vy=0; player.onGround=true; } if(player.vy<0){ player.y = y + 1 + h + 0.001; player.vy=0; } } } } } }

// Mgła / widoczność
let revealAll=false; const seen=new Set(); function key(x,y){ return x+','+y; } function revealAround(){ const r=10; for(let dx=-r; dx<=r; dx++){ for(let dy=-r; dy<=r; dy++){ if(dx*dx+dy*dy<=r*r) seen.add(key(Math.floor(player.x+dx),Math.floor(player.y+dy))); } } }

// Kopanie (kierunkowe)
// Kopanie + upadek drzew
let mining=false,mineTimer=0,mineTx=0,mineTy=0; const mineBtn=document.getElementById('mineBtn');
mineBtn.addEventListener('pointerdown',e=>{ e.preventDefault(); startMine(); });
window.addEventListener('pointerup',()=>{ mining=false; mineBtn.classList.remove('on'); });
function startMine(){ const tx=Math.floor(player.x + mineDir.dx + (mineDir.dx>0?player.w/2:mineDir.dx<0?-player.w/2:0)); const ty=Math.floor(player.y + mineDir.dy); const t=getTile(tx,ty); if(t===T.AIR) return; mining=true; mineTimer=0; mineTx=tx; mineTy=ty; mineBtn.classList.add('on'); if(godMode) instantBreak(); }
function instantBreak(){ if(getTile(mineTx,mineTy)===T.AIR){ mining=false; mineBtn.classList.remove('on'); return; } const tId=getTile(mineTx,mineTy); if(tId===T.WOOD && isTreeBase(mineTx,mineTy)){ if(startTreeFall(mineTx,mineTy)){ mining=false; mineBtn.classList.remove('on'); return; } } const info=INFO[tId]; const drop=info.drop; setTile(mineTx,mineTy,T.AIR); if(drop) inv[drop]=(inv[drop]||0)+1; mining=false; mineBtn.classList.remove('on'); updateInventory(); }
// Falling tree system (per-block physics)
const fallingBlocks=[]; // {x,y,t,dir,hBudget}
let fallStepAccum=0;
function isTreeBase(x,y){ if(getTile(x,y)!==T.WOOD) return false; if(getTile(x,y-1)!==T.WOOD) return false; const below=getTile(x,y+1); return below!==T.WOOD; }
function collectTreeTiles(x,y){ const stack=[[x,y]]; const vis=new Set(); const out=[]; let guard=0; while(stack.length){ const [cx,cy]=stack.pop(); const k=cx+','+cy; if(vis.has(k)) continue; const tt=getTile(cx,cy); if(!(tt===T.WOOD||tt===T.LEAF||tt===T.SNOW)) continue; vis.add(k); out.push({x:cx,y:cy,t:tt}); setTile(cx,cy,T.AIR); if(++guard>600) break; stack.push([cx+1,cy]); stack.push([cx-1,cy]); stack.push([cx,cy+1]); stack.push([cx,cy-1]); stack.push([cx,cy-2]); }
	return out; }
function startTreeFall(bx,by){ const tiles=collectTreeTiles(bx,by); if(!tiles.length) return false; const dir=player.facing||1; let maxY=-Infinity; tiles.forEach(t=>{ if(t.y>maxY) maxY=t.y; }); tiles.forEach(tile=>{ const heightFactor=maxY - tile.y; const hBudget=Math.max(0, Math.min(8, Math.round(heightFactor*0.6 + randSeed(tile.x*31+tile.y*17)*2))); fallingBlocks.push({x:tile.x, y:tile.y, t:tile.t, dir, hBudget}); }); return true; }
function updateFallingBlocks(dt){ if(!fallingBlocks.length) return; fallStepAccum += dt; const STEP=0.05; if(fallStepAccum < STEP) return; // process discrete step(s)
	while(fallStepAccum >= STEP){ fallStepAccum -= STEP; if(!fallingBlocks.length) break; const occ=new Set(); fallingBlocks.forEach(b=>occ.add(b.x+','+b.y));
		// sort bottom-up so lower settles first (prevents mid-air support glitches)
		const order=[...fallingBlocks.keys()].sort((a,b)=>fallingBlocks[b].y - fallingBlocks[a].y);
		const toRemove=[];
		for(const idx of order){ const b=fallingBlocks[idx]; const belowY=b.y+1; if(belowY>=WORLD_H){ setTile(b.x,b.y,b.t); toRemove.push(idx); continue; }
			const belowKey=b.x+','+belowY; const belowTile=getTile(b.x,belowY);
			if(belowTile===T.AIR && !occ.has(belowKey)){ // straight fall
				occ.delete(b.x+','+b.y); b.y++; occ.add(b.x+','+b.y); continue; }
			// attempt diagonal slide in tilt direction if budget and space
			if(b.hBudget>0){ const nx=b.x + b.dir; const ny=b.y + 1; if(nx>-10000 && nx<10000){ // broad bounds implicit
					const nBelow=getTile(nx,ny); const horizFree=!occ.has(nx+','+b.y) && getTile(nx,b.y)===T.AIR; const diagFree= nBelow===T.AIR && !occ.has(nx+','+ny);
					if(horizFree && diagFree){ // move diagonally (simulate lean/rotation)
						occ.delete(b.x+','+b.y); b.x=nx; b.y=ny; occ.add(b.x+','+b.y); b.hBudget--; continue; }
				} }
			// settle
			setTile(b.x,b.y,b.t); toRemove.push(idx); }
		if(toRemove.length){ toRemove.sort((a,b)=>b-a).forEach(i=>fallingBlocks.splice(i,1)); }
	} }
function drawFallingBlocks(){ if(!fallingBlocks.length) return; fallingBlocks.forEach(b=>{ const col=INFO[b.t].color; if(!col) return; ctx.fillStyle=col; ctx.fillRect(b.x*TILE, b.y*TILE, TILE, TILE); }); }
function updateMining(dt){ if(!mining) return; if(getTile(mineTx,mineTy)===T.AIR){ mining=false; mineBtn.classList.remove('on'); return; } if(godMode){ instantBreak(); return; } mineTimer += dt * tools[player.tool]; const curId=getTile(mineTx,mineTy); const info=INFO[curId]; const need=Math.max(0.1, info.hp/6); if(mineTimer>=need){ if(curId===T.WOOD && isTreeBase(mineTx,mineTy)){ if(startTreeFall(mineTx,mineTy)){ mining=false; mineBtn.classList.remove('on'); return; } } const drop=info.drop; setTile(mineTx,mineTy,T.AIR); if(drop) inv[drop]=(inv[drop]||0)+1; mining=false; mineBtn.classList.remove('on'); updateInventory(); } }

// Render
function draw(){ ctx.fillStyle='#0b0f16'; ctx.fillRect(0,0,W,H); const viewX=Math.ceil(W/(TILE*zoom)); const viewY=Math.ceil(H/(TILE*zoom)); const sx=Math.floor(camX)-1; const sy=Math.floor(camY)-1; ctx.save(); ctx.scale(zoom,zoom); ctx.translate(-camX*TILE,-camY*TILE);
	// draw cape FIRST so any solid / passable tiles will occlude it
	drawCape();
	// render tiles (solids + passables)
	for(let y=sy; y<sy+viewY+2; y++){
		for(let x=sx; x<sx+viewX+2; x++){
			const t=getTile(x,y); if(t===T.AIR) continue; if(!revealAll && !seen.has(key(x,y))){ ctx.fillStyle='rgba(0,0,0,.6)'; ctx.fillRect(x*TILE,y*TILE,TILE,TILE); continue; }
			ctx.fillStyle=INFO[t].color; ctx.fillRect(x*TILE,y*TILE,TILE,TILE);
		}
	}
	drawFallingBlocks();
	// player + overlays
	drawPlayer();
	if(mining){ ctx.strokeStyle='#fff'; ctx.strokeRect(mineTx*TILE+1,mineTy*TILE+1,TILE-2,TILE-2); const info=INFO[getTile(mineTx,mineTy)]||{hp:1}; const need=Math.max(0.1,info.hp/6); const p=mineTimer/need; ctx.fillStyle='rgba(255,255,255,.3)'; ctx.fillRect(mineTx*TILE, mineTy*TILE + (1-p)*TILE, TILE, p*TILE); }
	ctx.restore(); }

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
function placePlayer(skipMsg){ const x=0; ensureChunk(0); let y=0; while(y<WORLD_H-1 && getTile(x,y)===T.AIR) y++; player.x=x+0.5; player.y=y-1; revealAround(); camSX=player.x - (W/(TILE*zoom))/2; camSY=player.y - (H/(TILE*zoom))/2; camX=camSX; camY=camSY; initScarf(); if(!skipMsg) msg('Seed '+worldSeed); }
placePlayer(); updateInventory(); updateGodBtn(); msg('Sterowanie: A/D/W + ⛏️ / klik. G=Bóg (nieskończone skoki), M=Mapa, C=Centrum, H=Pomoc');

// Pętla
let last=performance.now(); function loop(ts){ const dt=Math.min(0.05,(ts-last)/1000); last=ts; physics(dt); updateMining(dt); updateFallingBlocks(dt); updateCape(dt); updateBlink(ts); draw(); if(ts<radarFlash){ radarBtn.classList.add('pulse'); } else radarBtn.classList.remove('pulse'); updateFps(ts); requestAnimationFrame(loop); } requestAnimationFrame(loop);
