// Scalable elemental block-reaction regressions.
// Heat can forge glass/wire/transistor assemblies into solar panels; the same
// engine also accepts future water/electric recipes without hard-coded branches.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {
  background:{getCycleInfo:()=>({isDay:true,tDay:0.5})},
  clouds:{metrics:()=>({clouds:0,cloudMass:0,storm:{active:false,intensity:0}})}
};

const { T, INFO, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } = await import('../src/constants.js');
const { reactions } = await import('../src/engine/reactions.js');
const { solar } = await import('../src/engine/solar.js');
const { dynamo } = await import('../src/engine/dynamo.js');
const { teleporters } = await import('../src/engine/teleporters.js');
const { fire } = await import('../src/engine/fire.js');
const { water } = await import('../src/engine/water.js');
const { clouds } = await import('../src/engine/clouds.js');

const tiles = new Map();
const key = (x,y)=>Math.floor(x)+','+Math.floor(y);
function getTile(x,y){
  x=Math.floor(x); y=Math.floor(y);
  if(y<WORLD_MIN_Y || y>=WORLD_MAX_Y) return T.AIR;
  return tiles.get(key(x,y)) ?? T.AIR;
}
function setTile(x,y,v){
  x=Math.floor(x); y=Math.floor(y);
  const old=getTile(x,y);
  const k=key(x,y);
  if(v===T.AIR) tiles.delete(k);
  else tiles.set(k,v);
  if(old!==v){
    if(solar && solar.onTileChanged) solar.onTileChanged(x,y,old,v);
    if(dynamo && dynamo.onTileChanged) dynamo.onTileChanged(x,y,old,v);
    if(teleporters && teleporters.onTileChanged) teleporters.onTileChanged(x,y,old,v);
  }
}
function reset(){
  tiles.clear();
  fire.reset();
  solar.reset();
  dynamo.reset();
  teleporters.reset();
  water.reset();
  clouds.reset();
  MM.clouds=clouds;
  MM.world={getTile,setTile};
  MM.water=water;
  MM.worldGen={temperature:()=>0.7,surfaceHeight:()=>80,settings:{seaLevel:95},worldSeed:12345};
  MM.background={getCycleInfo:()=>({isDay:true,tDay:0.5})};
  MM.fallingSolids={recheckNeighborhood(){},afterPlacement(){},onTileRemoved(){}};
  MM.particles={spawnSparks(){},spawnBurst(){},spawnSplash(){}};
  MM.audio={play(){}};
}
function patternCells(ax,ay,storage=false,mirrored=false){
  const raw = storage
    ? [{x:0,y:0,t:T.GLASS},{x:0,y:1,t:T.WIRE},{x:1,y:1,t:T.GLASS},{x:0,y:2,t:T.TRANSISTOR},{x:1,y:2,t:T.WIRE},{x:2,y:2,t:T.GLASS}]
    : [{x:0,y:0,t:T.GLASS},{x:0,y:1,t:T.WIRE},{x:1,y:1,t:T.GLASS},{x:0,y:2,t:T.WIRE},{x:1,y:2,t:T.WIRE},{x:2,y:2,t:T.GLASS}];
  return raw.map(c=>({x:ax+(mirrored ? 2-c.x : c.x),y:ay+c.y,t:c.t}));
}
function placePattern(ax,ay,storage=false,mirrored=false){
  const cells=patternCells(ax,ay,storage,mirrored);
  cells.forEach(c=>setTile(c.x,c.y,c.t));
  return cells;
}
function assertCells(cells,tile,msg){
  for(const c of cells) assert.equal(getTile(c.x,c.y),tile,msg+' at '+c.x+','+c.y);
}

assert.equal(T.TRANSISTOR,35,'transistor tile id stays stable after teleporters');
assert.equal(T.SOLAR_PANEL,36,'solar panel tile id is stable');
assert.equal(T.SOLAR_BATTERY,37,'solar storage panel tile id is stable');
assert.equal(T.CLAY,65,'clay tile id is appended for save stability');
assert.equal(T.WET_CLAY,66,'wet clay tile id is appended for save stability');
assert.equal(T.BRICK,67,'brick tile id is appended for save stability');
assert.equal(T.LADDER,68,'ladder tile id is appended for save stability');
assert.equal(T.SPRING_PLATFORM,69,'spring platform tile id is appended for save stability');
assert.equal(T.CHIMNEY,76,'chimney tile id is appended for save stability');
assert.equal(T.RESPAWN_TOTEM,77,'respawn totem tile id is appended for save stability');
assert.equal(INFO[T.TRANSISTOR].drop,'transistor','placed transistors can be recovered');
assert.equal(INFO[T.SOLAR_PANEL].powerSource,true,'solar panels are power sources');
assert.equal(INFO[T.SOLAR_BATTERY].energyCapacity,120,'storage solar panel advertises its battery capacity');
assert.equal(solar._debug.FULL_LIGHT_THRESHOLD,0.9,'solar panels require high full daylight before producing energy');
assert.ok(solar._debug.PANEL_RATE<0.25,'basic solar panel production is intentionally weak');
assert.ok(solar._debug.STORAGE_RATE<0.35,'storage solar panel production is intentionally weak');

