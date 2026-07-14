// Headless contract test for the data-driven home-furnishings catalogue.
// Covers stable tile IDs, constants/INFO/resource/recipe parity, crafting
// outputs, ingredient hygiene and the public lookup + canvas-rendering API.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};
let testNow = 1000;
globalThis.performance = { now: () => testNow };

const { T, INFO } = await import('../src/constants.js');
const {
  FURNISHINGS,
  FURNISHING_RESOURCES,
  FURNISHING_BY_TILE,
  FURNISHING_BY_KEY,
  getByTile,
  getByKey,
  getFurnishing,
  isFurnishingTile,
  findNearestRadio,
  furnishingTierAtDistance,
  selectFurnishingsForDistance,
  furnishingTraderOffersForDistance,
  rollChestFurnishing,
  FURNISHING_DISTANCE_BANDS,
  FURNISHING_FRONTIER_DISTANCE,
  FURNISHING_CHEST_CHANCES,
  createRecipes,
  drawTile,
  drawPreview,
  drawEffects,
  updateAudio,
  FURNISHING_SOUND_PROFILES,
  runtimeMetrics,
  resetRuntimeCaches,
  furnishings,
  default: furnishingsApi
} = await import('../src/engine/furnishings.js');

assert.ok(Array.isArray(FURNISHINGS), 'furnishings exports a definition array');
assert.equal(FURNISHINGS.length, 32, 'the home catalogue ships exactly 32 furnishings');

const unique = (values, label) => {
  assert.equal(new Set(values).size, values.length, label + ' are unique');
};

const ids = FURNISHINGS.map(def => def.id);
const keys = FURNISHINGS.map(def => def.key);
const tiles = FURNISHINGS.map(def => def.tile);
unique(ids, 'furnishing ids');
unique(keys, 'furnishing resource keys');
unique(tiles, 'furnishing tile ids');
assert.ok(ids.every(id => typeof id === 'string' && id.length > 0), 'every furnishing has a stable id');
assert.ok(keys.every(key => typeof key === 'string' && key.length > 0), 'every furnishing has a stable resource key');
assert.deepEqual(
  tiles.slice().sort((a, b) => a - b),
  Array.from({ length: 32 }, (_, i) => 96 + i),
  'furnishing tiles occupy the append-only 96..127 save range'
);
assert.ok(tiles.every(tile => Number.isInteger(tile) && tile >= 96 && tile <= 127 && tile < 256),
  'every furnishing tile fits the Uint8 world/save format');

const categorySet = new Set();
const visualSet = new Set();
const soundSet = new Set();
for (const def of FURNISHINGS) {
  assert.ok(def && typeof def === 'object', 'catalogue rows are objects');
  assert.ok(typeof def.tileName === 'string' && def.tileName, def.id + ' has a tile constant name');
  assert.equal(T[def.tileName], def.tile, def.id + ' tileName resolves through T');

  const info = INFO[def.tile];
  assert.ok(info, def.id + ' has INFO metadata');
  assert.equal(info.furniture, true, def.id + ' is marked as furniture in INFO');
  assert.equal(info.drop, def.key, def.id + ' mines back into its catalogue resource');
  assert.equal(info.furnitureCategory, def.category, def.id + ' category matches INFO');
  assert.ok(Number.isFinite(def.homeRegenBonus) && def.homeRegenBonus > 0,
    def.id + ' contributes a positive home regeneration bonus');
  assert.equal(info.homeRegenBonus, def.homeRegenBonus, def.id + ' regeneration bonus matches INFO');
  assert.equal(info.color, def.color, def.id + ' color matches INFO');
  assert.equal(info.hp, def.hp, def.id + ' durability matches INFO');
  assert.equal(def.placeableInHome, true, def.id + ' is explicitly placeable in a home');

  assert.ok(typeof def.category === 'string' && def.category, def.id + ' has a category');
  assert.equal(def.group, def.category, def.id + ' belongs to its furnishing category');
  assert.ok(typeof def.visual === 'string' && def.visual, def.id + ' selects a visual renderer');
  assert.ok(typeof def.effect === 'string' && def.effect, def.id + ' selects an effect renderer');
  assert.ok(def.sound === null || Object.hasOwn(FURNISHING_SOUND_PROFILES, def.sound),
    def.id + ' either stays silent or uses a registered home sound profile');
  if(def.sound) soundSet.add(def.sound);
  assert.ok(def.cost && typeof def.cost === 'object' && !Array.isArray(def.cost), def.id + ' has a cost object');
  const costEntries = Object.entries(def.cost);
  assert.ok(costEntries.length > 0, def.id + ' has at least one crafting ingredient');
  for (const [ingredient, amount] of costEntries) {
    assert.ok(typeof ingredient === 'string' && ingredient, def.id + ' has a valid ingredient key');
    assert.ok(Number.isInteger(amount) && amount > 0, def.id + ' ingredient amounts are positive integers');
  }
  categorySet.add(def.category);
  visualSet.add(def.visual);
}
assert.deepEqual([...categorySet].sort(), ['decor', 'electronics', 'furniture', 'wonders'],
  'catalogue exposes the four intended furnishing categories');
