// Hand-weapon crafting ladder + material identities (weapons.js MELEE_EFFECTS,
// mobs.js statuses) and the improvised fun weapons (sand → blind+stun without
// damage, regular saliva → wet, ult saliva → toxic):
//  1. weapons.js: spears charge and stab only along a three-tile horizontal lane,
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
const weaponsSource = readFileSync(new URL('../src/engine/weapons.js', import.meta.url), 'utf8');
assert.ok(weaponsSource.indexOf('function holdSpearCharge')>=0 && weaponsSource.indexOf('function holdSpearCharge')<weaponsSource.indexOf('function fireHeld'),
  'held-spear helper is declared directly before the runtime input path');
assert.doesNotMatch(weaponsSource,/\bupdateSpearCharge\b/,'fireHeld cannot retain the stale undefined spear helper reference');

// ---------------------------------------------------------------------------
// Part 1 — weapons.js with a stubbed MM.mobs (imported real mobs come later)
// ---------------------------------------------------------------------------
let tiles = new Map();
const getTile = (x,y)=>{ const v = tiles.get(x+','+y); return v===undefined ? T.AIR : v; };
const setTile = (x,y,v)=>{ tiles.set(x+','+y, v); };

const attackCalls=[], damageCalls=[], statusAtCalls=[], statusRadiusCalls=[], poisonCalls=[], wetCalls=[];
let nearestTarget=null;
MM.mobs = {
  attackAt(tx,ty,bonus,opts){ attackCalls.push({tx,ty,bonus,opts}); return true; },
  damageAt(tx,ty,dmg,opts){ damageCalls.push({tx,ty,dmg,opts}); return false; },
  statusAt(tx,ty,id,opts){ statusAtCalls.push({tx,ty,id,opts}); return true; },
  statusRadius(wx,wy,r,id,opts){ statusRadiusCalls.push({wx,wy,r,id,opts}); return 1; },
  poisonRadius(wx,wy,r,opts){ poisonCalls.push({wx,wy,r,opts}); return 1; },
  wetRadius(wx,wy,r,opts){ wetCalls.push({wx,wy,r,opts}); return 1; },
  nearestLiving(){ return nearestTarget; },
  igniteAt(){ return false; }
};
const discoveries=[];
MM.discovery = { note(id){ discoveries.push(id); return true; } };
const audioCalls=[];
MM.audio = { play(id){ audioCalls.push(id); } };

let equipped = null;
MM.inventory = { equippedItem:()=>equipped, TIER_COLORS:{} };
globalThis.inv = { sand:5, water:5 };
const player = { x:0.5, y:0.5, facing:1, atkCd:0 };
globalThis.player = player;

function coolDown(){ player.atkCd=0; weapons.update(1.0,getTile,setTile); }

// Selecting a throw technique must not conjure its projectile into the hand.
// Cover every current thrown kind so future rocks/grenades cannot regress alone.
function heldCtx(){
  const calls=[];
  return {calls,save(){calls.push('save');},restore(){calls.push('restore');},translate(){calls.push('translate');},rotate(){calls.push('rotate');},
    beginPath(){calls.push('beginPath');},closePath(){calls.push('closePath');},moveTo(){calls.push('moveTo');},lineTo(){calls.push('lineTo');},
    arc(){calls.push('arc');},fill(){calls.push('fill');},stroke(){calls.push('stroke');},fillRect(){calls.push('fillRect');}};
}
for(const [kind,spec] of Object.entries(weapons._debug.thrownKinds)){
  equipped={weaponType:'thrown',thrownKind:kind,name:'Test '+kind};
  globalThis.inv[spec.key]=0;
  const emptyCtx=heldCtx();
  weapons.drawHeld(emptyCtx,20,player);
  assert.equal(emptyCtx.calls.length,0,kind+' is not shown in the hand with zero ammo');
  globalThis.inv[spec.key]=1;
  const loadedCtx=heldCtx();
  weapons.drawHeld(loadedCtx,20,player);
  assert.ok(loadedCtx.calls.length>0,kind+' appears in the hand when one unit exists');
  delete globalThis.inv[spec.key];
}
globalThis.inv.sand=5;
globalThis.inv.water=5;

