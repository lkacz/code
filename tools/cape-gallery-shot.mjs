#!/usr/bin/env node
// Headless-Edge cape gallery: equips one cape per fabric archetype through the
// real inventory pipeline (grant → sanitize → equip → syncCustomization) and
// captures labeled screenshots per state (idle / wind / sprint), zoomed in so
// the fabric read is judgeable. Reuses the CDP plumbing conventions from
// mob-gallery-shot.mjs (own Edge instance, marker-scoped kill, seed pin).
//
// Usage: node tools/cape-gallery-shot.mjs --outdir=<dir> [--url=http://127.0.0.1:8123/index.html]
//                                         [--size=1200x800] [--seed=42] [--zoom=4]
import { spawn, execFile } from 'node:child_process';
import { writeFile, mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
	const hit = args.find(a => a.startsWith('--' + name + '='));
	return hit ? hit.slice(name.length + 3) : dflt;
};
const outdir = opt('outdir', 'cape-gallery');
const url = opt('url', 'http://127.0.0.1:8123/index.html');
const [winW, winH] = opt('size', '1200x800').split('x').map(Number);
const seed = opt('seed', '42');
const zoomNotches = +opt('zoom', 4);

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

const PAGE_HELPERS = `
window.__capeQa = (function(){
	const sleep = ms => new Promise(r => setTimeout(r, ms));
	function pressKey(k){
		const ev = new KeyboardEvent('keydown', { key: k, bubbles: true });
		window.dispatchEvent(ev); document.dispatchEvent(ev);
	}
	function holdKey(k, code){
		const ev = new KeyboardEvent('keydown', { key: k, code: code || '', bubbles: true });
		document.body.dispatchEvent(ev); window.dispatchEvent(ev); document.dispatchEvent(ev);
	}
	function releaseKey(k, code){
		const ev = new KeyboardEvent('keyup', { key: k, code: code || '', bubbles: true });
		document.body.dispatchEvent(ev); window.dispatchEvent(ev); document.dispatchEvent(ev);
	}
	async function stage(zoom){
		for (let i = 0; i < 600 && !(window.MM && MM.inventory && MM.wind && MM.background && MM.worldGen && window.__mmDebugHero && window.player); i++) await sleep(100);
		if (!(window.MM && MM.inventory)) return { err: 'boot-timeout' };
		if (MM.fog && MM.fog.setRevealAll) MM.fog.setRevealAll(true);
		const ui = document.getElementById('ui'); if (ui) ui.style.display = 'none';
		MM.background.importState({ cycleT: 0.25 });
		pressKey('g'); pressKey('i');
		if (MM.mobs){ MM.mobs.freezeSpawns(3600000); MM.mobs.clearAll(); }
		// zoom is wheel-driven on the #game canvas (MAX_ZOOM 3, ×1.1 per notch)
		const cv = document.getElementById('game');
		for (let z = 0; z < Math.abs(zoom); z++){
			cv.dispatchEvent(new WheelEvent('wheel', { deltaY: zoom > 0 ? -100 : 100, bubbles: true, cancelable: true }));
		}
		const WG = MM.worldGen;
		const gt = (x, y) => { try { return MM.world.peekTile(Math.floor(x), y, 0); } catch (e) { return 0; } };
		let flat = null;
		for (let x = 8; x < 2400 && flat == null; x += 4){
			for (let s = 0; s < 2; s++){
				const cx = s ? -x : x; const h = WG.surfaceHeight(cx); if (h > 62) continue;
				let ok = true;
				for (let k = -16; k <= 16 && ok; k += 2){
					const hh = WG.surfaceHeight(cx + k);
					if (Math.abs(hh - h) > 1 || hh > 62){ ok = false; break; }
				}
				if (ok){ flat = cx; break; }
			}
		}
		if (flat == null) flat = 0;
		// clear vegetation (bushes, trunks, canopy) over the whole runway so
		// the cape collides with nothing and the wind exposure probe sees sky
		const hFlat = WG.surfaceHeight(flat);
		for (let k = -18; k <= 18; k++){
			for (let y = hFlat - 45; y < WG.surfaceHeight(flat + k); y++){
				if (gt(flat + k, y) !== 0){ try { MM.world.setTile(flat + k, y, 0); } catch (e) {} }
			}
		}
		window.__capeFlat = flat;
		const hy = WG.surfaceHeight(flat) - 1.2;
		window.__mmDebugHero(flat, hy);
		await sleep(600);
		window.__mmDebugHero(flat, hy);
		return { flat };
	}
	// Equip a cape through the REAL pipeline; returns what the renderer resolved.
	function wear(spec){
		const id = 'qa_cape_' + spec.tag;
		MM.inventory.grantItem({ id, kind: 'cape', name: spec.name, tier: spec.tier || 'epic', desc: spec.desc || '', fabric: spec.fabric, airJumps: 2 }, { equip: true });
		if (spec.color && MM.inventory.setColor) MM.inventory.setColor('cape', spec.color);
		const c = MM.customization || {};
		return { equipped: (MM.inventory.getEquipped ? undefined : undefined), capeStyle: c.capeStyle, capeFabric: c.capeFabric, capeIrid: !!c.capeIrid };
	}
	async function scene(spec){
		const WG = MM.worldGen;
		const flat = window.__capeFlat;
		const hy = WG.surfaceHeight(flat) - 1.2;
		// auto-unpause: a stray dialog/pause freezes the sim clock — Escape out
		for (let tries = 0; tries < 3; tries++){
			const a = window.__mmSimulationTimeMs || 0;
			await sleep(150);
			if (((window.__mmSimulationTimeMs || 0) - a) > 30) break;
			pressKey('Escape');
			await sleep(200);
		}
		window.__mmDebugHero(flat, hy);
		if (typeof spec.t === 'number') MM.background.importState({ cycleT: spec.t });
		MM.wind.setOverride(typeof spec.wind === 'number' ? spec.wind : 0);
		// The CDP bringToFront pump fires a blur every beat, and blur releases
		// gameplay input — re-arm held keys continuously during a run scene.
		if (spec.run){
			const key = spec.run > 0 ? 'd' : 'a', code = spec.run > 0 ? 'KeyD' : 'KeyA';
			const until = performance.now() + (spec.wait || 1400);
			while (performance.now() < until){
				holdKey(key, code);
				await sleep(180);
			}
			releaseKey(key, code);
		} else {
			await sleep(spec.wait || 1400);
		}
		const label = document.getElementById('capeQaLabel') || (function(){
			const el = document.createElement('div');
			el.id = 'capeQaLabel';
			el.style.cssText = 'position:fixed;left:12px;top:10px;font:16px/1.3 monospace;color:#fff;text-shadow:0 1px 3px #000;z-index:99999;pointer-events:none;';
			document.body.appendChild(el); return el;
		})();
		label.textContent = spec.label || '';
		const simA = window.__mmSimulationTimeMs || 0;
		await sleep(300);
		const simB = window.__mmSimulationTimeMs || 0;
		const out = {
			hero: { x: window.player.x.toFixed(1), y: window.player.y.toFixed(1) },
			cust: { style: MM.customization.capeStyle, fabric: MM.customization.capeFabric, irid: MM.customization.capeIrid },
			simDelta: Math.round(simB - simA),
			windAt: +(MM.wind.speedAt(window.player.x, window.player.y - 0.6, (x, y) => { try { return MM.world.peekTile(x, y, 0); } catch (e) { return 0; } }) || 0).toFixed(2),
			fabLen: (MM.capeFabrics && MM.capeFabrics.get((MM.customization || {}).capeFabric || 'cloth').lengthTiles) || null,
			capeSpan: (function(){ const s = (MM.cape && MM.cape._segments) || []; if (!s.length) return null; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const n of s){ if (n.x < x0) x0 = n.x; if (n.x > x1) x1 = n.x; if (n.y < y0) y0 = n.y; if (n.y > y1) y1 = n.y; } return +(Math.hypot(x1 - x0, y1 - y0)).toFixed(2); })(),
			zoom: (window.__mmRenderDetail || {}).zoom,
			modal: !!(MM.modalInput && MM.modalInput.isOpen && MM.modalInput.isOpen()),
			pause: (function(){ const el = document.getElementById('pausePanel'); return el ? !el.hidden : null; })(),
			title: !!(MM.titleScreen && MM.titleScreen.isOpen && MM.titleScreen.isOpen()),
			finale: !!(MM.finale && MM.finale.isOpen && MM.finale.isOpen()),
			frameCap: window.__mmFrameCap,
			loopErrors: (window.__mmLoopErrors || []).slice(-2)
		};
		if (spec.run){ releaseKey(spec.run > 0 ? 'd' : 'a', spec.run > 0 ? 'KeyD' : 'KeyA'); }
		return out;
	}
	function calm(){ MM.wind.setOverride(0); }
	return { stage, wear, scene, calm };
})();
'helpers-installed'`;

