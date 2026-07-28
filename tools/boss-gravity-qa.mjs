#!/usr/bin/env node
// Headless-Edge live QA for the block boss wave: hurled blocks at full size, the
// boss EATING gravity-gun blocks, the heart's heat/glow, and the procedural eye.
// Boots the REAL game over CDP and proves what a Node sim cannot:
//   1. a spawned beast carries a seeded eyeSpec from the shipped vocabulary, and
//      the same seed twice gives the same face
//   2. a REAL gravity projectile (the weapons.js mint, the real arrow chain)
//      thrown at the beast is ABSORBED: no HP lost anywhere, the body grows one
//      part OF THE THROWN MATERIAL, and the arrow is consumed
//   3. an absorbed block pays NO loot — resolveGravityImpactOnCreature never runs,
//      so the world's drop count is unchanged (matter is not duplicated)
//   4. a wounded plate is MENDED instead, and an ordinary arrow still wounds
//   5. breaching the armour ring turns the heart into a live heat emitter that
//      reaches post_fx's shimmer feed, and registers on the emissive (bloom) queue
//   6. a LEANING beast is clicked and stood on where it is DRAWN, not where its
//      untilted lattice sits (the census + the rider gap)
//   7. the boss draw pass survives a real canvas with the new eye + heart art
// Traps inherited from gravity-gun-qa (paid for in real debugging hours):
//   * keep-front pump — an occluded headless tab throttles rAF AND timers
//   * pinned seed: a random world fails a different way every run
//   * never write fresh SOLID tiles around the live hero — stage at distance
// Usage: node tools/boss-gravity-qa.mjs [--url=http://127.0.0.1:8123/index.html]
import { spawn, execFile } from 'node:child_process';
import { writeFile, mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
	const hit = args.find(a => a.startsWith('--' + name + '='));
	return hit ? hit.slice(name.length + 3) : dflt;
};
const url = opt('url', 'http://127.0.0.1:8123/index.html?seed=777');
const [winW, winH] = opt('size', '1600x900').split('x').map(Number);
const out = opt('out', 'tools/boss-gravity-qa.png');

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

