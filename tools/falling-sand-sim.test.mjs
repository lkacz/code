// Falling-sand regressions: save/autosave freezes airborne grains into tiles.
// That path must form a pile instead of stacking every grain into one column.
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};

const { T } = await import('../src/constants.js');
const { fallingSolids } = await import('../src/engine/falling.js');

const key = (x,y)=>x+','+y;
const tiles = new Map();
const getTile = (x,y)=>tiles.get(key(x,y)) ?? T.AIR;
const setTile = (x,y,t)=>{
  if(t===T.AIR) tiles.delete(key(x,y));
  else tiles.set(key(x,y), t);
};

function reset(){
  tiles.clear();
  fallingSolids.reset();
  MM.water = { displaceAt(){}, onTileChanged(){} };
  fallingSolids.init(getTile,setTile);
}
function fillFloor(y,x0=-40,x1=40){
  for(let x=x0; x<=x1; x++) setTile(x,y,T.STONE);
}
function setFlatSurface(y){
  MM.worldGen = { surfaceHeight(){ return y; } };
}
function setCitySurface(y){
  MM.worldGen = { surfaceHeight(){ return y; }, biomeType(){ return 8; } };
}
function sandPile(){
  const counts=new Map();
  let total=0;
  for(const [k,t] of tiles){
    if(t!==T.SAND) continue;
    const x=+k.slice(0,k.indexOf(','));
    counts.set(x,(counts.get(x)||0)+1);
    total++;
  }
  const max=[...counts.values()].reduce((m,n)=>Math.max(m,n),0);
  return {counts,total,max};
}

function countRegionTile(t,x0,x1,y0,y1){
  let n=0;
  for(let x=x0; x<=x1; x++){
    for(let y=y0; y<=y1; y++) if(getTile(x,y)===t) n++;
  }
  return n;
}
function buildRect(t,x0,x1,y0,y1){
  for(let x=x0; x<=x1; x++){
    for(let y=y0; y<=y1; y++) setTile(x,y,t);
  }
}
function assertSettledState(label){
  const snap=fallingSolids.snapshot();
  assert.equal(snap.active.length, 0, label+' leaves no rigid falling bodies');
  assert.equal(snap.sand.length, 0, label+' leaves no airborne sand');
  assert.equal(snap.queue.length, 0, label+' drains queued instability before save');
}

{
  reset();
  fillFloor(13);
  setTile(-1,10,T.DYNAMO);
  setTile(0,10,T.DYNAMO_SLOT);
  setTile(1,10,T.DYNAMO);
  fallingSolids.restore({
    v:4,
    active:[{x:0,y:4,type:T.STONE,vy:0,rubble:true}],
    sand:[],
    queue:[]
  });

  fallingSolids.settleAll();

  assert.equal(getTile(0,10),T.DYNAMO_SLOT,'falling rubble does not occupy or erase a dynamo slot');
  assert.equal(getTile(-1,10),T.DYNAMO,'left dynamo casing survives nearby rubble settling');
  assert.equal(getTile(1,10),T.DYNAMO,'right dynamo casing survives nearby rubble settling');
  assert.equal(countRegionTile(T.STONE,0,0,9,9),1,'falling rubble rests above the machine slot instead of replacing it');
  assertSettledState('dynamo-slot rubble guard');
}

{
  reset();
  fillFloor(13);
  setTile(0,10,T.TELEPORTER);
  fallingSolids.restore({
    v:4,
    active:[{x:0,y:4,type:T.STONE,vy:0,rubble:true}],
    sand:[],
    queue:[]
  });

  fallingSolids.settleAll();

  assert.equal(getTile(0,10),T.TELEPORTER,'falling rubble does not occupy or erase a teleporter machine');
  assert.equal(countRegionTile(T.STONE,-3,3,0,12),1,'falling rubble is preserved near the teleporter instead of vanishing or passing through it');
  assertSettledState('teleporter rubble guard');
}

{
  reset();
  fillFloor(50);
  fallingSolids.restore({
    v:2,
    active:[],
    sand:Array.from({length:40},()=>({x:0,y:0,vy:0})),
    queue:[]
  });

  fallingSolids.settleAll();

  const pile=sandPile();
  assert.equal(pile.total, 40, 'save-settle keeps every airborne sand grain');
  assert.ok(pile.counts.size>=10, 'save-settled sand spreads across a real pile');
  assert.ok(pile.max<=7, 'save-settled sand does not become a tall chimney');
  assertSettledState('save-settle pile');
}

