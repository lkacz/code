#!/usr/bin/env node
// Headless-Edge live QA for the ground-loot drop system (engine/drops.js).
// Boots the real game over CDP (real rAF — virtual time freezes it), stages a
// lineup of drops next to the hero and captures screenshots:
//   tools/drops-qa.png    lineup: meat scraps ×3, coal ×2, common/rare gear
//                         (tier halos + countdown bars), fresh epic (beam +
//                         orbiting glint + full bar), ticking epic (red bar),
//                         [E] pickup hint over the nearest drop
//   tools/drops-qa-b.png  right after an E sweep (aggregated pickup toast,
//                         loot-inbox indicator lit)
//   tools/drops-qa-c.png  cursor hover over a rare drop: corner preview card
//                         (#dropPreview) + in-world highlight ring; the scene
//                         also click-grabs it, verifies far-click refusal and
//                         hold-E opening the wardrobe over loot underfoot
// Usage: node tools/drops-qa.mjs [--url=http://127.0.0.1:8123/index.html] [--size=1600x900]
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
const outA = opt('out', 'tools/drops-qa.png');
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
	for(let i=0;i<400 && !(window.MM && MM.drops && window.player && window.__mmDebugHero);i++) await sleep(100);
	if(!(window.MM && MM.drops)) return 'boot-timeout';
	try{ MM.background.importState({cycleT:0.25}); }catch(e){} // deterministic daylight
	// clear the stage: collapse the crafting book, lift the fog, zoom in on the hero
	try{ const host=document.getElementById('craft'); if(host && host.dataset.collapsed!=='true') document.getElementById('craftToggle').click(); }catch(e){}
	try{ window.dispatchEvent(new KeyboardEvent('keydown',{key:'m'})); window.dispatchEvent(new KeyboardEvent('keyup',{key:'m'})); }catch(e){}
	for(let i=0;i<5;i++){ try{ window.dispatchEvent(new KeyboardEvent('keydown',{key:'+'})); window.dispatchEvent(new KeyboardEvent('keyup',{key:'+'})); }catch(e){} }
	MM.drops.setAutoPickup(false); // manual mode: the [E] hint must show
	MM.drops.reset();
	const px=player.x, py=player.y;
	const gear=(tier,kind,name,extra)=>Object.assign({id:kind+'_qa_'+tier+'_'+Math.random().toString(36).slice(2,6),kind,tier,name},extra||{});
	// lineup left→right: scrap pile, coal, common charm, rare weapon, fresh epic, ticking epic
	MM.drops.spawnResource(px-5.4, py-2, 'meatScrap', 3, {vx:0,vy:0});
	MM.drops.spawnResource(px-3.8, py-2, 'coal', 2, {vx:0,vy:0});
	MM.drops.spawnGear(px-1.6, py-2, gear('common','charm','Zwykły talizman QA',{mineSpeedMult:1.05}), {vx:0,vy:0,announce:false});
	MM.drops.spawnGear(px+1.2, py-2, gear('rare','weapon','Rzadki miecz QA',{attackDamage:6}), {vx:0,vy:0,announce:false});
	MM.drops.spawnGear(px+3.4, py-2, gear('epic','cape','Epicka peleryna QA',{airJumps:3}), {vx:0,vy:0,announce:false});
	const ticking=MM.drops.spawnGear(px+5.6, py-2, gear('epic','weapon','Tykający epik QA',{attackDamage:11}), {vx:0,vy:0,announce:false});
	if(ticking) ticking.age=ticking.life-10; // red countdown bar, pre-blink
	try{ window.dispatchEvent(new KeyboardEvent('keydown',{key:'c'})); window.dispatchEvent(new KeyboardEvent('keyup',{key:'c'})); }catch(e){}
	await sleep(1400); // drops settle; halos/beam/glint animate on real rAF
	const m=MM.drops.metrics();
	return 'ok:staged drops='+m.active+' auto='+m.autoPickup
		+' lives='+MM.drops._debug.list.map(d=>d.tier+':'+Math.round(d.life-d.age)).join(',');
})()`;

const SWEEP = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	// step onto the resource piles and sweep them with one (programmatic) E
	const scrap=MM.drops._debug.list.find(d=>d.kind==='resource');
	if(scrap) window.__mmDebugHero(scrap.x+0.6, scrap.y-0.5);
	const took=MM.drops.pickupNearest(window.player);
	await sleep(350); // toast + inbox indicator render
	return 'ok:swept took='+took+' left='+MM.drops.metrics().active;
})()`;