{
  reset();
  setTile(5,10,T.SOLAR_BATTERY);
  for(let i=0;i<40;i++) solar.update(0.25,{x:5,y:10},getTile);
  const stored=solar.metrics().storedEnergy;
  assert.ok(stored>0.5 && stored<4,'clear full-light noon charges a single storage panel slowly');
}

{
  reset();
  assert.ok(WORLD_MIN_Y<0 && WORLD_MAX_Y>WORLD_H,'solar tests cover extended vertical sections');
  setTile(6,-35,T.SOLAR_BATTERY);
  for(let i=0;i<40;i++) solar.update(0.25,{x:6,y:-35},getTile);
  const stored=solar.metrics().storedEnergy;
  assert.ok(stored>0.5 && stored<4,'sky-layer solar battery charges from full daylight');
  assert.equal(solar.skyExposed(6,-35,getTile),true,'sky-layer solar panel sees the extended top of the world');
  setTile(6,-40,T.STONE);
  assert.equal(solar.skyExposed(6,-35,getTile),false,'sky-layer solar exposure is blocked by local island roofs');
  setTile(6,-40,T.AIR);
  const snap=solar.snapshot();
  assert.ok(snap.list.some(c=>c.y<0),'solar snapshot preserves sky-layer batteries');
  solar.reset();
  solar.restore(snap,getTile);
  assert.ok(solar.metrics().storedEnergy>0,'solar restore rehydrates sky-layer battery state');
}

{
  reset();
  setTile(5,10,T.SOLAR_BATTERY);
  MM.clouds={metrics:()=>({clouds:1,cloudMass:0.1,drops:0,storm:{active:false,intensity:0}})};
  for(let i=0;i<120;i++) solar.update(0.25,{x:5,y:10},getTile);
  assert.equal(solar.metrics().storedEnergy,0,'any visible cloud cover blocks solar production completely');
  assert.equal(solar.metrics().sun,0,'clouded sky reports zero solar sun');
}

{
  reset();
  setTile(5,10,T.SOLAR_BATTERY);
  MM.background={getCycleInfo:()=>({isDay:true,tDay:0.18})};
  for(let i=0;i<120;i++) solar.update(0.25,{x:5,y:10},getTile);
  assert.equal(solar.metrics().storedEnergy,0,'partial morning light is not full enough for solar production');
  MM.background={getCycleInfo:()=>({isDay:false,tDay:0.5})};
  for(let i=0;i<120;i++) solar.update(0.25,{x:5,y:10},getTile);
  assert.equal(solar.metrics().storedEnergy,0,'night never produces solar energy');
}

{
  reset();
  const cells=placePattern(10,10,false,false);
  const done=reactions.apply('heat',10,10,getTile,setTile);
  assert.ok(done && done.recipe==='heat_solar_panel','heat completes the basic solar recipe');
  assertCells(cells,T.SOLAR_PANEL,'basic recipe turns every assembly block into panel terrain');
}

{
  reset();
  const cells=placePattern(12,Math.max(WORLD_MIN_Y+12,-44),false,false);
  const done=reactions.apply('heat',cells[0].x,cells[0].y,getTile,setTile);
  assert.ok(done && done.recipe==='heat_solar_panel','heat reactions can complete a sky-section solar recipe');
  assertCells(cells,T.SOLAR_PANEL,'sky-section recipe turns every assembly block into panel terrain');
}

{
  reset();
  const cells=placePattern(14,Math.min(WORLD_MAX_Y-18,WORLD_H+20),true,false);
  const done=reactions.apply('heat',cells[0].x,cells[0].y,getTile,setTile);
  assert.ok(done && done.recipe==='heat_solar_storage_panel','heat reactions can complete a deep-section storage recipe');
  assertCells(cells,T.SOLAR_BATTERY,'deep-section recipe turns every assembly block into storage panel terrain');
}

{
  reset();
  const cells=placePattern(20,10,false,true);
  const done=reactions.apply('heat',22,10,getTile,setTile);
  assert.ok(done && done.recipe==='heat_solar_panel','mirrored basic solar recipe matches');
  assertCells(cells,T.SOLAR_PANEL,'mirrored basic recipe turns every block into panel terrain');
}

