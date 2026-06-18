// Deterministic Node test for the world gas system.
// Verifies upward motion, no mixing except hot-air absorption, steam condensation,
// fuel ignition, save/restore and basic active-set caps.
import { strict as assert } from 'assert';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};

const { T, WORLD_H, CHUNK_W } = await import('../src/constants.js');
const { gases } = await import('../src/engine/gases.js');
assert.ok(gases, 'gases module exports');

let tiles;
let explosions;
let lastExplosionOpts;
function key(x,y){ return x+','+y; }
function resetWorld(){
  tiles=new Map();
  gases.reset();
  explosions=0;
  lastExplosionOpts=null;
  MM.weapons={ explodeAt(wx,wy,getTile,setTile,opts){ explosions++; lastExplosionOpts=opts||{}; return true; } };
  MM.water={ onTileChanged(){}, disturb(){} };
  MM.world={ getTile, setTile, setTransientTile:setTile };
}
function getTile(x,y){
  if(y<0 || y>=WORLD_H) return T.STONE;
  return tiles.get(key(x,y)) ?? T.AIR;
}
function setTile(x,y,v){
  if(y<0 || y>=WORLD_H) return;
  const k=key(x,y);
  const old=getTile(x,y);
  if(v===T.AIR) tiles.delete(k);
  else tiles.set(k,v);
  if(old!==v) gases.onTileChanged(x,y,old,v);
}
function fill(x0,x1,y0,y1,t){
  for(let x=x0; x<=x1; x++) for(let y=y0; y<=y1; y++) setTile(x,y,t);
}
function step(seconds,dt=0.1){
  const n=Math.ceil(seconds/dt);
  for(let i=0; i<n; i++) gases.update(dt,getTile,setTile,{x:0,y:20});
}
function count(tile){
  let n=0;
  for(const v of tiles.values()) if(v===tile) n++;
  return n;
}

// 1) A free gas bubble rises and vanishes when it exits the top of the map.
resetWorld();
setTile(0,4,T.POISON_GAS);
step(5);
assert.equal(count(T.POISON_GAS),0,'poison gas escapes at the top of the map');

function sealSteamPocket(){
  fill(-3,3,10,10,T.STONE);
  fill(-3,-3,11,14,T.STONE);
  fill(3,3,11,14,T.STONE);
}

// 2) Steam caught under a roof condenses by volume: five steam cells make one
// water cell, and partial condensate survives save/restore.
resetWorld();
sealSteamPocket();
setTile(-1,13,T.STEAM);
setTile(0,13,T.STEAM);
setTile(1,13,T.STEAM);
setTile(-1,12,T.STEAM);
step(62,0.2);
assert.equal(count(T.STEAM),0,'steam no longer remains after its condensation time');
assert.equal(count(T.WATER),0,'four steam cells leave condensate but do not make a full water tile');
assert.equal(gases.metrics().steamCondensate,4,'partial steam condensate is tracked');
const partialSteamSnap=gases.snapshot();
assert.equal(partialSteamSnap.condensate.reduce((sum,c)=>sum+c.n,0),4,'partial steam condensate is saved');
gases.reset();
gases.restore(partialSteamSnap,getTile,setTile);
assert.equal(gases.metrics().steamCondensate,4,'partial steam condensate restores');
setTile(1,12,T.STEAM);
step(62,0.2);
assert.equal(count(T.STEAM),0,'the final steam cell also expires');
assert.equal(count(T.WATER),1,'five steam cells condense into one water tile');
assert.equal(gases.metrics().steamCondensate,0,'a full condensation unit is consumed into water');

// 3) Hot air bubbles through other gases instead of being absorbed, and
// isolated hot air still expires into normal air.
resetWorld();
setTile(0,20,T.HOT_AIR);
setTile(1,20,T.POISON_GAS);
gases._debug.active.get('0,20').moveT=99;
gases._debug.active.get('1,20').moveT=99;
step(0.25,0.05);
assert.equal(getTile(0,20),T.HOT_AIR,'hot air touching another gas is not absorbed');
assert.equal(getTile(1,20),T.POISON_GAS,'adjacent poison gas is preserved');

