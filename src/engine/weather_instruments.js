// Weather instruments: two rooftop fixtures that make the invisible weather
// systems legible — and one of them profitable.
//
// WEATHERVANE (wiatrowskaz): a passable rooftop rod with an arrow that shows
// the LIVE wind — direction and strength (arrow length + pips + ribbon wag).
// The wind sim has always been there; now you can read it, plan drift gales,
// sails and sand farming from your own roof.
//
// LIGHTNING_ROD (piorunochron): storm bolts prefer the rod (clouds.js aims at
// the highest rod near the strike column) and their charge is BANKED into the
// rod's buffer — drained by the same electric networks that drink from
// dynamos, solar rigs and SMR cells (kind:'rod' source branches). Standing
// near a struck rod is SAFE: the whole point of the instrument is that the
// bolt goes down the pole, not through you. A storm stops being a threat and
// becomes a harvest.
//
// Multiplayer: host-only sim (tiles replicate over the tiles plane; energy is
// host infra like every other source). Runtime charge is not persisted — the
// tile is the save, a reload boots the rod empty (same ruling as solar).
import { T, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } from '../constants.js';

window.MM = window.MM || {};
(function(){
  const WORLD_TOP = Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;

  const CFG = {
    SCAN_INTERVAL: 1.6,
    SCAN_RX: 60, SCAN_RY: 40,
    CELL_CAP: 96,
    ROD_CAPACITY: 120,       // mirrors INFO energyCapacity
    ROD_STRIKE_ENERGY: 45,   // one banked bolt
    ROD_ATTRACT_RADIUS: 18,  // columns clouds.js searches around a strike
    FLASH_MS: 650,
  };

  const rods = new Map();  // "x,y" -> {x,y,energy,pulse,flashUntil}
  const vanes = new Map(); // "x,y" -> {x,y}
  const key=(x,y)=>x+','+y;
  let scanT=0, strikesBanked=0, vaneNoted=false, rodNoted=false;

  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function nowMs(){ return (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now(); }
  function getSafe(getTile,x,y,fallback){
    try{ return typeof getTile==='function' ? getTile(x,y) : fallback; }catch(e){ return fallback; }
  }
  function windSpeed(){
    try{ const w=MM.wind; if(w && typeof w.speed==='function'){ const v=Number(w.speed()); if(Number.isFinite(v)) return v; } }catch(e){}
    return 0;
  }
  function ensureRod(x,y){
    const k=key(x,y);
    let c=rods.get(k);
    if(!c){ c={x,y,energy:0,pulse:0,flashUntil:0}; rods.set(k,c); }
    return c;
  }
  function scanAround(player,getTile){
    if(!player || typeof getTile!=='function') return;
    const cx=Math.floor(player.x), cy=Math.floor(player.y);
    const world=MM.world;
    const peek=world && typeof world.peekTile==='function' ? (x,y)=>world.peekTile(x,y,T.AIR) : getTile;
    const y0=Math.max(WORLD_TOP,cy-CFG.SCAN_RY), y1=Math.min(WORLD_BOTTOM-1,cy+CFG.SCAN_RY);
    for(let y=y0;y<=y1;y++){
      for(let x=cx-CFG.SCAN_RX;x<=cx+CFG.SCAN_RX;x++){
        const t=getSafe(peek,x,y,T.AIR);
        if(t===T.LIGHTNING_ROD){ ensureRod(x,y); }
        else if(t===T.WEATHERVANE && !vanes.has(key(x,y))){
          vanes.set(key(x,y),{x,y});
          if(!vaneNoted){
            vaneNoted=true;
            try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('weathervane','Wiatrowskaz pokazuje żywy wiatr — planuj zamiecie i żagle.'); }catch(e){}
          }
        }
      }
    }
    if(rods.size>CFG.CELL_CAP){
      const rows=[...rods.values()].sort((a,b)=>(Math.abs(b.x-cx)+Math.abs(b.y-cy))-(Math.abs(a.x-cx)+Math.abs(a.y-cy)));
      for(let i=0;i<rows.length && rods.size>CFG.CELL_CAP;i++) rods.delete(key(rows[i].x,rows[i].y));
    }
    if(vanes.size>CFG.CELL_CAP){
      const rows=[...vanes.values()].sort((a,b)=>(Math.abs(b.x-cx)+Math.abs(b.y-cy))-(Math.abs(a.x-cx)+Math.abs(a.y-cy)));
      for(let i=0;i<rows.length && vanes.size>CFG.CELL_CAP;i++) vanes.delete(key(rows[i].x,rows[i].y));
    }
  }
  function update(dt,player,getTile){
    if(!(dt>0) || typeof getTile!=='function') return;
    scanT-=dt;
    if(scanT<=0){ scanT=CFG.SCAN_INTERVAL; scanAround(player,getTile); }
    const px=player && Number.isFinite(player.x) ? player.x : 0;
    const py=player && Number.isFinite(player.y) ? player.y : 0;
    for(const [k,c] of rods){
      const near=Math.abs(c.x-px)<=CFG.SCAN_RX+24 && Math.abs(c.y-py)<=CFG.SCAN_RY+24;
      if(near && getSafe(getTile,c.x,c.y,T.AIR)!==T.LIGHTNING_ROD){ rods.delete(k); continue; }
      c.pulse=Math.max(0,(c.pulse||0)-dt*1.2);
    }
    for(const [k,c] of vanes){
      const near=Math.abs(c.x-px)<=CFG.SCAN_RX+24 && Math.abs(c.y-py)<=CFG.SCAN_RY+24;
      if(near && getSafe(getTile,c.x,c.y,T.AIR)!==T.WEATHERVANE) vanes.delete(k);
    }
  }

  // --- lightning contract (clouds.js) ----------------------------------------
  // The highest rod in an open column near the strike; clouds.js re-aims there.
  function rodTargetNear(x,fromRow,getTile){
    const radius=CFG.ROD_ATTRACT_RADIUS;
    const xi=Math.round(x);
    for(let d=0; d<=radius; d++){
      const cols=d===0?[xi]:[xi-d,xi+d];
      for(const tx of cols){
        for(let y=Math.max(WORLD_TOP+1,Math.floor(fromRow)); y<WORLD_BOTTOM; y++){
          const t=getSafe(getTile,tx,y,T.AIR);
          if(t===T.LIGHTNING_ROD) return {x:tx,y};
          // the rod must stand in the open column — anything solid shadows it
          if(t!==T.AIR && !(MM.gases && MM.gases.isGasTile && MM.gases.isGasTile(t))) break;
        }
      }
    }
    return null;
  }
  // Bank a bolt: called by clouds.js when a strike lands on a rod.
  function strikeRod(x,y){
    const c=rods.get(key(Math.floor(x),Math.floor(y)));
    if(!c) return null;
    const got=Math.min(CFG.ROD_STRIKE_ENERGY, CFG.ROD_CAPACITY-c.energy);
    c.energy=clamp(c.energy+CFG.ROD_STRIKE_ENERGY,0,CFG.ROD_CAPACITY);
    c.pulse=1;
    c.flashUntil=nowMs()+CFG.FLASH_MS;
    strikesBanked++;
    if(!rodNoted){
      rodNoted=true;
      try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('lightning_rod','Piorunochron zebrał uderzenie — burza stała się żniwami.'); }catch(e){}
    }
    return {banked:got, energy:c.energy};
  }

  // --- electric-network source contract (mirrors smr/solar) ------------------
  function sourceAt(x,y,getTile){
    const tx=Math.floor(x), ty=Math.floor(y);
    if(getSafe(getTile,tx,ty,T.AIR)!==T.LIGHTNING_ROD) return null;
    ensureRod(tx,ty);
    return {x:tx,y:ty,cells:1,kind:'rod'};
  }
  function energyAt(x,y){
    const c=rods.get(key(Math.floor(x),Math.floor(y)));
    return c ? Math.max(0,c.energy||0) : 0;
  }
  function drainAt(x,y,amount){
    const c=rods.get(key(Math.floor(x),Math.floor(y)));
    if(!c) return null;
    const want=Math.max(0,Number(amount)||0);
    const got=Math.min(want,Math.max(0,c.energy||0));
    if(got<=0) return {amount:0};
    c.energy-=got;
    c.pulse=Math.max(c.pulse||0,0.5);
    return {amount:got};
  }

  // --- draw: the instruments themselves --------------------------------------
  function drawVane(ctx,TILE,c,wind){
    const px=(c.x+0.5)*TILE, base=(c.y+1)*TILE;
    const k=clamp(Math.abs(wind)/6,0,1);
    const dir=wind>=0?1:-1;
    const t=nowMs()*0.004;
    ctx.strokeStyle='#7c8894';
    ctx.lineWidth=Math.max(1.5,TILE*0.09);
    ctx.beginPath();
    ctx.moveTo(px,base-1);
    ctx.lineTo(px,base-TILE*0.86);
    ctx.stroke();
    // the arrow: length and wag follow the live wind
    const ay=base-TILE*0.82;
    const len=TILE*(0.28+0.42*k);
    const wag=Math.sin(t*(1+k*2))*TILE*0.045*(0.4+k);
    ctx.strokeStyle='#e0b45c';
    ctx.lineWidth=Math.max(1.4,TILE*0.08);
    ctx.beginPath();
    ctx.moveTo(px-dir*len*0.45,ay+wag*0.4);
    ctx.lineTo(px+dir*len*0.55,ay-wag);
    ctx.stroke();
    ctx.fillStyle='#e0b45c';
    ctx.beginPath();
    ctx.moveTo(px+dir*(len*0.55+3.5),ay-wag);
    ctx.lineTo(px+dir*len*0.55-dir*2,ay-wag-3);
    ctx.lineTo(px+dir*len*0.55-dir*2,ay-wag+3);
    ctx.closePath();
    ctx.fill();
    // strength pips under the head: 0..4
    const pips=Math.round(k*4);
    ctx.fillStyle='rgba(224,180,92,0.9)';
    for(let i=0;i<pips;i++) ctx.fillRect(px-6+i*4,base-TILE*0.16,2.5,2.5);
  }
  function drawRod(ctx,TILE,c){
    const px=(c.x+0.5)*TILE, base=(c.y+1)*TILE;
    ctx.strokeStyle='#9fb2c4';
    ctx.lineWidth=Math.max(1.6,TILE*0.1);
    ctx.beginPath();
    ctx.moveTo(px,base-1);
    ctx.lineTo(px,base-TILE*0.92);
    ctx.stroke();
    ctx.fillStyle='#cfe0ee';
    ctx.beginPath();
    ctx.arc(px,base-TILE*0.92,Math.max(1.6,TILE*0.09),0,Math.PI*2);
    ctx.fill();
    const t=nowMs();
    if(c.flashUntil>t){
      const a=(c.flashUntil-t)/CFG.FLASH_MS;
      ctx.strokeStyle='rgba(255,244,180,'+(0.35+0.5*a).toFixed(3)+')';
      ctx.lineWidth=Math.max(1,TILE*0.05);
      ctx.beginPath();
      ctx.moveTo(px,base-TILE*0.92);
      ctx.lineTo(px+TILE*0.2,base-TILE*0.6);
      ctx.lineTo(px-TILE*0.12,base-TILE*0.34);
      ctx.stroke();
    }
    // charge bar: how much harvest sits in the buffer
    const fill=clamp(c.energy/CFG.ROD_CAPACITY,0,1);
    if(fill>0.02){
      ctx.fillStyle='rgba(140,220,255,'+(0.4+0.3*(c.pulse||0)).toFixed(3)+')';
      ctx.fillRect(px+TILE*0.18,base-2-fill*(TILE*0.6),2.5,fill*(TILE*0.6));
    }
  }
  function draw(ctx,TILE,visible){
    if(!ctx || (!rods.size && !vanes.size)) return;
    const wind=windSpeed();
    ctx.save();
    for(const c of vanes.values()){
      if(typeof visible==='function' && !visible(c.x,c.y)) continue;
      drawVane(ctx,TILE,c,wind);
    }
    for(const c of rods.values()){
      if(typeof visible==='function' && !visible(c.x,c.y)) continue;
      drawRod(ctx,TILE,c);
    }
    ctx.restore();
  }

  function reset(){
    rods.clear(); vanes.clear();
    scanT=0; strikesBanked=0; vaneNoted=false; rodNoted=false;
  }
  function metrics(){
    let energy=0;
    for(const c of rods.values()) energy+=Math.max(0,c.energy||0);
    return {rods:rods.size, vanes:vanes.size, energy:+energy.toFixed(2), strikesBanked,
      wind:+windSpeed().toFixed(2)};
  }

  MM.weatherInstruments={update, draw, reset, metrics,
    rodTargetNear, strikeRod, sourceAt, energyAt, drainAt, config:CFG,
    _debug:{rods, vanes, ensureRod, scanAround}};
})();

export const weatherInstruments = (typeof window!=='undefined' && window.MM) ? window.MM.weatherInstruments : globalThis.MM && globalThis.MM.weatherInstruments;
export default weatherInstruments;
