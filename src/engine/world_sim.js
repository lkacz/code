// Zegar świata — the far-world simulation clock.
//
// THE INVARIANT THIS MODULE EXISTS TO ENFORCE:
//   frame cost = O(what is near the players) + fixed budgets. Never O(world).
//
// Before it, every machine registry iterated ALL of its machines every frame.
// The distance-gated ones (dynamo, solar, teleporters, turrets) still gave far
// machines an accumulated 1 Hz step — a full work step with tile reads, which
// after the parked-restore wave also kept rehydrating cold chunks — and the
// ungated ones (kiln, pumps, steam, vending) ran everything at full rate
// everywhere. Frame cost grew with how much the player had ever built, which is
// exactly the curve that produced the historical FPS decay.
//
// The model here is the one Vintage Story ships and the Unloaded Activity mod
// retrofits onto Minecraft: a region the players cannot see is FROZEN — zero
// work, zero tile reads — and the moment it comes back into range it CATCHES UP
// through the same closed-form math its live tick uses, fed one large dt
// instead of thousands of small ones. Accumulators (energy, heat, firing
// progress) are rate×dt integrations with capacity clamps, so one big step is
// exactly equivalent to the sum of small ones. Chaotic neighbors-coupled
// systems (water, fire, sand, mobs) stay frozen and settle through their
// existing audits — no closed form exists for them, which is the same boundary
// the Unloaded Activity author documents for copper and freezing water.
//
// This module owns the three primitives everything else composes:
//   * the world sim CLOCK (seconds of simulated time; pauses when the game
//     does, persists in the save, and can `skip()` across a throttled-tab gap);
//   * the HOT SET (the union of windows around the host hero and every
//     embodied co-op guest — CLAUDE.md rule 3: far-world policy must consult
//     MM.coopBodies, exactly like the mob eco pass);
//   * per-region STALENESS stamps (one number per 64×70 tile region recording
//     when it was last simulated, so a wake knows how much time to pay back).
//
// Modules use ONE call in their machine loops:
//     const step = SIM ? SIM.wakeDt(dt, m.x, m.y, WAKE_MAX) : dt;
//     if(step === null) continue;   // far: frozen — not even a tile read
//     ...normal tick with `step` as the dt...
// wakeDt returns dt for a continuously-hot machine, dt+lag (capped) for one
// whose region just woke, and null for a far one. With no worldSim present
// (Node suites that import a single module) it never gates — legacy behavior.
//
// The stamp map is the module's only growing state: one entry per region ever
// simulated. A 32 000-column excavation is ~500 base regions; the cap below is
// 40× that. Eviction drops the OLDEST stamps — a region whose stamp was evicted
// wakes with zero lag, i.e. it forfeits catch-up rather than fabricating it.
import { CHUNK_W, WORLD_SECTION_H } from '../constants.js';

