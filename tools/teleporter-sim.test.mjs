// Regression tests for teleporters and copper cable energy networks.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
const { T, INFO, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } = await import('../src/constants.js');
const { dynamo } = await import('../src/engine/dynamo.js');
const { teleporters } = await import('../src/engine/teleporters.js');

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
}
function reset(){
  tiles.clear();
  dynamo.reset();
  teleporters.reset();
  globalThis.MM.world={getTile,setTile};
}
function placeDynamo(cx,y,orientation='horizontal'){
  dynamo.plannedCells(cx,y,orientation).forEach(cell=>setTile(cell.x,cell.y,cell.t));
}
function chargeDynamo(cx,y){
  for(let i=0; i<80; i++) dynamo.recordFlow(cx,y,T.WATER,4,getTile);
}
function tick(dt,player){
  teleporters.update(dt,player||null,getTile,setTile,{dynamo});
}

assert.equal(T.COPPER_WIRE,33,'copper wire has a stable tile id after cooked meat');
assert.equal(T.TELEPORTER,34,'teleporter has a stable tile id after copper wire');
assert.equal(INFO[T.TELEPORTER].passable,true,'teleporter can be entered by the hero');
assert.equal(INFO[T.COPPER_WIRE].passable,true,'copper cables do not block movement');
assert.equal(INFO[T.SILVER_WIRE].passable,true,'silver cables do not block movement');
assert.equal(INFO[T.SILVER_WIRE].conductivity,1,'silver cables retain the full generated energy');
assert.equal(INFO[T.COPPER_WIRE].conductivity,0.5,'copper cables deliver half of generated energy');
assert.equal(INFO[T.TELEPORTER].powerDevice,true,'teleporter is a powered device endpoint');
assert.equal(INFO[T.DYNAMO].powerSource,true,'dynamo is a cable power source endpoint');

{
  reset();
  setTile(0,10,T.TELEPORTER);
  setTile(12,10,T.TELEPORTER);
  placeDynamo(-4,10);
  setTile(-2,10,T.COPPER_WIRE);
  setTile(-1,10,T.COPPER_WIRE);
  chargeDynamo(-4,10);
  assert.ok(teleporters.connectedDynamosAt(0,10,getTile).length===1,'teleporter network exposes connected dynamo slots for future devices');
  assert.ok(teleporters.availableNetworkEnergyAt(0,10,getTile,dynamo)>0,'teleporter network exposes available dynamo energy');
  const beforeDynamo=dynamo.metrics().storedEnergy;
  tick(1.0,null);
  tick(1.0,null);
  const tm=teleporters.metrics();
  assert.ok(tm.storedEnergy>=teleporters._debug.TRAVEL_COST,'teleporter battery charges from a linked dynamo through copper wires');
  assert.ok(tm.poweredWires>0,'copper wires that carry energy are marked for powered sparkle rendering');
  assert.ok(dynamo.metrics().storedEnergy<beforeDynamo,'charging teleporter drains real stored dynamo energy');
  const net=teleporters._debug.networkFor(0,10,getTile);
  assert.equal(net.cables.length,2,'teleporter power networks retain cable cells for flow visuals');

  const player={x:0.5,y:10.5,w:0.7,h:0.95,vx:3,vy:0,energy:0,maxEnergy:80};
  tick(0.05,player);
  assert.ok(player.x>12,'entering a teleporter while moving right jumps to the nearest teleporter on the right');
  assert.equal(player.energy,0,'stored teleporter/dynamo energy is spent before hero energy');

  player.x=12.5; player.y=10.5; player.vx=0; player._teleporterCooldown=0;
  tick(1.0,player);
  teleporters._debug.debugCharge(12,10,teleporters._debug.TRAVEL_COST,getTile);
  player.vx=-3;
  tick(0.05,player);
  assert.ok(player.x<0.5,'entering a teleporter while moving left jumps to the closest teleporter on the left');
}

