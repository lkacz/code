// Developer armoury regressions (engine/gear_forge.js + the #menuPanel panel).
// The forge exists so every wearable/usable thing can be produced on demand, so
// the load-bearing contract is COVERAGE plus SURVIVAL:
//   * coverage — the catalogue reaches every item kind, every hero weapon type,
//     every melee effect / merge perk / pickaxe perk / antenna active / aquatic
//     style / bouncy ammo identity. Adding a key to any of those label tables
//     breaks this suite until the forge covers it.
//   * survival — every identity field a catalogue row declares must still be
//     there after MM.inventory.grantItem ran it through sanitizeLootItem. That
//     sanitizer deletes silently: it is exactly how the tar pistol shipped with
//     a dead fireCooldown and how a minted `thrown` weapon fires nothing.
//   * the tier floor — a profile forced below the tier genItem accepts it at
//     falls THROUGH into a random roll, so buildDef raises the tier instead of
//     handing back a different item than the row promised.
//   * source pins keep the ui.js panel, its main.js wiring and the guest refusal
//     honest.
// Run: npm run test:gear-forge
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
await import('../src/constants.js');
await import('../src/inventory.js');
const INV = globalThis.MM.inventory;
const { chests } = await import('../src/engine/chests.js');
const FORGE = await import('../src/engine/gear_forge.js');

const uiSrc = readFileSync(new URL('../src/engine/ui.js', import.meta.url), 'utf8');
const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const invSrc = readFileSync(new URL('../src/inventory.js', import.meta.url), 'utf8');
const chestsSrc = readFileSync(new URL('../src/engine/chests.js', import.meta.url), 'utf8');
const weaponsSrc = readFileSync(new URL('../src/engine/weapons.js', import.meta.url), 'utf8');

function lcg(seed){ let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s >>> 8) / 0xFFFFFF; }; }

// --- module shape ------------------------------------------------------------
assert.ok(FORGE.gearForge && globalThis.MM.gearForge === FORGE.gearForge, 'gear forge exports and registers on MM');
assert.deepEqual(FORGE.TIER_ORDER, ['common','uncommon','rare','epic','legendary'], 'tier ladder matches the chest tiers');
assert.equal(FORGE.CATALOG.length, FORGE.GEN_ROWS.length + FORGE.LITERAL_ROWS.length, 'the catalogue is exactly the two row tables');
{
  const ids = FORGE.CATALOG.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length, 'catalogue row ids are unique');
  for(const e of FORGE.CATALOG) assert.ok(FORGE.catalogEntry(e.id) === e, 'every row is reachable by id: ' + e.id);
}

// --- coverage: the catalogue reaches every axis the game defines --------------
const KINDS = INV.SLOTS.map(s => s.accepts);
assert.deepEqual([...new Set(FORGE.CATALOG.map(e => e.kind))].sort(), [...KINDS].sort(),
  'the forge covers exactly the seven equippable kinds');

// `thrown` is the ONE deliberate omission: thrownKind is absent from
// ITEM_STR_FIELDS, so a minted thrown weapon loses its ammo identity and fires
// nothing. All ten throws are builtins every hero already owns.
assert.equal(invSrc.includes("'thrownKind'"), false, 'thrownKind is still not a sanitizer-allowed item field');
const HERO_WEAPON_TYPES = Object.keys(INV.WEAPON_TYPE_STATS).concat(['bouncy']);
const forgeWeaponTypes = new Set(FORGE.CATALOG.filter(e => e.kind === 'weapon').map(e => e.weaponType));
assert.deepEqual([...forgeWeaponTypes].sort(), [...new Set(HERO_WEAPON_TYPES)].filter(t => t !== 'thrown').sort(),
  'the forge covers every weapon type except the deliberately excluded `thrown`');

function literalField(field){
  return new Set(FORGE.LITERAL_ROWS.map(r => r.def[field]).filter(Boolean));
}
assert.deepEqual([...literalField('meleeEffect')].sort(), Object.keys(INV.MELEE_EFFECT_LABELS).sort(),
  'every melee material effect has a forge row (genItem never writes meleeEffect)');
