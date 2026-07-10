#!/usr/bin/env node
// Full-story-arc live QA: plays the COMPLETE game skeleton in headless Edge —
// tutorial handoff → the two horizons → the underground gate → the tower of
// ambition → the center call → the mirror victory → the finale ceremony —
// asserting at every act that story_progression retargets the task tracker,
// the world reacts (gate enabled, sky arena raised, center phase advancing)
// and the run ends in the auto-opened KONIEC WARSTWY report with all five
// guardians checked. The closing screenshot (tools/story-arc-qa.png) is the
// completed-game money shot.
// Usage: node tools/story-arc-qa.mjs [--url=http://127.0.0.1:8123/index.html] [--size=1600x900]
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
const out = opt('out', 'tools/story-arc-qa.png');

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

const ARC = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const out=[];
	const ok=(cond,label)=>{ out.push((cond?'PASS':'FAIL')+' '+label); return cond; };
	for(let i=0;i<400 && !(window.MM && window.player && MM.storyProgression && MM.progress && MM.centerGuardian && MM.finale && MM.tasks);i++) await sleep(100);
	if(!(window.MM && MM.storyProgression)) return 'boot-timeout';
	try{ MM.background.importState({cycleT:0.25}); }catch(e){}
	const taskIds=()=>{ try{ return MM.tasks.activeList().map(t=>t.id); }catch(e){ return []; } };
	const waitFor=async(cond,ms)=>{ for(let i=0;i<ms/200;i++){ if(cond()) return true; await sleep(200); } return cond(); };

	// Act 0: the mentor holds the only story task on a fresh boot.
	await waitFor(()=>taskIds().includes('story:mentor'), 5000);
	ok(taskIds().includes('story:mentor'), 'fresh boot: Stary Kwadrat owns the tracker');

	// Tutorial handoff: a completed mentor swings the tracker to the horizons.
	MM.tutorialNpc.restore({v:4, phase:'done', streamRewarded:true, streamChoice:null});
	await waitFor(()=>taskIds().includes('story:west') && taskIds().includes('story:east'), 6000);
	ok(taskIds().includes('story:west') && taskIds().includes('story:east'), 'mentor done: both horizons open');

	// Act I+II: the hearts of ice and fire retire their horizons and open the gate.
	MM.progress.markGuardianHeart('ice');
	await waitFor(()=>!taskIds().includes('story:west'), 5000);
	ok(!taskIds().includes('story:west') && taskIds().includes('story:east'), 'heart of ice retires the west');
	MM.progress.markGuardianHeart('fire');
	await waitFor(()=>taskIds().includes('story:gate'), 6000);
	ok(taskIds().includes('story:gate'), 'both horizons fallen: the passage down opens');
	let gate=null; try{ gate=MM.guardianLairs.status().underground; }catch(e){}
	ok(!!(gate && (gate.enabled || Number.isFinite(Number(gate.mouthX)) || Number.isFinite(Number(gate.x)))), 'the underground gate exists in the world');

	// Act III: the Third Mole falls and the tower of ambition rises.
	MM.progress.markGuardianHeart('earth');
	await waitFor(()=>taskIds().includes('story:sky'), 6000);
	ok(taskIds().includes('story:sky'), 'heart of earth: the sky gate is the goal');
	let sky=null; try{ sky=MM.skyGuardian.layoutFor(); }catch(e){}
	ok(!!(sky && Number.isFinite(Number(sky.ax))), 'the sky arena has a place in the world');

	// Act IV: the heart of air — the false final — wakes the center.
	MM.progress.markGuardianHeart('air');
	const naturalCall=await waitFor(()=>{ try{ return MM.centerGuardian.status().phase!=='dormant'; }catch(e){ return false; } }, 15000);
	if(!naturalCall) MM.centerGuardian.forceCall();
	ok(MM.centerGuardian.status().phase!=='dormant', 'the center leaves dormancy ('+(naturalCall?'on its own':'forced')+')');
	await waitFor(()=>taskIds().includes('story:center'), 8000);
	ok(taskIds().includes('story:center'), 'one direction remains: the center');

	// Act V: the mirror battle and the mutual blow.
	MM.centerGuardian.forceBattle();
	await sleep(600);
	ok(MM.centerGuardian.status().phase==='battle', 'the last mirror stands');
	MM.centerGuardian._debug().concludeVictory({heroFell:false});
	await sleep(3000); // progress ticks: mother heart -> story_complete milestone
	ok(MM.centerGuardian.completed(), 'the mirror falls with the hero standing');
	ok(!!MM.progress.guardianHearts().mother, 'the mother heart is real');
	const ms=MM.progress.milestones().find(m=>m.id==='story_complete');
	ok(!!(ms && ms.done), 'story_complete milestone paid out');
	ok(MM.finale.unlocked(), 'the finale ceremony is unlocked');
	await waitFor(()=>!taskIds().some(id=>String(id).startsWith('story:')), 6000);
	ok(!taskIds().some(id=>String(id).startsWith('story:')), 'the tracker is finally quiet');
	return out.join('\\n');
})()`;

const CEREMONY = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const out=[];
	const ok=(cond,label)=>{ out.push((cond?'PASS':'FAIL')+' '+label); return cond; };
	// fast-forward the post-epilogue window instead of idling ~30 s of speech
	MM.finale.update(MM.finale.config.BANNER_DELAY+1);
	await sleep(300);
	ok(!!document.getElementById('finaleBanner') || MM.finale.isOpen(), 'the banner slips in under the epilogue');
	MM.finale.update(MM.finale.config.AUTO_OPEN_DELAY+1);
	await sleep(800);
	const el=document.getElementById('finaleScreen');
	ok(MM.finale.isOpen() && !!el && el.classList.contains('show'), 'the report auto-opens once the speech is done');
	ok(el && el.querySelectorAll('.fnGuardian.done').length===5, 'all five guardians wear their checkmarks');
	ok(el && el.querySelectorAll('.fnStat').length===6, 'the run stats are on the card');
	return out.join('\\n');
})()`;

const AFTER = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const out=[];
	const ok=(cond,label)=>{ out.push((cond?'PASS':'FAIL')+' '+label); return cond; };
	window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
	await sleep(800);
	ok(!MM.finale.isOpen(), 'Escape returns the world');
	ok(MM.centerGuardian.status().phase==='fallen', 'the center stays fallen — the world is post-story');
	ok(!(window.__mmLoopErrors>0), 'zero loop errors across the whole arc');
	return out.join('\\n');
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-arcqa-'));
	const proc = spawn(edge, [
		'--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
		'--force-device-scale-factor=1',
		'--remote-debugging-port=0',
		`--user-data-dir=${profile}`,
		`--window-size=${winW},${winH}`,
		'about:blank'
	], { stdio: 'ignore' });

	let ws;
	let failed = false;
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

		const report = (label, res) => {
			const text = res && res.result ? String(res.result.value) : '(no result)';
			console.log('--- ' + label + ' ---');
			console.log(text);
			if (/\bFAIL\b/.test(text) || text.includes('boot-timeout')) failed = true;
		};
		report('arc', await send(ws, 'Runtime.evaluate', { expression: ARC, awaitPromise: true, returnByValue: true, timeout: 120000 }));
		report('ceremony', await send(ws, 'Runtime.evaluate', { expression: CEREMONY, awaitPromise: true, returnByValue: true, timeout: 60000 }));
		const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
		await writeFile(out, Buffer.from(shot.data, 'base64'));
		console.log('wrote', out);
		report('after', await send(ws, 'Runtime.evaluate', { expression: AFTER, awaitPromise: true, returnByValue: true, timeout: 30000 }));

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
