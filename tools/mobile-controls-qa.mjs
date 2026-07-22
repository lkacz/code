#!/usr/bin/env node
// Headless-Edge live QA for input-mode detection (engine/input_mode.js) and the
// touch control clusters: boots the real game over CDP and walks the explicit
// mine/build/combat modes, asserting DOM gating and capturing layout screenshots:
//   tools/mobile-controls-qa.png    desktop 1600x900, mouse → touch UI hidden
//   tools/mobile-controls-qa-b.png  phone 390x844 portrait, touch → touch UI shown
//   tools/mobile-controls-qa-c.png  hybrid: mouse press on a touch device → hidden
//   tools/mobile-controls-qa-d.png  phone 844x390 landscape, touch → layout check
// Hard-asserts data-input-mode + per-cluster computed display; exits 1 on failure.
// Usage: node tools/mobile-controls-qa.mjs [--url=http://127.0.0.1:8123/index.html]
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
const outA = opt('out', 'tools/mobile-controls-qa.png');
const outB = outA.replace(/\.png$/, '-b.png');
const outC = outA.replace(/\.png$/, '-c.png');
const outD = outA.replace(/\.png$/, '-d.png');

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

// In-page probe: mode stamp, live media features and per-cluster visibility.
const PROBE = `(()=>{
	const ids=['controls','dirRing','touchGridPad','touchActionRail','jumpBtn','actionModeBtn','fireBtn'];
	const vis=id=>{ const el=document.getElementById(id); if(!el) return 'missing'; return el.getClientRects().length===0?'hidden':'shown'; };
	const r=sel=>{ const el=document.querySelector(sel); if(!el||el.getClientRects().length===0) return null; const b=el.getBoundingClientRect(); if(b.width<=0||b.height<=0) return null; return [Math.round(b.left),Math.round(b.top),Math.round(b.right),Math.round(b.bottom)]; };
	const targetSizes=[...document.querySelectorAll('#touchActionRail button')].filter(el=>el.getClientRects().length>0).map(el=>{ const b=el.getBoundingClientRect(); return {id:el.id,w:Math.round(b.width),h:Math.round(b.height),textFits:el.scrollWidth<=el.clientWidth&&el.scrollHeight<=el.clientHeight}; });
	const gridTargetSizes=[...document.querySelectorAll('#touchGridPad button')].filter(el=>el.getClientRects().length>0).map(el=>{ const b=el.getBoundingClientRect(); return {id:el.id,w:Math.round(b.width),h:Math.round(b.height)}; });
	const selectors={
		pad:'#controls .pad', ring:'#dirRing', actionRail:'#touchActionRail', aimStick:'#touchAimStick',
		modeButton:'#actionModeBtn', actionButton:'#fireBtn', hotbar:'#hotbarWrap',
		gridRight:'#touchGridRight', gridUp:'#touchGridUp', gridReset:'#touchGridReset',
		weaponBar:'#weaponBar', craft:'#craft', craftTracker:'#craftTracker',
		messages:'#messages', worldStatus:'#worldStatusPanel', atomicWinter:'#atomicWinterTimerPanel',
		task:'#taskPanel', fps:'#fpsPanel', menu:'#menuWrap', cornerCards:'#cornerCards'
	};
	const rects=Object.fromEntries(Object.entries(selectors).map(([name,selector])=>[name,r(selector)]));
	rects.vitals=(window.MM&&MM.vitalsHud&&MM.vitalsHud.bounds)?(()=>{ const b=MM.vitalsHud.bounds(); return b?[Math.round(b.x),Math.round(b.y),Math.round(b.x+b.width),Math.round(b.y+b.height)]:null; })():null;
	return JSON.stringify({
		mode:(document.documentElement.dataset.inputMode)||'(none)',
		actionMode:(document.documentElement.dataset.touchActionMode)||'(none)',
		caps:{coarse:matchMedia('(pointer:coarse)').matches, hover:matchMedia('(hover:hover)').matches, fine:matchMedia('(pointer:fine)').matches, touchPoints:navigator.maxTouchPoints|0},
		ui:Object.fromEntries(ids.map(id=>[id,vis(id)])),
		targetSizes,
		gridTargetSizes,
		selector:(document.getElementById('dirRing')||{}).dataset?.selector||'(none)',
		gridTarget:[Number((document.getElementById('dirRing')||{}).dataset?.gridX),Number((document.getElementById('dirRing')||{}).dataset?.gridY)],
		modeIcon:(document.querySelector('#actionModeBtn .touchModeIcon')||{}).textContent||'',
		modeLabel:(document.querySelector('#actionModeBtn .touchModeLabel')||{}).textContent||'',
		actionLabel:(document.querySelector('#fireBtn .touchActionLabel')||{}).textContent||'',
		jumpLabel:(document.querySelector('#jumpBtn .touchJumpLabel')||{}).textContent||'',
		stickHintsVisible:[...document.querySelectorAll('.touchStickHint')].filter(el=>el.getClientRects().length>0).map(el=>el.textContent.trim()),
		craftOpen:(()=>{ const c=document.getElementById('craft'); return !!(c && c.dataset.collapsed!=='true'); })(),
		viewport:[innerWidth,innerHeight],
		rects
	});
})()`;

