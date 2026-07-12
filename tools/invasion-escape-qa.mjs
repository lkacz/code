#!/usr/bin/env node
// Headless-Edge live QA for invasion extraction + the relocated minimap.
// Boots the real game, sinks a squad down a sealed shaft and watches the world
// get them out — aliens on the saucer's tractor beam, kretoludzie by digging
// back up to their own tunnel mouth. Also frames the minimap in its new corner.
//   tools/invasion-escape-qa.png    minimap bottom-right on a normal PC frame
//   tools/invasion-escape-qa-b.png  an alien riding the beam out of the shaft
//   tools/invasion-escape-qa-c.png  a molekin surfacing near its burrow
// Usage: node tools/invasion-escape-qa.mjs [--url=http://127.0.0.1:8123/index.html]
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
	const hit = args.find(a => a.startsWith('--' + name + '='));
	return hit ? hit.slice(name.length + 3) : dflt;
};
const url = opt('url', 'http://127.0.0.1:8123/index.html');
const [winW, winH] = opt('size', '960x540').split('x').map(Number);
const outA = opt('out', 'tools/invasion-escape-qa.png');
const outB = outA.replace(/\.png$/, '-b.png');
const outC = outA.replace(/\.png$/, '-c.png');

const EDGE_CANDIDATES = [
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
];

let msgId = 0;
const pending = new Map();
// Every CDP call carries a deadline: a wedged Runtime.evaluate (a page pinned at
// 100% CPU, a promise that never settles) would otherwise hang the driver forever
// instead of failing with something you can read.
function send(ws, method, params, budget){
	const id = ++msgId;
	ws.send(JSON.stringify({ id, method, params: params || {} }));
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			pending.delete(id);
			reject(new Error('CDP timeout: ' + method));
		}, budget || 45000);
		pending.set(id, {
			resolve: v => { clearTimeout(timer); resolve(v); },
			reject: e => { clearTimeout(timer); reject(e); },
			method
		});
	});
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const HELPERS = `const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const T=(x,y)=>MM.world.getTile(x,y);
	const S=(x,y,t)=>MM.world.setTile(x,y,t);
	// Sink a sealed shaft under (sx) and drop the unit on its floor: solid rock all
	// around, a thick floor, and no line of sight to the hero. The shaft is 3 tiles
	// wide on purpose — a 1-wide slot leaves the unit permanently EMBEDDED in the
	// walls, which reads as "not on the ground" to the brain (and quietly hurts it),
	// so the trap timer drains instead of filling and the escape never fires.
	const sinkShaft=(sx,top,depth)=>{
		for(let x=sx-4;x<=sx+4;x++) for(let y=top;y<=top+depth+3;y++) S(x,y,3);   // STONE
		for(let x=sx-1;x<=sx+1;x++) for(let y=top;y<top+depth;y++) S(x,y,0);      // the shaft
		return {x:sx+0.5, y:top+depth-1};
	};`;

// Scene A: a plain frame — the minimap must be sitting in the bottom-right.
const STAGE_A = `(async()=>{ ${HELPERS}
	for(let i=0;i<400 && !(window.MM && window.player && MM.invasions && MM.world);i++) await sleep(100);
	if(!window.player) return 'boot-timeout';
	try{ MM.background.importState({cycleT:0.72}); }catch(e){}
	player.hp=player.maxHp;
	await sleep(1200);
	const c=document.getElementById('game');
	return ['A ok','canvas='+c.width+'x'+c.height,'minimap='+(typeof drawMinimap)].join(' :: ');
})()`;

// Scene B: aliens. Sink one down a sealed shaft and pull the extraction through the
// REAL host path (invasions._debug.beginExtraction — the same call the squad brain
// makes when it gives up). The brain-side trigger is proven deterministically by the
// Node suites; what has to be true HERE is that the live game beams the unit home.
const STAGE_B = `(async()=>{ ${HELPERS}
	MM.invasions.reset();
	const px=Math.floor(player.x);
	const teams=MM.invasions.forceNightInvasion(player,T,S,{day:6,teams:1,kind:'aliens',alienCount:2,forceVisible:true,immediate:true});
	const team=teams && teams[0];
	if(!team) return 'no-team';
	if(!team.lander || team.lander.destroyed) return 'no-lander';
	const a=team.aliens[0];
	const spot=sinkShaft(px+26, Math.floor(team.lander.y)+3, 16);
	a.x=spot.x; a.y=spot.y; a.vx=0; a.vy=0; a._ai=null;
	const startY=a.y, startX=a.x;
	const began=MM.invasions._debug.beginExtraction(team,a,{now:performance.now()},T,S,{});
	if(!began) return 'B FAILED :: the host refused a live saucer extraction';
	const kind=a.extract ? a.extract.kind : '';
	let sawBeam=false;
	const t0=Date.now();
	while(Date.now()-t0 < 30000 && a.extract){ await sleep(80); sawBeam=true; }
	await sleep(400);
	const dxShip=Math.abs(a.x-team.lander.x);
	const ok = !a.extract && a.y < startY-6 && dxShip < 12 && a.hp>0 && !a.dead;
	return ['B '+(ok?'ok':'FAILED'),'kind='+kind,'sawBeamFx='+sawBeam,
		'y '+startY.toFixed(1)+'->'+a.y.toFixed(1),'dxToShip='+dxShip.toFixed(1),'hp='+a.hp].join(' :: ');
})()`;

