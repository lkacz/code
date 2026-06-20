// Meat lifecycle regression tests.
// Verifies animal death drops, 60s decay, snow preservation, and rotten gas.
// Run: node tools/meat-decay-sim.test.mjs
import { strict as assert } from 'assert';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};

const { T, INFO, WORLD_H } = await import('../src/constants.js');
let gasUnits = 0;
MM.gases = { add(kind,x,y,opts){ gasUnits += opts && opts.cells ? opts.cells : 1; return opts && opts.cells ? opts.cells : 1; } };

const { meat } = await import('../src/engine/meat.js');
const { fire } = await import('../src/engine/fire.js');
const { food } = await import('../src/engine/food.js');

assert.equal(food.effectForTile(T.MEAT)?.key, 'meat', 'fresh meat is edible as raw meat');
assert.equal(food.effectForTile(T.ROTTEN_MEAT)?.key, 'rottenMeat', 'rotten meat has its own edible inventory item');
assert.equal(food.effectForTile(T.BAKED_MEAT)?.key, 'bakedMeat', 'baked meat has its own edible inventory item');
assert.equal(INFO[T.MEAT].looseItem, true, 'fresh meat is marked as a loose item for cutout rendering');
assert.equal(INFO[T.ROTTEN_MEAT].looseItem, true, 'rotten meat is marked as a loose item for cutout rendering');
assert.equal(INFO[T.BAKED_MEAT].looseItem, true, 'baked meat is marked as a loose item for cutout rendering');

const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const looseItemBranch = mainSrc.indexOf('if(isLooseItemTile(t)){');
const baseFillBranch = mainSrc.indexOf('let base=INFO[t].color', looseItemBranch);
assert.ok(looseItemBranch >= 0 && baseFillBranch > looseItemBranch, 'chunk renderer handles loose items before full-tile base fill');
const looseItemSrc = mainSrc.slice(looseItemBranch, baseFillBranch);
assert.match(looseItemSrc, /drawUndergroundBackdrop\(cctx,lx\*TILE,y\*TILE,wx,y,surf\)/, 'loose items keep cave backdrops underground');
assert.match(looseItemSrc, /drawMeatTile/, 'loose meat renders through the cutout meat sprite');
assert.match(looseItemSrc, /continue;/, 'loose item branch exits before block-color fill');
const meatRendererSrc = mainSrc.slice(mainSrc.indexOf('function drawMeatTile'), mainSrc.indexOf('function drawChestTile'));
assert.doesNotMatch(meatRendererSrc, /fillRect\(px\+4,py\+TILE-4,TILE-8,2\)/, 'meat sprite does not paint an artificial rectangular backing');

{
  const eater = { hp: 50, maxHp: 100 };
  const inv = { meat: 2, rottenMeat: 1, bakedMeat: 1 };
  let r = food.applyFoodEffect(eater, inv, T.MEAT);
  assert.equal(r.ok, true, 'raw meat can be eaten');
  assert.equal(eater.hp, 62, 'raw meat adds some health');
  assert.equal(inv.meat, 1, 'raw meat is consumed from inventory');

  r = food.applyFoodEffect(eater, inv, T.BAKED_MEAT);
  assert.equal(r.ok, true, 'baked meat can be eaten');
  assert.equal(eater.hp, 97, 'baked meat adds much health');
  assert.equal(inv.bakedMeat, 0, 'baked meat is consumed from inventory');

  r = food.applyFoodEffect(eater, inv, T.ROTTEN_MEAT);
  assert.equal(r.ok, true, 'rotten meat can be eaten');
  assert.equal(eater.hp, 77, 'rotten meat removes health');
  assert.equal(inv.rottenMeat, 0, 'rotten meat is consumed from inventory');

  r = food.applyFoodEffect({ hp: 100, maxHp: 100 }, inv, T.MEAT);
  assert.equal(r.reason, 'full', 'healing food is not wasted at full HP');
  assert.equal(inv.meat, 1, 'full HP does not consume healing food');

  const doomed = { hp: 10, maxHp: 100 };
  const badInv = { rottenMeat: 1 };
  r = food.applyFoodEffect(doomed, badInv, T.ROTTEN_MEAT);
  assert.equal(doomed.hp, 0, 'rotten meat can reduce HP to zero');
  assert.equal(r.dead, true, 'rotten meat reports lethal damage');
}

