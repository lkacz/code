// City robot ranged attack regression.
// Verifies the STRAZNIK sentinel uses eye lasers, not generic mob projectiles.
// Run: node tools/city-robot-laser-sim.test.mjs
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.localStorage = {
  getItem(){ return null; },
  setItem(){},
  removeItem(){}
};
let fakeNow = 0;
Object.defineProperty(globalThis, 'performance', {
  value:{now(){ return fakeNow; }},
  configurable:true
});

const { T } = await import('../src/constants.js');
const { mobs } = await import('../src/engine/mobs.js');

let beamSounds = 0;
let bursts = 0;
let sparks = 0;
globalThis.MM.audio = {
  play(id){ if(id === 'beam') beamSounds++; }
};
globalThis.MM.particles = {
  spawnBurst(){ bursts++; },
  spawnSparks(){ sparks++; }
};

const key = (x,y)=>x+','+y;
const tiles = new Map();
function getTile(x,y){
  if(y>=22) return T.STONE;
  return tiles.get(key(x,y)) ?? T.AIR;
}
function setTile(x,y,t){
  const k=key(x,y);
  if(t===T.AIR) tiles.delete(k);
  else tiles.set(k,t);
}
function resetWorld(){
  tiles.clear();
  mobs.clearAll();
  mobs.freezeSpawns(10000);
  globalThis.player = {x:8,y:21.15,vx:0,vy:0,hp:100,maxHp:100};
}
function spawnSentinel(facing=1, extra={}){
  mobs.deserialize({
    v:3,
    list:[{id:'STRAZNIK',x:1,y:21.15,vx:0,vy:0,hp:28,state:'idle',facing,...extra}],
    aggro:{mode:'rel',m:{}}
  });
  mobs.freezeSpawns(10000);
}
function runFrames(n){
  for(let i=0; i<n; i++){
    fakeNow += 1000/60;
    mobs.update(1/60, player, getTile);
  }
}
function runUntil(fn, maxFrames){
  for(let i=0; i<maxFrames; i++){
    if(fn()) return true;
    runFrames(1);
  }
  return fn();
}

let damageEvents = 0;
globalThis.damageHero = (amount)=>{
  damageEvents++;
  player.hp -= amount;
};

const sentinelSpec = mobs._debugSpecies().STRAZNIK;

resetWorld();
spawnSentinel();
runFrames(60);
let metrics = mobs.metrics();
assert.equal(damageEvents, 1, 'clear line-of-sight sentinel eye laser damages the hero once');
assert.ok(metrics.lasers >= 2, 'sentinel emits dual eye laser effects');
assert.equal(metrics.projectiles, 0, 'sentinel laser attack does not create mob projectiles');
assert.equal(beamSounds, 1, 'clear sentinel laser shot plays one beam sound');
assert.equal(sparks, 2, 'clear sentinel laser shot emits two lightweight eye-impact sparks');
assert.equal(bursts, 0, 'sentinel laser no longer uses heavy chest-style bursts');

const originalSentinelSpeed = sentinelSpec.speed;
sentinelSpec.speed = 0;
resetWorld();
player.y = 17;
spawnSentinel(1, {scale:1, speedMul:1, jumpMul:1});
setTile(3,18,T.STONE);
const beforePartial = {damageEvents, beamSounds, sparks, bursts};
assert.equal(runUntil(()=>beamSounds > beforePartial.beamSounds, 120), true, 'partly blocked sentinel eventually gets one clear eye shot');
sentinelSpec.speed = originalSentinelSpeed;
metrics = mobs.metrics();
assert.equal(damageEvents, beforePartial.damageEvents + 1, 'partly exposed hero can still be hit by one clear robot eye');
assert.equal(metrics.lasers, 1, 'partly blocked sentinel renders only the eye beam that actually reaches the hero');
assert.equal(metrics.projectiles, 0, 'partly blocked sentinel still avoids projectiles');
assert.equal(beamSounds, beforePartial.beamSounds + 1, 'partly blocked sentinel plays one beam sound for the real hit');
assert.equal(sparks, beforePartial.sparks + 1, 'partly blocked sentinel emits sparks only for the clear impact');
assert.equal(bursts, beforePartial.bursts, 'partly blocked sentinel still avoids heavy burst particles');

