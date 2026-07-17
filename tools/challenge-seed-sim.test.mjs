// Challenge-seed regressions (engine/challenge.js + the boot wiring):
// the pure parser/link round-trip, the curated modifier table's derived
// tunings, and the whole POINT of the feature — the same seed+mods URL
// produces the identical world, twice. Source pins keep the boot order
// honest (queued seed > challenge > input; the 'auto' input must never
// again reroll an explicitly chosen seed) and each modifier wired to its
// one seam (worldgen settings, time override, eco spawn pass, damageHero).
// Run: node tools/challenge-seed-sim.test.mjs
import { strict as assert } from 'assert';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};

const C = await import('../src/engine/challenge.js');
const { parseChallenge, challengeLink, applyWorldMods, sanitizeMods,
	spawnTuningFor, combatTuningFor, nightOverrideFor, CHALLENGE_MODS } = C;

// --- parser ---------------------------------------------------------------------------
assert.equal(parseChallenge(''), null, 'no params -> no challenge');
assert.equal(parseChallenge('?mods=swarm'), null, 'mods without a seed are not reproducible -> null');
assert.equal(parseChallenge('?seed=0'), null, 'zero seed rejected');
assert.equal(parseChallenge('?seed=12.5'), null, 'fractional seed rejected');
assert.equal(parseChallenge('?seed=1000000000'), null, 'seed beyond the generator range rejected');
assert.deepEqual(parseChallenge('?seed=777'), { seed: 777, mods: [] }, 'bare seed challenge');
assert.deepEqual(parseChallenge('?seed=777&mods=swarm,permanight'), { seed: 777, mods: ['permanight', 'swarm'] },
	'mods parse, canonicalized to table order');
assert.deepEqual(parseChallenge('?seed=777&mods=SWARM, swarm ,hackmod'), { seed: 777, mods: ['swarm'] },
	'mods are case-folded, deduped and whitelisted — unknown entries drop silently');
assert.deepEqual(parseChallenge('?title=1&seed=777&mods=glass&x=1'), { seed: 777, mods: ['glass'] },
	'foreign params ride along without confusing the parser');
assert.deepEqual(parseChallenge('?seed=777&mods=glass%'), { seed: 777, mods: [] },
	'a malformed percent-escape degrades instead of throwing at import time');

// --- link builder round-trip -----------------------------------------------------------
assert.equal(challengeLink('https://x/y?old=1#frag', 777, ['swarm']), 'https://x/y?seed=777&mods=swarm',
	'the link strips old query/hash like watchLink');
assert.equal(challengeLink('http://x/', 777, []), 'http://x/?seed=777', 'no mods -> bare seed link');
assert.equal(challengeLink('http://x/', 0, ['swarm']), null, 'an invalid seed builds no link');
assert.equal(challengeLink('http://x/', 777, ['hackmod', 'glass']), 'http://x/?seed=777&mods=glass',
	'the builder whitelists mods too');
{
	const link = challengeLink('https://lkacz.github.io/code/', 424242, ['drought', 'swarm', 'glass']);
	const back = parseChallenge(link.slice(link.indexOf('?')));
	assert.deepEqual(back, { seed: 424242, mods: ['drought', 'swarm', 'glass'] }, 'link -> parse round-trips');
}

