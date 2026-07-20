#!/usr/bin/env node
// Headless-Edge live QA for the crafting panel + HUD ingredient tracker.
// Boots the real game over CDP (real rAF — virtual time freezes it), grants a
// spread of resources, exercises the new UX (favorites, tracked recipe, NEW
// badges, craft flash, drag&drop onto hotbar slots) through real DOM clicks
// and raw mouse input, and captures screenshots:
//   tools/craft-panel-qa.png    staged panel: favorites, NEW badges, tracker
//   tools/craft-panel-qa-b.png  right after crafting (flash + updated counts)
//   tools/craft-panel-qa-c.png  mid-drag: tile ghost + highlighted hotbar slot
// Usage: node tools/craft-panel-qa.mjs [--url=http://127.0.0.1:8123/index.html] [--size=1600x900]
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
const outA = opt('out', 'tools/craft-panel-qa.png');
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

const STAGE = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	for(let i=0;i<400 && !(window.MM && window.inv && window.updateInventoryHud && document.getElementById('craftList'));i++) await sleep(100);
	if(!document.getElementById('craftList')) return 'boot-timeout';
	// deterministic daylight, hide nothing — we QA the real UI
	try{ MM.background.importState({cycleT:0.25}); }catch(e){}
	const host=document.getElementById('craft');
	if(host && host.dataset.collapsed==='true') document.getElementById('craftToggle').click();
	// resource spread: some recipes fully affordable, some partial, some empty
	Object.assign(window.inv,{wood:24,stone:14,coal:6,sand:4,clay:3,diamond:2,obsidian:5,water:4,leaf:9,meteoricIron:3,copper:2,plastic:2});
	window.updateInventoryHud(); // syncs availability -> NEW badges + toast
	await sleep(200);
	const click=sel=>{ const el=document.querySelector(sel); if(el){ el.click(); return true; } return false; };
	// favorites: pin torches + teleporter (★ tab + Ulubione section appear)
	click('#craft_torches .craftFavStar');
	click('#craft_teleporter .craftFavStar');
	// track a far-off machine: HUD tracker shows missing chips + source hints
	click('#craft_teleporter');
	await sleep(80);
	const trackBtn=[...document.querySelectorAll('#craftDetail .craftTrackBtn')][0];
	if(trackBtn) trackBtn.click();
	await sleep(80);
	// leave a craftable recipe selected so the detail pane shows green bars
	click('#craft_obsidian_sword');
	await sleep(200);
	const tracker=document.getElementById('craftTracker');
	return 'ok:staged tracker='+(tracker && !tracker.hidden)
		+' rows='+document.querySelectorAll('.craftRecipe').length
		+' fresh='+document.querySelectorAll('.craftRecipe.fresh').length
		+' sections='+document.querySelectorAll('.craftListSection').length
		+' tabs='+document.querySelectorAll('.craftTab').length;
})()`;

const CRAFT_ONE = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const btn=document.querySelector('#craftDetail .craftPrimary');
	if(!btn || btn.disabled) return 'no-craft-button';
	btn.click();
	await sleep(120); // catch the flash mid-animation
	const counts=document.querySelector('#craftDetail .craftCrafted');
	return 'ok:crafted counted='+(counts?counts.textContent:'(none)')
		+' flash='+!!document.querySelector('#craftDetail.flash');
})()`;

// Drag scene: select a recipe with a PLACEABLE output (torches), read the
// screen centers of its detail drag tile and hotbar slot #7 (index 2), and
// report the slot's current assignment so the drop can prove a change.
const PREP_DRAG = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const row=document.getElementById('craft_torches');
	if(!row) return 'no-torches-row';
	row.click();
	await sleep(150);
	const chip=document.querySelector('#craftDetail .craftHotDrop .craftDragTile');
	const slot=document.querySelectorAll('#hotbarWrap .hotSlot')[2];
	if(!chip||!slot) return 'no-drag-chip';
	const a=chip.getBoundingClientRect(), b=slot.getBoundingClientRect();
	return JSON.stringify({fx:a.left+a.width/2, fy:a.top+a.height/2,
		tx:b.left+b.width/2, ty:b.top+b.height/2, before:MM.hotbar.order()[2]});
})()`;
const POST_DRAG = `JSON.stringify({slot:MM.hotbar.order()[2],
	dragging:!!(MM.craftDrag&&MM.craftDrag.dragging()),
	ghost:!!document.getElementById('craftDragGhost'),
	dropCss:!!document.querySelector('#hotbarWrap.hotDropActive')})`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-craftqa-'));
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

		const staged = await send(ws, 'Runtime.evaluate', { expression: STAGE, awaitPromise: true, returnByValue: true, timeout: 90000 });
		console.log('stage:', staged && staged.result ? staged.result.value : '(no result)');
		let shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
		await writeFile(outA, Buffer.from(shot.data, 'base64'));
		console.log('wrote', outA);

		const crafted = await send(ws, 'Runtime.evaluate', { expression: CRAFT_ONE, awaitPromise: true, returnByValue: true, timeout: 30000 });
		console.log('craft:', crafted && crafted.result ? crafted.result.value : '(no result)');
		shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
		await writeFile(outB, Buffer.from(shot.data, 'base64'));
		console.log('wrote', outB);

		// drag&drop: press on the detail drag tile, glide to hotbar slot #7,
		// screenshot mid-drag (ghost + slot highlight), release, verify remap
		const prep = await send(ws, 'Runtime.evaluate', { expression: PREP_DRAG, awaitPromise: true, returnByValue: true, timeout: 30000 });
		const prepVal = prep && prep.result ? prep.result.value : null;
		if (typeof prepVal === 'string' && prepVal.startsWith('{')){
			const p = JSON.parse(prepVal);
			const mouse = (type, x, y, extra) => send(ws, 'Input.dispatchMouseEvent',
				Object.assign({ type, x: Math.round(x), y: Math.round(y), button: 'left', buttons: 1 }, extra || {}));
			await mouse('mousePressed', p.fx, p.fy, { clickCount: 1 });
			const STEPS = 10;
			for (let i = 1; i <= STEPS; i++){
				await mouse('mouseMoved', p.fx + (p.tx - p.fx) * i / STEPS, p.fy + (p.ty - p.fy) * i / STEPS);
				await sleep(25);
			}
			await sleep(150);
			shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
			await writeFile(outC, Buffer.from(shot.data, 'base64'));
			console.log('wrote', outC, '(mid-drag)');
			const mid = await send(ws, 'Runtime.evaluate', { expression: POST_DRAG, returnByValue: true });
			console.log('dragMid:', mid && mid.result ? mid.result.value : '(no result)');
			await mouse('mouseReleased', p.tx, p.ty, { buttons: 0, clickCount: 1 });
			await sleep(250);
			const post = await send(ws, 'Runtime.evaluate', { expression: POST_DRAG, returnByValue: true });
			console.log('dragDrop:', post && post.result ? post.result.value : '(no result)', 'before=' + p.before);
		} else {
			console.log('dragPrep failed:', prepVal);
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
