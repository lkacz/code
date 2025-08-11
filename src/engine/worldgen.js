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

// Smoothed surface height: blends neighboring columns adaptively to avoid hard biome seams
WG.surfaceHeight = function(x){
	// Sample raw heights in neighborhood ±3
	const hM3 = WG._rawSurfaceHeight(x-3), hM2 = WG._rawSurfaceHeight(x-2), hM1 = WG._rawSurfaceHeight(x-1);
	const h0  = WG._rawSurfaceHeight(x);
	const hP1 = WG._rawSurfaceHeight(x+1), hP2 = WG._rawSurfaceHeight(x+2), hP3 = WG._rawSurfaceHeight(x+3);
	// Adaptive tightness from macro elevation gradient and local slope of raw heights
	const gMacro = Math.abs(WG.macroElev(x+3) - WG.macroElev(x-3));
	const slope = Math.abs(hP3 - hM3) / 6; // tiles per x
	const tSlope = Math.min(1, Math.max(0, slope/2.0));
	const tMacro = Math.min(1, Math.max(0, gMacro*1.3));
	const tight = Math.min(1, Math.max(0, 0.5*tSlope + 0.5*tMacro)); // higher -> narrower kernel
	// Two 7-tap kernels (sum to 1): wide (softer) and narrow (sharper)
	const wide   = [0.06, 0.12, 0.20, 0.24, 0.20, 0.12, 0.06]; // [-3..+3]
	const narrow = [0.00, 0.12, 0.18, 0.40, 0.18, 0.12, 0.00];
	const mix = (a,b,t)=> a*(1-t)+b*t;
	const w = [
	  mix(wide[0], narrow[0], tight),
	  mix(wide[1], narrow[1], tight),
	  mix(wide[2], narrow[2], tight),
	  mix(wide[3], narrow[3], tight),
	  mix(wide[4], narrow[4], tight),
	  mix(wide[5], narrow[5], tight),
	  mix(wide[6], narrow[6], tight)
	];
	let h = hM3*w[0] + hM2*w[1] + hM1*w[2] + h0*w[3] + hP1*w[4] + hP2*w[5] + hP3*w[6];
	// Clamp overall range and discretize to tiles
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
