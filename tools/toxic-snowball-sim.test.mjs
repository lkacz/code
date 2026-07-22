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

// Impact metadata must distinguish actual snow from the older broad `snowball`
// shape flag shared by every round thrown projectile.
const trueSnowOpts=weapons._debug.projectileImpactOpts({snowball:true,thrown:true,splat:'snow'});
assert.equal(trueSnowOpts.element,'ice','plain snow carries the ice element');
assert.equal(trueSnowOpts.snowball,true,'plain snow is marked as the Guardian secret weapon');
const toxicSnowOpts=weapons._debug.projectileImpactOpts({snowball:true,splat:'toxic',tier:'toxicSnowball'});
assert.equal(toxicSnowOpts.element,'ice','toxic bow snowballs still carry ice metadata');
assert.equal(toxicSnowOpts.cause,'toxic_snowball','toxic snow preserves its status cause');
const balloonOpts=weapons._debug.projectileImpactOpts({snowball:true,thrown:true,splat:'wet'});
assert.equal(balloonOpts.element,'water','water balloons are classified as water, not ice');
assert.equal(balloonOpts.snowball,false,'water balloons cannot exploit snowball-only weaknesses');
assert.equal(balloonOpts.kind,'thrown','water balloons retain their thrown-weapon identity');
const spitOpts=weapons._debug.projectileImpactOpts({thrown:true,splat:'spit'});
assert.equal(spitOpts.element,'water','spitting carries water metadata into Guardian combat');
assert.equal(spitOpts.spit,true,'spitting retains its distinct second-best coolant identity');
assert.equal(spitOpts.cause,'spit','spitting carries an explicit impact cause');
for(const [splat,cause] of [['gascloud','gas_grenade'],['bomb','sticky_bomb']]){
  const opts=weapons._debug.projectileImpactOpts({snowball:true,thrown:true,splat});
  assert.equal(opts.element,undefined,splat+' carries no fabricated ice element');
  assert.equal(opts.snowball,false,splat+' is not marked as a true snowball');
  assert.equal(opts.cause,cause,splat+' preserves its own impact cause');
}
assert.equal(weapons._debug.projectileImpactOpts({fire:true,tier:'wood'}).element,'fire','burning arrows carry explicit fire metadata');

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
globalThis.inv={toxicSnowball:0, arrowWood:0, arrowStone:0, arrowObsidian:0, arrowDiamond:0, arrowIridium:0, snowball:0, throwingStone:0};
const recoveredArrowDrops=[];
MM.drops={
  spawnResource(x,y,res,qty,opts){ const d={x,y,res,qty,opts}; recoveredArrowDrops.push(d); return d; },
  showArrowCollect(){ return true; }
};

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

// --- material durability: weakest breaks most, strongest breaks least -------
const durability=Object.fromEntries(weapons._debug.arrowTiers.filter(t=>t.breakChance!=null).map(t=>[t.id,t.breakChance]));
assert.deepEqual(durability,{iridium:0.20,diamond:0.35,obsidian:0.50,stone:0.65,wood:0.80},
  'break chance descends evenly from wood (80%) to iridium (20%)');
for(const [tier,chance] of Object.entries(durability)){
  assert.equal(weapons._debug.arrowBreaksOnImpact({tier},chance-0.001),true,tier+' breaks below its threshold');
  assert.equal(weapons._debug.arrowBreaksOnImpact({tier},chance),false,tier+' survives at or above its threshold');
}

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
const wallSurviveRandom=Math.random;
Math.random=()=>0.99;
weapons.fireHeld({x:8.5,y:0.5,facing:1,atkCd:0}, 12.5, 0.5, 1/60);
assert.equal(weapons.releaseHeld({x:8.5,y:0.5,facing:1,atkCd:0}, 12.5, 0.5), true, 'wood arrow fires');
for(let i=0;i<60;i++) weapons.update(1/60,getTile,setTile);
Math.random=wallSurviveRandom;
assert.ok(weapons._debug.arrows.some(a=>a.stuck), 'a real arrow sticks in the wall (snowball splat is special)');