resetWorld();
setTile(0,20,T.HOT_AIR);
setTile(0,19,T.POISON_GAS);
gases._debug.active.get('0,20').moveT=0;
gases._debug.active.get('0,19').moveT=99;
gases.update(0.05,getTile,setTile,{x:20,y:20});
assert.equal(getTile(0,19),T.HOT_AIR,'hot air can rise through poison gas');
assert.equal(getTile(0,20),T.POISON_GAS,'displaced poison gas stays separate below hot air');

resetWorld();
fill(-1,1,18,18,T.STONE);
fill(-1,-1,19,20,T.STONE);
fill(1,1,19,20,T.STONE);
setTile(0,19,T.HOT_AIR);
step(61,0.2);
assert.equal(count(T.HOT_AIR),0,'isolated hot air becomes normal air after one minute');

// 4) Fuel gas ignites on lava/torch/fire, consumes nearby fuel, and delegates to explosions.
resetWorld();
setTile(0,20,T.FUEL_GAS);
setTile(0,21,T.LAVA);
step(0.5,0.05);
assert.equal(explosions,1,'fuel gas explodes when ignited by lava');
assert.equal(count(T.FUEL_GAS),0,'exploding fuel gas is consumed');
assert.ok(lastExplosionOpts && lastExplosionOpts.extraConsumed>=1,'fuel explosion reports consumed gas volume to the blast');
assert.equal(lastExplosionOpts.force,true,'fuel-triggered explosion bypasses visual blast cooldown after consuming fuel');

// 5) Non-hot gases do not mix into each other or overwrite each other.
resetWorld();
fill(-2,3,18,18,T.STONE);
fill(-2,-2,19,20,T.STONE);
fill(3,3,19,20,T.STONE);
setTile(0,19,T.POISON_GAS);
setTile(1,19,T.FUEL_GAS);
step(1,0.1);
assert.equal(count(T.POISON_GAS),1,'poison gas remains separate');
assert.equal(count(T.FUEL_GAS),1,'fuel gas remains separate');

// 6) Snapshot/restore rehydrates active gas state from gas tiles in the world.
resetWorld();
setTile(5,30,T.STEAM);
setTile(6,30,T.POISON_GAS);
const snap=gases.snapshot();
assert.equal(snap.list.length,2,'snapshot captures active gases');
gases.reset();
assert.equal(gases.metrics().active,0,'reset clears active gases');
gases.restore(snap,getTile,setTile);
assert.equal(gases.metrics().active,2,'restore reactivates saved gases');

// 7) Sky-exposed gases are recognized as open-air FX, and old steam fades away
// instead of being held at a dark visible floor.
resetWorld();
setTile(10,12,T.STEAM);
assert.equal(gases.skyExposed(10,12,getTile),true,'steam with an open vertical path is sky-exposed');
setTile(10,6,T.STONE);
assert.equal(gases.skyExposed(10,12,getTile),false,'a solid roof makes the same steam underground');
setTile(10,6,T.AIR);
const steamRecord=gases._debug.active.get('10,12');
assert.ok(steamRecord,'steam record is active for fade rendering');
steamRecord.age=58.8;
globalThis.document = {
  getElementById(){ return null; },
  createElement(){
    return {
      width:0,
      height:0,
      getContext(){
        return {
          fillStyle:'',
          createRadialGradient(){ return {addColorStop(){}}; },
          beginPath(){},
          arc(){},
          fill(){}
        };
      }
    };
  }
};
let steamAlpha=null;
const steamCtx={
  _alpha:1,
  globalCompositeOperation:'',
  set globalAlpha(v){ this._alpha=v; },
  get globalAlpha(){ return this._alpha; },
  save(){},
  restore(){},
  drawImage(){ steamAlpha=this.globalAlpha; }
};
gases.draw(steamCtx,20,9,10,3,4,()=>true);
assert.ok(steamAlpha!=null && steamAlpha<0.04,'near-expired steam is barely visible instead of a hard square (alpha '+steamAlpha+')');

// 8) Add API is capped and machine-friendly.
resetWorld();
const placed=gases.add('fuel',10,40,{power:5,cells:20,getTile,setTile});
assert.ok(placed>0 && placed<=12,'add() places a bounded number of fuel gas cells');
assert.equal(gases.metrics().fuel,placed,'metrics expose fuel gas count');

