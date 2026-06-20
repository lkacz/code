// Progression regression for hero energy capacity: Pojemność is a real trainable
// stat and exposes its bonus through the same modifier-source path as gear.
import assert from 'node:assert/strict';

globalThis.window = globalThis;
const store = new Map();
globalThis.localStorage = {
  getItem:k => store.get(k) ?? null,
  setItem:(k,v) => { store.set(k,String(v)); },
  removeItem:k => { store.delete(k); }
};
globalThis.CustomEvent = class {
  constructor(type,opts){ this.type=type; this.detail=opts && opts.detail; }
};
const listeners = new Map();
globalThis.addEventListener = (type,fn) => {
  if(!listeners.has(type)) listeners.set(type,[]);
  listeners.get(type).push(fn);
};
globalThis.dispatchEvent = ev => {
  (listeners.get(ev.type)||[]).forEach(fn=>fn(ev));
  return true;
};

let recomputeCount=0;
const sources = {};
globalThis.MM = {
  recomputeModifiers(){ recomputeCount++; },
  inventory:{
    registerModifierSource(name,fn){ sources[name]=fn; recomputeCount++; return true; }
  }
};
globalThis.player = { xp:60 };

const { progress } = await import('../src/engine/progress.js');

assert.equal(progress.level().level, 2, '60 XP reaches level 2');
assert.equal(progress.points(), 1, 'level 2 grants one spendable point');
assert.equal(progress.spend('cap'), true, 'Pojemność can be trained');
assert.equal(progress.stats().cap, 1, 'Pojemność point is stored');
assert.equal(progress.points(), 0, 'trained Pojemność consumes the point');
assert.equal(progress.bonuses().energyCapacityBonus, 25, 'Pojemność grants +25 energy capacity');
assert.equal(sources.progress().energyCapacityBonus, 25, 'registered progress modifier exposes energy capacity');
assert.ok(recomputeCount>=2, 'progress changes recompute modifiers before notifying listeners');
const snap = progress.snapshot();

progress.reset();
assert.equal(progress.stats().cap, 0, 'reset clears Pojemność');
assert.equal(sources.progress().energyCapacityBonus, 0, 'reset clears registered energy capacity bonus');
assert.equal(progress.restore(snap), true, 'progress snapshot restores');
assert.equal(progress.stats().cap, 1, 'restore brings back trained PojemnoĹ›Ä‡');
assert.equal(sources.progress().energyCapacityBonus, 25, 'restored progress feeds modifier source again');

progress.reset();
globalThis.player = { xp:0, x:0, y:20 };
globalThis.inv = { springAntler:1, summerHorn:1, autumnHeartwood:1, winterFur:1 };
progress.update(0.5);
const done = new Map(progress.milestones().map(m => [m.id, m.done]));
assert.equal(done.get('season_spring_trophy'), true, 'spring trophy completes a milestone');
assert.equal(done.get('season_summer_trophy'), true, 'summer trophy completes a milestone');
assert.equal(done.get('season_autumn_trophy'), true, 'autumn trophy completes a milestone');
assert.equal(done.get('season_winter_trophy'), true, 'winter trophy completes a milestone');
assert.equal(done.get('season_full_year'), true, 'collecting all seasonal trophies completes the full-year milestone');
assert.equal(globalThis.player.xp, 1420, 'seasonal trophy arc grants the expected XP total');

progress.reset();
globalThis.player = { xp:0, x:0, y:20 };
globalThis.inv = { springAntler:1 };
globalThis.dispatchEvent(new CustomEvent('mm-resources-change'));
globalThis.inv = { springAntler:0 };
progress.update(0.5);
const spentDone = new Map(progress.milestones().map(m => [m.id, m.done]));
assert.equal(spentDone.get('season_spring_trophy'), true, 'season trophy milestone survives immediate crafting/spending');
assert.equal(globalThis.player.xp, 180, 'spent seasonal trophy still grants its milestone XP');
const trophySnap = progress.snapshot();
assert.equal(trophySnap.trophies.springAntler, 1, 'season trophy history is persisted in progress snapshots');
progress.reset();
assert.equal(progress.restore(trophySnap), true, 'season trophy history restores from snapshot');
assert.equal(progress.snapshot().trophies.springAntler, 1, 'restored progress keeps the trophy history');

progress.reset();
globalThis.player = { xp:0, x:0, y:20 };
for(let i=0; i<5; i++) globalThis.dispatchEvent(new CustomEvent('mm-berry-harvest'));
const berrySnap = progress.snapshot();
assert.equal(berrySnap.berries, 5, 'berry harvest counter is persisted before the milestone tick');
assert.equal(JSON.parse(store.get('mm_progress_v1')).berries, 5, 'berry harvest events are written to progress storage immediately');
progress.reset();
assert.equal(progress.restore(berrySnap), true, 'berry harvest progress restores from snapshot');
progress.update(0.5);
const berryDone = new Map(progress.milestones().map(m => [m.id, m.done]));
assert.equal(berryDone.get('berry5'), true, 'restored berry progress completes the berry milestone');
assert.equal(globalThis.player.xp, 150, 'restored berry milestone grants XP once');

console.log('progress-energy-sim: all assertions passed');
