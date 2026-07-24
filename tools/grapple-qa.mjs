#!/usr/bin/env node
// Headless-Edge live QA for the grapple hook (engine/grapple.js):
//   tools/grapple-qa.png    a fired hook anchored on a stone pillar (rope taut)
//   tools/grapple-qa-b.png  the reel dragged the hero across to the pillar
//   tools/grapple-qa-c.png  the "hakowe" tier is live + pinnable in the quiver
// Drives MM.grapple.fire() directly and lets the real rAF physics loop reel the
// hero — proving the self-movement seam + rope render work in-browser (the
// bow-fire divert itself is source-pinned in tools/grapple-sim.test.mjs).
// Usage: node tools/grapple-qa.mjs [--url=http://127.0.0.1:8123/index.html]
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
const outA = opt('out', 'tools/grapple-qa.png');
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
const HELPERS = `const sleep=ms=>new Promise(r=>setTimeout(r,ms));`;

// A: boot, carve a corridor to a tall stone pillar, fire a hook, confirm it bites.
const STAGE_A = `(async()=>{ ${HELPERS}
	for(let i=0;i<400 && !(window.MM && window.player && MM.grapple && MM.weapons && MM.world && MM.worldGen);i++) await sleep(100);
	if(!window.player) return 'boot-timeout';
	try{ MM.background.importState({cycleT:0.28}); }catch(e){}
	try{ MM.wind.setOverride(0); }catch(e){}
	const sx=Math.floor(player.x);
	const surf=MM.worldGen.surfaceHeight(sx);
	const wx=sx+13; // pillar 13 tiles to the right
	// clear a flat corridor at hero height so the hook flies clean
	for(let dx=-1;dx<=12;dx++){ for(let dy=-4;dy<=0;dy++) MM.world.setTile(sx+dx,surf-1+dy,0); MM.world.setTile(sx+dx,surf,8); }
	// a solid pillar to bite into
	for(let dy=-6;dy<=2;dy++) MM.world.setTile(wx,surf+dy,8);
	player.hp=player.maxHp; player.x=sx+0.5; player.y=surf-1.2; player.vx=0; player.vy=0;
	await sleep(500);
	const ok=MM.grapple.fire(player, wx+0.5, surf-1.4);
	// let the hook fly + bite
	for(let i=0;i<60 && !MM.grapple.anchored();i++) await sleep(16);
	const s=MM.grapple._debug.state();
	await sleep(200);
	return ['A ok','fired='+ok,'anchored='+MM.grapple.anchored(),'anchorTile='+s.atx+','+s.aty+' (wx='+wx+')','anchorSolid='+(MM.world.getTile(s.atx,s.aty)!==0),'heroX='+player.x.toFixed(2)].join(' :: ');
})()`;

// B: let the real physics loop reel the hero across to the pillar.
const STAGE_B = `(async()=>{ ${HELPERS}
	const s0=MM.grapple._debug.state();
	const anchorX=s0.ax;
	const x0=player.x;
	const d0=Math.abs(anchorX-x0);
	// the rAF loop runs physics() -> GRAPPLE.step each frame; just wait it out
	for(let i=0;i<120 && MM.grapple.isActive();i++) await sleep(16);
	const d1=Math.abs(anchorX-player.x);
	await sleep(200);
	return ['B ok','heroX '+x0.toFixed(2)+'->'+player.x.toFixed(2),'distToAnchor '+d0.toFixed(2)+'->'+d1.toFixed(2),'movedRight='+(player.x>x0+1),'stillActive='+MM.grapple.isActive()].join(' :: ');
})()`;

// C: the movement tier is live + pinnable in the real weapons module.
const STAGE_C = `(async()=>{ ${HELPERS}
	const tiers=MM.weapons._debug.arrowTiers;
	const gr=tiers.find(t=>t.id==='grapple');
	const pref=MM.weapons.setArrowPref('grapple');
	const info=MM.weapons.arrowInfo();
	const listed=info.tiers.find(t=>t.id==='grapple');
	MM.weapons.setArrowPref('auto');
	const autoInfo=MM.weapons.arrowInfo();
	return ['C ok','tierFlag='+(gr&&gr.grapple),'pref='+pref,'pinnedListed='+!!(listed&&listed.pinned),'autoNeverGrapple='+(autoInfo.activeId!=='grapple')].join(' :: ');
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-grapqa-'));
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
		const pageErrors = [];
		ws.onmessage = ev => {
			const m = JSON.parse(ev.data);
			if (m.id && pending.has(m.id)){
				const p = pending.get(m.id); pending.delete(m.id);
				if (m.error) p.reject(new Error(p.method + ': ' + JSON.stringify(m.error)));
				else p.resolve(m.result);
			} else if (m.method === 'Runtime.exceptionThrown'){
				try { pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 400)); } catch (e) { /* ignore */ }
			} else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error'){
				try { pageErrors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300)); } catch (e) { /* ignore */ }
			}
		};

		await send(ws, 'Page.enable');
		await send(ws, 'Runtime.enable');
		await send(ws, 'Emulation.setDeviceMetricsOverride', { width: winW, height: winH, deviceScaleFactor: 1, mobile: false });
		await send(ws, 'Page.navigate', { url });
		await sleep(2500);

		for (const [label, expr, out] of [['A', STAGE_A, outA], ['B', STAGE_B, outB], ['C', STAGE_C, outC]]){
			const r = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 120000 });
			console.log('stage ' + label + ':', r && r.result ? r.result.value : '(no result)');
			const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
			await writeFile(out, Buffer.from(shot.data, 'base64'));
			console.log('wrote', out);
		}

		if (pageErrors.length) console.log('pageErrors:', pageErrors.slice(0, 5).join('\n---\n'));
		else console.log('pageErrors: none');
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
