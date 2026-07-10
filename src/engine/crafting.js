// Crafting meta-model: recipe affordability math plus the player-facing
// quality-of-life state around it — favorites, one tracked recipe (HUD widget),
// NEW-recipe detection and per-recipe craft statistics. Pure data logic shared
// by the panel UI and the HUD tracker in main.js; no DOM here, so the whole
// model runs headless in Node tests.
//
// Persistence contract: snapshot()/restore() ride the save file's `crafting`
// part. restore() accepts the legacy `{seenAvailable:[...]}` shape (older saves)
// and seeds "already craftable" silently when no snapshot exists, so loading an
// old world never spams NEW badges for recipes the player has long had.
const crafting = (function(){
  const root = typeof window !== 'undefined' ? window : globalThis;
  const MM = root.MM = root.MM || {};

  // Where to find each craftable ingredient — surfaced when a recipe is missing
  // that resource. One short player-facing phrase per key; `craft:` prefixed
  // entries point at other recipes instead of the world.
  const SOURCE_HINTS = {
    wood: 'ścinaj drzewa',
    leaf: 'korony drzew',
    grass: 'kop trawiaste bloki',
    stone: 'kop kamień pod powierzchnią',
    coal: 'czarne złoża w skale',
    diamond: 'błyszczące złoża głęboko pod ziemią',
    iridium: 'rzadkie złoża i kratery meteorytów',
    obsidian: 'zastygła lawa (ugaś ją wodą)',
    sand: 'pustynie i plaże',
    clay: 'warstwy gliny pod trawą',
    snow: 'zimowe szczyty i opady śniegu',
    toxicSnow: 'śnieg spod skażonej gazem chmury (zielona zamieć)',
    water: 'wykop kafle wody z jezior',
    meat: 'polowanie na zwierzęta',
    rottenMeat: 'surowe mięso zepsute z czasem (zostaw je w świecie)',
    meteoricIron: 'kratery po meteorytach',
    meteorDust: 'pył z kraterów meteorytów',
    radioactiveOre: 'głębokie, skażone złoża',
    copper: 'ruiny miast: maszyny i kable',
    plastic: 'ruiny miast: wraki i sprzęty',
    wire: 'ruiny miast i pokonane roboty',
    antimatter: 'zestrzelone UFO i rzadkie meteoryty',
    alienBiomass: 'pozostałości po najeźdźcach',
    motherIce: 'lód przy skale macierzystej',
    motherLava: 'lawa przy skale macierzystej',
    masterStone: 'serce wulkanu',
    servantStone: 'kamienie sługi przy wulkanie',
    springAntler: 'trofeum wiosennego jelenia',
    summerHorn: 'trofeum letniego żubra',
    autumnHeartwood: 'trofeum jesiennego łosia',
    winterFur: 'trofeum zimowego niedźwiedzia',
    glass: 'craft: piasek + węgiel (Przerób)',
    brick: 'craft: glina + węgiel (Przerób)',
    steel: 'craft: żelazo meteorytowe + węgiel (Przerób)',
    transistor: 'craft: miedź + plastik + pył (Przerób)',
    copperWire: 'craft: miedź + plastik (Maszyny)',
    solarPanel: 'craft: szkło + przewody (Maszyny)',
    waterPipe: 'craft: stal + plastik (Maszyny)',
    dynamo: 'craft: stal + przewody (Maszyny)',
    track: 'craft: stal + wegiel (Maszyny)',
    torch: 'craft: drewno (Start)',
    ladder: 'craft: drewno (Budowle)',
    fish: 'wędkuj: F przy wodzie (potrzebna wędka)',
    goldenFish: 'rzadki połów — wygraj walkę z dużą rybą',
    glowshroom: 'świecące jaskinie w lasach i na bagnach'
  };

  function createCraftingModel(cfg){
    cfg = cfg || {};
    const recipes = Array.isArray(cfg.recipes) ? cfg.recipes : [];
    const getHave = typeof cfg.getHave === 'function' ? cfg.getHave : ()=>0;
    const isDone = typeof cfg.isDone === 'function' ? cfg.isDone : ()=>false;
    const maxBatch = Math.max(1, cfg.maxBatch|0 || 999);

    const favorites = new Set();      // recipe ids pinned by the player
    const seenAvailable = new Set();  // ids that have EVER been craftable (toast bookkeeping)
    const fresh = new Set();          // newly craftable, not yet viewed in the panel (NEW badges)
    const counts = new Map();         // id -> times crafted (lifetime, rides the save)
    let trackedId = null;             // the one recipe pinned to the HUD tracker
    let trackedReadyAnnounced = false; // edge detector: announce "ready" once per dip

    function byId(id){ return recipes.find(r=>r.id===id) || null; }
    function known(id){ return typeof id==='string' && !!byId(id); }
    function done(r){ try{ return !!isDone(r); }catch(e){ return false; } }
    function costEntries(r){ return Object.entries((r && r.cost) || {}); }
    function have(key){ const n=getHave(key); return (typeof n==='number' && isFinite(n)) ? Math.max(0, n) : 0; }

    function maxCrafts(r){
      if(!r || done(r)) return 0;
      const entries = costEntries(r);
      if(!entries.length) return 1;
      let max = Infinity;
      for(const [k,v] of entries){
        const need = Math.max(1, v|0);
        max = Math.min(max, Math.floor(have(k)/need));
      }
      return Math.max(0, Math.min(maxBatch, max===Infinity ? 1 : max));
    }
    function missing(r){
      return costEntries(r)
        .map(([k,v])=>({key:k, need:v, have:have(k), missing:Math.max(0, v-have(k))}))
        .filter(x=>x.missing>0);
    }
    function canCraft(r){ return maxCrafts(r)>0; }
    // Overall affordability 0..1 (bottleneck ingredient) — drives progress bars.
    function progress(r){
      if(!r) return 0;
      if(done(r)) return 1;
      const entries = costEntries(r);
      if(!entries.length) return 1;
      let p = 1;
      for(const [k,v] of entries){
        const need = Math.max(1, v|0);
        p = Math.min(p, Math.min(1, have(k)/need));
      }
      return p;
    }

    // --- Favorites ---
    function isFavorite(id){ return favorites.has(id); }
    function toggleFavorite(id){
      if(!known(id)) return false;
      if(favorites.has(id)) favorites.delete(id); else favorites.add(id);
      return favorites.has(id);
    }
    function favoriteIds(){ return [...favorites]; }

    // --- Tracked recipe (HUD ingredient tracker) ---
    function setTracked(id){
      const next = known(id) ? id : null;
      if(next!==trackedId){ trackedId=next; trackedReadyAnnounced=false; }
      return trackedId;
    }
    function toggleTracked(id){ return setTracked(trackedId===id ? null : id); }
    function getTrackedId(){ return trackedId; }
    // Snapshot of the tracked recipe for the HUD; `justReady` fires exactly once
    // each time the recipe crosses from unaffordable to affordable.
    function trackedStatus(){
      const r = byId(trackedId);
      if(!r){ trackedId=null; return null; }
      const ready = canCraft(r);
      let justReady = false;
      if(ready && !trackedReadyAnnounced){ trackedReadyAnnounced=true; justReady=true; }
      else if(!ready && trackedReadyAnnounced && !done(r)) trackedReadyAnnounced=false;
      return {recipe:r, canCraft:ready, done:done(r), missing:missing(r), progress:progress(r), justReady};
    }

    // --- Craft statistics ---
    function countOf(id){ return counts.get(id)|0; }
    function recordCraft(id, n){
      if(!known(id)) return 0;
      const next = (counts.get(id)|0) + Math.max(1, n|0);
      counts.set(id, next);
      return next;
    }
    function totalCrafts(){ let t=0; counts.forEach(v=>{ t+=v; }); return t; }

    // --- Availability tracking (toasts + NEW badges) ---
    // Returns the recipes that just became craftable for the first time.
    function syncAvailability(){
      const newly=[];
      for(const r of recipes){
        if(!canCraft(r) || seenAvailable.has(r.id)) continue;
        seenAvailable.add(r.id);
        fresh.add(r.id);
        newly.push(r);
      }
      return newly;
    }
    function isFresh(id){ return fresh.has(id); }
    function markSeen(id){ fresh.delete(id); }
    function freshCount(){ return fresh.size; }
    function freshIds(){ return [...fresh]; }
    // Seed "already craftable" silently (fresh stays empty): first boot / legacy saves.
    function seedSeen(){ recipes.forEach(r=>{ if(canCraft(r)) seenAvailable.add(r.id); }); }

    // --- Persistence ---
    function reset(){
      favorites.clear(); seenAvailable.clear(); fresh.clear(); counts.clear();
      trackedId=null; trackedReadyAnnounced=false;
    }
    function snapshot(){
      const countsObj={};
      counts.forEach((v,k)=>{ if(known(k) && v>0) countsObj[k]=v; });
      return {
        seenAvailable:[...seenAvailable].filter(known),
        fresh:[...fresh].filter(known),
        favorites:[...favorites].filter(known),
        tracked: known(trackedId) ? trackedId : null,
        counts: countsObj
      };
    }
    function restore(src){
      reset();
      if(!src || typeof src!=='object' || !Array.isArray(src.seenAvailable)){
        seedSeen();
        return false;
      }
      src.seenAvailable.forEach(id=>{ if(known(id)) seenAvailable.add(id); });
      if(Array.isArray(src.fresh)) src.fresh.forEach(id=>{ if(known(id) && seenAvailable.has(id)) fresh.add(id); });
      if(Array.isArray(src.favorites)) src.favorites.forEach(id=>{ if(known(id)) favorites.add(id); });
      if(known(src.tracked)) trackedId=src.tracked;
      if(src.counts && typeof src.counts==='object'){
        for(const k in src.counts){
          const v=src.counts[k];
          if(known(k) && typeof v==='number' && isFinite(v) && v>0) counts.set(k, Math.min(999999, Math.floor(v)));
        }
      }
      return true;
    }

    return {
      byId, known, costEntries,
      maxCrafts, missing, canCraft, progress,
      isFavorite, toggleFavorite, favoriteIds,
      setTracked, toggleTracked, trackedId:getTrackedId, trackedStatus,
      countOf, recordCraft, totalCrafts,
      syncAvailability, isFresh, markSeen, freshCount, freshIds, seedSeen,
      reset, snapshot, restore
    };
  }

  const api = { createCraftingModel, SOURCE_HINTS };
  MM.crafting = api;
  return api;
})();

export const createCraftingModel = crafting.createCraftingModel;
export const SOURCE_HINTS = crafting.SOURCE_HINTS;
export { crafting };
export default crafting;
