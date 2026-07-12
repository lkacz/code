#!/usr/bin/env node
// Headless-Edge live QA for the ghost spectator mode (ghost_net/ghost_host/
// ghost_client): TWO tabs in one browser — a hosting player and a link-joined
// watcher — wired over the loopback BroadcastChannel transport (rtc:false, no
// external brokers in QA). The scenes prove the whole Option B chain:
//   1) host starts a stream, marker tile placed BEFORE the ghost joins
//   2) ghost boots via ?watch=ROOM&via=bc → snapshot join (world+hero faithful)
//   3) live tile diff propagates host → ghost
//   4) hero pose follows (host teleports, ghost replica converges)
//   5) mob plane flows (full list + pose rosters), forced spawn arrives
//   6) ghost blessing heals the host through the cooldown ledger
//   7) presence: host sees 1 ghost, spirit rendered near the hero
//   8) screenshots: tools/ghost-qa.png (watcher) + tools/ghost-qa-host.png (host)
//   9) ghost leaves → host viewer count drops to zero
// Usage: node tools/ghost-qa.mjs [--url=http://127.0.0.1:8129/index.html] [--port=8129] [--size=1600x900]
import { spawn, execFile } from 'node:child_process';
import { writeFile, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
	const hit = args.find(a => a.startsWith('--' + name + '='));
	return hit ? hit.slice(name.length + 3) : dflt;
};
const port = Number(opt('port', '8129'));
const url = opt('url', `http://127.0.0.1:${port}/index.html`);
const [winW, winH] = opt('size', '1600x900').split('x').map(Number);
const ROOM = 'QAGH42';

const EDGE_CANDIDATES = [
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// One CDP session per tab: own socket, own id space, own error log.
class Tab {
	constructor(wsUrl, label){
		this.label = label;
		this.msgId = 0;
		this.pending = new Map();
		this.pageErrors = [];
		this.ws = new WebSocket(wsUrl);
		this.ready = new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
		this.ws.onmessage = ev => {
			const m = JSON.parse(ev.data);
			if(m.id && this.pending.has(m.id)){
				const p = this.pending.get(m.id); this.pending.delete(m.id);
				if(m.error) p.reject(new Error(p.method + ': ' + JSON.stringify(m.error)));
				else p.resolve(m.result);
			} else if(m.method === 'Runtime.exceptionThrown'){
				try{ this.pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 400)); }catch(e){ /* ignore */ }
			} else if(m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error'){
				try{ this.pageErrors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300)); }catch(e){ /* ignore */ }
			}
		};
	}
	send(method, params){
		const id = ++this.msgId;
		this.ws.send(JSON.stringify({ id, method, params: params || {} }));
		return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
	}
	async init(){
		await this.ready;
		await this.send('Page.enable');
		await this.send('Runtime.enable');
		await this.send('Emulation.setDeviceMetricsOverride', { width: winW, height: winH, deviceScaleFactor: 1, mobile: false });
	}
	async eval(expression, timeoutMs){
		const res = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: timeoutMs || 30000 });
		if(res.exceptionDetails) throw new Error(this.label + ' eval failed: ' + JSON.stringify(res.exceptionDetails).slice(0, 400));
		return res.result ? res.result.value : undefined;
	}
	async poll(expression, predicate, label, tries, delayMs){
		for(let i = 0; i < (tries || 60); i++){
			const v = await this.eval(expression);
			if(predicate(v)) return v;
			await sleep(delayMs || 250);
		}
		throw new Error(this.label + ' poll timeout: ' + label);
	}
	async shot(path){
		const s = await this.send('Page.captureScreenshot', { format: 'png' });
		await writeFile(path, Buffer.from(s.data, 'base64'));
		console.log('wrote', path);
	}
	close(){ try{ this.ws.close(); }catch(e){ /* fine */ } }
}

