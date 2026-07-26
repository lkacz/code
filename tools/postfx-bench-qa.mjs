#!/usr/bin/env node
// Per-pass cost baseline for every post-processing pass (engine/post_fx.js).
//
// Why this exists: a headless whole-frame FPS A/B is worthless here — it once
// reported "all twelve ultra passes on" as FASTER than standard. The only number
// worth having is each pass timed directly, on the real canvas, doing its real
// blits. This is the instrument that tells us what to optimise BEFORE anything is
// changed, and proves the change afterwards.
//
// Method, learned the hard way in this repo:
//   * min of R reps, INTERLEAVED across cases — a sustained CPU steal in a
//     headless run otherwise lands entirely on whichever case is running, and a
//     single rep has swung 2x between identical invocations.
//   * a min is only valid across reps that measure the SAME work, so every case
//     gets its own emitter-scan window where it matters (the scan is cadence
//     cached; sharing a window let one case measure another's empty scene).
//   * the shape (draws/sources) is reported next to the time, so a suspiciously
//     cheap number cannot masquerade as a win.
//
// Note the headless browser runs with --disable-gpu, i.e. software Skia, so these
// numbers are a pessimistic CPU-rendering bound, not what the player's GPU sees.
// They are still the right numbers for RANKING work and for before/after.
//
// Usage: npm start (server on 8123), then:
//   node tools/postfx-bench-qa.mjs [--url=...] [--seed=777] [--reps=4] [--n=200]
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
	const hit = args.find(a => a.startsWith('--' + name + '='));
	return hit ? hit.slice(name.length + 3) : dflt;
};
const url = opt('url', 'http://127.0.0.1:8123/index.html');
const seed = opt('seed', '777');
const reps = Number(opt('reps', '4')) || 4;
const iters = Number(opt('n', '200')) || 200;
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

const BOOT = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	for(let i=0;i<400 && !(window.MM && MM.postFx && MM.world && MM.worldGen && MM.background && MM.fog && window.player && window.__mmDebugHero);i++) await sleep(100);
	if(!(window.MM && MM.postFx && MM.world && window.player)) return 'FAIL boot-timeout';
	MM.fog.setRevealAll(true);
	const ui=document.getElementById('ui'); if(ui) ui.style.display='none';
	MM.background.importState({cycleT:0.28});     // morning: sun low, so rays/shadows have work
	for(const n of MM.postFx.COMPONENTS) MM.postFx.set(n,false);
	return 'OK '+JSON.stringify({components:MM.postFx.COMPONENTS.length});
})()`;

// One staged stretch of surface carrying work for every pass at once, ALL of it
// inside a single scan window: canopy for rays and tree shadows, a pond, an ice
// sheet, a lava pool, torches, and the hero in the middle for the coat.
// Every feature has to sit inside the ONE window the cases share — the first
// version of this file gave each case its own x offset (to get its own emitter
// scan cache key) and thereby pushed the ice and the pond out of view, so those
// cases dutifully measured zero draws.
const STAGE = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const W=MM.world, WG=MM.worldGen;
	const cx=Math.round(player.x), cy=WG.surfaceHeight(cx);
	window.__mmDebugHero(cx, cy-2);
	await sleep(1400);
	const bx=Math.round(player.x), by=WG.surfaceHeight(bx);
	// torches on a back wall (glow + light-tint emitters)
	for(let i=-6;i<=6;i+=3){ W.setTile(bx+i, by-3, 3); W.setTile(bx+i, by-4, 16); }
	// lava pool right (shimmer + tint + glow)
	for(let x=bx+8;x<=bx+15;x++){ W.setTile(x,by,13); W.setTile(x,by-1,0); W.setTile(x,by-2,0); }
	// pond left, then an ice sheet just beyond it (both still inside the window)
	for(let x=bx-9;x<=bx-4;x++){ W.setTile(x,by,8); W.setTile(x,by-1,0); }
	for(let x=bx-17;x<=bx-10;x++){ W.setTile(x,by,12); W.setTile(x,by-1,0); }
	// a trunk with a canopy that has a deliberate gap: tree shadows + god rays
	for(let y=by-1;y>=by-6;y--) W.setTile(bx-2,y,5);
	for(const dx of [-5,-4,-3,-1,0,1]) W.setTile(bx+dx, by-7, 6);
	await sleep(900);
	if(window.player) player.hp=player.maxHp;
	return 'OK '+JSON.stringify({bx,by,lava:W.getTile(bx+10,by),pond:W.getTile(bx-6,by),ice:W.getTile(bx-12,by),trunk:W.getTile(bx-2,by-3),leaf:W.getTile(bx-4,by-7)});
})()`;

