// Mob XP reward contract:
// - repeat kills of the same species lose 1% XP per kill within one game day
// - the fatigue ledger persists through mob snapshots and resets after a day
// - right-click/special killing blows get a 20% XP bonus after fatigue
// - XP awards emit a HUD-facing event/detail.
// - special/important kills emit a combat feedback event for in-world effects.
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.localStorage = {
  getItem(){ return null; },
  setItem(){},
  removeItem(){}
};
const listeners = new Map();
globalThis.CustomEvent = class {
  constructor(type,opts){ this.type=type; this.detail=opts && opts.detail; }
};
globalThis.addEventListener = (type,fn)=>{
  const list=listeners.get(type) || [];
  list.push(fn);
  listeners.set(type,list);
};
globalThis.dispatchEvent = (ev)=>{
  for(const fn of listeners.get(ev.type) || []) fn(ev);
  return true;
};
let simNow = 0;
globalThis.performance = { now:()=>simNow };
globalThis.msg = () => {};

const { T } = await import('../src/constants.js');
const { mobs } = await import('../src/engine/mobs.js');
const { createVitalsModel, vitalsHud } = await import('../src/engine/vitals_hud.js');

let dayFloat = 1;
MM.seasons = { metrics:()=>({dayFloat}) };

const events = [];
const combatEvents = [];
addEventListener('mm-xp-awarded',ev=>events.push(ev.detail));
addEventListener('mm-combat-event',ev=>combatEvents.push(ev.detail));

const world = {
  getTile(x,y){ return y>=10 ? T.STONE : T.AIR; },
  setTile(){}
};
const species = mobs._debugSpecies();
const id = 'STONE_GOLEM';
const baseXp = species[id].xp;
globalThis.player = {x:0.5,y:9.15,w:0.7,h:0.95,vx:0,vy:0,hp:100,maxHp:100,hpInvul:0,xp:0};

function currentFatigue(){
  return mobs.serialize().xpFatigue;
}
function spawnTestMob(specId=id){
  const fatigue=currentFatigue();
  const spec=species[specId];
  mobs.deserialize({
    v:5,
    list:[{id:specId,x:0.5,y:9.124,vx:0,vy:0,hp:spec.hp,maxHp:spec.hp,state:'dormant',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],
    aggro:{mode:'rel',m:{}},
    xpFatigue:fatigue
  });
  mobs.freezeSpawns(10000);
}
function kill(opts){
  spawnTestMob();
  const before=player.xp;
  assert.equal(mobs.damageAt(0,9,999,Object.assign({source:'hero'},opts||{})), true, 'test mob can be killed');
  return player.xp-before;
}

try{
  mobs.deserialize({v:5,list:[],aggro:{mode:'rel',m:{}},xpFatigue:{mode:'day',m:{}}});

  const coldId='ICE_WRAITH';
  spawnTestMob(coldId);
  combatEvents.length=0;
  const coldBefore=species[coldId].hp;
  assert.equal(mobs.damageAt(0,9,10,{source:'hero',kind:'flame',element:'fire'}), true, 'fire can hit a cold biome threat');
  const coldAfter=mobs.serialize().list[0].hp;
  assert.ok(coldBefore-coldAfter >= 11.9, 'cold biome threats take the 20% thermal fire bonus');
  assert.ok(combatEvents.some(e=>e && e.species===coldId && e.bonusDamagePct===20 && e.element==='fire'), 'thermal mob bonus emits HEAT +20% combat feedback');

  assert.equal(kill(), baseXp, 'first same-species kill pays full XP');
  assert.equal(kill(), Math.round(baseXp*0.99), 'second same-species kill pays 1% less');
  assert.equal(kill({specialAttack:true}), Math.round(baseXp*0.98*1.2), 'special killing blow adds 20% after fatigue');

  const snap=mobs.serialize();
  assert.equal(snap.xpFatigue.m[id].kills, 3, 'snapshot persists same-species fatigue kills');
  assert.equal(kill(), Math.round(baseXp*0.97), 'restored fatigue keeps diminishing returns');

  dayFloat += 1.05;
  assert.equal(kill(), baseXp, 'one game day without that kill type resets fatigue');

  assert.ok(events.length>=5, 'mob XP awards emit HUD events');
  assert.equal(events[0].amount, baseXp, 'event carries the awarded XP amount');
  assert.equal(events[2].special, true, 'event marks special-kill awards');
  assert.ok(combatEvents.some(e=>e && e.kind==='special' && e.special===true && e.finisher===true), 'special mob kill emits finisher combat feedback');
  assert.equal(combatEvents.some(e=>e && e.kind==='special_xp'), false, 'special XP bonus does not create a second floating combat event');

  const model=createVitalsModel();
  assert.equal(model.noteXpAward({amount:42,special:true,fatigueMult:0.91}), true, 'HUD model accepts XP award details');
  let st=model.update({hp:100,maxHp:100,en:20,enMax:40,level:1,xpInto:42,xpNeed:60,buffs:[]},1/60);
  assert.equal(st.xpDeltas.length, 1, 'XP award queues a green XP number');
  assert.equal(st.xpDeltas[0].v, 42, 'XP number stores the awarded amount');
  assert.equal(st.xpDeltas[0].special, true, 'XP number remembers special bonus state');
  for(let t=0; t<1.5; t+=1/60){
    st=model.update({hp:100,maxHp:100,en:20,enMax:40,level:1,xpInto:42,xpNeed:60,buffs:[]},1/60);
  }
  assert.equal(st.xpDeltas.length, 0, 'XP number ages out');

  assert.ok(vitalsHud.noteXpAward({amount:7}), 'exported HUD API accepts XP awards');
} finally {
  mobs.clearAll();
  delete globalThis.msg;
}

console.log('mob-xp-rewards-sim: all assertions passed');
