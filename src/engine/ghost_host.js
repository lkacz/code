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
// Neutral from the first frame: every consumer (mobs XP, movement, weapons)
// multiplies these in unconditionally, hosting or not.
if(MMR && !MMR.socialBoost) MMR.socialBoost = { viewers: 0, active: 0, xp: 1, move: 1, jump: 1, dmg: 1 };
// Ghost dread: the ONE lookup every creature system calls (mobs, invasion aliens,
// guardian sidekicks, molekin companions). Empty aura = null = zero cost, so solo
// play and the Node sims never even allocate.
if(MMR && !MMR.ghostAura) MMR.ghostAura = { spirits: [], r: NET.DREAD.R };
if(MMR && !MMR.ghostDreadAt){
	MMR.ghostDreadAt = function(x, y, radius){
		const aura = MMR.ghostAura;
		if(!aura || !aura.spirits.length) return null;
		return NET.dreadAt(aura.spirits, x, y, radius || aura.r);
	};
}

const CAD = { hero: 66, mobs: 120, mobsFull: 3000, drops: 1000, seasons: 5000, infra: 1500, presence: 200, reap: 4000, resnap: 10000, prog: 1000 };
const CHAT_MIN_MS = 4000; // per-peer chat floor
const ACT_POSE_TTL_MS = 6000; // an "active" pose vouches for the watcher this long
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
	let ui = { panel: null, menuBtn: null };

	function now(){ return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

	function wire(b){ bridge = b; mountEntryPoint(); }

	function start(opts){
		opts = opts || {};
		if(session) return session.room;
		if(!bridge) return null;
		const room = NET.normalizeRoom(opts.room) || NET.roomCode();
		const s = {
			room,
			name: String(opts.name || 'Gospodarz').slice(0, 24),
			peers: new Map(),
			banned: new Set(),
			watchers: 0,
			ledger: NET.createCooldownLedger(),
			pendingTiles: new Map(),
			needResync: false,
			snapCache: null,
			snapCacheAt: 0,
			sinceCache: [],
			lastSnapAt: 0,
			last: { hero: 0, heroKeepalive: 0, mobs: 0, mobsFull: 0, drops: 0, seasons: 0, infra: 0, presence: 0, reap: 0, prog: 0 },
			auraOwners: [],
			lastMobSig: null,
			lastDropsJson: null,
			lastHeroSent: null,
			infraDirty: true,
			prevRenderHook: null,
			stats: { tileMsgs: 0, snapshots: 0, buffs: 0, chats: 0, powers: 0, assists: 0, pings: 0 },
			hiddenGids: new Set(), // per-watcher mute: THIS host's display only, never the relay
			actionFx: [], // visible feedback for watcher deeds: labels, rings, ping markers
			assistQueue: NET.createAssistQueue(),
			assistStateCache: null,
			assistStateAt: 0,
			lastChargeAt: 0,
			listen: null
		};
		s.listen = NET.hostListen(room, { rtc: opts.rtc !== false, onPeer: (peer) => onPeer(s, peer) });
		// world.js notifyTileChanged fans out to this global when hosting
		if(MMR) MMR.ghostHostTile = (x, y, old, v) => { captureTile(s, x, y, v); };
		// mobs.js credits a fright to the spirit that caused it (watcher progression)
		if(MMR) MMR.ghostSpook = (i) => { noteSpook(i); };
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
		closeSayBox();
		hostChat = null;
		if(session.pump) clearInterval(session.pump);
		try{ session.listen.stop(); }catch(e){ /* fine */ }
		if(MMR){
			MMR.ghostHostTile = null;
			MMR.ghostSpook = null;
			if(session.prevRenderHook) MMR.onTileRenderChanged = session.prevRenderHook;
		}
		session = null;
		updateSocialBoost(); // back to neutral 1.0 — no audience, no facilitation
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
		const t = now();
		return {
			active: !!session,
			room: session ? session.room : null,
			ghosts: entries().length,
			activeGhosts: session ? entries().filter(e => e.actUntil > t).length : 0,
			viewers: session ? entries().map(e => ({ gid: e.gid, name: e.name, mode: e.mode, avatar: e.avatar, active: e.actUntil > t, charge: +(e.charge || 0).toFixed(1), assistant: !!e.assistant, level: e.level || 1 })) : [],
			aura: (MMR && MMR.ghostAura) ? MMR.ghostAura.spirits.length : 0,
			banned: session ? session.banned.size : 0,
			boost: (MMR && MMR.socialBoost) ? Object.assign({}, MMR.socialBoost) : null,
			transports: session ? session.listen.transports : null,
			approval: approvalMode,
			queue: session ? session.assistQueue.list() : [],
			view: Object.assign({}, viewPrefs),
			hidden: session ? Array.from(session.hiddenGids) : [],
			hostChat: (hostChat && hostChat.until > t) ? hostChat.text : null,
			actionFx: session ? session.actionFx.length : 0,
			stats: session ? Object.assign({}, session.stats) : null
		};
	}

	// --- peers -----------------------------------------------------------------
	function onPeer(s, peer){
		const entry = {
			peer, gid: peer.id, name: null, cam: null, camPos: null, hello: false, lastSeen: now(),
			rateT: 0, rateN: 0, lastMobsReq: 0, lastChatAt: 0,
			mode: defaultMode, avatar: 'duszek', actUntil: 0, lastChat: null,
			charge: 0, powerCd: {}, assistant: false, lastAssistAt: 0, lastChargeSentAt: 0,
			level: 1, watchT: 0, chatXpAt: 0, spookN: 0
		};
		s.peers.set(peer, entry);
		peer.onMessage = (pl) => onPeerMessage(s, entry, pl);
	}
	function markActive(entry){ entry.actUntil = now() + ACT_POSE_TTL_MS; }
	function onPeerMessage(s, entry, pl){
		if(!pl || typeof pl.t !== 'string') return;
		const t = now();
		entry.lastSeen = t;
		// abusive senders get dropped, not served — every message costs the host CPU
		if(t - entry.rateT > PEER_MSG_WINDOW_MS){ entry.rateT = t; entry.rateN = 0; }
		if(++entry.rateN > PEER_MSG_MAX){ dropPeer(s, entry, true); return; }
		if(pl.t === 'hello'){
			if(!entry.hello){
				if(typeof pl.gid === 'string') entry.gid = pl.gid.slice(0, 40);
				if(s.banned.has(entry.gid)){
					entry.peer.send({ t: 'banned' });
					dropPeer(s, entry, true);
					return;
				}
				if(entries().length >= MAX_GHOSTS){
					entry.peer.send({ t: 'full' });
					dropPeer(s, entry, true);
					return;
				}
				entry.hello = true;
				s.watchers++;
				entry.name = String(pl.name || 'Duch').slice(0, 24);
				if(NET.validAvatar(pl.avatar)) entry.avatar = pl.avatar;
				if(Number.isFinite(pl.lvl)) entry.level = Math.max(1, Math.min(NET.PROG.MAX_LEVEL, Math.floor(pl.lvl)));
				entry.peer.send({ t: 'welcome', proto: NET.GHOST_PROTO, host: s.name, room: s.room, mode: entry.mode });
				entry.lastSnapAt = now();
				sendSnapshot(s, entry.peer);
				sendDeed(entry, 'join', 1);
				try{ bridge.msg('👻 ' + entry.name + ' obserwuje twoją warstwę'); }catch(e){ /* fine */ }
				updateUi();
			}
		} else if(pl.t === 'prog'){
			// the watcher's claimed rank — shown in the viewer list, trusted for NOTHING.
			// Refresh the DOM only on an actual change: a hostile ghost spamming this
			// at the message-rate cap must not buy 120 panel rebuilds a second.
			if(Number.isFinite(pl.lvl)){
				const lvl = Math.max(1, Math.min(NET.PROG.MAX_LEVEL, Math.floor(pl.lvl)));
				if(lvl !== entry.level){ entry.level = lvl; updateUi(); }
			}
		} else if(pl.t === 'avatar'){
			if(NET.validAvatar(pl.a)){ entry.avatar = pl.a; markActive(entry); }
		} else if(pl.t === 'chat'){
			handleChat(s, entry, pl);
		} else if(pl.t === 'ping'){
			handlePing(s, entry);
		} else if(pl.t === 'power'){
			handlePower(s, entry, pl);
		} else if(pl.t === 'assist'){
			handleAssist(s, entry, pl);
		} else if(pl.t === 'needSnap'){
			// a watcher whose snapshot transfer got lost asks for a restart —
			// honored at most once per SNAP_REQ_MIN_MS per peer
			if(entry.hello && now() - (entry.lastSnapAt || 0) > SNAP_REQ_MIN_MS){
				entry.lastSnapAt = now();
				sendSnapshot(s, entry.peer);
			}
		} else if(pl.t === 'pose'){
			if(Number.isFinite(pl.x) && Number.isFinite(pl.y)) entry.cam = { x: +pl.x, y: +pl.y };
			// the watcher vouches for its own recent input; the flag times out fast,
			// so a parked tab stops counting toward social boosts within seconds
			if(pl.act) markActive(entry);
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
		if(t - s.last.prog >= CAD.prog) progTick(s, t);
		chargeTick(s, t);
		for(const entry of entries()){ if(entry.assistant) sendAssistState(s, entry, false); }
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
		updateSocialBoost();
		const list = entries().filter(e => e.cam).map(e => ({ id: e.gid, name: e.name, x: +e.cam.x.toFixed(2), y: +e.cam.y.toFixed(2), a: e.avatar, act: e.actUntil > t ? 1 : 0 }));
		broadcast({ t: 'ghosts', list });
		if(t - (s.lastBadgeAt || 0) > 900){ s.lastBadgeAt = t; updateUi(); } // active-count on the badge stays fresh
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
		markActive(entry);
		if(entry.mode !== 'full'){ entry.peer.send({ t: 'buffAck', kind: pl.kind, ok: false, waitMs: 0, reason: 'perm' }); return; }
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
			// the world feedback (burst, sound, floating label) obeys the host's FX toggle;
			// the mechanical effect and the log line never do
			if(viewPrefs.fx){
				if(MMR && MMR.particles && MMR.particles.spawnBurst) MMR.particles.spawnBurst(p.x + p.w / 2, p.y + p.h / 2, fx.tier, {});
				if(MMR && MMR.audio && MMR.audio.play) MMR.audio.play(fx.sound);
			}
			noteActionFx(s, { kind: 'buff', hero: 1, text: (pl.kind === 'cheer' ? '✨' : pl.kind === 'bless' ? '💚' : '⚡') + ' ' + rule.label + ' — ' + (entry.name || 'Duch') });
			bridge.msg('👻 ' + (entry.name || 'Duch') + ': ' + rule.label + (rule.heal ? ' (+' + rule.heal + ' HP)' : rule.energy ? ' (+' + rule.energy + ' energii)' : '') + '!');
		}catch(e){ /* fx are best-effort */ }
		broadcast({ t: 'fx', kind: pl.kind, name: entry.name || 'Duch' });
		sendDeed(entry, pl.kind, 1); // cheer | bless | energy — only once the ledger said yes
	}

	// --- short texts (host-moderated, profanity-filtered) --------------------------------
	function handleChat(s, entry, pl){
		markActive(entry);
		if(!entry.hello || (entry.mode !== 'chat' && entry.mode !== 'full')) return;
		const t = now();
		if(t - entry.lastChatAt < CHAT_MIN_MS) return;
		const res = NET.filterChat(pl.text);
		if(res.empty) return;
		entry.lastChatAt = t;
		entry.lastChat = { text: res.text, until: t + 6000 };
		s.stats.chats++;
		// a per-watcher mute silences THIS host's log and bubble — fellow watchers
		// still get the relay (the mute is a display preference, not moderation;
		// that's what the permission ladder and the ban are for)
		if(!s.hiddenGids.has(entry.gid)){ try{ bridge.msg('💬 ' + (entry.name || 'Duch') + ': ' + res.text); }catch(e){ /* fine */ } }
		broadcast({ t: 'chat', gid: entry.gid, name: entry.name || 'Duch', text: res.text });
		// chatting pays, but on its own slower clock — the 4 s send floor must not
		// become an XP faucet
		if(t - (entry.chatXpAt || 0) >= NET.PROG.CHAT_XP_MS){ entry.chatXpAt = t; sendDeed(entry, 'chat', 1); }
	}

	// --- pings: a watcher points at a spot ------------------------------------------------
	// The marker lands at the SPIRIT's own tracked pose — the payload carries no
	// coordinates and none would be trusted. Communication-tier permission suffices.
	function handlePing(s, entry){
		markActive(entry);
		const t = now();
		if(!entry.hello || entry.mode === 'watch' || !entry.cam) return;
		if(t - (entry.lastPingAt || 0) < NET.PING.MIN_MS) return;
		entry.lastPingAt = t;
		s.stats.pings++;
		broadcast({ t: 'ping', gid: entry.gid, name: entry.name || 'Duch', x: +entry.cam.x.toFixed(2), y: +entry.cam.y.toFixed(2) });
		if(!s.hiddenGids.has(entry.gid)){
			noteActionFx(s, { kind: 'ping', x: entry.cam.x, y: entry.cam.y, text: '📍 ' + (entry.name || 'Duch'), ttl: NET.PING.TTL_MS });
			try{ bridge.msg('📍 ' + (entry.name || 'Duch') + ' wskazuje miejsce'); }catch(e){ /* fine */ }
		}
	}

	// --- the host's own voice: a bubble over the hero, mirrored to every watcher ------------
	// Same profanity filter and length cap as watcher chat — the host's text lands in
	// OTHER people's browsers, so it plays by the same rules it enforces.
	let hostChat = null, lastSayAt = 0;
	function say(raw){
		if(!session) return false;
		const t = now();
		if(t - lastSayAt < 800) return false; // Enter-spam must not flood the peers
		const res = NET.filterChat(raw);
		if(res.empty) return false;
		lastSayAt = t;
		hostChat = { text: res.text, until: t + 6000 };
		broadcast({ t: 'hostChat', text: res.text });
		try{ bridge.msg('🗨 Ty: ' + res.text); }catch(e){ /* fine */ }
		return true;
	}

	// --- watcher powers: strike the world at the spirit's own position -------------------
	// Authority stays here: the host validates the mode, the charge (accrued only
	// while the watcher was ACTIVE), the cooldown, and — critically — that the blow
	// lands at the spirit's OWN camera, never at coordinates the client picked.
	// Powers only ever touch MOBS, never tiles: a watcher cannot reshape the world.
	function handlePower(s, entry, pl){
		markActive(entry);
		const kind = pl.kind;
		if(!NET.validPowerKind(kind)) return;
		const rule = NET.POWER_RULES[kind];
		const t = now();
		if(entry.mode !== 'full'){ entry.peer.send({ t: 'powerAck', kind, ok: false, reason: 'perm', charge: entry.charge }); return; }
		if(!entry.cam){ entry.peer.send({ t: 'powerAck', kind, ok: false, reason: 'nopos', charge: entry.charge }); return; }
		if(entry.charge < rule.cost){ entry.peer.send({ t: 'powerAck', kind, ok: false, reason: 'charge', charge: entry.charge }); return; }
		const readyAt = (entry.powerCd && entry.powerCd[kind]) || 0;
		if(t < readyAt){ entry.peer.send({ t: 'powerAck', kind, ok: false, reason: 'cd', waitMs: Math.ceil(readyAt - t), charge: entry.charge }); return; }
		const hits = bridge.ghostPower(kind, entry.cam.x, entry.cam.y, rule);
		entry.charge -= rule.cost;
		if(!entry.powerCd) entry.powerCd = {};
		entry.powerCd[kind] = t + rule.cd;
		s.stats.powers++;
		// the blast is real either way — the ring, burst and sound obey the FX toggle
		if(viewPrefs.fx){
			try{
				if(MMR && MMR.particles && MMR.particles.spawnBurst) MMR.particles.spawnBurst(entry.cam.x, entry.cam.y, kind === 'smite' ? 'legendary' : 'epic', {});
				if(MMR && MMR.audio && MMR.audio.play) MMR.audio.play(kind === 'frost' ? 'freeze' : kind === 'smite' ? 'chainShock' : 'roar');
			}catch(e){ /* fx are best-effort */ }
		}
		noteActionFx(s, { kind: 'power', power: kind, x: entry.cam.x, y: entry.cam.y, text: rule.icon + ' ' + rule.label + ' — ' + (entry.name || 'Duch') });
		entry.peer.send({ t: 'powerAck', kind, ok: true, waitMs: rule.cd, charge: entry.charge, hits });
		broadcast({ t: 'powerFx', kind, x: +entry.cam.x.toFixed(2), y: +entry.cam.y.toFixed(2), name: entry.name || 'Duch', hits });
		try{ bridge.msg('👻 ' + (entry.name || 'Duch') + ': ' + rule.icon + ' ' + rule.label + (hits ? ' — ' + hits + ' celów!' : '')); }catch(e){ /* fine */ }
		sendDeed(entry, kind, 1);
		if(hits > 0) sendDeed(entry, 'hit', hits); // marksmanship pays extra (capped client-side)
	}
	function chargeTick(s, t){
		const dt = Math.min(2, (t - (s.lastChargeAt || t)) / 1000);
		s.lastChargeAt = t;
		for(const entry of entries()){
			const wasActive = entry.actUntil > t;
			const next = NET.chargeAfter(entry.charge, dt, wasActive);
			if(next !== entry.charge){
				entry.charge = next;
				if(t - (entry.lastChargeSentAt || 0) > 1000){
					entry.lastChargeSentAt = t;
					entry.peer.send({ t: 'charge', charge: +entry.charge.toFixed(1), active: wasActive ? 1 : 0 });
				}
			}
		}
	}

	// --- assistants: delegated watchers craft and manage the hero's gear -------------------
	// SEVERAL may hold the seat at once. Requests are executed serially right here, so
	// two assistants racing for the last resources resolve naturally: first one wins,
	// the second gets an honest 'cost' ack. With approvals ON nothing executes at all —
	// requests wait in the bounded queue until the host clicks Zatwierdź.
	function handleAssist(s, entry, pl){
		markActive(entry);
		const t = now();
		if(!entry.assistant || entry.mode !== 'full'){ entry.peer.send({ t: 'assistAck', ok: false, reason: 'perm' }); return; }
		if(!NET.validAssistAction(pl.a)){ entry.peer.send({ t: 'assistAck', ok: false, reason: 'action' }); return; }
		if(t - (entry.lastAssistActAt || 0) < NET.ASSIST_LIMITS.RATE_MS){ entry.peer.send({ t: 'assistAck', ok: false, reason: 'rate', a: pl.a }); return; }
		entry.lastAssistActAt = t;
		const id = typeof pl.id === 'string' ? pl.id.slice(0, 64) : '';
		if(!id){ entry.peer.send({ t: 'assistAck', ok: false, reason: 'id' }); return; }
		const n = pl.a === 'craft' ? NET.clampCraftCount(pl.n) : 1;
		if(approvalMode){
			// host-derived label only — and deriving it validates the id up front
			let label = null;
			try{ label = bridge.ghostAssistLabel(pl.a, id, n); }catch(e){ /* fall through */ }
			if(!label){ entry.peer.send({ t: 'assistAck', ok: false, reason: 'unknown', a: pl.a, id }); return; }
			const q = s.assistQueue.push({ gid: entry.gid, name: entry.name || 'Duch', a: pl.a, id, n, label }, t);
			entry.peer.send({ t: 'assistAck', ok: q.ok, queued: q.ok, reason: q.reason, a: pl.a, id, qid: q.qid });
			if(q.ok){
				try{ bridge.msg('⏳ ' + (entry.name || 'Duch') + ' proponuje: ' + label + ' — zatwierdź w panelu 👁'); }catch(e){ /* fine */ }
				updateUi();
			}
			return;
		}
		let res = null;
		try{ res = bridge.ghostAssist(pl.a, id, n); }catch(e){ res = { ok: false, reason: 'error' }; }
		s.stats.assists += res && res.ok ? 1 : 0;
		entry.peer.send({ t: 'assistAck', ok: !!(res && res.ok), reason: res && res.reason, a: pl.a, id, made: res && res.made });
		if(res && res.ok){
			try{ bridge.msg('🛠 ' + (entry.name || 'Duch') + ' (asystent): ' + res.label); }catch(e){ /* fine */ }
			noteActionFx(s, { kind: 'assist', hero: 1, text: '🛠 ' + res.label + ' — ' + (entry.name || 'Duch') });
			s.assistStateAt = 0; // the pouch just changed — rebuild the shared state now
			for(const e of entries()){ if(e.assistant) sendAssistState(s, e, true); }
			sendDeed(entry, pl.a, res.made || 1); // craft | equip | unequip
		}
	}
	// One serialization serves every assistant on the tick — N assistants must not
	// cost N ghostAssistState() calls per 1.5 s.
	function assistStateShared(s, t){
		if(!s.assistStateCache || t - (s.assistStateAt || 0) > 1000){
			s.assistStateCache = bridge.ghostAssistState();
			s.assistStateAt = t;
		}
		return s.assistStateCache;
	}
	function sendAssistState(s, entry, force){
		const t = now();
		if(!entry.assistant) return;
		if(!force && t - (entry.lastAssistAt || 0) < 1500) return;
		entry.lastAssistAt = t;
		try{ entry.peer.send({ t: 'assistState', data: assistStateShared(s, t), approval: approvalMode ? 1 : 0 }); }catch(e){ /* skip tick */ }
	}
	function setAssistant(gid, on){
		if(!session) return false;
		let hit = false;
		for(const entry of entries()){
			if(entry.gid !== gid) continue;
			if(on && entry.mode !== 'full') return false; // an assistant must be allowed to influence
			entry.assistant = !!on;
			entry.peer.send({ t: 'assistant', on: !!on });
			if(entry.assistant) sendAssistState(session, entry, true);
			hit = true;
		}
		if(hit){
			try{ bridge.msg(on ? '🛠 Asystent wyznaczony' : '🛠 Asystent odwołany'); }catch(e){ /* fine */ }
			updateUi();
		}
		return hit;
	}
	// --- the approval desk ------------------------------------------------------------------
	function notifyAssistDone(gid, payload){
		for(const entry of entries()){ if(entry.gid === gid){ try{ entry.peer.send(payload); }catch(e){ /* gone */ } } }
	}
	function approveAssist(qid){
		const s = session;
		if(!s) return false;
		const q = s.assistQueue.take(qid);
		if(!q) return false;
		// approval re-validates NOW: the world moved while the request sat in the queue
		let res = null;
		try{ res = bridge.ghostAssist(q.a, q.id, q.n); }catch(e){ res = { ok: false, reason: 'error' }; }
		s.stats.assists += res && res.ok ? 1 : 0;
		try{ bridge.msg(res && res.ok ? '🛠 Zatwierdzono: ' + res.label : '🛠 Nie udało się: ' + q.label); }catch(e){ /* fine */ }
		notifyAssistDone(q.gid, { t: 'assistDone', qid, ok: !!(res && res.ok), reason: res && res.reason, label: q.label });
		if(res && res.ok){
			noteActionFx(s, { kind: 'assist', hero: 1, text: '🛠 ' + res.label + ' — ' + q.name });
			s.assistStateAt = 0;
			for(const e of entries()){
				if(e.assistant) sendAssistState(s, e, true);
				if(e.gid === q.gid) sendDeed(e, q.a, res.made || 1);
			}
		}
		updateUi();
		return !!(res && res.ok);
	}
	function rejectAssist(qid){
		const s = session;
		if(!s) return false;
		const q = s.assistQueue.take(qid);
		if(!q) return false;
		notifyAssistDone(q.gid, { t: 'assistDone', qid, ok: false, reason: 'rejected', label: q.label });
		updateUi();
		return true;
	}

	// --- social facilitation: ACTIVE watchers strengthen the hero -------------------------
	// MM.socialBoost is read by mobs.awardMobXp (xp), the main.js movement/jump
	// multipliers (move/jump) and weapons.specialAttackRoll (dmg) — all default
	// to neutral 1.0 when this never runs (solo play, Node sims).
	function updateSocialBoost(){
		const t = now();
		let active = 0;
		const spirits = [];
		const owners = []; // index-aligned with spirits: who gets credit for a fright
		if(session){
			for(const e of session.peers.values()){
				if(!e.hello || e.actUntil <= t) continue;
				active++;
				// only ACTIVE watchers haunt the world (idle tabs are furniture)
				if(e.cam){ spirits.push({ x: e.cam.x, y: e.cam.y }); owners.push(e); }
			}
		}
		const boost = NET.socialBoosts(active);
		boost.viewers = session ? entries().length : 0;
		if(session) session.auraOwners = owners;
		if(MMR){
			MMR.socialBoost = boost;
			MMR.ghostAura.spirits = spirits;
		}
		return boost;
	}

	// --- watcher progression: the host mints the deeds ------------------------------------------
	// The viewer's career is stored in THEIR browser, but only the host can say what
	// really happened — so every XP-bearing deed originates here, right where the
	// event was validated. The claimed level that comes back is display-only: nothing
	// on this side (permissions, charge, cooldowns, the assistant seat) ever reads it.
	function sendDeed(entry, k, n){
		if(!entry || !entry.hello || !NET.validDeed(k)) return;
		try{ entry.peer.send({ t: 'deed', k, n: Math.max(1, Math.floor(n || 1)) }); }catch(e){ /* peer is going away */ }
	}
	// A creature bolting from a spirit credits its owner (mobs.js calls this once per
	// fright episode, with the spirit index dreadAt reported).
	function noteSpook(i){
		const s = session;
		if(!s || !Array.isArray(s.auraOwners)) return;
		const entry = s.auraOwners[i | 0];
		if(!entry) return;
		entry.spookN = (entry.spookN || 0) + 1;
	}
	function progTick(s, t){
		s.last.prog = t;
		// stale approval requests quietly expire — tell the assistant, refresh the desk
		const dead = s.assistQueue.expire(t);
		for(const q of dead) notifyAssistDone(q.gid, { t: 'assistDone', qid: q.qid, ok: false, reason: 'expired', label: q.label });
		if(dead.length) updateUi();
		for(const entry of entries()){
			// active watching is the only time that pays — an idle tab earns nothing,
			// exactly like the social boosts it mirrors
			if(entry.actUntil > t && t - (entry.watchT || 0) >= NET.PROG.WATCH_TICK_MS){
				entry.watchT = t;
				sendDeed(entry, 'watch', 1);
			}
			if(entry.spookN){
				sendDeed(entry, 'spook', Math.min(50, entry.spookN));
				entry.spookN = 0;
			}
		}
	}

	// --- moderation ---------------------------------------------------------------------------
	function setViewerMode(gid, mode){
		if(!session || !NET.validPermissionMode(mode)) return false;
		let hit = false;
		for(const entry of entries()){
			if(entry.gid !== gid) continue;
			entry.mode = mode;
			entry.peer.send({ t: 'perm', mode });
			hit = true;
		}
		if(hit) updateUi();
		return hit;
	}
	// Per-watcher hide: THIS host stops seeing the avatar, the bubbles and the log
	// lines of one spirit — a display mute, not moderation. The relay to fellow
	// watchers and the ghost's mechanics (dread, boosts, buffs) are untouched.
	function setViewerHidden(gid, on){
		if(!session || typeof gid !== 'string') return false;
		if(on) session.hiddenGids.add(gid); else session.hiddenGids.delete(gid);
		updateUi();
		return true;
	}
	function banViewer(gid){
		if(!session || typeof gid !== 'string') return false;
		session.banned.add(gid);
		for(const entry of Array.from(session.peers.values())){
			if(entry.gid !== gid) continue;
			try{ entry.peer.send({ t: 'banned' }); }catch(e){ /* fine */ }
			dropPeer(session, entry, true);
		}
		try{ bridge.msg('🚫 Duch zablokowany'); }catch(e){ /* fine */ }
		updateSocialBoost();
		updateUi();
		return true;
	}

	// --- spirits (shared painter — the client reuses it for fellow watchers) ------------
	// Contract: a spirit is SMALL (≤1/3 of the hero's ~1-tile frame → r=0.16 tile)
	// and ~50% translucent, so a full room of watchers can't clutter the stage or
	// obscure play. Avatar variants are procedural; idle watchers dim further.
	const SPIRIT_R = 0.16; // body radius in tiles (hero is ~0.95 tall)
	const SPIRIT_ALPHA = 0.5;
	const AVATAR_PAINTERS = {
		duszek(ctx, r){
			ctx.fillStyle = '#dceeff';
			ctx.beginPath();
			ctx.arc(0, -r * 0.25, r * 0.95, Math.PI, 0);
			ctx.lineTo(r * 0.95, r * 0.85);
			ctx.quadraticCurveTo(r * 0.5, r * 0.45, r * 0.05, r * 0.85);
			ctx.quadraticCurveTo(-r * 0.5, r * 0.45, -r * 0.95, r * 0.85);
			ctx.closePath(); ctx.fill();
			ctx.fillStyle = '#31465f';
			ctx.beginPath(); ctx.arc(-r * 0.32, -r * 0.28, r * 0.14, 0, Math.PI * 2); ctx.fill();
			ctx.beginPath(); ctx.arc(r * 0.32, -r * 0.28, r * 0.14, 0, Math.PI * 2); ctx.fill();
		},
		iskra(ctx, r){
			ctx.fillStyle = '#ffe9a8';
			ctx.beginPath();
			ctx.moveTo(0, -r * 1.1);
			ctx.quadraticCurveTo(r * 0.9, -r * 0.1, 0, r * 0.95);
			ctx.quadraticCurveTo(-r * 0.9, -r * 0.1, 0, -r * 1.1);
			ctx.fill();
			ctx.fillStyle = '#fff7dd';
			ctx.beginPath(); ctx.arc(0, r * 0.1, r * 0.4, 0, Math.PI * 2); ctx.fill();
		},
		gwiazdka(ctx, r){
			ctx.fillStyle = '#ffd76a';
			ctx.beginPath();
			for(let i = 0; i < 10; i++){
				const rr = i % 2 ? r * 0.45 : r;
				const a = -Math.PI / 2 + i * Math.PI / 5;
				ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr);
			}
			ctx.closePath(); ctx.fill();
		},
		kotek(ctx, r){
			ctx.fillStyle = '#cfd8ea';
			ctx.beginPath(); ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2); ctx.fill();
			ctx.beginPath(); ctx.moveTo(-r * 0.8, -r * 0.35); ctx.lineTo(-r * 0.55, -r * 1.05); ctx.lineTo(-r * 0.2, -r * 0.6); ctx.closePath(); ctx.fill();
			ctx.beginPath(); ctx.moveTo(r * 0.8, -r * 0.35); ctx.lineTo(r * 0.55, -r * 1.05); ctx.lineTo(r * 0.2, -r * 0.6); ctx.closePath(); ctx.fill();
			ctx.fillStyle = '#2b3a52';
			ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.1, r * 0.12, 0, Math.PI * 2); ctx.fill();
			ctx.beginPath(); ctx.arc(r * 0.3, -r * 0.1, r * 0.12, 0, Math.PI * 2); ctx.fill();
		},
		sowa(ctx, r){
			ctx.fillStyle = '#c9b28f';
			ctx.beginPath(); ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2); ctx.fill();
			ctx.fillStyle = '#fff';
			ctx.beginPath(); ctx.arc(-r * 0.32, -r * 0.15, r * 0.3, 0, Math.PI * 2); ctx.fill();
			ctx.beginPath(); ctx.arc(r * 0.32, -r * 0.15, r * 0.3, 0, Math.PI * 2); ctx.fill();
			ctx.fillStyle = '#2b3a52';
			ctx.beginPath(); ctx.arc(-r * 0.32, -r * 0.15, r * 0.13, 0, Math.PI * 2); ctx.fill();
			ctx.beginPath(); ctx.arc(r * 0.32, -r * 0.15, r * 0.13, 0, Math.PI * 2); ctx.fill();
			ctx.fillStyle = '#e8a13c';
			ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-r * 0.12, r * 0.28); ctx.lineTo(r * 0.12, r * 0.28); ctx.closePath(); ctx.fill();
		},
		orbita(ctx, r){
			ctx.fillStyle = '#9be8ff';
			ctx.beginPath(); ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2); ctx.fill();
			ctx.strokeStyle = '#9be8ff';
			ctx.lineWidth = Math.max(1, r * 0.18);
			ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.4, -0.5, 0, Math.PI * 2); ctx.stroke();
		}
	};
	// Two-pass painter: main.js calls pass 'body' BEFORE drawPlayer (spirits glide
	// behind the hero, never over its actions) and pass 'text' after the creature
	// layer (names, bubbles and action feedback stay readable over everything).
	// No pass argument = both, so any legacy caller still gets a whole spirit.
	function paintSpirit(ctx, TILE, x, y, name, t, self, avatar, active, chat, pass){
		const wantBody = pass !== 'text';
		const wantText = pass !== 'body';
		const bob = Math.sin((t || 0) / 480 + (x + y) * 1.7) * 0.05;
		const px = x * TILE, py = (y + bob) * TILE;
		const r = TILE * SPIRIT_R;
		ctx.save();
		ctx.globalAlpha = (self ? 0.35 : SPIRIT_ALPHA) * (active === false ? 0.55 : 1);
		if(wantBody){
			const grad = ctx.createRadialGradient(px, py, r * 0.2, px, py, r * 2.2);
			grad.addColorStop(0, 'rgba(190,225,255,0.55)');
			grad.addColorStop(1, 'rgba(120,170,255,0)');
			ctx.fillStyle = grad;
			ctx.beginPath(); ctx.arc(px, py, r * 2.2, 0, Math.PI * 2); ctx.fill();
			ctx.translate(px, py);
			(AVATAR_PAINTERS[avatar] || AVATAR_PAINTERS.duszek)(ctx, r);
			ctx.translate(-px, -py);
		}
		if(wantText && name){
			ctx.font = 'bold ' + Math.max(7, TILE * 0.16) + 'px system-ui';
			ctx.textAlign = 'center';
			ctx.fillStyle = '#cfe6ff';
			ctx.strokeStyle = 'rgba(6,12,20,0.8)';
			ctx.lineWidth = 2.5;
			ctx.strokeText(name, px, py - r * 2.1);
			ctx.fillText(name, px, py - r * 2.1);
		}
		if(wantText && chat && chat.until > (Date.now ? Date.now() : 0) && chat.text){
			paintChatBubble(ctx, TILE, x, y + bob - SPIRIT_R * 4.4, chat.text);
		}
		ctx.restore();
	}
	// Shared bubble painter (tile coords; y = the bubble TOP). The client reuses it
	// for fellow spirits and for the host's own words over the hero replica.
	function paintChatBubble(ctx, TILE, x, y, text){
		const line = String(text).slice(0, 40);
		const px = x * TILE;
		ctx.save();
		ctx.font = Math.max(8, TILE * 0.17) + 'px system-ui';
		const w = ctx.measureText(line).width + TILE * 0.3;
		const bx = px - w / 2, by = y * TILE, bh = TILE * 0.36;
		ctx.globalAlpha = 0.82;
		ctx.fillStyle = 'rgba(10,16,26,0.92)';
		ctx.beginPath();
		if(ctx.roundRect) ctx.roundRect(bx, by, w, bh, TILE * 0.1); else ctx.rect(bx, by, w, bh);
		ctx.fill();
		ctx.fillStyle = '#eaf3ff';
		ctx.textAlign = 'center';
		ctx.fillText(line, px, by + bh * 0.72);
		ctx.restore();
	}
	// Action feedback: floating labels over the hero (buffs, assistant work), power
	// rings and ping pulses at the spirit that acted. All of it obeys the FX toggle
	// at PAINT time, so flipping the switch silences even in-flight markers.
	function drawActionFx(ctx, TILE, t, p){
		const s = session;
		for(let i = s.actionFx.length - 1; i >= 0; i--){
			const f = s.actionFx[i];
			const age = (t - f.at) / (f.ttl || 2200);
			if(age >= 1){ s.actionFx.splice(i, 1); continue; }
			let px = f.x, py = f.y - age * 0.3;
			if(f.hero && p){ px = p.x; py = p.y - (p.h || 1) / 2 - 0.9 - age * 0.8; }
			if(!Number.isFinite(px) || !Number.isFinite(py)) continue;
			ctx.save();
			ctx.globalAlpha = age < 0.15 ? age / 0.15 : Math.max(0, 1 - Math.max(0, age - 0.6) / 0.4);
			if(f.kind === 'ping'){
				ctx.strokeStyle = '#ffd76a';
				ctx.lineWidth = 2.5;
				ctx.beginPath(); ctx.arc(f.x * TILE, f.y * TILE, TILE * (0.5 + (age * 2 % 1) * 0.9), 0, Math.PI * 2); ctx.stroke();
			} else if(f.kind === 'power'){
				const rule = NET.POWER_RULES[f.power];
				ctx.strokeStyle = f.power === 'frost' ? '#9be8ff' : f.power === 'smite' ? '#ffe9a8' : '#d9a8ff';
				ctx.lineWidth = 3;
				ctx.beginPath(); ctx.arc(f.x * TILE, f.y * TILE, (rule ? rule.r : 3) * TILE * (0.4 + age * 0.8), 0, Math.PI * 2); ctx.stroke();
			}
			if(f.text){
				ctx.font = 'bold ' + Math.max(8, TILE * 0.2) + 'px system-ui';
				ctx.textAlign = 'center';
				ctx.strokeStyle = 'rgba(6,12,20,0.85)';
				ctx.lineWidth = 3;
				ctx.fillStyle = '#ffe9a8';
				ctx.strokeText(f.text, px * TILE, py * TILE);
				ctx.fillText(f.text, px * TILE, py * TILE);
			}
			ctx.restore();
		}
	}
	function noteActionFx(s, fx){
		fx.at = now();
		s.actionFx.push(fx);
		if(s.actionFx.length > 10) s.actionFx.shift();
	}
	function drawSpirits(ctx, TILE, pass){
		if(!session) return;
		const wantBody = pass !== 'text';
		const wantText = pass !== 'body';
		const t = now();
		const ease = Math.min(1, (t - (session.lastSpiritDrawT || t)) / 1000 * 9);
		session.lastSpiritDrawT = t; // the second pass of a frame sees dt≈0 — no double-glide
		const p = bridge ? bridge.player : null;
		for(const entry of entries()){
			if(!entry.cam) continue;
			// eased display position — pose packets land at ~6 Hz, the glide hides it
			if(!entry.camPos) entry.camPos = { x: entry.cam.x, y: entry.cam.y };
			entry.camPos.x += (entry.cam.x - entry.camPos.x) * ease;
			entry.camPos.y += (entry.cam.y - entry.camPos.y) * ease;
			if(!viewPrefs.spirits || session.hiddenGids.has(entry.gid)) continue;
			// displayed hovering over the hero when the true pose would cover it
			const lift = p ? NET.spiritLift(entry.camPos.x, entry.camPos.y, p.x, p.y) : 0;
			if(wantBody) paintSpirit(ctx, TILE, entry.camPos.x, entry.camPos.y - lift, entry.name, t, false, entry.avatar, entry.actUntil > t, null, 'body');
			if(wantText) paintSpirit(ctx, TILE, entry.camPos.x, entry.camPos.y - lift, entry.name, t, false, entry.avatar, entry.actUntil > t, viewPrefs.bubbles ? entry.lastChat : null, 'text');
		}
		if(wantText){
			if(hostChat && hostChat.until > t && viewPrefs.bubbles && p) paintChatBubble(ctx, TILE, p.x, p.y - (p.h || 1) / 2 - 0.5, hostChat.text);
			if(viewPrefs.fx) drawActionFx(ctx, TILE, t, p);
		}
	}

	// --- host UI (top-bar 👁 icon + viewers panel) ----------------------------------------
	// Inviting an audience is a headline feature, not a debug switch: the entry point is a
	// permanent HUD button (#ghostBtn, next to ≡ in index.html) that doubles as the live
	// indicator — viewer count while streaming, boost strength in its tooltip.
	const PERM_KEY = 'mm_ghost_perm_v1';
	const APPROVE_KEY = 'mm_ghost_approve_v1';
	const VIEW_KEY = 'mm_ghost_view_v1';
	const MODE_LABEL = { watch: 'tylko ogląda', chat: '+ czat', full: '+ czat i wpływ' };
	let defaultMode = 'full'; // what a viewer gets on join, until the host says otherwise
	let approvalMode = false; // ON: assistant requests wait for the host's Zatwierdź
	// what of the audience the host wants ON SCREEN — display only, mechanics never care
	const viewPrefs = { spirits: true, bubbles: true, fx: true };
	try{
		const saved = (typeof localStorage !== 'undefined') ? localStorage.getItem(PERM_KEY) : null;
		if(NET.validPermissionMode(saved)) defaultMode = saved;
		approvalMode = (typeof localStorage !== 'undefined') && localStorage.getItem(APPROVE_KEY) === '1';
		const view = (typeof localStorage !== 'undefined') ? JSON.parse(localStorage.getItem(VIEW_KEY) || 'null') : null;
		if(view && typeof view === 'object'){ for(const k of Object.keys(viewPrefs)){ if(k in view) viewPrefs[k] = !!view[k]; } }
	}catch(e){ /* storage may be locked down */ }
	function setViewPref(key, on){
		if(!Object.prototype.hasOwnProperty.call(viewPrefs, key)) return false;
		viewPrefs[key] = !!on;
		try{ localStorage.setItem(VIEW_KEY, JSON.stringify(viewPrefs)); }catch(e){ /* fine */ }
		updateUi();
		return viewPrefs[key];
	}
	function setDefaultMode(mode){
		if(!NET.validPermissionMode(mode)) return false;
		defaultMode = mode;
		try{ localStorage.setItem(PERM_KEY, mode); }catch(e){ /* storage may be locked down */ }
		updateUi();
		return true;
	}
	function setApprovalMode(on){
		approvalMode = !!on;
		try{ localStorage.setItem(APPROVE_KEY, approvalMode ? '1' : '0'); }catch(e){ /* fine */ }
		// flipping the switch mid-session must reach the assistants' panels promptly
		if(session){ session.assistStateAt = 0; for(const e of entries()){ if(e.assistant) sendAssistState(session, e, true); } }
		updateUi();
		return approvalMode;
	}
	// --- social-facilitation meter: the audience's payout, always on screen ----------------
	// The boosts existed but lived in a hover tooltip, so the host never saw what an
	// audience was worth. The meter sits beside the 👁 button (inside #menuWrap, which
	// ghost mode hides wholesale — so it stays host-only for free) and states the
	// CUMULATIVE bonus. It is deliberately explicit about idleness: watchers who
	// haven't touched anything in 30 s pay nothing, and the meter says so rather than
	// quietly showing +0%.
	function ensureMeter(btn){
		if(ui.meter || typeof document === 'undefined' || !btn || !btn.parentNode) return;
		const m = document.createElement('button');
		m.type = 'button'; m.id = 'ghostMeter'; m.className = 'topbtn'; m.hidden = true;
		m.setAttribute('aria-label', 'Facylitacja społeczna — premia od aktywnych widzów');
		const cnt = document.createElement('span'); cnt.id = 'ghostMeterCount';
		const val = document.createElement('span'); val.id = 'ghostMeterVal';
		const bar = document.createElement('span'); bar.id = 'ghostMeterBar';
		const fill = document.createElement('span'); fill.id = 'ghostMeterFill';
		bar.appendChild(fill);
		m.append(cnt, val, bar);
		m.addEventListener('click', () => togglePanel(true)); // the meter is a door to the panel
		btn.parentNode.insertBefore(m, btn);
		ui.meter = m; ui.meterCount = cnt; ui.meterVal = val; ui.meterFill = fill;
	}
	function pct(mult){ return Math.round((mult - 1) * 100); }
	function renderMeter(boost, viewers, active){
		if(!ui.meter) return;
		// no session, no audience → the meter has nothing to say
		if(!session || viewers <= 0){ ui.meter.hidden = true; return; }
		ui.meter.hidden = false;
		const idle = active <= 0;
		ui.meter.classList.toggle('idle', idle);
		ui.meterCount.textContent = '⚡' + active + '/' + viewers;
		ui.meterVal.textContent = idle
			? 'brak premii'
			: '+' + pct(boost.xp) + '% XP · +' + pct(boost.move) + '%';
		// the fill reads "how much of my audience is actually with me"
		ui.meterFill.style.width = Math.round((active / Math.max(1, viewers)) * 100) + '%';
		ui.meter.title = idle
			? 'Facylitacja społeczna: ' + viewers + ' ' + (viewers === 1 ? 'duch jest bezczynny' : 'duchów jest bezczynnych')
				+ ' — bierny widz nie daje nic. Premia wraca, gdy widz znów coś zrobi (ruch kamerą, czat, moc).'
			: 'Facylitacja społeczna — ' + active + ' z ' + viewers + ' ' + (viewers === 1 ? 'ducha' : 'duchów') + ' aktywnych:\n'
				+ '+' + pct(boost.xp) + '% XP · +' + pct(boost.move) + '% szybkości · +' + pct(boost.jump) + '% wysokości skoku · +' + pct(boost.dmg) + '% obrażeń\n'
				+ 'Liczą się tylko widzowie, którzy coś robili w ciągu ostatnich 30 s.';
	}
	function mountEntryPoint(){
		if(typeof document === 'undefined') return;
		mountSayKey();
		const tryMount = () => {
			const btn = document.getElementById('ghostBtn');
			if(!btn || ui.menuBtn) return !!ui.menuBtn;
			btn.addEventListener('click', () => togglePanel(!panelOpen()));
			ui.menuBtn = btn;
			ensureMeter(btn);
			updateUi();
			return true;
		};
		if(!tryMount()){
			const iv = setInterval(() => { if(tryMount()) clearInterval(iv); }, 1000);
			setTimeout(() => clearInterval(iv), 20000);
		}
	}
	// The host's chat line: Enter opens a small input over the hotbar; Enter again
	// sends (say → bubble + broadcast), Esc abandons. Only while streaming, never in
	// ghost mode, never over a focused field or an open modal — and held movement
	// keys are released first so the hero doesn't keep walking while the host types.
	function mountSayKey(){
		if(ui.sayKeyMounted || typeof window === 'undefined') return;
		ui.sayKeyMounted = true;
		window.addEventListener('keydown', (e) => {
			if(e.key !== 'Enter' || e.repeat) return;
			if(!session || (MMR && MMR.ghostMode)) return;
			if(bridge && bridge.overlayHold && bridge.overlayHold()) return; // title/finale own the keys
			if(MMR && MMR.modalInput && MMR.modalInput.isOpen && MMR.modalInput.isOpen()) return;
			const a = document.activeElement;
			if(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return;
			openSayBox();
			e.preventDefault();
		});
	}
	function ensureSayBox(){
		if(ui.sayBox || typeof document === 'undefined') return ui.sayBox;
		const box = document.createElement('div');
		box.id = 'hostSay';
		box.style.cssText = 'position:fixed; left:50%; bottom:118px; transform:translateX(-50%); z-index:150; display:none; align-items:center; gap:6px;'
			+ ' padding:7px 9px; border-radius:12px; border:1px solid rgba(140,190,255,.4); background:rgba(10,15,24,.94); box-shadow:0 8px 24px rgba(0,0,0,.5); pointer-events:auto;';
		const inp = document.createElement('input');
		inp.id = 'hostSayInput';
		inp.maxLength = 90;
		inp.placeholder = 'Powiedz coś widzom… [Enter]';
		inp.autocomplete = 'off';
		inp.style.cssText = 'width:min(300px,60vw);background:rgba(20,26,36,.92);border:1px solid rgba(255,255,255,.2);border-radius:9px;color:#e6f0fb;padding:6px 9px;font:11.5px system-ui;outline:none;';
		inp.addEventListener('keydown', (e) => {
			if(e.key === 'Enter'){ if(say(inp.value)) inp.value = ''; closeSayBox(); e.preventDefault(); }
			else if(e.key === 'Escape'){ closeSayBox(); e.preventDefault(); }
			e.stopPropagation();
		});
		box.appendChild(inp);
		document.body.appendChild(box);
		ui.sayBox = box;
		return box;
	}
	function openSayBox(){
		const box = ensureSayBox();
		if(!box) return;
		try{ if(bridge && bridge.releaseInput) bridge.releaseInput(); }catch(e){ /* fine */ }
		box.style.display = 'flex';
		const inp = box.querySelector('#hostSayInput');
		inp.value = '';
		inp.focus();
	}
	function closeSayBox(){
		if(!ui.sayBox) return;
		ui.sayBox.style.display = 'none';
		try{ ui.sayBox.querySelector('#hostSayInput').blur(); }catch(e){ /* fine */ }
	}
	function styledButton(label, css){
		const b = document.createElement('button');
		b.type = 'button';
		b.textContent = label;
		b.style.cssText = css;
		return b;
	}
	function ensurePanel(){
		if(ui.panel || typeof document === 'undefined') return ui.panel;
		const el = document.createElement('div');
		el.id = 'ghostSharePanel';
		el.style.cssText = 'position:fixed; right:12px; top:56px; z-index:120; width:min(360px,calc(100vw - 24px)); max-height:calc(100vh - 76px); overflow-y:auto; overscroll-behavior:contain; display:none; flex-direction:column; gap:9px; padding:12px 14px; border-radius:14px; border:1px solid rgba(140,190,255,.35); background:rgba(12,17,26,.95); color:#e8f1fb; font:12px system-ui; box-shadow:0 10px 30px rgba(0,0,0,.55); pointer-events:auto;';
		el.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;">'
			+ '<b style="font-size:13px;">👁 Duchy Warstwy</b>'
			+ '<button id="ghostPanelClose" style="border:none;background:rgba(255,255,255,.12);color:#fff;width:24px;height:24px;border-radius:8px;cursor:pointer;">×</button></div>'
			+ '<div id="ghostPanelInfo" style="line-height:1.45;color:#b9c9dc;">Wyślij link, a znajomi wejdą do twojego świata jako DUCHY: oglądają grę na żywo, płoszą stwory i wzmacniają cię samą obecnością — ale nie ruszą ani jednego kafla.</div>'
			+ '<div id="ghostPanelLinkRow" style="display:none;gap:6px;"><input id="ghostPanelLink" readonly aria-label="Link dla widzów" style="flex:1;min-width:0;background:rgba(20,26,36,.9);border:1px solid rgba(255,255,255,.2);border-radius:8px;color:#d5e6ff;padding:6px 8px;font-size:11px;">'
			+ '<button id="ghostPanelCopy" style="border:none;border-radius:8px;background:#2c7ef8;color:#fff;font-weight:700;padding:6px 10px;cursor:pointer;">Kopiuj</button>'
			+ '<button id="ghostPanelShare" style="display:none;border:none;border-radius:8px;background:rgba(255,255,255,.14);color:#fff;font-weight:700;padding:6px 10px;cursor:pointer;">Wyślij</button></div>'
			+ '<label id="ghostPanelDefaultRow" style="display:none;align-items:center;gap:6px;color:#b9c9dc;">Nowi widzowie: '
			+ '<select id="ghostPanelDefault" style="flex:1;background:rgba(20,26,36,.9);color:#d5e6ff;border:1px solid rgba(255,255,255,.2);border-radius:6px;font-size:11px;padding:3px;"></select></label>'
			+ '<label id="ghostPanelApproveRow" style="display:none;align-items:center;gap:6px;color:#b9c9dc;cursor:pointer;">'
			+ '<input id="ghostPanelApprove" type="checkbox" style="width:auto;margin:0;">Zatwierdzam działania asystentów (kolejka propozycji)</label>'
			+ '<div id="ghostPanelViewRow" style="display:none;gap:10px;flex-wrap:wrap;color:#b9c9dc;">'
			+ '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;"><input data-pref="spirits" type="checkbox" style="width:auto;margin:0;">duchy</label>'
			+ '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;"><input data-pref="bubbles" type="checkbox" style="width:auto;margin:0;">dymki</label>'
			+ '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;"><input data-pref="fx" type="checkbox" style="width:auto;margin:0;">działania</label></div>'
			+ '<div id="ghostPanelSayRow" style="display:none;gap:6px;"><input id="ghostPanelSay" maxlength="90" autocomplete="off" placeholder="Powiedz coś widzom… [Enter]" aria-label="Wiadomość do widzów" style="flex:1;min-width:0;background:rgba(20,26,36,.9);border:1px solid rgba(255,255,255,.2);border-radius:8px;color:#d5e6ff;padding:6px 8px;font-size:11px;">'
			+ '<button id="ghostPanelSayBtn" style="border:none;border-radius:8px;background:rgba(255,255,255,.14);color:#fff;font-weight:700;padding:6px 10px;cursor:pointer;">🗨</button></div>'
			+ '<div id="ghostPanelQueue" style="display:none;flex-direction:column;gap:4px;"></div>'
			+ '<div id="ghostPanelViewers" style="color:#9fd6ae;"></div>'
			+ '<div id="ghostPanelPerks" style="line-height:1.45;color:#8fa4bb;font-size:11px;"></div>'
			+ '<button id="ghostPanelToggle" style="border:none;border-radius:10px;background:#21a366;color:#fff;font-weight:800;padding:9px 12px;cursor:pointer;">Rozpocznij transmisję</button>';
		document.body.appendChild(el);
		el.querySelector('#ghostPanelClose').addEventListener('click', () => togglePanel(false));
		el.querySelector('#ghostPanelCopy').addEventListener('click', () => {
			const inp = el.querySelector('#ghostPanelLink');
			inp.select();
			try{ navigator.clipboard.writeText(inp.value); }catch(e){ try{ document.execCommand('copy'); }catch(e2){ /* manual copy */ } }
			if(bridge) bridge.msg('Link skopiowany — wyślij go widzom!');
		});
		const share = el.querySelector('#ghostPanelShare');
		if(typeof navigator !== 'undefined' && navigator.share){
			share.style.display = 'inline-block';
			share.addEventListener('click', () => {
				try{ navigator.share({ title: 'Warstwy Symulacji', text: 'Popatrz na moją warstwę jako duch:', url: link() }); }catch(e){ /* user cancelled */ }
			});
		}
		const def = el.querySelector('#ghostPanelDefault');
		for(const val of NET.PERMISSION_MODES){
			const o = document.createElement('option');
			o.value = val; o.textContent = MODE_LABEL[val] || val;
			def.appendChild(o);
		}
		def.addEventListener('change', () => setDefaultMode(def.value));
		const approve = el.querySelector('#ghostPanelApprove');
		approve.addEventListener('change', () => {
			// blur FIRST, or the INPUT-focus guard skips the refresh setApprovalMode triggers
			approve.blur();
			setApprovalMode(approve.checked);
		});
		for(const cb of el.querySelectorAll('#ghostPanelViewRow input[data-pref]')){
			cb.addEventListener('change', () => { cb.blur(); setViewPref(cb.dataset.pref, cb.checked); });
		}
		const sayInp = el.querySelector('#ghostPanelSay');
		const doSay = () => { if(say(sayInp.value)) sayInp.value = ''; sayInp.blur(); };
		sayInp.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ doSay(); e.preventDefault(); } e.stopPropagation(); });
		el.querySelector('#ghostPanelSayBtn').addEventListener('click', doSay);
		el.querySelector('#ghostPanelToggle').addEventListener('click', () => {
			if(session) stop(); else start({});
			updateUi();
		});
		ui.panel = el;
		return el;
	}
	function panelOpen(){ return !!(ui.panel && ui.panel.style.display === 'flex'); }
	function togglePanel(show){
		const el = ensurePanel();
		if(!el) return;
		el.style.display = show ? 'flex' : 'none';
		if(ui.menuBtn) ui.menuBtn.setAttribute('aria-expanded', show ? 'true' : 'false');
		if(show) updateUi();
	}
	function viewerRow(entry, t){
		const row = document.createElement('div');
		row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 0;border-top:1px solid rgba(255,255,255,.08);';
		const dot = document.createElement('span');
		dot.textContent = entry.actUntil > t ? '⚡' : '💤';
		dot.title = entry.actUntil > t ? 'aktywny (wzmacnia)' : 'bezczynny >30 s (nie wzmacnia)';
		const nm = document.createElement('span');
		nm.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;';
		nm.textContent = entry.name || entry.gid;
		// the watcher's own career, as THEY report it — a badge, never a permission
		const rank = NET.rankFor(entry.level || 1);
		const badge = document.createElement('span');
		badge.style.cssText = 'font-size:10px;font-weight:800;white-space:nowrap;color:' + rank.color + ';';
		badge.textContent = 'Poz. ' + (entry.level || 1);
		badge.title = rank.name + ' — postępy widza (jego własne, nie dają mu żadnych uprawnień)';
		const sel = document.createElement('select');
		sel.style.cssText = 'background:rgba(20,26,36,.9);color:#d5e6ff;border:1px solid rgba(255,255,255,.2);border-radius:6px;font-size:10px;padding:2px;';
		for(const val of NET.PERMISSION_MODES){
			const o = document.createElement('option');
			o.value = val; o.textContent = MODE_LABEL[val] || val; o.selected = entry.mode === val;
			sel.appendChild(o);
		}
		sel.addEventListener('change', () => setViewerMode(entry.gid, sel.value));
		const asst = styledButton(entry.assistant ? '🛠 Asystent' : '🛠',
			'border:none;border-radius:6px;background:' + (entry.assistant ? 'rgba(255,184,74,.55)' : 'rgba(255,255,255,.12)') + ';color:#fff;font-size:10px;font-weight:700;padding:3px 7px;cursor:pointer;');
		asst.title = 'Asystent: może craftować i zarządzać twoim ekwipunkiem (wymaga trybu „+ czat i wpływ”)';
		asst.addEventListener('click', () => setAssistant(entry.gid, !entry.assistant));
		const hid = session.hiddenGids.has(entry.gid);
		const mute = styledButton(hid ? '🙈' : '👁',
			'border:none;border-radius:6px;background:' + (hid ? 'rgba(196,120,50,.5)' : 'rgba(255,255,255,.12)') + ';color:#fff;font-size:10px;font-weight:700;padding:3px 7px;cursor:pointer;');
		mute.title = hid ? 'Ukryty u ciebie — kliknij, by znów widzieć awatar i wiadomości tego widza'
			: 'Ukryj awatar i wiadomości tego widza (tylko na twoim ekranie; jego wpływ na grę zostaje)';
		mute.addEventListener('click', () => setViewerHidden(entry.gid, !hid));
		const ban = styledButton('Banuj', 'border:none;border-radius:6px;background:rgba(196,50,50,.5);color:#fff;font-size:10px;font-weight:700;padding:3px 7px;cursor:pointer;');
		ban.title = 'Wyrzuć i zablokuj tego widza do końca sesji';
		ban.addEventListener('click', () => banViewer(entry.gid));
		row.append(dot, nm, badge, sel, asst, mute, ban);
		return row;
	}
	function updateUi(){
		if(typeof document === 'undefined') return;
		const boost = updateSocialBoost();
		const list = entries();
		const t = now();
		const active = list.filter(e => e.actUntil > t).length;
		const pending = session ? session.assistQueue.size() : 0;
		const btn = ui.menuBtn;
		if(btn){
			const count = btn.querySelector('#ghostBtnCount');
			if(count) count.textContent = session && (list.length || pending)
				? String(list.length) + (pending ? ' ⏳' + pending : '') : '';
			btn.classList.toggle('live', !!session);
			btn.title = !session
				? 'Obserwatorzy — zaproś widzów do swojej warstwy'
				: 'Transmisja: pokój ' + session.room + ' · ' + list.length + ' duchów, ' + active + ' aktywnych'
					+ (active ? ' (+' + Math.round((boost.xp - 1) * 100) + '% XP, +' + Math.round((boost.move - 1) * 100) + '% szybkość/skok/obrażenia)' : '')
					+ (pending ? ' · ⏳' + pending + ' propozycji asystentów czeka' : '');
		}
		// the meter is a HUD surface, not panel chrome — it must refresh even when the
		// panel is shut or the host is mid-edit inside it (both early-return below)
		renderMeter(boost, list.length, active);
		const el = ui.panel;
		// A hidden panel gets no body refresh (the HUD button is the only live surface),
		// and neither does one the host is actively USING: the periodic rebuild would
		// yank an open permission dropdown shut or collapse a text selection in the
		// link input mid-copy.
		if(!el || el.style.display !== 'flex') return;
		const focusedTag = el.contains(document.activeElement) ? document.activeElement.tagName : null;
		if(focusedTag === 'SELECT' || focusedTag === 'INPUT') return;
		const linkRow = el.querySelector('#ghostPanelLinkRow');
		const defaultRow = el.querySelector('#ghostPanelDefaultRow');
		const toggle = el.querySelector('#ghostPanelToggle');
		const viewers = el.querySelector('#ghostPanelViewers');
		const perks = el.querySelector('#ghostPanelPerks');
		el.querySelector('#ghostPanelDefault').value = defaultMode;
		viewers.textContent = '';
		if(!session){
			linkRow.style.display = 'none';
			defaultRow.style.display = 'none';
			el.querySelector('#ghostPanelApproveRow').style.display = 'none';
			el.querySelector('#ghostPanelViewRow').style.display = 'none';
			el.querySelector('#ghostPanelSayRow').style.display = 'none';
			el.querySelector('#ghostPanelQueue').style.display = 'none';
			toggle.textContent = 'Rozpocznij transmisję';
			toggle.style.background = '#21a366';
			// derived from SOCIAL_RULES (via a one-viewer sample), so the pitch can never
			// drift away from what the engine actually pays
			perks.textContent = 'Aktywny widz (zrobił coś w ciągu ' + Math.round(NET.SOCIAL_RULES.IDLE_MS / 1000) + ' s) daje +'
				+ pct(NET.socialBoosts(1).xp) + '% XP oraz +' + pct(NET.socialBoosts(1).move) + '% szybkości, skoku i obrażeń. Bezczynne duchy nic nie dają.';
			return;
		}
		linkRow.style.display = 'flex';
		defaultRow.style.display = 'flex';
		el.querySelector('#ghostPanelApproveRow').style.display = 'flex';
		el.querySelector('#ghostPanelApprove').checked = approvalMode;
		el.querySelector('#ghostPanelViewRow').style.display = 'flex';
		for(const cb of el.querySelectorAll('#ghostPanelViewRow input[data-pref]')) cb.checked = !!viewPrefs[cb.dataset.pref];
		el.querySelector('#ghostPanelSayRow').style.display = 'flex';
		el.querySelector('#ghostPanelLink').value = link();
		toggle.textContent = 'Zakończ transmisję';
		toggle.style.background = '#c43232';
		// the approval desk: every pending assistant request with its own verdict pair
		const queueBox = el.querySelector('#ghostPanelQueue');
		queueBox.textContent = '';
		const pendingRows = session.assistQueue.list();
		queueBox.style.display = pendingRows.length ? 'flex' : 'none';
		for(const q of pendingRows){
			const row = document.createElement('div');
			row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:8px;background:rgba(255,184,74,.12);border:1px solid rgba(255,184,74,.35);';
			const lbl = document.createElement('span');
			lbl.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;';
			lbl.textContent = '⏳ ' + q.name + ': ' + q.label;
			const ok = styledButton('Zatwierdź', 'border:none;border-radius:6px;background:#21a366;color:#fff;font-size:10px;font-weight:700;padding:3px 8px;cursor:pointer;');
			ok.addEventListener('click', () => approveAssist(q.qid));
			const no = styledButton('Odrzuć', 'border:none;border-radius:6px;background:rgba(196,50,50,.5);color:#fff;font-size:10px;font-weight:700;padding:3px 8px;cursor:pointer;');
			no.addEventListener('click', () => rejectAssist(q.qid));
			row.append(lbl, ok, no);
			queueBox.appendChild(row);
		}
		if(!list.length){
			viewers.textContent = 'Czekam na duchy… wyślij link.';
		} else {
			const head = document.createElement('div');
			// percentages are DERIVED from the live boost — never retyped here, or a
			// tweak to SOCIAL_RULES would leave the panel quietly lying to the host
			head.style.cssText = 'margin-bottom:2px;color:' + (active ? '#9fd6ae' : '#8d99a8') + ';';
			head.textContent = 'Duchy (' + list.length + ')' + (active
				? ' — ⚡' + active + ' aktywnych: +' + pct(boost.xp) + '% XP, +' + pct(boost.move) + '% szybkość/skok/obrażenia'
				: ' — wszystkie bezczynne, brak premii');
			viewers.appendChild(head);
			for(const entry of list) viewers.appendChild(viewerRow(entry, t));
		}
		perks.textContent = 'Uprawnienia: „tylko ogląda” = sama obecność (płoszy stwory, wzmacnia). „+ czat” dopuszcza krótkie wiadomości i wskazywanie miejsc 📍 (filtr wulgaryzmów). „+ czat i wpływ” odblokowuje doping, błogosławieństwa i moce (popłoch/mróz/grom). 🛠 mianuje asystentów (może być kilku — gdy rywalizują o surowce, wygrywa szybszy), z zatwierdzaniem ich propozycje czekają na twoje Zatwierdź. Widok: „duchy/dymki/działania” chowają awatary, teksty i efekty (👁/🙈 przy widzu chowa jednego); Enter = szybka wiadomość do widzów.';
	}

	const api = { wire, start, stop, active, link, frame, metrics, drawSpirits, paintSpirit, paintChatBubble, say, setViewerMode, banViewer, setAssistant, setDefaultMode, setApprovalMode, setViewPref, setViewerHidden, approveAssist, rejectAssist, socialBoost: updateSocialBoost, openPanel: () => togglePanel(true) };
	if(MMR) MMR.ghostHost = api;
	if(typeof window !== 'undefined'){
		window.__mmGhostHostStart = (room, opts) => start(Object.assign({ room }, opts || {}));
		window.__mmGhostHostStop = () => stop();
	}
	return api;
})();

export { ghostHost };
export default ghostHost;
