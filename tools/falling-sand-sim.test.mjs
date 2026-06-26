// Falling-sand regressions: save/autosave freezes airborne grains into tiles.
// That path must form a pile instead of stacking every grain into one column.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};

const { T } = await import('../src/constants.js');
const { fallingSolids } = await import('../src/engine/falling.js');
await import('../src/engine/dynamo.js');

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
function placeBuilt(t,x,y){
  setTile(x,y,t);
  fallingSolids.afterPlacement(x,y);
}
function placeBuiltRect(t,x0,x1,y0,y1){
  for(let x=x0; x<=x1; x++){
    for(let y=y0; y<=y1; y++) placeBuilt(t,x,y);
  }
}
function assertSettledState(label){
  const snap=fallingSolids.snapshot();
  assert.equal(snap.active.length, 0, label+' leaves no rigid falling bodies');
  assert.equal(snap.sand.length, 0, label+' leaves no airborne sand');
  assert.equal(snap.queue.length, 0, label+' drains queued instability before save');
}
function stepFalling(seconds,dt=1/60){
  let t=0;
  while(t<seconds-1e-9){
    const d=Math.min(dt,seconds-t);
    fallingSolids.update(getTile,setTile,d);
    t+=d;
  }
}
function makeDrawCtx(){
  const calls=[];
  return {
    calls,
    fillStyle:'',
    strokeStyle:'',
    lineWidth:1,
    save(){ calls.push('save'); },
    restore(){ calls.push('restore'); },
    beginPath(){ calls.push('beginPath'); },
    closePath(){ calls.push('closePath'); },
    moveTo(){ calls.push('moveTo'); },
    lineTo(){ calls.push('lineTo'); },
    stroke(){ calls.push('stroke'); },
    fill(){ calls.push('fill'); },
    fillRect(){ calls.push('fillRect'); },
    strokeRect(){ calls.push('strokeRect'); }
  };
}
function supportedCantileverCells(t,span=25){
  reset();
  setFlatSurface(60);
  fillFloor(60,-40,40);
  placeBuiltRect(t,0,0,55,59);
  placeBuiltRect(t,0,span,54,54);
  fallingSolids.settleAll();
  return countRegionTile(t,0,span,54,54);
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
  fillFloor(30,-8,8);
  setTile(0,20,T.WIRE);
  fallingSolids.restore({
    v:4,
    active:[{x:0,y:4,type:T.STONE,vy:0,rubble:true}],
    sand:[],
    queue:[]
  });
  stepFalling(1.2);
  fallingSolids.settleAll();
  assert.equal(getTile(0,20),T.WIRE,'live falling rubble passes through passable wiring instead of erasing it');
  assert.equal(countRegionTile(T.STONE,-2,2,0,29),1,'rubble remains conserved after passing through passable wiring');
  assertSettledState('wire pass-through rubble guard');
}

{
  reset();
  fillFloor(30,-8,8);
  setTile(0,20,T.COAL);
  fallingSolids.restore({
    v:4,
    active:[{x:0,y:4,type:T.STONE,vy:0,rubble:true}],
    sand:[],
    queue:[]
  });
  stepFalling(1.2);
  fallingSolids.settleAll();
  assert.equal(getTile(0,20),T.AIR,'live falling rubble crushes invalid coal support instead of resting on it');
  assert.equal(countRegionTile(T.STONE,-3,3,0,29),1,'crushing a coal support conserves the falling rubble');
  assert.equal(countRegionTile(T.COAL,-3,3,0,29),1,'crushed coal support becomes falling material instead of disappearing');
  assertSettledState('coal crush rubble guard');
}

{
  reset();
  fillFloor(120,-80,80);
  MM.wind = { speedAt(){ return 5; }, speed(){ return 5; } };
  fallingSolids.restore({
    v:4,
    active:[],
    sand:[{x:0,y:10,vy:0}],
    queue:[]
  });
  stepFalling(1.4);
  const snap=fallingSolids.snapshot();
  assert.equal(snap.sand.length, 1, 'wind test keeps the sand grain airborne before it reaches the floor');
  assert.ok(snap.sand[0].x>=1, 'strong exposed wind drifts airborne sand sideways');
  delete MM.wind;
}

