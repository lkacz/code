// Weakened elemental matrix for bosses & guardians — ONE shared helper instead
// of a per-boss-system copy. The contract:
//   * bosses are IMMUNE to hard CC: a 'frozen'/'freeze' application downgrades
//     to chill — no boss ever stops dead from the wet+chill combo
//   * chill  -> 20% slow (speedMult 0.8) while it lasts
//   * wet    -> electric conduction: incoming electric damage x1.25 (and douses burn)
//   * burn   -> DoT at HALF the mob dps
// Each boss system owns its entities; it attaches a state via bossStatusFor(e),
// applies through applyBossStatus, ticks once per frame with tickBossStatus and
// multiplies electric damage by bossElectricDamageMult. Weapons reach every
// system at once through the MM.bossStatus registry: a system registers a thin
// applyRadius adapter and splats/streams call MM.bossStatus.applyRadius(...).
window.MM = window.MM || {};

export const BOSS_STATUS_TUNING = Object.freeze({
  CHILL_SLOW: 0.8,          // chilled bosses keep 80% speed — weakened, never frozen
  WET_ELECTRIC_MULT: 1.25,  // conduction into a soaked boss
  BURN_DOT_MULT: 0.5,       // boss burn ticks at half the applied dps
  CHILL_DUR: 4,
  WET_DUR: 6,
  BURN_DUR: 3,
  BURN_BASE_DPS: 2,
  TICK: 0.5,
});

export function createBossStatus(){
  return {chill:0, wet:0, burnT:0, burnDps:0, burnAcc:0};
}

// Lazily attach the shared state to any boss/guardian entity.
export function bossStatusFor(e){
  if(!e || typeof e!=='object') return createBossStatus();
  return e._elemStatus || (e._elemStatus=createBossStatus());
}

function dur(opts,fallback){
  const v=opts && Number(opts.dur);
  return (Number.isFinite(v) && v>0) ? Math.min(30,v) : fallback;
}

// Returns the status that actually landed ('chill'/'wet'/'burn'/'fizzle'), or
// null for kinds bosses ignore (poison etc.). Hard CC downgrades to chill here
// — this is THE single place the immunity rule lives.
export function applyBossStatus(st,kind,opts){
  if(!st) return null;
  if(kind==='frozen' || kind==='freeze') kind='chill';
  if(kind==='chill'){
    st.chill=Math.max(st.chill, dur(opts,BOSS_STATUS_TUNING.CHILL_DUR));
    return 'chill';
  }
  if(kind==='wet'){
    if(st.burnT>0){ st.burnT=0; st.burnDps=0; }
    st.wet=Math.max(st.wet, dur(opts,BOSS_STATUS_TUNING.WET_DUR));
    return 'wet';
  }
  if(kind==='burn'){
    if(st.wet>0){ st.wet=Math.max(0, st.wet-1.5); return 'fizzle'; } // soaked hide
    st.burnT=Math.max(st.burnT, dur(opts,BOSS_STATUS_TUNING.BURN_DUR));
    const dps=(opts && Number.isFinite(opts.dps) && opts.dps>0) ? opts.dps : BOSS_STATUS_TUNING.BURN_BASE_DPS;
    st.burnDps=Math.max(st.burnDps, dps*BOSS_STATUS_TUNING.BURN_DOT_MULT);
    return 'burn';
  }
  return null;
}

// One frame of decay + burn DoT. Returns {damage, speedMult, any}: the caller
// applies `damage` through its own hurt path and scales movement by speedMult.
export function tickBossStatus(st,dt){
  if(!st || !(dt>0) || !Number.isFinite(dt)) return {damage:0, speedMult:1, any:false};
  dt=Math.min(0.25,dt);
  let damage=0;
  if(st.chill>0) st.chill=Math.max(0, st.chill-dt);
  if(st.wet>0) st.wet=Math.max(0, st.wet-dt);
  if(st.burnT>0){
    st.burnT=Math.max(0, st.burnT-dt);
    st.burnAcc+=dt;
    while(st.burnAcc>=BOSS_STATUS_TUNING.TICK){
      st.burnAcc-=BOSS_STATUS_TUNING.TICK;
      damage+=st.burnDps*BOSS_STATUS_TUNING.TICK;
    }
    if(st.burnT<=0){ st.burnDps=0; st.burnAcc=0; }
  } else st.burnAcc=0;
  const any=st.chill>0 || st.wet>0 || st.burnT>0;
  return {damage, speedMult: st.chill>0 ? BOSS_STATUS_TUNING.CHILL_SLOW : 1, any};
}

export function bossElectricDamageMult(st){
  return (st && st.wet>0) ? BOSS_STATUS_TUNING.WET_ELECTRIC_MULT : 1;
}

// ---- cross-system registry (weapons splash statuses into every boss family) --
const systems=new Map();
function registerSystem(name,adapter){
  if(!name || !adapter || typeof adapter.applyRadius!=='function') return false;
  systems.set(String(name),adapter);
  return true;
}
function applyRadius(wx,wy,r,kind,opts){
  let n=0;
  for(const adapter of systems.values()){
    try{ n+=adapter.applyRadius(wx,wy,r,kind,opts)|0; }catch(e){}
  }
  return n;
}

const api={
  TUNING:BOSS_STATUS_TUNING,
  createBossStatus, bossStatusFor, applyBossStatus, tickBossStatus, bossElectricDamageMult,
  registerSystem, applyRadius,
  _systems:systems,
};
if(typeof window!=='undefined'){ window.MM.bossStatus=api; }
else if(typeof globalThis!=='undefined'){ globalThis.MM=globalThis.MM||{}; globalThis.MM.bossStatus=api; }

export const bossStatus=api;
export default bossStatus;
