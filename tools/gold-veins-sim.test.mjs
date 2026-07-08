// Gold vein regression tests: gold is a real mined resource and generated as
// connected underground veins, not isolated decorative pixels.
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.localStorage = { getItem(){ return null; }, setItem(){}, removeItem(){} };

const { T, INFO, WORLD_H, WORLD_MAX_Y } = await import('../src/constants.js');
await import('../src/inventory.js');
const { worldGen: WG } = await import('../src/engine/worldgen.js');
const { worldLayers } = await import('../src/engine/world_layers.js');
await import('../src/engine/trees.js');
const { world } = await import('../src/engine/world.js');

const resource = key => globalThis.MM.inventory.RESOURCES.find(r => r.key === key);

assert.equal(INFO[T.GOLD_ORE].drop, 'gold', 'gold ore mines into the gold resource');
assert.equal(INFO[T.GOLD_ORE].ore, true, 'gold ore is marked as an ore');
assert.equal(resource('gold')?.tile, 'GOLD_ORE', 'gold is registered as a placeable mined resource');
assert.equal(resource('gold')?.color, '#f2b93b', 'gold uses a bright readable inventory color');
assert.equal(typeof WG.goldVeinAt, 'function', 'legacy worldgen exposes gold vein placement');
assert.equal(typeof worldLayers.deepTile, 'function', 'deep worldgen exposes shared deep tiles');

function neighborsGold(x,y){
  return world.getTile(x-1,y) === T.GOLD_ORE ||
    world.getTile(x+1,y) === T.GOLD_ORE ||
    world.getTile(x,y-1) === T.GOLD_ORE ||
    world.getTile(x,y+1) === T.GOLD_ORE;
}

function scanGold(seed){
  WG.worldSeed = seed;
  WG.clearCaches();
  world.clear();
  let legacy = 0, legacyAdj = 0, deep = 0, deepAdj = 0;
  let legacyDiamond = 0, deepDiamond = 0, firstDeep = null;
  for(let x=-384; x<384; x++){
    for(let y=45; y<WORLD_H-8; y++){
      const t = world.getTile(x,y);
      if(t === T.GOLD_ORE){
        legacy++;
        if(neighborsGold(x,y)) legacyAdj++;
      } else if(t === T.DIAMOND) legacyDiamond++;
    }
    for(let y=WORLD_H; y<WORLD_MAX_Y-8; y++){
      const t = world.getTile(x,y);
      if(t === T.GOLD_ORE){
        deep++;
        if(neighborsGold(x,y)) deepAdj++;
        if(!firstDeep) firstDeep = {x,y};
      } else if(t === T.DIAMOND) deepDiamond++;
    }
  }
  return {
    legacy,
    legacyRatio: legacyAdj / Math.max(1, legacy),
    deep,
    deepRatio: deepAdj / Math.max(1, deep),
    legacyDiamond,
    deepDiamond,
    firstDeep
  };
}

for(const seed of [20260616, 20260701, 12345, 987654321, 42]){
  const r = scanGold(seed);
  assert.ok(r.legacy >= 350, 'seed '+seed+' has visible legacy gold veins (found '+r.legacy+')');
  assert.ok(r.legacy <= 1600, 'seed '+seed+' does not overfill legacy rock with gold (found '+r.legacy+')');
  assert.ok(r.legacyRatio >= 0.82, 'seed '+seed+' legacy gold is mostly connected into veins (ratio '+r.legacyRatio.toFixed(3)+')');
  assert.ok(r.legacy > r.legacyDiamond * 6, 'seed '+seed+' gold is more common than diamonds but still finite');
  assert.ok(r.deep >= 950, 'seed '+seed+' has deep gold veins (found '+r.deep+')');
  assert.ok(r.deep <= 4500, 'seed '+seed+' does not overfill deep rock with gold (found '+r.deep+')');
  assert.ok(r.deepRatio >= 0.88, 'seed '+seed+' deep gold is mostly connected into veins (ratio '+r.deepRatio.toFixed(3)+')');
  assert.ok(r.deep > r.deepDiamond * 5, 'seed '+seed+' deep gold is richer than deep diamonds');
  assert.ok(r.firstDeep, 'seed '+seed+' exposes at least one deep gold coordinate for generator parity');
  assert.equal(
    worldLayers.deepTile(WG, r.firstDeep.x, r.firstDeep.y),
    world.getTile(r.firstDeep.x, r.firstDeep.y),
    'seed '+seed+' deep gold is produced by the shared deep layer generator'
  );
}

WG.worldSeed = 20260616;
WG.clearCaches();
world.clear();
for(let x=-384; x<384; x++){
  for(let y=WORLD_MAX_Y-12; y<WORLD_MAX_Y; y++){
    assert.notEqual(world.getTile(x,y), T.GOLD_ORE, 'absolute bedrock floor contains no gold ore');
  }
}

console.log('gold-veins-sim: all assertions passed');