{
  reset();
  fillFloor(120,-80,80);
  MM.wind = { speedAt(){ return 5; }, speed(){ return 5; } };
  fallingSolids.restore({
    v:4,
    active:[{x:0,y:10,type:T.STEEL,vy:0,rubble:true}],
    sand:[],
    queue:[]
  });
  stepFalling(1.4);
  const snap=fallingSolids.snapshot();
  assert.equal(snap.active.length, 1, 'wind test keeps the steel block airborne before it reaches the floor');
  assert.ok(snap.active[0].x<=1, 'heavy steel rubble barely drifts in the same strong wind');
  delete MM.wind;
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
  setFlatSurface(60);
  fillFloor(60,-30,30);
  assert.equal(fallingSolids.canSupportPlacement(6,40,T.STONE).ok,false,'placement support check rejects a block floating in open air');
  setTile(0,50,T.STONE);
  assert.equal(fallingSolids.canSupportPlacement(1,50,T.STONE).ok,true,'placement support check still allows a short wall-attached block');
}

{
  reset();
  setFlatSurface(60);
  fillFloor(60,-30,30);
  setTile(0,50,T.WATER_PUMP);
  assert.equal(fallingSolids.canSupportPlacement(1,50,T.STONE).ok,false,'machines do not count as building-physics anchors');
  setTile(0,50,T.BEDROCK);
  assert.equal(fallingSolids.canSupportPlacement(1,50,T.STONE).ok,true,'terrain anchors still support wall-attached building blocks');
}

{
  reset();
  setFlatSurface(60);
  setTile(0,51,T.DIRT);
  assert.equal(fallingSolids.canSupportPlacement(0,50,T.STONE).ok,true,'weak fill can carry a direct vertical footing');
  reset();
  setFlatSurface(60);
  setTile(-1,50,T.DIRT);
  assert.equal(fallingSolids.canSupportPlacement(0,50,T.STONE).ok,false,'weak fill does not act as a lateral wall anchor');
}

{
  reset();
  fillFloor(40,-10,10);
  setTile(0,21,T.STONE);
  setTile(0,20,T.TURRET);
  fallingSolids.afterPlacement(0,20);
  fallingSolids.settleAll();
  assert.equal(getTile(0,20),T.TURRET,'solid machine stays put while it has footing');
  setTile(0,21,T.AIR);
  fallingSolids.onTileRemoved(0,21);
  fallingSolids.settleAll();
  assert.equal(getTile(0,20),T.AIR,'solid machine leaves its unsupported original cell');
  assert.equal(getTile(0,39),T.TURRET,'unsupported solid machine falls onto the floor');
}

{
  reset();
  fillFloor(40,-10,10);
  setTile(0,21,T.CHEST_COMMON);
  setTile(0,20,T.TURRET);
  fallingSolids.auditChunks([0],{force:true,immediate:true});
  fallingSolids.settleAll();
  assert.equal(getTile(0,20),T.AIR,'machine does not stay supported by a chest footing');
  assert.equal(getTile(0,21),T.AIR,'chest under a machine is audited as its own falling object');
  assert.equal(countRegionTile(T.TURRET,-2,2,0,39),1,'unsupported machine remains conserved while falling/settling');
  assert.equal(countRegionTile(T.CHEST_COMMON,-2,2,0,39),1,'unsupported chest remains conserved while falling/settling');
}

{
  reset();
  fillFloor(40,-10,10);
  setTile(-1,20,T.STONE);
  setTile(0,20,T.WATER_PUMP);
  fallingSolids.afterPlacement(0,20);
  fallingSolids.settleAll();
  assert.equal(getTile(0,20),T.WATER_PUMP,'side-braced machine can hang from a terrain wall');
  setTile(-1,20,T.AIR);
  fallingSolids.onTileRemoved(-1,20);
  fallingSolids.settleAll();
  assert.equal(getTile(0,39),T.WATER_PUMP,'side-braced machine falls when the wall brace is removed');
}

{
  reset();
  fillFloor(40,-10,10);
  setTile(0,21,T.GLASS);
  setTile(0,20,T.TURRET);
  fallingSolids.auditChunks([0],{force:true,immediate:true});
  fallingSolids.settleAll();
  assert.equal(getTile(0,20),T.AIR,'legacy machine does not remain supported by fragile glass footing');
  assert.equal(getTile(0,39),T.TURRET,'machine on invalid fragile footing falls to the real floor');
}