// Scene B-shot: catch a squadmate mid-beam — the column of light in frame.
const STAGE_B_SHOT = `(async()=>{ ${HELPERS}
	const team=MM.invasions._debug.teams[0];
	if(!team) return 'no-team';
	const a=team.aliens[1] || team.aliens[0];
	const px=Math.floor(player.x);
	const spot=sinkShaft(px+10, Math.floor(team.lander.y)+3, 12);
	a.x=spot.x; a.y=spot.y; a.vx=0; a.vy=0; a._ai=null; a.extract=null;
	// the camera rides the hero, so stand him over the shaft or the beam plays off-screen
	player.x=spot.x; player.vx=0;
	await sleep(500);
	MM.invasions._debug.beginExtraction(team,a,{now:performance.now()},T,S,{});
	const t0=Date.now();
	while(Date.now()-t0 < 20000){
		await sleep(60);
		if(a.extract && a.extract.phase==='out' && a.extract.t>0.35) break;
	}
	return ['B-shot','inTransit='+(!!a.extract),'phase='+(a.extract?a.extract.phase:'-')].join(' :: ');
})()`;

// Scene C: kretoludzie. No ship to call — they chew back up to their own tunnel mouth.
const STAGE_C = `(async()=>{ ${HELPERS}
	MM.invasions.reset();
	const px=Math.floor(player.x);
	const teams=MM.invasions.forceMolekinInvasion(player,T,S,{day:7,teams:1,alienCount:3,forceVisible:true,immediate:true});
	const team=teams && teams[0];
	if(!team || !team.burrow) return 'no-team';
	const mouthX=team.burrow.x;
	const a=team.aliens[0];
	const spot=sinkShaft(px+30, Math.floor(team.burrow.targetY)+4, 18);
	a.x=spot.x; a.y=spot.y; a.vx=0; a.vy=0; a._ai=null;
	const startY=a.y, startX=a.x, wasDx=Math.abs(startX-mouthX);
	const began=MM.invasions._debug.beginExtraction(team,a,{now:performance.now()},T,S,{});
	if(!began) return 'C FAILED :: the host refused a molekin dig-out';
	const kind=a.extract ? a.extract.kind : '';
	let sawDig=false;
	const t0=Date.now();
	while(Date.now()-t0 < 30000 && a.extract){ await sleep(80); sawDig=true; }
	await sleep(400);
	const dx=Math.abs(a.x-mouthX);
	// it must surface UP TOP and NEARER its own mouth than the hole it was stuck in
	const ok = !a.extract && a.y < startY-6 && dx < wasDx && dx <= 10 && a.hp>0 && !a.dead;
	return ['C '+(ok?'ok':'FAILED'),'kind='+kind,'sawDigFx='+sawDig,
		'y '+startY.toFixed(1)+'->'+a.y.toFixed(1),
		'dxToMouth '+wasDx.toFixed(1)+'->'+dx.toFixed(1),'hp='+a.hp].join(' :: ');
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-invqa-'));
	const proc = spawn(edge, [
		'--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
		'--force-device-scale-factor=1',
		'--remote-debugging-port=0',
		`--user-data-dir=${profile}`,
		`--window-size=${winW},${winH}`,
		'about:blank'
	], { stdio: 'ignore' });

	let ws;
	let failed = false;
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

		const run = async (label, expr, out) => {
			const r = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 140000 }, 150000);
			const v = r && r.result ? r.result.value : '(no result)';
			console.log(label + ':', v);
			if (String(v).includes('FAILED') || String(v).startsWith('no-') || String(v).includes('timeout')) failed = true;
			if (out){
				const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
				await writeFile(out, Buffer.from(shot.data, 'base64'));
				console.log('wrote', out);
			}
			return v;
		};

		await run('stage A', STAGE_A, outA);
		await run('stage B', STAGE_B, null);
		await run('stage B-shot', STAGE_B_SHOT, outB);
		await run('stage C', STAGE_C, outC);

		if (pageErrors.length) console.log('pageErrors:', pageErrors.slice(0, 3).join('\n---\n'));
		console.log(failed ? 'invasion-escape-qa: FAILED' : 'invasion-escape-qa: ALL SCENES OK');
	} finally {
		try { if (ws) ws.close(); } catch (e) { /* closing */ }
		try { proc.kill(); } catch (e) { /* already gone */ }
		await sleep(400);
		try { await rm(profile, { recursive: true, force: true }); } catch (e) { /* profile busy */ }
	}
	if (failed) process.exit(1);
}
main().catch(err => { console.error(err); process.exit(1); });
