// Deterministic test for mixed-material city structure collapse.
// Verifies: steel/stone/obsidian frames stay up with one valid support, then
// collapse as one unsupported component after critical supports are removed.
// Run: node tools/city-collapse-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis;
globalThis.MM = {};

const { T, WORLD_H } = await import('../src/constants.js');
const { fallingSolids } = await import('../src/engine/falling.js');

const tiles = new Map();
const key = (x,y)=>x+','+y;
function getTile(x,y){
  if(y<0 || y>=WORLD_H) return T.STONE;
  return tiles.get(key(x,y)) ?? T.AIR;
}
function setTile(x,y,t){
  if(y<0 || y>=WORLD_H) return;
  const k=key(x,y);
  if(t===T.AIR) tiles.delete(k);
  else tiles.set(k,t);
}
function clear(){
  tiles.clear();
  delete MM.worldGen;
  fallingSolids.reset();
  fallingSolids.init(getTile,setTile);
}
function buildFrame(){
  for(let x=-2; x<=8; x++) setTile(x,34,T.GRASS);
  for(let y=24; y<=33; y++){
    setTile(0,y,T.STEEL);
    setTile(6,y,T.STEEL);
  }
  for(let x=0; x<=6; x++) setTile(x,23,x===3?T.OBSIDIAN:T.STONE);
  setTile(3,22,T.STEEL);
}
function buildFloatingFrame(){
  for(let x=-3; x<=9; x++) setTile(x,34,T.GRASS);
  for(let y=24; y<=29; y++){
    setTile(0,y,T.STEEL);
    setTile(6,y,T.STEEL);
  }
  for(let x=0; x<=6; x++) setTile(x,23,x===3?T.OBSIDIAN:T.STONE);
  setTile(3,22,T.STEEL);
}
function buildGlassProppedFrame(){
  buildDecorProppedFrame(T.GLASS);
}
function buildDecorProppedFrame(supportTile){
  for(let y=24; y<=33; y++){
    setTile(0,y,T.STEEL);
    setTile(6,y,T.STEEL);
  }
  for(let x=0; x<=6; x++) setTile(x,23,x===3?T.OBSIDIAN:T.STONE);
  setTile(3,22,T.STEEL);
  setTile(0,34,supportTile);
  setTile(6,34,supportTile);
  for(let x=-3; x<=9; x++) setTile(x,44,T.GRASS);
}
function buildLongCantilever(){
  for(let x=-3; x<=25; x++) setTile(x,34,T.GRASS);
  for(let y=21; y<=33; y++) setTile(0,y,T.STEEL);
  for(let x=0; x<=22; x++) setTile(x,20,(x%5===0)?T.STEEL:T.STONE);
  setTile(22,19,T.OBSIDIAN);
}
function buildLongCantileverOnCityTerrain(){
  for(let x=-2600; x<=2600; x++){
    setTile(x,34,T.STONE);
    setTile(x,35,T.STONE);
  }
  for(let y=21; y<=33; y++) setTile(0,y,T.STEEL);
  for(let x=0; x<=45; x++) setTile(x,20,(x%5===0)?T.STEEL:T.STONE);
  setTile(45,19,T.OBSIDIAN);
}
function buildLargeUndercutHighRise(){
  for(let x=-5; x<=90; x++) setTile(x,96,T.GRASS);
  for(let x=0; x<84; x++){
    for(let y=20; y<=78; y++) setTile(x,y,(x%9===0 || y%7===0)?T.STEEL:T.STONE);
  }
}
function buildSparseCityFrame(){
  MM.worldGen = { biomeType(){ return 8; }, surfaceHeight(){ return 80; } };
  for(let x=-5; x<=30; x++) setTile(x,95,T.GRASS);
  for(let x=0; x<24; x++) setTile(x,80,T.STONE);
  const ground=80, w=24, h=30;
  for(let dx=0; dx<w; dx++){
    for(let rel=1; rel<=h; rel++){
      const y=ground-rel;
      const edge=dx===0 || dx===w-1;
      const floor=rel===1 || rel%5===0;
      const beam=dx%4===0;
      if(edge || floor || beam) setTile(dx,y,edge||beam?T.STEEL:T.STONE);
      else if((rel%5)>=2 && (dx%3)!==0) setTile(dx,y,T.GLASS);
    }
  }
}
function removeSupport(x){
  setTile(x,33,T.AIR);
  fallingSolids.onTileRemoved(x,33);
}
function removeTile(x,y){
  setTile(x,y,T.AIR);
  fallingSolids.onTileRemoved(x,y);
}
function countRegion(x0,x1,y0,y1){
  let n=0;
  for(let x=x0; x<=x1; x++){
    for(let y=y0; y<=y1; y++){
      const t=getTile(x,y);
      if(t===T.STONE || t===T.STEEL || t===T.OBSIDIAN) n++;
    }
  }
  return n;
}
function countOriginalFrameTop(){
  let n=0;
  for(let x=0; x<=6; x++) if(getTile(x,23)!==T.AIR) n++;
  if(getTile(3,22)!==T.AIR) n++;
  return n;
}
function countLowerRubble(){
  let n=0;
  for(let x=-3; x<=9; x++){
    for(let y=29; y<=33; y++){
      const t=getTile(x,y);
      if(t===T.STONE || t===T.STEEL || t===T.OBSIDIAN) n++;
    }
  }
  return n;
}
function countDeepRubble(){
  let n=0;
  for(let x=-5; x<=11; x++){
    for(let y=34; y<=43; y++){
      const t=getTile(x,y);
      if(t===T.STONE || t===T.STEEL || t===T.OBSIDIAN) n++;
    }
  }
  return n;
}
function stepFalling(frames=240){
  for(let i=0; i<frames; i++) fallingSolids.update(getTile,setTile,1/60);
}
function parseCell(k){
  const ix=k.indexOf(',');
  return {x:+k.slice(0,ix), y:+k.slice(ix+1)};
}

