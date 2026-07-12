#!/usr/bin/env node
// Headless-Edge live QA for the loot/discovery wave:
//   A) fresh boot — craft panel gated (few recipes, "do odkrycia" counter),
//      hot picker shows only discovered blocks
//   B) material influx — "🔓 Odblokowany przepis" toast + NEW badges; the five
//      chest tiers placed in a row next to the hero (art check)
//   C) epic chest opened — loot bursts out as PHYSICAL drops (beams/halos)
//   D) pickup — upgrade notice card (#upgradeNotice) with Załóż/Później
// Screenshots: tools/loot-discovery-qa{-a,-b,-c,-d}.png
// Usage: node tools/loot-discovery-qa.mjs [--url=http://127.0.0.1:8123/index.html] [--size=1600x900]
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
const outBase = opt('out', 'tools/loot-discovery-qa').replace(/\.png$/, '');

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

// A: fresh world — gated craft panel + gated hot picker
const SCENE_A = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	for(let i=0;i<400 && !(window.MM && window.inv && window.updateInventoryHud && document.getElementById('craftList') && window.player);i++) await sleep(100);
	if(!document.getElementById('craftList')) return 'boot-timeout';
	try{ MM.background.importState({cycleT:0.25}); }catch(e){}
	const host=document.getElementById('craft');
	if(host && host.dataset.collapsed==='true') document.getElementById('craftToggle').click();
	await sleep(300);
	const rows=document.querySelectorAll('.craftRecipe').length;
	const summary=(document.getElementById('craftSummary')||{}).textContent||'';
	// hot picker: open the remap popover for slot 0 (click the already-selected slot)
	const slot=document.querySelector('.hotSlot'); if(slot){ slot.click(); await sleep(150); }
	const cards=document.querySelectorAll('#hotSelectMenu button[data-hot-card]').length;
	const chips=document.querySelectorAll('#hotSelectMenu button[data-hot-chip]').length;
	const tabs=document.querySelectorAll('.craftTab').length;
	return 'ok:A rows='+rows+' summary="'+summary+'" pickerCards='+cards+' pickerChips='+chips+' craftTabs='+tabs;
})()`;

// B: grant materials (unlock toast) + place the five chest tiers by the hero
const SCENE_B = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	// close the hot picker from scene A
	document.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
	await sleep(100);
	Object.assign(window.inv,{wood:24,stone:14,coal:6,sand:4,clay:3,diamond:2,obsidian:5,water:4,leaf:9});
	window.updateInventoryHud();
	await sleep(250);
	const toast=(document.getElementById('messages')||{}).textContent||'';
	const rows=document.querySelectorAll('.craftRecipe').length;
	const fresh=document.querySelectorAll('.craftRecipe.fresh').length;
	// five chest tiers in a row on SOLID ground next to the hero (skip ponds)
	const W=MM.world, T=MM.T;
	const solid=t=>{ const inf=MM.INFO[t]; return !!(inf && !inf.passable); };
	const tiles=[T.CHEST_COMMON,T.CHEST_UNCOMMON,T.CHEST_RARE,T.CHEST_EPIC,T.CHEST_LEGENDARY];
	const px=Math.floor(player.x);
	window.__qaChests=[];
	let x=px+3;
	while(window.__qaChests.length<5 && x<px+80){
		let y=Math.floor(player.y)-6;
		while(y<300 && W.getTile(x,y+1)===T.AIR) y++;
		if(solid(W.getTile(x,y+1)) && W.getTile(x,y)===T.AIR){
			const tile=tiles[window.__qaChests.length];
			W.setTile(x,y,tile);
			window.__qaChests.push([x,y,tile]);
			x+=2;
		} else x++;
	}
	// reveal fog + center camera
	try{ window.dispatchEvent(new KeyboardEvent('keydown',{key:'m'})); }catch(e){}
	try{ window.dispatchEvent(new KeyboardEvent('keydown',{key:'c'})); }catch(e){}
	await sleep(400);
	// categories discovered: craft tabs + journal entries + hot-picker chips grow
	const tabs=document.querySelectorAll('.craftTab').length;
	const cats=MM.discovery ? MM.discovery.list().filter(id=>id.indexOf('_cat_')>=0).length : -1;
	const slot=document.querySelector('.hotSlot'); if(slot){ slot.click(); await sleep(150); }
	const chips=document.querySelectorAll('#hotSelectMenu button[data-hot-chip]').length;
	document.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
	return 'ok:B rows='+rows+' fresh='+fresh+' toast="'+toast.slice(0,90)+'" chests='+window.__qaChests.length+' craftTabs='+tabs+' journalCats='+cats+' pickerChips='+chips;
})()`;

