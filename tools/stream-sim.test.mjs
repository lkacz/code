// Deterministic Node test for the stream-weapon elemental interactions
// (no browser needed): sustained flame melts stone → LAVA and boils water → vapor,
// the hose quenches lava → OBSIDIAN, soaks sand → MUD and condenses water,
// gas pools and converts to flame over burning tiles, arrows catch fire,
// electric guns spend stored hero energy and fire a terrain-blocked beam.
// Run: node tools/stream-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis; // engine modules attach to window.MM
globalThis.MM = {};

const realRandom = Math.random;
let randomSeed = 0x5eed1234;
Math.random = ()=>{
  randomSeed = (randomSeed * 1664525 + 1013904223) >>> 0;
  return randomSeed / 4294967296;
};

const { T, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } = await import('../src/constants.js');
const { fire } = await import('../src/engine/fire.js');
const { weapons } = await import('../src/engine/weapons.js');
assert.ok(fire && weapons, 'modules export');

// Sparse strip world
let tiles;
const getTile = (x,y)=>{ const v=tiles.get(x+','+y); return v===undefined? T.AIR : v; };
const setTile = (x,y,v)=>{ tiles.set(x+','+y,v); };
function fill(x0,x1,y0,y1,t){ for(let x=x0;x<=x1;x++) for(let y=y0;y<=y1;y++) setTile(x,y,t); }
function count(t){ let n=0; for(const v of tiles.values()) if(v===t) n++; return n; }

let vaporInjected=0;
MM.clouds={ injectVapor:(x,m)=>{ vaporInjected+=m; } };
MM.water={ onTileChanged(){}, addSource:(x,y,g,s)=>{ s(x,y,T.WATER); } };
MM.fallingSolids={ onTileRemoved(){} };
let glassShards=0, sparks=0;
MM.particles={ spawnGlassShards(){ glassShards++; }, spawnSparks(){ sparks++; } };
let worldChanged=0;
globalThis.__mmMarkWorldChanged=()=>{ worldChanged++; };
let heroEnergy=0, electricDamage=0, beamSounds=0, electricTarget=null;
MM.heroEnergy={
  info(){ return {energy:heroEnergy, max:40}; },
  spend(n){
    if(heroEnergy+1e-6<n) return false;
    heroEnergy-=n;
    return true;
  }
};
MM.audio={ play(id){ if(id==='beam') beamSounds++; } };
MM.mobs={
  damageAt(x,y,dmg){
    if(electricTarget===x+','+y){
      electricDamage+=dmg;
      return true;
    }
    return false;
  }
};
let gasAdds=[];
MM.gases={
  add(kind,x,y,opts){
    gasAdds.push({kind, hasAccessors:!!(opts && typeof opts.getTile==='function' && typeof opts.setTile==='function')});
    return 1;
  },
  igniteAt(){ return false; },
  consumeRadius(){ return 0; }
};
const RESOURCE_SEED={
  water:1000, wood:1000, rottenMeat:1000,
  arrowWood:1000, arrowStone:0, arrowObsidian:0, arrowDiamond:0, arrowIridium:0
};
function refillResources(overrides={}){
  globalThis.inv=Object.assign({}, RESOURCE_SEED, overrides);
  return globalThis.inv;
}
refillResources();

const player={x:0.5, y:0.5, facing:1, atkCd:0};
const weaponItems={ flame:{weaponType:'flame', fireDps:6, fireRange:6.5},
                    hose:{weaponType:'hose', fireDps:2, fireRange:6},
                    gas:{weaponType:'gas', fireDps:5, fireRange:5.5},
                    electric:{weaponType:'electric', fireDps:12, fireRange:8, energyCost:10},
                    bow:{weaponType:'bow', attackDamage:3, fireCooldown:0.25} };
let equipped=null;
MM.inventory={ equippedItem:()=>equipped, TIER_COLORS:{} };
function drawBowFor(seconds, aimX=8, aimY=0.5){
  const total=Math.max(0, Number(seconds)||0);
  const step=1/60;
  let elapsed=0, ok=false;
  while(elapsed<total-1e-9){
    const dt=Math.min(step,total-elapsed);
    ok=weapons.fireHeld(player, aimX, aimY, dt) || ok;
    elapsed+=dt;
  }
  return ok;
}
function releaseBowAt(aimX=8, aimY=0.5){
  return weapons.releaseHeld(player, aimX, aimY);
}
function fireBowTap(aimX=8, aimY=0.5){
  const held=drawBowFor(1/60, aimX, aimY);
  return releaseBowAt(aimX, aimY) && held;
}