{
  reset();
  setTile(0,10,T.TELEPORTER);
  placeDynamo(-4,10);
  setTile(-2,10,T.COPPER_WIRE);
  setTile(-1,10,T.COPPER_WIRE);
  chargeDynamo(-4,10);
  const beforeDynamo=dynamo.metrics().storedEnergy;
  assert.equal(teleporters.catchUp(30,null,getTile,setTile,{dynamo}),true,'teleporter catch-up charges batteries through copper wires');
  assert.ok(teleporters.metrics().storedEnergy>0,'teleporter catch-up stores network energy while offscreen');
  assert.ok(dynamo.metrics().storedEnergy<beforeDynamo,'teleporter catch-up drains the real connected power source');
}

{
  reset();
  setTile(0,10,T.TELEPORTER);
  const farPlayer={x:200,y:200,w:0.7,h:0.95,vx:0,vy:0,energy:0};
  const machine=teleporters._debug.machines.get('0,10');
  tick(0.01,farPlayer); // discovers once that this endpoint has no source
  machine.cooldown=0.8;
  machine.pulse=1;
  tick(0.25,farPlayer);
  tick(0.25,farPlayer);
  tick(0.25,farPlayer);
  assert.ok(Math.abs(machine.cooldown-0.05)<0.002,'cheap distant cooldown state remains frame-accurate while validation sleeps');
  tick(0.24,farPlayer);
  assert.equal(machine.cooldown,0,'remote cooldown integrates the complete elapsed time');
  assert.equal(machine.pulse,0,'remote pulse decay integrates the complete elapsed time');
}

{
  reset();
  setTile(0,9,T.TELEPORTER);
  setTile(0,11,T.TELEPORTER);
  placeDynamo(-4,10);
  setTile(-2,10,T.COPPER_WIRE);
  setTile(-1,10,T.COPPER_WIRE);
  chargeDynamo(-4,10);
  for(const machine of dynamo._debug.machines.values()) machine.energy=10;
  const farPlayer={x:200,y:200,w:0.7,h:0.95,vx:0,vy:0,energy:0};
  tick(0.25,farPlayer);
  const upper=teleporters._debug.machines.get('0,9');
  const lower=teleporters._debug.machines.get('0,11');
  assert.ok(Math.abs(upper.energy-2.5)<0.002 && Math.abs(lower.energy-2.5)<0.002,'charging distant peers remain in every scarce-power frame and split it fairly');
}

{
  reset();
  setTile(0,10,T.TELEPORTER);
  placeDynamo(-4,10);
  setTile(-2,10,T.COPPER_WIRE);
  setTile(-1,10,T.COPPER_WIRE);
  chargeDynamo(-4,10);
  const nearbyPlayer={x:0.5,y:10.5,w:0.7,h:0.95,vx:0,vy:0,energy:0};
  tick(0.1,nearbyPlayer);
  assert.ok(Math.abs(teleporters._debug.machines.get('0,10').energy-teleporters._debug.CHARGE_RATE*0.1)<0.002,'nearby teleporters remain frame-accurate below the remote cadence interval');
}

{
  reset();
  setTile(0,10,T.TELEPORTER);
  placeDynamo(-4,10);
  setTile(-2,10,T.COPPER_WIRE);
  setTile(-1,10,T.COPPER_WIRE);
  chargeDynamo(-4,10);
  const player={x:0.5,y:10.5,w:0.7,h:0.95,vx:0,vy:0,energy:0};
  tick(0.75,player);
  const machine=teleporters._debug.machines.get('0,10');
  assert.ok(Math.abs(machine.energy-teleporters._debug.CHARGE_RATE*0.75)<0.002,'nearby time is integrated once before a range transition');
  player.x=200;
  player.y=200;
  tick(0.25,player);
  assert.ok(Math.abs(machine.energy-teleporters._debug.CHARGE_RATE)<0.002,'nearby-to-remote transition does not reapply the shared cadence history');
}

