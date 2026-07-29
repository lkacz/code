// Observer-replica regression: bounded lifecycle, escalating economy, save
// hygiene, visual identity and all integration seams.
// Run: node tools/observer-replicas-sim.test.mjs
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

globalThis.window=globalThis;
globalThis.MM={};

const { T, INFO, CHUNK_W, WORLD_SECTION_H } = await import('../src/constants.js');
const { isPassableForFalling, isRigidObjectTile } = await import('../src/engine/material_physics.js');
const {
  observerReplicas:R,
  MAX_OBSERVER_REPLICAS,
  OBSERVER_REPLICA_COSTS,
  OBSERVER_REPLICA_RESOURCE
} = await import('../src/engine/observer_replicas.js');

assert.equal(T.OBSERVER_REPLICA,150,'the append-only observer tile follows the existing 149 ids');
assert.equal(INFO[T.OBSERVER_REPLICA].drop,'observerReplica','mining a replica returns its bounded inventory item');
assert.equal(INFO[T.OBSERVER_REPLICA].passable,true,'the bogus likeness is an inert open fixture');
assert.equal(INFO[T.OBSERVER_REPLICA].observerReplica,true,'tile metadata identifies the special lifecycle');
assert.equal(isRigidObjectTile(T.OBSERVER_REPLICA),false,
  'the anchored replica never leaves the bounded economy as a generic falling entity');
assert.equal(isPassableForFalling(T.OBSERVER_REPLICA),false,
  'falling rubble cannot silently overwrite the anchored replica');
assert.equal(OBSERVER_REPLICA_RESOURCE.tile,'OBSERVER_REPLICA','inventory resource maps back to the placeable tile');
assert.equal(MAX_OBSERVER_REPLICAS,3,'the performance cap is explicit and immutable');

// -------------------------------------------------------------- placement law
{
  R.reset();
  const tiles=new Map([['4,6',T.STONE]]);
  const get=(x,y)=>tiles.get(x+','+y) ?? T.AIR;
  assert.equal(R.validatePlacement(4,5,get).ok,true,'a replica may stand on a solid floor');
  assert.equal(R.validatePlacement(5,5,get).ok,false,'air cannot support a standing replica');
  assert.equal(R.validatePlacement(5,5,get).code,'support','placement failures expose a stable host feedback code');
  assert.deepEqual(R.regionAt(65,71),{cx:1,sy:1,x:CHUNK_W,y:WORLD_SECTION_H,w:CHUNK_W,h:WORLD_SECTION_H,key:'1,1'},
    'coverage exposes its exact grid-aligned 64x70 preview bounds');
}

// ---------------------------------------------------------- bounded lifecycle
{
  R.reset();
  let activated=null;
  MM.onObserverReplicaActivated=(x,y)=>{ activated=[x,y]; };
  assert.equal(R.onTileChanged(-65,-10,T.AIR,T.OBSERVER_REPLICA),true,'negative/sky coordinates register');
  assert.deepEqual(activated,[-65,-10],'activation exposes the exact coordinate for guest pending-intent settlement');
  delete MM.onObserverReplicaActivated;
  assert.equal(R.onTileChanged(130,100,T.AIR,T.OBSERVER_REPLICA),true,'a second region registers');
  assert.equal(R.onTileChanged(260,211,T.AIR,T.OBSERVER_REPLICA),true,'a deep third region registers');
  assert.equal(R.count(),3,'three active replicas fill the cap');
  assert.equal(R.onTileChanged(390,40,T.AIR,T.OBSERVER_REPLICA),false,'a fourth registration is refused synchronously');
  assert.equal(R.count(),3,'cap refusal changes no registry state');
  assert.equal(R.canAcceptTileChange(390,40,T.AIR,T.OBSERVER_REPLICA),false,
    'the world-write preflight rejects the same fourth coordinate');
  assert.equal(R.onTileChanged(130,100,T.AIR,T.OBSERVER_REPLICA),true,'duplicate lifecycle callbacks are idempotent');
  assert.equal(R.count(),3,'a duplicate does not consume another slot');
  const anchors=R.activeAnchors();
  assert.ok(anchors.some(p=>p.x===-64.5 && p.y===-9.5),'simulation anchors use tile centers');
  assert.equal(R.onTileChanged(130,100,T.OBSERVER_REPLICA,T.AIR),true,'removal frees its slot immediately');
  assert.equal(R.count(),2,'removal decrements the active cap');
  assert.equal(R.onTileChanged(390,40,T.AIR,T.OBSERVER_REPLICA),true,'the freed slot can be reused');
  assert.equal(R.count(),3,'replacement reaches but never exceeds the cap');
  assert.equal(R.pinsChunk(Math.floor(390/CHUNK_W),0,true),true,'registered base-world coordinates pin their cache chunk');
  assert.equal(R.pinsChunk(999,0,true),false,'raw/unregistered chunks receive no cache authority');
}

