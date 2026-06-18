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

const { T, INFO, WORLD_H } = await import('../src/constants.js');
const { reactions } = await import('../src/engine/reactions.js');
const { solar } = await import('../src/engine/solar.js');
const { dynamo } = await import('../src/engine/dynamo.js');
const { teleporters } = await import('../src/engine/teleporters.js');
const { fire } = await import('../src/engine/fire.js');

const tiles = new Map();
const key = (x,y)=>Math.floor(x)+','+Math.floor(y);
function getTile(x,y){
  x=Math.floor(x); y=Math.floor(y);
  if(y<0 || y>=WORLD_H) return T.AIR;
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
  MM.world={getTile,setTile};
  MM.water={onTileChanged(){}};
  MM.fallingSolids={recheckNeighborhood(){},afterPlacement(){},onTileRemoved(){}};
  MM.particles={spawnSparks(){},spawnBurst(){}};
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
assert.equal(INFO[T.TRANSISTOR].drop,'transistor','placed transistors can be recovered');
assert.equal(INFO[T.SOLAR_PANEL].powerSource,true,'solar panels are power sources');
assert.equal(INFO[T.SOLAR_BATTERY].energyCapacity,120,'storage solar panel advertises its battery capacity');

{
  reset();
  const cells=placePattern(10,10,false,false);
  const done=reactions.apply('heat',10,10,getTile,setTile);
  assert.ok(done && done.recipe==='heat_solar_panel','heat completes the basic solar recipe');
  assertCells(cells,T.SOLAR_PANEL,'basic recipe turns every assembly block into panel terrain');
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

// The registry is open-ended: future water/electric reactions can be registered
// without adding more branches to weapons, fire, or world code.
{
  reset();
  reactions.register({id:'test_water_sand_to_mud',stimulus:'water',pattern:['S'],map:{S:'SAND'},resultTile:'MUD',mirror:false});
  setTile(60,10,T.SAND);
  assert.ok(reactions.apply('water',60,10,getTile,setTile),'custom water recipe applies');
  assert.equal(getTile(60,10),T.MUD,'custom water recipe changes terrain');

  reactions.register({id:'test_electric_wire_to_copper',stimulus:'electric',pattern:['W'],map:{W:'WIRE'},resultTile:'COPPER_WIRE',mirror:false});
  setTile(61,10,T.WIRE);
  assert.ok(reactions.apply('electric',61,10,getTile,setTile),'custom electric recipe applies');
  assert.equal(getTile(61,10),T.COPPER_WIRE,'custom electric recipe changes terrain');
}

{
  reset();
  const cells=placePattern(70,10,true,false);
  assert.ok(reactions.apply('heat',70,10,getTile,setTile),'storage panel can be forged before charging');
  for(let i=0;i<20;i++) solar.update(0.25,{x:71,y:11},getTile);
  const before=solar.metrics().storedEnergy;
  assert.ok(before>1,'sky-exposed storage panel charges from daylight');
  const src=solar.sourceAt(70,10,getTile);
  assert.ok(src && src.kind==='solar','solar cluster exposes a power-source endpoint');
  const drained=solar.drainAt(src.x,src.y,1.5,getTile);
  assert.ok(drained && drained.amount>0,'solar energy can be drained by machines');
  const snap=solar.snapshot();
  solar.reset();
  assert.equal(solar.metrics().cells,0,'solar reset clears cached battery state');
  solar.restore(snap,getTile);
  assert.ok(solar.metrics().storedEnergy>0,'solar restore preserves stored panel energy');
  assertCells(cells,T.SOLAR_BATTERY,'charging does not rewrite panel terrain');
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

const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
assert.match(mainSrc, /import \{ solar as SOLAR \}/, 'main imports the solar engine');
assert.match(mainSrc, /solar:\s*\(SOLAR && SOLAR\.snapshot\)/, 'save payload includes solar battery state');
assert.match(mainSrc, /SOLAR\.restore\(data\.solar,getTile\)/, 'load path restores solar battery state');
assert.match(mainSrc, /SOLAR\.update\(dt,player,getTile\)/, 'main charges solar panels every frame');
assert.match(mainSrc, /SOLAR\.draw\(ctx,TILE,sx,sy,viewX,viewY,worldFxVisible,getTile\)/, 'main draws solar panel charge overlays');
assert.match(mainSrc, /T\.SOLAR_PANEL \|\| t===T\.SOLAR_BATTERY/, 'main renders solar panel tile bodies');

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

console.log('reactions-solar-sim: all assertions passed');
