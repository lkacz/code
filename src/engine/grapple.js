// Grapple hook — a movement "arrow" that is not a weapon.
//
// The player crafts arrowGrapple ammo and pins the "hakowe" tier in the bow
// quiver; firing DIVERTS (weapons.js fireBowShot / firePowerBow) to
// MM.grapple.fire() instead of spawning a combat arrow. A hook flies nearly
// straight toward the aim, ANCHORS on the first solid tile it meets, then reels
// the hero's own body toward the anchor. Tap jump to let go and keep the
// built-up momentum — time it to fling yourself across gaps or up a cliff.
//
// Multiplayer (Duchy Warstwy — the three questions):
//   1. Writes the world? NO — the hook only READS a solid tile as an anchor and
//      drives THIS body's velocity. No setTile, no entity, no drop; it never
//      touches a chokepoint.
//   2. Live world-sim state between joins? NO — a transient rope on one body,
//      nothing to stream-plane or persist (it is never saved).
//   3. Reads window.player? NO — it takes the body as a parameter. On a hero
//      guest the body IS window.player and the reel runs locally; the resulting
//      motion reaches every other viewer through the existing pose uplink,
//      exactly like walking. So there is NO hact intent and NO host seam —
//      self-movement is guest-authoritative. The single rule the reel obeys:
//      keep the pull speed under the host's 30 tiles/s pose envelope
//      (REEL_SPEED below), or the host shadow would rubber-band.
//
// Because guest arrows are wiped wholesale each wfx packet (weapons.js
// ghostApplyFx) and pushArrow forwards a guest shot to the host as an intent,
// the hook deliberately lives in THIS module — never in the arrows array — so a
// mid-flight rope survives on a guest and never becomes a host-flown projectile.
import { isSolidCollisionTile } from './material_physics.js';

