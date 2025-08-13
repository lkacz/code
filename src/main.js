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
const VISUAL={animations:true, atmoTint:true};
// --- Dynamic Background (parallax + day/night + biome palettes) ---
const DAY_DURATION=300000; // 5 min
const NIGHT_DURATION=300000; // 5 min
const CYCLE_DURATION=DAY_DURATION+NIGHT_DURATION; let cycleStart=performance.now();
const DAY_FRAC = DAY_DURATION / CYCLE_DURATION; // currently 0.5
const TWILIGHT_BAND = 0.12; // normalized portion at each boundary for transitions
// Palettes per biome (0 plains,1 hills,2 mountains) – base keys; we dynamically crossfade near biome borders
const SKY_PALETTES={
	0:{ dayTop:'#5da9ff', dayBot:'#cfe9ff', duskTop:'#ff8c3a', duskBot:'#ffd5a1', nightTop:'#091a2e', nightBot:'#0d2238', mount:['#5d7ba0','#4e6889','#3a516d'] },
	1:{ dayTop:'#4b8fdc', dayBot:'#c2ddf5', duskTop:'#ff7a3a', duskBot:'#ffc68a', nightTop:'#081627', nightBot:'#0b1d30', mount:['#557094','#465d78','#334556'] },
	2:{ dayTop:'#3b6fae', dayBot:'#b4d3ec', duskTop:'#ff6c36', duskBot:'#ffb778', nightTop:'#071320', nightBot:'#0a1928', mount:['#4a5f73','#3c4d5d','#2c3843'] }
};
// Stars only (cloud system removed per request) + slight color / size variance
const STAR_COUNT=140; const starsFar=[], starsNear=[]; const STAR_COLORS=['#ffffff','#ffdcb8','#cfe8ff','#ffeedd','#d5f2ff'];
function pickStarColor(){ const r=Math.random(); if(r<0.55) return STAR_COLORS[0]; if(r<0.70) return STAR_COLORS[1]; if(r<0.85) return STAR_COLORS[2]; if(r<0.93) return STAR_COLORS[3]; return STAR_COLORS[4]; }
function initStars(){
	for(let i=0;i<STAR_COUNT;i++){
		starsFar.push({x:Math.random(), y:Math.random(), r:Math.random()*1.05+0.25, a:Math.random()*0.5+0.35, c:pickStarColor()});
	}
	for(let i=0;i<STAR_COUNT*0.55;i++){
		starsNear.push({x:Math.random(), y:Math.random(), r:Math.random()*1.8+0.45, a:Math.random()*0.6+0.4, c:pickStarColor()});
	}
}
initStars();
// Removed updateClouds(); fully cleaned
// Mountain layer cache per biome/layer
const mountainCache=new Map();
function getMountainLayer(biome,layer){ const key=biome+'_'+layer; if(mountainCache.has(key)) return mountainCache.get(key); const pal=SKY_PALETTES[biome]||SKY_PALETTES[0]; const col=pal.mount[Math.min(layer,pal.mount.length-1)]; const c=document.createElement('canvas'); c.width=1600; c.height=300; const g=c.getContext('2d'); g.fillStyle=col; const peaks=12; const hBase= c.height*(0.25+0.18*layer); const amp= 80 + layer*40; g.beginPath(); g.moveTo(0,c.height); for(let i=0;i<=peaks;i++){ const x=i/peaks*c.width; const y=hBase - Math.sin(i*1.3 + biome*0.8)*(amp*0.35) - Math.random()*amp*0.2; g.lineTo(x,y); } g.lineTo(c.width,c.height); g.closePath(); g.fill(); mountainCache.set(key,c); return c; }
function lerp(a,b,t){ return a + (b-a)*t; }
function lerpColor(c1,c2,t){ const p1=parseInt(c1.slice(1),16); const p2=parseInt(c2.slice(1),16); const r=lerp((p1>>16)&255,(p2>>16)&255,t)|0; const g=lerp((p1>>8)&255,(p2>>8)&255,t)|0; const b=lerp(p1&255,p2&255,t)|0; return '#'+r.toString(16).padStart(2,'0')+g.toString(16).padStart(2,'0')+b.toString(16).padStart(2,'0'); }
function hexToRgba(hex,a){ const p=parseInt(hex.slice(1),16); const r=(p>>16)&255,g=(p>>8)&255,b=p&255; return `rgba(${r},${g},${b},${a})`; }
function skyGradientColors(biome,cycleT){ const pal=SKY_PALETTES[biome]||SKY_PALETTES[0]; // legacy helper (discrete) – still used for some fallbacks
	const dayFrac = DAY_FRAC; const nightFrac=NIGHT_DURATION/CYCLE_DURATION; // equal halves
	if(cycleT < dayFrac){ // day segment (0..dayFrac)
		const t=cycleT/dayFrac; // 0 sunrise -> 1 sunset
		const twilightBand=0.12; // fraction at each end
		if(t<twilightBand){ const k=t/twilightBand; return {top:lerpColor(pal.nightTop,pal.duskTop,k), bottom:lerpColor(pal.nightBot,pal.duskBot,k)}; }
		else if(t>1-twilightBand){ const k=(t-(1-twilightBand))/twilightBand; return {top:lerpColor(pal.duskTop,pal.nightTop,k), bottom:lerpColor(pal.duskBot,pal.nightBot,k)}; }
		else { return {top:pal.dayTop,bottom:pal.dayBot}; }
	} else { // night
		const t=(cycleT-dayFrac)/nightFrac; // 0..1
		// small dusk warm at start and pre-dawn warm at end handled in day branch so here keep night gradient w/ subtle breathing
		const breathe = 0.04*Math.sin(t*Math.PI*2*2); return {top:pal.nightTop, bottom:pal.nightBot, breathe}; }
}
// Smooth biome crossfade: blend palettes when underlying noise near thresholds
function smoothstep(a,b,x){ const t=Math.min(1,Math.max(0,(x-a)/(b-a))); return t*t*(3-2*t); }
function blendColor(c1,c2,t){ return lerpColor(c1,c2,t); }
function blendPalette(p1,p2,t){ if(!p2||t<=0) return p1; if(t>=1) return p2; return {
 dayTop:blendColor(p1.dayTop,p2.dayTop,t), dayBot:blendColor(p1.dayBot,p2.dayBot,t),
 duskTop:blendColor(p1.duskTop,p2.duskTop,t), duskBot:blendColor(p1.duskBot,p2.duskBot,t),
 nightTop:blendColor(p1.nightTop,p2.nightTop,t), nightBot:blendColor(p1.nightBot,p2.nightBot,t),
 mount:[0,1,2].map(i=>blendColor(p1.mount[i],p2.mount[i],t)) };
}
function computeBiomeBlend(x){ if(!WORLDGEN.valueNoise) return {pal:SKY_PALETTES[WORLDGEN.biomeType?WORLDGEN.biomeType(Math.floor(x)):0], a:0,b:0,t:0}; const v=WORLDGEN.valueNoise(x,220,900); const t1=0.35, t2=0.7, w=0.05; if(v < t1-w){ return {pal:SKY_PALETTES[0], a:0,b:0,t:0}; } if(v>t2+w){ return {pal:SKY_PALETTES[2], a:2,b:2,t:0}; } if(v>=t1-w && v<=t1+w){ const t=smoothstep(t1-w,t1+w,v); return {pal:blendPalette(SKY_PALETTES[0],SKY_PALETTES[1],t), a:0,b:1,t}; } if(v>=t2-w && v<=t2+w){ const t=smoothstep(t2-w,t2+w,v); return {pal:blendPalette(SKY_PALETTES[1],SKY_PALETTES[2],t), a:1,b:2,t}; } if(v<t2){ return {pal:SKY_PALETTES[1], a:1,b:1,t:0}; } return {pal:SKY_PALETTES[2], a:2,b:2,t:0}; }
function skyGradientFromPalette(pal,cycleT){
	// Continuous multi-key interpolation for seamless transitions.
	const dayFrac=DAY_FRAC; // 0.5
	const twilightBand=TWILIGHT_BAND; // base band for stars/cloud logic
	const extend = twilightBand*2; // extended transition width for color blending
	let top, bottom;
	if(cycleT < dayFrac){
		const t=cycleT/dayFrac; // 0 sunrise -> 1 sunset
		// Key frames within day segment
		const k0={t:0, top:pal.nightTop, bot:pal.nightBot};
		const k1={t:twilightBand, top:pal.duskTop, bot:pal.duskBot};
		const k2={t:Math.min(extend,0.45), top:pal.dayTop, bot:pal.dayBot};
		const k3={t:Math.max(1-extend,0.55), top:pal.dayTop, bot:pal.dayBot};
		const k4={t:1-twilightBand, top:pal.duskTop, bot:pal.duskBot};
		const k5={t:1, top:pal.nightTop, bot:pal.nightBot};
		const keys=[k0,k1,k2,k3,k4,k5];
		for(let i=0;i<keys.length-1;i++){
			const a=keys[i], b=keys[i+1];
			if(t>=a.t && t<=b.t){
				const span=b.t-a.t || 1; let u=(t-a.t)/span; // smoothstep for easing
				u=u*u*(3-2*u);
				top=lerpColor(a.top,b.top,u); bottom=lerpColor(a.bot,b.bot,u); break;
			}
		}
		if(!top){ top=pal.dayTop; bottom=pal.dayBot; }
		// Midday slight breathing to avoid static plateau
		const mid = Math.sin((t-0.5)*Math.PI*2)*0.015; // -1..1 -> subtle shift
			if(mid!==0){
				function mod(col,amt){ const p=parseInt(col.slice(1),16); let r=(p>>16)&255,g=(p>>8)&255,b=p&255; r=Math.round(Math.min(255,Math.max(0,r+amt*12))); g=Math.round(Math.min(255,Math.max(0,g+amt*10))); b=Math.round(Math.min(255,Math.max(0,b+amt*16))); return '#'+r.toString(16).padStart(2,'0')+g.toString(16).padStart(2,'0')+b.toString(16).padStart(2,'0'); }
			top=mod(top,mid); bottom=mod(bottom,mid*0.6);
		}
		return {top,bottom};
	} else {
		// Night half: fade from dusk->night (early), stable deep night (middle), night->dusk (late pre-dawn)
		const nt=(cycleT - dayFrac)/(1-dayFrac); // 0 start of night ->1 end
		const k0={t:0, top:pal.nightTop, bot:pal.nightBot}; // already at night after sunset
		const k1={t:0.25, top:pal.nightTop, bot:pal.nightBot};
		const k2={t:0.5, top:pal.nightTop, bot:pal.nightBot};
		const k3={t:0.75, top:pal.nightTop, bot:pal.nightBot};
		const k4={t:1, top:pal.nightTop, bot:pal.nightBot};
		const keys=[k0,k1,k2,k3,k4];
		for(let i=0;i<keys.length-1;i++){
			const a=keys[i], b=keys[i+1]; if(nt>=a.t && nt<=b.t){ const span=b.t-a.t||1; let u=(nt-a.t)/span; u=u*u*(3-2*u); top=lerpColor(a.top,b.top,u); bottom=lerpColor(a.bot,b.bot,u); break; }
		}
		if(!top){ top=pal.nightTop; bottom=pal.nightBot; }
		// Subtle breathing at night
		const breathe = Math.sin(nt*Math.PI*2)*0.04; function mod(col,amt){ const p=parseInt(col.slice(1),16); let r=(p>>16)&255,g=(p>>8)&255,b=p&255; r=Math.round(Math.min(255,Math.max(0,r+amt*10))); g=Math.round(Math.min(255,Math.max(0,g+amt*14))); b=Math.round(Math.min(255,Math.max(0,b+amt*20))); return '#'+r.toString(16).padStart(2,'0')+g.toString(16).padStart(2,'0')+b.toString(16).padStart(2,'0'); } top=mod(top,breathe); bottom=mod(bottom,breathe*0.5); return {top,bottom};
	}
}
let lastCycleInfo={cycleT:0,isDay:true,tDay:0,twilightBand:TWILIGHT_BAND}; let moonPhaseIndex=0, lastPhaseCycle=-1; const MOON_PHASES=8; // 0 new, 4 full
function drawBackground(){
	const now=performance.now();
	// Allow manual debug override of time-of-day if enabled
	const debugEnabled = window.__timeOverrideActive===true;
	const manualT = debugEnabled? (window.__timeOverrideValue||0): null;
	const rawCycleT = ((now-cycleStart)%CYCLE_DURATION)/CYCLE_DURATION;
	const cycleT = debugEnabled? manualT : rawCycleT;
	if(!debugEnabled && window.__timeSliderEl && !window.__timeSliderLocked){ // live reflect current time
	  window.__timeSliderEl.value = cycleT.toFixed(4);
	}
	const blend=computeBiomeBlend(player.x); const cols=skyGradientFromPalette(blend.pal,cycleT);
	// Sky gradient (full opaque to avoid trail / ghosting)
	ctx.save();
	ctx.globalAlpha=1; const grd=ctx.createLinearGradient(0,0,0,H); grd.addColorStop(0,cols.top); grd.addColorStop(1,cols.bottom); ctx.fillStyle=grd; ctx.fillRect(0,0,W,H);
	// Subtle low horizon haze band (behind mountains; adds depth). Warmer at sunrise/sunset, cooler at night.
	(function(){
		const dayFrac=DAY_FRAC; const isDay=cycleT<dayFrac; const tDay=isDay? (cycleT/dayFrac) : ((cycleT-dayFrac)/(1-dayFrac));
		let hueCol;
		if(isDay){ // blend between dusk warm and day bottom based on distance from twilight
			const twilight=0.12; const edge=Math.min(1, Math.min(tDay/twilight, (1-tDay)/twilight)); // 1 at midday, 0 near twilight edges
			// simple lerp between warm (#ffb070) near twilight and cooler day bottom color
			hueCol = lerpColor('#ffb070', blend.pal.dayBot, edge);
		} else {
			// Night: cool bluish with slight pulse
			const nt=(cycleT - dayFrac)/(1-dayFrac); const pulse = 0.4 + 0.6*Math.sin(nt*Math.PI*2);
			hueCol = lerpColor('#0b1d30', '#142b44', pulse*0.5);
		}
		const hazeTopY = H*0.52; const hazeBotY = H*0.80; // vertical span
		const g2 = ctx.createLinearGradient(0,hazeTopY,0,hazeBotY);
		g2.addColorStop(0, 'rgba(0,0,0,0)');
		g2.addColorStop(0.65, hexToRgba(hueCol, isDay?0.06:0.08));
		g2.addColorStop(1, hexToRgba(hueCol, isDay?0.12:0.16));
		ctx.fillStyle=g2; ctx.fillRect(0,hazeTopY,W,hazeBotY-hazeTopY);
	})();
	const dayFrac=DAY_FRAC; const isDay=cycleT<dayFrac; const tDay=isDay? (cycleT/dayFrac) : ((cycleT-dayFrac)/(1-dayFrac)); const twilightBand=TWILIGHT_BAND; lastCycleInfo={cycleT,isDay,tDay,twilightBand};
	// Stars first (placed behind sun/moon glow)
	// Smooth star fade using dual smoothstep edges instead of sharp piecewise
	function smoothEdge(x,band){ if(x<=0) return 0; if(x>=band) return 1; const n=x/band; return n*n*(3-2*n); }
	const smoothBand = twilightBand*1.4;
	const edgeIn = smoothEdge(tDay, smoothBand); // how far past sunrise transitions
	const edgeOut = smoothEdge(1 - tDay, smoothBand); // how far before sunset transitions
	let starAlpha = 1 - edgeIn*edgeOut; if(isDay) starAlpha *= 0.9; else starAlpha=1; // day reduces
	if(starAlpha>0.01){
		// Far layer (slower drift) — minimize fillStyle churn by grouping colors
		ctx.save(); const driftX = now*0.000005; const timeFar = now*0.0009; let lastC=null; const sinBaseFar = timeFar; starsFar.forEach(s=>{ const x = ((s.x + driftX) % 1)*W; const y=(s.y*0.55)*H; const tw=0.5+0.5*Math.sin(sinBaseFar + s.x*40); const a = starAlpha*0.85 * Math.min(1,(0.25+0.75*tw)*s.a); if(a>0.01){ if(s.c!==lastC){ ctx.fillStyle=s.c; lastC=s.c; } ctx.globalAlpha=a; ctx.fillRect(x,y,s.r,s.r); } }); ctx.restore();
		// Near layer (parallax & subtle vertical shimmer) — also color grouped
		ctx.save(); const pxFactor=(player.x*TILE*0.00008); const timeNear1=now*0.0013; const timeNear2=now*0.0006; let lastC2=null; const sinBaseNear1=timeNear1, sinBaseNear2=timeNear2; starsNear.forEach(s=>{ const x = ((s.x + pxFactor + now*0.00001) % 1)*W; const y=(s.y*0.5 + 0.02*Math.sin(sinBaseNear2 + s.x*60))*H; const tw=0.5+0.5*Math.sin(sinBaseNear1 + s.x*55); const a = starAlpha * Math.min(1,(0.35+0.65*tw)*s.a); if(a>0.01){ if(s.c!==lastC2){ ctx.fillStyle=s.c; lastC2=s.c; } ctx.globalAlpha=a; ctx.fillRect(x,y,s.r,s.r); } }); ctx.restore();
	}
	// Sun
	function drawBody(frac,radius,color,glowCol){ const ang=lerp(Math.PI*1.05, Math.PI*-0.05, frac); const cx=W*0.5 + Math.cos(ang)*W*0.45; const cy=H*0.82 + Math.sin(ang)*H*0.65; const grd2=ctx.createRadialGradient(cx,cy,radius*0.15,cx,cy,radius); grd2.addColorStop(0,glowCol); grd2.addColorStop(1,'rgba(0,0,0,0)'); ctx.fillStyle=grd2; ctx.beginPath(); ctx.arc(cx,cy,radius,0,Math.PI*2); ctx.fill(); ctx.fillStyle=color; ctx.beginPath(); ctx.arc(cx,cy,radius*0.55,0,Math.PI*2); ctx.fill(); }
	const dayCore = isDay && tDay>=twilightBand && tDay<=1-twilightBand; if(isDay){ const sunGlow=dayCore? 'rgba(255,255,255,0.55)':'rgba(255,180,120,0.55)'; drawBody(tDay, 140, '#fff8d2', sunGlow); }
	// Moon (discrete 8-phase cycle; advances each full day/night cycle)
	const currentCycleIndex = Math.floor((performance.now()-cycleStart)/CYCLE_DURATION);
	if(currentCycleIndex !== lastPhaseCycle){ lastPhaseCycle=currentCycleIndex; moonPhaseIndex = (moonPhaseIndex + 1) % MOON_PHASES; }
	const moonFrac=(cycleT+0.5)%1; const moonAlpha=isDay? 0.05:0.9; const mAng=lerp(Math.PI*1.15, Math.PI*-0.15, moonFrac); const mcx=W*0.5 + Math.cos(mAng)*W*0.48; const mcy=H*0.88 + Math.sin(mAng)*H*0.68; const mr=70; ctx.save(); ctx.globalAlpha=moonAlpha; ctx.fillStyle='rgba(255,255,255,0.65)'; ctx.beginPath(); ctx.arc(mcx,mcy,mr,0,Math.PI*2); ctx.fill(); // phase mask
	const phaseT = moonPhaseIndex / (MOON_PHASES-1); // 0 new .. 1 full
	ctx.globalCompositeOperation='destination-out'; if(moonPhaseIndex!==MOON_PHASES-1){ // cut crescent / gibbous
		const cut = (0.5 - phaseT/2); // shrink mask as phase grows
		ctx.beginPath(); const off = cut*mr*1.9; ctx.ellipse(mcx+off,mcy,mr*0.95,mr*1.05,0,0,Math.PI*2); ctx.fill(); if(moonPhaseIndex>0){ // two-sided for gibbous waxing/waning
			ctx.beginPath(); const off2 = (cut+0.15)*mr*1.2; ctx.ellipse(mcx-off2,mcy,mr*0.75,mr*0.95,0,0,Math.PI*2); ctx.fill(); }
	}
	ctx.restore();
	// Clouds removed – intentionally vacant gap for potential future atmospheric layers
	// Mountains (parallax) – if crossfading between two biomes draw both silhouette sets weighted
	const baseY=H*0.60; const heightAdjust=-H*0.12; ctx.save(); for(let layer=0; layer<3; layer++){ const par=0.12 + layer*0.10; const y=baseY + layer*90 + heightAdjust; const alphaBase=0.85 - layer*0.22; ctx.save(); const scrollA = -((player.x*TILE)*par) % 1600; // use cache width
		const imgA=getMountainLayer(blend.a,layer); ctx.globalAlpha=alphaBase * (blend.t>0? (1-blend.t):1); for(let k=-1;k<=1;k++){ ctx.drawImage(imgA, scrollA + k*imgA.width, y); }
		if(blend.t>0){ const imgB=getMountainLayer(blend.b,layer); const scrollB = scrollA; ctx.globalAlpha=alphaBase * blend.t; for(let k=-1;k<=1;k++){ ctx.drawImage(imgB, scrollB + k*imgB.width, y); } }
		ctx.restore(); }
	ctx.restore();
	ctx.restore(); // end background
}
function applyAtmosphericTint(){ if(!VISUAL.atmoTint) return; const info=lastCycleInfo; const dayFrac=DAY_FRAC; const twilight=info.twilightBand; let a=0, col='#000'; if(info.isDay){ // warm twilight glow only
	if(info.tDay<twilight){ a = (1 - (info.tDay/twilight)) * 0.10; col='#ff9a4a'; }
	else if(info.tDay>1-twilight){ a = ((info.tDay-(1-twilight))/twilight) * 0.10; col='#ff8240'; }
} else { // night cooling overlay
	const nightT = (info.cycleT - dayFrac)/(1-dayFrac); // 0..1
	a = 0.12 + 0.13 * Math.sin(nightT*Math.PI); // peak near midnight
	col = '#061425';
}
if(a>0.001){ ctx.save(); ctx.globalAlpha=a; ctx.fillStyle=col; ctx.fillRect(0,0,W,H); ctx.restore(); } }
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
const player={x:0,y:0,w:0.7,h:0.95,vx:0,vy:0,onGround:false,facing:1,tool:'basic',jumpCount:0,maxHp:100,hp:100,hpInvul:0,atkCd:0,xp:0};
// Expose player globally so mobs module (loaded separately) can reference and damage the player
window.player = player;
// Global customization state comes from customization.js (advanced system)
window.MM = window.MM || {};
const DEFAULT_CUST={ capeStyle:'classic', capeColor:'#b91818', eyeStyle:'bright', outfitStyle:'default', outfitColor:'#f4c05a' };
MM.customization = Object.assign({}, DEFAULT_CUST, MM.customization||{});
MM.activeModifiers = MM.activeModifiers || {}; // ensure present
window.addEventListener('mm-customization-change',()=>{
	// customization.js already recomputed MM.activeModifiers.
	// Adjust vision immediately.
	revealAround();
	// Clamp jumpCount if cape downgraded mid‑air.
	const maxAir = (MM.activeModifiers && typeof MM.activeModifiers.maxAirJumps==='number')? MM.activeModifiers.maxAirJumps : 0;
	const totalAllowed = 1 + maxAir;
	if(player.jumpCount > totalAllowed) player.jumpCount = totalAllowed;
});
// If customization script already provided computeActiveModifiers, call it indirectly by dispatching a synthetic event if empty.
if(!('maxAirJumps' in MM.activeModifiers) || !('visionRadius' in MM.activeModifiers)){
	// Attempt to trigger computation (customization.js runs its own compute on load)
	if(typeof MM.activeModifiers !== 'object') MM.activeModifiers={};
}
const tools={basic:1,stone:2,diamond:4};
// Inventory counts for placeable tiles
const inv={grass:0,sand:0,stone:0,diamond:0,wood:0,leaf:0,snow:0,water:0,tools:{stone:false,diamond:false}};
// Expose inventory for cross-module loot insertion
window.inv = inv;
// Hotbar (slots triggered by keys 4..9)
// HOTBAR_ORDER now mutable and can include CHEST_* pseudo entries (only placeable in god mode)
const HOTBAR_ORDER=['GRASS','SAND','STONE','WOOD','LEAF','SNOW','WATER'];
let hotbarIndex=0; // 0..length-1
function selectedTileId(){ const name=HOTBAR_ORDER[hotbarIndex]; return T[name]; }
function isChestSelection(name){ return name==='CHEST_COMMON'||name==='CHEST_RARE'||name==='CHEST_EPIC'; }
function cycleHotbar(idx){ if(idx<0||idx>=HOTBAR_ORDER.length) return; hotbarIndex=idx; updateHotbarSel(); saveState(); }
// Persistence key
// --- Persistent Save System (expanded from simple inventory save) ---
// Versioned schema to allow future migrations
// NOTE: Schema v4 introduces mobs + hp persistence. Promote storage key to v4.
const SAVE_KEY='mm_save_v4';
const OLD_SAVE_KEYS=['mm_save_v3','mm_save_v2'];
// We keep old key for one-time migration
const LEGACY_INV_KEY='mm_inv_v1';
// --- Compression helpers (RLE + base64) ---
function _b64FromBytes(bytes){ let bin=''; for(let i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]); return btoa(bin); }
function _bytesFromB64(b64){ const bin=atob(b64); const out=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i); return out; }
function encodeRLE(arr){ const out=[]; for(let i=0;i<arr.length;){ const v=arr[i]; let run=1; while(i+run<arr.length && arr[i+run]===v && run<65535) run++; let remain=run; while(remain>0){ const take=Math.min(255,remain); out.push(v,take); remain-=take; } i+=run; } return _b64FromBytes(Uint8Array.from(out)); }
function decodeRLE(b64,totalLen){ const bytes=_bytesFromB64(b64); const out=new Uint8Array(totalLen); let oi=0; for(let i=0;i<bytes.length; i+=2){ const v=bytes[i]; const count=bytes[i+1]; for(let r=0;r<count;r++) out[oi++]=v; } return out; }
function encodeRaw(arr){ return _b64FromBytes(arr); }
function decodeRaw(b64){ return _bytesFromB64(b64); }
// --- Integrity helpers (stable stringify + FNV1a hash) ---
// --- Asynchronous JSON Processing System ---
const ASYNC_JSON_PROCESSOR = {
	worker: null,
	processingQueue: new Map(), // id -> {resolve, reject, operation}
	nextId: 1,
	
	// Threshold for async processing (15KB+ operations use worker)
	ASYNC_THRESHOLD: 15 * 1024,
	
	// Initialize the JSON worker
	init() {
		if (this.worker) return;
		
		try {
			// Create worker inline for JSON processing
			const workerCode = `
				self.onmessage = function(e) {
					const { id, operation, data } = e.data;
					
					try {
						let result;
						
						if (operation === 'stringify') {
							result = JSON.stringify(data);
						} else if (operation === 'parse') {
							result = JSON.parse(data);
						} else if (operation === 'stableStringify') {
							function stableStringify(v) {
								if (v === null || typeof v !== 'object') return JSON.stringify(v);
								if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
								const keys = Object.keys(v).sort();
								return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
							}
							result = stableStringify(data);
						} else {
							throw new Error('Unknown operation: ' + operation);
						}
						
						self.postMessage({ id, success: true, result });
					} catch (error) {
						self.postMessage({ id, success: false, error: error.message });
					}
				};
			`;
			
			const blob = new Blob([workerCode], { type: 'application/javascript' });
			this.worker = new Worker(URL.createObjectURL(blob));
			
			this.worker.onmessage = (e) => {
				const { id, success, result, error } = e.data;
				const pending = this.processingQueue.get(id);
				
				if (pending) {
					this.processingQueue.delete(id);
					if (success) {
						pending.resolve(result);
					} else {
						pending.reject(new Error(error));
					}
				}
			};
			
			this.worker.onerror = (error) => {
				console.warn('JSON Worker error:', error);
				// Fallback to synchronous processing for pending operations
				for (const [id, pending] of this.processingQueue) {
					pending.reject(new Error('Worker failed'));
				}
				this.processingQueue.clear();
				this.worker = null;
			};
			
		} catch (e) {
			console.warn('Failed to create JSON worker, using synchronous processing:', e);
			this.worker = null;
		}
	},
	
	// Async JSON.stringify with automatic worker decision
	async stringify(data) {
		const estimated = this.estimateSize(data);
		
		if (estimated < this.ASYNC_THRESHOLD || !this.worker) {
			// Use synchronous for small data
			return JSON.stringify(data);
		}
		
		// Use worker for large data
		return this.processWithWorker('stringify', data);
	},
	
	// Async JSON.parse with automatic worker decision
	async parse(jsonString) {
		if (jsonString.length < this.ASYNC_THRESHOLD || !this.worker) {
			// Use synchronous for small strings
			return JSON.parse(jsonString);
		}
		
		// Use worker for large strings
		return this.processWithWorker('parse', jsonString);
	},
	
	// Async stable stringify
	async stableStringify(data) {
		const estimated = this.estimateSize(data);
		
		if (estimated < this.ASYNC_THRESHOLD || !this.worker) {
			// Use synchronous for small data
			return this.stableStringifySync(data);
		}
		
		// Use worker for large data
		return this.processWithWorker('stableStringify', data);
	},
	
	// Process operation with worker
	processWithWorker(operation, data) {
		return new Promise((resolve, reject) => {
			const id = this.nextId++;
			this.processingQueue.set(id, { resolve, reject, operation });
			
			// Set timeout for worker operations
			setTimeout(() => {
				if (this.processingQueue.has(id)) {
					this.processingQueue.delete(id);
					reject(new Error('JSON processing timeout'));
				}
			}, 10000); // 10 second timeout
			
			this.worker.postMessage({ id, operation, data });
		});
	},
	
	// Synchronous fallback for stable stringify
	stableStringifySync(v) {
		if (v === null || typeof v !== 'object') return JSON.stringify(v);
		if (Array.isArray(v)) return '[' + v.map(this.stableStringifySync.bind(this)).join(',') + ']';
		const keys = Object.keys(v).sort();
		return '{' + keys.map(k => JSON.stringify(k) + ':' + this.stableStringifySync(v[k])).join(',') + '}';
	},
	
	// Estimate data size for async decision
	estimateSize(data) {
		if (typeof data === 'string') return data.length;
		
		// Quick estimation based on object structure
		let estimate = 0;
		
		function estimateRecursive(obj, depth = 0) {
			if (depth > 10) return 100; // Prevent deep recursion
			
			if (obj === null || obj === undefined) return 4;
			if (typeof obj === 'boolean') return 5;
			if (typeof obj === 'number') return 10;
			if (typeof obj === 'string') return obj.length + 2;
			
			if (Array.isArray(obj)) {
				return 2 + obj.slice(0, 100).reduce((sum, item) => sum + estimateRecursive(item, depth + 1), 0);
			}
			
			if (typeof obj === 'object') {
				const keys = Object.keys(obj).slice(0, 100);
				return 2 + keys.reduce((sum, key) => {
					return sum + key.length + 3 + estimateRecursive(obj[key], depth + 1);
				}, 0);
			}
			
			return 10;
		}
		
		return estimateRecursive(data);
	},
	
	// Cleanup worker
	cleanup() {
		if (this.worker) {
			this.worker.terminate();
			this.worker = null;
		}
		this.processingQueue.clear();
	}
};

