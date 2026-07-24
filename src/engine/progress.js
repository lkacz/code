// Progression spine: XP → levels → skill points spent on trainable stats
// (Witalność/Siła/Zwinność/Pojemność/Twardość), plus persistent milestones with rewards. Bonuses
// flow into the existing modifier engine (inventory.js merges MM.progress.bonuses()
// into MM.activeModifiers); max-HP changes are applied by main.js listening to
// the mm-progress-change event. State persists in mm_progress_v1.
window.MM = window.MM || {};
(function(){
  const SAVE_KEY='mm_progress_v1';
  const PROGRESS_COUNTER_CAP=1000000;
  const PROGRESS_RAW_CAP=65536;
  const MAX_TRAINED_POINTS=98;
  const TRAINABLE_STATS=new Set(['vit','str','agi','cap','hard']);
  const TOUGHNESS_DAMAGE_REDUCTION_PER_POINT=0.03;
  const TOUGHNESS_DAMAGE_REDUCTION_MAX=0.45;
  const state={ vit:0, str:0, agi:0, cap:0, hard:0, lastLevel:1, bossKills:0, done:{}, trophies:{}, guardians:{} };
  let berries=0;
  const SEASON_TROPHY_KEYS=['springAntler','summerHorn','autumnHeartwood','winterFur'];
  const GUARDIAN_KEYS=['fire','ice','earth','air','mother'];

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
      // Read the schema, not the attacker-controlled key order: legitimate
      // milestones cannot be displaced by thousands of junk properties.
      for(const k of KNOWN_MILESTONE_IDS){
        try{ if(Object.prototype.hasOwnProperty.call(src,k) && src[k]) out[k]=1; }catch(e){}
      }
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
  function cleanGuardians(src){
    const out={};
    if(src && typeof src==='object'){
      for(const k of GUARDIAN_KEYS) if(src[k]) out[k]=1;
    }
    return out;
  }
  function snapshot(){
    return {
      v:2,
      vit:toInt(state.vit,0,MAX_TRAINED_POINTS),
      str:toInt(state.str,0,MAX_TRAINED_POINTS),
      agi:toInt(state.agi,0,MAX_TRAINED_POINTS),
      cap:toInt(state.cap,0,MAX_TRAINED_POINTS),
      hard:toInt(state.hard,0,MAX_TRAINED_POINTS),
      lastLevel:toInt(state.lastLevel,1,99),
      bossKills:toInt(state.bossKills,0,PROGRESS_COUNTER_CAP),
      done:cleanDone(state.done),
      trophies:cleanTrophies(state.trophies),
      guardians:cleanGuardians(state.guardians),
      berries:toInt(berries,0,PROGRESS_COUNTER_CAP),
    };
  }
  function applySnapshot(d){
    if(!d || typeof d!=='object' || Array.isArray(d)) return false;
    // Level 99 can award at most 98 points. Repair edited saves in a stable
    // order so persistent modifiers can never exceed the legal total.
    let remaining=MAX_TRAINED_POINTS;
    for(const key of TRAINABLE_STATS){
      state[key]=Math.min(remaining,toInt(d[key],0,MAX_TRAINED_POINTS));
      remaining-=state[key];
    }
    state.lastLevel=toInt(d.lastLevel,1,99);
    state.bossKills=toInt(d.bossKills,0,PROGRESS_COUNTER_CAP);
    state.done=cleanDone(d.done);
    state.trophies=cleanTrophies(d.trophies);
    state.guardians=cleanGuardians(d.guardians);
    berries=toInt(d.berries,0,PROGRESS_COUNTER_CAP);
    return true;
  }
  function save(){ try{ localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot())); }catch(e){} }
  function restore(data){
    if(!data || typeof data!=='object' || Array.isArray(data)) return false;
    clearTransient();
    if(!applySnapshot(data)) return false;
    save();
    try{ if(MM.recomputeModifiers) MM.recomputeModifiers(); }catch(e){}
    notify();
    return true;
  }
  function load(){
    try{
      const raw=localStorage.getItem(SAVE_KEY); if(!raw) return;
      if(typeof raw!=='string' || raw.length>PROGRESS_RAW_CAP) return;
      applySnapshot(JSON.parse(raw));
    }catch(e){}
  }
  // Boss kills must survive reloads (bosses.js's session counter resets with the
  // module), otherwise the ×5 milestone is unreachable across sessions.
  if(typeof window!=='undefined' && window.addEventListener){
    window.addEventListener('mm-boss-killed',()=>{ state.bossKills=Math.min(PROGRESS_COUNTER_CAP,state.bossKills+1); save(); });
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
  // Bestiary: the first time a guardian falls (its heart is claimed) it earns a
  // one-shot journal card via the discovery module (player-local knowledge).
  const GUARDIAN_DISCOVERY={
    fire:['slain_guardian_fire','Bestiariusz: ukojony Strażnik Ognia'],
    ice:['slain_guardian_ice','Bestiariusz: rozmrożony Strażnik Lodu'],
    earth:['slain_guardian_earth','Bestiariusz: uśpiony Trzeci Kret'],
    air:['slain_guardian_air','Bestiariusz: ściągnięty Strażnik Nieba'],
    mother:['slain_guardian_mother','Bestiariusz: cisza w środku świata'],
  };
  function noteGuardianSlain(kind){
    try{
      const d=GUARDIAN_DISCOVERY[kind];
      const D=(typeof window!=='undefined') && window.MM && window.MM.discovery;
      if(d && D && D.note) D.note(d[0], d[1]);
    }catch(e){}
  }
  function markGuardianHearts(inv){
    if(!inv || typeof inv!=='object') return false;
    let changed=false;
    if(!state.guardians.fire && (Number(inv.heartFire)||0)>0){ state.guardians.fire=1; changed=true; noteGuardianSlain('fire'); }
    if(!state.guardians.ice && (Number(inv.heartIce)||0)>0){ state.guardians.ice=1; changed=true; noteGuardianSlain('ice'); }
    if(!state.guardians.earth && (Number(inv.heartEarth)||0)>0){ state.guardians.earth=1; changed=true; noteGuardianSlain('earth'); }
    if(!state.guardians.air && (Number(inv.heartAir)||0)>0){ state.guardians.air=1; changed=true; noteGuardianSlain('air'); }
    if(!state.guardians.mother && (Number(inv.heartMother)||0)>0){ state.guardians.mother=1; changed=true; noteGuardianSlain('mother'); }
    if(changed) save();
    return changed;
  }
  function markGuardianHeart(kind){
    if(GUARDIAN_KEYS.indexOf(kind)<0) return false;
    if(state.guardians[kind]) return false;
    state.guardians[kind]=1;
    noteGuardianSlain(kind);
    save();
    notify();
    return true;
  }
  function hasGuardianHeart(kind){ return !!state.guardians[kind]; }
  function guardianHearts(){ return cleanGuardians(state.guardians); }
  function hasSeasonalTrophy(ctx,key){
    return !!(state.trophies[key] || (ctx && ctx.inv && (Number(ctx.inv[key])||0)>0));
  }
  if(typeof window!=='undefined' && window.addEventListener){
    window.addEventListener('mm-resources-change',()=>{ const inv=(typeof window!=='undefined'&&window.inv)||null; markSeasonalTrophies(inv); markGuardianHearts(inv); });
  }

  // --- Levels: cumulative XP thresholds, gently super-linear ---
  function needFor(level){ return Math.round(60*Math.pow(level,1.35)); } // XP from L → L+1
  function levelFor(xp){
    let lvl=1, acc=0;
    while(lvl<99){ const n=needFor(lvl); if(xp<acc+n) break; acc+=n; lvl++; }
    return {level:lvl, into:xp-acc, need:needFor(lvl)};
  }
  function level(){ const p=playerRef(); return levelFor((p&&p.xp)||0); }
  function points(){ const L=level().level; return Math.max(0,(L-1)-(state.vit+state.str+state.agi+state.cap+state.hard)); }
  function spend(stat){
    if(points()<=0 || !TRAINABLE_STATS.has(stat)) return false;
    state[stat]++; save();
    try{ if(MM.recomputeModifiers) MM.recomputeModifiers(); }catch(e){}
    notify();
    return true;
  }
  function toughnessDamageReduction(points){
    const trained=toInt(points,0,999);
    return Math.min(TOUGHNESS_DAMAGE_REDUCTION_MAX, trained*TOUGHNESS_DAMAGE_REDUCTION_PER_POINT);
  }
  // Merged by inventory.computeModifiers into MM.activeModifiers
  function bonuses(){
    return {
      attackDamage: state.str,                 // +1 dmg per point of Siła
      moveSpeedMult: 1+state.agi*0.02,         // +2% move per Zwinność
      jumpPowerMult: 1+state.agi*0.02,         // +2% jump per Zwinność
      maxHpBonus: state.vit*10,                // +10 HP per Witalność (applied in main)
      energyCapacityBonus: state.cap*25,       // +25 energy capacity per Pojemność
      crushResistBonus: state.hard*1.5,        // +1.5 crush-load capacity per Twardość (cave-ins and deep-water pressure)
      damageReductionBonus: toughnessDamageReduction(state.hard), // -3% blockable damage per Twardość, capped at 45%
    };
  }

  // --- Timed buffs (potions, future shrine boons): each carries a stat bundle
  // merged through the registered modifier source below; expiry prunes and
  // recomputes. Session-scoped by design (a reload sobers the hero up).
  const buffs=[]; // {name,icon,t,stats}
  const MUL_KEYS=new Set(['moveSpeedMult','jumpPowerMult','mineSpeedMult']);
  const MAX_KEYS=new Set(['waterMoveSpeedMult']);
  const BUFF_STACK_CAP=3;
  const BUFF_TOTAL_CAP=48;
  const BUFF_DURATION_CAP=3600;
  const BUFF_STAT_LIMITS={
    maxAirJumps:[0,10],
    visionRadius:[0,100],
    mineSpeedMult:[0.05,10],
    moveSpeedMult:[0.05,10],
    jumpPowerMult:[0.05,10],
    waterMoveSpeedMult:[0,1.25],
    attackDamage:[-1000,1000],
    energyCapacityBonus:[-10000,10000],
    crushResistBonus:[-500,500],
    damageReductionBonus:[-0.45,0.45]
  };
  const BUFF_BUNDLE_LIMITS=Object.assign({},BUFF_STAT_LIMITS,{
    mineSpeedMult:[0.01,30], moveSpeedMult:[0.01,30], jumpPowerMult:[0.01,30]
  });
  function clampBuffValue(key,value,limits){
    if(!Object.prototype.hasOwnProperty.call(limits,key)) return null;
    const range=limits[key];
    if(!range || !Number.isFinite(value)) return null;
    return Math.max(range[0],Math.min(range[1],value));
  }
  function buffStackKey(b){
    const raw=b && (b.stackKey || b.id || b.name);
    return String(raw||'buff').trim().toLowerCase().slice(0,64) || 'buff';
  }
  function cleanBuffStats(src){
    const out={};
    if(!src || typeof src!=='object') return out;
    let processed=0;
    for(const rawKey in src){
      if(!Object.prototype.hasOwnProperty.call(src,rawKey)) continue;
      if(processed++>=32) break;
      const k=String(rawKey).slice(0,64);
      const v=Number(src[rawKey]);
      const clean=clampBuffValue(k,v,BUFF_STAT_LIMITS);
      if(!k || clean==null) continue;
      out[k]=clean;
    }
    return out;
  }
  function addBuff(b){
    if(!b || !b.stats) return false;
    const stats=cleanBuffStats(b.stats);
    if(!Object.keys(stats).length) return false;
    const name=String(b.name||'Buff').slice(0,64);
    const icon=String(b.icon||'✦').slice(0,8);
    const stackKey=buffStackKey(b);
    const duration=Math.max(1,Math.min(BUFF_DURATION_CAP,Number(b.dur)||30));
    const same=buffs.filter(active=>active && active.stackKey===stackKey);
    let capped=false;
    if(same.length>=BUFF_STACK_CAP){
      // At the cap another drink refreshes the layer that would expire first;
      // it never adds a fourth multiplier/additive bonus.
      same.sort((a,c)=>(a.t-c.t));
      const target=same[0];
      target.name=name;
      target.icon=icon;
      target.t=Math.max(target.t,duration);
      target.stats=stats;
      capped=true;
    }else{
      if(buffs.length>=BUFF_TOTAL_CAP){
        let shortest=0;
        for(let i=1;i<buffs.length;i++) if((buffs[i].t||0)<(buffs[shortest].t||0)) shortest=i;
        buffs.splice(shortest,1);
      }
      buffs.push({name,icon,t:duration,stats,stackKey});
    }
    try{ if(MM.recomputeModifiers) MM.recomputeModifiers(); }catch(e){}
    notify();
    const stacks=buffs.reduce((n,active)=>n+(active && active.stackKey===stackKey?1:0),0);
    return {ok:true,capped,stacks,cap:BUFF_STACK_CAP,stackKey};
  }
  function buffBundle(){
    if(!buffs.length) return null;
    const out={};
    for(const b of buffs){
      for(const k in b.stats){
        const v=b.stats[k]; if(typeof v!=='number' || !isFinite(v)) continue;
        let next;
        if(MUL_KEYS.has(k)) next=(out[k]==null?1:out[k])*v;
        else if(MAX_KEYS.has(k)) next=Math.max(out[k]||0,v);
        else next=(out[k]||0)+v;
        const clean=clampBuffValue(k,next,BUFF_BUNDLE_LIMITS);
        if(clean!=null) out[k]=clean;
      }
    }
    return out;
  }
  function tickBuffs(dt){
    if(!buffs.length) return;
    dt=Number(dt);
    if(!(dt>0) || !Number.isFinite(dt)) return;
    dt=Math.min(BUFF_DURATION_CAP,dt);
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
    {id:'depth200',  desc:'Otchłaniowiec: zejdź poniżej poziomu 180', check:(c)=>c.player.y>=180, xp:250, chest:true},
    {id:'gold50',    desc:'Krezus: nazbieraj 50 złota', check:(c)=>((c.inv&&c.inv.gold)||0)>=50, xp:250},
    {id:'discover30',desc:'Odkrywca: odkryj 30 tajemnic świata', check:()=>{ try{ const D=(typeof window!=='undefined')&&window.MM&&window.MM.discovery; return !!(D && D.count && D.count()>=30); }catch(e){ return false; } }, xp:200},
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
    // The story arc pays out visibly at each node — the hearts double as
    // milestone feedback so a fallen guardian always "counts" on the HUD.
    {id:'guardian_ice',   desc:'Odwilz: zgas chlod zachodniego odtracenia', check:()=>!!state.guardians.ice, xp:300},
    {id:'guardian_fire',  desc:'Wysluchanie: ukoj wschodni zar', check:()=>!!state.guardians.fire, xp:300},
    {id:'guardian_earth', desc:'Odkopanie: obudz i uspij Trzeciego Kreta', check:()=>!!state.guardians.earth, xp:400},
    {id:'guardian_air',   desc:'Zejscie na ziemie: sciagnij ambicje z nieba', check:()=>!!state.guardians.air, xp:500},
    {id:'story_complete', desc:'Cisza: spotkaj siebie w srodku swiata', check:()=>!!state.guardians.mother, xp:1500, chest:true},
  ];
  const KNOWN_MILESTONE_IDS=new Set(MILESTONES.map(m=>m.id));
  load();
  if(typeof window!=='undefined' && window.addEventListener){
    window.addEventListener('mm-berry-harvest',()=>{ berries=toInt(berries+1,0,PROGRESS_COUNTER_CAP); save(); });
  }
  function rewardChest(p){
    try{
      if(MM.drops && MM.drops.spawnChest) MM.drops.spawnChest(p.x+0.6,p.y-0.35,'epic',{source:'progress',vx:1.8,vy:-3.2});
    }catch(e){}
  }
  function publicBuffs(){
    const grouped=new Map();
    for(const b of buffs){
      if(!b) continue;
      const k=b.stackKey||buffStackKey(b);
      let row=grouped.get(k);
      if(!row){
        row={name:b.name||'Buff',icon:b.icon||'✦',t:Math.max(0,b.t||0),stacks:0,cap:BUFF_STACK_CAP};
        grouped.set(k,row);
      }
      row.stacks++;
      // The ring counts down to the next layer falling off, not the last one.
      row.t=Math.min(row.t,Math.max(0,b.t||0));
    }
    return [...grouped.values()].map(row=>({
      name:row.name+(row.stacks>1?' ×'+row.stacks:''),
      icon:row.icon,
      t:row.t,
      stacks:row.stacks,
      cap:row.cap
    }));
  }

  let tickAcc=0;
  function clearTransient(){
    buffs.length=0;
    tickAcc=0;
    try{ if(MM.recomputeModifiers) MM.recomputeModifiers(); }catch(e){}
    return true;
  }
  function update(dt){
    dt=Number(dt);
    if(!(dt>0) || !Number.isFinite(dt)) return;
    dt=Math.min(BUFF_DURATION_CAP,dt);
    tickBuffs(dt); // buffs need real dt (sub-second expiry accuracy)
    tickAcc+=dt; if(tickAcc<0.5) return; tickAcc=0;
    const p=playerRef(); if(!p) return;
    // level-ups
    const L=levelFor(p.xp||0).level;
    if(L>state.lastLevel){
      const gained=Math.max(1,L-state.lastLevel);
      state.lastLevel=L; save();
      say('⬆ Poziom '+L+'! Punkt umiejętności do wydania (E → Rozwój)');
      try{ if(MM.audio && MM.audio.play) MM.audio.play('levelup'); }catch(e){}
      try{ window.dispatchEvent(new CustomEvent('mm-skill-point-gained',{detail:{level:L,points:points(),gained}})); }catch(e){}
      notify();
    }
    // milestones
    const ctx={ player:p, inv:(typeof window!=='undefined'&&window.inv)||{}, berries,
                bossKilled:state.bossKills };
    markSeasonalTrophies(ctx.inv);
    markGuardianHearts(ctx.inv);
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

  function reset(){ state.vit=state.str=state.agi=state.cap=state.hard=0; state.lastLevel=1; state.bossKills=0; state.done={}; state.trophies={}; state.guardians={}; berries=0; clearTransient(); save(); notify(); }

  MM.progress={ update, level, points, spend, bonuses, toughnessDamageReduction, reset, clearTransient, addBuff, snapshot, restore,
    TOUGHNESS_DAMAGE_REDUCTION_PER_POINT, TOUGHNESS_DAMAGE_REDUCTION_MAX,
    BUFF_STACK_CAP, BUFF_TOTAL_CAP,
    markGuardianHeart, hasGuardianHeart, guardianHearts,
    getBuffs:publicBuffs,
    stats:()=>({vit:state.vit,str:state.str,agi:state.agi,cap:state.cap,hard:state.hard}),
    milestones:()=>MILESTONES.map(m=>({id:m.id,desc:m.desc,done:!!state.done[m.id]})) };
  // Register as a stat provider: skill-point bonuses merge through the same
  // STAT_RULES engine as gear. Registration recomputes modifiers, which also
  // fixes the boot-order gap (inventory.js computed before this module loaded).
  try{
    if(MM.inventory && MM.inventory.registerModifierSource){
      MM.inventory.registerModifierSource('progress', ()=>{
        const b=bonuses();
        return { attackDamage:b.attackDamage, moveSpeedMult:b.moveSpeedMult, jumpPowerMult:b.jumpPowerMult, energyCapacityBonus:b.energyCapacityBonus, crushResistBonus:b.crushResistBonus, damageReductionBonus:b.damageReductionBonus };
      });
      MM.inventory.registerModifierSource('buffs', buffBundle);
    } else if(MM.recomputeModifiers) MM.recomputeModifiers();
  }catch(e){}
  notify();
})();
// ESM export (progressive migration)
export const progress = (typeof window!=='undefined' && window.MM) ? window.MM.progress : undefined;
export default progress;
