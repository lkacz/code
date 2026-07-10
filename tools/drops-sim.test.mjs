// Ground-loot drop regressions (engine/drops.js): slain creatures shed
// physical pickups instead of teleporting loot into the inventory.
//   * pop physics: drops arc, land on solid footing and settle (and resume
//     falling when the ground under them is mined away)
//   * manual mode: E collects the nearest drop in reach (wantsInteractKey
//     claims the interact key from the wardrobe); auto mode vacuums drops
//   * cursor pickup (PC): hoverAt previews the drop under the pointer (fog-
//     gated, copies the item), pickupAt click-grabs exactly one within reach;
//     holding E (E_HOLD_MS) always opens the wardrobe
//   * resource pickups add to window.inv; gear pickups ride the chest-loot
//     pipeline (MM.dynamicLoot + MM.onLootGained inbox celebration)
//   * themed species gear rolls (GEAR_LOOT): kind/weapon class forced through
//     chests.genItem, tier table weighted, species flavor names applied
//   * settled same-resource piles merge; non-epic drops despawn, epic waits
//   * snapshot/restore roundtrip drops malformed entries
//   * source pins: main.js save/restore/update/draw/E-key + meat scrap recipe
// Run: npm run test:drops
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};

const { T } = await import('../src/constants.js');
MM.TILE = 20;

// --- stubs: flat stone floor at y=SURF, everything above is air --------------
const SURF = 50;
const tiles = new Map();
const key = (x, y) => Math.floor(x) + ',' + Math.floor(y);
function getTile(x, y){
  x = Math.floor(x); y = Math.floor(y);
  const k = key(x, y);
  if(tiles.has(k)) return tiles.get(k);
  return y >= SURF ? T.STONE : T.AIR;
}
function setTile(x, y, t){ tiles.set(key(x, y), t); }

globalThis.player = { x: 500, y: SURF - 1 }; // far away by default
globalThis.inv = { meatScrap: 0, coal: 0 };
const msgs = []; globalThis.msg = m => msgs.push(m);
const played = []; MM.audio = { play: n => played.push(n) };
const bursts = []; MM.particles = { spawnBurst: (x, y, t) => bursts.push(t), spawnSparks: () => {} };

await import('../src/inventory.js'); // real resource registry (labels + meatScrap entry)
const { drops } = await import('../src/engine/drops.js');
assert.ok(drops && MM.drops === drops, 'drops module exports and registers');
const CFG = drops._debug.config;

function advance(seconds, dt = 0.05){
  const steps = Math.ceil(seconds / dt);
  for(let i = 0; i < steps; i++) drops.update(dt, player, getTile);
}

// --- resource registry carries the new scrap ---------------------------------
const scrapDef = MM.inventory.RESOURCES.find(r => r.key === 'meatScrap');
assert.ok(scrapDef, 'meatScrap is a registered resource');
assert.equal(scrapDef.tile, null, 'meat scraps are a pickup, not a placeable block');

// --- pop physics: fall, land, settle ------------------------------------------
drops.reset();
assert.equal(drops.autoPickup(), false, 'headless (non-touch) default is manual pickup');
const d1 = drops.spawnResource(10.5, SURF - 6, 'meatScrap', 1, { vx: 0, vy: 0 });
assert.ok(d1, 'resource drop spawns');
assert.equal(typeof d1.color, 'string', 'resource color resolves ONCE at spawn, not per frame');
advance(3);
assert.equal(d1.settled, true, 'drop settles after falling');
assert.ok(d1.y < SURF && d1.y > SURF - 0.6, 'drop rests just above the floor (y=' + d1.y.toFixed(3) + ')');

// mined-away footing: the settled drop resumes falling to the new floor
setTile(10, SURF, T.AIR); setTile(10, SURF + 1, T.AIR); setTile(10, SURF + 2, T.AIR);
advance(3);
assert.ok(d1.y > SURF + 1 && d1.settled, 'drop falls into the mined shaft and settles again (y=' + d1.y.toFixed(3) + ')');
tiles.clear();

