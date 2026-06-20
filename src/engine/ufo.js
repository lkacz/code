// UFO visitor: every 2-3 in-game days a procedurally generated saucer descends,
// scans for a living victim — an animal, the hero, even a boss — locks a tractor
// beam and flies away with the catch. The hull is heavily shielded (incoming
// damage is dampened) but the shield must drop while the beam runs: that window
// is the intended counterplay. Destroying it pays out antimatter, alien machine
// scrap and sometimes a unique alien artifact routed through the regular loot
// inbox.
//
// Architecture notes:
// - A beamed MOB stays inside mobs.js physics during the lift (this module only
//   overrides its velocity/position after mobs.update has run — main.js calls
//   ufo.update last), and is detached via mobs.abduct() only at the hatch, so a
//   shot-down saucer drops the animal alive and unharmed.
// - The HERO is never detached: the beam is a physical pull the player can
//   out-run sideways; a swallowed hero is carried far and released (a souvenir
//   crumb of antimatter softens the trip).
// - A BOSS is too big to lift piecemeal: the beam charges over its body and the
//   whole rigid body is dematerialized through bosses.abduct() at completion.
// Schedule persists in mm_ufo_v1; the saucer itself is transient (no save).
const ufo = (function(){
  const MM = window.MM = window.MM || {};
  const SAVE_KEY='mm_ufo_v1';
  const DAY_SEC=600;
  const CFG={
    MIN_DAYS:2, MAX_DAYS:3,     // visit cadence (first visit comes at half the wait)
    HP_BASE:150,                // scaled by hull size and seed
    SHIELD_DR:0.35,             // damage multiplier while shielded
    BEAM_VULN:2.0,              // damage multiplier while the beam is on
    HOVER_ALT:9,                // tiles above the surface while scanning/beaming
    LIFT_SPEED:2.1,             // victim rise, tiles/s
    BEAM_HALF:1.4,              // horizontal beam half-width (hero escape line)
    BOSS_CHARGE:4.5,            // seconds of beam needed to dematerialize a boss
    CARRY_MIN:70, CARRY_MAX:130 // hero deportation distance, tiles
  };

  let craft=null;               // the single active saucer
  let acc=0, saveAcc=0, nextAt=0, visits=0;

  function mulberry32(a){ a=a>>>0; return function(){ a|=0; a=(a+0x6D2B79F5)|0; let t=Math.imul(a^(a>>>15),1|a); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }
  function rollNext(){ nextAt=(CFG.MIN_DAYS+Math.random()*(CFG.MAX_DAYS-CFG.MIN_DAYS))*DAY_SEC*(visits===0?0.5:1); }
  (function load(){
    try{
      const raw=localStorage.getItem(SAVE_KEY); if(!raw) return;
      const d=JSON.parse(raw); if(!d||typeof d!=='object') return;
      if(typeof d.acc==='number' && isFinite(d.acc)) acc=Math.max(0,d.acc);
      if(typeof d.visits==='number') visits=Math.max(0,d.visits|0);
      if(typeof d.nextAt==='number' && isFinite(d.nextAt) && d.nextAt>0) nextAt=d.nextAt;
    }catch(e){}
  })();
  if(!(nextAt>0)) rollNext();
  function save(){ try{ localStorage.setItem(SAVE_KEY, JSON.stringify({acc:Math.round(acc), nextAt:Math.round(nextAt), visits})); }catch(e){} }
  function snapshot(){ return {v:1, acc:Math.round(acc), nextAt:Math.round(nextAt), visits:Math.max(0,visits|0)}; }
  function restore(data){
    craft=null;
    if(!data || typeof data!=='object') return false;
    acc=(typeof data.acc==='number' && isFinite(data.acc)) ? Math.max(0,data.acc) : 0;
    visits=(typeof data.visits==='number' && isFinite(data.visits)) ? Math.max(0,data.visits|0) : 0;
    nextAt=(typeof data.nextAt==='number' && isFinite(data.nextAt) && data.nextAt>0) ? data.nextAt : 0;
    if(!(nextAt>0)) rollNext();
    save();
    return true;
  }
  function clearActive(){ craft=null; }

  function say(t){ try{ if(typeof window!=='undefined' && window.msg) window.msg(t); }catch(e){} }
  function sfx(n){ try{ if(MM.audio && MM.audio.play) MM.audio.play(n); }catch(e){} }
  function surfaceY(x, fallback){ try{ const wg=MM.worldGen; if(wg && wg.surfaceHeight) return wg.surfaceHeight(Math.round(x)); }catch(e){} return (typeof fallback==='number'? fallback : 60); }
  function burst(x,y,tier){ try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(x*(MM.TILE||20), y*(MM.TILE||20), tier||'epic'); }catch(e){} }
  function drainHeroEnergy(pl){
    let drained=0;
    try{
      if(MM.heroEnergy && typeof MM.heroEnergy.drain==='function'){
        drained=Number(MM.heroEnergy.drain({cause:'ufo'}))||0;
      }
    }catch(e){}
    if(!(drained>0) && pl && typeof pl.energy==='number' && pl.energy>0){
      drained=pl.energy;
      pl.energy=0;
    }
    return drained;
  }

  const SCRAP_NAMES={
    teleporter:'teleporter',
    transistor:'tranzystor',
    copperWire:'przewod miedziany',
    wire:'przewody',
    copper:'miedz',
    plastic:'plastik',
    steel:'stal'
  };
  function addResource(inv,key,n){
    const amount=Math.max(0, Math.floor(Number(n)||0));
    if(!inv || !key || amount<=0) return 0;
    inv[key]=Math.max(0, Number(inv[key])||0)+amount;
    return amount;
  }
  function rollScrapDrops(seed){
    const r=mulberry32((seed^0x71e7)>>>0);
    const drops=[
      {key:'teleporter', n:1},
      {key:'transistor', n:1+((r()*2)|0)},
      {key:'copperWire', n:4+((r()*5)|0)}
    ];
    if(r()<0.75) drops.push({key:'wire', n:2+((r()*3)|0)});
    if(r()<0.55) drops.push({key:'copper', n:1+((r()*3)|0)});
    if(r()<0.45) drops.push({key:'plastic', n:1+((r()*2)|0)});
    if(r()<0.35) drops.push({key:'steel', n:1+((r()*2)|0)});
    return drops;
  }
  function addScrapDrops(inv,drops){
    const got=[];
    for(const d of drops||[]){
      const n=addResource(inv,d.key,d.n);
      if(n>0) got.push({key:d.key,n});
    }
    return got;
  }
  function formatDrops(drops){
    return (drops||[]).map(d=>(SCRAP_NAMES[d.key]||d.key)+' x'+d.n).join(', ');
  }
  function compactDrops(drops){
    const sums=new Map();
    for(const d of drops||[]){
      if(!d || !d.key) continue;
      sums.set(d.key,(sums.get(d.key)||0)+(Math.max(0,Math.floor(Number(d.n)||0))));
    }
    const out=[];
    for(const [key,n] of sums) if(n>0) out.push({key,n});
    return out;
  }
  function tileForScrap(key){
    const TT=MM.T||{};
    if(key==='teleporter') return TT.TELEPORTER;
    if(key==='transistor') return TT.TRANSISTOR;
    if(key==='copperWire') return TT.COPPER_WIRE;
    if(key==='wire') return TT.WIRE;
    if(key==='steel') return TT.STEEL;
    return null;
  }
  function dropCellFree(t){
    const TT=MM.T||{}, info=(MM.INFO||{})[t];
    return t===TT.AIR || (info && info.gas);
  }
  function dropCellSupported(t){
    const TT=MM.T||{}, info=(MM.INFO||{})[t];
    return t!==TT.AIR && !(info && info.passable);
  }
  function findScrapLanding(x,y0,used,getTile){
    const maxY=Math.max(0,(MM.WORLD_H||140)-4);
    const start=Math.max(0,Math.min(maxY,Math.floor(y0)));
    const tx=Math.floor(x);
    for(let y=start; y<=maxY; y++){
      const k=tx+','+y;
      if(used.has(k)) continue;
      if(dropCellFree(getTile(tx,y)) && dropCellSupported(getTile(tx,y+1))) return {x:tx,y};
    }
    return null;
  }
  function scatterScrapDrops(origin,drops){
    const W=MM.world;
    if(!origin || !W || typeof W.getTile!=='function' || typeof W.setTile!=='function'){
      return {placed:[], remaining:compactDrops(drops)};
    }
    const offsets=[0,-1,1,-2,2,-3,3,-4,4,-5,5,-6,6,-7,7,-8,8,-9,9,-10,10];
    const placed=[], remaining=[], used=new Set();
    let idx=0;
    for(const d of compactDrops(drops)){
      const tile=tileForScrap(d.key);
      let left=d.n;
      while(tile!=null && left>0 && idx<offsets.length){
        const spot=findScrapLanding(Math.floor(origin.x)+offsets[idx], origin.y, used, W.getTile);
        idx++;
        if(!spot) continue;
        W.setTile(spot.x,spot.y,tile);
        used.add(spot.x+','+spot.y);
        placed.push({key:d.key,n:1});
        left--;
      }
      if(left>0) remaining.push({key:d.key,n:left});
    }
    return {placed:compactDrops(placed), remaining:compactDrops(remaining)};
  }
  function sparkleScrap(origin,placed){
    if(!placed || !placed.length) return;
    const W=MM.world, TT=MM.T||{};
    if(!W || typeof W.getTile!=='function') return;
    const wanted=new Set();
    for(const d of placed){
      const tile=tileForScrap(d.key);
      if(tile!=null) wanted.add(tile);
    }
    if(!wanted.size) return;
    const ox=Math.floor(origin && origin.x || 0);
    const oy=Math.floor(origin && origin.y || 0);
    let flashes=0;
    for(let dx=-10; dx<=10 && flashes<8; dx++){
      for(let y=Math.max(0,oy); y<Math.min((MM.WORLD_H||140)-3,oy+40) && flashes<8; y++){
        const t=W.getTile(ox+dx,y);
        if(!wanted.has(t)) continue;
        burst(ox+dx+0.5,y+0.5,t===TT.TELEPORTER?'epic':'rare');
        flashes++;
      }
    }
  }

  // --- Procedural saucer: same seed → same craft ---
  const HULLS=['#9fb2c8','#7d8aa0','#b8a06a','#6f7d8f','#8a7da6'];
  const TRIMS=['#3de1c5','#ffd24a','#ff5ad1','#9dff57','#6bc7ff'];
  const ARCHE=['Zwiadowca','Kolekcjoner','Badacz','Żniwiarz','Turysta'];
  function generate(seed){
    const r=mulberry32(seed);
    const archetype=ARCHE[(r()*ARCHE.length)|0];
    const hullW=3.4+r()*2.2, hullH=hullW*(0.30+r()*0.10);
    const look={
      seed, archetype, hullW, hullH,
      hullColor:HULLS[(r()*HULLS.length)|0],
      dome:(r()*3)|0,            // 0 glass / 1 amber / 2 violet
      occupant:(r()*3)|0,        // 0 gray alien / 1 tentacles / 2 brain
      lights:4+((r()*5)|0),
      lightColor:TRIMS[(r()*TRIMS.length)|0],
      fins:(r()*3)|0,
      blink:0.6+r()*1.4,
      speed:7+r()*4,
      name:'Spodek „'+archetype+'” '+String.fromCharCode(65+((r()*26)|0))+'-'+(10+((r()*90)|0)),
    };
    look.hp=Math.round(CFG.HP_BASE*(0.85+r()*0.5)*(hullW/4.2));
    return look;
  }

  function playerRef(){ return (typeof window!=='undefined' && window.player)||null; }

  function forceSpawn(opts){
    if(craft) return null;
    const pl=playerRef(); if(!pl) return null;
    const seed=(opts && typeof opts.seed==='number')? (opts.seed>>>0) : ((Math.random()*1e9)|0);
    const look=generate(seed);
    const side=Math.random()<0.5?-1:1;
    const sx=pl.x + side*(45+Math.random()*20);
    craft={
      look, hp:look.hp, maxHp:look.hp,
      x:sx, y:surfaceY(sx, pl.y)-16,
      vx:0, t:0, phase:'approach', phaseT:0,
      victim:null, beamY:0, charge:0, retries:0,
      carried:0, carryDir:0, carryDist:0,
      hitFlash:0, beamHum:0,
      prefer:(opts && opts.prefer)||null,
      trophy:null,
    };
    say('🛸 '+look.name+' nadlatuje! Coś skanuje okolicę...');
    sfx('ufo');
    return craft;
  }

  // a nearby boss is the most spectacular catch; otherwise the closest animal; the hero as a fallback
  function pickVictim(pl){
    const want=craft.prefer;
    try{
      const B=MM.bosses;
      if(B && B.nearestForAbduction && want!=='mob' && want!=='hero'){
        const b=B.nearestForAbduction(craft.x, 30);
        if(b && (want==='boss' || Math.random()<0.5)) return {kind:'boss', boss:b};
      }
    }catch(e){}
    try{
      const Mo=MM.mobs;
      if(Mo && Mo.nearestLiving && want!=='hero' && want!=='boss'){
        const m=Mo.nearestLiving(craft.x, craft.y, 26, {exclude:['ZLOTY']});
        if(m) return {kind:'mob', mob:m};
      }
    }catch(e){}
    if(pl && pl.hp>0) return {kind:'hero'};
    return null;
  }

  // the hatch is open (shield down) both while beaming and while hauling the hero
  function beaming(){ return !!craft && (craft.phase==='beam' || craft.phase==='carry'); }

  // Incoming hits from melee/arrows/streams/blasts. Tile coords; generous AABB
  // (the dome counts). Shield dampens damage except while the beam is running.
  function damageAt(tx,ty,dmg){
    if(!craft) return false;
    if(!Number.isFinite(tx) || !Number.isFinite(ty)) return false;
    const hw=craft.look.hullW*0.5+0.6, hh=craft.look.hullH*0.5+1.0;
    if(Math.abs(tx+0.5-craft.x)>hw || Math.abs(ty+0.5-craft.y)>hh) return false;
    const mult = beaming()? CFG.BEAM_VULN : CFG.SHIELD_DR;
    const amount=Math.max(0.5,(typeof dmg==='number'&&isFinite(dmg))? dmg:1)*mult;
    craft.hp-=amount; craft.hitFlash=0.15;
    if(!beaming() && !craft._shieldHinted){ craft._shieldHinted=true; say('🛸 Tarcza pochłania ciosy — uderzaj, gdy wiązka jest włączona!'); }
    if(craft.hp<=0) destroy();
    return true;
  }
  function attackAt(tx,ty,bonus){ return damageAt(tx,ty, 3+((typeof bonus==='number'&&isFinite(bonus)&&bonus>0)?bonus:0)); }

  function releaseVictim(){
    const v=craft && craft.victim;
    if(v && v.kind==='mob' && v.mob){ v.mob.vy=0; } // gravity takes it home unharmed
    if(craft) craft.victim=null;
  }

  // The wreck pays out: antimatter and machine scrap always, an alien artifact often
  function destroy(){
    const c=craft; if(!c) return;
    releaseVictim();
    const pl=playerRef();
    if(c.phase==='carry' && pl){ pl.vy=-1.5; say('🛸 Uwolniony w locie — spodek runął!'); }
    const inv=(typeof window!=='undefined' && window.inv)||null;
    const n=2+((Math.random()*3)|0);
    addResource(inv,'antimatter',n);
    const scattered=scatterScrapDrops({x:c.x,y:c.y}, rollScrapDrops(c.look.seed));
    sparkleScrap({x:c.x,y:c.y}, scattered.placed);
    const scrap=addScrapDrops(inv, scattered.remaining);
    const allScrap=compactDrops([...(scattered.placed||[]), ...scrap]);
    const scrapMsg=allScrap.length? ' | Technologia: '+formatDrops(allScrap) : '';
    let artMsg='';
    if(Math.random()<0.65){
      const r=mulberry32(c.look.seed^0x5eed);
      const roll=r();
      let item;
      if(roll<0.45) item={id:'ufo_charm_'+c.look.seed.toString(36), kind:'charm', tier:'epic', name:'Talizman Obcych', unique:'alien_core', moveSpeedMult:1.08, visionRadius:13, attackDamage:2, desc:'Pulsuje nieziemskim światłem. Ruch +8%, zasięg widzenia 13, obrażenia +2'};
      else if(roll<0.75) item={id:'ufo_eyes_'+c.look.seed.toString(36), kind:'eyes', tier:'epic', name:'Oko Szaraka', unique:'alien_sight', visionRadius:15, mineSpeedMult:1.1, desc:'Widzi przez mrok kosmosu. Zasięg widzenia 15, kopanie +10%'};
      else item={id:'ufo_bow_'+c.look.seed.toString(36), kind:'weapon', weaponType:'bow', tier:'epic', name:'Dezintegrator', unique:'alien_tech', attackDamage:8, fireCooldown:0.3, desc:'Broń z rozbitego spodka. Strzały 8 obrażeń, szybkostrzelność x2'};
      try{
        if(roll>=0.82) item={id:'ufo_antigrav_'+c.look.seed.toString(36), kind:'charm', tier:'epic', name:'Stabilizator antygrawitacji', unique:'alien_antigrav', airJumps:1, moveSpeedMult:1.1, energyCapacityBonus:50, desc:'Pole z rozbitego spodka. +1 skok, ruch +10%, energia +50E'};
        if(!MM.dynamicLoot) MM.dynamicLoot={capes:[],eyes:[],outfits:[],weapons:[],charms:[]};
        const key=item.kind==='eyes'?'eyes':item.kind==='weapon'?'weapons':'charms';
        if(!Array.isArray(MM.dynamicLoot[key])) MM.dynamicLoot[key]=[];
        MM.dynamicLoot[key].push(item);
        if(MM.chests && MM.chests.saveDynamicLoot) MM.chests.saveDynamicLoot();
        if(MM.onLootGained) MM.onLootGained([item],'epic');
        artMsg=' i '+item.name+'!';
      }catch(e){}
    }
    artMsg=scrapMsg+artMsg;
    if(pl && typeof pl.xp==='number') pl.xp+=120;
    burst(c.x,c.y,'epic'); burst(c.x-1.5,c.y+0.5,'epic'); burst(c.x+1.5,c.y+0.5,'epic');
    sfx('explosion');
    say('💥 '+c.look.name+' zestrzelony! Antymateria ×'+n+artMsg+' (+120 XP)');
    if(typeof window!=='undefined' && window.updateInventoryHud) try{ window.updateInventoryHud(); }catch(e){}
    craft=null;
    acc=0; rollNext(); save();
  }

  function leaveWith(label){
    craft.phase='leave'; craft.phaseT=0;
    if(label) say('🛸 '+craft.look.name+' odlatuje z łupem: '+label+'!');
  }

  function update(dt, player){
    if(!(dt>0) || !isFinite(dt)) return;
    // visit clock (counts played time, persists across reloads)
    acc+=dt; saveAcc+=dt;
    if(saveAcc>=10){ saveAcc=0; save(); }
    if(!craft && acc>=nextAt){ visits++; save(); forceSpawn(); }
    const c=craft; if(!c) return;
    const pl=player||playerRef(); if(!pl){ craft=null; return; }
    c.t+=dt; c.phaseT+=dt;
    if(c.hitFlash>0) c.hitFlash-=dt;
    const surf=surfaceY(c.x, pl.y);
    const hoverY=surf-CFG.HOVER_ALT;

    if(c.phase==='approach'){
      // glide in toward the airspace above the hero
      const dx=pl.x-c.x;
      c.vx=Math.sign(dx)*Math.min(c.look.speed, Math.abs(dx)*1.2);
      c.x+=c.vx*dt;
      c.y+=(hoverY-c.y)*Math.min(1,dt*1.2);
      if(Math.abs(dx)<6){ c.phase='scan'; c.phaseT=0; }
      if(c.phaseT>30) leaveWith(null); // can't reach (shouldn't happen)
    }
    else if(c.phase==='scan'){
      c.y+=(hoverY-c.y)*Math.min(1,dt*1.5);
      c.x+=Math.sin(c.t*0.8)*dt*2; // searching drift
      if(c.phaseT>2.2){
        const v=pickVictim(pl);
        if(!v){ leaveWith(null); say('🛸 Obcy nie znaleźli nic ciekawego i odlatują.'); }
        else{
          c.victim=v; c.phase='beam'; c.phaseT=0; c.charge=0;
          const what=v.kind==='boss'? 'GIGANTYCZNY OKAZ' : v.kind==='hero'? 'CIEBIE' : 'zwierzę';
          say('🛸 Wiązka namierzyła '+what+'! (tarcza opuszczona — ognia!)');
          sfx('beam');
        }
      }
    }
    else if(c.phase==='beam'){
      const v=c.victim;
      c.beamHum+=dt; if(c.beamHum>0.5){ c.beamHum=0; sfx('beam'); }
      if(!v){ c.phase='scan'; c.phaseT=0; }
      else if(v.kind==='mob'){
        const m=v.mob;
        if(!m || m.hp<=0){ c.victim=null; c.phase='scan'; c.phaseT=0; }
        else{
          // hover over the prey, then lift it (runs after mobs.update, so these
          // overrides win the frame; gravity resumes the instant we let go)
          c.x+=(m.x-c.x)*Math.min(1,dt*2.5);
          c.y+=(hoverY-c.y)*Math.min(1,dt*1.5);
          m.vx=0; m.vy=0;
          m.x+=(c.x-m.x)*Math.min(1,dt*3);
          m.y-=CFG.LIFT_SPEED*dt;
          if(Math.random()<0.1) m.facing*=-1; // helpless wriggle
          if(m.y<=c.y+1.0){
            try{ if(MM.mobs && MM.mobs.abduct) MM.mobs.abduct(m); }catch(e){}
            burst(c.x,c.y+1,'common');
            c.trophy=m.id;
            leaveWith(m.id);
          }
        }
      }
      else if(v.kind==='hero'){
        if(pl.hp<=0){ c.victim=null; c.phase='scan'; c.phaseT=0; }
        else{
          c.x+=(pl.x-c.x)*Math.min(1,dt*2.2);
          c.y+=(hoverY-c.y)*Math.min(1,dt*1.5);
          const dx=pl.x-c.x;
          // first line up over the hero; the escape rule only applies once locked
          if(!v.locked){
            if(Math.abs(dx)<CFG.BEAM_HALF*0.7) v.locked=true;
            else if(c.phaseT>8){ c.victim=null; c.phase='scan'; c.phaseT=0; } // couldn't line up
          }
          else if(Math.abs(dx)>CFG.BEAM_HALF+1.0){
            // the hero out-ran the beam cone
            c.retries++; c.victim=null;
            if(c.retries>1){ leaveWith(null); say('🛸 Wyrwałeś się! Obcy rezygnują i odlatują.'); }
            else{ c.phase='scan'; c.phaseT=0; say('🛸 Wyrwałeś się z wiązki! Spodek szuka dalej...'); }
          }
          if(c.victim && v.locked){
            pl.vx+=(c.x-pl.x)*1.6*dt;             // gentle centering — sprint sideways to escape
            pl.vy=Math.min(pl.vy,-2.6);            // steady upward drag
            if(pl.y<=c.y+1.2){
              c.phase='carry'; c.phaseT=0;
              c.carryDir=Math.random()<0.5?-1:1;
              c.carryDist=CFG.CARRY_MIN+Math.random()*(CFG.CARRY_MAX-CFG.CARRY_MIN);
              c.carried=0;
              drainHeroEnergy(pl);
              say('🛸 PORWANY! Obcy zabierają cię na badania...');
            }
          }
        }
      }
      else if(v.kind==='boss'){
        const b=v.boss;
        if(!b || b.dead){ c.victim=null; c.phase='scan'; c.phaseT=0; }
        else{
          c.x+=(b.x-c.x)*Math.min(1,dt*2.0);
          c.y+=(hoverY-c.y)*Math.min(1,dt*1.5);
          if(Math.abs(b.x-c.x)>40){ c.victim=null; c.phase='scan'; c.phaseT=0; }
          else{
            c.charge+=dt;
            if(c.charge>=CFG.BOSS_CHARGE){
              let name=null;
              try{ if(MM.bosses && MM.bosses.abduct && MM.bosses.abduct(b)) name=b.name; }catch(e){}
              burst(c.x,c.y+2,'epic');
              if(name){ c.trophy=name; leaveWith('potwór '+name); }
              else { c.victim=null; c.phase='scan'; c.phaseT=0; }
            }
          }
        }
      }
    }
    else if(c.phase==='carry'){
      // deportation flight: the hero dangles under the hull until released
      c.vx=c.carryDir*12;
      c.x+=c.vx*dt;
      c.y+=((surf-14)-c.y)*Math.min(1,dt*1.2);
      c.carried+=Math.abs(c.vx)*dt;
      pl.x=c.x; pl.y=c.y+1.3; pl.vx=c.vx; pl.vy=0;
      if(c.carried>=c.carryDist){
        pl.vy=0; pl.vx=c.vx*0.3;
        const inv=(typeof window!=='undefined' && window.inv)||null;
        if(inv && typeof inv.antimatter==='number'){ inv.antimatter+=1; try{ if(window.updateInventoryHud) window.updateInventoryHud(); }catch(e){} }
        say('🛸 Obcy przebadali cię i wyrzucili... W kieszeni została grudka antymaterii!');
        leaveWith(null);
      }
    }
    else if(c.phase==='leave'){
      const accel=Math.min(1,c.phaseT*0.5);
      c.vx=(c.vx===0? (Math.random()<0.5?-1:1)*c.look.speed : Math.sign(c.vx)*c.look.speed)*(1+accel*1.5);
      c.x+=c.vx*dt;
      c.y-=(2+accel*6)*dt;
      if(Math.abs(c.x-pl.x)>140 || c.y<surf-60){
        craft=null;
        acc=0; rollNext(); save();
      }
    }
  }

  // --- Rendering (browser only; world-space, same transform as mobs.draw) ---
  function draw(ctx, TILE, canDrawTile){
    const c=craft; if(!c || typeof document==='undefined') return;
    if(typeof canDrawTile === 'function' && !canDrawTile(Math.floor(c.x), Math.floor(c.y))) return;
    const L=c.look, now=performance.now();
    const px=c.x*TILE, py=(c.y+Math.sin(c.t*2)*0.15)*TILE;
    const hw=L.hullW*0.5*TILE, hh=L.hullH*0.5*TILE;
    ctx.save();
    // tractor beam first, under the hull
    if(c.phase==='beam' || c.phase==='carry'){
      let tyPx;
      const v=c.victim;
      if(c.phase==='carry') tyPx=py+TILE*2.2;
      else if(v && v.kind==='mob' && v.mob) tyPx=v.mob.y*TILE+TILE*0.6;
      else if(v && v.kind==='boss' && v.boss) tyPx=v.boss.y*TILE+TILE*2;
      else tyPx=surfaceY(c.x)*TILE;
      const bw=CFG.BEAM_HALF*TILE;
      const g=ctx.createLinearGradient(px,py,px,tyPx);
      const col=L.lightColor;
      g.addColorStop(0, col+'cc'); g.addColorStop(1, col+'11');
      ctx.fillStyle=g;
      ctx.beginPath();
      ctx.moveTo(px-bw*0.35,py+hh*0.6); ctx.lineTo(px-bw,tyPx); ctx.lineTo(px+bw,tyPx); ctx.lineTo(px+bw*0.35,py+hh*0.6);
      ctx.closePath(); ctx.fill();
      // rising shimmer rings
      for(let i=0;i<3;i++){
        const f=1-((c.t*0.7+i*0.33)%1);
        const ry=py+hh*0.6+(tyPx-py-hh*0.6)*f;
        const rw=bw*(0.4+0.6*f);
        ctx.strokeStyle=col+'66'; ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.ellipse(px,ry,rw,rw*0.25,0,0,Math.PI*2); ctx.stroke();
      }
      // dust glitter at the base
      ctx.fillStyle='#ffffffaa';
      for(let i=0;i<4;i++){ const k=(now*0.01+i*31)%(TILE*1.2); ctx.fillRect(px+(((i*53)%9)-4)*bw/5, tyPx-k, 2,2); }
    }
    // hull (two-tone metal)
    const flash=c.hitFlash>0;
    ctx.fillStyle=flash? '#ffffff' : L.hullColor;
    ctx.beginPath(); ctx.ellipse(px,py,hw,hh,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(px,py+hh*0.35,hw*0.96,hh*0.55,0,0,Math.PI); ctx.fill();
    ctx.strokeStyle='rgba(20,26,34,0.8)'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.ellipse(px,py,hw,hh,0,0,Math.PI*2); ctx.stroke();
    // fins
    if(L.fins>0){ ctx.fillStyle=L.hullColor;
      ctx.beginPath(); ctx.moveTo(px-hw*0.95,py); ctx.lineTo(px-hw*1.25,py-hh*0.8); ctx.lineTo(px-hw*0.6,py-hh*0.3); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(px+hw*0.95,py); ctx.lineTo(px+hw*1.25,py-hh*0.8); ctx.lineTo(px+hw*0.6,py-hh*0.3); ctx.closePath(); ctx.fill();
    }
    // dome + occupant silhouette
    const domeCols=['rgba(140,230,255,0.55)','rgba(255,200,90,0.5)','rgba(200,140,255,0.5)'];
    ctx.fillStyle=domeCols[L.dome]||domeCols[0];
    ctx.beginPath(); ctx.ellipse(px,py-hh*0.7,hw*0.42,hh*1.1,0,Math.PI,0); ctx.fill();
    ctx.fillStyle='rgba(30,40,36,0.9)';
    if(L.occupant===0){ // gray alien: bulbous head, big eyes
      ctx.beginPath(); ctx.ellipse(px,py-hh*0.9,hw*0.13,hh*0.5,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#0a0d0a'; ctx.fillRect(px-hw*0.09,py-hh*1.0,hw*0.07,hh*0.22); ctx.fillRect(px+hw*0.02,py-hh*1.0,hw*0.07,hh*0.22);
    } else if(L.occupant===1){ // tentacles waving
      ctx.strokeStyle='rgba(30,40,36,0.9)'; ctx.lineWidth=2;
      for(let i=-1;i<=1;i++){ ctx.beginPath(); ctx.moveTo(px+i*hw*0.1,py-hh*0.5);
        ctx.quadraticCurveTo(px+i*hw*0.2+Math.sin(c.t*3+i)*3, py-hh*1.2, px+i*hw*0.25, py-hh*1.5+Math.sin(c.t*4+i)*2); ctx.stroke(); }
    } else { // pulsing brain
      const pulse=1+Math.sin(c.t*5)*0.15;
      ctx.beginPath(); ctx.ellipse(px,py-hh*0.95,hw*0.16*pulse,hh*0.4*pulse,0,0,Math.PI*2); ctx.fill();
    }
    // rotating rim lights
    for(let i=0;i<L.lights;i++){
      const a=(i/L.lights)*Math.PI*2 + c.t*L.blink;
      const lx=px+Math.cos(a)*hw*0.82, ly=py+Math.sin(a)*hh*0.6;
      const on=(Math.sin(a*2+c.t*4)+1)*0.5;
      ctx.fillStyle=L.lightColor; ctx.globalAlpha=0.25+on*0.75;
      ctx.fillRect(lx-2,ly-2,4,4);
    }
    ctx.globalAlpha=1;
    // hatch glow
    ctx.fillStyle=L.lightColor; ctx.globalAlpha=(c.phase==='beam'||c.phase==='carry')?0.9:0.35;
    ctx.beginPath(); ctx.ellipse(px,py+hh*0.75,hw*0.3,hh*0.25,0,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=1;
    // damage smoke
    if(c.hp<c.maxHp*0.4){
      for(let i=0;i<3;i++){
        const k=(now*0.015+i*40)%30;
        ctx.fillStyle='rgba(60,60,66,'+(0.5-k*0.015).toFixed(2)+')';
        ctx.fillRect(px-hw*0.3+i*hw*0.3, py-hh-k, 4,4);
      }
    }
    // HP bar once it has taken damage
    if(c.hp<c.maxHp){
      const w=Math.max(40,hw);
      ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(px-w/2,py-hh*2.4-8,w,4);
      ctx.fillStyle=L.lightColor; ctx.fillRect(px-w/2,py-hh*2.4-8,w*Math.max(0,c.hp/c.maxHp),4);
    }
    ctx.restore();
  }

  const api={
    update, draw, damageAt, attackAt, forceSpawn, snapshot, restore, clearActive,
    current:()=> craft? {name:craft.look.name, archetype:craft.look.archetype, phase:craft.phase, x:craft.x, y:craft.y, hp:craft.hp, maxHp:craft.maxHp, hullW:craft.look.hullW, seed:craft.look.seed} : null,
    state:()=>({acc, nextAt, visits}),
    beaming,
    _gen:generate, // deterministic look (tests)
    reset(){ craft=null; acc=0; visits=0; rollNext(); save(); }
  };
  MM.ufo=api;
  return api;
})();

export { ufo };
export default ufo;
