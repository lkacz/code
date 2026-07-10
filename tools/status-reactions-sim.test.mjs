// Elemental status matrix regressions (mobs.js): wet as combo fuel, freeze-solid,
// thermal shock, toxic ignition, chain lightning through soaked targets, the
// frozen-shell armor, environmental soaking, yeti snowball throws and the
// perfect-parry reflect. Run: node tools/status-reactions-sim.test.mjs
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.CustomEvent = class { constructor(type,opts){ this.type=type; this.detail=opts&&opts.detail; } };
globalThis.dispatchEvent = () => true;
let simNow = 0;
globalThis.performance = { now:()=>simNow };

const { T } = await import('../src/constants.js');
const { worldGen } = await import('../src/engine/worldgen.js');
await import('../src/engine/world.js');
const { mobs } = await import('../src/engine/mobs.js');

worldGen.worldSeed = 20260616;
worldGen.clearCaches();

let heroHits = [];
globalThis.damageHero = (amount,opts)=>{ heroHits.push({amount,opts}); return true; };

// flat world: grass floor at y=30; a small pool can be enabled per test
let poolCells = new Set();
function getTile(x,y){
  if(y<0 || y>140) return T.STONE;
  if(poolCells.has(x+','+y)) return T.WATER;
  if(y===30) return T.GRASS;
  if(y>30) return T.STONE;
  return T.AIR;
}
const player={x:200,y:29,hp:100,maxHp:100,vx:0,vy:0,facing:1,w:0.7,h:0.95};
globalThis.player=player;

let ultCharges=[];
MM.weapons={ addUltCharge(v){ ultCharges.push(v); } };
let discoveries=[];
MM.discovery={ note(id){ discoveries.push(id); return true; } };
MM.background={ getCycleInfo(){ return {isDay:true,tDay:0.5,cycleT:0.25}; } };

const realRandom=Math.random;
let seed=42424242;
Math.random=()=>{ seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; };

function spawnWolves(list){
  mobs.clearAll();
  mobs.freezeSpawns(100000);
  mobs.deserialize({
    v:4,
    list:list.map(w=>({id:w.id||'WOLF',x:w.x,y:w.y??29,vx:0,vy:0,hp:w.hp??16,state:'idle',facing:1,scale:1,speedMul:1,jumpMul:1})),
    aggro:{mode:'rel',m:{}}
  });
  mobs.freezeSpawns(100000);
}
function step(n,dt=0.05){
  for(let i=0;i<n;i++){ simNow+=dt*1000; mobs.update(dt,player,getTile); }
}
function mobAt(x,y,r){ return mobs.nearestLiving(x,y,r??3); }

