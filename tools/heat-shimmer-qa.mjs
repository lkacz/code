#!/usr/bin/env node
// Live QA for the heat shimmer (drganie powietrza, engine/post_fx.js).
//
// The old pass slid three 4px slices sideways over one tile, each with its own
// sine phase, and painted them at a DISPLACED destination. Three defects fell
// out of that, and this driver exists to prove each one is gone:
//   1. the destination moved, so the effect climbed onto the neighbouring block.
//      Proven here with pixels: the pass is driven by hand over a painted stripe
//      pattern, and every pixel it changes must fall inside the plume's own
//      columns — nothing to the side, nothing below the block, nothing above the
//      plume top.
//   2. the slices were rhythmic and out of phase with each other, so it read as
//      blocks sliding. Proven in tools/post-fx-sim.test.mjs, which pins the field
//      itself (sub-pixel step between adjacent rows, crest travelling upward).
//   3. it ran AFTER the fire pass, so flames — which already animate their own
//      bend — were distorted too. Pinned as frame order in the same test; here we
//      merely confirm the whole thing still draws with fire on screen.
// Plus what only a live run can answer: does merging actually collapse a lava
// pool into ONE plume, does the ceiling clip hold in a cavern, and what does the
// pass cost when it is the real canvas doing the blits.
//
// Usage: npm start (server on 8123), then:
//   node tools/heat-shimmer-qa.mjs [--url=http://127.0.0.1:8123/index.html] [--seed=777]
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

// getImageData is forbidden to the GAME (render-health taboo) but a QA driver may
// read the framebuffer. Both halves of every A/B come from CONSECUTIVE frames:
// sampling them even a second apart lets the world move in between, which has
// already once inverted a result in this repo.
const HELPERS = `
	window.__hs = {
		metrics(){ const m=MM.postFx.metrics; return {bands:m.shimmerBands|0, rows:m.shimmerSlices|0}; },
		async delta(ms){
			const a=this.metrics();
			await new Promise(r=>setTimeout(r,ms));
			const b=this.metrics();
			return {bands:b.bands-a.bands, rows:b.rows-a.rows};
		},
		grab(){
			const cv=document.getElementById('game');
			const g=cv.getContext('2d');
			return {w:cv.width, h:cv.height, data:g.getImageData(0,0,cv.width,cv.height).data};
		},
	};
`;

const BOOT = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	for(let i=0;i<400 && !(window.MM && MM.background && MM.fog && MM.postFx && MM.world && MM.fire && window.player && window.__mmDebugHero);i++) await sleep(100);
	if(!(window.MM && MM.postFx && MM.world && MM.fire && window.player)) return 'FAIL boot-timeout';
	${HELPERS}
	MM.fog.setRevealAll(true);
	MM.background.importState({cycleT:0.30});   // broad daylight: the plume needs contrast behind it
	const ui=document.getElementById('ui'); if(ui) ui.style.display='none';
	for(const name of MM.postFx.COMPONENTS) MM.postFx.set(name,false);
	MM.postFx.set('heatShimmer',true);           // the one component under test
	return 'OK '+JSON.stringify({on:MM.postFx.on('heatShimmer')});
})()`;

// A lava pool cut into the surface, with a stone pillar standing beside it so the
// plume has a hard vertical edge to bend — a smooth sky gradient would hide the
// whole effect from a pixel probe.
const SCENE = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const W=MM.world;
	const bx=Math.round(window.player ? player.x : 400);
	const surf=MM.worldGen.surfaceHeight(bx);
	window.__mmDebugHero(bx, surf-3);
	await sleep(1200);
	const cx=Math.floor(player.x), cy=MM.worldGen.surfaceHeight(Math.floor(player.x));
	// clear a wide bay, floor it with stone, then flood the middle with lava
	for(let x=cx-16;x<=cx+16;x++) for(let y=cy-14;y<=cy+2;y++) W.setTile(x,y,0);
	for(let x=cx-16;x<=cx+16;x++) W.setTile(x,cy+2,3);
	let lava=0;
	for(let x=cx-3;x<=cx+4;x++){ W.setTile(x,cy+1,13); lava++; }   // 8 contiguous lava tiles
	// striped pillars flanking the pool: hard vertical edges for the haze to bend,
	// and neither material burns (a coal pillar next to lava would not survive)
	for(let y=cy-9;y<=cy;y++){ W.setTile(cx-6,y,(y&1)?3:54); W.setTile(cx+7,y,(y&1)?3:54); }
	// burning wood off to the side: its flame must ride OVER the plume, crisp
	let lit=0;
	for(let x=cx-11;x<=cx-9;x++){ W.setTile(x,cy+1,5); if(MM.fire.ignite(x,cy+1,W.getTile,W.setTile)) lit++; }
	window.__mmDebugHero(cx-7, cy);
	await sleep(1600);
	if(window.player) player.hp=player.maxHp;
	const d=await window.__hs.delta(900);
	return 'OK '+JSON.stringify({lava,lit,cx,cy,bands:d.bands,rows:d.rows});
})()`;

