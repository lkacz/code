// Vending-machine regression tests: generated city caches are one-shot unless
// powered, player-placed machines require adjacent power, and stock persists.
// Run: npm run test:vending
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};

const { T, WORLD_H } = await import('../src/constants.js');
await import('../src/inventory.js');
const { dynamo } = await import('../src/engine/dynamo.js');
const { teleporters } = await import('../src/engine/teleporters.js');
const { vending } = await import('../src/engine/vending.js');

const resourceKeys = new Set(globalThis.MM.inventory.RESOURCES.map(r => r.key));
for(const row of ['sand','water','diamond','iridium','vendingMachine','copperWire','waterPipe']){
  assert.ok(resourceKeys.has(row), 'vending resource '+row+' is registered');
}

function sequence(values){
  let i=0;
  return () => values[Math.min(i++, values.length-1)];
}

assert.equal(vending.rollVendingLoot(sequence([0.10,0,0])).tier, 'junk', 'low roll produces junk');
assert.equal(vending.rollVendingLoot(sequence([0.62,0,0])).tier, 'useful', 'middle roll produces useful supplies');
assert.equal(vending.rollVendingLoot(sequence([0.86,0,0])).tier, 'value', 'high roll produces valuables');
assert.equal(vending.rollVendingLoot(sequence([0.99,0,0])).tier, 'rare', 'top roll produces rare salvage');

const tiles = new Map();
const key = (x,y)=>Math.floor(x)+','+Math.floor(y);
const inv = {};
let testDay = 1;
function getTile(x,y){
  if(y<0 || y>=WORLD_H) return T.STONE;
  return tiles.get(key(x,y)) ?? T.AIR;
}
function getElectricNetworkTile(x,y){ return getTile(x,y); }
function setTile(x,y,t){
  if(y<0 || y>=WORLD_H) return;
  const k=key(x,y);
  if(t===T.AIR) tiles.delete(k);
  else tiles.set(k,t);
}
function addResource(name,n){
  if(!resourceKeys.has(name)) return false;
  inv[name]=(inv[name]||0)+n;
  return true;
}
function resetWorld(){
  tiles.clear();
  for(const k of Object.keys(inv)) delete inv[k];
  testDay = 1;
  dynamo.reset();
  teleporters.reset();
  vending.reset();
}
function baseCtx(rng){
  return {getTile,setTile,addResource,rng,gameDayFloat:()=>testDay};
}
function poweredCtx(rng){
  return {getTile,setTile,addResource,rng,dynamo,teleporters,getElectricNetworkTile,gameDayFloat:()=>testDay};
}

resetWorld();
setTile(0,0,T.VENDING_MACHINE);
vending.onPlaced(0,0,getTile);
let res = vending.vendAt(0,0,baseCtx(sequence([0.62,0,0])));
assert.equal(res.ok, false, 'player-placed vending machine refuses to run without adjacent power');
assert.equal(res.reason, 'power', 'unpowered player-placed vending machine reports power reason');
assert.equal(getTile(0,0), T.VENDING_MACHINE, 'unpowered player-placed vending machine remains intact');
setTile(1,0,T.DYNAMO);
res = vending.vendAt(0,0,baseCtx(sequence([0.62,0,0.50])));
assert.equal(res.ok, true, 'adjacent power source lets player-placed vending machine vend');
assert.equal(res.loot.key, 'water', 'deterministic useful roll can dispense water');
assert.equal(res.usesLeft, vending.MAX_USES-1, 'first powered use consumes one stock');
res = vending.vendAt(0,0,baseCtx(()=>0.10));
assert.equal(res.ok, false, 'powered vending machine refuses a second draw on the same day');
assert.equal(res.reason, 'cooldown', 'same-day powered vending reports cooldown');
assert.equal(getTile(0,0), T.VENDING_MACHINE, 'cooldown does not break the vending machine');
for(let day=2; day<=vending.MAX_USES; day++){
  testDay = day;
  res = vending.vendAt(0,0,baseCtx(()=>0.10));
}
assert.equal(res.ok, true, 'last powered use still succeeds');
assert.equal(res.broke, true, 'machine breaks after the tenth powered use');
assert.equal(getTile(0,0), T.AIR, 'exhausted vending machine removes its tile');
assert.ok((inv.copperWire||0)>=1, 'exhausted vending machine grants copper-wire scrap');