tiles=new Map(); weapons.reset(); fire.reset();
weapons.update(NaN,getTile,setTile);
weapons.update(-1,getTile,setTile);
fire.update(getTile,setTile,NaN);
assert.equal(weapons.metrics().puffs, 0, 'invalid stream ticks do not create or corrupt puffs');
assert.equal(weapons.metrics().arrows, 0, 'invalid stream ticks do not create or corrupt arrows');

function withHeroDamageProbe(fn){
  let damage=0, cause=null;
  const oldWindowPlayer=globalThis.player;
  const oldDamageHero=globalThis.damageHero;
  globalThis.player=player;
  globalThis.damageHero=(amount,opts)=>{ damage+=amount; cause=opts && opts.cause; return true; };
  try{
    fn(()=>({damage,cause}));
  } finally {
    if(oldWindowPlayer===undefined) delete globalThis.player; else globalThis.player=oldWindowPlayer;
    if(oldDamageHero===undefined) delete globalThis.damageHero; else globalThis.damageHero=oldDamageHero;
  }
}

withHeroDamageProbe(read=>{
  tiles=new Map(); weapons.reset(); fire.reset();
  sprayActive('flame', 6, 0.5, 0.35);
  assert.equal(read().damage,0,'normal forward flamethrower use does not burn the hero at the muzzle');
  sprayActive('flame', player.x, player.y, 0.35);
  assert.ok(read().damage>=2,'hero takes damage when standing in his own flame stream');
  assert.equal(read().cause,'flamethrower','self fire damage is reported as flamethrower damage');
});
withHeroDamageProbe(read=>{
  tiles=new Map(); weapons.reset(); fire.reset();
  sprayActive('hose', player.x, player.y, 0.35);
  sprayActive('gas', player.x, player.y, 0.35);
  assert.equal(read().damage,0,'hose and gas streams do not use the flamethrower self-damage rule');
});

tiles=new Map(); weapons.reset(); fire.reset(); glassShards=0;
setTile(4,0,T.GLASS);
equipped=weaponItems.bow;
fireBowTap(6, 0.5);
for(let i=0;i<30;i++) weapons.update(1/60, getTile, setTile);
assert.equal(getTile(4,0), T.AIR, 'arrow shatters fragile glass into air');
assert.equal(weapons.metrics().arrows, 0, 'arrow is consumed by shattering glass');
assert.ok(glassShards>=1, 'arrow impact spawns broken glass shards');

tiles=new Map(); weapons.reset(); fire.reset();
MM.wind={ speedAt(){ return 5; } };
equipped=weaponItems.bow;
fireBowTap(8, 0.5);
let arrow=weapons._debug.arrows[0];
const arrowVx0=arrow.vx;
weapons.update(0.5, getTile, setTile);
arrow=weapons._debug.arrows[0];
assert.ok(arrow && arrow.vx>arrowVx0, 'wind bends flying arrows without touching electric beams');
delete MM.wind;

tiles=new Map(); weapons.reset(); fire.reset();
refillResources({arrowWood:0, arrowStone:0, arrowObsidian:0, arrowDiamond:0, arrowIridium:0});
equipped=weaponItems.bow;
assert.equal(weapons.fireHeld(player, 6, 0.5, 1/60), false, 'bow refuses to fire without arrow ammo');
assert.equal(weapons.releaseHeld(player, 6, 0.5), false, 'no-ammo bow has no held shot to release');
assert.equal(weapons.metrics().arrows, 0, 'no-ammo bow creates no projectile');

tiles=new Map(); weapons.reset(); fire.reset();
refillResources({arrowWood:0, arrowStone:2});
equipped=weaponItems.bow;
assert.equal(fireBowTap(6, 0.5), true, 'bow fires with crafted stone arrows on release');
assert.equal(globalThis.inv.arrowStone, 1, 'bow shot consumes one arrow from the active tier');
arrow=weapons._debug.arrows[0];
assert.equal(arrow.tier, 'stone', 'bow projectile records the material tier');
assert.ok(arrow.dmg>weaponItems.bow.attackDamage, 'stone arrows hit harder than plain bow damage');