// --- manual pickup: E collects the nearest drop in reach ----------------------
drops.reset(); msgs.length = 0; played.length = 0;
const d2 = drops.spawnResource(20.5, SURF - 1, 'meatScrap', 2, { vx: 0, vy: 0 });
advance(1);
player.x = 20.5; player.y = SURF - 1;
assert.equal(drops.wantsInteractKey(player), true, 'a drop in reach claims the interact key');
assert.equal(drops.pickupNearest(player), true, 'E picks the drop up');
assert.equal(inv.meatScrap, 2, 'resource pickup lands in the block inventory');
assert.ok(msgs.some(m => m.includes('Skrawki miesa') && m.includes('×2')), 'pickup message names the resource and count');
assert.ok(played.includes('harvest'), 'common pickup plays the harvest chirp');
assert.equal(drops.metrics().active, 0, 'collected drop leaves the world');
assert.equal(drops.wantsInteractKey(player), false, 'no drop in reach, no interact claim');
assert.equal(drops.pickupNearest(player), false, 'nothing to pick up returns false');
player.x = 500;

// out of reach: no claim
drops.spawnResource(30.5, SURF - 1, 'coal', 1, { vx: 0, vy: 0 });
player.x = 30.5 + CFG.PICKUP_RADIUS + 0.5;
assert.equal(drops.wantsInteractKey(player), false, 'drop beyond reach does not claim E');
player.x = 500;

// --- cursor pickup: hover previews, a click takes exactly one -----------------
drops.reset(); msgs.length = 0; inv.coal = 0;
const hovGear = drops.spawnGear(60.5, SURF - 1, { id: 'cape_drop_hov', kind: 'cape', name: 'Peleryna pod kursorem', tier: 'rare', airJumps: 1 }, { vx: 0, vy: 0 });
const hovRes = drops.spawnResource(62.5, SURF - 1, 'coal', 2, { vx: 0, vy: 0 });
advance(0.5);
player.x = 61.0; player.y = SURF - 1;
const hovInfo = drops.hoverAt(hovGear.x, hovGear.y, player);
assert.ok(hovInfo && hovInfo.kind === 'gear' && hovInfo.item && hovInfo.item.id === 'cape_drop_hov',
  'hover over a gear drop returns its item payload');
assert.equal(hovInfo.inReach, true, 'hover reports click reach from the hero');
assert.notEqual(hovInfo.item, hovGear.item, 'hover hands out a copy, not the live item');
const hovRes2 = drops.hoverAt(hovRes.x, hovRes.y, player);
assert.ok(hovRes2 && hovRes2.kind === 'resource' && hovRes2.label && hovRes2.qty === 2,
  'hover over a resource drop returns label and count');
assert.equal(drops.hoverAt(hovGear.x, hovGear.y - CFG.MOUSE_HIT - 0.3, player), null,
  'cursor beyond the hit radius previews nothing');
assert.equal(drops.hoverAt(hovGear.x, hovGear.y, player, { visible: () => false }), null,
  'fog-hidden drops neither preview nor highlight');
// selective grab: the click takes ONLY the pointed drop, its neighbor stays
assert.equal(drops.pickupAt(hovRes.x, hovRes.y, player), 'picked', 'click within reach takes the drop');
assert.equal(inv.coal, 2, 'clicked resource lands in the inventory');
assert.equal(drops.metrics().active, 1, 'the neighboring drop is untouched');
player.x = hovGear.x + CFG.MOUSE_PICKUP_RADIUS + 0.5;
assert.equal(drops.pickupAt(hovGear.x, hovGear.y, player), 'far', 'click beyond reach asks to walk closer');
assert.equal(drops.pickupAt(hovGear.x, hovGear.y, player, { visible: () => false }), null,
  'fog-hidden drops cannot be click-grabbed');
assert.equal(drops.metrics().active, 1, 'a too-far click leaves the drop in the world');
player.x = 500;
drops.hoverAt(NaN, NaN); // main.js clears the hover highlight this way each gated frame

// --- auto-pickup: vacuum without a key ----------------------------------------
drops.reset();
drops.setAutoPickup(true);
assert.equal(drops.autoPickup(), true, 'auto mode toggles on');
inv.coal = 0;
drops.spawnResource(40.5, SURF - 1, 'coal', 1, { vx: 0, vy: 0 });
player.x = 40.5 + CFG.AUTO_RADIUS - 0.4; player.y = SURF - 1;
assert.equal(drops.wantsInteractKey(player), false, 'auto mode never claims the interact key');
advance(1.5);
assert.equal(inv.coal, 1, 'auto mode vacuums the drop into the inventory');
assert.equal(drops.metrics().active, 0, 'vacuumed drop is gone');
drops.setAutoPickup(false);
player.x = 500;

