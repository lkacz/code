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
  placeDynamo(-4,10);
  setTile(-2,10,T.COPPER_WIRE);
  setTile(-1,10,T.COPPER_WIRE);
  chargeDynamo(-4,10);
  const battery={energy:0};
  const gained=teleporters.chargeBatteryAt(0,10,battery,1,getTile,dynamo,{capacity:50,rate:20});
  assert.ok(gained>0 && battery.energy>0,'generic power devices can charge a local battery through copper wires');
  assert.ok(teleporters.metrics().poweredWires>0,'generic network drains also animate powered wires');
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
  assert.deepEqual(c,{left:true,right:true,up:true,down:true},'copper cable layout exposes crossroads for smart rendering');
}

{
  reset();
  setTile(2,8,T.TELEPORTER);
  teleporters._debug.debugCharge(2,8,77,getTile);
  const snap=teleporters.snapshot();
  teleporters.reset();
  assert.equal(teleporters.metrics().machines,0,'reset clears teleporter battery state');
  teleporters.restore(snap,getTile);
  assert.equal(teleporters.metrics().machines,1,'restore rehydrates teleporter battery state');
  assert.equal(Math.round(teleporters.metrics().storedEnergy),77,'restore preserves stored teleporter energy');
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
