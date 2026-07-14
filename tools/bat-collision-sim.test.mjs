// Deterministic regression for bat movement through terrain.
// Verifies BAT can fly through open air but cannot phase through solid tiles.
// Run: node tools/bat-collision-sim.test.mjs
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {
  background:{ getCycleInfo(){ return {isDay:false}; } }
};
globalThis.localStorage = {
  getItem(){ return null; },
  setItem(){},
  removeItem(){}
};

const originalRandom = Math.random;
Math.random = ()=>0.99;

const { T, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } = await import('../src/constants.js');
const { mobs } = await import('../src/engine/mobs.js');

const key = (x,y)=>x+','+y;
const tiles = new Map();
function setTile(x,y,t){
  const k=key(x,y);
  if(t===T.AIR) tiles.delete(k);
  else tiles.set(k,t);
}
function getTile(x,y){
  return tiles.get(key(x,y)) ?? T.AIR;
}
function reset(){
  tiles.clear();
  mobs.clearAll();
  mobs.freezeSpawns(10000);
  delete MM.wind;
  // Close enough that passive off-screen sleep does not skip the physics tick,
  // but outside the bat's outmatched-flee perception radius.
  globalThis.player = {x:-30,y:10,vx:0,vy:0,hp:100,maxHp:100};
}
function spawnBat(x,y,vx,vy){
  mobs.deserialize({
    v:3,
    list:[{id:'BAT',x,y,vx,vy,hp:6,state:'idle',facing:vx>=0?1:-1,scale:1,speedMul:1,jumpMul:1}],
    aggro:{mode:'rel',m:{}}
  });
  mobs.freezeSpawns(10000);
}
function spawnVulture(x,y,vx,vy){
  mobs.deserialize({
    v:5,
    list:[{id:'VULTURE',x,y,vx,vy,hp:24,state:'dive',facing:vx>=0?1:-1,scale:1,speedMul:1,jumpMul:1,nestX:12,nestY:12}],
    aggro:{mode:'rel',m:{}}
  });
  mobs.freezeSpawns(10000);
}
function bat(){
  return mobs.serialize().list.find(m=>m.id==='BAT');
}
function step(dt=1/6){
  mobs.update(dt, player, getTile);
}

reset();
spawnBat(3,10,6,0);
step();
let b = bat();
// A fresh hero already outclasses this tiny bat, so its non-aggressive flight
// uses the normal species speed cap instead of the old hostile 1.4x cap.
assert.ok(b.x > 3.5, 'outmatched bat still travels through open air');
assert.ok(Math.abs(b.vy) < 0.02, 'open-air horizontal flight only keeps the normal tiny bat bob');

reset();
for(let y=8; y<=12; y++) setTile(5,y,T.STONE);
spawnBat(4,10,6,0);
step(1/3);
b = bat();
assert.ok(b.x < 4.66, 'bat stops before a stone wall');
assert.equal(b.vx, 0, 'bat horizontal velocity is cancelled by a stone wall');
assert.notEqual(Math.floor(b.x), 5, 'bat center never enters the stone wall column');

reset();
for(let y=8; y<=12; y++) setTile(5,y,T.STONE);
spawnBat(4,10,24,0);
step(1.5);
b = bat();
assert.ok(b.x < 4.66, 'bat cannot tunnel across a wall during a long frame');
assert.equal(b.vx, 0, 'bat long-frame wall collision cancels horizontal velocity');

reset();
for(let x=1; x<=6; x++) setTile(x,8,T.STONE);
spawnBat(3,9.4,0,-8);
step(1/3);
b = bat();
assert.ok(b.y > 9.22, 'bat stops below a stone ceiling');
assert.equal(b.vy, 0, 'bat vertical velocity is cancelled by a stone ceiling');
assert.notEqual(Math.floor(b.y), 8, 'bat center never enters the stone ceiling row');

reset();
MM.wind = { speedAt(){ return 5; } };
spawnBat(3,10,0,0);
step(1/3);
b = bat();
assert.ok(b.x > 3.15, 'strong exposed wind carries a bat sideways');
assert.ok(b.vx > 0.35, 'bat keeps wind-driven velocity after the gust');

