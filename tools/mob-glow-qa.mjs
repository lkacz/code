#!/usr/bin/env node
// Live QA for creature light (poświata istot, engine/post_fx.js emissive
// registry). Everything here runs with EVERY ultra component OFF, because that
// is the claim: creature light is standard, at full quality. Proven at night,
// where a glow either reads or it does not:
//   1. species register their light and the pass draws it above the darkness
//      overlay — a firefly field measurably brightens the frame, and the QA kill
//      switch removes exactly that light, which is the A/B.
//   2. moving lamps leave a streak (world-space position history), and removing
//      every creature stops the streaks instead of leaving light hanging.
//   3. the bloom toggle does NOT change creature light — tile emitters are its
//      business, creatures own theirs.
//   4. cost: the pass is timed directly (400 cycles, 40 sources) instead of
//      guessed from frame deltas — headless frame-rate A/B is worthless here,
//      it once reported "all 12 ultra passes on" as faster than standard.
//
// Usage: npm start (server on 8123), then:
//   node tools/mob-glow-qa.mjs [--url=http://127.0.0.1:8123/index.html] [--seed=777]
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
const seed = opt('seed', '777');
const outDir = 'tools';

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

// Shared page helpers: metric deltas over a real window of frames, and a
// brightness probe over the middle of the canvas. getImageData is forbidden to
// the GAME (render-health taboo) but a QA driver may read the framebuffer.
const HELPERS = `
	window.__mg = {
		snap(){ const m=MM.postFx.metrics; return {s:m.emissiveSources|0,h:m.emissiveHalos|0,t:m.emissiveStreaks|0,b:m.bloomDraws|0}; },
		async delta(ms){
			const a=this.snap();
			await new Promise(r=>setTimeout(r,ms));
			const b=this.snap();
			return {s:b.s-a.s,h:b.h-a.h,t:b.t-a.t,b:b.b-a.b};
		},
		light(){
			const cv=document.getElementById('game');
			const g=cv.getContext('2d');
			const x0=Math.max(0,(cv.width>>1)-400), y0=Math.max(0,(cv.height>>1)-250);
			const w=Math.min(800,cv.width-x0), h=Math.min(500,cv.height-y0);
			const d=g.getImageData(x0,y0,w,h).data;
			let sum=0, lit=0, peak=0;
			for(let i=0;i<d.length;i+=16){
				const v=(d[i]+d[i+1]+d[i+2])/3;
				sum+=v; if(v>70) lit++; if(v>peak) peak=v;
			}
			const n=d.length/16;
			return {mean:+(sum/n).toFixed(2), lit, peak:peak|0};
		}
	};
`;

const BOOT = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	for(let i=0;i<400 && !(window.MM && MM.background && MM.fog && MM.postFx && MM.mobs && MM.world && MM.worldGen && window.player && window.__mmDebugHero);i++) await sleep(100);
	if(!(window.MM && MM.postFx && MM.mobs && MM.world && window.player)) return 'FAIL boot-timeout';
	${HELPERS}
	MM.fog.setRevealAll(true);
	MM.background.importState({cycleT:0.85});   // night: a glow either reads or it does not
	const ui=document.getElementById('ui'); if(ui) ui.style.display='none';
	// REAL config path, standard tier: every ultra component off
	for(const name of MM.postFx.COMPONENTS) MM.postFx.set(name,false);
	const t=MM.background.timeInfo();
	if(t && t.isDay) return 'FAIL still-daytime';
	return 'OK '+JSON.stringify({isDay:!!(t&&t.isDay)});
})()`;

// A firefly field on open ground: the species whose whole read is its lamp.
const SCENE_FIREFLY = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const bx=520, surf=MM.worldGen.surfaceHeight(bx);
	window.__mmDebugHero(bx, surf-3);
	await sleep(1200);
	MM.mobs.clearAll();
	MM.mobs.freezeSpawns(true);
	let n=0;
	for(let i=0;i<18;i++) if(MM.mobs.forceSpawn('FIREFLY',window.player,MM.world.getTile)) n++;
	await sleep(1400);
	if(window.player) player.hp=player.maxHp;
	// standard tier with the light, then the same frame with it killed
	const on=await window.__mg.delta(700);
	const lightOn=window.__mg.light();
	window.__mmNoPostFX=true;
	await sleep(500);
	const off=await window.__mg.delta(700);
	const lightOff=window.__mg.light();
	delete window.__mmNoPostFX;
	await sleep(400);
	return 'OK '+JSON.stringify({n,on,off,lightOn,lightOff,tier:MM.postFx.emissiveTier()});
})()`;