// Where the plume lands on screen, so the screenshots can actually frame it. The
// camera centres the hero, so one lookup of the live zoom is enough.
const AIM = `(()=>{
	const cv=document.getElementById('game');
	const z=(window.__mmRenderDetail && window.__mmRenderDetail.zoom) || 1;
	const cy=MM.worldGen.surfaceHeight(Math.round(player.x)+7);
	const cx=Math.round(player.x)+7;
	const wx=cx+0.5, wy=cy+1-1.2;              // middle of the plume over the pool
	return 'OK '+JSON.stringify({
		zoom:+z.toFixed(3),
		x:Math.round(cv.width*0.5+(wx-player.x)*20*z),
		y:Math.round(cv.height*0.5+(wy-player.y)*20*z)
	});
})()`;

// Merging, the ceiling clip, the seal and burning blocks — every answer read from
// the pass's own RETURN value. The metrics counters cannot be used here: the game
// keeps rendering at 60fps throughout, so a metrics delta also collects the live
// frames' work (the first run of this driver duly reported a sealed vein as
// bending 25 rows, all of them belonging to another scene's pool).
const STRUCTURE = `(async()=>{
	const P=await import('/src/engine/post_fx.js');
	const cv=document.getElementById('game');
	const ctx=cv.getContext('2d');
	const W=MM.world;
	const cx=Math.floor(player.x)+220, cy=40;   // its own pocket, well clear of the rest
	for(let x=cx-24;x<=cx+24;x++) for(let y=cy-20;y<=cy+4;y++) W.setTile(x,y,0);
	for(let x=cx-24;x<=cx+24;x++) W.setTile(x,cy+2,3);
	const base={TILE:20,sx:cx-20,sy:cy-14,viewX:40,viewY:28,getTile:W.getTile,visibleAt:()=>true,poweredAt:()=>true,frameMs:16,now:1000};
	const run=(o)=>{ ctx.save(); ctx.setTransform(2,0,0,2, 800-40*(cx+0.5), 600-40*(cy+1));
		const r=MM.postFx.drawHeatShimmerPass(ctx,{...base,pools:null,burning:null,...o}); ctx.restore(); return r; };
	const bands=(sources)=>P.buildHeatBands(sources,{TILE:20,scale:2,focusX:cx}).length;
	// 1. one contiguous lava run is one band; the same tiles with a gap are two
	const contiguous=[]; for(let x=cx-4;x<=cx+5;x++) contiguous.push({x,y:cy+1,strength:1});
	const gapped=contiguous.filter(s=>s.x!==cx);
	const merged=bands(contiguous), broken=bands(gapped);
	// 2. open plume vs the same run capped with rock one tile up
	for(let x=cx-4;x<=cx+5;x++) W.setTile(x,cy+1,13);
	const openRows=run({});
	for(let x=cx-4;x<=cx+5;x++) W.setTile(x,cy-1,3);
	const clippedRows=run({});
	// 3. sealed flush: no air above at all, so no plume
	for(let x=cx-4;x<=cx+5;x++){ W.setTile(x,cy-1,0); W.setTile(x,cy,3); }
	const sealed=run({});
	// 4. burning blocks are heat sources in their own right (tile 5 = wood)
	for(let x=cx-4;x<=cx+5;x++){ W.setTile(x,cy,0); W.setTile(x,cy+1,5); }
	let lit=0;
	for(let x=cx-4;x<=cx+5;x++) if(MM.fire.ignite(x,cy+1,W.getTile,W.setTile)) lit++;
	const fed=MM.fire.burningNear(cx,20).length;
	const withFire=run({burning:MM.fire.burningNear(cx,20)});
	// The emitter scan is cadence-cached and caches the tile ID with it, so a tile
	// swapped mid-frame keeps its old heat for up to one scan interval — the same
	// tradeoff bloom and light-tint have always made. Wait it out, otherwise the
	// lava we just replaced with wood answers for the fire.
	await new Promise(r=>setTimeout(r,400));
	const fireOnly=run({burning:null});
	const fireFed=run({burning:MM.fire.burningNear(cx,20)});
	return 'OK '+JSON.stringify({merged,broken,openRows,clippedRows,sealed,lit,burningFeed:fed,withFire,fireOnly,fireFed,
		plumeTiles:+P.heatPlumeTiles(1).toFixed(2), ampPx:+P.heatAmpPx(1).toFixed(2), rowBudget:P.HEAT_ROW_BUDGET});
})()`;

