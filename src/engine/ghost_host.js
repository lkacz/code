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

const CAD = { hero: 66, wfx: 66, mobs: 120, mobsFull: 3000, inv: 120, invFull: 3000, guard: 150, body: 80, drops: 1000, seasons: 5000, infra: 1500, presence: 200, reap: 4000, resnap: 4000, prog: 1000, pwat: 500, mach: 800 };
const CHAT_MIN_MS = NET.CHAT.MIN_MS; // per-peer chat floor (shared with the client's local mirror)
const ACT_POSE_TTL_MS = 6000; // an "active" pose vouches for the watcher this long
const ELECTRIC_CAUSE = /shock|electric|lightning|laser/; // wet bodies conduct these
const TILE_RESYNC_LIMIT = 3000;
const MAX_GHOSTS = 12; // every join serializes a full snapshot — cap the flood surface
const SNAP_REQ_MIN_MS = 5000; // per-peer floor for needSnap re-sends
const SNAP_CACHE_MS = 3000; // one save serialization serves every join/resync inside the window
const MOBS_REQ_MIN_MS = 1000; // needMobs costs a full mob serialize — per-peer floor
const PEER_MSG_WINDOW_MS = 2000, PEER_MSG_MAX = 240; // ~120 msg/s ceiling; a legit ghost sends ~5/s
const MODE_MEMORY_MS = 10 * 60 * 1000; // a transport blip must not demote a player mid-session
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
			last: { hero: 0, heroKeepalive: 0, wfx: 0, mobs: 0, mobsFull: 0, inv: 0, invFull: 0, guard: 0, body: 0, drops: 0, seasons: 0, infra: 0, presence: 0, reap: 0, prog: 0, pwat: 0 },
			auraOwners: [],
			lastMobSig: null,
			lastInvSig: null,
			invIdle: false,
			wfxBusy: false,
			guardBusy: false,
			lastDropsJson: null,
			lastHeroSent: null,
			infraDirty: true,
			prevRenderHook: null,
			stats: { tileMsgs: 0, snapshots: 0, buffs: 0, chats: 0, powers: 0, assists: 0, pings: 0, playMines: 0, playPlaces: 0, playStrikes: 0, playCrafts: 0 },
			pbWas: false,
			hiddenGids: new Set(), // per-watcher mute: THIS host's display only, never the relay
			actionFx: [], // visible feedback for watcher deeds: labels, rings, ping markers
			assistQueue: NET.createAssistQueue(),
			assistStateCache: null,
			assistStateAt: 0,
			lastChargeAt: 0,
			lastSimAt: now(), // a fresh session is not "idle" before its first sim frame
			duelAsks: new Map(), // 'challenger>target' → ts; a duel starts only on MUTUAL asks
			modeMemory: new Map(), // gid → {mode, ts}: embodied rungs survive a reconnect (auto-regrant)
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
		s.pump = setInterval(() => { try{ frame(0.25, now(), true); }catch(e){ /* next tick */ } }, 250);
		updateUi();
		try{ bridge.msg('👁 Transmisja warstwy otwarta — pokój ' + room); }catch(e){ /* boot order */ }
		return room;
	}

	function stop(){
		if(!session) return;
		keepAllBodies(session); // ending the stream banks every player's pouch first
		broadcast({ t: 'hostGone' });
		closeSayBox();
		hostChat = null;
		if(session.pump) clearInterval(session.pump);
		try{ session.listen.stop(); }catch(e){ /* fine */ }
		if(MMR){
			MMR.ghostHostTile = null;
			MMR.ghostSpook = null;
			MMR.coopBodies = []; // no session, no embodied guests — creatures stop checking
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
			players: session ? entries().filter(e => e.body).length : 0,
			bodies: session ? entries().filter(e => e.body).map(e => ({ gid: e.gid, x: +e.body.x.toFixed(2), y: +e.body.y.toFixed(2), hp: +e.body.hp.toFixed(1), mhp: e.body.maxHp, dead: !!e.body.dead, look: e.look || null, pouch: Object.assign({}, e.body.pouch) })) : [],
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
				if(typeof pl.gid === 'string' && pl.gid) entry.gid = pl.gid.slice(0, 40);
				if(s.banned.has(entry.gid)){
					entry.peer.send({ t: 'banned' });
					dropPeer(s, entry, true);
					return;
				}
				// one gid = one seat: a watcher reconnecting after a dirty drop must not
				// be twinned with (or squeezed out by) its own corpse the reaper hasn't
				// swept yet — the newest connection wins the seat. An impostor who
				// captured a gid gains nothing: the fresh entry starts at defaults (no
				// assistant seat, default mode) and the ousted watcher can just rejoin.
				for(const other of Array.from(s.peers.values())){
					if(other !== entry && other.hello && other.gid === entry.gid) dropPeer(s, other, true);
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
				sendInvFull(s, entry.peer); // the world save carries invasions, but a fresh
				                            // roster sig is what unlocks the live pose plane
				// chosen body colors, so a late joiner paints every player right away
				for(const other of entries()){ if(other !== entry && other.look){ try{ entry.peer.send({ t: 'plook', gid: other.gid, c: other.look }); }catch(e){ /* fine */ } } }
				sendDeed(entry, 'join', 1);
				// auto-regrant: a returning embodied guest gets its rung back — the ban
				// path above already refused anyone the host threw out
				const kept = s.modeMemory ? s.modeMemory.get(entry.gid) : null;
				if(kept && now() - kept.ts < MODE_MEMORY_MS && (kept.mode === 'play' || kept.mode === 'hero')){
					s.modeMemory.delete(entry.gid);
					entry.mode = kept.mode;
					entry.heroMode = kept.mode === 'hero';
					if(!entry.body) spawnBody(s, entry);
					entry.peer.send({ t: 'perm', mode: kept.mode });
					try{ bridge.msg('🎮 ' + entry.name + ' wraca do gry po zerwaniu'); }catch(e){ /* fine */ }
				} else {
					try{ bridge.msg('👻 ' + entry.name + ' obserwuje twoją warstwę'); }catch(e){ /* fine */ }
				}
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
		} else if(pl.t === 'plook'){
			// the guest's chosen body color: embodied viewers only, strict hex (it
			// reaches fillStyle on every renderer), rate-floored, display-only
			const tL = now();
			if(entry.body && NET.validLookColor(pl.c) && tL - (entry.lastLookAt || 0) >= NET.PLAY_RULES.LOOK_MS){
				entry.lastLookAt = tL;
				entry.look = pl.c.toLowerCase();
				markActive(entry);
				broadcast({ t: 'plook', gid: entry.gid, c: entry.look });
			}
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
		} else if(pl.t === 'ppose'){
			// an embodied guest's own hero: the claimed pose is followed inside a
			// per-axis speed envelope — an honest client never feels the clamp, a
			// teleport hack rubber-bands. The pose doubles as the guest's camera so
			// pings and powers keep working from the same tracked spot.
			const b = entry.body;
			// hero-mode bodies accept poses while "dead" too: the guest respawns
			// ITSELF (vitals are its local truth) and announces the comeback here
			// a driving hero guest: position claims are IGNORED (the cab is the
			// authority) — the pose packet carries only the steering bits and vitals
			if(b && entry.heroMode && MMR && MMR.mechs && MMR.mechs.guestDriveInfo){
				const di = MMR.mechs.guestDriveInfo(entry.gid);
				if(di){
					if(MMR.mechs.guestSetControls) MMR.mechs.guestSetControls(entry.gid, { l: (pl.c & 1) !== 0, r: (pl.c & 2) !== 0, u: (pl.c & 4) !== 0 });
					b.x = di.x + 0.5; b.y = di.y - 0.2; b.vx = di.vx; b.vy = di.vy;
					b.lastPoseAt = t;
					b.poseSeq = (Number(pl.q) >>> 0) || 0;
					if(Number.isFinite(pl.hp)) b.hp = Math.max(0, Math.min(NET.HERO_RULES.HP_MAX, +pl.hp));
					if(pl.act) markActive(entry);
					entry.cam = { x: b.x, y: b.y };
					return;
				}
			}
			if(b && (!b.dead || entry.heroMode) && Number.isFinite(pl.x) && Number.isFinite(pl.y)){
				// the dt floor is ZERO, not a synthetic minimum: a per-message floor
				// hands out movement budget per CLAIM, so spamming claims (120 msg/s
				// under the rate cap × 16 ms credited each) would outrun MAX_SPEED 2:1 —
				// with real elapsed time only, spam buys nothing
				const dtS = Math.min(0.5, Math.max(0, (t - (b.lastPoseAt || t)) / 1000));
				b.lastPoseAt = t;
				const maxStep = NET.PLAY_RULES.MAX_SPEED * dtS;
				const px = b.x, py = b.y;
				b.x = NET.clampBodyStep(b.x, +pl.x, maxStep);
				b.y = NET.clampBodyStep(b.y, +pl.y, maxStep);
				// velocity is DERIVED from the accepted movement, never read off the
				// claim: party-aware attackers lead their aim by vx/vy, so a spoofed
				// velocity would let a stationary cheater dodge every predictive shot
				if(dtS >= 0.001){
					b.vx = Math.max(-40, Math.min(40, (b.x - px) / dtS));
					b.vy = Math.max(-40, Math.min(40, (b.y - py) / dtS));
				}
				b.f = pl.f < 0 ? -1 : 1;
				b.poseSeq = (Number(pl.q) >>> 0) || 0; // echoed in the pb own row for reconciliation
				// hero mode: vitals are guest-local truth (owner ruling) — the claim
				// is display/targeting state for creatures and health bars, clamped
				if(entry.heroMode){
					if(Number.isFinite(pl.hp)) b.hp = Math.max(0, Math.min(NET.HERO_RULES.HP_MAX, +pl.hp));
					if(Number.isFinite(pl.mhp)) b.maxHp = Math.max(1, Math.min(NET.HERO_RULES.HP_MAX, +pl.mhp));
					b.dead = b.hp <= 0;
					if(b.dead && b.duelWith) endDuel(s, entry); // a hero death settles the duel too
				}
			}
			if(Number.isFinite(pl.x) && Number.isFinite(pl.y)) entry.cam = { x: +pl.x, y: +pl.y };
			if(pl.act) markActive(entry);
		} else if(pl.t === 'pact'){
			handlePlayAct(s, entry, pl);
		} else if(pl.t === 'hact'){
			handleHeroAct(s, entry, pl);
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
		// remember the embodied rung: the grant was the HOST's own decision for this
		// gid, and a transport blip must not demote a player mid-session
		if(entry.hello && (entry.mode === 'play' || entry.mode === 'hero') && s.modeMemory) s.modeMemory.set(entry.gid, { mode: entry.mode, ts: now() });
		if(entry.body) keepBody(entry); // a vanished player's pouch survives its connection
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
	// Invasions ride their own plane, exactly like the mobs: the watcher never runs
	// invasions.update() (a spectator must not spawn, dig or steal), so without this
	// the landing party stood frozen wherever the last full snapshot caught it.
	function sendInvFull(s, peer){
		try{
			const I = MMR && MMR.invasions;
			if(!I || !I.snapshot) return;
			const pl = { t: 'invFull', data: I.snapshot() };
			if(peer) peer.send(pl); else broadcast(pl);
			s.lastInvSig = (I.ghostRoster ? I.ghostRoster().sig : null);
			s.last.invFull = now();
		}catch(e){ /* next tick retries */ }
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
	function frame(dt, ts, fromPump){
		const s = session;
		if(!s || !bridge) return;
		const t = Number.isFinite(ts) ? ts : now();
		// only the SIM loop calls without fromPump — a stale stamp means the host tab
		// is backgrounded (rAF frozen): the world stands still while the pump keeps
		// the stream alive, and the viewers deserve to be TOLD instead of guessing
		if(!fromPump) s.lastSimAt = t;
		const live = entries(); // one snapshot serves the whole frame (charge/assist/prog reuse it)
		if(!live.length){
			s.pendingTiles.clear(); s.needResync = false;
			// tile capture is OFF with zero watchers, so the cached snapshot and its
			// replay buffer go stale the moment the audience empties — a re-join
			// inside the cache window must get a fresh serialization, not old cells
			s.snapCache = null; s.sinceCache.length = 0;
			reap(s, t);
			return;
		}
		if(s.needResync){
			if(t - s.lastSnapAt > CAD.resnap){
				s.needResync = false;
				let fresh = true; // one rebuild covers the whole burst — later peers reuse it
				for(const entry of live){ sendSnapshot(s, entry.peer, fresh); fresh = false; }
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
		if(t - s.last.wfx >= CAD.wfx) weaponTick(s, t);
		if(t - s.last.mobs >= CAD.mobs) mobTick(s, t);
		if(t - s.last.inv >= CAD.inv) invTick(s, t);
		if(t - s.last.guard >= CAD.guard) guardTick(s, t);
		if(t - s.last.body >= CAD.body) bodyTick(s, t);
		if(t - s.last.drops >= CAD.drops) dropTick(s, t);
		if(t - s.last.seasons >= CAD.seasons) seasonTick(s, t);
		if(s.infraDirty && t - s.last.infra >= CAD.infra) infraTick(s, t);
		if(t - s.last.presence >= CAD.presence) presenceTick(s, t);
		if(t - s.last.pwat >= CAD.pwat) pwatTick(s, t);
		if(t - (s.last.mach || 0) >= (s.machFast ? 150 : CAD.mach)) machTick(s, t); // driven cab = smooth ride
		if(t - s.last.prog >= CAD.prog) progTick(s, t, live);
		chargeTick(s, t, live);
		for(const entry of live){ if(entry.assistant) sendAssistState(s, entry, false); }
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
	function invTick(s, t){
		s.last.inv = t;
		const I = MMR && MMR.invasions;
		if(!I || !I.ghostRoster) return;
		const roster = I.ghostRoster();
		// nothing invading: send one empty sync so a watcher's stale squad clears
		if(!roster.sig && !s.lastInvSig && s.invIdle) return;
		s.invIdle = !roster.sig;
		if(roster.sig !== s.lastInvSig || t - s.last.invFull > CAD.invFull){ sendInvFull(s, null); }
		else broadcast({ t: 'inv', sig: roster.sig, poses: roster.poses, props: roster.props });
	}
	// The guardian arena: the save snapshot deliberately drops live entities
	// (guardian_lairs.restore clears the fight), so a watcher used to face an
	// EMPTY lair while the hero visibly battled something. While anything is
	// alive in an arena, the host streams a compact cosmetic mirror (bosses,
	// sidekicks, hazards, effects); one trailing null clears the watcher's copy
	// when the fight ends — same busy-latch as the weapon-FX plane.
	function guardTick(s, t){
		s.last.guard = t;
		const G = MMR && MMR.guardianLairs;
		if(!G || !G.ghostMirrorState) return;
		let st = null;
		try{ st = G.ghostMirrorState(); }catch(e){ return; }
		if(!st && !s.guardBusy) return; // empty arena → silence
		s.guardBusy = !!st;
		broadcast({ t: 'guard', data: st });
	}
	// The hero's weapons: cosmetic FX only (swing arc, arrows, stream puffs, beams,
	// blasts). Without this the watcher saw the hero walk around and never land a
	// blow. Sent at hero cadence and only while something is actually happening —
	// plus one trailing packet to clear the watcher's screen when it stops.
	function weaponTick(s, t){
		s.last.wfx = t;
		const W = MMR && MMR.weapons;
		if(!W || !W.ghostFxState) return;
		let st = null;
		try{ st = W.ghostFxState(); }catch(e){ return; }
		const busy = !!(st && (st.sw || st.ar || st.pf || st.eb || st.bl));
		if(!busy && !s.wfxBusy) return; // idle → silence
		s.wfxBusy = busy;
		broadcast({ t: 'wfx', fx: st || {} });
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
		// idle = the host tab is backgrounded (sim frozen, pump-only stream) — the
		// viewers show a "host inactive" banner instead of staring at a frozen world
		broadcast({ t: 'ghosts', list, idle: (t - (s.lastSimAt || t)) > 1500 ? 1 : 0 });
		if(t - (s.lastBadgeAt || 0) > 900){ s.lastBadgeAt = t; updateUi(); } // active-count on the badge stays fresh
	}
	// Sub-tile water windows: the save/wire format deliberately drops partial levels,
	// so watchers rendered every replicated water cell as a full block (a swimming
	// guest visibly diverged). Stream small windows of the partial ledger around the
	// host hero and each body; a clearing packet follows the last wet one (latch).
	function pwatTick(s, t){
		s.last.pwat = t;
		const W = MMR && MMR.water;
		if(!W || !W.ghostPartialsIn) return;
		const wins = [];
		const p = bridge.player;
		if(p && Number.isFinite(p.x) && Number.isFinite(p.y)) wins.push([Math.floor(p.x) - 10, Math.floor(p.y) - 6, Math.floor(p.x) + 10, Math.floor(p.y) + 6]);
		for(const entry of entries()){
			const b = entry.body;
			if(b && !b.dead && wins.length < 6) wins.push([Math.floor(b.x) - 8, Math.floor(b.y) - 5, Math.floor(b.x) + 8, Math.floor(b.y) + 5]);
		}
		const payload = [];
		let any = false;
		for(const w of wins){
			let rows = [];
			try{ rows = W.ghostPartialsIn(w[0], w[1], w[2], w[3]) || []; }catch(e){ rows = []; }
			if(rows.length) any = true;
			payload.push([w[0], w[1], w[2], w[3], rows]);
		}
		if(!any && !s.pwatWas) return;
		const sig = JSON.stringify(payload);
		if(any && sig === s.lastPwatSig) return;
		s.lastPwatSig = sig;
		s.pwatWas = any;
		broadcast({ t: 'pwat', w: payload });
	}
	// Vehicles ride their own low-Hz plane: boats and mechs are save-codec state
	// (the join snapshot already carries them), but between joins they used to
	// stand frozen wherever the save caught them. Same sig-skip contract as the
	// drops plane — silence while nothing moves, one packet per real change.
	function machTick(s, t){
		s.last.mach = t;
		try{
			const B = MMR && MMR.boats, M = MMR && MMR.mechs;
			s.machFast = !!(M && M.anyGuestDriven && M.anyGuestDriven());
			const data = {
				b: (B && B.snapshot) ? B.snapshot() : null,
				m: (M && M.snapshot) ? M.snapshot() : null
			};
			if(!data.b && !data.m) return;
			const sig = JSON.stringify(data);
			if(sig === s.lastMachSig) return;
			s.lastMachSig = sig;
			broadcast({ t: 'mach', data });
		}catch(e){ /* codec hiccup — next tick retries */ }
	}
	function reap(s, t){
		s.last.reap = t;
		for(const entry of Array.from(s.peers.values())){
			if(t - entry.lastSeen > 15000) dropPeer(s, entry, true);
		}
		keepAllBodies(s); // slow-cadence flush: mined loot survives even a host crash
	}

	// --- blessings -------------------------------------------------------------------
	function handleBuff(s, entry, pl){
		if(!NET.validBuffKind(pl.kind)){ entry.peer.send({ t: 'buffAck', kind: pl.kind, ok: false, waitMs: 0 }); return; }
		markActive(entry);
		if(!NET.modeAllows(entry.mode, 'full')){ entry.peer.send({ t: 'buffAck', kind: pl.kind, ok: false, waitMs: 0, reason: 'perm' }); return; }
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
		if(!entry.hello || !NET.modeAllows(entry.mode, 'chat')) return;
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
		if(!entry.hello || !NET.modeAllows(entry.mode, 'chat') || !entry.cam) return;
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
		if(!NET.modeAllows(entry.mode, 'full')){ entry.peer.send({ t: 'powerAck', kind, ok: false, reason: 'perm', charge: entry.charge }); return; }
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
	function chargeTick(s, t, live){
		const dt = Math.min(2, (t - (s.lastChargeAt || t)) / 1000);
		s.lastChargeAt = t;
		for(const entry of (live || entries())){
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

	// --- play mode: embodied guests (full multiplayer) --------------------------------------
	// The ghost ladder gains a top rung: a viewer promoted to `play` gets an OWN
	// hero in this world — moving on the guest's machine (guest-authoritative pose
	// inside a speed envelope), everything else host-authoritative: vitals, pouch,
	// and every world edit go through the validated bridge seams. The ghost tiers
	// below stay untouched — spectating remains the default door.
	// --- body persistence: the host's save is the ONLY authority --------------------
	// A returning guest (stable client gid) gets its pouch and earned arsenal back
	// from HOST-side storage. The gid is a self-claimed key — the contents were
	// written by this host and are still treated as hostile input on read (clamped
	// counts, whitelisted weapons), because disk is disk (normalizeProgress rule).
	// Ephemeral fallback: no storage → sessions simply start fresh.
	const BODY_KEEP_KEY = 'mm_ghost_bodies_v1';
	const BODY_KEEP_MAX = 24;
	const BODY_KEEP_TTL_MS = 7 * 24 * 3600 * 1000;
	function readBodyKeep(){
		try{
			const raw = (typeof window !== 'undefined' && window.localStorage) ? window.localStorage.getItem(BODY_KEEP_KEY) : null;
			const o = raw ? JSON.parse(raw) : null;
			return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
		}catch(e){ return {}; }
	}
	function keepBody(entry){
		if(!entry || !entry.body || typeof entry.gid !== 'string') return;
		try{
			const store = readBodyKeep();
			store[entry.gid] = {
				pouch: Object.assign({}, entry.body.pouch),
				weapons: (entry.body.weapons || []).filter(k => NET.validPlayWeapon(k)).slice(0, 8),
				ts: Date.now()
			};
			const gids = Object.keys(store).sort((a, b) => (store[b].ts || 0) - (store[a].ts || 0));
			for(const g of gids.slice(BODY_KEEP_MAX)) delete store[g];
			for(const g of Object.keys(store)) if(Date.now() - (store[g].ts || 0) > BODY_KEEP_TTL_MS) delete store[g];
			window.localStorage.setItem(BODY_KEEP_KEY, JSON.stringify(store));
		}catch(e){ /* no storage → explicitly ephemeral, and that is fine */ }
	}
	function keepAllBodies(s){
		for(const entry of entries()) if(entry.body) keepBody(entry);
	}
	function restoreBodyFor(gid, body){
		try{
			const snap = readBodyKeep()[gid];
			if(!snap || typeof snap !== 'object') return false;
			if(snap.pouch && typeof snap.pouch === 'object'){
				// the snapshot REPLACES the starter pouch — otherwise every rejoin farms
				// a fresh quiver of starter arrows
				body.pouch = {};
				for(const k of Object.keys(snap.pouch).slice(0, 40)){
					const n = Math.floor(Number(snap.pouch[k]) || 0);
					if(k && k !== '__proto__' && n > 0) NET.pouchAdd(body.pouch, k, n);
				}
			}
			if(Array.isArray(snap.weapons)){
				for(const k of snap.weapons.slice(0, 8)) if(NET.validPlayWeapon(k) && !body.weapons.includes(k)) body.weapons.push(k);
			}
			return true;
		}catch(e){ return false; }
	}
	function spawnBody(s, entry){
		const p = bridge.player;
		entry.body = {
			x: p.x, y: p.y - 0.2, vx: 0, vy: 0, f: 1,
			hp: NET.PLAY_RULES.MAX_HP, maxHp: NET.PLAY_RULES.MAX_HP,
			// the arsenal is HOST state: starter kit + whatever this gid earned before
			// — a client-side claim to any other weapon dies in handlePlayAct
			weapons: NET.PLAY_STARTER_WEAPONS.slice(),
			pouch: Object.assign({}, NET.PLAY_STARTER_AMMO),
			dead: false, respawnAt: 0, invulUntil: now() + 1500,
			mine: null, lastMineAt: 0, lastPlaceAt: 0, lastStrikeAt: 0, lastAttackAt: 0, lastCraftAt: 0, lastPoseAt: 0, disp: null
		};
		restoreBodyFor(entry.gid, entry.body);
		sendVitals(s, entry);
		try{ bridge.msg('🎮 ' + (entry.name || 'Duch') + ' wciela się w twoją warstwę!'); }catch(e){ /* fine */ }
		updateUi();
	}
	// --- consensual duels (owner ruling): PvP between guests exists ONLY as a duel
	// both sides asked for. Host-arbitrated end to end: mutual-consent handshake,
	// melee-only resolution in the attack branch, ended by death, demotion or leave.
	// The HOST hero is never a duel target, and nothing here persists (keepBody
	// copies pouch + weapons only).
	function endDuel(s, entry, silent){
		const b = entry.body;
		if(!b || !b.duelWith) return;
		const otherGid = b.duelWith;
		b.duelWith = null;
		for(const e of entries()){
			if(e.gid === otherGid && e.body && e.body.duelWith === entry.gid) e.body.duelWith = null;
		}
		broadcast({ t: 'duel', a: entry.gid, b: otherGid, on: 0 });
		if(!silent){ try{ bridge.msg('⚔ Pojedynek zakończony'); }catch(e){ /* fine */ } }
	}
	function despawnBody(s, entry){
		if(!entry.body) return;
		endDuel(s, entry, true); // a demoted/leaving duelist forfeits quietly
		try{ if(MMR && MMR.mechs && MMR.mechs.guestUnboard) MMR.mechs.guestUnboard(entry.gid); }catch(e){ /* fine */ }
		keepBody(entry); // demote/leave: the pouch and earned arsenal await this gid's return
		entry.body = null;
		entry.bodyLike = null;
		updateUi();
	}
	function sendVitals(s, entry){
		const b = entry.body;
		if(!b) return;
		try{ entry.peer.send({ t: 'pvit', hp: +b.hp.toFixed(1), mhp: b.maxHp, dead: b.dead ? 1 : 0, pouch: Object.assign({}, b.pouch), weapons: (b.weapons || []).slice(0, 8) }); }catch(e){ /* going away */ }
	}
	// The one damage inlet for a guest body (mob contact today, hazards tomorrow):
	// i-frames live HERE, knockback is advisory (the guest applies the impulse to
	// its locally-simulated hero), death is host-decided and host-respawned.
	function hurtBody(s, entry, amount, sx, sy, cause){
		const b = entry.body;
		if(!b || b.dead) return;
		const t = now();
		if(t < (b.invulUntil || 0)) return;
		b.invulUntil = t + NET.PLAY_RULES.HURT_INVUL_MS;
		// hero mode: the wound is FORWARDED, not applied — the guest runs it through
		// its real damage pipeline (armor, toughness, i-frames) and the resulting hp
		// comes back as a ppose claim. The i-frame stamp above still rate-limits.
		if(entry.heroMode){
			let kbxH = 0;
			if(Number.isFinite(sx)){ const dx = b.x - sx; const d = Math.abs(dx) || 1; kbxH = (dx / d) * 5; }
			try{ entry.peer.send({ t: 'pdmg', amt: +Math.max(1, Number(amount) || 1).toFixed(1), kbx: +kbxH.toFixed(2), kby: -3.2, cause: String(cause || 'mob').slice(0, 16) }); }catch(e){ /* fine */ }
			return;
		}
		// the elemental matrix applies to bodies too: a soaked body conducts (the
		// hero's own WET_ELECTRIC_MULT), judged from the CAUSE the attacker declared
		let amt = Math.max(1, Number(amount) || 1);
		if(b.statusSt && MMR && MMR.heroStatus && MMR.heroStatus.damageInMultOf && ELECTRIC_CAUSE.test(String(cause || ''))){
			amt = amt * MMR.heroStatus.damageInMultOf(b.statusSt, 'electric');
		}
		b.hp = Math.max(0, b.hp - amt);
		let kbx = 0;
		if(Number.isFinite(sx)){ const dx = b.x - sx; const d = Math.abs(dx) || 1; kbx = (dx / d) * 5; }
		try{ entry.peer.send({ t: 'pdmg', hp: +b.hp.toFixed(1), kbx: +kbx.toFixed(2), kby: -3.2, cause: String(cause || 'mob').slice(0, 16) }); }catch(e){ /* fine */ }
		sendVitals(s, entry);
		if(b.hp <= 0){
			b.dead = true;
			b.respawnAt = t + NET.PLAY_RULES.RESPAWN_MS;
			if(b.duelWith && session) endDuel(session, entry); // death settles a duel
			dropPouchAt(s, entry, b); // the gravestone rule: the pouch stays where the hero fell
			try{ bridge.msg('💀 ' + (entry.name || 'Duch') + ' poległ — sakwa została na miejscu śmierci (odrodzenie za ' + Math.round(NET.PLAY_RULES.RESPAWN_MS / 1000) + ' s)'); }catch(e){ /* fine */ }
		}
	}
	// The guest gravestone (respawn_travel's rule, guest-shaped): death spills the
	// pouch as PHYSICAL resource drops at the death spot — recoverable with the
	// pickup intent by whoever gets there first, exactly like the hero's own grave.
	// The earned arsenal survives (weapons are identity, resources are cargo). In
	// the DOM-less Node sims there is no drops engine, so the pouch survives there.
	function dropPouchAt(s, entry, b){
		const D = MMR && MMR.drops;
		if(!D || !D.spawnResource) return;
		let spilled = false;
		for(const k of Object.keys(b.pouch)){
			const n = Math.floor(Number(b.pouch[k]) || 0);
			if(n <= 0){ delete b.pouch[k]; continue; }
			try{ D.spawnResource(b.x, b.y - 0.2, k, n); spilled = true; }catch(e){ /* keep the rest */ }
			delete b.pouch[k];
		}
		if(spilled){
			keepBody(entry); // the banked pouch must reflect the loss — no resurrection by rejoin
			sendVitals(s, entry);
		}
	}
	// Every world-touching intent lands here and nowhere else. Reach, rate, pouch
	// and permission are checked against HOST state; the bridge seams re-validate
	// world truth (whitelist, support, overlap) before a single tile changes.
	function handlePlayAct(s, entry, pl){
		markActive(entry);
		const b = entry.body;
		// the pouch-mode intents demand 'play' exactly — EXCEPT the duel handshake,
		// which is a body-level contract and serves hero-mode guests too
		if(!b || (entry.mode !== 'play' && !(entry.mode === 'hero' && pl.a === 'duel'))){ entry.peer.send({ t: 'pactAck', a: pl.a, ok: false, reason: 'perm' }); return; }
		if(b.dead){ entry.peer.send({ t: 'pactAck', a: pl.a, ok: false, reason: 'dead' }); return; }
		// a flash-frozen body is a block of ice: EVERY intent bounces until it thaws
		// (movement is guest-authoritative — the client honors the stun, a rigged one
		// only moves; it still cannot act)
		if(b.statusSt && MMR && MMR.heroStatus && MMR.heroStatus.isFrozenState && MMR.heroStatus.isFrozenState(b.statusSt)){
			entry.peer.send({ t: 'pactAck', a: pl.a, ok: false, reason: 'frozen' });
			return;
		}
		if(!NET.validPlayAction(pl.a)){ entry.peer.send({ t: 'pactAck', a: pl.a, ok: false, reason: 'action' }); return; }
		if(pl.a === 'attack'){
			// weapons aim at world floats and bypass the tile-reach gate: melee clamps to
			// its own reach host-side, arrows fly on host physics. Ownership, cooldown and
			// ammo are all HOST state — a modified client can spam names, not effects.
			const tA = now();
			const key = typeof pl.key === 'string' ? pl.key.slice(0, 16) : '';
			const spec = (NET.validPlayWeapon(key) && Array.isArray(b.weapons) && b.weapons.includes(key)) ? NET.PLAY_WEAPONS[key] : null;
			if(!spec){ entry.peer.send({ t: 'pactAck', a: 'attack', ok: false, reason: 'weapon', key }); return; }
			if(tA - (b.lastAttackAt || 0) < Math.max(NET.PLAY_RULES.ATTACK_MS, spec.cdMs)) return; // silent — held fire just retries
			const ax = Number(pl.x), ay = Number(pl.y);
			if(!Number.isFinite(ax) || !Number.isFinite(ay)) return;
			if(!spec.melee && !NET.playAimDir(b.x, b.y, ax, ay)) return; // degenerate arrow aim
			if(spec.ammo){
				if(!(Number(b.pouch[spec.ammo]) > 0)){ entry.peer.send({ t: 'pactAck', a: 'attack', ok: false, reason: 'ammo', key }); return; }
				NET.pouchTake(b.pouch, spec.ammo, 1);
			}
			b.lastAttackAt = tA;
			let res = null;
			try{ res = bridge.ghostPlayAttack({ x: b.x, y: b.y, facing: b.f < 0 ? -1 : 1, gid: entry.gid, duelWith: b.duelWith || null }, spec, ax, ay); }catch(e){ res = null; }
			if(spec.ammo && !(res && res.ok)) NET.pouchAdd(b.pouch, spec.ammo, 1); // a shot that never flew is refunded
			const hits = (res && res.hits) | 0;
			// consensual duel (owner ruling): a MELEE swing that reaches the consenting
			// partner wounds it too — bodies only, never the host hero, never without
			// the mutual handshake below. Arrows stay creatures-only for now.
			let duelHit = 0;
			if(spec.melee && b.duelWith){
				for(const e of entries()){
					if(e.gid !== b.duelWith || !e.body || e.body.dead) continue;
					if(e.body.duelWith !== entry.gid) break; // symmetry or nothing
					const near = Math.abs(e.body.x - b.x) <= spec.reach + 0.6 && Math.abs(e.body.y - b.y) <= spec.reach + 0.6;
					const aimed = Math.abs(e.body.x - ax) < 1.2 && Math.abs(e.body.y - ay) < 1.4;
					if(near && aimed){
						hurtBody(s, e, Math.max(1, 2 + spec.dmg), b.x, b.y, 'duel');
						duelHit = 1;
					}
					break;
				}
			}
			if(hits > 0){
				s.stats.playStrikes++;
				sendDeed(entry, 'hit', 1); // guest marksmanship pays guest XP — never host progression
			}
			if(spec.ammo) sendVitals(s, entry); // the spent arrow shows up in the pouch chips
			entry.peer.send({ t: 'pactAck', a: 'attack', ok: !!(res && res.ok), key, hits, duel: duelHit });
			return;
		}
		if(pl.a === 'duel'){
			// mutual-consent handshake: the duel begins ONLY when both sides asked for
			// each other within the TTL — a unilateral claim registers a challenge and
			// nothing else. The host arbitrates every step.
			const tD = now();
			if(tD - (b.lastDuelAt || 0) < NET.PLAY_RULES.DUEL_MS) return;
			b.lastDuelAt = tD;
			const target = typeof pl.gid === 'string' ? pl.gid.slice(0, 20) : '';
			let te = null;
			for(const e of entries()){ if(e.gid === target && e !== entry && e.body && !e.body.dead){ te = e; break; } }
			if(!te){ entry.peer.send({ t: 'pactAck', a: 'duel', ok: false, reason: 'target' }); return; }
			if(b.duelWith || te.body.duelWith){ entry.peer.send({ t: 'pactAck', a: 'duel', ok: false, reason: 'busy' }); return; }
			for(const [k, ts] of s.duelAsks){ if(tD - ts > NET.PLAY_RULES.DUEL_TTL_MS) s.duelAsks.delete(k); }
			const back = s.duelAsks.get(te.gid + '>' + entry.gid);
			if(back !== undefined){
				s.duelAsks.delete(te.gid + '>' + entry.gid);
				b.duelWith = te.gid;
				te.body.duelWith = entry.gid;
				broadcast({ t: 'duel', a: entry.gid, b: te.gid, on: 1 });
				try{ bridge.msg('⚔ Pojedynek: ' + (entry.name || 'Duch') + ' vs ' + (te.name || 'Duch')); }catch(e){ /* fine */ }
				entry.peer.send({ t: 'pactAck', a: 'duel', ok: true, on: 1 });
			} else {
				s.duelAsks.set(entry.gid + '>' + te.gid, tD);
				entry.peer.send({ t: 'pactAck', a: 'duel', ok: true, on: 0 }); // challenge registered, waiting for consent
				try{ te.peer.send({ t: 'duelAsk', from: entry.gid, name: String(entry.name || 'Duch').slice(0, 24) }); }catch(e){ /* fine */ }
			}
			return;
		}
		if(pl.a === 'craft'){
			// crafting mutates only HOST-owned body state (pouch → pouch/arsenal); the
			// host inventory and the world are never touched, so no bridge seam at all
			const tC = now();
			if(tC - (b.lastCraftAt || 0) < NET.PLAY_RULES.CRAFT_MS) return;
			b.lastCraftAt = tC;
			const key = typeof pl.key === 'string' ? pl.key.slice(0, 16) : '';
			const r = NET.validPlayRecipe(key) ? NET.PLAY_RECIPES[key] : null;
			if(!r){ entry.peer.send({ t: 'pactAck', a: 'craft', ok: false, reason: 'recipe', key }); return; }
			if(r.weapon && Array.isArray(b.weapons) && b.weapons.includes(r.weapon)){
				entry.peer.send({ t: 'pactAck', a: 'craft', ok: false, reason: 'owned', key });
				return;
			}
			if(!NET.pouchSpend(b.pouch, r.cost)){ entry.peer.send({ t: 'pactAck', a: 'craft', ok: false, reason: 'cost', key }); return; }
			if(r.gives) for(const k of Object.keys(r.gives)) NET.pouchAdd(b.pouch, k, r.gives[k]);
			if(r.weapon && Array.isArray(b.weapons)) b.weapons.push(r.weapon);
			s.stats.playCrafts++;
			sendDeed(entry, 'craft', 1);
			keepBody(entry); // earned gear is banked the moment it exists
			sendVitals(s, entry);
			entry.peer.send({ t: 'pactAck', a: 'craft', ok: true, key });
			try{ bridge.msg('🛠 ' + (entry.name || 'Duch') + ' wykuwa: ' + (r.label || key)); }catch(e){ /* fine */ }
			return;
		}
		if(pl.a === 'eat'){
			// eating heals HOST-owned hp from the HOST-owned pouch — the guest larder
			// whitelist (PLAY_FOODS) has no poisonous entries by design
			const tE = now();
			if(tE - (b.lastEatAt || 0) < NET.PLAY_RULES.EAT_MS) return;
			b.lastEatAt = tE;
			const key = typeof pl.key === 'string' ? pl.key.slice(0, 24) : '';
			const food = NET.validPlayFood(key) ? NET.PLAY_FOODS[key] : null;
			if(!food){ entry.peer.send({ t: 'pactAck', a: 'eat', ok: false, reason: 'food', key }); return; }
			if(!NET.pouchTake(b.pouch, key, 1)){ entry.peer.send({ t: 'pactAck', a: 'eat', ok: false, reason: 'cost', key }); return; }
			b.hp = Math.min(b.maxHp, b.hp + Math.max(1, Number(food.hp) || 1));
			keepBody(entry);
			sendVitals(s, entry);
			entry.peer.send({ t: 'pactAck', a: 'eat', ok: true, key, hp: +b.hp.toFixed(1) });
			return;
		}
		if(pl.a === 'pickup'){
			// ground pickups aim at world floats like attacks; the bridge re-checks the
			// drop's real reach and refuses everything but plain resources
			const tP = now();
			if(tP - (b.lastPickupAt || 0) < NET.PLAY_RULES.PICKUP_MS) return;
			b.lastPickupAt = tP;
			const ax = Number(pl.x), ay = Number(pl.y);
			if(!Number.isFinite(ax) || !Number.isFinite(ay)) return;
			if(!NET.playReachOk(b.x, b.y, Math.floor(ax), Math.floor(ay))){ entry.peer.send({ t: 'pactAck', a: 'pickup', ok: false, reason: 'reach' }); return; }
			let res = null;
			try{ res = bridge.ghostPlayPickupAt ? bridge.ghostPlayPickupAt(ax, ay, { x: b.x, y: b.y }) : null; }catch(e){ res = { ok: false, reason: 'error' }; }
			if(res && res.ok && res.key){
				NET.pouchAdd(b.pouch, res.key, res.qty || 1);
				s.stats.playPickups = (s.stats.playPickups || 0) + 1;
				keepBody(entry);
				sendVitals(s, entry);
			}
			entry.peer.send({ t: 'pactAck', a: 'pickup', ok: !!(res && res.ok), reason: (res && res.reason) || null, key: (res && res.key) || null });
			return;
		}
		const tx = Math.floor(Number(pl.x)), ty = Math.floor(Number(pl.y));
		if(!Number.isFinite(tx) || !Number.isFinite(ty)) return;
		if(!NET.playReachOk(b.x, b.y, tx, ty)){ entry.peer.send({ t: 'pactAck', a: pl.a, ok: false, reason: 'reach', x: tx, y: ty }); return; }
		const t = now();
		if(pl.a === 'mine'){
			if(t - b.lastMineAt < NET.PLAY_RULES.MINE_MS) return; // silent — the hold-to-mine loop just retries
			b.lastMineAt = t;
			// progress is HOST state per (body, cell): switching cells restarts it. The
			// tick need derives from the tile's REAL hardness (the same INFO.hp law the
			// local miner obeys) — stone digs slower than dirt for a guest too.
			if(!b.mine || b.mine.x !== tx || b.mine.y !== ty){
				let need = NET.PLAY_RULES.MINE_TICKS;
				try{
					const derived = bridge.ghostPlayMineTicks ? (bridge.ghostPlayMineTicks(tx, ty) | 0) : 0;
					if(derived >= 1) need = Math.min(NET.PLAY_RULES.MINE_TICKS_MAX, derived);
				}catch(e){ /* flat fallback */ }
				b.mine = { x: tx, y: ty, n: 0, need };
			}
			b.mine.n++;
			if(b.mine.n < (b.mine.need || NET.PLAY_RULES.MINE_TICKS)){
				entry.peer.send({ t: 'pactAck', a: 'mine', ok: true, progress: +(b.mine.n / (b.mine.need || NET.PLAY_RULES.MINE_TICKS)).toFixed(2), x: tx, y: ty });
				return;
			}
			b.mine = null;
			let res = null;
			try{ res = bridge.ghostPlayMineAt(tx, ty); }catch(e){ res = { ok: false, reason: 'error' }; }
			if(res && res.ok){
				if(res.key) NET.pouchAdd(b.pouch, res.key, 1);
				s.stats.playMines++;
				sendVitals(s, entry);
			}
			entry.peer.send({ t: 'pactAck', a: 'mine', ok: !!(res && res.ok), reason: res && res.reason, x: tx, y: ty, key: (res && res.key) || null });
		} else if(pl.a === 'place'){
			if(t - b.lastPlaceAt < NET.PLAY_RULES.PLACE_MS) return;
			b.lastPlaceAt = t;
			const key = typeof pl.key === 'string' ? pl.key.slice(0, 24) : '';
			if(!(Number(b.pouch[key]) > 0) || !Object.prototype.hasOwnProperty.call(b.pouch, key)){
				entry.peer.send({ t: 'pactAck', a: 'place', ok: false, reason: 'cost', x: tx, y: ty });
				return;
			}
			let res = null;
			try{ res = bridge.ghostPlayPlaceAt(tx, ty, key, { x: b.x, y: b.y, w: NET.PLAY_RULES.BODY_W, h: NET.PLAY_RULES.BODY_H }); }catch(e){ res = { ok: false, reason: 'error' }; }
			if(res && res.ok){
				NET.pouchTake(b.pouch, key, 1);
				s.stats.playPlaces++;
				sendVitals(s, entry);
			}
			entry.peer.send({ t: 'pactAck', a: 'place', ok: !!(res && res.ok), reason: res && res.reason, x: tx, y: ty });
		} else if(pl.a === 'strike'){
			if(t - b.lastStrikeAt < NET.PLAY_RULES.STRIKE_MS) return;
			b.lastStrikeAt = t;
			let hits = 0;
			try{ hits = bridge.ghostPlayStrike(tx + 0.5, ty + 0.5, NET.PLAY_RULES.STRIKE_R, NET.PLAY_RULES.STRIKE_DMG) | 0; }catch(e){ hits = 0; }
			if(hits > 0) s.stats.playStrikes++;
			entry.peer.send({ t: 'pactAck', a: 'strike', ok: true, hits, x: tx, y: ty });
		}
	}
	// Hero-mode world intents: the ONLY world-touching inlet for a full-game guest.
	// The guest's inventory/gear/XP are ITS local truth (owner ruling) — what is
	// protected here is the WORLD: reach and rate against HOST-tracked state, then
	// solo-grade legality in the bridge seams (three mining layers, placement rules,
	// damage envelope). A modified hero client can gild its own trophy case; it
	// still cannot write one illegal tile or exceed the damage cap.
	function handleHeroAct(s, entry, pl){
		markActive(entry);
		const b = entry.body;
		if(!b || entry.mode !== 'hero'){ entry.peer.send({ t: 'hact', a: pl.a, ok: false, reason: 'perm' }); return; }
		if(!NET.validHeroAction(pl.a)){ entry.peer.send({ t: 'hact', a: pl.a, ok: false, reason: 'action' }); return; }
		const t = now();
		if(pl.a === 'dmg'){
			// fire-and-forget: the wound shows up on the creature stream either way
			if(t - (b.lastHeroDmgAt || 0) < NET.HERO_RULES.DMG_MS) return;
			b.lastHeroDmgAt = t;
			const x = Number(pl.x), y = Number(pl.y);
			if(!Number.isFinite(x) || !Number.isFinite(y)) return;
			if(Math.abs(x - b.x) > NET.HERO_RULES.DMG_RADIUS || Math.abs(y - b.y) > NET.HERO_RULES.DMG_RADIUS) return;
			const amt = Math.max(1, Math.min(NET.HERO_RULES.DMG_MAX, Number(pl.n) || 1));
			const kind = (pl.k === 'ignite' || pl.k === 'chill') ? pl.k : 'hit'; // element whitelist — host picks its own safe params
			// consensual duel (hero rung): a blow landing near the CONSENTING partner
			// wounds it too — symmetry re-checked here, the host hero never a target
			if(b.duelWith && kind === 'hit'){
				for(const e of entries()){
					if(e.gid !== b.duelWith || !e.body || e.body.dead) continue;
					if(e.body.duelWith !== entry.gid) break; // symmetry or nothing
					if(Math.abs(e.body.x - x) < 1.4 && Math.abs(e.body.y - y) < 1.6) hurtBody(s, e, Math.min(20, amt), b.x, b.y, 'duel');
					break;
				}
			}
			let hits = 0;
			try{ hits = bridge.ghostHeroDamage ? (bridge.ghostHeroDamage(x, y, amt, kind) | 0) : 0; }catch(e){ hits = 0; }
			if(hits) s.stats.heroDmg = (s.stats.heroDmg || 0) + 1;
			return;
		}
		if(pl.a === 'tp'){
			// teleporter jump: the HOST resolves the pad under its tracked body and
			// spends the MACHINE's energy (world economy); the ack hands the guest
			// its landing spot — the movement itself stays guest-authoritative
			if(t - (b.lastHeroTpAt || 0) < NET.HERO_RULES.TP_MS) return;
			b.lastHeroTpAt = t;
			let res = null;
			try{ res = bridge.ghostHeroTeleport ? bridge.ghostHeroTeleport({ x: b.x, y: b.y, w: NET.PLAY_RULES.BODY_W, h: NET.PLAY_RULES.BODY_H }, pl.d < 0 ? -1 : 1) : null; }catch(e){ res = null; }
			if(res && res.ok){
				b.x = res.x; b.y = res.y; // the body lands with the guest — claims will match
				entry.peer.send({ t: 'hact', a: 'tp', ok: true, x: +res.x.toFixed(2), y: +res.y.toFixed(2) });
			} else {
				entry.peer.send({ t: 'hact', a: 'tp', ok: false }); // an honest refusal beats silence
			}
			return;
		}
		if(pl.a === 'board' || pl.a === 'unboard'){
			// mech cab handoff: boarding inverts movement authority — the host
			// simulates the hull on the guest's streamed keys and the body rides it
			if(t - (b.lastHeroBoardAt || 0) < NET.HERO_RULES.BOARD_MS) return;
			b.lastHeroBoardAt = t;
			let res = null;
			try{
				res = pl.a === 'board'
					? (bridge.ghostHeroBoard ? bridge.ghostHeroBoard(entry.gid, { x: b.x, y: b.y, w: NET.PLAY_RULES.BODY_W, h: NET.PLAY_RULES.BODY_H }) : null)
					: (bridge.ghostHeroUnboard ? bridge.ghostHeroUnboard(entry.gid) : null);
			}catch(e){ res = null; }
			const ok = !!(res && (pl.a === 'board' ? res.ok : true));
			entry.peer.send({ t: 'hact', a: pl.a, ok, reason: (res && res.reason) || (ok ? null : 'no-mech'),
				id: (res && res.id) || 0, x: (res && res.x) || 0, y: (res && res.y) || 0 });
			if(ok && pl.a === 'board'){ try{ bridge.msg('🤖 ' + (entry.name || 'Duch') + ' zasiada w mechu!'); }catch(e){ /* fine */ } }
			return;
		}
		if(pl.a === 'row'){
			// the oar stroke resolves against the boat under the HOST-tracked body;
			// impulse and speed cap live in the boats module — the claim picks only
			// between the module's own strong/weak stroke powers
			if(t - (b.lastHeroRowAt || 0) < NET.HERO_RULES.ROW_MS) return;
			b.lastHeroRowAt = t;
			try{ if(bridge.ghostHeroRow) bridge.ghostHeroRow({ x: b.x, y: b.y, w: NET.PLAY_RULES.BODY_W, h: NET.PLAY_RULES.BODY_H, vy: 0 }, pl.d < 0 ? -1 : 1, !!pl.st); }catch(e){ /* fine */ }
			return;
		}
		if(pl.a === 'shoot'){
			// the projectile flies from the HOST-tracked body — the guest supplies
			// only velocity/damage/flags, all clamped in the weapons resolver
			if(t - (b.lastHeroShootAt || 0) < NET.HERO_RULES.SHOOT_MS) return;
			b.lastHeroShootAt = t;
			const spec = { vx: Number(pl.vx) || 0, vy: Number(pl.vy) || 0,
				dmg: Math.max(1, Math.min(NET.HERO_RULES.DMG_MAX, Number(pl.n) || 1)),
				fire: !!pl.f2, snowball: !!pl.sb, rock: !!pl.rk, thrown: !!pl.th, harpoon: !!pl.hp2,
				sticky: !!pl.sk, // special throws keep their fuse — host-owned params in the resolver
				splat: (pl.sp === 'wet' || pl.sp === 'gascloud') ? pl.sp : null, // balloon/grenade bursts, host-owned radii
				ownerGid: entry.gid, duelGid: b.duelWith || null }; // duel arrows re-check consent at impact
			try{ if(bridge.ghostHeroShoot) bridge.ghostHeroShoot({ x: b.x, y: b.y }, spec); }catch(e){ /* fine */ }
			return;
		}
		if(pl.a === 'pickup'){
			// ground pickups aim at world floats; the play-mode bridge seam already
			// validates fog, reach-from-body and resource-only — the YIELD goes to
			// the guest's own inventory via the ack (its local truth)
			if(t - (b.lastHeroPickupAt || 0) < NET.HERO_RULES.PICKUP_MS) return;
			b.lastHeroPickupAt = t;
			const px = Number(pl.x), py = Number(pl.y);
			if(!Number.isFinite(px) || !Number.isFinite(py)) return;
			let res = null;
			try{ res = bridge.ghostHeroPickupAt ? bridge.ghostHeroPickupAt(px, py, { x: b.x, y: b.y })
				: (bridge.ghostPlayPickupAt ? bridge.ghostPlayPickupAt(px, py, { x: b.x, y: b.y }) : null); }catch(e){ res = { ok: false, reason: 'error' }; }
			entry.peer.send({ t: 'hact', a: 'pickup', ok: !!(res && res.ok), reason: (res && res.reason) || null,
				key: (res && res.key) || null, qty: (res && res.qty) || 0, item: (res && res.item) || null });
			return;
		}
		const tx = Math.floor(Number(pl.x)), ty = Math.floor(Number(pl.y));
		if(!Number.isFinite(tx) || !Number.isFinite(ty)) return;
		if(!NET.playReachOk(b.x, b.y, tx, ty, NET.HERO_RULES.REACH)){ entry.peer.send({ t: 'hact', a: pl.a, ok: false, reason: 'reach', x: tx, y: ty }); return; }
		if(pl.a === 'use'){
			if(t - (b.lastHeroUseAt || 0) < NET.HERO_RULES.USE_MS) return;
			b.lastHeroUseAt = t;
			let res = null;
			try{ res = bridge.ghostHeroUseAt ? bridge.ghostHeroUseAt(tx, ty) : null; }catch(e){ res = { ok: false, reason: 'error' }; }
			entry.peer.send({ t: 'hact', a: 'use', ok: !!(res && res.ok), reason: (res && res.reason) || null, x: tx, y: ty,
				loot: (res && res.loot) || null, note: (res && res.note) ? String(res.note).slice(0, 80) : null });
			return;
		}
		if(pl.a === 'mine'){
			if(t - (b.lastHeroMineAt || 0) < NET.HERO_RULES.MINE_MS) return; // silent — re-mining retries
			b.lastHeroMineAt = t;
			let res = null;
			try{ res = bridge.ghostHeroMineAt ? bridge.ghostHeroMineAt(tx, ty) : null; }catch(e){ res = { ok: false, reason: 'error' }; }
			if(res && res.ok) s.stats.heroMines = (s.stats.heroMines || 0) + 1;
			entry.peer.send({ t: 'hact', a: 'mine', ok: !!(res && res.ok), reason: (res && res.reason) || null, x: tx, y: ty, tid: (res && res.tid) || 0 });
		} else if(pl.a === 'place'){
			if(t - (b.lastHeroPlaceAt || 0) < NET.HERO_RULES.PLACE_MS) return;
			b.lastHeroPlaceAt = t;
			const tid = Number(pl.tid) | 0;
			const layer = (pl.l === 'overlay' || pl.l === 'background') ? pl.l : 'fg';
			let res = null;
			try{ res = bridge.ghostHeroPlaceAt ? bridge.ghostHeroPlaceAt(tx, ty, tid, layer, { x: b.x, y: b.y, w: NET.PLAY_RULES.BODY_W, h: NET.PLAY_RULES.BODY_H }) : null; }catch(e){ res = { ok: false, reason: 'error' }; }
			if(res && res.ok) s.stats.heroPlaces = (s.stats.heroPlaces || 0) + 1;
			entry.peer.send({ t: 'hact', a: 'place', ok: !!(res && res.ok), reason: (res && res.reason) || null, x: tx, y: ty, tid });
		}
	}
	// --- per-body survival: the world itself is a hazard -----------------------------
	// Drowning runs the REAL survival law (SURVIVAL.updateDrowning — the hero's own
	// grace, ramp and 12-per-tick cap) against world truth read HOST-side; lava sears
	// with the hero's own 8. No client input is consulted — a rigged guest can hold
	// its breath only in its own UI. (The hero takes NO fall damage in this game, so
	// neither does a guest: parity, not an omission.)
	function bodySurvivalPass(s, entry, b, dt, t){
		const SURV = MMR && MMR.survival;
		const TT = MMR && MMR.T;
		if(!TT || typeof bridge.getTile !== 'function') return;
		if(SURV && SURV.updateDrowning){
			const headTile = bridge.getTile(Math.floor(b.x), Math.floor(b.y - 0.35));
			if(!b.drownSt) b.drownSt = SURV.createDrowningState ? SURV.createDrowningState() : { airless: 0, damageAcc: 0, warned: false };
			const res = SURV.updateDrowning(b.drownSt, dt, headTile === TT.WATER);
			if(res.warn){ try{ entry.peer.send({ t: 'pdrown', w: 1 }); }catch(e){ /* fine */ } }
			else if(res.recovered){ try{ entry.peer.send({ t: 'pdrown', w: 0 }); }catch(e){ /* fine */ } }
			if(res.damage > 0 && t >= (b.invulUntil || 0)){
				const dmg = Math.min(12, res.damage);
				hurtBody(s, entry, dmg, NaN, NaN, 'drowning');
				if(SURV.consumeDrowningDamage) SURV.consumeDrowningDamage(b.drownSt, dmg);
			}
		}
		const midTile = bridge.getTile(Math.floor(b.x), Math.floor(b.y));
		const feetTile = bridge.getTile(Math.floor(b.x), Math.floor(b.y + 0.41));
		if((midTile === TT.LAVA || feetTile === TT.LAVA) && t >= (b.invulUntil || 0)){
			hurtBody(s, entry, 8, b.x, b.y + 1, 'lava'); // the hero's own lava sear
		}
		// swim chill: treading DEEP water — mid cell and the cell under the feet both
		// wet. A body standing on the bottom is not swimming (the hero's rule too).
		if(SURV && SURV.updateSwimChill){
			const swimming = midTile === TT.WATER && bridge.getTile(Math.floor(b.x), Math.floor(b.y + 1)) === TT.WATER;
			if(!b.chillSt) b.chillSt = SURV.createSwimChillState ? SURV.createSwimChillState() : { exposure: 0, damageAcc: 0, warned: false };
			const ch = SURV.updateSwimChill(b.chillSt, dt, swimming);
			if(ch.warn){ try{ entry.peer.send({ t: 'pwarn', k: 'chill' }); }catch(e){ /* fine */ } }
			if(ch.damage > 0 && t >= (b.invulUntil || 0)){
				const dmg = Math.min(8, ch.damage); // the hero's own per-tick cap
				hurtBody(s, entry, dmg, NaN, NaN, 'water_chill');
				if(SURV.consumeSwimChillDamage) SURV.consumeSwimChillDamage(b.chillSt, dmg);
			}
		}
		// deep-water pressure: the continuous water stack over the head, the hero's
		// own law and caps with the BASE crush capacity (a guest carries no Twardość)
		if(SURV && SURV.updateWaterPressure && bridge.ghostPlayWaterStack){
			const headY = b.y - 0.35;
			const headCovered = bridge.getTile(Math.floor(b.x), Math.floor(headY)) === TT.WATER;
			if(!b.pressSt) b.pressSt = SURV.createWaterPressureState ? SURV.createWaterPressureState() : { damageAcc: 0, warned: false };
			let stack = 0;
			try{ stack = headCovered ? (Number(bridge.ghostPlayWaterStack(b.x, headY)) || 0) : 0; }catch(e){ stack = 0; }
			const pr = SURV.updateWaterPressure(b.pressSt, dt, stack, 0, headCovered);
			if(pr.warn){ try{ entry.peer.send({ t: 'pwarn', k: 'pressure' }); }catch(e){ /* fine */ } }
			if(pr.damage > 0 && (t >= (b.invulUntil || 0) || pr.implode)){
				const dmg = pr.implode ? Math.max(b.maxHp + 20, pr.damage) : Math.min(24, pr.damage); // the hero's own caps
				if(pr.implode) b.invulUntil = 0; // an implosion ignores i-frames, exactly like the hero's
				hurtBody(s, entry, dmg, NaN, NaN, 'water_pressure');
				if(SURV.consumeWaterPressureDamage) SURV.consumeWaterPressureDamage(b.pressSt, dmg);
			}
		}
		// thermal exposure: the env is sampled at the BODY through the bridge seam
		// (climate + ambient temp + shelter + warmth), cached 500 ms like the hero's
		if(SURV && SURV.updateThermalExposure && bridge.ghostPlayThermalMode){
			if(!b.thermSt) b.thermSt = SURV.createThermalState ? SURV.createThermalState() : { exposure: 0, damageAcc: 0, warned: false, mode: 'none' };
			if(!b.thermAt || t - b.thermAt > 500){
				b.thermAt = t;
				try{ b.thermMode = bridge.ghostPlayThermalMode(b.x, b.y, midTile === TT.WATER) || 'none'; }catch(e){ b.thermMode = 'none'; }
			}
			const th = SURV.updateThermalExposure(b.thermSt, dt, b.thermMode || 'none');
			if(th.warn){ try{ entry.peer.send({ t: 'pwarn', k: th.mode === 'cold' ? 'cold' : 'heat' }); }catch(e){ /* fine */ } }
			if(th.damage > 0 && t >= (b.invulUntil || 0)){
				const dmg = Math.min(6, th.damage); // the hero's own per-tick cap
				hurtBody(s, entry, dmg, NaN, NaN, th.mode === 'cold' ? 'deep_frost' : 'heat_stroke');
				if(SURV.consumeThermalDamage) SURV.consumeThermalDamage(b.thermSt, dmg);
			}
		}
		// unified statuses (wet/burn/chill/frozen): the HERO's own state machine, one
		// instance per body. Water soaks, open flame ignites (and fizzles on a soaked
		// body by the same law), deep-frost air chills — and the wet+chill+frost combo
		// flash-freezes exactly like the hero. Runs LAST: it reads b.thermMode.
		const HS = MMR && MMR.heroStatus;
		if(HS && HS.createState){
			if(!b.statusSt) b.statusSt = HS.createState();
			const headTile2 = bridge.getTile(Math.floor(b.x), Math.floor(b.y - 0.35));
			const inWater = midTile === TT.WATER || headTile2 === TT.WATER;
			if(inWater) HS.applyTo(b.statusSt, 'wet', { dur: 8 }); // the hero's own soak refresh
			const F = MMR && MMR.fire;
			try{
				if(F && F.isBurning && (F.isBurning(Math.floor(b.x), Math.floor(b.y)) || F.isBurning(Math.floor(b.x), Math.floor(b.y + 0.41)))){
					HS.applyTo(b.statusSt, 'burn', {});
				}
			}catch(e){ /* fire engine optional */ }
			if(b.thermMode === 'cold') HS.applyTo(b.statusSt, 'chill', { dur: 2 }); // freezing air chills
			const st = HS.updateState(b.statusSt, dt, { deepFrost: b.thermMode === 'cold', nearWarmth: false, inWater });
			if(st.frozeNow){ try{ entry.peer.send({ t: 'pwarn', k: 'frozen' }); }catch(e){ /* fine */ } }
			if(st.burnDamage > 0 && t >= (b.invulUntil || 0)){
				hurtBody(s, entry, st.burnDamage, NaN, NaN, 'burn_dot'); // a dot cause must NOT re-apply burn
			}
			// stream the chips on TRANSITIONS (a 4-bit signature) plus a 2 s refresh
			// while anything is active: the guest DECAYS its mirror locally, so a
			// continuously re-soaked status would otherwise die on its chips early
			const sig = ((b.statusSt.wet > 0) ? 1 : 0) | ((b.statusSt.burn > 0) ? 2 : 0) | ((b.statusSt.chill > 0) ? 4 : 0) | ((b.statusSt.frozen > 0) ? 8 : 0);
			if(sig !== b.lastStatusSig || (sig !== 0 && t - (b.lastStatusAt || 0) > 2000)){
				b.lastStatusSig = sig;
				b.lastStatusAt = t;
				try{ entry.peer.send({ t: 'pstat', w: +b.statusSt.wet.toFixed(1), c: +b.statusSt.chill.toFixed(1), b: +b.statusSt.burn.toFixed(1), f: +b.statusSt.frozen.toFixed(1) }); }catch(e){ /* fine */ }
			}
		}
	}
	// The body plane: every peer (players AND spectators) sees the embodied guests
	// move; the publisher also feeds MM.coopBodies, the one hook hostile creatures
	// read (empty array in solo play = zero cost, exactly like the ghost aura).
	function bodyTick(s, t){
		const dt = Math.min(0.5, Math.max(0, (t - (s.last.body || t)) / 1000));
		s.last.body = t;
		const list = [];
		const pub = [];
		for(const entry of entries()){
			const b = entry.body;
			if(!b) continue;
			if(!entry.heroMode && b.dead && t >= b.respawnAt){
				b.dead = false;
				b.hp = b.maxHp;
				b.x = bridge.player.x; b.y = bridge.player.y - 0.2;
				b.vx = 0; b.vy = 0;
				b.invulUntil = t + 1500;
				if(b.drownSt && MMR && MMR.survival && MMR.survival.resetDrowning) MMR.survival.resetDrowning(b.drownSt);
				if(b.chillSt && MMR && MMR.survival && MMR.survival.resetSwimChill) MMR.survival.resetSwimChill(b.chillSt);
				if(b.thermSt && MMR && MMR.survival && MMR.survival.resetThermal) MMR.survival.resetThermal(b.thermSt);
				if(b.pressSt && MMR && MMR.survival && MMR.survival.resetWaterPressure) MMR.survival.resetWaterPressure(b.pressSt);
				if(b.statusSt && MMR && MMR.heroStatus && MMR.heroStatus.createState){ b.statusSt = MMR.heroStatus.createState(); b.lastStatusSig = -1; }
				try{ entry.peer.send({ t: 'prespawn', x: +b.x.toFixed(2), y: +b.y.toFixed(2) }); }catch(e){ /* fine */ }
				sendVitals(s, entry);
			}
			// hero mode: survival laws run on the GUEST through the real hero systems
			// (vitals are its local truth) — running them here too would double-damage
			if(!entry.heroMode && !b.dead && dt > 0) bodySurvivalPass(s, entry, b, dt, t);
			list.push([entry.gid, entry.name || 'Duch', +b.x.toFixed(2), +b.y.toFixed(2), +(b.vx || 0).toFixed(2), +(b.vy || 0).toFixed(2), b.f < 0 ? -1 : 1, +b.hp.toFixed(1), b.maxHp, b.dead ? 1 : 0, b.poseSeq || 0]);
			if(!b.dead){
				if(!entry.bodyLike) entry.bodyLike = { gid: entry.gid, w: NET.PLAY_RULES.BODY_W, h: NET.PLAY_RULES.BODY_H, dead: false, hurt: (a, sx, sy, c) => hurtBody(s, entry, a, sx, sy, c) };
				// vx/vy are advisory (aim-lead for party-aware attackers) — never authority.
				// duelWith lets in-flight duel arrows re-check consent at IMPACT time.
				entry.bodyLike.x = b.x; entry.bodyLike.y = b.y; entry.bodyLike.vx = b.vx || 0; entry.bodyLike.vy = b.vy || 0; entry.bodyLike.dead = false; entry.bodyLike.duelWith = b.duelWith || null;
				pub.push(entry.bodyLike);
			}
		}
		if(MMR) MMR.coopBodies = pub;
		if(list.length || s.pbWas){ broadcast({ t: 'pb', list }); s.pbWas = list.length > 0; }
	}

	// --- assistants: delegated watchers craft and manage the hero's gear -------------------
	// SEVERAL may hold the seat at once. Requests are executed serially right here, so
	// two assistants racing for the last resources resolve naturally: first one wins,
	// the second gets an honest 'cost' ack. With approvals ON nothing executes at all —
	// requests wait in the bounded queue until the host clicks Zatwierdź.
	function handleAssist(s, entry, pl){
		markActive(entry);
		const t = now();
		if(!entry.assistant || !NET.modeAllows(entry.mode, 'full')){ entry.peer.send({ t: 'assistAck', ok: false, reason: 'perm' }); return; }
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
			if(on && !NET.modeAllows(entry.mode, 'full')) return false; // an assistant must be allowed to influence
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
				// only ACTIVE watchers haunt the world (idle tabs are furniture) — and an
				// EMBODIED guest is a physical presence, not a phantom: no dread aura
				if(e.cam && !e.body){ spirits.push({ x: e.cam.x, y: e.cam.y }); owners.push(e); }
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
	function progTick(s, t, live){
		s.last.prog = t;
		// stale approval requests quietly expire — tell the assistant, refresh the desk
		const dead = s.assistQueue.expire(t);
		for(const q of dead) notifyAssistDone(q.gid, { t: 'assistDone', qid: q.qid, ok: false, reason: 'expired', label: q.label });
		if(dead.length) updateUi();
		for(const entry of (live || entries())){
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
			// both embodied rungs spawn a host-tracked body (creatures need a target
			// either way); hero mode additionally flips the body to guest-local
			// vitals — the flag every body pass below branches on
			const embodied = (mode === 'play' || mode === 'hero');
			entry.heroMode = mode === 'hero';
			if(embodied && !entry.body) spawnBody(session, entry);
			else if(!embodied && entry.body) despawnBody(session, entry);
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
	// Name tag + hp sliver over an embodied guest — shared with the client, which
	// paints the host hero and fellow players through the same function.
	function paintBodyTag(ctx, TILE, x, y, name, vit, chat){
		ctx.save();
		ctx.font = 'bold ' + Math.max(7, TILE * 0.16) + 'px system-ui';
		ctx.textAlign = 'center';
		ctx.fillStyle = '#aef0c2';
		ctx.strokeStyle = 'rgba(6,12,20,0.8)';
		ctx.lineWidth = 2.5;
		const ty = (y - 0.95) * TILE;
		ctx.strokeText(name, x * TILE, ty);
		ctx.fillText(name, x * TILE, ty);
		if(vit && Number.isFinite(vit.hp) && Number.isFinite(vit.maxHp) && vit.hp < vit.maxHp){
			const w = TILE * 1.1, h = 3;
			const bx = x * TILE - w / 2, by = ty + 3;
			ctx.fillStyle = 'rgba(0,0,0,0.55)';
			ctx.fillRect(bx, by, w, h);
			ctx.fillStyle = '#58d68d';
			ctx.fillRect(bx, by, w * Math.max(0, Math.min(1, vit.hp / vit.maxHp)), h);
		}
		ctx.restore();
		if(chat && chat.until > (Date.now ? Date.now() : 0) && chat.text) paintChatBubble(ctx, TILE, x, y - 1.5, chat.text);
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
			// an embodied guest renders as a HERO body, not a spirit — the real
			// painter via the bridge field swap; while dead it reverts to a spirit
			// (its ghost, literally) until the host respawns it
			if(entry.body && !entry.body.dead){
				const b = entry.body;
				if(!b.disp) b.disp = { x: b.x, y: b.y };
				b.disp.x += (b.x - b.disp.x) * ease;
				b.disp.y += (b.y - b.disp.y) * ease;
				if(wantBody && bridge.drawHeroAt) bridge.drawHeroAt({ x: b.disp.x, y: b.disp.y, vx: b.vx, vy: b.vy, facing: b.f, w: NET.PLAY_RULES.BODY_W, h: NET.PLAY_RULES.BODY_H, gid: entry.gid, look: entry.look || null });
				if(wantText) paintBodyTag(ctx, TILE, b.disp.x, b.disp.y, entry.name || 'Duch', b, viewPrefs.bubbles ? entry.lastChat : null);
				continue;
			}
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
	const MODE_LABEL = { watch: 'tylko ogląda', chat: '+ czat', full: '+ czat i wpływ', play: '🎮 gra (sakwa)', hero: '🕹 gra (pełny bohater)' };
	let defaultMode = 'full'; // what a viewer gets on join, until the host says otherwise
	// the embodied rungs are NEVER a door policy: play and hero are granted per
	// viewer, by hand — an embodied stranger by default would be a griefing invitation
	const DEFAULT_MODES = NET.PERMISSION_MODES.filter(m => m !== 'play' && m !== 'hero');
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
		if(!DEFAULT_MODES.includes(mode)) return false;
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
			+ '<div style="color:#7d8fa6;font-size:10px;line-height:1.4;">🌐 Połączenie jest bezpośrednie (P2P); w restrykcyjnych sieciach ruch przechodzi przez publiczny przekaźnik TURN. Gdy mimo to widz nie może dołączyć, pomaga inna sieć lub hotspot.</div>'
			+ '<button id="ghostPanelToggle" style="border:none;border-radius:10px;background:#21a366;color:#fff;font-weight:800;padding:9px 12px;cursor:pointer;">Rozpocznij transmisję</button>';
		document.body.appendChild(el);
		el.querySelector('#ghostPanelClose').addEventListener('click', () => togglePanel(false));
		el.querySelector('#ghostPanelCopy').addEventListener('click', () => {
			const inp = el.querySelector('#ghostPanelLink');
			inp.select();
			try{ navigator.clipboard.writeText(inp.value); }catch(e){ try{ document.execCommand('copy'); }catch(e2){ /* manual copy */ } }
			// blur, or the focus stays in the link INPUT and the mid-edit guard in
			// updateUi freezes the whole panel body — the host would never see the
			// joining viewer's row (badge counts up, list stays "Czekam na duchy…")
			inp.blur();
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
		for(const val of DEFAULT_MODES){
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
		// gifting (owner ruling: host gifts only) — the host hands ITS OWN resources
		// to an embodied guest's pouch; guests cannot move items between themselves
		if(entry.body){
			const gift = styledButton('🎁', 'border:none;border-radius:6px;background:rgba(74,160,90,.45);color:#fff;font-size:10px;font-weight:700;padding:3px 7px;cursor:pointer;');
			gift.title = 'Podaruj surowce ("stone 10") albo broń z arsenału ("spear")';
			gift.addEventListener('click', () => {
				const raw = (typeof prompt === 'function') ? prompt('Co podarować? (np. "stone 10" albo "spear")', 'stone 5') : null;
				if(!raw) return;
				const m = String(raw).trim().match(/^([a-zA-Z_]+)(?:\s+(\d{1,3}))?$/);
				if(!m){ try{ bridge.msg('🎁 Format: "surowiec ilość" albo nazwa broni'); }catch(e){ /* fine */ } return; }
				if(m[2] === undefined) giftWeapon(entry.gid, m[1]);
				else giftResource(entry.gid, m[1], +m[2]);
			});
			row.append(gift);
		}
		return row;
	}
	// Host gifting (owner ruling): host-authoritative end to end — the resource must
	// really leave the HOST inventory (bridge seam validates key + count) before it
	// lands in the guest pouch. No guest intent exists for this; only the host gives.
	// Weapon grants are free (the arsenal is a template registry, not host stock)
	// but stay whitelist-bound and deduped — the host DECIDES, it cannot invent.
	function giftWeapon(gid, key){
		const s = session;
		if(!s || !bridge) return false;
		if(!NET.validPlayWeapon(key)){ try{ bridge.msg('🎁 Nie ma takiej broni: ' + String(key).slice(0, 16)); }catch(e){ /* fine */ } return false; }
		let te = null;
		for(const e of entries()){ if(e.gid === gid && e.body && !e.body.dead){ te = e; break; } }
		if(!te){ try{ bridge.msg('🎁 Ten widz nie ma teraz bohatera w grze'); }catch(e){ /* fine */ } return false; }
		if(te.body.weapons.includes(key)){ try{ bridge.msg('🎁 ' + (te.name || 'Duch') + ' już to ma'); }catch(e){ /* fine */ } return false; }
		te.body.weapons.push(key);
		keepBody(te);
		sendVitals(s, te);
		try{ te.peer.send({ t: 'gift', weapon: key, label: NET.PLAY_WEAPONS[key].label }); }catch(e){ /* fine */ }
		try{ bridge.msg('🎁 Wręczono broń: ' + NET.PLAY_WEAPONS[key].label + ' → ' + (te.name || 'Duch')); }catch(e){ /* fine */ }
		return true;
	}
	function giftResource(gid, key, n){
		const s = session;
		if(!s || !bridge) return false;
		let te = null;
		for(const e of entries()){ if(e.gid === gid && e.body && !e.body.dead){ te = e; break; } }
		if(!te){ try{ bridge.msg('🎁 Ten widz nie ma teraz bohatera w grze'); }catch(e){ /* fine */ } return false; }
		// clamp to the pouch's remaining headroom BEFORE the host inventory is
		// charged: pouchAdd clamps at POUCH_CAP, so any overflow taken out of the
		// host stock would be silently destroyed instead of delivered
		const room = NET.PLAY_RULES.POUCH_CAP - (Number(te.body.pouch[key]) || 0);
		if(room < 1){ try{ bridge.msg('🎁 Sakwa pełna — ' + (te.name || 'Duch') + ' nie pomieści więcej: ' + key); }catch(e){ /* fine */ } return false; }
		const count = Math.max(1, Math.min(NET.PLAY_RULES.GIFT_MAX, room, Math.floor(Number(n) || 0)));
		let took = null;
		try{ took = bridge.ghostGiftTake ? bridge.ghostGiftTake(key, count) : null; }catch(e){ took = null; }
		if(!took || !took.ok){ try{ bridge.msg('🎁 Nie masz tylu: ' + key); }catch(e){ /* fine */ } return false; }
		if(te.heroMode){
			// a hero guest banks the gift into its REAL inventory via the ack —
			// the pouch is play-mode state it never reads
			try{ te.peer.send({ t: 'gift', key, n: count, label: took.label || key, hero: 1 }); }catch(e){ /* fine */ }
			try{ bridge.msg('🎁 Podarowano ' + (took.label || key) + ' ×' + count + ' → ' + (te.name || 'Duch')); }catch(e){ /* fine */ }
			return true;
		}
		NET.pouchAdd(te.body.pouch, key, count);
		keepBody(te);
		sendVitals(s, te);
		try{ te.peer.send({ t: 'gift', key, n: count, label: took.label || key }); }catch(e){ /* fine */ }
		try{ bridge.msg('🎁 Podarowano ' + (took.label || key) + ' ×' + count + ' → ' + (te.name || 'Duch')); }catch(e){ /* fine */ }
		return true;
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

	const api = { wire, start, stop, active, link, frame, metrics, drawSpirits, paintSpirit, paintChatBubble, paintBodyTag, say, setViewerMode, banViewer, setAssistant, setDefaultMode, setApprovalMode, setViewPref, setViewerHidden, approveAssist, rejectAssist, socialBoost: updateSocialBoost, openPanel: () => togglePanel(true), giftResource, giftWeapon,
		// QA seam: the LIVE body object for a gid (host page only — the host owns every
		// body anyway; this just spares QA the private-scope gymnastics)
		_debugBody: (gid) => { if(!session) return null; for(const e of entries()) if(e.gid === gid) return e.body; return null; } };
	if(MMR) MMR.ghostHost = api;
	if(typeof window !== 'undefined'){
		window.__mmGhostHostStart = (room, opts) => start(Object.assign({ room }, opts || {}));
		window.__mmGhostHostStop = () => stop();
	}
	return api;
})();

export { ghostHost };
export default ghostHost;
