import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};

const { survival } = await import('../src/engine/survival.js');
const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

{
  const s=survival.createDrowningState();
  let out=null;
  assert.equal(survival.DROWN_GRACE, 20, 'drowning grace is 20 seconds');
  for(let i=0;i<19;i++) out=survival.updateDrowning(s,1,true);
  assert.equal(out.damage, 0, 'covered water before 20 s causes no drowning damage');
  assert.equal(out.warn, false, 'covered water before grace does not warn');
  out=survival.updateDrowning(s,1,true);
  assert.equal(out.warn, true, 'drowning warns when the 20 s grace expires');
  assert.ok(out.damage>=2, 'damage begins as soon as grace expires');
  const firstRate=out.rate;
  survival.consumeDrowningDamage(s,out.damage);
  for(let i=0;i<30;i++) out=survival.updateDrowning(s,1,true);
  assert.ok(out.rate>firstRate, 'drowning damage rate increases with time underwater');
}

{
  const s=survival.createDrowningState();
  for(let i=0;i<25;i++) survival.updateDrowning(s,1,true);
  const out=survival.updateDrowning(s,0.1,false);
  assert.equal(out.recovered, true, 'surfacing after drowning reports recovery');
  assert.equal(s.airless, 0, 'surfacing resets airless timer');
  assert.equal(s.damageAcc, 0, 'surfacing clears banked drowning damage');
}

{
  const s=survival.createSwimChillState();
  let out=null;
  assert.equal(survival.SWIM_CHILL_GRACE, 12, 'swim chill grace is 12 seconds');
  for(let i=0;i<11;i++) out=survival.updateSwimChill(s,1,true);
  assert.equal(out.damage, 0, 'swimming inside the grace window causes no chill damage');
  assert.equal(out.warn, false, 'no chill warning inside the grace window');
  out=survival.updateSwimChill(s,1.2,true);
  assert.equal(out.warn, true, 'chill warns once the grace expires');
  assert.ok(out.damage>=1, 'chill damage begins as soon as grace expires');
  const firstRate=out.rate;
  survival.consumeSwimChillDamage(s,out.damage);
  for(let i=0;i<40;i++) out=survival.updateSwimChill(s,1,true);
  assert.ok(out.rate>firstRate, 'chill drain rate ramps the longer the swim lasts');
  assert.ok(out.rate<=survival.SWIM_CHILL_RATE_MAX, 'chill drain rate is capped');
  // Climbing onto a raft pauses the drain but a long cold swim re-warms gradually
  out=survival.updateSwimChill(s,1,false);
  assert.equal(out.damage, 0, 'no chill damage while out of the water');
  const warmedExposure=s.exposure;
  assert.ok(warmedExposure>survival.SWIM_CHILL_GRACE, 'one second on deck does not erase a long cold swim');
  out=survival.updateSwimChill(s,0.5,true);
  assert.equal(out.warn, false, 'redipping right away does not re-warn');
  assert.ok(out.damage>=0 && out.rate>0, 'redipping while still chilled resumes the drain immediately');
  for(let i=0;i<60;i++) out=survival.updateSwimChill(s,1,false);
  assert.equal(s.exposure, 0, 'long rest fully re-warms the hero');
  assert.equal(s.damageAcc, 0, 'full re-warm clears banked chill damage');
  out=survival.updateSwimChill(s,1,true);
  assert.equal(out.damage, 0, 'a fresh swim starts a fresh grace window');
}

{
  const s=survival.createUnderwaterEnergyState();
  let out=survival.updateUnderwaterEnergyShock(s,1,true);
  assert.equal(out.damage, 1, 'small underwater energy use causes immediate shock damage');
  survival.consumeUnderwaterEnergyDamage(s,out.damage);
  assert.equal(s.damageAcc, 0, 'consuming underwater energy shock damage clears the visible pulse');
  out=survival.updateUnderwaterEnergyShock(s,50,true);
  assert.equal(out.damage, survival.UNDERWATER_ENERGY_DAMAGE_MAX, 'large underwater energy use is capped per damage pulse');
  out=survival.updateUnderwaterEnergyShock(s,4,false);
  assert.equal(out.damage, 0, 'energy use outside water does not shock the hero');
  assert.equal(s.damageAcc, 0, 'leaving water clears banked underwater energy shock');
}

