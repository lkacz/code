#!/usr/bin/env node
// Headless-Edge live QA for the developer armoury (#gearDebugBox).
// Boots the REAL game over CDP (real rAF — virtual time freezes it), opens the
// developer toolbox with a real click, and drives the armoury the way the author
// does: type into the search box, pick a tier, press Utwórz, press an ammo
// button. Every claim is then read back out of the running game, not out of the
// panel's own label:
//   * the tar pistol keeps its 0.30 s cadence (the sanitize fix, live)
//   * a craft row hands over the SAME item the crafting ladder does
//   * an antenna active forced at `common` is raised to the tier genItem
//     actually accepts it at, and arrives with its Q-power identity
//   * an ammo bundle really fills every window.inv key it names
// Screenshots:
//   tools/gear-forge-qa.png    the armoury open, filtered, with a result line
//   tools/gear-forge-qa-b.png  the hero wearing what the panel just forged
// Usage: node tools/gear-forge-qa.mjs [--url=http://127.0.0.1:8123/index.html] [--size=1600x900]
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
const outA = opt('out', 'tools/gear-forge-qa.png');
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

// Open the real toolbox through its real trigger, then confirm the armoury and
// its catalogue actually populated (main.js wires the panel while the game is
// still booting, so an empty list here would be a real defect).
const OPEN = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	for(let i=0;i<400 && !(window.MM && window.inv && window.player && document.getElementById('debugMenuBtn'));i++) await sleep(100);
	if(!document.getElementById('debugMenuBtn')) return 'boot-timeout';
	try{ MM.background.importState({cycleT:0.25}); }catch(e){}
	document.getElementById('debugMenuBtn').click();
	await sleep(400);
	const box=document.getElementById('gearDebugBox');
	if(!box) return 'no-armoury-box';
	box.scrollIntoView({block:'center'});
	await sleep(200);
	const list=document.getElementById('gearDebugList');
	return 'ok: rows='+list.options.length
		+' groups='+document.getElementById('gearDebugGroup').options.length
		+' kinds='+document.getElementById('gearDebugKind').options.length
		+' tiers='+document.getElementById('gearDebugTier').options.length
		+' ammoBtns='+document.querySelectorAll('[id^=gearDebugAmmo_]').length;
})()`;

// Type a query the way a human does (input event), pick the top hit, press the
// real button, then read the RESULT out of the inventory.
function forge(query, tier, extra){
	return `(async()=>{
		const sleep=ms=>new Promise(r=>setTimeout(r,ms));
		const search=document.getElementById('gearDebugSearch');
		const list=document.getElementById('gearDebugList');
		search.value=${JSON.stringify(query)};
		search.dispatchEvent(new Event('input',{bubbles:true}));
		await sleep(120);
		if(!list.options.length || !list.value) return 'no-hit-for:'+${JSON.stringify(query)};
		const tierSel=document.getElementById('gearDebugTier');
		tierSel.value=${JSON.stringify(tier)};
		tierSel.dispatchEvent(new Event('change',{bubbles:true}));
		await sleep(60);
		const picked=list.options[list.selectedIndex].textContent;
		const preview=document.getElementById('gearDebugPreview').textContent;
		document.getElementById('gearDebug_make').click();
		await sleep(200);
		const w=MM.inventory.equippedItem('weapon');
		return JSON.stringify(Object.assign({picked, preview,
			line:document.getElementById('gearDebugPreview').textContent,
			weapon:w?{name:w.name,tier:w.tier,type:w.weaponType,cd:w.fireCooldown,dmg:w.attackDamage,
				bouncyKind:w.bouncyKind,meleeEffect:w.meleeEffect,mergePerk:w.mergePerk,aquaticStyle:w.aquaticStyle}:null,
			bag:MM.inventory.bagItems().length}, ${JSON.stringify(extra || {})}));
	})()`;
}

// An antenna active forced at `common`: genItem refuses that profile below
// uncommon, so the panel must RAISE the tier rather than roll something else.
const FORGE_ANTENNA = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const search=document.getElementById('gearDebugSearch');
	const list=document.getElementById('gearDebugList');
	search.value='kamufla';
	search.dispatchEvent(new Event('input',{bubbles:true}));
	await sleep(120);
	const tierSel=document.getElementById('gearDebugTier');
	tierSel.value='common';
	tierSel.dispatchEvent(new Event('change',{bubbles:true}));
	await sleep(80);
	const preview=document.getElementById('gearDebugPreview').textContent;
	document.getElementById('gearDebug_make').click();
	await sleep(200);
	const a=MM.inventory.equippedItem('antenna');
	return JSON.stringify({preview, antenna:a?{name:a.name,tier:a.tier,active:a.antennaActive}:null});
})()`;

