// Energy-powered eye lamp. The model owns only durable lamp state and drain;
// main.js supplies the hero-energy service and the HUD, while lighting.js
// consumes the directional light descriptor returned by lightSource().
(function(){
  window.MM = window.MM || {};

  const DEFAULTS={
    drainPerSecond:1.5,
    minStartEnergy:1,
    range:11,
    level:15,
    spread:0.28
  };

  function createHeroLampModel(options){
    const cfg=Object.assign({},DEFAULTS,options||{});
    let enabled=false;

    function isOn(){ return enabled; }
    function energyAvailable(energy,opts){
      if(opts && opts.unlimited) return true;
      if(!energy) return false;
      try{
        if(typeof energy.canSpend==='function') return !!energy.canSpend(cfg.minStartEnergy);
        const info=typeof energy.info==='function' ? energy.info() : null;
        return !!(info && Number(info.energy)>=cfg.minStartEnergy);
      }catch(e){ return false; }
    }
    function setEnabled(value,energy,opts){
      const next=!!value;
      if(next===enabled) return {changed:false,on:enabled};
      if(next && !energyAvailable(energy,opts)) return {changed:false,on:false,blocked:'energy'};
      enabled=next;
      return {changed:true,on:enabled};
    }
    function toggle(energy,opts){ return setEnabled(!enabled,energy,opts); }
    function update(dt,energy,opts){
      if(!enabled) return {on:false,changed:false,spent:0};
      const step=Math.max(0,Math.min(0.1,Number(dt)||0));
      if(step<=0) return {on:true,changed:false,spent:0};
      if(opts && opts.unlimited) return {on:true,changed:false,spent:0};
      const cost=cfg.drainPerSecond*step;
      let paid=false;
      try{ paid=!!(energy && typeof energy.spend==='function' && energy.spend(cost)); }catch(e){ paid=false; }
      if(!paid){
        enabled=false;
        return {on:false,changed:true,depleted:true,spent:0};
      }
      return {on:true,changed:false,spent:cost};
    }
    function lightSource(player){
      if(!enabled || !player) return null;
      return {
        enabled:true,
        facing:player.facing<0?-1:1,
        range:cfg.range,
        level:cfg.level,
        spread:cfg.spread
      };
    }
    function snapshot(){ return {v:1,on:enabled}; }
    function restore(data){
      enabled=!!(data && typeof data==='object' ? data.on : data);
      return enabled;
    }
    function reset(){ enabled=false; }
    function info(){ return {on:enabled,drainPerSecond:cfg.drainPerSecond,minStartEnergy:cfg.minStartEnergy,range:cfg.range,level:cfg.level}; }

    return {isOn,setEnabled,toggle,update,lightSource,snapshot,restore,reset,info};
  }

  const heroLamp=createHeroLampModel();
  MM.heroLamp=heroLamp;
  MM.createHeroLampModel=createHeroLampModel;

})();

export const heroLamp=(typeof window!=='undefined' && window.MM) ? window.MM.heroLamp : undefined;
export const createHeroLampModel=(typeof window!=='undefined' && window.MM) ? window.MM.createHeroLampModel : undefined;
export default heroLamp;
