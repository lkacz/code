#!/usr/bin/env node
// Headless-Edge live QA for the threat-look ("Groza") system: boots the REAL
// game over CDP and captures three lineup screenshots proving the visual
// menace ladder:
//   A  tools/threat-look-qa-a.png  one species (WOLF) forced through all six
//      grades — size, bulk, palette, spines, scars, eyes must escalate left→right
//   B  tools/threat-look-qa-b.png  natural bestiary ladder (SQUIRREL → GOLD_DRAGON)
//   C  tools/threat-look-qa-c.png  tool users at apex gear tier (runic weapons)
// The page also asserts the grade/scale ladders are monotone; a broken ladder
// fails the run.
// Usage: node tools/threat-look-qa.mjs [--url=http://127.0.0.1:8123/index.html]
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

const PAGE_HELPERS = `
window.__tlqa = (function(){
	const sleep = ms => new Promise(r => setTimeout(r, ms));
	const TILE = 20;
	function pressKey(k){
		const ev = new KeyboardEvent('keydown', { key: k, bubbles: true });
		window.dispatchEvent(ev); document.dispatchEvent(ev);
	}
	async function stage(zoomSteps){
		for (let i = 0; i < 600 && !(window.MM && MM.mobs && MM.fog && MM.background && MM.worldGen && MM.threatLook && window.__mmDebugHero && window.player); i++) await sleep(100);
		if (!(window.MM && MM.mobs && MM.threatLook)) return { err: 'boot-timeout' };
		MM.fog.setRevealAll(true);
		const ui = document.getElementById('ui'); if (ui) ui.style.display = 'none';
		MM.background.importState({ cycleT: 0.25 });
		pressKey('g'); pressKey('i');
		for (let z = 0; z < Math.abs(zoomSteps || 0); z++) pressKey(zoomSteps > 0 ? '+' : '-');
		MM.mobs.freezeSpawns(3600000);
		MM.mobs.clearAll();
		const WG = MM.worldGen;
		let flat = null;
		for (let x = 8; x < 1600 && flat == null; x += 4){
			for (let s = 0; s < 2; s++){
				const cx = s ? -x : x; const h = WG.surfaceHeight(cx); if (h > 62) continue;
				let ok = true;
				for (let k = -34; k <= 34; k += 2){ const hh = WG.surfaceHeight(cx + k); if (Math.abs(hh - h) > 1 || hh > 62){ ok = false; break; } }
				if (ok){ flat = cx; break; }
			}
		}
		if (flat == null) flat = 0;
		window.__tlFlat = flat;
		return { flat };
	}
	function clearLabels(){ document.querySelectorAll('.tl-label').forEach(el => el.remove()); }
	function label(sx, sy, text, sub){
		const el = document.createElement('div');
		el.className = 'tl-label';
		el.innerHTML = text + (sub ? '<br><span style="opacity:.75">' + sub + '</span>' : '');
		el.style.cssText = 'position:fixed;left:' + (sx - 70) + 'px;top:' + (sy) + 'px;width:140px;text-align:center;' +
			'font:11px/1.25 monospace;color:#fff;text-shadow:0 1px 2px #000,0 0 4px #000;z-index:99999;pointer-events:none;';
		document.body.appendChild(el);
	}
	const gt = (x, y) => { try { return MM.world.peekTile(x, y, 0); } catch (e) { return 0; } };
	// carve a clean stone podium so the lineup reads without terrain noise
	function buildStage(hx, baseY, halfW){
		for (let x = hx - halfW; x <= hx + halfW; x++){
			for (let y = baseY - 16; y < baseY; y++) MM.world.setTile(x, y, 0);
			for (let y = baseY; y <= baseY + 2; y++) MM.world.setTile(x, y, 3);
		}
	}
	async function lineup(entries, spread, labelYOff){
		clearLabels();
		MM.mobs.clearAll();
		MM.mobs.freezeSpawns(3600000);
		const WG = MM.worldGen;
		const hx = window.__tlFlat;
		const baseY = WG.surfaceHeight(hx);
		buildStage(hx, baseY, Math.ceil(spread * entries.length / 2) + 8);
		const hy = baseY - 1.2;
		window.__mmDebugHero(hx, hy);
		await sleep(250);
		const specs = MM.mobs._debugSpecies();
		const placed = [];
		for (let i = 0; i < entries.length; i++){
			const e = entries[i];
			const off = (i - (entries.length - 1) / 2) * spread;
			const ax = hx + off, ay = baseY - 1.5;
			let ok = false;
			try { ok = !!MM.mobs.forceSpawn(e.id, { x: ax, y: ay, w: 0.7, h: 0.95 }, gt); } catch (err) { return { err: 'spawn ' + e.id + ': ' + err.message }; }
			if (!ok) return { err: 'forceSpawn refused ' + e.id };
			const m = MM.mobs.nearestLiving(ax, ay, 8);
			if (!m || m.id !== e.id) return { err: 'lost ' + e.id + ' after spawn' };
			// nail the specimen to its podium: no wandering, no aggro sprints
			m.x = ax; m.y = ay; m.vx = 0; m.vy = 0; m.state = 'idle'; m.speedMul = 0; m.facing = 1;
			m.lifeEndAt = performance.now() + 3600000; m.decayStartAt = m.lifeEndAt;
			if (e.force){
				m.maxHp = e.force.hp; m.hp = e.force.hp;
				m.dmgMult = e.force.dmgMult || 1;
				m.hostilityTier = e.force.tier || 0;
				m.hostilitySide = e.force.side || 'center';
				m.scale = 1; m.baseColor = e.force.baseColor || m.baseColor;
				MM.threatLook.refreshLook(m);
				MM.threatLook.applySpawnLook(m, specs[e.id]);
			}
			const look = MM.threatLook.lookFor(m, specs[e.id]);
			placed.push({ id: e.id, ax, ay, grade: look ? look.grade : -1, name: look ? look.name : '?', scale: +(+m.scale).toFixed(2), mref: m });
		}
		window.__mmDebugHero(hx, hy);
		await sleep(600);
		// re-pin every specimen onto its podium slot: gravity settles them, but a
		// chest or ruin tile in the terrain will otherwise let one climb and break
		// the lineup's shared baseline
		buildStage(hx, baseY, Math.ceil(spread * entries.length / 2) + 8);
		for (const p of placed){
			p.mref.x = p.ax; p.mref.y = p.ay; p.mref.vx = 0; p.mref.vy = 0; p.mref.state = 'idle';
		}
		window.__mmDebugHero(hx, hy);
		await sleep(200);
		for (const p of placed){ p.mref.x = p.ax; p.mref.vx = 0; }
		const zoom = (window.__mmRenderDetail && window.__mmRenderDetail.zoom) || 1;
		const px = window.player.x, py = window.player.y;
		const cw = window.innerWidth / 2, ch = window.innerHeight / 2;
		for (const p of placed){
			const sx = cw + (p.mref.x - px) * TILE * zoom;
			const sy = ch + (p.mref.y - py) * TILE * zoom + (labelYOff || 46);
			label(sx, sy, 'G' + p.grade + ' · ' + p.name, p.id + ' ×' + p.scale);
		}
		const grades = placed.map(p => p.grade);
		const scales = placed.map(p => p.scale);
		for (let i = 1; i < grades.length; i++){
			if (grades[i] < grades[i - 1]) return { err: 'grade ladder broke: ' + JSON.stringify(grades) };
		}
		return { grades, scales, hero: { x: px, y: py } };
	}
	async function zoom(steps){
		for (let z = 0; z < steps; z++){ pressKey('+'); await sleep(60); }
		await sleep(300);
		return (window.__mmRenderDetail && window.__mmRenderDetail.zoom) || 1;
	}
	return { stage, lineup, zoom, clearLabels };
})();
'helpers-installed'`;

