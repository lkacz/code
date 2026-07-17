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
	maze:       { label: 'Labirynt jaskiń', desc: 'Grunt podziurawiony jak plaster miodu.',
		world: { caveDensity: 1.6, tunnelDensity: 1.7, ravineFreq: 1.8 } },
	permanight: { label: 'Wieczna noc',     desc: 'Słońce nie wschodzi. Nocne prawa świata trwają bez końca.',
		nightT: 0.85 },
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

function safeDecode(s){ try{ return decodeURIComponent(s); }catch(e){ return s; } }

// ?seed=… is the anchor: mods without a seed are not a challenge (they would
// not be reproducible). Unknown mods are dropped, duplicates collapse, order
// follows the table so equivalent links canonicalize identically.
export function parseChallenge(search){
	let q = String(search || '');
	if(q.startsWith('?')) q = q.slice(1);
	let seed = null; const raw = [];
	for(const part of q.split('&')){
		const eq = part.indexOf('=');
		const k = eq >= 0 ? part.slice(0, eq) : part;
		const v = eq >= 0 ? safeDecode(part.slice(eq + 1)) : '';
		if(k === 'seed') seed = normalizeWorldSeed(v);
		else if(k === 'mods') for(const m of String(v).slice(0, 200).split(',')) raw.push(m.trim().toLowerCase());
	}
	if(seed === null) return null;
	const mods = Object.keys(CHALLENGE_MODS).filter(k => raw.includes(k));
	return { seed, mods };
}

export function challengeLink(base, seed, mods){
	const b = String(base || '').split(/[?#]/)[0];
	const s = normalizeWorldSeed(seed);
	if(!s) return null;
	const list = sanitizeMods(mods);
	return b + '?seed=' + s + (list.length ? '&mods=' + list.join(',') : '');
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

export function queueNextChallenge(c){
	const clean = sanitizeChallenge(c);
	if(!clean || typeof sessionStorage === 'undefined') return false;
	try{ sessionStorage.setItem(CHALLENGE_NEXT_KEY, JSON.stringify(clean)); return true; }catch(e){ return false; }
}

// Ghost guests adopt the HOST's mods from the welcome packet: law/display
// parity for the shared world. Re-whitelisted here — the host is remote input.
let remoteMods = null;
function modsNow(){ return activeChallenge ? activeChallenge.mods : (remoteMods || []); }
function applyNightLock(){
	const nightT = nightOverrideFor(modsNow());
	if(nightT == null || typeof window === 'undefined') return;
	// the existing time-override seam: timeInfo() and the sky renderer both
	// honor it, so invasions/mobs/HUD all live under the same endless night
	window.__timeOverrideActive = true;
	window.__timeOverrideValue = nightT;
}
function setRemoteMods(list){
	remoteMods = activeChallenge ? null : sanitizeMods(list); // own challenge outranks the wire
	applyNightLock();
	return remoteMods ? remoteMods.slice() : [];
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
	active: activeChallenge,
	pending: pendingChallenge,
	list: () => modsNow().slice(),
	has: (m) => modsNow().includes(m),
	link: (base) => challengeLink(base, (MMR && MMR.worldGen) ? MMR.worldGen.worldSeed : 0, modsNow()),
	setRemoteMods,
	queueNext: queueNextChallenge,
	nightLock: () => nightOverrideFor(modsNow()), // ui.js's debug slider must not clobber the curse
	spawnTuning: () => spawnTuningFor(modsNow()),
	combatTuning: () => combatTuningFor(modsNow()),
	craftBans: () => craftBansFor(modsNow()),
	lootTuning: () => lootTuningFor(modsNow()),
	isIronman: () => ironmanFor(modsNow()),
	markFailed,
	failed: () => runFailed,
	parseChallenge, challengeLink, applyWorldMods, sanitizeMods
};
if(MMR) MMR.challenge = api;
export const challenge = api;
export default challenge;
