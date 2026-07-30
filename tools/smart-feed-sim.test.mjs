import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SMART_FEED_DISCOVERY_HOLD_MS,
  SMART_FEED_MIN_INTERVAL_MS,
  classifySmartFeedMessage,
  createSmartFeedQueue
} from '../src/engine/smart_feed.js';

const queue=createSmartFeedQueue({minInterval:2000,maxHistory:3,maxPending:6});
queue.push({kind:'inventory',text:'Drewno +3'},0);
assert.equal(queue.promote(0).text,'Drewno +3','the first card appears immediately');
queue.push({kind:'inventory',text:'Kamień +2'},100);
assert.equal(queue.promote(1999),null,'a second card cannot appear before the pacing window');
assert.equal(queue.delay(1999),1);
assert.equal(queue.promote(2000).text,'Kamień +2','the next card appears at exactly two seconds');

queue.push({kind:'inventory',text:'Piasek +1',priority:40},2100);
queue.push({kind:'discovery',text:'Woda zamienia się w parę',priority:100},2200);
assert.equal(queue.promote(4000).kind,'discovery','an important discovery becomes the next card without bypassing pacing');
assert.equal(queue.promote(5999),null);
assert.equal(queue.promote(8199),null,'a discovery keeps the compact feed spotlight for its full visual cue');
assert.equal(queue.promote(8200).text,'Piasek +1');

queue.push({kind:'world',text:'Nadciąga burza',dedupeKey:'weather:storm'},10200);
const storm=queue.promote(10200);
assert.equal(storm.count,1);
const merged=queue.push({kind:'world',text:'Nadciąga burza',dedupeKey:'weather:storm'},10700);
assert.equal(merged.location,'history','a recent repeated event updates its visible history card');
assert.equal(storm.count,2,'duplicates receive a count badge instead of another queued card');

queue.push({kind:'info',text:'A'},12200);
queue.promote(12200);
queue.push({kind:'info',text:'B'},14200);
queue.promote(14200);
assert.equal(queue.state().history.length,3,'session history stays bounded');
assert.equal(queue.state().history[0].text,'B','newest history stays at the top');

const bounded=createSmartFeedQueue({minInterval:2000,maxPending:3,maxHistory:2});
for(let i=0;i<8;i++) bounded.push({kind:'info',text:'N'+i,priority:i},0);
assert.equal(bounded.state().pending.length,3,'hostile bursts cannot grow the pending queue without bound');
assert.deepEqual(
  bounded.state().pending.map(n=>n.priority).sort((a,b)=>b-a),
  [7,6,5],
  'when capped, higher-value pending notices survive'
);
const staged=createSmartFeedQueue({minInterval:0});
staged.push({kind:'discovery',stage:'observation',presentation:'collection',text:'Nowy biom',holdFor:2100,xp:5,dedupeKey:'atlas'},0);
const stagedNotice=staged.promote(0);
assert.equal(stagedNotice.stage,'observation','knowledge stage survives feed normalization');
assert.equal(stagedNotice.presentation,'collection','collection stamps retain their quieter presentation mode');
assert.equal(stagedNotice.holdFor,2100,'a basic atlas stamp can use a shorter spotlight than a breakthrough');
staged.push({kind:'discovery',stage:'observation',presentation:'collection',text:'Nowy katalog',xp:5,dedupeKey:'atlas'},100);
assert.equal(stagedNotice.count,2,'a burst of collection stamps compacts into one feed card');
assert.equal(stagedNotice.xp,10,'compacted collection cards retain the full awarded XP');

assert.equal(SMART_FEED_MIN_INTERVAL_MS,2000);
assert.equal(SMART_FEED_DISCOVERY_HOLD_MS,4200);
assert.equal(classifySmartFeedMessage('Nadciąga meteoryt!').kind,'world');
assert.equal(classifySmartFeedMessage('Brak energii').kind,'warning');
assert.equal(classifySmartFeedMessage('Zapisano grę').kind,'success');

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=readFileSync(new URL('../src/engine/smart_feed.js',import.meta.url),'utf8');
const uiSource=readFileSync(new URL('../src/engine/ui.js',import.meta.url),'utf8');
const bossSource=readFileSync(new URL('../src/engine/bosses.js',import.meta.url),'utf8');
assert.match(html,/<aside id="smartFeed"[^>]*role="region"/,'the shared feed has one landmark');
assert.match(source,/setAttribute\('role','log'\)/,'the visible history exposes chronological log semantics');
assert.match(source,/aria-expanded/,'the compact/expanded control is accessible');
assert.match(source,/opts\.urgent===true/,'structured producers can archive an urgent notice while using the immediate lane');
assert.match(source,/previousStack\.scrollTop/,'incoming cards preserve the reader scroll anchor');
assert.match(source,/options\.expanded===undefined \? false/,'the feed starts compact instead of covering gameplay');
assert.match(uiSource,/function msgImmediate\(text\)/,'the HUD retains a direct lane that cannot recursively duplicate urgent feed cards');
assert.match(bossSource,/puchnie od energii - uciekaj!',\{urgent:true\}/,'the short boss-heart escape window bypasses presentation pacing');
assert.match(html,/prefers-reduced-motion:reduce[^}]*smartFeedBubble/,'feed motion respects reduced-motion preferences');

console.log('smart-feed-sim: all assertions passed');
