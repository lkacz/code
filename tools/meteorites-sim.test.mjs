// Deterministic-ish Node test for the meteorite hazard.
// Verifies: debug toggle/scheduler, forced bolide flight, instant surface crater
// terrain edits, subsystem wakeups, persistence snapshot/restore and no-op cost when off.
// Run: node tools/meteorites-sim.test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};
// Crater deposits are intentionally randomized in production. Pin the test RNG
// so assertions about the complete resource mix cannot fail intermittently.
let randomState=0x6d2b79f5;
Math.random=()=>((randomState=Math.imul(randomState,1664525)+1013904223>>>0)/0x100000000);
const store = new Map();
globalThis.localStorage = {
  getItem:k=>store.has(k)?store.get(k):null,
  setItem:(k,v)=>{ store.set(k,String(v)); },
  removeItem:k=>{ store.delete(k); }
};
globalThis.msg = ()=>{};

const { T, INFO, WORLD_H, WORLD_MAX_Y } = await import('../src/constants.js');
const { meteorites } = await import('../src/engine/meteorites.js');
const worldSrc = await readFile(new URL('../src/engine/world.js', import.meta.url), 'utf8');
const audioSrc = await readFile(new URL('../src/engine/audio.js', import.meta.url), 'utf8');
const fallingSrc = await readFile(new URL('../src/engine/falling.js', import.meta.url), 'utf8');
const waterSrc = await readFile(new URL('../src/engine/water.js', import.meta.url), 'utf8');

assert.ok(meteorites && meteorites.forceSpawn && meteorites.update, 'meteorites module exports');
assert.equal(typeof meteorites.impactAt, 'function', 'meteorites expose the normal impact/crater pipeline');
assert.equal(typeof meteorites.onTileChanged, 'function', 'meteorites expose a beacon tile-change index hook');
assert.equal(INFO[T.ANTIGRAVITY_BEACON].meteorShield, true, 'antigravity beacon is registered as a meteor shield tile');
assert.equal(T.METEOR_SIREN, 49, 'meteor siren has a stable tile id after water pump');
assert.equal(INFO[T.METEOR_SIREN].meteorSiren, true, 'meteor siren is registered as an alert machine');
assert.equal(INFO[T.RADIOACTIVE_ORE].radioactive, true, 'radioactive meteor ore is flagged');
assert.equal(INFO[T.ALIEN_BIOMASS].biological, true, 'biological meteor biomass is flagged');
assert.equal(INFO[T.METEOR_DUST].dust, true, 'meteor dust is flagged as strange residue');
assert.equal(INFO[T.ANTIMATTER_CRYSTAL].antimatter, true, 'antimatter meteor crystals are flagged');
assert.match(worldSrc, /MM\.meteorites && MM\.meteorites\.onTileChanged/, 'world lifecycle keeps the meteor beacon index synchronized');
assert.match(audioSrc, /alarm:\s*\(o\)=>/, 'meteor sirens have an actual procedural alarm audio effect');
assert.match(fallingSrc, /onTilesChangedBatch/, 'falling solids expose a batched terrain wake path for crater-sized edits');
assert.match(waterSrc, /onTilesChangedBatch/, 'water exposes a batched terrain wake path for crater-sized edits');

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

let waterWake=0, removed=0, placed=0, marked=0, smoke=0, sparks=0, splashes=0, audio=0, hotGas=0, steamGas=0, poisonGas=0;
let alienSows=0, plantMutations=0;
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
MM.gases = { add(kind){ if(kind==='hot') hotGas++; if(kind==='steam') steamGas++; if(kind==='poison') poisonGas++; } };
MM.plants = {
  sow(type){ if(type==='alienbloom') alienSows++; return {type}; },
  mutateAt(){ plantMutations++; return 1; }
};

