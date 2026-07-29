// The world's home on disk (src/engine/save_store.js).
//
// Node has no IndexedDB, so the module's in-memory backend stands in for it here:
// same API, same delta/journal semantics, no browser. What the real IndexedDB path
// does is proven live in tools/save-load-qa.mjs — this suite pins the LOGIC that
// decides what gets written, what gets deleted, and what survives a killed tab.
//
// Run: node tools/save-store-sim.test.mjs
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.MM = {};
// A minimal synchronous localStorage: the journal is the one part of this module
// that must not be async, because it runs from pagehide.
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: k => { store.delete(k); },
  key: i => [...store.keys()][i] ?? null,
  get length(){ return store.size; }
};

const { saveStore: S } = await import('../src/engine/save_store.js');

const chunk = (cx, ver, data, sy) => ({ cx, sy: sy == null ? null : sy, ver, data: data || ('rle-' + cx + '-' + ver), h: 'aabbccdd' });
const manifest = (over) => Object.assign({ v: 8, seed: 42, world: { store: true, chunks: 0 }, player: { x: 1, y: 2 } }, over || {});

assert.equal(await S.open(), 'memory', 'without IndexedDB the store falls back to memory rather than failing');
assert.equal(S.ready(), true, 'the fallback backend is still a usable store');
assert.equal(S.persistent(), false, 'and it reports honestly that it does not persist');

// ---------------------------------------------------------------- round trip
{
  S._resetMemory();
  await S.writeDelta({ seed: 42, manifest: manifest({ world: { store: true, chunks: 2 } }), chunkCount: 2,
    upserts: [chunk(0, 1), chunk(1, 1)], deletes: [] });
  const read = await S.readActive();
  assert.ok(read, 'a published world reads back');
  assert.equal(read.seed, 42, 'the manifest names its world');
  assert.equal(read.chunks.size, 2, 'every published chunk comes back');
  assert.equal(read.chunks.get('42|0').data, 'rle-0-1', 'payloads survive verbatim');
  assert.equal(read.chunks.get('42|0').ver, 1, 'so does the version the delta pass compares against');
  const meta = await S.readActiveMeta();
  assert.equal(meta.chunkCount, 2, 'the cheap pointer read reports the published count');
  assert.equal(meta.seed, 42, 'and the world it belongs to');
}

// --------------------------------------------------------------- delta writes
// The point of the whole design: a save touches the chunks that changed and
// leaves the rest of the world alone.
{
  S._resetMemory();
  await S.writeDelta({ seed: 42, manifest: manifest(), chunkCount: 3, upserts: [chunk(0, 1), chunk(1, 1), chunk(2, 1)], deletes: [] });
  const before = S.info().stats.chunkPuts;
  await S.writeDelta({ seed: 42, manifest: manifest(), chunkCount: 3, upserts: [chunk(1, 2)], deletes: [] });
  assert.equal(S.info().stats.chunkPuts - before, 1, 'a one-chunk delta writes exactly one record');
  const read = await S.readActive();
  assert.equal(read.chunks.size, 3, 'the untouched chunks are still there');
  assert.equal(read.chunks.get('42|1').ver, 2, 'the changed chunk is the new version');
  assert.equal(read.chunks.get('42|0').ver, 1, 'and the others keep theirs');
  // A chunk mined back to pristine leaves the world: the delta pass says so with
  // an explicit delete, or the store would keep resurrecting it.
  await S.writeDelta({ seed: 42, manifest: manifest(), chunkCount: 2, upserts: [], deletes: ['42|2'] });
  const after = await S.readActive();
  assert.equal(after.chunks.size, 2, 'a deleted chunk is gone');
  assert.equal(after.chunks.has('42|2'), false, 'and it is gone by key');
}

// --------------------------------------------------------- world replacement
// A loaded slot, an adopted fork or a regenerated seed replaces the world. The
// wipe rides INSIDE the write, so a failure cannot leave the player with nothing.
{
  S._resetMemory();
  await S.writeDelta({ seed: 42, manifest: manifest(), chunkCount: 2, upserts: [chunk(0, 1), chunk(1, 1)], deletes: [] });
  await S.writeDelta({ seed: 77, manifest: manifest({ seed: 77 }), chunkCount: 1, upserts: [chunk(5, 1)], deletes: [], replaceWorld: true });
  const read = await S.readActive();
  assert.equal(read.seed, 77, 'the active world is the new one');
  assert.equal(read.chunks.size, 1, 'nothing of the replaced world remains');
  assert.equal(read.chunks.has('77|5'), true, 'and the new world is keyed by its own seed');
}

