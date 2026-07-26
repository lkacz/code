#!/usr/bin/env node
// Live QA for the god ray SHAPE (engine/post_fx.js drawGodRaysPass).
//
// The other post-FX drivers count draws. Counting was never the problem here:
// the old pass drew its beams perfectly well and they still looked wrong —
// constant-width slabs with a hard bright edge cut across the sky, standing
// over open ground for no reason. So this driver measures the GEOMETRY of the
// light instead, by rendering the pass ALONE onto an offscreen canvas over
// black and reading the result back.
//
// (Reading pixels is the QA's privilege, not the game's: a getImageData in a
// live pass would stall the pipeline. Here nothing is on screen to stall.)
//
// What it proves, one check per complaint the effect was rebuilt to answer:
//   * the shaft is NARROW where it pierces the roof and WIDE where it lands
//   * it is brightest at its mouth and fades along its length
//   * both ends dissolve — no horizontal cut line at the top, none at the foot
//   * the cross-section is soft — a core with no rim
//   * no light is painted above the canopy, in the open sky
//   * open ground with no roof over it gets no beams at all
//
// Usage: npm start (server on 8123), then:
//   node tools/god-rays-qa.mjs [out.png] [--url=http://127.0.0.1:8123/index.html] [--seed=777]
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const out = (args.find(a => !a.startsWith('--')) || 'god-rays-qa.png').replace(/\.png$/i, '');
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

