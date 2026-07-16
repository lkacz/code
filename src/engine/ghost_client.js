// Ghost client (ghost_client.js): boots the game as a WATCHER ("Duch Warstwy").
// A `?watch=ROOM` link flips MM.ghostMode at import time — main.js then skips
// its own save, never persists anything (all save paths are ghost-guarded) and
// hands the sim frame to us. The world is rebuilt from the host's streamed save
// object via bridge.applyGameData (the exact reload codec), after which we only
// consume live planes: tile diffs, hero pose, mob rosters, slow snapshots.
//
// The local `player` object IS the replica of the host hero — drawPlayer, the
// vitals HUD and fog reveals all keep working untouched. The ghost itself is
// just a camera: follow mode tracks the hero, any pan key/drag detaches into
// free flight, F snaps back. The only uplink: camera pose + rate-limited buffs.
import { ghostNet as NET } from './ghost_net.js';
import { MOVE, T } from '../constants.js';
import { applyHorizontalMovement } from './movement.js';

const MMR = (typeof window !== 'undefined' && window.MM) ? window.MM : null;
const WATCH = (typeof location !== 'undefined') ? NET.parseWatch(location.search) : null;
if(WATCH && MMR){
	MMR.ghostMode = true;
	MMR.ghostWatch = WATCH;
	// Storage lockdown: a watcher replicates a FOREIGN world into live systems,
	// and several engines persist side stores (dynamic loot, discoveries, prefs)
	// on restore/update. The main-save guards in main.js are not enough — block
	// every localStorage write except the ghost's own display name, so watching
	// a friend can never contaminate this browser's single-player state.
	try{
		// (the ghost's OWN profile is on this list: name, avatar, career and stable
		// gid — career + gid are what make progression AND the host-kept body pouch
		// survive a reload and a fresh invite link)
		const allow = new Set(['mm_ghost_name_v1', 'mm_ghost_avatar_v1', NET.PROG_KEY, NET.GID_KEY, NET.GID_LEASE_KEY, NET.LOOK_KEY, NET.HERO_KEY]);
		const origSet = Storage.prototype.setItem;
		const origRemove = Storage.prototype.removeItem;
		Storage.prototype.setItem = function(k, v){
			if(typeof window !== 'undefined' && this === window.localStorage && !allow.has(String(k))) return;
			return origSet.call(this, k, v);
		};
		Storage.prototype.removeItem = function(k){
			if(typeof window !== 'undefined' && this === window.localStorage && !allow.has(String(k))) return;
			return origRemove.call(this, k);
		};
	}catch(e){ /* storage may be unavailable altogether — fine */ }
}

const PAN_KEYS = { w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0], arrowup: [0, -1], arrowleft: [-1, 0], arrowdown: [0, 1], arrowright: [1, 0] };
const HELLO_MS = 1200, POSE_MS = 150, NEEDMOBS_MS = 600;