// The same weak shaft breaks on a low roll and leaves visible pieces.
resetScenario();
weapons.setArrowPref('wood');
inv.arrowWood=1;
const wallBreakRandom=Math.random;
Math.random=()=>0;
weapons.fireHeld({x:8.5,y:0.5,facing:1,atkCd:0}, 12.5, 0.5, 1/60);
assert.equal(weapons.releaseHeld({x:8.5,y:0.5,facing:1,atkCd:0}, 12.5, 0.5), true, 'break-test wood arrow fires');
for(let i=0;i<60 && weapons.metrics().arrowFragments===0;i++) weapons.update(1/60,getTile,setTile);
Math.random=wallBreakRandom;
assert.equal(weapons.metrics().arrows,0,'a broken impact arrow is not recoverable');
assert.ok(weapons.metrics().arrowFragments>=4,'breaking an arrow produces visible shaft, head, and fletching pieces');

// --- creature impact: the exact mob carries the arrow until death, then the
// matching ammo material falls back into the world as a pickup ---
resetScenario();
weapons.setArrowPref('obsidian');
inv.arrowObsidian=1;
const embeddedMob={x:7.5,y:0.5,vx:0,vy:0,hp:20};
const corpseArrowDrops=[];
const oldDrops=MM.drops;
MM.drops={
  spawnResource(x,y,res,qty,opts){
    const d={x,y,res,qty,opts}; corpseArrowDrops.push(d); return d;
  }
};
MM.mobs.damageAt=(tx,ty,dmg,opts)=>{
  if(tx!==Math.floor(embeddedMob.x) || ty!==Math.floor(embeddedMob.y)) return false;
  if(opts && typeof opts.onTarget==='function') opts.onTarget(embeddedMob);
  return true;
};
MM.mobs.isLiving=(m)=>m===embeddedMob && m.hp>0;
const embeddedSurviveRandom=Math.random;
Math.random=()=>0.99;
weapons.fireHeld({x:1.5,y:0.5,facing:1,atkCd:0}, embeddedMob.x, embeddedMob.y, 1/60);
assert.equal(weapons.releaseHeld({x:1.5,y:0.5,facing:1,atkCd:0}, embeddedMob.x, embeddedMob.y), true, 'obsidian arrow fires at the test mob');
for(let i=0;i<120 && !weapons._debug.arrows.some(a=>a.embeddedMob);i++) weapons.update(1/60,getTile,setTile);
let bodyArrow=weapons._debug.arrows.find(a=>a.embeddedMob);
assert.ok(bodyArrow && bodyArrow.embeddedMob===embeddedMob, 'arrow remains embedded in the exact mob it hit');
const offsetX=bodyArrow.x-embeddedMob.x, offsetY=bodyArrow.y-embeddedMob.y;
embeddedMob.x+=0.8; embeddedMob.y+=0.25;
weapons.update(1/60,getTile,setTile);
bodyArrow=weapons._debug.arrows.find(a=>a.embeddedMob);
assert.ok(bodyArrow, 'living mob still carries its arrow');
assert.ok(Math.abs(bodyArrow.x-(embeddedMob.x+offsetX))<1e-9 && Math.abs(bodyArrow.y-(embeddedMob.y+offsetY))<1e-9, 'embedded arrow follows the moving mob body');
embeddedMob.hp=0;
weapons.update(1/60,getTile,setTile);
bodyArrow=weapons._debug.arrows[0];
assert.ok(bodyArrow && !bodyArrow.embeddedMob && bodyArrow.dropOnLand, 'mob death releases the embedded arrow into falling motion');
for(let i=0;i<300 && corpseArrowDrops.length===0;i++) weapons.update(1/60,getTile,setTile);
assert.equal(corpseArrowDrops.length,1, 'released arrow lands as one physical pickup');
assert.equal(corpseArrowDrops[0].res,'arrowObsidian', 'corpse arrow preserves its ammunition material');
assert.equal(corpseArrowDrops[0].qty,1, 'corpse arrow drop contains one arrow');
assert.equal(weapons.metrics().arrows,0, 'landed corpse arrow leaves the projectile simulation');
Math.random=embeddedSurviveRandom;
MM.drops=oldDrops;
delete MM.mobs.isLiving;
MM.mobs.damageAt=(tx,ty,dmg,opts)=>{
  if(!mobAt || tx!==mobAt.x || ty!==mobAt.y) return false;
  calls.damage.push({tx,ty,dmg,tier:opts && opts.tier});
  return true;
};

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
const diamondSurviveRandom=Math.random;
Math.random=()=>0.99;
weapons.fireHeld({x:1.5,y:0.5,facing:1,atkCd:0}, 9.5, 0.5, 1/60);
assert.equal(weapons.releaseHeld({x:1.5,y:0.5,facing:1,atkCd:0}, 9.5, 0.5), true, 'diamond arrow fires');
for(let i=0;i<200 && weapons.metrics().arrows>0;i++) weapons.update(1/60,getTile,setTile);
Math.random=diamondSurviveRandom;
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

