// Pins the cape fabric taxonomy: the ten archetype ids, the resolution order
// (explicit field > builtin id > name keywords > desc keywords > tier default)
// and the FULL item→fabric mapping for every named cape in the game. This
// table IS the contract — a new cape name that lands on the wrong fabric is a
// content bug caught here, not in play.
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};

const { capeFabrics: FAB } = await import('../src/engine/cape_fabrics.js');

// --- archetype roster (mirrored in inventory.js CAPE_FABRIC_IDS and
// drops.js ITEM_CAPE_FABRICS — the three lists must never drift) -------------
assert.deepEqual(FAB.FABRIC_IDS.slice().sort(),
  ['cloth','ember','feather','frost','fur','gilded','leather','scale','silk','spectral'],
  'fabric archetype roster');
const fs=await import('node:fs');
const invSrc=fs.readFileSync(new URL('../src/inventory.js', import.meta.url),'utf8');
const dropsSrc=fs.readFileSync(new URL('../src/engine/drops.js', import.meta.url),'utf8');
// Compare the Set CONTENTS, never a whole-file substring scan: 'cloth' and
// 'frost' each occur elsewhere in inventory.js (the capeFabric fallback and
// the mergePerk chip), so includes() would report those as present forever.
// Both mirrors must equal FABRIC_IDS exactly — an extra id leaks an unpainted
// fabric to the renderer, a missing one strips the field on ingest.
const setIds=(src,name)=>{
  const m=new RegExp(name+'\\s*=\\s*new Set\\(\\[([^\\]]*)\\]\\)').exec(src);
  assert.ok(m, name+' is a one-line Set literal');
  return m[1].split(',').map(s=>s.trim().replace(/^'|'$/g,'')).filter(Boolean).sort();
};
const ROSTER=FAB.FABRIC_IDS.slice().sort();
assert.deepEqual(setIds(invSrc,'CAPE_FABRIC_IDS'), ROSTER,
  'inventory.js CAPE_FABRIC_IDS mirrors cape_fabrics.js FABRIC_IDS exactly');
assert.deepEqual(setIds(dropsSrc,'ITEM_CAPE_FABRICS'), ROSTER,
  'drops.js ITEM_CAPE_FABRICS mirrors cape_fabrics.js FABRIC_IDS exactly');
assert.match(invSrc, /ITEM_STR_FIELDS=\[[^\]]*'fabric'/, "inventory.js persists the cape's fabric field");
assert.match(dropsSrc, /ITEM_STR_FIELDS=\[[^\]]*'fabric'/, 'drops.js persists the cape fabric field');

// every fabric carries a full physics + paint profile
for(const id of FAB.FABRIC_IDS){
  const f=FAB.get(id);
  for(const k of ['lengthTiles','massMul','drag','damp','bendLimit','straighten','flutter','windMul'])
    assert.ok(Number.isFinite(f[k]), id+' has numeric '+k);
  assert.ok(f.lengthTiles>0.5 && f.lengthTiles<=1.25, id+' length stays inside the hero-backdrop erase pad');
  assert.ok(typeof f.edge==='string', id+' names an edge silhouette');
}

// --- resolution order --------------------------------------------------------
assert.equal(FAB.resolve(null).fabric, 'cloth', 'null item defaults to cloth');
assert.equal(FAB.resolve({fabric:'ember', kind:'cape'}).fabric, 'ember', 'explicit fabric field wins');
// precedence needs a COMPETING signal on the same item, or the pin is vacuous
assert.equal(FAB.resolve({fabric:'silk', name:'Peleryna yeti', tier:'legendary'}).fabric, 'silk',
  "an explicit fabric outranks the item's own name keyword and tier");
assert.equal(FAB.resolve({id:'shadow', name:'Peleryna yeti'}).fabric, 'spectral',
  'a builtin style id outranks a name keyword');
assert.equal(FAB.resolve({fabric:'nonsense', name:'Peleryna yeti'}).fabric, 'fur', 'unknown fabric field falls through to keywords');
assert.equal(FAB.resolve('royal').fabric, 'silk', 'bare style id resolves through the builtin map');
// keyword-free NAME so the desc rung is genuinely the path taken
assert.equal(FAB.resolve({id:'cape_a3f9k', name:'Dar', desc:'Wulkan przyjął ofiarę. Wypluł resztę.'}).fabric, 'ember',
  'desc keywords catch what the name misses');
assert.equal(FAB.resolve({name:'Peleryna zamieci', desc:'Powiewa nawet bez wiatru.'}).fabric, 'frost',
  'name outranks desc — a blizzard cape is frost, not the wind in its flavour text');
