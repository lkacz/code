import { INFO, T, WORLD_MAX_Y, WORLD_MIN_Y } from '../constants.js';

const terrainTraps = (function(){
  const MM = (typeof window !== 'undefined') ? (window.MM = window.MM || {}) : {};
  const fx = [];
  const collapses = new Set();
  let fxSeq = 0;

  function finiteTile(x,y){
    return Number.isFinite(x) && Number.isFinite(y) &&
      y >= WORLD_MIN_Y && y < WORLD_MAX_Y && Math.abs(x) < 30000000;
  }
  function h32(x,y,salt=0){
    let h = Math.imul((x|0),374761393) ^ Math.imul((y|0),668265263) ^ Math.imul((salt|0),1274126177);
    h = Math.imul(h ^ (h>>>13),1274126177);
    h ^= h>>>16;
    return h>>>0;
  }
  function rand01(x,y,salt=0){ return h32(x,y,salt) / 4294967296; }
  function isUnstableTile(t){ return t===T.UNSTABLE_SAND || t===T.UNSTABLE_GRASS; }
  function isQuicksandTile(t){ return t===T.QUICKSAND; }
  function canCarve(t){
    const info=INFO[t] || INFO[T.AIR];
    if(t===T.AIR || t===T.POISON_GAS || t===T.FUEL_GAS || t===T.STEAM || t===T.HOT_AIR) return true;
    if(t===T.WATER || t===T.LAVA || t===T.BEDROCK) return false;
    if(info && (info.chestTier || info.cache || info.story || info.unmineable || info.machine)) return false;
    return true;
  }
  function notifyFluid(x,y,getTile){
    try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(x,y,getTile); }catch(e){}
  }
  function spawnDust(x,y,kind){
    const sand=kind==='sand';
    const color=sand ? 'rgba(214,188,112,' : 'rgba(92,132,54,';
    for(let i=0;i<18;i++){
      const r=h32(x*31+i,y*17+i*7,fxSeq++);
      fx.push({
        x:x+0.5+(((r>>>3)&255)/255-0.5)*1.35,
        y:y+0.35+(((r>>>11)&255)/255)*0.55,
        vx:(((r>>>19)&255)/255-0.5)*2.4,
        vy:-0.9-(((r>>>5)&255)/255)*1.8,
        life:0.55+(((r>>>13)&127)/127)*0.45,
        size:0.08+(((r>>>21)&63)/63)*0.09,
        color
      });
    }
  }
  function setTileSafe(x,y,t,getTile,setTile,changed){
    if(!finiteTile(x,y) || typeof setTile!=='function') return false;
    const old=typeof getTile==='function' ? getTile(x,y) : T.AIR;
    if(old===t) return false;
    if(!canCarve(old) && t===T.AIR) return false;
    setTile(x,y,t);
    if(changed) changed.push({x,y,old,t});
    notifyFluid(x,y,getTile);
    return true;
  }
  function collapseAt(x,y,getTile,setTile,opts){
    x=Math.floor(x); y=Math.floor(y);
    if(typeof getTile!=='function' || typeof setTile!=='function' || !finiteTile(x,y)) return false;
    const cover=getTile(x,y);
    if(!isUnstableTile(cover)) return false;
    const key=x+','+y;
    if(collapses.has(key)) return false;
    collapses.add(key);
    const kind=cover===T.UNSTABLE_SAND ? 'sand' : 'grass';
    const changed=[];
    const r=h32(x,y,cover);
    const depth=4+(r%3);
    const extraSide=(r>>>4)%5===0 ? ((r>>>9)&1 ? -1 : 1) : 0;

    setTileSafe(x,y,T.AIR,getTile,setTile,changed);
    for(let dy=1; dy<=depth; dy++){
      const span=dy<=1 ? 1 : (dy>=depth ? 0 : 1);
      for(let dx=-span; dx<=span; dx++){
        setTileSafe(x+dx,y+dy,T.AIR,getTile,setTile,changed);
      }
      if(extraSide && dy===2){
        setTileSafe(x+extraSide*2,y+dy,T.AIR,getTile,setTile,changed);
        setTileSafe(x+extraSide*2,y+dy+1,T.AIR,getTile,setTile,changed);
      }
    }
    for(let dx=-1; dx<=1; dx++){
      if(dx!==0 && rand01(x+dx,y,31)<0.35) continue;
      setTileSafe(x+dx,y+depth+1,T.ROTTEN_MEAT,getTile,setTile,changed);
    }
    try{
      if(MM.gases && MM.gases.add) MM.gases.add('poison',x+0.5,y+Math.min(depth,3),{power:1.5,cells:6,getTile,setTile});
    }catch(e){}
    spawnDust(x,y,kind);
    try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst((x+0.5)*(MM.TILE||20),(y+0.5)*(MM.TILE||20),'common'); }catch(e){}
    if(opts && opts.entity){
      opts.entity.onGround=false;
      opts.entity.vy=Math.max(Number(opts.entity.vy)||0,2.6);
    }
    for(const c of changed){
      if(c.t===T.AIR){
        try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(c.x,c.y); }catch(e){}
      }
    }
    return true;
  }
  function bodyExtents(entity,opts){
    opts=opts||{};
    const halfW=Number.isFinite(opts.halfW) ? opts.halfW : Math.max(0.18,((entity && entity.w)||0.7)/2);
    const halfH=Number.isFinite(opts.halfH) ? opts.halfH : Math.max(0.24,((entity && entity.h)||1.1)/2);
    return {halfW,halfH};
  }
  function stepEntity(entity,getTile,setTile,opts){
    if(!entity || typeof getTile!=='function' || typeof setTile!=='function') return false;
    const ex=bodyExtents(entity,opts);
    const footY=Math.floor(entity.y+ex.halfH+0.07);
    const minX=Math.floor(entity.x-ex.halfW+0.04);
    const maxX=Math.floor(entity.x+ex.halfW-0.04);
    let collapsed=false;
    for(let tx=minX; tx<=maxX; tx++){
      if(isUnstableTile(getTile(tx,footY))){
        collapsed = collapseAt(tx,footY,getTile,setTile,Object.assign({},opts,{entity})) || collapsed;
      }
    }
    return collapsed;
  }
  function quicksandContact(player,getTile){
    if(!player || typeof getTile!=='function') return null;
    const ex=bodyExtents(player);
    const samples=[
      [player.x, player.y+ex.halfH-0.06],
      [player.x-ex.halfW*0.55, player.y+ex.halfH-0.10],
      [player.x+ex.halfW*0.55, player.y+ex.halfH-0.10],
      [player.x, player.y+ex.halfH-0.55],
      [player.x, player.y]
    ];
    for(const p of samples){
      const tx=Math.floor(p[0]), ty=Math.floor(p[1]);
      if(isQuicksandTile(getTile(tx,ty))) return {x:tx,y:ty,halfH:ex.halfH};
    }
    return null;
  }
  function quicksandPuff(player,tile,force){
    const n=force ? 7 : 3;
    for(let i=0;i<n;i++){
      const r=h32(Math.floor(player.x*100)+i,Math.floor(player.y*100),fxSeq++);
      fx.push({
        x:player.x+(((r>>>4)&255)/255-0.5)*0.75,
        y:tile.y+0.55+(((r>>>12)&255)/255)*0.36,
        vx:(((r>>>20)&255)/255-0.5)*0.75,
        vy:-0.18-(((r>>>7)&255)/255)*0.45,
        life:0.38+(((r>>>15)&127)/127)*0.32,
        size:0.07+(((r>>>23)&63)/63)*0.08,
        color:'rgba(202,176,104,'
      });
    }
  }
  function updateHeroQuicksand(dt,player,getTile,setTile,ctx){
    if(!(dt>0) || !player || typeof getTile!=='function') return {inQuicksand:false};
    const tile=quicksandContact(player,getTile);
    const state=player._quicksandState || (player._quicksandState={escape:0,t:0,damageT:0,puffT:0});
    if(!tile){
      state.escape=Math.max(0,state.escape-dt*0.45);
      state.t=0;
      state.damageT=0;
      state.puffT=0;
      return {inQuicksand:false};
    }
    state.t+=dt;
    const foot=player.y+tile.halfH;
    const depth=Math.max(0,Math.min(1.25,foot-tile.y));
    const sink=Math.max(0.35,Math.min(1,depth));
    if(ctx && ctx.jumpPressed){
      state.escape=Math.min(1.25,state.escape+0.24+0.10*(1-sink));
      player.vy=Math.min(Number(player.vy)||0,-1.6);
      quicksandPuff(player,tile,true);
    } else {
      state.escape=Math.max(0,state.escape-dt*(0.17+sink*0.10));
    }
    const slow=Math.max(0,1-dt*(6.5+sink*5.5));
    player.vx*=slow;
    player.vy=Math.min(2.1+sink*0.7,(Number(player.vy)||0)+(5.2+sink*4.0)*dt);
    state.puffT-=dt;
    if(state.puffT<=0){
      state.puffT=0.18+rand01(Math.floor(player.x*10),Math.floor(player.y*10),fxSeq++)*0.18;
      quicksandPuff(player,tile,false);
    }
    if(state.t>1.25 && sink>0.72){
      state.damageT-=dt;
      if(state.damageT<=0){
        state.damageT=0.85;
        try{ if(typeof window!=='undefined' && typeof window.damageHero==='function') window.damageHero(2,{cause:'quicksand',invulMs:360}); }catch(e){}
      }
    }
    if(state.escape>=1){
      state.escape=0;
      state.t=0;
      player.y=tile.y-tile.halfH-0.04;
      player.vy=-7.2;
      player.onGround=false;
      quicksandPuff(player,tile,true);
      return {inQuicksand:true,escaped:true,escape:1,depth:sink};
    }
    return {inQuicksand:true,escaped:false,escape:state.escape,depth:sink};
  }
  function update(dt){
    if(!(dt>0)) return;
    for(let i=fx.length-1;i>=0;i--){
      const p=fx[i];
      p.life-=dt;
      p.vy+=3.8*dt;
      p.x+=p.vx*dt;
      p.y+=p.vy*dt;
      if(p.life<=0) fx.splice(i,1);
    }
  }
  function draw(ctx,TILE,canDrawTile){
    if(!ctx || !fx.length) return;
    ctx.save();
    for(const p of fx){
      if(typeof canDrawTile==='function' && !canDrawTile(Math.floor(p.x),Math.floor(p.y))) continue;
      const a=Math.max(0,Math.min(0.62,p.life*0.9));
      ctx.fillStyle=p.color+a.toFixed(3)+')';
      const s=Math.max(1,p.size*TILE);
      ctx.fillRect(p.x*TILE-s*0.5,p.y*TILE-s*0.5,s,s);
    }
    ctx.restore();
  }
  function reset(){
    fx.length=0;
    collapses.clear();
    fxSeq=0;
  }
  const api={isUnstableTile,isQuicksandTile,collapseAt,stepEntity,updateHeroQuicksand,update,draw,reset,_debug:()=>({fx:fx.length,collapses:collapses.size})};
  MM.terrainTraps=api;
  return api;
})();

export { terrainTraps };
export default terrainTraps;
