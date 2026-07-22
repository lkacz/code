// Icicles: under cold overhangs the melt-drip of the snow/ice above freezes
// into growing icicles. They live in the AIR cell under a solid ceiling that
// has moisture (snowpack, snowy turf, ice or water) within a few tiles above
// it. While the air is cold they grow and DRIP (the cave "kap-kap" ambience);
// when the air warms past the melt point — a thaw, spring, a heat source
// migrating the local temperature — the icicle lets go and falls as a shard:
// small damage to whoever stands under it, then it shatters into a collectible
// lump of ice on the ground (drops plane).
//
// Deterministic thinning: a cell hash decides which eligible ceilings grow one,
// so the cave roof reads as scattered teeth, not a uniform comb.
//
// Multiplayer: host-only sim in the world step. The hanging icicles mirror to
// watchers over the 'drift' plane (packet.i windows, display-only, TTL);
// falling shards are host visuals whose damage lands through damageHero /
// body.hurt — the host-authoritative damage inlets.
import { T, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } from '../constants.js';
import { isSkyOpenTile } from './material_physics.js';

window.MM = window.MM || {};
(function(){
  const WORLD_TOP = Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;

  const CFG = {
    SCAN_INTERVAL: 1.6,   // seconds between candidate scans
    SCAN_RX: 46, SCAN_RY: 30,
    DENSITY: 0.30,        // fraction of eligible ceiling cells that grow one
    MOISTURE_SCAN: 4,     // rows above the ceiling searched for snow/ice/water
    GROW_TEMP: 0.35,      // seasons temperature below which icicles grow
    MELT_TEMP: 0.50,      // above this a hanging icicle lets go
    GROW_RATE: 1/55,      // full length in ~55 s of cold
    CAP: 140,             // hanging icicles tracked at once
    DRIP_MIN_S: 3.5, DRIP_MAX_S: 9,
    SHARD_G: 46,          // shard gravity (tiles/s^2)
    SHARD_DMG_MIN: 3, SHARD_DMG_MAX: 7,
    ICE_DROP_P: 0.65,     // chance a big shard leaves a collectible ice lump
    MIN_DROP_LEN: 0.45,   // stubs melt away without a pickup
    MIN_MAX_LEN: 0.5,     // shortest an icicle's growth ceiling can be (variation)
    STRIKE_LEN: 0.35,     // a spike shorter than this is too stubby to stab
    STRIKE_DMG: 2,        // light jab when a body walks/jumps into a hanging tip
    STRIKE_INVUL_MS: 320, // one poke per brush, not a per-frame grind
    STRIKE_MIN_SPEED: 0.6,// striking needs MOTION — an AFK body is never poked
  };

  const hang = new Map();  // "x,y" (ceiling cell) -> {x,y,len,drip}
  const shards = [];       // falling: {x,y,len,vy}
  const ghostHang = new Map(); // watcher mirror: "x,y" -> {x,y,len,untilMs}
  const K=(x,y)=>x+','+y;
  let scanT=0, fallen=0, hits=0, noted=false;

  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function nowMs(){ return (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now(); }
  function hash01(x,y){
    let h=(x*374761393)^(y*668265263);
    h=(h^(h>>13))*1274126177;
    return ((h^(h>>16))>>>0)/4294967296;
  }
  function tempAt(x,row){
    try{ const s=MM.seasons; if(s && typeof s.temperatureAt==='function'){ const v=Number(s.temperatureAt(x,row)); if(Number.isFinite(v)) return v; } }catch(e){}
    return 0.5;
  }
  function moist(t){ return t===T.SNOW || t===T.TOXIC_SNOW || t===T.GRASS_SNOW || t===T.ICE || t===T.WATER; }
  function solidCeiling(t){ return t!==undefined && t!==null && !isSkyOpenTile(t) && t!==T.WATER && t!==T.LAVA; }
  // Eligible: solid ceiling, open air below, moisture within a few rows above.
  function eligible(x,y,getTile){
    if(!solidCeiling(getTile(x,y)) || getTile(x,y+1)!==T.AIR) return false;
    for(let dy=1;dy<=CFG.MOISTURE_SCAN;dy++){
      if(y-dy<WORLD_TOP) break;
      if(moist(getTile(x,y-dy))) return true;
    }
    return false;
  }
  function scanAround(player,getTile){
    if(!player || !Number.isFinite(player.x)) return;
    const cx=Math.floor(player.x), cy=Math.floor(player.y);
    const world=MM.world;
    const peek=world && typeof world.peekTile==='function' ? (x,y)=>world.peekTile(x,y,T.AIR) : getTile;
    const y0=Math.max(WORLD_TOP+1,cy-CFG.SCAN_RY), y1=Math.min(WORLD_BOTTOM-2,cy+CFG.SCAN_RY);
    for(let y=y0;y<=y1;y++){
      for(let x=cx-CFG.SCAN_RX;x<=cx+CFG.SCAN_RX;x++){
        if(hang.size>=CFG.CAP) return;
        if(hash01(x,y)>=CFG.DENSITY) continue;
        const k=K(x,y);
        if(hang.has(k) || !eligible(x,y,peek)) continue;
        if(tempAt(x,y)>=CFG.GROW_TEMP) continue;
        hang.set(k,newIcicle(x,y));
      }
    }
  }
  // Per-icicle variation: a deterministic cell hash sets how long this spike
  // can grow and a small horizontal lean — so a cold roof reads as an uneven
  // row of teeth, not a repeated stamp. Kept deterministic so a watcher (which
  // only gets len over the wire) derives the same shape from the coordinates.
  function newIcicle(x,y){
    const s=hash01(x*7+13,y*13+5);
    return {x,y,len:0.12,maxLen:CFG.MIN_MAX_LEN+s*(1-CFG.MIN_MAX_LEN),
      drip:CFG.DRIP_MIN_S+Math.random()*(CFG.DRIP_MAX_S-CFG.DRIP_MIN_S)};
  }
  function dropIcicle(c){
    hang.delete(K(c.x,c.y));
    if(c.len<0.1) return;
    shards.push({x:c.x, y:c.y+1, len:c.len, vy:2});
    fallen++;
  }
  function dripFx(c){
    const tile=(MM&&MM.TILE)||20;
    try{
      const P=MM.particles;
      if(P && P.spawnSplash) P.spawnSplash((c.x+0.5)*tile,(c.y+1+c.len*0.8)*tile,0.06);
    }catch(e){}
    try{ if(MM.audio && MM.audio.play) MM.audio.play('drip',{x:c.x+0.5,y:c.y+1}); }catch(e){}
  }
  function hurtBodies(s,getTile){
    const dmg=Math.round(CFG.SHARD_DMG_MIN+(CFG.SHARD_DMG_MAX-CFG.SHARD_DMG_MIN)*clamp(s.len,0,1));
    const hitBox=(bx,by,bw,bh)=> s.x+1>bx-bw/2 && s.x<bx+bw/2 && s.y+0.6>by-bh && s.y<by+bh*0.6;
    const p=(typeof window!=='undefined' && window.player)||null;
    if(p && Number.isFinite(p.x) && hitBox(p.x,p.y,p.w||0.7,p.h||0.95)){
      try{ if(typeof window.damageHero==='function') window.damageHero(dmg,{cause:'icicle',srcX:s.x+0.5,srcY:s.y-1,kb:0.2,invulMs:300}); }catch(e){}
      hits++;
      return true;
    }
    const bodies=(typeof MM!=='undefined' && MM.coopBodies)||null;
    if(bodies && bodies.length){
      for(const b of bodies){
        if(!b || b.dead || typeof b.hurt!=='function' || !Number.isFinite(b.x)) continue;
        if(hitBox(b.x,b.y,b.w||0.7,b.h||0.95)){
          try{ b.hurt(dmg,{cause:'icicle'}); }catch(e){}
          hits++;
          return true;
        }
      }
    }
    return false;
  }
  // A body walking or jumping INTO a mature hanging tip snaps it: a light jab
  // (host-authoritative damage inlets only), then the spike shatters IN PLACE —
  // never as a falling shard, which would immediately hit the striker a second
  // time and turn a light poke into real damage. Big spikes still leave ice.
  function strikeHang(c,body,isHero){
    const dmg=CFG.STRIKE_DMG;
    if(isHero){
      try{ if(typeof window.damageHero==='function') window.damageHero(dmg,{cause:'icicle',srcX:c.x+0.5,srcY:c.y+1,kb:0.15,invulMs:CFG.STRIKE_INVUL_MS}); }catch(e){}
    } else if(body && typeof body.hurt==='function'){
      try{ body.hurt(dmg,{cause:'icicle'}); }catch(e){}
    }
    hits++;
    hang.delete(K(c.x,c.y));
    shatter({x:c.x,y:c.y+0.6,len:c.len},null);
  }
  function tipStabs(c,bx,by,bw,bh){
    if(Math.abs(c.x+0.5-bx)>bw*0.5+0.15) return false;
    const top=c.y+1, tip=c.y+1+(c.len||0);   // hanging span [ceiling, tip]
    return tip>=by-bh && top<=by+bh*0.6;      // overlaps the body box
  }
  // STRIKING is a motion verb: only a body actually moving into the tip gets
  // poked — an AFK hero under a slowly growing icicle is never stabbed by it.
  function bodyMoving(b){ return Math.abs(Number(b.vx)||0)+Math.abs(Number(b.vy)||0)>=CFG.STRIKE_MIN_SPEED; }
  function bumpBodies(){
    if(!hang.size) return;
    const p=(typeof window!=='undefined' && window.player)||null;
    if(p && Number.isFinite(p.x) && bodyMoving(p)){
      const bw=p.w||0.7, bh=p.h||0.95;
      for(const c of hang.values()){
        if((c.len||0)<CFG.STRIKE_LEN) continue;
        if(tipStabs(c,p.x,p.y,bw,bh)){ strikeHang(c,p,true); return; }
      }
    }
    const bodies=(typeof MM!=='undefined' && MM.coopBodies)||null;
    if(bodies && bodies.length){
      for(const b of bodies){
        if(!b || b.dead || typeof b.hurt!=='function' || !Number.isFinite(b.x) || !bodyMoving(b)) continue;
        for(const c of hang.values()){
          if((c.len||0)<CFG.STRIKE_LEN) continue;
          if(tipStabs(c,b.x,b.y,b.w||0.7,b.h||0.95)){ strikeHang(c,b,false); break; }
        }
      }
    }
  }
  function shatter(s,getTile){
    const tile=(MM&&MM.TILE)||20;
    try{
      const P=MM.particles;
      if(P && P.spawnSplash) P.spawnSplash((s.x+0.5)*tile,(s.y+0.5)*tile,0.22);
    }catch(e){}
    try{ if(MM.audio && MM.audio.play) MM.audio.play('freeze',{x:s.x+0.5,y:s.y}); }catch(e){}
    if(s.len>=CFG.MIN_DROP_LEN && Math.random()<CFG.ICE_DROP_P){
      try{
        const D=MM.drops;
        if(D && D.spawnResource) D.spawnResource(s.x+0.5,s.y+0.2,'ice',1,{source:'icicle',vy:-1.5});
      }catch(e){}
    }
  }
  function update(dt,player,getTile,setTile){
    if(!(dt>0) || typeof getTile!=='function') return;
    scanT-=dt;
    if(scanT<=0){ scanT=CFG.SCAN_INTERVAL; scanAround(player,getTile); }
    for(const [k,c] of hang){
      // ceiling mined away or the air cell filled: the icicle is gone with it
      if(!solidCeiling(getTile(c.x,c.y)) || getTile(c.x,c.y+1)!==T.AIR){ hang.delete(k); continue; }
      const temp=tempAt(c.x,c.y);
      if(temp>=CFG.MELT_TEMP){
        dropIcicle(c);
        if(!noted){
          noted=true;
          try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('icicle','Odwilż strąca sople — lód spada i można go zebrać.'); }catch(e){}
        }
        continue;
      }
      if(temp<CFG.GROW_TEMP) c.len=clamp(c.len+CFG.GROW_RATE*dt,0,c.maxLen||1);
      c.drip-=dt;
      if(c.drip<=0){
        c.drip=CFG.DRIP_MIN_S+Math.random()*(CFG.DRIP_MAX_S-CFG.DRIP_MIN_S);
        dripFx(c);
      }
    }
    bumpBodies();
    for(let i=shards.length-1;i>=0;i--){
      const s=shards[i];
      s.vy=Math.min(30,s.vy+CFG.SHARD_G*dt);
      s.y+=s.vy*dt;
      if(s.y>=WORLD_BOTTOM-1){ shards.splice(i,1); continue; }
      if(hurtBodies(s,getTile)){ shatter(s,getTile); shards.splice(i,1); continue; }
      const below=getTile(Math.floor(s.x),Math.floor(s.y)+1);
      if(below!==T.AIR && !isSkyOpenTile(below) || below===T.WATER){
        shatter(s,getTile);
        shards.splice(i,1);
      }
    }
  }

  // Translucent, per-cell-varied ice: a glassy body you can see through, a
  // brighter frozen core and a specular streak. Width, taper and a slight
  // lean come from the cell hash so no two teeth look stamped from one mould.
  function drawOne(ctx,TILE,x,y,len){
    const s1=hash01(x*7+13,y*13+5), s2=hash01(x*5+2,y*17+9);
    const px=(x+0.5)*TILE, py=(y+1)*TILE;
    const h=Math.max(3,len*TILE*(0.78+s1*0.34));
    const w=Math.max(2.2,TILE*(0.11+s2*0.10)*(0.5+len*0.5));
    const lean=(s1-0.5)*TILE*0.16*len;      // gentle sideways curve
    const tipx=px+lean;
    const hasCurve=typeof ctx.quadraticCurveTo==='function';
    // glassy translucent body
    ctx.fillStyle='rgba(198,227,245,0.44)';
    ctx.beginPath();
    ctx.moveTo(px-w/2,py);
    if(hasCurve){
      ctx.quadraticCurveTo(px-w*0.18+lean*0.3, py+h*0.55, tipx, py+h);
      ctx.quadraticCurveTo(px+w*0.18+lean*0.3, py+h*0.55, px+w/2, py);
    } else {
      ctx.lineTo(tipx,py+h); ctx.lineTo(px+w/2,py);
    }
    ctx.closePath();
    ctx.fill();
    // brighter frozen core (still see-through)
    ctx.fillStyle='rgba(226,243,255,0.5)';
    ctx.beginPath();
    ctx.moveTo(px-w*0.22,py);
    ctx.lineTo(tipx,py+h);
    ctx.lineTo(px+w*0.22,py);
    ctx.closePath();
    ctx.fill();
    // specular streak
    if(typeof ctx.stroke==='function'){
      ctx.strokeStyle='rgba(255,255,255,0.6)';
      ctx.lineWidth=Math.max(0.6,w*0.16);
      ctx.beginPath();
      ctx.moveTo(px-w*0.12,py+1);
      ctx.lineTo(tipx-w*0.05,py+h*0.72);
      ctx.stroke();
    }
  }
  function draw(ctx,TILE,visible){
    if(!ctx) return;
    const mirror=(typeof MM!=='undefined' && MM.ghostMode);
    const src=mirror?ghostHang:hang;
    if(mirror){
      const t=nowMs();
      for(const [k,c] of ghostHang){ if(c.untilMs<t) ghostHang.delete(k); }
    }
    for(const c of src.values()){
      if(typeof visible==='function' && !visible(c.x,c.y+1)) continue;
      drawOne(ctx,TILE,c.x,c.y,c.len);
    }
    for(const s of shards){
      if(typeof visible==='function' && !visible(Math.floor(s.x),Math.floor(s.y))) continue;
      const px=(s.x+0.5)*TILE, py=s.y*TILE;
      ctx.fillStyle='rgba(200,230,248,0.9)';
      ctx.beginPath();
      ctx.moveTo(px-2,py);
      ctx.lineTo(px+2,py);
      ctx.lineTo(px,py+Math.max(3,s.len*TILE*0.7));
      ctx.closePath();
      ctx.fill();
    }
  }

  // --- 'drift' plane extension: hanging icicles mirror to watchers -----------
  function ghostIciclesIn(x0,y0,x1,y1,out){
    out=out||[];
    const ax=Math.floor(Math.min(x0,x1)), bx=Math.floor(Math.max(x0,x1));
    const ay=Math.max(WORLD_TOP,Math.floor(Math.min(y0,y1))), by=Math.min(WORLD_BOTTOM-1,Math.floor(Math.max(y0,y1)));
    for(const c of hang.values()){
      if(out.length>=120) break;
      if(c.x>=ax && c.x<=bx && c.y>=ay && c.y<=by) out.push([c.x,c.y,Math.round(clamp(c.len,0,1)*10)]);
    }
    return out;
  }
  function ghostApplyIciclesWindow(x0,y0,x1,y1,list){
    if(!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) return 0;
    const ax=Math.floor(Math.min(x0,x1)), bx=Math.min(Math.floor(Math.max(x0,x1)), ax+48);
    const ay=Math.max(WORLD_TOP,Math.floor(Math.min(y0,y1))), by=Math.min(WORLD_BOTTOM-1,Math.floor(Math.max(y0,y1)), ay+32);
    for(const [k,c] of ghostHang){
      if(c.x>=ax && c.x<=bx && c.y>=ay && c.y<=by) ghostHang.delete(k);
    }
    const rows=Array.isArray(list)?list.slice(0,120):[];
    const until=nowMs()+6000;
    let n=0;
    for(const row of rows){
      if(!Array.isArray(row) || row.length<3) continue;
      const x=Math.floor(Number(row[0])), y=Math.floor(Number(row[1]));
      if(!Number.isFinite(x) || !Number.isFinite(y) || x<ax || x>bx || y<ay || y>by) continue;
      const len=clamp(Math.floor(Number(row[2]))||0,0,10)/10;
      ghostHang.set(K(x,y),{x,y,len,untilMs:until});
      n++;
    }
    return n;
  }

  function seedAround(px,py,getTile){
    // debug: force-grow mature icicles on every eligible ceiling near the hero
    let n=0;
    const cx=Math.floor(px), cy=Math.floor(py);
    for(let y=cy-14;y<=cy+10;y++){
      for(let x=cx-16;x<=cx+16;x++){
        if(hang.size>=CFG.CAP) return n;
        const k=K(x,y);
        if(hang.has(k) || !eligible(x,y,getTile)) continue;
        const ic=newIcicle(x,y);
        ic.len=Math.min(0.85,ic.maxLen); ic.drip=1+Math.random()*3;
        hang.set(k,ic);
        n++;
      }
    }
    return n;
  }
  function dropAll(){
    let n=0;
    for(const c of [...hang.values()]){ dropIcicle(c); n++; }
    return n;
  }
  function dropAround(px,py,rx,ry){
    px=Number(px); py=Number(py);
    if(!Number.isFinite(px) || !Number.isFinite(py)) return 0;
    const radiusX=Number(rx), radiusY=Number(ry);
    rx=Number.isFinite(radiusX) ? clamp(radiusX,0,96) : 0;
    ry=Number.isFinite(radiusY) ? clamp(radiusY,0,64) : rx;
    let n=0;
    for(const c of [...hang.values()]){
      if(Math.abs(c.x-px)>rx || Math.abs(c.y-py)>ry) continue;
      dropIcicle(c);
      n++;
    }
    return n;
  }

  function reset(){
    hang.clear(); shards.length=0; ghostHang.clear();
    scanT=0; fallen=0; hits=0; noted=false;
  }
  function metrics(){
    return {hanging:hang.size, shards:shards.length, fallen, hits, ghost:ghostHang.size};
  }

  MM.icicles={update, draw, reset, metrics, seedAround, dropAll, dropAround,
    ghostIciclesIn, ghostApplyIciclesWindow, config:CFG,
    _debug:{hang, shards, ghostHang, eligible, scanAround, dropIcicle, hurtBodies, hash01}};
})();

export const icicles = (typeof window!=='undefined' && window.MM) ? window.MM.icicles : globalThis.MM && globalThis.MM.icicles;
export default icicles;
