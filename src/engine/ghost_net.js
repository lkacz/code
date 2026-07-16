// Ghost network (ghost_net.js): the wire for "Duchy Warstwy" — the link-join
// spectator mode. A host streams its live world state (Option B: state-streamed
// renderer) to any number of ghost watchers; ghosts send back only their camera
// pose and rate-limited blessings.
//
// Model/shell split (like hot_picker.js): everything above the TRANSPORTS line
// is a pure protocol core — room codes, watch links, payload chunking, buff
// cooldowns, MQTT packet codecs — importable and testable under Node with no
// DOM. The transports below need browser APIs and only touch them when called:
//   • loopback — BroadcastChannel between tabs of one browser (QA + same-PC demo)
//   • rtc      — WebRTC DataChannel; signaling rides MQTT-over-WSS on public
//                brokers (free infra, no server of ours; CSP in index.html
//                allowlists exactly these broker origins)
// GitHub Pages stays a static host: gameplay traffic is peer-to-peer.

export const GHOST_PROTO = 1;

// Buff lanes: cosmetic cheers are near-free, mechanical blessings are scarce.
// The HOST owns the ledger — a modified ghost client cannot spam heals.
export const BUFF_RULES = {
	cheer:  { cd: 4000,  label: 'Doping' },
	bless:  { cd: 45000, label: 'Błogosławieństwo', heal: 15 },
	energy: { cd: 45000, label: 'Zastrzyk energii', energy: 20 }
};
export function validBuffKind(k){ return typeof k === 'string' && Object.prototype.hasOwnProperty.call(BUFF_RULES, k); }

// Social facilitation: ACTIVE watchers strengthen the hero. Activity means real
// input on the watcher side within IDLE_MS — parked tabs on a second computer
// stop counting half a minute after their human walks away. XP is a flat bonus
// for having an audience at all; the per-viewer lanes stack linearly.
export const SOCIAL_RULES = {
	IDLE_MS: 30000,
	XP_WITH_AUDIENCE: 1.10, // any active watcher present
	MOVE_PER_VIEWER: 0.01,
	JUMP_PER_VIEWER: 0.01, // jump HEIGHT (velocity gets the square root)
	DMG_PER_VIEWER: 0.01
};
export function socialBoosts(activeViewers){
	const n = Math.max(0, activeViewers | 0);
	return {
		active: n,
		xp: n > 0 ? SOCIAL_RULES.XP_WITH_AUDIENCE : 1,
		move: 1 + SOCIAL_RULES.MOVE_PER_VIEWER * n,
		jump: 1 + SOCIAL_RULES.JUMP_PER_VIEWER * n,
		dmg: 1 + SOCIAL_RULES.DMG_PER_VIEWER * n
	};
}

// Watcher permission ladder (host-controlled, per viewer):
//   watch — presence only; chat — may also send short texts; full — may also buff
export const PERMISSION_MODES = ['watch', 'chat', 'full'];
export function validPermissionMode(m){ return PERMISSION_MODES.includes(m); }

// --- ghost dread: creatures shy away from an ACTIVE spirit ----------------------
// The living world can feel a watcher hovering: within DREAD_R the creature
// breaks off what it was doing and bolts the other way. Only ACTIVE watchers
// haunt (an idle parked tab is furniture, not a phantom) — same anti-abuse
// principle as the social boosts. Pure: the entity systems call dreadAt().
export const DREAD = { R: 6.5, FLEE_SPEED: 3.2, DISTRACT_MS: 900 };
export function dreadAt(spirits, x, y, radius){
	if(!Array.isArray(spirits) || !spirits.length || !Number.isFinite(x) || !Number.isFinite(y)) return null;
	const r = Number.isFinite(radius) ? radius : DREAD.R;
	const r2 = r * r;
	let best = null, bestD2 = r2;
	for(let i = 0; i < spirits.length; i++){
		const s = spirits[i];
		if(!s || !Number.isFinite(s.x) || !Number.isFinite(s.y)) continue;
		const dx = x - s.x, dy = y - s.y;
		const d2 = dx * dx + dy * dy;
		if(d2 > bestD2) continue;
		bestD2 = d2;
		const d = Math.sqrt(d2) || 0.0001;
		// `i` credits the fright to the spirit that caused it (watcher progression)
		best = { i, x: s.x, y: s.y, dist: d, awayX: dx / d, awayY: dy / d, power: 1 - d / r };
	}
	return best;
}

// --- watcher powers: earned by ACTIVITY, spent on the world ---------------------
// Charge accrues only while the watcher is active (CHARGE_PER_SEC), so powers are
// literally a reward for watching attentively; idling both stops the accrual and
// (via the social gate) the host's boosts.
export const POWER_CHARGE = { PER_SEC: 1, MAX: 120 };
export const POWER_RULES = {
	frost:  { cost: 45, cd: 30000, r: 4.5, label: 'Mroźna aura', icon: '❄️' },
	smite:  { cost: 60, cd: 45000, r: 3.2, dmg: 14, label: 'Grom', icon: '⚡' },
	banish: { cost: 30, cd: 20000, r: 5.5, label: 'Popłoch', icon: '💀' }
};
export function validPowerKind(k){ return typeof k === 'string' && Object.prototype.hasOwnProperty.call(POWER_RULES, k); }
export function chargeAfter(charge, dtSec, active){
	const c = Number.isFinite(charge) ? charge : 0;
	if(!active) return Math.max(0, Math.min(POWER_CHARGE.MAX, c));
	return Math.max(0, Math.min(POWER_CHARGE.MAX, c + POWER_CHARGE.PER_SEC * Math.max(0, dtSec || 0)));
}