// Initialize the async JSON processor
ASYNC_JSON_PROCESSOR.init();

// Add cleanup to timer manager
const originalCleanup = TIMER_MANAGER.cleanup;
TIMER_MANAGER.cleanup = function() {
	originalCleanup.call(this);
	ASYNC_JSON_PROCESSOR.cleanup();
};

// --- Updated synchronous functions to maintain compatibility ---
function stableStringify(v){ 
	return ASYNC_JSON_PROCESSOR.stableStringifySync(v);
}
function computeHash(str){ // FNV-1a 32-bit
 let h=0x811c9dc5; for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h = (h>>>0) * 0x01000193; h>>>0; } return ('00000000'+(h>>>0).toString(16)).slice(-8); }
function attachHash(obj){ const clone=JSON.parse(JSON.stringify(obj)); const core=stableStringify(clone); const hash=computeHash(core); clone.h=hash; return {object:clone, hash}; }
function verifyHash(obj){ if(!obj || typeof obj!=='object' || !obj.h) return {ok:true, reason:!obj?'no-object':'no-hash'}; const h=obj.h; const tmp=Object.assign({}, obj); delete tmp.h; const core=stableStringify(tmp); const calc=computeHash(core); return {ok: h===calc, expected: h, got: calc}; }
function gatherModifiedChunks(){ const out=[]; const worldMap=WORLD._world; if(!worldMap) return out; for(const [k,arr] of worldMap.entries()){ const cx=parseInt(k.slice(1)); const ver=WORLD._versions.get(k)||0; if(ver===0) continue; out.push({cx,data:encodeRLE(arr),rle:true}); } return out; }
function restoreModifiedChunks(list){ if(!Array.isArray(list)) return; for(const ch of list){ if(typeof ch.cx!=='number'||!ch.data) continue; const arr = ch.rle? decodeRLE(ch.data, CHUNK_W*WORLD_H): decodeRaw(ch.data); WORLD._world.set('c'+ch.cx, arr); WORLD._versions.set('c'+ch.cx,1); } }
function exportSeen(){ const out=[]; for(const [cx,buf] of seenChunks.entries()){ out.push({cx,data:encodeRLE(buf),rle:true}); } return out; }
function importSeen(list){ if(!Array.isArray(list)) return; seenChunks.clear(); for(const row of list){ if(typeof row.cx!=='number'||!row.data) continue; const arr=row.rle? decodeRLE(row.data, SEEN_BYTES): decodeRaw(row.data); seenChunks.set(row.cx, arr); } }
function exportWater(){ if(MM.water && MM.water.snapshot) return MM.water.snapshot(); }
function exportFalling(){ if(MM.fallingSolids && MM.fallingSolids.snapshot) return MM.fallingSolids.snapshot(); }
function importWater(s){ if(MM.water && MM.water.restore) MM.water.restore(s); }
function importFalling(s){ if(MM.fallingSolids && MM.fallingSolids.restore) MM.fallingSolids.restore(s); }
function exportPlayer(){ return {x:player.x,y:player.y,vx:player.vx||0,vy:player.vy||0,tool:player.tool,facing:player.facing||1,jumps:player.jumps||0,hp:player.hp,maxHp:player.maxHp,xp:player.xp||0}; }
function importPlayer(p){ if(!p) return; if(typeof p.x==='number') player.x=p.x; if(typeof p.y==='number') player.y=p.y; if(typeof p.vx==='number') player.vx=p.vx; if(typeof p.vy==='number') player.vy=p.vy; if(['basic','stone','diamond'].includes(p.tool)) player.tool=p.tool; if(p.facing===1||p.facing===-1) player.facing=p.facing; if(typeof p.jumps==='number') player.jumps=p.jumps; if(typeof p.maxHp==='number' && p.maxHp>0) player.maxHp=p.maxHp|0; if(typeof p.hp==='number') player.hp=Math.max(0,Math.min(player.maxHp,p.hp)); if(typeof p.xp==='number') player.xp=p.xp|0; }
function exportCamera(){ return {camX,camY,zoom:zoomTarget}; }
function importCamera(c){ if(!c) return; if(typeof c.camX==='number') camX=camSX=c.camX; if(typeof c.camY==='number') camY=camSY=c.camY; if(typeof c.zoom==='number'){ zoom=zoomTarget=Math.min(4,Math.max(0.25,c.zoom)); } }
function exportInventory(){ return JSON.parse(JSON.stringify(inv)); }
function importInventory(src){ if(!src) return; for(const k in inv){ if(k==='tools') continue; if(typeof src[k]==='number') inv[k]=src[k]; }
	if(src.tools){ inv.tools.stone=!!src.tools.stone; inv.tools.diamond=!!src.tools.diamond; }
}
function exportHotbar(){ return {order:[...HOTBAR_ORDER], index:hotbarIndex}; }
function importHotbar(h){ if(!h) return; if(Array.isArray(h.order) && h.order.length===HOTBAR_ORDER.length){ for(let i=0;i<HOTBAR_ORDER.length;i++){ if(typeof h.order[i]==='string') HOTBAR_ORDER[i]=h.order[i]; } }
	if(typeof h.index==='number') hotbarIndex=Math.min(HOTBAR_ORDER.length-1, Math.max(0,h.index)); }
function exportTime(){ // store absolute cycle fraction + moon phase index + cycle start ref shift
	const now=performance.now(); const cycleT=((now-cycleStart)%CYCLE_DURATION)/CYCLE_DURATION; return {cycleT, moonPhaseIndex, lastPhaseCycle}; }
function importTime(t){ if(!t) return; if(typeof t.cycleT==='number'){ const now=performance.now(); cycleStart = now - t.cycleT*CYCLE_DURATION; }
	if(typeof t.moonPhaseIndex==='number') moonPhaseIndex=t.moonPhaseIndex%8; if(typeof t.lastPhaseCycle==='number') lastPhaseCycle=t.lastPhaseCycle; }
function exportCustomization(){ return MM && MM.customization ? JSON.parse(JSON.stringify(MM.customization)):null; }
function importCustomization(c){ if(!c||!MM||!MM.customization) return; // merge only known keys
	['capeStyle','eyeStyle','outfitStyle','unlocked','dynamicLoot','discarded'].forEach(k=>{ if(c[k]!=null) MM.customization[k]=c[k]; }); if(MM.computeActiveModifiers) MM.activeModifiers=MM.computeActiveModifiers(MM.customization); if(window.updateDynamicCustomization) updateDynamicCustomization(); }
function exportGod(){ return {godMode, revealAll}; }
function importGod(g){ if(!g) return; if(typeof g.godMode==='boolean'){ godMode=g.godMode; updateGodBtn(); } if(typeof g.revealAll==='boolean') revealAll=g.revealAll; }
function exportLootInbox(){ if(!window.lootInbox) return null; const unread=(window.updateLootInboxIndicator && document.getElementById('lootInboxCount'))? (parseInt(document.getElementById('lootInboxCount').textContent)||0):0; return {items:window.lootInbox, unread}; }
function importLootInbox(data){ if(!data||!window.lootInbox) return; if(Array.isArray(data.items)) window.lootInbox=data.items; if(typeof data.unread==='number'){ // set indicator
		if(window.updateLootInboxIndicator){ // hack: store unread count in closure variable by simulating save
			// direct localStorage already handled by existing system, so just trigger indicator update afterwards
			// (we can't easily set internal variable; rely on existing load in that system)
		}
	} if(window.updateLootInboxIndicator) updateLootInboxIndicator(); }
