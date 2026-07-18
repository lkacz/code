// Gold guardian regression tests: exposed underground gold veins are defended
// by high-stakes guardians instead of being unconditional free ore.
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.CustomEvent = class { constructor(type,opts){ this.type=type; this.detail=opts&&opts.detail; } };
globalThis.dispatchEvent = () => true;
globalThis.localStorage = { getItem(){ return null; }, setItem(){}, removeItem(){} };
let simNow = 0;
globalThis.performance = { now:()=>simNow };
globalThis.msg = () => {};
let gameDayFloat=1.25;
globalThis.MM.seasons = { metrics(){ return {dayFloat:gameDayFloat}; } };

const { T } = await import('../src/constants.js');
const { weapons } = await import('../src/engine/weapons.js');
const { mobs } = await import('../src/engine/mobs.js');

const originalRandom = Math.random;
let seed = 246813579;
function seededRandom(){
  seed = (Math.imul(seed,1664525)+1013904223)>>>0;
  return seed/4294967296;
}

function makeGoldCave(offsetX=0){
  const cells = new Map();
  const key=(x,y)=>Math.floor(x)+','+Math.floor(y);
  for(let x=-3; x<=5; x++) cells.set(key(x+offsetX,12), T.STONE);
  [[-1,12],[0,12],[1,12],[2,12],[3,12],[0,13],[1,13],[2,13]].forEach(([x,y])=>cells.set(key(x+offsetX,y),T.GOLD_ORE));
  return {
    getTile(x,y){
      const k=key(x,y);
      if(cells.has(k)) return cells.get(k);
      return y>=12 ? T.STONE : T.AIR;
    },
    setTile(x,y,t){
      const k=key(x,y);
      if(t===T.AIR) cells.delete(k);
      else cells.set(k,t);
    }
  };
}

function makeEmptyCave(){
  return {
    getTile(x,y){ return y>=12 ? T.STONE : T.AIR; },
    setTile(){}
  };
}

function resetPlayer(x=0.5,y=10.8){
  const p={x,y,w:0.7,h:0.95,vx:0,vy:0,onGround:true,facing:1,hp:100,maxHp:100,hpInvul:0,xp:0};
  globalThis.player=p;
  return p;
}

function installDamageRecorder(player){
  const hits=[];
  globalThis.damageHero = (amount,opts)=>{
    hits.push({amount,opts});
    player.hp -= amount;
    return true;
  };
  return hits;
}

