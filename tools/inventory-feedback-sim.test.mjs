import assert from 'node:assert/strict';
import {
  createInventoryFeedback,
  createInventoryFeedbackQueue,
  diffInventoryFeedback
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

console.log('inventory feedback simulation passed');
