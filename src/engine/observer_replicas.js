// Atrapy obserwatora: at most three stationary hero likenesses that keep their
// exact 64x70 far-world simulation region awake.
//
// They deliberately are NOT co-op bodies. A fake body in MM.coopBodies would
// become a combat target, an SMR attendant, a cave-in victim and a party member.
// This bounded registry supplies a separate, coordinate-only anchor plane to
// world_sim.js instead.
import {
  CHUNK_W,
  HERO_BODY_H,
  HERO_BODY_W,
  INFO,
  T,
  WORLD_H,
  WORLD_MAX_Y,
  WORLD_MIN_Y,
  WORLD_SECTION_H
} from '../constants.js';
import { isSolidCollisionTile } from './material_physics.js';

export const MAX_OBSERVER_REPLICAS = 3;
export const OBSERVER_REPLICA_RESOURCE_KEY = 'observerReplica';
// At most three locally-paid placements may be unresolved per remembered guest
// identity. Ghost host retains at most 256 identities, so 768 success tombstones
// are enough without time-based expiry (expiry would permit an old qid to write
// the same paid copy again after its original tile was mined).
export const MAX_OBSERVER_ACCEPTED_TRANSACTIONS = 768;

export const OBSERVER_REPLICA_RESOURCE = Object.freeze({
  key: OBSERVER_REPLICA_RESOURCE_KEY,
  label: 'Atrapa obserwatora',
  color: '#7de8ff',
  tile: 'OBSERVER_REPLICA'
});

// Every copy doubles the same bill. Keeping the ingredient keys stable matters:
// recipe discovery learns material types once, while the live `cost` getter can
// still move through all three tiers after each successful craft.
export const OBSERVER_REPLICA_COSTS = Object.freeze([
  Object.freeze({steel:3, glass:2, copperWire:2, transistor:1, meteorDust:1}),
  Object.freeze({steel:6, glass:4, copperWire:4, transistor:2, meteorDust:2}),
  Object.freeze({steel:12, glass:8, copperWire:8, transistor:4, meteorDust:4})
]);

const root = typeof window !== 'undefined' ? window : globalThis;
const MM = root.MM = root.MM || {};
const cells = new Map(); // "x,y" -> frozen {x,y}; bounded by MAX_OBSERVER_REPLICAS
// Runtime flags deliberately stay out of the save wire:
// - durable: the transaction snapshot has reached durable storage;
// - ackPending: a receipt-removal snapshot is currently being committed.
// A pre-commit row still blocks qid reuse, but cannot produce a success replay.
const acceptedTransactions = new Map(); // gid\0qid -> frozen runtime record; bounded
let anchorCache = Object.freeze([]);
let cellCache = Object.freeze([]);
let cacheDirty = true;

const cellKey = (x,y) => x+','+y;
const regionKey = (x,y) => Math.floor(x/CHUNK_W)+','+Math.floor(y/WORLD_SECTION_H);
const validClaimGid = gid => typeof gid==='string' && /^g[a-zA-Z0-9._-]{1,39}$/.test(gid);
const validClaimQid = qid => typeof qid==='string' && /^o[0-9a-f]{24}$/.test(qid);

export function validTransactionClaim(gid,qid){
  return validClaimGid(gid) && validClaimQid(qid);
}

function transactionKey(gid,qid){ return gid+'\0'+qid; }

function acceptedRecord(gid,qid,p,durable,ackPending,action='place'){
  const normalizedAction=action==='mine' ? 'mine' : 'place';
  return Object.freeze(p
    ? {gid,qid,x:p.x,y:p.y,action:normalizedAction,durable:!!durable,ackPending:!!ackPending}
    : {gid,qid,action:normalizedAction,durable:!!durable,ackPending:!!ackPending});
}

