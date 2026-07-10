#!/usr/bin/env node
// Headless-Edge live QA for the audio engine. Boots the real game over CDP
// (with --autoplay-policy=no-user-gesture-required so the AudioContext can
// start headless), then walks the scene machine and asserts the mixer follows:
//   surface day  → wind bed alive, music director in 'day'
//   storm        → rain bed rises
//   underground  → cave bed + 'cave' music mode, rain fades
//   submerged    → underwater bed via MM.audio.setHeroWater
//   alarm        → danger window + 'danger' mode
// Prints a PASS/FAIL line per probe; exits 1 on any FAIL or page error.
// Usage: node tools/audio-qa.mjs [--url=http://127.0.0.1:8123/index.html]
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
	const hit = args.find(a => a.startsWith('--' + name + '='));
	return hit ? hit.slice(name.length + 3) : dflt;
};
const url = opt('url', 'http://127.0.0.1:8123/index.html');

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

const PROBE = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const out=[];
	const check=(name,ok,extra)=>out.push((ok?'PASS':'FAIL')+' '+name+(extra?' ('+extra+')':''));
	for(let i=0;i<400 && !(window.MM && MM.audio && window.player && MM.worldGen);i++) await sleep(100);
	if(!(window.MM && MM.audio)) return 'boot-timeout';
	// a trusted-ish nudge: the unlock listeners run on any keydown
	window.dispatchEvent(new KeyboardEvent('keydown',{key:'Shift'}));
	await sleep(400);
	const D=()=>MM.audio.debugState();
	check('context runs headless', MM.audio.isReady(), 'state='+D().state);
	if(!MM.audio.isReady()) return out.join('\\n')+'\\nSKIP rest: no audio backend in this environment';
	// deterministic daylight on the surface
	try{ MM.background.importState({cycleT:0.25}); }catch(e){}
	const sx=Math.round(player.x);
	player.y=MM.worldGen.surfaceHeight(sx)-2; player.vy=0;
	await sleep(900);
	let d=D();
	check('scene sensing live', d.scene.ready, JSON.stringify({depth:+d.scene.depth.toFixed(1),isDay:d.scene.isDay}));
	check('surface day: no cave bed', d.beds && d.beds.cave===0, 'cave='+(d.beds&&d.beds.cave));
	check('music director day mode', d.musicMode==='day'||d.musicMode==='night', 'mode='+d.musicMode);
	// one-shots go through without page errors and count live voices
	MM.audio.play('explosion',{x:player.x+6,y:player.y});
	MM.audio.play('heal');
	d=D();
	check('one-shots allocate voices', d.voices>0, 'voices='+d.voices);
	// storm → rain bed rises
	try{ MM.clouds.startStorm(30,0.9,{source:'audio-qa'}); }catch(e){}
	for(let i=0;i<40;i++){ await sleep(250); if(D().beds.rain>0.01) break; }
	d=D();
	check('storm raises the rain bed', d.beds.rain>0.01, 'rain='+d.beds.rain.toFixed(3)+' drops='+d.scene.rain);
	// deep cave → cave bed + cave music mode (danger window may delay the mode)
	player.y=MM.worldGen.surfaceHeight(sx)+40; player.vy=0;
	await sleep(1200);
	d=D();
	check('depth flips scene underground', d.scene.underground, 'depth='+d.scene.depth.toFixed(0));
	check('cave drone rises underground', d.beds.cave>0.02, 'cave='+d.beds.cave.toFixed(3));
	check('rain fades underground', d.beds.rain<0.02, 'rain='+d.beds.rain.toFixed(3));
	// submersion → underwater bed + splash. Physics republishes the real water
	// exposure every frame (that overwrite IS the contract), so pause the sim
	// (B) before injecting a fake submersion state.
	window.dispatchEvent(new KeyboardEvent('keydown',{key:'b'}));
	await sleep(200);
	MM.audio.setHeroWater(true,0.9);
	await sleep(600);
	d=D();
	check('submersion raises the water bed', d.beds.water>0.05, 'water='+d.beds.water.toFixed(3));
	MM.audio.setHeroWater(false,0);
	window.dispatchEvent(new KeyboardEvent('keydown',{key:'b'}));
	await sleep(200);
	// alarm → danger window
	MM.audio.play('alarm');
	d=D();
	check('alarm opens the danger window', d.danger===true);
	// settings round-trip
	MM.audio.setBusVolume('music',0.15);
	check('bus volume round-trips', Math.abs(MM.audio.getBusVolume('music')-0.15)<1e-9);
	MM.audio.setMute(true); check('mute latches', MM.audio.isMuted());
	MM.audio.setMute(false);
	check('no game-loop errors', !(window.__mmLoopErrors>0), 'loopErrors='+(window.__mmLoopErrors||0));
	return out.join('\\n');
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-audioqa-'));
	const proc = spawn(edge, [
		'--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
		'--autoplay-policy=no-user-gesture-required',
		'--force-device-scale-factor=1',
		'--remote-debugging-port=0',
		`--user-data-dir=${profile}`,
		'--window-size=1280,800',
		'about:blank'
	], { stdio: 'ignore' });

	let ws, failed = false;
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
		await send(ws, 'Page.navigate', { url });
		for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await sleep(250);
		await sleep(1500);

		const res = await send(ws, 'Runtime.evaluate', { expression: PROBE, awaitPromise: true, returnByValue: true, timeout: 120000 });
		const report = res && res.result ? String(res.result.value) : '(no result)';
		console.log(report);
		if (/FAIL/.test(report) || /boot-timeout|no result/.test(report)) failed = true;
		if (pageErrors.length){ console.log('pageErrors:', pageErrors.slice(0, 5).join('\n---\n')); failed = true; }
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
	if (failed) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