// --- assistant role: appointed watchers craft & manage gear for the host ----------
// Strictly delegates: they can only run recipes and equip items the HOST already
// owns — never place blocks, move the hero, or conjure resources. SEVERAL may hold
// the seat at once; the host executes requests serially, so "first to act wins" is
// the natural arbitration — the second request simply fails its cost check.
export const ASSIST_ACTIONS = ['craft', 'equip', 'unequip'];
export function validAssistAction(a){ return ASSIST_ACTIONS.includes(a); }
export const ASSIST_LIMITS = {
	CRAFT_MAX: 10,        // one request may batch at most this many crafts
	RATE_MS: 200,         // per-assistant floor between requests (double-click guard)
	QUEUE_MAX: 12,        // approval queue: total pending ceiling
	QUEUE_PER_GHOST: 3,   // approval queue: one assistant may hold this many slots
	QUEUE_TTL_MS: 180000  // an unapproved request quietly expires after 3 min
};
export function clampCraftCount(n){
	const c = Math.floor(Number(n));
	return Number.isFinite(c) ? Math.max(1, Math.min(ASSIST_LIMITS.CRAFT_MAX, c)) : 1;
}
// Approval queue (pure): when the host turns approvals on, assistant requests wait
// here until the host clicks Zatwierdź/Odrzuć. Bounded on both axes so a spamming
// assistant can neither bury the host in rows nor starve the other assistants.
export function createAssistQueue(){
	let seq = 0;
	const list = [];
	return {
		push(req, t){
			if(list.length >= ASSIST_LIMITS.QUEUE_MAX) return { ok: false, reason: 'full' };
			let mine = 0;
			for(const q of list){ if(q.gid === req.gid) mine++; }
			if(mine >= ASSIST_LIMITS.QUEUE_PER_GHOST) return { ok: false, reason: 'yours' };
			const q = { qid: 'q' + (++seq), at: Number(t) || 0, gid: req.gid, name: req.name, a: req.a, id: req.id, n: req.n, label: req.label };
			list.push(q);
			return { ok: true, qid: q.qid };
		},
		take(qid){
			const i = list.findIndex(q => q.qid === qid);
			return i < 0 ? null : list.splice(i, 1)[0];
		},
		expire(t){
			const dead = [];
			for(let i = list.length - 1; i >= 0; i--){
				if(t - list[i].at > ASSIST_LIMITS.QUEUE_TTL_MS) dead.push(list.splice(i, 1)[0]);
			}
			return dead;
		},
		list(){ return list.slice(); },
		size(){ return list.length; }
	};
}

// Spirit avatar registry — ids ride hello/presence; painters live in ghost_host.
export const AVATARS = ['duszek', 'iskra', 'gwiazdka', 'kotek', 'sowa', 'orbita'];
export function validAvatar(a){ return AVATARS.includes(a); }

// --- spirit lift: a ghost never covers the hero -----------------------------------
// A spirit whose display position drifts onto the hero (follow mode parks the
// camera exactly there) is DISPLAYED hovering above the hero's head instead; the
// true position (dread, powers, presence) is untouched. The lift is continuous in
// every direction so a passing spirit glides over the hero instead of popping.
export const SPIRIT_AVOID = { RX: 0.95, RY: 1.4, CLEAR: 1.05 };
export function spiritLift(sx, sy, hx, hy){
	if(!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(hx) || !Number.isFinite(hy)) return 0;
	const adx = Math.abs(sx - hx);
	if(adx >= SPIRIT_AVOID.RX) return 0;
	const hover = hy - SPIRIT_AVOID.CLEAR; // the hover line above the hero's head
	if(sy <= hover) return 0;              // already clear of the hero
	const below = sy - hy;
	if(below >= SPIRIT_AVOID.RY) return 0; // far under the hero's feet — leave it
	const wx = 1 - adx / SPIRIT_AVOID.RX;
	const wy = below > 0 ? 1 - below / SPIRIT_AVOID.RY : 1;
	return (sy - hover) * wx * wy;
}

// --- pings: a watcher points at a spot -------------------------------------------
// Communication, not influence: the marker lands at the SPIRIT's own tracked pose
// (the host never trusts client coordinates), is rate-limited per watcher, and
// earns no XP — a pointer, not a faucet.
export const PING = { MIN_MS: 2500, TTL_MS: 4000 };

