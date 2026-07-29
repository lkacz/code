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
  teleporters.setOrientationAt(0,10,'west',getTile);
  teleporters.setOrientationAt(12,10,'east',getTile);
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
  setTile(12,10,T.TELEPORTER);
  teleporters.setOrientationAt(0,10,'north',getTile);
  teleporters.setOrientationAt(12,10,'north',getTile);
  teleporters._debug.debugCharge(0,10,teleporters._debug.TRAVEL_COST,getTile);
  const player={x:0.5,y:10.5,w:0.7,h:0.95,vx:0,vy:13,energy:0,maxEnergy:80};
  const speedBefore=Math.hypot(player.vx,player.vy);
  tick(0.01,player);
  assert.ok(player.x>12 && player.y<10,'falling into an upward-facing teleporter exits above its upward-facing pair');
  assert.ok(Math.abs(player.vx)<1e-9 && Math.abs(player.vy+13)<1e-9,'a downward fall becomes an equally fast upward launch');
  assert.ok(Math.abs(Math.hypot(player.vx,player.vy)-speedBefore)<1e-9,'teleportation preserves the full velocity magnitude');
}

{
  reset();
  setTile(0,10,T.TELEPORTER);
  setTile(12,10,T.TELEPORTER);
  teleporters.setOrientationAt(0,10,'west',getTile);
  teleporters.setOrientationAt(12,10,'north',getTile);
  teleporters._debug.debugCharge(0,10,teleporters._debug.TRAVEL_COST,getTile);
  const player={x:0.5,y:10.5,w:0.7,h:0.95,vx:8,vy:3,energy:0,maxEnergy:80};
  tick(0.01,player);
  assert.deepEqual({vx:player.vx,vy:player.vy},{vx:3,vy:-8},'the complete velocity vector rotates from the entrance normal to the exit normal');
}

{
  reset();
  setTile(0,10,T.TELEPORTER);
  setTile(12,10,T.TELEPORTER);
  teleporters.setOrientationAt(0,10,'north',getTile);
  teleporters._debug.debugCharge(0,10,teleporters._debug.TRAVEL_COST,getTile);
  const player={x:0.5,y:10.5,w:0.7,h:0.95,vx:8,vy:0,energy:0,maxEnergy:80};
  tick(0.01,player);
  assert.equal(player.x,0.5,'a body moving across, rather than into, the configured opening does not teleport');
}

{
  reset();
  setTile(0,10,T.TELEPORTER);
  setTile(12,10,T.TELEPORTER);
  teleporters.setOrientationAt(0,10,'west',getTile);
  teleporters.setOrientationAt(12,10,'north',getTile);
  teleporters._debug.debugCharge(0,10,teleporters._debug.PROJECTILE_TRAVEL_COST,getTile);
  const shot={x:0.5,y:10.5,vx:8,vy:3,life:2};
  assert.equal(teleporters.tryTeleportProjectile(shot,getTile,{}),true,'a physical hero projectile can enter a directional teleporter');
  assert.ok(shot.x>12 && shot.y<10,'the projectile emerges just outside the configured destination opening');
  assert.deepEqual({vx:shot.vx,vy:shot.vy},{vx:3,vy:-8},'projectile momentum rotates exactly like hero momentum');
  assert.deepEqual({x:shot._teleporterExitX,y:shot._teleporterExitY},{x:12,y:10},'a teleported projectile remembers the exit that nearby creatures can retaliate against');
  assert.equal(teleporters.metrics().storedEnergy,0,'one ordinary projectile spends the configured teleporter projectile cost');
  assert.equal(teleporters.metrics().projectileTeleports,1,'projectile portal transfers are observable in runtime metrics');
}

{
  reset();
  setTile(4,8,T.TELEPORTER);
  for(let hit=0; hit<4; hit++){
    const result=teleporters.damageAt(4,8,4,getTile,setTile,{source:'mob'});
    assert.equal(result.hit,true,'a weak mob strike lands on the teleporter');
    assert.equal(result.destroyed,false,'four weak strikes do not destroy the 200 HP teleporter');
  }
  assert.equal(teleporters._debug.machines.get('4,8').hp,184,'teleporter health falls by the actual summed damage, not by hit count');
  const heavyHit=teleporters.damageAt(4,8,183,getTile,setTile,{source:'mob'});
  assert.equal(heavyHit.destroyed,false,'a teleporter survives while even one HP remains');
  assert.equal(heavyHit.remaining,1,'damage reports exact remaining teleporter HP');
  const finalHit=teleporters.damageAt(4,8,1,getTile,setTile,{source:'mob'});
  assert.equal(finalHit.destroyed,true,'damage totaling 200 HP destroys the teleporter');
  assert.equal(getTile(4,8),T.AIR,'a destroyed teleporter is removed from the world');
  assert.equal(teleporters.metrics().machines,0,'destroying a teleporter also clears its machine state');
}

