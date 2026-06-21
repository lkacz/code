// Infrastructure overlay regressions: pipes/cables coexist with terrain while
// still powering hydraulic/electric networks.
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};

const { T } = await import('../src/constants.js');
const { world } = await import('../src/engine/world.js');
const { dynamo } = await import('../src/engine/dynamo.js');
const { teleporters } = await import('../src/engine/teleporters.js');
const { pumps } = await import('../src/engine/pumps.js');
const { turrets } = await import('../src/engine/turrets.js');

const getTile = (x,y)=>world.getTile(x,y);
const getNetworkTile = (x,y)=>world.getNetworkTile(x,y);
const setTile = (x,y,t)=>world.setTile(x,y,t);
const setOverlay = (x,y,t)=>world.setInfrastructure(x,y,t);

function reset(){
  world.clear();
  dynamo.reset();
  teleporters.reset();
  pumps.reset();
  turrets.reset();
  globalThis.MM.world = world;
  globalThis.MM.audio = {play(){}};
  globalThis.MM.particles = {spawnSparks(){}, spawnSplash(){}, spawnEnergyAbsorb(){}};
  globalThis.MM.fire = {heatAround(){}};
}

reset();
setTile(0,20,T.STONE);
setOverlay(0,20,T.COPPER_WIRE);
assert.equal(getTile(0,20),T.STONE,'copper cable overlay does not replace stone terrain');
assert.equal(getNetworkTile(0,20),T.COPPER_WIRE,'network getter sees copper cable overlay');
let snap=world.snapshotInfrastructure();
assert.deepEqual(snap.list.map(o=>[o.x,o.y,o.t]),[[0,20,T.COPPER_WIRE]],'infrastructure snapshot captures overlay cells');
world.clearInfrastructure(0,20);
assert.equal(getNetworkTile(0,20),T.STONE,'clearing overlay reveals original terrain');
world.restoreInfrastructure(snap);
assert.equal(getTile(0,20),T.STONE,'restore keeps terrain under overlay');
assert.equal(getNetworkTile(0,20),T.COPPER_WIRE,'restore revives cable overlay');

reset();
dynamo.plannedCells(-4,30,'horizontal').forEach(c=>setTile(c.x,c.y,c.t));
setTile(-2,30,T.STONE);
setTile(-1,30,T.SAND);
setTile(0,30,T.TELEPORTER);
setOverlay(-2,30,T.COPPER_WIRE);
setOverlay(-1,30,T.COPPER_WIRE);
for(let i=0;i<50;i++) dynamo.recordFlow(-4,30,T.WATER,4,getTile);
teleporters.update(1,{x:20,y:20,w:0.7,h:0.95,vx:0,vy:0},getNetworkTile,setTile,{dynamo});
assert.equal(getTile(-2,30),T.STONE,'powered cable preserves stone underneath');
assert.equal(getTile(-1,30),T.SAND,'powered cable preserves sand underneath');
assert.ok(teleporters.metrics().storedEnergy>0,'teleporter charges through cable overlays on terrain');

reset();
setTile(-2,40,T.WATER);
setOverlay(-2,40,T.WATER_PIPE);
setTile(-1,40,T.STONE);
setOverlay(-1,40,T.WATER_PIPE);
setTile(0,40,T.WATER_PUMP);
pumps.setOrientationAt(0,40,'east',getTile);
setTile(1,40,T.STONE);
setTile(2,40,T.SAND);
setOverlay(1,40,T.WATER_PIPE);
setOverlay(2,40,T.WATER_PIPE);
setTile(3,40,T.WATER_TURRET);
turrets._debug.debugSetWaterAt(3,40,0,getTile);
pumps._debug.debugSetEnergyAt(0,40,pumps._debug.PUMP_CAPACITY,getTile);
for(let i=0;i<90;i++){
  pumps.update(1/30,{x:0.5,y:40.5,w:0.7,h:0.95},getNetworkTile,setTile,{dynamo});
  turrets.update(1/30,{x:0.5,y:40.5,w:0.7,h:0.95},getTile,setTile,{dynamo,teleporters,pumps});
}
assert.equal(getTile(-2,40),T.WATER,'water pipe can sit inside a water tile without replacing water');
assert.equal(getNetworkTile(-2,40),T.WATER_PIPE,'network getter sees water pipe inside water');
assert.ok(turrets.metrics().storedWater>0,'pump draws from a pipe overlay placed inside water');

reset();
setTile(-4,50,T.WATER);
setTile(-4,51,T.WATER);
setTile(-4,52,T.WATER);
setOverlay(-3,52,T.WATER_PIPE);
setOverlay(-2,52,T.WATER_PIPE);
setOverlay(-1,52,T.WATER_PIPE);
setOverlay(0,52,T.WATER_PIPE);
setOverlay(0,53,T.WATER_PIPE);
setOverlay(0,54,T.WATER_PIPE);
setOverlay(0,55,T.WATER_PIPE);
setOverlay(0,56,T.WATER_PIPE);
setOverlay(0,57,T.WATER_PIPE);
setTile(0,58,T.WATER);
for(let i=0;i<150;i++){
  pumps.update(1/30,{x:-1,y:54,w:0.7,h:0.95},getNetworkTile,setTile,{dynamo});
}
assert.equal(getTile(-4,50),T.AIR,'unpowered pipe network drains one unit from the higher reservoir surface');
assert.equal(getTile(0,57),T.WATER,'unpowered pipe network delivers water into the lower reservoir through the pipe endpoint');
assert.equal(getNetworkTile(0,57),T.WATER_PIPE,'delivered water can occupy the terrain under a pipe overlay');
assert.ok(pumps.metrics().passiveMoved>0,'pump metrics record passive no-pump pipe transfer');

reset();
setTile(-4,70,T.WATER);
setTile(-3,70,T.AIR);
setTile(-2,70,T.AIR);
setTile(0,75,T.AIR);
setOverlay(-1,70,T.WATER_PIPE);
setOverlay(0,70,T.WATER_PIPE);
setOverlay(0,71,T.WATER_PIPE);
setOverlay(0,72,T.WATER_PIPE);
setOverlay(0,73,T.WATER_PIPE);
setOverlay(0,74,T.WATER_PIPE);
for(let i=0;i<150;i++){
  pumps.update(1/30,{x:-1,y:72,w:0.7,h:0.95},getNetworkTile,setTile,{dynamo});
}
assert.equal(getTile(-4,70),T.AIR,'pipe intake can pull a stranded water remnant across a one-tile dry gap');
assert.equal(getTile(0,75),T.WATER,'stranded remnant exits through the lower open pipe end');

console.log('infrastructure-overlay-sim: all assertions passed');
