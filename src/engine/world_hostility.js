const root = typeof window !== 'undefined' ? window : globalThis;

// A single deterministic difficulty/climate gradient for long-distance travel.
// The center remains gentle; the far right becomes hotter and volcanic, while the
// far left becomes colder and windier. Systems should read this instead of
// inventing local "far from spawn" rules.
const RAMP_START = 1800;
const RAMP_FULL = 26000;

function clamp(v, a, b){ return v < a ? a : (v > b ? b : v); }
function finiteNumber(v, fallback){ return typeof v === 'number' && Number.isFinite(v) ? v : fallback; }
function smoothstep(a, b, x){
  const t = clamp((x - a) / Math.max(1e-9, b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function currentPlayerX(fallback){
  const p = root && root.player;
  return p && Number.isFinite(p.x) ? p.x : fallback;
}

// Runtime tuning for playtesting the difficulty ramp from the debug menu.
//   intensity — scales how strong the whole gradient is (0 = flat/no ramp,
//               1 = shipped default, up to 3 = brutal). Lets hostility exceed 1.
//   reach     — stretches the travel distance before the ramp bites (0.25 =
//               steep/quick, 1 = default, 4 = very gradual).
// These only re-shape the shared curve; every consumer keeps reading at().
const TUNING_BOUNDS = { intensity: [0, 3], reach: [0.25, 4] };
const tuning = { intensity: 1, reach: 1 };
function getTuning(){ return { intensity: tuning.intensity, reach: tuning.reach }; }
function setTuning(next){
  if(next && typeof next === 'object'){
    if(next.intensity !== undefined){
      tuning.intensity = clamp(finiteNumber(next.intensity, tuning.intensity), TUNING_BOUNDS.intensity[0], TUNING_BOUNDS.intensity[1]);
    }
    if(next.reach !== undefined){
      tuning.reach = clamp(finiteNumber(next.reach, tuning.reach), TUNING_BOUNDS.reach[0], TUNING_BOUNDS.reach[1]);
    }
  }
  return getTuning();
}

function at(x){
  const wx = finiteNumber(x, currentPlayerX(0));
  const distance = Math.abs(wx);
  const reach = tuning.reach > 0 ? tuning.reach : 1;
  const ramp = smoothstep(RAMP_START * reach, RAMP_FULL * reach, distance);
  const hostility = clamp(ramp * tuning.intensity, 0, 4);
  const hot = wx > 0 ? hostility : 0;
  const cold = wx < 0 ? hostility : 0;
  const side = hostility <= 0.001 ? 'center' : (wx < 0 ? 'cold' : 'hot');
  return {
    x: wx,
    distance,
    side,
    hostility,
    hot,
    cold,

    // World generation.
    temperatureBias: hot * 0.20 - cold * 0.21,
    moistureBias: cold * 0.04 - hot * 0.08,
    volcanoGateDelta: -hot * 0.18 + cold * 0.04,
    volcanoSizeMult: 1 + hot * 0.42,

    // Weather and seasons.
    seasonExtremeMult: 1 + hostility * 0.55,
    windExtremeMult: 1 + cold * 1.25 + hot * 0.25,

    // Meteorites.
    meteorFrequencyMult: 1 + hostility * 1.35,
    meteorIntensityMult: 1 + hostility * 0.55,

    // Ecology and combat.
    mobSpawnMult: 1 + hostility * 0.75,
    mobLocalCapMult: 1 + hostility * 0.35,
    mobHpMult: 1 + hostility * 1.20,
    mobDamageMult: 1 + hostility * 0.82,
    mobSpeedMult: 1 + hostility * 0.26,

    // Bosses.
    bossSpawnMult: 1 + hostility * 0.90,
    bossHpMult: 1 + hostility * 1.55,
    bossDamageMult: 1 + hostility * 1.08,
    bossSpeedMult: 1 + hostility * 0.20,
    bossGargantuanBonus: hostility * 0.24,
  };
}

function climateTemperature(x, base){
  const h = at(x);
  return clamp(finiteNumber(base, 0.5) + h.temperatureBias, 0, 1);
}

function climateMoisture(x, base){
  const h = at(x);
  return clamp(finiteNumber(base, 0.5) + h.moistureBias, 0, 1);
}

function meteorClassWeightMult(id, x){
  const h = at(x);
  switch(id){
    case 'ice': return clamp(1 + h.cold * 4.4 - h.hot * 0.55, 0.20, 5.80);
    case 'iron': return 1 + h.hot * 1.15 + h.hostility * 0.10;
    case 'iridium': return 1 + h.hot * 0.55 + h.cold * 0.35;
    case 'radioactive': return 1 + h.hot * 1.25 + h.hostility * 0.20;
    case 'antimatter': return 1 + h.hot * 0.75 + h.cold * 0.45 + h.hostility * 0.25;
    case 'biological': return 1 + h.hostility * 0.20 + h.hot * 0.10;
    default: return 1;
  }
}

// Mirror the meteor scheduler's actual clamp: the frequency mult only divides the
// wait, and rollNext then clamps the result to [floorDays, maxDays]. Apply the same
// bounds here so the metrics readout matches what the scheduler really does.
function meteorScheduleBoundsDays(x, minDays, maxDays, floorDays){
  const h = at(x);
  const mult = Math.max(1, h.meteorFrequencyMult || 1);
  const cap = finiteNumber(maxDays, 10);
  const floor = clamp(finiteNumber(floorDays, 0), 0, cap);
  return {
    min: +clamp(finiteNumber(minDays, 7) / mult, floor, cap).toFixed(2),
    max: +clamp(cap / mult, floor, cap).toFixed(2),
  };
}

export const worldHostility = {
  RAMP_START,
  RAMP_FULL,
  TUNING_BOUNDS,
  getTuning,
  setTuning,
  at,
  climateTemperature,
  climateMoisture,
  meteorClassWeightMult,
  meteorScheduleBoundsDays,
};

root.MM = root.MM || {};
root.MM.worldHostility = worldHostility;

export default worldHostility;
