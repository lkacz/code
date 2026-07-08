// Underground biome dressing regression tests: surface biomes now continue
// underground instead of collapsing into one generic cave palette. The suite
// pins ice caves, fungal caverns, desert gas/sand pockets, swamp poison, wet
// aquifer clay, mountain crystal ribs, city fallout tunnels and deep-section
// continuity. It also pins the GLOWSHROOM tile contract.
import { strict as assert } from 'assert';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.localStorage = { getItem(){ return null; }, setItem(){}, removeItem(){} };

const { T, INFO, WORLD_H } = await import('../src/constants.js');
const { worldGen: WG } = await import('../src/engine/worldgen.js');
await import('../src/engine/trees.js');
const { world } = await import('../src/engine/world.js');
const { worldLayers } = await import('../src/engine/world_layers.js');
const { lighting } = await import('../src/engine/lighting.js');

const SEED = 20260616;
WG.worldSeed = SEED;
WG.clearCaches();
world.clear();

// --- tile contract ----------------------------------------------------------
assert.equal(INFO[T.GLOWSHROOM].passable, true, 'glowshrooms do not block movement');
assert.equal(INFO[T.GLOWSHROOM].drop, 'glowshroom', 'harvesting a glowshroom pays the resource');

// --- find representative biome runs -----------------------------------------
function findRun(biome, minWidth){
  for(let x=-60000; x<=60000;){
    const b = WG.biomeType(x);
    let right = x;
    while(right+1<=60000 && WG.biomeType(right+1)===b) right++;
    if(b===biome && right-x+1>=minWidth) return {left:x, right, center:Math.round((x+right)/2)};
    x = right+1;
  }
  return null;
}

const forestRun = findRun(0, 200);
const snowRun = findRun(2, 140);
const desertRun = findRun(3, 180);
const swampRun = findRun(4, 160);
const lakeRun = findRun(6, 180);
const mountainRun = findRun(7, 220);
const cityRun = findRun(8, 40);
assert.ok(
  forestRun && snowRun && desertRun && swampRun && lakeRun && mountainRun && cityRun,
  'seed exposes the surface biomes needed for underground dressing coverage'
);

function scanBand(center, span, up, down, wanted){
  const found = [];
  for(let wx=center-span; wx<=center+span; wx++){
    const surf = WG.surfaceHeight(wx);
    for(let y=surf+up; y<=surf+down; y++){
      if(world.getTile(wx,y)===wanted) found.push({x:wx, y});
    }
  }
  return found;
}

function scanBiome(run, biome, span, up, down, wanted){
  return scanBand(run.center, span, up, down, wanted).filter(p=>WG.biomeType(p.x)===biome);
}

function scanDeepBiome(run, biome, span, y0, y1, wanted){
  const found = [];
  for(let wx=run.center-span; wx<=run.center+span; wx++){
    if(WG.biomeType(wx)!==biome) continue;
    for(let y=y0; y<=y1; y++){
      if(world.getTile(wx,y)===wanted) found.push({x:wx, y});
    }
  }
  return found;
}

// --- ice caves in snow biome -------------------------------------------------
const ice = scanBiome(snowRun, 2, 90, 3, 26, T.ICE);
assert.ok(ice.length >= 20, 'snow-biome caves frost over with ice (found '+ice.length+')');
const icicle = ice.some(p=>{
  const above = world.getTile(p.x, p.y-1);
  return world.getTile(p.x, p.y+1)===T.AIR && (above===T.ICE||above===T.STONE||above===T.SNOW);
});
assert.ok(icicle, 'ice caves grow hanging icicles');

// --- glowshroom caverns in forest -------------------------------------------
const shrooms = scanBiome(forestRun, 0, 120, 6, 40, T.GLOWSHROOM);
assert.ok(shrooms.length >= 5, 'forest caverns sprout glowshrooms (found '+shrooms.length+')');
let rooted = 0;
for(const p of shrooms){
  const floor = world.getTile(p.x, p.y+1);
  if(floor===T.STONE||floor===T.GRANITE||floor===T.BASALT||floor===T.DIRT||floor===T.MUD||floor===T.CLAY) rooted++;
}
assert.ok(rooted >= Math.ceil(shrooms.length*0.8), 'glowshrooms root on solid cave floors');

// --- desert caves: dry collapses and fuel gas, not fungal/ice dressing -------
const desertGas = scanBiome(desertRun, 3, 120, 7, 52, T.FUEL_GAS);
const desertUnstable = scanBiome(desertRun, 3, 120, 7, 52, T.UNSTABLE_SAND);
assert.ok(desertGas.length >= 4, 'desert caverns contain sparse fuel-gas pockets (found '+desertGas.length+')');
assert.ok(desertUnstable.length >= 3, 'desert cave floors contain unstable sand pockets (found '+desertUnstable.length+')');
const desertIce = scanBiome(desertRun, 3, 60, 3, 26, T.ICE);
const desertShrooms = scanBiome(desertRun, 3, 60, 3, 40, T.GLOWSHROOM);
assert.equal(desertIce.length, 0, 'deserts grow no dressing ice');
assert.equal(desertShrooms.length, 0, 'deserts grow no glowshrooms');

