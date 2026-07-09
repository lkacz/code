// Vitals HUD model regression: the bottom-left status cluster's feel is a
// contract — damage chips linger then drain, heals shimmer, low HP pulses,
// floating numbers merge rapid hits, level-ups burst, buff rings track their
// longest seen duration. Renderer is exercised separately by
// tools/vitals-hud-qa.mjs (CDP screenshots); this covers the state machine.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
const { createVitalsModel } = await import('../src/engine/vitals_hud.js');
const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const vitalsSource = readFileSync(new URL('../src/engine/vitals_hud.js', import.meta.url), 'utf8');
const weaponsSource = readFileSync(new URL('../src/engine/weapons.js', import.meta.url), 'utf8');

const DT = 1 / 60;
const base = { hp: 100, maxHp: 100, en: 40, enMax: 112, level: 10, xpInto: 979, xpNeed: 1343, buffs: [] };
const inp = (over) => Object.assign({}, base, over);
function run(m, input, seconds){
	let st;
	for (let t = 0; t < seconds; t += DT) st = m.update(input, DT);
	return st;
}

// --- 1. first sample snaps, no intro tween, no ghost numbers
{
	const m = createVitalsModel();
	const st = m.update(inp(), DT);
	assert.equal(st.hp.fill, 1, 'first sample snaps HP fill');
	assert.equal(st.en.fill, 40 / 112, 'first sample snaps EN fill');
	assert.equal(st.deltas.length, 0, 'boot does not spawn damage numbers');
	assert.equal(st.xp.lvlBurst, 0, 'boot does not fire a level-up burst');
}

// --- 2. damage: chip freezes at pre-hit fill, holds, then drains to the fill
{
	const m = createVitalsModel();
	m.update(inp(), DT);
	let st = m.update(inp({ hp: 60 }), DT);
	assert.ok(st.hp.chip > 0.99, 'chip stays at the pre-hit level right after damage');
	assert.ok(st.hp.fill < 0.95, 'fill starts dropping immediately');
	assert.equal(st.deltas.length, 1, 'hit spawns one floating number');
	assert.equal(Math.round(st.deltas[0].v), -40, 'floating number carries the damage amount');
	st = run(m, inp({ hp: 60 }), 0.25);
	assert.ok(st.hp.chip > st.hp.fill + 0.05, 'chip still lingers during the hold window');
	st = run(m, inp({ hp: 60 }), 2.0);
	assert.ok(st.hp.chip - st.hp.fill < 0.01, 'chip drains down to the live fill');
	assert.ok(Math.abs(st.hp.fill - 0.6) < 0.01, 'fill converges on the true fraction');
	assert.equal(st.deltas.length, 0, 'floating numbers age out');
}

// --- 3. rapid hits merge into one floating number
{
	const m = createVitalsModel();
	m.update(inp(), DT);
	m.update(inp({ hp: 90 }), DT);
	run(m, inp({ hp: 90 }), 0.1);
	const st = m.update(inp({ hp: 78 }), DT);
	assert.equal(st.deltas.length, 1, 'rapid same-sign hits merge');
	assert.equal(Math.round(st.deltas[0].v), -22, 'merged number sums the hits');
}

// --- 4. heal: shimmer fires, fill rises smoothly, number is positive
{
	const m = createVitalsModel();
	m.update(inp({ hp: 50 }), DT);
	let st = m.update(inp({ hp: 90 }), DT);
	assert.ok(st.hp.shimmer > 0.9, 'heal triggers the shimmer sweep');
	assert.ok(st.hp.fill < 0.85, 'heal fill animates instead of snapping');
	assert.equal(Math.round(st.deltas[0].v), 40, 'heal spawns a positive number');
	st = run(m, inp({ hp: 90 }), 1.5);
	assert.ok(Math.abs(st.hp.fill - 0.9) < 0.01, 'heal fill converges');
	assert.equal(st.hp.shimmer, 0, 'shimmer decays fully');
}

// --- 5. low-HP heartbeat only below the threshold, faster when lower
{
	const m = createVitalsModel();
	m.update(inp({ hp: 40 }), DT);
	let st = run(m, inp({ hp: 40 }), 0.5);
	assert.equal(st.hp.low, false, '40% HP is not low');
	assert.equal(st.hp.lowPulse, 0, 'no pulse above threshold');
	st = run(m, inp({ hp: 20 }), 0.5);
	assert.equal(st.hp.low, true, '20% HP is low');
	assert.ok(st.hp.lowPulse > 0, 'pulse phase advances when low');
	const m2 = createVitalsModel();
	m2.update(inp({ hp: 0 }), DT);
	const dead = run(m2, inp({ hp: 0 }), 0.3);
	assert.equal(dead.hp.low, false, 'dead (0 HP) does not heartbeat');
}

