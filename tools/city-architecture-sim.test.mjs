// Deterministic test for per-city architecture variety.
// Verifies: districts expose distinct architecture schools, palettes and
// skyline envelopes actually differ between schools, themed landmarks
// generate, and city structures stay chunk-order independent.
// Run: node tools/city-architecture-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.localStorage = {
  getItem(){ return null; },
  setItem(){},
  removeItem(){}
};

const { T, CHUNK_W, WORLD_H } = await import('../src/constants.js');
const { worldGen: WG } = await import('../src/engine/worldgen.js');
const { fallingSolids } = await import('../src/engine/falling.js');
const { world } = await import('../src/engine/world.js');

function reset(seed){
  WG.worldSeed = seed;
  WG.clearCaches();
  world.clear();
  fallingSolids.reset();
  fallingSolids.init(world.getTile,world.setTile);
}

function cityDistrictsInSpan(span){
  const districts = new Map();
  for(let x=-span; x<=span; x+=64){
    if(WG.biomeType(x)!==8) continue;
    const city = WG.cityAt(x);
    if(city && Number.isFinite(city.center)) districts.set(city.cell+':'+city.center, city);
  }
  return [...districts.values()].sort((a,b)=>a.center-b.center);
}

function chunksForCity(city,margin=16){
  const radius=Math.max(80,city.radius||180);
  const first=Math.floor((city.center-radius-margin)/CHUNK_W);
  const last=Math.floor((city.center+radius+margin)/CHUNK_W);
  const chunks=[];
  for(let cx=first; cx<=last; cx++) chunks.push(cx);
  return chunks;
}

function ensureChunks(chunks,order='forward'){
  const list=order==='reverse' ? [...chunks].reverse() : [...chunks];
  for(const cx of list) world.ensureChunk(cx);
}

// Structure mass above the terrain surface only, so terrain geology does not
// dilute the palette/height signal.
function aboveSurfaceStats(city){
  const radius=Math.max(80,city.radius||180);
  const stats={steel:0,stone:0,obsidian:0,glass:0,diamond:0,coreHeights:[],edgeHeights:[]};
  for(let x=Math.floor(city.center-radius); x<=Math.ceil(city.center+radius); x++){
    if(WG.biomeType(x)!==8) continue;
    const surf=WG.surfaceHeight(x);
    let top=null;
    for(let y=Math.max(2,surf-60); y<surf; y++){
      const t=world.getTile(x,y);
      if(t===T.AIR) continue;
      if(top===null) top=y;
      if(t===T.STEEL) stats.steel++;
      else if(t===T.STONE) stats.stone++;
      else if(t===T.OBSIDIAN) stats.obsidian++;
      else if(t===T.GLASS) stats.glass++;
      else if(t===T.DIAMOND) stats.diamond++;
    }
    const h=top===null?0:surf-top;
    const rel=Math.abs(x-city.center)/radius;
    if(rel<=0.25) stats.coreHeights.push(h);
    else if(rel>=0.72 && rel<=0.95) stats.edgeHeights.push(h);
  }
  return stats;
}

function avg(list){ return list.length ? list.reduce((a,b)=>a+b,0)/list.length : 0; }
function steelShare(stats){
  const solid=stats.steel+stats.stone+stats.obsidian;
  return solid ? stats.steel/solid : 0;
}

function cityHash(city){
  const radius=Math.max(80,city.radius||180);
  let hash=0n;
  for(let x=Math.floor(city.center-radius); x<=Math.ceil(city.center+radius); x++){
    const surf=WG.surfaceHeight(x);
    for(let y=Math.max(2,surf-60); y<surf+8; y++){
      hash=(hash*131n + BigInt(world.getTile(x,y)|0) + 7n) % 1000000007n;
    }
  }
  return hash;
}

const seeds=[20260616, 12345, 987654321, 682751860, 5150, 777];
const archesSeen=new Set();
const byArch=new Map();
for(const seed of seeds){
  reset(seed);
  for(const city of cityDistrictsInSpan(90000).slice(0,5)){
    assert.ok(Number.isFinite(city.arch) && city.arch>=0 && city.arch<=4, 'city '+city.center+' seed '+seed+' exposes an architecture school id');
    assert.ok(Number.isFinite(city.motif) && city.motif>=0 && city.motif<=1, 'city '+city.center+' seed '+seed+' exposes a silhouette motif');
    archesSeen.add(city.arch);
    if(!byArch.has(city.arch)) byArch.set(city.arch,{seed,city});
  }
}
assert.ok(archesSeen.size>=4, 'sampled districts cover at least 4 of 5 architecture schools, got '+[...archesSeen].join(','));

