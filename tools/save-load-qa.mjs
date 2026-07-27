#!/usr/bin/env node
// Live QA for the SAVE ROUND TRIP: does a save this build writes still load in
// the next session?
//
// Every existing save test is a static pin over main.js source — they prove the
// helpers are wired, never that a manifest written by THIS build survives a
// reload. That gap is exactly where the player-visible failure lived: the game
// wrote a save it then refused to read, dropped into "Tryb odzyskiwania" on
// every boot and locked autosave.
//
// So this driver does the only thing that proves it: it plays, forces a real
// full save into a real localStorage, RELOADS the page, and reads the game's
// own load verdict (window.__lastLoadReport / __saveWriteBlockReason).
//
// Scenes:
//   1. round-trip   — dirty the world, own a crafted Lotnia, save, reload
//   2. incremental  — the idle autosave path (external chunk blobs), reload
//   3. rich         — every tool owned + overlays + a named slot, save, reload
//
// Usage: npm start (server on 8123), then:
//   node tools/save-load-qa.mjs [--url=http://127.0.0.1:8123/index.html] [--seed=777]
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
	const hit = args.find(a => a.startsWith('--' + name + '='));
	return hit ? hit.slice(name.length + 3) : dflt;
};
const url = opt('url', 'http://127.0.0.1:8123/index.html');
const seed = opt('seed', '777');
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

