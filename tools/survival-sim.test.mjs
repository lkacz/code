import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};

const { survival } = await import('../src/engine/survival.js');

{
  const s=survival.createDrowningState();
  let out=null;
  for(let i=0;i<59;i++) out=survival.updateDrowning(s,1,true);
  assert.equal(out.damage, 0, 'covered water before 60 s causes no drowning damage');
  assert.equal(out.warn, false, 'covered water before grace does not warn');
  out=survival.updateDrowning(s,1,true);
  assert.equal(out.warn, true, 'drowning warns when the 60 s grace expires');
  assert.ok(out.damage>=2, 'damage begins as soon as grace expires');
  const firstRate=out.rate;
  survival.consumeDrowningDamage(s,out.damage);
  for(let i=0;i<30;i++) out=survival.updateDrowning(s,1,true);
  assert.ok(out.rate>firstRate, 'drowning damage rate increases with time underwater');
}

{
  const s=survival.createDrowningState();
  for(let i=0;i<65;i++) survival.updateDrowning(s,1,true);
  const out=survival.updateDrowning(s,0.1,false);
  assert.equal(out.recovered, true, 'surfacing after drowning reports recovery');
  assert.equal(s.airless, 0, 'surfacing resets airless timer');
  assert.equal(s.damageAcc, 0, 'surfacing clears banked drowning damage');
}

console.log('survival-sim: all assertions passed');