{
  reset();
  setTile(0,10,T.TELEPORTER);
  placeDynamo(-4,10);
  setTile(-2,10,T.COPPER_WIRE);
  setTile(-1,10,T.COPPER_WIRE);
  chargeDynamo(-4,10);
  const farPlayer={x:200,y:200,w:0.7,h:0.95,vx:0,vy:0,energy:0};
  teleporters._debug.debugSetEnergy(0,10,teleporters._debug.TELEPORTER_CAPACITY,getTile);
  tick(0.25,farPlayer);
  teleporters._debug.debugSetEnergy(0,10,150,getTile);
  tick(0.1,farPlayer);
  const energy=teleporters._debug.machines.get('0,10').energy;
  assert.ok(Math.abs(energy-(150+teleporters._debug.CHARGE_RATE*0.1))<0.002,'a full remote battery spent between cadence ticks only recharges for the subsequent real frame time');
}

function rangeFairnessSample(playerX){
  reset();
  setTile(0,10,T.TELEPORTER);
  setTile(80,10,T.TELEPORTER);
  placeDynamo(-4,10);
  setTile(-2,10,T.SILVER_WIRE);
  setTile(-1,10,T.SILVER_WIRE);
  for(let x=0;x<=80;x++) setTile(x,11,T.SILVER_WIRE);
  chargeDynamo(-4,10);
  for(const machine of dynamo._debug.machines.values()) machine.energy=4;
  tick(0.1,{x:playerX,y:10.5,w:0.7,h:0.95,vx:0,vy:0,energy:0});
  return [teleporters._debug.machines.get('0,10').energy,teleporters._debug.machines.get('80,10').energy];
}
{
  const allNear=rangeFairnessSample(40.5);
  const mixedRange=rangeFairnessSample(0.5);
  assert.ok(allNear.every(energy=>Math.abs(energy-2)<0.002),'scarce source splits evenly when both endpoints are nearby');
  assert.ok(mixedRange.every((energy,index)=>Math.abs(energy-allNear[index])<0.002),'mixed near/far endpoints preserve the same scarce-source allocation as all-near peers');
}

{
  reset();
  setTile(0,10,T.TELEPORTER);
  const farPlayer={x:200,y:200,w:0.7,h:0.95,vx:0,vy:0,energy:0};
  tick(0.2,farPlayer);
  tiles.delete(k(0,10)); // bypass topology notifications like a low-level restore
  tick(0.2,farPlayer);
  assert.equal(teleporters.metrics().machines,1,'a raw distant removal may wait for the bounded remote validation cadence');
  let waited=0.2;
  while(teleporters.metrics().machines && waited<teleporters._debug.REMOTE_UPDATE_INTERVAL+0.05){
    tick(0.05,farPlayer);
    waited+=0.05;
  }
  assert.equal(teleporters.metrics().machines,0,'the next bounded remote validation removes an invalid teleporter');
  assert.ok(waited<=teleporters._debug.REMOTE_UPDATE_INTERVAL+0.051,'raw removals are discovered within one staggered validation interval');

  setTile(0,10,T.TELEPORTER);
  setTile(0,10,T.AIR);
  assert.equal(teleporters.metrics().machines,0,'normal topology notifications remove distant teleporters immediately');
}

{
  reset();
  const endpointKeys=new Set();
  const count=240;
  for(let i=0;i<count;i++){
    const x=i*3;
    endpointKeys.add(k(x,10));
    setTile(x,10,T.TELEPORTER);
  }
  const covered=new Set();
  const farPlayer={x:-10000,y:200,w:0.7,h:0.95,vx:0,vy:0,energy:0};
  let maxValidated=0;
  for(let frame=0;frame<23;frame++){
    const validated=new Set();
    const countingGetTile=(x,y)=>{
      const id=k(x,y);
      if(endpointKeys.has(id)) validated.add(id);
      return getTile(x,y);
    };
    teleporters.update(0.05,farPlayer,countingGetTile,setTile,{dynamo});
    maxValidated=Math.max(maxValidated,validated.size);
    for(const id of validated) covered.add(id);
  }
  assert.ok(maxValidated<=teleporters._debug.REMOTE_VALIDATION_MAX_PER_UPDATE,'remote validation never exceeds its hard per-update endpoint budget');
  assert.equal(covered.size,count,'the staggered remote schedule covers every source-less endpoint within approximately one second');
}

