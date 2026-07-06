// Deterministic test for abandoned civic lots in city districts.
// Empty lots must no longer scatter loose rubble piles; instead they carry
// nostalgic civic ruins: dead malls (with leftover meat), empty schools,
// churchyards with graves, overgrown parks and occasional fairground coasters.
// Also verifies the new ruins survive the structural settle audit and that
// worldgen-placed meat is discovered by the meat decay system.
// Run: node tools/city-civic-ruins-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.localStorage = {
  getItem(){ return null; },
  setItem(){},
  removeItem(){}
};

const { T, CHUNK_W } = await import('../src/constants.js');
const { worldGen: WG } = await import('../src/engine/worldgen.js');
const { fallingSolids } = await import('../src/engine/falling.js');
const { meat } = await import('../src/engine/meat.js');
const { world } = await import('../src/engine/world.js');

function reset(seed){
  WG.worldSeed = seed;
  WG.clearCaches();
  world.clear();
  fallingSolids.reset();
  fallingSolids.init(world.getTile,world.setTile);
  meat.reset();
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

// Mirrors the lot layout in world.js applyDevastatedCity (pitch, anchor jitter,
// vacancy roll and civic kind bands are test-bound contract values).
const PITCH=18;
const lotAnchor=(cell)=>cell*PITCH + Math.floor(WG.randSeed(cell*31.17+7.1)*7)-3;
const lotEmpty=(cell,density)=>WG.randSeed(cell*17.33+2.9)>density;
const civicKind=(cell)=>{
  const roll=WG.randSeed(cell*7.77+5.13);
  if(roll<0.10) return 'coaster';
  if(roll<0.38) return 'mall';
  if(roll<0.60) return 'school';
  if(roll<0.80) return 'church';
  return 'park';
};
const civicWide=(kind)=>kind==='mall'||kind==='coaster';

function cityColAt(wx){
  const col=WG.column(wx);
  return col && col.biome===8 && !col.volcano && col.city ? col : null;
}

// Resolve the realized civic kind for an empty lot cell, mirroring the wide
// ruin claiming rules ('tail' cells are consumed by the previous anchor).
function realizedKind(cell,density){
  const prevEmpty=lotEmpty(cell-1,density);
  if(prevEmpty && !lotEmpty(cell-2,density) && civicWide(civicKind(cell-1))) return 'tail';
  let kind=civicKind(cell);
  if(civicWide(kind) && (prevEmpty || !lotEmpty(cell+1,density))){
    kind=kind==='mall'?'smallmall':'park';
  }
  return kind;
}

// Mirrors cityLandmarkSpec in world.js: the district landmark is force-built
// after civic lots and may overwrite one, so those lots are skipped below.
function landmarkAnchor(city){
  const seed=(city.cell||0)*53.9+city.center*0.017;
  const radius=Math.max(120,city.radius||180);
  const dir=WG.randSeed(seed+0.7)>0.5?1:-1;
  const off=Math.max(64,Math.min(radius-46, 80+Math.floor(WG.randSeed(seed+1.3)*radius*0.22)));
  return Math.round(city.center+dir*off);
}

function windowStats(x0,x1){
  const s={grass:0,wood:0,brick:0,glass:0,steel:0,stone:0,obsidian:0,grave:0,meat:0,vending:0,ladder:0,chest:0,dynamo:0,solid:0};
  for(let x=x0; x<=x1; x++){
    if(WG.biomeType(x)!==8) continue;
    const surf=WG.surfaceHeight(x);
    for(let y=Math.max(2,surf-46); y<=surf; y++){
      const t=world.getTile(x,y);
      if(t===T.AIR) continue;
      if(y<surf) s.solid++;
      if(t===T.GRASS) s.grass++;
      else if(t===T.WOOD) s.wood++;
      else if(t===T.BRICK) s.brick++;
      else if(t===T.GLASS) s.glass++;
      else if(t===T.STEEL) s.steel++;
      else if(t===T.STONE) s.stone++;
      else if(t===T.OBSIDIAN) s.obsidian++;
      else if(t===T.GRAVE) s.grave++;
      else if(t===T.MEAT || t===T.ROTTEN_MEAT || t===T.BAKED_MEAT) s.meat++;
      else if(t===T.VENDING_MACHINE) s.vending++;
      else if(t===T.LADDER) s.ladder++;
      else if(t===T.CHEST_COMMON || t===T.CHEST_RARE || t===T.CHEST_EPIC) s.chest++;
      else if(t===T.DYNAMO || t===T.DYNAMO_SLOT) s.dynamo++;
    }
  }
  return s;
}

const seeds=[20260616, 12345, 987654321, 682751860, 5150, 777];
const kindTotals=new Map();
let mallsWithMeat=0, mallCount=0;
let parkCount=0, parksWithTree=0;
let churchCount=0, churchesWithGrave=0;
let coasterCount=0, coastersWithKiosk=0, coastersWithCar=0;
let coasterSample=null, wideMallSample=null;
let lotsChecked=0;

for(const seed of seeds){
  reset(seed);
  for(const city of cityDistrictsInSpan(90000).slice(0,4)){
    const chunks=chunksForCity(city);
    for(const cx of chunks) world.ensureChunk(cx);
    const radius=Math.max(80,city.radius||180);
    const firstCell=Math.ceil((city.center-radius+PITCH)/PITCH);
    const lastCell=Math.floor((city.center+radius-PITCH)/PITCH);
    for(let cell=firstCell; cell<=lastCell; cell++){
      const anchor=lotAnchor(cell);
      const col=cityColAt(anchor);
      if(!col) continue;
      const density=col.city.density;
      if(!lotEmpty(cell,density)) continue;
      const kind=realizedKind(cell,density);
      if(kind==='tail') continue;
      // Only judge lots whose whole footprint stays inside the district and
      // clear of the force-built landmark and power plant.
      const span=civicWide(kind)?40:20;
      if(!cityColAt(anchor-4) || !cityColAt(anchor+span)) continue;
      if(Math.abs(anchor-landmarkAnchor(city))<=44) continue;
      const s=windowStats(anchor-4,anchor+span);
      if(s.dynamo>0) continue;
      kindTotals.set(kind,(kindTotals.get(kind)||0)+1);
      lotsChecked++;
      assert.ok(s.solid>=10,
        seed+'/'+cell+' '+kind+' lot is a real civic ruin, not a barren rubble lot (solid='+s.solid+')');
      if(kind==='park'){
        parkCount++;
        if(s.wood>=2) parksWithTree++;
        assert.ok(s.grass>=6, seed+'/'+cell+' park lot grew a lawn (grass='+s.grass+')');
      } else if(kind==='school'){
        assert.ok(s.brick>=25, seed+'/'+cell+' school reads as a brick building (brick='+s.brick+')');
      } else if(kind==='church'){
        churchCount++;
        if(s.grave>=1) churchesWithGrave++;
        assert.ok(s.stone+s.obsidian>=30, seed+'/'+cell+' church nave and tower stand');
      } else if(kind==='mall'||kind==='smallmall'){
        mallCount++;
        if(s.meat>0) mallsWithMeat++;
        assert.ok(s.steel>=14, seed+'/'+cell+' mall keeps its steel frame (steel='+s.steel+')');
        assert.ok(s.glass>=4, seed+'/'+cell+' mall keeps storefront glass (glass='+s.glass+')');
        if(kind==='mall' && !wideMallSample) wideMallSample={seed,city,anchor,span};
      } else if(kind==='coaster'){
        coasterCount++;
        if(s.vending>=1) coastersWithKiosk++;
        if(s.obsidian>=1) coastersWithCar++;
        assert.ok(s.steel>=14, seed+'/'+cell+' coaster keeps its track and pylons (steel='+s.steel+')');
        if(!coasterSample) coasterSample={seed,city,anchor,span,chunks};
      }
    }
  }
}

assert.ok(lotsChecked>=40, 'sampled a meaningful number of civic lots ('+lotsChecked+')');
for(const kind of ['park','school','church','mall','coaster']){
  const n=(kindTotals.get(kind)||0)+(kind==='mall'?(kindTotals.get('smallmall')||0):0);
  assert.ok(n>=1, 'civic kind "'+kind+'" appears across sampled districts');
}
assert.ok(mallCount>=3 && mallsWithMeat>=1,
  'dead malls exist and at least one still has meat in the food court ('+mallsWithMeat+'/'+mallCount+')');
// Neighbouring frames may overwrite edge decorations on some lots, but the
// signature props must survive on a clear majority of them.
assert.ok(churchCount>=2 && churchesWithGrave/churchCount>=0.7,
  'most churchyards keep their graves ('+churchesWithGrave+'/'+churchCount+')');
assert.ok(parkCount>=2 && parksWithTree/parkCount>=0.7,
  'most parks keep a dead tree ('+parksWithTree+'/'+parkCount+')');
assert.ok(coasterCount>=1 && coastersWithKiosk>=1 && coastersWithCar>=1,
  'coasters keep their kiosk and stranded car ('+coastersWithKiosk+'/'+coastersWithCar+'/'+coasterCount+')');

// The meat decay system must discover worldgen food-court leftovers, and city
// interiors must carry generated back walls on the construction-background
// layer (the same layer players build onto with R) so rooms read enclosed.
{
  const pick=wideMallSample || coasterSample;
  assert.ok(pick, 'found a wide civic ruin to audit');
  reset(pick.seed);
  const chunks=chunksForCity(pick.city);
  for(const cx of chunks) world.ensureChunk(cx);
  meat.reset();
  const found=meat.auditChunks(chunks, world.getTile);
  assert.ok(found>=1, 'meat audit registers generated food-court meat (found='+found+')');
  let backdrop=0, openBackdrop=0;
  const radius=Math.max(80,pick.city.radius||180);
  for(let x=Math.floor(pick.city.center-radius); x<=Math.ceil(pick.city.center+radius); x++){
    const surf=WG.surfaceHeight(x);
    for(let y=Math.max(2,surf-46); y<surf+8; y++){
      const bg=world.getConstructionBackground(x,y);
      if(bg===T.AIR) continue;
      backdrop++;
      if(world.getTile(x,y)===T.AIR) openBackdrop++;
    }
  }
  assert.ok(backdrop>=60, 'city interiors carry generated back walls ('+backdrop+')');
  assert.ok(openBackdrop>=40, 'back walls actually show through open interior air ('+openBackdrop+')');
  // Mining a generated back wall leaves a tombstone: the cell stays empty.
  let probe=null;
  outer: for(let x=Math.floor(pick.city.center-radius); x<=Math.ceil(pick.city.center+radius); x++){
    const surf=WG.surfaceHeight(x);
    for(let y=Math.max(2,surf-46); y<surf; y++){
      if(world.getTile(x,y)===T.AIR && world.getConstructionBackground(x,y)!==T.AIR){ probe={x,y}; break outer; }
    }
  }
  assert.ok(probe, 'found an open interior cell with a generated back wall');
  world.clearConstructionBackground(probe.x,probe.y);
  assert.equal(world.getConstructionBackground(probe.x,probe.y), T.AIR, 'mined generated back wall stays empty (tombstone)');
}

// Civic ruins must survive the structural settle audit like any city building.
{
  assert.ok(coasterSample, 'sampled districts realize at least one roller coaster');
  const {seed,city,anchor,span}=coasterSample;
  reset(seed);
  const chunks=chunksForCity(city);
  for(const cx of chunks) world.ensureChunk(cx);
  const before=windowStats(anchor-4,anchor+span);
  fallingSolids.auditChunks(chunks,{force:true,immediate:true});
  fallingSolids.settleAll();
  for(let i=0;i<240;i++) fallingSolids.update(world.getTile,world.setTile,1/60);
  fallingSolids.settleAll();
  assert.equal(fallingSolids.metrics().queue,0,'coaster lot settles without a permanent structural queue');
  const after=windowStats(anchor-4,anchor+span);
  assert.ok(after.steel>=Math.floor(before.steel*0.85),
    'coaster track and pylons survive settling ('+after.steel+'/'+before.steel+')');
}

const summary=[...kindTotals.entries()].sort().map(([k,n])=>k+'='+n).join(' ');
console.log('city-civic-ruins-sim: lots='+lotsChecked+' '+summary+' mallsWithMeat='+mallsWithMeat+'/'+mallCount);
