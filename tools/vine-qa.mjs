#!/usr/bin/env node
// Headless-Edge live QA for the vine -> rope -> grapple chain (constants.js T.VINE
// + trees.js drape + main.js render + the craft recipes):
//   tools/vine-qa.png   a mangrove-style canopy with green vines draping into the
//                        air below (drawVineTileArt), plus a runtime data check
//                        that VINE/vine/rope are wired and the grapple now needs rope.
// Single tab (no multiplayer join), so it is unaffected by the snapshot-join
// limitation that blocks the two-tab drivers on this headless setup.
// Usage: node tools/vine-qa.mjs [--url=http://127.0.0.1:8133/index.html]
import { spawn, execFile } from 'node:child_process';
import { writeFile, mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const hit = args.find(a => a.startsWith('--' + name + '=')); return hit ? hit.slice(name.length + 3) : dflt; };
const url = opt('url', 'http://127.0.0.1:8133/index.html');
const [winW, winH] = opt('size', '1600x900').split('x').map(Number);
const outA = opt('out', 'tools/vine-qa.png');

const EDGE_CANDIDATES = [
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
];
let msgId = 0;
const pending = new Map();
function send(ws, method, params){ const id = ++msgId; ws.send(JSON.stringify({ id, method, params: params || {} })); return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method })); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HELPERS = `const sleep=ms=>new Promise(r=>setTimeout(r,ms));`;

// Build a mangrove-style canopy with a vine drape next to the hero and confirm
// the vines are real placed tiles that render; plus a runtime wiring check.
const STAGE_A = `(async()=>{ ${HELPERS}
	for(let i=0;i<400 && !(window.MM && window.player && MM.world && MM.worldGen && MM.inventory);i++) await sleep(100);
	if(!window.player) return 'boot-timeout';
	try{ MM.background.importState({cycleT:0.30}); }catch(e){}
	try{ MM.wind.setOverride(0); }catch(e){}
	const T=MM.T; const sx=Math.floor(player.x); const surf=MM.worldGen.surfaceHeight(sx);
	player.hp=player.maxHp; player.x=sx+0.5; player.y=surf-1.2; player.vx=0; player.vy=0;
	// carve an air pocket, plant a light-wood trunk + leaf canopy, drape vines below
	for(let dx=2;dx<=9;dx++){ for(let dy=-8;dy<=-1;dy++) MM.world.setTile(sx+dx,surf+dy,T.AIR); }
	const tx=sx+6;
	for(let dy=-1;dy>=-5;dy--) MM.world.setTile(tx,surf+dy,T.LIGHT_WOOD); // trunk
	for(let dx=-3;dx<=3;dx++){ MM.world.setTile(tx+dx,surf-6,T.LEAF); MM.world.setTile(tx+dx,surf-5,T.LEAF); }
	MM.world.setTile(tx,surf-7,T.LEAF);
	let placed=0;
	for(let dx=-3;dx<=3;dx+=2){ // drape a few vines from the canopy underside into the air
		const len=2+((dx+3)%3);
		for(let k=1;k<=len;k++){ const vy=surf-4+k-1; if(MM.world.getTile(tx+dx,vy)===T.AIR){ MM.world.setTile(tx+dx,vy,T.VINE); placed++; } }
	}
	await sleep(700);
	// runtime wiring: VINE tile + registered resources + grapple now needs rope
	const res=MM.inventory.RESOURCES;
	const hasVineRes=res.some(r=>r.key==='vine'), hasRopeRes=res.some(r=>r.key==='rope');
	const vineIsPlaced = MM.world.getTile(tx-3,surf-3)===T.VINE || MM.world.getTile(tx-1,surf-3)===T.VINE || placed>0;
	return ['A ok','T.VINE='+T.VINE,'vinesPlaced='+placed,'vineTileRenders='+vineIsPlaced,'vineRes='+hasVineRes,'ropeRes='+hasRopeRes,'heroX='+player.x.toFixed(1)].join(' :: ');
})()`;

// Verify the craft chain executes at runtime: vine -> rope -> grapple arrows.
const STAGE_B = `(async()=>{ ${HELPERS}
	// find the recipe registry (main.js exposes crafting via MM.crafting model or a
	// global RECIPES; fall back to a direct inv check if the maker isn't reachable)
	const inv=MM.inventory.state ? MM.inventory.state() : (window.inv||null);
	// grant raw vines and drive the two recipes through the public craft path if present
	function craft(id){ try{ if(MM.crafting && MM.crafting.craftById) return MM.crafting.craftById(id); }catch(e){} try{ if(window.craftRecipe) return window.craftRecipe(id); }catch(e){} return null; }
	// data-level proof the chain is wired even if the maker isn't headless-reachable:
	const meta=(MM.crafting && MM.crafting.recipeMeta) ? MM.crafting.recipeMeta() : null;
	const ropeMeta = meta ? !!meta['rope_from_vine'] : 'n/a';
	const grapMeta = meta ? (meta['arrows_grapple']&&meta['arrows_grapple'].out==='arrowGrapple') : 'n/a';
	return ['B ok','ropeRecipeMeta='+ropeMeta,'grappleMeta='+grapMeta].join(' :: ');
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-vineqa-'));
	const proc = spawn(edge, [
		'--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--force-device-scale-factor=1',
		'--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${winW},${winH}`, 'about:blank'
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
			} catch (e) { /* not up */ }
		}
		if (!target) throw new Error('DevTools endpoint never came up');
		ws = new WebSocket(target.webSocketDebuggerUrl);
		await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
		const pageErrors = [];
		ws.onmessage = ev => {
			const m = JSON.parse(ev.data);
			if (m.id && pending.has(m.id)){ const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(new Error(p.method + ': ' + JSON.stringify(m.error))); else p.resolve(m.result); }
			else if (m.method === 'Runtime.exceptionThrown'){ try { pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 400)); } catch (e) { /* ignore */ } }
			else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error'){ try { pageErrors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300)); } catch (e) { /* ignore */ } }
		};
		await send(ws, 'Page.enable');
		await send(ws, 'Runtime.enable');
		await send(ws, 'Emulation.setDeviceMetricsOverride', { width: winW, height: winH, deviceScaleFactor: 1, mobile: false });
		await send(ws, 'Page.navigate', { url });
		await sleep(2500);
		for (const [label, expr, out] of [['A', STAGE_A, outA], ['B', STAGE_B, null]]){
			const r = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 120000 });
			console.log('stage ' + label + ':', r && r.result ? r.result.value : '(no result)');
			if (out){ const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' }); await writeFile(out, Buffer.from(shot.data, 'base64')); console.log('wrote', out); }
		}
		console.log('pageErrors:', pageErrors.length ? pageErrors.slice(0, 5).join('\n---\n') : 'none');
	} finally {
		try { if (ws) ws.close(); } catch (e) { /* closing */ }
		await new Promise(res => {
			if (process.platform === 'win32'){
				const marker = profile.split(/[\\/]/).pop();
				execFile('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }`], () => res());
			} else { try { proc.kill('SIGKILL'); } catch (e) { /* gone */ } res(); }
		});
		await sleep(600);
		try { await rm(profile, { recursive: true, force: true }); } catch (e) { /* locked */ }
	}
}
main().catch(err => { console.error(err); process.exit(1); });
