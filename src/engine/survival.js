// Player survival timers that should stay deterministic and easy to test.
window.MM = window.MM || {};
(function(){
  const DROWN_GRACE = 20;
  const DROWN_RATE_BASE = 2;
  const DROWN_RATE_RAMP = 0.18;
  const DROWN_RATE_MAX = 18;
  const DROWN_DAMAGE_BANK_MAX = 30;
  const UNDERWATER_ENERGY_DAMAGE_PER_ENERGY = 0.45;
  const UNDERWATER_ENERGY_DAMAGE_MAX = 10;
  const UNDERWATER_ENERGY_DAMAGE_BANK_MAX = 24;

  function createDrowningState(){
    return {airless:0, damageAcc:0, warned:false};
  }

  function resetDrowning(state){
    if(!state) return;
    state.airless=0;
    state.damageAcc=0;
    state.warned=false;
  }

  function updateDrowning(state, dt, covered){
    if(!state) state=createDrowningState();
    if(!(dt>0)) return {state, damage:Math.floor(state.damageAcc), rate:0, warn:false, recovered:false};
    if(!covered){
      const recovered = state.airless > DROWN_GRACE;
      resetDrowning(state);
      return {state, damage:0, rate:0, warn:false, recovered};
    }
    state.airless += dt;
    if(state.airless < DROWN_GRACE){
      return {state, damage:0, rate:0, warn:false, recovered:false, graceLeft:DROWN_GRACE-state.airless};
    }
    const over = state.airless - DROWN_GRACE;
    const rate = Math.min(DROWN_RATE_MAX, DROWN_RATE_BASE + over*DROWN_RATE_RAMP);
    state.damageAcc = Math.min(DROWN_DAMAGE_BANK_MAX, state.damageAcc + rate*dt);
    const warn = !state.warned;
    state.warned = true;
    return {state, damage:Math.floor(state.damageAcc), rate, warn, recovered:false, graceLeft:0};
  }

  function consumeDrowningDamage(state, amount){
    if(!state || !(amount>0)) return;
    state.damageAcc = Math.max(0, state.damageAcc - amount);
  }

  function createUnderwaterEnergyState(){
    return {damageAcc:0};
  }

  function resetUnderwaterEnergyShock(state){
    if(!state) return;
    state.damageAcc=0;
  }

  function updateUnderwaterEnergyShock(state, energySpent, submerged){
    if(!state) state=createUnderwaterEnergyState();
    const spent=Math.max(0,Number(energySpent)||0);
    if(!submerged || spent<=0){
      if(!submerged) resetUnderwaterEnergyShock(state);
      return {state, damage:0};
    }
    state.damageAcc=Math.min(UNDERWATER_ENERGY_DAMAGE_BANK_MAX, state.damageAcc + spent*UNDERWATER_ENERGY_DAMAGE_PER_ENERGY);
    const damage=state.damageAcc>0 ? Math.max(1, Math.min(UNDERWATER_ENERGY_DAMAGE_MAX, Math.floor(state.damageAcc))) : 0;
    return {state, damage};
  }

  function consumeUnderwaterEnergyDamage(state, amount){
    if(!state || !(amount>0)) return;
    state.damageAcc=Math.max(0, state.damageAcc - amount);
  }

  MM.survival = {
    DROWN_GRACE,
    UNDERWATER_ENERGY_DAMAGE_PER_ENERGY,
    UNDERWATER_ENERGY_DAMAGE_MAX,
    createDrowningState,
    resetDrowning,
    updateDrowning,
    consumeDrowningDamage,
    createUnderwaterEnergyState,
    resetUnderwaterEnergyShock,
    updateUnderwaterEnergyShock,
    consumeUnderwaterEnergyDamage
  };
})();

export const survival = (typeof window!=='undefined' && window.MM) ? window.MM.survival : undefined;
export default survival;
