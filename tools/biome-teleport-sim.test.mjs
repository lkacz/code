// Deterministic debug-biome teleport search test.
// Verifies that each biome can be found and that searching for the current biome
// skips the current patch instead of returning a no-op location.
// Run: node tools/biome-teleport-sim.test.mjs
import { strict as assert } from 'assert';
import { readFileSync } from 'node:fs';

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

const uiSrc = readFileSync(new URL('../src/engine/ui.js', import.meta.url), 'utf8');
const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
assert.match(uiSrc, /\[-1,'<','Left'/, 'debug row builder includes previous buttons');
assert.match(uiSrc, /\[0,label,'Near'/, 'debug row builder includes nearest buttons');
assert.match(uiSrc, /\[1,'>','Right'/, 'debug row builder includes next buttons');
assert.match(uiSrc, /addDebugTravelRow\('biomeDebug'/, 'debug menu builds biome travel rows');
assert.match(uiSrc, /addDebugTravelRow\('biomeThreat'/, 'debug menu builds biome threat rows');
assert.match(mainSrc, /function debugJumpBiomeThreat/, 'main exposes a biome threat debug jump helper');
assert.match(mainSrc, /function placeDebugTerrainHazards/, 'biome threat debug jumps can materialize terrain hazards');
assert.match(mainSrc, /function debugJumpSurfaceTemple/, 'main exposes a surface-temple debug jump helper');
assert.match(mainSrc, /WORLD\.surfaceTempleLayoutsInRange/, 'surface-temple debug travel searches generated living temples');
assert.match(mainSrc, /surfaceTempleBiome:0/, 'forest temple threat jumps to an actual surface temple');
assert.match(mainSrc, /surfaceTempleBiome:4/, 'swamp temple threat jumps to an actual surface temple');
assert.match(mainSrc, /window\.teleportHeroToBiomeThreat/, 'console debug hook can jump to biome threats');
[
  'SAND_WORM',
  'GIANT_SCORPION',
  'TEMPLE_GUARD',
  'BRAMBLE_STALKER',
  'THUNDER_BISON',
  'LETNI_ZUBR',
  'ICE_WRAITH',
  'JACKPOT_YETI',
  'BOG_LURKER',
  'STONE_GOLEM',
  'PIRANHA',
  'SHARK',
  'JACKPOT_WHALE',
  'EEL',
  'LAKE_SERPENT',
  'VULTURE',
  'STRAZNIK',
  'ATOMIC_BOMB',
  'RADIATION_COCKROACH',
  'UNSTABLE_GRASS',
  'UNSTABLE_SAND',
  'QUICKSAND'
].forEach(id=>assert.ok(mainSrc.includes(id), 'biome threat debug registry includes '+id));
assert.match(uiSrc, /forest_bramble/, 'debug menu exposes the forest bramble-stalker threat jump');
assert.match(uiSrc, /forest_grass_trap/, 'debug menu exposes the forest grass-trap threat jump');
assert.match(uiSrc, /plains_grass_trap/, 'debug menu exposes the plains grass-trap threat jump');
assert.match(uiSrc, /Forest surface temple/, 'debug menu labels the forest temple threat as a surface temple jump');
assert.match(uiSrc, /plains_bison/, 'debug menu exposes the plains thunder-bison threat jump');
assert.match(uiSrc, /snow_wraith/, 'debug menu exposes the snow ice-wraith threat jump');
assert.match(uiSrc, /snow_yeti/, 'debug menu exposes the snow jackpot-yeti threat jump');
assert.match(uiSrc, /desert_scorpion/, 'debug menu exposes the desert giant-scorpion threat jump');
assert.match(uiSrc, /desert_sand_traps/, 'debug menu exposes desert sand-trap and quicksand threat jumps');
assert.match(uiSrc, /sea_whale/, 'debug menu exposes the sea jackpot-whale threat jump');
assert.match(uiSrc, /lake_serpent/, 'debug menu exposes the lake-serpent threat jump');
assert.match(uiSrc, /city_atomic_bomb/, 'debug menu exposes the city atomic-bomb threat jump');
assert.match(uiSrc, /Swamp surface temple/, 'debug menu labels the swamp temple threat as a surface temple jump');

console.log('biome-teleport-sim: all assertions passed');
