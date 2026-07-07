// Mob population regression: stationary hero should see a bounded local ecology,
// not an ever-growing pile of animals spawned near the camera.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.CustomEvent = class { constructor(type,opts){ this.type=type; this.detail=opts&&opts.detail; } };
globalThis.dispatchEvent = () => true;
let simNow = 0;
globalThis.performance = { now:()=>simNow };

const { T, CHUNK_W } = await import('../src/constants.js');
const { worldGen } = await import('../src/engine/worldgen.js');
const { world } = await import('../src/engine/world.js');
const { mobs } = await import('../src/engine/mobs.js');

worldGen.worldSeed = 20260616;
worldGen.clearCaches();
mobs.clearAll();
globalThis.damageHero = () => {};

function getTile(x,y){
  if(y<0 || y>140) return T.STONE;
  if(y===30) return T.GRASS;
  if(y>30) return T.STONE;
  return T.AIR;
}
const player={x:0,y:29,hp:100,maxHp:100,vx:0,vy:0};
globalThis.player=player;
MM.seasons = {
  _season: 'spring',
  profile(){ return {id:this._season, animalSpawnMult:this._season==='winter'?0.34:1}; },
  metrics(){ return {season:this._season}; }
};
const speciesDebug=mobs._debugSpecies();
const ecologyDebug=mobs._debugEcology();
assert.ok(ecologyDebug && ecologyDebug.hallmarks.spring === 'WIOSENNY_JELEN', 'mob ecology exposes spring hallmark mapping');
MM.seasons._season='spring';
assert.ok(ecologyDebug.factor(speciesDebug.RABBIT) > ecologyDebug.factor(speciesDebug.WOLF), 'spring favors small prey over wolves');
MM.seasons._season='winter';
assert.ok(ecologyDebug.factor(speciesDebug.WOLF) > ecologyDebug.factor(speciesDebug.RABBIT), 'winter favors wolves over rabbits');
assert.equal(ecologyDebug.factor(speciesDebug.WIOSENNY_JELEN), 0, 'out-of-season hallmark animals have zero ecology factor');
MM.seasons=null;
const realRandom=Math.random;
let seed=123456789;
function seededRandom(){
  seed=(seed*1664525+1013904223)>>>0;
  return seed/4294967296;
}
Math.random=seededRandom;

let dayCycle=false;
MM.background = { getCycleInfo(){ return {isDay:dayCycle}; } };
try{
  mobs.clearAll();
  mobs.freezeSpawns(10000);
  mobs.deserialize({
    v:4,
    list:[{id:'GHOUL',x:4,y:29,vx:0,vy:0,hp:16,state:'idle',facing:-1,scale:1,speedMul:1,jumpMul:1}],
    aggro:{mode:'rel',m:{}}
  });
  mobs.freezeSpawns(10000);
  simNow += 50;
  mobs.update(0.05,player,getTile);
  let ghoul=mobs.nearestLiving(4,29,8);
  assert.ok(ghoul && !mobs.hasStatus(ghoul,'burn'), 'night ghoul stays unburned before dawn');
  dayCycle=true;
  simNow += 50;
  mobs.update(0.05,player,getTile);
  ghoul=mobs.nearestLiving(4,29,8);
  assert.ok(ghoul && mobs.hasStatus(ghoul,'burn'), 'sunrise lights night mobs on fire');
  assert.ok(ghoul.status.burn.t > 7, 'sunrise burn lasts longer than the weak daytime habitat burn');
  assert.ok(ghoul.status.burn.dps >= 6, 'sunrise burn uses the stronger dawn damage rate');
  const hpBefore=ghoul.hp;
  for(let i=0;i<6;i++){
    simNow += 100;
    mobs.update(0.1,player,getTile);
  }
  ghoul=mobs.nearestLiving(4,29,8);
  assert.ok(!ghoul || ghoul.hp < hpBefore, 'sunrise burn starts damaging the night mob');
} finally {
  delete MM.background;
  mobs.clearAll();
}

