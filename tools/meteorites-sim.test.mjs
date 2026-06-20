// Deterministic-ish Node test for the meteorite hazard.
// Verifies: debug toggle/scheduler, forced bolide flight, budgeted crater terrain
// edits, subsystem wakeups, persistence snapshot/restore and no-op cost when off.
// Run: node tools/meteorites-sim.test.mjs
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};
const store = new Map();
globalThis.localStorage = {
  getItem:k=>store.has(k)?store.get(k):null,
  setItem:(k,v)=>{ store.set(k,String(v)); },
  removeItem:k=>{ store.delete(k); }
};
globalThis.msg = ()=>{};

const { T } = await import('../src/constants.js');
const { meteorites } = await import('../src/engine/meteorites.js');

assert.ok(meteorites && meteorites.forceSpawn && meteorites.update, 'meteorites module exports');

const SURF = 82;
const tiles = new Map();
const kxy=(x,y)=>Math.floor(x)+','+Math.floor(y);
function getTile(x,y){
  x=Math.floor(x); y=Math.floor(y);
  const k=kxy(x,y);
  if(tiles.has(k)) return tiles.get(k);
  return y>=SURF ? T.STONE : T.AIR;
}
function setTile(x,y,t){ tiles.set(kxy(x,y),t); }
function dirOf(vx,vy){
  const len=Math.hypot(vx,vy) || 1;
  return {x:vx/len,y:vy/len};
}
function dotDir(a,b){ return a.x*b.x + a.y*b.y; }

let waterWake=0, removed=0, placed=0, marked=0, smoke=0, sparks=0, audio=0, hotGas=0;
globalThis.__mmMarkWorldChanged = ()=>{ marked++; };
globalThis.player = {x:0,y:SURF-1,w:0.7,h:0.95,vx:0,vy:0,hp:100,maxHp:100,hpInvul:0,facing:1};
MM.worldGen = { surfaceHeight:()=>SURF };
MM.water = { onTileChanged(){ waterWake++; } };
MM.fallingSolids = { onTileRemoved(){ removed++; }, afterPlacement(){ placed++; } };
MM.particles = {
  spawnSmoke(){ smoke++; },
  spawnSparks(){ sparks++; },
  spawnSplash(){ sparks++; }
};
MM.audio = { play(){ audio++; }, isReady:()=>true };
MM.gases = { add(kind){ if(kind==='hot') hotGas++; } };

meteorites.restore({enabled:false,nextIn:60,spawned:0,impacts:0});
const offBefore=meteorites.metrics();
meteorites.update(30,player,getTile,setTile);
assert.equal(meteorites.metrics().spawned, offBefore.spawned, 'disabled scheduler does not spawn meteors');

const spawned = meteorites.forceSpawn({x:0,y:SURF,intensity:1.65,side:-1}, player, getTile);
assert.ok(spawned, 'forced debug meteor spawns');
assert.equal(meteorites.metrics().meteors, 1, 'active meteor is tracked');

let sawUndergroundImpact=false;
let sawShake=false;
let lastAirDir=null;
let lastBurrowDir=null;
let checkedStraightEntry=false;
let checkedBurrowNoSteer=false;
for(let i=0;i<900;i++){
  meteorites.update(1/60, player, getTile, setTile);
  const active=meteorites._debug.meteors[0];
  if(active){
    const dir=dirOf(active.vx,active.vy);
    if(active.burrowing){
      if(lastAirDir && !checkedStraightEntry){
        assert.ok(dotDir(lastAirDir,dir)>0.995, 'meteor keeps its incoming direction after ground entry');
        checkedStraightEntry=true;
      }
      if(lastBurrowDir){
        assert.ok(dotDir(lastBurrowDir,dir)>0.9999, 'meteor does not steer while burrowing');
        checkedBurrowNoSteer=true;
      }
      lastBurrowDir=dir;
    } else {
      lastAirDir=dir;
    }
  }
  const m=meteorites.metrics();
  if(m.impacts>0){
    if(m.lastImpact && m.lastImpact.y>=SURF+4) sawUndergroundImpact=true;
    if(m.shake>0) sawShake=true;
  }
  if(m.meteors===0 && m.queuedOps===0 && m.terrainJobs===0) break;
}

const metricsAfter=meteorites.metrics();
assert.equal(metricsAfter.meteors, 0, 'meteor resolves after impact');
assert.equal(metricsAfter.terrainJobs, 0, 'budgeted crater job drains');
assert.ok(metricsAfter.impacts>=1, 'impact counter increments');
assert.ok(sawUndergroundImpact, 'meteor penetrates and explodes below the surface');
assert.ok(checkedStraightEntry, 'meteor direction is checked at ground entry');
assert.ok(checkedBurrowNoSteer, 'meteor direction stays fixed underground');
assert.equal(meteorites._debug.shockwaves.length, 0, 'meteor does not render planar shockwave rings');
assert.equal(meteorites._debug.scorches.length, 0, 'meteor does not render scorch-plane guide marks');
assert.ok(sawShake, 'impact starts screen shake');
assert.ok(marked>=1, 'impact marks the world dirty for save');
assert.ok(waterWake>0, 'terrain edits wake water');
assert.ok(removed>0, 'carved cells wake falling solids');
assert.ok(placed>0, 'rim/floor placements wake falling solids');
assert.ok(smoke>0, 'impact emits smoke');
assert.ok(sparks>0, 'impact emits sparks or splash');
assert.ok(audio>0, 'impact requests audio');
assert.ok(hotGas>0, 'impact injects hot air gas');

const changed=[...tiles.entries()].map(([key,t])=>({key,t,y:Number(key.split(',')[1])}));
assert.ok(changed.some(c=>c.y>=SURF && c.t===T.AIR), 'crater carves solid ground into air');
assert.ok(changed.some(c=>c.y>=SURF+5 && c.t===T.AIR), 'underground blast hollows out deeper ground');
assert.ok(changed.some(c=>c.t===T.LAVA || c.t===T.OBSIDIAN || c.t===T.GLASS), 'crater leaves a heated floor/rim');
assert.ok(changed.some(c=>c.t===T.IRIDIUM), 'meteorite leaves rare iridium deposits');

meteorites.restore({enabled:true,nextIn:12.5,spawned:3,impacts:4});
let restored=meteorites.metrics();
assert.equal(restored.enabled, true, 'restore keeps enabled state');
assert.equal(restored.nextIn, 12.5, 'restore keeps next meteor clock');
assert.equal(restored.spawned, 3, 'restore keeps spawned counter');
assert.equal(restored.impacts, 4, 'restore keeps impact counter');
const snap=meteorites.snapshot();
assert.equal(snap.enabled, true, 'snapshot exposes enabled state');
assert.equal(snap.nextIn, 12.5, 'snapshot exposes next clock');

meteorites.setEnabled(false);
restored=meteorites.metrics();
assert.equal(restored.enabled, false, 'debug toggle disables natural meteors');
const beforeSpawned=restored.spawned;
meteorites.update(999,player,getTile,setTile);
assert.equal(meteorites.metrics().spawned, beforeSpawned, 'disabled state remains no-op over long ticks');

console.log('meteorites-sim: all assertions passed');
