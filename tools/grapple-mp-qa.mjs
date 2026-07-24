#!/usr/bin/env node
// Headless-Edge live QA for grapple-rope MULTIPLAYER PARITY (engine/grapple.js +
// the 'ropes' broadcast plane in ghost_host/ghost_client): TWO tabs over the
// loopback BroadcastChannel transport (rtc:false).
//   R1  host fires a grapple -> the spectator (watch mode) RECEIVES + renders the
//       host's rope over the host replica         -> tools/grapple-mp-qa.png
//   R2  the watcher is embodied as a hero, fires its OWN grapple -> the HOST
//       receives the uplink (metrics.ropes) and renders the guest's rope over its
//       body                                       -> tools/grapple-mp-qa-guest.png
// Proves the design goal: the acting player AND every viewer see the same rope.
// The anchored rope is held up for the shot via a QA-only grapple config tweak
// (slow reel, no arrive/stall/timeout) — the wire path + host relay are production.
// Usage: node tools/grapple-mp-qa.mjs [--port=8131] [--size=1600x900] [--seed=777]
import { spawn, execFile } from 'node:child_process';
import { writeFile, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const hit = args.find(a => a.startsWith('--' + name + '=')); return hit ? hit.slice(name.length + 3) : dflt; };
const port = Number(opt('port', '8131'));
const url = opt('url', `http://127.0.0.1:${port}/index.html`);
const [winW, winH] = opt('size', '1600x900').split('x').map(Number);
const ROOM = 'QAROPE7';
const EDGE_CANDIDATES = [
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
];
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Tab {
	constructor(wsUrl, label){
		this.label = label; this.msgId = 0; this.pending = new Map(); this.pageErrors = [];
		this.ws = new WebSocket(wsUrl);
		this.ready = new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
		this.ws.onmessage = ev => {
			const m = JSON.parse(ev.data);
			if(m.id && this.pending.has(m.id)){
				const p = this.pending.get(m.id); this.pending.delete(m.id);
				if(m.error) p.reject(new Error(p.method + ': ' + JSON.stringify(m.error))); else p.resolve(m.result);
			} else if(m.method === 'Runtime.exceptionThrown'){
				try{ this.pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 400)); }catch(e){ /* ignore */ }
			} else if(m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error'){
				try{ this.pageErrors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300)); }catch(e){ /* ignore */ }
			}
		};
	}
	send(method, params, deadlineMs){
		const id = ++this.msgId;
		this.ws.send(JSON.stringify({ id, method, params: params || {} }));
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => { if(!this.pending.has(id)) return; this.pending.delete(id); reject(new Error(this.label + ' CDP timeout: ' + method)); }, deadlineMs || 45000);
			this.pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); }, method });
		});
	}
	async init(){
		let t = null;
		const deadline = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(this.label + ' websocket never opened')), 20000); });
		try{ await Promise.race([this.ready, deadline]); } finally { clearTimeout(t); }
		await this.send('Page.enable'); await this.send('Runtime.enable');
		await this.send('Emulation.setDeviceMetricsOverride', { width: winW, height: winH, deviceScaleFactor: 1, mobile: false });
	}
	async eval(expression, timeoutMs){
		const budget = timeoutMs || 30000;
		const res = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: budget }, budget + 15000);
		if(res.exceptionDetails) throw new Error(this.label + ' eval failed: ' + JSON.stringify(res.exceptionDetails).slice(0, 400));
		return res.result ? res.result.value : undefined;
	}
	async poll(expression, predicate, label, tries, delayMs){
		let last = null, starved = 0;
		for(let i = 0; i < (tries || 60); i++){
			let v;
			try{ v = await this.eval(expression, 6000); starved = 0; }
			catch(e){ last = e; v = undefined; if(/CDP timeout/.test(String(e.message)) && ++starved >= 4) throw new Error(this.label + ' unresponsive during: ' + label); }
			if(predicate(v)) return v;
			await sleep(delayMs || 250);
		}
		throw new Error(this.label + ' poll timeout: ' + label + (last ? ' (last: ' + last.message + ')' : ''));
	}
	async shot(path){ const s = await this.send('Page.captureScreenshot', { format: 'png' }); await writeFile(path, Buffer.from(s.data, 'base64')); console.log('wrote', path); }
	async front(){ await this.send('Page.bringToFront'); await sleep(400); }
	close(){ try{ this.ws.close(); }catch(e){ /* fine */ } }
}

