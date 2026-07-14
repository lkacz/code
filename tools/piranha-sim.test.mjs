// Piranha regression: sea/ocean water should become a fast horde threat for
// swimmers, without turning small puddles or inland lakes into ambush zones.
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.CustomEvent = class { constructor(type,opts){ this.type=type; this.detail=opts&&opts.detail; } };
globalThis.dispatchEvent = () => true;
let simNow = 0;
globalThis.performance = { now:()=>simNow };

const { T, MOVE } = await import('../src/constants.js');
const { worldGen } = await import('../src/engine/worldgen.js');
const { meat } = await import('../src/engine/meat.js');
const { mobs } = await import('../src/engine/mobs.js');

const originalBiomeType = worldGen.biomeType;
const originalOceanBasinAt = worldGen.oceanBasinAt;
const originalRandom = Math.random;
const originalCompanions = globalThis.MM.companions;
const originalInvasions = globalThis.MM.invasions;
const originalBoats = globalThis.MM.boats;

let rnd = 123456789;
function seededRandom(){
  rnd = (Math.imul(rnd,1664525)+1013904223)>>>0;
  return rnd/4294967296;
}

function seaTile(_x,y){
  if(y>=10 && y<=16) return T.WATER;
  if(y>=17) return T.STONE;
  return T.AIR;
}
function shallowSeaTile(_x,y){
  if(y===10) return T.WATER;
  if(y>=11) return T.STONE;
  return T.AIR;
}
function gentleShelfTile(x,y){
  const tx=Math.floor(x);
  const depth=tx<0 ? 0 : (tx<26 ? 1 : (tx<64 ? 2 : 7));
  if(y>=10 && y<10+depth) return T.WATER;
  if(y>=10+depth) return T.STONE;
  return T.AIR;
}
function baitSea(meatTile,tx=1,ty=11){
  const tiles = new Map();
  const key=(x,y)=>`${Math.floor(x)},${Math.floor(y)}`;
  tiles.set(key(tx,ty),meatTile);
  if(meatTile===T.MEAT || meatTile===T.ROTTEN_MEAT) meat.noteMeat(tx,ty,{age:meatTile===T.ROTTEN_MEAT?60:0});
  return {
    getTile(x,y){
      const k=key(x,y);
      if(tiles.has(k)) return tiles.get(k);
      return seaTile(x,y);
    },
    setTile(x,y,t){ tiles.set(key(x,y),t); }
  };
}

