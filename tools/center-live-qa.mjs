#!/usr/bin/env node
// Live QA for the center Inner Self arc: boots the REAL game in headless Edge
// (CDP, real rAF), fast-forwards the hearts, walks the confession, verifies the
// reversed-damage mirror fight and the epilogue, and captures screenshots.
//
// Usage: node tools/center-live-qa.mjs [--url=http://127.0.0.1:8123/index.html] [--seed=4242]
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
const seed = opt('seed', '4242');

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

const QA_SCRIPT = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const out=[];
	const ok=(cond,label)=>{ out.push((cond?'PASS':'FAIL')+' '+label); return cond; };
	for(let i=0;i<400 && !(window.MM && MM.centerGuardian && MM.storyProgression && MM.tasks && window.player && window.__mmDebugHero);i++) await sleep(100);
	if(!(window.MM && MM.centerGuardian)) return 'boot-timeout';
	MM.fog && MM.fog.setRevealAll && MM.fog.setRevealAll(true);

	// Act 0: a fresh world must surface the mentor goal diegetically.
	await sleep(2500);
	const storyTasks=()=>MM.tasks.activeList().filter(t=>t.source==='story');
	ok(storyTasks().some(t=>t.id==='story:mentor' && /Stary Kwadrat/.test(t.title)), 'fresh start tracks the mentor goal');

	// Fast-forward the first four hearts (each normally earned in its own fight).
	for(const k of ['ice','fire','earth','air']) MM.progress.markGuardianHeart(k);
	window.inv.heartIce=1; window.inv.heartFire=1; window.inv.heartEarth=1; window.inv.heartAir=1;
	await sleep(2600);
	const cg=MM.centerGuardian;
	ok(cg.status().phase==='calling', 'heart of air wakes the center (phase '+cg.status().phase+')');
	ok(MM.storyLoreStage()==='mother_self', 'whispers turn toward the center before the finale');
	await sleep(1800);
	ok(storyTasks().some(t=>t.id==='story:center'), 'the center becomes the tracked goal');

	// Walk to the obelisk and hear the whole confession through the real click API.
	const L=cg.layoutFor();
	window.__mmDebugHero(L.obeliskX+1, L.floorY-2);
	await sleep(900);
	const lines=(MM.storyLore.center.reveal||[]).length;
	let advanced=0;
	for(let i=0;i<lines;i++){
		if(cg.interactAt(Math.floor(L.obeliskX), L.floorY-3, window.player)) advanced++;
		await sleep(120);
	}
	ok(advanced===lines, 'the confession advances line by line ('+advanced+'/'+lines+')');
	await sleep(2400);
	ok(cg.status().phase==='battle', 'the confession ends in the mirror rising');
	const mentor=MM.npcs && MM.npcs.mentor;
	ok(!!(mentor && mentor.hidden && mentor.hidden()), 'the mentor dissolves into the mimic');

	// Reversed damage: the hero's blow must come back.
	const dbg=cg._debug();
	const hpBefore=window.player.hp;
	const mimicBefore=dbg.mimic.hp;
	cg.damageAt(Math.floor(dbg.mimic.x), Math.floor(dbg.mimic.y), 15, {kind:'arrow',source:'hero'});
	await sleep(700);
	ok(dbg.mimic.hp===mimicBefore, 'the mirror ignores the hero\\'s damage');
	ok(window.player.hp<=hpBefore-14, 'the blow returns to the hero ('+hpBefore+' -> '+window.player.hp+')');

	// Natural strikes: stand still, take three blows, watch the mimic drain itself.
	window.player.hp=window.player.maxHp;
	window.__mmDebugHero(dbg.mimic.x+0.9, dbg.mimic.y);
	const drainStart=dbg.mimic.hp;
	let struck=0;
	for(let i=0;i<240 && struck<3;i++){
		window.__mmDebugHero(dbg.mimic.x+0.9, dbg.mimic.y);
		if(window.player.hp<window.player.maxHp){ struck++; window.player.hp=window.player.maxHp; }
		await sleep(150);
	}
	ok(struck>=3, 'the mimic strikes a standing hero ('+struck+' strikes)');
	ok(dbg.mimic.hp<drainStart, 'every strike drains the mirror ('+drainStart.toFixed(0)+' -> '+dbg.mimic.hp.toFixed(0)+')');

	// The mutual fall (pre-drain the mirror so QA doesn't wait out the full ritual).
	dbg.mimic.hp=Math.min(dbg.mimic.hp, dbg.strikeDamage()*2-1);
	let fell=false;
	for(let i=0;i<300 && !fell;i++){
		if(cg.status().phase==='fallen'){ fell=true; break; }
		if(cg.status().phase==='battle'){ window.__mmDebugHero(dbg.mimic.x+0.9, dbg.mimic.y); }
		await sleep(200);
	}
	ok(fell, 'the killing blow is mutual and the mirror falls');
	await sleep(3200);
	ok((window.inv.heartMother||0)>=1, 'the mother heart is awarded');
	ok(MM.storyLoreStage()==='epilogue', 'the whisper pool closes into the epilogue');
	ok(window.player.hp>0, 'the hero stands again after the shared fall');
	ok(!!(mentor && mentor.hidden && !mentor.hidden()), 'the freed mentor returns');
	await sleep(1500);
	// The arc's own goals must be gone; the mentor's personal thread may resume
	// (this QA run skipped the tutorial, and his lessons remain completable).
	ok(storyTasks().every(t=>t.id==='story:mentor'), 'no dangling arc goals after completion');
	ok(cg.interactAt(Math.floor(L.obeliskX), L.floorY-3, window.player)===true, 'the epilogue conversation answers at the obelisk');
	ok(!(window.__mmLoopErrors>0), 'no game-loop errors during the whole arc ('+(window.__mmLoopErrors||0)+')');
	return out.join('\\n');
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-centerqa-'));
	const proc = spawn(edge, [
		'--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
		'--force-device-scale-factor=1',
		'--remote-debugging-port=0',
		`--user-data-dir=${profile}`,
		'--window-size=1600,900',
		'about:blank'
	], { stdio: 'ignore' });
	let ws;
	let failures = 1;
	try {
		let target = null;
		for (let i = 0; i < 60 && !target; i++){
			await sleep(250);
			try {
				const portLine = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0].trim();
				if (!portLine) continue;
				const res = await fetch(`http://127.0.0.1:${portLine}/json/list`);
				const list = await res.json();
				target = list.find(t => t.type === 'page');
			} catch (e) { /* not up yet */ }
		}
		if (!target) throw new Error('DevTools endpoint never came up');
		ws = new WebSocket(target.webSocketDebuggerUrl);
		await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
		const pageErrors = [];
		const events = [];
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
		await send(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: `
			const __origGEBI=Document.prototype.getElementById;
			Document.prototype.getElementById=function(id){
				const el=__origGEBI.call(this,id);
				if(id==='seedInput' && el && el.value==='auto') el.value=${JSON.stringify(seed)};
				return el;
			};` });
		await send(ws, 'Page.navigate', { url });
		for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await sleep(250);
		await sleep(1500);
		const evalRes = await send(ws, 'Runtime.evaluate', { expression: QA_SCRIPT, awaitPromise: true, returnByValue: true, timeout: 300000 });
		const report = evalRes && evalRes.result ? String(evalRes.result.value) : '(no result)';
		console.log(report);
		failures = (report.match(/^FAIL /gm) || []).length + (report.includes('boot-timeout') ? 1 : 0);
		const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
		await writeFile('tools/center-live-qa.png', Buffer.from(shot.data, 'base64'));
		console.log('wrote tools/center-live-qa.png');
		if (pageErrors.length){
			console.log('pageErrors:', pageErrors.slice(0, 6).join('\n---\n'));
			failures += pageErrors.length;
		}
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
	}
	process.exit(failures ? 1 : 0);
}
main().catch(err => { console.error(err); process.exit(1); });