tiles=new Map(); weapons.reset(); fire.reset(); heroEnergy=20;
refillResources({arrowWood:2, arrowStone:0, arrowObsidian:0, arrowDiamond:0, arrowIridium:0});
equipped=weaponItems.bow;
assert.equal(drawBowFor(4, 8, 0.5), true, 'holding a bow for 4 seconds reaches full draw');
let charge=weapons.metrics().bowCharge;
assert.equal(charge.full, true, 'bow charge reports full capacity at 4 seconds');
assert.equal(weapons.metrics().arrows, 0, 'full draw does not fire until release');
assert.ok(heroEnergy>=19.99, 'bow does not spend energy before full draw');
assert.equal(releaseBowAt(8, 0.5), true, 'releasing a fully drawn bow fires');
arrow=weapons._debug.arrows[0];
assert.equal(arrow.dmg, weaponItems.bow.attackDamage*2, '4-second bow release doubles arrow damage');
assert.equal(arrow.fullDraw, true, 'fully drawn bow projectile records full draw');

tiles=new Map(); weapons.reset(); fire.reset(); heroEnergy=20;
refillResources({arrowWood:1, arrowStone:0, arrowObsidian:0, arrowDiamond:0, arrowIridium:0});
equipped=weaponItems.bow;
assert.equal(drawBowFor(4.5, 8, 0.5), true, 'holding after full draw keeps the bow overdrawn');
charge=weapons.metrics().bowCharge;
assert.ok(charge.energySpent>2.5 && charge.energySpent<3.5, 'overdraw drains hero energy after the 4-second cap');
assert.ok(heroEnergy<18, 'hero energy is lower after overdraw');
assert.equal(releaseBowAt(8, 0.5), true, 'overdrawn bow still fires on release');
arrow=weapons._debug.arrows[0];
assert.equal(arrow.dmg, weaponItems.bow.attackDamage*2, 'overdraw does not scale beyond double damage');

tiles=new Map(); weapons.reset(); fire.reset(); randomSeed=0x2468ace0;
refillResources({arrowWood:1, arrowStone:0, arrowObsidian:0, arrowDiamond:0, arrowIridium:0});
equipped=weaponItems.bow;
fireBowTap(8, 0.5);
const woodArrow=weapons._debug.arrows[0];
tiles=new Map(); weapons.reset(); fire.reset(); randomSeed=0x2468ace0;
refillResources({arrowWood:0, arrowStone:0, arrowObsidian:0, arrowDiamond:0, arrowIridium:1});
equipped=weaponItems.bow;
fireBowTap(8, 0.5);
const iridiumArrow=weapons._debug.arrows[0];
assert.ok(iridiumArrow.dmg>woodArrow.dmg, 'iridium arrows deal more damage than wood arrows');
assert.ok(Math.hypot(iridiumArrow.vx, iridiumArrow.vy)>Math.hypot(woodArrow.vx, woodArrow.vy), 'iridium arrows fly faster than wood arrows');
assert.ok(iridiumArrow.life>woodArrow.life, 'iridium arrows keep range longer than wood arrows');

{
  const savedMobs=MM.mobs;
  assert.equal(weapons._debug.arrowRangeBand({travel:2.9,maxTravel:9}), 'close', 'first third of arrow range is close range');
  assert.equal(weapons._debug.arrowRangeBand({travel:4.5,maxTravel:9}), 'mid', 'second third of arrow range is mid range');
  assert.equal(weapons._debug.arrowRangeBand({travel:7.1,maxTravel:9}), 'long', 'final third of arrow range is long range');
  assert.equal(weapons._debug.arrowDamageAtRange({dmg:30,travel:2.9,maxTravel:9}), 30, 'close range arrows keep full damage');
  assert.equal(weapons._debug.arrowDamageAtRange({dmg:30,travel:4.5,maxTravel:9}), 18, 'mid range arrows deal reduced damage');
  assert.equal(weapons._debug.arrowDamageAtRange({dmg:30,travel:7.1,maxTravel:9}), 10, 'long range arrows deal minimal damage');
  function hitDamageAtTravel(travel){
    tiles=new Map(); weapons.reset(); fire.reset();
    let got=0;
    MM.mobs={damageAt(tx,ty,dmg){ if(tx===0 && ty===0){ got=dmg; return true; } return false; }};
    weapons._debug.arrows.push({x:-0.1,y:0.5,vx:12,vy:0,dmg:30,life:1,stuck:false,stuckT:4,travel,maxTravel:9});
    weapons.update(1/60,getTile,setTile);
    return got;
  }
  assert.equal(hitDamageAtTravel(1), 30, 'real close-range arrow hit applies full damage');
  assert.equal(hitDamageAtTravel(4), 18, 'real mid-range arrow hit applies reduced damage');
  assert.equal(hitDamageAtTravel(7), 10, 'real long-range arrow hit applies minimal damage');
  MM.mobs=savedMobs;
}

