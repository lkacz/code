#!/usr/bin/env node
// Live QA for Ultra relief (the 14th component): per-tile convexity whose
// LIGHT DIRECTION is decided every frame, not baked.
//
// Part one — does it draw at all? Stage one wall of each relief family beside
// the hero, screenshot with the component off, CLICK the actual pause-panel
// checkbox, screenshot again, click it off. That proves the gate, the cache
// invalidation and determinism, per material.
//
// Part two — and this is the part that matters — does it MOVE? The first
// relief shipped with its key light baked into the chunk canvas: a block lit
// from the top-left stayed lit from the top-left through midnight and past
// every torch, which is a texture, not a bump map. So the swap tests isolate
// the relief LAYER by subtraction — (component on) minus (component off) at
// one light position, which cancels the sky tint, the darkness overlay and
// the torch's own halo — and then compare that layer against the same layer
// with the light somewhere else. A baked relief scores exactly zero: its
// layer is byte-identical whatever the light does. Two light moves are
// measured, the sun crossing the sky and a torch crossing the wall.
//
// Everything with its own clock (sun, clouds, wind, sky moods, mobs) is
// re-pinned before every shot, and the camera is re-checked before every
// capture — a camera that drifted would hand back a huge score for nothing.
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
// mirrors RELIEF_BUDGET in post_fx.js — the driver asserts the pass respects it
const RELIEF_TILE_CAP = 1200;
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
	const mats=[3,54,2,72,5,67,71];   // stone, dirt, sand, MOTHER_ICE, wood, brick, UFO_CONCRETE (meteor family)
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
	for(let b=0;b<7;b++){
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
// Which cycleT values put the sun low in the east and low in the west. The
// swap test needs the KEY LIGHT to cross the sky, and cycleT is not tDay — the
// mapping runs through the season calendar, so it is probed, never assumed.
const FINDSUN = `(()=>{
	let dawn=null, dusk=null, night=null;
	for(let i=0;i<=200;i++){
		const c=i/200;
		MM.background.importState({cycleT:c});
		const ti=MM.background.timeInfo();
		if(!ti || !Number.isFinite(ti.tDay)) continue;
		if(ti.isDay){
			if(!dawn || Math.abs(ti.tDay-0.10)<Math.abs(dawn.tDay-0.10)) dawn={c,tDay:+ti.tDay.toFixed(3)};
			if(!dusk || Math.abs(ti.tDay-0.90)<Math.abs(dusk.tDay-0.90)) dusk={c,tDay:+ti.tDay.toFixed(3)};
		}else if(!night || Math.abs(ti.tDay-0.5)<Math.abs(night.tDay-0.5)) night={c,tDay:+ti.tDay.toFixed(3)};
	}
	if(!dawn||!dusk||!night) return 'FAIL no-phases';
	return 'OK '+JSON.stringify({dawn,dusk,night});
})()`;

// cycleT and torch position are parameters because the swap tests move exactly
// one of them and hold everything else still. torchX<0 means no torch.
const PIN = (g, cycleT = 0.30, torchX = -1) => `(()=>{
	MM.background.importState({cycleT:${cycleT}});
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
	const W=MM.world, mats=[3,54,2,72,5,67,71];
	for(let b=0;b<mats.length;b++){
		const x0=${g.wallX0}+b*5;
		for(let dx=0;dx<4;dx++){
			for(let dy=1;dy<=4;dy++) W.setTile(x0+dx, ${g.surf}-dy, mats[b]);
			for(let dy=5;dy<=7;dy++) W.setTile(x0+dx, ${g.surf}-dy, 0);
		}
		for(let dy=1;dy<=7;dy++) W.setTile(x0+4, ${g.surf}-dy, 0);   // the gap air
	}
	// The swap torch. A torch is passable and belongs to no edge family, so
	// tileOpenForEdge reports it exactly like AIR — placing one beside the wall
	// cannot change a single open-face mask, which is what makes it safe to
	// move between shots without re-baking anything the diff can see.
	W.setTile(${g.wallX0}-2, ${g.surf}-2, 0);
	W.setTile(${g.wallX1}+2, ${g.surf}-2, 0);
	if(${torchX}>=0) W.setTile(${torchX}, ${g.surf}-2, 16);
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
		// The clip is DERIVED from the wall's own screen rects, so when the camera
		// moves the crop moves with it and the block pixels land on the same texels
		// of the capture. That is what lets the view test compare two shots taken
		// from different camera positions at all.
		const clipFrom = (rs) => {
			const ax0 = Math.min(...rs.map(r => r.x)) - 8, ay0 = Math.min(...rs.map(r => r.y)) - 8;
			const ax1 = Math.max(...rs.map(r => r.x + r.w)) + 8, ay1 = Math.max(...rs.map(r => r.y + r.h)) + 8;
			return { x: Math.max(0, ax0), y: Math.max(0, ay0), width: Math.min(1600, ax1) - Math.max(0, ax0), height: Math.min(900, ay1) - Math.max(0, ay0), scale: 1 };
		};
		// block rects relative to the clip, for the in-page diff mask
		const localFrom = (rs, c) => rs.map(r => ({ x: r.x - c.x, y: r.y - c.y, w: r.w, h: r.h }));
		const clip = clipFrom(rects);
		const local = localFrom(rects, clip);
		const localRef = JSON.stringify(local);

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
		// A capture taken WHEREVER the camera currently is. The hero is teleported
		// a whole number of tiles, so the camera shift should be an exact pixel
		// count and the wall should sit at identical offsets inside the new crop.
		// That is asserted, not assumed: a sub-pixel slip would shift every block
		// by a pixel and hand back an enormous score for no reason at all.
		const shootHere = async () => {
			const rr = await run('rects', RECTS(g));
			if (!rr.startsWith('OK ')) throw new Error('rects failed');
			const rs = JSON.parse(rr.slice(3));
			const c = clipFrom(rs);
			if (JSON.stringify(localFrom(rs, c)) !== localRef){
				throw new Error('the camera did not land on a whole pixel — staging error, not a relief result'
					+ '  got=' + JSON.stringify(localFrom(rs, c)[0]) + ' want=' + JSON.stringify(local[0])
					+ '  rect0=' + JSON.stringify(rs[0]) + ' clip=' + JSON.stringify(c));
			}
			return (await send(ws, 'Page.captureScreenshot', { format: 'png', clip: c })).data;
		};
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
				// ONE pass: mean-corrected diff (the cancellation above is only real
				// if it is actually SUBTRACTED here — an earlier revision computed
				// the means and then compared raw absolutes, dead code an
				// adversarial review caught), per-BLOCK counts (an aggregate would
				// let four of six families go dark and still pass), and the bbox.
				let changed=0, total=0, maxd=0;
				let bx0=1e9,by0=1e9,bx1=-1,by1=-1;
				const perBlock=[];
				for(const rc of rects){
					let bc=0, bt=0;
					for(let y=Math.max(0,rc.y); y<Math.min(h,rc.y+rc.h); y++){
						for(let x=Math.max(0,rc.x); x<Math.min(w,rc.x+rc.w); x++){
							const i=(y*w+x)*4;
							let d=0;
							for(let c=0;c<3;c++) d+=Math.abs((da[i+c]-mA[c])-(db[i+c]-mB[c]));
							bt++;
							if(d>18){ bc++; if(x<bx0)bx0=x; if(x>bx1)bx1=x; if(y<by0)by0=y; if(y>by1)by1=y; }
							if(d>maxd) maxd=d;
						}
					}
					perBlock.push(+(bc/Math.max(1,bt)).toFixed(4));
					changed+=bc; total+=bt;
				}
				return JSON.stringify({changed, total, maxd, perBlock, box:[bx0,by0,bx1,by1]});
			})()` });
			return JSON.parse(r.result.value);
		};

			// THE SWAP TEST. Everything above proves relief draws something; this
			// proves it draws something DIFFERENT when the light moves, which is the
			// only property that distinguishes a bump map from a texture.
			//
			// It isolates the relief LAYER by subtraction — (relief on) minus
			// (relief off) at one light position — so the sky tint, the darkness
			// overlay and the torch's own halo all cancel inside each pair. Then it
			// compares the two isolated layers. A baked relief would produce two
			// byte-identical layers and score exactly 0 no matter how bright the
			// scene is; only a live one can score above it.
			const reliefLayerSwap = async (aOff, aOn, bOff, bOn) => {
				const r = await send(ws, 'Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async()=>{
					const load=(d)=>new Promise((res,rej)=>{ const im=new Image(); im.onload=()=>res(im); im.onerror=rej; im.src='data:image/png;base64,'+d; });
					const shots=await Promise.all([${JSON.stringify(aOff)},${JSON.stringify(aOn)},${JSON.stringify(bOff)},${JSON.stringify(bOn)}].map(load));
					const w=Math.min(...shots.map(s=>s.width)), h=Math.min(...shots.map(s=>s.height));
					const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
					const c2=cv.getContext('2d',{willReadFrequently:true});
					const px=shots.map(s=>{ c2.clearRect(0,0,w,h); c2.drawImage(s,0,0); return c2.getImageData(0,0,w,h).data; });
					const rects=${JSON.stringify(local)};
					const perBlock=[];
					let magA=0, magB=0, swap=0, n=0;
					for(const rc of rects){
						let bA=0,bB=0,bS=0,bn=0;
						for(let y=Math.max(0,rc.y); y<Math.min(h,rc.y+rc.h); y++) for(let x=Math.max(0,rc.x); x<Math.min(w,rc.x+rc.w); x++){
							const i=(y*w+x)*4;
							for(let c=0;c<3;c++){
								const la=px[1][i+c]-px[0][i+c];   // relief layer, light position A
								const lb=px[3][i+c]-px[2][i+c];   // relief layer, light position B
								bA+=Math.abs(la); bB+=Math.abs(lb); bS+=Math.abs(la-lb);
							}
							bn++;
						}
						bn=Math.max(1,bn);
						const mag=Math.max(bA,bB)/bn;
						perBlock.push({mag:+(mag).toFixed(2), swap:+(bS/bn).toFixed(2), ratio:+(bS/Math.max(1e-6,Math.max(bA,bB))).toFixed(3)});
						magA+=bA; magB+=bB; swap+=bS; n+=bn;
					}
					n=Math.max(1,n);
					return JSON.stringify({magA:+(magA/n).toFixed(2), magB:+(magB/n).toFixed(2), swap:+(swap/n).toFixed(2),
						ratio:+(swap/Math.max(1e-6,Math.max(magA,magB))).toFixed(3), perBlock});
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
		// Relief-bake DETERMINISM needs the relief bake photographed TWICE: the
		// revert comparison below only compares two STANDARD bakes, in which
		// drawTerrainRelief never ran (adversarial review). Toggle off and on
		// again — two full cache drops apart — and demand the same pixels.
		await run('cycleOff', TOGGLE(false));
		await sleep(900);
		await run('cycleOn', TOGGLE(true));
		await sleep(2200);
		await run('pin', PIN(g));
		await sleep(300);
		await guardCamera();
		const shotOn2 = await shoot();
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

			// --- the VIEW test ---------------------------------------------------
			// Light direction is only half of relief; the other half is where the
			// viewer stands. This moves the CAMERA and nothing else, so the same wall
			// under the same sun is seen once from the left and once from the right.
			//
			// Two things make it measurable. The hero is teleported a WHOLE number of
			// tiles, so the camera shift is an exact pixel count and the two crops
			// land on identical texels — a sub-pixel slip would show up as a huge
			// score for no reason. And the wall is kept beyond RELIEF_SRC_RANGE (15
			// tiles) in both positions, so the hero's own moving light contributes
			// nothing and the only thing that differs is the view angle.
			// 18 tiles, not more: the wall is 34 wide and the view 80, so a bigger
			// step pushes its far end off the screen edge and the crop clamps at 0.
			// (Measured the hard way — the first attempt used 26 and the guard
			// reported the wall's first block sitting at screen x=-52.)
			const VIEWSTEP = 18;
			const viewShot = async (side) => {
				await run('viewMove', `(async()=>{
					const sleep=ms=>new Promise(r=>setTimeout(r,ms));
					// Silence the hero's own light for this test. At 18 tiles he is
					// inside RELIEF_SRC_RANGE, and his moving source would re-shade the
					// wall all by itself — which is a REAL effect, already proven by the
					// torch run, but it is not the one being measured here. With it off,
					// the light on this wall is identical in both shots and the only
					// thing that differs between them is where the camera stands.
					if(MM.lighting && MM.lighting.config){
						if(window.__mmHeroGlowSave===undefined) window.__mmHeroGlowSave=MM.lighting.config.heroGlow;
						MM.lighting.config.heroGlow=0;
						if(MM.lighting.reset) MM.lighting.reset();
					}
					const sleep2=sleep;
					window.__simulationTimeScale=1;
					window.__mmDebugHero(${g.wallX0}+16+(${side})*${VIEWSTEP}, ${g.surf}-2);
					await sleep2(2200);
					window.__simulationTimeScale=0.1;
					await sleep2(400);
					return 'OK '+JSON.stringify({x:Math.round(player.x), heroGlow:MM.lighting?MM.lighting.config.heroGlow:-1});
				})()`);
				await run('reliefOff', TOGGLE(false));
				await run('pin', PIN(g, 0.30, -1));
				await sleep(1600);
				const off = await shootHere();
				await run('reliefOn', TOGGLE(true));
				await sleep(1600);
				const on = await shootHere();
				return [off, on];
			};
			const [vlOff, vlOn] = await viewShot(-1);   // hero left  => wall on the RIGHT of screen
			const [vrOff, vrOn] = await viewShot(1);    // hero right => wall on the LEFT of screen
			const viewSwap = await reliefLayerSwap(vlOff, vlOn, vrOff, vrOn);
			console.log('view swap (same wall, same sun, camera moved ' + (2 * VIEWSTEP) + ' tiles):', JSON.stringify(viewSwap));
			await writeFile(out + '-viewL.png', Buffer.from(vlOn, 'base64'));
			await writeFile(out + '-viewR.png', Buffer.from(vrOn, 'base64'));
			// Put the hero back where he started: every test after this one guards
			// the camera against the ORIGINAL rects and would otherwise report a
			// drift that this test caused on purpose.
			await run('viewHome', `(async()=>{
				const sleep=ms=>new Promise(r=>setTimeout(r,ms));
				if(MM.lighting && MM.lighting.config && window.__mmHeroGlowSave!==undefined){
					MM.lighting.config.heroGlow=window.__mmHeroGlowSave;
					if(MM.lighting.reset) MM.lighting.reset();
				}
				window.__simulationTimeScale=1;
				window.__mmDebugHero(${g.wallX0}-4, ${g.surf}-2);
				await sleep(2200);
				window.__simulationTimeScale=0.1;
				await sleep(400);
				return 'OK '+JSON.stringify({x:Math.round(player.x)});
			})()`);
			await guardCamera();

			// --- the swap runs ---------------------------------------------------
			const sunS = await run('findsun', FINDSUN);
			if (!sunS.startsWith('OK ')) throw new Error('sun phase probe failed');
			const sun = JSON.parse(sunS.slice(3));
			// One light position = four settled shots (off, on) so the layer can be
			// isolated. The camera is guarded before every one of them: this test
			// deliberately changes the WORLD's light and nothing else, and a camera
			// that drifted would hand back a huge score for no reason at all.
			const layerAt = async (cycleT, torchX) => {
				await run('reliefOff', TOGGLE(false));
				await run('pin', PIN(g, cycleT, torchX));
				await sleep(1600);
				await run('pin', PIN(g, cycleT, torchX));
				await sleep(400);
				await guardCamera();
				const off = await shoot();
				await run('reliefOn', TOGGLE(true));
				await sleep(1600);
				await run('pin', PIN(g, cycleT, torchX));
				await sleep(400);
				await guardCamera();
				const on = await shoot();
				return [off, on];
			};
			const [dawnOff, dawnOn] = await layerAt(sun.dawn.c, -1);
			const [duskOff, duskOn] = await layerAt(sun.dusk.c, -1);
			const sunSwap = await reliefLayerSwap(dawnOff, dawnOn, duskOff, duskOn);
			console.log('sun swap (dawn tDay=' + sun.dawn.tDay + ' vs dusk tDay=' + sun.dusk.tDay + '):', JSON.stringify(sunSwap));
			await writeFile(out + '-dawn.png', Buffer.from(dawnOn, 'base64'));
			await writeFile(out + '-dusk.png', Buffer.from(duskOn, 'base64'));

			// The torch pair: night, one torch, moved from the wall's left end to
			// its right end. Torch level is 13/15 so the near blocks are strongly
			// lit and the far ones barely — which is why this is scored on the
			// blocks nearest each torch, not on the wall average.
			const [tlOff, tlOn] = await layerAt(sun.night.c, g.wallX0 - 2);
			const [trOff, trOn] = await layerAt(sun.night.c, g.wallX1 + 2);
			const torchSwap = await reliefLayerSwap(tlOff, tlOn, trOff, trOn);
			console.log('torch swap (night, left end vs right end):', JSON.stringify(torchSwap));
			await writeFile(out + '-torchL.png', Buffer.from(tlOn, 'base64'));
			await writeFile(out + '-torchR.png', Buffer.from(trOn, 'base64'));

			// Cost, on the same scene that just proved the effect: tiles shaded per
			// frame, so the budget constant can be set from a number instead of a
			// guess. Measured with the component ON and the wall in view.
			await run('reliefOn', TOGGLE(true));
			await sleep(1200);
			const costS = await run('cost', `(async()=>{
				const m=MM.postFx.metrics;
				// Count REAL rAF callbacks. An earlier revision divided wall clock by
				// 16.7, i.e. assumed 60fps — and headless software rendering in a dense
				// scene runs at 16. That one assumption understated the per-frame cost
				// 3.6x, and very nearly shipped a budget cap the densest scene was
				// already sitting against.
				const a=m.reliefTiles, sc=m.reliefScanCap, t0=performance.now();
				let frames=0;
				await new Promise(done=>{ const tick=()=>{ frames++; if(performance.now()-t0<1000) requestAnimationFrame(tick); else done(); }; requestAnimationFrame(tick); });
				return 'OK '+JSON.stringify({perFrame:Math.round((m.reliefTiles-a)/Math.max(1,frames)), frames,
					fps:Math.round(frames*1000/(performance.now()-t0)), scanCapped:m.reliefScanCap-sc});
			})()`);
			const cost = costS.startsWith('OK ') ? JSON.parse(costS.slice(3)) : { perFrame: -1 };

			// WORST CASE, measured rather than assumed. A surface wall is the easy
			// scene: a flat horizon exposes one face per column. The population the
			// budget actually has to cover is a cave, where every tile of every
			// wall, ceiling and floor in view is an exposed face. Hollow a chamber
			// the size of the viewport, light it, and count. Runs last, after every
			// screenshot, so it disturbs nothing above it.
			const caveS = await run('caveCost', `(async()=>{
				const sleep=ms=>new Promise(r=>setTimeout(r,ms));
				const W=MM.world, m=MM.postFx.metrics;
				const cx=Math.round(player.x)+140, cy=${g.surf}+46;
				// A MINE WARREN, not a hall. The first version hollowed one big room
				// and measured 133 exposed faces — a big room only ever exposes its
				// FLOOR, so it was the sparsest underground case dressed up as the
				// densest. 4x4 chambers on a 6-tile pitch fill the view with lit wall,
				// which is the real ceiling on this pass's work.
				for(let x=cx-60;x<=cx+60;x++) for(let y=cy-30;y<=cy+30;y++) W.setTile(x,y,3);
				for(let rx=cx-56;rx<=cx+56;rx+=6) for(let ry=cy-26;ry<=cy+26;ry+=6){
					for(let dx=0;dx<4;dx++) for(let dy=0;dy<4;dy++) W.setTile(rx+dx,ry+dy,0);
					W.setTile(rx+1,ry+1,16);
				}
				window.__mmDebugHero(cx,cy);
				window.__simulationTimeScale=1;
				await sleep(2600);
				window.__simulationTimeScale=0.1;
				await sleep(600);
				const a=m.reliefTiles, sc=m.reliefScanCap, bc=m.reliefBudgetCap, t0=performance.now();
				let frames=0;
				await new Promise(done=>{ const tick=()=>{ frames++; if(performance.now()-t0<1000) requestAnimationFrame(tick); else done(); }; requestAnimationFrame(tick); });
				return 'OK '+JSON.stringify({perFrame:Math.round((m.reliefTiles-a)/Math.max(1,frames)), frames,
					fps:Math.round(frames*1000/(performance.now()-t0)),
					scanCapped:m.reliefScanCap-sc, budgetCapped:m.reliefBudgetCap-bc});
			})()`);
			const cave = caveS.startsWith('OK ') ? JSON.parse(caveS.slice(3)) : { perFrame: -1 };
			console.log('cave cost: ' + cave.perFrame + ' tiles/frame at ' + cave.fps + 'fps (the population the budget must cover)');

			const dOn = await diffInPage(shotOff, shotOn);
		const dRevert = await diffInPage(shotOff, shotOff2);
		const dRebake = await diffInPage(shotOn, shotOn2);
		console.log('diff on:', JSON.stringify(dOn), ' revert:', JSON.stringify(dRevert), ' rebake:', JSON.stringify(dRebake));
		const checks = [
			// aggregate first — then EVERY family on its own block, because an
			// aggregate would let four of seven families go dark and still pass
			// (adversarial review): a deleted RELIEF_HI entry silently returns.
			['relief visibly changes the baked blocks (>2% of their pixels)', dOn.changed > dOn.total * 0.02],
			...dOn.perBlock.map((frac, i) => [
				`family #${i} (${['rock', 'earth', 'sand', 'frost', 'wood', 'built', 'meteor'][i]}) shows relief on its own block (>1% of it)`, frac > 0.01
			]),
			// the revert must actually revert: the gate and the cache drop
			['toggling off restores the standard bake (<0.2% residue)', dRevert.changed < dOn.total * 0.002],
			// and the relief bake itself must be deterministic: two full cache
			// drops apart, the SAME relief pixels (the revert pair above only
			// ever compared two standard bakes)
			['re-baking relief reproduces it exactly (<0.2% residue)', dRebake.changed < dOn.total * 0.002],
			// THE point of the rewrite. A baked relief scores exactly 0 on both of
			// these — its layer is byte-identical whatever the light does — so a
			// regression back to a static emboss cannot pass them.
			['the relief layer is substantial at dawn AND dusk (both > 1.0 mean)', sunSwap.magA > 1 && sunSwap.magB > 1],
			['moving the SUN across the sky moves the relief (>40% of its own magnitude)', sunSwap.ratio > 0.40],
			['every material swaps with the sun, not just one (>25% each)', sunSwap.perBlock.every(b => b.ratio > 0.25)],
			['a TORCH at the other end of the wall re-shades it (>40%)', torchSwap.ratio > 0.40],
			// scored where the torches actually reach: level 13/15 spans ~13 tiles,
			// and a block 30 tiles from both torches is dark in both shots — asking
			// it to swap would be asking darkness to have a direction
			['the blocks nearest each torch swap hardest (>50%)', Math.max(torchSwap.perBlock[0].ratio, torchSwap.perBlock[6].ratio) > 0.50],
			// The VIEW half. Light direction alone cannot say where the viewer is,
			// and half of what makes a surface read as raised is the viewer: the
			// same wall, the same sun, seen from the other side of the screen.
			// This scores zero for any relief that only knows about light.
			['the same wall under the same sun re-shades from a different viewpoint', viewSwap.ratio > 0.15],
			['the pass stays inside its tile budget', cost.perFrame >= 0 && cost.perFrame <= RELIEF_TILE_CAP],
			['and it actually shades tiles (a silent zero is not a pass)', cost.perFrame > 20],
			// A lit chamber is the densest exposed-face scene the game has. If this
			// sits at the cap the effect is being silently truncated somewhere in
			// the view, which reads as relief that stops halfway across the screen.
			// The warren is the arithmetic ceiling (1620 exposed faces on screen), not
			// a scene play produces — so it is allowed to reach the cap. What must
			// hold is that the cap is high enough to carry a very dense view.
			['a lit mine warren shades over a thousand tiles', cave.perFrame > 1000],
			// A scan cap is the dangerous one: the walk gave up before reaching
			// records that were on screen, so the relief stops partway across the
			// view and nothing says so. It must never fire.
			['the walk never gives up early (scan cap unhit)', cave.scanCapped === 0 && cost.scanCapped === 0]
		];
		console.log('cost: ' + cost.perFrame + ' tiles/frame shaded at ' + cost.fps + 'fps');
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
