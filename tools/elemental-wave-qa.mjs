#!/usr/bin/env node
// Live end-to-end QA for the elemental wave: sandstorms in the hot east
// (forced ritual-style storm lays UNSTABLE_SAND dunes under the caps, yellow
// haze + hero slowdown), the unified hero status system (wet/burn/chill/frozen
// + electric conduction), the weakened boss matrix helper registry, the
// Ekwipunek discovery tab (??? masking + progress + XP award) and the new
// audio registry names — driven over CDP against the real game in headless
// Edge (real requestAnimationFrame). Fails on ANY console error.
//
// Usage: node tools/elemental-wave-qa.mjs [--url=http://127.0.0.1:8123/index.html]
//        [--seed=42] [--shot=elemental-wave-qa.png]
import { spawn, execFile } from 'node:child_process';
import { writeFile, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
	const hit = args.find(a => a.startsWith('--' + name + '='));
	return hit ? hit.slice(name.length + 3) : dflt;
};
const url = opt('url', 'http://127.0.0.1:8123/index.html');
const seed = opt('seed', '42');
const shotPath = opt('shot', '');

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

// Runs inside the page; returns a plain report object (asserted in Node).
const SCENE = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const R={};
	for(let i=0;i<400 && !(window.MM && MM.world && MM.worldGen && MM.sandstorm && MM.heroStatus && MM.bossStatus && MM.discovery && window.__mmDebugHero);i++) await sleep(100);
	if(!(window.MM && MM.world && MM.sandstorm)) return {fatal:'boot-timeout'};
	MM.fog.setRevealAll(true);
	const T=MM.T, WG=MM.worldGen, gt=MM.world.getTile;

	// --- find hot desert land in the east (sand surface, dry) ---
	let hotX=null;
	for(let x=20000;x<=60000 && hotX==null;x+=131){
		if(WG.temperature(x)<0.80) continue;
		const s=WG.surfaceHeight(x);
		if(s>=WG.settings.seaLevel-1) continue;
		let sandy=0;
		for(let wx=x-8;wx<=x+8;wx++){ const t=gt(wx,WG.surfaceHeight(wx)); if(t===T.SAND||t===T.UNSTABLE_SAND||t===T.FROZEN_SAND) sandy++; }
		if(sandy>=10) hotX=x;
	}
	if(hotX==null) return {fatal:'no-hot-desert'};
	R.hotX=hotX; R.climate=+WG.temperature(hotX).toFixed(3);
	window.__mmDebugHero(hotX, WG.surfaceHeight(hotX)-3);
	await sleep(1500);

	// --- forced sandstorm (the FIRE_SHAMAN ritual path) lays dunes ---
	const dunes=(x0,x1)=>{ let n=0; for(let wx=x0;wx<=x1;wx++){ const s=WG.surfaceHeight(wx); for(let y=s-10;y<=s+2;y++) if(gt(wx,y)===T.UNSTABLE_SAND) n++; } return n; };
	const before=dunes(hotX-140,hotX+140);
	MM.sandstorm.startStorm(40,1,{source:'qa',ownerId:'elemental-qa'});
	await sleep(16000);
	const m=MM.sandstorm.metrics();
	const after=dunes(hotX-140,hotX+140);
	let deepest=0;
	for(let wx=hotX-140;wx<=hotX+140;wx++){
		const s=WG.surfaceHeight(wx);
		let d=0;
		for(let y=s-12;y<=s+2;y++){ if(gt(wx,y)===T.UNSTABLE_SAND) d++; else if(d>0) break; }
		if(d>deepest) deepest=d;
	}
	// A genuinely cold column for the climate gate check: on a FRESH world the
	// hostility axis is still weak (it ramps with world level), so fbm makes hot
	// pockets anywhere — search for real cold instead of assuming a fixed x.
	let coldX=null, coldT=1;
	for(let x=-4000;x>=-64000;x-=197){
		const t=WG.temperature(x);
		if(t<coldT){ coldT=t; coldX=x; }
		if(t<0.25) break;
	}
	R.sandstorm={before, after, deepest, cap:MM.sandstorm.config.DUNE_STACK_STORM,
		lifted:m.lifted, deposited:m.deposited, airborne:m.airborne,
		stormOwnerAt16s:m.storm.ownerId,
		intensityHere:+MM.sandstorm.intensityAt(hotX).toFixed(3),
		coldT:+coldT.toFixed(3),
		intensityCold:+MM.sandstorm.intensityAt(coldX).toFixed(3)};
	// hero AABB guard: nothing minted into the hero
	const p=window.player;
	let inHero=0;
	for(let wx=Math.floor(p.x)-2;wx<=Math.floor(p.x)+2;wx++)
		for(let y=Math.floor(p.y)-3;y<=Math.floor(p.y)+3;y++)
			if(gt(wx,y)===T.UNSTABLE_SAND && Math.abs(wx+0.5-p.x)<1.6 && Math.abs(y+0.5-p.y)<2.4) inHero++;
	R.sandstorm.mintedInHero=inHero;
	// Owner-scoping probed atomically on a fresh storm: a live FIRE_SHAMAN ritual
	// can legitimately take over the long-running storm above, so clean first.
	MM.sandstorm.stopStorm();
	MM.sandstorm.startStorm(20,1,{source:'qa',ownerId:'elemental-qa-owner'});
	const stopForeign=MM.sandstorm.stopStorm({ownerId:'someone-else'});
	const stopOwner=MM.sandstorm.stopStorm({source:'qa',ownerId:'elemental-qa-owner'});
	R.sandstorm.owner={stopForeign, stopOwner};

	// --- hero statuses: wet conduction, fizzle, chill chip, HUD list ---
	const HS=MM.heroStatus;
	HS.clearAll();
	HS.apply('wet',{dur:8});
	const conduct=HS.damageInMult('electric');
	const fizzle=HS.apply('burn',{dur:3,dps:2});
	const chips=HS.list().map(c=>c.icon).join('');
	HS.apply('chill',{dur:3});
	const chillMove=HS.moveMult();
	HS.clearAll();
	R.heroStatus={conduct, fizzle, chips, chillMove, discovery:{
		conduct:MM.discovery.CATALOG.hero_conduct?true:false,
		frozen:MM.discovery.CATALOG.hero_frozen?true:false,
		fizzle:MM.discovery.CATALOG.hero_fizzle?true:false}};

	// --- weakened boss matrix: registry live, downgrade + tunables ---
	const BS=MM.bossStatus;
	const st=BS.createBossStatus();
	const downgraded=BS.applyBossStatus(st,'frozen',{dur:2});
	BS.applyBossStatus(st,'wet',{dur:6});
	R.bossMatrix={downgraded, chillSlow:BS.TUNING.CHILL_SLOW, conduct:BS.bossElectricDamageMult(st),
		burnHalf:BS.TUNING.BURN_DOT_MULT,
		systems:[...BS._systems.keys()]};

	// --- discovery journal: entries masking, XP award, Ekwipunek tab ---
	// (the sandstorm id self-discovers during the storm above, so the XP probe
	// uses hero_frozen — unreachable in a hot desert scene)
	const entriesAll=MM.discovery.entries();
	const masked=entriesAll.filter(e=>!e.found);
	const xpBefore=window.player.xp||0;
	MM.discovery.note('hero_frozen','QA: zamarzniecie');
	const xpAfter=window.player.xp||0;
	document.getElementById('openInv').click();
	await sleep(400);
	const tabs=[...document.querySelectorAll('#invTabs .invTabBtn')];
	const discTab=tabs.find(b=>b.textContent.includes('Odkrycia'));
	if(discTab) discTab.click();
	await sleep(400);
	const cards=[...document.querySelectorAll('#invGrid .invResCard')];
	const maskedCards=cards.filter(c=>c.textContent.includes('???')).length;
	const foundCards=cards.filter(c=>c.textContent.includes('Odkryte')).length;
	const counter=(document.querySelector('.invCapacity')||{}).textContent||'';
	document.getElementById('invClose').click();
	await sleep(200);
	R.discovery={total:entriesAll.length, masked:masked.length, hintSample:(masked[0]||{}).hint||'',
		xpGain:xpAfter-xpBefore, cards:cards.length, maskedCards, foundCards, counter};

	// --- audio registry: every new name synthesizes without throwing ---
	let audioOk=true;
	try{ for(const n of ['sandstorm','freeze','thermalShock','toxicIgnite','chainShock','parry']) MM.audio.play(n); }
	catch(e){ audioOk=false; }
	R.audioOk=audioOk;
	R.frameMs=window.__mmFrameMs;
	return R;
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-elemental-qa-'));
	const proc = spawn(edge, [
		'--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
		'--force-device-scale-factor=1', '--remote-debugging-port=0',
		`--user-data-dir=${profile}`, '--window-size=1600,900', 'about:blank'
	], { stdio: 'ignore' });

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
			if (m.id && pending.has(m.id)){
				const p = pending.get(m.id); pending.delete(m.id);
				if (m.error) p.reject(new Error(p.method + ': ' + JSON.stringify(m.error)));
				else p.resolve(m.result);
			} else if (m.method){
				events.push(m.method);
				if (m.method === 'Runtime.exceptionThrown'){
					try { pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 400)); } catch (e) { /* ignore */ }
				}
				if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error'){
					try { pageErrors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300)); } catch (e) { /* ignore */ }
				}
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

		const evalRes = await send(ws, 'Runtime.evaluate', { expression: SCENE, awaitPromise: true, returnByValue: true, timeout: 240000 });
		const R = evalRes && evalRes.result ? evalRes.result.value : null;
		if (!R || R.fatal) throw new Error('scene failed: ' + (R && R.fatal || 'no result'));
		console.log('report:', JSON.stringify(R));

		console.log('sandstorm:');
		check(R.climate >= 0.8, 'hot desert band found in the east');
		check(R.sandstorm.lifted > 3, 'ritual gale eroded sand crests (lifted ' + R.sandstorm.lifted + ')');
		check(R.sandstorm.after > R.sandstorm.before, 'the desert visibly gained UNSTABLE_SAND dunes');
		check(R.sandstorm.lifted === R.sandstorm.deposited + Math.round(R.sandstorm.airborne), 'sand ledger is volume-true');
		check(R.sandstorm.deepest <= R.sandstorm.cap, 'dunes respect the storm stack cap (deepest ' + R.sandstorm.deepest + ')');
		check(R.sandstorm.mintedInHero === 0, 'no sand minted into the hero AABB');
		check(R.sandstorm.intensityHere > 0.9, 'full storm intensity inside the desert band');
		check(R.sandstorm.coldT < 0.4 && R.sandstorm.intensityCold === 0, 'no sandstorm in a genuinely cold band (t=' + R.sandstorm.coldT + ')');
		check(R.sandstorm.owner.stopForeign === false && R.sandstorm.owner.stopOwner === true, 'storm stop is owner-scoped');
		console.log('hero status:');
		check(R.heroStatus.conduct === 1.5, 'a soaked hero conducts electricity x1.5');
		check(R.heroStatus.fizzle === 'fizzled', 'fire fizzles on the soaked hero');
		check(R.heroStatus.chips.includes('💧'), 'wet renders as a HUD debuff chip');
		check(R.heroStatus.chillMove === 0.55, 'chill slows the hero to x0.55');
		check(R.heroStatus.discovery.conduct && R.heroStatus.discovery.frozen && R.heroStatus.discovery.fizzle, 'hero-reaction discoveries are cataloged');
		console.log('boss matrix:');
		check(R.bossMatrix.downgraded === 'chill', 'bosses downgrade hard freeze to chill');
		check(R.bossMatrix.chillSlow === 0.8 && R.bossMatrix.burnHalf === 0.5 && R.bossMatrix.conduct === 1.25, 'weakened tunables (0.8 / 0.5 / 1.25)');
		check(['bosses','guardianLairs','skyGuardian','undergroundBoss'].every(s => R.bossMatrix.systems.includes(s)), 'all four boss families registered');
		console.log('discovery journal:');
		check(R.discovery.total >= 15, 'catalog covers the new wave (total ' + R.discovery.total + ')');
		check(R.discovery.xpGain === 40, 'a fresh discovery paid +40 XP');
		check(R.discovery.cards === R.discovery.total, 'Ekwipunek tab renders every catalog entry');
		check(R.discovery.maskedCards > 0 && R.discovery.maskedCards === R.discovery.cards - R.discovery.foundCards, '??? masking matches the found split');
		check(/🧪 \d+\/\d+/.test(R.discovery.counter), 'progress counter shows n/total (' + R.discovery.counter + ')');
		console.log('audio:');
		check(R.audioOk, 'new registry names play without throwing');
		console.log('console:');
		check(pageErrors.length === 0, 'no console errors / uncaught exceptions' + (pageErrors.length ? ' -> ' + pageErrors.slice(0, 3).join(' | ') : ''));

		if (shotPath){
			const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
			await writeFile(shotPath, Buffer.from(shot.data, 'base64'));
			console.log('wrote', shotPath);
		}
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
		console.error('elemental-wave-qa: ' + failures.length + ' failure(s)');
		process.exit(1);
	}
	console.log('elemental-wave-qa: all live checks passed');
}

main().catch(e => { console.error('elemental-wave-qa fatal:', e.message); process.exit(1); });
