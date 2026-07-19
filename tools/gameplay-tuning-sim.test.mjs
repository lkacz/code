// Gameplay-tuning wave regressions (2026-07-19, owner's 13-point review):
//   * seasons: worlds wake in SUMMER (calendar offset) while day counters stay
//     elapsed-based; autumn flurries softened
//   * hero_lamp: stronger base beam + the halogen upgrade tier
//   * antennas: echo sonar reaches a USEFUL radius (>=20 tiles at common)
//   * weapons: throwing-rock material ladder (any stone type), per-tier damage
//     and survival pickups; merge-forged weapon perks (MERGE_PERKS)
//   * inventory: pickaxe gear kind (slot, sanitize, chips), weapon fusion
//     (mergeWeapons chance ladder + forge/failure contracts)
//   * chests: pickaxes drop from chests with perk identities
//   * invasions: molekin rocks survive as pickups (covered in invasions-sim:
//     charge 0.5-1 s, beam-line damage, hardness ladder)
//   * main.js source pins: starter kit, slot icons, pick perks, vein chain,
//     twilight-smooth daylight, side-mounted signal-only treasure compass
// Run: node tools/gameplay-tuning-sim.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis;
globalThis.MM = {};

const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(here, '..', p), 'utf8');

// ============================================================================
// 1) seasons: summer start, unshifted day counters, softened autumn
// ============================================================================
{
  const { seasons } = await import('../src/engine/seasons.js');
  seasons.reset();
  const m = seasons.metrics();
  assert.equal(m.season, 'summer', 'a fresh world wakes in summer');
  assert.equal(m.day, 1, 'the day counter still starts at 1 (invasion pacing unshifted)');
  assert.ok(m.calendarDayFloat > m.dayFloat, 'the calendar rides ahead of elapsed days');
  const autumn = seasons._debug.stateAtDays(25).profile;
  assert.ok(autumn.snowStrength <= 0.1, 'autumn flurries are a hint, not winter (' + autumn.snowStrength + ')');
  assert.ok(autumn.freezeStrength <= 0.03, 'autumn barely freezes — winter owns the frost');
  assert.ok(seasons._debug.stateAtDays(35).profile.freezeStrength > 0.9, 'winter still freezes hard');
  // ~19 elapsed days of summer+autumn before the first winter day
  seasons.restore({v:2, elapsedSeconds: 17 * seasons.constants.DAY_SECONDS, scanCursor: 0});
  assert.notEqual(seasons.metrics().season, 'winter', 'day 18 is still pre-winter');
  seasons.restore({v:2, elapsedSeconds: 20 * seasons.constants.DAY_SECONDS, scanCursor: 0});
  assert.equal(seasons.metrics().season, 'winter', 'winter arrives about three warm weeks in');
  // advanceDays is RELATIVE elapsed time — the calendar offset must not leak in
  // (routing through the calendar-day setDay would jump the clock backwards)
  seasons.reset();
  const d0 = seasons.metrics().dayFloat;
  assert.equal(seasons.advanceDays(2), true, 'advanceDays accepts a relative jump');
  assert.ok(Math.abs(seasons.metrics().dayFloat - (d0 + 2)) < 0.01,
    'advancing 2 days moves the elapsed clock exactly 2 days forward (' + seasons.metrics().dayFloat + ')');
  seasons.reset();
  console.log('scenario 1 (summer start) ok');
}

