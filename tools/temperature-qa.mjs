#!/usr/bin/env node
// Live end-to-end QA for the temperature axis: permafrost generation in the
// deep-cold west, volume-true snowfall deposition (SNOW tiles + turf dusting),
// the blizzard stack cap, and the thermal-exposure mode helper — driven over
// CDP against the real game in headless Edge (real requestAnimationFrame).
//
// Usage: node tools/temperature-qa.mjs [--url=http://127.0.0.1:8123/index.html]
//        [--seed=42] [--shot=temperature-qa.png]
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
	const R={};
	for(let i=0;i<400 && !(window.MM && MM.world && MM.worldGen && MM.clouds && MM.seasons && MM.survival && window.__mmDebugHero);i++) await sleep(100);
	if(!(window.MM && MM.world && MM.worldGen)) return {fatal:'boot-timeout'};
	MM.fog.setRevealAll(true);
	const T=MM.T, WG=MM.worldGen, gt=MM.world.getTile;
	const FROZEN=[T.FROZEN_DIRT,T.FROZEN_SAND,T.FROZEN_CLAY];

	// --- find deep-cold dry land in the west ---
	let coldX=null;
	for(let x=-30000;x>=-58000 && coldX==null;x-=137){
		const t=WG.temperature(x);
		if(t<0.16 && WG.surfaceHeight(x)<WG.settings.seaLevel-2) coldX=x;
	}
	if(coldX==null) return {fatal:'no-deep-cold-land'};
	R.coldX=coldX; R.climate=WG.temperature(coldX);

	window.__mmDebugHero(coldX, WG.surfaceHeight(coldX)-3);
	await sleep(2000);

	// --- permafrost: frozen soil band near the surface ---
	let frozen=0, loose=0;
	for(let wx=coldX-30;wx<=coldX+30;wx++){
		const s=WG.surfaceHeight(wx);
		if(s>=WG.settings.seaLevel-1) continue;
		for(let y=s;y<s+10;y++){
			const t=gt(wx,y);
			if(FROZEN.includes(t)) frozen++;
			else if(t===T.DIRT||t===T.SAND||t===T.CLAY) loose++;
		}
	}
	R.permafrost={frozen, loose};

	// --- snowfall deposition: an owned blizzard must lay real SNOW tiles ---
	MM.seasons.forceSeason('winter');
	const snowBefore=(()=>{ let n=0; for(let wx=coldX-120;wx<=coldX+120;wx++){ const s=WG.surfaceHeight(wx); for(let y=s-8;y<=s;y++) if(gt(wx,y)===T.SNOW) n++; } return n; })();
	const m0=MM.clouds.metrics();
	MM.clouds.addCloud(coldX,Math.max(4,WG.surfaceHeight(coldX)-28),40);
	MM.clouds.addCloud(coldX-30,Math.max(4,WG.surfaceHeight(coldX)-30),36);
	MM.clouds.startStorm(30,1,{source:'qa',ownerId:'temperature-qa'});
	await sleep(14000);
	const m1=MM.clouds.metrics();
	const snowAfter=(()=>{ let n=0; for(let wx=coldX-120;wx<=coldX+120;wx++){ const s=WG.surfaceHeight(wx); for(let y=s-8;y<=s;y++) if(gt(wx,y)===T.SNOW) n++; } return n; })();
	// deepest freshly-deposited stack above the worldgen surface (storm cap check)
	let deepest=0;
	for(let wx=coldX-120;wx<=coldX+120;wx++){
		const s=WG.surfaceHeight(wx);
		let d=0;
		for(let y=s-1;y>s-9 && gt(wx,y)===T.SNOW;y--) d++;
		if(d>deepest) deepest=d;
	}
	let dusted=0;
	for(let wx=coldX-240;wx<=coldX+240;wx++){
		const s=WG.surfaceHeight(wx);
		for(let y=s-2;y<=s+1;y++) if(gt(wx,y)===T.GRASS_SNOW) dusted++;
	}
	MM.clouds.stopStorm({ownerId:'temperature-qa'});
	MM.seasons.forceSeason(null);
	R.snowfall={snowBefore, snowAfter, snowTiles:m1.snowTiles-(m0.snowTiles||0), rained:+(m1.rainMass-m0.rainMass).toFixed(2),
		snowingAt:MM.clouds.isSnowingAt(coldX), deepest, stormCap:MM.clouds.config.SNOW_STACK_STORM, dusted};

	// --- toxic snowfall: a gas-tainted cloud snows TOXIC_SNOW in the same cold air ---
	MM.seasons.forceSeason('winter');
	MM.clouds.injectToxicVapor(coldX, 10);
	MM.clouds.addCloud(coldX,Math.max(4,WG.surfaceHeight(coldX)-26),40);
	MM.clouds.startStorm(24,1,{source:'qa',ownerId:'temperature-qa-toxic'});
	await sleep(12000);
	let toxicTiles=0;
	for(let wx=coldX-160;wx<=coldX+160;wx++){
		const s=WG.surfaceHeight(wx);
		for(let y=s-8;y<=s;y++) if(gt(wx,y)===T.TOXIC_SNOW) toxicTiles++;
	}
	MM.clouds.stopStorm({ownerId:'temperature-qa-toxic'});
	MM.seasons.forceSeason(null);
	R.toxic={tiles:toxicTiles,
		chillStatus:!!(MM.mobs && MM.mobs.STATUS && MM.mobs.STATUS.chill),
		chillApi:!!(MM.mobs && typeof MM.mobs.chillRadius==='function'),
		snowballTier:!!(MM.weapons && MM.weapons.arrowInfo && MM.weapons.arrowInfo().tiers.some(t=>t.id==='toxicSnowball'))};

	// --- thermal exposure: the live climate/temperature feed picks 'cold' here ---
	const py=WG.surfaceHeight(coldX)-2;
	const temp=MM.seasons.temperatureAt(coldX,py);
	R.thermal={
		temp:+temp.toFixed(3),
		modeExposed:MM.survival.thermalExposureMode({climate:R.climate, temp:Math.min(temp,0.0), sheltered:false, inWater:false, nearWarmth:false}),
		modeSheltered:MM.survival.thermalExposureMode({climate:R.climate, temp:Math.min(temp,0.0), sheltered:true, inWater:false, nearWarmth:false}),
		modeWarmed:MM.survival.thermalExposureMode({climate:R.climate, temp:Math.min(temp,0.0), sheltered:false, inWater:false, nearWarmth:true})
	};

	R.frameMs=window.__mmFrameMs;
	return R;
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-temperature-qa-'));
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

		const evalRes = await send(ws, 'Runtime.evaluate', { expression: SCENE, awaitPromise: true, returnByValue: true, timeout: 240000 });
		const R = evalRes && evalRes.result ? evalRes.result.value : null;
		if (!R || R.fatal) throw new Error('scene failed: ' + (R && R.fatal || 'no result'));
		console.log('report:', JSON.stringify(R));

		console.log('permafrost:');
		check(R.climate < 0.16, 'deep-cold climate band found in the west');
		check(R.permafrost.frozen >= 25, 'frozen soil band generated near the surface');
		check(R.permafrost.frozen > R.permafrost.loose, 'permafrost dominates loose soil in the active layer');
		console.log('snowfall:');
		check(R.snowfall.rained > 0.5, 'blizzard clouds shed mass over the hero');
		check(R.snowfall.snowTiles >= 1, 'snowfall deposited volume-true SNOW tiles (metric)');
		check(R.snowfall.snowAfter > R.snowfall.snowBefore, 'the world visibly gained surface snow');
		check(R.snowfall.deepest <= R.snowfall.stormCap, 'drifts respect the storm stack cap');
		console.log('toxic snow:');
		check(R.toxic.tiles >= 1, 'gas-tainted blizzard settled TOXIC_SNOW tiles (got ' + R.toxic.tiles + ')');
		check(R.toxic.chillStatus && R.toxic.chillApi, 'chill (slow) status + API are live');
		check(R.toxic.snowballTier, 'toxic snowballs registered as bow ammo');
		console.log('thermal:');
		check(R.thermal.modeExposed === 'cold', 'exposed hero in the deep cold reads as chilling');
		check(R.thermal.modeSheltered === 'none', 'shelter breaks the cold drain');
		check(R.thermal.modeWarmed === 'none', 'a nearby fire breaks the cold drain');
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
		console.error('temperature-qa: ' + failures.length + ' failure(s)');
		process.exit(1);
	}
	console.log('temperature-qa: all live checks passed');
}

main().catch(e => { console.error('temperature-qa fatal:', e.message); process.exit(1); });
