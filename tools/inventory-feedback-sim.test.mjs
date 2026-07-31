import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createInventoryFeedback,
  createInventoryFeedbackQueue,
  diffInventoryFeedback,
  inventoryFeedbackContext,
  inventoryFeedbackEventDetail,
  INVENTORY_FEEDBACK_BATCH_SIZE,
  INVENTORY_FEEDBACK_COMPACT_THRESHOLD
} from '../src/engine/inventory_feedback.js';

const resourceDefs=[
  {key:'wood',label:'Drewno',color:'#8b5a2b',tile:'WOOD'},
  {key:'diamond',label:'Diament',color:'#43d8ff'}
];
const specialDefs=[
  {key:'stone',label:'Kilof kamienny',color:'#9ca3af'}
];
const tierColors={epic:'#b66cff',rare:'#4aa8ff'};

const before={
  resources:{wood:2,diamond:5},
  specials:{stone:0},
  items:[
    {id:'old_blade',name:'Stary miecz',tier:'rare'},
    {id:'kept_charm',name:'Talizman',tier:'epic'}
  ]
};
const after={
  resources:{wood:7,diamond:2},
  specials:{stone:1},
  items:[
    {id:'kept_charm',name:'Talizman',tier:'epic'},
    {id:'new_cape',name:'Peleryna burzy',tier:'epic'}
  ]
};
const changes=diffInventoryFeedback(before,after,{resourceDefs,specialDefs,tierColors},{kind:'death',cause:'alien_invasion'});

assert.deepEqual(changes.map(c=>[c.type,c.key,c.delta,c.name,c.cause]),[
  ['resource','wood',5,'Drewno','death'],
  ['resource','diamond',-3,'Diament','death'],
  ['tool','stone',1,'Kilof kamienny','death'],
  ['gear','old_blade',-1,'Stary miecz','death'],
  ['gear','new_cape',1,'Peleryna burzy','death']
]);
assert.equal(changes[3].color,tierColors.rare);
assert.equal(changes[4].color,tierColors.epic);
assert.deepEqual(changes[0].preview,{kind:'resource',tile:'WOOD',icon:''});
assert.equal(changes[3].preview.kind,'gear');
assert.equal(changes[3].preview.item.kind,undefined);
assert.equal(changes[4].preview.item.id,'new_cape');
assert.equal(inventoryFeedbackContext({key:'wood',spent:2}).kind,'direct');
assert.equal(inventoryFeedbackContext({key:'discard'}).kind,'direct');
assert.equal(inventoryFeedbackContext({key:'loot'}).kind,'reward');
assert.equal(inventoryFeedbackContext({source:'meteor'}).kind,'reward');
assert.equal(inventoryFeedbackContext({key:'wood',gained:2,source:'meteor'}).kind,'reward','an explicit reward source wins over the generic gained marker');
assert.deepEqual(inventoryFeedbackEventDetail({
  resourceChange:{key:'wood',gained:2},
  inventoryFeedbackContext:{kind:'reward',source:'meteor'}
}),{
  key:'wood',
  gained:2,
  inventoryFeedbackContext:{kind:'reward',source:'meteor'}
},'the canonical HUD refresh carries transaction context on its first event');

const feedbackQueue=createInventoryFeedbackQueue();
feedbackQueue.push([
  {type:'resource',key:'wood',direction:'gain',delta:2,cause:'',deathCause:''},
  {type:'resource',key:'wood',direction:'gain',delta:3,cause:'',deathCause:''},
  {type:'resource',key:'diamond',direction:'loss',delta:-1,cause:'death',deathCause:'damage'}
]);
assert.equal(feedbackQueue.state().current.key,'wood');
assert.equal(feedbackQueue.state().current.delta,5,'adjacent equal changes should be shown as one stack');
assert.equal(feedbackQueue.state().pending.length,1);
feedbackQueue.finish();
assert.equal(feedbackQueue.state().current.key,'diamond');
assert.equal(feedbackQueue.state().current.delta,-1);
feedbackQueue.finish();
assert.equal(feedbackQueue.state().current,null);

const manyChanges=Array.from({length:9},(_,i)=>({
  type:'resource',
  key:'resource_'+i,
  name:'Zasób '+i,
  direction:i===8?'loss':'gain',
  delta:i===8?-2:i+1,
  cause:'',
  deathCause:'',
  color:'#8ab4d6'
}));
const thresholdQueue=createInventoryFeedbackQueue();
thresholdQueue.push(manyChanges.slice(0,INVENTORY_FEEDBACK_COMPACT_THRESHOLD));
assert.notEqual(thresholdQueue.state().current.type,'batch','five changes keep the familiar sequential presentation');
thresholdQueue.clear();
thresholdQueue.push(manyChanges.slice(0,INVENTORY_FEEDBACK_COMPACT_THRESHOLD+1));
assert.equal(thresholdQueue.state().current.type,'batch','the sixth change switches the burst to a compact card');
assert.equal(thresholdQueue.state().current.entries.length,6);
assert.equal(thresholdQueue.state().compactMode,true);
thresholdQueue.finish();
assert.equal(thresholdQueue.state().current,null);
assert.equal(thresholdQueue.state().compactMode,false,'compact mode ends with the drained burst');

