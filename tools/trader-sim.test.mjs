// Wandering-trader regression tests: visit clock, stall scouting on real
// terrain rules, seeded per-visit stock, dual-currency trades (diamonds for
// supplies, iridium for premium goods), epic chest placement, anti-arbitrage and
// snapshot/restore through the npc registry.
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.CustomEvent = class { constructor(type,opts){ this.type=type; this.detail=opts&&opts.detail; } };
globalThis.dispatchEvent = () => true;
let simNow = 0;
globalThis.performance = { now:()=>simNow };
const messages = [];
globalThis.msg = (t)=>messages.push(String(t));

const { T } = await import('../src/constants.js');
const { npcRegistry } = await import('../src/engine/npc_system.js');
const { trader } = await import('../src/engine/trader.js');
const { getByKey: getFurnishingByKey } = await import('../src/engine/furnishings.js');
assert.ok(trader, 'trader module exports');
assert.equal(npcRegistry.get('trader'), trader, 'trader registers into the npc system');

// ---- flat world: surface solid at row 30 --------------------------------
const SURF = 30;
const tiles = new Map();
const key=(x,y)=>x+','+y;
const setT=(x,y,t)=>tiles.set(key(x,y),t);
const getTile=(x,y)=>{
  const v=tiles.get(key(x,y));
  if(v!==undefined) return v;
  return y>=SURF ? T.STONE : T.AIR;
};
const setTile=(x,y,t)=>setT(x,y,t);
MM.worldGen = { worldSeed: 424242, surfaceHeight: ()=>SURF };
const physicalChests=[];
const spawnChest=(x,y,tier,opts)=>{ const d={id:physicalChests.length+1,x,y,tier,opts}; physicalChests.push(d); return d; };

const player={x:100,y:SURF-1,hp:40,maxHp:100};
globalThis.player=player;
globalThis.inv={diamond:0,iridium:0,torch:0,wood:0,stone:0,sand:0,coal:0,obsidian:0,glass:0,steel:0,bakedMeat:0,arrowWood:0};

let day=0;
const ctx={
  worldGen:MM.worldGen,
  gameDayFloat:()=>day,
  onChange:()=>{},
  onInventoryChange:()=>{}
};

// 1) no visit before the first-visit day
trader.reset();
trader.update(0.016, player, getTile, setTile, ctx);
assert.equal(trader.isActive(), false, 'trader does not appear on day 0');

// 2) arrival: day passes the clock → stall pitched on valid ground, announced
day=1.3;
trader.update(0.016, player, getTile, setTile, ctx);
assert.equal(trader.isActive(), true, 'trader arrives once the visit day comes');
const pos=trader.position();
assert.ok(Math.abs(pos.x-player.x)>=17 && Math.abs(pos.x-player.x)<=41, 'stall pitched 18-40 columns out');
assert.ok(Math.abs(pos.y-(SURF-1)-0.5)<0.51, 'stall stands on the surface');
assert.ok(messages.some(m=>m.includes('handlarz')||m.includes('Handlarz')), 'arrival is announced');

MM.atomicWinter = {
  contextLines(kind){
    return kind === 'npc' ? ['Atomic winter lasts until winter ends: roof blocks green rain.'] : [];
  }
};
messages.length = 0;
const playerStart = {x:player.x, y:player.y};
player.x = pos.x;
player.y = pos.y;
trader._state().greeted = false;
trader._state().falloutNoted = false;
trader.update(0.016, player, getTile, setTile, ctx);
assert.ok(messages.some(m=>/Atomic winter/.test(m)), 'wandering trader mentions atomic winter through existing NPC dialogue');
assert.equal(trader.snapshot().falloutNoted, true, 'trader remembers the fallout line for this visit');
delete MM.atomicWinter;
player.x = playerStart.x;
player.y = playerStart.y;

// 3) stock: epic chest always present + seeded goods/rates, deterministic
const stock=trader.stock();
assert.ok(stock, 'active trader exposes stock');
assert.ok(stock.offers.some(o=>o.id==='chest'), 'epic chest is always on offer');
assert.equal(stock.offers.length, 7, 'four seeded goods + two furnishing showcases + the chest');
const furnishingStock=stock.offers.filter(o=>o.furnishingKey);
assert.equal(furnishingStock.length,2,'each visit showcases two discoverable furnishings');
assert.ok(furnishingStock.every(o=>o.cost.iridium>0 && getFurnishingByKey(o.furnishingKey)),
  'furnishing stock is canonical and sold for iridium');
