#!/usr/bin/env node
// Live end-to-end QA for the four environment systems: water, wind, weather
// (clouds/storms), and day/night — driven over CDP against the real game in
// headless Edge (real requestAnimationFrame; virtual time freezes rAF).
//
// Exercises each system through its public MM API while the game loop runs,
// then fails on any console error/uncaught exception and on missing behavior:
//   * day/night: cycle import flips timeInfo/getCycleInfo and solar daylight
//   * seasons: forced winter raises freezeStrength, natural mode restores
//   * wind: finite speed within cap, forced squall visibly kicks the wind
//   * water: live sim metrics near the ocean, addSource pours a settling block
//   * weather: shaman-style owned storm starts, rains, rejects a foreign stop
//
// Usage: node tools/weather-systems-qa.mjs [--url=http://127.0.0.1:8123/index.html]
//        [--seed=42] [--shot=weather-qa.png]
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
const seed = opt('seed', '42');
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
	const R={steps:[]};
	for(let i=0;i<400 && !(window.MM && MM.background && MM.water && MM.wind && MM.clouds && MM.seasons && window.__mmDebugHero);i++) await sleep(100);
	if(!(window.MM && MM.background && MM.water)) return {fatal:'boot-timeout'};
	MM.fog.setRevealAll(true);
	const ui=document.getElementById('ui'); if(ui) ui.style.display='none';
	const gt=MM.world && MM.world.getTile, st=MM.world && MM.world.setTile;

	// --- day/night: cycle import must flip every consumer-facing readout ---
	MM.background.importState({cycleT:0.25});
	await sleep(400);
	const noon=MM.background.timeInfo();
	MM.background.importState({cycleT:0.62});
	await sleep(600); // getCycleInfo caches from the live draw: give it frames
	const night=MM.background.timeInfo();
	const nightCached=MM.background.getCycleInfo();
	const solarNight=MM.solar && MM.solar.metrics ? MM.solar.metrics().sun : null;
	R.dayNight={noonIsDay:noon.isDay, noonHour:noon.hour, nightIsDay:night.isDay,
		cachedNightIsDay:nightCached.isDay, solarNight};
	MM.background.importState({cycleT:0.25});
	await sleep(400);

	// --- seasons: forced winter must harden the profile, natural must restore ---
	const natural=MM.seasons.profile();
	MM.seasons.forceSeason('winter');
	const winter=MM.seasons.profile();
	MM.seasons.forceSeason(null);
	R.seasons={naturalId:natural.id, winterFreeze:winter.freezeStrength,
		restored:MM.seasons.metrics().forced===false};

	// --- wind: sane speed, squalls kick immediately ---
	const wm0=MM.wind.metrics();
	MM.wind.forceSquall(1,3.4,10);
	const wm1=MM.wind.metrics();
	R.wind={baseFinite:Number.isFinite(wm0.speed), baseSpeed:wm0.speed,
		squallSpeed:wm1.speed, squallActive:wm1.squall.active,
		capOk:Math.abs(wm1.speed)<=7.2+0.01};

	// --- water: park on the ocean shore, pour a block, watch it live ---
	let ox=null;
	for(let x=0;x<3000 && ox==null;x+=8){ if(MM.worldGen.surfaceHeight(x)>68) ox=x; if(ox==null && MM.worldGen.surfaceHeight(-x)>68) ox=-x; }
	ox=ox==null?0:ox;
	window.__mmDebugHero(ox, MM.worldGen.surfaceHeight(ox)-3);
	await sleep(1500);
	const wBefore=MM.water.metrics();
	const pourY=MM.worldGen.surfaceHeight(ox)-8;
	const addOk=gt && st ? MM.water.addSource(ox,pourY,gt,st) : null;
	await sleep(2500);
	const wAfter=MM.water.metrics();
	R.water={addOk, activeBefore:wBefore.active, partialsAfter:wAfter.partials,
		springs:wAfter.springs, poured:gt ? MM.water.levelAt(ox,MM.worldGen.surfaceHeight(ox)-1,gt)>=0 : null};

	// --- weather: an owned (shaman-style) storm starts, rains, guards its owner ---
	MM.clouds.startStorm(40,1,{source:'qa',ownerId:'weather-qa'});
	await sleep(6000);
	const cm=MM.clouds.metrics();
	const foreignStop=MM.clouds.stopStorm({ownerId:'someone-else'});
	const ownStop=MM.clouds.stopStorm({ownerId:'weather-qa'});
	R.storm={active:cm.storm.active, intensity:cm.storm.intensity, clouds:cm.clouds,
		cloudMass:cm.cloudMass, drops:cm.drops, foreignStop, ownStop};

	R.frameMs=window.__mmFrameMs;
	return R;
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-weather-qa-'));
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

		const evalRes = await send(ws, 'Runtime.evaluate', { expression: SCENE, awaitPromise: true, returnByValue: true, timeout: 180000 });
		const R = evalRes && evalRes.result ? evalRes.result.value : null;
		if (!R || R.fatal) throw new Error('scene failed: ' + (R && R.fatal || 'no result'));
		console.log('report:', JSON.stringify(R));

		console.log('day/night:');
		check(R.dayNight.noonIsDay === true, 'noon import reads as day');
		check(R.dayNight.nightIsDay === false, 'night import reads as night (timeInfo)');
		check(R.dayNight.cachedNightIsDay === false, 'night reaches the cached getCycleInfo consumers');
		check(R.dayNight.solarNight === null || R.dayNight.solarNight <= 0.05, 'solar daylight collapses at night');
		console.log('seasons:');
		check(R.seasons.winterFreeze > 0.9, 'forced winter raises freezeStrength');
		check(R.seasons.restored === true, 'natural mode restores after forcing');
		console.log('wind:');
		check(R.wind.baseFinite, 'wind speed is finite');
		check(R.wind.squallActive && Math.abs(R.wind.squallSpeed - R.wind.baseSpeed) > 0.8, 'forced squall kicks the wind immediately');
		check(R.wind.capOk, 'wind speed respects the gale cap');
		console.log('water:');
		check(R.water.addOk === true, 'addSource pours into the live world');
		check(R.water.partialsAfter > 0 || R.water.springs > 0, 'live water sim shows sub-tile levels / surface springs');
		console.log('weather:');
		check(R.storm.active === true, 'owned storm is active while running');
		check(R.storm.clouds >= 1, 'storm keeps clouds overhead');
		check(R.storm.foreignStop === false, 'foreign ownerId cannot stop the storm');
		check(R.storm.ownStop === true, 'owner can stop its storm');
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
		console.error('weather-systems-qa: ' + failures.length + ' failure(s)');
		process.exit(1);
	}
	console.log('weather-systems-qa: all live checks passed');
}

main().catch(e => { console.error('weather-systems-qa fatal:', e.message); process.exit(1); });