const balancedQueue=createInventoryFeedbackQueue();
balancedQueue.push(manyChanges);
assert.equal(balancedQueue.state().current.entries.length,INVENTORY_FEEDBACK_BATCH_SIZE-1,'nine changes avoid an eight-plus-one presentation');
assert.equal(balancedQueue.state().pending.length,2);
balancedQueue.finish();
assert.equal(balancedQueue.state().current.type,'batch');
assert.equal(balancedQueue.state().current.entries.length,2);
assert.equal(balancedQueue.state().current.direction,'mixed','each compact batch preserves mixed gain/loss semantics');

const growingQueue=createInventoryFeedbackQueue();
growingQueue.push(manyChanges.slice(0,1));
growingQueue.push(manyChanges.slice(1,6));
assert.equal(growingQueue.state().current.type,'resource');
assert.equal(growingQueue.state().compactMode,true,'a burst that grows while its first card is visible still condenses its backlog');
growingQueue.finish();
assert.equal(growingQueue.state().current.type,'batch');
assert.equal(growingQueue.state().current.entries.length,5);

const feedbackSource=readFileSync(new URL('../src/engine/inventory_feedback.js',import.meta.url),'utf8');
const htmlSource=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const mainSource=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const bossSource=readFileSync(new URL('../src/engine/bosses.js',import.meta.url),'utf8');
const meteorSource=readFileSync(new URL('../src/engine/meteorites.js',import.meta.url),'utf8');
const mechSource=readFileSync(new URL('../src/engine/mechs.js',import.meta.url),'utf8');
const guardianSource=readFileSync(new URL('../src/engine/guardian_lairs.js',import.meta.url),'utf8');
const npcSource=readFileSync(new URL('../src/engine/npc_system.js',import.meta.url),'utf8');
const ufoSource=readFileSync(new URL('../src/engine/ufo.js',import.meta.url),'utf8');
const chestSource=readFileSync(new URL('../src/engine/chests.js',import.meta.url),'utf8');
assert.match(feedbackSource,/function renderBatch\(row,entry,queueState\)[\s\S]*inventoryFeedBatchItem[\s\S]*inventoryFeedBatchAmount/,'compact changes render their names and signed amounts together');
assert.match(htmlSource,/#smartFeed\{[^}]*left:calc\(var\(--safe-left\) \+ 10px\)[^}]*width:min\(190px/,'the shared activity feed owns a slim left-edge desktop lane');
assert.doesNotMatch(htmlSource,/#smartFeed\{[^}]*left:50%/,'activity feedback never returns to a central screen anchor');
assert.match(htmlSource,/smartFeedItems\{[^}]*grid-template-columns:minmax\(0,1fr\)/,'large bursts keep full names in a readable single-column list');
assert.match(htmlSource,/@media \(max-width:760px\)\{ #smartFeed\{[^}]*width:min\(190px/,'touch feedback stays narrow enough to preserve the center of the game');
assert.match(mainSource,/publish:publishInventoryFeedEntry/,'inventory transactions publish into the shared feed');
assert.match(mainSource,/detail:inventoryFeedbackEventDetail\(opts\)/,'the canonical HUD refresh emits its transaction context on the first snapshot event');
assert.match(bossSource,/addUfoConcreteResource\(count\)[\s\S]{0,900}updateInventoryHud\(\{resourceChange,inventoryFeedbackContext\}\)/,'boss blast matter uses the canonical reward refresh');
assert.match(meteorSource,/addMeteorUfoConcrete\(count\)[\s\S]{0,900}updateInventoryHud\(\{resourceChange,inventoryFeedbackContext\}\)/,'meteor matter uses the canonical reward refresh');
assert.match(mechSource,/awardPilotLoot\(m\)[\s\S]{0,240}kind:'reward',source:'alien_mech_pilot'/,'mech pilot biomass is marked as a non-obvious reward');
assert.match(guardianSource,/const source='guardian_heart_'\+kind;[\s\S]{0,360}updateInventoryHud\(\{resourceChange,inventoryFeedbackContext\}\)/,'guardian hearts carry reward attribution');
assert.match(npcSource,/source='npc_reward_'\+id[\s\S]{0,220}inventoryFeedbackContext:\{kind:'reward',source\}/,'NPC resource grants carry reward attribution');
assert.match(ufoSource,/source='ufo_destroy'[\s\S]{0,220}updateInventoryHud\(\{resourceChange,inventoryFeedbackContext\}\)/,'UFO wreck resources carry reward attribution');
assert.match(mainSource,/source:'grave_system_refund'[\s\S]{0,100}inventoryFeedbackContext:\{kind:'reward',source:'grave_system_refund'\}/,'automatic grave repair refunds publish their exact resource changes');
assert.match(chestSource,/directlyCredited[\s\S]{0,1800}source='chest_fallback'[\s\S]{0,180}updateInventoryHud\(\{[\s\S]{0,100}inventoryFeedbackContext:\{kind:'reward',source\}/,'chest drop-cap fallbacks refresh the HUD with reward attribution');

const eventTarget=new EventTarget();
const liveCounts={wood:10,diamond:2};
const liveItems=[];
const controller=createInventoryFeedback({
  eventTarget,
  resourceDefs,
  specialDefs:[],
  getResourceCount:key=>liveCounts[key],
  getItems:()=>liveItems
}).start();
eventTarget.dispatchEvent(new CustomEvent('mm-hero-died',{detail:{cause:'molekin_invasion'}}));
liveCounts.wood=5;
eventTarget.dispatchEvent(new CustomEvent('mm-resources-change'));
assert.equal(controller.state().current.delta,-5);
assert.equal(controller.state().current.cause,'death');
assert.equal(controller.state().current.deathCause,'molekin_invasion');
controller.destroy();

const burstDefs=Array.from({length:6},(_,i)=>({key:'r'+i,label:'R'+i,color:'#8ab4d6'}));
const burstCounts=Object.fromEntries(burstDefs.map(def=>[def.key,0]));
const published=[];
const publisher=createInventoryFeedback({
  eventTarget,
  resourceDefs:burstDefs,
  specialDefs:[],
  getResourceCount:key=>burstCounts[key],
  getItems:()=>[],
  publish:entry=>published.push(entry)
}).start();
for(const def of burstDefs) burstCounts[def.key]=1;
eventTarget.dispatchEvent(new CustomEvent('mm-resources-change'));
assert.equal(published.length,1,'one compact transaction reaches the shared feed');
assert.equal(published[0].type,'batch');
assert.equal(published[0].entries.length,6,'more than five simultaneous changes stay condensed');
assert.equal(publisher.state().current,null,'the shared feed becomes the only remaining presentation queue');
publisher.destroy();

const filteredCounts={wood:10,diamond:0};
const valuable=[];
const filtered=createInventoryFeedback({
  eventTarget,
  resourceDefs,
  specialDefs:[],
  getResourceCount:key=>filteredCounts[key],
  getItems:()=>[],
  publish:entry=>valuable.push(entry),
  shouldInclude:entry=>entry.cause==='reward'
}).start();
filteredCounts.wood=9;
eventTarget.dispatchEvent(new CustomEvent('mm-resources-change',{detail:{key:'wood',spent:1}}));
assert.equal(valuable.length,0,'intentional spending never reaches the notification lane');
filteredCounts.wood=11;
eventTarget.dispatchEvent(new CustomEvent('mm-resources-change',{detail:inventoryFeedbackEventDetail({
  resourceChange:{key:'wood',gained:2},
  inventoryFeedbackContext:{kind:'reward',source:'meteor'}
})}));
assert.equal(valuable.length,1,'an out-of-band reward remains visible');
assert.equal(valuable[0].delta,2,'suppressed direct changes still advance the comparison snapshot');
assert.equal(valuable[0].cause,'reward');
filtered.destroy();

const orderedCounts={wood:0,diamond:0};
const orderedRewards=[];
const ordered=createInventoryFeedback({
  eventTarget,
  resourceDefs,
  specialDefs:[],
  getResourceCount:key=>orderedCounts[key],
  getItems:()=>[],
  publish:entry=>orderedRewards.push(entry),
  shouldInclude:entry=>entry.cause==='reward'
}).start();
orderedCounts.wood=3;
eventTarget.dispatchEvent(new CustomEvent('mm-resources-change',{detail:inventoryFeedbackEventDetail({
  resourceChange:{key:'wood',gained:3},
  inventoryFeedbackContext:{kind:'reward',source:'boss_blast'}
})}));
assert.equal(orderedRewards.length,1,'the first canonical refresh publishes an automatic reward before its snapshot advances');
eventTarget.dispatchEvent(new CustomEvent('mm-resources-change',{detail:{key:'wood',gained:3,source:'boss_blast'}}));
assert.equal(orderedRewards.length,1,'a redundant legacy event cannot duplicate an already published reward');
ordered.destroy();

console.log('inventory feedback simulation passed');
