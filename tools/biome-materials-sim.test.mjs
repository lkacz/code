// Deterministic biome material regression test.
// Verifies that each biome has a wide representative run and that generated
// terrain/materials match its identity: forests are leafy, swamps are muddy and
// wet, seas/lakes contain water, mountains are high and rocky, cities are urban.
// Run: node tools/biome-materials-sim.test.mjs
import { strict as assert } from 'assert';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.localStorage = {
  getItem(){ return null; },
  setItem(){},
  removeItem(){}
};

const { T, CHUNK_W, WORLD_H, WORLD_MAX_Y } = await import('../src/constants.js');
const { worldGen: WG } = await import('../src/engine/worldgen.js');
await import('../src/engine/trees.js');
const { world } = await import('../src/engine/world.js');

const SEED = 20260616;
const FROM = -60000;
const TO = 60000;
const BIOME_NAMES = ['forest','plains','snow','desert','swamp','sea','lake','mountain','city'];
const MIN_REP_WIDTH = [250,150,250,250,180,250,90,250,250];

WG.worldSeed = SEED;
WG.clearCaches();
world.clear();

function discoverRuns(){
  const runs = Array.from({length:BIOME_NAMES.length},()=>[]);
  let x = FROM;
  while(x<=TO){
    const biome = WG.biomeType(x);
    let left = x;
    let right = x;
    while(right+1<=TO && WG.biomeType(right+1)===biome) right++;
    runs[biome].push({left,right,width:right-left+1,center:Math.round((left+right)/2)});
    x = right + 1;
  }
  return runs;
}

function count(sample,t){ return sample.counts[t] || 0; }
function countAny(sample,types){ return types.reduce((sum,t)=>sum+count(sample,t),0); }

function sampleRun(run,biome){
  const pad = Math.min(32, Math.max(8, Math.floor((run.width-1)/2)));
  const left = run.center - pad;
  const right = run.center + pad;
  for(let cx=Math.floor(left/CHUNK_W); cx<=Math.floor(right/CHUNK_W); cx++) world.ensureChunk(cx);

  const counts = {};
  let columns = 0;
  let minRow = Infinity;
  let maxRow = -Infinity;
  let elevSum = 0;
  for(let wx=left; wx<=right; wx++){
    if(WG.biomeType(wx)!==biome) continue;
    columns++;
    const col = WG.column(wx);
    minRow = Math.min(minRow,col.row);
    maxRow = Math.max(maxRow,col.row);
    elevSum += col.elev;
    const y0 = Math.max(0,col.row-18);
    const y1 = Math.min(WORLD_H-4,col.row+24);
    for(let y=y0; y<=y1; y++){
      const t = world.getTile(wx,y);
      counts[t] = (counts[t] || 0) + 1;
    }
  }
  return {counts, columns, rowSpan:maxRow-minRow, avgElev:elevSum/Math.max(1,columns)};
}

const runsByBiome = discoverRuns();
const samples = [];
for(let biome=0; biome<BIOME_NAMES.length; biome++){
  const runs = runsByBiome[biome].sort((a,b)=>b.width-a.width);
  assert.ok(runs.length>0, `seed ${SEED}: biome ${BIOME_NAMES[biome]} exists`);
  const run = runs[0];
  assert.ok(run.width>=MIN_REP_WIDTH[biome],
    `seed ${SEED}: biome ${BIOME_NAMES[biome]} has a wide representative run (${run.width})`);
  const sample = sampleRun(run,biome);
  assert.ok(sample.columns>=33, `biome ${BIOME_NAMES[biome]} sample covers enough columns`);
  samples[biome] = Object.assign({run},sample);
}

assert.ok(count(samples[0],T.GRASS)>=35, 'forest exposes grass surface even when a surface temple lands in the sample');
assert.ok(countAny(samples[0],[T.WOOD,T.LEAF])>=180, 'forest generates dense tree material');

assert.ok(count(samples[1],T.GRASS)>=35, 'plains expose broad grassland');
assert.ok(count(samples[1],T.DIRT)>=80, 'plains have a diggable dirt subsoil under grass');
assert.ok(countAny(samples[0],[T.WOOD,T.LEAF]) > countAny(samples[1],[T.WOOD,T.LEAF])*4,
  'forests are materially denser with trees than plains');

