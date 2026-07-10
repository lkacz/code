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

  // Returns what actually happened: the applied status id, 'fizzled' (burn
  // refused by a soaked hero), or false (unknown kind / frozen mid-CC).
  function apply(kind,opts){
    opts=opts||{};
    if(kind==='wet'){
      if(st.burn>0){ st.burn=0; st.burnDps=0; fx('steam'); } // doused
      st.wet=Math.max(st.wet, clampDur(opts.dur,TUNING.WET_DUR));
      return 'wet';
    }
    if(kind==='chill'){
      st.chill=Math.max(st.chill, clampDur(opts.dur,TUNING.CHILL_DUR));
      return 'chill';
    }
    if(kind==='burn'){
      if(st.wet>0){
        // fire fizzles on a soaked hero — the flash boils some of the soak off
        st.wet=Math.max(0, st.wet-TUNING.FIZZLE_DRY);
        fx('steam');
        note('hero_fizzle','Ogień gaśnie na przemoczonym bohaterze!');
        return 'fizzled';
      }
      st.burn=Math.max(st.burn, clampDur(opts.dur,TUNING.BURN_DUR));
      st.burnDps=Math.max(st.burnDps, (Number.isFinite(opts.dps) && opts.dps>0) ? opts.dps : TUNING.BURN_DPS);
      return 'burn';
    }
    return false;
  }

  // env: {deepFrost, nearWarmth, inWater, godMode}
  // Returns {burnDamage, frozeNow} — the caller routes burnDamage through the
  // central damageHero (cause 'hero_burn', which must NOT re-apply burn).
  function update(dt,env){
    env=env||{};
    if(!(dt>0) || !Number.isFinite(dt)) return {burnDamage:0, frozeNow:false};
    dt=Math.min(0.25,dt);
    if(env.godMode){ clearAll(); return {burnDamage:0, frozeNow:false}; }
    let frozeNow=false;
    if(st.refreezeLock>0) st.refreezeLock=Math.max(0, st.refreezeLock-dt);
    // deep-frost flash freeze: both combo fuels present, outdoors in true cold
    if(st.frozen<=0 && st.wet>0 && st.chill>0 && env.deepFrost && st.refreezeLock<=0){
      st.frozen=TUNING.FROZEN_DUR;
      st.refreezeLock=TUNING.REFREEZE_LOCK;
      st.wet=0; st.chill=0;
      frozeNow=true;
      fx('chill_freeze');
      note('hero_frozen','Mokry i zziębnięty na mrozie — zamarzasz w bryłę lodu!');
    }
    const drySpeed=env.nearWarmth ? TUNING.DRY_MULT : 1;
    if(st.wet>0 && !env.inWater) st.wet=Math.max(0, st.wet-dt*drySpeed);
    if(st.chill>0) st.chill=Math.max(0, st.chill-dt*drySpeed);
    if(st.frozen>0) st.frozen=Math.max(0, st.frozen-dt);
    let burnDamage=0;
    if(st.burn>0){
      if(env.inWater){ st.burn=0; st.burnDps=0; st.burnAcc=0; fx('steam'); }
      else{
        st.burn=Math.max(0, st.burn-dt);
        st.burnAcc+=dt;
        while(st.burnAcc>=TUNING.BURN_TICK){
          st.burnAcc-=TUNING.BURN_TICK;
          burnDamage+=st.burnDps*TUNING.BURN_TICK;
        }
        if(st.burn<=0){ st.burnDps=0; st.burnAcc=0; }
      }
    } else st.burnAcc=0;
    return {burnDamage:Math.round(burnDamage), frozeNow};
  }

  function has(kind){ return (st[kind]||0)>0; }
  function isFrozen(){ return st.frozen>0; }
  function moveMult(){
    if(st.frozen>0) return 0;
    return st.chill>0 ? TUNING.CHILL_MOVE_MULT : 1;
  }
  // Incoming-damage multiplier for the elemental matrix: a soaked hero conducts.
  function damageInMult(element){
    if(String(element||'')==='electric' && st.wet>0) return TUNING.WET_ELECTRIC_MULT;
    return 1;
  }
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

  MM.heroStatus={apply, update, has, isFrozen, moveMult, damageInMult, list, clearAll, TUNING, _state:st};
})();

export const heroStatus = (typeof window!=='undefined' && window.MM) ? window.MM.heroStatus : globalThis.MM && globalThis.MM.heroStatus;
export default heroStatus;