{
  reset();
  setTile(0,10,T.TELEPORTER);
  placeDynamo(-4,10);
  setTile(-2,10,T.COPPER_WIRE);
  setTile(-1,10,T.COPPER_WIRE);
  chargeDynamo(-4,10);
  const stopped={energy:0};
  assert.equal(teleporters.chargeBatteryAt(0,10,stopped,1,getTile,dynamo,{capacity:50,rate:0}),0,'an explicit zero charge rate never falls back to the default rate');
  assert.equal(teleporters.chargeBatteryAt(0,10,stopped,1,getTile,dynamo,{capacity:0,rate:20}),0,'an explicit zero-capacity battery cannot draw network energy');
  const corrupted={energy:Number.POSITIVE_INFINITY};
  assert.equal(teleporters.chargeBatteryAt(0,10,corrupted,1,getTile,dynamo,{capacity:50,rate:0}),0,'non-finite battery state cannot request energy');
  assert.equal(corrupted.energy,0,'generic charging normalizes a non-finite battery state even without a transfer');
  const battery={energy:0};
  const gained=teleporters.chargeBatteryAt(0,10,battery,1,getTile,dynamo,{capacity:50,rate:20});
  assert.ok(gained>0 && battery.energy>0,'generic power devices can charge a local battery through copper wires');
  assert.ok(teleporters.metrics().poweredWires>0,'generic network drains also animate powered wires');
  assert.ok([...teleporters._debug.wireActivity.values()].some(flow=>(flow.flowX||0)>0.01 && Math.abs(flow.flowY||0)<0.01),'powered cable records the real source-to-device flow direction');
  const drained=teleporters.drainNetworkEnergyAt(0,10,5,getTile,dynamo);
  assert.ok(drained>0,'generic power devices can drain network energy directly');
  dynamo.reset();
  tick(1.0,null);
  assert.equal(teleporters.metrics().poweredWires,0,'powered wire sparkle state decays when energy stops flowing');
}

{
  reset();
  setTile(0,10,T.TELEPORTER);
  placeDynamo(-4,10);
  setTile(-2,10,T.COPPER_WIRE);
  setTile(-1,10,T.COPPER_WIRE);
  chargeDynamo(-4,10);
  assert.ok(teleporters.availableNetworkEnergyAt(0,10,getTile,dynamo)>0,'test network starts powered before raw cable mutation');
  tiles.delete(k(-1,10)); // simulate a low-level terrain load/restore mutation without onTileChanged hooks
  assert.equal(teleporters.availableNetworkEnergyAt(0,10,getTile,dynamo),0,'teleporter network cache self-invalidates when a cached cable disappears');
  const battery={energy:0};
  assert.equal(teleporters.chargeBatteryAt(0,10,battery,1,getTile,dynamo,{capacity:50,rate:20}),0,'stale cached cable paths cannot charge devices after raw terrain changes');
}

{
  reset();
  setTile(30,10,T.TELEPORTER);
  setTile(40,10,T.TELEPORTER);
  const player={x:30.5,y:10.5,w:0.7,h:0.95,vx:3,vy:0,energy:80,maxEnergy:80};
  tick(0.05,player);
  assert.ok(player.x>40,'teleporter can fall back to hero energy when no device battery or dynamo is available');
  assert.equal(Math.round(player.energy),80-teleporters._debug.TRAVEL_COST,'hero energy pays the travel cost only as fallback');
}

{
  reset();
  assert.ok(WORLD_MIN_Y<0 && WORLD_MAX_Y>WORLD_H,'teleporter tests cover extended vertical sections');
  setTile(30,-24,T.TELEPORTER);
  setTile(42,-18,T.TELEPORTER);
  const player={x:30.5,y:-23.5,w:0.7,h:0.95,vx:3,vy:0,energy:80,maxEnergy:80};
  tick(0.05,player);
  assert.ok(player.x>42,'sky-layer teleporter can jump to a target on the right');
  assert.ok(player.y<0,'sky-layer teleporter keeps the hero in the sky section');
  assert.equal(Math.round(player.energy),80-teleporters._debug.TRAVEL_COST,'sky-layer teleporter can use hero energy fallback');
  teleporters._debug.debugCharge(42,-18,teleporters._debug.TRAVEL_COST,getTile);
  player.x=42.5; player.y=-17.5; player.vx=0; player.energy=0; player._teleporterCooldown=0;
  tick(1.0,player);
  player.vx=-3;
  tick(0.05,player);
  assert.ok(player.x<31,'charged sky-layer teleporter can jump back left without hero energy');
}