const SCENARIO = `(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const fail=m=>'FAIL: '+m;
  for(let i=0;i<400 && !(window.MM && window.player && MM.bosses && MM.weapons && MM.world);i++) await sleep(100);
  if(!(window.MM && MM.bosses && MM.weapons)) return fail('boot-timeout');
  const T=MM.T, W=MM.world, p=window.player;
  const notes=[];

  // ---- 1. the seeded face ------------------------------------------------
  MM.bosses.clearAll();
  const bx=Math.round(p.x)+120;
  const a1=MM.bosses.forceSpawn((x,y)=>W.getTile(x,y),{x:bx, seed:31337, force:true, freeze:true});
  const a2=MM.bosses.forceSpawn((x,y)=>W.getTile(x,y),{x:bx+70, seed:31337, force:true, freeze:true});
  if(!a1 || !a2) return fail('boss-spawn');
  const spec=a1.eyeSpec;
  if(!spec) return fail('no-eyeSpec');
  const SOCKETS=['round','almond','wide'], PUPILS=['round','slit','cross','ring'];
  if(!SOCKETS.includes(spec.socket)) return fail('socket:'+spec.socket);
  if(!PUPILS.includes(spec.pupil)) return fail('pupil:'+spec.pupil);
  if(!/^#[0-9a-f]{6}$/i.test(spec.iris)) return fail('iris-not-hex:'+spec.iris);
  if(JSON.stringify(spec)!==JSON.stringify(a2.eyeSpec)) return fail('eye-not-deterministic');
  if(a1.parts.filter(q=>q.role==='eye').length!==1) return fail('eye-part-count');
  notes.push('eye '+spec.socket+'/'+spec.pupil+'x'+spec.lobes+' iris '+spec.iris);
  MM.bosses.clearAll();

  // ---- 2/3/4. the real projectile chain ----------------------------------
  const m=MM.bosses.forceSpawn((x,y)=>W.getTile(x,y),{x:bx, seed:20260728, force:true, freeze:true});
  if(!m) return fail('feed-boss-spawn');
  const plate=m.parts.find(q=>q.role!=='core' && q.role!=='eye' && q.dy<0);
  if(!plate) return fail('no-plate');
  const hpAll=()=>m.parts.reduce((s,q)=>s+q.hp,0);
  const dropsBefore=(MM.drops && MM.drops.metrics)? (MM.drops.metrics().active|0) : -1;
  const partsBefore=m.parts.length, hpBefore=hpAll(), grownBefore=m.grown|0;

  // fire the REAL mint straight at a plate — the whole arrow chain runs
  const throwAt=(tid,part)=>{
    const ex=m.x+part.dx+0.5, ey=m.y+part.dy+0.5;
    const body={x:ex-3.0, y:ey};
    const d=Math.hypot(3.0,0.0)||1;
    return MM.weapons.spawnGravityProjectile(body, tid, {dx:3.0/d, dy:0}, {bonus:0});
  };
  if(!throwAt(T.DIAMOND, plate)) return fail('projectile-not-minted');
  for(let i=0;i<80 && m.parts.length===partsBefore;i++) await sleep(25);
  if(m.parts.length!==partsBefore+1) return fail('not-absorbed parts='+m.parts.length+'/'+partsBefore);
  const grew=m.parts[m.parts.length-1];
  if(grew.blockType!==T.DIAMOND) return fail('grew-wrong-material:'+grew.blockType);
  if(hpAll()<hpBefore) return fail('absorb-cost-hp '+hpAll()+'<'+hpBefore);
  if((m.grown|0)<=grownBefore) return fail('grown-not-counted');
  if((m.absorbed|0)<1) return fail('absorb-not-counted');
  const dropsAfter=(MM.drops && MM.drops.metrics)? (MM.drops.metrics().active|0) : -1;
  if(dropsBefore>=0 && dropsAfter>dropsBefore) return fail('absorbed block PAID LOOT '+dropsBefore+'->'+dropsAfter);
  notes.push('absorbed diamond: +1 part ('+partsBefore+'->'+m.parts.length+'), 0 dmg, 0 loot');

  // A wounded plate is MENDED, not grown. Which part the block reaches first is
  // a matter of flight geometry across a 5-9 tile body, so wound them ALL and
  // assert on the body totals — that holds whichever plate catches it.
  for(const q of m.parts){ if(q!==m.core) q.hp=Math.max(1, q.maxHp*0.4); }
  const woundedTotal=hpAll(), partsMid=m.parts.length;
  const leftPlate=m.parts.filter(q=>q!==m.core && q.dy<0).sort((x,y)=>x.dx-y.dx)[0] || plate;
  if(!throwAt(T.STONE, leftPlate)) return fail('mend-projectile');
  for(let i=0;i<80 && hpAll()<=woundedTotal;i++) await sleep(25);
  if(hpAll()<=woundedTotal) return fail('mend-failed '+hpAll().toFixed(1)+'<='+woundedTotal.toFixed(1));
  if(m.parts.length!==partsMid) return fail('mend-also-grew '+m.parts.length+'/'+partsMid);
  notes.push('mended body '+woundedTotal.toFixed(1)+'->'+hpAll().toFixed(1)+' without growing');

  // an ordinary weapon still wounds it — the immunity is to BLOCKS, not to war
  const eyePart=m.parts.find(q=>q.role==='eye');
  const eyeHp0=eyePart.hp;
  MM.bosses.damageAt(Math.round(m.x)+eyePart.dx, Math.round(m.y)+eyePart.dy, 3, {kind:'melee',source:'hero'});
  if(eyePart.hp>=eyeHp0) return fail('melee-no-longer-hurts');
  notes.push('melee still wounds (eye '+eyeHp0+'->'+eyePart.hp+')');

  // ---- 5. the heart runs hot ---------------------------------------------
  if((MM.bosses.heatSources(m.x,60)||[]).length!==0) return fail('sealed-heart-shimmers');
  const ring=m.parts.find(q=>Math.abs(q.dx-m.core.dx)+Math.abs(q.dy-m.core.dy)===1);
  MM.bosses.damageAt(Math.round(m.x)+ring.dx, Math.round(m.y)+ring.dy, 999, {kind:'pickaxe',breakTerrain:true,source:'hero'});
  const hot=MM.bosses.heatSources(m.x,60)||[];
  if(hot.length!==1) return fail('breached-heart-cold n='+hot.length);
  if(!(hot[0].strength>0.4)) return fail('weak-emitter '+hot[0].strength);
  notes.push('breached heart emits heat @'+hot[0].strength.toFixed(2));

  // ---- 5b. a LEANING beast is hit and stood on where it is DRAWN ---------
  MM.bosses.clearAll();
  const ml=MM.bosses.forceSpawn((x,y)=>W.getTile(x,y),{x:bx, seed:1234, force:true, freeze:true});
  if(!ml) return fail('lean-boss-spawn');
  for(let i=0;i<20;i++) await sleep(16);
  ml.tilt=0; ml.tiltV=0;
  const anyPart=ml.parts.find(q=>q.dy<=-2 && q.role!=='core')||ml.parts[0];
  const up=MM.bosses.resolvePartTarget({boss:ml,part:anyPart});
  if(Math.abs(up.x-(ml.x+anyPart.dx+0.5))>1e-9) return fail('upright-not-identity');
  ml.tilt=0.26;
  let exact=0, onBoss=0, tot=0, lattice=0;
  for(const q of ml.parts){
    if(!(q.hp>0)) continue;
    tot++;
    const at=MM.bosses.resolvePartTarget({boss:ml,part:q});
    const h=MM.bosses.partAt(Math.floor(at.x), Math.floor(at.y));
    if(h && h.boss===ml) onBoss++;
    if(h && h.part===q) exact++;
    const hl=MM.bosses.partAt(Math.floor(ml.x+q.dx+0.5), Math.floor(ml.y+q.dy+0.5));
    if(hl && hl.part===q) lattice++;
  }
  if(onBoss!==tot) return fail('lean clicks fall through the beast '+onBoss+'/'+tot);
  if(exact < tot*0.85) return fail('lean hit accuracy '+exact+'/'+tot);
  if(lattice >= tot*0.3) return fail('untilted lattice still answers '+lattice+'/'+tot);
  const crownL=ml.parts.reduce((a,b)=> (b.dy<a.dy? b:a), ml.parts[0]);
  const cAt=MM.bosses.resolvePartTarget({boss:ml,part:crownL});
  const rider={x:cAt.x, y:cAt.y-3, vx:0, vy:0, w:0.7, h:0.95, onGround:false, jumpCount:0, hp:100, maxHp:100, hpInvul:99};
  let rode=false;
  for(let s=0;s<90 && !rode;s++){ rider.vy+=22/60; rider.y+=rider.vy/60; if(MM.bosses.collideHero(rider,1/60)) rode=true; }
  if(!rode) return fail('hero never landed on the leaning beast');
  const gap=MM.bosses.resolvePartTarget({boss:ml,part:crownL}).y - rider.y;
  if(Math.abs(gap-0.99)>0.12) return fail('rider not on the drawn crown, gap '+gap.toFixed(3));
  notes.push('lean 0.26: '+exact+'/'+tot+' clicks exact (lattice '+lattice+'), rider gap '+gap.toFixed(2));
  MM.bosses.clearAll();
  const m2=MM.bosses.forceSpawn((x,y)=>W.getTile(x,y),{x:bx, seed:20260728, force:true, freeze:true});
  if(m2){ const r2=m2.parts.find(q=>Math.abs(q.dx-m2.core.dx)+Math.abs(q.dy-m2.core.dy)===1);
    if(r2) MM.bosses.damageAt(Math.round(m2.x)+r2.dx, Math.round(m2.y)+r2.dy, 999, {kind:'pickaxe',breakTerrain:true,source:'hero'}); }

  // the emissive (bloom) queue actually receives the heart while drawing
  let emissives=0;
  const realAdd=MM.postFx && MM.postFx.addEmissive;
  if(realAdd){
    MM.postFx.addEmissive=function(s){ emissives++; return realAdd.call(MM.postFx,s); };
  }
  // ---- 6. a real canvas survives the new art -----------------------------
  const cv=document.createElement("canvas"); cv.width=900; cv.height=600;
  const c2=cv.getContext('2d');
  const dbg=MM.bosses._debug();
  const mDraw=m2||m;
  dbg.projectiles.push({x:mDraw.x, y:mDraw.y-4, vx:0, vy:0, t:0, max:9, tile:T.STONE, color:'#888a90', spin:0.3, dmg:1});
  c2.save(); c2.translate(-(mDraw.x-12)*20, -(mDraw.y-14)*20);
  MM.bosses.draw(c2, 20, ()=>true);
  c2.restore();
  if(realAdd) MM.postFx.addEmissive=realAdd;
  if(realAdd && emissives<1) return fail('heart registered no light');
  notes.push('draw ok, '+emissives+' emissive light(s) registered');

  // park the beast in front of the camera for the screenshot
  MM.bosses.clearAll();
  const shot=MM.bosses.forceSpawn((x,y)=>W.getTile(x,y),{x:Math.round(p.x)+9, seed:20260728, force:true});
  if(shot){ MM.bosses.damageAt(Math.round(shot.x)+shot.core.dx+1, Math.round(shot.y)+shot.core.dy, 999, {kind:'pickaxe',breakTerrain:true,source:'hero'}); }
  await sleep(700);
  return 'ok|'+notes.join(' | ');
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-bossgravqa-'));
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
					try { pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 500)); } catch (e) { /* ignore */ }
				}
				if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error'){
					try { pageErrors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300)); } catch (e) { /* ignore */ }
				}
			}
		};

		await send(ws, 'Page.enable');
		await send(ws, 'Runtime.enable');
		await send(ws, 'Emulation.setDeviceMetricsOverride', { width: winW, height: winH, deviceScaleFactor: 1, mobile: false });
		await send(ws, 'Page.navigate', { url });
		for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await sleep(250);
		// keep-front pump: an occluded headless tab throttles rAF AND timers
		const front = setInterval(() => { send(ws, 'Page.bringToFront').catch(() => {}); }, 900);
		await send(ws, 'Page.bringToFront');
		await sleep(1500);

		const res = await send(ws, 'Runtime.evaluate', { expression: SCENARIO, awaitPromise: true, returnByValue: true, timeout: 280000 });
		const val = res && res.result ? res.result.value : '(no result)';
		console.log('scenario:', val);
		if (res && res.exceptionDetails){
			console.log('scenario threw:', JSON.stringify(res.exceptionDetails).slice(0, 900));
		}
		const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
		await writeFile(out, Buffer.from(shot.data, 'base64'));
		console.log('wrote', out);
		clearInterval(front);
		if (pageErrors.length){
			console.log('pageErrors:', pageErrors.slice(0, 5).join('\n---\n'));
			process.exitCode = 1;
		}
		if (typeof val !== 'string' || !val.startsWith('ok|')){
			console.log('boss-gravity-qa: FAILED');
			process.exitCode = 1;
		} else {
			console.log('boss-gravity-qa: all live checks passed');
		}
	} finally {
		try { if (ws) ws.close(); } catch (e) { /* closing */ }
		await new Promise(res => {
			if (process.platform === 'win32'){
				// Marker-scoped kill: never taskkill msedge.exe — that takes the
				// author's own browser down with it.
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
