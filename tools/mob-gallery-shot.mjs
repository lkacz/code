#!/usr/bin/env node
// Headless-Edge gallery driver: spawns every mob species in staged batches and
// captures one labeled screenshot per batch, for visual review of mob art.
// Reuses the CDP plumbing from tile-art-shot.mjs (real rAF, own Edge instance).
//
// Usage:
//   node tools/mob-gallery-shot.mjs --outdir=<dir> [--url=http://127.0.0.1:8123/index.html]
//                                   [--size=1600x900] [--seed=42] [--batch=4]
import { spawn, execFile } from 'node:child_process';
import { writeFile, mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
	const hit = args.find(a => a.startsWith('--' + name + '='));
	return hit ? hit.slice(name.length + 3) : dflt;
};
const outdir = opt('outdir', 'mob-gallery');
const url = opt('url', 'http://127.0.0.1:8123/index.html');
const [winW, winH] = opt('size', '1600x900').split('x').map(Number);
const seed = opt('seed', '42');
const batchSize = +opt('batch', 4);

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

// Installed once in the page: staging + per-batch spawn/label helpers.
const PAGE_HELPERS = `
window.__gal = (function(){
	const sleep = ms => new Promise(r => setTimeout(r, ms));
	const TILE = 20;
	function pressKey(k){
		const ev = new KeyboardEvent('keydown', { key: k, bubbles: true });
		window.dispatchEvent(ev); document.dispatchEvent(ev);
	}
	async function stage(){
		for (let i = 0; i < 600 && !(window.MM && MM.mobs && MM.fog && MM.background && MM.worldGen && window.__mmDebugHero && window.player); i++) await sleep(100);
		if (!(window.MM && MM.mobs && MM.fog)) return { err: 'boot-timeout' };
		MM.fog.setRevealAll(true);
		const ui = document.getElementById('ui'); if (ui) ui.style.display = 'none';
		MM.background.importState({ cycleT: 0.25 });
		pressKey('g'); pressKey('i'); // god (energy) + immunity (damage)
		const zn = window.__galZoom || 0;
		for (let z = 0; z < Math.abs(zn); z++) pressKey(zn > 0 ? '+' : '-');
		MM.mobs.freezeSpawns(3600000);
		MM.mobs.clearAll();
		const WG = MM.worldGen;
		let flat = null;
		for (let x = 8; x < 1600 && flat == null; x += 4){
			for (let s = 0; s < 2; s++){
				const cx = s ? -x : x; const h = WG.surfaceHeight(cx); if (h > 62) continue;
				let ok = true;
				for (let k = -26; k <= 26; k += 2){ const hh = WG.surfaceHeight(cx + k); if (Math.abs(hh - h) > 1 || hh > 62){ ok = false; break; } }
				if (ok){ flat = cx; break; }
			}
		}
		if (flat == null) flat = 0;
		let water = null;
		for (let x = 0; x < 5000 && water == null; x += 8){
			for (let s = 0; s < 2; s++){ const wx = s ? -x : x; if (WG.surfaceHeight(wx) > 72 && WG.surfaceHeight(wx + 14) > 72 && WG.surfaceHeight(wx - 14) > 72){ water = wx; break; } }
		}
		const specs = MM.mobs._debugSpecies();
		const species = MM.mobs.species.map(id => {
			const s = specs[id] || {};
			return { id, aquatic: !!s.aquatic, flying: !!s.flying };
		});
		window.__galFlat = flat; window.__galWater = water;
		return { flat, water, species };
	}
	function clearLabels(){
		document.querySelectorAll('.gal-label').forEach(el => el.remove());
	}
	function waterTopAt(x, yLo, yHi){
		for (let y = yLo; y <= yHi; y++){ try { if (MM.world.peekTile(Math.floor(x), y, 0) === 8) return y; } catch (e) {} }
		return null;
	}
	// Spawn a batch of species around spaced anchors, wait for them to settle,
	// then place a DOM label above each live mob (camera centers on the hero).
	async function shootBatch(ids, mode, opts){
		opts = opts || {};
		clearLabels();
		MM.mobs.clearAll();
		MM.mobs.freezeSpawns(3600000);
		const WG = MM.worldGen;
		let hx, hy, anchors = [];
		const spread = opts.spread || 12;
		const settle = opts.settle || 700;
		if (mode === 'water'){
			if (window.__galWater == null) return { err: 'no-water-found' };
			hx = window.__galWater;
			window.__mmDebugHero(hx, 40); // drop from above; settles into/onto water
			await sleep(900);
			const top = waterTopAt(hx, 40, 90);
			if (top == null) return { err: 'no-water-column at x=' + hx };
			hy = top + 1.2;
			window.__mmDebugHero(hx, hy);
			for (let i = 0; i < ids.length; i++){
				const off = (i - (ids.length - 1) / 2) * spread;
				anchors.push({ x: hx + off, y: top + 4 });
			}
		} else {
			hx = window.__galFlat;
			hy = WG.surfaceHeight(hx) - 1.2;
			window.__mmDebugHero(hx, hy);
			for (let i = 0; i < ids.length; i++){
				const off = (i - (ids.length - 1) / 2) * spread;
				anchors.push({ x: hx + off, y: WG.surfaceHeight(Math.round(hx + off)) - 1.5 });
			}
		}
		await sleep(400);
		const gt = (x, y) => { try { return MM.world.peekTile(x, y, 0); } catch (e) { return 0; } };
		const spawned = {};
		for (let i = 0; i < ids.length; i++){
			let ok = false;
			try { ok = !!MM.mobs.forceSpawn(ids[i], { x: anchors[i].x, y: anchors[i].y, w: 0.7, h: 0.95 }, gt); } catch (e) { ok = 'err:' + e.message; }
			spawned[ids[i]] = ok;
		}
		window.__mmDebugHero(hx, hy); // re-pin hero: spawn scatter must not shove camera
		await sleep(settle);
		if (opts.shift){
			// step the hero aside so the mob is not hidden behind him; wait for the camera to settle
			const sx2 = hx + opts.shift;
			const sy2 = (mode === 'water') ? hy : (WG.surfaceHeight(Math.round(sx2)) - 1.2);
			window.__mmDebugHero(sx2, sy2);
			await sleep(850);
			window.__mmDebugHero(sx2, sy2);
			await sleep(150);
		} else {
			window.__mmDebugHero(hx, hy);
			await sleep(150);
		}
		// label live mobs at their current screen positions
		let list = [];
		try { list = (MM.mobs.serialize().list || []); } catch (e) {}
		const zoom = (window.__mmRenderDetail && window.__mmRenderDetail.zoom) || 1;
		const px = window.player.x, py = window.player.y;
		const cw = window.innerWidth / 2, ch = window.innerHeight / 2;
		const out = [];
		for (const m of list){
			if (!m || m.hp <= 0) continue;
			const sx = cw + (m.x - px) * TILE * zoom;
			const sy = ch + (m.y - py) * TILE * zoom;
			out.push({ id: m.id, x: +m.x.toFixed(1), y: +m.y.toFixed(1), sx: Math.round(sx), sy: Math.round(sy) });
			const el = document.createElement('div');
			el.className = 'gal-label';
			el.textContent = m.id;
			el.style.cssText = 'position:fixed;left:' + (sx - 60) + 'px;top:' + (sy - 58) + 'px;width:120px;text-align:center;' +
				'font:11px/1.2 monospace;color:#fff;text-shadow:0 1px 2px #000,0 0 4px #000;z-index:99999;pointer-events:none;';
			document.body.appendChild(el);
		}
		return { hero: { x: px, y: py }, zoom, spawned, mobs: out };
	}
	// Stage a landscape scene: hop the hero to x (surface or explicit y), optionally
	// set time-of-day (cycleT), let chunks bake, report what is around.
	async function scene(spec){
		clearLabels();
		MM.mobs.clearAll();
		MM.mobs.freezeSpawns(3600000);
		const WG = MM.worldGen;
		if (typeof spec.t === 'number') MM.background.importState({ cycleT: spec.t });
		let x = spec.x || 0;
		if (spec.city){
			// walk outward until worldgen reports a city column
			for (let d = 0; d < 24000; d += 40){
				for (const s of [1, -1]){
					try { if (WG.cityAt && WG.cityAt(x + s * d)){ x = x + s * d; d = 1e9; break; } } catch (e) {}
				}
			}
		}
		const y = (typeof spec.y === 'number') ? spec.y : (WG.surfaceHeight(Math.round(x)) - 1.2);
		window.__mmDebugHero(x, y);
		await sleep(spec.wait || 1600);
		window.__mmDebugHero(x, y);
		await sleep(200);
		let biome = null;
		try { biome = WG.biomeAt ? WG.biomeAt(Math.round(x)) : null; } catch (e) {}
		const tiles = [];
		try {
			const sx = Math.round(x), sy = WG.surfaceHeight(sx);
			for (let dy = 0; dy < 6; dy++) tiles.push(MM.world.peekTile(sx, sy + dy, 0));
		} catch (e) {}
		let cyc = null;
		try { const ci = MM.background.getCycleInfo(); cyc = { cycleT: +(+ci.cycleT).toFixed(3), isDay: ci.isDay }; } catch (e) {}
		return { x, y: +y.toFixed(1), surface: WG.surfaceHeight(Math.round(x)), biome, tiles, cyc };
	}
	return { stage, shootBatch, scene, clearLabels };
})();
'helpers-installed'`;

