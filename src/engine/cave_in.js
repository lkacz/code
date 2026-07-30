// Zawał — cave-ins and timber pit props.
//
// Mining left the world permanently hollow: falling.js:isCityLikeCluster
// deliberately forbids NATURAL rock from collapsing (only built structures
// fall), so you could hollow out any span you liked and the ceiling simply hung
// there. Every consumer of a collapse already existed and sat idle:
//   * hero_crush.js resolves burial and digging out,
//   * progress.js documents crushResistBonus as capacity "for cave-ins",
//   * main.js already prints "⛰ Miażdży cię zawał — odkop się!".
// This module is the missing PRODUCER.
//
// Shape is a deliberate clone of avalanche.js/icicles.js: a disturb() poked from
// the existing mining chokepoint, a warning phase you can react to, then release
// by clearing the cell and re-entering falling.js's own spawn path (the
// avalanche.js order — spawnLoose pushes an ENTITY and does not open the tile,
// so clearing first is what stops the rubble duplicating). Damage goes through
// the host-authoritative body inlets, sweeping window.player AND MM.coopBodies,
// so a guest cannot sprint under a bad roof in safety (CLAUDE.md rule 3).
import { T, WORLD_MIN_Y, WORLD_MAX_Y, WORLD_H } from '../constants.js';
import { isSolidCollisionTile } from './material_physics.js';

