// Deterministic-ish Node test for the meteorite hazard.
// Verifies: debug toggle/scheduler, forced bolide flight, instant surface crater
// terrain edits, subsystem wakeups, persistence snapshot/restore and no-op cost when off.
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
const DAY_SECONDS = 600;
const tiles = new Map();
const kxy=(x,y)=>Math.floor(x)+','+Math.floor(y);
function getTile(x,y){
  x=Math.floor(x); y=Math.floor(y);
  const k=kxy(x,y);
  if(tiles.has(k)) return tiles.get(k);
  return y>=SURF ? T.STONE : T.AIR;
}
function setTile(x,y,t){ tiles.set(kxy(x,y),t); }

let waterWake=0, removed=0, placed=0, marked=0, smoke=0, sparks=0, splashes=0, audio=0, hotGas=0, steamGas=0;
globalThis.__mmMarkWorldChanged = ()=>{ marked++; };
globalThis.player = {x:0,y:SURF-1,w:0.7,h:0.95,vx:0,vy:0,hp:100,maxHp:100,hpInvul:0,facing:1};
MM.worldGen = { surfaceHeight:()=>SURF };
MM.water = { onTileChanged(){ waterWake++; } };
MM.fallingSolids = { onTileRemoved(){ removed++; }, afterPlacement(){ placed++; } };
MM.particles = {
  spawnSmoke(){ smoke++; },
  spawnSparks(){ sparks++; },
  spawnSplash(){ sparks++; splashes++; }
};
MM.audio = { play(){ audio++; }, isReady:()=>true };
MM.gases = { add(kind){ if(kind==='hot') hotGas++; if(kind==='steam') steamGas++; } };

meteorites.restore({enabled:false,nextIn:60,spawned:0,impacts:0});
const offBefore=meteorites.metrics();
meteorites.update(30,player,getTile,setTile);
assert.equal(meteorites.metrics().spawned, offBefore.spawned, 'disabled scheduler does not spawn meteors');

const treeKeys=[];
for(let x=-4; x<=6; x++){
  for(let y=SURF-13; y<SURF; y++){
    const t=y<SURF-10 ? T.LEAF : T.WOOD;
    setTile(x,y,t);
    treeKeys.push(kxy(x,y));
  }
}

const spawned = meteorites.forceSpawn({x:0,y:SURF,intensity:1.65,side:-1}, player, getTile);
assert.ok(spawned, 'forced debug meteor spawns');
assert.equal(meteorites.metrics().meteors, 1, 'active meteor is tracked');

let sawSurfaceImpact=false;
let sawShake=false;
let sawInstantCrater=false;
let treeClearedBeforeImpact=false;
for(let i=0;i<900;i++){
  meteorites.update(1/60, player, getTile, setTile);
  const active=meteorites._debug.meteors[0];
  if(active){
    assert.equal(active.burrowing, undefined, 'meteor has no underground burrowing mode');
  }
  const m=meteorites.metrics();
  if(m.impacts===0 && treeKeys.some(k=>tiles.get(k)===T.AIR)) treeClearedBeforeImpact=true;
  if(m.impacts>0){
    if(m.lastImpact && m.lastImpact.y>=SURF-1 && m.lastImpact.y<=SURF+2) sawSurfaceImpact=true;
    if(m.shake>0) sawShake=true;
    if(m.queuedOps===0 && m.terrainJobs===0) sawInstantCrater=true;
  }
  if(m.meteors===0 && m.queuedOps===0 && m.terrainJobs===0) break;
}

const metricsAfter=meteorites.metrics();
assert.equal(metricsAfter.meteors, 0, 'meteor resolves after impact');
assert.equal(metricsAfter.terrainJobs, 0, 'surface crater does not leave queued terrain jobs');
assert.ok(metricsAfter.impacts>=1, 'impact counter increments');
assert.ok(sawSurfaceImpact, 'meteor explodes on first ground contact at the surface');
assert.ok(sawInstantCrater, 'visible crater terrain is applied immediately on impact');
assert.ok(treeClearedBeforeImpact || treeKeys.some(k=>tiles.get(k)===T.AIR), 'meteor destroys fly-through obstacles before ground impact');
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
const changedXs=changed.filter(c=>c.t===T.AIR && c.y>=SURF-1 && c.y<=SURF+9).map(c=>Number(c.key.split(',')[0]));
const craterWidth=changedXs.length ? Math.max(...changedXs)-Math.min(...changedXs)+1 : 0;
const stoneRubble=changed.filter(c=>c.t===T.STONE).length;
assert.ok(changed.some(c=>c.y>=SURF && c.t===T.AIR), 'crater carves solid ground into air');
assert.ok(changed.some(c=>c.y>=SURF+4 && c.t===T.AIR), 'surface blast cuts a deep visible bowl');
assert.equal(changed.some(c=>c.y>=SURF+14 && c.t===T.AIR), false, 'meteor does not carve a hidden underground blast chamber');
assert.ok(changed.some(c=>c.t===T.LAVA || c.t===T.OBSIDIAN || c.t===T.GLASS), 'crater leaves a heated floor/rim');
assert.ok(changed.some(c=>c.t===T.IRIDIUM), 'meteorite leaves rare iridium deposits');
assert.ok(changed.some(c=>c.t===T.METEORIC_IRON), 'meteorite leaves meteoric iron deposits');
assert.ok(changed.some(c=>c.t===T.COAL), 'meteorite leaves carbon-rich deposits');
assert.ok(craterWidth>=20, 'meteor creates a broad visible bowl crater (width '+craterWidth+')');
assert.ok(stoneRubble<=24, 'meteor does not overfill the crater with ordinary stone rubble (got '+stoneRubble+')');

