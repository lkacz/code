#!/usr/bin/env node
// Live QA for Grafika Ultra (engine/post_fx.js): boots headless Edge over raw
// CDP (seed 777, throwaway profile, marker-scoped kill — NEVER a global
// msedge.exe taskkill), then walks the five ultra components through their
// observable seams in two stages:
//   A. standard mode draws NOTHING (metrics frozen while all toggles are off);
//      then __mmForceGfxUltra + a sealed open-air pond beside the hero (the
//      boats-qa pond pattern) -> water reflection columns accumulate, and the
//      hero coating draws over the hero.
//   B. deep cave pockets -> bloom emitters found, halos drawn, specular glints
//      accumulate; then __mmNoPostFX freezes every metric again (kill switch).
// Exit code 0 only when every assertion holds. Two PNGs (<out>-pond.png and
// <out>-deep.png) are written for eyeballing.
//
// Usage: npm start (server on 8123), then:
//   node tools/gfx-ultra-qa.mjs [out.png] [--url=http://127.0.0.1:8123/index.html] [--seed=777]
import { spawn, execFile } from 'node:child_process';
import { writeFile, mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const out = (args.find(a => !a.startsWith('--')) || 'gfx-ultra-qa.png').replace(/\.png$/i, '');
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

const STAGE_A = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	for(let i=0;i<400 && !(window.MM && MM.background && MM.fog && MM.postFx && MM.world && MM.worldGen && window.player && window.__mmDebugHero);i++) await sleep(100);
	if(!(window.MM && MM.postFx && MM.world && window.player)) return 'FAIL boot-timeout mm='+!!window.MM+' postFx='+!!(window.MM&&MM.postFx);
	MM.fog.setRevealAll(true);
	const ui=document.getElementById('ui'); if(ui) ui.style.display='none';
	MM.background.importState({cycleT:0.25});
	const M=MM.postFx.metrics;
	const snap=()=>({scans:M.bloomScans|0,bloom:M.bloomDraws|0,refl:M.reflectionColumns|0,spec:M.specGlints|0,sheen:M.heroSheenDraws|0,shadow:M.shadowDraws|0,rays:M.godRayBeams|0,tint:M.tintDraws|0,shim:M.shimmerSlices|0,wet:M.wetSheenColumns|0,motes:M.dustMotes|0,ice:M.iceColumns|0});
	// 1) standard mode: every ULTRA metric must stay frozen. bloomScans/bloomDraws
	//    are deliberately excluded — since glow became an attribute they belong to
	//    the glow pass, which is standard and ungated by design, so the shared
	//    emitter scan legitimately keeps running with every ultra toggle off.
	const ultraOnly=(s)=>{ const o={...s}; delete o.scans; delete o.bloom; return o; };
	const s0=snap(); await sleep(1500); const s1=snap();
	if(JSON.stringify(ultraOnly(s1))!==JSON.stringify(ultraOnly(s0))) return 'FAIL standard-mode-drew '+JSON.stringify([s0,s1]);
	// 2) force ultra; sealed open-air pond beside the hero (boats-qa pattern) so
	// reflections get guaranteed OPEN water regardless of biome (frozen lakes
	// have open:false by design and correctly skip the mirror)
	window.__mmForceGfxUltra=true;
	const peek=(x,y)=>{ try{ return MM.world.peekTile(x,y,0); }catch(e){ return 0; } };
	const sx0=Math.floor(player.x);
	const surf0=MM.worldGen.surfaceHeight(sx0);
	// sealed basin regardless of terrain: solid floor + walls (a real local
	// solid id peeked from deep underground), open sky above, 3 rows of water
	const solidId=peek(sx0,surf0+10)||3;
	const px0=sx0+2, base=surf0;
	for(let k=0;k<16;k++){
		const x=px0+k;
		for(let y=base-5;y<base;y++) MM.world.setTile(x,y,0);
		MM.world.setTile(x,base+3,solidId);
		MM.world.setTile(x,base,8);
		MM.world.setTile(x,base+1,8);
		MM.world.setTile(x,base+2,8);
	}
	for(const wx of [px0-1,px0+16]){
		for(let y=base-1;y<=base+3;y++) MM.world.setTile(wx,y,solidId);
	}
	await sleep(800);
	window.__mmDebugHero(sx0, base-2);
	await sleep(1500);
	const s2=snap(); await sleep(2500); const s3=snap();
	const pondWater=peek(px0+8,base)===8;
	window.__gfxQaPond={sx0,base,px0,solidId};
	return 'OK '+JSON.stringify({reflDelta:s3.refl-s2.refl,sheenDelta:s3.sheen-s2.sheen,shadowDelta:s3.shadow-s2.shadow,motesDelta:s3.motes-s2.motes,pondWater,pondAt:px0+','+base,solidId,scans:s3.scans});
})()`;

const STAGE_B = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const M=MM.postFx.metrics;
	const snap=()=>({scans:M.bloomScans|0,bloom:M.bloomDraws|0,refl:M.reflectionColumns|0,spec:M.specGlints|0,sheen:M.heroSheenDraws|0,shadow:M.shadowDraws|0,rays:M.godRayBeams|0,tint:M.tintDraws|0,shim:M.shimmerSlices|0,wet:M.wetSheenColumns|0,motes:M.dustMotes|0,ice:M.iceColumns|0});
	const peek=(x,y)=>{ try{ return MM.world.peekTile(x,y,0); }catch(e){ return 0; } };
	// deep cave pockets: bloom emitters (lava/glowshrooms/altars) + specular
	// ores. Teleport to each band FIRST so chunks generate, then hop into a
	// real air pocket (the tile-art-shot cave-scene pattern).
	let bloomSeen=0; const specStart=snap().spec; const pockets=[];
	const oxBase=Math.floor(player.x);
	for(let band=0; band<8 && bloomSeen<1; band++){
		const bx=oxBase+140*(band+1)*((band%2)?1:-1);
		window.__mmDebugHero(bx, 215);
		await sleep(1200);
		let pocket=null;
		for(let x=bx-40;x<=bx+40 && !pocket;x++){
			for(let y=195;y<=250;y++){
				if(peek(x,y)===0 && peek(x,y+1)===0 && peek(x-1,y)===0 && peek(x+1,y)===0 && peek(x,y+2)!==0){ pocket={x,y:y+1}; break; }
			}
		}
		if(!pocket) continue;
		pockets.push(pocket.x+','+pocket.y);
		window.__mmDebugHero(pocket.x,pocket.y);
		await sleep(1400);
		if(window.player) player.hp=player.maxHp; // lava-adjacent pockets must not kill the run
		bloomSeen=Math.max(bloomSeen, M.bloomEmitters|0);
	}
	await sleep(1800);
	const s4=snap();
	const specDelta=s4.spec-specStart;
	return 'OK '+JSON.stringify({bloomSeen,bloomDraws:s4.bloom,specDelta,pockets:pockets.length});
})()`;