assert.equal(FAB.resolve({name:'Łuska zorzy', desc:'Mieni się wszystkimi kolorami mrozu.'}).fabric, 'scale',
  'name outranks desc — aurora scale is not the frost in its flavour text');
assert.equal(FAB.resolve({id:'cape_x', name:'Bez słów kluczowych', tier:'legendary'}).fabric, 'gilded', 'legendary tier default');
assert.ok(FAB.resolve({id:'cape_x', name:'Bez słów kluczowych', tier:'legendary'}).irid, 'legendary default is iridescent');
assert.equal(FAB.resolve({id:'cape_x', name:'Bez słów kluczowych', tier:'epic'}).fabric, 'scale', 'epic tier default');
assert.equal(FAB.resolve({id:'cape_x', name:'Bez słów kluczowych', tier:'rare'}).fabric, 'silk', 'rare tier default');
assert.equal(FAB.resolve({id:'cape_x', name:'Bez słów kluczowych', tier:'common'}).fabric, 'cloth', 'common tier default');

// diacritic folding
assert.equal(FAB.foldDiacritics('Łuska żółci ćma pióro śnieg'), 'luska zolci cma pioro snieg', 'Polish diacritics fold to ascii');

// --- the full mapping table --------------------------------------------------
const TABLE=[
  // builtins
  [{id:'classic'},  'cloth',   false],
  [{id:'triangle'}, 'cloth',   false],
  [{id:'royal'},    'silk',    false],
  [{id:'tattered'}, 'cloth',   false],
  [{id:'winged'},   'feather', false],
  [{id:'shadow'},   'spectral',false],
  // GEAR_LOOT mob drops
  [{name:'Peleryna z piór'},            'feather', false],
  [{name:'Peleryna nietoperza'},        'leather', false],
  [{name:'Peleryna sępia'},             'feather', false],
  [{name:'Puchowa pelerynka'},          'feather', false],
  [{name:'Peleryna zamieci'},           'frost',   false],
  [{name:'Peleryna yeti'},              'fur',     false],
  [{name:'Peleryna złotego smoka'},     'scale',   false],
  [{name:'Peleryna obłocznej płaszczki'},'leather', false],
  [{name:'Peleryna harpii'},            'feather', false],
  [{name:'Peleryna Serafina Wyżyn'},    'gilded',  false],
  [{name:'Czasza tyrana gaju'},         'silk',    false],
  [{name:'Łuska zorzy'},                'scale',   true ],
  [{name:'Skrzydła Królowej Harpii'},   'feather', false],
  [{name:'Pióropusz żaru'},             'ember',   false],
  // guardian relics
  [{name:'Peleryna słonecznego żmija'}, 'scale',   false],
  [{name:'Peleryna Astraela'},          'silk',    false],
  // crafted + volcano
  [{name:'Plaszcz zimowego futra'},     'fur',     false],
  [{name:'Dar wulkanu', desc:'Wulkan przyjął ofiarę. Wypluł resztę.'}, 'ember', false],
  // procedural chest suffixes (chests.js NAME_SUFFIXES)
  [{name:'Peleryna wiatru'},   'silk',     false],
  [{name:'Peleryna cienia'},   'spectral', false],
  [{name:'Peleryna głębin'},   'scale',    false],
  [{name:'Peleryna świtu'},    'silk',     false],
  [{name:'Peleryna gór', tier:'common'},   'cloth', false],
  [{name:'Peleryna burzy'},    'silk',     false],
  [{name:'Peleryna lasu', tier:'uncommon'},'cloth', false],
  [{name:'Peleryna żaru'},     'ember',    false],
  [{name:'Peleryna echa'},     'spectral', false],
  [{name:'Peleryna mrozu'},    'frost',    false],
  [{name:'Peleryna otchłani'}, 'spectral', false],
  [{name:'Peleryna słońca'},   'gilded',   false]
];
for(const [item, fabric, irid] of TABLE){
  const r=FAB.resolve(Object.assign({kind:'cape'}, item));
  const label=item.id||item.name;
  assert.equal(r.fabric, fabric, label+' → '+fabric+' (got '+r.fabric+')');
  assert.equal(!!r.irid, irid, label+' iridescence');
}

// order traps that carried real decisions
assert.equal(FAB.resolve({name:'Peleryna zimowego futra i mrozu'}).fabric, 'fur',
  'fur outranks frost — winter fur is warm, not icy');
assert.equal(FAB.resolve({name:'Pióropusz żaru'}).fabric, 'ember',
  'ember outranks feather — a burning plume burns first');
assert.equal(FAB.resolve({name:'Łuska zorzy'}).irid, true,
  'aurora is iridescent before it is scale');

console.log('cape-fabrics-sim: all assertions passed');