(function(){
  const root = (typeof window !== 'undefined') ? window : globalThis;
  root.MM = root.MM || {};
  const MM = root.MM;

  const CFG = {
    SPAN_MIN: 5,        // unsupported ceiling tiles before a roof is at risk
    SPAN_MAX: 22,       // scan width — beyond this we stop looking
    WARN_TIME: 2.4,     // seconds of creaking dust before the roof lets go
    PROP_RADIUS: 4,     // how far one pit prop steadies a ceiling
    MAX_WATCH: 24,      // simultaneously creaking roofs (hard bound)
    MAX_FALL: 14,       // tiles dropped by one collapse
    DMG_MIN: 6,
    DMG_MAX: 17,
    SCAN_COOLDOWN: 0.35,
    RISK_BASE: 0.30,    // chance a qualifying disturb actually starts a collapse
  };
  const WORLD_TOP = Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;

  const watching = new Map();   // "x,y" -> {x,y,t,span,cells}
  const props = new Set();      // "x,y" of placed pit props
  let scanCd = 0;
  let stats = { started: 0, collapsed: 0, propped: 0 };

  function key(x, y){ return x + ',' + y; }
  function observe(type, payload){
    try{
      const d = MM.discovery;
      if(d && typeof d.observe === 'function') d.observe(type, payload);
    }catch(e){}
  }
  function inWorld(y){ return Number.isFinite(y) && y > WORLD_TOP && y < WORLD_BOTTOM; }
  function getSafe(getTile, x, y){
    try{ const t = getTile(x, y); return t === undefined ? T.STONE : t; }catch(e){ return T.STONE; }
  }
  // Only NATURAL rock caves in. Player-built walls, ores worth mining and
  // protected structures keep falling.js's existing "built things do not
  // spontaneously collapse" promise.
  function isNaturalRock(t){
    if(t === T.STONE || t === T.GRANITE || t === T.BASALT || t === T.DIRT || t === T.CLAY) return true;
    return false;
  }
  function isOpen(t){ return t === T.AIR || t === T.WATER || !isSolidCollisionTile(t); }
  function isProp(t){ return t === T.PIT_PROP; }

  // A prop steadies everything within PROP_RADIUS — this is the counter-play.
  function proppedNear(x, y){
    for(const k of props){
      const c = k.indexOf(',');
      const px = +k.slice(0, c), py = +k.slice(c + 1);
      if(Math.abs(px - x) <= CFG.PROP_RADIUS && Math.abs(py - y) <= CFG.PROP_RADIUS + 2) return true;
    }
    return false;
  }
  function noteProp(x, y){ props.add(key(x | 0, y | 0)); stats.propped++; }
  function clearProp(x, y){ props.delete(key(x | 0, y | 0)); }

  // How wide is the unsupported opening under this ceiling cell? A ceiling only
  // sags when there is a real span of nothing holding it up.
  function unsupportedSpan(x, y, getTile){
    if(!inWorld(y)) return 0;
    if(!isOpen(getSafe(getTile, x, y + 1))) return 0; // something directly below holds it
    let span = 1;
    for(let i = 1; i <= CFG.SPAN_MAX; i++){
      const t = getSafe(getTile, x - i, y + 1);
      if(isProp(t)) return 0;
      if(!isOpen(t)) break;
      span++;
    }
    for(let i = 1; i <= CFG.SPAN_MAX; i++){
      const t = getSafe(getTile, x + i, y + 1);
      if(isProp(t)) return 0;
      if(!isOpen(t)) break;
      span++;
    }
    return span;
  }

  // The thump from a pick. Called from the mining chokepoint; returns the number
  // of roofs it set creaking.
  function disturb(x, y, power, getTile){
    getTile = getTile || (MM.world && MM.world.getTile);
    if(typeof getTile !== 'function') return 0;
    x = Math.floor(Number(x)); y = Math.floor(Number(y));
    if(!Number.isFinite(x) || !inWorld(y)) return 0;
    if(watching.size >= CFG.MAX_WATCH) return 0;
    const strength = Math.max(0.2, Math.min(2, Number(power) || 1));
    let started = 0;
    // look UP from the disturbance for a natural ceiling over a wide opening
    for(let up = 1; up <= 3 && started === 0; up++){
      const cy = y - up;
      if(!inWorld(cy)) break;
      const t = getSafe(getTile, x, cy);
      if(isOpen(t)) continue;
      if(!isNaturalRock(t)) break;             // built/ore ceilings never sag
      if(proppedNear(x, cy)) break;            // timber holds it
      const span = unsupportedSpan(x, cy, getTile);
      if(span < CFG.SPAN_MIN) break;
      const k = key(x, cy);
      if(watching.has(k)) break;
      // wider spans are likelier; a heavy strike is likelier than a tap
      const risk = Math.min(0.9, CFG.RISK_BASE * strength * (span / CFG.SPAN_MIN));
      if(Math.random() > risk) break;
      watching.set(k, { x, y: cy, t: 0, span });
      stats.started++;
      started++;
      try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst((x + 0.5) * 20, (cy + 0.9) * 20, 'common'); }catch(e){}
      try{ if(root.msg) root.msg('⚠ Strop trzeszczy — podeprzyj go albo uciekaj!'); }catch(e){}
      try{ if(MM.audio && MM.audio.play) MM.audio.play('thud', { x, y: cy }); }catch(e){}
      observe('cave_in_warning', {
        span,
        target:{ x:x + 0.5, y:cy + 0.5 }
      });
    }
    return started;
  }

  // Release: hand the ceiling to falling.js so rubble uses the SAME physics as
  // every other loose block. Never a raw setTile.
  function collapse(s, getTile, setTile){
    const F = MM.fallingSolids;
    let dropped = 0;
    for(let i = 0; i < CFG.MAX_FALL; i++){
      const cx = s.x + (i === 0 ? 0 : (i % 2 ? Math.ceil(i / 2) : -Math.ceil(i / 2)));
      const t = getSafe(getTile, cx, s.y);
      if(!isNaturalRock(t)) continue;
      if(proppedNear(cx, s.y)) continue;
      // spawnLoose only pushes a falling ENTITY — it never touches the world.
      // Clear the ceiling FIRST (the avalanche.js order), or the roof never opens
      // AND the settled rubble mints a second copy of the tile.
      if(typeof setTile !== 'function') continue;
      try{ setTile(cx, s.y, T.AIR); }catch(e){ continue; }
      if(getSafe(getTile, cx, s.y) !== T.AIR) continue;   // write refused — never mint mass
      try{ if(F && F.onTileRemoved) F.onTileRemoved(cx, s.y); }catch(e){}
      try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(cx, s.y, getTile); }catch(e){}
      try{ if(F && F.spawnLoose) F.spawnLoose(cx, s.y, t); }catch(e){}
      dropped++;
    }
    if(dropped){
      stats.collapsed++;
      try{ if(MM.noise && MM.noise.emit) MM.noise.emit(s.x, s.y, 'blast', 0.5); }catch(e){}
      try{ if(MM.audio && MM.audio.play) MM.audio.play('thud', { x: s.x, y: s.y }); }catch(e){}
      hurtBodies(s);
      observe('cave_in', {
        count:dropped,
        span:s.span,
        target:{ x:s.x + 0.5, y:s.y + 0.5 }
      });
    }
    return dropped;
  }

  // Damage sweeps the hero AND every coop body through the host-authoritative
  // inlets — a guest under a collapsing roof takes the same hit (icicles.js
  // pattern, CLAUDE.md rule 3).
  function hurtBodies(s){
    const dmg = Math.round(CFG.DMG_MIN + (CFG.DMG_MAX - CFG.DMG_MIN) * Math.min(1, s.span / CFG.SPAN_MAX));
    const near = (bx, by) => Math.abs(bx - s.x) <= 2.2 && by >= s.y - 1 && by <= s.y + 4;
    let hits = 0;
    const p = root.player;
    if(p && Number.isFinite(p.x) && near(p.x, p.y)){
      try{ if(typeof root.damageHero === 'function') root.damageHero(dmg, { cause: 'cave_in', srcX: s.x, srcY: s.y, kb: 0.1, invulMs: 350 }); }catch(e){}
      hits++;
    }
    const bodies = MM.coopBodies;
    if(bodies && bodies.length){
      for(const b of bodies){
        if(!b || b.dead || typeof b.hurt !== 'function' || !Number.isFinite(b.x)) continue;
        if(!near(b.x, b.y)) continue;
        try{ b.hurt(dmg, { cause: 'cave_in' }); }catch(e){}
        hits++;
      }
    }
    return hits;
  }

  function update(dt, player, getTile, setTile){
    if(!(dt > 0) || typeof getTile !== 'function') return;
    if(scanCd > 0) scanCd -= dt;
    if(!watching.size) return;
    for(const [k, s] of watching){
      s.t += dt;
      // a prop planted mid-warning saves the roof — that IS the counter-play
      if(proppedNear(s.x, s.y)){
        watching.delete(k);
        observe('cave_in_prevented', {
          span:s.span,
          target:{ x:s.x + 0.5, y:s.y + 0.5 }
        });
        continue;
      }
      if(!isNaturalRock(getSafe(getTile, s.x, s.y))){ watching.delete(k); continue; }
      if(s.t >= CFG.WARN_TIME){
        watching.delete(k);
        collapse(s, getTile, setTile);
      } else if(Math.random() < dt * 3){
        try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst((s.x + 0.5) * 20, (s.y + 1) * 20, 'common'); }catch(e){}
      }
    }
  }

  function reset(){ watching.clear(); props.clear(); scanCd = 0; stats = { started: 0, collapsed: 0, propped: 0 }; }
  function snapshot(){ return { v: 1, props: [...props].slice(0, 4000) }; }
  function restore(data){
    props.clear();
    if(data && Array.isArray(data.props)){
      for(const k of data.props.slice(0, 4000)) if(typeof k === 'string' && k.length <= 24) props.add(k);
    }
    watching.clear();
    return true;
  }
  function metrics(){ return { watching: watching.size, props: props.size, started: stats.started, collapsed: stats.collapsed }; }

  MM.caveIn = {
    update, disturb, reset, snapshot, restore, metrics,
    noteProp, clearProp, proppedNear,
    CFG,
    _debug: { unsupportedSpan, isNaturalRock, collapse, watching: () => watching, props: () => props },
  };
})();

export const caveIn = (typeof window !== 'undefined' && window.MM) ? window.MM.caveIn : globalThis.MM && globalThis.MM.caveIn;
export default caveIn;
