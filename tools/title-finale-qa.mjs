#!/usr/bin/env node
// Headless-Edge live QA for the game's bookends (title_screen.js + finale.js).
// Three scenes over CDP:
//   1) plain boot — asserts the title AUTO-SKIPS under headless (the contract
//      that keeps the other 20+ QA drivers overlay-free)
//   2) ?title=1 boot — the forced title screen: overlay visible, sim frozen,
//      keys swallowed, Enter dismisses and unfreezes → tools/title-qa.png
//   3) forced finale — unlock + open the layer-closure report: guardians named,
//      stats grid, credits, Esc closes, menu entry revealed → tools/finale-qa.png
// Usage: node tools/title-finale-qa.mjs [--url=http://127.0.0.1:8123/index.html] [--size=1600x900]
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
const outTitle = opt('out', 'tools/title-qa.png');
const outFinale = outTitle.replace(/title-qa\.png$/, 'finale-qa.png');

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

const BOOT_WAIT = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	for(let i=0;i<400 && !(window.MM && MM.titleScreen && MM.finale && window.player);i++) await sleep(100);
	return (window.MM && MM.titleScreen) ? 'ok' : 'boot-timeout';
})()`;

// Scene 1: default headless boot must skip the title (QA-driver contract).
const SKIP_CHECK = `(()=>{
	const m=MM.titleScreen.metrics();
	return 'ok:boot='+m.boot+' open='+m.open+' overlay='+!!document.getElementById('titleScreen');
})()`;

// Scene 2: forced title — overlay up, sim frozen, keys owned by the menu.
const TITLE_CHECK = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const out=[];
	const el=document.getElementById('titleScreen');
	out.push('shown='+(MM.titleScreen.isOpen() && !!el && el.classList.contains('show')));
	out.push('primary='+(el ? (el.querySelector('.tsPrimary')||{}).textContent : '(none)'));
	out.push('splash='+(el ? !!el.querySelector('.tsSplash').textContent.trim() : false));
	// frozen: the hero must not move while D is held under the title
	const x0=player.x;
	window.dispatchEvent(new KeyboardEvent('keydown',{key:'d',bubbles:true,cancelable:true}));
	await sleep(700);
	window.dispatchEvent(new KeyboardEvent('keyup',{key:'d',bubbles:true}));
	out.push('frozen='+(Math.abs(player.x-x0)<0.01));
	return 'ok:'+out.join(' ');
})()`;

const TITLE_DISMISS = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
	await sleep(700);
	const gone=!MM.titleScreen.isOpen();
	// unfrozen: a held D moves the hero again
	const x0=player.x;
	window.dispatchEvent(new KeyboardEvent('keydown',{key:'d',bubbles:true,cancelable:true}));
	await sleep(700);
	window.dispatchEvent(new KeyboardEvent('keyup',{key:'d',bubbles:true}));
	return 'ok:dismissed='+gone+' resumed='+(Math.abs(player.x-x0)>0.05);
})()`;

// Scene 3: the finale ceremony, forced open the way the story would.
const FINALE_OPEN = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const out=[];
	MM.finale.unlock();
	MM.finale.update(MM.finale.config.BANNER_DELAY+1); // the pre-report banner
	await sleep(200);
	out.push('banner='+!!document.getElementById('finaleBanner'));
	MM.finale.open();
	await sleep(600);
	const el=document.getElementById('finaleScreen');
	out.push('open='+(MM.finale.isOpen() && !!el && el.classList.contains('show')));
	out.push('bannerGone='+!document.getElementById('finaleBanner'));
	out.push('guardians='+(el ? el.querySelectorAll('.fnGuardian').length : 0));
	out.push('stats='+(el ? el.querySelectorAll('.fnStat').length : 0));
	out.push('credits='+(el ? el.querySelectorAll('.fnCredit').length : 0));
	out.push('menuEntry='+(document.getElementById('openFinale') && !document.getElementById('openFinale').hidden));
	return 'ok:'+out.join(' ');
})()`;

const FINALE_CLOSE = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
	await sleep(600);
	return 'ok:closed='+!MM.finale.isOpen()+' seen='+MM.finale.metrics().seen
		+' layers='+MM.finale.layers().completions;
})()`;

// Scene 4: the closed layer follows the observer to the next title screen.
const VETERAN_CHECK = `(()=>{
	const el=document.getElementById('titleScreen');
	const kicker=el ? (el.querySelector('.tsKicker')||{}).textContent : '(none)';
	return 'ok:layers='+MM.finale.layers().completions
		+' kicker='+JSON.stringify(kicker)
		+' veteranKicker='+(String(kicker).indexOf('zamknięte warstwy: 1')>=0);
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-titleqa-'));
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
		let loads = 0;
		const pageErrors = [];
		ws.onmessage = ev => {
			const m = JSON.parse(ev.data);
			if (m.id && pending.has(m.id)){
				const p = pending.get(m.id); pending.delete(m.id);
				if (m.error) p.reject(new Error(p.method + ': ' + JSON.stringify(m.error)));
				else p.resolve(m.result);
			} else if (m.method){
				if (m.method === 'Page.loadEventFired') loads++;
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

		const navigate = async (to) => {
			const before = loads;
			await send(ws, 'Page.navigate', { url: to });
			for (let i = 0; i < 80 && loads === before; i++) await sleep(250);
			await sleep(1200);
			const booted = await send(ws, 'Runtime.evaluate', { expression: BOOT_WAIT, awaitPromise: true, returnByValue: true, timeout: 60000 });
			return booted && booted.result ? booted.result.value : '(no result)';
		};

		// Scene 1: plain headless boot auto-skips the title
		console.log('boot(plain):', await navigate(url));
		const skipRes = await send(ws, 'Runtime.evaluate', { expression: SKIP_CHECK, returnByValue: true });
		console.log('skip:', skipRes.result.value);

		// Scene 2: forced title screen
		console.log('boot(?title=1):', await navigate(url + '?title=1'));
		const titleRes = await send(ws, 'Runtime.evaluate', { expression: TITLE_CHECK, awaitPromise: true, returnByValue: true, timeout: 30000 });
		console.log('title:', titleRes.result.value);
		let shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
		await writeFile(outTitle, Buffer.from(shot.data, 'base64'));
		console.log('wrote', outTitle);
		const dismissRes = await send(ws, 'Runtime.evaluate', { expression: TITLE_DISMISS, awaitPromise: true, returnByValue: true, timeout: 30000 });
		console.log('dismiss:', dismissRes.result.value);

		// Scene 3: the finale ceremony
		const finaleRes = await send(ws, 'Runtime.evaluate', { expression: FINALE_OPEN, awaitPromise: true, returnByValue: true, timeout: 30000 });
		console.log('finale:', finaleRes.result.value);
		shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
		await writeFile(outFinale, Buffer.from(shot.data, 'base64'));
		console.log('wrote', outFinale);
		const closeRes = await send(ws, 'Runtime.evaluate', { expression: FINALE_CLOSE, awaitPromise: true, returnByValue: true, timeout: 30000 });
		console.log('close:', closeRes.result.value);

		// Scene 4: reboot to the title — the finished layer shows on the kicker
		console.log('boot(veteran):', await navigate(url + '?title=1&veteran=1'));
		const vetRes = await send(ws, 'Runtime.evaluate', { expression: VETERAN_CHECK, returnByValue: true });
		console.log('veteran:', vetRes.result.value);

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
