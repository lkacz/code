// Hand-weapon crafting ladder + material identities (weapons.js MELEE_EFFECTS,
// mobs.js statuses) and the improvised throws (sand → blind, water spit → toxic):
//  1. weapons.js: melee reach comes from fireRange (spears poke 2 tiles),
//     material effects roll on hit (metal=bleed, stone=stun, diamond=panic),
//     sand/spit thrown kinds spend the raw resource and splat their status.
//  2. mobs.js: the four new STATUS rows behave (bleed ticks damage, stun
//     immobilizes, panic makes the creature bolt away from the hero, blind
//     drops the per-frame aggro gate and is rinsed off by water).
//  3. main.js source shapes: the crafted ladder exists, every material carries
//     its identity, damage grows monotonically along each branch.
//  4. inventory.js: meleeEffect/fireRange survive the loot sanitizer on melee
//     weapons only; the two new throw techniques are builtin.
// Run: node tools/melee-weapons-sim.test.mjs
import { strict as assert } from 'assert';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.CustomEvent = class { constructor(type,opts){ this.type=type; this.detail=opts&&opts.detail; } };
globalThis.dispatchEvent = () => true;
let simNow = 0;
globalThis.performance = { now:()=>simNow };

const realRandom = Math.random;
let randomSeed = 0x600df00d;
Math.random = ()=>{
  randomSeed = (randomSeed * 1664525 + 1013904223) >>> 0;
  return randomSeed / 4294967296;
};

const { T } = await import('../src/constants.js');
const { weapons } = await import('../src/engine/weapons.js');
assert.ok(weapons, 'weapons module exports');

// ---------------------------------------------------------------------------
// Part 1 — weapons.js with a stubbed MM.mobs (imported real mobs come later)
// ---------------------------------------------------------------------------
let tiles = new Map();
const getTile = (x,y)=>{ const v = tiles.get(x+','+y); return v===undefined ? T.AIR : v; };
const setTile = (x,y,v)=>{ tiles.set(x+','+y, v); };

const attackCalls=[], statusAtCalls=[], statusRadiusCalls=[], poisonCalls=[], wetCalls=[];
MM.mobs = {
  attackAt(tx,ty,bonus,opts){ attackCalls.push({tx,ty,bonus,opts}); return true; },
  damageAt(){ return false; },
  statusAt(tx,ty,id,opts){ statusAtCalls.push({tx,ty,id,opts}); return true; },
  statusRadius(wx,wy,r,id,opts){ statusRadiusCalls.push({wx,wy,r,id,opts}); return 1; },
  poisonRadius(wx,wy,r,opts){ poisonCalls.push({wx,wy,r,opts}); return 1; },
  wetRadius(wx,wy,r,opts){ wetCalls.push({wx,wy,r,opts}); return 1; },
  igniteAt(){ return false; }
};
const discoveries=[];
MM.discovery = { note(id){ discoveries.push(id); return true; } };
MM.audio = { play(){} };

let equipped = null;
MM.inventory = { equippedItem:()=>equipped, TIER_COLORS:{} };
globalThis.inv = { sand:5, water:5 };
const player = { x:0.5, y:0.5, facing:1, atkCd:0 };
globalThis.player = player;

function coolDown(){ player.atkCd=0; weapons.update(1.0,getTile,setTile); }

// --- melee reach: fireRange:2 lets a spear strike the clamped 2-tile ring ---
equipped = { weaponType:'melee', attackDamage:3, fireRange:2, name:'Dzida' };
assert.equal(weapons._debug.meleeReach(equipped), 2, 'spear reach comes from fireRange');
assert.equal(weapons._debug.meleeReach({weaponType:'melee'}), 1, 'plain melee keeps the classic 1-tile arc');
weapons.fireHeld(player, 5.5, 0.5, 1/60);
assert.equal(attackCalls.length, 1, 'spear swing lands');
assert.equal(attackCalls[0].tx, 2, 'spear aim clamps to px+2');
coolDown();
equipped = { weaponType:'melee', attackDamage:3, name:'Patyk' };
weapons.fireHeld(player, 5.5, 0.5, 1/60);
assert.equal(attackCalls.length, 2, 'stick swing lands');
assert.equal(attackCalls[1].tx, 1, 'plain melee aim clamps to px+1');
coolDown();