meteorites.restore({enabled:false,nextIn:60,spawned:0,impacts:0});
assert.equal(meteorites.metrics().beacons, 0, 'restore clears the antigravity beacon lookup index');
assert.equal(meteorites.metrics().sirens, 0, 'restore clears the meteor siren lookup index');
meteorites.onTileChanged(7,SURF-1,T.AIR,T.ANTIGRAVITY_BEACON);
assert.equal(meteorites.metrics().beacons, 1, 'antigravity beacon placement registers in the lookup index');
meteorites.onTileChanged(7,SURF-1,T.ANTIGRAVITY_BEACON,T.AIR);
assert.equal(meteorites.metrics().beacons, 0, 'antigravity beacon removal prunes the lookup index');
meteorites.onTileChanged(8,SURF-1,T.AIR,T.METEOR_SIREN);
assert.equal(meteorites.metrics().sirens, 1, 'meteor siren placement registers in the lookup index');
meteorites.onTileChanged(8,SURF-1,T.METEOR_SIREN,T.AIR);
assert.equal(meteorites.metrics().sirens, 0, 'meteor siren removal prunes the lookup index');
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

let noBeaconReads=0;
function getNoBeaconTile(x,y){
  noBeaconReads++;
  x=Math.floor(x); y=Math.floor(y);
  return y>=SURF ? T.STONE : T.AIR;
}
function setNoBeaconTile(x,y,t){}
assert.ok(meteorites.forceSpawn({x:120,y:SURF,intensity:1.15,side:-1,classId:'iron'}, player, getNoBeaconTile), 'forced meteor spawns without any beacon');
noBeaconReads=0;
for(let i=0;i<60;i++) meteorites.update(1/60, player, getNoBeaconTile, setNoBeaconTile);
assert.ok(noBeaconReads<30000, 'missing-beacon lookup is throttled instead of rescanning every meteor substep ('+noBeaconReads+' reads)');
meteorites.clearActive();

const treeKeys=[];
for(let x=-4; x<=6; x++){
  for(let y=SURF-13; y<SURF; y++){
    const t=y<SURF-10 ? T.LEAF : T.WOOD;
    setTile(x,y,t);
    treeKeys.push(kxy(x,y));
  }
}

const spawned = meteorites.forceSpawn({x:0,y:SURF,intensity:1.65,side:-1,classId:'iridium'}, player, getTile);
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

const batchTiles = new Map();
function getBatchTile(x,y){
  x=Math.floor(x); y=Math.floor(y);
  const k=kxy(x,y);
  if(batchTiles.has(k)) return batchTiles.get(k);
  return y>=SURF ? T.STONE : T.AIR;
}
function setBatchTile(x,y,t){ batchTiles.set(kxy(x,y),t); }
const waterWakeBeforeBatch=waterWake;
const removedBeforeBatch=removed;
const placedBeforeBatch=placed;
meteorites._debug.impactAt(820,SURF,getBatchTile,setBatchTile,1.75,null,{classId:'iridium'});
const batchWaterWake=waterWake-waterWakeBeforeBatch;
const batchRemovedWake=removed-removedBeforeBatch;
const batchPlacedWake=placed-placedBeforeBatch;
assert.ok(batchWaterWake>0 && batchWaterWake<=32, 'meteor crater batches water wakeups instead of per-cell scans ('+batchWaterWake+')');
assert.ok(batchRemovedWake>0 && batchRemovedWake<=120, 'meteor crater batches falling removal wakeups ('+batchRemovedWake+')');
assert.ok(batchPlacedWake>0 && batchPlacedWake<=120, 'meteor crater batches falling placement wakeups ('+batchPlacedWake+')');

