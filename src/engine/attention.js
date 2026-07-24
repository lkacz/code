// Uwaga Warstwy — the deeds axis.
//
// Difficulty was decided by ONE input: |x|. Travel far, meet hard things; stay
// home, stay safe forever. Day 200 at spawn felt exactly like day 5, because
// nothing you DID ever mattered — only where you stood.
//
// This is a single scalar that rises with what you have TAKEN from the world
// (guardian hearts, bosses, tonnes of ore, looted craters) and feeds the one
// difficulty gradient ~15 systems already read, through the `floor` term added
// to world_hostility. One number in, fifteen existing consumers out, zero new
// content — the cheapest possible late-game escalation.
//
// Deliberately legible: it announces itself in omen lines rather than a bar, so
// a rising world reads as the simulation noticing you, not the game cheating.
//
// Host-side world law. It needs no stream plane of its own: it changes nothing
// a guest reads directly, only the spawn/strength decisions the host already
// makes and streams through the mobs/invasions planes.
const root = (typeof window !== 'undefined') ? window : globalThis;
root.MM = root.MM || {};

// What the world notices, and how much. Weights are per EVENT, normalized
// against FULL below — mining a tonne of stone should never rival killing a
// guardian, but a long greedy run of it still adds up.
// Only kinds with a live emitter belong here — an unwired weight is a promise
// the world never keeps. Adding one is a two-line change: a weight plus a
// note() call at the deed's existing chokepoint.
export const DEEDS = {
  ore: 0.6,          // a mined ore tile        (main.js, the shared break hook)
  guardian: 260,     // a guardian heart taken  (progress.markGuardianHeart)
  invasion: 55,      // an invasion broken      (invasions.defeatTeam)
};
const FULL = 4200;   // total weight for a fully-noticed world
const MAX_FLOOR = 2.2;
const DECAY_PER_DAY = 0.012;  // the layer slowly forgets a quiet player

let score = 0;
let lastDay = null;
let announced = 0;
let notifier = null;

function clamp(v, a, b){ return v < a ? a : (v > b ? b : v); }

// 0..1 — how much of the world's attention you hold.
export function level(){ return clamp(score / FULL, 0, 1); }
// The hostility floor this attention justifies.
export function floorFor(lv){ return clamp((lv === undefined ? level() : lv), 0, 1) * MAX_FLOOR; }

// Omen lines: the ONLY way this system talks. Crossing a threshold says so once.
const OMENS = [
  { at: 0.22, text: '👁 Coś w warstwie zwróciło na ciebie uwagę.' },
  { at: 0.45, text: '👁 Warstwa cię pamięta — świat twardnieje wszędzie, nie tylko na krańcach.' },
  { at: 0.70, text: '👁 Zabrałeś zbyt wiele. Nawet dom przestaje być bezpieczny.' },
  { at: 0.90, text: '👁 Symulacja patrzy wprost na ciebie.' },
];

function push(){
  try{
    if(root.MM.worldHostility && root.MM.worldHostility.setTuning){
      root.MM.worldHostility.setTuning({ floor: floorFor() });
    }
  }catch(e){ /* hostility not loaded */ }
}

function announce(){
  const lv = level();
  for(let i = OMENS.length - 1; i >= 0; i--){
    if(lv >= OMENS[i].at && announced <= i){
      announced = i + 1;
      const line = OMENS[i].text;
      try{ if(typeof notifier === 'function') notifier(line); else if(root.msg) root.msg(line); }catch(e){}
      return;
    }
  }
}

// Record a deed. Unknown kinds are ignored rather than trusted, and the caller
// can never push the score past the cap in one call.
export function note(kind, count){
  const w = DEEDS[kind];
  if(!Number.isFinite(w)) return level();
  const n = clamp(Math.floor(Number(count) || 1), 1, 500);
  score = clamp(score + w * n, 0, FULL * 1.5);
  push();
  announce();
  return level();
}

// Quiet days let the layer lose interest — and the altar/trader can buy it down.
export function relieve(amount){
  const a = Math.max(0, Number(amount) || 0);
  score = clamp(score - FULL * a, 0, FULL * 1.5);
  announced = 0;
  push();
  return level();
}

export function update(dayFloat){
  const d = Number(dayFloat);
  if(!Number.isFinite(d)) return level();
  if(lastDay != null && d > lastDay){
    score = clamp(score - FULL * DECAY_PER_DAY * (d - lastDay), 0, FULL * 1.5);
    push();
  }
  lastDay = d;
  return level();
}

export function setNotifier(fn){ notifier = typeof fn === 'function' ? fn : null; }
export function reset(){ score = 0; lastDay = null; announced = 0; push(); }
export function snapshot(){ return { v: 1, score: +score.toFixed(2), announced }; }
export function restore(data){
  score = 0; announced = 0;
  if(data && typeof data === 'object'){
    const s = Number(data.score);
    if(Number.isFinite(s)) score = clamp(s, 0, FULL * 1.5);
    const a = Number(data.announced);
    if(Number.isFinite(a)) announced = clamp(Math.floor(a), 0, OMENS.length);
  }
  push();
  return true;
}
export function metrics(){
  return { level: +level().toFixed(3), floor: +floorFor().toFixed(3), score: +score.toFixed(1), announced };
}

export const attention = { DEEDS, OMENS, level, floorFor, note, relieve, update, reset, snapshot, restore, metrics, setNotifier };
root.MM.attention = attention;
export default attention;