// --- gear pickup rides the chest-loot pipeline --------------------------------
drops.reset(); played.length = 0;
const gained = []; MM.onLootGained = (items, tier) => gained.push({ items, tier });
const rareCape = { id: 'cape_drop_test1', kind: 'cape', name: 'Peleryna testowa', tier: 'rare', airJumps: 2 };
const g1 = drops.spawnGear(50.5, SURF - 1, rareCape, { vx: 0, vy: 0 });
assert.equal(g1.tier, 'rare', 'gear drop carries its item tier');
advance(0.5);
player.x = 50.5; player.y = SURF - 1;
assert.equal(drops.pickupNearest(player), true, 'gear pickup succeeds');
assert.ok(MM.dynamicLoot && MM.dynamicLoot.capes.some(i => i && i.id === 'cape_drop_test1'),
  'picked-up gear lands in the dynamic loot pool');
assert.equal(gained.length, 1, 'pickup fires the loot-inbox celebration');
assert.ok(played.includes('chest'), 'rare pickup plays the chest fanfare');
player.x = 500;

// --- themed species rolls (GEAR_LOOT) ------------------------------------------
drops.reset();
const genCalls = [];
MM.chests = { genItem: (r, tier, opts) => { genCalls.push({ tier, opts }); return { id: 'gen', kind: opts.kind, weaponType: opts.weaponType, tier }; } };
const rng = (queue) => () => queue.length ? queue.shift() : 0.5;
// BAT (chance 0.09, cape-only): 0.01 passes the chance roll, 0.0 picks the first
// option, 0.99 lands in the epic band of {0.80,0.17,0.03}
drops._debug.setRandom(rng([0.01, 0.0, 0.99]));
const batDrop = drops.rollGearDrop({ id: 'BAT', x: 60, y: SURF - 2 });
assert.ok(batDrop, 'lucky bat kill sheds gear');
assert.equal(genCalls[0].opts.kind, 'cape', 'bats shed capes — the loot is thematic');
assert.equal(genCalls[0].tier, 'epic', 'weighted tier roll reaches epic on a 0.99');
assert.equal(batDrop.item.name, 'Peleryna nietoperza', 'species flavor name overrides the procedural one');
assert.equal(batDrop.item.desc, 'Pachnie jaskinią. Pranie nie pomaga.', 'the flavor one-liner rides along');
assert.equal(batDrop.tier, 'epic', 'drop entity carries the rolled tier');
assert.equal(batDrop.source, 'mob', 'creature-shed gear remembers where it came from');
// chance-fail path and the one deliberate exception
drops._debug.setRandom(rng([0.5]));
assert.equal(drops.rollGearDrop({ id: 'BAT', x: 60, y: SURF - 2 }), null, 'failed chance roll sheds nothing');
assert.equal(drops.rollGearDrop({ id: 'ATOMIC_BOMB', x: 60, y: SURF - 2 }), null, 'a walking bomb leaves a crater, not loot');

// --- full species coverage: every creature sheds something sensible -------------
{
  const mobsSrcCover = readFileSync(new URL('../src/engine/mobs.js', import.meta.url), 'utf8');
  const speciesIds = new Set();
  for(const m of mobsSrcCover.matchAll(/\bid:\s*'([A-Z_]{3,})'/g)) speciesIds.add(m[1]);
  assert.ok(speciesIds.size >= 40, 'sanity: species scan found the shipped roster (' + speciesIds.size + ')');
  const LOOTLESS = new Set(['ATOMIC_BOMB']); // explosive ordnance: no pockets
  for(const id of speciesIds){
    if(LOOTLESS.has(id)) continue;
    const entry = drops._debug.GEAR_LOOT[id];
    assert.ok(entry, 'species ' + id + ' has a themed loot entry');
    assert.ok(entry.chance > 0 && entry.chance <= 0.9, id + ' chance is a sane probability');
    assert.ok(Array.isArray(entry.options) && entry.options.length >= 1, id + ' has themed options');
    for(const opt of entry.options){
      assert.ok(['cape', 'eyes', 'outfit', 'weapon', 'charm'].includes(opt.kind), id + ' option kind is valid');
      if(opt.kind === 'weapon') assert.ok(['melee', 'bow', 'flame', 'hose', 'gas', 'electric'].includes(opt.weaponType), id + ' weapon option names its class');
      assert.ok(typeof opt.name === 'string' && opt.name.length >= 3, id + ' option carries a themed name');
      assert.ok(typeof opt.desc === 'string' && opt.desc.length >= 3 && opt.desc.length <= 80, id + ' option carries a flavor one-liner');
    }
    const w = entry.tiers;
    assert.ok(w && (w.common + w.rare + w.epic) > 0.99 && (w.common + w.rare + w.epic) < 1.01, id + ' tier weights sum to 1');
  }
  // the creature's craft is its loot: archers shed bows, breathers shed flame,
  // fish shed hoses, shock hunters shed beams
  const kindsOf = id => drops._debug.GEAR_LOOT[id].options.map(o => o.weaponType || o.kind);
  assert.ok(kindsOf('SZKIELET').includes('bow'), 'skeleton archer sheds a bow');
  assert.ok(kindsOf('GOLD_DRAGON').includes('flame'), 'fire-breathing dragon sheds a flame weapon');
  assert.ok(kindsOf('FISH').includes('hose'), 'fish sheds a water hose');
  assert.ok(kindsOf('EEL').includes('electric'), 'electric eel sheds an electric weapon');
}

