// Fog of War module: tracks seen tiles and applies fog overlay
// API:
//  MM.fog.revealAround(px,py,r,{lineOfSight,getTile,blocksSight,rememberSeen})
//  MM.fog.applyOverlay(ctx, sx, sy, viewX, viewY, TILE, getTile, T, {showMemory})
//  MM.fog.exportSeen() -> [{cx:number, data:string, rle:true}]
//  MM.fog.importSeen(list)
//  MM.fog.getRevealAll() / MM.fog.setRevealAll(v) / MM.fog.toggleRevealAll()
import { CHUNK_W, WORLD_H } from '../constants.js';
import { isAirOrGasTile, isGasTile } from './material_physics.js';
(function(){
  window.MM = window.MM || {};
  const F = {};

  let revealAll = false;
  const seenChunks = new Map(); // key: chunkX -> Uint8Array bitset (CHUNK_W*WORLD_H bits)
  const visibleChunks = new Map(); // current frame visibility; rebuilt by revealAround()

  function bytesPerChunk(){ return Math.ceil((CHUNK_W*WORLD_H)/8); }
  function ensureSeenChunk(cx){ let arr = seenChunks.get(cx); if(!arr){ arr = new Uint8Array(bytesPerChunk()); seenChunks.set(cx, arr); } return arr; }
  function ensureVisibleChunk(cx){ let arr = visibleChunks.get(cx); if(!arr){ arr = new Uint8Array(bytesPerChunk()); visibleChunks.set(cx, arr); } return arr; }
  function setBit(map,ensure,x,y){ if(y<0||y>=WORLD_H) return; const cx=Math.floor(x/CHUNK_W); let lx=x - cx*CHUNK_W; if(lx<0||lx>=CHUNK_W) return; const idx=y*CHUNK_W + lx; const arr=ensure(cx); arr[idx>>3] |= (1 << (idx & 7)); }
  function getBit(map,x,y){ if(y<0||y>=WORLD_H) return false; const cx=Math.floor(x/CHUNK_W); const arr=map.get(cx); if(!arr) return false; const lx=x - cx*CHUNK_W; if(lx<0||lx>=CHUNK_W) return false; const idx=y*CHUNK_W + lx; return (arr[idx>>3] & (1 << (idx & 7)))!==0; }
  function markSeen(x,y){ if(y<0||y>=WORLD_H) return; const cx=Math.floor(x/CHUNK_W); let lx=x - cx*CHUNK_W; if(lx<0||lx>=CHUNK_W) return; const idx=y*CHUNK_W + lx; const arr=ensureSeenChunk(cx); arr[idx>>3] |= (1 << (idx & 7)); }
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

  F.exportSeen = function(){ const out=[]; for(const [cx,buf] of seenChunks.entries()){ out.push({cx, data: encodeRLE(buf), rle:true}); } return out; };
  F.importSeen = function(list){ if(!Array.isArray(list)) return; seenChunks.clear(); const totalLen = bytesPerChunk(); for(const row of list){ if(typeof row.cx!=='number'||!row.data) continue; const arr=row.rle? decodeRLE(row.data, totalLen): decodeRaw(row.data); seenChunks.set(row.cx, arr); } };

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

  // Fog covers unseen solid tiles AND unseen underground air, so undiscovered caves
  // stay hidden instead of reading as silhouettes against the cave backdrop
  F.applyOverlay = function(ctx, sx, sy, viewX, viewY, TILE, getTile, T, opts){
    if(revealAll) return;
    const showMemory=!(opts && opts.showMemory===false);
    const WGen=(window.MM && MM.worldGen && MM.worldGen.surfaceHeight)? MM.worldGen : null;
    const xEnd=sx+viewX+2;
    // The unknown fog is an opaque final mask; a tiny overlap hides zoom/camera
    // subpixel cracks without changing the readable shape of exposed terrain.
    const blackSeamOverlap = TILE>=8 ? Math.max(1, Math.min(2, TILE*0.05)) : 0;
    const gasSkyExposed=(x,y)=>{
      const gas=(window.MM && MM.gases && typeof MM.gases.skyExposed==='function') ? MM.gases : null;
      if(gas) return gas.skyExposed(x,y,getTile);
      for(let yy=y-1; yy>=0; yy--){
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
      const x=r.x0*TILE, y=r.y0*TILE;
      const w=(r.x1-r.x0)*TILE, h=(r.y1-r.y0+1)*TILE;
      if(r.style==='#000' && blackSeamOverlap>0){
        const o=blackSeamOverlap;
        ctx.fillRect(x-o,y-o,w+o*2,h+o*2);
      } else {
        ctx.fillRect(x,y,w,h);
      }
    };
    let pendingRuns=new Map();
    for(let y=sy; y<sy+viewY+2; y++){
      if(y<0||y>=WORLD_H) continue;
      const rowRuns=[];
      let runStart=0, runStyle=null;
      const flushRun=(x)=>{
        if(!runStyle) return;
        rowRuns.push({x0:runStart,x1:x,style:runStyle});
        runStyle=null;
      };
      for(let x=sx; x<xEnd; x++){
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