assert.deepEqual([...literalField('mergePerk')].sort(), Object.keys(INV.MERGE_PERK_LABELS).sort(),
  'every merge-forge perk has a forge row');
assert.deepEqual([...literalField('bouncyKind')].sort(), Object.keys(INV.BOUNCY_KIND_LABELS).sort(),
  'both rubber ammo identities have a forge row');
{
  // AQUATIC_STYLES is not on the inventory aggregate — read it from the source.
  const m = invSrc.match(/const AQUATIC_STYLES=\{([^}]*)\}/);
  assert.ok(m, 'inventory still declares AQUATIC_STYLES');
  const styles = [...m[1].matchAll(/(\w+):'(\w+)'/g)].map(x => x[1]);
  assert.deepEqual([...literalField('aquaticStyle')].sort(), styles.sort(), 'every aquatic style has a forge row');
}
const genProfiles = kind => new Set(FORGE.GEN_ROWS.filter(r => r.kind === kind).map(r => r.profile));
assert.deepEqual([...genProfiles('pickaxe')].sort(), Object.keys(INV.PICK_PERK_LABELS).sort(),
  'every pickaxe perk has a forge row');
{
  const actives = Object.keys(INV.ANTENNA_ACTIVE_LABELS);
  const covered = genProfiles('antenna');
  for(const a of actives) assert.ok(covered.has(a), 'antenna active ' + a + ' has a forge row');
}
// A perk-LESS pickaxe cannot be rolled above common — it needs a literal row.
assert.ok(FORGE.LITERAL_ROWS.some(r => r.kind === 'pickaxe' && !r.def.pickPerk),
  'the forge can produce a pickaxe with no perk (the comparison baseline)');

// The unique marker table is a copy of the one chests.js keeps private.
{
  const m = chestsSrc.match(/const UNIQUE_NAMES=\{([^}]*)\}/);
  assert.ok(m, 'chests still declares UNIQUE_NAMES');
  const original = {};
  for(const x of m[1].matchAll(/(\w+):'([\w_]+)'/g)) original[x[1]] = x[2];
  assert.deepEqual(FORGE.UNIQUE_MARKERS, original, 'the forge mirror of UNIQUE_NAMES has not drifted');
}

// --- the sanitizer defect this wave fixed ------------------------------------
// weapons.js arms a rubber shot from `w.fireCooldown`; without a bouncy entry
// sanitize fell back to the melee list and deleted it, so BOTH pistols fired at
// the same hardcoded default.
assert.match(invSrc, /bouncy:\['attackDamage','fireCooldown'\]/, 'bouncy weapons keep their cadence through sanitize');
assert.deepEqual(INV.allowedStatsFor('weapon','bouncy'), ['attackDamage','fireCooldown'], 'bouncy allows exactly damage + cadence');
assert.match(weaponsSrc, /bouncyCd=Math\.max\(0\.16,\(w && w\.fireCooldown\)\|\|0\.28\)/, 'the shot really does read fireCooldown off the item');

// --- tier floor --------------------------------------------------------------
assert.equal(FORGE.tierAtLeast('common', 'rare'), 'rare', 'a profile below its floor raises the tier');
assert.equal(FORGE.tierAtLeast('epic', 'rare'), 'epic', 'a tier above the floor is left alone');
assert.equal(FORGE.tierAtLeast('common', null), 'common', 'rows without a floor keep the chosen tier');
for(const row of FORGE.GEN_ROWS){
  if(row.kind === 'antenna' && ['cloak','surge','echo','magnet'].includes(row.profile))
    assert.equal(row.minTier, 'uncommon', 'antenna actives declare the tier genItem starts accepting them at');
  if(row.profile === 'crush') assert.equal(row.minTier, 'rare', 'the crush profile declares its rare floor');
}

