// Regression tests for the fluid pump and pipe network.
// Verifies resource/tile registration, directional input/output, power use,
// passive water/gas flow, branched pipe traversal, water-turret tanks,
// save/restore and main/UI hooks.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};
const { T, INFO, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } = await import('../src/constants.js');
const { dynamo } = await import('../src/engine/dynamo.js');
const { teleporters } = await import('../src/engine/teleporters.js');
const { gases } = await import('../src/engine/gases.js');
const { pumps } = await import('../src/engine/pumps.js');
const { turrets } = await import('../src/engine/turrets.js');

const tiles = new Map();
const k = (x,y)=>Math.floor(x)+','+Math.floor(y);
function getTile(x,y){
  x=Math.floor(x); y=Math.floor(y);
  if(y<WORLD_MIN_Y || y>=WORLD_MAX_Y) return T.AIR;
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
  if(gases && gases.onTileChanged) gases.onTileChanged(x,y,old,v);
  if(pumps && pumps.onTileChanged) pumps.onTileChanged(x,y,old,v);
  if(turrets && turrets.onTileChanged) turrets.onTileChanged(x,y,old,v);
}
function reset(){
  tiles.clear();
  dynamo.reset();
  teleporters.reset();
  gases.reset();
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
assert.deepEqual(
  ['east','south','west','north','east'].slice(1),
  [pumps.rotateDir('east'),pumps.rotateDir('south'),pumps.rotateDir('west'),pumps.rotateDir('north')],
  'pump rotation advances clockwise and wraps back to east'
);

{
  reset();
  setTile(5,5,T.WATER_PIPE);
  assert.equal(pumps.pipeModeAt(5,5,getTile),'normal','new fluid pipe starts as an ordinary segment');
  assert.equal(pumps.togglePipeModeAt(5,5,getTile),'intake','pipe mode toggles to a designated water intake');
  assert.equal(pumps.pipeModeAt(5,5,getTile),'intake','designated intake mode is readable by rendering and simulation');
  const snap=pumps.snapshot();
  assert.deepEqual(snap.inlets,[{x:5,y:5}],'pump snapshot persists sparse pipe intake metadata');
  pumps.reset();
  pumps.restore(snap,getTile);
  assert.equal(pumps.pipeModeAt(5,5,getTile),'intake','pipe intake mode survives save and restore');
  assert.equal(pumps.togglePipeModeAt(5,5,getTile),'normal','second toggle restores ordinary pipe behaviour');
}

function pumpCanvasRecorder(){
  const strokes=[];
  let path=[];
  const ctx={
    strokes,
    save(){}, restore(){}, fillRect(){}, strokeRect(){}, fill(){}, closePath(){},
    beginPath(){ path=[]; },
    moveTo(x,y){ path.push({kind:'move',x,y}); },
    lineTo(x,y){ path.push({kind:'line',x,y}); },
    arc(){},
    stroke(){ strokes.push(path.slice()); }
  };
  return ctx;
}

{
  const ctx=pumpCanvasRecorder();
  pumps.drawPumpTile(ctx,20,0,0,'east',1,1,1);
  const fullFlow=ctx.strokes.find(path=>path.length===2
    && path[0].kind==='move' && path[1].kind==='line'
    && path[0].x<3 && path[1].x>17 && Math.abs(path[0].y-path[1].y)<0.001);
  assert.ok(fullFlow,'active pump draws a non-zero flow pulse from its inlet to its outlet');
}

{
  const normal=pumpCanvasRecorder();
  const intake=pumpCanvasRecorder();
  const conn={left:true,right:true,up:false,down:false};
  pumps.drawPipeTile(normal,20,0,0,conn,7,'normal');
  pumps.drawPipeTile(intake,20,0,0,conn,7,'intake');
  assert.ok(intake.strokes.length>normal.strokes.length,'water intake pipe draws an additional high-contrast grate and inward arrows');
}

for(const [dir,axis,sign] of [['east','x',1],['south','y',1],['west','x',-1],['north','y',-1]]){
  const ctx=pumpCanvasRecorder();
  pumps.drawPumpTile(ctx,20,0,0,dir,0,0,0);
  const indicator=ctx.strokes.at(-1);
  assert.ok(indicator && indicator.length>=2,dir+' pump draws its permanent direction arrow');
  assert.ok((indicator[1][axis]-indicator[0][axis])*sign>0,dir+' pump arrow points toward its configured outlet');
}

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
  setTile(0,10,T.WATER_PUMP);
  placeDynamo(-4,10);
  setTile(-2,10,T.COPPER_WIRE);
  setTile(-1,10,T.COPPER_WIRE);
  chargeDynamo(-4,10);
  const beforeDynamo=dynamo.metrics().storedEnergy;
  assert.equal(pumps.catchUp(30,null,getTile,setTile,{dynamo,teleporters}),true,'pump catch-up charges its battery through copper wires');
  assert.ok(pumps.metrics().storedEnergy>0,'pump catch-up stores offscreen network energy');
  assert.ok(dynamo.metrics().storedEnergy<beforeDynamo,'pump catch-up drains the connected power source');
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
  assert.equal(getTile(-3,10),T.AIR,'powered pump conserves water by draining the source tile it transferred');
}


