// Mob population regression: stationary hero should see a bounded local ecology,
// not an ever-growing pile of animals spawned near the camera.
import assert from 'node:assert/strict';

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
