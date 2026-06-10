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
window.MM = window.MM || {};
const WG = {};
WG.worldSeed = 12345;

// Persistent world generation settings (tunable via UI). v2 storage key — v1 values
// belong to the old inverted height model and must not leak into this one.
WG.settings = (function(){
	const DEF = {
		seaLevel: 62,            // row of the global water line
		oceanFrac: 0.32,         // continental threshold: higher => more/larger oceans
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
	try{ const raw=localStorage.getItem('mm_world_settings_v2'); if(raw){ const obj=JSON.parse(raw); return Object.assign({}, DEF, obj); } }catch(e){}
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

// --- Climate -------------------------------------------------------------------
// 2 octaves + strong spread so cold/hot and wet/dry extremes actually occur
WG.temperature = function(x){ return spread(fbm1(x,2600,2,5001),2.2); };
WG.moisture    = function(x){ return spread(fbm1(x,1900,2,6001),2.2); };

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

// --- Column model -----------------------------------------------------------------
// Everything derived from x is computed once per column and cached.
const colCache = new Map();
WG.clearCaches = function(){ colCache.clear(); };
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
	const t = WG.temperature(x), m = WG.moisture(x);
	// Erosion-scaled roughness: alpine terrain is jagged, plains stay calm
	let rough = (fbm1(x,64,3,501)-0.5)*(2.5+9*(1-ero)+7*mountainMask)*S.detailAmp;
	if(valleyDepth>4) rough *= clamp(1-(valleyDepth-4)*0.06,0.25,1); // calm valley floors
	if(elev<-3) rough *= 0.55; // calm sea beds
	elev += rough;
	let row = Math.round(sea-elev);
	row = clamp(row, 8, Math.min(sea+31, WORLD_H-34));
	const elevF = sea-row;
	// Biome classification (ids kept from v1: 0 Forest, 1 Plains, 2 Snow/Ice, 3 Desert,
	// 4 Swamp, 5 Sea, 6 Lake, 7 Mountain)
	let biome;
	if(elevF<-2.5) biome = (cont<S.oceanFrac+0.08)?5:6;            // open sea vs flooded inland valley
	else if(valleyDepth>10 && elevF>2 && m>0.42) biome=6;          // perched valley lake basin
	else if(mountainMask>0.55 && (pv>0.55||elevF>22)) biome=7;
	else if(elevF>26) biome=7;
	else if(t<0.31) biome=2;
	else if(t>0.64 && m<0.42 && elevF<18) biome=3;
	else if(m>0.72 && elevF<8 && ero>0.45) biome=4;
	else if(m<0.46) biome=1;
	else biome=0;
	const beach = (elevF>=-3 && elevF<=2.5 && cont<S.oceanFrac+0.12);
	// Cave control fields
	const entrance = WG.valueNoise(x,230,701)>0.80;               // hillside cave mouths
	const rv = WG.ridge(xw,1300,801);
	const rvGate = 1-0.035*Math.max(0.0001,S.ravineFreq);
	let ravine=0, ravineDepth=0;
	if(S.ravineFreq>0 && rv>rvGate && elevF>2 && !beach){ ravine=(rv-rvGate)/(1-rvGate); ravineDepth=16+48*ravine; }
	const aquifer = Math.round(S.aquiferLevel + (fbm1(x,820,2,811)-0.5)*40);
	c = {row,biome,elev:elevF,cont,ero,pv,mountainMask,valleyDepth,t,m,beach,entrance,ravine,ravineDepth,aquifer};
	colCache.set(x,c); return c;
};
WG.surfaceHeight = function(x){ return WG.column(x).row; };
WG.biomeType = function(x){ return WG.column(x).biome; };
// Compat shims for older callers
WG.macroElev = function(x){ return clamp(0.5+WG.column(x).elev/64,0,1); };
WG.oceanMask = function(x){ return 1-WG.column(x).cont; };
WG.valleyMask = function(x){ const c=WG.column(x); return clamp(c.valleyDepth/(WG.settings.valleyGain||30),0,1); };

// --- Cave query ------------------------------------------------------------------
// Returns 0 = solid, 1 = open cave air, 2 = flooded (cave lake / aquifer water).
WG.caveAt = function(x, y, colOpt){
	if(y>=WORLD_H-7) return 0;                       // bedrock shelf stays sealed
	const c = colOpt || WG.column(x);
	const s = c.row, depth = y-s;
	if(depth<0) return 0;
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
		if(cav > 0.80-0.13*dprog-0.06*(S.caveDensity-1)) carved = true;
		// Winding tunnels — two crossing systems form branching networks
		if(!carved){
			let w = (0.012+0.011*dprog)*S.tunnelDensity;
			if(c.entrance && depth<16) w += 0.045*(1-depth/16); // widen mouths near surface
			const t1 = fbm2(x,y,110,46,2,1101);
			if(Math.abs(t1-0.5)<w) carved = true;
			else { const t2 = fbm2(x,y,74,30,2,1201); if(Math.abs(t2-0.5)<w*0.8) carved = true; }
		}
		// Rare vertical shafts connecting cave layers
		if(!carved && WG.valueNoise(x,340,1301)>0.76){
			const sh = vnoise2(x,y,14,90,1401);
			if(Math.abs(sh-0.5)<0.04) carved = true;
		}
	}
	if(!carved) return 0;
	return y>=c.aquifer ? 2 : 1;
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
	for(let id=0; id<=7; id++){ if(fr[id]===undefined) fr[id]=0; }
	return fr;
};

// --- Loot / ore helpers ------------------------------------------------------------
WG.chestNoise = function(x){ return WG.valueNoise(x,55,1333); };
WG.chestPlace = function(x){ return WG.chestNoise(x) > 0.94; };
// Diamond odds scale with absolute depth; world.js triples this beside cave walls
WG.diamondChance = function(y){ const d=clamp((y-58)/80,0,1); return 0.0006 + d*d*0.038; };

WG.setSeedFromInput();
MM.worldGen = WG;
// ES module exports (progressive migration): allow importing as a module
export const worldGen = WG;
export default WG;