clear();
for(let x=0; x<=18; x++){
  for(let y=40; y<=44; y++) setTile(x,y,T.STONE);
}
for(let x=5; x<=13; x++) removeTile(x,44);
fallingSolids.settleAll();
assert.ok(countRegion(0,18,40,43) > 70, 'native underground stone stays geologically attached while tunneling');

clear();
buildFrame();
removeSupport(0);
fallingSolids.settleAll();
assert.equal(countOriginalFrameTop(), 8, 'one remaining column keeps the mixed city frame stable');

clear();
buildFrame();
removeSupport(0);
removeSupport(6);
fallingSolids.settleAll();
assert.equal(countOriginalFrameTop(), 0, 'detached mixed-material frame leaves its original floating position');
assert.ok(countLowerRubble() >= 8, 'collapsed city frame lands lower as rubble');
assert.ok(getTile(3,22)!==T.OBSIDIAN, 'obsidian accent participates in the collapse');

clear();
buildFloatingFrame();
fallingSolids.maybeStart(0,29);
fallingSolids.settleAll();
assert.equal(countOriginalFrameTop(), 0, 'pre-existing detached generated frame collapses when queued by chunk audit');
assert.ok(countLowerRubble() >= 8, 'chunk-audited frame settles into a rubble pile');

clear();
buildFloatingFrame();
fallingSolids.auditChunks([0],{immediate:true});
fallingSolids.settleAll();
assert.equal(countOriginalFrameTop(), 0, 'floating city frame is found by chunk stability audit without a local edit event');
assert.ok(countLowerRubble() >= 8, 'audited floating frame lands as rubble');

clear();
buildGlassProppedFrame();
fallingSolids.maybeStart(0,33);
fallingSolids.maybeStart(6,33);
fallingSolids.settleAll();
assert.equal(countOriginalFrameTop(), 0, 'fragile glass panes do not count as structural supports');
assert.ok(countDeepRubble() >= 8, 'glass-propped frame collapses into lower rubble');

clear();
buildDecorProppedFrame(T.TORCH);
fallingSolids.maybeStart(0,33);
fallingSolids.maybeStart(6,33);
fallingSolids.settleAll();
assert.equal(countOriginalFrameTop(), 0, 'passable fixtures do not count as structural supports');
assert.ok(countDeepRubble() >= 8, 'fixture-propped frame drops to the real floor');

clear();
buildLongCantilever();
fallingSolids.maybeStart(18,20);
fallingSolids.settleAll();
assert.notEqual(getTile(4,20), T.AIR, 'short supported city span remains in place');
assert.equal(getTile(18,20), T.AIR, 'long unsupported cantilever tail breaks away from one distant support');