// --- survival: every declared identity field outlives sanitizeLootItem -------
const IDENTITY_FIELDS = ['weaponType','meleeEffect','aquaticStyle','antennaActive','pickPerk','mergePerk','bouncyKind','visionMode','unique'];
const rand = lcg(20260727);
let checked = 0;
for(const entry of FORGE.CATALOG){
  for(const tier of FORGE.TIER_ORDER){
    const def = FORGE.buildDef(entry.id, {tier, rand, genItem: chests.genItem, unique: tier === 'epic'});
    assert.ok(def, 'buildDef produced a definition for ' + entry.id + ' @ ' + tier);
    assert.equal(def.kind, entry.kind, entry.id + ' keeps its kind');
    assert.equal(def.tier, FORGE.tierAtLeast(tier, entry.minTier), entry.id + ' carries the raised tier');
    assert.ok(def.id.length <= 64 && def.id.startsWith('dbg_'), entry.id + ' mints a fresh, short id');
    assert.ok(!def.name || def.name.length <= 80, entry.id + ' name fits the sanitizer limit');
    assert.ok(!def.desc || def.desc.length <= 180, entry.id + ' desc fits the sanitizer limit');

    assert.ok(INV.grantItem(def, {markNew:false}), 'granting ' + entry.id + ' @ ' + tier + ' succeeded');
    const got = INV.getItem(def.id);
    assert.ok(got, entry.id + ' @ ' + tier + ' is readable back from the bag');
    for(const f of IDENTITY_FIELDS){
      if(def[f] === undefined) continue;
      assert.equal(got[f], def[f], entry.id + ' @ ' + tier + ' lost `' + f + '` to sanitizeLootItem');
    }
    // Function purity: an item only ever carries the stats of its own job.
    const allowed = INV.allowedStatsFor(got.kind, got.weaponType);
    for(const k of Object.keys(got)){
      if(typeof got[k] !== 'number' || k === 'enhancement') continue;
      assert.ok(allowed.includes(k), entry.id + ' @ ' + tier + ' smuggled the off-kind stat ' + k);
    }
    // An item that survived with NO numeric stat and no active identity would be
    // a blank row in the panel — the forge must never hand one over.
    const numbers = Object.keys(got).filter(k => typeof got[k] === 'number' && k !== 'enhancement');
    assert.ok(numbers.length > 0 || got.antennaActive, entry.id + ' @ ' + tier + ' arrived with nothing on it');
    INV.discard(def.id);
    checked++;
  }
}
assert.equal(checked, FORGE.CATALOG.length * FORGE.TIER_ORDER.length, 'every row was exercised at every tier');

// --- fresh ids: grantItem reports success WITHOUT adding on a reused id -------
{
  const before = INV.bagItems().length;
  const ids = new Set();
  for(let i = 0; i < 40; i++){
    const def = FORGE.buildDef('gen_weapon_melee', {tier:'rare', rand, genItem: chests.genItem});
    ids.add(def.id);
    INV.grantItem(def, {markNew:false});
  }
  assert.equal(ids.size, 40, 'forty mints produce forty distinct ids');
  assert.equal(INV.bagItems().length, before + 40, 'each mint really landed in the bag');
  for(const id of ids) INV.discard(id);
}

// --- enhancement seed --------------------------------------------------------
{
  const def = FORGE.buildDef('lit_melee_bleed', {tier:'rare', plus:7});
  assert.equal(def.enhancement, 7, 'the +N knob rides the definition');
  INV.grantItem(def, {markNew:false});
  const info = INV.enhancementInfo(def.id);
  assert.equal(info.level, 7, 'the granted item adopted the seeded enhancement level');
  assert.equal(info.stat, 'attackDamage', 'a melee weapon enhances its damage');
  assert.equal(info.value, info.baseValue + info.step * 7, 'seven levels moved the stat by seven steps');
  const clamped = FORGE.buildDef('lit_melee_bleed', {tier:'rare', plus:500});
  assert.equal(clamped.enhancement, 99, 'the enhancement seed is clamped');
  INV.discard(def.id); INV.discard(clamped.id);
}

