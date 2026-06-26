import { T, WORLD_H } from '../constants.js';
import { isBlastProtectedTile, isObjectFootingTile, isPassableForFalling, isReplaceableNaturalOpenTile } from './material_physics.js';
import { worldGen as WORLDGEN } from './worldgen.js';

(function(){
  window.MM = window.MM || {};

  const ACTIVE_RANGE = 760;
  const MASTER_INTERVAL = 600; // about ten minutes while the volcano is active
  const MASTER_FLOOR_SECONDS = 10;
  const SERVANT_FLOOR_SECONDS = 10;
  const MASTER_EJECTION_FORCE = 3;
  const MAX_ROCKS = 56;
  const MAX_MASTER_SHOTS = 8;
  const ROCK_DYNAMO_DESTROY_CHANCE = 0.20;
  const rocks = [];
  const masterShots = [];
  const masterTiles = new Map(); // "x,y" -> {x,y,t,stage}
  const volcanoState = new Map();
  let scanT = 0;
  let masterScanT = 0;
  let activeVolcanoes = [];

  function wg(){ return (window.MM && MM.worldGen) || WORLDGEN; }
  function key(x,y){ return (x|0)+','+(y|0); }
  function finiteNumber(n){ return Number.isFinite(n); }
  function finiteTile(x,y){ return finiteNumber(x) && finiteNumber(y) && y>=0 && y<WORLD_H && Math.abs(x)<100000000; }
  function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }
  function projectileOpen(t){ return isPassableForFalling(t) || t===T.LAVA; }
  function supportSolid(t){ return isObjectFootingTile(t); }
  function volcanoId(v){ return v && v.cell!=null ? 'c'+v.cell : 'x'+Math.round(v ? v.center : 0); }
  function randomRange(a,b){ return a + Math.random()*(b-a); }
  function seeded(v,salt){
    const W=wg();
    return W && W.randSeed ? W.randSeed((v.center||0)*0.173 + salt) : Math.random();
  }
  function craterPoint(v){
    const W=wg();
    const x=Math.round(v.center||0);
    const y=Math.max(2, Math.min(WORLD_H-6, Math.round(W && W.surfaceHeight ? W.surfaceHeight(x) : 62)));
    return {x,y};
  }
  function stateFor(v){
    const id=volcanoId(v);
    let s=volcanoState.get(id);
    if(!s){
      s={
        gasT: 5 + seeded(v,4701)*18,
        rockT: 8 + seeded(v,4702)*22,
        masterT: MASTER_INTERVAL*(0.75 + seeded(v,4703)*0.5),
        diamondT: 0
      };
      volcanoState.set(id,s);
    }
    return s;
  }
  function addVolcano(out,v,px){
    if(!v || !Number.isFinite(v.center)) return false;
    if(Math.abs(v.center-px)>ACTIVE_RANGE) return false;
    out.set(volcanoId(v),v);
    return true;
  }
  function collectActiveVolcanoes(px){
    const W=wg();
    const out=new Map();
    if(!W) return [];
    if(W.volcanoAt) addVolcano(out,W.volcanoAt(Math.round(px)),px);
    if(W.nearestVolcano){
      for(const dir of [-1,1]){
        let start=px;
        for(let i=0;i<5;i++){
          const v=W.nearestVolcano(start,dir,8);
          if(!addVolcano(out,v,px)) break;
          start = v.center + dir*((v.radius||24)+4);
        }
      }
    }
    return [...out.values()];
  }
  function nearestVolcanoNear(px,dir){
    const W=wg();
    if(!W) return null;
    const candidates=[];
    if(W.volcanoAt){
      const cur=W.volcanoAt(Math.round(px));
      if(cur) candidates.push(cur);
    }
    if(W.nearestVolcano){
      const left=W.nearestVolcano(px,-1,18);
      const right=W.nearestVolcano(px,1,18);
      if(dir<0 && left) return left;
      if(dir>0 && right) return right;
      if(left) candidates.push(left);
      if(right) candidates.push(right);
    }
    candidates.sort((a,b)=>Math.abs(a.center-px)-Math.abs(b.center-px));
    return candidates[0] || null;
  }
  function sparkBurst(x,y,tier){
    try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(x*(MM.TILE||20), y*(MM.TILE||20), tier||'epic'); }catch(e){}
  }
  function smokeAt(x,y,power){
    try{ if(MM.particles && MM.particles.spawnSmoke) MM.particles.spawnSmoke(x*(MM.TILE||20), y*(MM.TILE||20), power||2, {tileX:Math.floor(x), tileY:Math.floor(y), tileSize:MM.TILE||20}); }catch(e){}
  }
  function say(text){ try{ if(window.msg) window.msg(text); }catch(e){} }

  function emitGas(v){
    const c=craterPoint(v);
    try{ if(MM.gases && MM.gases.add) MM.gases.add('poison',c.x+0.5,c.y-0.8,{power:1.6,cells:7}); }catch(e){}
    try{ if(MM.weapons && MM.weapons.spawnGasCloud) MM.weapons.spawnGasCloud(c.x+0.5, c.y-0.8, 1.45); }catch(e){}
    return true;
  }
  function spawnRock(v){
    const c=craterPoint(v);
    const count=Math.random()<0.35 ? 2 : 1;
    for(let i=0;i<count;i++){
      if(rocks.length>=MAX_ROCKS) rocks.shift();
      const side=Math.random()<0.5 ? -1 : 1;
      rocks.push({
        x:c.x+0.5+(Math.random()-0.5)*0.6,
        y:c.y-1.2,
        vx:side*randomRange(4.2,8.2),
        vy:-randomRange(9.5,14.5),
        life:9,
        rot:Math.random()*Math.PI*2,
        spin:side*randomRange(5,10)
      });
    }
    smokeAt(c.x+0.5,c.y-0.5,1.2);
    return count;
  }
  function spawnMaster(v,reason){
    if(!v) return false;
    const c=craterPoint(v);
    if(masterShots.length>=MAX_MASTER_SHOTS) masterShots.shift();
    const side=Math.random()<0.5 ? -1 : 1;
    masterShots.push({
      x:c.x+0.5,
      y:c.y-1.5,
      vx:side*randomRange(5.0,8.0)*MASTER_EJECTION_FORCE,
      vy:-randomRange(12.5,16.5)*MASTER_EJECTION_FORCE,
      life:13,
      rot:Math.random()*Math.PI*2,
      spin:side*randomRange(7,12),
      reason:reason||'timer'
    });
    sparkBurst(c.x+0.5,c.y-1,'epic');
    smokeAt(c.x+0.5,c.y-0.7,3.2);
    try{ if(MM.audio && MM.audio.play) MM.audio.play('masterstone'); }catch(e){}
    if(reason==='diamond') say('Wulkan przyjal diament i wyrzucil kamien mistrza!');
    else if(reason==='debug') say('Debug: wulkan wyrzucil kamien mistrza');
    else say('Wulkan wyrzucil kamien mistrza!');
    return true;
  }
  function forceMasterEruption(arg){
    let v = arg && typeof arg==='object' && Number.isFinite(arg.center) ? arg : null;
    let dir = 0;
    if(typeof arg==='number') dir = arg<0 ? -1 : 1;
    if(!v){
      const pl=(typeof window!=='undefined' && window.player) || null;
      const px=pl && Number.isFinite(pl.x) ? pl.x : 0;
      v=nearestVolcanoNear(px,dir);
    }
    if(!v){ say('Brak wulkanu w poblizu'); return false; }
    const s=stateFor(v);
    s.masterT=MASTER_INTERVAL;
    return spawnMaster(v,'debug');
  }
  function findRestCell(tx,ty,getTile,allowLava){
    const candidates=[];
    for(let dy=-3; dy<=2; dy++){
      for(let dx=-3; dx<=3; dx++){
        const x=tx+dx, y=ty+dy;
        if(y<1 || y>=WORLD_H-2) continue;
        const here=getTile(x,y);
        if(!isReplaceableNaturalOpenTile(here,allowLava)) continue;
        const below=getTile(x,y+1);
        if(supportSolid(below)) candidates.push({x,y,score:Math.abs(dx)*1.2+Math.abs(dy)});
      }
    }
    candidates.sort((a,b)=>a.score-b.score);
    return candidates[0] || null;
  }
  function maybeDestroyDynamoAt(tx,ty,getTile,setTile){
    if(typeof getTile!=='function' || typeof setTile!=='function') return false;
    const t=getTile(tx,ty);
    if(t!==T.DYNAMO && t!==T.DYNAMO_SLOT) return false;
    if(Math.random()>=ROCK_DYNAMO_DESTROY_CHANCE) return false;
    let cells=null;
    try{ if(MM.dynamo && MM.dynamo.structureCellsAt) cells=MM.dynamo.structureCellsAt(tx,ty,getTile); }catch(e){ cells=null; }
    if(!Array.isArray(cells) || !cells.length) cells=[{x:tx,y:ty}];
    for(const c of cells){
      const x=c.x|0, y=c.y|0;
      const old=getTile(x,y);
      if(old!==T.DYNAMO && old!==T.DYNAMO_SLOT) continue;
      setTile(x,y,T.AIR);
      try{ if(MM.dynamo && MM.dynamo.onTileChanged) MM.dynamo.onTileChanged(x,y,old,T.AIR); }catch(e){}
      try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(x,y); }catch(e){}
      try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(x,y,getTile); }catch(e){}
    }
    smokeAt(tx+0.5,ty+0.4,1.4);
    return true;
  }
  function impactRock(r,getTile,setTile){
    const tx=Math.floor(r.x), ty=Math.floor(r.y);
    sparkBurst(r.x,r.y,'common');
    if(maybeDestroyDynamoAt(tx,ty,getTile,setTile)) return;
    if(typeof setTile==='function' && Math.random()<0.45){
      const rest=findRestCell(tx,ty,getTile,false);
      if(rest && getTile(rest.x,rest.y)!==T.LAVA){
        const old=getTile(rest.x,rest.y);
        setTile(rest.x,rest.y,T.STONE);
        if(old===T.WATER){ try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(rest.x,rest.y,getTile); }catch(e){} }
        try{ if(MM.fallingSolids && MM.fallingSolids.afterPlacement) MM.fallingSolids.afterPlacement(rest.x,rest.y); }catch(e){}
      }
    }
  }
  function trackMasterStone(x,y,age,stage){
    const s=stage==='servant' ? 'servant' : 'master';
    masterTiles.set(key(x,y),{x:x|0,y:y|0,t:Math.max(0,age||0),stage:s});
  }
  function settleMasterShot(m,getTile,setTile){
    const tx=Math.floor(m.x), ty=Math.floor(m.y);
    const rest=findRestCell(tx,ty,getTile,false) || findRestCell(tx,ty,getTile,true);
    if(!rest || typeof setTile!=='function'){
      sparkBurst(m.x,m.y,'epic');
      return false;
    }
    const old=getTile(rest.x,rest.y);
    if(!isReplaceableNaturalOpenTile(old,false)) return false;
    setTile(rest.x,rest.y,T.VOLCANO_MASTER_STONE);
    trackMasterStone(rest.x,rest.y,0);
    if(old===T.WATER){ try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(rest.x,rest.y,getTile); }catch(e){} }
    sparkBurst(rest.x+0.5,rest.y+0.5,'epic');
    smokeAt(rest.x+0.5,rest.y+0.4,2.8);
    return true;
  }
  function notifyTileChanged(x,y,oldTile,newTile,getTile){
    if(oldTile===newTile) return;
    try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved && oldTile!==T.AIR && newTile===T.AIR) MM.fallingSolids.onTileRemoved(x,y); }catch(e){}
    try{ if(MM.fallingSolids && MM.fallingSolids.afterPlacement && newTile!==T.AIR) MM.fallingSolids.afterPlacement(x,y); }catch(e){}
    try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(x,y,getTile); }catch(e){}
  }
  function fallbackServantExplosion(x,y,getTile,setTile){
    if(typeof getTile!=='function' || typeof setTile!=='function') return false;
    const R=3.1;
    const ri=Math.ceil(R);
    for(let dy=-ri; dy<=ri; dy++){
      for(let dx=-ri; dx<=ri; dx++){
        if(dx*dx+dy*dy>R*R) continue;
        const tx=x+dx, ty=y+dy;
        if(ty<1 || ty>=WORLD_H-3) continue;
        const t=getTile(tx,ty);
        if(isBlastProtectedTile(t)) continue;
        setTile(tx,ty,T.AIR);
        notifyTileChanged(tx,ty,t,T.AIR,getTile);
      }
    }
    sparkBurst(x+0.5,y+0.5,'epic');
    smokeAt(x+0.5,y+0.4,4.0);
    try{ if(MM.audio && MM.audio.play) MM.audio.play('explosion'); }catch(e){}
    return true;
  }
  function explodeServantStone(m,getTile,setTile){
    const x=m.x|0, y=m.y|0;
    const old=getTile(x,y);
    if(old===T.SERVANT_STONE || old===T.VOLCANO_MASTER_STONE){
      setTile(x,y,T.AIR);
      notifyTileChanged(x,y,old,T.AIR,getTile);
    }
    let ok=false;
    try{
      if(MM.weapons && MM.weapons.explodeAt){
        ok=!!MM.weapons.explodeAt(x+0.5,y+0.5,getTile,setTile,{force:true,extraConsumed:18});
      }
    }catch(e){ ok=false; }
    if(!ok) ok=fallbackServantExplosion(x,y,getTile,setTile);
    sparkBurst(x+0.5,y+0.5,'epic');
    smokeAt(x+0.5,y+0.4,3.5);
    return ok;
  }
  function hurtHeroFromProjectile(obj,damage){
    const pl=(typeof window!=='undefined' && window.player) || null;
    if(!pl || typeof window.damageHero!=='function') return;
    const dx=pl.x-obj.x, dy=(pl.y-0.35)-obj.y;
    if(dx*dx+dy*dy>0.65) return;
    window.damageHero(damage,{srcX:obj.x,srcY:obj.y,kb:4,kbY:-3,cause:'volcano'});
  }
  function updateRocks(dt,getTile,setTile){
    for(let i=rocks.length-1;i>=0;i--){
      const r=rocks[i];
      r.life-=dt;
      if(r.life<=0 || r.y>=WORLD_H-1){ rocks.splice(i,1); continue; }
      const steps=Math.max(1, Math.ceil(Math.max(Math.abs(r.vx),Math.abs(r.vy))*dt/0.35));
      const sdt=dt/steps;
      let done=false;
      for(let s=0;s<steps;s++){
        r.x+=r.vx*sdt; r.y+=r.vy*sdt; r.vy+=22*sdt; r.vx*=1-Math.min(0.12,sdt*0.28); r.rot+=r.spin*sdt;
        hurtHeroFromProjectile(r,8);
        const tx=Math.floor(r.x), ty=Math.floor(r.y);
        const t=getTile(tx,ty);
        if(t===T.LAVA){ smokeAt(r.x,r.y,1.1); done=true; break; }
        if(!projectileOpen(t)){
          impactRock(r,getTile,setTile);
          done=true;
          break;
        }
      }
      if(done) rocks.splice(i,1);
    }
  }
  function updateMasterShots(dt,getTile,setTile){
    for(let i=masterShots.length-1;i>=0;i--){
      const m=masterShots[i];
      m.life-=dt;
      if(m.life<=0 || m.y>=WORLD_H-1){ settleMasterShot(m,getTile,setTile); masterShots.splice(i,1); continue; }
      const steps=Math.max(1, Math.ceil(Math.max(Math.abs(m.vx),Math.abs(m.vy))*dt/0.32));
      const sdt=dt/steps;
      let done=false;
      for(let s=0;s<steps;s++){
        m.x+=m.vx*sdt; m.y+=m.vy*sdt; m.vy+=18*sdt; m.vx*=1-Math.min(0.08,sdt*0.2); m.rot+=m.spin*sdt;
        const tx=Math.floor(m.x), ty=Math.floor(m.y);
        if(ty>=WORLD_H-2 || !projectileOpen(getTile(tx,ty))){
          settleMasterShot(m,getTile,setTile);
          done=true;
          break;
        }
      }
      if(done) masterShots.splice(i,1);
    }
  }
  function updateMasterTiles(dt,getTile,setTile){
    for(const [k,m] of [...masterTiles.entries()]){
      const tile=getTile(m.x,m.y);
      if(tile!==T.VOLCANO_MASTER_STONE && tile!==T.SERVANT_STONE){ masterTiles.delete(k); continue; }
      const stage=tile===T.SERVANT_STONE ? 'servant' : (m.stage==='servant' ? 'servant' : 'master');
      m.stage=stage;
      if(!supportSolid(getTile(m.x,m.y+1))){ m.t=0; continue; }
      m.t+=dt;
      if(stage==='master' && m.t>=MASTER_FLOOR_SECONDS){
        setTile(m.x,m.y,T.SERVANT_STONE);
        notifyTileChanged(m.x,m.y,T.VOLCANO_MASTER_STONE,T.SERVANT_STONE,getTile);
        m.t=0;
        m.stage='servant';
        sparkBurst(m.x+0.5,m.y+0.5,'epic');
        smokeAt(m.x+0.5,m.y+0.4,2.5);
      } else if(stage==='servant' && m.t>=SERVANT_FLOOR_SECONDS){
        explodeServantStone(m,getTile,setTile);
        masterTiles.delete(k);
      }
    }
  }
  function scanMasterTilesNear(player,getTile){
    if(!player) return;
    const W=(window.MM && MM.world) || null;
    const readTile=(W && typeof W.peekTile==='function')
      ? ((x,y)=>W.peekTile(x,y,T.AIR))
      : getTile;
    const px=Math.floor(player.x);
    const sx=px-90, ex=px+90;
    for(let x=sx; x<=ex; x++){
      for(let y=0; y<WORLD_H; y++){
        const t=readTile(x,y);
        if((t===T.VOLCANO_MASTER_STONE || t===T.SERVANT_STONE) && !masterTiles.has(key(x,y))) trackMasterStone(x,y,0,t===T.SERVANT_STONE?'servant':'master');
      }
    }
  }
  function isDiamondOfferingCell(v,x,y,getTile){
    const c=craterPoint(v);
    const crater=(v.crater||2)+2;
    if(Math.abs(x-c.x)>crater+2 || y<c.y-4 || y>c.y+5) return false;
    if(Math.abs(x-c.x)<=crater && y>=c.y-2 && y<=c.y+4) return true;
    for(let dy=-1; dy<=1; dy++) for(let dx=-1; dx<=1; dx++) if(getTile(x+dx,y+dy)===T.LAVA) return true;
    return false;
  }
  function consumeDiamondTriggers(v,getTile,setTile){
    if(typeof setTile!=='function') return false;
    const c=craterPoint(v);
    const rx=(v.crater||2)+4;
    for(let y=c.y-4; y<=c.y+5; y++){
      for(let x=c.x-rx; x<=c.x+rx; x++){
        if(getTile(x,y)!==T.DIAMOND) continue;
        if(!isDiamondOfferingCell(v,x,y,getTile)) continue;
        setTile(x,y,T.AIR);
        try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(x,y); }catch(e){}
        try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(x,y,getTile); }catch(e){}
        const s=stateFor(v);
        s.masterT=MASTER_INTERVAL;
        spawnMaster(v,'diamond');
        return true;
      }
    }
    return false;
  }
  function onTileChanged(x,y,t,getTile,setTile){
    if(t===T.VOLCANO_MASTER_STONE) trackMasterStone(x,y,0,'master');
    if(t===T.SERVANT_STONE) trackMasterStone(x,y,0,'servant');
    if(t!==T.DIAMOND) return false;
    const W=wg();
    let v=null;
    if(W && W.volcanoAt) v=W.volcanoAt(Math.round(x));
    if(!v) v=nearestVolcanoNear(x,0);
    if(!v || Math.abs(v.center-x)>(v.radius||24)+8) return false;
    if(isDiamondOfferingCell(v,x,y,getTile)) return consumeDiamondTriggers(v,getTile,setTile);
    return false;
  }
  function update(dt,player,getTile,setTile){
    if(!(dt>0) || !isFinite(dt) || typeof getTile!=='function' || typeof setTile!=='function') return;
    scanT-=dt;
    if(scanT<=0){
      scanT=1.0;
      const px=player && Number.isFinite(player.x) ? player.x : 0;
      activeVolcanoes=collectActiveVolcanoes(px);
    }
    for(const v of activeVolcanoes){
      const s=stateFor(v);
      s.gasT-=dt; s.rockT-=dt; s.masterT-=dt; s.diamondT-=dt;
      if(s.gasT<=0){ emitGas(v); s.gasT=randomRange(14,32); }
      if(s.rockT<=0){ spawnRock(v); s.rockT=randomRange(12,30); }
      if(s.masterT<=0){ spawnMaster(v,'timer'); s.masterT=MASTER_INTERVAL*randomRange(0.8,1.25); }
      if(s.diamondT<=0){ consumeDiamondTriggers(v,getTile,setTile); s.diamondT=0.35; }
    }
    updateRocks(dt,getTile,setTile);
    updateMasterShots(dt,getTile,setTile);
    updateMasterTiles(dt,getTile,setTile);
    masterScanT-=dt;
    if(masterScanT<=0){
      masterScanT=3.0;
      scanMasterTilesNear(player,getTile);
    }
  }
  function drawMasterGlyph(ctx,cx,cy,size,pulse,rot,stage){
    const servant=stage==='servant';
    const r=size*(0.72+0.12*pulse);
    const g=ctx.createRadialGradient(cx,cy,2,cx,cy,r*2.6);
    g.addColorStop(0,servant?'rgba(255,230,100,0.68)':'rgba(255,226,92,0.82)');
    g.addColorStop(0.38,servant?'rgba(255,72,32,0.28)':'rgba(255,106,33,0.36)');
    g.addColorStop(1,'rgba(255,40,0,0)');
    ctx.fillStyle=g;
    ctx.beginPath(); ctx.arc(cx,cy,r*2.6,0,Math.PI*2); ctx.fill();
    ctx.save();
    ctx.translate(cx,cy);
    ctx.rotate(rot||0);
    ctx.fillStyle=servant?'#7a2417':'#ff6a21';
    ctx.beginPath();
    ctx.moveTo(0,-r);
    ctx.lineTo(r*0.8,0);
    ctx.lineTo(0,r);
    ctx.lineTo(-r*0.8,0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle=servant?'rgba(255,190,56,0.98)':'rgba(255,238,124,0.95)';
    ctx.lineWidth=Math.max(1.5,size*0.12);
    ctx.stroke();
    ctx.strokeStyle=servant?'rgba(255,64,32,0.95)':'rgba(255,83,55,0.85)';
    ctx.lineWidth=Math.max(1,size*0.07);
    ctx.beginPath();
    ctx.moveTo(-r*0.45,0); ctx.lineTo(r*0.45,0);
    ctx.moveTo(0,-r*0.52); ctx.lineTo(0,r*0.52);
    ctx.stroke();
    ctx.restore();
    for(let i=0;i<6;i++){
      const a=(i/6)*Math.PI*2 + (rot||0)*0.7;
      const sx=cx+Math.cos(a)*r*(1.55+0.25*pulse);
      const sy=cy+Math.sin(a)*r*(1.05+0.2*pulse);
      ctx.fillStyle=servant
        ? (i%2?'rgba(255,58,32,0.94)':'rgba(255,214,83,0.9)')
        : (i%2?'rgba(255,214,83,0.95)':'rgba(255,120,32,0.92)');
      ctx.fillRect(sx-1.5,sy-1.5,3,3);
    }
  }
  function draw(ctx,TILE,canDrawTile,getTile){
    const visibleTile=typeof canDrawTile==='function'?canDrawTile:null;
    const tileVisible=(x,y)=>!visibleTile || visibleTile(Math.floor(x),Math.floor(y));
    const now=(typeof performance!=='undefined' && performance.now)?performance.now():Date.now();
    if(rocks.length){
      ctx.save();
      for(const r of rocks){
        if(!tileVisible(r.x,r.y)) continue;
        ctx.save();
        ctx.translate(r.x*TILE,r.y*TILE);
        ctx.rotate(r.rot||0);
        ctx.fillStyle='#7a7770';
        ctx.fillRect(-TILE*0.24,-TILE*0.21,TILE*0.48,TILE*0.42);
        ctx.fillStyle='rgba(255,255,255,0.18)';
        ctx.fillRect(-TILE*0.18,-TILE*0.17,TILE*0.18,TILE*0.08);
        ctx.restore();
      }
      ctx.restore();
    }
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    for(const m of masterShots){
      if(!tileVisible(m.x,m.y)) continue;
      const pulse=Math.sin(now*0.012 + m.x)*0.5+0.5;
      drawMasterGlyph(ctx,m.x*TILE,m.y*TILE,TILE*0.46,pulse,m.rot||0,'master');
    }
    for(const mt of masterTiles.values()){
      const tile=getTile ? getTile(mt.x,mt.y) : (mt.stage==='servant'?T.SERVANT_STONE:T.VOLCANO_MASTER_STONE);
      if(tile!==T.VOLCANO_MASTER_STONE && tile!==T.SERVANT_STONE) continue;
      if(!tileVisible(mt.x,mt.y)) continue;
      const stage=tile===T.SERVANT_STONE?'servant':'master';
      const cx=(mt.x+0.5)*TILE, cy=(mt.y+0.5)*TILE;
      const pulse=Math.sin(now*(stage==='servant'?0.012:0.006) + mt.x*0.9 + mt.y*0.4)*0.5+0.5;
      drawMasterGlyph(ctx,cx,cy,TILE*0.42,pulse,now*(stage==='servant'?0.0035:0.0015),stage);
      const limit=stage==='servant'?SERVANT_FLOOR_SECONDS:MASTER_FLOOR_SECONDS;
      const left=Math.max(0,1-mt.t/limit);
      ctx.globalCompositeOperation='source-over';
      ctx.fillStyle=stage==='servant'?'rgba(255,28,24,0.86)':'rgba(255,80,40,0.7)';
      ctx.fillRect(mt.x*TILE+3, mt.y*TILE+TILE-4, (TILE-6)*left, 2);
      ctx.globalCompositeOperation='lighter';
    }
    ctx.restore();
  }
  function reset(){
    rocks.length=0;
    masterShots.length=0;
    masterTiles.clear();
    volcanoState.clear();
    activeVolcanoes=[];
    scanT=0;
    masterScanT=0;
  }
  function snapshotProjectile(p){
    return {
      x:+(p.x||0).toFixed(3),
      y:+(p.y||0).toFixed(3),
      vx:+(p.vx||0).toFixed(3),
      vy:+(p.vy||0).toFixed(3),
      life:+Math.max(0,p.life||0).toFixed(3),
      rot:+(p.rot||0).toFixed(3),
      spin:+(p.spin||0).toFixed(3),
      reason:typeof p.reason==='string' ? p.reason : undefined
    };
  }
  function restoreProjectile(raw,maxLife,maxSpeed){
    if(!raw || !finiteNumber(raw.x) || !finiteNumber(raw.y) || !finiteNumber(raw.vx) || !finiteNumber(raw.vy)) return null;
    if(raw.y<0 || raw.y>=WORLD_H) return null;
    const life=Number.isFinite(raw.life) ? clamp(raw.life,0,maxLife) : maxLife;
    if(life<=0) return null;
    return {
      x:+raw.x,
      y:+raw.y,
      vx:clamp(+raw.vx,-maxSpeed,maxSpeed),
      vy:clamp(+raw.vy,-maxSpeed,maxSpeed),
      life,
      rot:Number.isFinite(raw.rot) ? +raw.rot : 0,
      spin:Number.isFinite(raw.spin) ? clamp(+raw.spin,-maxSpeed,maxSpeed) : 0,
      reason:typeof raw.reason==='string' ? raw.reason.slice(0,24) : undefined
    };
  }
  function snapshot(){
    const masterList=[...masterTiles.values()]
      .filter(m=>m && finiteTile(m.x,m.y))
      .sort((a,b)=>(a.x-b.x)||(a.y-b.y))
      .slice(0,64)
      .map(m=>({
        x:m.x|0,
        y:m.y|0,
        t:+Math.max(0,Number.isFinite(m.t)?m.t:0).toFixed(3),
        stage:m.stage==='servant' ? 'servant' : 'master'
      }));
    const shotList=masterShots
      .filter(p=>p && finiteNumber(p.x) && finiteNumber(p.y) && (p.life||0)>0)
      .slice(-MAX_MASTER_SHOTS)
      .map(snapshotProjectile);
    const rockList=rocks
      .filter(p=>p && finiteNumber(p.x) && finiteNumber(p.y) && (p.life||0)>0)
      .slice(-MAX_ROCKS)
      .map(snapshotProjectile);
    return {v:1,masterTiles:masterList,masterShots:shotList,rocks:rockList};
  }
  function restore(data,getTile){
    reset();
    if(!data || typeof data!=='object') return;
    if(Array.isArray(data.masterTiles)){
      for(const raw of data.masterTiles){
        if(masterTiles.size>=64) break;
        if(!raw || !finiteTile(raw.x,raw.y)) continue;
        const x=Math.floor(raw.x), y=Math.floor(raw.y);
        const tile=typeof getTile==='function' ? getTile(x,y) : (raw.stage==='servant'?T.SERVANT_STONE:T.VOLCANO_MASTER_STONE);
        if(tile!==T.VOLCANO_MASTER_STONE && tile!==T.SERVANT_STONE) continue;
        const stage=tile===T.SERVANT_STONE ? 'servant' : 'master';
        const limit=stage==='servant' ? SERVANT_FLOOR_SECONDS : MASTER_FLOOR_SECONDS;
        trackMasterStone(x,y,clamp(Number(raw.t)||0,0,limit+0.5),stage);
      }
    }
    if(Array.isArray(data.masterShots)){
      for(const raw of data.masterShots){
        if(masterShots.length>=MAX_MASTER_SHOTS) break;
        const p=restoreProjectile(raw,13,70);
        if(p) masterShots.push(p);
      }
    }
    if(Array.isArray(data.rocks)){
      for(const raw of data.rocks){
        if(rocks.length>=MAX_ROCKS) break;
        const p=restoreProjectile(raw,9,34);
        if(p) rocks.push(p);
      }
    }
  }

  const api={
    update,
    draw,
    reset,
    snapshot,
    restore,
    forceMasterEruption,
    onTileChanged,
    trackMasterStone,
    metrics:()=>({rocks:rocks.length, masterShots:masterShots.length, masterTiles:masterTiles.size, activeVolcanoes:activeVolcanoes.length}),
    _debug:{emitGas,spawnRock,spawnMaster,consumeDiamondTriggers,updateMasterTiles,collectActiveVolcanoes,rocks,masterShots,masterTiles,maybeDestroyDynamoAt,explodeServantStone,MASTER_EJECTION_FORCE,SERVANT_FLOOR_SECONDS}
  };
  MM.volcano = api;
})();

export const volcano = (typeof window!=='undefined' && window.MM) ? window.MM.volcano : undefined;
export default volcano;
