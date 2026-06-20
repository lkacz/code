// Deterministic-ish Node test for the meteorite hazard.
// Verifies: debug toggle/scheduler, forced bolide flight, instant surface crater
// terrain edits, subsystem wakeups, persistence snapshot/restore and no-op cost when off.
// Run: node tools/meteorites-sim.test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};
const store = new Map();
globalThis.localStorage = {
  getItem:k=>store.has(k)?store.get(k):null,
  setItem:(k,v)=>{ store.set(k,String(v)); },
  removeItem:k=>{ store.delete(k); }
};
globalThis.msg = ()=>{};

const { T, INFO } = await import('../src/constants.js');
const { meteorites } = await import('../src/engine/meteorites.js');
const worldSrc = await readFile(new URL('../src/engine/world.js', import.meta.url), 'utf8');

assert.ok(meteorites && meteorites.forceSpawn && meteorites.update, 'meteorites module exports');
assert.equal(typeof meteorites.onTileChanged, 'function', 'meteorites expose a beacon tile-change index hook');
assert.equal(INFO[T.ANTIGRAVITY_BEACON].meteorShield, true, 'antigravity beacon is registered as a meteor shield tile');
assert.match(worldSrc, /MM\.meteorites && MM\.meteorites\.onTileChanged/, 'world lifecycle keeps the meteor beacon index synchronized');

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
assert.equal(meteorites.metrics().beacons, 0, 'restore clears the antigravity beacon lookup index');
meteorites.onTileChanged(7,SURF-1,T.AIR,T.ANTIGRAVITY_BEACON);
assert.equal(meteorites.metrics().beacons, 1, 'antigravity beacon placement registers in the lookup index');
meteorites.onTileChanged(7,SURF-1,T.ANTIGRAVITY_BEACON,T.AIR);
assert.equal(meteorites.metrics().beacons, 0, 'antigravity beacon removal prunes the lookup index');
let indexedReads=0;
function getIndexedBeaconTile(x,y){
  indexedReads++;
  return Math.floor(x)===9 && Math.floor(y)===SURF-1 ? T.ANTIGRAVITY_BEACON : T.AIR;
}
meteorites.onTileChanged(9,SURF-1,T.AIR,T.ANTIGRAVITY_BEACON);
const indexedBeacon=meteorites._debug.nearestBeacon(9.5,SURF-0.5,getIndexedBeaconTile,44);
assert.equal(indexedBeacon && indexedBeacon.tx, 9, 'indexed beacon lookup finds the registered beacon');
assert.ok(indexedReads<=2, 'indexed beacon lookup avoids a broad tile scan');
meteorites.onTileChanged(9,SURF-1,T.ANTIGRAVITY_BEACON,T.AIR);
let fallbackReads=0;
function getFallbackBeaconTile(x,y){
  fallbackReads++;
  return Math.floor(x)===11 && Math.floor(y)===SURF-1 ? T.ANTIGRAVITY_BEACON : T.AIR;
}
const fallbackBeacon=meteorites._debug.nearestBeacon(11.5,SURF-0.5,getFallbackBeaconTile,44);
assert.equal(fallbackBeacon && fallbackBeacon.tx, 11, 'fallback tile scan discovers unindexed beacons');
assert.equal(meteorites.metrics().beacons, 1, 'fallback discovery registers the beacon for later indexed lookup');
assert.ok(fallbackReads>100, 'legacy fallback performs the broad scan only when needed');
meteorites.onTileChanged(11,SURF-1,T.ANTIGRAVITY_BEACON,T.AIR);
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

