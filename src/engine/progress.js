// Progression spine: XP → levels → skill points spent on trainable stats
// (Witalność/Siła/Zwinność/Pojemność), plus persistent milestones with rewards. Bonuses
// flow into the existing modifier engine (inventory.js merges MM.progress.bonuses()
// into MM.activeModifiers); max-HP changes are applied by main.js listening to
// the mm-progress-change event. State persists in mm_progress_v1.
window.MM = window.MM || {};
(function(){
  const SAVE_KEY='mm_progress_v1';
  const state={ vit:0, str:0, agi:0, cap:0, lastLevel:1, bossKills:0, done:{}, trophies:{} };
  let berries=0;
  const SEASON_TROPHY_KEYS=['springAntler','summerHorn','autumnHeartwood','winterFur'];

  function toInt(v,min,max){
    const n=Number(v);
    if(!isFinite(n)) return min;
    let out=Math.floor(n);
    if(out<min) out=min;
    if(typeof max==='number' && out>max) out=max;
    return out;
  }
  function cleanDone(src){
    const out={};
    if(src && typeof src==='object'){
      Object.keys(src).forEach(k=>{ if(src[k]) out[String(k).slice(0,64)]=1; });
    }
    return out;
  }
  function cleanTrophies(src){
    const out={};
    if(src && typeof src==='object'){
      for(const k of SEASON_TROPHY_KEYS) if(src[k]) out[k]=1;
    }
    return out;
  }
  function snapshot(){
    return {
      v:2,
      vit:toInt(state.vit,0,999),
      str:toInt(state.str,0,999),
      agi:toInt(state.agi,0,999),
      cap:toInt(state.cap,0,999),
      lastLevel:toInt(state.lastLevel,1,99),
      bossKills:toInt(state.bossKills,0),
      done:cleanDone(state.done),
      trophies:cleanTrophies(state.trophies),
      berries:toInt(berries,0),
    };
  }
  function applySnapshot(d){
    if(!d || typeof d!=='object') return false;
    state.vit=toInt(d.vit,0,999);
    state.str=toInt(d.str,0,999);
    state.agi=toInt(d.agi,0,999);
    state.cap=toInt(d.cap,0,999);
    state.lastLevel=toInt(d.lastLevel,1,99);
    state.bossKills=toInt(d.bossKills,0);
    state.done=cleanDone(d.done);
    state.trophies=cleanTrophies(d.trophies);
    berries=toInt(d.berries,0);
    return true;
  }
  function save(){ try{ localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot())); }catch(e){} }
  function restore(data){
    if(!applySnapshot(data)) return false;
    save();
    try{ if(MM.recomputeModifiers) MM.recomputeModifiers(); }catch(e){}
    notify();
    return true;
  }
  (function load(){
    try{
      const raw=localStorage.getItem(SAVE_KEY); if(!raw) return;
      applySnapshot(JSON.parse(raw));
    }catch(e){}
  })();
  // Boss kills must survive reloads (bosses.js's session counter resets with the
  // module), otherwise the ×5 milestone is unreachable across sessions.
  if(typeof window!=='undefined' && window.addEventListener){
    window.addEventListener('mm-boss-killed',()=>{ state.bossKills++; save(); });
  }

  function playerRef(){ return (typeof window!=='undefined' && window.player)||null; }
  function notify(){ try{ window.dispatchEvent(new CustomEvent('mm-progress-change')); }catch(e){} }
  function say(t){ try{ if(window.msg) window.msg(t); }catch(e){} }
  function markSeasonalTrophies(inv){
    if(!inv || typeof inv!=='object') return false;
    let changed=false;
    for(const key of SEASON_TROPHY_KEYS){
      if(!state.trophies[key] && (Number(inv[key])||0)>0){
        state.trophies[key]=1;
        changed=true;
      }
    }
    if(changed) save();
    return changed;
  }
  function hasSeasonalTrophy(ctx,key){
    return !!(state.trophies[key] || (ctx && ctx.inv && (Number(ctx.inv[key])||0)>0));
  }
  if(typeof window!=='undefined' && window.addEventListener){
    window.addEventListener('mm-resources-change',()=>{ markSeasonalTrophies((typeof window!=='undefined'&&window.inv)||null); });
  }

  // --- Levels: cumulative XP thresholds, gently super-linear ---
  function needFor(level){ return Math.round(60*Math.pow(level,1.35)); } // XP from L → L+1
  function levelFor(xp){
    let lvl=1, acc=0;
    while(lvl<99){ const n=needFor(lvl); if(xp<acc+n) break; acc+=n; lvl++; }
    return {level:lvl, into:xp-acc, need:needFor(lvl)};
  }
  function level(){ const p=playerRef(); return levelFor((p&&p.xp)||0); }
  function points(){ const L=level().level; return Math.max(0,(L-1)-(state.vit+state.str+state.agi+state.cap)); }
  function spend(stat){
    if(points()<=0 || !(stat in {vit:1,str:1,agi:1,cap:1})) return false;
    state[stat]++; save();
    try{ if(MM.recomputeModifiers) MM.recomputeModifiers(); }catch(e){}
    notify();
    return true;
  }
  // Merged by inventory.computeModifiers into MM.activeModifiers
  function bonuses(){
    return {
      attackDamage: state.str,                 // +1 dmg per point of Siła
      moveSpeedMult: 1+state.agi*0.02,         // +2% move per Zwinność
      jumpPowerMult: 1+state.agi*0.02,         // +2% jump per Zwinność
      maxHpBonus: state.vit*10,                // +10 HP per Witalność (applied in main)
      energyCapacityBonus: state.cap*25,       // +25 energy capacity per Pojemność
    };
  }

  // --- Timed buffs (potions, future shrine boons): each carries a stat bundle
  // merged through the registered modifier source below; expiry prunes and
  // recomputes. Session-scoped by design (a reload sobers the hero up).
  const buffs=[]; // {name,icon,t,stats}
  const MUL_KEYS=new Set(['moveSpeedMult','jumpPowerMult','mineSpeedMult']);
  function addBuff(b){
    if(!b || !b.stats) return false;
    buffs.push({name:b.name||'Buff', icon:b.icon||'✦', t:Math.max(1,b.dur||30), stats:b.stats});
    try{ if(MM.recomputeModifiers) MM.recomputeModifiers(); }catch(e){}
    notify();
    return true;
  }
  function buffBundle(){
    if(!buffs.length) return null;
    const out={};
    for(const b of buffs){
      for(const k in b.stats){
        const v=b.stats[k]; if(typeof v!=='number' || !isFinite(v)) continue;
        if(MUL_KEYS.has(k)) out[k]=(out[k]==null?1:out[k])*v;
        else out[k]=(out[k]||0)+v;
      }
    }
    return out;
  }
  function tickBuffs(dt){
    if(!buffs.length) return;
    let expired=false;
    for(let i=buffs.length-1;i>=0;i--){ buffs[i].t-=dt; if(buffs[i].t<=0){ buffs.splice(i,1); expired=true; } }
    if(expired){
      try{ if(MM.recomputeModifiers) MM.recomputeModifiers(); }catch(e){}
      say('✦ Działanie mikstury wygasło');
      notify();
    }
  }

  // --- Milestones: checked on a slow tick; each completes once, rewards persist ---
  const MILESTONES=[
    {id:'depth100',  desc:'Głębinowiec: zejdź poniżej poziomu 100', check:(c)=>c.player.y>=100, xp:120},
    {id:'walk400',   desc:'Podróżnik: oddal się o 400 kratek od startu', check:(c)=>Math.abs(c.player.x)>=400, xp:120},
    {id:'boss1',     desc:'Pogromca: pokonaj pierwszego bossa', check:(c)=>c.bossKilled>=1, xp:200, chest:true},
    {id:'boss5',     desc:'Łowca tytanów: pokonaj 5 bossów', check:(c)=>c.bossKilled>=5, xp:500, chest:true},
    {id:'berry5',    desc:'Ogrodnik: zbierz 5 razy jagody', check:(c)=>c.berries>=5, xp:150},
    {id:'obsidian10',desc:'Obsydianowy magnat: zdobądź 10 obsydianu', check:(c)=>((c.inv&&c.inv.obsidian)||0)>=10, xp:200},
    {id:'season_spring_trophy', desc:'Tropiciel wiosny: zdobadz poroze wiosny', check:(c)=>hasSeasonalTrophy(c,'springAntler'), xp:180},
    {id:'season_summer_trophy', desc:'Tropiciel lata: zdobadz rog lata', check:(c)=>hasSeasonalTrophy(c,'summerHorn'), xp:180},
    {id:'season_autumn_trophy', desc:'Tropiciel jesieni: zdobadz jesienna twardziel', check:(c)=>hasSeasonalTrophy(c,'autumnHeartwood'), xp:180},
    {id:'season_winter_trophy', desc:'Tropiciel zimy: zdobadz zimowe futro', check:(c)=>hasSeasonalTrophy(c,'winterFur'), xp:180},
    {id:'season_full_year', desc:'Kronikarz roku: zamknij cykl czterech sezonow', check:()=>(
      (state.done.season_spring_trophy || state.trophies.springAntler) &&
      (state.done.season_summer_trophy || state.trophies.summerHorn) &&
      (state.done.season_autumn_trophy || state.trophies.autumnHeartwood) &&
      (state.done.season_winter_trophy || state.trophies.winterFur)
    ), xp:700, chest:true},
  ];
  if(typeof window!=='undefined' && window.addEventListener){
    window.addEventListener('mm-berry-harvest',()=>{ berries=toInt(berries+1,0); save(); });
  }
  function rewardChest(p){
    try{
      const W=MM.world, T=MM.T; if(!W||!T) return;
      const bx=Math.round(p.x)+2;
      for(let ty=Math.max(2,Math.round(p.y)-3); ty<Math.round(p.y)+6; ty++){
        const t=W.getTile(bx,ty);
        const below=W.getTile(bx,ty+1);
        if(t===T.AIR && below!==T.AIR && below!==T.WATER){ W.setTile(bx,ty,T.CHEST_EPIC); return; }
      }
    }catch(e){}
  }

  let tickAcc=0;
  function update(dt){
    tickBuffs(dt); // buffs need real dt (sub-second expiry accuracy)
    tickAcc+=dt; if(tickAcc<0.5) return; tickAcc=0;
    const p=playerRef(); if(!p) return;
    // level-ups
    const L=levelFor(p.xp||0).level;
    if(L>state.lastLevel){
      state.lastLevel=L; save();
      say('⬆ Poziom '+L+'! Punkt umiejętności do wydania (E → Rozwój)');
      try{ if(MM.audio && MM.audio.play) MM.audio.play('levelup'); }catch(e){}
      notify();
    }
    // milestones
    const ctx={ player:p, inv:(typeof window!=='undefined'&&window.inv)||{}, berries,
                bossKilled:state.bossKills };
    markSeasonalTrophies(ctx.inv);
    for(const m of MILESTONES){
      if(state.done[m.id]) continue;
      let ok=false; try{ ok=m.check(ctx); }catch(e){}
      if(!ok) continue;
      state.done[m.id]=1; save();
      if(m.xp){ p.xp=(p.xp||0)+m.xp; }
      if(m.chest) rewardChest(p);
      say('🏆 '+m.desc+' — +'+(m.xp||0)+' XP'+(m.chest?' i epicka skrzynia!':''));
      try{ if(MM.audio && MM.audio.play) MM.audio.play('milestone'); }catch(e){}
      notify();
    }
  }

  function reset(){ state.vit=state.str=state.agi=state.cap=0; state.lastLevel=1; state.bossKills=0; state.done={}; state.trophies={}; berries=0; save(); try{ if(MM.recomputeModifiers) MM.recomputeModifiers(); }catch(e){} notify(); }

  MM.progress={ update, level, points, spend, bonuses, reset, addBuff, snapshot, restore,
    getBuffs:()=>buffs.map(b=>({name:b.name,icon:b.icon,t:b.t})),
    stats:()=>({vit:state.vit,str:state.str,agi:state.agi,cap:state.cap}),
    milestones:()=>MILESTONES.map(m=>({id:m.id,desc:m.desc,done:!!state.done[m.id]})) };
  // Register as a stat provider: skill-point bonuses merge through the same
  // STAT_RULES engine as gear. Registration recomputes modifiers, which also
  // fixes the boot-order gap (inventory.js computed before this module loaded).
  try{
    if(MM.inventory && MM.inventory.registerModifierSource){
      MM.inventory.registerModifierSource('progress', ()=>{
        const b=bonuses();
        return { attackDamage:b.attackDamage, moveSpeedMult:b.moveSpeedMult, jumpPowerMult:b.jumpPowerMult, energyCapacityBonus:b.energyCapacityBonus };
      });
      MM.inventory.registerModifierSource('buffs', buffBundle);
    } else if(MM.recomputeModifiers) MM.recomputeModifiers();
  }catch(e){}
  notify();
})();
// ESM export (progressive migration)
export const progress = (typeof window!=='undefined' && window.MM) ? window.MM.progress : undefined;
export default progress;
