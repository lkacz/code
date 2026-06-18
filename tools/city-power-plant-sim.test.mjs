// Regression tests for generated city power plants.
// Every devastated-city district should contain one old power plant with
// one or two complete, harvestable dynamo structures.
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.localStorage = {
  getItem(){ return null; },
  setItem(){},
  removeItem(){}
};

const { T, CHUNK_W, WORLD_H } = await import('../src/constants.js');
const { worldGen: WG } = await import('../src/engine/worldgen.js');
const { dynamo } = await import('../src/engine/dynamo.js');
const { fallingSolids } = await import('../src/engine/falling.js');
const { world } = await import('../src/engine/world.js');

function reset(seed){
  WG.worldSeed = seed;
  WG.clearCaches();
  world.clear();
  dynamo.reset();
  fallingSolids.reset();
  fallingSolids.init(world.getTile,world.setTile);
}

function cityDistrictsInSpan(span){
  const districts = new Map();
  for(let x=-span; x<=span; x+=64){
    if(WG.biomeType(x)!==8) continue;
    const city = WG.cityAt(x);
    if(city && Number.isFinite(city.center)) districts.set(city.cell+':'+city.center, city);
  }
  return [...districts.values()].sort((a,b)=>a.center-b.center);
}

function cityBounds(city){
  const radius=Math.max(80,city.radius||180);
  return {
    left:Math.floor(city.center-radius),
    right:Math.ceil(city.center+radius),
    center:city.center
  };
}

function chunksForCity(city,margin=16){
  const b=cityBounds(city);
  const first = Math.floor((b.left-margin)/CHUNK_W);
  const last = Math.floor((b.right+margin)/CHUNK_W);
  const chunks = [];
  for(let cx=first; cx<=last; cx++) chunks.push(cx);
  return chunks;
}

function ensureChunks(chunks,order='forward'){
  const list = order==='reverse' ? [...chunks].reverse() : [...chunks];
  for(const cx of list) world.ensureChunk(cx);
}

function settleGeneratedCity(){
  fallingSolids.init(world.getTile,world.setTile);
  fallingSolids.settleAll();
  for(let i=0; i<240; i++) fallingSolids.update(world.getTile,world.setTile,1/60);
  fallingSolids.settleAll();
}

function countCityPower(city){
  const bounds=cityBounds(city);
  const counts = {
    validDynamos: 0,
    slots: 0,
    casings: 0,
    electronics: 0,
    wires: 0,
    torches: 0,
    plantLikeSteel: 0
  };
  for(let x=bounds.left; x<=bounds.right; x++){
    if(WG.biomeType(x)!==8) continue;
    const surface = WG.surfaceHeight(x);
    for(let y=2; y<Math.min(WORLD_H-3, surface+12); y++){
      const t = world.getTile(x,y);
      if(t===T.DYNAMO){
        counts.casings++;
        for(const dy of [-1,0,1]){
          if(world.getTile(x+1,y+dy)===T.DYNAMO_SLOT || world.getTile(x-1,y+dy)===T.DYNAMO_SLOT) counts.plantLikeSteel++;
        }
      } else if(t===T.DYNAMO_SLOT){
        counts.slots++;
        if(dynamo.isValidSlot(x,y,world.getTile)) counts.validDynamos++;
      } else if(t===T.ELECTRONICS) counts.electronics++;
      else if(t===T.WIRE) counts.wires++;
      else if(t===T.TORCH) counts.torches++;
      else if(t===T.STEEL && y<surface-2) counts.plantLikeSteel++;
    }
  }
  return counts;
}

const seeds = [20260616, 12345, 987654321, 682751860];
let checked = 0;
let sawTwoDynamoPlant = false;

for(const seed of seeds){
  reset(seed);
  const cities = cityDistrictsInSpan(90000).slice(0,4);
  assert.ok(cities.length>=2, 'seed '+seed+' exposes multiple devastated-city districts for power-plant checks');
  for(const city of cities){
    const chunks = chunksForCity(city);
    ensureChunks(chunks,'forward');
    const forward = countCityPower(city);
    assert.ok(forward.validDynamos>=1 && forward.validDynamos<=2, 'city '+city.center+' seed '+seed+' has one or two valid power-plant dynamos');
    assert.equal(forward.slots, forward.validDynamos, 'city '+city.center+' seed '+seed+' has no orphan dynamo slots');
    assert.equal(forward.casings, forward.validDynamos*2, 'city '+city.center+' seed '+seed+' has complete dynamo casing pairs');
    assert.ok(forward.electronics>=1, 'city '+city.center+' seed '+seed+' has a power-plant control/electronics block');
    assert.ok(forward.wires>=4, 'city '+city.center+' seed '+seed+' has visible old cable runs');
    assert.ok(forward.torches>=2, 'city '+city.center+' seed '+seed+' has lit machinery rooms');
    assert.ok(forward.plantLikeSteel>=40, 'city '+city.center+' seed '+seed+' has a substantial industrial steel footprint');
    settleGeneratedCity();
    const settled = countCityPower(city);
    assert.equal(settled.validDynamos, forward.validDynamos, 'city '+city.center+' seed '+seed+' keeps valid power-plant dynamos after structural settling');
    assert.equal(settled.slots, forward.slots, 'city '+city.center+' seed '+seed+' keeps its dynamo slots after structural settling');
    assert.equal(settled.casings, forward.casings, 'city '+city.center+' seed '+seed+' keeps its dynamo casings after structural settling');
    assert.equal(fallingSolids.metrics().active,0, 'city '+city.center+' seed '+seed+' has no active falling blocks after settling');
    sawTwoDynamoPlant ||= forward.validDynamos===2;

    world.clear();
    dynamo.reset();
    fallingSolids.reset();
    fallingSolids.init(world.getTile,world.setTile);
    ensureChunks(chunks,'reverse');
    const reverse = countCityPower(city);
    assert.deepEqual(reverse, forward, 'city '+city.center+' seed '+seed+' power plant is independent of chunk load order');
    checked++;
    world.clear();
    dynamo.reset();
  }
}

assert.ok(checked>=8, 'power-plant regression covers several independent city districts');
assert.ok(sawTwoDynamoPlant, 'at least one generated city variant includes a two-dynamo plant');

console.log('city-power-plant-sim: checked '+checked+' generated city power plants');