assert.equal(visualSet.size, FURNISHINGS.length, 'every furnishing has its own visual style');
assert.deepEqual([...soundSet].sort(), Object.keys(FURNISHING_SOUND_PROFILES).sort(),
  'audible furnishings exercise every restrained home sound family');
assert.ok(FURNISHINGS.filter(def => def.sound).length >= 16,
  'the devices and advanced wonders have a substantial positional soundscape');
for(const quiet of ['RUSTIC_STOOL','PINE_TABLE','WOVEN_RUG','POTTED_FERN']){
  assert.equal(FURNISHINGS.find(def => def.tileName === quiet).sound, null, quiet + ' remains appropriately silent');
}

assert.ok(FURNISHING_BY_TILE instanceof Map, 'numeric tile lookup is a Map');
assert.ok(FURNISHING_BY_KEY instanceof Map, 'resource-key lookup is a Map');
assert.equal(FURNISHING_BY_TILE.size, FURNISHINGS.length, 'tile lookup covers the full catalogue');
assert.equal(FURNISHING_BY_KEY.size, FURNISHINGS.length, 'key lookup covers the full catalogue');
for (const def of FURNISHINGS) {
  assert.equal(FURNISHING_BY_TILE.get(def.tile), def, def.id + ' is indexed by tile');
  assert.equal(FURNISHING_BY_KEY.get(def.key), def, def.id + ' is indexed by resource key');
  assert.equal(getByTile(def.tile), def, def.id + ' getByTile resolves the canonical row');
  assert.equal(getByKey(def.key), def, def.id + ' getByKey resolves the canonical row');
  assert.equal(getFurnishing(def.tile), def, def.id + ' generic lookup accepts a tile');
  assert.equal(getFurnishing(def.key), def, def.id + ' generic lookup accepts a key');
  assert.equal(getFurnishing(def), def, def.id + ' generic lookup accepts a definition');
  assert.equal(isFurnishingTile(def.tile), true, def.id + ' is recognized as a furnishing tile');
}
assert.equal(getByTile(T.AIR), null, 'ordinary terrain is absent from the furnishing lookup');
assert.equal(getByKey('missing_furnishing'), null, 'unknown furnishing keys fail closed');
assert.equal(getFurnishing(null), null, 'generic lookup rejects missing values');
assert.equal(isFurnishingTile(T.AIR), false, 'air is not a furnishing tile');
assert.equal(isFurnishingTile(T.BEDROCK_LADDER), false, 'pre-catalogue tiles are not furnishings');

assert.equal(FURNISHING_FRONTIER_DISTANCE,15000,'the furnishing frontier caps at 15,000 blocks');
assert.deepEqual(FURNISHING_DISTANCE_BANDS.map(b=>[b.minDistance,b.tier]),[[0,1],[2500,2],[7500,3],[12500,4]],
  'distance bands advance from homestead craft to frontier wonders');