// 9) The active registry stays bounded but new nearby gas still becomes active.
resetWorld();
for(let i=0; i<1905; i++) setTile(i,50,T.POISON_GAS);
assert.ok(gases.metrics().active<=1800,'gas active registry is capped');
assert.equal(count(T.POISON_GAS),gases.metrics().active,'evicted gas records also clear their world tiles');
assert.ok(gases._debug.active.has('1904,50'),'new gas can evict an older dormant active entry at the cap');
const cappedAdd=gases.add('fuel',2200,50,{power:1,cells:1,getTile,setTile});
assert.equal(cappedAdd,1,'add() can still evict an older active gas at the cap');
assert.equal(count(T.FUEL_GAS),1,'cap-time add() places the new gas tile');

// 10) In the real world store, gas is queryable through getTile but does not dirty
// terrain chunks or invalidate cached terrain art on every drift step.
const { world } = await import('../src/engine/world.js');
world.clear();
gases.reset();
let airSpot=null;
for(let y=2; y<WORLD_H-2 && !airSpot; y++){
  if(world.getTile(32,y)===T.AIR) airSpot={x:32,y};
}
assert.ok(airSpot,'test world has an open air cell for transient gas');
world.setTransientTile(airSpot.x,airSpot.y,T.STEAM);
assert.equal(world.getTile(airSpot.x,airSpot.y),T.STEAM,'transient gas is visible to world.getTile');
assert.equal(world.chunkVersion(Math.floor(airSpot.x/CHUNK_W)),0,'transient gas does not bump the terrain chunk version');
assert.deepEqual(world.modifiedChunkIds(),[],'transient gas does not enter modified chunk saves');
const realSnap=gases.snapshot();
world.clear();
gases.reset();
gases.restore(realSnap,world.getTile,world.setTile);
assert.equal(world.getTile(airSpot.x,airSpot.y),T.STEAM,'gas snapshot restore can recreate a transient gas tile');
assert.equal(world.chunkVersion(Math.floor(airSpot.x/CHUNK_W)),0,'gas snapshot restore also avoids terrain dirtying');
assert.deepEqual(world.modifiedChunkIds(),[],'gas snapshot restore is kept out of terrain save chunks');

// 11) Public water APIs clean up gas records even when called with a raw setter
// that does not forward world tile-change hooks. Future machines can use those
// APIs directly without leaving invisible stale gas entries behind.
const { water } = await import('../src/engine/water.js');
function rawSetTile(x,y,v){
  if(y<0 || y>=WORLD_H) return;
  const k=key(x,y);
  if(v===T.AIR) tiles.delete(k);
  else tiles.set(k,v);
}
resetWorld();
setTile(72,20,T.POISON_GAS);
assert.equal(gases.metrics().active,1,'test gas starts active before raw water replacement');
assert.equal(water.addSource(72,20,getTile,rawSetTile),true,'water.addSource can occupy a gas cell');
assert.equal(getTile(72,20),T.WATER,'raw water source replaced gas with water');
assert.equal(gases.metrics().active,0,'water.addSource removed the replaced gas record without relying on world hooks');
resetWorld();
setTile(80,20,T.WATER);
setTile(80,19,T.FUEL_GAS);
assert.equal(gases.metrics().active,1,'displacement target gas starts active');
assert.equal(water.displaceAt(80,20,getTile,rawSetTile),true,'water.displaceAt can move water into a gas cell');
assert.equal(getTile(80,19),T.WATER,'displaced water replaced the gas above');
assert.equal(gases.metrics().active,0,'water.displaceAt removed the replaced gas record without relying on world hooks');

resetWorld();
water.reset();
setTile(100,42,T.WATER);
setTile(100,43,T.STEAM);
setTile(100,44,T.STONE);
assert.equal(gases.metrics().active,1,'fall target gas starts active');
water.onTileChanged(100,42,getTile);
water.update(getTile,rawSetTile,1/60);
assert.equal(getTile(100,43),T.WATER,'falling water replaced gas with water');
assert.equal(gases.metrics().active,0,'falling water removed the replaced gas record without world hooks');