{
  reset();
  fillFloor(40,-10,10);
  setTile(0,21,T.COAL);
  setTile(0,20,T.TURRET);
  fallingSolids.auditChunks([0],{force:true,immediate:true});
  fallingSolids.settleAll();
  assert.equal(getTile(0,20),T.AIR,'machine crushes invalid coal footing instead of hovering on it');
  assert.equal(countRegionTile(T.TURRET,-2,2,0,39),1,'machine is conserved after crushing coal footing');
  assert.equal(countRegionTile(T.COAL,-2,2,0,39),1,'crushed coal support is released as falling material');
}

{
  reset();
  fillFloor(40,-10,10);
  setTile(-1,20,T.DYNAMO);
  setTile(0,20,T.DYNAMO_SLOT);
  setTile(1,20,T.DYNAMO);
  setTile(-1,21,T.STONE);
  fallingSolids.auditChunks([0],{force:true,immediate:true});
  fallingSolids.settleAll();
  assert.equal(getTile(-1,20),T.DYNAMO,'supported dynamo keeps its left casing');
  assert.equal(getTile(0,20),T.DYNAMO_SLOT,'supported dynamo keeps its center slot');
  assert.equal(getTile(1,20),T.DYNAMO,'supported dynamo keeps its right casing instead of splitting');
  setTile(-1,21,T.AIR);
  fallingSolids.onTileRemoved(-1,21);
  fallingSolids.settleAll();
  assert.equal(getTile(-1,20),T.AIR,'unsupported dynamo releases its left casing from the original position');
  assert.equal(getTile(0,20),T.AIR,'unsupported dynamo releases its slot from the original position');
  assert.equal(getTile(1,20),T.AIR,'unsupported dynamo releases its right casing from the original position');
  assert.equal(countRegionTile(T.DYNAMO,-4,4,0,39),2,'unsupported dynamo conserves both casing tiles');
  assert.equal(countRegionTile(T.DYNAMO_SLOT,-4,4,0,39),1,'unsupported dynamo conserves its slot tile');
}

{
  reset();
  fillFloor(40,-10,10);
  setTile(5,18,T.DYNAMO);
  setTile(5,19,T.DYNAMO_SLOT);
  setTile(5,20,T.DYNAMO);
  fallingSolids.auditChunks([0],{force:true,immediate:true});
  fallingSolids.settleAll();
  assert.equal(getTile(5,18),T.AIR,'legacy unsupported vertical dynamo does not leave its top casing floating');
  assert.equal(getTile(5,19),T.AIR,'legacy unsupported vertical dynamo does not leave its slot floating');
  assert.equal(getTile(5,20),T.AIR,'legacy unsupported vertical dynamo does not leave its bottom casing floating');
  assert.equal(countRegionTile(T.DYNAMO,3,7,0,39),2,'vertical dynamo collapse preserves both casing tiles');
  assert.equal(countRegionTile(T.DYNAMO_SLOT,3,7,0,39),1,'vertical dynamo collapse preserves the slot tile');
}

{
  reset();
  fillFloor(40,-10,10);
  setTile(0,21,T.SAND);
  setTile(0,20,T.CHEST_COMMON);
  fallingSolids.auditChunks([0],{force:true,immediate:true});
  fallingSolids.settleAll();
  assert.equal(getTile(0,20),T.CHEST_COMMON,'chest can rest on sand without becoming structural support');
}

{
  reset();
  fillFloor(40,-10,10);
  setTile(-1,20,T.GLASS);
  setTile(0,20,T.WATER_PUMP);
  fallingSolids.auditChunks([0],{force:true,immediate:true});
  fallingSolids.settleAll();
  assert.equal(getTile(0,20),T.AIR,'machine cannot hang from a fragile glass side brace');
  assert.equal(getTile(0,39),T.WATER_PUMP,'machine with invalid side brace falls to the real floor');
}

{
  reset();
  fillFloor(40,-10,10);
  setTile(5,20,T.CHEST_RARE);
  fallingSolids.auditChunks([0],{force:true,immediate:true});
  fallingSolids.settleAll();
  assert.equal(getTile(5,20),T.AIR,'chunk audit discovers floating object tiles from older/generated worlds');
  assert.equal(getTile(5,39),T.CHEST_RARE,'unsupported chest falls as a rigid object');
}

