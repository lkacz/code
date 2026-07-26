#!/usr/bin/env node
// What every post-processing pass costs on a REAL GPU.
//
// Why this exists: tools/postfx-bench-qa.mjs runs with --disable-gpu, i.e.
// software Skia. That is the only place a Canvas2D pass can be flushed
// synchronously and timed in isolation, and it is the right instrument for
// RANKING work and for before/after. But it is not what a player sees, and this
// audit already proved the two can disagree in DIRECTION, not just in scale:
// imageSmoothingEnabled=false measured -54% in software and is worth nothing on
// a GPU, where bilinear sampling is free in the sampler. Trading picture quality
// for a software-only win would be a bad bargain, so before any of that is
// spent, this driver answers: does the pass cost anything on the real thing?
//
// THE METHOD, and why it is not the obvious one:
//   * No readback. The software harness flushes with getImageData(0,0,1,1);
//     here that would drag the canvas out of the GPU (and Chromium may keep it
//     there), so the measurement would quietly become a software measurement
//     again while claiming otherwise. The whole point is lost.
//   * Vsync could not be switched off. --disable-gpu-vsync and
//     --disable-frame-rate-limit are passed, but headless still schedules rAF on
//     a ~60Hz beat, so a single pass hides completely inside one frame.
//   * So vsync becomes the RULER instead of the obstacle: the pass is repeated N
//     times per frame until the frame visibly overruns, and the overrun is
//     divided by N. N is grown until the added time is many frame periods, which
//     is what keeps the ±1-period quantisation from dominating; both N and the
//     raw delta are reported so the reader can judge that for themselves.
//   * The GPU is VERIFIED, not assumed: the run fails loudly if the renderer
//     string comes back as SwiftShader or any other software rasteriser.
//
// Usage: npm start (server on 8123), then:
//   node tools/postfx-gpu-qa.mjs [--url=...] [--seed=777] [--frames=20] [--target=140]
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { BOOT, STAGE, CASES_SRC } from './lib/postfx-scene.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
	const hit = args.find(a => a.startsWith('--' + name + '='));
	return hit ? hit.slice(name.length + 3) : dflt;
};
const url = opt('url', 'http://127.0.0.1:8123/index.html');
const seed = opt('seed', '777');
const frames = Number(opt('frames', '20')) || 20;
const targetMs = Number(opt('target', '140')) || 140;
const outFile = opt('out', '');

const EDGE_CANDIDATES = [
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
];