// --- hostile lands promise better loot -------------------------------------------
assert.equal(drops._debug.dangerFor({}), 0, 'center of the map is danger 0');
assert.equal(drops._debug.dangerFor({ hostility: 0.5 }), 0.5, 'mob hostility maps straight to danger');
assert.equal(drops._debug.dangerFor({ hostilityTier: 4 }), 1, 'top hostility tier is full danger');
MM.worldHostility = { at: () => ({ hostility: 0.7 }) };
assert.equal(drops._debug.dangerFor({ x: 5000 }), 0.7, 'without mob fields the world gradient decides');
delete MM.worldHostility;
drops._debug.setRandom(rng([0.9]));
assert.equal(drops._debug.rollTier({ common: 0.80, rare: 0.17, epic: 0.03 }, 0), 'rare', 'a 0.9 roll at home is merely rare');
drops._debug.setRandom(rng([0.9]));
assert.equal(drops._debug.rollTier({ common: 0.80, rare: 0.17, epic: 0.03 }, 1), 'epic', 'the same 0.9 roll in a hostile land is epic');
// danger also raises the drop chance itself: 0.12 fails BAT's base 0.09 but
// passes the danger-boosted 0.162
drops._debug.setRandom(rng([0.12]));
assert.equal(drops.rollGearDrop({ id: 'BAT', x: 60, y: SURF - 2 }), null, 'a 0.12 roll misses the home-land chance');
drops._debug.setRandom(rng([0.12, 0.0, 0.0]));
assert.ok(drops.rollGearDrop({ id: 'BAT', x: 60, y: SURF - 2, hostility: 1 }), 'the same roll hits in a fully hostile land');

// --- guardian relics: bosses shed all signatures, sidekicks roll one --------------
drops.reset(); genCalls.length = 0; played.length = 0; msgs.length = 0;
drops._debug.setRandom(rng([]));
const fireRelics = drops.rollGuardianDrop('fire', 100, SURF - 4, { boss: true });
assert.ok(Array.isArray(fireRelics) && fireRelics.length === 2, 'felled fire guardian sheds both signature relics');
assert.deepEqual(genCalls.map(c => c.opts.weaponType || c.opts.kind), ['flame', 'cape'], 'Ignivar sheds his fiery breath and a wyrm cape');
assert.ok(genCalls.every(c => c.tier === 'epic' && c.opts.forceUnique === true), 'guardian relics are unique-boosted epics');
assert.ok(fireRelics.some(d => d.item.name === 'Oddech Ignivara'), 'relic carries its signature name');
assert.ok(fireRelics.every(d => d.life === CFG.GUARDIAN_RELIC_LIFE), 'one-shot arc trophies get the merciful clock');
assert.ok(played.includes('golden'), 'an epic drop announces itself the moment it falls');
assert.ok(msgs.some(m => m.includes('wyjątkowego')), 'epic spawn posts the excitement message');
genCalls.length = 0;
drops._debug.setRandom(rng([0.1, 0.3]));
const mirrorRelic = drops.rollGuardianDrop('ice', 100, SURF - 4, { role: 'mirror' });
assert.ok(mirrorRelic, 'sidekick roll can shed a relic');
assert.equal(mirrorRelic.item.name, 'Zwierciadło zorzy', 'sidekick relic is role-themed');
assert.equal(genCalls[0].tier, 'epic', 'a 0.3 sidekick tier roll goes epic');
drops._debug.setRandom(rng([0.9]));
assert.equal(drops.rollGuardianDrop('ice', 100, SURF - 4, { role: 'mirror' }), null, 'sidekick roll can miss');
assert.equal(drops.rollGuardianDrop('ice', 100, SURF - 4, { role: 'leafling' }), null, 'unlisted role sheds nothing');
assert.equal(drops.rollGuardianDrop('mother', 100, SURF - 4, { boss: true }), null, 'center mimic keeps its story reward instead');
drops._debug.setRandom(null);
delete MM.chests;

