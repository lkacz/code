// Toxic snowball regressions: bow ammo tier below wood (auto never wastes real
// arrows on utility ammo), snowballs splat on impact instead of sticking, and a
// hit applies BOTH poison (damage over time) and chill (hard slow) to the target.
import { strict as assert } from 'assert';

globalThis.window = globalThis;
globalThis.MM = {};

function makeCtx(){
  return {
    fillStyle:'', strokeStyle:'', lineWidth:1, globalAlpha:1,
    save(){}, restore(){}, fillRect(){}, drawImage(){}, beginPath(){}, moveTo(){},
    lineTo(){}, quadraticCurveTo(){}, closePath(){}, fill(){}, arc(){}, stroke(){},
    translate(){}, rotate(){},
    createLinearGradient(){ return {addColorStop(){}}; },
    createRadialGradient(){ return {addColorStop(){}}; },
    canvas:{width:800,height:600}
  };
}
globalThis.document = {
  createElement(){ return {width:0, height:0, getContext(){ return makeCtx(); }}; }
};

const { T } = await import('../src/constants.js');
const { weapons } = await import('../src/engine/weapons.js');
assert.ok(weapons, 'weapons module exports');

// flat world: solid floor at y=5, wall at x=12
const getTile=(x,y)=>{
  if(y>=5) return T.STONE;
  if(x>=12) return T.STONE;
  return T.AIR;
};
const setTile=()=>{};

const calls={damage:[], poisonR:[], chillR:[], poisonAt:[], chillAt:[]};
let mobAt=null; // {x,y}
MM.mobs={
  damageAt(tx,ty,dmg,opts){
    if(!mobAt || tx!==mobAt.x || ty!==mobAt.y) return false;
    calls.damage.push({tx,ty,dmg,tier:opts && opts.tier});
    return true;
  },
  igniteAt(){ return false; },
  poisonRadius(x,y,r,opts){ calls.poisonR.push({x,y,r,opts}); return 1; },
  chillRadius(x,y,r,opts){ calls.chillR.push({x,y,r,opts}); return 1; },
  poisonAt(tx,ty,opts){ calls.poisonAt.push({tx,ty,opts}); return true; },
  chillAt(tx,ty,opts){ calls.chillAt.push({tx,ty,opts}); return true; }
};
let equippedWeapon={weaponType:'bow', attackDamage:4, fireCooldown:0.3};
MM.inventory={
  equippedItem(){ return equippedWeapon; },
  TIER_COLORS:{}
};
globalThis.inv={toxicSnowball:0, arrowWood:0, snowball:0, throwingStone:0};

function resetScenario(){
  weapons.reset();
  calls.damage.length=0; calls.poisonR.length=0; calls.chillR.length=0;
  calls.poisonAt.length=0; calls.chillAt.length=0;
  mobAt=null;
}
function stepUntilNoArrows(maxSteps){
  for(let i=0;i<(maxSteps||300) && weapons.metrics().arrows>0;i++) weapons.update(1/60,getTile,setTile);
  return weapons.metrics().arrows;
}
function fireSnowballAt(player,tx,ty){
  weapons.fireHeld(player, tx, ty, 1/60); // start the bow charge
  assert.equal(weapons.releaseHeld(player, tx, ty), true, 'bow releases a snowball shot');
}

// --- ammo tier: registered, pinnable, and 'auto' prefers real arrows ---
inv.toxicSnowball=10; inv.arrowWood=5;
weapons.setArrowPref('auto');
let info=weapons.arrowInfo();
assert.ok(info.tiers.some(t=>t.id==='toxicSnowball'), 'toxic snowballs appear in the ammo tier list');
assert.equal(info.activeId, 'wood', "'auto' keeps firing real arrows while any are owned");
weapons.setArrowPref('toxicSnowball');
assert.equal(weapons.arrowInfo().activeId, 'toxicSnowball', 'the snowball tier can be pinned from the HUD');