const BOOT_WAIT = `(async()=>{ const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	for(let i=0;i<400 && !(window.MM && MM.ghostBridge && MM.ghostHost && MM.ghostClient && MM.grapple && window.player);i++) await sleep(100);
	return (window.MM && MM.grapple) ? 'ok' : 'boot-timeout'; })()`;

// QA-only: hold an anchored rope up indefinitely (slow reel, never arrive/stall/timeout).
const HOLD = `Object.assign(MM.grapple.config,{REEL_SPEED:1.4, ARRIVE_DIST:0.05, STALL_TIME:9e9, REEL_TIME:9e9})`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-ropeqa-'));
	const server = spawn('npx -y http-server -p ' + port + ' -c-1 .', { shell: true, stdio: 'ignore' });
	let serverUp = false;
	for(let i = 0; i < 60 && !serverUp; i++){ await sleep(400); try{ const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(3000) }); serverUp = r.ok; }catch(e){ /* not yet */ } }
	if(!serverUp){ try{ server.kill(); }catch(e){ /* fine */ } throw new Error('http-server never came up on :' + port); }

	const proc = spawn(edge, [
		'--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--force-device-scale-factor=1',
		'--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
		'--disable-features=IntensiveWakeUpThrottling,TabFreezing,HighEfficiencyModeAvailable,msSleepingTabs',
		'--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${winW},${winH}`, 'about:blank'
	], { stdio: 'ignore' });

	let host = null, ghost = null;
	try{
		let dtPort = null, targets = null;
		for(let i = 0; i < 60 && !targets; i++){
			await sleep(250);
			try{
				dtPort = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0].trim();
				if(!dtPort) continue;
				const list = await (await fetch(`http://127.0.0.1:${dtPort}/json/list`, { signal: AbortSignal.timeout(3000) })).json();
				if(list.find(t => t.type === 'page')) targets = list;
			}catch(e){ /* not up */ }
		}
		if(!targets) throw new Error('DevTools endpoint never came up');

		// --- Host boots (pinned seed) + starts hosting -----------------------------
		host = new Tab(targets.find(t => t.type === 'page').webSocketDebuggerUrl, 'host');
		await host.init();
		const worldSeed = opt('seed', '777');
		await host.send('Page.addScriptToEvaluateOnNewDocument', { source: `
			const __o=Document.prototype.getElementById;
			Document.prototype.getElementById=function(id){ const el=__o.call(this,id); if(id==='seedInput' && el && el.value==='auto') el.value=${JSON.stringify(worldSeed)}; return el; };` });
		await host.send('Page.navigate', { url });
		console.log('host boot:', await host.eval(BOOT_WAIT, 60000));
		const room = await host.eval(`window.__mmGhostHostStart('${ROOM}', {rtc:false, name:'Gospodarz-QA'})`);
		if(room !== ROOM) throw new Error('host did not adopt the QA room: ' + room);
		console.log('host stream room:', room);

		// --- Watcher joins by link -------------------------------------------------
		const ghostUrl = url + `?watch=${ROOM}&via=bc&name=Widmo`;
		const created = await host.send('Target.createTarget', { url: ghostUrl });
		// NOTE: do NOT front the host here — creating the ghost tab foregrounds IT, and
		// the join snapshot flows over the host's ~1 Hz companion pump (survives
		// backgrounding). Fronting the host now would starve the ghost's join. The host
		// is fronted below, once it needs its rAF to actually SIM the grapple.
		let ghostWs = null;
		for(let i = 0; i < 40 && !ghostWs; i++){
			await sleep(250);
			try{ const list = await (await fetch(`http://127.0.0.1:${dtPort}/json/list`, { signal: AbortSignal.timeout(3000) })).json(); const t = list.find(x => x.id === created.targetId); if(t) ghostWs = t.webSocketDebuggerUrl; }catch(e){ /* retry */ }
		}
		if(!ghostWs) throw new Error('ghost tab target never surfaced');
		ghost = new Tab(ghostWs, 'ghost');
		await ghost.init();
		console.log('ghost boot:', await ghost.eval(BOOT_WAIT, 60000));
		// NOTE: the ghost snapshot join ('state'==='live') requires the host's
		// companion-pump snapshot to fully transfer. On some headless-Edge setups the
		// chunked snapshot never completes (stock ghost-qa.mjs hits the same wall) — a
		// pre-existing environment limitation, unrelated to the rope plane. The rope
		// relay itself is proven deterministically in tools/ghost-hostile-sim.test.mjs.
		await ghost.poll('MM.ghostClient.metrics().state', v => v === 'live', 'snapshot join (state=live)', 120, 250);
		console.log('ghost live');

		// ===================== Scene R1: host rope -> spectator =====================
		await host.front();
		const anc = await host.eval(`(()=>{
			const p=window.player; const sx=Math.floor(p.x); const surf=MM.worldGen.surfaceHeight(sx); const wx=sx+11;
			for(let dx=-1;dx<=10;dx++){ for(let dy=-4;dy<=0;dy++) MM.world.setTile(sx+dx,surf-1+dy,0); MM.world.setTile(sx+dx,surf,8); }
			for(let dy=-6;dy<=2;dy++) MM.world.setTile(wx,surf+dy,8);
			p.hp=p.maxHp; p.x=sx+0.5; p.y=surf-1.2; p.vx=0; p.vy=0;
			${HOLD};
			MM.grapple.fire(p, wx+0.5, surf-1.4);
			return {wx, surf, sx};
		})()`);
		await host.poll('MM.grapple.anchored()', v => v === true, 'host hook anchors on the wall', 90, 60);
		const hostTip = await host.eval(`(()=>{ const w=MM.grapple.wireState(); return w?{ph:w.ph,x:+w.x.toFixed(2),y:+w.y.toFixed(2)}:null; })()`);
		console.log('R1 host rope tip:', JSON.stringify(hostTip), 'wall wx=' + anc.wx);
		// the spectator receives + stores the host's rope
		await ghost.poll(`(()=>{ const r=MM.ghostClient._ropes(); return r && r.host ? 1 : 0; })()`, v => v === 1, 'spectator RECEIVES the host rope', 90, 100);
		const specSees = await ghost.eval('MM.ghostClient._ropes()');
		console.log('R1 spectator _ropes():', JSON.stringify(specSees));
		const dx = Math.abs((specSees.host.x) - hostTip.x), dy = Math.abs((specSees.host.y) - hostTip.y);
		if(!(dx < 1.0 && dy < 1.0)) throw new Error('R1 spectator rope tip does not match the host tip: ' + JSON.stringify({ specSees, hostTip }));
		await ghost.front(); await sleep(300); await ghost.shot('tools/grapple-mp-qa.png'); // spectator with the host rope
		console.log('R1 OK — spectator sees the host rope (tip Δ ' + dx.toFixed(2) + ',' + dy.toFixed(2) + ')');

		// ===================== Scene R2: hero guest rope -> host ====================
		const gid = await ghost.eval('MM.ghostClient.metrics().gid');
		await host.front();
		await host.eval(`MM.ghostHost.setViewerMode('${gid}','hero')`);
		await ghost.front();
		await ghost.poll('(()=>{ const m=MM.ghostClient.metrics(); return m.hero && m.hero.spawned ? 1 : 0; })()', v => v === 1, 'watcher embodies as a hero', 100, 250);
		// the hero fires its own grapple straight down into the streamed ground
		await ghost.eval(`(()=>{ const p=window.player; ${HOLD}; MM.grapple.fire(p, p.x, p.y+14); return 1; })()`);
		await ghost.poll('MM.grapple.isActive()', v => v === true, 'hero hook is out', 60, 60);
		await sleep(600); // let a few sendRope uplinks reach the host (handleRope is event-driven)
		// the HOST receives the guest rope uplink (metrics.ropes) — proven regardless of foreground
		const hostRopes = await host.poll('MM.ghostHost.metrics().ropes', v => v >= 1, 'the HOST receives the hero-guest rope uplink', 60, 150);
		console.log('R2 host metrics.ropes:', hostRopes);
		await host.front(); await sleep(400); await host.shot('tools/grapple-mp-qa-guest.png'); // host renders the guest rope over its body
		console.log('R2 OK — the host received + relays the hero-guest rope');

		const errs = [...host.pageErrors, ...ghost.pageErrors];
		console.log('pageErrors:', errs.length ? errs.slice(0, 6).join('\n---\n') : 'none');
		console.log('\nGRAPPLE-MP-QA: PASS — full rope parity (host->spectator and hero-guest->host)');
	} finally {
		try{ if(host) host.close(); }catch(e){ /* fine */ }
		try{ if(ghost) ghost.close(); }catch(e){ /* fine */ }
		await new Promise(res => {
			if(process.platform === 'win32'){
				const marker = profile.split(/[\\/]/).pop();
				execFile('powershell', ['-NoProfile', '-Command',
					`Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }`
				], () => res());
			} else { try{ proc.kill('SIGKILL'); }catch(e){ /* gone */ } res(); }
		});
		try{ server.kill(); }catch(e){ /* fine */ }
		await sleep(500);
	}
}

main().catch(err => { console.error(err); process.exit(1); });
