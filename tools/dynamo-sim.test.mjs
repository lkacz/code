// Regression tests for the dynamo machine: [casing | slot | casing].
// Horizontal dynamos accept falling water / rising gas, vertical dynamos accept
// sideways pressurized water for dam builds, and the slot tile is preserved.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};

const { T, WORLD_H } = await import('../src/constants.js');
const { dynamo } = await import('../src/engine/dynamo.js');
const { water } = await import('../src/engine/water.js');
const { gases } = await import('../src/engine/gases.js');
const { fire } = await import('../src/engine/fire.js');

let tiles;
function key(x,y){ return x+','+y; }
function getTile(x,y){
  if(y<0 || y>=WORLD_H) return T.STONE;
  return tiles.get(key(x,y)) ?? T.AIR;
}
function setTile(x,y,v){
  if(y<0 || y>=WORLD_H) return;
  const old=getTile(x,y);
  const k=key(x,y);
  if(v===T.AIR) tiles.delete(k);
  else tiles.set(k,v);
  if(old!==v){
    if(gases && gases.onTileChanged) gases.onTileChanged(x,y,old,v);
    if(dynamo && dynamo.onTileChanged) dynamo.onTileChanged(x,y,old,v);
  }
}
function resetWorld(){
  tiles=new Map();
  water.reset();
  gases.reset();
  fire.reset();
  dynamo.reset();
  MM.world={getTile,setTile,setTransientTile:setTile};
  MM.water=water;
  MM.gases=gases;
  MM.fire=fire;
  MM.dynamo=dynamo;
}
function placeDynamo(cx,y,orientation='horizontal'){
  const cells=dynamo.plannedCells(cx,y,orientation);
  cells.forEach(c=>setTile(c.x,c.y,c.t));
}
function stepGas(seconds,dt=0.1){
  const n=Math.ceil(seconds/dt);
  for(let i=0; i<n; i++) gases.update(dt,getTile,setTile,{x:20,y:20});
}

assert.equal(T.DYNAMO_SLOT,31,'dynamo slot has a stable tile id after gas tiles');
assert.equal(dynamo.isSlot(T.DYNAMO_SLOT),true,'dynamo exposes slot predicate');
assert.deepEqual(dynamo.plannedCells(3,8,'vertical').map(c=>[c.x,c.y,c.t]), [[3,7,T.DYNAMO],[3,8,T.DYNAMO_SLOT],[3,9,T.DYNAMO]], 'dynamo can plan a 90-degree rotated structure');

// Water falls through a valid slot and generates power without replacing it.
resetWorld();
placeDynamo(0,5);
assert.equal(dynamo.metrics().machines,1,'placing a valid dynamo creates an empty battery state');
assert.equal(dynamo.metrics().storedEnergy,0,'new dynamo battery starts empty');
setTile(0,8,T.STONE);
assert.equal(water.addSource(0,4,getTile,setTile),true,'water source placed above dynamo');
water.update(getTile,setTile,0.2);
assert.equal(getTile(0,5),T.DYNAMO_SLOT,'falling water preserves the dynamo slot');
assert.equal(getTile(0,7),T.WATER,'water lands below the pass-through slot');
assert.ok(dynamo.metrics().currentPower>0,'falling water produces dynamo output');
assert.ok(dynamo.metrics().storedEnergy>0,'falling water adds stored energy');
{
  const before=dynamo.metrics().storedEnergy;
  const far=dynamo.absorbNear(20,20,1,getTile,2);
  assert.equal(far,null,'hero cannot absorb energy from a distant dynamo');
  const got=dynamo.absorbNear(0.5,5.5,before*0.5,getTile,2);
  assert.ok(got && got.amount>0,'hero can absorb stored energy next to a dynamo');
  assert.ok(dynamo.metrics().storedEnergy < before,'absorbing drains stored dynamo energy');
  const readable=dynamo.energyAt(0,5,getTile);
  assert.ok(Math.abs(readable-dynamo.metrics().storedEnergy)<0.02,'machine energy can be read from a valid slot');
  const drained=dynamo.drainAt(-1,5,Math.max(0.01,readable*0.5),getTile);
  assert.ok(drained && drained.amount>0,'machine energy can be drained from any structure cell');
  assert.ok(dynamo.metrics().storedEnergy < readable,'drainAt consumes stored dynamo energy');
}