// C: open the epic chest — physical drops with beams
const SCENE_C = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const W=MM.world;
	const probe=window.__qaChests.map(c=>c[2]+'@'+c[0]+','+c[1]+'='+W.getTile(c[0],c[1])).join(' ');
	const epic=window.__qaChests.find(c=>c[2]===MM.T.CHEST_EPIC);
	const res=MM.chests.openChestAt(epic[0],epic[1]);
	await sleep(900); // let drops pop, bounce and settle
	const m=MM.drops.metrics();
	return 'ok:C probe=['+probe+'] tier='+(res&&res.tier)+' items='+(res&&res.items.length)+' spawned='+(res&&res.spawned)+' active='+m.active;
})()`;

// D: pick the drops up — inbox + upgrade-notice corner card
const SCENE_D = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const list=MM.drops._debug.list.slice();
	let picked=0;
	for(const d of list){
		player.x=d.x; player.y=d.y-0.2;
		if(MM.drops.pickupNearest(player)) picked++;
		await sleep(120);
	}
	try{ window.dispatchEvent(new KeyboardEvent('keydown',{key:'c'})); }catch(e){}
	await sleep(300);
	const card=document.getElementById('upgradeNotice');
	const shown=!!(card && card.classList.contains('show'));
	const title=shown ? (card.querySelector('.upTitle')||{}).textContent : '';
	const inboxBtn=document.getElementById('lootInboxBtn');
	return 'ok:D picked='+picked+' card='+shown+' title="'+(title||'')+'" inboxVisible='+(inboxBtn && inboxBtn.style.display!=='none');
})()`;

// E: close-up of the remaining chest tiers (art check) — zoom in, panel closed
const SCENE_E = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const card=document.getElementById('upgradeNotice');
	if(card) card.classList.remove('show');
	const host=document.getElementById('craft');
	if(host && host.dataset.collapsed!=='true') document.getElementById('craftToggle').click();
	// stand between the chests and zoom way in (keyup re-arms the zoom key)
	player.x=window.__qaChests[2][0]+1; player.y=window.__qaChests[2][1]-1;
	for(let i=0;i<6;i++){ window.dispatchEvent(new KeyboardEvent('keydown',{key:'+'})); window.dispatchEvent(new KeyboardEvent('keyup',{key:'+'})); }
	window.dispatchEvent(new KeyboardEvent('keydown',{key:'c'}));
	window.dispatchEvent(new KeyboardEvent('keyup',{key:'c'}));
	await sleep(900);
	return 'ok:E zoomed';
})()`;

// F: world-sighting unlock — a teleporter standing in view teaches its recipe
const SCENE_F = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const W=MM.world, T=MM.T;
	const px=Math.floor(player.x);
	// plant a teleporter two tiles from the hero, in plain sight
	let y=Math.floor(player.y)-4;
	while(y<300 && W.getTile(px+2,y+1)===T.AIR) y++;
	W.setTile(px+2,y,T.TELEPORTER);
	await sleep(3200); // > one 2.5s scan cadence
	const toast=(document.getElementById('messages')||{}).textContent||'';
	const rows=document.querySelectorAll('.craftRecipe').length;
	return 'ok:F toast="'+toast.slice(0,90)+'" rows='+rows;
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-lootqa-'));
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

		const scenes = [['A', SCENE_A], ['B', SCENE_B], ['C', SCENE_C], ['D', SCENE_D], ['E', SCENE_E], ['F', SCENE_F]];
		for (const [tag, expr] of scenes){
			const r = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 90000 });
			console.log('scene ' + tag + ':', r && r.result ? r.result.value : '(no result)');
			const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
			const out = `${outBase}-${tag.toLowerCase()}.png`;
			await writeFile(out, Buffer.from(shot.data, 'base64'));
			console.log('wrote', out);
		}

		if (pageErrors.length) console.log('pageErrors:', pageErrors.slice(0, 6).join('\n---\n'));
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
