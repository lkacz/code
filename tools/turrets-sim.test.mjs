// Regression tests for powered defensive turrets.
// Verifies tile/resource registration, copper-network charging, targeting,
// elemental variants, save/restore, debug/menu hooks and bounded integration.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};
const { T, INFO, WORLD_H } = await import('../src/constants.js');
const { dynamo } = await import('../src/engine/dynamo.js');
const { teleporters } = await import('../src/engine/teleporters.js');
const { weapons } = await import('../src/engine/weapons.js');
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
  if(turrets && turrets.onTileChanged) turrets.onTileChanged(x,y,old,v);
}
function reset(){
  tiles.clear();
  dynamo.reset();
  teleporters.reset();
  weapons.reset();
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
function placePoweredTurret(tile=T.TURRET,x=0,y=10){
  placeDynamo(x-4,y);
  setTile(x-2,y,T.COPPER_WIRE);
  setTile(x-1,y,T.COPPER_WIRE);
  setTile(x,y,tile);
  chargeDynamo(x-4,y);
}
function tick(dt,player){
  turrets.update(dt,player||{x:0.5,y:10.5},getTile,setTile,{dynamo,teleporters});
}
function fakeMobAt(x,y,hp=30){
  const mob={x,y,hp,id:'WOLF',vx:0,vy:0};
  const state={hits:0,burns:0,douses:0};
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
    igniteAt(tx,ty){
      if(Math.abs((tx+0.5)-mob.x)>1 || Math.abs((ty+0.5)-mob.y)>1) return false;
      state.burns++;
      return true;
    },
    douseRadius(wx,wy,r){
      const dx=mob.x-wx, dy=mob.y-wy;
      if(dx*dx+dy*dy<=r*r){ state.douses++; return 1; }
      return 0;
    }
  };
  return {mob,state};
}
function fakeFireAt(cells){
  const burning=new Set(cells.map(([x,y])=>k(x,y)));
  const state={extinguished:0};
  globalThis.MM.fire={
    heatAround(){},
    isBurning(x,y){ return burning.has(k(x,y)); },
    extinguish(x,y){
      const id=k(x,y);
      const had=burning.delete(id);
      if(had) state.extinguished++;
      return had;
    },
    count(){ return burning.size; }
  };
  return state;
}

assert.equal(T.TURRET,44,'basic turret has a stable tile id after antigravity beacon');
assert.equal(T.FIRE_TURRET,45,'fire turret has a stable tile id after basic turret');
assert.equal(T.WATER_TURRET,46,'water turret has a stable tile id after fire turret');
assert.equal(INFO[T.TURRET].powerDevice,true,'basic turret is a powered device endpoint');
assert.equal(INFO[T.FIRE_TURRET].powerDevice,true,'fire turret is a powered device endpoint');
assert.equal(INFO[T.WATER_TURRET].powerDevice,true,'water turret is a powered device endpoint');
assert.equal(INFO[T.TURRET].passable,false,'turrets are solid defensive machines');

{
  reset();
  placePoweredTurret(T.TURRET,0,10);
  assert.equal(teleporters.cableConnections(-1,10,getTile).right,true,'copper cables connect visually to turret power-device endpoints');
  const beforeDynamo=dynamo.metrics().storedEnergy;
  tick(1.0);
  tick(1.0);
  const m=turrets.metrics();
  assert.ok(m.storedEnergy>20,'turret battery charges from a linked dynamo through copper wires');
  assert.ok(dynamo.metrics().storedEnergy<beforeDynamo,'charging a turret drains real stored dynamo energy');
}

{
  reset();
  placePoweredTurret(T.TURRET,0,10);
  for(let i=0;i<4;i++) tick(0.5);
  const beforeEnergy=turrets.metrics().storedEnergy;
  const {mob,state}=fakeMobAt(7.5,10.5,24);
  for(let i=0;i<80;i++) tick(1/30);
  const after=turrets.metrics();
  assert.ok(after.shots>0,'basic turret fires when a mob approaches in range');
  assert.ok(state.hits>0 && mob.hp<24,'basic turret damages the target mob');
  assert.ok(after.storedEnergy<beforeEnergy,'basic turret spends local battery energy per shot');
}

{
  reset();
  setTile(0,10,T.FIRE_TURRET);
  turrets._debug.debugChargeAt(0,10,turrets._debug.TURRET_CAPACITY,getTile);
  const {mob,state}=fakeMobAt(6.5,10.5,20);
  for(let i=0;i<70;i++) tick(1/30);
  assert.ok(turrets.metrics().shots>0,'fire turret fires at nearby mobs');
  assert.ok(weapons.metrics().puffs>0,'fire turret emits the shared flamethrower stream puffs');
  assert.equal(turrets._debug.shots.length,0,'fire turret no longer draws a separate beam/line shot');
  assert.ok(state.burns>0,'fire turret applies burn status through the mob API');
  assert.ok(mob.hp<20,'fire turret still deals direct damage');
}

{
  reset();
  setTile(0,10,T.WATER_TURRET);
  turrets._debug.debugChargeAt(0,10,turrets._debug.TURRET_CAPACITY,getTile);
  const {mob,state}=fakeMobAt(5.5,10.5,20);
  for(let i=0;i<50;i++) tick(1/30);
  assert.ok(turrets.metrics().shots>0,'water turret fires at nearby mobs');
  assert.ok(state.douses>0,'water turret douses burning targets through the mob API');
  assert.ok(state.hits>0 && mob.hp<20,'water turret inflicts only small direct damage while pushing');
  assert.ok(Math.abs(mob.vx)>0.01,'water turret applies a small knockback to its target');
}