tiles=new Map(); weapons.reset(); fire.reset(); sparks=0;
refillResources({arrowWood:0, arrowStone:0, arrowObsidian:0, arrowDiamond:0, arrowIridium:1});
setTile(4,0,T.STONE);
setTile(5,0,T.COAL);
equipped=weaponItems.bow;
assert.equal(fireBowTap(8, 0.5), true, 'iridium bow fires for piercing test');
worldChanged=0;
for(let i=0;i<45;i++) weapons.update(1/60, getTile, setTile);
assert.equal(getTile(4,0), T.AIR, 'iridium arrows pierce ordinary stone blocks');
assert.equal(getTile(5,0), T.AIR, 'iridium arrows keep piercing through a second block');
assert.ok(weapons.metrics().iridiumPierces>=2, 'iridium piercing is tracked as material behavior');
assert.ok(sparks>=2, 'iridium block piercing emits rare sparks');
assert.ok(worldChanged>=2, 'iridium piercing schedules edited terrain for persistence');

tiles=new Map(); weapons.reset(); fire.reset(); sparks=0; worldChanged=0;
let antimatterBursts=0;
const oldMeteorites=MM.meteorites;
MM.meteorites={ triggerAntimatterBurst(){ antimatterBursts++; return true; } };
refillResources({arrowWood:0, arrowStone:0, arrowObsidian:0, arrowDiamond:0, arrowIridium:1});
setTile(4,0,T.ANTIMATTER_CRYSTAL);
equipped=weaponItems.bow;
assert.equal(fireBowTap(8, 0.5), true, 'iridium bow fires at antimatter crystal');
worldChanged=0;
for(let i=0;i<45;i++) weapons.update(1/60, getTile, setTile);
assert.equal(getTile(4,0), T.AIR, 'iridium arrows can break antimatter crystals');
assert.equal(antimatterBursts, 1, 'breaking antimatter crystals triggers an inverse-gravity burst hook');
assert.ok(weapons.metrics().iridiumPierces>=1, 'antimatter crystal break is counted as iridium piercing material behavior');
assert.ok(worldChanged>=1, 'antimatter crystal break schedules edited terrain for persistence');
if(oldMeteorites===undefined) delete MM.meteorites; else MM.meteorites=oldMeteorites;

tiles=new Map(); weapons.reset(); fire.reset();
refillResources({arrowWood:0, arrowStone:0, arrowObsidian:0, arrowDiamond:0, arrowIridium:1});
setTile(4,0,T.BEDROCK);
equipped=weaponItems.bow;
assert.equal(fireBowTap(8, 0.5), true, 'iridium bow fires at bedrock');
for(let i=0;i<45;i++) weapons.update(1/60, getTile, setTile);
assert.equal(getTile(4,0), T.BEDROCK, 'bedrock resists iridium arrow piercing');
assert.equal(weapons.metrics().iridiumPierces, 0, 'bedrock resistance is not counted as a successful pierce');

tiles=new Map(); weapons.reset(); fire.reset();
fill(2,8,2,6,T.STONE);
setTile(4,4,T.BEDROCK);
setTile(5,4,T.VOLCANO_MASTER_STONE);
setTile(6,4,T.CHEST_COMMON);
setTile(4,5,T.OBSIDIAN);
setTile(5,5,T.DIAMOND);
setTile(6,5,T.IRIDIUM);
const blastStoneBefore=count(T.STONE);
assert.equal(weapons.explodeAt(5,4,getTile,setTile,{force:true}), true, 'forced gas blast detonates for material immunity test');
assert.equal(getTile(4,4), T.BEDROCK, 'gas explosions do not erase bedrock');
assert.equal(getTile(5,4), T.VOLCANO_MASTER_STONE, 'gas explosions do not erase story stones');
assert.equal(getTile(6,4), T.CHEST_COMMON, 'gas explosions do not erase chests');
assert.equal(getTile(4,5), T.OBSIDIAN, 'gas explosions do not erase obsidian');
assert.equal(getTile(5,5), T.DIAMOND, 'gas explosions do not erase diamond');
assert.equal(getTile(6,5), T.IRIDIUM, 'gas explosions do not erase iridium');
assert.ok(count(T.STONE)<blastStoneBefore, 'gas explosions still crater ordinary stone');

tiles=new Map(); weapons.reset(); fire.reset();
const skyBlastY=Math.max(WORLD_MIN_Y+12,-36);
fill(2,8,skyBlastY-2,skyBlastY+2,T.STONE);
const skyBlastStoneBefore=count(T.STONE);
assert.equal(weapons.explodeAt(5,skyBlastY,getTile,setTile,{force:true}), true, 'forced gas blast detonates in the sky layer');
assert.ok(count(T.STONE)<skyBlastStoneBefore, 'sky-layer gas explosions crater ordinary stone');