// --- watcher progression (the ghost's own career) ---------------------------------
// A viewer levels up for the things they actually DO. Two rules shape the design:
//
//   1. The HOST mints every XP deed. Only it knows what really landed (the blessing
//      passed the ledger, the power hit 4 creatures, the craft succeeded), so the
//      client never invents XP — it receives deeds and banks them.
//   2. The profile is stored in the WATCHER's own localStorage, which is why it
//      survives a reload, a fresh invite link, and even a different host. It is
//      therefore FORGEABLE — so progression is a REWARD, never an AUTHORITY. No
//      host-side gate (buff, power, charge, assistant seat) may read a level or an
//      achievement. Faking your own trophy case hurts nobody.
//
// Idle time earns nothing: the watch deed only ticks while the viewer is active,
// the same anti-fake-watcher rule that gates the social boosts.
export const PROG_KEY = 'mm_ghost_prog_v1';
export const PROG = {
	WATCH_TICK_MS: 10000, // one watch deed per 10 s of ACTIVE presence
	CHAT_XP_MS: 20000,    // chat XP floor (chat itself is already rate-limited at 4 s)
	MAX_LEVEL: 40,
	HIT_CAP: 6,           // creatures counted from a single power blast
	MAX_DAYS: 400
};
// deed key -> XP each. The host sends {t:'deed', k, n}; the client scores it here.
export const DEED_XP = {
	watch: 1,                          // per 10 s of active watching
	cheer: 2, bless: 6, energy: 6,     // blessings that passed the host ledger
	banish: 8, frost: 10, smite: 12,   // powers the host actually cast
	hit: 2,                            // per creature caught in a power (capped)
	spook: 1,                          // a creature bolted from your spirit
	craft: 6, equip: 2, unequip: 1,    // assistant work
	chat: 1,
	join: 5,                           // showing up at a layer
	crowd: 0                           // watched alongside a crowd (achievement only)
};
export function validDeed(k){ return typeof k === 'string' && Object.prototype.hasOwnProperty.call(DEED_XP, k); }
export function deedXp(k, n){
	if(!validDeed(k)) return 0;
	const count = Math.max(1, Math.min(k === 'hit' ? PROG.HIT_CAP : 50, Math.floor(Number(n) || 1)));
	return DEED_XP[k] * count;
}
// A gentle curve: ~60 XP for the first level, ×1.22 per step. Pure watching earns
// 6 XP/min, so level 10 is a few attentive evenings — faster if you actually help.
export function xpForLevel(level){
	const l = Math.max(1, Math.floor(level) || 1);
	if(l >= PROG.MAX_LEVEL) return 0;
	return Math.round(60 * Math.pow(1.22, l - 1));
}
export function levelFor(xp){
	let rest = Math.max(0, Math.floor(Number(xp) || 0));
	let level = 1;
	while(level < PROG.MAX_LEVEL){
		const need = xpForLevel(level);
		if(rest < need) break;
		rest -= need;
		level++;
	}
	return { level, into: rest, need: xpForLevel(level) };
}
export const RANKS = [
	{ at: 1, name: 'Gapiowicz', color: '#9db4cc' },
	{ at: 3, name: 'Cień', color: '#8fc7ff' },
	{ at: 6, name: 'Widmo', color: '#66e0c8' },
	{ at: 10, name: 'Duch Warstwy', color: '#9be36b' },
	{ at: 15, name: 'Zjawa', color: '#ffd54a' },
	{ at: 22, name: 'Upiór', color: '#ff9f5a' },
	{ at: 30, name: 'Strażnik Warstwy', color: '#d7a1ff' }
];
export function rankFor(level){
	const l = Math.max(1, Math.floor(Number(level) || 1));
	let best = RANKS[0];
	for(const r of RANKS){ if(l >= r.at) best = r; }
	return best;
}
// Achievements read a stat view (raw deed counters + derived level/days/wardrobe),
// so adding one is a table edit, not a code path.
export const ACHIEVEMENTS = [
	{ id: 'first_watch', icon: '👁', name: 'Pierwsze spojrzenie', desc: 'Wejdź do cudzej warstwy', stat: 'join', need: 1, xp: 10 },
	{ id: 'cheerleader', icon: '✨', name: 'Kibic', desc: '10 dopingów', stat: 'cheer', need: 10, xp: 20 },
	{ id: 'healer', icon: '💚', name: 'Uzdrowiciel', desc: '10 błogosławieństw', stat: 'bless', need: 10, xp: 40 },
	{ id: 'dynamo', icon: '⚡', name: 'Iskra', desc: '10 × energia dla gracza', stat: 'energy', need: 10, xp: 40 },
	{ id: 'watchful', icon: '🕰', name: 'Czujny', desc: '30 minut aktywnej obserwacji', stat: 'watch', need: 180, xp: 50 },
	{ id: 'marathon', icon: '🌙', name: 'Maratończyk', desc: '3 godziny aktywnej obserwacji', stat: 'watch', need: 1080, xp: 150 },
	{ id: 'boo', icon: '😱', name: 'Straszak', desc: 'Spłosz 25 stworów', stat: 'spook', need: 25, xp: 30 },
	{ id: 'poltergeist', icon: '👻', name: 'Poltergeist', desc: 'Spłosz 200 stworów', stat: 'spook', need: 200, xp: 90 },
	{ id: 'first_power', icon: '💀', name: 'Pierwsza moc', desc: 'Rzuć Popłoch', stat: 'banish', need: 1, xp: 15 },
	{ id: 'frostbite', icon: '❄️', name: 'Mroźny oddech', desc: '10 × Mróz', stat: 'frost', need: 10, xp: 50 },
	{ id: 'thunder', icon: '🌩', name: 'Gromowładny', desc: '10 × Grom', stat: 'smite', need: 10, xp: 60 },
	{ id: 'sniper', icon: '🎯', name: 'Celny duch', desc: 'Dosięgnij mocami 50 stworów', stat: 'hit', need: 50, xp: 60 },
	{ id: 'artisan', icon: '🛠', name: 'Rzemieślnik', desc: 'Wytwórz 10 przedmiotów jako asystent', stat: 'craft', need: 10, xp: 60 },
	{ id: 'valet', icon: '🎽', name: 'Garderobiany', desc: '10 zmian ekwipunku gracza', stat: 'wardrobe', need: 10, xp: 30 },
	{ id: 'chatter', icon: '💬', name: 'Gaduła', desc: '25 wiadomości', stat: 'chat', need: 25, xp: 25 },
	{ id: 'crowd', icon: '👥', name: 'W tłumie', desc: 'Oglądaj razem z 3 innymi duchami', stat: 'crowd', need: 1, xp: 40 },
	{ id: 'regular', icon: '📅', name: 'Stały bywalec', desc: 'Oglądaj w 3 różne dni', stat: 'days', need: 3, xp: 80 },
	{ id: 'veteran', icon: '🏅', name: 'Weteran warstwy', desc: 'Osiągnij 10. poziom', stat: 'level', need: 10, xp: 100 }
];
export function achievementById(id){ return ACHIEVEMENTS.find(a => a.id === id) || null; }
export function createProgress(){ return { v: 1, xp: 0, counts: {}, done: [], days: [] }; }
// Everything here comes off disk, so treat it as hostile input: an edited profile may
// not crash the watcher's page or smuggle keys into the counters via __proto__.
export function normalizeProgress(raw){
	const s = createProgress();
	if(!raw || typeof raw !== 'object') return s;
	const xp = Number(raw.xp);
	s.xp = Number.isFinite(xp) ? Math.max(0, Math.min(1e9, Math.floor(xp))) : 0;
	const counts = (raw.counts && typeof raw.counts === 'object') ? raw.counts : {};
	for(const k of Object.keys(DEED_XP)){
		if(!Object.prototype.hasOwnProperty.call(counts, k)) continue;
		const n = Number(counts[k]);
		if(Number.isFinite(n) && n > 0) s.counts[k] = Math.min(1e7, Math.floor(n));
	}
	const done = Array.isArray(raw.done) ? raw.done : [];
	for(const a of ACHIEVEMENTS){ if(done.includes(a.id)) s.done.push(a.id); }
	const days = Array.isArray(raw.days) ? raw.days : [];
	for(const d of days){
		if(typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
		if(!s.days.includes(d)) s.days.push(d);
		if(s.days.length >= PROG.MAX_DAYS) break;
	}
	return s;
}
export function statView(state){
	const s = normalizeProgress(state);
	const view = Object.assign({}, s.counts);
	view.level = levelFor(s.xp).level;
	view.days = s.days.length;
	view.wardrobe = (s.counts.equip || 0) + (s.counts.unequip || 0);
	return view;
}
export function achievementProgress(state){
	const view = statView(state);
	const done = new Set(normalizeProgress(state).done);
	return ACHIEVEMENTS.map(a => ({
		def: a,
		done: done.has(a.id),
		have: Math.min(a.need, Math.floor(view[a.stat] || 0)),
		need: a.need
	}));
}
// The one mutation point: fold deeds into a profile, then settle achievements. The
// settle loop repeats because achievement XP can itself push a level threshold that
// another achievement watches ('veteran').
export function progressAfter(state, deeds, opts){
	const s = normalizeProgress(state);
	const before = levelFor(s.xp).level;
	const day = opts && typeof opts.day === 'string' ? opts.day : null;
	if(day && /^\d{4}-\d{2}-\d{2}$/.test(day) && !s.days.includes(day) && s.days.length < PROG.MAX_DAYS) s.days.push(day);
	for(const d of (Array.isArray(deeds) ? deeds : [])){
		if(!d || !validDeed(d.k)) continue;
		const n = Math.max(1, Math.min(50, Math.floor(Number(d.n) || 1)));
		s.counts[d.k] = Math.min(1e7, (s.counts[d.k] || 0) + n);
		s.xp = Math.min(1e9, s.xp + deedXp(d.k, n));
	}
	const unlocked = [];
	for(let pass = 0; pass < 4; pass++){
		const view = statView(s);
		let any = false;
		for(const a of ACHIEVEMENTS){
			if(s.done.includes(a.id)) continue;
			if((view[a.stat] || 0) < a.need) continue;
			s.done.push(a.id);
			s.xp = Math.min(1e9, s.xp + a.xp);
			unlocked.push(a);
			any = true;
		}
		if(!any) break;
	}
	const after = levelFor(s.xp);
	return { state: s, unlocked, level: after.level, leveled: after.level > before, from: before };
}

// --- chat rules + profanity filter (pure) ---------------------------------------
// One source of truth for BOTH ends: the host enforces MIN_MS per peer, and the
// client mirrors it locally so a message sent into the floor is refused with an
// explanation instead of being silently dropped server-side ("chat is broken").
export const CHAT = { MIN_MS: 4000, MAX_LEN: 90 };
// Token-wise masking: fold diacritics + leetspeak, then match against vulgarity
// stems (PL + EN). Over-masking an innocent compound beats letting slurs through.
const PROFANITY_STEMS = [
	'kurw', 'kurew', 'chuj', 'huj', 'pierd', 'jeb', 'pizd', 'cip', 'fiut', 'kutas', 'dziwk', 'szmat', 'debil', 'cwel',
	'fuck', 'shit', 'bitch', 'cunt', 'dick', 'asshole', 'bastard', 'nigg', 'fag', 'whore', 'slut', 'retard'
];
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };
const FOLD = { 'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ż': 'z', 'ź': 'z', 'v': 'w' };
function foldChatToken(tok){
	let out = '';
	for(const ch of tok.toLowerCase()){
		const c = LEET[ch] || FOLD[ch] || ch;
		if(c >= 'a' && c <= 'z') out += c;
	}
	return out;
}
export function filterChat(raw){
	const text = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().slice(0, CHAT.MAX_LEN);
	if(!text) return { text: '', filtered: false, empty: true };
	let filtered = false;
	const out = text.replace(/[^\s]+/g, (tok) => {
		const folded = foldChatToken(tok);
		for(const stem of PROFANITY_STEMS){
			if(folded.includes(stem)){ filtered = true; return '*'.repeat(Math.min(8, Math.max(3, tok.length))); }
		}
		return tok;
	});
	return { text: out, filtered, empty: false };
}

