import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.performance = globalThis.performance || {now:()=>Date.now()};
const storage = new Map();
globalThis.localStorage = {
  getItem:k=>storage.has(k) ? storage.get(k) : null,
  setItem:(k,v)=>storage.set(k,String(v)),
  removeItem:k=>storage.delete(k)
};
const messages = [];
globalThis.msg = t=>messages.push(String(t));

const { T } = await import('../src/constants.js');
const { invasions } = await import('../src/engine/invasions.js');

MM.TILE = 20;
MM.worldGen = {worldSeed:1234, surfaceHeight:()=>50};
MM.background = {timeInfo:()=>({phase:'night', isDay:false, hour:23})};
MM.seasons = {metrics:()=>({dayFloat:2})};

const overrides = new Map();
function key(x,y){ return Math.floor(x)+','+Math.floor(y); }
function getTile(x,y){
  const k = key(x,y);
  if(overrides.has(k)) return overrides.get(k);
  return y >= 50 ? T.STONE : T.AIR;
}
function setTile(x,y,t){ overrides.set(key(x,y),t); }
const player = {x:0,y:49,hp:100,maxHp:100,vx:0,vy:0,xp:0};
let saveMarks = 0;
const ctx = {getTile,setTile,spawnBurst(){},msg:globalThis.msg,ensureChunkAtY(){},notifyStructureTileChanged(){},saveState(){ saveMarks++; }};

invasions.reset();
saveMarks = 0;
invasions.update(0.016, player, getTile, setTile, ctx);
assert.equal(invasions.metrics().teams, 1, 'first night update schedules one alien team');
assert.equal(invasions.metrics().lastNightDay, 2, 'night spawn is recorded for the current in-game day');
assert.ok(saveMarks >= 1, 'night scheduling asks the host save system to persist active invasion state');
invasions.update(0.016, player, getTile, setTile, ctx);
assert.equal(invasions.metrics().teams, 1, 'same night does not spawn duplicate teams');

invasions.reset();
const scalable = invasions.forceNightInvasion(player,getTile,setTile,{day:9,teams:3,alienCount:1});
assert.equal(scalable.length, 3, 'force spawn can create several scalable invading teams');
assert.equal(invasions.metrics().activeTeams, 3, 'all forced teams are active invasion pressure');

invasions.reset();
invasions.forceNightInvasion(player,getTile,setTile,{day:5,teams:1,alienCount:1});
let state = invasions.state();
const lander = state.teams[0].lander;
assert.ok(invasions.damageAt(Math.floor(lander.x),Math.floor(lander.y),999), 'hero weapons can damage an invasion lander');
invasions.update(0.1, player, getTile, setTile, ctx);
assert.ok(player.xp >= 160, 'defeating an invading team grants substantial XP');

invasions.reset();
invasions.forceNightInvasion(player,getTile,setTile,{day:4,teams:1,alienCount:1});
for(let i=0;i<110;i++) invasions.update(0.1, player, getTile, setTile, ctx);
assert.ok(invasions.metrics().aliens >= 1, 'landing completes by deploying small alien attackers');
state = invasions.state();
const alien = state.teams[0].aliens[0];
assert.ok(invasions.attackAt(Math.floor(alien.x),Math.floor(alien.y-0.45),500), 'melee attacks can hit small aliens');
invasions.update(0.1, player, getTile, setTile, ctx);
assert.ok(invasions.metrics().activeTeams === 0 || player.xp > 0, 'killing the final alien can finish the team');