for(const x of [0,2499,2500,7499,7500,12499,12500,15000,40000]){
  assert.equal(furnishingTierAtDistance(x),furnishingTierAtDistance(-x),'east/west progression is symmetric at '+x);
}
assert.equal(furnishingTierAtDistance(2499),1,'near homes stay simple');
assert.equal(furnishingTierAtDistance(2500),2,'the expedition furnishing band starts at 2,500');
assert.equal(furnishingTierAtDistance(7500),3,'advanced electronics begin at 7,500');
assert.equal(furnishingTierAtDistance(12500),4,'frontier wonders begin before the 15,000-block cap');
const nearSelection=selectFurnishingsForDistance(200,1234,3);
const farSelection=selectFurnishingsForDistance(-15000,1234,3);
assert.ok(nearSelection.length===3 && nearSelection.every(def=>def.tier===1),'near selection contains only simple furnishings');
assert.ok(farSelection.some(def=>def.tier===4) && farSelection.every(def=>def.tier>=3 && def.tier<=4),
  'far selection guarantees a frontier wonder with only advanced support pieces');
assert.deepEqual(selectFurnishingsForDistance(-15000,1234,3),farSelection,'distance selection is deterministic');
const farTrader=furnishingTraderOffersForDistance(15000,77,2);
assert.equal(farTrader.length,2,'the Ir trader showcases two furnishings per visit');
assert.ok(farTrader.some(offer=>offer.furnishingTier===4),'a frontier trader stocks a tier-four wonder');
assert.ok(farTrader.every(offer=>offer.cost.iridium>=4 && offer.give[offer.furnishingKey]===1),
  'advanced trader furnishings cost iridium and grant a placeable item');
assert.deepEqual(FURNISHING_CHEST_CHANCES,{epic:.10,legendary:.26},'only best chests carry restrained furnishing odds');
const sequence=values=>{ let i=0; return ()=>values[Math.min(i++,values.length-1)]; };
assert.equal(rollChestFurnishing('rare',()=>0),null,'rare and lower chests never bypass exploration');
assert.equal(rollChestFurnishing('epic',()=>.99),null,'an epic chest can miss its furnishing roll');
assert.equal(rollChestFurnishing('epic',sequence([0,0,0])).tier,3,'a successful epic chest can reveal tier-three equipment');
assert.equal(rollChestFurnishing('legendary',sequence([0,0,0])).tier,4,'a successful legendary chest can reveal a frontier wonder');

assert.ok(furnishingsApi && typeof furnishingsApi === 'object', 'default furnishings API is exported');
assert.equal(furnishingsApi.FURNISHINGS || furnishingsApi.definitions, FURNISHINGS,
  'default API exposes the canonical catalogue');
assert.equal(furnishingsApi.resources, FURNISHING_RESOURCES, 'default API exposes resource definitions');
assert.equal(furnishingsApi.byTile, FURNISHING_BY_TILE, 'default API exposes tile lookup');
assert.equal(furnishingsApi.byKey, FURNISHING_BY_KEY, 'default API exposes key lookup');
assert.equal(furnishingsApi.isFurnishingTile, isFurnishingTile, 'default API exposes the furnishing predicate');
assert.equal(furnishingsApi.findNearestRadio, findNearestRadio, 'default API exposes radio interaction lookup');

assert.ok(Array.isArray(FURNISHING_RESOURCES), 'furnishings exports inventory resource definitions');
assert.equal(FURNISHING_RESOURCES.length, FURNISHINGS.length, 'every furnishing has one resource definition');
unique(FURNISHING_RESOURCES.map(resource => resource.key), 'furnishing resource exports');
const resourcesByKey = new Map(FURNISHING_RESOURCES.map(resource => [resource.key, resource]));
for (const def of FURNISHINGS) {
  const resource = resourcesByKey.get(def.key);
  assert.ok(resource, def.id + ' has an inventory resource');
  assert.equal(resource.label, def.label, def.id + ' resource label matches');
  assert.equal(resource.color, def.color, def.id + ' resource color matches');
  assert.equal(resource.tile, def.tileName, def.id + ' resource points at its T constant');
  assert.equal(resource.furniture, true, def.id + ' resource advertises furniture semantics');
  assert.equal(resource.placeableInHome, true, def.id + ' resource advertises home placement');
  assert.equal(resource.furnitureCategory, def.category, def.id + ' resource category matches');
  assert.equal(resource.homeRegenBonus, def.homeRegenBonus, def.id + ' resource bonus matches');
  assert.equal(resource.ambientSound, def.sound, def.id + ' resource sound metadata matches');
  assert.equal(resource.tier, def.tier, def.id + ' resource tier matches');
  assert.equal(resource.description, def.description, def.id + ' resource description matches');
}