function buildSaveObject(){ // v4: mobs serialization now stores relative aggro timers (see mobs.js)
 return {
	v:4,
	seed: WORLDGEN.worldSeed,
	world:{ modified: gatherModifiedChunks() },
	player: exportPlayer(),
	camera: exportCamera(),
	inv: exportInventory(),
	hotbar: exportHotbar(),
	time: exportTime(),
	seen: exportSeen(),
	customization: exportCustomization(),
	god: exportGod(),
	lootInbox: exportLootInbox(),
	mobs: (MM.mobs && MM.mobs.serialize)? MM.mobs.serialize(): null,
	systems:{ water:exportWater(), falling:exportFalling() },
	savedAt: Date.now()
}; }
// --- Storage Quota Management System ---
const STORAGE_QUOTA_MANAGER = {
	// Estimated 5MB localStorage limit (conservative for cross-browser compatibility)
	ESTIMATED_QUOTA: 5 * 1024 * 1024,
	WARNING_THRESHOLD: 0.80, // 80% usage warning
	CRITICAL_THRESHOLD: 0.90, // 90% usage critical
	AUTO_CLEANUP_THRESHOLD: 0.85, // 85% triggers auto-cleanup
	
	// Get current storage usage for mm_ prefixed keys
	getCurrentUsage() {
		let used = 0;
		try {
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i);
				if (key && key.startsWith('mm_')) {
					const value = localStorage.getItem(key);
					if (value) used += key.length + value.length;
				}
			}
		} catch (e) {
			console.warn('Storage usage calculation failed:', e);
		}
		return used;
	},
	
	// Get usage percentage
	getUsagePercent() {
		return this.getCurrentUsage() / this.ESTIMATED_QUOTA;
	},
	
	// Check if storage operation is likely to succeed
	canStore(additionalBytes) {
		const current = this.getCurrentUsage();
		const projected = (current + additionalBytes) / this.ESTIMATED_QUOTA;
		return projected < this.CRITICAL_THRESHOLD;
	},
	
	// Attempt to free space by removing old saves
	freeSpace(targetBytes = 0) {
		const slots = this.loadSlots();
		if (!slots.length) return false;
		
		// Sort by time (oldest first), exclude current slot
		const oldSlots = slots
			.filter(s => s.id !== currentSlotId)
			.sort((a, b) => a.time - b.time);
		
		let freedBytes = 0;
		const removed = [];
		
		for (const slot of oldSlots) {
			if (targetBytes > 0 && freedBytes >= targetBytes) break;
			
			try {
				const slotData = localStorage.getItem(this.slotKey(slot.id));
				if (slotData) {
					localStorage.removeItem(this.slotKey(slot.id));
					freedBytes += this.slotKey(slot.id).length + slotData.length;
					removed.push(slot.name || slot.id);
				}
				
				// Remove from slots list
				const index = slots.indexOf(slot);
				if (index >= 0) slots.splice(index, 1);
			} catch (e) {
				console.warn('Failed to remove slot:', slot.id, e);
			}
		}
		
		if (removed.length > 0) {
			this.storeSlots(slots);
			console.log('Auto-cleanup: Removed', removed.length, 'old saves:', removed);
			return true;
		}
		
		return false;
	},
	
	// Safe localStorage.setItem with quota management
	safeSetItem(key, value, options = {}) {
		const { isAutoSave = false, allowCleanup = true } = options;
		const dataSize = key.length + value.length;
		
		// Check if operation likely to succeed
		if (!this.canStore(dataSize)) {
			if (allowCleanup) {
				// Attempt cleanup
				const cleaned = this.freeSpace(dataSize * 2); // Free 2x the needed space for buffer
				if (!cleaned && !isAutoSave) {
					throw new Error('QUOTA_EXCEEDED_NO_CLEANUP');
				}
			} else if (!isAutoSave) {
				throw new Error('QUOTA_EXCEEDED');
			}
		}
		
		try {
			localStorage.setItem(key, value);
			return true;
		} catch (e) {
			// Handle specific quota exceeded errors
			if (e.name === 'QuotaExceededError' || e.code === 22) {
				if (allowCleanup && !isAutoSave) {
					// Try emergency cleanup
					this.freeSpace(dataSize * 3);
					try {
						localStorage.setItem(key, value);
						return true;
					} catch (e2) {
						throw new Error('QUOTA_EXCEEDED_AFTER_CLEANUP');
					}
				}
				throw new Error('QUOTA_EXCEEDED');
			}
			throw e;
		}
	},
	
	// Helper methods to access slot management functions
	loadSlots() {
		try {
			const raw = localStorage.getItem(SAVE_LIST_KEY);
			if (!raw) return [];
			const arr = JSON.parse(raw);
			return Array.isArray(arr) ? arr : [];
		} catch (e) {
			return [];
		}
	},
	
	storeSlots(slots) {
		try {
			this.safeSetItem(SAVE_LIST_KEY, JSON.stringify(slots), { allowCleanup: false });
		} catch (e) {
			console.warn('Failed to store slots list:', e);
		}
	},
	
	slotKey(id) {
		return 'mm_slot_' + id;
	}
};

async function saveGame(manual){ 
	try{ 
		const data = buildSaveObject(); 
		
		// Show processing indicator for manual saves
		if (manual) {
			msg('Przetwarzanie zapisu...');
		}
		
		// Use async processing for hash attachment and stringification
		const withHashPromise = attachHashAsync(data);
		const {object: withHash} = await withHashPromise;
		const json = await ASYNC_JSON_PROCESSOR.stringify(withHash);
		
		// Use quota-aware storage for manual saves, allow cleanup for auto-saves
		STORAGE_QUOTA_MANAGER.safeSetItem(SAVE_KEY, json, { 
			isAutoSave: !manual, 
			allowCleanup: true 
		});
		
		if(manual){ 
			const mods = (data.world && data.world.modified) ? data.world.modified.length : 0; 
			const usage = STORAGE_QUOTA_MANAGER.getUsagePercent();
			const usageText = usage > STORAGE_QUOTA_MANAGER.WARNING_THRESHOLD ? 
				` [${(usage * 100).toFixed(0)}% storage]` : '';
			msg('Zapisano (' + ((json.length/1024)|0) + ' KB, modyf.chunks:' + mods + ')' + usageText); 
		} 
	} catch(e) { 
		console.warn('Save failed', e);
		
		// Provide user-friendly error messages
		if (manual) {
			if (e.message === 'QUOTA_EXCEEDED') {
				msg('Błąd: Brak miejsca w storage. Usuń stare zapisy.');
			} else if (e.message === 'QUOTA_EXCEEDED_NO_CLEANUP') {
				msg('Błąd: Storage pełny, brak zapisów do usunięcia.');
			} else if (e.message === 'QUOTA_EXCEEDED_AFTER_CLEANUP') {
				msg('Błąd: Storage nadal pełny mimo oczyszczenia.');
			} else if (e.message === 'JSON processing timeout') {
				msg('Błąd: Timeout podczas przetwarzania danych.');
			} else {
				msg('Błąd zapisu: ' + (e.message || 'Nieznany'));
			}
		}
	} 
}

// Async version of attachHash
async function attachHashAsync(obj) {
	const cloneJson = await ASYNC_JSON_PROCESSOR.stringify(obj);
	const clone = await ASYNC_JSON_PROCESSOR.parse(cloneJson);
	const core = await ASYNC_JSON_PROCESSOR.stableStringify(clone);
	const hash = computeHash(core);
	clone.h = hash;
	return {object: clone, hash};
}

// Lightweight autosave indicator (created lazily)
function showAutoSaveHint(sizeKB){ 
	try{ 
		let el = document.getElementById('autoSaveHint'); 
		if(!el){ 
			el = document.createElement('div'); 
			el.id = 'autoSaveHint'; 
			el.style.cssText = 'position:fixed; left:8px; bottom:8px; background:rgba(0,0,0,0.55); color:#fff; font:11px system-ui; padding:4px 8px; border-radius:6px; pointer-events:none; opacity:0; transition:opacity .4s; z-index:5000;'; 
			document.body.appendChild(el); 
		}
		
		const now = new Date(); 
		const t = now.toLocaleTimeString(); 
		const usage = STORAGE_QUOTA_MANAGER.getUsagePercent();
		let storageWarning = '';
		
		// Add storage warnings to autosave hint
		if (usage > STORAGE_QUOTA_MANAGER.CRITICAL_THRESHOLD) {
			storageWarning = ' ⚠️ STORAGE KRYTYCZNY';
		} else if (usage > STORAGE_QUOTA_MANAGER.WARNING_THRESHOLD) {
			storageWarning = ' ⚠️ Storage: ' + (usage * 100).toFixed(0) + '%';
		}
		
		el.textContent = 'Auto-zapis ' + t + ' (' + sizeKB + ' KB)' + storageWarning; 
		el.style.opacity = '1'; 
		
		// Keep warning visible longer if storage is critical
		const hideDelay = usage > STORAGE_QUOTA_MANAGER.WARNING_THRESHOLD ? 5000 : 2800;
		
		// Use managed timeout for autosave hint
		if (showAutoSaveHint._managedId) {
			TIMER_MANAGER.clearTimeout(showAutoSaveHint._managedId);
		}
		showAutoSaveHint._managedId = TIMER_MANAGER.setTimeout(() => { 
			el.style.opacity = '0'; 
		}, hideDelay, 'autosave_hint'); 
	} catch(e) {} 
}
// Monkey-patch original saveGame to attach autosave hints (wrap)
const _origSaveGame = saveGame; saveGame = function(manual){ const before=performance.now(); _origSaveGame(manual); if(!manual){ try{ const raw=localStorage.getItem(SAVE_KEY); if(raw) showAutoSaveHint((raw.length/1024)|0); }catch(e){} } };
async function loadGame(){ try{ let raw=localStorage.getItem(SAVE_KEY); if(!raw){ for(const k of OLD_SAVE_KEYS){ raw=localStorage.getItem(k); if(raw) break; } }
	if(!raw){ const leg=localStorage.getItem(LEGACY_INV_KEY); if(leg){ try{ const li=await ASYNC_JSON_PROCESSOR.parse(leg); if(li){ importInventory(li.inv); if(li.tool) player.tool=li.tool; if(typeof li.hotbarIndex==='number') hotbarIndex=li.hotbarIndex; } }catch(e){} } return false; }
	const data=await ASYNC_JSON_PROCESSOR.parse(raw); if(!data|| typeof data!=='object') return false; const hashInfo=verifyHash(data); if(!hashInfo.ok){ msg('UWAGA: uszkodzony zapis (hash)'); console.warn('Hash mismatch',hashInfo); }
	const ver=data.v||2; // proceed even if hash mismatch
	if(data.seed!=null && data.seed!==WORLDGEN.worldSeed){ if(WORLDGEN.setSeedFromInput){ WORLDGEN.worldSeed=data.seed; if(WORLD.clearHeights) WORLD.clearHeights(); } WORLD.clear(); }
	if(data.world && Array.isArray(data.world.modified)) restoreModifiedChunks(data.world.modified);
	importPlayer(data.player);
	if(ver>=3 && data.camera) importCamera(data.camera); else if(data.camera) importCamera(data.camera); // camera existed in v2 here already
	importInventory(data.inv);
	importHotbar(data.hotbar);
	importTime(data.time);
	importSeen(data.seen);
	importCustomization(data.customization);
	importGod(data.god);
	importLootInbox(data.lootInbox);
	if(ver>=4 && data.mobs && MM.mobs && MM.mobs.deserialize) MM.mobs.deserialize(data.mobs);
	if(data.systems){ importWater(data.systems.water); importFalling(data.systems.falling); }
	updateInventory(); updateHotbarSel();
	if(data.player && typeof data.player.x==='number' && typeof data.player.y==='number') { centerOnPlayer(); } else { placePlayer(true); }
	return true;
}catch(e){ console.warn('Load failed',e); return false; }}
// --- Timer and Resource Management System ---
const TIMER_MANAGER = {
	intervals: new Map(), // id -> {intervalId, callback, delay, active}
	timeouts: new Map(),  // id -> {timeoutId, callback, delay, startTime, active}
	animationFrame: null,
	isGamePaused: false,
	isPageVisible: true,
	
	// Register a managed interval
	setInterval(callback, delay, id = null) {
		const managedId = id || 'interval_' + Date.now() + '_' + Math.random().toString(36).slice(2);
		
		// Clear existing if re-registering
		if (this.intervals.has(managedId)) {
			this.clearInterval(managedId);
		}
		
		const intervalId = setInterval(() => {
			if (!this.isGamePaused && this.isPageVisible) {
				callback();
			}
		}, delay);
		
		this.intervals.set(managedId, {
			intervalId,
			callback,
			delay,
			active: true
		});
		
		return managedId;
	},
	
	// Register a managed timeout
	setTimeout(callback, delay, id = null) {
		const managedId = id || 'timeout_' + Date.now() + '_' + Math.random().toString(36).slice(2);
		
		// Clear existing if re-registering
		if (this.timeouts.has(managedId)) {
			this.clearTimeout(managedId);
		}
		
		const timeoutId = setTimeout(() => {
			if (!this.isGamePaused && this.isPageVisible) {
				callback();
			}
			this.timeouts.delete(managedId);
		}, delay);
		
		this.timeouts.set(managedId, {
			timeoutId,
			callback,
			delay,
			startTime: performance.now(),
			active: true
		});
		
		return managedId;
	},
	
	// Clear managed interval
	clearInterval(id) {
		const entry = this.intervals.get(id);
		if (entry) {
			clearInterval(entry.intervalId);
			this.intervals.delete(id);
		}
	},
	
	// Clear managed timeout
	clearTimeout(id) {
		const entry = this.timeouts.get(id);
		if (entry) {
			clearTimeout(entry.timeoutId);
			this.timeouts.delete(id);
		}
	},
	
	// Pause all managed timers
	pauseAll() {
		this.isGamePaused = true;
		console.log('Timer Manager: Paused all timers');
	},
	
	// Resume all managed timers
	resumeAll() {
		this.isGamePaused = false;
		console.log('Timer Manager: Resumed all timers');
	},
	
	// Handle page visibility changes
	handleVisibilityChange() {
		this.isPageVisible = !document.hidden;
		
		if (this.isPageVisible) {
			console.log('Timer Manager: Page visible - timers active');
		} else {
			console.log('Timer Manager: Page hidden - timers paused');
		}
	},
	
	// Clean up all timers (for shutdown/cleanup)
	cleanup() {
		// Clear all intervals
		for (const [id, entry] of this.intervals) {
			clearInterval(entry.intervalId);
		}
		this.intervals.clear();
		
		// Clear all timeouts
		for (const [id, entry] of this.timeouts) {
			clearTimeout(entry.timeoutId);
		}
		this.timeouts.clear();
		
		// Cancel animation frame
		if (this.animationFrame) {
			cancelAnimationFrame(this.animationFrame);
			this.animationFrame = null;
		}
		
		console.log('Timer Manager: All timers cleaned up');
	},
	
	// Get diagnostics
	getDiagnostics() {
		return {
			activeIntervals: this.intervals.size,
			activeTimeouts: this.timeouts.size,
			isPaused: this.isGamePaused,
			isVisible: this.isPageVisible,
			intervals: Array.from(this.intervals.keys()),
			timeouts: Array.from(this.timeouts.keys())
		};
	}
};

// Set up page visibility monitoring
document.addEventListener('visibilitychange', () => {
	TIMER_MANAGER.handleVisibilityChange();
});

// Set up beforeunload cleanup
window.addEventListener('beforeunload', () => {
	TIMER_MANAGER.cleanup();
});

// Expose timer manager for debugging
window.__timerManager = TIMER_MANAGER;

// Add manual pause/resume controls for debugging or performance tuning
window.__pauseGame = () => {
	TIMER_MANAGER.pauseAll();
	console.log('Game manually paused');
};

window.__resumeGame = () => {
	TIMER_MANAGER.resumeAll();
	console.log('Game manually resumed');
};