// --- guardian relic tables are fully named and flavored ----------------------------
for(const kind of Object.keys(drops._debug.GUARDIAN_LOOT)){
  const t = drops._debug.GUARDIAN_LOOT[kind];
  for(const def of t.boss) assert.ok(def.name && typeof def.desc === 'string' && def.desc.length <= 80, kind + ' boss relic is named and flavored');
  for(const role of Object.keys(t.sidekicks)) assert.ok(t.sidekicks[role].name && t.sidekicks[role].desc, kind + '/' + role + ' sidekick relic is named and flavored');
}

// --- one E press sweeps the whole pile ---------------------------------------------
drops.reset(); msgs.length = 0; played.length = 0;
drops.spawnResource(110.2, SURF - 1, 'meatScrap', 2, { vx: 0, vy: 0 });
drops.spawnResource(110.9, SURF - 1, 'coal', 1, { vx: 0, vy: 0 });
advance(1);
player.x = 110.5; player.y = SURF - 1;
assert.equal(drops.pickupNearest(player), true, 'one E press sweeps everything in reach');
assert.equal(drops.metrics().active, 0, 'nothing is left to chase with more presses');
const sweepMsgs = msgs.filter(m => m.startsWith('Podniesiono'));
assert.equal(sweepMsgs.length, 1, 'the sweep posts ONE aggregated message');
assert.ok(sweepMsgs[0].includes('Skrawki miesa ×2') && sweepMsgs[0].includes('Węgiel ×1'), 'the message lists every pile grabbed');
assert.equal(played.length, 1, 'one fanfare per press, not per item');
player.x = 500;

// --- bad-luck insurance: a dry spell guarantees the next drop ----------------------
drops.reset();
MM.chests = { genItem: (r, tier, opts) => ({ id: 'p', kind: opts.kind, weaponType: opts.weaponType, tier }) };
drops._debug.setRandom(() => 0.99); // every chance roll misses
for(let i = 0; i < drops._debug.config.PITY_KILLS; i++){
  assert.equal(drops.rollGearDrop({ id: 'BAT', x: 60, y: SURF - 2 }), null, 'dry spell keeps missing');
}
assert.equal(drops._debug.dryStreak(), drops._debug.config.PITY_KILLS, 'misses accumulate toward the insurance');
const pityDrop = drops.rollGearDrop({ id: 'BAT', x: 60, y: SURF - 2 });
assert.ok(pityDrop, 'the insured kill always pays out');
assert.notEqual(pityDrop.tier, 'common', 'insurance never pays below rare');
assert.equal(drops._debug.dryStreak(), 0, 'a payout resets the streak');
drops._debug.setRandom(null);
delete MM.chests;

// --- lava eats loot; epic loot sits in it, glowing ---------------------------------
drops.reset();
setTile(120, SURF - 1, T.LAVA);
drops.spawnResource(120.5, SURF - 1, 'coal', 1, { vx: 0, vy: 0 });
const epicLava = drops.spawnGear(120.5, SURF - 1, { id: 'lava1', kind: 'charm', name: 'L', tier: 'epic' }, { vx: 0, vy: 0, announce: false });
advance(1.2);
assert.equal(drops.metrics().active, 1, 'lava burns the ordinary drop');
assert.equal(drops._debug.list[0], epicLava, 'the epic survives the lava, daring you to reach it');
tiles.clear();