// A world read is scoped to the manifest's seed, so a leftover world sharing the
// database cannot bleed its chunks into the active one.
{
  S._resetMemory();
  await S.writeDelta({ seed: 42, manifest: manifest(), chunkCount: 1, upserts: [chunk(0, 1)], deletes: [] });
  await S.writeDelta({ seed: 99, manifest: manifest({ seed: 99 }), chunkCount: 1, upserts: [chunk(9, 1)], deletes: [] });
  const read = await S.readActive();
  assert.equal(read.seed, 99, 'the last published manifest is the active world');
  assert.equal(read.chunks.size, 1, 'and it reads only its own chunks');
  await S.clearWorld(99);
  assert.equal(await S.readActive(), null, 'clearing the active world leaves no manifest behind');
}

// ------------------------------------------------------------------ refusals
{
  S._resetMemory();
  await assert.rejects(() => S.writeDelta({ seed: NaN, manifest: manifest(), upserts: [] }), /world seed/, 'a write without a canonical seed is refused');
  await assert.rejects(() => S.writeDelta({ seed: 42, manifest: null, upserts: [] }), /manifest/, 'a write without a manifest is refused');
  await assert.rejects(() => S.writeDelta({ seed: 42, manifest: manifest(), upserts: [{ cx: 1.5, ver: 1, data: 'x', h: 'aabbccdd' }] }), /malformed/, 'a fractional chunk coordinate is refused');
  await assert.rejects(() => S.writeDelta({ seed: 42, manifest: manifest(), upserts: [{ cx: 1, ver: 1, data: '', h: 'aabbccdd' }] }), /malformed/, 'an empty payload is refused');
  await assert.rejects(() => S.writeDelta({ seed: 42, manifest: manifest(), upserts: [{ cx: 1, ver: 1, data: 'x', h: 'nope' }] }), /malformed/, 'a payload without a canonical hash is refused');
  assert.equal(await S.readActive(), null, 'a refused write publishes nothing at all');
}

