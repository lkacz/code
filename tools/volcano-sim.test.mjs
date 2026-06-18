// Deterministic Node test for seeded volcano terrain.
// Verifies: volcanoes are rare but present away from spawn, form steep rocky
// cones, expose crater lava, connect to a bottom magma reservoir, and register
// generated lava with the sparse lava simulation when chunks load.
// Run: node tools/volcano-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis;
globalThis.MM = {};

const { T, CHUNK_W, WORLD_H } = await import('../src/constants.js');
const { worldGen: WG } = await import('../src/engine/worldgen.js');
const { world } = await import('../src/engine/world.js');
assert.ok(WG && world, 'modules export');

WG.worldSeed = 20260616;
WG.clearCaches();
world.clear();

for(let x=-220; x<=220; x++){
  assert.ok(!WG.column(x).volcano, 'spawn-adjacent columns stay volcano-free');
}

function findVolcanoCenter(span){
  const seen = new Set();
  for(let x=-span; x<=span; x++){
    const c=WG.column(x);
    if(!c.volcano || seen.has(c.volcano.center)) continue;
    seen.add(c.volcano.center);
    const centerCol=WG.column(c.volcano.center);
    if(centerCol.volcano && centerCol.volcano.center===c.volcano.center) return c.volcano.center;
  }
  return null;
}

const center = findVolcanoCenter(30000);
assert.ok(Number.isFinite(center), 'at least one real volcano appears in a long exploration span');
const col = WG.column(center);
const v = col.volcano;
assert.ok(v && v.radius>=18 && v.height>=24, 'volcano metadata is substantial');
assert.equal(WG.biomeType(center), 7, 'volcano becomes mountain biome');
assert.equal(WG.volcanoAt(center).center, center, 'volcanoAt reports materialized volcanoes');
assert.equal(WG.nearestVolcano(center-v.radius-80, 1).center, center, 'nearestVolcano finds the next volcano to the right');
assert.equal(WG.nearestVolcano(center+v.radius+80, -1).center, center, 'nearestVolcano finds the previous volcano to the left');
const afterCurrent = WG.nearestVolcano(center+v.radius+2, 1);
assert.ok(!afterCurrent || afterCurrent.center>center, 'searching beyond a volcano does not return it again');

let coneTop = WORLD_H;
for(let x=center-v.crater-3; x<=center+v.crater+3; x++) coneTop = Math.min(coneTop, WG.surfaceHeight(x));
const leftBase = WG.surfaceHeight(center-v.radius-8);
const rightBase = WG.surfaceHeight(center+v.radius+8);
assert.ok(Math.max(leftBase,rightBase)-coneTop >= 10,
  'volcano rises as a steep cone above nearby terrain');

const noted = new Set();
MM.fire = { noteLava:(x,y)=>{ noted.add(x+','+y); } };
world.clear();
world.ensureChunk(Math.floor(center/CHUNK_W));

const surface = WG.surfaceHeight(center);
assert.equal(world.getTile(center,surface), T.LAVA, 'crater exposes lava at the surface');
assert.equal(world.getTile(center,WORLD_H-4), T.LAVA, 'central conduit reaches the bottom reservoir');
assert.ok(noted.has(center+','+surface), 'surface lava registered with the lava sim');
assert.ok(noted.size < 96, `generated volcano registers only exposed/frontier lava, not the full sealed conduit (${noted.size})`);

let conduitLava = 0;
for(let y=surface; y<WORLD_H-3; y++) if(world.getTile(center,y)===T.LAVA) conduitLava++;
assert.ok(conduitLava >= WORLD_H-3-surface-2, 'lava pipe is continuous down the map');

let reservoirWidth = 0;
for(let x=center-v.reservoir; x<=center+v.reservoir; x++){
  if(world.getTile(x,WORLD_H-4)===T.LAVA) reservoirWidth++;
}
assert.ok(reservoirWidth >= v.reservoir*2, 'bottom magma reservoir spans the volcano root');

for(let y=surface; y<Math.min(WORLD_H-3, surface+12); y++){
  const wall = world.getTile(center+v.pipe+1,y);
  assert.ok(wall===T.OBSIDIAN || wall===T.STONE, 'pipe is bounded by hardened rock');
}

const snapshot=[];
for(let y=surface; y<WORLD_H-3; y++) snapshot.push(world.getTile(center,y));
world.clear();
for(let y=surface; y<WORLD_H-3; y++){
  assert.equal(world.getTile(center,y), snapshot[y-surface], 'volcano regenerates deterministically');
}

console.log('volcano-sim: all assertions passed at x='+center);