let tiles = new Map();
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
  tiles = new Map();
  gasUnits = 0;
  meat.reset();
}
function advance(sec,player){
  while(sec>0){
    const step=Math.min(1,sec);
    meat.update(step,player||{x:0,y:8},getTile,setTile);
    sec-=step;
  }
}

clear();
setTile(0,9,T.GRASS);
setTile(0,8,T.MEAT);
meat.noteMeat(0,8,{age:0,gasT:99});
advance(59,{x:0,y:8});
assert.equal(getTile(0,8),T.MEAT,'fresh meat stays fresh before 60 seconds');
advance(1.2,{x:0,y:8});
assert.equal(getTile(0,8),T.ROTTEN_MEAT,'fresh meat rots after 60 seconds off snow');

clear();
setTile(2,9,T.SNOW);
setTile(2,8,T.MEAT);
meat.noteMeat(2,8,{age:0,gasT:99});
advance(120,{x:2,y:8});
assert.equal(getTile(2,8),T.MEAT,'meat resting on snow does not rot');

clear();
for(let x=8; x<=12; x++) setTile(x,12,T.STONE);
setTile(10,5,T.MEAT);
meat.noteMeat(10,5,{age:59,gasT:99});
meat.update(0.1,{x:10,y:5},getTile,setTile);
assert.equal(getTile(10,5),T.AIR,'unsupported meat leaves its old floating cell');
assert.equal(getTile(10,11),T.MEAT,'unsupported meat settles on the nearest floor');
advance(1,{x:10,y:11});
assert.equal(getTile(10,11),T.ROTTEN_MEAT,'falling preserves the meat spoilage timer');

clear();
setTile(19,12,T.STONE);
setTile(20,12,T.SNOW);
setTile(21,12,T.STONE);
setTile(20,5,T.MEAT);
meat.noteMeat(20,5,{age:0,gasT:99});
meat.update(0.1,{x:20,y:5},getTile,setTile);
assert.equal(getTile(20,11),T.MEAT,'unsupported meat can settle onto snow');
advance(120,{x:20,y:11});
assert.equal(getTile(20,11),T.MEAT,'meat that lands on snow still does not rot');

clear();
setTile(4,9,T.GRASS);
setTile(4,8,T.ROTTEN_MEAT);
meat.restore({v:1,list:[{x:4,y:8,age:60,gasT:0.01}]},getTile);
meat.update(0.1,{x:4,y:8},getTile,setTile);
assert.equal(gasUnits,1,'rotten meat emits exactly one green gas unit');
advance(9.9,{x:4,y:8});
assert.equal(gasUnits,1,'rotten meat waits ten seconds between gas units');
advance(0.1,{x:4,y:8});
assert.equal(gasUnits,2,'rotten meat emits the next single gas unit after ten seconds');

clear();
setTile(6,9,T.GRASS);
setTile(6,8,T.ROTTEN_MEAT);
meat.noteMeat(6,8,{age:60,rotAge:0,gasT:99});
advance(59,{x:6,y:8});
assert.equal(getTile(6,8),T.ROTTEN_MEAT,'rotten meat remains for almost one minute');
advance(1.2,{x:6,y:8});
assert.equal(getTile(6,8),T.AIR,'rotten meat vanishes after about one minute');
assert.equal(meat.snapshot().list.length,0,'vanished rotten meat is no longer tracked');

