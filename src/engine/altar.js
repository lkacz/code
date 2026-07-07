// Summoning altar (Ołtarz Przyzwania): rare torch-lit obsidian shrines rolled
// by world.js placeStructures (~1.4% of chunks). Clicking the ritual stone
// with the offering in the backpack — 3 diamonds + 3 obsidian — consumes it
// and calls a GARGANTUAN boss (scale 3: triple silhouette, double trample,
// an epic-chest hoard on death) to the surface nearby. Cheaper per value than
// the crafted Róg przyzwania, but you must FIND the shrine, and each altar
// only answers once per game day (session cooldown; the stone "still smokes").
// A failed summon (no valid ground on either side) refunds the offering.
import { T } from '../constants.js';

(function(){
  const root = (typeof window!=='undefined') ? window : globalThis;
  root.MM = root.MM || {};
  const MM = root.MM;

  const COST = { diamond:3, obsidian:3 };
  const COOLDOWN_DAYS = 1;
  const SUMMON_DIST = 16;
  const usedAt = new Map(); // "x,y" -> gameDayFloat of last successful ritual

  function say(t){ try{ if(root.msg) root.msg(t); }catch(e){} }
  function playSound(id){ try{ if(MM.audio && MM.audio.play) MM.audio.play(id); }catch(e){} }
  function costText(){ return Object.entries(COST).map(([k,n])=>n+'× '+(k==='diamond'?'diament':k)).join(', '); }

  // Click dispatch from main.js. Returns true when the click was an altar
  // interaction (even a refused one), false to let mining/other handlers run.
  function tryUseAt(tx, ty, ctx){
    ctx = ctx || {};
    const getTile = ctx.getTile || (MM.world && MM.world.getTile);
    if(typeof getTile !== 'function') return false;
    tx = Math.floor(tx); ty = Math.floor(ty);
    if(getTile(tx, ty) !== T.ALTAR) return false;
    const day = (typeof ctx.gameDayFloat === 'function') ? Number(ctx.gameDayFloat()) : 0;
    const k = tx + ',' + ty;
    const last = usedAt.get(k);
    if(last != null && day - last < COOLDOWN_DAYS){
      say('🕯️ Ołtarz jeszcze dymi po ostatnim rytuale. Wróć następnego dnia.');
      return true;
    }
    const inv = ctx.inv || root.inv;
    if(!inv) return true;
    for(const [key, n] of Object.entries(COST)){
      if((inv[key]|0) < n){ say('🕯️ Rytuał wymaga ofiary: '+costText()+'.'); return true; }
    }
    const forceSpawn = ctx.forceSpawn || (MM.bosses && MM.bosses.forceSpawn);
    if(typeof forceSpawn !== 'function'){ say('🕯️ Ołtarz milczy.'); return true; }
    Object.keys(COST).forEach(key=>{ inv[key] -= COST[key]; });
    playSound('masterstone');
    say('🕯️ Ofiara przyjęta… ziemia drży.');
    const px = (ctx.player && Number.isFinite(ctx.player.x)) ? ctx.player.x : tx;
    const side = px >= tx ? 1 : -1; // call the beast to the shrine's far side
    let m = null;
    try{
      m = forceSpawn(null, {x:Math.round(tx + side*SUMMON_DIST), scale:3})
        || forceSpawn(null, {x:Math.round(tx - side*SUMMON_DIST), scale:3});
    }catch(e){ m = null; }
    if(!m){
      Object.keys(COST).forEach(key=>{ inv[key] += COST[key]; });
      say('🕯️ Rytuał zabrzmiał w pustkę — ofiara wraca na ołtarz.');
      return true;
    }
    usedAt.set(k, day);
    say('⚠ Ołtarz płonie! '+(m.name || 'Bestia')+' nadchodzi po swoją ofiarę — pokonaj go, a stos epickich skrzyń będzie twój!');
    if(ctx.onInventoryChange){ try{ ctx.onInventoryChange(); }catch(e){} }
    if(ctx.onChange){ try{ ctx.onChange(); }catch(e){} }
    return true;
  }

  function reset(){ usedAt.clear(); }

  const api = {
    tryUseAt,
    reset,
    cost: ()=>Object.assign({}, COST),
    // test seams
    _usedAt: ()=>usedAt
  };
  MM.altar = api;
})();
// ESM export (progressive migration)
export const altar = (typeof window!=='undefined' && window.MM) ? window.MM.altar : undefined;
export default altar;
