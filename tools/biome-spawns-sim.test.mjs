// Deterministic biome spawn regression test.
// Verifies that biome-native species can actually find valid cells in generated
// representative runs, including desert and swamp natives.
// Run: node tools/biome-spawns-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.localStorage = {
  getItem(){ return null; },
  setItem(){},
  removeItem(){}
};

const { T, CHUNK_W, WORLD_H } = await import('../src/constants.js');
await import('../src/engine/trees.js');
const { worldGen: WG } = await import('../src/engine/worldgen.js');
const { world } = await import('../src/engine/world.js');
const { mobs } = await import('../src/engine/mobs.js');
const { companions } = await import('../src/engine/companions.js');

WG.worldSeed = 20260616;
WG.clearCaches();
world.clear();
mobs.clearAll();
companions.reset();

const SPECIES = mobs._debugSpecies();
assert.ok(SPECIES.JASZCZUR && mobs.species.includes('JASZCZUR'), 'desert lizard is registered');
assert.ok(SPECIES.ZABA && mobs.species.includes('ZABA'), 'swamp frog is registered');
assert.ok(SPECIES.WIOSENNY_JELEN && mobs.species.includes('WIOSENNY_JELEN'), 'spring hallmark stag is registered');
assert.ok(SPECIES.LETNI_ZUBR && mobs.species.includes('LETNI_ZUBR'), 'summer hallmark bison is registered');
assert.ok(SPECIES.JESIENNY_LOS && mobs.species.includes('JESIENNY_LOS'), 'autumn hallmark moose is registered');
assert.ok(SPECIES.ZIMOWY_NIEDZWIEDZ && mobs.species.includes('ZIMOWY_NIEDZWIEDZ'), 'winter hallmark bear is registered');
assert.equal(typeof mobs.spawnSeasonalHallmark, 'function', 'season debug can spawn the current hallmark animal');
assert.ok(SPECIES.WIOSENNY_JELEN.loot.some(d=>d.item==='springAntler'), 'spring stag carries the spring trophy');
assert.ok(SPECIES.LETNI_ZUBR.loot.some(d=>d.item==='summerHorn'), 'summer bison carries the summer trophy');
assert.ok(SPECIES.JESIENNY_LOS.loot.some(d=>d.item==='autumnHeartwood'), 'autumn moose carries the autumn trophy');
assert.ok(SPECIES.ZIMOWY_NIEDZWIEDZ.loot.some(d=>d.item==='winterFur'), 'winter bear carries the winter trophy');
assert.equal(typeof mobs.nearestHostileLiving, 'function', 'mobs expose hostile-only target lookup for companions');

mobs.deserialize({
  v:4,
  list:[
    {id:'DEER',x:12,y:10,vx:0,vy:0,hp:10,state:'idle',facing:1,scale:1,speedMul:1,jumpMul:1},
    {id:'BAT',x:4,y:10,vx:0,vy:0,hp:6,state:'idle',facing:1,scale:1,speedMul:1,jumpMul:1}
  ],
  aggro:{mode:'rel',m:{}}
});
let hostileTarget = mobs.nearestHostileLiving(0,10,20,{exclude:['ZLOTY'],preferHeroFocus:true});
assert.equal(hostileTarget && hostileTarget.id, 'BAT', 'hostile lookup ignores passive animals before the hero attacks them');
assert.equal(mobs.nearestHostileLiving(0,10,3,{exclude:['ZLOTY']}), null, 'nearby passive animals are not treated as hostile targets');
assert.equal(mobs.attackAt(12,10,0,{source:'hero'}), true, 'hero attack can mark a passive animal as the focused target');
hostileTarget = mobs.nearestHostileLiving(0,10,20,{exclude:['ZLOTY'],preferHeroFocus:true});
assert.equal(hostileTarget && hostileTarget.id, 'DEER', 'hero-attacked animals outrank closer hostile animals for companion targeting');
mobs.clearAll();

