// Deterministic-ish coverage for lingering guardian aftermath effects.
// Run: node tools/guardian-aftermath-sim.test.mjs
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};

let saveMarks = 0;
let igniteCalls = 0;
let lavaNotes = 0;
let fallingBatchCalls = 0;
let waterBatchCalls = 0;
globalThis.__mmMarkWorldChanged = ()=>{ saveMarks++; };
globalThis.MM.fire = {
  ignite(){ igniteCalls++; return true; },
  noteLava(){ lavaNotes++; return true; },
  heatAround(){ return true; }
};
globalThis.MM.fallingSolids = {
  onTilesChangedBatch(){ fallingBatchCalls++; },
  onTileRemoved(){ fallingBatchCalls++; },
  afterPlacement(){ fallingBatchCalls++; }
};
globalThis.MM.water = {
  onTilesChangedBatch(){ waterBatchCalls++; },
  onTileChanged(){ waterBatchCalls++; }
};

const { CHUNK_W, WORLD_H, T } = await import('../src/constants.js');
const { worldGen: WG } = await import('../src/engine/worldgen.js');
const { world } = await import('../src/engine/world.js');
const { guardianLairs } = await import('../src/engine/guardian_lairs.js');
const { undergroundBoss } = await import('../src/engine/underground_boss.js');
const { guardianAftermath } = await import('../src/engine/guardian_aftermath.js');

assert.ok(guardianAftermath && guardianAftermath.start, 'guardian aftermath module exports');
assert.equal(guardianAftermath.config.DURATION_SECONDS, guardianAftermath.config.DAY_SECONDS * 3, 'aftermath lasts three in-game days');
assert.equal(guardianAftermath.config.SKY_INTERVAL, 60, 'ice/fire remnants start at about one fall per minute');
assert.equal(guardianAftermath.config.EARTH_INTERVAL, 300, 'earth shifts start at about one displacement per five minutes');
assert.ok(guardianAftermath.config.AMBIENT_CHUNKS_PER_TICK <= 2, 'ambient aftermath scars use a small per-tick chunk budget');

let tiles = new Map();
function tileKey(x,y){ return Math.floor(x)+','+Math.floor(y); }
function baseTile(x,y){
  if(y === 60) return T.GRASS;
  if(y > 60) return T.STONE;
  return T.AIR;
}
function getTile(x,y){
  x = Math.floor(x); y = Math.floor(y);
  const k = tileKey(x,y);
  return tiles.has(k) ? tiles.get(k) : baseTile(x,y);
}
function setTile(x,y,t){
  x = Math.floor(x); y = Math.floor(y);
  tiles.set(tileKey(x,y), t);
}
function countTiles(pred){
  let n = 0;
  for(const t of tiles.values()) if(pred(t)) n++;
  return n;
}
function run(seconds, player){
  const steps = Math.ceil(seconds / 0.1);
  for(let i=0; i<steps; i++) guardianAftermath.update(0.1, player, getTile, setTile);
}
function resetWorld(){
  tiles = new Map();
  igniteCalls = 0;
  lavaNotes = 0;
  fallingBatchCalls = 0;
  waterBatchCalls = 0;
  guardianAftermath.reset();
}

const player = {x:0, y:58};

resetWorld();
guardianAftermath.start('ice', {immediate:true});
guardianAftermath.update(0.1, player, getTile, setTile);
assert.equal(guardianAftermath.status().active, 'ice', 'ice defeat starts the ice aftermath');
assert.ok(guardianAftermath.status().falling >= 1, 'ice aftermath spawns a visible falling snow remnant');
run(4, player);
assert.equal(guardianAftermath.status().falling, 0, 'ice remnant collides with terrain instead of hovering forever');
assert.ok(countTiles(t=>t === T.SNOW || t === T.ICE) > 0, 'ice aftermath leaves snow/ice blocks in the world');
assert.ok(fallingBatchCalls > 0, 'ice impact wakes falling-solid physics');
assert.ok(waterBatchCalls > 0, 'ice impact wakes water/ice neighborhood logic');