meteorites.clearActive();
const beaconTiles = new Map();
function getBeaconTile(x,y){
  x=Math.floor(x); y=Math.floor(y);
  const k=kxy(x,y);
  if(beaconTiles.has(k)) return beaconTiles.get(k);
  return y>=SURF ? T.STONE : T.AIR;
}
function setBeaconTile(x,y,t){ beaconTiles.set(kxy(x,y),t); }
setBeaconTile(0,SURF-1,T.ANTIGRAVITY_BEACON);
meteorites.onTileChanged(0,SURF-1,T.AIR,T.ANTIGRAVITY_BEACON);
assert.equal(meteorites.metrics().beacons, 1, 'debug-placed beacon is available through the fast lookup index');
player.x=0.5;
player.y=SURF-1;
player.vx=0;
player.vy=0;
const beforeBeaconImpacts=meteorites.metrics().impacts;
const beforeDeflections=meteorites.metrics().deflections;
const shielded = meteorites.forceSpawn({x:0,y:SURF,intensity:1.65,side:-1}, player, getBeaconTile);
assert.ok(shielded, 'forced debug meteor spawns against an antigravity beacon');
let sawDeflection=false;
let sawWave=false;
let sawBurst=false;
let sawInverseLift=false;
for(let i=0;i<900;i++){
  meteorites.update(1/60, player, getBeaconTile, setBeaconTile);
  const m=meteorites.metrics();
  if(m.deflections>beforeDeflections) sawDeflection=true;
  if(m.beaconWaves>0) sawWave=true;
  if(m.gravityBursts>0) sawBurst=true;
  if(player.vy<-0.04) sawInverseLift=true;
  if(m.meteors===0 && m.impacts>beforeBeaconImpacts) break;
}
const beaconAfter=meteorites.metrics();
assert.ok(sawDeflection, 'antigravity beacon deflects the incoming meteor');
assert.ok(beaconAfter.lastDeflection && beaconAfter.lastDeflection.d<=22, 'beacon waits until the meteor is close before deflecting (d='+((beaconAfter.lastDeflection&&beaconAfter.lastDeflection.d)||'?')+')');
assert.ok(beaconAfter.lastDeflection && Number.isFinite(beaconAfter.lastDeflection.targetX) && Math.abs(beaconAfter.lastDeflection.targetX-0.5)>=52, 'deflection chooses a redirected landing with crater clearance');
assert.ok(sawWave, 'beacon emits an antigravity wave toward the meteor');
assert.ok(sawBurst, 'beacon leaves a timed inverse-gravity burst after firing');
assert.ok(sawInverseLift, 'inverse-gravity burst applies upward lift near the beacon');
assert.equal(beaconAfter.impacts, beforeBeaconImpacts+1, 'deflected meteor still creates a crater impact after bouncing away');
assert.ok(beaconAfter.lastImpact && Math.abs(beaconAfter.lastImpact.x-0.5)>=52, 'bounced meteor impacts at a useful distance from the protected beacon');
assert.equal(getBeaconTile(0,SURF-1), T.ANTIGRAVITY_BEACON, 'antigravity beacon survives the deflection');
const protectedBeaconEdits=[...beaconTiles.entries()].filter(([key,t])=>{
  const [x,y]=key.split(',').map(Number);
  if(x===0 && y===SURF-1) return false;
  return Math.abs(x)<=28 && y>=SURF-3 && (t===T.AIR || t===T.LAVA || t===T.OBSIDIAN || t===T.GLASS || t===T.METEORIC_IRON || t===T.IRIDIUM || t===T.COAL);
});
assert.equal(protectedBeaconEdits.length,0,'deflection protects the beacon area from crater terrain edits');
const remoteHeat=[...beaconTiles.entries()].filter(([key,t])=>{
  const [x,y]=key.split(',').map(Number);
  return Math.abs(x)>=34 && y>=SURF-3 && (t===T.LAVA || t===T.OBSIDIAN || t===T.GLASS || t===T.METEORIC_IRON || t===T.IRIDIUM || t===T.COAL);
});
assert.ok(remoteHeat.length>0,'bounced meteor leaves heat/mineral terrain at the redirected impact site');

meteorites.clearActive();
const chainTiles = new Map();
function getChainTile(x,y){
  x=Math.floor(x); y=Math.floor(y);
  const k=kxy(x,y);
  if(chainTiles.has(k)) return chainTiles.get(k);
  return y>=SURF ? T.STONE : T.AIR;
}
function setChainTile(x,y,t){ chainTiles.set(kxy(x,y),t); }
setChainTile(0,SURF-1,T.ANTIGRAVITY_BEACON);
setChainTile(-60,SURF-1,T.ANTIGRAVITY_BEACON);
meteorites.onTileChanged(-60,SURF-1,T.AIR,T.ANTIGRAVITY_BEACON);
player.x=0.5;
player.y=SURF-1;
player.vx=0;
player.vy=0;
const beforeChainImpacts=meteorites.metrics().impacts;
const beforeChainDeflections=meteorites.metrics().deflections;
assert.ok(meteorites.forceSpawn({x:0,y:SURF,intensity:1.65,side:-1}, player, getChainTile), 'forced meteor spawns for chained beacon deflection');
for(let i=0;i<1300;i++){
  meteorites.update(1/60, player, getChainTile, setChainTile);
  const m=meteorites.metrics();
  if(m.meteors===0 && m.impacts>beforeChainImpacts) break;
}
const chainAfter=meteorites.metrics();
assert.ok(chainAfter.deflections>=beforeChainDeflections+2, 'a second antigravity beacon can bounce a redirected meteor again');
assert.equal(chainAfter.impacts, beforeChainImpacts+1, 'chained deflections still resolve into one remote crater');
assert.equal(getChainTile(0,SURF-1), T.ANTIGRAVITY_BEACON, 'first beacon survives chained deflection');
assert.equal(getChainTile(-60,SURF-1), T.ANTIGRAVITY_BEACON, 'second beacon survives chained deflection');
assert.ok(chainAfter.lastImpact && Math.abs(chainAfter.lastImpact.x-0.5)>34 && Math.abs(chainAfter.lastImpact.x+59.5)>34, 'chained deflection moves the crater away from both protected beacons');

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