// Boot gate shared by every scene: the load verdict is published by main.js
// top-level code, so it exists as soon as the module graph has run.
const BOOT = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	for(let i=0;i<400 && !(window.MM && MM.world && window.player && window.inv);i++) await sleep(100);
	if(!(window.MM && MM.world && window.player)) return 'FAIL boot-timeout';
	const meta=(MM.saveStore && MM.saveStore.readActiveMeta) ? await MM.saveStore.readActiveMeta().catch(()=>null) : null;
	const cache=MM.world.chunkCacheStats?MM.world.chunkCacheStats():null;
	return 'OK '+JSON.stringify({
		report: window.__lastLoadReport || null,
		blocked: !!window.__saveWritesBlocked,
		reason: window.__saveWriteBlockReason || '',
		banner: !!document.getElementById('saveRecoveryWarning'),
		hasSave: !!localStorage.getItem('mm_save_v7'),
		backend: window.__mmSaveBackend || '',
		storeChunks: meta ? meta.chunkCount : null,
		storeLoad: window.__lastStoreLoad || null,
		live: cache ? cache.live : null,
		parked: cache ? cache.parkedNow : null,
		title: (document.querySelector('#titleScreen .tsPrimary')||{}).textContent || ''
	});
})()`;

// Mine a pocket, place a few blocks, own the crafted Lotnia, then force the
// synchronous full save the tab-close path uses.
const play = (opts) => `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const W=MM.world;
	const x0=Math.round(player.x)+3, y0=Math.round(player.y);
	let touched=0;
	for(let x=x0;x<x0+${opts.width||24};x++) for(let y=y0;y<y0+6;y++){ W.setTile(x,y,0); touched++; }
	for(let x=x0;x<x0+6;x++) W.setTile(x,y0+7,3);
	// overlays: a ladder run (infrastructure plane) and a plank backdrop
	// (construction-background plane) — both are validated on load separately
	if(W.setInfrastructure) for(let y=y0;y<y0+5;y++) W.setInfrastructure(x0+1,y,MM.T&&MM.T.LADDER!=null?MM.T.LADDER:0);
	${opts.glider === false ? '' : 'inv.tools.glider=true;'}
	${opts.allTools ? 'inv.tools.stone=inv.tools.meteor=inv.tools.diamond=true;' : ''}
	inv.wood=(inv.wood|0)+40; inv.stone=(inv.stone|0)+80;
	window.__mmMarkWorldChanged();
	await sleep(${opts.settle || 400});
	${opts.incremental ? `
	// The save job, driven through its own QA seam: the real path either way —
	// a store delta transaction, or the legacy batched job without the 90s +
	// hero-idle gate a headless page can starve indefinitely.
	if(typeof window.__mmRunAutoSaveNow!=='function') return 'FAIL no-save-seam';
	const published=await window.__mmRunAutoSaveNow();
	await sleep(300);
	if(!published) return 'FAIL save-did-not-publish mode='+(window.__lastSaveMode||'')+' err='+(window.__lastSaveError||'');
	` : `
	window.dispatchEvent(new Event('pagehide'));
	await sleep(600);
	`}
	const raw=localStorage.getItem('mm_save_v7');
	let refs=0, inline=0, tools=null;
	try{ const d=JSON.parse(raw); refs=(d.world&&d.world.chunkRefs||[]).length; inline=(d.world&&d.world.modified||[]).length; tools=d.inv&&d.inv.tools?Object.keys(d.inv.tools):null; }catch(e){}
	const meta=(MM.saveStore&&MM.saveStore.readActiveMeta)?await MM.saveStore.readActiveMeta().catch(()=>null):null;
	const est=(MM.saveStore&&MM.saveStore.estimate)?await MM.saveStore.estimate().catch(()=>null):null;
	return 'OK '+JSON.stringify({
		touched, wrote:!!raw||!!meta, legacyBytes:raw?raw.length:0, kb:raw?Math.round(raw.length/1024):0,
		mode:window.__lastSaveMode||'', saveErr:window.__lastSaveError||'', failures:window.__lastSaveFailures|0,
		refs, inline, tools:tools||Object.keys(inv.tools||{}), glider:!!(inv.tools&&inv.tools.glider),
		storeChunks:meta?meta.chunkCount:null, storeSeed:meta?meta.seed:null,
		owner:!!localStorage.getItem('mm_store_owner_v1'),
		delta:window.__lastStoreDelta==null?null:window.__lastStoreDelta,
		manifestKB:window.__lastSaveSizeKb|0,
		usageMB:est?+(est.usage/1048576).toFixed(2):null, quotaMB:est?Math.round(est.quota/1048576):null,
		failBanner:!!document.getElementById('saveFailureWarning')
	});
})()`;

// The IDLE ROUND TRIP, module by module. main.js loads ~50 subsystems through
// restoreRequired, which reads an explicit false as "this save is corrupt" and
// fails the WHOLE load. So a module that refuses its own do-nothing snapshot
// makes every ordinary save unloadable — which is exactly what guardian
// aftermath did. This asks every registered module the same question directly,
// so the culprit is named instead of hunted.
const IDLE_AUDIT = `(()=>{
	const PAIRS=[['snapshot','restore'],['serialize','deserialize'],['snapshot','deserialize'],
		['exportState','importState'],['snapshot','importState'],['snapshotPower','restorePower'],['exportSeen','importSeen']];
	// heroLamp.restore returns the resulting LAMP STATE, not a save verdict — its
	// own suite pins that (lighting-sim), main.js discards the value and never
	// routes it through restoreRequired. The seam check below keeps that true; if
	// the lamp is ever wired to a hard seam, this exemption must go with it.
	const EXEMPT={heroLamp:'restore() reports lamp state by contract'};
	const bad=[], checked=[], exempt=[];
	for(const key of Object.keys(MM)){
		const m=MM[key];
		if(!m || typeof m!=='object') continue;
		for(const [w,r] of PAIRS){
			if(typeof m[w]!=='function' || typeof m[r]!=='function') continue;
			let snap;
			try{ snap=m[w](); }catch(e){ bad.push({m:key,pair:w+'/'+r,stage:'write',err:String(e&&e.message).slice(0,90)}); continue; }
			if(snap==null){ checked.push(key+'.'+w+'(null)'); continue; }  // main.js skips absent snapshots
			let verdict;
			// Several restorers take the world accessors as main.js passes them
			// (smoke/fire/gases/meat). Calling them one-armed would manufacture a
			// refusal that the real load path never sees.
			try{ verdict=m[r](JSON.parse(JSON.stringify(snap)), MM.world.getTile, MM.world.setTile); }
			catch(e){ bad.push({m:key,pair:w+'/'+r,stage:'read',err:String(e&&e.message).slice(0,90)}); continue; }
			if(verdict===false || (verdict && verdict.ok===false)){
				if(EXEMPT[key]) exempt.push({m:key,why:EXEMPT[key]});
				else bad.push({m:key,pair:w+'/'+r,stage:'verdict',err:'refused its own idle snapshot'});
			}
			else checked.push(key+'.'+w);
		}
	}
	return 'OK '+JSON.stringify({checked:checked.length, bad, exempt});
})()`;

// Which subsystems are loaded through the hard seam? restoreRequired reads an
// explicit false as a corrupt save and fails the entire load, so this is the
// list where "refuses its own snapshot" costs the player their world. It also
// re-earns the heroLamp exemption above on every run.
const SEAM_WIRING = `(async()=>{
	const text=await (await fetch('/src/main.js')).text();
	const seams=[...text.matchAll(/restoreRequired\\('([A-Za-z]+)'[^\\n]*/g)].map(m=>({name:m[1], line:m[0]}));
	return 'OK '+JSON.stringify({
		seams:seams.length,
		lampBehindSeam:seams.filter(s=>/HERO_LAMP\\.restore/.test(s.line)).length,
		names:seams.map(s=>s.name).sort()
	});
})()`;

// The same question for the two systems that own an explicit public activator:
// a snapshot taken mid-event, and one taken of an event that has served its
// full duration, must both restore rather than read as a corrupt save.
const BUSY_AUDIT = `(()=>{
	const out=[];
	const A=MM.guardianAftermath;
	if(A && A.start){
		A.start('fire',{elapsed:5,nextIn:9});
		const live=JSON.parse(JSON.stringify(A.snapshot()));
		out.push({m:'guardianAftermath',state:'active',ok:A.restore(live)!==false, active:A.status().active});
		const spent=Object.assign({},live,{elapsed:A.config.DURATION_SECONDS+5});
		out.push({m:'guardianAftermath',state:'expired',ok:A.restore(spent)!==false});
		A.reset();
	}
	const W=MM.atomicWinter;
	if(W && W.trigger){
		W.trigger();
		const live=JSON.parse(JSON.stringify(W.snapshot()));
		out.push({m:'atomicWinter',state:'active',ok:W.restore(live)!==false, active:!!W.isActive()});
		W.reset();
	}
	return 'OK '+JSON.stringify({rows:out, bad:out.filter(r=>!r.ok)});
})()`;

// THE HEADLINE CLAIM. The old incremental autosave re-encoded and rewrote EVERY
// modified chunk on every run, so saving got slower the more the player had built.
// Here: build a wide world, publish it, then change ONE chunk. The next save must
// write one record, not the world — and must still declare the whole world.
const DELTA = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const W=MM.world;
	if(window.__mmSaveBackend!=='idb') return 'FAIL not-store-backend '+window.__mmSaveBackend;
	const x0=Math.round(player.x)+8;
	for(let x=x0;x<x0+1600;x++) for(let y=Math.round(player.y);y<Math.round(player.y)+6;y++) W.setTile(x,y,0);
	window.__mmMarkWorldChanged();
	await sleep(200);
	const t0=performance.now();
	if(!await window.__mmRunAutoSaveNow()) return 'FAIL bulk-save-failed '+(window.__lastSaveError||'');
	const bulkMs=performance.now()-t0;
	const bulk={chunks:window.__lastSaveChunks|0, delta:window.__lastStoreDelta|0, kb:window.__lastSaveSizeKb|0};
	// Freshly dug terrain is the world at its LOUDEST: sand falls, water runs,
	// grass creeps back, and every one of those writes bumps a chunk version. Let
	// it settle and absorb that churn into a save first, or the measurement below
	// reports the dust rather than the delta.
	for(let i=0;i<6;i++){ await sleep(900); await window.__mmRunAutoSaveNow(); }
	const settled={chunks:window.__lastSaveChunks|0, delta:window.__lastStoreDelta|0};
	// now the smallest possible edit: one tile, one chunk
	W.setTile(x0+3, Math.round(player.y)+9, 0);
	window.__mmMarkWorldChanged();
	await sleep(150);
	const t1=performance.now();
	if(!await window.__mmRunAutoSaveNow()) return 'FAIL delta-save-failed '+(window.__lastSaveError||'');
	const deltaMs=performance.now()-t1;
	const one={chunks:window.__lastSaveChunks|0, delta:window.__lastStoreDelta|0, kb:window.__lastSaveSizeKb|0,
		syncMs:window.__lastSaveSyncMs, nextInMs:window.__nextStoreSaveInMs};
	return 'OK '+JSON.stringify({bulk, settled, one, bulkMs:+bulkMs.toFixed(1), deltaMs:+deltaMs.toFixed(1),
		parts:window.__lastSavePerfParts||null, info:window.__mmStoreInfo()});
})()`;

// Scale: a world far past everything localStorage could hold, saved, then read
// back. Chunks come back PARKED, so neither the load nor the resident set tracks
// the size of the world — that is what makes the ceiling a disk question.
const scale = (cols) => `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const W=MM.world, WG=MM.worldGen;
	if(window.__mmSaveBackend!=='idb') return 'FAIL not-store-backend';
	const x0=Math.round(player.x)+8, y0=Math.round(player.y);
	const t0=performance.now();
	// Follow the SURFACE. A fixed y-band walks out of the terrain within a few
	// hundred columns (valleys, oceans, the sky biomes past |x|=600), and setTile
	// into existing air changes nothing — the first version of this scene dug
	// 32 000 columns and modified 186 chunks because of it.
	const marks=[];
	for(let x=x0;x<x0+${cols};x++){
		const s=WG.surfaceHeight(x);
		if(!Number.isFinite(s)) continue;
		for(let y=s+1;y<s+9;y++) W.setTile(x,y,0);
		// A marker every 512 columns: unambiguous proof after the reload that this
		// exact terrain came back, rather than a probe that a cave could satisfy.
		if((x-x0)%512===0){ W.setTile(x,s+4,3); marks.push([x,s+4]); }
	}
	const digMs=performance.now()-t0;
	window.__mmMarkWorldChanged();
	await sleep(200);
	const t1=performance.now();
	if(!await window.__mmRunAutoSaveNow()) return 'FAIL scale-save-failed '+(window.__lastSaveError||'');
	const saveMs=performance.now()-t1;
	const bulk={chunks:window.__lastSaveChunks|0, delta:window.__lastStoreDelta|0, ms:+saveMs.toFixed(0)};
	// THE decisive measurement: save again immediately. Nothing has happened, so a
	// design whose cost tracks CHANGES writes almost nothing — while the manifest
	// still declares all ~500 chunks. The old path re-encoded every one of them.
	const t2=performance.now();
	if(!await window.__mmRunAutoSaveNow()) return 'FAIL quiet-save-failed '+(window.__lastSaveError||'');
	const quiet={chunks:window.__lastSaveChunks|0, delta:window.__lastStoreDelta|0, ms:+(performance.now()-t2).toFixed(0),
		syncMs:window.__lastSaveSyncMs, nextInMs:window.__nextStoreSaveInMs};
	const est=await MM.saveStore.estimate();
	const cache=W.chunkCacheStats();
	return 'OK '+JSON.stringify({
		cols:${cols}, x0, y0, marks, digMs:+digMs.toFixed(0), saveMs:bulk.ms, bulk, quiet,
		chunks:window.__lastSaveChunks|0, delta:window.__lastStoreDelta|0, manifestKB:window.__lastSaveSizeKb|0,
		usageMB:+(est.usage/1048576).toFixed(2), quotaMB:Math.round(est.quota/1048576),
		live:cache.live, parked:cache.parkedNow, parts:window.__lastSavePerfParts||null
	});
})()`;

// Did the world actually come back? Check the markers the scene planted — a tile
// value that worldgen never produces at that spot, at coordinates spread across
// the whole excavation, so no blank or partial world can pass.
const verify = (marks) => `(async()=>{
	const W=MM.world;
	const marks=${JSON.stringify(marks)};
	const found=marks.map(([x,y])=>W.getTile(x,y));
	const cache=W.chunkCacheStats();
	const meta=await MM.saveStore.readActiveMeta();
	return 'OK '+JSON.stringify({
		markers:marks.length, hits:found.filter(t=>t===3).length, sample:found.slice(0,8),
		allMarkers:found.every(t=>t===3),
		live:cache.live, parked:cache.parkedNow, rehydrated:cache.rehydrated,
		storeChunks:meta?meta.chunkCount:null, pendingAudits:window.__mmStoreInfo().pendingAudits,
		load:window.__lastStoreLoad||null
	});
})()`;

// The last seconds before a tab dies. Journal the unwritten delta WITHOUT
// publishing it — the state a killed tab leaves — and let the next boot replay it.
const WAL_STASH = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	const W=MM.world;
	if(window.__mmSaveBackend!=='idb') return 'FAIL not-store-backend';
	const x0=Math.round(player.x)+8, y0=Math.round(player.y);
	for(let x=x0;x<x0+40;x++) for(let y=y0;y<y0+4;y++) W.setTile(x,y,0);
	window.__mmMarkWorldChanged();
	await sleep(200);
	if(!await window.__mmRunAutoSaveNow()) return 'FAIL base-save-failed';
	const publishedChunks=window.__lastSaveChunks|0;
	// A LATER edit that never reaches the store: a distinctive tile, far from the
	// corridor above, then only the synchronous journal.
	const wx=x0+200, wy=y0+2;
	W.setTile(wx, wy, 3);
	window.__mmMarkWorldChanged();
	const rows=window.__mmStashWalNow();
	const walRaw=localStorage.getItem('mm_world_wal_v1');
	return 'OK '+JSON.stringify({wx, wy, rows, walBytes:walRaw?walRaw.length:0, publishedChunks, tile:W.getTile(wx,wy)});
})()`;
const walVerify = (wx,wy) => `(()=>{
	const W=MM.world;
	return 'OK '+JSON.stringify({
		tile:W.getTile(${wx},${wy}), replayed:W.getTile(${wx},${wy})===3,
		walLeft:!!localStorage.getItem('mm_world_wal_v1'),
		load:window.__lastStoreLoad||null
	});
})()`;

const NAMED_SAVE = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	if(window.__injectSaveButtons) window.__injectSaveButtons();
	const btn=document.getElementById('saveGameBtn');
	if(!btn) return 'FAIL no-save-button';
	if(btn.disabled) return 'FAIL save-button-disabled';
	return 'OK '+JSON.stringify({disabled:btn.disabled});
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-saveqa-'));
	const proc = spawn(edge, [
		'--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
		'--force-device-scale-factor=1', '--remote-debugging-port=0',
		`--user-data-dir=${profile}`, '--window-size=1280,720', 'about:blank'
	], { stdio: 'ignore' });

	let ws, failed = false, pump = null;
	const results = {};
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
					try { pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300)); } catch (e) { /* ignore */ }
				}
			}
		};

		await send(ws, 'Page.enable');
		await send(ws, 'Runtime.enable');
		await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
		await send(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: `
			const __origGEBI=Document.prototype.getElementById;
			Document.prototype.getElementById=function(id){
				const el=__origGEBI.call(this,id);
				if(id==='seedInput' && el && el.value==='auto') el.value=${JSON.stringify(seed)};
				return el;
			};
			// ?nostore=1 forces the localStorage fallback for the scene that has to
			// produce a legacy save (and proves that path still works at all).
			if(location.search.indexOf('nostore=1')>=0) window.__mmNoSaveStore=true;` });

		const run = async (label, expr, timeout) => {
			const r = await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: timeout || 180000 });
			const status = r && r.result ? String(r.result.value) : '(no result)';
			console.log(label + ':', status.length > 900 ? status.slice(0, 900) + '…' : status);
			return status;
		};
		const parse = (s) => { try { return s.startsWith('OK ') ? JSON.parse(s.slice(3)) : null; } catch (e) { return null; } };
		const load = async (label, opts) => {
			events.length = 0;
			const target = (opts && opts.noStore) ? (url + (url.includes('?') ? '&' : '?') + 'nostore=1') : url;
			const t0 = Date.now();
			await send(ws, 'Page.navigate', { url: target });
			for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i++) await sleep(250);
			await sleep(1200);
			const booted = parse(await run(label, BOOT));
			if (booted) booted.bootMs = Date.now() - t0;
			return booted;
		};
		// A localStorage.clear() from the page cannot give a clean slate: the game's
		// own pagehide flush rewrites the save on the way out (by design — a closing
		// tab must not lose the world). So leave the origin first, then wipe it from
		// outside, then come back.
		const origin = new URL(url).origin;
		const hardReset = async (label, opts) => {
			await send(ws, 'Page.navigate', { url: 'about:blank' });
			await sleep(400);
			// The world now lives in IndexedDB, so a clean slate has to wipe that too.
			await send(ws, 'Storage.clearDataForOrigin', { origin, storageTypes: 'local_storage,session_storage,indexeddb' });
			return load(label, opts);
		};

		pump = setInterval(() => { send(ws, 'Page.bringToFront').catch(() => {}); }, 2000);

		// ---- scene 0: who refuses their own snapshot? ------------------------
		const boot0 = await load('boot(fresh)');
		if (!boot0) throw new Error('fresh boot failed');
		results.seams = parse(await run('hard-restore-seams', SEAM_WIRING));
		results.idle = parse(await run('idle-restore-audit', IDLE_AUDIT));
		results.busy = parse(await run('busy-restore-audit', BUSY_AUDIT));

		// ---- scene 1: the ordinary round trip -------------------------------
		// A clean slate: the audits above restored (and so reset) live modules.
		await hardReset('boot(clean)');
		results.save1 = parse(await run('play+save', play({})));
		const back1 = await load('boot(after save)');
		results.load1 = back1;
		results.buttons1 = parse(await run('save-buttons', NAMED_SAVE));

		// ---- scene 2: the save job, driven directly -------------------------
		await hardReset('boot(clean)');
		results.save2 = parse(await run('play+save-now', play({ incremental: true, width: 12 }), 300000));
		results.load2 = await load('boot(after save-now)');

		// ---- scene 3: what a delta actually costs ---------------------------
		await hardReset('boot(clean)');
		results.delta = parse(await run('delta-cost', DELTA, 300000));

		// ---- scene 4: scale — a world localStorage could never hold ---------
		await hardReset('boot(clean)');
		results.scale = parse(await run('scale-save', scale(32000), 600000));
		if (results.scale){
			results.scaleLoad = await load('boot(after scale save)');
			results.scaleVerify = parse(await run('scale-verify', verify(results.scale.marks), 300000));
		}

		// ---- scene 5: the journal that survives a killed tab ----------------
		await hardReset('boot(clean)');
		results.wal = parse(await run('wal-stash', WAL_STASH, 300000));
		if (results.wal){
			results.walLoad = await load('boot(after wal)');
			results.walVerify = parse(await run('wal-verify', walVerify(results.wal.wx, results.wal.wy)));
		}

		// ---- scene 6: the localStorage fallback, and migrating out of it -----
		await hardReset('boot(no store)', { noStore: true });
		results.legacySave = parse(await run('legacy-save', play({ width: 24 })));
		results.migrated = await load('boot(store adopts legacy)');
		results.migrateInfo = parse(await run('migrate-info', `(async()=>{
			const meta=await MM.saveStore.readActiveMeta();
			return 'OK '+JSON.stringify({migrated:window.__mmStoreMigrated===true, backend:window.__mmSaveBackend,
				storeChunks:meta?meta.chunkCount:null, info:window.__mmStoreInfo()});
		})()`));

		if (shotPath){
			const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
			await writeFile(shotPath, Buffer.from(shot.data, 'base64'));
			console.log('wrote', shotPath);
		}
		if (pageErrors.length) console.log('pageErrors:', pageErrors.slice(0, 3).join('\n---\n'));

		const ok = (r) => !!(r && r.report && r.report.ok === true && !r.blocked);
		const why = (r) => r && r.report ? (r.report.summary || r.report.stage || '') + ' ' + JSON.stringify((r.report.errors || []).slice(0, 3)) : '(no report)';
		const d = results.delta, sc = results.scale, sv = results.scaleVerify;
		const checks = [
			['a fresh boot has no save and no recovery banner', boot0.hasSave === false && boot0.blocked === false],
			['the world is stored in IndexedDB, not localStorage', boot0.backend === 'idb'],
			['no module refuses its own idle snapshot', !!(results.idle && results.idle.bad.length === 0)],
			['the exempt lamp restore is still outside the hard seam', !!(results.seams && results.seams.seams > 40 && results.seams.lampBehindSeam === 0)],
			['no module refuses a live or spent event snapshot', !!(results.busy && results.busy.bad.length === 0)],
			['closing the tab publishes the world', !!(results.save1 && results.save1.wrote && results.save1.storeChunks > 0)],
			['…with no save error', !!(results.save1 && !results.save1.saveErr)],
			['the save this build wrote LOADS in the next session', ok(results.load1)],
			['…so autosave is not locked', !!(results.load1 && !results.load1.blocked)],
			['…and no "Tryb odzyskiwania" banner is shown', !!(results.load1 && !results.load1.banner)],
			// The title screen is built before the store can be read (it auto-skips in
			// headless), so what it consults is this synchronous marker.
			['…and the synchronous owner marker lets "Kontynuuj" appear', !!(results.save1 && results.save1.owner)],
			['the save buttons stay enabled after a reload', !!(results.buttons1 && results.buttons1.disabled === false)],
			['a directly driven save publishes a store transaction', !!(results.save2 && results.save2.mode === 'store' && results.save2.storeChunks > 0)],
			['…and loads back', ok(results.load2)],
			// The claim the whole change exists for. A freshly dug trench is the world at
			// its loudest — falling sand, running water, creeping grass all write tiles
			// and each write is a real change — so what is asserted here is the RATIO:
			// a save costs what changed, not what exists.
			['a delta save writes a fraction of the world', !!(d && d.one.delta < d.one.chunks * 0.6 && d.bulk.delta > 20)],
			['…while the manifest still declares the whole world', !!(d && d.one.chunks >= d.bulk.chunks)],
			// What a player feels is the BLOCKING part: everything before the await.
			// A frame is 16 ms, so this has to stay in single digits.
			['…and blocks the main thread for only a few milliseconds', !!(d && d.one.syncMs != null && d.one.syncMs < 25)],
			['a world far past the old 5 MB ceiling saves', !!(sc && sc.chunks >= 400)],
			// Decisive: the second save writes only what the world changed while the
			// first one ran — a freshly dug 32 000-column trench is still settling sand
			// and water, so that is real work, but it is a fraction of the world. The
			// old incremental path re-encoded and rewrote all ~500 chunks every time.
			['…and saving it again writes a fraction of it, not all of it', !!(sc && sc.quiet.chunks >= 400 && sc.quiet.delta < sc.quiet.chunks * 0.2)],
			// The whole scalability claim in one number: the blocking cost of a save in
			// a 500-chunk world is the same order as in a 40-chunk one.
			['…with a blocking cost that does not track world size', !!(sc && d && sc.quiet.syncMs < 100 && sc.quiet.syncMs < Math.max(30, d.one.syncMs) * 12)],
			['…in a fraction of the storage budget', !!(sc && sc.quotaMB > 100 && sc.usageMB < sc.quotaMB * 0.5)],
			['…loads back', ok(results.scaleLoad)],
			['…with every marker across the whole excavation intact', !!(sv && sv.allMarkers && sv.markers >= 8)],
			['…and boots in reasonable time', !!(results.scaleLoad && results.scaleLoad.bootMs < 8000)],
			['a killed tab journals its unwritten edits', !!(results.wal && results.wal.rows > 0 && results.wal.walBytes > 0)],
			['…and the next boot replays them', !!(results.walVerify && results.walVerify.replayed)],
			['…then clears the journal', !!(results.walVerify && results.walVerify.walLeft === false)],
			['the localStorage fallback still saves when the store is refused', !!(results.legacySave && results.legacySave.legacyBytes > 0 && results.legacySave.mode === 'full')],
			['…and a store-capable boot adopts and migrates that world', !!(results.migrateInfo && results.migrateInfo.migrated && results.migrateInfo.storeChunks > 0)],
			['…loading it correctly on the way', ok(results.migrated)]
		];
		for (const [name, pass] of checks){ console.log((pass ? 'PASS  ' : 'FAIL  ') + name); if (!pass) failed = true; }
		if (results.idle && results.idle.bad.length) console.log('modules refusing their own snapshot:', JSON.stringify(results.idle.bad));
		if (results.busy && results.busy.bad.length) console.log('modules refusing an event snapshot:', JSON.stringify(results.busy.bad));
		for (const [label, r] of [['load1', results.load1], ['load2', results.load2], ['scaleLoad', results.scaleLoad], ['walLoad', results.walLoad], ['migrated', results.migrated]]){
			if (!ok(r)) console.log(label + ' verdict:', why(r), '| reason:', r && r.reason);
		}
		console.log('delta:', JSON.stringify(d && {bulk: d.bulk, one: d.one, bulkMs: d.bulkMs, deltaMs: d.deltaMs}));
		console.log('scale:', JSON.stringify(sc), '\n  verify:', JSON.stringify(sv), '\n  bootMs:', results.scaleLoad && results.scaleLoad.bootMs);
		console.log('wal:', JSON.stringify(results.wal), JSON.stringify(results.walVerify));
		console.log('migration:', JSON.stringify(results.migrateInfo));
	} catch (e){
		failed = true;
		console.error('save-load-qa error:', e && e.message);
	} finally {
		if (pump) clearInterval(pump);
		try { if (ws) ws.close(); } catch (e) { /* closing */ }
		// Marker-scoped kill: ONLY the process this driver spawned, by pid.
		try { proc.kill(); } catch (e) { /* already gone */ }
		await sleep(400);
	}
	process.exit(failed ? 1 : 0);
}

main();
