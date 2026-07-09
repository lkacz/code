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

console.log('npc-system-sim: all assertions passed');