{
  reset();
  const cells=placePattern(30,10,true,false);
  const done=reactions.apply('heat',30,12,getTile,setTile);
  assert.ok(done && done.recipe==='heat_solar_storage_panel','transistor recipe takes storage-panel priority');
  assertCells(cells,T.SOLAR_BATTERY,'storage recipe turns every assembly block into storage panel terrain');
}

{
  reset();
  const cells=placePattern(40,10,true,true);
  const changed=fire.heatAround(41,10,getTile,setTile,{includeCenter:true});
  assert.ok(changed>0,'torch/fire heat path uses the same reaction engine');
  assertCells(cells,T.SOLAR_BATTERY,'torch heat completes a mirrored storage panel');
}

{
  reset();
  const cells=placePattern(50,10,false,false);
  assert.equal(reactions.apply('water',50,10,getTile,setTile),null,'wrong stimulus does not complete a heat recipe');
  for(const c of cells) assert.equal(getTile(c.x,c.y),c.t,'wrong stimulus leaves the assembly unchanged');
}

{
  reset();
  setTile(55,10,T.CLAY);
  const done=reactions.apply('heat',55,10,getTile,setTile);
  assert.ok(done && done.recipe==='heat_clay_to_brick','heat fires clay into brick');
  assert.equal(getTile(55,10),T.BRICK,'clay heat recipe produces brick terrain');
}

// The registry is open-ended: future water/electric reactions can be registered
// without adding more branches to weapons, fire, or world code.
{
  reset();
  assert.throws(
    ()=>reactions.register({id:'test_empty_pattern',stimulus:'water',pattern:[],resultTile:'MUD'}),
    /pattern cannot be empty/,
    'recipe registry rejects empty patterns'
  );
  reactions.register({id:'test_water_sand_to_mud',stimulus:'water',pattern:['S'],map:{S:'SAND'},resultTile:'MUD',mirror:false});
  setTile(60,10,T.SAND);
  assert.ok(reactions.apply('water',60,10,getTile,setTile),'custom water recipe applies');
  assert.equal(getTile(60,10),T.MUD,'custom water recipe changes terrain');

  const first=reactions.register({id:'test_duplicate_guard',stimulus:'water',pattern:['R'],map:{R:'STONE'},resultTile:'MUD',mirror:false});
  const duplicate=reactions.register({id:'test_duplicate_guard',stimulus:'water',pattern:['R'],map:{R:'STONE'},resultTile:'GRASS',mirror:false});
  assert.equal(duplicate,first,'duplicate recipe ids return the existing recipe unless replacement is explicit');
  assert.equal(reactions.recipesFor('water').filter(r=>r.id==='test_duplicate_guard').length,1,'duplicate recipe ids do not stack');
  const replaced=reactions.register({id:'test_duplicate_guard',stimulus:'water',pattern:['R'],map:{R:'STONE'},resultTile:'GRASS',mirror:false,replace:true});
  assert.notEqual(replaced,first,'replace:true swaps the recipe definition');
  setTile(62,10,T.STONE);
  assert.ok(reactions.apply('water',62,10,getTile,setTile),'replaced recipe applies');
  assert.equal(getTile(62,10),T.GRASS,'replacement recipe result is active');
  assert.equal(reactions.unregister('test_duplicate_guard'),true,'registry can unregister dynamic recipes');
  assert.equal(reactions.recipesFor('water').some(r=>r.id==='test_duplicate_guard'),false,'unregistered recipe disappears from its stimulus list');

  reactions.register({id:'test_electric_wire_to_copper',stimulus:'electric',pattern:['W'],map:{W:'WIRE'},resultTile:'COPPER_WIRE',mirror:false});
  setTile(61,10,T.WIRE);
  assert.ok(reactions.apply('electric',61,10,getTile,setTile),'custom electric recipe applies');
  assert.equal(getTile(61,10),T.COPPER_WIRE,'custom electric recipe changes terrain');

  reactions.register({id:'test_env_water_source_sand',stimulus:'water',pattern:['S'],map:{S:'SAND'},resultTile:'MUD',mirror:false});
  setTile(80,10,T.SAND);
  assert.equal(water.addSource(80,10,getTile,setTile),true,'water source on a reactive solid applies water recipes');
  assert.equal(getTile(80,10),T.MUD,'environmental water source can complete a water recipe');
  reactions.unregister('test_env_water_source_sand');

  reactions.register({id:'test_env_water_touch_sand',stimulus:'water',pattern:['S'],map:{S:'SAND'},resultTile:'MUD',mirror:false});
  setTile(82,10,T.SAND);
  assert.equal(water.addSource(82,9,getTile,setTile),true,'placed water checks neighboring reactive terrain');
  assert.equal(getTile(82,10),T.MUD,'water contact can complete a water recipe');
  reactions.unregister('test_env_water_touch_sand');

  reactions.register({id:'test_lightning_stone_to_obsidian',stimulus:'electric',pattern:['R'],map:{R:'STONE'},resultTile:'OBSIDIAN',mirror:false});
  setTile(90,12,T.STONE);
  const bolt=clouds.strike(90,getTile,setTile);
  assert.ok(bolt && bolt.reaction,'lightning applies electric reactions before chest fallback');
  assert.equal(getTile(90,12),T.OBSIDIAN,'electric lightning recipe changes the struck tile');
  assert.equal(bolt.chest,false,'reaction strikes do not also transmute the block into a chest');
  reactions.unregister('test_lightning_stone_to_obsidian');
}

