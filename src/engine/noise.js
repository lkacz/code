// Hałas — the world's fourth field.
//
// The engine already simulates light, heat, wind and temperature. It did NOT
// simulate SOUND: mob perception was a single distance test (`canSee = dist <=
// sight`), so a pick through obsidian and a barefoot crouch were identical to
// every creature in the world.
//
// This module is the missing sense, and deliberately nothing more:
//   * emitters call emit() from chokepoints that ALREADY exist (mining, blasts,
//     weapons, machines) — no new world write, no new tile, no new stream plane;
//   * consumers ask heardBy()/sightMult() beside the sight test they already run;
//   * a body that moves slowly emits nothing and is HARDER to see.
//
// It writes nothing to the world: the only durable consequence is mob aggro
// state, which the `mobs` plane already carries. That is why it needs neither a
// stream plane nor an hact intent — the emitters are inside chokepoints whose
// effects are already streamed.
//
// Pure and import-safe in Node (no DOM, no globals beyond MM registration), so
// every decision here is testable headless like hero_crush.js.
const root = (typeof window !== 'undefined') ? window : globalThis;
root.MM = root.MM || {};

export const CFG = {
  RING: 48,            // ring-buffer size: plenty for a busy frame, bounded forever
  TTL: 2.6,            // seconds a sound stays audible to a creature's memory
  MAX_RADIUS: 34,      // hard cap so nothing can wake a whole biome
  QUIET_SIGHT: 0.5,    // moving slowly halves the range you are spotted at
  QUIET_SPEED: 2.2,    // tiles/s at or below which a body counts as sneaking
  SPRINT_SPEED: 5.4,   // above this a body is loud all by itself
  STRIDE_WALK: 0.34,   // seconds between footfalls at a walk
  STRIDE_SPRINT: 0.22, // a sprint drums faster — but still not once per frame
  BACKSTAB_MULT: 2.35, // damage multiplier when striking an unaware creature from behind
  BACKSTAB_STUN: 0.85, // seconds of stun a backstab lands
  BACKSTAB_REAR_MARGIN: 0.12, // attacker must be clearly behind the facing axis
  // Per-cause loudness in tiles. Hardness-scaled mining is the big one: 150 tile
  // hardness values suddenly MEAN something because obsidian is loud and snow
  // is nearly silent.
  CAUSE: {
    mine: 9, place: 5, step: 4, sprint: 9, land: 7,
    blast: 30, shot: 12, melee: 8, machine: 11, shout: 16, decoy: 15,
  },
};

// The ring buffer. Fixed size, overwritten in place — a busy frame can never
// grow this, and nothing here is ever serialized.
const ring = new Array(CFG.RING).fill(null);
let head = 0;
let clock = 0;          // seconds, advanced by tick(); the only time source
let lastNoise = null;   // cheap accessor for QA/debug

function clamp(v, a, b){ return v < a ? a : (v > b ? b : v); }
function num(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }

export function tick(dt){
  const d = Number(dt);
  if(Number.isFinite(d) && d > 0) clock += d;
  return clock;
}

// Loudness for a cause, optionally scaled by material hardness (mining) or an
// explicit strength. Always clamped — a caller can never mint a world-waking bang.
export function radiusFor(cause, strength){
  const base = CFG.CAUSE[cause];
  if(!Number.isFinite(base)) return 0;
  const s = Number.isFinite(Number(strength)) ? Math.max(0, Number(strength)) : 1;
  return clamp(base * s, 0, CFG.MAX_RADIUS);
}

// Record a sound at a point. Returns the radius actually emitted (0 = ignored),
// so callers can skip follow-up work when a sound was rejected.
export function emit(x, y, cause, strength, options){
  const r = radiusFor(cause, strength);
  if(!(r > 0)) return 0;
  // validate the RAW input: num() would quietly coerce NaN to 0 and place a
  // phantom sound at the origin
  const px = Number(x), py = Number(y);
  if(!Number.isFinite(px) || !Number.isFinite(py)) return 0;
  const n = ring[head] || (ring[head] = { x: 0, y: 0, r: 0, at: 0, cause: '', actor: 'world' });
  n.x = px; n.y = py; n.r = r; n.at = clock; n.cause = String(cause || '');
  n.actor=String(options&&options.actor||'world').slice(0,32);
  head = (head + 1) % CFG.RING;
  lastNoise = n;
  return r;
}

// The ambient noise FLOOR. A storm, a sandstorm or a gale drowns quiet sounds —
// this is the release valve that keeps deep mining playable in bad weather and
// makes a storm real tactical cover rather than just weather. 0..1.
export function floorLevel(){
  let f = 0;
  try{
    const w = root.MM && root.MM.wind;
    if(w && w.speed) f = Math.max(f, Math.min(1, Math.abs(Number(w.speed()) || 0) / 7.2) * 0.7);
  }catch(e){ /* wind not loaded */ }
  try{
    const s = root.MM && root.MM.sandstorm;
    if(s && s.intensity) f = Math.max(f, Math.min(1, Number(s.intensity()) || 0) * 0.85);
  }catch(e){ /* sandstorm not loaded */ }
  return clamp(f, 0, 1);
}