{
  reset();
  fillFloor(40,-10,10);
  setTile(-1,20,T.STONE);
  setTile(0,20,T.TORCH);
  fallingSolids.afterPlacement(0,20);
  fallingSolids.settleAll();
  assert.equal(getTile(0,20),T.TORCH,'torch remains while attached to a solid neighbor');
  setTile(-1,20,T.AIR);
  fallingSolids.onTileRemoved(-1,20);
  fallingSolids.settleAll();
  assert.equal(getTile(0,20),T.AIR,'orphaned torch breaks instead of hovering');
}

{
  reset();
  setFlatSurface(60);
  fillFloor(60,-30,30);
  placeBuiltRect(T.STONE,0,0,55,59);
  let accepted=0;
  let denied=null;
  for(let x=0; x<30; x++){
    const support=fallingSolids.canSupportPlacement(x,54,T.STONE);
    if(!support.ok){ denied={x,reason:support.reason}; break; }
    placeBuilt(T.STONE,x,54);
    accepted++;
  }
  assert.ok(denied && denied.x<30,'placement support check stops zipper-building a screen-wide floating stone slab');
  assert.ok(accepted>=4,'placement support check still allows a short practical cantilever before the limit');
}

{
  const glass=supportedCantileverCells(T.GLASS);
  const ice=supportedCantileverCells(T.ICE);
  const stone=supportedCantileverCells(T.STONE);
  const wood=supportedCantileverCells(T.WOOD);
  const granite=supportedCantileverCells(T.GRANITE);
  const basalt=supportedCantileverCells(T.BASALT);
  const obsidian=supportedCantileverCells(T.OBSIDIAN);
  const diamond=supportedCantileverCells(T.DIAMOND);
  const antimatter=supportedCantileverCells(T.ANTIMATTER_CRYSTAL);
  const steel=supportedCantileverCells(T.STEEL);
  const meteoric=supportedCantileverCells(T.METEORIC_IRON);
  const iridium=supportedCantileverCells(T.IRIDIUM);
  assert.ok(glass<=2,'player-built glass is brittle and cannot form a long cantilever');
  assert.ok(ice>glass && stone>ice,'stone carries a longer span than fragile glass or ice');
  assert.ok(wood>=stone,'wood flexibility offsets some of its lower strength in simple spans');
  assert.ok(granite>=stone && basalt>=granite && obsidian>=basalt,'harder rock variants improve span capacity over plain stone');
  assert.ok(diamond>=stone,'player-built diamond uses the material support graph instead of loose-ore falling');
  assert.ok(antimatter>=obsidian,'antimatter crystal is treated as a strong but brittle exotic building material');
  assert.ok(steel>=Math.max(obsidian,antimatter)+5,'steel frame physics carries far longer spans than stone-family or crystal materials');
  assert.ok(meteoric>=steel && iridium>=meteoric,'advanced metals are strongest in the building solver');
}

{
  const glass=supportedCantileverCells(T.GLASS);
  const electronics=supportedCantileverCells(T.ELECTRONICS);
  const dirt=supportedCantileverCells(T.DIRT);
  const mud=supportedCantileverCells(T.MUD);
  const coal=supportedCantileverCells(T.COAL);
  const radioactive=supportedCantileverCells(T.RADIOACTIVE_ORE);
  const biomass=supportedCantileverCells(T.ALIEN_BIOMASS);
  const stone=supportedCantileverCells(T.STONE);
  assert.ok(electronics<=glass+1,'electronics behave as fragile hardware, not generic stone');
  assert.ok(dirt<=coal && mud<=coal,'soil-like materials stay weaker than compact coal');
  assert.ok(radioactive>coal && radioactive<stone,'dense radioactive ore is brittle enough to underperform stone spans');
  assert.ok(biomass>coal && biomass<stone,'alien biomass flexes farther than coal but remains weaker than stone');
}

{
  reset();
  setFlatSurface(100);
  fillFloor(100,-80,80);
  setTile(0,60,T.STONE);
  placeBuiltRect(T.STEEL,-12,12,59,59);
  fallingSolids.settleAll();
  assert.equal(getTile(0,60),T.AIR,'heavy steel beam crushes an isolated one-block stone support');
  assert.equal(countRegionTile(T.STEEL,-12,12,59,59),0,'beam wakes after crushing its footing instead of remaining suspended');
  assert.equal(countRegionTile(T.STEEL,-80,80,0,99),25,'crushed heavy beam conserves its steel as falling debris');
}

