// World generation v2 — continental elevation, ridged mountains, carved valleys,
// real oceans & lakes, plus a layered cave system (cheese caverns, winding tunnel
// networks, surface ravines, vertical shafts and aquifer-flooded cave lakes).
//
// Coordinate convention: y grows DOWNWARD (row 0 = sky). surfaceHeight(x) returns
// the row of the first solid tile, so a SMALLER row means HIGHER terrain. Internally
// terrain is modelled as elevation in tiles ABOVE sea level: row = seaLevel - elev.
// (The previous generator mixed those two conventions up, which is why mountains
// generated as basins and oceans as dry plateaus.)
import { WORLD_H } from '../constants.js';
import { worldHostility as HOSTILITY } from './world_hostility.js';
import { consumeFreshWorldSeed } from './new_game.js';
import { activeChallenge, applyWorldMods } from './challenge.js';
window.MM = window.MM || {};
const WG = {};
// the one-shot new-game seed is captured here and honored again at the boot
// branch below — the 'auto' seed input must never reroll an explicit choice
const QUEUED_SEED = consumeFreshWorldSeed(typeof sessionStorage!=='undefined' ? sessionStorage : null);
WG.worldSeed = QUEUED_SEED || 12345;

// Persistent world generation settings (tunable via UI). v2 storage key — v1 values
// belong to the old inverted height model and must not leak into this one.
WG.settings = (function(){
	const DEF = {
		seaLevel: 62,            // row of the global water line
		oceanFrac: 0.22,         // continental threshold: higher => more/larger oceans
		                         // (0.26 ≈ mostly seas, with the occasional wide ocean)
		mountainAmp: 38,         // max ridged lift above highlands (tiles)
		mountainThreshold: 0.46, // mountain mask gate (lower => more ranges)
		valleyGain: 30,          // max valley carve depth (tiles)
		valleyCutoff: 0.58,      // valley mask gate (higher => rarer valleys)
		detailAmp: 1.0,          // small-scale roughness multiplier
		caveDensity: 1.0,        // cavern volume multiplier
		tunnelDensity: 1.0,      // winding tunnel width multiplier
		ravineFreq: 1.0,         // surface ravine frequency multiplier
		aquiferLevel: 108,       // row below which carved caves flood into lakes
		lakeMaxDepth: 12,        // depth cap for perched valley lakes
		forestDensityMul: 1.0
	};
	try{ const raw=localStorage.getItem('mm_world_settings_v2'); if(raw){ const obj=JSON.parse(raw);
		// migrate old defaults that made oceans dominate long travel corridors
		if(obj.oceanFrac===0.32 || obj.oceanFrac===0.26) delete obj.oceanFrac;
		return Object.assign({}, DEF, obj); } }catch(e){}
	return Object.assign({}, DEF);
})();
WG.getSettings = function(){ return Object.assign({}, WG.settings); };
WG.setSettings = function(p){ if(!p||typeof p!=='object') return; Object.assign(WG.settings,p); try{ localStorage.setItem('mm_world_settings_v2', JSON.stringify(WG.settings)); }catch(e){} WG.clearCaches(); if(window.MM && MM.world && MM.world.clearHeights) MM.world.clearHeights(); };
WG.setSeedFromInput = function(){ const inp=document.getElementById('seedInput'); if(!inp) return; let v=inp.value.trim(); if(!v||v==='auto'){ WG.worldSeed = Math.floor(Math.random()*1e9); inp.value=String(WG.worldSeed); } else { let h=0; for(let i=0;i<v.length;i++){ h=(h*131 + v.charCodeAt(i))>>>0; } WG.worldSeed = h||1; } WG.clearCaches(); if(window.MM && MM.world && MM.world.clearHeights) MM.world.clearHeights(); };

// --- Noise toolkit -----------------------------------------------------------
// Legacy float hash — terrain texturing calls it with non-integer args (randSeed(wx*7.13))
WG.randSeed = function(n){ const x=Math.sin(n*127.1 + WG.worldSeed*0.000123)*43758.5453; return x-Math.floor(x); };
// Integer lattice hashes (seed-mixed, well distributed)
function ih(n, off){ let h=(n|0) + Math.imul(off|0,374761393) + Math.imul(WG.worldSeed|0,668265263); h=Math.imul(h^(h>>>15),2246822519); h=Math.imul(h^(h>>>13),3266489917); h^=h>>>16; return (h>>>0)/4294967296; }
function ih2(ix, iy, off){ let h=Math.imul(ix|0,374761393) ^ Math.imul(iy|0,668265263) ^ Math.imul(off|0,1274126177) ^ Math.imul(WG.worldSeed|0,-1640531527); h=Math.imul(h^(h>>>15),2246822519); h=Math.imul(h^(h>>>13),3266489917); h^=h>>>16; return (h>>>0)/4294967296; }
function fade(t){ return t*t*(3-2*t); }
WG.valueNoise = function(x, wavelength, off){ const p=x/wavelength; const i=Math.floor(p); const f=fade(p-i); const a=ih(i,off|0), b=ih(i+1,off|0); return a+(b-a)*f; };
function fbm1(x, wl, oct, off){ let amp=1,sum=0,norm=0,w=wl,o=off; for(let i=0;i<oct;i++){ sum+=amp*WG.valueNoise(x,w,o); norm+=amp; amp*=0.5; w/=2.17; o+=37; } return sum/norm; }
WG.ridge = function(x, wl, off){ const v=WG.valueNoise(x, wl||120, off||7777); return 1-Math.abs(2*v-1); };
function vnoise2(x,y,sx,sy,off){ const px=x/sx, py=y/sy; const ix=Math.floor(px), iy=Math.floor(py); const fx=fade(px-ix), fy=fade(py-iy); const a=ih2(ix,iy,off), b=ih2(ix+1,iy,off), c=ih2(ix,iy+1,off), d=ih2(ix+1,iy+1,off); return a+(b-a)*fx+(c-a)*fy+(a-b-c+d)*fx*fy; }
function fbm2(x,y,sx,sy,oct,off){ let amp=1,sum=0,norm=0,wx=sx,wy=sy,o=off; for(let i=0;i<oct;i++){ sum+=amp*vnoise2(x,y,wx,wy,o); norm+=amp; amp*=0.55; wx/=1.93; wy/=1.93; o+=101; } return sum/norm; }
function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
function smoothstep(a,b,x){ const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); }
// Stretch 0..1 noise away from its 0.5 mean so biome thresholds see real extremes
function spread(v,k){ return clamp(0.5+(v-0.5)*k,0,1); }