{
  reset();
  setTile(4,8,T.TELEPORTER);
  const pristine=teleporters.dismantlePlanAt(4,8,getTile);
  assert.deepEqual(pristine.drops,[{key:'teleporter',n:1}],'an untouched teleporter can still be picked up as the complete machine');
  teleporters.setOrientationAt(4,8,'south',getTile);
  teleporters._debug.debugCharge(4,8,55,getTile);
  teleporters.damageAt(4,8,100,getTile,setTile,{source:'mob'});
  const damaged=teleporters.dismantlePlanAt(4,8,getTile);
  assert.equal(damaged.damaged,true,'any remembered mob damage switches mining to component salvage');
  assert.deepEqual(damaged.drops,[
    {key:'steel',n:3},
    {key:'copperWire',n:3},
    {key:'transistor',n:1},
    {key:'diamond',n:1}
  ],'half-health salvage returns a deterministic proportional share of the crafting recipe');
  assert.equal(damaged.drops.some(row=>row.key==='teleporter'),false,'a damaged teleporter can never reset itself by dropping a complete teleporter item');
  setTile(4,8,T.AIR);
  setTile(4,8,T.TELEPORTER);
  assert.equal(teleporters.restoreMachineStateAt(4,8,damaged.state,getTile),true,'undo can restore the dismantled machine state');
  assert.equal(teleporters._debug.machines.get('4,8').hp,100,'undo restoration keeps exact structural damage');
  assert.equal(teleporters.orientationAt(4,8,getTile),'south','undo restoration also keeps orientation');
  assert.equal(Math.round(teleporters.metrics().storedEnergy),55,'undo restoration also keeps stored energy');
}

{
  reset();
  setTile(0,10,T.TELEPORTER);
  setTile(12,10,T.TELEPORTER);
  teleporters.setOrientationAt(0,10,'west',getTile);
  teleporters.setOrientationAt(12,10,'east',getTile);
  const hero={energy:20};
  const shot={x:0.5,y:10.5,vx:8,vy:0,life:2};
  assert.equal(teleporters.tryTeleportProjectile(shot,getTile,{heroEnergy:null,player:hero}),true,'an unpowered projectile portal falls back to hero energy');
  assert.equal(hero.energy,20-teleporters._debug.PROJECTILE_TRAVEL_COST,'hero fallback pays exactly one projectile transfer cost');
}

{
  reset();
  setTile(0,10,T.TELEPORTER);
  setTile(12,10,T.TELEPORTER);
  teleporters.setOrientationAt(0,10,'west',getTile);
  teleporters.setOrientationAt(12,10,'east',getTile);
  placeDynamo(-4,10);
  setTile(-2,10,T.COPPER_WIRE);
  setTile(-1,10,T.COPPER_WIRE);
  chargeDynamo(-4,10);
  const before=dynamo.metrics().storedEnergy;
  const shot={x:0.5,y:10.5,vx:8,vy:0,life:2};
  assert.equal(teleporters.tryTeleportProjectile(shot,getTile,{dynamo,heroEnergy:null,player:{energy:0}}),true,'a projectile can teleport directly from a connected live power source');
  assert.ok(dynamo.metrics().storedEnergy<before,'a live-source projectile transfer drains real dynamo energy');
}

{
  reset();
  setTile(0,10,T.TELEPORTER);
  setTile(12,10,T.TELEPORTER);
  teleporters.setOrientationAt(0,10,'west',getTile);
  teleporters.setOrientationAt(12,10,'east',getTile);
  const shot={x:0.5,y:10.5,vx:8,vy:0,life:2};
  assert.equal(teleporters.tryTeleportProjectile(shot,getTile,{heroEnergy:null,player:{energy:0}}),false,'a projectile passes normally when neither portal nor hero can pay');
  assert.deepEqual({x:shot.x,y:shot.y,vx:shot.vx,vy:shot.vy},{x:0.5,y:10.5,vx:8,vy:0},'a refused projectile transfer does not mutate its pose or momentum');
}

