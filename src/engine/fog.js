// Fog of War module: tracks seen tiles and applies fog overlay
// API:
//  MM.fog.revealAround(px,py,r)
//  MM.fog.applyOverlay(ctx, sx, sy, viewX, viewY, TILE, getTile, T)
//  MM.fog.exportSeen() -> [{cx:number, data:string, rle:true}]
//  MM.fog.importSeen(list)
//  MM.fog.getRevealAll() / MM.fog.setRevealAll(v) / MM.fog.toggleRevealAll()
(function(){
  window.MM = window.MM || {};
  const F = {};

  let revealAll = false;
  const seenChunks = new Map(); // key: chunkX -> Uint8Array bitset (CHUNK_W*WORLD_H bits)

  function bytesPerChunk(){ const CHUNK_W = MM.CHUNK_W, WORLD_H = MM.WORLD_H; return Math.ceil((CHUNK_W*WORLD_H)/8); }
  function ensureSeenChunk(cx){ let arr = seenChunks.get(cx); if(!arr){ arr = new Uint8Array(bytesPerChunk()); seenChunks.set(cx, arr); } return arr; }
  function markSeen(x,y){ const CHUNK_W = MM.CHUNK_W, WORLD_H=MM.WORLD_H; if(y<0||y>=WORLD_H) return; const cx=Math.floor(x/CHUNK_W); let lx=x - cx*CHUNK_W; if(lx<0||lx>=CHUNK_W) return; const idx=y*CHUNK_W + lx; const arr=ensureSeenChunk(cx); arr[idx>>3] |= (1 << (idx & 7)); }
  function hasSeen(x,y){ const CHUNK_W=MM.CHUNK_W, WORLD_H=MM.WORLD_H; if(y<0||y>=WORLD_H) return false; const cx=Math.floor(x/CHUNK_W); const arr=seenChunks.get(cx); if(!arr) return false; const lx=x - cx*CHUNK_W; if(lx<0||lx>=CHUNK_W) return false; const idx=y*CHUNK_W + lx; return (arr[idx>>3] & (1 << (idx & 7)))!==0; }

  // Base64 helpers (local copy to avoid coupling)
  function _b64FromBytes(bytes){ let bin=''; for(let i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]); return btoa(bin); }
  function _bytesFromB64(b64){ const bin=atob(b64); const out=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i); return out; }
  function encodeRLE(arr){ const out=[]; for(let i=0;i<arr.length;){ const v=arr[i]; let run=1; while(i+run<arr.length && arr[i+run]===v && run<65535) run++; let remain=run; while(remain>0){ const take=Math.min(255,remain); out.push(v,take); remain-=take; } i+=run; } return _b64FromBytes(Uint8Array.from(out)); }
  function decodeRLE(b64,totalLen){ const bytes=_bytesFromB64(b64); const out=new Uint8Array(totalLen); let oi=0; for(let i=0;i<bytes.length; i+=2){ const v=bytes[i]; const count=bytes[i+1]; for(let r=0;r<count;r++) out[oi++]=v; } return out; }
  function decodeRaw(b64){ return _bytesFromB64(b64); }

  F.exportSeen = function(){ const out=[]; for(const [cx,buf] of seenChunks.entries()){ out.push({cx, data: encodeRLE(buf), rle:true}); } return out; };
  F.importSeen = function(list){ if(!Array.isArray(list)) return; seenChunks.clear(); const totalLen = bytesPerChunk(); for(const row of list){ if(typeof row.cx!=='number'||!row.data) continue; const arr=row.rle? decodeRLE(row.data, totalLen): decodeRaw(row.data); seenChunks.set(row.cx, arr); } };

  F.revealAround = function(px,py,r){ px=+px; py=+py; r=+r; const rr=r*r; for(let dx=-r; dx<=r; dx++){ const wx=Math.floor(px+dx); for(let dy=-r; dy<=r; dy++){ if(dx*dx+dy*dy<=rr){ markSeen(wx, Math.floor(py+dy)); } } } };

  F.applyOverlay = function(ctx, sx, sy, viewX, viewY, TILE, getTile, T){ if(revealAll) return; const WORLD_H=MM.WORLD_H; for(let y=sy; y<sy+viewY+2; y++){ if(y<0||y>=WORLD_H) continue; for(let x=sx; x<sx+viewX+2; x++){ if(!hasSeen(x,y)){ const t=getTile(x,y); if(t!==T.AIR){ ctx.fillStyle='rgba(0,0,0,.6)'; ctx.fillRect(x*TILE,y*TILE,TILE,TILE); } } } } };

  F.getRevealAll = function(){ return revealAll; };
  F.setRevealAll = function(v){ revealAll = !!v; };
  F.toggleRevealAll = function(){ revealAll = !revealAll; return revealAll; };

  // expose helpers if needed elsewhere
  F._markSeen = markSeen;
  F._hasSeen = hasSeen;

  MM.fog = F;
})();