// The same field with bloom ON: creature light must be untouched by that toggle,
// and with every creature gone the streaks must stop instead of hanging in the air.
const SCENE_FIREFLY_BLOOM = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	MM.postFx.set('bloom',true);
	await sleep(900);
	const withBloom=await window.__mg.delta(900);
	MM.postFx.set('bloom',false);
	await sleep(600);
	const withoutBloom=await window.__mg.delta(900);
	MM.mobs.clearAll();
	await sleep(1400);
	const empty=await window.__mg.delta(700);
	const ratio=(d)=>d.s>0 ? +(d.h/d.s).toFixed(2) : 0;
	return 'OK '+JSON.stringify({
		withBloom:{...withBloom,ratio:ratio(withBloom)},
		withoutBloom:{...withoutBloom,ratio:ratio(withoutBloom)},
		empty, tier:MM.postFx.emissiveTier()
	});
})()`;

// Bats in a sealed stone room: red eyes are the marquee case — two points of
// light on an erratic flight path, in a place with no other light at all.
const SCENE_BAT = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const bx=760, cy=232;
	window.__mmDebugHero(bx, cy);
	await sleep(1200);
	const cx=Math.floor(player.x);
	for(let x=cx-16;x<=cx+16;x++) for(let y=cy-12;y<=cy+5;y++) MM.world.setTile(x,y,3);
	for(let x=cx-15;x<=cx+15;x++) for(let y=cy-11;y<=cy+3;y++) MM.world.setTile(x,y,0);
	window.__mmDebugHero(cx, cy+3);
	await sleep(1200);
	MM.mobs.clearAll();
	let n=0;
	for(let i=0;i<8;i++) if(MM.mobs.forceSpawn('BAT',window.player,MM.world.getTile)) n++;
	await sleep(1600);
	if(window.player) player.hp=player.maxHp;
	const d=await window.__mg.delta(900);
	const light=window.__mg.light();
	window.__mmNoPostFX=true;
	await sleep(500);
	const lightOff=window.__mg.light();
	delete window.__mmNoPostFX;
	await sleep(400);
	return 'OK '+JSON.stringify({n,d,light,lightOff});
})()`;