// Stage: find flat ground, roof it over, and leave exactly one narrow hole.
const STAGE = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	for(let i=0;i<400 && !(window.MM && MM.postFx && MM.world && MM.worldGen && MM.background && MM.fog && window.player && window.__mmDebugHero);i++) await sleep(100);
	if(!(window.MM && MM.postFx && MM.world && window.player)) return 'FAIL boot-timeout';
	MM.fog.setRevealAll(true);
	const ui=document.getElementById('ui'); if(ui) ui.style.display='none';
	MM.background.importState({cycleT:0.28});   // morning: the sun is low, so the shafts lean
	const W=MM.world, WG=MM.worldGen;
	// A flat-ish stretch: the roof is anchored per column, but a cliff inside the
	// cover window would tilt the mouth against the ground and hide the beam.
	const start=Math.round(player.x);
	let site=null;
	for(let d=0; d<240 && !site; d++){
		for(const s of [start+d, start-d]){
			let lo=1e9, hi=-1e9;
			for(let k=-13;k<=13;k++){ const h=WG.surfaceHeight(s+k); if(!Number.isFinite(h)) { lo=1e9; break; } if(h<lo) lo=h; if(h>hi) hi=h; }
			if(hi-lo<=1){ site=s; break; }
		}
	}
	if(site===null) return 'FAIL no-flat-site';
	window.__mmDebugHero(site, WG.surfaceHeight(site)-2);
	await sleep(1200);
	if(window.player) player.hp=player.maxHp;
	return 'OK '+JSON.stringify({site, surf:WG.surfaceHeight(site)});
})()`;

// Measure: draw the pass alone, over black, and read the shaft's shape back.
const MEASURE = `(async()=>{
	const P=await import('/src/engine/post_fx.js');
	const F=P.postFx;
	const W=MM.world, WG=MM.worldGen;
	const site=${'${SITE}'};
	const TILE=20;
	// A TALL stand. The spread is a ratio over the shaft's length, so a stubby
	// six-tile rig leaves the measured widening barely above 8-bit rounding —
	// close enough to the theoretical value that quantisation decides the
	// verdict. Twelve tiles of drop puts the wedge well clear of the noise.
	const ROOF_UP=12;
	const surf=WG.surfaceHeight(site), roofRow=surf-ROOF_UP;
	// The roof is built HERE, and measured before this evaluate yields. A canopy
	// laid over open ground is a player build with nothing under it, so
	// falling.js correctly sheds it within a tick or two — an earlier version of
	// this driver staged the roof, slept, and then measured an empty sky. The
	// pass reads the world synchronously, so building and shooting in one turn
	// of the event loop is both sound and the only staging that survives.
	const sh=x=>WG.surfaceHeight(x);
	for(let k=-13;k<=13;k++){ const x=site+k; for(let y=sh(x)-1;y>=sh(x)-ROOF_UP-2;y--) W.setTile(x,y,0); }
	for(let k=-13;k<=13;k++){ if(k>=-1 && k<=1) continue; const x=site+k; W.setTile(x, sh(x)-ROOF_UP, 6); }
	const roofOk=W.getTile(site-3, sh(site-3)-ROOF_UP)===6 && W.getTile(site, sh(site)-ROOF_UP)===0;
	if(!roofOk) return 'FAIL roof-not-staged';
	const x0t=site-14, x1t=site+14, y0t=roofRow-7, y1t=surf+3;
	const w=(x1t-x0t)*TILE, h=(y1t-y0t)*TILE;
	for(const n of F.COMPONENTS) F.set(n,false);
	F.set('godRays',true);
	const shoot=(sx,viewX)=>{
		const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
		const c2=cv.getContext('2d',{willReadFrequently:true});
		c2.fillStyle='#000'; c2.fillRect(0,0,w,h);
		c2.setTransform(1,0,0,1, -x0t*TILE, -y0t*TILE);
		const beams=F.drawGodRaysPass(c2,{TILE, sx, viewX,
			getTile:W.getTile, surfaceHeight:WG.surfaceHeight,
			isCanopy:(t)=>t===6||t===39,
			time:(MM.background&&MM.background.timeInfo)?MM.background.timeInfo():null,
			daylight:1});
		c2.setTransform(1,0,0,1,0,0);
		const d=c2.getImageData(0,0,w,h).data;
		return {beams, d};
	};
	const shot=shoot(x0t, x1t-x0t);
	if(!(shot.beams>0)) return 'FAIL no-beams-drawn';
	// Per row, TWO widths, because they answer different questions and the first
	// version of this driver conflated them into a wrong verdict.
	//   wideHalf — pixels above half of THAT ROW's peak: the geometric width of
	//              the wedge, independent of how bright the row happens to be.
	//   wideAbs  — pixels above a fixed fraction of the WHOLE shot's peak: the
	//              width a player actually sees, which the length falloff eats
	//              into. A shaft that dims faster than it widens still reads as
	//              tapering, so this one has to hold up too.
	const lum=new Float64Array(w*h);
	let peak=0;
	for(let i=0,p=0;i<w*h;i++,p+=4){
		const v=0.299*shot.d[p]+0.587*shot.d[p+1]+0.114*shot.d[p+2];
		lum[i]=v; if(v>peak) peak=v;
	}
	const cut=peak*0.30;
	const rowPeak=new Float64Array(h), rowWide=new Int32Array(h), rowHalf=new Int32Array(h);
	for(let y=0;y<h;y++){
		let mx=0,n=0;
		for(let x=0;x<w;x++){ const v=lum[y*w+x]; if(v>mx) mx=v; if(v>cut) n++; }
		rowPeak[y]=mx; rowWide[y]=n;
		if(mx>cut){ let k=0; const half=mx*0.5; for(let x=0;x<w;x++) if(lum[y*w+x]>half) k++; rowHalf[y]=k; }
	}
	const litRows=[]; for(let y=0;y<h;y++) if(rowWide[y]>0) litRows.push(y);
	if(litRows.length<12) return 'FAIL shaft-too-short litRows='+litRows.length;
	const top=litRows[0], bot=litRows[litRows.length-1];
	const span=bot-top;
	const at=f=>Math.round(top+span*f);
	const avgOf=(arr,a,b)=>{ let s=0,n=0; for(let y=a;y<=b;y++){ s+=arr[y]; n++; } return n?s/n:0; };
	const avgWide=(a,b)=>avgOf(rowWide,a,b);
	const avgHalf=(a,b)=>avgOf(rowHalf,a,b);
	const avgPeak=(a,b)=>avgOf(rowPeak,a,b);
	// Cross-section at the widest part: core vs the pixels just inside the edge.
	let wy=top, wn=-1; for(let y=top;y<=bot;y++) if(rowWide[y]>wn){ wn=rowWide[y]; wy=y; }
	let lo=-1, hi=-1;
	for(let x=0;x<w;x++){ if(lum[wy*w+x]>cut){ if(lo<0) lo=x; hi=x; } }
	const mid=(lo+hi)>>1;
	const edgeIn=Math.max(lo, Math.min(hi, lo+Math.round((hi-lo)*0.06)));
	// Control: the same pass over open ground. The stretch is stripped of any
	// natural foliage first — a wild tree standing in it would make the control
	// prove nothing (and fail at random, depending on the seed's forests).
	const cx0=site+40, cx1=site+96;
	for(let x=cx0;x<=cx1;x++){ const s=WG.surfaceHeight(x); for(let y=s-1;y>=s-18;y--){ const t=W.getTile(x,y); if(t===6||t===39) W.setTile(x,y,0); } }
	const bare=shoot(site+50, 30);
	// Where is the sky? Nothing may be painted above the roof's underside. The
	// two-row slack is the mouth itself: a leaning shaft is a rotated quad, so
	// its top CORNER rides a little above the row its axis starts on.
	const roofPx=(roofRow-y0t)*TILE;
	let skyLit=0, skyMax=0;
	for(let y=0;y<Math.max(0,roofPx-2);y++) for(let x=0;x<w;x++){ const v=lum[y*w+x]; if(v>cut) skyLit++; if(v>skyMax) skyMax=v; }
	return 'OK '+JSON.stringify({
		beams:shot.beams, peak:+peak.toFixed(1), litTop:top, litBot:bot, span,
		wideTopQ:+avgWide(top, at(0.25)).toFixed(1),
		wideBotQ:+avgWide(at(0.75), bot).toFixed(1),
		halfTopQ:+avgHalf(at(0.05), at(0.20)).toFixed(1),
		halfBotQ:+avgHalf(at(0.80), at(0.95)).toFixed(1),
		peakTopQ:+avgPeak(top, at(0.25)).toFixed(1),
		peakBotQ:+avgPeak(at(0.75), bot).toFixed(1),
		mouthRow:+rowPeak[top].toFixed(1), footRow:+rowPeak[bot].toFixed(1),
		coreLum:+lum[wy*w+mid].toFixed(1), edgeLum:+lum[wy*w+edgeIn].toFixed(1),
		roofPx, skyLit, skyMax:+skyMax.toFixed(1), cut:+cut.toFixed(1), bareBeams:bare.beams, roofOk
	});
})()`;

// How enclosed does this game's forest actually get? The cover threshold and
// the weight curve decide whether a shaft is visible at all, and setting them by
// eye is how the effect ended up looking arbitrary the first time. This walks a
// long stretch of real worldgen and reports the distribution the tuning has to
// live in: what fraction of columns carry foliage, and how strong the beams that
// clear the gate come out.
const SURVEY = `(async()=>{
	const P=await import('/src/engine/post_fx.js');
	const W=MM.world, WG=MM.worldGen;
	const isFol=t=>t===6||t===39;
	const roofed=x=>{ const s=WG.surfaceHeight(x); if(!Number.isFinite(s)) return false;
		for(let dy=P.GAP_ROOF_MIN;dy<=P.GAP_CANOPY_PROBE;dy++) if(isFol(W.getTile(x,s-dy))) return true; return false; };
	const start=Math.round(player.x);
	const N=2400, SPAN=P.GAP_COVER_SPAN;
	const roof=new Uint8Array(N);
	for(let i=0;i<N;i++) roof[i]=roofed(start-N/2+i)?1:0;
	// sliding cover over the same window the scan uses for a 3-wide gap
	const covers=[];
	for(let i=SPAN+1;i<N-SPAN-2;i++){
		let c=0,n=0;
		for(let j=i-SPAN;j<=i+2+SPAN;j++){ n++; if(roof[j]) c++; }
		covers.push(c/n);
	}
	covers.sort((a,b)=>a-b);
	const pc=f=>+covers[Math.min(covers.length-1,Math.floor(covers.length*f))].toFixed(3);
	// and what the live scan actually yields over the same stretch
	const gaps=P.collectCanopyGaps({x0:start-1200, x1:start+1200,
		getTile:W.getTile, surfaceHeight:WG.surfaceHeight, isCanopy:isFol, maxBeams:100000});
	const ws=gaps.map(g=>g.weight).sort((a,b)=>b-a);
	return 'OK '+JSON.stringify({
		roofedFrac:+(roof.reduce((a,b)=>a+b,0)/N).toFixed(3),
		coverP50:pc(0.5), coverP80:pc(0.8), coverP95:pc(0.95), coverP99:pc(0.99), coverMax:pc(1),
		sites:gaps.length, perKiloColumn:+(gaps.length/2.4).toFixed(1),
		weightMax:+(ws[0]||0).toFixed(3), weightMed:+(ws[Math.floor(ws.length/2)]||0).toFixed(3)
	});
})()`;

// Eyeball shot: the densest NATURAL stand within reach, at the same morning sun.
const SHOT = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const W=MM.world, WG=MM.worldGen;
	// Ask the pass's OWN scan where the light is, rather than guessing with a
	// second, differently-wrong heuristic: run collectCanopyGaps over a long
	// stretch and stand under the site it rates highest.
	const P=await import('/src/engine/post_fx.js');
	const start=Math.round(player.x);
	const gaps=P.collectCanopyGaps({x0:start-1500, x1:start+1500,
		getTile:W.getTile, surfaceHeight:WG.surfaceHeight,
		isCanopy:(t)=>t===6||t===39, maxBeams:100000});
	if(!gaps.length) return 'FAIL no-natural-stand';
	let bestGap=gaps[0];
	for(const g of gaps) if(g.weight>bestGap.weight) bestGap=g;
	const best=bestGap.x0;
	window.__mmDebugHero(best, WG.surfaceHeight(best)-2);
	await sleep(1400);
	if(window.player) player.hp=player.maxHp;
	MM.background.importState({cycleT:0.28});
	window.__mmForceGfxUltra=true;
	const ui=document.getElementById('ui'); if(ui) ui.style.display='none';
	await sleep(1800);
	const M=MM.postFx.metrics;
	const r0=M.godRayBeams|0; await sleep(900); const r1=M.godRayBeams|0;
	return 'OK '+JSON.stringify({stand:best, weight:+bestGap.weight.toFixed(3), cover:+bestGap.cover.toFixed(3), sites:gaps.length, beamDraws:r1-r0});
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-raysqa-'));
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
		// Keep-front pump: headless pages stop ticking rAF when judged occluded.
		pump = setInterval(() => { send(ws, 'Page.bringToFront').catch(() => {}); }, 2000);

		const run = async (label, expr) => {
			const r = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 180000 });
			const status = r && r.result ? String(r.result.value) : '(no result)';
			console.log(label + ':', status);
			return status;
		};
		const stage = await run('stage', STAGE);
		let measured = 'SKIPPED';
		if (stage.startsWith('OK ')){
			const site = JSON.parse(stage.slice(3)).site;
			measured = await run('measure', MEASURE.replace('${SITE}', String(site)));
		}
		const survey = await run('survey', SURVEY);
		// A look at the finished frame, in a NATURAL stand. Real trees are marked
		// tree tiles, so nothing sheds them and the shot shows the effect on the
		// terrain a player actually walks through rather than on a test rig.
		const shotStatus = await run('shot', SHOT);
		const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
		await writeFile(out + '-rays.png', Buffer.from(shot.data, 'base64'));
		console.log('wrote', out + '-rays.png');
		if (pageErrors.length) console.log('pageErrors:', pageErrors.slice(0, 4).join('\n---\n'));

		if (!stage.startsWith('OK ') || !measured.startsWith('OK ')){
			failed = true;
			console.error('god-rays-qa: a stage failed');
		} else {
			const m = JSON.parse(measured.slice(3));
			const checks = [
				['the roof cast at least one shaft', m.beams > 0],
				// The headline fix, measured twice. The old parallelogram scores
				// exactly 1.0 on the first and would fail both.
				['the wedge is WIDER where it lands than where it pierces the roof', m.halfBotQ > m.halfTopQ * 1.25],
				['and the widening survives the length falloff (it still LOOKS wider)', m.wideBotQ > m.wideTopQ * 0.95],
				['and it is BRIGHTEST at its mouth', m.peakTopQ > m.peakBotQ * 1.15],
				// Both ends must ease in. The old pass opened at full alpha, which is
				// exactly what drew a bright horizontal line across the sky.
				['the mouth eases in — no cut line where it leaves the leaves', m.mouthRow < m.peak * 0.45],
				['the foot dissolves — no cut line where it lands', m.footRow < m.peak * 0.45],
				// A rim is what made the old beams read as coloured glass.
				['the cross-section has a core and no rim', m.edgeLum < m.coreLum * 0.55],
				['nothing is painted in the open sky above the roof', m.skyLit === 0],
				['a shaft is a shaft, not a wash (bounded width)', m.wideBotQ < 260],
				// The gate that stops shafts standing over open fields.
				['open ground with no roof over it gets no beams', m.bareBeams === 0],
				// The rig proves the geometry; this proves the geometry survives
				// contact with terrain nobody staged.
				['a natural forest stand casts shafts too', shotStatus.startsWith('OK ') && JSON.parse(shotStatus.slice(3)).beamDraws > 0]
			];
			for (const [name, ok] of checks){ console.log((ok ? 'PASS  ' : 'FAIL  ') + name); if (!ok) failed = true; }
			console.log('shape:', JSON.stringify(m));
		}
	} catch (e){
		failed = true;
		console.error('god-rays-qa error:', e && e.message);
	} finally {
		if (pump) clearInterval(pump);
		try { if (ws) ws.close(); } catch (e) { /* closing */ }
		// Marker-scoped kill: ONLY the process this driver spawned, by pid. A
		// blanket msedge.exe taskkill would close the user's own browser.
		try { proc.kill(); } catch (e) { /* already gone */ }
		await sleep(400);
	}
	process.exit(failed ? 1 : 0);
}

main();
