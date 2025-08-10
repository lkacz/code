// Nowy styl / pełny ekran inspirowany Diamonds Explorer
// Game init
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', {alpha:false});
let W=0,H=0,DPR=1; function resize(){ DPR=Math.max(1,Math.min(2,window.devicePixelRatio||1)); canvas.width=Math.floor(window.innerWidth*DPR); canvas.height=Math.floor(window.innerHeight*DPR); canvas.style.width=window.innerWidth+'px'; canvas.style.height=window.innerHeight+'px'; ctx.setTransform(DPR,0,0,DPR,0,0); W=window.innerWidth; H=window.innerHeight; } window.addEventListener('resize',resize,{passive:true}); resize();

// --- Świat (łagodniejsze biomy: równiny / wzgórza / góry) ---
const {CHUNK_W,WORLD_H,TILE,SURFACE_GRASS_DEPTH,SAND_DEPTH,T,INFO,SNOW_LINE,isSolid} = MM;
const WORLDGEN = MM.worldGen;
const WORLD = MM.world;
const TREES = MM.trees;
const CAPE = MM.cape;
// Visual enhancement config
const VISUAL={animations:true};
let grassDensityScalar = 1; // user adjustable (exponential scaling)
let grassHeightScalar = 1; // user adjustable linear multiplier
// Grass performance management
let grassThinningFactor = 1; // 0..1 multiplier applied to density for perf control
let grassBudgetInfo = '';
const GRASS_ITER_BUDGET = 30000; // soft cap on total blade draws (both passes combined)
function initGrassControls(){
	const rngD=document.getElementById('grassDensity');
	const labD=document.getElementById('grassDensityLabel');
	const rngH=document.getElementById('grassHeight');
	const labH=document.getElementById('grassHeightLabel');
	function updDensity(){ if(!rngD||!labD) return; grassDensityScalar = Math.pow(3, parseFloat(rngD.value)); const approx = Math.round( (4 * grassDensityScalar) ); labD.textContent=approx+'x'; }
	function updHeight(){ if(!rngH||!labH) return; grassHeightScalar = parseFloat(rngH.value); labH.textContent=grassHeightScalar.toFixed(2)+'x'; }
	if(rngD) rngD.addEventListener('input',updDensity); if(rngH) rngH.addEventListener('input',updHeight);
	updDensity(); updHeight();
}
let surfaceHeight, biomeType, randSeed, diamondChance, worldSeed;
try {
	if(!WORLDGEN) throw new Error('MM.worldGen missing (worldgen.js not loaded)');
	surfaceHeight = WORLDGEN.surfaceHeight;
	biomeType = WORLDGEN.biomeType;
	randSeed = WORLDGEN.randSeed;
	diamondChance = WORLDGEN.diamondChance;
	worldSeed = WORLDGEN.worldSeed;
} catch(e){
	const box=document.getElementById('errorBox');
	if(box){ box.textContent='Init error: '+e.message; box.style.display='block'; }
	console.error('[InitFailure]', e);
	// abort further setup to avoid cascading issues
	throw e;
}
function setSeedFromInput(){ WORLDGEN.setSeedFromInput(); worldSeed=WORLDGEN.worldSeed; }
function ensureChunk(cx){ return WORLD.ensureChunk(cx); }

// light error overlay (keep minimal)
(function(){ const box=document.getElementById('errorBox'); if(!box) return; function show(msg){ box.textContent=msg; box.style.display='block'; }
	window.addEventListener('error',e=>{ show('[Error] '+e.message); });
})();

function getTile(x,y){ return WORLD.getTile(x,y); }
function setTile(x,y,v){ WORLD.setTile(x,y,v); }

