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
	wetGroundStep, collectCanopyGaps, collectIceRuns
} = await import('../src/engine/post_fx.js');
const { T, INFO } = await import('../src/constants.js');
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
assert.equal(bloomScanIntervalMs(16), 120, 'healthy frames rescan at the fast cadence');
assert.equal(bloomScanIntervalMs(30), 250, 'stressed frames rescan slower');
assert.equal(bloomScanIntervalMs(50), 400, 'critical frames rescan slowest');
assert.ok(bloomScanIntervalMs(undefined) === 120, 'missing frame time assumes healthy');

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

// --- drawBloomPass behavior ---------------------------------------------------
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
const offCtx = makeCtx();
assert.equal(postFx.drawBloomPass(offCtx, { TILE: 20, sx: 0, sy: 0, viewX: 8, viewY: 8, getTile }), 0, 'bloom disabled draws nothing');
assert.equal(offCtx.calls.length, 0, 'bloom disabled touches no canvas state');
window.__mmForceGfxUltra = true;
const onCtx = makeCtx();
const drawn = postFx.drawBloomPass(onCtx, { TILE: 20, sx: 0, sy: 0, viewX: 8, viewY: 8, getTile, frameMs: 16 });
assert.ok(drawn >= 2, 'forced ultra draws a halo per visible emitter');
assert.ok(onCtx.calls.includes('drawImage') && onCtx.calls[0] === 'save' && onCtx.calls[onCtx.calls.length - 1] === 'restore', 'bloom wraps its composite state in save/restore');
assert.ok(postFx.metrics.bloomScans >= 1 && postFx.metrics.bloomDraws >= 2, 'bloom metrics record scans and draws');
delete window.__mmForceGfxUltra;

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
const offscreen = makeMirrorCtx();
assert.equal(postFx.captureHeroBackdrop(offscreen, { bx: -9000, by: -9000, bw: 14, bh: 19 }), 0, 'a hero past the screen edge grabs nothing (no bogus blit)');
postFx.set('heroSheen', false);

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
		fillStyle: '', globalAlpha: 1, globalCompositeOperation: 'source-over', imageSmoothingEnabled: false,
		canvas: { width: 1600, height: 900 },
		getTransform(){ return { a: 1, b: 0, c: 0, d: 1, e: 700, f: 400 }; },
		save(){}, restore(){}, beginPath(){}, closePath(){}, rect(){}, clip(){},
		translate(){}, scale(){}, moveTo(){}, lineTo(){}, fill(){ ctx.fills++; }, ellipse(){ ctx.fills++; },
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
for(const cx of [10, 11, 12, 16, 17, 18]) matrixWorld.set(gk(cx, 16), T.LEAF); // canopy with a gap at 13-15
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
assert.equal((postFxSrc.match(/snapshotSceneCanvas\(ctx\.canvas\)/g) || []).length, 2, 'both self-blit passes stage through the scene snapshot');
assert.ok(!/drawImage\(ctx\.canvas/.test(postFxSrc), 'no post_fx pass blits the live canvas onto itself directly');

// Standard-mode zero cost: EVERY pass invocation in main.js sits behind a
// component gate (gfxUltraOn / POST_FX.on within the guarding block), so a
// disabled component costs neither the call nor its opts object. A new pass
// added without the gate fails here, not in a profiler.
const passCalls = [...mainSrc.matchAll(/POST_FX\.draw\w+\(ctx/g)];
assert.ok(passCalls.length >= 9, 'all pass invocations are present in main.js');
for(const m of passCalls){
	const back = mainSrc.slice(Math.max(0, m.index - 420), m.index);
	assert.ok(back.includes("gfxUltraOn('") || back.includes("POST_FX.on('"), 'pass invocation missing a component gate near: ' + mainSrc.slice(m.index, m.index + 60));
}

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
assert.match(mainSrc, /const specStressed=lastFrameMs>32;/, 'live specular glints degrade (not vanish) on stressed frames');
assert.match(mainSrc, /let specBudget=specStressed\?48:120, specDrawn=0, specScan=specStressed\?600:1500;/, 'specular pass bounds the point WALK, with a reduced stressed-frame budget');
assert.match(mainSrc, /if\(\(cx3\+1\)\*CHUNK_W<sx-1 \|\| cx3\*CHUNK_W>sx\+viewX\+2\) continue;/, 'off-screen chunk columns are culled from the glint walk');
assert.match(mainSrc, /POST_FX\.metrics\.specGlints\+=specDrawn;/, 'specular pass reports its draw count');
assert.match(mainSrc, /POST_FX\.drawBloomPass\(ctx,\{TILE,sx,sy,viewX,viewY,getTile,visibleAt:worldFxVisible,poweredAt:\(x,y\)=>furnishingPoweredAt\(x,y\),frameMs:lastFrameMs\}\)/, 'bloom pass receives the fog predicate, the furnishing power gate, and the frame-health signal');

// Frame ordering: bloom sits above the darkness overlay and below the fog pass.
const iLight = mainSrc.indexOf('drawLightingOverlay(sx,sy,viewX,viewY,{camX:camRenderX');
const iBloom = mainSrc.indexOf('POST_FX.drawBloomPass');
const iFog = mainSrc.indexOf('drawFogOverlay(sx,sy,viewX,viewY,{camX:camRenderX');
assert.ok(iLight > 0 && iBloom > iLight && iFog > iBloom, 'bloom draws after cave darkness and before fog (undiscovered black wins)');

// Pause panel: master switch + one Polish row per component, resynced on reopen.
assert.match(mainSrc, /'✨ Grafika Ultra \(wszystko\)'/, 'master ultra row exists');
assert.match(mainSrc, /\['💡 Bloom \(poświata\)','bloom'\]/, 'bloom row maps to its component');
assert.match(mainSrc, /\['🌑 Okluzja otoczenia \(AO\)','ao'\]/, 'AO row maps to its component');
assert.match(mainSrc, /\['💠 Refleksy materiałów','specular'\]/, 'specular row maps to its component');
assert.match(mainSrc, /\['🌊 Odbicia w wodzie','reflections'\]/, 'reflections row maps to its component');
assert.match(mainSrc, /\['🪞 Powłoka bohatera','heroSheen'\]/, 'hero coating row maps to its component');
assert.match(mainSrc, /\['🌗 Dynamiczne cienie','shadows'\]/, 'dynamic shadows row maps to its component');
assert.match(mainSrc, /\['☀️ Promienie słoneczne','godRays'\]/, 'god rays row maps to its component');
assert.match(mainSrc, /\['🔥 Temperatura światła','lightTint'\]/, 'light temperature row maps to its component');
assert.match(mainSrc, /\['🌫️ Drganie powietrza','heatShimmer'\]/, 'heat shimmer row maps to its component');
assert.match(mainSrc, /\['🌧️ Mokra nawierzchnia','wetGround'\]/, 'wet ground row maps to its component');
assert.match(mainSrc, /\['✨ Pyłki w świetle','dustMotes'\]/, 'dust motes row maps to its component');
assert.match(mainSrc, /\['🧊 Odbicia na lodzie','iceReflections'\]/, 'ice reflections row maps to its component');
assert.match(mainSrc, /if\(gfxUltraOn\('godRays'\) && POST_FX\.drawGodRaysPass\)/, 'god rays pass is gated');
assert.match(mainSrc, /isCanopy:\(t\)=>isLeaf\(t\)\|\|isWood\(t\)/, 'god rays use the shared leaf/wood predicates');
assert.match(mainSrc, /if\(gfxUltraOn\('lightTint'\) && POST_FX\.drawLightTintPass\)/, 'light tint pass is gated');
assert.match(mainSrc, /if\(gfxUltraOn\('heatShimmer'\) && POST_FX\.drawHeatShimmerPass\)/, 'heat shimmer pass is gated');
assert.match(mainSrc, /pools:\(GEOTHERMAL && GEOTHERMAL\.poolsNear\)/, 'heat shimmer covers geothermal pools via the existing registry');
assert.match(mainSrc, /if\(gfxUltraOn\('wetGround'\) && POST_FX\.drawWetGroundPass\)/, 'wet ground pass is gated');
assert.match(mainSrc, /rainingAt:\(x\)=>!!\(CLOUDS && CLOUDS\.isRainingAt && CLOUDS\.isRainingAt\(x\)\)/, 'wet ground reads real per-column rain from the cloud sim');
assert.match(mainSrc, /function gfxWetSkipTile\(t\)/, 'frozen surfaces are excluded from the wet sheen');
assert.match(mainSrc, /if\(gfxUltraOn\('dustMotes'\) && POST_FX\.drawDustMotesPass\)/, 'dust motes pass is gated');
assert.match(mainSrc, /if\(gfxUltraOn\('iceReflections'\) && POST_FX\.drawIceReflectionsPass\)/, 'ice reflections pass is gated');
// Frame ordering: light tint before bloom (ambience under the cores); god rays
// over world content but before smoke; shimmer before the darkness overlay.
const iTint = mainSrc.indexOf("gfxUltraOn('lightTint')");
const iRays = mainSrc.indexOf("gfxUltraOn('godRays')");
const iSmoke = mainSrc.indexOf('SMOKE.draw(ctx,TILE,sx,sy,viewX,viewY,worldFxVisible)');
const iShimmer = mainSrc.indexOf("gfxUltraOn('heatShimmer')");
assert.ok(iTint > 0 && iTint < iBloom, 'light tint paints under the bloom cores');
assert.ok(iRays > 0 && iSmoke > iRays, 'god rays draw before smoke veils them');
assert.ok(iShimmer > iSmoke && iShimmer < iLight, 'heat shimmer distorts the scene before the darkness overlay');
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
