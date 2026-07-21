#!/usr/bin/env node
// Headless-Edge live QA for the hotbar slot picker (engine/hot_picker.js).
// Boots the REAL game over CDP and exercises the whole assignment flow through
// actual DOM events: opens the picker on slot 6, screenshots the icon grid,
// types into the search box (diacritics-folded query), assigns via Enter,
// verifies HOTBAR_ORDER + the recents section, then re-opens to confirm
// "Ostatnie" leads the list. Also drives a category chip and Escape-close.
//   tools/hot-picker-qa.png    open picker: chips + sectioned icon grid
//   tools/hot-picker-qa-b.png  search narrowed to ranked results
//   tools/hot-picker-qa-c.png  after a card was dragged onto a DIFFERENT slot
//   tools/hot-picker-qa-d.png  inventory resources tab: drag handles + "+" craft
// Also exercises (real CDP mouse input where a drag is involved): dragging a
// card icon onto any hotbar slot, the per-card "+" quick-craft, the persisted
// "owned only" filter, and dragging an inventory swatch onto the hotbar THROUGH
// the modal overlay (pointer-events pass-through) + inventory "+".
// Usage: node tools/hot-picker-qa.mjs [--url=http://127.0.0.1:8123/index.html]
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
const outA = opt('out', 'tools/hot-picker-qa.png');
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

const STAGE = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	for(let i=0;i<400 && !(window.MM && window.inv && MM.hotbar && MM.groupedHotSelect && document.getElementById('hotSelectMenu'));i++) await sleep(100);
	if(!MM.groupedHotSelect) return 'boot-timeout';
	try{ MM.background.importState({cycleT:0.25}); }catch(e){}
	Object.assign(window.inv,{sand:72,snow:9,toxicSnow:3,water:45,grass:5,wood:14,granite:8});
	window.updateInventoryHud && window.updateInventoryHud();
	// open the picker on slot index 1 (key 6) via the real slot element
	const slotEl=document.querySelectorAll('#hotbarWrap .hotSlot')[1];
	slotEl.click(); // first click selects
	slotEl.click(); // second click opens the remap popup
	await sleep(250);
	const menu=document.getElementById('hotSelectMenu');
	if(getComputedStyle(menu).display==='none') return 'menu-not-open';
	const cards=[...menu.querySelectorAll('button[data-hot-card]')];
	const chips=[...menu.querySelectorAll('button')].filter(b=>!b.dataset.hotCard);
	const input=menu.querySelector('input');
	const title=document.getElementById('hotSelectTitle').textContent;
	const icons=cards.filter(c=>c.querySelector('canvas')).length;
	return 'ok: title="'+title+'" cards='+cards.length+' icons='+icons+' chips='+chips.length+' hasSearch='+!!input;
})()`;

const CHIPS = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const menu=document.getElementById('hotSelectMenu');
	// REGRESSION PIN: pressing a category chip must NOT dismiss the popup.
	// (chip clicks re-render the chip row mid-bubble; the old document 'click'
	// dismisser saw a detached target and closed the menu on every chip press)
	const chip=[...menu.querySelectorAll('button[data-hot-chip]')].find(c=>c.textContent==='Skały i rudy');
	if(!chip) return 'no-chip';
	chip.click();
	await sleep(150);
	if(getComputedStyle(menu).display==='none') return 'chip-click-closed-menu';
	const heads=[...menu.querySelectorAll('.hpSecHead')].map(h=>h.textContent);
	if(heads.length!==1 || heads[0]!=='Skały i rudy') return 'chip-filter-wrong:'+heads.join('|');
	const focused=document.activeElement && document.activeElement.dataset && document.activeElement.dataset.hotChip==='rock';
	// search box must stay reachable above the scrolling grid
	const input=menu.querySelector('input');
	const inputVisible=!!input && input.getBoundingClientRect().height>0;
	// back to everything for the search step
	const all=[...menu.querySelectorAll('button[data-hot-chip]')].find(c=>c.dataset.hotChip==='all');
	all.click();
	await sleep(120);
	if(getComputedStyle(menu).display==='none') return 'all-chip-closed-menu';
	// outside POINTERDOWN dismisses (canvas press)
	document.getElementById('game').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
	await sleep(120);
	const closedOutside=getComputedStyle(menu).display==='none';
	// re-open for the search scenario
	const slotEl=document.querySelectorAll('#hotbarWrap .hotSlot')[1];
	slotEl.click(); slotEl.click();
	await sleep(250);
	if(getComputedStyle(menu).display==='none') return 'reopen-failed';
	return 'ok: chipKeepsMenu=true chipFocus='+focused+' searchPinned='+inputVisible+' outsideCloses='+closedOutside;
})()`;