assert.ok(furnishingStock.every(o=>o.furnishingTier===1),'near-origin trader cannot leak advanced furnishing recipes');
assert.equal(stock.rates.length, 3, 'three seeded buy-back rates');
{
  const a=trader._rollStock(7, 424242), b=trader._rollStock(7, 424242);
  assert.deepEqual(a, b, 'stock rolls are deterministic per (visit, seed)');
  const c=trader._rollStock(8, 424242);
  assert.notDeepEqual(a.offers, c.offers, 'different visits shuffle the shelves');
  const frontier=trader._rollStock(7,424242,15000).offers.filter(id=>id.startsWith('decor_'))
    .map(id=>getFurnishingByKey(id.slice(6)));
  assert.ok(frontier.some(def=>def && def.tier===4),'a trader at 15,000 blocks showcases an endgame wonder');
  assert.ok(frontier.every(def=>def && def.tier>=3),'frontier trader support stock remains advanced');
}

// 4) premium stock uses iridium; diamond-priced goods remain anti-arbitrage safe
{
  const goods=trader._goods(), rates=trader._rates();
  assert.deepEqual(goods.find(g=>g.id==='steel').cost, {iridium:1}, 'premium steel bundle costs iridium, not diamonds');
  assert.deepEqual(goods.find(g=>g.id==='obsidian').cost, {iridium:1}, 'premium obsidian bundle costs iridium, not diamonds');
  assert.deepEqual(goods.find(g=>g.id==='strength').cost, {iridium:1}, 'premium strength potion costs iridium, not diamonds');
  assert.deepEqual(trader._epicChest().cost, {iridium:2}, 'the epic trader chest is priced in iridium');
  assert.equal(trader.formatCost({diamond:1,iridium:2}), '1 💎 + 2 Ir', 'mixed costs format both currencies');
  assert.equal(trader.canAffordOffer({cost:{iridium:2}}, {diamond:99,iridium:1}), false, 'diamonds cannot pay an iridium offer');
  for(const g of goods){
    if(!g.give) continue;
    for(const rk of Object.keys(g.give)){
      const rate=rates.find(r=>r.take && r.take[rk]!=null);
      if(!rate) continue;
      const diamondCost=trader._diamondCost(g.cost);
      if(!diamondCost) continue;
      const sellPricePerUnit=diamondCost/g.give[rk];  // diamonds per unit bought
      const buyBackPerUnit=rate.pay/rate.take[rk];    // diamonds per unit sold
      assert.ok(sellPricePerUnit>buyBackPerUnit, 'no arbitrage on '+rk);
    }
  }
}

// 5) buying: rejects when broke, grants resources when paid with the requested currency
{
  const offer=stock.offers.find(o=>o.give && o.cost && o.cost.diamond);
  assert.ok(offer, 'seeded stock includes at least one diamond-priced resource good');
  inv.diamond=0;
  inv.iridium=0;
  let r=trader.tradeBuy(offer.id, {inv, player, getTile, setTile});
  assert.equal(r.ok, false, 'buying with no requested currency fails');
  Object.keys(offer.cost).forEach(k=>{ inv[k]=offer.cost[k]; });
  const giveKey=Object.keys(offer.give)[0];
  const before=inv[giveKey]|0;
  r=trader.tradeBuy(offer.id, {inv, player, getTile, setTile});
  assert.equal(r.ok, true, 'buying with enough requested currency succeeds');
  Object.keys(offer.cost).forEach(k=>assert.equal(inv[k], 0, k+' is spent'));
  assert.equal(inv[giveKey], before+offer.give[giveKey], 'goods are delivered');
}

// 6) selling: rejects shortfalls, pays diamonds otherwise
{
  const rate=trader.stock().rates[0];
  const takeKey=Object.keys(rate.take)[0];
  inv[takeKey]=rate.take[takeKey]-1;
  let r=trader.tradeSell(rate.id, {inv, player});
  assert.equal(r.ok, false, 'selling below the lot size fails');
  inv[takeKey]=rate.take[takeKey];
  const dBefore=inv.diamond|0;
  r=trader.tradeSell(rate.id, {inv, player});
  assert.equal(r.ok, true, 'selling a full lot succeeds');
  assert.equal(inv.diamond, dBefore+rate.pay, 'trader pays diamonds');
  assert.equal(inv[takeKey], 0, 'resources leave the inventory');
}

// 7) off-stock trades are refused
assert.equal(trader.tradeBuy('definitely-not-a-good',{inv,player}).ok, false, 'unknown goods are refused');
assert.equal(trader.tradeSell('definitely-not-a-rate',{inv,player}).ok, false, 'unknown rates are refused');

// 8) the epic chest drops as a heavy physical object beside the stall
{
  inv.diamond=5;
  inv.iridium=0;
  let r=trader.tradeBuy('chest', {inv, player, getTile, setTile, spawnChest});
  assert.equal(r.ok, false, 'diamonds no longer buy the premium chest');
  inv.iridium=2;
  r=trader.tradeBuy('chest', {inv, player, getTile, setTile, spawnChest});
  assert.equal(r.ok, true, 'epic chest purchase succeeds');
  assert.equal(inv.iridium, 0, 'chest costs iridium');
  assert.equal(inv.diamond, 5, 'premium chest does not consume diamonds');
  assert.ok(physicalChests.some(d=>d.tier==='epic' && d.opts.source==='trader'), 'an epic physical chest drops next to the stall');
  assert.ok(![...tiles.values()].some(t=>t===T.CHEST_EPIC), 'trader never writes a chest block');
}