// --- swamp/lake/mountain/city signatures ------------------------------------
const swampGas = scanBiome(swampRun, 4, 120, 6, 42, T.POISON_GAS);
const swampShrooms = scanBiome(swampRun, 4, 120, 6, 42, T.GLOWSHROOM);
assert.ok(swampGas.length >= 2, 'swamp caverns carry poisonous gas pockets (found '+swampGas.length+')');
assert.ok(swampShrooms.length >= 3, 'swamp caverns still grow fungal light sources (found '+swampShrooms.length+')');

const lakeClay =
  scanBiome(lakeRun, 6, 120, 4, 46, T.CLAY).length +
  scanBiome(lakeRun, 6, 120, 4, 46, T.WET_CLAY).length;
assert.ok(lakeClay >= 40, 'lake-adjacent underground has clay and wet-clay aquifer rims (found '+lakeClay+')');

const mountainCrystal = scanBiome(mountainRun, 7, 120, 5, 64, T.DIAMOND);
assert.ok(mountainCrystal.length >= 3, 'mountain cave ribs expose rare crystal pockets (found '+mountainCrystal.length+')');

const cityToxic = scanBiome(cityRun, 8, 120, 6, 58, T.POISON_GAS);
const cityRadiation = scanBiome(cityRun, 8, 120, 6, 58, T.RADIOACTIVE_ORE);
const citySteel = scanBiome(cityRun, 8, 120, 6, 58, T.STEEL);
assert.ok(cityToxic.length >= 5, 'city underground tunnels leak toxic gas (found '+cityToxic.length+')');
assert.ok(cityRadiation.length >= 2, 'city underground exposes radioactive ore pockets (found '+cityRadiation.length+')');
assert.ok(citySteel.length >= 20, 'city underground contains metal scrap veins (found '+citySteel.length+')');

// --- deep-section continuity -------------------------------------------------
assert.equal(typeof worldLayers.deepCaveDressingTile, 'function', 'deep sections expose a shared cave dressing function');
const deepForestShrooms = scanDeepBiome(forestRun, 0, 120, WORLD_H, WORLD_H+110, T.GLOWSHROOM);
const deepSnowIce = scanDeepBiome(snowRun, 2, 120, WORLD_H, WORLD_H+110, T.ICE);
const deepDesertGas = scanDeepBiome(desertRun, 3, 120, WORLD_H, WORLD_H+110, T.FUEL_GAS);
const deepSwampGas = scanDeepBiome(swampRun, 4, 120, WORLD_H, WORLD_H+110, T.POISON_GAS);
const deepLakeClay =
  scanDeepBiome(lakeRun, 6, 120, WORLD_H, WORLD_H+110, T.CLAY).length +
  scanDeepBiome(lakeRun, 6, 120, WORLD_H, WORLD_H+110, T.WET_CLAY).length;
const deepMountainSteam = scanDeepBiome(mountainRun, 7, 120, WORLD_H, WORLD_H+110, T.STEAM);
const deepCityRadiation = scanDeepBiome(cityRun, 8, 120, WORLD_H, WORLD_H+110, T.RADIOACTIVE_ORE);
assert.ok(deepForestShrooms.length >= 8, 'deep forest caverns keep fungal chambers (found '+deepForestShrooms.length+')');
assert.ok(deepSnowIce.length >= 80, 'deep snow columns keep ice-cave identity (found '+deepSnowIce.length+')');
assert.ok(deepDesertGas.length >= 5, 'deep desert columns keep fuel-gas pockets (found '+deepDesertGas.length+')');
assert.ok(deepSwampGas.length >= 3, 'deep swamp columns keep poison pockets (found '+deepSwampGas.length+')');
assert.ok(deepLakeClay >= 40, 'deep lake columns keep wet clay aquifer material (found '+deepLakeClay+')');
assert.ok(deepMountainSteam.length >= 20, 'deep mountain columns vent steam in fractured galleries (found '+deepMountainSteam.length+')');
assert.ok(deepCityRadiation.length >= 50, 'deep city columns preserve fallout/radiation identity (found '+deepCityRadiation.length+')');

// --- determinism -------------------------------------------------------------
world.clear();
WG.clearCaches();
const ice2 = scanBiome(snowRun, 2, 90, 3, 26, T.ICE);
assert.deepEqual(ice2, ice, 'ice dressing is a pure function of the seed');
const desertGas2 = scanBiome(desertRun, 3, 120, 7, 52, T.FUEL_GAS);
assert.deepEqual(desertGas2, desertGas, 'desert gas pockets are deterministic');

// --- glowshrooms are lighting emitters ---------------------------------------
{
  const tiles = new Map();
  const key=(x,y)=>x+','+y;
  const getTile=(x,y)=>{ const v=tiles.get(key(x,y)); if(v!==undefined) return v; return y>=20 ? T.STONE : T.AIR; };
  for(let x=5;x<=11;x++) for(let y=30;y<=33;y++) tiles.set(key(x,y),T.AIR);
  tiles.set(key(8,33),T.GLOWSHROOM);
  lighting.reset();
  lighting.ensure(0,10,40,30,{getTile,surfaceHeight:()=>20,daylight:1});
  assert.equal(lighting.lightAt(8,33), 9/15, 'a glowshroom emits fungal light');
  assert.ok(lighting.lightAt(5,33) > 0, 'mushroom light spreads through the chamber');
}

console.log('underground-biomes-sim: all assertions passed');