// Cost. Timed on the real canvas doing real blits (the snapshot copy included),
// minimum of three reps: a shared-CPU headless run has other work landing between
// frames and a single rep has swung 2x between otherwise identical runs.
const COST = `(async()=>{
	const cv=document.getElementById('game');
	const ctx=cv.getContext('2d');
	const W=MM.world;
	const cy=40;
	// Each case gets its OWN pocket, and therefore its own emitter-scan cache key.
	// Sharing one window silently broke the first version of this bench: the scan is
	// cadence-cached, so after the empty case every following case measured an empty
	// scene for the next ~120ms, and a min-of-reps happily reported 0.8us for all
	// four. A min is only valid across reps that measure the SAME work.
	const CASES=[
		['pool8', 0, (cx)=>{ for(let i=0;i<8;i++) W.setTile(cx-4+i, cy+1, 13); }],
		['lake40', 120, (cx)=>{ for(let i=0;i<40;i++) W.setTile(cx-20+i, cy+1, 13); }],
		// 12 separate plumes: the expensive shape, because every band copies its own
		// strip. Bounded by the band cap, which is exactly why this is worth measuring.
		['scattered12', 240, (cx)=>{ for(let i=0;i<12;i++) W.setTile(cx-24+i*4, cy+1, 13); }],
		['nothing-hot', 360, ()=>{}]
	];
	const home=Math.floor(player.x)+400;
	const prepared=CASES.map(([label,off,fill])=>{
		const cx=home+off;
		for(let x=cx-30;x<=cx+30;x++) for(let y=cy-20;y<=cy+2;y++) W.setTile(x,y,0);
		for(let x=cx-30;x<=cx+30;x++) W.setTile(x,cy+2,3);
		fill(cx);
		const base={TILE:20,sx:cx-20,sy:cy-14,viewX:40,viewY:28,getTile:W.getTile,visibleAt:()=>true,poweredAt:()=>true,frameMs:16};
		const drive=(t)=>{ ctx.save(); ctx.setTransform(2,0,0,2, 800-40*(cx+0.5), 600-40*(cy+1));
			const r=MM.postFx.drawHeatShimmerPass(ctx,{...base,pools:null,burning:null,now:t}); ctx.restore(); return r; };
		return {label,drive};
	});
	const N=250, REPS=4;
	const best={}, shape={};
	for(const c of prepared) best[c.label]=Infinity;
	// Reps INTERLEAVED across the cases: a sustained CPU steal in a headless run
	// otherwise lands entirely on whichever case happens to be running, and this
	// bench has already swung 2x between identical invocations.
	for(let rep=0;rep<REPS;rep++){
		for(const c of prepared){
			for(let i=0;i<30;i++) c.drive(i*16);                     // warm + settle the scan
			const b0=MM.postFx.metrics.shimmerBands|0;
			const rows=c.drive(999);
			shape[c.label]={rows, bands:(MM.postFx.metrics.shimmerBands|0)-b0};
			const t0=performance.now();
			for(let i=0;i<N;i++) c.drive(i*16);
			best[c.label]=Math.min(best[c.label],(performance.now()-t0)/N);
		}
	}
	const fmt=prepared.map(c=>c.label+'='+(best[c.label]*1000).toFixed(1)+'us('+shape[c.label].bands+'b/'+shape[c.label].rows+'r)');
	return 'OK '+JSON.stringify({cost:fmt.join(' | '), shape});
})()`;

