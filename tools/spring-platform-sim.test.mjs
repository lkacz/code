// Covers: spring-platform registration, powered/unpowered launch balance,
// copper-network charging, save/restore, and main/debug UI integration.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};

const { T, INFO, WORLD_H } = await import('../src/constants.js');
const { dynamo } = await import('../src/engine/dynamo.js');
const { teleporters } = await import('../src/engine/teleporters.js');
const { springPlatforms } = await import('../src/engine/spring_platforms.js');

const tiles = new Map();
const k = (x,y)=>Math.floor(x)+','+Math.floor(y);
function getTile(x,y){
  x=Math.floor(x); y=Math.floor(y);
  if(y<0 || y>=WORLD_H) return T.AIR;
  return tiles.get(k(x,y)) ?? T.AIR;
}
function setTile(x,y,v){
  x=Math.floor(x); y=Math.floor(y);
  const id=k(x,y);
  const old=getTile(x,y);
  if(v===T.AIR) tiles.delete(id);
  else tiles.set(id,v);
  if(dynamo && dynamo.onTileChanged) dynamo.onTileChanged(x,y,old,v);
  if(teleporters && teleporters.onTileChanged) teleporters.onTileChanged(x,y,old,v);
  if(springPlatforms && springPlatforms.onTileChanged) springPlatforms.onTileChanged(x,y,old,v,getTile);
}
function reset(){
  tiles.clear();
  dynamo.reset();
  teleporters.reset();
  springPlatforms.reset();
  globalThis.MM.world={getTile,setTile};
}
function placeDynamo(cx,y,orientation='horizontal'){
  dynamo.plannedCells(cx,y,orientation).forEach(cell=>setTile(cell.x,cell.y,cell.t));
}
function chargeDynamo(cx,y){
  for(let i=0; i<80; i++) dynamo.recordFlow(cx,y,T.WATER,4,getTile);
}
function hero(vx=0,vy=2){
  return {x:0.5,y:9,w:0.7,h:0.95,vx,vy,facing:vx<0?-1:1,onGround:true,jumpCount:0};
}

assert.equal(T.SPRING_PLATFORM,69,'spring platform tile id is stable');
assert.equal(INFO[T.SPRING_PLATFORM].drop,'springPlatform','spring platforms drop the placeable resource');
assert.equal(INFO[T.SPRING_PLATFORM].machine,'springPlatform','spring platform is marked as a machine');
assert.equal(INFO[T.SPRING_PLATFORM].powerDevice,true,'spring platform is a powered cable endpoint');
assert.equal(INFO[T.SPRING_PLATFORM].passable,false,'spring platform is a solid pressure plate');
assert.equal(INFO[T.SPRING_PLATFORM].energyCapacity,70,'spring platform advertises battery capacity');

{
  reset();
  setTile(0,10,T.SPRING_PLATFORM);
  const weakHero=hero(0,2);
  const weak=springPlatforms.launchHero(weakHero,0,10,getTile,{dynamo,teleporters});
  assert.equal(weak.powered,false,'empty spring platform still launches weakly');
  assert.equal(weakHero.vy,springPlatforms._debug.UNPOWERED_LAUNCH,'unpowered impulse is the tuned weak launch');
  assert.equal(springPlatforms.metrics().unpoweredLaunches,1,'metrics track weak launches');

  springPlatforms.reset();
  springPlatforms.onTileChanged(0,10,T.AIR,T.SPRING_PLATFORM,getTile);
  springPlatforms._debug.debugChargeAt(0,10,springPlatforms._debug.CAPACITY,getTile);
  const strongHero=hero(1,2);
  const strong=springPlatforms.launchHero(strongHero,0,10,getTile,{dynamo,teleporters});
  assert.equal(strong.powered,true,'charged platform performs a powered launch');
  assert.equal(strongHero.vy,springPlatforms._debug.POWERED_LAUNCH,'powered impulse is the full launch');
  assert.ok(strongHero.vx>1,'powered launch adds forward travel kick');
  const heightRatio=(strongHero.vy*strongHero.vy)/(weakHero.vy*weakHero.vy);
  assert.ok(Math.abs(heightRatio-3)<0.001,'unpowered launch reaches one third of powered height');
  assert.equal(springPlatforms.launchHero(hero(),0,10,getTile,{dynamo,teleporters}),null,'launch cooldown prevents repeated same-frame launches');
  assert.equal(springPlatforms.metrics().poweredLaunches,1,'metrics track powered launches');
}

