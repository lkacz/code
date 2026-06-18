// Volcano lava pressure test.
// Verifies that a mined same-level tunnel beside a volcano pipe is flooded quickly,
// while ordinary lava remains viscous and does not crawl along a floored tunnel.
// Run: node tools/volcano-lava-leak-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis;
globalThis.MM = {};

const { T } = await import('../src/constants.js');
const { fire } = await import('../src/engine/fire.js');
assert.ok(fire, 'fire module exports');

let tiles;
const key=(x,y)=>x+','+y;
const getTile=(x,y)=>tiles.get(key(x,y)) ?? T.STONE;
const setTile=(x,y,t)=>tiles.set(key(x,y),t);
function airTunnel(x0,x1,y){ for(let x=x0; x<=x1; x++) setTile(x,y,T.AIR); }
function lavaPipe(x,y0,y1,registered=true){ for(let y=y0; y<=y1; y++){ setTile(x,y,T.LAVA); if(registered) fire.noteLava(x,y); } }
function saturateLavaRegistry(){
  for(let i=0; i<900; i++){
    setTile(1000+i,10,T.LAVA);
    fire.noteLava(1000+i,10);
  }
}
function step(seconds){
  const dt=1/30;
  for(let i=0; i<seconds*30; i++) fire.update(getTile,setTile,dt);
}
function tunnelLavaCount(x0,x1,y){
  let n=0;
  for(let x=x0; x<=x1; x++) if(getTile(x,y)===T.LAVA) n++;
  return n;
}
function verticalLavaCount(x,y0,y1){
  let n=0;
  for(let y=y0; y<=y1; y++) if(getTile(x,y)===T.LAVA) n++;
  return n;
}

const realRandom=Math.random;
Math.random=()=>0.5;
try{
  MM.fallingSolids={ onTileRemoved(){} };
  MM.worldGen={
    volcanoAt(x){ return Math.abs(x)<=32 ? {center:0,radius:32,pipe:2,crater:2} : null; },
    surfaceHeight(){ return 0; }
  };
  tiles=new Map(); fire.reset();
  airTunnel(1,9,10);
  lavaPipe(0,4,10);
  const woke=fire.wakeLavaAround(1,10,getTile,{radius:12});
  assert.ok(woke>=1, 'mined tunnel wakes nearby volcano lava');
  fire.update(getTile,setTile,1/30);
  assert.ok(tunnelLavaCount(1,9,10)<=2, 'pressurized volcano lava does not fill a tunnel in a single update tick');
  step(0.75);
  assert.equal(tunnelLavaCount(1,6,10), 0, 'volcano lava waits before flowing, instead of behaving like water');
  step(0.65);
  assert.ok(tunnelLavaCount(1,6,10)>=1 && tunnelLavaCount(1,6,10)<=2, 'volcano pressure starts as a slow molten leak');
  step(3.6);
  assert.ok(tunnelLavaCount(1,6,10)>=4 && tunnelLavaCount(1,6,10)<=5, 'volcano pressure keeps pushing, but only over several seconds');
  assert.equal(getTile(0,10), T.LAVA, 'the volcano pipe remains a magma source while leaking');

  tiles=new Map(); fire.reset();
  for(let y=5; y<=13; y++) setTile(0,y,T.AIR);
  setTile(0,4,T.LAVA);
  for(let i=0; i<30; i++) fire.noteLava(0,4,{fast:true,pressure:1});
  step(0.50);
  assert.equal(verticalLavaCount(0,5,13), 0, 'repeated fast wake calls do not turn volcano lava into water-speed lava');
  fire.noteLava(0,4,{fast:true,pressure:1});
  step(0.25);
  assert.equal(verticalLavaCount(0,5,13), 0, 'fresh volcano lava does not drop down an open shaft immediately');
  step(1.8);
  assert.ok(verticalLavaCount(0,5,13)>=1 && verticalLavaCount(0,5,13)<=3, 'volcano lava falls as slow blobs, not a water column');

  tiles=new Map(); fire.reset();
  saturateLavaRegistry();
  airTunnel(1,9,10);
  lavaPipe(0,4,10,false);
  step(1.0);
  assert.equal(tunnelLavaCount(1,6,10), 0, 'a sleeping saved conduit does not move before the local breach scan');
  const scanned=fire.wakeVolcanoLeaksNear(4.5,10,getTile,{rx:12,ry:8});
  assert.ok(scanned>=1, 'local volcano breach scan wakes unregistered conduit lava even when the lava registry is full');
  step(0.75);
  assert.equal(tunnelLavaCount(1,6,10), 0, 'a sleeping conduit does not wake into an immediate flood');
  step(0.65);
  assert.ok(tunnelLavaCount(1,6,10)>=1 && tunnelLavaCount(1,6,10)<=2, 'a sleeping conduit wakes into a slow lava leak');
  step(3.6);
  assert.ok(tunnelLavaCount(1,6,10)>=4 && tunnelLavaCount(1,6,10)<=5, 'a previously opened tunnel beside a sleeping volcano conduit fills slowly over time');

  tiles=new Map(); fire.reset();
  airTunnel(1,9,10);
  lavaPipe(0,4,10,false);
  let broadReads=0, peekReads=0;
  const broadGet=(x,y)=>{ broadReads++; return getTile(x,y); };
  const peekTile=(x,y,fb)=>{ peekReads++; return Math.abs(x)<=2 ? getTile(x,y) : fb; };
  const peekScanned=fire.wakeVolcanoLeaksNear(4.5,10,broadGet,{rx:12,ry:8,peekTile});
  assert.ok(peekScanned>=1, 'volcano leak scan still wakes loaded conduit lava through peekTile');
  assert.equal(broadReads, 0, 'volcano leak scan uses peekTile instead of broad getTile probes');
  assert.ok(peekReads>0, 'volcano leak scan used the non-generating tile reader');

  MM.worldGen={
    volcanoAt(x){ return Math.abs(x)<=32 ? {center:0,radius:32,pipe:2,crater:2} : null; },
    surfaceHeight(){ return 20; }
  };
  tiles=new Map(); fire.reset();
  airTunnel(1,9,10);
  lavaPipe(0,4,10,false);
  assert.equal(fire.wakeVolcanoLeaksNear(4.5,10,getTile,{rx:12,ry:8}), 0, 'volcano leak scan stays asleep while the hero is above the volcanic surface');

  MM.worldGen={
    volcanoAt(x){ return Math.abs(x)<=32 ? {center:0,radius:32,pipe:2,crater:2} : null; },
    surfaceHeight(){ return 10; }
  };
  tiles=new Map(); fire.reset();
  for(let x=0; x<=12; x++) setTile(x,9,T.AIR);
  for(let x=1; x<=12; x++) setTile(x,10,T.AIR);
  lavaPipe(0,10,10,false);
  fire.noteLava(0,10,{fast:true,pressure:1});
  step(2.0);
  assert.equal(tunnelLavaCount(1,12,10), 0, 'sky-exposed crater lava does not sheet sideways across a flat shelf');

  MM.worldGen={ volcanoAt(){ return null; }, surfaceHeight(){ return 0; } };
  tiles=new Map(); fire.reset();
  airTunnel(1,9,10);
  setTile(0,10,T.LAVA);
  fire.noteLava(0,10);
  step(1.0);
  assert.equal(tunnelLavaCount(1,6,10), 0, 'ordinary lava does not race along a floored tunnel');
} finally {
  Math.random=realRandom;
  fire.reset();
}

console.log('volcano-lava-leak-sim: all assertions passed');
