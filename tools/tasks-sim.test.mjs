import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.performance = {now:()=>1000};

const panel = {hidden:false, title:''};
const status = {textContent:'', title:''};
globalThis.document = {
  getElementById(id){
    if(id === 'taskPanel') return panel;
    if(id === 'taskStatus') return status;
    return null;
  }
};

const { tasks } = await import('../src/engine/tasks.js');
let userChanges = 0;
tasks.setContext({onChange(){ userChanges++; }});

tasks.reset();
assert.equal(tasks.metrics().active, 0, 'task tracker starts empty after reset');
assert.equal(panel.hidden, true, 'empty task tracker hides the HUD task panel');

const alienTask = tasks.upsertAlienCache({
  id:'cache_1',
  x:80,
  y:42,
  resources:{wood:12, stone:3},
  gear:[{id:'blade_1'}],
  createdAt:123
});
assert.equal(alienTask.id, 'invasion_cache:cache_1', 'alien cache gets a stable recovery task id');
assert.equal(tasks.metrics().active, 1, 'alien cache creates one active recovery task');
assert.match(status.textContent, /Zadania 1 - Odzyskaj skradziony lup/, 'HUD names the active recovery task');
assert.equal(userChanges, 1, 'creating a task requests persistence');
tasks.upsertAlienCache({
  id:'cache_1', x:80, y:42, resources:{wood:12, stone:3}, gear:[{id:'blade_1'}], createdAt:123
});
assert.equal(userChanges, 1, 'an identical periodic task refresh does not schedule another save');

const player = {x:0,y:42};
const target = tasks.trackedTarget(player);
assert.equal(target.task.id, 'invasion_cache:cache_1', 'tracked target returns the stolen loot recovery task');
assert.equal(Math.round(target.dist), 81, 'tracked target reports distance from the hero');

const drawCalls = [];
const ctx = {
  save(){ drawCalls.push('save'); },
  restore(){ drawCalls.push('restore'); },
  translate(x,y){ drawCalls.push(['translate',x,y]); },
  rotate(a){ drawCalls.push(['rotate',a]); },
  beginPath(){ drawCalls.push('beginPath'); },
  moveTo(x,y){ drawCalls.push(['moveTo',x,y]); },
  lineTo(x,y){ drawCalls.push(['lineTo',x,y]); },
  closePath(){ drawCalls.push('closePath'); },
  fill(){ drawCalls.push('fill'); },
  fillRect(x,y,w,h){ drawCalls.push(['fillRect',x,y,w,h]); },
  fillText(text,x,y){ drawCalls.push(['fillText',text,x,y]); }
};
assert.equal(tasks.drawHUD(ctx,800,600,0,0,1,20,null,player), true, 'off-screen task draws the shared red pointer');
assert.ok(drawCalls.some(c=>Array.isArray(c) && c[0] === 'fillText' && /m$/.test(c[1])), 'task pointer includes a distance label');

const sideTask = tasks.upsert({
  id:'side:signal', source:'story', title:'Sprawdz sygnal', detail:'Slaby sygnal ze wschodu',
  priority:1, pointer:true, target:{x:24,y:42,label:'Sygnal'}
});
assert.equal(tasks.trackedTarget(player).task.id, alienTask.id, 'automatic ordering still prefers the urgent recovery task');
assert.equal(tasks.setPriority(sideTask.id), true, 'the player can select a task as priority');
assert.equal(tasks.activeList(player)[0].id, sideTask.id, 'selected priority moves to the top of the complete active list');
assert.equal(tasks.trackedTarget(player).task.id, sideTask.id, 'the shared red pointer follows the selected priority');
assert.match(status.textContent, /★ Sprawdz sygnal/, 'compact HUD marks the selected priority');
assert.equal(userChanges, 3, 'task creation and priority changes request persistence');

assert.equal(tasks.discard(alienTask.id), true, 'the player can discard an active task');
assert.equal(tasks.metrics().active, 1, 'discarded task leaves the active list');
assert.equal(tasks.metrics().discarded, 1, 'discarded task is retained as a source-refresh tombstone');
tasks.upsertAlienCache({id:'cache_1',x:80,y:42,resources:{wood:12},gear:[],createdAt:123});
assert.equal(tasks.metrics().active, 1, 'periodic source refresh does not resurrect a discarded task');
assert.equal(userChanges, 4, 'discard changes request persistence');

