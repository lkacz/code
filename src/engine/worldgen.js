// World generation (seed, noise, biome, height) - global friendly
window.MM = window.MM || {};
const WG = {};
WG.worldSeed = 12345;
WG.setSeedFromInput = function(){ const inp=document.getElementById('seedInput'); if(!inp) return; let v=inp.value.trim(); if(!v||v==='auto'){ WG.worldSeed = Math.floor(Math.random()*1e9); inp.value=String(WG.worldSeed); } else { let h=0; for(let i=0;i<v.length;i++){ h=(h*131 + v.charCodeAt(i))>>>0; } WG.worldSeed = h||1; } if(window.MM && MM.world && MM.world.clearHeights) MM.world.clearHeights(); };
WG.randSeed = function(n){ const x=Math.sin(n*127.1 + WG.worldSeed*0.000123)*43758.5453; return x-Math.floor(x); };
WG.valueNoise = function(x, wavelength, off){ const p=x/wavelength; const i=Math.floor(p); const f=p-i; const a=WG.randSeed(i+off); const b=WG.randSeed(i+1+off); const u=f*f*(3-2*f); return a + (b-a)*u; };
// --- Multi-axis biome noise (temperature + moisture + macro elevation) ---
// Biome IDs (exposed via biomeType):
// 0: Forest, 1: Plains, 2: Snow / Ice, 3: Desert, 4: Swamp, 5: Sea (ocean), 6: Lake (inland water), 7: Mountain
WG.temperature = function(x){ return WG.valueNoise(x,320,123) * 0.6 + WG.valueNoise(x,90,321)*0.3 + WG.valueNoise(x,25,654)*0.1; }; // 0..1
WG.moisture    = function(x){ return WG.valueNoise(x,280,777) * 0.55 + WG.valueNoise(x,70,888)*0.35 + WG.valueNoise(x,18,999)*0.10; };
WG.macroElev   = function(x){ return WG.valueNoise(x,600,432)*0.6 + WG.valueNoise(x,180,987)*0.3 + WG.valueNoise(x,60,246)*0.1; }; // 0..1

WG.biomeType = function(x){
	const t = WG.temperature(x); // warmth
	const m = WG.moisture(x);    // wetness
	const e = WG.macroElev(x);   // large elevation trend
	// Sea / ocean bands (very low macro elevation)
	if(e < 0.18) return 5; // sea
	// Lake pockets: moderate elevation dips with high moisture
	if(e < 0.32 && m > 0.65) return 6; // lakes
	// Mountains (high macro elevation)
	if(e > 0.78){ return 7; }
	// Snow / Ice (cold & mid/high elev)
	if(t < 0.28 && e > 0.55) return 2;
	// Desert (hot & dry)
	if(t > 0.68 && m < 0.35) return 3;
	// Swamp (warm-ish & very wet & low elev)
	if(m > 0.72 && e < 0.55) return 4;
	// Plains (moderate everything, lean to drier)
	if(m < 0.5) return 1;
	// Forest default
	return 0;
};

// Surface height influenced by macro elevation + biome-specific modulation
// Internal: compute raw, unsmoothed terrain height at x using current biome rules
WG._rawSurfaceHeight = function rawSurfaceHeight(x){
	const biome = WG.biomeType(x);
	const baseMacro = 20 + WG.macroElev(x)*26; // 20..46 pre clamp
	// Finer detail layers (apply across biomes)
	const detail = WG.valueNoise(x,90,200)*4 + WG.valueNoise(x,35,300)*3 + WG.valueNoise(x,14,400)*2;
	let h = baseMacro + detail*0.6;
	switch(biome){
		case 5: // Sea: flatten downward
			h = 10 + WG.valueNoise(x,140,500)*2; break;
		case 6: // Lake: local depression
			h = h - 6 - WG.valueNoise(x,120,520)*4; break;
		case 7: // Mountain: amplify
			h = h + 8 + WG.valueNoise(x,160,530)*10 + WG.valueNoise(x,55,540)*6; break;
		case 3: // Desert: gentle dunes
			h = h - 2 + WG.valueNoise(x,150,550)*3 + WG.valueNoise(x,50,560)*2; break;
		case 4: // Swamp: very flat, slightly below neighbors
			h = h - 4 + WG.valueNoise(x,110,570)*1.5; break;
		case 2: // Snow / Ice: rolling highlands
			h = h + 2 + WG.valueNoise(x,130,580)*4; break;
		case 1: // Plains: smoother
			h = h - 1 + WG.valueNoise(x,100,590)*2; break;
		default: // Forest (0): moderate variability
			h = h + WG.valueNoise(x,115,600)*3; break;
	}
	return h;
}