const deepSurface = Math.min(WORLD_MAX_Y-42, WORLD_H+62);
const deepTiles = new Map();
function getDeepTile(x,y){
  x=Math.floor(x); y=Math.floor(y);
  const k=kxy(x,y);
  if(deepTiles.has(k)) return deepTiles.get(k);
  return y>=deepSurface ? T.STONE : T.AIR;
}
function setDeepTile(x,y,t){ deepTiles.set(kxy(x,y),t); }
const deepCratersBefore = meteorites.metrics().craters;
meteorites._debug.impactAt(333,deepSurface,getDeepTile,setDeepTile,1.85,null,{surfaceY:deepSurface,site:'deep-test',colossal:true,classId:'antimatter',skipActorDamage:true});
const deepChanged=[...deepTiles.entries()].map(([key,t])=>({x:Number(key.split(',')[0]),y:Number(key.split(',')[1]),t}));
assert.ok(meteorites.metrics().craters>deepCratersBefore, 'direct deep impact records a crater');
assert.ok(deepChanged.some(c=>c.t===T.AIR && c.y>=deepSurface && c.y<WORLD_MAX_Y-3), 'deep impact carves ordinary deep stone into air');
assert.ok(deepChanged.some(c=>c.t===T.LAVA || c.t===T.OBSIDIAN || c.t===T.ANTIMATTER_CRYSTAL), 'deep impact leaves the normal heated/mineral crater materials');
assert.ok(meteorites.snapshot().craters.at(-1).y>=WORLD_H, 'deep impact crater record keeps its extended y coordinate');

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

function instantClassImpact(classId,x0){
  const localTiles = new Map();
  function getLocal(x,y){
    x=Math.floor(x); y=Math.floor(y);
    const k=kxy(x,y);
    if(localTiles.has(k)) return localTiles.get(k);
    return y>=SURF ? T.STONE : T.AIR;
  }
  function setLocal(x,y,t){ localTiles.set(kxy(x,y),t); }
  const beforePoison=poisonGas;
  const beforeBurst=meteorites._debug.gravityBursts.length;
  meteorites._debug.impactAt(x0,SURF,getLocal,setLocal,1.55,null,{classId});
  const vals=[...localTiles.values()];
  return {
    vals,
    localTiles,
    poisonDelta:poisonGas-beforePoison,
    burstDelta:meteorites._debug.gravityBursts.length-beforeBurst,
    scan:meteorites.scanNearestCrater({x:x0,y:SURF},getLocal)
  };
}
const ironImpact=instantClassImpact('iron',320);
assert.ok(ironImpact.vals.includes(T.METEORIC_IRON), 'iron meteor class leaves meteoric iron');
assert.ok(ironImpact.scan && ironImpact.scan.classId==='iron', 'crater scanner reports iron class');
const iceImpact=instantClassImpact('ice',390);
assert.ok(iceImpact.vals.includes(T.ICE) || iceImpact.vals.includes(T.SNOW), 'ice meteor class leaves frozen material');
const radioactiveImpact=instantClassImpact('radioactive',460);
assert.ok(radioactiveImpact.vals.includes(T.RADIOACTIVE_ORE), 'radioactive meteor class leaves radioactive ore');
assert.ok(radioactiveImpact.vals.includes(T.METEOR_DUST), 'radioactive meteor class leaves meteor dust');
assert.ok(radioactiveImpact.poisonDelta>0, 'radioactive impact injects poison gas');
const antimatterImpact=instantClassImpact('antimatter',530);
assert.ok(antimatterImpact.vals.includes(T.ANTIMATTER_CRYSTAL), 'antimatter meteor class leaves antimatter crystals');
assert.ok(antimatterImpact.burstDelta>0, 'antimatter impact leaves inverse-gravity burst effects');
const biologicalImpact=instantClassImpact('biological',600);
assert.ok(biologicalImpact.vals.includes(T.ALIEN_BIOMASS), 'biological meteor class leaves alien biomass');
assert.ok(biologicalImpact.vals.includes(T.METEOR_DUST), 'biological meteor class leaves mutation dust');
assert.ok(meteorites.metrics().meteorMutations>0, 'meteor dust ecology mutations are tracked');