// --- material identity procs its status on a landed melee hit ---
for(const [effect, forced, expectProc] of [
  ['bleed', 0.0, true],  ['bleed', 0.99, false],
  ['stun',  0.0, true],  ['panic', 0.0, true]
]){
  statusAtCalls.length = 0;
  equipped = { weaponType:'melee', attackDamage:5, meleeEffect:effect, name:'Test '+effect };
  Math.random = ()=>forced;
  weapons.fireHeld(player, 1.5, 0.5, 1/60);
  Math.random = ()=>{ randomSeed=(randomSeed*1664525+1013904223)>>>0; return randomSeed/4294967296; };
  if(expectProc){
    assert.equal(statusAtCalls.length, 1, effect+' procs on a low roll');
    assert.equal(statusAtCalls[0].id, effect, effect+' applies its own status');
    assert.equal(statusAtCalls[0].opts.source, 'hero', effect+' is attributed to the hero');
    assert.ok(discoveries.includes('melee_'+effect), effect+' unlocks its discovery note');
  } else {
    assert.equal(statusAtCalls.length, 0, effect+' stays a CHANCE, not a guarantee');
  }
  coolDown();
}
const fx = weapons._debug.meleeEffects;
assert.deepEqual(Object.keys(fx).sort(), ['bleed','panic','stun'], 'exactly three material identities');
assert.ok(fx.bleed.dps>0 && fx.stun.dps===0 && fx.panic.dps===0, 'only bleed carries a DoT');

// --- thrown sand: spends inv.sand, splats a blind cloud on the wall ---
function throwAtWall(kind, key){
  tiles = new Map();
  for(let y=-4;y<=4;y++) setTile(4,y,T.STONE); // wall the lobbed ball must hit
  equipped = { weaponType:'thrown', thrownKind:kind, attackDamage:1, fireCooldown:0.4, name:'Rzut '+kind };
  const before = globalThis.inv[key];
  assert.equal(weapons.fireHeld(player, 3.5, 0.5, 1/60), true, kind+' throw fires');
  assert.equal(globalThis.inv[key], before-1, kind+' throw spends one '+key);
  for(let i=0;i<40;i++) weapons.update(0.05,getTile,setTile);
  assert.equal(weapons.metrics().arrows, 0, kind+' ball burst on the wall');
  coolDown();
}
Math.random = ()=>0.0; // chance rolls always pass
throwAtWall('sand','sand');
assert.ok(statusRadiusCalls.some(c=>c.id==='blind' && c.opts && c.opts.dur>0), 'sand splat blinds the area');
assert.ok(discoveries.includes('sand_blind'), 'first blind unlocks the discovery');

throwAtWall('spit','water');
assert.ok(wetCalls.length>=1, 'spit always soaks a little');
assert.ok(poisonCalls.some(c=>c.opts && c.opts.cause==='toxic_spit'), 'a lucky spit turns out toxic');
assert.ok(discoveries.includes('spit_toxic'), 'first toxic spit unlocks the discovery');

poisonCalls.length = 0; statusRadiusCalls.length = 0;
Math.random = ()=>0.99; // chance rolls always fail
throwAtWall('sand','sand');
assert.equal(statusRadiusCalls.filter(c=>c.id==='blind').length, 0, 'sand blind is a chance, not a guarantee');
throwAtWall('spit','water');
assert.equal(poisonCalls.length, 0, 'toxic spit is a chance, not a guarantee');
Math.random = ()=>{ randomSeed=(randomSeed*1664525+1013904223)>>>0; return randomSeed/4294967296; };

const thrownKinds = weapons._debug.thrownKinds;
assert.equal(thrownKinds.sand.key, 'sand', 'sand throw is fuelled by raw sand');
assert.equal(thrownKinds.spit.key, 'water', 'spitting needs water in the inventory');
assert.ok(weapons.thrownInfo('sand') && weapons.thrownInfo('spit'), 'HUD readout covers the new throws');

// ---------------------------------------------------------------------------
// Part 2 — real mobs.js: the four new statuses behave
// ---------------------------------------------------------------------------
const { worldGen } = await import('../src/engine/worldgen.js');
await import('../src/engine/world.js');
const { mobs } = await import('../src/engine/mobs.js');
worldGen.worldSeed = 20260711;
worldGen.clearCaches();

let poolCells = new Set();
function mobGetTile(x,y){
  if(y<0 || y>140) return T.STONE;
  if(poolCells.has(x+','+y)) return T.WATER;
  if(y===30) return T.GRASS;
  if(y>30) return T.STONE;
  return T.AIR;
}
player.x=200; player.y=29; player.hp=100; player.maxHp=100; player.vx=0; player.vy=0; player.w=0.7; player.h=0.95;
globalThis.damageHero = ()=>true;
MM.background = { getCycleInfo(){ return {isDay:true,tDay:0.5,cycleT:0.25}; } };
MM.weapons = Object.assign(MM.weapons||{}, { addUltCharge(){} });

function spawnWolf(x){
  mobs.clearAll();
  mobs.freezeSpawns(100000);
  mobs.deserialize({
    v:4,
    list:[{id:'WOLF',x,y:29,vx:0,vy:0,hp:30,state:'idle',facing:1,scale:1,speedMul:1,jumpMul:1}],
    aggro:{mode:'rel',m:{}}
  });
  mobs.freezeSpawns(100000);
  return mobs.nearestLiving(x,29,4);
}
function step(n,dt=0.05){ for(let i=0;i<n;i++){ simNow+=dt*1000; mobs.update(dt,player,mobGetTile); } }

