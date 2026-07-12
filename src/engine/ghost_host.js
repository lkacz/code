// Ghost host (ghost_host.js): streams this session's live world to link-joined
// watchers ("Duchy Warstwy"). One-way authority: the sim never takes input from
// ghosts — the only uplink is their camera pose and rate-limited blessings,
// applied HERE after the host-owned cooldown ledger approves them.
//
// Stream planes (all over ghost_net peers):
//   join      — the full save object (bridge.buildSave), chunked JSON; the same
//               codec a reload uses, so watchers start pixel-faithful
//   tiles     — per-frame coalesced diffs captured from world.notifyTileChanged
//               (MM.ghostHostTile hook); a mass edit (>3000 cells) collapses
//               into a fresh snapshot instead
//   hero      — pose at ~15 Hz (the ghost's local `player` object mirrors it)
//   mobs      — pose roster at ~8 Hz, full serialize on composition change
//   drops/seasons/infra — low-Hz snapshots of the slow planes
//   ghosts    — presence relay so every watcher (and the host) sees the spirits
import { ghostNet as NET } from './ghost_net.js';

const MMR = (typeof window !== 'undefined' && window.MM) ? window.MM : null;

const CAD = { hero: 66, mobs: 120, mobsFull: 3000, drops: 1000, seasons: 5000, infra: 1500, presence: 500, reap: 4000, resnap: 10000 };
const TILE_RESYNC_LIMIT = 3000;
const MAX_GHOSTS = 12; // every join serializes a full snapshot — cap the flood surface
const SNAP_REQ_MIN_MS = 5000; // per-peer floor for needSnap re-sends
const SNAP_CACHE_MS = 3000; // one save serialization serves every join/resync inside the window
const MOBS_REQ_MIN_MS = 1000; // needMobs costs a full mob serialize — per-peer floor
const PEER_MSG_WINDOW_MS = 2000, PEER_MSG_MAX = 240; // ~120 msg/s ceiling; a legit ghost sends ~5/s
const BUFF_FX = { cheer: { tier: 'rare', sound: 'milestone' }, bless: { tier: 'epic', sound: 'heal' }, energy: { tier: 'epic', sound: 'charge' } };

