// Regression tests for the water pump and pipe network.
// Verifies resource/tile registration, directional input/output, power use,
// branched pipe traversal, water-turret tanks, save/restore and main/UI hooks.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};
const { T, INFO, WORLD_H } = await import('../src/constants.js');
const { dynamo } = await import('../src/engine/dynamo.js');
const { teleporters } = await import('../src/engine/teleporters.js');
const { pumps } = await import('../src/engine/pumps.js');
const { turrets } = await import('../src/engine/turrets.js');

const tiles = new Map();
const k = (x,y)=>Math.floor(x)+','+Math.floor(y);
function getTile(x,y){
  x=Math.floor(x); y=Math.floor(y);
  if(y<0 || y>=WORLD_H) return T.AIR;
  return tiles.get(k(x,y)) ?? T.AIR;
}
function setTile(x,y,v){
  x=Math.floor(x); y=Math.floor(y);
  const id=k(x,y);
  const old=getTile(x,y);
  if(v===T.AIR) tiles.delete(id);
  else tiles.set(id,v);
  if(dynamo && dynamo.onTileChanged) dynamo.onTileChanged(x,y,old,v);
  if(teleporters && teleporters.onTileChanged) teleporters.onTileChanged(x,y,old,v);
  if(pumps && pumps.onTileChanged) pumps.onTileChanged(x,y,old,v);
  if(turrets && turrets.onTileChanged) turrets.onTileChanged(x,y,old,v);
}
function reset(){
  tiles.clear();
  dynamo.reset();
  teleporters.reset();
  pumps.reset();
  turrets.reset();
  globalThis.MM.world={getTile,setTile};
  globalThis.MM.audio={play(){}};
  globalThis.MM.particles={spawnSparks(){}, spawnSplash(){}, spawnEnergyAbsorb(){}};
  globalThis.MM.fire={heatAround(){}};
  delete globalThis.MM.mobs;
}
function placeDynamo(cx,y,orientation='horizontal'){
  dynamo.plannedCells(cx,y,orientation).forEach(cell=>setTile(cell.x,cell.y,cell.t));
}
function chargeDynamo(cx,y){
  for(let i=0; i<80; i++) dynamo.recordFlow(cx,y,T.WATER,4,getTile);
}
function tick(dt,player={x:0.5,y:10.5,w:0.7,h:0.95,vx:0,vy:0}){
  teleporters.update(dt,player,getTile,setTile,{dynamo});
  pumps.update(dt,player,getTile,setTile,{dynamo,teleporters});
  turrets.update(dt,player,getTile,setTile,{dynamo,teleporters,pumps});
}
function fakeMobAt(x,y,hp=1000){
  const mob={x,y,hp,id:'WOLF',vx:0,vy:0};
  const state={hits:0};
  globalThis.MM.mobs={
    nearestLiving(wx,wy,r){
      if(!(mob.hp>0)) return null;
      const dx=mob.x-wx, dy=mob.y-wy;
      return dx*dx+dy*dy<=r*r ? mob : null;
    },
    damageAt(tx,ty,dmg){
      if(!(mob.hp>0)) return false;
      if(Math.abs((tx+0.5)-mob.x)>1 || Math.abs((ty+0.5)-mob.y)>1) return false;
      mob.hp-=Math.max(0.5,Number(dmg)||1);
      state.hits++;
      return true;
    },
    douseRadius(){ return 1; }
  };
  return {mob,state};
}
function basicPumpRig({powered=true,dir='east'}={}){
  setTile(-3,10,T.WATER);
  setTile(-2,10,T.WATER_PIPE);
  setTile(-1,10,T.WATER_PIPE);
  setTile(0,10,T.WATER_PUMP);
  pumps.setOrientationAt(0,10,dir,getTile);
  setTile(1,10,T.WATER_PIPE);
  setTile(2,10,T.WATER_PIPE);
  setTile(3,10,T.WATER_TURRET);
  turrets._debug.debugChargeAt(3,10,turrets._debug.TURRET_CAPACITY,getTile);
  turrets._debug.debugSetWaterAt(3,10,0,getTile);
  if(powered) pumps._debug.debugSetEnergyAt(0,10,pumps._debug.PUMP_CAPACITY,getTile);
}

assert.equal(T.WATER_PIPE,47,'water pipe has a stable tile id after water turret');
assert.equal(T.WATER_PUMP,48,'water pump has a stable tile id after water pipe');
assert.equal(INFO[T.WATER_PIPE].fluidPipe,true,'water pipe is marked as a fluid pipe');
assert.equal(INFO[T.WATER_PIPE].passable,true,'water pipes are passable infrastructure');
assert.equal(INFO[T.WATER_PUMP].powerDevice,true,'water pump is a powered endpoint for copper networks');
assert.equal(INFO[T.WATER_TURRET].waterDevice,true,'water turret is a hydraulic consumer');

