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

WG.worldSeed = 20260616;
WG.clearCaches();
world.clear();
mobs.clearAll();

const SPECIES = mobs._debugSpecies();
assert.ok(SPECIES.JASZCZUR && mobs.species.includes('JASZCZUR'), 'desert lizard is registered');
assert.ok(SPECIES.ZABA && mobs.species.includes('ZABA'), 'swamp frog is registered');

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