function flatTile(_x,y){ return y>=10 ? T.GRASS : T.AIR; }
mobs.freezeSpawns(10000);
companions.restore({v:1,list:[{x:0,y:9.96,biomass:3,hp:88,seed:4160,laserCd:99,gasCd:99}]},flatTile);
mobs.deserialize({
  v:4,
  list:[{id:'BAT',x:0.08,y:9.35,vx:0,vy:0,hp:6,state:'idle',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],
  aggro:{mode:'rel',m:{}}
});
const farHero = {x:20,y:9.96,hp:100,maxHp:100,vx:0,vy:0,hpInvul:0};
mobs.update(1/30,farHero,flatTile,()=>{});
assert.ok(companions._debug.list()[0].hp<88, 'always-hostile mobs attack nearby companions before a far hero');
assert.equal(farHero.hp, 100, 'mob companion targeting leaves the far hero unharmed');
companions.reset();
mobs.clearAll();

function setSeason(id){
  MM.seasons = id ? {
    metrics(){ return {season:id}; },
    profile(){ return {id, animalSpawnMult:1}; }
  } : null;
}

function biomeRuns(biome){
  const out=[];
  let x=-60000;
  while(x<=60000){
    const id=WG.biomeType(x);
    let left=x, right=x;
    while(right+1<=60000 && WG.biomeType(right+1)===id) right++;
    if(id===biome) out.push({left,right,width:right-left+1,center:Math.round((left+right)/2)});
    x=right+1;
  }
  return out.sort((a,b)=>b.width-a.width);
}

function ensureRange(left,right){
  for(let cx=Math.floor(left/CHUNK_W); cx<=Math.floor(right/CHUNK_W); cx++) world.ensureChunk(cx);
}

function findSpawn(spec,biome){
  const runs=biomeRuns(biome).slice(0,5);
  for(const run of runs){
    ensureRange(run.left-64,run.right+64);
    for(let x=run.left; x<=run.right; x++){
      const surface=WG.surfaceHeight(x);
      for(let y=Math.max(1,surface-18); y<=Math.min(WORLD_H-4,surface+20); y++){
        if(spec.spawnTest(x,y,world.getTile)) return {x,y,run};
      }
    }
  }
  return null;
}

const cases = [
  ['BEAR',0],
  ['SQUIRREL',0],
  ['DEER',1],
  ['RABBIT',1],
  ['WOLF',2],
  ['JASZCZUR',3],
  ['ZABA',4],
  ['FISH',5],
  ['SHARK',5],
  ['EEL',5],
  ['GOAT',7],
  ['STRAZNIK',8]
];

const hits = {};
for(const [id,biome] of cases){
  const spec=SPECIES[id];
  assert.ok(spec, id+' spec exists');
  const hit=findSpawn(spec,biome);
  assert.ok(hit, id+' finds a legal spawn in biome '+biome);
  assert.equal(WG.biomeType(hit.x), biome, id+' spawn x stays in its biome');
  hits[id]=hit;
}

const seasonalCases = [
  ['WIOSENNY_JELEN',0,'spring','summer'],
  ['LETNI_ZUBR',1,'summer','winter'],
  ['JESIENNY_LOS',0,'autumn','spring'],
  ['ZIMOWY_NIEDZWIEDZ',2,'winter','summer']
];
for(const [id,biome,season,wrongSeason] of seasonalCases){
  const spec=SPECIES[id];
  setSeason(season);
  const hit=findSpawn(spec,biome);
  assert.ok(hit, id+' finds a legal large-body spawn during '+season);
  assert.equal(WG.biomeType(hit.x), biome, id+' spawn x stays in its hallmark biome');
  setSeason(wrongSeason);
  assert.equal(spec.spawnTest(hit.x,hit.y,world.getTile), false, id+' rejects the same spawn outside '+season);
  hits[id]=hit;
}
setSeason(null);

assert.equal(SPECIES.JASZCZUR.spawnTest(hits.ZABA.x,hits.ZABA.y,world.getTile), false,
  'desert lizard rejects the swamp spawn cell');
assert.equal(SPECIES.ZABA.spawnTest(hits.JASZCZUR.x,hits.JASZCZUR.y,world.getTile), false,
  'swamp frog rejects the desert spawn cell');

const coalCaveTile = (x,y)=>{
  if(y===31) return T.COAL;
  if(y>=27 && y<=30 && x===2) return T.WATER;
  return T.AIR;
};
MM.worldGen = { surfaceHeight(){ return 10; }, biomeType(){ return 1; } };
assert.equal(SPECIES.PELZACZ.spawnTest(0,30,coalCaveTile), true,
  'cave crawler accepts coal seams as rock cave floors');
assert.equal(SPECIES.SZKIELET.spawnTest(0,30,coalCaveTile), true,
  'underground skeleton accepts coal seams as rock cave floors');
assert.equal(SPECIES.EEL.spawnTest(2,27,coalCaveTile), true,
  'deep eel accepts coal below flooded caves as a rock floor');

console.log('biome-spawns-sim: all assertions passed');
