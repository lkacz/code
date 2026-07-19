// Weather shaman regression: rare side-map shamans perform a ritual, then
// owner-scoped storm rain plus a 3x gale pulls toward the center until they die.
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.CustomEvent = globalThis.CustomEvent || class { constructor(type,opts){ this.type=type; this.detail=opts&&opts.detail; } };
globalThis.dispatchEvent = () => true;
globalThis.msg = () => {};

let simNow = 0;
globalThis.performance = { now:()=>simNow };

const { T, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } = await import('../src/constants.js');
MM.T = T;
MM.WORLD_H = WORLD_H;
MM.WORLD_MIN_Y = WORLD_MIN_Y;
MM.WORLD_MAX_Y = WORLD_MAX_Y;
MM.TILE = 20;
MM.water = { addSource(){ return true; }, onTileChanged(){}, disturb(){} };
MM.particles = { spawnBurst(){}, spawnSplash(){}, spawnBubble(){} };
MM.background = { getCycleInfo(){ return {cycleT:0.25, isDay:true, tDay:0.5}; } };
MM.seasons = { profile(){ return {id:'spring', animalSpawnMult:1}; }, metrics(){ return {season:'spring'}; } };

const { worldGen } = await import('../src/engine/worldgen.js');
worldGen.worldSeed = 424242;
worldGen.clearCaches();
worldGen.surfaceHeight = () => 30;
worldGen.temperature = x => x<0 ? 0.15 : 0.82;
worldGen.biomeType = x => x<0 ? 2 : 3;
worldGen.volcanoAt = x => x>0 && x%997===0;
MM.worldGen = worldGen;

const { wind } = await import('../src/engine/wind.js');
const { clouds } = await import('../src/engine/clouds.js');
const { sandstorm } = await import('../src/engine/sandstorm.js');
const { softDrifts } = await import('../src/engine/soft_drifts.js');
const { mobs } = await import('../src/engine/mobs.js');

globalThis.inv = {snow:0, ice:0, diamond:0, coal:0, basalt:0, obsidian:0};
globalThis.player = {x:0,y:29,w:0.7,h:0.95,vx:0,vy:0,onGround:true,hp:100,maxHp:100,xp:0};
globalThis.damageHero = () => {};

const tiles = new Map();
const key = (x,y)=>Math.floor(x)+','+Math.floor(y);
function baseFloor(x){
  return x<0 ? T.SNOW : T.BASALT;
}
function getTile(x,y){
  x=Math.floor(x); y=Math.floor(y);
  if(y<WORLD_MIN_Y || y>=WORLD_MAX_Y) return T.STONE;
  const k=key(x,y);
  if(tiles.has(k)) return tiles.get(k);
  return y>=30 ? baseFloor(x) : T.AIR;
}
function setTile(x,y,t){
  x=Math.floor(x); y=Math.floor(y);
  if(y>=WORLD_MIN_Y && y<WORLD_MAX_Y) tiles.set(key(x,y),t);
}
function withRandom(value, fn){
  const oldRandom = Math.random;
  Math.random = () => value;
  try{ return fn(); }
  finally{ Math.random = oldRandom; }
}
function resetAll(){
  tiles.clear();
  simNow = 0;
  wind.reset();
  clouds.reset();
  sandstorm.reset();
  softDrifts.reset();
  mobs.clearAll();
  globalThis.player.hp = 100;
  globalThis.player.x = 0;
  globalThis.player.y = 29;
}
function spawnShaman(id,x){
  const p={x,y:29,w:0.7,h:0.95,vx:0,vy:0,onGround:true,hp:100,maxHp:100};
  globalThis.player=p;
  const ok=withRandom(0.5,()=>mobs.forceSpawn(id,p,getTile));
  assert.equal(ok,true, id+' debug force-spawns through the normal mob registry');
  const row=mobs.serialize().list.find(m=>m.id===id);
  assert.ok(row, id+' appears in serialized mob state');
  return {player:p,row};
}
function advance(seconds,p=globalThis.player){
  const steps=Math.ceil(seconds*20);
  for(let i=0;i<steps;i++){
    simNow += 50;
    mobs.update(0.05,p,getTile,setTile);
    wind.update(0.05,p,getTile);
    clouds.update(getTile,setTile,0.05);
  }
}
function findSerialized(id){
  return mobs.serialize().list.find(m=>m.id===id);
}

resetAll();
assert.ok(mobs.species.includes('ICE_SHAMAN'), 'ice shaman is exposed in debug mob species');
assert.ok(mobs.species.includes('FIRE_SHAMAN'), 'fire shaman is exposed in debug mob species');
assert.equal(mobs._debugSpecies().ICE_SHAMAN.neverAggro, true, 'ice shaman is explicitly non-hostile');
assert.equal(mobs._debugSpecies().FIRE_SHAMAN.neverAggro, true, 'fire shaman is explicitly non-hostile');

