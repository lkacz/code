// Challenge seeds (challenge.js): shareable cursed-world links.
// ?seed=<1..999999999>&mods=<csv> boots a deterministic world with a curated,
// whitelisted set of gameplay modifiers — same link, same world, same curse.
// Pure core (parser, link builder, tuning derivations) above the RUNTIME line
// is Node-testable; the browser singleton below decides whether the challenge
// is ACTIVE (fresh profile) or PENDING (a save exists — the pause panel offers
// it to the new-game flow instead of silently destroying the player's world).
//
// Multiplayer contract (the three questions): a challenge never WRITES the
// world at runtime and adds no stream plane — it shapes worldgen at boot and
// tunes host-side sim laws. Ghost guests adopt the host's mod list from the
// welcome packet (display/law parity), re-whitelisted on receipt.
import { normalizeWorldSeed } from './new_game.js';

// worldgen.js imports this module, so it may be the first MM registrant to run
if(typeof window !== 'undefined') window.MM = window.MM || {};
const MMR = (typeof window !== 'undefined') ? window.MM : null;

// The curated modifier table. Every entry is a small DECLARATIVE effect hooked
// at one existing seam: `world` patches worldgen settings in memory (never
// persisted), `nightT` pins the day cycle through the time-override seam,
// `spawn` tunes the mob eco pass, `combat` scales the hero damage inlet.
export const CHALLENGE_MODS = Object.freeze({
	drought:    { label: 'Susza',           desc: 'Świat niemal bez wody: oceany i jeziora wysychają.',
		world: { oceanFrac: 0.04, aquiferLevel: 240, lakeMaxDepth: 2 } },
	deluge:     { label: 'Potop',           desc: 'Wody wzbierają: oceany rosną, ląd kurczy się do archipelagów, jaskinie toną.',
		world: { oceanFrac: 0.38, aquiferLevel: 64, lakeMaxDepth: 24 } },
	maze:       { label: 'Labirynt jaskiń', desc: 'Grunt podziurawiony jak plaster miodu.',
		world: { caveDensity: 1.6, tunnelDensity: 1.7, ravineFreq: 1.8 } },
	permanight: { label: 'Wieczna noc',     desc: 'Słońce nie wschodzi. Nocne prawa świata trwają bez końca.',
		nightT: 0.85 },
	permaday:   { label: 'Wieczny dzień',   desc: 'Słońce stoi w zenicie i nie zachodzi — brak nocnej osłony, upał bez wytchnienia. (Wyklucza się z Wieczną nocą.)',
		nightT: 0.25 },
	swarm:      { label: 'Rój',             desc: 'Stworzenia mnożą się trzykrotnie szybciej i gęściej.',
		spawn: { intervalDiv: 3, capMult: 2 } },
	glass:      { label: 'Szklane kości',   desc: 'Każde obrażenie boli podwójnie.',
		combat: { heroDamageInMult: 2 } },
	nobows:     { label: 'Bez łuków',       desc: 'Warsztat nie wytwarza łuków, kusz ani strzał.',
		craftBan: ['bow', 'crossbow', 'arrow'] },
	ironman:    { label: 'Jedno życie',     desc: 'Śmierć unieważnia wyzwanie — świat zostaje, honor nie.',
		ironman: true },
	scarce:     { label: 'Chudy świat',     desc: 'Wyposażenie i klejnoty wypadają o połowę rzadziej.',
		loot: { dropChanceMult: 0.5 } }
});