try{
  assert.equal(mobs.forceSpawn('RABBIT', null, getTile), false, 'debug force-spawn rejects missing player state');
  mobs.deserialize({
    v:3,
    list:[
      {id:'RABBIT',x:NaN,y:29,vx:0,vy:0,hp:5},
      {id:'DEER',x:1,y:29,vx:Infinity,vy:-Infinity,hp:NaN,scale:99,speedMul:-3,jumpMul:NaN}
    ],
    aggro:{mode:'rel',m:{}}
  });
  let restored=mobs.serialize().list;
  assert.equal(restored.length, 1, 'malformed restored mobs are dropped instead of persisted');
  assert.equal(restored[0].id, 'DEER', 'valid restored mob survives sanitization');
  assert.equal(restored[0].vx, 0, 'invalid restored velocity is sanitized');
  assert.ok(Number.isFinite(restored[0].hp), 'invalid restored hp is sanitized');
  mobs.update(NaN,player,getTile);
  mobs.update(0.05,{x:NaN,y:29,hp:100,maxHp:100},getTile);
  assert.equal(mobs.serialize().list.length, 1, 'invalid update ticks do not mutate mob population');
  assert.equal(mobs.damageAt(NaN,29,999), false, 'invalid mob hit x is ignored');
  assert.equal(mobs.attackAt(1,Infinity,999), false, 'invalid mob melee y is ignored');
  assert.equal(mobs.serialize().list[0].hp, restored[0].hp, 'invalid hit coordinates cannot damage mobs');
  mobs.clearAll();

  function killMobForDeathFx(id,opts){
    mobs.clearAll();
    mobs.deserialize({
      v:4,
      list:[{id,x:0.5,y:29.5,vx:0,vy:0,hp:999,state:'idle',facing:1,scale:1,speedMul:1,jumpMul:1}],
      aggro:{mode:'rel',m:{}}
    });
    mobs.freezeSpawns(10000);
    assert.equal(mobs.damageAt(0,29,999,opts||{source:'hero'}), true, id+' can be killed for death-fx regression');
    const fx=mobs._debugDeathFx();
    assert.equal(fx.length,1,id+' creates one persistent mob death effect');
    assert.ok(fx[0].core>=3,id+' death effect keeps a readable collapsing body core');
    assert.ok(fx[0].fragments>=8,id+' death effect has a real fragment burst');
    assert.ok(fx[0].rings>=1,id+' death effect has a secondary shock ring');
    assert.ok(fx[0].residue>=3,id+' death effect leaves short-lived procedural residue');
    assert.ok(fx[0].physicsPieces>=Math.min(10,fx[0].core+fx[0].fragments),id+' death effect has budgeted physics bodies');
    assert.ok(typeof fx[0].signature==='string' && fx[0].signature.includes(fx[0].style),id+' death effect has a seeded visual signature');
    return fx[0];
  }
  const rabbitDeath=killMobForDeathFx('RABBIT',{source:'hero'});
  assert.equal(rabbitDeath.style,'creature','ordinary animals use creature death fragments');
  simNow += 50;
  mobs.update(0.05,player,getTile);
  assert.equal(mobs.serialize().list.length,0,'dead mob is removed from the live list after death');
  assert.equal(mobs._debugDeathFx().length,1,'death effect keeps animating after the live mob is removed');
  for(let i=0;i<8;i++){ simNow += 80; mobs.update(0.08,player,getTile); }
  const rabbitPhysics=mobs._debugDeathFx(getTile)[0];
  assert.ok(rabbitPhysics.travel>1.2,'ground mob death parts physically travel after the burst');
  assert.ok(rabbitPhysics.bounces>=1,'ground mob death parts bounce or slide against terrain');
  assert.ok(rabbitPhysics.puffs>=1,'ground mob death pieces kick up landing puffs');
  for(let i=0;i<24;i++){ simNow += 100; mobs.update(0.1,player,getTile); }
  assert.equal(mobs._debugDeathFx().length,0,'mob death effects expire and clean themselves up');

  const fishDeath=killMobForDeathFx('FISH',{source:'hero'});
  const sentinelDeath=killMobForDeathFx('STRAZNIK',{source:'companion',cause:'laser'});
  const burntGhoulDeath=killMobForDeathFx('GHOUL',{source:'sunrise',cause:'burn'});
  assert.equal(fishDeath.style,'splash','aquatic mobs use splash death effects');
  assert.equal(sentinelDeath.style,'machine','robot mobs use mechanical death effects');
  assert.equal(burntGhoulDeath.style,'ash','burned organic mobs use ash death effects');
  assert.notEqual(rabbitDeath.seed,sentinelDeath.seed,'death effects are procedurally seeded per mob');
  assert.notEqual(rabbitDeath.signature,sentinelDeath.signature,'different mobs get different death signatures');
  mobs.clearAll();

  function pondTile(x,y){
    if(y<0 || y>140) return T.STONE;
    if(x>=-4 && x<=4 && y>=30 && y<=31) return T.WATER;
    if(y===32) return T.STONE;
    return T.AIR;
  }
  mobs.deserialize({
    v:4,
    list:[
      {id:'FISH',x:0.5,y:30.2,vx:0,vy:0,hp:4,state:'idle',facing:1,scale:1,speedMul:1,jumpMul:1},
      {id:'PIRANHA',x:1.6,y:30.2,vx:0,vy:0,hp:5,state:'idle',facing:1,scale:1,speedMul:1,jumpMul:1},
      {id:'RABBIT',x:2.4,y:29.2,vx:0,vy:0,hp:5,state:'idle',facing:1,scale:1,speedMul:1,jumpMul:1}
    ],
    aggro:{mode:'rel',m:{}}
  });
  mobs.freezeSpawns(10000);
  const shock=mobs.shockAquaticRadius(0.5,30.2,4,{damage:999,getTile:pondTile,source:'lightning',cause:'lightning_water'});
  assert.deepEqual(shock, {hit:2,killed:2}, 'lightning water shock kills aquatic mobs in range');
  simNow += 50;
  mobs.update(0.05,player,pondTile);
  const afterShock=mobs.serialize().list;
  assert.equal(afterShock.some(m=>m.id==='FISH'||m.id==='PIRANHA'), false, 'shocked aquatic mobs are removed after the update pass');
  assert.equal(afterShock.some(m=>m.id==='RABBIT'), true, 'water shock leaves non-aquatic mobs alone');
  mobs.clearAll();

  function tunnelGetTile(x,y){
    if(y<0 || y>140) return T.STONE;
    if(x>=-3 && x<=3 && y===29) return T.AIR;
    return T.STONE;
  }
  mobs.deserialize({
    v:4,
    list:[{id:'BEAR',x:0.5,y:29.2,vx:0,vy:0,hp:999,state:'idle',facing:1,scale:2.4,speedMul:1,jumpMul:1}],
    aggro:{mode:'rel',m:{}}
  });
  mobs.freezeSpawns(10000);
  assert.equal(mobs.damageAt(0,29,999,{source:'hero',getTile:tunnelGetTile}), true, 'large tunnel mob can be killed for death-fx clamp regression');
  let tunnelDeath=mobs._debugDeathFx(tunnelGetTile)[0];
  assert.ok(tunnelDeath.tunnelClamped, 'death effect origin is clamped out of the tunnel ceiling');
  assert.equal(tunnelDeath.solidPieces, 0, 'death effect pieces do not spawn inside tunnel stone');
  assert.equal(tunnelDeath.badFinite, 0, 'death effect pieces spawn with finite coordinates');
  const prevFrameMs=globalThis.__mmFrameMs;
  globalThis.__mmFrameMs=48;
  try{
    for(let i=0;i<14;i++){
      simNow += 50;
      mobs.update(0.05,player,tunnelGetTile);
      tunnelDeath=mobs._debugDeathFx(tunnelGetTile)[0];
      if(!tunnelDeath) break;
      assert.equal(tunnelDeath.solidPieces, 0, 'death effect pieces stay out of tunnel stone during stressed update '+i);
      assert.equal(tunnelDeath.badFinite, 0, 'death effect pieces stay finite during stressed tunnel update '+i);
      assert.ok(tunnelDeath.maxDist<=8.6, 'death effect pieces stay bounded in a tunnel during stressed update '+i+' (max '+tunnelDeath.maxDist+')');
    }
  } finally {
    if(prevFrameMs===undefined) delete globalThis.__mmFrameMs;
    else globalThis.__mmFrameMs=prevFrameMs;
  }
  mobs.clearAll();

  for(let i=0;i<60*5*20;i++){
    simNow += 50;
    mobs.update(0.05,player,getTile);
  }
  const diag=mobs.diagnose(getTile);
  assert.ok(diag.total<=38, 'stationary local ecology stays bounded (got '+diag.total+')');
  assert.ok((diag.species.DEER||0)<=4, 'deer local count stays modest');
  assert.ok((diag.species.RABBIT||0)<=6, 'rabbit local count stays modest');
} finally {
  Math.random=realRandom;
  mobs.clearAll();
}