const ghostHost = (function(){
	let bridge = null;
	let session = null; // {room, name, listen, peers:Map(peerObj->entry), ledger, timers...}
	let ui = { badge: null, panel: null, menuBtn: null };

	function now(){ return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

	function wire(b){ bridge = b; injectMenuButton(); }

	function start(opts){
		opts = opts || {};
		if(session) return session.room;
		if(!bridge) return null;
		const room = NET.normalizeRoom(opts.room) || NET.roomCode();
		const s = {
			room,
			name: String(opts.name || 'Gospodarz').slice(0, 24),
			peers: new Map(),
			watchers: 0,
			ledger: NET.createCooldownLedger(),
			pendingTiles: new Map(),
			needResync: false,
			snapCache: null,
			snapCacheAt: 0,
			sinceCache: [],
			lastSnapAt: 0,
			last: { hero: 0, heroKeepalive: 0, mobs: 0, mobsFull: 0, drops: 0, seasons: 0, infra: 0, presence: 0, reap: 0 },
			lastMobSig: null,
			lastDropsJson: null,
			lastHeroSent: null,
			infraDirty: true,
			prevRenderHook: null,
			stats: { tileMsgs: 0, snapshots: 0, buffs: 0 },
			listen: null
		};
		s.listen = NET.hostListen(room, { rtc: opts.rtc !== false, onPeer: (peer) => onPeer(s, peer) });
		// world.js notifyTileChanged fans out to this global when hosting
		if(MMR) MMR.ghostHostTile = (x, y, old, v) => { captureTile(s, x, y, v); };
		// infra edits surface only as the (AIR,AIR) sentinel on the render hook
		if(MMR && typeof MMR.onTileRenderChanged === 'function'){
			s.prevRenderHook = MMR.onTileRenderChanged;
			MMR.onTileRenderChanged = function(tx, ty, old, next){
				if(old === next) s.infraDirty = true;
				return s.prevRenderHook.call(this, tx, ty, old, next);
			};
		}
		session = s;
		// Companion pump: rAF freezes in a backgrounded tab, which would silence
		// every frame-driven plane the moment the host alt-tabs. Intervals only
		// get clamped (≥1 Hz), so the stream degrades instead of dying. frame()
		// is cadence-gated, so double-driving it from rAF + interval is harmless.
		s.pump = setInterval(() => { try{ frame(0.25, now()); }catch(e){ /* next tick */ } }, 250);
		updateUi();
		try{ bridge.msg('👁 Transmisja warstwy otwarta — pokój ' + room); }catch(e){ /* boot order */ }
		return room;
	}

	function stop(){
		if(!session) return;
		broadcast({ t: 'hostGone' });
		if(session.pump) clearInterval(session.pump);
		try{ session.listen.stop(); }catch(e){ /* fine */ }
		if(MMR){
			MMR.ghostHostTile = null;
			if(session.prevRenderHook) MMR.onTileRenderChanged = session.prevRenderHook;
		}
		session = null;
		updateUi();
	}

	function active(){ return !!session; }

	function link(via){
		if(!session) return null;
		const base = (typeof location !== 'undefined') ? (location.origin + location.pathname) : '';
		return NET.watchLink(base, session.room, via || null);
	}

	function entries(){ return session ? Array.from(session.peers.values()).filter(e => e.hello) : []; }

	function metrics(){
		return {
			active: !!session,
			room: session ? session.room : null,
			ghosts: entries().length,
			transports: session ? session.listen.transports : null,
			stats: session ? Object.assign({}, session.stats) : null
		};
	}

	// --- peers -----------------------------------------------------------------
	function onPeer(s, peer){
		const entry = { peer, gid: peer.id, name: null, cam: null, hello: false, lastSeen: now(), rateT: 0, rateN: 0, lastMobsReq: 0 };
		s.peers.set(peer, entry);
		peer.onMessage = (pl) => onPeerMessage(s, entry, pl);
	}
	function onPeerMessage(s, entry, pl){
		if(!pl || typeof pl.t !== 'string') return;
		const t = now();
		entry.lastSeen = t;
		// abusive senders get dropped, not served — every message costs the host CPU
		if(t - entry.rateT > PEER_MSG_WINDOW_MS){ entry.rateT = t; entry.rateN = 0; }
		if(++entry.rateN > PEER_MSG_MAX){ dropPeer(s, entry, true); return; }
		if(pl.t === 'hello'){
			if(!entry.hello){
				if(entries().length >= MAX_GHOSTS){
					entry.peer.send({ t: 'full' });
					dropPeer(s, entry, true);
					return;
				}
				entry.hello = true;
				s.watchers++;
				entry.name = String(pl.name || 'Duch').slice(0, 24);
				if(typeof pl.gid === 'string') entry.gid = pl.gid.slice(0, 40);
				entry.peer.send({ t: 'welcome', proto: NET.GHOST_PROTO, host: s.name, room: s.room });
				entry.lastSnapAt = now();
				sendSnapshot(s, entry.peer);
				try{ bridge.msg('👻 ' + entry.name + ' obserwuje twoją warstwę'); }catch(e){ /* fine */ }
				updateUi();
			}
		} else if(pl.t === 'needSnap'){
			// a watcher whose snapshot transfer got lost asks for a restart —
			// honored at most once per SNAP_REQ_MIN_MS per peer
			if(entry.hello && now() - (entry.lastSnapAt || 0) > SNAP_REQ_MIN_MS){
				entry.lastSnapAt = now();
				sendSnapshot(s, entry.peer);
			}
		} else if(pl.t === 'pose'){
			if(Number.isFinite(pl.x) && Number.isFinite(pl.y)) entry.cam = { x: +pl.x, y: +pl.y };
		} else if(pl.t === 'buff'){
			handleBuff(s, entry, pl);
		} else if(pl.t === 'needMobs'){
			if(entry.hello && now() - entry.lastMobsReq > MOBS_REQ_MIN_MS){
				entry.lastMobsReq = now();
				sendMobsFull(s, entry.peer);
			}
		} else if(pl.t === 'bye'){
			dropPeer(s, entry, false);
		}
	}
	function dropPeer(s, entry, silent){
		if(!s.peers.has(entry.peer)) return;
		s.peers.delete(entry.peer);
		if(entry.hello) s.watchers = Math.max(0, s.watchers - 1);
		try{ entry.peer.close(); }catch(e){ /* fine */ }
		if(entry.hello && !silent){ try{ bridge.msg('👻 ' + (entry.name || 'Duch') + ' opuszcza warstwę'); }catch(e){ /* fine */ } }
		updateUi();
	}
	function broadcast(pl){
		if(!session) return;
		for(const entry of session.peers.values()){ if(entry.hello) entry.peer.send(pl); }
	}

	// --- join snapshot -----------------------------------------------------------
	// The serialized world is cached for SNAP_CACHE_MS: buildSave is save-grade
	// work (settle/audit passes included), so a burst of joins or resync requests
	// must reuse one serialization instead of hammering the sim. Coherence: tile
	// diffs flushed AFTER the cache was built are replayed to the joining peer
	// (sinceCache buffer) — without it the newcomer would be permanently stale on
	// every cell that changed between the cache build and its welcome. Overflow
	// invalidates the cache rather than dropping replay data.
	function sendSnapshot(s, peer, forceFresh){
		const t = now();
		if(forceFresh || !s.snapCache || t - s.snapCacheAt > SNAP_CACHE_MS){
			try{
				s.snapCache = JSON.stringify(Object.assign({ ghostStream: NET.GHOST_PROTO }, bridge.buildSave()));
				s.snapCacheAt = t;
				s.sinceCache.length = 0;
			}
			catch(e){ console.warn('ghost snapshot failed', e); s.snapCache = null; return; }
		}
		for(const env of NET.chunkPayload('snap', s.snapCache)) peer.send(env);
		if(s.sinceCache.length) peer.send({ t: 'tiles', d: s.sinceCache.slice() });
		s.stats.snapshots++;
		s.lastSnapAt = t;
	}
	function sendMobsFull(s, peer){
		try{
			const M = MMR && MMR.mobs;
			if(!M || !M.serialize) return;
			const pl = { t: 'mobsFull', data: M.serialize() };
			if(peer) peer.send(pl); else broadcast(pl);
			s.lastMobSig = (M.ghostRoster ? M.ghostRoster().sig : null);
			s.last.mobsFull = now();
		}catch(e){ /* mob codec hiccup — next tick retries */ }
	}

	// --- live planes ---------------------------------------------------------------
	// Numeric cell key: y spans [-140,280], so (y+512) stays inside one thousand-slot
	// and x*1000 keeps every world column distinct — no per-change string allocation
	// on water/fire-heavy worlds (the classic getTile-allocation-tax pattern).
	function captureTile(s, x, y, v){
		if(!s || s.needResync || !s.watchers) return;
		s.pendingTiles.set(x * 1000 + (y + 512), [x, y, v]);
		if(s.pendingTiles.size > TILE_RESYNC_LIMIT){ s.pendingTiles.clear(); s.needResync = true; }
	}
	function frame(dt, ts){
		const s = session;
		if(!s || !bridge) return;
		const t = Number.isFinite(ts) ? ts : now();
		if(!entries().length){ s.pendingTiles.clear(); s.needResync = false; reap(s, t); return; }
		if(s.needResync){
			if(t - s.lastSnapAt > CAD.resnap){
				s.needResync = false;
				let fresh = true; // one rebuild covers the whole burst — later peers reuse it
				for(const entry of entries()){ sendSnapshot(s, entry.peer, fresh); fresh = false; }
			}
		} else if(s.pendingTiles.size){
			const d = [];
			for(const cell of s.pendingTiles.values()){ d.push(cell[0], cell[1], cell[2]); }
			s.pendingTiles.clear();
			broadcast({ t: 'tiles', d });
			s.stats.tileMsgs++;
			// keep the cached snapshot honest: remember what changed since it was
			// built so a late joiner can replay the gap; too much churn = drop cache
			if(s.snapCache){
				if(s.sinceCache.length + d.length > 9000){ s.snapCache = null; s.sinceCache.length = 0; }
				else { for(const n of d) s.sinceCache.push(n); }
			}
		}
		if(t - s.last.hero >= CAD.hero) heroTick(s, t);
		if(t - s.last.mobs >= CAD.mobs) mobTick(s, t);
		if(t - s.last.drops >= CAD.drops) dropTick(s, t);
		if(t - s.last.seasons >= CAD.seasons) seasonTick(s, t);
		if(s.infraDirty && t - s.last.infra >= CAD.infra) infraTick(s, t);
		if(t - s.last.presence >= CAD.presence) presenceTick(s, t);
		if(t - s.last.reap >= CAD.reap) reap(s, t);
	}
	function heroTick(s, t){
		s.last.hero = t;
		const p = bridge.player;
		const key = (p.x.toFixed(2) + '|' + p.y.toFixed(2) + '|' + p.facing + '|' + Math.round(p.hp));
		if(key === s.lastHeroSent && t - s.last.heroKeepalive < 500) return;
		s.lastHeroSent = key; s.last.heroKeepalive = t;
		broadcast({ t: 'hero', x: +p.x.toFixed(3), y: +p.y.toFixed(3), vx: +(p.vx || 0).toFixed(2), vy: +(p.vy || 0).toFixed(2), f: p.facing < 0 ? -1 : 1, hp: +p.hp.toFixed(1), mhp: p.maxHp, en: +(p.energy || 0).toFixed(1) });
	}
	function mobTick(s, t){
		s.last.mobs = t;
		const M = MMR && MMR.mobs;
		if(!M || !M.ghostRoster) return;
		const roster = M.ghostRoster();
		if(roster.sig !== s.lastMobSig || t - s.last.mobsFull > CAD.mobsFull){ sendMobsFull(s, null); }
		else broadcast({ t: 'mobs', sig: roster.sig, poses: roster.poses });
	}
	function dropTick(s, t){
		s.last.drops = t;
		try{
			const data = bridge.snapshotDrops ? bridge.snapshotDrops() : null;
			if(!data) return;
			const json = JSON.stringify(data);
			if(json === s.lastDropsJson) return;
			s.lastDropsJson = json;
			broadcast({ t: 'drops', data });
		}catch(e){ /* skip tick */ }
	}
	function seasonTick(s, t){
		s.last.seasons = t;
		try{
			const data = bridge.snapshotSeasons ? bridge.snapshotSeasons() : null;
			if(data) broadcast({ t: 'seasons', data });
		}catch(e){ /* skip tick */ }
	}
	function infraTick(s, t){
		s.last.infra = t;
		s.infraDirty = false;
		try{
			broadcast({ t: 'infra', data: bridge.snapshotInfra ? bridge.snapshotInfra() : null, bg: bridge.snapshotConstructionBackground ? bridge.snapshotConstructionBackground() : null });
		}catch(e){ /* skip tick */ }
	}
	function presenceTick(s, t){
		s.last.presence = t;
		const list = entries().filter(e => e.cam).map(e => ({ id: e.gid, name: e.name, x: +e.cam.x.toFixed(2), y: +e.cam.y.toFixed(2) }));
		broadcast({ t: 'ghosts', list });
	}
	function reap(s, t){
		s.last.reap = t;
		for(const entry of Array.from(s.peers.values())){
			if(t - entry.lastSeen > 15000) dropPeer(s, entry, true);
		}
	}

	// --- blessings -------------------------------------------------------------------
	function handleBuff(s, entry, pl){
		if(!NET.validBuffKind(pl.kind)){ entry.peer.send({ t: 'buffAck', kind: pl.kind, ok: false, waitMs: 0 }); return; }
		const verdict = s.ledger.tryUse(entry.gid, pl.kind, Date.now());
		entry.peer.send({ t: 'buffAck', kind: pl.kind, ok: verdict.ok, waitMs: verdict.waitMs });
		if(!verdict.ok) return;
		s.stats.buffs++;
		const rule = NET.BUFF_RULES[pl.kind];
		const fx = BUFF_FX[pl.kind] || BUFF_FX.cheer;
		const p = bridge.player;
		try{
			if(rule.heal) bridge.healHero(rule.heal);
			if(rule.energy) bridge.addHeroEnergy(rule.energy);
			if(MMR && MMR.particles && MMR.particles.spawnBurst) MMR.particles.spawnBurst(p.x + p.w / 2, p.y + p.h / 2, fx.tier, {});
			if(MMR && MMR.audio && MMR.audio.play) MMR.audio.play(fx.sound);
			bridge.msg('👻 ' + (entry.name || 'Duch') + ': ' + rule.label + (rule.heal ? ' (+' + rule.heal + ' HP)' : rule.energy ? ' (+' + rule.energy + ' energii)' : '') + '!');
		}catch(e){ /* fx are best-effort */ }
		broadcast({ t: 'fx', kind: pl.kind, name: entry.name || 'Duch' });
	}

	// --- spirits (shared painter — the client reuses it for fellow watchers) ------------
	function paintSpirit(ctx, TILE, x, y, name, t, self){
		const bob = Math.sin((t || 0) / 480 + (x + y) * 1.7) * 0.12;
		const px = x * TILE, py = (y + bob) * TILE;
		ctx.save();
		ctx.globalAlpha = self ? 0.28 : 0.42;
		const grad = ctx.createRadialGradient(px, py, TILE * 0.05, px, py, TILE * 0.75);
		grad.addColorStop(0, 'rgba(190,225,255,0.95)');
		grad.addColorStop(1, 'rgba(120,170,255,0)');
		ctx.fillStyle = grad;
		ctx.beginPath(); ctx.arc(px, py, TILE * 0.75, 0, Math.PI * 2); ctx.fill();
		ctx.globalAlpha = self ? 0.5 : 0.8;
		ctx.fillStyle = '#dceeff';
		ctx.beginPath();
		ctx.arc(px, py - TILE * 0.12, TILE * 0.3, Math.PI, 0);
		ctx.quadraticCurveTo(px + TILE * 0.3, py + TILE * 0.32, px + TILE * 0.18, py + TILE * 0.3);
		ctx.quadraticCurveTo(px + TILE * 0.06, py + TILE * 0.2, px, py + TILE * 0.3);
		ctx.quadraticCurveTo(px - TILE * 0.06, py + TILE * 0.2, px - TILE * 0.18, py + TILE * 0.3);
		ctx.quadraticCurveTo(px - TILE * 0.3, py + TILE * 0.32, px - TILE * 0.3, py - TILE * 0.12);
		ctx.fill();
		ctx.fillStyle = '#31465f';
		ctx.beginPath(); ctx.arc(px - TILE * 0.1, py - TILE * 0.12, TILE * 0.045, 0, Math.PI * 2); ctx.fill();
		ctx.beginPath(); ctx.arc(px + TILE * 0.1, py - TILE * 0.12, TILE * 0.045, 0, Math.PI * 2); ctx.fill();
		if(name){
			ctx.globalAlpha = 0.85;
			ctx.font = 'bold ' + Math.max(9, TILE * 0.22) + 'px system-ui';
			ctx.textAlign = 'center';
			ctx.fillStyle = '#cfe6ff';
			ctx.strokeStyle = 'rgba(6,12,20,0.8)';
			ctx.lineWidth = 3;
			ctx.strokeText(name, px, py - TILE * 0.55);
			ctx.fillText(name, px, py - TILE * 0.55);
		}
		ctx.restore();
	}
	function drawSpirits(ctx, TILE){
		if(!session) return;
		const t = now();
		for(const entry of entries()){
			if(entry.cam) paintSpirit(ctx, TILE, entry.cam.x, entry.cam.y, entry.name, t, false);
		}
	}

	// --- host UI (menu entry + badge + share panel) --------------------------------------
	function injectMenuButton(){
		if(typeof document === 'undefined') return;
		const tryInject = () => {
			const menu = document.getElementById('menuPanel');
			if(!menu || ui.menuBtn) return !!ui.menuBtn;
			const group = document.createElement('div');
			group.className = 'group';
			const btn = document.createElement('button');
			btn.id = 'ghostShareBtn';
			btn.textContent = '👁 Obserwatorzy';
			btn.addEventListener('click', () => { togglePanel(true); });
			group.appendChild(btn);
			menu.appendChild(group);
			ui.menuBtn = btn;
			return true;
		};
		if(!tryInject()){
			const iv = setInterval(() => { if(tryInject()) clearInterval(iv); }, 1000);
			setTimeout(() => clearInterval(iv), 20000);
		}
	}
	function ensurePanel(){
		if(ui.panel || typeof document === 'undefined') return ui.panel;
		const el = document.createElement('div');
		el.id = 'ghostSharePanel';
		el.style.cssText = 'position:fixed; right:12px; top:56px; z-index:120; width:min(340px,calc(100vw - 24px)); display:none; flex-direction:column; gap:9px; padding:12px 14px; border-radius:14px; border:1px solid rgba(140,190,255,.35); background:rgba(12,17,26,.95); color:#e8f1fb; font:12px system-ui; box-shadow:0 10px 30px rgba(0,0,0,.55); pointer-events:auto;';
		el.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;">'
			+ '<b style="font-size:13px;">👁 Duchy Warstwy</b>'
			+ '<button id="ghostPanelClose" style="border:none;background:rgba(255,255,255,.12);color:#fff;width:24px;height:24px;border-radius:8px;cursor:pointer;">×</button></div>'
			+ '<div id="ghostPanelInfo" style="line-height:1.45;color:#b9c9dc;">Udostępnij link, a znajomi będą oglądać twoją grę na żywo jako duchy — mogą dopingować i błogosławić, ale nie zmienią świata.</div>'
			+ '<div id="ghostPanelLinkRow" style="display:none;gap:6px;"><input id="ghostPanelLink" readonly style="flex:1;min-width:0;background:rgba(20,26,36,.9);border:1px solid rgba(255,255,255,.2);border-radius:8px;color:#d5e6ff;padding:6px 8px;font-size:11px;">'
			+ '<button id="ghostPanelCopy" style="border:none;border-radius:8px;background:#2c7ef8;color:#fff;font-weight:700;padding:6px 10px;cursor:pointer;">Kopiuj</button></div>'
			+ '<div id="ghostPanelViewers" style="color:#9fd6ae;"></div>'
			+ '<button id="ghostPanelToggle" style="border:none;border-radius:10px;background:#21a366;color:#fff;font-weight:800;padding:9px 12px;cursor:pointer;">Rozpocznij transmisję</button>';
		document.body.appendChild(el);
		el.querySelector('#ghostPanelClose').addEventListener('click', () => togglePanel(false));
		el.querySelector('#ghostPanelCopy').addEventListener('click', () => {
			const inp = el.querySelector('#ghostPanelLink');
			inp.select();
			try{ navigator.clipboard.writeText(inp.value); }catch(e){ try{ document.execCommand('copy'); }catch(e2){ /* manual copy */ } }
			if(bridge) bridge.msg('Link skopiowany — wyślij go widzom!');
		});
		el.querySelector('#ghostPanelToggle').addEventListener('click', () => {
			if(session) stop(); else start({});
			updateUi();
		});
		ui.panel = el;
		return el;
	}
	function togglePanel(show){
		const el = ensurePanel();
		if(!el) return;
		el.style.display = show ? 'flex' : 'none';
		if(show) updateUi();
	}
	function ensureBadge(){
		if(ui.badge || typeof document === 'undefined') return ui.badge;
		const b = document.createElement('button');
		b.id = 'ghostHostBadge';
		b.style.cssText = 'position:fixed; left:8px; top:44px; z-index:60; display:none; border:1px solid rgba(140,190,255,.4); border-radius:999px; background:rgba(12,17,26,.85); color:#cfe6ff; font:11px system-ui; font-weight:700; padding:5px 10px; cursor:pointer; pointer-events:auto;';
		b.addEventListener('click', () => togglePanel(true));
		document.body.appendChild(b);
		ui.badge = b;
		return b;
	}
	function updateUi(){
		if(typeof document === 'undefined') return;
		const badge = ensureBadge();
		if(badge){
			if(session){
				badge.style.display = 'inline-block';
				badge.textContent = '👁 ' + entries().length + ' • ' + session.room;
			} else badge.style.display = 'none';
		}
		const el = ui.panel;
		if(!el) return;
		const linkRow = el.querySelector('#ghostPanelLinkRow');
		const toggle = el.querySelector('#ghostPanelToggle');
		const viewers = el.querySelector('#ghostPanelViewers');
		if(session){
			linkRow.style.display = 'flex';
			el.querySelector('#ghostPanelLink').value = link();
			toggle.textContent = 'Zakończ transmisję';
			toggle.style.background = '#c43232';
			const list = entries();
			viewers.textContent = list.length ? ('Duchy (' + list.length + '): ' + list.map(e => e.name || e.gid).join(', ')) : 'Czekam na duchy… wyślij link.';
		} else {
			linkRow.style.display = 'none';
			toggle.textContent = 'Rozpocznij transmisję';
			toggle.style.background = '#21a366';
			viewers.textContent = '';
		}
	}

	const api = { wire, start, stop, active, link, frame, metrics, drawSpirits, paintSpirit, openPanel: () => togglePanel(true) };
	if(MMR) MMR.ghostHost = api;
	if(typeof window !== 'undefined'){
		window.__mmGhostHostStart = (room, opts) => start(Object.assign({ room }, opts || {}));
		window.__mmGhostHostStop = () => stop();
	}
	return api;
})();

export { ghostHost };
export default ghostHost;