assert.ok(count(samples[2],T.SNOW)>=55, 'snow biome has durable snow cover');
assert.ok(samples[2].avgElev>2, 'snow representative is on land, not only frozen shallows');

assert.ok(count(samples[3],T.SAND)>=300, 'desert has deep sand cover');
assert.equal(countAny(samples[3],[T.WATER,T.ICE]),0, 'desert representative stays dry');

assert.ok(count(samples[4],T.MUD)>=120, 'swamp generates natural mud banks');
assert.ok(count(samples[4],T.CLAY)>=8, 'swamp exposes clay sediment lenses');
assert.ok(count(samples[4],T.WATER)>=25, 'swamp keeps shallow pools');
assert.ok(countAny(samples[4],[T.WOOD,T.LEAF])>=70, 'swamp generates sparse mangrove material');

assert.ok(count(samples[5],T.WATER)>=650, 'sea representative contains open water');
// Oceans now sit in sealed bedrock basins: a clay/dirt floor over an
// unmineable bedrock jacket (see ocean-basin-sim.test.mjs for the full contract).
assert.ok(countAny(samples[5],[T.CLAY,T.DIRT])>=120, 'sea representative keeps a clay/dirt water floor');
assert.ok(count(samples[5],T.SAND)<80, 'sea representative no longer generates a visible sand floor');
assert.ok(count(samples[5],T.BEDROCK)>=300, 'sea representative rests on the sealed bedrock basin');

assert.ok(count(samples[6],T.WATER)>=150, 'lake representative contains water');
assert.ok(countAny(samples[6],[T.CLAY,T.DIRT])>=200, 'lake representative has a clay/dirt floor');
assert.ok(count(samples[6],T.SAND)<80, 'lake representative no longer generates a visible sand bed');

assert.ok(samples[7].avgElev>=30, 'mountain representative is high altitude');
assert.ok(samples[7].rowSpan>=8, 'mountain representative has rugged relief');
assert.ok(countAny(samples[7],[T.STONE,T.GRANITE,T.BASALT,T.BEDROCK,T.SNOW])>=650, 'mountain is rocky or snow-capped');

let coal = 0;
let diamonds = 0;
let rockMass = 0;
let granite = 0;
let basalt = 0;
let bedrock = 0;
for(const biome of [0,1,2,3,4,6,7]){
  const center = samples[biome].run.center;
  const left = center - 80;
  const right = center + 80;
  for(let cx=Math.floor(left/CHUNK_W); cx<=Math.floor(right/CHUNK_W); cx++) world.ensureChunk(cx);
  for(let wx=left; wx<=right; wx++){
    if(WG.biomeType(wx)!==biome) continue;
    const surf = WG.surfaceHeight(wx);
    for(let y=Math.max(surf+8,42); y<WORLD_H-7; y++){
      const t = world.getTile(wx,y);
      if(t===T.COAL) coal++;
      else if(t===T.DIAMOND) diamonds++;
      else if(t===T.STONE || t===T.GRANITE || t===T.BASALT || t===T.BEDROCK){
        rockMass++;
        if(t===T.GRANITE) granite++;
        else if(t===T.BASALT) basalt++;
        else if(t===T.BEDROCK) bedrock++;
      }
    }
  }
}
assert.ok(coal>=220, 'underground stone mass contains coal seams (got '+coal+')');
assert.ok(diamonds<=40, 'legacy underground keeps diamonds scarce and bedrockward (got '+diamonds+')');
assert.ok(coal>diamonds*50, 'coal is vastly more common than diamonds (coal '+coal+', diamonds '+diamonds+')');
assert.ok(rockMass>coal*8, 'coal remains a resource seam, not the dominant underground material');
assert.ok(granite>=120, 'deeper underground includes granite strata (got '+granite+')');
assert.ok(basalt>=80, 'deep underground includes basalt strata (got '+basalt+')');
assert.equal(bedrock,0, 'legacy mid-world band no longer contains an artificial bedrock shelf (got '+bedrock+')');

let deepBedrock = 0;
for(const biome of [0,1,2,3,4,6,7]){
  const center = samples[biome].run.center;
  for(let wx=center-16; wx<=center+16; wx++){
    for(let y=WORLD_MAX_Y-3; y<WORLD_MAX_Y; y++){
      if(world.getTile(wx,y)===T.BEDROCK) deepBedrock++;
    }
  }
}
assert.ok(deepBedrock>=500, 'true extended-world bottom contains the hard bedrock boundary (got '+deepBedrock+')');

