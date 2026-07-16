// Progression regression for hero energy capacity: Pojemność is a real trainable
// stat and exposes its bonus through the same modifier-source path as gear.
import assert from 'node:assert/strict';

globalThis.window = globalThis;
const store = new Map();
store.set('mm_progress_v1',JSON.stringify({vit:999,padding:'x'.repeat(70000)}));
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

assert.equal(progress.stats().vit,0,'oversized local progression profiles are ignored before parsing state');
assert.equal(progress.level().level, 2, '60 XP reaches level 2');
assert.equal(progress.points(), 1, 'level 2 grants one spendable point');
assert.equal(progress.spend('toString'),false,'inherited object names are not accepted as trainable stats');
assert.equal(progress.points(),1,'an invalid stat name cannot consume a skill point');
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
globalThis.player = { xp:60 };
assert.equal(progress.spend('hard'), true, 'Twardość can be trained');
assert.equal(progress.bonuses().damageReductionBonus, 0.03, 'one Twardość point reduces blockable damage by 3%');
assert.equal(sources.progress().damageReductionBonus, 0.03, 'registered progress modifiers expose Twardość defense');
assert.equal(progress.toughnessDamageReduction(5), 0.15, 'Twardość defense scales linearly');
assert.equal(progress.toughnessDamageReduction(999), progress.TOUGHNESS_DAMAGE_REDUCTION_MAX, 'Twardość defense is capped below immunity');

let skillEvents=0;
let skillEventLevel=0;
let skillEventGained=0;
globalThis.addEventListener('mm-skill-point-gained',ev=>{
  skillEvents++;
  skillEventLevel=ev.detail && ev.detail.level;
  skillEventGained=ev.detail && ev.detail.gained;
});
progress.reset();
globalThis.player = { xp:60, x:0, y:20 };
progress.update(0.5);
assert.equal(skillEvents, 1, 'level-up dispatches a skill-point feedback event');
assert.equal(skillEventLevel, 2, 'skill-point event carries the new level');
assert.equal(skillEventGained, 1, 'single-level event carries one gained point');

skillEvents=0;
skillEventLevel=0;
skillEventGained=0;
progress.reset();
globalThis.player = { xp:220, x:0, y:20 };
progress.update(0.5);
assert.equal(skillEvents, 1, 'multi-level jump dispatches one consolidated feedback event');
assert.equal(skillEventLevel, 3, 'multi-level event carries the final reached level');
assert.equal(skillEventGained, 2, 'multi-level event carries all newly available points');

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

// Repeated doses of one mixture have a hard gameplay cap. A fourth dose may
// refresh time, but must never add another multiplicative/additive layer.
progress.reset();
globalThis.player = { xp:0, x:0, y:20 };
let lastBuffResult=null;
for(let i=0;i<10;i++){
  lastBuffResult=progress.addBuff({stackKey:'potion_speed',name:'Szybkość',icon:'💨',dur:60,stats:{moveSpeedMult:1.3,jumpPowerMult:1.15}});
}
assert.equal(progress.BUFF_STACK_CAP,3,'timed effects publish a three-layer same-mixture cap');
assert.equal(lastBuffResult.capped,true,'a dose above the cap refreshes instead of adding power');
assert.equal(lastBuffResult.stacks,3,'same mixture never reports more than three active layers');
assert.ok(Math.abs(sources.buffs().moveSpeedMult-Math.pow(1.3,3))<1e-9,'speed mixture multiplier is capped at exactly three layers');
assert.ok(Math.abs(sources.buffs().jumpPowerMult-Math.pow(1.15,3))<1e-9,'all stats from the same mixture obey the same layer cap');
const speedChip=progress.getBuffs().find(b=>b.name.startsWith('Szybkość'));
assert.ok(speedChip && speedChip.stacks===3 && speedChip.name.includes('×3'),'HUD consolidates identical mixture layers into one capped stack chip');

progress.addBuff({stackKey:'potion_antigrav',name:'Antygrawitacja',icon:'🛸',dur:60,stats:{moveSpeedMult:1.15,jumpPowerMult:1.6}});
assert.ok(Math.abs(sources.buffs().moveSpeedMult-(Math.pow(1.3,3)*1.15))<1e-9,'a genuinely different mixture can still combine with capped speed');
assert.equal(progress.getBuffs().length,2,'different mixtures remain distinct HUD effects');

progress.reset();
for(let i=0;i<3;i++) progress.addBuff({stackKey:'hostile_speed',name:'Hostile',dur:30,stats:{moveSpeedMult:1e308,attackDamage:1e308}});
const hardenedBuffs=sources.buffs();
assert.ok(Number.isFinite(hardenedBuffs.moveSpeedMult) && hardenedBuffs.moveSpeedMult<=1000,'extreme multiplicative buff stacks remain finite and bounded');
assert.ok(Number.isFinite(hardenedBuffs.attackDamage) && hardenedBuffs.attackDamage<=1000,'extreme additive buff stacks remain finite and bounded');
assert.equal(progress.addBuff({stackKey:'unknown',stats:{__unknownStat:1e308}}),false,'unknown modifier keys are rejected instead of leaking into active modifiers');
const timeBeforeInvalidTick=progress.getBuffs()[0].t;
progress.update(NaN);
progress.update(-5);
progress.update(Infinity);
assert.equal(progress.getBuffs()[0].t,timeBeforeInvalidTick,'invalid or negative frame deltas cannot freeze, extend, or instantly expire buffs');
assert.equal(progress.restore(null),false,'invalid progression restore input is rejected');
assert.equal(progress.restore([]),false,'array-shaped progression data is not treated as an empty profile');
assert.equal(progress.getBuffs()[0].t,timeBeforeInvalidTick,'a rejected restore does not clear active session buffs');

const hostileDone=Object.create(null);
for(let i=0;i<1000;i++) hostileDone['legacy_'+i]=1;
hostileDone.depth100=1;
assert.equal(progress.restore({vit:999,str:999,agi:999,cap:999,hard:999,done:hostileDone,bossKills:Infinity,berries:1e300}),true,'oversized legacy progression state restores defensively');
const boundedProgress=progress.snapshot();
assert.deepEqual(Object.keys(boundedProgress.done),['depth100'],'progress restore keeps only schema milestones regardless of hostile key order');
assert.ok(Number.isFinite(boundedProgress.bossKills) && Number.isFinite(boundedProgress.berries),'progress counters remain finite after hostile restore');
assert.equal(['vit','str','agi','cap','hard'].reduce((sum,key)=>sum+boundedProgress[key],0),98,'edited saves cannot restore more trained points than level 99 can award');

const everyMilestone=Object.fromEntries(progress.milestones().map(m=>[m.id,1]));
assert.equal(progress.restore({done:everyMilestone}),true,'the complete milestone schema restores');
assert.deepEqual(Object.keys(progress.snapshot().done).sort(),Object.keys(everyMilestone).sort(),'the persisted milestone allowlist is derived from the live milestone table');

skillEvents=0;
globalThis.player={xp:60,x:0,y:20};
progress.update(0.4);
progress.reset();
progress.update(0.1);
assert.equal(skillEvents,0,'progress reset clears the slow-tick accumulator from the previous world');
progress.update(0.4);
assert.equal(skillEvents,1,'a fresh post-reset half-second still performs the progression tick');

progress.reset();
assert.equal(progress.getBuffs().length,0,'progress reset clears session-scoped mixture effects');
assert.equal(sources.buffs(),null,'reset removes every timed modifier contribution');

console.log('progress-energy-sim: all assertions passed');