for(let i=0; i<160; i++) dynamo.recordFlow(0,5,T.WATER,4,getTile);
assert.equal(dynamo.metrics().storedEnergy,dynamo._debug.ENERGY_CAPACITY,'stored dynamo energy caps at battery capacity');

// A rotated dynamo in a dam lets pressurized water pass sideways through the slot.
resetWorld();
placeDynamo(0,5,'vertical');
setTile(-1,4,T.WATER); // hydraulic head above the intake cell
setTile(-1,5,T.WATER);
setTile(-1,6,T.STONE);
setTile(1,6,T.STONE);
assert.equal(water.addSource(-1,5,getTile,setTile),true,'dam intake water is active');
water.update(getTile,setTile,0.2);
assert.equal(dynamo.slotOrientation(0,5,getTile),'vertical','rotated dynamo is recognized from its casing layout');
assert.equal(getTile(0,5),T.DYNAMO_SLOT,'sideways flow preserves the rotated dynamo slot');
assert.equal(getTile(1,5),T.WATER,'pressurized water exits on the dry side of the dam');
assert.ok(dynamo.metrics().currentPower>0,'sideways dam flow produces dynamo output');
assert.ok(dynamo.metrics().storedEnergy>0,'sideways dam flow adds stored energy');

// Surface puddles do not drain through a dam turbine without pressure above them.
resetWorld();
placeDynamo(0,5,'vertical');
setTile(-1,5,T.WATER);
setTile(-2,5,T.STONE);
setTile(-2,6,T.STONE);
setTile(-1,6,T.STONE);
setTile(1,6,T.STONE);
assert.equal(water.addSource(-1,5,getTile,setTile),true,'surface water is active');
water.update(getTile,setTile,0.2);
assert.equal(getTile(-1,5),T.WATER,'unpressurized surface water does not creep through a rotated dynamo');
assert.equal(getTile(1,5),T.AIR,'dry side of the dam stays dry without pressure');
assert.equal(dynamo.metrics().storedEnergy,0,'unpressurized water produces no dam-turbine energy');

// An orphan slot is not pass-through and does not generate power.
resetWorld();
setTile(0,5,T.DYNAMO_SLOT);
setTile(0,8,T.STONE);
for(let y=4; y<=8; y++){ setTile(-1,y,T.STONE); setTile(1,y,T.STONE); }
assert.equal(water.addSource(0,4,getTile,setTile),true,'water source placed above orphan slot');
water.update(getTile,setTile,0.2);
assert.equal(getTile(0,4),T.WATER,'water does not pass through an invalid slot');
assert.equal(dynamo.metrics().storedEnergy,0,'invalid slot produces no energy');

// Steam rises through a valid slot and produces power.
resetWorld();
placeDynamo(0,5);
setTile(0,6,T.STEAM);
gases.update(0.35,getTile,setTile,{x:20,y:20});
assert.equal(getTile(0,5),T.DYNAMO_SLOT,'rising steam preserves the dynamo slot');
assert.equal(getTile(0,4),T.STEAM,'steam exits above the slot');
assert.ok(dynamo.metrics().currentPower>0,'rising steam produces dynamo output');
const steamEnergy=dynamo.metrics().storedEnergy;
assert.ok(steamEnergy>0,'steam adds stored energy');