// A descent also offers one non-stacking protocol: a useful playstyle bias with
// an explicit cost. Protocols are player modifiers, not permanent power, and a
// new layer replaces the previous choice.
export const DESCENT_BOONS = Object.freeze({
	pathfinder:{label:'Protokół Szlaku',desc:'Ruch +12%, kopanie -8%.',mods:{moveSpeedMult:1.12,mineSpeedMult:0.92}},
	delver:{label:'Protokół Głębi',desc:'Kopanie +12%, ruch -6%.',mods:{mineSpeedMult:1.12,moveSpeedMult:0.94}},
	warded:{label:'Protokół Pancerza',desc:'Redukcja obrażeń +8%, ruch -7%.',mods:{damageReductionBonus:0.08,moveSpeedMult:0.93}},
	striker:{label:'Protokół Natarcia',desc:'Atak +3, redukcja obrażeń -4 p.p.',mods:{attackDamage:3,damageReductionBonus:-0.04}},
	amphibious:{label:'Protokół Przepływu',desc:'Szybsze pływanie, skok -6%.',mods:{waterMoveSpeedMult:0.78,jumpPowerMult:0.94}},
	luminous:{label:'Protokół Światła',desc:'Większy zasięg widzenia, kopanie -6%.',mods:{visionRadius:12,mineSpeedMult:0.94}}
});
export function sanitizeBoon(value){
	const key=String(value||'').trim().toLowerCase();
	return Object.prototype.hasOwnProperty.call(DESCENT_BOONS,key) ? key : '';
}
export function boonModifiersFor(value){
	const key=sanitizeBoon(value);
	return key ? Object.assign({},DESCENT_BOONS[key].mods) : null;
}

function safeDecode(s){ try{ return decodeURIComponent(s); }catch(e){ return s; } }

// ?seed=… is the anchor: mods without a seed are not a challenge (they would
// not be reproducible). Unknown mods are dropped, duplicates collapse, order
// follows the table so equivalent links canonicalize identically.
export function parseChallenge(search){
	let q = String(search || '');
	if(q.startsWith('?')) q = q.slice(1);
	let seed = null, boon=''; const raw = [];
	for(const part of q.split('&')){
		const eq = part.indexOf('=');
		const k = eq >= 0 ? part.slice(0, eq) : part;
		const v = eq >= 0 ? safeDecode(part.slice(eq + 1)) : '';
		if(k === 'seed') seed = normalizeWorldSeed(v);
		else if(k === 'mods') for(const m of String(v).slice(0, 200).split(',')) raw.push(m.trim().toLowerCase());
		else if(k === 'boon') boon=sanitizeBoon(v);
	}
	if(seed === null) return null;
	const mods = Object.keys(CHALLENGE_MODS).filter(k => raw.includes(k));
	return Object.assign({seed,mods},boon?{boon}:{});
}