try{
  Math.random = seededRandom;
  const species = mobs._debugSpecies();
  assert.ok(species.GOLD_DRAGON && mobs.species.includes('GOLD_DRAGON'), 'gold dragon guardian species is registered');
  assert.ok(species.GOLD_DWARF_GUARD && mobs.species.includes('GOLD_DWARF_GUARD'), 'gold dwarf guardian species is registered');
  assert.ok(species.GOLD_DRAGON.hp >= 200 && species.GOLD_DRAGON.dmg >= 35 && species.GOLD_DRAGON.xp >= 260, 'gold dragons are tuned as major hoard guardians');
  assert.ok(species.GOLD_DWARF_GUARD.hp >= 70 && species.GOLD_DWARF_GUARD.dmg >= 20 && species.GOLD_DWARF_GUARD.xp >= 80, 'gold dwarves are tuned as strong mine guardians');
  assert.equal(species.GOLD_DWARF_GUARD.max,10,'no more than ten gold dwarves can be alive at once');

  const cave = makeGoldCave();
  const empty = makeEmptyCave();
  // The same cave geometry is considered shallow first: neither direct spawn
  // tests nor the automatic scanner may leak the buried vein to a surface hero.
  globalThis.MM.worldGen = { surfaceHeight(){ return 10; } };
  assert.equal(species.GOLD_DRAGON.spawnTest(1,11,cave.getTile), false, 'gold dragons cannot spawn in a daylight-shallow cave');
  assert.equal(species.GOLD_DWARF_GUARD.spawnTest(1,11,cave.getTile), false, 'gold dwarves cannot spawn in a daylight-shallow cave');
  let player = resetPlayer(1.2,10.8);
  installDamageRecorder(player);
  mobs.clearAll();
  simNow += 5200;
  mobs.update(0.16,player,cave.getTile,cave.setTile);
  const surfaceGuards=mobs.serialize().list.filter(m=>m.id==='GOLD_DRAGON' || m.id==='GOLD_DWARF_GUARD');
  assert.equal(surfaceGuards.length,0,'walking above buried gold never summons a revealing surface guardian');

  // Once the hero is genuinely underground, the original guarded-vein
  // encounter remains active.
  globalThis.MM.worldGen.surfaceHeight = ()=>5;
  assert.equal(species.GOLD_DRAGON.spawnTest(1,11,cave.getTile), true, 'gold dragons can stand in a roomy cave beside exposed gold');
  assert.equal(species.GOLD_DWARF_GUARD.spawnTest(1,11,cave.getTile), true, 'gold dwarves can stand in a cave beside exposed gold');
  assert.equal(species.GOLD_DRAGON.spawnTest(1,11,empty.getTile), false, 'gold dragons do not spawn without a gold vein to guard');
  assert.equal(species.GOLD_DWARF_GUARD.spawnTest(1,11,empty.getTile), false, 'gold dwarves do not spawn without a gold vein to guard');

  player = resetPlayer(1.2,10.8);
  installDamageRecorder(player);
  mobs.clearAll();
  simNow += 5200;
  mobs.update(0.16,player,cave.getTile,cave.setTile);
  const autoGuards = mobs.serialize().list.filter(m=>m.id==='GOLD_DRAGON' || m.id==='GOLD_DWARF_GUARD');
  assert.ok(autoGuards.length >= 1, 'an exposed nearby gold vein automatically gets a guardian');
  assert.ok(autoGuards.every(m=>m.goldGuardKey && Number.isFinite(m.guardGoldX) && Number.isFinite(m.guardGoldY)), 'gold guardians remember which vein they defend');

  const gasAdds=[];
  const fireHits=[];
  globalThis.MM.gases = { add(kind,x,y,opts){ gasAdds.push({kind,x,y,opts}); return 1; } };
  globalThis.MM.fire = { ignite(x,y,getTile,setTile){ fireHits.push({x,y}); return true; } };
  player = resetPlayer(6.5,10.7);
  player.vx = 2.4;
  installDamageRecorder(player);
  mobs.clearAll();
  weapons.reset();
  simNow += 5200;
  mobs.deserialize({v:5,list:[{
    id:'GOLD_DRAGON',x:0.5,y:10.75,vx:0,vy:0,hp:210,maxHp:210,state:'hoard',facing:1,
    scale:1,speedMul:1,jumpMul:1,attackCd:0,goldGuardKey:'0,1',guardGoldX:1.5,guardGoldY:12.5
  }],aggro:{mode:'rel',m:{}}});
  mobs.freezeSpawns(10000);
  simNow += 2600;
  mobs.update(0.12,player,cave.getTile,cave.setTile);
  const dragonFlames = weapons._debug.puffs.filter(p=>p.kind==='flame' && p.cause==='gold_dragon_fire' && p.ownerId==='GOLD_DRAGON');
  assert.ok(dragonFlames.length >= 1, 'gold dragons emit the shared flamethrower-style flame stream');
  assert.equal(mobs.metrics().projectiles, 0, 'gold dragon fire breath no longer needs a separate projectile');
  assert.ok(gasAdds.length >= 1, 'gold dragon breath or exhale emits dangerous cave gas');

  player = resetPlayer(1.6,10.72);
  const hits = installDamageRecorder(player);
  mobs.clearAll();
  simNow += 5200;
  mobs.deserialize({v:5,list:[{
    id:'GOLD_DWARF_GUARD',x:0.5,y:10.75,vx:0,vy:0,hp:76,maxHp:76,state:'guard',facing:1,
    scale:1,speedMul:1,jumpMul:1,attackCd:0,goldGuardKey:'0,1',guardGoldX:1.5,guardGoldY:12.5
  }],aggro:{mode:'rel',m:{}}});
  mobs.freezeSpawns(10000);
  simNow += 2400;
  mobs.update(0.12,player,cave.getTile,cave.setTile);
  assert.ok(hits.some(h=>h.opts && h.opts.cause==='gold_dwarf_hammer'), 'gold dwarf guards have an identifiable hammer strike');

  // Killing a guardian used to make the same vein immediately summon another
  // one. The cooldown belongs to the coarse vein area, not to the whole world.
  gameDayFloat=5.25;
  Math.random=()=>0.99; // rich vein consistently chooses dwarves, not a dragon
  mobs.clearAll();
  player=resetPlayer(1.2,10.8);
  installDamageRecorder(player);
  simNow+=5200;
  mobs.update(0.16,player,cave.getTile,cave.setTile);
  let areaState=mobs.goldGuardAreaState();
  assert.ok(areaState.liveDwarfs>=1,'the first visit spawns one dwarf encounter at the vein');
  assert.equal(areaState.areas.length,1,'the first defended vein records exactly one used area for the day');

  const firstAreaDay=mobs.serialize().goldGuardAreas;
  mobs.deserialize({v:6,list:[],aggro:{mode:'rel',m:{}},goldGuardAreas:firstAreaDay});
  simNow+=5200;
  mobs.update(0.16,player,cave.getTile,cave.setTile);
  assert.equal(mobs.goldGuardAreaState().liveDwarfs,0,'a defeated dwarf encounter cannot respawn at the same vein that day');

  const eastCave=makeGoldCave(36);
  player=resetPlayer(37.2,10.8);
  installDamageRecorder(player);
  simNow+=5200;
  mobs.update(0.16,player,eastCave.getTile,eastCave.setTile);
  areaState=mobs.goldGuardAreaState();
  assert.ok(areaState.liveDwarfs>=1,'a different gold-vein area can still spawn dwarves on the same day');
  assert.equal(areaState.areas.length,2,'daily usage is tracked independently for separate vein areas');

  // Dragon and dwarf encounters share the same area marker: changing the
  // randomly chosen guardian type cannot bypass the once-per-area rule.
  gameDayFloat=6.25;
  Math.random=()=>0; // rich vein consistently chooses a dragon
  const previousDay=mobs.serialize().goldGuardAreas;
  mobs.deserialize({v:6,list:[],aggro:{mode:'rel',m:{}},goldGuardAreas:previousDay});
  player=resetPlayer(1.2,10.8);
  simNow+=5200;
  mobs.update(0.16,player,cave.getTile,cave.setTile);
  areaState=mobs.goldGuardAreaState();
  assert.equal(areaState.liveDragons,1,'a new day can choose a dragon for the vein encounter');
  assert.equal(areaState.areas.length,1,'the dragon consumes the same daily area slot as dwarves');

  const dragonAreaDay=mobs.serialize().goldGuardAreas;
  mobs.deserialize({v:6,list:[],aggro:{mode:'rel',m:{}},goldGuardAreas:dragonAreaDay});
  Math.random=()=>0.99;
  simNow+=5200;
  mobs.update(0.16,player,cave.getTile,cave.setTile);
  areaState=mobs.goldGuardAreaState();
  assert.equal(areaState.liveDragons+areaState.liveDwarfs,0,'a defeated dragon cannot be replaced by dwarves in the same area and day');

  gameDayFloat=7.05;
  const savedDaySix=mobs.serialize().goldGuardAreas;
  mobs.deserialize({v:6,list:[],aggro:{mode:'rel',m:{}},goldGuardAreas:savedDaySix});
  simNow+=5200;
  mobs.update(0.16,player,cave.getTile,cave.setTile);
  areaState=mobs.goldGuardAreaState();
  assert.ok(areaState.liveDwarfs>=1,'the same vein may start one new encounter on the next day');
  assert.equal(areaState.day,7,'changing the game day resets the per-area markers');
  assert.equal(areaState.areas.length,1,'the renewed day starts a fresh independent area set');

  const areaRoundTrip=mobs.serialize();
  mobs.deserialize(areaRoundTrip);
  assert.deepEqual(mobs.serialize().goldGuardAreas,areaRoundTrip.goldGuardAreas,'per-area guardian cooldowns survive a save/load round trip');

  const tooMany=Array.from({length:14},(_,i)=>({
    id:'GOLD_DWARF_GUARD',x:i+0.5,y:10.75,vx:0,vy:0,hp:76,maxHp:76,state:'guard',facing:1,
    scale:1,speedMul:1,jumpMul:1,attackCd:0,goldGuardKey:i+',1',guardGoldX:i+0.5,guardGoldY:12.5
  }));
  mobs.deserialize({v:5,list:tooMany,aggro:{mode:'rel',m:{}}});
  assert.equal(mobs.goldGuardAreaState().liveDwarfs,10,'legacy or malformed saves are clamped to ten live gold dwarves');
  assert.equal(mobs.goldGuardAreaState().areas.length,10,'restored live guardians seed their own per-area cooldown markers');

  console.log('gold-guardians-sim: all assertions passed');
} finally {
  Math.random = originalRandom;
}