{
  reset();
  setTile(0,10,T.WATER_TURRET);
  turrets._debug.debugChargeAt(0,10,turrets._debug.TURRET_CAPACITY,getTile);
  turrets._debug.debugSetWaterAt(0,10,turrets._debug.WATER_TURRET_START_WATER,getTile);
  fakeMobAt(5.5,10.5,1000);
  for(let i=0;i<360;i++){
    turrets._debug.debugChargeAt(0,10,turrets._debug.TURRET_CAPACITY,getTile);
    turrets.update(1/30,{x:0.5,y:10.5},getTile,setTile,{dynamo,teleporters});
  }
  const m=turrets.metrics();
  assert.ok(m.shots>0,'water turret can spend its starting tank');
  assert.ok(m.shots<=turrets._debug.WATER_TURRET_START_WATER,'water turret stops when its internal tank is depleted');
  assert.equal(m.storedWater,0,'depleted water turret reports an empty tank');
}

{
  reset();
  basicPumpRig({powered:false});
  for(let i=0;i<90;i++) tick(1/30);
  assert.equal(turrets.metrics().storedWater,0,'unpowered pump does not fill a connected water turret');
  assert.equal(pumps.metrics().moved,0,'unpowered pump moves no water');
}

{
  reset();
  basicPumpRig({powered:true});
  tick(1/30);
  const warm=pumps.metrics();
  assert.equal(warm.cacheBuilds,2,'first active pump tick builds input and output pipe networks once');
  assert.ok(warm.activePipes>0,'active pipe segments are marked for flow rendering during transfer');
  for(let i=0;i<30;i++) tick(1/30);
  const cached=pumps.metrics();
  assert.equal(cached.cacheBuilds,warm.cacheBuilds,'stable pipe topology reuses cached pump networks instead of rebuilding every frame');
  assert.ok(cached.cacheHits>0,'stable pipe topology records cache hits on subsequent pump ticks');
  for(let i=0;i<60;i++) tick(1/30);
  assert.ok(turrets.metrics().storedWater>0,'powered pump fills a connected water turret from a reservoir');
  assert.ok(pumps.metrics().moved>0,'powered pump records moved water');
  assert.ok(pumps.metrics().storedEnergy<pumps._debug.PUMP_CAPACITY,'moving water consumes pump battery energy');
}

{
  reset();
  setTile(-2,10,T.WATER);
  setTile(-1,10,T.WATER_PIPE);
  setTile(0,10,T.WATER_PUMP);
  pumps.setOrientationAt(0,10,'east',getTile);
  setTile(1,10,T.WATER_PIPE);
  pumps._debug.debugSetEnergyAt(0,10,pumps._debug.PUMP_CAPACITY,getTile);
  for(let i=0;i<90;i++) tick(1/30);
  assert.equal(getTile(2,10),T.WATER,'powered pump spills water from an open output pipe when no water device is attached');
  assert.ok(pumps.metrics().outletMoved>0,'pump metrics record open-end pipe discharge');
}

{
  reset();
  setTile(-2,10,T.WATER_PIPE);
  setTile(-1,10,T.WATER_PIPE);
  setTile(0,10,T.WATER_PUMP);
  pumps.setOrientationAt(0,10,'east',getTile);
  setTile(1,10,T.WATER_PIPE);
  setTile(2,10,T.WATER_PIPE);
  setTile(3,10,T.WATER_TURRET);
  turrets._debug.debugSetWaterAt(3,10,0,getTile);
  pumps._debug.debugSetEnergyAt(0,10,pumps._debug.PUMP_CAPACITY,getTile);
  for(let i=0;i<5;i++) tick(1/30);
  assert.equal(pumps.metrics().moved,0,'pump with cached dry input network moves no water before a reservoir appears');
  const invBefore=pumps.metrics().cacheInvalidations;
  const buildsBefore=pumps.metrics().cacheBuilds;
  setTile(-3,10,T.WATER);
  assert.equal(pumps.metrics().cacheInvalidations,invBefore,'adding water next to a pipe does not invalidate stable pipe topology');
  for(let i=0;i<90;i++) tick(1/30);
  assert.equal(pumps.metrics().cacheBuilds,buildsBefore,'lazy source probing avoids rebuilding a dry pipe network after water arrives');
  assert.ok(pumps.metrics().sourceChecks>0,'cached dry networks probe bounded source candidates for newly arrived water');
  assert.ok(turrets.metrics().storedWater>0,'pump discovers a water source added after the dry network was cached');
}

{
  reset();
  setTile(3,10,T.WATER);
  setTile(2,10,T.WATER_PIPE);
  setTile(1,10,T.WATER_PIPE);
  setTile(0,10,T.WATER_PUMP);
  pumps.setOrientationAt(0,10,'east',getTile);
  setTile(-1,10,T.WATER_PIPE);
  setTile(-2,10,T.WATER_PIPE);
  setTile(-3,10,T.WATER_TURRET);
  turrets._debug.debugSetWaterAt(-3,10,0,getTile);
  pumps._debug.debugSetEnergyAt(0,10,pumps._debug.PUMP_CAPACITY,getTile);
  for(let i=0;i<90;i++) tick(1/30);
  assert.equal(turrets.metrics().storedWater,0,'pump does not work when reservoir and consumer are swapped across input/output');
  assert.equal(pumps.metrics().moved,0,'directional pump rejects reverse flow');
}

