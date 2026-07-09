#!/usr/bin/env node
// Headless-Edge live QA for player-built mechs (engine/mechs.js built section):
//   tools/built-mech-qa.png    hero auto-seated in a freshly assembled machine
//   tools/built-mech-qa-b.png  driving right on D (reserve/coal/hero energy)
//   tools/built-mech-qa-c.png  jump parked the mech back into world blocks
//   tools/built-mech-qa-d.png  E on the parked chair re-assembles immediately
// Usage: node tools/built-mech-qa.mjs [--url=http://127.0.0.1:8123/index.html]
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
const outA = opt('out', 'tools/built-mech-qa.png');
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

const HELPERS = `const sleep=ms=>new Promise(r=>setTimeout(r,ms));`;

// Build a coal-dynamo crawler on flattened ground right of the hero, then stand
// the hero in the chair: the physics loop must auto-assemble and seat him.
const STAGE_A = `(async()=>{ ${HELPERS}
	for(let i=0;i<400 && !(window.MM && window.player && MM.mechs && MM.world && MM.worldGen);i++) await sleep(100);
	if(!window.player) return 'boot-timeout';
	try{ MM.background.importState({cycleT:0.30}); }catch(e){}
	const T=MM.T;
	// build away from spawn: the tutorial NPC otherwise consumes the E key
	player.x+=420; player.y=MM.worldGen.surfaceHeight(Math.floor(player.x))-2; player.vx=0; player.vy=0;
	await sleep(900);
	const sx=Math.floor(player.x);
	const surf=MM.worldGen.surfaceHeight(sx);
	const bx=sx+6;
	// flat pad + clear air above the build site
	for(let x=bx-2;x<=bx+6;x++){
		MM.world.setTile(x,surf,T.STONE);
		for(let y=surf-9;y<surf;y++) MM.world.setTile(x,y,T.AIR);
	}
	// machine: tracks / dynamo+coal row / steel hull / steel chair on top
	for(let x=bx;x<=bx+3;x++) MM.world.setTile(x,surf-1,T.TRACK);
	MM.world.setTile(bx,surf-2,T.DYNAMO);
	MM.world.setTile(bx+1,surf-2,T.DYNAMO_SLOT);
	MM.world.setTile(bx+2,surf-2,T.DYNAMO);
	MM.world.setTile(bx+3,surf-2,T.COAL);
	for(let x=bx;x<=bx+3;x++) MM.world.setTile(x,surf-3,T.STEEL);
	MM.world.setTile(bx+1,surf-4,T.CHAIR_STEEL);
	inv.coal=Math.max(inv.coal||0,8);
	player.energy=Math.max(player.energy||0,60);
	player.hp=player.maxHp;
	player.x=bx+1.5; player.y=surf-4+0.30; player.vx=0; player.vy=0;
	await sleep(1400);
	const m=MM.mechs.metrics();
	const hero=MM.mechs.heroMech();
	window.__qaMech=hero;
	return ['A '+(m.built===1 && m.ridden ? 'ok' : 'FAIL'),
		'metrics='+JSON.stringify(m),
		'kind='+(hero&&hero.kind),'cells='+(hero&&hero.cells.length),
		'chairCarved='+(MM.world.getTile(bx+1,surf-4)===T.AIR)].join(' :: ');
})()`;

const STAGE_B = `(async()=>{ ${HELPERS}
	const m=window.__qaMech;
	if(!m) return 'B FAIL :: no mech';
	// live proof of the unified dynamo: water flow recorded at the mech slot
	// through the ONE shared DYNAMO.recordFlow lands in the hull battery
	const slot=m.cells.find(c=>c.t===MM.T.DYNAMO_SLOT);
	const before=m.energy;
	let flowOk=0;
	if(slot){
		for(let i=0;i<6;i++){
			if(MM.dynamo.recordFlow(Math.floor(m.x+slot.dx),Math.floor(m.y+slot.dy),MM.T.WATER,3,(x,y)=>MM.world.getTile(x,y))) flowOk++;
		}
	}
	const x0=m.x, e0=player.energy, r0=m.energy;
	window.__qaDrive={x0,e0,r0};
	return ['B armed','flowEvents='+flowOk,'reserve '+before.toFixed(1)+'->'+m.energy.toFixed(1)+' (recordFlow)',
		'x0='+x0.toFixed(2)+' heroE='+e0.toFixed(1)].join(' :: ');
})()`;

const STAGE_B2 = `(async()=>{ ${HELPERS}
	const m=window.__qaMech, d=window.__qaDrive;
	if(!m||!d) return 'B2 FAIL :: no mech';
	const moved=m.x-d.x0;
	return ['B '+(moved>1 ? 'ok' : 'FAIL'),
		'moved='+moved.toFixed(2),
		'heroE '+d.e0.toFixed(1)+'->'+player.energy.toFixed(1),
		'reserve '+d.r0.toFixed(1)+'->'+m.energy.toFixed(1)].join(' :: ');
})()`;

const STAGE_C = `(async()=>{ ${HELPERS}
	const T=MM.T;
	const m=window.__qaMech;
	if(!m) return 'C FAIL :: no mech';
	await sleep(900); // let the eject hop land
	const met=MM.mechs.metrics();
	const px=Math.floor(player.x), py=Math.floor(player.y);
	let tracks=0, chairs=0, dynamos=0;
	for(let x=px-8;x<=px+8;x++) for(let y=py-6;y<=py+8;y++){
		const t=MM.world.getTile(x,y);
		if(t===T.TRACK) tracks++;
		if(t===T.CHAIR_STEEL) chairs++;
		if(t===T.DYNAMO) dynamos++;
	}
	const reseated=MM.mechs.heroMech();
	return ['C '+(met.count===0 && tracks>=4 && chairs>=1 && !reseated ? 'ok' : 'FAIL'),
		'metrics='+JSON.stringify(met),
		'parked tracks='+tracks+' chairs='+chairs+' dynamos='+dynamos,
		'autoReseated='+!!reseated].join(' :: ');
})()`;