{
  assert.equal(survival.WATER_PRESSURE_ROWS_PER_CRUSH_LOAD, 5, 'water pressure converts stacked water into crush-load units');
  const shallow=survival.createWaterPressureState();
  let out=survival.updateWaterPressure(shallow,1,10,0,true);
  assert.equal(out.damage, 0, 'a shallow water stack is below base Twardość capacity');
  assert.equal(out.warn, false, 'a shallow water stack does not warn');
  out=survival.updateWaterPressure(shallow,1,18,0,true);
  assert.equal(out.damage, 0, 'water pressure near the limit warns before damage');
  assert.equal(out.warn, true, 'pressure warns before exceeding capacity');

  const deep=survival.createWaterPressureState();
  out=survival.updateWaterPressure(deep,1,30,0,true);
  assert.equal(out.warn, true, 'deep water warns on first dangerous tick');
  assert.ok(out.damage>0, 'deep water pressure hurts an untrained hero');
  survival.consumeWaterPressureDamage(deep,out.damage);
  assert.ok(deep.damageAcc<1, 'consuming water-pressure damage clears the visible pulse');

  const trained=survival.createWaterPressureState();
  out=survival.updateWaterPressure(trained,1,30,7.5,true);
  assert.equal(out.damage, 0, 'Twardość/crushResistBonus raises deep-water pressure tolerance');
  assert.equal(out.implode, false, 'trained pressure tolerance avoids implosion at the same depth');

  const fatal=survival.createWaterPressureState();
  out=survival.updateWaterPressure(fatal,1,90,0,true);
  assert.equal(out.implode, true, 'extreme water pressure can implode an untrained hero');
  assert.ok(out.damage>=80, 'implosion produces a fatal-sized pressure pulse');
  out=survival.updateWaterPressure(fatal,1,90,0,false);
  assert.equal(out.damage, 0, 'leaving water clears pressure damage');
  assert.equal(fatal.damageAcc, 0, 'leaving water clears banked pressure damage');
}