// THE measurement contract.
//
// Canvas2D draw calls are QUEUED, not executed: the call returns before the
// rasteriser has done anything. Timing the call therefore measures JS binding
// overhead and nothing else, which is why the same 26 halo blits measured 17us in
// one harness and 5900us in another during this audit. Both were wrong.
//
// So every case is timed TWICE:
//   naive  - the tight loop alone, i.e. command recording. Reported only so the
//            gap is visible and nobody trusts it again.
//   real   - the same loop followed by an explicit flush, so the batch is actually
//            rasterised inside the measured window.
//
// The flush MUST be synchronous. The obvious choice, createImageBitmap, is async,
// and awaiting it yields the event loop -- which lets the game's own rAF frame run
// INSIDE the measured window. That is not a subtle error: it reported lightTint at
// 7026us against a 4.5us naive number, i.e. it was timing whole game frames.
// So the flush here is getImageData(0,0,1,1), which is synchronous and forces the
// pending batch to rasterise. Its usual objection -- that a readback drops the
// canvas into software mode -- does not apply: this harness runs headless with
// --disable-gpu, so the canvas is software ALREADY and there is no acceleration to
// lose. On a GPU-accelerated page this would be the wrong tool.
// The flush's own cost is measured separately and subtracted.
const BENCH = (REPS, N) => `(async()=>{
	const P=await import('/src/engine/post_fx.js');
	const cv=document.getElementById('game');
	const ctx=cv.getContext('2d');
	const W=MM.world, WG=MM.worldGen;
	const TILE=20, SC=2;
	const bx=Math.round(player.x), by=WG.surfaceHeight(bx);
	const setT=()=>ctx.setTransform(SC,0,0,SC, 800-SC*TILE*bx, 500-SC*TILE*by);
	const base={TILE, sx:bx-20, sy:by-14, viewX:40, viewY:28,
		getTile:W.getTile, surfaceHeight:WG.surfaceHeight,
		visibleAt:()=>true, poweredAt:()=>true, frameMs:16,
		isTrunk:(t)=>t===5||t===139||t===140||t===141, isCanopy:(t)=>t===6||t===39,
		time:(MM.background&&MM.background.timeInfo)?MM.background.timeInfo():null,
		daylight:1, rainingAt:()=>true, skipWetTile:()=>false, tileColor:()=>'#808080',
		pools:null, burning:null};
	const body={bx:(player.x-player.w/2)*TILE, by:(player.y-player.h/2)*TILE, bw:player.w*TILE, bh:player.h*TILE};
	const F=P.postFx;
	const glowSrc=(n)=>{ for(let i=0;i<n;i++) F.glow(TILE*(bx+((i*7)%20)-10), TILE*(by-2-((i*3)%6)), {color:'#ffd08a', r:9, a:0.5, trail:(i%3)===0}, 'bench'+i, TILE); };
	const CASES=[
		['glow: tiles only',     ['bloom'],          ()=>F.drawGlowPass(ctx,{...base,now:performance.now()})],
		['glow: +12 entities',   ['bloom'],          ()=>{ glowSrc(12); return F.drawGlowPass(ctx,{...base,now:performance.now()}); }],
		['glow: +40 entities',   ['bloom'],          ()=>{ glowSrc(40); return F.drawGlowPass(ctx,{...base,now:performance.now()}); }],
		['glow: tiles, no bloom',[],                 ()=>F.drawGlowPass(ctx,{...base,now:performance.now()})],
		['lightTint',            ['lightTint'],      ()=>F.drawLightTintPass(ctx,{...base})],
		['heatShimmer',          ['heatShimmer'],    ()=>F.drawHeatShimmerPass(ctx,{...base,now:performance.now()})],
		['iceReflections',       ['iceReflections'], ()=>F.drawIceReflectionsPass(ctx,{...base})],
		['godRays',              ['godRays'],        ()=>F.drawGodRaysPass(ctx,{...base})],
		['treeShadows',          ['shadows'],        ()=>F.drawTreeShadowsPass(ctx,{...base})],
		['wetGround',            ['wetGround'],      ()=>{ window.__mmForceWet=true; return F.drawWetGroundPass(ctx,{...base}); }],
		['dustMotes',            ['dustMotes'],      ()=>F.drawDustMotesPass(ctx,{...base})],
		['heroSheen: grab+coat', ['heroSheen'],      ()=>{ F.captureHeroBackdrop(ctx,{...body,erase:null});
			const r=F.drawHeroSheenPass(ctx,{...body, getTile:W.getTile, tileColor:()=>'#808080', poweredAt:()=>true,
				surfaceHeight:WG.surfaceHeight, px:bx, py:by-2, daylight:1, time:null, submerged:false});
			F.captureHeroScene(ctx); return r; }],
		['casterShadow',         ['shadows'],        ()=>F.drawCasterShadow(ctx,{TILE,x:player.x,w:player.w,h:player.h,groundY:by,k:1,sunlit:true,
			time:(MM.background&&MM.background.timeInfo)?MM.background.timeInfo():null})]
	];
	// synchronous, so the timed window cannot swallow one of the game's own frames
	const flush=()=>{ ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.getImageData(0,0,1,1); ctx.restore(); };
	const drive=(c)=>{ ctx.save(); setT(); let r=0;
		try{ r=c[2]()||0; }catch(e){ errs[c[0]]=String(e && e.message).slice(0,90); }
		ctx.restore(); return r; };
	const errs={}, naive={}, real={}, shape={};
	for(const c of CASES){ naive[c[0]]=Infinity; real[c[0]]=Infinity; }
	// the flush's own cost, so it can be subtracted from the real numbers
	let flushMs=Infinity;
	for(let rep=0;rep<8;rep++){
		const t0=performance.now(); flush(); flushMs=Math.min(flushMs,performance.now()-t0);
	}
	for(let rep=0;rep<${REPS};rep++){
		for(const c of CASES){
			for(const n of F.COMPONENTS) F.set(n,false);
			for(const n of c[1]) F.set(n,true);
			for(let i=0;i<20;i++) drive(c);
			flush();
			shape[c[0]]=drive(c);
			flush();
			const t1=performance.now();
			for(let i=0;i<${N};i++) drive(c);
			naive[c[0]]=Math.min(naive[c[0]],(performance.now()-t1)/${N});
			flush();
			const t2=performance.now();
			for(let i=0;i<${N};i++) drive(c);
			flush();
			real[c[0]]=Math.min(real[c[0]],(performance.now()-t2-flushMs)/${N});
			delete window.__mmForceWet;
		}
	}
	for(const n of F.COMPONENTS) F.set(n,false);
	const us={}, naiveUs={};
	for(const c of CASES){ us[c[0]]=+(real[c[0]]*1000).toFixed(1); naiveUs[c[0]]=+(naive[c[0]]*1000).toFixed(1); }
	return 'OK '+JSON.stringify({us, naiveUs, shape, errs, flushUs:+(flushMs*1000).toFixed(1)});
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-pfbench-'));
	const proc = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
		'--force-device-scale-factor=1', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
		'--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
	let ws = null, pump = null;
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
		const events = [], pageErrors = [];
		ws.onmessage = ev => {
			const m = JSON.parse(ev.data);
			if (m.id && pending.has(m.id)){
				const q = pending.get(m.id); pending.delete(m.id);
				if (m.error) q.reject(new Error(q.method + ': ' + JSON.stringify(m.error))); else q.resolve(m.result);
			} else if (m.method){
				events.push(m.method);
				if (m.method === 'Runtime.exceptionThrown'){
					try { pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 240)); } catch (e) { /* ignore */ }
				}
			}
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
		pump = setInterval(() => { send(ws, 'Page.bringToFront').catch(() => {}); }, 2000);
		const ev = async (label, expr) => {
			const r = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 600000 });
			const v = r && r.result ? String(r.result.value) : '(none)';
			if (v.startsWith('FAIL')) throw new Error(label + ' ' + v);
			console.log(label + ':', v.length > 400 ? v.slice(0, 400) + '…' : v);
			return v.startsWith('OK ') ? JSON.parse(v.slice(3)) : {};
		};
		await ev('boot', BOOT);
		await ev('stage', STAGE);
		const out = await ev('bench', BENCH(reps, iters));

		const rows = Object.entries(out.us).sort((a, b) => b[1] - a[1]);
		const total = rows.reduce((n, [, v]) => n + v, 0);
		const NL = String.fromCharCode(10);
		console.log(NL + '  flush cost (subtracted): ' + out.flushUs + 'us');
		console.log(NL + '   REAL us   naive   ratio   draws   pass');
		console.log('   -------   -----   -----   -----   ' + '-'.repeat(24));
		for (const [label, us] of rows){
			const nv = out.naiveUs[label];
			const ratio = nv > 0 ? (us / nv).toFixed(0) + 'x' : '-';
			const bad = out.errs && out.errs[label];
			console.log('   ' + String(us).padStart(7) + '   ' + String(nv).padStart(5) + '   ' +
				String(ratio).padStart(5) + '   ' + String(out.shape[label] === undefined ? '-' : out.shape[label]).padStart(5) + '   ' +
				label + (bad ? '   !! ' + bad : ''));
		}
		console.log('   -------');
		console.log('   ' + String(total.toFixed(1)).padStart(7) + '                           SUM (all passes on; no profile runs them all)');
		console.log(NL + '  "naive" = the tight loop with no flush: command recording only.');
		console.log('  Kept in the report so the gap stays visible - it is NOT a cost.');
		if (pageErrors.length) console.log('\npageErrors:\n' + pageErrors.slice(0, 2).join('\n---\n'));
		if (outFile) await writeFile(outFile, JSON.stringify(out, null, '\t'));
	} finally {
		try { if (pump) clearInterval(pump); } catch (e) { /* none */ }
		try { if (ws) ws.close(); } catch (e) { /* closing */ }
		// marker-scoped kill: never taskkill msedge.exe, it would take the user's browser
		await new Promise(res => {
			if (process.platform === 'win32'){
				const marker = profile.split(/[\\/]/).pop();
				execFile('powershell', ['-NoProfile', '-Command',
					`Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }`], () => res());
			} else { try { proc.kill('SIGKILL'); } catch (e) { /* gone */ } res(); }
		});
		await sleep(600);
		try { await rm(profile, { recursive: true, force: true }); } catch (e) { /* locked */ }
	}
}
main().catch(e => { console.error(e); process.exit(1); });
