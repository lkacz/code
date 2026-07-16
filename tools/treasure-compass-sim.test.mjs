import assert from 'node:assert/strict';

globalThis.window=globalThis;
globalThis.MM={};

const {T,INFO}=await import('../src/constants.js');
const {
  createTreasureCompass,classifyTreasureTile,classifyTreasureTarget,
  compassNeedleGeometry,drawTreasureCompass,createRotatingTargetWindow
}=await import('../src/engine/treasure_compass.js');

function worldFrom(entries){
  const map=new Map(entries.map(([x,y,t])=>[`${x},${y}`,t]));
  return {
    map,
    getTile(x,y){ return map.get(`${x},${y}`)??T.AIR; }
  };
}

function scanPass(scanner,args,max=10000){
  const before=scanner.metrics().completedPasses;
  for(let i=0;i<max&&scanner.metrics().completedPasses===before;i++) scanner.update({...args,dt:1});
  assert.equal(scanner.metrics().completedPasses,before+1,'bounded sliced scan completes');
  return scanner.target();
}

// Dynamic drops are sampled once per completed terrain pass, not once per
// frame. With the old per-frame cursor, a 54-frame level-four pass advanced by
// 54*96 entries; for a 108-entry list that wrapped to the same window forever,
// permanently hiding indices 96..107.
{
  const list=Array.from({length:108},(_,id)=>({id,kind:'resource',x:id,y:0}));
  list[107]={id:107,kind:'chest',tier:'legendary',x:7.5,y:0.5};
  const window=createRotatingTargetWindow({limit:96});
  const mapChest=(d)=>d&&d.kind==='chest'?d:null;
  assert.deepEqual(window.sample(list,0,mapChest),[],'first bounded window contains no late chest');
  for(let frame=1;frame<=54;frame++) window.sample(list,0,mapChest);
  assert.equal(window.metrics().cursor,96,'repeated frames in one pass do not advance the window');
  const second=window.sample(list,1,mapChest);
  assert.equal(second.length,1,'next completed pass rotates into the previously skipped tail');
  assert.equal(second[0].id,107,'index 107 cannot be permanently starved');
  assert.ok(window.metrics().cached<=96,'dynamic target window retains its hard cap');
  window.reset();
  assert.equal(window.metrics().cursor,0,'world reset clears the rotating drop cursor');
}

// Data-driven classification covers every authored treasure family and future
// ore metadata, while ordinary geology/building blocks remain silent.
assert.equal(classifyTreasureTile(T.CHEST_LEGENDARY,INFO[T.CHEST_LEGENDARY]).category,'chest');
assert.equal(classifyTreasureTile(T.INVASION_CACHE,INFO[T.INVASION_CACHE]).category,'cache');
assert.equal(classifyTreasureTile(T.SILVER_ORE,INFO[T.SILVER_ORE]).label,'ruda srebra');
assert.equal(classifyTreasureTile(T.ANTIMATTER_CRYSTAL,INFO[T.ANTIMATTER_CRYSTAL]).tier,'legendary');
assert.equal(classifyTreasureTile(T.STONE,INFO[T.STONE]),null);
assert.deepEqual(classifyTreasureTile(999,{ore:true}),{category:'ore',value:68,label:'cenna ruda',tier:'uncommon'});
assert.equal(classifyTreasureTarget({kind:'chest',tier:'epic'}).value,106);
assert.equal(classifyTreasureTarget({kind:'ordinary-drop'}),null);

// Levels expand the authored circular reach and never see just one tile beyond.
{
  const ranges=[0,3,5,7,9];
  const world=worldFrom([[3,0,T.DIAMOND],[5,0,T.GOLD_ORE],[7,0,T.SILVER_ORE],[9,0,T.IRIDIUM]]);
  for(let level=1;level<=4;level++){
    const scanner=createTreasureCompass({ranges,budgets:[0,9,11,13,17],cadence:[0,0,0,0,0],selection:'nearest'});
    const target=scanPass(scanner,{level,player:{x:0.5,y:0.5},getTile:world.getTile,isDiscovered:()=>true});
    assert.ok(target,`level ${level} sees its boundary`);
    assert.equal(target.x,3,'nearest mode stays on the nearest in-range treasure');
    const m=scanner.metrics();
    assert.equal(m.range,ranges[level]);
    assert.ok(m.maxTilesPerUpdate<=m.budget,'every update respects its tile budget');
  }
  const onlyFar=worldFrom([[4,0,T.DIAMOND]]);
  const scanner=createTreasureCompass({ranges,budgets:[0,99,99,99,99],cadence:[0,0,0,0,0]});
  assert.equal(scanPass(scanner,{level:1,player:{x:0.5,y:0.5},getTile:onlyFar.getTile,isDiscovered:()=>true}),null,'outside the level range is not scanned');
}

