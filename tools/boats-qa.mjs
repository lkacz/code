#!/usr/bin/env node
// Headless-Edge live QA for wooden boats (engine/boats.js) + ocean basins:
//   tools/boats-qa.png    3-plank raft floating in a carved pond, hero on deck
//   tools/boats-qa-b.png  wind override pushed the raft (hero carried along)
//   tools/boats-qa-c.png  rowing against calm water (energy burned, vx set)
//   tools/boats-qa-d.png  nearest real ocean: abyssal water over the bedrock seal
// Usage: node tools/boats-qa.mjs [--url=http://127.0.0.1:8123/index.html]
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
const outA = opt('out', 'tools/boats-qa.png');
const outB = outA.replace(/\.png$/, '-b.png');
const outC = outA.replace(/\.png$/, '-c.png');
const outD = outA.replace(/\.png$/, '-d.png');

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
	for(let i=0;i<400 && !(window.MM && window.player && MM.boats && MM.world && MM.worldGen);i++) await sleep(100);
	if(!window.player) return 'boot-timeout';
	try{ MM.background.importState({cycleT:0.25}); }catch(e){}
	try{ MM.wind.setOverride(0); }catch(e){}
	const sx=Math.floor(player.x);
	const surf=MM.worldGen.surfaceHeight(sx);
	// sealed pit pond right of the hero: walls + floor stay rock so it can't drain
	for(let dx=2;dx<=17;dx++){
		MM.world.setTile(sx+dx,surf-1,0);
		MM.world.setTile(sx+dx,surf,8);
		MM.world.setTile(sx+dx,surf+1,8);
		MM.world.setTile(sx+dx,surf+2,8);
	}
	await sleep(600);
	const p1=MM.boats.placeWood(sx+8,surf,(x,y)=>MM.world.getTile(x,y));
	const p2=MM.boats.placeWood(sx+9,surf,(x,y)=>MM.world.getTile(x,y));
	const p3=MM.boats.placeWood(sx+10,surf,(x,y)=>MM.world.getTile(x,y));
	await sleep(1200);
	const m=MM.boats.metrics();
	const b=MM.boats._debug.boats()[0];
	player.hp=player.maxHp; player.x=b.x+1.5; player.y=b.y-0.8; player.vx=0; player.vy=0;
	await sleep(700);
	return ['A ok','placed='+[p1.ok,p2.ok,p3.ok].join(','),'metrics='+JSON.stringify(MM.boats.metrics()),'boatY='+b.y.toFixed(2)+' surf='+surf].join(' :: ');
})()`;

const STAGE_B = `(async()=>{ ${HELPERS}
	const b=MM.boats._debug.boats()[0];
	if(!b) return 'no-boat';
	const x0=b.x, hx0=player.x;
	MM.wind.setOverride(4);
	await sleep(3500);
	MM.wind.setOverride(0);
	const m=MM.boats.metrics();
	return ['B ok','boat drift='+(b.x-x0).toFixed(2),'hero drift='+(player.x-hx0).toFixed(2),'aboard='+m.heroAboard,'vx='+b.vx.toFixed(2)].join(' :: ');
})()`;

const STAGE_C = `(async()=>{ ${HELPERS}
	const b=MM.boats._debug.boats()[0];
	if(!b) return 'no-boat';
	player.energy=Math.max(player.energy||0, 40);
	const e0=player.energy;
	await sleep(400); // physics keeps heroBoatId fresh
	let strokes=0;
	for(let i=0;i<6;i++){ const r=MM.boats.row(-1,{heroEnergy:MM.heroEnergy}); if(r.ok) strokes++; await sleep(160); }
	const out=['C ok','strokes='+strokes,'vx='+b.vx.toFixed(2),'energy '+e0.toFixed(1)+'->'+player.energy.toFixed(1),'aboard='+MM.boats.metrics().heroAboard].join(' :: ');
	await sleep(400);
	return out;
})()`;

const STAGE_D = `(async()=>{ ${HELPERS}
	const WG=MM.worldGen;
	const sea=WG.settings.seaLevel;
	// nearest sealed ocean basin from spawn
	let basin=null, at=0;
	for(let d=0; d<12000 && !basin; d+=16){
		for(const dir of [1,-1]){
			const b=WG.oceanBasinAt(Math.floor(player.x)+d*dir);
			if(b){ basin=b; at=Math.floor(player.x)+d*dir; break; }
		}
	}
	if(!basin) return 'no-basin-within-12k';
	const mid=Math.round((basin.left+basin.right)/2);
	let deepest=0;
	for(let x=basin.left; x<=basin.right; x++){ const r=WG.surfaceHeight(x); if(r-sea>deepest) deepest=r-sea; }
	const sealTop=WG.oceanSealTop(mid);
	const probes=[sealTop+2,sealTop+8,120,139].map(y=>MM.world.getTile(mid,y));
	// stand the hero on the shore for the vista shot
	const shoreX=basin.left-4;
	player.x=shoreX+0.5; player.y=WG.surfaceHeight(shoreX)-1.2; player.vx=0; player.vy=0;
	await sleep(2500);
	return ['D ok','basin='+JSON.stringify(basin),'deepest='+deepest,'sealTop='+sealTop,'probes(BEDROCK=57)='+probes.join(','),'hint msg armed'].join(' :: ');
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-boatqa-'));
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

		for (const [label, expr, out] of [['A', STAGE_A, outA], ['B', STAGE_B, outB], ['C', STAGE_C, outC], ['D', STAGE_D, outD]]){
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