{
  reset();
  setTile(0,10,T.TELEPORTER);
  setTile(12,10,T.TELEPORTER);
  teleporters.setOrientationAt(0,10,'west',getTile);
  teleporters.setOrientationAt(12,10,'east',getTile);
  teleporters._debug.debugCharge(0,10,teleporters._debug.STREAM_TRAVEL_COST*2,getTile);
  for(let i=0;i<2;i++){
    const puff={x:0.5,y:10.5,vx:8,vy:0,life:1,source:'hero'};
    assert.equal(teleporters.tryTeleportProjectile(puff,getTile,{stream:true}),true,'each physical stream particle can traverse the portal');
  }
  assert.ok(teleporters.metrics().storedEnergy<0.001,'stream particles pay their smaller per-particle energy cost');
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

// Far-world contract (worldSim): a frozen far teleporter is never validated —
// not even at a cadence — because validation is a tile read and a frozen region
// makes none. A raw removal (a low-level restore bypassing topology hooks) is
// therefore discovered the frame its region WAKES, which is also the first
// frame anything could observe the stale record.
{
  reset();
  const { worldSim } = await import('../src/engine/world_sim.js');
  worldSim.reset();
  setTile(0,10,T.TELEPORTER);
  const hero={x:0,y:10,w:0.7,h:0.95,vx:0,vy:0,energy:0};
  const frame=(dt)=>{ worldSim.beginFrame(dt,hero,null); tick(dt,hero); worldSim.endFrame(); };
  frame(0.2);                                  // registered and stamped while hot
  hero.x=200; hero.y=200;
  tiles.delete(k(0,10));                       // bypass topology notifications like a low-level restore
  frame(0.2); frame(0.2);
  assert.equal(teleporters.metrics().machines,1,'a frozen region is never validated, so the stale record survives — at zero cost');
  hero.x=0; hero.y=10;                         // return: the wake validates immediately
  frame(0.2);
  assert.equal(teleporters.metrics().machines,0,'the wake frame discovers the raw removal');
  worldSim.reset();

  setTile(0,10,T.TELEPORTER);
  setTile(0,10,T.AIR);
  assert.equal(teleporters.metrics().machines,0,'normal topology notifications remove distant teleporters immediately');
}

// Far-world contract (worldSim): the old staggered remote-validation schedule
// existed to bound how many FAR endpoints a frame could touch. Under the freeze
// that bound is now exact zero — a frame reads no tiles of any frozen endpoint,
// no matter how many hundred of them the player has built.
{
  reset();
  const { worldSim } = await import('../src/engine/world_sim.js');
  worldSim.reset();
  const endpointKeys=new Set();
  const count=240;
  for(let i=0;i<count;i++){
    const x=i*3;
    endpointKeys.add(k(x,10));
    setTile(x,10,T.TELEPORTER);
  }
  const farHero={x:-10000,y:200,w:0.7,h:0.95,vx:0,vy:0,energy:0};
  let touched=0;
  const countingGetTile=(x,y)=>{
    if(endpointKeys.has(k(x,y))) touched++;
    return getTile(x,y);
  };
  for(let frame=0;frame<23;frame++){
    worldSim.beginFrame(0.05,farHero,null);
    teleporters.update(0.05,farHero,countingGetTile,setTile,{dynamo});
    worldSim.endFrame();
  }
  assert.equal(touched,0,'240 frozen endpoints cost a frame ZERO tile reads — the budget the stagger used to ration is simply gone');
  assert.equal(teleporters.metrics().machines,count,'and every frozen record survives untouched for its eventual wake');
  worldSim.reset();
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
  teleporters.setOrientationAt(30,10,'west',getTile);
  teleporters.setOrientationAt(40,10,'east',getTile);
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
  teleporters.setOrientationAt(30,-24,'west',getTile);
  teleporters.setOrientationAt(42,-18,'east',getTile);
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
  teleporters.setOrientationAt(0,10,'west',getTile);
  const player={x:0.5,y:10.5,w:0.7,h:0.95,vx:3,vy:0,energy:0,maxEnergy:80};
  tick(0.05,player);
  assert.ok(Math.abs(player.x-0.5)<0.001,'drained teleporter refuses travel if the hero has no energy');
}

{
  reset();
  setTile(0,10,T.TELEPORTER);
  setTile(8,10,T.TELEPORTER);
  teleporters.setOrientationAt(0,10,'west',getTile);
  teleporters.setOrientationAt(8,10,'east',getTile);
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
  teleporters.setOrientationAt(2,8,'north',getTile);
  teleporters._debug.debugCharge(2,8,77,getTile);
  teleporters.damageAt(2,8,25,getTile,setTile,{source:'mob'});
  const snap=teleporters.snapshot();
  assert.deepEqual(Object.keys(snap.list[0]).sort(),['dir','energy','hp','x','y'],'teleporter snapshots persist orientation and structural HP but exclude transient cadence and network-cache bookkeeping');
  assert.equal(snap.list[0].hp,175,'partial mob damage is persisted as exact HP');
  teleporters.reset();
  assert.equal(teleporters.metrics().machines,0,'reset clears teleporter battery state');
  teleporters.restore(snap,getTile);
  assert.equal(teleporters.metrics().machines,1,'restore rehydrates teleporter battery state');
  assert.equal(Math.round(teleporters.metrics().storedEnergy),77,'restore preserves stored teleporter energy');
  assert.equal(teleporters.orientationAt(2,8,getTile),'north','restore preserves teleporter opening orientation');
  assert.equal(teleporters._debug.machines.get('2,8').hp,175,'restore preserves partial mob damage');
  teleporters.restore({v:3,list:[{x:2,y:8,dir:'north',energy:77,integrity:3}]},getTile);
  assert.equal(teleporters._debug.machines.get('2,8').hp,150,'legacy four-hit integrity migrates to the equivalent 200 HP ratio');
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
assert.match(mainSrc, /const TELEPORTER_ORIENTATION_KEY='mm_teleporter_orientation_v1'/, 'main remembers the preferred teleporter opening for future placements');
assert.match(mainSrc, /function tryRotateTeleporterAt\(tx,ty\)[\s\S]*?TELEPORTERS\.orientationAt\(tx,ty,getTile\)[\s\S]*?TELEPORTERS\.rotateDir\(previous\)[\s\S]*?TELEPORTERS\.setOrientationAt\(tx,ty,next,getTile\)/, 'right-click rotates a placed teleporter through its persisted cardinal openings');
assert.match(mainSrc, /if\(e\.pointerType==='touch'\)\{\s*if\(tryRotateTeleporterAt\(tx,ty\) \|\| tryRotateWaterPumpAt\(tx,ty\)\)/, 'touch taps route to teleporter rotation before tool and weapon actions');
assert.match(mainSrc, /Teleporter · stuknij, aby zmienić kierunek/, 'touch hover feedback explains the teleporter gesture');
assert.match(mainSrc, /id===T\.TELEPORTER && TELEPORTERS && TELEPORTERS\.setOrientationAt\) TELEPORTERS\.setOrientationAt\(tx,ty,teleporterOrientation,getTile\)/, 'new teleporters inherit the cardinal opening selected before placement');
assert.match(mainSrc, /selectedTileId\(\)===T\.TELEPORTER\)\{ toggleTeleporterOrientation\(\)/, 'R rotates the selected teleporter before placement');
assert.match(mainSrc, /TELEPORTERS\.canEnterTeleporter\(player,getTile\)/, 'co-op teleport requests use the same directional entrance predicate as solo play');
assert.match(mainSrc, /id:'teleporter', name:'Teleporter', cost:TELEPORTERS\.RECIPE_COST/, 'crafting and damaged-machine salvage share one teleporter recipe definition');
assert.match(mainSrc, /function dismantleTeleporterAt\(tx,ty\)[\s\S]*?TELEPORTERS\.dismantlePlanAt\(tx,ty,getTile\)[\s\S]*?teleporterState:plan\.state/, 'solo mining converts a damaged teleporter into its planned component salvage and remembers undo state');
assert.match(mainSrc, /e\.oldId===T\.TELEPORTER && e\.teleporterState[\s\S]*?TELEPORTERS\.restoreMachineStateAt/, 'undo restores the teleporter damage instead of silently rebuilding it at full health');
assert.match(mainSrc, /ghostHeroMineAt:\(tx,ty,claim\)=>\{[\s\S]*?const teleporterPlan=tId===T\.TELEPORTER[\s\S]*?loot:teleporterPlan \? teleporterPlan\.drops : null/, 'host-authoritative hero mining computes teleporter salvage before removing machine state');
assert.match(mainSrc, /WEAPONS\.update\(dt, getTile, setTile, \{teleporters:TELEPORTERS,getElectricNetworkTile,dynamo:DYNAMO,heroEnergy:MM\.heroEnergy,player\}\)/, 'weapon simulation receives the powered directional teleporter context');
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

const ghostHostSrc = await readFile(new URL('../src/engine/ghost_host.js', import.meta.url), 'utf8');
const ghostClientSrc = await readFile(new URL('../src/engine/ghost_client.js', import.meta.url), 'utf8');
assert.match(ghostHostSrc, /const loot=Array\.isArray\(res\.loot\)[\s\S]*?NET\.pouchAdd\(b\.pouch,row\.key,row\.n\)/, 'co-op host credits the exact validated salvage rows to the remote hero pouch');
assert.match(ghostClientSrc, /pl\.a === 'mine' && pl\.ok && Array\.isArray\(pl\.loot\)[\s\S]*?bridge\.ghostHeroGain\(row\.key,row\.n\|\|1\)/, 'co-op client applies explicit teleporter salvage instead of rerunning the complete-tile drop');

console.log('teleporter-sim: all assertions passed');
