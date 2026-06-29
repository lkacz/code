// Weapon use system: melee swings (with a visible slash + held-weapon animation),
// bow arrows (projectiles with gravity) and stream weapons selected by the
// equipped item's weaponType:
//   'flame' — ignites organic creatures (mobs.igniteRadius) and flammable tiles
//   'hose'  — water jet: extinguishes tile fire and burning creatures, knocks a
//             little damage loose, and now and then condenses into a real WATER tile
//   'gas'   — toxic cloud: poisons living (organic) creatures; lingers and pools
//   'electric' — spends hero energy to fire a straight robot-style beam
// The equipped weapon comes from MM.inventory.
import { T, INFO, WORLD_H } from '../constants.js';
import { fire as FIRE } from './fire.js';
import { isBlastProtectedTile, isCondensedWaterTargetTile, isHeatRayPassableTile, isIridiumArrowPierceableTile, isSolidCollisionTile as isSolid } from './material_physics.js';
import { reactions as REACTIONS } from './reactions.js';
(function(){
  window.MM = window.MM || {};

  const arrows=[]; // {x,y,vx,vy,dmg,life,stuck,stuckT,ang}
  const puffs=[];  // {kind,x,y,vx,vy,life,total,dps}
  const electricBeams=[]; // {x1,y1,x2,y2,t,life,hit,blocked,phase}
  const ARROW_SPEED=22, ARROW_GRAV=14, ARROW_LIFE=5, ARROW_STUCK=4, MAX_ARROWS=64;
  const MAX_PUFFS=220;
  const MAX_ELECTRIC_BEAMS=24;
  // Per-kind stream tuning: emission count/frame, muzzle speed, vertical pull
  // (negative = rises like heat, positive = arcs down like water), lifetime factor
  // lifeMult compensates for in-flight friction so the actual reach matches the
  // weapon's fireRange (with drag ~0.9/s a puff covers ~60% of v0*t — without the
  // boost puffs died ~2 tiles short and never touched the terrain they should melt)
  const STREAMS={
    flame:{speed:10, emit:3, grav:-2.2, lifeMult:1.45},
    hose: {speed:12, emit:3, grav:3.0,  lifeMult:1.45},
    gas:  {speed:6,  emit:2, grav:-1.2, lifeMult:1.9},
    steam:{speed:2,  emit:0, grav:-3.2, lifeMult:1.0}  // cosmetic, spawned by boiling
  };
  const STREAM_FUEL={
    flame:{key:'wood', label:'drewna', rate:1},
    hose: {key:'water', label:'wody', rate:1},
    gas:  {key:'rottenMeat', label:'zepsutego miesa', rate:1}
  };
  const ARROW_TIERS=[
    {id:'iridium',  key:'arrowIridium',  label:'irydowe',     damage:2.80, speed:1.32, life:1.55, spread:0.004, color:'#b8d7ff', head:'#f0f7ff'},
    {id:'diamond',  key:'arrowDiamond',  label:'diamentowe',  damage:2.15, speed:1.18, life:1.35, spread:0.012, color:'#48f1ff', head:'#dffcff'},
    {id:'obsidian', key:'arrowObsidian', label:'obsydianowe', damage:1.65, speed:1.08, life:1.15, spread:0.020, color:'#7a5cc1', head:'#c7b8ff'},
    {id:'stone',    key:'arrowStone',    label:'kamienne',    damage:1.25, speed:1.00, life:1.00, spread:0.032, color:'#9aa0a8', head:'#e1e5ea'},
    {id:'wood',     key:'arrowWood',     label:'drewniane',   damage:1.00, speed:0.92, life:0.85, spread:0.050, color:'#caa472', head:'#dfe6f1'}
  ];
  const WATER_CONDENSE_CHANCE=0.008; // per dying hose puff (~1 tile per second of spray)
  // Elemental conversion odds (per puff contact — sustained streams transform terrain)
  const EVAPORATE_CHANCE=0.05;  // flame boils a water tile away → vapor joins the clouds
  const STONE_MELT_SECONDS=5.0; // flame must hold on one stone tile continuously
  const SAND_GLASS_SECONDS=10.0; // sand must be heated longer before it vitrifies
  const SAND_HEAT_CONTACT_SCALE=1.0;
  const STONE_HEAT_GRACE=0.22;  // tiny stream jitter grace; longer gaps lose the heat
  const QUENCH_CHANCE=0.5;      // hose hardens lava → obsidian
  const MUD_CHANCE=0.25;        // hose soaks sand → mud
  const SELF_FLAME_ARM_SEC=0.16; // muzzle is safe; lingering/backflow flame burns
  const ELECTRIC_PULSE_INTERVAL=0.10;
  const ELECTRIC_DEFAULT_ENERGY_PER_SEC=10;
  const HEAT_FORGED_GLASS_GRACE=0.55;
  const stoneHeat=new Map();    // key "x,y" -> {x,y,heat,gap}
  const sandHeat=new Map();     // key "x,y" -> {x,y,heat,gap}
  const heatForgedGlass=new Map(); // key -> {x,y,cool}; refreshed while flame keeps heating it
  const flameHeatRays=[];
  const streamFuelDebt={flame:0,hose:0,gas:0};
  const warnAt=Object.create(null);
  let bowCd=0, meleeCd=0, bossAcc=0, ultCharge=1, electricCd=0;
  let heroFlameHitCd=0;
  let iridiumPierces=0;
  let lastGetTile=null, lastSetTile=null;
  const ULT_CHARGE_TIME=5;
  // Melee swing visual: drawHeld animates the held blade, draw() adds a slash arc
  const swing={t:0, dur:0.2, tx:0, ty:0, dir:1};

  function equippedWeapon(){ return (MM.inventory && MM.inventory.equippedItem)? MM.inventory.equippedItem('weapon'):null; }
  function weaponType(w){ return (w && w.weaponType)||'melee'; }
  function tierColor(it){ const tc=(MM.inventory && MM.inventory.TIER_COLORS)||{}; return (it && tc[it.tier])||null; }
  function addWorldGas(kind,x,y,opts){
    try{
      if(MM.gases && MM.gases.add){
        return MM.gases.add(kind,x,y,Object.assign({getTile:opts && opts.getTile,setTile:opts && opts.setTile},opts||{}));
      }
    }catch(e){}
    return 0;
  }
  function windSpeedAt(x,y,getTile){
    try{
      const W=MM.wind;
      if(W && typeof W.speedAt==='function') return W.speedAt(x,y,getTile);
    }catch(e){}
    return 0;
  }
  function applyWindToArrow(a,dt,getTile){
    if(!a || a.stuck) return false;
    const sp=windSpeedAt(a.x,a.y,getTile);
    if(Math.abs(sp)<0.05) return false;
    const before=a.vx||0;
    const response=a.power ? 0.12 : 0.16;
    a.vx = before + sp*response*dt;
    const cap=Math.max(ARROW_SPEED*1.35, Number(a.windCap)||0);
    if(Math.abs(a.vx)>cap) a.vx=Math.sign(a.vx)*cap;
    return a.vx!==before;
  }
  function puffWindResponse(kind){
    if(kind==='steam') return 1.05;
    if(kind==='flame') return 0.86;
    if(kind==='gas') return 0.74;
    if(kind==='hose') return 0.24;
    return 0.50;
  }
  function applyWindToPuff(p,dt,getTile){
    if(!p) return false;
    const sp=windSpeedAt(p.x,p.y,getTile);
    if(Math.abs(sp)<0.05) return false;
    p.vx += sp*puffWindResponse(p.kind)*dt;
    const cap = p.kind==='hose' ? 15 : (p.kind==='flame' ? 16 : 12);
    if(Math.abs(p.vx)>cap) p.vx=Math.sign(p.vx)*cap;
    return true;
  }
  function igniteWorldGas(x,y,getTile,setTile,radius){
    try{ return !!(MM.gases && MM.gases.igniteAt && MM.gases.igniteAt(x,y,getTile,setTile,radius||1.5)); }catch(e){ return false; }
  }
  function applyBlockReaction(stimulus,tx,ty,getTile,setTile){
    try{
      return !!(REACTIONS && REACTIONS.apply && REACTIONS.apply(stimulus,tx,ty,getTile,setTile));
    }catch(e){ return false; }
  }
  function nowMs(){
    try{ if(typeof performance!=='undefined' && performance.now) return performance.now(); }catch(e){}
    return Date.now();
  }
  function sayLimited(id,text,delay){
    const t=nowMs(), wait=delay||900;
    if(t-(warnAt[id]||0)<wait) return;
    warnAt[id]=t;
    try{ if(window.msg) window.msg(text); }catch(e){}
  }
  function resourceCount(key){
    const inv=(typeof window!=='undefined' && window.inv) ? window.inv : null;
    if(!inv || typeof inv[key]!=='number') return 0;
    return Math.max(0, inv[key]|0);
  }
  function canSpendResource(key,n){
    const need=Math.max(0, n|0);
    return need<=0 || resourceCount(key)>=need;
  }
  function markWorldChanged(){
    try{ if(typeof window!=='undefined' && typeof window.__mmMarkWorldChanged==='function') window.__mmMarkWorldChanged(); }catch(e){}
  }
  function notifyResourceSpent(key,n){
    let updated=false;
    try{
      if(typeof window.updateInventoryHud==='function'){
        window.updateInventoryHud();
        updated=true;
      }
    }catch(e){}
    if(!updated){
      try{
        if(typeof window.dispatchEvent==='function' && typeof CustomEvent!=='undefined'){
          window.dispatchEvent(new CustomEvent('mm-resources-change',{detail:{key, spent:n}}));
        }
      }catch(e){}
      markWorldChanged();
    }
  }
  function spendResource(key,n){
    const need=Math.max(0, n|0);
    if(need<=0) return true;
    const inv=(typeof window!=='undefined' && window.inv) ? window.inv : null;
    if(!inv || typeof inv[key]!=='number') return false;
    if((inv[key]|0)<need) return false;
    inv[key]=Math.max(0,(inv[key]|0)-need);
    notifyResourceSpent(key,need);
    return true;
  }
  function warnMissingResource(spec){
    if(!spec) return;
    sayLimited('res_'+spec.key,'Brak: '+spec.label);
  }
  function consumeStreamFuel(kind,dt){
    const spec=STREAM_FUEL[kind];
    if(!spec) return true;
    if(resourceCount(spec.key)<=0){
      warnMissingResource(spec);
      return false;
    }
    const step=Math.max(0,Math.min(0.25, Number(dt)||0.016));
    streamFuelDebt[kind]=(streamFuelDebt[kind]||0)+step*(spec.rate||1);
    const due=Math.floor(streamFuelDebt[kind]+1e-9);
    if(due>0){
      if(!spendResource(spec.key,due)){
        streamFuelDebt[kind]=Math.min(streamFuelDebt[kind],0.99);
        warnMissingResource(spec);
        return false;
      }
      streamFuelDebt[kind]=Math.max(0,streamFuelDebt[kind]-due);
    }
    return true;
  }
  function streamBurstFuelCost(kind,charge){
    const spec=STREAM_FUEL[kind];
    if(!spec) return 0;
    const c=Math.max(0.35,Math.min(1,Number(charge)||0));
    return Math.max(1,Math.ceil((0.75+c*1.5)*(spec.rate||1)));
  }
  function consumeStreamBurstFuel(kind,charge){
    const spec=STREAM_FUEL[kind];
    const cost=streamBurstFuelCost(kind,charge);
    if(!spec || cost<=0) return true;
    if(!spendResource(spec.key,cost)){
      warnMissingResource(spec);
      return false;
    }
    return true;
  }
  function pickArrowTier(){
    for(const tier of ARROW_TIERS){
      if(resourceCount(tier.key)>0) return tier;
    }
    return null;
  }
  function hasArrowAmmo(){ return !!pickArrowTier(); }
  function warnNoArrows(){ sayLimited('arrows_empty','Brak strzal'); }
  function consumeArrowTier(){
    const tier=pickArrowTier();
    if(!tier){ warnNoArrows(); return null; }
    if(!spendResource(tier.key,1)){ warnNoArrows(); return null; }
    return tier;
  }
  function arrowAmmoCounts(){
    const out={};
    for(const tier of ARROW_TIERS) out[tier.id]=resourceCount(tier.key);
    return out;
  }
  function spreadAim(v,tier,scale){
    const spread=Math.max(0,Number(tier && tier.spread)||0)*(scale||1);
    if(spread<=0) return v;
    const a=(Math.random()-0.5)*spread*2;
    const ca=Math.cos(a), sa=Math.sin(a);
    return {dx:v.dx*ca - v.dy*sa, dy:v.dx*sa + v.dy*ca};
  }
  function pushArrow(a){
    if(arrows.length>=MAX_ARROWS) arrows.shift();
    arrows.push(a);
    return a;
  }

  function notifyMeleeSwing(tx,ty,player){
    swing.t=swing.dur; swing.tx=tx; swing.ty=ty; swing.dir=(player && player.facing>=0)?1:-1;
  }

  // ---- Firing (called every frame while the fire input is held) ----
  function fireHeld(player, aimX, aimY, dt){
    const w=equippedWeapon();
    const type=weaponType(w);
    if(type==='bow') return fireBow(player, aimX, aimY, w);
    if(type==='electric') return fireElectric(player, aimX, aimY, w, 1);
    if(STREAMS[type]) return fireStream(player, aimX, aimY, w, dt||0.016, type);
    return fireMelee(player, aimX, aimY);
  }
  function aimVector(player, aimX, aimY){
    let dx=aimX-player.x, dy=aimY-player.y;
    const d=Math.hypot(dx,dy)||1;
    return {dx:dx/d, dy:dy/d};
  }
  function consumeUltCharge(){
    if(ultCharge<0.35){
      try{ if(window.msg) window.msg('Ult ładuje się: '+Math.round(ultCharge*100)+'%'); }catch(e){}
      return 0;
    }
    const charge=Math.min(1,ultCharge);
    ultCharge=0;
    return charge;
  }
  function fireUlt(player, aimX, aimY){
    const w=equippedWeapon();
    if(!w) return false;
    const type=weaponType(w);
    if(type==='electric'){
      if(ultCharge<0.35){
        try{ if(window.msg) window.msg('Ult ładuje się: '+Math.round(ultCharge*100)+'%'); }catch(e){}
        return false;
      }
      const plannedCharge=Math.min(1,ultCharge);
      const plannedPower=2.4+plannedCharge*1.7;
      const cost=electricShotEnergyCost(w,plannedPower,plannedCharge);
      if(!heroEnergyAvailable(player,cost)){
        electricCd=Math.max(electricCd,0.18);
        try{ if(window.msg) window.msg('Za mało energii'); }catch(e){}
        return false;
      }
      const charge=consumeUltCharge();
      return fireElectric(player, aimX, aimY, w, plannedPower, charge);
    }
    if(type==='bow' && !hasArrowAmmo()){
      warnNoArrows();
      return false;
    }
    if(STREAMS[type] && ultCharge>=0.35){
      const spec=STREAM_FUEL[type];
      const plannedCost=streamBurstFuelCost(type,Math.min(1,ultCharge));
      if(spec && plannedCost>0 && !canSpendResource(spec.key,plannedCost)){
        warnMissingResource(spec);
        return false;
      }
    }
    const charge=consumeUltCharge();
    if(!charge) return false;
    if(type==='bow') return firePowerBow(player, aimX, aimY, w, charge);
    if(STREAMS[type]) return firePowerStream(player, aimX, aimY, w, type, charge);
    return firePowerMelee(player, aimX, aimY, w, charge);
  }
  function fireMelee(player, aimX, aimY){
    if(meleeCd>0 || (player.atkCd && player.atkCd>0)) return false;
    // Strike the aimed tile clamped to melee reach (matches click combat)
    const px=Math.floor(player.x), py=Math.floor(player.y);
    let tx=Math.floor(aimX), ty=Math.floor(aimY);
    tx=Math.max(px-3, Math.min(px+3, tx)); ty=Math.max(py-3, Math.min(py+3, ty));
    const bonus=(MM.activeModifiers && MM.activeModifiers.attackDamage)||0;
    const hit=(MM.bosses && MM.bosses.attackAt && MM.bosses.attackAt(tx,ty,bonus))
           || (MM.ufo && MM.ufo.attackAt && MM.ufo.attackAt(tx,ty,bonus))
           || (MM.npcSystem && MM.npcSystem.attackAt && MM.npcSystem.attackAt(tx,ty,bonus))
           || (MM.mobs && MM.mobs.attackAt && MM.mobs.attackAt(tx,ty,bonus));
    meleeCd=0.35; player.atkCd=Math.max(player.atkCd||0, 0.35);
    player.facing = tx>=px? 1 : -1;
    notifyMeleeSwing(tx,ty,player);
    try{ if(MM.audio && MM.audio.play) MM.audio.play('swing'); }catch(e){}
    return !!hit;
  }
  function fireBow(player, aimX, aimY, w){
    if(bowCd>0) return false;
    const tier=consumeArrowTier();
    if(!tier) return false;
    bowCd=Math.max(0.25, (w && w.fireCooldown)||0.55);
    const v=spreadAim(aimVector(player,aimX,aimY),tier,1);
    const sp=ARROW_SPEED*tier.speed;
    pushArrow({
      x:player.x + v.dx*0.7,
      y:player.y - 0.15 + v.dy*0.7,
      vx:v.dx*sp,
      vy:v.dy*sp - 1.2, // slight lob so mid-range shots arc naturally
      dmg:Math.max(1,Math.round(((w && w.attackDamage)||3)*tier.damage)),
      life:ARROW_LIFE*tier.life, stuck:false, stuckT:ARROW_STUCK,
      tier:tier.id, color:tier.color, headColor:tier.head, windCap:sp*1.35,
      pierceLeft:tier.id==='iridium' ? 3 : 0
    });
    player.facing = v.dx>=0?1:-1;
    try{ if(MM.audio && MM.audio.play) MM.audio.play('bow'); }catch(e){}
    return true;
  }
  function firePowerBow(player, aimX, aimY, w, charge){
    const tier=consumeArrowTier();
    if(!tier) return false;
    const v=spreadAim(aimVector(player,aimX,aimY),tier,0.45);
    const sp=ARROW_SPEED*tier.speed*(1.18+charge*0.28);
    pushArrow({
      x:player.x + v.dx*0.75,
      y:player.y - 0.15 + v.dy*0.75,
      vx:v.dx*sp,
      vy:v.dy*sp - 0.9,
      dmg:Math.round(((w && w.attackDamage)||3)*tier.damage*(2.7+charge*2.3)),
      life:ARROW_LIFE*tier.life*(1.05+charge*0.35), stuck:false, stuckT:ARROW_STUCK,
      power:true, fire:charge>0.85,
      tier:tier.id, color:tier.color, headColor:tier.head, windCap:sp*1.25,
      pierceLeft:tier.id==='iridium' ? 5 : 0
    });
    player.facing = v.dx>=0?1:-1;
    bowCd=Math.max(bowCd,0.25);
    try{ if(MM.audio && MM.audio.play) MM.audio.play('bow'); }catch(e){}
    return true;
  }
  function spendHeroEnergy(player, amount){
    const n=Math.max(0, Number(amount)||0);
    if(n<=0) return true;
    try{ if(MM.heroEnergy && typeof MM.heroEnergy.spend==='function') return !!MM.heroEnergy.spend(n); }catch(e){}
    if(player && typeof player.energy==='number'){
      if((player.energy||0)+1e-6<n) return false;
      player.energy=Math.max(0,(player.energy||0)-n);
      return true;
    }
    return false;
  }
  function heroEnergyAvailable(player, amount){
    const n=Math.max(0, Number(amount)||0);
    if(n<=0) return true;
    try{
      if(MM.heroEnergy && typeof MM.heroEnergy.info==='function'){
        const info=MM.heroEnergy.info()||{};
        return (Number(info.energy)||0)+1e-6>=n;
      }
    }catch(e){}
    if(player && typeof player.energy==='number') return (player.energy||0)+1e-6>=n;
    return true;
  }
  function electricShotEnergyCost(w,power,charge){
    const energyRate=Math.max(0, Number(w && w.energyCost)||ELECTRIC_DEFAULT_ENERGY_PER_SEC);
    const c=Math.max(0, Number(charge)||0);
    if(c>0) return energyRate*(0.85+c*1.15);
    return energyRate*ELECTRIC_PULSE_INTERVAL*Math.max(0.85,Math.min(1.2,Number(power)||1));
  }
  function electricBlocked(t){
    if(t===T.WATER || t===T.LAVA) return false;
    return isSolid(t);
  }
  function pushElectricBeam(b){
    if(electricBeams.length>=MAX_ELECTRIC_BEAMS) electricBeams.shift();
    electricBeams.push(b);
  }
  function electricDamageAt(tx,ty,dmg){
    try{ if(MM.mobs && MM.mobs.damageAt && MM.mobs.damageAt(tx,ty,dmg)) return true; }catch(e){}
    try{ if(MM.npcSystem && MM.npcSystem.damageAt && MM.npcSystem.damageAt(tx,ty,dmg)) return true; }catch(e){}
    try{ if(MM.bosses && MM.bosses.damageAt && MM.bosses.damageAt(tx,ty,dmg)) return true; }catch(e){}
    try{ if(MM.ufo && MM.ufo.damageAt && MM.ufo.damageAt(tx,ty,dmg)) return true; }catch(e){}
    return false;
  }
  function fireElectric(player, aimX, aimY, w, power, charge){
    if(electricCd>0) return false;
    const v=aimVector(player,aimX,aimY);
    player.facing = v.dx>=0?1:-1;
    power=Math.max(0.5, Number(power)||1);
    const cadence=ELECTRIC_PULSE_INTERVAL;
    const energyCost=electricShotEnergyCost(w,power,charge);
    if(!spendHeroEnergy(player,energyCost)){
      electricCd=Math.max(electricCd,0.18);
      try{ if(window.msg) window.msg('Za maĹ‚o energii'); }catch(e){}
      return false;
    }
    electricCd=cadence;
    const range=((w && w.fireRange)||8.5)*(power>1 ? Math.min(1.65,1+0.16*power) : 1);
    const baseDps=(w && w.fireDps)||10;
    const dmg=charge ? Math.max(4, baseDps*(0.45+charge*0.85)*power) : Math.max(0.75, baseDps*cadence*power);
    const sx=player.x + v.dx*0.62;
    const sy=player.y - 0.10 + v.dy*0.62;
    let ex=sx+v.dx*range, ey=sy+v.dy*range, hit=false, blocked=false;
    const worldObj=(typeof MM!=='undefined' && MM.world) ? MM.world : null;
    const tileGetter=(typeof lastGetTile==='function') ? lastGetTile
      : (worldObj && typeof worldObj.getTile==='function' ? (x,y)=>worldObj.getTile(x,y) : null);
    const tileSetter=(typeof lastSetTile==='function') ? lastSetTile
      : (worldObj && typeof worldObj.setTile==='function' ? (x,y,t)=>worldObj.setTile(x,y,t) : null);
    const step=0.18;
    for(let d=0.34; d<=range; d+=step){
      const x=sx+v.dx*d, y=sy+v.dy*d;
      const tx=Math.floor(x), ty=Math.floor(y);
      const t=tileGetter ? tileGetter(tx,ty) : null;
      if(tileGetter && tileSetter && applyBlockReaction('electric',tx,ty,tileGetter,tileSetter)){
        ex=sx+v.dx*Math.max(0,d-step*0.5);
        ey=sy+v.dy*Math.max(0,d-step*0.5);
        blocked=true;
        break;
      }
      if(t===T.GLASS && tileSetter && shatterGlassAt(tx,ty,tileSetter,tileGetter)){
        ex=sx+v.dx*Math.max(0,d-step*0.5);
        ey=sy+v.dy*Math.max(0,d-step*0.5);
        blocked=true;
        break;
      }
      if(electricBlocked(t)){
        ex=sx+v.dx*Math.max(0,d-step*0.5);
        ey=sy+v.dy*Math.max(0,d-step*0.5);
        blocked=true;
        break;
      }
      if(electricDamageAt(tx,ty,dmg)){ ex=x; ey=y; hit=true; break; }
    }
    pushElectricBeam({x1:sx,y1:sy,x2:ex,y2:ey,t:0,life:charge?0.28:0.18,hit,blocked,phase:Math.random()*Math.PI*2,power});
    try{ if(MM.audio && MM.audio.play) MM.audio.play('beam'); }catch(e){}
    try{
      const p=MM.particles, TILE=MM.TILE||20;
      if((hit || blocked) && p && p.spawnSparks) p.spawnSparks(ex*TILE,ey*TILE,hit?'rare':'common',hit?10:5);
    }catch(e){}
    return true;
  }
  function fireStream(player, aimX, aimY, w, dt, kind){
    if(!consumeStreamFuel(kind,dt)) return false;
    try{ if(MM.audio && MM.audio.play) MM.audio.play(kind==='flame'?'flame': kind==='hose'?'hose':'gas'); }catch(e){}
    let dx=aimX-player.x, dy=aimY-player.y;
    const d=Math.hypot(dx,dy)||1; dx/=d; dy/=d;
    player.facing = dx>=0?1:-1;
    const range=(w && w.fireRange)||6;
    const dps=(w && w.fireDps)||(kind==='hose'?2:6);
    spawnExternalStream(kind,player.x,player.y-0.1,dx,dy,{range,dps});
    // flame & gas tick direct damage into boss parts / a hovering saucer along
    // the stream (bosses have no burn/poison status; the hose is harmless to them)
    if(kind!=='hose'){
      bossAcc+=dt;
      if(bossAcc>=0.2 && ((MM.bosses && MM.bosses.damageAt) || (MM.ufo && MM.ufo.damageAt))){
        bossAcc=0;
        for(const t of [0.35,0.6,0.85]){
          const sx=Math.floor(player.x + dx*range*t), sy=Math.floor(player.y + dy*range*t);
          if(MM.bosses && MM.bosses.damageAt && MM.bosses.damageAt(sx,sy, dps*0.2)) break;
          if(MM.ufo && MM.ufo.damageAt && MM.ufo.damageAt(sx,sy, dps*0.2)) break;
        }
      }
    }
    return true;
  }
  function spawnExternalStream(kind,x,y,dx,dy,opts){
    opts=opts||{};
    const cfg=STREAMS[kind];
    if(!cfg || !Number.isFinite(x) || !Number.isFinite(y)) return 0;
    const d=Math.hypot(dx,dy)||1; dx/=d; dy/=d;
    const range=Math.max(0.5,Number(opts.range)||6);
    const dps=Math.max(0,Number(opts.dps)||((kind==='hose')?2:6));
    const emit=Math.max(1,Math.round((cfg.emit||1)*(Number(opts.emitScale)||1)));
    const spreadBase=Number.isFinite(opts.spread) ? Math.max(0,opts.spread) : 0.22;
    let made=0;
    if(kind==='flame') flameHeatRays.push({x,y,dx,dy,range});
    for(let i=0;i<emit && puffs.length<MAX_PUFFS;i++){
      const spread=(Math.random()-0.5)*spreadBase;
      const ca=Math.cos(spread), sa=Math.sin(spread);
      const ex=dx*ca - dy*sa, ey=dx*sa + dy*ca;
      const sp=cfg.speed*(Number(opts.speedMult)||1)*(0.85+Math.random()*0.3);
      puffs.push({
        kind,
        x:x + ex*(Number(opts.muzzle)||0.6),
        y:y + ey*(Number(opts.muzzle)||0.6),
        vx:ex*sp, vy:ey*sp + (Number.isFinite(opts.vyKick)?opts.vyKick:-0.3),
        life:range/cfg.speed*cfg.lifeMult*(0.9+Math.random()*0.25),
        total:range/cfg.speed*cfg.lifeMult,
        dps,
        scale:Number(opts.scale)||1
      });
      made++;
    }
    return made;
  }
  function firePowerStream(player, aimX, aimY, w, kind, charge){
    if(!consumeStreamBurstFuel(kind,charge)) return false;
    try{ if(MM.audio && MM.audio.play) MM.audio.play(kind==='flame'?'flame': kind==='hose'?'hose':'gas'); }catch(e){}
    const cfg=STREAMS[kind];
    const v=aimVector(player,aimX,aimY);
    player.facing = v.dx>=0?1:-1;
    const range=(w && w.fireRange)||6;
    const dps=((w && w.fireDps)||(kind==='hose'?2:6))*(2.2+charge*2.4);
    const totalLife=range/cfg.speed*cfg.lifeMult*(1.2+charge*0.4);
    const n=Math.min(MAX_PUFFS-puffs.length, Math.round(16+charge*18));
    for(let i=0;i<n;i++){
      const spread=(Math.random()-0.5)*(0.42-charge*0.12);
      const ca=Math.cos(spread), sa=Math.sin(spread);
      const ex=v.dx*ca - v.dy*sa, ey=v.dx*sa + v.dy*ca;
      const sp=cfg.speed*(1.05+charge*0.55)*(0.88+Math.random()*0.24);
      puffs.push({
        kind,
        x:player.x + ex*0.6, y:player.y - 0.1 + ey*0.6,
        vx:ex*sp, vy:ey*sp - 0.2,
        life:totalLife*(0.85+Math.random()*0.25),
        total:totalLife,
        dps,
        scale:1.25+charge*0.75
      });
    }
    if(kind!=='hose'){
      for(const t of [0.35,0.55,0.75,0.95]){
        const sx=Math.floor(player.x + v.dx*range*t), sy=Math.floor(player.y + v.dy*range*t);
        if(MM.bosses && MM.bosses.damageAt && MM.bosses.damageAt(sx,sy,dps*0.18)) break;
        if(MM.ufo && MM.ufo.damageAt && MM.ufo.damageAt(sx,sy,dps*0.18)) break;
      }
    }
    return true;
  }
  function firePowerMelee(player, aimX, aimY, w, charge){
    const v=aimVector(player,aimX,aimY);
    const tx=Math.floor(player.x + v.dx*(2.4+charge*1.4));
    const ty=Math.floor(player.y + v.dy*(2.4+charge*1.4));
    const bonus=(MM.activeModifiers && MM.activeModifiers.attackDamage)||0;
    const dmg=Math.round(5 + bonus + ((w && w.attackDamage)||3)*(1.7+charge*2.2));
    const radius=1.1+charge*0.9;
    let hit=false;
    const ri=Math.ceil(radius);
    for(let dy=-ri;dy<=ri;dy++){
      for(let dx=-ri;dx<=ri;dx++){
        if(dx*dx+dy*dy>radius*radius) continue;
        const x=tx+dx, y=ty+dy;
        hit = !!((MM.bosses && MM.bosses.damageAt && MM.bosses.damageAt(x,y,dmg))
          || (MM.ufo && MM.ufo.damageAt && MM.ufo.damageAt(x,y,dmg))
          || (MM.npcSystem && MM.npcSystem.damageAt && MM.npcSystem.damageAt(x,y,dmg))
          || (MM.mobs && MM.mobs.damageAt && MM.mobs.damageAt(x,y,dmg))) || hit;
      }
    }
    player.facing = v.dx>=0?1:-1;
    meleeCd=Math.max(meleeCd,0.25);
    player.atkCd=Math.max(player.atkCd||0, 0.35);
    notifyMeleeSwing(tx,ty,player);
    blastsFx.push({x:tx+0.5,y:ty+0.5,R:1.0+charge*0.65,t:0,max:0.35});
    try{ if(MM.audio && MM.audio.play) MM.audio.play('swing'); }catch(e){}
    return hit;
  }

  // A dying hose puff sometimes condenses into a real water tile
  function condenseWater(x,y,getTile,setTile){
    if(typeof setTile!=='function') return;
    if(Math.random()>=WATER_CONDENSE_CHANCE) return;
    const tx=Math.floor(x), ty=Math.floor(y);
    const t=getTile(tx,ty);
    if(!isCondensedWaterTargetTile(t)) return;
    try{
      if(MM.water && MM.water.addSource) MM.water.addSource(tx,ty,getTile,setTile);
      else setTile(tx,ty,T.WATER);
    }catch(e){ /* fluid sim unavailable — no puddle */ }
  }
  // --- Gas detonation (TNT effect) ----------------------------------------------
  // Toxic vapour touching open flame or lava explodes: nearby gas puffs are
  // consumed into the blast (bigger cloud → bigger boom), soft terrain craters
  // (chests, obsidian and diamond survive), creatures and the hero are hurt and
  // knocked back, the rim catches fire. A short cooldown turns a stream sprayed
  // straight onto lava into rhythmic booms instead of a 60-per-second buzz.
  const blastsFx=[]; // {x,y,R,t,max}
  let explodeCd=0;
  function explodeAt(wx,wy,getTile,setTile,opts){
    opts=opts||{};
    if(explodeCd>0 && !opts.force){ return false; } // fizzle — the triggering puff just burns off
    explodeCd=0.5;
    // consume the surrounding cloud into the blast
    let consumed=Math.max(0,(opts.extraConsumed|0)||0);
    for(let i=puffs.length-1;i>=0;i--){
      const q=puffs[i];
      if(q.kind!=='gas') continue;
      const dx=q.x-wx, dy=q.y-wy;
      if(dx*dx+dy*dy<=9){ puffs.splice(i,1); consumed++; }
    }
    try{ if(MM.gases && MM.gases.consumeRadius) consumed += MM.gases.consumeRadius('fuel',wx,wy,3,getTile,setTile); }catch(e){}
    const R=2.2+Math.min(1.6, consumed*0.06);
    const bx=Math.round(wx), by=Math.round(wy);
    // crater: soft tiles blasted out; precious and blast-resistant tiles survive
    const Ri=Math.ceil(R);
    for(let dy=-Ri;dy<=Ri;dy++){
      for(let dx=-Ri;dx<=Ri;dx++){
        if(dx*dx+dy*dy>R*R) continue;
        const tx=bx+dx, ty=by+dy;
        if(ty<1 || ty>=WORLD_H-3) continue;
        const t=getTile(tx,ty);
        if(isBlastProtectedTile(t)) continue;
        if(typeof setTile!=='function') continue;
        setTile(tx,ty,T.AIR);
        try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(tx,ty); }catch(e){}
        try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(tx,ty,getTile); }catch(e){}
      }
    }
    // the rim catches fire
    if(FIRE && FIRE.ignite){
      for(let k=0;k<6;k++){ const a=Math.random()*6.283; FIRE.ignite(Math.round(bx+Math.cos(a)*R), Math.round(by+Math.sin(a)*R), getTile, setTile); }
    }
    // creatures, bosses, plants
    try{ if(MM.mobs && MM.mobs.blastRadius) MM.mobs.blastRadius(wx,wy,R+1.5,14); }catch(e){}
    try{ if(MM.bosses && MM.bosses.damageAt){ MM.bosses.damageAt(bx,by,12); MM.bosses.damageAt(bx+1,by,8); MM.bosses.damageAt(bx-1,by,8); MM.bosses.damageAt(bx,by-1,8); } }catch(e){}
    try{ if(MM.ufo && MM.ufo.damageAt){ MM.ufo.damageAt(bx,by,14); MM.ufo.damageAt(bx,by-1,8); } }catch(e){}
    try{ if(MM.plants && MM.plants.scorchAt) MM.plants.scorchAt(wx,wy,R+1); }catch(e){}
    // the hero standing close is hurt and hurled (central damageHero handles
    // i-frames/knockback/death; explosions just bring bigger numbers)
    const pl=(typeof window!=='undefined' && window.player)||null;
    if(pl && typeof pl.hp==='number' && typeof window.damageHero==='function'){
      const d=Math.hypot(pl.x-wx,pl.y-wy);
      if(d<R+2){
        window.damageHero(Math.max(4, Math.round(16*(1-d/(R+2.5)))), {srcX:wx, srcY:wy, kb:6, kbY:-5, cause:'explosion'});
      }
    }
    // FX: expanding ring + spark burst + scattered short flames
    blastsFx.push({x:wx,y:wy,R,t:0,max:0.5});
    try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(wx*(MM.TILE||20),wy*(MM.TILE||20),'epic'); }catch(e){}
    try{ if(MM.audio && MM.audio.play) MM.audio.play('explosion'); }catch(e){}
    for(let k=0;k<8 && puffs.length<MAX_PUFFS;k++){
      const a=Math.random()*6.283, sp=4+Math.random()*5;
      puffs.push({kind:'flame', x:wx, y:wy, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp-1, life:0.3+Math.random()*0.3, total:0.55, dps:5});
    }
    return true;
  }

  // White cosmetic steam wisps (boiled water, quenched lava)
  function emitSteam(x,y,n,getTile,setTile){
    if(n>=3) addWorldGas('steam',x,y,{power:Math.min(1.8,n*0.22),cells:Math.min(4,Math.max(1,(n/2)|0)),getTile,setTile});
    for(let i=0;i<n && puffs.length<MAX_PUFFS;i++){
      puffs.push({
        kind:'steam',
        x:x+(Math.random()-0.5)*0.5, y:y+(Math.random()-0.5)*0.3,
        vx:(Math.random()-0.5)*1.2, vy:-1.5-Math.random()*1.5,
        life:0.6+Math.random()*0.5, total:1.0, dps:0
      });
    }
  }
  function thawColdTile(tx,ty,getTile,setTile){
    if(typeof setTile!=='function') return false;
    if(FIRE && FIRE.thawAt) return FIRE.thawAt(tx,ty,getTile,setTile);
    const t=getTile(tx,ty);
    if(t!==T.SNOW && t!==T.ICE) return false;
    setTile(tx,ty,T.WATER);
    try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(tx,ty,getTile); }catch(e){}
    try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(tx,ty); }catch(e){}
    return true;
  }
  function cookMeatAt(tx,ty,getTile,setTile){
    if(typeof setTile!=='function') return false;
    if(FIRE && FIRE.cookAt) return FIRE.cookAt(tx,ty,getTile,setTile);
    if(getTile(tx,ty)!==T.MEAT) return false;
    setTile(tx,ty,T.BAKED_MEAT);
    return true;
  }
  function shatterGlassAt(tx,ty,setTile,getTile,opts){
    if(typeof setTile!=='function') return false;
    if(getTile && getTile(tx,ty)!==T.GLASS) return false;
    opts=opts||{};
    const k=tileKey(tx,ty);
    if(opts.respectHeatForged && heatForgedGlass.has(k)) return false;
    setTile(tx,ty,T.AIR);
    heatForgedGlass.delete(k);
    try{
      const p=MM.particles;
      const tile=MM.TILE||20;
      if(p && p.spawnGlassShards) p.spawnGlassShards((tx+0.5)*tile,(ty+0.5)*tile,16);
      else if(p && p.spawnSparks) p.spawnSparks((tx+0.5)*tile,(ty+0.5)*tile,'rare',12);
      else if(p && p.spawnBurst) p.spawnBurst((tx+0.5)*tile,(ty+0.5)*tile,'rare');
    }catch(e){}
    try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(tx,ty); }catch(e){}
    try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(tx,ty,getTile); }catch(e){}
    return true;
  }
  function arrowPierceableTile(t){
    return isIridiumArrowPierceableTile(t);
  }
  function triggerAntimatterBreak(tx,ty){
    try{
      if(MM.meteorites && typeof MM.meteorites.triggerAntimatterBurst==='function'){
        return MM.meteorites.triggerAntimatterBurst(tx+0.5,ty+0.5,1.15);
      }
    }catch(e){}
    return false;
  }
  function tryIridiumPierceBlock(a,tx,ty,t,getTile,setTile){
    if(!a || a.tier!=='iridium' || !(a.pierceLeft>0) || typeof setTile!=='function') return false;
    if(t===T.ANTIMATTER_CRYSTAL){
      setTile(tx,ty,T.AIR);
      triggerAntimatterBreak(tx,ty);
    } else {
      if(!arrowPierceableTile(t)) return false;
      setTile(tx,ty,T.AIR);
    }
    try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(tx,ty); }catch(e){}
    try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(tx,ty,getTile); }catch(e){}
    markWorldChanged();
    try{
      const p=MM.particles, tile=MM.TILE||20;
      if(p && p.spawnSparks) p.spawnSparks((tx+0.5)*tile,(ty+0.5)*tile,'rare',8);
    }catch(e){}
    a.pierceLeft--;
    a.dmg=Math.max(1,Math.round((a.dmg||1)*0.78));
    a.vx*=0.92;
    a.vy*=0.92;
    iridiumPierces++;
    return true;
  }
  function tileKey(x,y){ return x+','+y; }
  function noteStoneHeat(tx,ty,touched){
    touched.add(tileKey(tx,ty));
  }
  function noteSandHeat(tx,ty,touched){
    touched.add(tileKey(tx,ty));
  }
  function updateStoneHeat(touched,getTile,setTile,dt){
    if(!touched.size && !stoneHeat.size) return;
    for(const k of touched){
      const comma=k.indexOf(',');
      const x=+k.slice(0,comma), y=+k.slice(comma+1);
      if(getTile(x,y)!==T.STONE) continue;
      const h=stoneHeat.get(k) || {x,y,heat:0,gap:0};
      h.heat+=dt;
      h.gap=0;
      if(h.heat>=STONE_MELT_SECONDS && typeof setTile==='function'){
        setTile(x,y,T.LAVA);
        stoneHeat.delete(k);
        if(FIRE && FIRE.noteLava) FIRE.noteLava(x,y);
        try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(x,y); }catch(e){}
      } else {
        stoneHeat.set(k,h);
      }
    }
    for(const [k,h] of stoneHeat){
      if(touched.has(k)) continue;
      if(getTile(h.x,h.y)!==T.STONE){ stoneHeat.delete(k); continue; }
      h.gap=(h.gap||0)+dt;
      if(h.gap>STONE_HEAT_GRACE) stoneHeat.delete(k);
      else stoneHeat.set(k,h);
    }
  }
  function stoneHeatMaxRatio(){
    let best=0;
    for(const h of stoneHeat.values()){
      const r=Math.max(0,Math.min(1,(h.heat||0)/STONE_MELT_SECONDS));
      if(r>best) best=r;
    }
    return best;
  }
  function updateSandHeat(touched,getTile,setTile,dt){
    if(!touched.size && !sandHeat.size) return;
    for(const k of touched){
      const comma=k.indexOf(',');
      const x=+k.slice(0,comma), y=+k.slice(comma+1);
      if(getTile(x,y)!==T.SAND) continue;
      const h=sandHeat.get(k) || {x,y,heat:0,gap:0};
      h.heat+=dt*SAND_HEAT_CONTACT_SCALE;
      h.gap=0;
      if(h.heat>=SAND_GLASS_SECONDS && typeof setTile==='function'){
        setTile(x,y,T.GLASS);
        heatForgedGlass.set(k,{x,y,cool:HEAT_FORGED_GLASS_GRACE});
        sandHeat.delete(k);
        try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(x,y); }catch(e){}
      } else {
        sandHeat.set(k,h);
      }
    }
    for(const [k,h] of sandHeat){
      if(touched.has(k)) continue;
      if(getTile(h.x,h.y)!==T.SAND){ sandHeat.delete(k); continue; }
      h.gap=(h.gap||0)+dt;
      if(h.gap>STONE_HEAT_GRACE) sandHeat.delete(k);
      else sandHeat.set(k,h);
    }
  }
  function sandHeatMaxRatio(){
    let best=0;
    for(const h of sandHeat.values()){
      const r=Math.max(0,Math.min(1,(h.heat||0)/SAND_GLASS_SECONDS));
      if(r>best) best=r;
    }
    return best;
  }
  function flameHeatRayPasses(t){
    return isHeatRayPassableTile(t);
  }
  function applyFlameHeatRays(touchedSand,getTile){
    if(!flameHeatRays.length) return;
    for(const ray of flameHeatRays){
      const step=0.25;
      for(let d=0.7; d<=ray.range; d+=step){
        const tx=Math.floor(ray.x+ray.dx*d);
        const ty=Math.floor(ray.y+ray.dy*d);
        const t=getTile(tx,ty);
        if(flameHeatRayPasses(t)) continue;
        if(t===T.SAND) noteSandHeat(tx,ty,touchedSand);
        else if(t===T.GLASS){
          const k=tileKey(tx,ty);
          const h=heatForgedGlass.get(k);
          if(h) h.cool=HEAT_FORGED_GLASS_GRACE;
        }
        break;
      }
    }
    flameHeatRays.length=0;
  }
  function updateHeatForgedGlass(getTile,dt){
    if(!heatForgedGlass.size) return;
    for(const [k,h] of heatForgedGlass){
      if(getTile(h.x,h.y)!==T.GLASS){ heatForgedGlass.delete(k); continue; }
      h.cool-=dt;
      if(h.cool<=0) heatForgedGlass.delete(k);
    }
  }

  function spawnGasCloud(x,y,intensity){
    const power=Math.max(0.25, Math.min(4, intensity||1));
    const persistent=addWorldGas('poison',x,y,{power,cells:Math.min(10,Math.round(2+power*2.4))});
    const n=Math.min(MAX_PUFFS-puffs.length, Math.round(8+power*9));
    for(let i=0;i<n;i++){
      const a=Math.random()*Math.PI*2;
      const sp=(0.7+Math.random()*2.2)*(0.7+power*0.18);
      puffs.push({
        kind:'gas',
        x:x+(Math.random()-0.5)*0.9,
        y:y+(Math.random()-0.5)*0.45,
        vx:Math.cos(a)*sp*0.7,
        vy:-Math.abs(Math.sin(a))*sp - 0.3 - power*0.12,
        life:(2.8+Math.random()*1.6)*(0.85+power*0.15),
        total:3.8,
        dps:4+power*1.2,
        scale:1+power*0.12
      });
    }
    return n+persistent;
  }
  function flameTouchesHero(p,pl){
    if(!p || !pl || typeof pl.x!=='number' || typeof pl.y!=='number') return false;
    const hw=Math.max(0.25,(pl.w||0.7)*0.5);
    const hh=Math.max(0.35,(pl.h||0.95)*0.5);
    const left=pl.x-hw, right=pl.x+hw, top=pl.y-hh, bottom=pl.y+hh;
    const cx=Math.max(left,Math.min(right,p.x));
    const cy=Math.max(top,Math.min(bottom,p.y));
    const dx=p.x-cx, dy=p.y-cy;
    const r=0.34+0.12*(p.scale||1);
    return dx*dx+dy*dy<=r*r;
  }
  function hurtHeroWithFlame(p){
    if(heroFlameHitCd>0) return false;
    if((p.age||0)<SELF_FLAME_ARM_SEC) return false;
    const pl=(typeof window!=='undefined' && window.player)||null;
    if(!flameTouchesHero(p,pl)) return false;
    if(typeof window.damageHero!=='function') return false;
    const dmg=Math.max(2,Math.round((p.dps||6)*0.38));
    const ok=window.damageHero(dmg,{
      srcX:p.x, srcY:p.y,
      kb:1.8, kbY:-1.2,
      invulMs:260,
      cause:'flamethrower'
    });
    if(ok) heroFlameHitCd=0.22;
    return !!ok;
  }

  // ---- Simulation ----
  function update(dt, getTile, setTile){
    if(typeof getTile==='function') lastGetTile=getTile;
    if(typeof setTile==='function') lastSetTile=setTile;
    if(!(dt>0) || !isFinite(dt)) return;
    ultCharge=Math.min(1, ultCharge + dt/ULT_CHARGE_TIME);
    if(bowCd>0) bowCd-=dt;
    if(meleeCd>0) meleeCd-=dt;
    if(electricCd>0) electricCd-=dt;
    if(swing.t>0) swing.t-=dt;
    if(explodeCd>0) explodeCd-=dt;
    if(heroFlameHitCd>0) heroFlameHitCd=Math.max(0,heroFlameHitCd-dt);
    const heatedStoneTiles=new Set();
    const heatedSandTiles=new Set();
    for(let i=blastsFx.length-1;i>=0;i--){ blastsFx[i].t+=dt; if(blastsFx[i].t>blastsFx[i].max) blastsFx.splice(i,1); }
    for(let i=electricBeams.length-1;i>=0;i--){
      const b=electricBeams[i];
      b.t+=dt;
      if(b.t>=b.life) electricBeams.splice(i,1);
    }
    // Arrows
    for(let i=arrows.length-1;i>=0;i--){
      const a=arrows[i];
      if(a.stuck){ a.stuckT-=dt; if(a.stuckT<=0) arrows.splice(i,1); continue; }
      a.life-=dt; if(a.life<=0){ arrows.splice(i,1); continue; }
      // a burning arrow flying into a gas cloud detonates it
      if(a.fire){
        for(const q of puffs){
          if(q.kind!=='gas') continue;
          const ddx=q.x-a.x, ddy=q.y-a.y;
          if(ddx*ddx+ddy*ddy<1.4){ explodeAt(q.x,q.y,getTile,setTile); break; }
        }
        igniteWorldGas(a.x,a.y,getTile,setTile,1.4);
      }
      a.vy+=ARROW_GRAV*dt;
      applyWindToArrow(a,dt,getTile);
      const steps=Math.max(1, Math.ceil(Math.max(Math.abs(a.vx),Math.abs(a.vy))*dt/0.35));
      const sdt=dt/steps;
      for(let s=0;s<steps;s++){
        a.x+=a.vx*sdt; a.y+=a.vy*sdt;
        const tx=Math.floor(a.x), ty=Math.floor(a.y);
        // an arrow flying through open flame or over lava catches fire
        if(!a.fire && ((FIRE && FIRE.isBurning(tx,ty)) || getTile(tx,ty)===T.LAVA)) a.fire=true;
        // Creature hit (mob, boss part or a hovering saucer)
        if((MM.mobs && MM.mobs.damageAt && MM.mobs.damageAt(tx,ty,a.dmg))
        || (MM.bosses && MM.bosses.damageAt && MM.bosses.damageAt(tx,ty,a.dmg))
        || (MM.npcSystem && MM.npcSystem.damageAt && MM.npcSystem.damageAt(tx,ty,a.dmg))
        || (MM.ufo && MM.ufo.damageAt && MM.ufo.damageAt(tx,ty,a.dmg))){
          if(a.fire && MM.mobs && MM.mobs.igniteAt) MM.mobs.igniteAt(tx,ty,{dur:2.5,dps:2});
          arrows.splice(i,1); break;
        }
        const t=getTile(tx,ty);
        if(t===T.GLASS && shatterGlassAt(tx,ty,setTile,getTile)){
          arrows.splice(i,1);
          break;
        }
        if(isSolid(t)){
          if(tryIridiumPierceBlock(a,tx,ty,t,getTile,setTile)){
            if(a.fire && FIRE) FIRE.ignite(tx,ty,getTile,setTile);
            continue;
          }
          a.x-=a.vx*sdt*0.6; a.y-=a.vy*sdt*0.6; // sit at the surface, not inside
          a.stuck=true;
          if(a.fire && FIRE){ FIRE.ignite(tx,ty,getTile,setTile); FIRE.ignite(Math.floor(a.x),Math.floor(a.y),getTile,setTile); }
          break;
        }
        if(t===T.WATER){ a.vx*=0.96; a.vy*=0.96; a.fire=false; } // water drag douses it too
      }
    }
    // Stream puffs
    for(let i=puffs.length-1;i>=0;i--){
      const p=puffs[i];
      if(!p) continue; // explosions can shrink the puff array below the current loop index
      p.life-=dt;
      p.age=(p.age||0)+dt;
      if(p.life<=0){
        if(p.kind==='hose') condenseWater(p.x,p.y,getTile,setTile);
        else if(p.kind==='gas' && Math.random()<0.28) addWorldGas('poison',p.x,p.y,{power:0.25,cells:1,getTile,setTile});
        puffs.splice(i,1); continue;
      }
      const px0=p.x, py0=p.y;
      const cfg=STREAMS[p.kind]||STREAMS.flame;
      applyWindToPuff(p,dt,getTile);
      p.x+=p.vx*dt; p.y+=p.vy*dt;
      p.vy+=cfg.grav*dt;
      p.vx*=1-Math.min(1,dt*0.9); p.vy*=1-Math.min(1,dt*(p.kind==='hose'?0.5:0.9));
      const tx=Math.floor(p.x), ty=Math.floor(p.y);
      const t=getTile(tx,ty);
      const info=INFO[t] || null;
      const hitWall=isSolid(t);
      if(p.kind==='flame' && applyBlockReaction('heat',tx,ty,getTile,setTile)){
        puffs.splice(i,1); continue;
      }
      if(p.kind==='hose' && applyBlockReaction('water',tx,ty,getTile,setTile)){
        puffs.splice(i,1); continue;
      }
      if(t===T.GLASS && shatterGlassAt(tx,ty,setTile,getTile,{respectHeatForged:p.kind==='flame'})){
        puffs.splice(i,1); continue;
      }
      if(p.kind==='flame'){
        if(igniteWorldGas(p.x,p.y,getTile,setTile,1.6)){ puffs.splice(i,1); continue; }
        hurtHeroWithFlame(p);
        if(t===T.WATER){
          // boiling: sometimes the tile evaporates outright — its mass rises as
          // vapor into the cloud system (volume-true: 1 tile == 1.0 vapor mass)
          if(typeof setTile==='function' && Math.random()<EVAPORATE_CHANCE){
            setTile(tx,ty,T.AIR);
            try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(tx,ty,getTile); }catch(e){}
            try{ if(MM.clouds && MM.clouds.injectVapor) MM.clouds.injectVapor(tx,1); }catch(e){}
            emitSteam(p.x,p.y-0.3,3,getTile,setTile);
          } else if(Math.random()<0.35) emitSteam(p.x,p.y-0.3,1,getTile,setTile); // hissing surface
          puffs.splice(i,1); continue;
        }
        if(t===T.MEAT && cookMeatAt(tx,ty,getTile,setTile)){ puffs.splice(i,1); continue; }
        if(info && info.flammable && Math.random()<0.22 && FIRE) FIRE.ignite(tx,ty,getTile,setTile);
        if(hitWall){
          // sustained flame melts bare rock into a lava pool; snow and ice thaw to water
          if(t===T.STONE && typeof setTile==='function'){
            noteStoneHeat(tx,ty,heatedStoneTiles);
          } else if((t===T.SNOW||t===T.ICE) && Math.random()<0.3 && thawColdTile(tx,ty,getTile,setTile)){
            emitSteam(p.x,p.y-0.2,1,getTile,setTile);
          }
          puffs.splice(i,1); continue;
        }
        if(Math.random()<0.3 && MM.mobs && MM.mobs.igniteRadius) MM.mobs.igniteRadius(p.x,p.y,0.9,{dur:2.5, dps:(p.dps||6)*0.6});
        if(Math.random()<0.25 && MM.plants && MM.plants.scorchAt) MM.plants.scorchAt(p.x,p.y,1.2);
      } else if(p.kind==='hose'){
        if(FIRE && FIRE.isBurning(tx,ty)) FIRE.extinguish(tx,ty);
        if(Math.random()<0.3 && MM.mobs && MM.mobs.douseRadius) MM.mobs.douseRadius(p.x,p.y,1.0);
        // watering can: the jet hydrates the garden it passes over
        if(Math.random()<0.3 && MM.plants && MM.plants.waterAt) MM.plants.waterAt(p.x,p.y,0.3,1.6);
        if(Math.random()<0.10 && MM.mobs && MM.mobs.damageAt) MM.mobs.damageAt(tx,ty, Math.max(1,(p.dps||2)*0.5));
        if(t===T.LAVA){
          // quenching: molten rock hardens to obsidian under the jet
          if(typeof setTile==='function' && Math.random()<QUENCH_CHANCE){
            setTile(tx,ty,T.OBSIDIAN);
            emitSteam(p.x,p.y-0.2,3,getTile,setTile);
          } else emitSteam(p.x,p.y-0.2,1,getTile,setTile);
          puffs.splice(i,1); continue;
        }
        if(t===T.WATER){ puffs.splice(i,1); continue; } // merged into the body of water
        if(hitWall){
          // soaked sand turns to boggy mud (halves the speed of anything walking on it)
          if(t===T.SAND && typeof setTile==='function' && Math.random()<MUD_CHANCE){
            setTile(tx,ty,T.MUD);
          } else condenseWater(px0,py0,getTile,setTile);
          puffs.splice(i,1); continue;
        }
      } else if(p.kind==='gas'){
        if(t===T.WATER){ puffs.splice(i,1); continue; }
        // toxic vapour DETONATES on contact with open flame or lava
        if((FIRE && FIRE.isBurning(tx,ty)) || t===T.LAVA){
          puffs.splice(i,1);
          explodeAt(p.x,p.y,getTile,setTile);
          continue;
        }
        if(hitWall){
          addWorldGas('poison',px0,py0,{power:0.18,cells:1,getTile,setTile});
          p.x=px0; p.y=py0; p.vx*=0.3; p.vy=-Math.abs(p.vy)*0.3;
        } // pools against walls
        if(Math.random()<0.3 && MM.mobs && MM.mobs.poisonRadius) MM.mobs.poisonRadius(p.x,p.y,0.95,{dur:4, dps:(p.dps||5)*0.7});
      } else { // steam: purely cosmetic, fades on contact
        if(hitWall || t===T.WATER){ puffs.splice(i,1); continue; }
      }
    }
    applyFlameHeatRays(heatedSandTiles,getTile);
    updateStoneHeat(heatedStoneTiles,getTile,setTile,dt);
    updateSandHeat(heatedSandTiles,getTile,setTile,dt);
    updateHeatForgedGlass(getTile,dt);
  }

  // ---- Rendering ----
  function drawStoneHeat(ctx,TILE,tileVisible){
    if(!stoneHeat.size) return;
    const now=(typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    for(const h of stoneHeat.values()){
      if(!tileVisible(h.x,h.y)) continue;
      const r=Math.max(0,Math.min(1,(h.heat||0)/STONE_MELT_SECONDS));
      const px=h.x*TILE, py=h.y*TILE;
      const pulse=0.82+0.18*Math.sin(now*0.018+h.x*1.7+h.y*0.9);
      const inset=Math.max(1,TILE*0.06);
      ctx.globalAlpha=(0.14+0.46*r)*pulse;
      ctx.fillStyle='#ff6a1f';
      ctx.fillRect(px+inset,py+inset,TILE-inset*2,TILE-inset*2);
      ctx.globalAlpha=0.18+0.58*r;
      ctx.fillStyle='#ffe27a';
      const crack=Math.max(1,TILE*(0.045+0.035*r));
      const len=Math.max(1,TILE*(0.12+0.62*r));
      ctx.fillRect(px+TILE*0.16,py+TILE*0.35,len,crack);
      ctx.fillRect(px+TILE*0.48,py+TILE*0.14,crack,Math.max(1,TILE*(0.18+0.56*r)));
      if(r>0.55){
        ctx.globalAlpha=(r-0.55)*1.2;
        ctx.fillStyle='#fff1b8';
        ctx.fillRect(px+TILE*0.30,py+TILE*0.66,Math.max(1,TILE*0.34*r),crack);
      }
    }
    ctx.restore();
  }
  function drawSandHeat(ctx,TILE,tileVisible){
    if(!sandHeat.size) return;
    const now=(typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    for(const h of sandHeat.values()){
      if(!tileVisible(h.x,h.y)) continue;
      const r=Math.max(0,Math.min(1,(h.heat||0)/SAND_GLASS_SECONDS));
      const px=h.x*TILE, py=h.y*TILE;
      const pulse=0.80+0.20*Math.sin(now*0.014+h.x*1.3+h.y*1.1);
      const inset=Math.max(1,TILE*0.08);
      ctx.globalAlpha=(0.10+0.40*r)*pulse;
      ctx.fillStyle='#ffb84a';
      ctx.fillRect(px+inset,py+inset,TILE-inset*2,TILE-inset*2);
      ctx.globalAlpha=0.12+0.50*r;
      ctx.fillStyle='#fff0c5';
      const bead=Math.max(1,TILE*(0.08+0.10*r));
      ctx.fillRect(px+TILE*0.18,py+TILE*0.25,bead,bead);
      ctx.fillRect(px+TILE*0.58,py+TILE*0.46,bead*0.8,bead*0.8);
      if(r>0.70){
        ctx.globalAlpha=(r-0.70)*1.4;
        ctx.fillStyle='#e9fbff';
        ctx.fillRect(px+TILE*0.25,py+TILE*0.68,TILE*0.50,Math.max(1,TILE*0.08));
      }
    }
    ctx.restore();
  }
  function draw(ctx,TILE,canDrawTile){
    const visibleTile = typeof canDrawTile === 'function' ? canDrawTile : null;
    const tileVisible = (x,y)=> !visibleTile || visibleTile(Math.floor(x),Math.floor(y));
    if(arrows.length){
      ctx.save();
      for(const a of arrows){
        if(!tileVisible(a.x,a.y)) continue;
        const ang=a.stuck? a.ang||0 : Math.atan2(a.vy,a.vx);
        if(!a.stuck) a.ang=ang;
        ctx.save();
        ctx.translate(a.x*TILE, a.y*TILE); ctx.rotate(ang);
        ctx.strokeStyle=a.power?(a.color||'#f5d66a'):(a.color||'#caa472'); ctx.lineWidth=a.power?3.2:2;
        ctx.beginPath(); ctx.moveTo(-10,0); ctx.lineTo(6,0); ctx.stroke();
        ctx.fillStyle=a.headColor || (a.power?'#fff1a8':'#dfe6f1'); // head
        ctx.beginPath(); ctx.moveTo(9,0); ctx.lineTo(4,-2.6); ctx.lineTo(4,2.6); ctx.closePath(); ctx.fill();
        ctx.fillStyle='#e8e2d2'; // fletching
        ctx.fillRect(-11,-2.4,4,1.6); ctx.fillRect(-11,0.8,4,1.6);
        if(a.fire){ // burning arrowhead
          const fl=Math.sin(performance.now()*0.03 + a.x)*0.5+0.5;
          ctx.fillStyle='rgba(255,170,50,'+(0.6+0.3*fl)+')';
          ctx.beginPath(); ctx.arc(7,0,3+fl*1.5,0,Math.PI*2); ctx.fill();
        }
        ctx.restore();
      }
      ctx.restore();
    }
    if(puffs.length){
      if(!spriteCache) buildPuffSprites();
      ctx.save();
      let comp='';
      for(const p of puffs){
        if(!tileVisible(p.x,p.y)) continue;
        // flame glows additively; water and gas read better as murky overlays
        const want=p.kind==='flame'? 'lighter':'source-over';
        if(comp!==want){ ctx.globalCompositeOperation=want; comp=want; }
        const fr=Math.max(0, p.life/p.total); // 1 fresh → 0 dying
        const r=TILE*(0.25 + (1-fr)*0.65)*(p.scale||1);
        const set=spriteCache[p.kind]||spriteCache.flame;
        const sp= fr>0.6? set.hot : fr>0.3? set.mid : set.tail;
        ctx.globalAlpha= fr>0.3? 1 : Math.max(0, fr/0.3);
        ctx.drawImage(sp, p.x*TILE-r, p.y*TILE-r, r*2, r*2);
      }
      ctx.globalAlpha=1;
      ctx.restore();
    }
    if(electricBeams.length){
      const now=(typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
      ctx.save();
      ctx.globalCompositeOperation='lighter';
      ctx.lineCap='round';
      ctx.lineJoin='round';
      for(const b of electricBeams){
        const mx=(b.x1+b.x2)*0.5, my=(b.y1+b.y2)*0.5;
        if(!tileVisible(b.x1,b.y1) && !tileVisible(mx,my) && !tileVisible(b.x2,b.y2)) continue;
        const life=Math.max(0.001,b.life||0.18);
        const age=Math.max(0,Math.min(1,(b.t||0)/life));
        const alpha=(1-age)*(b.hit?1.15:1);
        const dx=b.x2-b.x1, dy=b.y2-b.y1, len=Math.hypot(dx,dy)||1;
        const nx=dx/len, ny=dy/len, px=-ny, py=nx;
        const wob=(b.phase||0)+now*0.026;
        function jaggedPath(offsetAmp){
          ctx.beginPath();
          ctx.moveTo(b.x1*TILE,b.y1*TILE);
          const segs=Math.max(3,Math.min(11,Math.ceil(len*1.3)));
          for(let i=1;i<segs;i++){
            const t=i/segs;
            const bend=(Math.sin(wob+i*1.93)+Math.sin(wob*0.67+i*3.11))*0.5*offsetAmp*(1-Math.abs(0.5-t)*0.85);
            const x=(b.x1+nx*len*t+px*bend)*TILE;
            const y=(b.y1+ny*len*t+py*bend)*TILE;
            ctx.lineTo(x,y);
          }
          ctx.lineTo(b.x2*TILE,b.y2*TILE);
        }
        const scale=Math.max(0.75,Math.min(2.5,b.power||1));
        ctx.globalAlpha=Math.min(0.42,0.20*alpha);
        ctx.strokeStyle='#38f7ff';
        ctx.lineWidth=TILE*(0.42+0.12*scale);
        jaggedPath(0.10*scale); ctx.stroke();
        ctx.globalAlpha=Math.min(0.92,0.68*alpha);
        ctx.strokeStyle=b.hit?'#dffcff':'#78eeff';
        ctx.lineWidth=TILE*(0.16+0.035*scale);
        jaggedPath(0.055*scale); ctx.stroke();
        ctx.globalAlpha=Math.min(1,0.98*alpha);
        ctx.strokeStyle='#ffffff';
        ctx.lineWidth=Math.max(1.2,TILE*0.045);
        jaggedPath(0.018*scale); ctx.stroke();
        if(b.hit || b.blocked){
          const r=TILE*(0.22+0.12*scale)*(1+age*0.55);
          ctx.globalAlpha=Math.min(0.85,0.65*alpha);
          ctx.strokeStyle=b.hit?'#f1ffff':'#96f6ff';
          ctx.lineWidth=Math.max(1,TILE*0.06);
          ctx.beginPath(); ctx.arc(b.x2*TILE,b.y2*TILE,r,0,Math.PI*2); ctx.stroke();
        }
      }
      ctx.restore();
    }
    drawStoneHeat(ctx,TILE,tileVisible);
    drawSandHeat(ctx,TILE,tileVisible);
    // Explosion shockwave rings
    if(blastsFx.length){
      ctx.save();
      for(const b of blastsFx){
        if(!tileVisible(b.x,b.y)) continue;
        const fr=b.t/b.max;                 // 0 → 1 over the blast's life
        const r=(0.4+fr*1.6)*b.R*TILE;
        ctx.lineWidth=4*(1-fr)+1;
        ctx.strokeStyle='rgba(255,235,180,'+(0.9*(1-fr)).toFixed(2)+')';
        ctx.beginPath(); ctx.arc(b.x*TILE,b.y*TILE,r,0,Math.PI*2); ctx.stroke();
        ctx.lineWidth=2*(1-fr)+0.5;
        ctx.strokeStyle='rgba(255,120,40,'+(0.7*(1-fr)).toFixed(2)+')';
        ctx.beginPath(); ctx.arc(b.x*TILE,b.y*TILE,r*0.7,0,Math.PI*2); ctx.stroke();
      }
      ctx.restore();
    }
    // Melee slash arc at the struck tile
    if(swing.t>0){
      if(!tileVisible(swing.tx,swing.ty)) return;
      const a=swing.t/swing.dur;
      const cx=(swing.tx+0.5)*TILE, cy=(swing.ty+0.5)*TILE;
      const base=swing.dir===1? -0.8 : Math.PI+0.8;
      const sweep=(1-a)*1.9*swing.dir;
      ctx.save();
      ctx.lineCap='round';
      ctx.strokeStyle='rgba(255,255,255,'+(0.75*a).toFixed(2)+')';
      ctx.lineWidth=3;
      ctx.beginPath(); ctx.arc(cx,cy,TILE*0.78, base-0.6+sweep, base+0.25+sweep); ctx.stroke();
      ctx.strokeStyle='rgba(255,255,255,'+(0.4*a).toFixed(2)+')';
      ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.arc(cx,cy,TILE*0.52, base-0.5+sweep, base+0.18+sweep); ctx.stroke();
      ctx.restore();
    }
  }
  // The equipped weapon in the hero's hand (world space, called after drawPlayer).
  // Melee blades sweep forward during a swing so hits read on the character too.
  function drawHeld(ctx,TILE,player){
    const it=equippedWeapon(); if(!it) return;
    const type=weaponType(it);
    const facing=(player.facing>=0)?1:-1;
    const bw=player.w*TILE, bh=player.h*TILE;
    const col=tierColor(it);
    ctx.save();
    ctx.translate(player.x*TILE + facing*(bw*0.5+1), player.y*TILE + bh*0.10);
    if(type==='melee'){
      const prog= swing.t>0? 1-swing.t/swing.dur : 0;
      const ang= facing*(-0.5 + (swing.t>0? (-1.3+2.1*prog) : 0));
      ctx.rotate(ang);
      ctx.fillStyle='#e9eef8'; ctx.fillRect(-1,-12,2,12);
      ctx.beginPath(); ctx.moveTo(-1,-12); ctx.lineTo(0,-15); ctx.lineTo(1,-12); ctx.closePath(); ctx.fill();
      ctx.fillStyle=col||'#cfd6e4'; ctx.fillRect(-2.6,0,5.2,1.6);
      ctx.fillStyle='#6e4a22'; ctx.fillRect(-0.9,1.6,1.8,3.4);
    } else if(type==='bow'){
      ctx.strokeStyle=col||'#9a6a32'; ctx.lineWidth=1.6; ctx.lineCap='round';
      const a0=facing===1? -1.15 : Math.PI-1.15, a1=facing===1? 1.15 : Math.PI+1.15;
      ctx.beginPath(); ctx.arc(0,-2,6,a0,a1); ctx.stroke();
      ctx.strokeStyle='#e8e2d2'; ctx.lineWidth=0.8;
      const ex=Math.cos(1.15)*6*facing, ey=Math.sin(1.15)*6;
      ctx.beginPath(); ctx.moveTo(ex,-2-ey); ctx.lineTo(ex,-2+ey); ctx.stroke();
    } else {
      // stream device: body + nozzle tinted by class, with a faint idle wisp
      const tint= type==='flame'? '#b35324' : type==='hose'? '#2c7ef8' : type==='electric'? '#53e9ff' : '#4d9230';
      ctx.fillStyle='#3c414d'; ctx.fillRect(facing===1?-2:-4.5, -4, 6.5, 3);
      ctx.fillStyle=col||tint; ctx.fillRect(facing===1?4.5:-6.5, -3.7, 2.2, 2.4);
      ctx.fillStyle='#6e4a22'; ctx.fillRect(facing===1?-0.5:-1.5, -1, 2, 3.4);
      ctx.globalAlpha=0.5;
      ctx.fillStyle=tint;
      ctx.fillRect(facing===1?7:-9, -3.4, 2, 1.8);
      ctx.globalAlpha=1;
    }
    ctx.restore();
  }
  // Baked radial sprites per stream kind: a per-puff createRadialGradient at up to
  // 220 puffs × 60fps caused constant allocation churn — stamp these instead.
  let spriteCache=null;
  function buildPuffSprites(){
    function mk(stops){
      const S=32, c=document.createElement('canvas'); c.width=c.height=S*2;
      const g=c.getContext('2d');
      const gr=g.createRadialGradient(S,S,1,S,S,S);
      stops.forEach(([t,col])=>gr.addColorStop(t,col));
      g.fillStyle=gr; g.beginPath(); g.arc(S,S,S,0,Math.PI*2); g.fill();
      return c;
    }
    spriteCache={
      flame:{
        hot:  mk([[0,'rgba(255,245,200,0.85)'],[0.5,'rgba(255,180,60,0.55)'],[1,'rgba(255,90,20,0)']]),
        mid:  mk([[0,'rgba(255,170,60,0.6)'],[1,'rgba(230,70,20,0)']]),
        tail: mk([[0,'rgba(120,90,70,0.35)'],[1,'rgba(80,60,50,0)']])
      },
      hose:{
        hot:  mk([[0,'rgba(225,245,255,0.9)'],[0.5,'rgba(140,195,255,0.6)'],[1,'rgba(60,120,230,0)']]),
        mid:  mk([[0,'rgba(150,200,255,0.65)'],[1,'rgba(60,110,220,0)']]),
        tail: mk([[0,'rgba(140,180,230,0.4)'],[1,'rgba(90,130,200,0)']])
      },
      gas:{
        hot:  mk([[0,'rgba(215,255,170,0.75)'],[0.5,'rgba(150,230,90,0.5)'],[1,'rgba(80,160,40,0)']]),
        mid:  mk([[0,'rgba(140,220,90,0.55)'],[1,'rgba(70,150,40,0)']]),
        tail: mk([[0,'rgba(95,145,65,0.45)'],[1,'rgba(50,90,40,0)']])
      },
      steam:{
        hot:  mk([[0,'rgba(255,255,255,0.7)'],[0.6,'rgba(225,232,240,0.4)'],[1,'rgba(210,220,230,0)']]),
        mid:  mk([[0,'rgba(235,240,246,0.5)'],[1,'rgba(210,220,230,0)']]),
        tail: mk([[0,'rgba(220,228,236,0.3)'],[1,'rgba(205,215,228,0)']])
      }
    };
  }

  function reset(){ arrows.length=0; puffs.length=0; electricBeams.length=0; flameHeatRays.length=0; blastsFx.length=0; stoneHeat.clear(); sandHeat.clear(); heatForgedGlass.clear(); streamFuelDebt.flame=0; streamFuelDebt.hose=0; streamFuelDebt.gas=0; bowCd=0; meleeCd=0; electricCd=0; bossAcc=0; explodeCd=0; heroFlameHitCd=0; iridiumPierces=0; ultCharge=1; lastGetTile=null; lastSetTile=null; swing.t=0; }
  MM.weapons={fireHeld,fireUlt,update,draw,drawHeld,notifyMeleeSwing,reset,explodeAt,spawnGasCloud,spawnExternalStream,
    metrics:()=>({arrows:arrows.length,puffs:puffs.length,electricBeams:electricBeams.length,arrowAmmo:arrowAmmoCounts(),ultCharge,stoneHeat:stoneHeat.size,stoneHeatMax:stoneHeatMaxRatio(),sandHeat:sandHeat.size,sandHeatMax:sandHeatMaxRatio(),iridiumPierces}),
    _debug:{arrows,puffs,electricBeams,arrowTiers:ARROW_TIERS}};
})();
// ESM export (progressive migration)
export const weapons = (typeof window!=='undefined' && window.MM) ? window.MM.weapons : undefined;
export default weapons;