// --- creature hit: consumes ammo, damages, and applies poison + chill ---
resetScenario();
weapons.setArrowPref('toxicSnowball');
inv.toxicSnowball=3; inv.arrowWood=0;
mobAt={x:7,y:0};
fireSnowballAt({x:1.5,y:0.5,facing:1,atkCd:0}, 7.5, 0.5);
assert.equal(inv.toxicSnowball, 2, 'firing consumed one snowball');
assert.equal(stepUntilNoArrows(), 0, 'the snowball resolved (no arrow left in flight)');
assert.equal(calls.damage.length, 1, 'the snowball damaged the creature it hit');
assert.equal(calls.damage[0].tier, 'toxicSnowball', 'the hit is tagged with the snowball tier');
assert.ok(calls.poisonR.length>=1, 'the splat poisons creatures in its small cloud');
assert.ok(calls.chillR.length>=1, 'the splat chills (slows) creatures in its small cloud');
assert.equal(calls.poisonR[0].opts.cause, 'toxic_snowball', 'poison is tagged with the snowball cause');
assert.ok(calls.poisonR[0].opts.dps>0, 'poison ticks damage over time');
assert.equal(calls.chillR[0].opts.cause, 'toxic_snowball', 'chill is tagged with the snowball cause');

// --- wall impact: snowballs splat, they never stick like arrows ---
resetScenario();
weapons.setArrowPref('toxicSnowball');
inv.toxicSnowball=3;
fireSnowballAt({x:8.5,y:0.5,facing:1,atkCd:0}, 12.5, 0.5);
assert.equal(stepUntilNoArrows(), 0, 'the snowball burst on the wall instead of sticking');
assert.ok(calls.poisonR.length>=1 && calls.chillR.length>=1, 'a wall splat still releases the status cloud');
assert.equal(calls.damage.length, 0, 'no creature was hit by the wall splat itself');

// --- comparison: a wood arrow DOES stick in the same wall ---
resetScenario();
weapons.setArrowPref('wood');
inv.arrowWood=3;
weapons.fireHeld({x:8.5,y:0.5,facing:1,atkCd:0}, 12.5, 0.5, 1/60);
assert.equal(weapons.releaseHeld({x:8.5,y:0.5,facing:1,atkCd:0}, 12.5, 0.5), true, 'wood arrow fires');
for(let i=0;i<60;i++) weapons.update(1/60,getTile,setTile);
assert.ok(weapons._debug.arrows.some(a=>a.stuck), 'a real arrow sticks in the wall (snowball splat is special)');

// ===================== hand-thrown projectiles (ranged-slot rotation) =====================

// --- thrown snowball: instant throw, wall splat gives a brief chill (no poison) ---
resetScenario();
equippedWeapon={weaponType:'thrown', thrownKind:'snowball', attackDamage:2, fireCooldown:0.38};
inv.snowball=3;
assert.ok(weapons.thrownInfo('snowball') && weapons.thrownInfo('snowball').count===3, 'thrownInfo exposes the ammo count for the HUD');
assert.equal(weapons.fireHeld({x:8.5,y:0.5,facing:1,atkCd:0}, 12.5, 0.5, 1/60), true, 'holding LPM throws a snowball instantly (no bow charge)');
assert.equal(inv.snowball, 2, 'the throw consumed one snowball');
assert.equal(weapons.fireHeld({x:8.5,y:0.5,facing:1,atkCd:0}, 12.5, 0.5, 1/60), false, 'the throw cooldown blocks an immediate second throw');
assert.equal(stepUntilNoArrows(), 0, 'the thrown snowball burst on the wall');
assert.ok(calls.chillR.length>=1, 'a plain snowball splat briefly chills (slows)');
assert.equal(calls.chillR[0].opts.cause, 'snowball_chill', 'plain snowball chill carries its own cause');
assert.equal(calls.poisonR.length, 0, 'a plain snowball never poisons');

// --- thrown stone: heavy direct hit, chip splat without any status cloud ---
resetScenario();
equippedWeapon={weaponType:'thrown', thrownKind:'stone', attackDamage:6, fireCooldown:0.6};
inv.throwingStone=2;
mobAt={x:7,y:0};
assert.equal(weapons.fireHeld({x:1.5,y:0.5,facing:1,atkCd:0}, 7.5, 0.5, 1/60), true, 'a stone can be thrown');
assert.equal(inv.throwingStone, 1, 'the throw consumed one stone');
assert.equal(stepUntilNoArrows(), 0, 'the stone resolved');
assert.equal(calls.damage.length, 1, 'the stone damaged the creature it hit');
assert.ok(calls.damage[0].dmg>=4, 'a stone hit carries real weight');
assert.equal(calls.poisonR.length, 0, 'stones carry no poison');
assert.equal(calls.chillR.length, 0, 'stones carry no chill');