{
  reset();
  const cells=placePattern(70,10,true,false);
  assert.ok(reactions.apply('heat',70,10,getTile,setTile),'storage panel can be forged before charging');
  for(let i=0;i<20;i++) solar.update(0.25,{x:71,y:11},getTile);
  const before=solar.metrics().storedEnergy;
  assert.ok(before>1,'sky-exposed storage panel charges from daylight');
  assert.equal(solar.catchUp(120,{x:71,y:11},getTile),true,'solar catch-up reports stored-energy progress after a long inactive gap');
  assert.ok(solar.metrics().storedEnergy>before,'solar catch-up accumulates daylight production while offscreen');
  const src=solar.sourceAt(70,10,getTile);
  assert.ok(src && src.kind==='solar','solar cluster exposes a power-source endpoint');
  const productionBeforeDrain=solar.metrics().currentPower;
  const drained=solar.drainAt(src.x,src.y,1.5,getTile);
  assert.ok(drained && drained.amount>0,'solar energy can be drained by machines');
  assert.equal(solar.metrics().currentPower,productionBeforeDrain,'machine drain does not inflate active solar production');
  const snap=solar.snapshot();
  solar.reset();
  assert.equal(solar.metrics().cells,0,'solar reset clears cached battery state');
  solar.restore(snap,getTile);
  assert.ok(solar.metrics().storedEnergy>0,'solar restore preserves stored panel energy');
  assertCells(cells,T.SOLAR_BATTERY,'charging does not rewrite panel terrain');
}

{
  reset();
  setTile(0,12,T.STONE);
  setTile(0,10,T.SOLAR_BATTERY);
  solar.restore({v:1,list:[{x:0,y:10,energy:20,power:0}]},getTile);
  assert.equal(solar.metrics().currentPower,0,'restored idle solar battery starts with no active production');
  const drained=solar.drainAt(0,10,4,getTile);
  assert.ok(drained && drained.amount>0,'stored solar energy can be drained from an idle battery');
  assert.equal(solar.metrics().currentPower,0,'draining a solar battery does not masquerade as fresh solar output');
}

{
  reset();
  setTile(0,10,T.SOLAR_BATTERY);
  setTile(1,10,T.COPPER_WIRE);
  setTile(2,10,T.TELEPORTER);
  for(let i=0;i<24;i++) solar.update(0.25,{x:1,y:10},getTile);
  const solarBefore=solar.metrics().storedEnergy;
  assert.ok(solarBefore>0,'single-cell test panel has stored energy before network drain');
  teleporters.update(1.0,{x:99,y:20,w:0.7,h:0.95,vx:0,vy:0,energy:0},getTile,setTile,{dynamo});
  assert.ok(teleporters.metrics().storedEnergy>0,'teleporter battery charges through copper wire from solar source');
  assert.ok(solar.metrics().storedEnergy<solarBefore,'charging a device drains stored solar energy');
}

{
  reset();
  setTile(0,-30,T.SOLAR_BATTERY);
  setTile(1,-30,T.COPPER_WIRE);
  setTile(2,-30,T.TELEPORTER);
  for(let i=0;i<24;i++) solar.update(0.25,{x:1,y:-30},getTile);
  const solarBefore=solar.metrics().storedEnergy;
  assert.ok(solarBefore>0,'sky solar panel stores energy before network drain');
  teleporters.update(1.0,{x:99,y:-30,w:0.7,h:0.95,vx:0,vy:0,energy:0},getTile,setTile,{dynamo});
  assert.ok(teleporters.metrics().storedEnergy>0,'sky teleporter battery charges through copper wire from sky solar source');
  assert.ok(solar.metrics().storedEnergy<solarBefore,'sky network charging drains the real solar battery');
}

