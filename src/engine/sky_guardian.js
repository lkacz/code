import { CHUNK_W, WORLD_MIN_Y, WORLD_SECTION_H, T } from '../constants.js';
import { isGeneratedStructureReplaceableTile, isSolidCollisionTile as isSolid } from './material_physics.js';
import { worldGen as WG } from './worldgen.js';

const skyGuardian = (function(){
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const MM = root.MM = root.MM || {};
  const CFG = {
    AWAKEN_RADIUS: 54,
    LEASH_RADIUS: 128,
    LEASH_Y: 78,
    EFFECT_CAP: 220,
    HAZARD_CAP: 150,
    BOSS_HP: 1840,
    RESONATOR_HP: 180,
    LEAFLING_HP: 42,
    LEAFLING_MAX: 10,
    CONTACT_CD: 0.72,
    SAVE_MARK_MIN_INTERVAL: 900,
    WIND_PUSH: 16,
    BOLT_SPEED: 14.5
  };
  const SPEC = {
    kind:'air',
    bossName:'Astrael, the Unreached Crown',
    heartKey:'heartAir',
    heartLabel:'Heart of Air',
    accent:'#a8d7ff',
    accent2:'#ffe77a',
    dark:'#16243d'
  };
  const state = {
    unlocked:false,
    defeated:false,
    awakened:false,
    heartAwarded:false,
    materialized:false,
    hintCd:0,
    seq:1,
    lastWorldChangeMark:-Infinity,
    debugRematch:false
  };
  const cache = new Map();
  let entities = [];
  let hazards = [];
  let effects = [];
  let lastGetTile = null;
  let lastSetTile = null;

  const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
  const lerp = (a,b,t)=>a+(b-a)*t;
  const finite = (v,f)=>Number.isFinite(Number(v)) ? Number(v) : f;
  const dist2 = (ax,ay,bx,by)=>{ const dx=ax-bx, dy=ay-by; return dx*dx+dy*dy; };
  const tileIndex = (lx,ly)=>ly*CHUNK_W+lx;

  function say(t){ try{ if(root.msg) root.msg(t); }catch(e){} }
  function sfx(id){ try{ if(MM.audio && MM.audio.play) MM.audio.play(id); }catch(e){} }
  function nowMs(){
    try{ if(root.performance && typeof root.performance.now === 'function') return root.performance.now(); }catch(e){}
    try{ return Date.now(); }catch(e){ return 0; }
  }
  function markWorldChanged(force){
    const now = nowMs();
    if(!force && Number.isFinite(state.lastWorldChangeMark) && now-state.lastWorldChangeMark<CFG.SAVE_MARK_MIN_INTERVAL) return false;
    state.lastWorldChangeMark = now;
    try{
      if(typeof root.__mmMarkWorldChanged === 'function') root.__mmMarkWorldChanged('sky_guardian');
      else if(root.saveState) root.saveState();
    }catch(e){}
    return true;
  }
  function playerRef(){ return root.player || null; }
  function progressHearts(){
    let hearts = {};
    try{ if(MM.progress && MM.progress.guardianHearts) hearts = MM.progress.guardianHearts() || {}; }catch(e){ hearts = {}; }
    const inv = root.inv || {};
    if((Number(inv.heartEarth)||0)>0) hearts.earth = 1;
    if((Number(inv.heartAir)||0)>0) hearts.air = 1;
    return hearts;
  }
  function isUnlocked(){
    const hearts = progressHearts();
    if(hearts.earth) state.unlocked = true;
    return !!state.unlocked;
  }
  function isDefeated(){
    const hearts = progressHearts();
    if(hearts.air) state.defeated = true;
    return !!state.defeated;
  }

  function layoutFor(){
    const key = 'layout:'+(WG.worldSeed||0);
    if(cache.has(key)) return cache.get(key);
    const seed = Number(WG.worldSeed)||1;
    const ax = Math.round((WG.randSeed(seed*0.017+81.4)-0.5)*220);
    const floorY = clamp(Math.round(-88 + (WG.randSeed(seed*0.029+12.9)-0.5)*12), WORLD_MIN_Y+48, -72);
    const gateY = floorY - 17;
    const ops = [];
    let minX=ax, maxX=ax, minY=gateY-22, maxY=floorY+8;
    function bound(x,y){ if(x<minX) minX=x; if(x>maxX) maxX=x; if(y<minY) minY=y; if(y>maxY) maxY=y; }
    function put(x,y,t,force){
      x=Math.round(x); y=Math.round(y);
      if(y<WORLD_MIN_Y+2 || y>=0) return;
      ops.push({x,y,t,f:force?1:0});
      bound(x,y);
    }
    function rect(x0,y0,w,h,t,force){
      for(let y=y0;y<y0+h;y++) for(let x=x0;x<x0+w;x++) put(x,y,t,force);
    }
    function clear(x0,y0,w,h){ rect(x0,y0,w,h,T.AIR,true); }
    function platform(cx,y,w,t){
      for(let x=cx-w; x<=cx+w; x++){
        const edge = Math.abs(x-cx)>w-2;
        put(x,y,edge?T.IRIDIUM:t,true);
        if(Math.abs(x-cx)%7===0) put(x,y-1,T.METEOR_DUST,true);
        if(Math.abs(x-cx)%13===0) put(x,y+1,T.GLASS,true);
      }
    }
    clear(ax-70,gateY-24,141,62);
    platform(ax,floorY,36,T.GLASS);
    platform(ax-48,floorY-16,16,T.METEOR_DUST);
    platform(ax+48,floorY-16,16,T.METEOR_DUST);
    platform(ax-26,floorY-31,12,T.GLASS);
    platform(ax+26,floorY-31,12,T.GLASS);
    for(const px of [ax-58,ax+58,ax-28,ax+28,ax]){
      put(px,floorY-1,T.ANTIGRAVITY_BEACON,true);
      put(px,floorY-2,T.SOLAR_BATTERY,true);
    }
    for(let a=0; a<32; a++){
      const ang=(Math.PI*2*a)/32;
      const rx=Math.round(Math.cos(ang)*9);
      const ry=Math.round(Math.sin(ang)*12);
      const t = a%4===0 ? T.ANTIMATTER_CRYSTAL : (a%2===0 ? T.IRIDIUM : T.GLASS);
      put(ax+rx,gateY+ry,t,true);
    }
    clear(ax-5,gateY-8,11,17);
    for(let y=gateY-7; y<=gateY+7; y+=2){
      put(ax-7,y,T.METEOR_DUST,true);
      put(ax+7,y,T.METEOR_DUST,true);
    }
    const resonators = [
      {id:'north',x:ax,y:floorY-31},
      {id:'west',x:ax-48,y:floorY-16},
      {id:'east',x:ax+48,y:floorY-16}
    ];
    for(const r of resonators){
      put(r.x,r.y-2,T.ANTIMATTER_CRYSTAL,true);
      put(r.x-1,r.y-1,T.IRIDIUM,true);
      put(r.x+1,r.y-1,T.IRIDIUM,true);
    }
    const L = {
      kind:'air',
      schema:'sky_gate_cognitive_arena_v1',
      ax,
      floorY,
      gateX:ax,
      gateY,
      bossX:ax,
      bossY:gateY-10,
      minX:minX-4,
      maxX:maxX+4,
      minY:Math.max(WORLD_MIN_Y+2,minY-4),
      maxY:maxY+4,
      resonators,
      zones:['sky_gate','adaptive_wind_lanes','ambition_crown'],
      ops,
      seed
    };
    cache.set(key,L);
    return L;
  }

  function shouldReplace(cur,force){
    if(force) return true;
    return isGeneratedStructureReplaceableTile(cur) || cur===T.METEOR_DUST || cur===T.GLASS || cur===T.IRIDIUM || cur===T.ANTIGRAVITY_BEACON;
  }
  function applyToSection(arr,cx,sy){
    if(!arr || !isUnlocked()) return 0;
    const L=layoutFor();
    const originY=sy*WORLD_SECTION_H;
    if(L.maxY<originY || L.minY>=originY+WORLD_SECTION_H) return 0;
    let changed=0;
    for(const o of L.ops){
      if(o.x<cx*CHUNK_W || o.x>=cx*CHUNK_W+CHUNK_W) continue;
      if(o.y<originY || o.y>=originY+WORLD_SECTION_H) continue;
      const lx=o.x-cx*CHUNK_W, ly=o.y-originY;
      const idx=tileIndex(lx,ly);
      const cur=arr[idx];
      if(cur===o.t) continue;
      if(!shouldReplace(cur,o.f===1)) continue;
      arr[idx]=o.t;
      changed++;
    }
    return changed;
  }
  function materializeArena(getTile,setTile){
    if(typeof getTile==='function') lastGetTile=getTile;
    if(typeof setTile==='function') lastSetTile=setTile;
    if(typeof getTile!=='function' || typeof setTile!=='function') return 0;
    state.unlocked=true;
    const L=layoutFor();
    let changed=0;
    for(const o of L.ops){
      let cur=T.AIR;
      try{ cur=getTile(o.x,o.y); }catch(e){ cur=T.AIR; }
      if(cur===o.t) continue;
      if(!shouldReplace(cur,o.f===1)) continue;
      try{ setTile(o.x,o.y,o.t); changed++; }catch(e){}
    }
    if(changed>0){
      state.materialized=true;
      markWorldChanged(true);
    }
    return changed;
  }
  function landingSpot(getTile){
    const L=layoutFor();
    const offsets=[0,-4,4,-8,8,-12,12,-18,18,-26,26,-34,34,-48,48];
    for(const off of offsets){
      const tx=Math.round(L.ax+off);
      for(const fy of [L.floorY,L.floorY-1,L.floorY+1,L.floorY-16,L.floorY-31]){
        try{
          const floor=getTile ? getTile(tx,fy) : T.GLASS;
          const body=getTile ? getTile(tx,fy-1) : T.AIR;
          const head=getTile ? getTile(tx,fy-2) : T.AIR;
          if(isSolid(floor) && !isSolid(body) && !isSolid(head)) return {x:tx+0.5,y:fy-1,tileX:tx,surface:fy,layout:L};
        }catch(e){}
      }
    }
    return {x:L.ax+0.5,y:L.floorY-1,tileX:Math.round(L.ax),surface:L.floorY,fallback:true,layout:L};
  }

  function addEffect(e){
    effects.push(e);
    while(effects.length>CFG.EFFECT_CAP) effects.shift();
  }
  function addHazard(h){
    hazards.push(h);
    while(hazards.length>CFG.HAZARD_CAP) hazards.shift();
  }
  function makeBoss(L){
    return {
      id:'sky-crown-'+(state.seq++),
      role:'crown',
      boss:true,
      name:SPEC.bossName,
      x:L.bossX,
      y:L.bossY,
      vx:0,
      vy:0,
      dir:1,
      radius:2.15,
      hp:CFG.BOSS_HP,
      maxHp:CFG.BOSS_HP,
      t:0,
      hitFlash:0,
      contactCd:0,
      boltCd:0.45,
      tacticCd:0.8,
      gustCd:1.2,
      wellCd:2.8,
      shieldStage:1,
      shielded:true,
      adaptKind:'',
      adaptCount:0,
      lastHitKind:'',
      samples:{still:0,air:0,far:0,above:0},
      tactic:'scan'
    };
  }
  function makeResonator(src,stage,index){
    return {
      id:'sky-resonator-'+stage+'-'+src.id,
      role:'resonator',
      resonator:true,
      name:'Ambition Resonator '+src.id,
      anchorX:src.x,
      anchorY:src.y-4,
      x:src.x,
      y:src.y-4,
      vx:0,
      vy:0,
      radius:1.12,
      hp:CFG.RESONATOR_HP+stage*34,
      maxHp:CFG.RESONATOR_HP+stage*34,
      t:index*0.7,
      hitFlash:0,
      shotCd:0.7+index*0.35,
      stage
    };
  }
  function activeLeaflings(){
    return entities.filter(e=>e && e.leafling && !e.dead && e.hp>0);
  }
  function activeLeaflingCount(){
    let n=0;
    for(const e of entities) if(e && e.leafling && !e.dead && e.hp>0) n++;
    return n;
  }
  function makeLeafling(src,L){
    L=L || layoutFor();
    src=src || {};
    const gen=clamp(finite(src.generation,0),0,8);
    return {
      id:'sky-leafling-'+(state.seq++),
      role:'celestial_leafling',
      leafling:true,
      name:'Celestial Leafling',
      x:clamp(finite(src.x,L.bossX+5),L.minX+5,L.maxX-5),
      y:clamp(finite(src.y,L.bossY+2),L.minY+6,L.floorY-5),
      vx:finite(src.vx,(Math.random()-0.5)*4),
      vy:finite(src.vy,-1.2-Math.random()*1.8),
      dir:src.vx<0?-1:1,
      radius:clamp(0.82-gen*0.025,0.66,0.84),
      hp:CFG.LEAFLING_HP,
      maxHp:CFG.LEAFLING_HP,
      t:finite(src.t,Math.random()*5),
      orbit:finite(src.orbit,Math.random()*Math.PI*2),
      generation:gen,
      contactCd:0,
      petalCd:0.55+Math.random()*0.8,
      hitFlash:0,
      splitHinted:false
    };
  }
  function spawnLeaflings(count,L,x,y,generation){
    L=L || layoutFor();
    const out=[];
    const alive=activeLeaflingCount();
    const room=Math.max(0,CFG.LEAFLING_MAX-alive);
    const n=Math.min(room,Math.max(0,Math.floor(count)||0));
    for(let i=0;i<n;i++){
      const a=(Math.PI*2*i/Math.max(1,n))+Math.random()*0.45;
      const e=makeLeafling({
        x:finite(x,L.bossX)+Math.cos(a)*(1.2+Math.random()*1.4),
        y:finite(y,L.bossY)+Math.sin(a)*(0.8+Math.random()*1.1),
        vx:Math.cos(a)*(4.2+Math.random()*2.2),
        vy:Math.sin(a)*(2.0+Math.random()*1.4)-1.4,
        generation:(generation||0),
        orbit:a
      },L);
      entities.push(e);
      out.push(e);
    }
    return out;
  }
  function activeBoss(){ return entities.find(e=>e && e.boss && !e.dead) || null; }
  function activeResonators(){ return entities.filter(e=>e && e.resonator && !e.dead && e.hp>0); }
  function activeResonatorCount(){
    let n=0;
    for(const e of entities) if(e && e.resonator && !e.dead && e.hp>0) n++;
    return n;
  }
  function pickActiveResonator(){
    let pick=null, n=0;
    for(const e of entities){
      if(!e || !e.resonator || e.dead || !(e.hp>0)) continue;
      n++;
      if(Math.random()<1/n) pick=e;
    }
    return pick;
  }
  function spawnResonators(stage,L){
    L=L || layoutFor();
    entities = entities.filter(e=>!e.resonator);
    L.resonators.forEach((r,i)=>entities.push(makeResonator(r,stage,i)));
    const boss=activeBoss();
    if(boss){
      boss.shielded=true;
      boss.shieldStage=stage;
      boss.tactic='protect_nodes';
      boss.tacticCd=0.2;
    }
    addEffect({type:'ring',kind:'air',x:L.ax,y:L.gateY,t:0,max:1.2,r:28});
    say(stage>=3 ? 'Astrael locks the last ambition into three crowns.' : 'The Sky Gate answers with resonators.');
  }
  function awaken(opts){
    opts=opts || {};
    if(typeof opts.getTile==='function') lastGetTile=opts.getTile;
    if(typeof opts.setTile==='function') lastSetTile=opts.setTile;
    if(!opts.force && (!isUnlocked() || isDefeated())) return false;
    const L=layoutFor();
    materializeArena(lastGetTile,lastSetTile);
    entities.length=0;
    hazards.length=0;
    const boss=makeBoss(L);
    entities.push(boss);
    state.awakened=true;
    state.debugRematch=!!opts.debug;
    spawnResonators(1,L);
    spawnLeaflings(1,L,L.bossX+5,L.bossY+1,0);
    say('Sky Gate opens: Astrael reads the shape of your ambition.');
    sfx('warning');
    return true;
  }
  function sleep(){
    entities.length=0;
    hazards.length=0;
    state.awakened=false;
  }
  function clearActive(){
    entities.length=0;
    hazards.length=0;
    effects.length=0;
    state.awakened=false;
  }
  function nearAwaken(p,L){
    return !!(p && Math.abs(p.x-L.ax)<=CFG.AWAKEN_RADIUS && Math.abs(p.y-L.gateY)<=CFG.AWAKEN_RADIUS);
  }
  function inNeighbourhood(p,L){
    return !!(p && Math.abs(p.x-L.ax)<=CFG.LEASH_RADIUS && Math.abs(p.y-L.gateY)<=CFG.LEASH_Y);
  }

  function damageHero(amount,x,y,cause){
    try{
      if(root.damageHero) return root.damageHero(amount,{cause: cause || 'sky_guardian', x, y, invulMs:420});
    }catch(e){}
    const p=playerRef();
    if(p && Number.isFinite(p.hp)) p.hp-=amount;
    return true;
  }
  function predictPlayer(p,lead){
    if(!p) return {x:0,y:0};
    return {x:finite(p.x,0)+finite(p.vx,0)*lead, y:finite(p.y,0)+finite(p.vy,0)*lead};
  }
  function spawnBolt(from,p,power){
    if(!from || !p) return;
    const lead=0.25+Math.random()*0.42;
    const target=predictPlayer(p,lead);
    let dx=target.x-from.x, dy=target.y-from.y;
    const d=Math.hypot(dx,dy)||1;
    dx/=d; dy/=d;
    const sp=CFG.BOLT_SPEED*(power||1);
    addHazard({type:'bolt',kind:'air',x:from.x+dx*1.4,y:from.y+dy*1.4,vx:dx*sp,vy:dy*sp,r:0.42,t:0,life:3.2,dmg:12+Math.round(4*(power||1)),hit:false});
  }
  function spawnGust(x,y,w,h,dir,vertical,power){
    addHazard({type:'gust',kind:'air',x,y,w,h,dir:dir||1,vertical:!!vertical,power:power||1,t:0,delay:0.38,life:1.45,dmg:6,hitCd:0});
    addEffect({type:'gust',kind:'air',x,y,t:0,max:0.75,r:Math.max(w,h)});
  }
  function spawnWell(p,L,power){
    L=L || layoutFor();
    const x=clamp(p?finite(p.x,L.ax):L.ax,L.ax-52,L.ax+52);
    const y=clamp(p?finite(p.y,L.gateY):L.gateY,L.minY+8,L.floorY-5);
    addHazard({type:'well',kind:'air',x,y,r:5.2+power*0.8,t:0,delay:0.72,life:1.65,dmg:18+power*4,hit:false});
  }
  function spawnBladeSweep(boss,p,L,phase){
    L=L || layoutFor();
    const y=clamp(p?finite(p.y,boss.y):boss.y,L.minY+12,L.floorY-4);
    const dir=(p && p.x<boss.x) ? -1 : 1;
    addHazard({type:'blade',kind:'air',x:boss.x-dir*26,y,vx:dir*(18+phase*2.5),r:1.0,t:0,life:2.5,dmg:15+phase*3,hit:false});
  }
  function spawnPetal(from,p){
    if(!from || !p) return;
    const lead=0.18+Math.random()*0.24;
    const target=predictPlayer(p,lead);
    let dx=target.x-from.x, dy=target.y-from.y;
    const d=Math.hypot(dx,dy)||1;
    dx/=d; dy/=d;
    const sp=7.2+Math.random()*1.8;
    addHazard({type:'petal',kind:'leafling',x:from.x+dx*0.9,y:from.y+dy*0.9,vx:dx*sp,vy:dy*sp-0.25,r:0.34,t:0,life:2.25,dmg:4,hit:false,spin:Math.random()*Math.PI*2});
  }
  function updatePlayerSamples(boss,p,dt,L){
    if(!boss || !p) return;
    const speed=Math.hypot(finite(p.vx,0),finite(p.vy,0));
    const still=speed<0.45 ? 1 : 0;
    const air=(!p.onGround && Math.abs(finite(p.vy,0))>0.3) || p.y<L.floorY-8 ? 1 : 0;
    const far=Math.abs(p.x-boss.x)>28 ? 1 : 0;
    const above=p.y<boss.y-6 ? 1 : 0;
    const k=clamp(dt*1.8,0,0.35);
    boss.samples.still=lerp(boss.samples.still||0,still,k);
    boss.samples.air=lerp(boss.samples.air||0,air,k);
    boss.samples.far=lerp(boss.samples.far||0,far,k);
    boss.samples.above=lerp(boss.samples.above||0,above,k);
  }
  function chooseTactic(boss,p,L,resonatorCount){
    if(!boss) return 'scan';
    if(boss.shielded && resonatorCount>0) return 'protect_nodes';
    if(boss.adaptKind==='arrow' && boss.adaptCount>=3) return 'crosswind';
    if(boss.adaptKind==='melee' && boss.adaptCount>=2) return 'repel';
    if((boss.samples.air||0)>0.48 || (boss.samples.above||0)>0.52) return 'downburst';
    if((boss.samples.still||0)>0.56) return 'gravity_question';
    if((boss.samples.far||0)>0.48) return 'intercept';
    return 'duel';
  }
  function phaseFor(boss){
    if(!boss) return 1;
    const r=boss.hp/boss.maxHp;
    return r<0.34 ? 3 : (r<0.64 ? 2 : 1);
  }
  function maybeRefreshShield(boss,L){
    if(!boss || boss.dead) return 0;
    const count=activeResonatorCount();
    if(count){
      boss.shielded=true;
      return count;
    }
    boss.shielded=false;
    const phase=phaseFor(boss);
    let spawned=false;
    if(phase>=2 && boss.shieldStage<2){ spawnResonators(2,L); spawned=true; }
    if(phase>=3 && boss.shieldStage<3){ spawnResonators(3,L); spawned=true; }
    return spawned ? activeResonatorCount() : 0;
  }
  function updateBoss(boss,p,getTile,setTile,dt,L){
    void getTile; void setTile;
    const phase=phaseFor(boss);
    boss.t+=dt;
    boss.hitFlash=Math.max(0,boss.hitFlash-dt);
    boss.contactCd=Math.max(0,boss.contactCd-dt);
    boss.boltCd-=dt;
    boss.tacticCd-=dt;
    boss.gustCd-=dt;
    boss.wellCd-=dt;
    updatePlayerSamples(boss,p,dt,L);
    const resonatorCount=maybeRefreshShield(boss,L);
    if(boss.tacticCd<=0){
      boss.tactic=chooseTactic(boss,p,L,resonatorCount);
      boss.tacticCd=0.75+Math.random()*0.42;
    }
    const targetX=p ? clamp(p.x+(boss.tactic==='intercept' ? 0 : (p.x>=L.ax?-14:14)),L.ax-42,L.ax+42) : L.ax;
    const targetY=p ? clamp(p.y-10,L.minY+12,L.floorY-18) : L.gateY-10;
    const dx=targetX-boss.x, dy=targetY-boss.y;
    boss.vx+=clamp(dx*0.95,-18,18)*dt;
    boss.vy+=clamp(dy*0.85,-14,14)*dt;
    if(boss.tactic==='repel' && p){
      boss.vx += (boss.x>=p.x?1:-1)*9*dt;
      if(boss.gustCd<=0){
        spawnGust(boss.x,boss.y+2,15,5,boss.x>=p.x?1:-1,false,1.2);
        boss.gustCd=1.7;
      }
    }
    boss.vx*=Math.max(0,1-dt*1.6);
    boss.vy*=Math.max(0,1-dt*1.5);
    boss.x=clamp(boss.x+boss.vx*dt,L.minX+8,L.maxX-8);
    boss.y=clamp(boss.y+boss.vy*dt,L.minY+8,L.floorY-8);
    boss.dir=p && p.x<boss.x ? -1 : 1;
    if(boss.boltCd<=0){
      const n=phase>=3?3:(phase>=2?2:1);
      for(let i=0;i<n;i++) spawnBolt(boss,p,1+phase*0.12);
      boss.boltCd=(boss.tactic==='protect_nodes'?0.65:boss.tactic==='intercept'?0.78:1.0)*(0.82+Math.random()*0.28);
    }
    if(boss.gustCd<=0){
      if(boss.tactic==='downburst') spawnGust(p?finite(p.x,L.ax):boss.x,clamp((p?finite(p.y,boss.y):boss.y)-5,L.minY+4,L.floorY-18),7,22,1,true,1.45);
      else if(boss.tactic==='crosswind') spawnGust(L.ax,clamp(p?finite(p.y,L.gateY):L.gateY,L.minY+12,L.floorY-8),62,6,boss.dir,false,1.35);
      else if(boss.tactic==='protect_nodes'){
        const r=pickActiveResonator();
        if(r) spawnGust(r.x,r.y,18,5,boss.x>=r.x?1:-1,false,1.1);
      }else spawnBladeSweep(boss,p,L,phase);
      boss.gustCd=(phase>=3?1.45:1.85)*(0.86+Math.random()*0.30);
    }
    if(boss.wellCd<=0){
      if(boss.tactic==='gravity_question' || phase>=3) spawnWell(p,L,phase);
      boss.wellCd=(phase>=3?3.0:4.2)*(0.84+Math.random()*0.32);
    }
  }
  function updateResonator(e,p,dt){
    e.t+=dt;
    e.hitFlash=Math.max(0,e.hitFlash-dt);
    const bob=Math.sin(e.t*2.2+e.stage)*1.1;
    e.x += (e.anchorX-e.x)*dt*3.2;
    e.y += (e.anchorY+bob-e.y)*dt*3.2;
    e.shotCd-=dt;
    if(e.shotCd<=0){
      spawnBolt(e,p,0.72+e.stage*0.08);
      e.shotCd=1.55+Math.random()*0.95-Math.min(0.45,e.stage*0.12);
    }
    if(Math.random()<dt*2.2) addEffect({type:'spark',kind:'air',x:e.x+(Math.random()-0.5)*1.8,y:e.y+(Math.random()-0.5)*1.8,t:0,max:0.42,r:3});
  }
  function updateLeafling(e,p,dt,L,leaflingCount,bossHint){
    e.t+=dt;
    e.hitFlash=Math.max(0,e.hitFlash-dt);
    e.contactCd=Math.max(0,e.contactCd-dt);
    e.petalCd-=dt;
    e.orbit+=dt*(0.8+0.08*(e.generation||0));
    const count=Math.max(1,leaflingCount||0);
    const spread=4.4+Math.min(6.0,count*0.52);
    const base=p || bossHint || {x:L.ax,y:L.gateY};
    const phase=e.orbit+(e.id.charCodeAt(e.id.length-1)%7)*0.37;
    const tx=clamp(finite(base.x,L.ax)+Math.cos(phase)*spread,L.minX+5,L.maxX-5);
    const ty=clamp(finite(base.y,L.gateY)-2.6+Math.sin(phase*1.35)*2.8,L.minY+6,L.floorY-6);
    e.vx+=clamp((tx-e.x)*1.45,-10,10)*dt;
    e.vy+=clamp((ty-e.y)*1.20,-8,8)*dt;
    if(p && Math.abs(p.x-e.x)<7 && Math.abs(p.y-e.y)<6){
      e.vx+=(e.x>=p.x?1:-1)*1.6*dt;
      if(e.petalCd<=0){
        spawnPetal(e,p);
        e.petalCd=1.85+Math.random()*1.05+Math.min(0.45,count*0.03);
      }
    }
    e.vx*=Math.max(0,1-dt*2.1);
    e.vy*=Math.max(0,1-dt*2.0);
    e.x=clamp(e.x+e.vx*dt,L.minX+4,L.maxX-4);
    e.y=clamp(e.y+e.vy*dt,L.minY+5,L.floorY-4);
    e.dir=e.vx<0?-1:1;
    if(Math.random()<dt*1.35) addEffect({type:'spark',kind:'leafling',x:e.x+(Math.random()-0.5)*1.2,y:e.y+(Math.random()-0.5)*1.0,t:0,max:0.36,r:2.2});
  }
  function updateHazards(dt,p,L){
    for(let i=hazards.length-1;i>=0;i--){
      const h=hazards[i];
      h.t+=dt;
      if(h.type==='bolt'){
        h.x+=h.vx*dt; h.y+=h.vy*dt;
        if(p && !h.hit && Math.hypot(p.x-h.x,p.y-h.y)<h.r+0.72){
          h.hit=true;
          damageHero(h.dmg,h.x,h.y,'sky_bolt');
          addEffect({type:'hit',kind:'air',x:h.x,y:h.y,t:0,max:0.4,r:5});
        }
        if(h.t>h.life) hazards.splice(i,1);
      }else if(h.type==='petal'){
        h.spin+=dt*9;
        h.x+=h.vx*dt; h.y+=h.vy*dt;
        h.vy+=Math.sin(h.t*7)*0.32*dt;
        if(p && !h.hit && Math.hypot(p.x-h.x,p.y-h.y)<h.r+0.68){
          h.hit=true;
          damageHero(h.dmg,h.x,h.y,'sky_leafling_petal');
          addEffect({type:'hit',kind:'leafling',x:h.x,y:h.y,t:0,max:0.26,r:3.2});
        }
        if(h.t>h.life) hazards.splice(i,1);
      }else if(h.type==='gust'){
        const active=h.t>=h.delay;
        if(p && active && h.t<h.delay+h.life){
          const inside=Math.abs(p.x-h.x)<=h.w*0.5 && Math.abs(p.y-h.y)<=h.h*0.5;
          if(inside){
            if(h.vertical){
              p.vy = Math.min(finite(p.vy,0), -CFG.WIND_PUSH*0.56*h.power);
              p.vx += Math.sin(h.t*7)*0.8;
            }else{
              p.vx += h.dir*CFG.WIND_PUSH*h.power*dt;
              p.vy -= 2.2*dt;
            }
            h.hitCd=Math.max(0,(h.hitCd||0)-dt);
            if(h.hitCd<=0){
              damageHero(h.dmg,h.x,h.y,'sky_gust');
              h.hitCd=0.65;
            }
          }
        }
        if(h.t>h.delay+h.life) hazards.splice(i,1);
      }else if(h.type==='well'){
        const active=h.t>=h.delay;
        if(p && active && h.t<h.delay+h.life){
          const dx=h.x-p.x, dy=h.y-p.y;
          const d=Math.hypot(dx,dy)||1;
          if(d<h.r+2.0){
            const pull=(1-d/(h.r+2.0))*18*dt;
            p.vx += dx/d*pull;
            p.vy += dy/d*pull;
          }
          if(!h.hit && d<h.r*0.45){
            h.hit=true;
            damageHero(h.dmg,h.x,h.y,'sky_gravity_well');
          }
        }
        if(h.t>h.delay+h.life) hazards.splice(i,1);
      }else if(h.type==='blade'){
        h.x+=h.vx*dt;
        if(p && !h.hit && Math.abs(p.x-h.x)<2.2 && Math.abs(p.y-h.y)<3.4){
          h.hit=true;
          damageHero(h.dmg,h.x,h.y,'sky_blade');
        }
        if(h.t>h.life || h.x<L.minX-8 || h.x>L.maxX+8) hazards.splice(i,1);
      }
    }
  }
  function updateEffects(dt){
    for(let i=effects.length-1;i>=0;i--){
      effects[i].t+=dt;
      if(effects[i].t>=effects[i].max) effects.splice(i,1);
    }
  }
  function awardHeart(){
    let newly=true, progressHandled=false;
    try{
      if(MM.progress && MM.progress.markGuardianHeart){
        newly=!!MM.progress.markGuardianHeart('air');
        progressHandled=true;
      }
    }catch(e){}
    const inv=root.inv;
    if(!progressHandled) newly=!(inv && (Number(inv[SPEC.heartKey])||0)>0);
    state.defeated=true;
    state.awakened=false;
    state.heartAwarded=true;
    if(newly){
      if(inv) inv[SPEC.heartKey]=(Number(inv[SPEC.heartKey])||0)+1;
      try{ if(root.updateInventoryHud) root.updateInventoryHud(); }catch(e){}
      try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-resources-change')); }catch(e){}
      say(SPEC.heartLabel+' acquired.');
    }else{
      say(SPEC.heartLabel+' already sings above you.');
    }
    try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-guardian-defeated',{detail:{kind:'air',name:SPEC.bossName,heart:SPEC.heartKey,newReward:newly,sky:true}})); }catch(e){}
    try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-boss-killed',{detail:{name:SPEC.bossName,guardian:true,kind:'air',sky:true}})); }catch(e){}
    markWorldChanged(true);
    return newly;
  }
  function defeatEntity(e){
    if(!e || e.dead) return;
    e.dead=true;
    addEffect({type:'ring',kind:'air',x:e.x,y:e.y,t:0,max:e.boss?1.8:0.72,r:e.boss?38:9});
    sfx(e.boss?'explosion':'spark');
    if(e.boss){
      awardHeart();
      for(const other of entities) other.dead=true;
      hazards.length=0;
    }else if(e.resonator){
      say(e.name+' falls silent.');
    }else if(e.leafling){
      const born=spawnLeaflings(2,layoutFor(),e.x,e.y,(e.generation||0)+1);
      if(born.length && state.hintCd<=0){
        say('Niebiański liściak rozdwaja się. Może lepiej nie kosić całego ogrodu.');
        state.hintCd=2.8;
      }
    }
  }
  function damageKind(opts){
    const k=String((opts && (opts.kind || opts.type || opts.weaponType || opts.source)) || '').toLowerCase();
    if(k.indexOf('arrow')>=0 || k.indexOf('bow')>=0) return 'arrow';
    if(k.indexOf('melee')>=0 || k.indexOf('sword')>=0) return 'melee';
    if(k.indexOf('electric')>=0 || k.indexOf('laser')>=0) return 'electric';
    if(k.indexOf('fire')>=0 || k.indexOf('flame')>=0) return 'fire';
    if(k.indexOf('gas')>=0 || k.indexOf('poison')>=0) return 'gas';
    return k || 'direct';
  }
  function rememberDamage(boss,kind){
    if(!boss) return;
    if(boss.lastHitKind===kind) boss.adaptCount=Math.min(9,(boss.adaptCount||0)+1);
    else boss.adaptCount=1;
    boss.lastHitKind=kind;
    boss.adaptKind=kind;
  }
  function entityHitScore(e,x,y,r){
    const d=Math.hypot(e.x-x,e.y-y)-(e.radius||1)-(r||0);
    return d<=0 ? d : Infinity;
  }
  function entityAtTile(tx,ty,includeShielded){
    const x=tx+0.5, y=ty+0.5;
    let best=null, bd=Infinity;
    for(const e of entities){
      if(e.dead) continue;
      if(e.boss && e.shielded && !includeShielded){
        const d=entityHitScore(e,x,y,0.76);
        if(d<bd){ bd=d; best=e; }
        continue;
      }
      const d=entityHitScore(e,x,y,0.74);
      if(d<bd){ bd=d; best=e; }
    }
    return best;
  }
  function hitEntity(e,dmg,opts){
    if(!e || e.dead || !(dmg>0)) return false;
    const kind=damageKind(opts);
    const boss=activeBoss();
    if(e.boss) rememberDamage(e,kind);
    if(e.boss && e.shielded && activeResonatorCount()>0){
      e.hitFlash=0.12;
      addEffect({type:'shield',kind:'air',x:e.x,y:e.y,t:0,max:0.45,r:9});
      if(state.hintCd<=0){
        say('Astrael reads the hit and routes it into the resonators.');
        state.hintCd=2.4;
      }
      return 'shield';
    }
    let amount=Math.max(0.5,Number(dmg)||1);
    if(kind==='electric' && e.resonator) amount*=1.45;
    if(kind==='gas' && e.boss) amount*=0.65;
    if(e.leafling && kind==='gas') amount*=0.75;
    e.hp-=amount;
    e.hitFlash=0.18;
    addEffect({type:'hit',kind:'air',x:e.x,y:e.y,t:0,max:0.30,r:(e.radius||1)*2.4});
    if(e.hp<=0) defeatEntity(e);
    else if((e.resonator || e.leafling) && boss) boss.tacticCd=0;
    return true;
  }
  function damageAt(tx,ty,dmg,opts){
    const e=entityAtTile(tx,ty,true);
    if(!e) return false;
    return hitEntity(e,dmg,opts);
  }
  function attackAt(tx,ty,bonus){
    return damageAt(tx,ty,7+Math.max(0,Number(bonus)||0),{kind:'melee',source:'hero'});
  }
  function separateHeroFromEntity(e,p,dt){
    if(!e || !p || e.dead) return false;
    const dx=p.x-e.x, dy=p.y-e.y;
    const d=Math.hypot(dx,dy)||1;
    const min=(e.radius||1)+0.56;
    if(d>=min) return false;
    const nx=dx/d, ny=dy/d;
    const push=(min-d)*0.62;
    p.x+=nx*push;
    p.y+=ny*push;
    p.vx=finite(p.vx,0)+nx*5.8*dt;
    p.vy=finite(p.vy,0)+ny*4.2*dt;
    e.contactCd=Math.max(0,(e.contactCd||0)-dt);
    if(e.contactCd<=0){
      e.contactCd=CFG.CONTACT_CD;
      damageHero(e.boss?17:(e.leafling?3:8),e.x,e.y,e.boss?'sky_crown_contact':(e.leafling?'sky_leafling_contact':'sky_resonator_contact'));
    }
    return true;
  }
  function collideHero(p,dt){
    p=p || playerRef();
    if(!p) return false;
    let hit=false;
    for(const e of entities) if(separateHeroFromEntity(e,p,Math.min(0.1,dt||0.016))) hit=true;
    return hit;
  }
  function update(dt,player,getTile,setTile){
    if(typeof getTile==='function') lastGetTile=getTile;
    if(typeof setTile==='function') lastSetTile=setTile;
    if(!(dt>0) || !Number.isFinite(dt)) return;
    dt=Math.min(0.1,dt);
    player=player || playerRef();
    state.hintCd=Math.max(0,(state.hintCd||0)-dt);
    if(isDefeated() && !state.debugRematch){
      if(entities.length || hazards.length) clearActive();
      updateEffects(dt);
      return;
    }
    if(!isUnlocked()){
      updateEffects(dt);
      return;
    }
    const L=layoutFor();
    if(!state.materialized && player && Math.abs(player.x-L.ax)<150 && Math.abs(player.y-L.gateY)<120) materializeArena(getTile,setTile);
    if(state.awakened && player && !inNeighbourhood(player,L)){
      sleep();
      updateEffects(dt);
      return;
    }
    if(!state.awakened && !activeBoss() && player && nearAwaken(player,L) && !isDefeated()){
      awaken({getTile,setTile});
    }
    const boss=activeBoss();
    if(boss) updateBoss(boss,player,getTile,setTile,dt,L);
    const leaflingCount=activeLeaflingCount();
    for(const e of entities){
      if(e.dead || e.boss) continue;
      if(e.resonator) updateResonator(e,player,dt);
      else if(e.leafling) updateLeafling(e,player,dt,L,leaflingCount,boss);
    }
    updateHazards(dt,player,L);
    collideHero(player,dt);
    for(let i=entities.length-1;i>=0;i--) if(entities[i].dead) entities.splice(i,1);
    updateEffects(dt);
  }
  function rgba(hex,a){
    if(typeof hex!=='string' || hex[0]!=='#' || hex.length<7) return 'rgba(255,255,255,'+clamp(a,0,1).toFixed(3)+')';
    const n=parseInt(hex.slice(1,7),16);
    return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+clamp(a,0,1).toFixed(3)+')';
  }
  function makeDrawView(camX,camY,W,H,TILE,zoom){
    if(!Number.isFinite(camX) || !Number.isFinite(camY) || !(W>0) || !(H>0) || !(TILE>0)) return null;
    const z=(Number.isFinite(zoom) && zoom>0) ? zoom : 1;
    const margin=18;
    return {x0:camX-margin,y0:camY-margin,x1:camX+W/(TILE*z)+margin,y1:camY+H/(TILE*z)+margin};
  }
  function inView(view,x,y,r){
    if(!view) return true;
    const m=r||0;
    return x+m>=view.x0 && x-m<=view.x1 && y+m>=view.y0 && y-m<=view.y1;
  }
  function tileVisible(canDrawTile,x,y,view,r){
    if(!inView(view,x,y,r)) return false;
    return typeof canDrawTile!=='function' || canDrawTile(Math.floor(x),Math.floor(y));
  }
  function drawArenaGlow(ctx,TILE,canDrawTile,view){
    if(!isUnlocked()) return;
    const L=layoutFor();
    if(!tileVisible(canDrawTile,L.ax,L.gateY,view,70)) return;
    const now=(typeof performance!=='undefined'?performance.now():0)*0.001;
    const pulse=0.76+Math.sin(now*1.8)*0.14;
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    const grad=ctx.createRadialGradient(L.ax*TILE,L.gateY*TILE,4,L.ax*TILE,L.gateY*TILE,58*TILE*pulse);
    grad.addColorStop(0,'rgba(168,215,255,0.24)');
    grad.addColorStop(0.45,'rgba(255,231,122,0.10)');
    grad.addColorStop(1,'rgba(168,215,255,0)');
    ctx.fillStyle=grad;
    ctx.fillRect((L.ax-72)*TILE,(L.gateY-48)*TILE,144*TILE,88*TILE);
    ctx.restore();
  }
  function drawHazards(ctx,TILE,canDrawTile,view){
    for(const h of hazards){
      if(!tileVisible(canDrawTile,h.x,h.y,view,Math.max(h.r||2,h.w||0,h.h||0)+4)) continue;
      ctx.save();
      ctx.globalCompositeOperation='lighter';
      if(h.type==='bolt'){
        ctx.shadowColor=SPEC.accent2; ctx.shadowBlur=12;
        ctx.fillStyle=rgba(SPEC.accent2,0.90);
        ctx.beginPath(); ctx.arc(h.x*TILE,h.y*TILE,Math.max(3,(h.r||0.4)*TILE),0,Math.PI*2); ctx.fill();
        ctx.strokeStyle=rgba(SPEC.accent,0.52);
        ctx.beginPath(); ctx.moveTo((h.x-h.vx*0.045)*TILE,(h.y-h.vy*0.045)*TILE); ctx.lineTo(h.x*TILE,h.y*TILE); ctx.stroke();
      }else if(h.type==='petal'){
        ctx.translate(h.x*TILE,h.y*TILE);
        ctx.rotate(h.spin||0);
        ctx.shadowColor='#dffcff'; ctx.shadowBlur=8;
        ctx.fillStyle='rgba(217,252,255,0.86)';
        ctx.strokeStyle='rgba(255,231,122,0.72)';
        ctx.lineWidth=Math.max(1,TILE*0.05);
        ctx.beginPath();
        ctx.ellipse(0,0,TILE*0.20,TILE*0.46,0,0,Math.PI*2);
        ctx.fill();
        ctx.stroke();
      }else if(h.type==='gust'){
        const active=h.t>=h.delay;
        const f=active ? clamp((h.t-h.delay)/h.life,0,1) : clamp(h.t/h.delay,0,1)*0.35;
        ctx.strokeStyle=rgba(active?SPEC.accent:SPEC.accent2,0.72*(1-f*0.35));
        ctx.lineWidth=Math.max(2,TILE*0.12);
        ctx.strokeRect((h.x-h.w*0.5)*TILE,(h.y-h.h*0.5)*TILE,h.w*TILE,h.h*TILE);
        ctx.fillStyle=rgba(SPEC.accent,0.08+0.10*(1-f));
        ctx.fillRect((h.x-h.w*0.5)*TILE,(h.y-h.h*0.5)*TILE,h.w*TILE,h.h*TILE);
      }else if(h.type==='well'){
        const active=h.t>=h.delay;
        const f=active ? clamp((h.t-h.delay)/h.life,0,1) : clamp(h.t/h.delay,0,1)*0.25;
        ctx.strokeStyle=rgba(active?SPEC.accent2:SPEC.accent,0.78*(1-f*0.35));
        ctx.lineWidth=Math.max(2,TILE*0.14);
        ctx.beginPath(); ctx.arc(h.x*TILE,h.y*TILE,TILE*h.r*(0.35+f*0.75),0,Math.PI*2); ctx.stroke();
      }else if(h.type==='blade'){
        ctx.strokeStyle=rgba(SPEC.accent2,0.88);
        ctx.lineWidth=Math.max(2,TILE*0.22);
        ctx.beginPath(); ctx.moveTo((h.x-2.2)*TILE,h.y*TILE); ctx.lineTo((h.x+2.2)*TILE,h.y*TILE); ctx.stroke();
      }
      ctx.restore();
    }
  }
  function drawEffects(ctx,TILE,canDrawTile,view){
    for(const e of effects){
      if(!tileVisible(canDrawTile,e.x,e.y,view,e.r||8)) continue;
      const f=clamp(e.t/e.max,0,1);
      ctx.save();
      ctx.globalCompositeOperation='lighter';
      const r=(e.r||5)*TILE*(0.35+f*0.95);
      const grad=ctx.createRadialGradient(e.x*TILE,e.y*TILE,2,e.x*TILE,e.y*TILE,r);
      const col=e.type==='hit'?SPEC.accent2:SPEC.accent;
      grad.addColorStop(0,rgba(col,0.34*(1-f)));
      grad.addColorStop(1,rgba(SPEC.accent,0));
      ctx.fillStyle=grad;
      ctx.beginPath(); ctx.arc(e.x*TILE,e.y*TILE,r,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle=rgba(SPEC.accent2,0.62*(1-f));
      ctx.beginPath(); ctx.arc(e.x*TILE,e.y*TILE,r*0.72,0,Math.PI*2); ctx.stroke();
      ctx.restore();
    }
  }
  function drawBoss(ctx,TILE,e){
    const x=e.x*TILE, y=e.y*TILE;
    const phase=phaseFor(e);
    const wing=1+Math.sin(e.t*3.1)*0.08;
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    const glow=ctx.createRadialGradient(x,y,2,x,y,TILE*(e.radius*4.0));
    glow.addColorStop(0,rgba(e.shielded?SPEC.accent2:SPEC.accent,0.25));
    glow.addColorStop(1,rgba(SPEC.accent,0));
    ctx.fillStyle=glow;
    ctx.beginPath(); ctx.arc(x,y,TILE*(e.radius*4.0),0,Math.PI*2); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(x,y);
    ctx.scale(e.dir<0?-1:1,1);
    ctx.shadowColor=e.shielded?SPEC.accent2:SPEC.accent;
    ctx.shadowBlur=14+phase*3;
    ctx.fillStyle='rgba(14,24,44,0.92)';
    ctx.beginPath();
    ctx.moveTo(0,-TILE*2.5);
    ctx.lineTo(TILE*1.6,-TILE*0.3);
    ctx.lineTo(TILE*0.8,TILE*1.8);
    ctx.lineTo(-TILE*0.8,TILE*1.8);
    ctx.lineTo(-TILE*1.6,-TILE*0.3);
    ctx.closePath();
    ctx.fill();
    const grad=ctx.createLinearGradient(-TILE*2,-TILE*2,TILE*2,TILE*2);
    grad.addColorStop(0,'#213a68');
    grad.addColorStop(0.45,'#8fc5ff');
    grad.addColorStop(0.72,'#ffe77a');
    grad.addColorStop(1,'#20304d');
    ctx.fillStyle=grad;
    ctx.beginPath(); ctx.ellipse(0,0,TILE*1.45,TILE*1.95,0,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle=rgba(SPEC.accent2,0.86); ctx.lineWidth=Math.max(1,TILE*0.10); ctx.stroke();
    ctx.fillStyle=rgba(SPEC.accent2,0.88);
    ctx.beginPath();
    ctx.moveTo(-TILE*1.0,-TILE*2.1);
    ctx.lineTo(0,-TILE*3.3);
    ctx.lineTo(TILE*1.0,-TILE*2.1);
    ctx.closePath(); ctx.fill();
    for(const side of [-1,1]){
      ctx.strokeStyle=rgba(SPEC.accent,0.72);
      ctx.lineWidth=Math.max(2,TILE*0.18);
      ctx.beginPath();
      ctx.moveTo(side*TILE*1.0,-TILE*0.4);
      ctx.quadraticCurveTo(side*TILE*3.4,-TILE*2.4*wing,side*TILE*5.2,TILE*0.4);
      ctx.quadraticCurveTo(side*TILE*3.0,TILE*1.2,side*TILE*1.0,TILE*0.7);
      ctx.stroke();
    }
    ctx.fillStyle=e.shielded?rgba(SPEC.accent2,0.58):rgba(SPEC.accent,0.40);
    ctx.beginPath(); ctx.arc(0,0,TILE*(2.25+Math.sin(e.t*5)*0.12),0,Math.PI*2); ctx.stroke();
    if(e.hitFlash>0){
      ctx.fillStyle='rgba(255,255,255,'+(e.hitFlash*3).toFixed(2)+')';
      ctx.beginPath(); ctx.arc(0,0,TILE*(e.radius+0.8),0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }
  function drawResonator(ctx,TILE,e){
    const x=e.x*TILE, y=e.y*TILE;
    ctx.save();
    ctx.translate(x,y);
    ctx.rotate(e.t*1.7);
    ctx.shadowColor=SPEC.accent2;
    ctx.shadowBlur=12;
    ctx.fillStyle='rgba(18,29,50,0.92)';
    ctx.beginPath();
    for(let i=0;i<6;i++){
      const a=i*Math.PI/3;
      const r=i%2?TILE*0.78:TILE*1.18;
      ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);
    }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle=rgba(SPEC.accent2,0.86); ctx.lineWidth=Math.max(1,TILE*0.08); ctx.stroke();
    ctx.fillStyle=rgba(SPEC.accent,0.78);
    ctx.beginPath(); ctx.arc(0,0,TILE*0.34,0,Math.PI*2); ctx.fill();
    if(e.hitFlash>0){
      ctx.fillStyle='rgba(255,255,255,'+(e.hitFlash*3).toFixed(2)+')';
      ctx.beginPath(); ctx.arc(0,0,TILE*(e.radius+0.7),0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }
  function drawLeaf(ctx,x,y,rx,ry,rot,fill,stroke){
    ctx.save();
    ctx.translate(x,y);
    ctx.rotate(rot);
    ctx.fillStyle=fill;
    ctx.strokeStyle=stroke;
    ctx.lineWidth=Math.max(1,Math.min(rx,ry)*0.11);
    ctx.beginPath();
    ctx.moveTo(0,-ry);
    ctx.bezierCurveTo(rx*0.95,-ry*0.55,rx*0.78,ry*0.52,0,ry);
    ctx.bezierCurveTo(-rx*0.78,ry*0.52,-rx*0.95,-ry*0.55,0,-ry);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle='rgba(255,255,255,0.48)';
    ctx.lineWidth=Math.max(1,Math.min(rx,ry)*0.05);
    ctx.beginPath();
    ctx.moveTo(0,-ry*0.70);
    ctx.lineTo(0,ry*0.68);
    ctx.stroke();
    ctx.restore();
  }
  function drawLeafling(ctx,TILE,e){
    const x=e.x*TILE, y=e.y*TILE;
    const pulse=Math.sin(e.t*7.4+e.generation)*0.08;
    const scale=clamp(1-(e.generation||0)*0.035,0.78,1.02);
    const w=TILE*0.72*scale, h=TILE*0.92*scale;
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    const glow=ctx.createRadialGradient(x,y,2,x,y,TILE*3.0);
    glow.addColorStop(0,'rgba(217,252,255,0.24)');
    glow.addColorStop(0.52,'rgba(255,231,122,0.10)');
    glow.addColorStop(1,'rgba(168,215,255,0)');
    ctx.fillStyle=glow;
    ctx.beginPath(); ctx.arc(x,y,TILE*3.0,0,Math.PI*2); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(x,y);
    ctx.rotate(Math.sin(e.t*2.3+e.orbit)*0.18);
    ctx.scale(e.dir<0?-1:1,1);
    ctx.shadowColor='#dffcff';
    ctx.shadowBlur=10;
    for(let i=0;i<7;i++){
      const t=i/6-0.5;
      const spread=Math.abs(t);
      const lx=t*w*0.95;
      const ly=-h*(0.30+0.38*(1-spread))+Math.sin(e.t*5+i)*TILE*0.035;
      const rot=t*1.25+pulse;
      const fill=i%2?'#bfefff':'#d9fcff';
      drawLeaf(ctx,lx,ly,w*(0.19+0.07*(1-spread)),h*(0.25+0.08*(1-spread)),rot,fill,'rgba(255,231,122,0.70)');
    }
    ctx.strokeStyle='rgba(255,231,122,0.68)';
    ctx.lineWidth=Math.max(1,TILE*0.055);
    ctx.lineCap='round';
    ctx.beginPath();
    ctx.moveTo(0,-h*0.86);
    ctx.quadraticCurveTo(TILE*0.08,-h*0.48,0,-h*0.05);
    ctx.stroke();
    ctx.fillStyle='rgba(30,48,76,0.92)';
    ctx.strokeStyle=e.hitFlash>0?'rgba(255,255,255,0.95)':'rgba(217,252,255,0.82)';
    ctx.lineWidth=Math.max(1,TILE*0.07);
    ctx.beginPath();
    ctx.ellipse(0,-h*0.35,w*0.32,h*0.33,0,0,Math.PI*2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle='#ffe77a';
    ctx.beginPath(); ctx.arc(-w*0.10,-h*0.39,TILE*0.055,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(w*0.10,-h*0.39,TILE*0.055,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='rgba(217,252,255,0.75)';
    ctx.beginPath();
    ctx.arc(0,-h*0.72,TILE*(0.42+Math.sin(e.t*4)*0.03),0,Math.PI*2);
    ctx.stroke();
    if(e.hitFlash>0){
      ctx.fillStyle='rgba(255,255,255,'+(e.hitFlash*3).toFixed(2)+')';
      ctx.beginPath(); ctx.arc(0,-h*0.35,TILE*0.82,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }
  function drawHealth(ctx,TILE,e){
    if(!e.boss && e.hp/e.maxHp>0.98) return;
    const w=(e.boss?13:4.5)*TILE;
    const h=e.boss?5:3;
    const x=e.x*TILE-w/2, y=(e.y-e.radius-1.55)*TILE;
    ctx.fillStyle='rgba(0,0,0,0.58)';
    ctx.fillRect(x,y,w,h);
    ctx.fillStyle=e.shielded ? SPEC.accent2 : SPEC.accent;
    ctx.fillRect(x,y,w*clamp(e.hp/e.maxHp,0,1),h);
    if(e.boss && e.shielded){ ctx.strokeStyle=rgba(SPEC.accent2,0.82); ctx.strokeRect(x-2,y-2,w+4,h+4); }
  }
  function draw(ctx,TILE,canDrawTile,camX,camY,W,H,zoom){
    const view=makeDrawView(camX,camY,W,H,TILE,zoom);
    drawArenaGlow(ctx,TILE,canDrawTile,view);
    if(!entities.length && !hazards.length && !effects.length) return;
    drawHazards(ctx,TILE,canDrawTile,view);
    for(const e of entities){
      if(!tileVisible(canDrawTile,e.x,e.y,view,(e.radius||1)+6)) continue;
      if(e.boss) drawBoss(ctx,TILE,e);
      else if(e.resonator) drawResonator(ctx,TILE,e);
      else if(e.leafling) drawLeafling(ctx,TILE,e);
      drawHealth(ctx,TILE,e);
    }
    drawEffects(ctx,TILE,canDrawTile,view);
  }
  function drawHUD(ctx,W,H,camX,camY,zoom,TILE,canDrawTile){
    const boss=activeBoss();
    if(!boss || !tileVisible(canDrawTile,boss.x,boss.y,null)) return;
    const sx=(boss.x-camX)*TILE*zoom, sy=(boss.y-camY)*TILE*zoom;
    if(sx>36 && sx<W-36 && sy>36 && sy<H-36) return;
    const ang=Math.atan2(sy-H/2,sx-W/2);
    const ex=W/2+Math.cos(ang)*(Math.min(W,H)/2-44);
    const ey=H/2+Math.sin(ang)*(Math.min(W,H)/2-44);
    ctx.save();
    ctx.translate(ex,ey);
    ctx.rotate(ang);
    ctx.fillStyle=rgba(SPEC.accent2,0.94);
    ctx.beginPath();
    ctx.moveTo(15,0);
    ctx.lineTo(-8,-8);
    ctx.lineTo(-8,8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  function targetsForTurret(sx,sy,range,onlyBoss){
    const out=[];
    const r2=(Number(range)||0)*(Number(range)||0);
    const bossShieldBlocked=activeResonatorCount()>0;
    for(const e of entities){
      if(e.dead) continue;
      if(e.boss && e.shielded && bossShieldBlocked) continue;
      if(onlyBoss && onlyBoss!==true && onlyBoss!==e) continue;
      if(onlyBoss===true && !e.boss) continue;
      const d2=dist2(sx,sy,e.x,e.y);
      if(d2>r2) continue;
      out.push({kind:'skyGuardian',skyGuardian:e,raw:e,x:e.x,y:e.y,tx:Math.floor(e.x),ty:Math.floor(e.y),hp:e.hp,d2});
    }
    out.sort((a,b)=>a.d2-b.d2);
    return out;
  }
  function nearestForTurret(sx,sy,range,onlyBoss){
    const t=targetsForTurret(sx,sy,range,onlyBoss);
    return t.length?t[0]:null;
  }
  function cleanEntity(e){
    return {
      id:String(e.id||'').slice(0,52),
      role:e.role,
      boss:!!e.boss,
      resonator:!!e.resonator,
      leafling:!!e.leafling,
      name:String(e.name||'').slice(0,80),
      x:+finite(e.x,0).toFixed(2),
      y:+finite(e.y,0).toFixed(2),
      vx:+finite(e.vx,0).toFixed(2),
      vy:+finite(e.vy,0).toFixed(2),
      hp:clamp(finite(e.hp,1),0,e.maxHp||CFG.BOSS_HP),
      maxHp:clamp(finite(e.maxHp,1),1,CFG.BOSS_HP),
      t:clamp(finite(e.t,0),0,3600),
      shieldStage:clamp(finite(e.shieldStage,1),1,3),
      shielded:!!e.shielded,
      adaptKind:String(e.adaptKind||'').slice(0,24),
      adaptCount:clamp(finite(e.adaptCount,0),0,9),
      anchorX:Number.isFinite(e.anchorX)?+e.anchorX.toFixed(2):undefined,
      anchorY:Number.isFinite(e.anchorY)?+e.anchorY.toFixed(2):undefined,
      stage:clamp(finite(e.stage,1),1,3),
      generation:clamp(finite(e.generation,0),0,8),
      orbit:clamp(finite(e.orbit,0),-999,999),
      petalCd:clamp(finite(e.petalCd,0),0,99)
    };
  }
  function restoreEntity(src){
    if(!src || typeof src!=='object') return null;
    const L=layoutFor();
    if(src.boss || src.role==='crown'){
      const e=makeBoss(L);
      e.id=String(src.id||e.id).slice(0,52);
      e.x=clamp(finite(src.x,e.x),L.minX+8,L.maxX-8);
      e.y=clamp(finite(src.y,e.y),L.minY+8,L.floorY-8);
      e.vx=clamp(finite(src.vx,0),-30,30);
      e.vy=clamp(finite(src.vy,0),-30,30);
      e.hp=clamp(finite(src.hp,e.maxHp),0,e.maxHp);
      e.t=clamp(finite(src.t,0),0,3600);
      e.shieldStage=clamp(finite(src.shieldStage,1),1,3);
      e.shielded=!!src.shielded;
      e.adaptKind=String(src.adaptKind||'').slice(0,24);
      e.adaptCount=clamp(finite(src.adaptCount,0),0,9);
      return e;
    }
    if(src.resonator || src.role==='resonator'){
      const anchors=L.resonators;
      const idx=Math.max(0,Math.min(anchors.length-1,Math.floor(Math.random()*anchors.length)));
      const base=anchors[idx] || {id:'restored',x:L.ax,y:L.floorY-16};
      const e=makeResonator(base,clamp(finite(src.stage,1),1,3),idx);
      e.id=String(src.id||e.id).slice(0,52);
      e.x=clamp(finite(src.x,e.x),L.minX+4,L.maxX-4);
      e.y=clamp(finite(src.y,e.y),L.minY+4,L.floorY-4);
      e.anchorX=clamp(finite(src.anchorX,e.anchorX),L.minX+4,L.maxX-4);
      e.anchorY=clamp(finite(src.anchorY,e.anchorY),L.minY+4,L.floorY-4);
      e.hp=clamp(finite(src.hp,e.maxHp),0,e.maxHp);
      e.t=clamp(finite(src.t,0),0,3600);
      return e;
    }
    if(src.leafling || src.role==='celestial_leafling'){
      const e=makeLeafling(src,L);
      e.id=String(src.id||e.id).slice(0,52);
      e.x=clamp(finite(src.x,e.x),L.minX+4,L.maxX-4);
      e.y=clamp(finite(src.y,e.y),L.minY+5,L.floorY-4);
      e.vx=clamp(finite(src.vx,0),-18,18);
      e.vy=clamp(finite(src.vy,0),-18,18);
      e.hp=clamp(finite(src.hp,e.maxHp),0,e.maxHp);
      e.t=clamp(finite(src.t,0),0,3600);
      e.orbit=finite(src.orbit,e.orbit);
      e.petalCd=clamp(finite(src.petalCd,e.petalCd),0,99);
      return e;
    }
    return null;
  }
  function snapshot(){
    return {
      v:1,
      unlocked:!!state.unlocked,
      defeated:!!state.defeated,
      awakened:!!state.awakened,
      heartAwarded:!!state.heartAwarded,
      materialized:!!state.materialized,
      seq:Math.max(1,state.seq|0),
      entities:entities.filter(e=>e && !e.dead).slice(0,16).map(cleanEntity)
    };
  }
  function reset(){
    clearActive();
    state.unlocked=false;
    state.defeated=false;
    state.heartAwarded=false;
    state.materialized=false;
    state.hintCd=0;
    state.seq=1;
    state.lastWorldChangeMark=-Infinity;
    state.debugRematch=false;
    cache.clear();
  }
  function restore(d){
    clearActive();
    if(!d || typeof d!=='object'){
      state.unlocked=false;
      state.defeated=false;
      state.heartAwarded=false;
      state.materialized=false;
      return false;
    }
    state.unlocked=!!d.unlocked;
    state.defeated=!!d.defeated;
    state.heartAwarded=!!d.heartAwarded;
    state.materialized=!!d.materialized;
    state.seq=Math.max(1,Number(d.seq)|0);
    state.lastWorldChangeMark=-Infinity;
    if(isUnlocked()) state.unlocked=true;
    if(isDefeated()){
      clearActive();
      return true;
    }
    if(d.awakened && Array.isArray(d.entities)){
      const restored=[];
      let leaflings=0;
      for(const src of d.entities.slice(0,24)){
        const e=restoreEntity(src);
        if(!e) continue;
        if(e.leafling){
          if(leaflings>=CFG.LEAFLING_MAX) continue;
          leaflings++;
        }
        restored.push(e);
        if(restored.length>=16) break;
      }
      entities=restored;
      state.awakened=entities.some(e=>e.boss);
    }
    return true;
  }
  function markDefeated(){
    state.defeated=true;
    state.awakened=false;
    clearActive();
    return true;
  }
  function forceAwaken(getTile,setTile){
    if(typeof getTile==='function') lastGetTile=getTile;
    if(typeof setTile==='function') lastSetTile=setTile;
    state.unlocked=true;
    return awaken({debug:true,force:true,getTile:lastGetTile,setTile:lastSetTile});
  }
  function status(){
    const L=layoutFor();
    return {
      unlocked:isUnlocked(),
      defeated:isDefeated(),
      awakened:!!state.awakened,
      lair:{x:L.ax,y:L.gateY,gateX:L.gateX,gateY:L.gateY,floorY:L.floorY,minX:L.minX,maxX:L.maxX,minY:L.minY,maxY:L.maxY,zones:L.zones.slice()},
      entities:entities.map(e=>({id:e.id,role:e.role,name:e.name,hp:e.hp,maxHp:e.maxHp,x:e.x,y:e.y,boss:!!e.boss,resonator:!!e.resonator,leafling:!!e.leafling,generation:e.generation||0,shielded:!!e.shielded,tactic:e.tactic||null,adaptKind:e.adaptKind||''})),
      hazards:hazards.length,
      resonators:activeResonatorCount(),
      leaflings:activeLeaflingCount(),
      materialized:!!state.materialized
    };
  }
  function metrics(){
    const boss=activeBoss();
    return {
      alive:entities.length,
      bosses:boss?1:0,
      resonators:activeResonatorCount(),
      leaflings:activeLeaflingCount(),
      hazards:hazards.length,
      effects:effects.length,
      unlocked:isUnlocked(),
      defeated:isDefeated(),
      hp:boss?+boss.hp.toFixed(1):0,
      shielded:boss?!!boss.shielded:false,
      tactic:boss?boss.tactic:'',
      adaptKind:boss?boss.adaptKind:'',
      materialized:!!state.materialized
    };
  }
  function _debug(){
    return {
      state, entities, hazards, effects, layoutFor, materializeArena, awardHeart,
      activeResonators, activeLeaflings, activeResonatorCount, activeLeaflingCount,
      spawnLeaflings:(count)=>{
        const L=layoutFor();
        return spawnLeaflings(count,L,L.bossX+4,L.bossY+1,0);
      },
      forceShield:(stage)=>{
        const boss=activeBoss();
        if(!boss) return false;
        spawnResonators(Math.max(1,Math.min(3,stage||boss.shieldStage||1)),layoutFor());
        return true;
      },
      clearResonators:()=>{
        for(const e of entities) if(e.resonator) e.dead=true;
        const boss=activeBoss();
        if(boss) boss.shielded=false;
        return true;
      },
      forceTactic:(name)=>{
        const boss=activeBoss();
        if(!boss) return false;
        boss.tactic=String(name||'duel');
        boss.tacticCd=2;
        return true;
      }
    };
  }

  const api = {
    config:CFG,
    spec:SPEC,
    layoutFor,
    landingSpot,
    applyToSection,
    materializeArena,
    update,
    draw,
    drawHUD,
    attackAt,
    damageAt,
    collideHero,
    targetsForTurret,
    nearestForTurret,
    forceAwaken,
    markDefeated,
    clearActive,
    reset,
    snapshot,
    restore,
    status,
    metrics,
    clearCache:()=>cache.clear(),
    _debug
  };
  MM.skyGuardian=api;
  MM.airBoss=api;
  return api;
})();

export { skyGuardian };
export default skyGuardian;
