#!/usr/bin/env node
// Live mouse-button contract QA: LMB mines and NEVER places; RMB places one
// block on click and paints a line while dragged; LMB hold digs a block back
// out. Guards the regression where the build stroke armed on the left button.
//
// Usage: node tools/build-stroke-qa.mjs [--url=http://127.0.0.1:8123/index.html] [--seed=777]
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
	const hit = args.find(a => a.startsWith('--' + name + '='));
	return hit ? hit.slice(name.length + 3) : dflt;
};
const url = opt('url', 'http://127.0.0.1:8123/index.html');
const seed = opt('seed', '777');

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

const SCENE = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const R={};
	for(let i=0;i<400 && !(window.MM && MM.world && MM.worldGen && window.player && window.inv && window.__mmDebugHero);i++) await sleep(100);
	if(!(window.MM && MM.world)) return {fatal:'boot-timeout'};
	MM.fog.setRevealAll(true);
	const T=MM.T, WG=MM.worldGen, gt=MM.world.getTile, P=window.player;
	const canvas=document.getElementById('game');
	const rect=()=>canvas.getBoundingClientRect();
	const kd=(key,code)=>window.dispatchEvent(new KeyboardEvent('keydown',{key,code,bubbles:true}));
	const ku=(key,code)=>window.dispatchEvent(new KeyboardEvent('keyup',{key,code,bubbles:true}));
	const pd=(x,y,btn)=>canvas.dispatchEvent(new PointerEvent('pointerdown',{pointerId:7,pointerType:'mouse',isPrimary:true,button:btn,buttons:btn===2?2:1,clientX:x,clientY:y,bubbles:true,cancelable:true}));
	const pm=(x,y,buttons)=>canvas.dispatchEvent(new PointerEvent('pointermove',{pointerId:7,pointerType:'mouse',isPrimary:true,buttons:buttons||0,clientX:x,clientY:y,bubbles:true}));
	const pu=(x,y)=>window.dispatchEvent(new PointerEvent('pointerup',{pointerId:7,pointerType:'mouse',isPrimary:true,clientX:x,clientY:y,bubbles:true}));
	const tilePx=()=>((MM.TILE||20)*((window.__mmRenderDetail&&window.__mmRenderDetail.zoom)||1));

	// stage on flat open ground far from spawn (tutorial NPC overlay would hold
	// the sim). Tool mode and hotbar slot 0 (GRASS) are the boot DEFAULTS — no
	// key presses, so a focused panel input can never eat the selection.
	// natural open ground only (5..60): sky-glass islands and cave roofs are not a camp
	const surfaceAt=x=>{ for(let y=5;y<60;y++){ const t=gt(x,y); if(t===T.WATER) return null; if(t===T.GRASS||t===T.DIRT||t===T.SAND||t===T.STONE||t===T.GRASS_SNOW||t===T.SNOW) return y; if(t!==T.AIR && MM.isSolid && MM.isSolid(t)) return null; } return null; };
	let campX=null;
	for(let x=Math.floor(P.x)+120;x<Math.floor(P.x)+600 && campX==null;x++){
		const s=surfaceAt(x);
		if(s==null) continue;
		let flat=true;
		for(let dx=-2;dx<=4;dx++){ const n=surfaceAt(x+dx); if(n==null || n!==s){ flat=false; break; } }
		if(flat) campX=x;
	}
	if(campX==null) return {fatal:'no-flat-camp'};
	const groundY=surfaceAt(campX);
	window.__mmDebugHero(campX+0.5, groundY-1.1);
	await sleep(900);
	kd('c','KeyC'); ku('c','KeyC'); // camera snap: screen->tile clicks line up
	await sleep(400);
	window.inv.grass=(window.inv.grass|0)+60;
	await sleep(150);
	const cRect=rect(), cx=cRect.left+cRect.width/2, cy=cRect.top+cRect.height/2;
	const tileToScreen=(tx,ty)=>{ const t=tilePx(); return [cx+(tx+0.5-P.x)*t, cy+(ty+0.5-P.y)*t]; };
	// control probe on a separate cell: plain RMB placement must work at all
	{
		const [sx,sy]=tileToScreen(campX+3,groundY-1);
		pd(sx,sy,2); await sleep(150); pu(sx,sy); await sleep(200);
		if(gt(campX+3,groundY-1)!==T.GRASS) return {fatal:'staging-cannot-place'};
	}

	// --- 1. LMB on a free cell must NOT place ---------------------------------
	const aX=campX+2, aY=groundY-1;
	{
		const [sx,sy]=tileToScreen(aX,aY);
		pd(sx,sy,0); await sleep(250); pu(sx,sy); await sleep(250);
		R.lmbNoPlace={tile:gt(aX,aY), air:gt(aX,aY)===T.AIR};
	}

	// --- 2. RMB click places one block ----------------------------------------
	{
		const [sx,sy]=tileToScreen(aX,aY);
		pd(sx,sy,2); await sleep(150); pu(sx,sy); await sleep(200);
		R.rmbPlace={tile:gt(aX,aY), placed:gt(aX,aY)===T.GRASS};
	}

	// --- 3. RMB drag paints a line: a vertical tower on top of scene 2's block
	// (cells above ground stay clear of wandering mobs that could legitimately
	// block a ground-row cell and fake a stroke failure)
	{
		const [sx,sy]=tileToScreen(aX,aY-1);
		pd(sx,sy,2);
		await sleep(60);
		for(let i=1;i<=8;i++){
			const [mx,my]=tileToScreen(aX,aY-1-(i*0.3));
			pm(mx,my,2);
			await sleep(50);
		}
		const [ex,ey]=tileToScreen(aX,aY-3);
		pu(ex,ey);
		await sleep(250);
		let painted=0;
		for(let y=aY-3;y<=aY-1;y++) if(gt(aX,y)===T.GRASS) painted++;
		R.rmbStroke={painted};
	}

	// --- 4. LMB hold digs the tower's top block back out -----------------------
	{
		const topY=aY-3;
		const [sx,sy]=tileToScreen(aX,topY);
		pd(sx,sy,0);
		const t0=Date.now();
		while(Date.now()-t0<6000 && gt(aX,topY)===T.GRASS){ pm(sx,sy,1); await sleep(150); }
		pu(sx,sy);
		R.lmbMine={cleared:gt(aX,topY)!==T.GRASS};
	}
	R.frameMs=window.__mmFrameMs;
	return R;
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-build-stroke-qa-'));
	const proc = spawn(edge, ['--headless=new','--disable-gpu','--no-first-run','--hide-scrollbars','--force-device-scale-factor=1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--window-size=1600,900','about:blank'], { stdio: 'ignore' });
	let ws, failures = [];
	const check = (ok, label) => { if (ok) console.log('  ok:', label); else { failures.push(label); console.log('  FAIL:', label); } };
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
		const events = [], pageErrors = [];
		ws.onmessage = ev => {
			const m = JSON.parse(ev.data);
			if (m.id && pending.has(m.id)){ const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
			else if (m.method){
				events.push(m.method);
				if (m.method === 'Runtime.exceptionThrown'){ try { pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300)); } catch (e) { /* ignore */ } }
				if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error'){ try { pageErrors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200)); } catch (e) { /* ignore */ } }
			}
		};
		await send(ws, 'Page.enable');
		await send(ws, 'Runtime.enable');
		await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
		if (seed){
			await send(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: `
				const __origGEBI=Document.prototype.getElementById;
				Document.prototype.getElementById=function(id){
					const el=__origGEBI.call(this,id);
					if(id==='seedInput' && el && el.value==='auto') el.value=${JSON.stringify(seed)};
					return el;
				};` });
		}
		await send(ws, 'Page.navigate', { url });
		for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await sleep(250);
		await sleep(1500);
		// headless occlusion freezes rAF a few seconds in — keep fronting the page
		await send(ws, 'Page.bringToFront');
		const keepFront = setInterval(() => { send(ws, 'Page.bringToFront').catch(() => {}); }, 1500);
		let evalRes;
		try{
			evalRes = await send(ws, 'Runtime.evaluate', { expression: SCENE, awaitPromise: true, returnByValue: true, timeout: 120000 });
		} finally {
			clearInterval(keepFront);
		}
		const R = evalRes && evalRes.result ? evalRes.result.value : null;
		if (!R || R.fatal) throw new Error('scene failed: ' + (R && R.fatal || 'no result'));
		console.log('report:', JSON.stringify(R));

		console.log('button contract:');
		check(R.lmbNoPlace.air, 'LMB on a free cell places NOTHING');
		check(R.rmbPlace.placed, 'RMB click places one block');
		check(R.rmbStroke.painted >= 2, 'RMB drag paints a line (' + R.rmbStroke.painted + '/3 cells)');
		check(R.lmbMine.cleared, 'LMB hold digs the block back out');
		console.log('console:');
		check(pageErrors.length === 0, 'no console errors / uncaught exceptions' + (pageErrors.length ? ' -> ' + pageErrors.slice(0, 3).join(' | ') : ''));
	} finally {
		try { if (ws) ws.close(); } catch (e) { /* closing */ }
		await new Promise(res => {
			if (process.platform === 'win32'){
				const marker = profile.split(/[\\/]/).pop();
				execFile('powershell', ['-NoProfile', '-Command',
					`Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }`
				], () => res());
			} else { try { proc.kill(); } catch (e) { /* gone */ } res(); }
		});
	}
	if (failures.length){
		console.error('\nbuild-stroke-qa: ' + failures.length + ' failure(s)');
		process.exit(1);
	}
	console.log('\nbuild-stroke-qa: all live checks passed');
}
main().catch(err => { console.error('build-stroke-qa fatal:', err && err.message || err); process.exit(1); });
