// Biome pressure regression test.
// Verifies desert sand worms and forest/swamp temple guards add survivable,
// rewarded biome-specific threats with readable counters.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.CustomEvent = class { constructor(type,opts){ this.type=type; this.detail=opts&&opts.detail; } };
const dispatchedEvents = [];
globalThis.dispatchEvent = (ev) => { dispatchedEvents.push(ev); return true; };
globalThis.localStorage = {
  getItem(){ return null; },
  setItem(){},
  removeItem(){}
};
let simNow = 0;
globalThis.performance = { now:()=>simNow };

const { T } = await import('../src/constants.js');
const { worldGen } = await import('../src/engine/worldgen.js');
const { meat } = await import('../src/engine/meat.js');
const { mobs } = await import('../src/engine/mobs.js');
const mobsSource = readFileSync(new URL('../src/engine/mobs.js', import.meta.url), 'utf8');

const originalBiomeType = worldGen.biomeType;
const originalVolcanoAt = worldGen.volcanoAt;
const originalRandom = Math.random;
let seed = 123456789;
function seededRandom(){
  seed = (Math.imul(seed,1664525)+1013904223)>>>0;
  return seed/4294967296;
}
function makeTileWorld(baseFloor, overrides){
  const cells = new Map(Object.entries(overrides||{}));
  const key=(x,y)=>Math.floor(x)+','+Math.floor(y);
  return {
    getTile(x,y){
      const k=key(x,y);
      if(cells.has(k)) return cells.get(k);
      return y>=10 ? baseFloor : T.AIR;
    },
    setTile(x,y,t){
      const k=key(x,y);
      if(t===T.AIR) cells.delete(k);
      else cells.set(k,t);
    }
  };
}
function makeWaterTileWorld(baseFloor, x0, x1, y0, y1){
  const overrides={};
  for(let x=x0; x<=x1; x++){
    for(let y=y0; y<=y1; y++) overrides[x+','+y]=T.WATER;
  }
  return makeTileWorld(baseFloor, overrides);
}
function resetPlayer(x=0.5,y=9.2){
  const p={x,y,w:0.7,h:0.95,vx:0,vy:0,onGround:true,facing:1,hp:100,maxHp:100,hpInvul:0,xp:0};
  globalThis.player=p;
  return p;
}
function installDamageRecorder(player){
  const hits=[];
  globalThis.damageHero = (amount,opts)=>{
    hits.push({amount,opts});
    player.hp -= amount;
    player.hpInvul = simNow + ((opts&&opts.invulMs)||0);
    return true;
  };
  return hits;
}