// --- the table and its derived tunings --------------------------------------------------
assert.ok(Object.keys(CHALLENGE_MODS).length >= 4, 'a curated set of modifiers exists');
for(const [k, def] of Object.entries(CHALLENGE_MODS)){
	assert.ok(def.label && def.desc, "modifier '" + k + "' is presentable (label + desc)");
	assert.ok(def.world || def.spawn || def.combat || typeof def.nightT === 'number',
		"modifier '" + k + "' declares at least one real effect");
}
assert.deepEqual(sanitizeMods(['glass', 'nope', 'glass', 'swarm']), ['swarm', 'glass'], 'sanitize dedupes + orders');
assert.deepEqual(sanitizeMods('glass'), [], 'non-array mod input is inert');
{
	const base = { oceanFrac: 0.22, aquiferLevel: 108, lakeMaxDepth: 12, caveDensity: 1.0 };
	const dry = applyWorldMods(base, ['drought']);
	assert.equal(dry.oceanFrac, CHALLENGE_MODS.drought.world.oceanFrac, 'drought patches the ocean threshold');
	assert.equal(dry.aquiferLevel, CHALLENGE_MODS.drought.world.aquiferLevel, 'drought dries the aquifer');
	assert.equal(base.oceanFrac, 0.22, 'the input settings object is never mutated');
	assert.equal(applyWorldMods(base, []).oceanFrac, 0.22, 'no mods -> settings pass through');
}
assert.equal(spawnTuningFor([]), null, 'no mods -> null spawn tuning (zero-cost consumer guard)');
assert.deepEqual(spawnTuningFor(['swarm']), CHALLENGE_MODS.swarm.spawn, 'swarm derives its declared tuning');
assert.equal(combatTuningFor(['swarm']), null, 'a non-combat mod leaves combat untouched');
assert.deepEqual(combatTuningFor(['glass']), { heroDamageInMult: 2 }, 'glass doubles incoming hero damage');
assert.equal(nightOverrideFor(['glass']), null, 'no night mod -> no override');
assert.ok(nightOverrideFor(['permanight']) > 0.6, 'permanight pins the cycle deep into the night section');

// --- determinism: the whole point ------------------------------------------------------
// Same seed + same mods = the same world. Sampled as surface/biome slices, the
// exact prior art of the worldgen suites; a divergent sample is a broken promise
// on every shared challenge link.
const { worldGen: WG } = await import('../src/engine/worldgen.js');
const baseSettings = Object.assign({}, WG.settings);
function slice(seed, mods){
	WG.worldSeed = seed;
	WG.settings = applyWorldMods(baseSettings, mods);
	WG.clearCaches();
	// continental scale: drought's ocean threshold only shows across whole basins
	const out = [];
	for(let x = -12000; x <= 12000; x += 61) out.push(WG.surfaceHeight(x) + ':' + WG.biomeType(x));
	return out.join('|');
}
const a1 = slice(424242, ['drought', 'maze']);
const b = slice(31337, ['drought', 'maze']);
const a2 = slice(424242, ['drought', 'maze']);
const plain = slice(424242, []);
assert.equal(a1, a2, 'same seed + same mods -> identical world slice');
assert.notEqual(a1, b, 'a different seed -> a different world');
assert.notEqual(a1, plain, 'world mods really reshape the generator output');
assert.equal(slice(424242, []), plain, 'clearing mods restores the unmodded world exactly');
WG.settings = baseSettings; WG.worldSeed = 12345; WG.clearCaches();

// --- source pins: every seam wired, none persisted --------------------------------------
const chalSrc = readFileSync(new URL('../src/engine/challenge.js', import.meta.url), 'utf8');
const wgSrc = readFileSync(new URL('../src/engine/worldgen.js', import.meta.url), 'utf8');
const mobsSrc = readFileSync(new URL('../src/engine/mobs.js', import.meta.url), 'utf8');
const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const hostSrc = readFileSync(new URL('../src/engine/ghost_host.js', import.meta.url), 'utf8');
const clientSrc = readFileSync(new URL('../src/engine/ghost_client.js', import.meta.url), 'utf8');

// boot order: queued new-game choice > challenge link > seed input — and the
// queued seed is no longer rerolled by the 'auto' input (the old silent bug)
assert.ok(/const QUEUED_SEED = consumeFreshWorldSeed\(typeof sessionStorage!=='undefined' \? sessionStorage : null\);/.test(wgSrc)
	&& /WG\.worldSeed = QUEUED_SEED \|\| 12345;/.test(wgSrc), 'worldgen consumes the one-shot seed into the boot decision');