// Folded ("ridged") noise over value noise is biased high because raw values cluster
// at 0.5; spreading before the fold yields rarer, sharper crests
function ridgeSharp(x, wl, off, k){ const v=spread(WG.valueNoise(x,wl,off), k||1.8); return 1-Math.abs(2*v-1); }

// Rare seeded volcano candidates. The column model later decides whether the
// candidate actually emerges above dry land; oceans/lakes ignore it.
const VOLCANO_CELL_W = 440;
const VOLCANO_SPAWN_SAFE_RADIUS = 220;
const volcanoCellCache = new Map();
function volcanoCandidateForCell(cell){
	let v = volcanoCellCache.get(cell);
	if(v!==undefined) return v;
	const approxCenter = Math.round((cell+0.5)*VOLCANO_CELL_W);
	const roughHostility = HOSTILITY.at(approxCenter);
	const gate = ih(cell, 9101);
	const gateThreshold = clamp(0.78 + roughHostility.volcanoGateDelta, 0.56, 0.86);
	if(gate<gateThreshold){ volcanoCellCache.set(cell,null); return null; }
	const center = Math.round((cell+0.5)*VOLCANO_CELL_W + (ih(cell,9102)-0.5)*VOLCANO_CELL_W*0.58);
	if(Math.abs(center)<VOLCANO_SPAWN_SAFE_RADIUS){ volcanoCellCache.set(cell,null); return null; }
	const host = HOSTILITY.at(center);
	const sizeMult = host.volcanoSizeMult || 1;
	const radius = Math.round((18 + Math.floor(ih(cell,9103)*13)) * sizeMult);
	const height = Math.round((24 + Math.floor(ih(cell,9104)*16)) * (1 + host.hot * 0.48));
	const crater = 2 + Math.floor(ih(cell,9105)*2);
	const pipe = 1 + Math.floor(ih(cell,9106)*2);
	const reservoir = Math.max(5, Math.floor(radius*0.34));
	v = {center,radius,height,crater,pipe,reservoir,cell};
	volcanoCellCache.set(cell,v);
	return v;
}
function rawVolcanoAt(x){
	const cell = Math.floor(x/VOLCANO_CELL_W);
	let best = null;
	for(let dc=-1; dc<=1; dc++){
		const v = volcanoCandidateForCell(cell+dc);
		if(!v) continue;
		const d = Math.abs(x-v.center);
		if(d<=v.radius && (!best || d<best.d)) best = Object.assign({d}, v);
	}
	return best;
}
function volcanoSiteEmerges(v,currentX,row,biome,island,sea,mountainMask,pv){
	if(!v) return false;
	if(Math.round(currentX)===Math.round(v.center)){
		const rugged = biome===7 || biome===3 || mountainMask>0.55 || pv>0.50;
		return rugged && biome!==5 && biome!==6 && biome!==8 && row<sea-4 && !island;
	}
	const centerCol = WG.column(v.center);
	return !!(centerCol && centerCol.volcano && centerCol.volcano.center===v.center);
}
WG.volcanoAt = function(x){ const c=WG.column(Math.round(x)); return c && c.volcano ? c.volcano : null; };
// Volcano body lookup that is NOT clipped by the surface cone mask. Deep magma
// chambers, roots and dikes can be wider than the cone above them, so the
// vertical layer model resolves the emerged volcano within `reach` tiles of the
// cone radius instead of relying on the per-column volcano field.
WG.volcanoInfluenceAt = function(x, reach){
	x = Math.round(x);
	reach = (typeof reach==='number' && reach>0) ? reach : 48;
	const cell = Math.floor(x/VOLCANO_CELL_W);
	let best = null;
	for(let dc=-1; dc<=1; dc++){
		const v = volcanoCandidateForCell(cell+dc);
		if(!v) continue;
		const d = Math.abs(x-v.center);
		if(d>v.radius+reach || (best && d>=best.d)) continue;
		const c = WG.column(v.center);
		if(c && c.volcano && c.volcano.center===v.center) best = Object.assign({d}, v);
	}
	return best;
};
WG.nearestVolcano = function(x, dir, maxCells){
	dir = dir<0 ? -1 : 1;
	maxCells = (typeof maxCells==='number' && maxCells>0) ? Math.floor(maxCells) : 420;
	const startCell = Math.floor(Math.round(x)/VOLCANO_CELL_W);
	let best = null;
	for(let step=0; step<=maxCells; step++){
		const v = volcanoCandidateForCell(startCell + step*dir);
		if(!v) continue;
		if(dir>0 && v.center<=x+1) continue;
		if(dir<0 && v.center>=x-1) continue;
		const c = WG.column(v.center);
		if(!c.volcano || c.volcano.center!==v.center) continue;
		const dist = Math.abs(v.center-x);
		if(!best || dist<best.distance) best = Object.assign({distance:dist}, c.volcano);
	}
	return best;
};