{
  reset();
  setTile(5,10,T.SOLAR_BATTERY);
  const charged=solar._debug.debugChargeAt(5,10,60,getTile);
  assert.ok(charged>0,'debug helper can charge a solar battery for menu testing');
  assert.ok(solar.energyAt(5,10,getTile)>0,'debug-charged solar battery stores energy');
  assert.equal(solar._debug.debugSetEnergyAt(5,10,0,getTile),true,'debug helper can drain a solar cluster');
  assert.equal(solar.energyAt(5,10,getTile),0,'debug drain clears solar battery energy');
}

{
  reset();
  solar._debug.cells.set('999,10',{x:999,y:10,energy:90,power:0,pulse:0,storage:true});
  solar.update(0.1,{x:0,y:10},getTile);
  assert.equal(solar._debug.cells.has('999,10'),false,'solar update prunes stale cached cells whose terrain changed behind hooks');
  for(let i=0; i<solar._debug.CELL_CAP+80; i++){
    solar._debug.cells.set((2000+i)+',10',{x:2000+i,y:10,energy:0,power:0,pulse:0,storage:false});
  }
  solar.update(0.1,{x:0,y:10},getTile);
  assert.equal(solar.metrics().cells,0,'solar registry prunes invalid runaway cache entries');
}

const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
assert.match(mainSrc, /import \{ solar as SOLAR \}/, 'main imports the solar engine');
assert.match(mainSrc, /solar:\s*timedSavePart\('solar',[^\n]*SOLAR && SOLAR\.snapshot/, 'save payload includes solar battery state');
assert.match(mainSrc, /SOLAR\.restore\(data\.solar,getTile\)/, 'load path restores solar battery state');
assert.match(mainSrc, /SOLAR\.update\(dt,player,getTile\)/, 'main charges solar panels every frame');
assert.match(mainSrc, /SOLAR\.draw\(ctx,TILE,sx,sy,viewX,viewY,worldFxVisible,getTile\)/, 'main draws solar panel charge overlays');
assert.match(mainSrc, /T\.SOLAR_PANEL \|\| t===T\.SOLAR_BATTERY/, 'main renders solar panel tile bodies');
assert.match(mainSrc, /function placeDebugSolarPanel\(\)/, 'main exposes a debug action for placing a solar panel');
assert.match(mainSrc, /function placeDebugSolarBattery\(\)/, 'main exposes a debug action for placing a solar battery panel');
assert.match(mainSrc, /function placeDebugSolarRig\(\)/, 'main exposes a debug action for placing a solar-powered test rig');
assert.match(mainSrc, /MM\.ui\.injectSolarDebugPanel/, 'main injects the solar debug panel');

const fireSrc = await readFile(new URL('../src/engine/fire.js', import.meta.url), 'utf8');
assert.match(fireSrc, /import \{ reactions as REACTIONS \}/, 'fire imports the reaction engine');
assert.match(fireSrc, /REACTIONS\.apply\('heat'/, 'torch/fire heat applies heat reactions');

const weaponsSrc = await readFile(new URL('../src/engine/weapons.js', import.meta.url), 'utf8');
assert.match(weaponsSrc, /REACTIONS\.apply\(stimulus/, 'weapons use a generic reaction helper');
assert.match(weaponsSrc, /applyBlockReaction\('heat'/, 'flame streams apply heat recipes');
assert.match(weaponsSrc, /applyBlockReaction\('water'/, 'hose streams apply water recipes');
assert.match(weaponsSrc, /applyBlockReaction\('electric'/, 'electric beams apply electric recipes');

const teleporterSrc = await readFile(new URL('../src/engine/teleporters.js', import.meta.url), 'utf8');
assert.match(teleporterSrc, /source\.kind==='solar'/, 'power networks can drain solar sources');

const uiSrc = await readFile(new URL('../src/engine/ui.js', import.meta.url), 'utf8');
assert.match(uiSrc, /function injectSolarDebugPanel\(actions, menuPanel\)/, 'ui exposes a solar debug panel injector');
assert.match(uiSrc, /box\.id='solarDebugBox'/, 'solar debug panel has a stable DOM id');
assert.match(uiSrc, /Panel bateria/, 'solar debug panel includes a storage panel button');
assert.match(uiSrc, /Uklad testowy/, 'solar debug panel includes a powered rig button');
assert.match(uiSrc, /Laduj solar/, 'solar debug panel includes a solar charge button');

console.log('reactions-solar-sim: all assertions passed');
