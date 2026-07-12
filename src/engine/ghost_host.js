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

const CAD = { hero: 66, mobs: 120, mobsFull: 3000, drops: 1000, seasons: 5000, infra: 1500, presence: 200, reap: 4000, resnap: 10000 };
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
			banned: new Set(),
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
			stats: { tileMsgs: 0, snapshots: 0, buffs: 0, chats: 0, powers: 0, assists: 0 },
			lastChargeAt: 0,
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
			viewers: session ? entries().map(e => ({ gid: e.gid, name: e.name, mode: e.mode, avatar: e.avatar, active: e.actUntil > t, charge: +(e.charge || 0).toFixed(1), assistant: !!e.assistant })) : [],
			aura: (MMR && MMR.ghostAura) ? MMR.ghostAura.spirits.length : 0,
			banned: session ? session.banned.size : 0,
			boost: (MMR && MMR.socialBoost) ? Object.assign({}, MMR.socialBoost) : null,
			transports: session ? session.listen.transports : null,
			stats: session ? Object.assign({}, session.stats) : null
		};
	}

	// --- peers -----------------------------------------------------------------
	function onPeer(s, peer){
		const entry = {
			peer, gid: peer.id, name: null, cam: null, camPos: null, hello: false, lastSeen: now(),
			rateT: 0, rateN: 0, lastMobsReq: 0, lastChatAt: 0,
			mode: 'full', avatar: 'duszek', actUntil: 0, lastChat: null,
			charge: 0, powerCd: {}, assistant: false, lastAssistAt: 0, lastChargeSentAt: 0
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
				entry.peer.send({ t: 'welcome', proto: NET.GHOST_PROTO, host: s.name, room: s.room, mode: entry.mode });
				entry.lastSnapAt = now();
				sendSnapshot(s, entry.peer);
				try{ bridge.msg('👻 ' + entry.name + ' obserwuje twoją warstwę'); }catch(e){ /* fine */ }
				updateUi();
			}
		} else if(pl.t === 'avatar'){
			if(NET.validAvatar(pl.a)){ entry.avatar = pl.a; markActive(entry); }
		} else if(pl.t === 'chat'){
			handleChat(s, entry, pl);
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
			if(MMR && MMR.particles && MMR.particles.spawnBurst) MMR.particles.spawnBurst(p.x + p.w / 2, p.y + p.h / 2, fx.tier, {});
			if(MMR && MMR.audio && MMR.audio.play) MMR.audio.play(fx.sound);
			bridge.msg('👻 ' + (entry.name || 'Duch') + ': ' + rule.label + (rule.heal ? ' (+' + rule.heal + ' HP)' : rule.energy ? ' (+' + rule.energy + ' energii)' : '') + '!');
		}catch(e){ /* fx are best-effort */ }
		broadcast({ t: 'fx', kind: pl.kind, name: entry.name || 'Duch' });
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
		try{ bridge.msg('💬 ' + (entry.name || 'Duch') + ': ' + res.text); }catch(e){ /* fine */ }
		broadcast({ t: 'chat', gid: entry.gid, name: entry.name || 'Duch', text: res.text });
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
		entry.peer.send({ t: 'powerAck', kind, ok: true, waitMs: rule.cd, charge: entry.charge, hits });
		broadcast({ t: 'powerFx', kind, x: +entry.cam.x.toFixed(2), y: +entry.cam.y.toFixed(2), name: entry.name || 'Duch', hits });
		try{ bridge.msg('👻 ' + (entry.name || 'Duch') + ': ' + rule.icon + ' ' + rule.label + (hits ? ' — ' + hits + ' celów!' : '')); }catch(e){ /* fine */ }
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

	// --- assistant: a delegated watcher may craft and manage the hero's gear ---------------
	function handleAssist(s, entry, pl){
		markActive(entry);
		if(!entry.assistant || entry.mode !== 'full'){ entry.peer.send({ t: 'assistAck', ok: false, reason: 'perm' }); return; }
		if(!NET.validAssistAction(pl.a)){ entry.peer.send({ t: 'assistAck', ok: false, reason: 'action' }); return; }
		const id = typeof pl.id === 'string' ? pl.id.slice(0, 64) : '';
		if(!id){ entry.peer.send({ t: 'assistAck', ok: false, reason: 'id' }); return; }
		let res = null;
		try{ res = bridge.ghostAssist(pl.a, id); }catch(e){ res = { ok: false, reason: 'error' }; }
		s.stats.assists += res && res.ok ? 1 : 0;
		entry.peer.send({ t: 'assistAck', ok: !!(res && res.ok), reason: res && res.reason, a: pl.a, id });
		if(res && res.ok){
			try{ bridge.msg('🛠 ' + (entry.name || 'Duch') + ' (asystent): ' + res.label); }catch(e){ /* fine */ }
			sendAssistState(s, entry, true);
		}
	}
	function sendAssistState(s, entry, force){
		const t = now();
		if(!entry.assistant) return;
		if(!force && t - (entry.lastAssistAt || 0) < 1500) return;
		entry.lastAssistAt = t;
		try{ entry.peer.send({ t: 'assistState', data: bridge.ghostAssistState() }); }catch(e){ /* skip tick */ }
	}
	function setAssistant(gid, on){
		if(!session) return false;
		let hit = false;
		for(const entry of entries()){
			if(entry.gid === gid){
				if(on && entry.mode !== 'full') return false; // an assistant must be allowed to influence
				entry.assistant = !!on;
				entry.peer.send({ t: 'assistant', on: !!on });
				if(entry.assistant) sendAssistState(session, entry, true);
				hit = true;
			} else if(on && entry.assistant){
				// exactly one assistant at a time — the seat is handed over, not shared
				entry.assistant = false;
				entry.peer.send({ t: 'assistant', on: false });
			}
		}
		if(hit){
			try{ bridge.msg(on ? '🛠 Asystent wyznaczony' : '🛠 Asystent odwołany'); }catch(e){ /* fine */ }
			updateUi();
		}
		return hit;
	}

	// --- social facilitation: ACTIVE watchers strengthen the hero -------------------------
	// MM.socialBoost is read by mobs.awardMobXp (xp), the main.js movement/jump
	// multipliers (move/jump) and weapons.specialAttackRoll (dmg) — all default
	// to neutral 1.0 when this never runs (solo play, Node sims).
	function updateSocialBoost(){
		const t = now();
		let active = 0;
		const spirits = [];
		if(session){
			for(const e of session.peers.values()){
				if(!e.hello || e.actUntil <= t) continue;
				active++;
				// only ACTIVE watchers haunt the world (idle tabs are furniture)
				if(e.cam) spirits.push({ x: e.cam.x, y: e.cam.y });
			}
		}
		const boost = NET.socialBoosts(active);
		boost.viewers = session ? entries().length : 0;
		if(MMR){
			MMR.socialBoost = boost;
			MMR.ghostAura.spirits = spirits;
		}
		return boost;
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
	function paintSpirit(ctx, TILE, x, y, name, t, self, avatar, active, chat){
		const bob = Math.sin((t || 0) / 480 + (x + y) * 1.7) * 0.05;
		const px = x * TILE, py = (y + bob) * TILE;
		const r = TILE * SPIRIT_R;
		ctx.save();
		ctx.globalAlpha = (self ? 0.35 : SPIRIT_ALPHA) * (active === false ? 0.55 : 1);
		const grad = ctx.createRadialGradient(px, py, r * 0.2, px, py, r * 2.2);
		grad.addColorStop(0, 'rgba(190,225,255,0.55)');
		grad.addColorStop(1, 'rgba(120,170,255,0)');
		ctx.fillStyle = grad;
		ctx.beginPath(); ctx.arc(px, py, r * 2.2, 0, Math.PI * 2); ctx.fill();
		ctx.translate(px, py);
		(AVATAR_PAINTERS[avatar] || AVATAR_PAINTERS.duszek)(ctx, r);
		ctx.translate(-px, -py);
		if(name){
			ctx.font = 'bold ' + Math.max(7, TILE * 0.16) + 'px system-ui';
			ctx.textAlign = 'center';
			ctx.fillStyle = '#cfe6ff';
			ctx.strokeStyle = 'rgba(6,12,20,0.8)';
			ctx.lineWidth = 2.5;
			ctx.strokeText(name, px, py - r * 2.1);
			ctx.fillText(name, px, py - r * 2.1);
		}
		if(chat && chat.until > (Date.now ? Date.now() : 0) && chat.text){
			const line = String(chat.text).slice(0, 40);
			ctx.font = Math.max(8, TILE * 0.17) + 'px system-ui';
			const w = ctx.measureText(line).width + TILE * 0.3;
			const bx = px - w / 2, by = py - r * 4.4, bh = TILE * 0.36;
			ctx.globalAlpha = 0.82;
			ctx.fillStyle = 'rgba(10,16,26,0.92)';
			ctx.beginPath();
			if(ctx.roundRect) ctx.roundRect(bx, by, w, bh, TILE * 0.1); else ctx.rect(bx, by, w, bh);
			ctx.fill();
			ctx.fillStyle = '#eaf3ff';
			ctx.textAlign = 'center';
			ctx.fillText(line, px, by + bh * 0.72);
		}
		ctx.restore();
	}
	function drawSpirits(ctx, TILE){
		if(!session) return;
		const t = now();
		const ease = Math.min(1, (t - (session.lastSpiritDrawT || t)) / 1000 * 9);
		session.lastSpiritDrawT = t;
		for(const entry of entries()){
			if(!entry.cam) continue;
			// eased display position — pose packets land at ~6 Hz, the glide hides it
			if(!entry.camPos) entry.camPos = { x: entry.cam.x, y: entry.cam.y };
			entry.camPos.x += (entry.cam.x - entry.camPos.x) * ease;
			entry.camPos.y += (entry.cam.y - entry.camPos.y) * ease;
			paintSpirit(ctx, TILE, entry.camPos.x, entry.camPos.y, entry.name, t, false, entry.avatar, entry.actUntil > t, entry.lastChat);
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
		const boost = updateSocialBoost();
		if(badge){
			if(session){
				badge.style.display = 'inline-block';
				badge.textContent = '👁 ' + entries().length + (boost.active ? ' • ⚡' + boost.active : '') + ' • ' + session.room;
				badge.title = boost.active
					? 'Aktywne duchy wzmacniają: +' + Math.round((boost.xp - 1) * 100) + '% XP, +' + Math.round((boost.move - 1) * 100) + '% szybkość/skok/obrażenia'
					: 'Duchy obserwują — aktywni widzowie wzmacniają bohatera';
			} else badge.style.display = 'none';
		}
		const el = ui.panel;
		if(!el) return;
		const linkRow = el.querySelector('#ghostPanelLinkRow');
		const toggle = el.querySelector('#ghostPanelToggle');
		const viewers = el.querySelector('#ghostPanelViewers');
		viewers.textContent = '';
		if(session){
			linkRow.style.display = 'flex';
			el.querySelector('#ghostPanelLink').value = link();
			toggle.textContent = 'Zakończ transmisję';
			toggle.style.background = '#c43232';
			const list = entries();
			if(!list.length){
				viewers.textContent = 'Czekam na duchy… wyślij link.';
			} else {
				const t = now();
				const head = document.createElement('div');
				head.style.cssText = 'color:#9fd6ae;margin-bottom:2px;';
				head.textContent = 'Duchy (' + list.length + ')' + (boost.active ? ' — ⚡' + boost.active + ' aktywnych: +10% XP, +' + boost.active + '% szybkość/skok/obrażenia' : '');
				viewers.appendChild(head);
				for(const entry of list){
					const row = document.createElement('div');
					row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 0;border-top:1px solid rgba(255,255,255,.08);';
					const dot = document.createElement('span');
					dot.textContent = entry.actUntil > t ? '⚡' : '💤';
					dot.title = entry.actUntil > t ? 'aktywny (wzmacnia)' : 'bezczynny >30 s (nie wzmacnia)';
					const nm = document.createElement('span');
					nm.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;';
					nm.textContent = entry.name || entry.gid;
					const sel = document.createElement('select');
					sel.style.cssText = 'background:rgba(20,26,36,.9);color:#d5e6ff;border:1px solid rgba(255,255,255,.2);border-radius:6px;font-size:10px;padding:2px;';
					for(const [val, label] of [['watch', 'tylko ogląda'], ['chat', '+czat'], ['full', '+czat i wpływ']]){
						const o = document.createElement('option');
						o.value = val; o.textContent = label; o.selected = entry.mode === val;
						sel.appendChild(o);
					}
					sel.addEventListener('change', () => setViewerMode(entry.gid, sel.value));
					const asst = document.createElement('button');
					asst.textContent = entry.assistant ? '🛠 Asystent' : '🛠';
					asst.title = 'Asystent: może craftować i zarządzać twoim ekwipunkiem (wymaga trybu „+czat i wpływ”)';
					asst.style.cssText = 'border:none;border-radius:6px;background:' + (entry.assistant ? 'rgba(255,184,74,.55)' : 'rgba(255,255,255,.12)') + ';color:#fff;font-size:10px;font-weight:700;padding:3px 7px;cursor:pointer;';
					asst.addEventListener('click', () => setAssistant(entry.gid, !entry.assistant));
					const ban = document.createElement('button');
					ban.textContent = 'Banuj';
					ban.style.cssText = 'border:none;border-radius:6px;background:rgba(196,50,50,.5);color:#fff;font-size:10px;font-weight:700;padding:3px 7px;cursor:pointer;';
					ban.addEventListener('click', () => banViewer(entry.gid));
					row.append(dot, nm, sel, asst, ban);
					viewers.appendChild(row);
				}
			}
		} else {
			linkRow.style.display = 'none';
			toggle.textContent = 'Rozpocznij transmisję';
			toggle.style.background = '#21a366';
		}
	}

	const api = { wire, start, stop, active, link, frame, metrics, drawSpirits, paintSpirit, setViewerMode, banViewer, setAssistant, socialBoost: updateSocialBoost, openPanel: () => togglePanel(true) };
	if(MMR) MMR.ghostHost = api;
	if(typeof window !== 'undefined'){
		window.__mmGhostHostStart = (room, opts) => start(Object.assign({ room }, opts || {}));
		window.__mmGhostHostStop = () => stop();
	}
	return api;
})();

export { ghostHost };
export default ghostHost;