// --- volcano sacrifice: commons fed to the lava can come back better ----------------
drops.reset();
MM.chests = { genItem: (r, tier, opts) => ({ id: 'v', kind: opts.kind, tier }) };
setTile(140, SURF - 1, T.LAVA);
drops._debug.setRandom(() => 0.99); // the volcano refuses this offering
drops.spawnGear(140.5, SURF - 1, { id: 'c1', kind: 'charm', name: 'C1', tier: 'common' }, { vx: 0, vy: 0, announce: false });
advance(0.6);
assert.equal(drops.metrics().active, 0, 'a refused offering just burns');
assert.equal(drops._debug.sacrificeDry(), 1, 'the volcano remembers refused offerings');
msgs.length = 0;
drops.spawnGear(140.5, SURF - 1, { id: 'c2', kind: 'charm', name: 'C2', tier: 'common' }, { vx: 0, vy: 0, announce: false });
drops._debug.setRandom(rng([0.001, 0.5, 0.5])); // ratcheted chance hits; kind + rare tier
advance(0.6);
const gift = drops._debug.list.find(d => d.source === 'volcano');
assert.ok(gift, 'a lucky offering is flung back out upgraded');
assert.equal(gift.item.name, 'Dar wulkanu', 'the volcano signs its gift');
assert.ok(gift.tier === 'rare' || gift.tier === 'epic', 'the gift always beats the offering');
assert.ok(gift._lavaGraceT > 0, 'the newborn gift arcs over the lava it rose from');
assert.equal(drops._debug.sacrificeDry(), 0, 'a payout resets the ratchet');
assert.ok(msgs.some(m => m.includes('Wulkan')), 'the eruption is announced');
drops._debug.setRandom(null);
delete MM.chests;
tiles.clear();

// --- discard throws the item out as a physical drop ---------------------------------
drops.reset();
const INV = MM.inventory;
INV.grantItem({ id: 'trash_1', kind: 'charm', name: 'Nudny talizman', tier: 'common', mineSpeedMult: 1.05 });
player.x = 150.5; player.y = SURF - 1;
assert.equal(INV.discard('trash_1'), true, 'bag discard succeeds');
assert.equal(drops.metrics().active, 1, 'a discarded item is thrown out, not vaporized');
const thrown = drops._debug.list[0];
assert.equal(thrown.item.name, 'Nudny talizman', 'the thrown drop is the discarded item');
assert.notEqual(thrown.item.id, 'trash_1', 'a fresh id dodges the discard blacklist on re-pickup');
player.x = 500;

// --- epic pickup pays a short euphoria buff ------------------------------------------
drops.reset();
const buffs = []; MM.progress = { addBuff: b => buffs.push(b) };
drops.spawnGear(160.5, SURF - 1, { id: 'eu1', kind: 'cape', name: 'E', tier: 'epic', airJumps: 3 }, { vx: 0, vy: 0, announce: false });
player.x = 160.5; player.y = SURF - 1;
drops.pickupNearest(player);
assert.ok(buffs.some(b => b && b.name === 'Euforia'), 'snatching an epic triggers the euphoria buff');
delete MM.progress;
player.x = 500;

// --- the loot rule is a journal discovery ------------------------------------------
drops.reset();
const notes = []; MM.discovery = { note: (id) => { notes.push(id); return true; } };
drops.spawnGear(130.5, SURF - 2, { id: 'disc1', kind: 'charm', name: 'D', tier: 'epic' });
assert.ok(notes.includes('epic_drop'), 'an epic spawn writes the journal');
MM.chests = { genItem: (r, tier, opts) => ({ id: 'disc2', kind: opts.kind, tier }) };
drops._debug.setRandom(rng([0.01, 0.0, 0.0]));
const srcDrop = drops.rollGearDrop({ id: 'BAT', x: 131, y: SURF - 2 });
assert.ok(srcDrop && srcDrop.source === 'mob', 'creature gear carries its source');
player.x = 131; player.y = SURF - 2;
drops.pickupNearest(player);
assert.ok(notes.includes('mob_gear'), 'the first creature-shed pickup teaches the loot rule');
drops._debug.setRandom(null);
delete MM.chests; delete MM.discovery;
player.x = 500;

// --- reload is not a find: restored gear stays silent ------------------------------
drops.reset(); played.length = 0;
drops.restore({ v: 1, list: [{ kind: 'gear', x: 5, y: SURF - 1, tier: 'epic', age: 0, item: { id: 'w9', kind: 'weapon', name: 'Q', tier: 'epic', attackDamage: 9 } }] });
assert.equal(drops.metrics().active, 1, 'restore brings the epic back');
assert.equal(played.length, 0, 'restored drops do not replay the fanfare');