// ============================================================================
// 2) hero lamp: stronger base + halogen tier
// ============================================================================
{
  const { createHeroLampModel } = await import('../src/engine/hero_lamp.js');
  const lamp = createHeroLampModel();
  const base = lamp.info();
  assert.ok(base.range >= 13, 'the starter eye lamp reaches farther than the old 11 (' + base.range + ')');
  assert.equal(base.tier, 0, 'the lamp boots on the standard tier');
  assert.equal(lamp.setTier(1), true, 'owning a halogen bulb upgrades the lamp');
  const hal = lamp.info();
  assert.ok(hal.range > base.range, 'halogen throws farther (' + hal.range + ')');
  assert.ok(hal.drainPerSecond > base.drainPerSecond, 'the brighter bulb costs more energy');
  const t = lamp.tierInfo();
  assert.equal(t.id, 'halogen', 'tierInfo names the active bulb');
  lamp.setTier(0);
  assert.equal(lamp.info().range, base.range, 'downgrading restores the standard beam');
  assert.match(src('src/main.js'), /HERO_LAMP\.setTier\(\(inv\.halogen\|0\)>0\?1:0\);/, 'main reconciles halogen ownership into the lamp tier');
  assert.match(src('src/main.js'), /id:'halogen_bulb'/, 'the halogen bulb is craftable');
  console.log('scenario 2 (hero lamp tiers) ok');
}

// ============================================================================
// 3) antennas: echo sonar reaches a useful radius
// ============================================================================
{
  const { antennas } = await import('../src/engine/antennas.js');
  assert.ok(antennas.echoRangeFor('common') >= 20, 'even the common echo ping covers >=20 tiles (' + antennas.echoRangeFor('common') + ')');
  assert.ok(antennas.echoRangeFor('legendary') >= 30, 'the legendary ping is a real sweep');
  console.log('scenario 3 (echo range) ok');
}

