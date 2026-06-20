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

const { T } = await import('../src/constants.js');
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

const player={x:0.5, y:0.5, facing:1, atkCd:0};
const weaponItems={ flame:{weaponType:'flame', fireDps:6, fireRange:6.5},
                    hose:{weaponType:'hose', fireDps:2, fireRange:6},
                    gas:{weaponType:'gas', fireDps:5, fireRange:5.5},
                    electric:{weaponType:'electric', fireDps:12, fireRange:8, energyCost:10},
                    bow:{weaponType:'bow', attackDamage:3, fireCooldown:0.25} };
let equipped=null;
MM.inventory={ equippedItem:()=>equipped, TIER_COLORS:{} };

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
weapons.fireHeld(player, 6, 0.5, 1/60);
for(let i=0;i<30;i++) weapons.update(1/60, getTile, setTile);
assert.equal(getTile(4,0), T.AIR, 'arrow shatters fragile glass into air');
assert.equal(weapons.metrics().arrows, 0, 'arrow is consumed by shattering glass');
assert.ok(glassShards>=1, 'arrow impact spawns broken glass shards');

tiles=new Map(); weapons.reset(); fire.reset();
MM.wind={ speedAt(){ return 5; } };
equipped=weaponItems.bow;
weapons.fireHeld(player, 8, 0.5, 1/60);
let arrow=weapons._debug.arrows[0];
const arrowVx0=arrow.vx;
weapons.update(0.5, getTile, setTile);
arrow=weapons._debug.arrows[0];
assert.ok(arrow && arrow.vx>arrowVx0, 'wind bends flying arrows without touching electric beams');
delete MM.wind;

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
