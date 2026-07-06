// The fifth and final node: Guardian Macierzysty, the Inner Self at the center of
// the world. It wakes after the Heart of Air, calls the hero back to the column
// where the first request for water was made, and reveals the tutorial mentor as
// its mask. The fight inverts the game's one rule of combat:
//
//   EVERY BLOW BELONGS TO THE ONE WHO DEALS IT.
//
// - The hero's damage never lands: it is reflected back after a mirror-flash.
// - The mimic's strikes hurt the hero AND drain the mimic's own heart by the
//   same amount (its aggression is self-consuming, because it is the hero).
// - The fight is therefore won by *accepting* it: stand, take the blows, and the
//   mirror spends itself. The killing blow is mutual — the hero falls (no grave,
//   no loss; main.js routes 'inner_self*' causes here) and the mimic shatters.
//
// The mimic replays the hero's own movement, mirrored across the obelisk axis,
// drawn with the hero's own outfit renderer (MM.drawOutfit + MM.customization).
// Persistence: snapshot()/restore() ride the world save like the other guardians.
import { CHUNK_W, WORLD_H, T } from '../constants.js';
import { isGeneratedStructureReplaceableTile, isSolidCollisionTile as isSolid } from './material_physics.js';
import { STORY_LORE } from './story_lore.js';
import { worldGen as WG } from './worldgen.js';

