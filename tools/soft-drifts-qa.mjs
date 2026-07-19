#!/usr/bin/env node
// Live end-to-end QA for soft drifts: winter snow fluff accrues on the cold
// surface, an autumn gale drops leaf litter under real tree canopies, emitted
// smoke films the ground with soot, and running through a drift bursts it
// into flakes — driven over CDP against the real game in headless Edge.
//
// Usage: node tools/soft-drifts-qa.mjs [--url=http://127.0.0.1:8123/index.html]
//        [--seed=777] [--shot=soft-drifts-qa.png]
import { spawn, execFile } from 'node:child_process';
import { writeFile, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
	const hit = args.find(a => a.startsWith('--' + name + '='));
	return hit ? hit.slice(name.length + 3) : dflt;
};
const url = opt('url', 'http://127.0.0.1:8123/index.html');
const seed = opt('seed', '777');
const shotPath = opt('shot', '');

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

// Runs inside the page; returns a plain report object (asserted in Node).
const SCENE = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const R={};
	for(let i=0;i<400 && !(window.MM && MM.world && MM.worldGen && MM.seasons && MM.softDrifts && MM.wind && MM.smoke && window.__mmDebugHero);i++) await sleep(100);
	if(!(window.MM && MM.softDrifts)) return {fatal:'boot-timeout'};
	MM.fog.setRevealAll(true);
	const T=MM.T, WG=MM.worldGen, gt=MM.world.getTile, D=MM.softDrifts;
	const isLeafT=t=>t===T.LEAF||t===T.AUTUMN_LEAF_ORANGE||t===T.AUTUMN_LEAF_RED;
	const kd=(key,code)=>window.dispatchEvent(new KeyboardEvent('keydown',{key,code,bubbles:true}));
	const ku=(key,code)=>window.dispatchEvent(new KeyboardEvent('keyup',{key,code,bubbles:true}));
	// tight sampling so accrual is observable inside a QA budget
	D.config.BAND=50; D.config.SAMPLES=44;
	const poll=async(fn,budgetMs)=>{ const t0=Date.now(); while(Date.now()-t0<budgetMs){ if(fn()) return true; await sleep(1000);} return fn(); };

	// --- 1. winter: snow fluff builds on a cold surface -----------------------
	MM.seasons.forceSeason('winter');
	let coldX=null;
	for(let x=-200;x>=-40000 && coldX==null;x-=173){
		const s=WG.surfaceHeight(x);
		if(s<WG.settings.seaLevel-2 && MM.seasons.temperatureAt(x,s)<0.38) coldX=x;
	}
	if(coldX==null) return {fatal:'no-cold-column'};
	window.__mmDebugHero(coldX, WG.surfaceHeight(coldX)-3);
	await sleep(1500);
	MM.wind.forceSquall(1, 6.2, 90); // gale-force winter wind: the snow blizzard must engage
	await poll(()=>D.metrics().byMat.snow>0, 30000);
	await poll(()=>D.metrics().storm.active, 8000);
	const mWinter=D.metrics();
	R.winter={coldX, cells:mWinter.byMat.snow, minted:mWinter.minted.snow, storm:mWinter.storm,
		temp:+MM.seasons.temperatureAt(coldX,WG.surfaceHeight(coldX)).toFixed(3)};

	// --- 2. run-through burst: sprinting over a drift kicks it apart ----------
	// a deterministic belt right ahead of the hero (the live blizzard may march
	// naturally-grown cells away between selection and the sprint)
	const seeded=[];
	{
		const bx=Math.floor(window.player.x)+1;
		for(let i=0;i<4;i++){
			const sc=D._debug.surfaceCell(bx+i, gt);
			if(!sc) continue;
			D._debug.cells.set((bx+i)+','+sc.py, {x:bx+i, y:sc.py, m:'snow', u:6});
			seeded.push(bx+i);
		}
	}
	R.burst={found:seeded.length>0, seeded:seeded.length};
	if(seeded.length){
		const burstsBefore=D.metrics().bursts;
		kd('d','KeyD');
		await sleep(1400);
		ku('d','KeyD');
		await sleep(400);
		R.burst.bursts=D.metrics().bursts-burstsBefore;
	}

	// --- 3. autumn gale: leaf litter lands under real canopies ----------------
	MM.seasons.forceSeason('autumn');
	MM.wind.forceSquall(1, 5.5, 120);
	let canopyX=null;
	for(let hop=0;hop<6 && canopyX==null;hop++){
		const cx=200+hop*700;
		window.__mmDebugHero(cx, WG.surfaceHeight(cx)-3);
		await sleep(1200);
		for(let x=cx-140;x<=cx+140 && canopyX==null;x++){
			const s=WG.surfaceHeight(x);
			for(let y=s-24;y<s-2;y++) if(isLeafT(gt(x,y))){ canopyX=x; break; }
		}
	}
	if(canopyX==null) return {fatal:'no-canopy-found'};
	window.__mmDebugHero(canopyX, WG.surfaceHeight(canopyX)-3);
	await sleep(1000);
	await poll(()=>D.metrics().byMat.leaves>0, 35000);
	await poll(()=>D.metrics().storm.active, 8000);
	const mAutumn=D.metrics();
	R.autumn={canopyX, cells:mAutumn.byMat.leaves, minted:mAutumn.minted.leaves, storm:mAutumn.storm, wind:+MM.wind.speed().toFixed(2)};

	// --- 3b. forced gales are owner-scoped, live ------------------------------
	const forced=D.startStorm('leaves', 12, 0.8, {source:'qa', ownerId:'qa-drifts'});
	const stopWrong=D.stopStorm({ownerId:'someone-else'});
	const stopRight=D.stopStorm({ownerId:'qa-drifts'});
	R.forced={ok:!!forced, wrongOwnerStopped:stopWrong, ownerStopped:stopRight};

	// --- 3c. pustynna zamieć: hot-east desert under a gale-force squall --------
	let desertX=null;
	for(let x=3000;x<=42000 && desertX==null;x+=211){
		if(WG.temperature(x)>=0.78) desertX=x;
	}
	if(desertX==null) return {fatal:'no-desert'};
	window.__mmDebugHero(desertX, WG.surfaceHeight(desertX)-3);
	await sleep(1500);
	MM.wind.forceSquall(1, 6.0, 60);
	await poll(()=>{ const m=D.metrics(); return m.storm.active && m.storm.mat==='sand'; }, 12000);
	await poll(()=>D.metrics().byMat.sand>0, 25000);
	const mSand=D.metrics();
	R.sand={desertX, cells:mSand.byMat.sand, storm:{active:mSand.storm.active, mat:mSand.storm.mat, k:mSand.storm.k}};

	// --- 4. soot: thick smoke films the ground ---------------------------------
	// calm season AND calm air, on temperate turf upwind of the canopy — far
	// from the desert, where the live sand gale keeps GRINDING a fresh soot
	// film away (materials do not mix: the faster fall owns the cell)
	MM.seasons.forceSeason(null);
	MM.wind.forceSquall(1, 0.2, 180); // near-calm for the whole probe budget
	const sootBase=(R.autumn && R.autumn.canopyX!=null)?R.autumn.canopyX:64;
	window.__mmDebugHero(sootBase-80, WG.surfaceHeight(sootBase-80)-3);
	await poll(()=>!D.metrics().storm.active, 20000);
	D.clearAll(); // wipe leftover gale films — the fallout, not the contest, is under test
	// find a strip of 5 dry columns and feed the plume AT each column's actual
	// drift cell — the fallout projects the plume DOWN onto that cell, so the
	// feed must sit at/just above it, not at the worldgen surface line
	// receptive = dry support AND a pure-AIR drift cell (a shrub occupying the
	// landing cell refuses units by design — the bush pokes through the drift)
	let sootX=null;
	for(let probe=Math.floor(window.player.x)-20; probe>Math.floor(window.player.x)-140 && sootX==null; probe-=7){
		let okCols=0;
		for(let dx=-2;dx<=2;dx++){
			const sc=D._debug.surfaceCell(probe+dx, gt);
			if(sc && sc.support!==T.WATER && sc.support!==T.LAVA && gt(probe+dx, sc.py)===T.AIR) okCols++;
		}
		if(okCols===5) sootX=probe;
	}
	if(sootX==null) sootX=Math.floor(window.player.x)-40;
	window.__mmDebugHero(sootX, WG.surfaceHeight(sootX)-3);
	await sleep(1200);
	const sootFeed=setInterval(()=>{
		for(let dx=-2;dx<=2;dx++){
			const sc=D._debug.surfaceCell(sootX+dx, gt);
			if(!sc) continue;
			MM.smoke.emit(sootX+dx, sc.py, 6);
			MM.smoke.emit(sootX+dx, sc.py-1, 4);
		}
	}, 200);
	await poll(()=>D.metrics().byMat.soot>0, 30000);
	clearInterval(sootFeed);
	const mSoot=D.metrics();
	const scHero=D._debug.surfaceCell(sootX, gt);
	R.soot={cells:mSoot.byMat.soot, minted:mSoot.minted.soot, density:scHero?+MM.smoke.densityAt(sootX,scHero.py).toFixed(2):-1};

	// --- 5. ghost plane readback: the host can window the ledger --------------
	const pss=WG.surfaceHeight(sootX);
	const rows=D.ghostLevelsIn(sootX-120, pss-24, sootX+120, pss+8);
	R.plane={rows:rows.length, sample:rows[0]||null};

	MM.seasons.forceSeason(null);
	// the developer toolbox injects the drift/gale panel at boot
	R.debugPanel=!!document.getElementById('driftDebugBox');
	R.frameMs=window.__mmFrameMs;
	return R;
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-soft-drifts-qa-'));
	const proc = spawn(edge, [
		'--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
		'--force-device-scale-factor=1', '--remote-debugging-port=0',
		`--user-data-dir=${profile}`, '--window-size=1600,900', 'about:blank'
	], { stdio: 'ignore' });

	let ws, failures = [];
	const check = (ok, label) => { if (ok) console.log('  ok:', label); else { failures.push(label); console.log('  FAIL:', label); } };
	try {
		let target = null;
		for (let i = 0; i < 60 && !target; i++){
			await sleep(250);
			try {
				const portLine = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0].trim();
				if (!portLine) continue;
				const res = await fetch(`http://127.0.0.1:${portLine}/json/list`);
				target = (await res.json()).find(t => t.type === 'page');
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
					try { pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 400)); } catch (e) { /* ignore */ }
				}
				if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error'){
					try { pageErrors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300)); } catch (e) { /* ignore */ }
				}
			}
		};
		await send(ws, 'Page.enable');
		await send(ws, 'Runtime.enable');
		await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
		if (seed){
			await send(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: `
				const __origGEBI=Document.prototype.getElementById;
				Document.prototype.getElementById=function(id){
					const el=__origGEBI.call(this,id);
					if(id==='seedInput' && el && el.value==='auto') el.value=${JSON.stringify(seed)};
					return el;
				};` });
		}
		await send(ws, 'Page.navigate', { url });
		for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await sleep(250);
		await sleep(1500);

		// Headless occlusion marks the page hidden a few seconds in and rAF (the
		// whole sim) freezes — the ghost-qa gotcha. Keep fronting it while the
		// single long evaluate below drives every scene.
		await send(ws, 'Page.bringToFront');
		const keepFront = setInterval(() => { send(ws, 'Page.bringToFront').catch(() => {}); }, 1500);
		let evalRes;
		try {
			evalRes = await send(ws, 'Runtime.evaluate', { expression: SCENE, awaitPromise: true, returnByValue: true, timeout: 240000 });
		} finally {
			clearInterval(keepFront);
		}
		const R = evalRes && evalRes.result ? evalRes.result.value : null;
		if (!R || R.fatal) throw new Error('scene failed: ' + (R && R.fatal || 'no result'));
		console.log('report:', JSON.stringify(R));

		console.log('winter fluff:');
		check(R.winter.temp < 0.45, 'a cold winter column was found (' + R.winter.temp + ')');
		check(R.winter.cells > 0, 'snow fluff cells accrued on the surface (' + R.winter.cells + ')');
		check(R.winter.storm.active && R.winter.storm.mat === 'snow', 'the winter squall engaged a live snow blizzard (' + JSON.stringify(R.winter.storm) + ')');
		console.log('run-through burst:');
		check(R.burst.found, 'a snow drift stood in the hero belt');
		check(R.burst.bursts >= 1, 'sprinting through the drift kicked it apart (' + R.burst.bursts + ')');
		console.log('autumn litter:');
		check(R.autumn.cells > 0, 'leaf litter accrued under the canopy (' + R.autumn.cells + ')');
		check(R.autumn.storm.active && R.autumn.storm.mat === 'leaves', 'the autumn squall engaged a live leaf gale (' + JSON.stringify(R.autumn.storm) + ')');
		check(R.autumn.storm.blownIn > R.winter.storm.blownIn, 'the leaf gale blew fresh litter in beyond the trees (' + R.winter.storm.blownIn + ' -> ' + R.autumn.storm.blownIn + ')');
		console.log('forced gale:');
		check(R.forced.ok && !R.forced.wrongOwnerStopped && R.forced.ownerStopped, 'forced gales stay owner-scoped (' + JSON.stringify(R.forced) + ')');
		console.log('desert sand:');
		check(R.sand.storm.active && R.sand.storm.mat === 'sand', 'the desert squall engaged a live sand gale (' + JSON.stringify(R.sand.storm) + ')');
		check(R.sand.cells > 0, 'fine sand filmed the desert floor (' + R.sand.cells + ')');
		console.log('soot film:');
		check(R.soot.cells > 0, 'smoke filmed the ground with soot (' + R.soot.cells + ')');
		check(R.soot.minted === 0, 'soot never minted a tile');
		console.log('ghost plane:');
		check(R.plane.rows > 0, 'ghostLevelsIn windows the live ledger (' + R.plane.rows + ' rows)');
		console.log('debug panel:');
		check(R.debugPanel === true, 'the drift/gale debug panel is injected into the toolbox');
		console.log('console:');
		check(pageErrors.length === 0, 'no console errors / uncaught exceptions' + (pageErrors.length ? ' -> ' + pageErrors.slice(0, 3).join(' | ') : ''));

		if (shotPath){
			const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
			await writeFile(shotPath, Buffer.from(shot.data, 'base64'));
			console.log('wrote', shotPath);
		}
	} finally {
		try { if (ws) ws.close(); } catch (e) { /* closing */ }
		await new Promise(res => {
			if (process.platform === 'win32'){
				const marker = profile.split(/[\\/]/).pop();
				execFile('powershell', ['-NoProfile', '-Command',
					`Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }`
				], () => res());
			} else { try { proc.kill(); } catch (e) { /* gone */ } res(); }
		});
	}
	if (failures.length){
		console.error('\nsoft-drifts-qa: ' + failures.length + ' failure(s)');
		process.exit(1);
	}
	console.log('\nsoft-drifts-qa: all live checks passed');
}

main().catch(err => { console.error('soft-drifts-qa fatal:', err && err.message || err); process.exit(1); });