resetWorld();
spawnSentinel(-1);
setTile(4,19,T.STONE);
setTile(4,20,T.STONE);
setTile(4,21,T.STONE);
const beforeBlocked = {damageEvents, beamSounds, sparks, bursts};
runFrames(60);
metrics = mobs.metrics();
assert.equal(damageEvents, beforeBlocked.damageEvents, 'blocked sentinel eye laser does not damage the hero');
assert.equal(metrics.lasers, 0, 'blocked sentinel does not render laser impact effects');
assert.equal(metrics.projectiles, 0, 'blocked sentinel attack still avoids projectiles');
assert.equal(beamSounds, beforeBlocked.beamSounds, 'blocked sentinel does not play a beam sound');
assert.equal(sparks, beforeBlocked.sparks, 'blocked sentinel does not emit blocked-impact sparks');
assert.equal(bursts, beforeBlocked.bursts, 'blocked sentinel laser still avoids heavy burst particles');
assert.equal(mobs.serialize().list[0].facing, -1, 'blocked sentinel does not turn toward a hero behind terrain');

resetWorld();
spawnSentinel();
runFrames(50);
const beforeFreshCover = {damageEvents, beamSounds, sparks, bursts};
setTile(4,19,T.STONE);
setTile(4,20,T.STONE);
setTile(4,21,T.STONE);
runFrames(20);
metrics = mobs.metrics();
assert.equal(damageEvents, beforeFreshCover.damageEvents, 'fresh cover blocks a robot shot even if it was visible a few frames earlier');
assert.equal(metrics.lasers, 0, 'fresh cover prevents stale cached sight from rendering lasers');
assert.equal(metrics.projectiles, 0, 'fresh cover does not produce fallback projectiles');
assert.equal(beamSounds, beforeFreshCover.beamSounds, 'fresh cover prevents stale cached sight from playing a beam sound');
assert.equal(sparks, beforeFreshCover.sparks, 'fresh cover prevents stale cached sight from emitting sparks');
assert.equal(bursts, beforeFreshCover.bursts, 'fresh cover still avoids heavy burst particles');

resetWorld();
player.x = 12;
const beforeDense = {damageEvents, beamSounds};
mobs.deserialize({
  v:3,
  list:Array.from({length:16},(_,i)=>({
    id:'STRAZNIK',
    x:-6+i,
    y:21.15,
    vx:0,
    vy:0,
    hp:28,
    state:'idle',
    facing:1,
    shootCd:0,
    scale:1,
    speedMul:1,
    jumpMul:1
  })),
  aggro:{mode:'rel',m:{}}
});
mobs.freezeSpawns(10000);
assert.equal(runUntil(()=>mobs.metrics().sentinelShots > 0, 80), true, 'dense city patrol eventually opens fire');
metrics = mobs.metrics();
assert.ok(metrics.laserTraceCalls >= metrics.sentinelShots*2, 'dense city patrol revalidates every fired robot eye');
assert.ok(metrics.laserTraceCalls <= 32, 'dense city patrol avoids retracing more than one full dual-eye scan');
assert.ok(metrics.laserTileChecks <= 2400, 'dense city patrol keeps line-of-sight tile checks bounded');
assert.equal(metrics.sentinelShots, 3, 'dense city patrol fires as a paced volley instead of all at once');
assert.ok(metrics.sentinelDeferred >= 3, 'extra city sentinels defer their shot into later volley windows');
assert.equal(beamSounds - beforeDense.beamSounds, 3, 'dense city patrol plays at most one small volley of beam sounds per frame');
assert.equal(damageEvents - beforeDense.damageEvents, 3, 'dense city patrol damage is paced by the sentinel volley director in DOM-less sims');

assert.equal(sentinelSpec.max, 32, 'natural city sentinel global population cap is four times the previous cap');
assert.equal(sentinelSpec.localMax, 16, 'natural city sentinel local population cap allows dense city patrols');
assert.equal(sentinelSpec.spawnChance, 1, 'natural city sentinel spawn chance is capped at certainty');
assert.equal(sentinelSpec.spawnBatch, 4, 'natural city sentinel can spawn up to four robots per ecology pass');

console.log('city-robot-laser-sim: all assertions passed');