const STAGE_D = `(async()=>{
	// Diagnostic: call each stalled pass DIRECTLY with a mock ctx over the live
	// world — separates "pass broken" from "call site never reached".
	const mockCanvas=document.createElement('canvas'); mockCanvas.width=1600; mockCanvas.height=900;
	const mock={n:0,di:0,fillStyle:'',globalAlpha:1,globalCompositeOperation:'',imageSmoothingEnabled:false,
		canvas:mockCanvas,
		getTransform(){ return {a:1,b:0,c:0,d:1,e:0,f:200}; },
		save(){},restore(){},beginPath(){},rect(){},clip(){},translate(){},scale(){},rotate(){},moveTo(){},lineTo(){},closePath(){},fill(){},ellipse(){},
		fillRect(){ this.n++; },drawImage(){ this.di++; },
		createLinearGradient(){ return {addColorStop(){}}; }};
	const P=MM.postFx;
	const gT=(x,y)=>{ try{ return MM.world.peekTile(x,y,0); }catch(e){ return 0; } };
	const sH=x=>MM.worldGen.surfaceHeight(x);
	window.__mmForceWet=true;
	const base={TILE:20,sx:-45,sy:0,viewX:90,viewY:45,getTile:gT,surfaceHeight:sH,visibleAt:()=>true,frameMs:16};
	const r={};
	try{ r.wet=P.drawWetGroundPass(mock,{...base,rainingAt:()=>false,skipWetTile:()=>false,daylight:1}); }catch(e){ r.wet='ERR '+e.message; }
	try{ r.ice=P.drawIceReflectionsPass(mock,{...base}); }catch(e){ r.ice='ERR '+e.message; }
	try{ r.rays=P.drawGodRaysPass(mock,{...base,isCanopy:t=>t===6||t===39,time:{tDay:0.3,isDay:true},daylight:1}); }catch(e){ r.rays='ERR '+e.message; }
	try{ r.tint=P.drawLightTintPass(mock,{...base}); }catch(e){ r.tint='ERR '+e.message; }
	try{ r.shim=P.drawHeatShimmerPass(mock,{...base,pools:null}); }catch(e){ r.shim='ERR '+e.message; }
	delete window.__mmForceWet;
	r.ops=mock.n+'/'+mock.di;
	r.on=[P.on('wetGround'),P.on('iceReflections')].join(',');
	r.mainHasWet=(await (await fetch('src/main.js')).text()).includes("gfxUltraOn('wetGround')");
	return 'OK '+JSON.stringify(r);
})()`;

