// SMR nuclear cells: the smallest but ENDLESS power source in the game.
//
// A placed SMR_CELL tile trickles a tiny constant charge into its internal
// buffer (drained by the same electric networks that drink from dynamos and
// solar rigs) — but only while somebody is actually nearby: the host hero or
// any co-op body (MM.coopBodies, zero cost in solo). It is a PERSONAL reactor,
// not an AFK farm.
//
// Maintenance: every INSPECT_INTERVAL the cell raises an inspection alarm
// (message + audible ping + a blinking glyph on the tile). If nobody inspects
// it within INSPECT_WINDOW, the reactor SCRAMs — output stops until someone
// walks up and inspects it again (E via main.js's interact seam). No damage,
// no explosion: the cost of neglect is downtime.
//
// Water: a running reactor is a heat source. With water adjacent it drinks
// ONE full water tile and vents it as STEAM_PER_WATER_TILE cells of real
// T.STEAM gas — deliberately EQUAL to the gases module's STEAM_TO_WATER
// condensation ratio, so the loop is closed by construction:
//   1 water tile -> 5 steam cells -> (gases condensation) -> 1 water tile.
// Guide the plume up a chimney and the condensate rains back down: a nuclear
// steam plant with zero net water loss.
//
// Runtime state (energy, alarm timers, steam credit) is deliberately NOT
// persisted — like solar charge, the TILE is the save; a reload boots every
// reactor fresh, running, with a full inspection interval ahead.
//
// Multiplayer: host-only sim (main.js steps it in the world step). Tiles,
// steam and water replicate over the ordinary planes; presence counts every
// party body, so a guest camping the plant keeps it running.
import { T, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } from '../constants.js';

