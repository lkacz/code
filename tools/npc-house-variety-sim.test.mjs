import assert from 'node:assert/strict';

// Procedural NPC house architecture: every resident's home rolls a biome-fitting
// archetype (cabin / lodge / cottage / farmhouse / longhouse / chalet / adobe /
// riad / stilt / tower / townhouse / loft) plus independent attachment rolls, so
// houses differ from each other while honouring hard contracts: deterministic
// re-derivation, a two-tile structural doorway at ground level, the roof-apex
// build check, windows and lighting, full integrity after a physical build, and
// immunity to the falling engine's collapse audit.

globalThis.window = globalThis;
globalThis.performance = { now:()=>1000 };
globalThis.MM = {};
globalThis.msg = ()=>{};
let gameDay = 4;
globalThis.MM.seasons = { metrics(){ return {dayFloat:gameDay}; } };
globalThis.inv = {};
globalThis.MM.inventory = { grantItem(){return true;}, equip(){return true;}, getItem(){return null;} };
globalThis.MM.water = { displaceAt(){}, onTileChanged(){} };

const { T, CHUNK_W } = await import('../src/constants.js');
const { fallingSolids: FALLING } = await import('../src/engine/falling.js');
const { npcRegistry } = await import('../src/engine/npc_system.js');
const { generatedNpcs } = await import('../src/engine/generated_npcs.js');

const SURFACE = 46;
let tiles = new Map();
const tk = (x,y)=>Math.round(x)+','+Math.round(y);
function getTile(x,y){ const k=tk(x,y); if(tiles.has(k)) return tiles.get(k); return Math.round(y)>=SURFACE ? T.STONE : T.AIR; }
function setTile(x,y,v){ tiles.set(tk(x,y), v); }

function worldGenFor(biome,seed){
  return { worldSeed:seed, settings:{seaLevel:62}, biomeType(){ return biome; }, surfaceHeight(){ return SURFACE; } };
}

function candidatesFor(worldGen,count){
  const out=[];
  for(let cell=1; cell<600 && out.length<count; cell++){
    const c=generatedNpcs._candidateForCell(cell,worldGen);
    if(c) out.push(c);
  }
  return out;
}

function shapeSignature(candidate,worldGen){
  const {layout,cells}=generatedNpcs._houseCells(candidate,getTile,worldGen);
  return cells
    .map(c=>(c.x-layout.cx)+':'+(c.y-layout.g)+':'+c.t+':'+(c.structural?1:0))
    .sort()
    .join('|');
}

const BIOMES=[0,1,2,3,4,7,8];
const archesSeen=new Map();       // arch -> {candidate,worldGen}
const dims=new Set();
let housesChecked=0;

for(const biome of BIOMES){
  const worldGen=worldGenFor(biome, 9000+biome*17);
  generatedNpcs.reset();
  const cands=candidatesFor(worldGen,10);
  assert.ok(cands.length>=6, 'biome '+biome+' yields resident candidates');
  const signatures=new Set();
  for(const cand of cands){
    tiles=new Map();
    const first=generatedNpcs._houseCells(cand,getTile,worldGen);
    const second=generatedNpcs._houseCells(cand,getTile,worldGen);
    assert.equal(JSON.stringify(first.cells), JSON.stringify(second.cells),
      'house blueprint re-derives identically (biome '+biome+' cell '+cand.cell+')');
    const L=first.layout, cells=first.cells;
    housesChecked++;
    archesSeen.set(L.arch,{candidate:cand,worldGen,biome});
    dims.add(L.halfW+'x'+L.wallH);
    signatures.add(shapeSignature(cand,worldGen));
    // No two cells may claim the same coordinate within a layer (integrity
    // depends on it); back walls share coordinates with foreground cells.
    const coords=new Set();
    for(const c of cells){
      const k=(c.layer==='bg'?'b:':'f:')+c.x+','+c.y;
      assert.ok(!coords.has(k), 'no duplicate cell at '+k+' (biome '+biome+' cell '+cand.cell+')');
      coords.add(k);
    }
    // Interior back walls: on the R-toggled construction-background layer,
    // cosmetic only, and never behind windows (those keep daylight).
    const bg=cells.filter(c=>c.layer==='bg');
    assert.ok(bg.length>=4, 'house has interior back walls (biome '+biome+' cell '+cand.cell+')');
    assert.ok(bg.every(c=>!c.structural && c.role==='backwall'), 'back walls are cosmetic, not load-bearing');
    const windowCoords=new Set(cells.filter(c=>c.role==='window').map(c=>c.x+','+c.y));
    assert.ok(bg.every(c=>!windowCoords.has(c.x+','+c.y)), 'no back wall behind a window');
    const doors=cells.filter(c=>c.role==='door');
    assert.ok(doors.length>=2 && doors.every(c=>c.structural), 'full structural doorway (biome '+biome+' cell '+cand.cell+')');
    assert.ok(doors.some(c=>c.y===L.g-1), 'doorway starts at floor level');
    const apex=cells.find(c=>c.x===L.cx && c.y===L.apexY);
    assert.ok(apex && apex.t===L.pal.roof && apex.structural, 'roof apex contract cell exists');
    assert.ok(cells.filter(c=>c.role==='window').length>=2, 'house has at least two windows');
    assert.ok(cells.some(c=>c.role==='light' && c.t===T.TORCH), 'house is lit');
    assert.ok(cells.filter(c=>c.structural).length>=20, 'substantial structural shell');
    for(const c of cells){
      assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y) && c.y>2 && c.y<SURFACE+30, 'cell within sane bounds');
    }
    // A physical build must read back as fully intact (back walls live on the
    // separate background layer and never enter the foreground grid).
    for(const c of cells){ if(c.layer!=='bg') setTile(c.x,c.y,c.t); }
    assert.equal(generatedNpcs._houseIntegrity(cand,getTile,worldGen), 1,
      'freshly built house reads fully intact (biome '+biome+' cell '+cand.cell+')');
  }
  assert.ok(signatures.size>=Math.ceil(cands.length*0.75),
    'biome '+biome+' houses are individually distinct ('+signatures.size+'/'+cands.length+')');
}