{
  reset();
  fillFloor(55);
  for(let y=38; y<=45; y++) setTile(0,y,T.SAND);
  setTile(0,46,T.STONE);
  setTile(0,46,T.AIR);
  fallingSolids.onTileRemoved(0,46);

  fallingSolids.settleAll();

  const pile=sandPile();
  assert.equal(pile.total, 8, 'collected/released sand column keeps its mass after autosave settle');
  assert.ok(pile.counts.size>=4, 'immediate-save sand release spreads before being frozen into the world');
  assert.ok(pile.max<=3, 'released sand column settles as a low pile, not a chimney');
  assertSettledState('immediate-save release');
}

{
  reset();
  setFlatSurface(50);
  fillFloor(50,-20,20);
  buildRect(T.STONE,0,0,40,49);
  fallingSolids.afterPlacement(0,40);
  fallingSolids.settleAll();
  assert.equal(countRegionTile(T.STONE,0,0,40,49),10,'10-high one-block stone chimney remains stable');
}

{
  reset();
  setFlatSurface(50);
  fillFloor(50,-30,30);
  buildRect(T.STONE,0,0,39,49);
  fallingSolids.afterPlacement(0,39);
  fallingSolids.settleAll();
  assert.equal(countRegionTile(T.STONE,0,0,39,49),10,'11-high one-block stone chimney sheds its excess top block');
  assert.equal(countRegionTile(T.STONE,-8,8,39,49),11,'toppled stone chimney keeps its blocks as nearby rubble');
}

{
  reset();
  setCitySurface(50);
  fillFloor(50,-30,30);
  buildRect(T.WOOD,0,0,39,49);
  fallingSolids.onTileRemoved(1,44);
  fallingSolids.settleAll();
  assert.equal(countRegionTile(T.WOOD,0,0,39,49),11,'unmarked generated city-adjacent columns are not treated as manual chimneys');
}

{
  reset();
  setCitySurface(50);
  fillFloor(50,-30,30);
  for(let y=49; y>=39; y--){
    setTile(0,y,T.WOOD);
    fallingSolids.afterPlacement(0,y);
  }
  fallingSolids.settleAll();
  assert.equal(countRegionTile(T.WOOD,0,0,39,49),10,'player-placed city chimney still sheds excess through manual tracking');
  assert.equal(countRegionTile(T.WOOD,-8,8,39,49),11,'player-placed city chimney keeps its excess as nearby rubble');
}

{
  reset();
  setCitySurface(50);
  fillFloor(50,-30,30);
  for(let y=49; y>=39; y--){
    setTile(0,y,T.WOOD);
    fallingSolids.recheckNeighborhood(0,y);
  }
  fallingSolids.settleAll();
  assert.equal(countRegionTile(T.WOOD,0,0,39,49),10,'undo-restored city chimney is synced into manual tracking and limited');
  assert.equal(countRegionTile(T.WOOD,-8,8,39,49),11,'undo-restored city chimney keeps its excess as nearby rubble');
}

{
  reset();
  setCitySurface(50);
  fillFloor(50,-30,30);
  for(let y=49; y>=40; y--){
    setTile(0,y,T.WOOD);
    fallingSolids.afterPlacement(0,y);
  }
  const snap=fallingSolids.snapshot();
  fallingSolids.restore(snap);
  setTile(0,39,T.WOOD);
  fallingSolids.afterPlacement(0,39);
  fallingSolids.settleAll();
  assert.equal(countRegionTile(T.WOOD,0,0,39,49),10,'restored manual city chimney still enforces the next over-limit placement');
  assert.equal(countRegionTile(T.WOOD,-8,8,39,49),11,'restored manual city chimney conserves the excess as rubble');
}

{
  reset();
  setFlatSurface(50);
  fillFloor(50,-30,30);
  buildRect(T.WOOD,0,1,30,49);
  fallingSolids.afterPlacement(0,30);
  fallingSolids.settleAll();
  assert.equal(countRegionTile(T.WOOD,0,1,30,49),40,'20-high two-block ordinary-material chimney is stable');
}

{
  reset();
  setFlatSurface(50);
  fillFloor(50,-30,30);
  buildRect(T.WOOD,0,1,29,49);
  fallingSolids.afterPlacement(0,29);
  fallingSolids.settleAll();
  assert.equal(countRegionTile(T.WOOD,0,1,29,49),40,'21-high two-block ordinary-material chimney sheds only the excess cap');
  assert.equal(countRegionTile(T.WOOD,-8,9,29,49),42,'toppled two-block cap remains as nearby wood rubble');
}