const STAGE_C = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const M=MM.postFx.metrics;
	const snap=()=>({scans:M.bloomScans|0,bloom:M.bloomDraws|0,refl:M.reflectionColumns|0,spec:M.specGlints|0,sheen:M.heroSheenDraws|0,shadow:M.shadowDraws|0,rays:M.godRayBeams|0,tint:M.tintDraws|0,shim:M.shimmerSlices|0,wet:M.wetSheenColumns|0,motes:M.dustMotes|0,ice:M.iceColumns|0});
	const pond=window.__gfxQaPond;
	if(!pond) return 'FAIL no-pond-handoff';
	// back to the surface stage set: ice-cap part of the pond, a surface lava
	// strip (shimmer + tint + bloom source), a built canopy with a guaranteed
	// gap (god rays at dawn), and forced wetness for the rain sheen.
	// A death in the lava pockets triggers the death-travel cinematic, which
	// would drag the camera away from the stage — heal and re-teleport until
	// the hero actually stands at the pond before sampling anything.
	let atPond=false;
	for(let i=0;i<20 && !atPond;i++){
		if(window.player){ player.hp=player.maxHp; }
		window.__mmDebugHero(pond.sx0, pond.base-2);
		await sleep(600);
		atPond=!!(window.player && Math.abs(player.x-pond.sx0)<12 && player.hp>0);
	}
	if(!atPond) return 'FAIL hero-never-reached-pond hx='+(window.player?Math.round(player.x):'?');
	await sleep(600);
	// Every prop sits on ITS OWN column's surfaceHeight — the ice/wet scans read
	// surfaceHeight(x) per column and terrain rolls, so a flat row misses.
	const sh=x=>MM.worldGen.surfaceHeight(x);
	// ice sheet on untouched terrain right of the pond
	for(let k=20;k<=24;k++){ const x=pond.px0+k; MM.world.setTile(x,sh(x),12); MM.world.setTile(x,sh(x)-1,0); }
	// penned lava pit left of the pond: stone walls, lava at the surface, air above
	for(let x=pond.px0-12;x<=pond.px0-10;x++){ const s=sh(x); MM.world.setTile(x,s-1,0); MM.world.setTile(x,s,13); MM.world.setTile(x,s+1,pond.solidId); }
	for(const wx of [pond.px0-13,pond.px0-9]){ const s=sh(wx); MM.world.setTile(wx,s-1,pond.solidId); MM.world.setTile(wx,s,pond.solidId); }
	// bare STONE (literal id 3 — pond.solidId could be frozen dirt in a frozen
	// band, which gfxWetSkipTile would skip) for the wet sheen
	for(let k=26;k<=29;k++){ const x=pond.px0+k; MM.world.setTile(x,sh(x),3); }
	// A closed canopy ROOF with a guaranteed three-column hole, anchored per
	// COLUMN surface so rolling terrain keeps every column inside the scan's
	// window. It has to be a roof and the hole has to be narrow: beams are gated
	// on how enclosed the site is (a shaft is lit air, invisible against open
	// sky) and a break wider than GAP_MAX_WIDTH is a clearing, not a hole.
	for(let k=-9;k<=7;k++){
		if(k>=-2 && k<=0) continue;            // the hole the light comes through
		const cx=pond.sx0+k; MM.world.setTile(cx,sh(cx)-7,6);
	}
	MM.background.importState({cycleT:0.15}); // guaranteed daytime morning sun
	window.__mmForceWet=true;
	await sleep(1600);
	// rAF liveness probe: headless pages can silently stop ticking (the ghost-qa
	// occlusion gotcha) — count real frames through the measurement window
	let rafTicks=0; const rafT0=performance.now();
	const rafProbe=()=>{ rafTicks++; if(performance.now()-rafT0<3800) requestAnimationFrame(rafProbe); };
	requestAnimationFrame(rafProbe);
	const c0=snap(); await sleep(2200); const c1=snap();
	const peek2=(x,y)=>{ try{ return MM.world.peekTile(x,y,0); }catch(e){ return 0; } };
	const probes={
		lava:[peek2(pond.px0-12,sh(pond.px0-12)),peek2(pond.px0-11,sh(pond.px0-11))],
		ice:peek2(pond.px0+22,sh(pond.px0+22)),
		stone:peek2(pond.px0+27,sh(pond.px0+27)),
		time:(MM.background && MM.background.timeInfo)?(function(){const ti=MM.background.timeInfo(); return {tDay:+ti.tDay.toFixed(3),isDay:!!ti.isDay};})():null
	};
	// kill switch freezes every pass mid-session
	window.__mmNoPostFX=true;
	await sleep(400);
	const k0=snap(); await sleep(1500); const k1=snap();
	const killOk=JSON.stringify(k1)===JSON.stringify(k0);
	delete window.__mmNoPostFX;
	delete window.__mmForceWet;
	MM.background.importState({cycleT:0.25});
	return 'OK '+JSON.stringify({raysDelta:c1.rays-c0.rays,tintDelta:c1.tint-c0.tint,shimDelta:c1.shim-c0.shim,wetDelta:c1.wet-c0.wet,iceDelta:c1.ice-c0.ice,killOk,hx:window.player?Math.round(player.x):null,rafTicks,probes,c0,c1});
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-gfxqa-'));
	const proc = spawn(edge, [
		'--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
		'--force-device-scale-factor=1',
		'--remote-debugging-port=0',
		`--user-data-dir=${profile}`,
		'--window-size=1600,900',
		'about:blank'
	], { stdio: 'ignore' });

	let ws, failed = false, pump = null;
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
					try { pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 500)); } catch (e) { /* ignore */ }
				}
			}
		};

		await send(ws, 'Page.enable');
		await send(ws, 'Runtime.enable');
		await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
		await send(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: `
			const __origGEBI=Document.prototype.getElementById;
			Document.prototype.getElementById=function(id){
				const el=__origGEBI.call(this,id);
				if(id==='seedInput' && el && el.value==='auto') el.value=${JSON.stringify(seed)};
				return el;
			};` });
		await send(ws, 'Page.navigate', { url });
		for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await sleep(250);
		await sleep(1500);

		// Keep-front pump: headless pages silently stop ticking rAF when the
		// browser decides they are occluded (the ghost-qa gotcha) — nudging the
		// page to the front every 2 s keeps the render loop alive through the
		// long staged evaluates.
		pump = setInterval(() => { send(ws, 'Page.bringToFront').catch(() => {}); }, 2000);
		const evalStage = async (label, expr) => {
			const r = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 180000 });
			const status = r && r.result ? String(r.result.value) : '(no result)';
			console.log(label + ':', status);
			return status;
		};
		const statusA = await evalStage('stageA', STAGE_A);
		const shotA = await send(ws, 'Page.captureScreenshot', { format: 'png' });
		await writeFile(out + '-pond.png', Buffer.from(shotA.data, 'base64'));
		const statusB = statusA.startsWith('OK ') ? await evalStage('stageB', STAGE_B) : 'SKIPPED';
		const shotB = await send(ws, 'Page.captureScreenshot', { format: 'png' });
		await writeFile(out + '-deep.png', Buffer.from(shotB.data, 'base64'));
		const statusC = statusB.startsWith('OK ') ? await evalStage('stageC', STAGE_C) : 'SKIPPED';
		const statusD = statusC.startsWith('OK ') ? await evalStage('stageD', STAGE_D) : 'SKIPPED';
		const shotC = await send(ws, 'Page.captureScreenshot', { format: 'png' });
		await writeFile(out + '-dawn.png', Buffer.from(shotC.data, 'base64'));
		console.log('wrote', out + '-pond.png', out + '-deep.png', out + '-dawn.png');
		if (pageErrors.length) console.log('pageErrors:', pageErrors.slice(0, 5).join('\n---\n'));

		if (!statusA.startsWith('OK ') || !statusB.startsWith('OK ') || !statusC.startsWith('OK ') || !statusD.startsWith('OK ')){ failed = true; console.error('gfx-ultra-qa: a stage failed'); }
		else {
			const a = JSON.parse(statusA.slice(3));
			const b = JSON.parse(statusB.slice(3));
			const c = JSON.parse(statusC.slice(3));
			const d = JSON.parse(statusD.slice(3));
			const checks = [
				// environment first: a dead render loop or a botched stage set must
				// take the blame BEFORE any pass-level check points at the passes
				['render loop ticks through stage C (rAF alive)', c.rafTicks > 40],
				['stage set: lava pit survived', Array.isArray(c.probes.lava) && c.probes.lava[0] === 13],
				['stage set: ice sheet placed at its surface', c.probes.ice === 12],
				['stage set: bare stone ground placed', c.probes.stone === 3],
				['stage set: morning daylight active', !!(c.probes.time && c.probes.time.isDay)],
				['direct invocation: wet pass draws on the live world', Number(d.wet) > 0],
				['direct invocation: ice pass draws on the live world', Number(d.ice) > 0],
				['direct invocation: god rays draw on the live world', Number(d.rays) > 0],
				['direct invocation: light tint draws on the live world', Number(d.tint) > 0],
				['QA pond holds water', a.pondWater === true],
				['reflections draw over open pond water', a.reflDelta > 0],
				['hero coating draws over the hero', a.sheenDelta > 0],
				['dynamic shadows draw in daylight', a.shadowDelta > 0],
				['dust motes drift in daylight air', a.motesDelta > 0],
				['bloom finds emissive tiles at depth', b.bloomSeen > 0],
				['bloom halos actually draw', b.bloomDraws > 0],
				['specular glints accumulate', b.specDelta > 0],
				['god rays beam through the canopy gap at dawn', c.raysDelta > 0],
				['light temperature washes around the lava strip', c.tintDelta > 0],
				['heat shimmer wobbles above open lava', c.shimDelta > 0],
				['wet sheen coats non-frozen ground', c.wetDelta > 0],
				['ice sheet mirrors the scene', c.iceDelta > 0],
				['__mmNoPostFX freezes all passes', c.killOk === true]
			];
			for (const [label, ok] of checks){
				console.log((ok ? 'PASS ' : 'FAIL ') + label);
				if (!ok) failed = true;
			}
		}
	} finally {
		try { if (pump) clearInterval(pump); } catch (e) { /* not started */ }
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
	if (failed) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
