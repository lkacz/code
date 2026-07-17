// Head antennas (gear kind 'antenna'): a springy physics rod mounted on the
// hero's head plus the active-power framework behind the Q key / #antennaChip.
//
// Item contract (function purity, see inventory.js KIND_STAT_PRIORITY): a
// passive antenna carries EXACTLY ONE numeric stat (visionRadius, attackDamage
// or damageReductionBonus — all flow through MM.activeModifiers untouched by
// this module); an active antenna carries ONLY the `antennaActive` identity
// string. The NUMBERS of every active (duration, cooldown, energy, ranges)
// live in the ACTIVES table below — multiplayer trust: a hero guest may only
// NAME an active (+ its tier), the host reads durations from ITS OWN copy of
// this table (ghost_host consults MM.antennas.ACTIVES/durationFor).
//
// Actives:
//   cloak — a few seconds of invisibility: sighted creatures stop targeting
//           the hero (mobs.js consults cloaked() at its target-selection
//           chokepoint; attacks are allowed and do NOT break it). Contact
//           still hurts and set-piece hunters (guardians, invasions, bosses)
//           track by sensors, not eyes — they see through it by design.
//   surge — a short burst of move speed (moveMult() joins main.js's chain).
//   echo  — sonar: nearby creatures ping through walls (drawEcho overlay
//           reuses MM.mobs.thermalTargets — render-only, works on replicas).
//
// The cloak state of remote co-op bodies rides host-side ghost_host fields
// (body.cloakUntil in the host's performance.now() domain, bodyLike.cloaked
// republished every body tick) — cloaked(body) understands both.
import { T } from '../constants.js';
window.MM = window.MM || {};
(function(){
  const root = typeof window !== 'undefined' ? window : globalThis;
  const api = {};

  // --- active powers: the module's own power levels (host-owned numbers) -----
  const TIER_KEYS = ['common','uncommon','rare','epic','legendary'];
  const ACTIVES = {
    cloak: { label:'Kamuflaż',    icon:'🫥', cd:20, energy:15,
      dur:{common:2,   uncommon:2.5, rare:3,   epic:3.5,  legendary:4} },
    surge: { label:'Przepięcie',  icon:'⚡', cd:16, energy:12, moveMult:1.45,
      dur:{common:2.5, uncommon:3,   rare:3.5, epic:4.25, legendary:5} },
    echo:  { label:'Echolokacja', icon:'📡', cd:14, energy:8,
      dur:{common:4,   uncommon:5,   rare:6,   epic:7,    legendary:8},
      range:{common:16, uncommon:19, rare:22,  epic:26,   legendary:30} }
  };
  const UNIQUE_CD_MULT = 0.75; // a unique find cools down faster (its only boost)

  function nowMs(){ return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function finite(n,fallback){ return (typeof n === 'number' && isFinite(n)) ? n : fallback; }
  function tierKey(t){
    const k = String(t || '').toLowerCase();
    if(k === 'mythic') return 'legendary';
    return TIER_KEYS.includes(k) ? k : 'common';
  }
  function durationFor(id, tier){
    const spec = ACTIVES[id];
    if(!spec) return 0;
    return spec.dur[tierKey(tier)] || spec.dur.common;
  }
  function cooldownFor(id, unique){
    const spec = ACTIVES[id];
    if(!spec) return 0;
    return spec.cd * (unique ? UNIQUE_CD_MULT : 1);
  }
  function echoRangeFor(tier){
    return ACTIVES.echo.range[tierKey(tier)] || ACTIVES.echo.range.common;
  }

  // --- equipped item resolution (equippedItem scans per call — cache per id) --
  let cachedId, cachedItem = null;
  function inventory(){ return root.MM && root.MM.inventory; }
  function equipped(){
    const inv = inventory();
    if(!inv || typeof inv.equippedId !== 'function') return null;
    const id = inv.equippedId('antenna');
    if(!id){ cachedId = undefined; cachedItem = null; return null; }
    if(cachedId === id && cachedItem) return cachedItem;
    let item = typeof inv.equippedItem === 'function' ? inv.equippedItem('antenna') : null;
    if(!item && inv.getItem) item = inv.getItem(id);
    cachedItem = item || { id, kind:'antenna', name:id };
    cachedId = id;
    return cachedItem;
  }

  // --- activation state machine ----------------------------------------------
  const st = { id:null, until:0, cdUntil:0, tier:'common', unique:false };
  function activeNow(){ return st.id && nowMs() < st.until ? st.id : null; }
  function isGuestSpectator(){
    // watch/play guests carry the HOST's inventory (applyGameData) — their view
    // of an equipped antenna is display truth, never theirs to fire. A hero
    // guest owns its gear and gets the real activation (+ the host intent).
    const d = root.document;
    if(!d || !d.body || !d.body.classList) return false;
    return d.body.classList.contains('mmGhostMode') && !d.body.classList.contains('mmGhostHero');
  }
  function note(id){
    try{
      const D = root.MM && root.MM.discovery;
      if(D && D.note) D.note('antenna_' + id);
    }catch(e){ /* discovery optional */ }
  }
  function tryActivate(){
    const item = equipped();
    if(!item) return { ok:false, reason:'none' };
    const id = item.antennaActive;
    const spec = id && ACTIVES[id];
    if(!spec) return { ok:false, reason:'passive' };
    if(isGuestSpectator()) return { ok:false, reason:'ghost' };
    const t = nowMs();
    if(t < st.cdUntil) return { ok:false, reason:'cd', left:(st.cdUntil - t) / 1000 };
    const en = root.MM && root.MM.heroEnergy;
    if(en && typeof en.canSpend === 'function' && !en.canSpend(spec.energy)) return { ok:false, reason:'energy' };
    if(en && typeof en.spend === 'function') en.spend(spec.energy);
    const tier = tierKey(item.tier);
    const unique = !!item.unique;
    st.id = id; st.tier = tier; st.unique = unique;
    st.until = t + durationFor(id, tier) * 1000;
    st.cdUntil = t + cooldownFor(id, unique) * 1000;
    // hero guest: mob AI runs on the HOST — mirror world-relevant actives there.
    // The intent only NAMES the active; the host clamps tier and owns durations.
    try{
      const gi = root.MM && root.MM.ghostHeroIntents;
      if(gi && typeof gi.antenna === 'function' && id === 'cloak') gi.antenna(id, tier, unique);
    }catch(e){ /* solo/host */ }
    note(id);
    chipDirty = true;
    return { ok:true, id, dur:(st.until - t) / 1000 };
  }
  // host ack for the cloak intent: the HOST's duration is the world truth the
  // mobs obey — sync the local window so the shimmer matches what hunters see.
  function hostAck(ok, id, ms){
    if(!ACTIVES[id]) return;
    const t = nowMs();
    if(!ok){
      if(st.id === id){ st.until = 0; st.cdUntil = Math.min(st.cdUntil, t + 1500); }
    } else if(st.id === id && Number.isFinite(ms) && ms > 0){
      st.until = t + ms;
    }
    chipDirty = true;
  }

  // --- the cloak gate (single question every hunter asks) --------------------
  // body: null/window.player = the LOCAL hero; a co-op bodyLike carries either
  // the per-tick `cloaked` flag or a raw host-domain `cloakUntil`.
  function cloaked(body){
    if(!body || body === root.player || (root.window && body === root.window.player)){
      return st.id === 'cloak' && nowMs() < st.until;
    }
    if(body.cloaked) return true;
    return Number(body.cloakUntil) > nowMs();
  }
  function heroAlpha(){
    if(!cloaked(null)) return 1;
    const left = (st.until - nowMs()) / 1000;
    const shimmer = 0.24 + 0.08 * Math.sin(nowMs() * 0.02);
    // the last 0.35 s fades the hero back in so decloak never pops
    if(left < 0.35) return shimmer + (1 - shimmer) * (1 - left / 0.35);
    return shimmer;
  }
  function moveMult(){
    return activeNow() === 'surge' ? ACTIVES.surge.moveMult : 1;
  }

  // --- rod physics (verlet chain, stiff at the base, whippy at the tip) ------
  const SEGS = 8;
  const points = [];   // [0] = anchor on the head
  const restLen = [];
  let segLen = 0.11;
  function headAnchor(player){
    const w = clamp(finite(player && player.w, 0.7), 0.35, 1.4);
    const h = clamp(finite(player && player.h, 0.95), 0.45, 1.8);
    const facing = (player && player.facing < 0) ? -1 : 1;
    return {
      x: finite(player && player.x, 0) - facing * w * 0.10,
      y: finite(player && player.y, 0) - h * 0.5 - 0.02,
      facing, w, h
    };
  }
  function rodLength(item){
    const tier = tierKey(item && item.tier);
    return 0.31 + TIER_KEYS.indexOf(tier) * 0.025; // a discreet aerial; higher tiers wear a slightly longer one
  }
  function init(player){
    points.length = 0; restLen.length = 0;
    const item = equipped();
    if(!item || !player) return false;
    const a = headAnchor(player);
    segLen = rodLength(item) / (SEGS - 1);
    for(let i = 0; i < SEGS; i++){
      const lean = a.facing * -0.06 * (i / (SEGS - 1)); // rest pose leans slightly back
      const px = a.x + lean, py = a.y - segLen * i;
      points.push({ x:px, y:py, px, py });
      if(i) restLen.push(segLen);
    }
    return true;
  }
  function fluidAt(player, getTile){
    if(typeof getTile !== 'function' || !player) return false;
    try{
      const t = getTile(Math.floor(player.x), Math.floor(player.y - finite(player.h, 0.95) * 0.6));
      return t === T.WATER || t === T.LAVA;
    }catch(e){ return false; }
  }
  function sampleWind(player, getTile){
    try{
      const W = root.MM && root.MM.wind;
      if(!W || !player) return 0;
      if(typeof W.speedAt === 'function') return W.speedAt(player.x, player.y - finite(player.h, 0.95) * 0.8, getTile);
      if(typeof W.speed === 'function') return W.speed();
    }catch(e){ /* wind optional */ }
    return 0;
  }
  function update(player, dt, getTile){
    const item = equipped();
    if(!item || !player){ points.length = 0; refreshChip(item); return false; }
    if(points.length !== SEGS) init(player);
    if(points.length !== SEGS || !(dt > 0) || !isFinite(dt)){ refreshChip(item); return false; }
    dt = clamp(dt, 0.001, 0.05);
    const a = headAnchor(player);
    if(!isFinite(points[SEGS - 1].x + points[SEGS - 1].y)) init(player);
    const vx = finite(player.vx, 0), vy = finite(player.vy, 0);
    const fluid = fluidAt(player, getTile);
    const wind = finite(sampleWind(player, getTile), 0) * (fluid ? 0.2 : 1);
    const damp = Math.pow(fluid ? 0.30 : 0.62, dt * 60);
    // anchor is pinned to the head every frame
    const base = points[0];
    base.x = a.x; base.y = a.y; base.px = a.x; base.py = a.y;
    for(let i = 1; i < SEGS; i++){
      const p = points[i];
      const k = i / (SEGS - 1); // 0 at base → 1 at tip
      const oldX = p.x, oldY = p.y;
      // inertia + a trail against motion (the tip whips), wind lean, light lift
      p.x += (p.x - p.px) * damp - vx * dt * 0.055 * k + wind * dt * 0.026 * (0.2 + k);
      p.y += (p.y - p.py) * damp - vy * dt * 0.035 * k - 2.6 * dt * dt; // buoyant: a rod wants to stand
      p.px = oldX; p.py = oldY;
    }
    // constraint passes: fixed segment length + angular stiffness toward the
    // upright rest pose (strong near the base, loose toward the tip)
    for(let pass = 0; pass < 6; pass++){
      base.x = a.x; base.y = a.y;
      for(let i = 0; i < SEGS - 1; i++){
        const pa = points[i], pb = points[i + 1];
        let dx = pb.x - pa.x, dy = pb.y - pa.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.0001;
        const diff = (d - restLen[i]) / d;
        if(i === 0){ pb.x -= dx * diff; pb.y -= dy * diff; }
        else {
          pa.x += dx * diff * 0.5; pa.y += dy * diff * 0.5;
          pb.x -= dx * diff * 0.5; pb.y -= dy * diff * 0.5;
        }
      }
      for(let i = 1; i < SEGS; i++){
        const p = points[i];
        const k = i / (SEGS - 1);
        const stiff = (0.10 - k * 0.075) * (fluid ? 0.5 : 1);
        const restX = a.x + a.facing * -0.06 * k;
        const restY = a.y - segLen * i;
        p.x += (restX - p.x) * stiff;
        p.y += (restY - p.y) * stiff;
      }
    }
    if(st.id && nowMs() >= st.until && st.until){ /* expired — chip shows cooldown */ }
    refreshChip(item);
    return true;
  }

  // --- palette + draw --------------------------------------------------------
  // Deliberately dark and discreet (owner ruling 2026-07-17): the aerial reads
  // as a thin dark whisker, the tint lives mostly in the small tip orb.
  function shade(hex, delta){
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if(!m) return hex || '#6b7280';
    const n = parseInt(m[1], 16);
    const b = (v) => v < 0 ? 0 : (v > 255 ? 255 : v);
    const r = b(((n >> 16) & 255) + delta), g = b(((n >> 8) & 255) + delta), bl = b((n & 255) + delta);
    return '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + bl.toString(16).padStart(2, '0');
  }
  let palItem = null, palCache = null;
  function palette(item){
    if(item && palItem === item && palCache) return palCache;
    let orb = '#9fb9ff';
    if(item){
      if(item.antennaActive === 'cloak') orb = '#c98cff';
      else if(item.antennaActive === 'surge') orb = '#ffd45f';
      else if(item.antennaActive === 'echo') orb = '#63f0d4';
      else if(typeof item.visionRadius === 'number') orb = '#75dcff';
      else if(typeof item.attackDamage === 'number') orb = '#ffb24d';
      else if(typeof item.damageReductionBonus === 'number') orb = '#a8c4ff';
    }
    const tier = tierKey(item && item.tier);
    const rod = tier === 'legendary' ? '#71566d' : tier === 'epic' ? '#6d5f3a' : '#4a515e';
    palCache = { rod, rodDark:'#171b23', orb: shade(orb, -36) };
    palItem = item || null;
    return palCache;
  }
  function draw(ctx, TILE, player){
    const item = equipped();
    if(!item || !ctx || points.length !== SEGS) return false;
    const T = finite(TILE, 20);
    const pal = palette(item);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(points[0].x * T, points[0].y * T);
    for(let i = 1; i < SEGS; i++) ctx.lineTo(points[i].x * T, points[i].y * T);
    ctx.strokeStyle = pal.rodDark;
    ctx.lineWidth = Math.max(1, T * 0.032);
    ctx.stroke();
    ctx.strokeStyle = pal.rod;
    ctx.lineWidth = Math.max(0.6, T * 0.015);
    ctx.stroke();
    // mount bead on the head
    ctx.fillStyle = pal.rodDark;
    ctx.beginPath();
    ctx.arc(points[0].x * T, points[0].y * T, Math.max(1, T * 0.034), 0, Math.PI * 2);
    ctx.fill();
    // tip orb: breathing glow, strong while the active runs, dim on cooldown
    const tip = points[SEGS - 1];
    const t = nowMs();
    const running = !!activeNow();
    const cooling = !running && t < st.cdUntil;
    const pulse = running ? 0.75 + 0.25 * Math.sin(t * 0.02) : 0.45 + 0.2 * Math.sin(t * 0.006);
    const r = Math.max(1, T * 0.05);
    if(!cooling){
      const rg = ctx.createRadialGradient(tip.x * T, tip.y * T, 0.5, tip.x * T, tip.y * T, r * 2.4);
      rg.addColorStop(0, 'rgba(255,255,255,' + (0.12 * pulse).toFixed(3) + ')');
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(tip.x * T, tip.y * T, r * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha *= cooling ? 0.55 : 1;
    ctx.fillStyle = pal.orb;
    ctx.beginPath();
    ctx.arc(tip.x * T, tip.y * T, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(12,15,21,0.85)';
    ctx.lineWidth = Math.max(0.8, r * 0.35);
    ctx.stroke();
    ctx.restore();
    return true;
  }
  // echo sonar overlay: creatures ping through walls. Same view contract as
  // VISION_MODES.draw ({x,y,width,height,tileSize,worldX,worldY}); render-only,
  // so it works identically on a guest's stream replica of the mob roster.
  function drawEcho(ctx, view, player){
    if(activeNow() !== 'echo' || !ctx || !view || !player) return false;
    const M = root.MM && root.MM.mobs;
    if(!M || typeof M.thermalTargets !== 'function') return false;
    let targets = null;
    try{ targets = M.thermalTargets(player.x, player.y, echoRangeFor(st.tier), 64); }catch(e){ return false; }
    if(!targets || !targets.length) return false;
    const ts = finite(view.tileSize, 20);
    const t = nowMs();
    const wave = (t % 900) / 900;
    ctx.save();
    for(const m of targets){
      const sx = view.x + (m.x - view.worldX) * ts;
      const sy = view.y + (m.y - view.worldY) * ts;
      if(sx < view.x - ts || sy < view.y - ts || sx > view.x + view.width + ts || sy > view.y + view.height + ts) continue;
      ctx.strokeStyle = 'rgba(99,240,212,' + (0.55 * (1 - wave)).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1, ts * 0.06);
      ctx.beginPath();
      ctx.arc(sx, sy, ts * (0.35 + wave * 0.75), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(99,240,212,0.85)';
      ctx.fillRect(Math.round(sx) - 1, Math.round(sy) - 1, 3, 3);
    }
    ctx.restore();
    return true;
  }

  // --- HUD chip: readiness pill, clickable (= touch activation) --------------
  let chip = null, chipDirty = true, chipLastText = '', chipLastShown = null;
  function ensureChip(){
    const d = root.document;
    if(chip || !d || !d.body) return chip;
    chip = d.createElement('button');
    chip.id = 'antennaChip';
    chip.type = 'button';
    chip.style.cssText = 'position:fixed;left:12px;bottom:118px;z-index:60;display:none;'
      + 'padding:4px 10px;border-radius:999px;border:1px solid rgba(160,190,255,.4);'
      + 'background:rgba(12,17,28,.88);color:#dfe9ff;font:700 11px system-ui,sans-serif;'
      + 'letter-spacing:.3px;cursor:pointer;pointer-events:auto;';
    chip.addEventListener('click', () => {
      tryActivate();
      try{ chip.blur(); }catch(e){ /* focus guard */ }
    });
    const style = d.createElement('style');
    style.textContent = 'body.touchUi #antennaChip{ bottom:212px; }'
      + '#antennaChip.on{ border-color:rgba(201,140,255,.85); color:#f2e5ff; }'
      + '#antennaChip.cool{ opacity:.62; }';
    d.head && d.head.appendChild(style);
    d.body.appendChild(chip);
    return chip;
  }
  function refreshChip(item){
    const d = root.document;
    if(!d || !d.body) return;
    const spec = item && item.antennaActive ? ACTIVES[item.antennaActive] : null;
    const show = !!spec && !isGuestSpectator();
    if(!chip && !show) return;
    ensureChip();
    if(!chip) return;
    if(chipLastShown !== show){
      chip.style.display = show ? 'inline-block' : 'none';
      chipLastShown = show;
    }
    if(!show) return;
    const t = nowMs();
    const running = st.id === item.antennaActive && t < st.until;
    const cooling = !running && t < st.cdUntil;
    const text = spec.icon + ' ' + spec.label + ' · ' + (
      running ? (Math.max(0, (st.until - t) / 1000)).toFixed(1) + 's'
      : cooling ? '⏳' + Math.ceil((st.cdUntil - t) / 1000) + 's'
      : '[Q]');
    if(text !== chipLastText || chipDirty){
      chip.textContent = text;
      chip.classList.toggle('on', running);
      chip.classList.toggle('cool', cooling);
      chipLastText = text;
      chipDirty = false;
    }
  }

  api.ACTIVES = ACTIVES;
  api.TIER_KEYS = TIER_KEYS;
  api.tierKey = tierKey;
  api.durationFor = durationFor;
  api.cooldownFor = cooldownFor;
  api.echoRangeFor = echoRangeFor;
  api.init = init;
  api.update = update;
  api.draw = draw;
  api.drawEcho = drawEcho;
  api.tryActivate = tryActivate;
  api.hostAck = hostAck;
  api.cloaked = cloaked;
  api.heroAlpha = heroAlpha;
  api.moveMult = moveMult;
  api.active = () => !!equipped();
  api.activeNow = activeNow;
  api._points = points;
  api._state = st;
  api._debug = { equipped, palette, headAnchor, rodLength, refreshChip };
  root.MM.antennas = api;
})();

export const antennas = (typeof window !== 'undefined' && window.MM) ? window.MM.antennas : globalThis.MM && globalThis.MM.antennas;
export default antennas;