// Recipes use the same plain inventory object as main.js. Effects are deliberately
// limited to granting the crafted placeable; main.js owns ingredient subtraction.
const craftedInventory = Object.create(null);
const notices = [];
const recipes = createRecipes({
  inventory: craftedInventory,
  notify: message => notices.push(String(message))
});
assert.ok(Array.isArray(recipes), 'createRecipes returns recipe definitions');
assert.equal(recipes.length, FURNISHINGS.length, 'every furnishing has one recipe');
unique(recipes.map(recipe => recipe.id), 'furnishing recipe ids');
unique(recipes.map(recipe => recipe.out), 'furnishing recipe outputs');
const recipesByOut = new Map(recipes.map(recipe => [recipe.out, recipe]));
for (const def of FURNISHINGS) {
  const recipe = recipesByOut.get(def.key);
  assert.ok(recipe, def.id + ' has a crafting recipe');
  assert.equal(recipe.id, 'furnishing_' + def.key, def.id + ' recipe id is stable');
  assert.equal(recipe.out, def.key, def.id + ' recipe outputs its placeable resource');
  assert.equal(recipe.amount, 1, def.id + ' recipe creates one furnishing');
  assert.deepEqual(recipe.cost, def.cost, def.id + ' recipe cost matches the catalogue');
  assert.equal(recipe.group, def.category, def.id + ' recipe belongs to its furnishing category');
  assert.equal(recipe.category, def.category, def.id + ' recipe category matches');
  assert.equal(recipe.tile, def.tile, def.id + ' recipe carries the numeric tile');
  assert.equal(recipe.tileName, def.tileName, def.id + ' recipe carries the tile constant name');
  assert.equal(recipe.placeableInHome, true, def.id + ' recipe advertises home placement');
  assert.equal(recipe.homeRegenBonus, def.homeRegenBonus, def.id + ' recipe displays the correct home bonus');
  assert.equal(recipe.ambientSound, def.sound, def.id + ' recipe sound metadata matches');
  assert.equal(typeof recipe.make, 'function', def.id + ' recipe has a make effect');
  const before = craftedInventory[def.key] || 0;
  assert.notEqual(recipe.make(), false, def.id + ' recipe make succeeds with a plain inventory object');
  assert.equal(craftedInventory[def.key], before + 1, def.id + ' recipe grants exactly one resource');
}
assert.equal(notices.length, FURNISHINGS.length, 'successful furnishing crafts notify once each');

// Base resources come from the shipped inventory registry. Furnishings may also
// depend on an earlier furnishing, so catalogue keys are a second valid source.
await import('../src/inventory.js');
const inventoryResources = globalThis.MM && globalThis.MM.inventory && globalThis.MM.inventory.RESOURCES;
assert.ok(Array.isArray(inventoryResources), 'base inventory resource registry is available');
const catalogueKeys = new Set(keys);
const baseResourceKeys = new Set(
  inventoryResources
    .filter(resource => resource && !catalogueKeys.has(resource.key))
    .map(resource => resource.key)
);
const knownIngredients = new Set([...baseResourceKeys, ...catalogueKeys]);
for (const recipe of recipes) {
  for (const ingredient of Object.keys(recipe.cost || {})) {
    assert.ok(knownIngredients.has(ingredient), recipe.id + ' uses known ingredient "' + ingredient + '"');
  }
}

// Canvas proxy: every drawing method is a harmless no-op, gradients and text
// metrics return the tiny interfaces procedural renderers expect.
function mockContext() {
  let drawCalls = 0;
  const gradient = { addColorStop() { drawCalls++; } };
  const target = {
    canvas: { width: 96, height: 96 },
    measureText(text) { drawCalls++; return { width: String(text).length * 6 }; },
    createLinearGradient() { drawCalls++; return gradient; },
    createRadialGradient() { drawCalls++; return gradient; },
    createPattern() { drawCalls++; return {}; },
    _drawCalls() { return drawCalls; }
  };
  return new Proxy(target, {
    get(object, prop) {
      if (prop in object) return object[prop];
      return (..._args) => { drawCalls++; };
    },
    set(object, prop, value) {
      object[prop] = value;
      return true;
    }
  });
}