// Rare devastated-city districts: finite urban biomes with terraced footing and
// dense above-ground structures generated later by world.js.
const CITY_CELL_W = 1700;
const CITY_SPAWN_SAFE_RADIUS = 520;
const cityCellCache = new Map();
function cityCandidateForCell(cell){
	let v = cityCellCache.get(cell);
	if(v!==undefined) return v;
	const gate = ih(cell, 9301);
	if(gate<0.58){ cityCellCache.set(cell,null); return null; }
	const center = Math.round((cell+0.5)*CITY_CELL_W + (ih(cell,9302)-0.5)*CITY_CELL_W*0.46);
	if(Math.abs(center)<CITY_SPAWN_SAFE_RADIUS){ cityCellCache.set(cell,null); return null; }
	const radius = 150 + Math.floor(ih(cell,9303)*170);
	const floorElev = 4 + Math.floor(ih(cell,9304)*9);
	const density = 0.62 + ih(cell,9305)*0.28;
	const decay = 0.35 + ih(cell,9306)*0.55;
	const skyline = ih(cell,9307);
	// Architecture school + silhouette motif make every district read differently:
	// 0 stone spires, 1 glass downtown, 2 foundry sprawl, 3 terraced ziggurats,
	// 4 brutalist megablocks. world.js consumes both when erecting structures.
	const arch = Math.min(4, Math.floor(ih(cell,9315)*5));
	const motif = ih(cell,9316);
	v = {center,radius,floorElev,density,decay,skyline,arch,motif,cell};
	cityCellCache.set(cell,v);
	return v;
}
function rawCityAt(x){
	const cell = Math.floor(x/CITY_CELL_W);
	let best = null;
	for(let dc=-1; dc<=1; dc++){
		const v = cityCandidateForCell(cell+dc);
		if(!v) continue;
		const d = Math.abs(x-v.center);
		if(d<=v.radius && (!best || d<best.d)) best = Object.assign({d}, v);
	}
	return best;
}

// --- Climate -------------------------------------------------------------------
// 2 octaves + strong spread so cold/hot and wet/dry extremes actually occur
WG.temperature = function(x){ return HOSTILITY.climateTemperature(x, spread(fbm1(x,2600,2,5001),2.2)); };
WG.moisture    = function(x){ return HOSTILITY.climateMoisture(x, spread(fbm1(x,1900,2,6001),2.2)); };

// --- Continental spline ----------------------------------------------------------
// cont (0..1) → base elevation in tiles above sea level. oceanFrac shifts the
// shoreline: continentalness below it is under water (abyss → shelf → shore).
function contSpline(c, oc){
	const pts=[[0,-30],[oc*0.55,-22],[oc*0.85,-10],[oc,-3],[oc+0.07,2],[0.55,8],[0.72,16],[0.88,24],[1.001,31]];
	// enforce strictly increasing x so extreme oceanFrac settings cannot fold the spline
	for(let i=1;i<pts.length;i++){ if(pts[i][0]<=pts[i-1][0]) pts[i][0]=pts[i-1][0]+0.001; }
	if(c<=pts[0][0]) return pts[0][1];
	for(let i=1;i<pts.length;i++){
		if(c<=pts[i][0]){ const [x0,y0]=pts[i-1], [x1,y1]=pts[i]; const t=(c-x0)/(x1-x0); const u=t*t*(3-2*t); return y0+(y1-y0)*u; }
	}
	return pts[pts.length-1][1];
}

// Abyssal ocean profile: extra floor drop applied to open-sea columns beyond the
// legacy shelf clamp, so real oceans dive to within a few tiles of the sealed
// bedrock basin instead of the old ~30-tile shelf.
const ABYSS_MAX_EXTRA = 34;

// Long continental lows can otherwise form multi-thousand-block oceans. These
// deterministic shoal bands raise occasional archipelagos inside deep basins,
// breaking crossings without removing seas altogether.
const OCEAN_BREAKERS=[
	{maxElev:-1.0, gateW:1050, gateOff:1951, gate:0.44, ridgeW:520, ridgeOff:1952, spread:2.0, th:0.58, base:-2.2, lift:8.2, islandAt:0},
	{maxElev:-0.6, gateW:640, gateOff:2051, gate:0.42, ridgeW:310, ridgeOff:2052, spread:2.0, th:0.60, base:-1.4, lift:7.6, islandAt:0}
];
function applyOceanBreaker(elev,island,xw,cfg){
	if(elev>=cfg.maxElev) return {elev,island};
	if(WG.valueNoise(xw,cfg.gateW,cfg.gateOff)<=cfg.gate) return {elev,island};
	const shoal=ridgeSharp(xw,cfg.ridgeW,cfg.ridgeOff,cfg.spread);
	if(shoal<=cfg.th) return {elev,island};
	const t01=(shoal-cfg.th)/(1-cfg.th);
	const archElev=cfg.base+t01*cfg.lift;
	if(archElev<=elev) return {elev,island};
	return {elev:archElev,island:island || archElev>cfg.islandAt};
}

// --- Aquifer profile ---------------------------------------------------------------
// The underground water table is a warped regional surface, not a flat world row:
// broad folds swing it by tens of tiles, ridged basins pool it locally, and whole
// stretches run dry (their caves stay open all the way into the deep sections).
// world_layers couples the deep-section water line to this same profile so mid
// and low water behave as one connected system. `aquiferLevel` stays the mean.
WG.aquiferAt = function(x, row, biome){
	const S = WG.settings;
	const base = (S.aquiferLevel===undefined) ? 108 : S.aquiferLevel;
	const fold = (fbm1(x,640,2,811)-0.5)*38 + (fbm1(x,210,2,812)-0.5)*14;
	const basin = ridgeSharp(x,470,813,1.9);
	const dry = smoothstep(0.60,0.80,WG.valueNoise(x,1500,814));
	let level = base + fold + dry*58 - (basin>0.70 ? (basin-0.70)*46 : 0);
	if(biome===5 || biome===6) level -= 9;       // seas/lakes keep saturated ground
	else if(biome===4) level -= 6;               // swamps sit on shallow water tables
	else if(biome===3) level += 7;               // deserts drain deep
	else if(biome===7) level += 8;               // ranges shed water downslope
	const sea = (S.seaLevel===undefined) ? 62 : S.seaLevel;
	const floor = Math.max(sea+4, (Number.isFinite(row)?row:sea)+8);
	return Math.round(clamp(level, floor, WORLD_H+40));
};