// CONFINEMENT, measured exactly. A live-frame A/B cannot answer this: two
// consecutive frames of a running world differ almost everywhere (clouds, lava
// glow, grass), and the first attempt duly reported the whole 1600x900 canvas as
// "changed". So this drives the pass by hand over a painted stripe pattern —
// every changed pixel is then the pass and nothing else — and checks the changed
// box against the plume rect the same geometry predicts.
const CONFINE = `(async()=>{
	const P=await import('/src/engine/post_fx.js');
	const W=MM.world;
	const cv=document.getElementById('game');
	const ctx=cv.getContext('2d');
	const TILE=20, SC=2;
	const cx=Math.floor(player.x)+120, cy=40;      // far from every other staged scene
	const x0=cx-3, x1=cx+4;                        // an 8-tile lava run
	// a clean pocket: no other heat source anywhere in the scan window
	for(let x=cx-24;x<=cx+24;x++) for(let y=cy-20;y<=cy+4;y++) W.setTile(x,y,0);
	for(let x=cx-24;x<=cx+24;x++) W.setTile(x,cy+2,3);
	for(let x=x0;x<=x1;x++) W.setTile(x,cy+1,13);
	// transform chosen so the run's top edge lands at device y=600, centred at x=800
	const e=800-SC*TILE*(cx+0.5), f=600-SC*TILE*(cy+1);
	const baseY=SC*TILE*(cy+1)+f;
	const plumeH=P.heatPlumeTiles(1)*TILE*SC;
	const spread=TILE*SC*0.5, amp=P.heatAmpPx(1)*SC;
	const bandL=SC*TILE*x0+e-spread-amp-2, bandR=SC*TILE*(x1+1)+e+spread+amp+2;
	// vertical stripes: any horizontal displacement HAS to show as changed pixels
	ctx.save(); ctx.setTransform(1,0,0,1,0,0);
	for(let x=0;x<cv.width;x+=8){ ctx.fillStyle=(x/8)&1?'#101820':'#d8e0e8'; ctx.fillRect(x,0,4,cv.height); }
	const before=ctx.getImageData(0,0,cv.width,cv.height).data;
	ctx.restore();
	ctx.save(); ctx.setTransform(SC,0,0,SC,e,f);
	const rows=MM.postFx.drawHeatShimmerPass(ctx,{TILE,sx:cx-20,sy:cy-14,viewX:40,viewY:28,
		getTile:W.getTile,visibleAt:()=>true,poweredAt:()=>true,pools:null,burning:null,frameMs:16,now:2500});
	ctx.restore();
	ctx.save(); ctx.setTransform(1,0,0,1,0,0);
	const after=ctx.getImageData(0,0,cv.width,cv.height).data;
	ctx.restore();
	let bx0=1e9,bx1=-1,by0=1e9,by1=-1,n=0;
	for(let y=0;y<cv.height;y++) for(let x=0;x<cv.width;x++){
		const i=(y*cv.width+x)*4;
		if(Math.abs(before[i]-after[i])+Math.abs(before[i+1]-after[i+1])+Math.abs(before[i+2]-after[i+2])>12){
			n++; if(x<bx0)bx0=x; if(x>bx1)bx1=x; if(y<by0)by0=y; if(y>by1)by1=y;
		}
	}
	return 'OK '+JSON.stringify({rows,n,box:n?{bx0,bx1,by0,by1}:null,
		expect:{L:Math.round(bandL),R:Math.round(bandR),top:Math.round(baseY-plumeH),base:Math.round(baseY)},
		tileDev:TILE*SC});
})()`;