{
  reset();
  setTile(0,9,T.WATER);
  for(let y=10;y<=19;y++) setTile(0,y,T.WATER_PIPE);
  setTile(0,21,T.WATER);
  pumps.setPipeModeAt(0,19,'intake',getTile);
  for(let i=0;i<120;i++) tick(1/30,{x:0.5,y:15.5});
  assert.equal(getTile(0,9),T.WATER,'wet designated lower intake prevents an unmarked upper end from becoming the source');
  assert.equal(getTile(0,21),T.WATER,'designated intake is source-only and never used as a discharge outlet');
  pumps.setPipeModeAt(0,19,'normal',getTile);
  for(let i=0;i<120;i++) tick(1/30,{x:0.5,y:15.5});
  assert.equal(getTile(0,9),T.AIR,'ordinary unmarked pipe ending still catches water automatically');
  assert.equal(getTile(0,20),T.WATER,'automatic endpoint sends that water to the lower end of the pipe');
}

{
  reset();
  for(let y=40;y<=49;y++) setTile(-4,y,T.WATER);
  for(let x=-3;x<=0;x++) setTile(x,49,T.WATER_PIPE);
  for(let y=50;y<=60;y++) setTile(0,y,T.WATER_PIPE);
  for(let i=0;i<30;i++) tick(1/30,{x:0.5,y:54.5});
  const moved=pumps.metrics().passiveMoved;
  assert.ok(moved>0,'large passive component begins moving water without duplicate seed acceleration');
  assert.ok(moved<=4,'one passive pipe component respects its roughly 3.2-cell-per-second flow rate regardless of how many of its tiles were queued');
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
  setTile(0,10,T.WATER_PUMP);
  setTile(1,10,T.WATER_PIPE);
  pumps.restore({v:2,list:[{x:0,y:10,dir:'east',energy:pumps._debug.PUMP_CAPACITY,water:0.25}],inlets:[]},getTile);
  for(let i=0;i<30;i++) tick(1/30);
  assert.equal(getTile(2,10),T.AIR,'a fractional internal buffer is reserved once and cannot be recounted each frame into a full output tile');
  assert.equal(pumps.metrics().outletMoved,0,'sub-tile water volume never reports a whole-cell discharge');
  assert.ok(pumps.snapshot().list.some(row=>Math.abs(row.water-0.25)<0.001),'blocked fractional water remains conserved inside the pump');
}

