#!/usr/bin/env node
// Headless-Edge live QA for key rebinding + the new pause-panel rows
// (music on/off, fullscreen, keybind editor — main.js + engine/keybinds.js):
//   tools/keybinds-qa.png    pause panel with the music/fullscreen/keybind rows
//   tools/keybinds-qa-b.png  keybind editor open, grouped action list
//   tools/keybinds-qa-c.png  after a live rebind + conflict swap (Q/T traded)
// Usage: node tools/keybinds-qa.mjs [--url=http://127.0.0.1:8123/index.html]
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
	const hit = args.find(a => a.startsWith('--' + name + '='));
	return hit ? hit.slice(name.length + 3) : dflt;
};
const url = opt('url', 'http://127.0.0.1:8123/index.html');
const [winW, winH] = opt('size', '1600x900').split('x').map(Number);
const outA = opt('out', 'tools/keybinds-qa.png');
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

// Dispatch on document.body, NOT window: real keydowns target the focused
// element, so window-capture traps run in the capture phase before the game's
// bubble listeners. Events dispatched directly at window flatten that ordering
// (at-target listeners run in registration order) and misrepresent reality.
const HELPERS = `const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const key=(k,type)=>document.body.dispatchEvent(new KeyboardEvent(type||'keydown',{key:k,bubbles:true}));
	const tap=k=>{ key(k,'keydown'); key(k,'keyup'); };`;

const STAGE_A = `(async()=>{ ${HELPERS}
	for(let i=0;i<400 && !(window.MM && window.player && MM.keybinds && MM.audio);i++) await sleep(100);
	if(!window.player) return 'boot-timeout';
	tap('b'); // open the pause panel through the real key path
	await sleep(400);
	const panel=document.getElementById('pausePanel');
	if(!panel || panel.hidden) return 'pause-panel-missing';
	const labels=[...panel.querySelectorAll('.pauseRow span')].map(s=>s.textContent);
	const hasMusic=labels.some(t=>t.includes('Muzyka włączona'));
	const hasFs=!!panel.querySelector('.pauseFullscreenBtn');
	const hasKb=labels.some(t=>t.includes('Klawisze sterowania'));
	// music switch drives the audio engine + persists
	const musicChk=[...panel.querySelectorAll('.pauseRow')].find(r=>r.firstChild.textContent.includes('Muzyka włączona')).querySelector('input');
	musicChk.click(); await sleep(80);
	const offOk=MM.audio.isMusicOn()===false && JSON.parse(localStorage.getItem('mm_audio_v1')).musicOn===false;
	musicChk.click(); await sleep(80);
	const onOk=MM.audio.isMusicOn()===true;
	return ['A ok','rows music/fs/kb='+[hasMusic,hasFs,hasKb].join('/'),'musicSwitch off/on='+offOk+'/'+onOk].join(' :: ');
})()`;

const STAGE_B = `(async()=>{ ${HELPERS}
	const panel=document.getElementById('pausePanel');
	const kbBtn=[...panel.querySelectorAll('.pauseRow')].find(r=>r.firstChild.textContent.includes('Klawisze sterowania')).querySelector('button');
	kbBtn.click(); await sleep(300);
	const kp=document.getElementById('keybindPanel');
	if(!kp || kp.hidden) return 'keybind-panel-missing';
	const groups=[...kp.querySelectorAll('.kbGroup')].map(g=>g.textContent);
	const rows=kp.querySelectorAll('.kbRow').length;
	const interactBtn=kp.querySelector('button.kbKey[data-action=interact]');
	return ['B ok','groups='+groups.join(','),'rows='+rows,'interactKey='+(interactBtn&&interactBtn.textContent)].join(' :: ');
})()`;

const STAGE_C = `(async()=>{ ${HELPERS}
	const kp=document.getElementById('keybindPanel');
	// live rebind through the real capture path: interact -> Q
	kp.querySelector('button.kbKey[data-action=interact]').click(); await sleep(120);
	key('q','keydown'); await sleep(120);
	const step1= MM.keybinds.keyFor('interact')==='q' && MM.keybinds.translate('q')==='e' && MM.keybinds.translate('e')==='§e';
	// conflict: craft -> Q must SWAP (craft takes q, interact takes craft's t)
	kp.querySelector('button.kbKey[data-action=craft]').click(); await sleep(120);
	key('q','keydown'); await sleep(120);
	const step2= MM.keybinds.keyFor('craft')==='q' && MM.keybinds.keyFor('interact')==='t';
	const note=kp.querySelector('.kbNote').textContent;
	const persisted=JSON.parse(localStorage.getItem('mm_keybinds_v1'));
	// while the panel traps keys, game shortcuts must stay dead: G would toggle
	// god mode if the trap leaked (observed through the window.msg seam)
	let leaked=''; const oldMsg=window.msg; window.msg=t=>{ leaked+=String(t)+'|'; };
	key('g','keydown'); key('g','keyup'); await sleep(120);
	window.msg=oldMsg;
	const godLeak=leaked.length>0;
	// reset restores defaults + storage
	[...kp.querySelectorAll('.kbFoot button')][0].click(); await sleep(120);
	const resetOk= MM.keybinds.keyFor('interact')==='e' && MM.keybinds.keyFor('craft')==='t';
	// leave via Esc: panel closes, pause stays; then a re-rebind for the shot
	key('Escape','keydown'); await sleep(150);
	const escOk= kp.hidden && !document.getElementById('pausePanel').hidden;
	kp.hidden=false; // re-show for the screenshot with the swap applied
	MM.keybinds.setBinding('interact','q'); MM.keybinds.setBinding('craft','q');
	const refresh=kp.querySelectorAll('button.kbKey'); refresh.forEach(b=>{ b.textContent=MM.keybinds.displayKey(MM.keybinds.keyFor(b.dataset.action)); });
	return ['C ok','rebind='+step1,'swap='+step2,'note='+JSON.stringify(note).slice(0,80),'persist='+JSON.stringify(persisted),'godLeak='+godLeak,'reset='+resetOk,'esc='+escOk].join(' :: ');
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-kbqa-'));
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
		try { proc.kill(); } catch (e) { /* already gone */ }
		await sleep(400);
		try { await rm(profile, { recursive: true, force: true }); } catch (e) { /* profile busy */ }
	}
}
main().catch(err => { console.error(err); process.exit(1); });