// ONLY this component. The global __mmNoPostFX kill switch also stops the glow
// pass, which is standard now — an A/B through it compares "everything" against
// "nothing" and says nothing whatever about the shimmer.
const KILL = on => `(()=>{ MM.postFx.set('heatShimmer',${on}); return 'OK '+JSON.stringify({on:MM.postFx.on('heatShimmer')}); })()`;
const ZOOM = `(async()=>{ const sleep=ms=>new Promise(r=>setTimeout(r,ms)); const cv=document.getElementById('game');
	for(let i=0;i<5;i++){ cv.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true})); await sleep(70); }
	await sleep(500); return 'OK'; })()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-heatshimmer-'));
	const proc = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
		'--force-device-scale-factor=1', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
		'--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
	let ws = null, pump = null;
	const results = [];
	try {
		let target = null;
		for (let i = 0; i < 60 && !target; i++){
			await sleep(250);
			try {
				const portLine = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0].trim();
				if (!portLine) continue;
				const list = await (await fetch(`http://127.0.0.1:${portLine}/json/list`)).json();
				target = list.find(t => t.type === 'page');
			} catch (e) { /* devtools not up yet */ }
		}
		if (!target) throw new Error('no devtools target');
		ws = new WebSocket(target.webSocketDebuggerUrl);
		await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
		const events = [], pageErrors = [];
		ws.onmessage = ev => {
			const m = JSON.parse(ev.data);
			if (m.id && pending.has(m.id)){
				const q = pending.get(m.id); pending.delete(m.id);
				if (m.error) q.reject(new Error(q.method + ': ' + JSON.stringify(m.error))); else q.resolve(m.result);
			} else if (m.method){
				events.push(m.method);
				if (m.method === 'Runtime.exceptionThrown'){
					try { pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300)); } catch (e) { /* ignore */ }
				}
			}
		};
		await send(ws, 'Page.enable');
		await send(ws, 'Runtime.enable');
		await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
		await send(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: `
			const __o=Document.prototype.getElementById;
			Document.prototype.getElementById=function(id){ const el=__o.call(this,id);
				if(id==='seedInput' && el && el.value==='auto') el.value=${JSON.stringify(seed)}; return el; };` });
		await send(ws, 'Page.navigate', { url });
		for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await sleep(250);
		await sleep(1500);
		// headless occlusion freezes rAF; keep the tab front or every scene stalls
		pump = setInterval(() => { send(ws, 'Page.bringToFront').catch(() => {}); }, 2000);
		const ev = async (label, expr) => {
			const r = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 240000 });
			const v = r && r.result ? String(r.result.value) : '(none)';
			console.log(label + ':', v);
			if (v.startsWith('FAIL')) throw new Error(label + ' ' + v);
			return v.startsWith('OK ') ? JSON.parse(v.slice(3)) : {};
		};
		const shot = async (name, clip) => {
			const s = await send(ws, 'Page.captureScreenshot', { format: 'png', clip });
			await writeFile(join(outDir, name), Buffer.from(s.data, 'base64'));
		};
		await ev('boot', BOOT);
		const scene = await ev('scene', SCENE);
		const conf = await ev('confine', CONFINE);
		await ev('zoom', ZOOM);
		const aim = await ev('aim', AIM);
		// framed on the plume itself, magnified: a 2px displacement is not something
		// a whole-screen shot can show
		const W = 420, H = 300;
		const plume = {
			x: Math.max(0, Math.min(1600 - W, aim.x - W / 2)),
			y: Math.max(0, Math.min(900 - H, aim.y - H * 0.55)),
			width: W, height: H, scale: 3
		};
		await shot('heat-shimmer-qa-on.png', plume);
		// a second frame a moment later: the pattern must have MOVED, and moved up
		await sleep(260);
		await shot('heat-shimmer-qa-on-2.png', plume);
		await ev('off', KILL(false)); await sleep(600);
		await shot('heat-shimmer-qa-off.png', plume);
		await ev('on', KILL(true)); await sleep(600);
		await shot('heat-shimmer-qa-wide.png', { x: 400, y: 180, width: 800, height: 500, scale: 2 });
		const struct = await ev('structure', STRUCTURE);
		const cost = await ev('cost', COST);

		// --- verdicts ---------------------------------------------------------
		const box = conf.box, exp = conf.expect || {};
		const boxW = box ? (box.bx1 - box.bx0 + 1) : 0;
		const boxH = box ? (box.by1 - box.by0 + 1) : 0;
		const tileDev = conf.tileDev || 40;
		const checks = [
			['the pass runs and draws rows over a lava pool', scene.rows > 0],
			['a contiguous 8-tile pool is ONE band, not eight', scene.bands > 0 && scene.rows / Math.max(1, scene.bands) > 8],
			['merging: a 10-tile run is a single band', struct.merged === 1],
			['a gap in the run splits it into two', struct.broken === 2],
			['the plume clears at least two blocks at full heat', struct.plumeTiles >= 2],
			['peak displacement stays small (a few world px, not a block)', struct.ampPx > 0 && struct.ampPx <= 3],
			['a ceiling one tile up clips the plume instead of punching through', struct.clippedRows > 0 && struct.clippedRows < struct.openRows],
			['a sealed lava vein bends nothing at all', struct.sealed === 0],
			['burning blocks reach the pass as heat sources', struct.lit > 0 && struct.burningFeed > 0],
			['with the lava gone, nothing bends unless the fire is fed in', struct.fireOnly === 0],
			['fire ALONE drives a plume, no lava anywhere in the window', struct.fireFed > 0],
			// CONFINEMENT, the defect this whole wave is about: the effect changes
			// pixels, and every changed pixel is inside the plume's own columns.
			['the shimmer changes pixels over a painted pattern', !!box && conf.n > 0],
			['NOTHING is touched left of the plume', !!box && box.bx0 >= exp.L],
			['NOTHING is touched right of the plume', !!box && box.bx1 <= exp.R],
			['nothing is touched below the hot block', !!box && box.by1 <= exp.base],
			['nothing is touched above the plume top', !!box && box.by0 >= exp.top],
			['the disturbance really does reach a block or more above the source', boxH > tileDev],
			['the work cap is a fixed row budget', struct.rowBudget > 0]
		];
		console.log('\ncost: ' + (cost.cost || '(none)'));
		console.log('confinement: changed ' + conf.n + 'px, box ' + JSON.stringify(box) +
			' (' + boxW + 'x' + boxH + ') vs allowed x[' + exp.L + '..' + exp.R + '] y[' + exp.top + '..' + exp.base + ']\n');
		let failed = 0;
		for (const [name, ok] of checks){
			console.log((ok ? 'PASS  ' : 'FAIL  ') + name);
			if (!ok) failed++;
			results.push([name, ok]);
		}
		if (pageErrors.length) console.log('\npageErrors:\n' + pageErrors.slice(0, 3).join('\n---\n'));
		console.log(`\n${results.length - failed}/${results.length} checks passed`);
		if (failed) process.exitCode = 1;
	} finally {
		try { if (pump) clearInterval(pump); } catch (e) { /* none */ }
		try { if (ws) ws.close(); } catch (e) { /* closing */ }
		// marker-scoped kill: never taskkill msedge.exe, it would take the user's browser
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
}
main().catch(e => { console.error(e); process.exit(1); });
