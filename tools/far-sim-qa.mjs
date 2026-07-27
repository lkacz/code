#!/usr/bin/env node
// Live QA for the FAR-WORLD SIMULATION (engine/world_sim.js): the invariant is
// "frame cost = O(near the players), never O(world)", and the player-visible
// promise is "the coal you lit keeps burning while you mine elsewhere".
//
// Node suites prove the gate's math; only a live browser can prove the two
// things that matter: that a 600-machine world costs the FRAME nothing once
// its builder walks away, and that the absence is paid back — through a real
// save/reload too, because the clock and the region stamps ride the save.
//
// Scenes, one boot:
//   1. baseline    — frame timings with nothing built
//   2. hot farm    — 600 solar batteries + a lit kiln around the hero: the
//                    honest price of a mega-base you are standing in
//   3. frozen farm — the hero 600 tiles away: timings must return to baseline
//                    while the kiln bakes NOTHING (frozen, not ticking)
//   4. the return  — one wake settles the absence: batches baked, energy
//                    earned, and the wake frame itself stays bounded
//   5. reload      — save while away, reboot, return: the stamps survived, so
//                    the pre-save absence is still owed and still paid
//
// Usage: npm start (server on 8123), then: node tools/far-sim-qa.mjs
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
	const hit = args.find(a => a.startsWith('--' + name + '='));
	return hit ? hit.slice(name.length + 3) : dflt;
};
const url = opt('url', 'http://127.0.0.1:8123/index.html');
const seed = opt('seed', '777');

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
	for(let i=0;i<400 && !(window.MM && MM.world && MM.worldSim && window.player && window.__mmDebugHero);i++) await sleep(100);
	if(!(window.MM && MM.world && MM.worldSim && window.player)) return 'FAIL boot-timeout';
	return 'OK '+JSON.stringify({sim:MM.worldSim.metrics(), hero:{x:Math.round(player.x),y:Math.round(player.y)}});
})()`;

// rAF frame timings — 180 frames for the stable pairs, 60 for the return
// second (the kiln bakes through every hot second, so measurement time is
// batch budget).
const perfExpr = (frames) => `(async()=>{
	const s=[];
	await new Promise(res=>{
		let last=performance.now(), n=0;
		const loop=(t)=>{ s.push(t-last); last=t; if(++n<${frames}) requestAnimationFrame(loop); else res(); };
		requestAnimationFrame(loop);
	});
	s.sort((a,b)=>a-b);
	const avg=s.reduce((a,b)=>a+b,0)/s.length;
	return 'OK '+JSON.stringify({avg:+avg.toFixed(2), p50:+s[(s.length*0.5)|0].toFixed(2), p95:+s[(s.length*0.95)|0].toFixed(2), max:+s[s.length-1].toFixed(2), sim:MM.worldSim.metrics()});
})()`;
const PERF = perfExpr(180);
const PERF_QUICK = perfExpr(60);

// The rig, built REMOTELY (600 tiles from the spawn the hero never leaves for
// the perf pair): a sealed brick kiln with an 18-clay batch and lava at its
// face, plus a 600-battery solar farm along the surface. Everything registers
// through the real placement hooks (setTile), exactly as a player build would —
// and because its regions have never been hot, it is born frozen.
const BUILD = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const W=MM.world, WG=MM.worldGen, T=MM.T;
	MM.fog.setRevealAll(true);
	const hx=Math.round(player.x)+600;
	const surf=WG.surfaceHeight(hx);
	if(!Number.isFinite(surf)) return 'FAIL no-surface';
	// kiln chamber: a wide, low brick shell; a 22-clay batch laid as a SINGLE
	// floor layer with open air above; a clear mouth column; a SEALED lava
	// firebox. Four live-world lessons are baked into this geometry: lava flows
	// (box it in or it wanders off and the heat dies); clay FALLS (stack it over
	// the mouth and it drops in, bakes, and plugs the kiln with its own brick);
	// baked brick is a WALL, so clay packed in blocks entombs its own outer
	// layers as the inner ones fire (the chamber flood-fill stops at brick) — a
	// floor layer under open air never seals anything off; and the batch must
	// outlast every hot second of the run, because a lit kiln bakes whenever its
	// region is hot, perf scenes included.
	// …and the fifth lesson: chamberAt's MAX_CHAMBER cap counts every VISITED
	// cell, boundary walls included — a chamber that is honest about volume can
	// still "leak" past the cap on wall visits alone. 13 interior columns keeps
	// the visit count under the cap with margin.
	const kx=hx+6, ky=surf-2;
	for(let x=kx-7;x<=kx+7;x++) for(let y=ky-3;y<=ky+2;y++) W.setTile(x,y,T.BRICK);
	for(let x=kx-6;x<=kx+6;x++){ W.setTile(x,ky-2,T.AIR); W.setTile(x,ky-1,T.CLAY); }
	W.setTile(kx,ky-1,T.AIR);   // the mouth stays clear
	W.setTile(kx,ky,T.KILN);
	W.setTile(kx,ky+1,T.LAVA);
	// solar farm: 600 batteries along the surface, one per column, skipping the
	// kiln's columns (the first version paved a battery over the firebox lava).
	let placed=0;
	for(let i=0;i<620 && placed<600;i++){
		const x=hx-320+i;
		if(x>=kx-9 && x<=kx+9) continue;
		const s=WG.surfaceHeight(x);
		if(!Number.isFinite(s)) continue;
		W.setTile(x,s-1,T.SOLAR_BATTERY);
		placed++;
	}
	// daylight so the farm produces; then let registries settle
	MM.background.importState({cycleT:0.25});
	await sleep(1200);
	const km=MM.kiln.metrics();
	return 'OK '+JSON.stringify({kx,ky,placed,kilns:km.kilns,lit:km.lit,fired:km.fired});
})()`;

