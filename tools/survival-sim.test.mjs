import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};

const { survival } = await import('../src/engine/survival.js');

{
  const s=survival.createDrowningState();
  let out=null;
  assert.equal(survival.DROWN_GRACE, 20, 'drowning grace is 20 seconds');
  for(let i=0;i<19;i++) out=survival.updateDrowning(s,1,true);
  assert.equal(out.damage, 0, 'covered water before 20 s causes no drowning damage');
  assert.equal(out.warn, false, 'covered water before grace does not warn');
  out=survival.updateDrowning(s,1,true);
  assert.equal(out.warn, true, 'drowning warns when the 20 s grace expires');
  assert.ok(out.damage>=2, 'damage begins as soon as grace expires');
  const firstRate=out.rate;
  survival.consumeDrowningDamage(s,out.damage);
  for(let i=0;i<30;i++) out=survival.updateDrowning(s,1,true);
  assert.ok(out.rate>firstRate, 'drowning damage rate increases with time underwater');
}

{
  const s=survival.createDrowningState();
  for(let i=0;i<25;i++) survival.updateDrowning(s,1,true);
  const out=survival.updateDrowning(s,0.1,false);
  assert.equal(out.recovered, true, 'surfacing after drowning reports recovery');
  assert.equal(s.airless, 0, 'surfacing resets airless timer');
  assert.equal(s.damageAcc, 0, 'surfacing clears banked drowning damage');
}

{
  const s=survival.createUnderwaterEnergyState();
  let out=survival.updateUnderwaterEnergyShock(s,1,true);
  assert.equal(out.damage, 1, 'small underwater energy use causes immediate shock damage');
  survival.consumeUnderwaterEnergyDamage(s,out.damage);
  assert.equal(s.damageAcc, 0, 'consuming underwater energy shock damage clears the visible pulse');
  out=survival.updateUnderwaterEnergyShock(s,50,true);
  assert.equal(out.damage, survival.UNDERWATER_ENERGY_DAMAGE_MAX, 'large underwater energy use is capped per damage pulse');
  out=survival.updateUnderwaterEnergyShock(s,4,false);
  assert.equal(out.damage, 0, 'energy use outside water does not shock the hero');
  assert.equal(s.damageAcc, 0, 'leaving water clears banked underwater energy shock');
}

console.log('survival-sim: all assertions passed');