// Smoothed surface height: adaptive Gaussian kernel over ±10 to avoid seams while preserving steep terrain
WG.surfaceHeight = function(x){
	const R = 10; // neighborhood radius
	const count = R*2+1;
	// Sample raw heights across window
	const H = new Array(count);
	for(let i=-R, idx=0; i<=R; i++, idx++) H[idx] = WG._rawSurfaceHeight(x+i);
	// Metrics: macro-elevation gradient, local slope, roughness
	let maxSlope = 0; let sum=0; for(let i=1;i<count;i++){ const s=Math.abs(H[i]-H[i-1]); if(s>maxSlope) maxSlope=s; }
	for(let i=0;i<count;i++) sum += H[i];
	const mean = sum / count;
	let varSum=0; for(let i=0;i<count;i++){ const d=H[i]-mean; varSum += d*d; }
	const std = Math.sqrt(varSum / count);
	// Macro-elevation gradient using ends of window
	const gMacro = Math.abs(WG.macroElev(x+R) - WG.macroElev(x-R));
	// Normalize metrics to [0,1]
	const nSlope = Math.min(1, maxSlope/3.0);    // steeper than ~3 tiles/x taps out
	const nRough = Math.min(1, std/7.0);         // very rough (>7 tiles stdev) taps out
	const nMacro = Math.min(1, gMacro*1.6);
	// Mountain/snow presence biases to narrower smoothing
	const bf = (WG.biomeFrac? WG.biomeFrac(x,4): null);
	const mountainBias = bf? (bf[7]*0.6 + bf[2]*0.3) : 0; // mountains and some snow
	// Tightness in [0,1]: higher => narrower kernel
	let tight = 0.45*nSlope + 0.35*nRough + 0.20*nMacro + mountainBias*0.25;
	if(tight<0) tight=0; if(tight>1) tight=1;
	// Map tightness to Gaussian sigma between wide and narrow
	const sigmaWide = 4.8, sigmaNarrow = 1.6;
	const sigma = sigmaWide*(1-tight) + sigmaNarrow*tight;
	// Build Gaussian weights and normalize
	let wSum=0; const W = new Array(count);
	const inv2s2 = 1/(2*sigma*sigma);
	for(let i=-R, idx=0; i<=R; i++, idx++){ const w=Math.exp(-(i*i)*inv2s2); W[idx]=w; wSum+=w; }
	for(let i=0;i<count;i++) W[i]/=wSum;
	// Weighted sum
	let h=0; for(let i=0;i<count;i++) h += H[i]*W[i];
	// Clamp and discretize
	if(h<4) h=4; if(h>70) h=70; return Math.floor(h);
};

// Biome fraction map around a column, used for soft material transitions
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
	// Ensure all known ids exist with 0 default (0..7)
	for(let id=0; id<=7; id++){ if(fr[id]===undefined) fr[id]=0; }
	return fr;
};
// Chest rarity noise helpers
WG.chestNoise = function(x){ return WG.valueNoise(x,55,1333); };
WG.chestPlace = function(x){ // dense for testing: ~6% columns get a chest
	return WG.chestNoise(x) > 0.94; };
WG.diamondChance = function(y){ const {SURFACE_GRASS_DEPTH,SAND_DEPTH} = MM; const d=y-(SURFACE_GRASS_DEPTH+SAND_DEPTH); if(d<0) return 0; return Math.min(0.002 + d*0.0009, 0.05); };
WG.setSeedFromInput();
MM.worldGen = WG;
