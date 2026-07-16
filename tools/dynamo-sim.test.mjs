// Regression tests for the dynamo machine: [casing | slot | casing].
// Horizontal dynamos accept falling water / rising gas, vertical dynamos accept
// sideways pressurized water for dam builds, and the slot tile is preserved.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};

const { T, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } = await import('../src/constants.js');
const { drawEnergyGenerationLamp, isEnergyGenerating } = await import('../src/engine/power_indicator.js');
const { dynamo } = await import('../src/engine/dynamo.js');
const { water } = await import('../src/engine/water.js');
const { gases } = await import('../src/engine/gases.js');
const { fire } = await import('../src/engine/fire.js');
const { wind } = await import('../src/engine/wind.js');

let tiles;
function key(x,y){ return x+','+y; }
function getTile(x,y){
  if(y<WORLD_MIN_Y || y>=WORLD_MAX_Y) return T.STONE;
  return tiles.get(key(x,y)) ?? T.AIR;
}
function setTile(x,y,v){
  if(y<WORLD_MIN_Y || y>=WORLD_MAX_Y) return;
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
  wind.reset();
  MM.world={getTile,setTile,setTransientTile:setTile};
  MM.water=water;
  MM.gases=gases;
  MM.fire=fire;
  MM.dynamo=dynamo;
  MM.wind=wind;
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
assert.equal(isEnergyGenerating(0),false,'zero output is an idle generator state');
assert.equal(isEnergyGenerating(4),true,'positive live output is a generating state');
assert.equal(isEnergyGenerating(4,true),false,'external charging is not mislabeled as generation');
{
  const fills=[];
  const lampCtx={
    fillStyle:'',strokeStyle:'',globalAlpha:1,globalCompositeOperation:'source-over',lineWidth:1,
    save(){},restore(){},beginPath(){},arc(){},stroke(){},fill(){ fills.push(this.fillStyle); }
  };
  drawEnergyGenerationLamp(lampCtx,32,0,0,true,1);
  assert.ok(fills.includes('#59ff73'),'active generator renderer paints a green LED');
  fills.length=0;
  drawEnergyGenerationLamp(lampCtx,32,0,0,false,0);
  assert.ok(fills.includes('#ff4f58'),'idle generator renderer paints a red LED');
}

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
assert.ok(dynamo.metrics().rotorSpeed>0,'falling water spins the dynamo fan');
{
  const m=dynamo._debug.machines.get('0,5');
  assert.equal(dynamo._debug.isGeneratingState(m),true,'live water generation lights the green generator status');
  const angleBefore=m.rotorAngle;
  dynamo.update(0.16,getTile);
  assert.notEqual(m.rotorAngle,angleBefore,'working dynamo fan animation advances with machine output');
  assert.ok(dynamo.metrics().rotorSpeed>0,'dynamo fan keeps visible rotational inertia after a work pulse');
}
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
{
  const before=dynamo.metrics().storedEnergy;
  assert.equal(dynamo.recordFlow(0,5,T.WATER,0,getTile),false,'zero reported flow cannot mint a minimum dynamo pulse');
  assert.equal(dynamo.recordFlow(0,5,T.WATER,-1,getTile),false,'negative reported flow cannot charge a dynamo');
  assert.equal(dynamo.recordFlow(0,5,T.WATER,Number.NaN,getTile),false,'malformed reported flow cannot charge a dynamo');
  assert.equal(dynamo.metrics().storedEnergy,before,'rejected flow leaves stored energy unchanged');
}

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

// A river or mill race can drive the same vertical turbine without a full
// water column above it when the outlet drops to a lower tailrace. Energy is
// awarded only for the parcel that actually crosses the rotor slot.
resetWorld();
placeDynamo(0,5,'vertical');
setTile(-1,6,T.STONE);
setTile(1,8,T.STONE);
assert.equal(water.addSource(-1,5,getTile,setTile),true,'river water reaches the vertical dynamo inlet');
water.update(getTile,setTile,0.2);
assert.equal(getTile(0,5),T.DYNAMO_SLOT,'downhill cross-flow preserves the vertical dynamo slot');
assert.equal(getTile(1,5),T.WATER,'river water crosses the rotor toward the lower tailrace');
assert.ok(dynamo.metrics().currentPower>0,'actual downhill flow powers a vertical dynamo');
assert.ok(dynamo.metrics().storedEnergy>0,'vertical hydroelectric flow is stored as usable energy');

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

// A vertical dynamo can also act as a small wind turbine. It only charges when
// local exposed wind is substantial, so altitude matters and blocked intakes do
// not produce free energy.
resetWorld();
placeDynamo(0,24,'vertical');
wind.setOverride(2.4);
for(let i=0; i<60*12; i++) dynamo.update(1/60,getTile);
const highWindEnergy=dynamo.metrics().storedEnergy;
assert.ok(highWindEnergy>0.012,'moderate wind barely charges a vertical dynamo high in the map');
assert.ok(highWindEnergy<0.35,'wind turbine output stays deliberately inefficient');
assert.equal(dynamo._debug.machines.get('0,24').lastKind,'wind','wind power is recorded as a distinct dynamo source');

resetWorld();
assert.ok(WORLD_MIN_Y<0 && WORLD_MAX_Y>WORLD_H,'dynamo tests cover the extended vertical world');
placeDynamo(0,-40,'vertical');
wind.setOverride(2.4);
for(let i=0; i<60*8; i++) dynamo.update(1/60,getTile);
assert.ok(dynamo.metrics().storedEnergy>0.008,'sky-layer vertical dynamos can harvest exposed wind');

resetWorld();
placeDynamo(0,104,'vertical');
wind.setOverride(2.4);
for(let i=0; i<60*12; i++) dynamo.update(1/60,getTile);
assert.equal(dynamo.metrics().storedEnergy,0,'the same moderate wind is too weak near ground level');

resetWorld();
placeDynamo(0,104,'vertical');
wind.setOverride(5.0);
for(let i=0; i<60*4; i++) dynamo.update(1/60,getTile);
assert.ok(dynamo.metrics().storedEnergy>0.035,'severe ground wind can charge a vertical dynamo a little');
assert.ok(dynamo.metrics().storedEnergy<0.30,'severe wind turbine output remains nerfed');

resetWorld();
placeDynamo(0,24,'vertical');
dynamo.restore({v:1,list:[{x:0,y:24,power:0,energy:20,lastKind:'wind'}]},getTile);
const beforeDrainEnergy=dynamo.metrics().storedEnergy;
const drainResult=dynamo.drainAt(0,24,4,getTile);
assert.ok(drainResult && drainResult.amount>0,'powered devices can drain a stored wind-turbine battery');
assert.ok(dynamo.metrics().storedEnergy<beforeDrainEnergy,'network drain consumes stored wind-turbine energy');
assert.equal(dynamo.metrics().currentPower,0,'draining a dynamo battery does not masquerade as fresh turbine output');
assert.equal(dynamo._debug.isGeneratingState(dynamo._debug.machines.get('0,24')),false,'stored energy alone keeps the generator status idle');

resetWorld();
placeDynamo(0,24,'vertical');
assert.ok(dynamo.receiveElectricChargeAt(0,24,2,getTile)>0,'electric rifle can inject energy into a dynamo');
assert.equal(dynamo._debug.machines.get('0,24').lastKind,'electric','externally injected energy is marked as electric input');
assert.equal(dynamo._debug.isGeneratingState(dynamo._debug.machines.get('0,24')),false,'external charging never lights the generation indicator green');

resetWorld();
placeDynamo(0,24,'horizontal');
wind.setOverride(5.0);
for(let i=0; i<60*4; i++) dynamo.update(1/60,getTile);
assert.equal(dynamo.metrics().storedEnergy,0,'horizontal dynamos do not harvest wind');

resetWorld();
placeDynamo(0,24,'vertical');
setTile(-1,24,T.STONE);
wind.setOverride(5.0);
for(let i=0; i<60*4; i++) dynamo.update(1/60,getTile);
assert.equal(dynamo.metrics().storedEnergy,0,'blocked vertical dynamo intake prevents wind charging');

resetWorld();
placeDynamo(0,24,'vertical');
setTile(-1,24,T.WIRE);
wind.setOverride(5.0);
for(let i=0; i<60*4; i++) dynamo.update(1/60,getTile);
assert.ok(dynamo.metrics().storedEnergy>0.01,'porous utility wires do not block a wind turbine intake');

resetWorld();
placeDynamo(0,24,'vertical');
wind.setOverride(5.0);
assert.equal(dynamo.metrics().storedEnergy,0,'wind catch-up test starts with an empty turbine battery');
assert.equal(dynamo.catchUp(120,getTile),true,'wind turbine catch-up reports stored-energy progress after a long inactive gap');
assert.ok(dynamo.metrics().storedEnergy>0.25,'wind turbine catch-up accumulates offscreen energy');
assert.equal(dynamo._debug.machines.get('0,24').lastKind,'wind','wind catch-up preserves the source kind for UI/debugging');

resetWorld();
placeDynamo(0,24,'vertical');
setTile(-1,24,T.WATER);
wind.setOverride(5.0);
for(let i=0; i<60*4; i++) dynamo.update(1/60,getTile);
assert.equal(dynamo.metrics().storedEnergy,0,'water blocks turbine airflow even though it is not a structural wind canopy');

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

// Powered gas is lossy at turbines: about 10% is consumed so one source cannot
// feed an arbitrarily long chain of dynamos forever.
resetWorld();
placeDynamo(0,5);
let turbineGasLost=0, turbineGasPassed=0;
for(let i=0; i<80; i++){
  setTile(0,4,T.AIR);
  setTile(0,6,T.STEAM);
  const rec=gases._debug.active.get('0,6');
  if(rec) rec.moveT=0;
  gases.update(0.05,getTile,setTile,{x:20,y:20});
  if(getTile(0,4)===T.STEAM){
    turbineGasPassed++;
    setTile(0,4,T.AIR);
  } else {
    turbineGasLost++;
  }
  setTile(0,6,T.AIR);
}
assert.ok(turbineGasLost>=4 && turbineGasLost<=14, 'powered steam sometimes vanishes at dynamos ('+turbineGasLost+'/80)');
assert.ok(turbineGasPassed>turbineGasLost, 'most powered steam still passes through the turbine');
assert.ok(dynamo.metrics().storedEnergy>0,'lossy turbine gas still charges the dynamo');

resetWorld();
for(const y of [15,13,11,9,7]) placeDynamo(0,y);
let chainSurvivors=0;
let chainLost=0;
for(let i=0; i<120; i++){
  for(let y=4; y<=16; y+=2) setTile(0,y,T.AIR);
  setTile(0,16,T.STEAM);
  const first=gases._debug.active.get('0,16');
  if(first) first.moveT=0;
  for(let step=0; step<8; step++){
    for(const rec of gases._debug.active.values()){
      if(rec && rec.t===T.STEAM) rec.moveT=0;
    }
    gases.update(0.05,getTile,setTile,{x:20,y:20});
  }
  let reachedTop=false;
  for(let y=0; y<=6; y++) if(getTile(0,y)===T.STEAM) reachedTop=true;
  if(reachedTop) chainSurvivors++;
  else chainLost++;
  for(let y=0; y<=16; y++) if(getTile(0,y)===T.STEAM) setTile(0,y,T.AIR);
}
assert.ok(chainLost>25, 'stacked dynamos attenuate a steam chain ('+chainLost+'/120 lost before the top)');
assert.ok(chainSurvivors>35, 'stacked dynamos do not consume every steam cell ('+chainSurvivors+'/120 reached the top)');

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
placeDynamo(0,5);
{
  const oversized=new Array(dynamo._debug.MACHINE_CAP+1).fill(null);
  oversized[dynamo._debug.MACHINE_CAP]={x:0,y:5,power:1,energy:10,lastKind:'water'};
  dynamo.restore({v:1,list:oversized},getTile);
  assert.equal(dynamo.metrics().machines,0,'dynamo restore scans at most its persisted machine cap even when preceding rows are invalid');
}

resetWorld();
placeDynamo(0,5,'vertical');
dynamo.recordFlow(0,5,T.WATER,1,getTile);
assert.equal(dynamo.metrics().machines,1,'vertical dynamo can store machine state');
setTile(0,4,T.AIR);
dynamo.update(0.1,getTile);
assert.equal(dynamo.metrics().machines,0,'breaking a vertical casing drops stale dynamo state');

// A fallen three-cell dynamo may settle as separate tiles. The unique rotor
// slot is its only recovery token, so casing fragments cannot multiply it.
assert.equal(dynamo.dismantleRefundForCells([
  {oldId:T.DYNAMO},{oldId:T.DYNAMO_SLOT},{oldId:T.DYNAMO}
]),1,'a complete dynamo dismantles into exactly one inventory item');
assert.equal(dynamo.dismantleRefundForCells([{oldId:T.DYNAMO_SLOT}]),1,'an isolated fallen rotor preserves the one recoverable dynamo');
assert.equal(dynamo.dismantleRefundForCells([{oldId:T.DYNAMO},{oldId:T.DYNAMO}]),0,'casing-only fragments cannot mint a complete dynamo');
assert.equal([
  [{oldId:T.DYNAMO}],
  [{oldId:T.DYNAMO_SLOT}],
  [{oldId:T.DYNAMO}]
].reduce((sum,cells)=>sum+dynamo.dismantleRefundForCells(cells),0),1,'all separately settled fragments still refund at most one dynamo');

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
assert.doesNotMatch(mainSrc, /\b(?:DYNAMO|SOLAR|TELEPORTERS|GASES)\.onTileChanged\b/, 'main delegates machine/gas lifecycle hooks to WORLD.setTile');
{
	const notifyBody = mainSrc.match(/function notifyStructureTileChanged\(x,y,oldTile,newTile\)\{([\s\S]*?)\n\}/)?.[1] || '';
	assert.doesNotMatch(notifyBody, /DYNAMO\.onTileChanged|SOLAR\.onTileChanged|TELEPORTERS\.onTileChanged|GASES\.onTileChanged/, 'world.setTile owns machine/gas lifecycle notifications without duplicate main-layer calls');
  assert.match(notifyBody, /VOLCANO\.onTileChanged/, 'main-layer edit notifications still wake volcano logic');
  assert.match(notifyBody, /FALLING\.recheckNeighborhood/, 'main-layer edit notifications still wake falling-structure checks');
  assert.match(notifyBody, /WATER\.onTileChanged/, 'main-layer edit notifications still wake water simulation');
}
assert.match(mainSrc, /notifyStructureTileChanged\(cell\.x,cell\.y,cell\.newId,cell\.oldId\)/, 'dynamo undo wakes dependent simulations');
assert.match(mainSrc, /DYNAMO\.dismantleRefundForCells\(undoCells\)/, 'dynamo dismantling delegates fragment refunds to the rotor-token contract');
assert.match(mainSrc, /const refund=Math\.max\(0,Math\.min\(1,Number\(e\.refund===undefined\?1:e\.refund\)\|\|0\)\)/, 'dynamo undo reclaims only the refund actually granted by dismantling');
assert.match(mainSrc, /Dynamo wymaga podparcia obudowy/, 'dynamo placement explains casing support failures');
assert.match(mainSrc, /ctx\.fillText\(text,lx\+2,ly-2\)/, 'placement preview renders the blocking reason beside the ghost');
assert.match(mainSrc, /DYNAMO\.plannedCells\(tx,ty,dynamoOrientation\)/, 'regular placement uses the current dynamo orientation');
assert.match(mainSrc, /for\(const cell of cells\)\{[\s\S]*Number\.isInteger\(cell\.x\)[\s\S]*worldCellInBounds\(cell\.x,cell\.y\)/,
  'every casing and rotor cell must be an integer coordinate inside the world before a composite placement');
assert.match(mainSrc, /const placed=\[\];[\s\S]*throw new Error\('dynamo write rejected'\)[\s\S]*for\(let i=placed\.length-1;i>=0;i--\)/,
  'a rejected dynamo cell rolls back earlier casing writes before inventory is consumed');
assert.match(mainSrc, /WATER\.displaceAt\(cell\.x,cell\.y,getTile,setTile\)[\s\S]*if\(!displaced\)[\s\S]*return false;/,
  'a rotor placed into sealed water aborts instead of deleting the trapped fluid');
assert.match(mainSrc, /DYNAMO\.plannedCells\(cx,cy,dynamoOrientation\)/, 'debug placement uses the current dynamo orientation');
assert.match(mainSrc, /MM\.ui\.injectDynamoDebugPanel/, 'main injects the dynamo debug panel');

const dynamoSrc = await readFile(new URL('../src/engine/dynamo.js', import.meta.url), 'utf8');
assert.match(dynamoSrc, /isWindExposureBlockerTile/, 'dynamo wind turbine intake reuses shared material wind exposure rules');
assert.match(dynamoSrc, /const ENERGY_CAPACITY = 100/, 'dynamo has a fixed battery capacity');
assert.match(dynamoSrc, /function drawBatteryLines\(ctx,TILE,px,py,charge,pulse\)/, 'dynamo draws stored energy as battery lines');
assert.match(dynamoSrc, /function drawRotorFan\(ctx,TILE,px,py,angle,work,pulse\)/, 'dynamo draws a visible rotating fan');
assert.match(dynamoSrc, /function drawOutputReadout\(ctx,TILE,px,py,power,sourceKind,orientation,pulse\)/, 'dynamo draws output as an internal machine readout');
assert.match(dynamoSrc, /function energyAt\(x,y,getTile\)/, 'dynamo exposes stored-energy read access for powered devices');
assert.match(dynamoSrc, /function drainAt\(x,y,amount,getTile\)/, 'dynamo exposes stored-energy drain access for powered devices');
assert.match(dynamoSrc, /for\(let i=0; i<4; i\+\+\)/, 'dynamo battery indicator uses four charge lines');
assert.match(dynamoSrc, /const leftX=px\+TILE\*0\.08/, 'dynamo battery level is drawn on the left side');
assert.match(dynamoSrc, /const rightX=px\+TILE\*0\.835/, 'dynamo battery level is drawn on the right side');
assert.match(dynamoSrc, /drawRotorFan\(ctx,TILE,px,py,m\.rotorAngle\|\|0,spin,m\.pulse\|\|0\)/, 'dynamo fan draw follows rotor state and work pace');
assert.match(dynamoSrc, /drawOutputReadout\(ctx,TILE,px,py,m\.power\|\|0,m\.lastKind\|\|'',orientation,m\.pulse\|\|0\)/, 'dynamo output rate is rendered on the structure itself');
assert.doesNotMatch(dynamoSrc, /by=py-TILE\*0\.42/, 'dynamo output readout is no longer placed above the structure');
assert.match(dynamoSrc, /rotorSpeed:\+rotorSpeed\.toFixed\(2\)/, 'dynamo metrics expose fan speed for regression tests');
assert.match(dynamoSrc, /ensureVisibleMachines\(sx,sy,viewX,viewY,getTile\)/, 'visible dynamos materialize empty battery state for drawing');
assert.match(dynamoSrc, /const y0=Math\.max\(WORLD_TOP,Math\.floor\(sy\)-2\), y1=Math\.min\(WORLD_BOTTOM-1,Math\.ceil\(sy\+viewY\)\+2\)/, 'visible dynamo scan follows extended sky/deep world bounds');
const gasesSrc = await readFile(new URL('../src/engine/gases.js', import.meta.url), 'utf8');
assert.match(gasesSrc, /const DYNAMO_POWERED_GAS_LOSS_CHANCE = 0\.10/, 'powered gas has a 10% turbine loss chance');
assert.match(gasesSrc, /maybeConsumePoweredGas\(g,nx,ny,nx,ty,getTile,setTile\)/, 'gas pass-through may consume steam or hot air after powering a dynamo');

const uiSrc = await readFile(new URL('../src/engine/ui.js', import.meta.url), 'utf8');
assert.match(uiSrc, /function injectDynamoDebugPanel\(actions, menuPanel\)/, 'ui exposes a dynamo debug panel injector');
assert.match(uiSrc, /box\.id='dynamoDebugBox'/, 'dynamo debug panel has a stable DOM id');
assert.match(uiSrc, /Postaw testowe/, 'dynamo debug panel includes a place-test-structure button');
assert.match(uiSrc, /Impuls/, 'dynamo debug panel includes a pulse button');
assert.match(uiSrc, /Laduj dynamo/, 'dynamo debug panel includes a stored-energy charge button');
assert.match(uiSrc, /Hero pelny/, 'dynamo debug panel includes a hero battery fill button');

console.log('dynamo-sim: all assertions passed');