// --- spear: long horizontal lane, hold charge, release attack ----------------
equipped = { weaponType:'melee', attackDamage:3, fireRange:3, name:'Dzida' };
assert.equal(weapons._debug.meleeReach(equipped), 3, 'spear owns a three-tile reach');
assert.equal(weapons._debug.meleeReach({weaponType:'melee',fireRange:2,name:'Stara dzida'}),3,'legacy two-tile spears are upgraded at runtime');
assert.equal(weapons._debug.meleeReach({weaponType:'melee'}), 1, 'plain melee keeps the classic 1-tile arc');
for(let i=0;i<5;i++) weapons.fireHeld(player,5.5,-8.5,0.12);
const halfChargeCtx=heldCtx();
weapons.drawHeld(halfChargeCtx,20,player);
assert.equal(attackCalls.length, 0, 'holding a spear builds force instead of attacking immediately');
assert.ok(weapons._debug.spearChargeRatio()>0.45 && weapons._debug.spearChargeRatio()<0.55, 'half the hold time produces half spear charge');
for(let i=0;i<5;i++) weapons.fireHeld(player,5.5,-8.5,0.12);
const fullChargeCtx=heldCtx();
weapons.drawHeld(fullChargeCtx,20,player);
assert.equal(weapons.hudStatus().spearFull,true,'HUD exposes a fully charged spear');
assert.ok(fullChargeCtx.calls.length>halfChargeCtx.calls.length,'the held-spear animation gains visible energy as charge grows');
assert.equal(weapons.releaseHeld(player,5.5,-8.5),true,'releasing a charged spear performs the thrust');
assert.equal(attackCalls.length, 1, 'charged spear swing lands once on release');
assert.deepEqual([attackCalls[0].tx,attackCalls[0].ty],[3,0], 'upward cursor aim is snapped to the three-tile horizontal lane');
const fullChargeBonus=attackCalls[0].bonus;
assert.equal(weapons._debug.swing.form,'spear','spear attacks capture a stab animation instead of a generic slash');
assert.equal(audioCalls.at(-1),'spearThrust','spear stab has a short thrust sound');
const spearWorldFx=heldCtx();
weapons.draw(spearWorldFx,20,()=>true);
assert.equal(spearWorldFx.calls.filter(c=>c==='beginPath'||c==='stroke'||c==='fill').length,0,'spear no longer draws a detached white arrow on the target tile');
coolDown();

weapons.fireHeld(player,-5.5,9.5,0.02);
assert.equal(weapons.releaseHeld(player,-5.5,9.5),true,'a quick backward spear tap still attacks');
assert.deepEqual([attackCalls[1].tx,attackCalls[1].ty],[-3,0], 'backward spear attacks also stay perfectly horizontal');
assert.ok(fullChargeBonus>attackCalls[1].bonus+2,'a full hold deals substantially more damage than a quick tap');
coolDown();
equipped = { weaponType:'melee', attackDamage:3, name:'Patyk' };
weapons.fireHeld(player, 5.5, 0.5, 1/60);
assert.equal(attackCalls.length, 3, 'stick swing still lands immediately');
assert.equal(attackCalls[2].tx, 1, 'plain melee aim clamps to px+1');
coolDown();

// Weapon silhouettes drive genuinely different hero poses and impact reads.
assert.equal(weapons._debug.meleeVisualForm({name:'Topór metalowy'}),'axe','Polish axe names select the axe form');
const spearPull=weapons._debug.meleeAttackPose('spear',0.18,1);
const spearImpact=weapons._debug.meleeAttackPose('spear',0.52,1);
assert.equal(spearPull.style,'stab','spear uses the stab pose family');
assert.ok(spearImpact.forward>spearPull.forward+15,'spear pose drives a long straight extension');
assert.ok(Math.abs(spearImpact.angle-Math.PI*0.44)<0.2,'spear is held almost horizontally during the thrust');
const axeRaised=weapons._debug.meleeAttackPose('axe',0,1);
const axeFollow=weapons._debug.meleeAttackPose('axe',1,1);
assert.equal(axeRaised.style,'hack','axe uses the hack-and-slash pose family');
assert.ok(axeFollow.angle-axeRaised.angle>3,'axe travels through a broad overhead cutting arc');
equipped={weaponType:'melee',attackDamage:6,name:'Topór metalowy'};
weapons.notifyMeleeSwing(1,0,player);
assert.equal(weapons._debug.swing.form,'axe','axe attacks retain their heavy chop form for the full animation');
assert.equal(audioCalls.at(-1),'axeSwing','axe swing has a heavier cutting sound');
const axeGhostFx=weapons.ghostFxState();
assert.equal(axeGhostFx.sw[5],'axe','network FX snapshot carries the melee animation form');
weapons.reset();
weapons.ghostApplyFx(axeGhostFx);
assert.equal(weapons._debug.swing.form,'axe','network observers restore the same axe animation form');

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
assert.deepEqual(Object.keys(fx).sort(), ['bleed','panic','stun','sunder'], 'four material identities (metal bleed, stone stun, diamond panic, blunt sunder)');
assert.ok(fx.bleed.dps>0 && fx.stun.dps===0 && fx.panic.dps===0, 'only bleed carries a DoT');