clear();
MM.worldGen = { biomeType(){ return 8; }, surfaceHeight(){ return 34; } };
buildLongCantileverOnCityTerrain();
fallingSolids.maybeStart(36,20);
fallingSolids.settleAll();
assert.notEqual(getTile(4,20), T.AIR, 'city terrain anchor preserves the short supported span');
assert.equal(getTile(36,20), T.AIR, 'city terrain does not make an overlong cantilever permanently stable');
assert.equal(getTile(0,34), T.STONE, 'city pavement is treated as an anchor, not pulled into the collapse');

clear();
buildSparseCityFrame();
const sparseOriginal = countRegion(0,23,50,79);
assert.ok(sparseOriginal > 250, 'sparse generated-style frame starts with a substantial upper structure');
for(let x=0; x<24; x++) removeTile(x,79);
fallingSolids.settleAll();
assert.ok(countRegion(0,23,50,79) < sparseOriginal, 'removing the bottom frame row makes the unsupported frame drop onto remaining pavement');

clear();
buildSparseCityFrame();
for(let x=0; x<24; x++){ removeTile(x,79); removeTile(x,80); }
fallingSolids.settleAll();
assert.equal(countRegion(0,23,50,79), 0, 'fully undercut sparse city frame leaves its original building region');
assert.ok(countRegion(-5,30,80,94) > 200, 'fully undercut sparse city frame lands lower as rubble');

clear();
MM.worldGen = { biomeType(){ return 8; }, surfaceHeight(){ return 96; } };
buildLargeUndercutHighRise();
const originalTop = countRegion(0,83,20,30);
assert.ok(originalTop > 800, 'large test high-rise starts with a dense upper section');
fallingSolids.maybeStart(40,78);
fallingSolids.settleAll();
assert.ok(countRegion(0,83,20,30) < originalTop * 0.15, 'large undercut city high-rise drops instead of being frozen by the cluster cap');

clear();
MM.worldGen = { biomeType(){ return 8; }, surfaceHeight(){ return 90; } };
for(let x=-8; x<=8; x++) setTile(x,90,T.STONE);
fallingSolids.restore({v:3, active:Array.from({length:36},(_,i)=>({x:(i%3)-1,y:45+Math.floor(i/3)*0.2,type:i%4===0?T.STEEL:T.STONE,vy:0,rubble:true})), sand:[], queue:[]});
fallingSolids.settleAll();
let snap=fallingSolids.snapshot();
assert.ok(Array.isArray(snap.debris) && snap.debris.length>=36, 'settled city-collapse rubble is tracked as debris, not as new building structure');
fallingSolids.auditChunks([0],{immediate:true});
stepFalling(180);
assert.equal(fallingSolids.metrics().active,0,'chunk audit does not relaunch settled city rubble into a jitter loop');
assert.equal(fallingSolids.metrics().queue,0,'settled city rubble leaves no permanent structural queue');

const supportedDebris = snap.debris.map(parseCell).find(c=>getTile(c.x,c.y+1)!==T.AIR && getTile(c.x,c.y+1)!==T.WATER);
assert.ok(supportedDebris,'test found a supported debris tile');
const oldType=getTile(supportedDebris.x,supportedDebris.y);
setTile(supportedDebris.x,supportedDebris.y+1,T.AIR);
fallingSolids.onTileRemoved(supportedDebris.x,supportedDebris.y+1);
fallingSolids.settleAll();
assert.equal(getTile(supportedDebris.x,supportedDebris.y),T.AIR,'settled rubble falls again when its real support is removed');
assert.ok(countRegion(supportedDebris.x-8,supportedDebris.x+8,supportedDebris.y+1,95)>0 && oldType!==T.AIR,'released rubble lands lower as ordinary debris');

// --- Back walls fall with the building ------------------------------------------
// Construction-background panels behind a collapsing structure must leave the
// background layer and land as ordinary foreground rubble, while panels behind
// intact neighbours stay untouched.
clear();
const bgMap=new Map();
MM.world={
  getConstructionBackground(x,y){ const v=bgMap.get(x+','+y); return v===undefined?T.AIR:v; },
  clearConstructionBackground(x,y){ bgMap.delete(x+','+y); return true; }
};
buildFrame();
// Wider apron: the doubled debris pile (frame + peeled back walls) overflows the
// frame's own 11-wide floor and must still land inside the counting window.
for(let x=-9; x<=-3; x++) setTile(x,34,T.GRASS);
for(let x=9; x<=15; x++) setTile(x,34,T.GRASS);
for(let x=1; x<=5; x++){
  for(let y=24; y<=33; y++) if(getTile(x,y)===T.AIR) bgMap.set(x+','+y,T.STONE);
}
bgMap.set('40,30',T.STONE); // far-away panel: must survive the collapse untouched
const bgBefore=bgMap.size-1;
const solidBefore=countRegion(-10,16,18,43);
removeSupport(0);
removeSupport(6);
fallingSolids.settleAll();
assert.equal(countOriginalFrameTop(), 0, 'backed frame still collapses');
assert.equal(bgMap.get('40,30'), T.STONE, 'unrelated background panel is untouched by the collapse');
assert.equal([...bgMap.keys()].filter(k=>k!=='40,30').length, 0, 'interior back walls peel off with the collapsing frame');
const solidAfter=countRegion(-10,16,18,43);
assert.ok(solidAfter>=solidBefore+bgBefore-6,
  'released back walls land as additional foreground rubble ('+solidAfter+' vs '+solidBefore+'+'+bgBefore+')');
