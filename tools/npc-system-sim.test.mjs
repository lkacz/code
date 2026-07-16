import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.performance = { now:()=>1000 };
globalThis.MM = {};
globalThis.msg = text => messages.push(String(text));
const messages = [];

const { T } = await import('../src/constants.js');
const { createQuestNpc, npcRegistry, validateQuestDefinition } = await import('../src/engine/npc_system.js');

assert.throws(
  ()=>validateQuestDefinition({id:'bad',steps:[{id:'a',kind:'handoff',item:'water',amount:1,next:'missing'}]}),
  /missing next/,
  'NPC quest definitions reject broken phase links'
);

const worldGen = {
  settings:{seaLevel:62},
  biomeType(){ return 1; },
  surfaceHeight(){ return 30; }
};
function getTile(x,y){
  if(y>=30) return T.GRASS;
  return T.AIR;
}
function setTile(){}

let inventoryUpdates=0;
let saveMarks=0;
let equipped=null;
const granted=[];
globalThis.inv = { water:0 };
globalThis.MM.inventory = {
  grantItem(item,opts){
    granted.push({item:Object.assign({},item), opts:Object.assign({},opts)});
    return true;
  },
  equip(id){ equipped=id; return true; },
  getItem(){ return null; }
};
const ctx = {
  worldGen,
  onInventoryChange(){ inventoryUpdates++; },
  onChange(){ saveMarks++; }
};
const player = {x:0.5,y:29,hp:100};
const vendor = createQuestNpc({
  id:'qa_vendor',
  displayName:'QA Vendor',
  maxHp:12,
  steps:[
    {id:'water',kind:'handoff',item:'water',amount:2,next:'choice',prompt:'Need water',missing:'Still thirsty',complete:'Water accepted'},
    {id:'choice',kind:'choice',prompt:'Pick reward'},
    {id:'done',kind:'done',prompt:['Done','Still done, but less repetitive']}
  ],
  choiceRewards:[
    {key:'1',id:'qa_spanner',kind:'weapon',weaponType:'melee',name:'QA Spanner',attackDamage:2}
  ],
  rewardOnceKeys:['starter_choice'],
  choiceReward(item){
    return {
      once:'starter_choice',
      gear:item,
      next:'done',
      data:{choice:item.id},
      message:'Granted '+item.id,
      line:'Enjoy '+item.name
    };
  }
});

assert.equal(npcRegistry.get('qa_vendor'), vendor, 'created NPCs are registered by stable id');
assert.ok(globalThis.MM.npcs.qa_vendor, 'created NPCs are also exposed for debug/runtime integration');
assert.equal(vendor.setContext(ctx), true, 'NPCs accept a shared runtime context');
assert.equal(vendor.placeNearWorldStart(getTile,worldGen), true, 'generic NPC placement finds a safe landing tile');
const state=vendor._debug();
player.x=state.x;
player.y=state.y;
let summary=vendor.summary();
assert.equal(summary.id, 'qa_vendor', 'NPC summaries expose stable ids');
assert.equal(summary.status, 'available', 'NPC summaries classify handoff jobs as available');
assert.deepEqual(summary.required, {item:'water', amount:2, have:0}, 'NPC summaries expose handoff requirements');
assert.equal(npcRegistry.nearby(player,3).some(s=>s.id==='qa_vendor'), true, 'NPC registry exposes nearby summaries');

globalThis.inv.water=1;
vendor.update(0.1,player,getTile,setTile);
assert.equal(vendor.phase(), 'water', 'handoff waits until the full resource requirement is present');
assert.equal(vendor.summary().required.have, 1, 'NPC summaries track current inventory progress');
globalThis.inv.water=2;
assert.equal(vendor.summary().status, 'ready', 'NPC summaries mark handoff jobs ready when resources are present');
vendor.update(0.1,player,getTile,setTile);
assert.equal(vendor.phase(), 'choice', 'handoff advances to a choice phase');
assert.equal(globalThis.inv.water, 0, 'handoff consumes the declared resource amount');
assert.ok(inventoryUpdates>=1 && saveMarks>=1, 'handoff refreshes inventory and marks the save dirty');

player.x+=20;
assert.equal(vendor.handleKey('1',player), false, 'choice input is ignored when the player is not interacting');
player.x=state.x;
assert.equal(vendor.handleKey('1',player), true, 'choice input grants the selected reward while nearby');
assert.equal(vendor.phase(), 'done', 'choice reward advances to the configured next phase');
summary=vendor.summary();
assert.equal(summary.status, 'completed', 'NPC summaries classify completed jobs');
assert.equal(typeof summary.prompt, 'string', 'NPC summaries collapse prompt variants into displayable text');
assert.equal(granted.length, 1, 'choice reward grants exactly one item');
assert.equal(granted[0].item.id, 'qa_spanner', 'choice reward grants the declared gear item');
assert.equal(granted[0].opts.essential, true, 'quest reward gear is essential by default');
assert.equal(equipped, 'qa_spanner', 'quest reward gear is equipped by default');
assert.ok(messages.some(m=>m.includes('qa_spanner')), 'choice reward announces itself through the runtime message hook');

