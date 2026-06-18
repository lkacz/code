// Aquatic habitat regression: fish must not remain alive below terrain when a
// small basin drains or recedes.
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.CustomEvent = class { constructor(type,opts){ this.type=type; this.detail=opts&&opts.detail; } };
globalThis.dispatchEvent = () => true;
let simNow = 0;
globalThis.performance = { now:()=>simNow };

const { T } = await import('../src/constants.js');
const { mobs } = await import('../src/engine/mobs.js');

mobs.clearAll();
const FISH = mobs._debugSpecies().FISH;

function tinyWaterTile(x,y){
  if(x===0 && y===10) return T.WATER;
  if(y>=11) return T.STONE;
  return T.AIR;
}
function shallowPuddleTile(x,y){
  if(y===10 && x>=0 && x<=4) return T.WATER;
  if(y>=11) return T.STONE;
  return T.AIR;
}
assert.equal(FISH.spawnTest(0,10,tinyWaterTile), false, 'fish do not spawn in a single water block');
assert.equal(FISH.spawnTest(2,10,shallowPuddleTile), false, 'fish do not spawn in a one-tile-deep puddle');

const water = new Set();
for(let x=0; x<=4; x++){
  for(let y=10; y<=12; y++) water.add(x+','+y);
}

function getTile(x,y){
  if(water.has(x+','+y)) return T.WATER;
  if(y>=13) return T.STONE;
  return T.AIR;
}

const player={x:2.5,y:10.5,hp:100,maxHp:100,vx:0,vy:0};
globalThis.player=player;

const realRandom=Math.random;
let randomSeq=[];
Math.random=()=> randomSeq.length ? randomSeq.shift() : 0.42;
try{
  assert.equal(FISH.spawnTest(2,11,getTile), true, 'fish can spawn in a connected basin with real volume');
  randomSeq=[0.5,0.75]; // force the initial spawn near the basin bottom (y=12)
  assert.equal(mobs.forceSpawn('FISH',player,getTile), true, 'fish can spawn in the artificial basin');
  const spawnedFish=mobs.serialize().list.filter(m=>m.id==='FISH');
  assert.equal(spawnedFish.length, 1, 'spawned exactly one fish');
  assert.equal(spawnedFish[0].waterTopY, 10, 'new fish anchors to the actual water surface on spawn');

  water.clear();
  for(let i=0; i<60; i++){
    simNow += 50;
    mobs.update(0.05,player,getTile);
  }
  const liveFish=mobs.serialize().list.filter(m=>m.id==='FISH');
  assert.equal(liveFish.length, 0, 'fish despawns cleanly after its basin drains');

  mobs.clearAll();
  simNow = 0;
  water.clear();
  for(let x=0; x<=4; x++) water.add(x+',10');
  mobs.deserialize({
    v:3,
    list:[{id:'FISH',x:2.5,y:12.5,hp:4,waterTopY:10,desiredDepth:2}],
    aggro:{mode:'rel',m:{}}
  });
  for(let i=0; i<30; i++){
    simNow += 50;
    mobs.update(0.05,player,getTile);
  }
  const recoveredFish=mobs.serialize().list.filter(m=>m.id==='FISH');
  assert.equal(recoveredFish.length, 1, 'fish survives by returning to the shallower remaining water');
  assert.ok(recoveredFish[0].y < 11.1, 'fish is clamped back into the remaining waterline');
} finally {
  Math.random=realRandom;
  mobs.clearAll();
}

console.log('fish-water-sim: all assertions passed');