// --- generator plumbing ------------------------------------------------------
// Omitting the generator falls back to MM.chests.genItem — that IS the browser
// path, so it must keep working without an explicit injection.
{
  const viaGlobal = FORGE.buildDef('gen_cape_base', {tier:'rare'});
  assert.ok(viaGlobal && viaGlobal.kind === 'cape', 'a gen row falls back to MM.chests.genItem');
  assert.equal(FORGE.buildDef('gen_cape_base', {tier:'rare', genItem:() => null}), null, 'a generator that rolls nothing yields nothing');
}
assert.equal(FORGE.buildDef('nope', {tier:'rare'}), null, 'an unknown row builds nothing');

// --- ammunition bundles point at real resources ------------------------------
const resourceKeys = new Set(INV.RESOURCES.map(r => r.key));
assert.ok(FORGE.AMMO_BUNDLES.length >= 6, 'the forge stocks every ammo family');
for(const bundle of FORGE.AMMO_BUNDLES){
  assert.ok(bundle.keys.length > 0 && bundle.amount > 0, bundle.id + ' hands out something');
  for(const key of bundle.keys) assert.ok(resourceKeys.has(key), bundle.id + ' key ' + key + ' is a registered resource');
}
assert.equal(FORGE.ammoGrants().length, FORGE.AMMO_BUNDLES.reduce((n,b) => n + b.keys.length, 0), 'the flat grant list covers every bundle');
assert.equal(FORGE.ammoBundle('nope'), null, 'an unknown bundle grants nothing');
{
  // Every arrow tier and every thrown kind must be stockable, or the auto-pick
  // ladders (best owned arrow / best owned stone) cannot be exercised at all.
  const stocked = new Set(FORGE.ammoGrants().map(g => g.key));
  for(const m of weaponsSrc.matchAll(/\{id:'[\w]+',\s*key:'(\w+)',\s*label:'[^']*',\s*damage:/g))
    assert.ok(stocked.has(m[1]), 'arrow ammo ' + m[1] + ' is stockable from the forge');
  // Each of these tables is a ladder the weapon auto-picks the best OWNED entry
  // from, so a half-stocked hero silently exercises only its top rung.
  for(const [table, what] of [['THROWN_KINDS','thrown'], ['STONE_TIERS','throwing-stone'], ['BOUNCY_KINDS','rubber']]){
    const block = weaponsSrc.match(new RegExp('const ' + table + '=[[{][\\s\\S]*?\\n {2}[\\]}];'));
    assert.ok(block, 'weapons still declares ' + table);
    const keys = [...block[0].matchAll(/key:'(\w+)'/g)].map(m => m[1]);
    assert.ok(keys.length > 1, table + ' parsed into real keys');
    for(const k of keys) assert.ok(stocked.has(k), what + ' ammo ' + k + ' is stockable from the forge');
  }
  // Stream weapons burn a resource too — an unfuelled flamethrower cannot be tested.
  const fuel = weaponsSrc.match(/const STREAM_FUEL=\{[\s\S]*?\n {2}\};/);
  assert.ok(fuel, 'weapons still declares STREAM_FUEL');
  for(const m of fuel[0].matchAll(/key:'(\w+)'/g))
    assert.ok(stocked.has(m[1]), 'stream fuel ' + m[1] + ' is stockable from the forge');
  assert.ok(stocked.has('harpoonBolt'), 'harpoon bolts are stockable from the forge');
}

// --- source pins: the panel, its wiring and the guest refusal ----------------
assert.match(uiSrc, /function injectGearDebugPanel\(actions, menuPanel\)\{/, 'ui.js declares the armoury panel');
assert.match(uiSrc, /if\(!panel \|\| document\.getElementById\('gearDebugBox'\)\) return;/, 'the panel injects exactly once');
assert.match(uiSrc, /injectLayerDebugPanel, injectEconomyDebugPanel, injectGearDebugPanel, setRadarPulsing,/, 'the panel is on the ui aggregate');
assert.match(uiSrc, /debugSettings:\{load:readDebugSettings,set:debugSet,section:debugSection\}/, 'the debug-settings aggregate entry survived the insert');
for(const id of ['gearDebugSearch','gearDebugGroup','gearDebugKind','gearDebugList','gearDebugTier','gearDebugPlus','gearDebugUnique','gearDebugEquip','gearDebugName','gearDebugPreview'])
  assert.ok(uiSrc.includes("'" + id + "'"), 'the panel exposes the stable control id ' + id);
// The metrics timer must never rebuild the <option> list: that would yank an
// open dropdown shut mid-selection (the mid-edit freeze this repo has paid for).
assert.match(uiSrc, /\/\/ Metrics only: rebuilding the <option> list on a timer would yank an open\n {4}\/\/ dropdown shut mid-selection\.\n {4}const timer=setInterval\(/, 'the armoury timer is documented as metrics-only');
assert.match(uiSrc, /input\.blur\(\);\n {8}run\('make', spec\(\), 'Utworz — brak celu'\);/, 'Enter blurs the field before the panel rebuilds');

assert.match(mainSrc, /import \{ gearForge as GEAR_FORGE \} from '\.\/engine\/gear_forge\.js';/, 'main imports the forge catalogue');
assert.match(mainSrc, /if\(MM\.ui && MM\.ui\.injectGearDebugPanel\) MM\.ui\.injectGearDebugPanel\(\{/, 'main wires the armoury panel');
for(const action of ['groups','kinds','tiers','ammoBundles','catalog','preview','make','makeList','random','ammo','heroKit','wipe','metrics'])
  assert.match(mainSrc, new RegExp('\\n\\t' + action + ':'), 'main wires the armoury action ' + action);
// The .devOnly CSS gate only HIDES the panel; a same-machine co-op guest boots
// with it briefly open, so every action refuses on a replica by itself.
assert.match(mainSrc, /function gearForgeBlocked\(\)\{ return !!MM\.ghostMode \|\| !MM\.inventory \|\| !GEAR_FORGE; \}/, 'the forge refuses on a guest replica');
for(const fn of ['gearForgeMake','gearForgeMakeList','gearForgeRandom','gearForgeAmmo','gearForgeHeroKit','gearForgeWipe'])
  assert.match(mainSrc, new RegExp('function ' + fn + '\\([^)]*\\)\\{\\n\\tif\\(gearForgeBlocked\\(\\)'), fn + ' checks the refusal first');
assert.match(mainSrc, /const GEAR_FORGE_BULK_CAP=60;/, 'bulk creation is capped so it cannot silently eat MAX_BAG');
// The toolbox is one long scrolling column; the armoury must stay at the top of
// it or every testing session begins with a scroll past thirty other panels.
assert.ok(mainSrc.indexOf('MM.ui.injectGearDebugPanel') < mainSrc.indexOf('MM.ui.injectTimeSlider'),
  'the armoury is injected before every other debug panel');
assert.match(uiSrc, /list\.size=Math\.max\(3, Math\.min\(10, rows\.length\|\|1\)\);/, 'the result list shrinks to its hit count');
assert.match(mainSrc, /return \(spec\.equip\?'założono ':'do torby: '\)\+gearForgeDescribe\(INV\.getItem\(def\.id\)\);/,
  'the panel reports the item READ BACK from the bag, not the one it asked for');
// Free crafting must go through the recipe's own make(), never a copy of it.
assert.match(mainSrc, /const made=r\.make\(\);/, 'craft rows run the real recipe effect');
assert.match(mainSrc, /craftedOutputFailed=false;\n\t\tconst made=r\.make\(\);/, 'a full bag still aborts a free craft');

console.log('gear-forge-sim: all assertions passed (' + FORGE.CATALOG.length + ' catalogue rows x ' + FORGE.TIER_ORDER.length + ' tiers)');