const SEARCH = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const menu=document.getElementById('hotSelectMenu');
	const input=menu.querySelector('input');
	if(!input) return 'no-input';
	input.focus();
	// folded query: plain ascii must find 'Śnieg' items
	input.value='snieg';
	input.dispatchEvent(new Event('input',{bubbles:true}));
	await sleep(150);
	const cards=[...menu.querySelectorAll('button[data-hot-card]')];
	const keys=cards.map(c=>c.dataset.hotCard);
	if(!keys.length) return 'search-found-nothing';
	if(keys[0]!=='SNOW') return 'ranking-wrong:'+keys.join(',');
	return 'ok: hits='+keys.join(',');
})()`;

const ASSIGN = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const menu=document.getElementById('hotSelectMenu');
	const input=menu.querySelector('input');
	// Enter assigns the first ranked hit (SNOW) to the open slot
	input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
	await sleep(250);
	if(getComputedStyle(menu).display!=='none') return 'menu-should-close-after-assign';
	const order=MM.hotbar.order();
	if(order[1]!=='SNOW') return 'assign-failed:'+order.join(',');
	const lbl=document.querySelectorAll('#hotbarWrap .hotSlot')[1].querySelector('.lbl').textContent;
	// re-open: recents section must lead with the fresh assignment
	const slotEl=document.querySelectorAll('#hotbarWrap .hotSlot')[1];
	slotEl.click(); slotEl.click();
	await sleep(250);
	const secHeads=[...menu.querySelectorAll('div')].map(d=>d.textContent).filter(t=>t==='Ostatnie');
	const firstCard=menu.querySelector('button[data-hot-card]');
	const recentLeads=secHeads.length>0 && firstCard && firstCard.dataset.hotCard==='SNOW';
	// Escape from the search box closes the popover
	const input2=menu.querySelector('input');
	input2.focus();
	input2.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
	await sleep(150);
	const closed=getComputedStyle(menu).display==='none';
	return 'ok: slotLabel='+lbl+' recentLeads='+recentLeads+' escCloses='+closed;
})()`;

// --- NEW: drag a card onto ANY slot, "+" quick-craft, owned-only filter ------
// Re-opens the picker on slot 2 (key 7), grants stock, and reports the screen
// centers of the WOOD card icon (drag handle) and slot 0 (key 5) so a real
// mouse drag can remap a DIFFERENT slot than the one the picker was opened for.
const PICKER_DRAG_PREP = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	Object.assign(window.inv,{wood:20,stone:14,sand:10,torch:1});
	window.updateInventoryHud && window.updateInventoryHud();
	const menu=document.getElementById('hotSelectMenu');
	const slot=document.querySelectorAll('#hotbarWrap .hotSlot')[2];
	slot.click(); slot.click();
	await sleep(250);
	if(getComputedStyle(menu).display==='none') return 'menu-not-open';
	const card=menu.querySelector('button[data-hot-card="WOOD"]');
	if(!card) return 'no-wood-card';
	const icon=card.querySelector('canvas');
	const dst=document.querySelectorAll('#hotbarWrap .hotSlot')[0];
	const a=icon.getBoundingClientRect(), b=dst.getBoundingClientRect();
	return JSON.stringify({fx:a.left+a.width/2, fy:a.top+a.height/2, tx:b.left+b.width/2, ty:b.top+b.height/2, before:MM.hotbar.order()[0]});
})()`;
const PICKER_DRAG_MID = `JSON.stringify({dragging:!!(MM.craftDrag&&MM.craftDrag.dragging()), hotbarZ:getComputedStyle(document.getElementById('hotbarWrap')).zIndex, ghost:!!document.getElementById('craftDragGhost')})`;
const PICKER_DRAG_CHECK = `JSON.stringify({slot0:MM.hotbar.order()[0], menuOpen:getComputedStyle(document.getElementById('hotSelectMenu')).display!=='none'})`;

const PICKER_PLUS = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const menu=document.getElementById('hotSelectMenu');
	if(getComputedStyle(menu).display==='none'){ const s=document.querySelectorAll('#hotbarWrap .hotSlot')[2]; s.click(); s.click(); await sleep(200); }
	const card=menu.querySelector('button[data-hot-card="TORCH"]');
	if(!card) return 'no-torch-card (torch not discovered?)';
	const plus=card.querySelector('.hpQuickCraft');
	if(!plus) return 'no-plus-chip (recipe locked?)';
	const before=window.inv.torch|0;
	plus.click();
	await sleep(200);
	const after=window.inv.torch|0;
	if(getComputedStyle(menu).display==='none') return 'plus-closed-menu (should stay open)';
	return (after>before?'ok':'FAIL')+': torch '+before+'->'+after+' menuStaysOpen=true';
})()`;