// jump-eject can buffer one extra hero hop (space still held for a frame);
// wait until he has settled back into the parked chair before E — and if he
// bounced off it, step him back onto the chair like a player would.
const WAIT_SEATED_READY = `(async()=>{ ${HELPERS}
	const onChair=()=>{
		const t=MM.world.getTile(Math.floor(player.x),Math.floor(player.y));
		return player.onGround && MM.INFO[t] && MM.INFO[t].chair;
	};
	for(let i=0;i<20;i++){
		if(onChair()) return 'ready :: onGround chair';
		await sleep(100);
	}
	// landed off the seat: find the parked chair nearby and step back in
	const px=Math.floor(player.x), py=Math.floor(player.y);
	for(let dy=-6;dy<=6;dy++) for(let dx=-8;dx<=8;dx++){
		const t=MM.world.getTile(px+dx,py+dy);
		if(MM.INFO[t] && MM.INFO[t].chair){
			player.x=px+dx+0.5; player.y=py+dy+0.30; player.vx=0; player.vy=0;
			await sleep(400);
			return (onChair()?'ready':'not-settled')+' :: stepped back to chair '+(px+dx)+','+(py+dy);
		}
	}
	return 'not-settled :: no chair found near '+px+','+py;
})()`;

const INSTRUMENT = `(()=>{
	window.__qaLog=[];
	const wik=MM.mechs.wantsInteractKey;
	MM.mechs.wantsInteractKey=function(p){
		let r,err=null;
		try{ r=wik.apply(this,arguments); }catch(ex){ err=String(ex&&ex.message||ex); }
		window.__qaLog.push({fn:'wik',r,err,hasPlayer:!!p});
		if(err) throw new Error(err);
		return r;
	};
	const tb=MM.mechs.toggleBoard;
	MM.mechs.toggleBoard=function(){
		const r=tb.apply(this,arguments);
		window.__qaLog.push({fn:'toggleBoard',r});
		return r;
	};
	if(MM.inventoryUI && MM.inventoryUI.toggle){
		const tg=MM.inventoryUI.toggle;
		MM.inventoryUI.toggle=function(){ window.__qaLog.push({fn:'invToggle'}); return tg.apply(this,arguments); };
	}
	window.addEventListener('keydown',e=>{ if(e.key==='e') window.__qaLog.push({fn:'keydownE',target:(e.target&&e.target.tagName)||String(e.target)}); },true);
	return 'instrumented';
})()`;

const STAGE_D = `(async()=>{ ${HELPERS}
	await sleep(500);
	const m=MM.mechs.heroMech();
	const met=MM.mechs.metrics();
	return ['D '+(m && met.built===1 ? 'ok' : 'FAIL'),
		'E-reseat metrics='+JSON.stringify(met),
		'invOpen='+!!(MM.inventoryUI && MM.inventoryUI.isOpen && MM.inventoryUI.isOpen()),
		'log='+JSON.stringify((window.__qaLog||[]).slice(-10))].join(' :: ');
})()`;

async function holdKey(ws, key, code, keyCode, ms){
	await send(ws, 'Input.dispatchKeyEvent', { type:'rawKeyDown', key, code, windowsVirtualKeyCode:keyCode, nativeVirtualKeyCode:keyCode });
	const step=120;
	for(let t=0;t<ms;t+=step){
		await sleep(step);
		await send(ws, 'Input.dispatchKeyEvent', { type:'rawKeyDown', key, code, windowsVirtualKeyCode:keyCode, nativeVirtualKeyCode:keyCode, autoRepeat:true });
	}
	await send(ws, 'Input.dispatchKeyEvent', { type:'keyUp', key, code, windowsVirtualKeyCode:keyCode, nativeVirtualKeyCode:keyCode });
}

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-mechqa-'));
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

		const evalStage = async (label, expr, out) => {
			const r = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 120000 });
			console.log('stage ' + label + ':', r && r.result ? r.result.value : '(no result)');
			if (out){
				const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
				await writeFile(out, Buffer.from(shot.data, 'base64'));
				console.log('wrote', out);
			}
		};

		await evalStage('A', STAGE_A, outA);
		await evalStage('A-instrument', INSTRUMENT, null);
		await evalStage('B-arm', STAGE_B, null);
		await holdKey(ws, 'd', 'KeyD', 68, 2400);      // drive right
		await evalStage('B', STAGE_B2, outB);
		await holdKey(ws, ' ', 'Space', 32, 250);       // jump = park
		await evalStage('C', STAGE_C, outC);
		await evalStage('C-settle', WAIT_SEATED_READY, null);
		// stepping back onto the chair may already auto-seat (equivalent player
		// path); only send E when still parked so it re-assembles, not re-parks
		const riding = await send(ws, 'Runtime.evaluate', { expression: '!!MM.mechs.heroMech()', returnByValue: true });
		if (!(riding && riding.result && riding.result.value === true)){
			await holdKey(ws, 'e', 'KeyE', 69, 150);      // E on parked chair = re-assemble
		} else {
			console.log('stage D-entry: already auto-seated after stepping back on the chair');
		}
		await evalStage('D', STAGE_D, outD);

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