try{
  Math.random = seededRandom;
  globalThis.msg = () => {};

  const species = mobs._debugSpecies();
  assert.ok(species.SAND_WORM && mobs.species.includes('SAND_WORM'), 'sand worm species is registered');
  assert.ok(species.GIANT_SCORPION && mobs.species.includes('GIANT_SCORPION'), 'giant scorpion species is registered');
  assert.ok(species.JACKPOT_YETI && mobs.species.includes('JACKPOT_YETI'), 'jackpot yeti species is registered');
  assert.ok(species.JACKPOT_WHALE && mobs.species.includes('JACKPOT_WHALE'), 'jackpot whale species is registered');
  assert.ok(species.TEMPLE_GUARD && mobs.species.includes('TEMPLE_GUARD'), 'temple guardian species is registered');
  assert.ok(species.BRAMBLE_STALKER && mobs.species.includes('BRAMBLE_STALKER'), 'bramble stalker species is registered');
  assert.ok(species.THUNDER_BISON && mobs.species.includes('THUNDER_BISON'), 'thunder bison species is registered');
  assert.ok(species.BOG_LURKER && mobs.species.includes('BOG_LURKER'), 'bog lurker species is registered');
  assert.ok(species.ICE_WRAITH && mobs.species.includes('ICE_WRAITH'), 'ice wraith species is registered');
  assert.ok(species.LAKE_SERPENT && mobs.species.includes('LAKE_SERPENT'), 'lake serpent species is registered');
  assert.ok(species.STONE_GOLEM && mobs.species.includes('STONE_GOLEM'), 'stone golem species is registered');
  assert.ok(species.VULTURE && mobs.species.includes('VULTURE'), 'vulture species is registered');
  assert.ok(species.ATOMIC_BOMB && mobs.species.includes('ATOMIC_BOMB'), 'atomic bomb city threat is registered');
  assert.ok(species.RADIATION_COCKROACH && mobs.species.includes('RADIATION_COCKROACH'), 'radiation cockroach city threat is registered');
  assert.ok(species.VULTURE_HATCHLING && mobs.species.includes('VULTURE_HATCHLING'), 'vulture hatchling species is registered');
  assert.ok(species.SAND_WORM.xp >= 50, 'sand worms pay meaningful XP for surviving the desert threat');
  assert.ok(species.SAND_WORM.dmg >= 22 && species.SAND_WORM.speed >= 4, 'awakened sand worms hit harder and chase faster than ordinary desert fauna');
  assert.ok(species.GIANT_SCORPION.xp >= 140, 'giant scorpions pay major XP for surviving the desert elite threat');
  assert.ok(species.GIANT_SCORPION.hp >= 110 && species.GIANT_SCORPION.dmg >= 28, 'giant scorpions are tuned as a powerful desert threat');
  assert.ok(species.JACKPOT_YETI.xp >= 170 && species.JACKPOT_YETI.hp >= 140, 'jackpot yetis are high-stakes snow threats');
  assert.ok(species.JACKPOT_WHALE.xp >= 220 && species.JACKPOT_WHALE.hp >= 200, 'jackpot whales are high-stakes deep-water threats');
  assert.ok(species.TEMPLE_GUARD.xp >= 30, 'temple guardians pay meaningful XP for a treasure fight');
  assert.ok(species.BRAMBLE_STALKER.xp >= 35, 'bramble stalkers pay meaningful XP for surviving a forest ambush');
  assert.ok(species.THUNDER_BISON.xp >= 45, 'thunder bison pay meaningful XP for surviving a plains charge');
  assert.ok(species.BOG_LURKER.xp >= 35, 'bog lurkers pay meaningful XP for surviving swamp pressure');
  assert.ok(species.ICE_WRAITH.xp >= 40, 'ice wraiths pay meaningful XP for surviving snow pressure');
  assert.ok(species.LAKE_SERPENT.xp >= 50, 'lake serpents pay meaningful XP for surviving lake pressure');
  assert.ok(species.STONE_GOLEM.xp >= 50, 'stone golems pay meaningful XP for surviving mountain pressure');
  assert.ok(species.VULTURE.xp >= 30, 'vultures pay meaningful XP for surviving a nest attack');
  assert.equal(species.ATOMIC_BOMB.xp, 6000, 'destroying an atomic bomb pays a massive high-risk XP jackpot');
  assert.ok(species.RADIATION_COCKROACH.dmg >= 16, 'radiation cockroaches are poisonous enough to pressure city survival');
  assert.match(mobsSource, /const ATOMIC_BOMB_CRATER_RX = 45;/, 'atomic bomb crater is tripled horizontally into a massive 90-block blast bowl');
  assert.match(mobsSource, /const ATOMIC_BOMB_CRATER_RY = 30;/, 'atomic bomb crater is tripled vertically into a deep blast bowl');
  assert.match(mobsSource, /blastRadius\(m\.x,m\.y,ATOMIC_BOMB_BLAST_RADIUS,96/, 'atomic bomb shockwave scales with the enlarged crater');

  let player;
  let hits;
  worldGen.biomeType = () => 8;
  player = resetPlayer(80,9.15);
  installDamageRecorder(player);
  mobs.clearAll();
  let bombFatigue = {mode:'day',m:{}};
  const bombRewards = [];
  for(let i=0;i<5;i++){
    mobs.deserialize({v:5,list:[{id:'ATOMIC_BOMB',x:0.5,y:9.124,vx:0,vy:0,hp:120,maxHp:120,state:'armed',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{}},xpFatigue:bombFatigue});
    mobs.freezeSpawns(10000);
    const beforeXp = player.xp;
    const opts = i===2 ? {source:'hero',specialAttack:true} : {source:'hero'};
    assert.equal(mobs.damageAt(0,9,999,opts), true, 'atomic bombs can be detonated through the normal mob damage API');
    bombRewards.push(player.xp-beforeXp);
    bombFatigue = mobs.serialize().xpFatigue;
  }
  assert.deepEqual(bombRewards, [6000,3000,1500,750,375], 'repeat atomic bomb detonations halve their XP jackpot each time');

  worldGen.biomeType = () => 3;
  const desert = makeTileWorld(T.SAND);
  assert.equal(species.SAND_WORM.spawnTest(0,9,desert.getTile), true, 'sand worms spawn from deep desert sand');
  assert.equal(species.GIANT_SCORPION.spawnTest(0,9,desert.getTile), true, 'giant scorpions spawn on open desert sand');
  worldGen.biomeType = () => 1;
  assert.equal(species.SAND_WORM.spawnTest(0,9,desert.getTile), false, 'sand worms reject non-desert sand');
  assert.equal(species.GIANT_SCORPION.spawnTest(0,9,desert.getTile), false, 'giant scorpions reject non-desert sand');

  worldGen.biomeType = () => 3;
  player = resetPlayer(7.1,9.15);
  hits = installDamageRecorder(player);
  mobs.clearAll();
  mobs.deserialize({v:4,list:[{id:'SAND_WORM',x:0.5,y:9.5,vx:0,vy:0,hp:46,maxHp:46,state:'buried',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{}}});
  mobs.freezeSpawns(10000);
  simNow += 100;
  mobs.update(0.1,player,desert.getTile,desert.setTile);
  assert.equal(mobs.serialize().list[0].state, 'buried', 'a careful hero can pass outside the close wake radius without surfacing a sand worm');
  assert.equal(hits.length, 0, 'dormant sand worms do not bite from the wider old wake radius');

  player = resetPlayer(4.95,9.15);
  hits = installDamageRecorder(player);
  mobs.clearAll();
  mobs.deserialize({v:5,list:[{id:'SAND_WORM',x:0.5,y:9.5,vx:0,vy:0,hp:46,maxHp:46,state:'buried',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0,sandWormWakeRadius:4}],aggro:{mode:'rel',m:{SAND_WORM:60000}}});
  mobs.freezeSpawns(10000);
  simNow += 100;
  mobs.update(0.1,player,desert.getTile,desert.setTile);
  assert.equal(mobs.serialize().list[0].state, 'buried', 'even an aggro sand worm with max wake variance stays buried beyond 4 blocks');
  assert.equal(hits.length, 0, 'aggro no longer makes buried sand worms bite from the wider alert radius');

  player = resetPlayer(4.05,9.15);
  hits = installDamageRecorder(player);
  mobs.clearAll();
  mobs.deserialize({v:5,list:[{id:'SAND_WORM',x:0.5,y:9.5,vx:0,vy:0,hp:46,maxHp:46,state:'buried',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0,sandWormWakeRadius:4}],aggro:{mode:'rel',m:{}}});
  mobs.freezeSpawns(10000);
  simNow += 100;
  mobs.update(0.1,player,desert.getTile,desert.setTile);
  assert.equal(mobs.serialize().list[0].state, 'ambush', 'a sand worm at the high end of wake variance surfaces inside 4 blocks');
  assert.equal(mobs.serialize().list[0].sandWormWakeRadius, 4, 'sand worm wake variance is serialized for stable testing and saves');

  player = resetPlayer(0.5,9.15);
  hits = installDamageRecorder(player);
  mobs.clearAll();
  mobs.deserialize({v:4,list:[{id:'SAND_WORM',x:0.5,y:9.5,vx:0,vy:0,hp:46,maxHp:46,state:'buried',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{}}});
  mobs.freezeSpawns(10000);
  simNow += 100;
  mobs.update(0.1,player,desert.getTile,desert.setTile);
  assert.ok(hits.length>=1, 'a close hero triggers a sand-worm ambush bite');
  assert.equal(hits[0].opts?.cause, 'sand_worm_bite', 'sand-worm bite damage is identifiable');

  player = resetPlayer(18.5,9.15);
  player.vx = 6.2;
  hits = installDamageRecorder(player);
  mobs.clearAll();
  const savedWormRandom = Math.random;
  Math.random = () => 0;
  mobs.deserialize({v:4,list:[{id:'SAND_WORM',x:0.5,y:9.5,vx:0,vy:0,hp:46,maxHp:46,state:'ambush',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{SAND_WORM:60000}}});
  mobs.freezeSpawns(10000);
  simNow += 120;
  mobs.update(0.08,player,desert.getTile,desert.setTile);
  assert.equal(mobs.serialize().list[0].state, 'circling', 'an outpaced awakened sand worm hides back into the sand');
  simNow += 900;
  mobs.update(0.08,player,desert.getTile,desert.setTile);
  Math.random = savedWormRandom;
  const circledWorm = mobs.serialize().list[0];
  assert.equal(circledWorm.state, 'ambush', 'a circling sand worm resurfaces from the sand');
  assert.ok(circledWorm.x > player.x + 3, 'a circling sand worm reappears from the direction the hero is approaching');

  player = resetPlayer(8.5,7.8);
  player.onGround = false;
  player.vx = 4.4;
  player.vy = -3.1;
  hits = installDamageRecorder(player);
  mobs.clearAll();
  mobs.deserialize({v:4,list:[{id:'SAND_WORM',x:0.5,y:9.5,vx:0,vy:0,hp:46,maxHp:46,state:'ambush',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{SAND_WORM:60000}}});
  mobs.freezeSpawns(10000);
  simNow += 120;
  mobs.update(0.08,player,desert.getTile,desert.setTile);
  const wormSpit = mobs._debugCombat().projectiles.find(p=>p.type==='spit');
  assert.ok(wormSpit, 'an awakened sand worm spits at an airborne hero');
  assert.equal(wormSpit.cause, 'sand_worm_spit', 'sand-worm spit damage is identifiable');
  assert.ok(wormSpit.aimX > player.x, 'sand-worm spit leads the hero toward their estimated future position');

  const baited = makeTileWorld(T.SAND, {'1,9':T.MEAT});
  meat.noteMeat(1,9,{age:0});
  player = resetPlayer(0.55,9.15);
  hits = installDamageRecorder(player);
  mobs.clearAll();
  mobs.deserialize({v:4,list:[{id:'SAND_WORM',x:0.5,y:9.5,vx:0,vy:0,hp:46,maxHp:46,state:'ambush',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{}}});
  mobs.freezeSpawns(10000);
  simNow += 120;
  mobs.update(0.08,player,baited.getTile,baited.setTile);
  assert.equal(baited.getTile(1,9), T.AIR, 'sand worms consume nearby meat bait');
  assert.equal(hits.length, 0, 'a fed sand worm does not bite an overlapping hero');
  assert.ok(mobs.serialize().list[0].pacifiedMs > 0, 'feeding a sand worm persists a visible calm timer');

  player = resetPlayer(0.5,9.15);
  hits = installDamageRecorder(player);
  mobs.clearAll();
  mobs.deserialize({v:4,list:[{id:'SAND_WORM',x:0.5,y:9.5,vx:0,vy:0,hp:46,maxHp:46,state:'ambush',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{SAND_WORM:60000}}});
  mobs.freezeSpawns(10000);
  assert.equal(mobs.douseRadius(0.5,9.5,2), 1, 'water hose douse pacifies sand worms');
  assert.equal(mobs.serialize().list[0].hp, 46, 'water dousing does not kill or chip sand worms');
  simNow += 120;
  mobs.update(0.08,player,desert.getTile,desert.setTile);
  assert.equal(hits.length, 0, 'a doused sand worm does not keep biting through aggro');
  assert.ok(['buried','doused'].includes(mobs.serialize().list[0].state), 'a water-hit sand worm flees or re-hides instead of continuing the attack');

  player = resetPlayer(0.5,9.15);
  mobs.clearAll();
  mobs.deserialize({v:4,list:[{id:'SAND_WORM',x:0.5,y:9.5,vx:0,vy:0,hp:46,maxHp:46,state:'ambush',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{}}});
  mobs.freezeSpawns(10000);
  assert.equal(mobs.damageAt(0,9,999,{source:'hero'}), true, 'sand worms can be defeated through the normal mob damage API');
  assert.ok(player.xp >= species.SAND_WORM.xp, 'defeating a sand worm awards XP');

  player = resetPlayer(1.25,9.15);
  hits = installDamageRecorder(player);
  mobs.clearAll();
  mobs.deserialize({v:5,list:[{id:'GIANT_SCORPION',x:0.5,y:9.5,vx:0,vy:0,hp:126,maxHp:126,state:'stalking',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{}}});
  mobs.freezeSpawns(10000);
  simNow += 2600;
  mobs.update(0.08,player,desert.getTile,desert.setTile);
  assert.ok(hits.some(h=>h.opts?.cause==='giant_scorpion_sting'), 'a close giant scorpion uses an identifiable high-threat sting');

  const previousInvasions = MM.invasions;
  const commanders = [];
  MM.invasions = {
    spawnRuinCommander(x,y,opts){
      commanders.push({x,y,opts});
      return {id:'golden_commander_stub'};
    }
  };
  const savedScorpionRandom = Math.random;
  try{
    Math.random = () => 0.05;
    player = resetPlayer(0.5,9.15);
    mobs.clearAll();
    mobs.deserialize({v:5,list:[{id:'GIANT_SCORPION',x:0.5,y:9.5,vx:0,vy:0,hp:126,maxHp:126,state:'stalking',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{}}});
    mobs.freezeSpawns(10000);
    assert.equal(mobs.damageAt(0,9,999,{source:'hero'}), true, 'giant scorpions can be defeated through the normal mob damage API');
    assert.ok(player.xp >= species.GIANT_SCORPION.xp, 'defeating a giant scorpion awards major XP');
    assert.equal(commanders.length, 1, 'one-in-ten giant scorpion deaths can reveal a golden alien commander');
    assert.equal(commanders[0].opts?.forceAfterWestGuardian, true, 'scorpion commander reveals are independent of ruin progression');
    assert.ok(commanders[0].opts?.threatBonus >= 10, 'scorpion commanders inherit an elite threat bonus');

    Math.random = () => 0.5;
    commanders.length = 0;
    player = resetPlayer(0.5,9.15);
    mobs.clearAll();
    mobs.deserialize({v:5,list:[{id:'GIANT_SCORPION',x:0.5,y:9.5,vx:0,vy:0,hp:126,maxHp:126,state:'stalking',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{}}});
    mobs.freezeSpawns(10000);
    assert.equal(mobs.damageAt(0,9,999,{source:'hero'}), true, 'ordinary giant scorpion deaths still resolve cleanly');
    assert.equal(commanders.length, 0, 'most giant scorpion deaths do not reveal an alien commander');
  } finally {
    Math.random = savedScorpionRandom;
    if(previousInvasions) MM.invasions = previousInvasions;
    else delete MM.invasions;
  }

  worldGen.biomeType = () => 0;
  const forest = makeTileWorld(T.GRASS, {
    '-2,8':T.WOOD,
    '-2,7':T.WOOD,
    '-3,7':T.LEAF,
    '-1,7':T.LEAF,
    '-2,6':T.LEAF,
    '-3,6':T.LEAF,
    '-1,6':T.LEAF
  });
  assert.equal(species.BRAMBLE_STALKER.spawnTest(0,9,forest.getTile), true, 'bramble stalkers spawn camouflaged near real forest tree mass');
  worldGen.biomeType = () => 1;
  assert.equal(species.BRAMBLE_STALKER.spawnTest(0,9,forest.getTile), false, 'bramble stalkers reject non-forest tree cover');

  worldGen.biomeType = () => 0;
  player = resetPlayer(0.55,9.15);
  hits = installDamageRecorder(player);
  mobs.clearAll();
  mobs.deserialize({v:5,list:[{id:'BRAMBLE_STALKER',x:0.5,y:9.15,vx:0,vy:0,hp:24,maxHp:24,state:'camouflaged',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{}}});
  mobs.freezeSpawns(10000);
  dispatchedEvents.length = 0;
  simNow += 120;
  mobs.update(0.08,player,forest.getTile,forest.setTile);
  assert.ok(hits.some(h=>h.opts?.cause==='bramble_thorns'), 'a close hero wakes a camouflaged bramble stalker into thorn pressure');
  assert.equal(mobs.nearestHostileLiving(0.5,9.15,4)?.id, 'BRAMBLE_STALKER', 'a woken bramble stalker becomes a hostile target');
  assert.ok(dispatchedEvents.some(ev=>ev.type==='mm-entity-number' && ev.detail?.text==='!' && String(ev.detail?.target||'').startsWith('bramble_stalker')), 'a bramble stalker shows a world-space warning as it unfurls');

  const torchForest = makeTileWorld(T.GRASS, {
    '-2,8':T.WOOD,
    '-2,7':T.WOOD,
    '-3,7':T.LEAF,
    '-1,7':T.LEAF,
    '-2,6':T.LEAF,
    '1,8':T.TORCH
  });
  player = resetPlayer(0.55,9.15);
  hits = installDamageRecorder(player);
  mobs.clearAll();
  mobs.deserialize({v:5,list:[{id:'BRAMBLE_STALKER',x:0.5,y:9.15,vx:0,vy:0,hp:24,maxHp:24,state:'snare',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{BRAMBLE_STALKER:60000}}});
  mobs.freezeSpawns(10000);
  simNow += 120;
  mobs.update(0.08,player,torchForest.getTile,torchForest.setTile);
  assert.equal(hits.length, 0, 'torchlight suppresses bramble-stalker thorn pressure');
  assert.ok(mobs.serialize().list[0].pacifiedMs > 0, 'torch-suppressed bramble stalkers persist a visible calm timer');
  player.xp = 0;
  assert.equal(mobs.damageAt(0,9,999,{source:'hero'}), true, 'bramble stalkers can be defeated through the normal mob damage API');
  assert.ok(player.xp >= species.BRAMBLE_STALKER.xp, 'defeating a bramble stalker awards XP');

  worldGen.biomeType = () => 1;
  const plains = makeTileWorld(T.GRASS);
  assert.equal(species.THUNDER_BISON.spawnTest(0,9,plains.getTile), true, 'thunder bison spawn on open plains grass');
  worldGen.biomeType = () => 0;
  assert.equal(species.THUNDER_BISON.spawnTest(0,9,plains.getTile), false, 'thunder bison reject forest grass');

  worldGen.biomeType = () => 1;
  player = resetPlayer(0.55,9.15);
  hits = installDamageRecorder(player);
  mobs.clearAll();
  mobs.deserialize({v:5,list:[{id:'THUNDER_BISON',x:0.5,y:9.15,vx:0,vy:0,hp:48,maxHp:48,state:'charge',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{THUNDER_BISON:60000}}});
  mobs.freezeSpawns(10000);
  simNow += 120;
  mobs.update(0.08,player,plains.getTile,plains.setTile);
  assert.equal(hits.filter(h=>h.opts?.cause==='thunder_bison_charge').length, 1, 'a thunder-bison charge does not double-hit from generic contact in the same frame');

  worldGen.biomeType = () => 1;
  player = resetPlayer(3.2,9.15);
  player.vx = 4.8;
  hits = installDamageRecorder(player);
  mobs.clearAll();
  mobs.deserialize({v:5,list:[{id:'THUNDER_BISON',x:0.5,y:9.15,vx:0,vy:0,hp:48,maxHp:48,state:'grazing',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{}}});
  mobs.freezeSpawns(10000);
  dispatchedEvents.length = 0;
  simNow += 4000;
  mobs.update(0.08,player,plains.getTile,plains.setTile);
  assert.equal(mobs.serialize().list[0].state, 'windup', 'a running hero near a thunder bison triggers a readable charge windup');
  assert.ok(dispatchedEvents.some(ev=>ev.type==='mm-entity-number' && ev.detail?.text==='!' && String(ev.detail?.target||'').startsWith('thunder_bison')), 'a thunder bison shows a world-space warning before the charge');
  simNow += 700;
  mobs.update(0.12,player,plains.getTile,plains.setTile);
  assert.equal(mobs.serialize().list[0].state, 'charge', 'a thunder bison commits to a charge after the windup');
  for(let i=0; i<8 && !hits.some(h=>h.opts?.cause==='thunder_bison_charge'); i++){
    simNow += 180;
    mobs.update(0.18,player,plains.getTile,plains.setTile);
  }
  assert.ok(hits.some(h=>h.opts?.cause==='thunder_bison_charge'), 'a thunder bison charge can hit a hero who fails to dodge');
  simNow += 1500;
  mobs.update(0.12,player,plains.getTile,plains.setTile);
  assert.equal(mobs.serialize().list[0].state, 'stunned', 'a spent thunder-bison charge creates a short punish window');
  player.xp = 0;
  const chargedBison = mobs.serialize().list[0];
  assert.equal(mobs.damageAt(Math.floor(chargedBison.x),Math.floor(chargedBison.y),999,{source:'hero'}), true, 'thunder bison can be defeated through the normal mob damage API');
  assert.ok(player.xp >= species.THUNDER_BISON.xp, 'defeating a thunder bison awards XP');

  worldGen.biomeType = () => 0;
  const temple = makeTileWorld(T.GRASS, {
    '3,9':T.CHEST_RARE,
    '2,9':T.OBSIDIAN,
    '4,8':T.TORCH
  });
  assert.equal(species.TEMPLE_GUARD.spawnTest(0,9,temple.getTile), true, 'temple guards spawn near forest temple treasure signals');
  worldGen.biomeType = () => 1;
  assert.equal(species.TEMPLE_GUARD.spawnTest(0,9,temple.getTile), false, 'temple guards reject ordinary plains ruins');

  worldGen.biomeType = () => 0;
  player = resetPlayer(8,9.15);
  hits = installDamageRecorder(player);
  mobs.clearAll();
  mobs.deserialize({v:4,list:[{id:'TEMPLE_GUARD',x:0.5,y:9.5,vx:0,vy:0,hp:30,maxHp:30,state:'idle',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{}}});
  mobs.freezeSpawns(10000);
  assert.equal(mobs.nearestHostileLiving(0.5,9.5,12)?.id, undefined, 'temple guards are not hostile before provocation');
  player.x=0.55; player.y=9.15;
  simNow += 120;
  mobs.update(0.08,player,temple.getTile,temple.setTile);
  assert.equal(hits.length, 0, 'standing close to temple treasure warns but does not make guards bite');

  const treasureAlarm = mobs.notifyTempleDisturbed(3,9,{kind:'treasure',getTile:temple.getTile,temple:{minX:-5,maxX:6,minY:7,maxY:12}});
  assert.equal(treasureAlarm.alerted, 1, 'stealing temple treasure alerts the local guardian');
  assert.equal(mobs.nearestHostileLiving(0.5,9.5,12)?.id, 'TEMPLE_GUARD', 'treasure theft makes the guardian hostile');
  assert.ok(mobs.serialize().list[0].templeAggroMs > 0, 'temple alarm hostility persists across saves');
  simNow += 120;
  mobs.update(0.08,player,temple.getTile,temple.setTile);
  assert.ok(hits.length>=1, 'a treasure alarm makes temple guards pressure the hero in melee');

  player = resetPlayer(0.55,9.15);
  hits = installDamageRecorder(player);
  mobs.clearAll();
  mobs.deserialize({v:4,list:[{id:'TEMPLE_GUARD',x:0.5,y:9.5,vx:0,vy:0,hp:30,maxHp:30,state:'idle',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{}}});
  mobs.freezeSpawns(10000);
  const structureAlarm = mobs.notifyTempleDisturbed(2,9,{kind:'structure',getTile:temple.getTile,temple:{minX:-5,maxX:6,minY:7,maxY:12}});
  assert.equal(structureAlarm.alerted, 1, 'damaging temple structure alerts the local guardian');
  assert.equal(mobs.nearestHostileLiving(0.5,9.5,12)?.id, 'TEMPLE_GUARD', 'temple vandalism makes the guardian hostile');

  player = resetPlayer(8,9.15);
  hits = installDamageRecorder(player);
  mobs.clearAll();
  mobs.deserialize({v:4,list:[{id:'TEMPLE_GUARD',x:0.5,y:9.5,vx:0,vy:0,hp:30,maxHp:30,state:'idle',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{}}});
  mobs.freezeSpawns(10000);
  assert.equal(mobs.attackAt(0,9,0,{source:'hero'}), true, 'attacking a temple guard wakes the guardian');
  assert.equal(mobs.nearestHostileLiving(0.5,9.5,12)?.id, 'TEMPLE_GUARD', 'provoked temple guards become hostile targets');
  player.x=0.55; player.y=9.15;
  simNow += 120;
  mobs.update(0.08,player,temple.getTile,temple.setTile);
  assert.ok(hits.length>=1, 'provoked temple guards pressure the hero in melee');

  player.xp = 0;
  assert.equal(mobs.damageAt(0,9,999,{source:'hero'}), true, 'temple guards can be defeated through the normal mob damage API');
  assert.ok(player.xp >= species.TEMPLE_GUARD.xp, 'defeating a temple guard awards XP');

  worldGen.biomeType = () => 2;
  const snow = makeTileWorld(T.SNOW);
  assert.equal(species.ICE_WRAITH.spawnTest(0,9,snow.getTile), true, 'ice wraiths spawn veiled over snow cover');
  assert.equal(species.JACKPOT_YETI.spawnTest(0,9,snow.getTile), true, 'jackpot yetis spawn on broad snow cover');
  worldGen.biomeType = () => 1;
  assert.equal(species.ICE_WRAITH.spawnTest(0,9,snow.getTile), false, 'ice wraiths reject non-snow biomes');
  assert.equal(species.JACKPOT_YETI.spawnTest(0,9,snow.getTile), false, 'jackpot yetis reject non-snow biomes');

  worldGen.biomeType = () => 2;
  player = resetPlayer(0.55,9.15);
  hits = installDamageRecorder(player);
  mobs.clearAll();
  mobs.deserialize({v:5,list:[{id:'ICE_WRAITH',x:0.5,y:9.15,vx:0,vy:0,hp:26,maxHp:26,state:'veiled',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{}}});
  mobs.freezeSpawns(10000);
  simNow += 120;
  mobs.update(0.08,player,snow.getTile,snow.setTile);
  assert.ok(hits.some(h=>h.opts?.cause==='ice_wraith_frost'), 'a close hero wakes a veiled ice wraith into frost contact pressure');

  player = resetPlayer(0.55,9.15);
  hits = installDamageRecorder(player);
  const torchSnow = makeTileWorld(T.SNOW, {'1,9':T.TORCH});
  mobs.clearAll();
  mobs.deserialize({v:5,list:[{id:'ICE_WRAITH',x:0.5,y:9.15,vx:0,vy:0,hp:26,maxHp:26,state:'manifest',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{ICE_WRAITH:60000}}});
  mobs.freezeSpawns(10000);
  simNow += 120;
  mobs.update(0.08,player,torchSnow.getTile,torchSnow.setTile);
  assert.equal(hits.length, 0, 'torchlight suppresses ice-wraith frost pressure');
  assert.ok(mobs.serialize().list[0].pacifiedMs > 0, 'torch-suppressed ice wraiths persist a visible calm timer');

  player = resetPlayer(14.5,9.15);
  player.vx = 5.4;
  hits = installDamageRecorder(player);
  mobs.clearAll();
  mobs.deserialize({v:5,list:[{id:'ICE_WRAITH',x:0.5,y:9.15,vx:0,vy:0,hp:26,maxHp:26,state:'manifest',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{ICE_WRAITH:60000}}});
  mobs.freezeSpawns(10000);
  simNow += 3400;
  mobs.update(0.08,player,snow.getTile,snow.setTile);
  const blinkedWraith = mobs.serialize().list[0];
  assert.equal(blinkedWraith.state, 'whiteout', 'an outpaced ice wraith vanishes into a whiteout blink');
  assert.ok(blinkedWraith.x > player.x + 2, 'ice wraith reappears ahead of a fleeing hero in the snow');

  player.xp = 0;
  assert.equal(mobs.damageAt(Math.floor(blinkedWraith.x),Math.floor(blinkedWraith.y),999,{source:'hero'}), true, 'ice wraiths can be defeated through the normal mob damage API');
  assert.ok(player.xp >= species.ICE_WRAITH.xp, 'defeating an ice wraith awards XP');

  player = resetPlayer(0.65,9.15);
  hits = installDamageRecorder(player);
  mobs.clearAll();
  mobs.deserialize({v:5,list:[{id:'JACKPOT_YETI',x:0.5,y:9.15,vx:0,vy:0,hp:152,maxHp:152,state:'prowling',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{}}});
  mobs.freezeSpawns(10000);
  simNow += 2600;
  mobs.update(0.08,player,snow.getTile,snow.setTile);
  assert.ok(hits.some(h=>h.opts?.cause==='jackpot_yeti_slam'), 'a close jackpot yeti lands an identifiable snow-slam hit');

  const previousYetiInvasions = MM.invasions;
  const yetiCommanders = [];
  MM.invasions = {
    spawnRuinCommander(x,y,opts){
      yetiCommanders.push({x,y,opts});
      return {id:'golden_yeti_commander_stub'};
    }
  };
  const savedYetiRandom = Math.random;
  try{
    Math.random = () => 0.05;
    player = resetPlayer(0.5,9.15);
    mobs.clearAll();
    mobs.deserialize({v:5,list:[{id:'JACKPOT_YETI',x:0.5,y:9.15,vx:0,vy:0,hp:152,maxHp:152,state:'prowling',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{}}});
    mobs.freezeSpawns(10000);
    assert.equal(mobs.damageAt(0,9,999,{source:'hero'}), true, 'jackpot yetis can be defeated through the normal mob damage API');
    assert.ok(player.xp >= species.JACKPOT_YETI.xp, 'defeating a jackpot yeti awards major XP');
    assert.equal(yetiCommanders.length, 1, 'one-in-ten jackpot yeti deaths can reveal a golden alien commander');
    assert.ok(String(yetiCommanders[0].opts?.key||'').startsWith('yeti:'), 'jackpot yeti commander reveal uses a yeti-specific key');
    assert.ok(yetiCommanders[0].opts?.threatBonus >= 12, 'jackpot yeti commanders inherit an elite threat bonus');
  } finally {
    Math.random = savedYetiRandom;
    if(previousYetiInvasions) MM.invasions = previousYetiInvasions;
    else delete MM.invasions;
  }

  worldGen.biomeType = () => 4;
  const swamp = makeTileWorld(T.MUD, {'2,10':T.WATER});
  assert.equal(species.BOG_LURKER.spawnTest(0,9,swamp.getTile), true, 'bog lurkers spawn from swamp muck near water');
  worldGen.biomeType = () => 1;
  assert.equal(species.BOG_LURKER.spawnTest(0,9,swamp.getTile), false, 'bog lurkers reject non-swamp muck');

  worldGen.biomeType = () => 4;
  player = resetPlayer(0.55,9.15);
  hits = installDamageRecorder(player);
  mobs.clearAll();
  mobs.deserialize({v:4,list:[{id:'BOG_LURKER',x:0.5,y:9.5,vx:0,vy:0,hp:28,maxHp:28,state:'submerged',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{}}});
  mobs.freezeSpawns(10000);
  simNow += 120;
  mobs.update(0.08,player,swamp.getTile,swamp.setTile);
  assert.ok(hits.length>=1, 'a hero slogging through muck triggers a bog-lurker bite');
  assert.equal(hits[0].opts?.cause, 'bog_poison', 'bog lurker contact is identifiable poison pressure');

  const torchSwamp = makeTileWorld(T.MUD, {'2,10':T.WATER,'1,8':T.TORCH});
  player = resetPlayer(0.55,9.15);
  hits = installDamageRecorder(player);
  mobs.clearAll();
  mobs.deserialize({v:4,list:[{id:'BOG_LURKER',x:0.5,y:9.5,vx:0,vy:0,hp:28,maxHp:28,state:'ambush',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{}}});
  mobs.freezeSpawns(10000);
  simNow += 120;
  mobs.update(0.08,player,torchSwamp.getTile,torchSwamp.setTile);
  assert.equal(hits.length, 0, 'torchlight suppresses bog-lurker ambush pressure');
  assert.ok(mobs.serialize().list[0].pacifiedMs > 0, 'torch-suppressed bog lurkers persist a short calm timer');

  player = resetPlayer(0.55,9.15);
  hits = installDamageRecorder(player);
  mobs.clearAll();
  mobs.deserialize({v:4,list:[{id:'BOG_LURKER',x:0.5,y:9.5,vx:0,vy:0,hp:28,maxHp:28,state:'ambush',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{BOG_LURKER:60000}}});
  mobs.freezeSpawns(10000);
  assert.equal(mobs.igniteRadius(0.5,9.5,2,{source:'hero',cause:'flame'}), 1, 'fire weapons can light bog lurkers');
  simNow += 120;
  mobs.update(0.08,player,swamp.getTile,swamp.setTile);
  assert.equal(hits.length, 0, 'burning bog lurkers stop biting long enough to reposition');
  player.xp = 0;
  assert.equal(mobs.damageAt(0,9,999,{source:'hero'}), true, 'bog lurkers can be defeated through the normal mob damage API');
  assert.ok(player.xp >= species.BOG_LURKER.xp, 'defeating a bog lurker awards XP');

  worldGen.biomeType = () => 6;
  const lake = makeWaterTileWorld(T.STONE, -5, 5, 4, 9);
  assert.equal(species.LAKE_SERPENT.spawnTest(0,6,lake.getTile), true, 'lake serpents spawn in broad lake water columns');
  worldGen.biomeType = () => 5;
  assert.equal(species.LAKE_SERPENT.spawnTest(0,6,lake.getTile), false, 'lake serpents reject sea water already owned by ocean predators');

  worldGen.biomeType = () => 6;
  player = resetPlayer(0.55,6.2);
  hits = installDamageRecorder(player);
  mobs.clearAll();
  mobs.deserialize({v:5,list:[{id:'LAKE_SERPENT',x:1.7,y:6.5,vx:0,vy:0,hp:42,maxHp:42,state:'patrol',facing:-1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{LAKE_SERPENT:60000}}});
  mobs.freezeSpawns(10000);
  simNow += 2200;
  mobs.update(0.42,player,lake.getTile,lake.setTile);
  assert.ok(hits.some(h=>h.opts?.cause==='lake_serpent_shock'), 'a wet hero triggers a charged lake-serpent shock');
  const shockedSerpent = mobs.serialize().list[0];
  assert.ok(shockedSerpent.state === 'charged', 'lake serpent remains in charged pursuit while the hero is in lake water');
  player.xp = 0;
  assert.equal(mobs.damageAt(Math.floor(shockedSerpent.x),Math.floor(shockedSerpent.y),999,{source:'hero'}), true, 'lake serpents can be defeated through the normal mob damage API');
  assert.ok(player.xp >= species.LAKE_SERPENT.xp, 'defeating a lake serpent awards XP');

  worldGen.biomeType = () => 5;
  const ocean = makeWaterTileWorld(T.STONE, -8, 8, 2, 12);
  assert.equal(species.JACKPOT_WHALE.spawnTest(0,6,ocean.getTile), true, 'jackpot whales spawn in broad deep sea water');
  worldGen.biomeType = () => 6;
  assert.equal(species.JACKPOT_WHALE.spawnTest(0,6,ocean.getTile), false, 'jackpot whales reject lake water despite depth');

  worldGen.biomeType = () => 5;
  player = resetPlayer(0.55,6.2);
  hits = installDamageRecorder(player);
  mobs.clearAll();
  mobs.deserialize({v:5,list:[{id:'JACKPOT_WHALE',x:1.25,y:6.5,vx:0,vy:0,hp:220,maxHp:220,state:'cruising',facing:-1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{JACKPOT_WHALE:60000}}});
  mobs.freezeSpawns(10000);
  simNow += 3200;
  mobs.update(0.42,player,ocean.getTile,ocean.setTile);
  assert.ok(hits.some(h=>h.opts?.cause==='jackpot_whale_ram'), 'a wet hero triggers an identifiable jackpot-whale ram');

  const previousWhaleInvasions = MM.invasions;
  const whaleCommanders = [];
  MM.invasions = {
    spawnRuinCommander(x,y,opts){
      whaleCommanders.push({x,y,opts});
      return {id:'golden_whale_commander_stub'};
    }
  };
  const savedWhaleRandom = Math.random;
  try{
    Math.random = () => 0.05;
    player = resetPlayer(0.5,6.2);
    mobs.clearAll();
    mobs.deserialize({v:5,list:[{id:'JACKPOT_WHALE',x:0.5,y:6.5,vx:0,vy:0,hp:220,maxHp:220,state:'cruising',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{}}});
    mobs.freezeSpawns(10000);
    assert.equal(mobs.damageAt(0,6,999,{source:'hero'}), true, 'jackpot whales can be defeated through the normal mob damage API');
    assert.ok(player.xp >= species.JACKPOT_WHALE.xp, 'defeating a jackpot whale awards major XP');
    assert.equal(whaleCommanders.length, 1, 'one-in-ten jackpot whale deaths can reveal a golden alien commander');
    assert.ok(String(whaleCommanders[0].opts?.key||'').startsWith('whale:'), 'jackpot whale commander reveal uses a whale-specific key');
    assert.ok(whaleCommanders[0].opts?.threatBonus >= 14, 'jackpot whale commanders inherit an elite threat bonus');
  } finally {
    Math.random = savedWhaleRandom;
    if(previousWhaleInvasions) MM.invasions = previousWhaleInvasions;
    else delete MM.invasions;
  }

  player = resetPlayer(0.55,6.2);
  hits = installDamageRecorder(player);
  let eelEnergy = 0;
  let eelEnergyCause = null;
  MM.heroEnergy = {
    info:()=>({energy:eelEnergy,max:50}),
    chargeExternal(amount,opts){ eelEnergy += amount; eelEnergyCause = opts && opts.cause; return amount; }
  };
  mobs.clearAll();
  mobs.deserialize({v:5,list:[{id:'EEL',x:0.55,y:6.2,vx:0,vy:0,hp:10,maxHp:10,state:'patrol',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{EEL:60000}}});
  mobs.freezeSpawns(10000);
  simNow += 500;
  mobs.update(0.12,player,lake.getTile,lake.setTile);
  assert.ok(hits.some(h=>h.opts?.cause==='eel_shock'), 'electric eels deal identifiable electric shock damage');
  assert.ok(Math.abs(eelEnergy-(hits[0].amount/100)*50)<0.001, 'eel shock converts the same lost-health percent into hero energy');
  assert.equal(eelEnergyCause, 'eel_shock', 'eel energy gain is marked as electric shock feedback');
  delete MM.heroEnergy;

  worldGen.biomeType = () => 7;
  const mountain = makeTileWorld(T.STONE, {'2,9':T.DIAMOND,'-2,10':T.GRANITE});
  assert.equal(species.STONE_GOLEM.spawnTest(0,9,mountain.getTile), true, 'stone golems spawn near mountain mineral outcrops');
  worldGen.biomeType = () => 1;
  assert.equal(species.STONE_GOLEM.spawnTest(0,9,mountain.getTile), false, 'stone golems reject ordinary plains stone');

  worldGen.biomeType = () => 7;
  player = resetPlayer(0.55,9.15);
  hits = installDamageRecorder(player);
  mobs.clearAll();
  mobs.deserialize({v:4,list:[{id:'STONE_GOLEM',x:0.5,y:9.124,vx:0,vy:0,hp:54,maxHp:54,state:'dormant',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{}}});
  mobs.freezeSpawns(10000);
  simNow += 120;
  mobs.update(0.08,player,mountain.getTile,mountain.setTile);
  assert.ok(hits.length>=1, 'approaching mountain minerals wakes a stone golem into melee pressure');

  player = resetPlayer(10.5,9.15);
  player.vx = 3.8;
  hits = installDamageRecorder(player);
  mobs.clearAll();
  mobs.deserialize({v:4,list:[{id:'STONE_GOLEM',x:0.5,y:9.124,vx:0,vy:0,hp:54,maxHp:54,state:'charging',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0,aimLead:0.6}],aggro:{mode:'rel',m:{STONE_GOLEM:60000}}});
  mobs.freezeSpawns(10000);
  simNow += 120;
  mobs.update(0.08,player,mountain.getTile,mountain.setTile);
  const golemRock = mobs._debugCombat().projectiles.find(p=>p.type==='rock');
  assert.ok(golemRock, 'an awakened stone golem throws rocks at a kiting hero');
  assert.equal(golemRock.cause, 'stone_golem_rock', 'stone-golem thrown rocks carry identifiable damage cause');
  assert.ok(golemRock.aimX > player.x, 'stone-golem rock leads a moving hero instead of only targeting the current position');

  player = resetPlayer(0.55,9.15);
  hits = installDamageRecorder(player);
  mobs.clearAll();
  mobs.deserialize({v:4,list:[{id:'STONE_GOLEM',x:0.5,y:9.124,vx:0,vy:0,hp:54,maxHp:54,state:'charging',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],aggro:{mode:'rel',m:{STONE_GOLEM:60000}}});
  mobs.freezeSpawns(10000);
  assert.equal(mobs.douseRadius(0.5,9.5,2), 1, 'water hose cracks and calms stone golems');
  assert.ok(mobs.serialize().list[0].hp < 54, 'water dousing chips some stone-golem health');
  simNow += 120;
  mobs.update(0.08,player,mountain.getTile,mountain.setTile);
  assert.equal(hits.length, 0, 'a doused stone golem does not keep crushing through aggro');
  player.xp = 0;
  assert.equal(mobs.damageAt(0,9,999,{source:'hero'}), true, 'stone golems can be defeated through the normal mob damage API');
  assert.ok(player.xp >= species.STONE_GOLEM.xp, 'defeating a stone golem awards XP');

  worldGen.biomeType = () => 7;
  worldGen.volcanoAt = () => null;
  const vultureSlope = makeTileWorld(T.STONE);
  assert.equal(species.VULTURE.spawnTest(0,5,vultureSlope.getTile), true, 'vultures can nest above mountain rock');
  worldGen.biomeType = () => 1;
  assert.equal(species.VULTURE.spawnTest(0,5,vultureSlope.getTile), false, 'vultures reject ordinary plains air');
  worldGen.volcanoAt = () => ({center:0,radius:18,crater:3});
  assert.equal(species.VULTURE.spawnTest(0,5,vultureSlope.getTile), true, 'vultures also accept volcano columns as attack territory');

  worldGen.biomeType = () => 7;
  worldGen.volcanoAt = () => null;
  player = resetPlayer(0.5,8.5);
  hits = installDamageRecorder(player);
  mobs.clearAll();
  const seededAgain = Math.random;
  Math.random = () => 0;
  mobs.deserialize({v:5,list:[{id:'VULTURE',x:6.5,y:5.8,vx:0,vy:0,hp:24,maxHp:24,state:'perched',facing:-1,scale:1,speedMul:1,jumpMul:1,attackCd:0,nestX:6,nestY:8}],aggro:{mode:'rel',m:{}}});
  mobs.freezeSpawns(10000);
  assert.equal(mobs.nearestHostileLiving(6.5,5.8,12)?.id, undefined, 'nesting vultures are not hostile targets before a dive or provocation');
  simNow += 5200;
  mobs.update(0.08,player,vultureSlope.getTile,vultureSlope.setTile);
  Math.random = seededAgain;
  const divingVulture=mobs.nearestHostileLiving(6.5,5.8,40);
  assert.equal(divingVulture?.id, 'VULTURE', 'a passive vulture can opportunistically start a hostile dive in mountain territory');

  const legacyVultureNest = makeTileWorld(T.STONE, {
    '4,8':T.WOOD, '5,8':T.WOOD, '6,8':T.WOOD,
    '3,7':T.LEAF, '4,7':T.LEAF, '6,7':T.LEAF, '7,7':T.LEAF,
    '4,6':T.LEAF, '6,6':T.LEAF
  });
  player = resetPlayer(5.5,8.5);
  mobs.clearAll();
  mobs.deserialize({v:5,list:[{id:'VULTURE',x:5.5,y:6.8,vx:0,vy:0,hp:24,maxHp:24,state:'perched',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0,nestX:5,nestY:8}],aggro:{mode:'rel',m:{}}});
  mobs.freezeSpawns(10000);
  simNow += 120;
  mobs.update(0.08,player,legacyVultureNest.getTile,legacyVultureNest.setTile);
  const repairedVulture=mobs.serialize().list.find(m=>m.id==='VULTURE');
  assert.equal(repairedVulture?.nestY, 9, 'legacy floating vulture nests are snapped down onto the nearest stable ledge');
  assert.equal(legacyVultureNest.getTile(5,8), T.AIR, 'old unsupported vulture nest wood is cleaned instead of becoming a second layer');
  assert.equal(legacyVultureNest.getTile(5,9), T.WOOD, 'repaired vulture nest has one supported platform row');
  assert.equal(legacyVultureNest.getTile(5,10), T.STONE, 'repaired vulture platform rests directly over mountain rock');

  player = resetPlayer(0.5,8.5);
  hits = installDamageRecorder(player);
  mobs.clearAll();
  mobs.deserialize({v:5,list:[{id:'VULTURE',x:0.5,y:8.5,vx:0,vy:0,hp:24,maxHp:24,state:'dive',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0,nestX:5,nestY:8,vultureCapture:0}],aggro:{mode:'rel',m:{}}});
  mobs.freezeSpawns(10000);
  simNow += 120;
  mobs.update(0.08,player,vultureSlope.getTile,vultureSlope.setTile);
  assert.ok(hits.length>=1, 'a diving vulture can hit the hero with talons');
  assert.equal(hits[0].opts?.cause, 'vulture_talon', 'vulture talon damage is identifiable');

  player = resetPlayer(0.5,8.5);
  hits = installDamageRecorder(player);
  mobs.clearAll();
  mobs.deserialize({v:5,list:[{id:'VULTURE',x:0.5,y:8.5,vx:0,vy:0,hp:24,maxHp:24,state:'dive',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0,nestX:5,nestY:8,vultureCapture:1}],aggro:{mode:'rel',m:{}}});
  mobs.freezeSpawns(10000);
  simNow += 120;
  mobs.update(0.08,player,vultureSlope.getTile,vultureSlope.setTile);
  assert.equal(mobs.serialize().list.find(m=>m.id==='VULTURE')?.state, 'carry', 'a capture begins as visible vulture carry instead of an instant teleport');
  assert.ok(Math.abs(player.x-5.5)>1, 'the hero is not teleported to the nest on the capture frame');
  for(let i=0;i<60;i++){
    simNow += 120;
    mobs.update(0.12,player,vultureSlope.getTile,vultureSlope.setTile);
    if(mobs.serialize().list.filter(m=>m.id==='VULTURE_HATCHLING').length>=3) break;
  }
  assert.ok(Math.abs(player.x-5.5)<0.25 && player.y<8, 'the carry flight releases the hero at the vulture nest');
  assert.equal(vultureSlope.getTile(5,9), T.WOOD, 'capture materializes a supported nest platform without a tall wooden tower');
  assert.notEqual(vultureSlope.getTile(5,8), T.WOOD, 'vulture nests do not leave a second wooden platform above the supported row');
  assert.equal(mobs.serialize().list.find(m=>m.id==='VULTURE')?.nestGroundY, 10, 'vulture nest ground anchor is persisted for stable save/load');
  const afterNest=mobs.serialize().list;
  const hatchling=afterNest.find(m=>m.id==='VULTURE_HATCHLING');
  assert.ok(afterNest.filter(m=>m.id==='VULTURE_HATCHLING').length>=3, 'capture spawns hatchlings in the nest');
  assert.equal(mobs.nearestHostileLiving(hatchling.x,hatchling.y,1.2,{preferHeroFocus:false})?.id, 'VULTURE_HATCHLING', 'hatchlings immediately defend the nest');
} finally {
  Math.random = originalRandom;
  worldGen.biomeType = originalBiomeType;
  worldGen.volcanoAt = originalVolcanoAt;
  mobs.clearAll();
  meat.reset();
  delete globalThis.damageHero;
  delete globalThis.msg;
}

console.log('biome-pressure-sim: all assertions passed');