{
  reset();
  setTile(0,10,T.WATER_TURRET);
  setTile(5,10,T.WOOD);
  const fireState=fakeFireAt([[5,10]]);
  turrets._debug.debugChargeAt(0,10,turrets._debug.TURRET_CAPACITY,getTile);
  for(let i=0;i<50;i++) tick(1/30);
  assert.ok(turrets.metrics().shots>0,'water turret acts as a fire brigade when no hostile mob is present');
  assert.ok(fireState.extinguished>0,'water turret extinguishes the visible burning tile');
  assert.equal(globalThis.MM.fire.count(),0,'water turret clears the targeted fire');
}

{
  reset();
  setTile(0,10,T.WATER_TURRET);
  setTile(3,8,T.WOOD);
  const fireState=fakeFireAt([[3,8]]);
  turrets._debug.debugChargeAt(0,10,turrets._debug.TURRET_CAPACITY,getTile);
  const {mob,state}=fakeMobAt(5.5,10.5,20);
  for(let i=0;i<50;i++) tick(1/30);
  assert.ok(state.hits>0 && mob.hp<20,'water turret keeps hostile targets ahead of firefighting');
  assert.equal(fireState.extinguished,0,'water turret does not switch to fire while a hostile target is present');
  assert.equal(globalThis.MM.fire.count(),1,'visible fire remains until hostile targets are gone');
}

{
  reset();
  setTile(0,10,T.WATER_TURRET);
  setTile(2,10,T.STONE);
  setTile(5,10,T.WOOD);
  const fireState=fakeFireAt([[5,10]]);
  turrets._debug.debugChargeAt(0,10,turrets._debug.TURRET_CAPACITY,getTile);
  for(let i=0;i<60;i++) tick(1/30);
  assert.equal(turrets.metrics().shots,0,'water turret does not shoot fire through solid terrain');
  assert.equal(fireState.extinguished,0,'blocked fire remains untouched');
}

{
  reset();
  setTile(0,10,T.TURRET);
  setTile(3,10,T.STONE);
  turrets._debug.debugChargeAt(0,10,turrets._debug.TURRET_CAPACITY,getTile);
  const {state}=fakeMobAt(7.5,10.5,20);
  for(let i=0;i<80;i++) tick(1/30);
  assert.equal(state.hits,0,'solid terrain blocks turret line of sight');
  assert.equal(turrets.metrics().shots,0,'blocked turrets do not waste battery firing through walls');
}

{
  reset();
  setTile(2,8,T.WATER_TURRET);
  turrets._debug.debugChargeAt(2,8,55,getTile);
  const snap=turrets.snapshot();
  turrets.reset();
  assert.equal(turrets.metrics().machines,0,'reset clears turret machine state');
  turrets.restore(snap,getTile);
  assert.equal(turrets.metrics().machines,1,'restore rehydrates turret battery state');
  assert.equal(Math.round(turrets.metrics().storedEnergy),55,'restore preserves stored turret energy');
  setTile(2,8,T.AIR);
  assert.equal(turrets.metrics().machines,0,'tile removal prunes turret machine state');
}

const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
assert.match(mainSrc, /import \{ turrets as TURRETS \}/, 'main imports the turret engine');
assert.match(mainSrc, /TURRETS\.update\(dt, player, getTile, setTile, \{dynamo:DYNAMO, teleporters:TELEPORTERS, pumps:PUMPS\}\)/, 'main updates turrets with power-network and pump access');
assert.match(mainSrc, /TURRETS\.draw\(ctx,TILE,sx,sy,viewX,viewY,worldFxVisible,getTile\)/, 'main draws turret overlays and shot FX');
assert.match(mainSrc, /turrets:\s*timedSavePart\('turrets',[^\n]*TURRETS && TURRETS\.snapshot/, 'main saves turret battery state');
assert.match(mainSrc, /TURRETS\.restore\(data\.turrets,getTile\)/, 'main restores turret battery state');
assert.match(mainSrc, /id:'fire_turret'/, 'crafting exposes fire turret');
assert.match(mainSrc, /id:'water_turret'/, 'crafting exposes water turret');
assert.match(mainSrc, /function placeDebugTurretRig\(\)/, 'main exposes a debug action that places a powered turret rig');
assert.match(mainSrc, /MM\.ui\.injectTurretDebugPanel/, 'main injects the turret debug panel');

const uiSrc = await readFile(new URL('../src/engine/ui.js', import.meta.url), 'utf8');
assert.match(uiSrc, /function injectTurretDebugPanel\(actions, menuPanel\)/, 'ui exposes a turret debug panel injector');
assert.match(uiSrc, /box\.id='turretDebugBox'/, 'turret debug panel has a stable DOM id');
assert.match(uiSrc, /Postaw ogniowa/, 'turret debug panel includes a fire turret button');
assert.match(uiSrc, /Postaw wodna/, 'turret debug panel includes a water turret button');
assert.match(uiSrc, /Uklad testowy/, 'turret debug panel includes a powered rig button');

const worldSrc = await readFile(new URL('../src/engine/world.js', import.meta.url), 'utf8');
assert.match(worldSrc, /MM\.turrets && MM\.turrets\.onTileChanged/, 'world lifecycle notifies turrets about tile changes');

console.log('turrets-sim: all assertions passed');