let msgId = 0;
const pending = new Map();
function send(ws, method, params){
	const id = ++msgId;
	ws.send(JSON.stringify({ id, method, params: params || {} }));
	return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Renderer identity. A software fallback here invalidates the entire run, so it
// is a hard failure rather than a footnote nobody reads.
const GPU_CHECK = `(()=>{
	try{
		const c=document.createElement('canvas');
		const gl=c.getContext('webgl2')||c.getContext('webgl');
		if(!gl) return 'FAIL no-webgl-context';
		const dbg=gl.getExtension('WEBGL_debug_renderer_info');
		const r=String(dbg?gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER));
		if(/swiftshader|software|llvmpipe|basic render/i.test(r)) return 'FAIL software-rasteriser: '+r;
		return 'OK '+JSON.stringify({renderer:r});
	}catch(e){ return 'FAIL gpu-probe '+String(e).slice(0,120); }
})()`;

const MEASURE = (FRAMES, TARGET) => `(async()=>{
	const errs={};
${CASES_SRC}
	// One rAF-to-rAF sample set. The pass is invoked N times inside the callback;
	// the work lands in the frame, so the NEXT callback is pushed out by exactly
	// what the GPU needed. A trimmed mean (middle 60%) rather than a median: the
	// samples are quantised to the vsync beat, and trimming averages the dither
	// out instead of snapping to one bucket.
	const sample=async(fn,N)=>{
		const dts=[];
		await new Promise(done=>{
			let i=0,last=0;
			const step=()=>{
				for(let k=0;k<N;k++) fn();
				const now=performance.now();
				if(last) dts.push(now-last);
				last=now;
				if(++i<${FRAMES}+6) requestAnimationFrame(step); else done();
			};
			requestAnimationFrame(()=>{ requestAnimationFrame(step); });
		});
		const warm=dts.slice(5).sort((a,b)=>a-b);       // drop warm-up frames
		const lo=Math.floor(warm.length*0.2), hi=Math.ceil(warm.length*0.8);
		const mid=warm.slice(lo,hi);
		return mid.reduce((s,v)=>s+v,0)/Math.max(1,mid.length);
	};
	const idle=()=>{};
	const out={}, shape={}, used={}, raw={};
	// Baseline: the very same loop with nothing in it, so the game's own frame
	// work and the browser's beat cancel out of every number below.
	let baseMs=await sample(idle,0);
	const vsync=baseMs;
	for(const c of CASES){
		for(const n of F.COMPONENTS) F.set(n,false);
		for(const n of c[1]) F.set(n,true);
		for(let i=0;i<12;i++) drive(c);                 // warm caches, sprites, scans
		shape[c[0]]=drive(c);
		let N=16, deltaMs=0, ms=0, usedN=16;
		// Grow N until the pass has clearly overrun several frame periods; that
		// ratio is what bounds the quantisation error, and it is reported.
		// usedN is captured BEFORE the growth step: reading N afterwards divides
		// by a factor the measurement never ran at, and understates every pass
		// that never reached the target by exactly 4x.
		for(let step=0; step<5; step++){
			usedN=N;
			ms=await sample(()=>drive(c),N);
			deltaMs=ms-baseMs;
			if(deltaMs>=${TARGET}) break;
			N*=4;
		}
		out[c[0]]=+(deltaMs*1000/usedN).toFixed(2);
		used[c[0]]=usedN;
		raw[c[0]]=+deltaMs.toFixed(1);
		baseMs=await sample(idle,0);                    // re-baseline between cases (drift)
	}
	for(const n of F.COMPONENTS) F.set(n,false);
	return 'OK '+JSON.stringify({us:out,shape,n:used,deltaMs:raw,vsyncMs:+vsync.toFixed(2),errs});
})()`;

(async () => {
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-pfgpu-'));
	// NO --disable-gpu here: that is the entire point of this driver.
	const proc = spawn(edge, ['--headless=new', '--no-first-run', '--hide-scrollbars',
		'--force-device-scale-factor=1', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
		'--enable-gpu-rasterization', '--enable-zero-copy',
		'--disable-gpu-vsync', '--disable-frame-rate-limit',
		'--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
	let ws = null, pump = null, failed = false;
	try {
		let target = null;
		for (let i = 0; i < 60 && !target; i++){
			await sleep(250);
			try {
				const portLine = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0].trim();
				if (!portLine) continue;
				const list = await (await fetch(`http://127.0.0.1:${portLine}/json/list`)).json();
				target = list.find(t => t.type === 'page');
			} catch (e) { /* devtools not up yet */ }
		}
		if (!target) throw new Error('no devtools target');
		ws = new WebSocket(target.webSocketDebuggerUrl);
		await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
		const events = [];
		ws.onmessage = ev => {
			const m = JSON.parse(ev.data);
			if (m.id && pending.has(m.id)){
				const q = pending.get(m.id); pending.delete(m.id);
				if (m.error) q.reject(new Error(q.method + ': ' + JSON.stringify(m.error))); else q.resolve(m.result);
			} else if (m.method) events.push(m.method);
		};
		await send(ws, 'Page.enable');
		await send(ws, 'Runtime.enable');
		await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
		await send(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: `
			const __o=Document.prototype.getElementById;
			Document.prototype.getElementById=function(id){ const el=__o.call(this,id);
				if(id==='seedInput' && el && el.value==='auto') el.value=${JSON.stringify(seed)}; return el; };` });
		await send(ws, 'Page.navigate', { url });
		for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await sleep(250);
		await sleep(1500);
		// Headless occlusion freezes rAF in long sessions, and every number here is
		// an rAF delta, so the keep-front pump is load-bearing rather than cosmetic.
		pump = setInterval(() => { send(ws, 'Page.bringToFront').catch(() => {}); }, 2000);
		const ev = async (label, expr) => {
			const r = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 900000 });
			const v = r && r.result ? String(r.result.value) : '(none)';
			if (v.startsWith('FAIL')) throw new Error(label + ' ' + v);
			console.log(label + ':', v.length > 300 ? v.slice(0, 300) + '…' : v);
			return v.startsWith('OK ') ? JSON.parse(v.slice(3)) : {};
		};
		const gpu = await ev('gpu', GPU_CHECK);
		await ev('boot', BOOT);
		await ev('stage', STAGE);
		const out = await ev('measure', MEASURE(frames, targetMs));

		const NL = String.fromCharCode(10);
		const budget = 1000000 / 60;   // one 60fps frame, in microseconds
		const rows = Object.entries(out.us).sort((a, b) => b[1] - a[1]);
		console.log(NL + '  renderer: ' + gpu.renderer);
		console.log('  frame beat (idle rAF): ' + out.vsyncMs + 'ms');
		console.log(NL + '     GPU us   % of 60fps frame       N   delta(ms)   pass');
		console.log('     ------   ----------------   -----   ---------   ------------------------');
		for (const [name, us] of rows){
			const pct = (us / budget * 100);
			// A delta smaller than a few frame beats is quantisation, not signal:
			// such a row is an UPPER BOUND, and saying so is the difference between
			// a measurement and a decoration.
			const coarse = out.deltaMs[name] < out.vsyncMs * 4;
			console.log('   ' + (coarse ? '<' : ' ') + String(us).padStart(7) + '   ' + (pct.toFixed(2) + '%').padStart(16) + '   '
				+ String(out.n[name]).padStart(5) + '   ' + String(out.deltaMs[name]).padStart(9) + '   ' + name
				+ (coarse ? '   (below resolution)' : ''));
		}
		const worst = rows.length ? rows[0][1] : 0;
		console.log(NL + '  The heaviest pass eats ' + (worst / budget * 100).toFixed(2) + '% of a 60fps frame.');
		if (Object.keys(out.errs || {}).length) console.log('  errors: ' + JSON.stringify(out.errs));
		if (outFile) await writeFile(outFile, JSON.stringify({ renderer: gpu.renderer, ...out }, null, '\t'));
	} catch (e) {
		failed = true;
		console.error('postfx-gpu-qa FAILED:', e && e.message ? e.message : e);
	} finally {
		if (pump) clearInterval(pump);
		try { if (ws) ws.close(); } catch (e) { /* ignore */ }
		try { proc.kill(); } catch (e) { /* ignore */ }
		await sleep(500);
		await rm(profile, { recursive: true, force: true }).catch(() => {});
	}
	process.exit(failed ? 1 : 0);
})();