assert.ok(archesSeen.size>=6, 'at least six house archetypes appear across biomes, got: '+[...archesSeen.keys()].join(','));
assert.ok(dims.size>=5, 'house massing varies (distinct halfW x wallH combos: '+dims.size+')');

// The falling engine must leave every archetype standing: build through the real
// manager (which registers protection), then run the aggressive audit + settle.
// A mock construction-background layer stands in for world.js to prove the
// back walls are routed there instead of into the foreground grid.
const bgLayer=new Map();
globalThis.MM.world={
  setConstructionBackground(x,y,t){ bgLayer.set(x+','+y,t); return true; },
  getConstructionBackground(x,y){ return bgLayer.get(x+','+y)||T.AIR; }
};
let audited=0;
for(const [arch,pick] of archesSeen){
  if(audited>=6) break;
  audited++;
  tiles=new Map();
  bgLayer.clear();
  FALLING.reset();
  FALLING.init(getTile,setTile);
  generatedNpcs.reset();
  globalThis.MM.worldGen=pick.worldGen;
  const player={x:pick.candidate.x,y:SURFACE-1,hp:100};
  const ctx={worldGen:pick.worldGen,gameDayFloat(){return gameDay;},onInventoryChange(){},onChange(){}};
  generatedNpcs.update(1,player,getTile,setTile,ctx);
  const {layout,cells}=generatedNpcs._houseCells(pick.candidate,getTile,pick.worldGen);
  const structural=cells.filter(c=>c.structural);
  assert.ok(structural.every(c=>getTile(c.x,c.y)===c.t), arch+' house builds physically');
  assert.ok(structural.every(c=>FALLING.isProtectedBuild(c.x,c.y)), arch+' house shell is protected');
  const bgCells=cells.filter(c=>c.layer==='bg');
  const fgAt=new Map(cells.filter(c=>c.layer!=='bg').map(c=>[c.x+','+c.y,c]));
  assert.ok(bgCells.length>0 && bgCells.every(c=>bgLayer.get(c.x+','+c.y)===c.t),
    arch+' back walls land on the construction-background layer');
  assert.ok(bgCells.every(c=>{ const f=fgAt.get(c.x+','+c.y); return f && getTile(c.x,c.y)===f.t; }),
    arch+' back walls never overwrite the foreground grid');
  assert.ok(bgCells.every(c=>{ const f=fgAt.get(c.x+','+c.y); return f.t!==T.AIR || !FALLING.isProtectedBuild(c.x,c.y); }),
    arch+' open interior cells stay unprotected despite their back walls');
  const chunks=new Set();
  for(const c of cells) chunks.add(Math.floor(c.x/CHUNK_W));
  FALLING.auditChunks([...chunks],{force:true,immediate:true});
  FALLING.settleAll();
  for(let i=0;i<240;i++) FALLING.update(getTile,setTile,1/60);
  FALLING.settleAll();
  const survivors=structural.filter(c=>getTile(c.x,c.y)===c.t);
  assert.equal(survivors.length, structural.length,
    arch+' house survives the structural audit intact ('+survivors.length+'/'+structural.length+')');
  try{ npcRegistry.unregister(pick.candidate.id); }catch(e){ /* lifecycle cleanup only */ }
}

generatedNpcs.reset();
console.log('npc-house-variety-sim: houses='+housesChecked+' archetypes='+[...archesSeen.keys()].sort().join(',')+' massings='+dims.size+' audited='+audited);
