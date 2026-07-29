const DEFAULT_DURATION_SECONDS=60;
const DEFAULT_COOLDOWN_SECONDS=180;

function finitePositive(value,fallback){
  const n=Number(value);
  return Number.isFinite(n) && n>0 ? n : fallback;
}

export function createTemporalEchoController(opts){
  opts=opts||{};
  const duration=finitePositive(opts.durationSeconds,DEFAULT_DURATION_SECONDS);
  const cooldownDuration=Math.max(0,Number.isFinite(Number(opts.cooldownSeconds)) ? Number(opts.cooldownSeconds) : DEFAULT_COOLDOWN_SECONDS);
  let phase='idle';
  let remaining=0;
  let cooldown=0;
  let payload=null;
  let collapseReason='';

  function arm(nextPayload){
    if(phase!=='idle' || cooldown>0) return false;
    phase='armed';
    remaining=duration;
    payload=nextPayload||null;
    collapseReason='';
    return true;
  }
  function beginRace(){
    if(phase!=='armed') return false;
    phase='racing';
    return true;
  }
  function beginRewind(){
    if(phase!=='racing' || remaining<=0) return false;
    phase='rewinding';
    return true;
  }
  function finishRewind(){
    if(phase!=='rewinding') return false;
    phase='idle';
    remaining=0;
    payload=null;
    cooldown=cooldownDuration;
    collapseReason='';
    return true;
  }
  function collapse(reason){
    if(phase==='idle') return false;
    phase='idle';
    remaining=0;
    payload=null;
    collapseReason=String(reason||'collapsed');
    return true;
  }
  function update(dt){
    const step=Math.max(0,Number(dt)||0);
    if(phase==='idle'){
      cooldown=Math.max(0,cooldown-step);
      return null;
    }
    if(phase!=='racing') return null;
    remaining=Math.max(0,remaining-step);
    if(remaining<=0) return {type:'expired'};
    return null;
  }
  function state(){
    return Object.freeze({
      phase,
      active:phase!=='idle',
      remaining,
      duration,
      cooldown,
      payload,
      collapseReason
    });
  }
  return {arm,beginRace,beginRewind,finishRewind,collapse,update,state};
}

export { DEFAULT_DURATION_SECONDS, DEFAULT_COOLDOWN_SECONDS };