// --- thrown toxic snowball reuses the toxic splat (poison + chill) ---
resetScenario();
equippedWeapon={weaponType:'thrown', thrownKind:'toxicSnowball', attackDamage:3, fireCooldown:0.42};
inv.toxicSnowball=2;
assert.equal(weapons.fireHeld({x:8.5,y:0.5,facing:1,atkCd:0}, 12.5, 0.5, 1/60), true, 'toxic snowballs can also be hand-thrown');
assert.equal(stepUntilNoArrows(), 0, 'the toxic throw resolved');
assert.ok(calls.poisonR.length>=1 && calls.chillR.length>=1, 'a hand-thrown toxic snowball splats poison + chill');

// --- ult volley: a full charge fans out several projectiles ---
resetScenario();
equippedWeapon={weaponType:'thrown', thrownKind:'snowball', attackDamage:2, fireCooldown:0.38};
inv.snowball=9;
assert.equal(weapons.fireUlt({x:1.5,y:0.5,facing:1,atkCd:0}, 9.5, 0.5), true, 'the thrown ult fires a volley');
assert.equal(inv.snowball, 4, 'a full-charge volley throws five snowballs');
assert.ok(weapons.metrics().arrows>=5, 'the volley is in flight at once');

// --- empty hands: no ammo, no throw, no ult ---
resetScenario();
equippedWeapon={weaponType:'thrown', thrownKind:'stone', attackDamage:6, fireCooldown:0.6};
inv.throwingStone=0;
assert.equal(weapons.fireHeld({x:1.5,y:0.5,facing:1,atkCd:0}, 7.5, 0.5, 1/60), false, 'no stones — no throw');
assert.equal(weapons.fireUlt({x:1.5,y:0.5,facing:1,atkCd:0}, 7.5, 0.5), false, 'no stones — the ult refuses before burning its charge');

// ===================== combo enablers: balloon, gas grenade, sticky bomb =====================

// --- water balloon: the splat soaks (wet), it never poisons ---
resetScenario();
calls.wetR=[];
MM.mobs.wetRadius=(x,y,r,opts)=>{ calls.wetR.push({x,y,r,opts}); return 1; };
MM.mobs.douseRadius=()=>0;
equippedWeapon={weaponType:'thrown', thrownKind:'waterBalloon', attackDamage:1, fireCooldown:0.45};
inv.waterBalloon=2;
assert.equal(weapons.fireHeld({x:8.5,y:0.5,facing:1,atkCd:0}, 12.5, 0.5, 1/60), true, 'a water balloon can be thrown');
assert.equal(stepUntilNoArrows(), 0, 'the balloon burst on the wall');
assert.ok(calls.wetR.length>=1, 'the burst soaks creatures around it (wet status)');
assert.equal(calls.poisonR.length, 0, 'water balloons carry no poison');

// --- gas grenade: releases a poison cloud where it lands ---
resetScenario();
equippedWeapon={weaponType:'thrown', thrownKind:'gasGrenade', attackDamage:1, fireCooldown:0.65};
inv.gasGrenade=2;
assert.equal(weapons.fireHeld({x:8.5,y:0.5,facing:1,atkCd:0}, 12.5, 0.5, 1/60), true, 'a gas grenade can be thrown');
assert.equal(stepUntilNoArrows(), 0, 'the grenade burst on the wall');
assert.ok(weapons.metrics().puffs>0, 'the burst released a poison cloud');

// --- sticky bomb: clings to the wall, then the fuse detonates it ---
resetScenario();
equippedWeapon={weaponType:'thrown', thrownKind:'stickyBomb', attackDamage:3, fireCooldown:0.75};
inv.stickyBomb=2;
assert.equal(weapons.fireHeld({x:8.5,y:0.5,facing:1,atkCd:0}, 12.5, 0.5, 1/60), true, 'a sticky bomb can be thrown');
for(let i=0;i<40 && !weapons._debug.arrows.some(a=>a.stuck);i++) weapons.update(1/60,getTile,setTile);
assert.ok(weapons._debug.arrows.some(a=>a.stuck && a.stickyFuse), 'the bomb clings to the wall instead of splatting');
let boomed=false;
const brokenTiles=new Set();
const mineSet=(x,y,t)=>{ if(t===T.AIR) brokenTiles.add(x+','+y); boomed=true; };
for(let i=0;i<140 && weapons.metrics().arrows>0;i++) weapons.update(1/60,getTile,mineSet);
assert.equal(weapons.metrics().arrows, 0, 'the fuse ran out');
assert.ok(boomed && brokenTiles.size>=1, 'the detonation carves a small crater ('+brokenTiles.size+' tiles)');