const ghostClient = (function(){
	let bridge = null;
	let conn = null;
	let state = 'idle'; // connect -> sync -> live | ended
	let hostName = null;
	// The gid is STABLE across reloads (persisted like the career): the same spirit
	// returns to its progression, its ban standing and — when embodied — the pouch
	// and arsenal the host kept for it. Self-claimed like the display name: never an
	// authority, only the key the host may hang HOST-side state on. Tab identity
	// first (sessionStorage survives a reload but never leaks into a second tab),
	// then the browser-stable base — adopted only when no LIVE tab holds its lease,
	// because two tabs sharing one gid would boot each other via newest-wins.
	const gidMint = () => 'g' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
	const gid = (() => {
		if(!WATCH) return gidMint(); // host pages import this module too — leave their storage alone
		const shape = /^g[a-z0-9]{8,14}$/;
		try{
			const tab = sessionStorage.getItem(NET.GID_KEY);
			if(typeof tab === 'string' && shape.test(tab)) return tab;
			let base = localStorage.getItem(NET.GID_KEY);
			if(typeof base !== 'string' || !shape.test(base)){ base = gidMint(); localStorage.setItem(NET.GID_KEY, base); }
			let lease = null;
			try{ lease = JSON.parse(localStorage.getItem(NET.GID_LEASE_KEY) || 'null'); }catch(e){ lease = null; }
			const held = !!(lease && lease.gid === base && (Date.now() - (Number(lease.ts) || 0)) < NET.GID_LEASE_MS);
			const mine = held ? gidMint() : base; // a sibling tab holds the base identity
			sessionStorage.setItem(NET.GID_KEY, mine);
			return mine;
		}catch(e){ return gidMint(); }
	})();
	if(WATCH && typeof window !== 'undefined'){
		// the base-identity owner keeps its lease warm; sibling tabs never write it
		const heartbeatGidLease = () => {
			try{ if(localStorage.getItem(NET.GID_KEY) === gid) localStorage.setItem(NET.GID_LEASE_KEY, JSON.stringify({ gid, ts: Date.now() })); }catch(e){ /* fine */ }
		};
		heartbeatGidLease();
		setInterval(heartbeatGidLease, 3000);
	}
	const assembler = NET.createAssembler();
	const queue = [];
	const heroTarget = { has: false, x: 0, y: 0, vx: 0, vy: 0, at: 0 };
	const cam = { mode: 'follow', x: 0, y: 0 };
	const others = []; // fellow spirits from presence relay (eased toward tx/ty by the painter)
	let selfChat = null; // own last message, rendered over the own avatar
	const held = new Set();
	const stats = { tilesApplied: 0, tileMsgs: 0, mobRosters: 0, mobFulls: 0, invRosters: 0, invFulls: 0, guard: 0, wfx: 0, snapsApplied: 0, fx: 0 };
	const buffWait = {}; // kind -> readyAtMs (UI countdown)
	let timers = { hello: 0, pose: 0, needMobs: 0 };
	let veil = null, bar = null, barTick = null;
	let hostIdle = false, staleBanner = null, lastHostMsgAt = 0, bootAt = 0, connectFailShown = false;
	let drag = null;
	let pump = null;
	let lockedConn = null;
	let syncSince = 0, lastSnapReq = 0;
	let lastRafAt = 0;
	let reconnecting = false, reconnects = 0;
	let mode = 'full'; // host-granted permission ladder: watch | chat | full
	let lastInputAt = 0; // real watcher input — powers the social-facilitation "active" signal
	let avatar = 'duszek';
	let charge = 0; // earned by staying ACTIVE; spent on powers (host is authoritative)
	const powerWait = {};
	let assistant = false, assistState = null, assistPanel = null;
	let assistApproval = false, assistSig = '', lastAssistAck = null;
	const powerFx = []; // {x,y,kind,t}
	let hostChat = null; // the host's own words, rendered over the hero replica
	const pings = []; // {x,y,name,t} — spots fellow spirits (or we) pointed at
	let lastPingSentAt = 0;
	let prog = NET.createProgress(); // the watcher's own career (persisted in THEIR browser)
	let progPanel = null;
	// --- play mode (embodiment): the ghost gains an OWN hero -------------------------
	// The local `player` object flips roles: replica of the host hero → the guest's
	// own body, simulated locally (movement feels instant) while the HOST owns the
	// vitals, the pouch and every world edit. The host hero moves into remoteHost
	// and is painted like any other remote body.
	const play = { on: false, spawned: false, dead: false, sel: null, pouch: {}, weapons: [], arm: 'fists', duelWith: null, mineHold: null, prog: 0, progAt: null, jumpBufT: 0, coyoteT: 0 };
	// --- hero mode (full-game guest): the REAL game runs locally ----------------------
	// The guest's player state (inventory, gear, XP, vitals) is ITS local truth
	// (owner ruling), persisted under NET.HERO_KEY per room. main.js runs the real
	// hero frame (runHeroStep) and routes every world WRITE through these intents;
	// the host validates them with solo-grade rules and the world returns on the
	// tile stream. Combat forwards through the wrapped damage entries below.
	const hero = { on: false, spawned: false };
	const heroIntents = {
		mineBreak(tx, ty){
			if(state === 'live' && conn) conn.send({ t: 'hact', a: 'mine', x: tx, y: ty });
			return true; // the break "lands" when the host's tile diff arrives
		},
		place(tx, ty, tid, layer){
			if(state !== 'live' || !conn) return false;
			conn.send({ t: 'hact', a: 'place', x: tx, y: ty, tid: Number(tid) | 0, l: layer });
			return true;
		},
		pickup(wx, wy){
			if(state !== 'live' || !conn) return false;
			conn.send({ t: 'hact', a: 'pickup', x: +Number(wx).toFixed(1), y: +Number(wy).toFixed(1) });
			return true;
		},
		use(tx, ty){
			if(state !== 'live' || !conn) return false;
			conn.send({ t: 'hact', a: 'use', x: Math.floor(tx), y: Math.floor(ty) });
			return true;
		},
		// a locally fired projectile (the pushArrow chokepoint) — velocity, damage
		// and a flag whitelist travel; the host clamps everything and flies the
		// REAL arrow from its tracked body
		shoot(a){
			if(state !== 'live' || !conn || !a) return false;
			conn.send({ t: 'hact', a: 'shoot',
				vx: +(Number(a.vx) || 0).toFixed(2), vy: +(Number(a.vy) || 0).toFixed(2),
				n: Math.max(1, Math.min(45, Math.round(Number(a.dmg) || 1))),
				f2: a.fire ? 1 : 0, sb: a.snowball ? 1 : 0, rk: a.rock ? 1 : 0, th: a.thrown ? 1 : 0, hp2: a.harpoon ? 1 : 0 });
			return true;
		}
	};
	// Replica damage entries, wrapped while embodied as a hero: the local call
	// stands as PREDICTION (the creature stream reconciles), the application is
	// forwarded to the host, which resolves it through the real chains, clamped.
	const heroDmgWrapped = [];
	function wrapHeroDamage(){
		if(heroDmgWrapped.length) return;
		for(const nm of ['mobs', 'invasions', 'bosses', 'guardianLairs', 'skyGuardian', 'undergroundBoss', 'ufo', 'mechs']){
			const sys = MMR && MMR[nm];
			if(!sys) continue;
			for(const fn of ['damageAt', 'attackAt']){
				if(typeof sys[fn] !== 'function') continue;
				const orig = sys[fn];
				heroDmgWrapped.push([sys, fn, orig]);
				sys[fn] = function(tx, ty, amt){
					try{ if(state === 'live' && conn) conn.send({ t: 'hact', a: 'dmg', x: +tx, y: +ty, n: Math.max(1, Math.min(45, Number(amt) || 1)) }); }catch(e){ /* fine */ }
					return orig.apply(this, arguments);
				};
			}
			// elemental parity: the real weapons apply status through these — forward
			// the ELEMENT (host uses its own safe params), keep the local call as prediction
			for(const [fn, kind] of [['igniteAt', 'ignite'], ['chillAt', 'chill']]){
				if(typeof sys[fn] !== 'function') continue;
				const orig = sys[fn];
				heroDmgWrapped.push([sys, fn, orig]);
				sys[fn] = function(tx, ty){
					try{ if(state === 'live' && conn) conn.send({ t: 'hact', a: 'dmg', x: +tx, y: +ty, n: 1, k: kind }); }catch(e){ /* fine */ }
					return orig.apply(this, arguments);
				};
			}
		}
	}
	function unwrapHeroDamage(){
		for(const [sys, fn, orig] of heroDmgWrapped.splice(0)) sys[fn] = orig;
	}
	let heroSaveAt = 0;
	function saveHeroState(force){
		if(!hero.on || !bridge || !bridge.ghostHeroCapture) return;
		const t = nowMs();
		if(!force && t - heroSaveAt < 3000) return;
		heroSaveAt = t;
		try{ localStorage.setItem(NET.HERO_KEY, JSON.stringify({ v: 1, room: WATCH.room, gid, at: Date.now(), state: bridge.ghostHeroCapture() })); }catch(e){ /* session-only hero */ }
	}
	function enterHero(){
		if(hero.on) return;
		if(play.on) exitPlay();
		hero.on = true; hero.spawned = false;
		// the host hero leaves the local `player` (it becomes OUR full hero) and
		// moves into remoteHost, exactly like play mode
		const p = bridge.player;
		remoteHost.has = true; remoteHost.x = p.x; remoteHost.y = p.y;
		remoteHost.dx = p.x; remoteHost.dy = p.y;
		remoteHost.vx = p.vx || 0; remoteHost.vy = p.vy || 0; remoteHost.f = p.facing || 1;
		// the HOST's riches came in with applyGameData — keeping them would be item
		// duplication into guest-local truth: restore OUR persisted hero or start fresh
		let saved = null;
		try{ saved = JSON.parse(localStorage.getItem(NET.HERO_KEY) || 'null'); }catch(e){ saved = null; }
		const returning = !!(saved && typeof saved === 'object' && saved.room === WATCH.room && saved.state
			&& bridge.ghostHeroRestore && bridge.ghostHeroRestore(saved.state));
		if(!returning && bridge.ghostHeroFresh) bridge.ghostHeroFresh();
		document.body.classList.add('mmGhostHero');
		if(MMR) MMR.ghostHeroIntents = heroIntents; // main.js chokepoints activate on this hook
		wrapHeroDamage();
		if(myLook && conn && state === 'live') conn.send({ t: 'plook', c: myLook });
		cam.mode = 'follow';
		bridge.msg(returning ? '🕹 PEŁNE WCIELENIE — twój bohater wrócił z ekwipunkiem!'
			: '🕹 PEŁNE WCIELENIE: grasz jak u siebie — kop, buduj, wytwarzaj. Świat należy do gospodarza, twój ekwipunek do ciebie.');
		updateBar();
	}
	function exitHero(){
		if(!hero.on) return;
		saveHeroState(true); // nothing earned may be lost on demotion
		hero.on = false; hero.spawned = false;
		if(MMR) MMR.ghostHeroIntents = null;
		unwrapHeroDamage();
		document.body.classList.remove('mmGhostHero');
		remoteHost.has = false;
		poseLog.length = 0;
		updateBar();
	}
	const remoteHost = { has: false, x: 0, y: 0, vx: 0, vy: 0, f: 1, dx: 0, dy: 0 };
	const bodies = []; // fellow embodied guests, eased like the spirits
	let timersPlay = { pose: 0, mine: 0 };
	// Lag-compensated reconciliation: every pose uplink carries a sequence number
	// and the host echoes it in our own pb row. Divergence is measured against the
	// MATCHING historical claim, never the current pose — an echo is ~RTT stale, so
	// comparing it to a fast-moving present used to fake divergence and snap us back.
	let poseSeq = 0;
	const poseLog = []; // {seq, x, y}, pruned to the last echoed seq

	function nowMs(){ return Date.now(); }
	// Remote strings (host name, fellow-ghost names) render into innerHTML in the
	// veil — escape them; a hostile host must not script the watcher's page.
	function esc(s){ return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
	function ghostName(){
		if(WATCH && WATCH.name) return WATCH.name;
		try{
			let n = localStorage.getItem('mm_ghost_name_v1');
			if(!n){ n = 'Duch-' + Math.random().toString(36).slice(2, 5).toUpperCase(); localStorage.setItem('mm_ghost_name_v1', n); }
			return n;
		}catch(e){ return 'Duch'; }
	}
	function noteInput(){ lastInputAt = nowMs(); }
	function isActive(){ return nowMs() - lastInputAt < NET.SOCIAL_RULES.IDLE_MS; }
	function loadAvatar(){
		try{ const a = localStorage.getItem('mm_ghost_avatar_v1'); if(NET.validAvatar(a)) avatar = a; }catch(e){ /* default */ }
	}
	function setAvatar(a){
		if(!NET.validAvatar(a)) return;
		avatar = a;
		try{ localStorage.setItem('mm_ghost_avatar_v1', a); }catch(e){ /* fine */ }
		if(conn) conn.send({ t: 'avatar', a });
		noteInput();
		updateBar();
	}
	// The chosen body color: persisted like the avatar, validated on BOTH ends
	// (the host is the authority — it relays only strict hex), display-only.
	let myLook = null;
	function loadLook(){
		try{ const c = localStorage.getItem(NET.LOOK_KEY); if(NET.validLookColor(c)) myLook = c.toLowerCase(); }catch(e){ /* default tint */ }
	}
	function setLook(c){
		if(!NET.validLookColor(c)) return false;
		myLook = c.toLowerCase();
		try{ localStorage.setItem(NET.LOOK_KEY, myLook); }catch(e){ /* session-only look */ }
		if(conn && state === 'live' && play.on) conn.send({ t: 'plook', c: myLook });
		noteInput();
		return true;
	}
	const looks = {}; // gid → host-relayed chosen color, re-validated on receipt

	// --- the watcher's own career -----------------------------------------------------
	// Persisted HERE, in the viewer's own browser (NET.PROG_KEY), which is why the
	// profile outlives a reload, a new invite link and a different host — no server,
	// no account. The host mints the deeds; this side only banks them, celebrates, and
	// tells the host its level so the viewer list can show a rank badge (display only).
	function loadProgress(){
		try{ prog = NET.normalizeProgress(JSON.parse(localStorage.getItem(NET.PROG_KEY) || 'null')); }
		catch(e){ prog = NET.createProgress(); }
	}
	// Persistence rides a throttle: a hostile host can spam deed messages at the
	// rate cap, and each write is a JSON.stringify + localStorage.setItem. Dirty
	// state is flushed at most every 2 s (the bar tick drives the trailing write)
	// and unconditionally on leave/unload so nothing earned is ever dropped.
	let progDirty = false, lastProgSaveAt = 0;
	function flushProgress(force){
		if(!progDirty) return;
		const t = nowMs();
		if(!force && t - lastProgSaveAt < 2000) return;
		lastProgSaveAt = t;
		try{
			// SIBLING MERGE: two tabs of one browser share this key, and a backgrounded
			// sibling's throttled trailing flush used to land LATE and stomp this tab's
			// fresher write (last-writer-wins). Merging monotonically — max counts, union
			// done/days, max xp — means neither tab can ever erase the other's earnings.
			let disk = null;
			try{ disk = JSON.parse(localStorage.getItem(NET.PROG_KEY) || 'null'); }catch(e){ disk = null; }
			if(disk && typeof disk === 'object'){
				const d = NET.normalizeProgress(disk);
				const m = NET.normalizeProgress(prog);
				for(const k of Object.keys(d.counts)) m.counts[k] = Math.max(m.counts[k] || 0, d.counts[k]);
				for(const id of d.done) if(!m.done.includes(id)) m.done.push(id);
				for(const dd of d.days) if(!m.days.includes(dd) && m.days.length < NET.PROG.MAX_DAYS) m.days.push(dd);
				m.xp = Math.max(m.xp, d.xp);
				prog = m;
			}
			localStorage.setItem(NET.PROG_KEY, JSON.stringify(prog));
			progDirty = false; // only a write that actually LANDED may clear the flag —
			// a transient storage failure must stay dirty so the next tick retries,
			// otherwise a later force-flush no-ops on !progDirty and the disk lies low
		}catch(e){ /* storage full/blocked — the session still counts */ }
	}
	function today(){
		const d = new Date();
		const p = n => String(n).padStart(2, '0');
		return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
	}
	function bankDeeds(deeds, opts){
		const before = prog;
		const res = NET.progressAfter(prog, deeds, opts);
		// "changed" must see count-only and day-only mutations too: the crowd deed is
		// worth 0 XP and a day stamp moves no counter, yet both must reach disk
		const changed = res.state.xp !== before.xp
			|| res.unlocked.length > 0
			|| res.state.days.length !== before.days.length
			|| JSON.stringify(res.state.counts) !== JSON.stringify(before.counts);
		prog = res.state;
		if(!changed) return res;
		progDirty = true;
		flushProgress();
		if(res.leveled){
			const rank = NET.rankFor(res.level);
			try{ bridge && bridge.msg('⬆ Poziom ' + res.level + ' — ' + rank.name + '!'); }catch(e){ /* fine */ }
			if(conn) conn.send({ t: 'prog', lvl: res.level });
		}
		for(const a of res.unlocked){
			try{ bridge && bridge.msg('🏆 Osiągnięcie: ' + a.icon + ' ' + a.name + ' (+' + a.xp + ' XP)'); }catch(e){ /* fine */ }
		}
		updateBar();
		renderProgress();
		return res;
	}

	// --- boot --------------------------------------------------------------------
	function boot(b){
		if(!WATCH) return false;
		bridge = b;
		loadAvatar();
		loadLook();
		loadProgress();
		document.body.classList.add('mmGhostMode');
		injectCss();
		showVeil('Łączenie z warstwą <b>' + WATCH.room + '</b>…');
		buildBar();
		bootAt = nowMs(); // the connect-failure verdict measures from here
		state = 'connect';
		conn = makeConn();
		sendHello();
		// prompt goodbye on tab close — otherwise the host only reaps after 15 s;
		// and flush the career so a deed banked seconds before the close survives
		window.addEventListener('beforeunload', () => { flushProgress(true); saveHeroState(true); try{ if(conn) conn.close(); }catch(e){ /* fine */ } });
		window.addEventListener('pagehide', () => { flushProgress(true); saveHeroState(true); });
		// Backgrounding the tab is the one moment a watcher is most likely to never
		// come back to it — bank the career to disk right there, before the browser
		// starts throttling everything this page does.
		try{ document.addEventListener('visibilitychange', () => { if(document.hidden) flushProgress(true); }); }catch(e){ /* no document: Node sims */ }
		// Companion pump (mirror of ghost_host's): keeps hello retries, queue
		// drain and the pose keepalive alive while this tab is backgrounded and
		// rAF is frozen. All paths inside frame() are cadence-gated/idempotent.
		// It also carries the trailing profile write: deeds keep arriving in a
		// background tab (watching still pays), and flushProgress only writes when
		// the 2 s throttle allows — without a heartbeat here, a burst of deeds
		// could sit dirty in memory until the tab was closed and be lost.
		pump = setInterval(() => {
			try{ frame(0.5, (typeof performance !== 'undefined') ? performance.now() : Date.now(), true); }catch(e){ /* next tick */ }
			try{ flushProgress(); }catch(e){ /* storage blocked */ }
		}, 500);
		return true;
	}
	function makeConn(){
		return NET.joinRoom(WATCH.room, {
			id: gid,
			via: WATCH.via,
			onMessage: onMessage,
			onSignalFail: () => { if(state === 'connect') showVeil('Nie mogę dosięgnąć serwerów sygnałowych.<br>Spróbuj ponownie za chwilę.'); }
		});
	}
	function sendHello(){ if(conn) conn.send({ t: 'hello', gid, name: ghostName(), avatar, proto: NET.GHOST_PROTO, lvl: NET.levelFor(prog.xp).level }); }
	// Transport loss ≠ the host saying goodbye: rebuild the connection and let the
	// normal hello → welcome → snapshot flow re-base the world. hostGone stays final.
	function scheduleReconnect(){
		if(reconnecting || state === 'ended') return;
		reconnecting = true;
		reconnects++;
		if(reconnects > 8){
			state = 'ended';
			showVeil('Połączenie z warstwą przepadło.<br><a href="' + location.href.replace(/"/g, '') + '" style="color:#8fc7ff;">Spróbuj ponownie</a>');
			return;
		}
		state = 'connect';
		lockedConn = null;
		try{ conn.close(); }catch(e){ /* fine */ }
		showVeil('Połączenie przerwane — łączę ponownie… (' + reconnects + '/8)');
		setTimeout(() => {
			reconnecting = false;
			if(state !== 'connect') return; // hostGone/leave won the race
			conn = makeConn();
			sendHello();
		}, 1200);
	}
	function leave(){
		state = 'ended';
		flushProgress(true); // nothing earned may be lost on the way out
		saveHeroState(true); // the hero's inventory survives the exit too
		if(pump){ clearInterval(pump); pump = null; }
		if(barTick){ clearInterval(barTick); barTick = null; }
		if(bar) bar.style.display = 'none';
		try{ if(conn) conn.close(); }catch(e){ /* fine */ }
		showVeil('Opuściłeś warstwę.<br><a href="' + location.pathname + '" style="color:#8fc7ff;">Wróć do własnej gry</a>');
	}

	// --- messages ------------------------------------------------------------------
	function onMessage(pl, c, api){
		if(!pl || typeof pl.t !== 'string') return;
		// once locked, a straggler frame from the losing transport must not reach
		// the assembler — an interleaved foreign chunk would wedge the snapshot
		if(lockedConn && c !== lockedConn) return;
		lastHostMsgAt = nowMs(); // any traffic proves the stream is alive (stale-banner fallback)
		if(pl.t === 'welcome'){
			if(state === 'connect'){
				state = 'sync';
				syncSince = nowMs();
				hostName = String(pl.host || 'Gospodarz').slice(0, 24);
				if(NET.validPermissionMode(pl.mode)) mode = pl.mode;
				lockedConn = c;
				api.lock(c);
				showVeil('Połączono z warstwą gracza <b>' + esc(hostName) + '</b>.<br>Pobieram świat…');
			}
			return;
		}
		if(pl.t === 'full'){
			state = 'ended';
			showVeil('Ta warstwa ma już komplet duchów.<br>Spróbuj ponownie za chwilę.');
			return;
		}
		if(pl.t === 'banned'){
			state = 'ended';
			showVeil('Gospodarz zablokował twój dostęp do tej warstwy.');
			return;
		}
		if(pl.t === 'perm'){
			if(NET.validPermissionMode(pl.mode)){
				mode = pl.mode;
				if(mode === 'hero'){ enterHero(); }
				else if(mode === 'play'){ if(hero.on) exitHero(); enterPlay(); }
				else { if(play.on) exitPlay(); if(hero.on) exitHero(); }
				bridge.msg(mode === 'watch' ? '👁 Gospodarz: możesz teraz tylko oglądać'
					: mode === 'chat' ? '💬 Gospodarz: możesz pisać, bez wpływu na grę'
					: mode === 'play' ? '🎮 Gospodarz wciela cię do gry!'
					: mode === 'hero' ? '🕹 Gospodarz daje ci PEŁNĄ grę!'
					: '⚡ Gospodarz: pełne uprawnienia ducha');
				updateBar();
			}
			return;
		}
		if(pl.t === 'hact'){
			// hero-mode ack: a validated break awards THIS side's own drop logic,
			// a refused placement refunds the locally spent block
			if(hero.on){
				if(pl.a === 'mine' && pl.ok && pl.tid){ try{ if(bridge.ghostHeroAward) bridge.ghostHeroAward(pl.tid); }catch(e){ /* fine */ } }
				else if(pl.a === 'place' && !pl.ok && pl.tid){
					try{ if(bridge.ghostHeroRefund) bridge.ghostHeroRefund(pl.tid); }catch(e){ /* fine */ }
					bridge.msg('🧱 Gospodarz odrzucił postawienie (' + (pl.reason || '?') + ') — surowiec wraca');
				}
				else if(pl.a === 'mine' && !pl.ok && pl.reason === 'chest') bridge.msg('🎁 Skrzynię otwórz kliknięciem — nie kilofem');
				else if(pl.a === 'pickup' && pl.ok && pl.item){
					// gear travels as the item object — grantItem SANITIZES it again
					// (a hostile host must not smuggle a poisoned item into the bag)
					try{ if(MMR && MMR.inventory && MMR.inventory.grantItem && MMR.inventory.grantItem(pl.item)) bridge.msg('🎒 Podniesiono przedmiot!'); }catch(e){ /* fine */ }
				}
				else if(pl.a === 'pickup' && pl.ok && pl.key){ try{ if(bridge.ghostHeroGain) bridge.ghostHeroGain(pl.key, pl.qty || 1); }catch(e){ /* fine */ } }
			}
			return;
		}
		if(pl.t === 'pvit'){
			// host-owned vitals & pouch — the ONLY source of truth for both
			if(play.on){
				if(Number.isFinite(pl.hp)) bridge.player.hp = Math.max(0, pl.hp);
				if(Number.isFinite(pl.mhp) && pl.mhp > 0) bridge.player.maxHp = pl.mhp;
				play.dead = !!pl.dead;
			}
			play.pouch = {};
			if(pl.pouch && typeof pl.pouch === 'object'){
				for(const k of Object.keys(pl.pouch).slice(0, 40)){
					const n = Number(pl.pouch[k]);
					if(k && k !== '__proto__' && Number.isFinite(n) && n > 0) play.pouch[k.slice(0, 24)] = Math.min(999, Math.floor(n));
				}
			}
			if(play.sel && !(play.pouch[play.sel] > 0)) play.sel = null;
			// the arsenal is display truth from the host — the chips only pick which
			// OWNED weapon the next attack intent names
			play.weapons = Array.isArray(pl.weapons) ? pl.weapons.slice(0, 8).filter(w => typeof w === 'string' && w !== '__proto__').map(w => w.slice(0, 16)) : [];
			if(play.weapons.length && !play.weapons.includes(play.arm)) play.arm = play.weapons[0];
			renderPouch();
			return;
		}
		if(pl.t === 'pdrown'){
			// breath warnings mirror the host-side survival law (display only — the
			// damage itself arrives through pvit/pdmg like any other hurt)
			if(play.on) bridge.msg(pl.w ? '🫧 Brakuje powietrza — wynurz się!' : '🫧 Łapiesz oddech');
			return;
		}
		if(pl.t === 'pwat'){
			// sub-tile water windows around the host hero and the bodies — applied
			// DISPLAY-ONLY (water.js bounds and sanitizes; a watcher never runs the
			// solver, so no volume invariant can fight the write). Rate-floored: a
			// hostile host spamming windows must not buy thousands of map ops a frame.
			const tW = nowMs();
			if(tW - (timers.pwat || 0) < 200) return;
			timers.pwat = tW;
			const W = MMR && MMR.water;
			if(W && W.ghostApplyPartialsWindow && Array.isArray(pl.w)){
				for(const w of pl.w.slice(0, 6)){
					if(Array.isArray(w) && w.length >= 5) W.ghostApplyPartialsWindow(+w[0], +w[1], +w[2], +w[3], w[4]);
				}
				stats.pwat = (stats.pwat || 0) + 1;
			}
			return;
		}
		if(pl.t === 'pstat'){
			// the body's status chips, mirrored into the LOCAL hero-status singleton so
			// the vitals HUD chips and the movement feel work natively. Display truth
			// only: the local update() merely decays it, its burnDamage is discarded —
			// hp stays host truth via pvit/pdmg.
			const HSc = MMR && MMR.heroStatus;
			if(play.on && HSc && HSc._state){
				HSc._state.wet = Math.max(0, Math.min(60, Number(pl.w) || 0));
				HSc._state.chill = Math.max(0, Math.min(60, Number(pl.c) || 0));
				HSc._state.burn = Math.max(0, Math.min(60, Number(pl.b) || 0));
				HSc._state.frozen = Math.max(0, Math.min(10, Number(pl.f) || 0));
			}
			return;
		}
		if(pl.t === 'pwarn'){
			// survival warnings mirror the host-side laws (display only)
			if(play.on){
				if(pl.k === 'chill') bridge.msg('🥶 Woda wychładza — wyjdź na brzeg!');
				else if(pl.k === 'cold') bridge.msg('🥶 Mróz przenika do kości — znajdź ciepło albo schronienie!');
				else if(pl.k === 'heat') bridge.msg('🥵 Upał wysusza — schłodź się w wodzie albo w cieniu!');
				else if(pl.k === 'pressure') bridge.msg('🌊 Ciśnienie wody rośnie — wynurz się wyżej!');
				else if(pl.k === 'frozen') bridge.msg('🧊 Mokry i zziębnięty na mrozie — zamarzasz w bryłę lodu!');
			}
			return;
		}
		if(pl.t === 'plook'){
			// a fellow player's chosen color — re-validated (defense in depth), bounded
			if(typeof pl.gid === 'string' && pl.gid && NET.validLookColor(pl.c)){
				const g = pl.gid.slice(0, 40);
				if(g in looks || Object.keys(looks).length < 24) looks[g] = pl.c.toLowerCase();
			}
			return;
		}
		if(pl.t === 'duel'){
			// host-arbitrated duel state: this client only mirrors what the host decided
			const other = pl.a === gid ? pl.b : (pl.b === gid ? pl.a : null);
			if(other){
				play.duelWith = pl.on ? String(other).slice(0, 20) : null;
				bridge.msg(pl.on ? '⚔ Pojedynek rozpoczęty!' : '⚔ Pojedynek zakończony');
				updateBar();
			}
			return;
		}
		if(pl.t === 'duelAsk'){
			bridge.msg('⚔ ' + String(pl.name || 'Duch').slice(0, 24) + ' wyzywa cię na pojedynek — kliknij ⚔, by przyjąć');
			return;
		}
		if(pl.t === 'gift'){
			if(pl.weapon) bridge.msg('🎁 Gospodarz wręcza ci broń: ' + String(pl.label || pl.weapon).slice(0, 24));
			else bridge.msg('🎁 Gospodarz podarował: ' + String(pl.label || pl.key || '?').slice(0, 24) + ' ×' + (Number(pl.n) || 0));
			return;
		}
		if(pl.t === 'pdmg'){
			// advisory knockback: the host decided the hit, the impulse lands on the
			// locally simulated body so it FEELS like a hit
			if(hero.on && hero.spawned){
				// hero mode: the host forwards the AMOUNT — it runs through the real
				// damage pipeline here (armor, toughness, i-frames), full parity
				const p = bridge.player;
				if(Number.isFinite(pl.kbx)) p.vx += Math.max(-8, Math.min(8, pl.kbx));
				if(Number.isFinite(pl.kby)) p.vy += Math.max(-8, Math.min(8, pl.kby));
				const amt = Math.max(0, Math.min(200, Number(pl.amt) || 0));
				if(amt > 0){ try{ if(typeof window !== 'undefined' && window.damageHero) window.damageHero(amt, { cause: String(pl.cause || 'mob').slice(0, 16) }); }catch(e){ /* fine */ } }
				return;
			}
			if(play.on && play.spawned){
				const p = bridge.player;
				if(Number.isFinite(pl.kbx)) p.vx += Math.max(-8, Math.min(8, pl.kbx));
				if(Number.isFinite(pl.kby)) p.vy += Math.max(-8, Math.min(8, pl.kby));
				if(Number.isFinite(pl.hp)) p.hp = Math.max(0, pl.hp);
			}
			return;
		}
		if(pl.t === 'prespawn'){
			if(play.on && Number.isFinite(pl.x) && Number.isFinite(pl.y)){
				const p = bridge.player;
				p.x = +pl.x; p.y = +pl.y; p.vx = 0; p.vy = 0;
				play.dead = false;
				poseLog.length = 0; // pre-respawn claims answer nothing anymore
				bridge.snapCameraToPlayer();
				bridge.msg('✨ Odrodzenie!');
			}
			return;
		}
		if(pl.t === 'pactAck'){
			if(pl.a === 'mine'){
				if(pl.ok && Number.isFinite(pl.progress) && pl.progress < 1){
					play.prog = pl.progress;
					play.progAt = (Number.isFinite(pl.x) && Number.isFinite(pl.y)) ? { x: pl.x, y: pl.y } : null;
				} else { play.prog = 0; play.progAt = null; }
			}
			if(!pl.ok && pl.reason === 'cost') bridge.msg('🎒 Brak surowca w sakwie — wykop go najpierw');
			if(!pl.ok && pl.reason === 'ammo') bridge.msg('🏹 Brak strzał w sakwie');
			if(!pl.ok && pl.reason === 'weapon') bridge.msg('⚔️ Nie masz tej broni');
			if(pl.a === 'duel' && pl.ok && !pl.on) bridge.msg('⚔ Wyzwanie wysłane — pojedynek zacznie się, gdy przeciwnik też kliknie ⚔');
			if(pl.a === 'duel' && !pl.ok && pl.reason === 'busy') bridge.msg('⚔ Któryś z was już walczy w pojedynku');
			return;
		}
		if(pl.t === 'deed'){
			// XP is only ever minted by the host — this side banks what it is told
			if(!NET.validDeed(pl.k)) return;
			// Join XP pays once per day: every reload re-joins, and +5 per F5 would
			// out-earn honest watching. The first ever join is always on a fresh day,
			// so the "first_watch" achievement is untouched.
			if(pl.k === 'join' && prog.days.includes(today())) return;
			bankDeeds([{ k: pl.k, n: pl.n }], { day: today() });
			return;
		}
		if(pl.t === 'chunk'){
			const done = assembler.push(pl);
			if(done && done.kind === 'snap') applySnapshot(done.data);
			return;
		}
		if(pl.t === 'hostGone'){
			state = 'ended';
			showVeil('Transmisja zakończona przez gospodarza.<br><a href="' + location.pathname + '" style="color:#8fc7ff;">Wróć do własnej gry</a>');
			return;
		}
		if(pl.t === 'connLost'){
			scheduleReconnect();
			return;
		}
		if(pl.t === 'buffAck'){ noteBuffAck(pl); return; }
		if(pl.t === 'charge'){
			if(Number.isFinite(pl.charge)) charge = Math.max(0, Math.min(NET.POWER_CHARGE.MAX, pl.charge));
			updateBar();
			return;
		}
		if(pl.t === 'powerAck'){
			if(Number.isFinite(pl.charge)) charge = Math.max(0, Math.min(NET.POWER_CHARGE.MAX, pl.charge));
			if(NET.validPowerKind(pl.kind)){
				const wait = Math.min(300000, Math.max(0, Number(pl.waitMs) || 0));
				powerWait[pl.kind] = nowMs() + (pl.ok ? wait : (pl.reason === 'cd' ? wait : 0));
				if(!pl.ok && pl.reason === 'charge') bridge.msg('👻 ' + NET.POWER_RULES[pl.kind].label + ': za mało energii ducha — bądź aktywny!');
				if(!pl.ok && pl.reason === 'perm') bridge.msg('👻 Gospodarz wyłączył wpływ na grę');
			}
			updateBar();
			return;
		}
		if(pl.t === 'assistant'){
			assistant = !!pl.on;
			bridge.msg(assistant ? '🛠 Gospodarz mianował cię ASYSTENTEM — możesz craftować i zarządzać ekwipunkiem' : '🛠 Nie jesteś już asystentem');
			renderAssist();
			return;
		}
		if(pl.t === 'assistState'){
			assistState = pl.data && typeof pl.data === 'object' ? pl.data : null;
			assistApproval = !!pl.approval;
			// identical ticks skip the DOM rebuild — the panel refreshes every 1.5 s
			// and most ticks change nothing under the assistant's cursor
			const sig = JSON.stringify(assistState) + '|' + (assistApproval ? 1 : 0);
			if(sig !== assistSig){ assistSig = sig; renderAssist(); }
			return;
		}
		if(pl.t === 'assistAck'){
			lastAssistAck = { ok: !!pl.ok, queued: !!pl.queued, reason: pl.reason || null, a: pl.a || null, at: nowMs() };
			if(pl.queued) bridge.msg('⏳ Propozycja wysłana — gospodarz musi ją zatwierdzić');
			else if(!pl.ok) bridge.msg('🛠 Nie udało się: ' + (pl.reason === 'cost' ? 'zabrakło surowców (ktoś był szybszy?)'
				: pl.reason === 'perm' ? 'brak uprawnień'
				: pl.reason === 'rate' ? 'za szybko — odczekaj chwilę'
				: pl.reason === 'full' ? 'kolejka propozycji jest pełna'
				: pl.reason === 'yours' ? 'masz już komplet propozycji w kolejce'
				: pl.reason || 'błąd'));
			return;
		}
		if(pl.t === 'assistDone'){
			lastAssistAck = { ok: !!pl.ok, done: true, reason: pl.reason || null, at: nowMs() };
			const what = typeof pl.label === 'string' ? pl.label.slice(0, 60) : 'propozycję';
			bridge.msg(pl.ok ? '✅ Gospodarz zatwierdził: ' + what
				: pl.reason === 'rejected' ? '🚫 Gospodarz odrzucił: ' + what
				: pl.reason === 'expired' ? '⌛ Propozycja wygasła: ' + what
				: '🛠 Nie udało się wykonać: ' + what);
			return;
		}
		queue.push(pl);
		// Overflow means the drain slept through a flood (e.g. intensive background
		// throttling). Tile diffs are CUMULATIVE — dropping any would desync the
		// world forever, so dump the backlog and ask for a fresh snapshot instead.
		if(queue.length > 1200){
			queue.length = 0;
			const t = nowMs();
			if(state === 'live' && t - lastSnapReq > 5000){ lastSnapReq = t; conn.send({ t: 'needSnap' }); }
		}
	}
	function applySnapshot(json){
		let data = null;
		try{ data = JSON.parse(json); }catch(e){ console.warn('ghost snapshot parse failed', e); return; }
		// an embodied guest keeps ITS hero across a resync: applyGameData rewrites the
		// player object with the HOST hero's saved state, which is the replica's job,
		// not ours — capture and re-apply our body afterwards
		const keep = (play.on && play.spawned) ? {
			x: bridge.player.x, y: bridge.player.y, vx: bridge.player.vx, vy: bridge.player.vy,
			facing: bridge.player.facing, hp: bridge.player.hp, maxHp: bridge.player.maxHp
		} : null;
		// a hero-mode guest owns its WHOLE player state — applyGameData is about to
		// overwrite inv/gear/XP with the HOST's save (the replica codec's job), so
		// capture ours and put it back right after
		const keepHero = (hero.on && bridge.ghostHeroCapture) ? bridge.ghostHeroCapture() : null;
		try{
			const ok = bridge.applyGameData(data, { ignoreCritical: true });
			if(!ok){ showVeil('Świat gospodarza nie dał się wczytać.'); return; }
		}catch(e){ console.warn('ghost snapshot apply failed', e); return; }
		if(keep) Object.assign(bridge.player, keep);
		if(keepHero && bridge.ghostHeroRestore) bridge.ghostHeroRestore(keepHero);
		stats.snapsApplied++;
		heroTarget.has = false;
		reconnects = 0; // a completed join proves the path — future blips get a fresh budget
		const wasLive = state === 'live';
		state = 'live';
		if(!wasLive){
			// the first join (and a post-reconnect re-base) parks the camera on the
			// hero — but a mid-session resync (needSnap recovery) must NOT yank a
			// free-flying spectator back; the world re-bases quietly under them
			cam.mode = 'follow';
			bridge.snapCameraToPlayer();
			bridge.msg('👁 Obserwujesz warstwę gracza ' + (hostName || '…') + ' — ' + (isTouchUi() ? 'przeciągnij palcem, aby latać duchem' : 'WASD/przeciąganie = lot ducha, F = podążaj, P = 📍 wskaż miejsce') + '. Twoja aktywność wzmacnia gracza!');
		}
		hideVeil();
		updateBar();
	}
	function drainQueue(){
		for(const pl of queue.splice(0)){
			try{
				if(pl.t === 'tiles' && Array.isArray(pl.d)){
					// a legit host caps a batch at 3000 cells (then resnaps); anything
					// wildly beyond that is hostile or corrupt — resync, don't freeze
					if(pl.d.length > 12000){
						const t = nowMs();
						if(t - lastSnapReq > 5000){ lastSnapReq = t; conn.send({ t: 'needSnap' }); }
						continue;
					}
					for(let i = 0; i + 2 < pl.d.length; i += 3){
						if(Number.isFinite(pl.d[i]) && Number.isFinite(pl.d[i + 1]) && Number.isFinite(pl.d[i + 2])) bridge.setTile(pl.d[i], pl.d[i + 1], pl.d[i + 2]);
					}
					stats.tileMsgs++; stats.tilesApplied += pl.d.length / 3;
				} else if(pl.t === 'hero'){
					if(!Number.isFinite(pl.x) || !Number.isFinite(pl.y)) continue; // NaN would poison the replica
					if(play.on || hero.on){
						// embodied: the host hero is a REMOTE body — its vitals must not
						// clobber our own (the local player carries OUR host-owned hp now)
						remoteHost.has = true;
						remoteHost.x = pl.x; remoteHost.y = pl.y;
						remoteHost.vx = Number.isFinite(pl.vx) ? pl.vx : 0; remoteHost.vy = Number.isFinite(pl.vy) ? pl.vy : 0;
						remoteHost.f = pl.f < 0 ? -1 : 1;
						continue;
					}
					heroTarget.x = pl.x; heroTarget.y = pl.y;
					heroTarget.vx = Number.isFinite(pl.vx) ? pl.vx : 0; heroTarget.vy = Number.isFinite(pl.vy) ? pl.vy : 0;
					heroTarget.at = nowMs(); heroTarget.has = true;
					const p = bridge.player;
					p.facing = pl.f < 0 ? -1 : 1;
					if(Number.isFinite(pl.hp)) p.hp = pl.hp;
					if(Number.isFinite(pl.mhp) && pl.mhp > 0) p.maxHp = pl.mhp;
					if(Number.isFinite(pl.en)) p.energy = pl.en;
				} else if(pl.t === 'pb' && Array.isArray(pl.list)){
					// embodied guests, everywhere: players see each other, spectators see
					// the players. Own row = authoritative echo (spawn seed + gross-drift
					// correction); other rows keep identity so the painter can glide.
					const seen = new Set();
					for(const row of pl.list.slice(0, 16)){
						if(!Array.isArray(row) || row.length < 10) continue;
						const [bgid, bname, bx, by, bvx, bvy, bf, bhp, bmhp, bdead] = row;
						if(!Number.isFinite(+bx) || !Number.isFinite(+by)) continue;
						if(bgid === gid){
							if(hero.on){
								// hero mode: the pb echo only SEEDS the spawn — the hero then
								// lives on the real local physics (no reconciliation: the host
								// clamp shapes only the creature-targeting shadow, not us)
								if(!hero.spawned){
									const p = bridge.player;
									p.x = +bx; p.y = +by; p.vx = 0; p.vy = 0;
									hero.spawned = true;
									bridge.snapCameraToPlayer();
								}
								continue;
							}
							if(play.on){
								const p = bridge.player;
								if(!play.spawned){
									p.x = +bx; p.y = +by; p.vx = 0; p.vy = 0;
									play.spawned = true;
									bridge.snapCameraToPlayer();
								} else {
									// reconciliation: the echo (row[10] = our pose seq) is compared
									// with the claim it ANSWERS. Genuine divergence — the envelope
									// clamped a claim, a resync moved us — corrects by the exact
									// offset; gross still snaps; a stale echo of a fast fall is NOT
									// divergence and no longer causes phantom snap-backs.
									const seq = (Number(row[10]) >>> 0) || 0;
									const pastIdx = seq ? poseLog.findIndex(e => e.seq === seq) : -1;
									if(pastIdx >= 0){
										const past = poseLog[pastIdx];
										// consume THROUGH the match: when pose uplinks stall (background
										// throttling) the host echoes the same seq every tick — a claim
										// left in the log would re-apply the same correction forever
										poseLog.splice(0, pastIdx + 1);
										const ex = +bx - past.x, ey = +by - past.y;
										const err = Math.hypot(ex, ey);
										if(err > 8){ p.x = +bx; p.y = +by; stats.poseSnaps = (stats.poseSnaps || 0) + 1; }
										else if(err > 0.25){
											// current+drift may land inside rock (the echo itself is
											// clamped claims = valid space) — embed means snap instead
											const nx = p.x + ex, ny = p.y + ey;
											if(bridge.solidAt(Math.floor(nx), Math.floor(ny), 'y')){ p.x = +bx; p.y = +by; stats.poseSnaps = (stats.poseSnaps || 0) + 1; }
											else { p.x = nx; p.y = ny; stats.poseFixes = (stats.poseFixes || 0) + 1; }
										}
									} else if(Math.hypot(p.x - bx, p.y - by) > 8){
										p.x = +bx; p.y = +by; // no matching claim (old host, rotated log): gross fallback
										stats.poseSnaps = (stats.poseSnaps || 0) + 1;
									}
								}
								play.dead = !!+bdead;
							}
							continue;
						}
						seen.add(bgid);
						let o = bodies.find(b => b.id === bgid);
						if(!o){ o = { id: bgid, x: +bx, y: +by }; bodies.push(o); }
						o.name = String(bname || 'Gracz').slice(0, 24);
						o.tx = +bx; o.ty = +by;
						o.vx = Number.isFinite(+bvx) ? +bvx : 0; o.vy = Number.isFinite(+bvy) ? +bvy : 0;
						o.f = +bf < 0 ? -1 : 1;
						o.hp = Number.isFinite(+bhp) ? +bhp : 1; o.maxHp = Number.isFinite(+bmhp) && +bmhp > 0 ? +bmhp : 1;
						o.dead = !!+bdead;
					}
					for(let i = bodies.length - 1; i >= 0; i--){ if(!seen.has(bodies[i].id)) bodies.splice(i, 1); }
				} else if(pl.t === 'mobs'){
					const M = MMR && MMR.mobs;
					if(M && M.ghostApplyRoster){
						if(M.ghostApplyRoster(pl)) stats.mobRosters++;
						else if(nowMs() - timers.needMobs > NEEDMOBS_MS){ timers.needMobs = nowMs(); conn.send({ t: 'needMobs' }); }
					}
				} else if(pl.t === 'mobsFull'){
					const M = MMR && MMR.mobs;
					if(M && M.deserialize && pl.data && typeof pl.data === 'object'){
						// deserialize validates each entry, but the list LENGTH is our job —
						// a million-mob payload must not stall the tab
						if(Array.isArray(pl.data.list) && pl.data.list.length > 600) pl.data.list.length = 600;
						M.deserialize(pl.data);
						stats.mobFulls++;
					}
				} else if(pl.t === 'inv'){
					// live invasion poses; a signature mismatch just waits for the next
					// full sync (the host resends one every few seconds anyway)
					const I = MMR && MMR.invasions;
					if(I && I.ghostApplyRoster && I.ghostApplyRoster(pl)) stats.invRosters++;
				} else if(pl.t === 'invFull'){
					const I = MMR && MMR.invasions;
					if(I && I.restore && pl.data && typeof pl.data === 'object'){
						if(Array.isArray(pl.data.teams) && pl.data.teams.length > 24) pl.data.teams.length = 24;
						I.restore(pl.data);
						stats.invFulls++;
					}
				} else if(pl.t === 'guard'){
					// the guardian arena mirror: bosses, sidekicks, hazards — inert
					// puppets only (ghostApplyMirror bounds and sanitizes the payload)
					const G = MMR && MMR.guardianLairs;
					if(G && G.ghostApplyMirror && G.ghostApplyMirror(pl.data || null)) stats.guard++;
				} else if(pl.t === 'wfx'){
					// the hero's swings, arrows, streams and blasts — cosmetic only
					const W = MMR && MMR.weapons;
					if(W && W.ghostApplyFx && W.ghostApplyFx(pl.fx || {})) stats.wfx++;
				} else if(pl.t === 'drops'){
					bridge.restoreDrops(pl.data);
				} else if(pl.t === 'seasons'){
					bridge.restoreSeasons(pl.data);
				} else if(pl.t === 'infra'){
					if(pl.data) bridge.restoreInfra(pl.data);
					if(pl.bg) bridge.restoreConstructionBackground(pl.bg);
				} else if(pl.t === 'ghosts' && Array.isArray(pl.list)){
					// the host self-reports a backgrounded tab (sim frozen, pump-only
					// stream): show the "host inactive" banner instead of a frozen world
					hostIdle = !!pl.idle;
					updateStaleBanner();
					// keep object identity per gid so the painter can glide, not teleport
					const seen = new Set();
					for(const g of pl.list.slice(0, 16)){
						if(!g || g.id === gid || !Number.isFinite(g.x) || !Number.isFinite(g.y)) continue;
						seen.add(g.id);
						let o = others.find(v => v.id === g.id);
						if(!o){ o = { id: g.id, x: g.x, y: g.y, chat: null }; others.push(o); }
						o.name = String(g.name || 'Duch').slice(0, 24);
						o.avatar = NET.validAvatar(g.a) ? g.a : 'duszek';
						o.act = !!g.act;
						o.tx = g.x; o.ty = g.y;
					}
					for(let i = others.length - 1; i >= 0; i--){ if(!seen.has(others[i].id)) others.splice(i, 1); }
					// "W tłumie": read straight off the host's presence relay, so it is
					// still the host's word — just observed here instead of minted there
					if(others.length >= 3 && !prog.counts.crowd) bankDeeds([{ k: 'crowd', n: 1 }], { day: today() });
					updateBar();
				} else if(pl.t === 'chat'){
					const name = String(pl.name || 'Duch').slice(0, 24);
					const text = NET.filterChat(pl.text).text; // defense in depth — the host already filtered
					if(text){
						bridge.msg('💬 ' + name + ': ' + text);
						const o = others.find(v => v.id === pl.gid);
						if(o) o.chat = { text, until: nowMs() + 6000 };
						else if(pl.gid === gid) selfChat = { text, until: nowMs() + 6000 };
					}
				} else if(pl.t === 'hostChat'){
					const text = NET.filterChat(pl.text).text; // defense in depth — the host filters its own words too
					if(text){
						hostChat = { text, until: nowMs() + 6000 };
						bridge.msg('💬 ' + (hostName || 'Gospodarz') + ': ' + text);
					}
				} else if(pl.t === 'ping'){
					if(Number.isFinite(pl.x) && Number.isFinite(pl.y)){
						pings.push({ x: pl.x, y: pl.y, name: String(pl.name || 'Duch').slice(0, 24), t: nowMs() });
						if(pings.length > 8) pings.shift();
						if(pl.gid !== gid) bridge.msg('📍 ' + String(pl.name || 'Duch').slice(0, 24) + ' wskazuje miejsce');
					}
				} else if(pl.t === 'powerFx' && NET.validPowerKind(pl.kind)){
					if(Number.isFinite(pl.x) && Number.isFinite(pl.y)){
						powerFx.push({ x: pl.x, y: pl.y, kind: pl.kind, t: nowMs() });
						if(powerFx.length > 12) powerFx.shift();
						try{ if(MMR && MMR.particles && MMR.particles.spawnBurst) MMR.particles.spawnBurst(pl.x, pl.y, pl.kind === 'smite' ? 'legendary' : 'epic', {}); }catch(e){ /* fine */ }
					}
					const r = NET.POWER_RULES[pl.kind];
					bridge.msg('👻 ' + String(pl.name || 'Duch').slice(0, 24) + ': ' + r.icon + ' ' + r.label + (pl.hits ? ' — ' + (pl.hits | 0) + ' celów!' : ''));
				} else if(pl.t === 'fx' && NET.validBuffKind(pl.kind)){
					// validBuffKind also guards the BUFF_RULES lookup against '__proto__' keys
					stats.fx++;
					const p = bridge.player;
					try{ if(MMR && MMR.particles && MMR.particles.spawnBurst) MMR.particles.spawnBurst(p.x + p.w / 2, p.y + p.h / 2, pl.kind === 'cheer' ? 'rare' : 'epic', {}); }catch(e){ /* fine */ }
					bridge.msg('👻 ' + String(pl.name || 'Duch').slice(0, 24) + ': ' + NET.BUFF_RULES[pl.kind].label + '!');
				}
			}catch(e){ /* one bad message must not stall the stream */ }
		}
	}

	// --- per-frame (called from the main loop instead of the sim, and from the
	// background pump — the pump only does network upkeep while rAF is alive,
	// so it can't double-step the interpolation or the cosmetics) -----------------
	function frame(dt, ts, fromPump){
		const t = nowMs();
		if(!fromPump) lastRafAt = t;
		const rafAlive = fromPump && (t - lastRafAt) < 1500;
		updateStaleBanner();
		if(state === 'connect' || state === 'sync'){
			if(t - timers.hello > HELLO_MS){ timers.hello = t; sendHello(); }
			// a join that never lands gets an honest verdict + retry, not an eternal
			// spinner — STUN-only P2P legitimately fails on some networks (no TURN)
			if(state === 'connect' && !connectFailShown && bootAt > 0 && t - bootAt > 25000){
				connectFailShown = true;
				showVeil('Nie można połączyć się z gospodarzem 😞<br><small>Transmisja mogła się skończyć, albo sieć blokuje bezpośrednie połączenia (restrykcyjny NAT — pomaga inna sieć/hotspot).</small><br>'
					+ '<button id="gvRetry" style="margin-top:10px;border:none;border-radius:8px;background:#21a366;color:#fff;font-weight:700;padding:8px 14px;cursor:pointer;">🔄 Spróbuj ponownie</button>');
				const btn = veil && veil.querySelector('#gvRetry');
				if(btn) btn.addEventListener('click', () => { try{ location.reload(); }catch(e){ /* fine */ } });
			}
			// a wedged or lost snapshot transfer must not strand the watcher —
			// after 15 s of sync we ask the host to restart it (host rate-limits)
			if(state === 'sync' && t - syncSince > 15000 && t - lastSnapReq > 5000){
				lastSnapReq = t;
				conn.send({ t: 'needSnap' });
			}
			if(state === 'connect') return;
		}
		drainQueue();
		if(state !== 'live') return;
		if(!rafAlive){
		const p = bridge.player;
		// EMBODIED: the local player is OUR hero — simulate it; the host hero glides
		// in remoteHost (eased at paint time). Otherwise: the replica interpolation.
		if(hero.on){
			// hero mode: main.js runs the REAL hero frame (runHeroStep) right after
			// this function — nothing to simulate here, and the replica interpolation
			// below must not fight the local physics for the player object
		} else if(play.on && play.spawned){
			if(!play.dead) stepOwnHero(dt);
			// decay the mirrored status chips (display state — burnDamage is discarded)
			try{ if(MMR && MMR.heroStatus) MMR.heroStatus.update(dt, {}); }catch(e){ /* fine */ }
		} else if(heroTarget.has){
			// hero replica: short prediction toward the last pose, hard snap on teleports
			const age = Math.min(0.25, (t - heroTarget.at) / 1000);
			const gx = heroTarget.x + heroTarget.vx * age;
			const gy = heroTarget.y + heroTarget.vy * age;
			if(Math.abs(gx - p.x) > 6 || Math.abs(gy - p.y) > 6){ p.x = gx; p.y = gy; }
			else { const k = Math.min(1, dt * 10); p.x += (gx - p.x) * k; p.y += (gy - p.y) * k; }
			p.vx = heroTarget.vx; p.vy = heroTarget.vy; // drives the walk animation
		}
		try{ if(MMR && MMR.mobs && MMR.mobs.ghostLerp) MMR.mobs.ghostLerp(dt); }catch(e){ /* fine */ }
		// invaders glide between streamed poses, exactly like the mobs
		try{ if(MMR && MMR.invasions && MMR.invasions.ghostLerp) MMR.invasions.ghostLerp(dt); }catch(e){ /* fine */ }
		// guardian puppets glide and their animation clocks keep ticking
		try{ if(MMR && MMR.guardianLairs && MMR.guardianLairs.ghostLerp) MMR.guardianLairs.ghostLerp(dt); }catch(e){ /* fine */ }
		// the hero's arrows keep flying and his swing keeps decaying between packets
		try{ if(MMR && MMR.weapons && MMR.weapons.ghostStepFx) MMR.weapons.ghostStepFx(dt); }catch(e){ /* fine */ }
		// fog mirrors the host: the replica player position feeds the normal reveal
		try{ if(!hero.on) bridge.revealAround(); }catch(e){ /* fine */ }
		try{ if(!hero.on) bridge.stepCosmetics(dt); }catch(e){ /* fine */ }
		if(!hero.on) updateCamera(dt); // hero mode: solo camera-follow runs in the loop
		}
		if(hero.on && hero.spawned){
			// hero uplink: pose + CLAIMED vitals (guest-local truth, display/targeting
			// on the host side); a playing human is active by definition
			if(t - timersPlay.pose > NET.PLAY_RULES.POSE_MS){
				timersPlay.pose = t;
				const p = bridge.player;
				conn.send({ t: 'ppose', x: +p.x.toFixed(2), y: +p.y.toFixed(2), vx: +(p.vx || 0).toFixed(2), vy: +(p.vy || 0).toFixed(2), f: p.facing < 0 ? -1 : 1, act: 1, hp: +(p.hp || 0).toFixed(1), mhp: Math.max(1, Math.round(p.maxHp || 100)) });
			}
			saveHeroState(false); // trailing persistence rides the frame, throttled
		} else if(play.on && play.spawned){
			// embodied uplink: the body pose replaces the camera pose (the host uses
			// it for the body AND as this guest's tracked spot for pings/powers)
			if(t - timersPlay.pose > NET.PLAY_RULES.POSE_MS){
				timersPlay.pose = t;
				const p = bridge.player;
				poseSeq = (poseSeq + 1) >>> 0;
				poseLog.push({ seq: poseSeq, x: p.x, y: p.y });
				if(poseLog.length > 48) poseLog.shift();
				conn.send({ t: 'ppose', q: poseSeq, x: +p.x.toFixed(2), y: +p.y.toFixed(2), vx: +(p.vx || 0).toFixed(2), vy: +(p.vy || 0).toFixed(2), f: p.facing < 0 ? -1 : 1, act: isActive() ? 1 : 0 });
			}
			// hold-to-mine: keep re-sending the intent at the host's floor while the
			// button is down; the host owns the per-cell progress
			if(play.mineHold && !play.dead && t - timersPlay.mine > NET.PLAY_RULES.MINE_MS + 20){
				timersPlay.mine = t;
				const w = bridge.screenToWorld ? bridge.screenToWorld(play.mineHold.cx, play.mineHold.cy) : null;
				if(w && bridge.solidAt(Math.floor(w.x), Math.floor(w.y), 'y')) sendPlayAct('mine', w.x, w.y);
				else play.mineHold = null;
			}
		} else if(t - timers.pose > POSE_MS){
			timers.pose = t;
			const c = bridge.getCamCenter();
			conn.send({ t: 'pose', x: +c.x.toFixed(2), y: +c.y.toFixed(2), act: isActive() ? 1 : 0 });
		}
	}
	function updateCamera(dt){
		if(cam.mode === 'follow'){
			const p = bridge.player;
			const c = bridge.getCamCenter();
			const k = Math.min(1, dt * 6);
			bridge.setCamCenter(c.x + (p.x + p.w / 2 - c.x) * k, c.y + (p.y + p.h / 2 - c.y) * k);
			return;
		}
		let dx = 0, dy = 0;
		for(const key of held){ const v = PAN_KEYS[key]; if(v){ dx += v[0]; dy += v[1]; } }
		if(dx || dy){
			const zoom = Math.max(0.2, bridge.getZoom());
			const speed = 26 / zoom;
			const c = bridge.getCamCenter();
			bridge.setCamCenter(c.x + dx * speed * dt, c.y + dy * speed * dt);
		}
	}
	function setFollow(v){
		cam.mode = v ? 'follow' : 'free';
		updateBar();
	}
	function setCam(x, y){
		cam.mode = 'free';
		bridge.setCamCenter(x, y);
	}

	// --- buffs -----------------------------------------------------------------------
	function sendBuff(kind){
		if(state !== 'live' || !NET.validBuffKind(kind) || !NET.modeAllows(mode, 'full')) return false;
		noteInput();
		if((buffWait[kind] || 0) > nowMs()) return false;
		buffWait[kind] = nowMs() + 1500; // pessimistic lock until the ack lands
		conn.send({ t: 'buff', kind });
		updateBar();
		return true;
	}
	function noteBuffAck(pl){
		if(!NET.validBuffKind(pl.kind)) return;
		// clamp: an absurd waitMs must not lock the buttons for eternity
		const wait = Math.min(120000, Math.max(0, Number(pl.waitMs) || 0));
		buffWait[pl.kind] = nowMs() + wait;
		if(!pl.ok && wait > 1500) bridge.msg('👻 ' + NET.BUFF_RULES[pl.kind].label + ' — jeszcze ' + Math.ceil(wait / 1000) + ' s');
		updateBar();
	}

	// --- spirits: the watcher's own flying avatar + fellow watchers -----------------------
	// Two passes mirroring the host painter: 'body' runs before the hero replica is
	// drawn (spirits stay behind the player), 'text' runs over the creature layer
	// (names, bubbles, pings and blast rings stay readable). Spirits parked on the
	// hero — your own in follow mode, always — are DISPLAYED lifted above its head.
	let lastSpiritT = 0;
	function drawSpirits(ctx, TILE, pass){
		const painter = MMR && MMR.ghostHost && MMR.ghostHost.paintSpirit;
		if(!painter || state !== 'live') return;
		const wantBody = pass !== 'text';
		const wantText = pass !== 'body';
		const t = (typeof performance !== 'undefined') ? performance.now() : 0;
		const ease = Math.min(1, Math.max(0, (t - lastSpiritT) / 1000) * 9);
		lastSpiritT = t; // the second pass of a frame sees dt≈0 — no double-glide
		const p = bridge.player;
		const hx = p ? p.x : NaN, hy = p ? p.y : NaN;
		const tagPainter = MMR && MMR.ghostHost && MMR.ghostHost.paintBodyTag;
		// the host hero as a REMOTE body (embodied modes only — otherwise the local
		// player object is the replica and main.js draws it already)
		if((play.on || hero.on) && remoteHost.has){
			remoteHost.dx += (remoteHost.x - remoteHost.dx) * ease;
			remoteHost.dy += (remoteHost.y - remoteHost.dy) * ease;
			if(Math.abs(remoteHost.x - remoteHost.dx) > 6){ remoteHost.dx = remoteHost.x; remoteHost.dy = remoteHost.y; }
			if(wantBody && bridge.drawHeroAt) bridge.drawHeroAt({ x: remoteHost.dx, y: remoteHost.dy, vx: remoteHost.vx, vy: remoteHost.vy, facing: remoteHost.f });
			if(wantText && tagPainter) tagPainter(ctx, TILE, remoteHost.dx, remoteHost.dy, hostName || 'Gospodarz', null, null);
		}
		// fellow embodied players (visible to players AND plain spectators)
		for(const b of bodies){
			if(Number.isFinite(b.tx)){ b.x += (b.tx - b.x) * ease; b.y += (b.ty - b.y) * ease; }
			if(b.dead) continue; // their ghost spirit shows via the presence relay instead
			if(wantBody && bridge.drawHeroAt) bridge.drawHeroAt({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, facing: b.f, w: NET.PLAY_RULES.BODY_W, h: NET.PLAY_RULES.BODY_H, gid: b.id, look: looks[b.id] || null });
			if(wantText && tagPainter) tagPainter(ctx, TILE, b.x, b.y, b.name || 'Gracz', b, null);
		}
		for(const g of others){
			if(Number.isFinite(g.tx)){ g.x += (g.tx - g.x) * ease; g.y += (g.ty - g.y) * ease; }
			const lift = NET.spiritLift(g.x, g.y, hx, hy);
			if(wantBody) painter(ctx, TILE, g.x, g.y - lift, g.name, t, false, g.avatar, g.act, null, 'body');
			if(wantText) painter(ctx, TILE, g.x, g.y - lift, g.name, t, false, g.avatar, g.act, g.chat, 'text');
		}
		const c = bridge.getCamCenter();
		if(selfChat && selfChat.until < nowMs()) selfChat = null;
		if((play.on && play.spawned) || (hero.on && hero.spawned)){
			// embodied: no own spirit (main.js draws our hero), no dread ring (a body
			// is a physical presence, not a phantom) — just the mining progress ring
			if(wantText && play.progAt && play.prog > 0){
				ctx.save();
				ctx.globalAlpha = 0.85;
				ctx.strokeStyle = '#ffd76a';
				ctx.lineWidth = 3;
				ctx.beginPath();
				ctx.arc((play.progAt.x + 0.5) * TILE, (play.progAt.y + 0.5) * TILE, TILE * 0.42, -Math.PI / 2, -Math.PI / 2 + play.prog * Math.PI * 2);
				ctx.stroke();
				ctx.restore();
			}
			if(wantText && selfChat && selfChat.text && MMR && MMR.ghostHost && MMR.ghostHost.paintChatBubble){
				MMR.ghostHost.paintChatBubble(ctx, TILE, p.x, p.y - (p.h || 1) / 2 - 0.9, selfChat.text);
			}
		} else {
			// your own spirit rides the camera — dragging/WASD IS the ghost flying
			const selfLift = NET.spiritLift(c.x, c.y, hx, hy);
			if(wantBody){
				// dread ring: what your presence scares away right now (only while active);
				// anchored at the TRUE position — the lift is display-only, dread is not
				if(isActive()){
					ctx.save();
					ctx.globalAlpha = 0.10;
					ctx.strokeStyle = '#9fd6ff';
					ctx.lineWidth = 1.5;
					ctx.beginPath();
					ctx.arc(c.x * TILE, c.y * TILE, NET.DREAD.R * TILE, 0, Math.PI * 2);
					ctx.stroke();
					ctx.restore();
				}
				painter(ctx, TILE, c.x, c.y - selfLift, ghostName(), t, true, avatar, isActive(), null, 'body');
			}
			if(wantText) painter(ctx, TILE, c.x, c.y - selfLift, ghostName(), t, true, avatar, isActive(), selfChat, 'text');
		}
		if(!wantText) return;
		// the host's own words hover over its hero — the replica normally, the
		// remote body when this guest is embodied
		const bubble = MMR && MMR.ghostHost && MMR.ghostHost.paintChatBubble;
		if(hostChat && hostChat.until > nowMs() && bubble){
			if((play.on || hero.on) && remoteHost.has) bubble(ctx, TILE, remoteHost.dx, remoteHost.dy - 1.0, hostChat.text);
			else if(p) bubble(ctx, TILE, p.x, p.y - (p.h || 1) / 2 - 0.5, hostChat.text);
		}
		const now = nowMs();
		// pointed spots pulse for a few seconds
		for(let i = pings.length - 1; i >= 0; i--){
			const f = pings[i];
			const age = (now - f.t) / NET.PING.TTL_MS;
			if(age >= 1){ pings.splice(i, 1); continue; }
			ctx.save();
			ctx.globalAlpha = 0.85 * (1 - age * 0.6);
			ctx.strokeStyle = '#ffd76a';
			ctx.lineWidth = 2.5;
			ctx.beginPath();
			ctx.arc(f.x * TILE, f.y * TILE, TILE * (0.5 + (age * 2 % 1) * 0.9), 0, Math.PI * 2);
			ctx.stroke();
			ctx.font = 'bold ' + Math.max(8, TILE * 0.18) + 'px system-ui';
			ctx.textAlign = 'center';
			ctx.strokeStyle = 'rgba(6,12,20,0.85)';
			ctx.lineWidth = 3;
			ctx.fillStyle = '#ffd76a';
			ctx.strokeText('📍 ' + f.name, f.x * TILE, (f.y - 0.8) * TILE);
			ctx.fillText('📍 ' + f.name, f.x * TILE, (f.y - 0.8) * TILE);
			ctx.restore();
		}
		// power blasts fade out over ~600 ms
		for(let i = powerFx.length - 1; i >= 0; i--){
			const f = powerFx[i];
			const age = (now - f.t) / 600;
			if(age >= 1){ powerFx.splice(i, 1); continue; }
			const rule = NET.POWER_RULES[f.kind];
			ctx.save();
			ctx.globalAlpha = 0.55 * (1 - age);
			ctx.strokeStyle = f.kind === 'frost' ? '#9be8ff' : f.kind === 'smite' ? '#ffe9a8' : '#d9a8ff';
			ctx.lineWidth = 3;
			ctx.beginPath();
			ctx.arc(f.x * TILE, f.y * TILE, rule.r * TILE * (0.4 + age * 0.8), 0, Math.PI * 2);
			ctx.stroke();
			ctx.restore();
		}
	}
	let lastChatSentAt = 0;
	function sendChat(raw){
		if(state !== 'live' || mode === 'watch') return false;
		const res = NET.filterChat(raw);
		if(res.empty) return false;
		// mirror the host's per-peer floor: a message sent into it would be
		// silently dropped server-side, which read as "chat is broken" — refuse
		// locally and say why, keeping the typed text in the box
		const wait = lastChatSentAt + NET.CHAT.MIN_MS - nowMs();
		if(wait > 0){ bridge.msg('💬 Za szybko — odczekaj ' + Math.ceil(wait / 1000) + ' s'); return false; }
		lastChatSentAt = nowMs();
		conn.send({ t: 'chat', text: res.text });
		noteInput();
		return true;
	}
	// Powers strike at the SPIRIT's position — the host re-derives it from the last
	// pose, so the client cannot aim them anywhere it hasn't actually flown.
	function sendPower(kind){
		if(state !== 'live' || !NET.modeAllows(mode, 'full') || !NET.validPowerKind(kind)) return false;
		const rule = NET.POWER_RULES[kind];
		if(charge < rule.cost || (powerWait[kind] || 0) > nowMs()) return false;
		conn.send({ t: 'power', kind });
		noteInput();
		powerWait[kind] = nowMs() + 800; // optimistic lock until the ack lands
		updateBar();
		return true;
	}
	function sendAssist(action, id, n){
		if(state !== 'live' || !assistant || !NET.validAssistAction(action)) return false;
		conn.send({ t: 'assist', a: action, id: String(id).slice(0, 64), n: NET.clampCraftCount(n) });
		noteInput();
		return true;
	}
	// Pings carry no coordinates — the host stamps the marker at the pose it tracked
	// for this spirit, so where you FLEW is where you point.
	function sendPing(){
		if(state !== 'live' || mode === 'watch') return false;
		const t = nowMs();
		if(t - lastPingSentAt < NET.PING.MIN_MS) return false;
		lastPingSentAt = t;
		conn.send({ t: 'ping' });
		noteInput();
		updateBar();
		return true;
	}

	// --- play mode: the guest's own hero -------------------------------------------------
	function enterPlay(){
		if(play.on) return;
		play.on = true; play.spawned = false; play.dead = false;
		// the host hero leaves the local `player` (which becomes OUR body) and moves
		// into remoteHost, seeded from the replica so nothing blinks
		const p = bridge.player;
		remoteHost.has = true; remoteHost.x = p.x; remoteHost.y = p.y;
		remoteHost.dx = p.x; remoteHost.dy = p.y;
		remoteHost.vx = p.vx || 0; remoteHost.vy = p.vy || 0; remoteHost.f = p.facing || 1;
		cam.mode = 'follow';
		if(myLook && conn && state === 'live') conn.send({ t: 'plook', c: myLook }); // wear the saved color
		bridge.msg('🎮 Wcielenie! A/D = ruch, W/spacja = skok, LPM = kop (trzymaj) lub uderz, PPM = buduj (wybierz surowiec z sakwy). F = kamera.');
		renderPouch();
		updateBar();
	}
	function exitPlay(){
		if(!play.on) return;
		play.on = false; play.spawned = false; play.dead = false; play.mineHold = null;
		play.duelWith = null;
		remoteHost.has = false;
		// embodiment state must not leak into the NEXT embodiment: a lingering
		// mirrored `frozen` would stun the fresh body until decay, and stale pose
		// claims could mis-correct a fresh spawn
		poseLog.length = 0;
		try{ if(MMR && MMR.heroStatus && MMR.heroStatus.clearAll) MMR.heroStatus.clearAll(); }catch(e){ /* fine */ }
		// pure spectating resumes: the next hero packet re-bases the replica (the
		// >6-tile hard-snap in the interpolator absorbs the position jump)
		renderPouch();
		updateBar();
	}
	// Local hero physics: a compact mirror of the host's swept per-axis resolver,
	// driven by the guest's replicated world (bridge.solidAt). Guest-authoritative
	// by design — the host clamps the resulting pose inside a speed envelope and
	// owns everything that matters (vitals, edits), so divergence is cosmetic.
	function collideAxis(p, axis, prev){
		const w = (p.w || NET.PLAY_RULES.BODY_W) / 2, h = (p.h || NET.PLAY_RULES.BODY_H) / 2;
		const EPS = 1e-4;
		if(axis === 'x'){
			const moved = p.x - prev;
			const dir = moved > EPS ? 1 : moved < -EPS ? -1 : 0;
			if(!dir) return;
			const prevL = prev - w, prevR = prev + w;
			let target = p.x, hit = false;
			for(let y = Math.floor(p.y - h); y <= Math.floor(p.y + h); y++){
				for(let x = Math.floor(p.x - w); x <= Math.floor(p.x + w); x++){
					if(!bridge.solidAt(x, y, 'x')) continue;
					if(prevR > x + EPS && prevL < x + 1 - EPS) continue; // embedded before the move
					if(dir > 0){ const c = x - w - 0.001; if(!hit || c < target) target = c; hit = true; }
					else { const c = x + 1 + w + 0.001; if(!hit || c > target) target = c; hit = true; }
				}
			}
			if(hit){ p.x = target; p.vx = 0; }
		} else {
			const moved = p.y - prev;
			const dir = moved > EPS ? 1 : moved < -EPS ? -1 : 0;
			p.onGround = false;
			if(!dir){ if(bridge.solidAt(Math.floor(p.x), Math.floor(p.y + h + 0.05), 'y')) p.onGround = true; return; }
			const prevT = prev - h, prevB = prev + h;
			let target = p.y, hit = false, landed = false;
			for(let y = Math.floor(p.y - h); y <= Math.floor(p.y + h); y++){
				for(let x = Math.floor(p.x - w); x <= Math.floor(p.x + w); x++){
					if(!bridge.solidAt(x, y, 'y')) continue;
					if(prevB > y + EPS && prevT < y + 1 - EPS) continue;
					if(dir > 0){ const c = y - h - 0.001; if(!hit || c < target) target = c; hit = true; landed = true; }
					else { const c = y + 1 + h + 0.001; if(!hit || c > target) target = c; hit = true; }
				}
			}
			if(hit){ p.y = target; p.vy = 0; if(landed) p.onGround = true; }
		}
	}
	function stepOwnHero(dt){
		const p = bridge.player;
		// streamed statuses shape the FEEL locally (chill slows, frozen stops the
		// inputs) — the host separately refuses every intent while frozen, so a
		// rigged client that ignores this only walks, it cannot act
		let statusMult = 1;
		try{ statusMult = (MMR && MMR.heroStatus) ? MMR.heroStatus.moveMult() : 1; }catch(e){ statusMult = 1; }
		let dir = 0;
		if(held.has('a') || held.has('arrowleft')) dir -= 1;
		if(held.has('d') || held.has('arrowright')) dir += 1;
		if(statusMult <= 0) dir = 0;
		const wantJump = statusMult > 0 && (held.has('w') || held.has('arrowup') || held.has(' '));
		if(dir) p.facing = dir < 0 ? -1 : 1;
		const groundTile = bridge.getTile(Math.floor(p.x), Math.floor(p.y + (p.h || 0.95) / 2 + 0.1));
		const inWater = bridge.getTile(Math.floor(p.x), Math.floor(p.y)) === T.WATER;
		p.vx = applyHorizontalMovement(p.vx, dir, dt, (inWater ? 0.6 : 1) * Math.max(0.25, statusMult), MOVE, groundTile);
		if(inWater){
			p.vy += (wantJump ? -14 : 6) * dt;
			p.vy = Math.max(-4, Math.min(4, p.vy));
			play.coyoteT = 0;
		} else {
			p.vy += MOVE.GRAV * dt;
			if(p.vy > 20) p.vy = 20;
			play.coyoteT = p.onGround ? 0.12 : Math.max(0, play.coyoteT - dt);
			play.jumpBufT = wantJump ? 0.12 : Math.max(0, play.jumpBufT - dt);
			if(play.jumpBufT > 0 && play.coyoteT > 0){ p.vy = MOVE.JUMP; p.onGround = false; play.coyoteT = 0; play.jumpBufT = 0; }
		}
		let remaining = Math.min(0.25, dt);
		while(remaining > 0){
			const step = Math.min(1 / 60, remaining);
			remaining -= step;
			const prevX = p.x; p.x += p.vx * step; collideAxis(p, 'x', prevX);
			const prevY = p.y; p.y += p.vy * step; collideAxis(p, 'y', prevY);
		}
	}
	// Intents: the guest DECIDES nothing about the world — it points. Reach, rate,
	// pouch and world truth are all re-checked by the host before a tile changes.
	function sendPlayAct(a, wx, wy, key){
		if(state !== 'live' || !play.on || !play.spawned || play.dead) return false;
		// weapons and pickups aim at world floats (an arrow needs a direction, a drop
		// a point — not a cell); tile intents stay integer cells
		const pl = (a === 'attack' || a === 'pickup')
			? { t: 'pact', a, x: +Number(wx).toFixed(1), y: +Number(wy).toFixed(1) }
			: { t: 'pact', a, x: Math.floor(wx), y: Math.floor(wy) };
		if(key) pl.key = key;
		conn.send(pl);
		noteInput();
		return true;
	}
	// Duels are CONSENT: this only registers/accepts a challenge — the host starts
	// the duel exclusively on a mutual handshake and resolves every blow itself.
	function sendDuel(targetGid){
		if(state !== 'live' || !play.on || !play.spawned || play.dead) return false;
		if(typeof targetGid !== 'string' || !targetGid) return false;
		conn.send({ t: 'pact', a: 'duel', gid: targetGid });
		noteInput();
		return true;
	}
	function playPointerAct(clientX, clientY, button){
		const w = bridge.screenToWorld ? bridge.screenToWorld(clientX, clientY) : null;
		if(!w) return;
		if(button === 2){
			if(!play.sel){ bridge.msg('🎒 Wybierz surowiec z sakwy (kliknij żeton), by budować'); return; }
			sendPlayAct('place', w.x, w.y, play.sel);
			return;
		}
		// LMB on a ground drop scoops it into the pouch (client-side probe on the
		// replicated drops plane is only ROUTING — the host re-validates everything)
		try{
			const D = MMR && MMR.drops;
			const hov = D && D.hoverAt ? D.hoverAt(w.x, w.y, bridge.player, {}) : null;
			if(hov && hov.kind === 'resource'){ sendPlayAct('pickup', w.x, w.y); return; }
		}catch(e){ /* fall through to mining/attacking */ }
		// LMB: solid target = start mining hold; open air = swing/shoot the ARMED weapon
		if(bridge.solidAt(Math.floor(w.x), Math.floor(w.y), 'y')){
			play.mineHold = { cx: clientX, cy: clientY };
			sendPlayAct('mine', w.x, w.y);
			timersPlay.mine = nowMs();
		} else {
			sendPlayAct('attack', w.x, w.y, play.arm || 'fists');
		}
	}
	// --- input ownership: watchers must not reach the game's handlers ---------------------
	function ownInput(){
		if(typeof window === 'undefined') return;
		const isOurs = (e) => e.target && e.target.closest && e.target.closest('#ghostBar, #ghostVeil');
		window.addEventListener('keydown', (e) => {
			if(!MMR || !MMR.ghostMode) return;
			noteInput(); // any real keystroke keeps this watcher "active" for the boosts
			if(hero.on) return; // hero mode: the REAL game handlers own every key
			if(e.ctrlKey || e.metaKey || e.altKey) return; // browser shortcuts stay browser shortcuts
			if(isOurs(e)) return;
			const k = (e.key || '').toLowerCase();
			if(play.on && play.spawned && (PAN_KEYS[k] || k === ' ')){
				// embodied: WASD/arrows/space DRIVE THE HERO — the camera follows it
				held.add(k);
				e.preventDefault();
			}
			else if(PAN_KEYS[k]){ held.add(k); if(cam.mode === 'follow') setFollow(false); e.preventDefault(); }
			else if(k === 'f'){ setFollow(cam.mode !== 'follow'); e.preventDefault(); }
			else if(k === 'p'){ sendPing(); e.preventDefault(); }
			else if(k === '+' || k === '=' || k === ']'){ bridge && bridge.nudgeZoom(1.1); e.preventDefault(); }
			else if(k === '-' || k === '['){ bridge && bridge.nudgeZoom(1 / 1.1); e.preventDefault(); }
			e.stopImmediatePropagation();
		}, true);
		window.addEventListener('keyup', (e) => {
			if(!MMR || !MMR.ghostMode) return;
			held.delete((e.key || '').toLowerCase());
			if(hero.on) return; // hero mode: keys belong to the game
			if(!isOurs(e)) e.stopImmediatePropagation();
		}, true);
		const swallowPointer = (e) => {
			if(!MMR || !MMR.ghostMode) return;
			if(e.type === 'pointerdown' || e.type === 'mousedown') noteInput();
			if(hero.on) return; // hero mode: the pointer works the world through the real handlers
			if(isOurs(e)) return;
			const onCanvas = e.target && e.target.id === 'game';
			// embodied: the pointer WORKS the world (mine/strike/place) instead of
			// dragging the camera — the camera lives on the hero now
			if(play.on && play.spawned && onCanvas && bridge){
				if(e.type === 'pointerdown'){
					playPointerAct(e.clientX, e.clientY, e.button === 2 ? 2 : 0);
				} else if(e.type === 'pointermove' && play.mineHold){
					play.mineHold.cx = e.clientX; play.mineHold.cy = e.clientY;
				} else if(e.type === 'pointerup' || e.type === 'pointercancel'){
					play.mineHold = null;
				}
				if(e.type === 'contextmenu') e.preventDefault();
				e.stopImmediatePropagation();
				return;
			}
			if(e.type === 'pointerdown' && onCanvas){
				const c = bridge ? bridge.getCamCenter() : null;
				if(c){ drag = { px: e.clientX, py: e.clientY, cx: c.x, cy: c.y }; if(cam.mode === 'follow') setFollow(false); }
			} else if(e.type === 'pointermove' && drag && bridge){
				const zoom = Math.max(0.2, bridge.getZoom());
				const TILE = (MMR && MMR.TILE) || 16;
				bridge.setCamCenter(drag.cx - (e.clientX - drag.px) / (TILE * zoom), drag.cy - (e.clientY - drag.py) / (TILE * zoom));
			} else if(e.type === 'pointerup' || e.type === 'pointercancel'){
				drag = null;
			}
			if(onCanvas || drag) e.stopImmediatePropagation();
			if(e.type === 'contextmenu' && onCanvas) e.preventDefault();
		};
		for(const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'contextmenu']){
			window.addEventListener(type, swallowPointer, true);
		}
		window.addEventListener('wheel', () => { if(MMR && MMR.ghostMode) noteInput(); }, { capture: true, passive: true });
	}

	// --- UI -------------------------------------------------------------------------------
	function injectCss(){
		const st = document.createElement('style');
		// hero mode (full-game guest) gets the REAL UI back: the hide rule excludes
		// .mmGhostHero, so hotbar/craft/weapons/controls behave exactly like solo —
		// only #menuWrap (host-side moderation/pause chrome) stays hidden for guests
		st.textContent = 'body.mmGhostMode:not(.mmGhostHero) #hotbarWrap, body.mmGhostMode:not(.mmGhostHero) #weaponBar, body.mmGhostMode:not(.mmGhostHero) #craft,'
			+ 'body.mmGhostMode:not(.mmGhostHero) #craftTracker, body.mmGhostMode:not(.mmGhostHero) #cornerCards, body.mmGhostMode:not(.mmGhostHero) #radarBtn,'
			+ 'body.mmGhostMode:not(.mmGhostHero) #fireBtn, body.mmGhostMode:not(.mmGhostHero) #ultBtn, body.mmGhostMode:not(.mmGhostHero) #controls,'
			+ 'body.mmGhostMode:not(.mmGhostHero) #dirRing, body.mmGhostMode #menuWrap, body.mmGhostMode:not(.mmGhostHero) #help,'
			+ 'body.mmGhostMode:not(.mmGhostHero) #hoverInfo, body.mmGhostMode:not(.mmGhostHero) #hudTip { display:none !important; }'
			+ '#ghostBar{ position:fixed; left:50%; bottom:12px; transform:translateX(-50%); z-index:140; display:flex; align-items:center; gap:8px;'
			+ ' padding:8px 12px; border-radius:14px; border:1px solid rgba(140,190,255,.4); background:rgba(10,15,24,.92); color:#dcebff;'
			+ ' font:12px system-ui; box-shadow:0 8px 26px rgba(0,0,0,.55); pointer-events:auto; flex-wrap:wrap; justify-content:center; max-width:calc(100vw - 20px); }'
			+ '#ghostBar .gbTag{ font-weight:800; color:#8fc7ff; white-space:nowrap; }'
			+ '#ghostBar .gbInfo{ color:#9db4cc; white-space:nowrap; }'
			+ '#ghostBar button{ border:none; border-radius:9px; padding:6px 10px; font-weight:700; font-size:11.5px; cursor:pointer; background:rgba(255,255,255,.12); color:#e6f0fb; }'
			+ '#ghostBar button:hover:not(:disabled){ background:rgba(255,255,255,.22); }'
			+ '#ghostBar button:disabled{ opacity:.45; cursor:default; }'
			+ '#ghostBar button.gbBuff{ background:rgba(44,126,248,.35); }'
			+ '#ghostBar button.gbFollow.on{ background:rgba(33,163,102,.5); }'
			+ '#ghostBar button.gbLeave{ background:rgba(196,50,50,.4); }'
			+ '#ghostBar .gbActivity{ font-weight:800; font-size:11px; color:#ffe9a8; white-space:nowrap; }'
			+ '#ghostBar .gbCharge{ font-weight:800; font-size:11px; color:#c9a8ff; white-space:nowrap; }'
			+ '#ghostBar button.gbPower{ background:rgba(150,80,220,.4); }'
			+ '#ghostBar #gbAssist{ background:rgba(255,184,74,.4); }'
			+ '#ghostBar #gbChat{ width:min(180px,34vw); background:rgba(20,26,36,.92); border:1px solid rgba(255,255,255,.2); border-radius:9px; color:#e6f0fb; padding:6px 8px; font-size:11.5px; outline:none; }'
			+ '#ghostBar #gbChat:focus{ border-color:#58a6ff; }'
			+ '#ghostBar #gbAvatarRow{ align-items:center; }'
			+ '#ghostBar #gbAvatarRow button{ padding:4px 6px; font-size:14px; }'
			+ '#ghostBar #gbAvatar{ font-size:14px; padding:5px 8px; }'
			+ '#ghostBar #gbRank{ display:flex; flex-direction:column; gap:2px; min-width:104px; cursor:pointer; }'
			+ '#ghostBar #gbRank .gbRankLine{ font-weight:800; font-size:11px; white-space:nowrap; }'
			+ '#ghostBar #gbRank .gbXpBar{ height:4px; border-radius:99px; background:rgba(255,255,255,.14); overflow:hidden; }'
			+ '#ghostBar #gbRank .gbXpFill{ height:100%; border-radius:99px; transition:width .35s ease; }'
			+ '#ghostProg{ position:fixed; right:12px; top:56px; z-index:150; width:min(340px,calc(100vw - 24px)); max-height:min(74vh,600px); overflow:auto;'
			+ ' display:none; flex-direction:column; gap:8px; padding:12px 13px; border-radius:14px; border:1px solid rgba(140,190,255,.4);'
			+ ' background:rgba(12,17,26,.96); color:#eef4fb; font:12px system-ui; box-shadow:0 12px 32px rgba(0,0,0,.6); pointer-events:auto; }'
			+ '#ghostProg .gpAch{ display:flex; gap:8px; align-items:center; border-top:1px solid rgba(255,255,255,.08); padding:5px 0; }'
			+ '#ghostProg .gpAch.locked{ opacity:.5; }'
			+ '#ghostProg .gpIcon{ font-size:16px; width:22px; text-align:center; }'
			+ '#ghostProg .gpName{ flex:1; min-width:0; }'
			+ '#ghostProg .gpName b{ display:block; font-size:11.5px; }'
			+ '#ghostProg .gpName span{ font-size:10px; color:#9fb2c6; }'
			+ '#ghostProg .gpTick{ font-size:10px; font-weight:800; white-space:nowrap; color:#9fd6ae; }'
			+ '#ghostVeil{ position:fixed; inset:0; z-index:290; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px;'
			+ ' background:radial-gradient(ellipse at 50% 40%, rgba(14,20,34,.92), rgba(4,7,13,.98)); color:#dcebff; font:14px system-ui; text-align:center; pointer-events:auto; }'
			+ '#ghostVeil .gvIcon{ font-size:44px; animation:gvFloat 2.6s ease-in-out infinite; }'
			+ '#ghostVeil .gvText{ line-height:1.6; max-width:min(440px,86vw); }'
			+ '@keyframes gvFloat{ 0%,100%{ transform:translateY(0); opacity:.75; } 50%{ transform:translateY(-9px); opacity:1; } }';
		document.head.appendChild(st);
	}
	// A frozen world deserves an explanation: this banner shows while the HOST tab is
	// backgrounded (self-reported via the presence plane) or while the stream itself
	// has gone quiet past the pump cadence — a silently dying channel, before the
	// transport-level connLost recovery kicks in.
	function updateStaleBanner(){
		if(typeof document === 'undefined') return;
		const stale = state === 'live' && (hostIdle || (lastHostMsgAt > 0 && nowMs() - lastHostMsgAt > 8000));
		if(stale && !staleBanner){
			staleBanner = document.createElement('div');
			staleBanner.id = 'ghostStale';
			staleBanner.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:10001;'
				+ 'background:rgba(30,24,10,.92);border:1px solid rgba(255,196,0,.5);border-radius:10px;color:#ffd76a;'
				+ 'padding:7px 14px;font:700 12px system-ui;pointer-events:none;';
			staleBanner.textContent = '⏸ Gospodarz jest nieaktywny — świat wstrzymany (karta gospodarza w tle)';
			document.body.appendChild(staleBanner);
		}
		if(staleBanner) staleBanner.style.display = stale ? 'block' : 'none';
	}
	function showVeil(html){
		if(!veil){
			veil = document.createElement('div');
			veil.id = 'ghostVeil';
			veil.innerHTML = '<div class="gvIcon">👻</div><div class="gvText"></div>';
			document.body.appendChild(veil);
		}
		veil.style.display = 'flex';
		veil.querySelector('.gvText').innerHTML = html;
	}
	function hideVeil(){ if(veil) veil.style.display = 'none'; }
	const AVATAR_ICONS = { duszek: '👻', iskra: '✨', gwiazdka: '⭐', kotek: '🐱', sowa: '🦉', orbita: '🪐' };
	function isTouchUi(){
		try{ return document.documentElement.getAttribute('data-input-mode') === 'touch'; }catch(e){ return false; }
	}
	function buildBar(){
		if(bar) return;
		bar = document.createElement('div');
		bar.id = 'ghostBar';
		bar.innerHTML = '<span class="gbTag">👁 Duch Warstwy</span><span class="gbInfo" id="gbInfo"></span>'
			+ '<span id="gbRank" title="Twoja kariera ducha — kliknij, by zobaczyć osiągnięcia"><span class="gbRankLine"></span><span class="gbXpBar"><span class="gbXpFill"></span></span></span>'
			+ '<span class="gbActivity" id="gbActivity" title="Aktywni widzowie wzmacniają gracza (+XP, szybkość, skok, obrażenia). Bezczynność >30 s wyłącza wzmocnienie."></span>'
			+ '<button id="gbAvatar" title="Zmień awatara"></button>'
			+ '<span id="gbAvatarRow" style="display:none;gap:3px;"></span>'
			+ '<input id="gbChat" maxlength="90" placeholder="Napisz coś… [Enter]" autocomplete="off">'
			+ '<button class="gbBuff" data-kind="cheer">✨ Doping</button>'
			+ '<button class="gbBuff" data-kind="bless">💚 Błogosławieństwo</button>'
			+ '<button class="gbBuff" data-kind="energy">⚡ Energia</button>'
			+ '<span class="gbCharge" id="gbCharge" title="Energia ducha rośnie, gdy jesteś aktywny — wydajesz ją na moce"></span>'
			+ '<button class="gbPower" data-kind="banish">💀 Popłoch</button>'
			+ '<button class="gbPower" data-kind="frost">❄️ Mróz</button>'
			+ '<button class="gbPower" data-kind="smite">⚡ Grom</button>'
			+ '<span id="gbArms" style="display:none;align-items:center;gap:3px;"></span>'
			+ '<span id="gbCraft" style="display:none;align-items:center;gap:3px;"></span>'
			+ '<button id="gbDuel" style="display:none;" title="Wyzwij najbliższego gracza na pojedynek (zaczyna się dopiero, gdy oboje się zgodzą)">⚔ Pojedynek</button>'
			+ '<button id="gbLook" style="display:none;" title="Kolor twojego stroju (widzą go wszyscy)">🎨</button>'
			+ '<span id="gbLookRow" style="display:none;gap:3px;align-items:center;"></span>'
			+ '<span id="gbPouch" style="display:none;align-items:center;gap:3px;flex-wrap:wrap;"></span>'
			+ '<button id="gbPing">📍 Wskaż</button>'
			+ '<button id="gbAssist" style="display:none;">🛠 Asystent</button>'
			+ '<button id="gbZoomOut" title="Oddal">➖</button>'
			+ '<button id="gbZoomIn" title="Przybliż">➕</button>'
			+ '<button class="gbFollow on" id="gbFollow"></button>'
			+ '<button class="gbLeave" id="gbLeave">Opuść</button>';
		document.body.appendChild(bar);
		bar.querySelector('#gbRank').addEventListener('click', () => { noteInput(); toggleProgPanel(); });
		bar.querySelectorAll('.gbBuff').forEach(btn => btn.addEventListener('click', () => sendBuff(btn.dataset.kind)));
		bar.querySelectorAll('.gbPower').forEach(btn => btn.addEventListener('click', () => sendPower(btn.dataset.kind)));
		bar.querySelector('#gbPing').addEventListener('click', () => sendPing());
		bar.querySelector('#gbDuel').addEventListener('click', () => {
			noteInput();
			if(!bodies.length){ bridge.msg('⚔ Nie ma tu innego gracza'); return; }
			const p = bridge.player;
			let best = bodies[0], bd = Infinity;
			for(const b of bodies){ const d = Math.hypot(b.x - p.x, b.y - p.y); if(d < bd){ bd = d; best = b; } }
			sendDuel(best.id);
		});
		const lookRow = bar.querySelector('#gbLookRow');
		for(const col of ['#e5533d', '#f4a83a', '#ffd76a', '#5fce5f', '#39c6c0', '#5a8cff', '#a86cf5', '#f36cc0']){
			const sw = document.createElement('button');
			sw.style.cssText = 'width:16px;height:16px;border-radius:50%;border:1px solid rgba(255,255,255,.45);background:' + col + ';padding:0;cursor:pointer;';
			sw.title = col;
			sw.addEventListener('click', () => { setLook(col); lookRow.style.display = 'none'; });
			lookRow.appendChild(sw);
		}
		bar.querySelector('#gbLook').addEventListener('click', () => {
			noteInput();
			lookRow.style.display = lookRow.style.display === 'none' ? 'inline-flex' : 'none';
		});
		bar.querySelector('#gbAssist').addEventListener('click', () => { noteInput(); toggleAssistPanel(); });
		bar.querySelector('#gbFollow').addEventListener('click', () => { noteInput(); setFollow(cam.mode !== 'follow'); });
		bar.querySelector('#gbLeave').addEventListener('click', leave);
		bar.querySelector('#gbZoomIn').addEventListener('click', () => { noteInput(); bridge && bridge.nudgeZoom(1.15); });
		bar.querySelector('#gbZoomOut').addEventListener('click', () => { noteInput(); bridge && bridge.nudgeZoom(1 / 1.15); });
		const avatarBtn = bar.querySelector('#gbAvatar');
		const avatarRow = bar.querySelector('#gbAvatarRow');
		for(const a of NET.AVATARS){
			const b = document.createElement('button');
			b.textContent = AVATAR_ICONS[a] || '👻';
			b.title = a;
			b.addEventListener('click', () => { setAvatar(a); avatarRow.style.display = 'none'; });
			avatarRow.appendChild(b);
		}
		avatarBtn.addEventListener('click', () => {
			noteInput();
			avatarRow.style.display = avatarRow.style.display === 'none' ? 'inline-flex' : 'none';
		});
		const chat = bar.querySelector('#gbChat');
		chat.addEventListener('keydown', (e) => {
			noteInput();
			if(e.key === 'Enter'){
				if(sendChat(chat.value)) chat.value = '';
				e.preventDefault();
			}
			e.stopPropagation();
		});
		barTick = setInterval(updateBar, 500);
		updateBar();
	}
	// Weapon chips: the guest's host-owned arsenal. The armed kind is only what the
	// next LMB-in-air attack intent NAMES — ownership, cooldown and ammo stay host
	// truth, so clicking chips can never make an attack the host would refuse honor.
	function renderArms(){
		if(!bar) return;
		const box = bar.querySelector('#gbArms');
		if(!box) return;
		box.style.display = play.on ? 'inline-flex' : 'none';
		box.textContent = '';
		if(!play.on) return;
		for(const k of play.weapons.slice(0, 8)){
			const spec = (NET.PLAY_WEAPONS && Object.prototype.hasOwnProperty.call(NET.PLAY_WEAPONS, k)) ? NET.PLAY_WEAPONS[k] : null;
			const armed = play.arm === k;
			const chip = document.createElement('button');
			chip.style.cssText = 'border:1px solid ' + (armed ? '#7ad7ff' : 'rgba(255,255,255,.2)') + ';border-radius:999px;'
				+ 'background:' + (armed ? 'rgba(122,215,255,.25)' : 'rgba(255,255,255,.08)') + ';color:#e6f0fb;padding:3px 8px;font-size:10px;font-weight:700;white-space:nowrap;';
			const ammo = spec && spec.ammo ? ' ' + (play.pouch[spec.ammo] || 0) : '';
			chip.textContent = (spec ? spec.icon + ' ' + spec.label : k) + ammo;
			chip.title = armed ? 'W dłoni — LPM w powietrze atakuje' : 'Kliknij, by wziąć do ręki';
			chip.addEventListener('click', () => { noteInput(); play.arm = k; renderArms(); });
			box.appendChild(chip);
		}
	}
	// Craft chips: curated guest recipes (NET.PLAY_RECIPES). A chip only SENDS the
	// intent — costs are checked and spent host-side against the host-owned pouch,
	// so a rigged client can click all it wants and forge nothing.
	function renderCraft(){
		if(!bar) return;
		const box = bar.querySelector('#gbCraft');
		if(!box) return;
		box.style.display = play.on ? 'inline-flex' : 'none';
		box.textContent = '';
		if(!play.on) return;
		for(const key of Object.keys(NET.PLAY_RECIPES)){
			const r = NET.PLAY_RECIPES[key];
			if(r.weapon && play.weapons.includes(r.weapon)) continue; // already earned
			const afford = NET.pouchAfford(play.pouch, r.cost); // display-only mirror of the host check
			const chip = document.createElement('button');
			chip.style.cssText = 'border:1px dashed ' + (afford ? '#9be89b' : 'rgba(255,255,255,.18)') + ';border-radius:999px;'
				+ 'background:rgba(255,255,255,.06);color:' + (afford ? '#d9f7d9' : '#8195aa') + ';padding:3px 8px;font-size:10px;font-weight:700;white-space:nowrap;';
			chip.textContent = '🛠 ' + r.icon + ' ' + r.label;
			chip.title = 'Koszt: ' + Object.keys(r.cost).map(k => r.cost[k] + '× ' + (bridge.resourceLabel ? bridge.resourceLabel(k) : k)).join(', ')
				+ (afford ? ' — kliknij, by wykuć' : ' — brakuje surowców w sakwie');
			chip.addEventListener('click', () => { noteInput(); sendPlayAct('craft', 0, 0, key); });
			box.appendChild(chip);
		}
	}
	// Pouch chips: the guest's host-owned resources, click to arm one for building.
	function renderPouch(){
		if(!bar) return;
		const box = bar.querySelector('#gbPouch');
		if(!box) return;
		const keys = Object.keys(play.pouch).filter(k => play.pouch[k] > 0);
		box.style.display = play.on ? 'inline-flex' : 'none';
		box.textContent = '';
		if(!play.on) return;
		if(!keys.length){
			const hint = document.createElement('span');
			hint.style.cssText = 'font-size:10px;color:#9db4cc;white-space:nowrap;';
			hint.textContent = '🎒 sakwa pusta — wykop coś';
			box.appendChild(hint);
			return;
		}
		for(const k of keys.slice(0, 12)){
			const chip = document.createElement('button');
			const sel = play.sel === k;
			// food is EATEN on click (host validates + heals); everything else arms building
			const food = (NET.PLAY_FOODS && Object.prototype.hasOwnProperty.call(NET.PLAY_FOODS, k)) ? NET.PLAY_FOODS[k] : null;
			chip.style.cssText = 'border:1px solid ' + (sel ? '#ffd76a' : (food ? 'rgba(155,232,155,.4)' : 'rgba(255,255,255,.2)')) + ';border-radius:999px;'
				+ 'background:' + (sel ? 'rgba(255,215,106,.25)' : 'rgba(255,255,255,.08)') + ';color:#e6f0fb;padding:3px 8px;font-size:10px;font-weight:700;white-space:nowrap;';
			chip.textContent = (food ? food.icon + ' ' : '') + (bridge.resourceLabel ? bridge.resourceLabel(k) : k) + ' ' + play.pouch[k];
			chip.title = food ? 'Kliknij, by zjeść (+' + food.hp + ' HP)' : (sel ? 'Wybrany do budowania (PPM stawia)' : 'Kliknij, by budować tym surowcem');
			chip.addEventListener('click', () => {
				noteInput();
				if(food){ sendPlayAct('eat', 0, 0, k); return; }
				play.sel = sel ? null : k; renderPouch();
			});
			box.appendChild(chip);
		}
	}
	function updateBar(){
		flushProgress(); // the 500 ms bar tick doubles as the trailing-write driver
		if(!bar) return;
		const info = bar.querySelector('#gbInfo');
		info.textContent = (play.on ? '🎮 ' : '') + (hostName ? hostName : '…') + (others.length ? ' • duchy: ' + (others.length + 1) : '') + (bodies.length ? ' • gracze: ' + (bodies.length + (play.on ? 1 : 0)) : '');
		const lv = NET.levelFor(prog.xp);
		const rank = NET.rankFor(lv.level);
		const rankEl = bar.querySelector('#gbRank');
		rankEl.querySelector('.gbRankLine').textContent = '🏆 ' + lv.level + ' · ' + rank.name;
		rankEl.querySelector('.gbRankLine').style.color = rank.color;
		const fill = rankEl.querySelector('.gbXpFill');
		fill.style.width = (lv.need ? Math.round(100 * lv.into / lv.need) : 100) + '%';
		fill.style.background = rank.color;
		rankEl.title = lv.need
			? 'Poziom ' + lv.level + ' (' + rank.name + ') · ' + lv.into + '/' + lv.need + ' XP do awansu — kliknij po osiągnięcia'
			: 'Maksymalny poziom — kliknij po osiągnięcia';
		bar.querySelector('#gbActivity').textContent = isActive() ? '⚡ wzmacniasz' : '💤 rusz się!';
		bar.querySelector('#gbAvatar').textContent = AVATAR_ICONS[avatar] || '👻';
		const t = nowMs();
		renderPouch();
		renderArms();
		renderCraft();
		const duelBtn = bar.querySelector('#gbDuel');
		if(duelBtn){
			duelBtn.style.display = (play.on && bodies.length) ? 'inline-block' : 'none';
			duelBtn.textContent = play.duelWith ? '⚔ w pojedynku' : '⚔ Pojedynek';
		}
		const lookBtn = bar.querySelector('#gbLook');
		if(lookBtn){
			lookBtn.style.display = play.on ? 'inline-block' : 'none';
			lookBtn.style.background = myLook || '';
		}
		// in embodiment the bar is a PLAYER hud (pouch + hands), so the spectator
		// influence controls (blessings, powers) step aside to reduce clutter —
		// hero mode keeps only the session strip (chat, follow, leave)
		const spectatorControls = !play.on && !hero.on;
		bar.querySelectorAll('.gbBuff').forEach(btn => {
			const wait = (buffWait[btn.dataset.kind] || 0) - t;
			btn.style.display = spectatorControls ? 'inline-block' : 'none';
			btn.disabled = state !== 'live' || wait > 0 || !NET.modeAllows(mode, 'full');
			const rule = NET.BUFF_RULES[btn.dataset.kind];
			const base = btn.dataset.kind === 'cheer' ? '✨ Doping' : btn.dataset.kind === 'bless' ? '💚 Błogosławieństwo' : '⚡ Energia';
			btn.textContent = wait > 1000 ? base + ' (' + Math.ceil(wait / 1000) + 's)' : base;
			btn.title = !NET.modeAllows(mode, 'full') ? 'Gospodarz wyłączył wpływ na grę' : (rule ? rule.label : '');
		});
		// powers: charge is earned by staying active, then spent
		const canInfluence = NET.modeAllows(mode, 'full') && spectatorControls;
		bar.querySelector('#gbCharge').textContent = canInfluence ? '🔮 ' + Math.floor(charge) + '/' + NET.POWER_CHARGE.MAX : '';
		bar.querySelectorAll('.gbPower').forEach(btn => {
			const kind = btn.dataset.kind;
			const rule = NET.POWER_RULES[kind];
			const wait = (powerWait[kind] || 0) - t;
			const poor = charge < rule.cost;
			btn.style.display = canInfluence ? 'inline-block' : 'none';
			btn.disabled = state !== 'live' || wait > 0 || poor;
			btn.textContent = wait > 1000 ? rule.icon + ' ' + Math.ceil(wait / 1000) + 's' : rule.icon + ' ' + rule.label;
			btn.title = rule.label + ' — koszt ' + rule.cost + ' energii ducha, działa wokół twojego ducha' + (poor ? ' (za mało energii: bądź aktywny!)' : '');
		});
		const ping = bar.querySelector('#gbPing');
		ping.style.display = (mode === 'watch' || play.on) ? 'none' : 'inline-block';
		ping.disabled = state !== 'live' || nowMs() - lastPingSentAt < NET.PING.MIN_MS;
		ping.title = isTouchUi() ? 'Wskaż widzom i graczowi miejsce, nad którym unosi się twój duch'
			: 'Wskaż miejsce, nad którym unosi się twój duch [P]';
		const asst = bar.querySelector('#gbAssist');
		asst.style.display = assistant ? 'inline-block' : 'none';
		const chat = bar.querySelector('#gbChat');
		chat.style.display = mode === 'watch' ? 'none' : 'inline-block';
		chat.disabled = state !== 'live';
		const avatarBtn2 = bar.querySelector('#gbAvatar');
		if(avatarBtn2) avatarBtn2.style.display = play.on ? 'none' : 'inline-block';
		const fol = bar.querySelector('#gbFollow');
		fol.classList.toggle('on', cam.mode === 'follow');
		fol.textContent = isTouchUi()
			? (cam.mode === 'follow' ? '🎥 Podążam' : '🎥 Podążaj')
			: (cam.mode === 'follow' ? '🎥 Podążam [F]' : '🎥 Podążaj [F]');
		fol.title = play.on ? 'Kamera podąża za twoim bohaterem (F)'
			: isTouchUi() ? 'Przeciągnij po ekranie, aby latać duchem' : 'WASD/strzałki lub przeciąganie = lot ducha';
	}

	// --- trophy case: the watcher's level, rank and achievements ------------------------
	function toggleProgPanel(){
		if(!progPanel){
			progPanel = document.createElement('div');
			progPanel.id = 'ghostProg';
			document.body.appendChild(progPanel);
		}
		progPanel.style.display = (progPanel.style.display === 'none' || !progPanel.style.display) ? 'flex' : 'none';
		renderProgress();
	}
	function progStat(label, value){
		const row = document.createElement('div');
		row.style.cssText = 'display:flex;justify-content:space-between;gap:8px;font-size:11px;color:#9fb2c6;';
		const l = document.createElement('span'); l.textContent = label;
		const v = document.createElement('b'); v.style.color = '#dcebff'; v.textContent = value;
		row.append(l, v);
		return row;
	}
	function renderProgress(){
		const el = progPanel;
		if(!el || el.style.display === 'none') return;
		const lv = NET.levelFor(prog.xp);
		const rank = NET.rankFor(lv.level);
		const c = prog.counts || {};
		el.textContent = '';
		const head = document.createElement('div');
		head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
		const title = document.createElement('b');
		title.style.color = rank.color;
		title.textContent = '🏆 Poziom ' + lv.level + ' · ' + rank.name;
		const close = document.createElement('button');
		close.textContent = '×';
		close.style.cssText = 'border:none;background:rgba(255,255,255,.12);color:#fff;width:22px;height:22px;border-radius:7px;cursor:pointer;';
		close.addEventListener('click', () => { el.style.display = 'none'; });
		head.append(title, close);
		el.appendChild(head);
		const sub = document.createElement('div');
		sub.style.cssText = 'font-size:11px;color:#9fb2c6;line-height:1.45;';
		sub.textContent = lv.need
			? lv.into + ' / ' + lv.need + ' XP do następnego poziomu (łącznie ' + prog.xp + ' XP). Postępy zapisują się w tej przeglądarce — wrócisz linkiem i będą czekać.'
			: 'Maksymalny poziom osiągnięty (' + prog.xp + ' XP).';
		el.appendChild(sub);
		el.appendChild(progStat('Aktywna obserwacja', Math.round((c.watch || 0) * NET.PROG.WATCH_TICK_MS / 60000) + ' min'));
		el.appendChild(progStat('Błogosławieństwa', String((c.cheer || 0) + (c.bless || 0) + (c.energy || 0))));
		el.appendChild(progStat('Rzucone moce', String((c.banish || 0) + (c.frost || 0) + (c.smite || 0))));
		el.appendChild(progStat('Spłoszone stwory', String(c.spook || 0)));
		el.appendChild(progStat('Praca asystenta', String((c.craft || 0) + (c.equip || 0) + (c.unequip || 0))));
		el.appendChild(progStat('Dni z warstwami', String((prog.days || []).length)));
		const list = NET.achievementProgress(prog);
		const doneN = list.filter(a => a.done).length;
		const aHead = document.createElement('div');
		aHead.style.cssText = 'font-weight:800;color:#9fb2c6;font-size:10px;letter-spacing:.6px;text-transform:uppercase;margin-top:6px;';
		aHead.textContent = 'Osiągnięcia ' + doneN + '/' + list.length;
		el.appendChild(aHead);
		for(const a of list){
			const row = document.createElement('div');
			row.className = 'gpAch' + (a.done ? '' : ' locked');
			const icon = document.createElement('span');
			icon.className = 'gpIcon';
			icon.textContent = a.done ? a.def.icon : '🔒';
			const name = document.createElement('span');
			name.className = 'gpName';
			const b = document.createElement('b'); b.textContent = a.def.name;
			const d = document.createElement('span'); d.textContent = a.def.desc;
			name.append(b, d);
			const tick = document.createElement('span');
			tick.className = 'gpTick';
			tick.textContent = a.done ? '✔ +' + a.def.xp : a.have + '/' + a.need;
			row.append(icon, name, tick);
			el.appendChild(row);
		}
	}

	// --- assistant workbench: the player's own crafting & Ekwipunek view, remoted ---------
	// The skeleton (header, HP line, search box) is built ONCE and persists; only the
	// body rerenders on state ticks — otherwise every 1.5 s refresh would steal the
	// focus (and the letters) out of the search box mid-typing.
	let assistSearch = '';
	function ensureAssistPanel(){
		if(assistPanel || typeof document === 'undefined') return assistPanel;
		const el = document.createElement('div');
		el.id = 'ghostAssist';
		el.style.cssText = 'position:fixed; left:12px; top:56px; z-index:150; width:min(380px,calc(100vw - 24px)); max-height:min(76vh,640px); display:none; flex-direction:column; gap:8px;'
			+ ' padding:12px 13px; border-radius:14px; border:1px solid rgba(255,184,74,.45); background:rgba(12,17,26,.96); color:#eef4fb; font:12px system-ui;'
			+ ' box-shadow:0 12px 32px rgba(0,0,0,.6); pointer-events:auto;';
		const head = document.createElement('div');
		head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;';
		const title = document.createElement('b');
		title.textContent = '🛠 Warsztat asystenta';
		const approvalChip = document.createElement('span');
		approvalChip.id = 'gaApproval';
		approvalChip.style.cssText = 'display:none;font-size:10px;font-weight:800;color:#ffb84a;white-space:nowrap;';
		approvalChip.textContent = '⏳ gospodarz zatwierdza';
		const close = document.createElement('button');
		close.textContent = '×';
		close.style.cssText = 'border:none;background:rgba(255,255,255,.12);color:#fff;width:22px;height:22px;border-radius:7px;cursor:pointer;';
		close.addEventListener('click', () => { el.style.display = 'none'; });
		head.append(title, approvalChip, close);
		const vitals = document.createElement('div');
		vitals.id = 'gaVitals';
		vitals.style.cssText = 'color:#9fd6ae;font-size:11px;';
		const search = document.createElement('input');
		search.id = 'gaSearch';
		search.placeholder = 'Szukaj receptur, sprzętu, zasobów…';
		search.style.cssText = 'background:rgba(20,26,36,.92);border:1px solid rgba(255,255,255,.2);border-radius:9px;color:#e6f0fb;padding:6px 8px;font-size:11.5px;outline:none;';
		search.addEventListener('input', () => { assistSearch = search.value.trim().toLowerCase(); noteInput(); renderAssistBody(); });
		search.addEventListener('keydown', e => e.stopPropagation());
		const body = document.createElement('div');
		body.id = 'gaBody';
		body.style.cssText = 'display:flex;flex-direction:column;gap:6px;overflow-y:auto;overscroll-behavior:contain;min-height:0;';
		el.append(head, vitals, search, body);
		document.body.appendChild(el);
		assistPanel = el;
		return el;
	}
	function toggleAssistPanel(){
		const el = ensureAssistPanel();
		if(!el) return;
		el.style.display = el.style.display === 'none' || !el.style.display ? 'flex' : 'none';
		renderAssist();
	}
	function gaSection(box, label){
		const h = document.createElement('div');
		h.style.cssText = 'font-weight:800;color:#9fb2c6;font-size:10px;letter-spacing:.6px;text-transform:uppercase;margin-top:5px;';
		h.textContent = label;
		box.appendChild(h);
	}
	function gaMatches(text){ return !assistSearch || String(text).toLowerCase().includes(assistSearch); }
	function renderAssist(){
		updateBar();
		const el = assistPanel;
		if(!el || el.style.display === 'none') return;
		if(!assistant){ el.style.display = 'none'; return; }
		el.querySelector('#gaApproval').style.display = assistApproval ? 'inline' : 'none';
		el.querySelector('#gaVitals').textContent = assistState
			? 'Gracz: ' + assistState.hp + '/' + assistState.maxHp + ' HP · ⚡ ' + (assistState.en || 0) + '/' + (assistState.maxEn || 0)
			: 'Czekam na stan gracza…';
		renderAssistBody();
	}
	function renderAssistBody(){
		const el = assistPanel;
		if(!el || el.style.display === 'none') return;
		const box = el.querySelector('#gaBody');
		box.textContent = '';
		if(!assistState) return;
		// Recipes: favorites first, then the player's own group order — the assistant
		// reads the same catalogue the host's Rzemiosło panel shows
		const recipes = (Array.isArray(assistState.recipes) ? assistState.recipes : [])
			.filter(r => gaMatches((r.name || r.id) + ' ' + (r.g || '')));
		const groups = new Map();
		for(const r of recipes){
			const g = r.fav ? '★ Ulubione' : (r.g || 'Inne');
			if(!groups.has(g)) groups.set(g, []);
			groups.get(g).push(r);
		}
		const groupNames = [...groups.keys()].sort((a, b) => (a === '★ Ulubione' ? -1 : b === '★ Ulubione' ? 1 : 0));
		if(!recipes.length && (!assistSearch || !recipes.length)) gaSection(box, 'Receptury — ' + (assistSearch ? 'brak trafień' : 'brak odkrytych'));
		for(const g of groupNames){
			gaSection(box, g);
			for(const r of groups.get(g)){
				const row = document.createElement('div');
				row.style.cssText = 'display:flex;gap:6px;align-items:center;border:1px solid rgba(255,255,255,.12);border-radius:9px;padding:5px 7px;'
					+ 'background:' + (r.can ? 'rgba(42,111,71,.28)' : 'rgba(255,255,255,.05)') + ';';
				const nm = document.createElement('span');
				nm.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;font-size:11.5px;';
				nm.textContent = String(r.name || r.id).slice(0, 40);
				nm.title = (Array.isArray(r.cost) ? r.cost : []).map(c => c.k + ' ' + c.have + '/' + c.need).join(' · ');
				const cost = document.createElement('span');
				cost.style.cssText = 'font-size:9.5px;color:#aeb9c7;white-space:nowrap;max-width:104px;overflow:hidden;text-overflow:ellipsis;';
				cost.textContent = (Array.isArray(r.cost) ? r.cost : []).map(c => c.have + '/' + c.need + ' ' + c.k).join(' ');
				// with approvals on, an unaffordable recipe may still be PROPOSED — the
				// host approves later, when the pouch may look different
				const usable = r.can || assistApproval;
				const mk = (label, count) => {
					const b = document.createElement('button');
					b.textContent = label;
					b.disabled = !usable;
					b.style.cssText = 'border:none;border-radius:7px;background:' + (usable ? (assistApproval ? 'rgba(255,184,74,.5)' : '#21a366') : 'rgba(255,255,255,.1)')
						+ ';color:#fff;font-size:10px;font-weight:700;padding:4px 7px;cursor:' + (usable ? 'pointer' : 'not-allowed') + ';';
					b.addEventListener('click', () => { sendAssist('craft', r.id, count); flashBtn(b); });
					return b;
				};
				row.append(nm, cost, mk(assistApproval ? '⏳ ×1' : '⚒ ×1', 1), mk(assistApproval ? '⏳ ×5' : '⚒ ×5', 5));
				box.appendChild(row);
			}
		}
		const items = (Array.isArray(assistState.items) ? assistState.items : []).filter(i => gaMatches(i.name || i.id));
		if(items.length){
			gaSection(box, 'Ekwipunek gracza');
			const TIER_COLORS = { common: '#b07f2c', uncommon: '#3fa650', rare: '#a74cc9', epic: '#e0b341', legendary: '#58e0d8' };
			for(const i of items){
				const row = document.createElement('div');
				row.style.cssText = 'display:flex;gap:6px;align-items:center;border-top:1px solid rgba(255,255,255,.08);padding:4px 0;';
				const nm = document.createElement('span');
				nm.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;color:' + (TIER_COLORS[i.tier] || '#e8eef6') + ';';
				nm.textContent = (i.equipped ? '✔ ' : '') + String(i.name || i.id).slice(0, 34);
				const moc = document.createElement('span');
				moc.style.cssText = 'font-size:10px;color:#9fb2c6;white-space:nowrap;';
				moc.textContent = i.moc ? 'Moc ' + i.moc : '';
				const btn = document.createElement('button');
				btn.textContent = (assistApproval ? '⏳ ' : '') + (i.equipped ? 'Zdejmij' : 'Załóż');
				btn.style.cssText = 'border:none;border-radius:7px;background:' + (i.equipped ? 'rgba(255,255,255,.14)' : (assistApproval ? 'rgba(255,184,74,.5)' : '#2c7ef8')) + ';color:#fff;font-size:10.5px;font-weight:700;padding:4px 9px;cursor:pointer;';
				btn.addEventListener('click', () => { sendAssist(i.equipped ? 'unequip' : 'equip', i.id, 1); flashBtn(btn); });
				row.append(nm, moc, btn);
				box.appendChild(row);
			}
		}
		const res = (Array.isArray(assistState.resources) ? assistState.resources : []).filter(r => gaMatches(r.name || r.k));
		if(res.length){
			gaSection(box, 'Zasoby gracza');
			const grid = document.createElement('div');
			grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
			for(const r of res){
				const chip = document.createElement('span');
				chip.style.cssText = 'border:1px solid rgba(255,255,255,.14);border-radius:999px;background:rgba(255,255,255,.06);padding:2px 8px;font-size:10.5px;white-space:nowrap;';
				chip.textContent = (r.name || r.k) + ' ' + r.n;
				grid.appendChild(chip);
			}
			box.appendChild(grid);
		}
	}
	function flashBtn(b){
		const prev = b.style.filter;
		b.style.filter = 'brightness(1.6)';
		setTimeout(() => { b.style.filter = prev; }, 220);
	}

	if(WATCH) ownInput();

	function metrics(){
		return {
			watch: WATCH ? Object.assign({}, WATCH) : null,
			state, gid, hostName,
			transport: conn ? conn.transport() : 'none',
			camMode: cam.mode,
			others: others.length,
			reconnects,
			mode,
			avatar,
			isActive: isActive(),
			charge,
			assistant,
			assistApproval,
			lastAssistAck: lastAssistAck ? Object.assign({}, lastAssistAck) : null,
			prog: {
				xp: prog.xp,
				level: NET.levelFor(prog.xp).level,
				rank: NET.rankFor(NET.levelFor(prog.xp).level).name,
				counts: Object.assign({}, prog.counts),
				done: prog.done.slice(),
				days: prog.days.length
			},
			assistRecipes: assistState && Array.isArray(assistState.recipes) ? assistState.recipes.length : 0,
			hero: {
				on: hero.on, spawned: hero.spawned,
				dmgWrapped: heroDmgWrapped.length,
				x: hero.on && bridge && bridge.player ? +bridge.player.x.toFixed(2) : null,
				y: hero.on && bridge && bridge.player ? +bridge.player.y.toFixed(2) : null,
				hp: hero.on && bridge && bridge.player ? +(bridge.player.hp || 0).toFixed(1) : null
			},
			play: {
				on: play.on, spawned: play.spawned, dead: play.dead, sel: play.sel,
				arm: play.arm, weapons: play.weapons.slice(), duelWith: play.duelWith,
				look: myLook, looksKnown: Object.keys(looks).length,
				pouch: Object.assign({}, play.pouch),
				x: play.on ? +(bridge && bridge.player ? bridge.player.x : 0).toFixed(2) : null,
				y: play.on ? +(bridge && bridge.player ? bridge.player.y : 0).toFixed(2) : null,
				hp: play.on && bridge && bridge.player ? +(bridge.player.hp || 0).toFixed(1) : null,
				bodies: bodies.length,
				remoteHost: remoteHost.has
			},
			hostChat: (hostChat && hostChat.until > nowMs()) ? hostChat.text : null,
			pings: pings.length,
			stats: Object.assign({}, stats),
			queued: queue.length,
			barTick: !!barTick,
			hostIdle,
			staleBannerShown: !!(staleBanner && staleBanner.style.display !== 'none'),
			connectFailShown
		};
	}

	const api = { boot, frame, active: () => !!WATCH && state !== 'idle', state: () => state, drawSpirits, sendBuff, sendChat, sendPower, sendPing, sendAssist, setAvatar, setFollow, setCam, noteInput, leave, metrics,
		openProgress: () => toggleProgPanel(),
		_debugConnLost: scheduleReconnect, // QA: exercises the real drop→rejoin→resnapshot cycle
		// QA seams for play mode: fire an intent / arm a pouch resource without the
		// screen-coordinate math (headless clicks are brittle); the wire path, the
		// host validation and the pouch accounting are all still the production ones
		_playAct: (a, x, y, key) => sendPlayAct(a, x, y, key),
		_playSelect: (key) => { play.sel = key; renderPouch(); },
		_playArm: (key) => { play.arm = key; renderArms(); },
		_playCraft: (key) => sendPlayAct('craft', 0, 0, key),
		_playDuel: (targetGid) => sendDuel(targetGid),
		_playLook: (c) => setLook(c),
		// QA seams for hero mode: fire the intents the real chokepoints would send
		// (the wire path, host validation and the ack accounting stay production)
		_heroMine: (tx, ty) => heroIntents.mineBreak(tx, ty),
		_heroPlace: (tx, ty, tid, layer) => heroIntents.place(tx, ty, tid, layer || 'fg'),
		_heroSave: () => { saveHeroState(true); },
		// QA: deterministically halt the embodied hero (clears held keys + velocity).
		// Synthetic keyup events do not reliably clear `held` under headless CDP.
		_playStop: () => { held.clear(); if(play.on && bridge && bridge.player){ bridge.player.vx = 0; } },
		// QA: force the throttled profile write to disk NOW. Headless Page.navigate
		// does not reliably fire beforeunload/pagehide, so a deed banked inside the
		// 2 s throttle window would otherwise not be on disk when the reload reads it.
		// Returns whether the profile is STILL dirty (a swallowed write leaves it so).
		_flushForTest: () => { flushProgress(true); return progDirty; },
		// QA: age the join start past the connect-failure deadline without a 25 s stall.
		_debugAgeJoin: () => { bootAt = 1; },
		// QA: age this watcher's last input past IDLE_MS without waiting 30 real seconds.
		// It rewinds the SAME stamp isActive() reads, so the idle path under test is the
		// production one (next pose vouches act=0 → the host's TTL lapses → boosts drop).
		_idleForTest: () => { lastInputAt = 0; } };
	if(MMR) MMR.ghostClient = api;
	return api;
})();

export { ghostClient };
export default ghostClient;
