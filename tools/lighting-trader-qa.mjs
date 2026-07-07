#!/usr/bin/env node
// Headless-Edge live QA for cave lighting (engine/lighting.js) and the
// wandering trader (engine/trader.js): boots the real game over CDP, carves a
// cave, and captures screenshots of the states that must sell:
//   tools/lighting-trader-qa.png    dark carved cave, hero glow only
//   tools/lighting-trader-qa-b.png  same cave lit by a placed torch
//   tools/lighting-trader-qa-c.png  trader stall pitched on the surface
//   tools/lighting-trader-qa-d.png  trade panel open (buy/sell rows, wallet)
// Usage: node tools/lighting-trader-qa.mjs [--url=http://127.0.0.1:8123/index.html] [--size=1600x900]
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
const outA = opt('out', 'tools/lighting-trader-qa.png');
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

const HELPERS = `
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const dayFloatFn=()=>{ const m=MM.seasons&&MM.seasons.metrics?MM.seasons.metrics():null; return m&&isFinite(Number(m.dayFloat))?Number(m.dayFloat):1; };
`;

const STAGE_A = `(async()=>{ ${HELPERS}
	for(let i=0;i<400 && !(window.MM && window.player && MM.lighting && MM.trader && MM.world && MM.worldGen);i++) await sleep(100);
	if(!window.player) return 'boot-timeout';
	try{ MM.background.importState({cycleT:0.25}); }catch(e){}
	try{ MM.fog.setRevealAll(true); }catch(e){}
	const sx=Math.floor(player.x);
	const surf=MM.worldGen.surfaceHeight(sx);
	window.__qa={sx,surf};
	for(let dx=-8;dx<=8;dx++) for(let dy=10;dy<=16;dy++) MM.world.setTile(sx+dx,surf+dy,0);
	player.hp=player.maxHp; player.x=sx+0.5; player.y=surf+15.4; player.vx=0; player.vy=0;
	await sleep(1600);
	const L=MM.lighting;
	return ['A ok','cave light hero='+L.lightAt(sx,surf+15).toFixed(2),
		'cave edge='+L.lightAt(sx+7,surf+13).toFixed(2),
		'darkAlpha='+L.darkAlphaAt(sx+7,surf+13).toFixed(2)].join(' :: ');
})()`;

const STAGE_B = `(async()=>{ ${HELPERS}
	const {sx,surf}=window.__qa;
	MM.world.setTile(sx-3,surf+14,16); // torch on the cave wall shelf
	player.hp=player.maxHp;
	await sleep(900);
	const L=MM.lighting;
	return ['B ok','torch cell='+L.lightAt(sx-3,surf+14).toFixed(2),
		'4 tiles away='+L.lightAt(sx+1,surf+14).toFixed(2),
		'metrics='+JSON.stringify(L.metrics)].join(' :: ');
})()`;

const STAGE_C = `(async()=>{ ${HELPERS}
	const {sx,surf}=window.__qa;
	player.hp=player.maxHp; player.x=sx+0.5; player.y=surf-2; player.vy=0;
	await sleep(700);
	const ok=MM.trader.forceArrive(player, (x,y)=>MM.world.getTile(x,y), {worldGen:MM.worldGen, gameDayFloat:dayFloatFn});
	if(!ok) return 'C trader-arrive-failed';
	const p=MM.trader.position();
	player.x=p.x-5; player.y=Math.floor(p.y)+0.4; player.vy=0;
	await sleep(1500);
	return ['C ok','trader at '+p.x.toFixed(1)+','+p.y.toFixed(1),'active='+MM.trader.isActive()].join(' :: ');
})()`;

const STAGE_D = `(async()=>{ ${HELPERS}
	const p=MM.trader.position();
	player.x=p.x-1.5; player.y=Math.floor(p.y)+0.4; player.vy=0;
	window.inv.diamond=7; window.inv.stone=25;
	const consumed=MM.trader.interactAt(Math.floor(p.x),Math.floor(p.y),player);
	await sleep(600);
	const panel=document.getElementById('traderPanel');
	return ['D ok','click consumed='+consumed,'panel open='+(panel&&!panel.hidden),
		'rows='+(panel?panel.querySelectorAll('.tradeRow').length:0)].join(' :: ');
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-lightqa-'));
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
