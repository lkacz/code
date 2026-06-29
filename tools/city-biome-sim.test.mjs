// Deterministic Node test for the devastated-city biome.
// Verifies: city districts are discoverable by biome search, expose a broad
// urban run, generate varied ruin/subway content, and add harvestable steel.
// Run: node tools/city-biome-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.localStorage = {
  getItem(){ return null; },
  setItem(){},
  removeItem(){}
};

const { T, INFO, CHUNK_W } = await import('../src/constants.js');
await import('../src/inventory.js');
const { worldGen: WG } = await import('../src/engine/worldgen.js');
const { fallingSolids } = await import('../src/engine/falling.js');
const { dynamo } = await import('../src/engine/dynamo.js');
const { world } = await import('../src/engine/world.js');
const { mobs } = await import('../src/engine/mobs.js');

assert.ok(WG && world, 'modules export');
assert.equal(INFO[T.STEEL].drop, 'steel', 'steel is harvestable as a resource');
assert.ok(MM.inventory.RESOURCES.some(r=>r.key==='steel' && r.tile==='STEEL'), 'steel appears in the resource registry');
assert.ok(Array.isArray(INFO[T.WIRE].drops) && INFO[T.WIRE].drops.some(d=>d.item==='plastic') && INFO[T.WIRE].drops.some(d=>d.item==='copper'), 'wire dismantles into plastic and copper');
assert.ok(Array.isArray(INFO[T.ELECTRONICS].drops) && INFO[T.ELECTRONICS].drops.some(d=>d.item==='wire') && INFO[T.ELECTRONICS].drops.some(d=>d.item==='transistor'), 'electronics dismantle into wires and transistors');
assert.ok(MM.inventory.RESOURCES.some(r=>r.key==='wire' && r.tile==='WIRE'), 'wire resource can place wire blocks');
assert.ok(MM.inventory.RESOURCES.some(r=>r.key==='plastic' && !r.tile), 'plastic is tracked as a dismantled component');
assert.ok(MM.inventory.RESOURCES.some(r=>r.key==='copper' && !r.tile), 'copper is tracked as a dismantled component');
assert.ok(MM.inventory.RESOURCES.some(r=>r.key==='transistor' && r.tile==='TRANSISTOR'), 'transistor can be placed for solar block-reaction assemblies');
assert.equal(INFO[T.DYNAMO].machine, 'dynamo', 'dynamo casing is a machine tile');
assert.ok(MM.inventory.RESOURCES.some(r=>r.key==='dynamo' && r.tile==='DYNAMO'), 'dynamo is a collectable/placeable resource');
assert.equal(INFO[T.VENDING_MACHINE].machine, 'vendingMachine', 'vending machines are machine tiles');
assert.ok(MM.inventory.RESOURCES.some(r=>r.key==='vendingMachine' && r.tile==='VENDING_MACHINE'), 'vending machines are collectable/placeable city salvage');

WG.worldSeed = 20260616;
WG.clearCaches();
world.clear();
fallingSolids.reset();

const hit = WG.nearestBiome(0, 8, 0, 60000);
assert.ok(hit, 'nearestBiome finds a devastated city');
assert.equal(WG.biomeType(hit.center), 8, 'city run center is biome 8');
assert.ok(hit.right-hit.left >= 200, 'city district spans a substantial urban area');
assert.ok(WG.cityAt(hit.center), 'cityAt exposes city metadata at the center');

const center = hit.center;
const firstChunk = Math.floor((center-180)/CHUNK_W);
const lastChunk = Math.floor((center+180)/CHUNK_W);
for(let cx=firstChunk; cx<=lastChunk; cx++) world.ensureChunk(cx);
const cityAuditQueue = fallingSolids.snapshot().queue.length;
assert.ok(cityAuditQueue > 0, 'city chunk generation queues structural collapse audit candidates');
assert.ok(cityAuditQueue <= (lastChunk-firstChunk+1)*80, 'city structural audit queues component representatives instead of per-tile storms');

