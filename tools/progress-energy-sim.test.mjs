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

progress.reset();
assert.equal(progress.stats().cap, 0, 'reset clears Pojemność');
assert.equal(sources.progress().energyCapacityBonus, 0, 'reset clears registered energy capacity bonus');

console.log('progress-energy-sim: all assertions passed');
