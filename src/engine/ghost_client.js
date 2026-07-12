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
		const allow = new Set(['mm_ghost_name_v1']);
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
const HELLO_MS = 1200, POSE_MS = 400, NEEDMOBS_MS = 600;

const ghostClient = (function(){
	let bridge = null;
	let conn = null;
	let state = 'idle'; // connect -> sync -> live | ended
	let hostName = null;
	const gid = 'g' + Math.random().toString(36).slice(2, 10);
	const assembler = NET.createAssembler();
	const queue = [];
	const heroTarget = { has: false, x: 0, y: 0, vx: 0, vy: 0, at: 0 };
	const cam = { mode: 'follow', x: 0, y: 0 };
	const others = []; // fellow spirits from presence relay
	const held = new Set();
	const stats = { tilesApplied: 0, tileMsgs: 0, mobRosters: 0, mobFulls: 0, snapsApplied: 0, fx: 0 };
	const buffWait = {}; // kind -> readyAtMs (UI countdown)
	let timers = { hello: 0, pose: 0, needMobs: 0 };
	let veil = null, bar = null, barTick = null;
	let drag = null;
	let pump = null;
	let lockedConn = null;
	let syncSince = 0, lastSnapReq = 0;
	let lastRafAt = 0;
	let reconnecting = false, reconnects = 0;

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

	// --- boot --------------------------------------------------------------------
	function boot(b){
		if(!WATCH) return false;
		bridge = b;
		document.body.classList.add('mmGhostMode');
		injectCss();
		showVeil('Łączenie z warstwą <b>' + WATCH.room + '</b>…');
		buildBar();
		state = 'connect';
		conn = makeConn();
		sendHello();
		// prompt goodbye on tab close — otherwise the host only reaps after 15 s
		window.addEventListener('beforeunload', () => { try{ if(conn) conn.close(); }catch(e){ /* fine */ } });
		// Companion pump (mirror of ghost_host's): keeps hello retries, queue
		// drain and the pose keepalive alive while this tab is backgrounded and
		// rAF is frozen. All paths inside frame() are cadence-gated/idempotent.
		pump = setInterval(() => { try{ frame(0.5, (typeof performance !== 'undefined') ? performance.now() : Date.now(), true); }catch(e){ /* next tick */ } }, 500);
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
	function sendHello(){ if(conn) conn.send({ t: 'hello', gid, name: ghostName(), proto: NET.GHOST_PROTO }); }
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
		if(pl.t === 'welcome'){
			if(state === 'connect'){
				state = 'sync';
				syncSince = nowMs();
				hostName = String(pl.host || 'Gospodarz').slice(0, 24);
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
		try{
			const ok = bridge.applyGameData(data, { ignoreCritical: true });
			if(!ok){ showVeil('Świat gospodarza nie dał się wczytać.'); return; }
		}catch(e){ console.warn('ghost snapshot apply failed', e); return; }
		stats.snapsApplied++;
		heroTarget.has = false;
		reconnects = 0; // a completed join proves the path — future blips get a fresh budget
		state = 'live';
		cam.mode = 'follow';
		bridge.snapCameraToPlayer();
		hideVeil();
		bridge.msg('👁 Obserwujesz warstwę gracza ' + (hostName || '…') + ' — WASD/przeciąganie = kamera, F = podążaj');
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
					heroTarget.x = pl.x; heroTarget.y = pl.y;
					heroTarget.vx = Number.isFinite(pl.vx) ? pl.vx : 0; heroTarget.vy = Number.isFinite(pl.vy) ? pl.vy : 0;
					heroTarget.at = nowMs(); heroTarget.has = true;
					const p = bridge.player;
					p.facing = pl.f < 0 ? -1 : 1;
					if(Number.isFinite(pl.hp)) p.hp = pl.hp;
					if(Number.isFinite(pl.mhp) && pl.mhp > 0) p.maxHp = pl.mhp;
					if(Number.isFinite(pl.en)) p.energy = pl.en;
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
				} else if(pl.t === 'drops'){
					bridge.restoreDrops(pl.data);
				} else if(pl.t === 'seasons'){
					bridge.restoreSeasons(pl.data);
				} else if(pl.t === 'infra'){
					if(pl.data) bridge.restoreInfra(pl.data);
					if(pl.bg) bridge.restoreConstructionBackground(pl.bg);
				} else if(pl.t === 'ghosts' && Array.isArray(pl.list)){
					others.length = 0;
					for(const g of pl.list.slice(0, 16)){
						if(g && g.id !== gid && Number.isFinite(g.x) && Number.isFinite(g.y)) others.push({ id: g.id, name: String(g.name || 'Duch').slice(0, 24), x: g.x, y: g.y });
					}
					updateBar();
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
		if(state === 'connect' || state === 'sync'){
			if(t - timers.hello > HELLO_MS){ timers.hello = t; sendHello(); }
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
		// hero replica: short prediction toward the last pose, hard snap on teleports
		if(heroTarget.has){
			const age = Math.min(0.25, (t - heroTarget.at) / 1000);
			const gx = heroTarget.x + heroTarget.vx * age;
			const gy = heroTarget.y + heroTarget.vy * age;
			if(Math.abs(gx - p.x) > 6 || Math.abs(gy - p.y) > 6){ p.x = gx; p.y = gy; }
			else { const k = Math.min(1, dt * 10); p.x += (gx - p.x) * k; p.y += (gy - p.y) * k; }
			p.vx = heroTarget.vx; p.vy = heroTarget.vy; // drives the walk animation
		}
		try{ if(MMR && MMR.mobs && MMR.mobs.ghostLerp) MMR.mobs.ghostLerp(dt); }catch(e){ /* fine */ }
		// fog mirrors the host: the replica player position feeds the normal reveal
		try{ bridge.revealAround(); }catch(e){ /* fine */ }
		try{ bridge.stepCosmetics(dt); }catch(e){ /* fine */ }
		updateCamera(dt);
		}
		if(t - timers.pose > POSE_MS){
			timers.pose = t;
			const c = bridge.getCamCenter();
			conn.send({ t: 'pose', x: +c.x.toFixed(2), y: +c.y.toFixed(2) });
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
		if(state !== 'live' || !NET.validBuffKind(kind)) return false;
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

	// --- spirits of fellow watchers ------------------------------------------------------
	function drawSpirits(ctx, TILE){
		const painter = MMR && MMR.ghostHost && MMR.ghostHost.paintSpirit;
		if(!painter) return;
		const t = (typeof performance !== 'undefined') ? performance.now() : 0;
		for(const g of others) painter(ctx, TILE, g.x, g.y, g.name, t, false);
	}

	// --- input ownership: watchers must not reach the game's handlers ---------------------
	function ownInput(){
		if(typeof window === 'undefined') return;
		const isOurs = (e) => e.target && e.target.closest && e.target.closest('#ghostBar, #ghostVeil');
		window.addEventListener('keydown', (e) => {
			if(!MMR || !MMR.ghostMode) return;
			if(e.ctrlKey || e.metaKey || e.altKey) return; // browser shortcuts stay browser shortcuts
			if(isOurs(e)) return;
			const k = (e.key || '').toLowerCase();
			if(PAN_KEYS[k]){ held.add(k); if(cam.mode === 'follow') setFollow(false); e.preventDefault(); }
			else if(k === 'f'){ setFollow(cam.mode !== 'follow'); e.preventDefault(); }
			else if(k === '+' || k === '=' || k === ']'){ bridge && bridge.nudgeZoom(1.1); e.preventDefault(); }
			else if(k === '-' || k === '['){ bridge && bridge.nudgeZoom(1 / 1.1); e.preventDefault(); }
			e.stopImmediatePropagation();
		}, true);
		window.addEventListener('keyup', (e) => {
			if(!MMR || !MMR.ghostMode) return;
			held.delete((e.key || '').toLowerCase());
			if(!isOurs(e)) e.stopImmediatePropagation();
		}, true);
		const swallowPointer = (e) => {
			if(!MMR || !MMR.ghostMode) return;
			if(isOurs(e)) return;
			const onCanvas = e.target && e.target.id === 'game';
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
	}

	// --- UI -------------------------------------------------------------------------------
	function injectCss(){
		const st = document.createElement('style');
		st.textContent = 'body.mmGhostMode #hotbarWrap, body.mmGhostMode #weaponBar, body.mmGhostMode #craft,'
			+ 'body.mmGhostMode #craftTracker, body.mmGhostMode #cornerCards, body.mmGhostMode #radarBtn,'
			+ 'body.mmGhostMode #fireBtn, body.mmGhostMode #ultBtn, body.mmGhostMode #controls,'
			+ 'body.mmGhostMode #dirRing, body.mmGhostMode #menuWrap, body.mmGhostMode #help,'
			+ 'body.mmGhostMode #hoverInfo, body.mmGhostMode #hudTip { display:none !important; }'
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
			+ '#ghostVeil{ position:fixed; inset:0; z-index:290; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px;'
			+ ' background:radial-gradient(ellipse at 50% 40%, rgba(14,20,34,.92), rgba(4,7,13,.98)); color:#dcebff; font:14px system-ui; text-align:center; pointer-events:auto; }'
			+ '#ghostVeil .gvIcon{ font-size:44px; animation:gvFloat 2.6s ease-in-out infinite; }'
			+ '#ghostVeil .gvText{ line-height:1.6; max-width:min(440px,86vw); }'
			+ '@keyframes gvFloat{ 0%,100%{ transform:translateY(0); opacity:.75; } 50%{ transform:translateY(-9px); opacity:1; } }';
		document.head.appendChild(st);
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
	function buildBar(){
		if(bar) return;
		bar = document.createElement('div');
		bar.id = 'ghostBar';
		bar.innerHTML = '<span class="gbTag">👁 Duch Warstwy</span><span class="gbInfo" id="gbInfo"></span>'
			+ '<button class="gbBuff" data-kind="cheer">✨ Doping</button>'
			+ '<button class="gbBuff" data-kind="bless">💚 Błogosławieństwo</button>'
			+ '<button class="gbBuff" data-kind="energy">⚡ Energia</button>'
			+ '<button class="gbFollow on" id="gbFollow">🎥 Podążaj [F]</button>'
			+ '<button class="gbLeave" id="gbLeave">Opuść</button>';
		document.body.appendChild(bar);
		bar.querySelectorAll('.gbBuff').forEach(btn => btn.addEventListener('click', () => sendBuff(btn.dataset.kind)));
		bar.querySelector('#gbFollow').addEventListener('click', () => setFollow(cam.mode !== 'follow'));
		bar.querySelector('#gbLeave').addEventListener('click', leave);
		barTick = setInterval(updateBar, 500);
	}
	function updateBar(){
		if(!bar) return;
		const info = bar.querySelector('#gbInfo');
		info.textContent = (hostName ? hostName : '…') + (others.length ? ' • duchy: ' + (others.length + 1) : '');
		const t = nowMs();
		bar.querySelectorAll('.gbBuff').forEach(btn => {
			const wait = (buffWait[btn.dataset.kind] || 0) - t;
			btn.disabled = state !== 'live' || wait > 0;
			const rule = NET.BUFF_RULES[btn.dataset.kind];
			const base = btn.dataset.kind === 'cheer' ? '✨ Doping' : btn.dataset.kind === 'bless' ? '💚 Błogosławieństwo' : '⚡ Energia';
			btn.textContent = wait > 1000 ? base + ' (' + Math.ceil(wait / 1000) + 's)' : base;
			btn.title = rule ? rule.label : '';
		});
		const fol = bar.querySelector('#gbFollow');
		fol.classList.toggle('on', cam.mode === 'follow');
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
			stats: Object.assign({}, stats),
			queued: queue.length,
			barTick: !!barTick
		};
	}

	const api = { boot, frame, active: () => !!WATCH && state !== 'idle', state: () => state, drawSpirits, sendBuff, setFollow, setCam, leave, metrics,
		_debugConnLost: scheduleReconnect }; // QA: exercises the real drop→rejoin→resnapshot cycle
	if(MMR) MMR.ghostClient = api;
	return api;
})();

export { ghostClient };
export default ghostClient;