{
  reset();
  setFlatSurface(100);
  fillFloor(100,-80,80);
  setTile(0,60,T.DIRT);
  placeBuiltRect(T.STEEL,-12,12,59,59);
  fallingSolids.settleAll();
  assert.equal(getTile(0,60),T.AIR,'heavy steel beam crushes an isolated weak-fill footing');
  assert.equal(countRegionTile(T.STEEL,-80,80,0,99),25,'beam material is conserved after crushing weak fill');
}

{
  reset();
  setFlatSurface(100);
  fillFloor(100,-80,80);
  buildRect(T.STONE,-2,2,60,99);
  placeBuiltRect(T.STEEL,-12,12,59,59);
  fallingSolids.settleAll();
  assert.equal(getTile(0,60),T.STONE,'substantial stone pier is not crushed by the same steel beam');
  assert.equal(countRegionTile(T.STEEL,-12,12,59,59),25,'substantial stone pier carries the heavy steel beam');
  assert.equal(fallingSolids.metrics().breaks,0,'sufficient bearing support avoids a collapse flash');
}

{
  reset();
  setFlatSurface(60);
  fillFloor(60,-30,30);
  buildRect(T.WOOD,0,0,55,59);
  buildRect(T.WOOD,0,12,54,54);
  fallingSolids.auditChunks([0],{force:true,immediate:true});
  fallingSolids.settleAll();
  assert.ok(fallingSolids.metrics().built>0,'chunk audit migrates old-save suspended structures into player-built physics');
  assert.ok(fallingSolids.metrics().stress>0,'migrated old-save bridge shows visible stress warnings');
  assert.ok(countRegionTile(T.WOOD,10,12,54,54)<3,'migrated overextended bridge can break without being rebuilt');
}

{
  reset();
  setFlatSurface(10);
  fillFloor(10,-5,5);
  setTile(0,9,T.WOOD);
  setTile(0,8,T.WOOD);
  setTile(-1,7,T.LEAF);
  setTile(0,7,T.LEAF);
  setTile(1,7,T.LEAF);
  fallingSolids.auditChunks([0],{force:true,immediate:true});
  fallingSolids.settleAll();
  assert.equal(fallingSolids.metrics().built,0,'legacy migration does not mark natural-looking tree trunks as player-built stress frames');
  assert.equal(fallingSolids.metrics().stress,0,'natural-looking tree trunks do not get building stress cracks');
}

{
  reset();
  setFlatSurface(60);
  fillFloor(60,-30,30);
  placeBuiltRect(T.WOOD,0,0,55,59);
  placeBuiltRect(T.WOOD,0,8,54,54);
  fallingSolids.settleAll();
  assert.equal(countRegionTile(T.WOOD,0,8,54,54),9,'supported player-built wooden platform stays in place');
  assert.ok(fallingSolids.metrics().stress>0,'near-limit player-built platform shows structural stress warnings');
  const stress=fallingSolids._debug().stress;
  assert.ok(stress.some(c=>c.ratio>=fallingSolids._debug().thresholds.warn),'stress debug exposes visible warning intensity');
  assert.ok(stress.some(c=>Number.isFinite(c.dx) && Number.isFinite(c.dy) && Math.abs(c.dx)+Math.abs(c.dy)>0),'stress debug exposes force-flow direction');
  const stressCtx=makeDrawCtx();
  fallingSolids.draw(stressCtx,20,()=>true);
  assert.ok(stressCtx.calls.includes('strokeRect') && stressCtx.calls.includes('stroke'),'stress warning draws a visible cracked overlay');
  const snap=fallingSolids.snapshot();
  assert.equal(snap.v,5,'falling save schema tracks general player-built structures');
  assert.ok(Array.isArray(snap.playerBuilt) && snap.playerBuilt.length>=14,'player-built support graph is saved');

  fallingSolids.restore(snap);
  fallingSolids.settleAll();
  assert.ok(fallingSolids.metrics().stress>0,'restored player-built structures recalculate visible stress warnings');
  for(let y=55; y<=59; y++){
    setTile(0,y,T.AIR);
    fallingSolids.onTileRemoved(0,y);
  }
  fallingSolids.settleAll();
  assert.equal(countRegionTile(T.WOOD,0,8,54,54),0,'player-built platform falls when its support column is removed');
  assert.equal(countRegionTile(T.WOOD,-2,10,55,60),9,'unsupported player-built platform lands lower instead of vanishing');
  assert.equal(fallingSolids.metrics().built,0,'fallen player-built platform becomes rubble, not a new floating structure');
}