(function(){
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.MM = root.MM || {};

  const CFG = {
    HOOK_SPEED: 34,     // tiles/s — a fast, nearly straight cast
    HOOK_GRAV: 5,       // gentle droop so a long cast arcs a little
    MAX_RANGE: 22,      // rope length: a cast that flies this far without biting fizzles
    FLY_TIME: 1.4,      // s — hard cap on flight before it fizzles
    REEL_SPEED: 18,     // tiles/s reel cap — deliberately < 30 (the MP pose envelope)
    REEL_RAMP: 0.16,    // s to ramp from 0 to full reel speed (a smooth yank, not a snap)
    REEL_TIME: 5,       // s — safety cap on a single reel
    STALL_TIME: 0.6,    // s of no progress (snagged on geometry) before letting go
    ARRIVE_DIST: 1.15,  // reached the anchor: detach
    ORIGIN_OFF_Y: -0.15 // fire from roughly the chest, matching arrow spawn
  };

  function isSolid(t){ return isSolidCollisionTile(t); }
  function num(v){ return typeof v === 'number' && isFinite(v); }

  // A single active hook (one rope at a time).
  const st = {
    active: false,
    phase: 'idle',    // 'fly' | 'anchored'
    player: null,
    hx: 0, hy: 0,     // hook tip position (world tiles)
    hvx: 0, hvy: 0,   // hook velocity (fly phase)
    ax: 0, ay: 0,     // anchor point (anchored phase)
    atx: 0, aty: 0,   // anchor TILE (validity re-check)
    travel: 0,        // distance the hook has flown
    flyT: 0,          // flight time elapsed
    reelT: 0,         // reel time elapsed
    reelSpeed: 0,     // ramped reel speed
    lastReelVx: 0, lastReelVy: 0, // last reel velocity, handed back as fling momentum
    lastDist: null, stallT: 0,    // stall detector: snagged rope lets go
    lastReason: null
  };

  function reset(){
    st.active = false; st.phase = 'idle'; st.player = null;
    st.hx = st.hy = st.hvx = st.hvy = st.ax = st.ay = 0; st.atx = st.aty = 0;
    st.travel = 0; st.flyT = 0; st.reelT = 0; st.reelSpeed = 0;
    st.lastReelVx = 0; st.lastReelVy = 0; st.lastDist = null; st.stallT = 0;
    st.lastReason = null;
  }

  function isActive(){ return !!st.active; }
  function anchored(){ return st.active && st.phase === 'anchored'; }

  // Hand the reel momentum back on a successful let-go so the body flies free
  // instead of dead-stopping. This frame's pre-seam vx/vy were overwritten by
  // input + gravity, so the launch velocity must be restored explicitly.
  function detach(reason, player, keepMomentum){
    if(keepMomentum && player && num(st.lastReelVx)){
      player.vx = st.lastReelVx;
      player.vy = st.lastReelVy;
    }
    st.lastReason = reason || 'release';
    st.active = false; st.phase = 'idle'; st.player = null;
    st.reelSpeed = 0; st.lastDist = null; st.stallT = 0;
  }
  // Public release (also used by the input layer / world reset).
  function release(reason){ detach(reason || 'release', st.player, false); }

  // Fire a hook from the player toward (aimX, aimY). Re-firing replaces the old
  // rope. Returns true when a hook launched.
  function fire(player, aimX, aimY){
    if(!player || !num(player.x) || !num(player.y)) return false;
    const oy = player.y + CFG.ORIGIN_OFF_Y;
    let dx = (num(aimX) ? aimX : player.x + (player.facing < 0 ? -1 : 1)) - player.x;
    let dy = (num(aimY) ? aimY : oy) - oy;
    let d = Math.hypot(dx, dy);
    if(d < 1e-3){ dx = (player.facing < 0 ? -1 : 1); dy = 0; d = 1; }
    const nx = dx / d, ny = dy / d;
    st.active = true;
    st.phase = 'fly';
    st.player = player;
    st.hx = player.x + nx * 0.6;
    st.hy = oy + ny * 0.6;
    st.hvx = nx * CFG.HOOK_SPEED;
    st.hvy = ny * CFG.HOOK_SPEED;
    st.travel = 0; st.flyT = 0; st.reelT = 0; st.reelSpeed = 0;
    st.lastReelVx = 0; st.lastReelVy = 0; st.lastDist = null; st.stallT = 0;
    st.lastReason = null;
    return true;
  }

  // Advance the hook once per frame from physics(), passed the SAME getTile the
  // solo/host frame uses (streamed tiles on a guest). opts.release detaches with
  // the fling momentum. Returns a small status object for the caller.
  function step(player, dt, getTile, opts){
    if(!st.active) return { released: false };
    if(!player){ detach('noplayer', null, false); return { released: true, reason: 'noplayer' }; }
    st.player = player;
    dt = Math.max(0, Math.min(0.1, Number(dt) || 0));
    const tileOf = (typeof getTile === 'function') ? getTile : (() => 0);

    // Manual let-go: keep the reel momentum (the fling).
    if(opts && opts.release && st.phase === 'anchored'){
      detach('manual', player, true);
      return { released: true, reason: 'manual' };
    }

    if(st.phase === 'fly'){
      st.flyT += dt;
      // Substep the cast so a fast hook cannot tunnel a one-tile-thick wall.
      const dist = Math.hypot(st.hvx, st.hvy) * dt;
      const steps = Math.max(1, Math.min(8, Math.ceil(dist / 0.4)));
      const sdt = dt / steps;
      for(let i = 0; i < steps; i++){
        st.hvy += CFG.HOOK_GRAV * sdt;
        const nxp = st.hx + st.hvx * sdt;
        const nyp = st.hy + st.hvy * sdt;
        st.travel += Math.hypot(nxp - st.hx, nyp - st.hy);
        const tx = Math.floor(nxp), ty = Math.floor(nyp);
        if(isSolid(tileOf(tx, ty))){
          // Bite: anchor at the hook tip, remember the tile for validity checks.
          st.ax = nxp; st.ay = nyp;
          st.atx = tx; st.aty = ty;
          st.hx = nxp; st.hy = nyp;
          st.phase = 'anchored';
          st.reelT = 0; st.reelSpeed = 0; st.lastDist = null; st.stallT = 0;
          try{ if(root.MM && root.MM.discovery && root.MM.discovery.note) root.MM.discovery.note('grapple_swing','Hak zaczepił — podciągasz się do terenu!'); }catch(e){}
          return { released: false, anchored: true };
        }
        st.hx = nxp; st.hy = nyp;
        if(st.travel >= CFG.MAX_RANGE){ detach('range', player, false); return { released: true, reason: 'range' }; }
      }
      if(st.flyT >= CFG.FLY_TIME){ detach('flytime', player, false); return { released: true, reason: 'flytime' }; }
      return { released: false, flying: true };
    }

    // Anchored: reel the body toward the anchor.
    st.reelT += dt;
    if(st.reelT >= CFG.REEL_TIME){ detach('reeltime', player, false); return { released: true, reason: 'reeltime' }; }
    // Rope snapped: the anchor tile was mined or otherwise removed.
    if(!isSolid(tileOf(st.atx, st.aty))){ detach('snapped', player, false); return { released: true, reason: 'snapped' }; }

    const dx = st.ax - player.x;
    const dy = st.ay - (player.y + CFG.ORIGIN_OFF_Y);
    const d = Math.hypot(dx, dy);
    if(d <= CFG.ARRIVE_DIST){ detach('arrived', player, true); return { released: true, reason: 'arrived' }; }

    // Stall detector: once past the ramp, if the rope stops closing distance it
    // is snagged on geometry — let go rather than pin the hero against a wall.
    if(st.reelT > CFG.REEL_RAMP){
      if(st.lastDist != null && d > st.lastDist - 0.02) st.stallT += dt; else st.stallT = 0;
      if(st.stallT > CFG.STALL_TIME){ detach('stalled', player, true); return { released: true, reason: 'stalled' }; }
    }
    st.lastDist = d;

    const nx = dx / d, ny = dy / d;
    // Ramp the reel speed for a smooth yank, capped well under the pose envelope.
    st.reelSpeed = Math.min(CFG.REEL_SPEED, st.reelSpeed + CFG.REEL_SPEED * (dt / CFG.REEL_RAMP));
    // Straight reel: OVERRIDE velocity toward the anchor (ignores gravity while
    // taut). Collision in physics() still stops the body at walls; on release the
    // body keeps this velocity as launch momentum.
    st.lastReelVx = nx * st.reelSpeed;
    st.lastReelVy = ny * st.reelSpeed;
    player.vx = st.lastReelVx;
    player.vy = st.lastReelVy;
    return { released: false, reeling: true };
  }

  // The local rope as a compact wire snapshot for the multiplayer relay:
  // { ph: 1 anchored / 0 flying, x, y } where x,y is the hook TIP. null when no
  // rope is out. The rope ORIGIN is never sent — every viewer resolves it from
  // the owning body's own rendered position, so the rope stays glued to a body
  // that is interpolating/moving.
  function wireState(){
    if(!st.active || !st.player) return null;
    const anchoredNow = st.phase === 'anchored';
    const x = anchoredNow ? st.ax : st.hx;
    const y = anchoredNow ? st.ay : st.hy;
    if(!num(x) || !num(y)) return null;
    return { ph: anchoredNow ? 1 : 0, x, y };
  }

  // Shared low-level painter: a rope from a body CENTRE (cx,cy) to the hook tip
  // (tx,ty), drawn in the camera-transformed context (world*TILE) like boats.draw.
  // The local draw() AND the multiplayer remote-rope render both call this, so
  // the acting player and every viewer/spectator see a PIXEL-IDENTICAL rope.
  function drawAt(ctx, TILE, cx, cy, tx, ty, anchored){
    if(!ctx || !num(cx) || !num(cy) || !num(tx) || !num(ty)) return;
    const ox = cx, oy = cy + CFG.ORIGIN_OFF_Y;
    const x0 = ox * TILE, y0 = oy * TILE, x1 = tx * TILE, y1 = ty * TILE;
    // A little slack sag while anchored; a taut cast draws straight.
    const sag = anchored ? Math.min(TILE * 0.5, 10) : 0;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 + sag;
    ctx.strokeStyle = 'rgba(120,96,60,0.9)';
    ctx.lineWidth = Math.max(1.2, TILE * 0.09);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(mx, my, x1, y1);
    ctx.stroke();
    // Hook head oriented along the rope.
    const hs = Math.max(2, TILE * 0.22);
    ctx.save();
    ctx.translate(x1, y1);
    ctx.rotate(Math.atan2(ty - oy, tx - ox));
    ctx.fillStyle = anchored ? '#d9c48a' : '#c9b07a';
    ctx.fillRect(-hs * 0.5, -hs * 0.5, hs, hs);
    ctx.strokeStyle = '#8a6b3c';
    ctx.lineWidth = Math.max(1, TILE * 0.06);
    ctx.beginPath();
    ctx.moveTo(hs * 0.4, -hs * 0.5); ctx.lineTo(hs * 0.95, -hs * 0.95);
    ctx.moveTo(hs * 0.4, hs * 0.5); ctx.lineTo(hs * 0.95, hs * 0.95);
    ctx.stroke();
    ctx.restore();
  }

  // The acting player's own rope. Other viewers render the same rope via the
  // 'ropes' broadcast plane + drawAt() (ghost_host / ghost_client drawSpirits).
  function draw(ctx, TILE, visible){
    if(!ctx || !st.active || !st.player) return;
    const p = st.player;
    if(!num(p.x) || !num(p.y)) return;
    const anchoredNow = st.phase === 'anchored';
    drawAt(ctx, TILE, p.x, p.y, anchoredNow ? st.ax : st.hx, anchoredNow ? st.ay : st.hy, anchoredNow);
  }

  const api = {
    fire, step, draw, drawAt, wireState, release, isActive, anchored, reset,
    config: CFG,
    _debug: { state: () => st }
  };
  root.MM.grapple = api;
})();

export const grapple = (typeof window !== 'undefined' && window.MM) ? window.MM.grapple : (globalThis.MM && globalThis.MM.grapple);
export default grapple;