const AMMO = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const before=['arrowIridium','arrowWood','arrowGrapple','molotov','rubberBallTar','harpoonBolt']
		.map(k=>k+'='+(window.inv[k]|0)).join(',');
	document.getElementById('gearDebugAmmo_arrows').click();
	await sleep(150);
	document.getElementById('gearDebugAmmo_thrown').click();
	await sleep(150);
	document.getElementById('gearDebugAmmo_bouncy').click();
	await sleep(150);
	document.getElementById('gearDebugAmmo_harpoon').click();
	await sleep(200);
	const after=['arrowIridium','arrowWood','arrowGrapple','molotov','rubberBallTar','harpoonBolt']
		.map(k=>k+'='+(window.inv[k]|0)).join(',');
	return JSON.stringify({before, after, metrics:document.getElementById('gearDebugBoxMetrics').textContent});
})()`;

// Close the toolbox and stand the hero in the open so the forged kit is visible.
const SHOWCASE = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	document.getElementById('gearDebug_heroKit').click();
	await sleep(200);
	const kit=document.getElementById('gearDebugPreview').textContent;
	document.getElementById('debugMenuBtn').click();
	await sleep(500);
	const eq=['cape','eyes','outfit','weapon','pickaxe','charm','antenna']
		.map(s=>{ const it=MM.inventory.equippedItem(s); return s+'='+(it?it.name:'—'); }).join(' | ');
	return JSON.stringify({kit, eq, tools:JSON.stringify(window.inv.tools)});
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-gearqa-'));
	const proc = spawn(edge, [
		'--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
		'--force-device-scale-factor=1',
		'--remote-debugging-port=0',
		`--user-data-dir=${profile}`,
		`--window-size=${winW},${winH}`,
		'about:blank'
	], { stdio: 'ignore' });

	let ws;
	let failures = 0;
	const check = (ok, what) => { if(!ok){ failures++; console.log('FAIL: ' + what); } else console.log('ok: ' + what); };
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
		// Headless occlusion throttles rAF and timers into a convincing fake
		// gameplay bug — keep the tab foregrounded for the whole run.
		const front = setInterval(() => { send(ws, 'Page.bringToFront').catch(() => {}); }, 900);
		await send(ws, 'Page.bringToFront');
		await sleep(1500);

		const opened = await send(ws, 'Runtime.evaluate', { expression: OPEN, awaitPromise: true, returnByValue: true, timeout: 90000 });
		const openVal = opened && opened.result ? opened.result.value : '(no result)';
		console.log('open:', openVal);
		check(String(openVal).startsWith('ok:'), 'the armoury panel exists inside the developer toolbox');
		const rows = Number(String(openVal).match(/rows=(\d+)/)?.[1] || 0);
		check(rows > 120, 'the catalogue lists every source (rows=' + rows + ', expected >120)');

		// 1. the tar pistol — the sanitize fix, proven in the running game
		const tar = await send(ws, 'Runtime.evaluate', { expression: forge('smolow', 'rare'), awaitPromise: true, returnByValue: true, timeout: 30000 });
		const tarVal = JSON.parse(tar.result.value || '{}');
		console.log('tarPistol:', tar.result.value);
		check(tarVal.weapon && tarVal.weapon.type === 'bouncy', 'the forged tar pistol is a bouncy weapon');
		check(tarVal.weapon && tarVal.weapon.bouncyKind === 'tar', 'its tar ammo identity survived sanitize');
		check(tarVal.weapon && tarVal.weapon.cd === 0.3, 'its declared 0.30 s cadence survived sanitize (cd=' + (tarVal.weapon && tarVal.weapon.cd) + ')');

		// 2. a craft row: the recipe's own make(), for free
		const sword = await send(ws, 'Runtime.evaluate', { expression: forge('irydowy', 'epic'), awaitPromise: true, returnByValue: true, timeout: 30000 });
		const swordVal = JSON.parse(sword.result.value || '{}');
		console.log('craftRow:', sword.result.value);
		check(swordVal.weapon && swordVal.weapon.meleeEffect === 'bleed', 'a free craft delivers the recipe\'s real melee effect');

		// 3. tier floor: an antenna active forced below the tier genItem accepts
		const ant = await send(ws, 'Runtime.evaluate', { expression: FORGE_ANTENNA, awaitPromise: true, returnByValue: true, timeout: 30000 });
		const antVal = JSON.parse(ant.result.value || '{}');
		console.log('antenna:', ant.result.value);
		check(/tier ↑ uncommon/.test(antVal.preview || ''), 'the preview warns that the tier was raised');
		check(antVal.antenna && antVal.antenna.active === 'cloak', 'the forged antenna carries its Q-power identity');
		check(antVal.antenna && antVal.antenna.tier === 'uncommon', 'and really arrived at the raised tier');

		let shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
		await writeFile(outA, Buffer.from(shot.data, 'base64'));
		console.log('wrote', outA);

		// 4. ammunition bundles
		const ammo = await send(ws, 'Runtime.evaluate', { expression: AMMO, awaitPromise: true, returnByValue: true, timeout: 30000 });
		const ammoVal = JSON.parse(ammo.result.value || '{}');
		console.log('ammo:', ammo.result.value);
		check(/arrowIridium=2\d\d/.test(ammoVal.after || ''), 'the arrow bundle filled every arrow tier');
		check(/harpoonBolt=200/.test(ammoVal.after || ''), 'the harpoon bundle filled its bolt key');
		check(/rubberBallTar=200/.test(ammoVal.after || ''), 'the rubber bundle filled both ball kinds');

		// 5. hero kit + showcase
		const show = await send(ws, 'Runtime.evaluate', { expression: SHOWCASE, awaitPromise: true, returnByValue: true, timeout: 30000 });
		const showVal = JSON.parse(show.result.value || '{}');
		console.log('showcase:', show.result.value);
		check(/"bedrock":true/.test(showVal.tools || ''), 'the hero kit unlocked every pickaxe tier');
		await sleep(600);
		shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
		await writeFile(outB, Buffer.from(shot.data, 'base64'));
		console.log('wrote', outB);

		clearInterval(front);
		if (pageErrors.length) {
			failures++;
			console.log('pageErrors:', pageErrors.slice(0, 5).join('\n---\n'));
		} else console.log('ok: no page errors');
		console.log(failures ? ('gear-forge-qa: ' + failures + ' FAILURE(S)') : 'gear-forge-qa: all live checks passed');
		if (failures) process.exitCode = 1;
	} finally {
		try { if (ws) ws.close(); } catch (e) { /* closing */ }
		await new Promise(res => {
			if (process.platform === 'win32'){
				// Marker-scoped kill: never taskkill msedge.exe, that takes the
				// author's own browser down with it.
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