const centerGuardian = (function(){
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const MM = root.MM = root.MM || {};
  const LORE = STORY_LORE.center || {};

  const CFG = {
    CALL_HINT_RADIUS: 10,
    REVEAL_RADIUS: 6.5,
    LEASH_RADIUS: 64,
    RESUME_RADIUS: 46,
    STRIKE_RANGE_X: 1.7,
    STRIKE_RANGE_Y: 2.1,
    STRIKE_BASE_CD: 2.2,
    STRIKE_MIN_CD: 1.15,
    ESCALATE_SECONDS: 75,
    REPLAY_DELAY: 1.1,
    REPLAY_CAP: 260,
    PURSUIT_SECONDS: 6,
    MIRROR_SPEED: 4.6,
    MIRROR_SPEED_MAX: 7.2,
    BOLT_SPEED: 7.5,
    BOLT_RANGE_TRIGGER: 9,
    BOLT_FAR_SECONDS: 4,
    REFLECT_DELAY: 0.22,
    REFLECT_CAP_PER_HIT: 40,
    FINALE_PAUSE: 1.5,
    EFFECT_CAP: 160,
    MIN_BOSS_HP: 100,
    STRIKE_DIVISOR: 14,
    STRIKE_MIN: 6,
    STRIKE_MAX: 26,
    STALL_STREAK: 12,
    STALL_MSG_CD: 30
  };
  const SPEC = {
    kind: 'mother',
    bossName: LORE.bossName || 'Guardian Macierzysty',
    bossTitle: LORE.bossTitle || 'Ostatnie Lustro',
    heartKey: 'heartMother',
    heartLabel: 'Serce Macierzyste',
    accent: '#e8e5d2',
    accent2: '#9b8cff',
    dark: '#14121f'
  };
  const PHASES = ['dormant','calling','reveal','battle','fallen'];

  const state = {
    phase: 'dormant',
    materialized: false,
    epilogueMaterialized: false,
    callAnnounced: false,
    nearHintSaid: false,
    revealIdx: 0,
    mirrorHintIdx: 0,
    thresholds: {},
    epilogueArrived: false,
    epilogueTalkIdx: 0,
    heartAwarded: false,
    charmGranted: false,
    stallStreak: 0,
    stallMsgCd: 0,
    suspended: false,
    talk: null,          // {text,x,y,t}
    seq: 1
  };
  const mimic = {
    active: false,
    x: 0, y: 0,
    facing: 1,
    walkT: 0,
    hp: 0, maxHp: 0,
    strikeCd: 1.6,
    sinceContact: 0,
    farT: 0,
    fightT: 0,
    hitFlash: 0,
    finale: 0,           // 0 = fighting, >0 = finale countdown running
    finaleDone: false,
    bolt: null           // {x,y,vx,vy,t,dmg}
  };
  const replay = [];      // ring of {x,y,facing,t}
  const reflects = [];    // pending reflected hits {t,amount,sx,sy}
  const effects = [];     // cosmetic {type,x,y,t,max,...}
  const timers = [];      // staggered messages {t,fn}
  const cache = new Map();
  let lastGetTile = null;
  let lastSetTile = null;

  const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
  const finite = (v,f)=>Number.isFinite(Number(v)) ? Number(v) : f;
  const dist2 = (ax,ay,bx,by)=>{ const dx=ax-bx, dy=ay-by; return dx*dx+dy*dy; };

  function say(t){ try{ if(root.msg) root.msg(t); }catch(e){} }
  function sfx(id){ try{ if(MM.audio && MM.audio.play) MM.audio.play(id); }catch(e){} }
  function playerRef(){ return root.player || null; }
  function markWorldChanged(){
    try{
      if(typeof root.__mmMarkWorldChanged === 'function') root.__mmMarkWorldChanged('center_guardian');
      else if(root.saveState) root.saveState();
    }catch(e){}
  }
  function damageHero(amount,sx,sy,cause,opts){
    try{
      if(typeof root.damageHero === 'function'){
        return !!root.damageHero(amount, Object.assign({srcX:sx, srcY:sy, cause, kb:4.5, invulMs:620}, opts||{}));
      }
    }catch(e){}
    const p = playerRef();
    if(p && typeof p.hp === 'number'){ p.hp -= amount; return true; }
    return false;
  }
  function progressHearts(){
    let hearts = {};
    try{ if(MM.progress && MM.progress.guardianHearts) hearts = MM.progress.guardianHearts() || {}; }catch(e){ hearts = {}; }
    const inv = root.inv || {};
    if((Number(inv.heartAir)||0)>0) hearts.air = 1;
    if((Number(inv.heartMother)||0)>0) hearts.mother = 1;
    return hearts;
  }
  function skyDefeated(){
    const hearts = progressHearts();
    return !!hearts.air;
  }
  function completed(){
    if(state.phase === 'fallen') return true;
    const hearts = progressHearts();
    return !!hearts.mother;
  }
  function mentorApi(){
    try{
      if(MM.npcs && MM.npcs.mentor) return MM.npcs.mentor;
      if(MM.tutorialNpc) return MM.tutorialNpc;
    }catch(e){}
    return null;
  }
  function mentorPos(){
    const api = mentorApi();
    if(!api || !api.summary) return null;
    try{
      const s = api.summary();
      if(s && Number.isFinite(Number(s.x)) && Number.isFinite(Number(s.y))) return {x:Number(s.x), y:Number(s.y)};
    }catch(e){}
    return null;
  }
  function setMentorHidden(hidden){
    const api = mentorApi();
    if(api && typeof api.setHidden === 'function'){
      try{ api.setHidden(!!hidden); }catch(e){}
    }
  }

  // --- Deterministic layout at the column where the story began -------------
  // Mirrors npc_system.defaultSpawnX so the obelisk rises where the mentor lives.
  function centerAnchorX(){
    const key = 'anchor:'+(WG.worldSeed||0);
    if(cache.has(key)) return cache.get(key);
    let ax = 0;
    try{
      const sea = (WG.settings && WG.settings.seaLevel!==undefined) ? WG.settings.seaLevel : 62;
      outer:
      for(let r=0; r<=4000; r+=4){
        const cols = r===0 ? [0] : [r,-r];
        for(const c of cols){
          let b=1, s=50;
          try{ b = WG.biomeType ? WG.biomeType(c) : 1; }catch(e){ b=1; }
          try{ s = WG.surfaceHeight ? WG.surfaceHeight(c) : 50; }catch(e){ s=50; }
          if(b!==5 && b!==6 && s<sea-1){ ax=c; break outer; }
        }
      }
    }catch(e){ ax = 0; }
    cache.set(key, ax);
    return ax;
  }
  function surfaceAt(x){
    try{ return clamp(Math.round(WG.surfaceHeight(Math.round(x))), 12, WORLD_H-14); }catch(e){ return 60; }
  }
  function layoutFor(){
    const key = 'layout:'+(WG.worldSeed||0);
    if(cache.has(key)) return cache.get(key);
    const ax = centerAnchorX();
    const fy = surfaceAt(ax);
    const ops = [];
    let minX=ax, maxX=ax, minY=fy-9, maxY=fy+2;
    function bound(x,y){ if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
    function put(x,y,t,force){
      x=Math.round(x); y=Math.round(y);
      if(y<2 || y>=WORLD_H-3) return;
      ops.push({x,y,t,f:force?1:0});
      bound(x,y);
    }
    // A compact mirror dais: deliberately small so a base built at spawn is
    // grazed, not erased. Only the obelisk column and dais row are forced.
    for(let dx=-4; dx<=4; dx++){
      put(ax+dx, fy, (dx%2===0)?T.GLASS:T.OBSIDIAN, true);
    }
    // Pocket of air above the dais (forced: the obelisk must never wake buried).
    for(let dx=-3; dx<=3; dx++){
      for(let dy=1; dy<=8; dy++) put(ax+dx, fy-dy, T.AIR, true);
    }
    // The obelisk: obsidian shell, relic materials of west and east in the core,
    // an antimatter crystal as the unnamed truth on top.
    put(ax, fy-1, T.OBSIDIAN, true);
    put(ax, fy-2, T.OBSIDIAN, true);
    put(ax, fy-3, T.MOTHER_ICE, true);
    put(ax, fy-4, T.MOTHER_LAVA, true);
    put(ax, fy-5, T.OBSIDIAN, true);
    put(ax, fy-6, T.ANTIMATTER_CRYSTAL, true);
    // Two low mirror pylons framing the dais.
    for(const side of [-4,4]){
      put(ax+side, fy-1, T.OBSIDIAN, true);
      put(ax+side, fy-2, T.GLASS, true);
      put(ax+side, fy-3, T.TORCH, true);
    }
    const L = {
      kind:'mother',
      schema:'center_mirror_dais_v1',
      ax,
      floorY:fy,
      obeliskX:ax,
      obeliskY:fy-4,
      minX:minX-2, maxX:maxX+2, minY:minY-2, maxY:maxY+2,
      ops
    };
    cache.set(key, L);
    return L;
  }
  function epilogueOps(L){
    // The obelisk quiets down: the crystal gives way to a soft lantern.
    return [
      {x:L.obeliskX, y:L.floorY-6, t:T.GLASS, f:1},
      {x:L.obeliskX, y:L.floorY-5, t:T.TORCH, f:1}
    ];
  }
  function shouldReplace(cur,force){
    if(force) return true;
    return isGeneratedStructureReplaceableTile(cur);
  }
  function applyOps(ops,getTile,setTile){
    let changed=0;
    for(const o of ops){
      let cur=T.AIR;
      try{ cur=getTile(o.x,o.y); }catch(e){ cur=T.AIR; }
      if(cur===o.t) continue;
      if(!shouldReplace(cur,o.f===1)) continue;
      try{ setTile(o.x,o.y,o.t); changed++; }catch(e){}
    }
    return changed;
  }
  // The mirror dais sits at the surface, so chunk regeneration flows through
  // the applyToChunk seam (same convention as guardian_lairs).
  function applyToChunk(arr,cx){
    if(!arr || state.phase==='dormant') return 0;
    const L=layoutFor();
    const cmin=cx*CHUNK_W, cmax=cmin+CHUNK_W-1;
    if(L.maxX<cmin || L.minX>cmax) return 0;
    const ops = state.phase==='fallen' && state.epilogueMaterialized ? L.ops.concat(epilogueOps(L)) : L.ops;
    let changed=0;
    for(const o of ops){
      if(o.x<cmin || o.x>cmax || o.y<0 || o.y>=WORLD_H) continue;
      const idx=o.y*CHUNK_W+(o.x-cmin);
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
    const changed=applyOps(layoutFor().ops,getTile,setTile);
    if(changed>0){
      state.materialized=true;
      markWorldChanged();
    }
    return changed;
  }
  function materializeEpilogue(getTile,setTile){
    getTile=getTile||lastGetTile; setTile=setTile||lastSetTile;
    if(typeof getTile!=='function' || typeof setTile!=='function') return 0;
    const L=layoutFor();
    const changed=applyOps(epilogueOps(L),getTile,setTile);
    // A single epic chest settles beside the dais: the story's material thanks.
    try{
      for(const off of [2,-2,3,-3]){
        const x=L.obeliskX+off;
        const t=getTile(x,L.floorY-1);
        const below=getTile(x,L.floorY);
        if(t===T.AIR && below!==T.AIR && below!==T.WATER){ setTile(x,L.floorY-1,T.CHEST_EPIC); break; }
      }
    }catch(e){}
    state.epilogueMaterialized=true;
    markWorldChanged();
    return changed;
  }
  function landingSpot(getTile){
    const L=layoutFor();
    getTile=getTile||lastGetTile;
    for(const off of [2,-2,3,-3,1,-1,0]){
      const tx=Math.round(L.ax+off);
      try{
        const floor=getTile ? getTile(tx,L.floorY) : T.GLASS;
        const body=getTile ? getTile(tx,L.floorY-1) : T.AIR;
        if(isSolid(floor) && !isSolid(body)) return {x:tx+0.5,y:L.floorY-1,tileX:tx,surface:L.floorY,layout:L};
      }catch(e){}
    }
    return {x:L.ax+0.5,y:L.floorY-1,tileX:Math.round(L.ax),surface:L.floorY,fallback:true,layout:L};
  }

  // --- Effects & staged speech ----------------------------------------------
  function addEffect(e){
    effects.push(e);
    while(effects.length>CFG.EFFECT_CAP) effects.shift();
  }
  function speakAt(text,x,y,t){
    state.talk={text:String(text||''),x:finite(x,0),y:finite(y,0),t:Math.max(1.5,Number(t)||4.2)};
  }
  function schedule(delay,fn){ timers.push({t:Math.max(0,Number(delay)||0),fn}); }
  function scheduleLines(lines,startDelay,gap,alsoBubbleAt){
    const list=Array.isArray(lines)?lines:[lines];
    let at=Number(startDelay)||0;
    for(const line of list){
      const text=String(line||'').trim();
      if(!text) continue;
      schedule(at,()=>{
        say(text);
        if(alsoBubbleAt) speakAt(text,alsoBubbleAt.x,alsoBubbleAt.y,Math.max(2.6,gap*0.92));
      });
      at+=Math.max(1.2,Number(gap)||2.6);
    }
    return at;
  }
  function tickTimers(dt){
    for(let i=timers.length-1;i>=0;i--){
      timers[i].t-=dt;
      if(timers[i].t<=0){
        const fn=timers[i].fn;
        timers.splice(i,1);
        try{ fn(); }catch(e){}
      }
    }
  }

  // --- Battle helpers ---------------------------------------------------------
  function strikeDamage(){
    return clamp(Math.round(mimic.maxHp/CFG.STRIKE_DIVISOR), CFG.STRIKE_MIN, CFG.STRIKE_MAX);
  }
  function escalate(){
    return clamp(mimic.fightT/CFG.ESCALATE_SECONDS, 0, 1);
  }
  function beginBattle(){
    const p=playerRef();
    const L=layoutFor();
    mimic.active=true;
    mimic.maxHp=Math.max(CFG.MIN_BOSS_HP, Math.round(finite(p && p.maxHp, CFG.MIN_BOSS_HP)));
    mimic.hp=mimic.maxHp;
    mimic.x=L.obeliskX + (p && p.x<L.obeliskX ? 2.5 : -2.5);
    mimic.y=L.floorY-1.6;
    mimic.strikeCd=1.8;
    mimic.sinceContact=0;
    mimic.farT=0;
    mimic.fightT=0;
    mimic.finale=0;
    mimic.finaleDone=false;
    mimic.bolt=null;
    replay.length=0;
    reflects.length=0;
    state.phase='battle';
    state.mirrorHintIdx=0;
    state.thresholds={};
    state.stallStreak=0;
    setMentorHidden(true);
    say(LORE.transform || 'Lustro wstaje.');
    scheduleLines(LORE.battleStart||[],1.6,2.4);
    addEffect({type:'ring',x:mimic.x,y:mimic.y,t:0,max:1.4,r:9});
    sfx('charge');
    markWorldChanged();
  }
  function recordReplay(p,dt){
    replay.push({x:p.x,y:p.y,facing:(p.facing||1)>=0?1:-1,dt:Math.max(0.001,dt)});
    while(replay.length>CFG.REPLAY_CAP) replay.shift();
  }
  function replaySample(delay){
    // Walk back through the ring until `delay` seconds of gameplay have passed.
    let acc=0;
    for(let i=replay.length-1;i>=0;i--){
      acc+=replay[i].dt;
      if(acc>=delay) return replay[i];
    }
    return replay.length ? replay[0] : null;
  }
  function mirrorTarget(p){
    const L=layoutFor();
    const delay=CFG.REPLAY_DELAY*(1-0.45*escalate());
    const s=replaySample(delay) || {x:p.x,y:p.y,facing:p.facing||1};
    return {
      x:2*L.obeliskX - s.x,
      y:s.y,
      facing:-(s.facing||1)
    };
  }
  function unstickY(getTile,x,y){
    // Lift the mirror out of ground it would otherwise sink into.
    for(let i=0;i<7;i++){
      let t=T.AIR;
      try{ t=getTile ? getTile(Math.floor(x),Math.floor(y)) : T.AIR; }catch(e){ t=T.AIR; }
      if(!isSolid(t)) return y;
      y-=1;
    }
    return y;
  }
  function selfDrain(amount,label){
    if(!(amount>0) || mimic.hp<=0) return;
    mimic.hp=Math.max(0,mimic.hp-amount);
    addEffect({type:'drain',x:mimic.x,y:mimic.y-1.4,t:0,max:0.9,amount:Math.round(amount),label:label||''});
    const frac=mimic.maxHp>0 ? mimic.hp/mimic.maxHp : 0;
    const th=LORE.strikeLines||{};
    const marks=[[0.75,'hp75'],[0.5,'hp50'],[0.25,'hp25'],[0.10,'hp10']];
    for(const [f,key] of marks){
      if(frac<=f && !state.thresholds[key] && th[key]){
        state.thresholds[key]=1;
        say(th[key]);
        speakAt(th[key],mimic.x,mimic.y,4.6);
        break;
      }
    }
  }
  function mimicStrike(p,dmg,sx,sy){
    const landed=damageHero(dmg,sx,sy,'inner_self');
    addEffect({type:'strike',x:p.x,y:p.y,t:0,max:0.4});
    if(landed){
      state.stallStreak=0;
      mimic.sinceContact=0;
      selfDrain(dmg,'strike');
      sfx('spark');
      if(mimic.hp<=0 && !mimic.finale){
        mimic.finale=CFG.FINALE_PAUSE;
        say((LORE.finale && LORE.finale[0]) || 'Ostatni cios jest wspolny.');
      }
    }else{
      state.stallStreak++;
      if(state.stallStreak>=CFG.STALL_STREAK && state.stallMsgCd<=0){
        state.stallMsgCd=CFG.STALL_MSG_CD;
        say(LORE.stallHint || 'Lustro nie moze dotknac kogos, kto nie chce byc prawdziwy.');
      }
    }
    return landed;
  }
  function finishFinale(){
    if(mimic.finaleDone) return;
    mimic.finaleDone=true;
    const p=playerRef();
    // The mutual blow. main.js routes the death to onHeroKilled (no grave, no loss).
    let killed=false;
    if(p){
      killed=damageHero(Math.max(1,Math.ceil(finite(p.hp,1)))+9999, mimic.x, mimic.y, 'inner_self_final', {invulMs:0, kb:0, kbY:0});
    }
    if(!killed){
      // Untouchable observer (immunity/god mode): complete the story without the fall.
      concludeVictory({heroFell:false});
    }
  }
  function shatterMimic(){
    if(!mimic.active) return;
    mimic.active=false;
    for(let i=0;i<26;i++){
      const a=(Math.PI*2*i)/26;
      addEffect({
        type:'shard',
        x:mimic.x, y:mimic.y,
        vx:Math.cos(a)*(3+((i*7)%5)),
        vy:Math.sin(a)*(3+((i*3)%4))-2.2,
        t:0, max:1.7, rot:a
      });
    }
    addEffect({type:'ring',x:mimic.x,y:mimic.y,t:0,max:2.2,r:15});
    sfx('explosion');
  }
  function awardHeart(){
    let newly=true, handled=false;
    try{
      if(MM.progress && MM.progress.markGuardianHeart){
        newly=!!MM.progress.markGuardianHeart('mother');
        handled=true;
      }
    }catch(e){}
    const inv=root.inv;
    if(!handled) newly=!(inv && (Number(inv[SPEC.heartKey])||0)>0);
    if(newly && inv) inv[SPEC.heartKey]=(Number(inv[SPEC.heartKey])||0)+1;
    state.heartAwarded=true;
    try{ if(root.updateInventoryHud) root.updateInventoryHud(); }catch(e){}
    try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-resources-change')); }catch(e){}
    try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-guardian-defeated',{detail:{kind:'mother',name:SPEC.bossName,heart:SPEC.heartKey,newReward:newly,center:true}})); }catch(e){}
    try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-boss-killed',{detail:{name:SPEC.bossName,guardian:true,kind:'mother',center:true}})); }catch(e){}
    return newly;
  }
  function grantQuietCharm(){
    if(state.charmGranted) return true;
    const item={
      id:'serce_ciszy',
      kind:'charm',
      name:'Serce Ciszy',
      tier:'epic',
      maxHpBonus:20,
      moveSpeedMult:1.05,
      desc:'Zostalo po Ostatnim Lustrze. Nie chroni przed niczym. Przypomina, ze nie trzeba.'
    };
    let ok=false;
    try{
      if(MM.inventory && MM.inventory.grantItem) ok=!!MM.inventory.grantItem(item,{equip:false,markNew:true,essential:true});
    }catch(e){ ok=false; }
    if(ok) state.charmGranted=true;
    return ok;
  }
  function concludeVictory(opts){
    if(state.phase==='fallen') return;
    shatterMimic();
    state.phase='fallen';
    state.suspended=false;
    reflects.length=0;
    awardHeart();
    grantQuietCharm();
    materializeEpilogue();
    setMentorHidden(false);
    const rest=(LORE.finale||[]).slice(1);
    let at=scheduleLines(rest,1.2,2.6);
    if(opts && opts.heroFell===false) at=Math.max(at,1.2);
    schedule(at+0.4,()=>{
      scheduleLines(LORE.epilogueArrival||[],0,2.8);
      state.epilogueArrived=true;
    });
    markWorldChanged();
  }
  // Called from window.heroDied for causes 'inner_self' / 'inner_mirror' /
  // 'inner_self_final': the mirror fight never takes the hero's belongings.
  function onHeroKilled(detail){
    const cause=String(detail && detail.cause || '');
    if(state.phase!=='battle' && state.phase!=='fallen') return null;
    if(cause==='inner_self_final'){
      concludeVictory({heroFell:true});
      return {handled:true, suppressGrave:true, silent:false};
    }
    if(cause==='inner_self' || cause==='inner_mirror'){
      // Fell too early: the fight pauses, keeps its progress, and waits.
      mimic.strikeCd=2.6;
      state.suspended=true;
      const lines=LORE.heroFellEarly||[];
      if(lines.length) say(lines[(state.seq++)%lines.length]);
      return {handled:true, suppressGrave:true, silent:true};
    }
    return null;
  }

  // --- Damage intake: the reversal --------------------------------------------
  function mimicHitAt(tx,ty){
    if(!mimic.active) return false;
    const x=tx+0.5, y=ty+0.5;
    return Math.abs(x-mimic.x)<1.35 && Math.abs(y-mimic.y)<1.6;
  }
  function damageAt(tx,ty,dmg,opts){
    void opts;
    if(state.phase!=='battle' || !mimicHitAt(tx,ty)) return false;
    const amount=clamp(Math.max(0.5,Number(dmg)||1),0.5,CFG.REFLECT_CAP_PER_HIT);
    reflects.push({t:CFG.REFLECT_DELAY, amount, sx:mimic.x, sy:mimic.y});
    while(reflects.length>8) reflects.shift();
    mimic.hitFlash=0.22;
    addEffect({type:'mirror',x:mimic.x,y:mimic.y,t:0,max:0.5});
    if(state.mirrorHintIdx<(LORE.mirrorHints||[]).length){
      say(LORE.mirrorHints[state.mirrorHintIdx]);
      state.mirrorHintIdx++;
    }
    return true;
  }
  function attackAt(tx,ty,bonus){
    return damageAt(tx,ty,7+Math.max(0,Number(bonus)||0),{kind:'melee',source:'hero'});
  }
  function collideHero(p,dt){
    p=p||playerRef();
    if(!p || !mimic.active || state.phase!=='battle') return false;
    const dx=p.x-mimic.x, dy=p.y-mimic.y;
    const d=Math.hypot(dx,dy)||1;
    const min=1.05;
    if(d>=min) return false;
    const push=(min-d)*0.55;
    p.x+=dx/d*push;
    p.y+=dy/d*push*0.4;
    p.vx=finite(p.vx,0)+dx/d*4.4*Math.min(0.1,dt||0.016);
    return true;
  }

  // --- Interaction: the confession, and the freed mentor ----------------------
  function obeliskNear(tx,ty){
    const L=layoutFor();
    return Math.abs(tx-L.obeliskX)<=1.5 && ty>=L.floorY-7 && ty<=L.floorY+1;
  }
  function revealAnchor(){
    const L=layoutFor();
    const m=mentorPos();
    if(m && dist2(m.x,m.y,L.obeliskX,L.floorY)<=26*26) return m;
    return {x:L.obeliskX+0.5, y:L.floorY-2};
  }
  function advanceReveal(){
    const lines=LORE.reveal||[];
    const anchor=revealAnchor();
    if(state.revealIdx<lines.length){
      const line=lines[state.revealIdx];
      state.revealIdx++;
      say('Stary Kwadrat: '+line);
      speakAt(line,anchor.x,anchor.y,6.5);
      sfx('spark');
      markWorldChanged();
      if(state.revealIdx>=lines.length){
        schedule(1.6,()=>beginBattle());
      }
      return true;
    }
    return false;
  }
  function interactAt(tx,ty,p){
    p=p||playerRef();
    if(state.phase==='calling' || state.phase==='reveal'){
      const nearObelisk=obeliskNear(tx,ty);
      const m=mentorPos();
      const nearMentor=m && Math.abs(tx+0.5-m.x)<1.4 && Math.abs(ty+0.5-m.y)<1.6;
      const L=layoutFor();
      const mentorAtCenter=m && dist2(m.x,m.y,L.obeliskX,L.floorY)<=26*26;
      if(!nearObelisk && !(nearMentor && mentorAtCenter)) return false;
      if(p && dist2(p.x,p.y,L.obeliskX+0.5,L.floorY-2)>CFG.REVEAL_RADIUS*CFG.REVEAL_RADIUS && !(nearMentor)) return false;
      if(state.phase==='calling'){ state.phase='reveal'; state.revealIdx=0; }
      return advanceReveal();
    }
    if(state.phase==='fallen'){
      const m=mentorPos();
      const nearMentor=m && Math.abs(tx+0.5-m.x)<1.4 && Math.abs(ty+0.5-m.y)<1.6;
      if(!nearMentor && !obeliskNear(tx,ty)) return false;
      const lines=LORE.epilogueTalk||[];
      if(!lines.length) return false;
      const line=lines[state.epilogueTalkIdx%lines.length];
      state.epilogueTalkIdx++;
      say(line);
      const anchor=m||revealAnchor();
      speakAt(line,anchor.x,anchor.y,5.2);
      return true;
    }
    return false;
  }

  // --- Update -------------------------------------------------------------------
  function updateReflects(dt){
    for(let i=reflects.length-1;i>=0;i--){
      const r=reflects[i];
      r.t-=dt;
      if(r.t>0) continue;
      reflects.splice(i,1);
      const p=playerRef();
      if(!p) continue;
      damageHero(r.amount, r.sx, r.sy, 'inner_mirror', {invulMs:520, kb:3});
      addEffect({type:'reflect',x:p.x,y:p.y,t:0,max:0.42});
    }
  }
  function updateBolt(dt,p){
    const b=mimic.bolt;
    if(!b) return;
    b.t+=dt;
    const dx=p.x-b.x, dy=(p.y-0.2)-b.y;
    const d=Math.hypot(dx,dy)||1;
    const sp=CFG.BOLT_SPEED*(1+0.5*escalate());
    b.vx+= (dx/d*sp - b.vx)*Math.min(1,dt*3.2);
    b.vy+= (dy/d*sp - b.vy)*Math.min(1,dt*3.2);
    b.x+=b.vx*dt;
    b.y+=b.vy*dt;
    if(d<1.1){
      mimic.bolt=null;
      const landed=damageHero(b.dmg,b.x,b.y,'inner_self',{invulMs:560,kb:3});
      addEffect({type:'strike',x:p.x,y:p.y,t:0,max:0.35});
      if(landed){
        selfDrain(b.dmg,'echo');
        if(mimic.hp<=0 && !mimic.finale){
          mimic.finale=CFG.FINALE_PAUSE;
          say((LORE.finale && LORE.finale[0]) || 'Ostatni cios jest wspolny.');
        }
      }
    } else if(b.t>7){
      mimic.bolt=null;
    }
  }
  function updateBattle(dt,p,getTile){
    if(!mimic.active) return;
    mimic.fightT+=dt;
    mimic.walkT+=dt;
    mimic.hitFlash=Math.max(0,mimic.hitFlash-dt);
    state.stallMsgCd=Math.max(0,state.stallMsgCd-dt);
    const L=layoutFor();
    const dObelisk=Math.hypot(p.x-(L.obeliskX+0.5), p.y-(L.floorY-2));
    if(!state.suspended && dObelisk>CFG.LEASH_RADIUS) state.suspended=true;
    if(state.suspended && dObelisk<CFG.RESUME_RADIUS && (p.hp==null || p.hp>0)) state.suspended=false;

    recordReplay(p,dt);
    if(mimic.finale>0){
      mimic.finale-=dt;
      // Drift to arm's length for the shared blow.
      mimic.x+=((p.x+(p.x<mimic.x?1.4:-1.4))-mimic.x)*Math.min(1,dt*3);
      mimic.y+=((p.y)-mimic.y)*Math.min(1,dt*3);
      if(mimic.finale<=0) finishFinale();
      return;
    }
    if(state.suspended){
      // The mirror waits at the dais; progress is kept.
      mimic.x+=((L.obeliskX+0.5)-mimic.x)*Math.min(1,dt*1.4);
      mimic.y+=((L.floorY-1.6)-mimic.y)*Math.min(1,dt*1.4);
      return;
    }
    mimic.sinceContact+=dt;
    const pursuit=clamp(mimic.sinceContact/CFG.PURSUIT_SECONDS,0,1);
    const mt=mirrorTarget(p);
    const tx=mt.x+(p.x-mt.x)*pursuit;
    const ty=mt.y+(p.y-mt.y)*pursuit;
    const speed=CFG.MIRROR_SPEED+(CFG.MIRROR_SPEED_MAX-CFG.MIRROR_SPEED)*escalate();
    mimic.x+=(tx-mimic.x)*Math.min(1,dt*speed*0.45);
    mimic.y+=(ty-mimic.y)*Math.min(1,dt*speed*0.45);
    mimic.y=unstickY(getTile,mimic.x,mimic.y);
    mimic.facing=(p.x>=mimic.x)?1:-1;

    const dx=Math.abs(p.x-mimic.x), dy=Math.abs(p.y-mimic.y);
    const cd=CFG.STRIKE_BASE_CD-(CFG.STRIKE_BASE_CD-CFG.STRIKE_MIN_CD)*escalate();
    mimic.strikeCd-=dt;
    if(dx<CFG.STRIKE_RANGE_X && dy<CFG.STRIKE_RANGE_Y){
      mimic.farT=0;
      if(mimic.strikeCd<=0){
        mimic.strikeCd=cd;
        mimicStrike(p,strikeDamage(),mimic.x,mimic.y);
      }
    }else{
      if(dx>CFG.BOLT_RANGE_TRIGGER) mimic.farT+=dt; else mimic.farT=0;
      if(mimic.farT>CFG.BOLT_FAR_SECONDS && !mimic.bolt && escalate()>0.15){
        mimic.farT=0;
        mimic.bolt={x:mimic.x,y:mimic.y-0.6,vx:0,vy:-2,t:0,dmg:Math.round(strikeDamage()*0.7)};
        addEffect({type:'mirror',x:mimic.x,y:mimic.y,t:0,max:0.4});
      }
    }
    if(mimic.bolt) updateBolt(dt,p);
  }
  function update(dt,player,getTile,setTile){
    if(typeof getTile==='function') lastGetTile=getTile;
    if(typeof setTile==='function') lastSetTile=setTile;
    if(!(dt>0) || !Number.isFinite(dt)) return;
    dt=Math.min(0.1,dt);
    const p=player||playerRef();
    tickTimers(dt);
    if(state.talk){
      state.talk.t-=dt;
      if(state.talk.t<=0) state.talk=null;
    }
    for(let i=effects.length-1;i>=0;i--){
      const e=effects[i];
      e.t+=dt;
      if(e.type==='shard'){
        e.x+=e.vx*dt; e.y+=e.vy*dt; e.vy+=6*dt;
      }
      if(e.t>=e.max) effects.splice(i,1);
    }
    updateReflects(dt);
    if(state.phase==='dormant'){
      if(skyDefeated()){
        state.phase='calling';
        materializeArena(getTile,setTile);
        if(!state.callAnnounced){
          state.callAnnounced=true;
          scheduleLines(LORE.falseFinalOmen||[],2.0,3.2);
        }
        markWorldChanged();
      }
      return;
    }
    if(!state.materialized) materializeArena(getTile,setTile);
    if(state.phase==='calling' && p){
      const L=layoutFor();
      if(!state.nearHintSaid && dist2(p.x,p.y,L.obeliskX+0.5,L.floorY-2)<CFG.CALL_HINT_RADIUS*CFG.CALL_HINT_RADIUS){
        state.nearHintSaid=true;
        say('Obelisk w srodku swiata czeka. Stary Kwadrat stoi przy nim jakby znal go od zawsze.');
      }
      return;
    }
    if(state.phase==='battle'){
      setMentorHidden(true); // self-healing across reloads
      if(p) updateBattle(dt,p,getTile||lastGetTile);
      return;
    }
    if(state.phase==='fallen'){
      if(!state.epilogueMaterialized) materializeEpilogue(getTile,setTile);
      setMentorHidden(false);
      return;
    }
  }

  // --- Drawing --------------------------------------------------------------------
  function drawMimic(ctx,TILE){
    if(!mimic.active) return;
    const bw=0.7*TILE, bh=0.95*TILE;
    const bx=(mimic.x-0.35)*TILE;
    const by=(mimic.y-0.475)*TILE+Math.sin(mimic.walkT*2.2)*1.6;
    ctx.save();
    // Dark aura behind the reflection.
    const g=ctx.createRadialGradient(mimic.x*TILE,mimic.y*TILE,2,mimic.x*TILE,mimic.y*TILE,TILE*1.9);
    g.addColorStop(0,'rgba(155,140,255,0.30)');
    g.addColorStop(1,'rgba(20,18,31,0)');
    ctx.fillStyle=g;
    ctx.beginPath(); ctx.arc(mimic.x*TILE,mimic.y*TILE,TILE*1.9,0,Math.PI*2); ctx.fill();
    if(mimic.facing<0){
      ctx.translate((bx+bw*0.5)*2,0);
      ctx.scale(-1,1);
    }
    let drewOutfit=false;
    try{
      if(typeof MM.drawOutfit==='function'){
        const c=MM.customization||{};
        const style=((c && c.outfitStyle)!=null?String(c.outfitStyle):'default').trim().toLowerCase();
        if(ctx.filter!==undefined) ctx.filter='saturate(0.35) brightness(0.66)';
        MM.drawOutfit(ctx,bx,by,bw,bh,style,c);
        if(ctx.filter!==undefined) ctx.filter='none';
        drewOutfit=true;
      }
    }catch(e){ drewOutfit=false; }
    if(!drewOutfit){
      ctx.fillStyle='#2a2440';
      ctx.fillRect(bx,by,bw,bh);
      ctx.strokeStyle='#9b8cff';
      ctx.strokeRect(bx,by,bw,bh);
    }
    ctx.restore();
    // Pale mirror eyes over whatever the outfit drew.
    ctx.save();
    ctx.fillStyle='rgba(220,214,255,0.92)';
    const eyeY=by+bh*0.35, off=bw*0.18;
    ctx.fillRect(bx+bw/2-off-2,eyeY-2,4,4);
    ctx.fillRect(bx+bw/2+off-2,eyeY-2,4,4);
    if(mimic.hitFlash>0){
      ctx.globalAlpha=Math.min(1,mimic.hitFlash*4);
      ctx.strokeStyle='#fff';
      ctx.lineWidth=2;
      ctx.strokeRect(bx-2,by-2,bw+4,bh+4);
    }
    ctx.restore();
    if(mimic.bolt){
      const b=mimic.bolt;
      ctx.save();
      ctx.fillStyle='rgba(190,180,255,0.9)';
      ctx.beginPath(); ctx.arc(b.x*TILE,b.y*TILE,TILE*0.22,0,Math.PI*2); ctx.fill();
      ctx.restore();
    }
  }
  function drawEffects(ctx,TILE){
    for(const e of effects){
      const k=1-e.t/e.max;
      ctx.save();
      if(e.type==='ring'){
        ctx.strokeStyle='rgba(200,190,255,'+(0.65*k).toFixed(3)+')';
        ctx.lineWidth=2.4;
        ctx.beginPath(); ctx.arc(e.x*TILE,e.y*TILE,(e.r||9)*TILE*(1-k*0.75),0,Math.PI*2); ctx.stroke();
      }else if(e.type==='mirror' || e.type==='reflect'){
        ctx.strokeStyle='rgba(255,255,255,'+(0.8*k).toFixed(3)+')';
        ctx.lineWidth=1.6;
        for(let i=0;i<3;i++){
          const a=e.t*9+i*2.1;
          ctx.beginPath();
          ctx.moveTo(e.x*TILE+Math.cos(a)*3,e.y*TILE+Math.sin(a)*3);
          ctx.lineTo(e.x*TILE+Math.cos(a)*(9+k*7),e.y*TILE+Math.sin(a)*(9+k*7));
          ctx.stroke();
        }
      }else if(e.type==='strike'){
        ctx.fillStyle='rgba(255,120,120,'+(0.5*k).toFixed(3)+')';
        ctx.beginPath(); ctx.arc(e.x*TILE,e.y*TILE,TILE*0.6*(1.2-k*0.4),0,Math.PI*2); ctx.fill();
      }else if(e.type==='drain'){
        ctx.fillStyle='rgba(255,235,160,'+(0.9*k).toFixed(3)+')';
        ctx.font='bold 12px system-ui';
        ctx.textAlign='center';
        ctx.fillText('-'+e.amount,e.x*TILE,(e.y-(1-k)*1.4)*TILE);
      }else if(e.type==='shard'){
        ctx.translate(e.x*TILE,e.y*TILE);
        ctx.rotate(e.rot+e.t*4);
        ctx.fillStyle='rgba(206,198,255,'+(0.85*k).toFixed(3)+')';
        ctx.beginPath();
        ctx.moveTo(0,-5); ctx.lineTo(4,4); ctx.lineTo(-4,3);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
  }
  function drawObeliskAura(ctx,TILE,now){
    if(state.phase==='dormant') return;
    const L=layoutFor();
    const cx=(L.obeliskX+0.5)*TILE, cy=(L.floorY-4)*TILE;
    const pulse=0.5+0.5*Math.sin(now*0.0016);
    ctx.save();
    const calm=state.phase==='fallen';
    const g=ctx.createRadialGradient(cx,cy,2,cx,cy,TILE*(2.4+pulse*0.8));
    if(calm){
      g.addColorStop(0,'rgba(255,232,150,0.28)');
      g.addColorStop(1,'rgba(255,232,150,0)');
    }else{
      g.addColorStop(0,'rgba(155,140,255,0.30)');
      g.addColorStop(1,'rgba(155,140,255,0)');
    }
    ctx.fillStyle=g;
    ctx.beginPath(); ctx.arc(cx,cy,TILE*(2.4+pulse*0.8),0,Math.PI*2); ctx.fill();
    ctx.restore();
  }
  function drawTalk(ctx,TILE){
    if(!state.talk) return;
    let bubble=null;
    try{ bubble=MM.npcDialogueBubble; }catch(e){ bubble=null; }
    const x=state.talk.x*TILE, y=(state.talk.y-0.9)*TILE;
    if(typeof bubble==='function'){
      bubble(ctx,x,y,state.talk.text);
      return;
    }
    ctx.save();
    ctx.font='12px system-ui';
    const w=Math.min(240,Math.max(90,state.talk.text.length*5.4));
    ctx.fillStyle='rgba(10,12,20,0.78)';
    ctx.fillRect(x-w/2,y-40,w,30);
    ctx.fillStyle='#efeaff';
    ctx.textAlign='center';
    ctx.fillText(state.talk.text.slice(0,60),x,y-27);
    if(state.talk.text.length>60) ctx.fillText(state.talk.text.slice(60,124),x,y-14);
    ctx.restore();
  }
  function tileVisible(canDrawTile,x,y,pad){
    if(typeof canDrawTile!=='function') return true;
    try{ return !!canDrawTile(Math.floor(x),Math.floor(y),pad); }catch(e){ return true; }
  }
  function draw(ctx,TILE,canDrawTile){
    if(!ctx || state.phase==='dormant') return;
    const now=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
    const L=layoutFor();
    if(tileVisible(canDrawTile,L.obeliskX,L.floorY-4,6)) drawObeliskAura(ctx,TILE,now);
    if(mimic.active && tileVisible(canDrawTile,mimic.x,mimic.y,4)) drawMimic(ctx,TILE);
    drawEffects(ctx,TILE);
    drawTalk(ctx,TILE);
  }
  function drawHUD(ctx,W,H,camX,camY,zoom,TILE){
    if(!ctx) return;
    if(state.phase!=='battle' || !mimic.active) return;
    // Boss bar: the only guardian whose bar drains from ITS OWN blows.
    const w=Math.min(420,W*0.5), h=10;
    const x=(W-w)/2, y=26;
    const frac=mimic.maxHp>0?clamp(mimic.hp/mimic.maxHp,0,1):0;
    ctx.save();
    ctx.fillStyle='rgba(8,8,16,0.62)';
    ctx.fillRect(x-3,y-17,w+6,h+24);
    ctx.fillStyle='#efeaff';
    ctx.font='bold 12px system-ui';
    ctx.textAlign='center';
    ctx.fillText(SPEC.bossName+' — '+SPEC.bossTitle,W/2,y-5);
    ctx.fillStyle='rgba(70,64,110,0.8)';
    ctx.fillRect(x,y,w,h);
    ctx.fillStyle='rgba(174,160,255,0.95)';
    ctx.fillRect(x,y,w*frac,h);
    ctx.strokeStyle='rgba(230,225,255,0.55)';
    ctx.strokeRect(x,y,w,h);
    ctx.restore();
    // Off-screen arrow toward the mirror while it hunts.
    const p=playerRef();
    if(!p) return;
    const sx=(mimic.x-camX)*TILE*zoom, sy=(mimic.y-camY)*TILE*zoom;
    if(sx>36 && sx<W-36 && sy>36 && sy<H-36) return;
    const ang=Math.atan2(sy-H/2,sx-W/2);
    const ex=W/2+Math.cos(ang)*(Math.min(W,H)/2-44), ey=H/2+Math.sin(ang)*(Math.min(W,H)/2-44);
    ctx.save();
    ctx.translate(ex,ey);
    ctx.rotate(ang);
    ctx.fillStyle='rgba(174,160,255,0.9)';
    ctx.beginPath(); ctx.moveTo(14,0); ctx.lineTo(-8,-8); ctx.lineTo(-8,8); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // --- Persistence, status, debug -------------------------------------------------
  function cleanPhase(v){
    return PHASES.indexOf(String(v||''))>=0 ? String(v) : 'dormant';
  }
  function snapshot(){
    return {
      v:1,
      phase:state.phase,
      materialized:!!state.materialized,
      epilogueMaterialized:!!state.epilogueMaterialized,
      callAnnounced:!!state.callAnnounced,
      nearHintSaid:!!state.nearHintSaid,
      revealIdx:clamp(Math.round(state.revealIdx),0,64),
      mirrorHintIdx:clamp(Math.round(state.mirrorHintIdx),0,16),
      thresholds:Object.assign({},state.thresholds),
      epilogueArrived:!!state.epilogueArrived,
      epilogueTalkIdx:clamp(Math.round(state.epilogueTalkIdx),0,999),
      heartAwarded:!!state.heartAwarded,
      charmGranted:!!state.charmGranted,
      mimic:{
        hp:Math.max(0,Math.round(mimic.hp)),
        maxHp:Math.max(0,Math.round(mimic.maxHp))
      }
    };
  }
  function restore(data){
    reset();
    if(!data || typeof data!=='object') return false;
    state.phase=cleanPhase(data.phase);
    state.materialized=!!data.materialized;
    state.epilogueMaterialized=!!data.epilogueMaterialized;
    state.callAnnounced=!!data.callAnnounced;
    state.nearHintSaid=!!data.nearHintSaid;
    state.revealIdx=clamp(Math.round(Number(data.revealIdx)||0),0,64);
    state.mirrorHintIdx=clamp(Math.round(Number(data.mirrorHintIdx)||0),0,16);
    state.thresholds=(data.thresholds&&typeof data.thresholds==='object')?Object.assign({},data.thresholds):{};
    state.epilogueArrived=!!data.epilogueArrived;
    state.epilogueTalkIdx=clamp(Math.round(Number(data.epilogueTalkIdx)||0),0,999);
    state.heartAwarded=!!data.heartAwarded;
    state.charmGranted=!!data.charmGranted;
    if(state.phase==='battle'){
      const hp=Math.max(1,Math.round(Number(data.mimic&&data.mimic.hp)||0));
      const maxHp=Math.max(CFG.MIN_BOSS_HP,Math.round(Number(data.mimic&&data.mimic.maxHp)||CFG.MIN_BOSS_HP));
      mimic.active=true;
      mimic.hp=Math.min(hp,maxHp);
      mimic.maxHp=maxHp;
      const L=layoutFor();
      mimic.x=L.obeliskX+2.5;
      mimic.y=L.floorY-1.6;
      state.suspended=true; // resumes when the hero walks back in
    }
    if(state.phase==='reveal' && state.revealIdx>= (LORE.reveal||[]).length){
      // The confession finished but the battle never started (mid-transition save).
      schedule(0.8,()=>beginBattle());
    }
    return true;
  }
  function reset(){
    state.phase='dormant';
    state.materialized=false;
    state.epilogueMaterialized=false;
    state.callAnnounced=false;
    state.nearHintSaid=false;
    state.revealIdx=0;
    state.mirrorHintIdx=0;
    state.thresholds={};
    state.epilogueArrived=false;
    state.epilogueTalkIdx=0;
    state.heartAwarded=false;
    state.charmGranted=false;
    state.stallStreak=0;
    state.stallMsgCd=0;
    state.suspended=false;
    state.talk=null;
    mimic.active=false;
    mimic.hp=0; mimic.maxHp=0;
    mimic.bolt=null;
    mimic.finale=0;
    mimic.finaleDone=false;
    replay.length=0;
    reflects.length=0;
    effects.length=0;
    timers.length=0;
  }
  function clearCache(){ cache.clear(); }
  function status(){
    const L=layoutFor();
    return {
      phase:state.phase,
      unlocked:state.phase!=='dormant',
      defeated:completed(),
      suspended:!!state.suspended,
      obeliskX:L.obeliskX,
      obeliskY:L.obeliskY,
      floorY:L.floorY,
      revealIdx:state.revealIdx,
      revealTotal:(LORE.reveal||[]).length,
      mimic:mimic.active?{x:mimic.x,y:mimic.y,hp:mimic.hp,maxHp:mimic.maxHp,finale:mimic.finale>0||mimic.finaleDone}:null
    };
  }
  function metrics(){
    return {
      phase:state.phase,
      effects:effects.length,
      reflects:reflects.length,
      timers:timers.length,
      replay:replay.length,
      mimicHp:mimic.active?Math.round(mimic.hp):0
    };
  }
  function callTarget(){
    const L=layoutFor();
    return {x:L.obeliskX+0.5, y:L.floorY-2};
  }
  function forceCall(getTile,setTile){
    if(state.phase!=='dormant') return false;
    state.phase='calling';
    state.callAnnounced=true;
    materializeArena(getTile||lastGetTile,setTile||lastSetTile);
    return true;
  }
  function forceBattle(getTile,setTile){
    if(state.phase==='battle' || state.phase==='fallen') return false;
    if(state.phase==='dormant') forceCall(getTile,setTile);
    state.revealIdx=(LORE.reveal||[]).length;
    beginBattle();
    return true;
  }
  function _debug(){
    return {state, mimic, effects, reflects, timers, replay,
      beginBattle, concludeVictory, finishFinale, selfDrain, mimicStrike,
      strikeDamage, escalate, mirrorTarget, layoutFor};
  }

  const api={
    update, draw, drawHUD, damageAt, attackAt, collideHero, interactAt,
    onHeroKilled, applyToChunk, materializeArena, materializeEpilogue,
    layoutFor, landingSpot, callTarget, status, metrics, completed,
    snapshot, restore, reset, clearCache, forceCall, forceBattle,
    config:CFG, spec:SPEC, _debug
  };
  MM.centerGuardian=api;
  return api;
})();

export { centerGuardian };
export default centerGuardian;
