// Player survival timers that should stay deterministic and easy to test.
import { heroCrushCapacity, crushTickDamage } from './hero_crush.js';

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
  const WATER_PRESSURE_ROWS_PER_CRUSH_LOAD = 5;
  const WATER_PRESSURE_WARN_RATIO = 0.72;
  const WATER_PRESSURE_DAMAGE_RATE_MAX = 48;
  const WATER_PRESSURE_DAMAGE_BANK_MAX = 80;
  const WATER_PRESSURE_RECOVERY_RATE = 18;
  const WATER_PRESSURE_IMPLODE_EXCESS = 10;

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

  // Swim chill: open water saps health after a grace period, so short lake dips
  // stay safe while an ocean crossing without a boat is fatal. Exposure re-warms
  // gradually out of the water — hopping onto a raft pauses the drain, it does
  // not instantly erase a long cold swim.
  const SWIM_CHILL_GRACE = 12;
  const SWIM_CHILL_RATE_BASE = 1.4;
  const SWIM_CHILL_RATE_RAMP = 0.11;
  const SWIM_CHILL_RATE_MAX = 9;
  const SWIM_CHILL_RECOVERY = 2.6;
  const SWIM_CHILL_BANK_MAX = 22;

  function createSwimChillState(){
    return {exposure:0, damageAcc:0, warned:false};
  }

  function resetSwimChill(state){
    if(!state) return;
    state.exposure=0;
    state.damageAcc=0;
    state.warned=false;
  }

  function updateSwimChill(state, dt, swimming){
    if(!state) state=createSwimChillState();
    if(!(dt>0)) return {state, damage:Math.floor(state.damageAcc), rate:0, warn:false};
    if(!swimming){
      state.exposure=Math.max(0, state.exposure - SWIM_CHILL_RECOVERY*dt);
      if(state.exposure<SWIM_CHILL_GRACE*0.5){ state.warned=false; state.damageAcc=0; }
      return {state, damage:0, rate:0, warn:false, graceLeft:Math.max(0,SWIM_CHILL_GRACE-state.exposure)};
    }
    state.exposure += dt;
    if(state.exposure < SWIM_CHILL_GRACE){
      return {state, damage:0, rate:0, warn:false, graceLeft:SWIM_CHILL_GRACE-state.exposure};
    }
    const over = state.exposure - SWIM_CHILL_GRACE;
    const rate = Math.min(SWIM_CHILL_RATE_MAX, SWIM_CHILL_RATE_BASE + over*SWIM_CHILL_RATE_RAMP);
    state.damageAcc = Math.min(SWIM_CHILL_BANK_MAX, state.damageAcc + rate*dt);
    const warn = !state.warned;
    state.warned = true;
    return {state, damage:Math.floor(state.damageAcc), rate, warn, graceLeft:0};
  }

  function consumeSwimChillDamage(state, amount){
    if(!state || !(amount>0)) return;
    state.damageAcc = Math.max(0, state.damageAcc - amount);
  }

  // Thermal exposure: deep-cold air on the far west chills an unprotected hero,
  // scorching far-east air overheats him. Same grace/ramp/bank shape as swim
  // chill; the caller decides the mode from climate + mitigations so this state
  // machine stays deterministic and headless-testable.
  const THERMAL_GRACE = 22;
  const THERMAL_RATE_BASE = 1.2;
  const THERMAL_RATE_RAMP = 0.10;
  const THERMAL_RATE_MAX = 8;
  const THERMAL_RECOVERY = 3.4;
  const THERMAL_BANK_MAX = 20;
  const COLD_EXPOSURE_TEMP = 0.05;  // temperatureAt() at/below this chills...
  const COLD_CLIMATE_GATE = 0.25;   // ...but only in genuinely cold climate bands
  const HEAT_EXPOSURE_TEMP = 0.93;  // temperatureAt() at/above this scorches...
  const HEAT_CLIMATE_GATE = 0.75;   // ...only in genuinely hot climate bands

  // climate: WG.temperature(x) (0..1 band), temp: seasons.temperatureAt(x,y)
  // (unclamped, includes season/day-night/altitude). Shelter (roof/underground)
  // blocks both; warmth (torch/fire/lava nearby) blocks cold; water blocks heat
  // and hands the cold case over to swim chill so the drains never stack.
  function thermalExposureMode(env){
    env=env||{};
    const climate=Number(env.climate);
    const temp=Number(env.temp);
    if(!Number.isFinite(climate) || !Number.isFinite(temp)) return 'none';
    if(env.sheltered || env.inWater) return 'none';
    if(climate<=COLD_CLIMATE_GATE && temp<=COLD_EXPOSURE_TEMP && !env.nearWarmth) return 'cold';
    if(climate>=HEAT_CLIMATE_GATE && temp>=HEAT_EXPOSURE_TEMP) return 'heat';
    return 'none';
  }

  function createThermalState(){
    return {exposure:0, damageAcc:0, warned:false, mode:'none'};
  }

  function resetThermal(state){
    if(!state) return;
    state.exposure=0;
    state.damageAcc=0;
    state.warned=false;
    state.mode='none';
  }

  function updateThermalExposure(state, dt, mode){
    if(!state) state=createThermalState();
    if(!(dt>0)) return {state, damage:Math.floor(state.damageAcc), rate:0, warn:false, mode:state.mode};
    if(mode!=='cold' && mode!=='heat'){
      state.exposure=Math.max(0, state.exposure - THERMAL_RECOVERY*dt);
      if(state.exposure<THERMAL_GRACE*0.5){ state.warned=false; state.damageAcc=0; state.mode='none'; }
      return {state, damage:0, rate:0, warn:false, mode:'none', graceLeft:Math.max(0,THERMAL_GRACE-state.exposure)};
    }
    if(state.mode!==mode){ state.mode=mode; state.warned=false; }
    state.exposure += dt;
    if(state.exposure < THERMAL_GRACE){
      return {state, damage:0, rate:0, warn:false, mode, graceLeft:THERMAL_GRACE-state.exposure};
    }
    const over = state.exposure - THERMAL_GRACE;
    const rate = Math.min(THERMAL_RATE_MAX, THERMAL_RATE_BASE + over*THERMAL_RATE_RAMP);
    state.damageAcc = Math.min(THERMAL_BANK_MAX, state.damageAcc + rate*dt);
    const warn = !state.warned;
    state.warned = true;
    return {state, damage:Math.floor(state.damageAcc), rate, warn, mode, graceLeft:0};
  }

  function consumeThermalDamage(state, amount){
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

  function createWaterPressureState(){
    return {damageAcc:0, warned:false};
  }

  function resetWaterPressure(state){
    if(!state) return;
    state.damageAcc=0;
    state.warned=false;
  }

  function waterPressureLoad(waterStackTiles){
    const stack=Math.max(0,Number(waterStackTiles)||0);
    return stack/WATER_PRESSURE_ROWS_PER_CRUSH_LOAD;
  }

  function updateWaterPressure(state, dt, waterStackTiles, crushResistBonus, submerged){
    if(!state) state=createWaterPressureState();
    const stack=Math.max(0,Number(waterStackTiles)||0);
    const capacity=heroCrushCapacity(crushResistBonus);
    const load=waterPressureLoad(stack);
    const toleranceStack=capacity*WATER_PRESSURE_ROWS_PER_CRUSH_LOAD;
    if(!(dt>0) || !submerged || stack<=0){
      if(!submerged || stack<=0) resetWaterPressure(state);
      return {state, damage:0, rate:0, warn:false, load, capacity, excess:0, stack, toleranceStack, implode:false};
    }
    const nearLimit = load >= capacity*WATER_PRESSURE_WARN_RATIO;
    const excess = Math.max(0, load-capacity);
    let warn=false;
    if(nearLimit && !state.warned){
      state.warned=true;
      warn=true;
    }
    if(excess<=0){
      state.damageAcc=Math.max(0,state.damageAcc-WATER_PRESSURE_RECOVERY_RATE*dt);
      return {state, damage:0, rate:0, warn, load, capacity, excess:0, stack, toleranceStack, implode:false};
    }
    const crushPulse=crushTickDamage(excess);
    const rate=Math.min(WATER_PRESSURE_DAMAGE_RATE_MAX, Math.max(1, excess*1.6 + crushPulse*0.35));
    state.damageAcc=Math.min(WATER_PRESSURE_DAMAGE_BANK_MAX, state.damageAcc + rate*dt);
    const implode=excess>=WATER_PRESSURE_IMPLODE_EXCESS;
    const damage=implode ? Math.max(Math.floor(state.damageAcc), WATER_PRESSURE_DAMAGE_BANK_MAX) : Math.floor(state.damageAcc);
    return {state, damage, rate, warn, load, capacity, excess, stack, toleranceStack, implode};
  }

  function consumeWaterPressureDamage(state, amount){
    if(!state || !(amount>0)) return;
    state.damageAcc=Math.max(0,state.damageAcc-amount);
  }

  MM.survival = {
    DROWN_GRACE,
    SWIM_CHILL_GRACE,
    SWIM_CHILL_RATE_MAX,
    UNDERWATER_ENERGY_DAMAGE_PER_ENERGY,
    UNDERWATER_ENERGY_DAMAGE_MAX,
    WATER_PRESSURE_ROWS_PER_CRUSH_LOAD,
    WATER_PRESSURE_IMPLODE_EXCESS,
    createDrowningState,
    resetDrowning,
    updateDrowning,
    consumeDrowningDamage,
    createSwimChillState,
    resetSwimChill,
    updateSwimChill,
    consumeSwimChillDamage,
    THERMAL_GRACE,
    THERMAL_RATE_MAX,
    COLD_EXPOSURE_TEMP,
    COLD_CLIMATE_GATE,
    HEAT_EXPOSURE_TEMP,
    HEAT_CLIMATE_GATE,
    thermalExposureMode,
    createThermalState,
    resetThermal,
    updateThermalExposure,
    consumeThermalDamage,
    createUnderwaterEnergyState,
    resetUnderwaterEnergyShock,
    updateUnderwaterEnergyShock,
    consumeUnderwaterEnergyDamage,
    createWaterPressureState,
    resetWaterPressure,
    waterPressureLoad,
    updateWaterPressure,
    consumeWaterPressureDamage
  };
})();

export const survival = (typeof window!=='undefined' && window.MM) ? window.MM.survival : undefined;
export default survival;