const inv = {wood:10, stone:8, diamond:1};
const originalInv = {...inv};
const originalBag = [
  {id:'blade_1',kind:'weapon',name:'Blade',attackDamage:7},
  {id:'charm_1',kind:'charm',name:'Charm',moveSpeedMult:1.1},
  {id:'cape_1',kind:'cape',name:'Cape',airJumps:2},
  {id:'eyes_1',kind:'eyes',name:'Eyes',visionRadius:14}
];
let snap = {
  v:1,
  equipped:{cape:'classic',eyes:'bright',outfit:'default',weapon:'blade_1',charm:'charm_1'},
  colors:{},
  bag:originalBag.map(i=>({...i})),
  discarded:[],
  shortcutOff:[],
  newItems:originalBag.map(i=>i.id)
};
const grants = [];
const slots = [
  {id:'cape',accepts:'cape',required:true,def:'classic'},
  {id:'eyes',accepts:'eyes',required:true,def:'bright'},
  {id:'outfit',accepts:'outfit',required:true,def:'default'},
  {id:'weapon',accepts:'weapon',required:false,def:null},
  {id:'charm',accepts:'charm',required:false,def:null}
];
const inventory = {
  SLOTS:slots,
  snapshot:()=>JSON.parse(JSON.stringify(snap)),
  restore(next){ snap=JSON.parse(JSON.stringify(next)); return true; },
  grantItem(item){ grants.push(item.id); if(!snap.bag.some(i=>i.id===item.id)) snap.bag.push({...item}); return true; },
  equip(id){
    const item = snap.bag.find(i=>i.id===id);
    const slot = slots.find(s=>item && s.accepts===item.kind);
    if(slot){ snap.equipped[slot.id]=id; return true; }
    return false;
  }
};
let dynamicLootSaves = 0;
MM.dynamicLoot = {capes:[],eyes:[],outfits:[],weapons:[],charms:[]};
MM.chests = {saveDynamicLoot(){ dynamicLootSaves++; }};
for(const item of originalBag){
  const keyName = item.kind === 'cape' ? 'capes' : item.kind === 'eyes' ? 'eyes' : item.kind === 'outfit' ? 'outfits' : item.kind === 'weapon' ? 'weapons' : 'charms';
  MM.dynamicLoot[keyName].push({...item});
}
overrides.clear();
saveMarks = 0;
const theft = invasions.onHeroKilled({player, inv, resourceKeys:['wood','stone','diamond'], inventory, getTile, setTile, ...ctx});
assert.equal(theft.handled, true, 'alien-caused death is handled by the invasion theft path');
assert.ok(theft.cache && getTile(theft.cache.x,theft.cache.y)===T.INVASION_CACHE, 'stolen loot is hidden in a special neighborhood cache tile');
assert.ok(inv.wood < originalInv.wood || inv.stone < originalInv.stone || inv.diamond < originalInv.diamond, 'alien theft removes roughly half of carried resources');
assert.ok(snap.bag.length < originalBag.length, 'alien theft removes random dynamic gear from the bag');
assert.ok(theft.cache.gear.length >= 1, 'alien cache records stolen gear objects for recovery');
const stolenIds = new Set(theft.cache.gear.map(item=>item.id));
const dynamicIds = new Set(Object.values(MM.dynamicLoot).flat().map(item=>item && item.id).filter(Boolean));
for(const id of stolenIds) assert.equal(dynamicIds.has(id), false, 'stolen gear is removed from the dynamic loot pool until recovery');
assert.ok(dynamicLootSaves >= 1, 'stealing gear persists the dynamic loot pool cleanup');
assert.ok(saveMarks >= 1, 'creating a theft cache asks the host save system to persist it');
assert.ok(invasions.openCacheAt(theft.cache.x,theft.cache.y,{inv, inventory, getTile, setTile, updateInventory(){}, saveState(){}, notifyStructureTileChanged(){}}), 'opening the cache restores stolen loot');
assert.equal(getTile(theft.cache.x,theft.cache.y), T.AIR, 'opened cache tile is cleared');
assert.equal(snap.bag.length, originalBag.length, 'opening the cache grants stolen gear back');
assert.ok(inv.wood >= originalInv.wood && inv.stone >= originalInv.stone, 'opening the cache restores stolen resources');
assert.ok(grants.length >= theft.cache.gear.length, 'each stolen gear item is granted back through inventory APIs');

saveMarks = 0;
overrides.set(key(8,49), T.WOOD);
assert.ok(invasions._debug.damageStructureTile(8,49,99,getTile,setTile,ctx), 'alien lasers can destroy a player-built shelter tile');
assert.equal(getTile(8,49), T.AIR, 'destroyed shelter tile is removed from the world');
assert.ok(saveMarks >= 1, 'alien structure damage asks the host save system to persist world changes');

const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const weaponsSrc = await readFile(new URL('../src/engine/weapons.js', import.meta.url), 'utf8');
assert.match(mainSrc, /import \{ invasions as INVASIONS \} from '\.\/engine\/invasions\.js';/, 'main imports the invasion engine');
assert.match(mainSrc, /cause==='alien_invasion'[\s\S]*INVASIONS\.onHeroKilled/, 'alien deaths route to invasion theft before normal gravestones');
assert.match(mainSrc, /invasions: timedSavePart\('invasions',[^\n]*INVASIONS && INVASIONS\.snapshot/, 'save payload includes invasion state');
assert.match(mainSrc, /INVASIONS\.restore\(data\.invasions,getTile,setTile\)/, 'load path restores invasion teams and caches');
assert.match(mainSrc, /INVASIONS\.update\(dt, player, getTile, setTile/, 'main update loop advances invasions');
assert.match(mainSrc, /INVASIONS\.draw\(ctx,TILE,worldFxVisible\)/, 'main draw loop renders invasions');
assert.match(mainSrc, /tryOpenInvasionCacheAt/, 'main has a dedicated invasion cache opener');
assert.match(weaponsSrc, /MM\.invasions && MM\.invasions\.attackAt/, 'melee weapons can hit invasion enemies');
assert.match(weaponsSrc, /MM\.invasions && MM\.invasions\.damageAt/, 'ranged and stream weapons can damage invasion enemies');
assert.match(weaponsSrc, /MM\.invasions && MM\.invasions\.blastRadius/, 'gas explosions damage invasion enemies');

console.log('invasions-sim: all assertions passed');
