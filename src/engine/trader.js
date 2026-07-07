// Wandering trader ("Wędrowny Handlarz"): the economy's closing loop — a sink
// for surplus resources and the first real purpose for diamonds as currency.
// Every ~2-3 game days he pitches a small canopy stall on the surface near the
// player, stays for about half a day, and moves on. Clicking the stall (via
// the npc_system click-to-talk dispatch) opens the trade panel hosted by
// main.js; this module owns everything DOM-free — the visit clock, seeded
// per-visit stock, spot scouting, trade execution against window.inv, canvas
// stall rendering and persistence (rides the npcs save part via the registry).
//
// Anti-arbitrage contract, pinned by tools/trader-sim.test.mjs: for any
// resource both sold and bought, the trader's sell price per unit is strictly
// higher than his buy-back rate, so no buy→sell cycle mints diamonds.
import { T } from '../constants.js';
import { npcRegistry } from './npc_system.js';
import { isSolidCollisionTile as isSolid } from './material_physics.js';

(function(){
  const root = (typeof window!=='undefined') ? window : globalThis;
  root.MM = root.MM || {};
  const MM = root.MM;

  const FIRST_VISIT_DAY = 1.2;   // caravan first shows up during day 2
  const VISIT_LENGTH = 0.55;     // game days the stall stays up
  const PERIOD_MIN = 2.0, PERIOD_SPAN = 1.4; // days between visits (seeded)
  const OFFER_COUNT = 4;         // seeded goods per visit (epic chest always joins)
  const RATE_COUNT = 3;          // seeded buy-back rates per visit
  const TALK_REACH = 4;          // tiles: how close the hero must be to trade

  // Goods the trader sells (cost in diamonds). `give` grants resources,
  // `effect` runs a scripted payoff. Keep ids stable — they persist in saves.
  const GOODS = [
    {id:'torches',  label:'Pochodnie ×6',              icon:'🔥', cost:1, give:{torch:6}},
    {id:'wood',     label:'Drewno ×10',                icon:'🪵', cost:1, give:{wood:10}},
    {id:'arrows',   label:'Strzały drewniane ×20',     icon:'🏹', cost:1, give:{arrowWood:20}},
    {id:'glass',    label:'Szkło ×4',                  icon:'🧊', cost:1, give:{glass:4}},
    {id:'steel',    label:'Stal ×3',                   icon:'⚙️', cost:2, give:{steel:3}},
    {id:'obsidian', label:'Obsydian ×2',               icon:'🟣', cost:2, give:{obsidian:2}},
    {id:'heal',     label:'Eliksir życia (+40 HP)',    icon:'🧪', cost:1, effect:'heal'},
    {id:'speed',    label:'Mikstura szybkości (60 s)', icon:'💨', cost:1, effect:'speed'},
    {id:'strength', label:'Mikstura siły (60 s)',      icon:'💪', cost:2, effect:'strength'}
  ];
  const EPIC_CHEST = {id:'chest', label:'Skrzynia handlarza (epicka)', icon:'🎁', cost:5, effect:'epicChest'};
  // Buy-back rates (trader pays diamonds). Per-unit value must stay below the
  // sell side (see contract above): e.g. wood sells 10/💎, buys back 15/💎.
  const RATES = [
    {id:'stone',    label:'Kamień ×20',         icon:'🪨', take:{stone:20},   pay:1},
    {id:'wood',     label:'Drewno ×15',         icon:'🪵', take:{wood:15},    pay:1},
    {id:'sand',     label:'Piasek ×25',         icon:'🏖️', take:{sand:25},    pay:1},
    {id:'coal',     label:'Węgiel ×8',          icon:'⚫', take:{coal:8},     pay:1},
    {id:'obsidian', label:'Obsydian ×4',        icon:'🟣', take:{obsidian:4}, pay:1},
    {id:'bakedMeat',label:'Pieczone mięso ×6',  icon:'🍖', take:{bakedMeat:6},pay:1},
    {id:'glass',    label:'Szkło ×10',          icon:'🧊', take:{glass:10},   pay:1},
    {id:'fish',     label:'Ryby ×8',            icon:'🐟', take:{fish:8},     pay:1}
  ];

  const GREETINGS = [
    'Świeży towar prosto z innych warstw symulacji!',
    'Diamenty to jedyna waluta, której symulacja nie podrabia.',
    'Kupuję wszystko, czego masz za dużo. Sprzedaję to, czego ci brak.',
    'Kram czynny do zmroku. Albo do najbliższej inwazji.'
  ];

  const S = {
    active:false,
    x:0, y:0,
    visitIndex:0,
    nextVisitDay:FIRST_VISIT_DAY,
    leaveDay:0,
    stock:null,          // {offers:[ids], rates:[ids]}
    greeted:false,
    bob:0
  };
  let openHandler = null;   // main.js: show the trade panel
  let closeHandler = null;  // main.js: hide the trade panel (departure / distance)

  function hash32(a,b){
    let h = (a|0) ^ 0x9e3779b9 ^ ((b|0) * 0x85ebca6b);
    h = Math.imul(h ^ (h>>>15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h>>>12), 0x297a2d39);
    return (h ^ (h>>>15)) >>> 0;
  }
  function hash01(a,b){ return hash32(a,b) / 4294967296; }
  function worldSeed(ctx){
    try{
      const wg = (ctx && ctx.worldGen) || MM.worldGen;
      if(wg && Number.isFinite(Number(wg.worldSeed))) return Number(wg.worldSeed)|0;
    }catch(e){}
    return 1337;
  }
  function dayFloat(ctx){
    try{
      if(ctx && typeof ctx.gameDayFloat==='function'){
        const d = Number(ctx.gameDayFloat());
        if(Number.isFinite(d)) return d;
      }
    }catch(e){}
    return S._fallbackDay || 0;
  }
  function say(t){ try{ if(root.msg) root.msg(t); }catch(e){} }
  function playSound(id){ try{ if(MM.audio && MM.audio.play) MM.audio.play(id); }catch(e){} }

  // Seeded per-visit stock: OFFER_COUNT goods + the epic chest, RATE_COUNT rates.
  function rollStock(visitIndex, seed){
    const pickFrom = (list, n, salt)=>{
      const order = list.map((row,i)=>({row, k:hash01(seed ^ salt, visitIndex*131 + i)}))
        .sort((a,b)=>a.k-b.k || a.row.id.localeCompare(b.row.id));
      return order.slice(0, Math.min(n, order.length)).map(o=>o.row.id);
    };
    return {
      offers: pickFrom(GOODS, OFFER_COUNT, 0x517cc1b7).concat([EPIC_CHEST.id]),
      rates: pickFrom(RATES, RATE_COUNT, 0x27220a95)
    };
  }
  function offerById(id){ return id===EPIC_CHEST.id ? EPIC_CHEST : GOODS.find(g=>g.id===id) || null; }
  function rateById(id){ return RATES.find(r=>r.id===id) || null; }

  // A stall spot: two tiles of headroom on solid, dry ground.
  function standValid(getTile, tx, ty){
    const feet = getTile(tx, ty), head = getTile(tx, ty-1), floor = getTile(tx, ty+1);
    const open = (t)=>t===T.AIR || t===T.TORCH;
    return open(feet) && open(head) && isSolid(floor) && feet!==T.WATER && floor!==T.LAVA;
  }
  function scoutSpot(player, getTile, ctx){
    const wg = (ctx && ctx.worldGen) || MM.worldGen;
    if(!wg || !wg.surfaceHeight) return null;
    const seed = worldSeed(ctx);
    const side = hash01(seed, S.visitIndex*17+3) < 0.5 ? -1 : 1;
    for(const dir of [side, -side]){
      for(let dist=18; dist<=40; dist+=2){
        const tx = Math.floor(player.x) + dir*dist;
        let sy;
        try{ sy = wg.surfaceHeight(tx); }catch(e){ continue; }
        if(!Number.isFinite(sy)) continue;
        const ty = sy - 1; // feet tile sits on the surface block
        if(standValid(getTile, tx, ty)) return {x:tx+0.5, y:ty+0.5};
      }
    }
    return null;
  }

  function arrive(player, getTile, ctx){
    const spot = scoutSpot(player, getTile, ctx);
    if(!spot) return false;
    const day = dayFloat(ctx);
    S.active = true;
    S.x = spot.x; S.y = spot.y;
    S.visitIndex++;
    S.stock = rollStock(S.visitIndex, worldSeed(ctx));
    S.leaveDay = day + VISIT_LENGTH;
    S.greeted = false;
    const dirWord = S.x > player.x ? 'na wschodzie ➡' : '⬅ na zachodzie';
    say('🧺 Wędrowny handlarz rozbił kram '+dirWord+'! Diamenty mile widziane.');
    playSound('chest');
    if(ctx && ctx.onChange){ try{ ctx.onChange(); }catch(e){} }
    return true;
  }
  function depart(ctx, silent){
    if(!S.active) return;
    S.active = false;
    S.stock = null;
    const day = dayFloat(ctx);
    S.nextVisitDay = day + PERIOD_MIN + hash01(worldSeed(ctx), S.visitIndex*29+11) * PERIOD_SPAN;
    if(!silent) say('🧺 Handlarz zwinął kram i ruszył dalej. Wróci za parę dni.');
    if(closeHandler){ try{ closeHandler(); }catch(e){} }
    if(ctx && ctx.onChange){ try{ ctx.onChange(); }catch(e){} }
  }

  function update(dt, player, getTile, setTile, ctx){
    if(!(dt>0) || !player || typeof getTile!=='function') return;
    // fallback clock for hosts without gameDayFloat (Node sims drive it directly)
    S._fallbackDay = (S._fallbackDay||0) + dt/600;
    const day = dayFloat(ctx);
    if(!S.active){
      if(day >= S.nextVisitDay) arrive(player, getTile, ctx);
      return;
    }
    S.bob += dt;
    if(day >= S.leaveDay){ depart(ctx); return; }
    // ground checks: mined-out floor drops the stall one tile; a flooded or
    // buried stall makes the trader pack up early rather than glitch about
    const tx = Math.floor(S.x), ty = Math.floor(S.y);
    if(!standValid(getTile, tx, ty)){
      if(standValid(getTile, tx, ty+1)) S.y += 1;
      else depart(ctx);
      return;
    }
    if(!S.greeted && Math.hypot(player.x-S.x, player.y-S.y) < 6){
      S.greeted = true;
      say('🧺 Handlarz: „'+GREETINGS[hash32(worldSeed(ctx), S.visitIndex) % GREETINGS.length]+'"');
    }
    // hero wandered off mid-trade: close the panel
    if(closeHandler && Math.hypot(player.x-S.x, player.y-S.y) > TALK_REACH+3){
      try{ closeHandler(); }catch(e){}
    }
  }

  function interactAt(tx, ty, player){
    if(!S.active) return false;
    if(Math.abs(tx+0.5-S.x) > 1.6 || Math.abs(ty+0.5-S.y) > 2.2) return false;
    if(player && Math.hypot(player.x-S.x, player.y-S.y) > TALK_REACH){
      say('🧺 Podejdź bliżej do kramu, żeby handlować.');
      return true;
    }
    if(openHandler){ try{ openHandler(); }catch(e){} }
    return true;
  }

  function countOf(inv, key){ return (inv && typeof inv[key]==='number') ? (inv[key]|0) : 0; }

  // Buy `id` for diamonds. ctx: {inv, player, addBuff, getTile, setTile,
  // onInventoryChange, onChange, notifyTileChanged}. Returns {ok, reason}.
  function tradeBuy(id, ctx){
    const offer = S.active && S.stock && S.stock.offers.includes(id) ? offerById(id) : null;
    if(!offer) return {ok:false, reason:'Brak towaru'};
    const inv = (ctx && ctx.inv) || root.inv;
    if(!inv) return {ok:false, reason:'Brak ekwipunku'};
    if(countOf(inv,'diamond') < offer.cost) return {ok:false, reason:'Za mało diamentów'};
    if(offer.effect==='epicChest'){
      const placed = placeChestNearStall(ctx);
      if(!placed) return {ok:false, reason:'Brak miejsca na skrzynię'};
    }
    inv.diamond -= offer.cost;
    if(offer.give){ Object.keys(offer.give).forEach(k=>{ if(typeof inv[k]==='number') inv[k]+=offer.give[k]; else inv[k]=offer.give[k]; }); }
    if(offer.effect==='heal'){
      const p = (ctx && ctx.player) || root.player;
      if(p){ p.hp = Math.min(p.maxHp||100, (p.hp||0)+40); }
    } else if(offer.effect==='speed' || offer.effect==='strength'){
      const addBuff = (ctx && ctx.addBuff) || (MM.progress && MM.progress.addBuff);
      if(addBuff){
        try{
          if(offer.effect==='speed') addBuff({name:'Szybkość', icon:'💨', dur:60, stats:{moveSpeedMult:1.3, jumpPowerMult:1.15}});
          else addBuff({name:'Siła', icon:'💪', dur:60, stats:{attackDamage:5}});
        }catch(e){}
      }
    }
    say('🧺 Kupiono: '+offer.label+' (−'+offer.cost+' 💎)');
    playSound(offer.effect==='heal'||offer.effect==='speed'||offer.effect==='strength' ? 'heal' : 'chest');
    if(ctx && ctx.onInventoryChange){ try{ ctx.onInventoryChange(); }catch(e){} }
    if(ctx && ctx.onChange){ try{ ctx.onChange(); }catch(e){} }
    return {ok:true};
  }
  function placeChestNearStall(ctx){
    const getTile = ctx && ctx.getTile, setTile = ctx && ctx.setTile;
    if(typeof getTile!=='function' || typeof setTile!=='function') return false;
    const bx = Math.floor(S.x), by = Math.floor(S.y);
    for(const dx of [2,-2,3,-3,1,-1]){
      const tx = bx+dx, ty = by;
      if(getTile(tx,ty)===T.AIR && isSolid(getTile(tx,ty+1))){
        setTile(tx,ty,T.CHEST_EPIC);
        if(ctx.notifyTileChanged){ try{ ctx.notifyTileChanged(tx,ty,T.AIR,T.CHEST_EPIC); }catch(e){} }
        return true;
      }
    }
    return false;
  }
  // Sell resources at rate `id` for diamonds. Returns {ok, reason}.
  function tradeSell(id, ctx){
    const rate = S.active && S.stock && S.stock.rates.includes(id) ? rateById(id) : null;
    if(!rate) return {ok:false, reason:'Nie skupuję tego dziś'};
    const inv = (ctx && ctx.inv) || root.inv;
    if(!inv) return {ok:false, reason:'Brak ekwipunku'};
    for(const k of Object.keys(rate.take)){
      if(countOf(inv,k) < rate.take[k]) return {ok:false, reason:'Za mało: '+k};
    }
    Object.keys(rate.take).forEach(k=>{ inv[k]-=rate.take[k]; });
    inv.diamond = countOf(inv,'diamond') + rate.pay;
    say('🧺 Sprzedano: '+rate.label+' (+'+rate.pay+' 💎)');
    playSound('chest');
    if(ctx && ctx.onInventoryChange){ try{ ctx.onInventoryChange(); }catch(e){} }
    if(ctx && ctx.onChange){ try{ ctx.onChange(); }catch(e){} }
    return {ok:true};
  }

  function draw(ctx2d, TILE, canDrawTile){
    if(!S.active || !ctx2d) return;
    const tx = Math.floor(S.x), ty = Math.floor(S.y);
    if(typeof canDrawTile==='function' && !canDrawTile(tx,ty)) return;
    const px = S.x*TILE, py = (S.y+0.5)*TILE; // feet baseline
    const bob = Math.sin(S.bob*2.1)*1.5;
    ctx2d.save();
    // stall: two poles + striped awning + crate of wares
    ctx2d.fillStyle='#6e4a22';
    ctx2d.fillRect(px-TILE*1.1, py-TILE*1.9, 2, TILE*1.9);
    ctx2d.fillRect(px+TILE*1.1, py-TILE*1.9, 2, TILE*1.9);
    for(let i=0;i<6;i++){
      ctx2d.fillStyle = i%2 ? '#d8433f' : '#f3e9d2';
      ctx2d.fillRect(px-TILE*1.25 + i*(TILE*2.5/6), py-TILE*2.15, TILE*2.5/6+0.5, TILE*0.34);
    }
    ctx2d.fillStyle='#8a6432';
    ctx2d.fillRect(px+TILE*0.35, py-TILE*0.52, TILE*0.72, TILE*0.52);
    ctx2d.strokeStyle='rgba(0,0,0,0.35)'; ctx2d.lineWidth=1;
    ctx2d.strokeRect(px+TILE*0.35, py-TILE*0.52, TILE*0.72, TILE*0.52);
    // merchant: hooded round body, staff, gleaming eyes under the hood
    ctx2d.fillStyle='#4b3b63';
    ctx2d.beginPath();
    ctx2d.ellipse(px-TILE*0.3, py-TILE*0.62+bob*0.3, TILE*0.42, TILE*0.62, 0, 0, Math.PI*2);
    ctx2d.fill();
    ctx2d.fillStyle='#382c4d';
    ctx2d.beginPath();
    ctx2d.ellipse(px-TILE*0.3, py-TILE*1.06+bob*0.5, TILE*0.3, TILE*0.28, 0, Math.PI, 0);
    ctx2d.fill();
    ctx2d.fillStyle='#ffd76a';
    ctx2d.fillRect(px-TILE*0.42, py-TILE*1.02+bob*0.5, 3, 3);
    ctx2d.fillRect(px-TILE*0.24, py-TILE*1.02+bob*0.5, 3, 3);
    ctx2d.fillStyle='#8a6432';
    ctx2d.fillRect(px-TILE*0.78, py-TILE*1.5, 2, TILE*1.5);
    // floating diamond hint over the stall
    const tw = Math.sin(S.bob*3)*0.5+0.5;
    ctx2d.globalAlpha = 0.75+0.25*tw;
    ctx2d.font = Math.round(TILE*0.6)+'px system-ui';
    ctx2d.textAlign='center';
    ctx2d.fillText('💎', px, py-TILE*2.5-bob);
    ctx2d.restore();
  }

  function summary(){
    if(!S.active) return null;
    return {id:'trader', name:'Wędrowny Handlarz', x:S.x, y:S.y, kind:'trader'};
  }
  function snapshot(){
    return {
      v:1, active:!!S.active, x:S.x, y:S.y,
      visitIndex:S.visitIndex|0, nextVisitDay:S.nextVisitDay,
      leaveDay:S.leaveDay, stock:S.stock ? {offers:S.stock.offers.slice(), rates:S.stock.rates.slice()} : null,
      greeted:!!S.greeted
    };
  }
  function restore(data){
    if(!data || typeof data!=='object') return false;
    S.active = !!data.active;
    S.x = Number.isFinite(data.x) ? data.x : 0;
    S.y = Number.isFinite(data.y) ? data.y : 0;
    S.visitIndex = Number.isFinite(data.visitIndex) ? data.visitIndex|0 : 0;
    S.nextVisitDay = Number.isFinite(data.nextVisitDay) ? data.nextVisitDay : FIRST_VISIT_DAY;
    S.leaveDay = Number.isFinite(data.leaveDay) ? data.leaveDay : 0;
    S.greeted = !!data.greeted;
    S.stock = null;
    if(data.stock && Array.isArray(data.stock.offers) && Array.isArray(data.stock.rates)){
      S.stock = {
        offers: data.stock.offers.filter(id=>!!offerById(id)),
        rates: data.stock.rates.filter(id=>!!rateById(id))
      };
    }
    if(S.active && (!S.stock || !S.stock.offers.length)) S.stock = rollStock(S.visitIndex||1, 1337);
    return true;
  }
  function reset(){
    S.active=false; S.x=0; S.y=0; S.visitIndex=0; S.nextVisitDay=FIRST_VISIT_DAY;
    S.leaveDay=0; S.stock=null; S.greeted=false; S.bob=0; S._fallbackDay=0;
  }

  const api = {
    id: ()=>'trader',
    update, draw, interactAt, summary, snapshot, restore, reset,
    isActive: ()=>!!S.active,
    position: ()=>({x:S.x, y:S.y}),
    stock(){
      if(!S.active || !S.stock) return null;
      return {
        offers: S.stock.offers.map(offerById).filter(Boolean),
        rates: S.stock.rates.map(rateById).filter(Boolean)
      };
    },
    tradeBuy, tradeSell,
    setOpenHandler(fn){ openHandler = typeof fn==='function' ? fn : null; },
    setCloseHandler(fn){ closeHandler = typeof fn==='function' ? fn : null; },
    talkReach: ()=>TALK_REACH,
    // test seams
    _state: ()=>S,
    _rollStock: rollStock,
    _goods: ()=>GOODS.slice(),
    _epicChest: ()=>Object.assign({},EPIC_CHEST),
    _rates: ()=>RATES.slice(),
    forceArrive: (player,getTile,ctx)=>arrive(player,getTile,ctx),
    forceDepart: (ctx)=>depart(ctx)
  };

  try{ if(npcRegistry && npcRegistry.register) npcRegistry.register('trader', api); }catch(e){}
  MM.trader = api;
})();
// ESM export (progressive migration)
export const trader = (typeof window!=='undefined' && window.MM) ? window.MM.trader : undefined;
export default trader;
