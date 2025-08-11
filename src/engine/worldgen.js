// World generation (seed, noise, biome, height) - global friendly
window.MM = window.MM || {};
const WG = {};
WG.worldSeed = 12345;
WG.setSeedFromInput = function(){ const inp=document.getElementById('seedInput'); if(!inp) return; let v=inp.value.trim(); if(!v||v==='auto'){ WG.worldSeed = Math.floor(Math.random()*1e9); inp.value=String(WG.worldSeed); } else { let h=0; for(let i=0;i<v.length;i++){ h=(h*131 + v.charCodeAt(i))>>>0; } WG.worldSeed = h||1; } if(window.MM && MM.world && MM.world.clearHeights) MM.world.clearHeights(); };
WG.randSeed = function(n){ const x=Math.sin(n*127.1 + WG.worldSeed*0.000123)*43758.5453; return x-Math.floor(x); };
WG.valueNoise = function(x, wavelength, off){ const p=x/wavelength; const i=Math.floor(p); const f=p-i; const a=WG.randSeed(i+off); const b=WG.randSeed(i+1+off); const u=f*f*(3-2*f); return a + (b-a)*u; };
WG.biomeType = function(x){ const v=WG.valueNoise(x,220,900); if(v<0.35) return 0; if(v<0.7) return 1; return 2; };
WG.surfaceHeight = function(x){ const {SURFACE_GRASS_DEPTH,SAND_DEPTH} = MM; const biome=WG.biomeType(x); const base = 24 + WG.valueNoise(x,80,200)*4 + WG.valueNoise(x,30,300)*3 + WG.valueNoise(x,12,400)*2; let h=base; if(biome===0){ h = 26 + WG.valueNoise(x,100,500)*2 + WG.valueNoise(x,40,600); } else if(biome===1){ h = base - 2 - WG.valueNoise(x,60,700)*2; } else { h = base - 6 - WG.valueNoise(x,120,800)*4 - WG.valueNoise(x,50,900)*3; } if(h<6) h=6; if(h>40) h=40; return Math.floor(h); };
// Chest rarity noise helpers
WG.chestNoise = function(x){ return WG.valueNoise(x,55,1333); };
WG.chestPlace = function(x){ // dense for testing: ~6% columns get a chest
	return WG.chestNoise(x) > 0.94; };
WG.diamondChance = function(y){ const {SURFACE_GRASS_DEPTH,SAND_DEPTH} = MM; const d=y-(SURFACE_GRASS_DEPTH+SAND_DEPTH); if(d<0) return 0; return Math.min(0.002 + d*0.0009, 0.05); };
WG.setSeedFromInput();
MM.worldGen = WG;
