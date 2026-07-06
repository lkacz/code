#!/usr/bin/env node
// Headless-Edge live QA for the informative weapon bar + hotbar HUD.
// Boots the real game over CDP (real rAF — virtual time freezes it), grants a
// spread of arrows/fuel/picks, exercises the new UX (arrow-tier pips + pinning,
// low/out ammo states, fuel/energy readouts, durability gauge, rich tooltips)
// through real DOM events and captures close-up screenshots:
//   tools/hud-bars-qa.png    bow active: tier dot+count, pips, ult gauge, tooltip
//   tools/hud-bars-qa-b.png  pinned wood arrows + flamethrower out of fuel
//   tools/hud-bars-qa-c.png  bedrock pick durability gauge + pick tooltip
// Usage: node tools/hud-bars-qa.mjs [--url=http://127.0.0.1:8123/index.html] [--size=1600x900]
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
const outA = opt('out', 'tools/hud-bars-qa.png');
const outB = outA.replace(/\.png$/, '-b.png');
const outC = outA.replace(/\.png$/, '-c.png');
// Close-up on the bottom-centre bars + the tooltip above them
const CLIP = { x: (winW - 1000) / 2, y: winH - 460, width: 1000, height: 450, scale: 1.6 };

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
	const wslot=k=>document.querySelector('#weaponBar .wepSlot[data-wkey="'+k+'"]');
	const hover=el=>el && el.dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}));
	const unhover=el=>el && el.dispatchEvent(new PointerEvent('pointerleave',{pointerType:'mouse'}));
	const slotState=k=>{ const el=wslot(k); if(!el) return 'missing';
		const g=el.querySelector('.wgauge');
		return [el.querySelector('.wname').textContent, 'sub='+el.querySelector('.wsub').textContent,
			'cyc='+el.querySelector('.wcyc').textContent,
			(el.classList.contains('sel')?'SEL':'')+(el.classList.contains('low')?'LOW':'')+(el.classList.contains('out')?'OUT':''),
			'gauge='+g.className.replace('wgauge','').trim()+':'+g.querySelector('i').style.width].join('|'); };
	const pipState=()=>[...document.querySelectorAll('#weaponBar .wpips .pip')]
		.map(p=>p.getAttribute('data-tier')+':'+p.className.replace('pip','').trim()).join(' ');
	const tipShown=()=>{ const t=document.getElementById('hudTip'); return !!(t && t.classList.contains('show')) && t.childElementCount; };
	const hotCounts=()=>[...document.querySelectorAll('#hotbarWrap .hotSlot')]
		.map(s=>s.querySelector('.lbl').textContent+'='+s.querySelector('.count').textContent
			+(s.querySelector('.count').className.replace('count','').trim()?'('+s.querySelector('.count').className.replace('count','').trim()+')':'')
			+(s.classList.contains('depleted')?'[dep]':'')).join(' ');
`;

const STAGE_A = `(async()=>{ ${HELPERS}
	for(let i=0;i<400 && !(window.MM && window.inv && window.updateInventoryHud && wslot('3'));i++) await sleep(100);
	if(!wslot('3')) return 'boot-timeout';
	try{ MM.background.importState({cycleT:0.25}); }catch(e){}
	Object.assign(window.inv,{arrowWood:320,arrowStone:41,arrowObsidian:0,arrowDiamond:12,arrowIridium:3,
		grass:1234,sand:7,stone:0,wood:64,leaf:55,water:103});
	MM.inventory.equip('bow_wood');
	window.updateInventoryHud();
	await sleep(250); // let the rAF gauge pass paint the ult bar
	hover(wslot('3'));
	await sleep(150);
	return ['A ok','s1='+slotState('1'),'s3='+slotState('3'),'pips='+pipState(),'tip='+tipShown(),'hot='+hotCounts()].join(' :: ');
})()`;

const STAGE_B = `(async()=>{ ${HELPERS}
	unhover(wslot('3'));
	const woodPip=document.querySelector('#weaponBar .wpips .pip[data-tier="wood"]');
	if(woodPip) woodPip.click(); // pin the cheap arrows
	MM.inventory.equip('flamethrower');
	window.inv.wood=0; // flamethrower fuel = wood → OUT state (hotbar wood slot goes red too)
	window.updateInventoryHud();
	await sleep(250);
	hover(wslot('4'));
	await sleep(150);
	return ['B ok','s3='+slotState('3'),'s4='+slotState('4'),'pips='+pipState(),'tip='+tipShown(),'hot='+hotCounts()].join(' :: ');
})()`;

const STAGE_C = `(async()=>{ ${HELPERS}
	unhover(wslot('4'));
	window.inv.tools.bedrock=true; window.inv.bedrockPickDurability=4;
	const press1=()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'1'}));
	for(let i=0;i<6 && wslot('1').querySelector('.wname').textContent!=='macierzysty';i++){ press1(); await sleep(60); }
	window.updateInventoryHud();
	await sleep(250);
	hover(wslot('1'));
	await sleep(150);
	return ['C ok','s1='+slotState('1'),'tip='+tipShown()].join(' :: ');
})()`;

const STAGE_D = `(async()=>{ ${HELPERS}
	unhover(wslot('1'));
	const hot=document.querySelectorAll('#hotbarWrap .hotSlot')[0];
	hover(hot); await sleep(120);
	const hotTip=tipShown();
	unhover(hot);
	hover(wslot('2')); await sleep(120);
	const meleeTip=tipShown();
	return ['D ok','hotTip='+hotTip,'meleeTip='+meleeTip,'s2='+slotState('2')].join(' :: ');
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-hudqa-'));
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

		for (const [label, expr, out] of [['A', STAGE_A, outA], ['B', STAGE_B, outB], ['C', STAGE_C, outC], ['D', STAGE_D, outA.replace(/\.png$/, '-d.png')]]){
			const r = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 90000 });
			console.log('stage ' + label + ':', r && r.result ? r.result.value : '(no result)');
			const shot = await send(ws, 'Page.captureScreenshot', { format: 'png', clip: CLIP });
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