// 5b) furnishing wares are real placeable resources, not UI-only blueprints
{
  const offer=trader.stock().offers.find(o=>o.furnishingKey);
  inv.iridium=offer.cost.iridium;
  const before=inv[offer.furnishingKey]|0;
  const r=trader.tradeBuy(offer.id,{inv,player,getTile,setTile});
  assert.equal(r.ok,true,'an in-stock furnishing can be bought');
  assert.equal(inv[offer.furnishingKey],before+1,'the bought furnishing enters the placeable resource inventory');
}

// 9) potion effects: heal clamps to maxHp, buffs ride MM.progress
{
  const buffs=[];
  MM.progress={ addBuff:(b)=>buffs.push(b) };
  const buyCtx={inv, player, getTile, setTile};
  inv.diamond=10;
  inv.iridium=10;
  player.hp=80;
  const healOk=trader.tradeBuy('heal', buyCtx);
  // heal may not be in this visit's stock — only assert when it is
  if(healOk.ok) assert.equal(player.hp, 100, 'heal restores up to maxHp');
  const speedRes=trader.tradeBuy('speed', buyCtx);
  if(speedRes.ok) assert.ok(buffs.some(b=>b.stats && b.stats.moveSpeedMult), 'speed potion registers a buff');
  MM.progress=null;
}

// 10) interactAt: too far → hint; close → open handler fires
{
  let opened=0;
  trader.setOpenHandler(()=>opened++);
  const p2={x:trader.position().x-20, y:SURF-1};
  assert.equal(trader.interactAt(Math.floor(trader.position().x), SURF-1, p2), true, 'stall click is consumed even from afar');
  assert.equal(opened, 0, 'panel does not open from out of reach');
  p2.x=trader.position().x-2;
  trader.interactAt(Math.floor(trader.position().x), SURF-1, p2);
  assert.equal(opened, 1, 'panel opens when the hero stands at the stall');
  assert.equal(trader.interactAt(Math.floor(trader.position().x)+30, SURF-1, p2), false, 'clicks away from the stall pass through');
  trader.setOpenHandler(null);
}

// 11) snapshot → restore round-trip (the npcs save part carries this)
{
  const snap=trader.snapshot();
  const stockBefore=trader.stock();
  trader.reset();
  assert.equal(trader.isActive(), false, 'reset clears the visit');
  trader.restore(snap);
  assert.equal(trader.isActive(), true, 'restore revives the visit');
  assert.deepEqual(trader.stock(), stockBefore, 'restore keeps the same shelves');
}

// 12) departure: past leaveDay the stall folds and schedules the next visit
{
  let closed=0;
  trader.setCloseHandler(()=>closed++);
  day=trader._state().leaveDay+0.01;
  trader.update(0.016, player, getTile, setTile, ctx);
  assert.equal(trader.isActive(), false, 'trader departs after the visit window');
  assert.ok(closed>=1, 'departure closes the trade panel');
  const next=trader._state().nextVisitDay;
  assert.ok(next>day+1.9 && next<day+3.5, 'next visit lands 2-3.4 days out');
  assert.equal(trader.stock(), null, 'no stock while away');
  trader.setCloseHandler(null);
}

// 13) buried stall: solid ground gone → trader packs up instead of glitching
{
  day=trader._state().nextVisitDay+0.01;
  trader.update(0.016, player, getTile, setTile, ctx);
  assert.equal(trader.isActive(), true, 'trader returns for the next visit');
  const p=trader.position();
  // bury the stall in stone
  setT(Math.floor(p.x), Math.floor(p.y), T.STONE);
  setT(Math.floor(p.x), Math.floor(p.y)-1, T.STONE);
  trader.update(0.016, player, getTile, setTile, ctx);
  assert.equal(trader.isActive(), false, 'a buried stall makes the trader leave');
}

// 14) mined floor: stall drops one tile instead of floating
{
  day=trader._state().nextVisitDay+0.01;
  trader.update(0.016, player, getTile, setTile, ctx);
  assert.equal(trader.isActive(), true, 'trader returns again');
  const p=trader.position();
  const fx=Math.floor(p.x), fy=Math.floor(p.y);
  setT(fx, fy+1, T.AIR); // mine the block under his feet (next floor below is solid)
  trader.update(0.016, player, getTile, setTile, ctx);
  assert.equal(trader.isActive(), true, 'trader survives a one-tile drop');
  assert.equal(Math.floor(trader.position().y), fy+1, 'stall settles one tile down');
}

console.log('trader-sim: all assertions passed');
