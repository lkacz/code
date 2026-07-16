// World storage & chunk generation
import { CHUNK_W, WORLD_H, WORLD_SECTION_H, WORLD_MIN_SECTION, WORLD_MAX_SECTION, WORLD_MIN_Y, WORLD_MAX_Y, T, INFO, SNOW_LINE, SURFACE_GRASS_DEPTH, SAND_DEPTH } from '../constants.js';
import {
  generatedCityStructuralTile,
  generatedCitySupportTile,
  isDoorTile,
  isGeneratedStructureReplaceableTile,
  isLavaExposureOpenTile,
  isPlayerBuiltMaterial,
  isReplaceableNaturalOpenTile,
  isTrapdoorTile
} from './material_physics.js';
import { worldGen as WORLDGEN } from './worldgen.js';
import { worldLayers as WORLD_LAYERS } from './world_layers.js';
import { ruins as RUINS } from './ruins.js';
import { alienRuins as ALIEN_RUINS } from './alien_ruins.js';
import { guardianLairs as GUARDIANS } from './guardian_lairs.js';
import { undergroundBoss as UNDERGROUND } from './underground_boss.js';
import { skyGuardian as SKY_GUARDIAN } from './sky_guardian.js';
import { guardianAftermath as AFTERMATH } from './guardian_aftermath.js';
import { centerGuardian as CENTER_GUARDIAN } from './center_guardian.js';
window.MM = window.MM || {};
(function(){
  const WG = WORLDGEN;
  const worldAPI = {};
  const world = new Map();
  const versions = new Map(); // chunk key -> version number for render cache invalidation
  const modifiedChunks = new Set();
  const infrastructure = new Map(); // "x,y" -> overlay tile stack (wire / copper cable / water pipe / ladders)
  const constructionBackground = new Map(); // "x,y" -> passable building support/decor tile
  const isChestTile=t=>t===T.CHEST_COMMON||t===T.CHEST_UNCOMMON||t===T.CHEST_RARE||t===T.CHEST_EPIC||t===T.CHEST_LEGENDARY;
  const chestTierForTile=t=>t===T.CHEST_LEGENDARY?'legendary':t===T.CHEST_EPIC?'epic':t===T.CHEST_RARE?'rare':t===T.CHEST_UNCOMMON?'uncommon':'common';
  function stripChestTiles(arr){
    if(!arr || typeof arr.length!=='number') return arr;
    for(let i=0;i<arr.length;i++) if(isChestTile(arr[i])) arr[i]=T.AIR;
    return arr;
  }
  // Generated interior backdrops (city building rooms, tunnels...) live in their
  // own per-chunk layer: derived deterministically with the chunk, never saved
  // (save-loaded chunks replay the pass), shown behind foreground air like
  // player background builds. Player edits shadow it via constructionBackground,
  // where an explicit T.AIR entry is a tombstone for a mined-out backdrop cell.
  const generatedBackground = new Map(); // chunk key -> Uint8Array(CHUNK_W*WORLD_H)
  // Cache of surface heights per world column to avoid recomputing noise repeatedly
  const heightCache = new Map();
  // Cache of perched-lake water rows, computed per contiguous lake segment
  const lakeLevels = new Map();
  // Hardening: every Map here grows with the span of coordinates ever touched, and a
  // single runaway caller (or NaN coordinate) used to inflate them until V8 threw
  // "Map maximum size exceeded". Pure caches reset when oversized; chunk storage
  // evicts far-away UNMODIFIED chunks (they regenerate deterministically — edited
  // chunks are exactly what the save system keeps, so they are never dropped).
  const MAX_COORD = 30e6;        // |x| beyond this is treated as void (no storage)
  const CHUNK_CAP = 1536;        // ~98k columns of live chunks before eviction
  const HEIGHT_CACHE_CAP = 200000;
  const INFRASTRUCTURE_SAVE_CAP = 20000;
  const CONSTRUCTION_BACKGROUND_SAVE_CAP = 40000;
  const SECTION_SIZE = CHUNK_W * WORLD_SECTION_H;
  const BASE_SECTION_MIN = 0;
  const BASE_SECTION_MAX = Math.max(0, Math.ceil(WORLD_H / WORLD_SECTION_H) - 1);
  function colHeight(x){ let v=heightCache.get(x); if(v===undefined){ if(heightCache.size>HEIGHT_CACHE_CAP) heightCache.clear(); v=WG.surfaceHeight(x); heightCache.set(x,v); } return v; }
  function worldYInBounds(y){ return y>=WORLD_MIN_Y && y<WORLD_MAX_Y; }
  function sectionYFor(y){ return Math.floor(Math.floor(y) / WORLD_SECTION_H); }
  function sectionOriginY(sy){ return sy * WORLD_SECTION_H; }
  function sectionLocalY(y,sy){ return Math.floor(y) - sectionOriginY(sy); }
  function isBaseSection(sy){ return sy>=BASE_SECTION_MIN && sy<=BASE_SECTION_MAX; }
  function ckSection(cx,sy){ return isBaseSection(sy) ? ck(cx) : ('c'+cx+':s'+sy); }
  function parseChunkKey(k){
    if(typeof k!=='string' || k[0]!=='c') return null;
    const rest=k.slice(1);
    const sAt=rest.indexOf(':s');
    if(sAt<0){
      const cx=Number(rest);
      return Number.isFinite(cx) ? {cx, sy:null, base:true, key:k} : null;
    }
    const cx=Number(rest.slice(0,sAt));
    const sy=Number(rest.slice(sAt+2));
    return Number.isFinite(cx) && Number.isFinite(sy) ? {cx, sy, base:false, key:k} : null;
  }
  function normalizeChunkRef(ref){
    if(typeof ref==='number' && Number.isFinite(ref)) return {cx:ref, sy:null, base:true, key:ck(ref), h:WORLD_H};
    if(ref && typeof ref==='object' && Number.isFinite(ref.cx)){
      const sy=Number.isFinite(ref.sy) ? Math.floor(ref.sy) : null;
      return {cx:Math.floor(ref.cx), sy, base:sy==null || isBaseSection(sy), key:sy==null || isBaseSection(sy) ? ck(Math.floor(ref.cx)) : ckSection(Math.floor(ref.cx),sy), h:sy==null || isBaseSection(sy) ? WORLD_H : WORLD_SECTION_H};
    }
    if(typeof ref==='string'){
      const parsed=parseChunkKey(ref);
      if(parsed) return {cx:parsed.cx, sy:parsed.sy, base:parsed.base, key:parsed.key, h:parsed.base ? WORLD_H : WORLD_SECTION_H};
    }
    return null;
  }
  function evictFarChunks(){
    const p=(typeof window!=='undefined' && window.player) || null;
    const pcx=(p && isFinite(p.x))? Math.floor(p.x/CHUNK_W) : 0;
    const cand=[];
    for(const k of world.keys()){
      if(versions.get(k)) continue;               // modified chunk: player edits live here
      const parsed=parseChunkKey(k);
      if(!parsed) continue;
      cand.push([Math.abs(parsed.cx-pcx) + Math.abs((parsed.sy==null?0:parsed.sy) - sectionYFor(p && isFinite(p.y) ? p.y : 0))*0.35, k]);
    }
    cand.sort((a,b)=>b[0]-a[0]);                  // farthest first
    const drop=Math.min(cand.length, world.size-((CHUNK_CAP*0.75)|0));
    for(let i=0;i<drop;i++){
      const parsed=parseChunkKey(cand[i][1]);
      try{ if(parsed && parsed.base && MM.trees && MM.trees.clearChunk) MM.trees.clearChunk(parsed.cx); }catch(e){}
      world.delete(cand[i][1]); versions.delete(cand[i][1]);
    }
    sectionViews.clear(); // cached views may alias deleted chunk arrays
  }
  function ck(x){ return 'c'+x; }
  function key(x,y){ return Math.floor(x)+','+Math.floor(y); }
  function tileIndex(x,y){ return y*CHUNK_W+x; }
  function getTileRaw(arr,lx,y){ return arr[tileIndex(lx,y)]; }
  function isLadderInfrastructureTile(t){ return t===T.LADDER || t===T.BEDROCK_LADDER; }
  function isInfrastructureTile(t){ return t===T.WIRE || t===T.COPPER_WIRE || t===T.SILVER_WIRE || t===T.WATER_PIPE || isLadderInfrastructureTile(t); }
  function isConstructionBackgroundTile(t){ return isPlayerBuiltMaterial(t) && !isDoorTile(t) && !isTrapdoorTile(t); }
  function markModifiedChunk(cx,version,sy){
    if(!isFinite(cx)) return;
    const keyRef=normalizeChunkRef({cx, sy:Number.isFinite(sy) ? sy : null});
    if(!keyRef) return;
    const k=keyRef.key;
    const next=(version==null) ? ((versions.get(k)||0)+1) : version;
    versions.set(k,next);
    const id=keyRef.base ? Math.floor(cx) : k;
    if(next!==0) modifiedChunks.add(id);
    else modifiedChunks.delete(id);
  }

  // Perched lakes sit in carved valley basins above sea level. The whole contiguous
  // biome-6 segment shares one water row: one tile below its lower confining shoulder,
  // capped so the lake never exceeds lakeMaxDepth below its deepest floor.
  function lakeLevelFor(x){
    const hit=lakeLevels.get(x); if(hit!==undefined) return hit;
    if(lakeLevels.size>60000) lakeLevels.clear();   // pure cache: safe to rebuild
    const CAP=110;
    let L=x, R=x;
    while(x-L<CAP && WG.biomeType(L-1)===6) L--;
    while(R-x<CAP && WG.biomeType(R+1)===6) R++;
    const rimL=colHeight(L-1), rimR=colHeight(R+1);
    let deepest=0;
    for(let i=L;i<=R;i++){ const sr=colHeight(i); if(sr>deepest) deepest=sr; }
    const maxDepth=(WG.settings && WG.settings.lakeMaxDepth!==undefined)? WG.settings.lakeMaxDepth : 12;
    let water=Math.max(Math.max(rimL,rimR)+1, deepest-maxDepth);
    // Degenerate basin (a shoulder sits below the floor, or the segment hit the scan
    // cap): fall back to a shallow fill so marked lakes never generate bone-dry
    if(water>=deepest-1) water=deepest-2;
    for(let i=L;i<=R;i++) lakeLevels.set(i,water);
    return water;
  }

  const COL_CARVE = new Uint8Array(WORLD_H); // per-column cave scratch: 0 solid, 1 air, 2 water

  function volcanoDistance(col,wx){ return col && col.volcano ? Math.abs(wx-col.volcano.center) : Infinity; }
  function volcanoForcedTile(col,wx,y,ground){
    const v=col && col.volcano; if(!v || y>=WORLD_H-3) return undefined;
    const d=Math.abs(wx-v.center);
    if(d<=v.reservoir && y>=WORLD_H-9) return T.LAVA;
    if(d<=v.pipe && y>=ground) return T.LAVA;
    if(d<=v.crater && y>=ground && y<=ground+1) return T.LAVA;
    if(d<=v.crater+1 && y===ground-1) return T.AIR;
    if(d<=v.pipe+1 && y>=ground) return WG.randSeed(wx*6.17+y*0.29)<0.34 ? T.OBSIDIAN : T.BASALT;
    if(d<=v.crater+2 && y>=ground && y<=ground+4){
      if(d<=v.crater+1) return T.OBSIDIAN;
      return WG.randSeed(wx*4.37+y*0.41)<0.55 ? T.BASALT : T.STONE;
    }
    return undefined;
  }
  // Volcanic underground rock (dikes, pipe carapace, thermal aureole) comes from
  // the shared vertical layer model so mid-world and deep-section volcanism form
  // one continuous body instead of per-band boxes.
  function volcanoRockTile(col,wx,y,ground,depth){
    const v=col && col.volcano; if(!v || y<ground || y>=WORLD_H-3) return undefined;
    return WORLD_LAYERS.volcanoAureoleTile(WG,col,wx,y,ground,depth);
  }
  function reinforceVolcanoConduits(arr,cx){
    for(let lx=0; lx<CHUNK_W; lx++){
      const wx=cx*CHUNK_W+lx;
      const col=WG.column(wx); if(!col.volcano) continue;
      const ground=col.row;
      for(let y=Math.max(0,ground-1); y<WORLD_H-3; y++){
        const vt=volcanoForcedTile(col,wx,y,ground);
        if(vt!==undefined) arr[tileIndex(lx,y)]=vt;
      }
    }
  }
  function registerGeneratedLava(arr,cx){
    try{
      if(!MM.fire || !MM.fire.noteLava) return;
      const activeNeighbor=(lx,y)=>{
        if(y<0 || y>=WORLD_H) return false;
        if(lx<0 || lx>=CHUNK_W) return false;
        const t=arr[tileIndex(lx,y)];
        return isLavaExposureOpenTile(t);
      };
      for(let lx=0; lx<CHUNK_W; lx++){
        const wx=cx*CHUNK_W+lx;
        for(let y=0; y<WORLD_H-3; y++){
          if(arr[tileIndex(lx,y)]!==T.LAVA) continue;
          if(activeNeighbor(lx,y-1) || activeNeighbor(lx,y+1) || activeNeighbor(lx-1,y) || activeNeighbor(lx+1,y)){
            MM.fire.noteLava(wx,y,{priority:true});
          }
        }
      }
    }catch(e){}
  }
  function isCityStructuralTile(t){ return generatedCityStructuralTile(t); }
  function isCityLoadBearingTile(t){ return generatedCitySupportTile(t); }
  function auditCityStructuralStability(arr,cx){
    const faller=MM.fallingSolids;
    if(!faller || !faller.maybeStart || !WG || !WG.column) return;
    const worldLeft=cx*CHUNK_W;
    const seen=new Uint8Array(CHUNK_W*WORLD_H);
    const stack=[];
    const neighbors=[[1,0],[-1,0],[0,1],[0,-1]];
    function cityTerrainAnchor(wx,y,t){
      if(!isCityStructuralTile(t)) return false;
      try{ return WG.biomeType(wx)===8 && y>=WG.surfaceHeight(wx); }catch(e){ return false; }
    }
    for(let lx=0; lx<CHUNK_W; lx++){
      const wx=worldLeft+lx;
      const col=WG.column(wx);
      if(!col || col.biome!==8) continue;
      for(let y=1; y<WORLD_H-4; y++){
        const idx=tileIndex(lx,y);
        if(seen[idx]) continue;
        const t=arr[tileIndex(lx,y)];
        if(!isCityStructuralTile(t)) continue;
        let supported=false;
        let rep=null;
        stack.length=0;
        stack.push([lx,y]);
        while(stack.length){
          const cur=stack.pop();
          const x=cur[0], yy=cur[1];
          if(x<0 || x>=CHUNK_W || yy<1 || yy>=WORLD_H-3) continue;
          const ci=tileIndex(x,yy);
          if(seen[ci]) continue;
          const ct=arr[ci];
          if(!isCityStructuralTile(ct)) continue;
          seen[ci]=1;
          const cwx=worldLeft+x;
          if(cityTerrainAnchor(cwx,yy,ct)){ supported=true; continue; }
          const below=arr[tileIndex(x,yy+1)];
          if(isCityLoadBearingTile(below) || cityTerrainAnchor(cwx,yy+1,below)){
            supported=true;
          } else if(!rep){
            rep={x:cwx,y:yy};
          }
          for(const n of neighbors) stack.push([x+n[0],yy+n[1]]);
        }
        if(!supported && rep) faller.maybeStart(rep.x,rep.y);
      }
    }
  }

  function citySurfaceTile(WG,wx,depth){
    const r=WG.randSeed(wx*3.917+depth*0.73);
    if(depth===0){
      if(r<0.10) return T.STEEL;
      if(r<0.42) return T.OBSIDIAN;
      return T.STONE;
    }
    if(depth<3){
      if(r<0.08) return T.STEEL;
      if(r<0.22) return T.OBSIDIAN;
    }
    return T.STONE;
  }

  function swampGroundTile(wx,depth,poolDepth){
    const wet = poolDepth>0 || WG.valueNoise(wx,42,3302)>0.57 || WG.valueNoise(wx,15,3305)>0.78;
    const clayLens = WG.randSeed(wx*5.41+depth*1.77)<(poolDepth>0?0.22:0.13);
    if(depth===0) return wet ? T.MUD : T.GRASS;
    if(depth<4 && (wet || WG.randSeed(wx*8.17+depth*2.13)<0.62)) return (depth>=2 && clayLens) ? T.CLAY : T.MUD;
    if(depth<7) return (wet && clayLens) ? T.CLAY : T.DIRT;
    return WG.randSeed(wx*6.11+depth*1.91)<0.08 ? T.CLAY : T.SAND;
  }
  function dirtThickness(wx,biome,beach,desertF,waterF){
    if(biome===8) return 0;
    if(biome===5 || biome===6) return 4 + Math.floor(WG.randSeed(wx*0.57)*3);
    if(biome===3 || beach) return 0;
    if(biome===4) return 2 + Math.floor(WG.randSeed(wx*0.53)*2);
    if(biome===7) return 1 + Math.floor(WG.randSeed(wx*0.61)*2);
    return 3 + Math.floor(WG.randSeed(wx*0.67)*3) + (desertF>0.10 || waterF>0.10 ? 1 : 0);
  }
  function naturalSurfaceHazardKind(wx,biome,beach,desertF,cold,slope,waterBed,lakeBed,poolDepth,volcano){
    if(volcano || waterBed || lakeBed || poolDepth>0 || cold || biome===4 || biome===5 || biome===6 || biome===8) return null;
    if(slope>=3) return null;
    const sandish=biome===3 || beach || desertF>0.34;
    if(sandish){
      const qChance=(biome===3 ? 0.018 : 0.010) + (beach ? 0.006 : 0) + Math.max(0,desertF-0.35)*0.014;
      if(WG.randSeed(wx*23.17+704.3)<qChance) return 'quicksand';
      const trapChance=(biome===3 ? 0.014 : 0.007) + (beach ? 0.003 : 0);
      if(WG.randSeed(wx*19.91+771.7)<trapChance) return 'unstable-sand';
    }
    const grassy=biome===0 || biome===1 || biome===7 || desertF<0.42;
    if(grassy && WG.randSeed(wx*21.73+413.5)<(biome===1 ? 0.012 : 0.008)) return 'unstable-grass';
    return null;
  }
  function applyNaturalSurfaceHazard(t,depth,hazard){
    if(hazard==='quicksand' && t===T.SAND && depth<4) return T.QUICKSAND;
    if(depth!==0) return t;
    if(hazard==='unstable-sand' && t===T.SAND) return T.UNSTABLE_SAND;
    if(hazard==='unstable-grass' && t===T.GRASS) return T.UNSTABLE_GRASS;
    return t;
  }
  // Permafrost active layer of the deep-cold west: how many tiles below the
  // surface the soil generates frozen. Zero above the climate gate, deepening
  // toward absolute cold; flooded columns stay unfrozen (water insulates).
  const GROUND_FROST_CLIMATE_GATE=0.24;
  function groundFrostDepth(col,wx){
    const t=col && Number.isFinite(col.t) ? col.t : 0.5;
    if(t>=GROUND_FROST_CLIMATE_GATE) return 0;
    const k=(GROUND_FROST_CLIMATE_GATE-t)/GROUND_FROST_CLIMATE_GATE;
    return Math.max(1, Math.round(3 + k*7 + (WG.randSeed(wx*3.77+911.3)-0.5)*2));
  }
  // Frost binds loose earth into its permafrost variant; hazards freeze solid too
  // (no quicksand in permafrost). Rock, snow and city materials pass through.
  function frostBindTile(t){
    if(t===T.SAND || t===T.UNSTABLE_SAND || t===T.QUICKSAND) return T.FROZEN_SAND;
    if(t===T.DIRT || t===T.MUD) return T.FROZEN_DIRT;
    if(t===T.CLAY || t===T.WET_CLAY) return T.FROZEN_CLAY;
    return t;
  }
  function geologyRockTile(wx,y,depth,biome){
    return WORLD_LAYERS.legacyGeologyRockTile(WG,wx,y,depth,biome);
  }
  function applyDevastatedCity(arr,cx,bgOnly){
    const WG=MM.worldGen; if(!WG || !WG.column) return;
    if(bgOnly && generatedBackground.has(ck(cx))) return;
    if(!bgOnly && generatedBackground.delete(ck(cx))) genBgInvalidate();
    const worldLeft=cx*CHUNK_W, worldRight=worldLeft+CHUNK_W-1;
    let bgArr=null;
    const putBg=(wx,y,t)=>{
      if(wx<worldLeft || wx>worldRight || y<0 || y>=WORLD_H-3) return;
      if(!isConstructionBackgroundTile(t)) return;
      if(!bgArr){ bgArr=new Uint8Array(CHUNK_W*WORLD_H); generatedBackground.set(ck(cx),bgArr); genBgInvalidate(); }
      bgArr[tileIndex(wx-worldLeft,y)]=t;
    };
    const put=(wx,y,t,force)=>{
      if(wx<worldLeft || wx>worldRight || y<0 || y>=WORLD_H-3) return false;
      if(bgOnly) return true; // background replay: keep builder flow, touch no foreground
      if(isChestTile(t)) return false;
      const lx=wx-worldLeft, idx=tileIndex(lx,y), cur=arr[idx];
      if(force || isGeneratedStructureReplaceableTile(cur)){
        arr[idx]=t;
        return true;
      }
      return false;
    };
    const carve=(wx,y)=>{
      if(bgOnly) return;
      if(wx<worldLeft || wx>worldRight || y<0 || y>=WORLD_H-3) return;
      const idx=tileIndex(wx-worldLeft,y), cur=arr[idx];
      if(cur!==T.LAVA && !(INFO[cur] && INFO[cur].chestTier)) arr[idx]=T.AIR;
    };
    // Interior backdrop material keyed to the district's architecture school.
    const cityBg=(arch)=>(arch===1||arch===2)?T.STEEL:T.STONE;
    const cityCol=(wx)=>{ const col=WG.column(wx); return col && col.biome===8 ? col : null; };
    // Architecture schools (worldgen picks one per district): 0 stone spires,
    // 1 glass downtown (legacy palette), 2 foundry sprawl, 3 terraced ziggurats,
    // 4 brutalist megablocks.
    const cityArch=(city)=>{
      const a=city ? city.arch : null;
      return Number.isFinite(a) ? Math.max(0,Math.min(4,Math.floor(a))) : 1;
    };
    const cityTile=(wx,y,cell,heavy,arch)=>{
      const r=WG.randSeed(wx*4.171+y*0.613+cell*19.31);
      switch(arch){
        case 0:
          if(heavy) return r<0.30 ? T.STEEL : (r<0.80 ? T.STONE : T.OBSIDIAN);
          return r<0.10 ? T.STEEL : (r<0.70 ? T.STONE : T.OBSIDIAN);
        case 2:
          if(heavy) return r<0.70 ? T.STEEL : (r<0.90 ? T.STONE : T.OBSIDIAN);
          return r<0.42 ? T.STEEL : (r<0.80 ? T.STONE : T.OBSIDIAN);
        case 3:
          if(heavy) return r<0.22 ? T.STEEL : (r<0.68 ? T.STONE : T.OBSIDIAN);
          return r<0.08 ? T.STEEL : (r<0.64 ? T.STONE : T.OBSIDIAN);
        case 4:
          if(heavy) return r<0.52 ? T.STEEL : T.STONE;
          return r<0.20 ? T.STEEL : (r<0.90 ? T.STONE : T.OBSIDIAN);
        default:
          if(heavy) return r<0.62 ? T.STEEL : T.STONE;
          if(r<0.28) return T.STEEL;
          if(r<0.82) return T.STONE;
          return T.OBSIDIAN;
      }
    };
    // Height profile across the district so each city has a coherent skyline
    // instead of uniform random towers: downtown core, twin peaks, terraces...
    const skylineEnvelope=(city,wx)=>{
      if(!city || !Number.isFinite(city.center) || !(city.radius>0)) return 1;
      const rel=Math.min(1,Math.abs(wx-city.center)/city.radius);
      const motif=Number.isFinite(city.motif)?city.motif:0.5;
      let env;
      switch(cityArch(city)){
        case 0: env=0.60+0.62*Math.pow(1-rel,1.4); break;
        case 2: env=0.74+0.18*Math.sin(rel*8.2+motif*6.3); break;
        case 3: env=0.42+0.68*(Math.round((1-rel)*4)/4); break;
        case 4: { const peak=0.34+motif*0.28; const d=rel-peak; env=0.56+0.72*Math.exp(-(d*d)/0.028); break; }
        default: env=0.52+0.88*Math.pow(1-rel,1.8); break;
      }
      return Math.max(0.42,Math.min(1.45,env));
    };
    const CITY_STYLE_WEIGHTS={
      0:[['spire',0.34],['block',0.26],['monument',0.14],['tower',0.14],['factory',0.12]],
      1:[['tower',0.32],['block',0.30],['factory',0.14],['spire',0.12],['monument',0.12]],
      2:[['factory',0.40],['block',0.26],['tower',0.16],['spire',0.09],['monument',0.09]],
      3:[['ziggurat',0.36],['block',0.24],['monument',0.16],['spire',0.14],['tower',0.10]],
      4:[['block',0.44],['tower',0.22],['factory',0.16],['ziggurat',0.09],['monument',0.09]]
    };
    const pickStyle=(arch,roll)=>{
      const weights=CITY_STYLE_WEIGHTS[arch]||CITY_STYLE_WEIGHTS[1];
      let acc=0;
      for(const [style,w] of weights){ acc+=w; if(roll<acc) return style; }
      return weights[0][0];
    };
    const maybeWire=(wx,y,seed,chance,force)=>{
      const p = typeof chance==='number' ? chance : 0.10;
      if(WG.randSeed(seed)<p) put(wx,y,T.WIRE,!!force);
    };
    const maybeElectronics=(wx,y,seed,chance)=>{
      const p = typeof chance==='number' ? chance : 0.0015;
      if(WG.randSeed(seed)<p) put(wx,y,T.ELECTRONICS,false);
    };
    const buildFrame=(anchor,w,h,cell,style)=>{
      const col=cityCol(anchor); if(!col) return;
      const ground=col.row;
      const city=col.city || {density:0.75,decay:0.6};
      const arch=cityArch(city);
      const floorGap=style==='tower'?4:(style==='factory'?3:5);
      const beamGap=style==='tower'?3:(style==='factory'?5:4);
      for(let dx=0; dx<w; dx++){
        const wx=anchor+dx;
        if(!cityCol(wx)) continue;
        const localGround=WG.column(wx).row;
        const baseY=Math.max(2,Math.min(ground,localGround));
        for(let rel=1; rel<=h; rel++){
          const y=baseY-rel;
          if(y<2) break;
          const edge=dx===0 || dx===w-1;
          const floor=rel===1 || rel%floorGap===0;
          const beam=dx%beamGap===0;
          const crown=rel>h-2;
          const damage=WG.randSeed(wx*1.77+y*3.19+cell*0.21);
          if(crown && damage<city.decay*0.55) continue;
          if(!edge && !floor && !beam && damage<0.62+city.decay*0.16){
            const windowBand=(rel%floorGap)>=2 && (rel%floorGap)<=floorGap-1;
            const pane=(dx%3)!==0 && windowBand && damage>0.18+city.decay*0.12;
            if(pane) put(wx,y,T.GLASS,false);
            else putBg(wx,y,cityBg(arch)); // hole in the wall face shows the room's back wall
            continue;
          }
          const t=cityTile(wx,y,cell,edge||floor||beam,arch);
          put(wx,y,t,true);
          if(!edge && floor && WG.randSeed(wx*6.3+y*0.41)>0.84){ carve(wx,y-1); putBg(wx,y-1,cityBg(arch)); }
          if(!edge && floor && rel>1 && dx>1 && dx<w-2){
            maybeWire(wx,y-1,wx*0.719+y*1.13+cell*2.31,style==='factory'?0.12:0.07,false);
            maybeElectronics(wx,y-1,wx*2.83+y*0.91+cell*5.7,style==='factory'?0.0025:0.0012);
          }
        }
      }
      if(style==='factory'){
        const chimneys=1+Math.floor(WG.randSeed(anchor*0.13+cell)*3);
        for(let i=0;i<chimneys;i++){
          const wx=anchor+2+Math.floor(WG.randSeed(anchor*1.9+i*17)*Math.max(1,w-4));
          const base=ground-h+1+Math.floor(WG.randSeed(wx*0.7)*3);
          // Chimney footing: decay can hole the roof rows the stack stands on.
          put(wx,base,cityTile(wx,base,cell,true,arch),true);
          for(let y=base-1; y>=base-7; y--) put(wx,y,T.STEEL,true);
          put(wx,base-8,T.OBSIDIAN,true);
        }
      } else if(style==='tower'){
        const mastX=anchor+(w>>1);
        // Solid service core under the mast: decay-holed crown rows otherwise
        // leave the antenna standing on air and it sheds during the settle audit.
        const mc=cityCol(mastX);
        if(mc){
          const mBase=Math.max(2,Math.min(ground,mc.row));
          for(let rel=1; rel<=h; rel++){
            const y=mBase-rel;
            if(y<2) break;
            put(mastX,y,cityTile(mastX,y,cell,true,arch),true);
          }
        }
        for(let y=ground-h-1; y>=ground-h-8; y--) put(mastX,y,T.STEEL,true);
        put(mastX-1,ground-h-5,T.STEEL,true); put(mastX+1,ground-h-5,T.STEEL,true);
      }
      if(WG.randSeed(anchor*0.93+cell)>0.82){
        const chestX=anchor+2+Math.floor(WG.randSeed(anchor*2.17+cell)*Math.max(1,w-4));
        const chestY=ground-2-Math.floor(WG.randSeed(anchor*2.71+cell)*Math.min(5,Math.max(1,h-2)));
        const chestRoll=WG.randSeed(anchor*3.33+cell);
        put(chestX,chestY,chestRoll>0.965?T.CHEST_LEGENDARY:chestRoll>0.83?T.CHEST_EPIC:T.CHEST_RARE,true);
      }
      const vendingChance=style==='factory'?0.34:(style==='tower'?0.16:0.23);
      if(w>=7 && h>=6 && WG.randSeed(anchor*1.37+cell*0.61)<vendingChance){
        const vx=anchor+2+Math.floor(WG.randSeed(anchor*2.91+cell)*Math.max(1,w-4));
        const floors=Math.max(1,Math.floor((h-2)/floorGap));
        const rel=1+floorGap*Math.floor(WG.randSeed(anchor*3.07+cell)*floors);
        const vy=Math.max(2,ground-rel-1);
        if(cityCol(vx) && cityCol(vx-1) && cityCol(vx+1)){
          put(vx,vy+1,cityTile(vx,vy+1,cell,true,arch),true);
          carve(vx,vy-1);
          put(vx,vy,T.VENDING_MACHINE,true);
          maybeWire(vx-1,vy,anchor*0.41+cell,0.38,true);
        }
      }
    };
    const buildMonument=(anchor,cell)=>{
      const col=cityCol(anchor); if(!col) return;
      const g=col.row;
      for(let dx=-3; dx<=3; dx++) put(anchor+dx,g-1,T.STONE,true);
      for(let dx=-2; dx<=2; dx++) put(anchor+dx,g-2,T.STONE,true);
      for(let y=g-3; y>=g-9; y--) put(anchor,y,(y%2)?T.STEEL:T.STONE,true);
      put(anchor-1,g-6,T.STEEL,true); put(anchor+1,g-6,T.STEEL,true);
      if(WG.randSeed(anchor*0.27+cell)>0.72) put(anchor,g-10,T.GLASS,true);
    };
    // Tapering spire with buttress feet and lancet window slits. Every column is
    // grounded on local terrain so the structural audit sees a supported mass.
    const buildSpire=(anchor,h,cell,city)=>{
      const col=cityCol(anchor); if(!col) return;
      const arch=cityArch(city);
      const half=2+Math.floor(WG.randSeed(cell*7.31+3.7)*2);
      const decay=city && Number.isFinite(city.decay)?city.decay:0.5;
      for(let dx=-half-1; dx<=half+1; dx++){
        const wx=anchor+dx;
        const c=cityCol(wx); if(!c) continue;
        const baseY=Math.max(2,Math.min(col.row,c.row));
        const a=Math.abs(dx);
        if(a===half+1){
          for(let rel=1; rel<=3; rel++) put(wx,baseY-rel,rel===3?T.OBSIDIAN:T.STONE,true);
          continue;
        }
        const colH=Math.max(3,Math.round(h*(1-Math.pow(a/(half+1),1.25)*0.92)));
        for(let rel=1; rel<=colH; rel++){
          const y=baseY-rel;
          if(y<2) break;
          const edge=a===half || rel>=colH-1;
          const damage=WG.randSeed(wx*1.77+y*3.19+cell*0.21);
          if(!edge && rel>2 && (rel%4===2||rel%4===3) && damage>0.30+decay*0.15){
            put(wx,y,T.GLASS,false);
            continue;
          }
          put(wx,y,cityTile(wx,y,cell,edge,arch),true);
        }
      }
      const tipY=col.row-h-1;
      put(anchor,tipY,T.STEEL,true);
      if(WG.randSeed(cell*3.91+1.1)>0.45) put(anchor,tipY-1,T.TORCH,true);
    };
    // Stepped ziggurat with obsidian tier trim and a lootable crown sanctum.
    const buildZiggurat=(anchor,h,cell,city,grand)=>{
      const col=cityCol(anchor); if(!col) return;
      const arch=cityArch(city);
      const decay=city && Number.isFinite(city.decay)?city.decay:0.5;
      const tierH=3;
      const half0=grand ? 10+Math.floor(WG.randSeed(cell*6.71+1.9)*4) : 5+Math.floor(WG.randSeed(cell*6.71+1.9)*4);
      const tiers=Math.max(3,Math.min(grand?6:5,Math.floor(h/tierH)));
      const step=Math.max(1,Math.ceil(half0/tiers));
      for(let dx=-half0; dx<=half0; dx++){
        const wx=anchor+dx;
        const c=cityCol(wx); if(!c) continue;
        const baseY=Math.max(2,Math.min(col.row,c.row));
        const a=Math.abs(dx);
        let tierOfCol=0;
        for(let t=1;t<tiers;t++){ if(a<=half0-t*step) tierOfCol=t; }
        const colH=(tierOfCol+1)*tierH;
        for(let rel=1; rel<=colH; rel++){
          const y=baseY-rel;
          if(y<2) break;
          const damage=WG.randSeed(wx*1.77+y*3.19+cell*0.21);
          const cap=rel===colH;
          if(cap && tierOfCol===tiers-1 && a!==0 && damage<decay*0.5) continue;
          const trim=cap || a===half0;
          put(wx,y,trim ? (damage<0.34?T.OBSIDIAN:T.STONE) : cityTile(wx,y,cell,false,arch),true);
        }
      }
      const crownY=col.row-(tiers-1)*tierH-1;
      carve(anchor-1,crownY); carve(anchor+1,crownY);
      carve(anchor,crownY); carve(anchor,crownY-1);
      for(const [sx,sy] of [[anchor-1,crownY],[anchor+1,crownY],[anchor,crownY],[anchor,crownY-1]]) putBg(sx,sy,T.STONE);
      if(WG.randSeed(cell*4.87+2.3)>0.35){
        const crownRoll=WG.randSeed(cell*8.6+0.7);
        put(anchor,crownY,crownRoll>0.96?T.CHEST_LEGENDARY:crownRoll>0.8?T.CHEST_EPIC:T.CHEST_RARE,true);
      }
      const apexY=col.row-tiers*tierH-1;
      put(anchor,apexY,grand?T.GLASS:T.TORCH,true);
    };
    // ---- Abandoned civic lots ----------------------------------------------
    // Empty lots between buildings used to collect loose rubble piles. They now
    // read as pre-collapse civic life instead: dead malls, empty schools,
    // churchyards, overgrown parks and the occasional fairground coaster. Every
    // roll is a pure function of the lot cell so generation stays chunk-order
    // independent, and every solid column is grounded for the stability audit.
    const lotEmpty=(c,city)=>WG.randSeed(c*17.33+2.9)>city.density;
    const civicKind=(c)=>{
      const roll=WG.randSeed(c*7.77+5.13);
      if(roll<0.10) return 'coaster';
      if(roll<0.38) return 'mall';
      if(roll<0.60) return 'school';
      if(roll<0.80) return 'church';
      return 'park';
    };
    const civicWide=(kind)=>kind==='mall'||kind==='coaster';
    const civicDecay=(city)=>city && Number.isFinite(city.decay)?city.decay:0.5;
    const civicDamage=(wx,y,cell)=>WG.randSeed(wx*1.77+y*3.19+cell*0.21);
    const buildDeadTree=(tx,cell)=>{
      const c=cityCol(tx); if(!c) return;
      const th=3+Math.floor(WG.randSeed(tx*1.31+cell*0.77)*3);
      for(let rel=1; rel<=th; rel++) put(tx,c.row-rel,T.WOOD,true);
      for(let dy=0; dy<=1; dy++){
        for(let dx=-1; dx<=1; dx++){
          const lr=WG.randSeed(tx*3.7+dx*5.1+dy*7.3+cell);
          if(lr<0.52) put(tx+dx,c.row-th-dy,lr<0.26?T.AUTUMN_LEAF_ORANGE:T.AUTUMN_LEAF_RED,false);
        }
      }
    };
    const buildRuinPark=(anchor,cell,city)=>{
      const w=14+Math.floor(WG.randSeed(cell*3.83+0.7)*4);
      const variant=WG.randSeed(cell*5.21+2.6);
      for(let dx=0; dx<w; dx++){
        const wx=anchor+dx;
        const c=cityCol(wx); if(!c) continue;
        const lawn=WG.randSeed(wx*2.93+cell*0.4);
        put(wx,c.row,lawn<0.18?T.DIRT:T.GRASS,true);
        if(lawn>0.88) put(wx,c.row-1,T.LEAF,false);
      }
      const trees=1+Math.floor(WG.randSeed(cell*9.4+1.2)*3);
      for(let i=0;i<trees;i++) buildDeadTree(anchor+2+Math.floor(WG.randSeed(cell*11.3+i*4.7)*(w-4)),cell);
      if(WG.randSeed(cell*2.11+1.8)>0.35){
        const bx=anchor+2+Math.floor(WG.randSeed(cell*7.6+0.3)*(w-5));
        const bc=cityCol(bx);
        if(bc){ put(bx,bc.row-1,T.STONE,true); put(bx+1,bc.row-1,T.STONE,true); }
      }
      const lampX=anchor+(WG.randSeed(cell*4.9+2.2)>0.5?1:w-2);
      const lc=cityCol(lampX);
      if(lc){ for(let y=lc.row-1; y>=lc.row-3; y--) put(lampX,y,T.STEEL,true); put(lampX,lc.row-4,T.TORCH,true); }
      const cx0=anchor+(w>>1);
      const cc=cityCol(cx0);
      if(cc){
        if(variant<0.38){
          // Dry fountain: stone basin holding a little stagnant rainwater.
          for(let dx=-2; dx<=2; dx++){ const c=cityCol(cx0+dx); if(c) put(cx0+dx,c.row,T.STONE,true); }
          put(cx0-2,cc.row-1,T.STONE,true); put(cx0+2,cc.row-1,T.STONE,true);
          put(cx0,cc.row-1,T.STONE,true); put(cx0,cc.row-2,T.STONE,true);
          put(cx0-1,cc.row-1,T.WATER,true); put(cx0+1,cc.row-1,T.WATER,true);
        } else if(variant<0.68){
          // Playground: trampoline pad and a small climbing frame with a ladder.
          put(cx0,cc.row-1,T.SPRING_PLATFORM,false);
          const fx=cx0+2;
          const fc=cityCol(fx), fc3=cityCol(fx+3);
          if(fc && fc3){
            const fb=Math.max(2,Math.min(fc.row,fc3.row));
            put(fx,fb-1,T.STEEL,true); put(fx,fb-2,T.STEEL,true);
            put(fx+3,fb-1,T.STEEL,true); put(fx+3,fb-2,T.STEEL,true);
            for(let dx=0; dx<=3; dx++) put(fx+dx,fb-3,T.STEEL,true);
            put(fx+1,fb-1,T.LADDER,false); put(fx+1,fb-2,T.LADDER,false);
          }
        }
      }
      if(WG.randSeed(cell*6.6+3.1)<0.30){
        const chx=anchor+3+Math.floor(WG.randSeed(cell*8.3+0.9)*(w-6));
        const chc=cityCol(chx);
        if(chc) put(chx,chc.row-1,WG.randSeed(cell*9.4+1.7)>0.6?T.CHEST_UNCOMMON:T.CHEST_COMMON,true);
      }
    };
    const buildRuinSchool=(anchor,cell,city)=>{
      const col=cityCol(anchor); if(!col) return;
      const decay=civicDecay(city);
      const w=15+Math.floor(WG.randSeed(cell*4.13+1.5)*4);
      const h=9, ground=col.row;
      for(let dx=0; dx<w; dx++){
        const wx=anchor+dx;
        const c=cityCol(wx); if(!c) continue;
        const baseY=Math.max(2,Math.min(ground,c.row));
        for(let rel=1; rel<=h; rel++){
          const y=baseY-rel; if(y<2) break;
          const edge=dx===0||dx===w-1;
          const slab=rel===1||rel===5;
          const damage=civicDamage(wx,y,cell);
          if(rel===h){ if(edge || damage>decay*0.5) put(wx,y,T.BRICK,true); continue; }
          if(edge||slab){ put(wx,y,T.BRICK,true); continue; }
          if(dx%4===0){ put(wx,y,T.BRICK,true); continue; }
          const band=(rel>=2&&rel<=3)||(rel>=6&&rel<=7);
          if(band && damage>0.20+decay*0.35){ put(wx,y,T.GLASS,false); continue; }
          carve(wx,y);
          putBg(wx,y,T.BRICK); // classroom back wall
          if((rel===2||rel===6) && dx%3===1 && damage>0.45+decay*0.30) put(wx,y,T.STONE,false);
        }
      }
      const bb=cityCol(anchor+2);
      if(bb){ const b=Math.max(2,Math.min(ground,bb.row)); put(anchor+2,b-3,T.OBSIDIAN,false); put(anchor+2,b-7,T.OBSIDIAN,false); }
      const doorC=cityCol(anchor);
      if(doorC){ const b=Math.max(2,Math.min(ground,doorC.row)); put(anchor,b-2,T.WOOD_DOOR,true); carve(anchor,b-3); }
      const mastX=anchor+w-3, mc=cityCol(mastX);
      if(mc){
        const b=Math.max(2,Math.min(ground,mc.row));
        put(mastX,b-h,T.BRICK,true);
        for(let y=b-h-1; y>=b-h-3; y--) put(mastX,y,T.STEEL,true);
        put(mastX-1,b-h-3,T.WIRE,false);
      }
      if(WG.randSeed(cell*3.9+0.8)<0.45){
        const vx=anchor+2+Math.floor(WG.randSeed(cell*5.7+2.4)*(w-4));
        const vc=cityCol(vx);
        if(vc && vx%4!==0){ const b=Math.max(2,Math.min(ground,vc.row)); carve(vx,b-3); put(vx,b-2,T.VENDING_MACHINE,true); }
      }
      if(WG.randSeed(cell*6.1+1.4)<0.60){
        const chc=cityCol(anchor+w-3);
        if(chc){ const b=Math.max(2,Math.min(ground,chc.row)); put(anchor+w-3,b-6,WG.randSeed(cell*7.9+2.2)>0.6?T.CHEST_UNCOMMON:T.CHEST_COMMON,true); }
      }
      maybeElectronics(anchor+5,Math.max(2,ground-6),cell*9.77+2.5,0.25);
    };
    const buildRuinChurch=(anchor,cell,city)=>{
      const col=cityCol(anchor); if(!col) return;
      const decay=civicDecay(city);
      const yardW=5, naveW=9, towerW=3;
      const naveX=anchor+yardW, towerX=naveX+naveW;
      for(let dx=0; dx<yardW; dx++){
        const wx=anchor+dx;
        const c=cityCol(wx); if(!c) continue;
        put(wx,c.row,T.GRASS,true);
        if(dx%2===1 && (dx===1 || WG.randSeed(wx*3.13+cell)<0.75)) put(wx,c.row-1,T.GRAVE,dx===1);
      }
      buildDeadTree(anchor+(WG.randSeed(cell*1.9+0.6)>0.5?0:2),cell+0.5);
      const naveH=6;
      for(let dx=0; dx<naveW; dx++){
        const wx=naveX+dx;
        const c=cityCol(wx); if(!c) continue;
        const baseY=Math.max(2,Math.min(col.row,c.row));
        const peak=((naveW-1)>>1)-Math.abs(dx-((naveW-1)>>1));
        const hh=naveH+peak;
        for(let rel=1; rel<=hh; rel++){
          const y=baseY-rel; if(y<2) break;
          const edge=dx===0||dx===naveW-1;
          const damage=civicDamage(wx,y,cell);
          if(rel>naveH){
            // Two-thick sloped roof line so neighbouring columns stay 4-connected.
            if(rel>=hh-1 && damage>decay*0.35) put(wx,y,T.STONE,true);
            continue;
          }
          if(rel===1 || edge){ put(wx,y,T.STONE,true); continue; }
          if(dx%3===1 && rel>=2 && rel<=4 && damage>0.15+decay*0.30){ put(wx,y,T.GLASS,false); continue; }
          carve(wx,y);
          putBg(wx,y,T.STONE); // nave back wall
          if(rel===2 && dx>=2 && dx<=naveW-3 && dx%2===0 && damage>0.40+decay*0.25) put(wx,y,T.STONE,false);
        }
      }
      const dc=cityCol(naveX);
      if(dc){ const b=Math.max(2,Math.min(col.row,dc.row)); put(naveX,b-2,T.WOOD_DOOR,true); carve(naveX,b-3); }
      const ac=cityCol(towerX-2);
      if(ac){ const b=Math.max(2,Math.min(col.row,ac.row)); put(towerX-2,b-2,T.OBSIDIAN,true); put(towerX-2,b-3,T.TORCH,false); }
      const towerH=11+Math.floor(WG.randSeed(cell*3.37+2.8)*3);
      for(let dx=0; dx<towerW; dx++){
        const wx=towerX+dx;
        const c=cityCol(wx); if(!c) continue;
        const baseY=Math.max(2,Math.min(col.row,c.row));
        for(let rel=1; rel<=towerH; rel++){
          const y=baseY-rel; if(y<2) break;
          const damage=civicDamage(wx,y,cell);
          if(dx===1 && rel>1 && rel<towerH-1){
            if(rel%3===0 && damage>0.25+decay*0.30){ put(wx,y,T.GLASS,false); continue; }
            carve(wx,y);
            putBg(wx,y,T.STONE); // bell-tower shaft back wall
            continue;
          }
          put(wx,y,damage<0.12?T.OBSIDIAN:T.STONE,true);
        }
      }
      const tc=cityCol(towerX+1);
      if(tc){
        const b=Math.max(2,Math.min(col.row,tc.row));
        for(let i=1;i<=3;i++) put(towerX+1,b-towerH-i,T.STEEL,true);
        put(towerX,b-towerH-2,T.STEEL,true); put(towerX+2,b-towerH-2,T.STEEL,true);
        if(WG.randSeed(cell*5.9+1.7)<0.50) put(towerX+1,b-2,T.CHEST_RARE,true);
      }
    };
    const buildRuinMall=(anchor,cell,city,wide)=>{
      const col=cityCol(anchor); if(!col) return;
      const decay=civicDecay(city);
      const w=wide?30+Math.floor(WG.randSeed(cell*3.31+2.2)*5):16;
      const h=wide?13:9;
      const ground=col.row;
      const atrium=anchor+(w>>1);
      for(let dx=0; dx<w; dx++){
        const wx=anchor+dx;
        const c=cityCol(wx); if(!c) continue;
        const baseY=Math.max(2,Math.min(ground,c.row));
        const inAtrium=wide && Math.abs(wx-atrium)<=1;
        for(let rel=1; rel<=h; rel++){
          const y=baseY-rel; if(y<2) break;
          const edge=dx===0||dx===w-1;
          const damage=civicDamage(wx,y,cell);
          if(rel===h){
            if(inAtrium){ put(wx,y,T.GLASS,true); continue; }
            if(edge || damage>decay*0.45) put(wx,y,T.STEEL,true);
            continue;
          }
          if(inAtrium && rel>1){ carve(wx,y); putBg(wx,y,wide?T.STEEL:T.STONE); continue; }
          const slab=rel===1||(rel>1 && rel%4===1);
          const pier=dx%6===3;
          if(edge||pier){ put(wx,y,T.STEEL,true); continue; }
          if(slab){ put(wx,y,T.STONE,true); continue; }
          if(((rel>=2&&rel<=3)||(rel>=6&&rel<=7)) && damage>0.15+decay*0.30){ put(wx,y,T.GLASS,false); continue; }
          carve(wx,y);
          putBg(wx,y,wide?T.STEEL:T.STONE); // shopfloor back wall
        }
      }
      if(wide){
        // Dead escalator: a ladder run beside the galleria linking every level.
        const lx=atrium+2, lc=cityCol(lx);
        if(lc){
          const b=Math.max(2,Math.min(ground,lc.row));
          for(let rel=2; rel<=h-2; rel++){
            const y=b-rel; if(y<2) break;
            carve(lx,y);
            put(lx,y,T.LADDER,false);
          }
        }
      }
      // Food court: counters on the middle slab, leftovers still on them.
      for(let dx=2; dx<w-2; dx++){
        if(dx%5!==1 && dx%5!==2) continue;
        const wx=anchor+dx;
        if(wide && Math.abs(wx-atrium)<=2) continue;
        const c=cityCol(wx); if(!c) continue;
        const b=Math.max(2,Math.min(ground,c.row));
        const y=b-6; if(y<2) continue;
        put(wx,y,T.STONE,true);
        const mr=WG.randSeed(wx*5.9+cell*1.7);
        if(mr<0.30) put(wx,y-1,T.MEAT,false);
        else if(mr<0.55) put(wx,y-1,T.ROTTEN_MEAT,false);
        else if(mr<0.70) put(wx,y-1,T.BAKED_MEAT,false);
      }
      const vends=wide?2:1;
      for(let i=0;i<vends;i++){
        const vx=anchor+3+Math.floor(WG.randSeed(cell*6.83+i*2.9)*(w-6));
        if(wide && Math.abs(vx-atrium)<=1) continue;
        const vc=cityCol(vx); if(!vc || vx%6===3) continue;
        const b=Math.max(2,Math.min(ground,vc.row));
        carve(vx,b-3);
        put(vx,b-2,T.VENDING_MACHINE,true);
        maybeWire(vx+1,b-2,vx*0.53+cell*1.9,0.40,true);
      }
      const topRel=wide?10:6;
      const chc=cityCol(anchor+2);
      if(chc){ const b=Math.max(2,Math.min(ground,chc.row)); put(anchor+2,b-topRel,T.CHEST_COMMON,true); }
      if(WG.randSeed(cell*4.21+0.6)<0.45){
        const c2=cityCol(anchor+w-3);
        if(c2){ const b=Math.max(2,Math.min(ground,c2.row)); put(anchor+w-3,b-topRel,T.CHEST_RARE,true); }
      }
      maybeElectronics(anchor+4,Math.max(2,ground-2),cell*8.9+1.3,0.20);
    };
    const buildRuinCoaster=(anchor,cell,city)=>{
      const col=cityCol(anchor); if(!col) return;
      const decay=civicDecay(city);
      const w=32+Math.floor(WG.randSeed(cell*2.93+3.4)*7);
      const phase=WG.randSeed(cell*6.28+0.9)*6.28;
      const amp=2+WG.randSeed(cell*4.44+1.6)*3;
      const trackRow=(dx,c)=>{
        const ty=Math.round(col.row-5-amp*(1+Math.sin(dx*0.33+phase)));
        return Math.min(ty,c.row-3);
      };
      let lowDx=2, lowY=-Infinity;
      for(let dx=0; dx<w; dx++){
        const wx=anchor+dx;
        const c=cityCol(wx); if(!c) continue;
        const ty=trackRow(dx,c);
        const pylon=dx%4===2 || dx===0 || dx===w-1;
        if(pylon || civicDamage(wx,ty,cell)>decay*0.22) put(wx,ty,T.STEEL,true);
        if(pylon) for(let y=ty+1; y<c.row; y++) put(wx,y,((c.row-y)%3===0)?T.STEEL:T.STONE,true);
        if(ty>lowY && dx>3 && dx<w-3){ lowY=ty; lowDx=dx; }
      }
      // A stranded car resting in the dip of the track.
      const carC=cityCol(anchor+lowDx);
      if(carC){
        const ty=trackRow(lowDx,carC);
        put(anchor+lowDx,ty,T.STEEL,true);
        put(anchor+lowDx,ty-1,T.OBSIDIAN,true);
      }
      // Ticket kiosk under the dip (mid-lot, clear of neighbouring frames) and a
      // ladder up the nearest pylon.
      let kxDx=lowDx+2;
      if(kxDx%4===2) kxDx++; // never swallow a pylon footing
      const kx=anchor+kxDx, kc=cityCol(kx);
      if(kc){
        put(kx,kc.row-1,T.VENDING_MACHINE,true);
        put(kx+1,kc.row-1,T.TORCH,false);
        if(WG.randSeed(cell*7.31+1.1)<0.40) put(kx-1,kc.row-1,T.CHEST_COMMON,true);
      }
      const pylDx=Math.max(2,lowDx-(((lowDx-2)%4)+4)%4);
      const pc=cityCol(anchor+pylDx);
      if(pc){
        const ty=trackRow(pylDx,pc);
        for(let y=ty; y<pc.row; y++) put(anchor+pylDx+1,y,T.LADDER,false);
      }
    };
    const buildCivicLot=(cellIdx,anchor,city)=>{
      const prevEmpty=lotEmpty(cellIdx-1,city);
      // A wide ruin anchors only at the first cell of an empty run, so the cell
      // right after such an anchor is its claimed tail and stays untouched.
      if(prevEmpty && !lotEmpty(cellIdx-2,city) && civicWide(civicKind(cellIdx-1))) return;
      let kind=civicKind(cellIdx);
      if(civicWide(kind) && (prevEmpty || !lotEmpty(cellIdx+1,city))){
        kind=kind==='mall'?'smallmall':'park';
      }
      if(kind==='park') buildRuinPark(anchor-2,cellIdx,city);
      else if(kind==='school') buildRuinSchool(anchor-1,cellIdx,city);
      else if(kind==='church') buildRuinChurch(anchor-2,cellIdx,city);
      else if(kind==='smallmall') buildRuinMall(anchor-1,cellIdx,city,false);
      else if(kind==='mall') buildRuinMall(anchor-1,cellIdx,city,true);
      else buildRuinCoaster(anchor-2,cellIdx,city);
    };
    // One signature landmark per district, themed by its architecture school and
    // offset from the center so it never fights the power plant for space.
    const cityLandmarkSpec=(city)=>{
      if(!city || !Number.isFinite(city.center)) return null;
      const seed=(city.cell||0)*53.9+city.center*0.017;
      const radius=Math.max(120,city.radius||180);
      const dir=WG.randSeed(seed+0.7)>0.5?1:-1;
      const off=Math.max(64,Math.min(radius-46, 80+Math.floor(WG.randSeed(seed+1.3)*radius*0.22)));
      return {anchor:Math.round(city.center+dir*off), seed, arch:cityArch(city), city};
    };
    const collectCityLandmarks=()=>{
      const found=new Map();
      for(let wx=worldLeft; wx<=worldRight; wx+=4){
        const col=cityCol(wx);
        if(col && col.city && Number.isFinite(col.city.center)) found.set(col.city.cell+':'+col.city.center, col.city);
      }
      const out=[];
      for(const city of found.values()){
        const spec=cityLandmarkSpec(city);
        if(spec && spec.anchor+26>=worldLeft-3 && spec.anchor-26<=worldRight+3) out.push(spec);
      }
      return out;
    };
    const buildLandmark=(spec)=>{
      const anchor=spec.anchor, seed=spec.seed, arch=spec.arch, city=spec.city;
      const col=cityCol(anchor); if(!col) return;
      const cellKey=(city.cell||0)*13.7+Math.floor(anchor/17);
      if(arch===0){
        // Ruined cathedral: nave flanked by twin spires around a grand central one.
        buildFrame(anchor-8,17,10,cellKey,'block');
        buildSpire(anchor-7,20,cellKey+1,city);
        buildSpire(anchor+7,20,cellKey+2,city);
        buildSpire(anchor,32,cellKey+3,city);
      } else if(arch===2){
        // Blast-furnace dome with a stack cluster rising from its shell.
        const R=8+Math.floor(WG.randSeed(seed+2.1)*3);
        for(let dx=-R; dx<=R; dx++){
          const wx=anchor+dx;
          const c=cityCol(wx); if(!c) continue;
          const baseY=Math.max(2,Math.min(col.row,c.row));
          const dome=Math.round(Math.sqrt(Math.max(0,R*R-dx*dx)));
          const colH=3+dome;
          for(let rel=1; rel<=colH; rel++){
            const y=baseY-rel;
            if(y<2) break;
            const r=WG.randSeed(wx*4.171+y*0.613+seed);
            const shell=rel<=2 || rel>=colH-1 || Math.abs(dx)>=R-1;
            if(!shell){ carve(wx,y); continue; }
            put(wx,y,r<0.72?T.STEEL:T.OBSIDIAN,true);
          }
        }
        for(let i=0;i<2;i++){
          const sx=anchor-3+i*6;
          const c=cityCol(sx); if(!c) continue;
          const domeTop=Math.min(col.row,c.row)-3-Math.round(Math.sqrt(Math.max(0,R*R-(sx-anchor)*(sx-anchor))));
          for(let y=domeTop-1; y>=Math.max(2,domeTop-6-Math.floor(WG.randSeed(seed+4.1+i)*4)); y--) put(sx,y,(y%3===0)?T.OBSIDIAN:T.STEEL,true);
        }
      } else if(arch===3){
        buildZiggurat(anchor,18,cellKey,city,true);
      } else if(arch===4){
        // Arcology slab: a huge block cut by a full-height atrium, ringed by skyways.
        buildFrame(anchor-16,33,26,cellKey,'block');
        for(let y=col.row-24; y<=col.row-3; y++){
          carve(anchor-1,y); carve(anchor,y); carve(anchor+1,y);
        }
        for(const by of [col.row-9, col.row-17]){
          for(let dx=-24; dx<=24; dx++){
            const wx=anchor+dx;
            if(!cityCol(wx)) continue;
            put(wx,by,T.STEEL,true);
            if(dx%6===0) put(wx,by-1,T.STONE,true);
          }
        }
        for(const px of [anchor-24,anchor+24]){
          const c=cityCol(px);
          if(!c) continue;
          for(let y=col.row-16; y<c.row; y++) put(px,y,((col.row-y)%3===0)?T.STEEL:T.STONE,true);
        }
      } else {
        // Supertower: the tallest needle in the glass downtown, with a lit crown.
        buildFrame(anchor-6,13,40,cellKey,'tower');
        put(anchor,col.row-49,T.TORCH,true);
      }
    };
    function cityPowerPlantSpec(city){
      if(!city || !Number.isFinite(city.center)) return null;
      const seed=(city.cell||0)*97.31 + city.center*0.011;
      const desiredW=42 + Math.floor(WG.randSeed(seed+1.7)*14);
      const h=10 + Math.floor(WG.randSeed(seed+2.9)*5);
      const radius=Math.max(80, city.radius||180);
      const scanLeft=Math.floor(city.center-radius);
      const scanRight=Math.ceil(city.center+radius);
      const spans=[];
      let start=null, end=null;
      for(let wx=scanLeft; wx<=scanRight; wx++){
        const col=cityCol(wx);
        const same=!!(col && col.city && col.city.cell===city.cell && col.city.center===city.center);
        if(same){
          if(start==null) start=wx;
          end=wx;
        } else if(start!=null){
          spans.push({left:start,right:end,width:end-start+1});
          start=null; end=null;
        }
      }
      if(start!=null) spans.push({left:start,right:end,width:end-start+1});
      const usable=spans.filter(s=>s.width>=30);
      if(!usable.length) return null;
      usable.sort((a,b)=>{
        const ac=(a.left+a.right)*0.5, bc=(b.left+b.right)*0.5;
        return (b.width-a.width) || (Math.abs(ac-city.center)-Math.abs(bc-city.center));
      });
      const span=usable[0];
      const w=Math.max(28,Math.min(desiredW,span.width-2));
      const minLeft=span.left+1;
      const maxLeft=span.right-w;
      if(maxLeft<minLeft) return null;
      const preferred=Math.round(city.center-(w>>1)+(WG.randSeed(seed+3.5)-0.5)*Math.min(46,radius*0.30));
      const fallback=Math.round((span.left+span.right-w)*0.5);
      let anchor=preferred>=minLeft && preferred<=maxLeft ? preferred : fallback;
      anchor=Math.max(minLeft,Math.min(maxLeft,anchor));
      const dynamos=w>=38 && WG.randSeed(seed+4.1)>0.48 ? 2 : 1;
      return {anchor,w,h,dynamos,seed,city};
    }
    function collectCityPlants(){
      const found=new Map();
      for(let wx=worldLeft; wx<=worldRight; wx+=4){
        const col=cityCol(wx);
        if(col && col.city && Number.isFinite(col.city.center)){
          found.set(col.city.cell+':'+col.city.center, col.city);
        }
      }
      const out=[];
      for(const city of found.values()){
        const spec=cityPowerPlantSpec(city);
        if(!spec) continue;
        if(spec.anchor+spec.w>=worldLeft-3 && spec.anchor<=worldRight+3) out.push(spec);
      }
      return out;
    }
    function buildDynamoStructure(cx,y){
      put(cx-1,y,T.DYNAMO,true);
      put(cx,y,T.DYNAMO_SLOT,true);
      put(cx+1,y,T.DYNAMO,true);
      carve(cx,y-1);
      carve(cx-1,y-1);
      carve(cx+1,y-1);
    }
    function buildPowerPlant(spec){
      if(!spec) return;
      const anchor=spec.anchor, w=spec.w, h=spec.h, seed=spec.seed;
      let baseY=Infinity;
      for(let dx=0; dx<w; dx++){
        const c=cityCol(anchor+dx);
        if(c) baseY=Math.min(baseY,c.row);
      }
      if(!Number.isFinite(baseY)) return;
      const deckY=baseY-1;
      const roofY=Math.max(3,baseY-h);
      const midY=baseY-5;
      for(let dx=-1; dx<=w; dx++){
        const wx=anchor+dx;
        const col=cityCol(wx);
        if(!col) continue;
        const localGround=col.row;
        for(let y=baseY; y<=Math.min(WORLD_H-4,localGround+2); y++) put(wx,y,(dx%7===0)?T.STEEL:T.STONE,true);
        for(let y=roofY; y<=deckY; y++){
          const edge=dx<=0 || dx>=w-1;
          const support=dx%11===0 || dx===Math.floor(w*0.42) || dx===Math.floor(w*0.68);
          const roof=y===roofY || y===roofY+1;
          const floor=y===deckY || y===midY;
          if(edge || support || roof || floor){
            put(wx,y,(support||edge||roof)?T.STEEL:T.STONE,true);
          } else if(y>roofY+1 && y<deckY){
            carve(wx,y);
            const windowBand=y>=roofY+3 && y<=roofY+5 && dx>3 && dx<w-4;
            if(windowBand && dx%4!==0 && WG.randSeed(wx*0.71+y*1.37+seed)>0.48) put(wx,y,T.GLASS,true);
            else putBg(wx,y,T.STEEL); // turbine hall back wall
          }
        }
      }
      const turbineY=deckY-1;
      const dynCenters=spec.dynamos===2
        ? [anchor+Math.floor(w*0.36), anchor+Math.floor(w*0.64)]
        : [anchor+Math.floor(w*0.50)];
      for(const cx0 of dynCenters){
        buildDynamoStructure(cx0,turbineY);
        put(cx0-2,turbineY,T.STEEL,true);
        put(cx0+2,turbineY,T.STEEL,true);
        put(cx0,turbineY+1,T.STEEL,true);
      }
      const vendNear=dynCenters[0]+2;
      if(cityCol(vendNear)){
        put(vendNear,turbineY,T.VENDING_MACHINE,true);
        put(vendNear,turbineY+1,T.STEEL,true);
      }
      const cableY=Math.max(roofY+3,turbineY-3);
      for(let dx=4; dx<w-4; dx+=3){
        if(WG.randSeed((anchor+dx)*0.47+seed)>0.18) put(anchor+dx,cableY,T.WIRE,true);
      }
      const controlX=anchor+Math.floor(w*0.78);
      put(controlX,turbineY,T.ELECTRONICS,true);
      put(anchor+3,turbineY,T.TORCH,true);
      put(anchor+w-4,turbineY,T.TORCH,true);
      const stackX=anchor+w-6;
      const stackBase=roofY+1;
      for(let y=stackBase-1; y>=Math.max(2,stackBase-12); y--){
        put(stackX,y,(y%3===0)?T.OBSIDIAN:T.STEEL,true);
        if(y<stackBase-3 && y%2===0) put(stackX+1,y,T.OBSIDIAN,true);
      }
      put(stackX-1,Math.max(2,stackBase-12),T.OBSIDIAN,true);
      put(stackX,Math.max(2,stackBase-13),T.OBSIDIAN,true);
      const towerX=anchor+5;
      for(let y=deckY-1; y>=Math.max(2,deckY-11); y--){
        const span=Math.max(1,Math.floor((deckY-y)/4));
        put(towerX-span,y,T.STONE,true);
        put(towerX+span,y,T.STONE,true);
        if(y%3===0) put(towerX,y,T.GLASS,true);
        else carve(towerX,y);
      }
      for(let dx=-3; dx<=3; dx++) put(towerX+dx,deckY,T.STEEL,true);
      const mastX=anchor+Math.floor(w*0.18);
      for(let y=roofY-1; y>=Math.max(2,roofY-8); y--) put(mastX,y,T.STEEL,true);
      put(mastX-2,roofY-5,T.STEEL,true);
      put(mastX+2,roofY-5,T.STEEL,true);
      put(mastX-1,roofY-6,T.WIRE,true);
      put(mastX+1,roofY-6,T.WIRE,true);
    }
    // Continuous subway/service tunnels under city districts.
    for(let lx=0; lx<CHUNK_W; lx++){
      const wx=worldLeft+lx;
      const col=cityCol(wx); if(!col) continue;
      const tunnelY=col.row+5+Math.floor(WG.valueNoise(wx,190,9411)*3);
      for(let y=tunnelY-2; y<=tunnelY+2; y++){
        if(y===tunnelY-2) put(wx,y,WG.randSeed(wx*1.03)>0.78?T.STEEL:T.STONE,true);
        else if(y===tunnelY+2) put(wx,y,WG.randSeed(wx*0.91)>0.66?T.STEEL:T.OBSIDIAN,true);
        else { carve(wx,y); putBg(wx,y,T.STONE); } // lined subway bore
      }
      if(((wx+Math.floor(WG.worldSeed||0))%13)===0) maybeWire(wx,tunnelY-1,wx*0.119+17.3,0.45,true);
      if(WG.randSeed(wx*0.083+41.7)<0.0008) put(wx,tunnelY+1,T.ELECTRONICS,false);
      if(((wx+Math.floor(WG.worldSeed||0))%31)===0) put(wx,tunnelY-1,T.TORCH,true);
      if(WG.randSeed(wx*0.071)>0.986){
        for(let dx=0; dx<5; dx++){
          put(wx+dx,tunnelY+1,T.STEEL,true);
          put(wx+dx,tunnelY,T.AIR,true);
          if(dx===0||dx===4) put(wx+dx,tunnelY-1,T.STEEL,true);
        }
      }
    }
    const pitch=18;
    const first=Math.floor((worldLeft-60)/pitch)-1;
    const last=Math.ceil((worldRight+60)/pitch)+1;
    for(let cell=first; cell<=last; cell++){
      const anchor=cell*pitch + Math.floor(WG.randSeed(cell*31.17+7.1)*7)-3;
      const col=cityCol(anchor); if(!col || col.volcano) continue;
      const city=col.city || {density:0.72,decay:0.6,skyline:0.5};
      const r=WG.randSeed(cell*17.33+2.9);
      if(r>city.density){
        buildCivicLot(cell,anchor,city);
        continue;
      }
      const arch=cityArch(city);
      const env=skylineEnvelope(city,anchor);
      const styleRoll=WG.randSeed(cell*23.7+(city.skyline||0.5));
      const style=pickStyle(arch,styleRoll);
      if(style==='monument'){ buildMonument(anchor,cell); continue; }
      if(style==='spire'){
        const sh=Math.max(10,Math.min(34,Math.round((16+WG.randSeed(cell*5.91)*16)*env)));
        buildSpire(anchor,sh,cell,city);
        continue;
      }
      if(style==='ziggurat'){
        const zh=Math.max(9,Math.min(18,Math.round((12+WG.randSeed(cell*5.91)*6)*env)));
        buildZiggurat(anchor,zh,cell,city,false);
        continue;
      }
      const wBase=style==='factory'?22:(style==='tower'?9:12);
      const hBase=style==='factory'?9:(style==='tower'?26:16);
      const w=wBase+Math.floor(WG.randSeed(cell*3.19)*10);
      const h=Math.max(6,Math.min(38,Math.round((hBase+Math.floor(WG.randSeed(cell*5.91)*(18+(city.skyline||0.5)*10)))*env)));
      buildFrame(anchor,w,h,cell,style);
      const ground=col.row;
      const bridgeChance=arch===4?0.62:(arch===1?0.52:(arch===2?0.42:(arch===0?0.30:0.22)));
      if(WG.randSeed(cell*2.41)<bridgeChance){
        const bridgeY=ground-7-Math.floor(WG.randSeed(cell*1.61)*7);
        const len=10+Math.floor(WG.randSeed(cell*1.93)*14);
        for(let dx=w-1; dx<w+len; dx++){
          const wx=anchor+dx;
          if(!cityCol(wx)) continue;
          put(wx,bridgeY,T.STEEL,true);
          if(dx%4===0) put(wx,bridgeY-1,T.STONE,true);
          if(dx%9===0 && WG.randSeed(wx*0.51+bridgeY*1.7+cell)<0.25) put(wx,bridgeY-2,T.WIRE,false);
        }
        // Support pylons: an unpropped far end is a long cantilever and sheds
        // during the settle audit instead of reading as an elevated skyway.
        const pylons=[anchor+w+len-1];
        if(len>12) pylons.push(anchor+w+(len>>1));
        for(const px of pylons){
          const c=cityCol(px);
          if(!c || c.row<=bridgeY) continue;
          for(let y=bridgeY+1; y<c.row; y++) put(px,y,((y-bridgeY)%3===0)?T.STEEL:T.STONE,true);
        }
      }
      if(WG.randSeed(cell*4.73)>0.50){
        const lampX=anchor-2;
        const c=cityCol(lampX);
        if(c){
          for(let y=c.row-1; y>=c.row-4; y--) put(lampX,y,T.STEEL,true);
          put(lampX,c.row-5,T.TORCH,true);
        }
      }
      if(arch===2 && WG.randSeed(cell*6.17+0.9)>0.55){
        // Street-level pipe runs between foundry structures.
        const pipeLen=4+Math.floor(WG.randSeed(cell*7.9+1.3)*5);
        for(let dx=-pipeLen; dx<0; dx++){
          const wx=anchor+dx;
          const c=cityCol(wx); if(!c) continue;
          put(wx,c.row-1,T.STEEL,true);
          if(dx===-pipeLen || dx===-1) put(wx,c.row-2,T.OBSIDIAN,true);
        }
      }
    }
    for(const lm of collectCityLandmarks()) buildLandmark(lm);
    for(const plant of collectCityPlants()) buildPowerPlant(plant);
  }

  // --- Atlantis: rare seed-driven cities on sealed ocean floors --------------
  // These are deliberately built above WG.oceanSealTop(). The bedrock basin still
  // owns everything below the sediment bed, while the city uses the water column
  // and seabed as an explorable, boat-worthy destination.
  const ATLANTIS_CELL_W = 720;
  const ATLANTIS_SCAN_PAD = 84;
  const ATLANTIS_SAFE_RADIUS = 700;
  const ATLANTIS_MIN_DEPTH = 28;
  const ATLANTIS_MIN_BASIN_WIDTH = 180;
  function atlantisReplaceableTile(t){
    return isGeneratedStructureReplaceableTile(t) ||
      t===T.SAND || t===T.STONE || t===T.GRANITE || t===T.BASALT || t===T.CLAY || t===T.WET_CLAY ||
      t===T.DIRT || t===T.MUD || t===T.COAL || t===T.ICE ||
      t===T.GLASS || t===T.OBSIDIAN || t===T.STEEL || t===T.BRICK || t===T.CHIMNEY ||
      t===T.WIRE || t===T.COPPER_WIRE || t===T.SILVER_WIRE || t===T.WATER_PIPE || isLadderInfrastructureTile(t);
  }
  function protectedAtlantisTile(t){
    return t===T.BEDROCK || t===T.LAVA || t===T.ALTAR || t===T.VOLCANO_MASTER_STONE ||
      t===T.SERVANT_STONE || t===T.MOTHER_ICE || t===T.MOTHER_LAVA ||
      t===T.CHEST_COMMON || t===T.CHEST_RARE || t===T.CHEST_EPIC;
  }
  function atlantisCandidateForCell(cell){
    const gen=MM.worldGen || WG;
    if(!gen || !gen.column || !gen.oceanBasinAt || !gen.oceanSealTop || !gen.randSeed) return null;
    if(gen.randSeed(cell*31.731+2401)<0.76) return null;
    const center=Math.round((cell+0.5)*ATLANTIS_CELL_W + (gen.randSeed(cell*19.173+2402)-0.5)*ATLANTIS_CELL_W*0.56);
    if(Math.abs(center)<ATLANTIS_SAFE_RADIUS) return null;
    const sea=(gen.settings && gen.settings.seaLevel!==undefined) ? gen.settings.seaLevel : 62;
    const basin=gen.oceanBasinAt(center);
    if(!basin || basin.width<ATLANTIS_MIN_BASIN_WIDTH) return null;
    if(center<basin.left+ATLANTIS_SCAN_PAD || center>basin.right-ATLANTIS_SCAN_PAD) return null;
    const col=gen.column(center);
    if(!col || col.volcano || col.biome!==5 || col.row<sea+ATLANTIS_MIN_DEPTH) return null;
    let minFloor=Infinity, maxFloor=-Infinity, sumFloor=0, samples=0;
    for(let dx=-36; dx<=36; dx+=4){
      const wx=center+dx;
      const c=gen.column(wx);
      if(!c || c.biome!==5 || c.row<sea+ATLANTIS_MIN_DEPTH-5 || !gen.oceanBasinAt(wx)) return null;
      minFloor=Math.min(minFloor,c.row);
      maxFloor=Math.max(maxFloor,c.row);
      sumFloor+=c.row;
      samples++;
    }
    if(samples<8 || maxFloor-minFloor>10) return null;
    const style=Math.floor(gen.randSeed(cell*7.317+2403)*3);
    const width=56 + Math.floor(gen.randSeed(cell*11.113+2404)*22);
    return {cell, center, basin, sea, baseFloor:Math.round(sumFloor/samples), radius:width, style};
  }
  function atlantisSiteWithTravelFields(site,origin,dir,distance){
    const left=Math.round(site.center-site.radius);
    const right=Math.round(site.center+site.radius);
    const entry=dir<0 ? right : (dir>0 ? left : (origin<left ? left : (origin>right ? right : Math.round(site.center))));
    return {cell:site.cell, center:site.center, left, right, entry, distance, basin:site.basin, sea:site.sea, baseFloor:site.baseFloor, radius:site.radius, style:site.style};
  }
  function atlantisDistanceForDirection(site,origin,dir){
    const left=Math.round(site.center-site.radius);
    const right=Math.round(site.center+site.radius);
    if(dir<0) return right<origin-2 ? origin-right : null;
    if(dir>0) return left>origin+2 ? left-origin : null;
    if(origin<left) return left-origin;
    if(origin>right) return origin-right;
    return 0;
  }
  function nearestAtlantisSite(originX,dir,maxDistance){
    const origin=Number.isFinite(originX) ? Math.round(originX) : 0;
    dir=dir<0 ? -1 : (dir>0 ? 1 : 0);
    const limit=(Number.isFinite(maxDistance) && maxDistance>0) ? Math.floor(maxDistance) : 120000;
    const baseCell=Math.floor(origin/ATLANTIS_CELL_W);
    const cellPad=Math.ceil(limit/ATLANTIS_CELL_W)+4;
    let best=null;
    for(let cell=baseCell-cellPad; cell<=baseCell+cellPad; cell++){
      const site=atlantisCandidateForCell(cell);
      if(!site) continue;
      const distance=atlantisDistanceForDirection(site,origin,dir);
      if(distance==null || distance>limit) continue;
      if(!best || distance<best.distance || (distance===best.distance && Math.abs(site.center-origin)<Math.abs(best.center-origin))){
        best=atlantisSiteWithTravelFields(site,origin,dir,distance);
      }
    }
    return best;
  }
  function applyAtlantis(arr,cx){
    const gen=MM.worldGen || WG;
    if(!gen || !gen.column || !gen.oceanSealTop) return;
    const worldLeft=cx*CHUNK_W;
    const worldRight=worldLeft+CHUNK_W-1;
    const minCell=Math.floor((worldLeft-ATLANTIS_CELL_W)/ATLANTIS_CELL_W)-1;
    const maxCell=Math.floor((worldRight+ATLANTIS_CELL_W)/ATLANTIS_CELL_W)+1;
    for(let cell=minCell; cell<=maxCell; cell++){
      const site=atlantisCandidateForCell(cell);
      if(!site || site.center+site.radius<worldLeft-2 || site.center-site.radius>worldRight+2) continue;
      buildAtlantisSite(arr,cx,site);
    }
  }
  function buildAtlantisSite(arr,cx,site){
    const gen=MM.worldGen || WG;
    const worldLeft=cx*CHUNK_W;
    const floorAt=wx=>gen.column(wx).row;
    const rand=(salt)=>gen.randSeed(site.cell*43.77+salt);
    let bgArr=null;
    const put=(wx,y,t,force)=>{
      wx=Math.floor(wx); y=Math.floor(y);
      const lx=wx-worldLeft;
      if(lx<0 || lx>=CHUNK_W || y<0 || y>=WORLD_H) return false;
      if(isChestTile(t)) return false;
      const sealTop=gen.oceanSealTop(wx);
      if(sealTop==null || y>=sealTop) return false;
      const i=tileIndex(lx,y);
      const cur=arr[i];
      if(protectedAtlantisTile(cur) || (force ? !atlantisReplaceableTile(cur) : !isGeneratedStructureReplaceableTile(cur))) return false;
      arr[i]=t;
      return true;
    };
    const putBg=(wx,y,t)=>{
      wx=Math.floor(wx); y=Math.floor(y);
      const lx=wx-worldLeft;
      if(lx<0 || lx>=CHUNK_W || y<0 || y>=WORLD_H || !isConstructionBackgroundTile(t)) return false;
      const sealTop=gen.oceanSealTop(wx);
      if(sealTop==null || y>=sealTop) return false;
      const front=arr[tileIndex(lx,y)];
      if(front!==T.AIR && front!==T.WATER && front!==T.TORCH && front!==T.GLOWSHROOM && front!==T.WIRE && front!==T.COPPER_WIRE && front!==T.SILVER_WIRE && front!==T.WATER_PIPE) return false;
      if(!bgArr){
        bgArr=generatedBackground.get(ck(cx));
        if(!bgArr){ bgArr=new Uint8Array(CHUNK_W*WORLD_H); generatedBackground.set(ck(cx),bgArr); genBgInvalidate(); }
      }
      bgArr[tileIndex(lx,y)]=t;
      return true;
    };
    const atlantisBackTile=(salt)=>{
      if(site.style===0) return salt%3===0 ? T.OBSIDIAN : T.STONE;
      if(site.style===1) return salt%2===0 ? T.STEEL : T.GLASS;
      return salt%4===0 ? T.BRICK : T.STEEL;
    };
    const carve=(wx,y,bgSalt)=>{
      const ok=put(wx,y,T.AIR,false);
      if(ok) putBg(wx,y,atlantisBackTile(bgSalt==null ? wx+y : bgSalt));
      return ok;
    };
    const domeShellTile=(dx,dy,edge)=>{
      if(edge || Math.abs(dx)%7===0 || Math.abs(dy)%5===0) return T.OBSIDIAN;
      return (site.style===1 && Math.abs(dx)%4===0) ? T.STEEL : T.GLASS;
    };
    const buildDome=(center,rx,ry,salt)=>{
      for(let dx=-rx; dx<=rx; dx++){
        const wx=center+dx;
        const floor=floorAt(wx);
        const baseY=floor-1;
        for(let y=baseY-ry-1; y<=baseY; y++){
          const ndx=dx/rx;
          const ndy=(y-baseY)/ry;
          const n=ndx*ndx+ndy*ndy;
          if(y===baseY && Math.abs(dx)<=rx-1){
            put(wx,y,(Math.abs(dx)>rx-3 || Math.abs(dx)%6===0) ? T.OBSIDIAN : T.STEEL,true);
          }else if(n<=1.08 && n>=0.74){
            put(wx,y,domeShellTile(dx,y-baseY,Math.abs(dx)>rx-2),true);
          }else if(n<0.74){
            carve(wx,y,salt+dx+y);
          }
        }
        if(Math.abs(dx)===rx || dx===0 || (Math.abs(dx)+salt)%9===0){
          for(let y=baseY+1; y<=floor+2; y++) put(wx,y,T.OBSIDIAN,true);
        }
      }
    };
    const buildTube=(x1,x2,drop,salt)=>{
      const step=x1<=x2 ? 1 : -1;
      for(let wx=x1; step>0 ? wx<=x2 : wx>=x2; wx+=step){
        const floor=floorAt(wx);
        const cy=Math.min(floor-4, site.baseFloor-drop);
        put(wx,cy-1,((wx+salt)%6===0)?T.OBSIDIAN:T.GLASS,true);
        carve(wx,cy,salt+wx);
        put(wx,cy+1,((wx+salt)%5===0)?T.STEEL:T.GLASS,true);
        if(Math.abs((wx-site.center+salt)%10)<=1){
          for(let y=cy+2; y<=floor+2; y++) put(wx,y,T.OBSIDIAN,true);
        }
      }
    };
    const buildSpire=(wx,height,salt)=>{
      const floor=floorAt(wx);
      const top=floor-height;
      for(let y=top; y<=floor-2; y++){
        put(wx,y,(y+salt)%4===0?T.GLASS:T.OBSIDIAN,true);
        if((y+salt)%5===0){
          for(let dx=-3; dx<=3; dx++){
            if(Math.abs(dx)===3 || dx===0) put(wx+dx,y,T.GLASS,true);
          }
        }
      }
      put(wx,top-1,rand(2500+salt)>0.74 ? T.ANTIGRAVITY_BEACON : T.SOLAR_BATTERY,true);
    };
    const buildVault=(wx,salt)=>{
      const floor=floorAt(wx);
      const baseY=floor-1;
      const topY=baseY-8;
      for(let dx=-10; dx<=10; dx++){
        for(let y=topY; y<=baseY; y++){
          const arch=Math.abs(dx)/10 + Math.max(0,(topY+3-y))/9;
          const edge=Math.abs(dx)>=9 || y===topY || y===baseY || arch>1.03;
          const pillar=(Math.abs(dx)===5 && y>=topY+2) || (Math.abs(dx)===1 && y>=topY+4 && y<=baseY-2);
          if(edge || pillar) put(wx+dx,y,pillar?T.STEEL:T.OBSIDIAN,true);
          else carve(wx+dx,y,700+salt+dx+y);
        }
      }
      put(wx-10,baseY-3,T.STEEL_DOOR,true);
      put(wx+10,baseY-3,T.STEEL_DOOR,true);
      put(wx-6,baseY-2,T.GLOWSHROOM,false);
      put(wx+6,baseY-2,T.GLOWSHROOM,false);
      for(let y=topY-5; y<topY; y++) put(wx,y,(y+salt)%2===0?T.GLASS:T.OBSIDIAN,true);
      put(wx,topY-6,T.ANTIGRAVITY_BEACON,true);
    };
    const buildOuterShrine=(wx,salt)=>{
      const floor=floorAt(wx);
      const top=floor-7-Math.floor(rand(4100+salt)*3);
      for(let y=top; y<=floor-1; y++){
        put(wx,y,(y+salt)%3===0?T.GLASS:T.OBSIDIAN,true);
        if((y+salt)%4===0){ put(wx-2,y,T.GLASS,true); put(wx+2,y,T.GLASS,true); }
      }
      put(wx-1,floor-2,T.GLOWSHROOM,false);
      put(wx+1,floor-2,T.GLOWSHROOM,false);
      if(rand(4200+salt)>0.68) put(wx,floor-3,T.CHEST_RARE,true);
    };
    const c=site.center;
    const domes=[
      {x:c,rx:12+Math.floor(rand(1)*4),ry:11+Math.floor(rand(2)*3),salt:1},
      {x:c-22-Math.floor(rand(3)*7),rx:8,ry:8,salt:2},
      {x:c+23+Math.floor(rand(4)*7),rx:8+Math.floor(rand(5)*2),ry:8,salt:3},
      {x:c-43-Math.floor(rand(6)*6),rx:6,ry:7,salt:4},
      {x:c+44+Math.floor(rand(7)*6),rx:6,ry:7,salt:5}
    ];
    for(let i=0; i<domes.length-1; i++) buildTube(domes[i].x,domes[i+1].x,4+(i%2),i*3);
    for(const d of domes) buildDome(d.x,d.rx,d.ry,d.salt);
    buildVault(c,17);
    for(let wx=c-site.radius; wx<=c+site.radius; wx++){
      const floor=floorAt(wx);
      const rel=Math.abs(wx-c)/Math.max(1,site.radius);
      if(rel<=1 && rand(wx*0.017+9)>rel*0.42){
        put(wx,floor-1,(Math.abs(wx-c)%11===0)?T.OBSIDIAN:T.STEEL,true);
        if(Math.abs(wx-c)%13===0) put(wx,floor,T.OBSIDIAN,true);
      }
    }
    buildSpire(c,18+Math.floor(rand(20)*5),0);
    buildSpire(c-31,13+Math.floor(rand(21)*4),4);
    buildSpire(c+33,14+Math.floor(rand(22)*4),8);
    buildOuterShrine(c-site.radius+10,31);
    buildOuterShrine(c+site.radius-10,37);
    const treasureY=site.baseFloor-2;
    put(c,treasureY,T.CHEST_EPIC,true);
    put(c-3,treasureY,T.CHEST_RARE,true);
    put(c+4,treasureY,T.CHEST_RARE,true);
    put(c,treasureY-2,T.IRIDIUM,true);
    put(c-7,treasureY-1,T.METEORIC_IRON,true);
    put(c+8,treasureY-1,T.METEORIC_IRON,true);
    if(rand(30)>0.52) put(c+13,treasureY-2,T.ANTIMATTER_CRYSTAL,true);
    for(const d of domes){
      const floor=floorAt(d.x);
      put(d.x-2,floor-2,T.GLOWSHROOM,false);
      put(d.x+2,floor-2,T.GLOWSHROOM,false);
      if(rand(100+d.salt)>0.66) put(d.x,floor-3,T.CHEST_RARE,true);
    }
  }

  // Sealed ocean basin: every column of a wide water segment turns to unmineable
  // bedrock from a thin sediment bed under the sea floor down to the chunk bottom
  // (world_layers.deepTile continues the same seal through the deep sections).
  function applyOceanBasinSeal(arr,cx){
    if(!WG.oceanSealTop) return;
    for(let lx=0; lx<CHUNK_W; lx++){
      const wx=cx*CHUNK_W+lx;
      const sealTop=WG.oceanSealTop(wx);
      if(sealTop==null) continue;
      for(let y=Math.max(0,sealTop); y<WORLD_H; y++) arr[tileIndex(lx,y)]=T.BEDROCK;
    }
  }
  function ensureChunk(cx){ const k=ck(cx); if(world.has(k)) return world.get(k); const arr=new Uint8Array(CHUNK_W*WORLD_H);
    const S=WG.settings||{};
    const SEA=(S.seaLevel===undefined)?62:S.seaLevel;
    for(let lx=0; lx<CHUNK_W; lx++){
      const wx=cx*CHUNK_W+lx;
      const col=WG.column(wx); const s=col.row; const biome=col.biome;
      const bf=WG.biomeFrac(wx,3);
      const slope=Math.abs(colHeight(wx+1)-colHeight(wx-1))/2;
      // Cold cover: snow biome, snowy neighborhood, or altitude above the snow line (jittered)
      const cold = biome===2 || bf[2]>0.35 || s < SNOW_LINE + Math.floor(WG.randSeed(wx*1.13)*5-2);
      const desertF=bf[3], waterF=bf[5]+bf[6];
      const beach=col.beach && biome!==5 && biome!==6;
      // Subsoil sand thickness: deserts deep, beaches sandy, water beds clay/dirt from generation.
      let sandTh;
      if(biome===3) sandTh = SAND_DEPTH + Math.floor(WG.randSeed(wx*0.37)*4) - 1;
      else if(beach) sandTh = 3 + Math.floor(WG.randSeed(wx*0.41)*3);
      else if(biome===5 || biome===6) sandTh = 0;
      else if(biome===4) sandTh = 3 + Math.floor(WG.randSeed(wx*0.47)*2);
      else if(biome===8) sandTh = 4;
      else sandTh = (desertF>0.15 || waterF>0.15)? 2 : 0;
      const dirtTh=dirtThickness(wx,biome,beach,desertF,waterF);
      // Perched valley lake (above sea level); flooded valleys below sea use the global fill
      let lakeRow=Infinity;
      if(biome===6 && col.elev>2) lakeRow=lakeLevelFor(wx);
      // Swamp pools: sink the floor two tiles under a pool mask
      let poolDepth=0;
      if(biome===4){
        const pool=WG.valueNoise(wx,26,3301);
        if(pool>0.64) poolDepth=3;
        else if(pool>0.53) poolDepth=2;
        else if(pool>0.47 && WG.valueNoise(wx,11,3306)>0.66) poolDepth=1;
      }
      const ground=s+poolDepth;
      const waterBed=(s>SEA || biome===5 || biome===6) && biome!==4;
      const frostDepth=waterBed || lakeRow!==Infinity ? 0 : groundFrostDepth(col,wx);
      const surfaceHazard=naturalSurfaceHazardKind(wx,biome,beach,desertF,cold,slope,waterBed,lakeRow!==Infinity,poolDepth,!!col.volcano);
      // Cave carve pass for this column (includes ravines/entrances opening the surface)
      COL_CARVE.fill(0);
      for(let y=ground;y<WORLD_H;y++){ COL_CARVE[y]=WG.caveAt(wx,y,col); }

      for(let y=0;y<WORLD_H;y++){
        let t=T.AIR;
        const forcedVolcano=volcanoForcedTile(col,wx,y,ground);
        if(forcedVolcano!==undefined){ arr[tileIndex(lx,y)]=forcedVolcano; continue; }
        if(y<ground){
          // Open sky / surface water
          if(y>=s){ t=T.WATER; }                              // swamp pool cell
          else if(s>SEA && y>=SEA){ t=T.WATER; }              // ocean & flooded valleys
          else if(y>=lakeRow){ t=T.WATER; }                   // perched valley lake
          if(t===T.WATER && cold){
            const wTop=(s>SEA)?SEA:(lakeRow!==Infinity?lakeRow:s);
            if(y<=wTop+1 && WG.randSeed(wx*5.5+y*0.4)<0.9) t=T.ICE; // frozen surface crust
          }
        } else {
          const depth=y-ground;
          const inVolcanoMass=col.volcano && volcanoDistance(col,wx)<=col.volcano.radius;
          const cv=inVolcanoMass?0:COL_CARVE[y];
          if(cv===1){ t=T.AIR; }
          else if(cv===2){ t=T.WATER; }
          else {
            const volcanicRock=volcanoRockTile(col,wx,y,ground,depth);
            if(volcanicRock!==undefined) t=volcanicRock;
            else if(depth<SURFACE_GRASS_DEPTH){
            // Surface material. Water beds are born as clay/dirt so the player
            // never sees sand flash in and then convert under lakes/seas.
            if((s>SEA || biome===5 || biome===6 || lakeRow!==Infinity) && biome!==4)
              t=(WG.randSeed(wx*4.19+depth*0.31)<(biome===6 || lakeRow!==Infinity ? 0.62 : 0.46)) ? T.CLAY : T.DIRT; // sea/lake bed
            else if(biome===8) t=citySurfaceTile(WG,wx,depth);
            else if(biome===4) t=swampGroundTile(wx,depth,poolDepth);
            else if(biome===3 || beach) t=T.SAND;
            else if(cold) t=T.SNOW;
            else if(slope>=3 || (biome===7 && col.pv>0.62)) t=T.STONE;          // cliffs & crests
            else if(biome===7) t=(WG.randSeed(wx*2.9)<0.5)?T.STONE:T.GRASS;     // rocky slopes
            else if(desertF>0.25) t=(WG.randSeed(wx*2.31)<Math.min(0.5,desertF*0.8))?T.SAND:T.GRASS;
            else t=T.GRASS;
            t=applyNaturalSurfaceHazard(t,depth,surfaceHazard);
            } else if(depth<SURFACE_GRASS_DEPTH+sandTh){
            t=biome===8 ? citySurfaceTile(WG,wx,depth) : (biome===4 ? swampGroundTile(wx,depth,poolDepth) : ((cold && depth<3)? T.SNOW : T.SAND));
            if(t===T.SAND && depth>2 && WG.randSeed(wx*9.71+y*0.23)<0.18) t=T.STONE;
            if(t===T.SAND && depth>=2 && (biome===5 || biome===6 || lakeRow!==Infinity || waterF>0.35) && WG.randSeed(wx*4.19+y*0.31)<0.045) t=T.CLAY;
            t=applyNaturalSurfaceHazard(t,depth,surfaceHazard);
            } else if(depth<SURFACE_GRASS_DEPTH+sandTh+dirtTh){
            t=biome===8 ? citySurfaceTile(WG,wx,depth) : T.DIRT;
            } else {
            // Stone mass; diamonds stay rare and bedrockward, coal forms more common seams
            // through ordinary underground rock and is richer beside cave walls.
            const nearCave=(COL_CARVE[y-1]||COL_CARVE[y+1]);
            const chance=WG.diamondChance(y)*(nearCave?3:1);
            if(WG.randSeed(wx*13.37+y*0.7)<chance) t=T.DIAMOND;
            else if(WG.coalVeinAt && WG.coalVeinAt(wx,y,nearCave)) t=T.COAL;
            else if(WG.silverVeinAt && WG.silverVeinAt(wx,y,nearCave)) t=T.SILVER_ORE;
            else if(WG.goldVeinAt && WG.goldVeinAt(wx,y,nearCave)) t=T.GOLD_ORE;
            else t=geologyRockTile(wx,y,depth,biome);
            if(biome!==8 && t===T.STONE && depth<SURFACE_GRASS_DEPTH+sandTh+2 && WG.randSeed(wx*9.71+y*0.23)<(0.10+0.5*(desertF+waterF*0.5))) t=T.SAND;
            }
            if(frostDepth>0 && depth<frostDepth) t=frostBindTile(t);
          }
        }
        arr[tileIndex(lx,y)]=t;
      }
    }
    // Trees are populated after base terrain; tree code uses deterministic RNG so caching heights is safe
    if(MM.trees && MM.trees.populateChunk){ MM.trees.populateChunk(arr,cx); }
    applyUndergroundBiomeDressing(arr,cx);
    applyDevastatedCity(arr,cx);
    applySurfaceTemples(arr,cx);
    placeStructures(arr,cx);
    applyAtlantis(arr,cx);
    // Buried ruin complexes are anchor-based (they may span chunk borders) and
    // applied last: carved interiors and masonry win over terrain/trees/chests
    if(RUINS && RUINS.applyToChunk) RUINS.applyToChunk(arr,cx);
    if(ALIEN_RUINS && ALIEN_RUINS.applyToChunk) ALIEN_RUINS.applyToChunk(arr,cx);
    // Ocean bedrock basins are reasserted over terrain, caves, dressing and ruins
    // so nothing generated above can open a tunnel under a real ocean. Story
    // guardian passes run later and may still win — a rare lair pocket beats a
    // broken story beat, and a pocket is not a crossing.
    applyOceanBasinSeal(arr,cx);
    reinforceVolcanoConduits(arr,cx);
    if(GUARDIANS && GUARDIANS.applyToChunk) GUARDIANS.applyToChunk(arr,cx);
    if(UNDERGROUND && UNDERGROUND.applyToChunk) UNDERGROUND.applyToChunk(arr,cx);
    try{ if(SKY_GUARDIAN && SKY_GUARDIAN.applyToChunk) SKY_GUARDIAN.applyToChunk(arr,cx); }catch(e){}
    try{ if(CENTER_GUARDIAN && CENTER_GUARDIAN.applyToChunk) CENTER_GUARDIAN.applyToChunk(arr,cx); }catch(e){}
    if(AFTERMATH && AFTERMATH.applyToChunk) AFTERMATH.applyToChunk(arr,cx);
    try{ if(MM.trees && MM.trees.pruneChunk) MM.trees.pruneChunk(arr,cx); }catch(e){}
    // Chests are reward entities now, never procedural terrain. This final
    // scrub also covers third-party/story structure passes applied above.
    stripChestTiles(arr);
    world.set(k,arr); markModifiedChunk(cx,0);
    if(world.size>CHUNK_CAP) evictFarChunks();
    auditCityStructuralStability(arr,cx);
    // A new chunk may carve caves right beside existing dormant water (or bring its own
    // water beside existing caves) — queue a boundary wake so the fluid sim reacts.
    try{ if(MM.water && MM.water.noteChunkGenerated) MM.water.noteChunkGenerated(cx*CHUNK_W, cx*CHUNK_W+CHUNK_W-1); }catch(e){}
    registerGeneratedLava(arr,cx);
    return arr; }

  function skyTile(wx,y,sy){ return WORLD_LAYERS.skyTile(WG,wx,y,sy); }
  function deepTile(wx,y){ return WORLD_LAYERS.deepTile(WG,wx,y); }
  function generateVerticalSection(cx,sy){
    const arr=new Uint8Array(SECTION_SIZE);
    for(let lx=0; lx<CHUNK_W; lx++){
      const wx=cx*CHUNK_W+lx;
      for(let ly=0; ly<WORLD_SECTION_H; ly++){
        const y=sectionOriginY(sy)+ly;
        const t=sy<0 ? skyTile(wx,y,sy) : deepTile(wx,y);
        arr[tileIndex(lx,ly)]=t;
      }
    }
    try{ if(UNDERGROUND && UNDERGROUND.applyToSection) UNDERGROUND.applyToSection(arr,cx,sy); }catch(e){}
    try{ if(SKY_GUARDIAN && SKY_GUARDIAN.applyToSection) SKY_GUARDIAN.applyToSection(arr,cx,sy); }catch(e){}
    return stripChestTiles(arr);
  }
  // --- Hot-path section-view cache -------------------------------------------
  // getTile runs hundreds of thousands of times per second (fluid sim, fire glow,
  // structural audits, companion scans). The old path built a string key AND
  // allocated a fresh subarray view per call — allocation churn that dominated
  // CPU profiles. Views are deterministic per (chunk, section): cache them under
  // a packed numeric key and drop the cache whenever a chunk array is deleted or
  // replaced (creating a NEW chunk never invalidates other entries).
  const sectionViews=new Map();
  const viewKey=(cx,sy)=>cx*8+(sy-WORLD_MIN_SECTION); // section index 0..5 < 8: unique per cx
  function ensureSection(cx,sy){
    sy=Number.isFinite(sy) ? Math.floor(sy) : 0;
    if(sy<WORLD_MIN_SECTION || sy>WORLD_MAX_SECTION) return null;
    const vk=viewKey(cx,sy);
    const cached=sectionViews.get(vk);
    if(cached) return cached;
    let arr;
    if(isBaseSection(sy)){
      const base=ensureChunk(cx);
      arr=base.subarray(sy*SECTION_SIZE, Math.min(base.length,(sy+1)*SECTION_SIZE));
    }else{
      const k=ckSection(cx,sy);
      arr=world.get(k);
      if(!arr){
        arr=generateVerticalSection(cx,sy);
        world.set(k,arr);
        markModifiedChunk(cx,0,sy);
        if(world.size>CHUNK_CAP) evictFarChunks();
      }
    }
    if(arr) sectionViews.set(vk,arr);
    return arr;
  }

  // --- Underground biome dressing: additive re-skin of freshly generated
  // caves so the deep world inherits the surface biome's character. Runs
  // before cities/structures/ruins (they overwrite where they build). Pure
  // per-cell (worldSeed via WG.randSeed), chunk-local neighbor checks only —
  // border columns dress slightly sparser, which reads as natural taper.
  //   snow (2): cave-adjacent STONE frosts to ICE, ceilings sprout icicles.
  //             Only STONE converts — granite/basalt/coal strata stay pinned.
  //   forest (0) / swamp (4): mid-depth cave floors sprout GLOWSHROOMS —
  //             bioluminescent lighting emitters, so mushroom chambers glow.
  function undergroundDressingRock(t){
    return t===T.STONE || t===T.GRANITE || t===T.BASALT || t===T.OBSIDIAN || t===T.DIRT || t===T.MUD || t===T.CLAY || t===T.WET_CLAY;
  }
  function undergroundDressingFloor(t){
    return undergroundDressingRock(t) || t===T.SAND || t===T.SNOW || t===T.ICE || t===T.COAL || t===T.STEEL || t===T.BRICK ||
      t===T.FROZEN_DIRT || t===T.FROZEN_SAND || t===T.FROZEN_CLAY;
  }
  function undergroundDressingOpen(t){
    return t===T.AIR || t===T.WATER || t===T.LAVA || t===T.HOT_AIR || t===T.STEAM || t===T.POISON_GAS || t===T.FUEL_GAS || t===T.GLOWSHROOM;
  }
  function applyUndergroundBiomeDressing(arr,cx){
    const WG=MM.worldGen; if(!WG || !WG.column) return;
    for(let lx=0; lx<CHUNK_W; lx++){
      const wx=cx*CHUNK_W+lx;
      const col=WG.column(wx);
      const biome=col.biome;
      const icy=biome===2;
      const foresty=biome===0;
      const desert=biome===3 || col.beach;
      const swamp=biome===4;
      const wet=biome===5 || biome===6;
      const mountain=biome===7;
      const city=biome===8 || !!col.city;
      const volcanic=!!col.volcano;
      if(!icy && !foresty && !desert && !swamp && !wet && !mountain && !city && !volcanic) continue;
      const s=col.row;
      const at=(dlx,y)=>{ const x=lx+dlx; return (x>=0&&x<CHUNK_W&&y>=0&&y<WORLD_H) ? arr[tileIndex(x,y)] : -1; };
      const touchesOpen=(y)=> undergroundDressingOpen(at(-1,y)) || undergroundDressingOpen(at(1,y)) || undergroundDressingOpen(at(0,y-1)) || undergroundDressingOpen(at(0,y+1));
      const touchesWater=(y)=> at(-1,y)===T.WATER || at(1,y)===T.WATER || at(0,y-1)===T.WATER || at(0,y+1)===T.WATER;
      if(volcanic){
        const y0=Math.max(0,s+4), y1=Math.min(WORLD_H-3,s+72);
        for(let y=y0;y<=y1;y++){
          const i=tileIndex(lx,y), t=arr[i];
          if(t===T.AIR){
            const above=at(0,y-1), below=at(0,y+1);
            const r=WG.randSeed(wx*6.417+y*19.19);
            if(undergroundDressingRock(above) && r<0.055) arr[i]=T.HOT_AIR;
            else if((below===T.WATER || touchesWater(y)) && r>0.93) arr[i]=T.STEAM;
          } else if(t===T.STONE && touchesOpen(y) && WG.randSeed(wx*8.191+y*31.77)<0.62){
            arr[i]=WG.randSeed(wx*4.73+y*0.19)<0.16 ? T.OBSIDIAN : T.BASALT;
          }
        }
      }
      if(icy){
        const y0=Math.max(0,s+3), y1=Math.min(WORLD_H-2,s+26);
        for(let y=y0;y<=y1;y++){
          const i=tileIndex(lx,y);
          if(arr[i]===T.STONE){
            if((at(-1,y)===T.AIR||at(1,y)===T.AIR||at(0,y-1)===T.AIR||at(0,y+1)===T.AIR) && WG.randSeed(wx*12.9898+y*78.233)<0.75) arr[i]=T.ICE;
          } else if(arr[i]===T.AIR && at(0,y+1)===T.AIR){
            const above=at(0,y-1);
            if((above===T.ICE||above===T.STONE||above===T.SNOW||above===T.FROZEN_DIRT||above===T.FROZEN_SAND||above===T.FROZEN_CLAY) && WG.randSeed(wx*3.7717+y*41.117)<0.08) arr[i]=T.ICE; // hanging icicle
          }
        }
      }
      if(foresty || swamp){
        const y0=Math.max(0,s+6), y1=Math.min(WORLD_H-2,s+40);
        for(let y=y0;y<=y1;y++){
          const i=tileIndex(lx,y);
          const t=arr[i];
          if(t===T.AIR && at(0,y-1)===T.AIR){
            const floor=at(0,y+1);
            if(undergroundDressingFloor(floor) && WG.randSeed(wx*9.1131+y*57.719)<(swamp?0.17:0.14)) arr[i]=T.GLOWSHROOM;
            if(swamp && arr[i]===T.AIR && undergroundDressingFloor(floor) && WG.randSeed(wx*5.619+y*73.13)<0.045) arr[i]=T.POISON_GAS;
          } else if(swamp && (t===T.STONE || t===T.DIRT || t===T.CLAY) && touchesOpen(y) && WG.randSeed(wx*2.771+y*43.17)<0.13){
            arr[i]=WG.randSeed(wx*11.9+y*0.67)<0.56 ? T.WET_CLAY : T.MUD;
          }
        }
      }
      if(desert){
        const y0=Math.max(0,s+7), y1=Math.min(WORLD_H-3,s+52);
        for(let y=y0;y<=y1;y++){
          const i=tileIndex(lx,y), t=arr[i];
          if(t===T.AIR && undergroundDressingFloor(at(0,y+1))){
            const floorIdx=tileIndex(lx,y+1);
            const r=WG.randSeed(wx*13.337+y*29.711);
            if((arr[floorIdx]===T.STONE || arr[floorIdx]===T.GRANITE || arr[floorIdx]===T.BASALT || arr[floorIdx]===T.DIRT) && r<0.105){
              arr[floorIdx]=r<0.023 ? T.UNSTABLE_SAND : T.SAND;
            }
            if(arr[i]===T.AIR && r>0.972) arr[i]=T.FUEL_GAS;
          } else if(t===T.STONE && touchesOpen(y) && WG.randSeed(wx*4.517+y*61.71)<0.20){
            arr[i]=T.SAND;
          }
        }
      }
      if(wet){
        const y0=Math.max(0,s+4), y1=Math.min(WORLD_H-3,s+46);
        for(let y=y0;y<=y1;y++){
          const i=tileIndex(lx,y), t=arr[i];
          if((t===T.STONE || t===T.GRANITE || t===T.DIRT) && (touchesWater(y) || touchesOpen(y)) && WG.randSeed(wx*7.019+y*37.113)<0.30){
            arr[i]=WG.randSeed(wx*2.41+y*0.53)<0.58 ? T.WET_CLAY : T.CLAY;
          }
        }
      }
      if(mountain && !volcanic){
        const y0=Math.max(0,s+5), y1=Math.min(WORLD_H-3,s+64);
        for(let y=y0;y<=y1;y++){
          const i=tileIndex(lx,y), t=arr[i];
          if(t===T.STONE && touchesOpen(y) && WG.randSeed(wx*10.37+y*45.23)<0.34) arr[i]=T.GRANITE;
          else if(t===T.GRANITE && touchesOpen(y) && WG.randSeed(wx*12.77+y*67.89)<0.035) arr[i]=T.DIAMOND;
        }
      }
      if(city){
        const y0=Math.max(0,s+6), y1=Math.min(WORLD_H-3,s+58);
        for(let y=y0;y<=y1;y++){
          const i=tileIndex(lx,y), t=arr[i];
          const r=WG.randSeed(wx*17.37+y*41.91);
          if(t===T.AIR && undergroundDressingFloor(at(0,y+1)) && r<0.040) arr[i]=T.POISON_GAS;
          else if((t===T.STONE || t===T.GRANITE || t===T.BASALT) && touchesOpen(y)){
            if(r>0.988) arr[i]=T.RADIOACTIVE_ORE;
            else if(r>0.948) arr[i]=T.STEEL;
          }
        }
      }
    }
  }

  const SURFACE_TEMPLE_SPACING = 240;
  const SURFACE_TEMPLE_CACHE_CAP = 256;
  const surfaceTempleCache = new Map();
  const SURFACE_TEMPLE_TREASURE = Object.freeze({
    [T.CHEST_RARE]:true, [T.CHEST_EPIC]:true, [T.GOLD_ORE]:true, [T.DIAMOND]:true
  });
  const SURFACE_TEMPLE_STRUCTURE = Object.freeze({
    [T.STONE]:true, [T.OBSIDIAN]:true, [T.WOOD]:true, [T.LEAF]:true,
    [T.TORCH]:true, [T.GLOWSHROOM]:true, [T.CHEST_RARE]:true, [T.CHEST_EPIC]:true,
    [T.GOLD_ORE]:true, [T.DIAMOND]:true
  });
  function isSurfaceTempleTreasureTile(t){ return !!SURFACE_TEMPLE_TREASURE[t]; }
  function isSurfaceTempleStructureTile(t){ return !!SURFACE_TEMPLE_STRUCTURE[t]; }
  function surfaceTempleJungleColumn(col){
    if(!col || col.volcano || col.city || col.beach || col.ravine>0) return false;
    if(col.biome===4) return true;
    return col.biome===0 && col.m>0.50 && col.t>0.42 && col.elev<22;
  }
  function surfaceTempleCellLayout(n){
    n=Math.floor(n);
    if(surfaceTempleCache.has(n)) return surfaceTempleCache.get(n);
    if(surfaceTempleCache.size>SURFACE_TEMPLE_CACHE_CAP) surfaceTempleCache.clear();
    const r=(salt)=>WG.randSeed(n*917.33+salt);
    if(r(1.1)>0.72){ surfaceTempleCache.set(n,null); return null; }
    const ax=Math.round(n*SURFACE_TEMPLE_SPACING + (r(2.2)-0.5)*SURFACE_TEMPLE_SPACING*0.48);
    const col=WG.column(ax);
    if(!surfaceTempleJungleColumn(col)){ surfaceTempleCache.set(n,null); return null; }
    const width=21 + Math.floor(r(3.3)*10)*2;
    const half=Math.floor(width/2);
    let minS=999, maxS=-999;
    for(let dx=-half-4; dx<=half+4; dx+=2){
      const c=WG.column(ax+dx);
      if(!surfaceTempleJungleColumn(c)){ surfaceTempleCache.set(n,null); return null; }
      minS=Math.min(minS,c.row);
      maxS=Math.max(maxS,c.row);
    }
    if(maxS-minS>3){ surfaceTempleCache.set(n,null); return null; }
    const floor=Math.round((minS+maxS)/2)-1;
    const tiers=2+Math.floor(r(4.4)*3);
    const variant=Math.floor(r(5.5)*4);
    const ops=[];
    const put=(x,y,t,force=true)=>{ if(!isChestTile(t)) ops.push({x,y,t,f:force?1:0}); };
    const archStep=variant===2?5:4;
    for(let dx=-half; dx<=half; dx++){
      const wx=ax+dx;
      const local=Math.abs(dx);
      const lip=(local>half-3)?1:0;
      put(wx,floor+1,T.STONE,true);
      put(wx,floor,T.STONE,true);
      if((dx+half)%archStep===0 || Math.abs(dx)===half-1){
        const ph=3+Math.floor(r(40+dx)*3);
        for(let h=1; h<=ph; h++) put(wx,floor-h, h===ph && variant===1 ? T.OBSIDIAN : T.WOOD,true);
        put(wx,floor-ph-1,T.LEAF,false);
      } else if(lip && r(70+dx)>0.35){
        put(wx,floor-1,T.LEAF,false);
      } else if(r(80+dx)>0.78){
        put(wx,floor-1,T.GLOWSHROOM,false);
      }
    }
    for(let tier=0; tier<tiers; tier++){
      const y=floor-2-tier*3;
      const span=half-3-tier*3;
      for(let dx=-span; dx<=span; dx++){
        const roof=Math.abs(dx)>span-3;
        if(roof || (dx+tier)%2===0) put(ax+dx,y, roof?T.LEAF:T.WOOD,false);
      }
      put(ax-span,y+1,T.TORCH,false);
      put(ax+span,y+1,T.TORCH,false);
      if(tier<tiers-1){
        put(ax-span+2,y+1,T.WOOD,true);
        put(ax+span-2,y+1,T.WOOD,true);
      }
    }
    const altarY=floor-1;
    for(let dx=-2; dx<=2; dx++) put(ax+dx,altarY,T.OBSIDIAN,true);
    put(ax,altarY-1, r(11.1)>0.22 ? T.CHEST_EPIC : T.CHEST_RARE,true);
    put(ax-1,altarY-1,T.TORCH,false);
    put(ax+1,altarY-1,T.TORCH,false);
    if(variant===3 || r(12.2)>0.72){
      put(ax-3,altarY-1,T.GOLD_ORE,true);
      put(ax+3,altarY-1,T.DIAMOND,true);
    }
    for(let i=0;i<4;i++){
      const side=i<2?-1:1;
      const dx=side*(half-3-Math.floor(r(90+i)*4));
      const y=floor-2-Math.floor(r(95+i)*3);
      put(ax+dx,y,T.LEAF,false);
      put(ax+dx+side,y+1,T.GLOWSHROOM,false);
    }
    const L={n, ax, floor, variant, tiers, minX:ax-half, maxX:ax+half, minY:floor-2-tiers*3, maxY:floor+1, ops};
    surfaceTempleCache.set(n,L);
    return L;
  }
  function surfaceTempleLayoutsInRange(x0,x1){
    const out=[];
    const n0=Math.floor((x0-SURFACE_TEMPLE_SPACING)/SURFACE_TEMPLE_SPACING);
    const n1=Math.floor((x1+SURFACE_TEMPLE_SPACING)/SURFACE_TEMPLE_SPACING);
    for(let n=n0; n<=n1; n++){
      const L=surfaceTempleCellLayout(n);
      if(L && L.maxX>=x0 && L.minX<=x1) out.push(L);
    }
    return out;
  }
  function applySurfaceTemples(arr,cx){
    const x0=cx*CHUNK_W, x1=x0+CHUNK_W-1;
    for(const L of surfaceTempleLayoutsInRange(x0,x1)){
      for(const op of L.ops){
        if(op.x<x0 || op.x>x1 || op.y<0 || op.y>=WORLD_H) continue;
        const idx=tileIndex(op.x-x0,op.y);
        if(op.f || isReplaceableNaturalOpenTile(arr[idx],false) || arr[idx]===T.GRASS || arr[idx]===T.GRASS_SNOW || arr[idx]===T.SAND || arr[idx]===T.FROZEN_SAND || arr[idx]===T.MUD) arr[idx]=op.t;
      }
    }
  }
  function surfaceTempleAt(x,y,opts){
    if(!Number.isFinite(x) || !Number.isFinite(y)) return null;
    x=Math.floor(x); y=Math.floor(y);
    const layouts=surfaceTempleLayoutsInRange(x-1,x+1);
    for(const L of layouts){
      if(x<L.minX || x>L.maxX || y<L.minY || y>L.maxY) continue;
      let hit=null;
      for(const op of L.ops){ if(op.x===x && op.y===y){ hit=op; break; } }
      if(!hit) continue;
      const tile=(opts && typeof opts.tile==='number') ? opts.tile : hit.t;
      if(!isSurfaceTempleStructureTile(tile)) continue;
      return {
        n:L.n, ax:L.ax, variant:L.variant, tiers:L.tiers, surface:true,
        minX:L.minX, maxX:L.maxX, minY:L.minY, maxY:L.maxY,
        opTile:hit.t, tile, isTreasure:isSurfaceTempleTreasureTile(tile), isStructure:isSurfaceTempleStructureTile(tile)
      };
    }
    return null;
  }

  // --- Procedural structures: rare deterministic ruins (land) and shipwrecks
  // (sea floor), each sheltering a loot chest. One structure per eligible chunk,
  // anchored away from the chunk edges so it never spans a boundary.
  function placeStructures(arr,cx){
    const WG=MM.worldGen; if(!WG || !WG.column) return;
    const gate=WG.randSeed(cx*13.37+5.1);
    if(gate>=0.10) return;                       // ~10% of chunks roll a structure
    const lx0=8+Math.floor(WG.randSeed(cx*7.77+2.2)*(CHUNK_W-24));
    const wx0=cx*CHUNK_W+lx0;
    const col=WG.column(wx0);
    if(col.volcano) return;
    const put=(lx,y,t)=>{ if(isChestTile(t)) return; if(lx>=0&&lx<CHUNK_W&&y>=0&&y<WORLD_H){ const i=tileIndex(lx,y); if(isReplaceableNaturalOpenTile(arr[i],false)||t===T.AIR) arr[i]=t; } };
    if(col.biome===5){
      // shipwreck: a broken wooden hull resting on the seabed with an epic chest
      const s=col.row;
      if(s<((WG.settings&&WG.settings.seaLevel)||62)+4) return;  // needs real depth
      for(let dx=-4;dx<=4;dx++){
        const yy=s-1-Math.max(0,2-Math.abs(Math.abs(dx)-2));     // shallow hull curve
        for(let y=yy;y<s;y++) if(Math.abs(dx)>=3||y===yy) put(lx0+dx,y,T.WOOD);
      }
      put(lx0-1,s-2,T.AIR); put(lx0,s-2,T.AIR); put(lx0+1,s-2,T.AIR); // cargo hold
      put(lx0,s-2,T.CHEST_EPIC);
      put(lx0+2,s-5,T.WOOD); put(lx0+2,s-4,T.WOOD); put(lx0+2,s-3,T.WOOD); // broken mast
      return;
    }
    if(col.biome===5||col.biome===6||col.biome===8||col.beach||col.ravine>0) return;
    const s=col.row;
    const sL=WG.column(wx0-3).row, sR=WG.column(wx0+3).row;
    if(Math.abs(sL-s)>2 || Math.abs(sR-s)>2) return;            // flat ground only
    if(WG.randSeed(cx*17.71+9.4)<0.14){
      // summoning altar (~1.4% of chunks): torch-lit obsidian dais with the
      // ritual stone — click it with the offering to call a gargantuan boss
      // (engine/altar.js owns the ritual; the tile itself is indestructible)
      for(let dx=-2;dx<=2;dx++) put(lx0+dx,s-1,T.OBSIDIAN);
      put(lx0-2,s-2,T.OBSIDIAN); put(lx0+2,s-2,T.OBSIDIAN);
      put(lx0-2,s-3,T.TORCH);    put(lx0+2,s-3,T.TORCH);
      put(lx0,s-2,T.ALTAR);
      return;
    }
    // ruin: broken stone pillars + a partial wall around a rare chest
    const h1=2+Math.floor(WG.randSeed(wx0*1.3)*3), h2=2+Math.floor(WG.randSeed(wx0*2.7)*3);
    for(let i=1;i<=h1;i++) put(lx0-3,s-i,T.STONE);
    for(let i=1;i<=h2;i++) put(lx0+3,s-i,T.STONE);
    put(lx0-2,s-1,T.STONE); put(lx0+2,s-1,T.STONE);             // crumbled wall stubs
    if(WG.randSeed(wx0*3.9)<0.5) put(lx0-3,s-h1-1,T.STONE);     // surviving lintel piece
    const r=WG.randSeed(wx0*5.5);
    put(lx0,s-1, r>0.7? T.CHEST_EPIC : T.CHEST_RARE);
  }

  // NaN/Infinity coordinates slip past `y<0||y>=WORLD_H` (NaN compares false) and
  // runaway x used to mint chunks without bound — both are treated as void here.
  function getTile(x,y){
    if(!isFinite(x) || !Number.isFinite(Number(y)) || Math.abs(x)>MAX_COORD) return T.AIR;
    y=Math.floor(y);
    if(!worldYInBounds(y)) return y>=WORLD_MAX_Y ? T.BEDROCK : T.AIR;
    const cx=Math.floor(x/CHUNK_W), sy=sectionYFor(y), ly=sectionLocalY(y,sy);
    const lx=((x%CHUNK_W)+CHUNK_W)%CHUNK_W;
    // fast path: cached numeric-key view — no string keys, no subarray allocation
    const arr=sectionViews.get(viewKey(cx,sy)) || ensureSection(cx,sy);
    return arr ? arr[ly*CHUNK_W+lx] : T.AIR;
  }
  function normalizeInfrastructureStack(v){
    const out=[];
    const arr=Array.isArray(v) ? v : [v];
    for(const t of arr){
      if(!isInfrastructureTile(t) || out.includes(t)) continue;
      if(isLadderInfrastructureTile(t) && out.some(isLadderInfrastructureTile)) continue;
      out.push(t);
    }
    return out;
  }
  // Shared empty stack: overlay maps are usually tiny or empty, yet these getters
  // sit on per-frame scan paths (network tiles, turret/solar probes) — the old
  // code built a string key and allocated fresh arrays per call even for misses.
  const EMPTY_STACK=[];
  function getInfrastructureStack(x,y){
    if(infrastructure.size===0) return EMPTY_STACK;
    if(!worldYInBounds(y) || !isFinite(x) || Math.abs(x)>MAX_COORD) return EMPTY_STACK;
    const raw=infrastructure.get(key(x,y));
    if(raw===undefined) return EMPTY_STACK;
    return normalizeInfrastructureStack(raw);
  }
  function getInfrastructure(x,y){
    const stack=getInfrastructureStack(x,y);
    return stack.length ? stack[stack.length-1] : T.AIR;
  }
  function hasInfrastructure(x,y,t){
    if(infrastructure.size===0 || !isInfrastructureTile(t)) return false;
    return getInfrastructureStack(x,y).includes(t);
  }
  // Hot path: called per visible tile by the renderer and per audited cell by the
  // falling engine — keep the empty-layer exits allocation-free and cache the last
  // chunk array lookup (render scans are column-sequential).
  let genBgLastCx=NaN, genBgLastArr=null;
  function genBgInvalidate(){ genBgLastCx=NaN; genBgLastArr=null; }
  function genBackgroundAt(x,y){
    if(generatedBackground.size===0) return T.AIR;
    if(!isFinite(x) || !isFinite(y)) return T.AIR;
    x=Math.floor(x); y=Math.floor(y);
    if(y<0 || y>=WORLD_H || Math.abs(x)>MAX_COORD) return T.AIR;
    const cx=Math.floor(x/CHUNK_W);
    if(cx!==genBgLastCx){
      genBgLastCx=cx;
      genBgLastArr=generatedBackground.get(ck(cx))||null;
    }
    if(!genBgLastArr) return T.AIR;
    const t=genBgLastArr[tileIndex(((x%CHUNK_W)+CHUNK_W)%CHUNK_W,y)];
    return t || T.AIR;
  }
  function getConstructionBackground(x,y){
    if(constructionBackground.size===0 && generatedBackground.size===0) return T.AIR;
    if(!worldYInBounds(y) || !isFinite(x) || Math.abs(x)>MAX_COORD) return T.AIR;
    if(constructionBackground.size>0){
      const k=key(x,y);
      if(constructionBackground.has(k)){
        // An explicit non-buildable entry (T.AIR) is a tombstone left where the
        // player mined out a generated backdrop cell — it must stay empty.
        const t=constructionBackground.get(k);
        return isConstructionBackgroundTile(t) ? t : T.AIR;
      }
    }
    return genBackgroundAt(x,y);
  }
  function getPlayerConstructionBackground(x,y){
    if(constructionBackground.size===0) return T.AIR;
    if(!worldYInBounds(y) || !isFinite(x) || Math.abs(x)>MAX_COORD) return T.AIR;
    const t=constructionBackground.get(key(x,y));
    return isConstructionBackgroundTile(t) ? t : T.AIR;
  }
  function getNetworkTile(x,y){
    const over=getInfrastructure(x,y);
    return over!==T.AIR ? over : getTile(x,y);
  }
  function peekTile(x,y,fallback){
    if(!worldYInBounds(y) || !isFinite(x) || Math.abs(x)>MAX_COORD) return T.AIR;
    y=Math.floor(y);
    const cx=Math.floor(x/CHUNK_W), sy=sectionYFor(y), ly=sectionLocalY(y,sy);
    const lx=((x%CHUNK_W)+CHUNK_W)%CHUNK_W;
    const view=sectionViews.get(viewKey(cx,sy));
    if(view) return view[ly*CHUNK_W+lx];
    const arr=world.get(isBaseSection(sy) ? ck(cx) : ckSection(cx,sy));
    if(!arr) return fallback===undefined ? T.AIR : fallback;
    return getTileRaw(arr,lx,isBaseSection(sy)?y:ly);
  }
  function peekNetworkTile(x,y,fallback){
    const over=getInfrastructure(x,y);
    if(over!==T.AIR) return over;
    return peekTile(x,y,fallback);
  }
  function notifyTileChanged(x,y,old,v){
    try{ if(MM.ghostHostTile) MM.ghostHostTile(x,y,old,v); }catch(e){} // spectator diff capture (ghost_host.js)
    try{ if(MM.trees && MM.trees.onTileChanged) MM.trees.onTileChanged(x,y,old,v); }catch(e){}
    try{ if(MM.meat && MM.meat.onTileChanged) MM.meat.onTileChanged(x,y,old,v); }catch(e){}
    try{ if(MM.gases && MM.gases.onTileChanged) MM.gases.onTileChanged(x,y,old,v); }catch(e){}
    try{ if(MM.smoke && MM.smoke.onTileChanged) MM.smoke.onTileChanged(x,y,old,v,getTile); }catch(e){}
    try{ if(MM.dynamo && MM.dynamo.onTileChanged) MM.dynamo.onTileChanged(x,y,old,v); }catch(e){}
    try{ if(MM.solar && MM.solar.onTileChanged) MM.solar.onTileChanged(x,y,old,v); }catch(e){}
    try{ if(MM.furnishings && MM.furnishings.onTileChanged) MM.furnishings.onTileChanged(x,y,old,v,getTile); }catch(e){}
    try{ if(MM.teleporters && MM.teleporters.onTileChanged) MM.teleporters.onTileChanged(x,y,old,v); }catch(e){}
    try{ if(MM.pumps && MM.pumps.onTileChanged) MM.pumps.onTileChanged(x,y,old,v); }catch(e){}
    try{ if(MM.steamMachines && MM.steamMachines.onTileChanged) MM.steamMachines.onTileChanged(x,y,old,v); }catch(e){}
    try{ if(MM.turrets && MM.turrets.onTileChanged) MM.turrets.onTileChanged(x,y,old,v); }catch(e){}
    try{ if(MM.meteorites && MM.meteorites.onTileChanged) MM.meteorites.onTileChanged(x,y,old,v); }catch(e){}
    try{ if(MM.companions && MM.companions.onTileChanged) MM.companions.onTileChanged(x,y,old,v,getTile,setTile); }catch(e){}
  }
  function notifyInfrastructureChanged(x,y,old,v){
    const oldStack=normalizeInfrastructureStack(old);
    const nextStack=normalizeInfrastructureStack(v);
    const changed=new Set([...oldStack,...nextStack]);
    for(const t of changed){
      const had=oldStack.includes(t), has=nextStack.includes(t);
      if(had===has) continue;
      const from=had ? t : T.AIR;
      const to=has ? t : T.AIR;
      try{ if(MM.teleporters && MM.teleporters.onTileChanged) MM.teleporters.onTileChanged(x,y,from,to); }catch(e){}
      try{ if(MM.pumps && MM.pumps.onTileChanged) MM.pumps.onTileChanged(x,y,from,to); }catch(e){}
    }
  }
  function setInfrastructureInternal(x,y,v,transient,removeOnly){
    if(!worldYInBounds(y) || !isFinite(x) || Math.abs(x)>MAX_COORD) return false;
    x=Math.floor(x); y=Math.floor(y);
    const item=isInfrastructureTile(v) ? v : T.AIR;
    const k=key(x,y);
    const old=normalizeInfrastructureStack(infrastructure.get(k));
    let next;
    if(item===T.AIR) next=[];
    else if(removeOnly) next=old.filter(t=>t!==item);
    else if(isLadderInfrastructureTile(item) && old.some(isLadderInfrastructureTile)) next=old.slice();
    else next=old.includes(item) ? old.slice() : old.concat(item);
    if(old.length===next.length && old.every((t,i)=>t===next[i])) return false;
    if(!next.length) infrastructure.delete(k);
    else infrastructure.set(k,next);
    notifyInfrastructureChanged(x,y,old,next);
    if(!transient){
      markModifiedChunk(Math.floor(x/CHUNK_W),null,sectionYFor(y));
      // overlays bake into chunk canvases too — record a partial dirty band so
      // the version bump doesn't force a full-section rebake
      try{ if(MM.onTileRenderChanged) MM.onTileRenderChanged(x,y,T.AIR,T.AIR); }catch(e){}
    }
    return true;
  }
  function setInfrastructure(x,y,v){ return setInfrastructureInternal(x,y,v,false); }
  function clearInfrastructure(x,y,v){
    if(isInfrastructureTile(v)) return setInfrastructureInternal(x,y,v,false,true);
    return setInfrastructureInternal(x,y,T.AIR,false);
  }
  function setConstructionBackgroundInternal(x,y,v,transient){
    if(!worldYInBounds(y) || !isFinite(x) || Math.abs(x)>MAX_COORD) return false;
    x=Math.floor(x); y=Math.floor(y);
    if(v!==T.AIR && !isConstructionBackgroundTile(v)) return false;
    const item=v===T.AIR ? T.AIR : v;
    const k=key(x,y);
    const old=getConstructionBackground(x,y);
    if(old===item) return false;
    if(item===T.AIR){
      if(genBackgroundAt(x,y)!==T.AIR) constructionBackground.set(k,T.AIR); // tombstone over generated backdrop
      else constructionBackground.delete(k);
    }
    else constructionBackground.set(k,item);
    if(!transient){
      markModifiedChunk(Math.floor(x/CHUNK_W),null,sectionYFor(y));
      try{ if(MM.onTileRenderChanged) MM.onTileRenderChanged(x,y,T.AIR,T.AIR); }catch(e){}
    }
    return true;
  }
  function setConstructionBackground(x,y,v){ return setConstructionBackgroundInternal(x,y,v,false); }
  function clearConstructionBackground(x,y){ return setConstructionBackgroundInternal(x,y,T.AIR,false); }
  function setTileInternal(x,y,v,transient){
    if(!worldYInBounds(y) || !isFinite(x) || Math.abs(x)>MAX_COORD) return;
    if(isInfrastructureTile(v)){ setInfrastructureInternal(x,y,v,transient); return; }
    if(isChestTile(v)){
      // Runtime reward code written against the old tile API is upgraded in
      // place to a physical chest instead of reintroducing a solid block. This
      // compatibility path must never erase terrain already occupying the cell.
      try{
        if(MM.drops && typeof MM.drops.spawnChest==='function'){
          MM.drops.spawnChest(Math.floor(x)+0.5,Math.floor(y)+0.35,chestTierForTile(v),{source:'legacy_reward'});
        }
      }catch(e){}
      return;
    }
    const cx=Math.floor(x/CHUNK_W);
    const lx=((x%CHUNK_W)+CHUNK_W)%CHUNK_W;
    y=Math.floor(y);
    const sy=sectionYFor(y), ly=sectionLocalY(y,sy);
    const arr=ensureSection(cx,sy);
    if(!arr) return;
    const idx=tileIndex(lx,ly);
    if(arr[idx]===v) return;
    const old=arr[idx];
    arr[idx]=v;
    notifyTileChanged(x,y,old,v);
    if(!transient){
      markModifiedChunk(cx,null,sy);
      // render-cache hook (main.js): runs for EVERY real tile edit — including
      // engines that call world.setTile directly (plants, trees, seasons) — so
      // the renderer can record a partial dirty band instead of falling back to
      // a full chunk rebake when it only sees a version bump
      try{ if(MM.onTileRenderChanged) MM.onTileRenderChanged(x,y,old,v); }catch(e){}
    }
  }
  function setTile(x,y,v){ setTileInternal(x,y,v,false); }
  // Transient world-backed layers (currently gases) need to be visible to getTile()
  // without turning every drift step into terrain-save churn or chunk-cache invalidation.
  function setTransientTile(x,y,v){ setTileInternal(x,y,v,true); }
  function snapshotInfrastructure(){
    const list=[];
    for(const [k,raw] of infrastructure.entries()){
      const stack=normalizeInfrastructureStack(raw);
      if(!stack.length) continue;
        const comma=k.indexOf(',');
      const x=+k.slice(0,comma), y=+k.slice(comma+1);
      for(const t of stack) list.push({x,y,t});
    }
    const clean=list
      .filter(o=>isInfrastructureTile(o.t) && isFinite(o.x) && isFinite(o.y) && worldYInBounds(o.y))
      .sort((a,b)=>(a.x-b.x)||(a.y-b.y)||(a.t-b.t))
      .slice(0,INFRASTRUCTURE_SAVE_CAP);
    return {v:2,list:clean};
  }
  function restoreInfrastructure(data){
    infrastructure.clear();
    if(!data || !Array.isArray(data.list)) return;
    const limit=Math.min(data.list.length,INFRASTRUCTURE_SAVE_CAP);
    for(let i=0;i<limit;i++){
      const raw=data.list[i];
      if(!raw || !isInfrastructureTile(raw.t)) continue;
      if(!isFinite(raw.x) || !isFinite(raw.y)) continue;
      const x=Math.floor(raw.x), y=Math.floor(raw.y);
      if(!worldYInBounds(y) || Math.abs(x)>MAX_COORD) continue;
      const k=key(x,y);
      const stack=normalizeInfrastructureStack(infrastructure.get(k));
      if(!stack.includes(raw.t)) infrastructure.set(k,stack.concat(raw.t));
      markModifiedChunk(Math.floor(x/CHUNK_W),null,sectionYFor(y));
    }
    try{ if(MM.teleporters && MM.teleporters.onTileChanged) MM.teleporters.onTileChanged(0,0,T.AIR,T.COPPER_WIRE); }catch(e){}
    try{ if(MM.pumps && MM.pumps.onTileChanged) MM.pumps.onTileChanged(0,0,T.AIR,T.WATER_PIPE); }catch(e){}
  }
  function snapshotConstructionBackground(){
    const list=[];
    for(const [k,t] of constructionBackground.entries()){
      const comma=k.indexOf(',');
      const x=+k.slice(0,comma), y=+k.slice(comma+1);
      if(isConstructionBackgroundTile(t)) list.push({x,y,t});
      else list.push({x,y,t:0}); // tombstone: mined-out generated backdrop stays empty
    }
    const clean=list
      .filter(o=>(o.t===0 || isConstructionBackgroundTile(o.t)) && isFinite(o.x) && isFinite(o.y) && worldYInBounds(o.y))
      .sort((a,b)=>(a.x-b.x)||(a.y-b.y)||(a.t-b.t))
      .slice(0,CONSTRUCTION_BACKGROUND_SAVE_CAP);
    return {v:1,list:clean};
  }
  function restoreConstructionBackground(data){
    constructionBackground.clear();
    if(!data || !Array.isArray(data.list)) return;
    const limit=Math.min(data.list.length,CONSTRUCTION_BACKGROUND_SAVE_CAP);
    for(let i=0;i<limit;i++){
      const raw=data.list[i];
      if(!raw || !(raw.t===0 || isConstructionBackgroundTile(raw.t))) continue;
      if(!isFinite(raw.x) || !isFinite(raw.y)) continue;
      const x=Math.floor(raw.x), y=Math.floor(raw.y);
      if(!worldYInBounds(y) || Math.abs(x)>MAX_COORD) continue;
      constructionBackground.set(key(x,y),raw.t===0?T.AIR:raw.t);
      markModifiedChunk(Math.floor(x/CHUNK_W),null,sectionYFor(y));
    }
  }
  function clearWorld(){ try{ if(MM.trees && MM.trees.resetIdentities) MM.trees.resetIdentities(); }catch(e){} world.clear(); sectionViews.clear(); versions.clear(); modifiedChunks.clear(); infrastructure.clear(); constructionBackground.clear(); generatedBackground.clear(); genBgInvalidate(); heightCache.clear(); lakeLevels.clear(); surfaceTempleCache.clear(); if(WG.clearCaches) WG.clearCaches(); }
  // Save loading replaces whole chunk arrays: any cached section view over the
  // old array must be dropped or reads would silently hit the orphaned buffer.
  function setChunkArray(key,arr){
    const ref=normalizeChunkRef(key);
    if(!ref || !Number.isInteger(ref.cx)) return false;
    const maxChunk=Math.ceil(MAX_COORD/CHUNK_W);
    if(Math.abs(ref.cx)>maxChunk) return false;
    if(ref.base){
      if(ref.key!==ck(ref.cx)) return false;
    }else{
      if(!Number.isInteger(ref.sy) || ref.sy<WORLD_MIN_SECTION || ref.sy>WORLD_MAX_SECTION || isBaseSection(ref.sy)) return false;
      if(ref.key!==ckSection(ref.cx,ref.sy)) return false;
    }
    const expected=CHUNK_W*(ref.base ? WORLD_H : WORLD_SECTION_H);
    if(!(arr instanceof Uint8Array) || arr.length!==expected) return false;
    // Old saves may contain chest blocks. They are intentionally removed, not
    // converted: only fresh mob/reward drops populate physical chests now.
    world.set(ref.key,stripChestTiles(arr)); sectionViews.clear();
    // Save-loaded base chunks skip ensureChunk, so replay the deterministic
    // city pass in background-only mode to rebuild interior backdrops.
    if(ref.base){
      try{ applyDevastatedCity(null,ref.cx,true); }catch(e){}
    }
    return true;
  }

  worldAPI.ensureChunk = ensureChunk;
  worldAPI.ensureSection = ensureSection;
  worldAPI.setChunkArray = setChunkArray;
  worldAPI.sectionHeight = WORLD_SECTION_H;
  worldAPI.minSection = WORLD_MIN_SECTION;
  worldAPI.maxSection = WORLD_MAX_SECTION;
  worldAPI.minY = WORLD_MIN_Y;
  worldAPI.maxY = WORLD_MAX_Y;
  worldAPI.sectionYFor = sectionYFor;
  worldAPI.sectionOriginY = sectionOriginY;
  worldAPI.sectionLocalY = sectionLocalY;
  worldAPI.sectionKey = ckSection;
  worldAPI.normalizeChunkRef = normalizeChunkRef;
  worldAPI.getTile = getTile;
  worldAPI.getInfrastructure = getInfrastructure;
  worldAPI.getInfrastructureStack = getInfrastructureStack;
  worldAPI.hasInfrastructure = hasInfrastructure;
  worldAPI.getConstructionBackground = getConstructionBackground;
  worldAPI.getPlayerConstructionBackground = getPlayerConstructionBackground;
  worldAPI.getOverlay = getInfrastructure;
  worldAPI.getNetworkTile = getNetworkTile;
  worldAPI.peekTile = peekTile;
  worldAPI.peekNetworkTile = peekNetworkTile;
  worldAPI.setTile = setTile;
  worldAPI.setInfrastructure = setInfrastructure;
  worldAPI.setConstructionBackground = setConstructionBackground;
  worldAPI.setOverlay = setInfrastructure;
  worldAPI.clearInfrastructure = clearInfrastructure;
  worldAPI.clearConstructionBackground = clearConstructionBackground;
  worldAPI.clearOverlay = clearInfrastructure;
  worldAPI.setTransientTile = setTransientTile;
  worldAPI.snapshotInfrastructure = snapshotInfrastructure;
  worldAPI.restoreInfrastructure = restoreInfrastructure;
  worldAPI.snapshotConstructionBackground = snapshotConstructionBackground;
  worldAPI.restoreConstructionBackground = restoreConstructionBackground;
  worldAPI.isInfrastructureTile = isInfrastructureTile;
  worldAPI.isConstructionBackgroundTile = isConstructionBackgroundTile;
  worldAPI.clear = clearWorld;
  worldAPI.clearHeights = ()=>{ heightCache.clear(); lakeLevels.clear(); surfaceTempleCache.clear(); if(WG.clearCaches) WG.clearCaches(); };
  worldAPI.nearestAtlantis = nearestAtlantisSite;
  worldAPI.surfaceTempleAt = surfaceTempleAt;
  worldAPI.surfaceTempleLayoutsInRange = surfaceTempleLayoutsInRange;
  worldAPI.isSurfaceTempleStructureTile = isSurfaceTempleStructureTile;
  worldAPI.isSurfaceTempleTreasureTile = isSurfaceTempleTreasureTile;
  worldAPI.markModifiedChunk = markModifiedChunk;
  worldAPI.modifiedChunkIds = ()=>[...modifiedChunks]
    .map(id=>normalizeChunkRef(id))
    .filter(Boolean)
    .map(ref=>ref.base ? ref.cx : {cx:ref.cx, sy:ref.sy});
  worldAPI._world = world;
  worldAPI._versions = versions;
  worldAPI._modifiedChunks = modifiedChunks;
  worldAPI.chunkVersion = function(cx,sy){
    const ref=normalizeChunkRef({cx, sy:Number.isFinite(sy) ? sy : null});
    return ref ? (versions.get(ref.key)||0) : 0;
  };
  worldAPI.chunkArray = function(ref){
    const norm=normalizeChunkRef(ref);
    if(!norm) return null;
    if(Number.isFinite(norm.sy) && isBaseSection(norm.sy)){
      const base=world.get(ck(norm.cx));
      return base ? base.subarray(norm.sy*SECTION_SIZE, Math.min(base.length,(norm.sy+1)*SECTION_SIZE)) : null;
    }
    return world.get(norm.key)||null;
  };
  worldAPI.metrics = function(){
    return {chunks:world.size, modified:modifiedChunks.size, infrastructure:infrastructure.size, constructionBackground:constructionBackground.size, heightCache:heightCache.size, lakeCache:lakeLevels.size};
  };

  MM.world = worldAPI;
})();
// ESM export (progressive migration)
export const world = (typeof window!== 'undefined' && window.MM) ? window.MM.world : undefined;
export default world;