// ---------------------------------------------------------------- the journal
// Synchronous, bounded, and scoped to one world: this is what carries the last
// seconds of digging across a tab that dies before IndexedDB commits.
{
  S._resetMemory();
  store.clear();
  assert.equal(S.walRead(42), null, 'no journal, no rows');
  const observerReplicas={
    v:1,
    list:[[195,61,'g-save-owner','oaaaaaaaaaaaaaaaaaaaaaaaa'],[323,-8]],
    accepted:[['g-save-owner','oaaaaaaaaaaaaaaaaaaaaaaaa',195,61]]
  };
  const criticalState={v:4,seed:42,stateHash:'aabbccdd',inv:{observerReplica:0},observerReplicas};
  assert.equal(S.walStash(42, [chunk(3, 7), chunk(4, 7)],{observerReplicas,criticalState}), 2,
    'the journal takes the unwritten chunks');
  const wal = S.walRead(42);
  assert.equal(wal.rows.length, 2, 'and hands them back');
  assert.match(wal.id,/^[0-9a-f]{8}-[a-z0-9]+-[a-z0-9]+$/i,'every journal has an immutable acknowledgement id');
  assert.equal(wal.rows[0].data, 'rle-3-7', 'verbatim');
  assert.deepEqual(wal.meta.observerReplicas,observerReplicas,'observer coordinates stay paired with the terrain delta');
  assert.deepEqual(wal.meta.criticalState,criticalState,'the matching critical inventory state round-trips');
  assert.equal(wal.meta.rowCount,2,'transaction metadata records its complete terrain row count');
  assert.match(wal.meta.txHash,/^[0-9a-f]{8}$/i,'metadata is bound to the exact ordered terrain row identities');
  assert.equal(S.walRead(43), null, 'a journal from another world is not this world\'s business');
  S.walClear();
  assert.equal(S.walRead(42), null, 'a consumed journal is gone');
  // Bounded on purpose: a journal is a last-seconds carrier, not a save format.
  const many = [];
  for (let i = 0; i < S.config.WAL_MAX_CHUNKS + 40; i++) many.push(chunk(i, 1));
  assert.equal(S.walStash(42, many), S.config.WAL_MAX_CHUNKS, 'a metadata-free diagnostic journal stops at its chunk cap');
  assert.equal(S.walRead(42).meta,null,'a truncated terrain journal never carries newer inventory or observer metadata');
  S.walClear();
  assert.equal(S.walStash(42,[chunk(9,1)],{observerReplicas,criticalState}),1,'a complete transaction becomes the current journal');
  assert.equal(S.walStash(42,many,{observerReplicas,criticalState}),0,
    'a gameplay transaction that exceeds the cap is refused instead of tearing terrain from inventory');
  assert.equal(S.walRead(42).rows[0].cx,9,'a refused partial transaction preserves the older consistent journal');
  const big = [];
  for (let i = 0; i < 40; i++) big.push(chunk(i, 1, 'x'.repeat(20000)));
  S.walClear();
  const stashed = S.walStash(42, big);
  assert.ok(stashed > 0 && stashed < 40, 'and at its byte cap (' + stashed + ' of 40)');
  assert.equal(S.walRead(42).meta,null,'byte-truncated journals also drop transaction metadata');
  S.walClear();
  const exactOver=big.slice(0,20);
  assert.equal(S.walStash(42,exactOver,{observerReplicas,criticalState}),0,
    'a final row that would cross the byte cap rejects the paired transaction instead of slipping through');
  S.walClear();
  assert.equal(S.walStash(42, [{ cx: 0.5, ver: 1, data: 'x', h: 'aabbccdd' }]), 0, 'a malformed row never reaches the journal');
  assert.equal(S.walStash(42,[chunk(1,1)],{observerReplicas:{v:2,list:[[1,2]]}}),0,
    'malformed transaction metadata blocks the paired terrain write');
  assert.equal(S.walRead(42),null,'a refused malformed transaction publishes no terrain half');
  assert.equal(S.walStash(42,[chunk(1,1)],{observerReplicas}),0,
    'observer coordinates without their matching critical inventory capsule are refused');
  assert.equal(S.walStash(42,[chunk(1,1)],{criticalState}),0,
    'critical inventory without matching observer coordinates is refused');
  assert.equal(S.walStash(42,[chunk(5,1)],{observerReplicas,criticalState}),1,'a digest test transaction is accepted');
  const tamperedPayload=JSON.parse(store.get(S.config.WAL_KEY));
  tamperedPayload.rows[0]=chunk(6,1);
  store.set(S.config.WAL_KEY,JSON.stringify(tamperedPayload));
  assert.equal(S.walRead(42).meta,null,
    'swapping a valid same-count terrain row breaks its transaction digest');
  S.walClear();
  assert.equal(S.walStash(42,[chunk(7,1)],{observerReplicas,criticalState}),1,'the first acknowledgement-race WAL is accepted');
  const firstWal=S.walRead(42);
  assert.equal(S.walStash(42,[chunk(8,1)],{observerReplicas,criticalState}),1,'a newer WAL atomically replaces its predecessor');
  const secondWal=S.walRead(42);
  assert.notEqual(firstWal.id,secondWal.id,'replacement WALs have distinct ids');
  assert.equal(S.walAcknowledge(firstWal.id),true,'an older durable save may acknowledge only the WAL it observed');
  assert.equal(S.walRead(42).id,secondWal.id,'acknowledging W1 cannot suppress newer W2');
  assert.equal(S.walAcknowledge(secondWal.id),true,'the matching replay can acknowledge W2');
  assert.equal(S.walRead(42),null,'an exactly acknowledged WAL is no longer replayable');
  S.walClear();
  // A journal written when storage is full must not throw into the unload path.
  const realSet = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(S.walStash(42, [chunk(1, 1)]), 0, 'a failed journal write is reported, not thrown, on the way out');
  globalThis.localStorage.setItem = realSet;
  store.set(S.config.WAL_KEY, 'not json at all');
  assert.equal(S.walRead(42), null, 'a corrupt journal is ignored rather than trusted');
  store.clear();
}