// --- Gracz / inwentarz ---
const player={x:0,y:0,w:0.7,h:0.95,vx:0,vy:0,onGround:false,facing:1,tool:'basic'};
const tools={basic:1,stone:2,diamond:4};
// Inventory counts for placeable tiles
const inv={grass:0,sand:0,stone:0,diamond:0,wood:0,leaf:0,snow:0,tools:{stone:false,diamond:false}};
// Hotbar (slots triggered by keys 4..9)
const HOTBAR_ORDER=['GRASS','SAND','STONE','WOOD','LEAF','SNOW'];
let hotbarIndex=0; // 0..length-1
function selectedTileId(){ const name=HOTBAR_ORDER[hotbarIndex]; return T[name]; }
function cycleHotbar(idx){ if(idx<0||idx>=HOTBAR_ORDER.length) return; hotbarIndex=idx; updateHotbarSel(); saveState(); }
// Persistence key
const SAVE_KEY='mm_inv_v1';
function canCraftStone(){return inv.stone>=10;}
function craftStone(){ if(canCraftStone()){ inv.stone-=10; inv.tools.stone=true; msg('Kilof kamienny (2)'); updateInventory(); }}
function canCraftDiamond(){return inv.diamond>=5;}
function craftDiamond(){ if(canCraftDiamond()){ inv.diamond-=5; inv.tools.diamond=true; msg('Kilof diamentowy (3)'); updateInventory(); }}
// Blink + cape
let blinkStart=0, blinking=false, nextBlink=performance.now()+2000+Math.random()*3000; const BLINK_DUR=160; function updateBlink(now){ if(!blinking && now>nextBlink){ blinking=true; blinkStart=now; } if(blinking && now>blinkStart+BLINK_DUR){ blinking=false; nextBlink=now+2000+Math.random()*4000; } }
// Cape physics: chain with gravity that droops when idle and streams when moving
const CAPE_SEGMENTS=MM.CAPE.SEGMENTS; 
const CAPE_ANCHOR_FRAC=MM.CAPE.ANCHOR_FRAC; // 0 = top of body, 1 = bottom. Middle requested.
function initScarf(){ CAPE.init(player); }
function updateCape(dt){ CAPE.update(player,dt,getTile,isSolid); }
function drawCape(){ CAPE.draw(ctx,TILE); }
function drawPlayer(){ drawCape(); const bodyX=(player.x-player.w/2)*TILE; const bodyY=(player.y-player.h/2)*TILE; const bw=player.w*TILE, bh=player.h*TILE; ctx.fillStyle='#f4c05a'; ctx.fillRect(bodyX,bodyY,bw,bh); ctx.strokeStyle='#4b3212'; ctx.lineWidth=2; ctx.strokeRect(bodyX,bodyY,bw,bh); const eyeW=6, eyeHOpen=6; let eyeH=eyeHOpen; if(blinking){ const p=(performance.now()-blinkStart)/BLINK_DUR; const tri=p<0.5? (p*2) : (1-(p-0.5)*2); eyeH = Math.max(1, eyeHOpen * (1-tri)); } const eyeY=bodyY + bh*0.35; const eyeOffsetX=bw*0.18; const pupilW=2; const pupilShift=player.facing*1.5; function eye(cx){ ctx.fillStyle='#fff'; ctx.fillRect(cx-eyeW/2, eyeY-eyeH/2, eyeW, eyeH); if(eyeH>2){ ctx.fillStyle='#111'; ctx.fillRect(cx - pupilW/2 + pupilShift, eyeY - Math.min(eyeH/2-1,2), pupilW, Math.min(eyeH-2,4)); } } eye(bodyX+bw/2-eyeOffsetX); eye(bodyX+bw/2+eyeOffsetX); ctx.fillStyle='rgba(0,0,0,0.25)'; const shw=bw*0.6; ctx.beginPath(); ctx.ellipse(player.x*TILE, (player.y+player.h/2)*TILE+2, shw/2, 4,0,0,Math.PI*2); ctx.fill(); }

// Chunk render cache (offscreen canvas per chunk)
const chunkCanvases = new Map(); // key: chunkX -> {canvas,ctx,version}
function hash32(x,y){ let h = (x|0)*374761393 + (y|0)*668265263; h = (h^(h>>>13))*1274126177; h = h^(h>>>16); return h>>>0; }
function shadeColor(hex,delta){ // hex like #rgb or #rrggbb (we use rrggbb)
	const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
	const clamp=v=>v<0?0:v>255?255:v; const nr=clamp(r+delta), ng=clamp(g+delta), nb=clamp(b+delta);
	return '#'+nr.toString(16).padStart(2,'0')+ng.toString(16).padStart(2,'0')+nb.toString(16).padStart(2,'0'); }
function drawChunkToCache(cx){ const key=cx; const k='c'+cx; const arr=WORLD._world.get(k); if(!arr) return; let entry=chunkCanvases.get(key); if(!entry){ const c=document.createElement('canvas'); c.width=CHUNK_W*TILE; c.height=WORLD_H*TILE; const cctx=c.getContext('2d'); cctx.imageSmoothingEnabled=false; entry={canvas:c,ctx:cctx,version:-1}; chunkCanvases.set(key,entry); }
	const currentVersion=WORLD.chunkVersion(cx); if(entry.version===currentVersion) return; const cctx=entry.ctx; cctx.clearRect(0,0,cctx.canvas.width,cctx.canvas.height);
		for(let lx=0; lx<CHUNK_W; lx++){
			const wx=cx*CHUNK_W+lx;
			for(let y=0;y<WORLD_H;y++){
				const t=arr[y*CHUNK_W+lx]; if(t===T.AIR) continue; let base=INFO[t].color; if(!base) continue;
				const h = hash32(wx,y);
				// Per-type amplitude (diamond fixed, stone extra subtle, grass medium, others default)
				let amp=22; if(t===T.STONE) amp=6; else if(t===T.DIAMOND) amp=0; else if(t===T.WOOD) amp=16; else if(t===T.GRASS) amp=18;
				const delta = ((h & 0xFF)/255 - 0.5)*amp; // symmetrical
				const col = amp? shadeColor(base, delta|0) : base; // stone uses low amp so should not drift green
				cctx.fillStyle=col; cctx.fillRect(lx*TILE,y*TILE,TILE,TILE);
				if(t===T.STONE || t===T.WOOD){ cctx.fillStyle='rgba(0,0,0,0.05)'; cctx.fillRect(lx*TILE + ((h>>8)&3), y*TILE, 2, TILE); }
			}
		}
	entry.version=currentVersion; }