{
  reset();
  assert.ok(WORLD_MIN_Y<0 && WORLD_MAX_Y>WORLD_H,'pump tests cover extended vertical sections');
  setTile(-2,-20,T.WATER);
  setTile(-1,-20,T.WATER_PIPE);
  setTile(0,-20,T.WATER_PUMP);
  pumps.setOrientationAt(0,-20,'east',getTile);
  setTile(1,-20,T.WATER_PIPE);
  pumps._debug.debugSetEnergyAt(0,-20,pumps._debug.PUMP_CAPACITY,getTile);
  for(let i=0;i<90;i++) tick(1/30,{x:0.5,y:-20.5,w:0.7,h:0.95,vx:0,vy:0});
  assert.equal(getTile(2,-20),T.WATER,'sky-layer pump spills water from an open output pipe');
  assert.ok(pumps.metrics().outletMoved>0,'sky-layer pump records open-end pipe discharge');
  const snap=pumps.snapshot();
  assert.ok(snap.list.some(m=>m.y<0),'pump snapshot preserves sky-layer machines');
  pumps.reset();
  pumps.restore(snap,getTile);
  assert.equal(pumps.orientationAt(0,-20,getTile),'east','pump restore rehydrates sky-layer orientation');
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
  setTile(-4,13,T.WATER);
  setTile(-3,12,T.WATER_PIPE);
  setTile(-2,11,T.WATER_PIPE);
  setTile(-1,10,T.WATER_PIPE);
  setTile(0,10,T.WATER_PUMP);
  pumps.setOrientationAt(0,10,'east',getTile);
  setTile(1,10,T.WATER_PIPE);
  setTile(2,11,T.WATER_PIPE);
  setTile(3,12,T.WATER_PIPE);
  setTile(4,13,T.WATER_TURRET);
  turrets._debug.debugSetWaterAt(4,13,0,getTile);
  pumps._debug.debugSetEnergyAt(0,10,pumps._debug.PUMP_CAPACITY,getTile);
  const diagonal=pumps.pipeConnections(2,11,getTile);
  assert.equal(diagonal.upLeft,true,'fluid pipe detects its upper-left diagonal neighbour');
  assert.equal(diagonal.downRight,true,'fluid pipe detects its lower-right diagonal neighbour');
  for(let i=0;i<120;i++) tick(1/30);
  assert.ok(turrets.metrics().storedWater>0,'powered pump transfers water through diagonal input and output pipe runs');
}

{
  reset();
  setTile(0,20,T.STEAM);
  for(let y=16; y<=19; y++) setTile(0,y,T.WATER_PIPE);
  for(let i=0;i<90;i++) tick(1/30);
  assert.equal(getTile(0,20),T.AIR,'passive pipe chimney consumes gas from the lower intake');
  assert.equal(getTile(0,15),T.STEAM,'passive pipe chimney releases gas at the higher outlet');
  assert.ok(pumps.metrics().passiveGasMoved>0,'passive gas transfers are reported separately from water transfers');
  assert.equal(gases.metrics().steam,1,'transferred steam remains in the active gas registry');
}

{
  reset();
  setTile(0,15,T.POISON_GAS);
  for(let y=16; y<=19; y++) setTile(0,y,T.WATER_PIPE);
  for(let i=0;i<120;i++) tick(1/30);
  assert.equal(getTile(0,15),T.POISON_GAS,'passive gas pipes do not move gas downward against buoyancy');
  assert.equal(getTile(0,20),T.AIR,'lower outlet stays empty without pump pressure');
  assert.equal(pumps.metrics().passiveGasMoved,0,'downward passive gas transfer is rejected');
}