tiles=new Map(); weapons.reset(); fire.reset();
const deepBlastY=Math.min(WORLD_MAX_Y-12,WORLD_H+36);
fill(2,8,deepBlastY-2,deepBlastY+2,T.STONE);
const deepBlastStoneBefore=count(T.STONE);
assert.equal(weapons.explodeAt(5,deepBlastY,getTile,setTile,{force:true}), true, 'forced gas blast detonates in the deep layer');
assert.ok(count(T.STONE)<deepBlastStoneBefore, 'deep-layer gas explosions crater ordinary stone');

for(const [kind,key] of [['hose','water'],['flame','wood'],['gas','rottenMeat']]){
  tiles=new Map(); weapons.reset(); fire.reset();
  refillResources({water:1000, wood:1000, rottenMeat:1000, [key]:1});
  equipped=weaponItems[kind];
  for(let i=0;i<60;i++){
    assert.equal(weapons.fireHeld(player, 6, 0.5, 1/60), true, kind+' keeps firing while fuel remains');
    weapons.update(1/60, getTile, setTile);
  }
  assert.equal(globalThis.inv[key], 0, kind+' consumes one '+key+' block per second');
  assert.equal(weapons.fireHeld(player, 6, 0.5, 1/60), false, kind+' refuses to fire once its fuel is gone');
}
refillResources();

function flamePuffXAfter(windSpeed){
  tiles=new Map(); weapons.reset(); fire.reset();
  randomSeed=0xabcddcba;
  if(windSpeed) MM.wind={ speedAt(){ return windSpeed; } };
  else delete MM.wind;
  equipped=weaponItems.flame;
  weapons.fireHeld(player, 8, 0.5, 1/60);
  weapons.update(0.35, getTile, setTile);
  const puff=weapons._debug.puffs.find(p=>p.kind==='flame');
  return puff ? puff.x : -Infinity;
}
const calmFlameX=flamePuffXAfter(0);
const windyFlameX=flamePuffXAfter(5);
assert.ok(windyFlameX>calmFlameX+0.25, 'wind visibly carries stream puffs such as flame and gas');
delete MM.wind;

for(const kind of ['flame','hose','gas']){
  tiles=new Map(); weapons.reset(); fire.reset(); glassShards=0;
  setTile(3,0,T.GLASS);
  sprayActive(kind, 4, 0.5, 0.9);
  assert.equal(getTile(3,0), T.AIR, kind+' stream shatters fragile glass');
  assert.ok(glassShards>=1, kind+' stream impact spawns broken glass shards');
}

tiles=new Map(); weapons.reset(); fire.reset();
setTile(3,0,T.MEAT);
sprayActive('flame', 4, 0.5, 1.0);
assert.equal(getTile(3,0), T.BAKED_MEAT, 'flamethrower bakes fresh meat instead of burning it away');
settleStreams(90);
assert.equal(getTile(3,0), T.BAKED_MEAT, 'baked meat is stable after flame cooking');

tiles=new Map(); weapons.reset(); fire.reset(); heroEnergy=0; electricDamage=0; beamSounds=0; sparks=0; electricTarget='4,0';
equipped=weaponItems.electric;
weapons.update(0, getTile, setTile);
assert.equal(weapons.fireHeld(player, 6, 0.5, 1/60), false, 'electric gun refuses to fire without hero energy');
assert.equal(electricDamage, 0, 'no-energy electric shot deals no damage');
weapons.update(0.2, getTile, setTile);
heroEnergy=5;
assert.equal(weapons.fireHeld(player, 6, 0.5, 1/60), true, 'electric gun fires when energy is available');
assert.ok(heroEnergy<5, 'electric gun consumes stored hero energy');
assert.ok(electricDamage>0, 'electric beam damages the first target on its line');
assert.equal(weapons.metrics().electricBeams, 1, 'electric shot creates one short-lived beam effect');
assert.ok(beamSounds>=1, 'electric shot uses the robot beam sound');
assert.ok(sparks>=1, 'electric hit spawns spark feedback');
weapons.update(0.3, getTile, setTile);
assert.equal(weapons.metrics().electricBeams, 0, 'electric beam effect expires promptly');