const snap=npcRegistry.snapshot();
vendor.reset();
assert.equal(vendor.phase(), 'water', 'reset returns the generic NPC to its initial phase');
assert.equal(npcRegistry.restore(snap), true, 'registry can restore registered NPC snapshots');
assert.equal(vendor.phase(), 'done', 'registry restore returns the NPC to the saved phase');
assert.equal(vendor._debug().data.choice, 'qa_spanner', 'generic snapshot/restore preserves NPC data');

const repeatNpc = createQuestNpc({
  id:'qa_repeat',
  displayName:'QA Repeat',
  initialPhase:'done',
  steps:[{id:'done',kind:'done',prompt:['Repeat','Repeat','Shifted']}]
});
repeatNpc.placeNearWorldStart(getTile,worldGen);
const repeatState = repeatNpc._debug();
player.x = repeatState.x;
player.y = repeatState.y;
assert.equal(repeatNpc.talk(player), true, 'repeat NPC can talk');
const repeatFirst = repeatNpc._debug().line;
assert.equal(repeatNpc.talk(player), true, 'repeat NPC can talk again');
assert.notEqual(repeatNpc._debug().line, repeatFirst, 'NPC talk avoids repeating the same line twice in a row when variants exist');

globalThis.MM.atomicWinter = {
  contextLines(kind){
    return kind === 'npc' ? ['Atomic winter lasts until winter ends: roof blocks toxic rain.'] : [];
  }
};
const falloutNpc = createQuestNpc({
  id:'qa_fallout_talker',
  displayName:'QA Fallout Talker',
  initialPhase:'done',
  steps:[{id:'done',kind:'done',prompt:'Normal town line'}]
});
falloutNpc.placeNearWorldStart(getTile,worldGen);
const falloutState = falloutNpc._debug();
player.x = falloutState.x;
player.y = falloutState.y;
let falloutLineSeen = false;
for(let i=0;i<4;i++){
  assert.equal(falloutNpc.talk(player), true, 'fallout NPC can talk through the normal interaction flow');
  falloutLineSeen = falloutLineSeen || /Atomic winter/.test(falloutNpc._debug().line);
}
assert.ok(falloutLineSeen, 'regular NPCs mention atomic winter while the event is active');
delete globalThis.MM.atomicWinter;

const observer = createQuestNpc({
  id:'qa_observer',
  displayName:'QA Observer',
  steps:[
    {id:'watch',kind:'observe',seconds:0.3,next:'done',mode:'test',prompt:'Watch the world',missing:'Still watching'},
    {id:'done',kind:'done',prompt:'Observed'}
  ],
  observeCheck(step,p){ void step; return !!(p && p.x>100); }
});
observer.placeNearWorldStart(getTile,worldGen);
player.x=99;
observer.update(0.1,player,getTile,setTile,ctx);
assert.equal(observer.phase(), 'watch', 'observe quest waits while its world condition is false');
assert.equal(observer.summary().status, 'observe', 'observe quest exposes observe status');
assert.equal(observer.summary().observe.active, false, 'observe summary reports inactive conditions');
player.x=101;
observer.update(0.1,player,getTile,setTile,ctx);
assert.ok(observer.summary().observe.active, 'observe summary reports active conditions');
const observerSnap=observer.snapshot();
observer.reset();
assert.equal(observer.restore(observerSnap), true, 'observe quest snapshot restores');
assert.ok(observer.summary().observe.progress>0, 'observe snapshot keeps partial progress');
observer.update(0.1,player,getTile,setTile,ctx);
observer.update(0.1,player,getTile,setTile,ctx);
assert.equal(observer.phase(), 'done', 'observe quest advances after enough active time');

