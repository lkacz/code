// Grafika Ultra (engine/post_fx.js): config model, bloom emitter collection,
// QA flags, and the source contracts wiring the four opt-in cosmetic passes
// (bloom / AO / specular / water reflections) into main.js and water.js.
// Standard mode must stay byte-identical: every hook is pinned as a gated
// early-out, and all four components default to OFF.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};
const store = new Map();
globalThis.localStorage = {
	getItem: k => (store.has(k) ? store.get(k) : null),
	setItem: (k, v) => { store.set(k, String(v)); },
	removeItem: k => { store.delete(k); }
};
globalThis.document = {
	createElement(){
		return {
			width: 0, height: 0,
			getContext(){
				return {
					fillStyle: null,
					createLinearGradient(){ return { addColorStop(){} }; },
					createRadialGradient(){ return { addColorStop(){} }; },
					fillRect(){},
					setTransform(){},
					clearRect(){},
					drawImage(){}
				};
			}
		};
	}
};

const {
	postFx, GFX_ULTRA_KEY, GFX_COMPONENTS,
	normalizeGfxConfig, parseGfxConfig, bloomScanIntervalMs,
	bloomSourceFor, collectBloomEmitters, BLOOM_MIN_LEVEL, BLOOM_MAX_EMITTERS,
	heroSheenEnvSample, heroMirrorCurve, shadowParams,
	wetGroundStep, collectCanopyGaps, collectIceRuns,
	godRayWeight, godRayJitter, godRayProfile, godRayCross,
	GAP_COVER_MIN, GAP_COVER_SPAN, GAP_MAX_WIDTH, GAP_CANOPY_PROBE, GAP_ROOF_MIN,
	GODRAY_SPREADS, GODRAY_TINTS, GODRAY_MAX_BEAMS, GODRAY_SUN_TILES, GODRAY_LEAN,
	emissiveRgb, normalizeGlow, trailSampleDue, trailBroken, trailTaper,
	EMISSIVE_MAX, TRAIL_PTS, TRAIL_SAMPLE_MS, TRAIL_BREAK_PX, TRAIL_RETRACT_MS,
	heatSourceFor, heatPlumeTiles, heatAmpPx, heatEnvelope, heatOffsetPx, buildHeatBands,
	heatRowHeight, heatRowCount,
	glowProfile, glowBakedProfile, glowBakeStops, glowCoreRatio, GLOW_BAKE_GAIN, GLOW_AMP_A, GLOW_A_MAX,
	HEAT_WAVE_PX, HEAT_RISE, HEAT_RISE_2, HEAT_ROW_PX, HEAT_ROW_BUDGET, HEAT_BAND_CAP, HEAT_MERGE_GAP, HEAT_PLUME_TILES, HEAT_AMP_PX
} = await import('../src/engine/post_fx.js');
const { T, INFO, TILE_GLOW, TILE_HEAT } = await import('../src/constants.js');
await import('../src/engine/furnishings.js'); // stamps INFO[t].requiresHomePower like the live game
const { NEW_GAME_PREFERENCE_KEYS } = await import('../src/engine/new_game.js');

// --- config model ------------------------------------------------------------
assert.equal(GFX_ULTRA_KEY, 'mm_gfx_ultra_v1', 'graphics config persists under a versioned key');
assert.deepEqual([...GFX_COMPONENTS], ['bloom', 'ao', 'specular', 'reflections', 'heroSheen', 'shadows', 'godRays', 'lightTint', 'heatShimmer', 'wetGround', 'dustMotes', 'iceReflections'], 'exactly twelve ultra components exist');
assert.deepEqual(normalizeGfxConfig(null), { bloom: false, ao: false, specular: false, reflections: false, heroSheen: false, shadows: false, godRays: false, lightTint: false, heatShimmer: false, wetGround: false, dustMotes: false, iceReflections: false }, 'defaults are all-off (standard mode)');
assert.deepEqual(parseGfxConfig('not json'), normalizeGfxConfig(null), 'corrupt JSON falls back to standard mode');
assert.equal(parseGfxConfig('{"bloom":1,"ao":"yes"}').bloom, false, 'truthy-but-not-true values do not enable a component');
assert.equal(parseGfxConfig('{"reflections":true}').reflections, true, 'a persisted true enables its component');
assert.equal(MM.postFx, postFx, 'post_fx self-registers on MM');
assert.equal(postFx.anyOn(), false, 'fresh profile boots with every ultra pass off');

assert.equal(postFx.set('nope', true), false, 'unknown component names are rejected');
postFx.set('bloom', true);
assert.equal(postFx.on('bloom'), true, 'set() enables the component');
assert.deepEqual(parseGfxConfig(store.get(GFX_ULTRA_KEY)).bloom, true, 'set() persists to localStorage');
window.__mmNoPostFX = true;
assert.equal(postFx.on('bloom'), false, 'the QA kill switch beats every enabled component');
delete window.__mmNoPostFX;
window.__mmForceGfxUltra = true;
assert.equal(postFx.on('reflections'), true, 'the QA force flag enables components without touching storage');
assert.equal(parseGfxConfig(store.get(GFX_ULTRA_KEY)).reflections, false, 'the force flag does not write storage');
delete window.__mmForceGfxUltra;
postFx.set('bloom', false);

// --- bloom cadence + emitter model -------------------------------------------
// ONE cadence, whatever the machine is doing: the old 120/250/400 ladder made a
// freshly lit torch take three times longer to start glowing on a slow machine.
assert.equal(bloomScanIntervalMs(16), 120, 'the emitter rescan runs on one fixed cadence');
assert.equal(bloomScanIntervalMs(50), 120, 'a slow frame does not stretch the cadence');
assert.equal(bloomScanIntervalMs(undefined), 120, 'and a missing frame time changes nothing');

const torchSrc = bloomSourceFor(T.TORCH);
assert.ok(torchSrc && torchSrc.level >= BLOOM_MIN_LEVEL, 'torches bloom');
assert.equal(torchSrc.color, '255,176,84', 'torch bloom is warm');
assert.equal(bloomSourceFor(T.STONE), null, 'inert terrain does not bloom');
assert.equal(bloomSourceFor(T.CHEST_LEGENDARY), null, 'chests are excluded — the tier aura is already their glow');
assert.ok(bloomSourceFor(T.GLOWSHROOM), 'baked-art emitters (glowshroom) bloom via the declarative table');
assert.ok(bloomSourceFor(T.LAVA) && bloomSourceFor(T.LAVA).color === '255,124,44', 'lava blooms hot orange');

const grid = new Map();
const gk = (x, y) => x + ',' + y;
grid.set(gk(1, 1), T.TORCH);
grid.set(gk(2, 2), T.LAVA);
grid.set(gk(3, 3), T.STONE);
const getTile = (x, y) => grid.get(gk(x, y)) ?? T.AIR;
const all = collectBloomEmitters({ x0: 0, y0: 0, x1: 6, y1: 6, getTile });
assert.equal(all.length, 2, 'scan finds exactly the emissive tiles');
const fogged = collectBloomEmitters({ x0: 0, y0: 0, x1: 6, y1: 6, getTile, visibleAt: (x, y) => !(x === 2 && y === 2) });
assert.equal(fogged.length, 1, 'fog-hidden emitters never enter the bloom list');
assert.equal(fogged[0].t, T.TORCH, 'the visible emitter survives the fog filter');
for(let i = 0; i < 8; i++) grid.set(gk(10 + i, 1), T.TORCH);
const capped = collectBloomEmitters({ x0: 0, y0: 0, x1: 30, y1: 6, getTile, max: 3 });
assert.equal(capped.length, 3, 'the emitter cap bounds the list');
assert.ok(BLOOM_MAX_EMITTERS >= 64, 'default emitter cap covers a dense torch camp');

// Reservoir cap: a dense field (a lava lake) keeps its glow SPREAD over the
// window instead of truncating at a scan-order row.
const lake = new Map();
for(let y = 0; y < 20; y++) for(let x = 0; x < 10; x++) lake.set(gk(x, y), T.LAVA);
const lakeTile = (x, y) => lake.get(gk(x, y)) ?? T.AIR;
const sampled = collectBloomEmitters({ x0: 0, y0: 0, x1: 9, y1: 19, getTile: lakeTile, max: 12 });
assert.equal(sampled.length, 12, 'cap still bounds the dense field');
assert.ok(sampled.some(e => e.y >= 10), 'retained emitters reach the lower half of the window (no scan-order cutoff)');

// Power gate: furnishings that draw home power bloom only while running —
// the same rule the light field applies, failing CLOSED without a predicate.
assert.equal(INFO[T.MINIATURE_SUN] && INFO[T.MINIATURE_SUN].requiresHomePower, true, 'miniature sun is a powered furnishing');
assert.ok(bloomSourceFor(T.MINIATURE_SUN) && bloomSourceFor(T.MINIATURE_SUN).level >= BLOOM_MIN_LEVEL, 'miniature sun is bloom-worthy by level');
const houseGrid = new Map([[gk(1, 1), T.MINIATURE_SUN], [gk(4, 4), T.TORCH]]);
const houseTile = (x, y) => houseGrid.get(gk(x, y)) ?? T.AIR;
const noPower = collectBloomEmitters({ x0: 0, y0: 0, x1: 6, y1: 6, getTile: houseTile });
assert.deepEqual(noPower.map(e => e.t), [T.TORCH], 'without a power predicate a powered furnishing never blooms (fail closed) while torches still do');
const powered = collectBloomEmitters({ x0: 0, y0: 0, x1: 6, y1: 6, getTile: houseTile, poweredAt: () => true });
assert.equal(powered.length, 2, 'a running powered furnishing blooms');
const unpowered = collectBloomEmitters({ x0: 0, y0: 0, x1: 6, y1: 6, getTile: houseTile, poweredAt: () => false });
assert.deepEqual(unpowered.map(e => e.t), [T.TORCH], 'a dead appliance never halos');

// --- tile glow attribute ------------------------------------------------------
// The declaration that a tile emits light lives ON THE TILE (constants.js
// TILE_GLOW stamps INFO[t].glow) and is read by BOTH the light field and the
// renderer, so the two can never drift apart.
assert.ok(TILE_GLOW[T.TORCH] && TILE_GLOW[T.TORCH].level === 13, 'the torch declares its level as a tile attribute');
assert.equal(INFO[T.TORCH].glow, TILE_GLOW[T.TORCH], 'TILE_GLOW is stamped onto INFO');
assert.equal(INFO[T.STONE].glow, undefined, 'inert terrain carries no glow attribute');
for(const key of Object.keys(TILE_GLOW)){
	const spec = TILE_GLOW[key];
	assert.ok(spec.level >= BLOOM_MIN_LEVEL, 'every declared tile glow is bright enough to halo: ' + key);
	assert.match(spec.color, /^\d{1,3},\d{1,3},\d{1,3}$/, 'tile glow colours are sprite-cache triplets: ' + key);
}
const lightingSrc = readFileSync(new URL('../src/engine/lighting.js', import.meta.url), 'utf8');
assert.match(lightingSrc, /const attr = INFO\[t\] && INFO\[t\]\.glow;/, 'the light field reads the same tile attribute the renderer does');
assert.ok(!/\[T\.TORCH\]: 13/.test(lightingSrc), 'lighting no longer keeps its own copy of the torch level');

// --- normalizeGlow: the descriptor ramp ---------------------------------------
// ONE ramp turns a level into a radius and an alpha, so a level-13 torch is
// bigger and brighter than a level-9 glowshroom by construction.
const torchGlow = normalizeGlow({ level: 13, color: '#ffb054' }, 20);
const shroomGlow = normalizeGlow({ level: 9, color: '96,240,192' }, 20);
assert.equal(torchGlow.r, 20 * (0.7 + 13 * 0.2), 'the level->radius ramp is the one the tile pass draws with');
assert.equal(torchGlow.a, Math.min(0.68, 0.3 + 13 * 0.018), 'the level->alpha ramp matches too');
assert.ok(torchGlow.r > shroomGlow.r && torchGlow.a > shroomGlow.a, 'a brighter level really is bigger and brighter');
assert.equal(torchGlow.rgb, '255,176,84', 'hex colours normalise to the sprite-cache triplet');
assert.equal(normalizeGlow({ r: 8, color: '#fff' }, 20).r, 8, 'an entity radius is taken in world pixels as given');
assert.equal(normalizeGlow({ color: '#fff' }, 20), null, 'a descriptor with neither r nor level is not a glow');
assert.equal(normalizeGlow(null, 20), null, 'a missing attribute is not a glow');
assert.equal(normalizeGlow({ r: 5, color: '#fff', trail: true }, 20).trail, true, 'trail rides on the descriptor');
assert.equal(normalizeGlow({ r: 5, color: '#fff' }, 20).trail, false, 'no trail unless the attribute asks for one');
assert.ok(normalizeGlow({ r: 900, color: '#fff' }, 20).r <= 320, 'a runaway radius is clamped');

// --- tile glow draw behavior --------------------------------------------------
function makeCtx(){
	const calls = [];
	return {
		calls,
		globalAlpha: 1,
		globalCompositeOperation: 'source-over',
		imageSmoothingEnabled: false,
		save(){ calls.push('save'); },
		restore(){ calls.push('restore'); },
		drawImage(){ calls.push('drawImage'); }
	};
}
// Emissive TILES glow in standard mode now: a torch is light, not an option.
const tileOpts = { TILE: 20, sx: 0, sy: 0, viewX: 8, viewY: 8, getTile, frameMs: 16 };
const stdCtx = makeCtx();
const stdDrawn = postFx.drawGlowPass(stdCtx, tileOpts);
assert.ok(stdDrawn >= 2, 'standard mode halos every visible emissive tile');
assert.ok(stdCtx.calls.includes('drawImage') && stdCtx.calls[0] === 'save' && stdCtx.calls[stdCtx.calls.length - 1] === 'restore', 'the glow pass wraps its composite state in save/restore');
assert.ok(postFx.metrics.bloomScans >= 1 && postFx.metrics.bloomDraws >= 2, 'tile glow metrics record scans and draws');
// The QA kill switch is the only thing that silences it (screenshot goldens).
window.__mmNoPostFX = true;
const killCtx = makeCtx();
assert.equal(postFx.drawGlowPass(killCtx, tileOpts), 0, 'the kill switch silences tile glow');
assert.equal(killCtx.calls.length, 0, 'a killed pass touches no canvas state');
delete window.__mmNoPostFX;
// The `bloom` component AMPLIFIES the same sources instead of owning tiles.
const beforeAmp = postFx.metrics.bloomDraws;
postFx.set('bloom', true);
const ampCtx = makeCtx();
const ampDrawn = postFx.drawGlowPass(ampCtx, tileOpts);
postFx.set('bloom', false);
assert.equal(ampDrawn, stdDrawn, 'amplifying does not invent extra sources — it makes the same ones bigger');
assert.ok(postFx.metrics.bloomDraws > beforeAmp, 'the amplified pass still records its tile draws');
// The former entry points stay callable for QA seams: drawBloomPass keeps its
// component gate so the pass-matrix contract below still describes it.
assert.equal(postFx.drawBloomPass(makeCtx(), tileOpts), 0, 'drawBloomPass (the ultra alias) stays gated on its component');

