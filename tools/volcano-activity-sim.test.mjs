// Volcano activity test: gas, diamond offerings, and master/servant-stone timeout.
// Run: node tools/volcano-activity-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis;
globalThis.MM = { TILE:20 };
globalThis.performance = { now:()=>0 };

const { T } = await import('../src/constants.js');
const { dynamo } = await import('../src/engine/dynamo.js');
assert.ok(dynamo, 'dynamo module exports for volcano impact tests');

const volcanoDef = {center:0, radius:10, crater:2, pipe:1, reservoir:4, cell:0};

let gasCalls=0, persistentGas=0, lavaNotes=0, bursts=0, smoke=0, explosions=0, lastExplosionOpts=null;
const audioPlays=[];
MM.weapons = {
  spawnGasCloud(){ gasCalls++; return 12; },
  explodeAt(wx,wy,getTile,setTile,opts){ explosions++; lastExplosionOpts=opts||{}; return true; }
};
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
  assert.equal(w.getTile(3,9), T.SERVANT_STONE, 'master stone turns into a servant stone after ten seconds on floor');
  assert.equal(lavaNotes, 0, 'master stone no longer turns into lava at the first timeout');
  volcano.update(9.8,{x:0,y:6},w.getTile,w.setTile);
  assert.equal(w.getTile(3,9), T.SERVANT_STONE, 'servant stone warns before exploding');
  volcano.update(0.3,{x:0,y:6},w.getTile,w.setTile);
  assert.equal(w.getTile(3,9), T.AIR, 'servant stone removes itself when it explodes');
  assert.equal(explosions, 1, 'servant stone triggers a mid-size explosion');
  assert.equal(lastExplosionOpts.force, true, 'servant stone explosion bypasses blast cooldown');
  assert.ok(lastExplosionOpts.extraConsumed>=18, 'servant stone explosion is stronger than a tiny gas pop');
  assert.equal(lastExplosionOpts.source, 'volcano', 'servant stone damage is not misattributed to the hero');
  assert.equal(lastExplosionOpts.cause, 'servant_stone_blast', 'servant stone keeps a distinct explosion cause');
}

{
  volcano.reset();
  const w=makeTiles();
  w.setTile(3,9,T.SERVANT_STONE);
  const oldApis={weapons:MM.weapons,mobs:MM.mobs,invasions:MM.invasions,mechs:MM.mechs};
  const collateral=[];
  MM.weapons=null;
  MM.mobs={blastRadius(x,y,r,dmg,opts){ collateral.push({family:'mobs',x,y,r,dmg,opts}); return 1; }};
  MM.invasions={blastRadius(x,y,r,dmg,opts){ collateral.push({family:'invasions',x,y,r,dmg,opts}); return 2; }};
  MM.mechs={blastRadius(x,y,r,dmg,opts){ collateral.push({family:'mechs',x,y,r,dmg,opts}); return 1; }};
  try{
    assert.equal(volcano._debug.explodeServantStone({x:3,y:9},w.getTile,w.setTile),true,'servant stone fallback still detonates without the weapon engine');
    assert.deepEqual(collateral.map(c=>c.family),['mobs','invasions','mechs'],'fallback servant blast reaches every creature family');
    assert.ok(collateral.every(c=>c.opts.source==='volcano' && c.opts.cause==='servant_stone_blast' && c.opts.kind==='explosion'),'fallback servant blast keeps normalized environmental metadata');
  } finally {
    MM.weapons=oldApis.weapons; MM.mobs=oldApis.mobs; MM.invasions=oldApis.invasions; MM.mechs=oldApis.mechs;
  }
}

