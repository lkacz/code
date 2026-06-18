// Deterministic debug-biome teleport search test.
// Verifies that each biome can be found and that searching for the current biome
// skips the current patch instead of returning a no-op location.
// Run: node tools/biome-teleport-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis;
globalThis.MM = {};

const { worldGen: WG } = await import('../src/engine/worldgen.js');

WG.worldSeed = 20260616;
WG.clearCaches();

const origin = 0;
const MAX = 60000;

function currentRunFor(biome){
  if(WG.biomeType(origin)!==biome) return null;
  let left=origin, right=origin;
  while(left>origin-MAX && WG.biomeType(left-1)===biome) left--;
  while(right<origin+MAX && WG.biomeType(right+1)===biome) right++;
  return {left,right};
}

function assertHitShape(hit, biome){
  assert.equal(WG.biomeType(hit.nearest), biome, 'nearest edge is in biome '+biome);
  assert.equal(WG.biomeType(hit.center), biome, 'center is in biome '+biome);
  assert.equal(WG.biomeType(hit.left), biome, 'left edge is in biome '+biome);
  assert.equal(WG.biomeType(hit.right), biome, 'right edge is in biome '+biome);
  assert.ok(hit.left<=hit.nearest && hit.nearest<=hit.right, 'run contains nearest edge for biome '+biome);
  assert.ok(hit.left<=hit.center && hit.center<=hit.right, 'run contains center for biome '+biome);
  assert.equal(hit.distance, Math.abs(hit.nearest-origin), 'distance is measured to nearest edge for biome '+biome);
}

function assertNoCloserTarget(hit, biome, dir=0){
  const skip=currentRunFor(biome);
  const hitD=Math.abs(hit.nearest-origin);
  for(let d=0; d<hitD; d++){
    const candidates = dir<0 ? [origin-d] : (dir>0 ? [origin+d] : (d===0 ? [origin] : [origin-d,origin+d]));
    for(const x of candidates){
      if(skip && x>=skip.left && x<=skip.right) continue;
      assert.notEqual(WG.biomeType(x), biome, 'no closer biome '+biome+' at x='+x);
    }
  }
}

for(let biome=0; biome<=8; biome++){
  const hit = WG.nearestBiome(origin, biome, 0, MAX);
  assert.ok(hit, 'nearestBiome finds biome '+biome);
  assertHitShape(hit, biome);
  assertNoCloserTarget(hit, biome, 0);
}

const current = WG.biomeType(origin);
const nextSame = WG.nearestBiome(origin, current, 0, MAX);
assert.ok(nextSame, 'current biome has another patch nearby');
assert.ok(origin<nextSame.left || origin>nextSame.right, 'current biome search skips the current patch');
assertNoCloserTarget(nextSame, current, 0);

const seaRight = WG.nearestBiome(origin, 5, 1, MAX);
assert.ok(seaRight && seaRight.nearest>origin, 'directed right search finds sea to the right');
assertNoCloserTarget(seaRight, 5, 1);
const snowLeft = WG.nearestBiome(origin, 2, -1, MAX);
assert.ok(snowLeft && snowLeft.nearest<origin, 'directed left search finds snow to the left');
assertNoCloserTarget(snowLeft, 2, -1);

assert.equal(WG.nearestBiome(origin, -1, 0, MAX), null, 'invalid negative biome is rejected');
assert.equal(WG.nearestBiome(origin, 9, 0, MAX), null, 'invalid high biome is rejected');
assert.equal(WG.nearestBiome(origin, 1, 0, 10), null, 'too-small search range can miss a biome');

console.log('biome-teleport-sim: all assertions passed');
