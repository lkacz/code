// The world's home on disk — IndexedDB instead of localStorage.
//
// WHY THIS EXISTS
// localStorage gave this game 4.94 MB (measured, Edge) for the entire world,
// synchronously, as strings. A corridor 4800 columns long already costs ~870 KB,
// so a genuinely explored and built-in world hit the ceiling and autosave simply
// stopped: banner up, last good save preserved, no new writes. Worse, the old
// incremental autosave re-encoded and rewrote EVERY modified chunk on every run,
// so the cost of saving grew with the size of the world rather than with the
// number of things the player had just changed.
//
// This store fixes both:
//   * IndexedDB's budget is a share of free disk, not five megabytes;
//   * one record per chunk, so a save writes ONLY the chunks whose version moved
//     since the last write — a 20 000-chunk world saves three edited chunks as
//     fast as a brand new one does;
//   * chunks and the manifest are published in ONE readwrite transaction, so a
//     tab killed mid-write rolls back instead of leaving a torn world (something
//     localStorage could never promise across its many keys).
//
// WHAT IT DELIBERATELY DOES NOT CHANGE
// The chunk payload is the SAME base64 RLE string the save format already uses,
// carrying the same FNV hash. Nothing about the codec, the integrity checks or
// the portable export changes — the records simply live somewhere with room.
//
// THE ASYNC SEAM
// IndexedDB cannot be read or written synchronously, and `pagehide` gives no
// chance to await anything. So the last unflushed deltas go to a small
// SYNCHRONOUS write-ahead log in localStorage (bounded, a few chunks), which the
// next boot replays over the store before the world is assembled. The player's
// last seconds of digging survive a closed tab; the store stays the truth.
//
// Node has no IndexedDB, so the module falls back to an in-memory backend with
// the same surface. That is what tools/save-store-sim.test.mjs exercises; the
// real IndexedDB path is proven live in tools/save-load-qa.mjs.