// The radiation cockroach: named in the report as "just a green outline drawn on".
// It used to paint a flat additive ellipse (hard rim, constant alpha) inside the
// mob pass, so the darkness overlay dimmed it right back down.
const SCENE_ROACH = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	MM.mobs.clearAll();
	let n=0;
	for(let i=0;i<10;i++) if(MM.mobs.forceSpawn('RADIATION_COCKROACH',window.player,MM.world.getTile)) n++;
	await sleep(1800);
	if(window.player) player.hp=player.maxHp;
	const d=await window.__mg.delta(900);
	const light=window.__mg.light();
	window.__mmNoPostFX=true;
	await sleep(500);
	const lightOff=window.__mg.light();
	delete window.__mmNoPostFX;
	await sleep(400);
	return 'OK '+JSON.stringify({n,d,light,lightOff});
})()`;

// Direct cost of the entity pass, plus the tile bloom pass for comparison — the
// question being whether either is heavy enough to deserve hiding behind a toggle.
const SCENE_COST = `(()=>{
	const cv=document.getElementById('game');
	const ctx=cv.getContext('2d');
	const P=MM.postFx;
	const TILE=MM.TILE||20;
	const N=400, SOURCES=40, TYPICAL=12;
	const queue=(count,withTrail)=>{
		for(let i=0;i<count;i++){
			P.addEmissive({x:600+((i*37)%700),y:400+((i*53)%300),r:7+(i%5),
				color:i%2?'#ffe068':'#ff5a5a',a:0.5,
				key:withTrail?('bench'+i):undefined,trail:withTrail});
		}
	};
	const run=(count,withTrail)=>{
		for(let i=0;i<40;i++){ queue(count,withTrail); P.drawEmissivePass(ctx,{now:performance.now()}); }
		const t0=performance.now();
		for(let i=0;i<N;i++){ queue(count,withTrail); P.drawEmissivePass(ctx,{now:performance.now()+i*20}); }
		return +(((performance.now()-t0)/N)*1000).toFixed(1);
	};
	ctx.save();
	P.set('bloom',false);
	const stillUs=run(SOURCES,false);
	const streakUs=run(SOURCES,true);
	const typicalUs=run(TYPICAL,true);   // a firefly field / bat cave, streaks and all
	// tile bloom for comparison, over the real world under the camera
	P.set('bloom',true);
	const bopts={TILE,sx:Math.floor(player.x)-40,sy:Math.floor(player.y)-25,viewX:80,viewY:50,
		getTile:MM.world.getTile,frameMs:16};
	for(let i=0;i<40;i++) P.drawBloomPass(ctx,bopts);
	const b0=performance.now();
	for(let i=0;i<N;i++) P.drawBloomPass(ctx,bopts);
	const bloomUs=+(((performance.now()-b0)/N)*1000).toFixed(1);
	const emitters=P.metrics.bloomEmitters|0;
	ctx.restore();
	P.set('bloom',false);
	return 'OK '+JSON.stringify({stillUs,streakUs,typicalUs,bloomUs,emitters,n:N,sources:SOURCES,typical:TYPICAL});
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-glowqa-'));
	const proc = spawn(edge, [
		'--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
		'--force-device-scale-factor=1',
		'--remote-debugging-port=0',
		`--user-data-dir=${profile}`,
		'--window-size=1600,900',
		'about:blank'
	], { stdio: 'ignore' });

	let ws, pump = null, failed = false;
	try {
		let target = null;
		for (let i = 0; i < 60 && !target; i++){
			await sleep(250);
			try {
				const portLine = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0].trim();
				if (!portLine) continue;
				const list = await (await fetch(`http://127.0.0.1:${portLine}/json/list`)).json();
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
					try { pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 600)); } catch (e) { /* ignore */ }
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
		// an occluded headless page freezes rAF: keep it front or the sim stalls
		pump = setInterval(() => { send(ws, 'Page.bringToFront').catch(() => {}); }, 2000);

		const evalStage = async (label, expr) => {
			const r = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 180000 });
			const status = r && r.result ? String(r.result.value) : '(no result)';
			console.log(label + ':', status);
			return status;
		};
		const snapClip = async (name) => {
			const shot = await send(ws, 'Page.captureScreenshot', { format: 'png', clip: { x: 500, y: 200, width: 600, height: 480, scale: 2 } });
			await writeFile(join(outDir, 'mob-glow-qa-' + name), Buffer.from(shot.data, 'base64'));
		};

		const boot = await evalStage('boot', BOOT);
		if(!boot.startsWith('OK')) throw new Error('boot failed: ' + boot);
		const rFly = await evalStage('firefly-standard', SCENE_FIREFLY);
		await snapClip('firefly-standard.png');
		const rFlyB = await evalStage('firefly-bloom', SCENE_FIREFLY_BLOOM);
		await snapClip('firefly-bloom.png');
		const rBat = await evalStage('bat-eyes', SCENE_BAT);
		await snapClip('bat-eyes.png');
		const rRoach = await evalStage('cockroach', SCENE_ROACH);
		await snapClip('cockroach.png');
		const rCost = await evalStage('cost', SCENE_COST);
		if (pageErrors.length) console.log('pageErrors:', pageErrors.slice(0, 5).join('\n---\n'));

		if(![rFly, rFlyB, rBat, rRoach, rCost].every(s => s.startsWith('OK '))){
			failed = true;
			console.error('a scene failed');
		} else {
			const fly = JSON.parse(rFly.slice(3));
			const flyB = JSON.parse(rFlyB.slice(3));
			const bat = JSON.parse(rBat.slice(3));
			const roach = JSON.parse(rRoach.slice(3));
			const cost = JSON.parse(rCost.slice(3));
			const checks = [
				['fireflies spawned', fly.n >= 8],
				['creature light is standard, no ultra component needed', fly.tier === 1],
				['species register their light every frame', fly.on.s > 0],
				['two blits per source: wide bleed under a tight core', fly.on.h >= fly.on.s * 1.8],
				['wandering lamps leave a streak with every ultra pass off', fly.on.t > 0],
				['tile bloom stays off in standard mode', fly.on.b === 0],
				['the kill switch removes the creature light entirely', fly.off.s === 0 && fly.off.h === 0 && fly.off.t === 0],
				// the whole point: the light must be VISIBLE, not merely executed
				['the firefly field measurably brightens the night', fly.lightOn.mean > fly.lightOff.mean],
				['the glow raises lit-pixel count', fly.lightOn.lit > fly.lightOff.lit],
				// the bloom toggle owns TILE emitters; creatures own their own light
				['the bloom toggle does not change creature light', flyB.tier === 1 && Math.abs(flyB.withBloom.ratio - flyB.withoutBloom.ratio) < 0.2],
				['removing every creature stops the streaks (no light left hanging)', flyB.empty.t === 0 && flyB.empty.s === 0],
				['bats spawned in the sealed room', bat.n >= 4],
				['bat eyes register light', bat.d.s > 0],
				['bat eyes streak across the room', bat.d.t > 0],
				['the sealed room is measurably lit by the eyes alone', bat.light.mean > bat.lightOff.mean],
				// the named regression: "just a green outline drawn on"
				['cockroaches spawned', roach.n >= 4],
				['cockroach isotope light is registered, not a flat ellipse', roach.d.s > 0 && roach.d.h >= roach.d.s * 1.8],
				['skittering cockroaches leave a streak', roach.d.t > 0],
				['cockroach light survives the darkness overlay', roach.light.mean > roach.lightOff.mean],
				// Cost: the numbers behind the "standard, no toggle" decision. These
				// are software-canvas microseconds for a deliberately pessimistic 40
				// sources (2.5x a real scene); the guards catch a regression, they are
				// not the gameplay figure — typicalUs is.
				['a typical scene (12 sources, streaks and all) stays under 200us', cost.typicalUs < 200],
				['a pessimistic 40 sources stays under 550us', cost.stillUs < 550 && cost.streakUs < 550],
				['streaks are not the expensive part (the wide bleed is)', cost.streakUs < cost.stillUs * 1.4]
			];
			for(const [name, ok] of checks){
				console.log((ok ? 'PASS  ' : 'FAIL  ') + name);
				if(!ok) failed = true;
			}
			console.log('cost/frame: typical(' + cost.typical + ' sources)=' + cost.typicalUs +
				'us | pessimistic(' + cost.sources + ') still=' + cost.stillUs + 'us streaking=' + cost.streakUs +
				'us | tile bloom=' + cost.bloomUs + 'us (' + cost.emitters + ' emitters), n=' + cost.n);
			console.log('light: glow mean=' + fly.lightOn.mean + ' lit=' + fly.lightOn.lit +
				' vs killed mean=' + fly.lightOff.mean + ' lit=' + fly.lightOff.lit +
				' | bat room ' + bat.light.mean + ' vs ' + bat.lightOff.mean +
				' | roaches ' + roach.light.mean + ' vs ' + roach.lightOff.mean);
			console.log(failed ? 'mob-glow-qa: FAILURES above' : 'mob-glow-qa: all checks passed');
		}
	} finally {
		try { if (pump) clearInterval(pump); } catch (e) { /* none */ }
		try { if (ws) ws.close(); } catch (e) { /* closing */ }
		// marker-scoped kill: never taskkill msedge.exe, that would take the user's browser
		await new Promise(res => {
			if (process.platform === 'win32'){
				const marker = profile.split(/[\\/]/).pop();
				execFile('powershell', ['-NoProfile', '-Command',
					`Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }`], () => res());
			} else { try { proc.kill('SIGKILL'); } catch (e) { /* gone */ } res(); }
		});
		await sleep(600);
		try { await rm(profile, { recursive: true, force: true }); } catch (e) { /* locked */ }
	}
	if (failed) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