delete MM.world;

// --- Sky islands above city districts -----------------------------------------
// Natural basalt/granite island fabric at y<0 must never inherit the city
// collapse rules of the district far below it; player-built sky blocks still obey
// ordinary physics.
const skyTiles = new Map();
function skyGet(x,y){
  if(y>=WORLD_H) return T.STONE;
  return skyTiles.get(key(x,y)) ?? T.AIR;
}
function skySet(x,y,t){
  if(y>=WORLD_H) return;
  const k=key(x,y);
  if(t===T.AIR) skyTiles.delete(k);
  else skyTiles.set(k,t);
}
function skyClear(){
  skyTiles.clear();
  delete MM.worldGen;
  fallingSolids.reset();
  fallingSolids.init(skyGet,skySet);
}
function skyCount(){
  let n=0;
  for(const k of skyTiles.keys()) if(parseCell(k).y<0) n++;
  return n;
}
// stepFalling() re-binds the solver to the surface-world accessors; the sky
// section needs its own stepper so updates keep reading the sky tile map.
function stepSky(frames=240){
  for(let i=0;i<frames;i++) fallingSolids.update(skyGet,skySet,1/60);
}

skyClear();
MM.worldGen = { biomeType(){ return 8; }, surfaceHeight(){ return 80; } };
for(let x=-30;x<=30;x++) skySet(x,80,T.STONE);
for(let dx=-9;dx<=9;dx++){
  const th=3+Math.round(2*Math.sqrt(Math.max(0,1-(dx/9)*(dx/9))));
  for(let dy=0;dy<th;dy++) skySet(dx,-56-dy,((dx+dy)%3===0)?T.GRANITE:T.BASALT);
}
const islandBefore=skyCount();
skySet(0,-56,T.AIR);
fallingSolids.onTileRemoved(0,-56);
for(const k of [...skyTiles.keys()]){ const c=parseCell(k); if(c.y<0) fallingSolids.maybeStart(c.x,c.y); }
fallingSolids.settleAll();
stepSky(240);
assert.equal(skyCount(), islandBefore-1, 'natural sky island above a city district keeps floating when mined/disturbed');
assert.equal(fallingSolids.metrics().active, 0, 'no island debris rains down onto the city');
assert.equal(fallingSolids.metrics().queue, 0, 'sky island leaves no permanent structural queue');

// Thin natural glass/dust ribbons and machine relics resting on island fabric
// must also hold: fragile and rigid-object fall paths honor sky cohesion too.
for(let x=-20;x<=-12;x++) skySet(x,-70,(x%3===0)?T.METEOR_DUST:T.GLASS);
skySet(-2,-60,T.GLASS);           // island shell fabric
skySet(-2,-61,T.SOLAR_BATTERY);   // relic machine resting on it
const ribbonBefore=skyCount();
for(let x=-20;x<=-12;x++) fallingSolids.maybeStart(x,-70);
fallingSolids.maybeStart(-2,-61);
fallingSolids.settleAll();
stepSky(240);
assert.equal(skyCount(), ribbonBefore, 'sky ribbons and island relics stay aloft when disturbed');

const playerSkyBlocks=[[14,-40],[15,-40],[16,-40]];
for(const [px,py] of playerSkyBlocks){ skySet(px,py,T.BASALT); fallingSolids.afterPlacement(px,py); }
fallingSolids.settleAll();
stepSky(240);
for(const [px,py] of playerSkyBlocks){
  assert.equal(skyGet(px,py), T.AIR, 'player-built floating basalt at '+px+','+py+' in the sky still falls');
}

console.log('city-collapse-sim: all assertions passed');