(function(){
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const MM = root.MM = root.MM || {};

  const DB_NAME = 'mm_world_v1';
  const DB_VERSION = 1;
  const STORE_CHUNKS = 'chunks';
  const STORE_META = 'meta';
  const STORE_SLOTS = 'slots';
  const ACTIVE_KEY = 'active';
  // The WAL is the only part of this module that touches localStorage, and it is
  // deliberately tiny: it exists to carry the last few seconds across a closed
  // tab, not to be a second save format.
  const WAL_KEY = 'mm_world_wal_v1';
  const WAL_ACK_KEY = 'mm_world_wal_ack_v1';
  const WAL_MAX_CHUNKS = 64;
  const WAL_MAX_BYTES = 384 * 1024;
  const WAL_META_MAX_BYTES = 96 * 1024;
  // A store write that claims more chunks than this is refusing to be a world;
  // the caller's own cap is stricter, this is the backstop.
  const MAX_CHUNK_RECORDS = 262144;

  let db = null;
  let backendName = '';
  let openPromise = null;
  let lastError = '';
  const memory = { chunks: new Map(), meta: new Map(), slots: new Map() };
  const stats = { reads: 0, writes: 0, chunkPuts: 0, chunkDeletes: 0, walReplays: 0, failures: 0 };

  function hasIndexedDB(){
    try{ return typeof root.indexedDB === 'object' && root.indexedDB !== null && typeof root.indexedDB.open === 'function'; }
    catch(e){ return false; }
  }
  function req(request){
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
  }
  function txDone(tx){
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      // A quota failure surfaces here as a DOMException named QuotaExceededError,
      // which main.js's isQuotaSaveError already understands — keep it intact
      // instead of wrapping it in a generic Error.
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    });
  }
  function openIndexedDB(){
    return new Promise((resolve, reject) => {
      let request;
      try{ request = root.indexedDB.open(DB_NAME, DB_VERSION); }
      catch(e){ reject(e); return; }
      request.onupgradeneeded = () => {
        const handle = request.result;
        if(!handle.objectStoreNames.contains(STORE_CHUNKS)){
          const chunks = handle.createObjectStore(STORE_CHUNKS, {keyPath:'k'});
          // Every read and every world wipe is scoped to one seed, so the index
          // is the difference between a cursor over one world and a scan of all.
          chunks.createIndex('seed', 'seed', {unique:false});
        }
        if(!handle.objectStoreNames.contains(STORE_META)) handle.createObjectStore(STORE_META, {keyPath:'k'});
        if(!handle.objectStoreNames.contains(STORE_SLOTS)) handle.createObjectStore(STORE_SLOTS, {keyPath:'k'});
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
      // Another tab holding an old version open: do not hang the boot on it.
      request.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'));
    });
  }
  // Ask the browser not to evict the world under storage pressure. Best effort:
  // a refusal is not a failure, it only means the data is "best effort" durable.
  function requestPersistence(){
    try{
      if(root.navigator && root.navigator.storage && typeof root.navigator.storage.persist === 'function'){
        root.navigator.storage.persist().catch(()=>{});
      }
    }catch(e){}
  }
  async function open(){
    if(backendName) return backendName;
    if(openPromise) return openPromise;
    openPromise = (async () => {
      if(hasIndexedDB()){
        try{
          db = await openIndexedDB();
          db.onversionchange = () => { try{ db.close(); }catch(e){} db = null; backendName = ''; openPromise = null; };
          backendName = 'idb';
          requestPersistence();
          return backendName;
        }catch(e){
          lastError = String(e && (e.name || e.message) || 'idb-open-failed');
          db = null;
        }
      }
      // No IndexedDB (Node, or a browser mode that refuses it): a memory backend
      // keeps the API honest for tests and lets a session run without persistence
      // rather than crashing. main.js falls back to its localStorage path when
      // this is what it gets.
      backendName = 'memory';
      return backendName;
    })();
    return openPromise;
  }
  function ready(){ return backendName === 'idb' || backendName === 'memory'; }
  function persistent(){ return backendName === 'idb'; }

  function chunkKey(seed, cx, sy){
    const base = String(seed) + '|' + String(cx);
    return (sy == null) ? base : (base + '|' + String(sy));
  }
  function validRecord(rec){
    return !!rec && Number.isInteger(rec.cx) && typeof rec.data === 'string' && rec.data.length > 0
      && typeof rec.h === 'string' && /^[0-9a-f]{8}$/i.test(rec.h)
      && (rec.sy == null || Number.isInteger(rec.sy));
  }

  // ---------------------------------------------------------------- read
  // Just the pointer: which world does the store hold, and how fresh is it? The
  // boot uses this to decide between the store and a localStorage save (a world
  // fork writes one) without paying for a full chunk read it may not need.
  async function readActiveMeta(){
    await open();
    if(backendName === 'memory'){
      const rec = memory.meta.get(ACTIVE_KEY);
      return rec ? {seed:rec.seed, savedAt:rec.savedAt, chunkCount:rec.chunkCount} : null;
    }
    const tx = db.transaction([STORE_META], 'readonly');
    const rec = await req(tx.objectStore(STORE_META).get(ACTIVE_KEY));
    return rec ? {seed:rec.seed, savedAt:rec.savedAt, chunkCount:rec.chunkCount} : null;
  }
  // One pass over one world. Returns the manifest envelope plus every chunk
  // payload, keyed the way main.js keys its own chunk refs.
  async function readActive(){
    await open();
    stats.reads++;
    if(backendName === 'memory'){
      const manifest = memory.meta.get(ACTIVE_KEY) || null;
      if(!manifest) return null;
      const chunks = new Map();
      for(const [k, rec] of memory.chunks){
        if(rec.seed !== manifest.seed) continue;
        chunks.set(k, {cx:rec.cx, sy:rec.sy == null ? null : rec.sy, ver:rec.ver, data:rec.data, h:rec.h});
      }
      return {manifest:manifest.data, seed:manifest.seed, savedAt:manifest.savedAt, chunkCount:manifest.chunkCount, chunks};
    }
    const tx = db.transaction([STORE_META, STORE_CHUNKS], 'readonly');
    const metaRec = await req(tx.objectStore(STORE_META).get(ACTIVE_KEY));
    if(!metaRec){ try{ tx.abort(); }catch(e){} return null; }
    const chunks = new Map();
    await new Promise((resolve, reject) => {
      const index = tx.objectStore(STORE_CHUNKS).index('seed');
      const cursor = index.openCursor(IDBKeyRange.only(metaRec.seed));
      cursor.onsuccess = () => {
        const cur = cursor.result;
        if(!cur){ resolve(true); return; }
        const rec = cur.value;
        if(rec && typeof rec.data === 'string') chunks.set(rec.k, {cx:rec.cx, sy:rec.sy == null ? null : rec.sy, ver:rec.ver, data:rec.data, h:rec.h});
        cur.continue();
      };
      cursor.onerror = () => reject(cursor.error || new Error('chunk cursor failed'));
    });
    return {manifest:metaRec.data, seed:metaRec.seed, savedAt:metaRec.savedAt, chunkCount:metaRec.chunkCount, chunks};
  }

  // ---------------------------------------------------------------- write
  // ONE transaction: the changed chunks, the removed chunks and the manifest that
  // declares them. Either the whole save lands or none of it does.
  async function writeDelta(opts){
    await open();
    const seed = opts && opts.seed;
    const manifest = opts && opts.manifest;
    const upserts = (opts && Array.isArray(opts.upserts)) ? opts.upserts : [];
    const deletes = (opts && Array.isArray(opts.deletes)) ? opts.deletes : [];
    if(!Number.isFinite(seed)) throw new Error('save store write needs a world seed');
    if(!manifest || typeof manifest !== 'object') throw new Error('save store write needs a manifest');
    if(upserts.length > MAX_CHUNK_RECORDS) throw new Error('save store write exceeds the chunk record cap');
    for(const rec of upserts) if(!validRecord(rec)) throw new Error('save store write rejects a malformed chunk record');
    const chunkCount = Number.isFinite(opts.chunkCount) ? (opts.chunkCount|0) : null;
    const metaRec = {k:ACTIVE_KEY, seed, data:manifest, savedAt:Date.now(), chunkCount};
    stats.writes++;
    stats.chunkPuts += upserts.length;
    stats.chunkDeletes += deletes.length;
    if(backendName === 'memory'){
      if(opts.replaceWorld === true) memory.chunks.clear();
      for(const rec of upserts){
        const k = chunkKey(seed, rec.cx, rec.sy);
        memory.chunks.set(k, {k, seed, cx:rec.cx, sy:rec.sy == null ? null : rec.sy, ver:rec.ver|0, data:rec.data, h:rec.h});
      }
      for(const k of deletes) memory.chunks.delete(k);
      memory.meta.set(ACTIVE_KEY, metaRec);
      return true;
    }
    const tx = db.transaction([STORE_META, STORE_CHUNKS], 'readwrite');
    const chunkStore = tx.objectStore(STORE_CHUNKS);
    // A world REPLACEMENT (a loaded slot, an adopted fork, a regenerated seed)
    // wipes inside the same transaction as the write that replaces it. Clearing
    // first as its own step would leave a window where a failure loses the world
    // outright; here a failure simply rolls the old world back.
    if(opts.replaceWorld === true) chunkStore.clear();
    for(const rec of upserts){
      const k = chunkKey(seed, rec.cx, rec.sy);
      chunkStore.put({k, seed, cx:rec.cx, sy:rec.sy == null ? null : rec.sy, ver:rec.ver|0, data:rec.data, h:rec.h});
    }
    for(const k of deletes) chunkStore.delete(k);
    tx.objectStore(STORE_META).put(metaRec);
    try{ await txDone(tx); }
    catch(e){ stats.failures++; throw e; }
    return true;
  }

  async function clearWorld(seed){
    await open();
    if(backendName === 'memory'){
      for(const [k, rec] of [...memory.chunks]) if(rec.seed === seed) memory.chunks.delete(k);
      const active = memory.meta.get(ACTIVE_KEY);
      if(active && active.seed === seed) memory.meta.delete(ACTIVE_KEY);
      return true;
    }
    const tx = db.transaction([STORE_META, STORE_CHUNKS], 'readwrite');
    const index = tx.objectStore(STORE_CHUNKS).index('seed');
    await new Promise((resolve, reject) => {
      const cursor = index.openKeyCursor(IDBKeyRange.only(seed));
      cursor.onsuccess = () => {
        const cur = cursor.result;
        if(!cur){ resolve(true); return; }
        tx.objectStore(STORE_CHUNKS).delete(cur.primaryKey);
        cur.continue();
      };
      cursor.onerror = () => reject(cursor.error || new Error('clear cursor failed'));
    });
    const metaRec = await req(tx.objectStore(STORE_META).get(ACTIVE_KEY));
    if(metaRec && metaRec.seed === seed) tx.objectStore(STORE_META).delete(ACTIVE_KEY);
    await txDone(tx);
    return true;
  }
  // A new game abandons the previous world outright: drop everything rather than
  // leave an orphaned world paying rent in the player's storage budget.
  async function clearAll(){
    await open();
    if(backendName === 'memory'){
      memory.chunks.clear(); memory.meta.clear();
      return true;
    }
    const tx = db.transaction([STORE_META, STORE_CHUNKS], 'readwrite');
    tx.objectStore(STORE_CHUNKS).clear();
    tx.objectStore(STORE_META).clear();
    await txDone(tx);
    return true;
  }

  // ---------------------------------------------------------------- slots
  // Named saves keep today's shape — one self-contained inline JSON per slot —
  // because a player-made snapshot must not share mutable chunk records with the
  // live world. In localStorage that made them the single biggest space hog; here
  // their size stops mattering.
  async function writeSlot(rec){
    await open();
    if(!rec || typeof rec.k !== 'string' || !rec.k || typeof rec.json !== 'string') throw new Error('slot write needs an id and a payload');
    const row = Object.assign({}, rec, {savedAt:Number.isFinite(rec.savedAt) ? rec.savedAt : Date.now()});
    if(backendName === 'memory'){ memory.slots.set(row.k, row); return true; }
    const tx = db.transaction([STORE_SLOTS], 'readwrite');
    tx.objectStore(STORE_SLOTS).put(row);
    await txDone(tx);
    return true;
  }
  async function readSlot(id){
    await open();
    if(backendName === 'memory') return memory.slots.get(String(id)) || null;
    const tx = db.transaction([STORE_SLOTS], 'readonly');
    return (await req(tx.objectStore(STORE_SLOTS).get(String(id)))) || null;
  }
  async function removeSlot(id){
    await open();
    if(backendName === 'memory'){ memory.slots.delete(String(id)); return true; }
    const tx = db.transaction([STORE_SLOTS], 'readwrite');
    tx.objectStore(STORE_SLOTS).delete(String(id));
    await txDone(tx);
    return true;
  }
  async function listSlots(){
    await open();
    if(backendName === 'memory') return [...memory.slots.values()].map(row => Object.assign({}, row, {json:undefined}));
    const tx = db.transaction([STORE_SLOTS], 'readonly');
    const rows = await req(tx.objectStore(STORE_SLOTS).getAll());
    // The browser list only needs metadata; leaving the payloads out keeps
    // opening the save browser cheap no matter how large the worlds are.
    return (rows || []).map(row => Object.assign({}, row, {json:undefined}));
  }

  // ------------------------------------------------------------------ WAL
  // Synchronous, bounded, localStorage. Written from pagehide when an async store
  // write cannot be awaited; drained into the store on the next boot.
  let walNonce=0;
  function walHash(text){
    let h=0x811c9dc5;
    const src=String(text);
    for(let i=0;i<src.length;i++){ h^=src.charCodeAt(i); h=(h>>>0)*0x01000193; h>>>0; }
    return ('00000000'+(h>>>0).toString(16)).slice(-8);
  }
  function walTransactionHash(seed,rows,stateHash){
    const identities=(rows||[]).map(row=>[
      row.cx,
      row.sy==null ? null : row.sy,
      row.ver|0,
      String(row.h||'').toLowerCase()
    ]);
    return walHash(JSON.stringify([seed,String(stateHash||'').toLowerCase(),identities]));
  }
  function cleanWalMeta(meta,expectedRows){
    if(!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
    const rowCount=Number(meta.rowCount);
    if(!Number.isSafeInteger(rowCount) || rowCount<1 || rowCount>WAL_MAX_CHUNKS) return null;
    if(Number.isSafeInteger(expectedRows) && rowCount!==expectedRows) return null;
    const out={rowCount};
    const raw=meta.observerReplicas;
    if(raw && raw.v===1 && Array.isArray(raw.list)){
      const list=[];
      const seen=new Set();
      for(const row of raw.list.slice(0,12)){
        if(!Array.isArray(row) || row.length<2 || !Number.isSafeInteger(row[0]) || !Number.isSafeInteger(row[1])) continue;
        const key=row[0]+','+row[1];
        if(seen.has(key)) continue;
        const clean=[row[0],row[1]];
        if(typeof row[2]==='string' && /^g[a-zA-Z0-9._-]{1,39}$/.test(row[2])
          && typeof row[3]==='string' && /^o[0-9a-f]{24}$/.test(row[3])){
          clean.push(row[2],row[3]);
        }
        seen.add(key); list.push(clean);
        if(list.length>=3) break;
      }
      const observerReplicas={v:1,list};
      if(Array.isArray(raw.accepted)){
        const accepted=[], acceptedSeen=new Set();
        for(const row of raw.accepted.slice(0,3072)){
          if(!Array.isArray(row) || row.length<2
            || typeof row[0]!=='string' || !/^g[a-zA-Z0-9._-]{1,39}$/.test(row[0])
            || typeof row[1]!=='string' || !/^o[0-9a-f]{24}$/.test(row[1])) continue;
          const key=row[0]+'\0'+row[1];
          if(acceptedSeen.has(key)) continue;
          acceptedSeen.add(key);
          const clean=[row[0],row[1]];
          if(Number.isSafeInteger(row[2]) && Number.isSafeInteger(row[3])) clean.push(row[2],row[3]);
          accepted.push(clean);
          if(accepted.length>=768) break;
        }
        if(accepted.length) observerReplicas.accepted=accepted;
      }
      out.observerReplicas=observerReplicas;
    }
    const critical=meta.criticalState;
    if(critical && typeof critical==='object' && !Array.isArray(critical)){
      try{
        const json=JSON.stringify(critical);
        if(json && json.length<=WAL_META_MAX_BYTES){
          const clone=JSON.parse(json);
          if(clone && typeof clone==='object' && !Array.isArray(clone)) out.criticalState=clone;
        }
      }catch(e){}
    }
    if(typeof meta.txHash==='string' && /^[0-9a-f]{8}$/i.test(meta.txHash)) out.txHash=meta.txHash.toLowerCase();
    return out.observerReplicas || out.criticalState ? out : null;
  }
  function walStash(seed, entries, meta){
    try{
      if(!Array.isArray(entries) || !entries.length) return 0;
      const requiresMeta=meta!=null;
      const rows = [];
      let bytes = 0;
      let complete=true;
      for(let i=0;i<entries.length;i++){
        const rec=entries[i];
        if(rows.length >= WAL_MAX_CHUNKS){ complete=false; break; }
        if(!validRecord(rec)){ complete=false; continue; }
        const rowBytes=rec.data.length+48;
        if(bytes+rowBytes>WAL_MAX_BYTES){ complete=false; break; }
        rows.push({cx:rec.cx, sy:rec.sy == null ? null : rec.sy, ver:rec.ver|0, data:rec.data, h:rec.h});
        bytes += rowBytes;
      }
      if(!rows.length) return 0;
      const payload={v:1, seed, at:Date.now(), rows};
      complete=complete && rows.length===entries.length;
      const safeMeta=complete ? cleanWalMeta(Object.assign({},meta,{rowCount:rows.length}),rows.length) : null;
      const pairedMeta=!!(safeMeta && safeMeta.observerReplicas && safeMeta.criticalState
        && typeof safeMeta.criticalState.stateHash==='string'
        && /^[0-9a-f]{8}$/i.test(safeMeta.criticalState.stateHash));
      // A gameplay unload supplies transaction metadata. Never replace an older
      // consistent journal with terrain that was truncated or lost its matching
      // inventory/observer capsule; replaying either half would duplicate or
      // destroy the replica (and ordinary mined resources).
      if(requiresMeta && (!complete || !pairedMeta)) return 0;
      const txHash=walTransactionHash(seed,rows,pairedMeta ? safeMeta.criticalState.stateHash : '');
      payload.id=txHash+'-'+Date.now().toString(36)+'-'+((walNonce++ & 0xffff).toString(36));
      if(safeMeta){
        safeMeta.txHash=txHash;
        payload.meta=safeMeta;
      }
      root.localStorage.setItem(WAL_KEY, JSON.stringify(payload));
      return rows.length;
    }catch(e){ return 0; }
  }
  function walRead(seed){
    try{
      const raw = root.localStorage.getItem(WAL_KEY);
      if(!raw) return null;
      const parsed = JSON.parse(raw);
      if(!parsed || parsed.v !== 1 || !Array.isArray(parsed.rows)) return null;
      const id=typeof parsed.id==='string' && /^[0-9a-f]{8}-[a-z0-9]+-[a-z0-9]+$/i.test(parsed.id) ? parsed.id : null;
      if(id && root.localStorage.getItem(WAL_ACK_KEY)===id) return null;
      // A journal from another world is not this world's business.
      if(Number.isFinite(seed) && parsed.seed !== seed) return null;
      const rows = parsed.rows.filter(validRecord).slice(0, WAL_MAX_CHUNKS);
      // Transaction metadata is usable only if every row originally paired with
      // it survived parsing. Partial terrain plus a newer inventory is unsafe.
      let meta=parsed.rows.length===rows.length ? cleanWalMeta(parsed.meta,rows.length) : null;
      if(meta){
        const expected=walTransactionHash(parsed.seed,rows,meta.criticalState && meta.criticalState.stateHash);
        if(!meta.txHash || meta.txHash!==expected) meta=null;
      }
      return rows.length ? {id,seed:parsed.seed, at:parsed.at, rows, meta} : null;
    }catch(e){ return null; }
  }
  // localStorage has no compare-and-remove. An acknowledgement is one atomic
  // setItem instead: acknowledging W1 can never suppress a newer payload W2,
  // because walRead ignores only an exact id match.
  function walAcknowledge(id){
    try{
      if(typeof id!=='string' || !/^[0-9a-f]{8}-[a-z0-9]+-[a-z0-9]+$/i.test(id)) return false;
      root.localStorage.setItem(WAL_ACK_KEY,id);
      return true;
    }catch(e){ return false; }
  }
  function walClear(){
    try{ root.localStorage.removeItem(WAL_KEY); root.localStorage.removeItem(WAL_ACK_KEY); }catch(e){}
  }

  // ----------------------------------------------------------------- info
  async function estimate(){
    try{
      if(root.navigator && root.navigator.storage && typeof root.navigator.storage.estimate === 'function'){
        const e = await root.navigator.storage.estimate();
        return {usage:Number(e && e.usage) || 0, quota:Number(e && e.quota) || 0};
      }
    }catch(e){}
    return {usage:0, quota:0};
  }
  function info(){
    return {
      backend:backendName || '(unopened)',
      persistent:persistent(),
      lastError,
      walKey:WAL_KEY,
      stats:Object.assign({}, stats)
    };
  }
  // Test seam: a fresh in-memory world without reopening the module.
  function _resetMemory(){
    memory.chunks.clear(); memory.meta.clear(); memory.slots.clear();
    for(const k of Object.keys(stats)) stats[k] = 0;
  }

  const api = {
    open, ready, persistent, backend:()=>backendName,
    readActive, readActiveMeta, writeDelta, clearWorld, clearAll,
    writeSlot, readSlot, removeSlot, listSlots,
    walStash, walRead, walAcknowledge, walClear,
    estimate, info, chunkKey,
    config:{DB_NAME, DB_VERSION, WAL_KEY, WAL_ACK_KEY, WAL_MAX_CHUNKS, WAL_MAX_BYTES, MAX_CHUNK_RECORDS},
    _resetMemory
  };
  MM.saveStore = api;
})();

export const saveStore = (typeof window !== 'undefined' && window.MM) ? window.MM.saveStore : (globalThis.MM && globalThis.MM.saveStore);
export default saveStore;