// --- real generator honors forced kind / weapon class --------------------------
{
  const { chests } = await import('../src/engine/chests.js');
  const RNG = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s >>> 8) / 0xFFFFFF; }; };
  for(let i = 0; i < 12; i++){
    const eyes = chests.genItem(RNG(i * 31 + 7), 'epic', { kind: 'eyes' });
    assert.equal(eyes.kind, 'eyes', 'forced kind sticks');
    assert.ok(eyes.visionRadius >= 15 && eyes.visionRadius <= 17 + 2, 'epic eyes roll epic vision (' + eyes.visionRadius + ')');
    const zap = chests.genItem(RNG(i * 77 + 3), 'rare', { kind: 'weapon', weaponType: 'electric' });
    assert.equal(zap.weaponType, 'electric', 'forced weapon class sticks');
    assert.ok(typeof zap.energyCost === 'number', 'electric roll carries its class stat');
    const free = chests.genItem(RNG(i * 13 + 1), 'common');
    assert.ok(['cape', 'eyes', 'outfit', 'weapon', 'charm'].includes(free.kind), 'unforced roll still picks any kind');
  }
}

// --- settled piles merge --------------------------------------------------------
drops.reset();
drops.spawnResource(70.2, SURF - 1, 'meatScrap', 1, { vx: 0, vy: 0 });
drops.spawnResource(70.7, SURF - 1, 'meatScrap', 2, { vx: 0, vy: 0 });
advance(1.5);
assert.equal(drops.metrics().active, 1, 'adjacent settled scraps merge into one pile');
assert.equal(drops._debug.list[0].qty, 3, 'merged pile keeps the combined count');

// --- ticking bomb: the better the find, the faster it burns out --------------------
drops.reset();
const LIFE = CFG.GEAR_LIFE;
assert.ok(LIFE.epic < LIFE.rare && LIFE.rare < LIFE.common, 'gear lifetimes invert with quality');
const rotting = drops.spawnResource(80.5, SURF - 1, 'coal', 1, { vx: 0, vy: 0 });
rotting.age = CFG.DESPAWN_SEC - 0.05;
const ticking = drops.spawnGear(82.5, SURF - 1, { id: 'w1', kind: 'weapon', name: 'X', tier: 'epic', attackDamage: 9 }, { vx: 0, vy: 0, announce: false });
assert.equal(ticking.life, LIFE.epic, 'an epic drop carries the shortest clock');
ticking.age = LIFE.epic - 0.05;
advance(0.3);
assert.equal(drops._debug.list.includes(rotting), false, 'stale resource drop despawns');
assert.equal(drops._debug.list.includes(ticking), false, 'an unclaimed epic burns out on its short fuse');

// --- snapshot / restore -----------------------------------------------------------
drops.reset();
drops.spawnResource(90.5, SURF - 1, 'meatScrap', 2, { vx: 0, vy: 0 });
drops.spawnGear(92.5, SURF - 1, { id: 'cape_x', kind: 'cape', name: 'Y', tier: 'rare', airJumps: 1 }, { vx: 0, vy: 0 });
const snap = drops.snapshot();
assert.equal(snap.list.length, 2, 'snapshot captures both drops');
drops.reset();
drops.restore(snap);
assert.equal(drops.metrics().active, 2, 'restore brings both drops back');
const restoredGear = drops._debug.list.find(d => d.kind === 'gear');
assert.equal(restoredGear.item.id, 'cape_x', 'gear payload survives the roundtrip');
drops.restore({ v: 1, list: [ { x: 'nan', y: 1 }, { kind: 'gear', x: 1, y: 1, item: { id: 5 } }, { kind: 'resource', x: 1, y: 1, res: 42 } ] });
assert.equal(drops.metrics().active, 0, 'malformed snapshot entries are dropped');