const mobsSource = readFileSync(new URL('../src/engine/mobs.js', import.meta.url), 'utf8');
assert.match(mobsSource, /function spawnMobDeathFx/, 'mobs have an explicit procedural death effect generator');
assert.match(mobsSource, /function updateMobDeathFx/, 'mob death effects update after live mobs are removed');
assert.match(mobsSource, /function drawMobDeathFx/, 'mob death effects have a dedicated renderer');
assert.match(mobsSource, /function mobDeathCoreKind/, 'mob death effects include species-style core chunks');
assert.match(mobsSource, /function mobDeathResidueKind/, 'mob death effects include procedural residue');
assert.match(mobsSource, /MOB_DEATH_PHYSICS_FRAME_BUDGET/, 'mob death physics has an explicit per-frame budget');
assert.match(mobsSource, /function integrateDeathPiecePhysics/, 'mob death pieces use bounded terrain physics');
assert.match(mobsSource, /function primeDeathPhysics/, 'mob death pieces get per-piece collision and slide parameters');
assert.match(mobsSource, /function drawIrregularDeathBlob/, 'organic death chunks use irregular blob silhouettes');
assert.match(mobsSource, /function drawIrregularDeathShard/, 'small death debris uses angular shard silhouettes');
assert.doesNotMatch(mobsSource, /ctx\.fillRect\(-w\*0\.5,-h\*0\.5,w,h\)/, 'organic death core fallback is no longer a rectangular block');

