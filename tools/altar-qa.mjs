#!/usr/bin/env node
// Headless-Edge live QA for the summoning altar (engine/altar.js): boots the
// real game, scans the fresh world for the nearest shrine, and captures:
//   tools/altar-qa.png      the shrine at night — torch glow + altar smoulder
//   tools/altar-qa-b.png    the paid ritual: offering gone, gargantuan called
// Usage: node tools/altar-qa.mjs [--url=http://127.0.0.1:8123/index.html]
import { spawn, execFile } from 'node:child_process';
import { writeFile, mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
	const hit = args.find(a => a.startsWith('--' + name + '='));
	return hit ? hit.slice(name.length + 3) : dflt;
};
const url = opt('url', 'http://127.0.0.1:8123/index.html');
const [winW, winH] = opt('size', '1600x900').split('x').map(Number);
const outA = opt('out', 'tools/altar-qa.png');
const outB = outA.replace(/\.png$/, '-b.png');

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

const STAGE_A = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	for(let i=0;i<400 && !(window.MM && window.player && MM.altar && MM.world && MM.worldGen);i++) await sleep(100);
	if(!window.player) return 'boot-timeout';
	// find the nearest shrine (same scan the sim test uses)
	let found=null;
	for(let cx=-120;cx<=120 && !found;cx++){
		for(let lx=0;lx<64 && !found;lx++){
			const x=cx*64+lx;
			const surf=MM.worldGen.surfaceHeight(x);
			for(let y=surf-6;y<surf;y++) if(MM.world.getTile(x,y)===74){ found={x,y}; break; }
		}
	}
	if(!found) return 'no-altar-in-range';
	window.__qaAltar=found;
	try{ MM.fog.setRevealAll(true); }catch(e){}
	try{ MM.background.importState({cycleT:0.62}); }catch(e){} // night: torch glow + smoulder
	player.x=found.x+4.5; player.y=found.y-0.5; player.vx=0; player.vy=0; player.hp=player.maxHp;
	await sleep(1800);
	return ['A ok','altar at '+found.x+','+found.y,
		'altar light='+MM.lighting.lightAt(found.x,found.y-1).toFixed(2)].join(' :: ');
})()`;

const STAGE_B = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const a=window.__qaAltar;
	window.inv.diamond=(window.inv.diamond|0)+3; window.inv.obsidian=(window.inv.obsidian|0)+3;
	const used=MM.altar.tryUseAt(a.x,a.y,{getTile:(x,y)=>MM.world.getTile(x,y),inv:window.inv,player,
		gameDayFloat:()=>{const m=MM.seasons&&MM.seasons.metrics?MM.seasons.metrics():null; return m&&isFinite(Number(m.dayFloat))?Number(m.dayFloat):1;}});
	await sleep(2200);
	const bm=MM.bosses&&MM.bosses.metrics?MM.bosses.metrics():null;
	return ['B ok','ritual='+used,'diamonds left='+window.inv.diamond,
		'bosses='+(bm?JSON.stringify({alive:bm.alive??bm.count??'?'}):'?')].join(' :: ');
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-altarqa-'));
	const proc = spawn(edge, [
		'--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
		'--force-device-scale-factor=1',
		'--remote-debugging-port=0',
		`--user-data-dir=${profile}`,
		`--window-size=${winW},${winH}`,
		'about:blank'
	], { stdio: 'ignore' });

	let ws;
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
		const events = [];
		const pageErrors = [];
		ws.onmessage = ev => {
			const m = JSON.parse(ev.data);
			if (m.id && pending.has(m.id)){
				const p = pending.get(m.id); pending.delete(m.id);
				if (m.error) p.reject(new Error(p.method + ': ' + JSON.stringify(m.error)));
				else p.resolve(m.result);
			} else if (m.method){
				events.push(m.method);
				if (m.method === 'Runtime.exceptionThrown'){
					try { pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 500)); } catch (e) { /* ignore */ }
				}
				if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error'){
					try { pageErrors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300)); } catch (e) { /* ignore */ }
				}
			}
		};

		await send(ws, 'Page.enable');
		await send(ws, 'Runtime.enable');
		await send(ws, 'Emulation.setDeviceMetricsOverride', { width: winW, height: winH, deviceScaleFactor: 1, mobile: false });
		await send(ws, 'Page.navigate', { url });
		for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await sleep(250);
		await sleep(1500);

		for (const [label, expr, out] of [['A', STAGE_A, outA], ['B', STAGE_B, outB]]){
			const r = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 120000 });
			console.log('stage ' + label + ':', r && r.result ? r.result.value : '(no result)');
			const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
			await writeFile(out, Buffer.from(shot.data, 'base64'));
			console.log('wrote', out);
		}

		if (pageErrors.length) console.log('pageErrors:', pageErrors.slice(0, 5).join('\n---\n'));
	} finally {
		try { if (ws) ws.close(); } catch (e) { /* closing */ }
		await new Promise(res => {
			if (process.platform === 'win32'){
				const marker = profile.split(/[\\/]/).pop();
				execFile('powershell', ['-NoProfile', '-Command',
					`Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }`
				], () => res());
			} else { try { proc.kill('SIGKILL'); } catch (e) { /* gone */ } res(); }
		});
		await sleep(600);
		try { await rm(profile, { recursive: true, force: true }); } catch (e) { /* profile locked; temp dir */ }
	}
}

main().catch(err => { console.error(err); process.exit(1); });
