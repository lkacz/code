#!/usr/bin/env node
// Headless-Edge live QA for the vitals HUD (engine/vitals_hud.js): boots the
// real game over CDP (real rAF — virtual time freezes it), drives the hero
// through the states the panel must sell and captures close-up screenshots:
//   tools/vitals-hud-qa.png    baseline: healthy panel, mid energy, XP row
//   tools/vitals-hud-qa-b.png  combat: damage chip ghost + floating -number
//   tools/vitals-hud-qa-c.png  low-HP heartbeat + buffs + level-up + pkt pill
//   tools/vitals-hud-qa-d.png  full energy glow, calm panel
// Usage: node tools/vitals-hud-qa.mjs [--url=http://127.0.0.1:8123/index.html] [--size=1600x900]
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
const outA = opt('out', 'tools/vitals-hud-qa.png');
const outB = outA.replace(/\.png$/, '-b.png');
const outC = outA.replace(/\.png$/, '-c.png');
const outD = outA.replace(/\.png$/, '-d.png');
// Close-up on the bottom-left panel + the floating buff/pill row above it
const CLIP = { x: 0, y: winH - 270, width: 460, height: 270, scale: 2 };

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
	const vs=()=>{ const s=MM.vitalsHud.model.state;
		return 'hp='+s.hp.fill.toFixed(2)+'/chip '+s.hp.chip.toFixed(2)+(s.hp.low?'/LOW':'')
			+' en='+s.en.fill.toFixed(2)+'/chip '+s.en.chip.toFixed(2)+(s.en.charging?'/CHG':'')+(s.en.full?'/FULL':'')
			+' xp='+s.xp.fill.toFixed(2)+'/burst '+s.xp.lvlBurst.toFixed(2)
			+' deltas='+s.deltas.length+' buffs='+s.buffs.length; };
`;

const STAGE_A = `(async()=>{ ${HELPERS}
	for(let i=0;i<400 && !(window.MM && window.player && MM.vitalsHud && MM.progress);i++) await sleep(100);
	if(!window.player) return 'boot-timeout';
	try{ MM.background.importState({cycleT:0.25}); }catch(e){}
	player.hp=player.maxHp;
	player.energy=(player.maxEnergy||60)*0.42;
	player.xp=Math.max(player.xp,420); // some level + partial XP bar
	await sleep(600);
	return ['A ok',vs()].join(' :: ');
})()`;

const STAGE_B = `(async()=>{ ${HELPERS}
	player.hp=Math.round(player.maxHp*0.42);
	player.energy=(player.energy||0)*0.25;
	await sleep(230); // inside the chip hold window: ghost + floating number visible
	return ['B ok',vs()].join(' :: ');
})()`;

const STAGE_C = `(async()=>{ ${HELPERS}
	player.hp=Math.max(3,Math.round(player.maxHp*0.13));
	MM.progress.addBuff({name:'Tarcza',icon:'🛡️',dur:45,stats:{armorBonus:2}});
	MM.progress.addBuff({name:'Moc',icon:'⚔️',dur:8,stats:{damageBonus:2}});
	const lv=MM.progress.level();
	player.xp+= (lv.need-lv.into)+5; // ding: badge burst + a fresh skill point pill
	await sleep(330); // mid-burst, heartbeat glowing
	return ['C ok',vs(),'pts='+MM.progress.points()].join(' :: ');
})()`;

const STAGE_D = `(async()=>{ ${HELPERS}
	player.hp=player.maxHp;
	player.energy=player.maxEnergy||MM.heroEnergy.capacity();
	await sleep(1400); // chips drained, burst over → calm panel with full-EN glow
	return ['D ok',vs()].join(' :: ');
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-vitalsqa-'));
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