assert.equal(typeof drawTile, 'function', 'furnishings exports the world/icon tile renderer');
assert.equal(typeof drawPreview, 'function', 'furnishings exports the preview renderer');
assert.equal(typeof drawEffects, 'function', 'furnishings exports the dynamic effects pass');
assert.equal(furnishings, furnishingsApi, 'named and default furnishings APIs stay in sync');
for (const def of FURNISHINGS) {
  const tileCtx = mockContext();
  assert.notEqual(drawTile(tileCtx, def.tile, 0, 0, 11, 17), false,
    def.id + ' visual is handled by drawTile');
  assert.ok(tileCtx._drawCalls() > 0, def.id + ' visual emits canvas drawing commands');

  const previewCtx = mockContext();
  const previewCanvas = { width: 80, height: 80, getContext: () => previewCtx };
  assert.notEqual(drawPreview(previewCanvas, def, { time: 1234 }), false,
    def.id + ' visual is handled by drawPreview');
  assert.ok(previewCtx._drawCalls() > 0, def.id + ' preview emits canvas drawing commands');

  const effectsCtx = mockContext();
  assert.doesNotThrow(
    () => drawEffects(effectsCtx, 20, 0, 0, 1, 1, () => def.tile, () => true),
    def.id + ' effect is handled by the dynamic effects pass'
  );
}
assert.equal(drawTile(mockContext(), T.AIR, 0, 0, 0, 0), false, 'drawTile rejects non-furnishing tiles');

const radioDef=FURNISHINGS.find(def=>def.tile===T.RADIO);
assert.ok(radioDef && /sześcioma proceduralnymi stacjami/.test(radioDef.description),'radio recipe explains its multi-genre station feature');
assert.equal(radioDef.sound,null,'radio delegates music to the dedicated station scheduler instead of random ambience');
{
  const map=new Map([['5,5',T.RADIO],['2,5',T.RADIO]]);
  const nearest=findNearestRadio({x:3,y:5},(x,y)=>map.get(x+','+y)||T.AIR,4);
  assert.deepEqual({x:nearest.x,y:nearest.y},{x:2,y:5},'interaction lookup selects the nearest placed radio');
  assert.equal(findNearestRadio({x:30,y:30},(x,y)=>map.get(x+','+y)||T.AIR,3),null,'radio interaction stays reach-bound');
  assert.doesNotThrow(()=>findNearestRadio({x:0,y:0},()=>{ throw new Error('bad tile'); },99),'radio lookup bounds range and contains provider errors');
}
{
  const mainSource=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  const htmlSource=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(mainSource,/nearestInteractiveRadio\(3\)/,'E interaction resolves a nearby placed radio');
  assert.match(mainSource,/getTile\(tx,ty\)===T\.RADIO && openRadioPanel/,'clicking a placed radio opens its selector');
  assert.match(mainSource,/MM\.noteCraftResultSeen=noteCraftResultSeen/,'world, trader and chest sightings share one recipe-unlock bridge');
  assert.match(mainSource,/if\(o\.furnishingKey\) noteCraftResultSeen\(o\.furnishingKey,\{source:'trader'\}\)/,
    'viewing a furnishing at the Ir trader permanently reveals its recipe');
  assert.match(mainSource,/aria-modal/,'radio selector participates in the modal-input contract');
  assert.match(htmlSource,/\.radioStationCard\[data-active="true"\]/,'radio selector has a distinct active-station treatment');
  assert.match(htmlSource,/prefers-reduced-motion:reduce[^}]*radioPanel/,'radio animation honors reduced-motion preferences');
}

