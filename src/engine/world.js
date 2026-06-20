// World storage & chunk generation
import { CHUNK_W, WORLD_H, T, INFO, SNOW_LINE, SURFACE_GRASS_DEPTH, SAND_DEPTH } from '../constants.js';
import { worldGen as WORLDGEN } from './worldgen.js';
import { ruins as RUINS } from './ruins.js';
window.MM = window.MM || {};
(function(){
  const WG = WORLDGEN;
  const worldAPI = {};
  const world = new Map();
  const versions = new Map(); // chunk key -> version number for render cache invalidation
  const modifiedChunks = new Set();
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
  function colHeight(x){ let v=heightCache.get(x); if(v===undefined){ if(heightCache.size>HEIGHT_CACHE_CAP) heightCache.clear(); v=WG.surfaceHeight(x); heightCache.set(x,v); } return v; }
  function evictFarChunks(){
    const p=(typeof window!=='undefined' && window.player) || null;
    const pcx=(p && isFinite(p.x))? Math.floor(p.x/CHUNK_W) : 0;
    const cand=[];
    for(const k of world.keys()){
      if(versions.get(k)) continue;               // modified chunk: player edits live here
      cand.push([Math.abs(+k.slice(1)-pcx), k]);
    }
    cand.sort((a,b)=>b[0]-a[0]);                  // farthest first
    const drop=Math.min(cand.length, world.size-((CHUNK_CAP*0.75)|0));
    for(let i=0;i<drop;i++){ try{ if(MM.trees && MM.trees.clearChunk) MM.trees.clearChunk(+cand[i][1].slice(1)); }catch(e){} world.delete(cand[i][1]); versions.delete(cand[i][1]); }
  }
  function ck(x){ return 'c'+x; }
  function tileIndex(x,y){ return y*CHUNK_W+x; }
  function getTileRaw(arr,lx,y){ return arr[tileIndex(lx,y)]; }
  function markModifiedChunk(cx,version){
    if(!isFinite(cx)) return;
    const k=ck(cx);
    const next=(version==null) ? ((versions.get(k)||0)+1) : version;
    versions.set(k,next);
    if(next!==0) modifiedChunks.add(cx);
    else modifiedChunks.delete(cx);
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
    if(d<=v.pipe+1 && y>=ground) return T.OBSIDIAN;
    if(d<=v.crater+2 && y>=ground && y<=ground+4) return (d<=v.crater+1)?T.OBSIDIAN:T.STONE;
    return undefined;
  }
  function volcanoRockTile(col,wx,y,ground,depth){
    const v=col && col.volcano; if(!v || y<ground || y>=WORLD_H-3) return undefined;
    const d=Math.abs(wx-v.center);
    if(d>v.radius) return undefined;
    if(depth<12){
      if(d<=v.crater+3 || WG.randSeed(wx*4.73+y*0.19)<0.16) return T.OBSIDIAN;
      return T.STONE;
    }
    return undefined;
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
        return t===T.AIR || t===T.WATER || t===T.TORCH || t===T.GRAVE;
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
  function isCityStructuralTile(t){ return t===T.STONE || t===T.STEEL || t===T.OBSIDIAN; }
  function isCityLoadBearingTile(t){
    if(t===T.AIR || t===T.WATER || (INFO[t] && INFO[t].passable) || t===T.GLASS || t===T.ELECTRONICS) return false;
    if(t===T.CHEST_COMMON || t===T.CHEST_RARE || t===T.CHEST_EPIC || t===T.VOLCANO_MASTER_STONE || t===T.SERVANT_STONE) return false;
    if(t===T.MEAT || t===T.ROTTEN_MEAT || t===T.BAKED_MEAT) return false;
    return true;
  }
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
    if(depth===0) return wet ? T.MUD : T.GRASS;
    if(depth<4 && (wet || WG.randSeed(wx*8.17+depth*2.13)<0.62)) return T.MUD;
    return T.SAND;
  }
  function isCaveTreasureFloor(t){
    return t===T.STONE || t===T.COAL;
  }

  function applyDevastatedCity(arr,cx){
    const WG=MM.worldGen; if(!WG || !WG.column) return;
    const worldLeft=cx*CHUNK_W, worldRight=worldLeft+CHUNK_W-1;
    const put=(wx,y,t,force)=>{
      if(wx<worldLeft || wx>worldRight || y<0 || y>=WORLD_H-3) return false;
      const lx=wx-worldLeft, idx=tileIndex(lx,y), cur=arr[idx];
      if(force || cur===T.AIR || cur===T.WATER || cur===T.LEAF || cur===T.AUTUMN_LEAF_ORANGE || cur===T.AUTUMN_LEAF_RED || cur===T.TORCH || cur===T.GRAVE){
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
      for(let y=ground;y<WORLD_H-3;y++){ COL_CARVE[y]=WG.caveAt(wx,y,col); }

      for(let y=0;y<WORLD_H;y++){
        let t=T.AIR;
        if(y>=WORLD_H-3){ arr[tileIndex(lx,y)]=T.STONE; continue; } // bedrock shelf
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
            } else {
            // Stone mass; diamonds stay rare/deep, coal forms more common seams
            // through ordinary underground rock and is richer beside cave walls.
            const nearCave=(COL_CARVE[y-1]||COL_CARVE[y+1]);
            const chance=WG.diamondChance(y)*(nearCave?3:1);
            if(WG.randSeed(wx*13.37+y*0.7)<chance) t=T.DIAMOND;
            else if(WG.coalVeinAt && WG.coalVeinAt(wx,y,nearCave)) t=T.COAL;
            else t=T.STONE;
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
    try{ if(MM.trees && MM.trees.pruneChunk) MM.trees.pruneChunk(arr,cx); }catch(e){}
    world.set(k,arr); markModifiedChunk(cx,0);
    if(world.size>CHUNK_CAP) evictFarChunks();
    auditCityStructuralStability(arr,cx);
    // A new chunk may carve caves right beside existing dormant water (or bring its own
    // water beside existing caves) — queue a boundary wake so the fluid sim reacts.
    try{ if(MM.water && MM.water.noteChunkGenerated) MM.water.noteChunkGenerated(cx*CHUNK_W, cx*CHUNK_W+CHUNK_W-1); }catch(e){}
    registerGeneratedLava(arr,cx);
    return arr; }

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
    const put=(lx,y,t)=>{ if(lx>=0&&lx<CHUNK_W&&y>=0&&y<WORLD_H){ const i=tileIndex(lx,y); if(arr[i]===T.AIR||arr[i]===T.WATER||t===T.AIR) arr[i]=t; } };
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
  function getTile(x,y){ if(!(y>=0) || y>=WORLD_H || !isFinite(x) || Math.abs(x)>MAX_COORD) return T.AIR; const cx=Math.floor(x/CHUNK_W); const lx=((x%CHUNK_W)+CHUNK_W)%CHUNK_W; const arr=ensureChunk(cx); return getTileRaw(arr,lx,y); }
  function peekTile(x,y,fallback){
    if(!(y>=0) || y>=WORLD_H || !isFinite(x) || Math.abs(x)>MAX_COORD) return T.AIR;
    const cx=Math.floor(x/CHUNK_W);
    const arr=world.get(ck(cx));
    if(!arr) return fallback===undefined ? T.AIR : fallback;
    const lx=((x%CHUNK_W)+CHUNK_W)%CHUNK_W;
    return getTileRaw(arr,lx,y);
  }
  function notifyTileChanged(x,y,old,v){
    try{ if(MM.trees && MM.trees.onTileChanged) MM.trees.onTileChanged(x,y,old,v); }catch(e){}
    try{ if(MM.meat && MM.meat.onTileChanged) MM.meat.onTileChanged(x,y,old,v); }catch(e){}
    try{ if(MM.gases && MM.gases.onTileChanged) MM.gases.onTileChanged(x,y,old,v); }catch(e){}
    try{ if(MM.dynamo && MM.dynamo.onTileChanged) MM.dynamo.onTileChanged(x,y,old,v); }catch(e){}
    try{ if(MM.solar && MM.solar.onTileChanged) MM.solar.onTileChanged(x,y,old,v); }catch(e){}
    try{ if(MM.teleporters && MM.teleporters.onTileChanged) MM.teleporters.onTileChanged(x,y,old,v); }catch(e){}
  }
  function setTileInternal(x,y,v,transient){
    if(!(y>=0) || y>=WORLD_H || !isFinite(x) || Math.abs(x)>MAX_COORD) return;
    const cx=Math.floor(x/CHUNK_W);
    const lx=((x%CHUNK_W)+CHUNK_W)%CHUNK_W;
    const arr=ensureChunk(cx);
    const idx=tileIndex(lx,y);
    if(arr[idx]===v) return;
    const old=arr[idx];
    arr[idx]=v;
    notifyTileChanged(x,y,old,v);
    if(!transient) markModifiedChunk(cx);
  }
  function setTile(x,y,v){ setTileInternal(x,y,v,false); }
  // Transient world-backed layers (currently gases) need to be visible to getTile()
  // without turning every drift step into terrain-save churn or chunk-cache invalidation.
  function setTransientTile(x,y,v){ setTileInternal(x,y,v,true); }
  function clearWorld(){ try{ if(MM.trees && MM.trees.resetIdentities) MM.trees.resetIdentities(); }catch(e){} world.clear(); versions.clear(); modifiedChunks.clear(); heightCache.clear(); lakeLevels.clear(); if(WG.clearCaches) WG.clearCaches(); }

  worldAPI.ensureChunk = ensureChunk;
  worldAPI.getTile = getTile;
  worldAPI.peekTile = peekTile;
  worldAPI.setTile = setTile;
  worldAPI.setTransientTile = setTransientTile;
  worldAPI.clear = clearWorld;
  worldAPI.clearHeights = ()=>{ heightCache.clear(); lakeLevels.clear(); if(WG.clearCaches) WG.clearCaches(); };
  worldAPI.markModifiedChunk = markModifiedChunk;
  worldAPI.modifiedChunkIds = ()=>[...modifiedChunks];
  worldAPI._world = world;
  worldAPI._versions = versions;
  worldAPI._modifiedChunks = modifiedChunks;
  worldAPI.chunkVersion = function(cx){ return versions.get(ck(cx))||0; };
  worldAPI.metrics = function(){
    return {chunks:world.size, modified:modifiedChunks.size, heightCache:heightCache.size, lakeCache:lakeLevels.size};
  };

  MM.world = worldAPI;
})();
// ESM export (progressive migration)
export const world = (typeof window!== 'undefined' && window.MM) ? window.MM.world : undefined;
export default world;