const worldSource = await readFile(new URL('../src/engine/world.js', import.meta.url), 'utf8');
const worldLayerSource = await readFile(new URL('../src/engine/world_layers.js', import.meta.url), 'utf8');
assert.match(worldSource, /function stripChestTiles\(arr\)/, 'worldgen centralizes removal of legacy generated chest blocks');
assert.doesNotMatch(worldSource, /Cave treasure: rare chests/, 'cave generation no longer seeds chest blocks on any footing');
assert.match(worldSource, /WORLD_LAYERS\.legacyGeologyRockTile\(WG,wx,y,depth,biome\)/, 'legacy terrain delegates rock geology to the shared vertical layer model');
assert.match(worldLayerSource, /function geologyMix\(WG,wx,y,primary,secondary,seed,amount\)/, 'geology transitions are feathered by local noise');
assert.match(worldLayerSource, /export function legacyGeologyLayerDepth\(WG,wx,y,depth,biome\)/, 'geology layers use warped depth instead of straight horizontal bands');
assert.match(worldLayerSource, /export function legacyGeologyRockTile\(WG,wx,y,depth,biome\)/, 'legacy rock geology is centralized with sky and deep layer generation');
assert.match(worldLayerSource, /const dikeA=Math\.abs\(dx \+ sub\*/, 'volcanoes generate basaltic intrusion dikes that flare continuously from the vent');
assert.match(worldLayerSource, /export function volcanoAureoleTile\(WG,col,wx,y,ground,depth\)/, 'volcanic contact aureoles live in the shared vertical layer model');
assert.match(worldLayerSource, /Volcanic contact aureole/, 'volcanic rock generation includes baked contact zones');
assert.match(worldSource, /WORLD_LAYERS\.volcanoAureoleTile\(WG,col,wx,y,ground,depth\)/, 'legacy terrain delegates volcanic rock to the shared aureole model');

assert.ok(count(samples[8],T.STEEL)>=150, 'devastated city exposes harvestable steel');
assert.ok(count(samples[8],T.OBSIDIAN)>=40, 'devastated city contains hardened ruin material');
assert.ok(count(samples[8],T.GLASS)>=20, 'devastated city contains window glass');
assert.ok(count(samples[8],T.WIRE)>=6 && count(samples[8],T.WIRE)<=25, 'devastated city contains sparse dismantlable wires');

// --- Permafrost active layer: deep-cold western soil generates frozen; warm center stays loose ---
{
  const FROZEN=[T.FROZEN_DIRT,T.FROZEN_SAND,T.FROZEN_CLAY];
  // find a dry, deep-cold far-west stretch (climate temperature under the frost gate)
  let coldX=null;
  for(let wx=-40000; wx>=-59000 && coldX===null; wx-=97){
    const col=WG.column(wx);
    if(col.t<0.16 && col.row<WG.settings.seaLevel-2 && col.biome!==5 && col.biome!==6) coldX=wx;
  }
  assert.ok(coldX!==null, 'the far west offers deep-cold dry land');
  let frozen=0, looseSoil=0;
  for(let wx=coldX-24; wx<=coldX+24; wx++){
    const col=WG.column(wx);
    if(col.row>=WG.settings.seaLevel-1 || col.biome===5 || col.biome===6) continue;
    world.ensureChunk(Math.floor(wx/CHUNK_W));
    for(let y=col.row; y<col.row+10; y++){
      const t=world.getTile(wx,y);
      if(FROZEN.includes(t)) frozen++;
      else if(t===T.DIRT || t===T.SAND || t===T.CLAY) looseSoil++;
    }
  }
  assert.ok(frozen>=25, 'deep-cold columns generate a frozen soil band (got '+frozen+')');
  assert.ok(frozen>looseSoil, 'permafrost dominates loose soil in the deep-cold active layer ('+frozen+' vs '+looseSoil+')');
  // warm central biomes never generate permafrost
  for(const biome of [0,1,3,4]){
    assert.equal(countAny(samples[biome],FROZEN), 0, BIOME_NAMES[biome]+' generates no permafrost');
  }
}

console.log('biome-materials-sim: all assertions passed for seed '+SEED);
