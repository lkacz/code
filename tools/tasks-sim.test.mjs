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

const snap = tasks.snapshot();
tasks.reset();
assert.equal(tasks.metrics().active, 0, 'reset clears active tasks');
assert.equal(tasks.restore(snap), true, 'task snapshot restores');
assert.equal(tasks.metrics().active, 1, 'restored snapshot contains active recovery task');

assert.equal(tasks.completeAlienCache({id:'cache_1'}), true, 'opening an alien cache completes the matching task');
assert.equal(tasks.metrics().active, 0, 'completed alien cache is no longer active');
assert.equal(tasks.metrics().history, 1, 'completed tasks remain in history');

tasks.syncAlienCaches([
  {id:'cache_2',x:10,y:10,resources:{diamond:1},gear:[],createdAt:200},
  {id:'cache_3',x:-20,y:12,resources:{},gear:[{id:'cape_1'}],createdAt:300}
]);
assert.equal(tasks.metrics().active, 2, 'sync can rebuild all active alien-cache tasks from invasion state');
tasks.syncAlienCaches([{id:'cache_3',x:-20,y:12,resources:{},gear:[{id:'cape_1'}],createdAt:300}]);
assert.equal(tasks.metrics().active, 1, 'sync removes alien-cache tasks whose caches no longer exist');
assert.equal(tasks.removeSource('invasions'), 1, 'source removal clears invasion recovery tasks');

console.log('tasks-sim: all assertions passed');
