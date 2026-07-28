// Gravity gun regressions (engine/gravity_gun.js + the weapons.js state machine
// + the main.js world seams + the gvx/gvt hero intents).
// The weapon's contract is THE MATERIAL LAW: what the gun lifts, how each
// material flies, what it does to a creature and what happens where it lands —
// all derived from real INFO/material-physics data, never invented per call.
//   * carry census: the allow-set is exactly the four honest routes; every
//     refusal names a reason from a closed set (bedrock/hull/rigid/fluid/...)
//   * physics monotonicity: heavier falls shorter ("rock = short range, steep
//     arc" as an executable claim), harder channels longer and costs more
//   * status identity: no curated cause string may smuggle a combat ELEMENT
//     (mobs.js classifies by substring — 'meteor' in a cause = explosion)
//   * matter conservation: shatter pays the tile's normal mining yield once
//   * multiplayer: the guest names only aim/target; the carried tile id is
//     HOST body state, never on the throw wire, never serialized
// Run: npm run test:gravity-gun
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
const { T, INFO } = await import('../src/constants.js');
const MP = await import('../src/engine/material_physics.js');
const GG = await import('../src/engine/gravity_gun.js');
await import('../src/inventory.js');
const INV = globalThis.MM.inventory;

const gravSrc = readFileSync(new URL('../src/engine/gravity_gun.js', import.meta.url), 'utf8');
const wSrc = readFileSync(new URL('../src/engine/weapons.js', import.meta.url), 'utf8');
const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const netSrc = readFileSync(new URL('../src/engine/ghost_net.js', import.meta.url), 'utf8');
const hostSrc = readFileSync(new URL('../src/engine/ghost_host.js', import.meta.url), 'utf8');
const clientSrc = readFileSync(new URL('../src/engine/ghost_client.js', import.meta.url), 'utf8');

// --- module shape ------------------------------------------------------------
assert.ok(GG.gravityGun && globalThis.MM.gravityGun === GG.gravityGun, 'gravity module exports and registers on MM');

// --- carry census: the allow-set IS the four honest routes -------------------
const CARRY_ROUTES = new Set(['build-material', 'foliage', 'loose-item', 'granular']);
const VALID_REASONS = new Set(['bounds', 'void', 'fluid', 'gas', 'rigid', 'fixture', 'utility', 'hazard', 'bedrock', 'story', 'hull', 'tile']);
let allowed = 0;
for (let t = 0; t < 200; t++) {
  if (!INFO[t]) continue;
  const v = GG.canCarryTile(t);
  const route = MP.materialPhysicsRoute(t);
  if (CARRY_ROUTES.has(route)) {
    assert.ok(v.ok, 'route ' + route + ' tile ' + t + ' must be carryable');
    allowed++;
  } else {
    assert.ok(!v.ok, 'route ' + route + ' tile ' + t + ' must refuse');
    assert.ok(VALID_REASONS.has(v.reason), 'tile ' + t + ' refusal names a known reason, got ' + v.reason);
  }
}
assert.equal(allowed, 55, 'the gun lifts exactly the 55 honest-material tiles');
assert.equal(GG.canCarryTile(T.BEDROCK).reason, 'bedrock', 'the world floor refuses by name');
assert.equal(GG.canCarryTile(T.UFO_CONCRETE).reason, 'hull', 'the welded alien hull refuses by name (explosives stay the lore entry)');
assert.equal(GG.canCarryTile(T.WATER).reason, 'fluid', 'the fluid sim owns its cells');
assert.equal(GG.canCarryTile(T.LAVA).reason, 'fluid', 'lava too');
assert.equal(GG.canCarryTile(T.TELEPORTER).reason, 'rigid', 'registry machines refuse (a carried teleporter would orphan its Map entry)');
assert.equal(GG.canCarryTile(T.DYNAMO).reason, 'rigid', 'dynamo refuses');
assert.equal(GG.canCarryTile(T.THIN_ICE).reason, 'hazard', 'trap tiles refuse');
assert.equal(GG.canCarryTile(T.ALTAR).reason, 'story', 'story stones refuse');
assert.equal(GG.canCarryTile(-1).reason, 'bounds', 'out-of-range ids refuse');
assert.equal(GG.canCarryTile(T.AIR).reason, 'void', 'air refuses silently');

