#!/usr/bin/env node
// Headless-Edge live QA for minimap fog-of-war gating (drawMinimap in main.js).
// Boots the REAL game, lets the minimap build in a fresh world (only the reveal
// cone around the spawn is discovered), samples the minimap's underground band
// for terrain pixels, then flips the debug map reveal (MM.fog.setRevealAll —
// same gate as the M key) and confirms the full cross-section appears.
//   tools/minimap-fog-qa.png    fresh world: minimap shows only discovered cone
//   tools/minimap-fog-qa-b.png  Mapa ON: full terrain cross-section
// Usage: node tools/minimap-fog-qa.mjs [--url=http://127.0.0.1:8123/index.html]
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
const outA = opt('out', 'tools/minimap-fog-qa.png');
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

// Sample the minimap rect straight off the live game canvas. The underground
// band (below the surface line) is the discriminator: undiscovered columns are
// transparent in the minimap buffer (sky shows through), discovered terrain
// paints muted-dark tile colors at 0.62 alpha.
const SAMPLE = `(()=>{
	const c=document.getElementById('game');
	const MW=220, MH=96, mx=c.width-MW-12, my=44;
	const px=c.getContext('2d').getImageData(mx,my,MW,MH).data;
	let dark=0, total=0;
	for(let y=40;y<MH;y++) for(let x=0;x<MW;x++){
		const i=(y*MW+x)*4;
		const luma=0.299*px[i]+0.587*px[i+1]+0.114*px[i+2];
		total++; if(luma<96) dark++;
	}
	return {dark,total,frac:+(dark/total).toFixed(3)};
})()`;

const STAGE = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	for(let i=0;i<400 && !(window.MM && MM.fog && window.player && document.getElementById('game'));i++) await sleep(100);
	if(!window.MM || !MM.fog) return 'boot-timeout';
	try{ MM.background.importState({cycleT:0.25}); }catch(e){}
	if(MM.fog.getRevealAll()) return 'reveal-all-unexpectedly-on';
	// let the offscreen minimap build (rebuild cadence is up to ~3.2s when loaded)
	await sleep(4500);
	return 'ok: fresh world, revealAll=off';
})()`;

const REVEAL = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	MM.fog.setRevealAll(true);
	await sleep(6000); // wait out the slowest rebuild cadence
	return 'ok: revealAll=on';
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-minimapqa-'));
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
			const res = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 90000 });
			const verdict = res && res.result ? res.result.value : '(no result)';
			console.log(label + ':', typeof verdict === 'object' ? JSON.stringify(verdict) : verdict);
			return verdict;
		};

		const staged = await run('stage', STAGE);
		if (!String(staged).startsWith('ok')) failed = true;
		const before = await run('sample-fogged', SAMPLE);
		let shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
		await writeFile(outA, Buffer.from(shot.data, 'base64'));
		console.log('wrote', outA);

		const revealed = await run('reveal', REVEAL);
		if (!String(revealed).startsWith('ok')) failed = true;
		const after = await run('sample-revealed', SAMPLE);
		shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
		await writeFile(outB, Buffer.from(shot.data, 'base64'));
		console.log('wrote', outB);

		// Fogged minimap must hide most of the underground band; Mapa ON must fill
		// it. Terrain paints at 0.62 alpha over bright sky, so "dark" lands around
		// half the band even when fully revealed — thresholds reflect that.
		const okBefore = before && before.frac < 0.2;
		const okAfter = after && after.frac > 0.35 && after.frac > (before ? before.frac + 0.25 : 1);
		console.log('verdict:', okBefore && okAfter ? 'ok' : 'FAIL',
			'foggedFrac=' + (before && before.frac), 'revealedFrac=' + (after && after.frac));
		if (!okBefore || !okAfter) failed = true;

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
