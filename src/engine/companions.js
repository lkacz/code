import { T, INFO, WORLD_H } from '../constants.js';
import { buildMaterialProfile, isDoorTile, isGasTile, isHeroPassableTile } from './material_physics.js';

const companions = (function(){
  const root = (typeof window!=='undefined') ? window : globalThis;
  const MM = root.MM = root.MM || {};
  const list = [];
  const lasers = [];
  const deathFx = [];
  const command = {mode:'attack', awaiting:false, harvestTile:null, harvestLabel:''};

  const MAX_COMPANIONS = 3;
  const BASE_HP = 34;
  const HP_PER_BIOMASS = 18;
  const MAX_BIOMASS = 30;
  const BODY_W = 0.72;
  const BODY_H = 1.05;
  const GRAVITY = 24;
  const MAX_FALL = 18;
  const FOLLOW_SPEED = 5.8;
  const FOLLOW_ACCEL = 18;
  const LASER_RANGE = 11.5;
  const LASER_COOLDOWN = 0.68;
  const POISON_INTERVAL = 3.1;
  const TELEPORT_DIST = 31;
  const HARVEST_SCAN_RADIUS = 18;
  const HARVEST_REACH = 1.45;
  const HARVEST_SPEED_SCALE = 0.10;
  const ARCHETYPE_TRAITS = Object.freeze({
    guardian:{label:'wartownik', follow:1.15, spacing:0.48, speed:0.88, accel:0.95, jump:0.95, range:0.88, cooldown:1.12, damage:1.10, poisonInterval:1.22, poisonPower:0.82, death:1.20, orbit:0.02},
    sniper:{label:'strzelec', follow:2.15, spacing:0.70, speed:0.76, accel:0.78, jump:0.92, range:1.38, cooldown:1.34, damage:1.34, poisonInterval:1.45, poisonPower:0.58, death:0.88, orbit:0.00},
    skirmisher:{label:'harcownik', follow:1.62, spacing:0.58, speed:1.28, accel:1.24, jump:1.16, range:0.94, cooldown:0.72, damage:0.84, poisonInterval:1.05, poisonPower:0.78, death:0.92, orbit:0.08},
    toxic:{label:'dymnik', follow:1.42, spacing:0.54, speed:0.92, accel:0.95, jump:1.02, range:0.82, cooldown:1.08, damage:0.72, poisonInterval:0.58, poisonPower:1.58, death:1.42, orbit:0.05},
    volatile:{label:'iskrownik', follow:1.82, spacing:0.66, speed:1.02, accel:1.05, jump:1.04, range:1.05, cooldown:0.96, damage:1.18, poisonInterval:0.95, poisonPower:1.08, death:1.72, orbit:0.10},
    sentinel:{label:'satelita', follow:2.55, spacing:0.78, speed:0.70, accel:0.72, jump:0.88, range:1.18, cooldown:0.86, damage:0.98, poisonInterval:1.10, poisonPower:0.92, death:1.05, orbit:0.22}
  });
  const ARCHETYPE_IDS = Object.keys(ARCHETYPE_TRAITS);

  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function nowMs(){ return (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now(); }
  function say(text){ try{ if(root.msg) root.msg(text); }catch(e){} }
  function sfx(name){ try{ if(MM.audio && MM.audio.play) MM.audio.play(name); }catch(e){} }
  function burst(x,y,tier){
    try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(x*(MM.TILE||20), y*(MM.TILE||20), tier||'rare'); }catch(e){}
  }
  function sparks(x,y,tier,count){
    try{
      if(MM.particles && MM.particles.spawnSparks) MM.particles.spawnSparks(x*(MM.TILE||20), y*(MM.TILE||20), tier||'rare', count||10);
      else burst(x,y,tier||'rare');
    }catch(e){}
  }
  function invAdd(cost){
    const inv=root.inv;
    if(!inv || !cost) return;
    for(const k in cost){ if(typeof inv[k]==='number') inv[k]+=cost[k]||0; }
  }
  function prng(seed){
    let s=(seed>>>0) || 0x9e3779b9;
    return function(){
      s = (s + 0x6D2B79F5) >>> 0;
      let t=s;
      t=Math.imul(t ^ (t>>>15), t | 1);
      t ^= t + Math.imul(t ^ (t>>>7), t | 61);
      return ((t ^ (t>>>14)) >>> 0) / 4294967296;
    };
  }
  function randInt(r,n){ return Math.floor(r()*n); }
  function pick(r,list){ return list[randInt(r,list.length)]; }
  function validChoice(v,list,fallback){
    return list.includes(v) ? v : fallback;
  }
  function mixColor(a,b,t){
    const ca=parseInt(String(a).slice(1),16), cb=parseInt(String(b).slice(1),16);
    const ar=(ca>>16)&255, ag=(ca>>8)&255, ab=ca&255;
    const br=(cb>>16)&255, bg=(cb>>8)&255, bb=cb&255;
    const rr=(ar+(br-ar)*t)|0, rg=(ag+(bg-ag)*t)|0, rb=(ab+(bb-ab)*t)|0;
    return '#'+rr.toString(16).padStart(2,'0')+rg.toString(16).padStart(2,'0')+rb.toString(16).padStart(2,'0');
  }
  function hashSeed(x,y,biomass){
    const n=(Math.floor((x||0)*73856093) ^ Math.floor((y||0)*19349663) ^ Math.floor(nowMs()*1000) ^ ((biomass||1)*83492791) ^ ((Math.random()*0xffffffff)>>>0)) >>> 0;
    return n || 1;
  }
  function maxHpForBiomass(biomass){
    return BASE_HP + Math.max(0, Math.floor(biomass||0))*HP_PER_BIOMASS;
  }
  function makeGenome(seed){
    const r=prng(seed);
    const palettes=[
      ['#5bcf72','#2f7f58','#c5ff71','#74f7ff'],
      ['#a75ad9','#4b2f73','#f7a8ff','#69f0c8'],
      ['#d66c4d','#6b3a43','#ffd36a','#a7ff6f'],
      ['#60a7d8','#2d4e73','#a7e8ff','#e6ff73'],
      ['#9dc451','#364f36','#d9ff73','#72ffd1'],
      ['#f2c65b','#3b3a51','#ffe89b','#ff77b7'],
      ['#45d1aa','#1c4b5a','#d7fff0','#90a7ff'],
      ['#b9f075','#47513a','#fff27a','#8fffca'],
      ['#f17b9b','#5a3148','#ffe0ef','#b1fff0'],
      ['#88a9ff','#283457','#e7ecff','#ffd36b']
    ];
    const bodies=['mantle','orb','runner','spine','crown','beetle','lantern','blade','tripod'];
    const eyeLayouts=['row','stack','triad','halo','split','visor'];
    const legStyles=['joint','spider','stub','talon','hover','crawler'];
    const tails=['none','whip','fork','club','fan','spark'];
    const crests=['none','horns','spines','frill','antenna','halo'];
    const markings=['none','stripe','spots','runes','split','veins'];
    const p=pick(r,palettes);
    const archetype=pick(r,ARCHETYPE_IDS);
    return {
      seed,
      archetype,
      body:pick(r,bodies),
      primary:p[0],
      secondary:p[1],
      glow:p[2],
      laser:p[3],
      eyes:1+randInt(r,5),
      legs:2+randInt(r,5),
      tendrils:2+randInt(r,6),
      horns:randInt(r,4),
      plates:1+randInt(r,5),
      size:0.82+r()*0.46,
      width:0.86+r()*0.34,
      eyeLayout:pick(r,eyeLayouts),
      legStyle:pick(r,legStyles),
      tail:pick(r,tails),
      crest:pick(r,crests),
      marking:pick(r,markings),
      glowPattern:randInt(r,4),
      gait:r()*2-1,
      shoulder:r()*0.36-0.18,
      asym:r()*0.7-0.35,
      pulse:r()*Math.PI*2,
      stripe:r()<0.55,
      coreX:(r()*0.28-0.14),
      antenna:r()<0.55
    };
  }
  function companionName(genome){
    const a=['Zielony','Syczacy','Iskrzacy','Miekki','Lustrzany','Gleboki'];
    const b=['Pomruk','Wartownik','Kiel','Oblok','Oko','Pancerzyk'];
    const r=prng((genome && genome.seed) || 1);
    return a[randInt(r,a.length)]+' '+b[randInt(r,b.length)];
  }
  function normalizeGenome(g,seed){
    const base=makeGenome(seed);
    if(!g || typeof g!=='object') return base;
    const out=Object.assign({},base,g);
    out.seed=seed;
    out.archetype=validChoice(out.archetype,ARCHETYPE_IDS,base.archetype);
    out.body=validChoice(out.body,['mantle','orb','runner','spine','crown','beetle','lantern','blade','tripod'],base.body);
    out.eyeLayout=validChoice(out.eyeLayout,['row','stack','triad','halo','split','visor'],base.eyeLayout);
    out.legStyle=validChoice(out.legStyle,['joint','spider','stub','talon','hover','crawler'],base.legStyle);
    out.tail=validChoice(out.tail,['none','whip','fork','club','fan','spark'],base.tail);
    out.crest=validChoice(out.crest,['none','horns','spines','frill','antenna','halo'],base.crest);
    out.marking=validChoice(out.marking,['none','stripe','spots','runes','split','veins'],base.marking);
    out.eyes=clamp(out.eyes|0,1,6);
    out.legs=clamp(out.legs|0,2,8);
    out.tendrils=clamp(out.tendrils|0,1,8);
    out.horns=clamp(out.horns|0,0,5);
    out.plates=clamp(out.plates|0,1,7);
    out.size=clamp(Number(out.size)||1,0.72,1.48);
    out.width=clamp(Number(out.width)||1,0.72,1.46);
    out.glowPattern=clamp(out.glowPattern|0,0,4);
    out.gait=clamp(Number(out.gait)||0,-1,1);
    out.shoulder=clamp(Number(out.shoulder)||0,-0.24,0.24);
    out.asym=clamp(Number(out.asym)||0,-0.42,0.42);
    return out;
  }
  function traitsFor(c){
    const g=(c && c.genome) || {};
    const base=ARCHETYPE_TRAITS[g.archetype] || ARCHETYPE_TRAITS.guardian;
    const biomass=Math.max(1,Math.floor((c && c.biomass) || 1));
    const size=clamp(Number(g.size)||1,0.72,1.48);
    const gait=clamp(Number(g.gait)||0,-1,1);
    return {
      archetype:g.archetype || 'guardian',
      label:base.label,
      follow:base.follow + (size-1)*0.35,
      spacing:base.spacing,
      speed:FOLLOW_SPEED*base.speed*(1+gait*0.08),
      accel:FOLLOW_ACCEL*base.accel*(1+Math.abs(gait)*0.06),
      jump:-8.7*base.jump,
      laserRange:LASER_RANGE*base.range + Math.min(1.8,biomass*0.045),
      laserCooldown:LASER_COOLDOWN*base.cooldown,
      laserDamage:(5.5 + Math.min(16, biomass*0.7))*base.damage,
      poisonInterval:POISON_INTERVAL*base.poisonInterval,
      poisonPower:base.poisonPower,
      death:base.death,
      orbit:base.orbit
    };
  }
  function makeCompanion(opts){
    opts=opts||{};
    const biomass=clamp(Math.floor(opts.biomass||3),1,MAX_BIOMASS);
    const seed=(opts.seed>>>0) || hashSeed(opts.x,opts.y,biomass);
    const genome=normalizeGenome(opts.genome,seed);
    return {
      id:opts.id || ('bio_'+seed.toString(36)+'_'+Date.now().toString(36)),
      seed,
      genome,
      name:opts.name || companionName(genome),
      x:Number.isFinite(opts.x) ? opts.x : 0,
      y:Number.isFinite(opts.y) ? opts.y : 0,
      vx:Number.isFinite(opts.vx) ? opts.vx : 0,
      vy:Number.isFinite(opts.vy) ? opts.vy : 0,
      hp:Number.isFinite(opts.hp) ? Math.max(1, opts.hp) : maxHpForBiomass(biomass),
      maxHp:Number.isFinite(opts.maxHp) ? Math.max(1, opts.maxHp) : maxHpForBiomass(biomass),
      biomass,
      facing:opts.facing || 1,
      grounded:false,
      laserCd:Number.isFinite(opts.laserCd) ? opts.laserCd : (0.2+Math.random()*0.4),
      gasCd:Number.isFinite(opts.gasCd) ? opts.gasCd : (POISON_INTERVAL*0.7+Math.random()*POISON_INTERVAL*0.8),
      hurtCd:0,
      stuckT:0,
      age:opts.age || 0,
      feedPulse:opts.feedPulse || 0,
      hitPulse:0,
      lastTarget:null,
      harvestX:Number.isFinite(opts.harvestX) ? opts.harvestX : null,
      harvestY:Number.isFinite(opts.harvestY) ? opts.harvestY : null,
      harvestProgress:Number.isFinite(opts.harvestProgress) ? opts.harvestProgress : 0,
      harvestScanCd:Number.isFinite(opts.harvestScanCd) ? opts.harvestScanCd : 0
    };
  }
  function normalizeCommand(raw){
    if(!raw || typeof raw!=='object') return {mode:'attack', awaiting:false, harvestTile:null, harvestLabel:''};
    const tile=Number.isFinite(raw.harvestTile) ? raw.harvestTile : null;
    const mode=raw.mode==='harvest' ? 'harvest' : 'attack';
    return {
      mode,
      awaiting:mode==='harvest' && !!raw.awaiting && tile==null,
      harvestTile:mode==='harvest' ? tile : null,
      harvestLabel:String(raw.harvestLabel || ''),
    };
  }
  function setCommand(next){
    const n=normalizeCommand(next);
    command.mode=n.mode;
    command.awaiting=n.awaiting;
    command.harvestTile=n.harvestTile;
    command.harvestLabel=n.harvestLabel;
    if(command.mode!=='harvest' || command.harvestTile==null){
      for(const c of list){
        c.harvestX=null; c.harvestY=null; c.harvestProgress=0; c.harvestScanCd=0;
      }
    }
    return snapshotCommand();
  }
  function snapshotCommand(){
    return {mode:command.mode, awaiting:!!command.awaiting, harvestTile:command.harvestTile, harvestLabel:command.harvestLabel||''};
  }
  function isHarvestMode(){ return command.mode==='harvest'; }
  function awaitingHarvestTarget(){ return isHarvestMode() && command.awaiting; }
  function assignHarvestTarget(tileId,label){
    if(!Number.isFinite(tileId) || tileId===T.AIR) return false;
    command.mode='harvest';
    command.awaiting=false;
    command.harvestTile=tileId;
    command.harvestLabel=String(label || ((INFO[tileId] && INFO[tileId].name) || 'material'));
    for(const c of list){
      c.harvestX=null; c.harvestY=null; c.harvestProgress=0; c.harvestScanCd=0;
    }
    say('Pomocnicy beda zbierac: '+command.harvestLabel+'.');
    return true;
  }
  function companionAtTile(tx,ty,range){
    const x=tx+0.5, y=ty+0.5;
    let best=null, bd=(range||1.45)*(range||1.45);
    for(const c of list){
      const dx=c.x-x, dy=(c.y-0.55)-y, d=dx*dx+dy*dy;
      if(d<bd){ bd=d; best=c; }
    }
    return best;
  }
  function commandAt(tx,ty){
    if(!list.length || !companionAtTile(tx,ty,1.55)) return false;
    if(command.mode==='harvest'){
      setCommand({mode:'attack'});
      say('Pomocnicy wracaja do obrony.');
    }else{
      setCommand({mode:'harvest', awaiting:true});
      say('Pomocnicy czekaja na wskazanie materialu do zbierania.');
    }
    return true;
  }
  function spawnProbeTiles(x,y){
    return [
      [x,y],
      [x-1,y],
      [x+1,y],
      [x-2,y],
      [x+2,y],
      [x,y-1],
      [x-1,y-1],
      [x+1,y-1]
    ];
  }
  function tileAt(getTile,x,y){
    try{ return getTile ? getTile(Math.floor(x), Math.floor(y)) : T.AIR; }catch(e){ return T.AIR; }
  }
  function passableForCompanion(t){
    return isHeroPassableTile(t) || isDoorTile(t);
  }
  function clearAt(x,y,m,getTile){
    const hw=(BODY_W*(0.92+Math.min(0.18,(m && m.biomass || 1)*0.008)))*0.5;
    const top=y-BODY_H, bottom=y-0.04;
    const xs=[x-hw,x,x+hw];
    const ys=[top,top+0.38,bottom];
    for(const px of xs){
      for(const py of ys){
        const t=tileAt(getTile,px,py);
        if(!passableForCompanion(t)) return false;
      }
    }
    return true;
  }
  function solidBodyContacts(c,getTile){
    const hits=[];
    const seen=new Set();
    const hw=(BODY_W*(0.92+Math.min(0.18,(c && c.biomass || 1)*0.008)))*0.5;
    const top=c.y-BODY_H, bottom=c.y-0.04;
    const xs=[c.x-hw,c.x,c.x+hw];
    const ys=[top,top+0.38,bottom];
    for(const px of xs){
      for(const py of ys){
        const tx=Math.floor(px), ty=Math.floor(py);
        const t=tileAt(getTile,px,py);
        if(passableForCompanion(t)) continue;
        const k=tx+','+ty;
        if(seen.has(k)) continue;
        seen.add(k);
        hits.push({x:tx,y:ty,t});
      }
    }
    return hits;
  }
  function findCrushEscape(c,getTile){
    const candidates=[];
    const xSteps=[0,-0.75,0.75,-1.25,1.25,-2,2,-3,3];
    const ySteps=[-0.15,-0.65,-1.1,0.35,-1.65,0.85];
    for(const dy of ySteps){
      for(const dx of xSteps){
        if(dx===0 && Math.abs(dy)<0.2) continue;
        candidates.push({x:c.x+dx,y:c.y+dy,d2:dx*dx+dy*dy});
      }
    }
    candidates.sort((a,b)=>a.d2-b.d2);
    for(const p of candidates){
      if(p.y<1 || p.y>=WORLD_H-0.2) continue;
      if(clearAt(p.x,p.y,c,getTile)) return p;
    }
    return null;
  }
  function crushDamageForContacts(contacts,dt){
    let load=0;
    for(const hit of contacts){
      const p=buildMaterialProfile(hit.t);
      if(p) load += 8 + (Number(p.weight)||1)*8 + (Number(p.strength)||6)*0.45;
      else load += hit.t===T.BEDROCK ? 42 : 18;
    }
    return (14 + Math.min(72,load))*dt;
  }
  function resolveCrush(c,dt,getTile){
    const contacts=solidBodyContacts(c,getTile);
    if(!contacts.length){ c.crushT=0; return false; }
    const escape=findCrushEscape(c,getTile);
    if(escape){
      c.x=escape.x; c.y=escape.y; c.vx=0; c.vy=Math.min(0,c.vy);
      c.crushT=0;
      c.hitPulse=Math.max(c.hitPulse||0,0.18);
      sparks(c.x,c.y-0.55,'common',5);
      return false;
    }
    c.crushT=(c.crushT||0)+dt;
    c.vx*=0.1;
    c.vy=Math.min(0,c.vy);
    const pressure=1+Math.min(1.15,c.crushT*0.85);
    return damage(c,crushDamageForContacts(contacts,dt)*pressure,'crush');
  }
  function hasFloor(x,y,getTile){
    const hw=BODY_W*0.38;
    const below=y+0.05;
    return !passableForCompanion(tileAt(getTile,x-hw,below)) || !passableForCompanion(tileAt(getTile,x+hw,below));
  }
  function findSpawnNear(player,getTile,offset){
    const px=Number(player && player.x) || 0;
    const py=Number(player && player.y) || 0;
    const dir=(player && player.facing) || -1;
    const baseX=px-dir*(offset||1.35);
    const baseY=py;
    for(const p of spawnProbeTiles(baseX,baseY)){
      for(let yy=Math.floor(p[1])-3; yy<=Math.floor(p[1])+3; yy++){
        const x=p[0], y=yy+0.96;
        if(y<2 || y>=WORLD_H-1) continue;
        if(clearAt(x,y,{biomass:3},getTile) && hasFloor(x,y,getTile)) return {x,y};
      }
    }
    return {x:px-dir*1.2, y:py};
  }
  function spawnFromCraft(player,opts){
    opts=opts||{};
    if(list.length>=MAX_COMPANIONS){
      invAdd(opts.refund || {alienBiomass:opts.biomass||3, meat:opts.meat||2});
      say('Pomocnikow jest juz za duzo. Oddalem skladniki.');
      return null;
    }
    const biomass=clamp(Math.floor(opts.biomass||3),1,MAX_BIOMASS);
    const spot=findSpawnNear(player,opts.getTile,1.35+list.length*0.55);
    const c=makeCompanion({x:spot.x,y:spot.y,biomass,facing:(player && player.facing)||1});
    list.push(c);
    burst(c.x,c.y-0.4,'rare');
    sfx('charge');
    say(c.name+' dolaczyl do ciebie. Karm biomasa, jesli ma rosnac.');
    return c;
  }
  function nearestCompanion(player,range){
    if(!list.length || !player) return null;
    let best=null, bd=(range||6)*(range||6);
    for(const c of list){
      const dx=c.x-player.x, dy=c.y-player.y;
      const d=dx*dx+dy*dy;
      if(d<bd){ bd=d; best=c; }
    }
    return best;
  }
  function growCompanion(c,amount){
    if(!c) return false;
    const add=clamp(Math.floor(amount||1),1,MAX_BIOMASS);
    const before=c.maxHp;
    c.biomass=clamp(c.biomass+add,1,MAX_BIOMASS);
    c.maxHp=maxHpForBiomass(c.biomass);
    c.hp=clamp(c.hp+(c.maxHp-before),1,c.maxHp);
    c.feedPulse=1.0;
    c.genome.plates=clamp(c.genome.plates+((c.biomass%3)===0?1:0),1,7);
    c.genome.horns=clamp(c.genome.horns+((c.biomass%5)===0?1:0),0,5);
    return true;
  }
  function feedNearest(player,amount,opts){
    opts=opts||{};
    const c=nearestCompanion(player,6);
    if(!c){
      invAdd(opts.refund || {alienBiomass:amount||1, meat:opts.meat||1});
      say('Nie ma pomocnika w poblizu. Oddalem skladniki.');
      return false;
    }
    growCompanion(c,amount);
    sparks(c.x,c.y-0.55,'rare',14);
    sfx('heal');
    say(c.name+' wchlonal biomase. HP '+Math.round(c.hp)+'/'+Math.round(c.maxHp)+'.');
    return true;
  }
  function lineClear(x1,y1,x2,y2,getTile){
    const dx=x2-x1, dy=y2-y1;
    const dist=Math.max(Math.abs(dx),Math.abs(dy));
    const steps=Math.max(2, Math.ceil(dist*3));
    for(let i=1;i<steps;i++){
      const t=i/steps;
      const x=x1+dx*t, y=y1+dy*t;
      const tx=Math.floor(x), ty=Math.floor(y);
      if(tx===Math.floor(x1) && ty===Math.floor(y1)) continue;
      if(tx===Math.floor(x2) && ty===Math.floor(y2)) continue;
      const tile=tileAt(getTile,x,y);
      if(!isHeroPassableTile(tile)) return false;
    }
    return true;
  }
  function exposedHarvestTile(x,y,getTile){
    for(const p of [[1,0],[-1,0],[0,1],[0,-1]]){
      if(passableForCompanion(tileAt(getTile,x+p[0],y+p[1]))) return true;
    }
    return false;
  }
  function canHarvestTileAt(x,y,getTile){
    const t=tileAt(getTile,x,y);
    if(t!==command.harvestTile || t===T.AIR) return false;
    const info=INFO[t] || {};
    if(info.unmineable || isGasTile(t) || info.chestTier || info.machine || info.story) return false;
    return exposedHarvestTile(x,y,getTile);
  }
  function harvestReach(c,x,y,getTile){
    const cx=c.x, cy=c.y-0.55;
    const tx=x+0.5, ty=y+0.5;
    return Math.abs(tx-cx)<=HARVEST_REACH && Math.abs(ty-cy)<=HARVEST_REACH && lineClear(cx,cy,tx,ty,getTile);
  }
  function harvestStandPoint(c,x,y,getTile){
    const spots=[
      {x:x-0.54,y:y+0.96},{x:x+1.54,y:y+0.96},
      {x:x+0.50,y:y-0.08},{x:x+0.50,y:y+1.96},
      {x:x-0.90,y:y+0.30},{x:x+1.90,y:y+0.30}
    ];
    spots.sort((a,b)=>{
      const ad=(a.x-c.x)*(a.x-c.x)+(a.y-c.y)*(a.y-c.y);
      const bd=(b.x-c.x)*(b.x-c.x)+(b.y-c.y)*(b.y-c.y);
      return ad-bd;
    });
    for(const s of spots){
      if(s.y>1 && s.y<WORLD_H-0.2 && clearAt(s.x,s.y,c,getTile)) return s;
    }
    return {x:x+0.5,y:y+0.96};
  }
  function findHarvestTile(c,player,getTile){
    if(!isHarvestMode() || command.awaiting || command.harvestTile==null) return null;
    const centers=[
      {x:Math.floor(c.x),y:Math.floor(c.y-0.55),bias:0},
      {x:Math.floor((player&&player.x)||c.x),y:Math.floor((player&&player.y)||c.y),bias:4}
    ];
    let best=null, bd=Infinity;
    for(const center of centers){
      for(let r=0;r<=HARVEST_SCAN_RADIUS;r++){
        let foundInRing=false;
        for(let dx=-r;dx<=r;dx++){
          for(let dy=-r;dy<=r;dy++){
            if(Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
            const x=center.x+dx, y=center.y+dy;
            if(y<0 || y>=WORLD_H) continue;
            if(!canHarvestTileAt(x,y,getTile)) continue;
            const d=(x+0.5-c.x)*(x+0.5-c.x)+(y+0.5-(c.y-0.55))*(y+0.5-(c.y-0.55))+center.bias;
            if(d<bd){ bd=d; best={x,y}; foundInRing=true; }
          }
        }
        if(foundInRing && best) break;
      }
    }
    return best;
  }
  function wrapTarget(kind,raw,x,y,hp){
    return {kind,raw,x,y,tx:Math.floor(x),ty:Math.floor(y),hp:hp||1};
  }
  function nearestHostile(c,player,getTile){
    const traits=traitsFor(c);
    const sx=c.x, sy=c.y-0.55;
    const options=[];
    try{
      if(MM.mobs && MM.mobs.nearestLiving){
        const mob=MM.mobs.nearestLiving(sx,sy,traits.laserRange,{exclude:['ZLOTY']});
        if(mob && mob.hp>0){
          const mx=Number(mob.x), my=Number(mob.y);
          const heroRadius=traits.archetype==='guardian' ? 9 : (traits.archetype==='sniper' ? 15 : 12);
          const nearHero=player && ((mx-player.x)*(mx-player.x)+(my-player.y)*(my-player.y) < heroRadius*heroRadius);
          const nearSelf=(mx-sx)*(mx-sx)+(my-sy)*(my-sy) < traits.laserRange*traits.laserRange;
          if(Number.isFinite(mx) && Number.isFinite(my) && (nearHero || nearSelf) && lineClear(sx,sy,mx,my,getTile)) options.push(wrapTarget('mob',mob,mx,my,mob.hp));
        }
      }
    }catch(e){}
    try{
      if(MM.bosses && MM.bosses.nearestForTurret){
        const b=MM.bosses.nearestForTurret(sx,sy,traits.laserRange,false);
        if(b && Number.isFinite(b.x) && Number.isFinite(b.y) && lineClear(sx,sy,b.x,b.y,getTile)) options.push(wrapTarget('boss',b,b.x,b.y,b.hp||1));
      }
    }catch(e){}
    try{
      if(MM.ufo && MM.ufo.current){
        const u=MM.ufo.current();
        if(u && u.hp>0 && Number.isFinite(u.x) && Number.isFinite(u.y)){
          const dx=u.x-sx, dy=u.y-sy;
          if(dx*dx+dy*dy<=traits.laserRange*traits.laserRange && lineClear(sx,sy,u.x,u.y,getTile)) options.push(wrapTarget('ufo',u,u.x,u.y,u.hp));
        }
      }
    }catch(e){}
    let best=null, bd=Infinity;
    for(const t of options){
      const dx=t.x-sx, dy=t.y-sy, d=dx*dx+dy*dy;
      if(d<bd){ bd=d; best=t; }
    }
    return best;
  }
  function damageTarget(t,dmg){
    let hit=false;
    try{
      if(t.kind==='mob' && MM.mobs && MM.mobs.damageAt) hit=!!MM.mobs.damageAt(t.tx,t.ty,dmg);
      else if(t.kind==='boss' && MM.bosses && MM.bosses.damageAt) hit=!!MM.bosses.damageAt(t.tx,t.ty,dmg);
      else if(t.kind==='ufo' && MM.ufo && MM.ufo.damageAt) hit=!!MM.ufo.damageAt(t.tx,t.ty,dmg);
    }catch(e){}
    return hit;
  }
  function fireLaser(c,target){
    const sx=c.x, sy=c.y-0.62;
    const traits=traitsFor(c);
    const dmg=traits.laserDamage;
    const hit=damageTarget(target,dmg);
    c.facing=target.x>=c.x ? 1 : -1;
    c.lastTarget={x:target.x,y:target.y,t:0.9};
    lasers.push({
      x1:sx,y1:sy,x2:target.x,y2:target.y,
      life:0,max:0.24,hit,
      color:c.genome.laser || '#83f8ff',
      seed:(c.seed ^ Math.floor(nowMs()))>>>0
    });
    if(lasers.length>40) lasers.splice(0,lasers.length-40);
    sparks(target.x,target.y,hit?'rare':'common',hit?10:4);
    sfx('beam');
  }
  function emitPoison(c,getTile,setTile){
    const traits=traitsFor(c);
    const power=(0.18+Math.min(0.22,c.biomass*0.012))*traits.poisonPower;
    try{ if(MM.gases && MM.gases.add) MM.gases.add('poison',c.x,c.y-0.35,{power,cells:1,getTile,setTile}); }catch(e){}
    try{ if(MM.mobs && MM.mobs.poisonRadius) MM.mobs.poisonRadius(c.x,c.y-0.35,1.55,{dur:3.0,dps:1.0+Math.min(2.2,c.biomass*0.08)}); }catch(e){}
  }
  function applyEnvironmentDamage(c,dt,getTile){
    const feet=tileAt(getTile,c.x,c.y-0.05);
    const body=tileAt(getTile,c.x,c.y-0.55);
    let dps=0;
    if(feet===T.LAVA || body===T.LAVA) dps+=20;
    if(body===T.FUEL_GAS || body===T.HOT_AIR) dps+=1.8;
    if(dps>0) damage(c,dps*dt,'env');
    c.hurtCd=Math.max(0,c.hurtCd-dt);
    if(c.hurtCd<=0){
      let mob=null;
      try{ if(MM.mobs && MM.mobs.nearestLiving) mob=MM.mobs.nearestLiving(c.x,c.y-0.45,0.9,{exclude:['ZLOTY']}); }catch(e){ mob=null; }
      if(mob && mob.hp>0){
        c.hurtCd=0.75;
        c.vx += (c.x<(mob.x||c.x) ? -1 : 1)*3.0;
        damage(c,3.5,'bite');
      }
    }
  }
  function damage(c,amount,reason){
    if(!c || amount<=0) return false;
    c.hp-=amount;
    c.hitPulse=0.25;
    if(c.hp<=0){
      kill(c,reason||'damage');
      return true;
    }
    return false;
  }
  function kill(c){
    const i=list.indexOf(c);
    if(i>=0) list.splice(i,1);
    const traits=traitsFor(c);
    const r=(2.2+Math.min(1.4,c.biomass*0.04))*traits.death;
    try{ if(MM.mobs && MM.mobs.blastRadius) MM.mobs.blastRadius(c.x,c.y-0.35,r,(8+Math.min(18,c.biomass*0.8))*traits.death); }catch(e){}
    try{ if(MM.gases && MM.gases.add) MM.gases.add('poison',c.x,c.y-0.3,{power:0.9*traits.poisonPower,cells:4}); }catch(e){}
    deathFx.push({x:c.x,y:c.y-0.45,t:0,max:0.55,color:c.genome.glow});
    if(deathFx.length>20) deathFx.splice(0,deathFx.length-20);
    burst(c.x,c.y-0.35,'epic');
    sfx('explosion');
    say(c.name+' rozpadl sie w zielonym blysku.');
  }
  function teleportToHero(c,player,getTile,offset,announce){
    if(!c || !player) return false;
    const spot=findSpawnNear(player,getTile,offset||1.15);
    c.x=spot.x; c.y=spot.y; c.vx=0; c.vy=0;
    c.feedPulse=0.55;
    burst(c.x,c.y-0.45,'rare');
    const cost=Math.max(1,c.maxHp*0.10);
    const survived=!damage(c,cost,'catchup');
    if(survived && announce) say(c.name+' nadwyrezyl sie, doganiajac bohatera (-10% HP).');
    return survived || list.indexOf(c)<0;
  }
  function moveAxis(c,amount,axis,getTile,dt){
    const stepMax=0.10;
    const steps=Math.max(1,Math.ceil(Math.abs(amount)/stepMax));
    const inc=amount/steps;
    for(let i=0;i<steps;i++){
      const nx=c.x+(axis==='x'?inc:0);
      const ny=c.y+(axis==='y'?inc:0);
      if(clearAt(nx,ny,c,getTile)){
        c.x=nx; c.y=ny;
      }else{
        if(axis==='x'){ c.vx=0; c.stuckT+=dt||0; }
        else { if(inc>0) c.grounded=true; c.vy=0; }
        return false;
      }
    }
    return true;
  }
  function updateMotion(c,dt,player,getTile,index){
    const traits=traitsFor(c);
    c.age+=dt;
    c.feedPulse=Math.max(0,c.feedPulse-dt*1.7);
    c.hitPulse=Math.max(0,c.hitPulse-dt*2.8);
    if(c.lastTarget) c.lastTarget.t-=dt;
    if(c.lastTarget && c.lastTarget.t<=0) c.lastTarget=null;
    const px=Number(player && player.x) || c.x;
    const py=Number(player && player.y) || c.y;
    const side=(player && player.facing) || c.facing || 1;
    const harvesting=isHarvestMode() && command.harvestTile!=null && c.harvestX!=null && c.harvestY!=null;
    let targetX=px - side*(traits.follow+index*traits.spacing);
    let targetY=py + Math.sin(c.age*2.5+c.seed*0.001)*traits.orbit;
    if(harvesting){
      const stand=harvestStandPoint(c,c.harvestX,c.harvestY,getTile);
      targetX=stand.x;
      targetY=stand.y;
    }else if(traits.archetype==='sentinel'){
      targetX += Math.sin(c.age*1.55+c.seed*0.002+index)*0.72;
      targetY += Math.cos(c.age*1.25+c.seed*0.001)*0.42;
    }else if(traits.archetype==='skirmisher' || traits.archetype==='volatile'){
      targetX += Math.sin(c.age*(traits.archetype==='skirmisher'?4.1:3.0)+c.seed*0.004)*0.38;
      targetY += Math.sin(c.age*3.3+index)*0.10;
    }else if(traits.archetype==='sniper'){
      targetX -= side*0.36;
      targetY -= 0.04;
    }else if(traits.archetype==='toxic'){
      targetX += Math.sin(c.age*2.1+c.seed*0.003)*0.16;
      targetY += 0.06;
    }
    const dx=targetX-c.x;
    const dy=targetY-c.y;
    const d2=dx*dx+dy*dy;
    if(d2>TELEPORT_DIST*TELEPORT_DIST){
      teleportToHero(c,player,getTile,1.2+index*0.5,true);
      return;
    }
    const desired=clamp(dx*1.85,-traits.speed,traits.speed);
    const dv=clamp(desired-c.vx,-traits.accel*dt,traits.accel*dt);
    c.vx+=dv;
    c.vx*=Math.pow(0.80,dt*8);
    c.facing=c.vx>0.04 ? 1 : (c.vx<-0.04 ? -1 : c.facing);
    c.grounded=hasFloor(c.x,c.y,getTile);
    if(c.grounded && (Math.abs(dx)>1.1 || dy<-0.75)){
      const frontX=c.x+Math.sign(dx || c.facing)*0.48;
      const blockLow=!passableForCompanion(tileAt(getTile,frontX,c.y-0.25));
      const blockMid=!passableForCompanion(tileAt(getTile,frontX,c.y-0.78));
      if(blockLow || blockMid || dy<-0.75){ c.vy=traits.jump; c.grounded=false; c.stuckT=0; }
    }
    c.vy=clamp(c.vy+GRAVITY*dt,-12,MAX_FALL);
    moveAxis(c,c.vx*dt,'x',getTile,dt);
    c.grounded=false;
    moveAxis(c,c.vy*dt,'y',getTile,dt);
    c.x=clamp(c.x,-999999999,999999999);
    c.y=clamp(c.y,1,WORLD_H-0.15);
  }
  function planHarvest(c,dt,player,getTile){
    if(!isHarvestMode() || command.awaiting || command.harvestTile==null) return;
    c.harvestScanCd=Math.max(0,(c.harvestScanCd||0)-dt);
    if(c.harvestX!=null && !canHarvestTileAt(c.harvestX,c.harvestY,getTile)){
      c.harvestX=null; c.harvestY=null; c.harvestProgress=0; c.harvestScanCd=0;
    }
    if(c.harvestX==null && c.harvestScanCd<=0){
      const target=findHarvestTile(c,player,getTile);
      if(target){ c.harvestX=target.x; c.harvestY=target.y; c.harvestProgress=0; }
      c.harvestScanCd=target ? 0.35 : 1.0;
    }
  }
  function updateHarvest(c,dt,getTile,opts){
    if(!isHarvestMode() || command.awaiting || command.harvestTile==null || c.harvestX==null) return false;
    if(!canHarvestTileAt(c.harvestX,c.harvestY,getTile)){
      c.harvestX=null; c.harvestY=null; c.harvestProgress=0; c.harvestScanCd=0;
      return false;
    }
    if(!harvestReach(c,c.harvestX,c.harvestY,getTile)) return false;
    const info=INFO[command.harvestTile] || {hp:1};
    const heroSpeed=Math.max(0.1,Number(opts && opts.harvestSpeed)||1);
    const need=Math.max(0.12,(Number(info.hp)||1)/6);
    c.harvestProgress=(c.harvestProgress||0)+dt*heroSpeed*HARVEST_SPEED_SCALE;
    c.lastTarget={x:c.harvestX+0.5,y:c.harvestY+0.5,t:0.22};
    c.facing=(c.harvestX+0.5)>=c.x ? 1 : -1;
    if(c.harvestProgress<need) return true;
    c.harvestProgress=0;
    const breaker=opts && opts.breakTile;
    const ok=typeof breaker==='function' ? !!breaker(c.harvestX,c.harvestY,command.harvestTile,c) : false;
    if(ok){
      sparks(c.harvestX+0.5,c.harvestY+0.5,'common',5);
      c.harvestX=null; c.harvestY=null; c.harvestScanCd=0;
      return true;
    }
    c.harvestX=null; c.harvestY=null; c.harvestScanCd=0.25;
    return false;
  }
  function update(dt,player,getTile,setTile,opts){
    opts=(opts && typeof opts==='object') ? opts : null;
    dt=clamp(Number(dt)||0,0,0.12);
    for(let i=list.length-1;i>=0;i--){
      const c=list[i];
      planHarvest(c,dt,player,getTile);
      updateMotion(c,dt,player,getTile,i);
      if(list.indexOf(c)<0) continue;
      resolveCrush(c,dt,getTile);
      if(list.indexOf(c)<0) continue;
      applyEnvironmentDamage(c,dt,getTile);
      if(list.indexOf(c)<0) continue;
      const harvesting=updateHarvest(c,dt,getTile,opts);
      if(harvesting) continue;
      if(isHarvestMode()) continue;
      c.gasCd-=dt;
      if(c.gasCd<=0){
        c.gasCd=traitsFor(c).poisonInterval*(0.75+Math.random()*0.65);
        emitPoison(c,getTile,setTile);
      }
      c.laserCd-=dt;
      if(c.laserCd<=0){
        const t=nearestHostile(c,player,getTile);
        if(t){
          fireLaser(c,t);
          c.laserCd=traitsFor(c).laserCooldown*(0.78+Math.random()*0.42);
        }else{
          c.laserCd=0.25;
        }
      }
    }
    for(let i=lasers.length-1;i>=0;i--){
      lasers[i].life+=dt;
      if(lasers[i].life>=lasers[i].max) lasers.splice(i,1);
    }
    for(let i=deathFx.length-1;i>=0;i--){
      deathFx[i].t+=dt;
      if(deathFx[i].t>=deathFx[i].max) deathFx.splice(i,1);
    }
  }
  function damageAt(tx,ty,dmg){
    for(const c of list){
      if(Math.abs((tx+0.5)-c.x)<=0.8 && Math.abs((ty+0.5)-(c.y-0.55))<=0.9){
        damage(c,Math.max(0.5,dmg||1),'direct');
        return true;
      }
    }
    return false;
  }
  function debugNearest(player,range){
    return nearestCompanion(player,range||999999) || list[0] || null;
  }
  function debugSpawn(player,biomass,getTile){
    return spawnFromCraft(player,{biomass:clamp(Math.floor(biomass||3),1,MAX_BIOMASS),meat:0,getTile});
  }
  function debugFeed(player,amount){
    const c=debugNearest(player,999999);
    if(!c) return false;
    growCompanion(c,amount);
    sparks(c.x,c.y-0.55,'rare',14);
    return true;
  }
  function debugSetBiomass(player,biomass){
    const c=debugNearest(player,999999);
    if(!c) return false;
    c.biomass=clamp(Math.floor(biomass||1),1,MAX_BIOMASS);
    c.maxHp=maxHpForBiomass(c.biomass);
    c.hp=clamp(c.hp,1,c.maxHp);
    c.feedPulse=1.0;
    return true;
  }
  function debugHeal(player){
    const c=debugNearest(player,999999);
    if(!c) return false;
    c.hp=c.maxHp;
    c.feedPulse=0.8;
    sparks(c.x,c.y-0.55,'rare',10);
    return true;
  }
  function debugDamage(player,amount){
    const c=debugNearest(player,999999);
    if(!c) return false;
    damage(c,Math.max(1,Number(amount)||20),'debug');
    return true;
  }
  function debugKill(player){
    const c=debugNearest(player,999999);
    if(!c) return false;
    damage(c,c.hp+999,'debug');
    return true;
  }
  function debugTeleportToHero(player,getTile){
    const c=debugNearest(player,999999);
    return teleportToHero(c,player,getTile,1.15,true);
  }
  function debugForceGas(player,getTile,setTile){
    const c=debugNearest(player,999999);
    if(!c) return false;
    emitPoison(c,getTile,setTile);
    return true;
  }
  function debugForceLaser(player,getTile){
    const c=debugNearest(player,999999);
    if(!c) return false;
    const t=nearestHostile(c,player,getTile);
    if(!t) return false;
    fireLaser(c,t);
    c.laserCd=LASER_COOLDOWN;
    return true;
  }
  function debugClear(){
    reset();
    return true;
  }
  function drawLaser(ctx,tile,l){
    const a=1-clamp(l.life/l.max,0,1);
    const r=prng(l.seed);
    ctx.save();
    ctx.globalAlpha=0.85*a;
    ctx.strokeStyle=l.color;
    ctx.lineWidth=3.2;
    ctx.lineCap='round';
    ctx.beginPath();
    ctx.moveTo(l.x1*tile,l.y1*tile);
    const mx=(l.x1+l.x2)*0.5+(r()*0.22-0.11);
    const my=(l.y1+l.y2)*0.5+(r()*0.22-0.11);
    ctx.quadraticCurveTo(mx*tile,my*tile,l.x2*tile,l.y2*tile);
    ctx.stroke();
    ctx.globalAlpha=0.95*a;
    ctx.strokeStyle='#f4ffff';
    ctx.lineWidth=1.1;
    ctx.beginPath();
    ctx.moveTo(l.x1*tile,l.y1*tile);
    ctx.quadraticCurveTo(mx*tile,my*tile,l.x2*tile,l.y2*tile);
    ctx.stroke();
    ctx.restore();
  }
  function drawDeathFx(ctx,tile,fx){
    const p=clamp(fx.t/fx.max,0,1);
    ctx.save();
    ctx.globalAlpha=(1-p)*0.55;
    ctx.strokeStyle=fx.color || '#baff72';
    ctx.lineWidth=2;
    ctx.beginPath();
    ctx.arc(fx.x*tile,fx.y*tile,(0.25+p*2.4)*tile,0,Math.PI*2);
    ctx.stroke();
    ctx.fillStyle='rgba(140,255,110,0.22)';
    ctx.beginPath();
    ctx.arc(fx.x*tile,fx.y*tile,(0.18+p*1.1)*tile,0,Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
  function drawTail(ctx,tile,g,w,h,c){
    if(!g.tail || g.tail==='none') return;
    const sway=Math.sin(c.age*4.4+g.pulse)*tile*0.08;
    ctx.save();
    ctx.strokeStyle=mixColor(g.secondary,g.primary,0.25);
    ctx.fillStyle=mixColor(g.secondary,g.glow,0.20);
    ctx.lineWidth=Math.max(2,tile*0.08);
    ctx.lineCap='round';
    ctx.beginPath();
    ctx.moveTo(-w*0.38,-h*0.38);
    ctx.quadraticCurveTo(-w*0.78,-h*0.42+sway,-w*(g.tail==='whip'?1.05:0.82),-h*(g.tail==='fork'?0.68:0.26)+sway);
    ctx.stroke();
    const ex=-w*(g.tail==='whip'?1.05:0.82), ey=-h*(g.tail==='fork'?0.68:0.26)+sway;
    if(g.tail==='club'){
      ctx.beginPath(); ctx.ellipse(ex,ey,tile*0.13,tile*0.09,0,0,Math.PI*2); ctx.fill();
    }else if(g.tail==='fork'){
      ctx.beginPath(); ctx.moveTo(ex,ey); ctx.lineTo(ex-tile*0.16,ey-tile*0.12); ctx.moveTo(ex,ey); ctx.lineTo(ex-tile*0.17,ey+tile*0.11); ctx.stroke();
    }else if(g.tail==='fan'){
      ctx.beginPath(); ctx.moveTo(ex,ey); ctx.lineTo(ex-tile*0.22,ey-tile*0.16); ctx.lineTo(ex-tile*0.25,ey+tile*0.16); ctx.closePath(); ctx.fill();
    }else if(g.tail==='spark'){
      ctx.strokeStyle=g.glow; ctx.lineWidth=Math.max(1,tile*0.04);
      for(let i=0;i<3;i++){ ctx.beginPath(); ctx.moveTo(ex,ey); ctx.lineTo(ex-tile*(0.12+0.04*i),ey+tile*((i-1)*0.09)); ctx.stroke(); }
    }
    ctx.restore();
  }
  function drawBackFeatures(ctx,tile,g,w,h,c){
    if(g.crest==='halo' || g.body==='lantern'){
      ctx.save();
      ctx.globalAlpha=0.22+0.08*Math.sin(c.age*4+g.pulse);
      ctx.strokeStyle=g.glow;
      ctx.lineWidth=Math.max(1,tile*0.06);
      ctx.beginPath();
      ctx.ellipse(0,-h*0.70,w*0.70,h*0.34,0,0,Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }
    if(g.body==='blade' || g.crest==='frill'){
      ctx.save();
      ctx.fillStyle=mixColor(g.secondary,g.primary,0.22);
      ctx.globalAlpha=0.72;
      ctx.beginPath();
      ctx.moveTo(-w*0.62,-h*0.42);
      ctx.lineTo(-w*0.92,-h*0.74);
      ctx.lineTo(-w*0.54,-h*0.70);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(w*0.62,-h*0.42);
      ctx.lineTo(w*0.92,-h*0.74);
      ctx.lineTo(w*0.54,-h*0.70);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  function drawLegs(ctx,tile,g,w,h,c){
    if(g.legStyle==='hover'){
      ctx.save();
      ctx.globalAlpha=0.42+0.08*Math.sin(c.age*7+g.pulse);
      ctx.fillStyle=g.glow;
      for(let i=0;i<3;i++){
        const x=(-0.32+i*0.32)*w;
        ctx.beginPath(); ctx.ellipse(x,-tile*0.02,tile*0.12,tile*0.035,0,0,Math.PI*2); ctx.fill();
      }
      ctx.restore();
      return;
    }
    for(let i=0;i<g.legs;i++){
      const t=(i/(Math.max(1,g.legs-1)))-0.5;
      const side=i%2===0 ? -1 : 1;
      const step=Math.sin(c.age*(g.legStyle==='crawler'?12:8)+i)*tile*(g.legStyle==='stub'?0.03:0.08);
      ctx.strokeStyle=g.legStyle==='talon' ? mixColor(g.secondary,'#111111',0.65) : '#233424';
      ctx.lineWidth=Math.max(2,tile*(g.legStyle==='stub'?0.10:0.075));
      ctx.beginPath();
      ctx.moveTo(t*w*0.52,-h*0.18);
      if(g.legStyle==='spider'){
        ctx.lineTo((t*w*0.88)+side*tile*0.10,-h*0.34+step);
        ctx.lineTo((t*w*0.96)+side*tile*0.18,-tile*0.02+step);
      }else if(g.legStyle==='talon'){
        ctx.lineTo((t*w*0.68)+side*tile*0.07,-tile*0.02+step);
        ctx.lineTo((t*w*0.82)+side*tile*0.15,tile*0.04+step);
      }else{
        ctx.lineTo((t*w*0.70)+side*tile*0.07,-tile*0.02+step);
      }
      ctx.stroke();
    }
  }
  function eyePositions(g,w,h){
    const count=g.eyes;
    const pts=[];
    if(g.eyeLayout==='stack'){
      for(let i=0;i<count;i++) pts.push({x:g.asym*w*0.18,y:-h*(0.44+i*0.08),s:1});
    }else if(g.eyeLayout==='triad'){
      const base=[{x:-0.18*w,y:-0.58*h},{x:0.18*w,y:-0.58*h},{x:0,y:-0.70*h},{x:-0.34*w,y:-0.50*h},{x:0.34*w,y:-0.50*h},{x:0,y:-0.42*h}];
      for(let i=0;i<count;i++) pts.push(Object.assign({s:1},base[i%base.length]));
    }else if(g.eyeLayout==='halo'){
      for(let i=0;i<count;i++){ const a=(i/count)*Math.PI*2; pts.push({x:Math.cos(a)*w*0.28,y:-h*0.58+Math.sin(a)*h*0.16,s:0.82}); }
    }else if(g.eyeLayout==='split'){
      for(let i=0;i<count;i++){ const side=i%2===0?-1:1; pts.push({x:side*w*(0.16+0.08*Math.floor(i/2)),y:-h*(0.53+0.08*(i%3)),s:1}); }
    }else if(g.eyeLayout==='visor'){
      pts.push({x:0,y:-h*0.57,s:2.5,visor:true});
      for(let i=1;i<count;i++) pts.push({x:(i%2?1:-1)*w*(0.26+0.04*i),y:-h*0.48,s:0.7});
    }else{
      for(let i=0;i<count;i++){
        const t=(i/(Math.max(1,count-1)))-0.5;
        pts.push({x:t*w*0.52 + g.asym*w*0.12,y:-h*(0.56+0.08*Math.sin(i+g.pulse)),s:1});
      }
    }
    return pts;
  }
  function drawMarkings(ctx,tile,g,w,h,c){
    if(g.marking==='none' && !g.stripe) return;
    ctx.save();
    ctx.globalAlpha=0.22;
    ctx.fillStyle='#ffffff';
    ctx.strokeStyle=g.glow;
    ctx.lineWidth=Math.max(1,tile*0.035);
    if(g.marking==='spots'){
      for(let i=0;i<g.plates+2;i++){
        const x=(-0.35+((i*37)%100)/100*0.70)*w;
        const y=-h*(0.30+((i*53)%100)/100*0.48);
        ctx.beginPath(); ctx.arc(x,y,tile*(0.025+0.008*(i%3)),0,Math.PI*2); ctx.fill();
      }
    }else if(g.marking==='runes'){
      for(let i=0;i<g.plates;i++){
        const x=(-0.30+i*(0.60/Math.max(1,g.plates-1)))*w;
        ctx.beginPath(); ctx.moveTo(x,-h*0.72); ctx.lineTo(x+tile*0.08,-h*0.63); ctx.lineTo(x-tile*0.02,-h*0.55); ctx.stroke();
      }
    }else if(g.marking==='split'){
      ctx.fillRect(-tile*0.03,-h*0.86,tile*0.06,h*0.66);
    }else if(g.marking==='veins'){
      for(let i=0;i<4;i++){
        const x=(-0.35+i*0.23)*w;
        ctx.beginPath(); ctx.moveTo(x,-h*0.74); ctx.quadraticCurveTo(x+Math.sin(c.age+i)*tile*0.05,-h*0.56,x+tile*0.05,-h*0.34); ctx.stroke();
      }
    }else{
      for(let i=0;i<g.plates;i++){
        const x=(-0.34+i*(0.68/Math.max(1,g.plates-1)))*w;
        ctx.fillRect(x-tile*0.025,-h*0.78,tile*0.05,h*0.46);
      }
    }
    ctx.restore();
  }
  function drawGlowPattern(ctx,tile,g,w,h,c){
    const mode=(g.glowPattern|0)%5;
    const pulse=(Math.sin(c.age*5.5+g.pulse)+1)*0.5;
    ctx.save();
    ctx.globalAlpha=0.18+0.20*pulse;
    ctx.strokeStyle=mixColor(g.glow,'#ffffff',0.22);
    ctx.fillStyle=g.glow;
    ctx.lineWidth=Math.max(1,tile*0.04);
    if(mode===0){
      ctx.beginPath();
      ctx.arc(g.coreX*tile,-h*0.52,tile*(0.16+0.04*pulse),0,Math.PI*2);
      ctx.stroke();
    }else if(mode===1){
      for(let i=0;i<4;i++){
        const x=(-0.30+i*0.20)*w + g.asym*w*0.08;
        const y=-h*(0.38+0.07*(i%2));
        ctx.beginPath();
        ctx.arc(x,y,tile*(0.035+0.012*pulse),0,Math.PI*2);
        ctx.fill();
      }
    }else if(mode===2){
      ctx.beginPath();
      ctx.moveTo(g.coreX*tile,-h*0.72);
      ctx.lineTo(g.coreX*tile,-h*0.30);
      ctx.moveTo(g.coreX*tile,-h*0.55);
      ctx.lineTo(g.coreX*tile+w*0.22,-h*0.46);
      ctx.moveTo(g.coreX*tile,-h*0.48);
      ctx.lineTo(g.coreX*tile-w*0.20,-h*0.38);
      ctx.stroke();
    }else if(mode===3){
      for(let i=0;i<3;i++){
        const a=c.age*1.8+g.pulse+i*Math.PI*2/3;
        ctx.beginPath();
        ctx.arc(Math.cos(a)*w*0.36,-h*0.53+Math.sin(a)*h*0.22,tile*0.035,0,Math.PI*2);
        ctx.fill();
      }
    }else{
      for(let i=0;i<3;i++){
        const y=-h*(0.36+i*0.13);
        ctx.beginPath();
        ctx.moveTo(-w*0.22,y);
        ctx.lineTo(0,y-tile*0.07);
        ctx.lineTo(w*0.22,y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  function drawCompanion(ctx,tile,c){
    const g=c.genome || makeGenome(c.seed||1);
    const growth=(1+Math.min(0.46,c.biomass*0.018)+c.feedPulse*0.08)*g.size;
    const pulse=Math.sin(c.age*5.2+g.pulse)*0.04;
    const hit=c.hitPulse>0 ? Math.sin(c.hitPulse*32)*0.12 : 0;
    const px=c.x*tile, py=c.y*tile;
    const w=tile*((0.70*growth+Math.abs(g.asym)*0.12)*g.width);
    const h=tile*(0.86*growth+pulse);
    const facing=c.facing || 1;
    ctx.save();
    ctx.translate(px,py);
    ctx.scale(facing,1);
    ctx.globalAlpha=0.98;
    drawTail(ctx,tile,g,w,h,c);
    drawBackFeatures(ctx,tile,g,w,h,c);

    for(let i=0;i<g.tendrils;i++){
      const t=(i/(Math.max(1,g.tendrils-1)))-0.5;
      const sway=Math.sin(c.age*3+i)*tile*0.06;
      ctx.strokeStyle=mixColor(g.secondary,g.primary,0.35);
      ctx.lineWidth=Math.max(1,tile*0.055);
      ctx.beginPath();
      ctx.moveTo(t*w*0.55,-h*0.18);
      ctx.quadraticCurveTo((t*w*0.72)+sway,-h*0.55, t*w*0.48+sway*0.4,-h*(0.88+0.1*(i%2)));
      ctx.stroke();
    }

    drawLegs(ctx,tile,g,w,h,c);

    const grad=ctx.createRadialGradient(g.coreX*tile, -h*0.54, tile*0.08, g.coreX*tile, -h*0.48, Math.max(w,h)*0.72);
    grad.addColorStop(0,mixColor(g.glow,'#ffffff',0.28));
    grad.addColorStop(0.45,g.primary);
    grad.addColorStop(1,g.secondary);
    ctx.fillStyle=grad;
    ctx.strokeStyle=hit>0 ? '#f8fff2' : '#1b2b21';
    ctx.lineWidth=Math.max(1,tile*0.08);
    ctx.beginPath();
    if(g.body==='orb'){
      ctx.ellipse(0,-h*0.48,w*0.50,h*0.46,0,0,Math.PI*2);
    }else if(g.body==='runner'){
      if(ctx.roundRect) ctx.roundRect(-w*0.50,-h*0.87,w,h*0.70,tile*0.16);
      else ctx.rect(-w*0.50,-h*0.87,w,h*0.70);
    }else if(g.body==='spine'){
      ctx.moveTo(-w*0.48,-h*0.18);
      ctx.lineTo(-w*0.38,-h*0.76);
      ctx.lineTo(g.asym*w*0.35,-h*1.02);
      ctx.lineTo(w*0.48,-h*0.72);
      ctx.lineTo(w*0.42,-h*0.16);
      ctx.closePath();
    }else if(g.body==='crown'){
      ctx.moveTo(-w*0.50,-h*0.20);
      ctx.lineTo(-w*0.40,-h*0.72);
      ctx.lineTo(-w*0.10,-h*0.92);
      ctx.lineTo(w*0.12,-h*0.72);
      ctx.lineTo(w*0.42,-h*0.86);
      ctx.lineTo(w*0.50,-h*0.20);
      ctx.closePath();
    }else if(g.body==='beetle'){
      ctx.ellipse(0,-h*0.50,w*0.56,h*0.42,0,0,Math.PI*2);
      ctx.moveTo(0,-h*0.91); ctx.lineTo(0,-h*0.14);
    }else if(g.body==='lantern'){
      ctx.roundRect ? ctx.roundRect(-w*0.40,-h*0.92,w*0.80,h*0.72,tile*0.20) : ctx.rect(-w*0.40,-h*0.92,w*0.80,h*0.72);
    }else if(g.body==='blade'){
      ctx.moveTo(-w*0.50,-h*0.18);
      ctx.lineTo(-w*0.18,-h*0.90);
      ctx.lineTo(w*(0.08+g.shoulder),-h*1.06);
      ctx.lineTo(w*0.50,-h*0.22);
      ctx.closePath();
    }else if(g.body==='tripod'){
      ctx.moveTo(-w*0.46,-h*0.16);
      ctx.lineTo(0,-h*0.98);
      ctx.lineTo(w*0.46,-h*0.16);
      ctx.quadraticCurveTo(0,-h*0.36,-w*0.46,-h*0.16);
    }else{
      ctx.ellipse(0,-h*0.50,w*0.54,h*0.38,-0.05,0,Math.PI*2);
    }
    ctx.fill();
    ctx.stroke();

    drawMarkings(ctx,tile,g,w,h,c);

    ctx.fillStyle=g.glow;
    ctx.globalAlpha=0.86;
    ctx.beginPath();
    ctx.arc(g.coreX*tile,-h*0.52,tile*(0.09+Math.min(0.07,c.biomass*0.004)),0,Math.PI*2);
    ctx.fill();
    ctx.globalAlpha=0.98;

    drawGlowPattern(ctx,tile,g,w,h,c);

    const eyes=eyePositions(g,w,h);
    for(const e of eyes){
      const ex=e.x, ey=e.y, scale=e.s||1;
      ctx.fillStyle='#ecfff5';
      if(e.visor){
        ctx.fillRect(ex-tile*0.16*scale,ey-tile*0.035,tile*0.32*scale,tile*0.07);
        ctx.fillStyle=g.laser; ctx.fillRect(ex-tile*0.08*scale,ey-tile*0.018,tile*0.16*scale,tile*0.035);
        continue;
      }
      ctx.fillRect(ex-tile*0.055*scale,ey-tile*0.045*scale,tile*0.11*scale,tile*0.09*scale);
      ctx.fillStyle='#10242a';
      ctx.fillRect(ex+(c.facing>0?tile*0.018:-tile*0.028)*scale,ey-tile*0.025*scale,tile*0.035*scale,tile*0.05*scale);
    }

    ctx.strokeStyle=mixColor(g.glow,'#ffffff',0.15);
    ctx.lineWidth=Math.max(1,tile*0.055);
    const hornCount=g.crest==='horns' ? Math.max(g.horns,2) : g.horns;
    for(let i=0;i<hornCount;i++){
      const t=(i/(Math.max(1,g.horns-1)))-0.5;
      ctx.beginPath();
      ctx.moveTo(t*w*0.42,-h*0.82);
      ctx.lineTo(t*w*0.48+tile*0.08*Math.sign(t||0.4),-h*(1.02+0.04*i));
      ctx.stroke();
    }
    if(g.crest==='spines'){
      for(let i=0;i<g.plates;i++){
        const x=(-0.36+i*(0.72/Math.max(1,g.plates-1)))*w;
        ctx.beginPath(); ctx.moveTo(x,-h*0.78); ctx.lineTo(x+tile*0.03,-h*(0.96+0.02*(i%2))); ctx.stroke();
      }
    }
    if(g.antenna || g.crest==='antenna'){
      ctx.strokeStyle=g.glow;
      ctx.beginPath();
      ctx.moveTo(w*0.18,-h*0.78);
      ctx.quadraticCurveTo(w*0.38,-h*1.05,w*0.25,-h*1.18);
      ctx.stroke();
      ctx.fillStyle=g.glow;
      ctx.beginPath();
      ctx.arc(w*0.25,-h*1.18,tile*0.045,0,Math.PI*2);
      ctx.fill();
    }
    ctx.restore();

    if(c.hp<c.maxHp){
      const bw=tile*1.05, bh=Math.max(3,tile*0.11);
      ctx.fillStyle='rgba(0,0,0,0.48)';
      ctx.fillRect(px-bw*0.5,py-h-tile*0.24,bw,bh);
      ctx.fillStyle=c.hp/c.maxHp>0.35 ? '#7dff85' : '#ff6a5f';
      ctx.fillRect(px-bw*0.5,py-h-tile*0.24,bw*clamp(c.hp/c.maxHp,0,1),bh);
    }
    if(command.mode==='harvest'){
      const badge=command.awaiting ? '?' : 'pick';
      const by=py-h-tile*(c.hp<c.maxHp?0.50:0.28);
      ctx.save();
      ctx.font=Math.max(10,tile*0.48)+'px system-ui, sans-serif';
      ctx.textAlign='center';
      ctx.textBaseline='middle';
      const tw=ctx.measureText(badge).width+tile*0.36;
      ctx.fillStyle=command.awaiting ? 'rgba(20,24,31,0.82)' : 'rgba(25,56,37,0.78)';
      if(ctx.roundRect){
        ctx.beginPath();
        ctx.roundRect(px-tw*0.5,by-tile*0.25,tw,tile*0.50,tile*0.14);
        ctx.fill();
      }else{
        ctx.fillRect(px-tw*0.5,by-tile*0.25,tw,tile*0.50);
      }
      ctx.fillStyle=command.awaiting ? '#f4fbff' : '#b9ff9a';
      ctx.fillText(badge,px,by);
      ctx.restore();
    }
  }
  function draw(ctx,tile){
    if(!ctx || !tile) return;
    for(const l of lasers) drawLaser(ctx,tile,l);
    for(const c of list) drawCompanion(ctx,tile,c);
    for(const fx of deathFx) drawDeathFx(ctx,tile,fx);
  }
  function snapshot(){
    return {
      v:1,
      command:snapshotCommand(),
      list:list.map(c=>({
        id:c.id, seed:c.seed, name:c.name, x:c.x, y:c.y, vx:c.vx, vy:c.vy,
        hp:c.hp, maxHp:c.maxHp, biomass:c.biomass, facing:c.facing, age:c.age,
        laserCd:c.laserCd, gasCd:c.gasCd, genome:c.genome,
        harvestX:c.harvestX, harvestY:c.harvestY, harvestProgress:c.harvestProgress
      }))
    };
  }
  function restore(data,getTile){
    list.length=0;
    lasers.length=0;
    deathFx.length=0;
    setCommand(data && data.command ? data.command : {mode:'attack'});
    const arr=data && Array.isArray(data.list) ? data.list : [];
    for(const raw of arr.slice(0,MAX_COMPANIONS)){
      if(!raw || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) continue;
      const c=makeCompanion(raw);
      c.maxHp=maxHpForBiomass(c.biomass);
      c.hp=clamp(Number(raw.hp)||c.maxHp,1,c.maxHp);
      if(getTile && !clearAt(c.x,c.y,c,getTile)){
        c.y=Math.max(2,c.y-1);
      }
      list.push(c);
    }
    return true;
  }
  function reset(){
    list.length=0;
    lasers.length=0;
    deathFx.length=0;
    setCommand({mode:'attack'});
  }
  function metrics(){
    let hp=0,maxHp=0,biomass=0;
    for(const c of list){ hp+=c.hp; maxHp+=c.maxHp; biomass+=c.biomass; }
    return {count:list.length, hp:Math.round(hp), maxHp:Math.round(maxHp), biomass, lasers:lasers.length, mode:command.mode, awaitingHarvest:command.awaiting, harvestTile:command.harvestTile};
  }
  function debugList(){
    return list.map(c=>({id:c.id,name:c.name,x:c.x,y:c.y,hp:c.hp,maxHp:c.maxHp,biomass:c.biomass,laserCd:c.laserCd,gasCd:c.gasCd,genome:c.genome,harvestX:c.harvestX,harvestY:c.harvestY,harvestProgress:c.harvestProgress}));
  }
  const api={spawnFromCraft, feedNearest, hasActive:()=>list.length>0, count:()=>list.length, update, draw, damageAt, snapshot, restore, reset, metrics, commandAt, awaitingHarvestTarget, assignHarvestTarget,
    _debug:{list:debugList, command:()=>snapshotCommand(), setCommand, makeGenome, makeCompanion, traits:traitsFor, maxHpForBiomass, damage, nearest:debugNearest, spawn:debugSpawn, feed:debugFeed, setBiomass:debugSetBiomass, heal:debugHeal, damageNearest:debugDamage, kill:debugKill, teleportToHero:debugTeleportToHero, forceGas:debugForceGas, forceLaser:debugForceLaser, clear:debugClear}
  };
  MM.companions=api;
  return api;
})();

export { companions };
export default companions;