// --- improvised throws: distinct utility, effects and projectile identity ---
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
const damageBeforeSand=damageCalls.length;
throwAtWall('sand','sand');
assert.ok(statusRadiusCalls.some(c=>c.id==='blind' && c.opts && c.opts.dur>0), 'sand splat blinds the area');
assert.ok(statusRadiusCalls.some(c=>c.id==='stun' && c.opts && c.opts.dur>=2), 'sand splat shocks/stuns for a few seconds');
assert.equal(damageCalls.length,damageBeforeSand,'sand never enters a creature damage handler');
assert.ok(discoveries.includes('sand_blind'), 'first blind unlocks the discovery');

// It also detects a creature in flight without calling damageAt merely to probe.
statusRadiusCalls.length=0;
tiles=new Map();
nearestTarget={x:1.5,y:0.5,hp:10};
equipped={weaponType:'thrown',thrownKind:'sand',attackDamage:99,fireCooldown:0.4,name:'Piasek'};
const damageBeforeContact=damageCalls.length;
assert.equal(weapons.fireHeld(player,3.5,0.5,1/60),true,'sand can be thrown at a creature');
const contactSand=weapons._debug.arrows.at(-1);
assert.equal(contactSand.dmg,0,'even an artificially huge weapon stat cannot give sand damage');
assert.ok(contactSand.sandSpray && contactSand.noDamage,'the flight carries fine-sand and no-damage metadata');
assert.ok(Number.isInteger(contactSand.sandSeed) && contactSand.sandSeed>0,'each sand throw carries a stable visual seed');
const sandPatternA=weapons._debug.sandVisualPattern(contactSand.sandSeed);
const sandPatternB=weapons._debug.sandVisualPattern((contactSand.sandSeed+1)>>>0);
assert.ok(sandPatternA.count>=10 && sandPatternA.count<=20,'a sand pattern varies its bounded grain count');
assert.ok(sandPatternA.spread>=0.18 && sandPatternA.spread<=0.42,'a sand pattern varies its bounded fan width');
assert.notDeepEqual(sandPatternA,sandPatternB,'different throw seeds produce different visible layouts');
weapons.update(0.05,getTile,setTile);
nearestTarget=null;
assert.equal(weapons.metrics().arrows,0,'sand splats as soon as it contacts the creature');
assert.equal(damageCalls.length,damageBeforeContact,'contact probing remains damage-free');
assert.ok(statusRadiusCalls.some(c=>c.id==='blind') && statusRadiusCalls.some(c=>c.id==='stun'),'contact applies both utility effects');
coolDown();

poisonCalls.length=0;
throwAtWall('spit','water');
assert.ok(wetCalls.length>=1, 'spit always soaks a little');
assert.equal(poisonCalls.length,0,'regular saliva is not randomly toxic');

// The ult is the toxic variant: every projectile is vivid green and poisons.
weapons.reset();
globalThis.inv.water=10;
tiles = new Map();
for(let y=-4;y<=4;y++) setTile(4,y,T.STONE);
equipped = { weaponType:'thrown', thrownKind:'spit', attackDamage:1, fireCooldown:0.4, name:'Plucie' };
assert.equal(weapons.fireUlt(player,3.5,0.5),true,'spit ult fires');
const toxicVolley=weapons._debug.arrows.filter(a=>a.spitDroplet);
assert.equal(toxicVolley.length,5,'full spit ult fans five droplets');
assert.ok(toxicVolley.every(a=>a.toxicSpit && a.specialAttack),'every ult droplet is toxic');
assert.ok(toxicVolley.every(a=>/^#55db63$/i.test(a.color)),'toxic saliva is visibly green');
for(let i=0;i<45;i++) weapons.update(0.05,getTile,setTile);
assert.ok(poisonCalls.some(c=>c.opts && c.opts.cause==='toxic_spit_ult'),'toxic ult saliva poisons on impact');
assert.ok(discoveries.includes('spit_toxic'),'first toxic ult unlocks the discovery');

const thrownKinds = weapons._debug.thrownKinds;
assert.equal(thrownKinds.sand.key, 'sand', 'sand throw is fuelled by raw sand');
assert.equal(thrownKinds.spit.key, 'water', 'spitting needs water in the inventory');
assert.equal(thrownKinds.sand.noDamage,true,'sand is explicitly damage-free');
assert.equal(thrownKinds.sand.visual,'sand','sand uses the fine-grain renderer');
assert.equal(thrownKinds.spit.visual,'spit','saliva uses the droplet renderer');
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
// spears trade free-angle aiming and damage for a long horizontal lane
for(const k of ['spearStone','spearMetal','spearDiamond']) assert.equal(ladder[k].reach, 3, k+' carries the 3-tile reach');
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
assert.equal(INV.getItem('spear').fireRange, 3, 'the builtin spear carries the 3-tile reach');
// labels cover exactly the identities weapons.js knows
assert.deepEqual(Object.keys(INV.MELEE_EFFECT_LABELS).sort(), Object.keys(fx).sort(), 'effect labels cover the weapons registry');

Math.random = realRandom;
console.log('melee-weapons-sim: all assertions passed');