// Room codes avoid lookalike glyphs (0/O, 1/I/L) — they get read out loud.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
export function roomCode(rng){
	const r = typeof rng === 'function' ? rng : Math.random;
	let out = '';
	for(let i = 0; i < 6; i++) out += CODE_ALPHABET[Math.floor(r() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
	return out;
}
export function normalizeRoom(room){
	const up = String(room || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
	return (up.length >= 4 && up.length <= 12) ? up : null;
}
export function watchLink(baseUrl, room, via){
	const base = String(baseUrl || '').split('#')[0].split('?')[0];
	return base + '?watch=' + encodeURIComponent(room) + (via ? '&via=' + encodeURIComponent(via) : '');
}
export function parseWatch(search){
	const q = String(search || '');
	const m = /[?&]watch=([^&#]+)/.exec(q);
	if(!m) return null;
	const room = normalizeRoom(decodeURIComponent(m[1]));
	if(!room) return null;
	const via = /[?&]via=(bc|rtc)\b/.exec(q);
	const name = /[?&]name=([^&#]+)/.exec(q);
	return { room, via: via ? via[1] : null, name: name ? decodeURIComponent(name[1]).slice(0, 24) : null };
}

// --- payload chunking --------------------------------------------------------
// The join snapshot is one big JSON string (the host's save object). It rides
// the same message pipe as everything else, sliced into ordered chunks; the
// assembler tolerates a fresh id preempting a stale, half-received transfer
// (host restarted the snapshot) but rejects gaps inside one transfer.
export function chunkPayload(kind, str, maxLen, id){
	const lim = Math.max(16, Number(maxLen) || 24000);
	const s = String(str);
	const tid = id || ('t' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
	const of = Math.max(1, Math.ceil(s.length / lim));
	const out = [];
	for(let i = 0; i < of; i++) out.push({ t: 'chunk', k: String(kind), id: tid, i, of, d: s.slice(i * lim, (i + 1) * lim) });
	return out;
}
// Bounds are hard limits against a hostile sender: 2048 chunks × 64 KB caps an
// assembled payload at 128 MB of *declared* size, and a chunk whose header
// disagrees with the transfer it claims to belong to is dropped, not trusted.
export const ASSEMBLER_MAX_CHUNKS = 2048;
export const ASSEMBLER_MAX_CHUNK_LEN = 65536;
export function createAssembler(){
	let cur = null; // {id, kind, of, got, parts[]}
	return {
		push(env){
			if(!env || env.t !== 'chunk' || typeof env.d !== 'string') return null;
			const of = env.of | 0, i = env.i | 0;
			if(of < 1 || of > ASSEMBLER_MAX_CHUNKS || env.d.length > ASSEMBLER_MAX_CHUNK_LEN) return null;
			if(!cur || cur.id !== env.id){
				cur = { id: env.id, kind: env.k, of, got: 0, parts: new Array(of) };
			}
			if(of !== cur.of) return null; // header disagrees with its own transfer
			if(!(i >= 0 && i < cur.of)) return null;
			if(cur.parts[i] == null){ cur.parts[i] = env.d; cur.got++; }
			if(cur.got < cur.of) return null;
			const done = { kind: cur.kind, data: cur.parts.join('') };
			cur = null;
			return done;
		},
		pending(){ return cur ? { id: cur.id, kind: cur.kind, got: cur.got, of: cur.of } : null; }
	};
}

// --- buff cooldown ledger (host-side) -----------------------------------------
export function createCooldownLedger(rules){
	const R = rules || BUFF_RULES;
	const used = new Map(); // peerId -> {kind -> lastMs}
	return {
		tryUse(peerId, kind, now){
			if(!R[kind]) return { ok: false, waitMs: 0, reason: 'unknown' };
			const t = Number.isFinite(now) ? now : Date.now();
			let mine = used.get(peerId);
			if(!mine){ mine = {}; used.set(peerId, mine); }
			const last = mine[kind];
			if(last != null){
				const wait = last + R[kind].cd - t;
				if(wait > 0) return { ok: false, waitMs: Math.ceil(wait), reason: 'cooldown' };
			}
			mine[kind] = t;
			return { ok: true, waitMs: R[kind].cd };
		},
		forget(peerId){ used.delete(peerId); }
	};
}

// --- minimal MQTT 3.1.1 codec (pure) ------------------------------------------
// Just enough of the protocol for pub/sub signaling over WebSocket brokers:
// CONNECT/CONNACK, SUBSCRIBE/SUBACK, PUBLISH (QoS0 both ways), PINGREQ/RESP.
function mqttString(str){
	const bytes = new TextEncoder().encode(String(str));
	const out = new Uint8Array(bytes.length + 2);
	out[0] = bytes.length >> 8; out[1] = bytes.length & 0xff; out.set(bytes, 2);
	return out;
}
function mqttRemainingLength(n){
	const out = [];
	do { let b = n % 128; n = Math.floor(n / 128); if(n > 0) b |= 0x80; out.push(b); } while(n > 0);
	return Uint8Array.from(out);
}
function concatBytes(list){
	let len = 0; for(const b of list) len += b.length;
	const out = new Uint8Array(len);
	let o = 0; for(const b of list){ out.set(b, o); o += b.length; }
	return out;
}
export function mqttEncodeConnect(clientId, keepAliveSec){
	const ka = Math.max(10, keepAliveSec | 0 || 50);
	const varHeader = concatBytes([mqttString('MQTT'), Uint8Array.from([4, 0x02, ka >> 8, ka & 0xff])]);
	const payload = mqttString(clientId);
	const body = concatBytes([varHeader, payload]);
	return concatBytes([Uint8Array.from([0x10]), mqttRemainingLength(body.length), body]);
}
export function mqttEncodeSubscribe(packetId, topic){
	const body = concatBytes([Uint8Array.from([packetId >> 8, packetId & 0xff]), mqttString(topic), Uint8Array.from([0])]);
	return concatBytes([Uint8Array.from([0x82]), mqttRemainingLength(body.length), body]);
}
export function mqttEncodePublish(topic, payloadStr){
	const body = concatBytes([mqttString(topic), new TextEncoder().encode(String(payloadStr))]);
	return concatBytes([Uint8Array.from([0x30]), mqttRemainingLength(body.length), body]);
}
export function mqttEncodePing(){ return Uint8Array.from([0xC0, 0]); }
// Streaming decoder: feed arbitrary byte slices, get complete packets out.
export function createMqttDecoder(){
	let buf = new Uint8Array(0);
	return {
		push(bytes){
			buf = buf.length ? concatBytes([buf, bytes]) : Uint8Array.from(bytes);
			const packets = [];
			for(;;){
				if(buf.length < 2) break;
				let len = 0, mult = 1, pos = 1, ok = false;
				for(; pos < buf.length && pos <= 4; pos++){
					const b = buf[pos];
					len += (b & 0x7f) * mult; mult *= 128;
					if(!(b & 0x80)){ ok = true; pos++; break; }
				}
				if(!ok || buf.length < pos + len) break;
				const type = buf[0] >> 4;
				const body = buf.subarray(pos, pos + len);
				if(type === 3){ // PUBLISH (QoS0 assumed — we never subscribe above QoS0)
					const tlen = (body[0] << 8) | body[1];
					const topic = new TextDecoder().decode(body.subarray(2, 2 + tlen));
					const payload = new TextDecoder().decode(body.subarray(2 + tlen));
					packets.push({ type: 'publish', topic, payload });
				} else if(type === 2) packets.push({ type: 'connack', ok: body[1] === 0 });
				else if(type === 9) packets.push({ type: 'suback' });
				else if(type === 13) packets.push({ type: 'pingresp' });
				else packets.push({ type: 'other', id: type });
				buf = buf.subarray(pos + len);
			}
			return packets;
		}
	};
}

// ============================ TRANSPORTS (browser) ============================

// Public WSS brokers for the WebRTC handshake only (~2 KB per join); gameplay
// bytes never touch them. Order = preference; failover walks the list.
export const MQTT_BROKERS = [
	'wss://broker.emqx.io:8084/mqtt',
	'wss://broker.hivemq.com:8884/mqtt',
	'wss://test.mosquitto.org:8081'
];
const RTC_CONFIG = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };
const SIG_NS = 'mmg1/';

function mqttOpen(url, opts){
	const ws = new WebSocket(url, 'mqtt');
	ws.binaryType = 'arraybuffer';
	const dec = createMqttDecoder();
	let pingT = null, subId = 1, connected = false, closed = false, lastPong = 0;
	ws.onopen = () => { ws.send(mqttEncodeConnect('mm_' + Math.random().toString(36).slice(2, 10), 50)); };
	ws.onmessage = (ev) => {
		for(const p of dec.push(new Uint8Array(ev.data))){
			if(p.type === 'connack'){
				if(!p.ok){ api.close(); if(opts.onDown) opts.onDown('connack'); return; }
				connected = true;
				lastPong = Date.now();
				// pong watchdog: a broker that dies without a close frame would
				// otherwise hold this session hostage forever — two missed pings
				// and the socket is declared dead so failover can run
				pingT = setInterval(() => {
					if(Date.now() - lastPong > 80000){ api.close(); if(opts.onDown) opts.onDown('pong-timeout'); return; }
					try{ ws.send(mqttEncodePing()); }catch(e){ /* dying socket */ }
				}, 25000);
				if(opts.onReady) opts.onReady(api);
			} else if(p.type === 'pingresp'){ lastPong = Date.now(); }
			else if(p.type === 'publish' && opts.onMessage) opts.onMessage(p.topic, p.payload);
		}
	};
	ws.onclose = () => { if(pingT) clearInterval(pingT); if(!closed && opts.onDown) opts.onDown('close'); };
	ws.onerror = () => { /* onclose follows */ };
	const api = {
		get connected(){ return connected; },
		subscribe(topic){ try{ ws.send(mqttEncodeSubscribe(subId++, topic)); }catch(e){ /* not open */ } },
		publish(topic, str){ try{ ws.send(mqttEncodePublish(topic, str)); }catch(e){ /* not open */ } },
		close(){ closed = true; if(pingT) clearInterval(pingT); try{ ws.close(); }catch(e){ /* already */ } }
	};
	return api;
}

// Signaling inbox: everyone owns one topic; envelopes carry the sender inbox.
// Failover wraps around the broker list with a delay (a mid-session drop must
// not silently end the ability to accept new joins); success resets the budget
// and pins the next reconnect to the broker that worked.
function openSignal(room, who, handlers){
	let client = null, brokerIdx = 0, attempts = 0, closed = false;
	const inbox = SIG_NS + room + '/' + who;
	function connect(){
		if(closed) return;
		if(attempts >= MQTT_BROKERS.length * 3){ if(handlers.onFail) handlers.onFail(); return; }
		attempts++;
		const url = MQTT_BROKERS[brokerIdx % MQTT_BROKERS.length];
		brokerIdx++;
		client = mqttOpen(url, {
			onReady(c){
				attempts = 0;
				brokerIdx--; // retry this broker first if the socket drops later
				c.subscribe(inbox);
				if(handlers.onReady) handlers.onReady(url);
			},
			onMessage(topic, payload){
				if(topic !== inbox) return;
				let m = null; try{ m = JSON.parse(payload); }catch(e){ return; }
				if(m && typeof m.k === 'string' && typeof m.from === 'string') handlers.onMsg(m);
			},
			onDown(){ if(!closed) setTimeout(connect, 1500); }
		});
	}
	connect();
	return {
		sendTo(whoElse, obj){ if(client && client.connected) client.publish(SIG_NS + room + '/' + whoElse, JSON.stringify(Object.assign({ from: who }, obj))); },
		close(){ closed = true; if(client) client.close(); }
	};
}

// --- loopback (BroadcastChannel) ----------------------------------------------
function bcName(room){ return 'mm_ghost_' + room; }
function createLoopbackHost(room, onPeer){
	const ch = new BroadcastChannel(bcName(room));
	const peers = new Map();
	ch.onmessage = (ev) => {
		const m = ev.data;
		if(!m || m.to !== 'host' || typeof m.from !== 'string' || !m.pl) return;
		let p = peers.get(m.from);
		if(!p){
			p = {
				id: m.from, transport: 'bc', onMessage: null,
				send(pl){ try{ ch.postMessage({ to: this.id, from: 'host', pl }); }catch(e){ /* closing */ } },
				close(){ peers.delete(this.id); }
			};
			peers.set(m.from, p);
			onPeer(p);
		}
		if(p.onMessage) p.onMessage(m.pl);
	};
	return {
		stop(){
			try{ ch.postMessage({ to: '*', from: 'host', pl: { t: 'hostGone' } }); }catch(e){ /* fine */ }
			try{ ch.close(); }catch(e){ /* fine */ }
		}
	};
}
function createLoopbackJoin(room, id){
	const ch = new BroadcastChannel(bcName(room));
	const conn = {
		transport: 'bc', onMessage: null,
		send(pl){ try{ ch.postMessage({ to: 'host', from: id, pl }); }catch(e){ /* closing */ } },
		close(){
			try{ ch.postMessage({ to: 'host', from: id, pl: { t: 'bye' } }); }catch(e){ /* fine */ }
			try{ ch.close(); }catch(e){ /* fine */ }
		}
	};
	ch.onmessage = (ev) => {
		const m = ev.data;
		if(!m || !m.pl) return;
		if(m.to !== id && m.to !== '*') return;
		if(conn.onMessage) conn.onMessage(m.pl);
	};
	return conn;
}

// --- WebRTC -------------------------------------------------------------------
function rtcPeerWrap(id, dc){
	return {
		id, transport: 'rtc', onMessage: null,
		send(pl){ try{ dc.send(JSON.stringify(pl)); }catch(e){ /* channel closing */ } },
		close(){ try{ dc.close(); }catch(e){ /* fine */ } }
	};
}
function createRtcHost(room, handlers){
	const pcs = new Map(); // ghostId -> {pc, peer}
	const sig = openSignal(room, 'h', {
		onReady: handlers.onStatus ? () => handlers.onStatus('signal-ready') : null,
		onFail: handlers.onStatus ? () => handlers.onStatus('signal-fail') : null,
		onMsg(m){
			const gid = m.from;
			if(m.k === 'hi'){
				if(pcs.has(gid)) return; // one connection per ghost id
				const pc = new RTCPeerConnection(RTC_CONFIG);
				const entry = { pc, peer: null };
				pcs.set(gid, entry);
				const dc = pc.createDataChannel('mm', { ordered: true });
				pc.onicecandidate = (e) => { if(e.candidate) sig.sendTo(gid, { k: 'ice', c: e.candidate }); };
				pc.onconnectionstatechange = () => {
					if(pc.connectionState === 'failed' || pc.connectionState === 'closed'){ pcs.delete(gid); }
				};
				dc.onopen = () => {
					entry.peer = rtcPeerWrap(gid, dc);
					dc.onmessage = (ev) => { let pl = null; try{ pl = JSON.parse(ev.data); }catch(e){ return; } if(entry.peer.onMessage) entry.peer.onMessage(pl); };
					dc.onclose = () => { if(entry.peer && entry.peer.onMessage) entry.peer.onMessage({ t: 'bye' }); pcs.delete(gid); };
					handlers.onPeer(entry.peer);
				};
				pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => sig.sendTo(gid, { k: 'offer', sdp: pc.localDescription })).catch(() => pcs.delete(gid));
			} else if(m.k === 'answer' && pcs.has(gid)){
				pcs.get(gid).pc.setRemoteDescription(m.sdp).catch(() => {});
			} else if(m.k === 'ice' && pcs.has(gid) && m.c){
				pcs.get(gid).pc.addIceCandidate(m.c).catch(() => {});
			}
		}
	});
	return {
		stop(){
			for(const { pc, peer } of pcs.values()){ try{ if(peer) peer.send({ t: 'hostGone' }); }catch(e){ /* fine */ } try{ pc.close(); }catch(e){ /* fine */ } }
			pcs.clear();
			sig.close();
		}
	};
}
function createRtcJoin(room, gid, handlers){
	let pc = null, hiT = null, closed = false;
	const sig = openSignal(room, 'g' + gid, {
		onReady(){
			sig.sendTo('h', { k: 'hi' });
			hiT = setInterval(() => { if(!pc) sig.sendTo('h', { k: 'hi' }); }, 2500);
		},
		onFail: handlers.onFail || null,
		onMsg(m){
			if(m.k === 'offer' && !pc){
				pc = new RTCPeerConnection(RTC_CONFIG);
				pc.onicecandidate = (e) => { if(e.candidate) sig.sendTo('h', { k: 'ice', c: e.candidate }); };
				pc.ondatachannel = (ev) => {
					const dc = ev.channel;
					const conn = rtcPeerWrap('host', dc);
					dc.onmessage = (mv) => { let pl = null; try{ pl = JSON.parse(mv.data); }catch(e){ return; } if(conn.onMessage) conn.onMessage(pl); };
					dc.onopen = () => handlers.onOpen(conn);
					// a dropped channel is a network event, not a goodbye — the client
					// reconnects on connLost but treats hostGone as final
					dc.onclose = () => { if(!closed && conn.onMessage) conn.onMessage({ t: 'connLost' }); };
				};
				pc.setRemoteDescription(m.sdp).then(() => pc.createAnswer()).then(a => pc.setLocalDescription(a)).then(() => sig.sendTo('h', { k: 'answer', sdp: pc.localDescription })).catch(() => {});
			} else if(m.k === 'ice' && pc && m.c){
				pc.addIceCandidate(m.c).catch(() => {});
			}
		}
	});
	return {
		close(){ closed = true; if(hiT) clearInterval(hiT); try{ if(pc) pc.close(); }catch(e){ /* fine */ } sig.close(); }
	};
}

// --- facades --------------------------------------------------------------------
// Host listens on every transport it can: the same watch link then works for a
// second tab on this machine (loopback) and for a friend across the internet (rtc).
export function hostListen(room, opts){
	const stops = [];
	const status = { bc: false, rtc: false };
	try{
		if(typeof BroadcastChannel !== 'undefined'){ stops.push(createLoopbackHost(room, opts.onPeer).stop); status.bc = true; }
	}catch(e){ /* no loopback */ }
	if(opts.rtc !== false && typeof RTCPeerConnection !== 'undefined' && typeof WebSocket !== 'undefined'){
		try{ stops.push(createRtcHost(room, { onPeer: opts.onPeer, onStatus: opts.onStatus }).stop); status.rtc = true; }catch(e){ /* rtc unavailable */ }
	}
	return { transports: status, stop(){ for(const s of stops){ try{ s(); }catch(e){ /* fine */ } } } };
}
// Ghost joins on every transport too and locks to whichever the host answers on.
export function joinRoom(room, opts){
	const conns = [];
	const closers = [];
	let locked = null;
	const api = {
		send(pl){ for(const c of (locked ? [locked] : conns)){ try{ c.send(pl); }catch(e){ /* fine */ } } },
		lock(c){
			if(locked || !c) return;
			locked = c;
			for(const other of conns){ if(other !== c){ try{ other.close(); }catch(e){ /* fine */ } } }
		},
		transport(){ return locked ? locked.transport : conns.map(c => c.transport).join('+') || 'none'; },
		close(){
			for(const c of (locked ? [locked] : conns)){ try{ c.close(); }catch(e){ /* fine */ } }
			for(const s of closers){ try{ s(); }catch(e){ /* fine */ } }
		}
	};
	const wire = (c) => { c.onMessage = (pl) => opts.onMessage(pl, c, api); conns.push(c); };
	if(opts.via !== 'rtc'){
		try{ if(typeof BroadcastChannel !== 'undefined') wire(createLoopbackJoin(room, opts.id)); }catch(e){ /* no loopback */ }
	}
	if(opts.via !== 'bc' && typeof RTCPeerConnection !== 'undefined' && typeof WebSocket !== 'undefined'){
		try{
			const j = createRtcJoin(room, opts.id, { onOpen: (c) => { wire(c); if(opts.onTransportUp) opts.onTransportUp(c); }, onFail: opts.onSignalFail });
			closers.push(j.close);
		}catch(e){ /* rtc unavailable */ }
	}
	return api;
}

// The engine consumes THIS object (`import { ghostNet as NET }`), not the module
// namespace — a named export missing from here is simply undefined at runtime while
// every Node test still passes. ghost-sim pins the two lists against each other.
const api = {
	GHOST_PROTO, BUFF_RULES, MQTT_BROKERS,
	SOCIAL_RULES, socialBoosts, PERMISSION_MODES, validPermissionMode, AVATARS, validAvatar, CHAT, filterChat,
	SPIRIT_AVOID, spiritLift, PING,
	DREAD, dreadAt, POWER_RULES, POWER_CHARGE, validPowerKind, chargeAfter, ASSIST_ACTIONS, validAssistAction,
	ASSIST_LIMITS, clampCraftCount, createAssistQueue,
	roomCode, normalizeRoom, watchLink, parseWatch, validBuffKind,
	chunkPayload, createAssembler, createCooldownLedger,
	PROG_KEY, PROG, DEED_XP, validDeed, deedXp, xpForLevel, levelFor, RANKS, rankFor,
	ACHIEVEMENTS, achievementById, achievementProgress, createProgress, normalizeProgress, statView, progressAfter,
	hostListen, joinRoom
};
if(typeof window !== 'undefined' && window.MM) window.MM.ghostNet = api;
export const ghostNet = api;
export default ghostNet;