function drawWorldVisible(sx,sy,viewX,viewY){ const minChunk=Math.floor(sx/CHUNK_W)-1; const maxChunk=Math.floor((sx+viewX+2)/CHUNK_W)+1; // prepare caches
	for(let cx=minChunk; cx<=maxChunk; cx++){ WORLD.ensureChunk(cx); drawChunkToCache(cx); }
	// Draw whole chunks that intersect view (avoids per-tile seams)
	const viewPX0 = sx*TILE, viewPX1=(sx+viewX+2)*TILE;
	for(let cx=minChunk; cx<=maxChunk; cx++){
		const entry=chunkCanvases.get(cx); if(!entry) continue; const chunkXpx = cx*CHUNK_W*TILE;
		const chunkRight = chunkXpx + CHUNK_W*TILE; if(chunkRight < viewPX0-CHUNK_W*TILE || chunkXpx > viewPX1+CHUNK_W*TILE) continue;
		ctx.drawImage(entry.canvas, chunkXpx, 0);
	}
	// Apply fog overlay only for unseen tiles (still per-tile but solid overlay so no seams)
	if(!revealAll){ for(let y=sy; y<sy+viewY+2; y++){ if(y<0||y>=WORLD_H) continue; for(let x=sx; x<sx+viewX+2; x++){ if(!hasSeen(x,y)){ const t=getTile(x,y); if(t!==T.AIR){ ctx.fillStyle='rgba(0,0,0,.6)'; ctx.fillRect(x*TILE,y*TILE,TILE,TILE); } } } } }
	if(VISUAL.animations){ drawAnimatedOverlays(sx,sy,viewX,viewY,'back'); }
}