const ecoTiles = new Map();
function getEcoTile(x,y){
  x=Math.floor(x); y=Math.floor(y);
  const k=kxy(x,y);
  if(ecoTiles.has(k)) return ecoTiles.get(k);
  return y>=SURF ? T.STONE : T.AIR;
}
function setEcoTile(x,y,t){ ecoTiles.set(kxy(x,y),t); }
const beforeEcoOps=meteorites.metrics().craterEcologyOps;
const beforePlantMutations=plantMutations;
meteorites._debug.impactAt(760,SURF,getEcoTile,setEcoTile,1.45,null,{classId:'radioactive'});
for(let i=0;i<70;i++) meteorites.update(1, player, getEcoTile, setEcoTile);
const ecoAfter=meteorites.metrics();
const ecoScan=meteorites.scanNearestCrater({x:760,y:SURF},getEcoTile);
assert.ok(ecoAfter.craterEcologyOps>beforeEcoOps, 'old craters evolve through a bounded ecology worker');
assert.ok(ecoAfter.ecologyCraters>0, 'metrics report active crater landmarks');
assert.ok(plantMutations>beforePlantMutations, 'radioactive crater ecology mutates nearby plants through the plant hook');
assert.ok(ecoScan && ecoScan.ecology && ecoScan.ecology.kind==='glow', 'crater scanner reports the crater ecology landmark type');
assert.match(ecoScan.ecology.label, /radioaktywne/, 'crater scanner exposes a readable ecology label');
const ecoSnap=meteorites.snapshot();
meteorites.restore(ecoSnap);
const restoredEcoScan=meteorites.scanNearestCrater({x:760,y:SURF},getEcoTile);
assert.ok(restoredEcoScan && restoredEcoScan.ecology && restoredEcoScan.ecology.kind==='glow', 'crater ecology landmark type survives snapshot restore');
assert.ok(restoredEcoScan.ecology.glow>=ecoScan.ecology.glow, 'crater ecology progress survives snapshot restore');
globalThis.__mmFrameMs = 35;
const criticalEcoBefore=meteorites.metrics().craterEcologyOps;
for(let i=0;i<20;i++) meteorites.update(1, player, getEcoTile, setEcoTile);
const criticalEcoAfter=meteorites.metrics();
assert.equal(criticalEcoAfter.craterPerfTier, 2, 'meteorite metrics report critical frame pressure');
assert.equal(criticalEcoAfter.craterDrawQuality, 0, 'crater ecology switches to cheapest draw quality under critical frame pressure');
assert.equal(criticalEcoAfter.craterEcologyOps, criticalEcoBefore, 'critical frame pressure pauses persistent crater ecology work');
globalThis.__mmFrameMs = 16;

const burstBefore=meteorites._debug.gravityBursts.length;
assert.equal(meteorites.triggerAntimatterBurst(780,SURF-1,1.2), true, 'breaking antimatter can trigger a manual inverse-gravity burst');
assert.ok(meteorites._debug.gravityBursts.length>burstBefore, 'manual antimatter burst reuses the meteor gravity-burst system');

const forestTiles = new Map();
function getForestTile(x,y){
  x=Math.floor(x); y=Math.floor(y);
  const k=kxy(x,y);
  if(forestTiles.has(k)) return forestTiles.get(k);
  if(y>=SURF-10 && y<SURF){
    return (x>=690 && x<=706) ? (y<SURF-4 ? T.LEAF : T.WOOD) : T.AIR;
  }
  return y>=SURF ? T.STONE : T.AIR;
}
function setForestTile(x,y,t){ forestTiles.set(kxy(x,y),t); }
const beforeConsequences=meteorites.metrics().impactConsequences;
meteorites._debug.impactAt(698,SURF,getForestTile,setForestTile,1.45,null,{classId:'iron',deflected:true});
const consequenceAfter=meteorites.metrics();
assert.ok(consequenceAfter.impactConsequences>beforeConsequences, 'redirected meteor impact creates an ethical consequence record');
assert.ok(consequenceAfter.consequenceCounts.forest>0, 'redirected forest damage increments forest consequence count');
assert.ok(consequenceAfter.lastConsequence && consequenceAfter.lastConsequence.site==='forest', 'last consequence identifies the impacted site type');
assert.match(consequenceAfter.lastConsequence.message, /lasu/, 'consequence message explains what was protected and harmed');

