#!/usr/bin/env node
// Live end-to-end QA for the carbon chain + SMR: a placed reactor trickles
// energy with the hero nearby, drinks adjacent water and vents REAL steam gas,
// its inspection alarm SCRAMs when ignored and restarts on inspection, and
// three electric stimuli anneal graphite into graphene — in the real game.
//
// Usage: node tools/smr-qa.mjs [--url=http://127.0.0.1:8123/index.html] [--seed=777]
import { spawn, execFile } from 'node:child_process';
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

const SCENE = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const R={};
	for(let i=0;i<400 && !(window.MM && MM.world && MM.worldGen && MM.smr && MM.reactions && MM.gases && window.__mmDebugHero);i++) await sleep(100);
	if(!(window.MM && MM.smr)) return {fatal:'boot-timeout'};
	MM.fog.setRevealAll(true);
	const T=MM.T, WG=MM.worldGen, gt=MM.world.getTile, st=MM.world.setTile, D=MM.smr;
	const poll=async(fn,budgetMs)=>{ const t0=Date.now(); while(Date.now()-t0<budgetMs){ if(fn()) return true; await sleep(700);} return fn(); };

	// --- 0. stage far from spawn: the tutorial NPC's overlay would freeze the
	// sim (uiOverlayHold) if the hero lingered at the starting camp
	const stageX=Math.floor(window.player.x)+140;
	window.__mmDebugHero(stageX, WG.surfaceHeight(stageX)-3);
	await sleep(1200);

	// --- 1. a tended reactor trickles ----------------------------------------
	const bx=Math.floor(window.player.x)+3, by=WG.surfaceHeight(bx)-1;
	window.__mmDebugHero(bx-2, by-2);
	await sleep(800);
	st(bx,by,T.SMR_CELL);
	await poll(()=>D.energyAt(bx,by)>1.2, 15000);
	R.trickle={energy:+D.energyAt(bx,by).toFixed(2), rate:D.config.RATE};

	// --- 2. water in, real steam out (the closed-loop ratio) -----------------
	st(bx-1,by,T.WATER);
	try{ MM.water.onTileChanged(bx-1,by,gt); }catch(e){}
	await poll(()=>D.metrics().boiledTiles>0, 12000);
	await poll(()=>D.metrics().ventedCells>=2, 20000);
	const m2=D.metrics();
	let steamSeen=0;
	for(let x=bx-6;x<=bx+6;x++) for(let y=by-14;y<=by;y++) if(gt(x,y)===T.STEAM) steamSeen++;
	R.boil={boiled:m2.boiledTiles, vented:m2.ventedCells, steamSeen, ratio:m2.loop.steamPerWaterTile};

	// --- 3. alarm -> SCRAM -> inspection restart ------------------------------
	D._debug.forceAlarm(bx,by);
	await poll(()=>D.metrics().alarms>0, 8000);
	const hadAlarm=D.metrics().alarms>0;
	D._debug.setTimers(bx,by,undefined,0.05);
	await poll(()=>D.metrics().off>0, 8000);
	const scrammed=D.metrics().off>0;
	window.__mmDebugHero(bx, by-2);
	await sleep(600);
	const inspected=D.inspectNear(window.player);
	R.lifecycle={hadAlarm, scrammed, inspected, onAfter:D.metrics().on};

	// --- 4. electric annealing: graphite -> graphene --------------------------
	const gx=bx+5, gy=WG.surfaceHeight(gx)-1;
	st(gx,gy,T.GRAPHITE);
	let charging=0, done=null;
	for(let i=0;i<3;i++){
		const r=MM.reactions.apply('electric',gx,gy,gt,st);
		if(r && r.charging) charging++;
		if(r && !r.charging) done=r;
	}
	R.graphene={charging, done:!!done, tile:gt(gx,gy)===T.GRAPHENE};

	// --- 5. the toolbox carries the SMR panel ---------------------------------
	R.debugPanel=!!document.getElementById('smrDebugBox');
	R.frameMs=window.__mmFrameMs;
	return R;
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-smr-qa-'));
	const proc = spawn(edge, ['--headless=new','--disable-gpu','--no-first-run','--hide-scrollbars','--force-device-scale-factor=1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--window-size=1600,900','about:blank'], { stdio: 'ignore' });
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
			if (m.id && pending.has(m.id)){ const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
			else if (m.method){
				events.push(m.method);
				if (m.method === 'Runtime.exceptionThrown'){ try { pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300)); } catch (e) { /* ignore */ } }
				if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error'){ try { pageErrors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200)); } catch (e) { /* ignore */ } }
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
		// scene runs; the sends ride the same socket as the pending evaluate.
		await send(ws, 'Page.bringToFront');
		const keepFront = setInterval(() => { send(ws, 'Page.bringToFront').catch(() => {}); }, 1500);
		let evalRes;
		try{
			evalRes = await send(ws, 'Runtime.evaluate', { expression: SCENE, awaitPromise: true, returnByValue: true, timeout: 180000 });
		} finally {
			clearInterval(keepFront);
		}
		const R = evalRes && evalRes.result ? evalRes.result.value : null;
		if (!R || R.fatal) throw new Error('scene failed: ' + (R && R.fatal || 'no result'));
		console.log('report:', JSON.stringify(R));

		console.log('trickle:');
		check(R.trickle.energy > 1.2, 'a tended reactor trickles energy (' + R.trickle.energy + ' E)');
		console.log('closed loop:');
		check(R.boil.boiled >= 1, 'the reactor drank an adjacent water tile (' + R.boil.boiled + ')');
		check(R.boil.vented >= 2, 'it vents REAL steam gas cells (' + R.boil.vented + '/' + R.boil.ratio + ' per tile)');
		check(R.boil.steamSeen >= 1, 'live steam stands in the world above the plant (' + R.boil.steamSeen + ')');
		console.log('lifecycle:');
		check(R.lifecycle.hadAlarm, 'the inspection alarm raises');
		check(R.lifecycle.scrammed, 'an ignored alarm SCRAMs the reactor');
		check(R.lifecycle.inspected && R.lifecycle.onAfter === 1, 'inspection restarts it (E at the cell)');
		console.log('annealing:');
		check(R.graphene.charging === 2 && R.graphene.done && R.graphene.tile, 'three electric stimuli anneal graphite into graphene');
		console.log('toolbox:');
		check(R.debugPanel === true, 'the SMR debug panel is injected');
		console.log('console:');
		check(pageErrors.length === 0, 'no console errors / uncaught exceptions' + (pageErrors.length ? ' -> ' + pageErrors.slice(0, 3).join(' | ') : ''));
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
		console.error('\nsmr-qa: ' + failures.length + ' failure(s)');
		process.exit(1);
	}
	console.log('\nsmr-qa: all live checks passed');
}
main().catch(err => { console.error('smr-qa fatal:', err && err.message || err); process.exit(1); });