(function(){
  window.MM = window.MM || {};

  const WORLD_TOP = Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;

  const CFG = {
    RATE: 0.6,                 // E/s — the smallest generation in the game, forever
    CAPACITY: 80,              // internal buffer (mirrors INFO energyCapacity)
    PRESENCE_RADIUS: 14,       // tiles — hero or any co-op body keeps it awake
    INSPECT_INTERVAL: 150,     // seconds of running time between inspections
    INSPECT_WINDOW: 75,        // seconds to answer the alarm before the SCRAM
    INSPECT_REACH: 2.2,        // how close the inspector must stand
    BOIL_INTERVAL: 2.6,        // seconds per vented steam cell (a gentle simmer)
    STEAM_PER_WATER_TILE: 5,   // MUST equal gases.js STEAM_TO_WATER (closed loop)
    SCAN_INTERVAL: 1.4,
    SCAN_RX: 60, SCAN_RY: 40,
    CELL_CAP: 96,
  };

  const cells = new Map(); // "x,y" -> {x,y,energy,on,inspectT,alarmT,steamCredit,boilT,pulse}
  const key = (x,y)=>x+','+y;
  let scanT = 0;
  let scrams = 0, inspections = 0, boiledTiles = 0, ventedCells = 0;
  let alarmNoted = false;

  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function getSafe(getTile,x,y,fallback){
    try{ return typeof getTile==='function' ? getTile(x,y) : fallback; }catch(e){ return fallback; }
  }
  function finiteTile(x,y){ return Number.isFinite(x) && Number.isFinite(y) && y>=WORLD_TOP && y<WORLD_BOTTOM; }
  function isSMRTile(t){ return t===T.SMR_CELL; }
  function msgSafe(text){
    try{ if(typeof window!=='undefined' && typeof window.msg==='function') window.msg(text); }catch(e){}
  }

  function ensureCell(x,y){
    const k=key(x,y);
    let c=cells.get(k);
    if(!c){
      c={x,y,energy:0,on:true,inspectT:CFG.INSPECT_INTERVAL,alarmT:0,steamCredit:0,boilT:CFG.BOIL_INTERVAL,pulse:0};
      cells.set(k,c);
    }
    return c;
  }
  function scanAround(player,getTile){
    if(!player || typeof getTile!=='function') return;
    const cx=Math.floor(player.x), cy=Math.floor(player.y);
    const world=MM.world;
    const peek=world && typeof world.peekTile==='function'
      ? (x,y)=>world.peekTile(x,y,T.AIR)
      : getTile;
    const y0=Math.max(WORLD_TOP,cy-CFG.SCAN_RY), y1=Math.min(WORLD_BOTTOM-1,cy+CFG.SCAN_RY);
    for(let y=y0; y<=y1; y++){
      for(let x=cx-CFG.SCAN_RX; x<=cx+CFG.SCAN_RX; x++){
        if(isSMRTile(getSafe(peek,x,y,T.AIR))) ensureCell(x,y);
      }
    }
    if(cells.size<=CFG.CELL_CAP) return;
    const rows=[...cells.values()].sort((a,b)=>(Math.abs(b.x-cx)+Math.abs(b.y-cy))-(Math.abs(a.x-cx)+Math.abs(a.y-cy)));
    for(let i=0; i<rows.length && cells.size>CFG.CELL_CAP; i++) cells.delete(key(rows[i].x,rows[i].y));
  }
  // Presence: the reactor is a personal machine — the host hero or ANY co-op
  // body within the radius keeps it running (the zero-cost solo guard).
  function presenceNear(c,player){
    if(player && Number.isFinite(player.x) && Number.isFinite(player.y)
      && Math.abs(player.x-(c.x+0.5))<=CFG.PRESENCE_RADIUS && Math.abs(player.y-(c.y+0.5))<=CFG.PRESENCE_RADIUS) return true;
    const bodies=(typeof MM!=='undefined' && MM.coopBodies) || null;
    if(!bodies || !bodies.length) return false;
    for(const b of bodies){
      if(!b || b.dead || !Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
      if(Math.abs(b.x-(c.x+0.5))<=CFG.PRESENCE_RADIUS && Math.abs(b.y-(c.y+0.5))<=CFG.PRESENCE_RADIUS) return true;
    }
    return false;
  }
  function startAlarm(c){
    c.alarmT=CFG.INSPECT_WINDOW;
    msgSafe('☢ Ogniwo SMR ('+c.x+','+c.y+') prosi o kontrolę!');
    try{ if(MM.audio && MM.audio.play) MM.audio.play('alarm',{x:c.x+0.5,y:c.y+0.5}); }catch(e){}
    if(!alarmNoted){
      alarmNoted=true;
      try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('smr','Ogniwo SMR pracuje bez końca — ale prosi o doglądanie.'); }catch(e){}
    }
  }
  function scram(c){
    c.on=false;
    c.alarmT=0;
    c.steamCredit=0;
    scrams++;
    msgSafe('☢ Ogniwo SMR wygasło bez kontroli — podejdź i uruchom je ponownie (E).');
  }
  // The boil pass: a running reactor drinks ONE adjacent water tile per
  // steam-credit refill and simmers it out as real steam gas above itself —
  // exactly STEAM_PER_WATER_TILE cells per tile, the condensation ratio.
  function boilPass(c,dt,getTile,setTile){
    if(c.steamCredit<=0){
      const spots=[[0,-1],[-1,0],[1,0],[0,1],[-1,-1],[1,-1]];
      for(const [dx,dy] of spots){
        const x=c.x+dx, y=c.y+dy;
        if(!finiteTile(x,y) || getSafe(getTile,x,y,T.AIR)!==T.WATER) continue;
        try{ setTile(x,y,T.AIR); }catch(e){ return; }
        if(getSafe(getTile,x,y,T.AIR)!==T.AIR) return;
        try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(x,y,getTile); }catch(e){}
        c.steamCredit=CFG.STEAM_PER_WATER_TILE;
        boiledTiles++;
        break;
      }
      if(c.steamCredit<=0) return;
    }
    c.boilT-=dt;
    if(c.boilT>0) return;
    c.boilT=CFG.BOIL_INTERVAL;
    const g=MM.gases;
    if(!g || typeof g.add!=='function') return;
    // vent above the cell (or beside it when buried under a solid roof)
    for(const [dx,dy] of [[0,-1],[-1,-1],[1,-1],[-1,0],[1,0]]){
      const t=getSafe(getTile,c.x+dx,c.y+dy,T.STONE);
      if(t!==T.AIR && t!==T.STEAM && t!==T.WATER) continue;
      let placed=0;
      try{ placed=g.add('steam',c.x+dx+0.5,c.y+dy+0.5,{power:0.4,cells:1,getTile,setTile:(MM.world&&MM.world.setTile)||undefined}); }catch(e){ placed=0; }
      if(placed>0){
        c.steamCredit--;
        ventedCells++;
        return;
      }
    }
  }
  function update(dt,player,getTile,setTile){
    if(!(dt>0) || !isFinite(dt) || typeof getTile!=='function') return;
    scanT-=dt;
    if(scanT<=0){ scanT=CFG.SCAN_INTERVAL; scanAround(player,getTile); }
    const px=player && Number.isFinite(player.x) ? player.x : 0;
    const py=player && Number.isFinite(player.y) ? player.y : 0;
    for(const [k,c] of cells){
      // Tile validation costs a world access, so it is distance-scoped: cells
      // near the HOST validate every frame (no stale glyph can linger on
      // screen); a far cell is left untouched — a per-frame getTile there
      // would keep far chunks alive — UNLESS a party member attends it, in
      // which case it validates right before working. Presence itself is a
      // pure coordinate check (host hero or any MM.coopBodies guest).
      const nearWorld=Math.abs(c.x-px)<=CFG.SCAN_RX+24 && Math.abs(c.y-py)<=CFG.SCAN_RY+24;
      if(nearWorld && !isSMRTile(getSafe(getTile,c.x,c.y,T.AIR))){ cells.delete(k); continue; }
      c.pulse=Math.max(0,(c.pulse||0)-dt*1.4);
      if(!c.on) continue;
      const present=presenceNear(c,player);
      if(!present) continue; // unattended: idle, timers hold (no sneaky scram)
      if(!nearWorld && !isSMRTile(getSafe(getTile,c.x,c.y,T.AIR))){ cells.delete(k); continue; }
      const before=c.energy;
      c.energy=clamp(c.energy+CFG.RATE*dt,0,CFG.CAPACITY);
      if(c.energy>before) c.pulse=Math.max(c.pulse,0.6);
      if(c.alarmT>0){
        c.alarmT-=dt;
        if(c.alarmT<=0){ scram(c); continue; }
      } else {
        c.inspectT-=dt;
        if(c.inspectT<=0) startAlarm(c);
      }
      if(typeof setTile==='function') boilPass(c,dt,getTile,setTile);
    }
  }
  // Inspection/restart: performed by the host hero standing at the cell
  // (routed through main.js's interact key). Resets the interval; a SCRAMmed
  // reactor boots back up.
  function inspectAt(x,y){
    const c=cells.get(key(Math.floor(x),Math.floor(y)));
    if(!c) return false;
    const wasOff=!c.on;
    c.on=true;
    c.alarmT=0;
    c.inspectT=CFG.INSPECT_INTERVAL;
    c.pulse=1;
    inspections++;
    msgSafe(wasOff ? '☢ Ogniwo SMR uruchomione ponownie.' : '☢ Ogniwo SMR skontrolowane — pracuje dalej.');
    try{ if(MM.audio && MM.audio.play) MM.audio.play('charge',{x:c.x+0.5,y:c.y+0.5}); }catch(e){}
    return true;
  }
  function cellNear(px,py,reach){
    const r=Number.isFinite(reach)?reach:CFG.INSPECT_REACH;
    let best=null, bestD=Infinity;
    for(const c of cells.values()){
      const d=Math.hypot((c.x+0.5)-px,(c.y+0.5)-py);
      if(d<=r && d<bestD){ best=c; bestD=d; }
    }
    return best;
  }
  function inspectNear(player){
    if(!player || !Number.isFinite(player.x)) return false;
    const c=cellNear(player.x,player.y);
    return c ? inspectAt(c.x,c.y) : false;
  }
  // A pending alarm (or a dead reactor) makes E meaningful at the cell — main
  // consults this for interact-key precedence.
  function wantsInteractKey(player){
    if(!player || !Number.isFinite(player.x)) return false;
    return !!cellNear(player.x,player.y);
  }

  // --- electric-network source contract (mirrors solar/dynamo) ---------------
  function sourceAt(x,y,getTile){
    const tx=Math.floor(x), ty=Math.floor(y);
    if(!isSMRTile(getSafe(getTile,tx,ty,T.AIR))) return null;
    ensureCell(tx,ty);
    return {x:tx,y:ty,cells:1,kind:'smr'};
  }
  function energyAt(x,y){
    const c=cells.get(key(Math.floor(x),Math.floor(y)));
    return c ? Math.max(0,c.energy||0) : 0;
  }
  function drainAt(x,y,amount){
    const c=cells.get(key(Math.floor(x),Math.floor(y)));
    if(!c) return null;
    const want=Math.max(0,Number(amount)||0);
    const got=Math.min(want,Math.max(0,c.energy||0));
    if(got<=0) return {amount:0};
    c.energy-=got;
    c.pulse=Math.max(c.pulse||0,0.5);
    return {amount:got};
  }
  function onTileChanged(x,y){
    const k=key(Math.floor(x),Math.floor(y));
    const c=cells.get(k);
    if(c) c.pulse=Math.max(c.pulse||0,0.3);
  }

  // Status glyph over the tile: green breathing dot while running, blinking
  // amber "!" during the inspection window, a dark cross when SCRAMmed.
  function draw(ctx,TILE,visible){
    if(!ctx || !cells.size) return;
    for(const c of cells.values()){
      if(typeof visible==='function' && !visible(c.x,c.y)) continue;
      const px=(c.x+0.5)*TILE, py=c.y*TILE;
      ctx.save();
      if(!c.on){
        ctx.strokeStyle='rgba(20,22,26,0.9)';
        ctx.lineWidth=2;
        ctx.beginPath();
        ctx.moveTo(px-4,py-9); ctx.lineTo(px+4,py-1);
        ctx.moveTo(px+4,py-9); ctx.lineTo(px-4,py-1);
        ctx.stroke();
      } else if(c.alarmT>0){
        const blink=Math.sin(performance.now()*0.012)>0;
        if(blink){
          ctx.fillStyle='rgba(255,190,64,0.95)';
          ctx.font='bold 11px system-ui';
          ctx.textAlign='center';
          ctx.fillText('!',px,py-2);
        }
      } else {
        const a=0.35+0.4*Math.max(0,Math.min(1,c.pulse||0));
        ctx.fillStyle='rgba(110,235,140,'+a.toFixed(3)+')';
        ctx.fillRect(px-1.5,py-6,3,3);
      }
      ctx.restore();
    }
  }

  function reset(){
    cells.clear();
    scanT=0; scrams=0; inspections=0; boiledTiles=0; ventedCells=0;
    alarmNoted=false;
  }
  function metrics(){
    let on=0, alarms=0, off=0, energy=0;
    for(const c of cells.values()){
      if(!c.on) off++;
      else if(c.alarmT>0) alarms++;
      else on++;
      energy+=Math.max(0,c.energy||0);
    }
    return {cells:cells.size, on, alarms, off, energy:+energy.toFixed(2),
      scrams, inspections, boiledTiles, ventedCells,
      loop:{steamPerWaterTile:CFG.STEAM_PER_WATER_TILE}};
  }

  MM.smr={update, draw, reset, metrics, inspectAt, inspectNear, wantsInteractKey,
    sourceAt, energyAt, drainAt, onTileChanged, isSMRTile, config:CFG,
    _debug:{cells, ensureCell, presenceNear, startAlarm, scram, boilPass, cellNear,
      forceAlarm:(x,y)=>{ const c=cells.get(key(Math.floor(x),Math.floor(y))); if(c){ c.inspectT=0; } return !!c; },
      setTimers:(x,y,inspectT,alarmT)=>{ const c=cells.get(key(Math.floor(x),Math.floor(y))); if(!c) return false; if(Number.isFinite(inspectT)) c.inspectT=inspectT; if(Number.isFinite(alarmT)) c.alarmT=alarmT; return true; }}};
})();

export const smr = (typeof window!=='undefined' && window.MM) ? window.MM.smr : globalThis.MM && globalThis.MM.smr;
export default smr;