// --- Column model -----------------------------------------------------------------
// Everything derived from x is computed once per column and cached.
const colCache = new Map();
WG.clearCaches = function(){ colCache.clear(); volcanoCellCache.clear(); cityCellCache.clear(); oceanSegCache.clear(); };
WG.column = function(x){
	let c = colCache.get(x); if(c) return c;
	if(colCache.size>80000) colCache.clear();
	const S = WG.settings;
	const sea = S.seaLevel;
	// Domain warp keeps coastlines/ranges from looking like uniform sine bands
	const warp = (fbm1(x,760,2,901)-0.5)*240 + (WG.valueNoise(x,140,902)-0.5)*36;
	const xw = x + warp;
	const cont = spread(fbm1(xw,4300,3,101),1.55); // continentalness: ocean ↔ inland
	const ero  = spread(fbm1(xw,1700,3,201),1.45); // erosion: 1 flat, 0 dramatic relief
	const pv   = clamp(0.68*ridgeSharp(xw,520,301)+0.46*ridgeSharp(xw,170,302),0,1); // ridged peaks
	const mountainMask = smoothstep(S.mountainThreshold, S.mountainThreshold+0.24, cont*0.62+(1-ero)*0.52);
	let elev = contSpline(cont, S.oceanFrac);
	elev += mountainMask*Math.pow(pv,1.7)*S.mountainAmp;
	// Valleys: deep carves through hills/ranges; floors flatten just below the water line
	const vMask = clamp(0.74*ridgeSharp(xw,980,401)+0.42*ridgeSharp(xw,300,402),0,1);
	let valleyDepth = 0;
	if(vMask>S.valleyCutoff && elev>-2){
		const tv=(vMask-S.valleyCutoff)/(1-S.valleyCutoff);
		valleyDepth = Math.pow(tv,1.6)*S.valleyGain*(0.45+0.75*mountainMask+0.3*(1-ero));
		elev = Math.max(elev-valleyDepth, Math.min(elev,-4)); // never trench inland below -4
	}
	// Desert islands: rare ridged shoals lift the sea bed into a sandy islet with a
	// shallow shelf around it. A slow gate keeps most water open, so a sea usually
	// stays clear and a long ocean crossing is broken by the occasional palm island.
	let island=false;
	if(elev<-2 && WG.valueNoise(xw,1500,951)>0.58){
		const isl=ridgeSharp(xw,300,952,2.0);
		if(isl>0.72){
			const t01=(isl-0.72)/0.28;          // 0 = shelf edge → 1 = island crest
			const islandElev=-5+t01*9;          // -5 shoal rising to ~+4 dune top
			if(islandElev>elev){ elev=islandElev; island = islandElev>-1.5; }
		}
	}
	for(const breaker of OCEAN_BREAKERS){
		const shaped=applyOceanBreaker(elev,island,xw,breaker);
		elev=shaped.elev; island=shaped.island;
	}
	const t = WG.temperature(x), m = WG.moisture(x);
	// Erosion-scaled roughness: alpine terrain is jagged, plains stay calm
	let rough = (fbm1(x,64,3,501)-0.5)*(2.5+9*(1-ero)+7*mountainMask)*S.detailAmp;
	if(valleyDepth>4) rough *= clamp(1-(valleyDepth-4)*0.06,0.25,1); // calm valley floors
	if(island) rough *= 0.4;   // islets stay gentle dunes
	else if(elev<-3) rough *= 0.55; // calm sea beds
	elev += rough;
	let row = Math.round(sea-elev);
	row = clamp(row, 8, Math.min(sea+31, WORLD_H-34));
	// Abyssal deepening: real oceans plunge far below the old shelf cap, down toward
	// the bedrock basin. Scaled by both continentalness (open sea vs coastal water)
	// and the shelf's own depth so shorelines/islet shelves stay continuous — the
	// profile reads beach → shelf → slope → abyss with no sudden underwater cliffs.
	if(!island && elev<-3){
		const openSea = 1 - smoothstep(S.oceanFrac*0.5, S.oceanFrac+0.04, cont);
		const depthT = clamp((-elev-3)/22, 0, 1);
		const trench = 0.85 + 0.30*fbm1(xw,700,2,977);
		const abyssExtra = Math.pow(depthT,1.25)*openSea*ABYSS_MAX_EXTRA*trench;
		if(abyssExtra>0.5) row = clamp(Math.round(row+abyssExtra), 8, WORLD_H-16);
	}
	let elevF = sea-row;
	let city = null;
	const cityCand = rawCityAt(x);
	if(cityCand && !island && cont>S.oceanFrac+0.08 && elevF>-5){
		const edge = 1-cityCand.d/cityCand.radius;
		const core = smoothstep(0.08,0.55,edge);
		const cityRow = Math.round(sea-cityCand.floorElev);
		const scar = Math.round((WG.valueNoise(x,52,9308)-0.5)*2*(1-core));
		row = Math.round(row*(1-core*0.86) + cityRow*(core*0.86)) + scar;
		row = clamp(row, 8, Math.min(sea-3, WORLD_H-34));
		elevF = sea-row;
		city = Object.assign({edge,core}, cityCand);
	}
	// Biome classification (ids kept from v1, plus 8 Devastated City)
	let biome;
	if(city) biome = 8;
	else if(elevF<-2.5) biome = (cont<S.oceanFrac+0.08)?5:6;            // open sea vs flooded inland valley
	else if(valleyDepth>10 && elevF>2 && m>0.42) biome=6;          // perched valley lake basin
	else if(mountainMask>0.55 && (pv>0.55||elevF>22)) biome=7;
	else if(elevF>26) biome=7;
	else if(t<0.31) biome=2;
	else if(t>0.64 && m<0.42 && elevF<18) biome=3;
	else if(m>0.72 && elevF<8 && ero>0.45) biome=4;
	else if(m<0.46) biome=1;
	else biome=0;
	// Islets above the waterline are sandy desert isles regardless of climate
	if(island && elevF>-2.5) biome=3;
	let beach = (elevF>=-3 && elevF<=2.5 && cont<S.oceanFrac+0.12);
	let volcano = null;
	const vCand = rawVolcanoAt(x);
	if(volcanoSiteEmerges(vCand,x,row,biome,island,sea,mountainMask,pv)){
		const cone = clamp(1-vCand.d/vCand.radius,0,1);
		const lift = vCand.height*Math.pow(cone,0.82);
		const craterBite = Math.pow(clamp(1-vCand.d/Math.max(1,vCand.crater+2),0,1),1.5)*6;
		row = Math.round(clamp(row-lift+craterBite, 8, Math.min(sea+31, WORLD_H-34)));
		elevF = sea-row;
		beach = false;
		biome = 7;
		city = null;
		volcano = vCand;
	}
	// Cave control fields
	const entrance = WG.valueNoise(x,230,701)>0.80;               // hillside cave mouths
	const rv = WG.ridge(xw,1300,801);
	const rvGate = 1-0.035*Math.max(0.0001,S.ravineFreq);
	let ravine=0, ravineDepth=0;
	if(S.ravineFreq>0 && rv>rvGate && elevF>2 && !beach && !island && biome!==8){
		// The domain warp can cancel x movement (dwarp/dx ≈ -1) and hold the ridge
		// noise at its peak for hundreds of columns, so the raw gate used to carve
		// box canyons that swallowed the whole screen (seed 6862 near x=1600:
		// ~150 columns wide, ~54 deep — rendered as a black void). Trace the gated
		// span and shape an explicit V profile with a hard half-width cap instead.
		const rvAt=(xi)=>{ const w=(fbm1(xi,760,2,901)-0.5)*240 + (WG.valueNoise(xi,140,902)-0.5)*36; return WG.ridge(xi+w,1300,801); };
		const RAVINE_HALF_MAX=14, RAVINE_SPAN_MAX=44, TRACE=RAVINE_SPAN_MAX+2;
		let L=x, R=x;
		for(let i=0;i<TRACE && rvAt(L-1)>rvGate;i++) L--;
		for(let i=0;i<TRACE && rvAt(R+1)>rvGate;i++) R++;
		// A span wider than any legit ravine is the warp plateau — no canyon at all.
		if(R-L<=RAVINE_SPAN_MAX){
			const center=(L+R)/2;
			const lateral=Math.abs(x-center)/Math.max(1,Math.min((R-L)/2,RAVINE_HALF_MAX));
			if(lateral<1){
				const peak=(rv-rvGate)/(1-rvGate);
				ravine=clamp(peak*(1-lateral*lateral),0,1);
				ravineDepth=ravine>0 ? 16+48*ravine : 0;
			}
		}
	}
	const aquifer = WG.aquiferAt(x, row, biome);
	c = {row,biome,elev:sea-row,cont,ero,pv,mountainMask,valleyDepth,t,m,beach,island,entrance,ravine,ravineDepth,aquifer,volcano,city};
	colCache.set(x,c); return c;
};
WG.surfaceHeight = function(x){ return WG.column(x).row; };
WG.biomeType = function(x){ return WG.column(x).biome; };