// --- source pins: the wiring contracts in main.js / mobs.js / UI -------------------
const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
assert.match(mainSrc, /drops:\s*timedSavePart\('drops',[^\n]*DROPS && DROPS\.snapshot/, 'save payload includes ground loot drops');
assert.match(mainSrc, /if\(DROPS && DROPS\.restore\) DROPS\.restore\(data\.drops\)/, 'restore rehydrates ground loot drops');
assert.match(mainSrc, /if\(DROPS && DROPS\.update\) DROPS\.update\(dt, player, getTile\)/, 'game step ticks the drop simulation');
assert.match(mainSrc, /if\(DROPS && DROPS\.draw\) DROPS\.draw\(ctx,TILE,camRenderX,camRenderY,zoom,worldFxVisible,player\)/, 'draw pass renders drops under creatures');
assert.match(mainSrc, /DROPS && DROPS\.pickupNearest && DROPS\.pickupNearest\(player\)/, 'E key collects the nearest drop');
assert.match(mainSrc, /MECHS\.wantsInteractKey\(player\)/, 'machine context still wins the interact key');
assert.match(mainSrc, /id:'meat_block', name:'Blok miesa', cost:\{meatScrap:3\}/, 'meat scraps meld into a MEAT block at the bench');
assert.match(mainSrc, /Auto-zbieranie łupów/, 'pause panel exposes the auto-pickup toggle');
assert.match(mainSrc, /if\(DROPS && DROPS\.reset\) DROPS\.reset\(\)/, 'world resets clear lingering drops');
assert.match(mainSrc, /DROPS\.pickupAt\(aim\.x,aim\.y,player,\{visible:worldFxVisible\}\)==='picked'/, 'left click grabs the hovered drop (fog-gated)');
assert.match(mainSrc, /updateDropPreview\(\);/, 'frame loop refreshes the corner drop preview');
assert.match(mainSrc, /DROPS\.hoverAt\(aim\.x,aim\.y,player,\{visible:worldFxVisible\}\)/, 'hover preview asks drops.hoverAt with the fog gate');
const mobsSrc = readFileSync(new URL('../src/engine/mobs.js', import.meta.url), 'utf8');
assert.match(mobsSrc, /MM\.drops && MM\.drops\.spawnResource/, 'mob deaths route loot through physical drops');
assert.match(mobsSrc, /MM\.drops\.rollGearDrop\(m\)/, 'mob deaths roll themed gear drops');
assert.match(mobsSrc, /meatScrapCountFor/, 'meat kills shed size-scaled scrap counts');
const invUiSrc = readFileSync(new URL('../src/inventory_ui.js', import.meta.url), 'utf8');
assert.match(invUiSrc, /drops\.wantsInteractKey/, 'wardrobe yields E to a drop in reach');
assert.match(invUiSrc, /const E_HOLD_MS=\d+/, 'holding E opens the wardrobe past the tap window');
assert.match(invUiSrc, /!e\.repeat && e\.key\.toLowerCase\(\)==='e'/, 'auto-repeat E never toggles the wardrobe');
const indexSrc = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(indexSrc, /id="dropPreview"/, 'index.html carries the corner drop-preview card');
const craftingSrc = readFileSync(new URL('../src/engine/crafting.js', import.meta.url), 'utf8');
assert.match(craftingSrc, /meatScrap:/, 'crafting source hints cover meat scraps');
const lairsSrc = readFileSync(new URL('../src/engine/guardian_lairs.js', import.meta.url), 'utf8');
assert.match(lairsSrc, /rollGuardianDrop\(e\.kind,e\.x,e\.y,\{boss:true\}\)/, 'fire/ice guardian bosses shed their relics');
assert.match(lairsSrc, /rollGuardianDrop\(e\.kind,e\.x,e\.y,\{role:e\.role\}\)/, 'fire/ice sidekicks roll a relic');
const undergroundSrc = readFileSync(new URL('../src/engine/underground_boss.js', import.meta.url), 'utf8');
assert.match(undergroundSrc, /rollGuardianDrop\('earth',e\.x,e\.y,\{boss:true\}\)/, 'earth excavator sheds its relics');
const skySrc = readFileSync(new URL('../src/engine/sky_guardian.js', import.meta.url), 'utf8');
assert.match(skySrc, /rollGuardianDrop\('air',e\.x,e\.y,\{boss:true\}\)/, 'sky crown sheds its relics');
assert.match(skySrc, /rollGuardianDrop\('air',e\.x,e\.y,\{role:'resonator'\}\)/, 'resonators roll a relic (leaflings stay lootless)');
const chestsSrc = readFileSync(new URL('../src/engine/chests.js', import.meta.url), 'utf8');
assert.match(chestsSrc, /opts\.forceUnique \|\| r\(\)<td\.uniqueChance/, 'genItem supports forced unique boosts for guardian relics');
const invSrc = readFileSync(new URL('../src/inventory.js', import.meta.url), 'utf8');
assert.match(invSrc, /drops\.spawnGear\(p\.x, p\.y-0\.3, thrown, \{announce:false\}\)/, 'discard throws the item out as a ground drop');

console.log('drops-sim: all assertions passed');