// --- bleed: a metal cut ticks damage over time ---
let w = spawnWolf(190);
assert.ok(w, 'wolf spawned');
assert.equal(mobs.statusAt(Math.floor(w.x),Math.floor(w.y),'bleed',{dur:4,dps:2,source:'hero',cause:'melee_bleed'}), true, 'statusAt lands bleed by tile');
const hpBeforeBleed = w.hp;
step(40); // 2s
assert.ok(w.hp < hpBeforeBleed - 2, 'bleed drains hp over time ('+hpBeforeBleed+' -> '+w.hp+')');

// --- stun: hard stop, then it wears off ---
w = spawnWolf(190);
mobs.applyStatus(w,'stun',{dur:1.1,source:'hero',cause:'melee_stun'});
w.vx = 4;
step(1);
assert.equal(w.vx, 0, 'a stunned mob cannot walk');
step(40); // >1.1s
assert.equal(mobs.hasStatus(w,'stun'), false, 'stun wears off');

// --- panic: the creature bolts AWAY from the hero ---
w = spawnWolf(196); // left of the player at x=200
mobs.applyStatus(w,'panic',{dur:3,source:'hero',cause:'melee_panic'});
const panicStartX = w.x;
step(20); // 1s of fleeing
assert.ok(w.x < panicStartX - 0.8, 'a panicked mob runs away from the hero ('+panicStartX.toFixed(2)+' -> '+w.x.toFixed(2)+')');
assert.ok(w.vx < 0, 'flee velocity points away from the hero');

// --- blind: the aggro gate drops, so the wolf stops closing in ---
mobs.setAggro('WOLF');
w = spawnWolf(193);
step(30); // 1.5s of pursuit
const sightedGain = w.x - 193;
w = spawnWolf(193);
mobs.applyStatus(w,'blind',{dur:30,source:'hero',cause:'sand_blind'});
step(30);
const blindGain = w.x - 193;
assert.ok(sightedGain > 0.5, 'sanity: an aggro wolf closes on the hero (moved '+sightedGain.toFixed(2)+')');
assert.ok(blindGain < sightedGain - 0.5, 'a blinded wolf loses the hero ('+blindGain.toFixed(2)+' vs '+sightedGain.toFixed(2)+')');

// --- blind is rinsed off by water ---
w = spawnWolf(190);
mobs.applyStatus(w,'blind',{dur:30});
poolCells = new Set();
for(let dx=-3;dx<=3;dx++) for(let dy=-1;dy<=2;dy++) poolCells.add((Math.floor(w.x)+dx)+','+(Math.floor(w.y)+dy));
step(4);
assert.equal(mobs.hasStatus(w,'blind'), false, 'water washes the sand out of the eyes');
poolCells = new Set();

// --- machines do not bleed or panic (organicOnly), but stun works on them ---
assert.equal(mobs.STATUS.bleed.organicOnly, true, 'bleed is organic-only');
assert.equal(mobs.STATUS.panic.organicOnly, true, 'panic is organic-only');
assert.equal(mobs.STATUS.blind.organicOnly, true, 'blind is organic-only');
assert.equal(mobs.STATUS.stun.organicOnly, false, 'stun concusses machines too');

