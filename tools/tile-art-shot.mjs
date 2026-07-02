#!/usr/bin/env node
// Headless-Edge screenshot driver for reviewing in-game tile art.
// Boots the game over CDP (real requestAnimationFrame — no virtual time, which
// freezes rAF), stages a deterministic scene (noon light, fog revealed, HUD
// hidden, optional hero teleport via window.__mmDebugHero) and captures a PNG.
//
// Usage:
//   node tools/tile-art-shot.mjs <out.png> [--scene=surface|cave|dusk] [--url=http://localhost:8127/index.html]
//                                [--x=<tileX>] [--y=<tileY>] [--settle=<ms>] [--size=1600x900]
import { spawn, execFile } from 'node:child_process';
import { writeFile, mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const out = args.find(a => !a.startsWith('--')) || 'tile-art-shot.png';
const opt = (name, dflt) => {
	const hit = args.find(a => a.startsWith('--' + name + '='));
	return hit ? hit.slice(name.length + 3) : dflt;
};
const scene = opt('scene', 'surface');
// 127.0.0.1, not localhost: http-server binds IPv4 only and headless Edge may
// resolve localhost to ::1 and give ERR_CONNECTION_REFUSED
const url = opt('url', 'http://127.0.0.1:8123/index.html');
const settleMs = +opt('settle', 3500);
const [winW, winH] = opt('size', '1600x900').split('x').map(Number);
const forceX = opt('x', null), forceY = opt('y', null);
const zoomSteps = +opt('zoom', 0); // >0 zoom in N notches, <0 zoom out

const EDGE_CANDIDATES = [
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
];

let msgId = 0;
const pending = new Map();
function send(ws, method, params, sessionId){
	const id = ++msgId;
	ws.send(JSON.stringify({ id, method, params: params || {}, sessionId }));
	return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Scene staging code evaluated inside the page. Returns a status string.
function sceneScript(){
	const common = `
		const sleep=ms=>new Promise(r=>setTimeout(r,ms));
		for(let i=0;i<400 && !(window.MM && MM.background && MM.fog && window.__mmDebugHero);i++) await sleep(100);
		if(!(window.MM && MM.background && MM.fog)) return 'boot-timeout(mm='+!!window.MM+' bg='+!!(window.MM&&MM.background)+' fog='+!!(window.MM&&MM.fog)+' hero='+!!window.__mmDebugHero+')';
		${opt('setflag','').split(',').filter(Boolean).map(f=>`window.${f}=true;`).join('')}
		MM.fog.setRevealAll(true);
		const ui=document.getElementById('ui'); if(ui) ui.style.display='none';
		for(let z=0; z<Math.abs(${zoomSteps}); z++) window.dispatchEvent(new KeyboardEvent('keydown',{key:${zoomSteps}>0?'+':'-'}));
	`;
	if (scene === 'cave') return `(async()=>{ ${common}
		MM.background.importState({cycleT:0.25});
		// jump underground, let chunks generate, then center on a real cave pocket
		let hx=${forceX ?? 30}, hy=${forceY ?? 100};
		window.__mmDebugHero(hx,hy);
		await sleep(1200);
		const peek=(x,y)=>{ try{ return MM.world.peekTile(x,y,0); }catch(e){ return 0; } };
		let best=null;
		for(let x=hx-40;x<=hx+40 && !best;x++){
			for(let y=78;y<=128;y++){
				if(peek(x,y)===0 && peek(x,y+1)===0 && peek(x,y+2)===0 && peek(x-1,y)===0 && peek(x+1,y)===0 && peek(x,y+3)!==0){ best={x,y:y+2}; break; }
			}
		}
		if(best) window.__mmDebugHero(best.x,best.y);
		await sleep(${settleMs});
		return 'ok:cave '+JSON.stringify(best);
	})()`;
	const place = forceX != null
		? `const hx=${forceX}; const hy=${forceY ?? '(MM.worldGen && MM.worldGen.surfaceHeight ? MM.worldGen.surfaceHeight(hx)-1.2 : 50)'}; window.__mmDebugHero(hx,hy);`
		: (forceY != null ? `window.__mmDebugHero(undefined,${forceY});` : '');
	if (scene === 'idleperf') return `(async()=>{ ${common}
		MM.background.importState({cycleT:0.25});
		// park on an ocean shore (water sim active, chunk borders crossing water)
		// and sample steady-state frame cost + chunk rebuild pressure
		let ox=${forceX ?? 'null'};
		if(ox==null && MM.worldGen && MM.worldGen.surfaceHeight){
			for(let x=0;x<3000 && ox==null;x+=8){ if(MM.worldGen.surfaceHeight(x)>68) ox=x; if(MM.worldGen.surfaceHeight(-x)>68) ox=-x; }
			ox=ox==null?0:ox;
		}
		window.__mmDebugHero(ox, MM.worldGen && MM.worldGen.surfaceHeight ? MM.worldGen.surfaceHeight(ox)-3 : 50);
		await sleep(${settleMs});
		let n=0, sum=0, max=0, rebuilt=0, partial=0;
		for(let i=0;i<30;i++){
			await sleep(100);
			const p=window.__mmPerf;
			if(p && Number.isFinite(p.drawMs)){ n++; sum+=p.drawMs; max=Math.max(max,p.drawMs); if(p.chunks){ rebuilt+=p.chunks.rebuilt||0; partial+=p.chunks.partial||0; } }
		}
		return 'ok:idleperf x='+ox+' avgDrawMs='+(n?(sum/n).toFixed(1):'?')+' maxDrawMs='+max.toFixed(1)+' rebuiltSamples='+rebuilt+' partialSamples='+partial+' n='+n;
	})()`;
	if (scene === 'jump') return `(async()=>{ ${common}
		MM.background.importState({cycleT:0.25});
		await sleep(${settleMs});
		// simulate the debug-travel 1000-tile relocation, then watch frame recovery
		const hx=(${forceX ?? 1000});
		window.__mmDebugHero(hx, MM.worldGen && MM.worldGen.surfaceHeight ? MM.worldGen.surfaceHeight(hx)-1.2 : 50);
		window.__mmBakeStats=null;
		const frames=[]; let t0=performance.now(), n0=0;
		// sample per-frame times via rAF for ~6s
		await new Promise(done=>{ const tick=()=>{ const t=performance.now(); frames.push(t-t0); t0=t; if(frames.length<360 && t-0<1e12 && frames.length<360){ if((performance.now()) - (frames.__start||(frames.__start=performance.now())) < 6000) requestAnimationFrame(tick); else done(); } else done(); }; requestAnimationFrame(tick); });
		frames.shift();
		const avg=frames.reduce((a,b)=>a+b,0)/Math.max(1,frames.length);
		const worst=Math.max(...frames);
		const slow=frames.filter(f=>f>50).length;
		// sample the engine's own sim/draw split for another 3s
		let simS=0, drawS=0, ns=0;
		for(let i=0;i<15;i++){ await sleep(200); const q=window.__mmPerf; if(q && Number.isFinite(q.simMs)){ simS+=q.simMs; drawS+=q.drawMs; ns++; } }
		const p=window.__mmPerf||{}; const bs=window.__mmBakeStats;
		return 'ok:jump frames='+frames.length+' avgMs='+avg.toFixed(1)+' worstMs='+worst.toFixed(0)+' over50ms='+slow
			+' simAvg='+(ns?(simS/ns).toFixed(1):'?')+' drawAvg='+(ns?(drawS/ns).toFixed(1):'?')
			+' cache='+(p.chunks?p.chunks.cache:'?')
			+(bs?' bake{full:'+bs.fullN+' avg:'+(bs.fullMs/Math.max(1,bs.fullN)).toFixed(1)+' max:'+bs.fullMax.toFixed(0)+' partial:'+bs.partN+'}':'');
	})()`;
	if (scene === 'probe') return `(async()=>{ ${common}
		MM.background.importState({cycleT:0.25});
		${forceX!=null ? `window.__mmDebugHero(${forceX}, MM.worldGen && MM.worldGen.surfaceHeight ? MM.worldGen.surfaceHeight(${forceX})-3 : 50);` : ''}
		await sleep(${settleMs});
		const snap=()=>{ const m={}; try{ for(const [k,v] of MM.world._versions.entries()) m[k]=v; }catch(e){} return m; };
		const a=snap();
		let frames0=0; const t0=performance.now();
		await sleep(2000);
		const b=snap();
		const diff=[];
		for(const k in b){ if(b[k]!==(a[k]||0)) diff.push(k+':'+(a[k]||0)+'->'+b[k]); }
		const p=window.__mmPerf||{};
		return 'ok:probe changed='+diff.length+' '+JSON.stringify(diff.slice(0,20))+' lastFrame='+JSON.stringify({draw:p.drawMs,chunks:p.chunks})+' bake='+JSON.stringify(window.__mmBakeDebug||{});
	})()`;
	if (scene === 'perf') return `(async()=>{ ${common}
		MM.background.importState({cycleT:0.25});
		// hop across fresh terrain so every frame rebakes chunk canvases; report peak draw time
		let peak=0, samples=[];
		for(let hop=0; hop<12; hop++){
			const hx=${forceX ?? 0}+hop*160;
			window.__mmDebugHero(hx, MM.worldGen && MM.worldGen.surfaceHeight ? MM.worldGen.surfaceHeight(hx)-1.2 : 50);
			await sleep(320);
			const p=window.__mmPerf;
			if(p && Number.isFinite(p.drawMs)){ peak=Math.max(peak,p.drawMs); samples.push(+p.drawMs.toFixed(1)); }
		}
		const bs=window.__mmBakeStats;
		return 'ok:perf peakDrawMs='+peak.toFixed(1)+' samples='+JSON.stringify(samples)
			+(bs?' bake{full:'+bs.fullN+' avg:'+(bs.fullMs/Math.max(1,bs.fullN)).toFixed(1)+'ms max:'+bs.fullMax.toFixed(1)+' partial:'+bs.partN+' pAvg:'+(bs.partMs/Math.max(1,bs.partN)).toFixed(2)+'}':'');
	})()`;
	if (scene === 'dusk') return `(async()=>{ ${common}
		MM.background.importState({cycleT:0.47});
		${place}
		await sleep(${settleMs});
		return 'ok:dusk';
	})()`;
	return `(async()=>{ ${common}
		MM.background.importState({cycleT:0.25});
		${place}
		await sleep(${settleMs});
		return 'ok:surface';
	})()`;
}

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-shot-'));
	// port 0 + DevToolsActivePort file: a fixed port silently attaches to a
	// LEFTOVER browser from a previous run (accumulating localStorage/autosave
	// state and leaking processes) whenever the old instance still holds it
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
		// wait for OUR instance to publish its DevTools endpoint
		let targets = null;
		for (let i = 0; i < 60 && !targets; i++){
			await sleep(250);
			try {
				const portLine = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0].trim();
				if (!portLine) continue;
				const res = await fetch(`http://127.0.0.1:${portLine}/json/list`);
				const list = await res.json();
				targets = list.find(t => t.type === 'page');
			} catch (e) { /* not up yet */ }
		}
		if (!targets) throw new Error('DevTools endpoint never came up');

		ws = new WebSocket(targets.webSocketDebuggerUrl);
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
		// headless=new can ignore --window-size; force the viewport explicitly
		await send(ws, 'Emulation.setDeviceMetricsOverride', { width: winW, height: winH, deviceScaleFactor: 1, mobile: false });
		const seed = opt('seed', '');
		if (seed){
			// worldgen randomizes the seed at module load when #seedInput says "auto";
			// intercept the lookup so every run generates the same world
			await send(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: `
				const __origGEBI=Document.prototype.getElementById;
				Document.prototype.getElementById=function(id){
					const el=__origGEBI.call(this,id);
					if(id==='seedInput' && el && el.value==='auto') el.value=${JSON.stringify(seed)};
					return el;
				};` });
		}
		await send(ws, 'Page.navigate', { url });
		// allow module load + first world bake
		for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await sleep(250);
		await sleep(1500);

		const evalRes = await send(ws, 'Runtime.evaluate', {
			expression: sceneScript(), awaitPromise: true, returnByValue: true, timeout: 120000
		});
		const status = evalRes && evalRes.result ? evalRes.result.value : '(no result)';
		console.log('scene:', status);

		// --cpuprofile=<seconds>: capture a JS CPU profile of the live game after
		// the scene settles and print the top functions by self time
		const profSec = +opt('cpuprofile', 0);
		if (profSec > 0){
			await send(ws, 'Profiler.enable');
			await send(ws, 'Profiler.setSamplingInterval', { interval: 200 });
			await send(ws, 'Profiler.start');
			await sleep(profSec * 1000);
			const prof = await send(ws, 'Profiler.stop');
			const nodes = prof.profile.nodes;
			const byId = new Map(nodes.map(n => [n.id, n]));
			const hits = new Map();
			for (const n of nodes){
				if (!n.hitCount) continue;
				const f = n.callFrame;
				const name = (f.functionName || '(anon)') + ' @' + (f.url || '').split('/').pop() + ':' + (f.lineNumber + 1);
				hits.set(name, (hits.get(name) || 0) + n.hitCount);
			}
			const totalHits = [...hits.values()].reduce((a, b) => a + b, 0) || 1;
			const top = [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22);
			console.log('cpuprofile: total samples=' + totalHits + ' over ' + profSec + 's');
			for (const [name, n] of top) console.log('  ' + (100 * n / totalHits).toFixed(1).padStart(5) + '%  ' + name);
		}
		if (pageErrors.length) console.log('pageErrors:', pageErrors.slice(0, 5).join('\n---\n'));

		const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
		await writeFile(out, Buffer.from(shot.data, 'base64'));
		console.log('wrote', out);
	} finally {
		try { if (ws) ws.close(); } catch (e) { /* closing */ }
		// On Windows the Edge launcher exits after spawning the real browser tree,
		// so PID/tree kills miss it — sweep every process holding OUR unique
		// profile dir (leaks otherwise accumulate hundreds of headless processes)
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
