// Hotbar picker model regressions (engine/hot_picker.js): diacritics-folded
// search with ranked results, category sections, persisted recents, dynamic
// (god-gated) catalogs — plus source pins that keep the main.js/index.html
// wiring honest: every inventory resource tile is consciously grouped and the
// popover shell keeps the ids/width the module renders into.
// Run: node tools/hot-picker-sim.test.mjs
import { strict as assert } from 'assert';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.CustomEvent = class { constructor(type,opts){ this.type=type; this.detail=opts&&opts.detail; } };
globalThis.dispatchEvent = () => true;

const { foldText, createHotPickerModel } = await import('../src/engine/hot_picker.js');

// --- diacritics folding -----------------------------------------------------
assert.equal(foldText('Śnieg'), 'snieg', 'folds Ś');
assert.equal(foldText('ŻÓŁĆ gęślą jaźń'), 'zolc gesla jazn', 'folds the whole Polish set');
assert.equal(foldText(''), '', 'empty stays empty');

// --- ranked search over a synthetic catalog ----------------------------------
const GROUPS=[
  {id:'basic', label:'Podstawowe', tiles:['SNOW','WATER','SAND']},
  {id:'rock',  label:'Skały',      tiles:['STONE','TOXIC_SNOW']},
  {id:'other', label:'Inne',       tiles:[]}
];
let extra=[];
const CATALOG=()=>[
  {k:'SNOW',       label:'Śnieg',           resKey:'snow'},
  {k:'WATER',      label:'Woda',            resKey:'water'},
  {k:'SAND',       label:'Piasek',          resKey:'sand'},
  {k:'STONE',      label:'Skała',           resKey:'stone'},
  {k:'TOXIC_SNOW', label:'Toksyczny śnieg', resKey:'toxicSnow'},
  ...extra
];
const store=new Map();
const storage={ getItem:k=>store.has(k)?store.get(k):null, setItem:(k,v)=>store.set(k,String(v)) };
const model=createHotPickerModel({groups:GROUPS, catalog:CATALOG, storage, storageKey:'test_recent'});

let hits=model.search('snieg');
assert.equal(hits[0].k, 'SNOW', 'label prefix outranks word-start ("Śnieg" before "Toksyczny śnieg")');
assert.equal(hits[1].k, 'TOXIC_SNOW', 'word-start match still found');
assert.equal(hits.length, 2, 'unrelated items filtered out');
assert.equal(model.search('SNIEG')[0].k, 'SNOW', 'query folding is case-insensitive');
assert.equal(model.search('toxicsnow')[0].k, 'TOXIC_SNOW', 'internal resKey matches too');
assert.equal(model.search('xyz').length, 0, 'nonsense finds nothing');
assert.equal(model.search('').length, CATALOG().length, 'empty query returns the whole catalog');

// --- sections: group order, filtering, results view ---------------------------
let secs=model.sections('', 'all');
assert.deepEqual(secs.map(s=>s.id), ['basic','rock'], 'no recents yet: groups in declared order, empty groups dropped');
assert.deepEqual(secs[0].items.map(i=>i.k), ['SNOW','WATER','SAND'], 'items keep catalog order inside a group');
secs=model.sections('', 'rock');
assert.deepEqual(secs.map(s=>s.id), ['rock'], 'group filter narrows to one section');
secs=model.sections('snieg', 'rock');
assert.equal(secs[0].id, 'results', 'query beats the group filter');
assert.equal(secs[0].items.length, 2, 'results section carries the ranked hits');
assert.equal(model.sections('xyz','all').length, 0, 'no hits -> no sections');

// --- recents: persisted, deduped, capped, unknown keys skipped ----------------
model.noteUse('WATER');
model.noteUse('SNOW');
model.noteUse('WATER'); // re-use moves to front, no duplicate
secs=model.sections('', 'all');
assert.equal(secs[0].id, 'recent', 'recents section appears first');
assert.deepEqual(secs[0].items.map(i=>i.k), ['WATER','SNOW'], 'most recent first, deduped');
assert.ok(store.get('test_recent').includes('WATER'), 'recents persist to storage');
for(let i=0;i<12;i++) model.noteUse('K'+i);
assert.equal(model.recents().length, 8, 'recents capped at 8');
secs=model.sections('', 'all');
assert.ok(!secs.length || secs[0].id!=='recent' || secs[0].items.every(i=>CATALOG().some(c=>c.k===i.k)),
  'recents render only keys still present in the catalog');
const model2=createHotPickerModel({groups:GROUPS, catalog:CATALOG, storage, storageKey:'test_recent'});
assert.deepEqual(model2.recents(), model.recents(), 'recents survive a model reload (same storage)');
assert.equal(model2.sections('','rock').some(s=>s.id==='recent'), false, 'group filter hides the recents row');

// --- dynamic catalog (god mode flips chest entries in) -------------------------
extra=[{k:'CHEST_EPIC', label:'Skrzynia epicka', chest:true}];
assert.equal(model.search('skrzynia').length, 1, 'catalog is re-read per query (god chests appear)');
assert.equal(model.groupOf('CHEST_EPIC'), 'other', 'ungrouped keys fall into the other bucket');
extra=[];

// --- source pins: main.js wiring + index.html shell ---------------------------
const mainSrc=readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
assert.match(mainSrc, /import \{ createHotPickerModel, createHotPicker \} from '\.\/engine\/hot_picker\.js'/, 'main.js imports the picker module');
assert.match(mainSrc, /MM\.groupedHotSelect=HOTPICKER\.open/, 'slot clicks open the module picker');
assert.match(mainSrc, /document\.addEventListener\('pointerdown',e=>\{ if\(hotSelectMenu[\s\S]{0,220}closeHotSelect/,
  'popover dismissal listens on POINTERDOWN — a click dismisser fires after chip re-renders detach the target and closes the menu on every chip press');
assert.match(mainSrc, /assign\(slot,item\)\{ HOTBAR_ORDER\[slot\]=item\.k; cycleHotbar\(slot\);/, 'picker assignment goes through HOTBAR_ORDER + cycleHotbar');
assert.match(mainSrc, /drawEntityTile && MM\.drawEntityTile\(g,id,0,0,7,11\)/, 'icons paint the REAL tile art with stable pseudo-coords');

// every resource tile must be consciously placed in a picker group — new
// resources landing silently in "Inne" is a UX bug, not a feature
const groupsBlock=mainSrc.slice(mainSrc.indexOf('const HOT_SELECT_GROUPS=['), mainSrc.indexOf('function hotSelectCatalog('));
const groupedTiles=new Set();
for(const m of groupsBlock.matchAll(/'([A-Z0-9_]+)'/g)) groupedTiles.add(m[1]);
globalThis.localStorage={ getItem:()=>null, setItem(){}, removeItem(){} };
const { inventory: INV } = await import('../src/inventory.js');
const tiles=INV.RESOURCES.filter(r=>r.tile).map(r=>r.tile);
assert.ok(tiles.length>=40, 'sanity: resource registry scanned ('+tiles.length+' placeable tiles)');
for(const t of tiles) assert.ok(groupedTiles.has(t), 'resource tile '+t+' is assigned to a HOT_SELECT_GROUPS category');

const indexHtml=readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(indexHtml, /id="hotSelectTitle"/, 'shell exposes the per-slot title node');
assert.match(indexHtml, /id="hotSelectFoot"/, 'shell exposes the footer hint node');
assert.match(indexHtml, /id="hotSelectMenu"[^>]*width:min\(520px,calc\(100vw - 16px\)\)/, 'popover shell is grid-wide');

console.log('hot-picker-sim: all assertions passed');