// --- Ocean bedrock basins -----------------------------------------------------
// Every wide stretch of surface water sits in a sealed bedrock basin ("skała
// macierzysta"): from a thin sediment bed under the ocean floor all the way to
// the world bottom, every column of the segment generates as unmineable bedrock.
// Crossing a real ocean therefore means going OVER the water (boats) — never
// tunneling under it. Ponds and small seas below the span threshold stay open
// underneath so ordinary spelunking around lakes keeps working.
const OCEAN_SEAL_MIN_SPAN = 96;   // contiguous water columns needed to count as ocean
const OCEAN_SEAL_SEDIMENT = 3;    // sand/clay bed rows kept between floor and bedrock
const OCEAN_SEAL_SCAN_CAP = 4000; // per-direction scan bound (breakers cap real runs earlier)
const OCEAN_SEAL_EDGE_BLEND = 18;  // softens the basin jacket near coastlines
const OCEAN_SEAL_SHOULDER = 9;     // short bedrock tendrils under adjacent shore biomes
const oceanSegCache = new Map();  // x -> segment object (shared per run) or null
WG.OCEAN_SEAL_MIN_SPAN = OCEAN_SEAL_MIN_SPAN;
WG.OCEAN_SEAL_SEDIMENT = OCEAN_SEAL_SEDIMENT;
WG.OCEAN_SEAL_EDGE_BLEND = OCEAN_SEAL_EDGE_BLEND;
WG.OCEAN_SEAL_SHOULDER = OCEAN_SEAL_SHOULDER;
WG.oceanBasinAt = function(x){
	x = Math.round(x);
	const hit = oceanSegCache.get(x);
	if(hit!==undefined) return hit;
	if(oceanSegCache.size>120000) oceanSegCache.clear();
	const SEA = WG.settings.seaLevel;
	if(!(WG.column(x).row>SEA)){ oceanSegCache.set(x,null); return null; }
	let L=x, R=x;
	while(x-L<OCEAN_SEAL_SCAN_CAP && WG.column(L-1).row>SEA) L--;
	while(R-x<OCEAN_SEAL_SCAN_CAP && WG.column(R+1).row>SEA) R++;
	const width = R-L+1;
	// Only genuinely oceanic segments seal: wide flooded inland valleys (biome 6
	// lakes) stay open underneath so spelunking around big lakes keeps working.
	let openSeaCols = 0;
	if(width>=OCEAN_SEAL_MIN_SPAN){
		for(let i=L;i<=R;i++){ if(WG.column(i).biome===5) openSeaCols++; }
	}
	const seg = (width>=OCEAN_SEAL_MIN_SPAN && openSeaCols>=width*0.55) ? {left:L, right:R, width} : null;
	for(let i=L;i<=R;i++) oceanSegCache.set(i,seg);
	return seg;
};
function oceanSealEdgeExtra(x,seg){
	const edge=Math.min(Math.abs(x-seg.left),Math.abs(seg.right-x));
	if(edge>=OCEAN_SEAL_EDGE_BLEND) return 0;
	const k=1-smoothstep(0,OCEAN_SEAL_EDGE_BLEND,edge);
	const n=WG.valueNoise(x,19,9661)*0.65 + WG.valueNoise(x,7,9667)*0.35;
	const branch=(WG.valueNoise(x,31,9673)>0.58 ? 3 : 0);
	return Math.round(k*(5+n*8+branch));
}
function oceanShoulderBasinAt(x){
	const SEA=WG.settings.seaLevel;
	const col=WG.column(x);
	if(col.row>SEA) return null;
	let best=null;
	for(let d=1; d<=OCEAN_SEAL_SHOULDER; d++){
		const l=WG.oceanBasinAt(x-d);
		if(l && x>l.right && x-l.right===d){ best={seg:l,dist:d,side:1}; break; }
		const r=WG.oceanBasinAt(x+d);
		if(r && x<r.left && r.left-x===d){ best={seg:r,dist:d,side:-1}; break; }
	}
	return best;
}
// Row from which the basin bedrock jacket starts. Ocean core columns seal under a
// thin sediment bed; coastline columns blend deeper, and nearby shore columns get
// short underground shoulders so the seal reads as geology instead of a ruler cut.
WG.oceanSealTop = function(x){
	x=Math.round(x);
	const seg=WG.oceanBasinAt(x);
	if(seg){
		return Math.min(WORLD_H-1, WG.column(x).row + OCEAN_SEAL_SEDIMENT + oceanSealEdgeExtra(x,seg));
	}
	const shoulder=oceanShoulderBasinAt(x);
	if(!shoulder) return null;
	const col=WG.column(x);
	const shoreNoise=Math.round(WG.valueNoise(x,13,9689)*4);
	const fade=shoulder.dist/OCEAN_SEAL_SHOULDER;
	return Math.min(WORLD_H-1, Math.round(Math.max(col.row+8+shoulder.dist+shoreNoise, WG.settings.seaLevel+7+fade*13+shoreNoise)));
};
WG.cityAt = function(x){ const c=WG.column(Math.round(x)); return c && c.city ? c.city : null; };
function biomeRunAt(x,biome,origin,limit){
	x=Math.round(x); biome=biome|0;
	const runLimit=Math.max(1,Math.floor(Number.isFinite(limit)?limit:4096));
	let L=x, R=x, guard=0;
	while(guard++<runLimit && WG.biomeType(L-1)===biome) L--;
	guard=0;
	while(guard++<runLimit && WG.biomeType(R+1)===biome) R++;
	const center=Math.round((L+R)/2);
	const reference=Number.isFinite(origin)?Math.round(origin):x;
	const nearest=reference<L ? L : (reference>R ? R : x);
	return {left:L,right:R,center,entry:x,nearest,biome,distance:Math.abs(nearest-reference),surface:WG.surfaceHeight(nearest)};
}
WG.nearestBiome = function(x,biome,dir,maxDistance){
	if(typeof biome!=='number' || biome<0 || biome>8) return null;
	x=Math.round(Number.isFinite(x)?x:0); biome=biome|0;
	dir = dir<0 ? -1 : (dir>0 ? 1 : 0);
	maxDistance = (typeof maxDistance==='number' && maxDistance>0) ? Math.floor(maxDistance) : 60000;
	const minX=x-maxDistance, maxX=x+maxDistance;
	const currentIsTarget = WG.biomeType(x)===biome;
	const currentRun = currentIsTarget ? biomeRunAt(x,biome,x,maxDistance+1) : null;
	const hitAt=(wx,direction)=>{
		const run=biomeRunAt(wx,biome,x,4096);
		run.dir=direction;
		return run;
	};
	if(dir<0){
		const start=currentRun ? currentRun.left-1 : x;
		for(let wx=start; wx>=minX; wx--){
			if(WG.biomeType(wx)===biome) return hitAt(wx,-1);
		}
		return null;
	}
	if(dir>0){
		const start=currentRun ? currentRun.right+1 : x;
		for(let wx=start; wx<=maxX; wx++){
			if(WG.biomeType(wx)===biome) return hitAt(wx,1);
		}
		return null;
	}
	for(let d=0; d<=maxDistance; d++){
		const lx=x-d, rx=x+d;
		if(lx>=minX && (!currentRun || lx<currentRun.left || lx>currentRun.right) && WG.biomeType(lx)===biome) return hitAt(lx,-1);
		if(d!==0 && rx<=maxX && (!currentRun || rx<currentRun.left || rx>currentRun.right) && WG.biomeType(rx)===biome) return hitAt(rx,1);
	}
	return null;
};
// Compat shims for older callers
WG.macroElev = function(x){ return clamp(0.5+WG.column(x).elev/64,0,1); };
WG.oceanMask = function(x){ return 1-WG.column(x).cont; };
WG.valleyMask = function(x){ const c=WG.column(x); return clamp(c.valleyDepth/(WG.settings.valleyGain||30),0,1); };