tiles=new Map(); weapons.reset(); fire.reset(); heroEnergy=5; electricDamage=0; electricTarget='4,0';
setTile(3,0,T.STONE);
weapons.update(0, getTile, setTile);
assert.equal(weapons.fireHeld(player, 6, 0.5, 1/60), true, 'electric beam still fires into a wall');
assert.equal(electricDamage, 0, 'solid terrain blocks the electric beam before the target');

tiles=new Map(); weapons.reset(); fire.reset(); heroEnergy=5; glassShards=0; electricTarget='4,0';
setTile(3,0,T.GLASS);
weapons.update(0, getTile, setTile);
assert.equal(weapons.fireHeld(player, 6, 0.5, 1/60), true, 'electric beam can hit fragile glass');
assert.equal(getTile(3,0), T.AIR, 'electric beam shatters glass at impact');
assert.equal(electricDamage, 0, 'glass blocks the electric beam from targets behind it');
assert.ok(glassShards>=1, 'electric glass impact spawns broken glass shards');
electricTarget=null;

tiles=new Map(); weapons.reset(); fire.reset(); heroEnergy=0; electricDamage=0; electricTarget='4,0';
equipped=weaponItems.electric;
weapons.update(0, getTile, setTile);
assert.equal(weapons.fireUlt(player, 6, 0.5), false, 'electric ult refuses to fire without enough hero energy');
assert.equal(weapons.metrics().ultCharge, 1, 'failed no-energy electric ult does not spend ult charge');
weapons.update(0.2, getTile, setTile);
heroEnergy=30;
assert.equal(weapons.fireUlt(player, 6, 0.5), true, 'electric ult fires when enough energy is stored');
assert.ok(heroEnergy<12, 'electric ult spends a larger chunk of energy');
assert.ok(electricDamage>10, 'electric ult is a distinct high-power beam');
assert.ok(weapons.metrics().ultCharge<0.05, 'successful electric ult consumes ult charge');
electricTarget=null;

function spray(kind, aimX, aimY, seconds){
  sprayActive(kind, aimX, aimY, seconds);
  settleStreams(2);
}
function sprayActive(kind, aimX, aimY, seconds){
  equipped=weaponItems[kind];
  const dt=1/60;
  for(let i=0;i<seconds*60;i++){
    weapons.fireHeld(player, aimX, aimY, dt);
    weapons.update(dt, getTile, setTile);
    fire.update(getTile, setTile, dt);
  }
}
function settleStreams(seconds){
  const dt=1/60;
  for(let i=0;i<seconds*60;i++){ weapons.update(dt, getTile, setTile); fire.update(getTile, setTile, dt); }
}

{
  const oldGuardians=MM.guardianLairs;
  const oldUnderground=MM.undergroundBoss;
  const oldBosses=MM.bosses;
  const oldUfo=MM.ufo;
  const guardianCalls=[];
  const undergroundDamageCalls=[];
  const undergroundHeatCalls=[];
  MM.guardianLairs={ damageAt(tx,ty,dmg,opts){ guardianCalls.push({tx,ty,dmg,opts}); return false; } };
  MM.undergroundBoss={
    damageAt(tx,ty,dmg,opts){ undergroundDamageCalls.push({tx,ty,dmg,opts}); return false; },
    heatAt(tx,ty,get,set,opts){ undergroundHeatCalls.push({tx,ty,opts,hasAccessors:typeof get==='function' && typeof set==='function'}); return false; }
  };
  delete MM.bosses;
  delete MM.ufo;
  try{
    tiles=new Map(); weapons.reset(); fire.reset(); refillResources();
    sprayActive('hose', 6, 0.5, 0.25);
    assert.ok(guardianCalls.some(c=>c.opts && c.opts.kind==='hose' && c.opts.element==='water'), 'hose stream tags guardian damage as water');
    guardianCalls.length=0;
    undergroundHeatCalls.length=0;
    tiles=new Map(); weapons.reset(); fire.reset(); refillResources();
    sprayActive('flame', 6, 0.5, 0.25);
    assert.ok(guardianCalls.some(c=>c.opts && c.opts.kind==='flame' && c.opts.element==='fire'), 'flame stream tags guardian damage as fire');
    assert.ok(undergroundHeatCalls.some(c=>c.opts && c.opts.element==='fire' && c.hasAccessors), 'flame stream keeps fire heat routing for underground golem cooking');
    undergroundDamageCalls.length=0;
    tiles=new Map(); weapons.reset(); fire.reset(); refillResources();
    sprayActive('gas', 6, 0.5, 0.25);
    assert.ok(undergroundDamageCalls.some(c=>c.opts && c.opts.kind==='gas' && c.opts.element==='gas'), 'gas stream tags underground boss damage as gas');
  } finally {
    if(oldGuardians===undefined) delete MM.guardianLairs; else MM.guardianLairs=oldGuardians;
    if(oldUnderground===undefined) delete MM.undergroundBoss; else MM.undergroundBoss=oldUnderground;
    if(oldBosses===undefined) delete MM.bosses; else MM.bosses=oldBosses;
    if(oldUfo===undefined) delete MM.ufo; else MM.ufo=oldUfo;
  }
}