// ------------------------------------------------------- one copy per hot region
{
  R.reset();
  assert.equal(R.onTileChanged(1,1,T.AIR,T.OBSERVER_REPLICA),true,'the first coordinate claims its region');
  assert.equal(R.canAcceptTileChange(2,2,T.AIR,T.OBSERVER_REPLICA),false,
    'the terrain boundary refuses a wasteful second copy in the same region');
  const floor=()=>T.STONE;
  assert.equal(R.validatePlacement(2,2,floor).ok,false,'placement explains that the region is already covered');
  assert.equal(R.validatePlacement(2,2,floor).code,'region','same-region races report their actual cause');
  assert.equal(R.onTileChanged(CHUNK_W+1,1,T.AIR,T.OBSERVER_REPLICA),true,'the adjacent region remains useful');
}

// ------------------------------------------------------------- save round trip
{
  const snap=R.snapshot();
  const sorted=snap.list.slice().sort((a,b)=>(a[0]-b[0])||(a[1]-b[1]));
  assert.deepEqual(snap,{v:1,list:sorted},'snapshot is deterministic, sorted and compact');
  const live=new Set(snap.list.map(row=>row.join(',')));
  const ensured=[];
  R.reset();
  assert.equal(R.restore(
    {v:1,list:[
      ...snap.list,
      snap.list[0],
      [NaN,2],
      [1.5,2],
      [999,10],
      [1234]
    ]},
    (x,y)=>live.has(x+','+y) ? T.OBSERVER_REPLICA : T.AIR,
    {ensureSection:(cx,sy)=>{ ensured.push([cx,sy]); return {}; }}
  ),true,'restore accepts its versioned sidecar and sanitizes individual rows');
  assert.equal(R.count(),snap.list.length,'duplicates, malformed rows and stale tiles preserve every valid saved replica');
  assert.ok(ensured.length<=3,'restore eagerly touches at most one section per active replica');
  assert.equal(R.restore(null),false,'a malformed required snapshot is rejected');
  assert.equal(R.count(),0,'rejected restore leaves a clean registry');
  assert.equal(R.restore({v:1,list:[[0,0]]}),false,'restore fails closed without tile-truth access');
  assert.equal(R.count(),0,'a fail-closed restore cannot activate an arbitrary coordinate');
}

// -------------------------------------------------------- escalating production
{
  for(let tier=1;tier<OBSERVER_REPLICA_COSTS.length;tier++){
    for(const key of Object.keys(OBSERVER_REPLICA_COSTS[0])){
      assert.ok(OBSERVER_REPLICA_COSTS[tier][key]>OBSERVER_REPLICA_COSTS[tier-1][key],
        'tier '+(tier+1)+' increases '+key);
    }
  }
  R.reset();
  const bag={observerReplica:0};
  const notices=[];
  const recipe=R.createRecipe({inventory:bag,notify:text=>notices.push(text)});
  assert.equal(recipe.batchCap,1,'a dynamic escalating bill cannot be bulk-crafted at the first-copy price');
  assert.deepEqual(recipe.cost,OBSERVER_REPLICA_COSTS[0],'the first craft uses the base bill');
  assert.equal(recipe.make(),true,'the first replica crafts');
  assert.equal(bag.observerReplica,1,'crafting produces one placeable replica');
  assert.deepEqual(recipe.cost,OBSERVER_REPLICA_COSTS[1],'the live recipe advances to the second bill');
  assert.equal(recipe.make(),true,'the second replica crafts');
  assert.deepEqual(recipe.cost,OBSERVER_REPLICA_COSTS[2],'the live recipe advances to the third bill');
  assert.equal(recipe.make(),true,'the third replica crafts');
  assert.equal(recipe.done(),true,'the recipe closes at three owned copies');
  assert.match(recipe.doneText(),/3\/3.*postawione.*plecaku.*odzyskanie/,
    'the cap status explains that active, bagged and recoverable copies share one limit');
  assert.equal(recipe.make(),false,'a fourth craft is refused even if called directly');
  assert.equal(bag.observerReplica,3,'direct cap refusal mints nothing');
  assert.ok(notices.some(text=>/3\/3/.test(text)),'craft feedback communicates progress to the cap');

  // Placed + bagged copies share one economy; mining and moving one cannot reset
  // its tier or create a cheap fourth item.
  R.reset();
  R.onTileChanged(0,0,T.AIR,T.OBSERVER_REPLICA);
  const mixed={observerReplica:1};
  assert.equal(R.ownedCount(mixed),2,'placed and inventory copies count together');
  assert.deepEqual(R.costForNext(mixed),OBSERVER_REPLICA_COSTS[2],'the mixed third copy pays the third-tier bill');
  assert.equal(R.ownedCount({observerReplica:0},()=>1),2,'dropped/grave copies can be included without resetting the tier');
}