window.__getTimerDiagnostics = () => {
	const diag = TIMER_MANAGER.getDiagnostics();
	console.log('Timer Diagnostics:', diag);
	return diag;
};
// Expose manual save/load via menu buttons (injected later if menu exists)
window.__injectSaveButtons = function(){ const menuPanel=document.getElementById('menuPanel'); if(!menuPanel || document.getElementById('saveGameBtn')) return; const group=document.createElement('div'); group.className='group'; group.style.cssText='display:flex; flex-direction:column; gap:6px;';
	const row=document.createElement('div'); row.style.cssText='display:flex; gap:6px; flex-wrap:wrap;';
	// Added 'Continue' quick-resume button and Export/Import later
	const continueBtn=document.createElement('button'); continueBtn.id='continueBtn'; continueBtn.textContent='Kontynuuj'; continueBtn.style.minWidth='92px'; continueBtn.style.flex='1';
	const saveBtn=document.createElement('button'); saveBtn.id='saveGameBtn'; saveBtn.textContent='Zapisz';
	const loadBtn=document.createElement('button'); loadBtn.id='loadGameBtn'; loadBtn.textContent='Wczytaj';
	const saveAsBtn=document.createElement('button'); saveAsBtn.id='saveAsBtn'; saveAsBtn.textContent='Zapisz jako';
	[continueBtn,saveBtn,loadBtn,saveAsBtn].forEach(b=>{ b.style.minWidth='72px'; b.style.flex='1'; });
	row.appendChild(continueBtn); row.appendChild(saveBtn); row.appendChild(loadBtn); row.appendChild(saveAsBtn); group.appendChild(row);
	// Save browser
	const browser=document.createElement('div'); browser.id='saveBrowser'; browser.style.cssText='display:none; flex-direction:column; gap:4px; background:rgba(0,0,0,0.35); padding:8px; border:1px solid rgba(255,255,255,0.1); border-radius:8px; max-height:220px; overflow:auto;';
	const browserHeader=document.createElement('div'); browserHeader.style.cssText='display:flex; justify-content:space-between; align-items:center;';
	const title=document.createElement('span'); title.textContent='Zapisy'; title.style.fontSize='12px'; title.style.opacity='0.8';
	const closeB=document.createElement('button'); closeB.textContent='×'; closeB.style.cssText='padding:2px 6px;'; closeB.addEventListener('click',()=>{ browser.style.display='none'; });
	browserHeader.appendChild(title); browserHeader.appendChild(closeB); browser.appendChild(browserHeader);
	// Storage usage line
	const usageLine=document.createElement('div'); usageLine.style.cssText='font-size:10px; opacity:.65; margin-bottom:2px;'; browser.appendChild(usageLine);
	const list=document.createElement('div'); list.style.display='flex'; list.style.flexDirection='column'; list.style.gap='4px'; browser.appendChild(list);
	const SAVE_LIST_KEY='mm_save_slots_meta_v1';
	let currentSlotId=null; // active slot id (persisted separately)
	const LAST_SLOT_KEY='mm_last_slot_v1';
	currentSlotId = localStorage.getItem(LAST_SLOT_KEY) || null;
	function loadSlots(){ try{ const raw=localStorage.getItem(SAVE_LIST_KEY); if(!raw) return []; const arr=JSON.parse(raw); return Array.isArray(arr)?arr:[]; }catch(e){ return []; } }
	function storeSlots(slots){ try{ localStorage.setItem(SAVE_LIST_KEY, JSON.stringify(slots)); }catch(e){} }
	function slotKey(id){ return 'mm_slot_'+id; }
	async function serializeCurrent(){ return await ASYNC_JSON_PROCESSOR.stringify(buildSaveObject()); }
	function refreshList(){ 
		list.innerHTML = ''; 
		const slots = loadSlots().sort((a,b) => b.time - a.time); 
		
		if (!slots.length) { 
			const empty = document.createElement('div'); 
			empty.textContent = '(brak zapisów)'; 
			empty.style.fontSize = '11px'; 
			empty.style.opacity = '0.6'; 
			list.appendChild(empty); 
		}
		
		// Use quota manager for storage usage calculation
		const used = STORAGE_QUOTA_MANAGER.getCurrentUsage();
		const usagePercent = STORAGE_QUOTA_MANAGER.getUsagePercent();
		const pct = (usagePercent * 100).toFixed(1);
		
		// Enhanced storage usage display with warnings
		usageLine.textContent = 'Użycie storage: ' + ((used/1024)|0) + ' KB (~' + pct + '% z 5MB)';
		
		if (usagePercent > STORAGE_QUOTA_MANAGER.CRITICAL_THRESHOLD) {
			usageLine.style.color = '#ff4444';
			usageLine.textContent += ' ⚠️ KRYTYCZNY';
		} else if (usagePercent > STORAGE_QUOTA_MANAGER.WARNING_THRESHOLD) {
			usageLine.style.color = '#ff8080';
			usageLine.textContent += ' ⚠️ UWAGA';
		} else {
			usageLine.style.color = '';
		}
		
		// Auto-cleanup suggestion if approaching limits
		if (usagePercent > STORAGE_QUOTA_MANAGER.AUTO_CLEANUP_THRESHOLD && slots.length > 3) {
			const oldSaveCount = slots.filter(s => s.id !== currentSlotId).length;
			if (oldSaveCount > 0) {
				usageLine.textContent += ' (sugerowany cleanup: ' + oldSaveCount + ' starych zapisów)';
			}
		}
		
		slots.forEach(s => { 
			const row = document.createElement('div'); 
			const isCur = currentSlotId === s.id; 
			row.style.cssText = 'display:flex; gap:6px; align-items:center; background:' + (isCur ? 'rgba(60,130,255,0.25)' : 'rgba(255,255,255,0.05)') + '; padding:4px 6px; border-radius:6px;' + (isCur ? 'outline:1px solid #2d7bff;' : '');
			
			const info = document.createElement('div'); 
			info.style.flex = '1'; 
			info.style.minWidth = '0'; 
			const raw = localStorage.getItem(slotKey(s.id)); 
			const sizeKB = raw ? ((raw.length/1024)|0) : 0; 
			let hashState = ''; 
			
			if (raw) { 
				try { 
					const obj = JSON.parse(raw); 
					const v = verifyHash(obj); 
					if (obj && obj.h) { 
						hashState = v.ok ? ('#' + obj.h.slice(0,6)) : '(USZKODZONY)'; 
						if (!v.ok) row.style.background = 'rgba(255,60,60,0.25)'; 
					} 
				} catch (e) { 
					hashState = '(BŁĄD)'; 
					row.style.background = 'rgba(255,60,60,0.25)'; 
				} 
			}
			const nameDisp=(s.name||'Bez nazwy'); info.innerHTML='<b>'+ nameDisp + (isCur?' *':'') +'</b><br><span style="font-size:10px; opacity:.65;">'+ new Date(s.time).toLocaleString() +' • '+sizeKB+' KB • '+hashState+' • seed '+ (s.seed??'-') +'</span>';
			const loadB=document.createElement('button'); loadB.textContent='Wczytaj'; loadB.style.fontSize='11px'; loadB.addEventListener('click',async ()=>{ const raw=localStorage.getItem(slotKey(s.id)); if(raw){ try{ localStorage.setItem(SAVE_KEY,raw); const ok=await loadGame(); if(ok){ currentSlotId=s.id; localStorage.setItem(LAST_SLOT_KEY,currentSlotId); msg('Wczytano '+nameDisp); refreshList(); } else msg('Błąd wczyt.'); }catch(e){ msg('Błąd wczyt.'); } } });
			const exportB=document.createElement('button'); exportB.textContent='Eksport'; exportB.style.fontSize='11px'; exportB.addEventListener('click',()=>{ const raw=localStorage.getItem(slotKey(s.id)); if(!raw){ msg('Brak danych'); return; } try{ const blob=new Blob([raw],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); const safe=nameDisp.replace(/[^a-z0-9_-]+/gi,'_'); a.download='save_'+safe+'.json'; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },0); msg('Wyeksportowano'); }catch(e){ msg('Błąd eksportu'); } });
			const renameB=document.createElement('button'); renameB.textContent='Nazwa'; renameB.style.fontSize='11px'; renameB.addEventListener('click',()=>{ const nn=prompt('Nowa nazwa zapisu:', s.name||''); if(nn!=null){ s.name=nn.trim(); storeSlots(slots); refreshList(); }});
			const delB=document.createElement('button'); delB.textContent='Usuń'; delB.style.fontSize='11px'; delB.addEventListener('click',()=>{ if(confirm('Usunąć zapis '+(s.name||s.id)+'?')){ localStorage.removeItem(slotKey(s.id)); const idx=slots.findIndex(x=>x.id===s.id); if(idx>=0){ slots.splice(idx,1); storeSlots(slots); if(currentSlotId===s.id) currentSlotId=null; refreshList(); } } });
			[loadB,exportB,renameB,delB].forEach(b=>{ b.style.padding='2px 6px'; });
			row.appendChild(info); row.appendChild(loadB); row.appendChild(exportB); row.appendChild(renameB); row.appendChild(delB); list.appendChild(row);
		});
		// Enable/disable Continue button visibility
		continueBtn.style.display = slots.length? 'block':'none';
	}
	function performNamedSave(forcePrompt){ 
		const slots = loadSlots(); 
		let initial = ''; 
		if (!forcePrompt && currentSlotId) { 
			const cur = slots.find(s => s.id === currentSlotId); 
			if (cur) initial = cur.name || ''; 
		} 
		
		const name = prompt('Nazwa zapisu:', initial); 
		if (name == null) return; 
		
		const trimmed = name.trim(); 
		let target = null; 
		if (currentSlotId) target = slots.find(s => s.id === currentSlotId && (trimmed === '' || s.name === trimmed)); 
		if (!target && trimmed) target = slots.find(s => s.name === trimmed); 
		
		const rawCore = buildSaveObject(); 
		const {object:withHash} = attachHash(rawCore); 
		const data = JSON.stringify(withHash); 
		
		if (target) { 
			try { 
				STORAGE_QUOTA_MANAGER.safeSetItem(slotKey(target.id), data, { allowCleanup: true });
				target.time = Date.now(); 
				if (trimmed) target.name = trimmed; 
				target.seed = WORLDGEN.worldSeed; 
				storeSlots(slots); 
				currentSlotId = target.id; 
				
				// Use quota-safe storage for metadata
				try {
					STORAGE_QUOTA_MANAGER.safeSetItem(LAST_SLOT_KEY, currentSlotId, { allowCleanup: false });
				} catch (e) {
					console.warn('Failed to save slot metadata:', e);
				}
				
				msg('Nadpisano ' + (target.name || target.id)); 
				refreshList(); 
			} catch (e) { 
				console.warn('Named save failed:', e);
				if (e.message === 'QUOTA_EXCEEDED') {
					msg('Błąd: Brak miejsca. Usuń stare zapisy.');
				} else if (e.message === 'QUOTA_EXCEEDED_NO_CLEANUP') {
					msg('Błąd: Storage pełny, brak zapisów do usunięcia.');
				} else if (e.message === 'QUOTA_EXCEEDED_AFTER_CLEANUP') {
					msg('Błąd: Storage nadal pełny mimo oczyszczenia.');
				} else {
					msg('Błąd zapisu: ' + (e.message || 'Nieznany'));
				}
			} 
		} else { 
			const id = Date.now().toString(36) + Math.random().toString(36).slice(2,6); 
			try { 
				STORAGE_QUOTA_MANAGER.safeSetItem(slotKey(id), data, { allowCleanup: true });
				slots.push({id, name: trimmed || null, time: Date.now(), seed: WORLDGEN.worldSeed}); 
				storeSlots(slots); 
				currentSlotId = id; 
				
				// Use quota-safe storage for metadata
				try {
					STORAGE_QUOTA_MANAGER.safeSetItem(LAST_SLOT_KEY, currentSlotId, { allowCleanup: false });
				} catch (e) {
					console.warn('Failed to save slot metadata:', e);
				}
				
				msg('Zapisano ' + (trimmed || id)); 
				browser.style.display = 'flex'; 
				refreshList(); 
			} catch (e) { 
				console.warn('New save failed:', e);
				if (e.message === 'QUOTA_EXCEEDED') {
					msg('Błąd: Brak miejsca. Usuń stare zapisy.');
				} else if (e.message === 'QUOTA_EXCEEDED_NO_CLEANUP') {
					msg('Błąd: Storage pełny, brak zapisów do usunięcia.');
				} else if (e.message === 'QUOTA_EXCEEDED_AFTER_CLEANUP') {
					msg('Błąd: Storage nadal pełny mimo oczyszczenia.');
				} else {
					msg('Błąd zapisu: ' + (e.message || 'Nieznany'));
				}
			} 
		} 
	}

	// Continue button logic
	continueBtn.addEventListener('click',async () => {
		const slots = loadSlots(); 
		if (!slots.length) { 
			msg('Brak zapisów'); 
			return; 
		}
		
		let targetId = currentSlotId || localStorage.getItem(LAST_SLOT_KEY);
		if (!targetId) { 
			targetId = slots.sort((a,b) => b.time - a.time)[0].id; 
		}
		
		const raw = localStorage.getItem(slotKey(targetId)); 
		if (!raw) { 
			msg('Brak danych'); 
			return; 
		}
		
		try { 
			STORAGE_QUOTA_MANAGER.safeSetItem(SAVE_KEY, raw, { allowCleanup: true });
			const ok = await loadGame(); 
			if (ok) { 
				currentSlotId = targetId; 
				
				// Use quota-safe storage for metadata
				try {
					STORAGE_QUOTA_MANAGER.safeSetItem(LAST_SLOT_KEY, currentSlotId, { allowCleanup: false });
				} catch (e) {
					console.warn('Failed to save slot metadata:', e);
				}
				
				msg('Kontynuowano'); 
				refreshList(); 
			} else {
				msg('Błąd'); 
			}
		} catch (e) { 
			console.warn('Continue failed:', e);
			if (e.message === 'QUOTA_EXCEEDED') {
				msg('Błąd: Brak miejsca w storage.');
			} else {
				msg('Błąd: ' + (e.message || 'Nieznany'));
			}
		}
	});

	// Global import (adds as new slot)
	const importBtn=document.createElement('button'); 
	importBtn.textContent='Importuj plik'; 
	importBtn.style.cssText='margin-top:4px;';
	
	const fileInput=document.createElement('input'); 
	fileInput.type='file'; 
	fileInput.accept='.json,application/json'; 
	fileInput.style.display='none';
	
	fileInput.addEventListener('change', e => { 
		const f = fileInput.files && fileInput.files[0]; 
		if (!f) return; 
		
		const reader = new FileReader(); 
		reader.onload = async () => { 
			try { 
				const txt = String(reader.result); 
				const obj = await ASYNC_JSON_PROCESSOR.parse(txt); 
				
				if (!obj || typeof obj !== 'object' || !obj.v) { 
					msg('Niepoprawny plik'); 
					return; 
				} 
				
				const slots = loadSlots(); 
				const id = Date.now().toString(36) + Math.random().toString(36).slice(2,6); 
				
				// Use quota-aware storage for import
				STORAGE_QUOTA_MANAGER.safeSetItem(slotKey(id), txt, { allowCleanup: true });
				
				slots.push({
					id, 
					name: (f.name || 'import').replace(/\.json$/i, '') || null, 
					time: Date.now(), 
					seed: obj.seed
				}); 
				
				storeSlots(slots); 
				msg('Zaimportowano'); 
				refreshList(); 
			} catch (err) { 
				console.warn('Import failed:', err);
				if (err.message === 'QUOTA_EXCEEDED') {
					msg('Błąd: Brak miejsca. Usuń stare zapisy.');
				} else if (err.message === 'QUOTA_EXCEEDED_NO_CLEANUP') {
					msg('Błąd: Storage pełny, brak zapisów do usunięcia.');
				} else if (err.message === 'QUOTA_EXCEEDED_AFTER_CLEANUP') {
					msg('Błąd: Storage nadal pełny mimo oczyszczenia.');
				} else {
					msg('Błąd importu: ' + (err.message || 'Nieznany'));
				}
			} 
			fileInput.value = ''; 
		};
		reader.readAsText(f); 
	});
	importBtn.addEventListener('click',()=>fileInput.click());
	group.appendChild(importBtn); group.appendChild(fileInput);
	saveBtn.addEventListener('click',()=>{ performNamedSave(false); });
	loadBtn.addEventListener('click',async ()=>{ const ok=await loadGame(); msg(ok?'Wczytano zapis główny':'Brak głównego zapisu'); });
	saveAsBtn.addEventListener('click',()=>{ performNamedSave(true); });
	const openBrowserBtn=document.createElement('button'); openBrowserBtn.textContent='Lista zapisów'; openBrowserBtn.style.cssText='margin-top:4px;'; openBrowserBtn.addEventListener('click',()=>{ browser.style.display= browser.style.display==='flex' ? 'none':'flex'; if(browser.style.display==='flex') refreshList(); });
	group.appendChild(openBrowserBtn); group.appendChild(browser);
	menuPanel.appendChild(group);
};
document.addEventListener('DOMContentLoaded', () => { 
	TIMER_MANAGER.setTimeout(() => window.__injectSaveButtons(), 200, 'init_save_buttons'); 
});
// Override lightweight saveState() calls to point at full save for backwards compatibility
function saveState(){ saveGame(false); }
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
function drawPlayer(){ const c=MM.customization||DEFAULT_CUST; const bodyX=(player.x-player.w/2)*TILE; const bodyY=(player.y-player.h/2)*TILE; const bw=player.w*TILE, bh=player.h*TILE; // body base color by outfit
	if(c.outfitStyle==='default') ctx.fillStyle=c.outfitColor||'#f4c05a';
	else if(c.outfitStyle==='miner') ctx.fillStyle='#c89b50';
	else if(c.outfitStyle==='mystic') ctx.fillStyle='#6b42c7';
	else ctx.fillStyle='#f4c05a';
	ctx.fillRect(bodyX,bodyY,bw,bh);
	if(c.outfitStyle==='miner'){ ctx.fillStyle='rgba(0,0,0,0.25)'; ctx.fillRect(bodyX,bodyY+bh*0.55,bw,bh*0.12); }
	if(c.outfitStyle==='mystic'){ ctx.fillStyle='rgba(255,255,255,0.18)'; ctx.fillRect(bodyX,bodyY+bh*0.15,bw,bh*0.15); }
	ctx.strokeStyle='#4b3212'; ctx.lineWidth=2; ctx.strokeRect(bodyX,bodyY,bw,bh);
	const eyeW=6, eyeHOpen=6; let eyeH=eyeHOpen; if(blinking && c.eyeStyle!=='glow'){ const p=(performance.now()-blinkStart)/BLINK_DUR; const tri=p<0.5? (p*2) : (1-(p-0.5)*2); eyeH = Math.max(1, eyeHOpen * (1-tri)); }
	const eyeY=bodyY + bh*0.35; const eyeOffsetX=bw*0.18; const pupilW=2; const pupilShift=player.facing*1.5;
	function eye(cx){ if(c.eyeStyle==='glow'){ ctx.fillStyle='rgba(255,255,255,0.08)'; ctx.fillRect(cx-eyeW/2-2, eyeY-eyeHOpen/2-2, eyeW+4, eyeHOpen+4); ctx.fillStyle='#8bf9ff'; ctx.fillRect(cx-eyeW/2, eyeY-eyeHOpen/2, eyeW, eyeHOpen); }
		else if(c.eyeStyle==='sleepy'){ const h=Math.max(2, eyeHOpen-3); ctx.fillStyle='#fff'; ctx.fillRect(cx-eyeW/2, eyeY-h/2, eyeW, h); if(h>2){ ctx.fillStyle='#111'; ctx.fillRect(cx - pupilW/2 + pupilShift, eyeY - Math.min(h/2-1,2), pupilW, Math.min(h-2,4)); } }
		else { ctx.fillStyle='#fff'; ctx.fillRect(cx-eyeW/2, eyeY-eyeH/2, eyeW, eyeH); if(eyeH>2){ ctx.fillStyle='#111'; ctx.fillRect(cx - pupilW/2 + pupilShift, eyeY - Math.min(eyeH/2-1,2), pupilW, Math.min(eyeH-2,4)); } } }
	eye(bodyX+bw/2-eyeOffsetX); eye(bodyX+bw/2+eyeOffsetX);
	ctx.fillStyle='rgba(0,0,0,0.25)'; const shw=bw*0.6; ctx.beginPath(); ctx.ellipse(player.x*TILE, (player.y+player.h/2)*TILE+2, shw/2, 4,0,0,Math.PI*2); ctx.fill(); }

// Chunk render cache (offscreen canvas per chunk) with memory management
const chunkCanvases = new Map(); // key: chunkX -> {canvas,ctx,version,lastUsed}
const MAX_CACHED_CHUNKS = 50; // Limit cached chunks to prevent memory leaks
const CHUNK_CACHE_TIMEOUT = 30000; // 30 seconds before unused chunks are cleaned up

function hash32(x,y){ let h = (x|0)*374761393 + (y|0)*668265263; h = (h^(h>>>13))*1274126177; h = h^(h>>>16); return h>>>0; }

// Clean up old chunk canvases to prevent memory leaks
function cleanupChunkCache() {
	const now = performance.now();
	const entries = Array.from(chunkCanvases.entries());
	
	// Sort by last used time (oldest first)
	entries.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
	
	// Remove entries that exceed cache limit or are too old
	const toRemove = [];
	for (let i = 0; i < entries.length; i++) {
		const [chunkX, entry] = entries[i];
		const shouldRemove = i < entries.length - MAX_CACHED_CHUNKS || 
		                    (now - entry.lastUsed) > CHUNK_CACHE_TIMEOUT;
		if (shouldRemove) {
			toRemove.push(chunkX);
		}
	}
	
	// Actually remove the entries
	toRemove.forEach(chunkX => {
		const entry = chunkCanvases.get(chunkX);
		if (entry) {
			// Clean up the canvas context to free memory
			entry.ctx.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
			entry.canvas.width = 1;
			entry.canvas.height = 1;
			chunkCanvases.delete(chunkX);
		}
	});
}
function shadeColor(hex,delta){ // hex like #rgb or #rrggbb (we use rrggbb)
	const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
	const clamp=v=>v<0?0:v>255?255:v; const nr=clamp(r+delta), ng=clamp(g+delta), nb=clamp(b+delta);
	return '#'+nr.toString(16).padStart(2,'0')+ng.toString(16).padStart(2,'0')+nb.toString(16).padStart(2,'0'); }
function drawChunkToCache(cx){ 
	const key=cx; 
	const k='c'+cx; 
	const arr=WORLD._world.get(k); 
	if(!arr) return; 
	
	let entry=chunkCanvases.get(key); 
	if(!entry){ 
		const c=document.createElement('canvas'); 
		c.width=CHUNK_W*TILE; 
		c.height=WORLD_H*TILE; 
		const cctx=c.getContext('2d'); 
		cctx.imageSmoothingEnabled=false; 
		entry={canvas:c,ctx:cctx,version:-1,lastUsed:performance.now()}; 
		chunkCanvases.set(key,entry); 
	}
	
	// Update last used time
	entry.lastUsed = performance.now();
	
	const currentVersion=WORLD.chunkVersion(cx); 
	if(entry.version===currentVersion) return; 
	
	const cctx=entry.ctx; 
	cctx.clearRect(0,0,cctx.canvas.width,cctx.canvas.height);
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
				// Chest highlight & tier flair
				if(t===T.CHEST_COMMON||t===T.CHEST_RARE||t===T.CHEST_EPIC){
					cctx.save();
					const stroke = t===T.CHEST_EPIC? '#e0b341' : (t===T.CHEST_RARE? '#a74cc9':'#b07f2c');
					cctx.strokeStyle=stroke; cctx.lineWidth=2; cctx.strokeRect(lx*TILE+1,y*TILE+1,TILE-2,TILE-2);
					// inner gradient sheen using simple vertical fade
					const g=cctx.createLinearGradient(lx*TILE,y*TILE,lx*TILE,y*TILE+TILE);
					g.addColorStop(0,'rgba(255,255,255,0.25)'); g.addColorStop(0.5,'rgba(255,255,255,0)'); g.addColorStop(1,'rgba(0,0,0,0.25)');
					cctx.fillStyle=g; cctx.fillRect(lx*TILE+2,y*TILE+2,TILE-4,TILE-4);
					if(((h>>11)&15)<2){ cctx.fillStyle='rgba(255,255,255,0.65)'; cctx.fillRect(lx*TILE+6 + (h&3), y*TILE+6 + ((h>>4)&3),2,2); }
					cctx.restore();
				}
				if(t===T.STONE || t===T.WOOD){ cctx.fillStyle='rgba(0,0,0,0.05)'; cctx.fillRect(lx*TILE + ((h>>8)&3), y*TILE, 2, TILE); }
			}
		}
	entry.version=currentVersion; }