assert.ok(/if\(QUEUED_SEED \|\| activeChallenge\)\{/.test(wgSrc) && /if\(!QUEUED_SEED\) WG\.worldSeed = activeChallenge\.seed;/.test(wgSrc),
	'an explicit seed (queued or challenge) survives boot — setSeedFromInput only rolls when neither exists');
assert.ok(/WG\.settings = applyWorldMods\(WG\.settings, activeChallenge\.mods\);/.test(wgSrc),
	'challenge world mods patch the generator settings');
{
	const bootBlock = wgSrc.slice(wgSrc.indexOf("if(typeof document!=='undefined'){"));
	assert.ok(!/setSettings|mm_world_settings/.test(bootBlock),
		'the challenge boot patches settings IN MEMORY only — never the persisted profile');
}
// the run remembers its curse; a watch page adopts nothing and writes nothing
assert.ok(/const SAVE_KEY = 'mm_save_v7';/.test(chalSrc) && /const SAVE_KEY='mm_save_v7';/.test(mainSrc),
	'challenge.js and main.js agree on the main-save key literally');
assert.ok(/if\(!isWatch\)\{/.test(chalSrc) && /localStorage\.setItem\(CHALLENGE_RUN_KEY/.test(chalSrc),
	'a fresh adoption records the run curse; spectator pages skip the whole block');
// each modifier's consumer seam
assert.ok(/MM\.challenge && MM\.challenge\.spawnTuning\) \? MM\.challenge\.spawnTuning\(\) : null;/.test(mobsSrc),
	'the eco spawn pass reads the swarm tuning through a null-guarded hook');
assert.ok(/\(ECO_SPAWN_MIN_MS \+ Math\.random\(\)\*ECO_SPAWN_JITTER_MS\)\/\(chalSpawn \? chalSpawn\.intervalDiv : 1\)/.test(mobsSrc),
	'swarm divides the spawn interval');
assert.ok(/if\(MM\.challenge && MM\.challenge\.combatTuning\)\{ const ct=MM\.challenge\.combatTuning\(\); if\(ct\) amount\*=ct\.heroDamageInMult; \}/.test(mainSrc),
	'glass doubles wounds at the single damageHero inlet');
assert.ok(/window\.__timeOverrideActive = true;/.test(chalSrc) && /window\.__timeOverrideValue = nightT;/.test(chalSrc),
	'permanight rides the existing time-override seam (timeInfo + sky renderer both honor it)');
// the debug time slider's boot-time init used to CLOBBER the night lock off —
// while the manual box is unchecked, an active challenge lock owns the override
{
	const uiSrc = readFileSync(new URL('../src/engine/ui.js', import.meta.url), 'utf8');
	assert.ok(/window\.__timeOverrideActive=chk\.checked \|\| chalNight!=null;/.test(uiSrc)
		&& /MM\.challenge\.nightLock/.test(uiSrc),
		'the debug slider respects the challenge night lock (checked box = manual control, unchecked = the curse)');
}
// spectator parity: mods ride the welcome and are re-whitelisted on receipt
assert.ok(/chal: chalMods\.length \? chalMods : undefined/.test(hostSrc), 'the welcome packet advertises active mods');
assert.ok(/Array\.isArray\(pl\.chal\) && MMR && MMR\.challenge && MMR\.challenge\.setRemoteMods/.test(clientSrc),
	'the guest adopts host mods through the re-whitelisting seam');
assert.ok(/remoteMods = activeChallenge \? null : sanitizeMods\(list\);/.test(chalSrc),
	'remote mods are sanitized and never outrank an own active challenge');
// share + restart UX
assert.ok(/copyChallenge\.textContent='Skopiuj wyzwanie';/.test(mainSrc), 'the pause panel offers the challenge link');
assert.ok(/if\(MM\.challenge && MM\.challenge\.pending\) seedInput\.value=String\(MM\.challenge\.pending\.seed\);/.test(mainSrc),
	'a pending challenge prefills the new-world seed instead of destroying the save');
assert.ok(/chosenSeed===MM\.challenge\.pending\.seed\) MM\.challenge\.queueNext\(MM\.challenge\.pending\);/.test(mainSrc),
	'restarting into the offered challenge hands its mods across the reload');
assert.ok(/if\(\/\[\?&\]\(seed\|mods\)=\/\.test\(window\.location\.search\)\) window\.location\.href=window\.location\.pathname;/.test(mainSrc),
	'a new-game reset sheds the challenge params from the address bar');

console.log('challenge-seed-sim: all assertions passed');
