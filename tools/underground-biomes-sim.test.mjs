// Underground biome dressing regression tests: snow-biome caves frost to ice
// (STONE only — granite/basalt/coal strata untouched), forest/swamp caverns
// sprout glowing mushrooms on cave floors, deserts stay dry, and the whole
// pass is a pure function of the world seed. Also pins the GLOWSHROOM tile
// contract (passable, harvestable, a lighting emitter).
import { strict as assert } from 'assert';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.localStorage = { getItem(){ return null; }, setItem(){}, removeItem(){} };

const { T, INFO, CHUNK_W } = await import('../src/constants.js');
const { worldGen: WG } = await import('../src/engine/worldgen.js');
await import('../src/engine/trees.js');
const { world } = await import('../src/engine/world.js');
const { lighting } = await import('../src/engine/lighting.js');

const SEED = 20260616; // same seed the biome-materials suite pins
WG.worldSeed = SEED;
WG.clearCaches();
world.clear();

// --- tile contract ----------------------------------------------------------
assert.equal(INFO[T.GLOWSHROOM].passable, true, 'glowshrooms do not block movement');
assert.equal(INFO[T.GLOWSHROOM].drop, 'glowshroom', 'harvesting a glowshroom pays the resource');

// --- find representative biome runs (forest 0, snow 2, desert 3) ------------
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
const snowRun = findRun(2, 200);
const forestRun = findRun(0, 200);
const desertRun = findRun(3, 200);
assert.ok(snowRun && forestRun && desertRun, 'seed exposes snow, forest and desert runs');

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

// --- ice caves in snow biome -------------------------------------------------
const ice = scanBand(snowRun.center, 90, 3, 26, T.ICE).filter(p=>WG.biomeType(p.x)===2);
assert.ok(ice.length >= 20, 'snow-biome caves frost over with ice (found '+ice.length+')');
// icicles: at least one hanging spike (solid above, air below)
const icicle = ice.some(p=>{
  const above = world.getTile(p.x, p.y-1);
  return world.getTile(p.x, p.y+1)===T.AIR && (above===T.ICE||above===T.STONE||above===T.SNOW);
});
assert.ok(icicle, 'ice caves grow hanging icicles');

// --- glowshroom caverns in forest -------------------------------------------
const shrooms = scanBand(forestRun.center, 120, 6, 40, T.GLOWSHROOM).filter(p=>WG.biomeType(p.x)===0);
assert.ok(shrooms.length >= 5, 'forest caverns sprout glowshrooms (found '+shrooms.length+')');
let rooted = 0;
for(const p of shrooms){
  const floor = world.getTile(p.x, p.y+1);
  if(floor===T.STONE||floor===T.GRANITE||floor===T.BASALT||floor===T.DIRT||floor===T.MUD||floor===T.CLAY) rooted++;
}
assert.ok(rooted >= Math.ceil(shrooms.length*0.8), 'glowshrooms root on solid cave floors');

// --- deserts stay untouched --------------------------------------------------
const desertIce = scanBand(desertRun.center, 60, 3, 26, T.ICE).filter(p=>WG.biomeType(p.x)===3);
const desertShrooms = scanBand(desertRun.center, 60, 3, 40, T.GLOWSHROOM).filter(p=>WG.biomeType(p.x)===3);
assert.equal(desertIce.length, 0, 'deserts grow no dressing ice');
assert.equal(desertShrooms.length, 0, 'deserts grow no glowshrooms');

// --- determinism -------------------------------------------------------------
world.clear();
WG.clearCaches();
const ice2 = scanBand(snowRun.center, 90, 3, 26, T.ICE).filter(p=>WG.biomeType(p.x)===2);
assert.deepEqual(ice2, ice, 'ice dressing is a pure function of the seed');

// --- glowshrooms are lighting emitters ---------------------------------------
{
  const tiles = new Map();
  const key=(x,y)=>x+','+y;
  const getTile=(x,y)=>{ const v=tiles.get(key(x,y)); if(v!==undefined) return v; return y>=20 ? T.STONE : T.AIR; };
  // sealed pocket with one mushroom
  for(let x=5;x<=11;x++) for(let y=30;y<=33;y++) tiles.set(key(x,y),T.AIR);
  tiles.set(key(8,33),T.GLOWSHROOM);
  lighting.reset();
  lighting.ensure(0,10,40,30,{getTile,surfaceHeight:()=>20,daylight:1});
  assert.equal(lighting.lightAt(8,33), 9/15, 'a glowshroom emits fungal light');
  assert.ok(lighting.lightAt(5,33) > 0, 'mushroom light spreads through the chamber');
}

console.log('underground-biomes-sim: all assertions passed');
