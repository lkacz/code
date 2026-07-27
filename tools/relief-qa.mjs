#!/usr/bin/env node
// Live QA for Ultra relief (baked micro-bumps + face bevels, the 14th
// component). The whole feature is a BAKE change, so metrics prove nothing —
// what matters is pixels, driven through the REAL toggle path:
//
//   1. stage one wall of each relief family beside the hero, in daylight;
//   2. screenshot the wall with relief OFF;
//   3. CLICK the actual pause-panel checkbox (the same handler a player uses —
//      it must both set the component and drop the chunk caches);
//   4. screenshot again: the wall must visibly change;
//   5. click it OFF again: the wall must return to the original pixels —
//      which proves the gate (standard bakes byte-identical), the cache
//      invalidation (a stale cache would keep the relief) and bake
//      determinism (a Math.random in the bake would never re-converge).
//
// The time of day is re-pinned before every shot so the global daylight tint
// cannot masquerade as a relief diff.
//
// Usage: npm start (server on 8123), then:
//   node tools/relief-qa.mjs [out.png] [--url=http://127.0.0.1:8123/index.html] [--seed=777]
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const out = (args.find(a => !a.startsWith('--')) || 'relief-qa.png').replace(/\.png$/i, '');
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

// Stage: a 4-tall, 4-wide block of each family standing ON the surface next to
// the hero — supported builds, so falling.js has no claim on them.
const STAGE = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	for(let i=0;i<400 && !(window.MM && MM.postFx && MM.world && MM.worldGen && MM.background && MM.fog && window.player && window.__mmDebugHero);i++) await sleep(100);
	if(!(window.MM && MM.postFx && MM.world && window.player)) return 'FAIL boot-timeout';
	MM.fog.setRevealAll(true);
	const ui=document.getElementById('ui'); if(ui) ui.style.display='none';
	MM.background.importState({cycleT:0.30});
	const W=MM.world, WG=MM.worldGen;
	// SURFACE, on open plains, away from spawn. The hunt vetoes forests (leaves
	// wave over the wall), and the fixture materials veto the two slow world
	// processes that broke earlier attempts: plain ice melts beside anything
	// warm and snow keeps a volumetric melt layer no restage can reach, so the
	// frost family is represented by MOTHER_ICE. The tutorial NPC idles around
	// x=0, out of reach of the +30 offset.
	const start=Math.round(player.x)+30;
	const mats=[3,54,2,72,5,67];   // stone, dirt, sand, MOTHER_ICE, wood, brick
	const SPAN=mats.length*5-2;
	let site=null;
	for(let d=0; d<600 && site===null; d++){
		const s=start+d;
		let ok=true, lo=1e9, hi=-1e9;
		for(let k=-2;k<=SPAN+2 && ok;k++){
			// surfaceHeight is worldgen's NOMINAL surface; the real terrain can
			// have caves, dips and trees the nominal row knows nothing about — a
			// wall placed on the nominal row once stood on thin air and shed its
			// wood block column by column. Trust only tiles: the ground cell must
			// be genuinely solid and the cells above it empty (loose snow cover
			// is fine — the stage clears it).
			const h=WG.surfaceHeight(s+k);
			if(!Number.isFinite(h)){ ok=false; break; }
			if(h<lo) lo=h; if(h>hi) hi=h;
			if(hi-lo>1){ ok=false; break; }
			const gt=W.getTile(s+k,h);
			if(gt===0 || gt===8 || gt===13){ ok=false; break; }
			for(let dy=1;dy<=12 && ok;dy++){ const t=W.getTile(s+k,h-dy); if(t!==0 && t!==7) ok=false; }
		}
		if(ok){ site=s; window.__mmReliefFloor=hi; }
	}
	if(site===null){
		const sample=[];
		for(const s of [start, start+50, start+120, start+250, start+400]){
			const h=WG.surfaceHeight(s); const above=[]; for(let dy=0;dy<=4;dy++) above.push(W.getTile(s,h-dy));
			sample.push({s,h,above});
		}
		return 'FAIL no-clear-plains '+JSON.stringify(sample);
	}
	// anchor on the LOWEST ground row in the window: a column one tile higher
	// simply swallows the block's bottom row and still supports it
	const surf=window.__mmReliefFloor;
	for(let b=0;b<mats.length;b++){
		const x0=site+b*5;
		for(let dx=0;dx<4;dx++) for(let dy=1;dy<=4;dy++) W.setTile(x0+dx, surf-dy, mats[b]);
	}
	window.__mmDebugHero(site-4, surf-2);
	await sleep(2400);   // hero settles onto the ground, camera eases in, AT FULL SPEED
	if(window.player) player.hp=player.maxHp;
	// Only NOW slow the sim clock 10x (the seam's floor): daylight buckets stop
	// stepping between shots. Slowing it before the settle kept the hero
	// falling in slow motion for the whole run and the camera chased him.
	window.__simulationTimeScale=0.1;
	await sleep(400);
	const probes=mats.map((m,b)=>W.getTile(site+b*5, surf-2));
	if(String(probes)!==String(mats)){
		const ground=[]; for(let k=0;k<SPAN;k+=2) ground.push(W.getTile(site+k, surf));
		const woodCol=[]; for(let dy=0;dy<=5;dy++) woodCol.push(W.getTile(site+20, surf-dy));
		return 'FAIL wall-not-staged '+JSON.stringify({probes, ground, woodCol, site, surf});
	}
	return 'OK '+JSON.stringify({site, surf, wallX0:site, wallX1:site+mats.length*5-2, topY:surf-4, botY:surf-1});
})()`;

// Where each material block lands on SCREEN, via the camera's own arithmetic
// (__mmWorldToScreen). The live ctx transform outside the draw loop holds
// whatever was set LAST — usually the UI matrix — which is how the first
// version of this driver photographed a rectangle of sky and clouds and blamed
// the diff on the bake. Per-BLOCK rects also skip the air gaps between blocks,
// so no drifting sky pixel is ever part of the comparison.
const RECTS = (g) => `(()=>{
	if(typeof window.__mmWorldToScreen!=='function') return 'FAIL no-seam';
	const rects=[];
	for(let b=0;b<6;b++){
		const tl=window.__mmWorldToScreen(${g.wallX0}+b*5, ${g.topY});
		const br=window.__mmWorldToScreen(${g.wallX0}+b*5+4, ${g.botY}+1);
		// bottom inset 8px: the surface tile UNDER each block is turf whose live
		// sway animation reaches a few px up into the block's bottom row
		rects.push({x:Math.round(tl.x)+2, y:Math.round(tl.y)+2, w:Math.round(br.x-tl.x)-4, h:Math.round(br.y-tl.y)-10});
	}
	return 'OK '+JSON.stringify(rects);
})()`;

// Everything that moves on its own clock gets PINNED before a shot: the sun
// (importState), the clouds (snapshot/restore), the wind (override). Without
// this the A/B measures weather, not the bake.
const PIN = (g) => `(()=>{
	MM.background.importState({cycleT:0.30});
	// An EMPTY deterministic sky, not a pinned one: restoring a cloud snapshot
	// re-places the clouds but not the phase of their precipitation particles,
	// and a snowflake drifting in front of a block is a ~250-luma diff. No
	// clouds, no flakes, no cloud shadows.
	MM.clouds.reset();
	if(MM.clouds.setWindOverride) MM.clouds.setWindOverride(0);
	// The atmosphere has more moods than clouds: a sandstorm or an aurora/fog
	// mood rolling in on its own schedule re-tints EVERY pixel in the frame —
	// the deterministic-looking warm shift between the first and last shot.
	if(MM.sandstorm && MM.sandstorm.reset) MM.sandstorm.reset();
	if(MM.skyMoods && MM.skyMoods.reset) MM.skyMoods.reset();
	// No walkers: a hare hopping through the frame is a diff, and a hare
	// STAMPING FOOTPRINTS on the snow block is a diff that survives restage
	// (the footprint plane rides on top of the tile, not in it).
	if(MM.mobs && MM.mobs.clearAll) MM.mobs.clearAll();
	window.__mmPinInfo={clearAll:!!(MM.mobs&&MM.mobs.clearAll), mobs:(MM.mobs&&MM.mobs.serialize)?MM.mobs.serialize().list.length:-1};
	// RESTAGE: the world keeps living between shots — precipitation deposits
	// drifts on the block tops, and a drift above a block flips its oU bake.
	// Re-assert the staged tiles and the air above them so every shot bakes
	// from the same world.
	const W=MM.world, mats=[3,54,2,72,5,67];
	for(let b=0;b<mats.length;b++){
		const x0=${g.wallX0}+b*5;
		for(let dx=0;dx<4;dx++){
			for(let dy=1;dy<=4;dy++) W.setTile(x0+dx, ${g.surf}-dy, mats[b]);
			for(let dy=5;dy<=7;dy++) W.setTile(x0+dx, ${g.surf}-dy, 0);
		}
		for(let dy=1;dy<=7;dy++) W.setTile(x0+4, ${g.surf}-dy, 0);   // the gap air
	}
	// NOTE deliberately ABSENT: no hero re-teleport here. An earlier version
	// re-pinned him every shot, which LIFTED him off the ground each time;
	// physics dropped him back, the camera eased after him, and the whole wall
	// slid half a tile between shots. He settles once at stage time and stays.
	return 'OK '+JSON.stringify(window.__mmPinInfo);
})()`;

const TOGGLE = (on) => `(()=>{
	const chk=document.querySelector('[data-gfx-toggle="relief"]');
	if(!chk) return 'FAIL no-checkbox';
	if(chk.checked!==${on}){ chk.click(); }
	return 'OK '+JSON.stringify({checked:chk.checked, config:!!MM.postFx.config.relief});
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-reliefqa-'));
	const proc = spawn(edge, [
		'--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
		'--force-device-scale-factor=1', '--remote-debugging-port=0',
		`--user-data-dir=${profile}`, '--window-size=1600,900', 'about:blank'
	], { stdio: 'ignore' });

	let ws, failed = false, pump = null;
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
		const events = [], pageErrors = [];
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
		pump = setInterval(() => { send(ws, 'Page.bringToFront').catch(() => {}); }, 2000);

		const run = async (label, expr) => {
			const r = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 180000 });
			const status = r && r.result ? String(r.result.value) : '(no result)';
			console.log(label + ':', status.length > 240 ? status.slice(0, 240) + '…' : status);
			return status;
		};
		const stage = await run('stage', STAGE);
		if (!stage.startsWith('OK ')) throw new Error('stage failed');
		const g = JSON.parse(stage.slice(3));
		const rectS = await run('rects', RECTS(g));
		if (!rectS.startsWith('OK ')) throw new Error('rects failed');
		const rects = JSON.parse(rectS.slice(3));
		const rx0 = Math.min(...rects.map(r => r.x)) - 8, ry0 = Math.min(...rects.map(r => r.y)) - 8;
		const rx1 = Math.max(...rects.map(r => r.x + r.w)) + 8, ry1 = Math.max(...rects.map(r => r.y + r.h)) + 8;
		const clip = { x: Math.max(0, rx0), y: Math.max(0, ry0), width: Math.min(1600, rx1) - Math.max(0, rx0), height: Math.min(900, ry1) - Math.max(0, ry0), scale: 1 };
		// block rects relative to the clip, for the in-page diff mask
		const local = rects.map(r => ({ x: r.x - clip.x, y: r.y - clip.y, w: r.w, h: r.h }));

		// The camera must hold still across ALL shots or the rects stop lying
		// over the blocks and the diff measures parallax. Recompute the wall's
		// screen position before every shot and fail LOUDLY as a staging error
		// if it moved — a debugging session went down a false "global tint"
		// trail because this guard did not exist.
		const rectsRef = JSON.stringify(rects);
		const guardCamera = async () => {
			const rr = await run('rects', RECTS(g));
			if (!rr.startsWith('OK ') || JSON.stringify(JSON.parse(rr.slice(3))) !== rectsRef){
				throw new Error('camera drifted between shots — staging error, not a relief defect');
			}
		};
		// The comparison runs INSIDE the page (decode PNGs there), so the
		// driver needs no image library — and it counts ONLY pixels inside the
		// material blocks, never the animated sky between them.
		const shoot = async () => (await send(ws, 'Page.captureScreenshot', { format: 'png', clip })).data;
		const diffInPage = async (a, b) => {
			const r = await send(ws, 'Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async()=>{
				const load=(d)=>new Promise((res,rej)=>{ const im=new Image(); im.onload=()=>res(im); im.onerror=rej; im.src='data:image/png;base64,'+d; });
				const A=await load(${JSON.stringify(a)}), B=await load(${JSON.stringify(b)});
				const w=Math.min(A.width,B.width), h=Math.min(A.height,B.height);
				const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
				const c2=cv.getContext('2d',{willReadFrequently:true});
				c2.drawImage(A,0,0); const da=c2.getImageData(0,0,w,h).data;
				c2.clearRect(0,0,w,h); c2.drawImage(B,0,0); const db=c2.getImageData(0,0,w,h).data;
				const rects=${JSON.stringify(local)};
				// GLOBAL TINT CANCELLATION: the daylight pipeline low-passes its
				// tint with state no importState resets, so two shots seconds
				// apart can differ by a uniform cast over every pixel. Relief is
				// LOCAL structure; compare contrast, not absolutes — subtract
				// each shot's own mean (per channel, over the rects) first.
				let sumA=[0,0,0], sumB=[0,0,0], n=0;
				for(const rc of rects){
					for(let y=Math.max(0,rc.y); y<Math.min(h,rc.y+rc.h); y++) for(let x=Math.max(0,rc.x); x<Math.min(w,rc.x+rc.w); x++){
						const i=(y*w+x)*4;
						for(let c=0;c<3;c++){ sumA[c]+=da[i+c]; sumB[c]+=db[i+c]; }
						n++;
					}
				}
				const mA=sumA.map(v=>v/Math.max(1,n)), mB=sumB.map(v=>v/Math.max(1,n));
				let changed=0, total=0, maxd=0;
				for(const rc of rects){
					for(let y=Math.max(0,rc.y); y<Math.min(h,rc.y+rc.h); y++){
						for(let x=Math.max(0,rc.x); x<Math.min(w,rc.x+rc.w); x++){
							const i=(y*w+x)*4;
							const d=Math.abs(da[i]-db[i])+Math.abs(da[i+1]-db[i+1])+Math.abs(da[i+2]-db[i+2]);
							total++;
							if(d>18) changed++;
							if(d>maxd) maxd=d;
						}
					}
				}
				let bx0=1e9,by0=1e9,bx1=-1,by1=-1;
				for(const rc of rects){
					for(let y=Math.max(0,rc.y); y<Math.min(h,rc.y+rc.h); y++) for(let x=Math.max(0,rc.x); x<Math.min(w,rc.x+rc.w); x++){
						const i=(y*w+x)*4;
						const d=Math.abs(da[i]-db[i])+Math.abs(da[i+1]-db[i+1])+Math.abs(da[i+2]-db[i+2]);
						if(d>18){ if(x<bx0)bx0=x; if(x>bx1)bx1=x; if(y<by0)by0=y; if(y>by1)by1=y; }
					}
				}
				return JSON.stringify({changed, total, maxd, box:[bx0,by0,bx1,by1]});
			})()` });
			return JSON.parse(r.result.value);
		};

		await run('pin', PIN(g));
		await sleep(500);
		await run('pin', PIN(g));
		await sleep(300);
		await guardCamera();
		const shotOff = await shoot();
		const t1 = await run('toggleOn', TOGGLE(true));
		if (!t1.startsWith('OK ') || !JSON.parse(t1.slice(3)).config) { failed = true; console.error('FAIL  the panel checkbox did not enable relief'); }
		await sleep(2200);   // re-bake of the visible chunks
		await run('pin', PIN(g));
		await sleep(300);
		await guardCamera();
		const shotOn = await shoot();
		const t0 = await run('toggleOff', TOGGLE(false));
		if (!t0.startsWith('OK ') || JSON.parse(t0.slice(3)).config) { failed = true; console.error('FAIL  the panel checkbox did not disable relief'); }
		await sleep(2200);
		await run('pin', PIN(g));
		await sleep(300);
		await guardCamera();
		const shotOff2 = await shoot();

		await writeFile(out + '-off.png', Buffer.from(shotOff, 'base64'));
		await writeFile(out + '-on.png', Buffer.from(shotOn, 'base64'));
		await writeFile(out + '-revert.png', Buffer.from(shotOff2, 'base64'));
		console.log('wrote', out + '-off.png', out + '-on.png', out + '-revert.png');

		// one full frame with relief ON, for the human eye — the crops prove the
		// delta, this shows whether the WORLD looks right
		await run('fullOn', TOGGLE(true));
		await sleep(2000);
		const full = await send(ws, 'Page.captureScreenshot', { format: 'png' });
		await writeFile(out + '-full.png', Buffer.from(full.data, 'base64'));
		await run('fullOff', TOGGLE(false));
		console.log('wrote', out + '-full.png');

		const dOn = await diffInPage(shotOff, shotOn);
		const dRevert = await diffInPage(shotOff, shotOff2);
		console.log('diff on:', JSON.stringify(dOn), ' revert:', JSON.stringify(dRevert));
		const checks = [
			// the blocks span ~6x(76x156) px; the bumps and bevels must touch a
			// real fraction of them or the effect is a rounding error, not a
			// feature (the repo has measured a "delta>0" that no eye could see)
			['relief visibly changes the baked blocks (>2% of their pixels)', dOn.changed > dOn.total * 0.02],
			// and the revert must actually revert: proves the gate, the cache
			// drop AND bake determinism in one comparison
			['toggling off restores the standard bake (<0.2% residue)', dRevert.changed < dOn.total * 0.002]
		];
		for (const [name, ok] of checks){ console.log((ok ? 'PASS  ' : 'FAIL  ') + name); if (!ok) failed = true; }
		if (pageErrors.length) console.log('pageErrors:', pageErrors.slice(0, 3).join('\n---\n'));
	} catch (e){
		failed = true;
		console.error('relief-qa error:', e && e.message);
	} finally {
		if (pump) clearInterval(pump);
		try { if (ws) ws.close(); } catch (e) { /* closing */ }
		// marker-scoped kill: only the process this driver spawned
		try { proc.kill(); } catch (e) { /* already gone */ }
		await sleep(400);
	}
	process.exit(failed ? 1 : 0);
}

main();
