#!/usr/bin/env node
// Headless-Edge live QA for the hand-weapon material identities and improvised
// throws. Boots the REAL game over CDP, crafts "Topór kamienny" through the
// crafting panel DOM, swings it at a wolf (expect the stun status), then
// throws sand (expect blind) and spits water (expect wet/poison) at fresh
// wolves. Chance rolls are forced during the checks so the run is deterministic.
//   tools/melee-weapons-qa.png  final scene screenshot
// Usage: node tools/melee-weapons-qa.mjs [--url=http://127.0.0.1:8123/index.html]
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
const out = opt('out', 'tools/melee-weapons-qa.png');

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

const SCENARIO = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	for(let i=0;i<400 && !(window.MM && window.inv && window.player && MM.mobs && MM.weapons && document.getElementById('craftList'));i++) await sleep(100);
	if(!document.getElementById('craftList')) return 'boot-timeout';
	const log=[];
	try{ MM.background.importState({cycleT:0.25}); }catch(e){}
	Object.assign(window.inv,{wood:40,stone:40,sand:40,water:40});
	window.updateInventoryHud();
	await sleep(200);
	// --- craft the stone axe through the REAL panel DOM ---
	const host=document.getElementById('craft');
	if(host && host.dataset.collapsed==='true') document.getElementById('craftToggle').click();
	const row=document.getElementById('craft_axe_stone');
	if(!row) return 'no-axe-recipe-row';
	row.click(); await sleep(120);
	const btn=document.querySelector('#craftDetail .craftPrimary');
	if(!btn || btn.disabled) return 'axe-not-craftable';
	btn.click(); await sleep(250);
	const wep=MM.inventory.equippedItem('weapon');
	if(!wep || !/Top\\u00f3r kamienny|Topór kamienny/.test(wep.name)) return 'axe-not-equipped:'+(wep&&wep.name);
	log.push('axe: effect='+wep.meleeEffect+' dmg='+wep.attackDamage);
	if(wep.meleeEffect!=='stun') return 'axe-lost-identity';
	// --- a test wolf right next to the hero ---
	const p=window.player;
	function freshWolf(dx){
		MM.mobs.clearAll();
		MM.mobs.freezeSpawns(120000);
		MM.mobs.deserialize({v:4,list:[{id:'WOLF',x:p.x+dx,y:p.y,vx:0,vy:0,hp:30,state:'idle',facing:1,scale:1,speedMul:1,jumpMul:1}],aggro:{mode:'rel',m:{}}});
		MM.mobs.freezeSpawns(120000);
		return MM.mobs.nearestLiving(p.x+dx,p.y,6);
	}
	const realRandom=Math.random;
	// --- swing: stone identity stuns ---
	let wolf=freshWolf(1);
	if(!wolf) return 'no-wolf';
	Math.random=()=>0.05;
	let stunned=false;
	for(let i=0;i<8 && !stunned;i++){
		MM.weapons.fireHeld(p, wolf.x, wolf.y, 1/60);
		stunned=MM.mobs.hasStatus(wolf,'stun');
		await sleep(450);
	}
	Math.random=realRandom;
	log.push('stun='+stunned);
	if(!stunned) return 'no-stun|'+log.join(' ');
	// --- thrown sand blinds ---
	MM.inventory.equip('throw_sand');
	wolf=freshWolf(3);
	Math.random=()=>0.05;
	let blinded=false;
	for(let i=0;i<8 && !blinded;i++){
		MM.weapons.fireHeld(p, wolf.x, wolf.y-0.2, 1/60);
		await sleep(600);
		blinded=MM.mobs.hasStatus(wolf,'blind');
	}
	Math.random=realRandom;
	log.push('blind='+blinded);
	if(!blinded) return 'no-blind|'+log.join(' ');
	// --- water spit soaks / poisons ---
	MM.inventory.equip('throw_spit');
	wolf=freshWolf(3);
	Math.random=()=>0.05;
	let soaked=false;
	for(let i=0;i<8 && !soaked;i++){
		MM.weapons.fireHeld(p, wolf.x, wolf.y-0.2, 1/60);
		await sleep(600);
		soaked=MM.mobs.hasStatus(wolf,'wet')||MM.mobs.hasStatus(wolf,'poison');
	}
	Math.random=realRandom;
	log.push('spit='+soaked);
	if(!soaked) return 'no-spit|'+log.join(' ');
	return 'ok: '+log.join(' ');
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-meleeqa-'));
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
			}
		};

		await send(ws, 'Page.enable');
		await send(ws, 'Runtime.enable');
		await send(ws, 'Emulation.setDeviceMetricsOverride', { width: winW, height: winH, deviceScaleFactor: 1, mobile: false });
		await send(ws, 'Page.navigate', { url });
		for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await sleep(250);
		await sleep(1500);

		const res = await send(ws, 'Runtime.evaluate', { expression: SCENARIO, awaitPromise: true, returnByValue: true, timeout: 120000 });
		const verdict = res && res.result ? res.result.value : '(no result)';
		console.log('scenario:', verdict);
		const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
		await writeFile(out, Buffer.from(shot.data, 'base64'));
		console.log('wrote', out);
		if (pageErrors.length) console.log('pageErrors:', pageErrors.slice(0, 5).join('\n---\n'));
		if (!String(verdict).startsWith('ok:')) process.exitCode = 1;
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