// ------------------------------------------------ durable multiplayer replay proof
{
  const gid='g-observer-owner';
  const qid='o'+'a'.repeat(24);
  const checkpointGid='g-checkpoint-owner';
  const checkpointQid='o'+'b'.repeat(24);
  R.reset();
  assert.equal(R.onTileChanged(8,9,T.AIR,T.OBSERVER_REPLICA),true,'a host placement registers before it is claimed');
  assert.equal(R.claimTransactionAt(8,9,gid,qid),true,'the accepting multiplayer transaction claims its cell');
  assert.equal(R.matchesTransaction(8,9,gid,qid),true,'the original transaction is recognized');
  assert.equal(R.matchesTransaction(8,9,gid,checkpointQid),false,'a fresh qid is not mistaken for replay');
  assert.equal(R.wasTransactionAccepted(gid,qid),true,'a fresh claim immediately blocks duplicate terrain execution');
  assert.equal(R.acceptedTransaction(gid,qid),null,
    'a pre-commit claim cannot yet produce an authoritative success replay');
  assert.deepEqual(R.transactionRecord(gid,qid),{
    gid,qid,x:8,y:9,action:'place',durable:false,ackPending:false
  },'host persistence may inspect a transient placement without treating it as accepted replay');
  assert.deepEqual(R.metrics(),{
    count:1,cap:3,acceptedTransactions:1,durableTransactions:0,acknowledgementPending:0,regions:1
  },'runtime metrics distinguish a claimed transaction from a durable one');
  const claimed=R.snapshot();
  assert.deepEqual(claimed,{v:1,list:[[8,9,gid,qid]],accepted:[[gid,qid,8,9]]},
    'the placement commit snapshot carries the transient claim without leaking runtime flags');
  assert.equal(R.markTransactionDurable(gid,qid),true,'a completed placement save promotes its exact qid');
  assert.deepEqual(R.acceptedTransaction(gid,qid),{
    gid,qid,x:8,y:9,action:'place',durable:true,ackPending:false
  },'only a durable, receipt-visible success can be replayed');
  assert.equal(R.discardNonDurableTransaction(gid,qid),false,
    'a committed replay proof cannot be discarded through the failure-only API');

  assert.equal(R.beginTransactionAcknowledgement(gid,qid),true,
    'receipt compaction first marks the durable row pending');
  assert.equal(R.beginTransactionAcknowledgement(gid,qid),false,
    'a duplicate receipt cannot start a second removal commit');
  assert.equal(R.acceptedTransaction(gid,qid),null,
    'an acknowledgement-pending qid is hidden from success replay');
  assert.deepEqual(R.snapshot(),{v:1,list:[[8,9,gid,qid]]},
    'the removal commit snapshot omits acknowledgement-pending rows');
  assert.equal(R.restore(
    {v:1,list:[[8,9,gid,qid]],accepted:[[checkpointGid,checkpointQid,20,20]]},
    ()=>T.OBSERVER_REPLICA,
    null,
    {temporal:true}
  ),true,'Temporal Echo may restore coordinates without touching transaction durability');
  assert.equal(R.wasTransactionAccepted(checkpointGid,checkpointQid),false,
    'Temporal Echo ignores checkpoint transaction rows');
  assert.equal(R.acceptedTransaction(gid,qid),null,
    'Temporal Echo preserves the current acknowledgement-pending state exactly');
  assert.equal(R.metrics().acknowledgementPending,1,
    'Temporal Echo does not silently clear an in-flight receipt');
  assert.equal(R.finalizeTransactionAcknowledgement(gid,qid,false),true,
    'a failed removal save rolls its exact qid back to replayable');
  assert.equal(R.acceptedTransaction(gid,qid)?.ackPending,false,
    'failed receipt persistence restores the durable replay proof');

  const durableClaim=R.snapshot();
  R.reset();
  assert.equal(R.restore(durableClaim,()=>T.OBSERVER_REPLICA),true,'claimed observer state restores');
  assert.equal(R.matchesTransaction(8,9,gid,qid),true,'restart restore preserves exact replay identity');
  assert.equal(R.acceptedTransaction(gid,qid)?.durable,true,
    'normal save restore imports wire rows as already durable');
  assert.equal(R.wasTransactionAccepted(gid,qid),true,'accepted success survives even if its tile is later removed');
  assert.equal(R.onTileChanged(8,9,T.OBSERVER_REPLICA,T.AIR),true,'the accepted observer may later be mined');
  assert.equal(R.wasTransactionAccepted(gid,qid),true,'mining cannot make the same paid qid executable again');
  assert.equal(R.beginTransactionAcknowledgement(gid,qid),true,'a durable client receipt begins tombstone compaction');
  assert.equal(R.finalizeTransactionAcknowledgement(gid,qid,true),true,
    'a committed receipt snapshot finally releases its tombstone');
  assert.equal(R.wasTransactionAccepted(gid,qid),false,'acknowledged outcomes no longer consume tombstone capacity');

  const transientQid='o'+'c'.repeat(24);
  assert.equal(R.onTileChanged(10,9,T.AIR,T.OBSERVER_REPLICA),true,'a second region accepts a fresh transient claim');
  assert.equal(R.claimTransactionAt(10,9,gid,transientQid),true,'the transient qid is tracked before persistence');
  assert.equal(R.discardNonDurableTransaction(gid,transientQid),true,
    'a failed placement save may discard only its non-durable record');
  assert.equal(R.wasTransactionAccepted(gid,transientQid),false,'the discarded transaction can be retried');
  assert.equal(R.markTransactionDurable(gid,transientQid),false,'a discarded qid cannot be promoted accidentally');

  const mineQid='o'+'d'.repeat(24);
  assert.equal(R.claimDetachedTransaction(gid,mineQid,-20,-5),true,
    'observer mining can claim a bounded transaction after removing its live cell');
  assert.equal(R.claimDetachedTransaction(gid,mineQid,-20,-5),false,
    'a detached claim must be fresh rather than silently accepting a duplicate');
  assert.equal(R.claimDetachedTransaction('bad gid',mineQid,-20,-5),false,
    'detached claims reject invalid guest identities');
  assert.equal(R.claimDetachedTransaction(gid,'bad-qid',-20,-5),false,
    'detached claims reject invalid transaction identities');
  assert.equal(R.claimDetachedTransaction(gid,'o'+'e'.repeat(24),0.5,0),false,
    'detached claims reject fractional tile coordinates rather than moving the receipt');
  assert.equal(R.claimDetachedTransaction(gid,'o'+'e'.repeat(24),0,Infinity),false,
    'detached claims reject invalid removed-cell coordinates');
  assert.deepEqual(R.transactionRecord(gid,mineQid),{
    gid,qid:mineQid,x:-20,y:-5,action:'mine',durable:false,ackPending:false
  },'a detached record retains mine action identity and its removed coordinate');
  assert.ok(R.snapshot().accepted.some(row=>
    row[0]===gid && row[1]===mineQid && row[2]===-20 && row[3]===-5 && row[4]==='mine'
  ),'mine snapshots append an action tag while existing placement rows keep their compact wire shape');
  assert.equal(R.markTransactionDurable(gid,mineQid),true,'the detached mine uses the ordinary durable promotion');
  assert.equal(R.acceptedTransaction(gid,mineQid)?.action,'mine',
    'durable replay reports mine rather than fabricating a placement result');
  assert.equal(R.beginTransactionAcknowledgement(gid,mineQid),true,
    'the detached mine enters the same two-phase receipt lifecycle');
  assert.equal(R.finalizeTransactionAcknowledgement(gid,mineQid,false),true,
    'a failed mine receipt save restores its replay proof');
  assert.equal(R.acceptedTransaction(gid,mineQid)?.action,'mine',
    'receipt rollback preserves detached action identity');
  const mineSnapshot=R.snapshot();
  R.reset();
  assert.equal(R.restore(mineSnapshot,()=>T.OBSERVER_REPLICA),true,
    'normal restore accepts the backward-compatible tagged mine row');
  assert.deepEqual(R.acceptedTransaction(gid,mineQid),{
    gid,qid:mineQid,x:-20,y:-5,action:'mine',durable:true,ackPending:false
  },'restart restore imports detached action and durability together');
  assert.equal(R.beginTransactionAcknowledgement(gid,mineQid),true,'the restored mine can be acknowledged');
  assert.equal(R.finalizeTransactionAcknowledgement(gid,mineQid,true),true,
    'a successful receipt commit releases the detached tombstone');

  const accepted=Array.from({length:R.ACCEPTED_TX_MAX},(_,i)=>[
    'g'+i,
    'o'+i.toString(16).padStart(24,'0'),
    i*CHUNK_W,
    0
  ]);
  R.reset();
  assert.equal(R.restore({v:1,list:[],accepted},()=>T.AIR),true,'the bounded unresolved-outcome ledger restores');
  assert.equal(R.canAcceptTransaction('g-next','o'+'f'.repeat(24)),false,
    'a full durable ledger rejects new placement before terrain mutation instead of evicting replay proof');
  assert.equal(R.claimDetachedTransaction('g-next','o'+'f'.repeat(24),0,0),false,
    'the same hard ledger cap rejects a fresh detached mine claim');
  R.reset();
}