{
  reset();
  setTile(0,10,T.TELEPORTER);
  setTile(8,10,T.TELEPORTER);
  const player={x:0.5,y:10.5,w:0.7,h:0.95,vx:3,vy:0,energy:0,maxEnergy:80};
  tick(0.05,player);
  assert.ok(Math.abs(player.x-0.5)<0.001,'drained teleporter refuses travel if the hero has no energy');
}

{
  reset();
  setTile(0,10,T.TELEPORTER);
  setTile(8,10,T.TELEPORTER);
  for(let dx=-3; dx<=3; dx++){
    setTile(dx,8,T.UFO_CONCRETE);
    setTile(dx,12,T.UFO_CONCRETE);
  }
  for(let dy=8; dy<=12; dy++){
    setTile(-3,dy,T.UFO_CONCRETE);
    setTile(3,dy,T.UFO_CONCRETE);
  }
  assert.equal(teleporters._debug.isAlienBunkerTeleporter(0,10,getTile), true, 'sealed UFO-concrete teleporter is recognized as an alien bunker exit point');
  assert.equal(teleporters._debug.isAlienBunkerTeleporter(8,10,getTile), false, 'outside teleporter is not considered a bunker');
  const player={x:0.5,y:10.5,w:0.7,h:0.95,vx:3,vy:0,energy:0,maxEnergy:80};
  tick(0.05,player);
  assert.ok(player.x>8, 'drained hero can use an emergency outbound teleport from a sealed alien bunker');
  assert.equal(player.energy,0, 'bunker failsafe does not create hero energy');
}

{
  reset();
  setTile(5,5,T.COPPER_WIRE);
  setTile(4,5,T.COPPER_WIRE);
  setTile(6,5,T.TELEPORTER);
  setTile(5,4,T.COPPER_WIRE);
  setTile(5,6,T.DYNAMO_SLOT);
  const c=teleporters.cableConnections(5,5,getTile);
  assert.deepEqual(c,{left:true,right:true,up:true,down:true,upLeft:false,upRight:false,downLeft:false,downRight:false},'copper cable layout exposes crossroads for smart rendering');
}

{
  reset();
  setTile(5,5,T.COPPER_WIRE);
  setTile(6,5,T.COPPER_WIRE);
  setTile(6,6,T.SILVER_WIRE);
  const start=teleporters.cableConnections(5,5,getTile);
  const end=teleporters.cableConnections(6,6,getTile);
  assert.equal(start.right,true,'an orthogonal cable segment remains visible');
  assert.equal(start.downRight,false,'a redundant diagonal is omitted when an orthogonal corner already connects its endpoints');
  assert.equal(end.upLeft,false,'redundant diagonal suppression is symmetric at both endpoints');
}

{
  reset();
  setTile(5,5,T.COPPER_WIRE);
  setTile(6,6,T.SILVER_WIRE);
  const isolated=teleporters.cableConnections(5,5,getTile);
  assert.equal(isolated.downRight,true,'a diagonal remains visible when it is the simplest available connection');
}

