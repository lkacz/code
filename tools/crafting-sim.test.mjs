// Headless test for the crafting meta-model: affordability math, favorites,
// tracked-recipe HUD status edges, NEW-availability detection and the
// snapshot/restore save contract (including the legacy {seenAvailable} shape).
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};

const { createCraftingModel, SOURCE_HINTS } = await import('../src/engine/crafting.js');

const inv = { wood:0, stone:0, coal:0, diamond:0 };
const doneIds = new Set();
const recipes = [
  {id:'torch', name:'Pochodnie', cost:{wood:2}},
  {id:'pick', name:'Kilof', cost:{stone:10}},
  {id:'sword', name:'Miecz', cost:{coal:3, diamond:1}},
  {id:'free', name:'Totem', cost:{}}
];
const model = createCraftingModel({
  recipes,
  getHave:k=>inv[k]||0,
  isDone:r=>doneIds.has(r.id)
});

// --- Affordability math ---
assert.equal(model.maxCrafts(recipes[0]), 0, 'no wood -> no torches');
assert.equal(model.canCraft(recipes[3]), true, 'costless recipe is always craftable once');
assert.equal(model.maxCrafts(recipes[3]), 1, 'costless recipe caps at one batch');
inv.wood = 7;
assert.equal(model.maxCrafts(recipes[0]), 3, 'batch capacity floors have/need');
assert.equal(model.progress(recipes[0]), 1, 'affordable recipe reports full progress');
inv.coal = 2; inv.diamond = 0;
const miss = model.missing(recipes[2]);
assert.deepEqual(miss.map(m=>m.key), ['coal','diamond'], 'missing lists every short ingredient');
assert.equal(miss[0].missing, 1, 'missing counts the shortfall');
assert.ok(Math.abs(model.progress(recipes[2]) - 0) < 1e-9, 'bottleneck ingredient (0 diamonds) pins progress at 0');
inv.diamond = 1;
assert.ok(Math.abs(model.progress(recipes[2]) - 2/3) < 1e-9, 'progress tracks the bottleneck ratio');
doneIds.add('pick'); inv.stone = 99;
assert.equal(model.maxCrafts(recipes[1]), 0, 'done recipes stop being craftable');
assert.equal(model.progress(recipes[1]), 1, 'done recipes report full progress');
doneIds.delete('pick');

// --- Availability (toasts + NEW badges) ---
inv.stone = 0;
let newly = model.syncAvailability();
assert.deepEqual(newly.map(r=>r.id).sort(), ['free','torch'], 'first sync reports currently craftable recipes as new');
assert.equal(model.isFresh('torch'), true, 'newly available recipe carries a NEW badge');
assert.equal(model.syncAvailability().length, 0, 'second sync reports nothing new');
inv.stone = 10;
newly = model.syncAvailability();
assert.deepEqual(newly.map(r=>r.id), ['pick'], 'ingredient influx surfaces the newly affordable recipe');
model.markSeen('torch');
assert.equal(model.isFresh('torch'), false, 'viewing a recipe clears its NEW badge');
assert.equal(model.freshCount(), 2, 'other fresh recipes stay badged');

// --- Favorites ---
assert.equal(model.toggleFavorite('sword'), true, 'toggling favorites on reports the new state');
assert.equal(model.isFavorite('sword'), true, 'favorite sticks');
assert.equal(model.toggleFavorite('nope'), false, 'unknown ids cannot be favorited');
assert.equal(model.toggleFavorite('sword'), false, 'second toggle removes the favorite');
model.toggleFavorite('sword');

// --- Tracked recipe + justReady edge ---
inv.coal = 0;
assert.equal(model.setTracked('sword'), 'sword', 'tracking accepts a known recipe');
let st = model.trackedStatus();
assert.equal(st.canCraft, false, 'tracked status reflects missing ingredients');
assert.equal(st.justReady, false, 'not ready -> no ready edge');
inv.coal = 3;
st = model.trackedStatus();
assert.equal(st.canCraft && st.justReady, true, 'crossing into affordable fires justReady once');
st = model.trackedStatus();
assert.equal(st.justReady, false, 'ready edge only fires once');
inv.coal = 0;
model.trackedStatus(); // dips back below
inv.coal = 3;
assert.equal(model.trackedStatus().justReady, true, 'ready edge re-arms after a dip');
assert.equal(model.toggleTracked('sword'), null, 'toggling the tracked recipe untracks it');
model.setTracked('sword');

// --- Craft statistics ---
assert.equal(model.recordCraft('torch', 3), 3, 'recordCraft accumulates');
model.recordCraft('torch', 2);
assert.equal(model.countOf('torch'), 5, 'per-recipe lifetime count');
assert.equal(model.totalCrafts(), 5, 'total spans all recipes');
assert.equal(model.recordCraft('nope', 1), 0, 'unknown ids are not counted');

// --- Snapshot / restore roundtrip ---
const snap = model.snapshot();
assert.ok(snap.seenAvailable.includes('pick'), 'snapshot persists ever-available ids');
assert.ok(snap.favorites.includes('sword'), 'snapshot persists favorites');
assert.equal(snap.tracked, 'sword', 'snapshot persists the tracked recipe');
assert.equal(snap.counts.torch, 5, 'snapshot persists craft counts');
model.reset();
assert.equal(model.trackedId(), null, 'reset clears tracking');
assert.equal(model.restore(snap), true, 'restore accepts a full snapshot');
assert.equal(model.isFavorite('sword'), true, 'favorites survive the roundtrip');
assert.equal(model.trackedId(), 'sword', 'tracked recipe survives the roundtrip');
assert.equal(model.countOf('torch'), 5, 'craft counts survive the roundtrip');
assert.deepEqual(model.syncAvailability().map(r=>r.id), ['sword'],
  'restore keeps old announcements suppressed but still surfaces recipes that became affordable since the snapshot');

// --- Legacy save shape + corrupt input ---
assert.equal(model.restore({seenAvailable:['torch','ghost_recipe']}), true, 'legacy {seenAvailable} restores');
assert.equal(model.isFavorite('sword'), false, 'legacy restore resets modern fields');
assert.equal(model.syncAvailability().some(r=>r.id==='torch'), false, 'legacy seenAvailable suppresses re-announcing');
assert.equal(model.restore(null), false, 'missing snapshot falls back to silent seeding');
assert.equal(model.freshCount(), 0, 'silent seeding never creates NEW badges');
assert.equal(model.syncAvailability().length, 0, 'seeded availability matches current inventory');
assert.equal(model.restore({seenAvailable:'junk'}), false, 'corrupt snapshot falls back to seeding');

// --- Source hints cover every ingredient the shipped recipes use ---
const mainSrc = await import('node:fs').then(fs=>fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8'));
const recipesBlock = mainSrc.slice(mainSrc.indexOf('const RECIPES=['), mainSrc.indexOf('const CRAFT_GROUPS='));
const usedKeys = new Set();
for(const m of recipesBlock.matchAll(/cost:\{([^}]*)\}/g)){
  for(const part of m[1].split(',')){
    const key = part.split(':')[0].trim();
    if(key) usedKeys.add(key);
  }
}
assert.ok(usedKeys.size >= 20, 'sanity: recipe scan found the shipped ingredient keys');
for(const key of usedKeys){
  assert.ok(typeof SOURCE_HINTS[key] === 'string' && SOURCE_HINTS[key].length > 0,
    'SOURCE_HINTS explains where to find "'+key+'"');
}

console.log('crafting-sim: all assertions passed');