// ============================================================================
// 4) weapons: throwing-rock ladder + merge perks
// ============================================================================
{
  globalThis.inv = { throwingStone: 3, throwingStoneGranite: 0, throwingStoneBasalt: 2, throwingStoneObsidian: 0, throwingStoneDiamond: 0 };
  MM.TILE = 20;
  const { weapons } = await import('../src/engine/weapons.js');
  const info = weapons.stoneInfo();
  assert.equal(info.tiers.length, 5, 'five rock materials knap into throwing stones');
  const ids = info.tiers.map(t => t.id);
  assert.deepEqual(ids, ['stone', 'granite', 'basalt', 'obsidian', 'diamond'], 'the material ladder order is pinned');
  for(let i = 1; i < info.tiers.length; i++){
    assert.ok(info.tiers[i].dmg > info.tiers[i-1].dmg, 'harder rock hits harder (' + info.tiers[i].id + ')');
    assert.ok(info.tiers[i].surviveChance > info.tiers[i-1].surviveChance, 'harder rock survives impacts more often');
  }
  assert.equal(info.active.id, 'basalt', 'the best OWNED tier is the active one');
  const hud = weapons.thrownInfo('stone');
  assert.equal(hud.key, 'throwingStoneBasalt', 'the ranged-slot readout counts the active tier ammo');
  assert.equal(hud.count, 2, 'the readout shows the tier count');
  // survival pickups flow through the drops plane on the rock splat
  const dropped = [];
  MM.drops = { spawnResource: (x, y, key, qty) => { dropped.push({ key, qty }); return { id: 1 }; } };
  MM.particles = { spawnImpactChips(){} };
  weapons._debug.splatProjectile({ splat: 'rock', stoneKey: 'throwingStoneDiamond', stoneSurvive: 1, x: 5, y: 5 }, null, null);
  assert.deepEqual(dropped, [{ key: 'throwingStoneDiamond', qty: 1 }], 'a surviving rock lies down as a pickup of ITS material');
  dropped.length = 0;
  weapons._debug.splatProjectile({ splat: 'rock', stoneKey: 'throwingStone', stoneSurvive: 0, x: 5, y: 5 }, null, null);
  assert.equal(dropped.length, 0, 'a shattered rock leaves nothing');
  // merge perks: identity on the item, numbers here; the roll heals/afflicts
  const statuses = [];
  MM.mobs = { statusAt: (tx, ty, status, opts) => { statuses.push(status); return true; }, damageAt: () => true };
  globalThis.player = { hp: 10, maxHp: 40 };
  const wsrc = src('src/engine/weapons.js');
  assert.match(wsrc, /const MERGE_PERKS=\{/, 'the merge-perk number table exists');
  for(const perk of ['vampire', 'venom', 'frost', 'storm', 'fury'])
    assert.match(wsrc, new RegExp(perk + ':\\s*\\{chance:'), 'merge perk registered: ' + perk);
  assert.match(wsrc, /if\(a\.mergePerk && !a\.coopOwner\) applyMergePerkAt\(a\.mergePerk,tx,ty,hitDmg\);/, 'projectile creature hits roll the merge perk');
  assert.match(wsrc, /rollMergePerk\(w,tx,ty,2\+bonus,\{chanceMult:water\.effectMult\}\);/, 'plain melee hits roll the merge perk');
  console.log('scenario 4 (rock ladder + merge perks) ok');
}

// ============================================================================
// 5) inventory: pickaxe kind + weapon fusion model
// ============================================================================
{
  globalThis.localStorage = globalThis.localStorage || {
    _m: new Map(),
    getItem(k){ return this._m.has(k) ? this._m.get(k) : null; },
    setItem(k, v){ this._m.set(k, String(v)); },
    removeItem(k){ this._m.delete(k); },
    key(i){ return [...this._m.keys()][i] ?? null; },
    get length(){ return this._m.size; }
  };
  const { inventory } = await import('../src/inventory.js');
  const INV = inventory || MM.inventory;
  assert.ok(INV.SLOTS.some(s => s.accepts === 'pickaxe'), 'the equipment has a pickaxe slot');
  assert.equal(INV.KIND_LABELS.pickaxe, 'Kilofy', 'the pickaxe tab is labeled');
  assert.deepEqual(INV.KIND_STAT_PRIORITY.pickaxe, ['mineSpeedMult'], 'a pickaxe carries exactly its one mining stat');
  // sanitize (via the grant ingest): perk survives on a pickaxe, dies elsewhere
  assert.ok(INV.grantItem({ id: 'p1', kind: 'pickaxe', name: 'Kilof', mineSpeedMult: 1.25, pickPerk: 'lucky', attackDamage: 9 }), 'pickaxe grant ingests');
  const cleanPick = INV.getItem('p1');
  assert.equal(cleanPick.pickPerk, 'lucky', 'pickPerk identity survives sanitize');
  assert.equal(cleanPick.attackDamage, undefined, 'a pickaxe cannot smuggle weapon damage');
  INV.grantItem({ id: 'c1', kind: 'charm', mineSpeedMult: 1.1, pickPerk: 'lucky' });
  assert.equal(INV.getItem('c1').pickPerk, undefined, 'pickPerk on a non-pickaxe is dropped');
  INV.grantItem({ id: 'p2', kind: 'pickaxe', mineSpeedMult: 1.1, pickPerk: 'hax' });
  assert.equal(INV.getItem('p2').pickPerk, undefined, 'unknown perks are refused');
  // equipping a pickaxe multiplies mining speed on the shared modifier bus
  assert.ok(INV.grantItem({ id: 'pick_test', kind: 'pickaxe', name: 'Kilof testowy', mineSpeedMult: 1.5, pickPerk: 'double', tier: 'rare' }), 'a pickaxe can be granted');
  const before = MM.activeModifiers.mineSpeedMult;
  assert.ok(INV.equip('pick_test'), 'the pickaxe equips into its slot');
  assert.ok(MM.activeModifiers.mineSpeedMult > before, 'an equipped pickaxe speeds up mining (' + MM.activeModifiers.mineSpeedMult + ')');
  assert.equal(INV.equippedItem('pickaxe').pickPerk, 'double', 'the equipped perk identity is readable for main.js');
  // fusion chance ladder
  assert.equal(INV.mergeChance(1), 0, 'one weapon is no fusion');
  assert.equal(INV.mergeChance(2), 0.5, 'two weapons = the 50% wager');
  assert.equal(INV.mergeChance(4), 0.8, 'each extra ingredient adds 15%');
  assert.equal(INV.mergeChance(9), 0.95, 'the ladder caps at 95%');
  // forge contract: deterministic rand, success mints ONE upgraded weapon
  INV.grantItem({ id: 'mw1', kind: 'weapon', weaponType: 'melee', name: 'Ostrze A', attackDamage: 6, tier: 'rare' });
  INV.grantItem({ id: 'mw2', kind: 'weapon', weaponType: 'melee', name: 'Ostrze B', attackDamage: 4, fireRange: 3, tier: 'common' });
  INV.grantItem({ id: 'mw3', kind: 'weapon', weaponType: 'bow', name: 'Łuk C', attackDamage: 5, fireCooldown: 0.5, tier: 'common' });
  const seq = [0.01, 0.0]; // roll under chance => success; perk index 0
  const res = INV.mergeWeapons(['mw1', 'mw2', 'mw3'], { rand: () => (seq.length ? seq.shift() : 0.3) });
  assert.equal(res.ok && res.success, true, 'the wager can succeed');
  assert.equal(res.consumed, 3, 'all three ingredients went into the crucible');
  const forged = res.item;
  assert.ok(forged && forged.kind === 'weapon' && forged.weaponType === 'melee', 'the strongest ingredient set the class');
  assert.equal(forged.tier, 'epic', 'the forge bumps the tier one step');
  assert.ok(forged.attackDamage >= 7, 'best-of stats plus the forge heat (' + forged.attackDamage + ')');
  assert.equal(forged.fireRange, 3, 'same-class secondary stats keep their best value');
  assert.ok(INV.MERGE_PERK_LABELS[forged.mergePerk], 'the forged weapon carries a whitelisted unique perk');
  for(const id of ['mw1', 'mw2', 'mw3']) assert.equal(INV.getItem(id), null, 'ingredient consumed: ' + id);
  // failure consumes everything and mints nothing
  INV.grantItem({ id: 'mw4', kind: 'weapon', weaponType: 'melee', name: 'Ostrze D', attackDamage: 3 });
  INV.grantItem({ id: 'mw5', kind: 'weapon', weaponType: 'melee', name: 'Ostrze E', attackDamage: 3 });
  const bagBefore = INV.bagItems().length;
  const fail = INV.mergeWeapons(['mw4', 'mw5'], { rand: () => 0.99 });
  assert.equal(fail.ok && !fail.success, true, 'the wager can fail');
  assert.equal(INV.bagItems().length, bagBefore - 2, 'failure leaves only ashes');
  assert.equal(INV.mergeWeapons(['mw4'], { rand: () => 0 }).ok, false, 'fusion needs at least two ingredients');
  console.log('scenario 5 (pickaxe kind + fusion) ok');
}

// ============================================================================
// 6) chests: pickaxes drop with perks
// ============================================================================
{
  const { chests } = await import('../src/engine/chests.js');
  assert.ok(chests && typeof chests.genItem === 'function', 'chests expose the item generator');
  let s = 7;
  const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s >>> 8) / 0xFFFFFF; };
  const pick = chests.genItem(r, 'epic', { kind: 'pickaxe', profile: 'vein' });
  assert.equal(pick.kind, 'pickaxe', 'chests can roll a pickaxe');
  assert.ok(pick.mineSpeedMult > 1, 'the head carries a mining-speed roll');
  assert.equal(pick.pickPerk, 'vein', 'the requested perk profile lands on the item');
  assert.ok(pick.name.startsWith('Kilof'), 'the pickaxe uses its own name base');
  let sawPerk = false;
  for(let i = 0; i < 40; i++){ const p = chests.genItem(r, 'legendary', { kind: 'pickaxe' }); if(p.pickPerk) sawPerk = true; }
  assert.ok(sawPerk, 'high-tier pickaxes roll perks');
  console.log('scenario 6 (chest pickaxes) ok');
}