// --- every surviving material can be recovered by walking over it ---
resetScenario();
weapons.setArrowPref('obsidian');
inv.arrowObsidian=1;
globalThis.player={x:8.5,y:0.5,facing:1,atkCd:0,w:0.7,h:0.95};
const oldRnd=Math.random;
Math.random=()=>0.99; // force the impact-survival roll
try{
  weapons.fireHeld(player, 12.5, 0.5, 1/60);
  assert.equal(weapons.releaseHeld(player, 12.5, 0.5), true, 'obsidian arrow fires');
  assert.equal(inv.arrowObsidian, 0, 'the quiver is empty');
  for(let i=0;i<60 && !weapons._debug.arrows.some(a=>a.stuck);i++) weapons.update(1/60,getTile,setTile);
  const stuckArrow=weapons._debug.arrows.find(a=>a.stuck);
  assert.ok(stuckArrow && stuckArrow.recoverable, 'a surviving non-wood arrow is recoverable');
  player.x=stuckArrow.x; player.y=stuckArrow.y; // walk over it
  weapons.update(1/60,getTile,setTile);
  assert.equal(inv.arrowObsidian, 1, 'walking over the stuck arrow takes its exact material back');
} finally {
  Math.random=oldRnd;
  delete globalThis.player;
}

// --- timed-out arrows tumble down, then break apart instead of vanishing ---
resetScenario();
weapons._debug.arrows.push({x:2.5,y:0.4,vx:8,vy:-1,dmg:1,life:0.01,stuck:false,stuckT:4,travel:0,maxTravel:10,
  tier:'diamond',color:'#48f1ff',headColor:'#dffcff'});
weapons.update(0.02,getTile,setTile);
assert.ok(weapons._debug.arrows[0] && weapons._debug.arrows[0].expiring,'expiry first changes the arrow into a falling tumble');
for(let i=0;i<90 && weapons.metrics().arrowFragments===0;i++) weapons.update(1/60,getTile,setTile);
assert.equal(weapons.metrics().arrows,0,'the expired arrow leaves only after its fall finishes');
assert.ok(weapons._debug.arrowFragments.some(f=>String(f.cause).startsWith('expiry_')),'expiry ends in a visible break-apart effect');

// Capacity pressure also resolves visibly instead of silently shifting the
// oldest recoverable arrow out of the projectile array.
resetScenario();
for(let i=0;i<65;i++) weapons._debug.pushArrow({
  x:i*0.05,y:0.5,vx:1,vy:0,dmg:1,life:5,stuck:false,travel:0,maxTravel:5,
  tier:'wood',color:'#caa472',headColor:'#dfe6f1'
});
assert.equal(weapons.metrics().arrows,64,'moving-arrow capacity remains bounded');
assert.ok(weapons._debug.arrowFragments.some(f=>f.cause==='capacity'),'capacity eviction breaks the old arrow into visible pieces');

// An extreme crowd can carry many embedded arrows at once. Capacity pressure
// must reject the incoming shaft, never erase one from a still-living body.
resetScenario();
const carried=[];
for(let i=0;i<128;i++){
  const mob={x:i,y:0.5,hp:10};
  const arrow={x:i,y:0.5,vx:0,vy:0,dmg:1,life:5,stuck:true,stuckT:Infinity,
    embeddedMob:mob,tier:'wood',color:'#caa472',headColor:'#dfe6f1'};
  carried.push(arrow);
  assert.equal(weapons._debug.pushArrow(arrow),arrow,'embedded setup arrow is retained');
}
const rejected=weapons._debug.pushArrow({x:0,y:0.5,vx:1,vy:0,dmg:1,life:5,tier:'wood',color:'#caa472',headColor:'#dfe6f1'});
assert.equal(rejected,null,'incoming arrow is rejected when every retained arrow belongs to a living mob');
assert.equal(weapons.metrics().arrows,128,'embedded-arrow entity cap remains bounded');
assert.ok(carried.every(a=>weapons._debug.arrows.includes(a)),'no living mob loses its embedded arrow to capacity eviction');
assert.ok(weapons._debug.arrowFragments.some(f=>f.cause==='capacity'),'the rejected incoming arrow breaks visibly');

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