resetWorld();
water.reset();
setTile(110,29,T.WATER);
setTile(110,30,T.WATER);
setTile(110,31,T.STONE);
for(let y=29;y<=31;y++){ setTile(109,y,T.STONE); setTile(112,y,T.STONE); }
setTile(111,29,T.STONE);
setTile(111,30,T.FUEL_GAS);
setTile(111,31,T.STONE);
assert.equal(gases.metrics().active,1,'side-pressure target gas starts active');
water.onTileChanged(111,30,getTile);
for(let i=0;i<20;i++) water.update(getTile,rawSetTile,1/60);
assert.equal(getTile(111,30),T.WATER,'pressurized water replaced side gas with water');
assert.equal(gases.metrics().active,0,'pressurized water removed the replaced gas record without world hooks');

resetWorld();
water.reset();
for(let x=39;x<=87;x++) setTile(x,100,T.STONE);
for(let y=94;y<=100;y++){ setTile(39,y,T.STONE); setTile(87,y,T.STONE); }
for(let x=40;x<=80;x++) for(let y=94;y<100;y++) setTile(x,y,T.WATER);
for(let x=81;x<=86;x++){ setTile(x,93,T.STONE); for(let y=95;y<100;y++) setTile(x,y,T.STONE); }
setTile(81,94,T.POISON_GAS);
assert.equal(gases.metrics().active,1,'pressure-level gas mouth starts active');
water.onTileChanged(81,94,getTile);
for(let i=0;i<8000;i++) water.update(getTile,rawSetTile,1/60);
assert.equal(getTile(81,94),T.WATER,'pressure leveling replaced roofed-mouth gas with water');
assert.equal(gases.metrics().active,0,'pressure leveling removed the replaced gas record without world hooks');

// 12) Falling-solid APIs also clean up gas when run with a raw setter. That keeps
// gases as a reliable transient layer for future machines and off-main simulations.
const { fallingSolids } = await import('../src/engine/falling.js');
resetWorld();
setTile(90,42,T.STONE);
setTile(90,41,T.POISON_GAS);
assert.equal(gases.metrics().active,1,'falling test gas starts active');
fallingSolids.reset();
fallingSolids.init(getTile,rawSetTile);
fallingSolids.restore({v:3, active:[{x:90,y:40,type:T.STONE,vy:0}], sand:[], queue:[]});
fallingSolids.update(getTile,rawSetTile,0.25);
assert.equal(getTile(90,41),T.STONE,'falling rigid block settled into the gas cell');
assert.equal(gases.metrics().active,0,'falling rigid block removed the replaced gas record without world hooks');

resetWorld();
setTile(90,42,T.STONE);
setTile(91,42,T.STONE);
setTile(92,42,T.STONE);
setTile(91,41,T.STEAM);
assert.equal(gases.metrics().active,1,'sand test gas starts active');
fallingSolids.reset();
fallingSolids.init(getTile,rawSetTile);
fallingSolids.restore({v:3, active:[], sand:[{x:91,y:40,vy:0}], queue:[]});
fallingSolids.update(getTile,rawSetTile,0.25);
assert.equal(getTile(91,41),T.SAND,'falling sand settled into the gas cell');
assert.equal(gases.metrics().active,0,'falling sand removed the replaced gas record without world hooks');
fallingSolids.reset();

