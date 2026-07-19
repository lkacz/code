#!/usr/bin/env node
// Live end-to-end QA for the nature-details wave: avalanches tear a deep slab
// off a slope, icicles seed/drip/drop, a lake glazes into thin ice that breaks
// under the hero, an ORGANIC hot spring warms and heals, fog/aurora moods
// force on, the weathervane+rod register and a strike banks charge, graffiti
// paints on backed cells, footprints press into drifts — in the real game,
// with a clean console.
//
// Usage: node tools/nature-details-qa.mjs [--url=http://127.0.0.1:8123/index.html] [--seed=777]
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
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

const SCENE = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const R={};
	for(let i=0;i<400 && !(window.MM && MM.world && MM.worldGen && MM.avalanche && MM.icicles && MM.thinIce && MM.geothermal && MM.skyMoods && MM.weatherInstruments && MM.graffiti && MM.softDrifts && window.__mmDebugHero);i++) await sleep(100);
	if(!(window.MM && MM.avalanche)) return {fatal:'boot-timeout'};
	MM.fog.setRevealAll(true);
	const T=MM.T, WG=MM.worldGen, gt=MM.world.getTile, st=MM.world.setTile;
	const poll=async(fn,budgetMs)=>{ const t0=Date.now(); while(Date.now()-t0<budgetMs){ if(fn()) return true; await sleep(600);} return fn(); };

	// stage far from spawn (tutorial NPC overlay would freeze the sim)
	const stageX=Math.floor(window.player.x)+150;
	window.__mmDebugHero(stageX, WG.surfaceHeight(stageX)-3);
	await sleep(1200);

	// --- 1. avalanche: a deep slab on a built shelf lets go on a shock --------
	const ax=stageX+12, aSurf=WG.surfaceHeight(ax);
	for(let x=ax;x<=ax+6;x++){
		for(let y=aSurf-7;y<=aSurf+2;y++) st(x,y,T.STONE);   // the shelf
		for(let d=1;d<=4;d++) st(x,aSurf-7-d,T.SNOW);         // 4-deep pack on top
	}
	for(let x=ax+7;x<=ax+13;x++) for(let y=WG.surfaceHeight(x)-2;y>=aSurf-16;y--) st(x,y,T.AIR); // a clean drop beside it
	MM.avalanche.config.WAVE_STEP_MS=40;
	const run=MM.avalanche.disturb(ax+3,aSurf-8,2,gt);
	await poll(()=>MM.avalanche.metrics().tilesReleased>=4, 8000);
	let topsGone=0;
	for(let x=ax;x<=ax+6;x++) if(gt(x,aSurf-11)!==T.SNOW) topsGone++;
	R.avalanche={run, released:MM.avalanche.metrics().tilesReleased, topsGone};

	// --- 2. icicles: overhang -> seeded teeth -> thaw drop --------------------
	const ix=stageX-14, iSurf=WG.surfaceHeight(ix);
	for(let x=ix;x<=ix+8;x++){
		st(x,iSurf-8,T.STONE);           // the slab
		st(x,iSurf-9,T.SNOW);            // moisture on top
		for(let y=iSurf-7;y<=iSurf-3;y++) st(x,y,T.AIR); // open air under it
	}
	window.__mmDebugHero(ix+4, iSurf-5);
	await sleep(500);
	const seeded=MM.icicles.seedAround(window.player.x, window.player.y, gt);
	const hangingNow=MM.icicles.metrics().hanging;
	MM.icicles.dropAll();
	await poll(()=>MM.icicles.metrics().shards===0, 9000);
	R.icicles={seeded, hanging:hangingNow, fallen:MM.icicles.metrics().fallen};

	// --- 3. thin ice: glaze a built pool, stand on it, go under ---------------
	const px2=stageX-30, pSurf=WG.surfaceHeight(px2);
	for(let x=px2;x<=px2+6;x++){
		st(x,pSurf,T.WATER); st(x,pSurf+1,T.WATER);
		st(x,pSurf+2,T.STONE);
		for(let y=pSurf-1;y>=pSurf-4;y--) st(x,y,T.AIR);
	}
	try{ for(let x=px2;x<=px2+6;x++) MM.water.onTileChanged(x,pSurf,gt); }catch(e){}
	const frozen=MM.thinIce.freezeAround(px2+3, 6, gt, st);
	const glazed=gt(px2+3,pSurf)===T.THIN_ICE;
	window.__mmDebugHero(px2+3.5, pSurf-1.2);
	const brokeUnder=await poll(()=>MM.thinIce.metrics().broken>=1, 12000);
	R.thinIce={frozen, glazed, brokeUnder, panes:MM.thinIce.metrics().panes};

	// --- 4. geothermal: the ORGANIC spring — water / hot rock / lava ----------
	window.__mmDebugHero(stageX-50, WG.surfaceHeight(stageX-50)-3);
	await sleep(500);
	const built=MM.geothermal.buildSpring(window.player.x, window.player.y, gt, st);
	const sx0=Math.floor(window.player.x)+3;
	const warm=await poll(()=>MM.geothermal.warmWaterAt(sx0+2, Math.floor(window.player.y)-1, gt) || MM.geothermal.warmWaterAt(sx0+2, Math.floor(window.player.y), gt), 6000);
	window.player.hp=Math.max(5,Math.floor(window.player.maxHp*0.4));
	const hp0=window.player.hp;
	window.__mmDebugHero(sx0+2.5, Math.floor(window.player.y)-0.6);
	const soaked=await poll(()=>MM.geothermal.metrics().heroSoaking, 8000);
	await sleep(3500);
	R.spring={built, warm, soaked, healed:+(window.player.hp-hp0).toFixed(2)};
	window.__mmDebugHero(stageX, WG.surfaceHeight(stageX)-3);
	await sleep(400);

	// --- 5. sky moods: forced fog then forced aurora --------------------------
	MM.skyMoods.forceMood('fog',0.9);
	const foggy=await poll(()=>MM.skyMoods.fogLevel()>0.5, 9000);
	const sightShrunk=MM.skyMoods.mobSightMult()<0.8;
	MM.skyMoods.forceMood('fog',0);
	MM.skyMoods.forceMood('aurora',0.9);
	const auroral=await poll(()=>MM.skyMoods.auroraLevel()>0.5, 9000);
	MM.skyMoods.forceMood('aurora',0);
	R.moods={foggy, sightShrunk, auroral};

	// --- 6. instruments: vane+rod register, a strike banks into the rod -------
	const wx=stageX+4, wSurf=WG.surfaceHeight(wx);
	st(wx,wSurf-1,T.WEATHERVANE);
	const rx=stageX+7, rSurf=WG.surfaceHeight(rx);
	// a mast needs a mast BASE: an unsupported rod is a rigid object and pops
	// loose (nature-sim pins that route) — the churn made registration racy
	for(let y=rSurf-3;y<=rSurf;y++) st(rx,y,T.STONE);
	st(rx,rSurf-4,T.LIGHTNING_ROD);
	for(let y=rSurf-5;y>=rSurf-12;y--) st(rx,y,T.AIR);
	await poll(()=>{ const m=MM.weatherInstruments.metrics(); return m.vanes>=1 && m.rods>=1; }, 12000);
	const reg=MM.weatherInstruments.metrics();
	const strike=MM.clouds.strike(rx+0.5,gt,st);
	const banked=await poll(()=>MM.weatherInstruments.metrics().strikesBanked>=1, 5000);
	R.instruments={vanes:reg.vanes, rods:reg.rods, strikeRod:!!(strike&&strike.rod), banked, energy:MM.weatherInstruments.metrics().energy, heroSafe:!!(strike&&strike.sheltered)};

	// --- 7. graffiti: pigment on backed cells only, whitelist holds ------------
	const gx=stageX-4, gSurf=WG.surfaceHeight(gx);
	const painted=MM.graffiti.paintAt(gx,gSurf,'heart',1,gt);
	const airRefused=!MM.graffiti.paintAt(gx,gSurf-6,'x',1,gt);
	const badGlyph=!MM.graffiti.paintAt(gx+1,gSurf,'evil',1,gt);
	R.graffiti={painted, airRefused, badGlyph, marks:MM.graffiti.metrics().marks};

	// --- 8. footprints: a walked drift carries tracks -------------------------
	MM.softDrifts.seedAround(Math.floor(window.player.x), 4, 'snow', 6, gt, st);
	MM.softDrifts._debug.stampBodyPrints({x:window.player.x,y:window.player.y,w:0.7,h:0.95,vx:1.2,vy:0});
	R.prints={count:MM.softDrifts.metrics().prints};

	// --- 9. toolbox + mob nature seams ----------------------------------------
	R.panel=!!document.getElementById('natureDebugBox');
	R.natureMobs=!!(MM.mobs && MM.mobs.natureMetrics && typeof MM.mobs.natureMetrics().drinks==='number');
	R.frameMs=window.__mmFrameMs;
	return R;
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-nature-qa-'));
	const proc = spawn(edge, ['--headless=new','--disable-gpu','--no-first-run','--hide-scrollbars','--force-device-scale-factor=1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--window-size=1600,900','about:blank'], { stdio: 'ignore' });
	let ws, failures = [];
	const check = (ok, label) => { if (ok) console.log('  ok:', label); else { failures.push(label); console.log('  FAIL:', label); } };
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
		const events = [], pageErrors = [];
		ws.onmessage = ev => {
			const m = JSON.parse(ev.data);
			if (m.id && pending.has(m.id)){ const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
			else if (m.method){
				events.push(m.method);
				if (m.method === 'Runtime.exceptionThrown'){ try { pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300)); } catch (e) { /* ignore */ } }
				if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error'){ try { pageErrors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200)); } catch (e) { /* ignore */ } }
			}
		};
		await send(ws, 'Page.enable');
		await send(ws, 'Runtime.enable');
		await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
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
		// headless occlusion freezes rAF a few seconds in — keep fronting the tab
		await send(ws, 'Page.bringToFront');
		const keepFront = setInterval(() => { send(ws, 'Page.bringToFront').catch(() => {}); }, 1500);
		let evalRes;
		try{
			evalRes = await send(ws, 'Runtime.evaluate', { expression: SCENE, awaitPromise: true, returnByValue: true, timeout: 180000 });
		} finally {
			clearInterval(keepFront);
		}
		const R = evalRes && evalRes.result ? evalRes.result.value : null;
		if (!R || R.fatal) throw new Error('scene failed: ' + (R && R.fatal || 'no result'));
		console.log('report:', JSON.stringify(R));

		console.log('avalanche:');
		check(R.avalanche.run >= 2 && R.avalanche.released >= 4, 'a shocked slab releases a downhill run (' + R.avalanche.run + ' cols, ' + R.avalanche.released + ' tiles)');
		// released snow re-stacks onto neighbouring columns as it lands, so the
		// exact count of bare tops swings 1..3 run to run — released>=4 above is
		// the real release assert; one bare top proves the slab actually left
		check(R.avalanche.topsGone >= 1, 'the released columns lost pack tops (' + R.avalanche.topsGone + '/7)');
		console.log('icicles:');
		check(R.icicles.seeded >= 2 && R.icicles.hanging >= 2, 'the overhang grew teeth (' + R.icicles.hanging + ')');
		check(R.icicles.fallen >= 2, 'the thaw dropped them (' + R.icicles.fallen + ')');
		console.log('thin ice:');
		check(R.thinIce.frozen >= 4 && R.thinIce.glazed, 'the pool glazed over (' + R.thinIce.frozen + ' panes)');
		check(R.thinIce.brokeUnder, 'a standing hero cracks and breaks the sheet');
		console.log('hot spring:');
		check(R.spring.built && R.spring.warm, 'lava under stone under water reads as a warm pool');
		check(R.spring.soaked, 'the hero soak is detected (swim-chill exempt)');
		check(R.spring.healed > 0.5, 'the spring heals (' + R.spring.healed + ' hp)');
		console.log('sky moods:');
		check(R.moods.foggy && R.moods.sightShrunk, 'forced fog builds and shortens creature sight');
		check(R.moods.auroral, 'forced aurora lights up');
		console.log('instruments:');
		check(R.instruments.vanes >= 1 && R.instruments.rods >= 1, 'vane + rod registered from the world scan');
		check(R.instruments.strikeRod && R.instruments.banked && R.instruments.energy > 0, 'a strike re-aims into the rod and banks charge (' + R.instruments.energy + ' E)');
		check(R.instruments.heroSafe, 'the rod is the shelter — the strike hurts nobody');
		console.log('graffiti:');
		check(R.graffiti.painted && R.graffiti.marks >= 1, 'pigment lands on a backed cell');
		check(R.graffiti.airRefused && R.graffiti.badGlyph, 'open air and unknown glyphs are refused');
		console.log('footprints:');
		check(R.prints.count >= 1, 'a walked drift carries tracks (' + R.prints.count + ')');
		console.log('toolbox:');
		check(R.panel === true, 'the nature debug panel is injected');
		check(R.natureMobs === true, 'mob nature-drive metrics are live');
		console.log('console:');
		check(pageErrors.length === 0, 'no console errors / uncaught exceptions' + (pageErrors.length ? ' -> ' + pageErrors.slice(0, 3).join(' | ') : ''));
	} finally {
		try { if (ws) ws.close(); } catch (e) { /* closing */ }
		await new Promise(res => {
			if (process.platform === 'win32'){
				const marker = profile.split(/[\\/]/).pop();
				execFile('powershell', ['-NoProfile', '-Command',
					`Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }`
				], () => res());
			} else { try { proc.kill(); } catch (e) { /* gone */ } res(); }
		});
	}
	if (failures.length){
		console.error('\nnature-details-qa: ' + failures.length + ' failure(s)');
		process.exit(1);
	}
	console.log('\nnature-details-qa: all live checks passed');
}
main().catch(err => { console.error('nature-details-qa fatal:', err && err.message || err); process.exit(1); });