function drawWorldVisible(sx,sy,viewX,viewY){ 
	const minChunk=Math.floor(sx/CHUNK_W)-1; 
	const maxChunk=Math.floor((sx+viewX+2)/CHUNK_W)+1; 
	
	// Clean up chunk cache periodically (every ~2 seconds when drawing)
	if (Math.random() < 0.01) { // ~1% chance per frame ≈ every 2 seconds at 60fps
		cleanupChunkCache();
	}
	
	// prepare caches
	for(let cx=minChunk; cx<=maxChunk; cx++){ 
		WORLD.ensureChunk(cx); 
		drawChunkToCache(cx); 
	}
	
	// Draw whole chunks that intersect view (avoids per-tile seams)
	const viewPX0 = sx*TILE, viewPX1=(sx+viewX+2)*TILE;
	for(let cx=minChunk; cx<=maxChunk; cx++){
		const entry=chunkCanvases.get(cx); 
		if(!entry) continue; 
		
		// Update last used time when actually drawing
		entry.lastUsed = performance.now();
		
		const chunkXpx = cx*CHUNK_W*TILE;
		const chunkRight = chunkXpx + CHUNK_W*TILE; 
		if(chunkRight < viewPX0-CHUNK_W*TILE || chunkXpx > viewPX1+CHUNK_W*TILE) continue;
		ctx.drawImage(entry.canvas, chunkXpx, 0);
	}
		// Chest aura second pass (not cached) for pulsing glow
		const nowA=performance.now();
		for(let cx2=minChunk; cx2<=maxChunk; cx2++){
			for(let lx=0; lx<CHUNK_W; lx++){
				const wx=cx2*CHUNK_W+lx; for(let y=sy; y<sy+viewY+2; y++){ const t=getTile(wx,y); if(t===T.CHEST_COMMON||t===T.CHEST_RARE||t===T.CHEST_EPIC){ const pulse=Math.sin(nowA*0.004 + wx*0.7 + y*0.3)*0.5+0.5; const rad=TILE*0.6 + pulse*TILE*0.25; const cxp=wx*TILE+TILE/2; const cyp=y*TILE+TILE/2; const g=ctx.createRadialGradient(cxp,cyp,rad*0.2,cxp,cyp,rad); const col = t===T.CHEST_EPIC? 'rgba(224,179,65,' : (t===T.CHEST_RARE? 'rgba(167,76,201,' : 'rgba(176,127,44,'); g.addColorStop(0,col+(0.45+0.35*pulse)+(chestDebug?0.15:0)+')'); g.addColorStop(1,col+'0)'); ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cxp,cyp,rad*(chestDebug?1.15:1),0,Math.PI*2); ctx.fill(); if(chestDebug){ ctx.strokeStyle='#fff'; ctx.lineWidth=1; ctx.strokeRect(wx*TILE+1,y*TILE+1,TILE-2,TILE-2); } } }
			}
		}
		if(chestDebug){ const pcx=Math.floor(player.x/CHUNK_W); const cnt=countChestsAround(pcx,4); ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(sx*TILE+6, sy*TILE+6, 140,24); ctx.fillStyle='#fff'; ctx.font='14px system-ui'; ctx.fillText('Skrzynie ±4: '+cnt, sx*TILE+12, sy*TILE+24); }
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
				
				// Pre-calculate blade data to batch by color/style for efficient rendering
				const frontBlades = [];
				const backBlades = [];
				
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
					const frontBlade = ((bSeed>>5)&1)===1;
					const colorVariant = (bSeed&2) ? 0 : 1; // Two color variants
					
					const bladeData = {
						baseX, baseY, midX, midY, topX, topY,
						shadeMod, colorVariant
					};
					
					if(frontBlade) {
						frontBlades.push(bladeData);
					} else {
						backBlades.push(bladeData);
					}
				}
				
				// Render blades in batches by pass to minimize context switches
				const bladesToRender = (pass === 'front') ? frontBlades : backBlades;
				if(bladesToRender.length === 0) continue;
				
				// Group by color variant for batch rendering
				const colorGroups = [[], []]; // [variant0, variant1]
				bladesToRender.forEach(blade => {
					colorGroups[blade.colorVariant].push(blade);
				});
				
				// Render each color group in one batch
				colorGroups.forEach((group, colorIdx) => {
					if(group.length === 0) return;
					
					// Set context state once per color group
					ctx.lineWidth = 1;
					const isFront = pass === 'front';
					const baseAlpha = isFront ? 0.85 : 0.55;
					const colorBase = colorIdx ? [46,165,46] : [34,125,34];
					
					// Begin path for entire group
					ctx.beginPath();
					group.forEach(blade => {
						const alpha = (baseAlpha * blade.shadeMod).toFixed(2);
						// Can't batch different alphas easily, so we still need individual strokes
						// But we minimize the other state changes
						ctx.strokeStyle = `rgba(${colorBase[0]},${colorBase[1]},${colorBase[2]},${alpha})`;
						ctx.moveTo(blade.baseX, blade.baseY);
						ctx.quadraticCurveTo(blade.midX, blade.midY, blade.topX, blade.topY);
						ctx.stroke();
						ctx.beginPath(); // Reset for next blade
					});
				});
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
// Chest debug helpers
let chestDebug=false; // toggled to highlight chests strongly
function countChestsInChunk(cx){ const k='c'+cx; const arr=WORLD._world.get(k); if(!arr) return 0; let c=0; for(let i=0;i<arr.length;i++){ const t=arr[i]; if(t===T.CHEST_COMMON||t===T.CHEST_RARE||t===T.CHEST_EPIC) c++; } return c; }
function countChestsAround(centerCx,r){ let total=0; for(let d=-r; d<=r; d++){ total+=countChestsInChunk(centerCx+d); } return total; }
let _preGodInventory=null; // store inventory snapshot before granting resources
function updateGodBtn(){ const b=document.getElementById('godBtn'); if(!b) return; b.classList.toggle('toggled',godMode); b.textContent='Bóg: '+(godMode?'ON':'OFF'); }
function toggleGod(){
	godMode=!godMode;
	if(godMode){
		// snapshot current counts if not already taken
		if(!_preGodInventory){ _preGodInventory={grass:inv.grass,sand:inv.sand,stone:inv.stone,diamond:inv.diamond,wood:inv.wood,leaf:inv.leaf,snow:inv.snow,water:inv.water}; }
		inv.grass=inv.sand=inv.stone=inv.diamond=inv.wood=inv.leaf=inv.snow=inv.water=100;
	} else {
		// restore previous counts if snapshot exists
		if(_preGodInventory){ Object.assign(inv,_preGodInventory); _preGodInventory=null; }
	}
	updateInventory(); updateGodBtn(); saveState();
	msg('Tryb boga '+(godMode?'ON – 100 materiałów':'OFF – przywrócono zapasy'));
}
function toggleMap(){ revealAll=!revealAll; const b=document.getElementById('mapBtn'); if(b){ b.classList.toggle('toggled',revealAll); b.textContent='Mapa: '+(revealAll?'ON':'OFF'); } msg('Mapa '+(revealAll?'ON':'OFF')); }
function centerCam(){ camSX=player.x - (W/(TILE*zoom))/2; camSY=player.y - (H/(TILE*zoom))/2; camX=camSX; camY=camSY; msg('Wyśrodkowano'); }
function toggleHelp(){ const h=document.getElementById('help'); const show=h.style.display!=='block'; h.style.display=show?'block':'none'; document.getElementById('helpBtn').setAttribute('aria-expanded', String(show)); }
function isBlockingOverlayOpen(){
    // Any modal/overlay that should suppress gameplay input
    const loot=document.getElementById('lootPopup'); if(loot && loot.classList.contains('show')) return true;
    const cust=document.getElementById('custOverlay'); if(cust && cust.style.display==='block') return true;
    const menu=document.getElementById('menuPanel'); if(menu && !menu.hasAttribute('hidden')) return true;
    const craft=document.getElementById('craft'); if(craft && craft.style.display!=='none') return true;
    return false;
}window.addEventListener('keydown',e=>{ if(isBlockingOverlayOpen()) return; const k=e.key.toLowerCase(); keys[k]=true; if(['1','2','3'].includes(e.key)){ if(e.key==='1') player.tool='basic'; if(e.key==='2'&&inv.tools.stone) player.tool='stone'; if(e.key==='3'&&inv.tools.diamond) player.tool='diamond'; updateInventory(); }
 // Hotbar numeric (4..9) -> slots 0..5
 if(['4','5','6','7','8','9'].includes(e.key)){
	 const slot=parseInt(e.key,10)-4; cycleHotbar(slot);
 }
	if(k==='g'&&!keysOnce.has('g')){ toggleGod(); keysOnce.add('g'); }
	if(k==='p'&&!keysOnce.has('p')){ chestDebug=!chestDebug; msg('Chest debug '+(chestDebug?'ON':'OFF')); keysOnce.add('p'); }
	if(k==='j'&&!keysOnce.has('j')){ keysOnce.add('j'); const pcx=Math.floor(player.x/CHUNK_W); msg('Skrzynie w pobliżu: '+countChestsAround(pcx,4)); }
	if(k==='k'&&!keysOnce.has('k')){ // force spawn a chest at feet (cycle tiers)
		keysOnce.add('k'); const px=Math.floor(player.x); const py=Math.floor(player.y)-1; const tiers=[T.CHEST_COMMON,T.CHEST_RARE,T.CHEST_EPIC]; const cur=getTile(px,py); if(cur===T.AIR){ const idx=Math.floor(performance.now()/1000)%tiers.length; setTile(px,py,tiers[idx]); msg('Debug: wstawiono skrzynię '+(idx===2?'epicką':idx===1?'rzadką':'zwykłą')); } }
	// Debug chest placement (L)
	if(k==='l'&&!keysOnce.has('l')){ keysOnce.add('l'); const px=Math.floor(player.x); const py=Math.floor(player.y); const below=py; if(getTile(px,below)===T.AIR){ const r=Math.random(); let cid=T.CHEST_COMMON; if(r>0.9) cid=T.CHEST_RARE; if(r>0.97) cid=T.CHEST_EPIC; setTile(px,below,cid); msg('Postawiono skrzynię ('+(cid===T.CHEST_EPIC?'epicka':cid===T.CHEST_RARE?'rzadka':'zwykła')+')'); } }
	if(k==='m'&&!keysOnce.has('m')){ toggleMap(); keysOnce.add('m'); }
	if(k==='c'&&!keysOnce.has('c')){ centerCam(); keysOnce.add('c'); }
	if(k==='h'&&!keysOnce.has('h')){ toggleHelp(); keysOnce.add('h'); }
	if(k==='v'&&!keysOnce.has('v')){ window.__mobDebug = !window.__mobDebug; msg('Mob debug '+(window.__mobDebug?'ON':'OFF')); keysOnce.add('v'); }
	if(['arrowup','w',' '].includes(k)) e.preventDefault(); });
window.addEventListener('keyup',e=>{ if(isBlockingOverlayOpen()) return; const k=e.key.toLowerCase(); keys[k]=false; keysOnce.delete(k); });

// Kierunek kopania
let mineDir={dx:1,dy:0}; document.querySelectorAll('.dirbtn').forEach(b=>{ b.addEventListener('click',()=>{ mineDir.dx=+b.getAttribute('data-dx'); mineDir.dy=+b.getAttribute('data-dy'); document.querySelectorAll('.dirbtn').forEach(o=>o.classList.remove('sel')); b.classList.add('sel'); }); }); document.querySelector('.dirbtn[data-dx="1"][data-dy="0"]').classList.add('sel');

// Pad dotykowy
function bindPad(){ document.querySelectorAll('#pad .btn').forEach(btn=>{ const code=btn.getAttribute('data-key'); if(!code) return; btn.addEventListener('pointerdown',ev=>{ ev.preventDefault(); keys[code.toLowerCase()]=true; btn.classList.add('on'); if(code==='ArrowUp') keys['w']=true; }); ['pointerup','pointerleave','pointercancel'].forEach(evName=> btn.addEventListener(evName,()=>{ keys[code.toLowerCase()]=false; btn.classList.remove('on'); if(code==='ArrowUp') keys['w']=false; })); }); } bindPad();

// Kamera
let camX=0,camY=0,camSX=0,camSY=0; let zoom=1, zoomTarget=1; function ensureChunks(){ const pcx=Math.floor(player.x/CHUNK_W); for(let d=-2; d<=2; d++) ensureChunk(pcx+d); }
function clampZoom(z){ return Math.min(3, Math.max(0.5, z)); }
function setZoom(z){ zoomTarget = clampZoom(z); }
function nudgeZoom(f){ setZoom(zoomTarget * f); }
canvas.addEventListener('wheel',e=>{ if(isBlockingOverlayOpen()) return; if(e.ctrlKey){ // let browser zoom work
	return; }
	e.preventDefault(); const dir = e.deltaY>0?1:-1; const factor = dir>0? 1/1.1 : 1.1; nudgeZoom(factor);
},{passive:false});
window.addEventListener('keydown',e=>{ if(isBlockingOverlayOpen()) return; if(e.key==='+'||e.key==='='||e.key===']'){ nudgeZoom(1.1); }
	if(e.key==='-'||e.key==='['){ nudgeZoom(1/1.1); }
});

// Fizyka
const MOVE={ACC:32,FRICTION:28,MAX:6,JUMP:-9,GRAV:20};
// Expose for other engine modules (cape uses MAX for flare)
window.MM.MOVE = MOVE;
let jumpPrev=false; let swimBuoySmooth=0; function physics(dt){
	// Horizontal input
	let input=0; if(keys['a']||keys['arrowleft']) input-=1; if(keys['d']||keys['arrowright']) input+=1; if(input!==0) player.facing=input;
	// Movement speed multiplier (combined from all customization sources)
	const moveMult = (MM.activeModifiers && MM.activeModifiers.moveSpeedMult)||1;
	const target=input*MOVE.MAX*moveMult; const diff=target-player.vx; const accel=MOVE.ACC*dt*Math.sign(diff)*moveMult;
	if(target!==0){ if(Math.abs(accel)>Math.abs(diff)) player.vx=target; else player.vx+=accel; } else { const fr=MOVE.FRICTION*dt; if(Math.abs(player.vx)<=fr) player.vx=0; else player.vx-=fr*Math.sign(player.vx); }

	// Submersion sampling (5 points along body) with fractional sampling for smoother transitions
	const samples=5; let submerged=0; const headY=player.y - player.h/2; const footY=player.y + player.h/2; const step=(footY-headY)/(samples-1); const tileX=Math.floor(player.x);
	for(let i=0;i<samples;i++){
		const sy=headY + step*i; const ty=Math.floor(sy); const tId=getTile(tileX,ty); if(tId===T.WATER){
			// weight sample by how deep inside tile (reduces jumpiness when crossing boundary)
			const fracInside = 1 - (sy - ty); submerged += 0.5 + 0.5*fracInside; // 0.5..1 weighting
		}
	}
	const subFracRaw = submerged / samples; // can exceed 1 slightly; clamp below
	const subFrac = Math.min(1, subFracRaw);
	const inWater = subFrac>0.05; // tiny contact ignored
	const diveInput = keys['s']||keys['arrowdown'];
	const jumpNow=(keys['w']||keys['arrowup']||keys[' ']);

	if(inWater){
		// Water drag scales with immersion and adds subtle variation
		const time=performance.now();
		const micro = Math.sin(time*0.0012 + player.x*0.37) * 0.15 + Math.sin(time*0.00047 + player.y*0.52)*0.1;
		const dragBase=2.2 + micro; // softer than before
		const drag = dragBase * (0.35 + subFrac*0.65); // more drag when fully submerged
		player.vx -= player.vx * Math.min(1, drag*dt);
	}
	if(jumpNow && !jumpPrev){
		const maxAir = (MM.activeModifiers && typeof MM.activeModifiers.maxAirJumps==='number')? MM.activeModifiers.maxAirJumps : 0; // additional beyond ground jump
		const totalAllowed = 1 + maxAir; // total sequential presses allowed while airborne
		const jumpMult = (MM.activeModifiers && MM.activeModifiers.jumpPowerMult)||1;
		if(player.onGround || godMode){ // primary jump
			player.vy=MOVE.JUMP * jumpMult; player.onGround=false; player.jumpCount=1;
		}
		else if(!inWater && player.jumpCount>0 && player.jumpCount < totalAllowed){
			// mid-air extra jump
			player.vy=MOVE.JUMP * jumpMult; player.jumpCount++;
		}
		else if(inWater){ // gentle swim kick (does not consume jump charges)
			player.vy = Math.min(player.vy,0);
			player.vy += MOVE.JUMP * 0.32 * (0.6 + 0.4*subFrac) * jumpMult;
		}
	}
	jumpPrev=jumpNow;

	if(inWater){
		// Stronger buoyancy with PD control so player reliably floats at surface.
		const time=performance.now();
		const desiredSub = diveInput? 0.88 : 0.66; // target fraction of body submerged
		const neutralPoint = 0.50; // submersion where gravity mostly neutralizes
		const gravScale = 1 - subFrac*0.82; // deeper -> less gravity
		player.vy += MOVE.GRAV * gravScale * dt;
		// PD controller: proportional on immersion error, derivative on vertical velocity
		const error = desiredSub - subFrac; // positive -> need to sink more, negative -> need to rise
		const Kp = diveInput? 55 : 70; // strong proportional for crisp float
		const Kd = diveInput? 7 : 9;  // damping
		let buoyAccel = (error * Kp) - (player.vy * Kd);
		// Additional lift when past neutral and not diving (prevents creeping downward)
		const excess = subFrac - neutralPoint; if(excess>0 && !diveInput) buoyAccel -= excess * 30;
		// Micro wave variation
		const wave = Math.sin(time*0.0012 + player.x*0.3)*0.6 + Math.sin(time*0.00047 + player.x*0.07 + player.y*0.11)*0.4;
		buoyAccel += wave * 0.8; // ~ -0.8..0.8
		if(diveInput) buoyAccel *= 0.5; // still allow descent when diving
		// Low-pass filter final buoyancy for smoothness
		swimBuoySmooth += (buoyAccel - swimBuoySmooth) * Math.min(1, dt*6);
		player.vy += swimBuoySmooth * dt;
		if(diveInput){ player.vy += 5*dt; }
		// Hard surface assist: if head is near surface & not diving, clamp downward motion strongly
		const headTile = getTile(tileX, Math.floor(headY));
		const aboveHead = getTile(tileX, Math.floor(headY)-1);
		if(!diveInput && headTile===T.WATER && aboveHead===T.AIR){
			if(player.vy>0.4) player.vy -= Math.min(player.vy, 16*dt); // fast stop sinking
			// slight upward bias to keep head clear
			player.vy -= 4.5*dt;
			player.vx -= player.vx * 0.15 * dt;
			// Gentle positional bob (two layered waves)
			const bob = Math.sin(time*0.002 + player.x*0.42)*0.55 + Math.sin(time*0.00085 + player.x*0.18)*0.28;
			player.y += bob/(TILE*75);
		}
		// Clamp speeds (tighter downward, allow brisk upward correction)
		const maxDown=2.8, maxUp=9.0; if(player.vy>maxDown) player.vy=maxDown; if(player.vy<-maxUp) player.vy=-maxUp;
	} else {
		// Normal gravity when not in water
		player.vy += MOVE.GRAV*dt; if(player.vy>20) player.vy=20; swimBuoySmooth=0; // reset filter
	}

	// Integrate & collisions
	player.x += player.vx*dt; collide('x');
	player.y += player.vy*dt; collide('y');

	// Camera follow
	const tX=player.x - (W/(TILE*zoom))/2 + player.w/2; const tY=player.y - (H/(TILE*zoom))/2 + player.h/2; camSX += (tX-camSX)*Math.min(1,dt*8); camSY += (tY-camSY)*Math.min(1,dt*8); camX=camSX; camY=camSY; ensureChunks(); revealAround(); }
function collide(axis){ const w=player.w/2,h=player.h/2; if(axis==='x'){ const minX=Math.floor(player.x-w), maxX=Math.floor(player.x+w), minY=Math.floor(player.y-h), maxY=Math.floor(player.y+h); for(let y=minY;y<=maxY;y++){ for(let x=minX;x<=maxX;x++){ const t=getTile(x,y); if(isSolid(t)){ if(player.vx>0) player.x = x - w - 0.001; if(player.vx<0) player.x = x + 1 + w + 0.001; } } } } else { const minX=Math.floor(player.x-w), maxX=Math.floor(player.x+w), minY=Math.floor(player.y-h), maxY=Math.floor(player.y+h); const wasGround=player.onGround; player.onGround=false; for(let y=minY;y<=maxY;y++){ for(let x=minX;x<=maxX;x++){ const t=getTile(x,y); if(isSolid(t)){ if(player.vy>0){ player.y = y - h - 0.001; player.vy=0; player.onGround=true; } if(player.vy<0){ player.y = y + 1 + h + 0.001; player.vy=0; } } } } if(player.onGround && !wasGround){ player.jumpCount=0; } } }

// Mgła / widoczność (optimized bitset per chunk instead of Set<string>)
let revealAll=false;
const seenChunks=new Map(); // key: chunkX -> Uint8Array bitset (CHUNK_W*WORLD_H bits)
const SEEN_STRIDE = CHUNK_W*WORLD_H; // bits per chunk
const SEEN_BYTES = Math.ceil(SEEN_STRIDE/8);
function ensureSeenChunk(cx){ let arr=seenChunks.get(cx); if(!arr){ arr=new Uint8Array(SEEN_BYTES); seenChunks.set(cx,arr);} return arr; }
function markSeen(x,y){ if(y<0||y>=WORLD_H) return; const cx=Math.floor(x/CHUNK_W); let lx=x - cx*CHUNK_W; if(lx<0||lx>=CHUNK_W) return; const idx=y*CHUNK_W + lx; const arr=ensureSeenChunk(cx); arr[idx>>3] |= (1 << (idx & 7)); }
function hasSeen(x,y){ if(y<0||y>=WORLD_H) return false; const cx=Math.floor(x/CHUNK_W); const arr=seenChunks.get(cx); if(!arr) return false; const lx=x - cx*CHUNK_W; if(lx<0||lx>=CHUNK_W) return false; const idx=y*CHUNK_W + lx; return (arr[idx>>3] & (1 << (idx & 7)))!==0; }
function revealAround(){ const m=MM.activeModifiers||{}; const r = (typeof m.visionRadius==='number')? m.visionRadius : 10; const px=player.x, py=player.y; for(let dx=-r; dx<=r; dx++){ const wx=Math.floor(px+dx); for(let dy=-r; dy<=r; dy++){ if(dx*dx+dy*dy<=r*r){ markSeen(wx, Math.floor(py+dy)); } } } }

