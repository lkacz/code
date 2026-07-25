// Thin ice: in freezing air a still lake glazes over — the surface WATER tile
// becomes a walkable THIN_ICE sheet. Walk out on it and it loads: first it
// CREAKS (audio + hairline cracks), then the cracks spread, then the sheet
// breaks back into the exact WATER tile it froze from (volume-true both ways)
// and you are swimming in freezing water (the swim-chill system takes over).
// A heavy landing loads the sheet much faster, and a break stresses the
// neighbouring panes — lingering on a cracking lake is how you go under.
// A thaw melts the glaze back to open water on its own.
//
// Multiplayer: host-only sim (world step). Freeze/melt/break are ordinary
// setTile writes riding the tiles plane; stress is loaded by the host hero AND
// every MM.coopBodies entry, so a guest can crack a pane under themselves.
// Crack overlays are host-side visuals; the break itself is world truth.
import { T, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } from '../constants.js';
import { isSkyOpenTile } from './material_physics.js';
import { authoritativeBodyBlocksCell, BODY_DEPOSITION_CLEARANCE } from './body_footprint.js';

window.MM = window.MM || {};
(function(){
  const WORLD_TOP = Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;

  const CFG = {
    TICK: 2.0,            // freeze/melt cadence (seconds)
    BAND: 70,             // active half-width (columns) around the player
    SAMPLES: 16,          // random columns probed per tick
    FREEZE_TEMP: 0.26,    // seasons temperature at/below which surfaces glaze
    MELT_TEMP: 0.42,      // above this the glaze melts back to water
    FREEZE_P: 0.5,        // per-sample glaze chance in a hard frost
    MELT_P: 0.14,         // per-cell melt chance per tick in a thaw
    STRESS_RATE: 0.55,    // stress/s a standing body loads into a pane
    STRESS_LAND: 0.6,     // extra stress from a landing thump
    STRESS_NEIGHBOR: 0.5, // stress a breaking pane dumps on its neighbours
    STRESS_DECAY: 0.12,   // stress/s an unloaded pane relaxes
    CREAK_AT: 0.35,       // first warning (audio + hairline cracks)
    BREAK_AT: 1.0,
    CREAK_MIN_MS: 900,    // per-pane audio floor
    CELL_CAP: 500,
    SURFACE_SCAN: 70,
  };

  const panes = new Map(); // "x,y" -> {x,y,stress,creakAtMs}
  const K=(x,y)=>x+','+y;
  let tickAcc=0, frozen=0, broken=0, melted=0, noted=false;

  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function nowMs(){ return (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now(); }
  function tempAt(x,row){
    try{ const s=MM.seasons; if(s && typeof s.temperatureAt==='function'){ const v=Number(s.temperatureAt(x,row)); if(Number.isFinite(v)) return v; } }catch(e){}
    return 0.5;
  }
  function surfaceAnchor(x){
    try{
      const wg=MM.worldGen;
      if(wg && typeof wg.surfaceHeight==='function'){ const s=Number(wg.surfaceHeight(x)); if(Number.isFinite(s)) return s; }
    }catch(e){}
    return 30;
  }
  function notifyWater(x,y,getTile){
    try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(x,y,getTile); }catch(e){}
  }
  function fullWaterCell(x,y){
    // only a FULL cell freezes — glazing a half-full partial would mint volume
    try{
      const w=MM.water;
      if(w && typeof w.levelAt==='function'){
        const lvl=Number(w.levelAt(x,y));
        if(Number.isFinite(lvl) && w.UNITS && lvl<w.UNITS) return false;
      }
    }catch(e){}
    return true;
  }
  // The lake surface of a column: first blocking tile when it is WATER with sky above.
  function waterSurfaceAt(cx,getTile){
    const from=Math.max(WORLD_TOP+1, Math.floor(surfaceAnchor(cx))-40);
    const until=Math.min(WORLD_BOTTOM, from+CFG.SURFACE_SCAN);
    for(let y=from;y<until;y++){
      const t=getTile(cx,y);
      if(isSkyOpenTile(t)) continue;
      return t===T.WATER ? y : -1;
    }
    return -1;
  }
  function ensurePane(x,y){
    let p=panes.get(K(x,y));
    if(!p){
      if(panes.size>=CFG.CELL_CAP) return null;
      p={x,y,stress:0,creakAtMs:0};
      panes.set(K(x,y),p);
    }
    return p;
  }
  function freezeAt(cx,getTile,setTile){
    const y=waterSurfaceAt(cx,getTile);
    if(y<0) return false;
    if(tempAt(cx,y)>CFG.FREEZE_TEMP) return false;
    if(!fullWaterCell(cx,y)) return false;
    if(authoritativeBodyBlocksCell(cx,y,BODY_DEPOSITION_CLEARANCE)) return false; // never freeze a swimmer in
    setTile(cx,y,T.THIN_ICE);
    if(getTile(cx,y)!==T.THIN_ICE) return false;
    notifyWater(cx,y,getTile);
    ensurePane(cx,y);
    frozen++;
    return true;
  }
  function breakPane(p,getTile,setTile,quiet){
    panes.delete(K(p.x,p.y));
    if(getTile(p.x,p.y)!==T.THIN_ICE) return false;
    setTile(p.x,p.y,T.WATER);
    if(getTile(p.x,p.y)!==T.WATER) return false;
    notifyWater(p.x,p.y,getTile);
    broken++;
    const tile=(MM&&MM.TILE)||20;
    try{
      const P=MM.particles;
      if(P && P.spawnSplash) P.spawnSplash((p.x+0.5)*tile,p.y*tile,0.8);
      if(MM.water && MM.water.disturb) MM.water.disturb(p.x,220);
    }catch(e){}
    if(!quiet){
      try{ if(MM.audio && MM.audio.play) MM.audio.play('splashIn',{x:p.x+0.5,y:p.y}); }catch(e){}
    }
    // the shock runs into the neighbouring panes — lingering is how you go under
    for(const dx of [-1,1]){
      const n=panes.get(K(p.x+dx,p.y));
      if(n) n.stress=clamp(n.stress+CFG.STRESS_NEIGHBOR,0,CFG.BREAK_AT);
    }
    return true;
  }
  function creak(p){
    const t=nowMs();
    // a fresh pane always creaks once (0 is "never creaked", not a timestamp)
    if(p.creakAtMs && t-p.creakAtMs<CFG.CREAK_MIN_MS) return;
    p.creakAtMs=t;
    try{ if(MM.audio && MM.audio.play) MM.audio.play('creak',{x:p.x+0.5,y:p.y}); }catch(e){}
    if(!noted){
      noted=true;
      try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('thin_ice','Cienki lód trzeszczy pod nogami — zaraz pęknie!'); }catch(e){}
    }
  }
  // The pane directly under a body's feet (standing, not swimming/jumping).
  function paneUnder(b,getTile){
    if(!b || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return null;
    if(Math.abs(Number(b.vy)||0)>1.2) return null;
    const h=Number.isFinite(b.h)&&b.h>0?b.h:0.95;
    const cx=Math.floor(b.x);
    for(const cy of [Math.floor(b.y+h/2+0.1), Math.floor(b.y+h/2+0.1)+1]){
      if(getTile(cx,cy)===T.THIN_ICE) return ensurePane(cx,cy);
    }
    return null;
  }
  function loadBody(b,dt,getTile,setTile){
    const vyNow=Number(b.vy)||0;
    const vyPrev=Number(b._iceVyPrev)||0;
    b._iceVyPrev=vyNow;
    const p=paneUnder(b,getTile);
    if(!p) return;
    p.stress=clamp(p.stress+CFG.STRESS_RATE*dt,0,CFG.BREAK_AT+0.01);
    if(vyPrev>4 && vyNow<0.6) p.stress=clamp(p.stress+CFG.STRESS_LAND,0,CFG.BREAK_AT+0.01);
    p._loadedMs=nowMs();
    if(p.stress>=CFG.BREAK_AT){ breakPane(p,getTile,setTile); return; }
    if(p.stress>=CFG.CREAK_AT) creak(p);
  }
  function update(dt,player,getTile,setTile){
    if(!(dt>0) || typeof getTile!=='function' || typeof setTile!=='function') return;
    loadBody(player,dt,getTile,setTile);
    const bodies=(typeof MM!=='undefined' && MM.coopBodies)||null;
    if(bodies && bodies.length){ for(const b of bodies){ if(b && !b.dead) loadBody(b,dt,getTile,setTile); } }
    const t=nowMs();
    for(const [k,p] of panes){
      if(getTile(p.x,p.y)!==T.THIN_ICE){ panes.delete(k); continue; }
      if(!(t-(p._loadedMs||0)<250)) p.stress=Math.max(0,p.stress-CFG.STRESS_DECAY*dt);
    }
    tickAcc+=dt;
    if(tickAcc<CFG.TICK) return;
    tickAcc=0;
    const px=(player && Number.isFinite(player.x))?Math.floor(player.x):0;
    for(let i=0;i<CFG.SAMPLES;i++){
      const cx=px+(Math.random()<0.5?-1:1)*Math.floor(Math.random()*CFG.BAND);
      if(Math.random()<CFG.FREEZE_P) freezeAt(cx,getTile,setTile);
      // melt sweep: warm sampled columns give their glaze back to the lake
      const y=iceSurfaceAt(cx,getTile);
      if(y>=0 && tempAt(cx,y)>CFG.MELT_TEMP && Math.random()<CFG.MELT_P){
        const pane=ensurePane(cx,y)||{x:cx,y};
        if(breakPane(pane,getTile,setTile,true)) melted++;
      }
    }
  }
  function iceSurfaceAt(cx,getTile){
    const from=Math.max(WORLD_TOP+1, Math.floor(surfaceAnchor(cx))-40);
    const until=Math.min(WORLD_BOTTOM, from+CFG.SURFACE_SCAN);
    for(let y=from;y<until;y++){
      const t=getTile(cx,y);
      if(isSkyOpenTile(t)) continue;
      return t===T.THIN_ICE ? y : -1;
    }
    return -1;
  }

  // Crack overlay: hairlines from CREAK_AT, a spreading web close to the break.
  function draw(ctx,TILE,visible){
    if(!ctx || !panes.size) return;
    for(const p of panes.values()){
      if(p.stress<CFG.CREAK_AT*0.8) continue;
      if(typeof visible==='function' && !visible(p.x,p.y)) continue;
      const x=p.x*TILE, y=p.y*TILE;
      const k=clamp((p.stress-CFG.CREAK_AT*0.8)/(CFG.BREAK_AT-CFG.CREAK_AT*0.8),0,1);
      ctx.save();
      ctx.strokeStyle='rgba(40,72,96,'+(0.3+0.45*k).toFixed(3)+')';
      ctx.lineWidth=Math.max(0.8,TILE*0.035);
      ctx.beginPath();
      ctx.moveTo(x+TILE*0.18,y+TILE*0.3);
      ctx.lineTo(x+TILE*0.46,y+TILE*0.46);
      ctx.lineTo(x+TILE*0.38,y+TILE*0.72);
      if(k>0.45){
        ctx.moveTo(x+TILE*0.52,y+TILE*0.2);
        ctx.lineTo(x+TILE*0.64,y+TILE*0.5);
        ctx.lineTo(x+TILE*0.84,y+TILE*0.62);
      }
      if(k>0.8){
        ctx.moveTo(x+TILE*0.3,y+TILE*0.82);
        ctx.lineTo(x+TILE*0.56,y+TILE*0.66);
        ctx.lineTo(x+TILE*0.78,y+TILE*0.86);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  // Debug: glaze every open water surface in a radius around the hero NOW.
  function freezeAround(px,radius,getTile,setTile){
    const r=clamp(Math.floor(radius)||0,1,60);
    let n=0;
    for(let x=Math.floor(px)-r;x<=Math.floor(px)+r;x++){
      const y=waterSurfaceAt(x,getTile);
      if(y<0) continue;
      if(authoritativeBodyBlocksCell(x,y,BODY_DEPOSITION_CLEARANCE)) continue;
      setTile(x,y,T.THIN_ICE);
      if(getTile(x,y)===T.THIN_ICE){ notifyWater(x,y,getTile); ensurePane(x,y); n++; }
    }
    return n;
  }

  function reset(){
    panes.clear();
    tickAcc=0; frozen=0; broken=0; melted=0; noted=false;
  }
  function metrics(){
    let stressed=0;
    for(const p of panes.values()) if(p.stress>=CFG.CREAK_AT) stressed++;
    return {panes:panes.size, stressed, frozen, broken, melted};
  }

  MM.thinIce={update, draw, reset, metrics, freezeAround, config:CFG,
    _debug:{panes, freezeAt, breakPane, paneUnder, loadBody, waterSurfaceAt, iceSurfaceAt, ensurePane}};
})();

export const thinIce = (typeof window!=='undefined' && window.MM) ? window.MM.thinIce : globalThis.MM && globalThis.MM.thinIce;
export default thinIce;
