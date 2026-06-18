// Volcano activity test: gas, diamond offerings, and master-stone lava timeout.
// Run: node tools/volcano-activity-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis;
globalThis.MM = { TILE:20 };
globalThis.performance = { now:()=>0 };

const { T } = await import('../src/constants.js');
const { dynamo } = await import('../src/engine/dynamo.js');
assert.ok(dynamo, 'dynamo module exports for volcano impact tests');

const volcanoDef = {center:0, radius:10, crater:2, pipe:1, reservoir:4, cell:0};

let gasCalls=0, persistentGas=0, lavaNotes=0, bursts=0, smoke=0;
const audioPlays=[];
MM.weapons = { spawnGasCloud(){ gasCalls++; return 12; } };
MM.gases = { add(kind){ if(kind==='poison') persistentGas++; return 4; } };
MM.fire = { noteLava(){ lavaNotes++; } };
MM.particles = {
  spawnBurst(){ bursts++; },
  spawnSmoke(){ smoke++; }
};
MM.audio = { play(name){ audioPlays.push(name); } };
globalThis.msg = ()=>{};

const { volcano } = await import('../src/engine/volcano.js');
assert.ok(volcano, 'volcano module exports');
MM.worldGen = {
  surfaceHeight(){ return 7; },
  randSeed(n){ return Math.abs(Math.sin(n*12.9898))*0.999; },
  volcanoAt(x){ return Math.abs(x)<=10 ? volcanoDef : null; },
  nearestVolcano(){ return volcanoDef; }
};

function makeTiles(){
  const tiles=new Map();
  const k=(x,y)=>x+','+y;
  return {
    getTile(x,y){ return tiles.get(k(x,y)) ?? (y>=10 ? T.STONE : T.AIR); },
    setTile(x,y,t){ if(t===T.AIR) tiles.delete(k(x,y)); else tiles.set(k(x,y),t); },
    tiles
  };
}

volcano.reset();
volcano._debug.emitGas(volcanoDef);
assert.equal(gasCalls, 1, 'volcano emits through the shared green-gas system');
assert.equal(persistentGas, 1, 'volcano gas also enters the persistent world gas layer');

{
  volcano.reset();
  const w=makeTiles();
  w.setTile(0,7,T.DIAMOND);
  assert.ok(volcano.onTileChanged(0,7,T.DIAMOND,w.getTile,w.setTile), 'diamond in crater is accepted as an offering');
  assert.equal(w.getTile(0,7), T.AIR, 'diamond offering is consumed');
  assert.equal(volcano.metrics().masterShots, 1, 'diamond offering throws a master stone');
  assert.equal(audioPlays.at(-1), 'masterstone', 'master stone throw has a distinct sound cue');
}

{
  volcano.reset();
  const w=makeTiles();
  w.setTile(3,9,T.VOLCANO_MASTER_STONE);
  volcano.trackMasterStone(3,9,0);
  volcano.update(9.9,{x:0,y:6},w.getTile,w.setTile);
  assert.equal(w.getTile(3,9), T.VOLCANO_MASTER_STONE, 'master stone survives before ten seconds on floor');
  volcano.update(0.2,{x:0,y:6},w.getTile,w.setTile);
  assert.equal(w.getTile(3,9), T.LAVA, 'master stone turns into lava after ten seconds on floor');
  assert.equal(lavaNotes, 1, 'fresh lava is registered with the lava system');
}

{
  volcano.reset();
  assert.ok(volcano.forceMasterEruption(volcanoDef), 'debug eruption can throw a master stone directly');
  assert.equal(volcano.metrics().masterShots, 1, 'debug eruption produced one master shot');
  assert.equal(audioPlays.at(-1), 'masterstone', 'debug master stone throw also plays the sound cue');
}

{
  volcano.reset();
  let broadReads=0, peekReads=0;
  const w=makeTiles();
  MM.worldGen = {
    surfaceHeight(){ return 7; },
    randSeed(n){ return Math.abs(Math.sin(n*12.9898))*0.999; },
    volcanoAt(){ return null; },
    nearestVolcano(){ return null; }
  };
  MM.world = { peekTile(x,y,fb){ peekReads++; return fb; } };
  const broadGet=(x,y)=>{ broadReads++; return w.getTile(x,y); };
  volcano.update(0.1,{x:0,y:6},broadGet,w.setTile);
  assert.equal(broadReads, 0, 'master stone maintenance scan uses peekTile instead of broad getTile probes');
  assert.ok(peekReads>0, 'master stone maintenance scan touched the non-generating tile reader');
  delete MM.world;
}

{
  volcano.reset();
  const w=makeTiles();
  w.setTile(0,5,T.POISON_GAS);
  volcano._debug.rocks.push({x:0.5,y:5.2,vx:0,vy:0,life:1,rot:0,spin:0});
  volcano.update(0.03,{x:2000,y:6},w.getTile,w.setTile);
  assert.equal(volcano.metrics().rocks,1,'volcano rocks pass through gas instead of colliding with it');
}

{
  volcano.reset();
  const w=makeTiles();
  w.setTile(-1,5,T.DYNAMO);
  w.setTile(0,5,T.DYNAMO_SLOT);
  w.setTile(1,5,T.DYNAMO);
  const oldRandom=Math.random;
  try{
    Math.random=()=>0.19;
    volcano._debug.rocks.push({x:0.5,y:5.2,vx:0,vy:0,life:1,rot:0,spin:0});
    volcano.update(0.03,{x:2000,y:6},w.getTile,w.setTile);
    assert.equal(w.getTile(-1,5), T.AIR, 'volcano rock can destroy the left dynamo casing');
    assert.equal(w.getTile(0,5), T.AIR, 'volcano rock can destroy the dynamo slot');
    assert.equal(w.getTile(1,5), T.AIR, 'volcano rock can destroy the right dynamo casing');
  } finally {
    Math.random=oldRandom;
  }
}

{
  volcano.reset();
  const w=makeTiles();
  w.setTile(-1,5,T.DYNAMO);
  w.setTile(0,5,T.DYNAMO_SLOT);
  w.setTile(1,5,T.DYNAMO);
  const oldRandom=Math.random;
  try{
    Math.random=()=>0.21;
    volcano._debug.rocks.push({x:0.5,y:5.2,vx:0,vy:0,life:1,rot:0,spin:0});
    volcano.update(0.03,{x:2000,y:6},w.getTile,w.setTile);
    assert.equal(w.getTile(-1,5), T.DYNAMO, '80% of volcano rock hits leave the left casing intact');
    assert.equal(w.getTile(0,5), T.DYNAMO_SLOT, '80% of volcano rock hits leave the slot intact');
    assert.equal(w.getTile(1,5), T.DYNAMO, '80% of volcano rock hits leave the right casing intact');
  } finally {
    Math.random=oldRandom;
  }
}

{
  volcano.reset();
  const w=makeTiles();
  w.setTile(2,8,T.POISON_GAS);
  w.setTile(2,9,T.STONE);
  volcano._debug.masterShots.push({x:2.5,y:8.1,vx:0,vy:0,life:0.01,rot:0,spin:0});
  volcano.update(0.02,{x:2000,y:6},w.getTile,w.setTile);
  assert.equal(w.getTile(2,8), T.VOLCANO_MASTER_STONE, 'master stone can settle into a gas-filled open cell');
}

assert.ok(bursts>0, 'master stone activity creates visible bursts');
assert.ok(smoke>0, 'master stone activity creates smoke');

console.log('volcano-activity-sim: all assertions passed');