{
  // Thermal exposure: deep-cold west / scorching east. Mode selection first.
  assert.equal(survival.thermalExposureMode({climate:0.1, temp:0.0}), 'cold', 'deep-cold climate at freezing temperature chills');
  assert.equal(survival.thermalExposureMode({climate:0.1, temp:0.0, nearWarmth:true}), 'none', 'a nearby fire breaks the cold drain');
  assert.equal(survival.thermalExposureMode({climate:0.1, temp:0.0, sheltered:true}), 'none', 'a roof/cave shelters from the cold');
  assert.equal(survival.thermalExposureMode({climate:0.1, temp:0.0, inWater:true}), 'none', 'water hands the cold case to swim chill (no double drain)');
  assert.equal(survival.thermalExposureMode({climate:0.5, temp:0.0}), 'none', 'a mild climate band never deep-freezes the hero');
  assert.equal(survival.thermalExposureMode({climate:0.9, temp:0.95}), 'heat', 'scorching climate at extreme temperature overheats');
  assert.equal(survival.thermalExposureMode({climate:0.9, temp:0.95, inWater:true}), 'none', 'a dip in water breaks the heat drain');
  assert.equal(survival.thermalExposureMode({climate:0.9, temp:0.95, sheltered:true}), 'none', 'shade/underground shelters from the heat');
  assert.equal(survival.thermalExposureMode({climate:0.9, temp:0.6}), 'none', 'a cool desert night does not overheat');
  assert.equal(survival.thermalExposureMode({}), 'none', 'missing climate data never drains');

  const s=survival.createThermalState();
  let out=null;
  assert.equal(survival.THERMAL_GRACE, 22, 'thermal grace is 22 seconds');
  for(let i=0;i<21;i++) out=survival.updateThermalExposure(s,1,'cold');
  assert.equal(out.damage, 0, 'cold inside the grace window causes no damage');
  assert.equal(out.warn, false, 'no warning inside the thermal grace window');
  out=survival.updateThermalExposure(s,1.2,'cold');
  assert.equal(out.warn, true, 'thermal drain warns once the grace expires');
  assert.equal(out.mode, 'cold', 'the warning carries the active mode');
  assert.ok(out.damage>=1, 'thermal damage begins as soon as grace expires');
  const firstRate=out.rate;
  survival.consumeThermalDamage(s,out.damage);
  for(let i=0;i<40;i++) out=survival.updateThermalExposure(s,1,'cold');
  assert.ok(out.rate>firstRate, 'thermal drain ramps with continued exposure');
  assert.ok(out.rate<=survival.THERMAL_RATE_MAX, 'thermal drain rate is capped');
  out=survival.updateThermalExposure(s,1,'none');
  assert.equal(out.damage, 0, 'stepping into shelter pauses the drain');
  assert.ok(s.exposure>survival.THERMAL_GRACE, 'one sheltered second does not erase a long freeze');
  for(let i=0;i<60;i++) out=survival.updateThermalExposure(s,1,'none');
  assert.equal(s.exposure, 0, 'a long warm rest fully recovers the hero');
  assert.equal(s.damageAcc, 0, 'full recovery clears banked thermal damage');
  out=survival.updateThermalExposure(s,1,'heat');
  assert.equal(out.damage, 0, 'a fresh heat exposure starts a fresh grace window');
  assert.equal(s.mode, 'heat', 'the state tracks which side is draining');

  // main.js wiring pins
  assert.match(mainSource, /SURVIVAL\.updateThermalExposure\(thermalState, dt, thermalModeCached\)/, 'main drives the thermal state machine');
  assert.match(mainSource, /sampleThermalMode\(tileX,inWater,heroWarmthCached\)/, 'main samples the thermal environment (throttled)');
  assert.match(mainSource, /function sampleThermalMode\(cx,inWater,warmth\)[\s\S]*sampleAmbientTemperature\(cx,cy,climate\)/, 'survival and the HUD share the same ambient-temperature sampler');
  assert.match(mainSource, /cause:thermal\.mode==='cold' \? 'deep_frost' : 'heat_stroke'/, 'thermal damage carries frost/heat causes');
  assert.match(mainSource, /function heroNearWarmth\(cx,cy\)/, 'main scans for torches/fire/lava as cold mitigation');
}

{
  assert.match(mainSource, /function triggerWaterDamageDistress\(cause,amount\)/, 'main has water-damage distress feedback');
  assert.match(mainSource, /function updateWaterDistressFx\(dt,inWater,pressure\)/, 'main has ongoing water-pressure distress feedback');
  assert.match(mainSource, /triggerWaterDamageDistress\(opts\.cause,dealt\)/, 'hero water damage triggers visual distress');
  assert.match(mainSource, /pushWorldNumber\(\{kind:'damage',amount:-dealt[\s\S]*cause:opts\.cause\}\)/, 'pressure damage stays a normal hero damage number');
  assert.match(mainSource, /if\(kind==='pressure' \|\| raw\.includes\('pressure'\)\) return 'pressure'/, 'pressure damage can still carry a compact pressure icon');
  assert.match(mainSource, /waterPressureFx>0\.03/, 'drawPlayer renders pressure compression when pressure rises');
  assert.match(mainSource, /waterPressureCriticalFx/, 'pressure feedback escalates toward a critical implosion state');
  assert.match(mainSource, /PARTICLES\.spawnBubble/, 'water distress emits bubbles/drops around the hero');
}

console.log('survival-sim: all assertions passed');