// --- Cave query ------------------------------------------------------------------
// Returns 0 = solid, 1 = open cave air, 2 = flooded (cave lake / aquifer water).
WG.caveAt = function(x, y, colOpt){
	const c = colOpt || WG.column(x);
	const s = c.row, depth = y-s;
	if(depth<0) return 0;
	const bottomBlend = clamp((y-(WORLD_H-18))/18,0,1);
	const S = WG.settings;
	const submerged = s>=S.seaLevel-1 || c.biome===6; // don't pierce sea/lake beds at gen time
	let carved = false;
	// Ravines: jagged canyon open to the sky; band strength tapers depth → V profile
	if(c.ravine>0 && !submerged){
		const jag = 0.75+0.5*(vnoise2(x,y,11,7,821)-0.5);
		if(depth < c.ravineDepth*jag) carved = true;
	}
	if(!carved){
		const margin = submerged?9:(c.entrance?0:5);  // protect the crust except at cave mouths
		if(depth<Math.max(1,margin)) return 0;
		const dprog = clamp((depth-margin)/60,0,1);
		// Cheese caverns — larger and more common with depth
		const cav = fbm2(x,y,64,36,3,1001);
		if(cav > 0.80-0.13*dprog-0.06*(S.caveDensity-1)-bottomBlend*0.025) carved = true;
		// Winding tunnels — two crossing systems form branching networks
		if(!carved){
			let w = (0.012+0.011*dprog+bottomBlend*0.004)*S.tunnelDensity;
			if(c.entrance && depth<16) w += 0.045*(1-depth/16); // widen mouths near surface
			const t1 = fbm2(x,y,110,46,2,1101);
			if(Math.abs(t1-0.5)<w) carved = true;
			else { const t2 = fbm2(x,y,74,30,2,1201); if(Math.abs(t2-0.5)<w*0.8) carved = true; }
		}
		// Rare vertical shafts connecting cave layers
		if(!carved && (WG.valueNoise(x,340,1301)>0.76 || (bottomBlend>0.35 && WG.valueNoise(x,260,1501)>0.72))){
			const sh = vnoise2(x,y,14,90,1401);
			if(Math.abs(sh-0.5)<0.04+bottomBlend*0.006) carved = true;
		}
		if(!carved && bottomBlend>0){
			const bridge = fbm2(x,y,150,28,2,1502);
			if(bridge>0.90-bottomBlend*0.035) carved = true;
		}
	}
	if(!carved) return 0;
	const waterTransition = clamp((y-(WORLD_H-28))/28,0,1);
	const aquiferWarp = waterTransition>0
		? (WG.valueNoise(x,86,1505)-0.5)*20*waterTransition + (WG.valueNoise(x,23,1506)-0.5)*8*waterTransition
		: 0;
	if(y>=c.aquifer+aquiferWarp){
		if(waterTransition>0){
			if(waterTransition>0.05){
				const rarePocket = vnoise2(x,y,35,17,1507)>0.955 && fbm2(x,y,88,31,2,1508)>0.62;
				return rarePocket ? 2 : 1;
			}
			const pocket = vnoise2(x,y,42,20,1503);
			const channel = fbm2(x,y,120,34,2,1504);
			const keepWater = pocket>0.72+waterTransition*0.20 || Math.abs(channel-0.5)<0.010+0.006*(1-waterTransition);
			return keepWater ? 2 : 1;
		}
		return 2;
	}
	return 1;
};