{
  reset();
  setTile(0,9,T.TELEPORTER);
  setTile(0,11,T.TELEPORTER);
  placeDynamo(-4,10);
  setTile(-2,10,T.COPPER_WIRE);
  setTile(-1,10,T.COPPER_WIRE);
  chargeDynamo(-4,10);
  for(const machine of dynamo._debug.machines.values()) machine.energy=10;
  const upper={energy:0}, lower={energy:0};
  teleporters.beginPowerFrame();
  teleporters.registerPowerDemandAt(0,9,10,getTile,dynamo);
  teleporters.registerPowerDemandAt(0,11,10,getTile,dynamo);
  const first=teleporters.chargeBatteryAt(0,9,upper,1,getTile,dynamo,{capacity:20,rate:10});
  const second=teleporters.chargeBatteryAt(0,11,lower,1,getTile,dynamo,{capacity:20,rate:10});
  assert.ok(Math.abs(first-2.5)<0.001 && Math.abs(second-2.5)<0.001,'a lossy copper network splits useful energy evenly instead of favoring the device updated first');
  assert.ok(Math.abs(upper.energy-lower.energy)<0.001,'fair network allocation is independent of device position along the cable');
  assert.ok(dynamo.metrics().storedEnergy<0.001,'fair shares account for all energy actually removed from the source');
}

{
  reset();
  setTile(0,9,T.TELEPORTER);
  setTile(0,11,T.TELEPORTER);
  placeDynamo(-4,10);
  setTile(-2,10,T.SILVER_WIRE);
  setTile(-1,10,T.SILVER_WIRE);
  chargeDynamo(-4,10);
  for(const machine of dynamo._debug.machines.values()) machine.energy=10;
  const upper={energy:0}, lower={energy:0};
  teleporters.beginPowerFrame();
  teleporters.registerPowerDemandAt(0,9,10,getTile,dynamo);
  teleporters.registerPowerDemandAt(0,11,10,getTile,dynamo);
  const first=teleporters.chargeBatteryAt(0,9,upper,1,getTile,dynamo,{capacity:20,rate:10});
  const second=teleporters.chargeBatteryAt(0,11,lower,1,getTile,dynamo,{capacity:20,rate:10});
  assert.ok(Math.abs(first-5)<0.001 && Math.abs(second-5)<0.001,'silver delivers twice the useful energy of copper while preserving fair allocation');
  assert.ok(Math.abs(upper.energy-lower.energy)<0.001,'silver network allocation is independent of consumer position');
}

function runMixedFairness(order){
  reset();
  placeDynamo(-4,10);
  setTile(-2,10,T.SILVER_WIRE);
  setTile(-1,9,T.SILVER_WIRE);
  setTile(0,8,T.SILVER_WIRE);
  setTile(1,7,T.TELEPORTER);
  setTile(0,10,T.COPPER_WIRE);
  setTile(1,11,T.COPPER_WIRE);
  setTile(2,12,T.TELEPORTER);
  chargeDynamo(-4,10);
  for(const machine of dynamo._debug.machines.values()) machine.energy=10;
  const batteries={silver:{energy:0},copper:{energy:0}};
  teleporters.beginPowerFrame();
  teleporters.registerPowerDemandAt(1,7,10,getTile,dynamo);
  teleporters.registerPowerDemandAt(2,12,10,getTile,dynamo);
  const targets={silver:[1,7],copper:[2,12]};
  for(const id of order){
    const [x,y]=targets[id];
    teleporters.chargeBatteryAt(x,y,batteries[id],1,getTile,dynamo,{capacity:20,rate:10});
  }
  return {silver:batteries.silver.energy,copper:batteries.copper.energy,left:dynamo.metrics().storedEnergy};
}
{
  const silverFirst=runMixedFairness(['silver','copper']);
  const copperFirst=runMixedFairness(['copper','silver']);
  const fair=10/3;
  assert.ok(Math.abs(silverFirst.silver-fair)<0.002 && Math.abs(silverFirst.copper-fair)<0.002,'mixed silver/copper branches split delivered energy fairly after accounting for path loss');
  assert.deepEqual(copperFirst,silverFirst,'mixed-network allocation is independent of which material consumer updates first');
  assert.ok(silverFirst.left<0.002,'mixed-network fair allocation consumes the complete usable source reserve');
}

