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
import { HERO_BODY_W, HERO_BODY_H } from '../constants.js';

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
//   watch — presence only; chat — may also send short texts; full — may also buff;
//   play  — EMBODIED: an own hero in the host's world (move, mine, build, fight);
//   hero  — FULL GAME: the guest runs the real hero systems locally (hotbar,
//           crafting, inventory, XP — its own local truth by the owner's trust
//           ruling) while the host still validates every WORLD effect (tile
//           writes, entity damage) with solo-grade rules. play remains the
//           zero-trust option; hero is the friends-coop parity option.
// The ladder is strictly inclusive: hero ⊇ play ⊇ full ⊇ chat ⊇ watch, so
// promoting a ghost never takes away a lower ability — the ghost system
// remains the default and the safe floor.
export const PERMISSION_MODES = ['watch', 'chat', 'full', 'play', 'hero'];
export function validPermissionMode(m){ return PERMISSION_MODES.includes(m); }
export function modeAllows(mode, need){
	const have = PERMISSION_MODES.indexOf(mode);
	const want = PERMISSION_MODES.indexOf(need);
	return have >= 0 && want >= 0 && have >= want;
}

// --- play mode: the embodied guest ------------------------------------------------
// Authority split (the whole safety story in two lines): the GUEST simulates its
// own hero locally (movement feels instant), the HOST owns everything that matters
// — vitals, pouch, every world edit — and validates each intent against reach,
// rate and inventory. A hostile client can therefore spam requests, never effects.
export const PLAY_RULES = {
	REACH: 5,          // Chebyshev build/mine reach in tiles (mirrors the host's PLACE_REACH)
	MINE_MS: 150,      // per-body floor between mine intents
	MINE_TICKS: 3,     // intents to break one tile (~0.5 s/tile at the floor)
	PLACE_MS: 180,     // per-body floor between placements
	POSE_MS: 80,       // guest pose uplink cadence
	MAX_SPEED: 30,     // tiles/s envelope — a claimed pose beyond it is clamped, not trusted
	BODY_W: HERO_BODY_W, BODY_H: HERO_BODY_H,
	MAX_HP: 80,
	HURT_INVUL_MS: 600,
	RESPAWN_MS: 6000,
	POUCH_CAP: 999,   // per-resource ceiling in the host-owned pouch
	ATTACK_MS: 240,   // global per-body floor between weapon intents (per-weapon cd stacks on top)
	MINE_TICKS_MAX: 12, // hardness-derived tick need is clamped into [1, this]
	CRAFT_MS: 400,    // per-body floor between craft intents
	DUEL_MS: 800,     // per-body floor between duel intents
	DUEL_TTL_MS: 30000, // a duel challenge waits this long for the other side's consent
	GIFT_MAX: 99,     // per-gift ceiling on host → guest resource transfers
	PICKUP_MS: 200,   // per-body floor between ground-pickup intents
	EAT_MS: 500,      // per-body floor between eat intents
	LOOK_MS: 1000     // per-viewer floor between look changes
};
// The guest's chosen body color: persisted in the GUEST browser like the name,
// validated HOST-side, relayed to every renderer. Display-only — a look changes
// no rule anywhere. The strict hex shape matters: the value reaches fillStyle.
export const LOOK_KEY = 'mm_ghost_look_v1';
export function validLookColor(c){
	return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
}
// The guest larder: what a pouch item heals when eaten. Values mirror the host's
// food.js where keys overlap (meat 12, bakedMeat 35); meatScrap is the guest-scale
// snack — it is what THEIR kills drop and what pickup brings home. Rotten meat is
// deliberately absent: the pouch never poisons its owner.
export const PLAY_FOODS = {
	meatScrap: { label: 'Ochłap', icon: '🍖', hp: 6 },
	meat:      { label: 'Surowe mięso', icon: '🥩', hp: 12 },
	bakedMeat: { label: 'Pieczone mięso', icon: '🍗', hp: 35 },
	fish:      { label: 'Ryba', icon: '🐟', hp: 10 }
};
export function validPlayFood(k){
	return typeof k === 'string' && Object.prototype.hasOwnProperty.call(PLAY_FOODS, k) && k !== '__proto__';
}
// The guest's stable identity key (persisted in the GUEST browser, on the storage
// lockdown allowlist). Self-claimed like the display name — never an authority,
// only the key the host may hang HOST-side state on (kept pouch/arsenal, bans).
// The lease marks the base identity as held by a LIVE tab: a second tab in the
// same browser mints its own gid instead of colliding (the host's newest-wins
// reconnect rule would otherwise boot the first tab).
export const GID_KEY = 'mm_ghost_gid_v1';
export const GID_LEASE_KEY = 'mm_ghost_gid_lease_v1';
export const GID_LEASE_MS = 8000;
export function validGid(gid){ return typeof gid === 'string' && /^g[a-zA-Z0-9._-]{1,39}$/.test(gid); }
// Length/character concatenation is ambiguous (`a>b>c` can be split more than one
// way). JSON's tuple encoding keeps mutual-duel consent bound to the exact pair.
export function duelAskKey(fromGid, toGid){ return JSON.stringify([fromGid, toGid]); }
// --- hero mode: the full-game guest --------------------------------------------------
// Authority split (the owner's trust ruling for friends co-op): the guest's PLAYER
// state — inventory, gear, XP, vitals — is its own LOCAL truth, persisted in the
// guest browser under HERO_KEY. The host protects only the shared WORLD: every
// tile write and every entity-damage application is validated here with the same
// rules the solo player obeys (reach, rate, mineability, placement legality,
// damage envelope). A modified hero client can gild its own trophy case; it still
// cannot write a single illegal tile or one-shot a boss.
export const HERO_KEY = 'mm_ghost_hero_v1';
export const HERO_ACTIONS = ['mine', 'place', 'dmg', 'pickup', 'use', 'shoot', 'row', 'board', 'unboard', 'tp', 'antenna', 'gfx'];
export function validHeroAction(a){ return HERO_ACTIONS.includes(a); }
export const HERO_RULES = {
	REACH: 6,        // solo MINE/PLACE reach is 5; +1 tolerance for pose-stream lag
	MINE_MS: 100,    // per-guest floor between accepted tile breaks
	PLACE_MS: 90,    // per-guest floor between accepted placements
	DMG_MS: 120,     // per-guest floor between damage applications
	DMG_MAX: 45,     // one application may carry at most this much damage
	DMG_RADIUS: 7,   // claimed impact point must be within this of the tracked body
	HP_MAX: 1000,    // claimed vitals (display/targeting truth) are clamped into [0, this]
	PICKUP_MS: 150,  // per-guest floor between ground-pickup intents
	USE_MS: 400,     // per-guest floor between world interactions (chests)
	SHOOT_MS: 220,   // per-guest floor between projectile intents
	ROW_MS: 250,     // per-guest floor between oar strokes
	BOARD_MS: 400,   // per-guest floor between mech board/unboard intents
	TP_MS: 1200,     // per-guest floor between teleporter jumps (matches the pad cooldown)
	ANTENNA_MS: 1500, // per-guest floor between antenna-power intents (real cooldown is per-active, host-side)
	GFX_MS: 700      // per-guest floor between soot-graffiti paints (glyphs are whitelisted host-side)
};
export const PLAY_ACTIONS = ['mine', 'place', 'attack', 'craft', 'duel', 'pickup', 'eat'];
export function validPlayAction(a){ return PLAY_ACTIONS.includes(a); }
// --- the guest arsenal -------------------------------------------------------------
// Curated starter templates, resolved HOST-side through the real combat chains
// (weapons.js coopMeleeAt / spawnCoopArrow). Ownership lives on the host body
// (body.weapons); a modified client can name any kind it likes — the host only
// honors what the body actually owns, at the weapon's own cooldown, spending ammo
// from the host-owned pouch. Real acquired gear arrives with the crafting wave;
// the combat plumbing (this table, the intent shape, body attribution) is final.
export const PLAY_WEAPONS = {
	fists: { melee: true,  label: 'Pięści',   icon: '👊', dmg: 0, reach: 2, cdMs: 450 },
	sword: { melee: true,  label: 'Miecz',    icon: '🗡️', dmg: 6, reach: 2, cdMs: 550 },
	bow:   { melee: false, label: 'Łuk',      icon: '🏹', dmg: 6, cdMs: 750, ammo: 'arrowWood', speed: 15 },
	spear: { melee: true,  label: 'Włócznia', icon: '🔱', dmg: 5, reach: 3, cdMs: 650 } // crafted, not starter
};
export const PLAY_STARTER_WEAPONS = ['fists', 'sword', 'bow'];
export const PLAY_STARTER_AMMO = { arrowWood: 40 };
export function validPlayWeapon(k){
	return typeof k === 'string' && Object.prototype.hasOwnProperty.call(PLAY_WEAPONS, k) && k !== '__proto__';
}
// --- guest crafting ----------------------------------------------------------------
// A guest crafts from ITS OWN pouch into its own pouch/arsenal — the host inventory
// is never touched. Recipes are curated like the arsenal (Wave C of the co-op plan):
// ammo keeps the bow alive without farming rejoin-resets, the spear is the first
// piece of gear a guest EARNS. Costs are checked and spent host-side, atomically.
export const PLAY_RECIPES = {
	arrows: { label: 'Strzały ×10', icon: '🏹', cost: { wood: 2, stone: 1 }, gives: { arrowWood: 10 } },
	spear:  { label: 'Włócznia',    icon: '🔱', cost: { wood: 6, stone: 4 }, weapon: 'spear' }
};
export function validPlayRecipe(k){
	return typeof k === 'string' && Object.prototype.hasOwnProperty.call(PLAY_RECIPES, k) && k !== '__proto__';
}
export function pouchAfford(pouch, cost){
	if(!pouch || !cost || typeof cost !== 'object') return false;
	for(const k of Object.keys(cost)){
		if((Number(pouch[k]) || 0) < (Number(cost[k]) || 0)) return false;
	}
	return true;
}
// All-or-nothing: a partial spend would let a race between two intents strip the
// pouch below zero on one leg and still deliver the goods on the other.
export function pouchSpend(pouch, cost){
	if(!pouchAfford(pouch, cost)) return false;
	for(const k of Object.keys(cost)){
		const n = Number(cost[k]) || 0;
		if(n > 0) pouchTake(pouch, k, n); // pouchTake floors to 1 — a zero cost must not charge
	}
	return true;
}
// Normalized aim direction from the body to a claimed world point — null when the
// claim is degenerate (non-finite, or on top of the body). The HOST derives every
// projectile from this, so a hostile client cannot smuggle velocity or position.
export function playAimDir(bx, by, aimX, aimY){
	const ax = Number(aimX), ay = Number(aimY);
	if(!Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(ax) || !Number.isFinite(ay)) return null;
	const dx = ax - bx, dy = ay - by;
	const d = Math.hypot(dx, dy);
	if(!(d > 0.05)) return null;
	return { dx: dx / d, dy: dy / d };
}
export function playReachOk(bx, by, tx, ty, reach){
	if(!Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(tx) || !Number.isFinite(ty)) return false;
	const r = Number.isFinite(reach) ? reach : PLAY_RULES.REACH;
	return Math.abs(tx - Math.floor(bx)) <= r && Math.abs(ty - Math.floor(by)) <= r;
}
// Per-axis movement envelope: the body follows the guest's claim at most MAX_SPEED
// fast. An honest guest never hits the clamp; a teleport hack rubber-bands.
export function clampBodyStep(cur, claimed, maxStep){
	if(!Number.isFinite(claimed)) return cur;
	if(!Number.isFinite(cur)) return claimed;
	const step = Math.max(0, Number(maxStep) || 0);
	const d = claimed - cur;
	if(d > step) return cur + step;
	if(d < -step) return cur - step;
	return claimed;
}
// The pouch is host state fed only by validated deeds — clamped both ways so a
// replayed credit can neither overflow nor a double-spend go negative.
export function pouchAdd(pouch, key, n){
	if(!pouch || typeof key !== 'string' || !key || key === '__proto__') return 0;
	const cur = Number(pouch[key]) || 0;
	const next = Math.max(0, Math.min(PLAY_RULES.POUCH_CAP, cur + Math.floor(Number(n) || 0)));
	pouch[key] = next;
	return next;
}
export function pouchTake(pouch, key, n){
	if(!pouch || typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(pouch, key)) return false;
	const want = Math.max(1, Math.floor(Number(n) || 1));
	const cur = Number(pouch[key]) || 0;
	if(cur < want) return false;
	pouch[key] = cur - want;
	return true;
}

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
// The invite secret rides the URL FRAGMENT (#k=…): fragments are not sent in HTTP
// requests or Referer headers, so the capability that gates authenticated remote join
// stays on the two devices that hold the link. The base watch link (no secret) only
// ever connects same-machine (loopback) — sharing it by accident exposes no remote.
export function watchLink(baseUrl, room, via, secret){
	const base = String(baseUrl || '').split('#')[0].split('?')[0];
	const q = '?watch=' + encodeURIComponent(room) + (via ? '&via=' + encodeURIComponent(via) : '');
	return base + q + (validInviteSecret(secret) ? '#k=' + secret : '');
}
// Extract the invite secret from a URL fragment or query — validated to the secret
// shape so a garbage fragment can never be mistaken for a key.
export function parseInviteSecret(str){
	const m = /[#?&]k=((?:[0-9a-fA-F]{64}|[0-9a-fA-F]{32}))(?![0-9a-fA-F])/.exec(String(str || ''));
	const k = m ? m[1].toLowerCase() : null;
	return validInviteSecret(k) ? k : null;
}
export function parseWatch(search, hash){
	const q = String(search || '');
	const m = /[?&]watch=([^&#]+)/.exec(q);
	if(!m) return null;
	// decodeURIComponent THROWS on a malformed escape ("?watch=AB%") and this runs
	// at module import time on a user-pasted link — a truncated invite must degrade
	// to the raw text, never take the whole module chain (and the game) down with it
	const dec = (s) => { try{ return decodeURIComponent(s); }catch(e){ return s; } };
	const room = normalizeRoom(dec(m[1]));
	if(!room) return null;
	const via = /[?&]via=(bc|rtc)\b/.exec(q);
	const name = /[?&]name=([^&#]+)/.exec(q);
	// Fragment-only: a query fallback would leak the bearer capability into HTTP
	// requests, server logs and Referer headers.
	const secret = parseInviteSecret(hash != null ? hash : '');
	return { room, via: via ? via[1] : null, name: name ? dec(name[1]).slice(0, 24) : null, secret: secret || null };
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
	let cur = null; // {id, kind, of, got, parts[], bytes}
	return {
		push(env){
			if(!env || env.t !== 'chunk' || typeof env.d !== 'string') return null;
			const of = env.of | 0, i = env.i | 0;
			if(of < 1 || of > ASSEMBLER_MAX_CHUNKS || env.d.length > ASSEMBLER_MAX_CHUNK_LEN) return null;
			if(!cur || cur.id !== env.id){
				cur = { id: env.id, kind: env.k, of, got: 0, parts: new Array(of), bytes: 0 };
			}
			if(of !== cur.of) return null; // header disagrees with its own transfer
			if(!(i >= 0 && i < cur.of)) return null;
			if(cur.parts[i] == null){
				// byte-count the running total (UTF-8, not code units) so a hostile
				// transfer of many just-legal chunks can't assemble past the ceiling
				cur.bytes += utf8Len(env.d);
				if(cur.bytes > WIRE_LIMITS.ASSEMBLED_MAX){ cur = null; return null; }
				cur.parts[i] = env.d; cur.got++;
			}
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
	// Entries deliberately survive disconnects (forgetting on drop would let a
	// guest reset cooldowns by reconnecting), so a gid-cycling attacker could
	// grow the map without bound: cap it by evicting the least-recently-active
	// peer — recent reconnectors keep their cooldowns, ancient ghosts age out.
	const LEDGER_CAP = 256;
	return {
		tryUse(peerId, kind, now){
			if(!R[kind]) return { ok: false, waitMs: 0, reason: 'unknown' };
			const t = Number.isFinite(now) ? now : Date.now();
			let mine = used.get(peerId);
			if(!mine){
				if(used.size >= LEDGER_CAP){
					let oldestId = null, oldestAt = Infinity;
					for(const [id, kinds] of used){
						let latest = 0;
						for(const k in kinds){ if(kinds[k] > latest) latest = kinds[k]; }
						if(latest < oldestAt){ oldestAt = latest; oldestId = id; }
					}
					if(oldestId != null) used.delete(oldestId);
				}
				mine = {}; used.set(peerId, mine);
			}
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
// Signaling packets are tiny. Cap the decoder's in-progress wire buffer before
// concatenation so a hostile/public broker cannot make a declared giant MQTT
// packet consume memory before openSignal can inspect its payload.
export const MQTT_PACKET_MAX = 65536;
// Streaming decoder: feed arbitrary byte slices, get complete packets out.
export function createMqttDecoder(opts){
	opts = opts || {};
	const maxPacketBytes = Number.isFinite(opts.maxPacketBytes)
		? Math.max(16, Math.floor(opts.maxPacketBytes))
		: MQTT_PACKET_MAX;
	let buf = new Uint8Array(0);
	return {
		push(bytes){
			let incoming = null;
			try{
				if(bytes instanceof Uint8Array) incoming = bytes;
				else if(bytes instanceof ArrayBuffer) incoming = new Uint8Array(bytes);
				else incoming = Uint8Array.from(bytes || []);
			}catch(e){ buf = new Uint8Array(0); return []; }
			if(incoming.length > maxPacketBytes || buf.length > maxPacketBytes - incoming.length){
				buf = new Uint8Array(0);
				return [];
			}
			buf = buf.length ? concatBytes([buf, incoming]) : incoming;
			const packets = [];
			for(;;){
				if(buf.length < 2) break;
				let len = 0, mult = 1, pos = 1, ok = false, bad = false;
				for(; pos < buf.length && pos <= 4; pos++){
					const b = buf[pos];
					len += (b & 0x7f) * mult; mult *= 128;
					if(!(b & 0x80)){ ok = true; pos++; break; }
					if(pos === 4) bad = true; // MQTT caps the length field at 4 bytes — a 4th continuation bit is garbage
				}
				// a malformed stream must not wedge the decoder forever (it would sit
				// buffering bytes it can never frame, silently killing signaling until
				// the pong watchdog notices) — drop the buffer and let the next packet
				// re-frame from a clean slate
				if(bad || (ok && (len > maxPacketBytes || pos + len > maxPacketBytes))){ buf = new Uint8Array(0); break; }
				if(!ok || buf.length < pos + len) break;
				const type = buf[0] >> 4;
				const body = buf.subarray(pos, pos + len);
				if(type === 3){ // PUBLISH (QoS0 assumed — we never subscribe above QoS0)
					// A public broker can send arbitrary PUBLISH bodies. Validate the
					// two-byte topic header before slicing or decoding it.
					if(body.length >= 3){
						const tlen = (body[0] << 8) | body[1];
						if(tlen > 0 && tlen <= body.length - 2){
							const topic = new TextDecoder().decode(body.subarray(2, 2 + tlen));
							const payload = new TextDecoder().decode(body.subarray(2 + tlen));
							packets.push({ type: 'publish', topic, payload });
						}
					}
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

// ============================ SECURITY PRIMITIVES (pure) ============================
// Everything here is host-authoritative anti-abuse plumbing, testable under Node
// (Web Crypto is available there): resume tokens against gid takeover, invite-
// secret signaling signatures + replay guard, wire size caps, a swept-collision
// resolver so the host can reject wall-tunneling, and a bounded DataChannel queue.

function randBytesHex(n){
	const a = new Uint8Array(Math.max(1, n | 0));
	// Tokens and invite capabilities are authority, not decoration. A weak fallback
	// would silently turn the gid/invite proof into Math.random output on exactly the
	// old/embedded browser where we know least about the PRNG. Fail closed instead.
	if(typeof crypto === 'undefined' || !crypto.getRandomValues) throw new Error('secure-random-unavailable');
	crypto.getRandomValues(a);
	let s = '';
	for(let i = 0; i < a.length; i++) s += a[i].toString(16).padStart(2, '0');
	return s;
}
// UTF-8 byte length — the wire is bytes, not code units, so a hostile sender can't
// smuggle a multi-megabyte payload past a String.length check with multi-byte chars.
const utf8Encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
export function utf8Len(str){
	const s = String(str == null ? '' : str);
	if(utf8Encoder) return utf8Encoder.encode(s).length;
	let n = 0; // manual fallback (no TextEncoder — never on the real wire)
	for(let i = 0; i < s.length; i++){ const c = s.codePointAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; if(c > 0xffff) i++; }
	return n;
}

// --- resume tokens: the ONLY proof of gid ownership -------------------------------
// A gid is public (it rides presence, pb rows, duel packets), so trusting `hello.gid`
// alone lets anyone who has seen a victim's gid claim the seat, evict the owner, and
// inherit its embodied rung/body/pouch via modeMemory. The host mints a 128-bit token
// per (room, gid, host session) on the FIRST claim and hands it back privately; a
// later claim of that gid must present the matching token or be refused BEFORE the
// current owner is touched.
export const RESUME_TOKEN_BYTES = 16; // 128-bit
export const RESUME_TOKEN_KEY = 'mm_ghost_rtok_v1';
export function mintResumeToken(){ return randBytesHex(RESUME_TOKEN_BYTES); }
export function validResumeTokenShape(t){ return typeof t === 'string' && /^[0-9a-f]{32}$/.test(t); }
// length-independent compare over the fixed shape (no early-out on first mismatch)
export function resumeTokenMatch(a, b){
	if(!validResumeTokenShape(a) || !validResumeTokenShape(b) || a.length !== b.length) return false;
	let diff = 0;
	for(let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

// --- wire size caps: a hostile peer must not be able to make us allocate freely ------
export const WIRE_LIMITS = {
	JSON_MAX: 262144,      // 256 KB per non-chunk control message
	SDP_MAX: 16384,        // one offer/answer
	ICE_MAX: 2048,         // one candidate
	// AES-GCM ciphertext is base64url on MQTT (~4/3 expansion). This still leaves
	// 8 KB between a largest valid signal and the independent MQTT publish ceiling.
	SIG_MAX: 24576,        // whole sealed signaling envelope
	SIG_CIPHERTEXT_MAX: 23040,
	MQTT_PAYLOAD_MAX: 32768,
	ASSEMBLED_MAX: 50331648 // 48 MB assembled snapshot ceiling (bytes, not code units)
};
export function withinWireLimit(str, limit){ return utf8Len(str) <= (Number(limit) || 0); }
// A signaling envelope carries an SDP or an ICE candidate; reject the oversized ones
// before they reach setRemoteDescription/addIceCandidate.
export function validSignalSize(m){
	if(!m || typeof m !== 'object') return false;
	try{
		if(m.sdp != null && !withinWireLimit(typeof m.sdp === 'string' ? m.sdp : JSON.stringify(m.sdp), WIRE_LIMITS.SDP_MAX)) return false;
		if(m.c != null && !withinWireLimit(typeof m.c === 'string' ? m.c : JSON.stringify(m.c), WIRE_LIMITS.ICE_MAX)) return false;
	}catch(e){ return false; }
	return true;
}

// --- invite-secret signaling: authenticate and conceal the broker handshake ---------
// The invite carries a Web-Crypto secret (at least 128 bits). V2 derives separate
// HMAC/AES-GCM keys: selectors remain routable, while SDP/ICE/fingerprints are opaque.
// Replay protection records only an envelope whose outer HMAC already verified.
export const SIGNAL_ENVELOPE_VERSION = 2;
export const INVITE_SECRET_BYTES = 16;
export const SIG_REPLAY_WINDOW_MS = 60000;
export function mintInviteSecret(){ return randBytesHex(INVITE_SECRET_BYTES); }
export function validInviteSecret(s){ return typeof s === 'string' && /^(?:[0-9a-f]{32}|[0-9a-f]{64})$/.test(s); }
function hexToBytes(hex){
	const h = String(hex);
	const out = new Uint8Array(h.length >> 1);
	for(let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
	return out;
}
function signalCryptoReady(){
	return typeof crypto !== 'undefined' && !!crypto.subtle
		&& typeof TextEncoder !== 'undefined' && typeof TextDecoder !== 'undefined'
		&& typeof btoa === 'function' && typeof atob === 'function';
}
function bytesToBase64Url(bytes){
	let binary = '';
	for(let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function validCiphertextString(s){
	return typeof s === 'string' && s.length >= 22 && s.length <= WIRE_LIMITS.SIG_CIPHERTEXT_MAX
		&& (s.length & 3) !== 1 && /^[A-Za-z0-9_-]+$/.test(s);
}
function base64UrlToBytes(s){
	if(!validCiphertextString(s)) throw new Error('ciphertext-shape');
	const raw = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length & 3)) & 3));
	const out = new Uint8Array(raw.length);
	for(let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	if(bytesToBase64Url(out) !== s) throw new Error('ciphertext-canonical');
	return out;
}
const SIGNAL_KDF_SALT = 'mmg2/signal/v2/hkdf-sha256';
const SIGNAL_AAD_DOMAIN = 'mmg2/signal/v2/aes-gcm';
async function deriveSignalKey(secretHex, room, role, purpose){
	if(!signalCryptoReady() || !validInviteSecret(secretHex)) throw new Error('signal-crypto-unavailable');
	const enc = new TextEncoder();
	const base = await crypto.subtle.importKey('raw', hexToBytes(secretHex), 'HKDF', false, ['deriveKey']);
	const params = {
		name: 'HKDF', hash: 'SHA-256', salt: enc.encode(SIGNAL_KDF_SALT),
		info: enc.encode(JSON.stringify([SIGNAL_ENVELOPE_VERSION, String(room), String(role), String(purpose)]))
	};
	if(purpose === 'mac'){
		return crypto.subtle.deriveKey(params, base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
	}
	if(purpose === 'aead'){
		return crypto.subtle.deriveKey(params, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
	}
	throw new Error('signal-key-purpose');
}
async function hmacHex(key, msg){
	const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(msg)));
	const b = new Uint8Array(sig);
	let s = '';
	for(let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
	return s;
}
// Canonical string the signature covers: order and separators are fixed so both ends
// hash exactly the same bytes. The content is the v2 selectors plus ciphertext.
function sigCanon(room, role, nonce, ts, contentStr){
	// Keep the full millisecond timestamp. A 32-bit coercion made ts and ts+2^32
	// authenticate as the same message.
	return [SIGNAL_ENVELOPE_VERSION, String(room), String(role), String(nonce), String(ts), String(contentStr == null ? '' : contentStr)].join('');
}
// The SDP text carried by an offer/answer — accepts a raw string or an
// RTCSessionDescription-shaped {type, sdp}. This IS the security-relevant payload
// (it embeds the DTLS fingerprint), so it is what the signature covers.
function sdpString(x){ return typeof x === 'string' ? x : (x && typeof x.sdp === 'string' ? x.sdp : ''); }
// The DTLS fingerprint line from an SDP — the cryptographic identity of the peer's
// media session. A verified (signed) SDP therefore pins exactly who you connect to.
export function sdpFingerprint(x){
	const m = /a=fingerprint:\S+\s+([0-9A-Fa-f:]+)/.exec(sdpString(x));
	return m ? m[1].toUpperCase() : '';
}
function stableSignalJson(value){
	if(value && typeof value.toJSON === 'function') value = value.toJSON();
	if(value === null) return 'null';
	if(Array.isArray(value)) return '[' + value.map(stableSignalJson).join(',') + ']';
	if(typeof value === 'object'){
		const keys = Object.keys(value).filter(k => value[k] !== undefined).sort();
		return '{' + keys.map(k => JSON.stringify(k) + ':' + stableSignalJson(value[k])).join(',') + '}';
	}
	const out = JSON.stringify(value);
	return out === undefined ? 'null' : out;
}
// The MAC covers every field that selects a signaling state transition. `k`, SDP
// type, destination and negotiation id used to be mutable/absent from the MAC,
// allowing a captured envelope to be redirected or reinterpreted.
function sigContentOf(obj){
	return stableSignalJson({
		v: obj && obj.v, k: obj && obj.k, to: obj && obj.to,
		sid: obj && obj.sid, ct: obj && obj.ct
	});
}
function plainSignalPayload(obj){
	const out = { k: obj && obj.k, to: obj && obj.to, sid: obj && obj.sid };
	if(obj && obj.sdp != null) out.sdp = { type: obj.sdp && obj.sdp.type, sdp: sdpString(obj.sdp) };
	else if(obj && obj.c != null){
		const c = (obj.c && typeof obj.c.toJSON === 'function') ? obj.c.toJSON() : obj.c;
		out.c = JSON.parse(JSON.stringify(c));
	}
	return out;
}
function validSignalRouting(env){
	if(!env || typeof env !== 'object' || Array.isArray(env)) return false;
	if(env.role !== 'h' && !(typeof env.role === 'string' && /^g[a-zA-Z0-9._-]{1,44}$/.test(env.role))) return false;
	if(typeof env.to !== 'string' || (env.to !== 'h' && !/^g[a-zA-Z0-9._-]{1,44}$/.test(env.to))) return false;
	if(typeof env.sid !== 'string' || !/^[0-9a-f]{24}$/.test(env.sid)) return false;
	if(typeof env.nonce !== 'string' || !/^[0-9a-f]{24}$/.test(env.nonce)) return false;
	if(!Number.isSafeInteger(env.ts) || env.ts < 0) return false;
	return env.k === 'hi' || env.k === 'offer' || env.k === 'answer' || env.k === 'ice';
}
const SIGNAL_ENVELOPE_FIELDS = new Set(['v', 'k', 'to', 'sid', 'ct', 'role', 'nonce', 'ts', 'sig', 'from']);
function validSignalEnvelope(env){
	if(!validSignalRouting(env) || env.v !== SIGNAL_ENVELOPE_VERSION) return false;
	if(typeof env.sig !== 'string' || !/^[0-9a-f]{64}$/.test(env.sig)) return false;
	for(const key of Object.keys(env)){ if(!SIGNAL_ENVELOPE_FIELDS.has(key)) return false; }
	if(env.from != null && env.from !== env.role) return false;
	if(env.k === 'hi') return env.ct === '';
	return validCiphertextString(env.ct);
}
function validSignalFingerprint(fp){
	return typeof fp === 'string' && fp.length <= 256 && /^[0-9A-F]{2}(?::[0-9A-F]{2})+$/i.test(fp);
}
function validOpenedSignal(env){
	if(!validSignalRouting(env) || env.v !== SIGNAL_ENVELOPE_VERSION || typeof env.fp !== 'string') return false;
	if(!validSignalSize(env)) return false;
	if(env.k === 'hi') return env.sdp == null && env.c == null && env.fp === '';
	if(env.k === 'offer' || env.k === 'answer'){
		if(!env.sdp || typeof env.sdp !== 'object' || env.sdp.type !== env.k || typeof env.sdp.sdp !== 'string' || !env.sdp.sdp) return false;
		if(env.c != null) return false;
		const fp = sdpFingerprint(env.sdp);
		return validSignalFingerprint(fp) && env.fp === fp;
	}
	if(env.k === 'ice'){
		if(env.sdp != null || !env.c || typeof env.c !== 'object' || Array.isArray(env.c)) return false;
		return validSignalFingerprint(env.fp);
	}
	return false;
}
function signalAad(room, env){
	return stableSignalJson([
		SIGNAL_AAD_DOMAIN, SIGNAL_ENVELOPE_VERSION, String(room), env.role,
		env.to, env.sid, env.k, env.nonce, env.ts
	]);
}
async function encryptSignalBody(key, nonce, aad, body){
	const enc = new TextEncoder();
	const sealed = await crypto.subtle.encrypt({
		name: 'AES-GCM', iv: hexToBytes(nonce), additionalData: enc.encode(aad), tagLength: 128
	}, key, enc.encode(stableSignalJson(body)));
	const ct = bytesToBase64Url(new Uint8Array(sealed));
	if(!validCiphertextString(ct)) throw new Error('ciphertext-size');
	return ct;
}
async function decryptSignalBody(key, nonce, aad, ct){
	const plain = await crypto.subtle.decrypt({
		name: 'AES-GCM', iv: hexToBytes(nonce), additionalData: new TextEncoder().encode(aad), tagLength: 128
	}, key, base64UrlToBytes(ct));
	const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
	if(!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('plaintext-shape');
	return body;
}
async function signalMacWithKey(key, room, role, nonce, ts, contentStr){
	return hmacHex(key, sigCanon(room, role, nonce, ts, contentStr));
}
export async function signSignal(secret, room, role, nonce, ts, contentStr){
	const key = await deriveSignalKey(secret, room, role, 'mac');
	return signalMacWithKey(key, room, role, nonce, ts, contentStr);
}
// Verify signature + freshness + routing binding. `guard` (createReplayGuard)
// rejects a nonce already seen inside the window — so a captured envelope can't be
// replayed. Returns {ok, reason}.
export async function verifySignal(secret, env, expect){
	expect = expect || {};
	if(!validInviteSecret(secret)) return { ok: false, reason: 'secret' };
	if(!validSignalEnvelope(env)) return { ok: false, reason: 'shape' };
	if(!validSignalSize(env)) return { ok: false, reason: 'size' };
	const now = Number.isFinite(expect.now) ? expect.now : Date.now();
	if(Math.abs(now - env.ts) > (expect.window || SIG_REPLAY_WINDOW_MS)) return { ok: false, reason: 'stale' };
	if(expect.role && env.role !== expect.role) return { ok: false, reason: 'role' };
	if(expect.to && env.to !== expect.to) return { ok: false, reason: 'destination' };
	if(expect.sid && env.sid !== expect.sid) return { ok: false, reason: 'session' };
	// AUTHENTICATE before touching the replay guard: the nonce store is bounded, so if a
	// forged message could consume a slot, a room-code-knowing attacker could saturate it
	// and starve legit guests. Only a valid (secret-signed) message may record its nonce.
	const content = sigContentOf(env);
	let mac = '';
	try{
		const key = expect.macKey || await deriveSignalKey(secret, expect.room, env.role, 'mac');
		mac = await signalMacWithKey(key, expect.room, env.role, env.nonce, env.ts, content);
	}
	catch(e){ return { ok: false, reason: 'crypto' }; }
	let diff = mac.length === env.sig.length ? 0 : 1;
	for(let i = 0; i < mac.length && i < env.sig.length; i++) diff |= mac.charCodeAt(i) ^ env.sig.charCodeAt(i);
	if(diff !== 0) return { ok: false, reason: 'sig' };
	// authenticated — now (and only now) enforce single-use of the nonce
	if(expect.guard && !expect.guard.accept(env.nonce, now)) return { ok: false, reason: 'replay' };
	return { ok: true };
}
// Bounded nonce memory with TTL — a replay of an accepted nonce inside the window is
// refused; old nonces age out so the set can't grow without bound.
export function createReplayGuard(windowMs){
	const win = Number(windowMs) || SIG_REPLAY_WINDOW_MS;
	const seen = new Map(); // nonce -> ts
	const MAX = 4096;
	return {
		accept(nonce, now){
			const t = Number.isFinite(now) ? now : Date.now();
			for(const [k, ts] of seen){ if(t - ts > win) seen.delete(k); }
			if(typeof nonce !== 'string' || !nonce) return false;
			if(seen.has(nonce)) return false;
			if(seen.size >= MAX) return false; // saturated: fail closed rather than evict-and-admit
			seen.set(nonce, t);
			return true;
		},
		size(){ return seen.size; }
	};
}

// --- the sealed signaling channel: the whole trust decision, transport-agnostic ------
// `seal` encrypts the sensitive body and HMACs the outer v2 envelope. `open` checks
// shape, freshness, routing, HMAC and replay before it decrypts and validates the RTC
// description. A peer without the invite secret cannot reach RTC allocation; a public
// broker can observe only routing metadata, sizes and timing.
export function createSignedChannel(secret, room, selfRole, opts){
	opts = opts || {};
	const guard = createReplayGuard(opts.window);
	const ready = validInviteSecret(secret) && signalCryptoReady();
	const keyCache = new Map();
	function rememberKey(cacheId, key){
		if(keyCache.has(cacheId)) return;
		if(keyCache.size >= 64) keyCache.delete(keyCache.keys().next().value);
		keyCache.set(cacheId, Promise.resolve(key));
	}
	function keyFor(role, purpose, cacheMiss){
		const cacheId = purpose + '\u0001' + role;
		let key = keyCache.get(cacheId);
		if(!key){
			key = deriveSignalKey(secret, room, role, purpose);
			// An unverified public-broker role must not evict a legitimate cached key.
			// Seal-side and post-MAC AEAD keys are trusted cache admissions.
			if(cacheMiss !== false) rememberKey(cacheId, key);
		}
		return key;
	}
	return {
		role: selfRole,
		ready,
		// fpOverride binds a non-SDP envelope (an ICE trickle) to the sender's OWN
		// media fingerprint, so ICE can't be injected across a different peer session.
		async seal(obj, fpOverride){
			if(!ready) throw new Error('signal-channel-unavailable');
			const payload = plainSignalPayload(obj || {});
			const nonce = randBytesHex(12);
			const ts = Date.now();
			const fp = payload.sdp != null ? sdpFingerprint(payload.sdp) : (fpOverride || '');
			const opened = Object.assign({}, payload, {
				v: SIGNAL_ENVELOPE_VERSION, role: selfRole, nonce, ts, fp
			});
			if(!validOpenedSignal(opened)) throw new Error('signal-shape');
			const [macKey, aeadKey] = await Promise.all([keyFor(selfRole, 'mac'), keyFor(selfRole, 'aead')]);
			const env = {
				v: SIGNAL_ENVELOPE_VERSION, k: payload.k, to: payload.to, sid: payload.sid,
				ct: '', role: selfRole, nonce, ts
			};
			if(payload.k !== 'hi'){
				const body = payload.sdp != null ? { fp, sdp: payload.sdp } : { fp, c: payload.c };
				env.ct = await encryptSignalBody(aeadKey, nonce, signalAad(room, env), body);
			}
			env.sig = await signalMacWithKey(macKey, room, selfRole, nonce, ts, sigContentOf(env));
			if(!validSignalEnvelope(env) || !withinWireLimit(JSON.stringify(env), WIRE_LIMITS.SIG_MAX)) throw new Error('signal-envelope-size');
			return env;
		},
		// expectRole: the identity the sender MUST have signed as (e.g. a guest expects
		// 'h'; the host expects the guest's own inbox id). fpPin (optional): a fingerprint
		// learned from an earlier verified message this one must still match.
		async open(env, expectRole, fpPin, sid){
			if(!ready) return { ok: false, reason: 'secret' };
			if(!validSignalEnvelope(env)) return { ok: false, reason: 'shape' };
			if(env.role !== expectRole) return { ok: false, reason: 'role' };
			if(env.to !== selfRole) return { ok: false, reason: 'destination' };
			if(sid && env.sid !== sid) return { ok: false, reason: 'session' };
			let macKey = null;
			try{ macKey = await keyFor(expectRole, 'mac', false); }
			catch(e){ return { ok: false, reason: 'crypto' }; }
			const v = await verifySignal(secret, env, {
				room, role: expectRole, to: selfRole, sid: sid || null, guard, macKey
			});
			if(!v.ok) return v;
			rememberKey('mac' + '\u0001' + expectRole, macKey);
			let body = {};
			if(env.k !== 'hi'){
				try{
					const aeadKey = await keyFor(expectRole, 'aead');
					body = await decryptSignalBody(aeadKey, env.nonce, signalAad(room, env), env.ct);
				}
				catch(e){ return { ok: false, reason: 'decrypt' }; }
			}
			const message = {
				v: SIGNAL_ENVELOPE_VERSION, k: env.k, to: env.to, sid: env.sid,
				role: env.role, nonce: env.nonce, ts: env.ts, fp: env.k === 'hi' ? '' : body.fp
			};
			if(env.from != null) message.from = env.from;
			if(env.k === 'offer' || env.k === 'answer') message.sdp = body.sdp;
			else if(env.k === 'ice') message.c = body.c;
			if(!validOpenedSignal(message)) return { ok: false, reason: 'shape' };
			if(fpPin && message.fp !== fpPin) return { ok: false, reason: 'fingerprint' };
			return { ok: true, message };
		}
	};
}

// --- host-side movement enforcement: swept AABB against real tiles -------------------
// The host only clamped a per-axis STEP (max speed) — it never checked collision, so a
// guest could walk its body through walls and bedrock and then act/aim/ping from inside
// solid rock. This resolves a claimed move the way the local mover does: clamp the step
// to the speed envelope, then advance axis-by-axis, stopping at the first solid tile so
// the body never enters one. `solidAt(tx,ty)` is the HOST's tile reader; `bounds`
// clamps to the world. Pure: no globals, fully testable with a synthetic grid.
export function clampStep(cur, claimed, maxStep){
	if(!Number.isFinite(claimed)) return cur;
	if(!Number.isFinite(cur)) return claimed;
	const step = Math.max(0, Number(maxStep) || 0);
	const d = claimed - cur;
	if(d > step) return cur + step;
	if(d < -step) return cur - step;
	return claimed;
}
function aabbHitsSolid(x, y, w, h, solidAt, axis){
	const x0 = Math.floor(x - w / 2), x1 = Math.floor(x + w / 2 - 1e-6);
	const y0 = Math.floor(y - h / 2), y1 = Math.floor(y + h / 2 - 1e-6);
	const probe = { x, y, w, h, axis };
	for(let ty = y0; ty <= y1; ty++) for(let tx = x0; tx <= x1; tx++){ if(solidAt(tx, ty, axis, probe)) return true; }
	return false;
}
export function sweepBodyMove(b, claimedX, claimedY, maxStep, solidAt, bounds){
	const w = (b && Number.isFinite(b.w)) ? b.w : PLAY_RULES.BODY_W;
	const h = (b && Number.isFinite(b.h)) ? b.h : PLAY_RULES.BODY_H;
	let cx = Number.isFinite(b.x) ? b.x : (Number(claimedX) || 0);
	let cy = Number.isFinite(b.y) ? b.y : (Number(claimedY) || 0);
	const stepX = maxStep && typeof maxStep === 'object' ? maxStep.x : maxStep;
	const stepY = maxStep && typeof maxStep === 'object' ? maxStep.y : maxStep;
	let tx = clampStep(cx, Number(claimedX), stepX);
	let ty = clampStep(cy, Number(claimedY), stepY);
	if(bounds){
		if(Number.isFinite(bounds.minX) && Number.isFinite(bounds.maxX) && bounds.minX < bounds.maxX) tx = Math.max(bounds.minX + w / 2, Math.min(bounds.maxX - w / 2, tx));
		if(Number.isFinite(bounds.minY) && Number.isFinite(bounds.maxY) && bounds.minY < bounds.maxY) ty = Math.max(bounds.minY + h / 2, Math.min(bounds.maxY - h / 2, ty));
	}
	const solid = (typeof solidAt === 'function') ? solidAt : () => false;
	// resolve X, then Y, sub-stepping so a fast claim can't tunnel past a 1-tile wall
	const stepInto = (fromX, fromY, toX, toY, moveAxis) => {
		const dist = Math.abs((moveAxis === 'x' ? toX - fromX : toY - fromY));
		const n = Math.max(1, Math.ceil(dist / 0.25));
		let px = fromX, py = fromY;
		for(let i = 1; i <= n; i++){
			const nx = moveAxis === 'x' ? fromX + (toX - fromX) * (i / n) : px;
			const ny = moveAxis === 'y' ? fromY + (toY - fromY) * (i / n) : py;
			if(aabbHitsSolid(nx, ny, w, h, solid, moveAxis)) break;
			px = nx; py = ny;
		}
		return moveAxis === 'x' ? px : py;
	};
	const nx = stepInto(cx, cy, tx, cy, 'x');
	const ny = stepInto(nx, cy, nx, ty, 'y');
	const blocked = (Math.abs(nx - tx) > 1e-6) || (Math.abs(ny - ty) > 1e-6);
	return { x: nx, y: ny, blocked };
}

// --- bounded DataChannel send queue: never let dc.send outrun the socket -------------
// dc.send ignoring bufferedAmount lets a slow/hostile receiver make us buffer without
// bound (memory DoS) or block. This queues when the socket is congested (>hi water),
// drains under lo water, and fail-closes (drops the peer) if the backlog itself blows
// its ceiling — the caller closes the channel on a closed() queue.
export const DC_QUEUE = {
	HI: 262144, LO: 65536, MAX: 4096,
	// A maximum-size snapshot may legitimately queue while SCTP backpressure is
	// active. Bound bytes as well as entries, with a small control-message margin.
	MAX_BYTES: WIRE_LIMITS.ASSEMBLED_MAX + 4194304,
	// All RTC peers in this module share one additional ceiling. It admits one full
	// per-peer queue plus 4 MB for control traffic, but not one such queue per peer.
	GLOBAL_MAX_BYTES: WIRE_LIMITS.ASSEMBLED_MAX + 8388608
};
export function createByteBudget(maxBytes){
	const max = Number.isFinite(maxBytes) ? Math.max(1, Math.floor(maxBytes)) : 1;
	let used = 0;
	return {
		acquire(bytes){
			const n = Number(bytes);
			if(!Number.isSafeInteger(n) || n < 0 || used > max - n) return null;
			used += n;
			let held = true;
			return {
				release(){
					if(!held) return;
					held = false;
					used = Math.max(0, used - n);
				}
			};
		},
		usedBytes(){ return used; },
		maxBytes(){ return max; }
	};
}
export function createSendQueue(opts){
	opts = opts || {};
	const hi = Number.isFinite(opts.hi) ? opts.hi : DC_QUEUE.HI;
	const lo = Number.isFinite(opts.lo) ? opts.lo : DC_QUEUE.LO;
	const max = Number.isFinite(opts.max) ? opts.max : DC_QUEUE.MAX;
	const maxBytes = Number.isFinite(opts.maxBytes) ? Math.max(1, Math.floor(opts.maxBytes)) : DC_QUEUE.MAX_BYTES;
	const acquireBytes = typeof opts.acquireBytes === 'function' ? opts.acquireBytes : null;
	const q = [];
	let head = 0, queuedBytes = 0, closed = false, gated = false;
	const activeSize = () => q.length-head;
	function releaseEntry(entry){
		if(!entry || !entry.lease) return;
		try{ entry.lease.release(); }catch(e){ /* accounting hooks must not block teardown */ }
		entry.lease = null;
	}
	function failClosed(extraLease){
		if(extraLease){ try{ extraLease.release(); }catch(e){ /* best effort */ } }
		for(let i=head;i<q.length;i++) releaseEntry(q[i]);
		q.length = 0;
		head = 0;
		queuedBytes = 0;
		closed = true;
		gated = false;
		return false;
	}
	return {
		push(item, measuredBytes){
			if(closed) return false;
			const bytes=Number(measuredBytes);
			if(!Number.isSafeInteger(bytes) || bytes<0) return failClosed();
			if(activeSize() >= max || bytes > maxBytes || queuedBytes > maxBytes - bytes) return failClosed();
			let lease = null;
			if(acquireBytes){
				try{ lease = acquireBytes(bytes); }catch(e){ return failClosed(); }
				if(!lease || typeof lease.release !== 'function') return failClosed();
			}
			try{ q.push({ item, bytes, lease }); }
			catch(e){ return failClosed(lease); }
			queuedBytes += bytes;
			return true;
		},
		// drive with a channel exposing {bufferedAmount, send(x)}; returns false once
		// the queue has fail-closed so the transport can tear the peer down
		flush(channel){
			if(closed) return false;
			const buffered = () => Number(channel && channel.bufferedAmount) || 0;
			if(gated && buffered() > lo) return true;         // still draining: hold
			gated = false;
			while(head<q.length){
				if(buffered() > hi){ gated = true; break; }    // congested: re-gate
				const next = q[head];
				try{ channel.send(next.item); }catch(e){ return failClosed(); }
				q[head++]=null;
				queuedBytes = Math.max(0, queuedBytes - next.bytes);
				releaseEntry(next);
			}
			if(head===q.length){ q.length=0; head=0; }
			else if(head>=1024 && head*2>=q.length){ q.splice(0,head); head=0; }
			return true;
		},
		dispose(){ failClosed(); },
		size(){ return activeSize(); },
		sizeBytes(){ return queuedBytes; },
		closed(){ return closed; }
	};
}

// --- RTC negotiation limits -----------------------------------------------------------
export const RTC_LIMITS = {
	PENDING_MAX: 8,     // half-open peer connections awaiting a datachannel
	GLOBAL_PENDING_MAX: 8, // module-wide half-open ceiling across every room/listener
	PEERS_MAX: 16,      // hard ceiling including connected channels awaiting app hello
	ICE_PENDING_MAX: 64,
	SIGNAL_WINDOW_MS: 2000,
	SIGNAL_MAX: 96,
	SIGNAL_PEER_MAX: 24,
	SIGNAL_VERIFY_MAX: 32, // module-wide concurrent pre-auth HMAC ceiling
	SIGNAL_VERIFY_RATE_MAX: 96, // module-wide HMAC starts per shared rate window
	SIGNAL_VERIFY_RATE_WINDOW_MS: 2000,
	GUEST_JSON_MAX: 16384, // guest control packets are tiny; snapshots only flow host -> guest
	NEGOTIATE_MS: 15000, // an offer that never becomes a connected channel is dropped
	HELLO_MS: 20000     // a connected channel that never sends a valid hello is dropped
};

// A page can transiently own more than one listener (room switch/restart/tests). Per-
// createRtcHost limits multiply in that case, so keep scarce work behind one ES-module
// singleton. Leases are idempotent, letting every close/error path converge safely.
const rtcGlobalAdmission = { pending: 0, verifying: 0 };
export function createRateBudget(maxEvents, windowMs){
	const max = Math.max(1, Math.floor(Number(maxEvents) || 1));
	const window = Math.max(1, Math.floor(Number(windowMs) || 1));
	let windowAt = null, used = 0;
	return {
		tryTake(now){
			const t = Number.isFinite(now) ? now : Date.now();
			if(windowAt == null || t < windowAt || t - windowAt >= window){ windowAt = t; used = 0; }
			if(used >= max) return false;
			used++;
			return true;
		},
		used(){ return used; }
	};
}
const rtcSignalVerifyRate = createRateBudget(RTC_LIMITS.SIGNAL_VERIFY_RATE_MAX, RTC_LIMITS.SIGNAL_VERIFY_RATE_WINDOW_MS);
function acquireRtcAdmission(key, max){
	if(rtcGlobalAdmission[key] >= max) return null;
	rtcGlobalAdmission[key]++;
	let held = true;
	return {
		release(){
			if(!held) return;
			held = false;
			rtcGlobalAdmission[key] = Math.max(0, rtcGlobalAdmission[key] - 1);
		}
	};
}
function acquireRtcPending(){ return acquireRtcAdmission('pending', RTC_LIMITS.GLOBAL_PENDING_MAX); }
function acquireSignalVerify(){
	const lease = acquireRtcAdmission('verifying', RTC_LIMITS.SIGNAL_VERIFY_MAX);
	if(!lease) return null;
	if(!rtcSignalVerifyRate.tryTake(Date.now())){ lease.release(); return null; }
	return lease;
}
// Runs before Web Crypto even when a test/custom transport bypasses openSignal. This
// is bounded shape/routing work only; the HMAC remains the authority decision.
function signalPreflight(m, from, to){
	return !!m && m.from === from && m.role === from && m.to === to
		&& validSignalEnvelope(m) && validSignalSize(m);
}

// ============================ TRANSPORTS (browser) ============================

// Public WSS brokers for the WebRTC handshake only (~2 KB per join); gameplay
// bytes never touch them. Order = preference; failover walks the list.
export const MQTT_BROKERS = [
	'wss://broker.emqx.io:8084/mqtt',
	'wss://broker.hivemq.com:8884/mqtt',
	'wss://test.mosquitto.org:8081'
];
// STUN finds the direct path; the TURN relay is the LAST-RESORT carrier for
// restrictive NATs (mobile hotspots, corporate networks) where hole-punching
// fails outright — without it those guests simply cannot join. Public
// openrelay tier: fine for a hobby P2P game, swap for own creds if it ever
// rate-limits. WebRTC ICE is not CSP-gated, so no index.html change needed.
const RTC_CONFIG = { iceServers: [
	{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
	{ urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443?transport=tcp'],
		username: 'openrelayproject', credential: 'openrelayproject' }
] };
// v2 is deliberately isolated from plaintext v1 topics. Mixed cached clients time
// out instead of negotiating a downgrade that republishes SDP/ICE in clear text.
const SIG_NS = 'mmg2/';

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
				if(connected) return; // MQTT sends exactly one CONNACK; a duplicate from a hostile/buggy broker must not spawn a second ping watchdog or re-run onReady (double brokerIdx-- underflows failover)
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
		publish(topic, str){ if(!withinWireLimit(str, WIRE_LIMITS.MQTT_PAYLOAD_MAX)) return; try{ ws.send(mqttEncodePublish(topic, str)); }catch(e){ /* not open */ } },
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
				// bytes on the public broker are hostile until proven otherwise: cap the
				// envelope before JSON.parse, and reject an oversized SDP/ICE after
				if(!withinWireLimit(payload, WIRE_LIMITS.SIG_MAX)) return;
				let m = null; try{ m = JSON.parse(payload); }catch(e){ return; }
				if(!m || typeof m.k !== 'string' || typeof m.from !== 'string') return;
				// Sender/role agreement and exact envelope shape discard broker garbage
				// before it can consume the shared HMAC budget.
				if(!signalPreflight(m, m.from, who)) return;
				handlers.onMsg(m);
			},
			onDown(){ if(!closed) setTimeout(connect, 1500); }
		});
	}
	connect();
	return {
		sendTo(whoElse, obj){
			if(!obj || obj.to !== whoElse) return;
			if(client && client.connected) client.publish(SIG_NS + room + '/' + whoElse, JSON.stringify(Object.assign({ from: who }, obj)));
		},
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
// Every rtc peer sends through a bounded queue: dc.send never outruns the socket
// (bufferedAmount high/low water), and a backlog that blows its ceiling fail-closes
// the channel instead of buffering without bound.
const rtcQueueByteBudget = createByteBudget(DC_QUEUE.GLOBAL_MAX_BYTES);
function rtcPeerWrap(id, dc){
	const q = createSendQueue({ acquireBytes: bytes => rtcQueueByteBudget.acquire(bytes) });
	let disposed = false;
	function dispose(){
		if(disposed) return;
		disposed = true;
		q.dispose();
	}
	function closePeer(){
		dispose();
		try{ dc.close(); }catch(e){ /* fine */ }
	}
	try{ dc.bufferedAmountLowThreshold = DC_QUEUE.LO; }catch(e){ /* older impls */ }
	try{ dc.onbufferedamountlow = () => { if(!q.flush(dc)) closePeer(); }; }catch(e){ /* fine */ }
	try{ dc.addEventListener('close', dispose, { once: true }); }catch(e){ /* older/test impls */ }
	return {
		id, transport: 'rtc', onMessage: null,
		send(pl){
			if(disposed) return;
			let str = null, bytes = 0;
			try{ str = JSON.stringify(pl); }catch(e){ return; }
			try{ bytes = utf8Len(str); }catch(e){ return; }
			if(bytes>WIRE_LIMITS.JSON_MAX) return; // never emit an oversized frame
			if(!q.push(str,bytes) || !q.flush(dc)) closePeer();
		},
		close(){ closePeer(); }
	};
}
export function createRtcHost(room, handlers, secret){
	const deps = arguments[3] || {};
	const openSig = deps.openSignal || openSignal;
	const makePc = deps.makePeerConnection || (() => new RTCPeerConnection(RTC_CONFIG));
	const sc = createSignedChannel(secret, room, 'h');
	if(!sc.ready) return { stop(){ /* no secret ⇒ no authenticated remote signaling */ } };
	const pcs = new Map(); // ghostId -> negotiation/channel state
	let stopped = false;
	let signalRateAt = 0, signalRateN = 0;
	const senderRates = new Map();
	function signalAllowed(gid){
		const t = Date.now();
		if(t - signalRateAt > RTC_LIMITS.SIGNAL_WINDOW_MS){ signalRateAt = t; signalRateN = 0; }
		if(++signalRateN > RTC_LIMITS.SIGNAL_MAX) return false;
		let r = senderRates.get(gid);
		if(!r || t - r.at > RTC_LIMITS.SIGNAL_WINDOW_MS) r = { at: t, n: 0 };
		if(++r.n > RTC_LIMITS.SIGNAL_PEER_MAX){ senderRates.set(gid, r); return false; }
		senderRates.set(gid, r);
		if(senderRates.size > RTC_LIMITS.SIGNAL_MAX){
			for(const [k, v] of senderRates){ if(t - v.at > RTC_LIMITS.SIGNAL_WINDOW_MS) senderRates.delete(k); }
		}
		return true;
	}
	// fail-closed teardown: a half-open peer that never finishes negotiating, or a
	// connected channel that never speaks a valid hello, is dropped with its timers
	function drop(gid, expected){
		const e = pcs.get(gid);
		// A stale callback may only drop the negotiation that created it, never a
		// replacement which now happens to use the same gid.
		if(!e || (expected && e !== expected) || e.dropped) return;
		e.dropped = true;
		pcs.delete(gid);
		if(e.pendingLease){ e.pendingLease.release(); e.pendingLease = null; }
		if(e.negT) clearTimeout(e.negT);
		if(e.helloT) clearTimeout(e.helloT);
		try{ if(e.peer) e.peer.close(); }catch(err){ /* fine */ }
		try{ e.pc.close(); }catch(err){ /* fine */ }
	}
	// every outgoing signaling envelope is encrypted+authenticated before the broker
	const send = (gid, entry, obj, fp) => {
		entry.sendChain = entry.sendChain.then(async () => {
			if(stopped || entry.dropped || pcs.get(gid) !== entry) return;
			const env = await sc.seal(Object.assign({}, obj, { to: gid, sid: entry.sid }), fp);
			if(!stopped && !entry.dropped && pcs.get(gid) === entry) sig.sendTo(gid, env);
		}).catch(() => drop(gid, entry));
		return entry.sendChain;
	};
	async function flushLocalIce(gid, entry){
		if(!entry.offerSent || !entry.myFp) return;
		while(entry.localIce.length && !entry.dropped){
			const c = entry.localIce.shift();
			await send(gid, entry, { k: 'ice', c }, entry.myFp);
		}
	}
	async function flushRemoteIce(entry){
		if(!entry.remoteSet || !entry.peerFp) return;
		const pending = entry.remoteIce.splice(0);
		for(const ice of pending){
			if(entry.dropped) return;
			if(ice.fp !== entry.peerFp) continue;
			try{ await entry.pc.addIceCandidate(ice.c); }catch(e){ /* hostile/obsolete candidate */ }
		}
	}
	const sig = openSig(room, 'h', {
		onReady: handlers.onStatus ? () => handlers.onStatus('signal-ready') : null,
		onFail: handlers.onStatus ? () => handlers.onStatus('signal-fail') : null,
		async onMsg(m){
			if(stopped) return;
			const gid = m.from;
			// only a guest inbox may talk to the host, and it must have SIGNED as itself
			if(typeof gid !== 'string' || !/^g[a-zA-Z0-9._-]{1,44}$/.test(gid)) return;
			if(!signalPreflight(m, gid, 'h')) return;
			if(!signalAllowed(gid)) return;
			const current = pcs.get(gid);
			const fpPin = current && m.k === 'ice' && current.peerFp ? current.peerFp : null;
			const sidPin = current && m.k !== 'hi' ? current.sid : null;
			const verifyLease = acquireSignalVerify();
			if(!verifyLease) return;
			let v = null;
			try{ v = await sc.open(m, gid, fpPin, sidPin); }
			catch(e){ return; }
			finally { verifyLease.release(); }
			if(stopped || !v || !v.ok) return; // unsigned / wrong secret / replay / tampered / stale — ignored.
			m = v.message; // only the decrypted, strictly validated signal reaches RTC state
			// Answer/ICE verification was bound to `current`. If Web Crypto yielded
			// while that entry was replaced, the result belongs to the old generation.
			if(m.k !== 'hi' && (!current || current.dropped || pcs.get(gid) !== current)) return;
			// This is also the RTC DoS gate: an un-invited peer cannot even make us open a
			// PeerConnection, because its `hi` never carries a valid signature.
			if(m.k === 'hi'){
				const pendingEntry = pcs.get(gid);
				if(pendingEntry){
					// A live channel owns this signaling identity until its own close path
					// drops it. While still negotiating, only a strictly newer authenticated
					// generation may displace it: delayed/equal `hi` packets cannot pin the
					// host to an obsolete sid for the full negotiation deadline, and a retry
					// of the same sid never restarts useful work.
					if(pendingEntry.alive || m.sid === pendingEntry.sid || m.ts <= pendingEntry.hiTs) return;
					drop(gid, pendingEntry);
				}
				let pending = 0; for(const e of pcs.values()) if(!e.alive) pending++;
				if(pending >= RTC_LIMITS.PENDING_MAX || pcs.size >= RTC_LIMITS.PEERS_MAX) return;
				const pendingLease = acquireRtcPending();
				if(!pendingLease) return;
				let pc = null;
				try{ pc = makePc(); }catch(e){ pendingLease.release(); return; }
				const entry = {
					pc, peer: null, sid: m.sid, hiTs: m.ts, negT: 0, helloT: 0, alive: false,
					helloSeen: false, myFp: '', peerFp: '', remoteSet: false,
					offerSent: false, localIce: [], remoteIce: [], sendChain: Promise.resolve(), dropped: false,
					pendingLease
				};
				pcs.set(gid, entry);
				entry.negT = setTimeout(() => { if(!entry.alive) drop(gid, entry); }, RTC_LIMITS.NEGOTIATE_MS);
				let dc = null; try{ dc = pc.createDataChannel('mm', { ordered: true }); }catch(e){ drop(gid, entry); return; }
				// The protocol has exactly one host-created channel. A malicious guest can
				// still call createDataChannel() on its side; close every such inbound
				// channel immediately so it cannot turn the RTCPeerConnection into an
				// unbounded SCTP-stream allocation surface.
				pc.ondatachannel = (ev) => { try{ if(ev && ev.channel) ev.channel.close(); }catch(e){ /* reject */ } };
				pc.onicecandidate = (e) => {
					if(!e.candidate || entry.dropped) return;
					if(!entry.offerSent || !entry.myFp){
						if(entry.localIce.length >= RTC_LIMITS.ICE_PENDING_MAX){ drop(gid, entry); return; }
						entry.localIce.push(e.candidate);
						return;
					}
					send(gid, entry, { k: 'ice', c: e.candidate }, entry.myFp);
				};
				pc.onconnectionstatechange = () => {
					if(pc.connectionState === 'failed' || pc.connectionState === 'closed'){ drop(gid, entry); }
				};
				dc.onopen = () => {
					if(entry.dropped || pcs.get(gid) !== entry){ try{ dc.close(); }catch(e){ /* stale */ } return; }
					if(entry.alive) return;
					entry.alive = true;
					if(entry.pendingLease){ entry.pendingLease.release(); entry.pendingLease = null; }
					if(entry.negT){ clearTimeout(entry.negT); entry.negT = 0; }
					entry.peer = rtcPeerWrap(gid, dc);
					entry.helloT = setTimeout(() => { if(!entry.helloSeen) drop(gid, entry); }, RTC_LIMITS.HELLO_MS);
					dc.onmessage = (ev) => {
						if(entry.dropped || pcs.get(gid) !== entry) return;
						// Guests never upload snapshots. Reject large control frames at a cheap
						// code-unit gate before UTF-8 measurement/JSON.parse, so a connected
						// invite holder cannot buy 256 KB parses at the app message-rate cap.
						if(typeof ev.data !== 'string' || ev.data.length > RTC_LIMITS.GUEST_JSON_MAX || !withinWireLimit(ev.data, RTC_LIMITS.GUEST_JSON_MAX)){ drop(gid, entry); return; }
						let pl = null; try{ pl = JSON.parse(ev.data); }catch(e){ drop(gid, entry); return; }
						if(!pl || typeof pl !== 'object' || Array.isArray(pl)){ drop(gid, entry); return; }
						if(pl && pl.t === 'hello'){ entry.helloSeen = true; if(entry.helloT){ clearTimeout(entry.helloT); entry.helloT = 0; } }
						try{ if(entry.peer.onMessage) entry.peer.onMessage(pl); }
						catch(e){ drop(gid, entry); }
					};
					dc.onclose = () => {
						try{ if(entry.peer && entry.peer.onMessage) entry.peer.onMessage({ t: 'bye' }); }
						finally { drop(gid, entry); }
					};
					try{ handlers.onPeer(entry.peer); }
					catch(e){ drop(gid, entry); }
				};
				try{
					const offer = await pc.createOffer();
					await pc.setLocalDescription(offer);
					entry.myFp = sdpFingerprint(pc.localDescription);
					if(!entry.myFp) throw new Error('missing-local-fingerprint');
					await send(gid, entry, { k: 'offer', sdp: pc.localDescription }, entry.myFp);
					entry.offerSent = true;
					await flushLocalIce(gid, entry);
				}catch(e){ drop(gid, entry); }
			} else if(m.k === 'answer'){
				const entry = current;
				if(entry.remoteSet || entry.answerPending) return;
				const fp = sdpFingerprint(m.sdp);
				if(entry.peerFp && fp !== entry.peerFp) return; // fingerprint may not change mid-handshake
				entry.peerFp = fp; // pin the guest's media identity for its ICE
				entry.answerPending = true;
				try{
					await entry.pc.setRemoteDescription(m.sdp);
					if(entry.dropped || pcs.get(gid) !== entry) return;
					entry.remoteSet = true;
					await flushRemoteIce(entry);
				}catch(e){ drop(gid, entry); }
				finally { entry.answerPending = false; }
			} else if(m.k === 'ice' && m.c){
				const entry = current;
				if(!entry.peerFp || !entry.remoteSet){
					if(entry.remoteIce.length >= RTC_LIMITS.ICE_PENDING_MAX){ drop(gid, entry); return; }
					entry.remoteIce.push({ c: m.c, fp: m.fp });
					return;
				}
				if(m.fp !== entry.peerFp) return;
				try{ await entry.pc.addIceCandidate(m.c); }catch(e){ /* hostile/obsolete candidate */ }
			}
		}
	});
	return {
		stop(){
			stopped = true;
			for(const gid of Array.from(pcs.keys())){ const e = pcs.get(gid); try{ if(e.peer) e.peer.send({ t: 'hostGone' }); }catch(err){ /* fine */ } drop(gid, e); }
			sig.close();
		}
	};
}
export function createRtcJoin(room, gid, handlers, secret){
	const deps = arguments[4] || {};
	const openSig = deps.openSignal || openSignal;
	const makePc = deps.makePeerConnection || (() => new RTCPeerConnection(RTC_CONFIG));
	const self = 'g' + gid;
	const sc = createSignedChannel(secret, room, self);
	if(!sc.ready){ return { close(){ /* no invite secret ⇒ no authenticated remote join */ } }; }
	let pc = null, hiT = null, negT = null, closed = false, resetting = false, pendingLease = null;
	let sid = randBytesHex(12), myFp = '', hostFp = '', remoteSet = false, answerSent = false;
	let localIce = [], remoteIce = [], conn = null, sendChain = Promise.resolve();
	let signalRateAt = 0, signalRateN = 0;
	function signalAllowed(){
		const t = Date.now();
		if(t - signalRateAt > RTC_LIMITS.SIGNAL_WINDOW_MS){ signalRateAt = t; signalRateN = 0; }
		return ++signalRateN <= RTC_LIMITS.SIGNAL_PEER_MAX;
	}
	const send = (obj, fp) => {
		const sendSid = sid;
		const task = sendChain.then(async () => {
			if(closed || sendSid !== sid) return;
			const env = await sc.seal(Object.assign({}, obj, { to: 'h', sid: sendSid }), fp);
			if(!closed && sendSid === sid) sig.sendTo('h', env);
		});
		sendChain = task.catch(() => {});
		return task;
	};
	function sendHi(){ if(!closed && !pc) send({ k: 'hi' }); }
	function clearNegotiate(expectedPc){
		if(expectedPc && pc !== expectedPc) return;
		if(negT){ clearTimeout(negT); negT = null; }
	}
	function resetPeer(renewSid, expectedPc){
		if(expectedPc && pc !== expectedPc){ try{ expectedPc.close(); }catch(e){ /* stale */ } return false; }
		if(resetting) return;
		resetting = true;
		clearNegotiate(expectedPc);
		const old = pc, oldConn = conn; pc = null; conn = null;
		if(pendingLease){ pendingLease.release(); pendingLease = null; }
		myFp = ''; hostFp = ''; remoteSet = false; answerSent = false;
		localIce = []; remoteIce = [];
		if(renewSid) sid = randBytesHex(12);
		try{ if(oldConn) oldConn.close(); }catch(e){ /* already closed */ }
		try{ if(old) old.close(); }catch(e){ /* already closed */ }
		resetting = false;
		return true;
	}
	async function flushLocalIce(expectedPc, expectedSid){
		if(pc !== expectedPc || sid !== expectedSid || !answerSent || !myFp) return;
		while(localIce.length && pc === expectedPc && sid === expectedSid){ await send({ k: 'ice', c: localIce.shift() }, myFp); }
	}
	async function flushRemoteIce(expectedPc, expectedSid){
		if(pc !== expectedPc || sid !== expectedSid || !remoteSet || !hostFp) return;
		const pending = remoteIce.splice(0);
		for(const ice of pending){
			if(pc !== expectedPc || sid !== expectedSid) return;
			if(ice.fp !== hostFp) continue;
			try{ await expectedPc.addIceCandidate(ice.c); }catch(e){ /* hostile/obsolete candidate */ }
		}
	}
	const sig = openSig(room, self, {
		onReady(){
			if(closed) return;
			if(hiT) clearInterval(hiT);
			sendHi();
			hiT = setInterval(sendHi, 2500);
		},
		onFail: handlers.onFail || null,
		async onMsg(m){
			if(closed || m.from !== 'h') return; // only the host inbox
			if(!signalPreflight(m, 'h', self)) return;
			// This inbox is public-broker input too. Bound HMAC work on the joiner just
			// like the host does; otherwise unsigned offer-shaped garbage can fan out
			// unlimited Web Crypto operations before signature verification rejects it.
			if(!signalAllowed()) return;
			const messageSid = sid;
			const pinnedHostFp = hostFp;
			// verify the host MAC (and, once learned, its encrypted pinned fingerprint).
			// This excludes broker-only observers; invite holders share one trust domain.
			const verifyLease = acquireSignalVerify();
			if(!verifyLease) return;
			let v = null;
			try{ v = await sc.open(m, 'h', (m.k === 'ice' && pinnedHostFp) ? pinnedHostFp : null, messageSid); }
			catch(e){ return; }
			finally { verifyLease.release(); }
			if(closed || sid !== messageSid || !v || !v.ok) return;
			m = v.message; // never pass the public-broker envelope to WebRTC APIs
			if(m.k === 'offer' && !pc){
				hostFp = sdpFingerprint(m.sdp); // pin exactly whose DTLS session we will join
				const lease = acquireRtcPending();
				if(!lease){ hostFp = ''; return; }
				let activePc = null;
				try{ activePc = makePc(); pc = activePc; pendingLease = lease; }
				catch(e){ lease.release(); pc = null; resetPeer(true); sendHi(); return; }
				const isCurrent = () => !closed && sid === messageSid && pc === activePc && !resetting;
				negT = setTimeout(() => { if(isCurrent()){ resetPeer(true, activePc); sendHi(); } }, RTC_LIMITS.NEGOTIATE_MS);
				activePc.onicecandidate = (e) => {
					if(!e.candidate || !isCurrent()) return;
					if(!answerSent || !myFp){
						if(localIce.length >= RTC_LIMITS.ICE_PENDING_MAX){ resetPeer(true, activePc); return; }
						localIce.push(e.candidate);
						return;
					}
					send({ k: 'ice', c: e.candidate }, myFp);
				};
				activePc.onconnectionstatechange = () => {
					if(!isCurrent()) return;
					if(activePc.connectionState === 'failed' || activePc.connectionState === 'closed'){
						try{ if(conn && conn.onMessage) conn.onMessage({ t: 'connLost' }); }
						finally { resetPeer(true, activePc); sendHi(); }
					}
				};
				activePc.ondatachannel = (ev) => {
					const dc = ev.channel;
					if(!isCurrent() || !dc || dc.label !== 'mm' || conn){ try{ if(dc) dc.close(); }catch(e){ /* reject extra channel */ } return; }
					conn = rtcPeerWrap('host', dc);
					const opened = conn;
					dc.onmessage = (mv) => {
						if(!isCurrent() || conn !== opened) return;
						if(typeof mv.data !== 'string' || !withinWireLimit(mv.data, WIRE_LIMITS.JSON_MAX)){ try{ dc.close(); }catch(e){} return; }
						let pl = null; try{ pl = JSON.parse(mv.data); }catch(e){ try{ dc.close(); }catch(e2){} return; }
						if(!pl || typeof pl !== 'object' || Array.isArray(pl)){ try{ dc.close(); }catch(e){} return; }
						try{ if(opened.onMessage) opened.onMessage(pl); }
						catch(e){
							try{ dc.close(); }
							finally { if(isCurrent()){ resetPeer(true, activePc); sendHi(); } }
						}
					};
					dc.onopen = () => {
						if(!isCurrent() || conn !== opened){ try{ dc.close(); }catch(e){ /* stale */ } return; }
						if(pendingLease){ pendingLease.release(); pendingLease = null; }
						clearNegotiate(activePc);
						try{ handlers.onOpen(opened); }
						catch(e){ if(isCurrent()){ resetPeer(true, activePc); sendHi(); } }
					};
					// a dropped channel is a network event, not a goodbye — the client
					// reconnects on connLost but treats hostGone as final
					dc.onclose = () => {
						if(!isCurrent() || conn !== opened) return;
						try{ if(opened.onMessage) opened.onMessage({ t: 'connLost' }); }
						finally { resetPeer(true, activePc); sendHi(); }
					};
				};
				try{
					await activePc.setRemoteDescription(m.sdp);
					if(!isCurrent()) return;
					remoteSet = true;
					await flushRemoteIce(activePc, messageSid);
					if(!isCurrent()) return;
					const answer = await activePc.createAnswer();
					if(!isCurrent()) return;
					await activePc.setLocalDescription(answer);
					if(!isCurrent()) return;
					myFp = sdpFingerprint(activePc.localDescription);
					if(!myFp) throw new Error('missing-local-fingerprint');
					await send({ k: 'answer', sdp: activePc.localDescription }, myFp);
					if(!isCurrent()) return;
					answerSent = true;
					await flushLocalIce(activePc, messageSid);
				}catch(e){
					if(isCurrent()){ resetPeer(true, activePc); sendHi(); }
					else try{ activePc.close(); }catch(e2){ /* stale */ }
				}
			} else if(m.k === 'ice' && m.c){
				if(!pc || !remoteSet || !hostFp){
					if(remoteIce.length >= RTC_LIMITS.ICE_PENDING_MAX){ resetPeer(true, pc || undefined); return; }
					remoteIce.push({ c: m.c, fp: m.fp });
					return;
				}
				if(m.fp !== hostFp) return;
				const icePc = pc;
				try{ await icePc.addIceCandidate(m.c); }catch(e){ /* hostile/obsolete candidate */ }
			}
		}
	});
	return {
		close(){ closed = true; if(hiT) clearInterval(hiT); clearNegotiate(); resetPeer(false); sig.close(); }
	};
}

// --- facades --------------------------------------------------------------------
// Host listens on the loopback transport (a second tab on this machine) always; the
// remote WebRTC transport is authenticated by an invite SECRET and only stands up when
// one is present. Its signaling rides public MQTT brokers, so every offer/answer/ICE is
// AES-GCM encrypted and HMAC-authenticated with derived invite keys. A peer without the
// secret can neither be answered nor make us open a PeerConnection. A caller opts in
// with `rtc:true` AND a valid `secret`; without the secret, remote stays closed.
export function hostListen(room, opts){
	const stops = [];
	const status = { bc: false, rtc: false };
	try{
		if(typeof BroadcastChannel !== 'undefined'){ stops.push(createLoopbackHost(room, opts.onPeer).stop); status.bc = true; }
	}catch(e){ /* no loopback */ }
	if(opts.rtc === true && validInviteSecret(opts.secret) && typeof RTCPeerConnection !== 'undefined' && typeof WebSocket !== 'undefined'){
		try{ stops.push(createRtcHost(room, { onPeer: opts.onPeer, onStatus: opts.onStatus }, opts.secret).stop); status.rtc = true; }catch(e){ /* rtc unavailable */ }
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
	// Remote RTC join requires the invite SECRET: the guest signs its `hi`, verifies the
	// host's offer signature and pins the host's DTLS fingerprint, so a broker-squatting
	// impostor can neither be answered nor answer a naive join with a poisoned world. The
	// default watch link (no secret) therefore only connects same-machine (loopback).
	if(validInviteSecret(opts.secret) && typeof RTCPeerConnection !== 'undefined' && typeof WebSocket !== 'undefined'){
		try{
			const j = createRtcJoin(room, opts.id, { onOpen: (c) => { wire(c); if(opts.onTransportUp) opts.onTransportUp(c); }, onFail: opts.onSignalFail }, opts.secret);
			closers.push(j.close);
		}catch(e){ /* rtc unavailable */ }
	}
	return api;
}

// The engine consumes THIS object (`import { ghostNet as NET }`), not the module
// namespace — a named export missing from here is simply undefined at runtime while
// every Node test still passes. ghost-sim pins the two lists against each other.
const api = {
	GHOST_PROTO, BUFF_RULES, MQTT_BROKERS, MQTT_PACKET_MAX,
	SOCIAL_RULES, socialBoosts, PERMISSION_MODES, validPermissionMode, modeAllows, AVATARS, validAvatar, CHAT, filterChat,
	PLAY_RULES, PLAY_ACTIONS, validPlayAction, playReachOk, clampBodyStep, pouchAdd, pouchTake,
	PLAY_WEAPONS, PLAY_STARTER_WEAPONS, PLAY_STARTER_AMMO, validPlayWeapon, playAimDir,
	GID_KEY, GID_LEASE_KEY, GID_LEASE_MS, validGid, duelAskKey, PLAY_RECIPES, validPlayRecipe, pouchAfford, pouchSpend,
	HERO_KEY, HERO_ACTIONS, validHeroAction, HERO_RULES,
	PLAY_FOODS, validPlayFood, LOOK_KEY, validLookColor,
	SPIRIT_AVOID, spiritLift, PING,
	DREAD, dreadAt, POWER_RULES, POWER_CHARGE, validPowerKind, chargeAfter, ASSIST_ACTIONS, validAssistAction,
	ASSIST_LIMITS, clampCraftCount, createAssistQueue,
	roomCode, normalizeRoom, watchLink, parseWatch, validBuffKind,
	chunkPayload, createAssembler, createCooldownLedger,
	utf8Len, WIRE_LIMITS, withinWireLimit, validSignalSize,
	RESUME_TOKEN_BYTES, RESUME_TOKEN_KEY, mintResumeToken, validResumeTokenShape, resumeTokenMatch,
	SIGNAL_ENVELOPE_VERSION, INVITE_SECRET_BYTES, SIG_REPLAY_WINDOW_MS, mintInviteSecret, validInviteSecret, signSignal, verifySignal, createReplayGuard,
	sdpFingerprint, createSignedChannel, parseInviteSecret,
	clampStep, sweepBodyMove, createByteBudget, createRateBudget, createSendQueue, DC_QUEUE, RTC_LIMITS, createRtcHost, createRtcJoin,
	PROG_KEY, PROG, DEED_XP, validDeed, deedXp, xpForLevel, levelFor, RANKS, rankFor,
	ACHIEVEMENTS, achievementById, achievementProgress, createProgress, normalizeProgress, statView, progressAfter,
	hostListen, joinRoom
};
if(typeof window !== 'undefined' && window.MM) window.MM.ghostNet = api;
export const ghostNet = api;
export default ghostNet;