guardianAftermath.start('fire', {immediate:true});
assert.equal(guardianAftermath.status().active, 'fire', 'fire defeat replaces the previous aftermath');
assert.equal(guardianAftermath.status().falling, 0, 'replacement clears old in-flight remnants');
guardianAftermath.update(0.1, player, getTile, setTile);
run(4, player);
assert.ok(countTiles(t=>t === T.COAL || t === T.LAVA || t === T.BASALT || t === T.HOT_AIR || t === T.METEOR_DUST) > 0, 'fire aftermath leaves burning/charred blocks in the world');
assert.ok(igniteCalls > 0 || lavaNotes > 0, 'fire aftermath uses the fire/lava wake hooks');

const beforeEarthTiles = tiles.size;
guardianAftermath.start('earth', {immediate:true});
guardianAftermath.update(0.1, player, getTile, setTile);
assert.equal(guardianAftermath.status().active, 'earth', 'earth defeat starts the tectonic aftermath');
assert.ok(tiles.size > beforeEarthTiles, 'earth aftermath displaces real terrain blocks');
assert.ok(guardianAftermath.status().effects <= guardianAftermath.config.MAX_EFFECTS, 'earth aftermath respects effect caps');

resetWorld();
guardianAftermath.start('ice', {nextIn:999, salt:12345});
const traveler = {x:CHUNK_W * 12 + 9, y:58};
run(1.6, traveler);
assert.ok(guardianAftermath.status().ambientChunks > 0, 'moving through the world lazily processes ambient aftermath chunks');
assert.ok(countTiles(t=>t === T.SNOW || t === T.ICE) > 0, 'ambient ice aftermath leaves old snow/ice traces near a travelled-to area');
const ambientAfterFirstStop = guardianAftermath.status().ambientChunks;
traveler.x += CHUNK_W * 8;
run(3.0, traveler);
assert.ok(guardianAftermath.status().ambientChunks > ambientAfterFirstStop, 'newly visited areas receive their own aftermath traces');
const ambientSnap = guardianAftermath.snapshot();
assert.ok(Array.isArray(ambientSnap.ambient) && ambientSnap.ambient.length > 0, 'snapshot preserves processed ambient scar chunks');
guardianAftermath.reset();
assert.equal(guardianAftermath.restore(ambientSnap), true, 'restore accepts ambient scar chunk history');
assert.equal(guardianAftermath.status().ambientChunks, ambientSnap.ambient.length, 'restore keeps ambient scar chunks from being reprocessed immediately');

resetWorld();
guardianAftermath.start('fire', {nextIn:999, salt:98765});
let forcedAmbient = false;
for(let cx=0; cx<30 && !forcedAmbient; cx++){
  forcedAmbient = guardianAftermath._debug().applyAmbientChunk(cx, {x:-999, y:-999}, getTile, setTile, {force:true});
}
assert.equal(forcedAmbient, true, 'debug can force a deterministic ambient scar chunk');
assert.ok(countTiles(t=>t === T.COAL || t === T.LAVA || t === T.BASALT || t === T.METEOR_DUST) > 0, 'forced ambient fire scar leaves charred terrain');