// Kopanie (kierunkowe)
// Kopanie + upadek drzew
let mining=false,mineTimer=0,mineTx=0,mineTy=0; const mineBtn=document.getElementById('mineBtn');
mineBtn.addEventListener('pointerdown',e=>{ e.preventDefault(); startMine(); });
window.addEventListener('pointerup',()=>{ mining=false; mineBtn.classList.remove('on'); });
function startMine(){ const tx=Math.floor(player.x + mineDir.dx + (mineDir.dx>0?player.w/2:mineDir.dx<0?-player.w/2:0)); const ty=Math.floor(player.y + mineDir.dy); const t=getTile(tx,ty); if(t===T.AIR) return; mining=true; mineTimer=0; mineTx=tx; mineTy=ty; mineBtn.classList.add('on'); if(godMode) instantBreak(); }
function instantBreak(){ if(getTile(mineTx,mineTy)===T.AIR){ mining=false; mineBtn.classList.remove('on'); return; } const tId=getTile(mineTx,mineTy); if(tId===T.WOOD && isTreeBase(mineTx,mineTy)){ if(startTreeFall(mineTx,mineTy)){ mining=false; mineBtn.classList.remove('on'); return; } } const info=INFO[tId]; const drop=info.drop; setTile(mineTx,mineTy,T.AIR); if(drop) inv[drop]=(inv[drop]||0)+1; if(MM.fallingSolids) MM.fallingSolids.onTileRemoved(mineTx,mineTy); if(MM.water) MM.water.onTileChanged(mineTx,mineTy,getTile); pushUndo(mineTx,mineTy,tId,T.AIR,'break'); mining=false; mineBtn.classList.remove('on'); updateInventory(); }
// Falling tree system (per-block physics)
function isTreeBase(x,y){ return TREES.isTreeBase(getTile,x,y); }
function startTreeFall(bx,by){ return TREES.startTreeFall(getTile,setTile,player.facing,bx,by); }
function updateFallingBlocks(dt){ TREES.updateFallingBlocks(getTile,setTile,dt); }
function drawFallingBlocks(){ TREES.drawFallingBlocks(ctx,TILE,INFO); }
function updateMining(dt){ if(!mining) return; if(getTile(mineTx,mineTy)===T.AIR){ mining=false; mineBtn.classList.remove('on'); return; } if(godMode){ instantBreak(); return; } const mineMult=(MM.activeModifiers && MM.activeModifiers.mineSpeedMult)||1; mineTimer += dt * tools[player.tool] * mineMult; const curId=getTile(mineTx,mineTy); const info=INFO[curId]; const need=Math.max(0.1, info.hp/6); if(mineTimer>=need){ if(curId===T.WOOD && isTreeBase(mineTx,mineTy)){ if(startTreeFall(mineTx,mineTy)){ mining=false; mineBtn.classList.remove('on'); return; } } const drop=info.drop; setTile(mineTx,mineTy,T.AIR); if(drop) inv[drop]=(inv[drop]||0)+1; if(MM.fallingSolids) MM.fallingSolids.onTileRemoved(mineTx,mineTy); if(MM.water) MM.water.onTileChanged(mineTx,mineTy,getTile); pushUndo(mineTx,mineTy,curId,T.AIR,'break'); mining=false; mineBtn.classList.remove('on'); updateInventory(); } }

// --- Placement ---
// Suppress accidental placement immediately after opening a chest with right-click
let lastChestOpen={t:0,x:0,y:0};
const CHEST_PLACE_SUPPRESS_MS=250; // extended to reduce accidental placements
canvas.addEventListener('contextmenu',e=>{ if(isBlockingOverlayOpen()) return; e.preventDefault(); const now=performance.now(); if(now-lastChestOpen.t<CHEST_PLACE_SUPPRESS_MS) return; tryPlaceFromEvent(e); });
canvas.addEventListener('pointerdown',e=>{ if(isBlockingOverlayOpen()) return; if(e.button===2){ e.preventDefault(); tryPlaceFromEvent(e); } });
// Pointer mapping helpers (CSS px -> world/tile), note: DPR already handled by base transform
function cssToWorldPx(cssX, cssY){
	const wxPx = cssX/zoom + camX*TILE;
	const wyPx = cssY/zoom + camY*TILE;
	return {wxPx, wyPx};
}
function eventToTile(e){ const rect=canvas.getBoundingClientRect(); const cssX=(e.clientX-rect.left); const cssY=(e.clientY-rect.top); const {wxPx,wyPx}=cssToWorldPx(cssX,cssY); return {tx:Math.floor(wxPx/TILE), ty:Math.floor(wyPx/TILE)}; }
function tryPlaceFromEvent(e){ const {tx,ty}=eventToTile(e); tryPlace(tx,ty); }
function haveBlocksFor(tileId){ switch(tileId){ case T.GRASS: return inv.grass>0; case T.SAND: return inv.sand>0; case T.STONE: return inv.stone>0; case T.WOOD: return inv.wood>0; case T.LEAF: return inv.leaf>0; case T.SNOW: return inv.snow>0; case T.WATER: return inv.water>0; default: return false; }}
function consumeFor(tileId){ if(godMode) return; if(tileId===T.GRASS) inv.grass--; else if(tileId===T.SAND) inv.sand--; else if(tileId===T.STONE) inv.stone--; else if(tileId===T.WOOD) inv.wood--; else if(tileId===T.LEAF) inv.leaf--; else if(tileId===T.SNOW) inv.snow--; else if(tileId===T.WATER) inv.water--; }
function tryPlace(tx,ty){ if(getTile(tx,ty)!==T.AIR) return; // not empty
 // prevent placing inside player bbox
 if(tx+0.001 > player.x - player.w/2 && tx < player.x + player.w/2 && ty+1 > player.y - player.h/2 && ty < player.y + player.h/2){ return; }
 const below=getTile(tx,ty+1); const id=selectedTileId();
 // Chest placement (only god mode). Allow floating for convenience.
 const selName=HOTBAR_ORDER[hotbarIndex];
 if(isChestSelection(selName)){
	 if(!godMode) { msg('Tylko w trybie Boga'); return; }
	 setTile(tx,ty, T[selName]);
	 return;
 }
 // Allow unsupported placement only for sand & water (fluids fall/spread); others need support unless godMode
 if(below===T.AIR && !godMode && id!==T.SAND && id!==T.WATER) return;
 if(!haveBlocksFor(id)){ msg('Brak bloków'); return; }
 pushUndo(tx,ty,T.AIR,id,'place');
 setTile(tx,ty,id); consumeFor(id); updateInventory(); updateHotbarCounts(); saveState();
 if(id===T.WATER && MM.water){ MM.water.addSource(tx,ty,getTile,setTile); }
 if(MM.fallingSolids){
 	// If we placed unsupported sand, convert it to falling instantly
 	if(id===T.SAND && below===T.AIR) MM.fallingSolids.maybeStart(tx,ty);
 	MM.fallingSolids.recheckNeighborhood(tx,ty-1); MM.fallingSolids.afterPlacement(tx,ty);
 }
}
function updateHotbarCounts(){ const map={GRASS:'grass',SAND:'sand',STONE:'stone',WOOD:'wood',LEAF:'leaf',SNOW:'snow',WATER:'water'}; for(const k in map){ const el=document.getElementById('hotCnt'+k); if(el) el.textContent=inv[map[k]]; } }
function updateHotbarSel(){ document.querySelectorAll('.hotSlot').forEach((el,i)=>{ if(i===hotbarIndex) el.classList.add('sel'); else el.classList.remove('sel'); }); }
// --- Undo system for tile edits ---
const UNDO_LIMIT=200; const undoStack=[]; // {x,y,oldId,newId,kind}
function invKeyForTile(id){ if(id===T.GRASS) return 'grass'; if(id===T.SAND) return 'sand'; if(id===T.STONE) return 'stone'; if(id===T.DIAMOND) return 'diamond'; if(id===T.WOOD) return 'wood'; if(id===T.LEAF) return 'leaf'; if(id===T.SNOW) return 'snow'; if(id===T.WATER) return 'water'; return null; }
function pushUndo(x,y,oldId,newId,kind){ if(oldId===newId) return; undoStack.push({x,y,oldId,newId,kind}); if(undoStack.length>UNDO_LIMIT) undoStack.shift(); }
function undoLastChange(){ const e=undoStack.pop(); if(!e){ msg('Brak zmian'); return; } const cur=getTile(e.x,e.y); if(cur!==e.newId){ msg('Nie można cofnąć'); return; } if(e.kind==='place'){ setTile(e.x,e.y,e.oldId); const k=invKeyForTile(e.newId); if(k && !godMode) inv[k] = (inv[k]||0)+1; } else if(e.kind==='break'){ setTile(e.x,e.y,e.oldId); const info=INFO[e.oldId]; if(info && info.drop && inv[info.drop]>0 && !godMode) inv[info.drop]--; } if(MM.fallingSolids) MM.fallingSolids.recheckNeighborhood(e.x,e.y); if(MM.water) MM.water.onTileChanged(e.x,e.y,getTile); updateInventory(); updateHotbarCounts(); saveState(); msg('Cofnięto'); }
window.addEventListener('keydown',ev=>{ if(ev.key==='z' && !ev.ctrlKey && !ev.metaKey){ undoLastChange(); } });
// (legacy saveState/loadState removed – unified saveGame/loadGame used everywhere)
// Hotbar slot click: select OR (Shift/click again) open type remap popup
const hotSelectMenu=document.getElementById('hotSelectMenu');
const hotSelectOptions=document.getElementById('hotSelectOptions');
let hotSelectSlotIndex=-1;
function closeHotSelect(){ if(hotSelectMenu){ hotSelectMenu.style.display='none'; hotSelectSlotIndex=-1; } }
function openHotSelect(slot,anchorEl){ if(!hotSelectMenu) return; hotSelectSlotIndex=slot; hotSelectOptions.innerHTML='';
	const baseTypes=[
		{k:'GRASS',label:'Trawa'}, {k:'SAND',label:'Piasek'}, {k:'STONE',label:'Kamień'}, {k:'WOOD',label:'Drewno'}, {k:'LEAF',label:'Liść'}, {k:'SNOW',label:'Śnieg'}, {k:'WATER',label:'Woda'}
	];
	let types=[...baseTypes];
	if(godMode){ types.push({k:'CHEST_COMMON',label:'Skrzynia zwykła',col:'#b07f2c'}); types.push({k:'CHEST_RARE',label:'Skrzynia rzadka',col:'#a74cc9'}); types.push({k:'CHEST_EPIC',label:'Skrzynia epicka',col:'#e0b341'}); }
	types.forEach(t=>{ const b=document.createElement('button'); b.textContent=t.label; const baseBg='rgba(255,255,255,.08)'; const rareBg=t.col? t.col+'33': baseBg; const border=t.col? t.col+'88':'rgba(255,255,255,.15)'; b.style.cssText='text-align:left; background:'+rareBg+'; border:1px solid '+border+'; color:#fff; border-radius:8px; padding:4px 8px; cursor:pointer; font-size:12px;'; if(HOTBAR_ORDER[slot]===t.k) b.style.outline='2px solid #2c7ef8'; b.addEventListener('click',()=>{ HOTBAR_ORDER[slot]=t.k; closeHotSelect(); cycleHotbar(slot); msg('Slot '+(slot+4)+' -> '+t.label); }); hotSelectOptions.appendChild(b); });
	const rect=anchorEl.getBoundingClientRect(); hotSelectMenu.style.display='block'; hotSelectMenu.style.left=(rect.left + rect.width/2)+'px'; hotSelectMenu.style.top=(rect.top - 8)+'px'; hotSelectMenu.style.transform='translate(-50%,-100%)'; }
document.addEventListener('click',e=>{ if(hotSelectMenu && hotSelectMenu.style.display==='block'){ if(!hotSelectMenu.contains(e.target) && !(e.target.closest && e.target.closest('.hotSlot'))){ closeHotSelect(); } }});
document.querySelectorAll('.hotSlot').forEach((el,i)=>{ el.addEventListener('click',e=>{ if(e.shiftKey || (hotbarIndex===i && !isChestSelection(HOTBAR_ORDER[i]) && !isChestSelection(HOTBAR_ORDER[hotbarIndex]) && godMode)) { openHotSelect(i,el); } else { cycleHotbar(i); } }); });
// Left click mining convenience
// Simple particle + sound system for chest open
const particles=[]; const PARTICLE_CAP=800; function spawnBurst(x,y,tier){ const count=24 + (tier==='epic'?24:tier==='rare'?12:0); for(let i=0;i<count;i++){ if(particles.length>=PARTICLE_CAP) break; const ang=Math.random()*Math.PI*2; const sp= (Math.random()*2 + 1.5) * (tier==='epic'?1.6:tier==='rare'?1.3:1); particles.push({x,y, vx:Math.cos(ang)*sp, vy:Math.sin(ang)*sp*0.6-1, life:0, max:0.9+Math.random()*0.5, tier}); } playChestSound(tier); }
function updateParticles(dt){ for(let i=particles.length-1;i>=0;i--){ const p=particles[i]; p.life+=dt; p.x+=p.vx*dt*TILE; p.y+=p.vy*dt*TILE; p.vy+=8*dt; if(p.life>p.max) particles.splice(i,1); } if(particles.length>PARTICLE_CAP){ particles.splice(0, particles.length-PARTICLE_CAP); } }
function drawParticles(){ particles.forEach(p=>{ const alpha = 1 - p.life/p.max; ctx.fillStyle = p.tier==='epic'? 'rgba(224,179,65,'+alpha+')' : (p.tier==='rare'? 'rgba(167,76,201,'+alpha+')' : 'rgba(176,127,44,'+alpha+')'); ctx.fillRect(p.x -2, p.y -2, 4,4); }); }
let audioCtx=null; function playChestSound(tier){ try{ if(!audioCtx) audioCtx=new (window.AudioContext||window.webkitAudioContext)(); const o=audioCtx.createOscillator(); const g=audioCtx.createGain(); o.type='triangle'; let base=tier==='epic'?660: tier==='rare'?520:420; o.frequency.setValueAtTime(base,audioCtx.currentTime); o.frequency.linearRampToValueAtTime(base+ (tier==='epic'?240: tier==='rare'?160:80), audioCtx.currentTime+0.25); g.gain.setValueAtTime(0.001,audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(0.3,audioCtx.currentTime+0.03); g.gain.exponentialRampToValueAtTime(0.0001,audioCtx.currentTime+0.5); o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime+0.52); }catch(e){} }

canvas.addEventListener('pointerdown',e=>{ const {tx,ty}=eventToTile(e); const tileId=getTile(tx,ty); const info=MM.INFO[tileId];
	if(e.button===0){
		// Left click: attack mob (range + cooldown) first, else open chest, else mining
		const dxRange = Math.abs(tx - Math.floor(player.x)); const dyRange=Math.abs(ty - Math.floor(player.y));
		if(dxRange<=3 && dyRange<=3 && player.atkCd<=0 && MM.mobs && MM.mobs.attackAt && MM.mobs.attackAt(tx,ty)){ player.atkCd=0.35; return; }
		if(info && info.chestTier && MM.chests){
			const res=MM.chests.openChestAt(tx,ty);
			if(res){
				lastChestOpen={t:performance.now(),x:tx,y:ty};
				// Defer showing loot: push to inbox
				res.items.forEach(it=>{ it._inbox=true; });
				if(window.lootInbox){ window.lootInbox.push(...res.items); if(window.updateLootInboxIndicator) updateLootInboxIndicator(); }
				msg('Skrzynia '+info.chestTier+': +'+res.items.length+' przedm. (I aby zobaczyć)');
				spawnBurst((tx+0.5)*TILE,(ty+0.5)*TILE, info.chestTier);
				if(window.updateDynamicCustomization) updateDynamicCustomization();
			}
			return; // do not treat as mining
		}
		const dx=tx - Math.floor(player.x); const dy=ty - Math.floor(player.y); if(Math.abs(dx)<=2 && Math.abs(dy)<=2){ mineDir.dx = Math.sign(dx)||0; mineDir.dy = Math.sign(dy)||0; startMine(); }
	} else if(e.button===2){
		// Right click now reserved for placement only (opening moved to left)
		// (Placement handled in contextmenu / tryPlaceFromEvent)
	}
});

// Render
function draw(){ // Background first
 drawBackground();
 const viewX=Math.ceil(W/(TILE*zoom)); const viewY=Math.ceil(H/(TILE*zoom)); const sx=Math.floor(camX)-1; const sy=Math.floor(camY)-1; ctx.save(); ctx.scale(zoom,zoom); // pixel snapping to avoid seams
	const camRenderX = Math.round(camX*TILE*zoom)/ (TILE*zoom);
	const camRenderY = Math.round(camY*TILE*zoom)/ (TILE*zoom);
	ctx.translate(-camRenderX*TILE,-camRenderY*TILE);
	ctx.imageSmoothingEnabled=false; // avoid anti-alias gaps
	// render tiles (solids + passables) first
	drawWorldVisible(sx,sy,viewX,viewY);
	drawFallingBlocks();
	// cape behind player body but above tiles
	drawCape();
	// player body + overlays (back pass for vegetation done earlier)
	drawPlayer();
	// mobs
	if(MM.mobs && MM.mobs.draw) MM.mobs.draw(ctx,TILE,camX,camY,zoom);
	// particles (screen-space in world coords)
	drawParticles();
	// front vegetation pass (blades/leaves that should appear in front)
	if(VISUAL.animations){ drawAnimatedOverlays(sx,sy,viewX,viewY,'front'); }
	// Water overlay shimmer (after vegetation front to avoid overdraw? place before falling solids for clarity)
	if(MM.water){ MM.water.drawOverlay(ctx,TILE,getTile,sx,sy,viewX,viewY); }
	// Draw falling solids after terrain so they appear on top
	if(MM.fallingSolids){ MM.fallingSolids.draw(ctx,TILE); }
	// Ghost block preview
	if(ghostTile!=null){
		ctx.strokeStyle='rgba(255,255,255,0.4)';
		ctx.lineWidth=1;
		ctx.strokeRect(ghostX*TILE+0.5, ghostY*TILE+0.5, TILE-1, TILE-1);
	}
	if(mining){ ctx.strokeStyle='#fff'; ctx.strokeRect(mineTx*TILE+1,mineTy*TILE+1,TILE-2,TILE-2); const info=INFO[getTile(mineTx,mineTy)]||{hp:1}; const need=Math.max(0.1,info.hp/6); const p=mineTimer/need; ctx.fillStyle='rgba(255,255,255,.3)'; ctx.fillRect(mineTx*TILE, mineTy*TILE + (1-p)*TILE, TILE, p*TILE); }
	ctx.restore();
	// Screen-space atmospheric tint (after world scaling restore)
	applyAtmosphericTint();
	// HUD: health bar
	ctx.save(); const barW=200, barH=18; const pad=12; const x=pad, y=H - barH - pad; ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(x,y,barW,barH); const frac=player.hp/player.maxHp; const g=ctx.createLinearGradient(x,y,x+barW,y); g.addColorStop(0,'#ff3636'); g.addColorStop(1,'#ff9a3d'); ctx.fillStyle=g; ctx.fillRect(x,y,Math.max(0,barW*frac),barH); ctx.strokeStyle='rgba(255,255,255,0.3)'; ctx.lineWidth=2; ctx.strokeRect(x,y,barW,barH); ctx.fillStyle='#fff'; ctx.font='12px system-ui'; ctx.fillText('HP '+player.hp+' / '+player.maxHp, x+8, y-4); ctx.fillText('XP '+(player.xp||0), x+8, y+barH+12); // damage flash overlay
	if(player.hpInvul && performance.now()<player.hpInvul){ const alpha = (player.hpInvul - performance.now())/600; ctx.fillStyle='rgba(255,0,0,'+(0.25*alpha)+')'; ctx.fillRect(0,0,W,H); }
	ctx.restore(); }

// UI aktualizacja (inventory HUD removed)
const el={fps:document.getElementById('fps'),msg:document.getElementById('messages')};
function updateInventory(){
	// Keep only craft buttons enabled state and hotbar counts
	const cs=document.getElementById('craftStone'); if(cs) cs.disabled=!canCraftStone();
	const cd=document.getElementById('craftDiamond'); if(cd) cd.disabled=!canCraftDiamond();
	updateHotbarCounts(); saveState();
}
document.getElementById('craftStone').addEventListener('click', craftStone); document.getElementById('craftDiamond').addEventListener('click', craftDiamond);
// Menu / przyciski
document.getElementById('mapBtn')?.addEventListener('click',toggleMap);
const godBtn=document.getElementById('godBtn'); if(godBtn) godBtn.addEventListener('click',toggleGod);
updateGodBtn();
const menuBtn=document.getElementById('menuBtn'); const menuPanel=document.getElementById('menuPanel');
// Robust menu visibility control (handles cases where CSS forces display:flex)
let __menuScrollTop = 0; // remember scroll when closing
let __menuFocusTrapHandler = null; // focus trap for menu