const sirenTiles = new Map();
function getSirenTile(x,y){
  x=Math.floor(x); y=Math.floor(y);
  const k=kxy(x,y);
  if(sirenTiles.has(k)) return sirenTiles.get(k);
  return y>=SURF ? T.STONE : T.AIR;
}
function setSirenTile(x,y,t){ sirenTiles.set(kxy(x,y),t); }
setSirenTile(660,SURF-1,T.METEOR_SIREN);
meteorites.onTileChanged(660,SURF-1,T.AIR,T.METEOR_SIREN);
const beforeAlerts=meteorites.metrics().sirenAlerts;
assert.ok(meteorites.forceSpawn({x:666,y:SURF,intensity:1.25,side:-1,classId:'ice'}, player, getSirenTile), 'forced meteor spawns near siren');
const sirenAfter=meteorites.metrics();
assert.equal(sirenAfter.sirens, 1, 'siren remains indexed after alert');
assert.ok(sirenAfter.sirenAlerts>beforeAlerts, 'siren warns about nearby meteor target');
assert.ok(sirenAfter.sirenPulses>0, 'siren warning emits visible pulses');
meteorites.clearActive();

const lakeTiles = new Map();
function getLakeTile(x,y){
  x=Math.floor(x); y=Math.floor(y);
  const k=kxy(x,y);
  if(lakeTiles.has(k)) return lakeTiles.get(k);
  return y>=SURF ? T.STONE : T.AIR;
}
function setLakeTile(x,y,t){ lakeTiles.set(kxy(x,y),t); }
MM.clouds = { isRainingAt:()=>true };
const beforeLakeOps=meteorites.metrics().craterLakeOps;
meteorites._debug.impactAt(740,SURF,getLakeTile,setLakeTile,1.45,null,{classId:'iron'});
for(let i=0;i<160;i++) meteorites.update(1, player, getLakeTile, setLakeTile);
const lakeAfter=meteorites.metrics();
assert.ok([...lakeTiles.values()].includes(T.WATER), 'rain can slowly turn a crater into a lake');
assert.ok(lakeAfter.craterLakeOps>beforeLakeOps, 'crater lake filling is tracked as bounded work');
assert.ok(lakeAfter.lakeCraters>0, 'metrics report water-bearing craters');
delete MM.clouds;

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
const shielded = meteorites.forceSpawn({x:0,y:SURF,intensity:1.65,side:-1,classId:'iron'}, player, getBeaconTile);
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
assert.ok(meteorites.forceSpawn({x:0,y:SURF,intensity:1.65,side:-1,classId:'iron'}, player, getChainTile), 'forced meteor spawns for chained beacon deflection');
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
assert.equal(snap.v, 4, 'snapshot uses the crater ecology persistence format');
assert.equal(snap.enabled, true, 'snapshot exposes enabled state');
assert.equal(snap.nextIn, 12.5, 'snapshot exposes next clock');
assert.ok(Array.isArray(snap.craters), 'snapshot preserves known crater science records');
assert.ok(snap.craters.every(c=>!c || c.eco==null || typeof c.eco.k === 'string'), 'snapshot preserves compact crater ecology records');
assert.ok(snap.classCounts && typeof snap.classCounts.iron === 'number', 'snapshot preserves meteor class counters');
assert.ok(typeof snap.craterEcologyOps === 'number', 'snapshot preserves bounded crater ecology work metrics');
assert.ok(Array.isArray(snap.consequences), 'snapshot preserves redirected-impact consequence history');
assert.ok(snap.consequenceCounts && typeof snap.consequenceCounts.forest === 'number', 'snapshot preserves consequence counters');

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
