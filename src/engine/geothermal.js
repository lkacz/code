// Geothermal heat: lava is a HEAT SOURCE and rock/metal CONDUCT it — there is
// no scripted "hot spring" anywhere. Wherever the world (or the player) stacks
// the organic configuration — water, hot stone under it, lava under that — the
// pool above becomes a natural hot spring: it steams, it slowly heals and
// warms whoever soaks in it (swim-chill does not bite in warm water), and in
// winter the local wildlife walks over to bathe (mobs.js nature drives read
// the pool registry). Metal conducts much better than stone, so a steel spine
// sunk toward a magma pocket is a legitimate engineering project.
//
// The field is demand-driven: heatAt() runs a budgeted Dijkstra from the query
// cell to the nearest lava through per-material conduction losses, memoized
// with a short TTL. It reads ONLY tiles, so a hero-mode guest computes the
// same warmth from its replicated world — comfort is a hero-side system
// (updateHero in runHeroStep), while pool registry/scan is host world sim.
import { T, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } from '../constants.js';

window.MM = window.MM || {};
(function(){
  const WORLD_TOP = Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;

  const CFG = {
    SOURCE_HEAT: 100,     // lava cell temperature
    LOSS_METAL: 9,        // conduction loss per metal tile — the good pipe
    LOSS_STONE: 24,       // per rock-family tile
    LOSS_OTHER: 55,       // per other solid (earth insulates)
    LOSS_FLUID: 40,       // per water/air step (weak convection)
    WARM_AT: 30,          // solid temperature that makes touching water "warm"
    HOT_GLOW_AT: 55,      // solids above this shimmer visibly
    RANGE: 7,             // Dijkstra ring budget (tiles from the query cell)
    EXPAND_CAP: 140,      // Dijkstra node budget per query
    MEMO_TTL_MS: 1600,
    MEMO_CAP: 900,
    POOL_TICK: 2.5,       // pool-scan cadence (seconds)
    POOL_SAMPLES: 10,     // random surface columns probed per tick
    POOL_BAND: 60,
    POOL_TTL_MS: 30000,   // a pool not re-confirmed cools out of the registry
    HEAL_RATE: 0.45,      // hp/s while soaking
    SURFACE_SCAN: 70,
  };

  const memo = new Map();  // "x,y" -> {t, atMs}
  const pools = new Map(); // "x,y" -> {x,y,heat,seenAt} — warm surface water
  const K=(x,y)=>x+','+y;
  let poolAcc=0, noted=false, heroSoaking=false;

  function nowMs(){ return (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now(); }
  function isMetal(t){
    return t===T.STEEL || t===T.METEORIC_IRON || t===T.IRIDIUM || t===T.SILVER_INGOT
      || t===T.GRAPHITE || t===T.GRAPHENE || t===T.SILVER_ORE;
  }
  function isRock(t){
    return t===T.STONE || t===T.GRANITE || t===T.BASALT || t===T.OBSIDIAN || t===T.COAL
      || t===T.GOLD_ORE || t===T.BRICK || t===T.CHIMNEY;
  }
  function stepLoss(t){
    if(t===T.LAVA) return 0;
    if(isMetal(t)) return CFG.LOSS_METAL;
    if(isRock(t)) return CFG.LOSS_STONE;
    if(t===T.WATER || t===T.AIR) return CFG.LOSS_FLUID;
    return CFG.LOSS_OTHER;
  }
  // Budgeted Dijkstra: cheapest conduction path from (x,y) to any lava within
  // RANGE rings. Returns 0..SOURCE_HEAT. Deterministic from tiles alone.
  function computeHeat(x0,y0,getTile){
    const start=getTile(x0,y0);
    if(start===T.LAVA) return CFG.SOURCE_HEAT;
    const dist=new Map();
    const q=[{x:x0,y:y0,c:0}];
    dist.set(K(x0,y0),0);
    let expansions=0;
    while(q.length && expansions<CFG.EXPAND_CAP){
      let bi=0;
      for(let i=1;i<q.length;i++) if(q[i].c<q[bi].c) bi=i;
      const cur=q.splice(bi,1)[0];
      expansions++;
      if(cur.c>=CFG.SOURCE_HEAT) break;
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const nx=cur.x+dx, ny=cur.y+dy;
        if(ny<WORLD_TOP || ny>=WORLD_BOTTOM) continue;
        if(Math.abs(nx-x0)>CFG.RANGE || Math.abs(ny-y0)>CFG.RANGE) continue;
        const t=getTile(nx,ny);
        if(t===T.LAVA) return Math.max(0,CFG.SOURCE_HEAT-cur.c-stepLoss(start)*0.5);
        const nc=cur.c+stepLoss(t);
        if(nc>=CFG.SOURCE_HEAT) continue;
        const nk=K(nx,ny);
        if(nc >= (dist.get(nk) ?? Infinity)) continue;
        dist.set(nk,nc);
        q.push({x:nx,y:ny,c:nc});
      }
    }
    return 0;
  }
  function heatAt(x,y,getTile){
    if(typeof getTile!=='function') return 0;
    x=Math.floor(x); y=Math.floor(y);
    const k=K(x,y);
    const t=nowMs();
    const m=memo.get(k);
    if(m && t-m.atMs<CFG.MEMO_TTL_MS) return m.t;
    if(memo.size>=CFG.MEMO_CAP) memo.clear();
    const heat=computeHeat(x,y,getTile);
    memo.set(k,{t:heat,atMs:t});
    return heat;
  }
  // Warm water: a WATER cell whose bed/walls carry geothermal heat.
  function warmWaterAt(x,y,getTile){
    if(typeof getTile!=='function') return false;
    x=Math.floor(x); y=Math.floor(y);
    if(getTile(x,y)!==T.WATER) return false;
    for(const [dx,dy] of [[0,1],[-1,0],[1,0],[-1,1],[1,1],[0,2]]){
      const t=getTile(x+dx,y+dy);
      if((isRock(t)||isMetal(t)) && heatAt(x+dx,y+dy,getTile)>=CFG.WARM_AT) return true;
      if(t===T.LAVA) return true;
    }
    return false;
  }
  function surfaceAnchor(x){
    try{
      const wg=MM.worldGen;
      if(wg && typeof wg.surfaceHeight==='function'){ const s=Number(wg.surfaceHeight(x)); if(Number.isFinite(s)) return s; }
    }catch(e){}
    return 30;
  }
  function surfaceWaterAt(cx,getTile){
    const from=Math.max(WORLD_TOP+1, Math.floor(surfaceAnchor(cx))-40);
    const until=Math.min(WORLD_BOTTOM, from+CFG.SURFACE_SCAN);
    for(let y=from;y<until;y++){
      const t=getTile(cx,y);
      if(t===T.AIR) continue;
      return t===T.WATER ? y : -1;
    }
    return -1;
  }
  function registerPool(x,y,heat){
    if(pools.size>120 && !pools.has(K(x,y))) return;
    pools.set(K(x,y),{x,y,heat,seenAt:nowMs()});
    if(!noted){
      noted=true;
      try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('hot_spring','Gorące źródło! Lawa grzeje kamień, kamień grzeje wodę.'); }catch(e){}
    }
  }
  function poolScan(px,getTile){
    for(let i=0;i<CFG.POOL_SAMPLES;i++){
      const cx=px+(Math.random()<0.5?-1:1)*Math.floor(Math.random()*CFG.POOL_BAND);
      const y=surfaceWaterAt(cx,getTile);
      if(y<0) continue;
      if(warmWaterAt(cx,y,getTile)) registerPool(cx,y,heatAt(cx,y+1,getTile));
    }
    const t=nowMs();
    for(const [k,p] of pools){
      if(t-p.seenAt>CFG.POOL_TTL_MS){ pools.delete(k); continue; }
      if(getTile(p.x,p.y)!==T.WATER) pools.delete(k);
    }
  }
  function poolsNear(x,r){
    const out=[];
    for(const p of pools.values()){
      if(Math.abs(p.x-x)<=r) out.push(p);
    }
    return out;
  }
  // Hero comfort (hero-side system — also steps in a guest's runHeroStep):
  // soaking in warm water heals slowly; the caller (main.js) additionally uses
  // heroSoaking to exempt the soak from swim-chill.
  function updateHero(dt,body,getTile){
    heroSoaking=false;
    if(!(dt>0) || !body || !Number.isFinite(body.x) || typeof getTile!=='function') return;
    const cx=Math.floor(body.x), cy=Math.floor(body.y);
    if(getTile(cx,cy)!==T.WATER && getTile(cx,cy+1)!==T.WATER) return;
    const wy=getTile(cx,cy)===T.WATER?cy:cy+1;
    if(!warmWaterAt(cx,wy,getTile)) return;
    heroSoaking=true;
    if(Number.isFinite(body.hp) && Number.isFinite(body.maxHp) && body.hp>0 && body.hp<body.maxHp){
      body.hp=Math.min(body.maxHp,body.hp+CFG.HEAL_RATE*dt);
    }
  }
  function heroInWarmWater(){ return heroSoaking; }
  // Any body soaking? (ghost_host body survival consults this per co-op body.)
  function bodyInWarmWater(b,getTile){
    if(!b || !Number.isFinite(b.x) || typeof getTile!=='function') return false;
    const cx=Math.floor(b.x), cy=Math.floor(b.y);
    if(getTile(cx,cy)===T.WATER) return warmWaterAt(cx,cy,getTile);
    if(getTile(cx,cy+1)===T.WATER) return warmWaterAt(cx,cy+1,getTile);
    return false;
  }
  function update(dt,player,getTile,setTile){
    if(!(dt>0) || typeof getTile!=='function') return;
    updateHero(dt,player,getTile);
    poolAcc+=dt;
    if(poolAcc>=CFG.POOL_TICK){
      poolAcc=0;
      const px=(player && Number.isFinite(player.x))?Math.floor(player.x):0;
      poolScan(px,getTile);
    }
  }

  // Steam wisps over registered pools + a shimmer on visibly hot solids near
  // them. Pure canvas — no gas volume is minted (the water stays volume-true).
  function draw(ctx,TILE,visible){
    if(!ctx || !pools.size) return;
    const t=nowMs()*0.001;
    ctx.save();
    for(const p of pools.values()){
      if(typeof visible==='function' && !visible(p.x,p.y)) continue;
      const baseX=(p.x+0.5)*TILE, baseY=p.y*TILE;
      for(let i=0;i<3;i++){
        const ph=t*0.9+i*2.1+p.x*0.7;
        const rise=((ph%2)/2);
        const wx=baseX+Math.sin(ph*2.2)*TILE*0.22;
        const wy=baseY-rise*TILE*1.6;
        const a=0.22*(1-rise);
        if(a<=0.02) continue;
        ctx.fillStyle='rgba(232,240,244,'+a.toFixed(3)+')';
        ctx.beginPath();
        ctx.arc(wx,wy,TILE*(0.10+rise*0.16),0,Math.PI*2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // Debug: raise the organic configuration next to the hero — a stone basin
  // with water, a hot-rock bed and a lava pocket UNDER it. No scripted magic:
  // the same heatAt() conduction makes it a spring.
  function buildSpring(px,py,getTile,setTile){
    if(typeof getTile!=='function' || typeof setTile!=='function') return false;
    const x0=Math.floor(px)+3, y0=Math.floor(py);
    for(let dx=0;dx<5;dx++){
      for(let dy=-1;dy<=3;dy++){
        const x=x0+dx, y=y0+dy;
        if(dy<=0) setTile(x,y,dx===0||dx===4?T.STONE:T.WATER);      // basin walls + water
        else if(dy===1) setTile(x,y,T.STONE);                        // hot-rock bed
        else setTile(x,y,dx>=1&&dx<=3?T.LAVA:T.STONE);               // lava pocket
      }
    }
    try{ if(MM.water && MM.water.onTileChanged){ for(let dx=1;dx<4;dx++) MM.water.onTileChanged(x0+dx,y0-1,getTile); } }catch(e){}
    memo.clear();
    return true;
  }

  function reset(){
    memo.clear(); pools.clear();
    poolAcc=0; noted=false; heroSoaking=false;
  }
  function metrics(){
    return {pools:pools.size, memo:memo.size, heroSoaking};
  }

  MM.geothermal={update, updateHero, draw, reset, metrics,
    heatAt, warmWaterAt, heroInWarmWater, bodyInWarmWater, poolsNear, buildSpring, config:CFG,
    _debug:{memo, pools, computeHeat, stepLoss, isMetal, isRock, poolScan, surfaceWaterAt}};
})();

export const geothermal = (typeof window!=='undefined' && window.MM) ? window.MM.geothermal : globalThis.MM && globalThis.MM.geothermal;
export default geothermal;