// A creature's hearing. Returns the LOUDEST live sound that reaches it, or null.
// `keen` (spec.keenEars) widens the ear; deaf specs opt out entirely.
export function heardBy(x, y, opts){
  const ex = num(x), ey = num(y);
  const keen = opts && Number.isFinite(Number(opts.keen)) ? Math.max(0, Number(opts.keen)) : 1;
  if(!(keen > 0)) return null;
  // weather masks the quiet end of the spectrum: in a gale only loud things carry
  const mask = 1 - floorLevel() * 0.6;
  let best = null, bestScore = 0;
  for(let i = 0; i < ring.length; i++){
    const n = ring[i];
    if(!n || !n.r) continue;
    const age = clock - n.at;
    if(age < 0 || age > CFG.TTL) continue;
    const reach = n.r * keen * mask;
    if(!(reach > 0)) continue;
    const dx = n.x - ex, dy = n.y - ey;
    const d2 = dx * dx + dy * dy;
    if(d2 > reach * reach) continue;
    // nearer + louder + fresher wins; a faint distant tap loses to a close blast
    const score = (1 - Math.sqrt(d2) / reach) * n.r * (1 - age / CFG.TTL);
    if(score > bestScore){ bestScore = score; best = n; }
  }
  return best ? {
    x: best.x,
    y: best.y,
    cause: best.cause,
    r: best.r,
    score: bestScore,
    at: best.at,
    actor: best.actor||'world'
  } : null;
}

// How visible a body is right now. Slow movement halves the range it is spotted
// at; a sprint is fully visible. Takes a BODY-LIKE param (never window.player)
// so guest bodies in MM.coopBodies get the same treatment — CLAUDE.md rule 3.
export function sightMult(body){
  if(!body) return 1;
  if(body.quiet === true) return CFG.QUIET_SIGHT;
  if(body.quiet === false) return 1;
  const sp = Math.hypot(num(body.vx), num(body.vy));
  if(sp <= CFG.QUIET_SPEED) return CFG.QUIET_SIGHT;
  return 1;
}

// Is this body sneaking? (the emitter side of the same question)
export function bodyQuiet(body){
  if(!body) return false;
  if(body.quiet === true) return true;
  if(body.quiet === false) return false;
  return Math.hypot(num(body.vx), num(body.vy)) <= CFG.QUIET_SPEED;
}

// Movement noise for one body this frame: silence while sneaking, a footfall at
// a walk, a broadcast at a sprint. Callers pass their own body — solo passes the
// hero, the host loop also sweeps MM.coopBodies.
export function emitMovement(body){
  if(!body || bodyQuiet(body)) return 0;
  const sp = Math.hypot(num(body.vx), num(body.vy));
  if(sp <= 0.05) return 0;
  const sprinting = sp >= CFG.SPRINT_SPEED;
  // A STRIDE, not a frame. Emitting every frame filled the 48-slot ring with a
  // single walking body's own footsteps within ~0.8s, so the TTL silently became
  // "48 frames" and a blast was evicted before any creature could hear it.
  const stride = sprinting ? CFG.STRIDE_SPRINT : CFG.STRIDE_WALK;
  if(clock - (body._stepAt || -Infinity) < stride) return 0;
  body._stepAt = clock;
  const remote=!!(body.gid || body.coopOwner || body.kind==='coop');
  return emit(
    body.x,
    body.y,
    sprinting ? 'sprint' : 'step',
    sprinting ? 1 : 0.75,
    {actor:remote?'remote-hero':'local-hero'}
  );
}

// A creature is unaware when it has neither seen nor heard you AND has not yet
// been touched this life. The last clause is what makes this a genuine AMBUSH
// rather than a permanent damage multiplier: `_aggro` is only ever set for
// HOSTILE creatures, so without it every passive animal would count as unaware
// forever and every hit — including damage-over-time ticks — would be a
// backstab. One surprise per creature; after that it knows you are there.
export function isUnaware(mob){
  if(!mob || mob._hurtOnce) return false;
  return !mob._aggro && !mob._noticed && !mob._investigate;
}

// Facing is horizontal in this 2D world. The stable draw-facing wins when it is
// available, so the rule agrees with what the player can actually see: facing
// right means the rear half-plane is left, and vice versa. A small dead zone
// prevents an attacker inside a large creature from counting as "behind" while
// positions jitter between frames.
export function isBehind(mob, attacker){
  if(!mob || !attacker) return false;
  const mx=Number(mob.x), ax=Number(attacker.x);
  if(!Number.isFinite(mx) || !Number.isFinite(ax)) return false;
  const facing=(mob._stableFacing===-1 || mob._stableFacing===1)
    ? mob._stableFacing
    : (mob.facing<0?-1:1);
  return (ax-mx)*facing < -CFG.BACKSTAB_REAR_MARGIN;
}

export function canBackstab(mob, attacker){
  return isUnaware(mob) && isBehind(mob,attacker);
}

export function reset(){
  for(let i = 0; i < ring.length; i++) ring[i] = null;
  head = 0; clock = 0; lastNoise = null;
}

export function metrics(){
  let live = 0;
  for(const n of ring){ if(n && n.r && clock - n.at <= CFG.TTL) live++; }
  return { live, clock: +clock.toFixed(2), last: lastNoise ? lastNoise.cause : null };
}

export const noise = { CFG, tick, emit, radiusFor, heardBy, sightMult, bodyQuiet, emitMovement, isUnaware, isBehind, canBackstab, floorLevel, reset, metrics };
root.MM.noise = noise;
export default noise;