{
  volcano.reset();
  const w=makeTiles();
  w.setTile(2,8,T.VOLCANO_MASTER_STONE);
  w.setTile(2,9,T.CHEST_COMMON);
  volcano.trackMasterStone(2,8,0);
  volcano.update(20,{x:0,y:6},w.getTile,w.setTile);
  assert.equal(w.getTile(2,8), T.VOLCANO_MASTER_STONE, 'master stone does not treat a chest as stable footing');
  w.setTile(2,9,T.STONE);
  volcano.update(10.1,{x:0,y:6},w.getTile,w.setTile);
  assert.equal(w.getTile(2,8), T.SERVANT_STONE, 'master stone resumes its floor timer on real footing');
}

{
  volcano.reset();
  assert.ok(volcano.forceMasterEruption(volcanoDef), 'debug eruption can throw a master stone directly');
  assert.equal(volcano.metrics().masterShots, 1, 'debug eruption produced one master shot');
  assert.equal(audioPlays.at(-1), 'masterstone', 'debug master stone throw also plays the sound cue');
  const shot=volcano._debug.masterShots.at(-1);
  assert.ok(Math.abs(shot.vx)>=15 && Math.abs(shot.vx)<=24.5, 'master stone horizontal ejection force is tripled');
  assert.ok(shot.vy<=-37.5 && shot.vy>=-49.5, 'master stone vertical ejection force is tripled');
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
  w.setTile(0,5,T.WATER_PIPE);
  volcano._debug.rocks.push({x:0.5,y:5.2,vx:0,vy:0,life:1,rot:0,spin:0});
  volcano.update(0.03,{x:2000,y:6},w.getTile,w.setTile);
  assert.equal(volcano.metrics().rocks,1,'volcano rocks pass through passable pipes instead of treating them as walls');
  assert.equal(w.getTile(0,5), T.WATER_PIPE, 'passable pipe is not consumed by a fly-through rock');
}

{
  volcano.reset();
  const w=makeTiles();
  w.setTile(2,8,T.WIRE);
  w.setTile(2,9,T.STONE);
  volcano._debug.masterShots.push({x:2.5,y:8.1,vx:0,vy:0,life:0.01,rot:0,spin:0});
  volcano.update(0.02,{x:2000,y:6},w.getTile,w.setTile);
  assert.equal(w.getTile(2,8), T.WIRE, 'master stone settlement does not overwrite passable wiring');
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

{
  volcano.reset();
  const w=makeTiles();
  w.setTile(4,9,T.VOLCANO_MASTER_STONE);
  volcano.trackMasterStone(4,9,8.8,'master');
  volcano._debug.masterShots.push({x:1.5,y:4.2,vx:6,vy:-18,life:5,rot:0.1,spin:0.2,reason:'test'});
  volcano._debug.rocks.push({x:-1.5,y:4.2,vx:-3,vy:4,life:4,rot:0.3,spin:-0.2});
  const snap=volcano.snapshot();
  volcano.reset();
  volcano.restore(snap,w.getTile);
  assert.equal(volcano.metrics().masterTiles, 1, 'save/load restores tracked master stone floor timers');
  assert.equal(volcano.metrics().masterShots, 1, 'save/load restores in-flight master stone shots');
  assert.equal(volcano.metrics().rocks, 1, 'save/load restores in-flight volcano rocks');
  volcano.update(1.3,{x:2000,y:6},w.getTile,w.setTile);
  assert.equal(w.getTile(4,9), T.SERVANT_STONE, 'restored master stone continues from its saved timer');

  w.setTile(5,9,T.SERVANT_STONE);
  volcano.trackMasterStone(5,9,9.0,'servant');
  const beforeExplosions=explosions;
  const servantSnap=volcano.snapshot();
  volcano.reset();
  volcano.restore(servantSnap,w.getTile);
  volcano.update(1.1,{x:2000,y:6},w.getTile,w.setTile);
  assert.equal(w.getTile(5,9), T.AIR, 'restored servant stone keeps its countdown and explodes');
  assert.equal(explosions, beforeExplosions+1, 'restored servant stone triggers its explosion once');
}

assert.ok(bursts>0, 'master stone activity creates visible bursts');
assert.ok(smoke>0, 'master stone activity creates smoke');

console.log('volcano-activity-sim: all assertions passed');
