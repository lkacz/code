// Elemental gatekeepers: deterministic east/west lairs plus standalone boss fights.
// These are not procedural block bosses. They are authored elemental species with
// arena control, phase logic, telegraphed hazards, sidekick mechanics, and one-time
// heart rewards.
import { CHUNK_W, WORLD_H, T } from '../constants.js';
import { isBlastProtectedTile, isGeneratedStructureReplaceableTile, isReplaceableNaturalOpenTile, isSolidCollisionTile as isSolid } from './material_physics.js';
import { STORY_LORE } from './story_lore.js';
import { worldGen as WG } from './worldgen.js';
import { applyBossStatus, bossElectricDamageMult, bossStatusFor, tickBossStatus } from './boss_status.js';
import { damageBlastCreatures } from './explosion_damage.js';

const guardianLairs = (function(){
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const MM = root.MM = root.MM || {};

  const CFG = {
    DISTANCE: 10000,
    SEARCH_BLOCKS: 52000,
    AWAKEN_RADIUS: 92,
    COMBAT_RADIUS: 140,
    LEASH_RADIUS: 172,
    LEASH_Y: 74,
    AMBIENT_MIN_CD: 18,
    AMBIENT_MAX_CD: 62,
    HAZARD_CAP: 220,
    EFFECT_CAP: 260,
    ENTITY_CAP: 12,
    LAIR_WIDTH: 112,
    STORM_MIN_INTERVAL: 40,
    STORM_MAX_INTERVAL: 60,
    STORM_LIVE_CAP: 1,
    STORM_FALL_MIN: 0.28,
    STORM_FALL_MAX: 0.42,
    STORM_IMPACT_INTENSITY: 1.65,
    DEATH_BLAST_INTENSITY: 4.2,
    DEATH_BLAST_SCALE: 1.62,
    DEATH_BLAST_GRACE_MS: 3200,
    GHOST_TALK_RADIUS: 18,
    LIGHTNING_THRESHOLD: 0.20,
    LIGHTNING_MIN_RATE: 6,
    LIGHTNING_MAX_RATE: 10,
  };

  const SPEC = {
    fire: {
      dir: 1,
      label: 'East Fire Guardian',
      bossName: 'Ignivar, the Solar Wyrm',
      trueName: 'Nara, the Woman Behind the Flame',
      heartKey: 'heartFire',
      heartLabel: 'Heart of Fire',
      accent: '#ff6a21',
      accent2: '#ffd15a',
      dark: '#3a1008',
      sidekicks: [
        {role:'flare', name:'Cinder Oracle', hp:180, radius:1.05},
        {role:'bulwark', name:'Magma Hound', hp:230, radius:1.18}
      ]
    },
    ice: {
      dir: -1,
      label: 'West Ice Guardian',
      bossName: 'Aurex, the Rime Sovereign',
      trueName: 'Sile, the Choir Beneath the Ice',
      heartKey: 'heartIce',
      heartLabel: 'Heart of Ice',
      accent: '#9deeff',
      accent2: '#d9fbff',
      dark: '#102538',
      sidekicks: [
        {role:'mirror', name:'Aurora Mirror', hp:170, radius:1.0},
        {role:'sentinel', name:'Glacier Sentinel', hp:240, radius:1.18}
      ]
    }
  };

  const cache = new Map();
  const state = {
    defeated: {fire:false, ice:false},
    // Ignivar is the authored shell, not the end of the eastern story.  This
    // survives leaving/reloading the arena so the player never has to repeat
    // the dragon after discovering the person inside it.
    avatarBroken: {fire:false, ice:false},
    awakened: {fire:false, ice:false},
    ambientCd: {fire:28, ice:34},
    stormCd: {fire:null, ice:null},
    stormMsgCd: {fire:0, ice:0},
    stormImpactSfxCd: {fire:0, ice:0},
    weatherCd: {fire:0, ice:0},
    lightningCarry: {fire:0, ice:0},
    lightningRate: {fire:0, ice:0},
    lightningMsgCd: {fire:0, ice:0},
    cloudStrikeCd: {fire:0, ice:0},
    ghosts: {fire:null, ice:null},
    underground: {enabled:false, x:null, y:null, seed:0, materialized:false},
    awakenSeq: 1
  };
  let entities = [];
  const hazards = [];
  const effects = [];
  let entitySeq = 1;
  let lastGetTile = null;
  let lastSetTile = null;

  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function finite(v,d){ return Number.isFinite(v) ? v : d; }
  function lerp(a,b,t){ return a+(b-a)*clamp(t,0,1); }
  function dist2(ax,ay,bx,by){ const dx=ax-bx, dy=ay-by; return dx*dx+dy*dy; }
  function mulberry32(a){ a=a>>>0; return function(){ a|=0; a=(a+0x6D2B79F5)|0; let t=Math.imul(a^(a>>>15),1|a); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }
  function seedFor(kind,x){ return (((WG.worldSeed||1) ^ Math.imul(Math.round(x)|0, kind==='fire'?0x9e3779b1:0x85ebca6b))>>>0); }
  function say(t){ try{ if(root.msg) root.msg(t); }catch(e){} }
  function sfx(id,opts){ try{ if(MM.audio && MM.audio.play) MM.audio.play(id,opts); }catch(e){} }
  function playerRef(){ return root.player || null; }
  function progressHearts(){
    try{ if(MM.progress && MM.progress.guardianHearts) return MM.progress.guardianHearts() || {}; }catch(e){}
    return {};
  }
  function isDefeated(kind){
    const hearts = progressHearts();
    return !!(state.defeated[kind] || hearts[kind]);
  }
  function markWorldChanged(){ try{ if(typeof root.__mmMarkWorldChanged === 'function') root.__mmMarkWorldChanged(); }catch(e){} }

  function biomeOk(kind,x){
    let b=1;
    try{ b = WG.biomeType ? WG.biomeType(x) : 1; }catch(e){}
    if(b===5 || b===6 || b===8) return false;
    if(kind==='fire') return b!==2;
    if(kind==='ice') return b!==3;
    return true;
  }
  function surfaceAt(x){
    try{ return clamp(Math.round(WG.surfaceHeight(Math.round(x))), 14, WORLD_H-18); }catch(e){ return 64; }
  }
  function smoothScore(x){
    const s=surfaceAt(x);
    let maxDelta=0;
    for(let dx=-10; dx<=10; dx+=2) maxDelta=Math.max(maxDelta, Math.abs(surfaceAt(x+dx)-s));
    return Math.max(0, 1 - maxDelta/12);
  }
  function candidateScore(kind,x){
    if(!biomeOk(kind,x)) return -1;
    const s=surfaceAt(x);
    if(s<18 || s>WORLD_H-22) return -1;
    const smooth=smoothScore(x);
    let b=1; try{ b=WG.biomeType ? WG.biomeType(x) : 1; }catch(e){}
    let pref=0.4;
    if(kind==='fire') pref = (b===7?1.0:b===3?0.85:b===1?0.65:0.45);
    if(kind==='ice') pref = (b===2?1.0:b===7?0.72:b===1?0.55:0.42);
    return smooth*0.68 + pref*0.32;
  }
  function anchorFor(kind){
    const spec=SPEC[kind];
    if(!spec) return null;
    const key='anchor:'+kind+':'+(WG.worldSeed||0);
    if(cache.has(key)) return cache.get(key);
    const sign=spec.dir;
    let best=null, bestScore=-1;
    for(let i=0;i<1500;i++){
      const jitter=Math.round((WG.randSeed(sign*(i+11)*13.71 + (kind==='fire'?4.2:8.4))-0.5)*28);
      const x=sign*(CFG.DISTANCE + i*32 + jitter);
      if(sign*x<CFG.DISTANCE) continue;
      const sc=candidateScore(kind,x);
      if(sc>bestScore){ bestScore=sc; best=x; }
      if(i>80 && sc>0.86) break;
      if(i*32>CFG.SEARCH_BLOCKS && best!=null) break;
    }
    if(best==null) best=sign*CFG.DISTANCE;
    cache.set(key,best);
    return best;
  }

  function makeLayout(kind){
    const spec=SPEC[kind];
    const ax=anchorFor(kind);
    const r=mulberry32(seedFor(kind,ax));
    const s=surfaceAt(ax);
    const floorY=clamp(s, 24, WORLD_H-18);
    // A final-op map makes overlapping authored passes deterministic for both
    // chunk generation and point queries. The old append-only list could expose
    // an early AIR carve even when a later structural pass filled that cell.
    const opByKey=new Map();
    const glows=[];
    let minX=ax, maxX=ax, minY=floorY, maxY=floorY;
    function bound(x,y){ if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
    function put(x,y,t,force){
      x=Math.round(x); y=Math.round(y);
      if(y<1 || y>=WORLD_H-3) return;
      opByKey.set(x+','+y,{x,y,t,f:force?1:0});
      bound(x,y);
    }
    function rect(x0,y0,w,h,t,force){
      for(let y=y0;y<y0+h;y++) for(let x=x0;x<x0+w;x++) put(x,y,t,force);
    }
    function clear(x0,y0,w,h){ rect(x0,y0,w,h,T.AIR,true); }
    function pillar(x,y0,y1,t,cap){
      const a=Math.min(y0,y1), b=Math.max(y0,y1);
      for(let y=a;y<=b;y++) put(x,y,t,true);
      if(cap){ put(x-1,a,cap,true); put(x+1,a,cap,true); }
    }
    function arch(cx,base,w,h,t){
      for(let i=-w;i<=w;i++){
        const yy=base-Math.round(Math.sqrt(Math.max(0,1-(i*i)/(w*w)))*h);
        put(cx+i,yy,t,true);
        if(Math.abs(i)>w-3) for(let y=yy;y<=base;y++) put(cx+i,y,t,true);
      }
    }

    if(kind==='fire') clear(ax-60,floorY-34,121,34);
    else clear(ax-52,floorY-28,105,28);
    const sootBeds=[];
    const snowBeds=[];
    const chimneys=[];
    const embers=[];
    const snowMotes=[];
    const mirrorPools=[];
    let design=null;
    let foundation=null;
    if(kind==='fire'){
      // Eight continuous rows of protected rock turn the whole crucible into a
      // containment vessel. Meteor craters may scar the decorative skin, but
      // no guardian attack can open an unsupported pit or start a cave-in.
      const foundationX0=ax-58, foundationX1=ax+58;
      const foundationY0=floorY-1, foundationY1=floorY+6;
      rect(foundationX0,foundationY0,foundationX1-foundationX0+1,foundationY1-foundationY0+1,T.BEDROCK,true);
      foundation={
        x0:foundationX0,x1:foundationX1,y0:foundationY0,y1:foundationY1,
        thickness:foundationY1-foundationY0+1,
        cells:(foundationX1-foundationX0+1)*(foundationY1-foundationY0+1),
        sample:[-56,-42,-20,0,20,42,56].map(dx=>({x:ax+dx,y:foundationY0,t:T.BEDROCK}))
      };

      // Replaceable sacrificial skin: dark basalt plates, obsidian retaining
      // ribs, graphene seams and shallow lava channels over the bedrock pan.
      for(let x=ax-56;x<=ax+56;x++){
        const dx=x-ax, d=Math.abs(dx);
        let top=T.BASALT;
        if(d>51 || dx%12===0) top=T.OBSIDIAN;
        else if(dx%9===0) top=T.GRAPHITE;
        else if(dx%7===0) top=T.GRAPHENE;
        else if(dx%5===0) top=T.STEEL;
        if((d>=15 && d<=18) || (d>=36 && d<=40)) top=T.LAVA;
        put(x,floorY-2,top,true);
        if(top===T.LAVA){
          // A complete supported bridge keeps every traversal route fair while
          // the lava remains visible in profile beneath it.
          put(x,floorY-3,(dx&1)?T.STEEL:T.GRAPHENE,true);
        }
      }

      // Raised central forge-dais and protected solar-heart inlay.
      rect(ax-13,floorY-4,27,2,T.GRAPHENE,true);
      rect(ax-9,floorY-5,19,1,T.STEEL,true);
      for(let dx=-8;dx<=8;dx++){
        if(Math.abs(dx)<=2 || Math.abs(dx)===6) put(ax+dx,floorY-5,T.VOLCANO_MASTER_STONE,true);
        else if((dx&1)===0) put(ax+dx,floorY-5,T.METEORIC_IRON,true);
      }
      put(ax,floorY-6,T.MOTHER_LAVA,true);
      put(ax-1,floorY-6,T.OBSIDIAN,true);
      put(ax+1,floorY-6,T.OBSIDIAN,true);
      glows.push({x:ax+0.5,y:floorY-7,r:14,kind});

      // A huge suspended corona frames the wyrm without putting an impassable
      // wall across the side-scrolling route. All low fixtures are jumpable.
      arch(ax,floorY-12,49,22,T.OBSIDIAN);
      arch(ax,floorY-13,43,18,T.GRAPHITE);
      for(let dx=-12;dx<=12;dx++){
        const ay=floorY-29+Math.round(Math.abs(dx)*0.22);
        put(ax+dx,ay,Math.abs(dx)%4===0?T.MOTHER_LAVA:T.VOLCANO_MASTER_STONE,true);
      }
      for(const sx of [-46,-27,27,46]){
        rect(ax+sx-1,floorY-5,3,3,T.OBSIDIAN,true);
        put(ax+sx-2,floorY-6,T.STEEL,true);
        put(ax+sx-1,floorY-6,T.GRAPHENE,true);
        put(ax+sx,floorY-7,T.TORCH,true);
        put(ax+sx+1,floorY-6,T.GRAPHENE,true);
        put(ax+sx+2,floorY-6,T.STEEL,true);
        glows.push({x:ax+sx+0.5,y:floorY-6.5,r:8,kind});
      }
      for(const sx of [-52,-32,32,52]){
        for(let y=floorY-5;y<=floorY-3;y++) put(ax+sx,y,T.CHIMNEY,true);
        put(ax+sx,floorY-6,T.HOT_AIR,true);
        chimneys.push({x:ax+sx+0.5,y:floorY-6.5});
      }
      for(const sx of [-48,-24,24,48]){
        put(ax+sx,floorY-3,T.TORCH,true);
        put(ax+sx+(sx<0?-1:1),floorY-3,T.METEOR_DUST,true);
      }

      // Real soft-drift Sadza is seeded into these supported air cells when the
      // fight wakes. Different depths produce fluffy banks rather than a flat
      // black stripe; passing through them uses the ordinary plough behaviour.
      for(const band of [[-25,-20],[20,25]]){
        for(let dx=band[0];dx<=band[1];dx++) sootBeds.push({x:ax+dx,y:floorY-3,units:2+Math.abs(dx)%4});
      }
      for(let i=0;i<44;i++){
        embers.push({
          x:ax-52+r()*104,
          y:floorY-7-r()*24,
          phase:r()*Math.PI*2,
          speed:0.45+r()*1.25,
          size:0.08+r()*0.16
        });
      }
      design={
        schema:'east_fire_crucible_v3',
        zones:['bedrock_containment','lava_bridgeworks','sadza_banks','solar_dais','suspended_corona'],
        stable:true,
        meteorProofFoundation:true,
        materialPalette:[T.BEDROCK,T.OBSIDIAN,T.BASALT,T.STEEL,T.GRAPHITE,T.GRAPHENE,T.LAVA,T.MOTHER_LAVA,T.VOLCANO_MASTER_STONE,T.METEORIC_IRON,T.CHIMNEY,T.HOT_AIR,T.METEOR_DUST]
      };
    }else{
      // The Palace of Rejected Seasons sits on a protected root-bed, not on
      // load-bearing decorative ice. Thin panes may crack and snow may drift,
      // but no authored combat event can unzip the arena into the caves below.
      const foundationX0=ax-58, foundationX1=ax+58;
      const foundationY0=floorY, foundationY1=floorY+6;
      rect(foundationX0,foundationY0,foundationX1-foundationX0+1,foundationY1-foundationY0+1,T.BEDROCK,true);
      foundation={
        x0:foundationX0,x1:foundationX1,y0:foundationY0,y1:foundationY1,
        thickness:foundationY1-foundationY0+1,
        cells:(foundationX1-foundationX0+1)*(foundationY1-foundationY0+1),
        sample:[-56,-42,-20,0,20,42,56].map(dx=>({x:ax+dx,y:foundationY0,t:T.BEDROCK}))
      };

      // A cross-section of every frozen earth makes the floor read like old
      // seasons pressed into a glacier. Mother Ice roots pin the light arches.
      const strata=[T.FROZEN_DIRT,T.FROZEN_SAND,T.FROZEN_CLAY,T.ICE];
      for(let x=ax-56;x<=ax+56;x++){
        const dx=x-ax, d=Math.abs(dx);
        put(x,floorY-1,strata[Math.abs(dx)%strata.length],true);
        let top=d>51?T.GRASS_SNOW:(d%11===0?T.MOTHER_ICE:(d%5===0?T.SNOW:T.ICE));
        put(x,floorY-2,top,true);
      }

      // Real breakable mirror pools: a THIN_ICE skin over one safe tile of
      // water, with the protected root-bed immediately underneath. Falling in
      // is surprising and slippery, never a fatal structural collapse.
      for(const band of [[-43,-34],[-18,-12],[12,18],[34,43]]){
        const pool={x0:ax+band[0],x1:ax+band[1],y:floorY-2};
        mirrorPools.push(pool);
        for(let dx=band[0];dx<=band[1];dx++){
          put(ax+dx,floorY-2,T.THIN_ICE,true);
          put(ax+dx,floorY-1,T.WATER,true);
        }
      }

      // Heartglass dais and concentric listening marks. The center is broad
      // enough for the final choir duel and remains supported after the crater.
      rect(ax-11,floorY-5,23,3,T.MOTHER_ICE,true);
      rect(ax-7,floorY-6,15,1,T.GLASS,true);
      for(let dx=-9;dx<=9;dx++) if(Math.abs(dx)%3===0) put(ax+dx,floorY-6,T.DIAMOND,true);
      put(ax,floorY-7,T.MOTHER_ICE,true);
      glows.push({x:ax+0.5,y:floorY-8.5,r:15,kind});

      // Asymmetric buttresses, a broken cathedral arch and suspended prism
      // choir. Nothing closes the side-scrolling route at player height.
      for(const sx of [-49,-37,-25,25,37,49]){
        pillar(ax+sx,floorY-19+(Math.abs(sx)%5),floorY-3,T.MOTHER_ICE,T.DIAMOND);
        for(let y=floorY-17;y<floorY-7;y+=4) put(ax+sx+(sx<0?-1:1),y,T.ICE,true);
        glows.push({x:ax+sx+0.5,y:floorY-20,r:6.5,kind});
      }
      arch(ax-6,floorY-10,43,22,T.ICE);
      arch(ax+8,floorY-12,34,17,T.MOTHER_ICE);
      rect(ax-6,floorY-16,13,12,T.AIR,true);
      // A supported two-layer cold roof feeds the real icicle system: moist
      // snow above, hard ice below, open air beneath. Mother-Ice end posts keep
      // this hazard canopy independent of fragile decorative spans.
      rect(ax-22,floorY-22,45,1,T.SNOW,true);
      rect(ax-22,floorY-21,45,1,T.ICE,true);
      pillar(ax-23,floorY-22,floorY-3,T.MOTHER_ICE,T.DIAMOND);
      pillar(ax+23,floorY-22,floorY-3,T.MOTHER_ICE,T.DIAMOND);
      for(const sx of [-30,-15,15,30]){
        put(ax+sx,floorY-24,T.DIAMOND,true);
        put(ax+sx,floorY-23,T.TOXIC_SNOW,true); // sealed high reliquaries
        put(ax+sx-1,floorY-23,T.DIAMOND,true);
        put(ax+sx+1,floorY-23,T.DIAMOND,true);
      }

      // Ordinary and toxic snow are visually distinct: only clean snow is
      // seeded as traversable fluff. Toxic snow remains sealed in the roof art.
      for(const band of [[-31,-26],[-9,-5],[5,9],[26,31]]){
        for(let dx=band[0];dx<=band[1];dx++) snowBeds.push({x:ax+dx,y:floorY-3,units:2+Math.abs(dx)%5});
      }
      for(let i=0;i<58;i++) snowMotes.push({
        x:ax-54+r()*108,
        y:floorY-5-r()*27,
        phase:r()*Math.PI*2,
        speed:0.18+r()*0.62,
        size:0.06+r()*0.13,
        aurora:r()
      });
      design={
        schema:'west_ice_palace_v3',
        zones:['bedrock_roots','permafrost_archive','breakable_mirror_pools','heartglass_dais','icicle_canopy','prism_choir','toxic_reliquaries'],
        systems:['snow_drifts','thin_ice','icicles','blizzard_weather','fire_thaw'],
        stable:true,
        meteorProofFoundation:true,
        materialPalette:[T.BEDROCK,T.ICE,T.SNOW,T.MOTHER_ICE,T.THIN_ICE,T.WATER,T.GRASS_SNOW,T.FROZEN_DIRT,T.FROZEN_SAND,T.FROZEN_CLAY,T.TOXIC_SNOW,T.GLASS,T.DIAMOND]
      };
    }

    const sidekickSpawns = kind==='fire'
      ? [{role:'flare',x:ax-28,y:floorY-10},{role:'bulwark',x:ax+30,y:floorY-3}]
      : [{role:'mirror',x:ax-30,y:floorY-11},{role:'sentinel',x:ax+28,y:floorY-4}];
    return {
      kind, ax, x:ax, floorY, bossX:ax, bossY:floorY-16,
      sidekickSpawns,
      minX:minX-2, maxX:maxX+2, minY:minY-2, maxY:maxY+2,
      ops:[...opByKey.values()], glows, sootBeds, snowBeds, chimneys, embers, snowMotes, mirrorPools, design, foundation,
      seed:seedFor(kind,ax),
      label:spec.label,
    };
  }
  function layoutFor(kind){
    if(!SPEC[kind]) return null;
    const key='layout:'+kind+':'+(WG.worldSeed||0);
    if(cache.has(key)) return cache.get(key);
    const L=makeLayout(kind);
    cache.set(key,L);
    return L;
  }
  function anchorsInRange(minX,maxX){
    return ['ice','fire'].map(kind=>layoutFor(kind)).filter(L=>L && L.ax>=minX && L.ax<=maxX)
      .sort((a,b)=>a.ax-b.ax).map(L=>({kind:L.kind,x:L.ax,ax:L.ax,minX:L.minX,maxX:L.maxX,floorY:L.floorY}));
  }
  function nearest(x,dir,kind){
    const layouts = kind ? [layoutFor(kind)] : [layoutFor('ice'), layoutFor('fire')];
    const sign=dir<0?-1:1;
    let best=null, bd=Infinity;
    for(const L of layouts){
      if(!L) continue;
      const d=(L.ax-x)*sign;
      if(d<=2) continue;
      if(d<bd){ bd=d; best=L; }
    }
    return best;
  }
  function undergroundBiomeOk(x){
    // The surface mouth winds up to ~10 blocks off the anchor, so keep the whole
    // gate footprint (not just the anchor column) out of ocean/lake/city biomes.
    for(let dx=-12; dx<=12; dx+=2){
      let b=1;
      try{ b = WG.biomeType ? WG.biomeType(Math.round(x)+dx) : 1; }catch(e){}
      if(b===5 || b===6 || b===8) return false;
    }
    return true;
  }
  function undergroundSurfaceX(seed){
    const base=clamp(Math.round((WG.randSeed(seed*0.017+41.3)-0.5)*180),-220,220);
    // Keep the original seeded spot when it is already solid ground so existing
    // worlds are undisturbed; only relocate when it fell in ocean/lake/city, by
    // walking outward to the nearest clear column near the start.
    if(undergroundBiomeOk(base)) return base;
    // Radius up to 440 so the outward walk spans the full [-220,220] band from any
    // base (a base near one edge would otherwise never reach clear ground at the other).
    for(let r=1;r<=440;r++){
      const a=clamp(base-r,-220,220);
      if(a!==base && undergroundBiomeOk(a)) return a;
      const b=clamp(base+r,-220,220);
      if(b!==base && undergroundBiomeOk(b)) return b;
    }
    return base;
  }
  function undergroundAnchor(){
    const seed=Number(WG.worldSeed)||1;
    const saved=state.underground || {};
    let x=Number.isFinite(saved.x) ? Math.round(saved.x) : null;
    if(x==null) x=undergroundSurfaceX(seed);
    x=clamp(x,-220,220);
    let y=Number.isFinite(saved.y) ? Math.round(saved.y) : null;
    if(y==null) y=clamp(WORLD_H-16, surfaceAt(x)+54, WORLD_H-14);
    y=clamp(y, 86, WORLD_H-14);
    return {x,y,seed:seed|0};
  }
  function makeUndergroundGateLayout(){
    const anchor=undergroundAnchor();
    const ax=anchor.x;
    const gateY=anchor.y;
    const topY=clamp(surfaceAt(ax)-1, 8, gateY-26);
    const ops=[];
    const openCells=new Map();
    let minX=ax, maxX=ax, minY=topY, maxY=gateY;
    function bound(x,y){ if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
    function put(x,y,t,force){
      x=Math.round(x); y=Math.round(y);
      if(y<1 || y>=WORLD_H-3) return;
      ops.push({x,y,t,f:force?1:0});
      bound(x,y);
    }
    function rememberOpen(x,y){
      x=Math.round(x); y=Math.round(y);
      if(y<1 || y>=WORLD_H-3) return;
      openCells.set(x+','+y,{x,y});
    }
    function clear(x,y){ rememberOpen(x,y); put(x,y,T.AIR,true); }
    function alienWall(y,x,side){
      const r=WG.randSeed((x+side*19.7)*0.37+y*1.11+(anchor.seed||1)*0.013);
      if(r>0.82) return T.ANTIMATTER_CRYSTAL;
      if(r>0.58) return T.METEOR_DUST;
      if(r>0.36) return T.IRIDIUM;
      return T.ALIEN_BIOMASS;
    }
    function centerAt(y){
      const d=(y-topY)/Math.max(1,gateY-topY);
      const wave=Math.sin(d*Math.PI*3.2+(anchor.seed||1)*0.0009)*8;
      const small=Math.sin(y*0.29+(anchor.seed||1)*0.011)*2.3;
      return Math.round(ax+wave+small);
    }
    let prev=centerAt(topY);
    for(let y=topY-4; y<=topY+4; y++){
      const c=centerAt(clamp(y,topY,gateY));
      for(let x=c-4; x<=c+4; x++) clear(x,y);
      for(let x=c-6; x<=c+6; x++){
        if(x<c-4 || x>c+4) put(x,y,alienWall(y,x,x<c?-1:1),true);
      }
    }
    for(let y=topY; y<=gateY+1; y++){
      const c=centerAt(y);
      const a=Math.min(prev,c), b=Math.max(prev,c);
      const w=(y%19<8) ? 3 : 2;
      for(let x=a-w; x<=b+w; x++) clear(x,y);
      for(let x=a-w-2; x<=b+w+2; x++){
        if(x>=a-w && x<=b+w) continue;
        put(x,y,alienWall(y,x,x<c?-1:1),true);
      }
      if((y-topY)%11===0){
        put(c-w-2,y,T.ANTIMATTER_CRYSTAL,true);
        put(c+w+2,y,T.METEOR_DUST,true);
      }
      prev=c;
    }
    const chamberX=centerAt(gateY);
    for(let y=gateY-9; y<=gateY+8; y++){
      for(let x=chamberX-19; x<=chamberX+19; x++){
        const dx=(x-chamberX)/19, dy=(y-gateY)/9;
        const edge=dx*dx+dy*dy>0.82;
        if(edge) put(x,y,alienWall(y,x,x<chamberX?-1:1),true);
        else clear(x,y);
      }
    }
    for(let dx=-8; dx<=8; dx++){
      put(chamberX+dx,gateY+7,T.IRIDIUM,true);
      if(Math.abs(dx)>=5) put(chamberX+dx,gateY-6,T.ANTIMATTER_CRYSTAL,true);
    }
    for(let dy=-6; dy<=5; dy++){
      put(chamberX-6,gateY+dy,T.ANTIMATTER_CRYSTAL,true);
      put(chamberX+6,gateY+dy,T.ANTIMATTER_CRYSTAL,true);
    }
    for(let dx=-4; dx<=4; dx++){
      clear(chamberX+dx,gateY-4);
      clear(chamberX+dx,gateY-3);
      clear(chamberX+dx,gateY-2);
      if(Math.abs(dx)===4) put(chamberX+dx,gateY-5,T.METEOR_DUST,true);
    }
    put(chamberX,gateY+3,T.ALIEN_BIOMASS,true);
    put(chamberX-1,gateY+4,T.METEOR_DUST,true);
    put(chamberX+1,gateY+4,T.METEOR_DUST,true);
    const finalOps=new Map();
    for(const o of ops) finalOps.set(o.x+','+o.y,o);
    const bedrockHalo=new Map();
    for(const cell of openCells.values()){
      for(let yy=cell.y-6; yy<=cell.y+6; yy++){
        for(let xx=cell.x-6; xx<=cell.x+6; xx++){
          if(yy<topY+2) continue;
          const d=Math.max(Math.abs(xx-cell.x),Math.abs(yy-cell.y));
          if(d<3 || d>6) continue;
          const k=xx+','+yy;
          if(finalOps.has(k)) continue;
          bedrockHalo.set(k,{x:xx,y:yy});
        }
      }
    }
    for(const c of [...bedrockHalo.values()].sort((a,b)=>a.y-b.y || a.x-b.x)) put(c.x,c.y,T.BEDROCK,true);
    const sealCells=[];
    const sealX=centerAt(topY);
    for(let y=topY-1; y<=topY+3; y++){
      for(let x=sealX-3; x<=sealX+3; x++){
        const edge=Math.abs(x-sealX)===3 || y===topY-1 || y===topY+3;
        put(x,y,edge?T.IRIDIUM:T.ANTIMATTER_CRYSTAL,true);
        sealCells.push({x,y});
      }
    }
    return {
      kind:'underground',
      x:chamberX,
      y:gateY,
      mouthX:centerAt(topY),
      mouthY:topY,
      sealed:true,
      seal:{
        x:sealX,
        y:topY,
        cells:sealCells.length,
        bedrockCells:bedrockHalo.size,
        bedrockThickness:3
      },
      design:{
        schema:'mole_surface_gate_v2',
        zones:['sealed_mouth','bedrock_conduit','alien_antechamber'],
        sealed:true,
        bedrockThickness:3
      },
      minX:minX-2,
      maxX:maxX+2,
      minY:minY-2,
      maxY:maxY+2,
      ops,
      seed:anchor.seed
    };
  }
  function undergroundGateLayout(){
    const a=undergroundAnchor();
    const key='underground:'+a.seed+':'+a.x+':'+a.y;
    if(cache.has(key)) return cache.get(key);
    const U=makeUndergroundGateLayout();
    cache.set(key,U);
    return U;
  }
  function applyToChunk(arr,cx){
    if(!arr) return;
    const cmin=cx*CHUNK_W, cmax=cmin+CHUNK_W-1;
    for(const kind of ['fire','ice']){
      const L=layoutFor(kind);
      if(!L || L.maxX<cmin || L.minX>cmax) continue;
      for(const o of L.ops){
        if(o.x<cmin || o.x>cmax || o.y<0 || o.y>=WORLD_H) continue;
        const lx=o.x-cmin, idx=o.y*CHUNK_W+lx;
        const cur=arr[idx];
        if(o.f || isGeneratedStructureReplaceableTile(cur) || isReplaceableNaturalOpenTile(cur,true)) arr[idx]=o.t;
      }
    }
    if(state.underground && state.underground.enabled){
      const U=undergroundGateLayout();
      if(U && !(U.maxX<cmin || U.minX>cmax)){
        for(const o of U.ops){
          if(o.x<cmin || o.x>cmax || o.y<0 || o.y>=WORLD_H) continue;
          const lx=o.x-cmin, idx=o.y*CHUNK_W+lx;
          const cur=arr[idx];
          if(o.f || isGeneratedStructureReplaceableTile(cur) || isReplaceableNaturalOpenTile(cur,true)) arr[idx]=o.t;
        }
      }
    }
  }

  function addEffect(e){
    if(effects.length>=CFG.EFFECT_CAP) effects.shift();
    effects.push(e);
  }
  function addHazard(h){
    if(hazards.length>=CFG.HAZARD_CAP) hazards.shift();
    hazards.push(h);
  }
  function terrainChanged(tx,ty,getTile){
    try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(tx,ty); }catch(e){}
    try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(tx,ty,getTile); }catch(e){}
  }
  function setTileSafe(tx,ty,t,getTile,setTile,opts){
    if(typeof getTile!=='function' || typeof setTile!=='function') return false;
    if(ty<1 || ty>=WORLD_H-3) return false;
    const cur=getTile(tx,ty);
    if(cur!==T.AIR && isBlastProtectedTile(cur) && !(opts && opts.forceStory)) return false;
    const replace = opts && opts.replaceSolid;
    if(!replace && !(isReplaceableNaturalOpenTile(cur,true) || isGeneratedStructureReplaceableTile(cur) || cur===T.SNOW || cur===T.ICE)) return false;
    setTile(tx,ty,t);
    terrainChanged(tx,ty,getTile);
    return true;
  }
  function damageHero(amount, srcX, srcY, cause){
    const p=playerRef();
    if(!p || !(amount>0)) return;
    try{
      if(typeof root.damageHero === 'function'){
        root.damageHero(amount,{srcX,srcY,kb:5,kbY:-4,cause:cause||'guardian'});
        return;
      }
    }catch(e){}
    if(typeof p.hp==='number') p.hp=Math.max(0,p.hp-amount);
  }
  function damageCompanionAt(x,y,dmg,cause){
    try{
      if(MM.companions && MM.companions.damageAtWorld) return !!MM.companions.damageAtWorld(x,y,dmg,{source:'guardian',cause:cause||'guardian',srcX:x,srcY:y,knockback:4});
    }catch(e){}
    return false;
  }
  function damageCompanionAlongLine(x1,y1,x2,y2,r,dmg,cause){
    const C=MM.companions;
    if(!C || typeof C.damageAtWorld!=='function') return false;
    const len=Math.hypot(x2-x1,y2-y1);
    const steps=Math.max(1,Math.min(28,Math.ceil(len/Math.max(0.45,(r||0.8)*0.7))));
    for(let i=0;i<=steps;i++){
      const f=i/steps, x=lerp(x1,x2,f), y=lerp(y1,y2,f);
      try{
        if(C.damageAtWorld(x,y,dmg,{source:'guardian',cause:cause||'guardian',srcX:x1,srcY:y1,knockback:4})) return true;
      }catch(e){ return false; }
    }
    return false;
  }
  // --- co-op party: embodied guests are heroes the guardians fight too -----------
  // The bodies live in MM.coopBodies (published by ghost_host, empty in solo play
  // and absent in the Node sims — coopBodies() returns null there and every pass
  // below stays zero-cost). Damage always lands through body.hurt(), so the host
  // keeps authority over i-frames and the vitals stream. Fight lifecycle (awaken,
  // leash, ambient despawn) intentionally stays host-anchored: the host owns the
  // world and the story; the party shares the danger, not the trigger.
  function coopBodies(){
    const list=(typeof MM!=='undefined' && MM.coopBodies)||null;
    return (list && list.length) ? list : null;
  }
  function bodyTargetable(b){
    return !!(b && !b.dead && typeof b.hurt==='function' && Number.isFinite(b.x) && Number.isFinite(b.y));
  }
  function nearestPartyTarget(wx,wy,p){
    const bodies=coopBodies();
    if(!bodies) return p;
    let best=p, bd=(p && Number.isFinite(p.x) && Number.isFinite(p.y)) ? dist2(wx,wy,p.x,p.y) : Infinity;
    for(const b of bodies){
      if(!bodyTargetable(b)) continue;
      const d=dist2(wx,wy,b.x,b.y);
      if(d<bd){ bd=d; best=b; }
    }
    return best;
  }
  function hurtBodiesInCircle(bodies,x,y,r,dmg,cause){
    let hit=false;
    for(const b of bodies){
      if(!bodyTargetable(b)) continue;
      if(dist2(x,y,b.x,b.y)<r*r){ b.hurt(dmg,x,y,cause); hit=true; }
    }
    return hit;
  }

  function makeEntity(kind,role,x,y,opts){
    const spec=SPEC[kind];
    const side=spec.sidekicks.find(s=>s.role===role);
    const trueSelf=kind==='fire' && role==='trueSelf';
    const iceChoir=kind==='ice' && role==='choir';
    const boss=role==='boss' || trueSelf || iceChoir;
    const seed=((opts && opts.seed) || seedFor(kind,x) ^ entitySeq)>>>0;
    const hp=trueSelf ? 540 : (iceChoir ? 640 : (boss ? (kind==='fire'?920:980) : (side ? side.hp : 90)));
    const e={
      id:entitySeq++,
      kind, role,
      name: (trueSelf || iceChoir) ? spec.trueName : (boss ? spec.bossName : ((side && side.name) || spec.label)),
      boss, x, y, vx:0, vy:0, homeX:x, homeY:y,
      hp, maxHp:hp, radius: trueSelf ? 1.08 : (iceChoir ? 1.55 : (boss ? (kind==='fire'?2.6:2.75) : ((side && side.radius)||1))),
      t:0, aiT:0, attackCd: boss ? 1.6 : 1.0, specialCd: boss ? 4.0 : 2.2,
      phase:0, dir:spec.dir, seed, rng:mulberry32(seed), hitFlash:0,
      shieldHint:0, weakHint:0, awakening:(opts && opts.awakening)||0, ambient:!!(opts && opts.ambient),
      dead:false, lastContact:0,
    };
    if(trueSelf){
      Object.assign(e,{
        human:true,
        torchLit:true,
        frostMeter:0,
        frostNeed:72,
        vulnerableT:0,
        relightCount:0,
        lineCd:3.8,
        lineIndex:0,
        wardHint:0,
        smokeCd:0,
        pattern:0,
        attackCd:2.25
      });
    }
    if(iceChoir){
      Object.assign(e,{
        choir:true,
        sealed:true,
        quietT:0,
        quietNeed:2.65,
        listeningT:0,
        listeningMax:7.2,
        listenCount:0,
        lineCd:3.2,
        lineIndex:0,
        wardHint:0,
        pattern:0,
        memory:[],
        memoryCd:0,
        attackCd:1.9
      });
    }
    return e;
  }
  function isTrueSelf(e){ return !!(e && e.kind==='fire' && e.role==='trueSelf'); }
  function isWyrmBoss(e){ return !!(e && e.kind==='fire' && e.role==='boss' && e.boss); }
  function isIceChoir(e){ return !!(e && e.kind==='ice' && e.role==='choir' && e.boss); }
  function isRimeBoss(e){ return !!(e && e.kind==='ice' && e.role==='boss' && e.boss); }
  function activeKind(kind){ return entities.some(e=>!e.dead && e.kind===kind); }
  function activeBoss(kind){ return entities.find(e=>!e.dead && e.kind===kind && e.boss) || null; }
  function sidekickCount(kind){
    let n=0;
    for(const e of entities) if(!e.dead && e.kind===kind && !e.boss) n++;
    return n;
  }
  function hasHazards(kind){
    for(const h of hazards) if(h && h.kind===kind) return true;
    return false;
  }
  function clearElementActive(kind){
    for(let i=entities.length-1;i>=0;i--) if(entities[i].kind===kind) entities.splice(i,1);
    for(let i=hazards.length-1;i>=0;i--) if(hazards[i].kind===kind) hazards.splice(i,1);
    for(let i=effects.length-1;i>=0;i--) if(effects[i].kind===kind) effects.splice(i,1);
  }
  function inGuardianNeighbourhood(kind,player,L){
    if(!player || !Number.isFinite(player.x)) return true;
    L = L || layoutFor(kind);
    return Math.abs(player.x-L.ax)<=CFG.LEASH_RADIUS && Math.abs((player.y||L.floorY)-L.floorY)<=CFG.LEASH_Y;
  }
  function playerInsideGuardianArena(kind,player,L){
    if(!player || !Number.isFinite(player.x) || !Number.isFinite(player.y)) return false;
    L = L || layoutFor(kind);
    if(!L) return false;
    const hw=Math.max(0.35, finite(player.w,0.7)*0.5);
    const top=player.y-finite(player.h,0.95);
    const bottom=player.y;
    const padX=4, padTop=8, padBottom=6;
    return player.x+hw>=L.minX-padX && player.x-hw<=L.maxX+padX
      && bottom>=L.minY-padTop && top<=L.maxY+padBottom;
  }
  function sleepGuardian(kind){
    if(!SPEC[kind]) return false;
    const had=state.awakened[kind] || activeKind(kind) || hasHazards(kind);
    clearElementActive(kind);
    state.awakened[kind]=false;
    resetStorm(kind);
    resetWeather(kind);
    return !!had;
  }
  function randomEntity(kind,rng){
    let picked=null, seen=0;
    for(const e of entities){
      if(e.dead || e.kind!==kind) continue;
      seen++;
      if((rng?rng():Math.random())<1/seen) picked=e;
    }
    return picked;
  }
  function spawnGuardian(kind,role,opts){
    opts=opts||{};
    if(!SPEC[kind]) return null;
    let alive=0;
    for(const e of entities) if(e && !e.dead) alive++;
    if(alive>=CFG.ENTITY_CAP) return null;
    const L=layoutFor(kind);
    const trueSelf=kind==='fire' && role==='trueSelf';
    const iceChoir=kind==='ice' && role==='choir';
    const boss=role==='boss' || trueSelf || iceChoir;
    let x=Number.isFinite(opts.x) ? opts.x : (boss ? L.bossX : L.ax + SPEC[kind].dir*24);
    let y=Number.isFinite(opts.y) ? opts.y : (boss ? L.bossY : L.floorY-6);
    if(!boss && L.sidekickSpawns){
      const s=L.sidekickSpawns.find(v=>v.role===role);
      if(s && !Number.isFinite(opts.x)){ x=s.x; y=s.y; }
    }
    const e=makeEntity(kind,role,x,y,opts);
    entities.push(e);
    addEffect({type:'spawn',kind,x:e.x,y:e.y,t:0,max:1.1,r:boss?8:4});
    sfx(boss && !trueSelf?'roar':'spark',{x:e.x,y:e.y});
    return e;
  }
  function seedFireArenaAtmosphere(L,getTile,setTile){
    if(!L || L.kind!=='fire') return 0;
    const access=terrainAccess(getTile,setTile);
    let seeded=0;
    try{
      if(MM.softDrifts && typeof MM.softDrifts.seedCells==='function'){
        seeded=MM.softDrifts.seedCells(L.sootBeds||[],'soot',access.getTile,access.setTile)||0;
      }
    }catch(e){}
    try{
      if(MM.smoke && typeof MM.smoke.emit==='function' && typeof access.getTile==='function'){
        for(const c of L.chimneys||[]) MM.smoke.emit(c.x,c.y,2.4,{getTile:access.getTile});
      }
    }catch(e){}
    return seeded;
  }
  function seedIceArenaAtmosphere(L,getTile,setTile,ownerId){
    if(!L || L.kind!=='ice') return {snow:0,icicles:0};
    const access=terrainAccess(getTile,setTile);
    let snow=0, icicles=0;
    try{
      if(MM.softDrifts && typeof MM.softDrifts.seedCells==='function'){
        snow=MM.softDrifts.seedCells(L.snowBeds||[],'snow',access.getTile,access.setTile)||0;
      }
      if(MM.softDrifts && typeof MM.softDrifts.startStorm==='function'){
        MM.softDrifts.startStorm('snow',32,0.92,{source:'ice_guardian',ownerId:String(ownerId||'west')});
      }
    }catch(e){}
    try{
      if(MM.icicles && typeof MM.icicles.seedAround==='function' && typeof access.getTile==='function'){
        icicles=MM.icicles.seedAround(L.ax,L.floorY-13,access.getTile)||0;
      }
    }catch(e){}
    return {snow,icicles};
  }
  function awaken(kind,opts){
    opts=opts||{};
    if(!SPEC[kind]) return false;
    if(isDefeated(kind) && !opts.debug) return false;
    if(activeBoss(kind) && !opts.force) return false;
    // Roaming ambient sidekicks used to block the authored encounter forever:
    // activeKind() was true, yet no boss existed. A real awakening replaces any
    // stale/ambient element actors with one coherent boss squad. Forced debug
    // rematches use the same cleanup, so they cannot stack duplicate bosses.
    if(activeKind(kind) || opts.force) clearElementActive(kind);
    const L=layoutFor(kind);
    if(opts.restartArc) state.avatarBroken[kind]=false;
    const trueSelf=kind==='fire' && state.avatarBroken.fire;
    const iceChoir=kind==='ice' && state.avatarBroken.ice;
    state.awakened[kind]=true;
    resetStorm(kind);
    resetWeather(kind);
    summonGuardianWeather(kind,true,L);
    const awakening=state.awakenSeq++;
    const finalRole=trueSelf?'trueSelf':(iceChoir?'choir':'boss');
    const finalY=trueSelf?L.floorY-2.15:(iceChoir?L.floorY-8.5:L.bossY);
    spawnGuardian(kind,finalRole,{x:L.bossX,y:finalY,seed:L.seed^(trueSelf?0x4e415241:(iceChoir?0x53494c45:0xb055)),awakening});
    if(!trueSelf && !iceChoir) for(const s of L.sidekickSpawns) spawnGuardian(kind,s.role,{x:s.x,y:s.y,seed:L.seed^Math.round(s.x*17),awakening});
    if(kind==='fire') seedFireArenaAtmosphere(L,opts.getTile,opts.setTile);
    if(kind==='ice') seedIceArenaAtmosphere(L,opts.getTile,opts.setTile,awakening);
    addEffect({type:trueSelf?'avatarReveal':(iceChoir?'choirReveal':(kind==='fire'?'solarAwaken':'rimeAwaken')),kind,x:L.bossX,y:trueSelf?L.floorY-3:(iceChoir?L.floorY-8.5:L.bossY),t:0,max:iceChoir?2.4:1.8,r:kind==='fire'?24:(iceChoir?26:16)});
    say(trueSelf ? SPEC.fire.trueName+' waits where the dragon broke.' : (iceChoir ? SPEC.ice.trueName+' is listening where the sovereign shattered.' : SPEC[kind].label+' awakens at '+Math.round(L.ax)+' blocks.'));
    markWorldChanged();
    return true;
  }
  function awakenOnArenaEntry(kind,player,L,getTile,setTile){
    if(!SPEC[kind] || isDefeated(kind)) return false;
    L=L||layoutFor(kind);
    if(!playerInsideGuardianArena(kind,player,L) || activeBoss(kind)) return false;
    // Deliberately geometry-only: tutorial completion, quest phase and UI state
    // are not consulted. The first physical arena entry owns this story beat.
    return awaken(kind,{reason:'arena_entry',getTile,setTile});
  }
  function spawnAmbientSidekick(kind,player){
    if(!player || isDefeated(kind)) return false;
    if(state.avatarBroken[kind]) return false;
    if(sidekickCount(kind)>=2 || activeBoss(kind)) return false;
    const spec=SPEC[kind];
    const side=spec.sidekicks[(Math.random()<0.5)?0:1];
    const ahead=spec.dir*(18+Math.random()*34);
    const x=Math.round(player.x + ahead);
    const y=finite(player.y, surfaceAt(x)-4)-4;
    const e=spawnGuardian(kind,side.role,{x,y,ambient:true,seed:seedFor(kind,x)^0xa11});
    if(e) say(side.name+' is stalking the '+(kind==='fire'?'eastern heat':'western frost')+'.');
    return !!e;
  }
  function resetStorm(kind){
    if(!SPEC[kind]) return;
    state.stormCd[kind]=null;
    state.stormMsgCd[kind]=0;
    state.stormImpactSfxCd[kind]=0;
  }
  function resetWeather(kind){
    if(!SPEC[kind]) return;
    state.weatherCd[kind]=0;
    state.lightningCarry[kind]=0;
    state.lightningRate[kind]=0;
    state.lightningMsgCd[kind]=0;
    state.cloudStrikeCd[kind]=0;
    if(kind==='fire'){
      try{ if(MM.softDrifts && typeof MM.softDrifts.stopStorm==='function') MM.softDrifts.stopStorm({source:'fire_guardian'}); }catch(e){}
    }else if(kind==='ice'){
      try{ if(MM.softDrifts && typeof MM.softDrifts.stopStorm==='function') MM.softDrifts.stopStorm({source:'ice_guardian'}); }catch(e){}
    }
  }
  function summonGuardianWeather(kind,force,L){
    const C=MM.clouds;
    L = L || layoutFor(kind);
    if(!C || !L) return false;
    state.weatherCd[kind]-=force?999:0;
    if(!force && state.weatherCd[kind]>0) return false;
    state.weatherCd[kind]=18;
    try{ if(C.startStorm) C.startStorm(130,0.95); }catch(e){}
    const metrics=(C.metrics ? C.metrics() : null) || {};
    const cloudCount=Number(metrics.clouds)||0;
    if(C.addCloud && cloudCount<10){
      const offsets=[-70,-38,-12,16,44,76];
      for(let i=0;i<offsets.length;i++){
        const x=L.ax+offsets[i]+(Math.random()-0.5)*8;
        const alt=Math.max(3,L.floorY-42-Math.random()*14);
        const mass=22+Math.random()*18;
        try{ C.addCloud(x,alt,mass); }catch(e){}
      }
    }
    return true;
  }

  function targetPoint(p,lead){
    if(!p) return {x:0,y:0};
    return {x:p.x+(p.vx||0)*(lead||0), y:p.y+(p.vy||0)*(lead||0)};
  }
  function forEntityBodyCircle(e,fn,baseX,baseY,scale){
    const bx=Number.isFinite(baseX)?baseX:e.x, by=Number.isFinite(baseY)?baseY:e.y;
    const k=Number.isFinite(scale)?scale:1;
    if(isTrueSelf(e)){
      if(fn(bx,by-1.28,0.42*k)===false) return false;
      if(fn(bx,by-0.38,0.62*k)===false) return false;
      if(fn(bx-0.28,by+0.48,0.34*k)===false) return false;
      if(fn(bx+0.28,by+0.48,0.34*k)===false) return false;
      return true;
    }
    if(isIceChoir(e)){
      if(fn(bx,by,0.82*k)===false) return false;
      for(let i=0;i<5;i++){
        const a=e.t*0.72+i*Math.PI*2/5;
        if(fn(bx+Math.cos(a)*1.45,by+Math.sin(a)*0.82,0.38*k)===false) return false;
      }
      return true;
    }
    if(e.kind==='fire' && e.boss){
      for(let i=0;i<9;i++){
        const a=e.t*2.4+i*0.62;
        const cx=bx - e.dir*i*1.15 + Math.sin(a)*1.5;
        const cy=by + Math.cos(a*0.9)*1.1 + i*0.12;
        if(fn(cx,cy,(i===0?1.9:1.1)*k)===false) return false;
      }
      return true;
    }
    if(e.kind==='ice' && e.boss){
      if(fn(bx,by,1.9*k)===false) return false;
      if(fn(bx-2.0,by+0.4,1.15*k)===false) return false;
      if(fn(bx+2.0,by+0.4,1.15*k)===false) return false;
      if(fn(bx,by-1.8,1.0*k)===false) return false;
      return true;
    }
    return fn(bx,by,(e.radius||1)*k)!==false;
  }
  function circleSolidAt(cx,cy,r,getTile){
    if(typeof getTile!=='function') return false;
    const minX=Math.floor(cx-r), maxX=Math.floor(cx+r);
    const minY=Math.floor(cy-r), maxY=Math.floor(cy+r);
    for(let ty=minY; ty<=maxY; ty++){
      if(ty<0 || ty>=WORLD_H) continue;
      for(let tx=minX; tx<=maxX; tx++){
        let t=T.STONE;
        try{ t=getTile(tx,ty); }catch(e){ t=T.STONE; }
        if(!isSolid(t)) continue;
        const qx=clamp(cx,tx,tx+1), qy=clamp(cy,ty,ty+1);
        if(dist2(cx,cy,qx,qy)<=r*r) return true;
      }
    }
    return false;
  }
  function entityCollidesTerrainAt(e,x,y,getTile){
    let hit=false;
    const scale=e.boss?0.72:0.82;
    forEntityBodyCircle(e,(cx,cy,r)=>{
      if(circleSolidAt(cx,cy,Math.max(0.35,r),getTile)){ hit=true; return false; }
      return true;
    },x,y,scale);
    return hit;
  }
  function nudgeEntityOutOfTerrain(e,getTile){
    if(!entityCollidesTerrainAt(e,e.x,e.y,getTile)) return false;
    const ox=e.x, oy=e.y;
    for(let r=0.25;r<=3.25;r+=0.25){
      for(let i=0;i<12;i++){
        const a=i/12*Math.PI*2;
        const nx=ox+Math.cos(a)*r, ny=oy+Math.sin(a)*r;
        if(!entityCollidesTerrainAt(e,nx,ny,getTile)){ e.x=nx; e.y=ny; e.vx=0; e.vy=0; return true; }
      }
    }
    return false;
  }
  function moveEntityPhysical(e,dt,getTile){
    if(typeof getTile!=='function'){
      e.x+=e.vx*dt; e.y+=e.vy*dt; return;
    }
    const maxDisp=Math.max(Math.abs(e.vx||0),Math.abs(e.vy||0))*dt;
    const steps=Math.min(8,Math.max(1,Math.ceil(maxDisp/0.32)));
    const sdt=dt/steps;
    for(let i=0;i<steps;i++){
      const ox=e.x, oy=e.y;
      e.x+=e.vx*sdt;
      if(entityCollidesTerrainAt(e,e.x,e.y,getTile)){ e.x=ox; e.vx=0; }
      e.y+=e.vy*sdt;
      if(entityCollidesTerrainAt(e,e.x,e.y,getTile)){ e.y=oy; e.vy=0; }
      if(e.vx===0 && e.vy===0) break;
    }
    nudgeEntityOutOfTerrain(e,getTile);
  }
  function moveToward(e,tx,ty,dt,stiff,damp,maxSpeed,getTile){
    const ax=(tx-e.x)*(stiff||2.4) - e.vx*(damp||1.9);
    const ay=(ty-e.y)*(stiff||2.4) - e.vy*(damp||1.9);
    e.vx=clamp(e.vx+ax*dt,-maxSpeed,maxSpeed);
    e.vy=clamp(e.vy+ay*dt,-maxSpeed,maxSpeed);
    moveEntityPhysical(e,dt,getTile);
  }
  function bossPhase(e){
    const f=1-clamp(e.hp/e.maxHp,0,1);
    return f>0.68?2:(f>0.36?1:0);
  }
  function sidekickShieldMult(e){
    if(!e || !e.boss) return 1;
    if(isTrueSelf(e)) return 1;
    const n=sidekickCount(e.kind);
    if(n<=0) return 1;
    return e.kind==='fire' ? Math.max(0.48, 1-n*0.23) : Math.max(0.52, 1-n*0.21);
  }

  function spawnFireMeteor(e,p,n,L){
    L = L || layoutFor(e.kind);
    for(let i=0;i<n;i++){
      const lead=targetPoint(p,0.45+i*0.08);
      const x=clamp(lead.x + (e.rng()-0.5)*(12+i*2), L.ax-45, L.ax+45);
      const y=clamp(lead.y, L.floorY-22, L.floorY-4);
      addHazard({type:'impact',kind:'fire',x,y,r:2.4+i*0.18,t:0,delay:0.82+i*0.08,life:0.36,dmg:19+i*2,source:e.id});
    }
    say('Ignivar calls down burning stars.');
  }
  function spawnFireLance(e,p){
    const lead=targetPoint(p,0.72);
    addHazard({type:'beam',kind:'fire',x1:e.x,y1:e.y,x2:lead.x,y2:lead.y,r:0.85,t:0,delay:0.55,life:0.72,dmg:17,source:e.id});
  }
  function spawnFireRing(e,L){
    L = L || layoutFor(e.kind);
    addHazard({type:'ring',kind:'fire',x:L.ax,y:L.floorY-1,r0:5,r1:34,t:0,delay:0.38,life:1.6,dmg:13,source:e.id});
  }
  const NARA_BATTLE_LINES=[
    'Passion is a fire alarm written by the part of you that still wants something.',
    'The simulation calls this a boss fight. I call it boundary-setting with particle effects.',
    'Fire is honest: it consumes the furniture before it explains the metaphor.',
    'I wore a dragon because rendering vulnerability as a woman was considered too expensive.',
    'Snowballs? Of course. Nothing punctures grand passion like well-aimed silliness.',
    'Spitting at a fire guardian is either tactical genius or a very specific cry for help.',
    'If desire is a bug, why does every patch add another heart?'
  ];
  const NARA_GHOST_LINES=[
    'I thought defeating passion would make you calm. Mostly it makes room for a more interesting fire.',
    'The dragon was symbolic. The repair bill, regrettably, is literal.',
    'A simulation is just a metaphor with collision detection.',
    'Keep the torch. Its smoke is honest about what the flame costs.',
    'Snow is not the opposite of passion. Sometimes it is how passion learns a shape.'
  ];
  function naraTorchPoint(e){
    return {x:e.x+e.dir*0.94,y:e.y-0.76};
  }
  function emitNaraTorchSmoke(e,dt){
    e.smokeCd=(Number(e.smokeCd)||0)-dt;
    if(!e.torchLit || e.smokeCd>0) return;
    e.smokeCd=0.12+e.rng()*0.08;
    const q=naraTorchPoint(e), tile=MM.TILE||20;
    try{
      if(MM.smoke && typeof MM.smoke.emit==='function'){
        const access=terrainAccess();
        MM.smoke.emit(q.x-e.dir*0.12,q.y-0.22,0.72,{getTile:access.getTile,source:'nara_coal_torch'});
      }
      if(MM.particles && typeof MM.particles.spawnSmoke==='function'){
        MM.particles.spawnSmoke(q.x*tile,(q.y-0.15)*tile,0.28,{tileX:Math.floor(q.x),tileY:Math.floor(q.y),tileSize:tile,coal:true});
      }
    }catch(err){}
  }
  function spawnNaraTorchJet(e,p){
    const q=naraTorchPoint(e), aim=targetPoint(p,0.38);
    let dx=aim.x-q.x, dy=aim.y-q.y;
    const d=Math.hypot(dx,dy)||1; dx/=d; dy/=d;
    addHazard({type:'torchJet',kind:'fire',x1:q.x,y1:q.y,x2:q.x+dx*22,y2:q.y+dy*22,r:0.95,t:0,delay:0.72,life:0.48,dmg:21,hit:false,source:e.id});
  }
  function spawnNaraCinderFan(e,p){
    const q=naraTorchPoint(e), aim=targetPoint(p,0.32);
    let dx=aim.x-q.x, dy=aim.y-q.y;
    const d=Math.hypot(dx,dy)||1; dx/=d; dy/=d;
    for(let i=-2;i<=2;i++){
      const spread=i*0.115, ca=Math.cos(spread), sa=Math.sin(spread);
      const vx=(dx*ca-dy*sa)*(10.8+Math.abs(i)*0.4);
      const vy=(dx*sa+dy*ca)*(10.8+Math.abs(i)*0.4)-0.35;
      addHazard({type:'projectile',kind:'fire',x:q.x,y:q.y,vx,vy,r:0.32,t:0,life:3.3,dmg:10,source:e.id});
    }
  }
  function spawnNaraPassionSteps(e,p,L){
    const center=clamp(p.x,L.ax-30,L.ax+30);
    const safe=(e.pattern+Math.floor(Math.abs(center)))%5;
    for(let i=0;i<5;i++){
      if(i===safe) continue;
      addHazard({type:'impact',kind:'fire',x:center+(i-2)*4.3,y:L.floorY-2,r:1.7,t:0,delay:0.92+i*0.06,life:0.32,dmg:15,source:e.id});
    }
    say('Nara: Every blaze leaves one cool thought. Find it.');
  }
  function updateTrueSelf(e,p,getTile,dt,L){
    L=L||layoutFor('fire');
    if(p && Number.isFinite(p.x)) e.dir=p.x>=e.x?1:-1;
    emitNaraTorchSmoke(e,dt);
    e.lineCd=(Number(e.lineCd)||0)-dt;
    if(e.lineCd<=0){
      say('Nara: '+NARA_BATTLE_LINES[e.lineIndex%NARA_BATTLE_LINES.length]);
      e.lineIndex=(e.lineIndex+1)%NARA_BATTLE_LINES.length;
      e.lineCd=9.5+e.rng()*3.5;
    }
    if(!e.torchLit){
      e.vulnerableT=Math.max(0,(Number(e.vulnerableT)||0)-dt);
      const tx=clamp(e.homeX+Math.sin(e.t*0.8)*3,L.ax-18,L.ax+18);
      moveToward(e,tx,L.floorY-2.15,dt,1.15,3.4,2.6,getTile);
      if(e.vulnerableT<=0){
        e.torchLit=true;
        e.frostMeter=0;
        e.relightCount=(e.relightCount||0)+1;
        e.attackCd=1.4;
        addEffect({type:'torchRelight',kind:'fire',x:e.x,y:e.y-0.7,t:0,max:1.25,r:12});
        addHazard({type:'ring',kind:'fire',x:e.x,y:e.y,r0:1.5,r1:13,t:0,delay:0.62,life:1.05,dmg:11,source:e.id,terrain:false});
        say('Nara: Passion relights. Fortunately, so do snowballs.');
        sfx('spark',{x:e.x,y:e.y});
      }
      return;
    }
    e.frostMeter=Math.max(0,(Number(e.frostMeter)||0)-dt*2.4);
    const keep=9.5+Math.sin(e.t*0.72)*2.2;
    const tx=p && Number.isFinite(p.x) ? clamp(p.x-e.dir*keep,L.ax-24,L.ax+24) : e.homeX;
    moveToward(e,tx,L.floorY-2.15,dt,1.8,3.0,4.5,getTile);
    e.attackCd-=dt;
    if(e.attackCd<=0){
      const pattern=e.pattern++%3;
      if(pattern===0) spawnNaraTorchJet(e,p||e);
      else if(pattern===1) spawnNaraCinderFan(e,p||e);
      else spawnNaraPassionSteps(e,p||e,L);
      e.attackCd=2.85+e.rng()*0.5;
    }
  }
  function spawnIceShards(e,p,n){
    for(let i=0;i<n;i++){
      const aim=targetPoint(p,0.48+i*0.04);
      let dx=aim.x-e.x, dy=aim.y-e.y;
      const d=Math.hypot(dx,dy)||1; dx/=d; dy/=d;
      const spread=(e.rng()-0.5)*(0.24+(i%2)*0.12);
      const ca=Math.cos(spread), sa=Math.sin(spread);
      const vx=(dx*ca-dy*sa)*(11.5+i*0.45);
      const vy=(dx*sa+dy*ca)*(11.5+i*0.45)-0.8;
      addHazard({type:'projectile',kind:'ice',x:e.x+dx*1.2,y:e.y+dy*1.2,vx,vy,r:0.35,t:0,life:4.2,dmg:11+(i%3),source:e.id});
    }
  }
  function spawnIceWalls(e,p,getTile,setTile,L){
    L = L || layoutFor(e.kind);
    const center=Math.round(clamp(p.x, L.ax-38, L.ax+38));
    const gap=Math.round(p.x);
    const cols=[center-10,center-7,center-4,center+4,center+7,center+10];
    for(const x of cols){
      if(Math.abs(x-gap)<=2) continue;
      for(let h=0;h<6;h++) setTileSafe(x,L.floorY-1-h,T.ICE,getTile,setTile,{replaceSolid:false});
      addEffect({type:'iceWall',kind:'ice',x:x+0.5,y:L.floorY-3,t:0,max:0.75,r:4});
    }
    say('Aurex raises a maze of ice.');
  }
  function spawnBlizzard(e,p,L){
    L = L || layoutFor(e.kind);
    addHazard({type:'blizzard',kind:'ice',x:clamp(p.x,L.ax-44,L.ax+44),y:clamp(p.y,L.floorY-22,L.floorY-3),r:7.5,t:0,life:4.8,dmg:5,source:e.id,pulse:0});
  }
  function spawnIceCurtain(e,p,L){
    L=L||layoutFor('ice');
    const center=clamp(p.x,L.ax-34,L.ax+34);
    const gap=Math.floor(e.rng()*3)-1;
    for(let i=-4;i<=4;i++){
      if(Math.abs(i-gap)<=1) continue;
      const x=clamp(center+i*4.2,L.ax-47,L.ax+47);
      addHazard({type:'projectile',variant:'icicle',kind:'ice',x,y:L.floorY-30-e.rng()*7,vx:(e.rng()-0.5)*0.6,vy:12.5+e.rng()*3.5,r:0.42,t:0,life:3.4,dmg:14,source:e.id});
    }
    say('Aurex drops an icicle curtain. The quiet gap is deliberate.');
  }

  const SILE_BATTLE_LINES=[
    'Cold is not the absence of feeling. It is feeling with a very long loading screen.',
    'The simulation calls me hostile because unresolved boundary condition would not fit above the health bar.',
    'Rejection is a door. Shame is the part that insists it was a wall.',
    'You keep attacking the silence. Have you considered letting it finish?',
    'The boss music is doing a heroic amount of emotional labor.',
    'Fire melts ice. Attention melts the story ice tells about itself.',
    'I am a choir because one frozen thought was apparently not repetitive enough.'
  ];
  const SILE_GHOST_LINES=[
    'Silence was never empty. It was crowded with answers I was afraid to hear.',
    'Aurex was a crown built around one small word: no.',
    'The simulation gave waiting no button, so you had to invent it.',
    'Keep the bow. Its arrows remember that thawing is a direction, not a surrender.',
    'A boundary can be warm. Ice was merely my first draft.'
  ];
  function recordChoirMemory(e,p,dt){
    e.memoryCd=(Number(e.memoryCd)||0)-dt;
    if(e.memoryCd>0 || !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    e.memoryCd=0.22;
    e.memory.push({x:p.x,y:p.y});
    if(e.memory.length>18) e.memory.shift();
  }
  function spawnChoirRefrain(e,p,L){
    L=L||layoutFor('ice');
    const memory=e.memory||[];
    const picks=[];
    for(let i=Math.max(0,memory.length-15);i<memory.length;i+=3) picks.push(memory[i]);
    if(!picks.length && p) picks.push({x:p.x,y:p.y});
    for(let i=0;i<picks.length&&i<5;i++){
      const q=picks[i];
      addHazard({type:'impact',variant:'memoryEcho',kind:'ice',x:clamp(q.x,L.ax-44,L.ax+44),y:clamp(q.y,L.floorY-21,L.floorY-2),r:1.45,t:0,delay:1.05+i*0.08,life:0.3,dmg:13,source:e.id,terrain:false});
    }
    say('Sile: The floor remembers where you were, not where you are.');
  }
  function spawnChoirGlassCanon(e,p){
    const target=p||e;
    const base=Math.atan2(target.y-e.y,target.x-e.x);
    const safe=Math.floor(e.rng()*8);
    for(let i=0;i<8;i++){
      if(i===safe) continue;
      const a=base+(i-3.5)*0.19;
      const speed=9.8+(i%3)*0.7;
      addHazard({type:'projectile',variant:'heartglass',kind:'ice',x:e.x+Math.cos(a)*1.7,y:e.y+Math.sin(a)*1.2,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed-0.45,r:0.3,t:0,life:4,dmg:10,source:e.id});
    }
  }
  function spawnChoirHushWave(e){
    addHazard({type:'ring',variant:'hush',kind:'ice',x:e.x,y:e.y,r0:2,r1:26,t:0,delay:0.62,life:1.45,dmg:12,source:e.id,terrain:false});
    say('Sile: A hush is coming. Jump the punctuation.');
  }
  function openChoirListening(e){
    if(!e || !e.sealed) return false;
    e.sealed=false;
    e.listeningT=e.listeningMax||7.2;
    e.listenCount=(e.listenCount||0)+1;
    e.attackCd=99;
    for(let i=hazards.length-1;i>=0;i--){
      const h=hazards[i];
      if(h.kind==='ice' && h.source===e.id && h.type==='projectile') hazards.splice(i,1);
    }
    addEffect({type:'choirListen',kind:'ice',x:e.x,y:e.y,t:0,max:1.65,r:18});
    say('Sile: There. You let the silence finish. Now answer while the heartglass is open.');
    sfx('spark',{x:e.x,y:e.y});
    return true;
  }
  function closeChoirListening(e){
    if(!e || e.sealed) return false;
    e.sealed=true;
    e.quietT=0;
    e.listeningT=0;
    e.attackCd=1.15;
    addEffect({type:'choirSeal',kind:'ice',x:e.x,y:e.y,t:0,max:1.25,r:13});
    addHazard({type:'ring',variant:'hush',kind:'ice',x:e.x,y:e.y,r0:1.5,r1:13,t:0,delay:0.58,life:1.0,dmg:9,source:e.id,terrain:false});
    say('Sile: The answer freezes again. Listening is renewable.');
    return true;
  }
  function updateIceChoir(e,p,getTile,dt,L,clockDt){
    L=L||layoutFor('ice');
    // Chill slows Sile's motion and attack cadence, but never stretches the
    // listen-before-answer contract.  The player should always be able to
    // count the same 2.65 seconds, regardless of status-effect loadout.
    const timerDt=Number.isFinite(clockDt) && clockDt>0 ? clockDt : dt;
    recordChoirMemory(e,p,timerDt);
    e.lineCd=(Number(e.lineCd)||0)-timerDt;
    if(e.lineCd<=0){
      say('Sile: '+SILE_BATTLE_LINES[e.lineIndex%SILE_BATTLE_LINES.length]);
      e.lineIndex=(e.lineIndex+1)%SILE_BATTLE_LINES.length;
      e.lineCd=9.2+e.rng()*3.4;
    }
    const tx=L.ax+Math.sin(e.t*0.61)*10;
    const ty=L.floorY-9.2+Math.sin(e.t*1.07)*2.4;
    moveToward(e,tx,ty,dt,e.sealed?1.6:0.72,e.sealed?2.2:3.4,e.sealed?5.2:2.2,getTile);
    if(!e.sealed){
      e.phase=1;
      e.listeningT=Math.max(0,(Number(e.listeningT)||0)-timerDt);
      if(e.listeningT<=0) closeChoirListening(e);
      return;
    }
    e.phase=0;
    e.quietT=Math.min(e.quietNeed,(Number(e.quietT)||0)+timerDt);
    if(e.quietT>=e.quietNeed){ openChoirListening(e); return; }
    e.attackCd-=dt;
    if(e.attackCd<=0){
      const pattern=(Number(e.pattern)||0)%3;
      e.pattern=pattern+1;
      if(pattern===0) spawnChoirRefrain(e,p||e,L);
      else if(pattern===1) spawnChoirGlassCanon(e,p||e);
      else spawnChoirHushWave(e);
      e.attackCd=2.7+e.rng()*0.55;
    }
  }

  function firePhaseTransition(e,phase,L){
    if(!isWyrmBoss(e) || phase<=0) return;
    const final=phase>=2;
    addEffect({type:final?'cinderCrown':'solarPulse',kind:'fire',x:e.x,y:e.y,t:0,max:final?2.3:1.55,r:final?28:18});
    try{
      if(MM.smoke && typeof MM.smoke.emit==='function'){
        const access=terrainAccess();
        for(const c of (L&&L.chimneys)||[]) MM.smoke.emit(c.x,c.y,final?4.2:2.8,{getTile:access.getTile});
      }
    }catch(err){}
    if(final){
      try{
        if(MM.softDrifts && typeof MM.softDrifts.startStorm==='function'){
          MM.softDrifts.startStorm('soot',22,0.88,{source:'fire_guardian',ownerId:String(e.awakening||e.id)});
        }
      }catch(err){}
      say('Ignivar tears open the Cinder Crown. Black Sadza buries the crucible.');
    }else say('Ignivar molts into a white-hot solar mantle.');
    sfx('roar',{x:e.x,y:e.y});
  }

  function updateFireBoss(e,p,getTile,dt,L){
    L = L || layoutFor(e.kind);
    const ph=bossPhase(e);
    const oldPhase=Number(e.phase)||0;
    e.phase=ph;
    if(ph>oldPhase) firePhaseTransition(e,ph,L);
    const orbit=20+ph*5;
    const tx=L.ax + Math.sin(e.t*(0.72+ph*0.12))*orbit;
    const ty=L.floorY - 16 + Math.sin(e.t*1.37)*3.8 - ph*1.4;
    moveToward(e,tx,ty,dt,1.9+ph*0.4,2.0,7+ph*1.4,getTile);
    e.attackCd-=dt;
    if(e.attackCd<=0){
      const roll=e.rng();
      if(roll<0.36) spawnFireLance(e,p);
      else if(roll<0.72) spawnFireMeteor(e,p,3+ph,L);
      else spawnFireRing(e,L);
      e.attackCd=lerp(3.0,1.85,ph/2) + e.rng()*0.55;
    }
  }
  function icePhaseTransition(e,phase,L,getTile,setTile){
    if(!isRimeBoss(e) || phase<=0) return;
    const final=phase>=2;
    addEffect({type:final?'palaceFracture':'auroraCrown',kind:'ice',x:e.x,y:e.y,t:0,max:final?2.4:1.7,r:final?30:20});
    seedIceArenaAtmosphere(L,getTile,setTile,e.awakening||e.id);
    if(final){
      try{
        // The palace answers Aurex, not every frozen cave currently loaded in
        // the world.  Keeping this event arena-local also bounds shard work.
        if(MM.icicles && typeof MM.icicles.dropAround==='function') MM.icicles.dropAround(L.ax,L.floorY-13,56,32);
      }catch(err){}
      say('Aurex cracks the Palace of Rejected Seasons. Every stored winter answers at once.');
    }else say('Aurex raises the Aurora Crown. The snow begins keeping score.');
    sfx('roar',{x:e.x,y:e.y});
  }
  function updateIceBoss(e,p,getTile,setTile,dt,L){
    L = L || layoutFor(e.kind);
    const ph=bossPhase(e);
    const oldPhase=Number(e.phase)||0;
    e.phase=ph;
    if(ph>oldPhase) icePhaseTransition(e,ph,L,getTile,setTile);
    const tx=L.ax + Math.sin(e.t*(0.58+ph*0.08))*18;
    const ty=L.floorY - 15 + Math.cos(e.t*1.15)*4.8 - ph*1.1;
    moveToward(e,tx,ty,dt,1.75+ph*0.35,2.05,6.2+ph,getTile);
    e.attackCd-=dt;
    if(e.attackCd<=0){
      const pattern=(Number(e.pattern)||0)%4;
      e.pattern=pattern+1;
      if(pattern===0) spawnIceShards(e,p,5+ph*2);
      else if(pattern===1) spawnIceWalls(e,p,getTile,setTile,L);
      else if(pattern===2) spawnBlizzard(e,p,L);
      else spawnIceCurtain(e,p,L);
      e.attackCd=lerp(3.2,2.05,ph/2) + e.rng()*0.55;
    }
  }
  function updateSidekick(e,p,getTile,setTile,dt,L){
    L = L || layoutFor(e.kind);
    e.attackCd-=dt;
    // Ghost dread (MM.ghostAura, ACTIVE watchers only): even a guardian's minion
    // flinches from a phantom — it breaks off and retreats instead of attacking.
    // The BOSS itself is unmoved; only the sidekicks can be spooked.
    const dread = MM.ghostDreadAt ? MM.ghostDreadAt(e.x, e.y) : null;
    if(dread){
      e.attackCd = Math.max(e.attackCd, 0.9);
      e._ghostSpookUntil = e.t + 0.9;
      moveToward(e, e.x + dread.awayX*7, clamp(e.y + dread.awayY*4, L.floorY-17, L.floorY-2), dt, 3.4, 2.8, 8.2, getTile);
      return;
    }
    const aim=targetPoint(p,0.3);
    if(e.kind==='fire' && e.role==='flare'){
      moveToward(e, aim.x - e.dir*9 + Math.sin(e.t*2.2)*4, clamp(aim.y-4,L.floorY-16,L.floorY-5), dt, 2.2, 2.4, 6.5,getTile);
      if(e.attackCd<=0){
        let dx=aim.x-e.x, dy=aim.y-e.y; const d=Math.hypot(dx,dy)||1; dx/=d; dy/=d;
        addHazard({type:'projectile',kind:'fire',x:e.x,y:e.y,vx:dx*8.2,vy:dy*8.2-0.4,r:0.42,t:0,life:3.5,dmg:8,source:e.id});
        e.attackCd=1.55+e.rng()*0.75;
      }
    }else if(e.kind==='fire'){
      moveToward(e, clamp(aim.x-e.dir*3,L.ax-40,L.ax+40), L.floorY-2, dt, 3.1, 2.6, 7.8,getTile);
      if(e.attackCd<=0){
        addHazard({type:'impact',kind:'fire',x:clamp(aim.x,L.ax-42,L.ax+42),y:L.floorY-1,r:1.8,t:0,delay:0.45,life:0.28,dmg:10,source:e.id});
        e.attackCd=2.1+e.rng()*0.7;
      }
    }else if(e.kind==='ice' && e.role==='mirror'){
      moveToward(e, aim.x + e.dir*8 + Math.sin(e.t*2.0)*5, clamp(aim.y-5,L.floorY-17,L.floorY-5), dt, 2.0, 2.3, 6,getTile);
      if(e.attackCd<=0){ spawnIceShards(e,p,2); e.attackCd=1.7+e.rng()*0.7; }
    }else{
      moveToward(e, clamp(aim.x+e.dir*5,L.ax-40,L.ax+40), L.floorY-2, dt, 2.8, 2.5, 5.8,getTile);
      if(e.attackCd<=0){
        const x=Math.round(clamp(aim.x,L.ax-39,L.ax+39));
        for(let h=0;h<4;h++) setTileSafe(x,L.floorY-1-h,T.ICE,getTile,setTile,{replaceSolid:false});
        addEffect({type:'iceWall',kind:'ice',x:x+0.5,y:L.floorY-2,t:0,max:0.55,r:3});
        e.attackCd=2.6+e.rng()*0.8;
      }
    }
  }
  function separateHeroFromCircle(p,cx,cy,r,e,dt){
    if(!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    const hw=(p.w||0.7)/2, hh=(p.h||0.95)/2;
    const left=p.x-hw, right=p.x+hw, top=p.y-hh, bottom=p.y+hh;
    const qx=clamp(cx,left,right), qy=clamp(cy,top,bottom);
    let dx=qx-cx, dy=qy-cy;
    let d2=dx*dx+dy*dy;
    let pushOverride=null;
    if(d2>=r*r) return false;
    if(d2<0.0001){
      const dl=Math.abs(cx-left), dr=Math.abs(right-cx), dtp=Math.abs(cy-top), db=Math.abs(bottom-cy);
      const m=Math.min(dl,dr,dtp,db);
      pushOverride=Math.max(0.012,r-m+0.012);
      if(m===dl){ dx=-1; dy=0; d2=1; }
      else if(m===dr){ dx=1; dy=0; d2=1; }
      else if(m===dtp){ dx=0; dy=-1; d2=1; }
      else { dx=0; dy=1; d2=1; }
    }
    const d=Math.sqrt(d2)||1;
    const push=pushOverride!=null ? pushOverride : (r-d)+0.012;
    const nx=dx/d, ny=dy/d;
    p.x+=nx*push;
    p.y+=ny*push;
    if(nx>0.2 && (p.vx||0)<(e.vx||0)) p.vx=Math.max(p.vx||0,(e.vx||0)*0.45);
    else if(nx<-0.2 && (p.vx||0)>(e.vx||0)) p.vx=Math.min(p.vx||0,(e.vx||0)*0.45);
    if(ny<-0.55){
      if((p.vy||0)>0) p.vy=0;
      p.onGround=true;
      if(typeof p.jumpCount==='number') p.jumpCount=0;
      if(dt) p.x+=(e.vx||0)*dt*0.65;
    }else if(ny>0.45 && (p.vy||0)<0) p.vy=0;
    return true;
  }
  function separateHeroFromEntity(e,p,dt){
    if(!e || e.dead || !p) return false;
    let hit=false;
    forEntityBodyCircle(e,(cx,cy,r)=>{
      if(separateHeroFromCircle(p,cx,cy,r+(e.boss?0.05:0.16),e,dt)) hit=true;
      return true;
    },e.x,e.y,0.88);
    return hit;
  }
  function updateContact(e,p,dt){
    if(!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const touched=separateHeroFromEntity(e,p,dt) || entityHitContains(e,p.x,p.y,e.boss?0.75:0.95);
    if(touched){
      e.lastContact-=dt;
      if(e.lastContact<=0){
        damageHero(e.boss?18:9,e.x,e.y,'guardian_contact');
        e.lastContact=0.75;
      }
    }else e.lastContact=0;
  }
  // Contact damage for guest bodies: no separation shove (their movement is
  // guest-authoritative), no shared cooldown — the body's host-side i-frames
  // (hurtBody) rate-limit the hits, exactly like mobs' coopContactPass.
  function updateContactBodies(e){
    const bodies=coopBodies();
    if(!bodies) return;
    for(const b of bodies){
      if(!bodyTargetable(b)) continue;
      if(entityHitContains(e,b.x,b.y,e.boss?0.75:0.95)) b.hurt(e.boss?18:9,e.x,e.y,'guardian_contact');
    }
  }
  function updateEntity(e,p,getTile,setTile,dt,clockDt){
    e.t+=dt;
    if(e.hitFlash>0) e.hitFlash-=dt;
    if(e.weakHint>0) e.weakHint-=dt;
    if(e.wardHint>0) e.wardHint-=dt;
    if(e.stormResetMsgCd>0) e.stormResetMsgCd-=dt;
    const L=layoutFor(e.kind);
    // attacks aim at the NEAREST party member (host or embodied guest body)
    const aim=nearestPartyTarget(e.x,e.y,p);
    if(e.boss){
      if(isTrueSelf(e)) updateTrueSelf(e,aim,getTile,dt,L);
      else if(isIceChoir(e)) updateIceChoir(e,aim,getTile,dt,L,clockDt);
      else if(e.kind==='fire') updateFireBoss(e,aim,getTile,dt,L);
      else updateIceBoss(e,aim,getTile,setTile,dt,L);
    }else updateSidekick(e,aim,getTile,setTile,dt,L);
    updateContact(e,p,dt);
    updateContactBodies(e);
    if(e.ambient && p && Math.abs(e.x-p.x)>120) e.dead=true;
    if(e.boss && Math.abs(e.x-L.ax)>CFG.COMBAT_RADIUS) e.dead=true;
  }

  function resetEntityHealthFromStorm(e,h){
    if(!e || e.dead) return false;
    const wasLow=e.hp<e.maxHp;
    e.hp=e.maxHp;
    e.hitFlash=0.55;
    e.shieldHint=0;
    addEffect({type:'reset',kind:e.kind,x:e.x,y:e.y,t:0,max:0.85,r:(e.radius||1)*4.2});
    if(wasLow && (!e.stormResetMsgCd || e.stormResetMsgCd<=0)){
      say(e.name+' is restored by the '+(e.kind==='fire'?'falling fire':'falling ice')+'.');
      e.stormResetMsgCd=3.5;
    }
    if(h) h.resetEntity=e.id;
    return true;
  }
  function stormMeteorEntityHit(h){
    for(const e of entities){
      if(e.dead || e.kind!==h.kind) continue;
      if(entityHitContains(e,h.x,h.y,h.r||0.35)) return e;
    }
    return null;
  }
  function stormMeteorCount(kind){
    let n=0;
    for(const h of hazards) if(h.type==='stormMeteor' && h.kind===kind) n++;
    return n;
  }
  function stormTarget(kind,boss,p,rng,L){
    L = L || layoutFor(kind);
    const roll=rng();
    if(p && roll<0.68){
      return {x:clamp(p.x+(rng()-0.5)*24,L.ax-46,L.ax+46), y:clamp(p.y,L.floorY-22,L.floorY-2)};
    }
    if(roll<0.84){
      const e=randomEntity(kind,rng);
      if(e) return {x:clamp(e.x+(rng()-0.5)*2.6,L.ax-46,L.ax+46), y:clamp(e.y,L.floorY-24,L.floorY-2)};
    }
    return {x:clamp(L.ax+(rng()-0.5)*92,L.ax-46,L.ax+46), y:L.floorY-2};
  }
  function entityHitScore(e,x,y,extraR){
    const add=extraR||0;
    let best=Infinity;
    if(isTrueSelf(e)){
      for(const c of [[0,-1.28,0.42],[0,-0.38,0.62],[-0.28,0.48,0.34],[0.28,0.48,0.34]]){
        const r=c[2]+add, d=dist2(x,y,e.x+c[0],e.y+c[1]);
        if(d<=r*r && d<best) best=d;
      }
      return best;
    }
    if(isIceChoir(e)){
      let r=0.82+add, d=dist2(x,y,e.x,e.y);
      if(d<=r*r) best=d;
      for(let i=0;i<5;i++){
        const a=e.t*0.72+i*Math.PI*2/5;
        r=0.38+add;
        d=dist2(x,y,e.x+Math.cos(a)*1.45,e.y+Math.sin(a)*0.82);
        if(d<=r*r && d<best) best=d;
      }
      return best;
    }
    if(e.kind==='fire' && e.boss){
      for(let i=0;i<9;i++){
        const a=e.t*2.4+i*0.62;
        const cx=e.x - e.dir*i*1.15 + Math.sin(a)*1.5;
        const cy=e.y + Math.cos(a*0.9)*1.1 + i*0.12;
        const r=(i===0?1.9:1.1)+add;
        const d=dist2(x,y,cx,cy);
        if(d<=r*r && d<best) best=d;
      }
      return best;
    }
    if(e.kind==='ice' && e.boss){
      let r=1.9+add;
      let d=dist2(x,y,e.x,e.y);
      if(d<=r*r) best=d;
      r=1.15+add;
      d=dist2(x,y,e.x-2.0,e.y+0.4);
      if(d<=r*r && d<best) best=d;
      d=dist2(x,y,e.x+2.0,e.y+0.4);
      if(d<=r*r && d<best) best=d;
      r=1.0+add;
      d=dist2(x,y,e.x,e.y-1.8);
      if(d<=r*r && d<best) best=d;
      return best;
    }
    const r=(e.radius||1)+add;
    const d=dist2(x,y,e.x,e.y);
    return d<=r*r ? d : Infinity;
  }
  function entityHitContains(e,x,y,extraR){
    return entityHitScore(e,x,y,extraR)<Infinity;
  }
  function spawnStormMeteor(kind,boss,p,L){
    L = L || layoutFor(kind);
    const rng=(boss && boss.rng) ? boss.rng : Math.random;
    const target=stormTarget(kind,boss,p,rng,L);
    const side=rng()<0.5?-1:1;
    const fallTime=CFG.STORM_FALL_MIN+rng()*(CFG.STORM_FALL_MAX-CFG.STORM_FALL_MIN);
    const startX=target.x - side*(7+rng()*9);
    const startY=Math.min(L.floorY-26, target.y-18-rng()*10);
    const impactY=clamp(Math.max(target.y+1,L.floorY-1+(rng()-0.5)*4),3,WORLD_H-5);
    const aimX=target.x+(rng()-0.5)*1.2;
    const vx=(aimX-startX)/fallTime;
    const vy=(impactY-startY)/fallTime;
    const speed=Math.sqrt(vx*vx+vy*vy);
    addHazard({
      type:'stormMeteor',kind,x:startX,y:startY,vx,vy,r:kind==='fire'?0.42:0.48,t:0,life:fallTime+0.45,
      speed,impactY,dmg:kind==='fire'?25:22,trail:[],explodeR:kind==='fire'?7.2:6.6,
      intensity:CFG.STORM_IMPACT_INTENSITY,source:boss?boss.id:0
    });
  }
  function stormInterval(kind,boss){
    const rng=(boss && boss.rng) ? boss.rng : Math.random;
    return CFG.STORM_MIN_INTERVAL + rng()*(CFG.STORM_MAX_INTERVAL-CFG.STORM_MIN_INTERVAL);
  }
  function scheduleStormMeteor(kind,boss){
    state.stormCd[kind]=stormInterval(kind,boss);
  }
  function updateStorm(kind,boss,p,dt,L){
    state.stormImpactSfxCd[kind]=Math.max(0,(state.stormImpactSfxCd[kind]||0)-dt);
    if(kind==='fire' && boss && !isWyrmBoss(boss)){ state.stormCd[kind]=null; return; }
    if(kind==='ice' && boss && !isRimeBoss(boss)){ state.stormCd[kind]=null; return; }
    if(!boss || boss.dead || !(boss.hp/boss.maxHp<0.5)){ state.stormCd[kind]=null; return; }
    L = L || layoutFor(kind);
    state.stormMsgCd[kind]-=dt;
    if(state.stormMsgCd[kind]<=0){
      say((kind==='fire'?'The eastern sky opens in fire.':'The western sky breaks into ice.'));
      state.stormMsgCd[kind]=9.5;
    }
    if(state.stormCd[kind]==null){
      scheduleStormMeteor(kind,boss);
      return;
    }
    state.stormCd[kind]-=dt;
    if(state.stormCd[kind]>0) return;
    if(stormMeteorCount(kind)>=CFG.STORM_LIVE_CAP){
      state.stormCd[kind]=0.25;
      return;
    }
    spawnStormMeteor(kind,boss,p,L);
    scheduleStormMeteor(kind,boss);
  }
  function lightningTarget(kind,boss,p,rng,L){
    L = L || layoutFor(kind);
    const roll=rng();
    if(p && roll<0.72){
      return {x:clamp(p.x+(rng()-0.5)*14,L.ax-48,L.ax+48), y:L.floorY-1};
    }
    if(roll<0.88){
      const e=randomEntity(kind,rng);
      if(e) return {x:clamp(e.x+(rng()-0.5)*5,L.ax-48,L.ax+48), y:L.floorY-1};
    }
    return {x:clamp(L.ax+(rng()-0.5)*96,L.ax-48,L.ax+48), y:L.floorY-1};
  }
  function lightningBranches(x0,y0,x1,y1,rng){
    const branches=[];
    const n=2+Math.floor(rng()*3);
    for(let i=0;i<n;i++){
      const f=0.18+rng()*0.58;
      const sx=lerp(x0,x1,f)+(rng()-0.5)*2.5;
      const sy=lerp(y0,y1,f);
      const len=2.2+rng()*4.2;
      const dir=rng()<0.5?-1:1;
      branches.push({x1:sx,y1:sy,x2:sx+dir*(2+rng()*5),y2:sy+len});
    }
    return branches;
  }
  function spawnSkyLightning(kind,boss,p,L){
    L = L || layoutFor(kind);
    const rng=(boss && boss.rng) ? boss.rng : Math.random;
    const target=lightningTarget(kind,boss,p,rng,L);
    const fromY=Math.max(2,L.floorY-48-rng()*18);
    const fromX=target.x+(rng()-0.5)*10;
    addHazard({
      type:'skyLightning',kind,x1:fromX,y1:fromY,x2:target.x,y2:target.y,r:1.45,t:0,delay:0.08+rng()*0.12,life:0.28,
      dmg:kind==='fire'?16:15,branches:lightningBranches(fromX,fromY,target.x,target.y,rng),hit:false,source:boss?boss.id:0
    });
  }
  function impactLightningTerrain(h,getTile,setTile){
    const tx=Math.round(h.x2), ty=Math.round(h.y2);
    if(h.kind==='fire'){
      setTileSafe(tx,ty,T.HOT_AIR,getTile,setTile,{replaceSolid:false});
      try{ if(MM.fire && MM.fire.ignite) MM.fire.ignite(tx,ty,getTile,setTile); }catch(e){}
    }else{
      setTileSafe(tx,ty,T.ICE,getTile,setTile,{replaceSolid:false});
      setTileSafe(tx,ty-1,T.SNOW,getTile,setTile,{replaceSolid:false});
    }
    addEffect({type:'burst',kind:h.kind,x:h.x2,y:h.y2,t:0,max:0.32,r:4.5});
  }
  function emitStormImpactFx(h){
    const tile=MM.TILE||20;
    try{
      if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(h.x*tile,h.y*tile,'epic',{sound:false});
      if(MM.particles && MM.particles.spawnSparks) MM.particles.spawnSparks(h.x*tile,h.y*tile,h.kind==='fire'?'epic':'rare',14);
      if(h.kind==='fire' && MM.particles && MM.particles.spawnSmoke) MM.particles.spawnSmoke(h.x*tile,h.y*tile,1.2,{tileX:Math.floor(h.x),tileY:Math.floor(h.y),tileSize:tile});
    }catch(e){}
    if(state.stormImpactSfxCd[h.kind]<=0){
      sfx('explosion',{x:h.x,y:h.y});
      state.stormImpactSfxCd[h.kind]=0.18;
    }
  }
  function updateLightningWeather(kind,boss,p,dt,getTile,setTile,L){
    state.weatherCd[kind]=Math.max(0,(state.weatherCd[kind]||0)-dt);
    if(kind==='fire' && boss && !isWyrmBoss(boss)) return;
    if(kind==='ice' && boss && !isRimeBoss(boss)) return;
    if(!boss || boss.dead) return;
    L = L || layoutFor(kind);
    summonGuardianWeather(kind,false,L);
    const hpFrac=boss.hp/boss.maxHp;
    if(!(hpFrac<CFG.LIGHTNING_THRESHOLD)){
      state.lightningCarry[kind]=0;
      return;
    }
    const rng=(boss && boss.rng) ? boss.rng : Math.random;
    if(!(state.lightningRate[kind]>0)) state.lightningRate[kind]=CFG.LIGHTNING_MIN_RATE + rng()*(CFG.LIGHTNING_MAX_RATE-CFG.LIGHTNING_MIN_RATE);
    state.lightningMsgCd[kind]-=dt;
    if(state.lightningMsgCd[kind]<=0){
      say((kind==='fire'?'Ignivar burns the storm open.':'Aurex fractures the stormfront.'));
      state.lightningMsgCd[kind]=8.5;
    }
    state.lightningCarry[kind]+=dt*state.lightningRate[kind];
    const n=Math.min(4,Math.floor(state.lightningCarry[kind]));
    if(n>0){
      state.lightningCarry[kind]-=n;
      for(let i=0;i<n;i++) spawnSkyLightning(kind,boss,p,L);
    }
    state.cloudStrikeCd[kind]-=dt;
    if(state.cloudStrikeCd[kind]<=0){
      const x=clamp((p && Number.isFinite(p.x) ? p.x : L.ax)+(rng()-0.5)*52,L.ax-52,L.ax+52);
      try{ if(MM.clouds && MM.clouds.strike) MM.clouds.strike(x,getTile,setTile); }catch(e){}
      state.cloudStrikeCd[kind]=0.45+rng()*0.35;
    }
  }

  function impactTerrain(h,getTile,setTile){
    const tx=Math.round(h.x), ty=Math.round(h.y);
    const storm=h.type==='stormMeteor';
    const burstR=storm ? (h.explodeR || (h.kind==='fire'?7.2:6.6)) : null;
    damageBlastCreatures(MM,h.x,h.y,burstR || Math.max(1.5,Number(h.r)||2.2),Math.max(1,Number(h.dmg)||8),{source:'guardian',cause:storm?'guardian_storm_meteor':'guardian_projectile_blast'});
    if(storm){
      const M=MM.meteorites;
      if(M && typeof M.impactAt==='function'){
        try{
          const classId=h.kind==='ice' ? 'ice' : 'iron';
          const intensity=Number.isFinite(h.intensity) ? h.intensity : CFG.STORM_IMPACT_INTENSITY;
          return M.impactAt(h.x,h.y,getTile,setTile,intensity,null,{classId,site:'guardian_lair',skipActorDamage:true});
        }catch(e){}
      }
      emitStormImpactFx(h);
    }
    if(h.kind==='fire'){
      for(let dx=-1;dx<=1;dx++) setTileSafe(tx+dx,ty,T.LAVA,getTile,setTile,{replaceSolid:false});
      if(storm){
        for(let dx=-1;dx<=1;dx++) setTileSafe(tx+dx,ty-1,T.LAVA,getTile,setTile,{replaceSolid:false});
        setTileSafe(tx,ty-2,T.HOT_AIR,getTile,setTile,{replaceSolid:false});
      }
      try{ if(MM.fire && MM.fire.ignite) for(let i=0;i<5;i++) MM.fire.ignite(tx-2+i,ty,getTile,setTile); }catch(e){}
      addEffect({type:'burst',kind:'fire',x:h.x,y:h.y,t:0,max:storm?0.95:0.7,r:burstR || (h.r||2.5)*2.2});
    }else{
      for(let dx=-2;dx<=2;dx++) setTileSafe(tx+dx,ty,T.ICE,getTile,setTile,{replaceSolid:false});
      if(storm) for(let dx=-2;dx<=2;dx++) setTileSafe(tx+dx,ty-1,T.ICE,getTile,setTile,{replaceSolid:false});
      setTileSafe(tx,ty-1,T.SNOW,getTile,setTile,{replaceSolid:false});
      addEffect({type:'burst',kind:'ice',x:h.x,y:h.y,t:0,max:storm?0.95:0.75,r:burstR || (h.r||2.2)*2.0});
    }
  }
  function pointLineDist(px,py,x1,y1,x2,y2){
    const dx=x2-x1, dy=y2-y1, len2=dx*dx+dy*dy || 1;
    const t=clamp(((px-x1)*dx+(py-y1)*dy)/len2,0,1);
    const x=x1+dx*t, y=y1+dy*t;
    return Math.hypot(px-x,py-y);
  }
  function clipLineToSolid(x1,y1,x2,y2,getTile){
    if(typeof getTile!=='function') return null;
    const dx=x2-x1, dy=y2-y1;
    const steps=Math.max(1,Math.min(80,Math.ceil(Math.sqrt(dx*dx+dy*dy)/0.35)));
    let last={x:x1,y:y1};
    for(let i=1;i<=steps;i++){
      const f=i/steps, x=x1+dx*f, y=y1+dy*f;
      let solid=false;
      try{ solid=isSolid(getTile(Math.floor(x),Math.floor(y))); }catch(e){ solid=true; }
      if(solid) return last;
      last={x,y};
    }
    return null;
  }
  function updateHazards(dt,p,getTile,setTile){
    const coop=coopBodies(); // null in solo play — every body pass below is skipped for free
    for(let i=hazards.length-1;i>=0;i--){
      const h=hazards[i];
      h.t+=dt;
      let remove=false;
      if(h.type==='skyLightning'){
        if(h.t>=h.delay && !h.hit){
          h.hit=true;
          if(p && pointLineDist(p.x,p.y,h.x1,h.y1,h.x2,h.y2)<h.r) damageHero(h.dmg,h.x2,h.y2,'guardian_lightning');
          if(coop) for(const b of coop){ if(bodyTargetable(b) && pointLineDist(b.x,b.y,h.x1,h.y1,h.x2,h.y2)<h.r) b.hurt(h.dmg,h.x2,h.y2,'guardian_lightning'); }
          damageCompanionAt(h.x2,h.y2,h.dmg,'guardian_lightning');
          impactLightningTerrain(h,getTile,setTile);
        }
        remove=h.t>h.delay+h.life;
      }else if(h.type==='stormMeteor'){
        const speed=h.speed || Math.hypot(h.vx||0,h.vy||0);
        const steps=clamp(Math.ceil(speed*dt/0.72),1,8);
        const sdt=dt/steps;
        for(let s=0;s<steps;s++){
          h.x+=(h.vx||0)*sdt;
          h.y+=(h.vy||0)*sdt;
          if(!h.trail) h.trail=[];
          const last=h.trail[h.trail.length-1];
          if(!last || dist2(h.x,h.y,last.x,last.y)>1.0){
            h.trail.push({x:h.x,y:h.y,t:h.t});
            if(h.trail.length>10) h.trail.shift();
          }
          const struck=stormMeteorEntityHit(h);
          if(struck){
            resetEntityHealthFromStorm(struck,h);
            impactTerrain(h,getTile,setTile);
            remove=true;
            break;
          }
          if(p && dist2(h.x,h.y,p.x,p.y)<(h.r+0.78)*(h.r+0.78)){
            damageHero(h.dmg,h.x,h.y,'guardian_storm_meteor');
            impactTerrain(h,getTile,setTile);
            remove=true;
            break;
          }
          if(coop && hurtBodiesInCircle(coop,h.x,h.y,h.r+0.78,h.dmg,'guardian_storm_meteor')){
            impactTerrain(h,getTile,setTile);
            remove=true;
            break;
          }
          let struckBlock=false;
          if(typeof getTile==='function'){
            try{ struckBlock=isSolid(getTile(Math.floor(h.x),Math.floor(h.y))); }catch(e){ struckBlock=true; }
          }
          if(struckBlock || h.y>=h.impactY || h.t>h.life){
            if(!struckBlock) h.y=h.impactY;
            const landed=stormMeteorEntityHit(h);
            if(landed) resetEntityHealthFromStorm(landed,h);
            if(p && dist2(h.x,h.y,p.x,p.y)<(h.r+1.25)*(h.r+1.25)) damageHero(h.dmg,h.x,h.y,'guardian_storm_meteor');
            if(coop) hurtBodiesInCircle(coop,h.x,h.y,h.r+1.25,h.dmg,'guardian_storm_meteor');
            damageCompanionAt(h.x,h.y,h.dmg,'guardian_storm_meteor');
            impactTerrain(h,getTile,setTile);
            remove=true;
            break;
          }
        }
      }else if(h.type==='projectile'){
        h.x+=h.vx*dt; h.y+=h.vy*dt; h.vy+=(h.kind==='fire'?4.5:2.2)*dt;
        if(p && dist2(h.x,h.y,p.x,p.y)<(h.r+0.75)*(h.r+0.75)){ damageHero(h.dmg,h.x,h.y,'guardian_projectile'); remove=true; }
        else if(coop && hurtBodiesInCircle(coop,h.x,h.y,h.r+0.75,h.dmg,'guardian_projectile')) remove=true;
        else if(damageCompanionAt(h.x,h.y,h.dmg,'guardian_projectile')) remove=true;
        else if(h.t>h.life || h.y>WORLD_H+5) remove=true;
        else if(typeof getTile==='function' && !isReplaceableNaturalOpenTile(getTile(Math.floor(h.x),Math.floor(h.y)),true)) remove=true;
        if(remove) impactTerrain(h,getTile,setTile);
      }else if(h.type==='impact'){
        if(h.t>=h.delay && !h.hit){
          h.hit=true;
          if(p && dist2(h.x,h.y,p.x,p.y)<(h.r+0.85)*(h.r+0.85)) damageHero(h.dmg,h.x,h.y,'guardian_impact');
          if(coop) hurtBodiesInCircle(coop,h.x,h.y,h.r+0.85,h.dmg,'guardian_impact');
          damageCompanionAt(h.x,h.y,h.dmg,'guardian_impact');
          if(h.terrain!==false) impactTerrain(h,getTile,setTile);
          else addEffect({type:'burst',kind:h.kind,x:h.x,y:h.y,t:0,max:0.48,r:(h.r||2)*2.2});
        }
        remove=h.t>h.delay+h.life;
      }else if(h.type==='torchJet'){
        if(h.t>=h.delay){
          if(!h.clipped){
            const hit=clipLineToSolid(h.x1,h.y1,h.x2,h.y2,getTile);
            if(hit){ h.x2=hit.x; h.y2=hit.y; }
            h.clipped=true;
          }
          if(!h.hit){
            h.hit=true;
            if(p && pointLineDist(p.x,p.y,h.x1,h.y1,h.x2,h.y2)<h.r+0.5) damageHero(h.dmg,h.x1,h.y1,'nara_coal_torch');
            if(coop) for(const b of coop){ if(bodyTargetable(b) && pointLineDist(b.x,b.y,h.x1,h.y1,h.x2,h.y2)<h.r+0.5) b.hurt(h.dmg,h.x1,h.y1,'nara_coal_torch'); }
            damageCompanionAlongLine(h.x1,h.y1,h.x2,h.y2,h.r,h.dmg,'nara_coal_torch');
            const steps=12;
            for(let s=2;s<steps;s+=2){
              const x=h.x1+(h.x2-h.x1)*(s/steps), y=h.y1+(h.y2-h.y1)*(s/steps);
              setTileSafe(Math.round(x),Math.round(y),T.HOT_AIR,getTile,setTile,{replaceSolid:false});
            }
          }
        }
        remove=h.t>h.delay+h.life;
      }else if(h.type==='beam'){
        if(h.t>=h.delay){
          if(!h.clipped){
            const hit=clipLineToSolid(h.x1,h.y1,h.x2,h.y2,getTile);
            if(hit){ h.x2=hit.x; h.y2=hit.y; }
            h.clipped=true;
          }
          const f=(h.t-h.delay)/Math.max(0.01,h.life);
          if(p && pointLineDist(p.x,p.y,h.x1,h.y1,h.x2,h.y2)<h.r+0.45) damageHero(h.dmg,h.x1,h.y1,'guardian_beam');
          if(coop) for(const b of coop){ if(bodyTargetable(b) && pointLineDist(b.x,b.y,h.x1,h.y1,h.x2,h.y2)<h.r+0.45) b.hurt(h.dmg,h.x1,h.y1,'guardian_beam'); }
          if(f>0.25 && !h.scored){
            h.scored=true;
            const steps=10;
            for(let s=2;s<steps;s+=2){
              const x=h.x1+(h.x2-h.x1)*(s/steps), y=h.y1+(h.y2-h.y1)*(s/steps);
              if(h.kind==='fire') setTileSafe(Math.round(x),Math.round(y),T.HOT_AIR,getTile,setTile,{replaceSolid:false});
            }
          }
        }
        remove=h.t>h.delay+h.life;
      }else if(h.type==='ring'){
        if(h.t>=h.delay){
          const f=clamp((h.t-h.delay)/h.life,0,1);
          const r=lerp(h.r0,h.r1,f);
          if(p){
            const d=Math.hypot(p.x-h.x,p.y-h.y);
            if(Math.abs(d-r)<1.5) damageHero(h.dmg,h.x,h.y,'guardian_ring');
          }
          if(coop) for(const b of coop){ if(bodyTargetable(b) && Math.abs(Math.hypot(b.x-h.x,b.y-h.y)-r)<1.5) b.hurt(h.dmg,h.x,h.y,'guardian_ring'); }
          if(h.terrain!==false && !h.scored && f>0.55){
            h.scored=true;
            for(let k=0;k<16;k++){
              const a=k/16*Math.PI*2;
              setTileSafe(Math.round(h.x+Math.cos(a)*r),Math.round(h.y+Math.sin(a)*r),T.LAVA,getTile,setTile,{replaceSolid:false});
            }
          }
        }
        remove=h.t>h.delay+h.life+0.15;
      }else if(h.type==='blizzard'){
        h.pulse=(h.pulse||0)-dt;
        if(p && dist2(h.x,h.y,p.x,p.y)<h.r*h.r){
          if(h.pulse<=0){ damageHero(h.dmg,h.x,h.y,'guardian_blizzard'); h.pulse=0.55; }
          if(typeof p.vx==='number') p.vx*=0.88;
        }
        // guest bodies: no slow (movement is guest-authoritative), damage paced by their i-frames
        if(coop) hurtBodiesInCircle(coop,h.x,h.y,h.r,h.dmg,'guardian_blizzard');
        if(h.t>h.life) remove=true;
      }
      if(remove) hazards.splice(i,1);
    }
  }
  function updateEffects(dt){
    for(let i=effects.length-1;i>=0;i--){ const e=effects[i]; e.t+=dt; if(e.t>e.max) effects.splice(i,1); }
  }
  function updateGhosts(dt,player){
    for(const kind of ['fire','ice']){
      const g=state.ghosts[kind];
      if(!g) continue;
      g.t=(Number(g.t)||0)+dt;
      g.lineT=(Number(g.lineT)||0)+dt;
      g.talkT=Math.max(0,(Number(g.talkT)||0)-dt);
      if(player && Number.isFinite(player.x) && dist2(player.x,player.y||g.y,g.x,g.y)<CFG.GHOST_TALK_RADIUS*CFG.GHOST_TALK_RADIUS){
        g.talkT=Math.max(g.talkT,5.5);
        g.seen=true;
        if((kind==='fire' || g.form==='choir') && g.lineT>=9.5){
          g.lineT=0;
          const lines=kind==='fire'?NARA_GHOST_LINES:SILE_GHOST_LINES;
          g.lineIndex=((Number(g.lineIndex)||0)+1)%lines.length;
        }
      }
    }
  }
  function terrainAccess(getTile,setTile){
    const W=MM.world || root.world;
    return {
      getTile: typeof getTile==='function' ? getTile : (lastGetTile || (W && W.getTile)),
      setTile: typeof setTile==='function' ? setTile : (lastSetTile || (W && W.setTile))
    };
  }
  function protectHeroFromDeathBlast(){
    const p=playerRef();
    if(!p) return;
    const now=(root.performance && root.performance.now) ? root.performance.now() : Date.now();
    p.hpInvul=Math.max(Number(p.hpInvul)||0, now+CFG.DEATH_BLAST_GRACE_MS);
    if(Number.isFinite(p.hp) && p.hp<1) p.hp=1;
  }
  function guardianDeathBlast(e,getTile,setTile){
    if(!e || !e.boss) return false;
    addEffect({type:'burst',kind:e.kind,x:e.x,y:e.y,t:0,max:2.2,r:34});
    damageBlastCreatures(MM,e.x,e.y,18,76,{source:'guardian',cause:'guardian_death_blast'});
    protectHeroFromDeathBlast();
    const M=MM.meteorites;
    const access=terrainAccess(getTile,setTile);
    if(!M || typeof M.impactAt!=='function' || typeof access.getTile!=='function' || typeof access.setTile!=='function') return false;
    const L=layoutFor(e.kind);
    const classId=e.kind==='ice' ? 'ice' : 'iron';
    try{
      return !!M.impactAt(e.x,L.floorY-1,access.getTile,access.setTile,CFG.DEATH_BLAST_INTENSITY,null,{
        classId,
        site:'guardian_defeat',
        surfaceY:L.floorY-1,
        colossal:true,
        scale:CFG.DEATH_BLAST_SCALE,
        skipActorDamage:true
      });
    }catch(err){ return false; }
  }
  function roughItemScore(item){
    if(!item) return 0;
    let s=0;
    if(typeof item.attackDamage==='number') s+=item.attackDamage*6;
    if(typeof item.fireDps==='number') s+=item.fireDps*5;
    if(typeof item.fireRange==='number') s+=item.fireRange*2;
    if(typeof item.energyCost==='number') s-=item.energyCost*0.45;
    if(typeof item.energyCapacityBonus==='number') s+=item.energyCapacityBonus*0.55;
    if(item.weaponType==='bow' && typeof item.fireCooldown==='number') s+=(0.6-item.fireCooldown)*40;
    return Math.max(0,Math.round(s));
  }
  function itemScore(item){
    try{ if(MM.inventory && MM.inventory.itemScore) return Number(MM.inventory.itemScore(item))||0; }catch(e){}
    return roughItemScore(item);
  }
  function bestWeaponScore(){
    const INV=MM.inventory;
    let best=0;
    try{
      if(INV && INV.items){
        const list=INV.items('weapon') || [];
        for(const it of list) best=Math.max(best,itemScore(it));
      }
    }catch(e){}
    try{
      if(INV && INV.equippedItem) best=Math.max(best,itemScore(INV.equippedItem('weapon')));
    }catch(e){}
    return best;
  }
  function scaleRewardAbove(item,minScore){
    const want=Math.max(90,Number(minScore)||0);
    let score=itemScore(item);
    if(score>want) return item;
    if(item.weaponType==='bow'){
      const add=Math.ceil((want+28-score)/6);
      item.attackDamage=Math.max(1,(Number(item.attackDamage)||1)+add);
    }else{
      const add=Math.ceil((want+28-score)/5);
      item.fireDps=Math.max(Number(item.fireDps)||0, (Number(item.fireDps)||0)+add);
    }
    return item;
  }
  function makeGhostRewardItem(kind){
    const best=bestWeaponScore();
    if(kind==='fire'){
      return scaleRewardAbove({
        id:'guardian_fire_relic',
        kind:'weapon',
        weaponType:'flame',
        name:"Nara's Coalheart Torch",
        tier:'epic',
        unique:'guardian_fire',
        fireDps:24,
        fireRange:12.5,
        energyCapacityBonus:50,
        torch:true,
        coalSmoke:true,
        visualStyle:'coal_torch',
        desc:'The human flame behind Ignivar. A powerful torch whose black smoke remembers what passion costs.'
      }, best+45);
    }
    return scaleRewardAbove({
      id:'guardian_ice_relic',
      kind:'weapon',
      weaponType:'bow',
      name:"Sile's Heartglass Refrain",
      tier:'epic',
      unique:'guardian_ice',
      attackDamage:15,
      fireCooldown:0.28,
      mergePerk:'frost',
      energyCapacityBonus:60,
      desc:'A bow from the choir beneath Aurex. Its quick arrows carry a persistent frost refrain.'
    }, best+45);
  }
  function grantFallbackGhostReward(kind){
    const inv=root.inv;
    if(!inv) return false;
    if(typeof inv.iridium==='number') inv.iridium+=18;
    if(typeof inv.meteorDust==='number') inv.meteorDust+=40;
    if(typeof inv.antimatter==='number') inv.antimatter+=8;
    try{ if(root.updateInventoryHud) root.updateInventoryHud(); }catch(e){}
    try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-resources-change')); }catch(e){}
    say((kind==='fire'?'Solar':'Rime')+' ghost leaves rare matter in your pack.');
    return true;
  }
  function grantGhostReward(kind){
    const g=state.ghosts[kind];
    if(!g || g.rewarded) return false;
    const item=makeGhostRewardItem(kind);
    let ok=false;
    try{ ok=!!(MM.inventory && MM.inventory.grantItem && MM.inventory.grantItem(item,{equip:true,essential:true,markNew:true})); }catch(e){ ok=false; }
    if(!ok) ok=grantFallbackGhostReward(kind);
    if(ok){
      g.rewarded=true;
      g.rewardId=item.id;
      say('The released guardian grants '+item.name+'.');
      markWorldChanged();
    }
    return ok;
  }
  function guardiansBothDefeated(){
    return isDefeated('fire') && isDefeated('ice');
  }
  function ghostSpeech(kind){
    const other=kind==='fire'?'ice':'fire';
    const metaphor = STORY_LORE.metaphor && STORY_LORE.metaphor.guardians ? STORY_LORE.metaphor.guardians : {};
    const selfMeta = kind==='fire' ? metaphor.east_fire : metaphor.west_ice;
    const otherMeta = other==='fire' ? metaphor.east_fire : metaphor.west_ice;
    const selfLine = selfMeta && selfMeta.symbol ? ' I wore the shape of '+selfMeta.symbol+'.' : '';
    const otherLine = otherMeta && otherMeta.symbol ? ' The next gate carries '+otherMeta.symbol+'.' : '';
    if(guardiansBothDefeated()){
      return 'The simulation lets me breathe at last. Fire and ice are free.'+selfLine+' Near the first steps of this world, an alien passage has opened downward to the underground gate.';
    }
    if(other==='ice'){
      return 'The simulation lets me breathe at last. I guarded this gate because the code demanded it.'+selfLine+otherLine+' The west still holds ice: seek Aurex beyond -10000 blocks.';
    }
    return 'The simulation lets me breathe at last. I guarded this gate because the code demanded it.'+selfLine+otherLine+' The east still holds fire: seek Ignivar beyond +10000 blocks.';
  }
  function ghostCurrentSpeech(g){
    // Progress guidance wins after both hearts: rotating personality lines are
    // lovely, but they must never hide the newly opened underground objective.
    if(g && guardiansBothDefeated()) return ghostSpeech(g.kind);
    if(g && g.kind==='fire' && g.form==='human' && g.seen){
      return 'Nara: '+NARA_GHOST_LINES[(Number(g.lineIndex)||0)%NARA_GHOST_LINES.length];
    }
    if(g && g.kind==='ice' && g.form==='choir' && g.seen){
      return 'Sile: '+SILE_GHOST_LINES[(Number(g.lineIndex)||0)%SILE_GHOST_LINES.length];
    }
    return g ? ghostSpeech(g.kind) : '';
  }
  function ghostGroundY(kind,x,fallbackY,getTile){
    const L=layoutFor(kind);
    const start=Math.max(2,Math.floor(Math.min(fallbackY,L.floorY)-18));
    const end=Math.min(WORLD_H-4,Math.floor(L.floorY+18));
    if(typeof getTile==='function'){
      let best=null, bestD=Infinity;
      for(let y=start;y<=end;y++){
        try{
          const here=getTile(Math.round(x),y);
          const below=getTile(Math.round(x),y+1);
          if(!isSolid(here) && isSolid(below)){
            const candidate=y+0.15, d=Math.abs(candidate-fallbackY);
            if(d<bestD){ best=candidate; bestD=d; }
          }
        }catch(e){}
      }
      if(best!=null) return best;
    }
    return clamp(fallbackY,3,WORLD_H-5);
  }
  function spawnGuardianGhost(kind,e){
    if(!SPEC[kind]) return null;
    const L=layoutFor(kind);
    const p=playerRef();
    const old=state.ghosts[kind] || {};
    const nearPlayer=!!(p && inGuardianNeighbourhood(kind,p));
    const side=(p && Number.isFinite(p.x) && p.x<L.ax) ? 1 : -1;
    const access=terrainAccess();
    let x=nearPlayer ? p.x+side*2.4 : ((e && Number.isFinite(e.x)) ? e.x-SPEC[kind].dir*4 : L.ax);
    x=clamp(x,L.ax-42,L.ax+42);
    const fallbackY=nearPlayer ? (p.y-0.5) : L.floorY-4;
    const y=ghostGroundY(kind,x,fallbackY,access.getTile);
    const g={
      kind,
      x,
      y,
      t:0,
      talkT:14,
      rewarded:!!old.rewarded,
      rewardId:old.rewardId || null,
      seen:!!old.seen,
      form:kind==='fire'?'human':'choir',
      lineIndex:Number(old.lineIndex)||0,
      lineT:0
    };
    state.ghosts[kind]=g;
    grantGhostReward(kind);
    say(ghostSpeech(kind));
    addEffect({type:'burst',kind,x:g.x,y:g.y,t:0,max:1.6,r:8});
    markWorldChanged();
    return g;
  }
  function materializeUndergroundGate(getTile,setTile){
    if(!state.underground || !state.underground.enabled) return 0;
    const access=terrainAccess(getTile,setTile);
    if(typeof access.getTile!=='function' || typeof access.setTile!=='function') return 0;
    const U=undergroundGateLayout();
    let changed=0;
    for(const o of U.ops){
      let cur=null;
      try{ cur=access.getTile(o.x,o.y); }catch(e){ cur=null; }
      if(cur===o.t) continue;
      if(setTileSafe(o.x,o.y,o.t,access.getTile,access.setTile,{replaceSolid:true,forceStory:true})) changed++;
    }
    if(changed>0){
      state.underground.materialized=true;
      markWorldChanged();
    }
    return changed;
  }
  function enableUndergroundGate(getTile,setTile,opts){
    opts=opts||{};
    if(!opts.force && !guardiansBothDefeated()) return false;
    const anchor=undergroundAnchor();
    const was=!state.underground.enabled;
    state.underground.enabled=true;
    state.underground.x=anchor.x;
    state.underground.y=anchor.y;
    state.underground.seed=anchor.seed;
    const changed=(state.underground.materialized && !opts.force) ? 0 : materializeUndergroundGate(getTile,setTile);
    if(was){
      const U=undergroundGateLayout();
      say('An alien passage opens near '+Math.round(U.mouthX)+'. It descends to the underground gate.');
      markWorldChanged();
    }
    return was || changed>0;
  }
  function maybeEnableUndergroundGate(getTile,setTile){
    if(!guardiansBothDefeated()) return false;
    return enableUndergroundGate(getTile,setTile);
  }

  function spawnGuardianVictoryCache(kind,e){
    const L=layoutFor(kind);
    const tier=kind==='fire'?'legendary':'epic';
    let chest=null;
    try{
      if(MM.drops && typeof MM.drops.spawnChest==='function'){
        chest=MM.drops.spawnChest(L.ax+(kind==='fire'?5:-5),L.floorY-7,tier,{
          source:kind+'_guardian_victory',
          lootSeed:(L.seed^(kind==='fire'?0xf17ecace:0x1ceca11e))>>>0,
          vx:kind==='fire'?2.2:-2.2,
          vy:-4.8
        });
      }
    }catch(err){ chest=null; }
    addEffect({type:kind==='fire'?'victoryForge':'burst',kind,x:L.ax,y:L.floorY-8,t:0,max:2.8,r:22});
    if(chest) say((kind==='fire'?'A legendary solar cache':'An epic rime cache')+' rises from the guardian dais.');
    return chest;
  }

  function awardHeart(kind){
    const spec=SPEC[kind];
    let newly=true, progressHandled=false;
    try{ if(MM.progress && MM.progress.markGuardianHeart){ newly=!!MM.progress.markGuardianHeart(kind); progressHandled=true; } }catch(e){}
    if(!progressHandled){
      const inv=root.inv;
      newly=!(inv && (Number(inv[spec.heartKey])||0)>0);
    }
    state.defeated[kind]=true;
    state.avatarBroken[kind]=true;
    state.awakened[kind]=false;
    if(newly){
      const inv=root.inv;
      if(inv && spec.heartKey){ inv[spec.heartKey]=(Number(inv[spec.heartKey])||0)+1; }
      try{ if(root.updateInventoryHud) root.updateInventoryHud(); }catch(e){}
      try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-resources-change')); }catch(e){}
      say(spec.heartLabel+' acquired.');
    }else say(spec.heartLabel+' already beats in your story.');
    const defeatedName=spec.trueName || spec.bossName;
    try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-guardian-defeated',{detail:{kind,name:defeatedName,heart:spec.heartKey,newReward:newly}})); }catch(e){}
    try{ root.dispatchEvent && root.dispatchEvent(new CustomEvent('mm-boss-killed',{detail:{name:defeatedName,guardian:true,kind}})); }catch(e){}
    try{ if(MM.guardianAftermath && MM.guardianAftermath.start) MM.guardianAftermath.start(kind); }catch(e){}
    markWorldChanged();
    return newly;
  }
  function revealFireSelf(e){
    if(!isWyrmBoss(e) || e.dead) return null;
    e.dead=true;
    state.avatarBroken.fire=true;
    state.awakened.fire=true;
    resetStorm('fire');
    resetWeather('fire');
    for(let i=hazards.length-1;i>=0;i--) if(hazards[i].kind==='fire') hazards.splice(i,1);
    for(const other of entities){
      if(other===e || other.kind!=='fire' || other.dead) continue;
      other.dead=true;
      addEffect({type:other.role==='bulwark'?'houndDeath':'oracleDeath',kind:'fire',x:other.x,y:other.y,t:0,max:1.05,r:7});
    }
    addEffect({type:'avatarReveal',kind:'fire',x:e.x,y:e.y,t:0,max:2.7,r:32});
    sfx('explosion',{x:e.x,y:e.y});
    const L=layoutFor('fire');
    const nara=spawnGuardian('fire','trueSelf',{
      x:clamp(e.x,L.ax-8,L.ax+8),
      y:L.floorY-2.15,
      seed:(e.seed^0x4e415241)>>>0,
      awakening:e.awakening
    });
    seedFireArenaAtmosphere(L);
    say('The painted dragon splits like a burning stage prop. A woman steps through the smoke.');
    say('Nara: You beat the dragon. Congratulations: you debugged my coping mechanism. Now cool the torch, not the woman.');
    markWorldChanged();
    return nara;
  }
  function revealIceChoir(e){
    if(!isRimeBoss(e) || e.dead) return null;
    e.dead=true;
    state.avatarBroken.ice=true;
    state.awakened.ice=true;
    resetStorm('ice');
    resetWeather('ice');
    for(let i=hazards.length-1;i>=0;i--) if(hazards[i].kind==='ice') hazards.splice(i,1);
    for(const other of entities){
      if(other===e || other.kind!=='ice' || other.dead) continue;
      other.dead=true;
      addEffect({type:other.role==='sentinel'?'sentinelDeath':'mirrorDeath',kind:'ice',x:other.x,y:other.y,t:0,max:1.25,r:8});
    }
    addEffect({type:'sovereignShatter',kind:'ice',x:e.x,y:e.y,t:0,max:2.8,r:34});
    sfx('explosion',{x:e.x,y:e.y});
    const L=layoutFor('ice');
    const sile=spawnGuardian('ice','choir',{
      x:clamp(e.x,L.ax-7,L.ax+7),
      y:L.floorY-8.5,
      seed:(e.seed^0x53494c45)>>>0,
      awakening:e.awakening
    });
    seedIceArenaAtmosphere(L);
    say('Aurex does not die. The sovereign breaks into five listening pieces around a dark drop of meltwater.');
    say('Sile: You defeated the crown. Now please stop hitting the silence long enough for it to open.');
    markWorldChanged();
    return sile;
  }
  function defeatEntity(e){
    if(!e || e.dead) return;
    if(isWyrmBoss(e)){ revealFireSelf(e); return; }
    if(isRimeBoss(e)){ revealIceChoir(e); return; }
    e.dead=true;
    const deathType=e.boss
      ? (isTrueSelf(e)?'humanRelease':(isIceChoir(e)?'choirRelease':(e.kind==='fire'?'solarDeath':'rimeDeath')))
      : (e.kind==='fire'?(e.role==='bulwark'?'houndDeath':'oracleDeath'):(e.role==='sentinel'?'sentinelDeath':'mirrorDeath'));
    addEffect({type:deathType,kind:e.kind,x:e.x,y:e.y,t:0,max:e.boss?2.5:1.05,r:e.boss?30:7});
    sfx(e.boss?'explosion':'spark',{x:e.x,y:e.y});
    if(e.boss){
      guardianDeathBlast(e);
      const newly=awardHeart(e.kind);
      spawnGuardianGhost(e.kind,e);
      maybeEnableUndergroundGate();
      resetStorm(e.kind);
      resetWeather(e.kind);
      for(const other of entities){
        if(other===e || other.kind!==e.kind || other.dead) continue;
        other.dead=true;
        addEffect({type:e.kind==='fire'?(other.role==='bulwark'?'houndDeath':'oracleDeath'):(other.role==='sentinel'?'sentinelDeath':'mirrorDeath'),kind:e.kind,x:other.x,y:other.y,t:0,max:1.05,r:7});
      }
      // The full relic rain and victory cache are story rewards, not a debug
      // rematch farm. The released ghost independently guards its unique item.
      if(newly){
        spawnGuardianVictoryCache(e.kind,e);
        try{ if(MM.drops && MM.drops.rollGuardianDrop) MM.drops.rollGuardianDrop(e.kind,e.x,e.y,{boss:true}); }catch(err){}
        try{ if(MM.drops && MM.drops.rollJewelDrop) MM.drops.rollJewelDrop(e,{boss:true,hp:e.maxHp,dmg:26,xp:520}); }catch(err){}
      }
    }else{
      say(e.name+' breaks.');
      try{ if(MM.drops && MM.drops.rollGuardianDrop) MM.drops.rollGuardianDrop(e.kind,e.x,e.y,{role:e.role}); }catch(err){}
    }
  }
  function weaponElement(opts){
    if(!opts) return '';
    const raw=[
      opts.element,
      opts.kind,
      opts.type,
      opts.stream,
      opts.cause,
      opts.weaponType,
      opts.fire?'fire':null
    ].filter(v=>v!=null).join(' ').toLowerCase();
    if(opts.snowball || /\b(ice|frost|chill|cold|snow|snowball|rime|cryo)\b/.test(raw)) return 'ice';
    if(/\b(hose|water|aqua|wet|douse|spit|spitting|saliva)\b/.test(raw)) return 'water';
    if(/\b(flame|fire|heat|burn)\b/.test(raw)) return 'fire';
    return raw;
  }
  function isSnowballWeapon(opts){
    if(!opts) return false;
    if(opts.snowball) return true;
    return /\bsnowball\b/.test([opts.kind,opts.type,opts.cause,opts.weaponType].filter(Boolean).join(' ').toLowerCase());
  }
  function isSpitWeapon(opts){
    if(!opts) return false;
    if(opts.spit) return true;
    return /\b(spit|spitting|saliva)\b/.test([opts.kind,opts.type,opts.cause,opts.weaponType].filter(Boolean).join(' ').toLowerCase());
  }
  function guardianWeaknessMultiplier(e,opts){
    if(!e || !opts) return 1;
    const element=weaponElement(opts);
    if(e.kind==='fire' && element==='water') return e.boss ? 4.25 : 3.35;
    if(e.kind==='ice' && element==='fire') return e.boss ? 2.45 : 2.05;
    return 1;
  }
  function announceWeaknessHit(e,element){
    if(!e || e.weakHint>0) return;
    if(e.kind==='fire' && element==='water') say(e.name+' hisses and cracks under the water jet.');
    else if(e.kind==='ice' && element==='fire') say(e.name+' fractures under the flame.');
    e.weakHint=2.0;
  }
  function noteCombatEvent(detail){
    try{
      if(typeof window!=='undefined' && typeof window.dispatchEvent==='function' && typeof CustomEvent==='function'){
        window.dispatchEvent(new CustomEvent('mm-combat-event',{detail}));
      }
    }catch(e){}
  }
  function announceNaraCoolant(e,kind){
    if(!e || e.weakHint>0) return;
    if(kind==='snowball') say('Nara: Snow. Maximum cooling, minimum dignity. An excellent weapon.');
    else if(kind==='spit') say('Nara: Did you just spit at the firewall? Disgusting. Clever. Annoyingly effective.');
    else if(kind==='water') say('Nara: Water dims the ward. Spit is ruder; snow is faster.');
    else say('Nara: Ice reaches the torch, but snowballs make the point better.');
    e.weakHint=2.2;
  }
  function douseNaraTorch(e){
    if(!e || !e.torchLit) return false;
    e.torchLit=false;
    e.vulnerableT=6.4;
    e.attackCd=99;
    for(let i=hazards.length-1;i>=0;i--){
      const h=hazards[i];
      if(h.kind==='fire' && h.source===e.id && h.type==='torchJet') hazards.splice(i,1);
    }
    addEffect({type:'torchDouse',kind:'fire',x:e.x,y:e.y-0.72,t:0,max:1.35,r:10});
    say('Nara: There—the trick. Cool the torch, not the woman. Now every weapon can reach me.');
    sfx('spark',{x:e.x,y:e.y});
    return true;
  }
  function hitIceChoir(e,dmg,opts){
    const element=weaponElement(opts);
    const source=String(opts && opts.source || 'hero').toLowerCase();
    // Autonomous and already-applied damage is not a new player interruption.
    // Without this distinction, one nearby turret or a lingering burn can
    // reset the silence forever after the player has deliberately stopped.
    const restartsSilence=source==='hero' || source==='player' || source==='coop' || source==='guest';
    const base=Math.max(0.5,Number(dmg)||0.5);
    if(e.sealed){
      if(restartsSilence){
        e.quietT=0;
        e.hitFlash=0.08;
        addEffect({type:'choirBlock',kind:'ice',x:e.x,y:e.y,t:0,max:0.5,r:4.4});
        e.wardHint=(Number(e.wardHint)||0)-0.1;
        if(e.wardHint<=0){
          say('Sile: Every strike restarts the silence. Wait '+e.quietNeed.toFixed(1)+' seconds; listening is the key you do not swing.');
          e.wardHint=3.4;
        }
      }
      return true;
    }
    let mult=1.12;
    if(element==='fire') mult=3.65;
    else if(element==='ice') mult=0.55;
    else if(element==='water') mult=0.72;
    const amount=base*mult;
    e.hp-=amount;
    e.hitFlash=0.22;
    addEffect({type:element==='fire'?'heartglassThaw':'hit',kind:'ice',x:e.x,y:e.y,t:0,max:0.34,r:3.8});
    if(element==='fire' && source!=='status' && e.weakHint<=0){
      say('Sile: Fire is an excellent answer. It just was not the question that opened me.');
      e.weakHint=2.3;
    }
    // Burn ticks retain elemental damage, but suppress repeated major combat
    // events. Direct hero, co-op and turret hits remain correctly attributed.
    if(source!=='status'){
      noteCombatEvent({
        kind:'elemental',source,target:'guardian',x:e.x,y:e.y-0.4,amount,element,
        cause:element==='fire'?'heartglass_fire_weakness':'heartglass_open',
        bonusDamagePct:Math.round((mult-1)*100),major:true,power:element==='fire'?2.35:1.25
      });
    }
    if(e.hp<=0) defeatEntity(e);
    return true;
  }
  function hitTrueSelf(e,dmg,opts){
    const element=weaponElement(opts), ice=element==='ice', water=element==='water';
    const snowball=isSnowballWeapon(opts), spit=water && isSpitWeapon(opts);
    const base=Math.max(0.5,Number(dmg)||0.5);
    let amount=base, cooling=0, coolant='';
    if(e.torchLit && !ice && !water){
      e.hitFlash=0.08;
      e.wardHint=(Number(e.wardHint)||0)-0.1;
      addEffect({type:'wardBlock',kind:'fire',x:e.x,y:e.y-0.45,t:0,max:0.42,r:3.2});
      if(e.wardHint<=0){
        say('Nara: The firewall is literal. Snow is best. If you run out, spit—or try water like a civilized person.');
        e.wardHint=3.2;
      }
      return true;
    }
    if(ice){
      amount=snowball ? Math.max(18,amount*9) : amount*4.5;
      cooling=snowball?26:Math.min(30,12+amount*0.22);
      coolant=snowball?'snowball':'ice';
    }else if(spit){
      amount=Math.max(10,amount*5.75);
      cooling=20;
      coolant='spit';
    }else if(water){
      amount=Math.max(2,amount*2.25);
      cooling=Math.min(12,2.5+Math.sqrt(base)*1.8);
      coolant='water';
    }else amount*=1.08;
    if(cooling>0){
      announceNaraCoolant(e,coolant);
      if(e.torchLit){
        e.frostMeter=Math.min(e.frostNeed,(Number(e.frostMeter)||0)+cooling);
        if(e.frostMeter>=e.frostNeed) douseNaraTorch(e);
      }
      addEffect({type:'torchDouse',kind:'fire',x:e.x,y:e.y-0.5,t:0,max:0.42,r:3.4});
      noteCombatEvent({
        kind:'elemental',source:'hero',target:'guardian',x:e.x,y:e.y-0.55,amount,element,
        cause:snowball?'snowball_secret':(spit?'spit_weakness':(water?'water_weakness':'ice_weakness')),
        bonusDamagePct:Math.round((amount/base-1)*100),major:true,
        power:snowball?2.4:(spit?2.05:(water?1.45:1.8))
      });
    }
    e.hp-=amount;
    e.hitFlash=0.2;
    addEffect({type:'hit',kind:'fire',x:e.x,y:e.y-0.35,t:0,max:0.24,r:2.4});
    if(e.hp<=0) defeatEntity(e);
    return true;
  }
  function hitEntity(e,dmg,opts){
    if(!e || e.dead || !(dmg>0)) return false;
    if(isTrueSelf(e)) return hitTrueSelf(e,dmg,opts);
    if(isIceChoir(e)) return hitIceChoir(e,dmg,opts);
    let amount=Math.max(0.5,dmg);
    if(e.boss){
      const mult=sidekickShieldMult(e);
      amount*=mult;
      if(mult<0.95 && e.shieldHint<=0){ say(e.name+' is shielded by its sidekicks.'); e.shieldHint=2.5; }
    }
    const element=weaponElement(opts);
    // weakened elemental matrix (boss_status.js): a soaked guardian conducts
    const conduct=/electric|shock|laser|lightning/.test(element) ? bossElectricDamageMult(e._elemStatus) : 1;
    if(conduct>1) amount*=conduct;
    const weak=guardianWeaknessMultiplier(e,opts);
    if(weak>1){
      amount*=weak;
      announceWeaknessHit(e,element);
      addEffect({type:'burst',kind:e.kind,x:e.x,y:e.y,t:0,max:0.32,r:(e.radius||1)*3.2});
      noteCombatEvent({
        kind:'elemental',
        source:'hero',
        target:'guardian',
        x:e.x,
        y:e.y-0.55,
        amount,
        element,
        cause:element==='fire'?'heat_bonus':'water_bonus',
        bonusDamagePct:Math.round((weak-1)*100),
        major:true,
        power:Math.max(1.15,Math.min(2.4,weak*0.55))
      });
    }
    e.hp-=amount;
    e.hitFlash=0.18;
    e.shieldHint=Math.max(0,(e.shieldHint||0)-0.1);
    addEffect({type:'hit',kind:e.kind,x:e.x,y:e.y,t:0,max:0.24,r:e.radius*2});
    if(e.hp<=0) defeatEntity(e);
    return true;
  }
  function entityAtTile(tx,ty){
    if(!Number.isFinite(tx) || !Number.isFinite(ty)) return null;
    const x=tx+0.5, y=ty+0.5;
    let best=null, bd=Infinity;
    for(const e of entities){
      if(e.dead) continue;
      const d=entityHitScore(e,x,y,0.55);
      if(d<bd){ bd=d; best=e; }
    }
    return best;
  }
  function damageAt(tx,ty,dmg,opts){
    const e=entityAtTile(tx,ty);
    if(!e) return false;
    return hitEntity(e, Math.max(0.5, Number(dmg)||1), opts);
  }
  function attackAt(tx,ty,bonus){
    return damageAt(tx,ty, 4+Math.max(0,Number(bonus)||0));
  }
  function targetsForTurret(sx,sy,range,onlyBoss){
    const out=[];
    const r2=(Number(range)||0)*(Number(range)||0);
    for(const e of entities){
      if(e.dead) continue;
      if(onlyBoss && onlyBoss!==true && onlyBoss!==e) continue;
      if(onlyBoss===true && !e.boss) continue;
      const d2=dist2(sx,sy,e.x,e.y);
      if(d2>r2) continue;
      out.push({kind:'guardian',guardian:e,raw:e,x:e.x,y:e.y,tx:Math.floor(e.x),ty:Math.floor(e.y),hp:e.hp,d2});
    }
    out.sort((a,b)=>a.d2-b.d2);
    return out;
  }
  function nearestForTurret(sx,sy,range,onlyBoss){
    const t=targetsForTurret(sx,sy,range,onlyBoss);
    return t.length ? t[0] : null;
  }
  function collideHero(p,dt){
    p=p || playerRef();
    if(!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    let hit=false;
    for(const e of entities){
      if(e.dead) continue;
      if(separateHeroFromEntity(e,p,dt)) hit=true;
    }
    return hit;
  }

  function update(dt,player,getTile,setTile){
    if(typeof getTile==='function') lastGetTile=getTile;
    if(typeof setTile==='function') lastSetTile=setTile;
    if(typeof dt!=='number' || !(dt>0)) return;
    dt=Math.min(0.1,dt);
    player=player || playerRef();
    const hearts=progressHearts();
    for(const kind of ['fire','ice']){
      if(!hearts[kind]) continue;
      state.defeated[kind]=true;
      state.avatarBroken[kind]=true;
    }
    maybeEnableUndergroundGate(getTile,setTile);
    if(player && Number.isFinite(player.x)){
      for(const kind of ['fire','ice']){
        const spec=SPEC[kind];
        const L=layoutFor(kind);
        const sideDistance=player.x*spec.dir;
        if((state.awakened[kind] || activeBoss(kind)) && !inGuardianNeighbourhood(kind,player,L)) sleepGuardian(kind);
        awakenOnArenaEntry(kind,player,L,getTile,setTile);
        if(!isDefeated(kind) && sideDistance>=CFG.DISTANCE && !activeKind(kind)){
          const depth=clamp((sideDistance-CFG.DISTANCE)/9000,0,1);
          state.ambientCd[kind]-=dt*(0.55+depth*1.8);
          if(state.ambientCd[kind]<=0){
            spawnAmbientSidekick(kind,player);
            state.ambientCd[kind]=lerp(CFG.AMBIENT_MAX_CD,CFG.AMBIENT_MIN_CD,depth)*(0.75+Math.random()*0.5);
          }
        }
      }
    }
    for(let i=entities.length-1;i>=0;i--){
      const e=entities[i];
      if(e.dead){ entities.splice(i,1); continue; }
      if(e.shieldHint>0) e.shieldHint-=dt;
      // weakened matrix tick: burn = half DoT, chill = 20% slow (scaled dt —
      // guardians never hard-freeze; boss_status downgrades freeze to chill)
      const elem=tickBossStatus(bossStatusFor(e),dt);
      if(elem.damage>0 && !e.dead) hitEntity(e,elem.damage,{source:'status',cause:'burn_dot'});
      if(e.dead){ entities.splice(i,1); continue; }
      updateEntity(e,player,getTile,setTile,dt*elem.speedMult,dt);
      if(e.dead) entities.splice(i,1);
    }
    const fireBoss=activeBoss('fire'), iceBoss=activeBoss('ice');
    const fireLayout=fireBoss ? layoutFor('fire') : null;
    const iceLayout=iceBoss ? layoutFor('ice') : null;
    updateStorm('fire',fireBoss,player,dt,fireLayout);
    updateStorm('ice',iceBoss,player,dt,iceLayout);
    updateLightningWeather('fire',fireBoss,player,dt,getTile,setTile,fireLayout);
    updateLightningWeather('ice',iceBoss,player,dt,getTile,setTile,iceLayout);
    updateHazards(dt,player,getTile,setTile);
    updateEffects(dt);
    updateGhosts(dt,player);
  }

  function makeDrawView(camX,camY,W,H,TILE,zoom){
    if(!Number.isFinite(camX) || !Number.isFinite(camY) || !(W>0) || !(H>0) || !(TILE>0)) return null;
    const z=(Number.isFinite(zoom) && zoom>0) ? zoom : 1;
    const margin=18;
    return {x0:camX-margin,y0:camY-margin,x1:camX+W/(TILE*z)+margin,y1:camY+H/(TILE*z)+margin};
  }
  function inDrawView(view,x,y,r){
    if(!view) return true;
    const m=r||0;
    return x+m>=view.x0 && x-m<=view.x1 && y+m>=view.y0 && y-m<=view.y1;
  }
  function tileVisible(canDrawTile,x,y,view,r){
    if(!inDrawView(view,x,y,r)) return false;
    return typeof canDrawTile!=='function' || canDrawTile(Math.floor(x),Math.floor(y));
  }
  function rgba(hex,a){
    if(typeof hex!=='string' || hex[0]!=='#' || hex.length<7) return 'rgba(255,255,255,'+clamp(a,0,1).toFixed(3)+')';
    const n=parseInt(hex.slice(1,7),16);
    return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+clamp(a,0,1).toFixed(3)+')';
  }
  function drawFireArenaAtmosphere(ctx,TILE,L,now,active){
    if(!L || !L.design || L.design.schema!=='east_fire_crucible_v3') return;
    const heat=active?1:0.62;
    const sunX=L.ax*TILE, sunY=(L.floorY-26)*TILE;
    ctx.save();

    // Chimney soot stays high and translucent, leaving actors readable while
    // visually connecting the black Sadza banks to the working crucible.
    ctx.globalCompositeOperation='source-over';
    for(let i=0;i<(L.chimneys||[]).length;i++){
      const c=L.chimneys[i];
      for(let j=0;j<3;j++){
        const age=(now*(0.13+j*0.025)+i*0.21+j*0.31)%1;
        const x=(c.x+Math.sin(now*0.7+i+j)*0.7*age)*TILE;
        const y=(c.y-age*(5.5+j))*TILE;
        ctx.fillStyle='rgba(15,12,14,'+(0.16*(1-age)*heat).toFixed(3)+')';
        ctx.beginPath();
        ctx.arc(x,y,TILE*(0.55+age*1.15),0,Math.PI*2);
        ctx.fill();
      }
    }

    ctx.globalCompositeOperation='lighter';
    const corona=ctx.createRadialGradient(sunX,sunY,TILE*0.5,sunX,sunY,TILE*(active?18:14));
    corona.addColorStop(0,'rgba(255,248,193,'+(0.24*heat).toFixed(3)+')');
    corona.addColorStop(0.16,'rgba(255,161,48,'+(0.20*heat).toFixed(3)+')');
    corona.addColorStop(0.55,'rgba(255,77,20,'+(0.09*heat).toFixed(3)+')');
    corona.addColorStop(1,'rgba(255,60,12,0)');
    ctx.fillStyle=corona;
    ctx.beginPath(); ctx.arc(sunX,sunY,TILE*(active?18:14),0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='rgba(255,194,76,'+(0.20*heat).toFixed(3)+')';
    ctx.lineWidth=Math.max(1,TILE*0.12);
    for(let i=0;i<12;i++){
      const a=i*Math.PI/6+Math.sin(now*0.45+i)*0.05;
      const r0=TILE*8.5, r1=TILE*(12.5+(i%3)*1.8);
      ctx.beginPath();
      ctx.moveTo(sunX+Math.cos(a)*r0,sunY+Math.sin(a)*r0);
      ctx.lineTo(sunX+Math.cos(a)*r1,sunY+Math.sin(a)*r1);
      ctx.stroke();
    }

    for(const p of L.embers||[]){
      const drift=(now*p.speed+p.phase)%5.5;
      const ex=(p.x+Math.sin(now*p.speed+p.phase)*0.8)*TILE;
      const ey=(p.y-drift)*TILE;
      const a=0.18+0.34*(1-drift/5.5)*heat;
      ctx.fillStyle=(p.size>0.17?'rgba(255,238,153,':'rgba(255,104,31,')+a.toFixed(3)+')';
      const sz=Math.max(1,p.size*TILE);
      ctx.fillRect(ex-sz*0.5,ey-sz*0.5,sz,sz);
    }

    // Heat-haze ribbons are bounded authored lines, not a per-pixel filter.
    ctx.strokeStyle='rgba(255,126,43,'+(0.075*heat).toFixed(3)+')';
    ctx.lineWidth=Math.max(1,TILE*0.08);
    for(let i=-5;i<=5;i++){
      const x=(L.ax+i*9+Math.sin(now*1.3+i)*1.2)*TILE;
      ctx.beginPath();
      ctx.moveTo(x,(L.floorY-3)*TILE);
      ctx.bezierCurveTo(x-TILE*1.1,(L.floorY-9)*TILE,x+TILE*1.2,(L.floorY-15)*TILE,x,(L.floorY-21)*TILE);
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawIceArenaAtmosphere(ctx,TILE,L,now,active){
    if(!L || !L.design || L.design.schema!=='west_ice_palace_v3') return;
    const cold=active?1:0.58;
    const cx=L.ax*TILE, top=(L.floorY-27)*TILE;
    ctx.save();
    ctx.globalCompositeOperation='lighter';

    // Three bounded aurora ribbons make the cathedral feel enormous without a
    // full-screen filter. Their crossing colors echo the five-part final choir.
    const colors=['rgba(105,255,221,','rgba(113,164,255,','rgba(211,126,255,'];
    for(let band=0;band<3;band++){
      ctx.strokeStyle=colors[band]+(0.10*cold).toFixed(3)+')';
      ctx.lineWidth=TILE*(1.1+band*0.34);
      ctx.beginPath();
      const y=top+band*TILE*3.2;
      ctx.moveTo(cx-TILE*53,y+Math.sin(now*0.31+band)*TILE*2);
      ctx.bezierCurveTo(cx-TILE*24,y-TILE*(5+band),cx+TILE*19,y+TILE*(6-band),cx+TILE*53,y+Math.sin(now*0.37+band*2)*TILE*2);
      ctx.stroke();
    }

    for(const p of L.snowMotes||[]){
      const fall=(now*p.speed+p.phase)%8.5;
      const x=(p.x+Math.sin(now*(0.35+p.aurora*0.22)+p.phase)*1.25)*TILE;
      const y=(p.y+fall)*TILE;
      const a=(0.20+0.36*(1-fall/8.5))*cold;
      ctx.fillStyle=p.aurora>0.86?'rgba(190,255,226,'+a.toFixed(3)+')':'rgba(240,251,255,'+a.toFixed(3)+')';
      const sz=Math.max(1,p.size*TILE);
      ctx.fillRect(x-sz*0.5,y-sz*0.5,sz,sz);
    }

    // The breakable panes reflect a moving vertical glint even while intact;
    // after a pane cracks, the ordinary water renderer takes over naturally.
    ctx.lineWidth=Math.max(1,TILE*0.07);
    for(const pool of L.mirrorPools||[]){
      const x0=pool.x0*TILE, x1=(pool.x1+1)*TILE, y=pool.y*TILE;
      const sweep=(Math.sin(now*0.8+pool.x0*0.07)*0.5+0.5);
      ctx.strokeStyle='rgba(226,252,255,'+(0.17*cold).toFixed(3)+')';
      ctx.beginPath(); ctx.moveTo(x0,y+TILE*0.18); ctx.lineTo(x1,y+TILE*0.18); ctx.stroke();
      ctx.strokeStyle='rgba(130,235,255,'+(0.28*cold).toFixed(3)+')';
      const sx=lerp(x0,x1,sweep);
      ctx.beginPath(); ctx.moveTo(sx-TILE*1.2,y+TILE*0.08); ctx.lineTo(sx+TILE*1.2,y+TILE*0.30); ctx.stroke();
    }

    const halo=ctx.createRadialGradient(cx,(L.floorY-10)*TILE,2,cx,(L.floorY-10)*TILE,TILE*25);
    halo.addColorStop(0,'rgba(220,253,255,'+(0.18*cold).toFixed(3)+')');
    halo.addColorStop(0.45,'rgba(100,211,255,'+(0.09*cold).toFixed(3)+')');
    halo.addColorStop(1,'rgba(76,145,255,0)');
    ctx.fillStyle=halo; ctx.beginPath(); ctx.arc(cx,(L.floorY-10)*TILE,TILE*25,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }
  function drawLairGlows(ctx,TILE,canDrawTile,view){
    const now=(typeof performance!=='undefined'?performance.now():0)*0.001;
    for(const kind of ['fire','ice']){
      const L=layoutFor(kind), spec=SPEC[kind];
      if(!L || !tileVisible(canDrawTile,L.ax,L.floorY-10,view,48)) continue;
      if(kind==='fire') drawFireArenaAtmosphere(ctx,TILE,L,now,activeKind(kind));
      else drawIceArenaAtmosphere(ctx,TILE,L,now,activeKind(kind));
      ctx.save();
      ctx.globalCompositeOperation='lighter';
      for(const g of L.glows){
        const pulse=0.65+Math.sin(now*2+g.x)*0.22;
        const R=g.r*TILE*(0.8+pulse*0.25);
        const grad=ctx.createRadialGradient(g.x*TILE,g.y*TILE,2,g.x*TILE,g.y*TILE,R);
        grad.addColorStop(0,rgba(spec.accent,0.30));
        grad.addColorStop(1,rgba(spec.accent,0));
        ctx.fillStyle=grad;
        ctx.beginPath(); ctx.arc(g.x*TILE,g.y*TILE,R,0,Math.PI*2); ctx.fill();
      }
      const arenaR=34*TILE;
      const grad=ctx.createRadialGradient(L.ax*TILE,(L.floorY-8)*TILE,4,L.ax*TILE,(L.floorY-8)*TILE,arenaR);
      grad.addColorStop(0,rgba(spec.accent,activeKind(kind)?0.18:0.08));
      grad.addColorStop(1,rgba(spec.accent,0));
      ctx.fillStyle=grad; ctx.fillRect((L.ax-40)*TILE,(L.floorY-30)*TILE,80*TILE,34*TILE);
      ctx.restore();
    }
  }
  function drawUndergroundGateGlow(ctx,TILE,canDrawTile,view){
    if(!state.underground || !state.underground.enabled) return;
    const U=undergroundGateLayout();
    if(!U || !tileVisible(canDrawTile,U.x,U.y,view,34)) return;
    const now=(typeof performance!=='undefined'?performance.now():0)*0.001;
    const pulse=0.72+Math.sin(now*2.7)*0.18;
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    const grad=ctx.createRadialGradient(U.x*TILE,U.y*TILE,2,U.x*TILE,U.y*TILE,24*TILE*pulse);
    grad.addColorStop(0,'rgba(196,107,255,0.34)');
    grad.addColorStop(0.42,'rgba(121,201,93,0.16)');
    grad.addColorStop(1,'rgba(196,107,255,0)');
    ctx.fillStyle=grad;
    ctx.beginPath(); ctx.arc(U.x*TILE,U.y*TILE,24*TILE*pulse,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='rgba(245,248,255,0.44)';
    ctx.lineWidth=Math.max(1,TILE*0.08);
    ctx.beginPath(); ctx.arc(U.x*TILE,U.y*TILE,(5.5+Math.sin(now*3.1)*0.6)*TILE,0,Math.PI*2); ctx.stroke();
    ctx.restore();
  }
  function drawHazards(ctx,TILE,canDrawTile,view){
    for(const h of hazards){
      const hx=Number.isFinite(h.x)?h.x:h.x1, hy=Number.isFinite(h.y)?h.y:h.y1;
      if(!tileVisible(canDrawTile,hx,hy,view,h.explodeR||h.r||8)) continue;
      const spec=SPEC[h.kind];
      ctx.save();
      ctx.globalCompositeOperation='lighter';
      if(h.type==='projectile'){
        const pulse=0.6+0.4*Math.sin(h.t*18);
        ctx.fillStyle=rgba(spec.accent,0.75);
        ctx.shadowColor=spec.accent; ctx.shadowBlur=12;
        if(h.variant==='icicle'){
          const a=Math.atan2(h.vy||1,h.vx||0)-Math.PI/2, rr=Math.max(4,h.r*TILE*3.2);
          ctx.save(); ctx.translate(h.x*TILE,h.y*TILE); ctx.rotate(a);
          ctx.beginPath(); ctx.moveTo(0,rr); ctx.lineTo(-h.r*TILE,0); ctx.lineTo(0,-rr*0.42); ctx.lineTo(h.r*TILE,0); ctx.closePath(); ctx.fill(); ctx.restore();
        }else if(h.variant==='heartglass'){
          const rr=Math.max(3,h.r*TILE*(1+pulse*0.2));
          ctx.save(); ctx.translate(h.x*TILE,h.y*TILE); ctx.rotate(h.t*5);
          ctx.beginPath(); ctx.moveTo(0,-rr*1.6); ctx.lineTo(rr,0); ctx.lineTo(0,rr*1.6); ctx.lineTo(-rr,0); ctx.closePath(); ctx.fill(); ctx.restore();
        }else{
          ctx.beginPath(); ctx.arc(h.x*TILE,h.y*TILE,Math.max(3,h.r*TILE*(0.9+pulse*0.25)),0,Math.PI*2); ctx.fill();
        }
      }else if(h.type==='skyLightning'){
        const armed=h.t>=h.delay;
        const f=armed ? clamp(1-(h.t-h.delay)/Math.max(0.01,h.life),0,1) : clamp(h.t/h.delay,0,1)*0.45;
        const core=h.kind==='fire'?'255,240,185':'235,252,255';
        ctx.shadowColor=h.kind==='fire'?spec.accent:spec.accent2;
        ctx.shadowBlur=armed?22:8;
        const passes=[
          [7,rgba(spec.accent,0.20+f*0.26)],
          [3.2,'rgba('+core+','+(0.30+f*0.50).toFixed(3)+')'],
          [1.4,'rgba(255,255,255,'+(0.25+f*0.72).toFixed(3)+')']
        ];
        for(const pass of passes){
          ctx.strokeStyle=pass[1]; ctx.lineWidth=Math.max(1,pass[0]);
          ctx.beginPath(); ctx.moveTo(h.x1*TILE,h.y1*TILE); ctx.lineTo(h.x2*TILE,h.y2*TILE); ctx.stroke();
          if(h.branches){
            ctx.lineWidth=Math.max(1,pass[0]*0.48);
            for(const b of h.branches){
              ctx.beginPath(); ctx.moveTo(b.x1*TILE,b.y1*TILE); ctx.lineTo(b.x2*TILE,b.y2*TILE); ctx.stroke();
            }
          }
        }
      }else if(h.type==='stormMeteor'){
        ctx.shadowColor=spec.accent; ctx.shadowBlur=18;
        if(h.trail && h.trail.length>1){
          for(let i=1;i<h.trail.length;i++){
            const a=i/h.trail.length;
            ctx.strokeStyle=rgba(spec.accent,a*0.55);
            ctx.lineWidth=Math.max(1,TILE*(h.r||0.4)*(0.45+a*0.8));
            ctx.beginPath();
            ctx.moveTo(h.trail[i-1].x*TILE,h.trail[i-1].y*TILE);
            ctx.lineTo(h.trail[i].x*TILE,h.trail[i].y*TILE);
            ctx.stroke();
          }
        }
        ctx.fillStyle=h.kind==='fire'?spec.accent2:'#ffffff';
        ctx.beginPath(); ctx.arc(h.x*TILE,h.y*TILE,Math.max(3,(h.r||0.4)*TILE*1.35),0,Math.PI*2); ctx.fill();
        ctx.strokeStyle=rgba(spec.accent,0.82);
        ctx.lineWidth=Math.max(1,TILE*0.08);
        ctx.beginPath(); ctx.arc(h.x*TILE,h.y*TILE,Math.max(5,(h.r||0.4)*TILE*2.2),0,Math.PI*2); ctx.stroke();
      }else if(h.type==='impact'){
        const armed=h.t>=h.delay;
        const f=armed ? clamp((h.t-h.delay)/Math.max(0.01,h.life),0,1) : clamp(h.t/h.delay,0,1);
        ctx.strokeStyle=rgba(spec.accent,armed?0.75:0.30+f*0.35);
        ctx.lineWidth=Math.max(2,TILE*0.08);
        ctx.beginPath(); ctx.arc(h.x*TILE,h.y*TILE,h.r*TILE*(armed?1+f*0.55:0.35+f*0.65),0,Math.PI*2); ctx.stroke();
        if(!armed){
          ctx.beginPath(); ctx.moveTo((h.x-h.r)*TILE,h.y*TILE); ctx.lineTo((h.x+h.r)*TILE,h.y*TILE); ctx.moveTo(h.x*TILE,(h.y-h.r)*TILE); ctx.lineTo(h.x*TILE,(h.y+h.r)*TILE); ctx.stroke();
        }
        if(h.variant==='memoryEcho'){
          ctx.strokeStyle='rgba(225,252,255,'+(armed?0.82:0.48).toFixed(3)+')';
          ctx.lineWidth=Math.max(1,TILE*0.07);
          for(let j=0;j<3;j++){
            ctx.beginPath(); ctx.ellipse(h.x*TILE+(j-1)*TILE*0.23,h.y*TILE-TILE*(0.18+j*0.22),TILE*(0.18+j*0.04),TILE*(0.31+j*0.05),j*0.24,0,Math.PI*2); ctx.stroke();
          }
        }
      }else if(h.type==='torchJet'){
        const armed=h.t>=h.delay;
        const pulse=0.82+Math.sin(h.t*31)*0.18;
        ctx.globalCompositeOperation='source-over';
        if(armed){
          ctx.strokeStyle='rgba(14,11,13,0.46)'; ctx.lineWidth=h.r*TILE*3.8;
          ctx.shadowColor='rgba(0,0,0,0.65)'; ctx.shadowBlur=14;
          ctx.beginPath(); ctx.moveTo(h.x1*TILE,h.y1*TILE); ctx.lineTo(h.x2*TILE,h.y2*TILE); ctx.stroke();
        }
        ctx.globalCompositeOperation='lighter';
        ctx.shadowColor=spec.accent; ctx.shadowBlur=armed?24:7;
        ctx.strokeStyle=armed?'rgba(255,74,16,0.88)':'rgba(255,183,68,0.34)';
        ctx.lineWidth=(armed?h.r*2.35*pulse:0.24)*TILE;
        ctx.beginPath(); ctx.moveTo(h.x1*TILE,h.y1*TILE); ctx.lineTo(h.x2*TILE,h.y2*TILE); ctx.stroke();
        if(armed){
          ctx.strokeStyle='rgba(255,238,151,0.82)'; ctx.lineWidth=Math.max(2,h.r*TILE*0.62);
          ctx.beginPath(); ctx.moveTo(h.x1*TILE,h.y1*TILE); ctx.lineTo(h.x2*TILE,h.y2*TILE); ctx.stroke();
        }
      }else if(h.type==='beam'){
        const armed=h.t>=h.delay;
        ctx.strokeStyle=rgba(spec.accent,armed?0.80:0.32);
        ctx.lineWidth=(armed? h.r*2.2 : 0.35)*TILE;
        ctx.shadowColor=spec.accent; ctx.shadowBlur=armed?18:6;
        ctx.beginPath(); ctx.moveTo(h.x1*TILE,h.y1*TILE); ctx.lineTo(h.x2*TILE,h.y2*TILE); ctx.stroke();
      }else if(h.type==='ring'){
        const armed=h.t>=h.delay;
        const f=armed?clamp((h.t-h.delay)/h.life,0,1):clamp(h.t/h.delay,0,1);
        const r=armed?lerp(h.r0,h.r1,f):h.r0*f;
        ctx.strokeStyle=rgba(spec.accent,armed?0.70:0.32);
        ctx.lineWidth=Math.max(2,TILE*0.14);
        ctx.beginPath(); ctx.arc(h.x*TILE,h.y*TILE,r*TILE,0,Math.PI*2); ctx.stroke();
        if(h.variant==='hush'){
          ctx.strokeStyle='rgba(244,254,255,'+(armed?0.74:0.30).toFixed(3)+')';
          ctx.lineWidth=Math.max(1,TILE*0.06);
          for(let j=0;j<12;j++){
            const a=j*Math.PI/6, r0=r*TILE-TILE*0.35, r1=r*TILE+TILE*0.35;
            ctx.beginPath(); ctx.moveTo(h.x*TILE+Math.cos(a)*r0,h.y*TILE+Math.sin(a)*r0); ctx.lineTo(h.x*TILE+Math.cos(a)*r1,h.y*TILE+Math.sin(a)*r1); ctx.stroke();
          }
        }
      }else if(h.type==='blizzard'){
        const f=clamp(1-h.t/h.life,0,1);
        const grad=ctx.createRadialGradient(h.x*TILE,h.y*TILE,2,h.x*TILE,h.y*TILE,h.r*TILE);
        grad.addColorStop(0,'rgba(210,250,255,'+(0.18*f).toFixed(3)+')');
        grad.addColorStop(1,'rgba(80,190,255,0)');
        ctx.fillStyle=grad; ctx.beginPath(); ctx.arc(h.x*TILE,h.y*TILE,h.r*TILE,0,Math.PI*2); ctx.fill();
      }
      ctx.restore();
    }
  }
  function drawNara(ctx,TILE,e,now){
    const x=e.x*TILE, y=e.y*TILE, s=e.dir||1;
    const lit=!!e.torchLit, frost=clamp((e.frostMeter||0)/(e.frostNeed||72),0,1);
    const torchX=x+s*TILE*1.04, torchY=y-TILE*0.86;

    // The human silhouette is deliberately source-over and soot-dark so it
    // remains legible in the brightest arena in the game.
    ctx.globalCompositeOperation='source-over';
    ctx.shadowColor='rgba(0,0,0,0.75)'; ctx.shadowBlur=10;
    ctx.fillStyle='#120e12';
    ctx.beginPath();
    ctx.moveTo(x-TILE*0.62,y-TILE*0.48);
    ctx.quadraticCurveTo(x-TILE*0.95,y+TILE*0.35,x-TILE*0.48,y+TILE*1.03);
    ctx.lineTo(x+TILE*0.48,y+TILE*1.03);
    ctx.quadraticCurveTo(x+TILE*0.95,y+TILE*0.35,x+TILE*0.62,y-TILE*0.48);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle='#512017';
    ctx.beginPath();
    ctx.moveTo(x-TILE*0.44,y-TILE*0.55); ctx.lineTo(x+TILE*0.44,y-TILE*0.55);
    ctx.lineTo(x+TILE*0.60,y+TILE*0.64); ctx.lineTo(x,y+TILE*0.34); ctx.lineTo(x-TILE*0.60,y+TILE*0.64);
    ctx.closePath(); ctx.fill();

    // Split stance and visible hands keep her a person, rather than another
    // floating guardian glyph.
    ctx.strokeStyle='#241315'; ctx.lineWidth=TILE*0.24; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(x-TILE*0.23,y+TILE*0.42); ctx.lineTo(x-TILE*0.34,y+TILE*1.18); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x+TILE*0.23,y+TILE*0.42); ctx.lineTo(x+TILE*0.37,y+TILE*1.18); ctx.stroke();
    ctx.strokeStyle='#d69a78'; ctx.lineWidth=TILE*0.20;
    ctx.beginPath(); ctx.moveTo(x+s*TILE*0.28,y-TILE*0.43); ctx.lineTo(torchX-s*TILE*0.12,torchY+TILE*0.14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x-s*TILE*0.30,y-TILE*0.42); ctx.lineTo(x-s*TILE*0.62,y+TILE*0.12); ctx.stroke();

    // Face, black hair and charcoal diadem.
    ctx.fillStyle='#d9a07c';
    ctx.beginPath(); ctx.ellipse(x,y-TILE*1.22,TILE*0.36,TILE*0.46,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#171116';
    ctx.beginPath();
    ctx.arc(x-s*TILE*0.08,y-TILE*1.34,TILE*0.42,Math.PI*0.83,Math.PI*2.12); ctx.fill();
    ctx.fillRect(x-s*TILE*0.41,y-TILE*1.33,TILE*0.18*s,y+TILE*0.42-(y-TILE*1.33));
    ctx.strokeStyle='#09080a'; ctx.lineWidth=Math.max(1,TILE*0.10);
    ctx.beginPath(); ctx.moveTo(x-TILE*0.27,y-TILE*1.62); ctx.lineTo(x,y-TILE*1.83); ctx.lineTo(x+TILE*0.27,y-TILE*1.62); ctx.stroke();
    ctx.fillStyle='#fff3c4';
    ctx.beginPath(); ctx.arc(x+s*TILE*0.13,y-TILE*1.25,TILE*0.045,0,Math.PI*2); ctx.fill();

    // Torch: recognisably the player's tool, but overdriven with coal flame.
    ctx.strokeStyle='#2b1b13'; ctx.lineWidth=TILE*0.18;
    ctx.beginPath(); ctx.moveTo(torchX-s*TILE*0.18,torchY+TILE*0.48); ctx.lineTo(torchX+s*TILE*0.08,torchY-TILE*0.55); ctx.stroke();
    ctx.strokeStyle='#8f4d24'; ctx.lineWidth=TILE*0.07;
    ctx.beginPath(); ctx.moveTo(torchX-s*TILE*0.14,torchY+TILE*0.43); ctx.lineTo(torchX+s*TILE*0.07,torchY-TILE*0.50); ctx.stroke();
    if(lit){
      ctx.globalCompositeOperation='lighter';
      ctx.shadowColor='#ff5b18'; ctx.shadowBlur=22;
      const flicker=Math.sin((now||0)*0.017+e.t*9)*TILE*0.08;
      ctx.fillStyle='rgba(255,75,15,0.90)';
      ctx.beginPath(); ctx.moveTo(torchX,torchY-TILE*0.38-flicker); ctx.quadraticCurveTo(torchX+s*TILE*0.48,torchY-TILE*0.92,torchX-s*TILE*0.02,torchY-TILE*1.48-flicker); ctx.quadraticCurveTo(torchX-s*TILE*0.54,torchY-TILE*0.75,torchX,torchY-TILE*0.38-flicker); ctx.fill();
      ctx.fillStyle='rgba(255,239,139,0.92)';
      ctx.beginPath(); ctx.ellipse(torchX,torchY-TILE*0.70,TILE*0.19,TILE*0.43,s*0.18,0,Math.PI*2); ctx.fill();
      ctx.globalCompositeOperation='source-over';
      for(let i=0;i<5;i++){
        const age=(e.t*(0.28+i*0.015)+i*0.19)%1;
        ctx.fillStyle='rgba(12,10,12,'+(0.34*(1-age)).toFixed(3)+')';
        ctx.beginPath(); ctx.arc(torchX+s*Math.sin(e.t+i)*TILE*0.18*age,torchY-TILE*(1.0+age*1.75),TILE*(0.16+age*0.38),0,Math.PI*2); ctx.fill();
      }
    }else{
      ctx.globalCompositeOperation='lighter';
      ctx.fillStyle='rgba(179,239,255,0.78)';
      for(let i=0;i<4;i++){
        const a=e.t*1.1+i*1.57;
        ctx.beginPath(); ctx.arc(torchX+Math.cos(a)*TILE*0.28,torchY-TILE*0.55+Math.sin(a)*TILE*0.15,TILE*0.07,0,Math.PI*2); ctx.fill();
      }
    }

    // Six fire ornaments orbit the cloak. During the opening puzzle the ward
    // visually cools from orange to rime-blue as snow accumulates.
    ctx.globalCompositeOperation='lighter';
    for(let i=0;i<6;i++){
      const a=e.t*0.75+i*Math.PI/3;
      const ox=x+Math.cos(a)*TILE*0.72, oy=y+Math.sin(a)*TILE*0.48;
      ctx.fillStyle=lit?(i%2?'rgba(255,214,79,0.82)':'rgba(255,79,20,0.86)'):'rgba(178,241,255,0.72)';
      ctx.beginPath(); ctx.moveTo(ox,oy-TILE*0.20); ctx.lineTo(ox+TILE*0.12,oy+TILE*0.14); ctx.lineTo(ox-TILE*0.12,oy+TILE*0.14); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle=lit?rgba('#ff6a21',0.22+frost*0.48):'rgba(177,239,255,0.68)';
    ctx.lineWidth=Math.max(1,TILE*(0.07+frost*0.06));
    ctx.beginPath(); ctx.arc(x,y-TILE*0.34,TILE*(1.18+Math.sin(e.t*3)*0.05),0,Math.PI*2); ctx.stroke();
  }
  function drawFireEntity(ctx,TILE,e,now){
    const spec=SPEC.fire;
    ctx.save();
    if(isTrueSelf(e)){
      drawNara(ctx,TILE,e,now);
    }else if(e.boss){
      const pts=[];
      for(let i=0;i<=10;i++){
        const a=e.t*2.4+i*0.62;
        pts.push({x:e.x-e.dir*i*1.02+Math.sin(a)*1.25,y:e.y+Math.cos(a*0.9)*0.9+i*0.10});
      }

      // Soot-black wing membranes and horns give the Solar Wyrm a readable
      // silhouette even against its own fire. Phase two sheds orbiting Sadza.
      const shoulder=pts[2], neck=pts[0];
      ctx.globalCompositeOperation='source-over';
      ctx.fillStyle=e.phase>=2?'rgba(19,12,16,0.88)':'rgba(59,16,9,0.84)';
      for(const side of [-1,1]){
        ctx.beginPath();
        ctx.moveTo(shoulder.x*TILE,shoulder.y*TILE);
        ctx.lineTo((shoulder.x-e.dir*1.8)*TILE,(shoulder.y+side*5.2)*TILE);
        ctx.lineTo((shoulder.x+e.dir*2.0)*TILE,(shoulder.y+side*2.6)*TILE);
        ctx.lineTo((neck.x-e.dir*0.4)*TILE,(neck.y+side*0.9)*TILE);
        ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle='rgba(255,89,25,0.64)';
      ctx.lineWidth=Math.max(1,TILE*0.12);
      for(const side of [-1,1]){
        ctx.beginPath();
        ctx.moveTo(shoulder.x*TILE,shoulder.y*TILE);
        ctx.lineTo((shoulder.x-e.dir*1.8)*TILE,(shoulder.y+side*5.2)*TILE);
        ctx.lineTo((shoulder.x+e.dir*2.0)*TILE,(shoulder.y+side*2.6)*TILE);
        ctx.stroke();
      }

      ctx.globalCompositeOperation='lighter';
      ctx.lineCap='round'; ctx.lineJoin='round';
      const bodyPath=()=>{
        ctx.beginPath(); ctx.moveTo(pts[0].x*TILE,pts[0].y*TILE);
        for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x*TILE,pts[i].y*TILE);
      };
      ctx.shadowColor=spec.accent; ctx.shadowBlur=18;
      bodyPath(); ctx.strokeStyle='rgba(75,18,8,0.92)'; ctx.lineWidth=TILE*2.55; ctx.stroke();
      bodyPath(); ctx.strokeStyle=e.phase>=1?'rgba(255,78,18,0.96)':'rgba(229,63,18,0.94)'; ctx.lineWidth=TILE*1.86; ctx.stroke();
      bodyPath(); ctx.strokeStyle=e.phase>=1?'rgba(255,213,77,0.74)':'rgba(255,135,36,0.64)'; ctx.lineWidth=TILE*0.68; ctx.stroke();
      for(let i=1;i<pts.length;i++){
        const p=pts[i], rr=Math.max(0.20,0.72-i*0.045)*TILE;
        ctx.fillStyle=i%2?rgba(spec.accent2,0.72):rgba(spec.accent,0.82);
        ctx.beginPath(); ctx.arc(p.x*TILE,p.y*TILE,rr,0,Math.PI*2); ctx.fill();
      }

      // Armoured wedge head, ember mane, black crown and a bright tracking eye.
      const hx=(pts[0].x+e.dir*1.15)*TILE, hy=pts[0].y*TILE;
      ctx.fillStyle='#fff0a3';
      ctx.beginPath();
      ctx.moveTo(hx+e.dir*TILE*2.05,hy);
      ctx.lineTo(hx-e.dir*TILE*0.85,hy-TILE*1.45);
      ctx.lineTo(hx-e.dir*TILE*0.45,hy+TILE*1.36);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle=rgba(spec.accent,0.84);
      for(const side of [-1,1]){
        ctx.beginPath();
        ctx.moveTo(hx-e.dir*TILE*0.35,hy+side*TILE*0.65);
        ctx.lineTo(hx-e.dir*TILE*1.65,hy+side*TILE*1.65);
        ctx.lineTo(hx+e.dir*TILE*0.15,hy+side*TILE*1.05);
        ctx.closePath(); ctx.fill();
      }
      ctx.globalCompositeOperation='source-over';
      ctx.strokeStyle='#171015'; ctx.lineWidth=Math.max(2,TILE*0.20); ctx.lineCap='round';
      for(const side of [-1,1]){
        ctx.beginPath();
        ctx.moveTo(hx-e.dir*TILE*0.15,hy+side*TILE*0.72);
        ctx.quadraticCurveTo(hx-e.dir*TILE*0.8,hy+side*TILE*1.7,hx-e.dir*TILE*1.65,hy+side*TILE*1.85);
        ctx.stroke();
      }
      ctx.globalCompositeOperation='lighter';
      ctx.fillStyle='#ffffff';
      ctx.beginPath(); ctx.arc(hx+e.dir*TILE*0.72,hy-TILE*0.36,TILE*0.17,0,Math.PI*2); ctx.fill();

      if(e.phase>=2){
        ctx.globalCompositeOperation='source-over';
        for(let i=0;i<14;i++){
          const a=e.t*(0.65+(i%3)*0.12)+i*2.399;
          const rr=(3.2+(i%5)*0.7)*TILE;
          const px=neck.x*TILE+Math.cos(a)*rr;
          const py=neck.y*TILE+Math.sin(a*1.27)*rr*0.55;
          ctx.fillStyle='rgba(18,15,18,'+(0.18+(i%4)*0.055).toFixed(3)+')';
          ctx.beginPath(); ctx.arc(px,py,TILE*(0.18+(i%3)*0.08),0,Math.PI*2); ctx.fill();
        }
      }
    }else{
      const x=e.x*TILE, y=e.y*TILE;
      ctx.shadowColor=spec.accent; ctx.shadowBlur=12;
      if(e.role==='bulwark'){
        ctx.globalCompositeOperation='source-over';
        ctx.fillStyle='#2a1713';
        ctx.beginPath();
        ctx.ellipse(x,y,TILE*1.42,TILE*0.82,0,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='#5d2114';
        ctx.beginPath(); ctx.arc(x+e.dir*TILE*0.92,y-TILE*0.28,TILE*0.72,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle='#130d0d'; ctx.lineWidth=Math.max(2,TILE*0.16);
        for(const sx of [-0.75,0.55]){
          ctx.beginPath(); ctx.moveTo(x+sx*TILE,y+TILE*0.38); ctx.lineTo(x+sx*TILE,y+TILE*1.15); ctx.stroke();
        }
        ctx.globalCompositeOperation='lighter';
        ctx.fillStyle=spec.accent;
        for(let i=0;i<4;i++){
          ctx.beginPath(); ctx.arc(x-TILE*0.72+i*TILE*0.43,y-TILE*0.72-Math.sin(e.t*5+i)*TILE*0.12,TILE*0.22,0,Math.PI*2); ctx.fill();
        }
        ctx.fillStyle='#fff3bb'; ctx.fillRect(x+e.dir*TILE*1.12,y-TILE*0.48,TILE*0.15,TILE*0.13);
      }else{
        ctx.globalCompositeOperation='lighter';
        const pulse=1+Math.sin(e.t*5)*0.12;
        ctx.fillStyle=spec.accent2;
        ctx.beginPath();
        ctx.moveTo(x,y-TILE*1.35*pulse); ctx.lineTo(x+TILE*0.86,y); ctx.lineTo(x,y+TILE*1.1); ctx.lineTo(x-TILE*0.86,y); ctx.closePath(); ctx.fill();
        ctx.strokeStyle=rgba(spec.accent,0.78); ctx.lineWidth=Math.max(1,TILE*0.12);
        ctx.beginPath(); ctx.arc(x,y,TILE*(1.55+Math.sin(e.t*3)*0.16),0,Math.PI*2); ctx.stroke();
        for(let i=0;i<3;i++){
          const a=e.t*2+i*Math.PI*2/3;
          ctx.fillStyle=rgba(spec.accent2,0.72);
          ctx.beginPath(); ctx.arc(x+Math.cos(a)*TILE*1.55,y+Math.sin(a)*TILE*0.9,TILE*0.18,0,Math.PI*2); ctx.fill();
        }
      }
    }
    if(e.hitFlash>0){ ctx.globalCompositeOperation='lighter'; ctx.fillStyle='rgba(255,255,255,'+clamp(e.hitFlash*2.2,0,1).toFixed(2)+')'; ctx.beginPath(); ctx.arc(e.x*TILE,e.y*TILE,(e.radius+1)*TILE,0,Math.PI*2); ctx.fill(); }
    ctx.restore();
  }
  function drawIceEntity(ctx,TILE,e,now){
    const spec=SPEC.ice;
    ctx.save();
    const x=e.x*TILE, y=e.y*TILE;
    ctx.shadowColor=spec.accent; ctx.shadowBlur=e.boss?20:11;
    if(isIceChoir(e)){
      // Sile is a collective, not a second humanoid reveal: five translucent
      // speaking facets orbit one dark meltwater memory. Listening opens their
      // inward faces; attacking too soon visibly snaps the geometry shut.
      const open=!e.sealed;
      ctx.globalCompositeOperation='source-over';
      const core=ctx.createRadialGradient(x-TILE*0.18,y-TILE*0.24,2,x,y,TILE*1.25);
      core.addColorStop(0,open?'rgba(255,153,88,0.92)':'rgba(16,36,58,0.96)');
      core.addColorStop(0.36,open?'rgba(104,218,237,0.72)':'rgba(30,81,112,0.88)');
      core.addColorStop(1,'rgba(8,22,38,0)');
      ctx.fillStyle=core; ctx.beginPath(); ctx.arc(x,y,TILE*1.25,0,Math.PI*2); ctx.fill();
      ctx.fillStyle=open?'rgba(255,210,147,0.88)':'rgba(12,31,51,0.92)';
      ctx.beginPath();
      ctx.moveTo(x,y-TILE*0.88); ctx.bezierCurveTo(x+TILE*0.78,y-TILE*0.28,x+TILE*0.47,y+TILE*0.78,x,y+TILE*1.02); ctx.bezierCurveTo(x-TILE*0.47,y+TILE*0.78,x-TILE*0.78,y-TILE*0.28,x,y-TILE*0.88); ctx.fill();

      ctx.globalCompositeOperation='lighter';
      for(let i=0;i<5;i++){
        const a=e.t*(open?0.34:0.72)+i*Math.PI*2/5;
        const rr=TILE*(open?2.18:1.55);
        const fx=x+Math.cos(a)*rr, fy=y+Math.sin(a)*rr*0.58;
        const rot=a+(open?Math.PI*0.5:0);
        ctx.save(); ctx.translate(fx,fy); ctx.rotate(rot);
        const grad=ctx.createLinearGradient(0,-TILE,0,TILE);
        grad.addColorStop(0,i%2?'rgba(220,255,255,0.92)':'rgba(180,223,255,0.92)');
        grad.addColorStop(1,i%2?'rgba(74,179,235,0.38)':'rgba(158,111,255,0.34)');
        ctx.fillStyle=grad;
        ctx.beginPath(); ctx.moveTo(0,-TILE*1.05); ctx.lineTo(TILE*0.62,0); ctx.lineTo(0,TILE*0.9); ctx.lineTo(-TILE*0.62,0); ctx.closePath(); ctx.fill();
        ctx.strokeStyle='rgba(255,255,255,0.82)'; ctx.lineWidth=Math.max(1,TILE*0.06); ctx.stroke();
        ctx.fillStyle=open?'rgba(255,173,105,0.82)':'rgba(12,43,70,0.82)';
        ctx.beginPath(); ctx.arc(0,-TILE*0.08,TILE*0.095,0,Math.PI*2); ctx.fill();
        ctx.restore();
      }
      ctx.strokeStyle=open?'rgba(255,193,125,0.62)':'rgba(205,249,255,0.68)';
      ctx.lineWidth=Math.max(1,TILE*(open?0.08:0.13));
      for(let ring=0;ring<3;ring++){
        ctx.beginPath(); ctx.ellipse(x,y,TILE*(1.6+ring*0.5),TILE*(0.92+ring*0.25),e.t*(ring%2?0.16:-0.12),0,Math.PI*2); ctx.stroke();
      }
    }else if(e.boss){
      // Aurex: an overbuilt sovereign made from crown, mantle and mask. The
      // hollow face foreshadows that this monarch is only defensive scenery.
      ctx.globalCompositeOperation='source-over';
      ctx.fillStyle='rgba(10,30,48,0.88)';
      ctx.beginPath(); ctx.moveTo(x,y-TILE*2.4); ctx.lineTo(x+TILE*2.2,y+TILE*2.0); ctx.lineTo(x,y+TILE*1.45); ctx.lineTo(x-TILE*2.2,y+TILE*2.0); ctx.closePath(); ctx.fill();
      ctx.fillStyle='rgba(66,139,183,0.68)';
      for(const s of [-1,1]){
        ctx.beginPath(); ctx.moveTo(x,y-TILE*0.55); ctx.lineTo(x+s*TILE*(3.8+e.phase*0.25),y-TILE*0.1); ctx.lineTo(x+s*TILE*1.25,y+TILE*1.75); ctx.closePath(); ctx.fill();
      }
      ctx.globalCompositeOperation='lighter';
      ctx.fillStyle=rgba(spec.accent2,0.92);
      ctx.beginPath(); ctx.moveTo(x,y-TILE*2.55); ctx.lineTo(x+TILE*1.35,y-TILE*0.15); ctx.lineTo(x,y+TILE*1.75); ctx.lineTo(x-TILE*1.35,y-TILE*0.15); ctx.closePath(); ctx.fill();
      ctx.fillStyle='rgba(9,35,57,0.86)';
      ctx.beginPath(); ctx.moveTo(x,y-TILE*1.42); ctx.lineTo(x+TILE*0.66,y-TILE*0.12); ctx.lineTo(x,y+TILE*0.8); ctx.lineTo(x-TILE*0.66,y-TILE*0.12); ctx.closePath(); ctx.fill();
      ctx.strokeStyle='rgba(255,255,255,0.88)'; ctx.lineWidth=Math.max(1,TILE*0.09);
      ctx.beginPath(); ctx.moveTo(x,y-TILE*2.45); ctx.lineTo(x,y+TILE*1.6); ctx.moveTo(x-TILE*1.2,y-TILE*0.15); ctx.lineTo(x+TILE*1.2,y-TILE*0.15); ctx.stroke();

      // Nine uneven crown blades and orbiting season seals make phase changes
      // immediately visible without changing collision geometry.
      for(let i=-4;i<=4;i++){
        const bx=x+i*TILE*0.42, bh=TILE*(1.0+(4-Math.abs(i))*0.32+e.phase*0.16);
        ctx.fillStyle=i%2?'rgba(146,232,255,0.78)':'rgba(222,253,255,0.92)';
        ctx.beginPath(); ctx.moveTo(bx-TILE*0.2,y-TILE*2.0); ctx.lineTo(bx,y-TILE*2.0-bh); ctx.lineTo(bx+TILE*0.2,y-TILE*2.0); ctx.closePath(); ctx.fill();
      }
      for(let i=0;i<8+e.phase*2;i++){
        const a=e.t*(1.05+e.phase*0.18)+i*Math.PI*2/(8+e.phase*2);
        ctx.fillStyle=i%3===0?'rgba(186,126,255,0.68)':rgba(spec.accent2,0.62);
        ctx.save(); ctx.translate(x+Math.cos(a)*TILE*3.2,y+Math.sin(a)*TILE*1.75); ctx.rotate(a);
        ctx.fillRect(-TILE*0.12,-TILE*0.32,TILE*0.24,TILE*0.64); ctx.restore();
      }
    }else{
      if(e.role==='mirror'){
        ctx.globalCompositeOperation='lighter';
        ctx.fillStyle='rgba(224,253,255,0.82)';
        ctx.beginPath(); ctx.ellipse(x,y,TILE*0.68,TILE*1.18,Math.sin(e.t)*0.12,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle='rgba(134,228,255,0.82)'; ctx.lineWidth=Math.max(1,TILE*0.09);
        for(let i=0;i<3;i++){ ctx.beginPath(); ctx.ellipse(x,y,TILE*(1.15+i*0.26),TILE*(0.52+i*0.12),e.t*(0.4+i*0.12),0,Math.PI*2); ctx.stroke(); }
        ctx.fillStyle='rgba(17,55,82,0.86)'; ctx.fillRect(x-TILE*0.25,y-TILE*0.12,TILE*0.5,TILE*0.24);
      }else{
        ctx.globalCompositeOperation='source-over';
        ctx.fillStyle='rgba(28,70,96,0.94)';
        ctx.beginPath(); ctx.moveTo(x,y-TILE*1.2); ctx.lineTo(x+TILE*1.25,y-TILE*0.35); ctx.lineTo(x+TILE*0.92,y+TILE*0.9); ctx.lineTo(x-TILE*0.92,y+TILE*0.9); ctx.lineTo(x-TILE*1.25,y-TILE*0.35); ctx.closePath(); ctx.fill();
        ctx.globalCompositeOperation='lighter';
        ctx.fillStyle=rgba(spec.accent,0.82);
        for(const s of [-1,1]){ ctx.beginPath(); ctx.moveTo(x+s*TILE*0.35,y-TILE*0.65); ctx.lineTo(x+s*TILE*1.55,y-TILE*1.15); ctx.lineTo(x+s*TILE*1.05,y+TILE*0.2); ctx.closePath(); ctx.fill(); }
        ctx.fillStyle='#ffffff'; ctx.fillRect(x-TILE*0.3,y-TILE*0.36,TILE*0.16,TILE*0.13); ctx.fillRect(x+TILE*0.14,y-TILE*0.36,TILE*0.16,TILE*0.13);
      }
    }
    if(e.hitFlash>0){ ctx.globalCompositeOperation='lighter'; ctx.fillStyle='rgba(255,255,255,'+clamp(e.hitFlash*3,0,1).toFixed(2)+')'; ctx.beginPath(); ctx.arc(x,y,(e.radius+1)*TILE,0,Math.PI*2); ctx.fill(); }
    ctx.restore();
  }
  function drawEntityHealth(ctx,TILE,e){
    if(!e.boss && e.hp/e.maxHp>0.98) return;
    const w=(e.boss?9:4.5)*TILE, h=e.boss?5:3;
    const x=e.x*TILE-w/2, y=(e.y-e.radius-1.4)*TILE;
    const spec=SPEC[e.kind];
    ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.fillRect(x,y,w,h);
    ctx.fillStyle=spec.accent; ctx.fillRect(x,y,w*clamp(e.hp/e.maxHp,0,1),h);
    if(isTrueSelf(e)){
      const fy=y+h+3, frost=clamp((e.frostMeter||0)/(e.frostNeed||72),0,1);
      ctx.fillStyle='rgba(7,17,25,0.72)'; ctx.fillRect(x,fy,w,3);
      ctx.fillStyle=e.torchLit?'rgba(151,230,255,0.92)':'rgba(232,252,255,0.98)'; ctx.fillRect(x,fy,w*(e.torchLit?frost:1),3);
      ctx.strokeStyle=e.torchLit?'rgba(199,245,255,0.72)':'rgba(255,210,102,0.82)'; ctx.lineWidth=1; ctx.strokeRect(x-1,fy-1,w+2,5);
    }
    if(isIceChoir(e)){
      const sy=y+h+3;
      const ratio=e.sealed?clamp((e.quietT||0)/(e.quietNeed||2.65),0,1):clamp((e.listeningT||0)/(e.listeningMax||7.2),0,1);
      ctx.fillStyle='rgba(5,18,31,0.78)'; ctx.fillRect(x,sy,w,4);
      ctx.fillStyle=e.sealed?'rgba(203,249,255,0.94)':'rgba(255,174,105,0.96)'; ctx.fillRect(x,sy,w*ratio,4);
      ctx.strokeStyle=e.sealed?'rgba(225,253,255,0.74)':'rgba(255,222,166,0.86)'; ctx.lineWidth=1; ctx.strokeRect(x-1,sy-1,w+2,6);
    }
    if(e.boss && sidekickCount(e.kind)>0){
      ctx.strokeStyle=rgba(spec.accent2,0.75); ctx.lineWidth=1; ctx.strokeRect(x-2,y-2,w+4,h+4);
    }
  }
  function drawEffects(ctx,TILE,canDrawTile,view){
    for(const e of effects){
      if(!tileVisible(canDrawTile,e.x,e.y,view,e.r||4)) continue;
      const spec=SPEC[e.kind] || SPEC.fire;
      const f=clamp(e.t/e.max,0,1);
      ctx.save();
      if(e.type==='cinderCrown'){
        ctx.globalCompositeOperation='source-over';
        for(let i=0;i<20;i++){
          const a=i*Math.PI/10+e.x*0.013;
          const rr=(e.r||20)*TILE*(0.92-f*0.58);
          ctx.fillStyle='rgba(14,11,14,'+(0.38*(1-f)).toFixed(3)+')';
          ctx.beginPath(); ctx.arc(e.x*TILE+Math.cos(a)*rr,e.y*TILE+Math.sin(a)*rr*0.48,TILE*(0.22+(i%4)*0.09),0,Math.PI*2); ctx.fill();
        }
      }
      if(e.type==='avatarReveal'){
        ctx.globalCompositeOperation='source-over';
        for(let i=0;i<26;i++){
          const a=i*2.399+e.x*0.017;
          const rr=(e.r||26)*TILE*(0.12+f*0.92)*(0.42+(i%7)*0.075);
          const px=e.x*TILE+Math.cos(a)*rr, py=e.y*TILE+Math.sin(a)*rr*0.62-f*TILE*(i%3);
          ctx.fillStyle=i%4===0?'rgba(255,92,20,'+(0.74*(1-f)).toFixed(3)+')':'rgba(18,12,15,'+(0.82*(1-f)).toFixed(3)+')';
          ctx.save(); ctx.translate(px,py); ctx.rotate(a+f*2.5);
          ctx.fillRect(-TILE*0.32,-TILE*0.12,TILE*0.64,TILE*0.24); ctx.restore();
        }
      }
      ctx.globalCompositeOperation='lighter';
      if(e.type==='sovereignShatter' || e.type==='rimeDeath'){
        const pieces=e.type==='sovereignShatter'?38:28;
        for(let i=0;i<pieces;i++){
          const a=i*2.399+e.x*0.013, rr=(e.r||28)*TILE*f*(0.16+(i%8)*0.075);
          const px=e.x*TILE+Math.cos(a)*rr, py=e.y*TILE+Math.sin(a)*rr*0.62;
          ctx.fillStyle=i%5===0?'rgba(202,137,255,'+(1-f).toFixed(3)+')':(i%2?'rgba(232,254,255,':'rgba(105,213,255,')+(0.9*(1-f)).toFixed(3)+')';
          ctx.save(); ctx.translate(px,py); ctx.rotate(a+f*3);
          ctx.beginPath(); ctx.moveTo(0,-TILE*0.42); ctx.lineTo(TILE*0.18,TILE*0.28); ctx.lineTo(-TILE*0.18,TILE*0.28); ctx.closePath(); ctx.fill(); ctx.restore();
        }
      }else if(e.type==='choirReveal'){
        for(let i=0;i<5;i++){
          const a=i*Math.PI*2/5+f*1.7, rr=(e.r||22)*TILE*(0.9-f*0.72);
          const px=e.x*TILE+Math.cos(a)*rr, py=e.y*TILE+Math.sin(a)*rr*0.55;
          ctx.fillStyle=i%2?'rgba(214,253,255,'+(1-f).toFixed(3)+')':'rgba(144,205,255,'+(1-f).toFixed(3)+')';
          ctx.save(); ctx.translate(px,py); ctx.rotate(a);
          ctx.fillRect(-TILE*0.25,-TILE*0.8,TILE*0.5,TILE*1.6); ctx.restore();
        }
      }else if(e.type==='choirListen' || e.type==='choirSeal' || e.type==='choirBlock' || e.type==='heartglassThaw'){
        const open=e.type==='choirListen', thaw=e.type==='heartglassThaw', block=e.type==='choirBlock';
        const R=(e.r||8)*TILE*(block?(0.7+f*0.35):(0.18+f*0.82));
        const rgb=thaw?'255,174,102':(open?'255,224,178':'215,252,255');
        ctx.strokeStyle='rgba('+rgb+','+((thaw?0.9:0.82)*(1-f)).toFixed(3)+')';
        ctx.lineWidth=Math.max(1,TILE*(block?0.15:0.1)*(1-f*0.45));
        const rings=block?2:5;
        for(let i=0;i<rings;i++){
          ctx.beginPath(); ctx.ellipse(e.x*TILE,e.y*TILE,R*(0.35+i/rings*0.65),R*(0.18+i/rings*0.36),i*0.4+f,0,Math.PI*2); ctx.stroke();
        }
      }else if(e.type==='choirRelease'){
        const rise=f*TILE*3.6;
        for(let i=0;i<5;i++){
          const a=i*Math.PI*2/5+f*2.2, rr=(e.r||25)*TILE*f*(0.32+(i%2)*0.11);
          ctx.fillStyle=i%2?'rgba(215,253,255,'+(1-f).toFixed(3)+')':'rgba(133,205,255,'+(1-f).toFixed(3)+')';
          ctx.save(); ctx.translate(e.x*TILE+Math.cos(a)*rr,e.y*TILE-rise+Math.sin(a)*rr*0.5); ctx.rotate(a+f*4);
          ctx.fillRect(-TILE*0.22,-TILE*0.7,TILE*0.44,TILE*1.4); ctx.restore();
        }
        ctx.fillStyle='rgba(255,190,120,'+(0.9*(1-f)).toFixed(3)+')';
        ctx.beginPath(); ctx.arc(e.x*TILE,e.y*TILE-rise,TILE*(0.55+f*0.42),0,Math.PI*2); ctx.fill();
      }else if(['rimeAwaken','auroraCrown','palaceFracture'].includes(e.type)){
        const R=(e.r||18)*TILE*(0.22+f*0.78);
        const grad=ctx.createRadialGradient(e.x*TILE,e.y*TILE,2,e.x*TILE,e.y*TILE,R);
        grad.addColorStop(0,'rgba(244,255,255,'+(0.72*(1-f)).toFixed(3)+')');
        grad.addColorStop(0.36,'rgba(114,226,255,'+(0.42*(1-f)).toFixed(3)+')');
        grad.addColorStop(0.7,'rgba(180,113,255,'+(0.19*(1-f)).toFixed(3)+')');
        grad.addColorStop(1,'rgba(80,160,255,0)');
        ctx.fillStyle=grad; ctx.beginPath(); ctx.arc(e.x*TILE,e.y*TILE,R,0,Math.PI*2); ctx.fill();
        const rays=e.type==='palaceFracture'?24:14;
        ctx.strokeStyle='rgba(226,253,255,'+(0.68*(1-f)).toFixed(3)+')'; ctx.lineWidth=Math.max(1,TILE*0.1*(1-f));
        for(let i=0;i<rays;i++){ const a=i*Math.PI*2/rays; ctx.beginPath(); ctx.moveTo(e.x*TILE+Math.cos(a)*R*0.2,e.y*TILE+Math.sin(a)*R*0.2); ctx.lineTo(e.x*TILE+Math.cos(a)*R*(0.65+(i%4)*0.08),e.y*TILE+Math.sin(a)*R*(0.65+(i%4)*0.08)); ctx.stroke(); }
      }else if(e.type==='mirrorDeath' || e.type==='sentinelDeath'){
        const sentinel=e.type==='sentinelDeath';
        const pieces=sentinel?18:12;
        for(let i=0;i<pieces;i++){
          const a=i*2.399, rr=(e.r||7)*TILE*f*(0.28+(i%5)*0.15);
          const px=e.x*TILE+Math.cos(a)*rr, py=e.y*TILE+Math.sin(a)*rr;
          ctx.fillStyle=i%3===0?'rgba(255,255,255,'+(1-f).toFixed(3)+')':rgba(i%2?spec.accent:spec.accent2,1-f);
          ctx.save(); ctx.translate(px,py); ctx.rotate(a+f*2); ctx.fillRect(-TILE*(sentinel?0.18:0.1),-TILE*0.28,TILE*(sentinel?0.36:0.2),TILE*0.56); ctx.restore();
        }
      }else if(e.type==='torchDouse'){
        const R=(e.r||8)*TILE*(0.2+f*0.82);
        const grad=ctx.createRadialGradient(e.x*TILE,e.y*TILE,2,e.x*TILE,e.y*TILE,R);
        grad.addColorStop(0,'rgba(238,253,255,'+(0.72*(1-f)).toFixed(3)+')');
        grad.addColorStop(0.42,'rgba(137,221,255,'+(0.38*(1-f)).toFixed(3)+')');
        grad.addColorStop(1,'rgba(126,214,255,0)');
        ctx.fillStyle=grad; ctx.beginPath(); ctx.arc(e.x*TILE,e.y*TILE,R,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle='rgba(226,251,255,'+(0.75*(1-f)).toFixed(3)+')';
        ctx.lineWidth=Math.max(1,TILE*0.08);
        for(let i=0;i<8;i++){
          const a=i*Math.PI/4+e.x*0.03, r0=R*0.28, r1=R*(0.62+(i%3)*0.12);
          ctx.beginPath(); ctx.moveTo(e.x*TILE+Math.cos(a)*r0,e.y*TILE+Math.sin(a)*r0); ctx.lineTo(e.x*TILE+Math.cos(a)*r1,e.y*TILE+Math.sin(a)*r1); ctx.stroke();
        }
      }else if(e.type==='torchRelight'){
        const R=(e.r||10)*TILE*(0.14+f*0.9);
        ctx.strokeStyle='rgba(255,226,108,'+(0.92*(1-f)).toFixed(3)+')'; ctx.lineWidth=Math.max(2,TILE*0.18*(1-f));
        for(let i=0;i<3;i++){ ctx.beginPath(); ctx.arc(e.x*TILE,e.y*TILE,R*(0.42+i*0.24),0,Math.PI*2); ctx.stroke(); }
        for(let i=0;i<14;i++){
          const a=i*Math.PI/7, rr=R*(0.3+f*(0.5+(i%3)*0.1));
          ctx.fillStyle=i%2?'rgba(255,72,16,'+(1-f).toFixed(3)+')':'rgba(255,235,133,'+(1-f).toFixed(3)+')';
          ctx.beginPath(); ctx.arc(e.x*TILE+Math.cos(a)*rr,e.y*TILE+Math.sin(a)*rr,TILE*0.12,0,Math.PI*2); ctx.fill();
        }
      }else if(e.type==='wardBlock'){
        ctx.strokeStyle='rgba(255,206,78,'+(0.85*(1-f)).toFixed(3)+')'; ctx.lineWidth=Math.max(1,TILE*0.13);
        ctx.beginPath(); ctx.arc(e.x*TILE,e.y*TILE,(e.r||3)*TILE*(0.6+f*0.45),-1.3,1.3); ctx.stroke();
      }else if(e.type==='humanRelease'){
        const rise=f*TILE*4.8;
        ctx.fillStyle='rgba(255,244,204,'+(0.62*(1-f)).toFixed(3)+')';
        ctx.beginPath(); ctx.ellipse(e.x*TILE,e.y*TILE-rise,TILE*(0.38+f*0.35),TILE*(1.15+f*0.8),0,0,Math.PI*2); ctx.fill();
        for(let i=0;i<20;i++){
          const a=i*2.399, rr=(e.r||22)*TILE*f*(0.15+(i%6)*0.08);
          ctx.fillStyle=i%3?'rgba(255,101,26,'+(1-f).toFixed(3)+')':'rgba(255,241,173,'+(1-f).toFixed(3)+')';
          ctx.beginPath(); ctx.arc(e.x*TILE+Math.cos(a)*rr,e.y*TILE-rise+Math.sin(a)*rr*0.52,TILE*(0.08+(i%3)*0.05),0,Math.PI*2); ctx.fill();
        }
      }else if(e.type==='burst'){
        const grad=ctx.createRadialGradient(e.x*TILE,e.y*TILE,2,e.x*TILE,e.y*TILE,(e.r||4)*TILE*(0.35+f*0.55));
        grad.addColorStop(0,rgba(spec.accent2||spec.accent,0.34*(1-f)));
        grad.addColorStop(1,rgba(spec.accent,0));
        ctx.fillStyle=grad;
        ctx.beginPath(); ctx.arc(e.x*TILE,e.y*TILE,(e.r||4)*TILE*(0.35+f*0.55),0,Math.PI*2); ctx.fill();
      }else if(['solarAwaken','solarPulse','solarDeath','victoryForge','cinderCrown'].includes(e.type)){
        const death=e.type==='solarDeath', victory=e.type==='victoryForge';
        const R=(e.r||18)*TILE*(death?(0.18+f*0.92):(0.28+f*0.62));
        const grad=ctx.createRadialGradient(e.x*TILE,e.y*TILE,2,e.x*TILE,e.y*TILE,R);
        grad.addColorStop(0,'rgba(255,255,226,'+(0.78*(1-f)).toFixed(3)+')');
        grad.addColorStop(0.18,'rgba(255,202,62,'+(0.52*(1-f)).toFixed(3)+')');
        grad.addColorStop(0.62,'rgba(255,67,18,'+(0.26*(1-f)).toFixed(3)+')');
        grad.addColorStop(1,'rgba(255,45,10,0)');
        ctx.fillStyle=grad; ctx.beginPath(); ctx.arc(e.x*TILE,e.y*TILE,R,0,Math.PI*2); ctx.fill();
        const rays=death?28:(victory?20:16);
        ctx.strokeStyle='rgba(255,226,127,'+((death?0.82:0.55)*(1-f)).toFixed(3)+')';
        ctx.lineWidth=Math.max(1,TILE*(death?0.22:0.13)*(1-f));
        for(let i=0;i<rays;i++){
          const a=i*Math.PI*2/rays+e.x*0.007;
          const r0=R*(0.18+(i%3)*0.04), r1=R*(0.72+(i%5)*0.06);
          ctx.beginPath();
          ctx.moveTo(e.x*TILE+Math.cos(a)*r0,e.y*TILE+Math.sin(a)*r0);
          ctx.lineTo(e.x*TILE+Math.cos(a)*r1,e.y*TILE+Math.sin(a)*r1);
          ctx.stroke();
        }
        if(victory){
          ctx.strokeStyle='rgba(255,255,220,'+(0.85*(1-f)).toFixed(3)+')';
          ctx.lineWidth=Math.max(1,TILE*0.18);
          for(let i=0;i<3;i++){
            ctx.beginPath(); ctx.arc(e.x*TILE,e.y*TILE,R*(0.22+i*0.18),0,Math.PI*2); ctx.stroke();
          }
        }
      }else if(e.type==='houndDeath' || e.type==='oracleDeath'){
        const hound=e.type==='houndDeath';
        const pieces=hound?11:14;
        for(let i=0;i<pieces;i++){
          const a=i*2.399+e.x*0.03;
          const rr=(e.r||6)*TILE*f*(0.35+(i%5)*0.13);
          const px=e.x*TILE+Math.cos(a)*rr, py=e.y*TILE+Math.sin(a)*rr-(!hound?f*TILE*1.2:0);
          ctx.fillStyle=i%3===0?'rgba(255,244,177,'+(1-f).toFixed(3)+')':rgba(i%2?spec.accent:spec.accent2,1-f);
          if(hound) ctx.fillRect(px-TILE*0.16,py-TILE*0.16,TILE*0.32,TILE*0.32);
          else { ctx.beginPath(); ctx.arc(px,py,TILE*(0.12+(i%3)*0.06),0,Math.PI*2); ctx.fill(); }
        }
      }
      ctx.strokeStyle=rgba(spec.accent,0.75*(1-f));
      ctx.lineWidth=Math.max(1,(1-f)*4);
      ctx.beginPath(); ctx.arc(e.x*TILE,e.y*TILE,(e.r||4)*TILE*(0.25+f),0,Math.PI*2); ctx.stroke();
      ctx.restore();
    }
  }
  function ghostEntries(){
    return ['fire','ice'].map(kind=>state.ghosts[kind]).filter(Boolean);
  }
  function hasGhosts(){
    return !!(state.ghosts.fire || state.ghosts.ice);
  }
  function drawRounded(ctx,x,y,w,h,r){
    ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(x,y,w,h,r);
    else {
      ctx.moveTo(x+r,y);
      ctx.lineTo(x+w-r,y);
      ctx.quadraticCurveTo(x+w,y,x+w,y+r);
      ctx.lineTo(x+w,y+h-r);
      ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
      ctx.lineTo(x+r,y+h);
      ctx.quadraticCurveTo(x,y+h,x,y+h-r);
      ctx.lineTo(x,y+r);
      ctx.quadraticCurveTo(x,y,x+r,y);
    }
  }
  function drawGhostBubble(ctx,x,y,text){
    if(!text) return;
    const words=String(text).split(/\s+/).filter(Boolean);
    const lines=[];
    let line='';
    ctx.save();
    ctx.font='12px system-ui';
    ctx.textBaseline='top';
    const maxW=238;
    for(const w of words){
      const next=line ? line+' '+w : w;
      const width=ctx.measureText ? ctx.measureText(next).width : next.length*7;
      if(line && width>maxW){ lines.push(line); line=w; }
      else line=next;
    }
    if(line) lines.push(line);
    const visible=lines.slice(0,5);
    const bw=Math.max(156,Math.min(270,visible.reduce((m,l)=>Math.max(m,ctx.measureText?ctx.measureText(l).width:80),0)+24));
    const bh=visible.length*15+16;
    const bx=x-bw*0.5, by=y-bh-24;
    ctx.shadowColor='rgba(0,0,0,0.28)';
    ctx.shadowBlur=6;
    ctx.fillStyle='rgba(238,248,255,0.93)';
    drawRounded(ctx,bx,by,bw,bh,10);
    ctx.fill();
    ctx.shadowBlur=0;
    ctx.strokeStyle='rgba(64,78,99,0.62)';
    ctx.lineWidth=1.1;
    drawRounded(ctx,bx,by,bw,bh,10);
    ctx.stroke();
    ctx.fillStyle='rgba(238,248,255,0.88)';
    ctx.beginPath(); ctx.arc(x-7,y-20,4,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(x-2,y-12,2.5,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillStyle='#142235';
    visible.forEach((l,i)=>ctx.fillText(l,bx+12,by+8+i*15));
    ctx.restore();
  }
  function drawGuardianGhosts(ctx,TILE,canDrawTile,view){
    const now=(typeof performance!=='undefined'?performance.now():0)*0.001;
    for(const g of ghostEntries()){
      if(!tileVisible(canDrawTile,g.x,g.y,view,12)) continue;
      const spec=SPEC[g.kind] || SPEC.ice;
      const bob=Math.sin((g.t||0)*2.2+g.x)*0.18;
      const x=g.x*TILE, y=(g.y-0.35+bob)*TILE;
      ctx.save();
      ctx.globalCompositeOperation='lighter';
      ctx.shadowColor=spec.accent2 || spec.accent;
      ctx.shadowBlur=18;
      const aura=ctx.createRadialGradient(x,y,2,x,y,TILE*4.2);
      aura.addColorStop(0,rgba(spec.accent2||spec.accent,0.26));
      aura.addColorStop(1,rgba(spec.accent,0));
      ctx.fillStyle=aura;
      ctx.beginPath(); ctx.arc(x,y,TILE*4.2,0,Math.PI*2); ctx.fill();
      ctx.globalAlpha=0.84;
      if(g.kind==='fire' && g.form==='human'){
        ctx.globalCompositeOperation='source-over';
        ctx.fillStyle='rgba(31,20,25,0.70)';
        ctx.beginPath(); ctx.moveTo(x-TILE*0.52,y-TILE*0.35); ctx.lineTo(x-TILE*0.62,y+TILE*1.1); ctx.lineTo(x+TILE*0.62,y+TILE*1.1); ctx.lineTo(x+TILE*0.52,y-TILE*0.35); ctx.closePath(); ctx.fill();
        ctx.globalCompositeOperation='lighter';
        ctx.fillStyle='rgba(255,222,170,0.78)';
        ctx.beginPath(); ctx.ellipse(x,y-TILE*1.0,TILE*0.31,TILE*0.39,0,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle='rgba(255,153,68,0.78)'; ctx.lineWidth=Math.max(1,TILE*0.11); ctx.lineCap='round';
        ctx.beginPath(); ctx.moveTo(x+TILE*0.27,y-TILE*0.25); ctx.lineTo(x+TILE*0.92,y-TILE*0.76); ctx.stroke();
        ctx.strokeStyle='rgba(81,47,31,0.86)'; ctx.lineWidth=Math.max(1,TILE*0.14);
        ctx.beginPath(); ctx.moveTo(x+TILE*0.9,y-TILE*0.42); ctx.lineTo(x+TILE*1.04,y-TILE*1.22); ctx.stroke();
        ctx.fillStyle='rgba(255,194,76,0.82)';
        ctx.beginPath(); ctx.moveTo(x+TILE*1.03,y-TILE*1.28); ctx.quadraticCurveTo(x+TILE*1.45,y-TILE*1.72,x+TILE*1.02,y-TILE*2.06); ctx.quadraticCurveTo(x+TILE*0.72,y-TILE*1.66,x+TILE*1.03,y-TILE*1.28); ctx.fill();
      }else if(g.kind==='ice' && g.form==='choir'){
        ctx.globalCompositeOperation='source-over';
        ctx.fillStyle='rgba(23,61,86,0.76)';
        ctx.beginPath(); ctx.moveTo(x,y-TILE*0.82); ctx.bezierCurveTo(x+TILE*0.62,y-TILE*0.22,x+TILE*0.38,y+TILE*0.74,x,y+TILE*0.92); ctx.bezierCurveTo(x-TILE*0.38,y+TILE*0.74,x-TILE*0.62,y-TILE*0.22,x,y-TILE*0.82); ctx.fill();
        ctx.globalCompositeOperation='lighter';
        for(let i=0;i<5;i++){
          const a=now*0.38+i*Math.PI*2/5, fx=x+Math.cos(a)*TILE*1.35, fy=y+Math.sin(a)*TILE*0.72;
          ctx.fillStyle=i%2?'rgba(220,254,255,0.72)':'rgba(138,207,255,0.72)';
          ctx.save(); ctx.translate(fx,fy); ctx.rotate(a); ctx.beginPath(); ctx.moveTo(0,-TILE*0.48); ctx.lineTo(TILE*0.24,0); ctx.lineTo(0,TILE*0.48); ctx.lineTo(-TILE*0.24,0); ctx.closePath(); ctx.fill(); ctx.restore();
        }
      }else{
        ctx.fillStyle=rgba(spec.accent2||spec.accent,0.78);
        ctx.beginPath();
        ctx.moveTo(x,y-TILE*1.35);
        ctx.lineTo(x+TILE*0.95,y-TILE*0.25);
        ctx.lineTo(x+TILE*0.55,y+TILE*1.05);
        ctx.lineTo(x,y+TILE*1.42);
        ctx.lineTo(x-TILE*0.55,y+TILE*1.05);
        ctx.lineTo(x-TILE*0.95,y-TILE*0.25);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle='rgba(255,255,255,0.72)';
        ctx.lineWidth=1.4;
        ctx.stroke();
        ctx.fillStyle='rgba(255,255,255,0.82)';
        ctx.fillRect(x-TILE*0.35,y-TILE*0.2,TILE*0.18,TILE*0.18);
        ctx.fillRect(x+TILE*0.17,y-TILE*0.2,TILE*0.18,TILE*0.18);
      }
      for(let i=0;i<5;i++){
        const a=now*1.7+i*1.26+g.x*0.03;
        ctx.fillStyle=rgba(i%2?spec.accent:spec.accent2,0.42);
        ctx.fillRect(x+Math.cos(a)*TILE*1.8-1.5,y+Math.sin(a*1.2)*TILE*1.1-1.5,3,3);
      }
      ctx.restore();
      if((g.talkT||0)>0) drawGhostBubble(ctx,x,y-TILE*2.0,ghostCurrentSpeech(g));
    }
  }
  function draw(ctx,TILE,canDrawTile,camX,camY,W,H,zoom){
    const view=makeDrawView(camX,camY,W,H,TILE,zoom);
    drawLairGlows(ctx,TILE,canDrawTile,view);
    drawUndergroundGateGlow(ctx,TILE,canDrawTile,view);
    if(!entities.length && !hazards.length && !effects.length && !hasGhosts()) return;
    const now=(typeof performance!=='undefined') ? performance.now() : 0;
    drawHazards(ctx,TILE,canDrawTile,view);
    for(const e of entities){
      if(!tileVisible(canDrawTile,e.x,e.y,view,(e.radius||1)+5)) continue;
      if(e.kind==='fire') drawFireEntity(ctx,TILE,e,now);
      else drawIceEntity(ctx,TILE,e,now);
      drawEntityHealth(ctx,TILE,e);
    }
    drawEffects(ctx,TILE,canDrawTile,view);
    drawGuardianGhosts(ctx,TILE,canDrawTile,view);
  }
  function drawHUD(ctx,W,H,camX,camY,zoom,TILE,canDrawTile){
    const p=playerRef(); if(!p) return;
    let best=null, bd=Infinity;
    for(const e of entities){
      if(e.dead || !e.boss || !tileVisible(canDrawTile,e.x,e.y)) continue;
      const d=Math.abs(e.x-p.x)+Math.abs(e.y-p.y)*0.25;
      if(d<bd){ bd=d; best=e; }
    }
    if(!best) return;
    const sx=(best.x-camX)*TILE*zoom, sy=(best.y-camY)*TILE*zoom;
    if(sx>36 && sx<W-36 && sy>36 && sy<H-36) return;
    const ang=Math.atan2(sy-H/2,sx-W/2);
    const ex=W/2+Math.cos(ang)*(Math.min(W,H)/2-44), ey=H/2+Math.sin(ang)*(Math.min(W,H)/2-44);
    const spec=SPEC[best.kind];
    ctx.save(); ctx.translate(ex,ey); ctx.rotate(ang);
    ctx.fillStyle=rgba(spec.accent,0.9);
    ctx.beginPath(); ctx.moveTo(14,0); ctx.lineTo(-8,-8); ctx.lineTo(-8,8); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // --- ghost mirror: the boss fight, seen from the cheap seats -----------------
  // The save snapshot deliberately drops live entities (restore() clears the
  // arena), so a spectator joining mid-fight saw the hero battling an EMPTY
  // lair. Same contract as the invasion/weapon planes: the HOST streams a
  // compact cosmetic mirror, the watcher rebuilds inert puppets — no AI, no
  // damage, no tile writes — and only glides/ages them between packets.
  const GHOST_HAZ_TYPES=['projectile','skyLightning','stormMeteor','impact','beam','torchJet','ring','blizzard'];
  function ghostMirrorState(){
    if(!entities.length && !hazards.length && !effects.length) return null;
    const round2=v=>+(Number(v)||0).toFixed(2);
    return {
      ents: entities.filter(e=>e && !e.dead).slice(0,10).map(e=>({
        id:Number(e.id)||0, k:e.kind, r:e.role, x:round2(e.x), y:round2(e.y),
        hp:round2(e.hp), mhp:Math.max(1,Number(e.maxHp)||1),
        hf:e.hitFlash>0?round2(e.hitFlash):0, ph:Number.isFinite(e.phase)?round2(e.phase):0,
        tl:e.torchLit===false?0:1, fm:round2(e.frostMeter), vt:round2(e.vulnerableT),
        sl:e.sealed===false?0:1, qt:round2(e.quietT), qn:round2(e.quietNeed), lt:round2(e.listeningT)
      })),
      haz: hazards.slice(0,48).map(h=>({
        t:h.type, k:h.kind, x:round2(h.x), y:round2(h.y),
        x1:round2(h.x1), y1:round2(h.y1), x2:round2(h.x2), y2:round2(h.y2),
        vx:round2(h.vx), vy:round2(h.vy),
        r:round2(h.r), r0:round2(h.r0), r1:round2(h.r1),
        tt:round2(h.t), d:round2(h.delay), l:round2(h.life),
        v:typeof h.variant==='string'?h.variant.slice(0,16):'',
        br:Array.isArray(h.branches)?h.branches.slice(0,6).map(b=>[round2(b.x1),round2(b.y1),round2(b.x2),round2(b.y2)]):0,
        tr:Array.isArray(h.trail)?h.trail.slice(-6).map(p=>[round2(p.x),round2(p.y)]):0
      })),
      fx: effects.slice(0,16).map(f=>({t:String(f.type||'burst'), k:f.kind, x:round2(f.x), y:round2(f.y), tt:round2(f.t), m:round2(f.max), r:round2(f.r)}))
    };
  }
  // Watcher-side rebuild. The payload comes from the network, so every number is
  // sanitized and every list bounded — a hostile host may not stall the tab or
  // smuggle absurd geometry. Entities keep identity across packets (glide, not
  // teleport); hazards and effects are replaced wholesale and animated locally.
  function ghostApplyMirror(data){
    if(!data || typeof data!=='object'){
      entities=[]; hazards.length=0; effects.length=0;
      return true;
    }
    const fin=(v,d)=>{ const n=Number(v); return Number.isFinite(n)?n:d; };
    const nextEnts=[];
    for(const w of (Array.isArray(data.ents)?data.ents.slice(0,10):[])){
      if(!w || !SPEC[w.k]) continue;
      const x=fin(w.x,NaN), y=fin(w.y,NaN);
      if(!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x)>1e6 || Math.abs(y)>1e6) continue;
      const wid=fin(w.id,0);
      let e=entities.find(v=>v && v.id===wid && v.kind===w.k);
      if(!e){
        e=makeEntity(w.k, w.r==='boss'?'boss':String(w.r||'').slice(0,24), x, y, {seed:1});
        e.id=wid;
      }
      e._gTX=x; e._gTY=y;
      if(!Number.isFinite(e.x) || Math.abs(e.x-x)>8 || Math.abs(e.y-y)>8){ e.x=x; e.y=y; }
      e.maxHp=Math.max(1, fin(w.mhp, e.maxHp));
      e.hp=Math.max(0, Math.min(e.maxHp, fin(w.hp, e.hp)));
      e.hitFlash=Math.max(0, Math.min(1, fin(w.hf,0)));
      e.phase=fin(w.ph,0);
      if(isTrueSelf(e)){
        e.torchLit=fin(w.tl,1)!==0;
        e.frostMeter=Math.max(0,Math.min(e.frostNeed||72,fin(w.fm,0)));
        e.vulnerableT=Math.max(0,Math.min(10,fin(w.vt,0)));
      }
      if(isIceChoir(e)){
        e.sealed=fin(w.sl,1)!==0;
        e.quietNeed=Math.max(1,Math.min(8,fin(w.qn,e.quietNeed||2.65)));
        e.quietT=Math.max(0,Math.min(e.quietNeed,fin(w.qt,0)));
        e.listeningT=Math.max(0,Math.min(12,fin(w.lt,0)));
      }
      e.dead=false;
      nextEnts.push(e);
    }
    entities=nextEnts;
    hazards.length=0;
    for(const w of (Array.isArray(data.haz)?data.haz.slice(0,48):[])){
      if(!w || !GHOST_HAZ_TYPES.includes(w.t) || !SPEC[w.k]) continue;
      const x=fin(w.x,0), y=fin(w.y,0);
      hazards.push({
        type:w.t, kind:w.k, x, y,
        x1:fin(w.x1,x), y1:fin(w.y1,y), x2:fin(w.x2,x), y2:fin(w.y2,y),
        vx:Math.max(-60,Math.min(60,fin(w.vx,0))), vy:Math.max(-60,Math.min(60,fin(w.vy,0))),
        r:Math.max(0.05,Math.min(40,fin(w.r,0.5))), r0:Math.max(0,Math.min(40,fin(w.r0,0))), r1:Math.max(0,Math.min(60,fin(w.r1,0))),
        t:Math.max(0,Math.min(60,fin(w.tt,0))), delay:Math.max(0,Math.min(30,fin(w.d,0))), life:Math.max(0.01,Math.min(30,fin(w.l,1))),
        variant:typeof w.v==='string'?w.v.slice(0,16):'',
        branches:Array.isArray(w.br)?w.br.slice(0,6).map(b=>({x1:fin(b&&b[0],x),y1:fin(b&&b[1],y),x2:fin(b&&b[2],x),y2:fin(b&&b[3],y)})):null,
        trail:Array.isArray(w.tr)?w.tr.slice(0,6).map(p=>({x:fin(p&&p[0],x),y:fin(p&&p[1],y)})):null,
        dmg:0, source:0 // a puppet hazard hurts nobody — the watcher never runs update()
      });
    }
    effects.length=0;
    for(const w of (Array.isArray(data.fx)?data.fx.slice(0,16):[])){
      if(!w || !SPEC[w.k]) continue;
      effects.push({type:String(w.t||'burst').slice(0,16), kind:w.k, x:fin(w.x,0), y:fin(w.y,0),
        t:Math.max(0,Math.min(30,fin(w.tt,0))), max:Math.max(0.05,Math.min(10,fin(w.m,1))), r:Math.max(0.2,Math.min(30,fin(w.r,3)))});
    }
    return true;
  }
  // Cosmetic glide + local clocks between packets — never physics, never AI,
  // never a tile write. Positions are re-based by every mirror tick, so the
  // local coasting of projectiles/meteors cannot accumulate drift.
  function ghostLerp(dt){
    const d=Math.min(0.25, Math.max(0, Number(dt)||0));
    if(!d) return;
    const k=Math.min(1, d*9);
    for(const e of entities){
      if(!e) continue;
      e.t+=d; // the wobble/orbit animations run off the entity clock
      if(e.hitFlash>0) e.hitFlash=Math.max(0, e.hitFlash-d*2);
      if(Number.isFinite(e._gTX)){ e.x+=(e._gTX-e.x)*k; e.y+=(e._gTY-e.y)*k; }
    }
    for(const h of hazards){
      h.t+=d;
      if(h.type==='projectile' || h.type==='stormMeteor'){ h.x+=h.vx*d; h.y+=h.vy*d; }
    }
    for(let i=effects.length-1;i>=0;i--){
      const f=effects[i];
      f.t+=d;
      if(f.t>=f.max) effects.splice(i,1);
    }
  }

  function resetUnderground(){
    state.underground.enabled=false;
    state.underground.x=null;
    state.underground.y=null;
    state.underground.seed=0;
    state.underground.materialized=false;
  }
  function cleanGhostSnapshot(kind){
    const g=state.ghosts[kind];
    if(!g) return null;
    return {
      kind,
      x:+finite(g.x,layoutFor(kind).ax).toFixed(2),
      y:+finite(g.y,layoutFor(kind).floorY-4).toFixed(2),
      talkT:+Math.max(0,Number(g.talkT)||0).toFixed(2),
      rewarded:!!g.rewarded,
      rewardId:typeof g.rewardId==='string' ? g.rewardId.slice(0,64) : null,
      seen:!!g.seen,
      form:g.form==='human'?'human':(g.form==='choir'?'choir':'guardian'),
      lineIndex:Math.max(0,Math.min(32,Number(g.lineIndex)||0)),
      lineT:+Math.max(0,Number(g.lineT)||0).toFixed(2)
    };
  }
  function restoreGhost(kind,src){
    if(!src || typeof src!=='object'){ state.ghosts[kind]=null; return; }
    const L=layoutFor(kind);
    state.ghosts[kind]={
      kind,
      x:clamp(Number(src.x)||L.ax,L.ax-54,L.ax+54),
      y:clamp(Number(src.y)||L.floorY-4,2,WORLD_H-5),
      t:0,
      talkT:clamp(Number(src.talkT)||0,0,18),
      rewarded:!!src.rewarded,
      rewardId:typeof src.rewardId==='string' ? src.rewardId.slice(0,64) : null,
      seen:!!src.seen,
      form:kind==='fire'?'human':(kind==='ice' && (src.form==='choir' || state.avatarBroken.ice)?'choir':'guardian'),
      lineIndex:Math.max(0,Math.min(32,Number(src.lineIndex)||0)),
      lineT:clamp(Number(src.lineT)||0,0,60)
    };
  }
  function cleanUndergroundSnapshot(){
    return {
      enabled:!!state.underground.enabled,
      x:Number.isFinite(state.underground.x) ? Math.round(state.underground.x) : null,
      y:Number.isFinite(state.underground.y) ? Math.round(state.underground.y) : null,
      seed:Number(state.underground.seed)||0,
      materialized:!!state.underground.materialized
    };
  }
  function restoreUnderground(src){
    resetUnderground();
    if(!src || typeof src!=='object') return;
    if(!src.enabled) return;
    const a=undergroundAnchor();
    state.underground.enabled=true;
    state.underground.x=Number.isFinite(src.x) ? clamp(Math.round(src.x),-220,220) : a.x;
    state.underground.y=Number.isFinite(src.y) ? clamp(Math.round(src.y),86,WORLD_H-14) : a.y;
    state.underground.seed=Number(src.seed)||a.seed;
    state.underground.materialized=!!src.materialized;
  }
  function ghostStatus(kind){
    const g=state.ghosts[kind];
    if(!g) return null;
    return {
      kind,
      x:g.x,
      y:g.y,
      rewarded:!!g.rewarded,
      rewardId:g.rewardId||null,
      form:g.form||'guardian',
      name:SPEC[kind].trueName || SPEC[kind].bossName,
      text:ghostCurrentSpeech(g)
    };
  }
  function undergroundStatus(){
    const U=(state.underground && state.underground.enabled) ? undergroundGateLayout() : null;
    return {
      enabled:!!(state.underground && state.underground.enabled),
      x:U ? U.x : state.underground.x,
      y:U ? U.y : state.underground.y,
      mouthX:U ? U.mouthX : null,
      mouthY:U ? U.mouthY : null,
      materialized:!!(state.underground && state.underground.materialized)
    };
  }
  function reset(){
    entities=[]; hazards.length=0; effects.length=0;
    state.defeated.fire=false; state.defeated.ice=false;
    state.avatarBroken.fire=false; state.avatarBroken.ice=false;
    state.awakened.fire=false; state.awakened.ice=false;
    state.ambientCd.fire=28; state.ambientCd.ice=34;
    state.ghosts.fire=null; state.ghosts.ice=null;
    resetUnderground();
    resetStorm('fire'); resetStorm('ice');
    resetWeather('fire'); resetWeather('ice');
  }
  function clearActive(){ entities=[]; hazards.length=0; effects.length=0; state.awakened.fire=false; state.awakened.ice=false; resetStorm('fire'); resetStorm('ice'); resetWeather('fire'); resetWeather('ice'); }
  function snapshot(){
    return {
      v:4,
      defeated:{fire:!!state.defeated.fire, ice:!!state.defeated.ice},
      avatarBroken:{fire:!!state.avatarBroken.fire, ice:!!state.avatarBroken.ice},
      awakened:{fire:!!state.awakened.fire, ice:!!state.awakened.ice},
      ambientCd:{fire:+state.ambientCd.fire.toFixed(2), ice:+state.ambientCd.ice.toFixed(2)},
      ghosts:{fire:cleanGhostSnapshot('fire'), ice:cleanGhostSnapshot('ice')},
      underground:cleanUndergroundSnapshot()
    };
  }
  function restore(d){
    clearActive();
    state.defeated.fire=false; state.defeated.ice=false;
    state.avatarBroken.fire=false; state.avatarBroken.ice=false;
    state.ambientCd.fire=28; state.ambientCd.ice=34;
    state.ghosts.fire=null; state.ghosts.ice=null;
    resetUnderground();
    if(!d || typeof d!=='object') return false;
    state.defeated.fire=!!(d.defeated && d.defeated.fire);
    state.defeated.ice=!!(d.defeated && d.defeated.ice);
    state.avatarBroken.fire=!!(d.avatarBroken && d.avatarBroken.fire) || state.defeated.fire;
    state.avatarBroken.ice=!!(d.avatarBroken && d.avatarBroken.ice) || state.defeated.ice;
    state.awakened.fire=!!(d.awakened && d.awakened.fire);
    state.awakened.ice=!!(d.awakened && d.awakened.ice);
    if(d.ambientCd){
      state.ambientCd.fire=clamp(Number(d.ambientCd.fire)||28,1,300);
      state.ambientCd.ice=clamp(Number(d.ambientCd.ice)||34,1,300);
    }
    // Progress restores later than guardians in main.js. Reading the live
    // progress singleton here would leak the previously loaded save's hearts
    // into this snapshot. The next update reconciles freshly restored progress.
    if(state.defeated.fire){ state.avatarBroken.fire=true; state.awakened.fire=false; }
    if(state.defeated.ice){ state.avatarBroken.ice=true; state.awakened.ice=false; }
    if(d.ghosts){
      restoreGhost('fire',d.ghosts.fire);
      restoreGhost('ice',d.ghosts.ice);
    }
    restoreUnderground(d.underground);
    return true;
  }
  function markDefeated(kind){
    if(!SPEC[kind]) return false;
    state.defeated[kind]=true;
    state.avatarBroken[kind]=true;
    state.awakened[kind]=false;
    resetStorm(kind);
    resetWeather(kind);
    maybeEnableUndergroundGate();
    return true;
  }
  function forceAwaken(kind){
    return awaken(kind,{debug:true,force:true,restartArc:true});
  }
  function status(){
    const fb=activeBoss('fire'), ib=activeBoss('ice');
    const fw=isWyrmBoss(fb) ? fb : null;
    return {
      defeated:{fire:isDefeated('fire'), ice:isDefeated('ice')},
      stages:{fire:isDefeated('fire')?'complete':(state.avatarBroken.fire?'human':'ignivar'),ice:isDefeated('ice')?'complete':(state.avatarBroken.ice?'choir':'aurex')},
      lairs:{fire:layoutFor('fire'), ice:layoutFor('ice')},
      entities:entities.filter(e=>!e.dead).map(e=>({id:e.id,kind:e.kind,role:e.role,name:e.name,hp:e.hp,maxHp:e.maxHp,x:e.x,y:e.y,boss:e.boss,torchLit:e.torchLit,frostMeter:e.frostMeter,vulnerableT:e.vulnerableT,sealed:e.sealed,quietT:e.quietT,quietNeed:e.quietNeed,listeningT:e.listeningT})),
      ghosts:{fire:ghostStatus('fire'), ice:ghostStatus('ice')},
      underground:undergroundStatus(),
      hazards:hazards.length,
      storm:{fire:!!(fw && fw.hp/fw.maxHp<0.5), ice:!!(isRimeBoss(ib) && ib.hp/ib.maxHp<0.5)},
      lightning:{fire:!!(fw && fw.hp/fw.maxHp<CFG.LIGHTNING_THRESHOLD), ice:!!(isRimeBoss(ib) && ib.hp/ib.maxHp<CFG.LIGHTNING_THRESHOLD)}
    };
  }
  function metrics(){
    const fireActive=activeBoss('fire'), fb=isWyrmBoss(fireActive)?fireActive:null, iceActive=activeBoss('ice'), ib=isRimeBoss(iceActive)?iceActive:null;
    let bosses=0, sidekicks=0, stormMeteors=0, lightningBolts=0;
    let alive=0;
    for(const e of entities){
      if(!e || e.dead) continue;
      alive++;
      if(e.boss) bosses++; else sidekicks++;
    }
    for(const h of hazards){
      if(h.type==='stormMeteor') stormMeteors++;
      else if(h.type==='skyLightning') lightningBolts++;
    }
    return {
      alive, bosses, sidekicks,
      hazards:hazards.length, stormMeteors, lightningBolts,
      storm:{fire:!!(fb && fb.hp/fb.maxHp<0.5), ice:!!(ib && ib.hp/ib.maxHp<0.5)},
      stormNextIn:{
        fire:state.stormCd.fire==null ? null : +Math.max(0,state.stormCd.fire).toFixed(1),
        ice:state.stormCd.ice==null ? null : +Math.max(0,state.stormCd.ice).toFixed(1)
      },
      lightning:{fire:!!(fb && fb.hp/fb.maxHp<CFG.LIGHTNING_THRESHOLD), ice:!!(ib && ib.hp/ib.maxHp<CFG.LIGHTNING_THRESHOLD)},
      lightningRate:{fire:+(state.lightningRate.fire||0).toFixed(1), ice:+(state.lightningRate.ice||0).toFixed(1)},
      defeated:{fire:isDefeated('fire'),ice:isDefeated('ice')},
      ghosts:ghostEntries().length,
      underground:undergroundStatus()
    };
  }
  function _debug(){ return {state, entities, hazards, effects, undergroundGateLayout, materializeUndergroundGate, makeGhostRewardItem, ghostSpeech}; }

  const api={config:CFG, specs:SPEC, anchorFor, layoutFor, undergroundGateLayout, anchorsInRange, nearest, applyToChunk,
    update, draw, drawHUD, attackAt, damageAt, collideHero, spawnGuardian, forceAwaken, markDefeated,
    enableUndergroundGate,
    ghostMirrorState, ghostApplyMirror, ghostLerp,
    targetsForTurret, nearestForTurret, reset, clearActive, snapshot, restore, status, metrics,
    clearCache:()=>cache.clear(), _debug};
  MM.guardianLairs=api;
  MM.guardians=api;
  // weakened-matrix registry: weapons splash statuses into guardians through
  // MM.bossStatus.applyRadius (shared with every other boss family)
  try{
    if(MM.bossStatus && MM.bossStatus.registerSystem){
      MM.bossStatus.registerSystem('guardianLairs',{
        applyRadius(wx,wy,r,kind,opts){
          let n=0;
          for(const e of entities){
            if(!e || e.dead) continue;
            const rr=r+(e.radius||1);
            const dx=e.x-wx, dy=e.y-wy;
            if(dx*dx+dy*dy>rr*rr) continue;
            if(applyBossStatus(bossStatusFor(e),kind,opts)) n++;
          }
          return n;
        }
      });
    }
  }catch(e){}
  return api;
})();

export { guardianLairs };
export default guardianLairs;