{
  reset();
  setFlatSurface(60);
  fillFloor(60,-30,30);
  placeBuiltRect(T.WOOD,0,0,55,59);
  placeBuiltRect(T.WOOD,0,14,54,54);
  fallingSolids.settleAll();
  assert.equal(countRegionTile(T.WOOD,0,9,54,54),10,'short portion of a player-built cantilever remains supported');
  assert.equal(countRegionTile(T.WOOD,10,14,54,54),0,'overloaded player-built cantilever tail breaks away');
  assert.equal(countRegionTile(T.WOOD,10,14,55,60),5,'overloaded cantilever tail falls down as physical blocks');
  assert.ok(fallingSolids.metrics().stress>0,'remaining cantilever exposes the highest-tension blocks visually');
  assert.ok(fallingSolids.metrics().breaks>0,'overloaded cantilever leaves a visible snap/break flash');
}

{
  reset();
  setFlatSurface(60);
  fillFloor(60,-30,30);
  placeBuiltRect(T.WOOD,0,0,55,59);
  placeBuiltRect(T.WOOD,0,8,54,54);
  fallingSolids.settleAll();
  const before=fallingSolids._debug().stress.find(c=>c.x===8 && c.y===54);
  assert.ok(before && before.ratio>0.7,'test starts with a visibly stressed cantilever tail');
  setTile(9,54,T.BEDROCK);
  fallingSolids.afterPlacement(9,54);
  fallingSolids.settleAll();
  const after=fallingSolids._debug().stress.find(c=>c.x===8 && c.y===54);
  assert.ok(!after || after.ratio<before.ratio,'placing a terrain side brace wakes and relaxes the stressed component');
}

{
  reset();
  setFlatSurface(60);
  fillFloor(60,-30,30);
  fillFloor(70,-30,30);
  placeBuiltRect(T.WOOD,0,0,55,59);
  placeBuiltRect(T.WOOD,0,8,54,54);
  fallingSolids.settleAll();
  for(let y=55; y<=59; y++){
    setTile(0,y,T.AIR);
    fallingSolids.onTileRemoved(0,y);
  }
  fallingSolids.settleAll();
  assert.equal(countRegionTile(T.WOOD,0,8,59,59),9,'collapsed wooden platform settles as debris on the upper floor');
  assert.equal(fallingSolids.metrics().built,0,'collapsed wooden debris is not reclassified as a new building frame');
  assert.equal(fallingSolids.metrics().debris,9,'collapsed wooden debris remains tracked for future support removals');
  for(let x=-2; x<=10; x++){
    setTile(x,60,T.AIR);
    fallingSolids.onTileRemoved(x,60);
  }
  fallingSolids.settleAll();
  assert.equal(countRegionTile(T.WOOD,0,8,69,69),9,'undercut wooden debris falls again onto the lower floor');
  assert.equal(fallingSolids.metrics().built,0,'re-settled wooden debris still does not join the build graph');
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
  for(let y=129; y>=30; y--) placeBuilt(T.STEEL,0,y);
  fallingSolids.settleAll();
  assert.equal(countRegionTile(T.STEEL,0,0,30,129),100,'100-high player-placed steel chimney keeps the same vertical stability as the pillar solver');
  assert.equal(fallingSolids.metrics().breaks,0,'stable player-placed steel chimney does not shed blocks through the stress graph');
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

const mainSource=readFileSync(new URL('../src/main.js', import.meta.url),'utf8');
assert.match(mainSource,/FALLING && FALLING\.canSupportPlacement/,'main placement preview/rejection uses the structural support solver');
assert.match(mainSource,/checkedStructural/,'main falls back to contact support only for non-structural placements');
assert.match(mainSource,/if\(v\.chest\)\{ setTile\(tx,ty,id\); if\(FALLING && FALLING\.afterPlacement\) FALLING\.afterPlacement\(tx,ty\); return; \}/,'main wakes falling physics after chest placement');

console.log('falling sand simulation tests passed');
