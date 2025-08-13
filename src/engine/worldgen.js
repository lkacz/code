// World generation (seed, noise, biome, height) - now configurable via WG.config
window.MM = window.MM || {};
const WG = {};

// ----- Configurable Parameters (extendable) -----
// These drive the procedural generation. UI can mutate WG.config then call WG.applyConfig to affect new worlds.
const DEFAULT_CONFIG = {
	// Multi-octave noise definitions (arrays of {w: wavelength, weight, off: offsetSeed})
	temperatureOctaves: [ {w:320, weight:0.6, off:123}, {w:90, weight:0.3, off:321}, {w:25, weight:0.1, off:654} ],
	moistureOctaves:    [ {w:280, weight:0.55, off:777}, {w:70, weight:0.35, off:888}, {w:18, weight:0.10, off:999} ],
	macroElevOctaves:   [ {w:600, weight:0.6, off:432}, {w:180, weight:0.3, off:987}, {w:60, weight:0.1, off:246} ],

	// Biome threshold parameters
	seaLevel: 0.18,
	lakeElevMax: 0.32,
	lakeMoistMin: 0.65,
	mountainElev: 0.78,
	snowTempMax: 0.28,
	snowElevMin: 0.55,
	desertTempMin: 0.68,
	desertMoistMax: 0.35,
	swampMoistMin: 0.72,
	swampElevMax: 0.55,

	// Surface height shaping
	surfaceBaseMin: 20,
	surfaceBaseRange: 26,
	detailOctaves: [ {w:90, amp:4, off:200}, {w:35, amp:3, off:300}, {w:14, amp:2, off:400} ],
	detailFactor: 0.6,

	// Biome specific modifiers
	mountainAdd: 8,
	mountainLargeAmp: 10,
	mountainMedAmp: 6,
	desertAdjust: -2,
	swampAdjust: -4,
	snowAdjust: 2,
	plainsAdjust: -1,
	seaBase: 10,
	lakeDepress: 6,

	// Limits
	minClamp: 4,
	maxClamp: 70,

	// Chest & resources
	chestThreshold: 0.94,
};

const CFG_STORAGE_KEY = 'mm_worldgen_cfg_v1';
function loadConfig(){
	try{ const raw = localStorage.getItem(CFG_STORAGE_KEY); if(raw){ const parsed=JSON.parse(raw); return {...DEFAULT_CONFIG, ...parsed}; } }catch(e){}
	return {...DEFAULT_CONFIG};
}
WG.config = loadConfig();
WG.DEFAULT_CONFIG = {...DEFAULT_CONFIG};
WG.saveConfig = function(){ try{ localStorage.setItem(CFG_STORAGE_KEY, JSON.stringify(WG.config)); }catch(e){} };
WG.applyConfig = function(partial){ if(partial && typeof partial==='object'){ WG.config = {...WG.config, ...partial}; WG.saveConfig(); if(window.MM && MM.world && MM.world.clearHeights) MM.world.clearHeights(); } };

// Utility: weighted octave combination
function layeredNoise(x, octs){ let sum=0, wsum=0; for(const o of octs){ const p=x/(o.w||1); const i=Math.floor(p); const f=p-i; const a=WG.randSeed(i + (o.off||0)); const b=WG.randSeed(i+1 + (o.off||0)); const u=f*f*(3-2*f); const v=a + (b-a)*u; sum+=v*(o.weight||o.amp||1); wsum += (o.weight||o.amp||1); } return wsum? sum/wsum : 0; }
// Persisted world seed handling
const SEED_STORAGE_KEY = 'mm_world_seed_v1';
function loadPersistedSeed(){
	try{ const raw = localStorage.getItem(SEED_STORAGE_KEY); if(raw){ const n=Number(raw); if(Number.isFinite(n) && n>0){ return n>>>0; } } }catch(e){}
	return null;
}
function persistSeed(seed){ try{ localStorage.setItem(SEED_STORAGE_KEY, String(seed>>>0)); }catch(e){} }

