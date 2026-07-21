// Fog of War module: tracks seen tiles and applies fog overlay
// API:
//  MM.fog.revealAround(px,py,r,{lineOfSight,getTile,blocksSight,rememberSeen})
//  MM.fog.revealRect(x0,y0,x1,y1,{originX,originY,lineOfSight,getTile,blocksSight,rememberSeen})
//  MM.fog.applyOverlay(ctx, sx, sy, viewX, viewY, TILE, getTile, T, {showMemory})
//  MM.fog.exportSeen() -> [{cx:number, data:string, rle:true, minY:number, maxY:number}]
//  MM.fog.importSeen(list)
//  MM.fog.getRevealAll() / MM.fog.setRevealAll(v) / MM.fog.toggleRevealAll()
import { CHUNK_W, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } from '../constants.js';
import { isAirOrGasTile, isGasTile } from './material_physics.js';
(function(){
  window.MM = window.MM || {};
  const F = {};

  let revealAll = false;
  const WORLD_SPAN_H = WORLD_MAX_Y - WORLD_MIN_Y;
  const LEGACY_BYTES_PER_CHUNK = Math.ceil((CHUNK_W*WORLD_H)/8);
  const seenChunks = new Map(); // key: chunkX -> Uint8Array bitset (CHUNK_W*WORLD_SPAN_H bits)
  const visibleChunks = new Map(); // current frame visibility; rebuilt by revealAround()

  function worldYInBounds(y){ return Number.isFinite(y) && y>=WORLD_MIN_Y && y<WORLD_MAX_Y; }
  function bitY(y){ return Math.floor(y) - WORLD_MIN_Y; }
  function bytesPerChunk(){ return Math.ceil((CHUNK_W*WORLD_SPAN_H)/8); }
  function ensureSeenChunk(cx){ let arr = seenChunks.get(cx); if(!arr){ arr = new Uint8Array(bytesPerChunk()); seenChunks.set(cx, arr); } return arr; }
  function ensureVisibleChunk(cx){ let arr = visibleChunks.get(cx); if(!arr){ arr = new Uint8Array(bytesPerChunk()); visibleChunks.set(cx, arr); } return arr; }
  function setBit(map,ensure,x,y){ y=Math.floor(y); if(!worldYInBounds(y)) return; const cx=Math.floor(x/CHUNK_W); let lx=Math.floor(x) - cx*CHUNK_W; if(lx<0||lx>=CHUNK_W) return; const idx=bitY(y)*CHUNK_W + lx; const arr=ensure(cx); arr[idx>>3] |= (1 << (idx & 7)); }
  function getBit(map,x,y){ y=Math.floor(y); if(!worldYInBounds(y)) return false; const cx=Math.floor(x/CHUNK_W); const arr=map.get(cx); if(!arr) return false; const lx=Math.floor(x) - cx*CHUNK_W; if(lx<0||lx>=CHUNK_W) return false; const idx=bitY(y)*CHUNK_W + lx; return (arr[idx>>3] & (1 << (idx & 7)))!==0; }
  function markSeen(x,y){ setBit(seenChunks,ensureSeenChunk,x,y); }
  function markVisible(x,y){ setBit(visibleChunks,ensureVisibleChunk,x,y); }
  function hasSeen(x,y){ return getBit(seenChunks,x,y); }
  function hasVisible(x,y){ return getBit(visibleChunks,x,y); }
  function markRevealed(x,y,rememberSeen){ if(rememberSeen) markSeen(x,y); markVisible(x,y); }

  // Base64 helpers (local copy to avoid coupling)
  function _b64FromBytes(bytes){ let bin=''; for(let i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]); return btoa(bin); }
  function _bytesFromB64(b64){ const bin=atob(b64); const out=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i); return out; }
  function encodeRLE(arr){ const out=[]; for(let i=0;i<arr.length;){ const v=arr[i]; let run=1; while(i+run<arr.length && arr[i+run]===v && run<65535) run++; let remain=run; while(remain>0){ const take=Math.min(255,remain); out.push(v,take); remain-=take; } i+=run; } return _b64FromBytes(Uint8Array.from(out)); }
  function decodeRLE(b64,totalLen){ const bytes=_bytesFromB64(b64); const out=new Uint8Array(totalLen); let oi=0; for(let i=0;i<bytes.length; i+=2){ const v=bytes[i]; const count=bytes[i+1]; for(let r=0;r<count;r++) out[oi++]=v; } return out; }
  function decodeRaw(b64){ return _bytesFromB64(b64); }
  function bitIsSet(arr,idx){ return !!(arr[idx>>3] & (1 << (idx & 7))); }
  function setBitIndex(arr,idx){ arr[idx>>3] |= (1 << (idx & 7)); }
  function migrateLegacySeen(arr){
    const out=new Uint8Array(bytesPerChunk());
    const srcRows=Math.min(WORLD_H, WORLD_SPAN_H);
    for(let y=0; y<srcRows; y++){
      const dstY=bitY(y);
      if(dstY<0 || dstY>=WORLD_SPAN_H) continue;
      for(let lx=0; lx<CHUNK_W; lx++){
        const srcIdx=y*CHUNK_W+lx;
        if(bitIsSet(arr,srcIdx)) setBitIndex(out,dstY*CHUNK_W+lx);
      }
    }
    return out;
  }

  F.exportSeen = function(){ const out=[]; for(const [cx,buf] of seenChunks.entries()){ out.push({cx, data: encodeRLE(buf), rle:true, minY:WORLD_MIN_Y, maxY:WORLD_MAX_Y}); } return out; };
  F.importSeen = function(list){
    if(!Array.isArray(list)) return;
    seenChunks.clear();
    const totalLen = bytesPerChunk();
    for(const row of list){
      if(typeof row.cx!=='number'||!row.data) continue;
      let arr;
      if(row.rle){
        const expected = Number.isFinite(row.minY) && Number.isFinite(row.maxY) ? Math.ceil((CHUNK_W*(row.maxY-row.minY))/8) : LEGACY_BYTES_PER_CHUNK;
        arr = decodeRLE(row.data, expected);
      } else arr = decodeRaw(row.data);
      if(arr.length!==totalLen) arr = arr.length===LEGACY_BYTES_PER_CHUNK ? migrateLegacySeen(arr) : arr.slice(0,totalLen);
      if(arr.length<totalLen){ const padded=new Uint8Array(totalLen); padded.set(arr); arr=padded; }
      seenChunks.set(Math.floor(row.cx), arr);
    }
  };

  function hasLineOfSight(x0,y0,x1,y1,getTile,blocksSight){
    if(x0===x1 && y0===y1) return true;
    const dx=Math.abs(x1-x0), dy=Math.abs(y1-y0);
    const sx=x0<x1?1:-1, sy=y0<y1?1:-1;
    let err=dx-dy, x=x0, y=y0;
    for(let guard=0; guard<512; guard++){
      const e2=err*2;
      const px=x, py=y;
      let stepX=0, stepY=0;
      if(e2>-dy){ err-=dy; x+=sx; stepX=sx; }
      if(e2< dx){ err+=dx; y+=sy; stepY=sy; }
      if(stepX && stepY){
        const sideX=px+stepX, sideY=py+stepY;
        if(blocksSight(getTile(sideX,py),sideX,py) && blocksSight(getTile(px,sideY),px,sideY)) return false;
      }
      if(x===x1 && y===y1) return true; // the blocking face itself is visible
      if(blocksSight(getTile(x,y),x,y)) return false;
    }
    return false;
  }

  F.revealAround = function(px,py,r,opts){
    visibleChunks.clear();
    px=+px; py=+py; r=+r;
    const cx=Math.floor(px), cy=Math.floor(py);
    const rr=r*r;
    const los=opts && opts.lineOfSight && typeof opts.getTile==='function' && typeof opts.blocksSight==='function';
    const rememberSeen=!(opts && opts.rememberSeen===false);
    for(let dx=-r; dx<=r; dx++){
      const wx=Math.floor(px+dx);
      for(let dy=-r; dy<=r; dy++){
        if(dx*dx+dy*dy>rr) continue;
        const wy=Math.floor(py+dy);
        if(!los || hasLineOfSight(cx,cy,wx,wy,opts.getTile,opts.blocksSight)) markRevealed(wx, wy, rememberSeen);
      }
    }
  };

  F.revealRect = function(x0,y0,x1,y1,opts){
    visibleChunks.clear();
    const ax=+x0, bx=+x1, ay=+y0, by=+y1;
    x0=Math.floor(Math.min(ax,bx));
    x1=Math.ceil(Math.max(ax,bx));
    y0=Math.max(WORLD_MIN_Y,Math.floor(Math.min(ay,by)));
    y1=Math.min(WORLD_MAX_Y-1,Math.ceil(Math.max(ay,by)));
    if(!Number.isFinite(x0)||!Number.isFinite(x1)||!Number.isFinite(y0)||!Number.isFinite(y1)) return;
    const ox=opts && Number.isFinite(opts.originX) ? Math.floor(opts.originX) : Math.floor((x0+x1)/2);
    const oy=opts && Number.isFinite(opts.originY) ? Math.floor(opts.originY) : Math.floor((y0+y1)/2);
    const los=opts && opts.lineOfSight && typeof opts.getTile==='function' && typeof opts.blocksSight==='function';
    const rememberSeen=!(opts && opts.rememberSeen===false);
    for(let y=y0; y<=y1; y++){
      for(let x=x0; x<=x1; x++){
        if(!los || hasLineOfSight(ox,oy,x,y,opts.getTile,opts.blocksSight)) markRevealed(x,y,rememberSeen);
      }
    }
  };

  // Fog covers unseen solid tiles AND unseen underground air, so undiscovered caves
  // stay hidden instead of reading as silhouettes against the cave backdrop
  F.applyOverlay = function(ctx, sx, sy, viewX, viewY, TILE, getTile, T, opts){
    if(revealAll) return;
    const showMemory=!(opts && opts.showMemory===false);
    const originX=(opts && Number.isFinite(opts.originX)) ? opts.originX : 0;
    const originY=(opts && Number.isFinite(opts.originY)) ? opts.originY : 0;
    const lodStep=Math.max(1, Math.min(4, (opts && Number.isFinite(opts.lodStep)) ? Math.floor(opts.lodStep) : 1));
    const WGen=(window.MM && MM.worldGen && MM.worldGen.surfaceHeight)? MM.worldGen : null;
    const x0=Math.floor(sx);
    const yStart=Math.max(WORLD_MIN_Y,Math.floor(sy));
    const yEnd=Math.min(WORLD_MAX_Y-1,Math.ceil(sy+viewY+1));
    const xEnd=Math.ceil(sx+viewX+2);
    // The unknown fog is an opaque final mask; a tiny overlap hides zoom/camera
    // subpixel cracks without changing the readable shape of exposed terrain.
    const blackSeamOverlap = TILE>=8 ? Math.max(1, Math.min(2, TILE*0.05)) : 0;
    const gasSkyExposed=(x,y)=>{
      const gas=(window.MM && MM.gases && typeof MM.gases.skyExposed==='function') ? MM.gases : null;
      if(gas) return gas.skyExposed(x,y,getTile);
      for(let yy=y-1; yy>=WORLD_MIN_Y; yy--){
        const tt=getTile(x,yy);
        if(isAirOrGasTile(tt)) continue;
        return false;
      }
      return true;
    };
    const surfaceCache=new Map();
    const surfaceAt=(x)=>{
      if(!WGen) return -Infinity;
      let s=surfaceCache.get(x);
      if(s===undefined){ s=WGen.surfaceHeight(x); surfaceCache.set(x,s); }
      return s;
    };
    const drawRect=(r)=>{
      ctx.fillStyle=r.style;
      const x=(r.x0-originX)*TILE, y=(r.y0-originY)*TILE;
      const w=(r.x1-r.x0)*TILE, h=(r.y1-r.y0+1)*TILE;
      if(r.style==='#000' && blackSeamOverlap>0){
        const o=blackSeamOverlap;
        ctx.fillRect(x-o,y-o,w+o*2,h+o*2);
      } else {
        ctx.fillRect(x,y,w,h);
      }
    };
    const styleAt=(x,y)=>{
      if(!worldYInBounds(y)) return null;
      if(hasVisible(x,y)) return null;
      const t=getTile(x,y);
      const underground = WGen? (y>surfaceAt(x)) : false;
      const openGas = isGasTile(t) && gasSkyExposed(x,y);
      if((t!==T.AIR && !isGasTile(t)) || (underground && !openGas)){
        return showMemory && hasSeen(x,y)?'rgba(0,0,0,.48)':'#000';
      }
      return null;
    };
    const strongerStyle=(a,b)=> a==='#000' || b==='#000' ? '#000' : (a || b || null);
    const blockStyle=(x,y,step)=>{
      const xMax=xEnd-1, yMax=yEnd;
      let style=styleAt(x,y);
      const x2=Math.min(xMax,x+step-1), y2=Math.min(yMax,y+step-1);
      if(x2!==x || y2!==y) style=strongerStyle(style,styleAt(x2,y2));
      if(step>2){
        const cx=Math.min(xMax,x+(step>>1)), cy=Math.min(yMax,y+(step>>1));
        style=strongerStyle(style,styleAt(cx,cy));
      }
      return style;
    };
    if(lodStep>1){
      for(let y=yStart; y<=yEnd; y+=lodStep){
        let runStart=0, runStyle=null;
        const y1=Math.min(WORLD_MAX_Y-1,y+lodStep-1);
        const flushRun=(x)=>{
          if(!runStyle) return;
          drawRect({x0:runStart,x1:x,y0:y,y1,style:runStyle});
          runStyle=null;
        };
        for(let x=x0; x<xEnd; x+=lodStep){
          const xNext=Math.min(xEnd,x+lodStep);
          const style=blockStyle(x,y,lodStep);
          if(style!==runStyle){
            flushRun(x);
            if(style){ runStart=x; runStyle=style; }
          }
          if(xNext>=xEnd) flushRun(xEnd);
        }
      }
      return;
    }
    let pendingRuns=new Map();
    for(let y=yStart; y<=yEnd; y++){
      const rowRuns=[];
      let runStart=0, runStyle=null;
      const flushRun=(x)=>{
        if(!runStyle) return;
        rowRuns.push({x0:runStart,x1:x,style:runStyle});
        runStyle=null;
      };
      for(let x=x0; x<xEnd; x++){
        let style=null;
        if(!hasVisible(x,y)){
          const t=getTile(x,y);
          const underground = WGen? (y>surfaceAt(x)) : false;
          const openGas = isGasTile(t) && gasSkyExposed(x,y);
          if((t!==T.AIR && !isGasTile(t)) || (underground && !openGas)){
            style=showMemory && hasSeen(x,y)?'rgba(0,0,0,.48)':'#000';
          }
        }
        if(style!==runStyle){
          flushRun(x);
          if(style){ runStart=x; runStyle=style; }
        }
      }
      flushRun(xEnd);
      const nextRuns=new Map();
      for(const run of rowRuns){
        const key=run.style+'|'+run.x0+'|'+run.x1;
        const prev=pendingRuns.get(key);
        if(prev && prev.y1===y-1){
          prev.y1=y;
          nextRuns.set(key,prev);
        } else {
          nextRuns.set(key,{x0:run.x0,x1:run.x1,y0:y,y1:y,style:run.style});
        }
      }
      for(const [key,rect] of pendingRuns.entries()){
        if(!nextRuns.has(key)) drawRect(rect);
      }
      pendingRuns=nextRuns;
    }
    for(const rect of pendingRuns.values()) drawRect(rect);
  };

  F.getRevealAll = function(){ return revealAll; };
  F.setRevealAll = function(v){ revealAll = !!v; };
  F.toggleRevealAll = function(){ revealAll = !revealAll; return revealAll; };

  // expose helpers if needed elsewhere
  F._markSeen = markSeen;
  F._hasSeen = hasSeen;
  F._hasVisible = hasVisible;
  F._hasLineOfSight = hasLineOfSight;
  F.hasSeen = hasSeen;
  F.hasVisible = hasVisible;
  F.hasLineOfSight = hasLineOfSight;

  MM.fog = F;
})();
// ESM export (progressive migration)
export const fog = (typeof window!=='undefined' && window.MM) ? window.MM.fog : undefined;
export default fog;