function generatedStats(pick){
  reset(pick.seed);
  ensureChunks(chunksForCity(pick.city));
  return aboveSurfaceStats(pick.city);
}

// Palette contrast: foundry sprawl (2) is far more steel-heavy than terraced
// ziggurat masonry (3).
const foundry=byArch.get(2), ziggurat=byArch.get(3);
assert.ok(foundry, 'sampled districts include a foundry-school city');
assert.ok(ziggurat, 'sampled districts include a ziggurat-school city');
const foundryStats=generatedStats(foundry);
const zigguratStats=generatedStats(ziggurat);
assert.ok(steelShare(foundryStats) > steelShare(zigguratStats)+0.08,
  'foundry city is visibly more steel-heavy than ziggurat city ('+steelShare(foundryStats).toFixed(2)+' vs '+steelShare(zigguratStats).toFixed(2)+')');
assert.ok(zigguratStats.diamond>=1, 'ziggurat district generates its grand-ziggurat landmark apex');

// Skyline envelope: a downtown-core school city towers over its own outskirts.
const cored=byArch.get(1)||byArch.get(0);
assert.ok(cored, 'sampled districts include a core-peaked school city');
const coredStats=generatedStats(cored);
const coreAvg=avg(coredStats.coreHeights), edgeAvg=avg(coredStats.edgeHeights);
assert.ok(coredStats.coreHeights.length>20 && coredStats.edgeHeights.length>20, 'height profile sampled on both core and edge columns');
assert.ok(coreAvg > edgeAvg*1.25, 'downtown core rises above the outskirts (core '+coreAvg.toFixed(1)+' vs edge '+edgeAvg.toFixed(1)+')');
assert.ok(coredStats.glass>40, 'core-peaked city still generates window glass');

// Chunk-order determinism for the most complex school found.
const pick=foundry;
reset(pick.seed);
const chunks=chunksForCity(pick.city);
ensureChunks(chunks,'forward');
const forwardHash=cityHash(pick.city);
world.clear();
fallingSolids.reset();
fallingSolids.init(world.getTile,world.setTile);
ensureChunks(chunks,'reverse');
assert.equal(cityHash(pick.city), forwardHash, 'city structures are independent of chunk load order');

// New structure styles must not self-collapse: settling may shed only a small
// decay-rubble fraction, leaves no permanent queue, and keeps key landmarks.
function tileSnapshot(city){
  const radius=Math.max(80,city.radius||180);
  const map=new Map();
  for(let x=Math.floor(city.center-radius); x<=Math.ceil(city.center+radius); x++){
    const surf=WG.surfaceHeight(x);
    for(let y=Math.max(2,surf-60); y<surf; y++){
      const t=world.getTile(x,y);
      if(t!==T.AIR && t!==undefined) map.set(x+','+y,t);
    }
  }
  return map;
}
for(const [archId,pickAny] of byArch){
  reset(pickAny.seed);
  ensureChunks(chunksForCity(pickAny.city));
  const before=tileSnapshot(pickAny.city);
  fallingSolids.settleAll();
  for(let i=0;i<240;i++) fallingSolids.update(world.getTile,world.setTile,1/60);
  fallingSolids.settleAll();
  assert.equal(fallingSolids.metrics().queue, 0, 'architecture school '+archId+' city settles without a permanent structural queue');
  const after=tileSnapshot(pickAny.city);
  let moved=0;
  for(const [k,t] of before) if(after.get(k)!==t) moved++;
  assert.ok(moved/before.size < 0.08,
    'architecture school '+archId+' city keeps its structures through settling (moved '+(100*moved/before.size).toFixed(2)+'%)');
  if(archId===3){
    let diamonds=0;
    for(const t of after.values()) if(t===T.DIAMOND) diamonds++;
    assert.ok(diamonds>=1, 'grand-ziggurat diamond apex survives structural settling');
  }
}

console.log('city-architecture-sim: schools seen='+[...archesSeen].sort().join(',')+
  ' foundrySteel='+steelShare(foundryStats).toFixed(2)+
  ' zigguratSteel='+steelShare(zigguratStats).toFixed(2)+
  ' core='+coreAvg.toFixed(1)+' edge='+edgeAvg.toFixed(1));