export function challengeLink(base, seed, mods, boon){
	const b = String(base || '').split(/[?#]/)[0];
	const s = normalizeWorldSeed(seed);
	if(!s) return null;
	const list = sanitizeMods(mods);
	const protocol=sanitizeBoon(boon);
	return b + '?seed=' + s + (list.length ? '&mods=' + list.join(',') : '') + (protocol ? '&boon='+protocol : '');
}

export function sanitizeMods(mods){
	if(!Array.isArray(mods)) return [];
	return Object.keys(CHALLENGE_MODS).filter(k => mods.includes(k));
}

// Pure derivations — each consumer seam reads ONE of these, so a mod stays a
// table row instead of a scatter of ifs. All return neutral/null without mods.
export function applyWorldMods(settings, mods){
	const out = Object.assign({}, settings);
	for(const m of sanitizeMods(mods)){
		const def = CHALLENGE_MODS[m];
		if(def.world) Object.assign(out, def.world);
	}
	return out;
}
export function spawnTuningFor(mods){
	let intervalDiv = 1, capMult = 1;
	for(const m of sanitizeMods(mods)){
		const s = CHALLENGE_MODS[m].spawn;
		if(s){ intervalDiv *= s.intervalDiv || 1; capMult *= s.capMult || 1; }
	}
	return (intervalDiv !== 1 || capMult !== 1) ? { intervalDiv, capMult } : null;
}
export function combatTuningFor(mods){
	let heroDamageInMult = 1;
	for(const m of sanitizeMods(mods)){
		const c = CHALLENGE_MODS[m].combat;
		if(c) heroDamageInMult *= c.heroDamageInMult || 1;
	}
	return heroDamageInMult !== 1 ? { heroDamageInMult } : null;
}
export function nightOverrideFor(mods){
	for(const m of sanitizeMods(mods)){
		if(typeof CHALLENGE_MODS[m].nightT === 'number') return CHALLENGE_MODS[m].nightT;
	}
	return null;
}
export function craftBansFor(mods){
	const out = [];
	for(const m of sanitizeMods(mods)){
		const b = CHALLENGE_MODS[m].craftBan;
		if(Array.isArray(b)) for(const s of b) if(!out.includes(s)) out.push(s);
	}
	return out;
}
export function lootTuningFor(mods){
	let dropChanceMult = 1;
	for(const m of sanitizeMods(mods)){
		const l = CHALLENGE_MODS[m].loot;
		if(l) dropChanceMult *= l.dropChanceMult || 1;
	}
	return dropChanceMult !== 1 ? { dropChanceMult } : null;
}
export function ironmanFor(mods){
	return sanitizeMods(mods).some(m => CHALLENGE_MODS[m].ironman === true);
}

// ============================ RUNTIME (browser) ============================

// The main-save key is main.js's SAVE_KEY — the sim test cross-checks the two
// stay literally equal. A challenge link must never silently destroy a save.
const SAVE_KEY = 'mm_save_v7';
// The curse sticks to the RUN: adopted once on a fresh boot, remembered under a
// run-scoped mm_ key (clearActiveGameStorage wipes it with the world), so a
// mid-game reload keeps endless night instead of quietly lifting it.
export const CHALLENGE_RUN_KEY = 'mm_challenge_v1';

function sanitizeChallenge(c){
	if(!c || typeof c !== 'object') return null;
	const seed = normalizeWorldSeed(c.seed);
	if(!seed) return null;
	const out = { seed, mods: sanitizeMods(c.mods) };
	const boon=sanitizeBoon(c.boon);
	if(boon) out.boon=boon;
	if(c.failed) out.failed = 1; // ironman verdict survives reloads with the run
	return out;
}

// The pause panel hands a PENDING challenge across the new-game reload through
// a one-shot sessionStorage key (mirroring the seed queue): localStorage is
// purged twice on that path (startNewGame + the pagehide re-purge), so only
// session scope survives to the fresh boot.
export const CHALLENGE_NEXT_KEY = 'mm_challenge_next_v1';

const parsed = (typeof location !== 'undefined') ? parseChallenge(location.search) : null;
// spectators live in the HOST's world (stream + welcome mods) — their own URL
// params must not fork a local worldgen under the replica
const isWatch = (typeof location !== 'undefined') && /[?&]watch=/.test(location.search);
let hasSave = false, runChal = null, nextChal = null;
try{ hasSave = !!(typeof localStorage !== 'undefined' && localStorage.getItem(SAVE_KEY)); }catch(e){ /* boot decides fresh */ }
try{ runChal = sanitizeChallenge(JSON.parse(localStorage.getItem(CHALLENGE_RUN_KEY) || 'null')); }catch(e){ runChal = null; }
try{
	if(typeof sessionStorage !== 'undefined'){
		nextChal = sanitizeChallenge(JSON.parse(sessionStorage.getItem(CHALLENGE_NEXT_KEY) || 'null'));
		sessionStorage.removeItem(CHALLENGE_NEXT_KEY); // one-shot, like the seed queue
	}
}catch(e){ nextChal = null; }

let active = null, pending = null;
if(!isWatch){
	const fresh = nextChal || parsed; // an explicit new-game handoff outranks the address bar
	if(fresh && !hasSave){
		active = fresh; // fresh profile adopts the challenge and the run remembers it
		try{ localStorage.setItem(CHALLENGE_RUN_KEY, JSON.stringify(active)); }catch(e){ /* session-only curse */ }
	} else if(runChal && hasSave){
		active = runChal; // resuming the cursed run (seed comes from the save)
		pending = (parsed && parsed.seed !== runChal.seed) ? parsed : null;
	} else if(parsed){
		pending = parsed; // a link over an existing normal save: offer, never destroy
	} else if(runChal){
		try{ localStorage.removeItem(CHALLENGE_RUN_KEY); }catch(e){} // profile wiped elsewhere — stale curse
	}
}
export const activeChallenge = active;
export const pendingChallenge = pending;

// --- Zejście Warstw --------------------------------------------------------
// The story is literally about layers of a simulation, and finale.js already
// minted mm_layers_v1.completions that NOTHING read. Descending turns that dead
// counter into the endgame loop: layer N boots from a derived seed with a
// growing, deterministic set of the mods that already exist (never new ones),
// plus a hostility floor.
//
// Pure and seeded: the same (layer, baseSeed) always yields the same world, so a
// descent is shareable as an ordinary ?seed&mods link — no new protocol.
const DESCENT_ORDER = Object.freeze(Object.keys(CHALLENGE_MODS));
export function descentSeed(layer, baseSeed){
	const n = Math.max(1, Math.floor(Number(layer) || 1));
	const s = Math.floor(Number(baseSeed) || 0);
	// a cheap, stable mix — deterministic across host and every guest
	let h = (s ^ 0x9e3779b9) >>> 0;
	for(let i = 0; i < n; i++){
		h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
		h = (h + 0x165667b1 + i) >>> 0;
	}
	return h % 1000000000;
}
export function descentFor(layer, baseSeed){
	const n = Math.max(1, Math.floor(Number(layer) || 1));
	const seed = descentSeed(n, baseSeed);
	// one extra curse per layer, drawn in a seeded order from the SAME whitelist
	// the link parser accepts — a descent can never mint an unknown mod
	const want = Math.min(DESCENT_ORDER.length, n - 1);
	const picked = [];
	let cursor = descentSeed(n + 7, baseSeed);
	const pool = DESCENT_ORDER.slice();
	while(picked.length < want && pool.length){
		cursor = Math.imul(cursor ^ (cursor >>> 13), 0xc2b2ae35) >>> 0;
		const [taken] = pool.splice(cursor % pool.length, 1);
		// permanight and permaday are mutually exclusive by their own table note
		if(taken === 'permaday' && picked.includes('permanight')) continue;
		if(taken === 'permanight' && picked.includes('permaday')) continue;
		picked.push(taken);
	}
	const boonPool=Object.keys(DESCENT_BOONS);
	const boonChoices=[];
	let boonCursor=descentSeed(n+31,baseSeed);
	while(boonChoices.length<3&&boonPool.length){
		boonCursor=Math.imul(boonCursor^(boonCursor>>>16),0x27d4eb2d)>>>0;
		boonChoices.push(boonPool.splice(boonCursor%boonPool.length,1)[0]);
	}
	return {
		layer: n,
		seed,
		mods: sanitizeMods(picked),
		// the descent floor composes with (never clobbers) the deeds axis and the
		// debug slider: world_hostility takes the MAX of ramp and floor
		hostilityFloor: Math.min(2.2, (n - 1) * 0.35),
		boonChoices
	};
}

export function queueNextChallenge(c){
	const clean = sanitizeChallenge(c);
	if(!clean || typeof sessionStorage === 'undefined') return false;
	try{ sessionStorage.setItem(CHALLENGE_NEXT_KEY, JSON.stringify(clean)); return true; }catch(e){ return false; }
}

// Ghost guests adopt the HOST's mods from the welcome packet: law/display
// parity for the shared world. Re-whitelisted here — the host is remote input.
let remoteMods = null, remoteBoon='';
function modsNow(){ return activeChallenge ? activeChallenge.mods : (remoteMods || []); }
function boonNow(){ return activeChallenge ? sanitizeBoon(activeChallenge.boon) : remoteBoon; }
// The derived tunings are consulted from hot paths (craft bans per recipe per
// panel render, combat per wound, loot per kill) — memoize them against the
// current mod set; the only invalidation point is a remote-mods adoption.
let derived = null;
function derivedNow(){
	if(!derived){
		const mods = modsNow();
		derived = {
			spawn: spawnTuningFor(mods), combat: combatTuningFor(mods),
			craftBans: craftBansFor(mods), loot: lootTuningFor(mods),
			night: nightOverrideFor(mods), ironman: ironmanFor(mods)
		};
	}
	return derived;
}
function applyNightLock(){
	const nightT = derivedNow().night;
	if(nightT == null || typeof window === 'undefined') return;
	// the existing time-override seam: timeInfo() and the sky renderer both
	// honor it, so invasions/mobs/HUD all live under the same endless night
	window.__timeOverrideActive = true;
	window.__timeOverrideValue = nightT;
}
// World-shaping remote mods must reach the GUEST's generator too: the replica
// streams the host's modified chunks, but ungenerated terrain regenerates
// locally from the seed — with unmodded settings it would diverge from the
// host's drought/maze world the moment a guest wanders past the stream.
function applyRemoteWorldMods(){
	if(typeof window === 'undefined' || !MMR || !MMR.worldGen || !MMR.worldGen.settings) return;
	const mods = modsNow();
	if(!mods.length) return;
	const patched = applyWorldMods(MMR.worldGen.settings, mods);
	if(JSON.stringify(patched) === JSON.stringify(MMR.worldGen.settings)) return;
	MMR.worldGen.settings = patched; // in-memory only (the lockdown blocks persistence anyway)
	try{ if(MMR.worldGen.clearCaches) MMR.worldGen.clearCaches(); }catch(e){ /* lazy rebuild */ }
	try{ if(MMR.world && MMR.world.clearHeights) MMR.world.clearHeights(); }catch(e){ /* lazy rebuild */ }
}
function setRemoteMods(list){
	// cap before sanitizing: a hostile host's million-entry array must cost
	// nothing (sanitize scans the table against the list per key)
	const capped = Array.isArray(list) ? list.slice(0, 24) : [];
	remoteMods = activeChallenge ? null : sanitizeMods(capped); // own challenge outranks the wire
	derived = null;
	applyNightLock();
	applyRemoteWorldMods();
	return remoteMods ? remoteMods.slice() : [];
}
function setRemoteBoon(value){
	remoteBoon=activeChallenge ? '' : sanitizeBoon(value);
	try{ if(MMR&&MMR.recomputeModifiers) MMR.recomputeModifiers(); }catch(e){}
	return remoteBoon;
}
applyNightLock();

// The ironman verdict: a real death voids the run's honor. Non-destructive by
// design — the world survives, only the challenge marker records the failure.
// Own-run only (activeChallenge): a guest mirroring host mods never marks, and
// a spectator page could not persist it through the lockdown anyway.
let runFailed = !!(active && active.failed);
function markFailed(){
	if(!activeChallenge || runFailed || !ironmanFor(activeChallenge.mods)) return false;
	runFailed = true;
	try{ localStorage.setItem(CHALLENGE_RUN_KEY, JSON.stringify(Object.assign({}, activeChallenge, { failed: 1 }))); }catch(e){ /* session-only verdict */ }
	return true;
}

const api = {
	MODS: CHALLENGE_MODS,
	BOONS: DESCENT_BOONS,
	active: activeChallenge,
	pending: pendingChallenge,
	list: () => modsNow().slice(),
	has: (m) => modsNow().includes(m),
	link: (base) => challengeLink(base, (MMR && MMR.worldGen) ? MMR.worldGen.worldSeed : 0, modsNow(),boonNow()),
	setRemoteMods,
	setRemoteBoon,
	queueNext: queueNextChallenge,
	nightLock: () => derivedNow().night, // ui.js's debug slider must not clobber the curse
	spawnTuning: () => derivedNow().spawn,
	combatTuning: () => derivedNow().combat,
	craftBans: () => derivedNow().craftBans,
	lootTuning: () => derivedNow().loot,
	isIronman: () => derivedNow().ironman,
	markFailed,
	failed: () => runFailed,
	boon:()=>boonNow(),
	boonModifiers:()=>boonModifiersFor(boonNow()),
	parseChallenge, challengeLink, applyWorldMods, sanitizeMods, sanitizeBoon, boonModifiersFor,
	descentFor, descentSeed
};
if(MMR) MMR.challenge = api;
export const challenge = api;
export default challenge;
