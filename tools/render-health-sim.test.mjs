// Render-health regressions (engine/render_health.js): the classifier that
// names WHY the game sits at 30 FPS. Three causes, three different fixes:
// 'throttled' (browser energy saver caps rAF while the sim is idle),
// 'software' (draw time dominates — the software-raster profiler signature),
// 'slow' (honest load). Hysteresis keeps one odd window (GC pause, tab
// switch) from flipping the stable verdict.
// Run: node tools/render-health-sim.test.mjs
import { strict as assert } from 'assert';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};

const { RH, HINTS, classifyWindow, createRenderHealth, blitProbe } = await import('../src/engine/render_health.js');

// --- window classification ------------------------------------------------------------
assert.equal(classifyWindow(16.7, 4, 5), 'ok', '60 FPS with modest work is healthy');
assert.equal(classifyWindow(33.4, 2, 3), 'throttled', '~30 FPS with an idle sim = the browser caps rAF');
assert.equal(classifyWindow(33.4, 2, 26), 'software', 'draw dominating the frame outranks the throttle band');
assert.equal(classifyWindow(30, 14, 8), 'slow', 'a busy ~30 FPS frame is honest load, not a cap');
assert.equal(classifyWindow(55, 30, 12), 'slow', 'heavy sim reads as slow');
assert.equal(classifyWindow(45, 2, 30), 'software', 'software raster at sub-30 still names the draw');
assert.equal(classifyWindow(0, 0, 0), 'warming', 'no frames yet');
assert.equal(classifyWindow(16.7, 0, 0), 'ok', 'an idle 60 FPS frame is simply fine');
// boundary honesty: the throttle band edges
assert.equal(classifyWindow(RH.CAP_LO_MS, 1, 1), 'throttled', 'band low edge counts');
assert.equal(classifyWindow(RH.CAP_HI_MS, 1, 1), 'throttled', 'band high edge counts');
assert.equal(classifyWindow(RH.CAP_HI_MS + 4, 1, 1), 'slow', 'past the band it is just slow');

// --- rolling verdict with hysteresis ---------------------------------------------------
{
	const rh = createRenderHealth();
	assert.equal(rh.verdict(), 'warming', 'starts warming');
	// one full ok window is not enough to leave warming (HOLD windows required)
	for(let w = 0; w < RH.HOLD; w++) for(let i = 0; i < RH.WINDOW; i++) rh.sample(16.7, 4, 5);
	assert.equal(rh.verdict(), 'ok', 'stable ok after HOLD agreeing windows');
	// a single throttled window (a stutter) must NOT flip the verdict
	for(let i = 0; i < RH.WINDOW; i++) rh.sample(33.4, 2, 3);
	assert.equal(rh.verdict(), 'ok', 'one odd window never flips the stable verdict');
	for(let w = 0; w < RH.HOLD; w++) for(let i = 0; i < RH.WINDOW; i++) rh.sample(33.4, 2, 3);
	assert.equal(rh.verdict(), 'throttled', 'a sustained cap becomes the verdict');
	assert.ok(rh.hint().includes('30 FPS'), 'the throttled hint names the cap');
	// recovery works the same way
	for(let w = 0; w < RH.HOLD; w++) for(let i = 0; i < RH.WINDOW; i++) rh.sample(16.7, 4, 5);
	assert.equal(rh.verdict(), 'ok', 'recovery needs the same sustained agreement');
	assert.deepEqual(rh.flips(), ['ok', 'throttled', 'ok'], 'the flip history tells the story');
	// garbage samples are inert
	rh.sample(NaN, 1, 1); rh.sample(-5, 1, 1); rh.sample(0, 1, 1);
	assert.equal(rh.verdict(), 'ok', 'garbage frames never poison the window');
}

// --- hints + probe under Node ----------------------------------------------------------
for(const k of ['throttled', 'software', 'slow']) assert.ok(HINTS[k].length > 10, "hint '" + k + "' is actionable text");
assert.equal(blitProbe(null), null, 'no DOM: the probe declines gracefully');

// --- wiring pins ------------------------------------------------------------------------
const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
assert.ok(/noteRenderHealth\(frameMs,simMs,drawMs\);/.test(mainSrc)
	&& /function recordFramePerf\(frameMs,simMs,drawMs\)\{\n\tnoteRenderHealth/.test(mainSrc),
	'every recorded frame feeds the health tracker (the single perf chokepoint)');
assert.ok(/'Raster: '\+RENDER_HEALTH\.verdict\(\)/.test(mainSrc), 'the F3 perf HUD names the raster verdict');
assert.ok(/renderHealthNotified\[now\]=1/.test(mainSrc) && /RENDER_HINTS\.throttled/.test(mainSrc),
	'a stable bad verdict raises ONE toast per kind per session');
assert.ok(/const probe=renderBlitProbe\(document\);/.test(mainSrc),
	'a software verdict is confirmed empirically by the blit probe');
assert.ok(/MM\.renderHealth=\{ verdict:/.test(mainSrc), 'the verdict is reachable from the console/QA (MM.renderHealth)');
// the probe's forced flush must stay on THROWAWAY canvases — the game canvas
// must never see a readback (that could itself trigger the fallback heuristics)
const rhSrc = readFileSync(new URL('../src/engine/render_health.js', import.meta.url), 'utf8');
assert.ok(/d\.createElement\('canvas'\)/.test(rhSrc) && /dctx\.getImageData\(0, 0, 1, 1\)/.test(rhSrc),
	'the blit probe flushes on its own throwaway canvas');
assert.ok(!/getImageData/.test(mainSrc), 'main.js itself performs no canvas readbacks');

console.log('render-health-sim: all assertions passed');