clear();
setTile(5,9,T.GRASS);
setTile(5,8,T.MEAT);
meat.noteMeat(5,8,{age:59.9,gasT:0.01});
advance(0.2,{x:5,y:8});
assert.equal(getTile(5,8),T.ROTTEN_MEAT,'meat rots without an immediate gas burst');
assert.equal(gasUnits,0,'freshly rotten meat does not emit gas before its ten-second timer');
advance(10,{x:5,y:8});
assert.equal(gasUnits,1,'freshly rotten meat emits one gas unit after ten seconds');

clear();
setTile(8,9,T.GRASS);
setTile(8,8,T.MEAT);
meat.noteMeat(8,8,{age:59.9,gasT:0.01});
assert.equal(fire.heatAround(8,7,getTile,setTile,{includeCenter:false}),1,'torch/fire heat bakes adjacent fresh meat');
assert.equal(getTile(8,8),T.BAKED_MEAT,'heated fresh meat becomes baked meat');
advance(180,{x:8,y:8});
assert.equal(getTile(8,8),T.BAKED_MEAT,'baked meat does not rot or vanish through the meat decay lifecycle');
assert.equal(meat.snapshot().list.length,0,'baked meat is removed from meat decay tracking');

clear();
setTile(7,11,T.GRASS);
assert.equal(meat.dropFromMob({x:7.4,y:10.2},getTile,setTile),true,'mob death can place meat on nearby ground');
assert.equal(getTile(7,10),T.MEAT,'dropped meat becomes a world block');

clear();
setTile(9,10,T.GRASS);
setTile(9,5,T.POISON_GAS);
assert.equal(meat.dropFromMob({x:9.2,y:5.4},getTile,setTile),true,'mob death can replace gas at the exact animal cell');
assert.equal(getTile(9,5),T.MEAT,'meat uses gas cells as open space instead of falling back elsewhere');

clear();
for(let x=28; x<=32; x++) setTile(x,80,T.STONE);
assert.equal(meat.dropFromMob({x:30.2,y:5.4},getTile,setTile),true,'mob death places meat at the killed animal cell when it is empty');
assert.equal(getTile(30,5),T.MEAT,'deep-air kill initially shows meat at the exact death spot');
meat.update(0.1,{x:30,y:5},getTile,setTile);
assert.equal(getTile(30,79),T.MEAT,'deep-water style drops settle above the bottom');

clear();
setTile(44,5,T.STONE);
setTile(44,7,T.GRASS);
assert.equal(meat.dropFromMob({x:44.3,y:5.2},getTile,setTile),true,'blocked death cells fall back to the nearest valid meat cell');
assert.equal(getTile(44,5),T.STONE,'blocked exact cell is not overwritten by meat');
assert.equal(meat.snapshot().list.length,1,'fallback drop is still tracked for decay');

clear();
setTile(1,6,T.GRASS);
setTile(1,5,T.MEAT);
assert.equal(meat.auditChunks([0],getTile),1,'save audit finds untracked meat in modified chunks');
assert.equal(meat.snapshot().list.length,1,'audited meat is included in the snapshot');
setTile(1,5,T.AIR);
assert.equal(meat.auditChunks([0],getTile),0,'save audit ignores removed meat');
assert.equal(meat.snapshot().list.length,0,'save audit prunes stale meat records');

clear();
setTile(40,6,T.GRASS);
setTile(40,5,T.MEAT);
meat.onTileChanged(40,5,T.AIR,T.MEAT);
advance(60.5,{x:40,y:5});
assert.equal(getTile(40,5),T.ROTTEN_MEAT,'tile-change hook registers fresh meat for decay');
setTile(40,5,T.AIR);
meat.onTileChanged(40,5,T.ROTTEN_MEAT,T.AIR);
assert.equal(meat.snapshot().list.length,0,'tile-change hook unregisters removed meat');

const { world } = await import('../src/engine/world.js');
meat.reset();
world.clear();
world.setTile(320,10,T.MEAT);
assert.ok(meat.snapshot().list.some(r=>r.x===320 && r.y===10),'world.setTile registers meat through the storage hook');
world.setTile(320,10,T.AIR);
assert.equal(meat.snapshot().list.length,0,'world.setTile removal clears the meat record');

