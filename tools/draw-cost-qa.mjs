#!/usr/bin/env node
// What do Canvas2D PRIMITIVES actually cost on this machine's GPU?
//
// The post-fx harnesses time whole passes. This one times the building blocks,
// because a design decision hangs on them: dynamic relief has to shade many
// small features per frame, and whether that is affordable depends entirely on
// whether the cost is per DRAW CALL (then batch into paths) or per PIXEL (then
// batching buys nothing). Guessing that ratio is how you design the wrong
// architecture and find out after building it.
//
// Method: the same vsync-as-ruler trick as tools/postfx-gpu-qa.mjs, because
// vsync cannot be disabled in headless and no synchronous flush exists on a
// real GPU. Repeat an operation N times inside one rAF callback; the NEXT
// callback is pushed out by what the GPU needed. Subtract an idle baseline,
// divide by N. Rows whose delta is under a few frame beats are UPPER BOUNDS
// and say so — a number without that caveat would be a decoration.
//
// Usage: npm start (server on 8123), then:
//   node tools/draw-cost-qa.mjs [--url=http://127.0.0.1:8123/index.html] [--out=costs.json]
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
	const hit = args.find(a => a.startsWith('--' + name + '='));
	return hit ? hit.slice(name.length + 3) : dflt;
};
const url = opt('url', 'http://127.0.0.1:8123/index.html');
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

const GPU_CHECK = `(()=>{
	try{
		const c=document.createElement('canvas');
		const gl=c.getContext('webgl2')||c.getContext('webgl');
		if(!gl) return 'FAIL no-webgl';
		const dbg=gl.getExtension('WEBGL_debug_renderer_info');
		const r=dbg?gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL):'(masked)';
		if(/swiftshader|software|llvmpipe/i.test(String(r))) return 'FAIL software-renderer '+r;
		return 'OK '+JSON.stringify({renderer:r});
	}catch(e){ return 'FAIL gpu-probe '+String(e).slice(0,120); }
})()`;

const MEASURE = `(async()=>{
	const cv=document.getElementById('game');
	if(!cv) return 'FAIL no-canvas';
	const ctx=cv.getContext('2d');
	// a cached sprite: the thing a per-tile blit would read from
	const spr=document.createElement('canvas'); spr.width=20; spr.height=20;
	{ const g=spr.getContext('2d'); g.fillStyle='rgba(255,255,255,0.5)'; g.fillRect(0,0,20,20); }
	// a chunk-sized cached canvas: the thing a relightable-bake blit would read
	const big=document.createElement('canvas'); big.width=640; big.height=640;
	{ const g=big.getContext('2d'); g.fillStyle='rgba(255,255,255,0.25)'; g.fillRect(0,0,640,640); }

	const W=cv.width, H=cv.height;
	// deterministic spread so we never measure one hot cache line
	const px=[], py=[];
	for(let i=0;i<4096;i++){ px.push((i*97)%Math.max(1,W-40)); py.push((i*57)%Math.max(1,H-40)); }

	const CASES=[
		['fillRect 3x1 (bump pixel)', 600, ()=>{ for(let i=0;i<600;i++){ ctx.fillRect(px[i&4095],py[i&4095],3,1); } }],
		['fillRect 20x2 (face strip)', 600, ()=>{ for(let i=0;i<600;i++){ ctx.fillRect(px[i&4095],py[i&4095],20,2); } }],
		['path: 600 rect() + 1 fill()', 1, ()=>{ ctx.beginPath(); for(let i=0;i<600;i++){ ctx.rect(px[i&4095],py[i&4095],3,1); } ctx.fill(); }],
		['path: 2000 rect() + 1 fill()', 1, ()=>{ ctx.beginPath(); for(let i=0;i<2000;i++){ ctx.rect(px[i&4095],py[i&4095],3,1); } ctx.fill(); }],
		['drawImage 20x20 sprite x600', 600, ()=>{ for(let i=0;i<600;i++){ ctx.drawImage(spr,px[i&4095],py[i&4095]); } }],
		['drawImage 20x20 sprite x2000', 2000, ()=>{ for(let i=0;i<2000;i++){ ctx.drawImage(spr,px[i&4095],py[i&4095]); } }],
		['drawImage 640x640 cached x8', 8, ()=>{ for(let i=0;i<8;i++){ ctx.drawImage(big,(i*37)%400,(i*53)%300); } }],
		['globalAlpha switch x600', 600, ()=>{ for(let i=0;i<600;i++){ ctx.globalAlpha=0.2+((i&7)*0.1); ctx.fillRect(px[i&4095],py[i&4095],3,1); } }],
		['gCO switch x120 (lighter/multiply)', 120, ()=>{ for(let i=0;i<120;i++){ ctx.globalCompositeOperation=(i&1)?'lighter':'multiply'; ctx.fillRect(px[i&4095],py[i&4095],20,20); } }]
	];

	const sample=async(fn,reps)=>{
		const dts=[];
		await new Promise(done=>{
			let last=0, n=0;
			const tick=(t)=>{
				if(last){ dts.push(t-last); }
				last=t;
				for(let r=0;r<reps;r++) fn();
				if(++n<14) requestAnimationFrame(tick); else done();
			};
			requestAnimationFrame(tick);
		});
		dts.sort((a,b)=>a-b);
		const lo=Math.floor(dts.length*0.2), hi=Math.ceil(dts.length*0.8);
		let s=0,c=0; for(let i=lo;i<hi;i++){ s+=dts[i]; c++; }
		return c?s/c:0;
	};
	const idle=()=>{};
	let vsync=await sample(idle,0);
	const out={}, raw={}, used={};
	for(const c of CASES){
		ctx.save();
		ctx.setTransform(1,0,0,1,0,0);
		ctx.globalCompositeOperation='source-over';
		ctx.globalAlpha=0.35;
		ctx.fillStyle='rgba(255,255,255,0.35)';
		const base=await sample(idle,0);
		// Amplify until the frame overruns by SEVERAL BEATS. The first version
		// targeted 8 ms, which is less than one 60 Hz beat — every row came back
		// flagged "below resolution", i.e. every number was an upper bound and
		// none of them a measurement. The target has to be read off the beat.
		const target=Math.max(24, vsync*5);
		let N=1, ms=0, delta=0, usedN=1;
		for(let step=0; step<9; step++){
			usedN=N;
			ms=await sample(c[2],N);
			delta=ms-base;
			if(delta>=target) break;
			N*=4;
		}
		ctx.restore();
		const opsPerRep=c[1];
		out[c[0]]=+(delta*1000/(usedN*opsPerRep)).toFixed(4);
		raw[c[0]]=+(delta*1000/usedN).toFixed(1);
		used[c[0]]={N:usedN, deltaMs:+delta.toFixed(1), ops:opsPerRep};
	}
	return 'OK '+JSON.stringify({perOpUs:out, perRepUs:raw, meta:used, vsyncMs:+vsync.toFixed(2)});
})()`;

