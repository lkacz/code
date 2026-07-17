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
{
  const hardenedCounts=createCraftingModel({recipes,getHave:k=>inv[k]||0,isDone:()=>false});
  assert.equal(hardenedCounts.recordCraft('torch',5),5,'hardened counter starts with the requested finite amount');
  assert.equal(hardenedCounts.recordCraft('torch',Number.POSITIVE_INFINITY),6,'non-finite craft increments are reduced to one safe craft');
  assert.equal(hardenedCounts.recordCraft('torch',2_000_000),999999,'craft statistics cap before integer precision or UI counters can overflow');
}

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

// Hostile/oversized save fields are bounded and irrelevant material names are
// discarded instead of permanently bloating discovery state.
{
  const junk=Array.from({length:5000},(_,i)=>'junk_'+i);
  const hardened=createCraftingModel({ recipes, getHave:k=>inv[k]||0, isDone:()=>false });
  assert.equal(hardened.restore({
    seenAvailable:['torch',...junk],
    fresh:['torch',...junk],
    favorites:['sword',...junk],
    tracked:'sword',
    knownMaterials:['wood','not_a_recipe_material',...junk],
    seenResults:['pick',...junk],
    counts:{torch:9,ghost_recipe:999999}
  }),true,'bounded restore accepts valid state mixed with oversized junk');
  assert.equal(hardened.isKnownMaterial('wood'),true,'valid ingredient knowledge survives hardened restore');
  assert.equal(hardened.isKnownMaterial('not_a_recipe_material'),false,'irrelevant material keys are rejected on restore');
  assert.ok(hardened.snapshot().knownMaterials.length<=4,'restored material knowledge stays bounded by recipe ingredients');
}

// --- Progressive recipe discovery (unlock gating) ---------------------------
// A recipe stays hidden until the player has touched every ingredient type
// (knownMaterials), has seen the crafted result in the world (seenResults),
// once could afford it (seenAvailable), or has crafted it before.
{
  const inv2 = { wood:0, stone:0, coal:0, diamond:0 };
  const m2 = createCraftingModel({ recipes, getHave:k=>inv2[k]||0, isDone:()=>false });
  assert.equal(m2.isUnlocked('free'), true, 'costless recipes are always known');
  assert.equal(m2.isUnlocked('torch'), false, 'untouched materials keep the recipe hidden');
  assert.equal(m2.lockedCount(), 3, 'all costed recipes start locked');

  // Touching ONE of two ingredients is not enough; the full set unlocks.
  assert.deepEqual(m2.noteMaterials(['coal']).map(r=>r.id), [], 'partial ingredient knowledge stays locked');
  assert.equal(m2.isUnlocked('sword'), false, 'sword still needs diamond knowledge');
  assert.deepEqual(m2.noteMaterials(['diamond']).map(r=>r.id), ['sword'], 'covering every ingredient unlocks the recipe');
  assert.equal(m2.isFresh('sword'), true, 'a fresh unlock carries the NEW badge');
  assert.deepEqual(m2.noteMaterials(['diamond']), [], 'already-known materials unlock nothing new');

  // Seeing the result standing in the world unlocks without any materials.
  assert.equal(m2.noteSeenResult('torch').id, 'torch', 'world sighting unlocks the recipe');
  assert.equal(m2.noteSeenResult('torch'), null, 'a second sighting is not a new unlock');
  assert.equal(m2.isUnlocked('torch'), true, 'sighted recipe is unlocked');
  assert.equal(m2.noteSeenResult('sword'), null, 'sighting an already-unlocked recipe returns nothing');

  // Silent seeding (boot path) adds knowledge without badges.
  const m3 = createCraftingModel({ recipes, getHave:k=>inv2[k]||0, isDone:()=>false });
  m3.noteMaterials(['stone'], {silent:true});
  assert.equal(m3.isKnownMaterial('stone'), true, 'silent noteMaterials records knowledge');
  assert.equal(m3.freshCount(), 0, 'silent noteMaterials never badges');
  assert.equal(m3.isUnlocked('pick'), true, 'silently-seeded material still unlocks');

  // Snapshot round-trip carries knownMaterials + seenResults.
  const snap2 = m2.snapshot();
  assert.ok(snap2.knownMaterials.includes('coal'), 'snapshot persists material knowledge');
  assert.ok(snap2.seenResults.includes('torch'), 'snapshot persists world sightings');
  const m4 = createCraftingModel({ recipes, getHave:k=>inv2[k]||0, isDone:()=>false });
  m4.restore(snap2);
  assert.equal(m4.isUnlocked('sword'), true, 'material knowledge survives the roundtrip');
  assert.equal(m4.isUnlocked('torch'), true, 'world sightings survive the roundtrip');

  // Legacy saves (no knownMaterials field) seed silently: currently-held
  // resources + ingredients of once-craftable recipes count as known.
  const inv3 = { wood:5, stone:0, coal:0, diamond:0 };
  const m5 = createCraftingModel({ recipes, getHave:k=>inv3[k]||0, isDone:()=>false });
  m5.restore({ seenAvailable:['pick'], fresh:[], favorites:[], tracked:null, counts:{} });
  assert.equal(m5.isUnlocked('torch'), true, 'legacy migration counts held resources as known');
  assert.equal(m5.isUnlocked('pick'), true, 'once-craftable recipes stay visible after migration');
  assert.equal(m5.isUnlocked('sword'), false, 'legacy migration does not leak untouched recipes');
}