// ---------------------------------------------------------------------------
// Part 3 — main.js source shapes: the crafted hand-weapon ladder
// ---------------------------------------------------------------------------
const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const recipesBlock = mainSrc.slice(mainSrc.indexOf('const RECIPES=['), mainSrc.indexOf('const CRAFT_GROUPS='));
function recipeShape(id){
  const m = recipesBlock.match(new RegExp("\\{id:'"+id+"'[\\s\\S]*?\\}\\)?\\s*;?\\s*\\}\\},"));
  assert.ok(m, 'recipe '+id+' exists in RECIPES');
  const body = m[0];
  const dmg = body.match(/attackDamage:(\d+)/);
  return {
    body,
    dmg: dmg ? Number(dmg[1]) : null,
    effect: (body.match(/meleeEffect:'(\w+)'/)||[])[1] || null,
    reach: (body.match(/fireRange:(\d+)/)||[])[1] ? Number(body.match(/fireRange:(\d+)/)[1]) : null
  };
}
const ladder = {
  stick: recipeShape('stick_weapon'),
  club: recipeShape('club_wood'),
  axeStone: recipeShape('axe_stone'),
  axeMetal: recipeShape('axe_metal'),
  axeDiamond: recipeShape('axe_diamond'),
  spearStone: recipeShape('spear_stone'),
  spearMetal: recipeShape('spear_metal'),
  spearDiamond: recipeShape('spear_diamond'),
  swordSteel: recipeShape('sword_steel'),
  swordDiamond: recipeShape('sword_diamond'),
  swordIridium: recipeShape('sword_iridium')
};
// material = identity, everywhere the same
assert.equal(ladder.stick.effect, null, 'wood is plain');
assert.equal(ladder.club.effect, null, 'club is plain wood mass');
for(const k of ['axeStone','spearStone']) assert.equal(ladder[k].effect, 'stun', k+' stuns (stone)');
for(const k of ['axeMetal','spearMetal','swordSteel','swordIridium']) assert.equal(ladder[k].effect, 'bleed', k+' bleeds (metal)');
for(const k of ['axeDiamond','spearDiamond','swordDiamond']) assert.equal(ladder[k].effect, 'panic', k+' panics (diamond)');
// spears trade damage for reach
for(const k of ['spearStone','spearMetal','spearDiamond']) assert.equal(ladder[k].reach, 2, k+' carries the 2-tile reach');
for(const k of ['stick','club','axeStone','axeMetal','axeDiamond','swordSteel','swordDiamond','swordIridium']) assert.equal(ladder[k].reach, null, k+' keeps the 1-tile arc');
// the ladder climbs: each branch strictly grows, swords crown their material
assert.ok(ladder.stick.dmg < ladder.club.dmg, 'club beats the bare stick');
assert.ok(ladder.club.dmg < ladder.axeStone.dmg && ladder.axeStone.dmg < ladder.axeMetal.dmg, 'axes climb wood -> stone -> metal');
assert.ok(ladder.axeMetal.dmg < ladder.axeDiamond.dmg, 'diamond axe crowns the axes');
assert.ok(ladder.spearStone.dmg < ladder.spearMetal.dmg && ladder.spearMetal.dmg < ladder.spearDiamond.dmg, 'spears climb by material');
assert.ok(ladder.spearStone.dmg < ladder.axeStone.dmg, 'a spear pays for its reach with damage');
assert.ok(ladder.swordSteel.dmg < ladder.swordDiamond.dmg && ladder.swordDiamond.dmg < ladder.swordIridium.dmg, 'swords climb steel -> diamond -> iridium');
assert.ok(ladder.swordSteel.dmg > ladder.axeMetal.dmg, 'a sword crowns its material over the axe');

// ---------------------------------------------------------------------------
// Part 4 — inventory.js: sanitizer keeps the identity on melee only
// ---------------------------------------------------------------------------
globalThis.localStorage = {
  _m:new Map(),
  getItem(k){ return this._m.has(k)?this._m.get(k):null; },
  setItem(k,v){ this._m.set(k,String(v)); },
  removeItem(k){ this._m.delete(k); }
};
const { inventory: INV } = await import('../src/inventory.js');
assert.ok(INV, 'inventory module exports');
assert.equal(INV.grantItem({id:'test_spear_bleed', kind:'weapon', weaponType:'melee', name:'Dzida testowa', attackDamage:5, fireRange:2, meleeEffect:'bleed', tier:'rare'}), true, 'crafted spear grants');
const spear = INV.getItem('test_spear_bleed');
assert.equal(spear.meleeEffect, 'bleed', 'meleeEffect survives the loot sanitizer');
assert.equal(spear.fireRange, 2, 'melee reach survives the loot sanitizer');
assert.ok(INV.statChips(spear).some(c=>c.label==='Efekt' && /Krwawienie/.test(c.text)), 'the effect shows as a stat chip');
INV.grantItem({id:'test_bogus_effect', kind:'weapon', weaponType:'melee', name:'X', attackDamage:2, meleeEffect:'summonDragon'});
assert.equal(INV.getItem('test_bogus_effect').meleeEffect, undefined, 'unknown effects are dropped on ingest');
INV.grantItem({id:'test_bow_effect', kind:'weapon', weaponType:'bow', name:'Y', attackDamage:3, fireCooldown:0.5, meleeEffect:'bleed'});
assert.equal(INV.getItem('test_bow_effect').meleeEffect, undefined, 'a bow cannot smuggle a melee identity');
// the improvised throws are always-known builtin techniques
assert.equal(INV.getItem('throw_sand').thrownKind, 'sand', 'sand throw is builtin');
assert.equal(INV.getItem('throw_spit').thrownKind, 'spit', 'spit throw is builtin');
assert.equal(INV.getItem('spear').fireRange, 2, 'the builtin spear carries the 2-tile reach');
// labels cover exactly the identities weapons.js knows
assert.deepEqual(Object.keys(INV.MELEE_EFFECT_LABELS).sort(), Object.keys(fx).sort(), 'effect labels cover the weapons registry');

Math.random = realRandom;
console.log('melee-weapons-sim: all assertions passed');