(async () => {
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-drawcost-'));
	// NO --disable-gpu: the whole point is the real GPU.
	const proc = spawn(edge, [
		'--headless=new', '--no-first-run', '--hide-scrollbars',
		'--force-device-scale-factor=1', '--remote-debugging-port=0',
		`--user-data-dir=${profile}`, '--window-size=1600,900', 'about:blank'
	], { stdio: 'ignore' });

	let ws, failed = false, pump = null;
	try {
		let target = null;
		for (let i = 0; i < 60 && !target; i++){
			await sleep(250);
			try {
				const portLine = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0].trim();
				if (!portLine) continue;
				const list = await (await fetch(`http://127.0.0.1:${portLine}/json/list`)).json();
				target = list.find(t => t.type === 'page');
			} catch (e) { /* not up yet */ }
		}
		if (!target) throw new Error('DevTools endpoint never came up');
		ws = new WebSocket(target.webSocketDebuggerUrl);
		await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
		const events = [];
		ws.onmessage = ev => {
			const m = JSON.parse(ev.data);
			if (m.id && pending.has(m.id)){
				const p = pending.get(m.id); pending.delete(m.id);
				if (m.error) p.reject(new Error(p.method + ': ' + JSON.stringify(m.error)));
				else p.resolve(m.result);
			} else if (m.method) events.push(m.method);
		};
		await send(ws, 'Page.enable');
		await send(ws, 'Runtime.enable');
		await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
		await send(ws, 'Page.navigate', { url });
		for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await sleep(250);
		await sleep(2500);
		pump = setInterval(() => { send(ws, 'Page.bringToFront').catch(() => {}); }, 2000);

		const ev = async (label, expr) => {
			const r = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 180000 });
			const v = r && r.result ? String(r.result.value) : '(none)';
			if (v.startsWith('FAIL')) throw new Error(label + ' ' + v);
			return v.startsWith('OK ') ? JSON.parse(v.slice(3)) : {};
		};
		const gpu = await ev('gpu', GPU_CHECK);
		const res = await ev('measure', MEASURE);

		const NL = String.fromCharCode(10);
		console.log(NL + '  renderer: ' + gpu.renderer);
		console.log('  frame beat (idle rAF): ' + res.vsyncMs + 'ms');
		console.log(NL + '   us/op      us/batch      N   delta(ms)   primitive');
		console.log('   ------      --------   -----   ---------   ------------------------');
		for (const [name, us] of Object.entries(res.perOpUs).sort((a, b) => b[1] - a[1])){
			const m = res.meta[name];
			const coarse = m.deltaMs < res.vsyncMs * 4;
			console.log('   ' + (coarse ? '<' : ' ') + String(us).padStart(8) + '   ' + String(res.perRepUs[name]).padStart(8)
				+ '   ' + String(m.N).padStart(5) + '   ' + String(m.deltaMs).padStart(9) + '   ' + name + (coarse ? '   (below resolution)' : ''));
		}
		console.log(NL + '  us/op = cost of ONE primitive; us/batch = cost of one repetition of the case.');
		if (outFile) await writeFile(outFile, JSON.stringify({ renderer: gpu.renderer, ...res }, null, '\t'));
	} catch (e){
		failed = true;
		console.error('draw-cost-qa FAILED:', e && e.message ? e.message : e);
	} finally {
		if (pump) clearInterval(pump);
		try { if (ws) ws.close(); } catch (e) { /* closing */ }
		// marker-scoped kill: only the process this driver spawned
		try { proc.kill(); } catch (e) { /* already gone */ }
		await sleep(400);
	}
	process.exit(failed ? 1 : 0);
})();