// Physical reward chests can join the same bounded pass through an explicitly
// supplied, capped list. They use the identical discovery gate and never cause
// terrain reads of their own.
{
  const scanner=createTreasureCompass({
    ranges:[0,10,10,10,10],budgets:[0,20,20,20,20],cadence:[0,0,0,0,0],
    maxExtraTargets:3,extraBudget:1
  });
  const offered=[
    {id:1,x:2.5,y:0.5,kind:'chest',tier:'rare'},
    {id:2,x:4.5,y:0.5,kind:'chest',tier:'legendary'}, // hidden
    {id:3,x:7.5,y:0.5,kind:'chest',tier:'epic'},
    {id:4,x:1.5,y:0.5,kind:'chest',tier:'legendary'} // beyond hard list cap
  ];
  let reads=0;
  const target=scanPass(scanner,{
    level:1,player:{x:0.5,y:0.5},getTile:()=>{ reads++; return T.AIR; },extraTargets:offered,
    isDiscovered:(x,y)=>x!==4
  });
  assert.equal(target.source,'extra');
  assert.equal(target.key,'extra:chest:3','visible physical chest is detected');
  assert.equal(target.tier,'epic');
  const m=scanner.metrics();
  assert.equal(m.lastPassExtra,3,'extra target snapshot obeys its hard cap');
  assert.equal(m.extraTruncated,1);
  assert.equal(m.extraSkippedUndiscovered,1,'hidden physical chest is rejected');
  assert.equal(m.extraCandidates,2);
  assert.ok(m.maxExtraPerUpdate<=1,'extra targets are staggered by their own budget');
  assert.equal(reads,m.tileReads,'physical targets do not add terrain reads');

  const hardened=createTreasureCompass({
    ranges:[0,2,2,2,2],budgets:[0,99,99,99,99],cadence:[0,0,0,0,0],
    maxExtraTargets:99999,extraBudget:99999
  });
  const oversized=Array.from({length:300},(_,id)=>({id,x:0.5,y:0.5,kind:'chest',tier:'common'}));
  scanPass(hardened,{level:1,player:{x:0.5,y:0.5},getTile:()=>T.AIR,isDiscovered:()=>true,extraTargets:oversized});
  const hm=hardened.metrics();
  assert.equal(hm.maxExtraTargets,256,'hostile config cannot lift the absolute list cap');
  assert.equal(hm.lastPassExtra,256);
  assert.equal(hm.extraTruncated,44);
  assert.equal(hm.extraBudget,64,'hostile config cannot lift the absolute per-update budget');
  assert.ok(hm.maxExtraPerUpdate<=64);
}

// Fog gate is fail-closed and runs before getTile. A hidden legendary cache
// cannot beat (or even cause a read next to) a discovered mundane chest.
{
  const world=worldFrom([[2,0,T.CHEST_COMMON],[4,0,T.INVASION_CACHE]]);
  let reads=0,hiddenReads=0;
  const getTile=(x,y)=>{ reads++; if(x===4&&y===0) hiddenReads++; return world.getTile(x,y); };
  const scanner=createTreasureCompass({ranges:[0,6,6,6,6],budgets:[0,8,8,8,8],cadence:[0,0,0,0,0]});
  const target=scanPass(scanner,{
    level:1,player:{x:0.5,y:0.5},getTile,
    isDiscovered:(x,y)=>!(x===4&&y===0)
  });
  assert.equal(target.x,2);
  assert.equal(hiddenReads,0,'undiscovered tile is never passed to getTile');
  assert.equal(reads,scanner.metrics().tileReads);
  assert.ok(scanner.metrics().skippedUndiscovered>=1);

  const closed=createTreasureCompass({ranges:[0,4,4,4,4],budgets:[0,99,99,99,99],cadence:[0,0,0,0,0]});
  closed.update({level:1,player:{x:0.5,y:0.5},getTile});
  assert.equal(closed.metrics().tileReads,0,'missing discovery callback reveals nothing');
  assert.equal(closed.target(),null);
}