// ===================== arrow identities =====================

// --- diamond arrows overpenetrate: one shot damages several creatures ---
resetScenario();
equippedWeapon={weaponType:'bow', attackDamage:4, fireCooldown:0.3};
weapons.setArrowPref('diamond');
inv.arrowDiamond=3;
const mobLine=[{x:5,y:0},{x:7,y:0},{x:9,y:0}];
MM.mobs.damageAt=(tx,ty,dmg,opts)=>{
  const hit=mobLine.find(m=>m.x===tx && m.y===ty);
  if(!hit) return false;
  calls.damage.push({tx,ty,dmg,tier:opts && opts.tier});
  return true;
};
weapons.fireHeld({x:1.5,y:0.5,facing:1,atkCd:0}, 9.5, 0.5, 1/60);
assert.equal(weapons.releaseHeld({x:1.5,y:0.5,facing:1,atkCd:0}, 9.5, 0.5), true, 'diamond arrow fires');
for(let i=0;i<200 && weapons.metrics().arrows>0;i++) weapons.update(1/60,getTile,setTile);
assert.ok(calls.damage.length>=2, 'a diamond arrow pierces through into the next creature (hits: '+calls.damage.length+')');
assert.ok(calls.damage.length<=3, 'overpenetration is capped');
// restore the standard single-mob damage stub for the remaining scenarios
MM.mobs.damageAt=(tx,ty,dmg,opts)=>{
  if(!mobAt || tx!==mobAt.x || ty!==mobAt.y) return false;
  calls.damage.push({tx,ty,dmg,tier:opts && opts.tier});
  return true;
};

// --- stone arrows stagger the target (a hard chill tap) ---
resetScenario();
weapons.setArrowPref('stone');
inv.arrowStone=3;
mobAt={x:7,y:0};
fireSnowballAt({x:1.5,y:0.5,facing:1,atkCd:0}, 7.5, 0.5);
stepUntilNoArrows();
assert.ok(calls.chillAt.length>=1, 'a stone arrow briefly staggers its target');
assert.equal(calls.chillAt[0].opts.cause, 'stagger', 'the stagger is tagged');

// --- wood arrows can be recovered by walking over them ---
resetScenario();
weapons.setArrowPref('wood');
inv.arrowWood=1;
globalThis.player={x:8.5,y:0.5,facing:1,atkCd:0,w:0.7,h:0.95};
const oldRnd=Math.random;
Math.random=()=>0.1; // force the recover roll
try{
  weapons.fireHeld(player, 12.5, 0.5, 1/60);
  assert.equal(weapons.releaseHeld(player, 12.5, 0.5), true, 'wood arrow fires');
  assert.equal(inv.arrowWood, 0, 'the quiver is empty');
  for(let i=0;i<60 && !weapons._debug.arrows.some(a=>a.stuck);i++) weapons.update(1/60,getTile,setTile);
  const stuckArrow=weapons._debug.arrows.find(a=>a.stuck);
  assert.ok(stuckArrow && stuckArrow.recoverable, 'the stuck wood arrow is recoverable');
  player.x=stuckArrow.x; player.y=stuckArrow.y; // walk over it
  weapons.update(1/60,getTile,setTile);
  assert.equal(inv.arrowWood, 1, 'walking over the stuck arrow takes it back');
} finally {
  Math.random=oldRnd;
  delete globalThis.player;
}

// --- landed hits feed the ult charge ---
resetScenario();
weapons.setArrowPref('wood');
inv.arrowWood=3;
mobAt={x:7,y:0};
weapons.fireUlt({x:1.5,y:0.5,facing:1,atkCd:0}, 7.5, 0.5); // dump the ult to 0
const chargeBefore=weapons.metrics().ultCharge;
stepUntilNoArrows();
for(let i=0;i<30;i++) weapons.update(1/60,getTile,setTile); // let the bow cooldown clear
fireSnowballAt({x:1.5,y:0.5,facing:1,atkCd:0}, 7.5, 0.5);
stepUntilNoArrows();
assert.ok(weapons.metrics().ultCharge>chargeBefore+0.05, 'a landed hit feeds the ult beyond the passive trickle');

console.log('toxic-snowball-sim: all assertions passed');