function drawAnimatedOverlays(sx,sy,viewX,viewY,pass){ const now=performance.now(); const wind = Math.sin(now*0.0003)*1.2 + Math.sin(now*0.0011)*0.8; const diamondPulse = (Math.sin(now*0.005)+1)/2; // 0..1
	// Dynamic grass thinning computed only on back pass (once per frame region)
	if(pass==='back'){
		// Count potential grass tiles in view
		let grassTiles=0;
		for(let y=sy; y<sy+viewY+2; y++){
			if(y<0||y>=WORLD_H) continue;
			for(let x=sx; x<sx+viewX+2; x++){
				if(getTile(x,y)===T.GRASS && getTile(x,y-1)===T.AIR) grassTiles++;
			}
		}
		const basePerTile = Math.min(120, Math.max(1, Math.round(3 * grassDensityScalar)));
		// Zoom level LOD reduction (when zoomed out, fewer blades needed visually)
		const zoomLod = zoom < 1 ? (0.35 + 0.65*zoom) : 1; // at 0.5 zoom -> 0.675 multiplier
		const estimatedIterations = grassTiles * basePerTile * 2 * zoomLod; // both passes
		if(estimatedIterations > GRASS_ITER_BUDGET){
			grassThinningFactor = GRASS_ITER_BUDGET / estimatedIterations;
			if(grassThinningFactor < 0.05) grassThinningFactor = 0.05; // hard lower bound
			grassBudgetInfo = ' grass:'+ (grassThinningFactor*100|0)+'%';
		} else {
			grassThinningFactor = 1;
			grassBudgetInfo = '';
		}
	}
	for(let y=sy; y<sy+viewY+2; y++){
		if(y<0||y>=WORLD_H) continue;
		for(let x=sx; x<sx+viewX+2; x++){
			const t=getTile(x,y); if(t===T.AIR) continue; // only animate visible tiles (fog already applied earlier)
			// Grass blades (only surface grass). Split front/back layering.
			if(t===T.GRASS && getTile(x,y-1)===T.AIR){
				const seed=hash32(x,y);
				const base = 3;
				let bladeCount = Math.min(120, Math.max(1, Math.round(base * grassDensityScalar * grassThinningFactor * (zoom<1? (0.35 + 0.65*zoom):1))));
				for(let b=0;b<bladeCount;b++){
					const bSeed = seed ^ (b*1103515245);
					// Individual randomized attributes
					const randA = ((bSeed>>>1)&1023)/1023; // general random
					const randB = ((bSeed>>>11)&1023)/1023; // secondary
					const randC = ((bSeed>>>21)&1023)/1023; // tertiary
					let heightFactor = 0.10 + randA*0.40; // 0.10..0.50 tile base
					heightFactor *= grassHeightScalar; // apply global user multiplier
					if(heightFactor>0.8) heightFactor=0.8; // clamp to avoid excessively tall blades
					const freq = 0.0025 + randB*0.0035; // per-blade sway frequency
					const amp = 2.0 + randC*3.0; // sway pixel amplitude base
					const phase = ((bSeed>>>6)&1023)/1023 * Math.PI*2;
					const timeTerm = now*freq + phase + wind*0.4;
					const sway = Math.sin(timeTerm) * amp;
					// Root distribution across tile width with deterministic jitter
					const jitter = ((bSeed>>>26)&63)/63; const frac = (b + jitter)/bladeCount; // 0..1
					const baseX = x*TILE + (frac - 0.5)*TILE*0.98 + TILE/2;
					const baseY = y*TILE;
					// Curvature: mid control point offset sideways & upward for natural bend
					const bendDir = Math.sin(phase + wind*0.2); // -1..1
					const curvature = 0.2 + randB*0.4; // magnitude of lateral mid bend
					const topX = baseX + sway*0.45;
					const topY = baseY - TILE*heightFactor;
					const midX = baseX + (sway*0.25) + bendDir*curvature*4;
					const midY = baseY - TILE*heightFactor*0.55;
					const shadeMod = 0.65 + randC*0.5; // 0.65..1.15
					const frontBlade = ((bSeed>>5)&1)===1; if((pass==='front' && !frontBlade) || (pass==='back' && frontBlade)) continue;
					ctx.strokeStyle = (bSeed&2)? 'rgba(46,165,46,'+(frontBlade? (0.85*shadeMod).toFixed(2):(0.55*shadeMod).toFixed(2))+')' : 'rgba(34,125,34,'+(frontBlade? (0.80*shadeMod).toFixed(2):(0.50*shadeMod).toFixed(2))+')';
					ctx.lineWidth = 1;
					ctx.beginPath();
					ctx.moveTo(baseX, baseY);
					ctx.quadraticCurveTo(midX, midY, topX, topY);
					ctx.stroke();
				}
			}
			// Leaf shimmer
			if(t===T.LEAF){ const h=hash32(x,y); const frontLeaf = ((h>>7)&1)===1; if((pass==='back' && frontLeaf) || (pass==='front' && !frontLeaf)){} else { const phase=(h&255)/255; const offset = Math.sin(now*0.0025 + phase*6.283)*2.5; ctx.fillStyle='rgba(255,255,255,'+(frontLeaf?0.10:0.06)+')'; ctx.fillRect(x*TILE + TILE/2 + offset - TILE*0.22, y*TILE+3, TILE*0.44, TILE*0.44); } }
			// Diamond glitter
			if(pass==='back' && t===T.DIAMOND){ const h=hash32(x,y); const flash = Math.sin(now*0.006 + (h&1023))*0.5 + 0.5; if(flash>0.8){ const alpha=(flash-0.8)/0.2; ctx.fillStyle='rgba(255,255,255,'+(0.3*alpha)+')'; const cxp=x*TILE+TILE/2, cyp=y*TILE+TILE/2; ctx.fillRect(cxp-1,cyp-1,2,2); ctx.fillRect(cxp-3,cyp,6,1); ctx.fillRect(cxp,cyp-3,1,6); }
				ctx.fillStyle='rgba(255,255,255,'+(0.05+diamondPulse*0.07)+')'; ctx.fillRect(x*TILE,y*TILE,TILE,TILE); }
		}
	}
}