{
  reset();
  setTile(0,9,T.TELEPORTER);
  setTile(0,11,T.METEOR_SIREN);
  placeDynamo(-4,10);
  setTile(-2,10,T.COPPER_WIRE);
  setTile(-1,10,T.COPPER_WIRE);
  chargeDynamo(-4,10);
  for(const machine of dynamo._debug.machines.values()) machine.energy=10;
  const active={energy:0};
  teleporters.beginPowerFrame();
  const gained=teleporters.chargeBatteryAt(0,9,active,1,getTile,dynamo,{capacity:20,rate:10});
  assert.ok(Math.abs(gained-5)<0.001,'an idle event-driven endpoint never reserves a phantom fair share');
  assert.ok(dynamo.metrics().storedEnergy<0.001,'energy no longer remains stranded behind an idle endpoint');
}

{
  reset();
  placeDynamo(-4,10);
  placeDynamo(4,10);
  for(let x=-2;x<=2;x++) setTile(x,10,T.SILVER_WIRE);
  setTile(0,9,T.TELEPORTER);
  chargeDynamo(-4,10);
  chargeDynamo(4,10);
  for(const machine of dynamo._debug.machines.values()) machine.energy=10;
  teleporters.beginPowerFrame();
  teleporters.registerPowerDemandAt(0,9,5,getTile,dynamo);
  const got=teleporters.drainNetworkEnergyAt(0,9,5,getTile,dynamo,{fair:true});
  assert.ok(Math.abs(got-5)<0.001,'a multi-generator network supplies the requested useful energy');
  const left=[...dynamo._debug.machines.values()].map(machine=>machine.energy);
  assert.ok(left.length===2 && Math.abs(left[0]-7.5)<0.001 && Math.abs(left[1]-7.5)<0.001,'identical generators share network load evenly');
}

{
  reset();
  setTile(0,10,T.TELEPORTER);
  placeDynamo(-4,10);
  setTile(-2,10,T.COPPER_WIRE);
  setTile(-1,10,T.COPPER_WIRE);
  setTile(-1,11,T.COPPER_WIRE);
  setTile(-1,12,T.COPPER_WIRE); // connected dead branch: no load uses this tail
  chargeDynamo(-4,10);
  const hotAir=[];
  globalThis.MM.gases={add(type,x,y){ if(type==='hot') hotAir.push({x,y}); return 1; }};
  const battery={energy:0};
  teleporters.chargeBatteryAt(0,10,battery,1,getTile,dynamo,{capacity:100,rate:30,fair:false});
  assert.ok(hotAir.length>=1,'sustained copper transmission periodically vents lost energy as hot air');
  assert.ok(hotAir.every(cell=>cell.y<11.5),'copper loss heat stays on the route that actually supplied the load, not a dead branch');
  assert.equal(teleporters._debug.wireActivity.has('-1,12'),false,'flow arrows stay off an electrically idle branch');
  assert.ok(teleporters.metrics().copperHeatEvents>=1,'copper heat events are observable in hardened runtime metrics');
}

{
  reset();
  placeDynamo(-4,10);
  setTile(-2,11,T.COPPER_WIRE);
  setTile(-1,12,T.COPPER_WIRE);
  setTile(0,13,T.TELEPORTER);
  chargeDynamo(-4,10);
  const diagonal=teleporters.cableConnections(-1,12,getTile);
  assert.equal(diagonal.upLeft,true,'copper cable detects its upper-left diagonal neighbour');
  assert.equal(diagonal.downRight,true,'copper cable detects a lower-right diagonal power device');
  const before=dynamo.metrics().storedEnergy;
  tick(1,null);
  assert.ok(teleporters.metrics().storedEnergy>0,'teleporter charges through a purely diagonal copper run');
  assert.ok(dynamo.metrics().storedEnergy<before,'diagonal copper run drains its connected dynamo');
}

{
  reset();
  setTile(2,8,T.TELEPORTER);
  teleporters._debug.debugCharge(2,8,77,getTile);
  const snap=teleporters.snapshot();
  assert.deepEqual(Object.keys(snap.list[0]).sort(),['energy','x','y'],'teleporter snapshots exclude transient cadence and network-cache bookkeeping');
  teleporters.reset();
  assert.equal(teleporters.metrics().machines,0,'reset clears teleporter battery state');
  teleporters.restore(snap,getTile);
  assert.equal(teleporters.metrics().machines,1,'restore rehydrates teleporter battery state');
  assert.equal(Math.round(teleporters.metrics().storedEnergy),77,'restore preserves stored teleporter energy');
}

