// Deterministic biome distribution regression test.
// Verifies that common seeds keep all biome ids discoverable and reasonably
// recurring across a long travel corridor.
// Run: node tools/biome-distribution-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis;
globalThis.MM = {};

const { worldGen: WG } = await import('../src/engine/worldgen.js');

const SEEDS = [12345, 20260616, 682751860, 1, 42, 987654321];
const FROM = -60000;
const TO = 60000;
const TOTAL = TO - FROM + 1;

for(const seed of SEEDS){
  WG.worldSeed = seed;
  WG.clearCaches();
  const counts = Array(9).fill(0);
  const runs = Array(9).fill(0);
  let last = -1;
  for(let x=FROM; x<=TO; x++){
    const b = WG.biomeType(x);
    counts[b]++;
    if(b!==last){
      runs[b]++;
      last=b;
    }
  }
  for(let b=0; b<=8; b++){
    const pct = counts[b] / TOTAL;
    assert.ok(pct >= 0.01, `seed ${seed}: biome ${b} is not vanishingly rare (${pct.toFixed(4)})`);
    assert.ok(pct <= 0.35, `seed ${seed}: biome ${b} does not dominate the corridor (${pct.toFixed(4)})`);
    assert.ok(runs[b] >= 15, `seed ${seed}: biome ${b} recurs in multiple patches (${runs[b]})`);
  }
}

console.log('biome-distribution-sim: all assertions passed');