function cityCenterForSeed(){
  let best=null;
  let x=-60000;
  while(x<=60000){
    const id=worldGen.biomeType(x);
    let left=x, right=x;
    while(right+1<=60000 && worldGen.biomeType(right+1)===id) right++;
    if(id===8){
      const width=right-left+1;
      if(!best || width>best.width) best={left,right,width,center:Math.round((left+right)/2)};
    }
    x=right+1;
  }
  return best && best.center;
}

function cityTile(x,y){
  if(y<0 || y>140) return T.STONE;
  if(y>=70) return T.STONE;
  if(y===30 || y===36 || y===42) return T.STEEL;
  return T.AIR;
}

seed=987654321;
Math.random=seededRandom;
try{
  const cityX=cityCenterForSeed();
  assert.ok(Number.isFinite(cityX), 'test seed exposes a city biome for sentinel population checks');
  const cityPlayer={x:cityX,y:29,hp:100,maxHp:100,vx:0,vy:0};
  globalThis.player=cityPlayer;
  mobs.clearAll();
  for(let i=0;i<60*3*20;i++){
    simNow += 50;
    mobs.update(0.05,cityPlayer,cityTile);
  }
  const cityMobs=mobs.serialize().list.filter(m=>m.id==='STRAZNIK');
  const visiblePatrol=cityMobs.filter(m=>Math.hypot(m.x-cityPlayer.x,m.y-cityPlayer.y)<=92);
  assert.ok(cityMobs.length>=8, 'city ecology naturally produces a dense visible sentinel patrol group (got '+cityMobs.length+')');
  assert.ok(visiblePatrol.length<=16, 'city sentinel local population stays at the intended patrol cap');
} finally {
  Math.random=realRandom;
  mobs.clearAll();
  globalThis.player=player;
}

seed=246813579;
Math.random=seededRandom;
try{
  const cityX=cityCenterForSeed();
  assert.ok(Number.isFinite(cityX), 'test seed exposes a generated city biome for real-terrain sentinel checks');
  world.clear();
  worldGen.clearCaches();
  for(let cx=Math.floor((cityX-220)/CHUNK_W); cx<=Math.floor((cityX+220)/CHUNK_W); cx++) world.ensureChunk(cx);
  const realCityPlayer={x:cityX,y:worldGen.surfaceHeight(cityX)-1,hp:100,maxHp:100,vx:0,vy:0};
  globalThis.player=realCityPlayer;
  mobs.clearAll();
  simNow += 5000;
  for(let i=0;i<60*4*20;i++){
    simNow += 50;
    mobs.update(0.05,realCityPlayer,world.getTile);
  }
  const cityMobs=mobs.serialize().list.filter(m=>m.id==='STRAZNIK');
  const visiblePatrol=cityMobs.filter(m=>Math.hypot(m.x-realCityPlayer.x,m.y-realCityPlayer.y)<=92);
  assert.ok(cityMobs.length>=10, 'generated city terrain naturally supports dense sentinel spawning (got '+cityMobs.length+')');
  assert.ok(visiblePatrol.length>=8, 'generated city sentinels spawn within the visible ecology radius');
  assert.ok(visiblePatrol.length<=16, 'generated city sentinel patrol respects the local population cap');
} finally {
  Math.random=realRandom;
  mobs.clearAll();
  world.clear();
  globalThis.player=player;
}

console.log('mob-population-sim: all assertions passed');
