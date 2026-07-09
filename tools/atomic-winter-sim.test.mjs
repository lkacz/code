// Atomic winter regression test.
// Verifies the city bomb fallout layer forces winter, storms, toxic rain damage,
// shelter protection, mob rain healing, hero energy trickle, shared dialogue context, and save/restore.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.performance = { now:()=>1000 };

const registered = {};
const forced = [];
let setDayValue = null;
let stormStarts = 0;
let squalls = 0;
let energy = 0;
let damageCalls = 0;
let healCalls = 0;
let shelterRoof = false;
const clouds = [];
const messages = [];

globalThis.msg = (text)=>messages.push(text);
globalThis.player = {x:12.5,y:8.5,vx:1.2,vy:0,hp:100,maxHp:100,energy:0,maxEnergy:50};
globalThis.damageHero = (amount,opts)=>{
  damageCalls++;
  assert.equal(amount, 1, 'toxic rain is a low-grade nuisance tick, not lethal burst damage');
  assert.equal(opts.cause, 'radiation_rain', 'toxic rain damage is tagged');
  globalThis.player.hp -= amount;
  return true;
};

MM.npcSystem = {
  register(id,api){ registered[id]=api; return api; },
  get(id){ return registered[id] || null; }
};
MM.seasons = {
  constants:{DAY_SECONDS:600,DAYS_PER_SEASON:10},
  metrics(){ return {dayFloat:7}; },
  setDay(day){ setDayValue=day; return true; },
  forceSeason(id){ forced.push(id); return true; }
};
MM.clouds = {
  addCloud(x,alt,mass){
    const c={x,alt,mass,raining:false,snowing:false};
    clouds.push(c);
    return c;
  },
  startStorm(duration,intensity){
    stormStarts++;
    assert.ok(duration>=200, 'atomic winter starts a long storm');
    assert.equal(intensity, 1, 'atomic winter uses maximum storm intensity');
    return {duration,intensity};
  },
  isRainingAt(){ return true; }
};
MM.wind = {
  forceSquall(dir,amp,seconds){
    squalls++;
    assert.ok(Math.abs(dir)===1, 'atomic winter squall has a direction');
    assert.ok(amp>=7, 'atomic winter wind reaches storm strength');
    assert.ok(seconds>=100, 'atomic winter wind boost is persistent');
    return true;
  }
};
MM.heroEnergy = {
  chargeExternal(amount,opts){
    assert.equal(opts.cause, 'atomic_winter', 'atomic winter energy gain is tagged');
    energy += amount;
    return amount;
  }
};
MM.mobs = {
  healRadiationRain(centerX,radius,amount){
    healCalls++;
    assert.ok(radius>=80, 'toxic rain heals mobs over the local storm footprint');
    assert.equal(amount, 2, 'toxic rain mob healing uses the configured pulse amount');
    return 2;
  }
};
MM.world = {
  getTile(_x,y){ return shelterRoof && y===6 ? 3 : (y>=10 ? 3 : 0); }
};

const { atomicWinter } = await import('../src/engine/atomic_winter.js');
assert.ok(atomicWinter, 'atomic winter module exports an API');
assert.equal(registered.atomic_winter_messenger, undefined, 'atomic winter does not register a special warning NPC');

