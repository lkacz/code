// Render health (render_health.js): tells the player WHY the game is at 30 FPS.
// A locked ~30 with an idle sim is the browser throttling requestAnimationFrame
// (Edge "tryb wydajności" / Chrome "oszczędzanie energii" / battery saver); a
// frame dominated by DRAW time is the canvas falling back to software
// rasterization (GPU process crashed or acceleration disabled — the profiler
// signature documented as "drawImage% = software-raster artifact"); a frame
// where SIM eats the budget is honest game load. Three different problems,
// three different fixes — the HUD used to show only the number.
//
// Pure model below (Node-tested); the blit probe is the only DOM toucher.
const MMR = (typeof window !== 'undefined' && window.MM) ? window.MM : null;

export const RH = Object.freeze({
	WINDOW: 90,          // frames per verdict window (~1.5 s at 60)
	CAP_LO_MS: 29,       // a ~30 FPS cap lands in this frame-interval band
	CAP_HI_MS: 37,
	IDLE_BUSY_MS: 12,    // sim+draw under this while capped = the BROWSER throttles
	SOFT_DRAW_MS: 18,    // draw alone above this...
	SOFT_DRAW_FRAC: 0.55, // ...and dominating the frame = software-raster suspicion
	HOLD: 3              // consecutive agreeing windows before the stable verdict flips
});

// One window's aggregate → a candidate verdict. Order matters: a software-
// rastered frame often ALSO sits near 30 FPS, so the draw-dominance test runs
// before the throttle test (its busy-idle condition would reject it anyway).
export function classifyWindow(avgFrameMs, avgSimMs, avgDrawMs){
	const frame = Number(avgFrameMs) || 0;
	const sim = Math.max(0, Number(avgSimMs) || 0);
	const draw = Math.max(0, Number(avgDrawMs) || 0);
	if(!(frame > 0)) return 'warming';
	if(draw > RH.SOFT_DRAW_MS && draw / frame > RH.SOFT_DRAW_FRAC) return 'software';
	if(frame >= RH.CAP_LO_MS && frame <= RH.CAP_HI_MS && (sim + draw) < RH.IDLE_BUSY_MS) return 'throttled';
	if(frame > RH.CAP_LO_MS) return 'slow'; // sustained under ~34 FPS and busy = honest load
	return 'ok';
}

export const HINTS = Object.freeze({
	ok: '',
	warming: '',
	throttled: 'przeglądarka ogranicza do ~30 FPS — wyłącz tryb wydajności (Edge) / oszczędzanie energii (Chrome), podłącz zasilanie',
	software: 'rysowanie bez GPU (software raster) — sprawdź edge://gpu lub chrome://gpu, restart przeglądarki zwykle przywraca akcelerację',
	slow: 'symulacja realnie obciążona (to nie throttling przeglądarki)'
});

export function createRenderHealth(){
	let n = 0, accFrame = 0, accSim = 0, accDraw = 0;
	let stable = 'warming', candidate = 'warming', streak = 0, windows = 0;
	const flips = [];
	function sample(frameMs, simMs, drawMs){
		if(!(frameMs > 0) || !Number.isFinite(frameMs)) return stable;
		n++; accFrame += frameMs; accSim += Number(simMs) || 0; accDraw += Number(drawMs) || 0;
		if(n < RH.WINDOW) return stable;
		const v = classifyWindow(accFrame / n, accSim / n, accDraw / n);
		n = 0; accFrame = accSim = accDraw = 0;
		windows++;
		if(v === candidate) streak++;
		else { candidate = v; streak = 1; }
		// hysteresis: one odd window (a GC pause, a tab switch) never flips the verdict
		if(streak >= RH.HOLD && v !== stable){ stable = v; flips.push(v); }
		return stable;
	}
	return {
		sample,
		verdict: () => stable,
		hint: () => HINTS[stable] || '',
		flips: () => flips.slice(),
		_debug: () => ({ n, candidate, streak, stable, windows })
	};
}

// --- blit probe (browser only) -----------------------------------------------------
// Confirms a software-raster suspicion empirically: a 1280x720 canvas-to-canvas
// blit costs well under a millisecond on the GPU and tens of milliseconds in
// software. The 1x1 readback at the end forces the queued batch to complete so
// the timing is honest — it runs on THROWAWAY canvases only (a readback on the
// live game canvas could itself trigger the fallback heuristics).
export function blitProbe(doc){
	const d = doc || (typeof document !== 'undefined' ? document : null);
	if(!d) return null;
	try{
		const src = d.createElement('canvas'); src.width = 1280; src.height = 720;
		const dst = d.createElement('canvas'); dst.width = 1280; dst.height = 720;
		const sctx = src.getContext('2d'), dctx = dst.getContext('2d');
		if(!sctx || !dctx) return null;
		sctx.fillStyle = '#334'; sctx.fillRect(0, 0, 1280, 720);
		sctx.fillStyle = '#a63'; for(let i = 0; i < 40; i++) sctx.fillRect(i * 31, i * 17, 120, 90);
		const t0 = performance.now();
		for(let i = 0; i < 30; i++) dctx.drawImage(src, 0, 0);
		dctx.getImageData(0, 0, 1, 1); // flush the queue — timing must include the real work
		const perBlit = (performance.now() - t0) / 30;
		return { perBlitMs: +perBlit.toFixed(3), gpuLikely: perBlit < 2.5 };
	}catch(e){ return null; }
}

const api = { RH, HINTS, classifyWindow, createRenderHealth, blitProbe };
if(MMR) MMR.renderHealthLib = api;
export default api;