let ctx = spawnShaman('ICE_SHAMAN', -1300);
advance(9,ctx.player);
let wm = wind.metrics();
let cm = clouds.metrics();
assert.equal(wm.ritualGale.active, true, 'ice shaman ritual starts a ritual gale');
assert.equal(wm.ritualGale.dir, 1, 'left-side shaman pushes wind toward map center');
assert.ok(wm.ritualGale.amp >= wind.config.MAX_SPEED*3 - 0.01, 'ritual gale uses 3x the strongest normal wind');
assert.ok(wm.speed > wind.config.MAX_SPEED*2.5, `ritual gale produces insane wind speed (${wm.speed})`);
assert.equal(cm.storm.active, true, 'ice shaman starts a storm');
assert.equal(cm.storm.source, 'weather_shaman', 'storm is owner-scoped to the shaman ritual');
assert.ok(cm.storm.tLeft <= 60 && cm.storm.tLeft >= 35, `storm duration stays in the 40-60s band after elapsed time (${cm.storm.tLeft})`);
let ice = findSerialized('ICE_SHAMAN');
assert.ok(ice && ice.shamanWeatherActive===1, 'active ritual is serialized');
assert.equal(sandstorm.metrics().storm.active, false, 'ice shaman never calls a sandstorm (west mirror is the blizzard)');
assert.equal(mobs.damageAt(Math.floor(ice.x),Math.floor(ice.y),999,{source:'hero'}), true, 'hero can kill the ritual shaman');
assert.equal(wind.metrics().ritualGale.active, false, 'killing the shaman stops its ritual gale');
assert.equal(clouds.metrics().storm.active, false, 'killing the shaman stops its ritual storm');

resetAll();
ctx = spawnShaman('FIRE_SHAMAN', 1300);
advance(9,ctx.player);
wm = wind.metrics();
cm = clouds.metrics();
assert.equal(wm.ritualGale.active, true, 'fire shaman ritual starts a ritual gale');
assert.equal(wm.ritualGale.dir, -1, 'right-side shaman pushes wind toward map center');
assert.equal(cm.storm.active, true, 'fire shaman starts a storm');
assert.equal(cm.storm.source, 'weather_shaman', 'fire shaman storm is owner-scoped');
// The desert mirror of the ice shaman's blizzard: the ritual also whips up a
// full-intensity, owner-scoped sandstorm — and dies with the shaman.
let sm = sandstorm.metrics();
assert.equal(sm.storm.active, true, 'fire shaman ritual starts a great sandstorm');
assert.equal(sm.storm.source, 'weather_shaman', 'the sandstorm is owner-scoped to the ritual');
assert.ok(sm.storm.intensity>=0.99, 'the ritual sandstorm blows at full intensity');
let fire = findSerialized('FIRE_SHAMAN');
assert.equal(mobs.damageAt(Math.floor(fire.x),Math.floor(fire.y),999,{source:'hero'}), true, 'hero can kill the fire shaman');
assert.equal(sandstorm.metrics().storm.active, false, 'killing the fire shaman stops its sandstorm');

// The soot caller: a coal-pressed figure whose ritual raises a DRY black smog
// (the soft-drift soot gale) — no rain cloud, same owner-scoped teardown.
resetAll();
assert.ok(mobs.species.includes('SOOT_SHAMAN'), 'soot shaman is exposed in debug mob species');
assert.equal(mobs._debugSpecies().SOOT_SHAMAN.neverAggro, true, 'soot shaman is explicitly non-hostile');
ctx = spawnShaman('SOOT_SHAMAN', 1300);
advance(9,ctx.player);
wm = wind.metrics();
assert.equal(wm.ritualGale.active, true, 'soot shaman ritual starts a ritual gale');
assert.ok(!clouds.metrics().storm.active || clouds.metrics().storm.source !== 'weather_shaman',
  'the soot ritual is a dry smog — it raises no shaman-owned rain storm');
assert.equal(sandstorm.metrics().storm.active, false, 'the soot ritual calls no sandstorm either');
let dmMetrics = softDrifts.metrics();
assert.equal(dmMetrics.storm.forced, true, 'soot shaman ritual forces the smog drift gale');
let sootRow = findSerialized('SOOT_SHAMAN');
assert.ok(sootRow && sootRow.shamanWeatherActive===1, 'active smog ritual is serialized');
assert.equal(mobs.damageAt(Math.floor(sootRow.x),Math.floor(sootRow.y),999,{source:'hero'}), true, 'hero can kill the soot shaman');
assert.equal(softDrifts.metrics().storm.forced, false, 'killing the soot shaman stops its smog gale');
assert.equal(wind.metrics().ritualGale.active, false, 'killing the soot shaman stops its ritual gale');

resetAll();
ctx = spawnShaman('ICE_SHAMAN', -1300);
let hit = findSerialized('ICE_SHAMAN');
assert.equal(mobs.damageAt(Math.floor(hit.x),Math.floor(hit.y),1,{source:'hero'}), true, 'hero hit damages shaman without killing it');
hit = findSerialized('ICE_SHAMAN');
assert.equal(hit.state, 'flee', 'damaged shaman switches to flee state');
advance(6,ctx.player);
assert.equal(wind.metrics().ritualGale.active, false, 'fleeing shaman does not complete ritual while escaping');
assert.equal(clouds.metrics().storm.active, false, 'fleeing shaman does not start rain while escaping');

resetAll();
console.log('shaman weather simulation ok');
