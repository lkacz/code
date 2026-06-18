// Player survival timers that should stay deterministic and easy to test.
window.MM = window.MM || {};
(function(){
  const DROWN_GRACE = 60;
  const DROWN_RATE_BASE = 2;
  const DROWN_RATE_RAMP = 0.18;
  const DROWN_RATE_MAX = 18;
  const DROWN_DAMAGE_BANK_MAX = 30;

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

  MM.survival = {
    DROWN_GRACE,
    createDrowningState,
    resetDrowning,
    updateDrowning,
    consumeDrowningDamage
  };
})();

export const survival = (typeof window!=='undefined' && window.MM) ? window.MM.survival : undefined;
export default survival;