// Input + tryby specjalne
const keys={}; let godMode=false; const keysOnce=new Set();
function updateGodBtn(){ const b=document.getElementById('godBtn'); if(!b) return; b.classList.toggle('toggled',godMode); b.textContent='Bóg: '+(godMode?'ON':'OFF'); }
function toggleGod(){ godMode=!godMode; updateGodBtn(); msg('Tryb boga '+(godMode?'ON':'OFF')); }
function toggleMap(){ revealAll=!revealAll; const b=document.getElementById('mapBtn'); if(b){ b.classList.toggle('toggled',revealAll); b.textContent='Mapa: '+(revealAll?'ON':'OFF'); } msg('Mapa '+(revealAll?'ON':'OFF')); }
function centerCam(){ camSX=player.x - (W/(TILE*zoom))/2; camSY=player.y - (H/(TILE*zoom))/2; camX=camSX; camY=camSY; msg('Wyśrodkowano'); }
function toggleHelp(){ const h=document.getElementById('help'); const show=h.style.display!=='block'; h.style.display=show?'block':'none'; document.getElementById('helpBtn').setAttribute('aria-expanded', String(show)); }
window.addEventListener('keydown',e=>{ const k=e.key.toLowerCase(); keys[k]=true; if(['1','2','3'].includes(e.key)){ if(e.key==='1') player.tool='basic'; if(e.key==='2'&&inv.tools.stone) player.tool='stone'; if(e.key==='3'&&inv.tools.diamond) player.tool='diamond'; updateInventory(); }
 // Hotbar numeric (4..9) -> slots 0..5
 if(['4','5','6','7','8','9'].includes(e.key)){
	 const slot=parseInt(e.key,10)-4; cycleHotbar(slot);
 }
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
let camX=0,camY=0,camSX=0,camSY=0; let zoom=1, zoomTarget=1; function ensureChunks(){ const pcx=Math.floor(player.x/CHUNK_W); for(let d=-2; d<=2; d++) ensureChunk(pcx+d); }
function clampZoom(z){ return Math.min(3, Math.max(0.5, z)); }
function setZoom(z){ zoomTarget = clampZoom(z); }
function nudgeZoom(f){ setZoom(zoomTarget * f); }
canvas.addEventListener('wheel',e=>{ if(e.ctrlKey){ // let browser zoom work
	return; }
	e.preventDefault(); const dir = e.deltaY>0?1:-1; const factor = dir>0? 1/1.1 : 1.1; nudgeZoom(factor);
},{passive:false});
window.addEventListener('keydown',e=>{ if(e.key==='+'||e.key==='='||e.key===']'){ nudgeZoom(1.1); }
	if(e.key==='-'||e.key==='['){ nudgeZoom(1/1.1); }
});

// Fizyka
const MOVE={ACC:32,FRICTION:28,MAX:6,JUMP:-9,GRAV:20}; let jumpPrev=false; function physics(dt){ let input=0; if(keys['a']||keys['arrowleft']) input-=1; if(keys['d']||keys['arrowright']) input+=1; if(input!==0) player.facing=input; const target=input*MOVE.MAX; const diff=target-player.vx; const accel=MOVE.ACC*dt*Math.sign(diff); if(target!==0){ if(Math.abs(accel)>Math.abs(diff)) player.vx=target; else player.vx+=accel; } else { const fr=MOVE.FRICTION*dt; if(Math.abs(player.vx)<=fr) player.vx=0; else player.vx-=fr*Math.sign(player.vx); } const jumpNow=(keys['w']||keys['arrowup']||keys[' ']); if(jumpNow && !jumpPrev && (player.onGround || godMode)){ player.vy=MOVE.JUMP; player.onGround=false; } jumpPrev=jumpNow; player.vy+=MOVE.GRAV*dt; if(player.vy>20) player.vy=20; player.x += player.vx*dt; collide('x'); player.y += player.vy*dt; collide('y'); const tX=player.x - (W/(TILE*zoom))/2 + player.w/2; const tY=player.y - (H/(TILE*zoom))/2 + player.h/2; camSX += (tX-camSX)*Math.min(1,dt*8); camSY += (tY-camSY)*Math.min(1,dt*8); camX=camSX; camY=camSY; ensureChunks(); revealAround(); }
function collide(axis){ const w=player.w/2,h=player.h/2; if(axis==='x'){ const minX=Math.floor(player.x-w), maxX=Math.floor(player.x+w), minY=Math.floor(player.y-h), maxY=Math.floor(player.y+h); for(let y=minY;y<=maxY;y++){ for(let x=minX;x<=maxX;x++){ const t=getTile(x,y); if(isSolid(t)){ if(player.vx>0) player.x = x - w - 0.001; if(player.vx<0) player.x = x + 1 + w + 0.001; } } } } else { const minX=Math.floor(player.x-w), maxX=Math.floor(player.x+w), minY=Math.floor(player.y-h), maxY=Math.floor(player.y+h); player.onGround=false; for(let y=minY;y<=maxY;y++){ for(let x=minX;x<=maxX;x++){ const t=getTile(x,y); if(isSolid(t)){ if(player.vy>0){ player.y = y - h - 0.001; player.vy=0; player.onGround=true; } if(player.vy<0){ player.y = y + 1 + h + 0.001; player.vy=0; } } } } } }

// Mgła / widoczność (optimized bitset per chunk instead of Set<string>)
let revealAll=false;
const seenChunks=new Map(); // key: chunkX -> Uint8Array bitset (CHUNK_W*WORLD_H bits)
const SEEN_STRIDE = CHUNK_W*WORLD_H; // bits per chunk
const SEEN_BYTES = Math.ceil(SEEN_STRIDE/8);
function ensureSeenChunk(cx){ let arr=seenChunks.get(cx); if(!arr){ arr=new Uint8Array(SEEN_BYTES); seenChunks.set(cx,arr);} return arr; }
function markSeen(x,y){ if(y<0||y>=WORLD_H) return; const cx=Math.floor(x/CHUNK_W); let lx=x - cx*CHUNK_W; if(lx<0||lx>=CHUNK_W) return; const idx=y*CHUNK_W + lx; const arr=ensureSeenChunk(cx); arr[idx>>3] |= (1 << (idx & 7)); }
function hasSeen(x,y){ if(y<0||y>=WORLD_H) return false; const cx=Math.floor(x/CHUNK_W); const arr=seenChunks.get(cx); if(!arr) return false; const lx=x - cx*CHUNK_W; if(lx<0||lx>=CHUNK_W) return false; const idx=y*CHUNK_W + lx; return (arr[idx>>3] & (1 << (idx & 7)))!==0; }
function revealAround(){ const r=10; const px=player.x, py=player.y; for(let dx=-r; dx<=r; dx++){ const wx=Math.floor(px+dx); for(let dy=-r; dy<=r; dy++){ if(dx*dx+dy*dy<=r*r){ markSeen(wx, Math.floor(py+dy)); } } } }

// Kopanie (kierunkowe)
// Kopanie + upadek drzew
let mining=false,mineTimer=0,mineTx=0,mineTy=0; const mineBtn=document.getElementById('mineBtn');
mineBtn.addEventListener('pointerdown',e=>{ e.preventDefault(); startMine(); });
window.addEventListener('pointerup',()=>{ mining=false; mineBtn.classList.remove('on'); });
function startMine(){ const tx=Math.floor(player.x + mineDir.dx + (mineDir.dx>0?player.w/2:mineDir.dx<0?-player.w/2:0)); const ty=Math.floor(player.y + mineDir.dy); const t=getTile(tx,ty); if(t===T.AIR) return; mining=true; mineTimer=0; mineTx=tx; mineTy=ty; mineBtn.classList.add('on'); if(godMode) instantBreak(); }
function instantBreak(){ if(getTile(mineTx,mineTy)===T.AIR){ mining=false; mineBtn.classList.remove('on'); return; } const tId=getTile(mineTx,mineTy); if(tId===T.WOOD && isTreeBase(mineTx,mineTy)){ if(startTreeFall(mineTx,mineTy)){ mining=false; mineBtn.classList.remove('on'); return; } } const info=INFO[tId]; const drop=info.drop; setTile(mineTx,mineTy,T.AIR); if(drop) inv[drop]=(inv[drop]||0)+1; mining=false; mineBtn.classList.remove('on'); updateInventory(); }
// Falling tree system (per-block physics)
function isTreeBase(x,y){ return TREES.isTreeBase(getTile,x,y); }
function startTreeFall(bx,by){ return TREES.startTreeFall(getTile,setTile,player.facing,bx,by); }
function updateFallingBlocks(dt){ TREES.updateFallingBlocks(getTile,setTile,dt); }
function drawFallingBlocks(){ TREES.drawFallingBlocks(ctx,TILE,INFO); }
function updateMining(dt){ if(!mining) return; if(getTile(mineTx,mineTy)===T.AIR){ mining=false; mineBtn.classList.remove('on'); return; } if(godMode){ instantBreak(); return; } mineTimer += dt * tools[player.tool]; const curId=getTile(mineTx,mineTy); const info=INFO[curId]; const need=Math.max(0.1, info.hp/6); if(mineTimer>=need){ if(curId===T.WOOD && isTreeBase(mineTx,mineTy)){ if(startTreeFall(mineTx,mineTy)){ mining=false; mineBtn.classList.remove('on'); return; } } const drop=info.drop; setTile(mineTx,mineTy,T.AIR); if(drop) inv[drop]=(inv[drop]||0)+1; mining=false; mineBtn.classList.remove('on'); updateInventory(); } }

// --- Placement ---
canvas.addEventListener('contextmenu',e=>{ e.preventDefault(); tryPlaceFromEvent(e); });
canvas.addEventListener('pointerdown',e=>{ if(e.button===2){ e.preventDefault(); tryPlaceFromEvent(e); } });
function tryPlaceFromEvent(e){ const rect=canvas.getBoundingClientRect(); const mx=(e.clientX-rect.left)/zoom/DPR + camX*TILE; const my=(e.clientY-rect.top)/zoom/DPR + camY*TILE; const tx=Math.floor(mx/ TILE); const ty=Math.floor(my/ TILE); tryPlace(tx,ty); }
function haveBlocksFor(tileId){ switch(tileId){ case T.GRASS: return inv.grass>0; case T.SAND: return inv.sand>0; case T.STONE: return inv.stone>0; case T.WOOD: return inv.wood>0; case T.LEAF: return inv.leaf>0; case T.SNOW: return inv.snow>0; default: return false; }}
function consumeFor(tileId){ if(tileId===T.GRASS) inv.grass--; else if(tileId===T.SAND) inv.sand--; else if(tileId===T.STONE) inv.stone--; else if(tileId===T.WOOD) inv.wood--; else if(tileId===T.LEAF) inv.leaf--; else if(tileId===T.SNOW) inv.snow--; }
function tryPlace(tx,ty){ if(getTile(tx,ty)!==T.AIR) return; // not empty
 // prevent placing inside player bbox
 if(tx+0.001 > player.x - player.w/2 && tx < player.x + player.w/2 && ty+1 > player.y - player.h/2 && ty < player.y + player.h/2){ return; }
 const below=getTile(tx,ty+1); if(below===T.AIR && !godMode) return; const id=selectedTileId(); if(!haveBlocksFor(id)){ msg('Brak bloków'); return; } setTile(tx,ty,id); consumeFor(id); updateInventory(); updateHotbarCounts(); saveState(); }
function updateHotbarCounts(){ const map={GRASS:'grass',SAND:'sand',STONE:'stone',WOOD:'wood',LEAF:'leaf',SNOW:'snow'}; for(const k in map){ const el=document.getElementById('hotCnt'+k); if(el) el.textContent=inv[map[k]]; } }
function updateHotbarSel(){ document.querySelectorAll('.hotSlot').forEach((el,i)=>{ if(i===hotbarIndex) el.classList.add('sel'); else el.classList.remove('sel'); }); }
function saveState(){ try{ const data={inv,hotbarIndex,tool:player.tool}; localStorage.setItem(SAVE_KEY, JSON.stringify(data)); }catch(e){} }
function loadState(){ try{ const raw=localStorage.getItem(SAVE_KEY); if(!raw) return; const data=JSON.parse(raw); if(data && data.inv){ for(const k in inv){ if(k==='tools') continue; if(typeof data.inv[k]==='number') inv[k]=data.inv[k]; } if(data.inv.tools){ inv.tools.stone=!!data.inv.tools.stone; inv.tools.diamond=!!data.inv.tools.diamond; } } if(typeof data.hotbarIndex==='number') hotbarIndex=Math.min(HOTBAR_ORDER.length-1, Math.max(0,data.hotbarIndex)); if(data.tool && ['basic','stone','diamond'].includes(data.tool)) player.tool=data.tool; }catch(e){} }
document.querySelectorAll('.hotSlot').forEach((el,i)=>{ el.addEventListener('click',()=>{ cycleHotbar(i); }); });
// Left click mining convenience
canvas.addEventListener('pointerdown',e=>{ if(e.button===0){ const rect=canvas.getBoundingClientRect(); const mx=(e.clientX-rect.left)/zoom/DPR + camX*TILE; const my=(e.clientY-rect.top)/zoom/DPR + camY*TILE; const tx=Math.floor(mx/TILE); const ty=Math.floor(my/TILE); const dx=tx - Math.floor(player.x); const dy=ty - Math.floor(player.y); if(Math.abs(dx)<=2 && Math.abs(dy)<=2){ mineDir.dx = Math.sign(dx)||0; mineDir.dy = Math.sign(dy)||0; startMine(); } }});

// Render
function draw(){ ctx.fillStyle='#0b0f16'; ctx.fillRect(0,0,W,H); const viewX=Math.ceil(W/(TILE*zoom)); const viewY=Math.ceil(H/(TILE*zoom)); const sx=Math.floor(camX)-1; const sy=Math.floor(camY)-1; ctx.save(); ctx.scale(zoom,zoom); // pixel snapping to avoid seams
	const camRenderX = Math.round(camX*TILE*zoom)/ (TILE*zoom);
	const camRenderY = Math.round(camY*TILE*zoom)/ (TILE*zoom);
	ctx.translate(-camRenderX*TILE,-camRenderY*TILE);
	ctx.imageSmoothingEnabled=false; // avoid anti-alias gaps
	// draw cape FIRST so any solid / passable tiles will occlude it
	drawCape();
	// render tiles (solids + passables)
	drawWorldVisible(sx,sy,viewX,viewY);
	drawFallingBlocks();
	// player + overlays (back pass for vegetation done earlier)
	drawPlayer();
	// front vegetation pass (blades/leaves that should appear in front)
	if(VISUAL.animations){ drawAnimatedOverlays(sx,sy,viewX,viewY,'front'); }
	// Ghost block preview
	if(ghostTile!=null){
		ctx.strokeStyle='rgba(255,255,255,0.4)';
		ctx.lineWidth=1;
		ctx.strokeRect(ghostX*TILE+0.5, ghostY*TILE+0.5, TILE-1, TILE-1);
	}
	if(mining){ ctx.strokeStyle='#fff'; ctx.strokeRect(mineTx*TILE+1,mineTy*TILE+1,TILE-2,TILE-2); const info=INFO[getTile(mineTx,mineTy)]||{hp:1}; const need=Math.max(0.1,info.hp/6); const p=mineTimer/need; ctx.fillStyle='rgba(255,255,255,.3)'; ctx.fillRect(mineTx*TILE, mineTy*TILE + (1-p)*TILE, TILE, p*TILE); }
	ctx.restore(); }

// UI aktualizacja
const el={grass:document.getElementById('grass'),sand:document.getElementById('sand'),stone:document.getElementById('stone'),diamond:document.getElementById('diamond'),wood:document.getElementById('wood'),snow:document.getElementById('snow'),pick:document.getElementById('pick'),fps:document.getElementById('fps'),msg:document.getElementById('messages')}; function updateInventory(){ el.grass.textContent=inv.grass; el.sand.textContent=inv.sand; el.stone.textContent=inv.stone; el.diamond.textContent=inv.diamond; el.wood.textContent=inv.wood; if(el.snow) el.snow.textContent=inv.snow; el.pick.textContent=player.tool; document.getElementById('craftStone').disabled=!canCraftStone(); document.getElementById('craftDiamond').disabled=!canCraftDiamond(); updateHotbarCounts(); saveState(); }
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
function regenWorld(){ WORLD.clear(); seenChunks.clear(); mining=false; inv.grass=inv.sand=inv.stone=inv.diamond=inv.wood=inv.leaf=inv.snow=0; inv.tools.stone=inv.tools.diamond=false; player.tool='basic'; hotbarIndex=0; updateInventory(); updateHotbarSel(); placePlayer(true); saveState(); msg('Nowy świat seed '+worldSeed); }
document.getElementById('centerBtn').addEventListener('click',()=>{ camSX=player.x - (W/(TILE*zoom))/2; camSY=player.y - (H/(TILE*zoom))/2; camX=camSX; camY=camSY; });
document.getElementById('helpBtn').addEventListener('click',()=>{ const h=document.getElementById('help'); const show=h.style.display!=='block'; h.style.display=show?'block':'none'; document.getElementById('helpBtn').setAttribute('aria-expanded', String(show)); });
const radarBtn=document.getElementById('radarBtn'); radarBtn.addEventListener('click',()=>{ radarFlash=performance.now()+1500; }); let radarFlash=0;
function msg(t){ el.msg.textContent=t; clearTimeout(msg._t); msg._t=setTimeout(()=>{ el.msg.textContent=''; },4000); }

// FPS
let frames=0,lastFps=performance.now(); function updateFps(now){ frames++; if(now-lastFps>1000){ el.fps.textContent=frames+' FPS'+ (grassBudgetInfo? (' '+grassBudgetInfo):''); frames=0; lastFps=now; }}

// Spawn
function placePlayer(skipMsg){ const x=0; ensureChunk(0); let y=0; while(y<WORLD_H-1 && getTile(x,y)===T.AIR) y++; player.x=x+0.5; player.y=y-1; revealAround(); camSX=player.x - (W/(TILE*zoom))/2; camSY=player.y - (H/(TILE*zoom))/2; camX=camSX; camY=camSY; initScarf(); if(!skipMsg) msg('Seed '+worldSeed); }
loadState();
placePlayer(); updateInventory(); updateGodBtn(); updateHotbarSel(); msg('Sterowanie: A/D/W + LPM kopie, PPM stawia (4-9 wybór). G=Bóg (nieskończone skoki), M=Mapa, C=Centrum, H=Pomoc');
// Ghost preview placement
let ghostTile=null, ghostX=0, ghostY=0;
canvas.addEventListener('pointermove',e=>{ const rect=canvas.getBoundingClientRect(); const mx=(e.clientX-rect.left)/zoom/DPR + camX*TILE; const my=(e.clientY-rect.top)/zoom/DPR + camY*TILE; const tx=Math.floor(mx/TILE); const ty=Math.floor(my/TILE); if(getTile(tx,ty)===T.AIR){ ghostX=tx; ghostY=ty; ghostTile=selectedTileId(); } else ghostTile=null; });
initGrassControls();

// Pętla
let last=performance.now(); function loop(ts){ const dt=Math.min(0.05,(ts-last)/1000); last=ts; // smooth zoom interpolation
	if(Math.abs(zoomTarget-zoom)>0.0001){ zoom += (zoomTarget-zoom)*Math.min(1, dt*8); }
	physics(dt); updateMining(dt); updateFallingBlocks(dt); updateCape(dt); updateBlink(ts); draw(); if(ts<radarFlash){ radarBtn.classList.add('pulse'); } else radarBtn.classList.remove('pulse'); updateFps(ts); requestAnimationFrame(loop); } requestAnimationFrame(loop);