guardianAftermath.start('earth', {nextIn:999, salt:24680});
const arr = new Uint8Array(CHUNK_W * WORLD_H);
for(let x=0; x<CHUNK_W; x++){
  for(let y=0; y<WORLD_H; y++) arr[y * CHUNK_W + x] = y < 60 ? T.AIR : (y === 60 ? T.GRASS : T.STONE);
}
let generatedChunkChanged = 0;
for(let cx=40; cx<90 && generatedChunkChanged<=0; cx++) generatedChunkChanged = guardianAftermath.applyToChunk(arr, cx);
assert.ok(generatedChunkChanged > 0, 'newly generated chunks can receive lightweight global aftermath scars');
assert.ok(guardianAftermath.status().ambientChunks > 0, 'procedural chunk scars are remembered to avoid a second local pass');
const noDuplicateWorld = new Map();
const noDuplicateGet = (x,y)=>noDuplicateWorld.get(tileKey(x,y)) ?? baseTile(x,y);
const noDuplicateSet = (x,y,t)=>noDuplicateWorld.set(tileKey(x,y), t);
assert.equal(guardianAftermath._debug().applyAmbientChunk(40, {x:-999,y:-999}, noDuplicateGet, noDuplicateSet), false, 'chunk scar generation suppresses duplicate local scar application');
assert.equal(noDuplicateWorld.size, 0, 'duplicate-suppressed ambient scar leaves terrain untouched');

resetWorld();
guardianAftermath.start('fire', {nextIn:999, salt:555});
const protectedGet = ()=>T.WIRE;
const protectedWrites = [];
const protectedSet = (x,y,t)=>protectedWrites.push({x,y,t});
assert.equal(guardianAftermath._debug().applyAmbientChunk(3, {x:-999,y:-999}, protectedGet, protectedSet, {force:true}), false, 'ambient scars do not overwrite utility/passable infrastructure tiles');
assert.equal(protectedWrites.length, 0, 'protected utility tiles receive no aftermath terrain writes');

resetWorld();
globalThis.inv = {heartFire:1, heartIce:1, heartEarth:0};
WG.worldSeed = 20260630;
WG.clearCaches && WG.clearCaches();
world.clear();
guardianLairs.reset();
guardianLairs.clearCache && guardianLairs.clearCache();
undergroundBoss.reset();
undergroundBoss.clearCache && undergroundBoss.clearCache();
guardianLairs.markDefeated('fire');
guardianLairs.markDefeated('ice');
function forcedOps(layout, cap=300){
  const byKey = new Map();
  for(const o of layout.ops || []) if(o.f === 1) byKey.set(o.x+','+o.y, o);
  return [...byKey.values()].slice(0, cap);
}
function assertStructureProtected(kind, label, layout){
  const forced = forcedOps(layout);
  assert.ok(forced.length > 0, label+' exposes forced structure ops');
  world.clear();
  guardianAftermath.start(kind, {nextIn:999, salt:424242});
  for(const o of forced) assert.equal(world.getTile(o.x,o.y), o.t, kind+' aftermath does not alter generated '+label+' tile at '+o.x+','+o.y);
  const chunks = new Set(forced.map(o=>Math.floor(o.x / CHUNK_W)));
  for(const cx of chunks) guardianAftermath._debug().applyAmbientChunk(cx, {x:-999,y:-999}, world.getTile, world.setTile, {force:true});
  for(const o of forced) assert.equal(world.getTile(o.x,o.y), o.t, kind+' ambient scars do not alter '+label+' tile at '+o.x+','+o.y);
}
const protectedStructures = [
  ['fire lair', guardianLairs.layoutFor('fire')],
  ['ice lair', guardianLairs.layoutFor('ice')],
  ['underground gate', guardianLairs.undergroundGateLayout()],
  ['underground arena', undergroundBoss.layoutFor()]
];
for(const kind of ['fire','ice','earth']){
  for(const [label, layout] of protectedStructures) assertStructureProtected(kind, label, layout);
}

resetWorld();
guardianAftermath.start('ice', {elapsed:120, nextIn:33});
const snap = guardianAftermath.snapshot();
assert.equal(snap.active, 'ice', 'snapshot records active aftermath kind');
assert.equal(snap.elapsed, 120, 'snapshot records elapsed aftermath time');
guardianAftermath.reset();
assert.equal(guardianAftermath.status().active, null, 'reset clears active aftermath');
assert.equal(guardianAftermath.restore(snap), true, 'restore accepts a valid aftermath snapshot');
assert.equal(guardianAftermath.status().active, 'ice', 'restore revives active aftermath');
assert.ok(guardianAftermath.status().nextIn <= 33.1, 'restore keeps the next event timer');