{
  reset();
  setTile(-3,12,T.WATER);
  setTile(-2,12,T.WATER_PIPE);
  setTile(-2,11,T.WATER_PIPE);
  setTile(-2,10,T.WATER_PIPE);
  setTile(-1,10,T.WATER_PIPE);
  setTile(0,10,T.WATER_PUMP);
  pumps.setOrientationAt(0,10,'east',getTile);
  setTile(1,10,T.WATER_PIPE);
  setTile(2,10,T.WATER_PIPE);
  setTile(2,9,T.WATER_PIPE);
  setTile(3,9,T.WATER_TURRET);
  turrets._debug.debugSetWaterAt(3,9,0,getTile);
  pumps._debug.debugSetEnergyAt(0,10,pumps._debug.PUMP_CAPACITY,getTile);
  for(let i=0;i<120;i++) tick(1/30);
  assert.ok(turrets.metrics().storedWater>0,'branched and vertical pipes connect reservoir to water turret');
}

{
  reset();
  setTile(0,10,T.WATER_PUMP);
  setTile(-1,10,T.COPPER_WIRE);
  placeDynamo(-3,10);
  chargeDynamo(-3,10);
  const before=dynamo.metrics().storedEnergy;
  for(let i=0;i<60;i++) tick(1/30);
  assert.ok(pumps.metrics().storedEnergy>0,'water pump battery charges from a copper/dynamo power network');
  assert.ok(dynamo.metrics().storedEnergy<before,'charging a pump drains real dynamo energy');
}

{
  reset();
  setTile(0,10,T.WATER_PUMP);
  pumps.setOrientationAt(0,10,'south',getTile);
  pumps._debug.debugSetEnergyAt(0,10,33,getTile);
  const snap=pumps.snapshot();
  pumps.reset();
  assert.equal(pumps.metrics().machines,0,'pump reset clears machine state');
  pumps.restore(snap,getTile);
  assert.equal(pumps.metrics().machines,1,'pump restore rehydrates machine state');
  assert.equal(Math.round(pumps.metrics().storedEnergy),33,'pump restore preserves battery energy');
  assert.equal(pumps.orientationAt(0,10,getTile),'south','pump restore preserves orientation');
}

{
  reset();
  setTile(-1,10,T.WATER);
  setTile(0,10,T.WATER_PUMP);
  pumps.setOrientationAt(0,10,'east',getTile);
  pumps._debug.debugSetEnergyAt(0,10,pumps._debug.PUMP_CAPACITY,getTile);
  setTile(1,10,T.WATER_PIPE);
  for(let i=0;i<72;i++){
    setTile(2+i,10,T.WATER_PIPE);
    setTile(2+i,9,T.WATER_TURRET);
    turrets._debug.debugSetWaterAt(2+i,9,turrets._debug.WATER_TURRET_TANK,getTile);
  }
  tick(1/30);
  assert.ok(pumps.metrics().consumerChecks<=pumps._debug.CONSUMER_CHECK_CAP,'one pump update checks a bounded number of consumers on very large output networks');
}

const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
assert.match(mainSrc, /import \{ pumps as PUMPS \}/, 'main imports the pump engine');
assert.match(mainSrc, /pumps:\s*timedSavePart\('pumps',[^\n]*PUMPS && PUMPS\.snapshot/, 'main saves pump machine state');
assert.match(mainSrc, /PUMPS\.restore\(data\.pumps,getTile\)/, 'main restores pump machine state');
assert.match(mainSrc, /PUMPS\.update\(dt, player, getNetworkTile, setTile, \{dynamo:DYNAMO, teleporters:TELEPORTERS\}\)/, 'main updates pumps before turrets with overlay-aware pipe networks');
assert.match(mainSrc, /PUMPS\.draw\(ctx,TILE,sx,sy,viewX,viewY,worldFxVisible,getNetworkTile\)/, 'main draws pump overlays and pipe flow FX through infrastructure overlays');
assert.match(mainSrc, /id:'water_pipe'/, 'crafting exposes water pipes');
assert.match(mainSrc, /id:'water_pump'/, 'crafting exposes water pumps');
assert.match(mainSrc, /function placeDebugPumpRig\(\)/, 'main exposes a complete pump debug rig');
assert.match(mainSrc, /MM\.ui\.injectPumpDebugPanel/, 'main injects the pump debug panel');

const uiSrc = await readFile(new URL('../src/engine/ui.js', import.meta.url), 'utf8');
assert.match(uiSrc, /function injectPumpDebugPanel\(actions, menuPanel\)/, 'ui exposes a pump debug panel injector');
assert.match(uiSrc, /box\.id='pumpDebugBox'/, 'pump debug panel has a stable DOM id');
assert.match(uiSrc, /Uklad testowy/, 'pump debug panel includes a full rig button');

const worldSrc = await readFile(new URL('../src/engine/world.js', import.meta.url), 'utf8');
assert.match(worldSrc, /MM\.pumps && MM\.pumps\.onTileChanged/, 'world lifecycle notifies pumps about tile changes');

console.log('pumps-sim: all assertions passed');