// --- hero sheen environment probe (2D matcap) ---------------------------------
// The coat samples the ACTUAL world through the caller's tile->color table:
// ground color under the feet, walls beside, sky or ceiling above, plus the
// strongest glow emitter in reach (power-gated exactly like bloom).
const sheenColor = (t) => {
	if(t === T.GRASS) return '#4a8f3a';
	if(t === T.DIRT) return '#73543a';
	if(t === T.TORCH) return '#ffc24b';
	return '#686d78';
};
const meadow = (x, y) => (y >= 20 ? T.GRASS : T.AIR);
const noonMeadow = heroSheenEnvSample({ getTile: meadow, tileColor: sheenColor, px: 0, py: 19, daylight: 1, submerged: false });
assert.ok(noonMeadow.top && noonMeadow.mid && noonMeadow.bot, 'probe returns three stops');
assert.ok(noonMeadow.bot[1] > noonMeadow.bot[0] && noonMeadow.bot[1] > noonMeadow.bot[2], 'standing on grass, the legs pick up GREEN from the actual ground');
assert.ok(noonMeadow.top[2] > noonMeadow.top[1] && noonMeadow.top[2] > noonMeadow.top[0], 'open sky above reflects blue in the crown');
const nightMeadow = heroSheenEnvSample({ getTile: meadow, tileColor: sheenColor, px: 0, py: 19, daylight: 0, submerged: false });
assert.ok(nightMeadow.bot[1] < noonMeadow.bot[1], 'night dims the coat');
assert.ok(nightMeadow.bot.every(v => v > 0), 'the coat never goes fully black — a mirror finish still catches something');
const caveWorld = (x, y) => ((Math.abs(x) > 2 || y < 8 || y > 11) ? T.STONE : T.AIR); // sealed 5x4 pocket
const cavePocket = heroSheenEnvSample({ getTile: caveWorld, tileColor: sheenColor, px: 0, py: 10, daylight: 1, submerged: false });
assert.ok(Math.abs(cavePocket.mid[0] - cavePocket.mid[2]) < 30 && Math.abs(cavePocket.mid[0] - cavePocket.mid[1]) < 30, 'a stone pocket reflects the rock hue, not a biome palette');
const caveTorch = (x, y) => ((x === 2 && y === 10) ? T.TORCH : caveWorld(x, y));
const torched = heroSheenEnvSample({ getTile: caveTorch, tileColor: sheenColor, px: 0, py: 10, daylight: 1, submerged: false });
assert.ok(torched.mid[0] > cavePocket.mid[0] + 10, 'a torch in reach warms the coat like a glint of light');
const caveSun = (x, y) => ((x === 2 && y === 10) ? T.MINIATURE_SUN : caveWorld(x, y));
const unpoweredSun = heroSheenEnvSample({ getTile: caveSun, tileColor: sheenColor, px: 0, py: 10, daylight: 1, submerged: false });
const poweredSun = heroSheenEnvSample({ getTile: caveSun, tileColor: sheenColor, px: 0, py: 10, daylight: 1, submerged: false, poweredAt: () => true });
assert.ok(poweredSun.mid[0] > unpoweredSun.mid[0], 'a powered furnishing warms the coat only while it runs (fails closed, bloom parity)');
const divingProbe = heroSheenEnvSample({ getTile: meadow, tileColor: sheenColor, px: 0, py: 19, daylight: 1, submerged: true });
assert.ok(divingProbe.mid[2] > noonMeadow.mid[2], 'submersion shifts the coat toward water blue');
// a tall shaft deep underground: no ceiling in probe reach, but the crown must
// read cave-dark — noon blue may not glow on a hero 200 tiles down
const shaftWorld = (x, y) => ((Math.abs(x) > 2 && y >= 195) || y > 232 ? T.STONE : T.AIR);
const shaft = heroSheenEnvSample({ getTile: shaftWorld, tileColor: sheenColor, surfaceHeight: () => 20, px: 0, py: 231, daylight: 1, submerged: false });
assert.ok(shaft.top[2] < 60, 'an open shaft underground reflects darkness, not the sky');
assert.equal(heroSheenEnvSample({ tileColor: sheenColor, px: 0, py: 0 }), null, 'no world access -> no probe (pass falls back to its neutral finish)');

// --- hero mirror geometry ------------------------------------------------------
// The coat blits a grabbed rect of the scene back over the body through a
// barrel curve: the middle of the field stays large, the periphery squeezes.
assert.equal(heroMirrorCurve(0), 0, 'the curve spans the whole grabbed field');
assert.equal(heroMirrorCurve(1), 1, 'the curve spans the whole grabbed field');
assert.ok(Math.abs(heroMirrorCurve(0.5) - 0.5) < 1e-9, 'the field centre lands at the body centre');
const bandSrc = (v0, v1) => heroMirrorCurve(v1) - heroMirrorCurve(v0);
assert.ok(bandSrc(0, 0.1) > bandSrc(0.45, 0.55) * 1.5, 'an edge band swallows far more of the field than a middle band (convex compression)');
assert.ok(Math.abs(bandSrc(0, 0.1) - bandSrc(0.9, 1)) < 1e-9, 'top and bottom compress symmetrically');
// live capture: gated on the component, needs a real transform and canvas
function makeMirrorCtx(){
	return {
		canvas: { width: 1600, height: 900 },
		getTransform(){ return { a: 2, b: 0, c: 0, d: 2, e: 300, f: 200 }; },
		drawImage(){}
	};
}
postFx.set('heroSheen', false);
assert.equal(postFx.captureHeroBackdrop(makeMirrorCtx(), { bx: 100, by: 100, bw: 14, bh: 19 }), 0, 'no grab while the coat is off');
postFx.set('heroSheen', true);
assert.equal(postFx.captureHeroBackdrop(makeMirrorCtx(), { bx: 100, by: 100, bw: 14, bh: 19 }), 1, 'the coat grabs the scene behind the hero');
// the full-scene grab reuses the backdrop's rect and patches the hero out of it
assert.equal(postFx.captureHeroScene(makeMirrorCtx()), 1, 'the finished world is grabbed for the next frame');
const offscreen = makeMirrorCtx();
assert.equal(postFx.captureHeroBackdrop(offscreen, { bx: -9000, by: -9000, bw: 14, bh: 19 }), 0, 'a hero past the screen edge grabs nothing (no bogus blit)');
postFx.set('heroSheen', false);
assert.equal(postFx.captureHeroScene(makeMirrorCtx()), 0, 'no full-scene grab while the coat is off');
postFx.releaseScratch();
assert.equal(postFx.captureHeroScene(makeMirrorCtx()), 0, 'without a matching backdrop grab there is nothing to patch the hero out with');

// --- dynamic shadows (solar model) ---------------------------------------------
// The sun rises on the SCREEN LEFT (background.js celestialPosition), so
// morning shadows stretch right (+skew), evening shadows left (-skew).
const dawn = shadowParams({ tDay: 0.05, isDay: true });
const noon = shadowParams({ tDay: 0.5, isDay: true });
const dusk = shadowParams({ tDay: 0.95, isDay: true });
assert.ok(dawn.skew > 0.5, 'dawn shadows stretch right, away from the rising sun');
assert.ok(dusk.skew < -0.5, 'dusk shadows stretch left, away from the setting sun');
assert.ok(Math.abs(noon.skew) < 0.15, 'noon shadows sit under the caster');
assert.ok(dawn.stretch > noon.stretch, 'low sun casts long shadows');
assert.ok(noon.alpha > dawn.alpha, 'high sun casts the densest shadow');
const moonNight = shadowParams({ tDay: 0.5, isDay: false, moonlight: 0.22 });
assert.ok(moonNight.alpha > 0 && moonNight.alpha < dawn.alpha, 'full moon casts a faint shadow');
// The moon sweeps the SAME left-to-right celestial arc as the sun
// (moonPosition shares celestialPosition), so its shadow sign matches.
assert.ok(shadowParams({ tDay: 0.25, isDay: false, moonlight: 0.22 }).skew > 0, 'a rising moon (screen left) casts rightward shadows like a rising sun');
assert.ok(shadowParams({ tDay: 0.75, isDay: false, moonlight: 0.22 }).skew < 0, 'a setting moon casts leftward shadows');
assert.equal(shadowParams({ tDay: 0.5, isDay: false, moonlight: 0 }).alpha, 0, 'a moonless night casts nothing');
assert.deepEqual(shadowParams(null), noon, 'missing time info assumes noon');

// --- wet ground model -----------------------------------------------------------
let soak = 0;
for(let i = 0; i < 82; i++) soak = wetGroundStep(soak, 0.1, true);
assert.equal(soak, 1, 'about eight seconds of rain fully soaks the ground');
assert.ok(Math.abs(wetGroundStep(0, 0.1, true) - 0.0125) < 1e-9, 'soak rate is dt/8');
assert.ok(Math.abs(wetGroundStep(1, 0.1, false) - (1 - 0.1 / 45)) < 1e-9, 'dry-out rate is dt/45');
assert.equal(wetGroundStep(0, 10, false), 0, 'wetness never goes negative');
assert.equal(wetGroundStep(0.5, 99, true), 0.53125, 'a lag spike clamps to a 250 ms step (no wetness teleport)');

// --- canopy gap finder (god rays) ------------------------------------------------
// Fake forest: canopy at columns 0-2 and 6-8 (leaves 5 tiles above ground),
// open gap at 3-5 — exactly one beam site spanning the gap.
const forest = new Map();
for(const cx of [0, 1, 2, 6, 7, 8]) forest.set(cx + ',15', T.LEAF);
const forestTile = (x, y) => forest.get(x + ',' + y) ?? T.AIR;
const flatSurf = () => 20;
const gaps = collectCanopyGaps({ x0: 0, x1: 8, getTile: forestTile, surfaceHeight: flatSurf, isCanopy: t => t === T.LEAF });
assert.equal(gaps.length, 1, 'one canopy gap yields one beam site');
assert.equal(gaps[0].x0, 3, 'beam starts at the first open column');
assert.equal(gaps[0].x1, 5, 'beam ends at the last open column');
assert.equal(gaps[0].topY, 15, 'beam top follows the flanking canopy height');
assert.equal(gaps[0].groundY, 20, 'beam lands on the surface');
const treeless = collectCanopyGaps({ x0: 20, x1: 40, getTile: () => T.AIR, surfaceHeight: flatSurf, isCanopy: t => t === T.LEAF });
assert.equal(treeless.length, 0, 'open plains cast no beams (a gap needs canopy on both sides)');
assert.ok(Number.isFinite(gaps[0].groundX), 'beam remembers which column produced its landing row (fog probe target)');
// The MOUTH is the roof's underside, not the crown: a shaft becomes visible
// where it enters shaded air, and starting it at the treetops is what left the
// old beams hanging in open sky with a bright horizontal cut across the top.
assert.equal(gaps[0].mouthY, 15, 'a one-row canopy puts crown and underside on the same row');
const thick = new Map();
for(const cx of [0, 1, 2, 6, 7, 8]) for(const cy of [13, 14, 15]) thick.set(cx + ',' + cy, T.LEAF);
const thickGaps = collectCanopyGaps({ x0: 0, x1: 8, getTile: (x, y) => thick.get(x + ',' + y) ?? T.AIR, surfaceHeight: flatSurf, isCanopy: t => t === T.LEAF });
assert.equal(thickGaps.length, 1, 'a thick roof still yields its one gap');
assert.equal(thickGaps[0].topY, 13, 'topY is the CROWN (highest leaf)');
assert.equal(thickGaps[0].mouthY, 15, 'mouthY is the UNDERSIDE (lowest leaf) — where the shaft enters shaded air');
// Cover: how enclosed the site is. A sunbeam is lit air, invisible against a
// bright sky, so enclosure IS the beam's strength — this is the gate that stops
// shafts appearing over open ground.
assert.ok(Math.abs(gaps[0].cover - 6 / 9) < 1e-12, 'cover counts canopy columns in the window around the gap');
assert.ok(Math.abs(gaps[0].weight - 7 / 27) < 1e-12, 'weight is the smoothstep of cover above the threshold');
assert.equal(godRayWeight(GAP_COVER_MIN), 0, 'at the threshold a site is worth nothing — it fades in, never pops');
assert.equal(godRayWeight(0.4), 0, 'below the threshold there is no beam at all');
assert.equal(godRayWeight(1), 1, 'a fully closed roof gives full strength');
assert.equal(godRayWeight(0.75), 0.5, 'halfway up the range is the smoothstep midpoint');
// Two lone trees in a field: a narrow gap, flanked on both sides, and still no
// beam — because there is no dark air under it for a shaft to show against.
const sparse = new Map();
for(const cx of [3, 7]) sparse.set(cx + ',15', T.LEAF);
const sparseGaps = collectCanopyGaps({ x0: 0, x1: 8, getTile: (x, y) => sparse.get(x + ',' + y) ?? T.AIR, surfaceHeight: flatSurf, isCanopy: t => t === T.LEAF });
assert.equal(sparseGaps.length, 0, 'two lone trees in a field cast no beam (cover too low)');
// A break wider than the cap is a clearing, not a hole in a roof.
const wide = new Map();
for(const cx of [0, 1, 2, 8]) wide.set(cx + ',15', T.LEAF);
const wideGaps = collectCanopyGaps({ x0: 0, x1: 8, getTile: (x, y) => wide.get(x + ',' + y) ?? T.AIR, surfaceHeight: flatSurf, isCanopy: t => t === T.LEAF });
assert.equal(wideGaps.length, 0, 'a break wider than GAP_MAX_WIDTH is a clearing, not a beam site');
assert.equal(GAP_MAX_WIDTH, 3, 'a beam site is at most three columns wide');
assert.equal(gaps[0].x1 - gaps[0].x0 + 1, GAP_MAX_WIDTH, 'the pinned forest gap sits exactly at the width cap');
// Wide on purpose. At four columns a single pair of trees scored 0.89 cover and
// cast a bright shaft against open blue sky — one crown spans many columns, so
// the narrow window was answering "is there a leaf above me" when the question
// is "am I inside a forest". Caught by the live QA's screenshot, not by a pin.
assert.equal(GAP_COVER_SPAN, 9, 'the cover window reaches nine columns each side');
assert.equal(GAP_CANOPY_PROBE, 16, 'a roof may sit up to sixteen rows above the surface');
// A roof is something you can stand under. Undergrowth shades nothing, and
// counting it would anchor a shaft's mouth at ankle height — the same guard
// stops a tree TRUNK being mistaken for the underside of a canopy.
assert.equal(GAP_ROOF_MIN, 3, 'foliage closer than three rows to the ground is undergrowth, not a roof');
const bushes = new Map();
for(const cx of [0, 1, 2, 6, 7, 8]) for(const cy of [18, 19]) bushes.set(cx + ',' + cy, T.LEAF);
const bushGaps = collectCanopyGaps({ x0: 0, x1: 8, getTile: (x, y) => bushes.get(x + ',' + y) ?? T.AIR, surfaceHeight: flatSurf, isCanopy: t => t === T.LEAF });
assert.equal(bushGaps.length, 0, 'undergrowth at head height casts no beam — there is no shaded air under it');
assert.equal(collectCanopyGaps({ x0: 0, x1: 8, getTile: forestTile, surfaceHeight: flatSurf, isCanopy: t => t === T.LEAF, maxBeams: 0 }).length, 0, 'a zero cap collects nothing');
// Per-site jitter must be stable across scans (a beam that re-rolls its width
// every 400 ms flickers) and must differ between the two salts.
assert.equal(godRayJitter(37, 1), godRayJitter(37, 1), 'jitter is deterministic for a column');
assert.notEqual(godRayJitter(37, 1), godRayJitter(37, 2), 'width and alpha draw from different salts');
assert.notEqual(godRayJitter(37, 1), godRayJitter(38, 1), 'neighbouring sites do not share a character');
for(const x of [-9, 0, 5, 41, 1200]){ const j = godRayJitter(x, 1); assert.ok(j >= 0 && j < 1, 'jitter stays in [0,1) at x=' + x); }

