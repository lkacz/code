// World storage & chunk generation
import { CHUNK_W, WORLD_H, WORLD_SECTION_H, WORLD_MIN_SECTION, WORLD_MAX_SECTION, WORLD_MIN_Y, WORLD_MAX_Y, T, SNOW_LINE, SURFACE_GRASS_DEPTH, SAND_DEPTH } from '../constants.js';
import {
  generatedCityStructuralTile,
  generatedCitySupportTile,
  isGeneratedStructureReplaceableTile,
  isLavaExposureOpenTile,
  isObjectFootingTile,
  isPlayerBuiltMaterial,
  isReplaceableNaturalOpenTile,
  isRockStructuralMaterial
} from './material_physics.js';
import { worldGen as WORLDGEN } from './worldgen.js';
import { worldLayers as WORLD_LAYERS } from './world_layers.js';
import { ruins as RUINS } from './ruins.js';
import { guardianLairs as GUARDIANS } from './guardian_lairs.js';
import { undergroundBoss as UNDERGROUND } from './underground_boss.js';
import { guardianAftermath as AFTERMATH } from './guardian_aftermath.js';
window.MM = window.MM || {};
(function(){
  const WG = WORLDGEN;
  const worldAPI = {};
  const world = new Map();
  const versions = new Map(); // chunk key -> version number for render cache invalidation
  const modifiedChunks = new Set();
  const infrastructure = new Map(); // "x,y" -> overlay tile stack (wire / copper cable / water pipe / ladder)
  const constructionBackground = new Map(); // "x,y" -> passable building support/decor tile
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
  function isInfrastructureTile(t){ return t===T.WIRE || t===T.COPPER_WIRE || t===T.WATER_PIPE || t===T.LADDER; }
  function isConstructionBackgroundTile(t){ return isPlayerBuiltMaterial(t); }
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
    if(biome===3 || beach || biome===5 || biome===6) return 0;
    if(biome===4) return 2 + Math.floor(WG.randSeed(wx*0.53)*2);
    if(biome===7) return 1 + Math.floor(WG.randSeed(wx*0.61)*2);
    return 3 + Math.floor(WG.randSeed(wx*0.67)*3) + (desertF>0.10 || waterF>0.10 ? 1 : 0);
  }
  function geologyRockTile(wx,y,depth,biome){
    return WORLD_LAYERS.legacyGeologyRockTile(WG,wx,y,depth,biome);
  }
  function isCaveTreasureFloor(t){
    return isRockStructuralMaterial(t) && isObjectFootingTile(t);
  }

  function applyDevastatedCity(arr,cx){
    const WG=MM.worldGen; if(!WG || !WG.column) return;
    const worldLeft=cx*CHUNK_W, worldRight=worldLeft+CHUNK_W-1;
    const put=(wx,y,t,force)=>{
      if(wx<worldLeft || wx>worldRight || y<0 || y>=WORLD_H-3) return false;
      const lx=wx-worldLeft, idx=tileIndex(lx,y), cur=arr[idx];
      if(force || isGeneratedStructureReplaceableTile(cur)){
        arr[idx]=t;
        return true;
      }
      return false;
    };
    const carve=(wx,y)=>{
      if(wx<worldLeft || wx>worldRight || y<0 || y>=WORLD_H-3) return;
      const idx=tileIndex(wx-worldLeft,y), cur=arr[idx];
      if(cur!==T.LAVA && cur!==T.CHEST_COMMON && cur!==T.CHEST_RARE && cur!==T.CHEST_EPIC) arr[idx]=T.AIR;
    };
    const cityCol=(wx)=>{ const col=WG.column(wx); return col && col.biome===8 ? col : null; };
    const cityTile=(wx,y,cell,heavy)=>{
      const r=WG.randSeed(wx*4.171+y*0.613+cell*19.31);
      if(heavy) return r<0.62 ? T.STEEL : T.STONE;
      if(r<0.28) return T.STEEL;
      if(r<0.82) return T.STONE;
      return T.OBSIDIAN;
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
            continue;
          }
          const t=cityTile(wx,y,cell,edge||floor||beam);
          put(wx,y,t,true);
          if(!edge && floor && WG.randSeed(wx*6.3+y*0.41)>0.84) carve(wx,y-1);
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
          for(let y=base-1; y>=base-7; y--) put(wx,y,T.STEEL,true);
          put(wx,base-8,T.OBSIDIAN,true);
        }
      } else if(style==='tower'){
        const mastX=anchor+(w>>1);
        for(let y=ground-h-1; y>=ground-h-8; y--) put(mastX,y,T.STEEL,true);
        put(mastX-1,ground-h-5,T.STEEL,true); put(mastX+1,ground-h-5,T.STEEL,true);
      }
      if(WG.randSeed(anchor*0.93+cell)>0.82){
        const chestX=anchor+2+Math.floor(WG.randSeed(anchor*2.17+cell)*Math.max(1,w-4));
        const chestY=ground-2-Math.floor(WG.randSeed(anchor*2.71+cell)*Math.min(5,Math.max(1,h-2)));
        put(chestX,chestY,WG.randSeed(anchor*3.33+cell)>0.83?T.CHEST_EPIC:T.CHEST_RARE,true);
      }
      const vendingChance=style==='factory'?0.34:(style==='tower'?0.16:0.23);
      if(w>=7 && h>=6 && WG.randSeed(anchor*1.37+cell*0.61)<vendingChance){
        const vx=anchor+2+Math.floor(WG.randSeed(anchor*2.91+cell)*Math.max(1,w-4));
        const floors=Math.max(1,Math.floor((h-2)/floorGap));
        const rel=1+floorGap*Math.floor(WG.randSeed(anchor*3.07+cell)*floors);
        const vy=Math.max(2,ground-rel-1);
        if(cityCol(vx) && cityCol(vx-1) && cityCol(vx+1)){
          put(vx,vy+1,cityTile(vx,vy+1,cell,true),true);
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
      if(WG.randSeed(anchor*0.27+cell)>0.72) put(anchor,g-10,T.DIAMOND,true);
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
        else carve(wx,y);
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
        const rubble=3+Math.floor(WG.randSeed(cell*5.5)*7);
        for(let i=0;i<rubble;i++){
          const wx=anchor+Math.floor(WG.randSeed(cell*9.1+i*3.7)*pitch)-4;
          const c=cityCol(wx); if(!c) continue;
          const y=c.row-1-Math.floor(WG.randSeed(wx*2.7+i)*3);
          put(wx,y,WG.randSeed(wx*4.4+i)>0.42?T.STONE:T.STEEL,true);
        }
        continue;
      }
      const styleRoll=WG.randSeed(cell*23.7+city.skyline);
      const style=styleRoll>0.78?'tower':(styleRoll>0.55?'factory':(styleRoll>0.44?'monument':'block'));
      if(style==='monument'){ buildMonument(anchor,cell); continue; }
      const wBase=style==='factory'?22:(style==='tower'?9:12);
      const hBase=style==='factory'?9:(style==='tower'?26:16);
      const w=wBase+Math.floor(WG.randSeed(cell*3.19)*10);
      const h=Math.min(38,hBase+Math.floor(WG.randSeed(cell*5.91)*(18+city.skyline*10)));
      buildFrame(anchor,w,h,cell,style);
      const ground=col.row;
      if(WG.randSeed(cell*2.41)>0.54){
        const bridgeY=ground-7-Math.floor(WG.randSeed(cell*1.61)*7);
        const len=10+Math.floor(WG.randSeed(cell*1.93)*14);
        for(let dx=w-1; dx<w+len; dx++){
          const wx=anchor+dx;
          if(!cityCol(wx)) continue;
          put(wx,bridgeY,T.STEEL,true);
          if(dx%4===0) put(wx,bridgeY-1,T.STONE,true);
          if(dx%9===0 && WG.randSeed(wx*0.51+bridgeY*1.7+cell)<0.25) put(wx,bridgeY-2,T.WIRE,false);
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
    }
    for(const plant of collectCityPlants()) buildPowerPlant(plant);
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
      // Subsoil sand thickness: deserts deep, beaches/sea floors medium, inland none/thin
      let sandTh;
      if(biome===3) sandTh = SAND_DEPTH + Math.floor(WG.randSeed(wx*0.37)*4) - 1;
      else if(beach || biome===5 || biome===6) sandTh = 3 + Math.floor(WG.randSeed(wx*0.41)*3);
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
            // Surface material
            if((s>SEA || biome===5 || biome===6 || lakeRow!==Infinity) && biome!==4) t=T.SAND; // sea/lake bed
            else if(biome===8) t=citySurfaceTile(WG,wx,depth);
            else if(biome===4) t=swampGroundTile(wx,depth,poolDepth);
            else if(biome===3 || beach) t=T.SAND;
            else if(cold) t=T.SNOW;
            else if(slope>=3 || (biome===7 && col.pv>0.62)) t=T.STONE;          // cliffs & crests
            else if(biome===7) t=(WG.randSeed(wx*2.9)<0.5)?T.STONE:T.GRASS;     // rocky slopes
            else if(desertF>0.25) t=(WG.randSeed(wx*2.31)<Math.min(0.5,desertF*0.8))?T.SAND:T.GRASS;
            else t=T.GRASS;
            } else if(depth<SURFACE_GRASS_DEPTH+sandTh){
            t=biome===8 ? citySurfaceTile(WG,wx,depth) : (biome===4 ? swampGroundTile(wx,depth,poolDepth) : ((cold && depth<3)? T.SNOW : T.SAND));
            if(t===T.SAND && depth>2 && WG.randSeed(wx*9.71+y*0.23)<0.18) t=T.STONE;
            if(t===T.SAND && depth>=2 && (biome===5 || biome===6 || lakeRow!==Infinity || waterF>0.35) && WG.randSeed(wx*4.19+y*0.31)<0.045) t=T.CLAY;
            } else if(depth<SURFACE_GRASS_DEPTH+sandTh+dirtTh){
            t=biome===8 ? citySurfaceTile(WG,wx,depth) : T.DIRT;
            } else {
            // Stone mass; diamonds stay rare/deep, coal forms more common seams
            // through ordinary underground rock and is richer beside cave walls.
            const nearCave=(COL_CARVE[y-1]||COL_CARVE[y+1]);
            const chance=WG.diamondChance(y)*(nearCave?3:1);
            if(WG.randSeed(wx*13.37+y*0.7)<chance) t=T.DIAMOND;
            else if(WG.coalVeinAt && WG.coalVeinAt(wx,y,nearCave)) t=T.COAL;
            else t=geologyRockTile(wx,y,depth,biome);
            if(biome!==8 && t===T.STONE && depth<SURFACE_GRASS_DEPTH+sandTh+2 && WG.randSeed(wx*9.71+y*0.23)<(0.10+0.5*(desertF+waterF*0.5))) t=T.SAND;
            }
          }
        }
        arr[tileIndex(lx,y)]=t;
      }
      // Cave treasure: rare chests on deep cave floors reward spelunking
      if(WG.randSeed(wx*4.21+9.7)<0.05){
        for(let y=WORLD_H-5;y>ground+10;y--){
          const idx=tileIndex(lx,y);
          if(arr[idx]===T.AIR && isCaveTreasureFloor(arr[tileIndex(lx,y+1)])){
            const rr=WG.randSeed(wx*6.13+1.7);
            let ct=T.CHEST_COMMON;
            if(y>WORLD_H-40){ if(rr>0.6) ct=T.CHEST_EPIC; else if(rr>0.25) ct=T.CHEST_RARE; }
            else if(rr>0.65) ct=T.CHEST_RARE;
            arr[idx]=ct; break;
          }
        }
      }
    }
    // Chest placement on surface blocks (above ground) using chestPlace probability
    if(MM.chests){ for(let lx=0; lx<CHUNK_W; lx++){ const wx=cx*CHUNK_W+lx; if(WG.chestPlace && WG.chestPlace(wx)){ const surface=colHeight(wx); const placeY=surface-1; if(placeY>=0){
          const below=arr[tileIndex(lx,surface)];
          // only on solid land surfaces (skip water, pools, carved cave mouths)
          if(below===T.GRASS||below===T.SAND||below===T.SNOW||below===T.STONE){
            const r=WG.chestNoise(wx); let chestT=T.CHEST_COMMON; if(r>0.985) chestT=T.CHEST_EPIC; else if(r>0.955) chestT=T.CHEST_RARE;
            const idx=tileIndex(lx,placeY); if(arr[idx]===T.AIR){ arr[idx]=chestT; }
          }
        } } } }
    // Trees are populated after base terrain; tree code uses deterministic RNG so caching heights is safe
    if(MM.trees && MM.trees.populateChunk){ MM.trees.populateChunk(arr,cx); }
    applyDevastatedCity(arr,cx);
    placeStructures(arr,cx);
    // Buried ruin complexes are anchor-based (they may span chunk borders) and
    // applied last: carved interiors and masonry win over terrain/trees/chests
    if(RUINS && RUINS.applyToChunk) RUINS.applyToChunk(arr,cx);
    reinforceVolcanoConduits(arr,cx);
    if(GUARDIANS && GUARDIANS.applyToChunk) GUARDIANS.applyToChunk(arr,cx);
    if(UNDERGROUND && UNDERGROUND.applyToChunk) UNDERGROUND.applyToChunk(arr,cx);
    if(AFTERMATH && AFTERMATH.applyToChunk) AFTERMATH.applyToChunk(arr,cx);
    try{ if(MM.trees && MM.trees.pruneChunk) MM.trees.pruneChunk(arr,cx); }catch(e){}
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
    return arr;
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
    const put=(lx,y,t)=>{ if(lx>=0&&lx<CHUNK_W&&y>=0&&y<WORLD_H){ const i=tileIndex(lx,y); if(isReplaceableNaturalOpenTile(arr[i],false)||t===T.AIR) arr[i]=t; } };
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
    // ruin: broken stone pillars + a partial wall around a rare chest
    const s=col.row;
    const sL=WG.column(wx0-3).row, sR=WG.column(wx0+3).row;
    if(Math.abs(sL-s)>2 || Math.abs(sR-s)>2) return;            // flat ground only
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
  function getConstructionBackground(x,y){
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
    try{ if(MM.trees && MM.trees.onTileChanged) MM.trees.onTileChanged(x,y,old,v); }catch(e){}
    try{ if(MM.meat && MM.meat.onTileChanged) MM.meat.onTileChanged(x,y,old,v); }catch(e){}
    try{ if(MM.gases && MM.gases.onTileChanged) MM.gases.onTileChanged(x,y,old,v); }catch(e){}
    try{ if(MM.dynamo && MM.dynamo.onTileChanged) MM.dynamo.onTileChanged(x,y,old,v); }catch(e){}
    try{ if(MM.solar && MM.solar.onTileChanged) MM.solar.onTileChanged(x,y,old,v); }catch(e){}
    try{ if(MM.teleporters && MM.teleporters.onTileChanged) MM.teleporters.onTileChanged(x,y,old,v); }catch(e){}
    try{ if(MM.pumps && MM.pumps.onTileChanged) MM.pumps.onTileChanged(x,y,old,v); }catch(e){}
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
    const item=isConstructionBackgroundTile(v) ? v : T.AIR;
    const k=key(x,y);
    const old=getConstructionBackground(x,y);
    if(old===item) return false;
    if(item===T.AIR) constructionBackground.delete(k);
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
      .slice(0,20000);
    return {v:2,list:clean};
  }
  function restoreInfrastructure(data){
    infrastructure.clear();
    if(!data || !Array.isArray(data.list)) return;
    for(const raw of data.list){
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
      if(!isConstructionBackgroundTile(t)) continue;
      const comma=k.indexOf(',');
      const x=+k.slice(0,comma), y=+k.slice(comma+1);
      list.push({x,y,t});
    }
    const clean=list
      .filter(o=>isConstructionBackgroundTile(o.t) && isFinite(o.x) && isFinite(o.y) && worldYInBounds(o.y))
      .sort((a,b)=>(a.x-b.x)||(a.y-b.y)||(a.t-b.t))
      .slice(0,40000);
    return {v:1,list:clean};
  }
  function restoreConstructionBackground(data){
    constructionBackground.clear();
    if(!data || !Array.isArray(data.list)) return;
    for(const raw of data.list){
      if(!raw || !isConstructionBackgroundTile(raw.t)) continue;
      if(!isFinite(raw.x) || !isFinite(raw.y)) continue;
      const x=Math.floor(raw.x), y=Math.floor(raw.y);
      if(!worldYInBounds(y) || Math.abs(x)>MAX_COORD) continue;
      constructionBackground.set(key(x,y),raw.t);
      markModifiedChunk(Math.floor(x/CHUNK_W),null,sectionYFor(y));
    }
  }
  function clearWorld(){ try{ if(MM.trees && MM.trees.resetIdentities) MM.trees.resetIdentities(); }catch(e){} world.clear(); sectionViews.clear(); versions.clear(); modifiedChunks.clear(); infrastructure.clear(); constructionBackground.clear(); heightCache.clear(); lakeLevels.clear(); if(WG.clearCaches) WG.clearCaches(); }
  // Save loading replaces whole chunk arrays: any cached section view over the
  // old array must be dropped or reads would silently hit the orphaned buffer.
  function setChunkArray(key,arr){ world.set(key,arr); sectionViews.clear(); }

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
  worldAPI.clearHeights = ()=>{ heightCache.clear(); lakeLevels.clear(); if(WG.clearCaches) WG.clearCaches(); };
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