// --- Biome fraction map around a column, used for soft material transitions ----
WG.biomeFrac = function(x, radius){
	radius = (typeof radius==='number' && radius>=1)? radius : 3;
	const counts = new Map();
	const total = radius*2 + 1;
	for(let dx=-radius; dx<=radius; dx++){
		const b = WG.biomeType(x+dx);
		counts.set(b, (counts.get(b)||0) + 1);
	}
	const fr = {};
	counts.forEach((v,k)=>{ fr[k] = v/total; });
	for(let id=0; id<=8; id++){ if(fr[id]===undefined) fr[id]=0; }
	return fr;
};

// --- Loot / ore helpers ------------------------------------------------------------
WG.chestNoise = function(x){ return WG.valueNoise(x,55,1333); };
WG.chestPlace = function(x){ return WG.chestNoise(x) > 0.94; };
// Coal forms in compact seams through ordinary underground rock. It starts below
// the shallow crust, is most common in mid-depth strata, and gets a mild boost
// beside cave walls where exposed seams are fun to spot while tunneling.
WG.coalChance = function(y, nearCave){
	const d=clamp((y-36)/88,0,1);
	const mid=clamp(1-Math.abs(d-0.46)*1.9,0,1);
	return (0.030 + mid*0.080 + d*0.018) * (nearCave?1.25:1);
};
WG.coalVeinAt = function(x,y,nearCave){
	const chance=WG.coalChance(y,!!nearCave);
	if(chance<=0) return false;
	const seam=Math.abs(fbm2(x,y,92,19,3,1701)-0.5) < chance*0.34;
	if(!seam) return false;
	const body=fbm2(x,y,24,17,2,1801);
	return body>0.57 || WG.randSeed(x*7.73+y*0.37)<chance*0.42;
};
WG.goldVeinChance = function(y, nearCave){
	const d=clamp((y-48)/(WORLD_H-58),0,1);
	const mid=clamp(1-Math.abs(d-0.58)*1.55,0,1);
	return Math.min(0.34, (0.105 + mid*0.145 + d*0.035) * (nearCave?1.08:1));
};
WG.goldVeinAt = function(x,y,nearCave){
	void nearCave;
	x=Math.floor(Number(x)||0);
	y=Math.floor(Number(y)||0);
	const cellW=16, cellH=9;
	const gx0=Math.floor((x-7)/cellW), gx1=Math.floor((x+7)/cellW);
	const gy0=Math.floor((y-1)/cellH), gy1=Math.floor((y+1)/cellH);
	for(let gy=gy0; gy<=gy1; gy++){
		for(let gx=gx0; gx<=gx1; gx++){
			const ay=gy*cellH + 2 + Math.floor(WG.randSeed(gx*29.31+gy*77.17+1905)*Math.max(1,cellH-4));
			const chance=WG.goldVeinChance(ay,false);
			if(WG.randSeed(gx*101.13+gy*283.71+1904)>=chance) continue;
			const len=3 + Math.floor(WG.randSeed(gx*43.19+gy*61.73+1906)*5);
			const span=Math.max(1,cellW-len-3);
			const ax=gx*cellW + 2 + Math.floor(WG.randSeed(gx*53.77+gy*97.31+1907)*span);
			if(y===ay && x>=ax && x<ax+len) return true;
		}
	}
	return false;
};
// Silver sits between coal and gold in progression: broader, cooler veins are
// visible from the middle crust onward, but still form deliberate short seams
// instead of noisy isolated pixels.
WG.silverVeinChance = function(y, nearCave){
	const d=clamp((y-40)/(WORLD_H-50),0,1);
	const mid=clamp(1-Math.abs(d-0.48)*1.45,0,1);
	return Math.min(0.46,(0.16+mid*0.20+d*0.035)*(nearCave?1.12:1));
};
WG.silverVeinAt = function(x,y,nearCave){
	x=Math.floor(Number(x)||0);
	y=Math.floor(Number(y)||0);
	const cellW=15, cellH=8;
	const gx0=Math.floor((x-6)/cellW), gx1=Math.floor((x+6)/cellW);
	const gy0=Math.floor((y-1)/cellH), gy1=Math.floor((y+1)/cellH);
	for(let gy=gy0;gy<=gy1;gy++){
		for(let gx=gx0;gx<=gx1;gx++){
			const ay=gy*cellH+2+Math.floor(WG.randSeed(gx*37.11+gy*83.29+1915)*Math.max(1,cellH-4));
			const chance=WG.silverVeinChance(ay,!!nearCave);
			if(WG.randSeed(gx*109.41+gy*251.17+1914)>=chance) continue;
			const len=3+Math.floor(WG.randSeed(gx*47.61+gy*71.03+1916)*4);
			const span=Math.max(1,cellW-len-3);
			const ax=gx*cellW+2+Math.floor(WG.randSeed(gx*57.23+gy*101.09+1917)*span);
			if(y===ay && x>=ax && x<ax+len) return true;
		}
	}
	return false;
};
// Tin: the earliest, shallowest metal — a soft ore for mid-tier bronze. Mirrors
// silver's cell-grid line veins but on a shallower band + fresh salts (1924-1927,
// statistically independent of silver/gold), placed AFTER gold in the fill ladder.
WG.tinVeinChance = function(y, nearCave){
	const d=clamp((y-30)/(WORLD_H-40),0,1);
	const mid=clamp(1-Math.abs(d-0.40)*1.55,0,1);
	return Math.min(0.44,(0.15+mid*0.20+d*0.03)*(nearCave?1.12:1));
};
WG.tinVeinAt = function(x,y,nearCave){
	x=Math.floor(Number(x)||0);
	y=Math.floor(Number(y)||0);
	const cellW=15, cellH=8;
	const gx0=Math.floor((x-6)/cellW), gx1=Math.floor((x+6)/cellW);
	const gy0=Math.floor((y-1)/cellH), gy1=Math.floor((y+1)/cellH);
	for(let gy=gy0;gy<=gy1;gy++){
		for(let gx=gx0;gx<=gx1;gx++){
			const ay=gy*cellH+2+Math.floor(WG.randSeed(gx*39.07+gy*79.13+1925)*Math.max(1,cellH-4));
			const chance=WG.tinVeinChance(ay,!!nearCave);
			if(WG.randSeed(gx*113.27+gy*241.31+1924)>=chance) continue;
			const len=3+Math.floor(WG.randSeed(gx*51.17+gy*67.41+1926)*4);
			const span=Math.max(1,cellW-len-3);
			const ax=gx*cellW+2+Math.floor(WG.randSeed(gx*61.33+gy*103.07+1927)*span);
			if(y===ay && x>=ax && x<ax+len) return true;
		}
	}
	return false;
};
// Diamond odds now belong to the lowest legacy crust: most reachable diamonds
// should be a bedrock-level expedition, not a routine mid-depth seam. world.js
// still boosts exposed cave-wall rolls, but the base chance stays deliberately
// lean until the final rows above the lower-world contact.
WG.diamondChance = function(y){
	const bedrockward=clamp((y-(WORLD_H-34))/28,0,1);
	const contactEase=clamp((y-(WORLD_H-8))/10,0,1);
	return (0.000015 + Math.pow(bedrockward,3.6)*0.0038) * (1-contactEase*0.40);
};

// Node sims import this module without a DOM; the seed input only exists in the browser.
// Boot seed priority: a queued new-game choice > the active challenge link > the
// #seedInput field (QA interceptor / debug panel; 'auto' rolls a random world).
// The queued seed used to be silently rerolled by the 'auto' input right after
// being consumed — an explicitly chosen new-world seed never reached the world.
if(typeof document!=='undefined'){
	if(QUEUED_SEED || activeChallenge){
		if(!QUEUED_SEED) WG.worldSeed = activeChallenge.seed;
		const inp=document.getElementById('seedInput');
		if(inp) inp.value=String(WG.worldSeed);
		WG.clearCaches();
	} else {
		WG.setSeedFromInput();
	}
	// challenge modifiers patch the generator IN MEMORY only — never persisted,
	// so leaving the challenge world restores the player's own settings
	if(activeChallenge && activeChallenge.mods.length){
		WG.settings = applyWorldMods(WG.settings, activeChallenge.mods);
		WG.clearCaches();
	}
}
MM.worldGen = WG;
// ES module exports (progressive migration): allow importing as a module
export const worldGen = WG;
export default WG;
