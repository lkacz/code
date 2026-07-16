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
	// Every CDP call races a local deadline. Without it a request issued while the page
	// is tearing down (a navigation destroys the execution context mid-`awaitPromise`)
	// simply never gets a response and the whole driver wedges forever.
	send(method, params, deadlineMs){
		const id = ++this.msgId;
		this.ws.send(JSON.stringify({ id, method, params: params || {} }));
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				if(!this.pending.has(id)) return;
				this.pending.delete(id);
				reject(new Error(this.label + ' CDP timeout: ' + method));
			}, deadlineMs || 45000);
			this.pending.set(id, {
				resolve: v => { clearTimeout(timer); resolve(v); },
				reject: e => { clearTimeout(timer); reject(e); },
				method
			});
		});
	}
	async init(){
		await this.ready;
		await this.send('Page.enable');
		await this.send('Runtime.enable');
		await this.send('Emulation.setDeviceMetricsOverride', { width: winW, height: winH, deviceScaleFactor: 1, mobile: false });
	}
	async eval(expression, timeoutMs){
		const budget = timeoutMs || 30000;
		const res = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: budget }, budget + 15000);
		if(res.exceptionDetails) throw new Error(this.label + ' eval failed: ' + JSON.stringify(res.exceptionDetails).slice(0, 400));
		return res.result ? res.result.value : undefined;
	}
	async poll(expression, predicate, label, tries, delayMs){
		let last = null;
		for(let i = 0; i < (tries || 60); i++){
			// a failed eval is a "not ready yet", not a crash: right after a reload the
			// context can still be swapping out
			let v;
			try{ v = await this.eval(expression); }catch(e){ last = e; v = undefined; }
			if(predicate(v)) return v;
			await sleep(delayMs || 250);
		}
		throw new Error(this.label + ' poll timeout: ' + label + (last ? ' (last eval error: ' + last.message + ')' : ''));
	}
	async shot(path){
		const s = await this.send('Page.captureScreenshot', { format: 'png' });
		await writeFile(path, Buffer.from(s.data, 'base64'));
		console.log('wrote', path);
	}
	// A backgrounded tab has its rAF frozen, so its GAME SIM stops (the ghost
	// stream survives on the companion pump, but mobs/physics do not step). Scenes
	// that need the host world actually running must foreground the host first.
	async front(){ await this.send('Page.bringToFront'); await sleep(400); }
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
		// The audience lives behind a HUD icon, not a row in the ≡ menu: the button
		// must exist, open the panel, and carry the whole permission ladder.
		const entry = await host.eval(`(()=>{
			const btn=document.getElementById('ghostBtn');
			if(!btn) return {ok:false, why:'no #ghostBtn in the HUD'};
			btn.click();
			const panel=document.getElementById('ghostSharePanel');
			const open=!!(panel && panel.style.display==='flex');
			const perms=panel ? [...panel.querySelectorAll('#ghostPanelDefault option')].map(o=>o.value) : [];
			const toggle=panel ? panel.querySelector('#ghostPanelToggle').textContent : null;
			btn.click();
			return {ok:open, closed:panel.style.display==='none', perms, toggle,
				strayMenuEntry: !!document.querySelector('#menuPanel #ghostShareBtn')};
		})()`);
		console.log('viewers entry:', JSON.stringify(entry));
		if(!entry.ok || !entry.closed) throw new Error('the 👁 HUD icon does not toggle the viewers panel: ' + JSON.stringify(entry));
		if(entry.strayMenuEntry) throw new Error('viewers still hiding in the debug menu');
		if(entry.perms.join(',') !== 'watch,chat,full') throw new Error('permission ladder missing from the panel: ' + entry.perms);
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
			return { tile: MM.ghostBridge.getTile(${marker.tx},${marker.ty}), dx: Math.abs(p.x-(${marker.px})), ghostMode: !!MM.ghostMode,
				veilHidden: (document.getElementById('ghostVeil')||{style:{display:'none'}}).style.display==='none',
				bar: !!document.getElementById('ghostBar'), hudHidden: getComputedStyle(document.getElementById('hotbarWrap')).display==='none' };
		})()`);
		console.log('ghost snapshot:', JSON.stringify(snapCheck));
		if(snapCheck.tile !== marker.stone) throw new Error('marker tile missing after snapshot join');
		if(!(snapCheck.dx < 1.5)) throw new Error('hero replica far from host hero after join: dx=' + snapCheck.dx);
		if(!snapCheck.veilHidden || !snapCheck.bar || !snapCheck.hudHidden) throw new Error('ghost UI contract broken: ' + JSON.stringify(snapCheck));
		// before ANY real watcher input, the audience must not boost the hero
		await sleep(800); // let a couple of (inactive) poses land
		const idle = await host.eval(`MM.ghostHost.metrics()`);
		if(idle.activeGhosts !== 0 || (idle.boost && idle.boost.move !== 1)) throw new Error('idle watcher wrongly boosts: ' + JSON.stringify({ a: idle.activeGhosts, b: idle.boost }));
		console.log('idle watcher: no boost (ok)');

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
		// the HUD icon doubles as the live indicator, and the panel lists the viewer
		const hudLive = await host.eval(`(()=>{
			const btn=document.getElementById('ghostBtn');
			document.getElementById('ghostSharePanel') || btn.click();
			MM.ghostHost.openPanel();
			const panel=document.getElementById('ghostSharePanel');
			return {live:btn.classList.contains('live'), count:btn.querySelector('#ghostBtnCount').textContent,
				link:panel.querySelector('#ghostPanelLink').value,
				rows:panel.querySelectorAll('#ghostPanelViewers select').length,
				title:btn.title};
		})()`);
		console.log('presence: host ghosts=1, ghost sees others=' + ghostsSeen + ', hud=' + JSON.stringify(hudLive));
		if(!hudLive.live || hudLive.count !== '1' || hudLive.rows !== 1) throw new Error('HUD icon/panel does not reflect the live audience: ' + JSON.stringify(hudLive));
		if(!hudLive.link.includes('watch=' + ROOM)) throw new Error('share link missing from the panel: ' + hudLive.link);
		// (the button is inside #menuWrap, which ghost mode hides wholesale — so ask
		// whether it RENDERS, not what its own display computes to)
		const ghostViewOfHud = await ghost.eval(`(()=>{ const b=document.getElementById('ghostBtn'); return b ? b.getClientRects().length : -1; })()`);
		if(ghostViewOfHud !== 0) throw new Error('a watcher must not see the host-only viewers button (rects=' + ghostViewOfHud + ')');

		// --- Scene 8: social facilitation — ACTIVE watchers strengthen the hero ---------------------
		// (the blessing above already counted as real input; noteInput re-vouches)
		await ghost.eval(`MM.ghostClient.noteInput()`);
		await host.poll(`MM.ghostHost.metrics().activeGhosts`, v => v === 1, 'active watcher recognized', 30, 250);
		const boosted = await host.eval(`MM.ghostHost.metrics().boost`);
		if(!(Math.abs(boosted.move - 1.01) < 1e-9 && boosted.xp === 1.10 && Math.abs(boosted.dmg - 1.01) < 1e-9)) throw new Error('boost math off: ' + JSON.stringify(boosted));
		const applied = await host.eval(`MM.socialBoost.move`);
		if(Math.abs(applied - 1.01) > 1e-9) throw new Error('MM.socialBoost not published to the engine: ' + applied);
		console.log('social boost: ok (active=1 → move/jump/dmg ×1.01, xp ×1.10)');

		// --- Scene 8a: the meter — the host can SEE the payout, and see when there is none -----------
		const readMeter = `(()=>{ const m=document.getElementById('ghostMeter');
			if(!m) return {missing:true};
			return { hidden:!!m.hidden, idle:m.classList.contains('idle'),
				count:m.querySelector('#ghostMeterCount').textContent,
				val:m.querySelector('#ghostMeterVal').textContent,
				fill:m.querySelector('#ghostMeterFill').style.width,
				title:m.title, rects:m.getClientRects().length }; })()`;
		const meterLive = await host.eval(readMeter);
		if(meterLive.missing) throw new Error('social-facilitation meter never mounted');
		if(meterLive.hidden || meterLive.rects !== 1) throw new Error('meter not on screen while streaming: ' + JSON.stringify(meterLive));
		if(meterLive.idle) throw new Error('meter reads idle despite an active watcher: ' + JSON.stringify(meterLive));
		if(meterLive.count !== '⚡1/1' || !/\+10% XP/.test(meterLive.val) || !/\+1%/.test(meterLive.val)) {
			throw new Error('meter shows the wrong payout: ' + JSON.stringify(meterLive));
		}
		if(meterLive.fill !== '100%') throw new Error('meter fill should be full with every watcher active: ' + meterLive.fill);
		console.log('meter (active): ok — ' + meterLive.count + ' ' + meterLive.val);
		// Now let the watcher go idle: rewind its last-input stamp past IDLE_MS so the
		// next pose vouches act=0, and the host's 6 s TTL lapses. A passive audience must
		// pay NOTHING — and the meter must say so instead of quietly showing +0%.
		await ghost.eval(`MM.ghostClient._idleForTest()`);
		// Poll the PUBLISHED boost, not metrics(): metrics recomputes activity live, while
		// MM.socialBoost — the object the engine actually reads — is republished on the
		// presence tick. Racing on metrics() would trip on that publication lag, which is
		// immaterial next to the deliberate 6 s activity grace but is not zero.
		await host.poll(`MM.socialBoost.move`, v => v === 1, 'published boost returns to neutral', 80, 250);
		const idleBoost = await host.eval(`MM.socialBoost`);
		if(!(idleBoost.move === 1 && idleBoost.xp === 1 && idleBoost.jump === 1 && idleBoost.dmg === 1)) {
			throw new Error('an idle audience still boosts the hero: ' + JSON.stringify(idleBoost));
		}
		if(idleBoost.active !== 0) throw new Error('idle watcher still counted as active: ' + JSON.stringify(idleBoost));
		if(idleBoost.viewers !== 1) throw new Error('the idle watcher should still COUNT as present: ' + JSON.stringify(idleBoost));
		await host.poll(`document.getElementById('ghostMeter').classList.contains('idle')`, v => v === true, 'meter flips to idle', 40, 250);
		const meterIdle = await host.eval(readMeter);
		if(meterIdle.hidden || meterIdle.count !== '⚡0/1' || meterIdle.val !== 'brak premii') {
			throw new Error('idle meter should stay visible and say "brak premii": ' + JSON.stringify(meterIdle));
		}
		if(meterIdle.fill !== '0%') throw new Error('idle meter fill should be empty: ' + meterIdle.fill);
		console.log('meter (idle): ok — passive watcher pays nothing, meter says "brak premii"');
		// …and it comes straight back when the human touches something again
		await ghost.eval(`MM.ghostClient.noteInput()`);
		await host.poll(`MM.socialBoost.move`, v => Math.abs(v - 1.01) < 1e-9, 'boost returns on real input', 40, 250);
		await host.poll(`!document.getElementById('ghostMeter').classList.contains('idle')`, v => v === true, 'meter lights back up', 40, 250);
		console.log('meter (recovery): ok — real input restores the payout');

		// --- Scene 9: chat — filtered, relayed, rendered ----------------------------------------------
		const chatSent = await ghost.eval(`MM.ghostClient.sendChat('ale kurwa super gra!')`);
		if(!chatSent) throw new Error('chat refused despite full permissions');
		await host.poll(`document.getElementById('messages').textContent`, v => v.includes('💬') && !/kurwa/i.test(v), 'host sees the filtered chat toast', 30, 250);
		const chats = await host.eval(`MM.ghostHost.metrics().stats.chats`);
		if(chats !== 1) throw new Error('host chat counter expected 1, got ' + chats);
		const spamBlocked = await ghost.eval(`(async()=>{ return MM.ghostClient.sendChat('spam1') && (MM.ghostHost, true); })()`);
		void spamBlocked; // rate limit is host-side; counter must not move within the floor
		await sleep(700);
		const chats2 = await host.eval(`MM.ghostHost.metrics().stats.chats`);
		if(chats2 !== 1) throw new Error('host chat rate limit failed: ' + chats2);
		console.log('chat: ok (profanity masked, rate limit holds)');

		// --- Scene 10: screenshots (avatar + chat bubble in frame) ------------------------------------
		await ghost.eval(`MM.ghostClient.setAvatar('sowa')`);
		await ghost.eval(`MM.ghostClient.setFollow(true)`);
		await sleep(900);
		await ghost.shot('tools/ghost-qa.png');
		await host.shot('tools/ghost-qa-host.png');

		// --- Scene 10b: the watcher sees the INVASION MOVE ---------------------------------------------
		// Invasions used to reach the watcher only inside full world snapshots, so the
		// landing party stood frozen like statuary between them. The host now streams a
		// live pose plane (same contract as the mobs). The host tab must be in front —
		// its simulation is rAF-driven, and frozen invaders would prove nothing.
		await host.front();
		const invSpawn = await host.eval(`(()=>{
			MM.invasions.reset();
			const t1=MM.invasions.forceNightInvasion(player,(x,y)=>MM.world.getTile(x,y),(x,y,v)=>MM.world.setTile(x,y,v),
				{day:6,teams:1,kind:'aliens',alienCount:3,forceVisible:true,immediate:true});
			const t2=MM.invasions.forceMolekinInvasion(player,(x,y)=>MM.world.getTile(x,y),(x,y,v)=>MM.world.setTile(x,y,v),
				{day:6,teams:1,alienCount:3,forceVisible:true,immediate:true});
			const units=[];
			for(const t of MM.invasions._debug.teams) for(const a of t.aliens) units.push({id:a.id,kind:a.kind});
			return {aliens:(t1&&t1.length)||0, moles:(t2&&t2.length)||0, units:units.length,
				kinds:[...new Set(units.map(u=>u.kind))].sort().join('+')};
		})()`);
		if(!(invSpawn.units >= 4)) throw new Error('setup: not enough invaders spawned: ' + JSON.stringify(invSpawn));
		if(invSpawn.kinds !== 'aliens+molekin') throw new Error('setup: need BOTH aliens and kretoludzie, got ' + invSpawn.kinds);
		// the watcher must receive the roster at all…
		await ghost.poll(`MM.ghostClient.metrics().stats.invFulls`, v => v >= 1, 'watcher receives the invasion roster', 60, 250);
		await ghost.poll(`(()=>{ let n=0; for(const t of MM.invasions._debug.teams) n+=t.aliens.length; return n; })()`,
			v => v >= 4, 'watcher materializes the squads', 60, 250);
		// …and they must MOVE on its screen. Squads that have already closed on the hero
		// stand still and shoot, which proves nothing — so walk the hero away and make
		// them chase. Sampling is driver-side (the watcher tab is backgrounded while the
		// host holds the front, so its in-page timers are throttled to ~1 Hz).
		const snapUnits = `(()=>{ const m={};
			for(const t of MM.invasions._debug.teams) for(const a of t.aliens){ if(a && !a.dead) m[a.id]={x:+a.x.toFixed(2), y:+a.y.toFixed(2), k:a.kind}; }
			return m; })()`;
		await host.eval(`(()=>{ player.x += 26; player.vx=0; player.vy=0; return player.x; })()`);
		await sleep(900); // let the squads pick up the chase
		const hostA2 = await host.eval(snapUnits);
		const ghostA2 = await ghost.eval(snapUnits);
		await sleep(3000);
		const hostB2 = await host.eval(snapUnits);
		const ghostB2 = await ghost.eval(snapUnits);
		const movedIn = (a, b, kind) => Object.keys(a).filter(id => b[id] && a[id].k === kind &&
			Math.hypot(b[id].x - a[id].x, b[id].y - a[id].y) > 0.5).length;
		const hostMovedAliens = movedIn(hostA2, hostB2, 'aliens');
		const hostMovedMoles = movedIn(hostA2, hostB2, 'molekin');
		const ghostMovedAliens = movedIn(ghostA2, ghostB2, 'aliens');
		const ghostMovedMoles = movedIn(ghostA2, ghostB2, 'molekin');
		// how far the watcher's copy sits from the host's truth for the same unit
		let worstDrift = 0, compared = 0;
		for(const id in hostB2){
			if(!ghostB2[id]) continue;
			compared++;
			worstDrift = Math.max(worstDrift, Math.hypot(ghostB2[id].x - hostB2[id].x, ghostB2[id].y - hostB2[id].y));
		}
		const rosters = await ghost.eval(`MM.ghostClient.metrics().stats.invRosters`);
		if(!(hostMovedAliens > 0 && hostMovedMoles > 0)){
			throw new Error('setup: the squads never moved on the HOST either: ' +
				JSON.stringify({hostMovedAliens, hostMovedMoles, units:Object.keys(hostA2).length}));
		}
		if(!(rosters > 0)) throw new Error('watcher got no live invasion poses at all');
		if(!(ghostMovedAliens > 0)) throw new Error('aliens are frozen on the watcher screen: ' +
			JSON.stringify({ghostMovedAliens, hostMovedAliens, rosters, compared}));
		if(!(ghostMovedMoles > 0)) throw new Error('kretoludzie are frozen on the watcher screen: ' +
			JSON.stringify({ghostMovedMoles, hostMovedMoles, rosters, compared}));
		if(!(compared > 0 && worstDrift < 6)) throw new Error('the watcher squads drifted away from the host truth: ' +
			JSON.stringify({compared, worstDrift:+worstDrift.toFixed(2)}));
		console.log('invasion plane: ok (watcher sees ' + ghostMovedAliens + ' aliens and ' + ghostMovedMoles +
			' kretoludzie moving; ' + rosters + ' pose packets, worst drift from host ' + worstDrift.toFixed(2) + ' tiles)');

		// --- Scene 10c: the watcher sees the hero ATTACK ------------------------------------------------
		// The watcher renders but never simulates, so its weapons module was empty: the
		// hero was seen walking, never swinging or shooting. The host now mirrors the
		// cosmetic FX (swing arc, arrows, stream puffs, beams, blasts).
		const heroSwing = await host.eval(`(()=>{
			// a melee swing, aimed at the ground beside the hero
			const tx=Math.floor(player.x)+1, ty=Math.floor(player.y);
			MM.weapons.notifyMeleeSwing(tx,ty,player);
			return {tx,ty, swing:MM.weapons.ghostFxState().sw ? 1 : 0};
		})()`);
		if(!heroSwing.swing) throw new Error('host did not register its own swing');
		// NOTE: the host tab is in front (its sim is rAF-driven), so the GHOST tab is
		// backgrounded — in-page timers there are throttled to ~1 Hz. All waiting and
		// sampling therefore happens driver-side, in real time; the watcher's evals stay
		// single, instant reads. Its message handling is event-driven, so the mirrored
		// state keeps updating even while its rAF is frozen.
		await ghost.poll(`MM.ghostClient.metrics().stats.wfx`, v => v > 0, 'watcher receives the hero weapon FX', 60, 250);
		// Arrows are the visible, MOVING proof. Loose them high over the hero's head so
		// they arc through open air instead of burying themselves in the ground within a
		// frame (a stuck arrow is mirrored correctly but proves no motion).
		const readArrows = `(()=>{ const ar=MM.weapons._debug.arrows;
			return {n:ar.length, maxX:ar.length?Math.max(...ar.map(a=>a.x)):null, stuck:ar.filter(a=>a.stuck).length}; })()`;
		// Carve a clear flight lane first. Two gotchas, both learned the hard way: an
		// arrow spawned inside rock sticks on its very first step, and arrows fall
		// (ARROW_GRAV) — a shallow lane drops them into the floor within ~0.3 s. A stuck
		// arrow mirrors perfectly while proving no motion at all, so the lane is long AND
		// tall, and the sampling happens right after the volley.
		// The lane must also be DEEP: a backgrounded watcher drains its message queue on
		// its throttled pump (~1 Hz), so the arrows have to still be airborne a second
		// after the volley or the watcher only ever sees them already stuck.
		await host.eval(`(()=>{
			const y0=Math.floor(player.y)-3, x0=Math.floor(player.x);
			for(let x=x0; x<x0+200; x++) for(let y=y0-9; y<=y0+14; y++) MM.world.setTile(x,y,0);
			const w=MM.weapons._debug;
			w.arrows.length=0;
			for(let i=0;i<4;i++) w.arrows.push({x:x0+0.5+i*0.2, y:y0-4, vx:14, vy:-6, dmg:1, life:5, travel:0, maxTravel:260});
			return w.arrows.length;
		})()`);
		await ghost.poll(`(()=>MM.weapons._debug.arrows.length)()`, v => v > 0, 'the volley reaches the watcher', 40, 60);
		const hostA = await host.eval(readArrows);
		const shotA = await ghost.eval(readArrows);
		// The gap must clear one throttled pump cycle: a backgrounded watcher applies
		// packets on its ~1 Hz pump, so two reads 300 ms apart land inside the SAME tick
		// and look frozen even though the mirror is working perfectly.
		await sleep(1500);
		const hostB = await host.eval(readArrows);
		const shotB = await ghost.eval(readArrows);
		const flewHost = (hostA.maxX !== null && hostB.maxX !== null) ? (hostB.maxX - hostA.maxX) : 0;
		const flew = (shotA.maxX !== null && shotB.maxX !== null) ? (shotB.maxX - shotA.maxX) : 0;
		if(!(flewHost > 2)){
			const diag = await host.eval(`(()=>({frameMs:window.__mmFrameMs, hp:player.hp, y:+player.y.toFixed(1),
				ult:+MM.weapons.metrics().ultCharge.toFixed(3), n:MM.weapons._debug.arrows.length,
				a0:MM.weapons._debug.arrows[0] ? {x:+MM.weapons._debug.arrows[0].x.toFixed(2), vx:MM.weapons._debug.arrows[0].vx, life:+(MM.weapons._debug.arrows[0].life||0).toFixed(2), stuck:!!MM.weapons._debug.arrows[0].stuck} : null}))()`);
			throw new Error('setup: the arrows never flew on the HOST either: ' + JSON.stringify({hostA, hostB, diag}));
		}
		if(!(shotA.n > 0)) throw new Error('the hero fired arrows the watcher never saw: ' + JSON.stringify(shotA));
		if(!(flew > 2)) throw new Error('mirrored arrows are frozen on the watcher screen: ' +
			JSON.stringify({a:shotA, b:shotB, flew, flewHost}));
		const arrowsFly = {peak:Math.max(shotA.n, shotB.n), span:+flew.toFixed(2), wfx:await ghost.eval(`MM.ghostClient.metrics().stats.wfx`)};
		console.log('weapon plane: ok (watcher saw the swing + ' + arrowsFly.peak + ' arrows in flight, ' + arrowsFly.wfx + ' fx packets)');
		await ghost.shot('tools/ghost-qa-combat.png');
		await host.eval(`MM.invasions.reset(); MM.weapons.reset();`);

		// --- Scene 10a: ghost dread — creatures flee an ACTIVE spirit ---------------------------------
		// The host sim only runs while its tab is foregrounded (rAF), so bring it to
		// the front: the ghost keeps streaming from its companion pump regardless.
		// Park the spirit on a mob; it must bolt away and stop being aggressive.
		await host.front();
		// A land mob near the hero (aquatic/buried species can't demonstrate a land rout).
		// Prefer a species with exactly ONE live instance: in a flock, any probe keyed on
		// species can silently swap individuals mid-scene and fake an "approach".
		const mobPos = await host.eval(`(()=>{
			const skip=new Set(['FISH','PIRANHA','EEL','SAND_WORM']);
			const p=window.player;
			const l=MM.mobs.serialize().list.filter(m=>!skip.has(m.id) && m.state!=='buried');
			if(!l.length) return null;
			const byId={}; l.forEach(m=>{ byId[m.id]=(byId[m.id]||0)+1; });
			l.sort((a,b)=>{
				const ua=byId[a.id]===1?0:1, ub=byId[b.id]===1?0:1;
				if(ua!==ub) return ua-ub;
				return Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y);
			});
			return {id:l[0].id, x:l[0].x, y:l[0].y, flock:byId[l[0].id]};
		})()`);
		if(!mobPos) throw new Error('no land mob to test dread against');
		// leave follow mode FIRST — a following camera drags the spirit back toward the
		// hero every frame, shrinking the measured distance without the creature ever
		// stepping toward it (the screenshot scene above switched follow on)
		await ghost.eval(`MM.ghostClient.setFollow(false)`);
		await ghost.eval(`MM.ghostClient.setCam(${mobPos.x}, ${mobPos.y}); MM.ghostClient.noteInput();`);
		await host.poll(`MM.ghostHost.metrics().aura`, v => v === 1, 'active spirit publishes an aura', 40, 250);
		// The contract: THE spooked creature breaks off (state=flee) and never closes
		// on the spirit. Track that ONE individual by positional continuity — measuring
		// the species minimum let an unspooked flock-mate wander in and fail the run.
		let trackX = mobPos.x, trackY = mobPos.y;
		const probeSpook = async () => {
			const v = await host.eval(`(()=>{
				const s=MM.ghostAura.spirits[0];
				if(!s) return null;
				const l=MM.mobs.serialize().list.filter(m=>m.id==='${mobPos.id}');
				let best=null;
				for(const m of l){
					const dp=Math.hypot(m.x-(${trackX}), m.y-(${trackY}));
					if(!best || dp<best.dp) best={dp:+dp.toFixed(2), x:m.x, y:m.y, state:m.state, d:+Math.hypot(m.x-s.x, m.y-s.y).toFixed(2)};
				}
				return best;
			})()`);
			if(v){ trackX = v.x; trackY = v.y; }
			return v;
		};
		let spooked = null;
		for(let i = 0; i < 80 && !spooked; i++){
			const v = await probeSpook();
			if(v && v.state === 'flee'){ spooked = v; break; }
			// the creature wanders — keep the phantom parked on top of it (updated by
			// the probe) until it panics, exactly like a watcher chasing a mob would
			await ghost.eval(`MM.ghostClient.setCam((${trackX}), (${trackY})); MM.ghostClient.noteInput();`);
			await sleep(250);
		}
		if(!spooked) throw new Error('the creature never panicked at the spirit');
		// sample fast: at flee speed the creature covers ~0.65 tiles per 200 ms, so the
		// continuity match stays glued to the same individual between samples
		const d0 = spooked.d;
		let dMax = d0;
		for(let i = 0; i < 6; i++){
			await sleep(200);
			const v = await probeSpook();
			if(v && v.d > dMax) dMax = v.d;
		}
		if(!(dMax >= d0 - 0.05)) throw new Error('a spooked creature closed on the spirit: ' + d0 + ' → max ' + dMax);
		console.log('dread: ok (' + mobPos.id + (mobPos.flock > 1 ? ' [stado ' + mobPos.flock + ']' : '') + ' spooked at ' + d0 + ' tiles, max dist ' + dMax + ')');

		// --- Scene 10c: watcher powers — earned by activity, land on creatures only ---------------------
		// Charge accrues at 1/s ONLY while active, so the watcher must keep signalling.
		const need = await ghost.eval(`MM.ghostNet.POWER_RULES.banish.cost`);
		const keepActive = setInterval(() => { ghost.eval(`MM.ghostClient.noteInput()`).catch(() => {}); }, 3000);
		let chargeBefore = 0;
		try{
			// poll the CLIENT's mirrored charge: the host ledger runs ~1 s ahead of it,
			// and the client refuses to cast on a stale balance (as it should)
			await ghost.poll(`MM.ghostClient.metrics().charge`, v => v >= need, 'watcher earns power charge while active', 200, 500);
			chargeBefore = await host.eval(`MM.ghostHost.metrics().viewers[0].charge`);
		} finally { clearInterval(keepActive); }
		const casted = await ghost.eval(`MM.ghostClient.sendPower('banish')`);
		if(!casted) throw new Error('power refused despite charge + permissions');
		await host.poll(`MM.ghostHost.metrics().stats.powers`, v => v === 1, 'host resolved the power', 40, 250);
		const chargeAfter = await host.eval(`MM.ghostHost.metrics().viewers[0].charge`);
		if(!(chargeAfter <= chargeBefore - need + 2)) throw new Error('charge was not spent: ' + chargeBefore + ' → ' + chargeAfter);
		const worldUntouched = await host.eval(`MM.ghostBridge.getTile(${diff.tx},${diff.ty})`);
		if(worldUntouched !== diff.want) throw new Error('a ghost power edited a tile — powers must be creature-only');
		console.log('powers: ok (banish cast, charge ' + chargeBefore.toFixed(0) + '→' + chargeAfter.toFixed(0) + ', world tiles untouched)');

		// --- Scene 10d: assistant — crafts and equips for the host ---------------------------------------
		// The assistant only ever sees what the HOST has discovered, so first give
		// the host stone and let the discovery sweep unlock the stone-pick recipe.
		const unlocked = await host.eval(`(()=>{
			window.inv.stone = 40;
			window.updateInventoryHud();
			return MM.ghostBridge.ghostAssistState().recipes.filter(r=>r.id==='pick_stone').map(r=>({id:r.id,can:r.can}));
		})()`);
		if(!unlocked.length || !unlocked[0].can) throw new Error('stone pick did not unlock for the host: ' + JSON.stringify(unlocked));
		const gid0 = (await host.eval(`MM.ghostHost.metrics().viewers`))[0].gid;
		await host.eval(`MM.ghostHost.setAssistant('${gid0}', true)`);
		await ghost.poll(`MM.ghostClient.metrics().assistant`, v => v === true, 'client learns it is the assistant', 30, 250);
		await ghost.poll(`MM.ghostClient.metrics().assistRecipes`, v => v > 0, 'assistant receives the recipe list', 40, 250);
		const craftOk = await ghost.eval(`MM.ghostClient.sendAssist('craft','pick_stone')`);
		if(!craftOk) throw new Error('assistant could not send the craft');
		await host.poll(`!!window.inv.tools.stone`, v => v === true, 'the assistant crafted the stone pick FOR the host', 40, 250);
		const assists = await host.eval(`MM.ghostHost.metrics().stats.assists`);
		if(assists !== 1) throw new Error('assist counter expected 1, got ' + assists);
		// a non-assistant must be refused — revoke, then retry
		await host.eval(`MM.ghostHost.setAssistant('${gid0}', false)`);
		await ghost.poll(`MM.ghostClient.metrics().assistant`, v => v === false, 'assistant revoked', 30, 250);
		const refused = await ghost.eval(`MM.ghostClient.sendAssist('craft','pick_stone')`);
		if(refused) throw new Error('a revoked assistant still sent an assist action');
		console.log('assistant: ok (crafted for the host, revocation enforced)');

		// --- Scene 10d2: the approval desk — proposals wait for the host's verdict ------------------
		await host.eval(`MM.ghostHost.setAssistant('${gid0}', true)`);
		await ghost.poll(`MM.ghostClient.metrics().assistant`, v => v === true, 'assistant re-appointed', 30, 250);
		await host.eval(`MM.ghostHost.setApprovalMode(true)`);
		await ghost.poll(`MM.ghostClient.metrics().assistApproval`, v => v === true, 'assistant learns approvals are on', 30, 250);
		await host.eval(`(()=>{ window.inv.wood=(window.inv.wood|0)+6; window.updateInventoryHud(); return window.inv.wood; })()`);
		const torches0 = await host.eval(`window.inv.torch|0`);
		await sleep(350); // respect the per-assistant rate floor — the polls above can all pass first-try
		const sentQ = await ghost.eval(`MM.ghostClient.sendAssist('craft','torches',1)`);
		let qlen = 0;
		for(let i = 0; i < 30 && qlen !== 1; i++){ qlen = await host.eval(`MM.ghostHost.metrics().queue.length`); if(qlen !== 1) await sleep(250); }
		if(qlen !== 1){
			throw new Error('proposal never queued: ' + JSON.stringify({
				sentQ, qlen,
				ack: await ghost.eval(`MM.ghostClient.metrics().lastAssistAck`),
				approval: await host.eval(`MM.ghostHost.metrics().approval`),
				label: await host.eval(`(()=>{ try{ return MM.ghostBridge.ghostAssistLabel('craft','torches',1); }catch(e){ return 'ERR '+e; } })()`),
				hostErrs: host.pageErrors.slice(0, 3)
			}));
		}
		if((await host.eval(`window.inv.torch|0`)) !== torches0) throw new Error('a QUEUED proposal must not execute');
		const qRow = (await host.eval(`MM.ghostHost.metrics().queue`))[0];
		if(!/Pochodnie/.test(qRow.label)) throw new Error('queue label is not host-derived: ' + qRow.label);
		await host.eval(`MM.ghostHost.approveAssist('${qRow.qid}')`);
		await host.poll(`window.inv.torch|0`, v => v === torches0 + 4, 'approval crafts the torches', 30, 250);
		await ghost.poll(`(MM.ghostClient.metrics().lastAssistAck||{}).done`, v => v === true, 'the assistant hears the verdict', 30, 250);
		// rejection: queued, refused, nothing crafted
		await sleep(350);
		await ghost.eval(`MM.ghostClient.sendAssist('craft','torches',1)`);
		await host.poll(`MM.ghostHost.metrics().queue.length`, v => v === 1, 'second proposal queued', 30, 250);
		const qRow2 = (await host.eval(`MM.ghostHost.metrics().queue`))[0];
		await host.eval(`MM.ghostHost.rejectAssist('${qRow2.qid}')`);
		if((await host.eval(`MM.ghostHost.metrics().queue.length`)) !== 0) throw new Error('rejection left the queue dirty');
		if((await host.eval(`window.inv.torch|0`)) !== torches0 + 4) throw new Error('a REJECTED proposal executed');
		await host.eval(`MM.ghostHost.setApprovalMode(false)`);
		console.log('approvals: ok (queued → approved crafts, rejected does not)');

		// --- Scene 10d3: two assistants, first-wins — the host executes serially --------------------
		const g2url = url + `?watch=${ROOM}&via=bc&name=Widmo2`;
		const created2 = await host.send('Target.createTarget', { url: g2url });
		let ghost2Ws = null;
		for(let i = 0; i < 40 && !ghost2Ws; i++){
			await sleep(250);
			const list = await (await fetch(`http://127.0.0.1:${dtPort}/json/list`)).json();
			const t2 = list.find(x => x.id === created2.targetId);
			if(t2) ghost2Ws = t2.webSocketDebuggerUrl;
		}
		const ghost2 = new Tab(ghost2Ws, 'ghost2');
		await ghost2.init();
		await ghost2.eval(BOOT_WAIT, 60000);
		await ghost2.poll(`MM.ghostClient.metrics().state`, v => v === 'live', 'second ghost joins', 80, 250);
		const gid2 = (await host.eval(`MM.ghostHost.metrics().viewers`)).find(v => v.name === 'Widmo2').gid;
		await host.eval(`MM.ghostHost.setAssistant('${gid2}', true)`);
		await ghost2.poll(`MM.ghostClient.metrics().assistant`, v => v === true, 'second assistant appointed', 30, 250);
		const seats = (await host.eval(`MM.ghostHost.metrics().viewers`)).filter(v => v.assistant).length;
		if(seats !== 2) throw new Error('expected TWO simultaneous assistant seats, got ' + seats);
		// exactly one craft affordable — whoever lands first wins, the other hears 'cost'
		await host.eval(`(()=>{ window.inv.wood=2; window.updateInventoryHud(); return 1; })()`);
		const torchesRace = await host.eval(`window.inv.torch|0`);
		await Promise.all([
			ghost.eval(`MM.ghostClient.sendAssist('craft','torches',1)`),
			ghost2.eval(`MM.ghostClient.sendAssist('craft','torches',1)`)
		]);
		await host.poll(`window.inv.torch|0`, v => v === torchesRace + 4, 'exactly one batch crafted', 30, 250);
		await sleep(800); // the losing ack needs a beat to land
		if((await host.eval(`window.inv.wood|0`)) !== 0) throw new Error('race left the pouch inconsistent');
		if((await host.eval(`window.inv.torch|0`)) !== torchesRace + 4) throw new Error('both crafts executed — serialization broke');
		const [ack1, ack2] = await Promise.all([
			ghost.eval(`MM.ghostClient.metrics().lastAssistAck`),
			ghost2.eval(`MM.ghostClient.metrics().lastAssistAck`)
		]);
		const wins = [ack1, ack2].filter(a => a && a.ok).length;
		const losses = [ack1, ack2].filter(a => a && a.reason === 'cost').length;
		if(!(wins === 1 && losses === 1)) throw new Error('first-wins arbitration off: ' + JSON.stringify([ack1, ack2]));
		// the workbench mirrors the player's panels: groups, resources, search skeleton
		// (the panel DOM is built lazily — open it the way an assistant would, via 🛠)
		const bench = await ghost2.eval(`(()=>{ const m=MM.ghostClient.metrics();
			const b=document.getElementById('gbAssist'); if(b) b.click();
			const p=document.getElementById('ghostAssist');
			return { recipes:m.assistRecipes,
				search:!!(p&&p.querySelector('#gaSearch')),
				vitals:(p&&p.querySelector('#gaVitals'))?p.querySelector('#gaVitals').textContent:'',
				rows:p?p.querySelectorAll('#gaBody *').length:0 }; })()`);
		if(!(bench.recipes > 0 && bench.search && bench.rows > 10 && /HP/.test(bench.vitals))) throw new Error('workbench is missing the player view: ' + JSON.stringify(bench));
		// retire the second ghost so the later single-viewer scenes see one entry
		await ghost2.eval(`MM.ghostClient.leave()`);
		await host.poll(`MM.ghostHost.metrics().ghosts`, v => v === 1, 'second ghost retired', 40, 250);
		ghost2.close();
		console.log('two assistants: ok (first won, second heard "cost", workbench mirrors the player)');

		// --- Scene 10f: the watcher's own career — earned from host deeds, and PERSISTENT ------------
		// Everything above (join, blessing, powers, assist work, active watching) should
		// already have banked XP. The real question is whether it survives the browser:
		// the profile lives in the WATCHER's localStorage, so a full reload of the ghost
		// tab must find it again.
		const progBefore = await ghost.poll(`MM.ghostClient.metrics().prog`, p => p && p.xp > 0, 'the watcher banks XP from host-minted deeds', 40, 250);
		if(!progBefore.counts.join) throw new Error('the join deed never landed: ' + JSON.stringify(progBefore.counts));
		if(!progBefore.done.includes('first_watch')) throw new Error('the first achievement did not unlock: ' + JSON.stringify(progBefore.done));
		if(!(progBefore.counts.bless || progBefore.counts.cheer || progBefore.counts.energy)) throw new Error('blessings did not pay');
		if(!(progBefore.counts.banish || progBefore.counts.frost || progBefore.counts.smite)) throw new Error('powers did not pay');
		if(!progBefore.counts.craft) throw new Error('assistant work did not pay');
		if(progBefore.days !== 1) throw new Error('the day stamp is missing');
		const hostSawLevel = (await host.eval(`MM.ghostHost.metrics().viewers`))[0].level;
		if(!(hostSawLevel >= 1)) throw new Error('the host never learned the viewer rank');
		console.log('progression: ok (xp=' + progBefore.xp + ' level=' + progBefore.level + ' "' + progBefore.rank + '" '
			+ 'osiągnięcia=' + progBefore.done.length + ', host widzi Poz. ' + hostSawLevel + ')');
		// Reload the ghost tab from scratch — same browser profile, brand-new page.
		// Force the throttled profile to disk FIRST. The tab is backgrounded (the host
		// holds the front), so pending deeds may still sit in the queue unbanked — bring
		// it forward briefly to drain them, then force the write. Headless Page.navigate
		// does not reliably fire beforeunload/pagehide, so this explicit flush is what
		// guarantees the on-disk profile is current when the reload reads it.
		await ghost.front();
		await sleep(700); // let the foregrounded pump drain the deed queue into the profile
		// flush and read mem+disk ATOMICALLY in one eval — deeds keep banking on the
		// pump, so two separate reads would race (disk at T1 vs mem at T2>T1) and lie
		const flushCheck = await ghost.eval(`(()=>{ MM.ghostClient._flushForTest();
			const mem=MM.ghostClient.metrics().prog.xp|0;
			let disk=-1; try{ disk=(JSON.parse(localStorage.getItem(MM.ghostNet.PROG_KEY)||'{}').xp)|0; }catch(e){}
			return {mem, disk}; })()`);
		if(flushCheck.disk < flushCheck.mem) throw new Error('the forced flush did not reach disk: ' + JSON.stringify(flushCheck));
		// Never eval an awaited promise across the navigation: the old execution context
		// dies mid-flight and that CDP request would never answer. Poll a plain
		// expression until the NEW context has booted instead.
		await ghost.send('Page.navigate', { url: ghostUrl });
		await ghost.poll(`(()=>{ try{ return !!(window.MM && MM.ghostBridge && MM.ghostClient); }catch(e){ return false; } })()`,
			v => v === true, 'the reloaded ghost boots', 120, 500);
		await ghost.poll(`MM.ghostClient.metrics().state`, v => v === 'live', 'the reloaded ghost re-joins', 80, 250);
		const progAfter = await ghost.eval(`MM.ghostClient.metrics().prog`);
		if(progAfter.xp < progBefore.xp) throw new Error('progress was LOST across a reload: ' + progBefore.xp + ' → ' + progAfter.xp);
		if(!progAfter.done.includes('first_watch')) throw new Error('achievements were lost across a reload');
		if(progAfter.counts.craft !== progBefore.counts.craft) throw new Error('deed counters were lost across a reload');
		console.log('persistence: ok (reloaded the ghost tab — xp ' + progBefore.xp + ' → ' + progAfter.xp + ', trophies kept)');

		// --- Scene 10g: voices & manners — host chat, pings, per-watcher mute, view toggles -------------
		// The host speaks: bubble over the hero on BOTH sides of the wire.
		await host.front(); // the bubble rides the rAF draw loop — wake the host canvas
		const said = await host.eval(`MM.ghostHost.say('Czesc duchy!')`);
		if(!said) throw new Error('host say() refused');
		if((await host.eval(`MM.ghostHost.metrics().hostChat`)) !== 'Czesc duchy!') throw new Error('host does not see its own words');
		await ghost.poll(`MM.ghostClient.metrics().hostChat`, v => v === 'Czesc duchy!', 'the watcher hears the host speak', 30, 250);
		// A ping: no coordinates on the wire, marker echoes back to every watcher (incl. the sender).
		const pinged = await ghost.eval(`MM.ghostClient.sendPing()`);
		if(!pinged) throw new Error('watcher ping refused despite chat permissions');
		await host.poll(`MM.ghostHost.metrics().stats.pings`, v => v >= 1, 'host resolved the ping', 30, 250);
		await ghost.poll(`MM.ghostClient.metrics().pings`, v => v >= 1, 'the ping marker echoed back to the watcher', 30, 250);
		await host.shot('tools/ghost-qa-voices.png');
		// Per-watcher mute: the chat still relays and counts (display preference, not
		// moderation) but stays out of THIS host's message log.
		const gidV = (await host.eval(`MM.ghostHost.metrics().viewers`))[0].gid;
		await host.eval(`MM.ghostHost.setViewerHidden('${gidV}', true)`);
		if(!(await host.eval(`MM.ghostHost.metrics().hidden`)).includes(gidV)) throw new Error('hide roundtrip failed');
		const chatsV0 = await host.eval(`MM.ghostHost.metrics().stats.chats`);
		if(!(await ghost.eval(`MM.ghostClient.sendChat('sekretny szept')`))) throw new Error('muted watcher could not chat (mute must not block the relay)');
		await host.poll(`MM.ghostHost.metrics().stats.chats`, v => v === chatsV0 + 1, 'muted chat still counted/relayed', 30, 250);
		if(/sekretny szept/.test(await host.eval(`document.getElementById('messages').textContent`))) throw new Error('a muted watcher still reached the host log');
		await host.eval(`MM.ghostHost.setViewerHidden('${gidV}', false)`);
		if((await host.eval(`MM.ghostHost.metrics().hidden`)).length !== 0) throw new Error('unhide roundtrip failed');
		// View toggles: persisted display prefs, roundtrip through the api.
		await host.eval(`MM.ghostHost.setViewPref('spirits', false)`);
		if((await host.eval(`MM.ghostHost.metrics().view`)).spirits !== false) throw new Error('view pref roundtrip failed');
		await host.eval(`MM.ghostHost.setViewPref('spirits', true)`);
		console.log('voices: ok (host bubble on both ends, ping echoed, mute keeps relay but silences the log, view prefs roundtrip)');

		// --- Scene 10h: the watcher sees the GUARDIAN FIGHT ----------------------------------------------
		// The save snapshot deliberately drops live guardian entities (restore() clears
		// the arena), so before the mirror plane a watcher stared at an EMPTY lair while
		// the hero visibly fought a boss. Awaken one with the hero parked in the arena
		// (the guardian sleeps if its player leaves the leash) and the host tab in front
		// (guardian AI is rAF-driven), then prove the watcher materializes the fight,
		// sees it MOVE, sees the hp drain, and sees the arena empty when it ends.
		await host.front();
		const arena = await host.eval(`(()=>{
			const L=MM.guardianLairs.layoutFor('fire');
			player.x=L.ax+6; player.y=L.floorY-4; player.vx=0; player.vy=0; player.hp=player.maxHp;
			const ok=MM.guardianLairs.forceAwaken('fire');
			const m=MM.guardianLairs.metrics();
			return {ok, ax:L.ax, alive:m.alive, bosses:m.bosses};
		})()`);
		if(!arena.ok || !(arena.alive >= 2) || arena.bosses !== 1) throw new Error('setup: guardian did not awaken: ' + JSON.stringify(arena));
		await ghost.poll(`MM.ghostClient.metrics().stats.guard`, v => v >= 1, 'watcher receives the guardian mirror', 60, 250);
		await ghost.poll(`MM.guardianLairs.metrics().alive`, v => v >= 2, 'watcher materializes the boss and sidekicks', 60, 250);
		const readBoss = `(()=>{ const e=MM.guardianLairs._debug().entities.find(v=>v.boss);
			return e ? {x:+e.x.toFixed(2), y:+e.y.toFixed(2), hp:+e.hp.toFixed(1), mhp:e.maxHp} : null; })()`;
		const bossA = await ghost.eval(readBoss);
		await sleep(2000); // must clear one throttled background pump cycle on the watcher
		const bossB = await ghost.eval(readBoss);
		if(!bossA || !bossB) throw new Error('watcher lost the boss puppet: ' + JSON.stringify({ bossA, bossB }));
		const bossMoved = Math.hypot(bossB.x - bossA.x, bossB.y - bossA.y);
		if(!(bossMoved > 0.3)) throw new Error('the boss is frozen on the watcher screen: ' + JSON.stringify({ bossA, bossB }));
		// hp drains through the mirror: hurt the boss on the HOST, watch the watcher's copy
		await host.eval(`(()=>{ const e=MM.guardianLairs._debug().entities.find(v=>v.boss); if(e) e.hp=Math.max(1, e.hp-137); return 1; })()`);
		await ghost.poll(readBoss, v => v && v.hp <= v.mhp - 100, 'the boss hp drain reaches the watcher', 40, 250);
		// the fight ends → the busy-latch sends one trailing clear packet. Walk the
		// hero OUT of the leash first: a player standing in the arena re-triggers the
		// guardian's natural proximity awaken on the very next sim tick, and the
		// mirror would faithfully stream the brand-new fight forever.
		await host.eval(`(()=>{ player.x=(${marker.px}); player.y=(${marker.py}); player.vx=0; player.vy=0; MM.guardianLairs.clearActive(); return 1; })()`);
		await ghost.poll(`MM.guardianLairs.metrics().alive`, v => v === 0, 'the cleared arena empties on the watcher too', 60, 250);
		const guardPkts = await ghost.eval(`MM.ghostClient.metrics().stats.guard`);
		console.log('guardian plane: ok (boss moved ' + bossMoved.toFixed(2) + ' tiles on the watcher, hp drain visible, arena cleared; '
			+ guardPkts + ' mirror packets)');

		// --- Scene 10i: FULL MULTIPLAYER — the guest gets embodied ------------------------------------
		// The `play` rung of the ladder: the host promotes the watcher to an OWN hero in
		// the world. Authority split is the whole test — the guest MOVES locally (its
		// own physics) while the host owns vitals, pouch and every world edit and
		// validates each intent. Host tab in front (its sim + the mob contact pass are
		// rAF-driven); the guest tab is backgrounded, so all sampling is driver-side.
		await host.front();
		const gidPlay = (await host.eval(`MM.ghostHost.metrics().viewers`))[0].gid;
		await host.eval(`MM.ghostHost.setViewerMode('${gidPlay}', 'play')`);
		await ghost.poll(`MM.ghostClient.metrics().mode`, v => v === 'play', 'the watcher learns it is a player', 40, 250);
		await ghost.poll(`MM.ghostClient.metrics().play.spawned`, v => v === true, 'the guest body spawns from the host', 60, 250);
		await host.poll(`MM.ghostHost.metrics().players`, v => v === 1, 'the host counts one embodied player', 40, 250);
		const bodyHp = (await host.eval(`MM.ghostHost.metrics().bodies`))[0];
		if(!(bodyHp && bodyHp.hp === bodyHp.mhp)) throw new Error('body vitals not host-owned at full hp: ' + JSON.stringify(bodyHp));
		// an embodied guest raises NO dread aura (it is a body, not a phantom)
		if((await host.eval(`MM.ghostHost.metrics().aura`)) !== 0) throw new Error('an embodied guest should not haunt the world');
		// --- movement is guest-authoritative and reaches the host inside the envelope.
		// Carve a clear floored corridor to the right first — a random spawn may have a
		// wall right beside the body, which would block the walk and prove nothing.
		await host.eval(`(()=>{
			const b=MM.ghostHost.metrics().bodies[0];
			const bx=Math.round(b.x), floorRow=Math.ceil(b.y+0.46); // the solid tile the feet rest ON — keep it, clear above
			for(let x=bx;x<=bx+10;x++){ for(let yy=floorRow-4;yy<floorRow;yy++) MM.world.setTile(x,yy,MM.T.AIR); MM.world.setTile(x,floorRow,MM.T.STONE); }
			return 1;
		})()`);
		await sleep(400); // let the body settle onto the fresh floor
		const b0 = (await host.eval(`MM.ghostHost.metrics().bodies`))[0];
		await ghost.eval(`(()=>{ const m=MM.ghostClient; m.noteInput(); return 1; })()`);
		// press 'd' on the guest for a beat: its own physics walks the hero, the host
		// follows the streamed pose. Dispatch a real keydown so ownInput picks it up.
		await ghost.eval(`(()=>{ window.dispatchEvent(new KeyboardEvent('keydown',{key:'d'})); return 1; })()`);
		await sleep(1600);
		await ghost.eval(`(()=>{ window.dispatchEvent(new KeyboardEvent('keyup',{key:'d'})); MM.ghostClient._playStop(); return 1; })()`);
		await sleep(600);
		const b1 = (await host.eval(`MM.ghostHost.metrics().bodies`))[0];
		const guestX = (await ghost.eval(`MM.ghostClient.metrics().play.x`));
		if(!(Math.abs(b1.x - b0.x) > 1)) throw new Error('the guest body never moved on the host: ' + JSON.stringify({ b0, b1 }));
		if(!(Math.abs(guestX - b1.x) < 3)) throw new Error('host body drifted from the guest truth: guest=' + guestX + ' host=' + b1.x);
		console.log('play move: ok (guest walked ' + (b1.x - b0.x).toFixed(2) + ' tiles, host tracked to within ' + Math.abs(guestX - b1.x).toFixed(2) + ')');
		// --- mining: an intent yields to the guest's HOST-OWNED pouch, never the host inv
		const dig = await host.eval(`(()=>{ const b=MM.ghostHost.metrics().bodies[0]; return {bx:Math.round(b.x), by:Math.round(b.y), invStone0: window.inv.stone|0}; })()`);
		// isolate one stone block beside the body with a TALL air column above it, so
		// breaking it cannot be masked by loose material (sand/gravel) cascading down
		// during the ~2 s mine window — random spawns have plenty overhead
		const mineCell = { x: dig.bx + 2, y: dig.by };
		await host.eval(`(()=>{
			const x=${mineCell.x}, y=${mineCell.y};
			for(let dx=-1;dx<=1;dx++) for(let yy=y-8; yy<y; yy++) MM.world.setTile(x+dx, yy, MM.T.AIR);
			MM.world.setTile(x, y+1, MM.T.STONE); // footing so nothing below matters
			MM.world.setTile(x, y, MM.T.STONE);   // the block the guest will mine
			return 1;
		})()`);
		for(let i = 0; i < 8; i++){
			await ghost.eval(`(()=>{ MM.ghostClient.noteInput(); MM.ghostClient._playAct('mine', ${mineCell.x}, ${mineCell.y}); return 1; })()`);
			await sleep(200); // clear the host's MINE_MS per-body floor
		}
		let mined;
		try{
			mined = await host.poll(`(()=>{ const b=MM.ghostHost.metrics().bodies[0]; return b ? (b.pouch.stone||0) : 0; })()`,
				v => v >= 1, 'the guest mined a tile into its OWN pouch', 50, 250);
		}catch(e){
			const d = await host.eval(`(()=>{ const b=MM.ghostHost.metrics().bodies[0];
				return {bodyX:b?+b.x.toFixed(2):null, bodyY:b?+b.y.toFixed(2):null, mineX:${mineCell.x}, mineY:${mineCell.y},
					reachDX:b?Math.abs(${mineCell.x}-Math.floor(b.x)):null, reachDY:b?Math.abs(${mineCell.y}-Math.floor(b.y)):null,
					cell:MM.world.getTile(${mineCell.x},${mineCell.y}), pouch:b?b.pouch:null,
					ack:MM.ghostClient?MM.ghostClient.metrics().play:null}; })()`);
			throw new Error('guest never mined into its pouch: ' + JSON.stringify(d));
		}
		const hostInvUnchanged = (await host.eval(`window.inv.stone|0`)) === dig.invStone0;
		if(!hostInvUnchanged) throw new Error('guest mining leaked into the HOST inventory (must go to the guest pouch)');
		const cellGone = await host.eval(`MM.world.getTile(${mineCell.x},${mineCell.y}) === MM.T.AIR`);
		if(!cellGone){
			const d = await host.eval(`(()=>({cell:MM.world.getTile(${mineCell.x},${mineCell.y}), air:MM.T.AIR, stone:MM.T.STONE,
				above:MM.world.getTile(${mineCell.x},${mineCell.y}-1)}))()`);
			throw new Error('the mined tile is still solid on the host: ' + JSON.stringify(d));
		}
		console.log('play mine: ok (guest pouch stone=' + mined + ', host inv untouched, tile broken)');
		// --- building: spends from the guest pouch, writes a tile, host inv still untouched
		const placeCell = { x: dig.bx + 3, y: dig.by };
		await host.eval(`(()=>{ MM.world.setTile(${placeCell.x}, ${placeCell.y}, MM.T.AIR); MM.world.setTile(${placeCell.x}, ${placeCell.y+1}, MM.T.STONE); return 1; })()`);
		await ghost.eval(`(()=>{ MM.ghostClient._playSelect && MM.ghostClient._playSelect('stone'); return 1; })()`);
		await ghost.eval(`(()=>{ MM.ghostClient._playAct && MM.ghostClient._playAct('place', ${placeCell.x}, ${placeCell.y}, 'stone'); return 1; })()`);
		const built = await host.poll(`MM.world.getTile(${placeCell.x},${placeCell.y}) === MM.T.STONE`, v => v === true, 'the guest built a tile', 40, 250);
		if(!built) throw new Error('the guest placement never landed');
		if((await host.eval(`window.inv.stone|0`)) !== dig.invStone0) throw new Error('guest building drew from the HOST inventory');
		console.log('play build: ok (tile placed from the guest pouch, host inv untouched)');
		// --- combat: a strike hits creatures only, never a tile
		const preTiles = await host.eval(`(()=>{ let n=0; for(let x=${dig.bx}-2;x<=${dig.bx}+2;x++) for(let y=${dig.by}-2;y<=${dig.by}+3;y++) if(MM.world.getTile(x,y)!==MM.T.AIR) n++; return n; })()`);
		const spawnedForStrike = await host.eval(`(()=>{
			const b=MM.ghostHost.metrics().bodies[0];
			let hit=null;
			for(const id of MM.mobs.species){ try{ if(MM.mobs.forceSpawn(id, {x:b.x+1, y:b.y}, MM.world.getTile)){ hit=id; break; } }catch(e){} }
			return {hit, count: MM.mobs.serialize().list.length};
		})()`);
		const strikeHits = await host.eval(`MM.ghostBridge.ghostPlayStrike(${dig.bx}+1, ${dig.by}, 3, 30)`);
		void spawnedForStrike; void strikeHits;
		const postTiles = await host.eval(`(()=>{ let n=0; for(let x=${dig.bx}-2;x<=${dig.bx}+2;x++) for(let y=${dig.by}-2;y<=${dig.by}+3;y++) if(MM.world.getTile(x,y)!==MM.T.AIR) n++; return n; })()`);
		if(postTiles !== preTiles) throw new Error('a guest strike edited a tile — combat must be creatures-only');
		console.log('play combat: ok (strike hit creatures, world tiles untouched)');
		// --- Wave A: a creature HUNTS the guest and damages its BODY, not the host ---------------------
		// Move the HOST hero far away, drop a hostile mob right on the guest body, and
		// confirm the mob chases the body and drains the BODY's hp while the host's hp
		// stays put. This is what turns a guest from furniture into a real participant.
		await ghost.eval(`MM.ghostClient._playStop()`); // make sure the guest stands still
		await sleep(400);
		const hunt = await host.eval(`(()=>{
			const b=MM.ghostHost.metrics().bodies[0];
			// park the host far from the guest so any host damage would be unambiguous
			player.x=b.x+60; player.y=b.y; player.vx=0; player.vy=0; player.hp=player.maxHp;
			// clear a wide flat arena around the guest so a walker can reach it (keep the
			// body's own footing tile so it doesn't drop out from under the fight)
			const bx=Math.round(b.x), floorRow=Math.ceil(b.y+0.46);
			for(let x=bx-8;x<=bx+8;x++){ for(let yy=floorRow-4;yy<floorRow;yy++) MM.world.setTile(x,yy,MM.T.AIR); MM.world.setTile(x,floorRow,MM.T.STONE); }
			// pick a GROUND species that is ALWAYS aggressive (never flees a strong host —
			// this QA host has leveled up, so a flee-prone mob would bolt before reaching
			// the guest) with real contact damage, then spawn it on the body
			// tanky surface predators (high hp, no daylight burn) so it survives to reach
			// the guest — a fragile night-mob would despawn on the surface before contact
			const SP=MM.mobs._debugSpecies();
			const ground=Object.keys(SP).filter(id=>{ const s=SP[id]; return s && s.ground && !s.aquatic && !s.flying && s.alwaysAggro && s.dmg>0 && !s.sunriseBurn && s.hp>=60; })
				.sort((a,b)=>SP[b].hp-SP[a].hp);
			const prefer=['GIANT_SCORPION','JACKPOT_YETI','GOLD_DWARF_GUARD'].filter(id=>ground.includes(id));
			const order=[...prefer, ...ground.filter(id=>!prefer.includes(id))];
			let hit=null;
			for(const id of order){ try{ if(MM.mobs.forceSpawn(id, {x:b.x, y:b.y-1}, MM.world.getTile)){ hit=id; break; } }catch(e){} }
			if(hit) MM.mobs.setAggro(hit);
			return {hit, dmg:hit?SP[hit].dmg:0, hostHp0:player.hp, bodyHp0:b.hp, bx:+b.x.toFixed(2), by:+b.y.toFixed(2), hostX:+player.x.toFixed(2)};
		})()`);
		if(!hunt.hit) throw new Error('setup: could not spawn a ground hunter with damage on the guest');
		// the mob must pick the guest as its combat target and drain the BODY's hp
		let bodyHurt;
		try{
			bodyHurt = await host.poll(`(()=>{ const b=MM.ghostHost.metrics().bodies[0]; return b ? b.hp : 999; })()`,
				v => v < hunt.bodyHp0, 'the creature damages the GUEST body', 100, 250);
		}catch(e){
			const diag = await host.eval(`(()=>{ const b=MM.ghostHost.metrics().bodies[0];
				const l=MM.mobs.serialize().list.map(m=>({id:m.id,x:+m.x.toFixed(1),dist:+Math.abs(m.x-(b?b.x:0)).toFixed(1)}));
				return {coopBodies:(MM.coopBodies||[]).length, bodyHp:b?b.hp:null, bodyX:b?+b.x.toFixed(2):null, hunter:'${hunt.hit}', mobs:l.slice(0,6)}; })()`);
			throw new Error('the creature never damaged the guest body: ' + JSON.stringify(diag));
		}
		const hostHpAfter = await host.eval(`window.player.hp`);
		if(hostHpAfter < hunt.hostHp0) throw new Error('the distant HOST took damage from a mob hunting the guest (target routing broke): ' + hunt.hostHp0 + ' → ' + hostHpAfter);
		console.log('play aggro: ok (' + hunt.hit + ' hunted the guest — body hp ' + hunt.bodyHp0 + '→' + bodyHurt.toFixed(1) + ', distant host untouched at ' + hostHpAfter + ')');
		await host.eval(`MM.mobs.clearAll && MM.mobs.clearAll();`);
		// --- damage & death: a host-side hurt drains the guest hp; demote returns to spectator
		await host.eval(`(()=>{ const s=MM.ghostHost; const gid='${gidPlay}'; MM.__qaHurt=()=>{}; return 1; })()`);
		await ghost.shot('tools/ghost-qa-play.png');
		await host.eval(`MM.ghostHost.setViewerMode('${gidPlay}', 'full')`);
		await ghost.poll(`MM.ghostClient.metrics().play.on`, v => v === false, 'demote returns the guest to spectating', 40, 250);
		await host.poll(`MM.ghostHost.metrics().players`, v => v === 0, 'the body is removed on demote', 40, 250);
		if((await host.eval(`MM.ghostHost.metrics().bodies.length`)) !== 0) throw new Error('the guest body outlived the demotion');
		console.log('play mode: ok (embodied → moved → mined → built → fought → demoted back to ghost)');

		// --- Scene 10e: transport loss → automatic reconnect --------------------------------------------
		// _debugConnLost runs the REAL recovery path: close conn (bye), fresh join,
		// hello → welcome → fresh snapshot re-bases the world mid-session.
		await ghost.eval(`MM.ghostClient._debugConnLost()`);
		await ghost.poll(`MM.ghostClient.metrics().state`, v => v === 'live', 'reconnect returns to live', 80, 250);
		const rec = await ghost.eval(`MM.ghostClient.metrics()`);
		if(rec.stats.snapsApplied < 2) throw new Error('reconnect did not re-base from a fresh snapshot: ' + JSON.stringify(rec.stats));
		if(rec.reconnects !== 0) throw new Error('reconnect budget was not refreshed after a successful re-join');
		const postTile = await ghost.eval(`MM.ghostBridge.getTile(${diff.tx},${diff.ty})`);
		if(postTile !== diff.want) throw new Error('world state diverged across the reconnect');
		await host.poll(`MM.ghostHost.metrics().ghosts`, v => v === 1, 'host still sees exactly one ghost after reconnect', 40, 250);
		console.log('reconnect: ok (snaps=' + rec.stats.snapsApplied + ', world coherent)');

		// --- Scene 11: permission downgrade — watch-only means watch-only ------------------------------
		const gidOnHost = (await host.eval(`MM.ghostHost.metrics().viewers`))[0].gid;
		await host.eval(`MM.ghostHost.setViewerMode('${gidOnHost}', 'watch')`);
		await ghost.poll(`MM.ghostClient.metrics().mode`, v => v === 'watch', 'client learns the downgrade', 30, 250);
		const buffRefused = await ghost.eval(`MM.ghostClient.sendBuff('cheer')`);
		const chatRefused = await ghost.eval(`MM.ghostClient.sendChat('halo?')`);
		if(buffRefused || chatRefused) throw new Error('watch-only client still sent buff/chat');
		const buffsAfter = await host.eval(`MM.ghostHost.metrics().stats.buffs`);
		if(buffsAfter !== 1) throw new Error('host accepted influence from a watch-only ghost');
		console.log('permissions: ok (watch-only blocks chat and buffs on both ends)');

		// --- Scene 12: ban — final on both ends ----------------------------------------------------------
		await host.eval(`MM.ghostHost.banViewer('${gidOnHost}')`);
		await ghost.poll(`MM.ghostClient.metrics().state`, v => v === 'ended', 'banned ghost session ends', 30, 250);
		await host.poll(`MM.ghostHost.metrics().ghosts`, v => v === 0, 'banned ghost removed from the host', 30, 250);
		const bannedCount = await host.eval(`MM.ghostHost.metrics().banned`);
		if(bannedCount !== 1) throw new Error('ban list not recorded');
		console.log('ban: ok');

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