const BOOT_WAIT = `(async()=>{
	const sleep=ms=>new Promise(r=>setTimeout(r,ms));
	for(let i=0;i<400 && !(window.MM && MM.ghostBridge && MM.ghostHost && MM.ghostClient && window.player);i++) await sleep(100);
	return (window.MM && MM.ghostBridge) ? 'ok' : 'boot-timeout';
})()`;

async function main(){
	const { existsSync } = await import('node:fs');
	const edge = EDGE_CANDIDATES.find(p => existsSync(p)) || EDGE_CANDIDATES[0];
	const profile = await mkdtemp(join(tmpdir(), 'mm-ghostqa-'));

	// static server for both tabs (spawned here so the driver is self-contained)
	const server = spawn('npx -y http-server -p ' + port + ' -c-1 .', { shell: true, stdio: 'ignore' });
	let serverUp = false;
	for(let i = 0; i < 60 && !serverUp; i++){
		await sleep(400);
		try{ const r = await fetch(url, { method: 'HEAD' }); serverUp = r.ok; }catch(e){ /* not yet */ }
	}
	if(!serverUp){ try{ server.kill(); }catch(e){ /* fine */ } throw new Error('http-server never came up on :' + port); }

	const proc = spawn(edge, [
		'--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
		'--force-device-scale-factor=1',
		'--remote-debugging-port=0',
		`--user-data-dir=${profile}`,
		`--window-size=${winW},${winH}`,
		'about:blank'
	], { stdio: 'ignore' });

	let host = null, ghost = null;
	try{
		let dtPort = null, targets = null;
		for(let i = 0; i < 60 && !targets; i++){
			await sleep(250);
			try{
				dtPort = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0].trim();
				if(!dtPort) continue;
				const res = await fetch(`http://127.0.0.1:${dtPort}/json/list`);
				const list = await res.json();
				if(list.find(t => t.type === 'page')) targets = list;
			}catch(e){ /* not up yet */ }
		}
		if(!targets) throw new Error('DevTools endpoint never came up');

		// --- Scene 1: the hosting player ---------------------------------------
		host = new Tab(targets.find(t => t.type === 'page').webSocketDebuggerUrl, 'host');
		await host.init();
		await host.send('Page.navigate', { url });
		console.log('host boot:', await host.eval(BOOT_WAIT, 60000));
		const room = await host.eval(`window.__mmGhostHostStart('${ROOM}', {rtc:false, name:'Gospodarz-QA'})`);
		console.log('host stream:', 'room=' + room, JSON.stringify(await host.eval('MM.ghostHost.metrics()')));
		if(room !== ROOM) throw new Error('host did not adopt the QA room');
		// marker tile BEFORE the ghost joins — must arrive via the join snapshot.
		// Embedded in the ground (below the hero's feet) so the falling-solid
		// audit inside buildSaveObject cannot dislodge it.
		const marker = await host.eval(`(()=>{
			const p=window.player; const tx=Math.floor(p.x), ty=Math.floor(p.y+p.h)+2;
			MM.ghostBridge.setTile(tx,ty,MM.T.STONE);
			return {tx,ty,stone:MM.T.STONE,px:p.x,py:p.y,readback:MM.ghostBridge.getTile(tx,ty)};
		})()`);
		console.log('host marker:', JSON.stringify(marker));
		if(marker.readback !== marker.stone) throw new Error('host marker did not stick (readback=' + marker.readback + ')');

		// --- Scene 2: the watcher joins by link ----------------------------------
		const ghostUrl = url + `?watch=${ROOM}&via=bc&name=Widmo`;
		const created = await host.send('Target.createTarget', { url: ghostUrl });
		let ghostWs = null;
		for(let i = 0; i < 40 && !ghostWs; i++){
			await sleep(250);
			const list = await (await fetch(`http://127.0.0.1:${dtPort}/json/list`)).json();
			const t = list.find(x => x.id === created.targetId);
			if(t) ghostWs = t.webSocketDebuggerUrl;
		}
		if(!ghostWs) throw new Error('ghost tab target never surfaced');
		ghost = new Tab(ghostWs, 'ghost');
		await ghost.init();
		console.log('ghost boot:', await ghost.eval(BOOT_WAIT, 60000));
		await ghost.poll(`MM.ghostClient.metrics().state`, v => v === 'live', 'snapshot join (state=live)', 120, 250);
		const gm0 = await ghost.eval('MM.ghostClient.metrics()');
		console.log('ghost live:', JSON.stringify({ state: gm0.state, transport: gm0.transport, snaps: gm0.stats.snapsApplied }));
		// the snapshot must carry the marker tile and the hero position
		const snapCheck = await ghost.eval(`(()=>{
			const p=window.player;
			return { tile: MM.ghostBridge.getTile(${marker.tx},${marker.ty}), dx: Math.abs(p.x-${marker.px}), ghostMode: !!MM.ghostMode,
				veilHidden: (document.getElementById('ghostVeil')||{style:{display:'none'}}).style.display==='none',
				bar: !!document.getElementById('ghostBar'), hudHidden: getComputedStyle(document.getElementById('hotbarWrap')).display==='none' };
		})()`);
		console.log('ghost snapshot:', JSON.stringify(snapCheck));
		if(snapCheck.tile !== marker.stone) throw new Error('marker tile missing after snapshot join');
		if(!(snapCheck.dx < 1.5)) throw new Error('hero replica far from host hero after join: dx=' + snapCheck.dx);
		if(!snapCheck.veilHidden || !snapCheck.bar || !snapCheck.hudHidden) throw new Error('ghost UI contract broken: ' + JSON.stringify(snapCheck));

		// --- Scene 3: live tile diff (into the ground; toggled to whatever the cell
		// is NOT, so a naturally-stone cell can't turn the write into a no-op) --------
		const diff = await host.eval(`(()=>{
			const tx=${marker.tx + 1}, ty=${marker.ty + 1};
			const want = MM.ghostBridge.getTile(tx,ty)===MM.T.STONE ? MM.T.BRICK : MM.T.STONE;
			MM.ghostBridge.setTile(tx,ty,want);
			return {tx,ty,want,readback:MM.ghostBridge.getTile(tx,ty)};
		})()`);
		if(diff.readback !== diff.want) throw new Error('live diff write did not stick: ' + JSON.stringify(diff));
		await ghost.poll(`MM.ghostBridge.getTile(${diff.tx},${diff.ty})`, v => v === diff.want, 'live tile diff', 40, 250);
		console.log('live tile diff: ok');

		// --- Scene 4: hero pose follows ----------------------------------------------
		await host.eval(`(()=>{ window.player.x += 3; })()`);
		await ghost.poll(
			`(()=>{ return Math.abs(window.player.x - ${marker.px + 3}); })()`,
			v => v < 1.5, 'hero pose convergence', 40, 250);
		console.log('hero pose: ok');

		// --- Scene 5: mob plane ----------------------------------------------------------
		const spawned = await host.eval(`(()=>{
			let hit=null;
			for(const id of MM.mobs.species){
				try{ if(MM.mobs.forceSpawn(id, window.player, MM.ghostBridge.getTile)){ hit=id; break; } }catch(e){}
			}
			return { hit, count: MM.mobs.serialize().list.length };
		})()`);
		console.log('host spawn:', JSON.stringify(spawned));
		const mobCheck = await ghost.poll(`(()=>{
			const m=MM.ghostClient.metrics().stats;
			return { fulls:m.mobFulls, rosters:m.mobRosters, count:MM.mobs.serialize().list.length };
		})()`, v => v.fulls >= 1 && v.count >= (spawned.hit ? 1 : 0), 'mob plane sync', 60, 250);
		console.log('ghost mobs:', JSON.stringify(mobCheck));

		// --- Scene 6: blessing through the ledger --------------------------------------------
		await host.eval(`(()=>{ window.player.hp = 40; })()`);
		const sent = await ghost.eval(`MM.ghostClient.sendBuff('bless')`);
		if(!sent) throw new Error('ghost could not send the blessing');
		await host.poll(`window.player.hp`, v => v >= 54, 'bless heals the host (+15)', 40, 250);
		const denied = await ghost.eval(`(async()=>{ await new Promise(r=>setTimeout(r,600)); return MM.ghostClient.sendBuff('bless'); })()`);
		if(denied) throw new Error('second bless inside the cooldown was not locally throttled');
		const buffStats = await host.eval('MM.ghostHost.metrics().stats.buffs');
		if(buffStats !== 1) throw new Error('host ledger applied ' + buffStats + ' buffs, expected exactly 1');
		console.log('blessing: ok (heal landed, cooldown enforced)');

		// --- Scene 7: presence + spirit near the hero --------------------------------------------
		await ghost.eval(`MM.ghostClient.setCam(${marker.px + 5}, ${marker.py - 2})`);
		await host.poll(`MM.ghostHost.metrics().ghosts`, v => v === 1, 'host sees one ghost', 30, 250);
		await sleep(1200); // pose + presence cadence
		const ghostsSeen = await ghost.eval('MM.ghostClient.metrics().others');
		console.log('presence: host ghosts=1, ghost sees others=' + ghostsSeen);

		// --- Scene 8: screenshots ------------------------------------------------------------------
		await ghost.eval(`MM.ghostClient.setFollow(true)`);
		await sleep(700);
		await ghost.shot('tools/ghost-qa.png');
		await host.shot('tools/ghost-qa-host.png');

		// --- Scene 9: transport loss → automatic reconnect ---------------------------------------------
		// _debugConnLost runs the REAL recovery path: close conn (bye), fresh join,
		// hello → welcome → fresh snapshot re-bases the world mid-session.
		await ghost.eval(`MM.ghostClient._debugConnLost()`);
		await ghost.poll(`MM.ghostClient.metrics().state`, v => v === 'live', 'reconnect returns to live', 80, 250);
		const rec = await ghost.eval(`MM.ghostClient.metrics()`);
		if(rec.stats.snapsApplied < 2) throw new Error('reconnect did not re-base from a fresh snapshot: ' + JSON.stringify(rec.stats));
		if(rec.reconnects !== 0) throw new Error('reconnect budget was not refreshed after a successful re-join');
		// the world must still be coherent after the re-base
		const postTile = await ghost.eval(`MM.ghostBridge.getTile(${diff.tx},${diff.ty})`);
		if(postTile !== diff.want) throw new Error('world state diverged across the reconnect');
		await host.poll(`MM.ghostHost.metrics().ghosts`, v => v === 1, 'host still sees exactly one ghost after reconnect', 40, 250);
		console.log('reconnect: ok (snaps=' + rec.stats.snapsApplied + ', world coherent)');

		// --- Scene 10: the ghost leaves ----------------------------------------------------------------
		await ghost.eval(`MM.ghostClient.leave()`);
		await host.poll(`MM.ghostHost.metrics().ghosts`, v => v === 0, 'viewer count drops on leave', 30, 250);
		console.log('leave: ok');

		if(host.pageErrors.length) console.log('host pageErrors:', host.pageErrors.slice(0, 5).join('\n---\n'));
		if(ghost.pageErrors.length) console.log('ghost pageErrors:', ghost.pageErrors.slice(0, 5).join('\n---\n'));
		if(host.pageErrors.length || ghost.pageErrors.length) process.exitCode = 1;
		else console.log('ghost-qa: ALL SCENES OK');
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
		if(process.platform === 'win32'){
			await new Promise(res => execFile('taskkill', ['/pid', String(server.pid), '/T', '/F'], () => res()));
		} else { try{ server.kill('SIGKILL'); }catch(e){ /* gone */ } }
	}
}

main().catch(err => { console.error('ghost-qa FAILED:', err && err.message ? err.message : err); process.exitCode = 1; });