// --- 6. slow healing: fractional house-heal ticks accumulate into green numbers
{
	const m = createVitalsModel();
	let hp = 70, st = m.update(inp({ hp }), DT);
	for (let t = 0; t < 1.0; t += DT){ hp += 0.5 * DT; st = m.update(inp({ hp }), DT); }
	assert.equal(st.deltas.length, 0, 'sub-1 HP slow healing waits instead of flashing +0');
	for (let t = 0; t < 1.2; t += DT){ hp += 0.5 * DT; st = m.update(inp({ hp }), DT); }
	assert.equal(st.deltas.length, 1, 'slow house-style healing emits once enough HP is restored');
	assert.equal(Math.round(st.deltas[0].v), 1, 'slow healing number reports the accumulated restored HP');
}

// --- 7. energy: spend chip, charging flag on regen, full flag at cap
{
	const m = createVitalsModel();
	m.update(inp({ en: 80 }), DT);
	let st = m.update(inp({ en: 30 }), DT);
	assert.ok(st.en.chip > st.en.fill + 0.05, 'energy spend leaves a chip ghost');
	assert.equal(st.en.charging, false, 'spending is not charging');
	st = run(m, inp({ en: 30 }), 1.0);
	let en = 30;
	for (let t = 0; t < 0.5; t += DT) { en += 20 * DT; st = m.update(inp({ en }), DT); }
	assert.equal(st.en.charging, true, 'rising energy sets the charging flag');
	st = run(m, inp({ en: 112 }), 1.5);
	assert.equal(st.en.full, true, 'cap sets the full flag');
	assert.equal(st.en.charging, false, 'steady full energy stops charging');
}

// --- 8. level-up: burst fires once, XP bar wraps to zero then refills
{
	const m = createVitalsModel();
	m.update(inp({ level: 10, xpInto: 1300, xpNeed: 1343 }), DT);
	run(m, inp({ level: 10, xpInto: 1300, xpNeed: 1343 }), 0.5);
	let st = m.update(inp({ level: 11, xpInto: 20, xpNeed: 1600 }), DT);
	assert.ok(st.xp.lvlBurst > 0.9, 'level-up fires the badge burst');
	assert.ok(st.xp.fill < 0.05, 'XP bar wraps to zero on level-up');
	st = run(m, inp({ level: 11, xpInto: 800, xpNeed: 1600 }), 1.5);
	assert.equal(st.xp.lvlBurst, 0, 'burst decays');
	assert.ok(Math.abs(st.xp.fill - 0.5) < 0.02, 'XP bar refills toward the new fraction');
}

// --- 9. buff rings: frac tracks longest seen duration, expiring flag, pruning
{
	const m = createVitalsModel();
	m.update(inp({ buffs: [{ name: 'Moc', icon: '✦', t: 60 }] }), DT);
	let st = m.update(inp({ buffs: [{ name: 'Moc', icon: '✦', t: 30 }] }), DT);
	assert.ok(Math.abs(st.buffs[0].frac - 0.5) < 0.01, 'ring fraction = remaining / longest seen');
	assert.equal(st.buffs[0].expiring, false, '30s is not expiring');
	st = m.update(inp({ buffs: [{ name: 'Moc', icon: '✦', t: 8 }] }), DT);
	assert.equal(st.buffs[0].expiring, true, 'under 10s flips to expiring');
	st = m.update(inp({ buffs: [] }), DT);
	assert.equal(st.buffs.length, 0, 'expired buffs drop out');
	st = m.update(inp({ buffs: [{ name: 'Moc', icon: '✦', t: 20 }] }), DT);
	assert.ok(Math.abs(st.buffs[0].frac - 1) < 0.01, 're-applied buff gets a fresh ring, not the stale max');
}

// --- 10. ambient trickle drains must not freeze the chip ghost (survival cold,
// beam upkeep etc. drain every frame; only discrete hits refresh the hold)
{
	const m = createVitalsModel();
	m.update(inp({ hp: 100, en: 112 }), DT);
	let hp = 100, en = 112, st;
	for (let t = 0; t < 2; t += DT){ hp -= 3 * DT; en -= 8 * DT; st = m.update(inp({ hp, en }), DT); }
	assert.ok(st.hp.chip - st.hp.fill < 0.05, 'slow HP drain: chip hugs the fill');
	assert.ok(st.en.chip - st.en.fill < 0.05, 'ambient energy drain: chip hugs the fill');
}

