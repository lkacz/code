#!/usr/bin/env node
// Headless-Edge live QA for the steam circuit (engine/steam_machines.js +
// steam flight in engine/mechs.js). Boots the REAL game over CDP and drives:
//   A) steam elevator — boiler beside water + lava firebox, jet column lifts
//      the hero (tools/steam-machines-qa-a.png)
//   B) steam airship — chair + hull + boiler + jet row assembles on the seat,
//      held W burns steam and the hull climbs (tools/steam-machines-qa-b.png)
// Usage: node tools/steam-machines-qa.mjs [--url=http://127.0.0.1:8123/index.html]
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
const outBase = opt('out', 'tools/steam-machines-qa').replace(/\.png$/, '');

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
	for(let i=0;i<600 && !(window.MM && MM.world && MM.steamMachines && MM.mechs && MM.fog && window.__mmDebugHero && window.player);i++) await sleep(100);
	if(!(window.MM && MM.steamMachines)) return 'boot-timeout';
	MM.fog.setRevealAll(true);
	try{ MM.background.importState({cycleT:0.30}); }catch(e){}
	try{ document.getElementById('craft').style.display='none'; }catch(e){}
	window.player.maxHp=100000; window.player.hp=100000;
	// flat build pad far from spawn structures
	window.__qaSet=(x,y,t)=>MM.world.setTile(x,y,t);
	window.__qaGround=(x0,x1,y)=>{ for(let x=x0;x<=x1;x++){ for(let yy=y;yy<y+4;yy++) window.__qaSet(x,yy,MM.T.STONE); for(let yy=y-14;yy<y;yy++) window.__qaSet(x,yy,MM.T.AIR); } };
	return 'ok: steam machines live, CFG boilRate='+MM.steamMachines.CFG.BOIL_RATE;
})()`;

const ELEVATOR = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const T=MM.T;
	const cx=300;
	const gy=(MM.worldGen && MM.worldGen.surfaceHeight) ? MM.worldGen.surfaceHeight(cx) : 40;
	window.__qaGround(cx-12,cx+12,gy);
	// boiler with a lava firebox below-left and a pond on the right
	window.__qaSet(cx-2,gy-1,T.STEAM_BOILER);
	window.__qaSet(cx-3,gy-1,T.LAVA);
	window.__qaSet(cx-1,gy-1,T.WATER);
	window.__qaSet(cx,gy-1,T.STEAM_JET);
	window.__mmDebugHero(cx+4,gy-2);
	await sleep(1000);
	// step onto the column
	window.__mmDebugHero(cx+0.5,gy-2);
	window.player.vx=0; window.player.vy=0;
	const y0=window.player.y;
	await sleep(2000);
	const m=MM.steamMachines.metrics();
	const b=MM.steamMachines.boilerAt(cx-2,gy-1);
	const rose=y0-window.player.y;
	if(!b) return 'boiler-not-registered';
	if(!(m.lifted>0) && rose<1) return 'no-lift: rose='+rose.toFixed(2)+' metrics='+JSON.stringify(m);
	return 'ok: rose='+rose.toFixed(2)+' boiler{w:'+b.water.toFixed(1)+',s:'+b.steam.toFixed(1)+'} lavaHeat='+m.lavaHeat.toFixed(1)+' lifted='+m.lifted.toFixed(1);
})()`;

const AIRSHIP = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const T=MM.T;
	const cx=340;
	const gy=(MM.worldGen && MM.worldGen.surfaceHeight) ? MM.worldGen.surfaceHeight(cx) : 40;
	window.__qaGround(cx-10,cx+10,gy);
	// hull: chair on top, steel + boiler middle, full jet row on the ground
	window.__qaSet(cx+1,gy-3,T.CHAIR_STEEL);
	window.__qaSet(cx,gy-2,T.STEEL);
	window.__qaSet(cx+1,gy-2,T.STEEL);
	window.__qaSet(cx+2,gy-2,T.STEAM_BOILER);
	for(let x=cx;x<=cx+2;x++) window.__qaSet(x,gy-1,T.STEAM_JET);
	// pre-tank the world boiler: assembly must lift this into the hull
	MM.steamMachines.primeBoilerAt(cx+2,gy-2, 20, 55);
	window.__mmDebugHero(cx+1.5,gy-3);
	await sleep(1200);
	const ship=MM.mechs.heroMech && MM.mechs.heroMech();
	if(!ship) return 'not-seated';
	if(ship.variant!=='steam') return 'wrong-drive:'+ship.variant;
	const tank0=MM.mechs.steamTotal(ship);
	const y0=ship.y;
	// hold W: real keyboard events drive the real control path
	window.dispatchEvent(new KeyboardEvent('keydown',{key:'w',bubbles:true}));
	document.dispatchEvent(new KeyboardEvent('keydown',{key:'w',bubbles:true}));
	await sleep(1800);
	const climbed=y0-ship.y;
	const burned=tank0-MM.mechs.steamTotal(ship);
	if(!(climbed>1)) return 'no-climb: dy='+climbed.toFixed(2)+' burned='+burned.toFixed(2)+' tank0='+tank0.toFixed(1);
	return 'ok: climbed='+climbed.toFixed(2)+' tiles, steam burned='+burned.toFixed(2)+' of '+tank0.toFixed(1);
})()`;

const AIRSHIP_RELEASE = `(async()=>{
	window.dispatchEvent(new KeyboardEvent('keyup',{key:'w',bubbles:true}));
	document.dispatchEvent(new KeyboardEvent('keyup',{key:'w',bubbles:true}));
	return 'ok: released';
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-steamqa-'));
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
					try { pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 400)); } catch (e) { /* ignore */ }
				}
			}
		};

		await send(ws, 'Page.enable');
		await send(ws, 'Runtime.enable');
		await send(ws, 'Emulation.setDeviceMetricsOverride', { width: winW, height: winH, deviceScaleFactor: 1, mobile: false });
		await send(ws, 'Page.navigate', { url });
		for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await sleep(250);
		await sleep(1500);

		let failed = false;
		const run = async (label, expr) => {
			const res = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 120000 });
			const verdict = res && res.result ? res.result.value : '(no result)';
			console.log(label + ':', verdict);
			if (!String(verdict).startsWith('ok')) failed = true;
			return verdict;
		};
		const shoot = async suffix => {
			const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
			const file = `${outBase}-${suffix}.png`;
			await writeFile(file, Buffer.from(shot.data, 'base64'));
			console.log('wrote', file);
		};

		await run('boot', BOOT);
		await run('elevator', ELEVATOR);
		await shoot('a');
		await run('airship', AIRSHIP);
		await shoot('b');
		await run('release', AIRSHIP_RELEASE);

		if (pageErrors.length) console.log('pageErrors:', pageErrors.slice(0, 5).join('\n---\n'));
		if (failed || pageErrors.length) process.exitCode = 1;
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