const FABRIC_LOOKS = [
	{ tag: 'cloth',   name: 'Peleryna gór',              tier: 'common',    color: '#b91818' },
	{ tag: 'silk',    name: 'Peleryna Astraela',         tier: 'epic',      color: '#2b6fd8' },
	{ tag: 'leather', name: 'Peleryna nietoperza',       tier: 'uncommon',  color: '#7a4f2a' },
	{ tag: 'fur',     name: 'Peleryna yeti',             tier: 'epic',      color: '#e8e2d4' },
	{ tag: 'feather', name: 'Skrzydła Królowej Harpii',  tier: 'legendary', color: '#b9c4d6' },
	{ tag: 'scale',   name: 'Peleryna złotego smoka',    tier: 'legendary', color: '#3f6d5a' },
	{ tag: 'ember',   name: 'Pióropusz żaru',            tier: 'legendary', color: '#d8480f' },
	{ tag: 'spectral',name: 'Peleryna cienia',           tier: 'rare',      color: '#241b33' },
	{ tag: 'frost',   name: 'Peleryna zamieci',          tier: 'epic',      color: '#bfe4f5' },
	{ tag: 'gilded',  name: 'Peleryna słońca',           tier: 'legendary', color: '#c9971d' },
	{ tag: 'aurora',  name: 'Łuska zorzy',               tier: 'legendary', color: '#3f6d5a' }
];