reset();
MM.wind = { speedAt(){ return 5; } };
for(let y=8; y<=12; y++) setTile(5,y,T.STONE);
spawnBat(4,10,0,0);
step(1.5);
b = bat();
assert.ok(b.x < 4.66, 'wind cannot push a bat through a stone wall');
assert.equal(b.vx, 0, 'bat wind velocity is cancelled by wall collision');
delete MM.wind;

reset();
for(let y=8; y<=12; y++) setTile(5,y,T.STONE);
spawnVulture(4,10,7,0);
globalThis.player={x:20,y:10,vx:0,vy:0,hp:100,maxHp:100};
step();
const vulture=mobs.serialize().list.find(m=>m.id==='VULTURE');
assert.ok(vulture.x<4.28, 'vulture uses its full body collider and stops before a stone wall');
assert.equal(vulture.vx, 0, 'vulture dive velocity is cancelled by solid terrain');

reset();
mobs.deserialize({
  v:5,
  list:[
    {id:'BIRD',x:3,y:10,vx:0,vy:0,hp:6,state:'idle',facing:1,scale:1,speedMul:1,jumpMul:1},
    {id:'OWL',x:3,y:10,vx:0,vy:0,hp:8,state:'idle',facing:-1,scale:1,speedMul:1,jumpMul:1}
  ],
  aggro:{mode:'rel',m:{}}
});
mobs.freezeSpawns(10000);
step(1/30);
const separated=mobs.serialize().list.filter(m=>m.id==='BIRD'||m.id==='OWL');
assert.equal(separated.length, 2, 'different flying species remain active after body collision resolution');
assert.ok(Math.abs(separated[0].x-separated[1].x)>=0.99 || Math.abs(separated[0].y-separated[1].y)>=0.99, 'different mob species physically separate instead of sharing one space');
assert.equal(mobs.diagnose(getTile).overlaps, 0, 'mob collision audit reports no remaining body overlap');

reset();
mobs.deserialize({
  v:5,
  list:['BIRD','OWL','VULTURE_HATCHLING','FIREFLY'].map((id,index)=>({id,x:3,y:10,vx:0,vy:0,hp:999,state:'idle',facing:index%2?1:-1,scale:1,speedMul:1,jumpMul:1})),
  aggro:{mode:'rel',m:{}}
});
mobs.freezeSpawns(10000);
globalThis.player={x:10,y:10,vx:0,vy:0,hp:100,maxHp:100};
step(1/30);
assert.equal(mobs.diagnose(getTile).overlaps, 0, 'a dense mixed-species spawn batch is relaxed into non-overlapping body space in one tick');

reset();
const skyY = Math.max(WORLD_MIN_Y + 25, -40);
spawnBat(2,skyY,0,0);
assert.equal(mobs.damageAt(2,Math.floor(skyY),99,{source:'test'}), true, 'sky-layer bat can be killed through the normal damage API');
let fx = mobs._debugDeathFx(getTile);
assert.equal(fx.length, 1, 'sky-layer mob death creates one death effect');
assert.ok(fx[0].sourceY < 0, 'sky-layer death effect keeps its negative world y');
assert.equal(fx[0].badFinite, 0, 'sky-layer death effect pieces stay finite');
assert.equal(fx[0].solidPieces, 0, 'sky-layer death effect does not treat negative y as a world wall');

reset();
const deepY = Math.min(WORLD_MAX_Y - 25, WORLD_H + 20);
spawnBat(2,deepY,0,0);
assert.equal(mobs.damageAt(2,Math.floor(deepY),99,{source:'test'}), true, 'deep-layer bat can be killed through the normal damage API');
fx = mobs._debugDeathFx(getTile);
assert.equal(fx.length, 1, 'deep-layer mob death creates one death effect');
assert.ok(fx[0].sourceY > WORLD_H, 'deep-layer death effect keeps its extended world y');
assert.equal(fx[0].badFinite, 0, 'deep-layer death effect pieces stay finite');
assert.equal(fx[0].solidPieces, 0, 'deep-layer death effect does not treat legacy WORLD_H as a floor');

Math.random = originalRandom;
console.log('bat-collision-sim: all assertions passed');