guardianAftermath._debug().setElapsed(guardianAftermath.config.DURATION_SECONDS + 0.5);
guardianAftermath.update(0.1, player, getTile, setTile);
assert.equal(guardianAftermath.status().active, null, 'aftermath expires after three in-game days');
assert.ok(saveMarks > 0, 'aftermath lifecycle marks the world dirty');

const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const uiSrc = await readFile(new URL('../src/engine/ui.js', import.meta.url), 'utf8');
const worldSrc = await readFile(new URL('../src/engine/world.js', import.meta.url), 'utf8');
const guardianSrc = await readFile(new URL('../src/engine/guardian_lairs.js', import.meta.url), 'utf8');
const undergroundSrc = await readFile(new URL('../src/engine/underground_boss.js', import.meta.url), 'utf8');
const packageSrc = await readFile(new URL('../package.json', import.meta.url), 'utf8');
assert.match(mainSrc, /import \{ guardianAftermath as AFTERMATH \} from '\.\/engine\/guardian_aftermath\.js';/, 'main imports guardian aftermath');
assert.match(mainSrc, /guardianAftermath:\s*timedSavePart\('guardianAftermath',[^\n]*AFTERMATH && AFTERMATH\.snapshot/, 'save payload includes aftermath state');
assert.match(mainSrc, /AFTERMATH\.restore\(data\.guardianAftermath\)/, 'load path restores aftermath state');
assert.match(mainSrc, /AFTERMATH && AFTERMATH\.update/, 'main update loop advances aftermath effects');
assert.match(mainSrc, /AFTERMATH && AFTERMATH\.draw/, 'main draw loop renders aftermath effects in world space');
assert.match(worldSrc, /import \{ guardianAftermath as AFTERMATH \} from '\.\/guardian_aftermath\.js';/, 'world imports aftermath chunk scar generation');
assert.match(worldSrc, /AFTERMATH && AFTERMATH\.applyToChunk/, 'world applies lightweight aftermath scars to newly generated chunks');
assert.match(mainSrc, /function debugGuardianAftermath\(kind\)/, 'main exposes a guardian aftermath debug helper');
assert.match(mainSrc, /aftermath:\(kind\)=> debugGuardianAftermath\(kind\)/, 'travel debug panel is wired to guardian aftermath controls');
assert.match(mainSrc, /window\.startGuardianAftermath/, 'console debug can start a guardian aftermath');
assert.match(mainSrc, /window\.clearGuardianAftermath/, 'console debug can clear guardian aftermath');
assert.match(mainSrc, /window\.applyGuardianAftermathScars/, 'console debug can force ambient aftermath scars near the hero');
assert.match(mainSrc, /kind==='scars'/, 'main debug helper supports forcing ambient aftermath scars');
assert.match(uiSrc, /actions\.aftermath/, 'travel debug UI includes guardian aftermath buttons');
assert.match(uiSrc, /Aftermath \(debug\):/, 'travel debug UI labels the aftermath debug row');
assert.match(uiSrc, /Scars/, 'travel debug UI exposes an aftermath scars button');
assert.match(guardianSrc, /MM\.guardianAftermath && MM\.guardianAftermath\.start\) MM\.guardianAftermath\.start\(kind\)/, 'fire/ice guardian death starts aftermath');
assert.match(undergroundSrc, /MM\.guardianAftermath && MM\.guardianAftermath\.start\) MM\.guardianAftermath\.start\('earth'\)/, 'underground guardian death starts earth aftermath');
assert.match(packageSrc, /"test:guardian-aftermath"/, 'package exposes the guardian aftermath sim test');
assert.match(packageSrc, /test:underground && npm run test:guardian-aftermath/, 'full check runs aftermath coverage after boss coverage');

console.log('guardian-aftermath-sim: all assertions passed');