// Hot air also rises through the slot, at a lower output.
resetWorld();
placeDynamo(0,5);
setTile(0,6,T.HOT_AIR);
gases.update(0.25,getTile,setTile,{x:20,y:20});
assert.equal(getTile(0,4),T.HOT_AIR,'hot air exits above the slot');
assert.ok(dynamo.metrics().storedEnergy>0,'hot air adds stored energy');
assert.ok(dynamo.metrics().storedEnergy<steamEnergy,'hot air output is weaker than steam output');
const snap=dynamo.snapshot();

// Exposed lava emits hot air slowly; that hot air can charge a dynamo above it.
resetWorld();
placeDynamo(0,5);
setTile(0,7,T.LAVA);
setTile(0,8,T.STONE);
fire.noteLava(0,7,{hotT:0});
fire.update(getTile,setTile,0.1);
assert.equal(getTile(0,6),T.HOT_AIR,'exposed lava emits hot air into open space above it');
gases.update(0.25,getTile,setTile,{x:20,y:20});
assert.equal(getTile(0,5),T.DYNAMO_SLOT,'lava hot air preserves the dynamo slot');
assert.equal(getTile(0,4),T.HOT_AIR,'lava hot air exits above the dynamo');
assert.ok(dynamo.metrics().storedEnergy>0,'lava-generated hot air charges a dynamo');

// Other gases may vent through the slot, but they do not generate power.
resetWorld();
placeDynamo(0,5);
setTile(0,6,T.POISON_GAS);
gases._debug.active.get('0,6').moveT=0;
gases.update(0.05,getTile,setTile,{x:20,y:20});
assert.equal(getTile(0,5),T.DYNAMO_SLOT,'poison gas preserves the dynamo slot');
assert.equal(getTile(0,4),T.POISON_GAS,'poison gas passes through the dynamo slot');
assert.equal(dynamo.metrics().storedEnergy,0,'poison gas does not charge the dynamo');
assert.equal(dynamo.metrics().currentPower,0,'poison gas does not produce dynamo output');

resetWorld();
placeDynamo(0,5);
setTile(0,6,T.FUEL_GAS);
gases._debug.active.get('0,6').moveT=0;
gases.update(0.05,getTile,setTile,{x:20,y:20});
assert.equal(getTile(0,5),T.DYNAMO_SLOT,'fuel gas preserves the dynamo slot');
assert.equal(getTile(0,4),T.FUEL_GAS,'fuel gas passes through the dynamo slot');
assert.equal(dynamo.metrics().storedEnergy,0,'fuel gas does not charge the dynamo');
assert.equal(dynamo.metrics().currentPower,0,'fuel gas does not produce dynamo output');

// Dynamo output state snapshots separately from terrain and only restores on valid structures.
dynamo.reset();
assert.equal(dynamo.metrics().machines,0,'reset clears machine state');
dynamo.restore(snap,getTile);
assert.equal(dynamo.metrics().machines,1,'restore rehydrates a valid dynamo state');
dynamo.restore({v:1,list:[{x:0,y:5,power:0,energy:999,lastKind:'water'}]},getTile);
assert.equal(dynamo.metrics().storedEnergy,dynamo._debug.ENERGY_CAPACITY,'restore clamps stored energy to battery capacity');
setTile(-1,5,T.AIR);
dynamo.update(0.1,getTile);
assert.equal(dynamo.metrics().machines,0,'broken structure drops stale dynamo state');

resetWorld();
placeDynamo(0,5,'vertical');
dynamo.recordFlow(0,5,T.WATER,1,getTile);
assert.equal(dynamo.metrics().machines,1,'vertical dynamo can store machine state');
setTile(0,4,T.AIR);
dynamo.update(0.1,getTile);
assert.equal(dynamo.metrics().machines,0,'breaking a vertical casing drops stale dynamo state');

