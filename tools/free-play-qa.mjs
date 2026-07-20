#!/usr/bin/env node
// Free-play QA: boots the REAL game in headless Edge (CDP, real rAF) and plays
// it the way a person does — watches the boot, walks, jumps, digs, builds,
// swaps to a weapon, hikes into fresh chunks — while measuring fps and
// asserting zero loop/console errors. Finishes with a save → reload round trip.
//
// The mechanics probes (jump / mine / place / save) run on flat dry grass found
// by scanning the world, so shoreline spawns don't turn physics quirks into
// false failures; the walk and hike stay organic from the true spawn.
//
// Usage: node tools/free-play-qa.mjs [--url=http://127.0.0.1:8123/index.html] [--seed=777]
import { spawn, execFile } from 'node:child_process';
import { writeFile, mkdtemp, readFile } from 'node:fs/promises';
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

const PLAY_SCRIPT = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const out=[];
	const ok=(cond,label)=>{ out.push((cond?'PASS':'FAIL')+' '+label); return cond; };
	const info=label=>out.push('INFO '+label);
	for(let i=0;i<400 && !(window.MM && window.player && window.inv && window.__mmDebugHero && MM.tasks && MM.world);i++) await sleep(100);
	if(!(window.MM && window.player)) return JSON.stringify({report:'boot-timeout'});
	await sleep(3000);
	const P=window.player;
	const T=MM.T;
	const getTile=(x,y)=>MM.world.getTile(x,y);
	const canvas=document.querySelector('canvas');
	const cw=canvas.clientWidth, ch=canvas.clientHeight, cx=cw/2, cy=ch/2;

	// --- boot sanity -------------------------------------------------------
	ok(Number.isFinite(P.x)&&Number.isFinite(P.y), 'player position finite ('+P.x.toFixed(1)+','+P.y.toFixed(1)+')');
	ok(P.hp>0 && Number.isFinite(P.hp), 'player alive at boot (hp '+P.hp+'/'+P.maxHp+')');
	ok(cw>0 && ch>0, 'canvas visible ('+cw+'x'+ch+')');
	ok(document.documentElement.getAttribute('data-input-mode')==='pc', 'desktop boots into pc input mode');
	ok(!(window.__mmLoopErrors>0), 'no loop errors during boot');

	// --- measured fps helper ----------------------------------------------
	const fps=async ms=>{ let n=0, stop=false; const t0=performance.now(); const tick=()=>{ n++; if(!stop) requestAnimationFrame(tick); }; requestAnimationFrame(tick); await sleep(ms); stop=true; return n*1000/(performance.now()-t0); };
	const idleFps=await fps(3000);
	ok(idleFps>=15, 'idle fps healthy for software rendering ('+idleFps.toFixed(0)+' fps)');

	// --- real input helpers -------------------------------------------------
	const kd=(key,code)=>window.dispatchEvent(new KeyboardEvent('keydown',{key,code,bubbles:true}));
	const ku=(key,code)=>window.dispatchEvent(new KeyboardEvent('keyup',{key,code,bubbles:true}));
	const pd=(x,y,btn)=>canvas.dispatchEvent(new PointerEvent('pointerdown',{pointerId:7,pointerType:'mouse',isPrimary:true,button:btn,buttons:btn===2?2:1,clientX:x,clientY:y,bubbles:true,cancelable:true}));
	const pm=(x,y)=>canvas.dispatchEvent(new PointerEvent('pointermove',{pointerId:7,pointerType:'mouse',isPrimary:true,clientX:x,clientY:y,bubbles:true}));
	const pu=(x,y)=>window.dispatchEvent(new PointerEvent('pointerup',{pointerId:7,pointerType:'mouse',isPrimary:true,clientX:x,clientY:y,bubbles:true}));
	const tilePx=()=>((MM.TILE||20)*((window.__mmRenderDetail&&window.__mmRenderDetail.zoom)||1));
	const invSum=()=>{ let s=0; for(const v of Object.values(window.inv)) if(typeof v==='number' && Number.isFinite(v)) s+=v; return s; };
	// Screen position of a world tile's centre, assuming the camera rests on the hero.
	const tileToScreen=(tx,ty)=>{ const t=tilePx(); return [cx+(tx+0.5-P.x)*t, cy+(ty+0.5-P.y)*t]; };

	// --- movement: hold D (then A) with jump taps, expect real displacement --
	const walk=async(key,code,ms)=>{ const x0=P.x; kd(key,code); const t0=performance.now(); let hops=0; while(performance.now()-t0<ms){ await sleep(400); if(++hops%2===0){ kd('w','KeyW'); await sleep(60); ku('w','KeyW'); } } ku(key,code); return P.x-x0; };
	const dxR=await walk('d','KeyD',2000);
	await sleep(400);
	const dxL=await walk('a','KeyA',2000);
	ok(Math.abs(dxR)>=1.5 || Math.abs(dxL)>=1.5, 'hero walks under held keys (right '+dxR.toFixed(1)+', left '+dxL.toFixed(1)+' tiles)');
	await sleep(600);

	// --- find flat dry grass near spawn for the deterministic mechanics probes
	const surfaceAt=x=>{ for(let y=-30;y<80;y++){ const t=getTile(x,y); if(t!==T.AIR && t!==T.WATER && MM.isSolid && MM.isSolid(t)) return {y,t}; if(t===T.WATER) return {y,t}; } return null; };
	const dryFlat=x=>{
		const s=surfaceAt(x);
		if(!s || (s.t!==T.GRASS && s.t!==T.DIRT && s.t!==T.SAND)) return null;
		for(let dx=-2;dx<=2;dx++){
			const n=surfaceAt(x+dx);
			if(!n || n.t===T.WATER || Math.abs(n.y-s.y)>1) return null;
			for(let dy=1;dy<=3;dy++) if(getTile(x+dx,n.y-dy)!==T.AIR) return null;
		}
		return s.y;
	};
	let campX=null, campY=null;
	for(let r=0;r<400 && campX==null;r++){ for(const x of [Math.round(P.x)+r, Math.round(P.x)-r]){ const y=dryFlat(x); if(y!=null){ campX=x; campY=y; break; } } }
	if(campX!=null){
		info('mechanics camp: flat dry ground at ('+campX+','+campY+') tile '+getTile(campX,campY));
		window.__mmDebugHero(campX+0.5, campY-1.1);
		await sleep(600); // let the hero settle
		kd('c','KeyC'); ku('c','KeyC'); // snap the camera onto the hero so screen->tile clicks line up
		await sleep(400);
	} else {
		info('no flat dry ground within 400 tiles of spawn; probing in place');
	}

	// --- jump: W press lifts the hero --------------------------------------
	let y0=P.y, minY=P.y;
	kd('w','KeyW');
	for(let i=0;i<12;i++){ await sleep(80); if(P.y<minY) minY=P.y; }
	ku('w','KeyW');
	ok(y0-minY>=0.5, 'hero jumps on W ('+(y0-minY).toFixed(2)+' tiles of lift)');
	await sleep(900);

	// --- mining: select tool, hold left button on a real surface tile -------
	kd('1','Digit1'); ku('1','Digit1');
	kd('c','KeyC'); ku('c','KeyC'); // jump testing may have drifted the camera
	await sleep(300);
	// aim at a REAL surface tile in reach (never the air above it)
	let digTarget=null;
	for(const candX of [Math.floor(P.x)+1, Math.floor(P.x)-1, Math.floor(P.x)]){
		const s=surfaceAt(candX);
		if(s && s.t!==T.WATER && Math.abs(candX+0.5-P.x)<=3 && Math.abs(s.y+0.5-P.y)<=3){ digTarget={x:candX,y:s.y}; break; }
	}
	if(!digTarget) digTarget={x:Math.floor(P.x), y:Math.floor(P.y)+2};
	const boxSnapshot=()=>{ const m={}; for(let dx=-2;dx<=2;dx++) for(let dy=-2;dy<=2;dy++){ m[(digTarget.x+dx)+','+(digTarget.y+dy)]=getTile(digTarget.x+dx,digTarget.y+dy); } return m; };
	const before=boxSnapshot();
	const invBefore=invSum();
	const [mineSX,mineSY]=tileToScreen(digTarget.x,digTarget.y);
	pd(mineSX,mineSY,0);
	for(let i=0;i<16;i++){ await sleep(300); pm(mineSX,mineSY); }
	pu(mineSX,mineSY);
	const after=boxSnapshot();
	let dug=0; for(const k in before) if(before[k]!==T.AIR && after[k]===T.AIR) dug++;
	const invGain=invSum()-invBefore;
	ok(dug>0, 'held click digs the aimed ground ('+dug+' tiles turned to air near '+digTarget.x+','+digTarget.y+')');
	ok(invGain>0, 'mining fills the backpack (+'+invGain+' resources)');

	// --- placement: pick a stocked hotbar slot, right-click the fresh hole --
	await sleep(500);
	const slots=[...document.querySelectorAll('.hotSlot')];
	const stocked=slots.findIndex(el=>{ const c=el.querySelector('.count'); return c && parseInt(c.textContent,10)>0; });
	if(stocked>=0){
		slots[stocked].click();
		await sleep(300);
		const invBeforePlace=invSum();
		let placed=false;
		outer: for(let dx=-2;dx<=2;dx++) for(let dy=-2;dy<=2;dy++){
			const tx=digTarget.x+dx, ty=digTarget.y+dy;
			if(getTile(tx,ty)!==T.AIR) continue;
			// needs solid support next to it for most placements
			if(![[1,0],[-1,0],[0,1],[0,-1]].some(([ax,ay])=>MM.isSolid && MM.isSolid(getTile(tx+ax,ty+ay)))) continue;
			const [sx,sy]=tileToScreen(tx,ty);
			pd(sx,sy,2); pu(sx,sy);
			await sleep(350);
			if(getTile(tx,ty)!==T.AIR || invSum()<invBeforePlace){ placed=true; break outer; }
		}
		ok(placed, 'right-click places a block from the hotbar (slot '+stocked+')');
		kd('1','Digit1'); ku('1','Digit1');
	} else {
		info('placement skipped: no stocked material slot after mining');
	}

	// --- weapon swap + fire gesture must stay error-free --------------------
	const errsBeforeWeapon=window.__mmLoopErrors||0;
	kd('2','Digit2'); ku('2','Digit2');
	await sleep(200);
	pd(cx+4*tilePx(),cy-3*tilePx(),0);
	await sleep(450);
	pu(cx+4*tilePx(),cy-3*tilePx());
	await sleep(300);
	kd('1','Digit1'); ku('1','Digit1');
	ok((window.__mmLoopErrors||0)===errsBeforeWeapon, 'weapon swap + fire gesture stays error-free');

	// --- hike into fresh chunks: fps must hold up under worldgen -----------
	const hikeX0=P.x;
	kd('d','KeyD');
	let hikeFrames=0, hikeStop=false; const hikeT0=performance.now();
	const hikeTick=()=>{ hikeFrames++; if(!hikeStop) requestAnimationFrame(hikeTick); };
	requestAnimationFrame(hikeTick);
	for(let i=0;i<10;i++){ await sleep(800); kd('w','KeyW'); await sleep(60); ku('w','KeyW'); }
	ku('d','KeyD');
	hikeStop=true;
	const hikeFps=hikeFrames*1000/(performance.now()-hikeT0);
	const hikeDx=P.x-hikeX0;
	ok(hikeFps>=12, 'fps holds during a chunk-loading hike ('+hikeFps.toFixed(0)+' fps)');
	ok(hikeDx>=3, 'the hike covers ground ('+hikeDx.toFixed(1)+' tiles)');
	ok(Number.isFinite(P.x)&&Number.isFinite(P.y)&&Number.isFinite(P.hp), 'player state stays finite after play');
	ok(!(window.__mmLoopErrors>0), 'zero game-loop errors across the session ('+(window.__mmLoopErrors||0)+')');

	// --- walk back to the camp so the save happens on known-solid ground ----
	if(campX!=null){ window.__mmDebugHero(campX+0.5, campY-1.1); await sleep(900); kd('c','KeyC'); ku('c','KeyC'); }
	const under=[]; for(let dy=0;dy<3;dy++) under.push(getTile(Math.floor(P.x), Math.floor(P.y+P.h/2)+dy));
	window.dispatchEvent(new Event('beforeunload'));
	await sleep(400);
	return JSON.stringify({report:out.join('\\n'), px:P.x, py:P.y, hp:P.hp, under});
})()`;

const RELOAD_CHECK = (px, py, hp, under) => `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const out=[];
	const ok=(cond,label)=>{ out.push((cond?'PASS':'FAIL')+' '+label); return cond; };
	for(let i=0;i<400 && !(window.MM && window.player && window.__mmDebugHero && MM.world);i++) await sleep(100);
	if(!(window.MM && window.player)) return 'boot-timeout';
	await sleep(2500);
	const P=window.player;
	const d=Math.hypot(P.x-(${px}), P.y-(${py}));
	ok(d<=1.5, 'save restores the hero where they stood (drift '+d.toFixed(2)+' tiles)');
	ok(P.hp>=(${hp})-0.5, 'reload costs no health ('+(${hp})+' -> '+P.hp+')');
	const under=[]; for(let dy=0;dy<3;dy++) under.push(MM.world.getTile(Math.floor(${px}), Math.floor((${py})+P.h/2)+dy));
	ok(JSON.stringify(under)===JSON.stringify(${JSON.stringify(under)}), 'ground under the saved spot persists ('+JSON.stringify(${JSON.stringify(under)})+' -> '+JSON.stringify(under)+')');
	ok(!(window.__mmLoopErrors>0), 'no loop errors after reload');
	return out.join('\\n');
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-freeplay-'));
	const proc = spawn(edge, [
		'--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
		'--force-device-scale-factor=1',
		// Newer headless Edge suspends rAF for pages it deems occluded/backgrounded
		// partway through long CDP sessions — the sim freezes silently mid-QA
		// (walks stop, jumps read 0.00, fps reads 0, yet zero loop errors). These
		// flags plus the bringToFront pump below keep frames flowing for the whole run.
		'--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
		'--disable-background-timer-throttling',
		'--remote-debugging-port=0',
		`--user-data-dir=${profile}`,
		'--window-size=1600,900',
		'about:blank'
	], { stdio: 'ignore' });
	let ws;
	let failures = 1;
	try {
		let target = null;
		for (let i = 0; i < 60 && !target; i++){
			await sleep(250);
			try {
				const portLine = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0].trim();
				if (!portLine) continue;
				const res = await fetch(`http://127.0.0.1:${portLine}/json/list`);
				const list = await res.json();
				target = list.find(t => t.type === 'page');
			} catch (e) { /* not up yet */ }
		}
		if (!target) throw new Error('DevTools endpoint never came up');
		ws = new WebSocket(target.webSocketDebuggerUrl);
		await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
		const pageErrors = [];
		const events = [];
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
				if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error'){
					try { pageErrors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300)); } catch (e) { /* ignore */ }
				}
			}
		};
		await send(ws, 'Page.enable');
		await send(ws, 'Runtime.enable');
		await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
		await send(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: `
			const __origGEBI=Document.prototype.getElementById;
			Document.prototype.getElementById=function(id){
				const el=__origGEBI.call(this,id);
				if(id==='seedInput' && el && el.value==='auto') el.value=${JSON.stringify(seed)};
				return el;
			};` });
		await send(ws, 'Page.navigate', { url });
		for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await sleep(250);
		await sleep(1500);
		// keep-front pump: re-front the page every 2s for the whole session so the
		// occlusion heuristic never suspends rAF mid-run (fire-and-forget sends)
		const pump = setInterval(() => { try { send(ws, 'Page.bringToFront').catch(() => {}); } catch (e) { /* closing */ } }, 2000);
		try {
		const evalRes = await send(ws, 'Runtime.evaluate', { expression: PLAY_SCRIPT, awaitPromise: true, returnByValue: true, timeout: 300000 });
		let payload = null;
		try { payload = JSON.parse(evalRes && evalRes.result ? String(evalRes.result.value) : 'null'); } catch (e) { /* fall through */ }
		const report = payload && payload.report ? payload.report : '(no result)';
		console.log(report);
		failures = (report.match(/^FAIL /gm) || []).length + (report.includes('boot-timeout') ? 1 : 0);
		const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
		await writeFile('tools/free-play-qa.png', Buffer.from(shot.data, 'base64'));
		console.log('wrote tools/free-play-qa.png');

		// Reload round trip: the save written on beforeunload must restore the hero.
		if (payload && Number.isFinite(payload.px)){
			await send(ws, 'Page.navigate', { url });
			await sleep(2500);
			const reload = await send(ws, 'Runtime.evaluate', { expression: RELOAD_CHECK(payload.px, payload.py, payload.hp, payload.under), awaitPromise: true, returnByValue: true, timeout: 120000 });
			const reloadReport = reload && reload.result ? String(reload.result.value) : '(no result)';
			console.log(reloadReport);
			failures += (reloadReport.match(/^FAIL /gm) || []).length + (reloadReport.includes('boot-timeout') ? 1 : 0);
			const shotB = await send(ws, 'Page.captureScreenshot', { format: 'png' });
			await writeFile('tools/free-play-qa-b.png', Buffer.from(shotB.data, 'base64'));
			console.log('wrote tools/free-play-qa-b.png');
		} else {
			console.log('FAIL free-play payload missing; reload round trip skipped');
			failures += 1;
		}
		if (pageErrors.length){
			console.log('pageErrors:', pageErrors.slice(0, 6).join('\n---\n'));
			failures += pageErrors.length;
		}
		} finally { clearInterval(pump); }
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
	}
	process.exit(failures ? 1 : 0);
}
main().catch(err => { console.error(err); process.exit(1); });