const PICKER_OWNED = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const menu=document.getElementById('hotSelectMenu');
	// empty two already-DISCOVERED blocks so owned-only has something to hide
	window.inv.grass=0; window.inv.water=0;
	window.updateInventoryHud && window.updateInventoryHud();
	// reopen fresh so the grid reflects the zeroed counts (owned-only starts off)
	if(getComputedStyle(menu).display!=='none'){ document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})); await sleep(140); }
	const s=document.querySelectorAll('#hotbarWrap .hotSlot')[2]; s.click(); s.click(); await sleep(220);
	const before=menu.querySelectorAll('button[data-hot-card]').length;
	const toggle=menu.querySelector('.hpOwnedToggle');
	if(!toggle) return 'no-owned-toggle';
	toggle.click();
	await sleep(200);
	const after=menu.querySelectorAll('button[data-hot-card]').length;
	const persisted=localStorage.getItem('mm_hotbar_owned_only_v1');
	// every remaining card must be a non-empty stack
	const allOwned=[...menu.querySelectorAll('button[data-hot-card]')].every(c=>!c.classList.contains('hpDim'));
	toggle.click(); // restore off
	await sleep(120);
	return (after<before && allOwned && persisted==='1'?'ok':'FAIL')+': cards '+before+'->'+after+' allOwned='+allOwned+' persisted='+persisted;
})()`;

// Inventory (Ekwipunek) resources tab: drag a resource swatch onto the hotbar
// through the modal overlay (pointer-events pass-through), and craft via "+".
const INV_OPEN = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const menu=document.getElementById('hotSelectMenu'); if(getComputedStyle(menu).display!=='none') MM.groupedHotSelect && document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
	Object.assign(window.inv,{wood:20,stone:14,sand:10,clay:6});
	window.updateInventoryHud && window.updateInventoryHud();
	const btn=document.getElementById('openInv'); if(!btn) return 'no-openInv';
	btn.click();
	await sleep(250);
	const ov=document.getElementById('invOverlay');
	if(getComputedStyle(ov).display==='none') return 'inv-did-not-open';
	const tab=document.querySelector('#invTabs [data-key="resources"]'); if(!tab) return 'no-resources-tab';
	tab.click();
	await sleep(200);
	const card=[...document.querySelectorAll('.invResCard')].find(c=>c.querySelector('.invResDrag'));
	if(!card) return 'no-draggable-resource';
	const dot=card.querySelector('.invResDrag');
	const dst=document.querySelectorAll('#hotbarWrap .hotSlot')[4]; // slot key 9
	const a=dot.getBoundingClientRect(), b=dst.getBoundingClientRect();
	return JSON.stringify({fx:a.left+a.width/2, fy:a.top+a.height/2, tx:b.left+b.width/2, ty:b.top+b.height/2, before:MM.hotbar.order()[4]});
})()`;
const INV_DRAG_MID = `JSON.stringify({dragging:!!(MM.craftDrag&&MM.craftDrag.dragging()), overlayPE:getComputedStyle(document.getElementById('invOverlay')).pointerEvents, dropThrough:(function(){var b=document.querySelectorAll('#hotbarWrap .hotSlot')[4].getBoundingClientRect();var el=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);return !!(el&&el.closest&&el.closest('#hotbarWrap'));})()})`;
const INV_DRAG_CHECK = `JSON.stringify({slot4:MM.hotbar.order()[4]})`;
const INV_PLUS = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const btn=[...document.querySelectorAll('.invResCraft')].find(b=>!b.disabled);
	if(!btn) return 'no-enabled-plus';
	// find the card's resource label for reporting
	const card=btn.closest('.invResCard');
	const label=card? card.querySelector('.invResLabel').textContent : '?';
	btn.click();
	await sleep(200);
	const closeBtn=document.getElementById('invClose'); if(closeBtn) closeBtn.click();
	await sleep(150);
	return 'ok: crafted from inventory "+" ('+label+')';
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-hotpickqa-'));
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
					try { pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 400)); } catch (e) { /* ignore */ }
				}
			}
		};

		await send(ws, 'Page.enable');
		await send(ws, 'Runtime.enable');
		await send(ws, 'Emulation.setDeviceMetricsOverride', { width: winW, height: winH, deviceScaleFactor: 1, mobile: false });
		await send(ws, 'Page.navigate', { url });
		for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await sleep(250);
		await sleep(1500);

		let failed = false;
		const run = async (label, expr, okCheck = true) => {
			const res = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 90000 });
			const verdict = res && res.result ? res.result.value : '(no result)';
			console.log(label + ':', verdict);
			if (okCheck && !String(verdict).startsWith('ok')) failed = true;
			return verdict;
		};

		await run('stage', STAGE);
		let shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
		await writeFile(outA, Buffer.from(shot.data, 'base64'));
		console.log('wrote', outA);

		await run('chips', CHIPS);
		await run('search', SEARCH);
		shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
		await writeFile(outB, Buffer.from(shot.data, 'base64'));
		console.log('wrote', outB);

		await run('assign', ASSIGN);

		// --- real mouse-drag helper (craft_drag uses pointer events synthesized
		// from CDP mouse input; proven by craft-panel-qa) ---
		const mouse = (type, x, y, extra) => send(ws, 'Input.dispatchMouseEvent',
			Object.assign({ type, x: Math.round(x), y: Math.round(y), button: 'left', buttons: 1 }, extra || {}));
		const dragTo = async (p, midExpr, midLabel) => {
			await mouse('mousePressed', p.fx, p.fy, { clickCount: 1 });
			const STEPS = 10;
			for (let i = 1; i <= STEPS; i++){ await mouse('mouseMoved', p.fx + (p.tx - p.fx) * i / STEPS, p.fy + (p.ty - p.fy) * i / STEPS); await sleep(22); }
			await sleep(140);
			if (midExpr){ const mid = await send(ws, 'Runtime.evaluate', { expression: midExpr, returnByValue: true }); console.log(midLabel + ':', mid && mid.result ? mid.result.value : '(no result)'); }
			await mouse('mouseReleased', p.tx, p.ty, { buttons: 0, clickCount: 1 });
			await sleep(220);
		};

		// picker: drag WOOD card icon onto slot 5 (opened on slot 7)
		const pdp = await run('pickerDragPrep', PICKER_DRAG_PREP, false);
		if (typeof pdp === 'string' && pdp.startsWith('{')){
			const p = JSON.parse(pdp);
			await dragTo(p, PICKER_DRAG_MID, 'pickerDragMid');
			const chk = await send(ws, 'Runtime.evaluate', { expression: PICKER_DRAG_CHECK, returnByValue: true });
			const v = chk && chk.result ? JSON.parse(chk.result.value) : {};
			const ok = v.slot0 === 'WOOD' && v.menuOpen === true;
			console.log('pickerDrag:', (ok ? 'ok' : 'FAIL') + ': slot0=' + v.slot0 + ' menuOpen=' + v.menuOpen + ' before=' + p.before);
			if (!ok) failed = true;
			shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
			await writeFile(outA.replace(/\.png$/, '-c.png'), Buffer.from(shot.data, 'base64'));
			console.log('wrote', outA.replace(/\.png$/, '-c.png'));
		} else failed = true;

		await run('pickerPlus', PICKER_PLUS);
		await run('pickerOwned', PICKER_OWNED);

		// inventory: drag a resource swatch through the modal onto slot 9
		const ip = await run('invOpen', INV_OPEN, false);
		if (typeof ip === 'string' && ip.startsWith('{')){
			const p = JSON.parse(ip);
			await dragTo(p, INV_DRAG_MID, 'invDragMid');
			const chk = await send(ws, 'Runtime.evaluate', { expression: INV_DRAG_CHECK, returnByValue: true });
			const v = chk && chk.result ? JSON.parse(chk.result.value) : {};
			const ok = v.slot4 && v.slot4 !== 'LEAF'; // slot 9 default is LEAF; a successful drop changed it
			console.log('invDrag:', (ok ? 'ok' : 'FAIL') + ': slot9=' + v.slot4 + ' before=' + p.before);
			if (!ok) failed = true;
			shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
			await writeFile(outA.replace(/\.png$/, '-d.png'), Buffer.from(shot.data, 'base64'));
			console.log('wrote', outA.replace(/\.png$/, '-d.png'));
			await run('invPlus', INV_PLUS);
		} else failed = true;

		if (pageErrors.length) console.log('pageErrors:', pageErrors.slice(0, 5).join('\n---\n'));
		if (failed || pageErrors.length) process.exitCode = 1;
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