async function main(){
	const { existsSync } = await import('node:fs');
	await mkdir(outdir, { recursive: true });
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-gal-'));
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
				const list = await res.json();
				target = list.find(t => t.type === 'page');
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
					try { pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 400)); } catch (e) {}
				}
			}
		};

		await send(ws, 'Page.enable');
		await send(ws, 'Runtime.enable');
		await send(ws, 'Emulation.setDeviceMetricsOverride', { width: winW, height: winH, deviceScaleFactor: 1, mobile: false });
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

		const evalJson = async (expr) => {
			const r = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 120000 });
			if (r.exceptionDetails) throw new Error('page eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
			return r.result ? r.result.value : null;
		};

		await evalJson(PAGE_HELPERS);
		const zoomNotches = +opt('zoom', 0);
		if (zoomNotches) await evalJson('window.__galZoom=' + zoomNotches);
		const staged = await evalJson('window.__gal.stage()');
		if (!staged || staged.err) throw new Error('stage failed: ' + JSON.stringify(staged));
		console.log('staged: flat=' + staged.flat + ' water=' + staged.water + ' species=' + staged.species.length);

		// --scenes="x:800|x:0,t:0.62|x:100,y:120" : landscape shots instead of mob batches
		const scenesArg = opt('scenes', '');
		if (scenesArg){
			let n = 0;
			for (const tok of scenesArg.split('|')){
				n++;
				const spec = {};
				for (const kv of tok.split(',')){
					const [k, v] = kv.split(':');
					spec[k.trim()] = +v;
				}
				let info = null;
				try { info = await evalJson('window.__gal.scene(' + JSON.stringify(spec) + ')'); } catch (e) { info = { err: e.message }; }
				const name = 'scene-' + String(n).padStart(2, '0') + '-' + tok.replace(/[^a-z0-9.-]+/gi, '_') + '.png';
				const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
				await writeFile(join(outdir, name), Buffer.from(shot.data, 'base64'));
				console.log(name, JSON.stringify(info));
			}
			if (pageErrors.length) console.log('pageErrors:', pageErrors.slice(0, 5).join('\n---\n'));
			return;
		}
		const only = (opt('only', '') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
		let pool = staged.species;
		if (only.length) pool = pool.filter(s => only.includes(s.id));
		const land = pool.filter(s => !s.aquatic).map(s => s.id);
		const aqua = pool.filter(s => s.aquatic).map(s => s.id);
		const batches = [];
		for (let i = 0; i < land.length; i += batchSize) batches.push({ ids: land.slice(i, i + batchSize), mode: 'land' });
		for (let i = 0; i < aqua.length; i += Math.min(3, batchSize)) batches.push({ ids: aqua.slice(i, i + Math.min(3, batchSize)), mode: 'water' });
		const shotOpts = { spread: +opt('spread', 12), settle: +opt('settle', 700), shift: +opt('shift', 0) || 0 };

		let n = 0;
		for (const b of batches){
			n++;
			let info = null;
			try {
				info = await evalJson('window.__gal.shootBatch(' + JSON.stringify(b.ids) + ',' + JSON.stringify(b.mode) + ',' + JSON.stringify(shotOpts) + ')');
			} catch (e) { info = { err: e.message }; }
			const name = 'batch-' + String(n).padStart(2, '0') + '-' + b.ids.join('_').toLowerCase() + '.png';
			const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
			await writeFile(join(outdir, name), Buffer.from(shot.data, 'base64'));
			console.log(name, JSON.stringify(info));
		}
		if (pageErrors.length) console.log('pageErrors:', pageErrors.slice(0, 5).join('\n---\n'));
	} finally {
		try { if (ws) ws.close(); } catch (e) {}
		await new Promise(res => {
			if (process.platform === 'win32'){
				const marker = profile.split(/[\\/]/).pop();
				execFile('powershell', ['-NoProfile', '-Command',
					`Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }`
				], () => res());
			} else { try { proc.kill('SIGKILL'); } catch (e) {} res(); }
		});
		await sleep(600);
		try { await rm(profile, { recursive: true, force: true }); } catch (e) {}
	}
}

main().catch(err => { console.error(err); process.exit(1); });