try{
  Math.random = seededRandom;
  worldGen.biomeType = () => 5;
  worldGen.oceanBasinAt = () => ({left:-80,right:80,width:161});

  const spec = mobs._debugSpecies().PIRANHA;
  assert.ok(spec && mobs.species.includes('PIRANHA'), 'piranha species is registered');
  assert.ok(spec.alwaysAggro, 'piranhas are hostile without needing the hero to strike first');
  assert.equal(spec.strictWater, true, 'piranhas use strict water confinement');
  assert.ok(spec.spawnBatch>=6 && spec.localMax>=12, 'piranhas are configured as a horde species');
  assert.ok(spec.contactInvulMs<=300, 'piranha bites use short hero i-frames');
  assert.ok(spec.speed*1.05*1.2 > MOVE.MAX*2, 'even a slow piranha is faster than the normal hero movement cap');
  assert.ok(spec.meatDropChance>0 && spec.meatDropChance<=0.04, 'dead piranhas have very low odds of turning into meat');
  const piranhaEcology=mobs._debugPiranhas();
  assert.equal(piranhaEcology.coastalRange,500, 'piranha coastal pressure uses a 500 m shore range');
  worldGen.oceanBasinAt = () => ({left:-800,right:800,width:1601});
  const nearCoast=piranhaEcology.coastProfile(-700);
  const coastalFade=piranhaEcology.coastProfile(-375);
  const openOcean=piranhaEcology.coastProfile(0);
  assert.equal(nearCoast.distance,100, 'coast profile measures distance to the nearest shore');
  assert.equal(nearCoast.density,1, 'the inner coastal belt keeps full piranha pressure');
  assert.ok(coastalFade.density<nearCoast.density && coastalFade.density>openOcean.density, 'piranha pressure fades smoothly before 500 m');
  assert.ok(openOcean.density>0 && openOcean.density<0.15, 'open-ocean piranhas are rare rather than forbidden');
  assert.ok(openOcean.ambushChance>0, 'an offshore swimmer still has a non-zero ambush chance');
  assert.equal(spec.spawnDensityAt(0),openOcean.density, 'ordinary ecological spawning uses the same coast profile');
  worldGen.oceanBasinAt = () => ({left:-80,right:80,width:161});
  assert.ok(meat.baitProfileForTile(T.MEAT).duration > meat.baitProfileForTile(T.BAKED_MEAT).duration, 'raw meat distracts piranhas longer than cooked meat');
  assert.ok(meat.baitProfileForTile(T.BAKED_MEAT).duration > meat.baitProfileForTile(T.ROTTEN_MEAT).duration, 'cooked meat distracts piranhas longer than rotten meat');
  assert.equal(spec.spawnTest(0,12,seaTile), true, 'piranhas spawn in real sea water');
  assert.equal(spec.spawnTest(0,10,shallowSeaTile), false, 'piranhas reject shallow puddle-depth water');
  meat.reset();
  const bakedSea = baitSea(T.BAKED_MEAT,3,11);
  const bakedBait = meat.nearestWaterBait(0.5,11.4,8,bakedSea.getTile);
  assert.equal(bakedBait?.kind, 'baked', 'baked meat touching sea water is valid piranha bait even without decay tracking');

  worldGen.biomeType = () => 6;
  worldGen.oceanBasinAt = () => null;
  assert.equal(spec.spawnTest(0,12,seaTile), false, 'piranhas do not treat ordinary inland lakes as ocean water');

  worldGen.biomeType = () => 5;
  worldGen.oceanBasinAt = () => ({left:-80,right:80,width:161});
  const player = {x:0.5,y:11.4,w:0.7,h:0.95,hp:100,maxHp:100,vx:0,vy:0,hpInvul:0};
  globalThis.player = player;
  const bites = [];
  globalThis.damageHero = (amount,opts)=>{
    if(player.hpInvul && simNow<player.hpInvul) return false;
    bites.push({amount,opts});
    player.hp -= Math.round(amount);
    player.hpInvul = simNow + (opts.invulMs||600);
    return true;
  };
  globalThis.msg = () => {};

  mobs.clearAll();
  mobs.deserialize({
    v:4,
    list:[{id:'PIRANHA',x:2.5,y:9.55,vx:0,vy:-2.8,hp:5,maxHp:5,scale:1,speedMul:1.1,jumpMul:1,attackCd:3,waterTopY:10,waterBottomY:16,desiredDepth:0}],
    aggro:{mode:'rel',m:{}}
  });
  mobs.freezeSpawns(10000);
  player.x=40; player.y=4; player.vx=0; player.vy=0; player.hpInvul=0;
  simNow += 50;
  mobs.update(0.05,player,seaTile,()=>{});
  const surfacedFish = mobs.serialize().list.find(m=>m.id==='PIRANHA');
  assert.ok(surfacedFish, 'surface-clamped piranha remains alive');
  assert.equal(seaTile(Math.floor(surfacedFish.x),Math.floor(surfacedFish.y)), T.WATER, 'piranhas are snapped back into water when upward movement carries them above the surface');
  assert.ok(surfacedFish.vy>=0, 'piranha upward velocity is cancelled at the water surface');

  mobs.clearAll();
  simNow = 5000;
  player.x=0.5; player.y=11.4; player.vx=0; player.vy=0; player.hpInvul=0;
  mobs.update(0.05,player,seaTile,()=>{});
  let piranhas = mobs.serialize().list.filter(m=>m.id==='PIRANHA');
  assert.ok(piranhas.length>=6, 'a swimmer in sea water triggers a piranha horde quickly');

  const beforeDist = Math.min(...piranhas.map(m=>Math.hypot(m.x-player.x,m.y-player.y)));
  for(let i=0;i<25;i++){
    simNow += 80;
    mobs.update(0.08,player,seaTile,()=>{});
  }
  piranhas = mobs.serialize().list.filter(m=>m.id==='PIRANHA');
  const afterDist = Math.min(...piranhas.map(m=>Math.hypot(m.x-player.x,m.y-player.y)));
  assert.ok(afterDist<beforeDist, 'piranha horde closes on a swimming hero');

  // Regression for long, shallow shelves: the old three-tile depth gate plus a
  // ~15 tile search radius made this entire shoreline appear piranha-free.
  mobs.clearAll();
  worldGen.biomeType = x => x>=0 && x<=1000 ? 5 : 1;
  worldGen.oceanBasinAt = x => x>=0 && x<=1000 ? {left:0,right:1000,width:1001} : null;
  player.x=0.5; player.y=10.2; player.vx=0; player.vy=0; player.hpInvul=0;
  simNow += 5000;
  mobs.update(0.05,player,gentleShelfTile,()=>{});
  const shelfPiranhas=mobs.serialize().list.filter(m=>m.id==='PIRANHA');
  assert.ok(shelfPiranhas.length>=6, 'piranhas return at a gentle real-ocean shoreline');
  assert.ok(shelfPiranhas.every(m=>m.x>=26 && gentleShelfTile(m.x,m.y)===T.WATER), 'shore ambush searches inward to safe two-tile-deep water');

  // Force the rare offshore roll to succeed: the centre is intentionally much
  // quieter, but never a hard no-spawn zone.
  const seededRandomBeforeOffshore=Math.random;
  Math.random=()=>0;
  mobs.clearAll();
  worldGen.biomeType = () => 5;
  worldGen.oceanBasinAt = () => ({left:-800,right:800,width:1601});
  player.x=0.5; player.y=11.4;
  simNow += 5000;
  mobs.update(0.05,player,seaTile,()=>{});
  const offshorePiranhas=mobs.serialize().list.filter(m=>m.id==='PIRANHA');
  assert.ok(offshorePiranhas.length>=2 && offshorePiranhas.length<6, 'a successful open-ocean ambush is a small hunting group, not a coastal horde');
  Math.random=seededRandomBeforeOffshore;
  worldGen.biomeType = () => 5;
  worldGen.oceanBasinAt = () => ({left:-80,right:80,width:161});

  mobs.clearAll();
  mobs.deserialize({
    v:4,
    list:[{id:'PIRANHA',x:-12,y:11.4,vx:0,vy:0,hp:5,maxHp:5,scale:1,speedMul:1.1,jumpMul:1,attackCd:3,waterTopY:10,desiredDepth:1}],
    aggro:{mode:'rel',m:{}}
  });
  mobs.freezeSpawns(10000);
  player.x=0.5; player.y=11.4; player.vx=0; player.vy=0; player.hpInvul=0;
  const normalHeroSpeed = MOVE.MAX*2;
  const chaseStart = Math.hypot(mobs.serialize().list[0].x-player.x,mobs.serialize().list[0].y-player.y);
  for(let i=0;i<70;i++){
    const dt=0.05;
    simNow += dt*1000;
    player.x += normalHeroSpeed*dt;
    mobs.update(dt,player,seaTile,()=>{});
  }
  const chaseFish = mobs.serialize().list.find(m=>m.id==='PIRANHA');
  const chaseEnd = Math.hypot(chaseFish.x-player.x,chaseFish.y-player.y);
  assert.ok(chaseEnd<chaseStart-2, 'a piranha gains on a hero fleeing at normal speed through sea water');

  mobs.deserialize({
    v:4,
    list:[
      {id:'PIRANHA',x:0.15,y:11.4,vx:0,vy:0,hp:5,maxHp:5,scale:1,speedMul:1,jumpMul:1,attackCd:0,waterTopY:10,desiredDepth:1},
      {id:'PIRANHA',x:0.85,y:11.5,vx:0,vy:0,hp:5,maxHp:5,scale:1,speedMul:1,jumpMul:1,attackCd:0,waterTopY:10,desiredDepth:1},
      {id:'PIRANHA',x:0.50,y:11.1,vx:0,vy:0,hp:5,maxHp:5,scale:1,speedMul:1,jumpMul:1,attackCd:0,waterTopY:10,desiredDepth:1}
    ],
    aggro:{mode:'rel',m:{}}
  });
  player.x=0.5; player.y=11.4; player.hp=100; player.hpInvul=0; bites.length=0;
  simNow += 400;
  mobs.update(0.08,player,seaTile,()=>{});
  assert.ok(bites.length>=1, 'touching piranhas bite the swimming hero');
  assert.equal(bites[0].opts.cause, 'piranha', 'piranha bites report a distinct damage cause');
  assert.ok(bites[0].opts.invulMs<=300, 'piranha bites pass short invulnerability to the central damage handler');

  mobs.deserialize({
    v:4,
    list:[{id:'PIRANHA',x:0.5,y:10.15,vx:0,vy:0,hp:5,maxHp:5,scale:1,speedMul:1,jumpMul:1,attackCd:0,waterTopY:10,desiredDepth:0}],
    aggro:{mode:'rel',m:{}}
  });
  mobs.freezeSpawns(10000);
  player.x=0.5; player.y=9.4; player.vx=0; player.vy=0; player.hp=100; player.hpInvul=0; bites.length=0;
  simNow += 400;
  mobs.update(0.08,player,seaTile,()=>{});
  assert.equal(bites.length,0,'piranhas do not bite a dry hero standing at the shore edge');
  assert.equal(player.vy,0,'dry shore contact does not push the hero like a water bite');

  globalThis.MM.boats = {
    heroOnBoat:()=>({inWater:true,grounded:false}),
    heroBoat:()=>null
  };
  mobs.deserialize({
    v:4,
    list:[
      {id:'PIRANHA',x:0.15,y:11.4,vx:0,vy:0,hp:5,maxHp:5,scale:1,speedMul:1,jumpMul:1,attackCd:0,waterTopY:10,desiredDepth:1},
      {id:'PIRANHA',x:0.85,y:11.5,vx:0,vy:0,hp:5,maxHp:5,scale:1,speedMul:1,jumpMul:1,attackCd:0,waterTopY:10,desiredDepth:1}
    ],
    aggro:{mode:'rel',m:{}}
  });
  mobs.freezeSpawns(10000);
  player.x=0.5; player.y=11.4; player.hp=100; player.hpInvul=0; bites.length=0;
  const raftedStart = Math.min(...mobs.serialize().list.filter(m=>m.id==='PIRANHA').map(m=>Math.hypot(m.x-player.x,m.y-player.y)));
  for(let i=0;i<10;i++){
    simNow += 80;
    mobs.update(0.08,player,seaTile,()=>{});
  }
  const raftedEnd = Math.min(...mobs.serialize().list.filter(m=>m.id==='PIRANHA').map(m=>Math.hypot(m.x-player.x,m.y-player.y)));
  assert.equal(bites.length, 0, 'piranhas do not bite the hero while the hero is aboard a floating boat');
  assert.ok(raftedEnd>=raftedStart-0.35, 'piranhas do not actively close on a hero protected by a boat');

  globalThis.MM.boats = {
    heroOnBoat:()=>null,
    heroBoat:()=>({x:0,y:11,cells:[{dx:0,dy:0}],inWater:true,grounded:false})
  };
  mobs.deserialize({
    v:4,
    list:[{id:'PIRANHA',x:0.5,y:11.4,vx:0,vy:0,hp:5,maxHp:5,scale:1,speedMul:1,jumpMul:1,attackCd:0,waterTopY:10,desiredDepth:1}],
    aggro:{mode:'rel',m:{}}
  });
  mobs.freezeSpawns(10000);
  player.x=0.5; player.y=11.4; player.hp=100; player.hpInvul=0; bites.length=0;
  simNow += 80;
  mobs.update(0.08,player,seaTile,()=>{});
  assert.equal(bites.length, 0, 'cached floating-boat state still protects the hero if the live deck query misses');

  globalThis.MM.boats = {
    heroOnBoat:()=>null,
    heroBoat:()=>({x:50,y:11,cells:[{dx:0,dy:0}],inWater:true,grounded:false})
  };
  mobs.deserialize({
    v:4,
    list:[{id:'PIRANHA',x:0.5,y:11.4,vx:0,vy:0,hp:5,maxHp:5,scale:1,speedMul:1,jumpMul:1,attackCd:0,waterTopY:10,desiredDepth:1}],
    aggro:{mode:'rel',m:{}}
  });
  mobs.freezeSpawns(10000);
  player.x=0.5; player.y=11.4; player.hp=100; player.hpInvul=0; bites.length=0;
  simNow += 80;
  mobs.update(0.08,player,seaTile,()=>{});
  assert.ok(bites.length>=1, 'a stale cached boat far from the hero does not grant piranha immunity');
  if(originalBoats===undefined) delete globalThis.MM.boats;
  else globalThis.MM.boats = originalBoats;

  mobs.deserialize({
    v:4,
    list:[
      {id:'PIRANHA',x:0.15,y:11.4,vx:0,vy:0,hp:5,maxHp:5,scale:1,speedMul:1,jumpMul:1,attackCd:0,waterTopY:10,desiredDepth:1},
      {id:'FISH',x:0.30,y:11.4,vx:0,vy:0,hp:4,maxHp:4,scale:1,speedMul:1,jumpMul:1,attackCd:0,waterTopY:10,desiredDepth:1},
      {id:'WOLF',x:0.70,y:11.4,vx:0,vy:0,hp:16,maxHp:16,scale:1,speedMul:1,jumpMul:1,attackCd:0}
    ],
    aggro:{mode:'rel',m:{}}
  });
  mobs.freezeSpawns(10000);
  player.x=40; player.y=4; player.hp=100; player.hpInvul=0; bites.length=0;
  simNow += 500;
  mobs.update(0.08,player,seaTile,()=>{});
  let preyList = mobs.serialize().list;
  const wolfAfter = preyList.find(m=>m.id==='WOLF');
  const fishAfter = preyList.find(m=>m.id==='FISH');
  assert.ok(wolfAfter.hp<16, 'piranhas bite non-fish mobs that enter sea water');
  assert.equal(fishAfter.hp,4, 'piranhas ignore other fish as prey');
  assert.equal(bites.length,0, 'piranhas attacking water prey do not redirect damage to the far hero');

  let companionDamage = 0;
  let companionOpts = null;
  let companionNearestOpts = null;
  globalThis.MM.companions = {
    nearestForEnemy(_x,_y,_range,opts){
      companionNearestOpts = opts;
      return {kind:'companion',id:'debug_companion',x:0.55,y:11.4,aimY:11.4,tx:0,ty:11,hp:50,maxHp:50,vx:0,vy:0};
    },
    damageAtWorld(_x,_y,dmg,opts){
      companionDamage += dmg;
      companionOpts = opts;
      return true;
    }
  };
  globalThis.MM.invasions = null;
  mobs.deserialize({
    v:4,
    list:[{id:'PIRANHA',x:0.15,y:11.4,vx:0,vy:0,hp:5,maxHp:5,scale:1,speedMul:1,jumpMul:1,attackCd:0,waterTopY:10,desiredDepth:1}],
    aggro:{mode:'rel',m:{}}
  });
  mobs.freezeSpawns(10000);
  simNow += 500;
  mobs.update(0.08,player,seaTile,()=>{});
  assert.ok(companionNearestOpts?.inWater, 'piranhas ask companion targeting for water-only prey');
  assert.ok(companionDamage>0, 'piranhas bite companions that are in water');
  assert.equal(companionOpts?.cause, 'piranha', 'companion bite damage is attributed to piranhas');

  globalThis.MM.companions = null;
  for(const kind of ['alien','molekin']){
    let invasionDamage = 0;
    let invasionOpts = null;
    let invasionNearestOpts = null;
    globalThis.MM.invasions = {
      nearestForEnemy(_x,_y,_range,opts){
        invasionNearestOpts = opts;
        return {kind,id:'debug_'+kind,teamId:'debug_team',x:0.55,y:11.4,aimY:11.4,tx:0,ty:11,hp:50,maxHp:50,vx:0,vy:0};
      },
      damageAtWorld(_x,_y,dmg,opts){
        invasionDamage += dmg;
        invasionOpts = opts;
        return true;
      }
    };
    mobs.deserialize({
      v:4,
      list:[{id:'PIRANHA',x:0.15,y:11.4,vx:0,vy:0,hp:5,maxHp:5,scale:1,speedMul:1,jumpMul:1,attackCd:0,waterTopY:10,desiredDepth:1}],
      aggro:{mode:'rel',m:{}}
    });
    mobs.freezeSpawns(10000);
    simNow += 500;
    mobs.update(0.08,player,seaTile,()=>{});
    assert.ok(invasionNearestOpts?.inWater, 'piranhas ask invasion targeting for water-only prey');
    assert.ok(invasionDamage>0, `piranhas bite ${kind} units that are in water`);
    assert.equal(invasionOpts?.cause, 'piranha', `${kind} bite damage is attributed to piranhas`);
    assert.equal(invasionOpts?.source, 'mob', `${kind} bite damage uses mob source`);
  }

  meat.reset();
  const rawSea = baitSea(T.MEAT,1,11);
  const rawBait = meat.nearestWaterBait(0.5,11.4,8,rawSea.getTile);
  assert.equal(rawBait?.kind, 'raw', 'raw meat touching sea water is found as piranha bait');
  mobs.deserialize({
    v:4,
    list:[
      {id:'PIRANHA',x:0.15,y:11.4,vx:0,vy:0,hp:5,maxHp:5,scale:1,speedMul:1,jumpMul:1,attackCd:0,waterTopY:10,desiredDepth:1},
      {id:'PIRANHA',x:0.85,y:11.5,vx:0,vy:0,hp:5,maxHp:5,scale:1,speedMul:1,jumpMul:1,attackCd:0,waterTopY:10,desiredDepth:1},
      {id:'PIRANHA',x:0.50,y:11.1,vx:0,vy:0,hp:5,maxHp:5,scale:1,speedMul:1,jumpMul:1,attackCd:0,waterTopY:10,desiredDepth:1}
    ],
    aggro:{mode:'rel',m:{}}
  });
  mobs.freezeSpawns(10000);
  player.x=0.5; player.y=11.4; player.hp=100; player.hpInvul=0; bites.length=0;
  let beforeBaitDist = Math.min(...mobs.serialize().list.filter(m=>m.id==='PIRANHA').map(m=>Math.hypot(m.x-rawBait.waterX,m.y-rawBait.waterY)));
  for(let i=0;i<10;i++){
    simNow += 80;
    mobs.update(0.08,player,rawSea.getTile,rawSea.setTile);
  }
  assert.equal(rawSea.getTile(1,11), T.AIR, 'piranhas consume raw meat bait from sea water');
  assert.equal(bites.length, 0, 'piranhas feeding on meat do not bite an overlapping swimming hero');
  const afterBaitDist = Math.min(...mobs.serialize().list.filter(m=>m.id==='PIRANHA').map(m=>Math.hypot(m.x-rawBait.waterX,m.y-rawBait.waterY)));
  assert.ok(afterBaitDist<beforeBaitDist, 'distracted piranhas move toward the meat feeding spot instead of the hero');
} finally {
  Math.random = originalRandom;
  worldGen.biomeType = originalBiomeType;
  worldGen.oceanBasinAt = originalOceanBasinAt;
  delete globalThis.damageHero;
  delete globalThis.msg;
  if(originalCompanions===undefined) delete globalThis.MM.companions;
  else globalThis.MM.companions = originalCompanions;
  if(originalInvasions===undefined) delete globalThis.MM.invasions;
  else globalThis.MM.invasions = originalInvasions;
  if(originalBoats===undefined) delete globalThis.MM.boats;
  else globalThis.MM.boats = originalBoats;
  meat.reset();
  mobs.clearAll();
}

console.log('piranha-sim: all assertions passed');