async function main(){
	const { existsSync } = await import('node:fs');
	await mkdir(outdir, { recursive: true });
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-capeqa-'));
	const proc = spawn(edge, [
		'--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
		'--force-device-scale-factor=1',
		'--remote-debugging-port=0',
		`--user-data-dir=${profile}`,
		`--window-size=${winW},${winH}`,
		'about:blank'
	], { stdio: 'ignore' });

	let ws;
	let pump = null;
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
		// Headless Edge starves a quiet tab's rAF after ~20s; the documented QA
		// cure is a steady bringToFront pump (same as ghost/bouncy drivers).
		pump = setInterval(() => { send(ws, 'Page.bringToFront').catch(() => {}); }, 900);
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
		const staged = await evalJson('window.__capeQa.stage(' + zoomNotches + ')');
		if (!staged || staged.err) throw new Error('stage failed: ' + JSON.stringify(staged));
		console.log('staged at flat=' + staged.flat);

		const shot = async (name) => {
			const s = await send(ws, 'Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: winW, height: winH, scale: 1 } });
			await writeFile(join(outdir, name), Buffer.from(s.data, 'base64'));
		};
		let n = 0;
		for (const look of FABRIC_LOOKS){
			n++;
			const worn = await evalJson('window.__capeQa.wear(' + JSON.stringify(look) + ')');
			console.log(look.tag, JSON.stringify(worn));
			const states = [
				{ key: 'idle',   spec: { wind: 0,   t: 0.25, wait: 1600, label: look.tag + ' · ' + look.name + ' · idle' } },
				{ key: 'wind',   spec: { wind: 5.5, t: 0.25, wait: 1500, label: look.tag + ' · wind 5.5' } },
				{ key: 'sprint', spec: { wind: 0,   t: 0.25, run: 1, wait: 800, label: look.tag + ' · sprint' } }
			];
			for (const st of states){
				const info = await evalJson('window.__capeQa.scene(' + JSON.stringify(st.spec) + ')');
				const name = 'cape-' + String(n).padStart(2, '0') + '-' + look.tag + '-' + st.key + '.png';
				await shot(name);
				console.log(name, JSON.stringify(info));
			}
			await evalJson('window.__capeQa.calm()');
		}
		// night shot for the emissive fabric
		await evalJson('window.__capeQa.wear(' + JSON.stringify(FABRIC_LOOKS.find(f => f.tag === 'ember')) + ')');
		await evalJson('window.__capeQa.scene({ wind: 2, t: 0.76, wait: 1600, label: "ember · night glow" })');
		await shot('cape-99-ember-night.png');
		if (pageErrors.length) console.log('pageErrors:', pageErrors.slice(0, 5).join('\n---\n'));
	} finally {
		if (pump) clearInterval(pump);
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