resetWorld();
dynamo.plannedCells(-4,2,'horizontal').forEach(c=>setTile(c.x,c.y,c.t));
setTile(-2,2,T.COPPER_WIRE);
setTile(-1,2,T.COPPER_WIRE);
setTile(0,2,T.VENDING_MACHINE);
vending.onPlaced(0,2,getTile);
for(let i=0;i<50;i++) dynamo.recordFlow(-4,2,T.WATER,4,getTile);
const beforeNetworkVend=dynamo.metrics().storedEnergy;
res = vending.vendAt(0,2,poweredCtx(sequence([0.62,0,0.50])));
assert.equal(res.ok, true, 'player-placed vending machine can run from a copper-wire power network');
assert.equal(res.source.kind, 'network', 'copper-powered vending reports network power');
assert.ok(dynamo.metrics().storedEnergy < beforeNetworkVend, 'copper-powered vending drains real network energy');
assert.equal(res.usesLeft, vending.MAX_USES-1, 'network-powered vending consumes one stock');
const afterNetworkVend=dynamo.metrics().storedEnergy;
res = vending.vendAt(0,2,poweredCtx(sequence([0.62,0,0.50])));
assert.equal(res.ok, false, 'network-powered vending also enforces one draw per day');
assert.equal(res.reason, 'cooldown', 'network same-day refusal is cooldown');
assert.equal(dynamo.metrics().storedEnergy, afterNetworkVend, 'same-day cooldown does not drain network energy');

resetWorld();
setTile(5,5,T.VENDING_MACHINE);
res = vending.vendAt(5,5,baseCtx(sequence([0.86,0,0])));
assert.equal(res.ok, true, 'generated untracked city vending machine can cough up one ancient prize');
assert.equal(res.powered, false, 'untracked generated vending use is explicitly unpowered');
assert.equal(res.broke, true, 'unpowered generated vending machine is one-shot');
assert.equal(getTile(5,5), T.AIR, 'one-shot generated vending machine disappears after use');

resetWorld();
setTile(10,10,T.VENDING_MACHINE);
setTile(11,10,T.DYNAMO);
res = vending.vendAt(10,10,baseCtx(sequence([0.86,0,0])));
assert.equal(res.ok, true, 'generated powered vending machine becomes a stocked appliance');
assert.equal(res.broke, false, 'powered generated vending machine is not one-shot');
assert.equal(res.usesLeft, vending.MAX_USES-1, 'powered generated vending starts with full stock');
assert.equal(getTile(10,10), T.VENDING_MACHINE, 'powered generated vending machine remains placed');
res = vending.vendAt(10,10,baseCtx(()=>0.10));
assert.equal(res.ok, false, 'generated powered vending machine also cools down for the day');
testDay = 2;
res = vending.vendAt(10,10,baseCtx(()=>0.10));
assert.equal(res.ok, true, 'generated powered vending machine is ready again on the next day');

resetWorld();
setTile(20,20,T.VENDING_MACHINE);
setTile(21,20,T.DYNAMO);
vending.onPlaced(20,20,getTile);
testDay = 17;
vending.vendAt(20,20,baseCtx(()=>0.10));
const snap = vending.snapshot();
assert.equal(snap.list.length, 1, 'snapshot records tracked vending machine');
assert.equal(snap.list[0].usesLeft, vending.MAX_USES-1, 'snapshot records remaining stock');
assert.equal(snap.list[0].lastVendDay, 17, 'snapshot records vending daily cooldown');
vending.reset();
assert.equal(vending.metrics().machines, 0, 'reset clears vending state');
vending.restore(snap,getTile);
assert.equal(vending.metrics().stock, vending.MAX_USES-1, 'restore rehydrates vending stock');
res = vending.vendAt(20,20,baseCtx(()=>0.10));
assert.equal(res.ok, false, 'restore keeps same-day vending cooldown');
testDay = 18;
res = vending.vendAt(20,20,baseCtx(()=>0.10));
assert.equal(res.ok, true, 'restored vending machine is usable on the next day');
setTile(20,20,T.AIR);
vending.update(1,getTile);
assert.equal(vending.metrics().machines, 0, 'update prunes missing restored vending tiles');

console.log('vending-sim: all assertions passed');
