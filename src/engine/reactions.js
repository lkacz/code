// Scalable block-pattern reactions for elemental tools.
//
// A recipe describes a tile pattern and a stimulus that completes it:
//   heat     - flame, torch heat, lava heat
//   water    - hose / water contact
//   electric - electric beam contact
//
// Recipes are matched around the touched tile, so heating any block in a valid
// assembly can complete the structure. Patterns may be mirrored horizontally.
import { T, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } from '../constants.js';

(function(){
  window.MM = window.MM || {};

  const recipes = [];
  const byStimulus = new Map();
  const byId = new Map();
  const WORLD_TOP = Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;

  function finiteTile(x,y){ return Number.isFinite(x) && Number.isFinite(y) && y>=WORLD_TOP && y<WORLD_BOTTOM; }
  function getSafe(getTile,x,y,fallback){
    try{ return typeof getTile==='function' ? getTile(x,y) : fallback; }catch(e){ return fallback; }
  }
  function tileNameToId(name){
    if(typeof name === 'number') return name;
    if(typeof name === 'string' && T[name]!=null) return T[name];
    return null;
  }
  function parsePattern(rows,map){
    const charMap=map || {};
    const out=[];
    let width=0;
    for(const row of rows || []) width=Math.max(width,String(row).length);
    for(let y=0; y<(rows||[]).length; y++){
      const row=String(rows[y]);
      for(let x=0; x<row.length; x++){
        const ch=row[x];
        if(ch===' ' || ch==='.') continue;
        const id=tileNameToId(charMap[ch]);
        if(id==null) throw new Error('Unknown reaction symbol '+ch);
        out.push({x,y,t:id,symbol:ch});
      }
    }
    if(!out.length) throw new Error('Reaction recipe pattern cannot be empty');
    return {cells:out,width,height:(rows||[]).length};
  }
  function mirrorPattern(parsed){
    const width=Math.max(1,parsed.width||1);
    return {
      width,
      height:parsed.height,
      cells:parsed.cells.map(c=>({x:width-1-c.x,y:c.y,t:c.t,symbol:c.symbol}))
    };
  }
  function patternSignature(parsed){
    return parsed.cells.map(c=>c.x+','+c.y+','+c.t).sort().join('|');
  }
  function normalizeRecipe(recipe){
    if(!recipe || typeof recipe!=='object') throw new Error('Invalid reaction recipe');
    const stimulus=String(recipe.stimulus||'heat');
    const parsed=parsePattern(recipe.pattern,recipe.map);
    const variants=[parsed];
    if(recipe.mirror!==false){
      const mirrored=mirrorPattern(parsed);
      if(patternSignature(mirrored)!==patternSignature(parsed)) variants.push(mirrored);
    }
    const out=Object.assign({},recipe,{
      id:String(recipe.id||('reaction_'+recipes.length)),
      stimulus,
      priority:Number(recipe.priority)||0,
      variants,
      resultTile:tileNameToId(recipe.resultTile)
    });
    if(out.resultTile==null && typeof out.result!=='function') throw new Error('Reaction recipe needs resultTile or result function');
    return out;
  }
  function register(recipe){
    const r=normalizeRecipe(recipe);
    const existing=byId.get(r.id);
    if(existing){
      if(!recipe.replace) return existing;
      const oldList=byStimulus.get(existing.stimulus);
      if(oldList){
        const idx=oldList.indexOf(existing);
        if(idx>=0) oldList.splice(idx,1);
      }
      const allIdx=recipes.indexOf(existing);
      if(allIdx>=0) recipes.splice(allIdx,1);
    }
    recipes.push(r);
    byId.set(r.id,r);
    if(!byStimulus.has(r.stimulus)) byStimulus.set(r.stimulus,[]);
    byStimulus.get(r.stimulus).push(r);
    byStimulus.get(r.stimulus).sort((a,b)=>b.priority-a.priority);
    return r;
  }
  function unregister(id){
    const r=byId.get(String(id||''));
    if(!r) return false;
    byId.delete(r.id);
    const allIdx=recipes.indexOf(r);
    if(allIdx>=0) recipes.splice(allIdx,1);
    const list=byStimulus.get(r.stimulus);
    if(list){
      const idx=list.indexOf(r);
      if(idx>=0) list.splice(idx,1);
      if(!list.length) byStimulus.delete(r.stimulus);
    }
    return true;
  }
  function matchVariantAt(tx,ty,variant,getTile){
    for(const touched of variant.cells){
      const ax=tx-touched.x;
      const ay=ty-touched.y;
      let ok=true;
      for(const c of variant.cells){
        if(!finiteTile(ax+c.x,ay+c.y)){ ok=false; break; }
        if(getSafe(getTile,ax+c.x,ay+c.y,T.AIR)!==c.t){ ok=false; break; }
      }
      if(ok) return {anchor:{x:ax,y:ay}, cells:variant.cells.map(c=>({x:ax+c.x,y:ay+c.y,t:c.t,symbol:c.symbol}))};
    }
    return null;
  }
  function matchRecipe(recipe,tx,ty,getTile){
    for(const variant of recipe.variants){
      const hit=matchVariantAt(tx,ty,variant,getTile);
      if(hit) return hit;
    }
    return null;
  }
  function notifyTileChanged(x,y,oldTile,newTile,getTile,setTile){
    try{ if(MM.solar && MM.solar.onTileChanged) MM.solar.onTileChanged(x,y,oldTile,newTile); }catch(e){}
    try{ if(MM.teleporters && MM.teleporters.onTileChanged) MM.teleporters.onTileChanged(x,y,oldTile,newTile); }catch(e){}
    try{ if(MM.dynamo && MM.dynamo.onTileChanged) MM.dynamo.onTileChanged(x,y,oldTile,newTile); }catch(e){}
    try{ if(MM.gases && MM.gases.onTileChanged) MM.gases.onTileChanged(x,y,oldTile,newTile); }catch(e){}
    try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(x,y,getTile); }catch(e){}
    try{ if(MM.fallingSolids && MM.fallingSolids.recheckNeighborhood) MM.fallingSolids.recheckNeighborhood(x,y); }catch(e){}
    try{ if(MM.fallingSolids && MM.fallingSolids.afterPlacement) MM.fallingSolids.afterPlacement(x,y); }catch(e){}
    try{ if(MM.volcano && MM.volcano.onTileChanged) MM.volcano.onTileChanged(x,y,newTile,getTile,setTile); }catch(e){}
  }
  function resultFor(recipe,cell,match,opts){
    if(typeof recipe.result === 'function') return recipe.result(cell,match,opts);
    return recipe.resultTile;
  }
  function applyRecipe(recipe,match,getTile,setTile,opts){
    if(typeof setTile!=='function') return null;
    const changed=[];
    for(const cell of match.cells){
      const oldTile=getSafe(getTile,cell.x,cell.y,T.AIR);
      const nextTile=resultFor(recipe,cell,match,opts);
      if(nextTile==null || oldTile===nextTile) continue;
      setTile(cell.x,cell.y,nextTile);
      notifyTileChanged(cell.x,cell.y,oldTile,nextTile,getTile,setTile);
      changed.push({x:cell.x,y:cell.y,oldTile,newTile:nextTile});
    }
    if(!changed.length) return null;
    try{
      const cx=changed.reduce((a,c)=>a+c.x,0)/changed.length;
      const cy=changed.reduce((a,c)=>a+c.y,0)/changed.length;
      const tile=MM.TILE||20;
      if(MM.particles && MM.particles.spawnSparks) MM.particles.spawnSparks((cx+0.5)*tile,(cy+0.5)*tile,'rare',18);
      else if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst((cx+0.5)*tile,(cy+0.5)*tile,'rare');
      if(MM.audio && MM.audio.play) MM.audio.play('charge',{x:cx+0.5,y:cy+0.5});
    }catch(e){}
    return {recipe:recipe.id, stimulus:recipe.stimulus, anchor:match.anchor, changed};
  }
  function apply(stimulus,x,y,getTile,setTile,opts){
    const list=byStimulus.get(String(stimulus||'')) || [];
    if(!list.length || typeof getTile!=='function' || typeof setTile!=='function') return null;
    const tx=Math.floor(x), ty=Math.floor(y);
    for(const recipe of list){
      const match=matchRecipe(recipe,tx,ty,getTile);
      if(!match) continue;
      const done=applyRecipe(recipe,match,getTile,setTile,opts||{});
      if(done) return done;
    }
    return null;
  }
  function recipesFor(stimulus){
    return (byStimulus.get(String(stimulus||'')) || []).slice();
  }
  function canStimulus(stimulus){
    return (byStimulus.get(String(stimulus||'')) || []).length>0;
  }
  function isSolarRecipeTile(t){
    return t===T.GLASS || t===T.WIRE || t===T.TRANSISTOR;
  }
  function reset(){
    // Stateless by design. Kept for symmetry with other engines and future
    // timed recipes.
  }

  register({
    id:'heat_solar_storage_panel',
    stimulus:'heat',
    priority:20,
    pattern:['G','WG','TWG'],
    map:{G:'GLASS',W:'WIRE',T:'TRANSISTOR'},
    resultTile:'SOLAR_BATTERY',
    mirror:true
  });
  register({
    id:'heat_solar_panel',
    stimulus:'heat',
    priority:10,
    pattern:['G','WG','WWG'],
    map:{G:'GLASS',W:'WIRE'},
    resultTile:'SOLAR_PANEL',
    mirror:true
  });
  register({
    id:'heat_clay_to_brick',
    stimulus:'heat',
    priority:1,
    pattern:['C'],
    map:{C:'CLAY'},
    resultTile:'BRICK',
    mirror:false
  });
  // Permafrost thaw: heat unbinds frozen soil back into its diggable base.
  // Higher priority than clay firing so a heated FROZEN_CLAY first becomes CLAY
  // (a second application can then fire the clay into brick).
  register({
    id:'heat_thaw_frozen_dirt',
    stimulus:'heat',
    priority:2,
    pattern:['F'],
    map:{F:'FROZEN_DIRT'},
    resultTile:'DIRT',
    mirror:false
  });
  register({
    id:'heat_thaw_frozen_sand',
    stimulus:'heat',
    priority:2,
    pattern:['F'],
    map:{F:'FROZEN_SAND'},
    resultTile:'SAND',
    mirror:false
  });
  register({
    id:'heat_thaw_frozen_clay',
    stimulus:'heat',
    priority:2,
    pattern:['F'],
    map:{F:'FROZEN_CLAY'},
    resultTile:'CLAY',
    mirror:false
  });

  const api={
    register,
    unregister,
    apply,
    recipesFor,
    canStimulus,
    reset,
    isSolarRecipeTile,
    _debug:{recipes,byStimulus,byId,parsePattern,mirrorPattern,matchRecipe}
  };
  MM.reactions=api;
})();

export const reactions = (typeof window!=='undefined' && window.MM) ? window.MM.reactions : undefined;
export default reactions;