function rememberAcceptedTransaction(gid,qid,x,y,opts={}){
  if(!validTransactionClaim(gid,qid)) return false;
  const key=transactionKey(gid,qid);
  const p=normalizeCell(x,y);
  const durable=!!opts.durable;
  const action=opts.action==='mine' ? 'mine' : 'place';
  const existing=acceptedTransactions.get(key);
  if(existing){
    const existingPoint=Number.isSafeInteger(existing.x) && Number.isSafeInteger(existing.y)
      ? {x:existing.x,y:existing.y}
      : null;
    const point=existingPoint || p;
    if((durable && !existing.durable) || (!existingPoint && p)){
      acceptedTransactions.set(key,acceptedRecord(
        gid,qid,point,existing.durable || durable,existing.ackPending,existing.action
      ));
    }
    return true;
  }
  if(acceptedTransactions.size>=MAX_OBSERVER_ACCEPTED_TRANSACTIONS) return false;
  acceptedTransactions.set(key,acceptedRecord(gid,qid,p,durable,false,action));
  return true;
}

export function wasTransactionAccepted(gid,qid){
  return validTransactionClaim(gid,qid) && acceptedTransactions.has(transactionKey(gid,qid));
}

export function canAcceptTransaction(gid,qid){
  if(!validTransactionClaim(gid,qid)) return false;
  return acceptedTransactions.has(transactionKey(gid,qid))
    || acceptedTransactions.size<MAX_OBSERVER_ACCEPTED_TRANSACTIONS;
}

export function acceptedTransaction(gid,qid){
  const row=transactionRecord(gid,qid);
  return row && row.durable && !row.ackPending ? Object.assign({},row) : null;
}

export function transactionRecord(gid,qid){
  if(!validTransactionClaim(gid,qid)) return null;
  const row=acceptedTransactions.get(transactionKey(gid,qid));
  return row ? Object.assign({},row) : null;
}

export function markTransactionDurable(gid,qid){
  if(!validTransactionClaim(gid,qid)) return false;
  const key=transactionKey(gid,qid);
  const row=acceptedTransactions.get(key);
  if(!row) return false;
  if(row.durable) return true;
  const p=Number.isSafeInteger(row.x) && Number.isSafeInteger(row.y)
    ? {x:row.x,y:row.y}
    : null;
  acceptedTransactions.set(key,acceptedRecord(row.gid,row.qid,p,true,row.ackPending,row.action));
  return true;
}

// Persistence failure before a placement becomes durable leaves the client qid
// unresolved. Dropping only that transient proof lets its retry recreate the
// row without weakening any already-committed replay tombstone.
export function discardNonDurableTransaction(gid,qid){
  if(!validTransactionClaim(gid,qid)) return false;
  const key=transactionKey(gid,qid);
  const row=acceptedTransactions.get(key);
  if(!row || row.durable) return false;
  return acceptedTransactions.delete(key);
}

// Receipt compaction is two-phase. Begin hides the row from the next snapshot;
// finalize removes it only after that snapshot commits, or makes it replayable
// again if persistence fails.
export function beginTransactionAcknowledgement(gid,qid){
  if(!validTransactionClaim(gid,qid)) return false;
  const key=transactionKey(gid,qid);
  const row=acceptedTransactions.get(key);
  if(!row || !row.durable || row.ackPending) return false;
  const p=Number.isSafeInteger(row.x) && Number.isSafeInteger(row.y)
    ? {x:row.x,y:row.y}
    : null;
  acceptedTransactions.set(key,acceptedRecord(row.gid,row.qid,p,true,true,row.action));
  return true;
}

export function finalizeTransactionAcknowledgement(gid,qid,succeeded){
  if(!validTransactionClaim(gid,qid)) return false;
  const key=transactionKey(gid,qid);
  const row=acceptedTransactions.get(key);
  if(!row || !row.ackPending) return false;
  if(succeeded) return acceptedTransactions.delete(key);
  const p=Number.isSafeInteger(row.x) && Number.isSafeInteger(row.y)
    ? {x:row.x,y:row.y}
    : null;
  acceptedTransactions.set(key,acceptedRecord(row.gid,row.qid,p,row.durable,false,row.action));
  return true;
}