// 1) flame vs stone wall → lava only after sustained heating
tiles=new Map(); weapons.reset(); fire.reset();
fill(5,7,-2,2,T.STONE);
sprayActive('flame', 6, 0.5, 4.6);
let heatMetrics=weapons.metrics();
assert.ok(heatMetrics.stoneHeat>=1, 'stone tracks visible heat before it melts');
assert.ok(heatMetrics.stoneHeatMax>0.5 && heatMetrics.stoneHeatMax<1, 'stone heat progress stays below complete before 5s');
assert.equal(count(T.LAVA), 0, 'stone does not melt before 5s of continuous flame contact');
sprayActive('flame', 6, 0.5, 1.8);
settleStreams(1);
assert.ok(count(T.LAVA)>=1, 'sustained flame melts stone into lava (got '+count(T.LAVA)+')');

tiles=new Map(); weapons.reset(); fire.reset();
fill(5,7,-2,2,T.STONE);
sprayActive('flame', 6, 0.5, 3.8);
settleStreams(3);
heatMetrics=weapons.metrics();
assert.equal(heatMetrics.stoneHeat, 0, 'interrupted stone heating cools back to zero');
assert.equal(count(T.LAVA), 0, 'interrupted stone heating cools before it melts');
sprayActive('flame', 6, 0.5, 3.0);
assert.equal(count(T.LAVA), 0, 'separate short flame bursts do not add up as continuous heat');

// 2) flame vs sand wall → glass only after longer sustained heating
tiles=new Map(); weapons.reset(); fire.reset();
fill(5,7,-2,2,T.SAND);
sprayActive('flame', 6, 0.5, 8.0);
heatMetrics=weapons.metrics();
assert.ok(heatMetrics.sandHeat>=1, 'sand tracks visible heat before it vitrifies');
assert.ok(heatMetrics.sandHeatMax>0.5 && heatMetrics.sandHeatMax<1, 'sand heat progress stays below complete before 10s');
assert.equal(count(T.GLASS), 0, 'sand does not become glass before 10s of continuous flame contact');
sprayActive('flame', 6, 0.5, 3.5);
const forgedGlass=count(T.GLASS);
assert.ok(forgedGlass>=1, 'sustained flame turns sand into glass (got '+forgedGlass+')');
sprayActive('flame', 6, 0.5, 0.45);
assert.ok(count(T.GLASS)>=forgedGlass, 'fresh heat-forged glass survives the flame that created it');
settleStreams(1);

tiles=new Map(); weapons.reset(); fire.reset();
fill(5,7,-2,2,T.SAND);
sprayActive('flame', 6, 0.5, 7.0);
settleStreams(1);
heatMetrics=weapons.metrics();
assert.equal(heatMetrics.sandHeat, 0, 'interrupted sand heating cools back to zero');
sprayActive('flame', 6, 0.5, 6.0);
assert.equal(count(T.GLASS), 0, 'separate short flame bursts do not add up into glass');

tiles=new Map(); weapons.reset(); fire.reset();
fill(3,3,-2,2,T.LAVA);
fill(5,7,-2,2,T.SAND);
sprayActive('flame', 6, 0.5, 12.0);
assert.equal(count(T.GLASS), 0, 'lava blocks sustained flame heat from vitrifying sand behind it');

// 3) flame vs water pool → evaporation + vapor
tiles=new Map(); weapons.reset(); fire.reset(); vaporInjected=0; gasAdds=[];
fill(3,8,1,2,T.WATER);
const waterBeforeBoil=count(T.WATER);
sprayActive('flame', 6, 1.5, 1.6);
heatMetrics=weapons.metrics();
assert.equal(vaporInjected,0,'brief flame contact does not instantly boil water into cloud vapor');
assert.equal(count(T.WATER),waterBeforeBoil,'brief flame contact leaves water tiles in place');
assert.ok(heatMetrics.waterHeat>=1, 'water tracks heat before it boils');
assert.ok(heatMetrics.waterHeatMax>0 && heatMetrics.waterHeatMax<1, 'water heat progress stays below complete during brief contact');
settleStreams(1);
assert.equal(weapons.metrics().waterHeat,0, 'interrupted water heating cools back to zero');
tiles=new Map(); weapons.reset(); fire.reset(); vaporInjected=0; gasAdds=[];
fill(3,8,1,2,T.WATER);
spray('flame', 6, 1.5, 5);
assert.ok(vaporInjected>=1, 'boiled water mass joins the cloud vapor (got '+vaporInjected+')');
assert.ok(gasAdds.some(g=>g.kind==='steam' && g.hasAccessors), 'boiled water emits persistent steam gas through local accessors');

