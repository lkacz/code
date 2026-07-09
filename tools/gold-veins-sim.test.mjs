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
assert.equal(typeof worldLayers.deepGoldVeinAt, 'function', 'deep worldgen exposes short gold vein placement');

function componentStats(set,bounds){
  const seen = new Set();
  const comps = [];
  for(const k of set){
    if(seen.has(k)) continue;
    const q = [k];
    const cells = [];
    seen.add(k);
    for(let qi=0; qi<q.length; qi++){
      const cur = q[qi];
      cells.push(cur);
      const [x,y] = cur.split(',').map(Number);
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const nk = (x+dx)+','+(y+dy);
        if(set.has(nk) && !seen.has(nk)){
          seen.add(nk);
          q.push(nk);
        }
      }
    }
    const xs = cells.map(c=>Number(c.slice(0,c.indexOf(','))));
    const ys = cells.map(c=>Number(c.slice(c.indexOf(',')+1)));
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    comps.push({
      size:cells.length,
      line:new Set(ys).size === 1 && maxX-minX+1 === cells.length,
      touches:bounds && (minX<=bounds.x0 || maxX>=bounds.x1 || minY<=bounds.y0 || maxY>=bounds.y1)
    });
  }
  const assessed = comps.filter(c=>!c.touches);
  const sizes = assessed.map(c=>c.size);
  return {
    count:comps.length,
    assessed:assessed.length,
    total:comps.reduce((n,c)=>n+c.size,0),
    min:sizes.length ? Math.min(...sizes) : 0,
    max:sizes.length ? Math.max(...sizes) : 0,
    tooSmall:assessed.filter(c=>c.size<3).length,
    tooLarge:assessed.filter(c=>c.size>7).length,
    nonLine:assessed.filter(c=>!c.line).length
  };
}

function scanGold(seed){
  WG.worldSeed = seed;
  WG.clearCaches();
  world.clear();
  const legacySet = new Set();
  const deepSet = new Set();
  const rawLegacySet = new Set();
  const rawDeepSet = new Set();
  let legacyDiamond = 0, deepDiamond = 0, firstDeep = null;
  const x0 = -384, x1 = 384;
  const rawX0 = x0-24, rawX1 = x1+24;
  for(let x=rawX0; x<rawX1; x++){
    for(let y=45; y<WORLD_H-8; y++) if(WG.goldVeinAt(x,y,false)) rawLegacySet.add(x+','+y);
    for(let y=WORLD_H; y<WORLD_MAX_Y-8; y++) if(worldLayers.deepGoldVeinAt(WG,x,y)) rawDeepSet.add(x+','+y);
  }
  for(let x=x0; x<x1; x++){
    for(let y=45; y<WORLD_H-8; y++){
      const t = world.getTile(x,y);
      if(t === T.GOLD_ORE) legacySet.add(x+','+y);
      else if(t === T.DIAMOND) legacyDiamond++;
    }
    for(let y=WORLD_H; y<WORLD_MAX_Y-8; y++){
      const t = world.getTile(x,y);
      if(t === T.GOLD_ORE){
        deepSet.add(x+','+y);
        if(!firstDeep) firstDeep = {x,y};
      } else if(t === T.DIAMOND) deepDiamond++;
    }
  }
  const rawLegacy = componentStats(rawLegacySet,{x0:rawX0,x1:rawX1-1,y0:45,y1:WORLD_H-9});
  const rawDeep = componentStats(rawDeepSet,{x0:rawX0,x1:rawX1-1,y0:WORLD_H,y1:WORLD_MAX_Y-9});
  const legacy = componentStats(legacySet,{x0,x1:x1-1,y0:45,y1:WORLD_H-9});
  const deep = componentStats(deepSet,{x0,x1:x1-1,y0:WORLD_H,y1:WORLD_MAX_Y-9});
  return {
    rawLegacy,
    rawDeep,
    legacy,
    deep,
    legacyDiamond,
    deepDiamond,
    firstDeep
  };
}

for(const seed of [20260616, 20260701, 12345, 987654321, 42]){
  const r = scanGold(seed);
  assert.ok(r.rawLegacy.total >= 400, 'seed '+seed+' has visible raw legacy gold lines (found '+r.rawLegacy.total+')');
  assert.equal(r.rawLegacy.tooSmall, 0, 'seed '+seed+' raw legacy gold has no veins shorter than 3 blocks');
  assert.equal(r.rawLegacy.tooLarge, 0, 'seed '+seed+' raw legacy gold has no veins longer than 7 blocks');
  assert.equal(r.rawLegacy.nonLine, 0, 'seed '+seed+' raw legacy gold is generated as straight lines');
  assert.ok(r.rawDeep.total >= 430, 'seed '+seed+' has visible raw deep gold lines (found '+r.rawDeep.total+')');
  assert.equal(r.rawDeep.tooSmall, 0, 'seed '+seed+' raw deep gold has no veins shorter than 3 blocks');
  assert.equal(r.rawDeep.tooLarge, 0, 'seed '+seed+' raw deep gold has no veins longer than 7 blocks');
  assert.equal(r.rawDeep.nonLine, 0, 'seed '+seed+' raw deep gold is generated as straight lines');
  assert.ok(r.legacy.total >= 240, 'seed '+seed+' has visible legacy gold after caves (found '+r.legacy.total+')');
  assert.equal(r.legacy.tooLarge, 0, 'seed '+seed+' legacy world gold never merges beyond 7 blocks');
  assert.equal(r.legacy.nonLine, 0, 'seed '+seed+' legacy world gold remains line-like');
  assert.ok(r.legacy.total > r.legacyDiamond * 4, 'seed '+seed+' gold is more common than diamonds but still finite');
  assert.ok(r.deep.total >= 320, 'seed '+seed+' has deep gold after caves (found '+r.deep.total+')');
  assert.equal(r.deep.tooLarge, 0, 'seed '+seed+' deep world gold never merges beyond 7 blocks');
  assert.equal(r.deep.nonLine, 0, 'seed '+seed+' deep world gold remains line-like');
  assert.ok(r.deep.total > r.deepDiamond * 4, 'seed '+seed+' deep gold is richer than deep diamonds');
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
