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
const { invasions } = await import('../src/engine/invasions.js');

let beamSounds = 0;
let warningSounds = 0;
let bursts = 0;
let sparks = 0;
globalThis.MM.audio = {
  play(id){ if(id === 'beam') beamSounds++; if(id === 'warning') warningSounds++; }
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
  invasions.reset();
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
function spawnActiveMolekinTarget(x=5.5,y=21.15){
  invasions.restore({
    teams:[{
      id:'city_mole_target',
      kind:'molekin',
      state:'active',
      x,y,
      day:6,
      index:0,
      alienCount:1,
      playerLevel:1,
      threatLevel:8,
      grade:1,
      weaponTier:1,
      burrow:{x,y,targetY:y,progress:1,open:true,warned:true,crackStage:2,phase:0},
      lander:{x,y,targetY:y,vx:0,vy:0,hp:1,maxHp:1,destroyed:false,landed:true,invisible:true},
      aliens:[{id:'city_mole_target:0',kind:'molekin',role:'rusher',x,y,vx:0,vy:0,hp:80,maxHp:80}]
    }],
    caches:[],
    lastNightDay:0,
    seq:20
  }, getTile, setTile);
  return invasions._debug.teams[0].aliens[0];
}
function runFrames(n){
  for(let i=0; i<n; i++){
    fakeNow += 1000/60;
    mobs.update(1/60, player, getTile, setTile);
  }
}
function runUntil(fn, maxFrames){
  for(let i=0; i<maxFrames; i++){
    if(fn()) return true;
    runFrames(1);
  }
  return fn();
}
function withRandom(value, fn){
  const originalRandom = Math.random;
  Math.random = typeof value === 'function' ? value : ()=>value;
  try{ return fn(); }
  finally{ Math.random = originalRandom; }
}

let damageEvents = 0;
globalThis.damageHero = (amount)=>{
  damageEvents++;
  player.hp -= amount;
};

const sentinelSpec = mobs._debugSpecies().STRAZNIK;

resetWorld();
spawnSentinel();
const beforeDodge = {damageEvents,beamSounds,warningSounds};
assert.equal(runUntil(()=>mobs._debugCombat().sentinelCharges.length===1,80),true,'visible hero makes the sentinel begin a one-second warning charge');
const lockedRobotAim={...mobs._debugCombat().sentinelCharges[0]};
assert.equal(damageEvents,beforeDodge.damageEvents,'sentinel warning phase cannot damage the hero');
assert.equal(beamSounds,beforeDodge.beamSounds,'sentinel warning phase does not emit the laser early');
assert.equal(warningSounds,beforeDodge.warningSounds+1,'every sentinel shot starts with an audible warning signal');
assert.equal(lockedRobotAim.duration,1,'city sentinel warning lasts exactly one second');
assert.ok(mobs.ghostRoster().poses[0][5]===1,'multiplayer pose stream exposes the sentinel warning phase');
const savedRobotCharge=mobs.serialize().list[0];
assert.ok(savedRobotCharge.sentinelCharge&&Math.abs(savedRobotCharge.sentinelCharge.aimX-lockedRobotAim.aimX)<0.01,'save data preserves an in-progress robot warning and its locked point');
mobs.deserialize({v:5,list:[savedRobotCharge],aggro:{mode:'rel',m:{}}});
mobs.freezeSpawns(10000);
assert.ok(mobs._debugCombat().sentinelCharges.length===1,'loading a save resumes the committed robot warning instead of firing immediately');
player.y=17;
assert.equal(runUntil(()=>beamSounds>beforeDodge.beamSounds,90),true,'sentinel fires after its warning even when the hero has already dodged');
assert.equal(damageEvents,beforeDodge.damageEvents,'moving away from the locked point avoids the city robot laser');
let firedLines=mobs._debugCombat().lasers;
assert.ok(firedLines.length>=2&&firedLines.every(l=>Math.hypot(l.x2-lockedRobotAim.aimX,l.y2-lockedRobotAim.aimY)<0.8),'robot fires at the point captured before the dodge');
assert.ok(mobs.ghostRoster().lasers.length>=2,'released city robot beams are mirrored to multiplayer spectators');

resetWorld();
spawnSentinel();
const beforeStationary = {damageEvents,beamSounds,warningSounds,sparks,bursts};
assert.equal(runUntil(()=>damageEvents>beforeStationary.damageEvents,150),true,'hero who remains at the warned point is hit after the one-second charge');
let metrics = mobs.metrics();
assert.equal(damageEvents, beforeStationary.damageEvents+1, 'clear line-of-sight sentinel eye laser damages the stationary hero once');
assert.ok(metrics.lasers >= 2, 'sentinel emits dual eye laser effects');
assert.equal(metrics.projectiles, 0, 'sentinel laser attack does not create mob projectiles');
assert.equal(beamSounds, beforeStationary.beamSounds+1, 'clear sentinel laser shot plays one beam sound');
assert.equal(warningSounds,beforeStationary.warningSounds+1,'the successful follow-up shot also has its own warning');
assert.equal(sparks, beforeStationary.sparks+2, 'clear sentinel laser shot emits two lightweight eye-impact sparks');
assert.equal(bursts, beforeStationary.bursts, 'sentinel laser no longer uses heavy chest-style bursts');

resetWorld();
spawnSentinel(1, {scale:1, speedMul:1, jumpMul:1});
const alienTeam = invasions.spawnRuinCommander(5.5,21.15,{key:'city-robot-target',player,getTile,setTile,day:6});
const alienTarget = alienTeam.aliens[0];
alienTarget.hp = alienTarget.maxHp = 80;
const beforeAlienShot = {hp:alienTarget.hp, damageEvents, beamSounds};
assert.equal(typeof invasions.nearestForEnemy, 'function', 'invasions expose alien targets for hostile city systems');
assert.equal(runUntil(()=>alienTarget.hp < beforeAlienShot.hp, 180), true, 'city sentinel targets and shoots a visible alien invader after warning');
assert.equal(damageEvents, beforeAlienShot.damageEvents, 'sentinel attacking an alien does not damage the hero');
assert.equal(beamSounds, beforeAlienShot.beamSounds + 1, 'alien shot uses the same city sentinel eye laser');

resetWorld();
spawnSentinel(1, {scale:1, speedMul:1, jumpMul:1});
const moleTarget = spawnActiveMolekinTarget(5.5,21.15);
const beforeMoleShot = {hp:moleTarget.hp, damageEvents, beamSounds};
assert.equal(runUntil(()=>moleTarget.hp < beforeMoleShot.hp, 180), true, 'city sentinel also targets and shoots a visible molekin invader after warning');
assert.equal(damageEvents, beforeMoleShot.damageEvents, 'sentinel attacking a molekin does not damage the hero');
assert.equal(beamSounds, beforeMoleShot.beamSounds + 1, 'molekin shot uses the same city sentinel eye laser');

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
assert.equal(metrics.lasers, 2, 'partly blocked sentinel shows both fired eye beams, including the one stopped by cover');
assert.equal(metrics.projectiles, 0, 'partly blocked sentinel still avoids projectiles');
assert.equal(beamSounds, beforePartial.beamSounds + 1, 'partly blocked sentinel plays one beam sound for the real hit');
assert.equal(sparks, beforePartial.sparks + 2, 'partly blocked sentinel emits one lightweight impact for each fired eye');
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
assert.equal(runUntil(()=>mobs._debugCombat().sentinelCharges.length===1,80),true,'sentinel visibly locks its target before fresh cover is placed');
const beforeFreshCover = {damageEvents, beamSounds, sparks, bursts};
setTile(4,19,T.STONE);
setTile(4,20,T.STONE);
setTile(4,21,T.STONE);
assert.equal(runUntil(()=>beamSounds>beforeFreshCover.beamSounds,90),true,'sentinel completes the warned shot into newly placed cover');
metrics = mobs.metrics();
assert.equal(damageEvents, beforeFreshCover.damageEvents, 'fresh cover blocks a robot shot even if it was visible a few frames earlier');
assert.equal(metrics.lasers, 2, 'fresh cover receives the two already-committed robot beams');
assert.equal(metrics.projectiles, 0, 'fresh cover does not produce fallback projectiles');
assert.equal(beamSounds, beforeFreshCover.beamSounds+1, 'committed robot shot still plays its beam sound when cover catches it');
assert.equal(sparks, beforeFreshCover.sparks+2, 'fresh cover receives both lightweight eye impacts');
assert.equal(bursts, beforeFreshCover.bursts, 'fresh cover still avoids heavy burst particles');

resetWorld();
withRandom(0.5, ()=>{
  spawnSentinel(1, {scale:1, speedMul:1, jumpMul:1});
  setTile(4,20,T.MEAT);
  const beforeMeat = {damageEvents, beamSounds};
  assert.equal(runUntil(()=>getTile(4,20)!==T.MEAT, 140), true, 'visible raw meat bait is shot by a city sentinel');
  metrics = mobs.metrics();
  assert.equal(getTile(4,20), T.BAKED_MEAT, 'robot laser cooks visible raw meat most of the time');
  assert.equal(damageEvents, beforeMeat.damageEvents, 'sentinel prioritizes visible meat bait over the hero');
  assert.equal(beamSounds, beforeMeat.beamSounds + 1, 'meat shot uses the same beam cue as a robot laser');
  assert.equal(metrics.sentinelMeatCooked, 1, 'meat cooking is tracked in mob metrics');
  assert.equal(metrics.sentinelMeatDestroyed, 0, 'non-destructive meat shot does not count as destroyed');
});

resetWorld();
withRandom(0.05, ()=>{
  spawnSentinel(1, {scale:1, speedMul:1, jumpMul:1});
  setTile(4,20,T.MEAT);
  assert.equal(runUntil(()=>getTile(4,20)!==T.MEAT, 140), true, 'visible raw meat bait is resolved by a robot shot');
  metrics = mobs.metrics();
  assert.equal(getTile(4,20), T.AIR, 'low destruction roll makes the robot laser vaporize raw meat');
  assert.equal(metrics.sentinelMeatDestroyed, 1, 'destructive meat shot is tracked in mob metrics');
});

resetWorld();
withRandom(0, ()=>{
  const savedSpeed = sentinelSpec.speed;
  sentinelSpec.speed = 0;
  try{
    spawnSentinel(1, {scale:1, speedMul:1, jumpMul:1, sentinelShotsUntilReload:3});
    const beforeReloadDamage = damageEvents;
    assert.equal(runUntil(()=>mobs.metrics().sentinelReloads >= 1, 520), true, 'sentinel enters reload after its fixed three warned shots');
    assert.equal(damageEvents - beforeReloadDamage, 3, 'fixed three-shot burst deals exactly three laser hits before reload');
    const damageAtReload = damageEvents;
    const savedReloadState = mobs.serialize().list[0];
    assert.ok(savedReloadState.sentinelReloadT > 0, 'sentinel reload timer is included in save data');
    mobs.deserialize({v:4, list:[savedReloadState], aggro:{mode:'rel',m:{}}});
    mobs.freezeSpawns(10000);
    assert.ok(mobs.serialize().list[0].sentinelReloadT > 0, 'sentinel reload timer survives save restore');
    runFrames(120);
    assert.equal(damageEvents, damageAtReload, 'sentinel cannot fire during the first two seconds of its reload window');
    assert.equal(runUntil(()=>damageEvents > damageAtReload, 280), true, 'sentinel resumes warning and firing after the three-second reload');
  } finally {
    sentinelSpec.speed = savedSpeed;
  }
});

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
assert.equal(runUntil(()=>mobs.metrics().sentinelShots > 0, 180), true, 'dense city patrol eventually opens fire after its warning phase');
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