{
  reset();
  setTile(-3,8,T.POISON_GAS);
  setTile(-2,8,T.WATER_PIPE);
  setTile(-1,8,T.WATER_PIPE);
  setTile(0,8,T.WATER_PUMP);
  pumps.setOrientationAt(0,8,'east',getTile);
  setTile(1,8,T.WATER_PIPE);
  setTile(1,9,T.WATER_PIPE);
  setTile(1,10,T.WATER_PIPE);
  pumps._debug.debugSetEnergyAt(0,8,pumps._debug.PUMP_CAPACITY,getTile);
  for(let i=0;i<120;i++) tick(1/30);
  assert.equal(getTile(-3,8),T.AIR,'powered pump consumes gas from its directional input network');
  assert.equal(getTile(1,11),T.POISON_GAS,'powered pump can force gas to a lower outlet regardless of buoyancy');
  assert.ok(pumps.metrics().gasMoved>0,'powered gas pump transfers are reported');
  assert.ok(pumps.metrics().storedEnergy<pumps._debug.PUMP_CAPACITY,'pumping gas consumes pump battery energy');
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
  setTile(0,10,T.WATER_PUMP);
  const oversized=new Array(pumps._debug.MACHINE_CAP+1).fill(null);
  oversized[pumps._debug.MACHINE_CAP]={x:0,y:10,dir:'south',energy:20,water:1};
  pumps.restore({v:2,list:oversized,inlets:[]},getTile);
  assert.equal(pumps.metrics().machines,0,'pump restore bounds scanned machine rows even when all preceding entries are invalid');
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
assert.match(mainSrc, /PUMPS\.update\(dt, player, getFluidNetworkTile, setTile, \{dynamo:DYNAMO, teleporters:TELEPORTERS\}\)/, 'main updates pumps before turrets with overlay-aware pipe networks');
assert.match(mainSrc, /PUMPS\.draw\(ctx,TILE,sx,sy,viewX,viewY,worldFxVisible,getFluidNetworkTile\)/, 'main draws pump overlays and pipe flow FX through infrastructure overlays');
assert.match(mainSrc, /id:'water_pipe'/, 'crafting exposes water pipes');
assert.match(mainSrc, /id:'water_pump'/, 'crafting exposes water pumps');
assert.match(mainSrc, /function tryRotateWaterPumpAt\(tx,ty\)[\s\S]*?PUMPS\.orientationAt\(tx,ty,getTile\)[\s\S]*?PUMPS\.rotateDir\(previous\)[\s\S]*?PUMPS\.setOrientationAt\(tx,ty,next,getTile\)/, 'main rotates a placed pump from its persisted orientation');
assert.match(mainSrc, /function tryToggleFluidPipeModeAt\(tx,ty\)[\s\S]*?PUMPS\.togglePipeModeAt\(tx,ty,getFluidNetworkTile\)/, 'main toggles ordinary and water-intake pipe modes with the persisted pump API');
assert.match(mainSrc, /function useToolSecondaryAt\(tx,ty\)\{\s*if\(tryRotateWaterPumpAt\(tx,ty\)\) return true;/, 'right-click tool interaction gives placed pump rotation priority over placement');
assert.match(mainSrc, /else if\(e\.button===2\)[\s\S]*?if\(tryRotateWaterPumpAt\(tx,ty\)\) return;[\s\S]*?if\(weaponMode\)/, 'right-click rotates a targeted pump even while a weapon is equipped');
assert.match(mainSrc, /if\(tryToggleFluidPipeModeAt\(tx,ty\)\) return;[\s\S]*?if\(weaponMode\)/, 'right-click toggles a targeted pipe even while a weapon is equipped');
assert.match(mainSrc, /PPM na pompie obraca ją w świecie/, 'pump hotbar help documents right-click rotation');
assert.match(mainSrc, /function placeDebugPumpRig\(\)/, 'main exposes a complete pump debug rig');
assert.match(mainSrc, /MM\.ui\.injectPumpDebugPanel/, 'main injects the pump debug panel');

const uiSrc = await readFile(new URL('../src/engine/ui.js', import.meta.url), 'utf8');
assert.match(uiSrc, /function injectPumpDebugPanel\(actions, menuPanel\)/, 'ui exposes a pump debug panel injector');
assert.match(uiSrc, /box\.id='pumpDebugBox'/, 'pump debug panel has a stable DOM id');
assert.match(uiSrc, /Uklad testowy/, 'pump debug panel includes a full rig button');

const worldSrc = await readFile(new URL('../src/engine/world.js', import.meta.url), 'utf8');
assert.match(worldSrc, /MM\.pumps && MM\.pumps\.onTileChanged/, 'world lifecycle notifies pumps about tile changes');

console.log('pumps-sim: all assertions passed');