// -------------------------------------------------------------- render smoke
{
  const g={
    globalAlpha:1, fillStyle:'', font:'', textAlign:'', textBaseline:'',
    save(){},restore(){},beginPath(){},ellipse(){},fill(){},moveTo(){},lineTo(){},closePath(){},
    fillRect(){},fillText(){}
  };
  let outfitCalls=0;
  assert.equal(R.drawTile(g,0,0,20,{drawOutfit:()=>{ outfitCalls++; },customization:{outfitStyle:'ninja'}}),true,
    'the replica has dedicated open-fixture art');
  assert.equal(outfitCalls,1,'replica art reuses the current hero outfit renderer');
}

// ----------------------------------------------------------- wiring contracts
{
  const [main,world,sim,inventory,ghostHost,ghostClient,ghostNet,pkg]=await Promise.all([
    readFile(new URL('../src/main.js',import.meta.url),'utf8'),
    readFile(new URL('../src/engine/world.js',import.meta.url),'utf8'),
    readFile(new URL('../src/engine/world_sim.js',import.meta.url),'utf8'),
    readFile(new URL('../src/inventory.js',import.meta.url),'utf8'),
    readFile(new URL('../src/engine/ghost_host.js',import.meta.url),'utf8'),
    readFile(new URL('../src/engine/ghost_client.js',import.meta.url),'utf8'),
    readFile(new URL('../src/engine/ghost_net.js',import.meta.url),'utf8'),
    readFile(new URL('../package.json',import.meta.url),'utf8')
  ]);
  assert.match(main,/RECIPES\.push\(OBSERVER_REPLICAS\.createRecipe\(\{[\s\S]*?externalOwned:/,
    'the escalating recipe joins the ordinary crafting panel');
  assert.match(main,/INVASIONS&&INVASIONS\.cachedResourceCount&&INVASIONS\.cachedResourceCount\('observerReplica'\)/,
    'recoverable invasion-cache copies remain part of observer-replica ownership');
  assert.match(main,/externalOwned:[\s\S]{0,500}\+pendingObserverPlacementCount\(\)/,
    'an in-flight guest placement remains part of the bounded ownership economy');
  assert.match(main,/if\(tracksObserver && !addPendingObserverPlacement\(tx,ty\)\) return false;[\s\S]{0,260}if\(tracksObserver\) settlePendingObserverPlacement\(tx,ty\)/,
    'guest placement reserves ownership before sending and rolls it back if the intent cannot leave');
  assert.match(main,/observerPendingRegionReserved\(x,y\) \|\| pendingObserverPlacementCount\(\)>=OBSERVER_REPLICAS\.MAX/,
    'an in-flight placement reserves its entire 64x70 region before payment');
  assert.match(main,/consumeFor\(v\.id\); updateInventory\(\); updateHotbarCounts\(\);[\s\S]{0,100}commitPlace\(placementIntent\)/,
    'the qid becomes durable only after the local observer item was actually debited');
  assert.match(main,/ghostHeroRefund:\(tid,x,y\)=>\{[\s\S]{0,140}settlePendingObserverPlacement\(x,y\)/,
    'a rejected authoritative placement settles its reservation before refunding the item');
  assert.match(main,/if\(!MM\.ghostHeroIntents\) clearPendingObserverPlacements\(\)/,
    'a reconnect snapshot retains conservative in-flight guest ownership');
  assert.doesNotMatch(main,/reconcilePendingObserverPlacements/,
    'a cached snapshot cannot settle an intent merely because a stale coordinate is present');
  assert.match(main,/ghostHeroObserverPendingRestore:\(rows\)=>restorePendingObserverPlacements\(rows\)/,
    'durable qid rows rebuild the bounded ownership reservation after reload');
  assert.match(main,/function pendingObserverRecoveryCount\(\)[\s\S]{0,260}pendingObserverRecoveries/,
    'the guest tracks a bounded ownership reservation while an observer recovery is unsettled');
  assert.match(main,/externalOwned:\(\)=>[\s\S]{0,500}\+pendingObserverRecoveryCount\(\)/,
    'an observer being durably recovered still occupies one of the three ownership slots');
  assert.match(ghostClient,/pending:heroPlaceTxSnapshot\(\)/,
    'the debited inventory and unresolved observer transactions persist in one hero-state record');
  assert.match(ghostClient,/if\(\(pl\.a==='place' \|\| pl\.a==='mine'\) && NET\.validHeroPlaceQid\(pl\.qid\) && heroPlaceTx\.has\(pl\.qid\)\)\{[\s\S]{0,100}settleHeroObserverAck\(pl\)/,
    'known observer placement and recovery outcomes settle even after a permission packet demotes the hero');
  assert.match(ghostClient,/replayHeroPlaceTransactions\(false\)/,
    'unresolved qids retry on the client heartbeat');
  assert.match(ghostClient,/if\(!tx \|\| !tx\.committed \|\| state!=='live' \|\| !conn\) return false/,
    'a demoted guest may still query a committed qid outcome while connected');
  assert.match(ghostClient,/commitPlace\(qid\)\{[\s\S]{0,260}tx\.committed=true;[\s\S]{0,220}if\(!saveHeroState\(true,true\)\)[\s\S]{0,420}sendHeroPlaceTransaction\(tx,true\)/,
    'a spent placement and its qid reach guest storage before the first host packet');
  assert.match(ghostClient,/mineBreak\(tx, ty, tid\)\{[\s\S]{0,800}heroPlaceTx\.set\(qid,row\);[\s\S]{0,700}if\(!saveHeroState\(true,true\)\)[\s\S]{0,500}sendHeroPlaceTransaction\(row,true\)/,
    'observer recovery journals its qid before asking the host to remove terrain');
  assert.match(ghostClient,/NET\.heroPlaceRegionKey\(px,py\)[\s\S]{0,220}heroPlaceTx\.values\(\)[\s\S]{0,120}===region/,
    'the durable client ledger refuses a second in-flight transaction in one region');
  assert.match(ghostClient,/let heroSavedState = null[\s\S]*if\(hero\.on\)\{[\s\S]{0,100}heroSavedState=bridge\.ghostHeroCapture\(\)/,
    'late outcomes persist a detached guest state instead of capturing a spectator snapshot');
  assert.match(ghostClient,/if\(hero\.on\)\{[\s\S]{0,160}ghostHeroRefund[\s\S]{0,260}ghostHeroRefundSaved\(heroSavedState,tx\.tid\)/,
    'post-demotion rejection refunds only the detached guest inventory');
  assert.match(ghostClient,/tx\.receipt=true;[\s\S]{0,700}if\(!saveHeroState\(true,true\)\)[\s\S]{0,1200}sendHeroPlaceTransaction\(tx,true\)/,
    'success settlement reaches storage before its host compaction receipt');
  assert.match(ghostClient,/conn\.send\(tx\.receipt \? \{t:'hrec',qid:tx\.qid\}/,
    'a persisted receipt phase retries through the bounded transaction sender');
  assert.match(ghostClient,/if\(pl\.t === 'hrack'\)\{[\s\S]{0,80}finishHeroObserverReceipt\(pl\)/,
    'the client removes its durable qid only after the host confirms receipt persistence');
  assert.match(ghostNet,/function createHeroPlaceOutcomeLedger/,
    'the host outcome cache is a bounded protocol primitive');
  assert.match(ghostHost,/heroPlaceOutcomes: NET\.createHeroPlaceOutcomeLedger/,
    'the host retains transaction outcomes through its reconnect window');
  assert.match(ghostHost,/heroObserverPending: new Map\(\)/,
    'the host coalesces qid retries while a world commit is awaiting durable storage');
  assert.match(ghostHost,/const persistObserverOutcome=\(packet\)=>\{[\s\S]{0,700}ghostHeroObserverPersist[\s\S]{0,400}Promise\.resolve\(commit\)\.then\(durable=>\{[\s\S]{0,260}if\(!durable \|\| s\.closed\) return;[\s\S]{0,320}peer\.send\(packet\)/,
    'the host sends observer success only after the exact transaction save resolves durable');
  assert.match(ghostHost,/observerQid \? \{gid:entry\.gid,qid:observerQid\} : null/,
    'the host passes exact restart replay identity into the world transaction');
  const durableReplayAt=ghostHost.indexOf('accepted=bridge.ghostHeroObserverAccepted');
  const permissionGateAt=ghostHost.indexOf("if(!b || entry.mode !== 'hero')",durableReplayAt);
  assert.ok(durableReplayAt>=0 && permissionGateAt>durableReplayAt,
    'durable accepted qids replay before current permission/body gates');
  assert.match(ghostHost,/pl\.t === 'hrec'[\s\S]{0,700}ghostHeroObserverReceipt[\s\S]{0,700}\{t:'hrack',qid:pl\.qid\}/,
    'the host confirms a narrow receipt packet only after durable outcome compaction');
  assert.match(ghostHost,/heroReceiptPending: new Map\(\)/,
    'duplicate receipts share one in-flight durable compaction');
  assert.match(main,/OBSERVER_REPLICAS\.matchesTransaction\(tx,ty,claim\.gid,claim\.qid\)[\s\S]{0,120}reason:'occupied'/,
    'an occupied observer cell accepts only its original persisted qid');
  assert.match(main,/const prior=OBSERVER_REPLICAS\.transactionRecord\(claim\.gid,claim\.qid\);[\s\S]{0,180}prior\.action!=='place' \|\| prior\.x!==tx \|\| prior\.y!==ty/,
    'an accepted qid is action- and coordinate-bound, so it cannot write another tile after mining');
  assert.match(main,/ghostHeroObserverReceipt:\(gid,qid\)=>\{[\s\S]{0,1200}beginTransactionAcknowledgement[\s\S]{0,1200}finalizeTransactionAcknowledgement/,
    'receipt compaction persists omission before it finally releases the matching durable success');
  assert.match(main,/WORLD_SIM\.beginFrame\(dt,player,MM\.coopBodies,OBSERVER_REPLICAS\.activeAnchors\(\)\)/,
    'the frame receives replicas on a separate anchor plane');
  assert.equal((main.match(/observerPlacement=OBSERVER_REPLICAS\.validatePlacement/g)||[]).length,2,
    'both solo preview/mutation and host-authoritative guest placement validate the cap');
  assert.match(main,/id===T\.OBSERVER_REPLICA && layer!=='fg'/,
    'a forged guest request cannot route the replica onto an overlay/background layer');
  assert.match(main,/ghostHeroPlacementUsesLocalEntitlement:\(tid\)=>\(Number\(tid\)\|0\)===T\.OBSERVER_REPLICA/,
    'a full-hero guest may spend its real local crafted replica entitlement');
  assert.match(ghostHost,/if\(!escrowDebited && !localEntitlement\)/,
    'the host keeps escrow mandatory for every non-whitelisted placement');
  assert.match(ghostHost,/else if\(escrowDebited\) NET\.pouchAdd\(b\.pouch, key, 1\)/,
    'a rejected guest placement refunds only stock that was actually debited');
  assert.match(ghostClient,/for\(const cell of cells\)\{[\s\S]{0,260}old===T\.OBSERVER_REPLICA && cell\.v!==T\.OBSERVER_REPLICA[\s\S]{0,180}cell\.applied=true;[\s\S]{0,160}for\(const cell of cells\) if\(!cell\.applied\)/,
    'live tile batches release observer slots before applying additions at other coordinates');
  assert.match(ghostHost,/sendHeroAction\(\{ t: 'hact', a: 'place', ok: false, reason: 'rate', x: tx, y: ty, tid \}\)/,
    'a rate-limited local-entitlement placement is acknowledged so the guest refunds its replica');
  assert.match(main,/observerReplicas:\s*timedSavePart\('observerReplicas'/,'replica coordinates join normal saves');
  assert.match(main,/restoreRequired\('observerReplicas',observerRestoreData!=null/,
    'normal and journal loads validate their effective coordinate sidecar');
  assert.match(main,/meta=\{observerReplicas:criticalState\.observerReplicas,criticalState\}/,
    'crash recovery journals observer coordinates together with the matching spent inventory');
  assert.match(main,/WORLD\.beginObserverRestore\(observerRestoreData\)[\s\S]{0,260}WORLD\.endObserverRestore\(\)/,
    'terrain restoration admits raw observer ids only while their authoritative sidecar is active');
  assert.match(main,/restore\(OBSERVER_REPLICAS,d\.observerReplicas,\[WORLD\.peekTile,WORLD,\{temporal:true\}\]\)/,
    'Temporal Echo reconciles anchors without rolling back transaction durability');
  assert.match(main,/if\(OBSERVER_REPLICAS && OBSERVER_REPLICAS\.reset\) OBSERVER_REPLICAS\.reset\(\)/,
    'world transitions clear old anchors');
  assert.match(main,/OBSERVER_REPLICAS\.drawWorld\(ctx,TILE,worldFxVisible/,
    'placed replicas are dynamically drawn through fog using the hero look');
  assert.match(main,/const region=OBSERVER_REPLICAS\.regionAt\(gp\.tx,gp\.ty\)/,
    'placement preview draws the exact grid-aligned coverage region before purchase');
  assert.match(main,/ghostHeroPlaced:\(tid\)=>/,
    'a successful full-hero guest placement receives activation feedback');
  assert.match(ghostHost,/ghostHeroPlacementUsesLocalEntitlement/,
    'the host consults the narrow local-entitlement whitelist');
  assert.match(world,/MM\.observerReplicas\.onTileChanged/,'all tile removal/mutation paths update the registry');
  assert.match(world,/MM\.observerReplicas\.canAcceptTileChange/,
    'the terrain write boundary rejects a fourth raw replica before mutation');
  assert.match(world,/MM\.observerReplicas\.pinsChunk/,
    'only bounded registered coordinates, not raw tile ids, may pin observer chunks');
  assert.match(world,/sanitizeObserverTiles\(next,ref\)/,
    'bulk terrain restore strips raw replicas that are absent from the authoritative sidecar');
  assert.match(main,/tId!==T\.OBSERVER_REPLICA && Math\.random\(\)<PICK_PERKS\.double\.chance/,
    'the double-yield pick perk cannot duplicate a replica');
  assert.match(main,/tId===T\.BEDROCK \|\| tId===T\.OBSERVER_REPLICA/,
    'vein mining cannot chain through adjacent replicas');
  assert.match(sim,/hotRegions\.add\(rKey\(colOf\(observer\.x\),secOf\(observer\.y\)\)\)/,
    'observer presence wakes one exact simulation region');
  assert.doesNotMatch(sim,/windows\.push\(\{x:observer\.x/,
    'replicas never enter player-sized actor windows');
  assert.match(inventory,/OBSERVER_REPLICA_RESOURCE/,'inventory includes the placeable replica resource');
  const scripts=JSON.parse(pkg).scripts;
  assert.equal(scripts['test:observer-replicas'],'node tools/observer-replicas-sim.test.mjs',
    'the focused suite is available through npm');
}

console.log('observer-replicas-sim: all assertions passed');