// Mining removes terrain before its durability commit, so its replay proof
// cannot be attached to a live observer cell. The same bounded transaction map
// retains the removed coordinate and action without consuming an active anchor.
export function claimDetachedTransaction(gid,qid,x,y){
  if(!validTransactionClaim(gid,qid)) return false;
  if(!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return false;
  const p=normalizeCell(x,y);
  if(!p) return false;
  const key=transactionKey(gid,qid);
  if(acceptedTransactions.has(key)
    || acceptedTransactions.size>=MAX_OBSERVER_ACCEPTED_TRANSACTIONS) return false;
  acceptedTransactions.set(key,acceptedRecord(gid,qid,p,false,false,'mine'));
  return true;
}

function normalizeCell(x,y){
  x = Number(x); y = Number(y);
  if(!Number.isFinite(x) || !Number.isFinite(y)) return null;
  x = Math.floor(x); y = Math.floor(y);
  if(!Number.isSafeInteger(x) || y < WORLD_MIN_Y || y >= WORLD_MAX_Y) return null;
  return {x,y,key:cellKey(x,y)};
}

function safeTile(getTile,x,y){
  if(typeof getTile !== 'function') return T.AIR;
  try{
    const tile = getTile(x,y);
    return Number.isInteger(tile) && INFO[tile] ? tile : T.AIR;
  }catch(_e){
    return T.AIR;
  }
}

function markDirty(){ cacheDirty = true; }

function rebuildCaches(){
  if(!cacheDirty) return;
  const ordered = [...cells.values()].sort((a,b)=>(a.x-b.x)||(a.y-b.y));
  cellCache = Object.freeze(ordered.map(p=>Object.freeze({x:p.x,y:p.y})));
  anchorCache = Object.freeze(ordered.map(p=>Object.freeze({
    x:p.x+0.5,
    y:p.y+0.5,
    enabled:true
  })));
  cacheDirty = false;
}

export function count(){ return cells.size; }

export function activeCells(){
  rebuildCaches();
  return cellCache;
}

export function activeAnchors(){
  rebuildCaches();
  return anchorCache;
}

export function hasAt(x,y){
  const p=normalizeCell(x,y);
  return !!p && cells.has(p.key);
}

// The host's volatile outcome cache handles ordinary retries. This tiny claim,
// stored beside the observer coordinate, proves the original (gid,qid) after a
// host restart. Merely finding the same tile is not replay proof: another guest
// may have placed it with a different locally-paid copy.
export function claimTransactionAt(x,y,gid,qid){
  const p=normalizeCell(x,y);
  if(!p || !canAcceptTransaction(gid,qid)) return false;
  const existing=acceptedTransactions.get(transactionKey(gid,qid));
  if(existing && existing.action!=='place') return false;
  const cell=cells.get(p.key);
  if(!cell) return false;
  if(cell.gid || cell.qid){
    if(cell.gid!==gid || cell.qid!==qid) return false;
    return rememberAcceptedTransaction(gid,qid,cell.x,cell.y);
  }
  cells.set(p.key,Object.freeze({x:cell.x,y:cell.y,key:cell.key,gid,qid}));
  rememberAcceptedTransaction(gid,qid,cell.x,cell.y);
  markDirty();
  return true;
}

export function matchesTransaction(x,y,gid,qid){
  const p=normalizeCell(x,y);
  if(!p || !validTransactionClaim(gid,qid)) return false;
  const cell=cells.get(p.key);
  return !!cell && cell.gid===gid && cell.qid===qid;
}

export function regionAt(x,y){
  const p=normalizeCell(x,y);
  if(!p) return null;
  const cx=Math.floor(p.x/CHUNK_W), sy=Math.floor(p.y/WORLD_SECTION_H);
  return Object.freeze({
    cx,sy,
    x:cx*CHUNK_W,
    y:sy*WORLD_SECTION_H,
    w:CHUNK_W,
    h:WORLD_SECTION_H,
    key:cx+','+sy
  });
}

function regionOccupiedByOther(p){
  const wanted=regionKey(p.x,p.y);
  for(const cell of cells.values()){
    if(cell.key!==p.key && regionKey(cell.x,cell.y)===wanted) return true;
  }
  return false;
}

// This is the final cap gate used by world.js itself. UI/host placement
// validation gives a useful reason first, but undo, scripts and engine writers
// all converge on the terrain writer and therefore cannot leave a fourth raw
// observer tile behind.
export function canAcceptTileChange(x,y,oldTile,nextTile){
  const p=normalizeCell(x,y);
  if(!p) return false;
  if(nextTile!==T.OBSERVER_REPLICA || oldTile===T.OBSERVER_REPLICA) return true;
  if(cells.has(p.key)) return true;
  return !regionOccupiedByOther(p) && cells.size<MAX_OBSERVER_REPLICAS;
}

// Chunk-cache authority follows the bounded registry, not raw terrain ids.
// This prevents a malformed save containing thousands of tile id 150 values
// from pinning thousands of chunks in memory.
export function pinsChunk(cx,sy,base){
  cx=Number(cx);
  if(!Number.isFinite(cx)) return false;
  cx=Math.floor(cx);
  const section=Number.isFinite(Number(sy)) ? Math.floor(Number(sy)) : null;
  for(const p of cells.values()){
    if(Math.floor(p.x/CHUNK_W)!==cx) continue;
    if(base){
      if(p.y>=0 && p.y<WORLD_H) return true;
    }else if(section!==null && Math.floor(p.y/WORLD_SECTION_H)===section){
      return true;
    }
  }
  return false;
}

// Whole-chunk replacement is intentionally hook-free. World.js calls this
// bounded reconciliation afterward so removing/replacing a chunk cannot leave
// a phantom hot anchor behind.
export function reconcileChunk(cx,sy,base,peekTile){
  if(typeof peekTile!=='function') return 0;
  const doomed=[];
  for(const p of cells.values()){
    if(Math.floor(p.x/CHUNK_W)!==Math.floor(Number(cx))) continue;
    const inChunk=base
      ? p.y>=0 && p.y<WORLD_H
      : Number.isFinite(Number(sy)) && Math.floor(p.y/WORLD_SECTION_H)===Math.floor(Number(sy));
    if(inChunk && safeTile(peekTile,p.x,p.y)!==T.OBSERVER_REPLICA) doomed.push(p.key);
  }
  for(const key of doomed) cells.delete(key);
  if(doomed.length) markDirty();
  return doomed.length;
}

// Shared by local preview/placement and the host-authoritative guest placement
// seam. Cap validation happens before water displacement or any tile write.
export function validatePlacement(x,y,getTile,opts={}){
  const p=normalizeCell(x,y);
  if(!p) return {ok:false,applies:true,reason:'Nieprawidlowe miejsce'};
  if(!cells.has(p.key) && regionOccupiedByOther(p)){
    return {ok:false,applies:true,code:'region',reason:'Ten region 64x70 ma juz atrape obserwatora'};
  }
  if(!opts.ignoreCap && !cells.has(p.key) && cells.size>=MAX_OBSERVER_REPLICAS){
    return {ok:false,applies:true,code:'limit',reason:'Mozesz miec najwyzej 3 aktywne atrapy obserwatora'};
  }
  const below=safeTile(getTile,p.x,p.y+1);
  if(!isSolidCollisionTile(below)){
    return {ok:false,applies:true,code:'support',reason:'Atrapa obserwatora musi stac na solidnej podlodze'};
  }
  return {ok:true,applies:true,support:'floor'};
}

// Synchronous tile lifecycle hook. Callers must validate the cap before writing:
// world.notifyTileChanged intentionally ignores hook return values.
export function onTileChanged(x,y,oldTile,nextTile){
  const p=normalizeCell(x,y);
  if(!p) return false;
  if(oldTile===T.OBSERVER_REPLICA && nextTile!==T.OBSERVER_REPLICA){
    const removed=cells.delete(p.key);
    if(removed) markDirty();
    return true;
  }
  if(nextTile!==T.OBSERVER_REPLICA) return true;
  if(cells.has(p.key)) return true;
  if(regionOccupiedByOther(p)) return false;
  if(cells.size>=MAX_OBSERVER_REPLICAS) return false;
  cells.set(p.key,Object.freeze({x:p.x,y:p.y,key:p.key}));
  markDirty();
  // A full-hero guest spends its local item before the host-authoritative tile
  // reaches the stream. Main owns the tiny pending-intent ledger; activation is
  // the point where that temporary ownership becomes registry ownership.
  try{
    if(typeof MM.onObserverReplicaActivated==='function') MM.onObserverReplicaActivated(p.x,p.y);
  }catch(_e){}
  return true;
}

export function reset(){
  cells.clear();
  acceptedTransactions.clear();
  markDirty();
}

export function snapshot(){
  const ordered=[...cells.values()].sort((a,b)=>(a.x-b.x)||(a.y-b.y));
  const out={
    v:1,
    list:ordered.map(p=>validTransactionClaim(p.gid,p.qid)
      ? [p.x,p.y,p.gid,p.qid]
      : [p.x,p.y])
  };
  if(acceptedTransactions.size){
    const accepted=[...acceptedTransactions.values()].filter(row=>!row.ackPending)
      .map(row=>{
        const positioned=Number.isSafeInteger(row.x) && Number.isSafeInteger(row.y);
        if(row.action==='mine') return positioned
          ? [row.gid,row.qid,row.x,row.y,'mine']
          : null;
        return positioned ? [row.gid,row.qid,row.x,row.y] : [row.gid,row.qid];
      })
      .filter(Boolean);
    if(accepted.length) out.accepted=accepted;
  }
  return out;
}

// Whole-chunk save restore does not emit per-cell tile hooks, so the bounded
// coordinate sidecar is authoritative for activation. Every row is checked
// against tile truth; malformed, duplicate, excess and stale rows are ignored.
// Temporal coordinate rewind is deliberately narrower: transaction outcomes
// describe real multiplayer commits and remain exactly as they are at runtime.
export function restore(data,peekTile,worldApi,opts={}){
  const temporal=!!(opts && opts.temporal);
  cells.clear();
  if(!temporal) acceptedTransactions.clear();
  markDirty();
  if(!data || data.v!==1 || !Array.isArray(data.list) || typeof peekTile!=='function') return false;
  if(!temporal && Array.isArray(data.accepted)){
    for(const row of data.accepted.slice(0,MAX_OBSERVER_ACCEPTED_TRANSACTIONS*4)){
      if(!Array.isArray(row) || row.length<2) continue;
      const action=row[4]==='mine' ? 'mine' : 'place';
      if(action==='mine' && (
        !Number.isSafeInteger(row[2])
        || !Number.isSafeInteger(row[3])
        || !normalizeCell(row[2],row[3])
      )) continue;
      rememberAcceptedTransaction(row[0],row[1],row[2],row[3],{durable:true,action});
    }
  }
  // A valid save contains at most three rows. A small scan allowance tolerates
  // duplicates/stale rows while keeping hostile JSON work strictly bounded.
  const scan=data.list.slice(0,MAX_OBSERVER_REPLICAS*4);
  for(const row of scan){
    if(cells.size>=MAX_OBSERVER_REPLICAS) break;
    if(!Array.isArray(row) || row.length<2) continue;
    if(!Number.isSafeInteger(row[0]) || !Number.isSafeInteger(row[1])) continue;
    const p=normalizeCell(row[0],row[1]);
    if(!p || cells.has(p.key)) continue;
    if(safeTile(peekTile,p.x,p.y)!==T.OBSERVER_REPLICA) continue;
    if(regionOccupiedByOther(p)) continue;
    const claimed=validTransactionClaim(row[2],row[3]);
    cells.set(p.key,Object.freeze(claimed
      ? {x:p.x,y:p.y,key:p.key,gid:row[2],qid:row[3]}
      : {x:p.x,y:p.y,key:p.key}));
  }
  markDirty();
  ensureResident(worldApi);
  return true;
}

// Observer chunks are also marked never-park in world.js. This eager touch is
// useful on restore: their registered machines can run immediately rather than
// paying a park/rehydrate turn on the first simulation frame.
export function ensureResident(worldApi){
  if(!worldApi || typeof worldApi.ensureSection!=='function') return 0;
  const seen=new Set();
  let ensured=0;
  for(const p of cells.values()){
    const cx=Math.floor(p.x/CHUNK_W), sy=Math.floor(p.y/WORLD_SECTION_H);
    const key=cx+','+sy;
    if(seen.has(key)) continue;
    seen.add(key);
    try{ if(worldApi.ensureSection(cx,sy)) ensured++; }catch(_e){}
  }
  return ensured;
}

function externalOwnedCount(source){
  let raw=source;
  try{ if(typeof source==='function') raw=source(); }catch(_e){ raw=0; }
  const n=Number(raw);
  return Number.isFinite(n) ? Math.max(0,Math.floor(n)) : 0;
}

export function ownedCount(inventory,externalOwned){
  const bag=inventory && Number(inventory[OBSERVER_REPLICA_RESOURCE_KEY]);
  return cells.size
    + (Number.isFinite(bag) ? Math.max(0,Math.floor(bag)) : 0)
    + externalOwnedCount(externalOwned);
}

export function costForNext(inventory,externalOwned){
  const index=ownedCount(inventory,externalOwned);
  return index>=0 && index<MAX_OBSERVER_REPLICAS ? OBSERVER_REPLICA_COSTS[index] : null;
}

export function createRecipe(opts={}){
  const inventory=opts.inventory || {};
  const notify=typeof opts.notify==='function' ? opts.notify : ()=>{};
  const externalOwned=opts.externalOwned;
  return {
    id:'observer_replica',
    name:'Atrapa obserwatora',
    group:'machines',
    icon:'◎',
    tint:'#7de8ff',
    out:OBSERVER_REPLICA_RESOURCE_KEY,
    amount:1,
    batchCap:1,
    desc:'Zakotwiczona kopia bohatera. Utrzymuje regionalna automatyke (bez stworzen i osobistego SMR) w siatkowym regionie 64x70. Kazda kolejna kosztuje 2x wiecej. Mozesz posiadac lacznie 3 (postawione, w plecaku albo do odzyskania), po jednej aktywnej na region.',
    get cost(){
      return costForNext(inventory,externalOwned) || OBSERVER_REPLICA_COSTS[MAX_OBSERVER_REPLICAS-1];
    },
    done:()=>ownedCount(inventory,externalOwned)>=MAX_OBSERVER_REPLICAS,
    doneText:()=>`Limit ${MAX_OBSERVER_REPLICAS}/${MAX_OBSERVER_REPLICAS} - wszystkie atrapy sa juz postawione, w plecaku albo czekaja na odzyskanie.`,
    make(){
      const before=ownedCount(inventory,externalOwned);
      if(before>=MAX_OBSERVER_REPLICAS){
        notify('Limit 3 atrap obserwatora zostal osiagniety');
        return false;
      }
      inventory[OBSERVER_REPLICA_RESOURCE_KEY]=(Number(inventory[OBSERVER_REPLICA_RESOURCE_KEY])||0)+1;
      notify('Atrapa obserwatora '+(before+1)+'/'+MAX_OBSERVER_REPLICAS+' gotowa'
        +(before+1<MAX_OBSERVER_REPLICAS?' - kolejna kosztuje 2x wiecej':''));
      return true;
    }
  };
}

// Dynamic art uses the hero's current outfit, so every placed copy remains a
// recognizable bogus likeness without a mutable appearance side-channel in
// multiplayer saves. Cyan scan-lines make it unmistakably artificial.
export function drawTile(g,px,py,tileSize=20,opts={}){
  if(!g) return false;
  const size=Math.max(4,Number(tileSize)||20);
  const customization=opts.customization || MM.customization || {};
  const drawOutfit=opts.drawOutfit || MM.drawOutfit;
  const bodyW=size*HERO_BODY_W, bodyH=size*HERO_BODY_H;
  const bodyX=px+(size-bodyW)*0.5, bodyY=py+size-bodyH;
  const now=Number.isFinite(opts.now) ? opts.now : Date.now();
  const phase=(now*0.003 + (opts.index||0)*1.7)%(Math.PI*2);
  const pulse=0.5+0.5*Math.sin(phase);
  g.save();
  g.globalAlpha*=0.94;
  g.fillStyle='rgba(20,42,58,0.38)';
  g.beginPath();
  g.ellipse(px+size*0.5,py+size*0.93,size*0.34,size*0.09,0,0,Math.PI*2);
  g.fill();
  if(String(customization.capeStyle||'classic').toLowerCase()!=='none'){
    g.fillStyle=customization.capeColor||'#5a64d8';
    g.globalAlpha*=0.72;
    g.beginPath();
    g.moveTo(bodyX+bodyW*0.18,bodyY+bodyH*0.24);
    g.lineTo(bodyX-size*0.12,bodyY+bodyH*0.90);
    g.lineTo(bodyX+bodyW*0.48,bodyY+bodyH*0.78);
    g.closePath();
    g.fill();
    g.globalAlpha/=0.72;
  }
  const style=String(customization.outfitStyle||'default').trim().toLowerCase();
  if(typeof drawOutfit==='function'){
    try{ drawOutfit(g,bodyX,bodyY,bodyW,bodyH,style,customization); }
    catch(_e){
      g.fillStyle=customization.outfitColor||'#f4c05a';
      g.fillRect(bodyX,bodyY,bodyW,bodyH);
    }
  }else{
    g.fillStyle=customization.outfitColor||'#f4c05a';
    g.fillRect(bodyX,bodyY,bodyW,bodyH);
  }
  g.fillStyle='rgba(75,235,255,'+(0.14+0.08*pulse).toFixed(3)+')';
  g.fillRect(bodyX,bodyY,bodyW,bodyH);
  const eyeY=bodyY+bodyH*0.35, eyeGap=bodyW*0.18;
  g.fillStyle='rgba(236,255,255,0.96)';
  g.fillRect(bodyX+bodyW*0.5-eyeGap-size*0.075,eyeY,size*0.15,Math.max(1,size*0.08));
  g.fillRect(bodyX+bodyW*0.5+eyeGap-size*0.075,eyeY,size*0.15,Math.max(1,size*0.08));
  g.fillStyle='#49efff';
  g.fillRect(bodyX+bodyW*0.5-eyeGap,eyeY,Math.max(1,size*0.04),Math.max(1,size*0.08));
  g.fillRect(bodyX+bodyW*0.5+eyeGap,eyeY,Math.max(1,size*0.04),Math.max(1,size*0.08));
  g.fillStyle='rgba(55,230,255,0.52)';
  const scanY=bodyY+(0.1+0.75*((now*0.00045+(opts.index||0)*0.23)%1))*bodyH;
  g.fillRect(bodyX-size*0.08,scanY,bodyW+size*0.16,Math.max(1,size*0.045));
  g.fillStyle='rgba(8,31,43,0.92)';
  g.fillRect(px+size*0.20,py+size*0.88,size*0.60,size*0.09);
  g.fillStyle='rgba(91,244,255,0.88)';
  g.fillRect(px+size*0.26,py+size*0.89,size*0.48,Math.max(1,size*0.035));
  g.restore();
  return true;
}

export function drawWorld(g,tileSize,visibleAt,opts={}){
  let drawn=0;
  const now=Number.isFinite(opts.now) ? opts.now : Date.now();
  const list=activeCells();
  for(let i=0;i<list.length;i++){
    const p=list[i];
    if(typeof visibleAt==='function' && !visibleAt(p.x,p.y)) continue;
    if(drawTile(g,p.x*tileSize,p.y*tileSize,tileSize,Object.assign({},opts,{now,index:i}))) drawn++;
  }
  return drawn;
}

export function metrics(){
  let durableTransactions=0, acknowledgementPending=0;
  for(const row of acceptedTransactions.values()){
    if(row.durable) durableTransactions++;
    if(row.ackPending) acknowledgementPending++;
  }
  return {
    count:cells.size,
    cap:MAX_OBSERVER_REPLICAS,
    acceptedTransactions:acceptedTransactions.size,
    durableTransactions,
    acknowledgementPending,
    regions:new Set([...cells.values()].map(p=>Math.floor(p.x/CHUNK_W)+','+Math.floor(p.y/WORLD_SECTION_H))).size
  };
}

export const observerReplicas = Object.freeze({
  MAX:MAX_OBSERVER_REPLICAS,
  ACCEPTED_TX_MAX:MAX_OBSERVER_ACCEPTED_TRANSACTIONS,
  RESOURCE_KEY:OBSERVER_REPLICA_RESOURCE_KEY,
  COSTS:OBSERVER_REPLICA_COSTS,
  count,
  activeCells,
  activeAnchors,
  hasAt,
  validTransactionClaim,
  canAcceptTransaction,
  claimTransactionAt,
  matchesTransaction,
  wasTransactionAccepted,
  transactionRecord,
  acceptedTransaction,
  markTransactionDurable,
  discardNonDurableTransaction,
  beginTransactionAcknowledgement,
  finalizeTransactionAcknowledgement,
  claimDetachedTransaction,
  regionAt,
  canAcceptTileChange,
  pinsChunk,
  reconcileChunk,
  validatePlacement,
  onTileChanged,
  reset,
  snapshot,
  restore,
  ensureResident,
  ownedCount,
  costForNext,
  createRecipe,
  drawTile,
  drawWorld,
  metrics
});

MM.observerReplicas=observerReplicas;
export default observerReplicas;