// --- god ray beam profile ---------------------------------------------------------
// Along the shaft: both ends eased to zero. The old pass started at FULL alpha
// on its top edge, which is what drew a bright horizontal line across the sky.
assert.equal(godRayProfile(0), 0, 'the mouth starts at nothing — no cut line where the shaft leaves the leaves');
assert.equal(godRayProfile(1), 0, 'the foot dissolves — no cut line where it lands');
assert.equal(godRayProfile(-0.1), 0, 'outside the shaft there is no shaft');
assert.equal(godRayProfile(1.4), 0, 'past the foot there is no shaft');
assert.ok(godRayProfile(0.2) > godRayProfile(0.5), 'a shaft is brightest near its source');
assert.ok(godRayProfile(0.5) > godRayProfile(0.8), 'and fades progressively along its length');
// Across the shaft: a soft bell, symmetric, zero at both edges — no rim.
assert.equal(godRayCross(0), 1, 'the core is full strength');
assert.equal(godRayCross(1), 0, 'the edge is nothing');
assert.equal(godRayCross(-1), 0, 'the other edge too');
assert.equal(godRayCross(1.6), 0, 'beyond the edge stays nothing');
assert.equal(godRayCross(-0.42), godRayCross(0.42), 'the cross-section is symmetric');
assert.ok(godRayCross(0.5) < 0.5, 'the falloff is faster than linear — a beam has no flat plateau');
for(let u = 0; u < 1; u += 0.05) assert.ok(godRayCross(u) > godRayCross(u + 0.05) - 1e-12, 'cross-section never brightens outward at u=' + u.toFixed(2));
assert.deepEqual([...GODRAY_SPREADS], [1.25, 1.5, 1.8, 2.2, 2.7], 'five spread buckets bake the wedge');
assert.equal(GODRAY_TINTS.length, 3, 'three sun tints: high sun, golden hour, horizon');
assert.equal(GODRAY_MAX_BEAMS, 24, 'the beam cap is a fixed constant');
assert.ok(GODRAY_SUN_TILES > 0, 'the apparent sun distance sets how fast a shaft widens');
assert.ok(GODRAY_LEAN > 0 && GODRAY_LEAN < 1, 'a shaft leans with the sun, less steeply than the shadow it belongs to');
// The whole point of the apex model: the foot is wider than the mouth, and by a
// bounded amount. Crepuscular rays are very nearly parallel — they only LOOK
// like they fan out — so the spread must stay a shaft, never a cone.
const spreadFor = (lenTiles) => (GODRAY_SUN_TILES + lenTiles) / GODRAY_SUN_TILES;
assert.equal(spreadFor(0), 1, 'a zero-length shaft has not spread yet');
assert.ok(spreadFor(12) > 1.7 && spreadFor(12) < 2.0, 'a twelve-tile shaft lands about 1.85x its mouth width');
// The bucket table is what BOUNDS it. The raw ratio grows without limit, but
// the pass bakes the wedge, so the widest bucket is the widest a shaft can ever
// open — a beam can never turn into a floodlight cone.
const bucketFor = (s) => { let si = 0; for(let k = 1; k < GODRAY_SPREADS.length; k++) if(Math.abs(GODRAY_SPREADS[k] - s) < Math.abs(GODRAY_SPREADS[si] - s)) si = k; return GODRAY_SPREADS[si]; };
assert.equal(bucketFor(spreadFor(0)), 1.25, 'a short shaft takes the narrowest bake');
assert.equal(bucketFor(spreadFor(12)), 1.8, 'a twelve-tile shaft takes the middle bake');
assert.equal(bucketFor(spreadFor(400)), 2.7, 'an absurdly long shaft still bakes at the widest bucket, never wider');
// The decay must not outrun the spread. A shaft that dims faster than it widens
// still LOOKS like it tapers to a point, whatever its geometry says — this is
// the arithmetic the live QA measured off the framebuffer and rejected once.
assert.ok(godRayProfile(0.8) > godRayProfile(0.2) * 0.45, 'the tail stays bright enough for the widening to read');

// --- ice-run finder ---------------------------------------------------------------
// Natural frozen lake: the ICE crust sits at the WATER LINE, rows ABOVE the
// worldgen bed row — the scan must find the crust, not probe the bed.
const frozen = new Map();
frozen.set('50,17', T.ICE);   // crust at the water line
frozen.set('50,18', T.WATER); // water column below
frozen.set('50,19', T.WATER);
frozen.set('50,20', T.STONE); // bed at the worldgen row
frozen.set('51,20', T.STONE); // dry neighbor: plain ground
frozen.set('52,14', T.ICE);   // cave ice under an overhang: stone roof above it
frozen.set('52,12', T.STONE);
frozen.set('52,13', T.STONE);
frozen.set('52,20', T.STONE);
const lakeTile2 = (x, y) => frozen.get(x + ',' + y) ?? T.AIR;
const bedRow = () => 20;
const runs = collectIceRuns({ x0: 50, x1: 52, getTile: lakeTile2, surfaceHeight: bedRow });
assert.equal(runs.length, 1, 'exactly the frozen water surface yields a run');
assert.deepEqual(runs[0], { x: 50, surf: 17 }, 'the run sits at the ICE crust row, not the worldgen bed row');
// column 52: the scan stops at the FIRST blocking tile (the stone roof), so
// underground ice never mirrors inside caves
assert.ok(!runs.some(r => r.x === 52), 'cave ice below a roof is never collected');

// --- per-component gate matrix ---------------------------------------------------
// Every pass driver must obey ITS OWN component flag: enabled alone it draws,
// with only a DIFFERENT component enabled it draws nothing. This is the guard
// a copy-paste slip would break while npm run check stayed green (the live QA
// runs under the force flag, which lights every component at once).
function makeRichCtx(){
	const drawSources = [];
	const ctx = {
		drawSources,
		fills: 0,
		strokes: 0,
		fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
		globalAlpha: 1, globalCompositeOperation: 'source-over', imageSmoothingEnabled: false,
		canvas: { width: 1600, height: 900 },
		getTransform(){ return { a: 1, b: 0, c: 0, d: 1, e: 700, f: 400 }; },
		save(){}, restore(){}, beginPath(){}, closePath(){}, rect(){}, clip(){}, setTransform(){},
		translate(){}, scale(){}, rotate(){}, moveTo(){}, lineTo(){}, fill(){ ctx.fills++; }, ellipse(){ ctx.fills++; },
		stroke(){ ctx.strokes++; },
		fillRect(){ ctx.fills++; },
		drawImage(src){ drawSources.push(src); },
		createLinearGradient(){ return { addColorStop(){} }; },
		createRadialGradient(){ return { addColorStop(){} }; }
	};
	return ctx;
}
const matrixWorld = new Map();
matrixWorld.set(gk(2, 21), T.TORCH);           // bloom / tint emitter
matrixWorld.set(gk(4, 21), T.LAVA);            // shimmer source (air above)
matrixWorld.set(gk(6, 17), T.ICE);             // frozen crust above the bed row
matrixWorld.set(gk(6, 18), T.WATER);
for(let wx = -20; wx <= 40; wx++) if(!matrixWorld.has(gk(wx, 21))) matrixWorld.set(gk(wx, 21), T.STONE);
// A closed roof with a three-column hole at 13-15. It has to be a ROOF, not two
// trees: god rays are gated on how enclosed the site is, so a token canopy would
// drive the pass with a beam too faint to mean anything.
// Columns 4 (lava) and 6 (the frozen crust) stay open on purpose — a leaf over
// either would cap the shimmer plume and hide the ice from its scan, and this
// world drives every pass at once.
for(const cx of [5, 7, 8, 9, 10, 11, 12, 16, 17, 18, 19, 20, 21, 22, 23, 24]) matrixWorld.set(gk(cx, 16), T.LEAF);
for(let ty = 17; ty <= 20; ty++) matrixWorld.set(gk(20, ty), T.WOOD);          // a trunk for tree shadows
const mTile = (x, y) => matrixWorld.get(gk(x, y)) ?? T.AIR;
const mSurf = () => 21;
const mBase = { TILE: 20, sx: -8, sy: 5, viewX: 40, viewY: 25, getTile: mTile, surfaceHeight: mSurf, frameMs: 16 };
const PASS_MATRIX = [
	['bloom', ctx => postFx.drawBloomPass(ctx, { ...mBase })],
	['heroSheen', ctx => postFx.drawHeroSheenPass(ctx, { bx: 0, by: 0, bw: 18, bh: 28, getTile: mTile, tileColor: sheenColor, px: 20, py: 16, daylight: 1, submerged: false })],
	['shadows', ctx => postFx.drawTreeShadowsPass(ctx, { ...mBase, isTrunk: t => t === T.WOOD, time: { tDay: 0.4, isDay: true } })],
	['godRays', ctx => postFx.drawGodRaysPass(ctx, { ...mBase, isCanopy: t => t === T.LEAF, time: { tDay: 0.3, isDay: true }, daylight: 1 })],
	['lightTint', ctx => postFx.drawLightTintPass(ctx, { ...mBase })],
	['heatShimmer', ctx => postFx.drawHeatShimmerPass(ctx, { ...mBase, pools: null })],
	['wetGround', ctx => { window.__mmForceWet = true; const r = postFx.drawWetGroundPass(ctx, { ...mBase, rainingAt: () => false, skipWetTile: () => false, daylight: 1 }); delete window.__mmForceWet; return r; }],
	['dustMotes', ctx => postFx.drawDustMotesPass(ctx, { ...mBase, daylight: 1 })],
	['iceReflections', ctx => postFx.drawIceReflectionsPass(ctx, { ...mBase })]
];
for(const key of GFX_COMPONENTS) postFx.set(key, false);
for(const [name, drive] of PASS_MATRIX){
	for(const key of GFX_COMPONENTS) postFx.set(key, false);
	postFx.set(name, true);
	const onCtx = makeRichCtx();
	assert.ok(drive(onCtx) > 0, name + ': enabled alone, its pass draws');
	postFx.set(name, false);
	postFx.set(name === 'bloom' ? 'heroSheen' : 'bloom', true);
	const offCtx = makeRichCtx();
	assert.equal(drive(offCtx), 0, name + ': a different component alone draws nothing through this pass');
	assert.equal(offCtx.fills + offCtx.drawSources.length, 0, name + ': disabled pass touches no canvas ops');
}
for(const key of GFX_COMPONENTS) postFx.set(key, false);

// Snapshot staging: the two self-blit passes must never read the live canvas
// per slice — every drawImage source is the staged copy, not ctx.canvas.
postFx.set('heatShimmer', true);
postFx.set('iceReflections', true);
const stagedCtx = makeRichCtx();
assert.ok(postFx.drawHeatShimmerPass(stagedCtx, { ...mBase, pools: null }) > 0, 'shimmer draws slices over open lava');
assert.ok(postFx.drawIceReflectionsPass(stagedCtx, { ...mBase }) > 0, 'ice pass mirrors the frozen crust');
assert.ok(stagedCtx.drawSources.length > 0 && stagedCtx.drawSources.every(s => s !== stagedCtx.canvas), 'self-blits are staged through the snapshot, never the live canvas');
postFx.set('heatShimmer', false);
postFx.set('iceReflections', false);
assert.equal(postFx.releaseScratch(), true, 'toggling both consumers off releases the snapshot scratch');

// --- heat shimmer: the FIELD ---------------------------------------------------
// What this effect looks like is decided by the displacement field, not by the
// draw loop that consumes it, so the field's properties are the contract. Each
// assertion below is a defect the previous three-slice version actually shipped.

// Heat is an attribute of the tile, read the same way glow is.
assert.equal(heatSourceFor(T.LAVA), 1, 'open lava is the reference heat source');
assert.equal(heatSourceFor(T.MOTHER_LAVA), 1, 'the mother lava boils air like ordinary lava');
// A measured exclusion, not an oversight: cost scales with plume AREA, so a dozen
// small plumes cost multiples of one lava pool, and a torch's ~2px waver sits in
// the darkness the torch itself creates — where there is nothing to bend.
assert.equal(heatSourceFor(T.TORCH), 0, 'torches are deliberately NOT heat sources (too many, too little to see)');
assert.equal(heatSourceFor(T.STONE), 0, 'cold tiles throw no plume');
assert.equal(heatSourceFor(T.GLOWSHROOM), 0, 'a COLD light bends no air — heat and glow are independent attributes');
assert.equal(INFO[T.LAVA].heat, TILE_HEAT[T.LAVA], 'the attribute is stamped onto INFO from the constants table');
assert.ok(Object.isFrozen(TILE_HEAT), 'the heat table is frozen like the glow table');

// Plume geometry. The effect has to reach visibly ABOVE the hot block — a haze
// hugging the tile edge was the other half of why the old one read as an artefact.
assert.ok(heatPlumeTiles(1) >= 2, 'a full-strength plume stands at least two blocks tall');
assert.ok(heatPlumeTiles(0) > 1, 'even the coolest source on the ramp (a hot spring) clears a whole block');
assert.ok(heatPlumeTiles(1) > heatPlumeTiles(0.3) && heatAmpPx(1) > heatAmpPx(0.3), 'hotter means taller and stronger');

// Envelope: full at the source, gone before the top edge.
assert.equal(heatEnvelope(0), 1, 'the air is most disturbed right at the source');
assert.equal(heatEnvelope(1), 0, 'and undisturbed at the plume top');
assert.equal(heatEnvelope(2), 0, 'past the top it stays zero rather than wrapping');
assert.ok(heatEnvelope(0.85) < 0.07, 'the haze has faded out BEFORE the band ends, so its top edge cannot show as a seam');
let envPrev = Infinity;
for(let h = 0; h <= 1.0001; h += 0.05){
	const e = heatEnvelope(h);
	assert.ok(e <= envPrev + 1e-12, 'the envelope never rises again on the way up (h=' + h.toFixed(2) + ')');
	envPrev = e;
}

// CONTINUITY IN HEIGHT — the headline fix. Neighbouring sampled rows must differ
// by a sub-pixel amount; the old version jumped ~1.9px between 4px slices, which
// is what made one block visibly slide against the next.
const fBase = 800, fPlume = 100, fAmp = heatAmpPx(1) * 2, fWave = HEAT_WAVE_PX * 2, fSeed = 1.1;
let worstStep = 0, worstAt = 0;
for(const t of [0, 400, 1234, 5000]){
	let d = 0;
	while(d < fPlume){
		const h = d / fPlume;
		const rh = heatRowHeight(h);
		const a = heatOffsetPx(fBase - d, fBase, fPlume, fAmp, fWave, fSeed, t);
		const b = heatOffsetPx(fBase - d - rh, fBase, fPlume, fAmp, fWave, fSeed, t);
		if(Math.abs(a - b) > worstStep){ worstStep = Math.abs(a - b); worstAt = h; }
		d += rh;
	}
}
assert.ok(worstStep < 0.75, 'adjacent rows stay sub-pixel apart (worst ' + worstStep.toFixed(2) + 'px at h=' + worstAt.toFixed(2) + ') — the rows read as one continuous field');
assert.ok(heatRowHeight(1) > heatRowHeight(0), 'rows grow taller where the field has flattened, buying back draw calls for free');
assert.equal(heatRowCount(0), 0, 'no plume, no rows');
assert.ok(heatRowCount(100) < 100 / HEAT_ROW_PX[0], 'the adaptive step costs fewer rows than uniform fine sampling');

// TRAVELLING UPWARD, not oscillating in place. A feature at a fixed phase must sit
// at a SMALLER canvas y as time advances (canvas y grows downward).
const traceRow = (t) => {
	let bestY = null, bestV = -Infinity;
	for(let y = fBase - fPlume + 4; y <= fBase - 4; y += 0.25){
		const v = heatOffsetPx(y, fBase, fPlume, fAmp, fWave, 0, t);
		if(v > bestV){ bestV = v; bestY = y; }
	}
	return bestY;
};
const peak0 = traceRow(0), peak1 = traceRow(90), peak2 = traceRow(180);
assert.ok(peak1 < peak0 && peak2 < peak1, 'the crest climbs the plume over time (' + peak0 + ' -> ' + peak1 + ' -> ' + peak2 + ') — rising air, not a left-right pump');

// NOT A SINGLE SINE. One sine repeats on its own period and the eye locks onto the
// rhythm; the second, differently-paced component is what keeps it from doing so.
const periodMs = 2 * Math.PI / HEAT_RISE;
const sampleAt = (t) => heatOffsetPx(fBase - 25, fBase, fPlume, fAmp, fWave, 0.4, t);
assert.ok(Math.abs(sampleAt(0) - sampleAt(periodMs)) > 0.05, 'the field does NOT repeat after one base period — no perceptible rhythm');
assert.ok(HEAT_RISE_2 > 0 && Math.abs(HEAT_RISE_2 - HEAT_RISE) > 1e-6, 'the two components drift at genuinely different rates');
assert.ok(Math.abs(heatOffsetPx(fBase - 25, fBase, fPlume, fAmp, fWave, 0.4, 1000) - heatOffsetPx(fBase - 25, fBase, fPlume, fAmp, fWave, 2.9, 1000)) > 1e-6, 'the seed decorrelates neighbouring plumes so they never wave in unison');

