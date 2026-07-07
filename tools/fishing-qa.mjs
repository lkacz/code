#!/usr/bin/env node
// Headless-Edge live QA for fishing (engine/fishing.js): boots the real game,
// carves a pond at the hero's feet, grants a rod and drives a full catch:
//   tools/fishing-qa.png    bobber floating on the pond, line from the hero
//   tools/fishing-qa-b.png  bite: bobber dips, ❗ alert bouncing
//   tools/fishing-qa-c.png  after the hook: catch message + fish arcing home
// Usage: node tools/fishing-qa.mjs [--url=http://127.0.0.1:8123/index.html]
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
const outA = opt('out', 'tools/fishing-qa.png');
const outB = outA.replace(/\.png$/, '-b.png');
const outC = outA.replace(/\.png$/, '-c.png');

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

const HELPERS = `const sleep=ms=>new Promise(r=>setTimeout(r,ms));`;

const STAGE_A = `(async()=>{ ${HELPERS}
	for(let i=0;i<400 && !(window.MM && window.player && MM.fishing && MM.world && MM.worldGen);i++) await sleep(100);
	if(!window.player) return 'boot-timeout';
	try{ MM.background.importState({cycleT:0.25}); }catch(e){}
	const sx=Math.floor(player.x);
	const surf=MM.worldGen.surfaceHeight(sx);
	// sealed pit pond right of the hero: open the surface row, sink 2 rows of
	// water into solid ground (side walls + floor stay rock, so it can't drain)
	for(let dx=2;dx<=7;dx++){
		MM.world.setTile(sx+dx,surf,0);
		MM.world.setTile(sx+dx,surf+1,8);
		MM.world.setTile(sx+dx,surf+2,8);
	}
	player.hp=player.maxHp; player.x=sx+0.8; player.y=surf-0.6; player.vx=0; player.vy=0; player.facing=1;
	window.inv.fishingRod=Math.max(1,window.inv.fishingRod|0);
	await sleep(1200);
	MM.fishing.onKey(player,(x,y)=>MM.world.getTile(x,y));
	await sleep(700);
	return ['A ok','phase='+MM.fishing.phase(),'bobber='+JSON.stringify(MM.fishing.bobber())].join(' :: ');
})()`;

const STAGE_B = `(async()=>{ ${HELPERS}
	const S=MM.fishing._state();
	S.t=S.biteAt+1; // force the bite on the next update tick
	await sleep(350);
	return ['B ok','phase='+MM.fishing.phase()].join(' :: ');
})()`;

const STAGE_C = `(async()=>{ ${HELPERS}
	const fishBefore=window.inv.fish|0;
	MM.fishing.onKey(player,(x,y)=>MM.world.getTile(x,y));
	// small fish lands instantly; bigger ones fight — hook every window
	for(let i=0;i<6 && MM.fishing.isActive();i++){
		const S=MM.fishing._state();
		if(S.phase==='pullWait'){ S.windowT=0.01; await sleep(120); }
		if(MM.fishing.phase()==='pullWindow') MM.fishing.onKey(player,(x,y)=>MM.world.getTile(x,y));
		await sleep(120);
	}
	await sleep(300);
	return ['C ok','phase='+MM.fishing.phase(),'fish '+fishBefore+'->'+(window.inv.fish|0),'golden='+(window.inv.goldenFish|0)].join(' :: ');
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-fishqa-'));
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

		for (const [label, expr, out] of [['A', STAGE_A, outA], ['B', STAGE_B, outB], ['C', STAGE_C, outC]]){
			const r = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 90000 });
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
