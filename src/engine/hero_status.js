// Hero elemental statuses — the player-side mirror of the mob status matrix
// (mobs.js STATUS/statusReaction). One small deterministic state machine owns
// every "the hero is soaked / burning / chilled" flag that used to live as
// scattered timers in main.js; the vitals HUD renders the active set as debuff
// chips next to the HP/EN bars.
//
// The matrix works AGAINST the player too:
//   wet      — after water / rain / splashes; electric hits deal x1.5 while wet
//              (main.js damageHero consults damageInMult) and fire fizzles out
//              on a soaked hero (a burn application is refused, drying him a bit)
//   burn     — fire-elemental hits ignite; ticks damage until doused/expired
//   chill    — snowball hits (yeti, splats); movement x0.55 (the old
//              heroChillUntil contract, now routed through this module)
//   frozen   — chill + wet in genuinely deep frost flash-freezes the hero solid
//              for 1.5 s (no walking, no jumping); a refreeze lock keeps the
//              combo from stun-locking him outdoors
// A campfire/torch nearby dries: wet and chill drain 4x faster (nearWarmth).
//
// main.js drives update(dt, env) from the physics step and applies the returned
// burn damage through window.damageHero — the module itself never touches the
// world or the player, so node sims exercise it headlessly.
window.MM = window.MM || {};
(function(){
  const TUNING = {
    WET_DUR: 8,           // soak refresh (swimming/rain re-apply continuously)
    CHILL_DUR: 3.5,       // snowball chill
    BURN_DUR: 3,
    BURN_DPS: 2,
    BURN_TICK: 0.5,
    FROZEN_DUR: 1.5,      // hard-CC freeze from wet+chill in deep frost
    REFREEZE_LOCK: 8,     // seconds before the combo can freeze again
    DRY_MULT: 4,          // wet/chill decay speed near warmth (campfire/torch)
    FIZZLE_DRY: 2,        // seconds of wetness a fizzled ignition boils away
    WET_ELECTRIC_MULT: 1.5,
    CHILL_MOVE_MULT: 0.55,
  };

  const st = { wet:0, chill:0, burn:0, burnDps:0, burnAcc:0, frozen:0, refreezeLock:0 };

  function clampDur(v,fallback){
    const n=Number(v);
    return (Number.isFinite(n) && n>0) ? Math.min(60,n) : fallback;
  }
  function note(id,text){
    try{ if(MM.discovery && MM.discovery.note) MM.discovery.note(id,text); }catch(e){}
  }
  function fx(kind){
    try{
      const p=(typeof window!=='undefined' && window.player);
      if(!p || !MM.particles || !MM.particles.spawnImpactChips) return;
      const tile=MM.TILE||20;
      MM.particles.spawnImpactChips(p.x*tile,(p.y-0.3)*tile,{power:1,element:kind});
    }catch(e){}
  }

  // --- pure core --------------------------------------------------------------------
  // The SAME laws run for the hero singleton below and for every embodied co-op
  // body (ghost_host keeps one state per body): transitions mutate the passed
  // state and REPORT what happened; the hero wrapper adds fx/discovery on top.
  function createState(){
    return { wet:0, chill:0, burn:0, burnDps:0, burnAcc:0, frozen:0, refreezeLock:0 };
  }
  // Returns the applied status id, 'wet_doused' (a soak that put a burn out),
  // 'fizzled' (burn refused by a soaked target), or false.
  function applyTo(s,kind,opts){
    opts=opts||{};
    if(kind==='wet'){
      const doused = s.burn>0;
      if(doused){ s.burn=0; s.burnDps=0; }
      s.wet=Math.max(s.wet, clampDur(opts.dur,TUNING.WET_DUR));
      return doused ? 'wet_doused' : 'wet';
    }
    if(kind==='chill'){
      s.chill=Math.max(s.chill, clampDur(opts.dur,TUNING.CHILL_DUR));
      return 'chill';
    }
    if(kind==='burn'){
      if(s.wet>0){
        // fire fizzles on a soaked target — the flash boils some of the soak off
        s.wet=Math.max(0, s.wet-TUNING.FIZZLE_DRY);
        return 'fizzled';
      }
      s.burn=Math.max(s.burn, clampDur(opts.dur,TUNING.BURN_DUR));
      s.burnDps=Math.max(s.burnDps, (Number.isFinite(opts.dps) && opts.dps>0) ? opts.dps : TUNING.BURN_DPS);
      return 'burn';
    }
    return false;
  }
  // env: {deepFrost, nearWarmth, inWater}
  // Returns {burnDamage, frozeNow, doused} — the caller routes burnDamage through
  // its central damage inlet (a cause that must NOT re-apply burn).
  function updateState(s,dt,env){
    env=env||{};
    if(!(dt>0) || !Number.isFinite(dt)) return {burnDamage:0, frozeNow:false, doused:false};
    dt=Math.min(0.25,dt);
    let frozeNow=false, doused=false;
    if(s.refreezeLock>0) s.refreezeLock=Math.max(0, s.refreezeLock-dt);
    // deep-frost flash freeze: both combo fuels present, outdoors in true cold
    if(s.frozen<=0 && s.wet>0 && s.chill>0 && env.deepFrost && s.refreezeLock<=0){
      s.frozen=TUNING.FROZEN_DUR;
      s.refreezeLock=TUNING.REFREEZE_LOCK;
      s.wet=0; s.chill=0;
      frozeNow=true;
    }
    const drySpeed=env.nearWarmth ? TUNING.DRY_MULT : 1;
    if(s.wet>0 && !env.inWater) s.wet=Math.max(0, s.wet-dt*drySpeed);
    if(s.chill>0) s.chill=Math.max(0, s.chill-dt*drySpeed);
    if(s.frozen>0) s.frozen=Math.max(0, s.frozen-dt);
    let burnDamage=0;
    if(s.burn>0){
      if(env.inWater){ s.burn=0; s.burnDps=0; s.burnAcc=0; doused=true; }
      else{
        s.burn=Math.max(0, s.burn-dt);
        s.burnAcc+=dt;
        while(s.burnAcc>=TUNING.BURN_TICK){
          s.burnAcc-=TUNING.BURN_TICK;
          burnDamage+=s.burnDps*TUNING.BURN_TICK;
        }
        if(s.burn<=0){ s.burnDps=0; s.burnAcc=0; }
      }
    } else s.burnAcc=0;
    return {burnDamage:Math.round(burnDamage), frozeNow, doused};
  }
  function isFrozenState(s){ return !!(s && s.frozen>0); }
  function moveMultOf(s){
    if(!s) return 1;
    if(s.frozen>0) return 0;
    return s.chill>0 ? TUNING.CHILL_MOVE_MULT : 1;
  }
  // Incoming-damage multiplier for the elemental matrix: a soaked target conducts.
  function damageInMultOf(s,element){
    if(s && String(element||'')==='electric' && s.wet>0) return TUNING.WET_ELECTRIC_MULT;
    return 1;
  }

  // --- the hero singleton: pure core + hero-only fx and discovery notes -------------
  function apply(kind,opts){
    const r=applyTo(st,kind,opts);
    if(r==='wet_doused'){ fx('steam'); return 'wet'; }
    if(r==='fizzled'){
      fx('steam');
      note('hero_fizzle','Ogień gaśnie na przemoczonym bohaterze!');
    }
    return r;
  }
  // env: {deepFrost, nearWarmth, inWater, godMode}
  // Returns {burnDamage, frozeNow} — the caller routes burnDamage through the
  // central damageHero (cause 'hero_burn', which must NOT re-apply burn).
  function update(dt,env){
    env=env||{};
    if(!(dt>0) || !Number.isFinite(dt)) return {burnDamage:0, frozeNow:false};
    if(env.godMode){ clearAll(); return {burnDamage:0, frozeNow:false}; }
    const r=updateState(st,dt,env);
    if(r.frozeNow){
      fx('chill_freeze');
      note('hero_frozen','Mokry i zziębnięty na mrozie — zamarzasz w bryłę lodu!');
    }
    if(r.doused) fx('steam');
    return {burnDamage:r.burnDamage, frozeNow:r.frozeNow};
  }

  function has(kind){ return (st[kind]||0)>0; }
  function isFrozen(){ return isFrozenState(st); }
  function moveMult(){ return moveMultOf(st); }
  function damageInMult(element){ return damageInMultOf(st,element); }
  // Debuff chips for the vitals HUD (same shape as progress buffs + debuff flag).
  function list(){
    const out=[];
    if(st.frozen>0) out.push({name:'Zamarznięty', icon:'🧊', t:st.frozen, debuff:true});
    if(st.burn>0)   out.push({name:'Podpalony',   icon:'🔥', t:st.burn,   debuff:true});
    if(st.wet>0)    out.push({name:'Mokry',       icon:'💧', t:st.wet,    debuff:true});
    if(st.chill>0)  out.push({name:'Zziębnięty',  icon:'❄️', t:st.chill,  debuff:true});
    return out;
  }
  function clearAll(){
    st.wet=0; st.chill=0; st.burn=0; st.burnDps=0; st.burnAcc=0; st.frozen=0; st.refreezeLock=0;
  }

  MM.heroStatus={apply, update, has, isFrozen, moveMult, damageInMult, list, clearAll, TUNING, _state:st,
    createState, applyTo, updateState, isFrozenState, moveMultOf, damageInMultOf};
})();

export const heroStatus = (typeof window!=='undefined' && window.MM) ? window.MM.heroStatus : globalThis.MM && globalThis.MM.heroStatus;
export default heroStatus;
