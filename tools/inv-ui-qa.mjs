#!/usr/bin/env node
// Headless-Edge live QA for the Ekwipunek overlay (inventory_ui.js): boots the
// real game over CDP, seeds a spread of loot (tiers, NEW items, weapons across
// categories), opens the panel and captures the states that matter:
//   tools/inv-ui-qa.png    default tab (capes) + equipment rail + preview
//   tools/inv-ui-qa-b.png  weapons tab: category sections, NEW/upgrade badges
//   tools/inv-ui-qa-c.png  charms + NEW review banner + skill points to spend
//   tools/inv-ui-qa-d.png  resources tab
// Usage: node tools/inv-ui-qa.mjs [--url=http://127.0.0.1:8123/index.html] [--size=1600x900]
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
const outA = opt('out', 'tools/inv-ui-qa.png');
const outB = outA.replace(/\.png$/, '-b.png');
const outC = outA.replace(/\.png$/, '-c.png');
const outD = outA.replace(/\.png$/, '-d.png');
const CLIP = { x: (winW - 1060) / 2, y: 30, width: 1060, height: 840, scale: 1.15 };

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
	const INV=MM.inventory;
	const clickTab=label=>{ const b=[...document.querySelectorAll('.invTabBtn')].find(x=>x.textContent.includes(label)); if(b) b.click(); return !!b; };
	const gridInfo=()=>{ const g=document.getElementById('invGrid');
		return 'cards='+g.querySelectorAll('.invItem').length
			+' heads='+g.querySelectorAll('.invCatHead').length
			+' new='+g.querySelectorAll('.invItem.new').length
			+' sel='+g.querySelectorAll('.invItem.sel').length; };
`;

const STAGE_A = `(async()=>{ ${HELPERS}
	for(let i=0;i<400 && !(window.MM && window.player && MM.inventoryUI && INV);i++) await sleep(100);
	if(!MM.inventoryUI) return 'boot-timeout';
	try{ MM.background.importState({cycleT:0.25}); }catch(e){}
	// seed loot: weapons across categories + charms, mixed tiers, some left NEW
	INV.grantItem({id:'qa_sw1', kind:'weapon', name:'Miecz strażnika', tier:'rare', weaponType:'melee', attackDamage:9}, {markNew:false});
	INV.grantItem({id:'qa_sw2', kind:'weapon', name:'Ostrze świtu', tier:'epic', weaponType:'melee', attackDamage:13}, {markNew:true});
	INV.grantItem({id:'qa_bow1', kind:'weapon', name:'Łuk zwiadowcy', tier:'common', weaponType:'bow', attackDamage:4, fireCooldown:0.45}, {markNew:false});
	INV.grantItem({id:'qa_bow2', kind:'weapon', name:'Łuk burzowy', tier:'rare', weaponType:'bow', attackDamage:6, fireCooldown:0.34}, {markNew:true});
	INV.grantItem({id:'qa_fl1', kind:'weapon', name:'Miotacz żaru', tier:'rare', weaponType:'flame', fireDps:9, fireRange:7, moveSpeedMult:0.95}, {markNew:false});
	INV.grantItem({id:'qa_ch1', kind:'charm', name:'Amulet głębin', tier:'rare', visionRadius:13, moveSpeedMult:1.05}, {markNew:false});
	INV.grantItem({id:'qa_ch2', kind:'charm', name:'Serce gór', tier:'epic', airJumps:1, jumpPowerMult:1.1}, {markNew:true});
	INV.grantItem({id:'qa_ch3', kind:'charm', name:'Zębaty pierścień', tier:'common', mineSpeedMult:1.15}, {markNew:true});
	INV.equip('qa_sw1');
	player.xp=Math.max(player.xp,420); // a few levels → skill points to spend
	MM.inventoryUI.open();
	await sleep(400);
	return ['A ok','tab=peleryny',gridInfo()].join(' :: ');
})()`;

const STAGE_B = `(async()=>{ ${HELPERS}
	clickTab('Bronie');
	await sleep(250);
	return ['B ok',gridInfo()].join(' :: ');
})()`;

const STAGE_C = `(async()=>{ ${HELPERS}
	clickTab('Talizmany');
	await sleep(250);
	const review=document.getElementById('invNewReview');
	return ['C ok',gridInfo(),'review='+(review && review.style.display!=='none'? review.textContent.trim().slice(0,60):'off')].join(' :: ');
})()`;

const STAGE_D = `(async()=>{ ${HELPERS}
	clickTab('Surowce');
	await sleep(250);
	const cards=document.querySelectorAll('#invGrid .invResCard').length;
	const zero=document.querySelectorAll('#invGrid .invResCard.zero').length;
	return ['D ok','resCards='+cards,'zero='+zero].join(' :: ');
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-invqa-'));
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
