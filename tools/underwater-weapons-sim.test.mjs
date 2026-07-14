// Underwater weapon identities and deep-water penalties:
// - ordinary swords/bows lose force as the whole hero becomes submerged,
// - trident, underwater crossbow and harpoon launcher invert that curve,
// - aquatic projectiles carry their own gravity/drag/wind model,
// - harpoons use a distinct, recoverable ammo resource.
// Run: node tools/underwater-weapons-sim.test.mjs
import { strict as assert } from 'assert';
import { readFileSync } from 'node:fs';

globalThis.window=globalThis;
globalThis.MM={};
globalThis.CustomEvent=class { constructor(type,opts){ this.type=type; this.detail=opts&&opts.detail; } };
globalThis.dispatchEvent=()=>true;
globalThis.performance={now:()=>0};

const { T }=await import('../src/constants.js');
const { weapons }=await import('../src/engine/weapons.js');
assert.ok(weapons && weapons._debug,'weapons debug surface exists');

let underwater=false;
const getTile=()=>underwater?T.WATER:T.AIR;
const setTile=()=>{};
const player={x:5.5,y:5.5,w:0.7,h:0.95,facing:1,atkCd:0};
globalThis.player=player;
globalThis.inv={arrowWood:40,harpoonBolt:20};
let equipped=null;
MM.inventory={equippedItem:()=>equipped,TIER_COLORS:{}};
MM.activeModifiers={attackDamage:7};
MM.audio={play(){}};
MM.mobs={attackAt(){return false;},damageAt(){return false;}};

function reset(water){
  weapons.reset();
  underwater=water;
  player.atkCd=0;
  weapons.update(0,getTile,setTile); // installs the tile accessor even with dt=0
}
function profile(fn,item,water){ reset(water); return weapons._debug[fn](item,player); }

const sword={weaponType:'melee',attackDamage:7};
const spear={weaponType:'melee',attackDamage:5,fireRange:2};
const trident={weaponType:'melee',aquaticStyle:'trident',attackDamage:7,fireRange:3};
const swordLand=profile('meleeWaterProfile',sword,false);
const swordWater=profile('meleeWaterProfile',sword,true);
const spearWater=profile('meleeWaterProfile',spear,true);
const tridentLand=profile('meleeWaterProfile',trident,false);
const tridentWater=profile('meleeWaterProfile',trident,true);
assert.equal(swordLand.submersion,0,'dry hero reads as dry');
assert.equal(swordWater.submersion,1,'fully flooded hero reads as fully submerged');
assert.ok(swordWater.damageMult<=0.5 && swordWater.cooldownMult>=1.8,'ordinary sword is weak and slow underwater');
assert.ok(spearWater.damageMult>swordWater.damageMult,'a thrusting spear suffers less than a swinging sword');
assert.ok(tridentWater.damageMult>1.4 && tridentWater.cooldownMult<0.7,'trident gains force and speed underwater');
assert.ok(tridentLand.damageMult<0.7 && tridentLand.cooldownMult>1.3,'trident remains usable but awkward on land');
assert.equal(weapons._debug.meleeReach(trident),3,'trident has the intended three-tile thrust');

const bow={weaponType:'bow',attackDamage:8,fireCooldown:0.55};
const crossbow={id:'underwater_crossbow',weaponType:'bow',aquaticStyle:'crossbow',tier:'epic',attackDamage:7,fireCooldown:0.55};
const bowLand=profile('bowWaterProfile',bow,false);
const bowWater=profile('bowWaterProfile',bow,true);
const crossbowLand=profile('bowWaterProfile',crossbow,false);
const crossbowWater=profile('bowWaterProfile',crossbow,true);
assert.equal(bowLand.chargeSeconds,4,'ordinary bow surface timing stays unchanged');
assert.ok(bowWater.chargeSeconds>=7 && bowWater.speedMult<0.4 && bowWater.damageMult<0.5,'ordinary bow is heavily nerfed deep underwater');
assert.ok(crossbowWater.chargeSeconds<1 && crossbowWater.damageMult>1.3 && crossbowWater.gravityMult<0.2,'crossbow is tuned for underwater firing');
assert.ok(crossbowLand.damageMult<0.7 && crossbowLand.speedMult<0.75,'underwater crossbow is deliberately weaker on land');