{
  reset();
  setFlatSurface(70);
  fillFloor(70,-30,30);
  buildRect(T.STONE,-2,2,65,69);
  buildRect(T.WOOD,0,0,54,64);
  fallingSolids.afterPlacement(0,54);
  fallingSolids.settleAll();
  assert.equal(countRegionTile(T.STONE,-2,2,65,69),25,'wide base remains intact when an over-tall mast fails');
  assert.equal(countRegionTile(T.WOOD,0,0,55,64),10,'narrow mast keeps its stable ten-block section above the base');
  assert.equal(countRegionTile(T.WOOD,-8,8,54,69),11,'wide-base mast sheds only the excess top block');
}

{
  reset();
  setFlatSurface(50);
  fillFloor(50,-30,30);
  buildRect(T.STONE,-1,-1,30,49);
  buildRect(T.WOOD,0,0,30,49);
  fallingSolids.afterPlacement(0,30);
  fallingSolids.settleAll();
  assert.equal(countRegionTile(T.WOOD,0,0,30,49),20,'one-block chimney is stable when continuously braced from the side');
}

{
  reset();
  setFlatSurface(50);
  fillFloor(50,-30,30);
  buildRect(T.STONE,-1,-1,30,49);
  buildRect(T.WOOD,0,0,30,49);
  fallingSolids.afterPlacement(0,30);
  fallingSolids.settleAll();
  for(let y=30; y<=49; y++){
    setTile(-1,y,T.AIR);
    fallingSolids.onTileRemoved(-1,y);
  }
  fallingSolids.settleAll();
  assert.equal(countRegionTile(T.WOOD,0,0,30,49),10,'removing a continuous side brace rechecks and limits the exposed chimney');
  assert.equal(countRegionTile(T.WOOD,-8,8,30,49),20,'unbraced chimney excess becomes nearby rubble after brace removal');
}

{
  reset();
  setFlatSurface(50);
  fillFloor(50,-30,30);
  buildRect(T.WOOD,0,1,30,49);
  fallingSolids.afterPlacement(0,30);
  fallingSolids.settleAll();
  for(let y=30; y<=49; y++){
    setTile(1,y,T.AIR);
    fallingSolids.onTileRemoved(1,y);
  }
  fallingSolids.settleAll();
  assert.equal(countRegionTile(T.WOOD,0,0,30,49),10,'narrowing a stable two-wide chimney rechecks the remaining one-wide column');
  assert.equal(countRegionTile(T.WOOD,-8,8,30,49),20,'narrowed chimney excess settles as nearby rubble');
}

{
  reset();
  setFlatSurface(50);
  fillFloor(50,-30,30);
  buildRect(T.WOOD,-1,-1,30,49);
  buildRect(T.STONE,0,0,30,49);
  buildRect(T.WOOD,1,1,30,49);
  fallingSolids.afterPlacement(0,30);
  fallingSolids.settleAll();
  for(let y=30; y<=49; y++) setTile(0,y,T.AIR);
  fallingSolids.onTileRemoved(0,40);
  fallingSolids.settleAll();
  assert.equal(countRegionTile(T.WOOD,-1,-1,30,37),0,'batch support removal clears the left exposed chimney top');
  assert.equal(countRegionTile(T.WOOD,1,1,30,37),0,'batch support removal also clears the right exposed chimney top');
  assert.equal(countRegionTile(T.WOOD,-8,8,30,49),40,'both exposed chimney tops settle as nearby rubble after one removal event');
}

{
  reset();
  setFlatSurface(139);
  fillFloor(139,-60,80);
  buildRect(T.WOOD,0,12,0,138);
  fallingSolids.afterPlacement(6,0);
  fallingSolids.settleAll();
  assert.equal(countRegionTile(T.WOOD,0,12,0,8),0,'wide but over-tall manual walls are still checked under the pillar cap');
  assert.equal(countRegionTile(T.WOOD,-60,80,0,138),1807,'large over-tall wall keeps its material as nearby rubble');
}

{
  reset();
  setFlatSurface(130);
  fillFloor(130,-80,80);
  buildRect(T.STEEL,0,0,30,129);
  fallingSolids.afterPlacement(0,30);
  fallingSolids.settleAll();
  assert.equal(countRegionTile(T.STEEL,0,0,30,129),100,'100-high one-block steel chimney is stable');
}

{
  reset();
  setFlatSurface(130);
  fillFloor(130,-80,80);
  buildRect(T.STEEL,0,0,29,129);
  fallingSolids.afterPlacement(0,29);
  fallingSolids.settleAll();
  assert.equal(countRegionTile(T.STEEL,0,0,29,129),100,'101-high one-block steel chimney sheds its excess top block');
  assert.equal(countRegionTile(T.STEEL,-8,8,29,129),101,'toppled steel excess remains as nearby rubble');
}

fallingSolids.reset();
console.log('falling sand simulation tests passed');