const rewardGateNpc=createQuestNpc({
  id:'qa_reward_gate',
  displayName:'QA Reward Gate',
  steps:[
    {id:'pay',kind:'handoff',item:'water',amount:1,next:'done',reward:{once:'prize',gear:{id:'qa_prize',kind:'weapon',weaponType:'melee',name:'QA Prize'},next:'done'}},
    {id:'done',kind:'done',prompt:'Done'}
  ]
});
rewardGateNpc.placeNearWorldStart(getTile,worldGen);
const gatePosition=rewardGateNpc._debug();
player.x=gatePosition.x;
player.y=gatePosition.y;
globalThis.inv.water=1;
const workingGrant=globalThis.MM.inventory.grantItem;
globalThis.MM.inventory.grantItem=()=>false;
rewardGateNpc.update(0.1,player,getTile,setTile,ctx);
assert.equal(rewardGateNpc.phase(),'pay','a rejected handoff reward rolls the quest phase back');
assert.equal(globalThis.inv.water,1,'a rejected handoff reward refunds the consumed resource exactly');
globalThis.MM.inventory.grantItem=workingGrant;
rewardGateNpc.update(0.1,player,getTile,setTile,ctx);
assert.equal(rewardGateNpc.phase(),'done','handoff retries successfully once its reward can be granted');
assert.equal(globalThis.inv.water,0,'a successful retried handoff consumes its resource once');

const pollutedSnapshot=vendor.snapshot();
pollutedSnapshot.data=JSON.parse('{"__proto__":{"npcPolluted":true},"constructor":{"prototype":{"npcPolluted":true}},"safeValue":7}');
assert.equal(vendor.restore(pollutedSnapshot), true, 'NPC restore accepts an otherwise valid record containing hostile keys');
assert.equal({}.npcPolluted, undefined, 'NPC record restore blocks prototype-pollution keys');
assert.equal(vendor._debug().data.safeValue, 7, 'NPC record hardening preserves ordinary state fields');

const knownTailSnapshot=vendor.snapshot();
knownTailSnapshot.data.tailMarker=99;
const hostileNpcSnapshot=vendor.snapshot();
hostileNpcSnapshot.x=1e308;
hostileNpcSnapshot.y=-1e308;
hostileNpcSnapshot.defeatedT=Infinity;
hostileNpcSnapshot.data={
  home:{x:1e308},
  longText:'x'.repeat(2000),
  values:Array.from({length:200},(_,i)=>i),
  nested:{a:{b:{c:{d:'too deep'}}}},
  nonFinite:Infinity
};
assert.equal(vendor.restore(hostileNpcSnapshot),true,'NPC restore accepts and sanitises deeply hostile state');
const hardenedNpc=vendor._debug();
assert.equal(hardenedNpc.x,null,'astronomical NPC x coordinates are rejected');
assert.equal(hardenedNpc.y,null,'out-of-world NPC y coordinates are rejected');
assert.equal(hardenedNpc.data.home.x,undefined,'invalid home anchors cannot override NPC placement');
assert.ok(hardenedNpc.data.longText.length<=512,'NPC strings have a persisted length cap');
assert.ok(hardenedNpc.data.values.length<=64,'NPC arrays have a persisted element cap');
assert.equal(hardenedNpc.data.nested.a.b,undefined,'NPC records have a bounded nesting depth');
assert.equal(hardenedNpc.data.nonFinite,undefined,'NPC records discard non-finite numbers');
assert.ok(Number.isFinite(hardenedNpc.defeatedT),'transient NPC timers remain finite');

const hostileObserve=observer.snapshot();
hostileObserve.observe={phase:'watch',t:Infinity,best:1e308,ok:true,lineCd:Infinity};
assert.equal(observer.restore(hostileObserve),true,'observe state restores through numerical hardening');
const cleanObserve=observer._debug().observe;
assert.ok(Number.isFinite(cleanObserve.t) && cleanObserve.t<=0.3,'observe progress is finite and capped to the step duration');
assert.ok(Number.isFinite(cleanObserve.best) && cleanObserve.best<=0.3,'best observe progress is finite and capped');
assert.ok(Number.isFinite(cleanObserve.lineCd) && cleanObserve.lineCd<=60,'observe dialogue cooldown is finite and capped');

const oversizedRegistry=Object.create(null);
for(let i=0;i<5000;i++) oversizedRegistry['deferred_'+i]={v:1,phase:'done'};
oversizedRegistry.qa_vendor=knownTailSnapshot;
vendor.reset();
assert.equal(npcRegistry.restore({npcs:oversizedRegistry}), true, 'NPC registry accepts a bounded prefix of a legacy oversized save');
assert.equal(vendor.phase(),'done','a registered NPC at the tail of an oversized save cannot be starved by junk ids');
assert.equal(vendor._debug().data.tailMarker,99,'priority restore preserves the registered NPC payload');
const boundedRegistrySnapshot=npcRegistry.snapshot();
assert.ok(Object.keys(boundedRegistrySnapshot.npcs).length<=4096, 'NPC pending restore and snapshot registries have a hard size cap');

console.log('npc-system-sim: all assertions passed');