function fireBow(item,water){
  reset(water); equipped=item;
  const ammo=globalThis.inv.arrowWood;
  assert.equal(weapons.fireHeld(player,12.5,5.5,0.10),true,'bow begins drawing');
  assert.equal(weapons.releaseHeld(player,12.5,5.5),true,'bow releases');
  assert.equal(globalThis.inv.arrowWood,ammo-1,'shot consumes one normal arrow');
  return weapons._debug.arrows.at(-1);
}
const normalLandArrow=fireBow(bow,false);
const normalWaterArrow=fireBow(bow,true);
const crossbowLandArrow=fireBow(crossbow,false);
const crossbowWaterArrow=fireBow(crossbow,true);
assert.ok(normalWaterArrow.dmg<normalLandArrow.dmg && Math.abs(normalWaterArrow.vx)<Math.abs(normalLandArrow.vx)*0.45,'normal arrow loses damage and launch speed underwater');
assert.ok(crossbowWaterArrow.dmg>crossbowLandArrow.dmg && Math.abs(crossbowWaterArrow.vx)>Math.abs(crossbowLandArrow.vx),'crossbow projectile is stronger and faster underwater');
assert.ok(crossbowWaterArrow.aquatic && crossbowWaterArrow.waterDrag>normalWaterArrow.waterDrag,'crossbow shaft keeps more momentum in water');
assert.equal(crossbowWaterArrow.weaponPrestige,3,'projectile inherits the underwater crossbow prestige');
assert.equal(crossbowWaterArrow.weaponMaterial,'aquatic','projectile carries the crossbow material identity');
const normalDragArrow=fireBow(bow,true);
const normalBeforeDrag=Math.abs(normalDragArrow.vx);
weapons.update(0.05,getTile,setTile);
assert.ok(Math.abs(normalDragArrow.vx)<normalBeforeDrag*0.94,'water simulation actually applies strong drag to a normal arrow');
const crossbowDragArrow=fireBow(crossbow,true);
const crossbowBeforeDrag=Math.abs(crossbowDragArrow.vx);
weapons.update(0.05,getTile,setTile);
assert.ok(Math.abs(crossbowDragArrow.vx)>crossbowBeforeDrag*0.96,'aquatic crossbow shaft retains momentum during the same water step');

const launcher={id:'harpoon_launcher',weaponType:'harpoon',aquaticStyle:'harpoon',tier:'epic',attackDamage:9,fireCooldown:0.68};
function fireHarpoon(water){
  reset(water); equipped=launcher;
  const ammo=globalThis.inv.harpoonBolt;
  assert.equal(weapons.fireHeld(player,12.5,5.5,1/60),true,'harpoon launcher fires immediately');
  assert.equal(globalThis.inv.harpoonBolt,ammo-1,'launcher consumes dedicated harpoon ammo');
  return weapons._debug.arrows.at(-1);
}
const harpoonLand=fireHarpoon(false);
const harpoonWater=fireHarpoon(true);
assert.ok(harpoonWater.dmg>harpoonLand.dmg*2 && Math.abs(harpoonWater.vx)>Math.abs(harpoonLand.vx)*1.5,'harpoon strongly prefers water over air');
assert.equal(harpoonWater.recoverKey,'harpoonBolt','surviving harpoon returns the correct resource');
assert.ok(harpoonWater.harpoon && harpoonWater.aquatic && harpoonWater.gravityMult<0.15,'harpoon uses aquatic ballistics');
assert.ok(harpoonWater.weaponPrestige===3 && harpoonWater.weaponMaterial==='aquatic','harpoon flight preserves the exceptional launcher identity');
assert.equal(harpoonWater.mobPierce,1,'fully submerged regular harpoon can pass through one target');
assert.equal(weapons._debug.arrowBreakChance(harpoonWater),0.12,'regular harpoon has a low but real break chance');
reset(false); equipped=launcher;
const harpoonLandLight=weapons.lightSource(player);
reset(true); equipped=launcher;
const harpoonWaterLight=weapons.lightSource(player);
assert.ok(!harpoonLandLight.underwater&&harpoonWaterLight.underwater,'weapon light detects whether the aquatic launcher is submerged');
assert.ok(harpoonWaterLight.level>harpoonLandLight.level&&harpoonWaterLight.radius>harpoonLandLight.radius,'water raises physical source strength and widens visible scattering');
reset(true); equipped=launcher;
assert.equal(weapons.fireUlt(player,12.5,5.5),true,'harpoon has a charged special shot');
const powerHarpoon=weapons._debug.arrows.at(-1);
assert.ok(powerHarpoon.power && powerHarpoon.specialAttack && powerHarpoon.mobPierce===2,'harpoon ult is a stronger multi-target penetrator');

// Craft/inventory integration is source-shaped because importing main.js starts
// the full browser game. These assertions prevent a working engine feature from
// becoming unobtainable or losing its identity during save sanitization.
const mainSrc=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const invSrc=readFileSync(new URL('../src/inventory.js',import.meta.url),'utf8');
for(const id of ['trident_steel','underwater_crossbow','harpoon_launcher','harpoon_bolts'])
  assert.ok(mainSrc.includes("id:'"+id+"'"),id+' crafting recipe exists');
assert.ok(mainSrc.includes("weaponType:'harpoon'") && mainSrc.includes("aquaticStyle:'crossbow'") && mainSrc.includes("aquaticStyle:'trident'"),'all three aquatic weapon identities are craftable');
assert.ok(invSrc.includes("key:'harpoonBolt'") && invSrc.includes("harpoon:['attackDamage','fireCooldown']"),'harpoon ammo and stat schema are registered');
assert.ok(invSrc.includes("'aquaticStyle'") && invSrc.includes("types:['bow','harpoon','thrown']"),'aquatic identity persists and launcher joins ranged shortcut');

console.log('underwater-weapons-sim: all assertions passed');