(function(){
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const MM = root.MM = root.MM || {};

  const CFG = {
    HOT_RX: 72,            // superset of every legacy per-module ACTIVE window
    HOT_RY: 46,
    // Noise guard only. A continuously-hot machine's lag is EXACTLY zero (its
    // stamp is the same float that becomes prevNow), so anything above this is
    // real missed time and must be credited. The first version used 1.5 s here
    // and an audit proved by execution that a 0.4 s frame hitch and a 1 s
    // window-edge flicker were both silently forfeited — endFrame re-stamps
    // whether or not wakeDt paid the debt out.
    WAKE_MIN_LAG: 0.05,
    WAKE_MAX_DEFAULT: 900, // modules pass their own cap; this is the fallback
    // Snapshot ages clamp here: every module wake cap is ≤3600 s, so beyond
    // twice that all debts look identical — no reason to serialize huge floats.
    SNAPSHOT_AGE_CAP: 7200,
    STAMP_CAP: 20000,
    MAX_WINDOWS: 16        // host + MAX_GHOSTS embodied guests, with slack
  };

  let now = 0;        // seconds of simulated world time (persisted)
  let prevNow = 0;    // `now` before this frame's advance — staleness baseline
  let tracking = false;
  const stamps = new Map();       // "cx,sy" -> sim-second the region was last hot
  const windows = [];             // {x,y} — hero + embodied co-op bodies
  const hotRegions = new Set();   // this frame's hot region keys — THE hotness truth
  const metricsState = { wakes: 0, frozenSkips: 0, stampWrites: 0, evictions: 0 };

  const rKey = (cx,sy) => cx + ',' + sy;
  const colOf = (x) => Math.floor(x / CHUNK_W);
  const secOf = (y) => Math.floor(y / WORLD_SECTION_H);

  // ---------------------------------------------------------------- frame
  function beginFrame(dt, hero, bodies){
    dt = Number(dt);
    if(!(dt > 0) || !isFinite(dt)) dt = 0;
    prevNow = now;
    now += dt;
    windows.length = 0;
    if(hero && Number.isFinite(hero.x) && Number.isFinite(hero.y)) windows.push({x: hero.x, y: hero.y});
    if(bodies && windows.length){
      for(const b of bodies){
        if(windows.length >= CFG.MAX_WINDOWS) break;
        if(b && !b.dead && Number.isFinite(b.x) && Number.isFinite(b.y)) windows.push({x: b.x, y: b.y});
      }
    }
    tracking = windows.length > 0;
    // Hotness lives at REGION granularity, precomputed once per frame: a machine
    // is hot iff its region is in this set, and endFrame stamps exactly this
    // set. Hotness and stamps sharing one granularity is a correctness
    // requirement, not a convenience — an early version tested machines by
    // their own coordinates while stamping whole regions, and a region only
    // PARTIALLY covered by a window got a fresh stamp while machines in its far
    // half stayed frozen: their staleness read as zero and the catch-up they
    // were owed silently evaporated.
    hotRegions.clear();
    for(const w of windows){
      const cx0 = colOf(w.x - CFG.HOT_RX), cx1 = colOf(w.x + CFG.HOT_RX);
      const sy0 = secOf(w.y - CFG.HOT_RY), sy1 = secOf(w.y + CFG.HOT_RY);
      for(let cx = cx0; cx <= cx1; cx++){
        for(let sy = sy0; sy <= sy1; sy++) hotRegions.add(rKey(cx, sy));
      }
    }
  }
  // Stamping happens at frame END, after every module ran its updates: during
  // the frame ALL modules must read the same pre-frame staleness, or the first
  // module to run would steal the lag from the rest.
  function endFrame(){
    if(!tracking) return;
    for(const k of hotRegions){
      stamps.set(k, now);
      metricsState.stampWrites++;
    }
    if(stamps.size > CFG.STAMP_CAP) evictOldest();
  }
  function evictOldest(){
    const rows = [...stamps.entries()].sort((a,b) => a[1] - b[1]);
    const drop = Math.max(1, (CFG.STAMP_CAP * 0.1) | 0);
    for(let i = 0; i < drop && i < rows.length; i++) stamps.delete(rows[i][0]);
    metricsState.evictions += Math.min(drop, rows.length);
  }
  // A throttled tab accumulates unsimulated wall time. Jumping the clock
  // WITHOUT stamping makes every hot region stale by the gap, so the very next
  // frame pays it back through the same wake path far regions use — one
  // mechanism, no double credit (this replaced main.js's per-module catch-up
  // fan-out, which would have credited hot machines a second time).
  function skip(gap){
    gap = Number(gap);
    if(!(gap > 0) || !isFinite(gap)) return false;
    now += gap;
    return true;
  }

  // ---------------------------------------------------------------- queries
  function isHot(x, y){
    if(!tracking) return true;   // no windows (tests, ghost boot) — never gate
    return hotRegions.has(rKey(colOf(x), secOf(y)));
  }
  function staleSeconds(x, y){
    if(!tracking) return 0;
    const s = stamps.get(rKey(colOf(x), secOf(y)));
    // A region never simulated owes nothing: machines there were registered
    // while hot (placement, discovery scans), so an unknown stamp means "new
    // ground", not "ancient debt". Fabricating lag here would mint resources.
    if(s === undefined) return 0;
    return Math.max(0, prevNow - s);
  }
  // The one-call module seam. null = frozen (skip the machine entirely).
  // One region key serves both the hot check and the stamp lookup — this runs
  // once per hot machine per frame, so the second string concat isHot+
  // staleSeconds would have paid was pure waste.
  function wakeDt(dt, x, y, wakeCap){
    if(!tracking) return dt;
    const k = rKey(colOf(x), secOf(y));
    if(!hotRegions.has(k)){ metricsState.frozenSkips++; return null; }
    const s = stamps.get(k);
    const lag = (s === undefined) ? 0 : (prevNow - s);
    if(lag <= CFG.WAKE_MIN_LAG) return dt;
    metricsState.wakes++;
    const cap = (Number.isFinite(wakeCap) && wakeCap > 0) ? wakeCap : CFG.WAKE_MAX_DEFAULT;
    return dt + Math.min(lag, cap);
  }

  // ---------------------------------------------------------------- state
  // Region keys are two signed integers — anything else in a restored snapshot
  // is noise and must not occupy capped map slots.
  const REGION_KEY_RE = /^-?\d{1,7},-?\d{1,3}$/;
  function snapshot(){
    // Ages, not absolute stamps: they stay meaningful if the clock is ever
    // rebased, they compress well (most regions share similar ages), and they
    // clamp at SNAPSHOT_AGE_CAP — past every module's wake cap all debts are
    // equal, so week-old floats would only bloat the manifest.
    const list = [];
    for(const [k, s] of stamps){
      if(list.length >= CFG.STAMP_CAP) break;
      list.push([k, +(Math.min(CFG.SNAPSHOT_AGE_CAP, Math.max(0, now - s))).toFixed(1)]);
    }
    return { v: 1, now: +now.toFixed(2), stamps: list };
  }
  function restore(data){
    reset();
    if(!data || typeof data !== 'object') return false;
    const t = Number(data.now);
    now = (Number.isFinite(t) && t >= 0) ? t : 0;
    prevNow = now;
    if(Array.isArray(data.stamps)){
      for(const row of data.stamps){
        if(stamps.size >= CFG.STAMP_CAP) break;
        if(!Array.isArray(row) || typeof row[0] !== 'string' || !REGION_KEY_RE.test(row[0])) continue;
        const age = Number(row[1]);
        if(!Number.isFinite(age) || age < 0) continue;
        stamps.set(row[0], now - Math.min(CFG.SNAPSHOT_AGE_CAP, age));
      }
    }
    return true;
  }
  function reset(){
    now = 0; prevNow = 0; tracking = false;
    stamps.clear(); windows.length = 0; hotRegions.clear();
    metricsState.wakes = 0; metricsState.frozenSkips = 0; metricsState.stampWrites = 0; metricsState.evictions = 0;
  }
  function metrics(){
    return {
      now: +now.toFixed(2),
      tracking,
      windows: windows.length,
      stamps: stamps.size,
      wakes: metricsState.wakes,
      frozenSkips: metricsState.frozenSkips,
      evictions: metricsState.evictions
    };
  }

  const api = {
    beginFrame, endFrame, skip,
    isHot, staleSeconds, wakeDt,
    now: () => now,
    tracking: () => tracking,
    snapshot, restore, reset, metrics,
    CFG,
    _debug: { stamps, windows, hotRegions, colOf, secOf }
  };
  MM.worldSim = api;
})();

export const worldSim = (typeof window !== 'undefined' && window.MM) ? window.MM.worldSim : (globalThis.MM && globalThis.MM.worldSim);
export default worldSim;