// --- physics: the executable design claims -----------------------------------
assert.ok(GG.rangeAt45(T.BASALT) < GG.rangeAt45(T.STONE), 'basalt flies shorter than stone');
assert.ok(GG.rangeAt45(T.STONE) < GG.rangeAt45(T.WOOD), 'stone flies shorter than wood');
assert.ok(GG.rangeAt45(T.WOOD) < GG.rangeAt45(T.LEAF), 'wood flies shorter than a leaf block — mass prices range');
assert.ok(GG.gravDamage(T.BASALT) > GG.gravDamage(T.STONE) && GG.gravDamage(T.STONE) > GG.gravDamage(T.LEAF),
  'damage orders by hardness x mass');
assert.equal(GG.gravDamage(T.LEAF), 1, 'foliage barely bruises');
assert.equal(GG.gravDamage(T.GLASS), 5, 'glass cuts (bleed) instead of bludgeoning');
for (let t = 0; t < 200; t++) {
  if (!INFO[t] || !GG.canCarryTile(t).ok) continue;
  const d = GG.gravDamage(t), v0 = GG.muzzleSpeed(t), gm = GG.gravMult(t);
  assert.ok(d >= 1 && d <= 36, 'damage envelope 1..36 (< DMG_MAX 45) for tile ' + t);
  assert.ok(v0 >= 9 && v0 <= 19, 'muzzle speed 9..19 (< ARROW_SPEED 22) for tile ' + t);
  assert.ok(gm >= 0.6 && gm <= 1.8, 'gravity multiplier stays sane for tile ' + t);
  assert.ok(GG.channelSeconds(t) >= 0.25, 'every rip takes real time for tile ' + t);
}
// harder = longer channel (the pick's hp/6 stays strictly faster than hp/4)
assert.ok(GG.channelSeconds(T.OBSIDIAN) > GG.channelSeconds(T.STONE), 'obsidian rips slower than stone');
assert.ok(GG.channelSeconds(T.STONE) * 6 > (Number(INFO[T.STONE].hp) || 0), 'the gun never out-mines a pickaxe');
// the energy gate is real: basalt channel alone outcosts the base-40 hero
assert.ok(GG.channelSeconds(T.BASALT) * 14 > 40, 'a base-energy hero cannot lift basalt (serious investment required)');

// --- status identity: the element trap, made loud ----------------------------
// mobs.js combatElementFromOpts classifies by SUBSTRING; a cause carrying
// 'meteor' becomes an explosion, 'water' a soak. Only deliberate elements pass.
const DELIBERATE_ELEMENT_CAUSES = new Set(['grav_ice', 'grav_toxic', 'grav_lava_relic']);
const ELEMENT_TRAP = /fire|flame|burn|heat|lava|electric|shock|lightning|laser|water|hose|drown|pressure|ice|frost|chill|cold|gas|poison|toxic|explosion|blast|meteor/;
const REAL_STATUSES = new Set(['burn', 'poison', 'chill', 'wet', 'frozen', 'bleed', 'stun', 'panic', 'sunder', 'blind']);
for (const [tid, fx] of Object.entries(GG.GRAV_EFFECTS)) {
  assert.ok(REAL_STATUSES.has(fx.status), 'tile ' + tid + ' uses a real mob status, got ' + fx.status);
  if (fx.also) assert.ok(REAL_STATUSES.has(fx.also.status), 'tile ' + tid + ' secondary status is real');
  assert.ok(typeof fx.cause === 'string' && fx.cause.startsWith('grav_'), 'tile ' + tid + ' cause is curated');
  if (!DELIBERATE_ELEMENT_CAUSES.has(fx.cause))
    assert.ok(!ELEMENT_TRAP.test(fx.cause), 'tile ' + tid + ' cause "' + fx.cause + '" smuggles a combat element');
}
// the user-specified identities
assert.equal(GG.GRAV_EFFECTS[T.GLASS].status, 'bleed', 'glass causes bleeding');
assert.equal(GG.GRAV_EFFECTS[T.LEAF].status, 'blind', 'leaves confuse (blind drops the aggro gate)');
assert.equal(GG.GRAV_EFFECTS[T.LEAF].also.status, 'panic', 'and send the target bolting');
assert.equal(GG.GRAV_EFFECTS[T.STONE].status, 'stun', 'stone staggers');
assert.equal(GG.GRAV_EFFECTS[T.METEORIC_IRON].cause, 'grav_blunt', 'meteoric iron does NOT read as an explosion');