const BOOT_WAIT = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	for(let i=0;i<400 && !(window.MM && window.player && MM.inputMode);i++) await sleep(100);
	return (window.MM && window.player && MM.inputMode) ? 'boot ok' : 'boot-timeout';
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-mobileqa-'));
	const proc = spawn(edge, [
		'--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
		'--force-device-scale-factor=1',
		'--remote-debugging-port=0',
		`--user-data-dir=${profile}`,
		'--window-size=1600,900',
		'about:blank'
	], { stdio: 'ignore' });

	let ws;
	let failures = 0;
	const check = (label, ok, detail) => {
		console.log((ok ? 'PASS' : 'FAIL') + ' ' + label + (detail ? ' :: ' + detail : ''));
		if(!ok) failures++;
	};
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
		const evalJson = async expr => {
			const r = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 90000 });
			return r && r.result ? r.result.value : null;
		};
		const probe = async () => JSON.parse(await evalJson(PROBE));
		const shot = async out => {
			const s = await send(ws, 'Page.captureScreenshot', { format: 'png' });
			await writeFile(out, Buffer.from(s.data, 'base64'));
			console.log('wrote', out);
		};
		const tap = async (x, y) => {
			await send(ws, 'Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
			await sleep(60);
			await send(ws, 'Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		};
		const click = async (x, y) => {
			await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
			await sleep(40);
			await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
		};
		const allUi = (p, want) => Object.entries(p.ui).filter(([,v]) => v !== want).map(([k,v]) => k + '=' + v).join(',');
		const layoutIssues = p => {
			const r = p.rects;
			const hit = (a, b) => a && b && a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
			const bad = [];
			const persistent=['pad','ring','actionRail','hotbar','weaponBar','craft','craftTracker','messages','worldStatus','atomicWinter','task','fps','menu','cornerCards','vitals'];
			for(let i=0;i<persistent.length;i++) for(let j=i+1;j<persistent.length;j++){
				if(hit(r[persistent[i]],r[persistent[j]])) bad.push(persistent[i]+' intersects '+persistent[j]);
			}
			for(const name of persistent){
				const b=r[name];
				if(b&&(b[0]<-1||b[1]<-1||b[2]>p.viewport[0]+1||b[3]>p.viewport[1]+1)) bad.push(name+' outside viewport');
			}
			return bad.join(',');
		};

		await send(ws, 'Page.enable');
		await send(ws, 'Runtime.enable');

		// --- stage A: desktop, mouse-first --------------------------------------
		await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
		await send(ws, 'Page.navigate', { url });
		for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await sleep(250);
		console.log('boot:', await evalJson(BOOT_WAIT));
		await sleep(800);
		let p = await probe();
		console.log('A probe:', JSON.stringify(p));
		check('A desktop boots into pc mode', p.mode === 'pc', p.mode);
		check('A touch UI hidden on desktop', allUi(p, 'hidden') === '', allUi(p, 'hidden'));
		await shot(outA);

		// --- stage B: phone portrait, touch -------------------------------------
		// Stage A's boot persisted craft-collapsed='0'; drop it so the reload is a
		// true phone first-run (the touch default only applies with no stored pref).
		await evalJson(`(()=>{ try{ localStorage.removeItem('mm_craft_collapsed_v1'); }catch(e){} return 'pref cleared'; })()`);
		await send(ws, 'Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
		await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
		await send(ws, 'Page.reload');
		await sleep(1200);
		console.log('boot:', await evalJson(BOOT_WAIT));
		await sleep(800);
		p = await probe();
		console.log('B probe (pre-tap):', JSON.stringify(p));
		await tap(60, 180); // sky tap: also exercises the last-input-wins path
		await sleep(250);
		p = await probe();
		console.log('B probe:', JSON.stringify(p));
		check('B phone lands in touch mode', p.mode === 'touch', p.mode);
		check('B touch UI shown on phone', allUi(p, 'shown') === '', allUi(p, 'shown'));
		check('B visible touch targets are at least 48px', p.targetSizes.every(t=>t.w>=48&&t.h>=48), JSON.stringify(p.targetSizes));
		check('B grid keys are at least 48px', p.gridTargetSizes.length===5&&p.gridTargetSizes.every(t=>t.w>=48&&t.h>=48), JSON.stringify(p.gridTargetSizes));
		check('B touch button labels fit their targets', p.targetSizes.every(t=>t.textFits), JSON.stringify(p.targetSizes));
		check('B stick labels do not cover the joystick', p.stickHintsVisible.length === 0, p.stickHintsVisible.join(','));
		check('B action mode defaults to mine', p.actionMode === 'mine', p.actionMode);
		check('B mining uses the precise grid selector', p.selector === 'grid', p.selector);
		check('B mode switch uses a neutral icon', p.modeIcon === '↻', p.modeIcon);
		check('B primary controls have explicit labels', p.modeLabel==='TRYB'&&p.actionLabel==='KOP'&&p.jumpLabel==='SKOK', p.modeLabel+'/'+p.actionLabel+'/'+p.jumpLabel);
		check('B grid target starts beside the hero', p.gridTarget[0]===1&&p.gridTarget[1]===0, JSON.stringify(p.gridTarget));
		check('B craft panel boots collapsed on touch', p.craftOpen === false, 'open=' + p.craftOpen);
		check('B portrait interface does not overlap or clip', layoutIssues(p) === '', layoutIssues(p));
		await shot(outB);
		const rightRect=p.rects.gridRight;
		await tap((rightRect[0]+rightRect[2])/2,(rightRect[1]+rightRect[3])/2);
		await sleep(120);
		p=await probe();
		check('B right key advances exactly one column', p.gridTarget[0]===2&&p.gridTarget[1]===0, JSON.stringify(p.gridTarget));
		const upRect=p.rects.gridUp;
		await tap((upRect[0]+upRect[2])/2,(upRect[1]+upRect[3])/2);
		await sleep(120);
		p=await probe();
		check('B up key advances exactly one row', p.gridTarget[0]===2&&p.gridTarget[1]===-1, JSON.stringify(p.gridTarget));
		const resetRect=p.rects.gridReset;
		await tap((resetRect[0]+resetRect[2])/2,(resetRect[1]+resetRect[3])/2);
		await sleep(120);
		p=await probe();
		check('B centre key resets beside the hero', Math.abs(p.gridTarget[0])===1&&p.gridTarget[1]===0, JSON.stringify(p.gridTarget));
		const modeRect=p.rects.modeButton;
		await tap((modeRect[0]+modeRect[2])/2,(modeRect[1]+modeRect[3])/2);
		await sleep(180);
		p=await probe();
		check('B mode button cycles mine to build', p.actionMode === 'build', p.actionMode);
		check('B building keeps the precise grid selector', p.selector === 'grid'&&p.ui.touchGridPad==='shown', p.selector+'/'+p.ui.touchGridPad);
		check('B build trigger says POSTAW', p.actionLabel === 'POSTAW', p.actionLabel);
		await tap((modeRect[0]+modeRect[2])/2,(modeRect[1]+modeRect[3])/2);
		await sleep(180);
		p=await probe();
		check('B mode button cycles build to combat', p.actionMode === 'combat', p.actionMode);
		check('B combat swaps the grid for analog aim', p.selector === 'combat'&&p.ui.touchGridPad==='hidden'&&!!p.rects.aimStick, p.selector+'/'+p.ui.touchGridPad);
		check('B combat trigger says ATAK', p.actionLabel === 'ATAK', p.actionLabel);

		// --- stage C: hybrid — mouse press while touch-capable -------------------
		await sleep(900); // clear the ghost-mouse grace window
		await click(60, 180);
		await sleep(250);
		p = await probe();
		console.log('C probe:', JSON.stringify(p));
		check('C mouse press flips to pc mode', p.mode === 'pc', p.mode);
		check('C touch UI hidden after mouse press', allUi(p, 'hidden') === '', allUi(p, 'hidden'));
		await shot(outC);
		await tap(60, 180);
		await sleep(250);
		p = await probe();
		check('C tap flips back to touch mode', p.mode === 'touch', p.mode);

		// --- stage D: phone landscape layout ------------------------------------
		await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true, screenWidth: 844, screenHeight: 390 });
		await sleep(600);
		await tap(120, 100);
		await sleep(250);
		p = await probe();
		console.log('D probe:', JSON.stringify(p));
		check('D landscape stays in touch mode', p.mode === 'touch', p.mode);
		check('D touch UI shown in landscape', allUi(p, 'shown') === '', allUi(p, 'shown'));
		check('D visible touch targets are at least 48px', p.targetSizes.every(t=>t.w>=48&&t.h>=48), JSON.stringify(p.targetSizes));
		check('D grid keys remain at least 48px', p.gridTargetSizes.length===5&&p.gridTargetSizes.every(t=>t.w>=48&&t.h>=48), JSON.stringify(p.gridTargetSizes));
		check('D touch button labels fit their targets', p.targetSizes.every(t=>t.textFits), JSON.stringify(p.targetSizes));
		check('D stick labels do not cover the joystick', p.stickHintsVisible.length === 0, p.stickHintsVisible.join(','));
		check('D landscape interface does not overlap or clip', layoutIssues(p) === '', layoutIssues(p));
		await shot(outD);

		if (pageErrors.length) console.log('pageErrors:', pageErrors.slice(0, 5).join('\n---\n'));
		if (failures){ console.error(failures + ' check(s) FAILED'); process.exitCode = 1; }
		else console.log('mobile-controls-qa: all checks passed');
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
