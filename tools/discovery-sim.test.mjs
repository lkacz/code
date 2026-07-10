// Discovery journal regressions: catalog completeness (every note() id used in
// src has a player-facing label), progress math, one-shot toasts and reset.
// Run: node tools/discovery-sim.test.mjs
import { strict as assert } from 'assert';
import { readFileSync, readdirSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};
let toasts = [];
globalThis.msg = (t) => { toasts.push(String(t)); };

const { discovery } = await import('../src/engine/discovery.js');
assert.ok(discovery, 'discovery module exports');
discovery.reset();

// --- catalog completeness: scan src for every id fed to note() -------------
const ids = new Set();
function scanDir(dir){
  for(const entry of readdirSync(dir, {withFileTypes:true})){
    if(entry.isDirectory()){ scanDir(dir + '/' + entry.name); continue; }
    if(!entry.name.endsWith('.js')) continue;
    const src = readFileSync(dir + '/' + entry.name, 'utf8');
    for(const m of src.matchAll(/discovery\.note\('([a-z_]+)'/g)){
      if(m[1] !== 'react_') ids.add(m[1]); // dynamic reactions handled below
    }
    // dynamic reaction ids: noteStatusReaction(m,'kind',...) => react_<kind>
    for(const m of src.matchAll(/noteStatusReaction\([^,]+,'([a-z_]+)'/g)) ids.add('react_' + m[1]);
  }
}
scanDir(new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
assert.ok(ids.size >= 10, 'source scan found the discovery hooks (got ' + ids.size + ')');
for(const id of ids){
  assert.ok(discovery.CATALOG[id], `discovery id "${id}" used in src has a catalog label`);
}

// --- one-shot toasts, progress math ----------------------------------------
assert.equal(discovery.count(), 0, 'journal starts empty');
assert.equal(discovery.total(), Object.keys(discovery.CATALOG).length, 'total mirrors the catalog');
assert.equal(discovery.note('stone_melt', 'Ogień topi kamień w lawę!'), true, 'first occurrence is recorded');
assert.equal(toasts.length, 1, 'the first occurrence toasts');
assert.ok(toasts[0].includes('Odkrycie'), 'the toast is branded as a discovery');
assert.equal(discovery.note('stone_melt', 'Ogień topi kamień w lawę!'), false, 'repeats are silent');
assert.equal(toasts.length, 1, 'no duplicate toast');
assert.equal(discovery.has('stone_melt'), true, 'has() sees the entry');
assert.equal(discovery.count(), 1, 'count tracks the journal');
discovery.note('react_freeze', 'x');
const p = discovery.progress();
assert.equal(p.count, 2, 'progress counts found entries');
assert.equal(p.total, discovery.total(), 'progress exposes the catalog size');
assert.ok(p.found.some(f => f.id === 'react_freeze' && /lodu/i.test(f.label)), 'progress lists catalog labels, not raw ids');

// --- unknown ids never crash and never count --------------------------------
assert.equal(discovery.note('', 'x'), false, 'empty id refused');
assert.equal(discovery.note(123, 'x'), false, 'non-string id refused');

// --- journal-tab view: entries() masks unfound ids to ??? + category hint ----
{
  const all = discovery.entries();
  assert.equal(all.length, discovery.total(), 'entries() covers the whole catalog');
  const found = all.find(e => e.id === 'stone_melt');
  assert.equal(found.found, true, 'found entries are flagged');
  assert.equal(found.label, discovery.CATALOG.stone_melt, 'found entries expose their label');
  const hidden = all.find(e => e.id === 'sandstorm');
  assert.equal(hidden.found, false, 'unfound entries stay masked');
  assert.equal(hidden.label, null, 'no label leaks before the discovery');
  assert.ok(hidden.cat && hidden.cat.length > 2, 'every entry carries a category');
  assert.ok(hidden.hint && hidden.hint.length > 8, 'unfound entries carry a foggy hint');
  for(const e of all) assert.ok(discovery.HINTS[e.id], `catalog id "${e.id}" has a journal hint entry`);
}

// --- +XP on every fresh discovery (progress.js turns player.xp into levels) --
{
  globalThis.player = { xp: 100 };
  assert.equal(discovery.note('sandstorm', 'test'), true, 'fresh discovery lands');
  assert.equal(globalThis.player.xp, 100 + discovery.DISCOVERY_XP, 'a fresh discovery pays +' + discovery.DISCOVERY_XP + ' XP');
  assert.equal(discovery.note('sandstorm', 'test'), false, 'repeat is silent');
  assert.equal(globalThis.player.xp, 100 + discovery.DISCOVERY_XP, 'repeats never re-pay the XP');
  assert.ok(toasts.some(t => t.includes('+' + discovery.DISCOVERY_XP + ' XP')), 'the toast advertises the XP award');
  delete globalThis.player;
}

discovery.reset();
assert.equal(discovery.count(), 0, 'reset clears the journal');

console.log('discovery-sim: all assertions passed');