// 4) hose vs lava pool → obsidian
tiles=new Map(); weapons.reset(); fire.reset();
fill(4,7,0,1,T.LAVA);
spray('hose', 5.5, 0.5, 5);
assert.ok(count(T.OBSIDIAN)>=1, 'hose quenches lava into obsidian (got '+count(T.OBSIDIAN)+')');

// 5) hose vs sand wall → mud (per-puff chance, so spray long enough to be reliable)
tiles=new Map(); weapons.reset(); fire.reset();
fill(5,7,-2,2,T.SAND);
spray('hose', 6, 0.5, 8);
assert.ok(count(T.MUD)>=1, 'hose soaks sand into mud (got '+count(T.MUD)+')');

// 6) hose into open air long enough → occasional condensed water tile
tiles=new Map(); weapons.reset(); fire.reset();
spray('hose', 6, 0.5, 12);
assert.ok(count(T.WATER)>=1, 'hose condenses water now and then (got '+count(T.WATER)+')');

// 7) tile fire: ignite wood, spreads and burns out to AIR
tiles=new Map(); weapons.reset(); fire.reset();
fill(5,5,-3,2,T.WOOD);
spray('flame', 5.5, 0.5, 3);
let burned=false;
for(let i=0;i<60*65;i++){ fire.update(getTile,setTile,1/60); if(count(T.WOOD)<6){ burned=true; break; } }
assert.ok(burned, 'sustained flame sets wood alight and it burns away');

const stepFire=(seconds)=>{ const dt=1/30; for(let i=0;i<seconds*30;i++) fire.update(getTile,setTile,dt); };

// 7) lava is liquid: falls to the floor, and a stack levels out sideways
tiles=new Map(); weapons.reset(); fire.reset();
fill(-3,9,3,3,T.STONE);                      // floor at y=3
setTile(0,0,T.LAVA); fire.noteLava(0,0);     // lava high above the floor
stepFire(20);
assert.equal(getTile(0,2), T.LAVA, 'lava falls until it rests on the floor');
fill(5,5,0,2,T.LAVA); for(let y=0;y<=2;y++) fire.noteLava(5,y); // a 3-tall column
stepFire(40);
let row2=0; for(let x=2;x<=8;x++) if(getTile(x,2)===T.LAVA) row2++;
assert.ok(row2>=2, 'a lava column levels out under its own pressure (bottom row spread: '+row2+')');

// 8) settled lava exposed to open air crusts into obsidian after a long time
tiles=new Map(); weapons.reset(); fire.reset();
fill(-1,1,3,3,T.STONE); fill(-1,1,2,2,T.STONE); setTile(0,2,T.LAVA); fire.noteLava(0,2); // pocket: lava with air above
stepFire(100);
assert.equal(getTile(0,2), T.OBSIDIAN, 'open-air lava cools into obsidian');

// 9) lava meeting water hardens immediately
tiles=new Map(); weapons.reset(); fire.reset();
fill(-1,1,3,3,T.STONE);
setTile(0,2,T.LAVA); fire.noteLava(0,2); setTile(1,2,T.WATER);
stepFire(3);
assert.equal(getTile(0,2), T.OBSIDIAN, 'water contact quenches flowing lava');

// 10) gas detonates on lava: crater in the stone floor + the cloud is consumed
tiles=new Map(); weapons.reset(); fire.reset();
fill(0,12,1,4,T.STONE);                      // thick stone shelf
fill(4,6,0,0,T.LAVA);                        // exposed lava strip at the surface
for(let x=4;x<=6;x++) fire.noteLava(x,0);
const stoneBefore=count(T.STONE);
spray('gas', 5, 0.8, 4);                     // spray slightly downward into the lava
const stoneAfter=count(T.STONE);
assert.ok(stoneAfter<stoneBefore-3, 'gas explosion craters the stone shelf ('+(stoneBefore-stoneAfter)+' tiles blasted)');

Math.random = realRandom;
console.log('OK: all stream-weapon elemental interaction tests passed');
