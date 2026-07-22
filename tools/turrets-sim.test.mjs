// Regression tests for powered defensive turrets.
// Verifies tile/resource registration, copper-network charging, targeting,
// elemental variants, save/restore, debug/menu hooks and bounded integration.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};
const { T, INFO, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } = await import('../src/constants.js');
const { dynamo } = await import('../src/engine/dynamo.js');
const { teleporters } = await import('../src/engine/teleporters.js');
const { weapons } = await import('../src/engine/weapons.js');
const { turrets } = await import('../src/engine/turrets.js');
const { bosses } = await import('../src/engine/bosses.js');

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
  if(turrets && turrets.onTileChanged) turrets.onTileChanged(x,y,old,v);
}
function reset(){
  tiles.clear();
  dynamo.reset();
  teleporters.reset();
  weapons.reset();
  turrets.reset();
  bosses.reset();
  globalThis.MM.world={getTile,setTile};
  delete globalThis.MM.worldGen;
  globalThis.MM.audio={play(){}};
  globalThis.MM.particles={spawnSparks(){}, spawnSplash(){}, spawnEnergyAbsorb(){}};
  globalThis.MM.water={onTileChanged(){}, disturb(){}};
  globalThis.MM.fire={heatAround(){}};
  delete globalThis.player;
  delete globalThis.MM.mobs;
  delete globalThis.MM.bosses;
  delete globalThis.MM.guardianLairs;
  delete globalThis.MM.ufo;
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
function fakeBossAt(x,y,hp=40){
  const part={hp};
  const boss={x,y,dead:false,parts:[part],core:null};
  const state={hits:0,scans:0};
  globalThis.MM.bosses={
    nearestForTurret(wx,wy,r,onlyBoss){
      state.scans++;
      if(onlyBoss && onlyBoss!==boss) return null;
      if(boss.dead || !(part.hp>0)) return null;
      const dx=x-wx, dy=y-wy;
      if(dx*dx+dy*dy>r*r) return null;
      return {kind:'boss',boss,part,x,y,tx:Math.floor(x),ty:Math.floor(y),hp:part.hp};
    },
    damageAt(tx,ty,dmg){
      if(boss.dead || !(part.hp>0)) return false;
      if(Math.abs((tx+0.5)-x)>1 || Math.abs((ty+0.5)-y)>1) return false;
      part.hp-=Math.max(0.5,Number(dmg)||1);
      state.hits++;
      if(part.hp<=0) boss.dead=true;
      return true;
    }
  };
  return {boss,part,state};
}
function fakeGuardianAt(x,y,hp=40){
  const guardian={x,y,hp,maxHp:hp,boss:true,dead:false};
  const state={hits:0,opts:null};
  globalThis.MM.guardianLairs={
    targetsForTurret(wx,wy,r,onlyBoss){
      if(onlyBoss && onlyBoss!==true && onlyBoss!==guardian) return [];
      if(guardian.dead || !(guardian.hp>0)) return [];
      const dx=x-wx, dy=y-wy;
      if(dx*dx+dy*dy>r*r) return [];
      return [{kind:'guardian',guardian,raw:guardian,x,y,tx:Math.floor(x),ty:Math.floor(y),hp:guardian.hp,d2:dx*dx+dy*dy}];
    },
    damageAt(tx,ty,dmg,opts){
      if(guardian.dead || !(guardian.hp>0)) return false;
      if(Math.abs((tx+0.5)-x)>1 || Math.abs((ty+0.5)-y)>1) return false;
      guardian.hp-=Math.max(0.5,Number(dmg)||1);
      guardian.dead=guardian.hp<=0;
      state.hits++;
      state.opts=opts;
      return true;
    }
  };
  return {guardian,state};
}
function fakeUfoAt(x,y,hp=60){
  const craft={name:'test saucer',archetype:'test',phase:'scan',x,y,hp,maxHp:hp,hullW:4,seed:1};
  const state={hits:0};
  globalThis.MM.ufo={
    current(){
      return craft.hp>0 ? Object.assign({},craft) : null;
    },
    damageAt(tx,ty,dmg){
      if(!(craft.hp>0)) return false;
      if(Math.abs((tx+0.5)-craft.x)>3 || Math.abs((ty+0.5)-craft.y)>2) return false;
      craft.hp-=Math.max(0.5,Number(dmg)||1);
      state.hits++;
      return true;
    }
  };
  return {craft,state};
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
function totalBossHp(boss){
  return (boss.parts||[]).reduce((sum,p)=>sum+Math.max(0,Number(p.hp)||0),0);
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
  const beforeDynamo=dynamo.metrics().storedEnergy;
  assert.equal(turrets.catchUp(30,null,getTile,setTile,{dynamo,teleporters}),true,'turret catch-up charges through copper wires while offscreen');
  assert.ok(turrets.metrics().storedEnergy>20,'turret catch-up stores offscreen network energy');
  assert.ok(dynamo.metrics().storedEnergy<beforeDynamo,'turret catch-up drains the real connected power source');
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
  globalThis.player={x:6.5,y:10.5,hp:40,w:0.7,h:0.95};
  let heroHits=0;
  globalThis.damageHero=(amount,opts)=>{
    heroHits++;
    assert.equal(opts.source,'turret');
    globalThis.player.hp-=Math.max(1,Math.round(Number(amount)||1));
    return true;
  };
  const mounted={};
  const res=turrets.fireMountedAt(
    T.FIRE_TURRET,
    mounted,
    1,
    {x:0,y:10,energy:turrets._debug.TURRET_CAPACITY},
    {kind:'hero',hero:globalThis.player,x:globalThis.player.x,y:globalThis.player.y-0.25,hp:globalThis.player.hp,source:'alien_mech'},
    getTile
  );
  assert.equal(res.fired,true,'a mounted mech fire turret can fire through the shared turret engine');
  assert.ok(heroHits>0 && globalThis.player.hp<40,'mounted turret damages the hero through damageHero');
  assert.ok(res.energy<turrets._debug.TURRET_CAPACITY,'mounted turret spends standard turret energy cost');
  assert.equal(turrets.metrics().machines,0,'mounted turret does not create a fake stationary world machine');
  assert.ok(turrets.metrics().shots>0,'mounted turret contributes to normal turret shot metrics');
  delete globalThis.damageHero;
}

{
  reset();
  setTile(0,10,T.TURRET);
  turrets._debug.debugChargeAt(0,10,turrets._debug.TURRET_CAPACITY,getTile);
  const {part,state}=fakeBossAt(6.5,10.5,32);
  for(let i=0;i<80;i++) tick(1/30);
  assert.ok(state.scans>0,'basic turret asks the boss system for hostile targets');
  assert.ok(turrets.metrics().shots>0,'basic turret fires when a boss part is in range');
  assert.ok(state.hits>0 && part.hp<32,'basic turret damages boss parts through the boss API');
}

{
  reset();
  setTile(0,10,T.FIRE_TURRET);
  turrets._debug.debugChargeAt(0,10,turrets._debug.TURRET_CAPACITY,getTile);
  const {guardian,state}=fakeGuardianAt(6.5,10.5,32);
  for(let i=0;i<80;i++) tick(1/30);
  assert.ok(state.hits>0 && guardian.hp<32,'fire turret damages guardian targets through the guardian API');
  assert.equal(state.opts && state.opts.source,'turret','guardian turret hits retain their autonomous source');
  assert.equal(state.opts && state.opts.element,'fire','guardian turret hits retain the turret element for boss weaknesses');
  assert.equal(state.opts && state.opts.kind,'fire_turret','guardian turret hits retain their concrete weapon family');
}

{
  reset();
  assert.ok(WORLD_MIN_Y<0 && WORLD_MAX_Y>WORLD_H,'turret tests cover extended vertical sections');
  setTile(0,-22,T.TURRET);
  turrets._debug.debugChargeAt(0,-22,turrets._debug.TURRET_CAPACITY,getTile);
  const {mob,state}=fakeMobAt(6.5,-21.5,24);
  for(let i=0;i<80;i++) tick(1/30,{x:0.5,y:-21.5,w:0.7,h:0.95});
  assert.ok(turrets.metrics().shots>0,'sky-layer turret fires when a mob approaches in range');
  assert.ok(state.hits>0 && mob.hp<24,'sky-layer turret damages the target mob');
  const snap=turrets.snapshot();
  assert.ok(snap.list.some(m=>m.y<0),'turret snapshot preserves sky-layer machines');
  turrets.reset();
  turrets.restore(snap,getTile);
  assert.equal(turrets.metrics().machines,1,'turret restore rehydrates sky-layer machines');
}

for(const tile of [T.FIRE_TURRET,T.WATER_TURRET]){
  reset();
  setTile(0,10,tile);
  turrets._debug.debugChargeAt(0,10,turrets._debug.TURRET_CAPACITY,getTile);
  if(tile===T.WATER_TURRET) turrets._debug.debugSetWaterAt(0,10,turrets._debug.WATER_TURRET_TANK,getTile);
  const {part,state}=fakeBossAt(6.5,10.5,32);
  for(let i=0;i<80;i++) tick(1/30);
  assert.ok(turrets.metrics().shots>0,(tile===T.FIRE_TURRET?'fire':'water')+' turret fires when a boss part is in range');
  assert.ok(state.hits>0 && part.hp<32,(tile===T.FIRE_TURRET?'fire':'water')+' turret damages boss parts through the boss API');
}

{
  reset();
  globalThis.MM.bosses=bosses;
  globalThis.MM.worldGen={surfaceHeight(){ return 90; }, biomeType(){ return 0; }, settings:{seaLevel:95}};
  globalThis.player={x:0,y:88,hp:100,maxHp:100,xp:0,vx:0,vy:0,hpInvul:0,tool:'basic'};
  bosses.setCycleOverride({isDay:true,tDay:0.5});
  for(let x=-12; x<=22; x++) setTile(x,90,T.STONE);
  setTile(0,88,T.TURRET);
  setTile(2,88,T.STONE);
  setTile(3,88,T.STONE);
  turrets._debug.debugChargeAt(0,88,turrets._debug.TURRET_CAPACITY,getTile);
  const boss=bosses.forceSpawn(getTile,{x:7,seed:1234,freeze:true});
  assert.ok(boss,'real boss spawns for turret line-of-sight regression');
  const machine=turrets._debug.ensureMachine(0,88,getTile);
  const target=turrets._debug.nearestBossTarget(machine,getTile);
  assert.ok(target,'turret finds a visible boss weak point when the closest low part is blocked');
  assert.ok(target.part && (target.part.role==='eye' || target.part.role==='core'),'turret targets only the eye or exposed heart, not block armor');
  const beforeHp=totalBossHp(boss);
  for(let i=0;i<120;i++) tick(1/30,globalThis.player);
  const after=turrets.metrics();
  assert.ok(after.shots>0,'turret fires at a real boss behind low cover');
  assert.ok(after.hits>0 && totalBossHp(boss)<beforeHp,'turret damages a real boss through a visible weak point');
}

{
  reset();
  setTile(0,10,T.TURRET);
  turrets._debug.debugChargeAt(0,10,turrets._debug.TURRET_CAPACITY,getTile);
  const {craft,state}=fakeUfoAt(6.5,10.5,60);
  for(let i=0;i<80;i++) tick(1/30);
  assert.ok(turrets.metrics().shots>0,'basic turret fires when a UFO is in range');
  assert.ok(state.hits>0 && craft.hp<60,'basic turret damages the UFO through the UFO API');
}

for(const tile of [T.FIRE_TURRET,T.WATER_TURRET]){
  reset();
  setTile(0,10,tile);
  turrets._debug.debugChargeAt(0,10,turrets._debug.TURRET_CAPACITY,getTile);
  if(tile===T.WATER_TURRET) turrets._debug.debugSetWaterAt(0,10,turrets._debug.WATER_TURRET_TANK,getTile);
  const {craft,state}=fakeUfoAt(6.5,10.5,60);
  for(let i=0;i<80;i++) tick(1/30);
  assert.ok(turrets.metrics().shots>0,(tile===T.FIRE_TURRET?'fire':'water')+' turret fires when a UFO is in range');
  assert.ok(state.hits>0 && craft.hp<60,(tile===T.FIRE_TURRET?'fire':'water')+' turret damages the UFO through the UFO API');
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

{
  reset();
  const cap=turrets._debug.MACHINE_CAP;
  for(let i=0;i<cap;i++){
    turrets._debug.machines.set('cap-'+i,{x:i,y:10,kind:'standard',energy:1,cooldown:0,scanT:0,pulse:0,aim:0,target:null,lastSeen:0,activeT:0});
  }
  setTile(9999,10,T.TURRET);
  assert.equal(turrets.ensureMachine(9999,10,getTile),null,'charged turret state is never evicted to exceed the registry cap');
  assert.equal(turrets._debug.machines.size,cap,'live turret registry remains hard-capped');
  assert.ok(turrets._debug.machines.has('cap-0'),'cap refusal preserves prior charged entries');
}

{
  reset();
  const cap=turrets._debug.MACHINE_CAP;
  setTile(25,10,T.TURRET);
  const hostile=Array.from({length:cap},()=>({x:0,y:Infinity,energy:90}));
  hostile.push({x:25,y:10,energy:55});
  turrets.restore({v:1,list:hostile},getTile);
  assert.equal(turrets.metrics().machines,0,'restore processes only a bounded prefix of oversized turret data');
}

{
  reset();
  setTile(1000,10,T.TURRET);
  const realTeleporters=globalThis.MM.teleporters;
  let chargeCalls=0;
  globalThis.MM.teleporters={chargeBatteryAt(){ chargeCalls++; return 1; }};
  turrets.update(1/30,{x:0.5,y:10.5},getTile,setTile,{dynamo});
  assert.equal(chargeCalls,0,'far-away turrets do not run cable-network charging each frame');
  for(let i=0;i<31;i++) turrets.update(1/30,{x:0.5,y:10.5},getTile,setTile,{dynamo});
  assert.equal(chargeCalls,1,'far-away turrets charge on a bounded one-second background tick');
  globalThis.MM.teleporters=realTeleporters;
}

{
  reset();
  setTile(0,10,T.TURRET);
  turrets._debug.debugSetEnergyAt(0,10,12,getTile);
  const realTeleporters=globalThis.MM.teleporters;
  let chargeCalls=0;
  globalThis.MM.teleporters={chargeBatteryAt(_x,_y,battery){ chargeCalls++; battery.energy=Infinity; return Infinity; }};
  turrets.update(0.1,{x:0.5,y:10.5},getTile,setTile,{dynamo});
  assert.equal(chargeCalls,1,'nearby turret still asks its network charger');
  assert.equal(turrets.metrics().storedEnergy,12,'invalid charger output cannot mint infinite turret energy');
  globalThis.MM.teleporters={chargeBatteryAt(){ throw new Error('network failure'); }};
  assert.doesNotThrow(()=>turrets.update(0.1,{x:0.5,y:10.5},getTile,setTile,{dynamo}),'charger failure cannot abort the turret update loop');
  assert.equal(turrets.metrics().storedEnergy,12,'charger failure preserves the local turret battery');
  globalThis.MM.teleporters=realTeleporters;
}

{
  const state={x:0,y:10,kind:'water',energy:90,water:5,cooldown:0,scanT:0,pulse:0,aim:0,activeT:0};
  assert.equal(turrets._debug.fireAt(state,{},getTile),false,'invalid target coordinates cannot fire a water turret');
  assert.equal(state.water,5,'invalid target coordinates do not consume water');
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

const bossesSrc = await readFile(new URL('../src/engine/bosses.js', import.meta.url), 'utf8');
assert.match(bossesSrc, /function nearestForTurret\(sx,sy,range,onlyMonster\)/, 'bosses expose a turret targeting query');
assert.match(bossesSrc, /function targetsForTurret\(sx,sy,range,onlyMonster\)/, 'bosses expose sorted turret target candidates');
assert.match(bossesSrc, /nearestForAbduction, nearestForTurret, targetsForTurret, abduct/, 'boss turret targeting is part of the public boss API');

console.log('turrets-sim: all assertions passed');