function menuFocusTrap(e) {
	if (!menuPanel || menuPanel.hidden || menuPanel.style.display === 'none') return;
	if (e.key !== 'Tab') return;
	
	const focusables = [...menuPanel.querySelectorAll('button, input, select, [tabindex]:not([tabindex="-1"])')].filter(el => !el.disabled);
	if (!focusables.length) return;
	
	const first = focusables[0];
	const last = focusables[focusables.length - 1];
	
	if (e.shiftKey) {
		if (document.activeElement === first) {
			e.preventDefault();
			last.focus();
		}
	} else {
		if (document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	}
}

function setMenuVisible(on){
	if(!menuPanel || !menuBtn) return;
	if(on){
		menuPanel.hidden = false;
		menuPanel.style.display = 'flex';
	// restore scroll and focus for accessibility
	menuPanel.scrollTop = __menuScrollTop || 0;
		menuBtn.setAttribute('aria-expanded','true');
	// Install focus trap
	document.addEventListener('keydown', menuFocusTrap);
	__menuFocusTrapHandler = menuFocusTrap;
	try{ const firstBtn = menuPanel.querySelector('button'); if(firstBtn) firstBtn.focus(); }catch(e){}
	} else {
	__menuScrollTop = menuPanel.scrollTop || 0;
		menuPanel.hidden = true;
		menuPanel.style.display = 'none';
		menuBtn.setAttribute('aria-expanded','false');
	// Remove focus trap
	if (__menuFocusTrapHandler) {
		document.removeEventListener('keydown', __menuFocusTrapHandler);
		__menuFocusTrapHandler = null;
	}
	}
}
function closeMenu(){ setMenuVisible(false); }
// Ensure starts hidden even if the hidden attribute is ignored/removed
if(menuPanel){ setMenuVisible(false); }
menuBtn?.addEventListener('click',()=>{
	const willShow = menuPanel.hidden || menuPanel.style.display === 'none';
	setMenuVisible(willShow);
});
document.addEventListener('click',e=>{ if(!menuPanel || menuPanel.hidden || menuPanel.style.display==='none') return; if(menuPanel.contains(e.target)||menuBtn.contains(e.target)) return; closeMenu(); });
document.getElementById('radarMenuBtn')?.addEventListener('click',()=>{ radarFlash=performance.now()+1500; closeMenu(); });
// Close button & Escape support
document.getElementById('menuCloseBtn')?.addEventListener('click', closeMenu);
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape'){ closeMenu(); }});
// Inject debug time-of-day slider (non-intrusive) at end of menu only once
(function(){
	if(window.__timeSliderInjected) return; window.__timeSliderInjected=true;
	if(!menuPanel) return;
	// --- UI preferences (scale + visibility) ---
	const PREF_KEY='mm_ui_prefs_v1';
	function loadUIPrefs(){ try{ const raw=localStorage.getItem(PREF_KEY); if(!raw) return null; const o=JSON.parse(raw); return o&&typeof o==='object'?o:null; }catch(e){ return null; } }
	function saveUIPrefs(p){ try{ localStorage.setItem(PREF_KEY, JSON.stringify(p)); }catch(e){} }
	// capture base sizes once so scaling is consistent
	const root=document.documentElement; const cs=getComputedStyle(root);
	const BASE={ cell: parseFloat(cs.getPropertyValue('--cell'))||64, btn: parseFloat(cs.getPropertyValue('--btn'))||48, mine: parseFloat(cs.getPropertyValue('--mine'))||76 };
	function applyUIPrefs(p){ if(!p) return; const scale=Math.max(0.7, Math.min(1.6, Number(p.scale)||1)); root.style.setProperty('--cell', (BASE.cell*scale)+'px'); root.style.setProperty('--btn', (BASE.btn*scale)+'px'); root.style.setProperty('--mine', (BASE.mine*scale)+'px');
		function vis(id,on){ const el=document.getElementById(id); if(!el) return; el.style.display = on? '' : 'none'; }
		const show=p.show||{}; vis('hotbarWrap', show.hotbar!==false); vis('controls', !!show.controls); vis('dirRing', !!show.controls); vis('radarBtn', show.radar!==false); vis('craft', !!show.craft); const fpsEl=document.getElementById('fps'); if(fpsEl) fpsEl.parentElement.style.display = (show.fps===false)?'none':''; vis('messages', show.messages!==false);
		const cbtn=document.getElementById('craftToggleBtn'); if(cbtn){ cbtn.setAttribute('aria-expanded', String(!!show.craft)); cbtn.classList.toggle('toggled', !!show.craft); }
	}
	// Smarter defaults: mobile shows on‑screen controls by default and slightly larger UI
	const isMobile = matchMedia('(pointer:coarse)').matches || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent||'');
	const defaultPrefs={ scale:isMobile?1.1:1, show:{ hotbar:true, controls:isMobile, radar:true, craft:!isMobile, fps:true, messages:true } };
	let uiPrefs = Object.assign({}, defaultPrefs, loadUIPrefs()||{});
	applyUIPrefs(uiPrefs);
	// Settings section UI
	const uiWrap=document.createElement('div'); uiWrap.className='group'; uiWrap.style.cssText='flex-direction:column; align-items:stretch; margin-top:6px; border-top:1px solid rgba(255,255,255,.08); padding-top:6px;';
	const uiTitle=document.createElement('div'); uiTitle.textContent='Interfejs'; uiTitle.style.cssText='font-weight:600; opacity:.9; margin-bottom:4px;'; uiWrap.appendChild(uiTitle);
	// scale
	const scaleRow=document.createElement('label'); scaleRow.style.cssText='font-size:12px; display:flex; justify-content:space-between; gap:8px; align-items:center;'; scaleRow.textContent='Skala UI';
	const scaleVal=document.createElement('span'); scaleVal.style.cssText='font-size:11px; opacity:.7;'; scaleRow.appendChild(scaleVal);
	const scaleRange=document.createElement('input'); scaleRange.type='range'; scaleRange.min='0.8'; scaleRange.max='1.4'; scaleRange.step='0.01'; scaleRange.value=String(uiPrefs.scale||1);
	function updScale(){ scaleVal.textContent=(Number(scaleRange.value)*100).toFixed(0)+'%'; }
	updScale();
	uiWrap.appendChild(scaleRow); uiWrap.appendChild(scaleRange);
	scaleRange.addEventListener('input',()=>{ uiPrefs.scale=Number(scaleRange.value)||1; applyUIPrefs(uiPrefs); saveUIPrefs(uiPrefs); updScale(); });
	// toggles
	const toggles=[
		{ id:'hotbarWrap', key:'hotbar', label:'Pasek szybkiego wyboru' },
		{ id:'controls', key:'controls', label:'Sterowanie ekranowe (mobilne)' },
		{ id:'radarBtn', key:'radar', label:'Przycisk radaru' },
		{ id:'craft', key:'craft', label:'Panel rzemiosła' },
		{ id:'fpsPanel', key:'fps', label:'FPS' },
		{ id:'messages', key:'messages', label:'Komunikaty na górze' }
	];
	const keysOrder = toggles.map(t=>t.key);
	const grid=document.createElement('div'); grid.style.cssText='display:grid; grid-template-columns:repeat(2,minmax(120px,1fr)); gap:6px;';
	toggles.forEach(t=>{ const row=document.createElement('label'); row.style.cssText='display:flex; gap:8px; align-items:center; font-size:12px;'; const cb=document.createElement('input'); cb.type='checkbox'; const cur=(uiPrefs.show&&t.key in uiPrefs.show)? !!uiPrefs.show[t.key] : (defaultPrefs.show[t.key]); cb.checked = cur; const span=document.createElement('span'); span.textContent=t.label; row.appendChild(cb); row.appendChild(span); grid.appendChild(row); cb.addEventListener('change',()=>{ uiPrefs.show = uiPrefs.show||{}; uiPrefs.show[t.key]=cb.checked; applyUIPrefs(uiPrefs); saveUIPrefs(uiPrefs); }); });
	uiWrap.appendChild(grid);
	// Reset to defaults
	const resetRow=document.createElement('div'); resetRow.style.cssText='display:flex; justify-content:flex-end; margin-top:8px;'; const resetBtn=document.createElement('button'); resetBtn.textContent='Resetuj UI'; resetBtn.className='topbtn'; resetBtn.style.cssText='padding:6px 10px;'; resetRow.appendChild(resetBtn); uiWrap.appendChild(resetRow);
	resetBtn.addEventListener('click',()=>{ uiPrefs = JSON.parse(JSON.stringify(defaultPrefs)); applyUIPrefs(uiPrefs); saveUIPrefs(uiPrefs); scaleRange.value=String(uiPrefs.scale); updScale(); const boxes=[...grid.querySelectorAll('input[type="checkbox"]')]; boxes.forEach((cb,i)=>{ const key = keysOrder[i]; cb.checked = !!uiPrefs.show[key]; }); });
	menuPanel.appendChild(uiWrap);

	// Header Craft toggle button wiring
	const craftBtnTop=document.getElementById('craftToggleBtn');
	craftBtnTop?.addEventListener('click',()=>{
		uiPrefs.show = uiPrefs.show||{}; uiPrefs.show.craft = !uiPrefs.show.craft; applyUIPrefs(uiPrefs); saveUIPrefs(uiPrefs);
	});
	const wrap=document.createElement('div'); wrap.className='group'; wrap.style.cssText='flex-direction:column; align-items:stretch; margin-top:6px; border-top:1px solid rgba(255,255,255,.08); padding-top:6px;';
	const label=document.createElement('label'); label.style.cssText='font-size:12px; display:flex; justify-content:space-between; gap:8px; align-items:center;'; label.textContent='Czas doby';
	const span=document.createElement('span'); span.style.fontSize='11px'; span.style.opacity='0.7'; span.textContent='—'; label.appendChild(span);
	const range=document.createElement('input'); range.type='range'; range.min='0'; range.max='1'; range.step='0.0001'; range.value='0'; range.style.width='100%';
	const chkWrap=document.createElement('div'); chkWrap.style.cssText='display:flex; align-items:center; gap:6px; font-size:11px; margin-top:4px;';
	const chk=document.createElement('input'); chk.type='checkbox'; chk.id='timeOverrideChk';
	const chkLab=document.createElement('label'); chkLab.htmlFor='timeOverrideChk'; chkLab.textContent='Steruj ręcznie';
	chkWrap.appendChild(chk); chkWrap.appendChild(chkLab);
	wrap.appendChild(label); wrap.appendChild(range); wrap.appendChild(chkWrap);
	menuPanel.appendChild(wrap);
	window.__timeSliderEl=range;
	function upd(){ span.textContent=(parseFloat(range.value)*100).toFixed(2)+'%'; }
	range.addEventListener('input',()=>{ upd(); if(window.__timeOverrideActive){ window.__timeOverrideValue=parseFloat(range.value); }});
	chk.addEventListener('change',()=>{ window.__timeOverrideActive=chk.checked; if(chk.checked){ window.__timeOverrideValue=parseFloat(range.value); window.__timeSliderLocked=true; } else { window.__timeSliderLocked=false; } });
	upd();
	// Placeholder for mob spawn buttons (populated after mobs.js loads)
	const mobBox=document.createElement('div'); mobBox.id='mobSpawnBox'; mobBox.style.cssText='display:flex; flex-wrap:wrap; gap:4px; margin-top:6px;';
	const label2=document.createElement('div'); label2.textContent='Spawn Moby:'; label2.style.cssText='width:100%; font-size:11px; opacity:.7;'; mobBox.appendChild(label2);
	const placeholder=document.createElement('div'); placeholder.textContent='(Ładowanie...)'; placeholder.style.cssText='font-size:11px; opacity:.5;'; mobBox.appendChild(placeholder);
	wrap.appendChild(mobBox);
	// Expose population helper
	window.__populateMobSpawnButtons = function(){ const box=document.getElementById('mobSpawnBox'); if(!box) return; // clear existing buttons except label
		while(box.children.length>1) box.removeChild(box.lastChild);
		if(!(window.MM && MM.mobs && MM.mobs.species)) { const p=document.createElement('div'); p.textContent='(Brak systemu mobów)'; p.style.cssText='font-size:11px; opacity:.5;'; box.appendChild(p); return; }
		MM.mobs.species.forEach(id=>{ const b=document.createElement('button'); b.textContent=id; b.style.cssText='flex:1 1 70px; font-size:11px; padding:3px 6px;'; b.addEventListener('click',()=>{ if(MM.mobs.forceSpawn){ const ok=MM.mobs.forceSpawn(id, player, getTile); if(ok) msg('Spawn '+id); } }); box.appendChild(b); });
	};
	TIMER_MANAGER.setTimeout(() => { 
		if(window.__populateMobSpawnButtons) window.__populateMobSpawnButtons(); 
	}, 300, 'init_mob_buttons');
	window.addEventListener('mm-mobs-ready', () => { 
		if(window.__populateMobSpawnButtons) window.__populateMobSpawnButtons(); 
	});
})();
// Regeneracja świata z nowym ziarnem
document.getElementById('regenBtn')?.addEventListener('click',()=>{ setSeedFromInput(); regenWorld(); closeMenu(); });
function regenWorld(){ WORLD.clear(); seenChunks.clear(); mining=false; if(MM.fallingSolids) MM.fallingSolids.reset(); if(MM.water) MM.water.reset(); inv.grass=inv.sand=inv.stone=inv.diamond=inv.wood=inv.leaf=inv.snow=inv.water=0; inv.tools.stone=inv.tools.diamond=false; player.tool='basic'; hotbarIndex=0; // if god mode active, restore 100 stack after reset
	if(godMode){ if(!_preGodInventory) _preGodInventory={grass:0,sand:0,stone:0,diamond:0,wood:0,leaf:0,snow:0,water:0}; inv.grass=inv.sand=inv.stone=inv.diamond=inv.wood=inv.leaf=inv.snow=inv.water=100; }
	updateInventory(); updateHotbarSel(); placePlayer(true); saveState(); msg('Nowy świat seed '+worldSeed); }
document.getElementById('centerBtn').addEventListener('click',()=>{ camSX=player.x - (W/(TILE*zoom))/2; camSY=player.y - (H/(TILE*zoom))/2; camX=camSX; camY=camSY; });
document.getElementById('helpBtn').addEventListener('click',()=>{ const h=document.getElementById('help'); const show=h.style.display!=='block'; h.style.display=show?'block':'none'; document.getElementById('helpBtn').setAttribute('aria-expanded', String(show)); });
const radarBtn=document.getElementById('radarBtn'); radarBtn.addEventListener('click',()=>{ radarFlash=performance.now()+1500; }); let radarFlash=0;
function msg(t){ 
	el.msg.textContent = t; 
	
	// Use managed timeout for message clearing
	if (msg._managedId) {
		TIMER_MANAGER.clearTimeout(msg._managedId);
	}
	msg._managedId = TIMER_MANAGER.setTimeout(() => { 
		el.msg.textContent = ''; 
	}, 4000, 'msg_clear'); 
}

// FPS
let frames=0,lastFps=performance.now(); function updateFps(now){ frames++; if(now-lastFps>1000){ el.fps.textContent=frames+' FPS'+ (grassBudgetInfo? (' '+grassBudgetInfo):''); frames=0; lastFps=now; }}

// Spawn
function placePlayer(skipMsg){ const x=0; ensureChunk(0); let y=0; while(y<WORLD_H-1 && getTile(x,y)===T.AIR) y++; player.x=x+0.5; player.y=y-1; centerOnPlayer(); if(!skipMsg) msg('Seed '+worldSeed); }
function centerOnPlayer(){ revealAround(); camSX=player.x - (W/(TILE*zoom))/2; camSY=player.y - (H/(TILE*zoom))/2; camX=camSX; camY=camSY; initScarf(); }
(async function() {
const loaded=await loadGame();
if(!loaded){ placePlayer(); } else { centerOnPlayer(); }
updateInventory(); updateGodBtn(); updateHotbarSel(); if(!loaded) msg('Sterowanie: A/D/W + LPM kopie, PPM stawia (4-9 wybór). G=Bóg (nieskończone skoki), M=Mapa, C=Centrum, H=Pomoc'); else msg('Wczytano zapis – miłej gry!');
})();
// Ghost preview placement
let ghostTile=null, ghostX=0, ghostY=0;
canvas.addEventListener('pointermove',e=>{ if(isBlockingOverlayOpen()) return; const {tx,ty}=eventToTile(e); if(getTile(tx,ty)===T.AIR){ ghostX=tx; ghostY=ty; ghostTile=selectedTileId(); } else ghostTile=null; });
initGrassControls();

// Pętla
let last=performance.now(); 
let isLoopRunning = false;

function loop(ts){ 
	if(isLoopRunning) return; // Prevent duplicate loops
	
	// Respect timer manager pause state
	if (TIMER_MANAGER.isGamePaused || !TIMER_MANAGER.isPageVisible) {
		// Schedule next frame but don't process game logic
		TIMER_MANAGER.animationFrame = requestAnimationFrame(loop);
		return;
	}
	
	isLoopRunning = true;
	
	const dt=Math.min(0.05,(ts-last)/1000); 
	last=ts; 
	
	// smooth zoom interpolation
	if(Math.abs(zoomTarget-zoom)>0.0001){ 
		zoom += (zoomTarget-zoom)*Math.min(1, dt*8); 
	}
	
	physics(dt); 
	if(player.atkCd>0) player.atkCd-=dt; 
	updateMining(dt); 
	updateFallingBlocks(dt); 
	
	if(MM.fallingSolids){ 
		MM.fallingSolids.update(getTile,setTile,dt); 
	} 
	if(MM.water){ 
		MM.water.update(getTile,setTile,dt); 
	} 
	if(MM.mobs && MM.mobs.update) {
		MM.mobs.update(dt, player, getTile); 
	}
	
	updateParticles(dt); 
	updateCape(dt); 
	updateBlink(ts); 
	draw(); 
	
	if(ts<radarFlash){ 
		radarBtn.classList.add('pulse'); 
	} else {
		radarBtn.classList.remove('pulse'); 
	}
	
	updateFps(ts); 
	
	isLoopRunning = false;
	TIMER_MANAGER.animationFrame = requestAnimationFrame(loop); 
} 

// Initialize managed timers after timer system is set up
TIMER_MANAGER.setInterval(() => { 
	saveGame(false); 
}, 60000, 'autosave');

TIMER_MANAGER.setInterval(() => { 
	/* keep cycleStart anchored; could adjust for pause logic later */ 
}, 60000, 'background_cycle');

// Automatic chunk cache cleanup to prevent memory leaks
TIMER_MANAGER.setInterval(() => {
	cleanupChunkCache();
}, 30000, 'chunk_cache_cleanup');

// Start the main game loop with managed animation frame
TIMER_MANAGER.animationFrame = requestAnimationFrame(loop);

