import assert from 'node:assert/strict';
import { createSingleNoticeQueue } from '../src/engine/single_notice_queue.js';

const queue=createSingleNoticeQueue(entry=>entry.itemId);
assert.equal(queue.enqueue({itemId:'best'}),true);
assert.equal(queue.enqueue({itemId:'second'}),true);
assert.equal(queue.enqueue({itemId:'third'}),true);
assert.equal(queue.enqueue({itemId:'second'}),false,'the same find cannot occupy two queue positions');
assert.equal(queue.state().current.itemId,'best','the first find is the only active decision');
assert.deepEqual(queue.state().pending.map(entry=>entry.itemId),['second','third']);

queue.prunePending(entry=>entry.itemId!=='second');
assert.deepEqual(queue.state().pending.map(entry=>entry.itemId),['third'],'unavailable waiting items are removed without touching the active card');
queue.finish();
assert.equal(queue.state().current.itemId,'third','handling the active card promotes the next available find');
assert.equal(queue.state().pending.length,0);
queue.finish();
assert.equal(queue.state().current,null);

assert.equal(queue.enqueue({itemId:'best'}),true,'a handled id may be queued again in a future acquisition');
queue.clear();
assert.deepEqual(queue.state(),{current:null,pending:[]});

console.log('single notice queue simulation passed');
