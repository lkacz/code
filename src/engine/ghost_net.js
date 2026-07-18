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
	STRIKE_MS: 550,    // melee cooldown
	STRIKE_R: 1.4,     // melee radius around the struck point
	STRIKE_DMG: 7,
	POSE_MS: 80,       // guest pose uplink cadence
	MAX_SPEED: 30,     // tiles/s envelope — a claimed pose beyond it is clamped, not trusted
	BODY_W: 0.62, BODY_H: 0.92,
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
// --- hero mode: the full-game guest --------------------------------------------------
// Authority split (the owner's trust ruling for friends co-op): the guest's PLAYER
// state — inventory, gear, XP, vitals — is its own LOCAL truth, persisted in the
// guest browser under HERO_KEY. The host protects only the shared WORLD: every
// tile write and every entity-damage application is validated here with the same
// rules the solo player obeys (reach, rate, mineability, placement legality,
// damage envelope). A modified hero client can gild its own trophy case; it still
// cannot write a single illegal tile or one-shot a boss.
export const HERO_KEY = 'mm_ghost_hero_v1';
export const HERO_ACTIONS = ['mine', 'place', 'dmg', 'pickup', 'use', 'shoot', 'row', 'board', 'unboard', 'tp', 'antenna'];
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
	ANTENNA_MS: 1500 // per-guest floor between antenna-power intents (real cooldown is per-active, host-side)
};
export const PLAY_ACTIONS = ['mine', 'place', 'strike', 'attack', 'craft', 'duel', 'pickup', 'eat'];
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
	const m = /[#?&]k=([0-9a-fA-F]{32,64})\b/.exec(String(str || ''));
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
	// the secret lives in the fragment; fall back to the query for robustness
	const secret = parseInviteSecret(hash != null ? hash : '') || parseInviteSecret(q);
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
				if(bad){ buf = new Uint8Array(0); break; }
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

// ============================ SECURITY PRIMITIVES (pure) ============================
// Everything here is host-authoritative anti-abuse plumbing, testable under Node
// (Web Crypto is available there): resume tokens against gid takeover, invite-
// secret signaling signatures + replay guard, wire size caps, a swept-collision
// resolver so the host can reject wall-tunneling, and a bounded DataChannel queue.

function randBytesHex(n){
	const a = new Uint8Array(Math.max(1, n | 0));
	if(typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(a);
	else for(let i = 0; i < a.length; i++) a[i] = (Math.random() * 256) | 0; // last-resort only — never in a crypto env
	let s = '';
	for(let i = 0; i < a.length; i++) s += a[i].toString(16).padStart(2, '0');
	return s;
}
// UTF-8 byte length — the wire is bytes, not code units, so a hostile sender can't
// smuggle a multi-megabyte payload past a String.length check with multi-byte chars.
export function utf8Len(str){
	const s = String(str == null ? '' : str);
	if(typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
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
	SIG_MAX: 20480,        // whole signaling envelope
	MQTT_PAYLOAD_MAX: 32768,
	ASSEMBLED_MAX: 50331648 // 48 MB assembled snapshot ceiling (bytes, not code units)
};
export function withinWireLimit(str, limit){ return utf8Len(str) <= (Number(limit) || 0); }
// A signaling envelope carries an SDP or an ICE candidate; reject the oversized ones
// before they reach setRemoteDescription/addIceCandidate.
export function validSignalSize(m){
	if(!m || typeof m !== 'object') return false;
	if(m.sdp != null && !withinWireLimit(typeof m.sdp === 'string' ? m.sdp : JSON.stringify(m.sdp), WIRE_LIMITS.SDP_MAX)) return false;
	if(m.c != null && !withinWireLimit(typeof m.c === 'string' ? m.c : JSON.stringify(m.c), WIRE_LIMITS.ICE_MAX)) return false;
	return true;
}

// --- invite-secret signaling: authenticate the handshake, not just the room code -----
// Extending the room code does nothing (a public MQTT topic still carries plaintext
// unsigned envelopes). The invite carries a Web-Crypto secret (≥128-bit); every
// signaling envelope is HMAC-signed over (room|role|nonce|ts|contentHash) and bound
// to the sender role and the host fingerprint, and a replay guard rejects re-sends.
export const INVITE_SECRET_BYTES = 16;
export const SIG_REPLAY_WINDOW_MS = 60000;
export function mintInviteSecret(){ return randBytesHex(INVITE_SECRET_BYTES); }
export function validInviteSecret(s){ return typeof s === 'string' && /^[0-9a-f]{32,64}$/.test(s); }
function hexToBytes(hex){
	const h = String(hex);
	const out = new Uint8Array(h.length >> 1);
	for(let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
	return out;
}
async function hmacHex(secretHex, msg){
	if(typeof crypto === 'undefined' || !crypto.subtle) throw new Error('subtle-crypto-unavailable');
	const key = await crypto.subtle.importKey('raw', hexToBytes(secretHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(msg)));
	const b = new Uint8Array(sig);
	let s = '';
	for(let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
	return s;
}
// Canonical string the signature covers: order and separators are fixed so both ends
// hash exactly the same bytes. fp = the signer's DTLS fingerprint binding (or '').
function sigCanon(room, role, nonce, ts, fp, contentStr){
	return [String(room), String(role), String(nonce), String(ts | 0), String(fp || ''), String(contentStr == null ? '' : contentStr)].join('');
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
// The exact bytes an envelope's signature covers: the SDP TEXT for an offer/answer,
// the candidate JSON for an ICE trickle, empty for a bare hi. Both ends derive it
// identically so a tampered SDP/ICE breaks the MAC.
function sigContentOf(obj){
	if(obj && obj.sdp != null) return sdpString(obj.sdp);
	if(obj && obj.c != null) return JSON.stringify(obj.c);
	return '';
}
export async function signSignal(secret, room, role, nonce, ts, contentStr, fp){
	return hmacHex(secret, sigCanon(room, role, nonce, ts, fp, contentStr));
}
// Verify signature + freshness + role/fingerprint binding. `guard` (createReplayGuard)
// rejects a nonce already seen inside the window — so a captured envelope can't be
// replayed. Returns {ok, reason}.
export async function verifySignal(secret, env, expect){
	expect = expect || {};
	if(!validInviteSecret(secret)) return { ok: false, reason: 'secret' };
	if(!env || typeof env !== 'object') return { ok: false, reason: 'shape' };
	if(typeof env.sig !== 'string' || typeof env.nonce !== 'string' || !Number.isFinite(env.ts)) return { ok: false, reason: 'shape' };
	if(!validSignalSize(env)) return { ok: false, reason: 'size' };
	const now = Number.isFinite(expect.now) ? expect.now : Date.now();
	if(Math.abs(now - env.ts) > (expect.window || SIG_REPLAY_WINDOW_MS)) return { ok: false, reason: 'stale' };
	if(expect.role && env.role !== expect.role) return { ok: false, reason: 'role' };
	if(expect.fp && env.fp && env.fp !== expect.fp) return { ok: false, reason: 'fingerprint' };
	// AUTHENTICATE before touching the replay guard: the nonce store is bounded, so if a
	// forged message could consume a slot, a room-code-knowing attacker could saturate it
	// and starve legit guests. Only a valid (secret-signed) message may record its nonce.
	const content = sigContentOf(env);
	let mac = '';
	try{ mac = await hmacHex(secret, sigCanon(expect.room, env.role, env.nonce, env.ts, env.fp || '', content)); }
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

// --- the signed signaling channel: the whole trust decision, transport-agnostic ------
// Both RTC peers wrap their raw pub/sub in one of these. `seal` stamps an outgoing
// envelope (fresh nonce + timestamp + DTLS-fingerprint binding + HMAC over the SDP/ICE
// content); `open` verifies an incoming one against the shared invite secret, the
// expected sender role, freshness and the per-channel replay guard. A peer that lacks
// the secret can neither forge a signature nor replay a captured one, so the public
// broker carries only envelopes the invited parties produced. This is the security
// boundary; createRtcHost/createRtcJoin are dumb plumbing around it (and the reason
// the crypto is tested here directly — headless Node has no RTCPeerConnection).
export function createSignedChannel(secret, room, selfRole, opts){
	opts = opts || {};
	const guard = createReplayGuard(opts.window);
	return {
		role: selfRole,
		ready: validInviteSecret(secret), // no secret ⇒ no authenticated channel at all
		// fpOverride binds a non-SDP envelope (an ICE trickle) to the sender's OWN
		// media fingerprint, so ICE can't be injected across a different peer session.
		async seal(obj, fpOverride){
			const nonce = randBytesHex(12);
			const ts = Date.now();
			const fp = (obj && obj.sdp != null) ? sdpFingerprint(obj.sdp) : (fpOverride || '');
			const sig = await signSignal(secret, room, selfRole, nonce, ts, sigContentOf(obj), fp);
			return Object.assign({}, obj, { role: selfRole, nonce, ts, fp, sig });
		},
		// expectRole: the identity the sender MUST have signed as (e.g. a guest expects
		// 'h'; the host expects the guest's own inbox id). fpPin (optional): a fingerprint
		// learned from an earlier verified message this one must still match.
		async open(env, expectRole, fpPin){
			const v = await verifySignal(secret, env, { room, role: expectRole, guard, fp: fpPin || null });
			return v;
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
function aabbHitsSolid(x, y, w, h, solidAt){
	const x0 = Math.floor(x - w / 2), x1 = Math.floor(x + w / 2 - 1e-6);
	const y0 = Math.floor(y - h / 2), y1 = Math.floor(y + h / 2 - 1e-6);
	for(let ty = y0; ty <= y1; ty++) for(let tx = x0; tx <= x1; tx++){ if(solidAt(tx, ty)) return true; }
	return false;
}
export function sweepBodyMove(b, claimedX, claimedY, maxStep, solidAt, bounds){
	const w = (b && Number.isFinite(b.w)) ? b.w : PLAY_RULES.BODY_W;
	const h = (b && Number.isFinite(b.h)) ? b.h : PLAY_RULES.BODY_H;
	let cx = Number.isFinite(b.x) ? b.x : (Number(claimedX) || 0);
	let cy = Number.isFinite(b.y) ? b.y : (Number(claimedY) || 0);
	let tx = clampStep(cx, Number(claimedX), maxStep);
	let ty = clampStep(cy, Number(claimedY), maxStep);
	if(bounds){
		tx = Math.max(bounds.minX + w / 2, Math.min(bounds.maxX - w / 2, tx));
		ty = Math.max(bounds.minY + h / 2, Math.min(bounds.maxY - h / 2, ty));
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
			if(aabbHitsSolid(nx, ny, w, h, solid)) break;
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
export const DC_QUEUE = { HI: 262144, LO: 65536, MAX: 4096 };
export function createSendQueue(opts){
	opts = opts || {};
	const hi = Number.isFinite(opts.hi) ? opts.hi : DC_QUEUE.HI;
	const lo = Number.isFinite(opts.lo) ? opts.lo : DC_QUEUE.LO;
	const max = Number.isFinite(opts.max) ? opts.max : DC_QUEUE.MAX;
	const q = [];
	let closed = false, gated = false;
	return {
		push(item){
			if(closed) return false;
			if(q.length >= max){ closed = true; return false; } // fail closed
			q.push(item);
			return true;
		},
		// drive with a channel exposing {bufferedAmount, send(x)}; returns false once
		// the queue has fail-closed so the transport can tear the peer down
		flush(channel){
			if(closed) return false;
			const buffered = () => Number(channel && channel.bufferedAmount) || 0;
			if(gated && buffered() > lo) return true;         // still draining: hold
			gated = false;
			while(q.length){
				if(buffered() > hi){ gated = true; break; }    // congested: re-gate
				try{ channel.send(q.shift()); }catch(e){ closed = true; return false; }
			}
			return true;
		},
		size(){ return q.length; },
		closed(){ return closed; }
	};
}

// --- RTC negotiation limits -----------------------------------------------------------
export const RTC_LIMITS = {
	PENDING_MAX: 8,     // half-open peer connections awaiting a datachannel
	NEGOTIATE_MS: 15000, // an offer that never becomes a connected channel is dropped
	HELLO_MS: 20000     // a connected channel that never sends a valid hello is dropped
};

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
				if(!validSignalSize(m)) return;
				handlers.onMsg(m);
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
// Every rtc peer sends through a bounded queue: dc.send never outruns the socket
// (bufferedAmount high/low water), and a backlog that blows its ceiling fail-closes
// the channel instead of buffering without bound.
function rtcPeerWrap(id, dc){
	const q = createSendQueue();
	try{ dc.bufferedAmountLowThreshold = DC_QUEUE.LO; }catch(e){ /* older impls */ }
	try{ dc.onbufferedamountlow = () => { if(!q.flush(dc)){ try{ dc.close(); }catch(e2){ /* fine */ } } }; }catch(e){ /* fine */ }
	return {
		id, transport: 'rtc', onMessage: null,
		send(pl){
			let str = null;
			try{ str = JSON.stringify(pl); }catch(e){ return; }
			if(!withinWireLimit(str, WIRE_LIMITS.JSON_MAX)) return; // never emit an oversized frame
			if(!q.push(str) || !q.flush(dc)){ try{ dc.close(); }catch(e){ /* fine */ } }
		},
		close(){ try{ dc.close(); }catch(e){ /* fine */ } }
	};
}
function createRtcHost(room, handlers, secret){
	const sc = createSignedChannel(secret, room, 'h');
	if(!sc.ready) return { stop(){ /* no secret ⇒ no authenticated remote signaling */ } };
	const pcs = new Map(); // ghostId -> {pc, peer, negT, helloT, alive, myFp, peerFp}
	// fail-closed teardown: a half-open peer that never finishes negotiating, or a
	// connected channel that never speaks a valid hello, is dropped with its timers
	function drop(gid){
		const e = pcs.get(gid);
		if(!e) return;
		if(e.negT) clearTimeout(e.negT);
		if(e.helloT) clearTimeout(e.helloT);
		try{ if(e.peer) e.peer.close(); }catch(err){ /* fine */ }
		try{ e.pc.close(); }catch(err){ /* fine */ }
		pcs.delete(gid);
	}
	// every outgoing signaling envelope is SEALED (signed) before it hits the broker
	const send = (gid, obj, fp) => { sc.seal(obj, fp).then(env => sig.sendTo(gid, env)).catch(() => { /* crypto unavailable */ }); };
	const sig = openSignal(room, 'h', {
		onReady: handlers.onStatus ? () => handlers.onStatus('signal-ready') : null,
		onFail: handlers.onStatus ? () => handlers.onStatus('signal-fail') : null,
		async onMsg(m){
			const gid = m.from;
			// only a guest inbox may talk to the host, and it must have SIGNED as itself
			if(typeof gid !== 'string' || !/^g[a-zA-Z0-9._-]{1,44}$/.test(gid)) return;
			const v = await sc.open(m, gid);
			if(!v.ok) return; // unsigned / wrong secret / replay / tampered / stale — ignored.
			// This is also the RTC DoS gate: an un-invited peer cannot even make us open a
			// PeerConnection, because its `hi` never carries a valid signature.
			if(m.k === 'hi'){
				if(pcs.has(gid)) return; // one connection per ghost id
				if(pcs.size >= RTC_LIMITS.PENDING_MAX) return; // flood guard (now: invited peers only)
				const pc = new RTCPeerConnection(RTC_CONFIG);
				const entry = { pc, peer: null, negT: 0, helloT: 0, alive: false, myFp: '', peerFp: '' };
				pcs.set(gid, entry);
				entry.negT = setTimeout(() => { if(!entry.alive) drop(gid); }, RTC_LIMITS.NEGOTIATE_MS);
				const dc = pc.createDataChannel('mm', { ordered: true });
				pc.onicecandidate = (e) => { if(e.candidate) send(gid, { k: 'ice', c: e.candidate }, entry.myFp); };
				pc.onconnectionstatechange = () => {
					if(pc.connectionState === 'failed' || pc.connectionState === 'closed'){ drop(gid); }
				};
				dc.onopen = () => {
					entry.alive = true;
					if(entry.negT){ clearTimeout(entry.negT); entry.negT = 0; }
					entry.peer = rtcPeerWrap(gid, dc);
					entry.helloT = setTimeout(() => { if(!entry.helloSeen) drop(gid); }, RTC_LIMITS.HELLO_MS);
					dc.onmessage = (ev) => {
						if(!withinWireLimit(ev.data, WIRE_LIMITS.JSON_MAX)) return; // oversized frame ignored
						let pl = null; try{ pl = JSON.parse(ev.data); }catch(e){ return; }
						if(pl && pl.t === 'hello'){ entry.helloSeen = true; if(entry.helloT){ clearTimeout(entry.helloT); entry.helloT = 0; } }
						if(entry.peer.onMessage) entry.peer.onMessage(pl);
					};
					dc.onclose = () => { if(entry.peer && entry.peer.onMessage) entry.peer.onMessage({ t: 'bye' }); drop(gid); };
					handlers.onPeer(entry.peer);
				};
				pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => {
					entry.myFp = sdpFingerprint(pc.localDescription); // ICE we send binds to this
					send(gid, { k: 'offer', sdp: pc.localDescription }, entry.myFp);
				}).catch(() => drop(gid));
			} else if(m.k === 'answer' && pcs.has(gid)){
				const entry = pcs.get(gid);
				const fp = sdpFingerprint(m.sdp);
				if(entry.peerFp && fp !== entry.peerFp) return; // fingerprint may not change mid-handshake
				entry.peerFp = fp; // pin the guest's media identity for its ICE
				entry.pc.setRemoteDescription(m.sdp).catch(() => {});
			} else if(m.k === 'ice' && pcs.has(gid) && m.c){
				const entry = pcs.get(gid);
				if(entry.peerFp && m.fp && m.fp !== entry.peerFp) return; // ICE must match the pinned peer
				entry.pc.addIceCandidate(m.c).catch(() => {});
			}
		}
	});
	return {
		stop(){
			for(const gid of Array.from(pcs.keys())){ const e = pcs.get(gid); try{ if(e.peer) e.peer.send({ t: 'hostGone' }); }catch(err){ /* fine */ } drop(gid); }
			sig.close();
		}
	};
}
function createRtcJoin(room, gid, handlers, secret){
	const sc = createSignedChannel(secret, room, 'g' + gid);
	if(!sc.ready){ return { close(){ /* no invite secret ⇒ no authenticated remote join */ } }; }
	let pc = null, hiT = null, closed = false, myFp = '', hostFp = '';
	const send = (obj, fp) => { sc.seal(obj, fp).then(env => sig.sendTo('h', env)).catch(() => { /* crypto unavailable */ }); };
	const sig = openSignal(room, 'g' + gid, {
		onReady(){
			send({ k: 'hi' });
			hiT = setInterval(() => { if(!pc) send({ k: 'hi' }); }, 2500);
		},
		onFail: handlers.onFail || null,
		async onMsg(m){
			if(m.from !== 'h') return; // only the host inbox
			// verify the host signed it (and, once learned, that it carries the pinned
			// host fingerprint) — a leaked-secret passive attacker still can't hijack ICE
			const v = await sc.open(m, 'h', hostFp || null);
			if(!v.ok) return;
			if(m.k === 'offer' && !pc){
				hostFp = sdpFingerprint(m.sdp); // pin exactly whose DTLS session we will join
				pc = new RTCPeerConnection(RTC_CONFIG);
				pc.onicecandidate = (e) => { if(e.candidate) send({ k: 'ice', c: e.candidate }, myFp); };
				pc.ondatachannel = (ev) => {
					const dc = ev.channel;
					const conn = rtcPeerWrap('host', dc);
					dc.onmessage = (mv) => { let pl = null; try{ pl = JSON.parse(mv.data); }catch(e){ return; } if(conn.onMessage) conn.onMessage(pl); };
					dc.onopen = () => handlers.onOpen(conn);
					// a dropped channel is a network event, not a goodbye — the client
					// reconnects on connLost but treats hostGone as final
					dc.onclose = () => { if(!closed && conn.onMessage) conn.onMessage({ t: 'connLost' }); };
				};
				pc.setRemoteDescription(m.sdp).then(() => pc.createAnswer()).then(a => pc.setLocalDescription(a)).then(() => {
					myFp = sdpFingerprint(pc.localDescription);
					send({ k: 'answer', sdp: pc.localDescription }, myFp);
				}).catch(() => {});
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
// Host listens on the loopback transport (a second tab on this machine) always; the
// remote WebRTC transport is authenticated by an invite SECRET and only stands up when
// one is present. Its signaling rides public MQTT brokers, so every offer/answer/ICE is
// HMAC-signed with that secret (createRtcHost via createSignedChannel) — a peer without
// the secret can neither be answered nor make us open a PeerConnection. A caller opts in
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
	GHOST_PROTO, BUFF_RULES, MQTT_BROKERS,
	SOCIAL_RULES, socialBoosts, PERMISSION_MODES, validPermissionMode, modeAllows, AVATARS, validAvatar, CHAT, filterChat,
	PLAY_RULES, PLAY_ACTIONS, validPlayAction, playReachOk, clampBodyStep, pouchAdd, pouchTake,
	PLAY_WEAPONS, PLAY_STARTER_WEAPONS, PLAY_STARTER_AMMO, validPlayWeapon, playAimDir,
	GID_KEY, GID_LEASE_KEY, GID_LEASE_MS, PLAY_RECIPES, validPlayRecipe, pouchAfford, pouchSpend,
	HERO_KEY, HERO_ACTIONS, validHeroAction, HERO_RULES,
	PLAY_FOODS, validPlayFood, LOOK_KEY, validLookColor,
	SPIRIT_AVOID, spiritLift, PING,
	DREAD, dreadAt, POWER_RULES, POWER_CHARGE, validPowerKind, chargeAfter, ASSIST_ACTIONS, validAssistAction,
	ASSIST_LIMITS, clampCraftCount, createAssistQueue,
	roomCode, normalizeRoom, watchLink, parseWatch, validBuffKind,
	chunkPayload, createAssembler, createCooldownLedger,
	utf8Len, WIRE_LIMITS, withinWireLimit, validSignalSize,
	RESUME_TOKEN_BYTES, RESUME_TOKEN_KEY, mintResumeToken, validResumeTokenShape, resumeTokenMatch,
	INVITE_SECRET_BYTES, SIG_REPLAY_WINDOW_MS, mintInviteSecret, validInviteSecret, signSignal, verifySignal, createReplayGuard,
	sdpFingerprint, createSignedChannel, parseInviteSecret,
	clampStep, sweepBodyMove, createSendQueue, DC_QUEUE, RTC_LIMITS,
	PROG_KEY, PROG, DEED_XP, validDeed, deedXp, xpForLevel, levelFor, RANKS, rankFor,
	ACHIEVEMENTS, achievementById, achievementProgress, createProgress, normalizeProgress, statView, progressAfter,
	hostListen, joinRoom
};
if(typeof window !== 'undefined' && window.MM) window.MM.ghostNet = api;
export const ghostNet = api;
export default ghostNet;