// --- landing law -------------------------------------------------------------
assert.equal(GG.landingMode(T.GLASS, 3), 'shatter', 'glass always shatters');
assert.equal(GG.landingMode(T.GOLDEN_WOOD, 3), 'shatter', 'the golden trunk always pays out');
assert.equal(GG.landingMode(T.SNOW, 12), 'drift', 'snow joins the drift layer at any speed');
assert.equal(GG.landingMode(T.LEAF, 12), 'drift', 'leaves drift');
assert.equal(GG.landingMode(T.SAND, 12), 'drift', 'sand drifts');
assert.equal(GG.landingMode(T.RUBBER_WOOD, 12), 'bounce', 'rubber wood keeps the pistol geometry');
// the shatter threshold is anchored ABOVE the material's own muzzle speed: a
// flat throw survives and re-enters the world (the terraforming half of the
// gun), a gravity-fed plunge breaks. A global threshold under the muzzle range
// made settling dead code — measured live before this pin existed.
for (let t = 0; t < 200; t++) {
  if (!INFO[t] || !GG.canCarryTile(t).ok) continue;
  if (GG.driftMaterialFor(t) || t === T.RUBBER_WOOD || t === T.GOLDEN_WOOD || GG.landingMode(t, 0) === 'shatter') continue;
  assert.equal(GG.landingMode(t, GG.muzzleSpeed(t)), 'settle', 'a flat throw of tile ' + t + ' settles');
  assert.equal(GG.landingMode(t, GG.shatterSpeedFor(t) + 3), 'shatter', 'a plunging tile ' + t + ' shatters');
}
assert.equal(GG.landingMode(T.STONE, 5), 'settle', 'a slow stone re-enters the world');
assert.equal(GG.landingMode(T.STONE, 18), 'shatter', 'a plummeting stone breaks up');
for (const [tid, mat] of [[T.SNOW, 'snow'], [T.TOXIC_SNOW, 'snow'], [T.LEAF, 'leaves'], [T.SAND, 'sand']])
  assert.equal(GG.driftMaterialFor(tid), mat, 'drift material for tile ' + tid);
// every shatter payout key is a registered resource
const resourceKeys = new Set(INV.RESOURCES.map(r => r.key));
for (let t = 0; t < 200; t++) {
  if (!INFO[t] || !GG.canCarryTile(t).ok) continue;
  for (const p of GG.shatterPayout(t, () => 0.5))
    assert.ok(resourceKeys.has(p.key), 'tile ' + t + ' payout key ' + p.key + ' is a registered resource');
}
assert.deepEqual(GG.shatterPayout(T.GOLDEN_WOOD, () => 0.5), [{ key: 'wood', n: 10 }], 'golden wood pays the 10x rule');

// --- item model --------------------------------------------------------------
assert.deepEqual(INV.WEAPON_TYPE_STATS.gravity, ['attackDamage', 'fireRange', 'energyCost'],
  'gravity keeps reach + drain through sanitize; damage belongs to the MATERIAL');