// ============================================================================
// 7) main.js + index.html integration pins
// ============================================================================
{
  const mainSrc = src('src/main.js');
  const html = src('index.html');
  // starter kit
  assert.match(mainSrc, /MM\.inventory\.equip\('stick'\)/, 'a fresh hero wakes holding the stick');
  assert.match(mainSrc, /inv\.sand=Math\.max\(inv\.sand\|0,20\);/, 'a fresh hero carries sand for the blinding throw');
  assert.match(mainSrc, /inv\.water=Math\.max\(inv\.water\|0,10\);/, 'a fresh hero carries water for spit');
  // slot icons: generic intent, not one weapon; slot 4 follows the selection
  assert.ok(html.includes('data-wkey="2"><span class="key">2</span><span class="wcyc"></span><span class="wicon">👊</span>'), 'slot 2 reads as DIRECT attack');
  assert.ok(html.includes('data-wkey="3"><span class="key">3</span><span class="wcyc"></span><span class="wicon">🎯</span>'), 'slot 3 reads as AIMED attack');
  assert.match(mainSrc, /const STREAM_SLOT_ICONS=\{flame:'🔥',hose:'💧',gas:'☠️',electric:'⚡'\};/, 'slot 4 icon table is pinned');
  assert.match(mainSrc, /slot\.icon\.textContent=STREAM_SLOT_ICONS\[kind\]\|\|'🔥';/, 'slot 4 icon follows the selected stream weapon');
  // pickaxe perks wired into the mining chokepoints
  assert.match(mainSrc, /const PICK_PERKS=\{lucky:\{chance:0\.10\}, double:\{chance:0\.25\}, vein:\{chance:0\.25\}\};/, 'pick perk numbers are pinned');
  assert.match(mainSrc, /function maybeChainVeinBreak\(tId\)/, 'the vein chain exists');
  assert.match(mainSrc, /if\(breakMinedTile\(\)\) spawnBurst/, 'the vein chain routes through the ONE break chokepoint');
  assert.match(mainSrc, /equippedPickPerk\(\)==='lucky'/, 'the lucky roll arms per targeted block');
  assert.match(mainSrc, /equippedPickPerk\(\)==='double'/, 'the double-yield roll sits at the drop grant');
  // smooth day/night: the twilight shoulder eases the arc into the night level
  assert.match(mainSrc, /const k=edge\*edge\*\(3-2\*edge\); \/\/ smoothstep into full daylight/, 'daylight has no cliff at dawn/dusk');
  assert.match(mainSrc, /return night\+\(Math\.max\(arc,night\)-night\)\*k;/, 'sunset eases into moonlight instead of snapping');
  // treasure compass: side-mounted, signal-only
  assert.match(mainSrc, /let compassShowK=0/, 'the compass card eases in and out');
  assert.match(mainSrc, /const wanted=level>0 && \(!!target \|\| now<radarFlash\);/, 'the compass shows only on a real signal (or an explicit radar ask)');
  // throwing stone recipes for every material + halogen
  for(const id of ['throwing_stones_granite', 'throwing_stones_basalt', 'throwing_stones_obsidian', 'throwing_stones_diamond'])
    assert.ok(mainSrc.includes("id:'" + id + "'"), 'recipe exists: ' + id);
  // molekin rocks can survive as pickups
  const invSrc = src('src/engine/invasions.js');
  assert.match(invSrc, /function maybeDropMoleRock\(s\)/, 'molekin clods roll survival');
  assert.match(invSrc, /spawnResource\(s\.x,s\.y-0\.2,'throwingStone',1,\{source:'mole_rock'/, 'a surviving clod is an ordinary throwing stone');
  console.log('scenario 7 (integration pins) ok');
}

console.log('gameplay-tuning-sim: all assertions passed');