// --- 11. degenerate inputs stay finite
{
	const m = createVitalsModel();
	const st = m.update({ hp: 5, maxHp: 0, en: 3, enMax: 0, level: 1, xpInto: 0, xpNeed: 0, buffs: null }, DT);
	assert.equal(st.hp.fill, 0, 'zero maxHp maps to empty, not NaN');
	assert.equal(st.en.fill, 0, 'zero enMax maps to empty, not NaN');
	assert.equal(st.xp.fill, 0, 'zero xpNeed maps to empty, not NaN');
	const st2 = m.update(inp({ hp: 50 }), 999);
	assert.ok(isFinite(st2.hp.fill) && st2.hp.fill >= 0 && st2.hp.fill <= 1, 'huge dt is clamped');
}

// --- 12. concrete combat numbers render in-world above the entity, not on bars
{
	const drawSource = vitalsSource.slice(vitalsSource.indexOf('function draw('));
	assert.ok(!/s\.(?:deltas|xpDeltas)/.test(drawSource), 'vitals renderer no longer draws damage/heal/XP numbers above HUD bars');
	assert.match(mainSource, /const worldNumbers=\[\]/, 'main owns the world-space combat number queue');
	assert.match(mainSource, /if\(kind!=='damage' && kind!=='heal' && kind!=='xp' && kind!=='energy' && kind!=='home'\) return null;/, 'floating world numbers are allowlisted to hero damage, hero heal, energy, XP, and icon-only home feedback');
	assert.match(mainSource, /let text=kind==='home' \? '' : \(detail\.text!=null \? String\(detail\.text\) : ''\);/, 'home feedback cannot add another text bubble');
	assert.match(mainSource, /function noteHeroEnergyDelta\(delta,opts\)[\s\S]*heroEnergyDeltaAcc\+=n[\s\S]*pushWorldNumber\(\{[\s\S]*kind:'energy'[\s\S]*target:'hero:energy'/, 'hero energy gains and spends are aggregated into compact world-space numbers');
	assert.match(mainSource, /window\.addEventListener\('mm-entity-number'[\s\S]*target==='hero'[\s\S]*target\.indexOf\('hero:'\)===0[\s\S]*kind==='damage' \|\| kind==='heal'/, 'entity-number events are filtered to hero damage/heal only');
	assert.match(mainSource, /window\.addEventListener\('mm-xp-awarded'/, 'mob XP awards are routed to the world-space renderer');
	assert.match(mainSource, /window\.addEventListener\('mm-combat-event'/, 'important combat events are routed to the world-space impact renderer');
	assert.match(mainSource, /function drawCombatImpactFx\(\)/, 'main draws important hit rings in the world scene');
	assert.match(mainSource, /heroBodyRecoilFx/, 'important combat events can physically recoil the hero body');
	assert.match(mainSource, /function combatScreenShakeOffset\(/, 'important combat events can add a short local screen shake');
	assert.match(mainSource, /function drawCombatScreenFx\(\)[\s\S]*heroCriticalHurtFx/, 'major hero hits get a screen-space danger flash');
	assert.doesNotMatch(mainSource, /combatEventToken|target:'combat:'|target:"combat:"/, 'combat events do not create extra floating text over hit effects');
	assert.match(mainSource, /else if\(n\.kind==='xp'\) color=n\.special \? '#ffd54a' : '#7dff9a'/, 'special XP bonus is shown by XP color, not by a second bubble');
	assert.match(mainSource, /else if\(n\.kind==='energy'\) color='#ffd66b'/, 'energy gain and spend numbers use their own readable color');
	assert.match(mainSource, /function drawWorldNumberIcon\([\s\S]*icon==='water'[\s\S]*icon==='xp'/, 'allowed floating numbers can carry compact cause/resource icons');
	assert.doesNotMatch(mainSource, /LUCKY x4!|LUCKY FINISH!|POWER FINISH|FINISH!|DROWN!|SHOCKED!|HARD HIT!/, 'large combat billboard words are not used for world feedback');
	assert.doesNotMatch(weaponsSource, /LUCKY x4!|mm-entity-number[\s\S]{0,160}lucky/, 'lucky strikes do not emit a text bubble from weapons');
	assert.match(mainSource, /if\(fx\.finisher\)[\s\S]*finishR[\s\S]*rgba\(255,229,92/, 'finisher hits draw a dedicated golden reward ring');
	assert.match(mainSource, /ctx\.strokeStyle='rgba\(4,6,10,0\.46\)'/, 'world number outline is softened so it does not dominate combat feedback');
	assert.match(mainSource, /mm-skill-point-gained[\s\S]*triggerHeroBodyRecoil\('strike'[\s\S]*spawnSparks/, 'new skill points add a small physical celebration around the hero');
	assert.match(mainSource, /drawWorldNumbers\(\);/, 'world-space combat numbers are drawn in the main scene');
}

console.log('vitals-hud-sim: all assertions passed');