const counts = {
  cityCols: 0,
  steel: 0,
  stone: 0,
  obsidian: 0,
  glass: 0,
  wire: 0,
  electronics: 0,
  dynamo: 0,
  dynamoSlot: 0,
  validDynamos: 0,
  vending: 0,
  torches: 0,
  chests: 0,
  airBelowSurface: 0
};

for(let x=center-150; x<=center+150; x++){
  const col = WG.column(x);
  if(col.biome===8) counts.cityCols++;
  const surf = WG.surfaceHeight(x);
  for(let y=0; y<140; y++){
    const t = world.getTile(x,y);
    if(t===T.STEEL) counts.steel++;
    else if(t===T.STONE) counts.stone++;
    else if(t===T.OBSIDIAN) counts.obsidian++;
    else if(t===T.GLASS) counts.glass++;
    else if(t===T.WIRE) counts.wire++;
    else if(t===T.ELECTRONICS) counts.electronics++;
    else if(t===T.DYNAMO) counts.dynamo++;
    else if(t===T.DYNAMO_SLOT){
      counts.dynamoSlot++;
      if(dynamo.isValidSlot(x,y,world.getTile)) counts.validDynamos++;
    }
    else if(t===T.VENDING_MACHINE) counts.vending++;
    else if(t===T.TORCH) counts.torches++;
    else if(t===T.CHEST_COMMON || t===T.CHEST_RARE || t===T.CHEST_EPIC) counts.chests++;
    else if(t===T.AIR && y>surf+2) counts.airBelowSurface++;
  }
}

assert.ok(counts.cityCols > 150, 'sample mostly covers city columns');
assert.ok(counts.steel > 500, 'city produces abundant harvestable steel');
assert.ok(counts.stone > 4000, 'city remains a massive stone ruin');
assert.ok(counts.obsidian > 40, 'city includes blackened/hardened ruin material');
assert.ok(counts.glass > 80, 'city generates glass window panes');
assert.ok(counts.wire >= 20 && counts.wire <= 160, 'city generates sparse dismantlable wire runs plus a power-plant cable room');
assert.ok(counts.electronics > 0 && counts.electronics <= 5, 'city generates rare dismantlable electronics blocks');
assert.ok(counts.dynamo >= 2, 'city power plant contains harvestable dynamo casing blocks');
assert.ok(counts.dynamoSlot >= 1, 'city power plant contains a dynamo turbine slot');
assert.ok(counts.validDynamos >= 1 && counts.validDynamos <= 2, 'each generated city exposes one or two complete dynamo structures in its power plant');
assert.ok(counts.vending >= 1, 'city generates fancy salvageable vending machines');
assert.ok(counts.torches > 0, 'city generates lights in underground structures');
assert.ok(counts.chests > 0, 'city can contain loot');
assert.ok(counts.airBelowSurface > 500, 'city contains carved interiors/tunnels below surface');
assert.ok(mobs.species.includes('STRAZNIK'), 'city sentinel species is registered');
assert.ok(mobs.forceSpawn('STRAZNIK', {x:center, y:WG.surfaceHeight(center)-2}, world.getTile), 'city sentinel can be debug-spawned');
assert.equal(mobs.diagnose(world.getTile).species.STRAZNIK, 1, 'city sentinel is present after spawn');
for(let i=0; i<500; i++) fallingSolids.update(world.getTile, world.setTile, 1/60);
assert.equal(fallingSolids.metrics().queue, 0, 'city structural audit settles and does not leave a permanent per-frame queue');

world.clear();
fallingSolids.reset();
for(let cx=firstChunk; cx<=lastChunk; cx++) world.ensureChunk(cx);
let steelAgain = 0;
for(let x=center-80; x<=center+80; x++){
  for(let y=0; y<140; y++) if(world.getTile(x,y)===T.STEEL) steelAgain++;
}
assert.ok(steelAgain > 200, 'city regenerates deterministically after clearing chunks');

console.log('city-biome-sim: all assertions passed at x='+center+' counts='+JSON.stringify(counts));