const { mobs } = await import('../src/engine/mobs.js');
const originalDrop = MM.meat.dropFromMob;
let dropCalls = 0;
MM.meat.dropFromMob = ()=>{ dropCalls++; return true; };
globalThis.player = {xp:0};

function withRandom(value,fn){
  const oldRandom=Math.random;
  Math.random=()=>value;
  try{ return fn(); }
  finally{ Math.random=oldRandom; }
}
function killOne(id,x){
  mobs.deserialize({v:3,list:[{id,x,y:5,hp:1,state:'idle',facing:1,spawnT:1}],aggro:{mode:'rel',m:{}}});
  assert.equal(mobs.damageAt(x,5,99),true,'test '+id+' was hit');
}

withRandom(0.99,()=>killOne('BEAR',5));
assert.equal(dropCalls,1,'large animals such as bears always call the meat drop system');

withRandom(0.29,()=>killOne('RABBIT',8));
assert.equal(dropCalls,2,'small animals such as rabbits can drop meat on their lower roll');
withRandom(0.31,()=>killOne('RABBIT',11));
assert.equal(dropCalls,2,'small animals such as rabbits are not guaranteed meat');

withRandom(0.09,()=>killOne('SQUIRREL',14));
assert.equal(dropCalls,3,'squirrels can drop meat on their 10% roll');
withRandom(0.11,()=>killOne('SQUIRREL',17));
assert.equal(dropCalls,3,'squirrels do not drop meat above their 10% roll');

withRandom(0.09,()=>killOne('BAT',20));
assert.equal(dropCalls,4,'bats can drop meat on their 10% roll');
withRandom(0.11,()=>killOne('BAT',23));
assert.equal(dropCalls,4,'bats do not drop meat above their 10% roll');

withRandom(0,()=>killOne('FIREFLY',26));
assert.equal(dropCalls,4,'insects do not drop meat');

withRandom(0,()=>killOne('STRAZNIK',29));
assert.equal(dropCalls,4,'non-organic sentinels do not drop meat');

assert.equal(mobs.registerSpecies({id:'TEST_MEAT_EXPLICIT', hp:2, dmg:0, speed:1, wanderInterval:[1,1], ground:true, meatDropChance:0.2, spawnTest(){ return false; }}),true,'test species with explicit meat chance registered');
withRandom(0.19,()=>killOne('TEST_MEAT_EXPLICIT',32));
assert.equal(dropCalls,5,'explicit meatDropChance allows custom species drops');
withRandom(0.21,()=>killOne('TEST_MEAT_EXPLICIT',35));
assert.equal(dropCalls,5,'explicit meatDropChance is respected over inferred body size');

assert.equal(mobs.registerSpecies({id:'TEST_MEAT_LARGE', hp:30, dmg:0, speed:1, wanderInterval:[1,1], ground:true, body:{w:1.7,h:1.2}, spawnTest(){ return false; }}),true,'test large inferred meat species registered');
withRandom(0.99,()=>killOne('TEST_MEAT_LARGE',38));
assert.equal(dropCalls,6,'large unknown organic species infer guaranteed meat');

assert.equal(mobs.registerSpecies({id:'TEST_MEAT_TINY', hp:2, dmg:0, speed:1, wanderInterval:[1,1], ground:true, body:{w:0.4,h:0.35}, spawnTest(){ return false; }}),true,'test tiny inferred meat species registered');
withRandom(0.09,()=>killOne('TEST_MEAT_TINY',41));
assert.equal(dropCalls,7,'tiny unknown organic species can drop on their rare roll');
withRandom(0.11,()=>killOne('TEST_MEAT_TINY',44));
assert.equal(dropCalls,7,'tiny unknown organic species are not guaranteed meat');

MM.meat.dropFromMob = originalDrop;
console.log('meat-decay-sim: all assertions passed');