// world→screen assumes the camera rests centered on the hero (the scene snaps
// it with C and waits out the follow smoothing first — free-play-qa recipe).
const HOVER = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const canvas=document.querySelector('canvas');
	MM.drops.reset();
	const gear={id:'weapon_qa_hover1',kind:'weapon',weaponType:'melee',tier:'rare',name:'Miecz pod kursorem QA',attackDamage:6,desc:'QA: podglad pod kursorem.'};
	MM.drops.spawnGear(player.x+1.6, player.y-1.5, gear, {vx:0,vy:0,announce:false});
	MM.drops.spawnResource(player.x+9.0, player.y-1.5, 'coal', 2, {vx:0,vy:0});
	window.dispatchEvent(new KeyboardEvent('keydown',{key:'c'})); window.dispatchEvent(new KeyboardEvent('keyup',{key:'c'}));
	await sleep(1000); // settle + camera snap
	const zoom=(window.__mmRenderDetail && window.__mmRenderDetail.zoom)||1;
	const t=(MM.TILE||20)*zoom;
	const r=canvas.getBoundingClientRect();
	const near=MM.drops._debug.list.find(d=>d.kind==='gear');
	const sx=r.left+r.width/2+(near.x-(player.x+player.w/2))*t;
	const sy=r.top+r.height/2+(near.y-(player.y+player.h/2))*t;
	canvas.dispatchEvent(new PointerEvent('pointermove',{pointerId:7,pointerType:'mouse',isPrimary:true,clientX:sx,clientY:sy,bubbles:true}));
	await sleep(400); // a few real frames: updateDropPreview builds the card
	const card=document.getElementById('dropPreview');
	return 'ok:hover shown='+(card && card.classList.contains('show'))
		+' text='+(card ? card.textContent.slice(0,90) : '(none)');
})()`;

const GRAB = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const canvas=document.querySelector('canvas');
	const card=document.getElementById('dropPreview');
	const out=[];
	const zoom=(window.__mmRenderDetail && window.__mmRenderDetail.zoom)||1;
	const t=(MM.TILE||20)*zoom;
	const r=canvas.getBoundingClientRect();
	const toScreen=d=>[r.left+r.width/2+(d.x-(player.x+player.w/2))*t, r.top+r.height/2+(d.y-(player.y+player.h/2))*t];
	const pm=(x,y)=>canvas.dispatchEvent(new PointerEvent('pointermove',{pointerId:7,pointerType:'mouse',isPrimary:true,clientX:x,clientY:y,bubbles:true}));
	const click=(x,y)=>{
		canvas.dispatchEvent(new PointerEvent('pointerdown',{pointerId:7,pointerType:'mouse',isPrimary:true,button:0,buttons:1,clientX:x,clientY:y,bubbles:true,cancelable:true}));
		window.dispatchEvent(new PointerEvent('pointerup',{pointerId:7,pointerType:'mouse',isPrimary:true,clientX:x,clientY:y,bubbles:true}));
	};
	// 1) click the hovered rare drop: exactly it is taken (the coal stays)
	const near=MM.drops._debug.list.find(d=>d.kind==='gear');
	let p=toScreen(near);
	click(p[0],p[1]);
	await sleep(250);
	out.push('clickGrab='+(MM.drops.metrics().active===1 && !!(MM.dynamicLoot && MM.dynamicLoot.weapons.some(i=>i && i.id==='weapon_qa_hover1'))));
	// 2) far drop: preview asks to walk closer, the click leaves it in the world
	const far=MM.drops._debug.list.find(d=>d.kind==='resource');
	p=toScreen(far);
	pm(p[0],p[1]);
	await sleep(300);
	out.push('farHint='+(card && card.textContent.indexOf('Podejdź bliżej')>=0));
	click(p[0],p[1]);
	await sleep(200);
	out.push('farKept='+(MM.drops.metrics().active===1));
	// 3) empty sky hides the card
	pm(r.left+r.width/2, r.top+40);
	await sleep(300);
	out.push('hideOnMiss='+(card && !card.classList.contains('show')));
	// 4) tap E with loot underfoot: sweeps the drop, wardrobe stays shut
	MM.drops.spawnResource(player.x, player.y-1.2, 'coal', 1, {vx:0,vy:0});
	await sleep(400);
	window.dispatchEvent(new KeyboardEvent('keydown',{key:'e',bubbles:true}));
	window.dispatchEvent(new KeyboardEvent('keyup',{key:'e',bubbles:true}));
	await sleep(200);
	out.push('tapSweeps='+(MM.drops.metrics().active===1)+' tapKeepsShut='+!(MM.inventoryUI && MM.inventoryUI.isOpen()));
	// 5) HOLD E: past the tap window the wardrobe opens no matter the loot
	window.dispatchEvent(new KeyboardEvent('keydown',{key:'e',bubbles:true}));
	await sleep(700);
	out.push('holdOpens='+!!(MM.inventoryUI && MM.inventoryUI.isOpen()));
	window.dispatchEvent(new KeyboardEvent('keyup',{key:'e',bubbles:true}));
	try{ MM.inventoryUI.close(); }catch(e){}
	return 'ok:'+out.join(' ');
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-dropsqa-'));
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

		const swept = await send(ws, 'Runtime.evaluate', { expression: SWEEP, awaitPromise: true, returnByValue: true, timeout: 30000 });
		console.log('sweep:', swept && swept.result ? swept.result.value : '(no result)');
		shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
		await writeFile(outB, Buffer.from(shot.data, 'base64'));
		console.log('wrote', outB);

		const hovered = await send(ws, 'Runtime.evaluate', { expression: HOVER, awaitPromise: true, returnByValue: true, timeout: 30000 });
		console.log('hover:', hovered && hovered.result ? hovered.result.value : '(no result)');
		shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
		await writeFile(outC, Buffer.from(shot.data, 'base64'));
		console.log('wrote', outC);

		const grabbed = await send(ws, 'Runtime.evaluate', { expression: GRAB, awaitPromise: true, returnByValue: true, timeout: 30000 });
		console.log('grab:', grabbed && grabbed.result ? grabbed.result.value : '(no result)');

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