const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
assert.match(mainSrc, /function giveDebugDynamo\(\)/, 'main exposes a debug action that grants a dynamo item');
assert.match(mainSrc, /function placeDebugDynamo\(\)/, 'main exposes a debug action that places a full dynamo structure');
assert.match(mainSrc, /function pulseDebugDynamo\(\)/, 'main exposes a debug action that pulses the nearest dynamo');
assert.match(mainSrc, /function chargeDebugDynamo\(\)/, 'main exposes a debug action that charges the nearest dynamo');
assert.match(mainSrc, /function fillDebugHeroEnergy\(\)/, 'main exposes a debug action that fills hero energy');
assert.match(mainSrc, /function toggleDynamoOrientation\(\)/, 'main exposes an R-key dynamo orientation toggle');
assert.match(mainSrc, /function isStableMachineSupport\(t\)/, 'dynamo placement uses a stable support predicate');
assert.match(mainSrc, /function canDynamoCellReplace\(cell,cur\)/, 'dynamo placement has a single replaceability rule');
assert.match(mainSrc, /cell\.role==='slot'[\s\S]*cur===T\.WATER/, 'dynamo slot may be placed into existing water');
assert.match(mainSrc, /function dynamoCellLabel\(cell\)/, 'dynamo placement names the blocked structure cell');
assert.match(mainSrc, /function notifyStructureTileChanged\(x,y,oldTile,newTile\)/, 'machine tile edits wake dependent simulations');
assert.match(mainSrc, /notifyStructureTileChanged\(cell\.x,cell\.y,cell\.newId,cell\.oldId\)/, 'dynamo undo wakes dependent simulations');
assert.match(mainSrc, /Dynamo wymaga podparcia obudowy/, 'dynamo placement explains casing support failures');
assert.match(mainSrc, /ctx\.fillText\(text,lx\+2,ly-2\)/, 'placement preview renders the blocking reason beside the ghost');
assert.match(mainSrc, /DYNAMO\.plannedCells\(tx,ty,dynamoOrientation\)/, 'regular placement uses the current dynamo orientation');
assert.match(mainSrc, /DYNAMO\.plannedCells\(cx,cy,dynamoOrientation\)/, 'debug placement uses the current dynamo orientation');
assert.match(mainSrc, /MM\.ui\.injectDynamoDebugPanel/, 'main injects the dynamo debug panel');

const dynamoSrc = await readFile(new URL('../src/engine/dynamo.js', import.meta.url), 'utf8');
assert.match(dynamoSrc, /const ENERGY_CAPACITY = 100/, 'dynamo has a fixed battery capacity');
assert.match(dynamoSrc, /function drawBatteryLines\(ctx,TILE,px,py,charge,pulse\)/, 'dynamo draws stored energy as battery lines');
assert.match(dynamoSrc, /function energyAt\(x,y,getTile\)/, 'dynamo exposes stored-energy read access for powered devices');
assert.match(dynamoSrc, /function drainAt\(x,y,amount,getTile\)/, 'dynamo exposes stored-energy drain access for powered devices');
assert.match(dynamoSrc, /for\(let i=0; i<4; i\+\+\)/, 'dynamo battery indicator uses four charge lines');
assert.match(dynamoSrc, /ensureVisibleMachines\(sx,sy,viewX,viewY,getTile\)/, 'visible dynamos materialize empty battery state for drawing');

const uiSrc = await readFile(new URL('../src/engine/ui.js', import.meta.url), 'utf8');
assert.match(uiSrc, /function injectDynamoDebugPanel\(actions, menuPanel\)/, 'ui exposes a dynamo debug panel injector');
assert.match(uiSrc, /box\.id='dynamoDebugBox'/, 'dynamo debug panel has a stable DOM id');
assert.match(uiSrc, /Postaw testowe/, 'dynamo debug panel includes a place-test-structure button');
assert.match(uiSrc, /Impuls/, 'dynamo debug panel includes a pulse button');
assert.match(uiSrc, /Laduj dynamo/, 'dynamo debug panel includes a stored-energy charge button');
assert.match(uiSrc, /Hero pelny/, 'dynamo debug panel includes a hero battery fill button');

console.log('dynamo-sim: all assertions passed');