const snap = tasks.snapshot();
tasks.reset();
assert.equal(tasks.metrics().active, 0, 'reset clears active tasks');
assert.equal(tasks.restore(snap), true, 'task snapshot restores');
assert.equal(tasks.metrics().active, 1, 'restored snapshot contains the remaining active task');
assert.equal(tasks.metrics().discarded, 1, 'restored snapshot keeps discarded tasks dismissed');
assert.equal(tasks.metrics().priorityId, sideTask.id, 'restored snapshot keeps the selected priority');
assert.equal(tasks.trackedTarget(player).task.id, sideTask.id, 'restored pointer still follows the selected priority');

const locationFreeUpdate=tasks.upsert({
  id:sideTask.id, source:'story', title:'Sprawdz dowolne drzewo', pointer:false, target:null
});
assert.equal(locationFreeUpdate.target, undefined, 'an explicit null target clears coordinates inherited from an earlier phase');
assert.equal(locationFreeUpdate.pointer, false, 'clearing inherited coordinates also disables its map pointer');
assert.equal(tasks.trackedTarget(player), null, 'a location-free priority task cannot keep pointing at its previous coordinates');

assert.equal(tasks.completeAlienCache({id:'cache_1'}), true, 'opening an alien cache completes the matching task');
assert.equal(tasks.metrics().active, 1, 'completing a discarded cache leaves other active tasks untouched');
assert.equal(tasks.metrics().discarded, 0, 'completed cache releases its discarded tombstone');
assert.equal(tasks.metrics().history, 1, 'completed tasks remain in history');
assert.equal(tasks.remove(sideTask.id), true, 'test side task can be retired');

tasks.upsert({id:'note:no_target',source:'story',title:'Przemysl wskazowke',priority:3,pointer:false});
assert.equal(tasks.setPriority('note:no_target'), true, 'a task without coordinates can still be the list priority');
assert.equal(tasks.trackedTarget(player), null, 'a priority without coordinates does not point at an unrelated task');
assert.equal(tasks.discard('note:no_target'), true, 'priority without a target can be discarded');
assert.equal(tasks.metrics().priorityId, '', 'discarding the priority clears the pointer selection');

tasks.syncAlienCaches([
  {id:'cache_2',x:10,y:10,resources:{diamond:1},gear:[],createdAt:200},
  {id:'cache_3',x:-20,y:12,resources:{},gear:[{id:'cape_1'}],createdAt:300}
]);
assert.equal(tasks.metrics().active, 2, 'sync can rebuild all active alien-cache tasks from invasion state');
tasks.syncAlienCaches([{id:'cache_3',x:-20,y:12,resources:{},gear:[{id:'cape_1'}],createdAt:300}]);
assert.equal(tasks.metrics().active, 1, 'sync removes alien-cache tasks whose caches no longer exist');
assert.equal(tasks.removeSource('invasions'), 1, 'source removal clears invasion recovery tasks');
assert.equal(userChanges, 14, 'creation, completion, removal, sync and source cleanup all request persistence without refresh churn');

// Imported/corrupted task state is bounded and deterministic: a discarded
// tombstone wins over a duplicate active row, and newest-first history stays so.
tasks.restore({
  v:2,
  active:[{id:'duplicate',source:'story',title:'Aktywne',status:'active'}],
  discarded:[{id:'duplicate',source:'story',title:'Odrzucone',status:'discarded'}],
  history:[
    {id:'done:new',source:'story',title:'Nowsze',status:'done',completedAt:300},
    {id:'done:old',source:'story',title:'Starsze',status:'done',completedAt:200}
  ]
});
assert.equal(tasks.metrics().active,0,'discarded duplicate cannot reappear as active after restore');
assert.equal(tasks.metrics().discarded,1,'discard tombstone survives duplicate-state cleanup');
assert.deepEqual(tasks.state().history.map(t=>t.id),['done:new','done:old'],'history order remains newest-first after restore');

const oversized=Array.from({length:220},(_,i)=>({id:'bulk:'+i,source:'import',title:'Task '+i,status:'active'}));
tasks.restore({v:2,active:oversized});
assert.equal(tasks.metrics().active,160,'restore bounds oversized imported task arrays');

console.log('tasks-sim: all assertions passed');
