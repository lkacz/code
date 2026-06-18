// Deterministic ocean-span regression test.
// The generator should still create seas, but not multi-thousand-block uninterrupted
// surface-water crossings around common seeds.
import { strict as assert } from 'assert';

globalThis.window = globalThis;
globalThis.MM = {};

const { worldGen: WG } = await import('../src/engine/worldgen.js');

const seeds = [12345, 20260616, 682751860, 1, 42];
const from = -20000;
const to = 20000;

assert.equal(WG.settings.oceanFrac, 0.22, 'default ocean threshold is the narrowed value');

function waterRunStats(seed){
  WG.worldSeed = seed;
  WG.clearCaches();
  const sea = WG.settings.seaLevel;
  let longest = 0;
  let current = 0;
  let waterCols = 0;
  let runs = 0;
  for(let x=from; x<=to; x++){
    const c = WG.column(x);
    const water = c.row > sea;
    if(water){
      waterCols++;
      current++;
    } else if(current){
      longest = Math.max(longest, current);
      runs++;
      current = 0;
    }
  }
  if(current){
    longest = Math.max(longest, current);
    runs++;
  }
  return {seed, longest, runs, waterPct: waterCols/(to-from+1)};
}

let totalWater = 0;
for(const seed of seeds){
  const stats = waterRunStats(seed);
  totalWater += stats.waterPct;
  assert.ok(stats.runs >= 20, `seed ${seed}: oceans are broken into multiple crossings (${stats.runs})`);
  assert.ok(stats.longest <= 1600, `seed ${seed}: longest water crossing too wide (${stats.longest})`);
}

const avgWater = totalWater / seeds.length;
assert.ok(avgWater >= 0.12, 'seas still exist after narrowing');
assert.ok(avgWater <= 0.30, 'surface water does not dominate the sampled worlds');

console.log('ocean-span-sim: all assertions passed');