// (Re)define loot popup helpers if not already present (guard for reloads)
// Deferred loot inbox system
if(!window.__lootPopupInit){
	window.__lootPopupInit=true;
	window.lootInbox = window.lootInbox || [];
	window.lootStash = window.lootStash || [];
	let lootInboxUnread = 0; // separate unread counter so viewing doesn't erase items
	const LOOT_INBOX_KEY='mm_loot_inbox_v1';
	const LOOT_STASH_KEY='mm_loot_stash_v1';
	const LOOT_UI_KEY='mm_loot_ui_v1';
	try{ const saved=localStorage.getItem(LOOT_INBOX_KEY); if(saved){ const parsed=JSON.parse(saved); if(Array.isArray(parsed.items)){ window.lootInbox = parsed.items; lootInboxUnread = parsed.unread|0; } } }catch(e){}
	try{ const savedS=localStorage.getItem(LOOT_STASH_KEY); if(savedS){ const parsed=JSON.parse(savedS); if(Array.isArray(parsed)){ window.lootStash = parsed; } } }catch(e){}
	const lootInboxBtn=document.getElementById('lootInboxBtn');
	const lootInboxCount=document.getElementById('lootInboxCount');
	const lootPopup=document.getElementById('lootPopup');
	const lootDim=document.getElementById('lootDim');
	const lootItemsBox=document.getElementById('lootPopupItems');
	const tabInbox=document.getElementById('lootTabInbox');
	const tabStash=document.getElementById('lootTabStash');
	const sortSel=document.getElementById('lootSort');
	const filtersWrap=document.getElementById('lootFilters');
	const lootEquipAllBtn=document.getElementById('lootEquipAll');
	const lootKeepAllBtn=document.getElementById('lootKeepAll');
	const lootCloseBtn=document.getElementById('lootClose');
	const lootApplySelBtn=document.getElementById('lootApplySel');
	const lootStashSelBtn=document.getElementById('lootStashSel');
	const lootUnstashSelBtn=document.getElementById('lootUnstashSel');
	const lootDiscardSelBtn=document.getElementById('lootDiscardSel');
	let lootPrevFocus=null;
	function persistInbox(){ 
		try { 
			const data = JSON.stringify({items: window.lootInbox, unread: lootInboxUnread});
			STORAGE_QUOTA_MANAGER.safeSetItem(LOOT_INBOX_KEY, data, { allowCleanup: false });
		} catch (e) {
			console.warn('Failed to persist inbox:', e);
		} 
	}
	
	function persistStash(){ 
		try { 
			const data = JSON.stringify(window.lootStash || []);
			STORAGE_QUOTA_MANAGER.safeSetItem(LOOT_STASH_KEY, data, { allowCleanup: false });
		} catch (e) {
			console.warn('Failed to persist stash:', e);
		} 
	}
	function updateLootInboxIndicator(){ const count=lootInboxUnread; if(!lootInboxBtn) return; if(count>0){ lootInboxBtn.style.display='inline-block'; lootInboxCount.textContent=''+count; lootInboxBtn.classList.add('pulseNew'); } else { lootInboxBtn.style.display='none'; lootInboxCount.textContent=''; lootInboxBtn.classList.remove('pulseNew'); } }
	window.updateLootInboxIndicator=updateLootInboxIndicator;
	// Utilities and state
	function ensureKey(it){ if(!it) return; if(!it.time) it.time=Date.now(); if(!it._key){ it._key = [it.kind||'?', it.id||'unknown', it.unique||'', it.time].join('|'); }
	}
	function tierWeight(t){ return t==='epic'?3 : t==='rare'?2 : t==='common'?1 : 0; }
	function currentOf(kind, all){ if(!all) return null; const curId = kind==='cape'? MM.customization.capeStyle : kind==='eyes'? MM.customization.eyeStyle : MM.customization.outfitStyle; const list = kind==='cape'? all.capes : kind==='eyes'? all.eyes : all.outfits; return list ? list.find(i=>i.id===curId) : null; }
	function fmtMult(v){ return (v||1).toFixed(2)+'x'; }
	function computeScore(it, cur){ if(!it) return 0; let s=0; // Relative improvements vs current
		const c=cur||{}; if(typeof it.airJumps==='number') s += (it.airJumps - (c.airJumps||0)) * 2.0;
		if(typeof it.visionRadius==='number') s += (it.visionRadius - (c.visionRadius||0)) * 0.2;
		if(typeof it.moveSpeedMult==='number') s += ((it.moveSpeedMult||1) - (c.moveSpeedMult||1)) * 1.0;
		if(typeof it.jumpPowerMult==='number') s += ((it.jumpPowerMult||1) - (c.jumpPowerMult||1)) * 0.8;
		if(typeof it.mineSpeedMult==='number') s += ((it.mineSpeedMult||1) - (c.mineSpeedMult||1)) * 0.8;
		s += tierWeight(it.tier)*0.1; return s; }
	let currentTab='inbox';
	let activeKinds = new Set(['cape','eyes','outfit']);
	let selectedKeys = new Set();
	// Load UI state
	(function initLootUIState(){ try{ const raw=localStorage.getItem(LOOT_UI_KEY); if(raw){ const st=JSON.parse(raw); if(st && (st.tab==='inbox'||st.tab==='stash')) currentTab=st.tab; if(st && st.sort && sortSel){ sortSel.value=st.sort; }
		if(st && Array.isArray(st.kinds)){ activeKinds = new Set(st.kinds.filter(k=>k==='cape'||k==='eyes'||k==='outfit')); if(filtersWrap){ filtersWrap.querySelectorAll('.chip').forEach(ch=>{ const k=ch.getAttribute('data-kind'); if(k && activeKinds.has(k)) ch.classList.add('on'); else ch.classList.remove('on'); }); } }
	} }catch(e){} })();
	function persistLootUI(){ 
		try { 
			const kinds = [...activeKinds]; 
			const sort = sortSel ? sortSel.value : 'recommend'; 
			const tab = currentTab; 
			const data = JSON.stringify({tab, sort, kinds});
			STORAGE_QUOTA_MANAGER.safeSetItem(LOOT_UI_KEY, data, { allowCleanup: false });
		} catch (e) {
			console.warn('Failed to persist loot UI state:', e);
		} 
	}
	function getActiveList(){ return currentTab==='inbox' ? window.lootInbox : window.lootStash; }
	function setTab(tab){ currentTab=tab; if(tab==='inbox'){ tabInbox.classList.add('sel'); tabStash.classList.remove('sel'); lootUnstashSelBtn.style.display='none'; lootStashSelBtn.style.display=''; } else { tabStash.classList.add('sel'); tabInbox.classList.remove('sel'); lootUnstashSelBtn.style.display=''; lootStashSelBtn.style.display='none'; } selectedKeys.clear(); rebuildList(); }
	function applyFiltersAndSort(items){ const all=MM.getCustomizationItems? MM.getCustomizationItems():null; const curByKind={ cape: currentOf('cape',all), eyes: currentOf('eyes',all), outfit: currentOf('outfit',all) }; const filtered = items.filter(it=>{ ensureKey(it); return activeKinds.has(it.kind); }); const mode=sortSel?.value||'recommend'; filtered.sort((a,b)=>{ const ca=curByKind[a.kind], cb=curByKind[b.kind]; if(mode==='tier'){ const d=tierWeight(b.tier)-tierWeight(a.tier); if(d!==0) return d; return (b.time||0)-(a.time||0); }
		if(mode==='newest'){ return (b.time||0)-(a.time||0); }
		if(mode==='kind'){ return (a.kind||'').localeCompare(b.kind||'') || ((a.name||a.id||'').localeCompare(b.name||b.id||'')); }
		if(mode==='name'){ return (a.name||a.id||'').localeCompare(b.name||b.id||''); }
		// recommend (default)
		const sa=computeScore(a,ca), sb=computeScore(b,cb); if(sb!==sa) return sb-sa; return (b.time||0)-(a.time||0);
	}); return {list:filtered, curByKind}; }
	function buildRows(){ 
		// Clear existing content and any event listeners
		while (lootItemsBox.firstChild) {
			lootItemsBox.removeChild(lootItemsBox.firstChild);
		}
		
		const src=getActiveList(); 
		const {list,curByKind} = applyFiltersAndSort(src);
		
		// Use event delegation instead of attaching listeners to each element
		function handleRowClick(e) {
			const row = e.target.closest('.lootRow');
			if (!row || !row.__item) return;
			
			const it = row.__item;
			const equip = e.target.closest('button[data-action="equip"]');
			const keep = e.target.closest('button[data-action="keep"]');
			const discard = e.target.closest('button[data-action="discard"]');
			
			if (equip) {
				if(it.kind==='cape') MM.customization.capeStyle=it.id; 
				else if(it.kind==='eyes') MM.customization.eyeStyle=it.id; 
				else MM.customization.outfitStyle=it.id; 
				if(MM.recomputeModifiers) MM.recomputeModifiers(); 
				window.dispatchEvent(new CustomEvent('mm-customization-change')); 
				
				// Disable buttons and dim row
				row.querySelectorAll('button').forEach(btn => btn.disabled = true);
				row.style.opacity = '.45';
				persistInbox(); persistStash();
				return;
			}
			
			if (keep) {
				const arr = getActiveList();
				const idx = arr.indexOf(it);
				if (idx >= 0) arr.splice(idx, 1);
				
				if(currentTab==='inbox'){ 
					window.lootStash.push(it); 
					persistStash(); persistInbox(); 
				} else { 
					window.lootInbox.push(it); 
					persistInbox(); persistStash(); 
				}
				rebuildList();
				return;
			}
			
			if (discard) {
				if(MM.dynamicLoot){ 
					const pool = it.kind==='cape'? MM.dynamicLoot.capes : it.kind==='eyes'? MM.dynamicLoot.eyes : MM.dynamicLoot.outfits; 
					const idx=pool? pool.indexOf(it):-1; 
					if(idx>=0) pool.splice(idx,1); 
				} 
				if(MM.addDiscardedLoot) MM.addDiscardedLoot(it.id); 
				if(MM.chests && MM.chests.saveDynamicLoot) MM.chests.saveDynamicLoot(); 
				
				const arr = getActiveList();
				const idx = arr.indexOf(it);
				if (idx >= 0) arr.splice(idx, 1);
				
				persistInbox(); persistStash(); rebuildList();
				return;
			}
			
			// Selection toggle (only if not clicking a button)
			if (!e.target.closest('button')) {
				const sel = row.querySelector('.selMark');
				if(selectedKeys.has(it._key)){ 
					selectedKeys.delete(it._key); 
					row.classList.remove('sel'); 
					if (sel) sel.textContent=''; 
				} else { 
					selectedKeys.add(it._key); 
					row.classList.add('sel'); 
					if (sel) sel.textContent='✓'; 
				}
			}
		}
		
		// Remove existing event listener to prevent duplicates
		if (lootItemsBox.__clickHandler) {
			lootItemsBox.removeEventListener('click', lootItemsBox.__clickHandler);
		}
		
		// Add single delegated event listener
		lootItemsBox.__clickHandler = handleRowClick;
		lootItemsBox.addEventListener('click', handleRowClick);
		
		list.forEach(it=>{ 
			const row=document.createElement('div'); 
			row.className='lootRow '+(it.tier||''); 
			row.__item=it; 
			
			const left=document.createElement('div'); 
			const title=document.createElement('div'); 
			title.style.fontWeight='600'; 
			title.textContent=(it.name||it.id)+' ['+(it.kind||'?')+']'; 
			
			if(it.unique){ 
				const b=document.createElement('span'); 
				b.textContent='★ '+it.unique; 
				b.style.marginLeft='6px'; 
				b.style.fontSize='10px'; 
				b.style.color='#ffd54a'; 
				title.appendChild(b); 
			}
			
			// Delta badge
			const cur=curByKind[it.kind]; 
			const sc=computeScore(it,cur); 
			const badge=document.createElement('span'); 
			badge.className='deltaBadge'+(sc<0?' worse':''); 
			badge.textContent = (sc>0? '+':'')+sc.toFixed(2);
			title.appendChild(badge);
			left.appendChild(title);
			
			const stats=document.createElement('div'); 
			stats.className='lootStats';
			function diff(label, curV, newV, betterHigh=true, fmt=v=>v){ 
				if(newV==null) return; 
				const base=curV==null? (label==='move'||label==='jump'||label==='mine'?1: (label==='air'?0: (label==='vision'?10:null))):curV; 
				const better = betterHigh? newV>base : newV<base; 
				const worse = betterHigh? newV<base : newV>base; 
				const cls=better?'diffPlus': worse?'diffMinus':''; 
				stats.innerHTML+= label+': <span class="'+cls+'">'+fmt(newV)+(newV!==base? (' ('+fmt(base)+')'):'')+'</span><br>'; 
			}
			diff('air', cur&&cur.airJumps, it.airJumps, true, v=>'+'+v);
			diff('vision', cur&&cur.visionRadius, it.visionRadius, true, v=>v);
			diff('move', cur&&cur.moveSpeedMult, it.moveSpeedMult, true, fmtMult);
			diff('jump', cur&&cur.jumpPowerMult, it.jumpPowerMult, true, fmtMult);
			diff('mine', cur&&cur.mineSpeedMult, it.mineSpeedMult, true, fmtMult);
			left.appendChild(stats); 
			row.appendChild(left);
			
			const btns=document.createElement('div'); 
			btns.style.display='flex'; 
			btns.style.flexDirection='column'; 
			btns.style.gap='6px';
			
			// Use data attributes instead of event listeners for delegation
			const equip=document.createElement('button'); 
			equip.textContent='Wyposaż'; 
			equip.setAttribute('data-action', 'equip');
			
			const keep=document.createElement('button'); 
			keep.textContent= currentTab==='inbox'? 'Schowaj' : 'Do skrzynki'; 
			keep.className='sec'; 
			keep.setAttribute('data-action', 'keep');
			
			const discard=document.createElement('button'); 
			discard.textContent='Odrzuć'; 
			discard.className='danger';
			discard.setAttribute('data-action', 'discard');
			
			btns.appendChild(equip); 
			btns.appendChild(keep); 
			btns.appendChild(discard); 
			row.appendChild(btns);
			
			// Selection toggle
			const sel=document.createElement('div'); 
			sel.className='selMark'; 
			sel.textContent = selectedKeys.has(it._key)? '✓' : '';
			row.appendChild(sel);
			if(selectedKeys.has(it._key)) row.classList.add('sel');
			
			lootItemsBox.appendChild(row);
		});
	}
	function sweepNonCosmetic(arr){ if(!Array.isArray(arr)) return arr; const keep=[]; let moved=0; for(const it of arr){ if(it && (it.kind==='cape'||it.kind==='eyes'||it.kind==='outfit')){ keep.push(it); continue; } // treat as resource drop: {item, qty}
		if(it && it.item){ const k=it.item; const q=Math.max(1, it.qty|0); if(inv && typeof inv[k]==='number'){ inv[k]+=q; moved+=q; } }
	}
	if(moved>0){ try{ updateInventory&&updateInventory(); saveState&&saveState(); }catch(e){} }
	return keep; }
	function rebuildList(){ // Ensure keys and clean incompatible entries
		if(currentTab==='inbox'){ window.lootInbox = sweepNonCosmetic(window.lootInbox||[]); persistInbox(); }
		if(currentTab==='stash'){ window.lootStash = sweepNonCosmetic(window.lootStash||[]); persistStash(); }
		(getActiveList()||[]).forEach(ensureKey); buildRows(); }
	function openInbox(){ // honor saved tab if stash chosen and has items
		const preferTab = (function(){ try{ const st=JSON.parse(localStorage.getItem(LOOT_UI_KEY)||'null'); return st&&st.tab; }catch(e){ return null; } })();
		const tab = (preferTab==='stash' && (window.lootStash&&window.lootStash.length))? 'stash' : 'inbox';
	setTab(tab); lootInboxUnread=0; updateLootInboxIndicator(); persistInbox();
	// Clear any stuck movement keys so player stops when panel opens
	['a','d','arrowleft','arrowright','w','arrowup',' ','arrowdown','s'].forEach(k=>{ keys[k]=false; keysOnce.delete(k); });
	lootPopup.classList.add('show'); lootDim.style.display='block';
	lootPrevFocus=document.activeElement; installTrap(); const first=lootPopup.querySelector('button'); if(first) first.focus(); rebuildList(); }
	function closeInbox(){ lootPopup.classList.remove('show'); lootDim.style.display='none';
		removeTrap(); if(lootPrevFocus && lootPrevFocus.focus) lootPrevFocus.focus(); }
	function installTrap(){ function handler(e){ if(!lootPopup.classList.contains('show')) return; if(e.key==='Escape'){ closeInbox(); return; } if(e.key==='Tab'){ const f=[...lootPopup.querySelectorAll('button,select,.chip')].filter(el=>!el.disabled); if(!f.length) return; const first=f[0], last=f[f.length-1]; if(e.shiftKey){ if(document.activeElement===first){ e.preventDefault(); last.focus(); } } else { if(document.activeElement===last){ e.preventDefault(); first.focus(); } } } } window.addEventListener('keydown',handler); lootPopup.__trapHandler=handler; }
	function removeTrap(){ if(lootPopup.__trapHandler){ window.removeEventListener('keydown', lootPopup.__trapHandler); lootPopup.__trapHandler=null; } }
	lootInboxBtn?.addEventListener('click',openInbox);
	lootCloseBtn?.addEventListener('click',closeInbox); lootDim?.addEventListener('click',closeInbox);
	lootEquipAllBtn?.addEventListener('click',()=>{ // Equip best across visible by score
		const all=MM.getCustomizationItems? MM.getCustomizationItems():null; const curByKind={ cape: currentOf('cape',all), eyes: currentOf('eyes',all), outfit: currentOf('outfit',all) };
		const rows=[...lootItemsBox.querySelectorAll('.lootRow')]; const best={}; rows.forEach(r=>{ const it=r.__item; if(!it) return; const sc=computeScore(it,curByKind[it.kind]); if(!best[it.kind] || sc>best[it.kind].sc){ best[it.kind]={it,sc}; } });
		Object.values(best).forEach(v=>{ const it=v.it; if(it.kind==='cape') MM.customization.capeStyle=it.id; else if(it.kind==='eyes') MM.customization.eyeStyle=it.id; else MM.customization.outfitStyle=it.id; }); if(MM.recomputeModifiers) MM.recomputeModifiers(); window.dispatchEvent(new CustomEvent('mm-customization-change')); persistInbox(); });
	lootKeepAllBtn?.addEventListener('click',closeInbox);
	// Selection actions
	lootApplySelBtn?.addEventListener('click',()=>{ const chosen={}; (getActiveList()||[]).forEach(ensureKey); (getActiveList()||[]).forEach(it=>{ if(!selectedKeys.has(it._key)) return; const all=MM.getCustomizationItems? MM.getCustomizationItems():null; const cur=currentOf(it.kind,all); const sc=computeScore(it,cur); if(!chosen[it.kind] || sc>chosen[it.kind].sc){ chosen[it.kind]={it,sc}; } }); Object.values(chosen).forEach(v=>{ const it=v.it; if(it.kind==='cape') MM.customization.capeStyle=it.id; else if(it.kind==='eyes') MM.customization.eyeStyle=it.id; else MM.customization.outfitStyle=it.id; }); if(MM.recomputeModifiers) MM.recomputeModifiers(); window.dispatchEvent(new CustomEvent('mm-customization-change')); selectedKeys.clear(); rebuildList(); });
	lootStashSelBtn?.addEventListener('click',()=>{ if(currentTab!=='inbox') return; const keep=[]; (window.lootInbox||[]).forEach(it=>{ ensureKey(it); if(selectedKeys.has(it._key)){ window.lootStash.push(it); } else { keep.push(it); } }); window.lootInbox=keep; persistInbox(); persistStash(); selectedKeys.clear(); rebuildList(); });
	lootUnstashSelBtn?.addEventListener('click',()=>{ if(currentTab!=='stash') return; const keep=[]; (window.lootStash||[]).forEach(it=>{ ensureKey(it); if(selectedKeys.has(it._key)){ window.lootInbox.push(it); } else { keep.push(it); } }); window.lootStash=keep; persistInbox(); persistStash(); selectedKeys.clear(); rebuildList(); });
	lootDiscardSelBtn?.addEventListener('click',()=>{ const src = getActiveList(); const keep=[]; (src||[]).forEach(it=>{ ensureKey(it); if(!selectedKeys.has(it._key)){ keep.push(it); return; } if(MM.dynamicLoot){ const pool = it.kind==='cape'? MM.dynamicLoot.capes : it.kind==='eyes'? MM.dynamicLoot.eyes : MM.dynamicLoot.outfits; const idx=pool? pool.indexOf(it):-1; if(idx>=0) pool.splice(idx,1); } if(MM.addDiscardedLoot) MM.addDiscardedLoot(it.id); }); if(MM.chests && MM.chests.saveDynamicLoot) MM.chests.saveDynamicLoot(); if(currentTab==='inbox'){ window.lootInbox=keep; persistInbox(); } else { window.lootStash=keep; persistStash(); } selectedKeys.clear(); rebuildList(); });
	// Tabs, sort, filters
	tabInbox?.addEventListener('click',()=>{ setTab('inbox'); persistLootUI(); });
	tabStash?.addEventListener('click',()=>{ setTab('stash'); persistLootUI(); });
	sortSel?.addEventListener('change',()=>{ rebuildList(); persistLootUI(); });
	function toggleChip(chip){ const k=chip.getAttribute('data-kind'); if(!k) return; const on=activeKinds.has(k); if(on){ activeKinds.delete(k); chip.classList.remove('on'); chip.setAttribute('aria-pressed','false'); } else { activeKinds.add(k); chip.classList.add('on'); chip.setAttribute('aria-pressed','true'); } rebuildList(); persistLootUI(); }
	filtersWrap?.addEventListener('click',e=>{ const chip=e.target.closest('.chip'); if(!chip) return; toggleChip(chip); });
	filtersWrap?.addEventListener('keydown',e=>{ const chip=e.target.closest('.chip'); if(!chip) return; if(e.key==='Enter'||e.key===' '){ e.preventDefault(); toggleChip(chip); }});
	window.addEventListener('keydown',e=>{ if(e.key.toLowerCase()==='i'){ if(lootPopup.classList.contains('show')) closeInbox(); else openInbox(); } });
	MM.onLootGained = function(items){ if(window.updateDynamicCustomization) updateDynamicCustomization(); if(window.lootInbox){ items.forEach(it=>{ it.time=Date.now(); ensureKey(it); }); window.lootInbox.push(...items); lootInboxUnread += items.length; updateLootInboxIndicator(); persistInbox(); } };
	// Initial indicator on load (if persisted)
	updateLootInboxIndicator();
	// Prepare first render state
	(window.lootInbox||[]).forEach(ensureKey); (window.lootStash||[]).forEach(ensureKey);
}