// Dynamic-art scans are cached briefly. A stable camera should validate only
// the handful of cached effect cells instead of rereading the whole viewport
// on every animation frame; moving time past the TTL rebuilds safely.
resetRuntimeCaches();
let tileReads = 0;
const effectTiles = new Map([['3,3', T.MINIATURE_SUN], ['44,18', T.AQUARIUM]]);
const stableTiles = (x,y) => { tileReads++; return effectTiles.get(x+','+y) || T.AIR; };
assert.equal(drawEffects(mockContext(),20,0,0,80,40,stableTiles,()=>true),true,'cached effects find animated furnishings');
const readsAfterFirst = tileReads;
const metricsAfterFirst = runtimeMetrics();
assert.equal(metricsAfterFirst.effects.scans,1,'first effects pass scans the viewport once');
assert.equal(metricsAfterFirst.effects.cached,2,'only animated furnishing cells enter the cache');
assert.equal(drawEffects(mockContext(),20,0,0,80,40,stableTiles,()=>true),true,'cached effects remain drawable');
assert.ok(tileReads-readsAfterFirst <= 2,'cache hit validates only known effect cells');
assert.equal(runtimeMetrics().effects.hits,1,'second stable effects pass records a cache hit');
testNow += 241;
drawEffects(mockContext(),20,0,0,80,40,stableTiles,()=>true);
assert.equal(runtimeMetrics().effects.scans,2,'expired effects cache is rebuilt');
assert.doesNotThrow(()=>drawEffects(mockContext(),Infinity,0,0,Infinity,Infinity,()=>{ throw new Error('hostile provider'); }),
  'effects pass bounds hostile dimensions and contains provider failures');

// The home audio director scans on a low cadence, collapses duplicate devices
// to the nearest sound family, spaces first playback and caps simultaneous cues.
resetRuntimeCaches();
const audioTiles = new Map([
  ['1,1',T.WALL_CLOCK], ['2,1',T.CHRONO_CLOCK],
  ['3,1',T.AQUARIUM], ['5,1',T.RADIO], ['6,1',T.TELEVISION], ['7,1',T.MEDICAL_STATION]
]);
const audioCalls=[];
const radioSourceCalls=[];
const fakeAudio={isReady:()=>true,isMuted:()=>false,
  play:(name,opts)=>audioCalls.push({name,opts,clock:runtimeMetrics().audio.scans}),
  setRadioSource:(x,y)=>radioSourceCalls.push({x,y}),clearRadioSource:()=>radioSourceCalls.push(null)};
for(let i=0;i<36;i++) updateAudio(.6,{x:4,y:2},(x,y)=>audioTiles.get(x+','+y)||T.AIR,fakeAudio);
for(const name of ['homeTick','homeWater','homeRadio','homeMedical']){
  assert.ok(audioCalls.some(call=>call.name===name),name + ' eventually plays near its device');
}
assert.ok(audioCalls.every(call=>Number.isFinite(call.opts.x) && Number.isFinite(call.opts.y) && call.opts.bus==='ambience'),
  'home cues carry finite positional coordinates on the ambience bus');
assert.ok(audioCalls.every((call,index,array)=>array.filter(other=>other.clock===call.clock).length<=2),
  'no audio scan starts more than two furnishing cues');
assert.ok(runtimeMetrics().audio.candidates<=4,'duplicate clocks collapse to one nearest sound-family candidate');
assert.ok(radioSourceCalls.some(source=>source && source.x===5.5 && source.y===1.5),'audio scan publishes the placed radio as a positional music source');

resetRuntimeCaches();
let mutedReads=0;
updateAudio(1,{x:0,y:0},()=>{ mutedReads++; return T.RADIO; },{isReady:()=>true,isMuted:()=>true,play:()=>{}});
assert.equal(mutedReads,0,'muted audio skips the world scan entirely');
assert.doesNotThrow(()=>updateAudio(1,{x:0,y:0},()=>{ throw new Error('bad tile'); },{isReady:()=>true,isMuted:()=>false,play:()=>{}}),
  'audio director contains hostile tile-provider failures');
assert.ok(runtimeMetrics().audio.errors>0,'contained audio provider failures remain observable in diagnostics');

console.log('furnishings-sim: all assertions passed (catalogue, art cache, positional audio, hardening)');