WG.worldSeed = loadPersistedSeed() || 12345;
WG.setSeedFromInput = function(){ const inp=document.getElementById('seedInput'); if(!inp) return; let v=inp.value.trim(); if(!v||v==='auto'){ WG.worldSeed = Math.floor(Math.random()*1e9); inp.value=String(WG.worldSeed); } else { let h=0; for(let i=0;i<v.length;i++){ h=(h*131 + v.charCodeAt(i))>>>0; } WG.worldSeed = h||1; } persistSeed(WG.worldSeed); if(window.MM && MM.world && MM.world.clearHeights) MM.world.clearHeights(); };
WG.randSeed = function(n){ const x=Math.sin(n*127.1 + WG.worldSeed*0.000123)*43758.5453; return x-Math.floor(x); };
WG.valueNoise = function(x, wavelength, off){ const p=x/wavelength; const i=Math.floor(p); const f=p-i; const a=WG.randSeed(i+off); const b=WG.randSeed(i+1+off); const u=f*f*(3-2*f); return a + (b-a)*u; };
// --- Multi-axis biome noise (temperature + moisture + macro elevation) ---
// Biome IDs (exposed via biomeType):
// 0: Forest, 1: Plains, 2: Snow / Ice, 3: Desert, 4: Swamp, 5: Sea (ocean), 6: Lake (inland water), 7: Mountain
WG.temperature = function(x){ return layeredNoise(x, WG.config.temperatureOctaves); }; // 0..1
WG.moisture    = function(x){ return layeredNoise(x, WG.config.moistureOctaves); };
WG.macroElev   = function(x){ return layeredNoise(x, WG.config.macroElevOctaves); }; // 0..1

WG.biomeType = function(x){
	const c = WG.config;
	const t = WG.temperature(x);
	const m = WG.moisture(x);
	const e = WG.macroElev(x);
	if(e < c.seaLevel) return 5; // sea
	if(e < c.lakeElevMax && m > c.lakeMoistMin) return 6; // lakes
	if(e > c.mountainElev) return 7; // mountains
	if(t < c.snowTempMax && e > c.snowElevMin) return 2; // snow
	if(t > c.desertTempMin && m < c.desertMoistMax) return 3; // desert
	if(m > c.swampMoistMin && e < c.swampElevMax) return 4; // swamp
	if(m < 0.5) return 1; // plains (still fixed moisture split; can be exposed later)
	return 0; // forest
};

// Surface height influenced by macro elevation + biome-specific modulation
WG.surfaceHeight = function(x){
	const c = WG.config;
	const biome = WG.biomeType(x);
	const baseMacro = c.surfaceBaseMin + WG.macroElev(x)*c.surfaceBaseRange;
	let detail = 0; for(const o of c.detailOctaves){ detail += WG.valueNoise(x, o.w, o.off)*o.amp; }
	let h = baseMacro + detail * c.detailFactor;
	switch(biome){
		case 5: // Sea
			h = c.seaBase + WG.valueNoise(x,140,500)*2; break;
		case 6: // Lake
			h = h - c.lakeDepress - WG.valueNoise(x,120,520)*4; break;
		case 7: // Mountain
			h = h + c.mountainAdd + WG.valueNoise(x,160,530)*c.mountainLargeAmp + WG.valueNoise(x,55,540)*c.mountainMedAmp; break;
		case 3: // Desert
			h = h + c.desertAdjust + WG.valueNoise(x,150,550)*3 + WG.valueNoise(x,50,560)*2; break;
		case 4: // Swamp
			h = h + c.swampAdjust + WG.valueNoise(x,110,570)*1.5; break;
		case 2: // Snow
			h = h + c.snowAdjust + WG.valueNoise(x,130,580)*4; break;
		case 1: // Plains
			h = h + c.plainsAdjust + WG.valueNoise(x,100,590)*2; break;
		default: // Forest
			h = h + WG.valueNoise(x,115,600)*3; break;
	}
	if(h < c.minClamp) h = c.minClamp; else if(h > c.maxClamp) h = c.maxClamp;
	return Math.floor(h);
};
// Chest rarity noise helpers
WG.chestNoise = function(x){ return WG.valueNoise(x,55,1333); };
WG.chestPlace = function(x){ return WG.chestNoise(x) > WG.config.chestThreshold; };
WG.diamondChance = function(y){ const {SURFACE_GRASS_DEPTH,SAND_DEPTH} = MM; const d=y-(SURFACE_GRASS_DEPTH+SAND_DEPTH); if(d<0) return 0; return Math.min(0.002 + d*0.0009, 0.05); };
// If there is an existing input element and no persisted seed was found, generate one
if(!loadPersistedSeed()) WG.setSeedFromInput(); else { const inp=document.getElementById('seedInput'); if(inp) inp.value=String(WG.worldSeed); }
// Quick preview helper (returns height & biome for an x range) used by UI preview panel
WG.previewRange = function(startX, count){ const out=[]; for(let i=0;i<count;i++){ const x=startX+i; out.push({x, biome: WG.biomeType(x), h: WG.surfaceHeight(x)}); } return out; };

MM.worldGen = WG;