// --- Recipe visibility gating is wired into the panel (source pins) ---------
{
  const mainSrcPin = await import('node:fs').then(fs=>fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8'));
  assert.match(mainSrcPin, /function craftRecipeVisible\(r\)\{ return \(godMode \|\| CRAFT_MODEL\.isUnlocked\(r\)\) && !challengeCraftBanned\(r\.id\); \}/, 'craft panel gates recipes on discovery (god mode sees all) and on challenge bans');
  assert.match(mainSrcPin, /let list=visibleCraftRecipes\(\)/, 'filteredCraftRecipes lists only discovered recipes');
  assert.match(mainSrcPin, /msg\('🔓 Odblokowany przepis: '\+shownU\+extraU\)/, 'newly unlocked recipes announce themselves');
  assert.match(mainSrcPin, /function scanCraftablesInView\(dt\)/, 'viewport sweep teaches recipes from world sightings');
  assert.match(mainSrcPin, /function resourceDiscovered\(key\)/, 'hotbar picker gates blocks on discovery');
  assert.match(mainSrcPin, /RESOURCE_DEFS\.filter\(r=>r\.tile && resourceDiscovered\(r\.key\)\)/, 'hot picker catalog filters undiscovered resources');

  // Category discovery: every real craft group / picker group has a journal
  // entry, and main.js reports first-of-category unlocks through it.
  assert.match(mainSrcPin, /function noteCategoryDiscoveries\(opts\)/, 'category unlocks flow through the discovery journal');
  const { discovery } = await import('../src/engine/discovery.js');
  const groupsBlock = mainSrcPin.slice(mainSrcPin.indexOf('const CRAFT_GROUPS=['), mainSrcPin.indexOf('const CRAFT_GROUP_LABELS'));
  const craftGroupIds = [...groupsBlock.matchAll(/\{id:'(\w+)',label:/g)].map(m=>m[1]).filter(id=>!['all','other'].includes(id));
  assert.ok(craftGroupIds.length >= 7, 'sanity: craft group scan found the shipped groups');
  for(const gid of craftGroupIds){
    assert.ok(discovery.CATALOG['craft_cat_'+gid], 'craft group "'+gid+'" has a discovery-journal entry');
    assert.ok(discovery.HINTS['craft_cat_'+gid], 'craft group "'+gid+'" has a journal hint');
  }
  const hotBlock = mainSrcPin.slice(mainSrcPin.indexOf('const HOT_SELECT_GROUPS=['), mainSrcPin.indexOf('function hotSelectCatalog('));
  const hotGroupIds = [...hotBlock.matchAll(/\{id:'(\w+)',label:/g)].map(m=>m[1]).filter(id=>!['chest','other'].includes(id));
  assert.ok(hotGroupIds.length >= 5, 'sanity: hot-picker group scan found the shipped groups');
  for(const gid of hotGroupIds){
    assert.ok(discovery.CATALOG['block_cat_'+gid], 'block group "'+gid+'" has a discovery-journal entry');
    assert.ok(discovery.HINTS['block_cat_'+gid], 'block group "'+gid+'" has a journal hint');
  }
}

// --- Source hints cover every ingredient the shipped recipes use ---
const mainSrc = await import('node:fs').then(fs=>fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8'));
const recipesBlock = mainSrc.slice(mainSrc.indexOf('const RECIPES=['), mainSrc.indexOf('const CRAFT_GROUPS='));
assert.match(mainSrc,/MM\.inventory\.grantItem\(def,\{equip:true,markNew:false\}\)/,'crafted gear uses the capacity-aware inventory transaction');
assert.match(mainSrc,/if\(madeOk===false \|\| craftedOutputFailed\)\{ for\(const k in r\.cost\) inv\[k\]\+=r\.cost\[k\]; break; \}/,'failed crafted output refunds every deducted ingredient');
for(const id of ['treasure_compass_copper','treasure_compass_silver','treasure_compass_iridium','treasure_compass_antimatter','night_goggles_basic','night_goggles_silver','thermal_goggles_iridium','thermal_goggles_antimatter']){
  assert.match(recipesBlock,new RegExp("id:'"+id+"'"),id+' is available through ordinary crafting progression');
}
assert.match(recipesBlock,/treasureSenseLevel:4/, 'best crafted compass reaches the hard-capped fourth tier');
assert.match(recipesBlock,/specialVisionLevel:4,visionMode:'thermal'/, 'advanced crafting exposes capped thermal optics');
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