// Domain guards: outside the plume there is no displacement at all.
assert.equal(heatOffsetPx(fBase + 5, fBase, fPlume, fAmp, fWave, 0, 0), 0, 'below the source, nothing');
assert.equal(heatOffsetPx(fBase - fPlume, fBase, fPlume, fAmp, fWave, 0, 0), 0, 'at the very top, nothing');
assert.equal(heatOffsetPx(fBase - 10, fBase, 0, fAmp, fWave, 0, 0), 0, 'a zero-height plume displaces nothing');

// Bands: contiguous hot tiles merge into ONE plume. This is both the truthful
// shape (a heatLake boils as one sheet) and what keeps the pass affordable.
const heatLakeRow = [];
for(let x = 0; x < 40; x++) heatLakeRow.push({ x, y: 30, strength: 1 });
const heatLake = buildHeatBands(heatLakeRow, { TILE: 20, scale: 1, focusX: 20 });
assert.equal(heatLake.length, 1, 'a forty-tile lava heatLake is ONE band, not forty stacked plumes');
assert.equal(heatLake[0].x0, 0, 'the merged band starts at the run start');
assert.equal(heatLake[0].x1, 39, 'and ends at the run end');
const heatSplit = buildHeatBands([{ x: 0, y: 30, strength: 1 }, { x: 1, y: 30, strength: 1 }, { x: 5, y: 30, strength: 1 }, { x: 0, y: 12, strength: 1 }], { TILE: 20, scale: 1, focusX: 0 });
assert.equal(heatSplit.length, 3, 'a gap in the run and a different row both break the band');
// Bridging a small gap of OPEN AIR: two fires a tile or two apart share one body
// of rising air, and one band over both costs one set of rows instead of two.
// Measured: twelve sources two tiles apart cost 514us as eight separate bands
// (which is also all the row budget could afford — four plumes were being dropped)
// against 325us as one band covering every one of them.
const heatGapped = [];
for(let i = 0; i < 12; i++) heatGapped.push({ x: i * 3, y: 30, strength: 1 });
const openAll = () => true;
assert.equal(buildHeatBands(heatGapped, { TILE: 20, scale: 2, focusX: 0, airAbove: openAll }).length, 1, 'twelve sources two tiles apart merge into ONE plume when the gaps are open air');
assert.ok(buildHeatBands(heatGapped, { TILE: 20, scale: 2, focusX: 0 }).length > 1, 'without an air probe the merger stays conservative — only true neighbours join');
const heatSplitAll = buildHeatBands(heatGapped, { TILE: 20, scale: 2, focusX: 0, airAbove: openAll, mergeGap: 0 });
assert.equal(heatSplitAll.length, 8, 'mergeGap 0 forces strict adjacency (the QA A/B seam)');
assert.ok(heatSplitAll.length < 12, 'and paying per plume costs COVERAGE too — the row budget cannot afford all twelve, so merging is both cheaper and more complete');
// A pillar between two plumes must BREAK the band. Merging through it would clip
// the whole thing to the pillar's zero headroom and lose both plumes at once.
const wall = (x) => x !== 2;
const twoApart = [{ x: 0, y: 30, strength: 1 }, { x: 3, y: 30, strength: 1 }];
assert.equal(buildHeatBands(twoApart, { TILE: 20, scale: 1, focusX: 0, airAbove: openAll }).length, 1, 'a two-tile air gap is bridged');
assert.equal(buildHeatBands(twoApart, { TILE: 20, scale: 1, focusX: 0, airAbove: wall }).length, 2, 'a pillar standing in the gap keeps the two plumes separate');
assert.equal(buildHeatBands([{ x: 0, y: 30, strength: 1 }, { x: 9, y: 30, strength: 1 }], { TILE: 20, scale: 1, focusX: 0, airAbove: openAll }).length, 2, 'a wide gap is never bridged, however open it is');
assert.ok(HEAT_MERGE_GAP > 0 && HEAT_MERGE_GAP <= 3, 'the bridge stays short — a long one would shimmer cold ground between two distant fires');
const heatMixed = buildHeatBands([{ x: 3, y: 30, strength: 0.3 }, { x: 4, y: 30, strength: 1 }], { TILE: 20, scale: 1, focusX: 0 });
assert.equal(heatMixed.length, 1, 'touching sources of different heat still merge');
assert.equal(heatMixed[0].strength, 1, 'and the merged band takes the hottest strength in the run');
assert.deepEqual(buildHeatBands(null, {}), [], 'no sources, no bands');
assert.deepEqual(buildHeatBands([{ x: 1, y: 1, strength: 0 }], {}), [], 'a zero-strength source is not a heat source');

// Ordering and the work cap: hottest first, then nearest the view centre, and a
// FIXED row budget — never a frame-time threshold, because a weak machine must
// still be shown the effect at full quality.
const heatCrowd = [];
for(let x = 0; x < 60; x += 2) heatCrowd.push({ x, y: 30, strength: 0.3 });   // a torch-lit base
heatCrowd.push({ x: 100, y: 30, strength: 1 });                              // one lava tile far off
const heatCapped = buildHeatBands(heatCrowd, { TILE: 20, scale: 2, focusX: 0, rowBudget: 40 });
assert.ok(heatCapped.length > 0 && heatCapped.length < 31, 'the row budget cuts the band list off');
assert.equal(heatCapped[0].strength, 1, 'the hottest source is served first, however far away');
assert.ok(heatCapped.reduce((n, b) => n + b.rows, 0) <= 40, 'the reserved rows respect the budget');
const heatNear = buildHeatBands([{ x: 0, y: 30, strength: 0.3 }, { x: 50, y: 30, strength: 0.3 }], { TILE: 20, scale: 1, focusX: 48, rowBudget: 12 });
assert.equal(heatNear.length, 1, 'with room for one, the tie is broken by distance');
assert.equal(heatNear[0].x0, 50, 'and it is the one next to the player');
// The band cap is the cap that matters: every band pays for its own strip copy,
// so twenty scattered torches cost far more than one lava lake of the same width.
const heatMany = [];
for(let x = 0; x < 80; x += 4) heatMany.push({ x, y: 30, strength: 0.3 });
assert.equal(buildHeatBands(heatMany, { TILE: 20, scale: 2, focusX: 40 }).length, HEAT_BAND_CAP, 'a field of small plumes is cut off at the band cap');
assert.ok(HEAT_BAND_CAP > 0 && HEAT_BAND_CAP <= 16, 'the band cap is a small fixed number, not a frame-time reaction');

// --- entity emissive registry --------------------------------------------------
// Colour normaliser: the art writes hex, the bloom table writes triplets, and the
// sprite cache is keyed on the triplet.
assert.equal(emissiveRgb('#ff5a5a'), '255,90,90', 'six-digit hex becomes a triplet');
assert.equal(emissiveRgb('#fff'), '255,255,255', 'short hex expands');
assert.equal(emissiveRgb('164,255,84'), '164,255,84', 'an existing triplet passes through');
assert.equal(emissiveRgb('120, 200, 255'), '120,200,255', 'whitespace in a triplet is normalised');
assert.equal(emissiveRgb('rebeccapurple'), '255,236,190', 'unparseable colour falls back instead of throwing in a draw loop');
assert.equal(emissiveRgb(null), '255,236,190', 'a missing colour falls back');

// Trail sampling model (world-space position history).
assert.equal(trailSampleDue(null, 0, 0, 1000), true, 'an empty history always takes its first sample');
const histA = { pts: [{ x: 100, y: 100 }], at: 1000 };
assert.equal(trailSampleDue(histA, 140, 100, 1000 + TRAIL_SAMPLE_MS - 5), false, 'samples are rate-limited by time, not by frames');
assert.equal(trailSampleDue(histA, 100.2, 100, 1000 + TRAIL_SAMPLE_MS + 5), false, 'a source that barely moved adds no sample (a still light must not pile up dots)');
assert.equal(trailSampleDue(histA, 140, 100, 1000 + TRAIL_SAMPLE_MS + 5), true, 'real movement past the cadence samples');
assert.equal(trailBroken(histA, 140, 100), false, 'ordinary movement keeps the history');
assert.equal(trailBroken(histA, 100 + TRAIL_BREAK_PX + 10, 100), true, 'a teleport-sized jump breaks the trail (no light beam across the world)');
assert.equal(trailTaper(0, 7), 0, 'the oldest sample carries no weight');
assert.equal(trailTaper(6, 7), 1, 'the head carries full weight');
assert.ok(trailTaper(3, 7) < 0.5, 'the taper is convex — the tail thins fast, like a real light streak');

// Live registry: queue -> one batched pass. The glow carries NO component flag —
// it is standard at full quality because it was measured (3.4 us per still
// source, 9.8 us per streaking one; tools/mob-glow-qa.mjs) — so the only thing
// that can silence it is the QA kill switch.
assert.equal(postFx.glowTier(), 1, 'glow is standard, not an ultra option');
postFx.set('bloom', true);
assert.equal(postFx.glowTier(), 2, 'the bloom component AMPLIFIES every source uniformly');
postFx.set('bloom', false);
assert.equal(postFx.emissiveTier(), postFx.glowTier(), 'the earlier name still answers for QA seams');
window.__mmNoPostFX = true;
assert.equal(postFx.glowTier(), 0, 'the QA kill switch silences the glow for goldens');
assert.equal(postFx.addEmissive({ x: 10, y: 10, r: 6, color: '#fff' }), false, 'a killed registry accepts nothing');
delete window.__mmNoPostFX;

assert.equal(postFx.addEmissive({ x: 10, y: 10, r: 6, color: '#ffe068' }), true, 'a valid source is accepted');
assert.equal(postFx.addEmissive({ x: NaN, y: 10, r: 6, color: '#fff' }), false, 'a non-finite position is rejected');
assert.equal(postFx.addEmissive({ x: 10, y: 10, r: 0, color: '#fff' }), false, 'a zero radius is rejected');
assert.equal(postFx.emissiveQueued(), 1, 'only the valid source queued');
const emCtx = makeRichCtx();
assert.equal(postFx.drawEmissivePass(emCtx, { now: 5000 }), 1, 'a still source draws ONE blit — the two-layer profile is baked into the sprite (see the equivalence proof above)');
assert.equal(postFx.emissiveQueued(), 0, 'the pass DRAINS the queue (a stranded source would redraw at a stale position)');
assert.equal(emCtx.strokes, 0, 'a source with no trail key paints no streak');
assert.equal(emCtx.drawSources.length, 1, 'one sprite blit per source, carrying the bleed AND the core');
assert.equal(postFx.drawEmissivePass(makeRichCtx(), { now: 5016 }), 0, 'an empty queue costs nothing');

// A streak that grows as the source moves.
let t2 = 6000;
let lastTrailCtx = null;
for(let step = 0; step < 6; step++){
	postFx.addEmissive({ x: 100 + step * 30, y: 200, r: 7, color: '#ff5a5a', a: 0.5, key: 'bat1:eye0', trail: true });
	lastTrailCtx = makeRichCtx();
	postFx.drawEmissivePass(lastTrailCtx, { now: t2 });
	t2 += 40;
}
assert.equal(lastTrailCtx.drawSources.length, 1, 'the moving source gets the same single baked blit');
assert.ok(lastTrailCtx.strokes >= 5, 'the streak strokes one segment per history step plus the head, so it reaches the body: ' + lastTrailCtx.strokes);
assert.equal(lastTrailCtx.lineCap, 'round', 'round caps keep a segmented streak from reading as beads');
// A source that stops moving must not keep a growing tail, and dropping the
// source (dead, culled, fogged) must not leave its streak behind.
const stillCtx = makeRichCtx();
for(let step = 0; step < 4; step++){
	postFx.addEmissive({ x: 280, y: 200, r: 7, color: '#ff5a5a', a: 0.5, key: 'bat1:eye0', trail: true });
	postFx.drawEmissivePass(stillCtx, { now: t2 });
	t2 += 40;
}
const stillStrokes = stillCtx.strokes;
postFx.addEmissive({ x: 280, y: 200, r: 7, color: '#ff5a5a', a: 0.5, key: 'bat1:eye0', trail: true });
const afterStill = makeRichCtx();
postFx.drawEmissivePass(afterStill, { now: t2 + 40 });
assert.ok(afterStill.strokes <= Math.ceil(stillStrokes / 3), 'a stationary source stops extending its history');
// …and RETRACTS it: a stopped mob used to keep drawing its full frozen streak at
// the old world positions forever (history only ever lost points on movement),
// paying ~8 strokes a frame for an artefact. One point per TRAIL_RETRACT_MS
// drains the tail into the body — which is also what a light streak physically does.
assert.ok(TRAIL_RETRACT_MS > TRAIL_SAMPLE_MS, 'retraction is slower than sampling, so a moving source never retracts');
let drainT = t2 + 40;
let drainedCtx = null;
for(let step = 0; step < TRAIL_PTS + 4; step++){
	postFx.addEmissive({ x: 280, y: 200, r: 7, color: '#ff5a5a', a: 0.5, key: 'bat1:eye0', trail: true });
	drainedCtx = makeRichCtx();
	drainT += TRAIL_RETRACT_MS + 4;
	postFx.drawEmissivePass(drainedCtx, { now: drainT });
}
assert.equal(drainedCtx.strokes, 0, 'a source that stays still drains its whole streak — no frozen tail');
t2 = drainT;
// Queue cap: a swarm cannot make the pass unbounded.
for(let i = 0; i < EMISSIVE_MAX + 40; i++) postFx.addEmissive({ x: i, y: 5, r: 4, color: '#ffe068' });
assert.equal(postFx.emissiveQueued(), EMISSIVE_MAX, 'the queue is capped like the bloom emitter list');
postFx.drawEmissivePass(makeRichCtx(), { now: t2 + 100 });
assert.ok(TRAIL_PTS >= 5 && TRAIL_PTS <= 12, 'history depth stays in the range a streak needs');
// The kill switch must also DROP the histories: coming back must not resume a
// streak from wherever the entity used to be.
window.__mmNoPostFX = true;
postFx.drawEmissivePass(makeRichCtx(), { now: t2 + 200 });
delete window.__mmNoPostFX;
const resumeCtx = makeRichCtx();
postFx.addEmissive({ x: 100, y: 200, r: 7, color: '#ff5a5a', key: 'bat1:eye0', trail: true });
postFx.drawEmissivePass(resumeCtx, { now: t2 + 240 });
assert.equal(resumeCtx.strokes, 0, 'a revived pass starts from a clean history, never from a stale position');

// --- new-game boundary --------------------------------------------------------
assert.ok(NEW_GAME_PREFERENCE_KEYS.includes('mm_gfx_ultra_v1'), 'graphics choice survives a new game');

// --- source contracts ---------------------------------------------------------
const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const waterSrc = readFileSync(new URL('../src/engine/water.js', import.meta.url), 'utf8');
const postFxSrc = readFileSync(new URL('../src/engine/post_fx.js', import.meta.url), 'utf8');