{
  reset();
  setTile(2,8,T.TELEPORTER);
  const oversized=new Array(teleporters._debug.MACHINE_CAP+1).fill(null);
  oversized[teleporters._debug.MACHINE_CAP]={x:2,y:8,energy:77};
  teleporters.restore({v:1,list:oversized},getTile);
  assert.equal(teleporters.metrics().machines,0,'teleporter restore scans at most the persisted machine cap when rows are invalid');
}

{
  reset();
  setTile(0,10,T.TELEPORTER);
  let reads=0;
  const countingGetTile=(x,y)=>{ reads++; return getTile(x,y); };
  assert.equal(teleporters.nearestTeleporter(0,10,1,countingGetTile), null, 'a lone teleporter has no travel target');
  const firstReads=reads;
  assert.ok(firstReads>100000, 'fallback nearest-teleporter discovery is broad enough to need caching');
  assert.equal(teleporters.nearestTeleporter(0,10,1,countingGetTile), null, 'cached lone-teleporter search keeps the same result');
  assert.ok(reads<firstReads+10, 'repeated nearest-teleporter search reuses the cached list');
  setTile(20,10,T.TELEPORTER);
  const target=teleporters.nearestTeleporter(0,10,1,countingGetTile);
  assert.deepEqual(target,{x:20,y:10}, 'placing a teleporter invalidates the cached nearest-target list');
}

const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
assert.match(mainSrc, /import \{ teleporters as TELEPORTERS \}/, 'main imports the teleporter engine');
assert.match(mainSrc, /TELEPORTERS\.update\(dt, player, getElectricNetworkTile, setTile, \{dynamo:DYNAMO, heroEnergy:MM\.heroEnergy\}\)/, 'main updates teleporters with overlay-aware dynamo and hero energy access');
assert.match(mainSrc, /TELEPORTERS\.beginPowerFrame\(\)/, 'main opens one shared fair-allocation frame before any electrical consumers update');
assert.match(mainSrc, /TELEPORTERS\.draw\(ctx,TILE,sx,sy,viewX,viewY,worldFxVisible,getElectricNetworkTile\)/, 'main draws teleporter energy overlays through infrastructure overlays');
assert.match(mainSrc, /TELEPORTERS\.cableConnections\(wx,y,peek\)/, 'main uses smart copper cable layouts without forcing neighbor chunks to generate');
assert.match(mainSrc, /function placeDebugTeleporterPair\(\)/, 'main exposes a debug action that places a powered teleporter pair');
assert.match(mainSrc, /function placeDebugTeleporterOne\(\)/, 'main exposes a debug action that places one teleporter');
assert.match(mainSrc, /function jumpDebugTeleporterLeft\(\)/, 'main exposes a debug action that jumps to the nearest left teleporter');
assert.match(mainSrc, /function jumpDebugTeleporterRight\(\)/, 'main exposes a debug action that jumps to the nearest right teleporter');
assert.match(mainSrc, /MM\.ui\.injectTeleporterDebugPanel/, 'main injects the teleporter debug panel');

const uiSrc = await readFile(new URL('../src/engine/ui.js', import.meta.url), 'utf8');
assert.match(uiSrc, /function injectTeleporterDebugPanel\(actions, menuPanel\)/, 'ui exposes a teleporter debug panel injector');
assert.match(uiSrc, /box\.id='teleporterDebugBox'/, 'teleporter debug panel has a stable DOM id');
assert.match(uiSrc, /Postaw pare/, 'teleporter debug panel includes a place-pair button');
assert.match(uiSrc, /Postaw jeden/, 'teleporter debug panel includes a place-one button');
assert.match(uiSrc, /Skocz w lewo/, 'teleporter debug panel includes a jump-left button');
assert.match(uiSrc, /Skocz w prawo/, 'teleporter debug panel includes a jump-right button');
assert.match(uiSrc, /Przewod \+20/, 'teleporter debug panel includes a copper-wire grant button');

console.log('teleporter-sim: all assertions passed');