const kilnState = () => `(()=>{
	const m=MM.kiln.metrics();
	return 'OK '+JSON.stringify({kilns:m.kilns,lit:m.lit,fired:m.fired,sim:MM.worldSim.metrics(),hero:Math.round(player.x)});
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-farsim-'));
	const proc = spawn(edge, [
		'--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
		'--force-device-scale-factor=1', '--remote-debugging-port=0',
		`--user-data-dir=${profile}`, '--window-size=1280,720', 'about:blank'
	], { stdio: 'ignore' });

	let ws, failed = false, pump = null;
	try {
		let target = null;
		for (let i = 0; i < 60 && !target; i++){
			await sleep(250);
			try {
				const port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0].trim();
				if (!port) continue;
				target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
			} catch (e) { /* not up yet */ }
		}
		if (!target) throw new Error('DevTools endpoint never came up');
		ws = new WebSocket(target.webSocketDebuggerUrl);
		await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
		const events = [], pageErrors = [];
		ws.onmessage = ev => {
			const m = JSON.parse(ev.data);
			if (m.id && pending.has(m.id)){
				const p = pending.get(m.id); pending.delete(m.id);
				if (m.error) p.reject(new Error(p.method + ': ' + JSON.stringify(m.error)));
				else p.resolve(m.result);
			} else if (m.method){
				events.push(m.method);
				if (m.method === 'Runtime.exceptionThrown'){
					try { pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300)); } catch (e) { /* ignore */ }
				}
			}
		};
		await send(ws, 'Page.enable');
		await send(ws, 'Runtime.enable');
		await send(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: `
			const __origGEBI=Document.prototype.getElementById;
			Document.prototype.getElementById=function(id){
				const el=__origGEBI.call(this,id);
				if(id==='seedInput' && el && el.value==='auto') el.value=${JSON.stringify(seed)};
				return el;
			};` });
		const run = async (label, expr, timeout) => {
			const r = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: timeout || 180000 });
			const status = r && r.result ? String(r.result.value) : '(no result)';
			console.log(label + ':', status.length > 600 ? status.slice(0, 600) + '…' : status);
			return status;
		};
		const parse = (s) => { try { return s.startsWith('OK ') ? JSON.parse(s.slice(3)) : null; } catch (e) { return null; } };
		const load = async (label) => {
			events.length = 0;
			await send(ws, 'Page.navigate', { url });
			for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await sleep(250);
			await sleep(1500);
			return parse(await run(label, BOOT));
		};
		pump = setInterval(() => { send(ws, 'Page.bringToFront').catch(() => {}); }, 2000);

		// ---- scene 1: baseline at spawn, nothing built ----------------------
		const boot = await load('boot');
		if (!boot) throw new Error('boot failed');
		const baseline = parse(await run('perf(baseline)', PERF));

		// ---- scene 2: the 600-machine world appears 600 tiles away ----------
		// Built remotely and born frozen. The perf pair below shares ONE
		// viewpoint — the first version measured "far" at a different spot and
		// the scenery difference drowned the machine cost it meant to isolate.
		const rig = parse(await run('build-rig', BUILD, 240000));
		if (!rig) throw new Error('rig build failed');
		await sleep(4000);                       // the build's class-B churn (falling, fluids) settles first
		const far = parse(await run('perf(600 frozen machines, same view)', PERF));

		// ---- scene 3: visit the base — briefly, so the batch outlives it ----
		await run('arrive', `(()=>{ window.__mmDebugHero(${rig.kx}-6, MM.worldGen.surfaceHeight(${rig.kx}-6)-2); return 'OK {}'; })()`);
		await sleep(1200);
		const litState = parse(await run('kiln(lit)', kilnState()));

		// ---- scene 4: leave — the kiln freezes mid-batch --------------------
		await run('depart', `(()=>{ window.__mmDebugHero(${rig.kx}-600, MM.worldGen.surfaceHeight(${rig.kx}-600)-2); return 'OK {}'; })()`);
		await sleep(1200);
		const farBefore = parse(await run('kiln(frozen@t0)', kilnState()));
		await sleep(4500);                       // the absence the wake must pay back
		const farAfter = parse(await run('kiln(frozen@t1)', kilnState()));

		// ---- scene 5: the return — one wake settles the absence -------------
		await run('return', `(()=>{ window.__mmDebugHero(${rig.kx}-6, MM.worldGen.surfaceHeight(${rig.kx}-6)-2); return 'OK {}'; })()`);
		// One breath after the teleport: the first frames pay the chunk-render
		// cache for a viewport full of batteries — a cost teleporting into ANY
		// base has, wake or no wake. The wake itself lands in this window too
		// (its lag keeps accruing until paid), so the measurement still bounds it.
		await sleep(350);
		const returnPerf = parse(await run('perf(return second)', PERF_QUICK));
		await sleep(500);
		const wokenState = parse(await run('kiln(woken)', kilnState()));
		const hot = returnPerf; // the return second IS a hot-farm measurement

		// ---- scene 6: save while away, reload, return again ------------------
		await run('depart2', `(()=>{ window.__mmDebugHero(${rig.kx}-600, MM.worldGen.surfaceHeight(${rig.kx}-600)-2); return 'OK {}'; })()`);
		await sleep(4000);                       // absence accrues again…
		await run('save', `(async()=>{ const ok=await window.__mmRunAutoSaveNow(); return 'OK '+JSON.stringify({saved:!!ok}); })()`, 120000);
		const reboot = await load('boot(reloaded)');
		const owed = parse(await run('staleness(after reload)', `(()=>{
			MM.worldSim.beginFrame(0,window.player,null);
			const lag=MM.worldSim.staleSeconds(${rig.kx},${rig.ky});
			return 'OK '+JSON.stringify({lag:+lag.toFixed(1), now:MM.worldSim.metrics().now});
		})()`));
		const firedAfterReboot = parse(await run('kiln(rebooted)', kilnState()));
		await run('return2', `(()=>{ window.__mmDebugHero(${rig.kx}-6, MM.worldGen.surfaceHeight(${rig.kx}-6)-2); return 'OK {}'; })()`);
		await sleep(1500);
		const finalState = parse(await run('kiln(final)', kilnState()));

		// ---- scene 7: the steady-state price of the frozen world -------------
		// Same viewpoint as the baseline, world long settled. The early post-build
		// measurement stays in the report, but the INVARIANT is asserted here: the
		// first minutes after 600 remote placements still carry class-B settling
		// churn (falling audits, fluids) that has nothing to do with machines.
		await run('depart3', `(()=>{ window.__mmDebugHero(${rig.kx}-606, MM.worldGen.surfaceHeight(${rig.kx}-606)-2); return 'OK {}'; })()`);
		await sleep(2500);
		const farSteady = parse(await run('perf(frozen steady state)', PERF));

		if (pageErrors.length) console.log('pageErrors:', pageErrors.slice(0, 3).join('\n---\n'));

		const fired = (s) => (s ? s.fired : -1);
		const checks = [
			['the rig registered (600 machines, kiln lit on first visit)', !!(rig.placed >= 590 && litState && litState.lit >= 1)],
			// The invariant, measured from ONE viewpoint: 600 frozen machines must
			// cost the frame the same as an empty world. Median-based — headless
			// software rendering is noisy at the tail.
			['600 frozen machines cost the frame ~nothing at steady state (p50 ≤ baseline + 2 ms)', !!(farSteady && baseline && farSteady.p50 <= baseline.p50 + 2)],
			['…and the far frames really skip machines (frozenSkips grew)', !!(far && far.sim.frozenSkips > 1000)],
			['the frozen kiln bakes NOTHING while nobody watches', !!(farBefore && farAfter && fired(farAfter) === fired(farBefore))],
			['the wake settles the absence: the batch is baked on return', !!(wokenState && fired(wokenState) >= fired(farAfter) + 2)],
			['…and the return stays playable (median ≤ 45 ms through the wake window)', !!(returnPerf && returnPerf.p50 <= 45)],
			['the clock survives the reload', !!(reboot && reboot.sim.now > 5)],
			['…and the stamps still owe the pre-save absence', !!(owed && owed.lag >= 3)],
			['…which the post-reload return pays: the kiln keeps baking', !!(finalState && firedAfterReboot && finalState.fired >= firedAfterReboot.fired + 1)]
		];
		for (const [name, pass] of checks){ console.log((pass ? 'PASS  ' : 'FAIL  ') + name); if (!pass) failed = true; }
		console.log('frames:', JSON.stringify({ baseline: baseline && {p50: baseline.p50, p95: baseline.p95}, farPostBuild: far && {p50: far.p50, p95: far.p95}, farSteady: farSteady && {p50: farSteady.p50, p95: farSteady.p95}, returnSecond: returnPerf && {p50: returnPerf.p50, p95: returnPerf.p95, max: returnPerf.max} }));
		console.log('kiln:', JSON.stringify({ lit: litState, frozen: [fired(farBefore), fired(farAfter)], woken: fired(wokenState), rebooted: firedAfterReboot && firedAfterReboot.fired, final: finalState && finalState.fired, owedAfterReload: owed }));
	} catch (e){
		failed = true;
		console.error('far-sim-qa error:', e && e.message);
	} finally {
		if (pump) clearInterval(pump);
		try { if (ws) ws.close(); } catch (e) { /* closing */ }
		// Marker-scoped kill: ONLY the process this driver spawned, by pid.
		try { proc.kill(); } catch (e) { /* already gone */ }
		await sleep(400);
	}
	process.exit(failed ? 1 : 0);
}

main();