assert.match(postFxSrc, /GFX_ULTRA_KEY = 'mm_gfx_ultra_v1'/, 'post_fx pins its storage key');
assert.match(postFxSrc, /__mmNoPostFX/, 'post_fx honors the QA kill switch');
assert.match(postFxSrc, /__mmForceGfxUltra/, 'post_fx honors the QA force flag');
assert.ok(!postFxSrc.includes('.getImageData('), 'bloom never reads pixels back (render-health taboo)');
assert.ok(!waterSrc.includes('.getImageData('), 'water reflections never read pixels back');
// NOTHING copies the whole frame any more. Both self-blit passes read only the
// strip they sample, which was worth 332->120us for the shimmer and 225->~30us for
// the ice, measured. The full-frame helper is gone so it cannot come back by habit.
assert.equal((postFxSrc.match(/snapshotSceneCanvas/g) || []).length, 0, 'the full-frame snapshot helper is gone entirely');
assert.match(postFxSrc, /function snapshotSceneRegion\(srcCanvas, rx, ry, rw, rh\)/, 'the region snapshot is the only staging path');
assert.equal((postFxSrc.match(/snapshotSceneRegion\(ctx\.canvas, regX0, regY0, regW, regH\)/g) || []).length, 2, 'both self-blit passes stage through it: shimmer per band, ice per surviving band');
// The ice pass must resolve and CULL every column before it copies a pixel: the
// run scan is x-only (the pass is given no sy/viewY), so a frame that draws nothing
// is the normal case underground, and it used to pay the full copy anyway.
const iceBody = postFxSrc.slice(postFxSrc.indexOf('drawIceReflectionsPass(ctx, opts){'));
const iCull = iceBody.indexOf('if(!iceCols.length) return 0;');
const iSnap = iceBody.indexOf('snapshotSceneRegion(');
assert.ok(iCull > 0 && iSnap > 0 && iCull < iSnap, 'the ice pass returns on an empty column set BEFORE it copies anything');
assert.match(iceBody, /iceCols\.push\(wxPx, topPx, sxDev, syDev, swDev, shDev, destH\);/, 'column geometry goes into a reusable flat scratch, not a fresh object per column');
assert.match(iceBody, /syDev >= ch \|\| sxDev < 0 \|\| sxDev \+ swDev > cw/, 'the bounds checks moved to the LIVE canvas dims — the snapshot is no longer full-frame, so its size stopped being a proxy');
assert.ok(!/drawImage\(ctx\.canvas/.test(postFxSrc), 'no post_fx pass blits the live canvas onto itself directly');

// --- the two-layer bake, proven as arithmetic ---------------------------------
// Every glow used to cost two blits: a wide dim bleed and a tight bright core over
// it. The core blit was a measured 24% of the pass and is redundant, because the
// two profiles sum. This block IS the proof that one blit reproduces both, so the
// claim survives whoever touches the numbers next.
assert.equal(glowProfile(0), 0.55, 'the plain profile peaks at the sprite centre');
assert.equal(glowProfile(1), 0, 'and reaches zero at its rim, so no square edge can show');
assert.equal(glowProfile(-1), 0.55, 'inside the inner flat radius it stays at the peak');
assert.ok(glowProfile(0.03) === 0.55, 'the inner flat region matches the gradient r0=2 the sprite uses');
let profPrev = Infinity;
for(let u = 0; u <= 1.0001; u += 0.02){
	const v = glowProfile(u);
	assert.ok(v <= profPrev + 1e-12, 'the profile never brightens outward (u=' + u.toFixed(2) + ')');
	profPrev = v;
}
assert.ok(Math.abs(glowCoreRatio(1) - 1.85) < 1e-9, 'tier 1 core ratio is the bleed multiplier');
assert.ok(Math.abs(glowCoreRatio(2) - 1.85 * 1.30) < 1e-9, 'tier 2 widens the bleed, so the ratio grows with it');
assert.ok(Math.abs(glowBakedProfile(0, glowCoreRatio(2)) - 1) < 1e-9, 'the baked profile is normalised to exactly 1 at the centre');
assert.equal(glowBakedProfile(1, glowCoreRatio(2)), 0, 'and to zero at the rim');
// THE equivalence: one blit at alpha A1*GAIN of the baked profile must reproduce
// wide(A1*P(u)) + core(A2*P(g*u)) to better than one 8-bit level, for every alpha
// any source may declare and both tiers.
let bakeWorst = 0, bakeAt = '';
for(const tier of [1, 2]){
	const ampA = tier >= 2 ? GLOW_AMP_A : 1;
	const g = glowCoreRatio(tier);
	for(let a = 0.01; a <= GLOW_A_MAX + 1e-9; a += 0.01){
		const A1 = a * 0.34 * ampA, A2 = a * ampA;
		assert.ok(A1 <= 1 && A2 <= 1, 'neither layer alpha clamps — the whole proof rests on this (a=' + a.toFixed(2) + ', tier ' + tier + ')');
		assert.ok(A1 * GLOW_BAKE_GAIN <= 1, 'and the single blit alpha does not clamp either');
		for(let u = 0; u <= 1.0001; u += 0.005){
			const two = A1 * glowProfile(u) + A2 * glowProfile(u * g);
			const one = A1 * GLOW_BAKE_GAIN * glowBakedProfile(u, g);
			const d = Math.abs(two - one);
			if(d > bakeWorst){ bakeWorst = d; bakeAt = 'tier ' + tier + ' a=' + a.toFixed(2) + ' u=' + u.toFixed(3); }
		}
	}
}
assert.ok(bakeWorst < 1 / 255, 'one baked blit equals the two it replaced within an 8-bit level (worst ' + (bakeWorst * 255).toFixed(4) + '/255 at ' + bakeAt + ')');
// Stops land on every breakpoint of BOTH terms, which is what makes the gradient's
// own linear interpolation exact rather than a rounding of the kink.
for(const tier of [1, 2]){
	const g = glowCoreRatio(tier);
	const stops = glowBakeStops(g);
	assert.ok(stops[0] === 0 && stops[stops.length - 1] === 1, 'the stop list spans the whole sprite (tier ' + tier + ')');
	assert.ok(stops.length >= 5 && stops.length <= 9, 'a handful of exact stops, not a uniform resample (tier ' + tier + ')');
	for(let i = 1; i < stops.length; i++) assert.ok(stops[i] > stops[i - 1], 'stops are strictly increasing, as addColorStop requires');
	assert.ok(stops.some(u => Math.abs(u - 1 / g) < 1e-9), 'including the kink where the core term ends — sampling past it costs ~2.6/255 (tier ' + tier + ')');
}
assert.match(postFxSrc, /const gain = 0\.34 \* ampA \* GLOW_BAKE_GAIN;/, 'the bake gain is hoisted out of the per-source loops');
assert.match(postFxSrc, /const wr = e\.r \* beat \* 1\.85 \* ampR;\n\t\t\tconst ga = Math\.min\(1, e\.a \* gain\);\n\t\t\tif\(ga !== lastGA\)\{ ctx\.globalAlpha = ga; lastGA = ga; \}\n\t\t\tctx\.drawImage\(spr, e\.x - wr, e\.y - wr, wr \* 2, wr \* 2\);\n\t\t\thalos \+= 1;/, 'an entity glow is ONE blit now');
// `lighter` is additive and additive-with-clamp is commutative, so skipping a
// redundant globalAlpha set is bit-exact AS LONG AS nothing reorders the draws.
assert.ok(!/\.sort\(/.test(postFxSrc.slice(postFxSrc.indexOf('drawGlowPass(ctx, opts){'), postFxSrc.indexOf('\n\t},', postFxSrc.indexOf('drawGlowPass(ctx, opts){')))), 'the alpha-skip never licenses reordering the halo draws');
assert.ok(!/halos \+= 2;/.test(postFxSrc), 'the second per-source blit is gone');
assert.match(postFxSrc, /e\.a = Math\.max\(0, Math\.min\(GLOW_A_MAX, Number\.isFinite\(src\.a\) \? src\.a : 0\.55\)\);/, 'the inlet caps alpha at the ceiling the bake depends on');
assert.ok(GLOW_A_MAX > 0.68, 'the ceiling sits above every alpha the game actually declares, so it never fires today');

// One system must not be able to empty the SHARED glow queue. Registration order is
// draw order and fire draws early, so a forest fire (MAX_BURNING 240, queue 128, no
// cap) used to starve every mob, projectile, drop, meteor, turret and spring pad
// after it of light entirely. Stride-sampled, not first-N: fire halos overlap several
// tiles deep and saturate, so an even subset reads the same, while the first N would
// clump at one end of the blaze.
const fireGlowSrc = readFileSync(new URL('../src/engine/fire.js', import.meta.url), 'utf8');
assert.match(fireGlowSrc, /const BURN_GLOW_CAP=40;/, 'fire takes a fixed share of the shared glow queue');
assert.match(fireGlowSrc, /const glowStride=Math\.max\(1, Math\.ceil\(burning\.size\/BURN_GLOW_CAP\)\);/, 'the share is spread across the blaze by stride, not taken off the front');
assert.match(fireGlowSrc, /if\(EMISSIVE && \(burnSeen\+\+ % glowStride\)===0\) EMISSIVE\.glow\(/, 'and the stride actually gates the registration');
assert.ok(40 < EMISSIVE_MAX, 'fire cannot fill the queue on its own');
assert.ok(!/BURN_GLOW_CAP[^\n]*frameMs|frameMs[^\n]*BURN_GLOW_CAP/.test(fireGlowSrc), 'the cap is a constant, never a reaction to frame time');
// burningNear feeds the shimmer every frame; a big fire built ~240 throwaway
// {x,y} per call before the pool. Entries are valid until the next call only.
assert.match(fireGlowSrc, /const burningNearList=\[\]; const burningNearPool=\[\];/, 'burningNear recycles its list and entries');
assert.match(fireGlowSrc, /function burningNear\(x,r\)\{\n    const out=burningNearList; out\.length=0;/, 'the pooled feed keeps the pinned (x,r) signature');

// --- hot-path invariants, each one a measured regression waiting to happen -----
// The per-tile glow lookup is memoized: it was ~88% of the emitter scan (9.0ns per
// call over thousands of solid tiles). LAZY is load-bearing — furnishings.js stamps
// INFO after constants.js, so an eager table would miss every furnishing.
assert.match(postFxSrc, /const glowSourceMemo = \[\];/, 'the per-tile glow source is memoized by tile id');
assert.match(postFxSrc, /const hit = glowSourceMemo\[t\];\n\tif\(hit !== undefined\) return hit;/, 'the memo distinguishes "not computed" from "not an emitter"');
assert.ok(!/glowSourceMemo\[[^\]]+\] =[^;]+;\n?\s*for\(/.test(postFxSrc), 'the memo is filled lazily, never as an eager table at import time');
assert.equal(bloomSourceFor(T.TORCH), bloomSourceFor(T.TORCH), 'a repeat lookup returns the very same object');
assert.ok(Object.isFrozen(bloomSourceFor(T.TORCH)), 'the shared descriptor is frozen, so no caller can poison the memo');
// The tile path fed its raw colour into a string, so a hex colour — exactly what
// constants.js documents as legal — would have thrown from addColorStop inside the
// frame's draw loop. Normalised once per tile id now.
assert.match(postFxSrc, /color: emissiveRgb\(\(attr && attr\.color\) \|\| '255,236,190'\)/, 'tile glow colours are normalised through emissiveRgb, so a documented hex value cannot throw mid-draw');
assert.equal(bloomSourceFor(T.LAVA).color, '255,124,44', 'normalising leaves an existing triplet alone');
assert.ok(!/if\(!spr\) break;/.test(postFxSrc), 'an unusable colour skips its own source instead of dropping every remaining one');
// Reservoir: the entry object is built only once it is kept. A lava lake offers
// ~2000 candidates for 160 slots, so the old order allocated ~1800 to throw away.
assert.ok(!/const e = \{ x, y, t, level: src\.level, color: src\.color \};/.test(postFxSrc), 'no emitter object is built before the reservoir decides to keep it');
assert.match(postFxSrc, /if\(out\.length < max\) out\.push\(\{ x, y, t, level: src\.level, color: src\.color \}\);/, 'the keep path allocates, the discard path does not');
// The streak colour string was rebuilt per trailed source per frame.
assert.match(postFxSrc, /ctx\.strokeStyle = glowStrokeFor\(e\.rgb\);/, 'the streak stroke colour comes from a cache, not a fresh string');
// Chests: the chunk range this loop walks is padded by a whole CHUNK_W either side,
// so without an x cull an off-screen chest burned one of the 128 shared glow slots.
assert.match(mainSrc, /if\(wx<sx-3 \|\| wx>sx\+viewX\+5\) continue;/, 'the chest aura loop culls horizontally, not only vertically');
// Hero sheen scratch discipline (audit: the four scratch copies/clears were ~93%
// of the pass's touched pixel area). Steady state grabs only the hero-footprint
// patch — the full field is read by nobody once the scene grab is fresh — and
// neither capture clears first: the game canvas is opaque ({alpha:false}), the
// source rect is clamped inside it, and each draw covers its whole target.
assert.match(postFxSrc, /const sceneFresh = heroSceneAt > 0 && \(now - heroSceneAt\) < HERO_GRAB_TTL_MS/, 'the backdrop grab branches on scene freshness');
const iBackFn = postFxSrc.indexOf('captureHeroBackdrop(ctx, opts){');
const backBody = postFxSrc.slice(iBackFn, postFxSrc.indexOf('\n\t},', iBackFn));
assert.ok(iBackFn > 0 && backBody.length > 800, 'captureHeroBackdrop body was located');
assert.ok(!backBody.includes('.clearRect('), 'no clearRect before an opaque full-cover draw (backdrop)');
assert.match(backBody, /heroPatchCtx\.drawImage\(src, sx \+ px \/ gk, sy \+ py \/ gk, pw \/ gk, ph \/ gk, 0, 0, pw, ph\);/, 'the patch-only grab samples the exact grid the full-field downscale would');
const iSceneFn = postFxSrc.indexOf('captureHeroScene(ctx){');
const sceneBody = postFxSrc.slice(iSceneFn, postFxSrc.indexOf('\n\t},', iSceneFn));
assert.ok(iSceneFn > 0 && sceneBody.length > 400, 'captureHeroScene body was located');
assert.ok(!sceneBody.includes('.clearRect('), 'no clearRect before an opaque full-cover draw (scene)');
assert.match(sceneBody, /const patch = heroMirrorFull \? heroMirrorCanvas : heroPatchCanvas;/, 'the hero-free patch comes from whichever grab this frame actually took');
// A patch-only frame leaves the mirror canvas holding a STALE full field — the
// fallback consumers must never blit it (a hitch frame would show a ghost scene).
assert.equal((postFxSrc.match(/heroMirrorFull && fresh\(heroMirrorAt\)/g) || []).length, 2, 'both fallback consumers (coat and blade) gate on the mirror holding a real full field');
// Light tint: the 8×8 dedupe is a pure function of the cadence-cached emitter
// list — rebuilt per SCAN, with numeric keys, under the source-over it documents.
assert.match(postFxSrc, /if\(tintWinnersGen !== bloomScanGen\)\{/, 'the wash winners rebuild only when the emitter scan does');
assert.match(postFxSrc, /const cell = \(\(e\.x >> 3\) \* 65536\) \+ \(\(e\.y >> 3\) \+ 32768\);/, 'numeric dedupe cells — no key string per emitter');
// The per-tile heat lookup is memoized exactly like bloomSourceFor above (the
// INFO dictionary walk was 88% of that scan) — and lazily, INFO is stamped late.
assert.match(postFxSrc, /const heatSourceMemo = \[\];/, 'the per-tile heat strength is memoized by tile id');
assert.match(postFxSrc, /const hit = heatSourceMemo\[t\];\n\tif\(hit !== undefined\) return hit;/, 'the heat memo distinguishes "not computed" from "cold"');

// Heat shimmer, source side. The one line that decides whether this effect can
// spill onto a neighbouring block: the destination rect (x0) is the SAME on both
// sides of the call, and only the source x carries the displacement.
const iShimFn = postFxSrc.indexOf('drawHeatShimmerPass(ctx, opts){');
const shimBody = postFxSrc.slice(iShimFn, postFxSrc.indexOf('\n\t},', iShimFn));
assert.ok(iShimFn > 0 && shimBody.length > 400, 'the shimmer pass body was located');
assert.match(shimBody, /const sx = Math\.max\(regX0, Math\.min\(regX1 - w, x0 \+ off\)\);/, 'the displacement is applied to the SOURCE coordinate, clamped inside the copied strip');
assert.match(shimBody, /ctx\.drawImage\(srcCanvas, sx - regX0, ry - regY0, w, rh, x0, ry, w, rh\);/, 'the painted rect never moves — refraction is a lookup offset, not a translation');
assert.ok(!/wxPx \+ wob|drawImage\([^)]*, wxPx/.test(postFxSrc), 'the old destination-offset slice blit is gone (it climbed onto the next block)');
assert.ok(!/i \* 1\.7|2\.6 - i \* 0\.6/.test(postFxSrc), 'the old three-slice phase/amplitude ladder is gone');
assert.match(shimBody, /ctx\.setTransform\(1, 0, 0, 1, 0, 0\);/, 'the pass works in device space, so rows land on whole pixels');
assert.ok(!/frameMs\s*>|stressed/.test(shimBody), 'the shimmer never degrades itself on a frame-time threshold — a weak machine sees the full effect');
// The live feeds (pools, burning) are x-culled by their callers, while the band
// sort (hottest first) and the caps run BEFORE off-canvas bands are discarded —
// without a y-cut a fire in a mine below the screen could outrank and silently
// suppress the plumes actually in view.
assert.match(shimBody, /if\(ry < yMin \|\| ry > yMax\) continue;/, 'pool/burning sources are cut to the visible rows before the band budget');
assert.match(shimBody, /const sources = heatSrcList;\n\t\tsources\.length = 0;/, 'the shimmer source list is pooled scratch, not a fresh array per frame');
assert.match(shimBody, /rowBudget: HEAT_ROW_BUDGET, bandCap: HEAT_BAND_CAP/, 'work is capped by fixed row and band budgets instead');
assert.match(shimBody, /while\(k < openTiles && getTile\(x, band\.y - 1 - k\) === T\.AIR\) k\+\+;/, 'the plume is clipped to the open air above the run — never through a cavern ceiling');
// The merger gets the SAME probe the clip uses. Anything looser and it could bridge
// a gap with a pillar in it, whose zero headroom would then clip the merged band to
// nothing and lose both plumes.
assert.match(shimBody, /const airAbove = \(x, y, need\) => \{/, 'the pass lends the merger an air probe');
assert.match(shimBody, /mergeGap: Number\.isFinite\(opts\.mergeGap\) \? opts\.mergeGap : HEAT_MERGE_GAP, airAbove/, 'gap merging is wired, with a QA seam to A/B it');

// --- god rays: the shaft is a baked quad, not a polygon ---------------------------
const iRayFn = postFxSrc.indexOf('drawGodRaysPass(ctx, opts){');
const rayBody = postFxSrc.slice(iRayFn, postFxSrc.indexOf('\n\t},', iRayFn));
assert.ok(iRayFn > 0 && rayBody.length > 400, 'the god ray pass body was located');
// The old pass built a linear gradient and two rgba() strings PER BEAM PER FRAME
// and filled a hard-edged parallelogram. The profile is baked once now, so the
// pass allocates nothing and the beam has soft edges on every side.
assert.ok(!/createLinearGradient|addColorStop|rgba\(/.test(rayBody), 'the shaft profile is baked into a sprite — the pass builds no gradient and no colour string per frame');
assert.ok(!/moveTo|lineTo|closePath|\bfill\(\)/.test(rayBody), 'no polygon: a hard-edged quad is what gave the old beams their rim');
assert.match(rayBody, /ctx\.drawImage\(spr, -footW \* 0\.5, 0, footW, len\);/, 'one blit per beam, sized by its FOOT (the sprite bakes the mouth narrower)');
assert.match(rayBody, /const len = h \/ cos;/, 'a leaning shaft is longer than the vertical drop it covers');
assert.match(rayBody, /const spread = \(GODRAY_SUN_TILES \+ len \/ TILE\) \/ GODRAY_SUN_TILES;/, 'the wedge diverges from an apex placed up-sun — that is what makes it narrow at the roof and wide where it lands');
assert.match(rayBody, /const mouthPx = b\.mouthY \* TILE/, 'the shaft starts at the canopy UNDERSIDE, not at the crown hanging in the sky');
assert.ok(!/b\.topY/.test(rayBody), 'the crown row no longer anchors anything the player can see');
assert.match(rayBody, /ctx\.globalAlpha = alpha \* b\.weight \* \(0\.80 \+ 0\.40 \* b\.jitterA\);/, 'each beam carries its own enclosure weight and its own character');
assert.match(rayBody, /const pad = GAP_COVER_SPAN \+ 2;/, 'the scan is padded past the view so a beam does not brighten as it scrolls in');
assert.match(rayBody, /maxBeams: GODRAY_MAX_BEAMS/, 'the beam count is a fixed cap');
assert.ok(!/frameMs|stressed|critical/.test(rayBody), 'god rays never degrade themselves on a frame-time threshold');
const iGapFn = postFxSrc.indexOf('export function collectCanopyGaps(');
const gapBody = postFxSrc.slice(iGapFn, postFxSrc.indexOf('\n}', iGapFn));
assert.ok(iGapFn > 0 && gapBody.length > 400, 'the canopy scan body was located');
assert.match(gapBody, /if\(bots\[i\] === null\) bots\[i\] = y;\n\t\t\ttops\[i\] = y;/, 'one probe per column yields both the underside and the crown');
assert.ok(!/surfaceHeight\(end \+ 1\)|surfaceHeight\(x - 1\)/.test(gapBody), 're-probing the flanks is gone — the spans are computed once and reused');
assert.match(gapBody, /const weight = godRayWeight\(cover\);/, 'enclosure decides the beam, in the scan, not at draw time');

// Standard-mode zero cost: EVERY pass invocation in main.js sits behind a
// component gate (gfxUltraOn / POST_FX.on within the guarding block), so a
// disabled component costs neither the call nor its opts object. A new pass
// added without the gate fails here, not in a profiler.
const passCalls = [...mainSrc.matchAll(/POST_FX\.draw\w+\(ctx/g)];
assert.ok(passCalls.length >= 10, 'all pass invocations are present in main.js');
for(const m of passCalls){
	// The glow pass is the ONE deliberate exception. It is not an optional extra:
	// this IS the light every source used to draw for itself — the creatures' flat
	// ellipses and the emissive tiles alike — and the call also DRAINS the registry
	// queue, so gating it would strand queued sources and redraw them at stale
	// positions next frame. The `bloom` component amplifies it instead of gating it.
	if(mainSrc.startsWith('POST_FX.drawGlowPass(ctx', m.index)) continue;
	const back = mainSrc.slice(Math.max(0, m.index - 420), m.index);
	assert.ok(back.includes("gfxUltraOn('") || back.includes("POST_FX.on('"), 'pass invocation missing a component gate near: ' + mainSrc.slice(m.index, m.index + 60));
}
assert.match(mainSrc, /if\(POST_FX\.drawGlowPass\) POST_FX\.drawGlowPass\(ctx,\{TILE,sx,sy,viewX,viewY,getTile,visibleAt:worldFxVisible,poweredAt:\(x,y\)=>furnishingPoweredAt\(x,y\),frameMs:lastFrameMs,now:performance\.now\(\)\}\);/, 'ONE ungated glow pass carries tiles and entities and drains the queue');
assert.equal((mainSrc.match(/POST_FX\.drawGlowPass\(ctx/g) || []).length, 1, 'exactly one glow pass invocation exists — two would double every halo');

assert.match(mainSrc, /import \{ postFx as POST_FX \} from '\.\/engine\/post_fx\.js';/, 'main.js wires the post_fx module');
assert.match(mainSrc, /function gfxUltraOn\(name\)\{ return !!\(POST_FX && POST_FX\.on && POST_FX\.on\(name\)\); \}/, 'every ultra hook gates through one helper');
assert.match(mainSrc, /function invalidateAllChunkRenderCaches\(\)\{ chunkCanvases\.clear\(\); chunkRenderDirty\.clear\(\); \}/, 'baked ultra toggles can drop the whole chunk render cache');
assert.match(mainSrc, /const SPEC_GLINT_TILES=new Set\(\[T\.GOLD_ORE,T\.SILVER_ORE,T\.SILVER_INGOT,T\.DIAMOND,T\.ICE,T\.MOTHER_ICE,T\.GLASS,T\.STEEL,T\.IRIDIUM,T\.METEORIC_IRON,T\.OBSIDIAN,T\.ANTIMATTER_CRYSTAL,T\.GOLDEN_WOOD\]\);/, 'specular material set is explicit and pinned');
assert.match(mainSrc, /if\(gfxUltraOn\('specular'\) && SPEC_GLINT_TILES\.has\(t\)\)/, 'bake collects specular points only in ultra');
assert.match(mainSrc, /entry\.spec=\(entry\.spec\|\|\[\]\)\.filter\(o=>o\.y<redrawWorldY0 \|\| o\.y>redrawWorldY1\);/, 'partial redraw prunes the specular list like the chest list');
assert.match(mainSrc, /if\(gfxUltraOn\('ao'\) && fam!==EDGE_LEAF && fam!==EDGE_LAVA\)/, 'ultra AO in the edge pass is gated and skips leaf/lava families');
const contactShadeStart = mainSrc.indexOf('function drawCaveContactShade(');
const contactShadeEnd = mainSrc.indexOf('// ---- Tile art v2: neighbor-aware edge lighting', contactShadeStart);
assert.ok(contactShadeStart > 0 && contactShadeEnd > contactShadeStart, 'cave contact shade pass is present');
assert.match(mainSrc.slice(contactShadeStart, contactShadeEnd), /gfxUltraOn\('ao'\)/, 'ultra AO widens the cave contact shade behind the same gate');
// The owner's rule, as a pin: fixed constant work caps are fine, quality keyed
// on measured frame time is not — a weak machine must see the full picture. The
// three passes that carried such knobs (specular 120→48, tint 64→24, motes
// 48→20) run on constants now.
assert.match(mainSrc, /let specBudget=120, specDrawn=0, specScan=1500;/, 'specular pass bounds the point WALK with CONSTANT budgets');
assert.ok(!mainSrc.includes('specStressed'), 'the stressed-frame specular degradation is gone');
assert.match(postFxSrc, /\n\t\tconst cap = 64;/, 'the light-tint wash cap is a constant');
assert.match(postFxSrc, /\n\t\tconst budget = 48;/, 'the dust-mote budget is a constant');
// The strongest form of the guard: this file may not consult the frame clock at
// all any more. (`frameMs` still arrives in opts from main.js call sites, which
// other passes' pins depend on — what must not come back is a COMPARISON.)
assert.ok(!/frameMs\s*[<>]/.test(postFxSrc), 'post_fx never compares the measured frame time');
// The same sweep outside post_fx. Fire was the worst offender: its first tier
// began at 18ms, i.e. below 60fps, so an ordinary machine drew 115 of 260 lava
// glows and a 30fps browser sat permanently at 54 — with half the flames gone too.
assert.ok(!/frameMs\s*[<>]|stressed|critical/.test(fireGlowSrc), 'fire draws the same lava on every machine');
assert.match(fireGlowSrc, /let glowBudget=260;\n    let flameBudget=112;\n    let wakeBudget=58;/, 'fire budgets are constants');
assert.match(fireGlowSrc, /if\(\(frontier \|\| \(\(x\+y\)&3\)===0\) && glowBudget-->0\)\{/, 'which lava tiles glow no longer depends on the clock');
const grassRuleSrc = readFileSync(new URL('../src/engine/grass.js', import.meta.url), 'utf8');
assert.ok(!/frameMs/.test(grassRuleSrc), 'grass density and metal gloss no longer read the frame clock');
const bgRuleSrc = readFileSync(new URL('../src/engine/background.js', import.meta.url), 'utf8');
assert.match(bgRuleSrc, /const BACKDROP_CACHE_FPS=30;/, 'the parallax backdrop refreshes on one rate everywhere');
assert.ok(!/measuredFrameMs/.test(bgRuleSrc), 'the backdrop cache no longer measures the frame clock');
const mobsRuleSrc = readFileSync(new URL('../src/engine/mobs.js', import.meta.url), 'utf8');
assert.match(mobsRuleSrc, /const cheapLasers=mobLasers\.length>8;/, 'laser richness is capped by COUNT, not by frame time');
assert.match(mainSrc, /\tturboSparkT=0\.065;/, 'sprint sparks keep one cadence');
assert.match(mainSrc, /\t\tfx\.emitT=0\.038;/, 'the death-travel trail keeps one cadence');
assert.match(mainSrc, /if\(\(cx3\+1\)\*CHUNK_W<sx-1 \|\| cx3\*CHUNK_W>sx\+viewX\+2\) continue;/, 'off-screen chunk columns are culled from the glint walk');
assert.match(mainSrc, /POST_FX\.metrics\.specGlints\+=specDrawn;/, 'specular pass reports its draw count');
assert.match(mainSrc, /visibleAt:worldFxVisible,poweredAt:\(x,y\)=>furnishingPoweredAt\(x,y\),frameMs:lastFrameMs,now:performance\.now\(\)/, 'the glow pass receives the fog predicate, the furnishing power gate and the frame-health signal');

// Frame ordering: the glow pass sits above the darkness overlay and below fog.
const iLight = mainSrc.indexOf('drawLightingOverlay(sx,sy,viewX,viewY,{camX:camRenderX');
const iBloom = mainSrc.indexOf('POST_FX.drawGlowPass');
const iFog = mainSrc.indexOf('drawFogOverlay(sx,sy,viewX,viewY,{camX:camRenderX');
assert.ok(iLight > 0 && iBloom > iLight && iFog > iBloom, 'glow draws after cave darkness and before fog (undiscovered black wins)');

// Pause panel: master switch + one Polish row per component, resynced on reopen.
assert.match(mainSrc, /'✨ Grafika Ultra \(wszystko\)'/, 'master ultra row exists');
// The label says what the component now DOES: every glow is standard, and this
// row makes them all stronger (it used to own tile emitters alone).
assert.match(mainSrc, /\['💡 Bloom \(mocniejsza poświata\)','bloom'\]/, 'the bloom row is labelled as an amplifier');
assert.match(mainSrc, /\['🌑 Okluzja otoczenia \(AO\)','ao'\]/, 'AO row maps to its component');
assert.match(mainSrc, /\['💠 Refleksy materiałów','specular'\]/, 'specular row maps to its component');
assert.match(mainSrc, /\['🌊 Odbicia w wodzie','reflections'\]/, 'reflections row maps to its component');
assert.match(mainSrc, /\['🪞 Powłoka bohatera i broni','heroSheen'\]/, 'hero coating row maps to its component (it covers the blade sheen too)');
assert.match(mainSrc, /\['🌗 Dynamiczne cienie','shadows'\]/, 'dynamic shadows row maps to its component');
assert.match(mainSrc, /\['☀️ Promienie słoneczne','godRays'\]/, 'god rays row maps to its component');
assert.match(mainSrc, /\['🔥 Temperatura światła','lightTint'\]/, 'light temperature row maps to its component');
assert.match(mainSrc, /\['🌫️ Drganie powietrza','heatShimmer'\]/, 'heat shimmer row maps to its component');
assert.match(mainSrc, /\['🌧️ Mokra nawierzchnia','wetGround'\]/, 'wet ground row maps to its component');
assert.match(mainSrc, /\['✨ Pyłki w świetle','dustMotes'\]/, 'dust motes row maps to its component');
assert.match(mainSrc, /\['🧊 Odbicia na lodzie','iceReflections'\]/, 'ice reflections row maps to its component');
assert.match(mainSrc, /if\(gfxUltraOn\('godRays'\) && POST_FX\.drawGodRaysPass\)/, 'god rays pass is gated');
// FOLIAGE only. A roof is made of leaves; wood is the post holding it up, and
// feeding trunks to the scan put the underside of the "canopy" at the base of
// the nearest tree — which is to say, on the ground.
assert.match(mainSrc, /isCanopy:isLeaf,/, 'god rays read the shared foliage predicate, and only that');
assert.ok(!/isCanopy:\(t\)=>isLeaf\(t\)\|\|isWood\(t\)/.test(mainSrc), 'trunks are no longer mistaken for roof');
assert.match(mainSrc, /if\(gfxUltraOn\('lightTint'\) && POST_FX\.drawLightTintPass\)/, 'light tint pass is gated');
assert.match(mainSrc, /if\(gfxUltraOn\('heatShimmer'\) && POST_FX\.drawHeatShimmerPass\)/, 'heat shimmer pass is gated');
assert.match(mainSrc, /pools:\(GEOTHERMAL && GEOTHERMAL\.poolsNear\)/, 'heat shimmer covers geothermal pools via the existing registry');
assert.match(mainSrc, /burning:\(FIRE && FIRE\.burningNear\)/, 'burning blocks feed the shimmer as live heat sources, off the fire registry');
assert.match(readFileSync(new URL('../src/engine/fire.js', import.meta.url), 'utf8'), /function burningNear\(x,r\)/, 'the fire module owns the read-only heat-source feed');
assert.match(mainSrc, /if\(gfxUltraOn\('wetGround'\) && POST_FX\.drawWetGroundPass\)/, 'wet ground pass is gated');
assert.match(mainSrc, /rainingAt:\(x\)=>!!\(CLOUDS && CLOUDS\.isRainingAt && CLOUDS\.isRainingAt\(x\)\)/, 'wet ground reads real per-column rain from the cloud sim');
assert.match(mainSrc, /function gfxWetSkipTile\(t\)/, 'frozen surfaces are excluded from the wet sheen');
assert.match(mainSrc, /if\(gfxUltraOn\('dustMotes'\) && POST_FX\.drawDustMotesPass\)/, 'dust motes pass is gated');
assert.match(mainSrc, /if\(gfxUltraOn\('iceReflections'\) && POST_FX\.drawIceReflectionsPass\)/, 'ice reflections pass is gated');
// Frame ordering: light tint before bloom (ambience under the cores); god rays
// over world content but before smoke.
const iTint = mainSrc.indexOf("gfxUltraOn('lightTint')");
const iRays = mainSrc.indexOf("gfxUltraOn('godRays')");
const iSmoke = mainSrc.indexOf('SMOKE.draw(ctx,TILE,sx,sy,viewX,viewY,worldFxVisible)');
const iShimmer = mainSrc.indexOf("gfxUltraOn('heatShimmer')");
assert.ok(iTint > 0 && iTint < iBloom, 'light tint paints under the bloom cores');
assert.ok(iRays > 0 && iSmoke > iRays, 'god rays draw before smoke veils them');
// Heat shimmer refracts what is BEHIND the hot air, so it must land on the
// finished world but UNDER everything the heat itself throws off. A flame sprite
// animates its own bend; distorting it as well doubled the motion into an
// artefact, which is exactly why this ordering is pinned and not incidental.
const iFire = mainSrc.indexOf('FIRE.draw(ctx,TILE,sx,sy,viewX,viewY,getTile,worldFxVisibility())');
const iGases = mainSrc.indexOf('GASES.draw(ctx,TILE,sx,sy,viewX,viewY,worldFxVisible)');
const iHeroSprite = mainSrc.indexOf('drawPlayer({rearView:mirrorFacing})');
assert.ok(iShimmer > 0 && iFire > 0 && iGases > 0 && iHeroSprite > 0, 'the shimmer ordering anchors all exist');
assert.ok(iShimmer < iFire, 'flames are composited OVER the shimmer, never through it');
assert.ok(iShimmer < iGases && iShimmer < iSmoke, 'hot air, steam and smoke ride over the plume that produced them');
assert.ok(iShimmer > iHeroSprite, 'the finished world (hero included) is what the plume refracts');
assert.ok(iShimmer < iLight, 'heat shimmer distorts the scene before the darkness overlay');
assert.match(mainSrc, /if\(gfxUltraOn\('shadows'\) && POST_FX\.drawCasterShadow\)/, 'hero drop shadow upgrades to the solar model only behind the toggle');
assert.match(mainSrc, /sunlit:gy<=shSurf/, 'hero shadow goes directional only on sunlit ground');
assert.match(mainSrc, /if\(gfxUltraOn\('shadows'\) && POST_FX\.drawTreeShadowsPass\)/, 'tree shadow pass is gated');
assert.match(mainSrc, /isTrunk:isWood,visibleAt:worldFxVisible/, 'tree scan uses the shared wood predicate and the fog predicate');
const iShadowPass = mainSrc.indexOf("gfxUltraOn('shadows') && POST_FX.drawTreeShadowsPass");
const iHeroDraw = mainSrc.indexOf('drawPlayer({rearView:mirrorFacing})');
assert.ok(iShadowPass > 0 && iHeroDraw > iShadowPass, 'tree shadows draw under the hero and entities');

// Mob shadows live inside MOBS.draw with replace-semantics: the directional
// shadow draws INSTEAD of the species contact blob (never both), only for
// sunlit surface mobs, after the mob's own fog gate has already run.
const mobsSrc = readFileSync(new URL('../src/engine/mobs.js', import.meta.url), 'utf8');
assert.match(mobsSrc, /MM\.postFx && MM\.postFx\.on && MM\.postFx\.on\('shadows'\) && MM\.postFx\.drawCasterShadow/, 'mobs hoist the ultra-shadow gate once per frame');
assert.match(mobsSrc, /let ultraShadowDrawn=false;/, 'each mob tracks whether the directional shadow replaced its blob');
assert.match(mobsSrc, /if\(spec && spec\.ground && !ultraShadowDrawn\)\{/, 'the legacy contact blob is skipped exactly when the directional shadow drew');
assert.match(mobsSrc, /if\(mgy<=msurf\)\{/, 'only sunlit surface mobs switch to the directional shadow (caves keep the blob)');
assert.ok(!mainSrc.includes('worldFxVisible(stx,sgy)'), 'the old main.js mob-shadow loop is gone (mobs.js owns mob shadows)');
assert.match(mainSrc, /if\(!deathTravelFx && heroCloakA>=0\.98 && POST_FX && POST_FX\.drawHeroSheenPass && POST_FX\.on\('heroSheen'\)\)/, 'hero coating skips death travel and cloak, and computes its inputs only when enabled');
assert.match(mainSrc, /tileColor:minimapTileColor,/, 'hero coating samples through the minimap palette by REFERENCE (one shared table keeps the rgb cache warm)');
assert.match(mainSrc, /px:sheenPx, py:Math\.floor\(player\.y\),/, 'hero coating probes the world at the hero tile');
// The mirror grab must happen BEFORE any part of the hero lands on the canvas,
// otherwise the coat reflects the hero (and its cape) back onto itself.
assert.match(mainSrc, /POST_FX\.captureHeroBackdrop\(ctx,\{bx:\(player\.x-player\.w\/2\)\*TILE/, 'the coat grabs its backdrop through the pass API');
const iGrab = mainSrc.indexOf('POST_FX.captureHeroBackdrop(ctx,{');
const iCape = mainSrc.indexOf('if(!mirrorFacing){ if(heroCloakA<1) ctx.globalAlpha=heroCloakA; drawCape();');
const iHero = mainSrc.indexOf('drawPlayer({rearView:mirrorFacing});');
const iSheen = mainSrc.indexOf('POST_FX.drawHeroSheenPass(ctx,{');
assert.ok(iGrab > 0 && iCape > iGrab && iHero > iGrab && iSheen > iHero, 'grab -> cape -> hero -> coat: the snapshot predates the sprite, the coat follows it');
// Eyes are not reflective: ONE routine paints them, called from the sprite and
// again over the finished coat, with the geometry the sprite actually used
// (recoil squashes the body rect — a recomputed replay would drift).
assert.match(mainSrc, /function drawHeroEyes\(bodyX,bodyY,bw,bh,style,c\)\{/, 'eye rendering is a single shared routine');
assert.match(mainSrc, /if\(!remoteBody\) heroEyeReplay=\{bodyX,bodyY,bw,bh,style,c\};/, 'the local hero records the exact geometry it drew eyes with');
assert.match(mainSrc, /if\(heroEyeReplay\) drawHeroEyes\(heroEyeReplay\.bodyX,heroEyeReplay\.bodyY,heroEyeReplay\.bw,heroEyeReplay\.bh,heroEyeReplay\.style,heroEyeReplay\.c\);/, 'the coat replays the eyes on top of its reflection');
const iEyeReplay = mainSrc.indexOf('if(heroEyeReplay) drawHeroEyes(');
assert.ok(iEyeReplay > iSheen, 'the eye replay lands AFTER the coat pass (eyes on top, never mirrored over)');
// The full-scene grab must sit after the world content (so creatures, fire and
// water are in the reflection) but BEFORE the darkness overlay (the coat is
// dimmed by that overlay itself — grabbing after it would double the dimming).
assert.match(mainSrc, /POST_FX\.captureHeroScene\(ctx\);/, 'the coat grabs the finished world once per frame');
const iSceneGrab = mainSrc.indexOf('POST_FX.captureHeroScene(ctx);');
const iMobsDraw = mainSrc.indexOf('if(MOBS && MOBS.draw) MOBS.draw(ctx,TILE,camRenderX,camRenderY,zoom,worldFxVisible,viewX,viewY);');
const iDark = mainSrc.indexOf('drawLightingOverlay(sx,sy,viewX,viewY,{camX:camRenderX');
assert.ok(iMobsDraw > 0 && iSceneGrab > iMobsDraw && iDark > iSceneGrab, 'scene grab: after the creatures/effects, before the darkness overlay');
// The held weapon closes the hero group: a swung blade passes in FRONT of the
// eyes, and the suit's coat must not paint over the blade's own sheen.
const iHeld = mainSrc.indexOf('WEAPONS.drawHeld) WEAPONS.drawHeld(ctx,TILE,player);');
assert.ok(iHeld > iEyeReplay, 'the held weapon draws after the coat AND the eye replay');
// The cape belongs to the hero, so it is erased from the grab the coat mirrors.
assert.match(mainSrc, /function heroCapeSpanPx\(\)\{/, 'the cape span is measured for the coat grab');
assert.match(mainSrc, /erase:heroCapeSpanPx\(\)\}\);/, 'the grab erases the cape along with the body');
assert.match(mainSrc, /const segs=\(CAPE && CAPE\._segments\) \? CAPE\._segments : null;/, 'the cape span reads the live cape simulation, not a guessed box');
assert.match(postFxSrc, /if\(opts\.erase && Number\.isFinite\(opts\.erase\.x\)/, 'captureHeroBackdrop unions the erase rect into its patch');

// --- blade sheen ---------------------------------------------------------------
// Anisotropic by construction: the whole grabbed field is squeezed across the
// blade and stretched along it, which is how polished metal actually reflects.
const weaponsSrc = readFileSync(new URL('../src/engine/weapons.js', import.meta.url), 'utf8');
assert.match(weaponsSrc, /const SHEEN_MATERIALS=new Set\(\['steel','diamond','iridium','obsidian','aquatic','arc','exotic'\]\);/, 'only polished materials mirror the world (wood and rough stone stay matte)');
assert.match(weaponsSrc, /function drawBladeSheen\(ctx,material,x,y,w,h\)\{/, 'weapons own the geometry, post_fx owns the look');
assert.match(weaponsSrc, /P\.on\('heroSheen'\)/, 'the blade sheen rides the hero-coating toggle');
assert.match(weaponsSrc, /drawBladeSheen\(ctx,material,-1\.2,-bladeLen,2\.4,bladeLen\);/, 'the sword blade rect gets the sheen');
assert.match(weaponsSrc, /drawBladeSheen\(ctx,material,-1,-16,2,19\);/, 'the trident shaft gets the sheen');
// A polygon head (axe/spear/prongs) must NOT be handed to a rectangular clip.
assert.equal((weaponsSrc.match(/(?<!function )drawBladeSheen\(ctx,material,-/g) || []).length, 2, 'exactly the two rectangular metal shapes carry the sheen');
postFx.set('heroSheen', true);
const bladeCtx = makeRichCtx();
postFx.captureHeroBackdrop(makeMirrorCtx(), { bx: 100, by: 100, bw: 14, bh: 19 });
assert.equal(postFx.drawBladeSheenPass(bladeCtx, { x: -1.2, y: -14, w: 2.4, h: 14 }), 1, 'the blade sheen draws from the shared grab');
assert.ok(bladeCtx.drawSources.length > 0, 'the blade sheen blits the grabbed field (not a flat gradient)');
postFx.set('heroSheen', false);
assert.equal(postFx.drawBladeSheenPass(makeRichCtx(), { x: 0, y: 0, w: 3, h: 14 }), 0, 'no blade sheen while the coat is off');
postFx.releaseScratch();
// The coat covers the WHOLE outfit rect (inventory.js drawOutfit fills a plain
// rect + 1px outline). ANY inset is world-space, so it grows with zoom into a
// visible ring of bare outfit colour between the outline and the coat.
assert.match(postFxSrc, /ctx\.rect\(bx, by, bw, bh\);\n\t\tctx\.clip\(\);/, 'the coat clips to the full body rect — no inset ring');
assert.ok(!postFxSrc.includes('roundRect(bx + bw * 0.06'), 'the inset capsule clip is gone');
assert.ok(!postFxSrc.includes('ctx.rect(bx + 1, by + 1, bw - 2, bh - 2)'), 'the 1px inset clip is gone (it read as a second border)');
// No self-animating sweep: a standing hero must show a still coat.
assert.ok(!/hg\.addColorStop|bw \* 2\.2 \* phase/.test(postFxSrc), 'the travelling diagonal highlight is gone (it animated while standing still)');
// Not mirror-flipped: the surroundings are shrunk IN PLACE, so scenery keeps
// the side it really stands on (a flip only suits a plane facing the viewer).
assert.ok(!postFxSrc.includes('setTransform(-1, 0, 0, 1, w, 0)'), 'the coat is no longer flipped left-to-right');
assert.match(postFxSrc, /g\.globalCompositeOperation = 'destination-in';/, 'a Fresnel alpha mask thins the coat over the middle (the face stays readable)');
// The mask MUST be applied on the off-screen coat: a destination-in fill on the
// live scene canvas would erase the world behind the hero.
const iCoatFn = postFxSrc.indexOf('function buildHeroCoat(');
const iCoatEnd = postFxSrc.indexOf('\n}', iCoatFn);
assert.ok(iCoatFn > 0 && postFxSrc.slice(iCoatFn, iCoatEnd).includes("destination-in"), 'the destination-in mask lives inside the off-screen coat builder');
assert.match(mainSrc, /submerged:waterLevelUnitsAt\(sheenPx,Math\.floor\(player\.y\)\)>0/, 'hero coating reads submersion from the water ledger');
assert.match(mainSrc, /if\(gfxName==='ao' \|\| gfxName==='specular'\) invalidateAllChunkRenderCaches\(\);/, 'baked components force a re-bake when toggled');
assert.match(mainSrc, /panel\.querySelectorAll\('\[data-gfx-toggle\]'\)\.forEach\(chk=>\{ chk\.checked=!!\(POST_FX && POST_FX\.config && POST_FX\.config\[chk\.dataset\.gfxToggle\]\); \}\);/, 'panel reopen resyncs component checkboxes');
for(const name of GFX_COMPONENTS) assert.ok(mainSrc.includes("'" + name + "'"), 'component ' + name + ' has a UI mapping in main.js');

// --- entity glow: source contracts ---------------------------------------------
// Creature light must be REGISTERED, not painted where the creature is drawn: the
// darkness overlay lands between the two, so a hand-rolled halo gets dimmed by
// the night it exists to cut through.
const threatSrc = readFileSync(new URL('../src/engine/threat_look.js', import.meta.url), 'utf8');
assert.match(postFxSrc, /addEmissive\(src\)\{/, 'post_fx owns the registry inlet');
assert.match(mobsSrc, /const glowAt=\(x,y,r,color,a,part\)=>\{/, 'mobs register glow through one helper');
assert.match(mobsSrc, /const EMISSIVE=\(typeof window!=='undefined' && window\.MM && MM\.postFx && MM\.postFx\.addEmissive\) \? MM\.postFx : null;/, 'the registry lookup is hoisted once per frame and fails soft');
assert.match(mobsSrc, /function mobGlowKey\(m\)\{/, 'trail identity is per instance, not per species');
assert.ok(!mobsSrc.includes("m.spawnT+':'+m.id") && /if\(!m\._gk\) m\._gk='m'\+\(\+\+glowKeySeq\)\+':';/.test(mobsSrc), 'the trail key is a counter — spawn timestamps collide inside a spawn batch');
// Every converted species must be gone from the flat-disc pattern. These are the
// exact shapes the user could see: a constant-alpha ellipse or arc with a hard rim.
assert.ok(!mobsSrc.includes("ctx.ellipse(screenX,screenY-3,12,6,0,0,Math.PI*2)"), 'the radiation cockroach green blob is gone');
assert.ok(!mobsSrc.includes("ctx.arc(screenX, screenY, 6,0,Math.PI*2)"), 'the firefly flat halo disc is gone');
assert.ok(!mobsSrc.includes("ctx.ellipse(screenX-2,screenY-12,36,22,0,0,Math.PI*2)"), 'the atomic bomb aura ellipse is gone');
assert.ok(!mobsSrc.includes('function goldGlowSprite()'), 'the golden sprinter no longer bakes its own private halo sprite');
assert.ok(!mobsSrc.includes("ctx.arc(screenX,screenY-4,22,0,Math.PI*2)"), 'the seraph halo disc is gone');
const glowCalls = (mobsSrc.match(/glowAt\(/g) || []).length;
assert.ok(glowCalls >= 15, 'the converted species all register their light: ' + glowCalls);
// Eyes: the art keeps its own pixels; the registry only adds the light they emit.
assert.match(mobsSrc, /const eyeGlow=\(x,y,w,h,base,lit\)=>\{/, 'eyeGlow draws the art eye AND registers its light');
assert.match(mobsSrc, /if\(!lit && grade<3\) return col;/, 'only a natively lit eye or a grade-3+ menace stare glows');
assert.match(mobsSrc, /glowAt\(screenX\+faceDir\*ea\[0\], screenY\+ea\[1\], 4\.4\+g\*0\.6, eyeTint\('#ff3018'\), 0\.18\+0\.09\*\(g-2\), 'stare'\);/, 'the generic menace stare hangs off threat_look\'s measured head anchor');
assert.ok(!/eyeGlow\([^)]*\)\s*;\s*\n\s*ctx\.fillStyle=eyeTint/.test(mobsSrc), 'a converted face does not also paint its eyes the old way');
// The shaman's staff focus is a lamp on a swinging stick: registered, with the
// local sprite kept only as the no-registry fallback.
assert.match(threatSrc, /fx\.addEmissive\(\{x:gx,y:gy,r:r\*3\.4,color:col,a:0\.46\+0\.16\*Math\.sin\(phase\*2\.1\),key:staffGlowKey\(m\),trail:true\}\);/, 'the staff focus registers its glow with a trail');
assert.match(threatSrc, /function staffGlowKey\(m\)\{/, 'the staff focus has its own per-instance trail identity');
// Trails are world-space by construction. A screen-space accumulation buffer is
// the other standard answer and it is WRONG here: it smears with the camera.
// This guard used to be vacuous: indexOf('drawHeroSheenPass') matched a COMMENT
// hundreds of lines before drawGlowPass, so slice(start > end) returned '' and the
// assertion passed on an empty string. Anchored on the definitions now, and it
// checks the thing that actually matters — no canvas is created in the pass at all.
const glowBody = postFxSrc.slice(postFxSrc.indexOf('drawGlowPass(ctx, opts){'), postFxSrc.indexOf('drawHeroSheenPass(ctx, opts){'));
assert.ok(glowBody.length > 1000, 'the glow pass body was actually located (the old slice was empty)');
assert.ok(!/createElement\('canvas'\)|canvas\.width = /.test(glowBody), 'the glow pass allocates no canvas and no full-screen accumulation buffer');

// --- frame-seam allocation contracts (audit 2026-07-26) ------------------------
// Pure helpers that run several times per frame memoize per item/colour/grade,
// with guard fields so an in-place mutation (fusion, upgrades) re-derives.
assert.match(weaponsSrc, /const weaponSeedMemo=new WeakMap\(\);/, 'weapon visual seed memoized per item');
assert.match(weaponsSrc, /const weaponMaterialMemo=new WeakMap\(\);/, 'weapon material profile memoized per item');
assert.match(weaponsSrc, /hit\.tier===it\.tier && hit\.unique===it\.unique && hit\.wt===it\.weaponType/, 'the material memo re-derives when the item mutates in place');
assert.match(weaponsSrc, /const weaponRgbaPrefix=new Map\(\);/, 'the hex→rgba prefix is memoized per colour (emissiveRgb pattern)');
assert.match(threatSrc, /const eyeColorMemo=\[\];/, 'menace eye colours memoized per (grade, base hex)');
assert.match(mobsSrc, /const kc=m\._gkc\|\|\(m\._gkc=\{\}\);/, 'mob trail keys cached on the instance — no string concat per part per frame');
// The volcano's trail-key counter is MODULE state: a per-draw reset handed two
// shots born on different frames the same key, swapping their streaks.
const volcanoSeqSrc = readFileSync(new URL('../src/engine/volcano.js', import.meta.url), 'utf8');
const iVolDraw = volcanoSeqSrc.indexOf('function draw(ctx,TILE,canDrawTile,getTile){');
assert.ok(iVolDraw > 0, 'volcano draw was located');
const iVolSeq = volcanoSeqSrc.indexOf('let shotSeq=0;');
assert.ok(iVolSeq > 0 && iVolSeq < iVolDraw, 'the volcano trail-key counter lives at module scope, not reset per draw');
// The chest-cull bug class, remaining instances: fog visibility is NOT a
// viewport test, so a discovered but off-screen meteor/sigil still registered
// its glow and burned one of the 128 shared slots. The pinned draw signatures
// carry no camera, so the bounds come off the world transform.
assert.match(volcanoSeqSrc, /if\(m\.x<vx0 \|\| m\.x>vx1 \|\| m\.y<vy0 \|\| m\.y>vy1\) continue;/, 'a discovered off-screen sigil cannot burn a shared glow slot');
const meteorGlowSrc = readFileSync(new URL('../src/engine/meteorites.js', import.meta.url), 'utf8');
assert.match(meteorGlowSrc, /if\(m\.x<vx0 \|\| m\.x>vx1 \|\| m\.y<vy0 \|\| m\.y>vy1\) continue;/, 'a discovered off-screen meteor cannot burn a shared glow slot');
// ONE time snapshot per frame: BACKGROUND.timeInfo() walks the whole seasons
// metrics chain (~11 allocations), and the gfx call sites used to call it — or
// currentDaylight() around it — up to nine times per frame.
assert.match(mainSrc, /frameTimeInfo=\(BACKGROUND && BACKGROUND\.timeInfo\)\?BACKGROUND\.timeInfo\(\):null;\n frameDaylight=currentDaylight\(\);/, 'draw() refreshes the frame time snapshot first');
// The pass never read frameMs — it was dead plumbing, and dead plumbing next to
// a frame-time variable is how a degradation gets added by accident later.
assert.match(mainSrc, /time:frameTimeInfo,daylight:frameDaylight\}\);/, 'god rays ride the frame snapshot');
assert.ok(!/drawGodRaysPass\(ctx,\{[^}]*frameMs/.test(mainSrc), 'god rays are not even handed the frame clock');
assert.match(mainSrc, /sunlit:gy<=shSurf,time:frameTimeInfo\}/, 'the caster shadow rides the frame snapshot');
assert.match(mainSrc, /visibleAt:worldFxVisible,time:frameTimeInfo,frameMs:lastFrameMs\}/, 'tree shadows ride the frame snapshot');
const iEmissive = mainSrc.indexOf('POST_FX.drawGlowPass(ctx');
const iFogPass = mainSrc.indexOf('drawFogOverlay(sx,sy,viewX,viewY,{camX:camRenderX');
assert.ok(iEmissive > iDark, 'creature light draws ABOVE the darkness overlay (that is the whole point)');
assert.ok(iEmissive > iSceneGrab, 'the hero-coat scene grab happens before the glow lands (the coat must not mirror halos)');
assert.ok(iFogPass > iEmissive, 'creature light stays BELOW the fog pass (undiscovered black still wins)');

// --- the glow attribute across every domain ------------------------------------
// The rule: a thing that emits light DECLARES a glow descriptor and post_fx draws
// it. These pins are what stops a domain from quietly going back to painting its
// own halo — and what stops a converted one from losing its light.
const domainSrc = (rel) => readFileSync(new URL('../src/engine/' + rel, import.meta.url), 'utf8');
const weaponsGlowSrc = weaponsSrc;
// hero shots
assert.match(weaponsGlowSrc, /const PROJECTILE_GLOW=\{/, 'weapons declare which shots glow as a table, not per draw site');
assert.match(weaponsGlowSrc, /function registerProjectileGlow\(a,TILE\)\{/, 'one seam registers a shot\'s light');
assert.match(weaponsGlowSrc, /if\(!a\.stuck && !a\.embeddedMob\) registerProjectileGlow\(a,TILE\);/, 'a shot in flight registers its light; a stuck one does not');
// The projectile trail's glow no longer comes from shadowBlur — the most
// expensive way Canvas2D can fake one. (The held-weapon CHARGE fx still use it
// for their short bursts; the steady light they sit on is registered instead.)
const iPrestigeTrail = weaponsGlowSrc.indexOf('function drawProjectilePrestigeTrail(');
const prestigeTrailBody = weaponsGlowSrc.slice(iPrestigeTrail, weaponsGlowSrc.indexOf('\n  }', iPrestigeTrail));
assert.ok(iPrestigeTrail > 0 && !/ctx\.shadowBlur=/.test(prestigeTrailBody), 'the projectile trail no longer fakes its glow with shadowBlur');
assert.match(weaponsGlowSrc, /key:'heldWeaponLight',trail:true/, 'a glowing held weapon registers its light and streaks with the hero');
assert.match(weaponsGlowSrc, /glow:\{color:'#8fdd7f', r:6, a:0\.30, trail:true\}/, 'ammo can carry its own glow attribute (toxic snowball)');
// mob shots
assert.match(mobsSrc, /const PROJECTILE_GLOW=\{/, 'mob shots declare their light one row per kind');
assert.match(mobsSrc, /const pg=PROJECTILE_GLOW\[pr\.type\];/, 'the projectile loop looks the attribute up by kind');
for(const kind of ['dragon_fire', 'radiant', 'stormbolt', 'voidbolt']){
	assert.ok(mobsSrc.includes(kind + ':'), 'the bolt kind ' + kind + ' declares a glow');
}
// ground loot
const dropsSrc = domainSrc('drops.js');
assert.match(dropsSrc, /const TIER_GLOW=\{/, 'loot declares one frozen glow descriptor per tier');
assert.match(dropsSrc, /EMISSIVE\.glow\(px,py,spec,d\.settled\?null:dropGlowKey\(d\),TILE\)/, 'a drop still in the air streaks; a settled one does not');
assert.ok(!dropsSrc.includes('function haloSprite('), 'loot no longer bakes its own private halo sprite');
// fire: the halo level and the LIT level are the same number
const fireSrc = domainSrc('fire.js');
assert.match(fireSrc, /const BURN_GLOW=Object\.freeze\(\{level:12, color:'#ff8c32', pulse:0\.30\}\);/, 'a burning block declares its glow at the light field\'s own level');
assert.match(lightingSrc, /const FIRE_LEVEL = 12;/, 'the light field still rates fire at 12 — the two must agree');
// machines
const teleSrc = domainSrc('teleporters.js');
assert.match(teleSrc, /const PORTAL_GLOW=Object\.freeze\(/, 'a charged gate declares its glow');
assert.ok(!/rg\.addColorStop\(0,'rgba\(124,247,255,'/.test(teleSrc), 'the gate no longer builds a radial gradient per frame');
const padSrc = domainSrc('spring_platforms.js');
assert.match(padSrc, /const PAD_GLOW=Object\.freeze\(/, 'a charged launch pad declares its glow');
assert.ok(!/rg\.addColorStop\(0,'rgba\(255,246,160,'/.test(padSrc), 'the pad no longer builds a radial gradient per frame');
const turretSrc = domainSrc('turrets.js');
assert.match(turretSrc, /const PUFF_GLOW=\{/, 'turret tracers declare their glow per kind');
assert.match(turretSrc, /trail:true/, 'a tracer in flight streaks');
// falling fire and hurled sigils
const meteorSrc = domainSrc('meteorites.js');
assert.match(meteorSrc, /const METEOR_GLOW=Object\.freeze\(/, 'a fireball declares its glow');
assert.match(meteorSrc, /for\(let i=m\.trail\.length-1;i>0;i--\)/, 'the meteor keeps its own two-tone tail (richer than the generic streak, and already world-space)');
const volcanoSrc = domainSrc('volcano.js');
assert.match(volcanoSrc, /const MASTER_SHOT_GLOW=Object\.freeze\(\{color:'#ff5028', rTiles:0\.72, a:0\.48, trail:true\}\);/, 'a hurled sigil declares glow AND streak');
// hero-worn light
const necklaceSrc = domainSrc('necklace.js');
assert.match(necklaceSrc, /key:'necklaceGem',trail:true/, 'a charged pendant streaks as the hero runs');
assert.ok(!/rg\.addColorStop\(0, ?'rgba\(255,246,170,'/.test(necklaceSrc), 'the pendant no longer builds its own gradient halo');
const antennaSrc = domainSrc('antennas.js');
assert.match(antennaSrc, /key: 'antennaTip', trail: true/, 'the antenna tip streaks as the hero runs');
// treasure
assert.match(mainSrc, /const CHEST_TIER_GLOW=\{/, 'chests declare a glow descriptor per tier');
assert.match(mainSrc, /POST_FX\.glow\(cxp,cyp,CHEST_TIER_GLOW\[t\]\|\|CHEST_TIER_GLOW\.def,null,TILE\);/, 'the chest aura goes through the shared renderer');
assert.equal(bloomSourceFor(T.CHEST_LEGENDARY), null, 'chests stay OUT of the tile scan (only their own pass knows the pulse)');
// Descriptors are DATA: frozen so a draw site cannot mutate a shared row, and
// only the documented keys mean anything.
assert.equal(normalizeGlow({ color: '#fff', nonsense: 5 }, 20), null, 'an unknown key alone does not make a glow');
assert.ok(Object.isFrozen(TILE_GLOW[T.TORCH]), 'tile glow rows are frozen');

// Celestial bloom: the sun/moon are screen-space (no tile the emitter scan can
// find), so background.js carries its own gated halo — one per body.
const backgroundSrc = readFileSync(new URL('../src/engine/background.js', import.meta.url), 'utf8');
const celestialBloomGates = backgroundSrc.match(/MM\.postFx\.on && MM\.postFx\.on\('bloom'\)/g) || [];
assert.equal(celestialBloomGates.length, 2, 'sun AND moon each carry one gated ultra bloom halo');

// Water reflections: inside the source-atop clip, drawImage-only, fog-guarded.
assert.match(waterSrc, /postFx\.on && postFx\.on\('reflections'\)/, 'water reflections gate on the ultra flag');
assert.match(waterSrc, /const srcCanvas=ctx\.canvas;/, 'reflections sample the live canvas as a texture source');
assert.match(waterSrc, /g\.scale\(1,-1\);/, 'reflections flip the strip vertically');
assert.match(waterSrc, /if\(ty<WORLD_TOP \|\| !tileVisible\(wx,ty\)\) break;/, 'fog-hidden airspace shortens the reflection band (no unexplored leaks)');
const iAtop = waterSrc.indexOf("g.globalCompositeOperation='source-atop';");
const iRefl = waterSrc.indexOf("postFx.on('reflections')");
const iCaustic = waterSrc.indexOf('let causticBudget');
assert.ok(iAtop > 0 && iRefl > iAtop && iCaustic > iRefl, 'reflections draw inside the water-shape clip, under the sheen garnish');

console.log('post-fx-sim: all assertions passed');