try{
  // --- wet + chill => frozen solid (immobile, no wet/chill left) ---
  spawnWolves([{x:10}]);
  let w=mobAt(10,29);
  assert.ok(w,'wolf spawned');
  assert.equal(mobs.applyStatus(w,'wet',{dur:8,source:'hero'}), true, 'wet applies');
  assert.equal(mobs.applyStatus(w,'chill',{dur:4,source:'hero'}), true, 'chill onto wet reacts');
  assert.equal(mobs.hasStatus(w,'frozen'), true, 'the wet+chill reaction freezes the target solid');
  assert.equal(mobs.hasStatus(w,'wet'), false, 'wet is consumed by the freeze');
  assert.equal(mobs.hasStatus(w,'chill'), false, 'chill is consumed by the freeze');
  assert.ok(ultCharges.length>=1, 'a hero-caused reaction feeds the ult');
  assert.ok(discoveries.includes('react_freeze'), 'the freeze reaction reports a discovery');
  w.vx=5; w.vy=-3;
  step(1);
  assert.equal(w.vx, 0, 'a frozen mob cannot walk');
  assert.ok(w.vy>=0, 'a frozen mob cannot jump');

  // --- frozen shell halves incoming damage ---
  const hpBefore=w.hp;
  mobs.damageAt(Math.floor(w.x),Math.floor(w.y),8,{source:'hero',kind:'melee'});
  const frozenDealt=hpBefore-w.hp;
  spawnWolves([{x:10}]);
  const w2=mobAt(10,29);
  const hp2=w2.hp;
  mobs.damageAt(Math.floor(w2.x),Math.floor(w2.y),8,{source:'hero',kind:'melee'});
  assert.ok(frozenDealt < (hp2-w2.hp), 'the ice shell absorbs part of the hit ('+frozenDealt+' vs '+(hp2-w2.hp)+')');

  // --- fire melts the frozen shell instead of burning ---
  simNow+=1000;
  spawnWolves([{x:10}]);
  w=mobAt(10,29);
  mobs.applyStatus(w,'wet',{dur:8,source:'hero'});
  mobs.applyStatus(w,'chill',{dur:4,source:'hero'});
  assert.equal(mobs.hasStatus(w,'frozen'), true, 'target frozen again');
  simNow+=1000; // clear the reaction lock
  mobs.applyStatus(w,'burn',{dur:3,dps:2,source:'hero'});
  assert.equal(mobs.hasStatus(w,'frozen'), false, 'fire melts the ice shell');
  assert.equal(mobs.hasStatus(w,'burn'), false, 'melting the shell consumes the flame');

  // --- chill + burn => thermal shock (damage pulse, both statuses consumed) ---
  simNow+=1000;
  spawnWolves([{x:10,hp:30}]);
  w=mobAt(10,29);
  mobs.applyStatus(w,'chill',{dur:4,source:'hero'});
  const hpShock=w.hp;
  mobs.applyStatus(w,'burn',{dur:3,dps:2,source:'hero'});
  assert.ok(w.hp<hpShock, 'thermal shock deals an immediate pulse');
  assert.equal(mobs.hasStatus(w,'chill'), false, 'thermal shock consumes the chill');
  assert.equal(mobs.hasStatus(w,'burn'), false, 'thermal shock consumes the flame');
  assert.ok(discoveries.includes('react_thermal'), 'thermal shock reports a discovery');

  // --- burn + poison => toxic ignition (pulse + flames spread to neighbours) ---
  simNow+=1000;
  spawnWolves([{x:10,hp:30},{x:11.2,hp:30}]);
  w=mobAt(10,29,0.8);
  const neighbour=mobAt(11.2,29,0.6);
  assert.ok(w && neighbour && w!==neighbour, 'two wolves side by side');
  mobs.applyStatus(w,'burn',{dur:3,dps:2,source:'hero'});
  const hpToxic=w.hp;
  mobs.applyStatus(w,'poison',{dur:5,dps:2,source:'hero'});
  assert.ok(w.hp<hpToxic, 'toxic ignition deals an immediate pulse');
  assert.equal(mobs.hasStatus(neighbour,'burn'), true, 'the green blast ignites the neighbour');
  assert.ok(discoveries.includes('react_toxic'), 'toxic ignition reports a discovery');

  // --- wet douses fire; fire fizzles on a soaked target ---
  simNow+=1000;
  spawnWolves([{x:10}]);
  w=mobAt(10,29);
  mobs.applyStatus(w,'burn',{dur:3,dps:2,source:'hero'});
  assert.equal(mobs.hasStatus(w,'burn'), true, 'burning');
  mobs.applyStatus(w,'wet',{dur:8,source:'hero'});
  assert.equal(mobs.hasStatus(w,'burn'), false, 'a soaking douses the flames');
  assert.equal(mobs.hasStatus(w,'wet'), true, 'the target stays soaked');
  mobs.applyStatus(w,'burn',{dur:3,dps:2,source:'hero'});
  assert.equal(mobs.hasStatus(w,'burn'), false, 'fire fizzles out on a soaked hide');
  assert.equal(mobs.hasStatus(w,'wet'), false, 'the fizzle dries the target');

  // --- chain lightning: electric into a wet target arcs to other wet targets ---
  simNow+=1000;
  spawnWolves([{x:10,hp:30},{x:12,hp:30},{x:13.5,hp:30}]);
  const src=mobAt(10,29,0.8);
  const wetPal=mobAt(12,29,0.8);
  const dryPal=mobAt(13.5,29,0.7);
  assert.ok(src && wetPal && dryPal && new Set([src,wetPal,dryPal]).size===3, 'three separate wolves');
  mobs.applyStatus(src,'wet',{dur:8});
  mobs.applyStatus(wetPal,'wet',{dur:8});
  const srcHp=src.hp, palHp=wetPal.hp, dryHp=dryPal.hp;
  mobs.damageAt(Math.floor(src.x),Math.floor(src.y),10,{source:'hero',kind:'electric'});
  assert.ok(srcHp-src.hp>=14, 'a soaked target takes amplified electric damage (dealt '+(srcHp-src.hp)+')');
  assert.ok(wetPal.hp<palHp, 'the arc jumps to the other soaked target');
  assert.equal(dryPal.hp, dryHp, 'dry bystanders are not arced');
  assert.ok(discoveries.includes('react_chain'), 'chain lightning reports a discovery');

  // --- environmental soaking: standing in water applies wet automatically ---
  simNow+=1000;
  player.x=24; player.y=29; // mobs simulate only near the hero
  spawnWolves([{x:20}]);
  w=mobAt(20,29);
  poolCells=new Set();
  for(let px=16;px<=24;px++) for(let py=28;py<=31;py++) poolCells.add(px+','+py);
  step(24);
  assert.equal(mobs.hasStatus(w,'wet'), true, 'swimming soaks the creature');
  poolCells=new Set();

  // --- yeti snowball: thrown at mid range; a hit chills the hero; parry reflects ---
  simNow+=1000;
  heroHits=[];
  let heroChills=0;
  globalThis.noteHeroChill=()=>{ heroChills++; };
  player.x=26; player.y=29;
  spawnWolves([{id:'JACKPOT_YETI',x:20,hp:152}]);
  const yeti=mobAt(20,29,3);
  assert.ok(yeti, 'yeti spawned');
  let threw=false;
  for(let i=0;i<80 && !threw;i++){ step(1); threw=mobs._debugCombat().projectiles.some(p=>p.type==='snowball'); }
  assert.equal(threw, true, 'the yeti lobs a snowball at mid range');
  let chilled=false;
  for(let i=0;i<120 && !chilled;i++){ step(1); chilled=heroChills>0; }
  assert.equal(chilled, true, 'a snowball to the face briefly chills the hero');
  assert.ok(heroHits.some(h=>h.amount>0), 'the snowball also stings a little');

  // --- perfect parry: the projectile is reflected, the hero takes nothing ---
  simNow+=4000;
  heroHits=[];
  globalThis.heroPerfectParry=()=>true;
  spawnWolves([{id:'JACKPOT_YETI',x:20,hp:152}]);
  let reflected=false;
  for(let i=0;i<200 && !reflected;i++){
    step(1);
    reflected=mobs._debugCombat().projectiles.some(p=>String(p.cause||'').startsWith('parried_'));
  }
  assert.equal(reflected, true, 'a perfect block bats the projectile back');
  assert.equal(heroHits.length, 0, 'a parried projectile never hurts the hero');
  assert.ok(discoveries.includes('parry'), 'the first parry reports a discovery');
  globalThis.heroPerfectParry=()=>false;
} finally {
  Math.random=realRandom;
}

console.log('status-reactions-sim: all assertions passed');