// ------------------------------------------------------------------- slots
{
  S._resetMemory();
  await S.writeSlot({ k: 'slot1', seed: 42, name: 'Dom', json: '{"v":8}', bytes: 7, h: 'aabbccdd' });
  const slot = await S.readSlot('slot1');
  assert.equal(slot.json, '{"v":8}', 'a named save keeps its self-contained payload');
  const list = await S.listSlots();
  assert.equal(list.length, 1, 'the browser sees the slot');
  assert.equal(list[0].json, undefined, 'but listing never carries payloads — opening the list stays cheap at any world size');
  assert.equal(list[0].name, 'Dom', 'while the metadata it renders is there');
  await S.removeSlot('slot1');
  assert.equal(await S.readSlot('slot1'), null, 'a removed slot is gone');
  await assert.rejects(() => S.writeSlot({ k: '', json: 'x' }), /id/, 'a slot needs an id');
}

// ------------------------------------------------------------ source contract
{
  const src = await readFile(new URL('../src/engine/save_store.js', import.meta.url), 'utf8');
  const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  // The payload is deliberately the SAME base64 RLE the save format already used:
  // no second codec, no second integrity story, no new way to be wrong.
  assert.ok(!/encodeRLE|decodeRLE|btoa|atob/.test(src), 'the store invents no codec of its own');
  assert.match(src, /transaction\(\[STORE_META, STORE_CHUNKS\], 'readwrite'\)/, 'chunks and manifest publish in ONE transaction');
  assert.match(src, /if\(opts\.replaceWorld === true\) chunkStore\.clear\(\);/, 'a world replacement wipes inside that same transaction');
  assert.match(src, /chunks\.createIndex\('seed', 'seed'/, 'chunk reads are indexed by world');
  assert.match(src, /navigator\.storage\.persist/, 'the store asks not to be evicted under storage pressure');
  // main.js side: the delta baseline, the journal on the way out, and the
  // fail-closed refusal when the store is gone but its world is not.
  assert.match(mainSrc, /const known=forceAll \? null : _storeChunkVers\.get\(ref\.key\);\s*if\(known && known\.ver===ver\) continue;/, 'the delta pass skips chunks whose version has not moved');
  assert.match(mainSrc, /if\(!replaceWorld\) for\(const \[key,rec\] of _storeChunkVers\) if\(!live\.has\(key\)\) deletes\.push/, 'chunks that left the world are deleted, not orphaned');
  assert.match(mainSrc, /_storeChunkVers=live;\s*_storeBaselineSeed=seed;/, 'the baseline advances only after the transaction commits');
  assert.match(mainSrc, /if\(storeActive\(\)\)\{[\s\S]{0,400}stashStoreWal\(\);\s*persistStoreSave\('flush'\);/, 'unload journals synchronously before kicking the async write');
  assert.match(mainSrc, /meta=\{observerReplicas:criticalState\.observerReplicas,criticalState\};[\s\S]{0,120}SAVE_STORE\.walStash\(seed,upserts,meta\)/,
    'a complete unload journal pairs terrain with observer and critical inventory state');
  assert.match(mainSrc, /if\(_storeNeedsFullRepublish \|\| _storeBaselineSeed!==seed \|\| !_committedSaveIdentity\) return 0;[\s\S]{0,220}for\(const \[key\] of _storeChunkVers\) if\(!live\.has\(key\)\) return 0;/,
    'replacement worlds and pending chunk deletions refuse an upsert-only WAL');
  assert.match(mainSrc, /if\(!complete \|\| !upserts\.length\) return 0;/,
    'an unload refuses to journal a truncated terrain transaction');
  assert.match(src, /const pairedMeta=!!\(safeMeta && safeMeta\.observerReplicas && safeMeta\.criticalState[\s\S]{0,800}if\(requiresMeta && \(!complete \|\| !pairedMeta\)\) return 0;/,
    'the store refuses to overwrite a consistent WAL with an incomplete paired transaction');
  assert.match(src, /function walTransactionHash\(seed,rows,stateHash\)[\s\S]{0,420}JSON\.stringify\(\[seed,String\(stateHash\|\|''\)\.toLowerCase\(\),identities\]\)/,
    'the transaction digest includes the world seed, critical-state hash, and ordered row identities');
  assert.match(src, /const expected=walTransactionHash\(parsed\.seed,rows,meta\.criticalState && meta\.criticalState\.stateHash\);\s*if\(!meta\.txHash \|\| meta\.txHash!==expected\) meta=null;/,
    'the store verifies a digest binding seed, rows, and critical state before exposing metadata');
  assert.match(src, /function walAcknowledge\(id\)[\s\S]{0,420}root\.localStorage\.setItem\(WAL_ACK_KEY,id\)/,
    'journal completion uses an atomic id acknowledgement rather than a racy read/remove');
  assert.match(mainSrc, /walObserverReplicas:walMeta && walMeta\.observerReplicas,[\s\S]{0,100}walCriticalState:walMeta && walMeta\.criticalState/,
    'store replay forwards only paired WAL metadata into the transactional restore');
  assert.match(mainSrc, /if\(walRows\) for\(const key of walAppliedKeys\) _storeChunkVers\.delete\(key\);[\s\S]{0,300}await persistStoreSave\('wal-replay',wal && wal\.id\)/,
    'replayed keys are removed from the baseline and republished before the WAL can be cleared');
  assert.doesNotMatch(mainSrc.slice(mainSrc.indexOf('async function persistStoreSaveNow'),mainSrc.indexOf('function scheduleStoreSave')),
    /SAVE_STORE\.walClear\(\)/,'an unrelated or older store commit never destroys a newer WAL');
  assert.match(mainSrc, /if\(reason==='wal-replay' && walId && !SAVE_STORE\.walAcknowledge\(walId\)\)/,
    'only the durable replay transaction acknowledges its exact WAL id');
  const loadStoreStart=mainSrc.indexOf('async function loadGameFromStore');
  const loadStoreEnd=mainSrc.indexOf('function parseStoreManifest',loadStoreStart);
  const loadStoreSrc=mainSrc.slice(loadStoreStart,loadStoreEnd);
  assert.doesNotMatch(loadStoreSrc,/SAVE_STORE\.walAcknowledge\(/,
    'a stale tab that rejects a newer valid WAL cannot acknowledge data it never durably incorporated');
  assert.equal((mainSrc.match(/SAVE_STORE\.walAcknowledge\(/g)||[]).length,1,
    'the successful durable wal-replay commit is the sole acknowledgement site');
  assert.match(mainSrc, /storeParentHash:storeMode && typeof opts\.storeParentHash==='string' \? opts\.storeParentHash : undefined/,
    'store manifests carry their hashed parent');
  assert.match(mainSrc, /buildSaveObject\(\{lightweight:true, storeChunkCount:live\.size, storeParentHash, auditChunkIds:\[\], perf\}\)/,
    'the store save passes its pre-await parent identity into the manifest');
  assert.match(mainSrc, /const owner=storeOwnerRecord\(\);\s*if\(owner\)\{[\s\S]{0,400}blockSaveWrites\('save store unavailable/, 'a missing store with a live owner marker fails closed instead of loading a stale world');
  assert.match(mainSrc, /const preferLegacy=!!legacy && \(!meta \|\| legacy\.savedAt>\(Number\(meta\.savedAt\)\|\|0\)\);/, 'a freshly written localStorage save (a world fork) wins over an older store world');
  assert.match(mainSrc, /const pairedState=\(!walDropped && wal\.meta && wal\.meta\.criticalState && wal\.meta\.observerReplicas\)[\s\S]{0,420}if\(pairedState && verified\.length===wal\.rows\.length\)/,
    'WAL replay requires every terrain row and its manifest-bound critical capsule');
  assert.match(mainSrc, /else\{\s*walDropped\+=verified\.length;\s*\}/,
    'one corrupt or unpaired row rejects the whole transaction rather than replaying half');
  assert.match(mainSrc, /SAVE_STORE\.clearAll\(\)\.then\(\(\)=>\{[\s\S]{0,200}wipeAndNavigate\(\);/, 'a new game drops the stored world BEFORE it navigates');
}

console.log('save-store-sim: all assertions passed');