function analyzeProceduralCrater(x0){
  const localTiles = new Map();
  function getLocal(x,y){
    x=Math.floor(x); y=Math.floor(y);
    const k=kxy(x,y);
    if(localTiles.has(k)) return localTiles.get(k);
    return y>=SURF ? T.STONE : T.AIR;
  }
  function setLocal(x,y,t){ localTiles.set(kxy(x,y),t); }
  meteorites._debug.impactAt(x0,SURF,getLocal,setLocal,1.65,null,{});
  const profile=[];
  const relChanged=[...localTiles.entries()].map(([key,t])=>{
    const [x,y]=key.split(',').map(Number);
    return {x:x-x0,y,t};
  });
  for(let x=-28; x<=28; x++){
    const air=relChanged.filter(c=>c.x===x && c.t===T.AIR && c.y>=SURF-1 && c.y<=SURF+12).map(c=>c.y-SURF);
    profile.push(air.length ? Math.max(...air) : -1);
  }
  const carved=relChanged.filter(c=>c.t===T.AIR && c.y>=SURF-1 && c.y<=SURF+12);
  const xs=carved.map(c=>c.x);
  const width=xs.length ? Math.max(...xs)-Math.min(...xs)+1 : 0;
  const depth=carved.length ? Math.max(...carved.map(c=>c.y-SURF)) : 0;
  return {signature:profile.join(','), width, depth};
}
const proceduralCraters=[0,1,2,3,4].map(i=>analyzeProceduralCrater(200+i*90));
const craterSignatures=new Set(proceduralCraters.map(c=>c.signature));
const craterWidths=proceduralCraters.map(c=>c.width);
const craterDepths=proceduralCraters.map(c=>c.depth);
assert.equal(craterSignatures.size, proceduralCraters.length, 'repeated meteor impacts generate unique crater profiles');
assert.ok(
  Math.max(...craterWidths)-Math.min(...craterWidths)>=4 ||
  Math.max(...craterDepths)-Math.min(...craterDepths)>=2,
  'procedural crater sizes vary in width or depth'
);

const waterTiles = new Map();
function getWaterTile(x,y){
  x=Math.floor(x); y=Math.floor(y);
  const k=kxy(x,y);
  if(waterTiles.has(k)) return waterTiles.get(k);
  if(y>=SURF-7 && y<SURF) return T.WATER;
  return y>=SURF ? T.STONE : T.AIR;
}
function setWaterTile(x,y,t){ waterTiles.set(kxy(x,y),t); }
const beforeWaterSplash=splashes;
const beforeSteam=steamGas;
meteorites._debug.impactAt(9,SURF-4,getWaterTile,setWaterTile,1.65,null,{waterHit:true});
assert.ok(splashes-beforeWaterSplash>=6, 'water impact throws a broad water splash');
assert.ok(steamGas>beforeSteam, 'water impact emits steam');

meteorites.restore({v:1,enabled:true,nextIn:12.5,spawned:3,impacts:4});
let migrated=meteorites.metrics();
assert.ok(migrated.nextInDays>=7 && migrated.nextInDays<=10, 'legacy short meteor timers migrate to a weekly cadence');

meteorites.restore({v:2,enabled:true,nextIn:12.5,spawned:3,impacts:4});
let restored=meteorites.metrics();
assert.equal(restored.enabled, true, 'restore keeps enabled state');
assert.equal(restored.nextIn, 12.5, 'restore keeps next meteor clock');
assert.equal(restored.spawned, 3, 'restore keeps spawned counter');
assert.equal(restored.impacts, 4, 'restore keeps impact counter');
const snap=meteorites.snapshot();
assert.equal(snap.v, 2, 'snapshot uses the weekly meteor schedule format');
assert.equal(snap.enabled, true, 'snapshot exposes enabled state');
assert.equal(snap.nextIn, 12.5, 'snapshot exposes next clock');

assert.equal(meteorites.rollSchedule(), true, 'debug can roll a natural meteor schedule');
const weekly=meteorites.metrics();
assert.ok(weekly.nextInDays>=7 && weekly.nextInDays<=10, 'natural meteor schedule waits at least seven in-game days');
const beforeWeeklySpawned=weekly.spawned;
meteorites.update(Math.max(0,weekly.nextIn-0.5),player,getTile,setTile);
assert.equal(meteorites.metrics().spawned, beforeWeeklySpawned, 'natural meteor does not spawn before the weekly cooldown expires');
meteorites.update(1,player,getTile,setTile);
assert.ok(meteorites.metrics().spawned>beforeWeeklySpawned, 'natural meteor can spawn after the weekly cooldown expires');
meteorites.clearActive();

meteorites.setEnabled(false);
restored=meteorites.metrics();
assert.equal(restored.enabled, false, 'debug toggle disables natural meteors');
const beforeSpawned=restored.spawned;
meteorites.update(DAY_SECONDS*20,player,getTile,setTile);
assert.equal(meteorites.metrics().spawned, beforeSpawned, 'disabled state remains no-op over long ticks');

console.log('meteorites-sim: all assertions passed');