atomicWinter.trigger({x:12,y:8,player:globalThis.player,getTile:MM.world.getTile});
assert.equal(setDayValue, 31, 'detonation jumps the season clock to the beginning of winter');
assert.ok(forced.includes('winter'), 'detonation forces winter weather');
assert.ok(stormStarts>=1, 'detonation starts an intense storm');
assert.ok(clouds.length>=7, 'detonation seeds a heavy cloud band');
assert.ok(clouds.every(c=>c.raining && !c.snowing), 'atomic storm clouds are poisonous rain, not snow');
assert.ok(clouds.every(c=>c.atomic && c.toxic), 'atomic storm clouds are flagged for radioactive green rendering');
assert.ok(messages.some(m=>m.includes('nuclear bomb')), 'world event announces the atomic winter trigger');
assert.ok(messages.some(m=>m.includes('until winter ends')), 'world event announces a winter-season fallout duration');
assert.ok(atomicWinter.contextLines('npc').some(m=>/dach|deszcz|energie|potwory/i.test(m)), 'existing NPC context lines explain fallout consequences');
assert.ok(atomicWinter.contextLines('alien').some(m=>/Hero|deszcz|Wiatr|zima/i.test(m)), 'alien context lines explain fallout consequences');
assert.ok(atomicWinter.contextLines('molekin').some(m=>/tunel|dach|opad|zima/i.test(m)), 'underground-team context lines explain fallout consequences');

atomicWinter.update(3.9,globalThis.player,MM.world.getTile);
assert.equal(damageCalls, 0, 'poisonous rain waits several seconds between nuisance damage ticks');
assert.equal(energy, 0, 'short fallout exposure does not yet grant the ten-second energy pulse');
atomicWinter.update(10,globalThis.player,MM.world.getTile);
assert.equal(energy, 1, 'atomic winter grants one energy every ten seconds');
assert.ok(damageCalls>=1, 'poisonous rain damages the hero');
assert.ok(damageCalls<=4, 'poisonous rain damage pulses are intentionally rare');
assert.ok(healCalls>=1, 'poisonous rain heals mobs');
assert.ok(squalls>=1, 'first update applies the day-long wind boost');

const damageBeforeShelter = damageCalls;
const healsBeforeShelter = healCalls;
shelterRoof = true;
atomicWinter.update(1,globalThis.player,MM.world.getTile);
assert.equal(damageCalls, damageBeforeShelter, 'a solid shelter roof blocks poisonous rain damage to the hero');
assert.ok(healCalls>healsBeforeShelter, 'poisonous rain still heals exposed mobs while the hero is sheltered');
shelterRoof = false;

const snap = atomicWinter.snapshot();
assert.equal(snap.active, true, 'active atomic winter is saved');
assert.ok(snap.tLeft > 0, 'atomic winter save includes remaining winter timer');
assert.ok(snap.tLeft <= 6000, 'atomic winter fallout lasts one winter season, not a full year');
assert.equal(Object.hasOwn(snap,'messenger'), false, 'atomic winter save state has no special messenger NPC payload');
atomicWinter.reset();
assert.equal(atomicWinter.metrics().active, false, 'reset clears active fallout');
atomicWinter.restore(snap);
assert.equal(atomicWinter.metrics().active, true, 'restore reactivates fallout');
assert.ok(forced.includes('winter'), 'restore re-holds winter');

atomicWinter.restore({...snap, tLeft:0.2});
atomicWinter.update(0.3,globalThis.player,MM.world.getTile);
assert.equal(atomicWinter.metrics().active, false, 'atomic winter expires after its winter-season timer');
assert.ok(forced.includes('natural'), 'expiration releases forced winter back to the natural season cycle');

const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
assert.match(mainSrc, /function formatSeasonCalendarLabel\(sm\)/, 'main exposes a calendar formatter for atomic winter');
assert.ok(mainSrc.includes("return '☢️ ❄️ '+label;"), 'calendar label shows the nuclear sign plus winter icon during atomic winter');
assert.match(mainSrc, /atomicWinterCalendarActive\(\) && sm\.season==='winter'/, 'calendar only decorates active winter fallout');
assert.match(mainSrc, /const seasonIcon=formatSeasonStatusIcon\(sm\);/, 'compact status HUD uses the atomic winter season icon formatter');
assert.match(mainSrc, /metrics:\(\)=> seasonMetricsForCalendar\(\)/, 'season debug calendar panel receives the decorated atomic winter label');

console.log('atomic-winter-sim: all assertions passed');