assert.ok(INV.WEAPON_CATEGORIES.find(c => c.key === '4').types.includes('gravity'), 'the gun rotates in the slot-4 device category');
assert.ok(!INV.WEAPON_CATEGORIES.find(c => c.key === '3').types.includes('gravity'), 'it is NOT a ranged-slot weapon');
{
  const def = { id: 'probe_grav', kind: 'weapon', weaponType: 'gravity', name: 'Probe', attackDamage: 2, fireRange: 6, energyCost: 14, tier: 'epic' };
  assert.ok(INV.grantItem(def, { markNew: false }), 'a gravity item grants');
  const got = INV.getItem('probe_grav');
  for (const f of ['attackDamage', 'fireRange', 'energyCost'])
    assert.equal(got[f], def[f], 'stat ' + f + ' survives sanitizeLootItem');
  INV.discard('probe_grav');
}

// --- weapons.js state machine pins -------------------------------------------
assert.match(wSrc, /if\(type==='gravity'\) return gravityChannel\(player, aimX, aimY, w, dt\|\|0\.016\);/, 'LMB routes gravity to the channel');
assert.match(wSrc, /if\(type==='gravity'\)\{ return gravThrow\(player, aimX, aimY, w\); \}/, 'RMB throws');
{
  const ultBody = wSrc.slice(wSrc.indexOf('function fireUlt(player, aimX, aimY){'));
  assert.ok(ultBody.indexOf("if(type==='gravity'){ return gravThrow") < ultBody.indexOf('consumeUltCharge()'),
    'inside fireUlt the gravity branch precedes every consumeUltCharge() call (a throw never burns the ult)');
}
assert.match(wSrc, /if\(!grav\.heldTid\) return false; \/\/ empty hand -> hero defense fallback/, 'an empty hand keeps the -25% defense');
assert.match(wSrc, /if\(grav\.channel\)\{ grav\.channel=null; return false; \}/, 'lifting LMB abandons the channel, not the held block');
assert.match(wSrc, /grav\.channel=null;\n    return was;/, 'cancelHeld clears the channel (weapon switch, pointercancel)');
assert.match(wSrc, /grav\.channel=null; grav\.heldTid=0; grav\.throwAtMs=0;/, 'reset() clears every gravity register');
assert.match(wSrc, /gravActive:!!grav\.channel, gravRatio:gravChannelRatio\(\), gravHeld:grav\.heldTid\|0/, 'hudStatus feeds the HUD');
assert.match(wSrc, /const t=nowMs\(\);\n    if\(t<grav\.throwAtMs\) return true;/, 'the throw cooldown is wall-clock (update never runs on a hero guest)');
// world-write discipline: the weapon never touches a tile itself
assert.equal(/setTile\(/.test(gravSrc), false, 'the pure material module never writes a tile');
assert.match(wSrc, /MM\.gravityWorld/, 'weapons.js routes every world effect through the main.js seam');
assert.match(mainSrc, /MM\.gravityWorld=\{/, 'the seam object exists in main.js');
assert.match(mainSrc, /FALLING\.spawnLoose\(Math\.floor\(x\),Math\.floor\(y\),tid\|0\)/, 'a settling block goes through the falling chokepoint, not setTile');
assert.match(mainSrc, /SOFT_DRIFTS\.seedAround\(Math\.floor\(x\), 1, mat, 6, getTile, setTile\)/, 'soft matter joins the drift layer');
assert.match(mainSrc, /function stripForegroundForCarry\(tx,ty,tId\)\{/, 'extraction shares the mining removal lifecycle');
assert.match(mainSrc, /NOISE\.emit\(x,y,'decoy',1\)/, 'a landed meat block is a real decoy (predators investigate)');
// the coop projectile is world-inert: every landing write gates on !a.coopOwner
assert.match(wSrc, /if\(!a\.coopOwner\)\{\n      const W=gravityWorld\(\);\n      if\(W\)\{\n        if\(mode==='drift'\)/, 'guest blocks never write the world on landing');
// matter conservation: extraction awards nothing (no awardTileDrops in the seam)
{
  const seam = mainSrc.slice(mainSrc.indexOf('MM.gravityWorld={'), mainSrc.indexOf('function instantBreak('));
  assert.ok(!/awardTileDrops/.test(seam), 'extraction pays no yield — the block IS the payload');
}

// --- multiplayer contract pins -----------------------------------------------
const NET = await import('../src/engine/ghost_net.js');
assert.ok(NET.HERO_ACTIONS.includes('gvx') && NET.HERO_ACTIONS.includes('gvt'), 'both gravity intents are whitelisted');
assert.equal(NET.HERO_RULES.GRAV_EXTRACT_MS, 250, 'extract rate floor');
assert.equal(NET.HERO_RULES.GRAV_THROW_MS, 300, 'throw rate floor');
assert.match(clientSrc, /conn\.send\(\{ t: 'hact', a: 'gvx', x: tx, y: ty \}\)/, 'the extract intent names only a target cell');
assert.match(clientSrc, /conn\.send\(\{ t: 'hact', a: 'gvt', ax: \+Number\(ax\)\.toFixed\(3\), ay: \+Number\(ay\)\.toFixed\(3\) \}\)/,
  'the throw intent names ONLY a direction — no tile id, no velocity, no damage');
assert.equal(/gravTid/.test(clientSrc), false, 'the guest never names the carried tile id on the wire');
assert.match(hostSrc, /if\(!b\.gravTid\)\{ entry\.peer\.send\(\{ t: 'hact', a: 'gvt', ok: false, reason: 'empty' \}\); return; \}/,
  'the host refuses a throw from an empty hand');
assert.match(hostSrc, /b\.gravTid = res\.tid \| 0;/, 'the carried tile id is HOST body state');
assert.match(hostSrc, /b\.gravTid = 0; \/\/ a dead hand opens/, 'death opens the hand (transient, never serialized)');
assert.ok(!/gravTid/.test(hostSrc.slice(hostSrc.indexOf('function keepBody'), hostSrc.indexOf('function keepBody') + 1400)),
  'keepBody never serializes the carried block (the mech guestGid rule)');
assert.match(hostSrc, /pl\.a === 'place' \|\| pl\.a === 'gvx'\) && !guestTargetClear\(b, tx, ty\)/, 'extraction inherits the LOS/exposed-face gate');
assert.match(mainSrc, /ghostHeroGravExtract:\(tx,ty\)=>\{/, 'the extract bridge seam re-validates with the solo material law');
assert.match(mainSrc, /ghostHeroGravThrow:\(body,tid,dir,gid,duelGid\)=>\{/, 'the throw bridge seam exists');
assert.match(mainSrc, /\{coopOwner:true, ownerGid:gid, duelGid:duelGid\|\|null\}/, 'a guest block is coop-owned (world-inert)');
assert.match(wSrc, /if\(!GG\.canCarryTile\(tid\)\.ok\) return false;/, 'the projectile mint re-validates the material (defense in depth)');
assert.match(wSrc, /FX_BOUNCY=512, FX_GRAV=1024;/, 'the wfx plane carries the gravity flag');
assert.match(wSrc, /\|\(a\.grav\?FX_GRAV:0\),/, 'flying blocks encode onto the wire');
assert.match(wSrc, /grav:!!\(f&FX_GRAV\),/, 'watchers decode the tinted block');

// --- integration pins ---------------------------------------------------------
assert.match(mainSrc, /weaponType:'gravity',name:'Działko grawitacyjne',attackDamage:2,fireRange:6,energyCost:14,tier:'epic'/,
  'the recipe crafts the epic gravity gun');
assert.match(mainSrc, /const STREAM_SLOT_ICONS=\{flame:'🔥',hose:'💧',gas:'☠️',electric:'⚡',bouncy:'🔴',bouncyTar:'🟤',gravity:'🌀'\};/,
  'slot 4 knows the gravity icon');
assert.match(mainSrc, /else if\(k==='4' && slot\.el && slot\.el\.dataset\.streamKind==='gravity'\)\{/,
  'the slot-4 gauge shows RIP progress and never the lying ult meter');
assert.match(mainSrc, /function gravityTileLabel\(tid\)\{/, 'the HUD can name a carried block');
const forgeSrc = readFileSync(new URL('../src/engine/gear_forge.js', import.meta.url), 'utf8');
assert.match(forgeSrc, /lit_gravity_gun/, 'the developer armoury can mint the gun');
const discoverySrc = readFileSync(new URL('../src/engine/discovery.js', import.meta.url), 'utf8');
for (const id of ['grav_bedrock', 'grav_golden', 'grav_bait', 'grav_feed'])
  assert.ok(discoverySrc.includes(id + ':'), 'discovery catalog carries ' + id);

// --- the thrown block is a BLOCK, at block size --------------------------------
// Its damage, its landing and its extraction all speak of one whole tile; drawing
// it at a fraction of one made the gun read as a slingshot. All three states of a
// carried block — held at the muzzle, in flight, settled — are one tile wide.
assert.match(wSrc, /const s=TILE;\n {10}ctx\.save\(\);\n {10}ctx\.translate\(px,py\);/,
  'the flying block draws at exactly one tile');
assert.ok(!/const s=TILE\*0\.62;/.test(wSrc), 'the miniaturised 0.62-tile flying block is gone');
assert.match(wSrc, /const s=TILE;\n {10}const off=TILE\*0\.9;/,
  'the held block matches it, with a stand-off measured from the hero rather than scaled off s');
assert.ok(!/const s=TILE\*0\.5;\n {10}const hover/.test(wSrc), 'the half-tile held block is gone');
const bossSrcFlight = readFileSync(new URL('../src/engine/bosses.js', import.meta.url), 'utf8');
assert.ok(!/const s=TILE\*0\.7;/.test(bossSrcFlight), 'a boss-hurled block is no longer a 0.7-tile pebble');
const volcanoSrcFlight = readFileSync(new URL('../src/engine/volcano.js', import.meta.url), 'utf8');
assert.ok(!/ctx\.fillRect\(-TILE\*0\.24,-TILE\*0\.21,TILE\*0\.48,TILE\*0\.42\);/.test(volcanoSrcFlight),
  'a volcanic bomb is no longer a third of the size of the hitbox that strikes you');
assert.match(volcanoSrcFlight, /ctx\.fillRect\(-TILE\*0\.5,-TILE\*0\.44,TILE,TILE\*0\.88\);/,
  'the volcanic bomb spans a full tile');

// --- feeding the block boss ----------------------------------------------------
// The gun's damage never reaches a creature built of blocks: the material identity
// rides the impact opts, and the absorbed answer short-circuits the whole chain
// BEFORE resolveGravityImpactOnCreature, which would otherwise pay mining drops
// for a block that just became boss flesh.
assert.match(wSrc, /grav:!!a\.grav, gravTid:a\.gravTid\|0,/,
  'the impact opts carry the material of the hurled block');
const iAbsorb = wSrc.indexOf("roamingBossResult==='absorbed'");
const iPierce = wSrc.indexOf("roamingBossResult==='pierced'");
const iGravRes = wSrc.indexOf('resolveGravityImpactOnCreature(a,tx,ty,getTile,setTile);');
assert.ok(iAbsorb > 0 && iPierce > 0 && iGravRes > 0, 'the absorbed branch exists alongside pierce and payout');
assert.ok(iAbsorb < iPierce && iAbsorb < iGravRes,
  'an absorbed block leaves before the pierce, blocked and creature-hit chains can pay it out twice');
const bossAbsorbSrc = bossSrcFlight;
assert.match(bossAbsorbSrc, /function gravityFeedTile\(opts\)\{/, 'the boss reads the block marker off the opts');
assert.match(bossAbsorbSrc, /if\(!opts \|\| opts\.grav!==true\) return 0;/,
  'only a genuine hurled block feeds the beast — never a look-alike opts bag');
assert.match(bossAbsorbSrc, /const fed=gravityFeedTile\(opts\);\n    if\(fed && absorbThrownBlock\(m,part,fed\)\) return 'absorbed';/,
  'absorption is resolved before the anchor report and the feed interruption');

console.log('gravity-gun-sim: all assertions passed (55 carryable materials, '
  + Object.keys(GG.GRAV_EFFECTS).length + ' status identities)');