// Balanced mode values a rare cache above a nearby common ore, while callers
// can still retrieve the independently tracked nearest target.
{
  const world=worldFrom([[1,0,T.SILVER_ORE],[8,0,T.INVASION_CACHE]]);
  const scanner=createTreasureCompass({ranges:[0,10,10,10,10],budgets:[0,31,31,31,31],cadence:[0,0,0,0,0]});
  const target=scanPass(scanner,{level:1,player:{x:0.5,y:0.5},getTile:world.getTile,isDiscovered:()=>true});
  assert.equal(target.category,'cache','high-value target wins balanced priority');
  assert.equal(scanner.bestTarget().x,8);
  assert.equal(scanner.nearestTarget().x,1,'nearest treasure is exposed for alternate UI copy');
  assert.equal(target.direction.octant,'E');
  assert.ok(target.distance>7&&target.signal>0);
}

// Hysteresis keeps a valid incumbent when a similarly scored neighbour gains a
// tiny edge, yet releases it immediately when it disappears.
{
  const world=worldFrom([[3,-1,T.GOLD_ORE],[3,1,T.GOLD_ORE]]);
  const scanner=createTreasureCompass({ranges:[0,8,8,8,8],budgets:[0,500,500,500,500],cadence:[0,0,0,0,0],switchMargin:0.15});
  let args={level:1,player:{x:0.5,y:-0.1},getTile:world.getTile,isDiscovered:()=>true};
  let target=scanPass(scanner,args);
  assert.equal(target.y,-1);
  args={...args,player:{x:0.5,y:0.1}};
  target=scanPass(scanner,args);
  assert.equal(target.y,-1,'small score inversion does not jitter the needle');
  world.map.delete('3,-1');
  target=scanPass(scanner,args);
  assert.equal(target.y,1,'mined incumbent is dropped after the next bounded pass');
}

// A large maximum scan remains circular, finite, and sliced. It cannot perform
// a one-frame world scan even when a hostile config requests enormous values.
{
  const scanner=createTreasureCompass({
    ranges:[0,9999,9999,9999,9999],budgets:[0,37,37,37,99999],cadence:[0,0,0,0,0]
  });
  const args={level:4,player:{x:0.5,y:0.5},getTile:()=>T.AIR,isDiscovered:()=>true};
  scanner.update(args);
  let m=scanner.metrics();
  assert.equal(m.range,96,'range is hard-capped');
  assert.equal(m.budget,1024,'per-frame budget is hard-capped');
  assert.equal(m.lastUpdateTiles,1024);
  assert.ok(m.offsetCount<Math.pow(96*2+1,2),'scan uses a circle, not an enclosing square');
  assert.ok(m.offsetCount>28000,'circle covers the expected local area');
  assert.equal(m.completedPasses,0,'maximum scan is staggered across frames');
  scanPass(scanner,args,100);
  m=scanner.metrics();
  assert.ok(m.maxTilesPerUpdate<=1024);
  assert.equal(m.lastPassTiles,m.offsetCount);
  assert.equal(scanner.target(),null);
}

// Canvas helper is DOM-free, returns deterministic geometry, and visibly turns
// and stretches as signal strength grows.
{
  const east={category:'ore',signal:0.2,direction:{angle:0}};
  const strong={category:'cache',signal:0.9,direction:{angle:Math.PI/2}};
  const weakG=compassNeedleGeometry(east,{radius:20});
  const strongG=compassNeedleGeometry(strong,{radius:20});
  assert.equal(weakG.angle,0);
  assert.equal(strongG.angle,Math.PI/2);
  assert.ok(strongG.length>weakG.length,'strong signal stretches the pendant needle');
  const calls=[];
  const ctx={
    globalAlpha:1,save(){calls.push('save');},restore(){calls.push('restore');},translate(){},rotate(a){calls.push(['rotate',a]);},
    beginPath(){},arc(){},fill(){},stroke(){},moveTo(){},lineTo(){},closePath(){},
    set fillStyle(v){this._fill=v;},set strokeStyle(v){this._stroke=v;},set lineWidth(v){this._width=v;},
    set shadowColor(v){this._shadow=v;},set shadowBlur(v){this._blur=v;},set lineCap(v){this._cap=v;}
  };
  const drawn=drawTreasureCompass(ctx,strong,{x:12,y:18,radius:20,time:1});
  assert.equal(drawn.active,true);
  assert.ok(calls.some(c=>Array.isArray(c)&&c[0]==='rotate'&&c[1]===Math.PI/2));
  assert.equal(drawTreasureCompass(null,strong),null);
  assert.equal(compassNeedleGeometry(null,{radius:20}).active,false);
}

console.log('treasure compass simulation tests passed');