{
  reset();
  setTile(0,10,T.SPRING_PLATFORM);
  placeDynamo(-4,10);
  setTile(-2,10,T.COPPER_WIRE);
  setTile(-1,10,T.COPPER_WIRE);
  chargeDynamo(-4,10);
  const beforeDynamo=dynamo.metrics().storedEnergy;
  springPlatforms.update(1.0,hero(),getTile,{dynamo,teleporters});
  const m=springPlatforms.metrics();
  assert.ok(m.storedEnergy>0,'spring platform battery charges from copper-wire network');
  assert.ok(teleporters.metrics().poweredWires>0,'spring platform network charging animates powered wires');
  assert.ok(dynamo.metrics().storedEnergy<beforeDynamo,'spring platform charging drains real dynamo energy');
}

{
  reset();
  setTile(0,10,T.SPRING_PLATFORM);
  placeDynamo(-4,10);
  setTile(-2,10,T.COPPER_WIRE);
  setTile(-1,10,T.COPPER_WIRE);
  chargeDynamo(-4,10);
  assert.equal(springPlatforms.catchUp(30,hero(),getTile,{dynamo,teleporters}),true,'offscreen catch-up charges spring platforms');
  assert.ok(springPlatforms.metrics().storedEnergy>0,'catch-up stores spring platform energy');
}

{
  reset();
  setTile(0,10,T.SPRING_PLATFORM);
  springPlatforms._debug.debugChargeAt(0,10,45,getTile);
  const snap=springPlatforms.snapshot();
  springPlatforms.reset();
  springPlatforms.restore(snap,getTile);
  assert.ok(springPlatforms.metrics().storedEnergy>=44.9,'spring platform save/restore keeps battery energy');
  setTile(0,10,T.AIR);
  assert.equal(springPlatforms.metrics().machines,0,'tile removal prunes spring platform battery state');
}

const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const uiSrc = await readFile(new URL('../src/engine/ui.js', import.meta.url), 'utf8');
assert.match(mainSrc, /import \{ springPlatforms as SPRING_PLATFORMS \}/, 'main imports spring platform engine');
assert.match(mainSrc, /springPlatforms:\s*timedSavePart\('springPlatforms',[^\n]*SPRING_PLATFORMS && SPRING_PLATFORMS\.snapshot/, 'main saves spring platform batteries');
assert.match(mainSrc, /SPRING_PLATFORMS\.restore\(data\.springPlatforms,getTile\)/, 'main restores spring platform batteries');
assert.match(mainSrc, /SPRING_PLATFORMS\.update\(dt, player, getElectricNetworkTile, \{dynamo:DYNAMO, teleporters:TELEPORTERS\}\)/, 'main updates spring platforms with the electric network');
assert.match(mainSrc, /SPRING_PLATFORMS\.draw\(ctx,TILE,sx,sy,viewX,viewY,worldFxVisible,getElectricNetworkTile\)/, 'main draws spring platform charge overlays');
assert.match(mainSrc, /SPRING_PLATFORMS\.launchHero\(player,landingTile\.x,landingTile\.y,getElectricNetworkTile,\{dynamo:DYNAMO,teleporters:TELEPORTERS\}\)/, 'landing collision launches the hero from spring platforms');
assert.match(mainSrc, /id:'spring_platform'/, 'crafting exposes spring platforms outside debug');
assert.match(mainSrc, /cost:\{steel:2,\s*copperWire:2,\s*transistor:1\}/, 'spring platform recipe consumes steel and electronics components');
assert.match(mainSrc, /tiles:\['DYNAMO','SOLAR_PANEL','SOLAR_BATTERY','SPRING_PLATFORM'/, 'hotbar machine group includes spring platforms');
assert.match(uiSrc, /injectSpringPlatformDebugPanel/, 'debug menu exposes spring platform controls');

console.log('spring-platform-sim: all assertions passed');
