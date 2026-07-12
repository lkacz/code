#!/usr/bin/env node
// Headless-Edge live QA for the sky biome wave (world_layers.js SKY_BIOMES +
// mobs.js sky fauna). Boots the REAL game over CDP, flies the hero into themed
// sky regions and screenshots:
//   tools/sky-biomes-qa-a.png  Podniebna Puszcza (skywood): grass islands + trees
//   tools/sky-biomes-qa-b.png  Żarowe Łuki (ember): basalt/lava arches + drips
//   tools/sky-biomes-qa-c.png  Rdzawa Flotylla (wreck): steel hulls + masts
//   tools/sky-biomes-qa-d.png  boss encounter: forced regional boss + grunt pressure
// Usage: node tools/sky-biomes-qa.mjs [--url=http://127.0.0.1:8123/index.html] [--size=1600x900]
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
const outBase = opt('out', 'tools/sky-biomes-qa').replace(/\.png$/, '');

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

const BOOT = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	for(let i=0;i<600 && !(window.MM && MM.mobs && MM.fog && MM.background && window.__mmDebugHero && window.player);i++) await sleep(100);
	if(!(window.MM && MM.mobs && MM.fog)) return 'boot-timeout';
	window.__skyWL=(await import('./src/engine/world_layers.js')).default;
	window.__skyWG=(await import('./src/engine/worldgen.js')).worldGen;
	MM.fog.setRevealAll(true);
	try{ MM.background.importState({cycleT:0.30}); }catch(e){}
	try{ document.getElementById('craft').style.display='none'; }catch(e){}
	window.player.maxHp=100000; window.player.hp=100000;
	window.__skyFind=(key)=>{
		const WL=window.__skyWL, WG=window.__skyWG;
		for(let x=WL.SKY_BIOME_START; x<WL.SKY_BIOME_START+WL.SKY_REGION_W*23; x+=WL.SKY_REGION_W){
			const r=WL.skyBiomeAt(WG,x+5);
			if(r && r.key===key) return r;
		}
		return null;
	};
	// widest island crest in the region band: hover a few tiles above it so the
	// shot frames the themed island (tops + crown structures) under the hero
	window.__skyPerch=(r,high)=>{
		const gt=window.MM.world.getTile;
		const y0=high?-135:-66, y1=high?-75:-8;
		let best=null;
		for(let x=r.x0+8; x<r.x1-8; x+=2){
			for(let y=y0; y<=y1; y++){
				const t=gt(x,y);
				if(t===0) continue;
				// islands only: a crest must be a thick mass, not a 1-tile debris ribbon
				if(gt(x,y+2)===0 || gt(x,y+4)===0) break;
				let run=1;
				while(run<40 && gt(x+run,y)!==0 && gt(x+run,y-1)===0) run++;
				if(!best || run>best.run) best={x:x+Math.min(run,24)*0.5, y:y-7, run};
				break;
			}
		}
		return best || {x:r.center, y:high?-100:-42, run:0};
	};
	// hero must hover mid-sky for the shot: park him and null gravity each frame
	window.__skyHover=(x,y)=>{
		window.__mmDebugHero(x,y);
		clearInterval(window.__skyHoverTimer);
		window.__skyHoverTimer=setInterval(()=>{
			window.player.x=x; window.player.y=y;
			window.player.vx=0; window.player.vy=0;
			window.player.hp=window.player.maxHp;
		},50);
	};
	return 'ok: booted seed='+window.__skyWG.worldSeed;
})()`;

const scene = (key, high) => `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const r=window.__skyFind('${key}');
	if(!r) return 'region-not-found:${key}';
	window.__skyHover(r.center, ${high?-100:-42}); // pre-generate the band
	await sleep(900);
	const p=window.__skyPerch(r, ${high?'true':'false'});
	window.__skyHover(p.x, p.y);
	await sleep(2200);
	return 'ok: ${key} region=['+r.x0+','+r.x1+') name='+r.name+' perch='+Math.round(p.x)+','+Math.round(p.y)+' crest='+p.run;
})()`;

const BOSS_SCENE = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const r=window.__skyFind('frost');
	if(!r) return 'region-not-found:frost';
	window.__skyHover(r.center, -42);
	await sleep(900);
	const p=window.__skyPerch(r,false);
	window.__skyHover(p.x, p.y-3);
	await sleep(600);
	// force the regional boss + a couple of native grunts into frame
	const gt=window.MM.world.getTile;
	MM.mobs.forceSpawn(r.boss, window.player, gt);
	MM.mobs.forceSpawn(r.grunt, window.player, gt);
	MM.mobs.forceSpawn(r.grunt, window.player, gt);
	MM.mobs.setAggro(r.boss); MM.mobs.setAggro(r.grunt);
	await sleep(1400);
	const d=MM.mobs.diagnose(gt);
	const boss=(d.species[r.boss]||0), grunts=(d.species[r.grunt]||0);
	if(!boss) return 'boss-missing:'+JSON.stringify(d.species);
	return 'ok: boss='+r.boss+'x'+boss+' grunts='+r.grunt+'x'+grunts+' totalSkyMobs='+d.total;
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-skybiomeqa-'));
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

		let failed = false;
		const run = async (label, expr) => {
			const res = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 120000 });
			const verdict = res && res.result ? res.result.value : '(no result)';
			console.log(label + ':', verdict);
			if (!String(verdict).startsWith('ok')) failed = true;
			return verdict;
		};
		const shoot = async suffix => {
			const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
			const file = `${outBase}-${suffix}.png`;
			await writeFile(file, Buffer.from(shot.data, 'base64'));
			console.log('wrote', file);
		};

		await run('boot', BOOT);
		await run('skywood', scene('skywood', false));
		await shoot('a');
		await run('ember', scene('ember', true));
		await shoot('b');
		await run('wreck', scene('wreck', false));
		await shoot('c');
		await run('boss', BOSS_SCENE);
		await shoot('d');

		if (pageErrors.length) console.log('pageErrors:', pageErrors.slice(0, 5).join('\n---\n'));
		if (failed || pageErrors.length) process.exitCode = 1;
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