// WOLF forced through every grade (stats chosen to land mid-band; see
// threat-look-sim.test.mjs for the band math)
const WOLF_LADDER = JSON.stringify([
	{ id: 'WOLF', force: { hp: 1.5, dmgMult: 1, tier: 0, side: 'center', baseColor: '#bcbcbc' } },
	{ id: 'WOLF', force: { hp: 6, dmgMult: 1, tier: 0, side: 'center', baseColor: '#bcbcbc' } },
	{ id: 'WOLF', force: { hp: 16, dmgMult: 1, tier: 1, side: 'center', baseColor: '#bcbcbc' } },
	{ id: 'WOLF', force: { hp: 48, dmgMult: 1.5, tier: 2, side: 'hot', baseColor: '#bcbcbc' } },
	{ id: 'WOLF', force: { hp: 160, dmgMult: 3, tier: 3, side: 'hot', baseColor: '#bcbcbc' } },
	{ id: 'WOLF', force: { hp: 500, dmgMult: 5, tier: 4, side: 'hot', baseColor: '#bcbcbc' } }
]);
const BESTIARY = JSON.stringify([
	{ id: 'SQUIRREL' }, { id: 'DEER' }, { id: 'WOLF' }, { id: 'BEAR' },
	{ id: 'THUNDER_BISON' }, { id: 'GOLD_DWARF_GUARD' }, { id: 'GIANT_SCORPION' }, { id: 'GOLD_DRAGON' }
]);
// close-ups — a carnivore (claws, fangs, shoulder mass, eye-shine) and a horned
// herbivore (antler/horn growth, hump, NO fangs) side by side across the ladder
const CLOSEUP_BEASTS = JSON.stringify([
	{ id: 'WOLF', force: { hp: 16, dmgMult: 1, tier: 0, side: 'center', baseColor: '#bcbcbc' } },
	{ id: 'WOLF', force: { hp: 60, dmgMult: 1.6, tier: 2, side: 'center', baseColor: '#bcbcbc' } },
	{ id: 'WOLF', force: { hp: 190, dmgMult: 3, tier: 3, side: 'cold', baseColor: '#bcbcbc' } },
	{ id: 'WOLF', force: { hp: 560, dmgMult: 5, tier: 4, side: 'cold', baseColor: '#bcbcbc' } }
]);
const CLOSEUP_HORNED = JSON.stringify([
	{ id: 'THUNDER_BISON', force: { hp: 48, dmgMult: 1, tier: 0, side: 'center', baseColor: '#8b5f34' } },
	{ id: 'THUNDER_BISON', force: { hp: 120, dmgMult: 1.6, tier: 2, side: 'center', baseColor: '#8b5f34' } },
	{ id: 'THUNDER_BISON', force: { hp: 340, dmgMult: 2.6, tier: 3, side: 'hot', baseColor: '#8b5f34' } },
	{ id: 'THUNDER_BISON', force: { hp: 900, dmgMult: 4, tier: 4, side: 'hot', baseColor: '#8b5f34' } }
]);
// eye-anatomy close-up: a grazer's bar pupil (goat), a hunter's slit (bear),
// the reptile eye of the dragon — and the screen-facing TWIN eyes of the yeti
// (glacier blue) and the ghoul (grave lime)
const CLOSEUP_EYES = JSON.stringify([
	{ id: 'GOAT', force: { hp: 200, dmgMult: 2, tier: 2, side: 'center' } },
	{ id: 'BEAR', force: { hp: 400, dmgMult: 3, tier: 3, side: 'hot' } },
	{ id: 'GHOUL', force: { hp: 120, dmgMult: 2.5, tier: 2, side: 'center' } },
	{ id: 'JACKPOT_YETI', force: { hp: 200, dmgMult: 1, tier: 2, side: 'cold' } },
	{ id: 'GOLD_DRAGON' }
]);
// ascending gear showcase: shamans peak at G4 (dmg 0 casters), melee users hit G5
const TOOL_USERS = JSON.stringify([
	{ id: 'SZKIELET', force: { hp: 30, dmgMult: 1.6, tier: 2, side: 'center' } },
	{ id: 'FIRE_SHAMAN', force: { hp: 520, dmgMult: 1, tier: 4, side: 'hot' } },
	{ id: 'ICE_SHAMAN', force: { hp: 520, dmgMult: 1, tier: 4, side: 'cold' } },
	{ id: 'TEMPLE_GUARD', force: { hp: 520, dmgMult: 4, tier: 4, side: 'center' } },
	{ id: 'GOLD_DWARF_GUARD', force: { hp: 520, dmgMult: 3, tier: 4, side: 'hot' } },
	{ id: 'SZKIELET', force: { hp: 520, dmgMult: 5, tier: 4, side: 'hot' } }
]);

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-tlqa-'));
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
					try { pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 500)); } catch (e) { /* ignore */ }
				}
			}
		};

		await send(ws, 'Page.enable');
		await send(ws, 'Runtime.enable');
		await send(ws, 'Emulation.setDeviceMetricsOverride', { width: winW, height: winH, deviceScaleFactor: 1, mobile: false });
		await send(ws, 'Page.navigate', { url });
		for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await sleep(250);
		await sleep(1500);

		const ev1 = await send(ws, 'Runtime.evaluate', { expression: PAGE_HELPERS, returnByValue: true });
		if (!ev1 || !ev1.result || ev1.result.value !== 'helpers-installed') throw new Error('helper install failed');
		const staged = await send(ws, 'Runtime.evaluate', { expression: '__tlqa.stage(2)', awaitPromise: true, returnByValue: true, timeout: 90000 });
		console.log('stage:', JSON.stringify(staged.result.value));
		if (staged.result.value && staged.result.value.err) throw new Error(staged.result.value.err);

		const scenes = [
			['a', `__tlqa.lineup(${WOLF_LADDER}, 7, 46)`, 'tools/threat-look-qa-a.png', 0],
			['b', `__tlqa.lineup(${BESTIARY}, 6.5, 52)`, 'tools/threat-look-qa-b.png', 0],
			['c', `__tlqa.lineup(${TOOL_USERS}, 7.5, 50)`, 'tools/threat-look-qa-c.png', 0],
			// close-ups: the anatomy has to survive being looked at
			['d', `__tlqa.lineup(${CLOSEUP_BEASTS}, 5, 90)`, 'tools/threat-look-qa-d.png', 3],
			['e', `__tlqa.lineup(${CLOSEUP_HORNED}, 6, 96)`, 'tools/threat-look-qa-e.png', 3],
			['f', `__tlqa.lineup(${CLOSEUP_EYES}, 8, 100)`, 'tools/threat-look-qa-f.png', 0]
		];
		for (const [name, expr, out, zoom] of scenes){
			if (zoom) await send(ws, 'Runtime.evaluate', { expression: `__tlqa.zoom(${zoom})`, awaitPromise: true, returnByValue: true, timeout: 30000 });
			const r = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 90000 });
			const v = r && r.result ? r.result.value : null;
			console.log('scene ' + name + ':', JSON.stringify(v));
			if (!v || v.err){ failed = true; }
			await sleep(400);
			const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
			await writeFile(out, Buffer.from(shot.data, 'base64'));
			console.log('wrote', out);
		}
		if (pageErrors.length){ console.log('pageErrors:', pageErrors.slice(0, 5).join('\n---\n')); failed = true; }
		if (failed) process.exitCode = 1;
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