const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
assert.match(mainSrc, /function isGasTileId\(t\)/, 'main.js has a gas tile predicate');
assert.match(mainSrc, /function gasSkyExposedTile\(x,y\)/, 'main.js has a sky-exposed gas predicate for static terrain cache');
assert.match(mainSrc, /y>surf && !\(gasTile && gasSkyExposedTile\(wx,y\)\)/, 'chunk terrain cache does not bake cave darkness behind sky-exposed gas');
assert.match(mainSrc, /t===T\.AIR \|\| isGasTileId\(t\)/, 'mining does not start on gas cells');
assert.match(mainSrc, /if\(info\.gas\) return false;/, 'mining cannot break gas cells directly');
assert.match(mainSrc, /const prevRaw=getTile\(tx,ty\); const prev=isGasTileId\(prevRaw\)\?T\.AIR:prevRaw;/, 'placing into gas records air for undo');
assert.match(mainSrc, /setTile\.transient\s*=\s*function/, 'main.js exposes transient world writes to simulation layers');
assert.match(mainSrc, /function debugGasOrigin\(\)/, 'main.js chooses a nearby open gas debug origin');
assert.match(mainSrc, /GASES\.add\(kind,at\.x,at\.y,\{power:p,cells:Math\.round\(3\+p\*4\),getTile,setTile\}\)/, 'gas debug buttons use the public gas add API');
assert.match(mainSrc, /GASES\.igniteAt\(at\.x,at\.y,getTile,setTile/, 'gas debug ignite uses the public gas ignition API');
assert.match(mainSrc, /setTile\.transient\(x,y,T\.AIR\)/, 'gas debug clear removes visible transient gas cells');
assert.match(mainSrc, /const worldMap=WORLD && WORLD\._world;/, 'gas debug clear scans loaded world chunks');
assert.match(mainSrc, /if\(isGasTileId\(arr\[row\+lx\]\)\) clearAt\(x0\+lx,y\);/, 'gas debug clear removes stale loaded gas tiles beyond the active snapshot');
assert.match(mainSrc, /MM\.ui\.injectGasDebugPanel/, 'main.js injects the gas debug controls into the menu');

const uiSrc = await readFile(new URL('../src/engine/ui.js', import.meta.url), 'utf8');
assert.match(uiSrc, /function injectGasDebugPanel\(actions, menuPanel\)/, 'ui.js exposes a gas debug panel injector');
assert.match(uiSrc, /box\.id='gasDebugBox'/, 'gas debug panel has a stable DOM id');
assert.match(uiSrc, /GAS_DEBUG_BUTTONS=\[/, 'gas debug panel defines per-gas spawn buttons');
assert.match(uiSrc, /actions\.spawn\(kind, readPower\(\)\)/, 'gas debug buttons call the supplied spawn action');
assert.match(uiSrc, /actions\.ignite\(readPower\(\)\)/, 'gas debug panel includes a fuel ignition action');
assert.match(uiSrc, /actions\.clear\(\)/, 'gas debug panel includes a clear action');

const meatSrc = await readFile(new URL('../src/engine/meat.js', import.meta.url), 'utf8');
assert.match(meatSrc, /const canOccupy = t=>t===T\.AIR \|\| t===T\.WATER \|\| isGasTile\(t\);/, 'meat treats gas cells as open for drops and settling');
const treeSrc = await readFile(new URL('../src/engine/trees.js', import.meta.url), 'utf8');
assert.match(treeSrc, /function passThrough\(t\)\{ return t===T\.AIR \|\| t===T\.WATER \|\| isGasTile\(t\); \}/, 'falling trees pass through gas');
const cloudSrc = await readFile(new URL('../src/engine/clouds.js', import.meta.url), 'utf8');
assert.match(cloudSrc, /function skyOpenTile\(t\)/, 'weather has a gas-aware sky-open predicate');
assert.match(cloudSrc, /pt===T\.AIR \|\| isGasTile\(pt\)/, 'rain deposition can occupy gas cells');
const bossSrc = await readFile(new URL('../src/engine/bosses.js', import.meta.url), 'utf8');
assert.match(bossSrc, /function openT\(t\)\{ return t===T\.AIR \|\| t===T\.WATER \|\| t===T\.LEAF \|\| isGasTile\(t\); \}/, 'boss movement treats gas as open');
const plantSrc = await readFile(new URL('../src/engine/plants.js', import.meta.url), 'utf8');
assert.match(plantSrc, /function plantSpace\(t\)\{ return t===T\.AIR \|\| t===T\.WATER \|\| isGasTile\(t\); \}/, 'plants treat gas as open space');
const weaponSrc = await readFile(new URL('../src/engine/weapons.js', import.meta.url), 'utf8');
assert.match(weaponSrc, /t!==T\.AIR && !\(INFO\[t\] && INFO\[t\]\.gas\)/, 'hose condensation can replace gas with water');
const fallingSrc = await readFile(new URL('../src/engine/falling.js', import.meta.url), 'utf8');
assert.match(fallingSrc, /function notifyGasChange\(x,y,oldTile,newTile\)/, 'falling solids explicitly notify gas registry on raw writes');
assert.match(fallingSrc, /notifyGasChange\(x,yy,was,type\)/, 'rigid falling blocks clean up gas they replace');
assert.match(fallingSrc, /notifyGasChange\(x,y,was,T\.SAND\)/, 'falling sand cleans up gas it replaces');

console.log('gases-sim: all assertions passed');
