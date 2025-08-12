// Chest / Loot system with rarity tiers and procedural modifier items
import { T, INFO } from '../constants.js';
import world from './world.js';
import { worldGen as WORLDGEN } from './worldgen.js';
(function(){
  window.MM = window.MM || {};
  const WORLD = world || (window.MM && MM.world);
  const RNG = (seed)=>{ let s=seed>>>0; return ()=>{ s = (s*1664525 + 1013904223)>>>0; return (s>>>8)/0xFFFFFF; } };
  const DYN_KEY='mm_dynamic_loot_v1';
  const DYN_VERSION=1;
  // Load previously saved dynamic loot (items from opened chests)
  try{
    const raw=localStorage.getItem(DYN_KEY);
    if(raw){
      const d=JSON.parse(raw);
      if(d && typeof d==='object'){
        // Support legacy (no version) structure where arrays are at root
        const legacy = !('version' in d) && (Array.isArray(d.capes)||Array.isArray(d.eyes)||Array.isArray(d.outfits));
        const payload = legacy? d : d;
        MM.dynamicLoot = MM.dynamicLoot || {capes:[],eyes:[],outfits:[]};
        ['capes','eyes','outfits'].forEach(k=>{
          if(Array.isArray(payload[k])){
            payload[k].forEach(it=>{
              if(!MM.dynamicLoot[k].find(e=>e.id===it.id)) MM.dynamicLoot[k].push(it);
            });
          }
        });
      }
    }
  }catch(e){}
  function saveDynamicLoot(){ try{ if(MM.dynamicLoot) localStorage.setItem(DYN_KEY, JSON.stringify({version:DYN_VERSION, ...MM.dynamicLoot})); }catch(e){} }

  const TIERS={
    common:{weight:70, rolls:[1,1], attribBudget:[1,2], multRange:{move:[0.02,0.05], jump:[0.02,0.05], mine:[0.05,0.15], vision:[0,1]}, uniqueChance:0.02},
    rare:{weight:23, rolls:[1,2], attribBudget:[2,3], multRange:{move:[0.04,0.10], jump:[0.05,0.12], mine:[0.10,0.30], vision:[1,3]}, uniqueChance:0.07},
    epic:{weight:7, rolls:[2,3], attribBudget:[3,4], multRange:{move:[0.08,0.18], jump:[0.10,0.22], mine:[0.20,0.50], vision:[2,5]}, uniqueChance:0.18}
  };

  // Pool of base item kinds we can grant (cape / eyes / outfit) each with base stat skeleton
  const BASE_ITEMS={
    cape:()=>({kind:'cape', airJumps:0}),
    eyes:()=>({kind:'eyes', visionRadius:11}),
    outfit:()=>({kind:'outfit'})
  };

  const UNIQUE_AFFIXES=[
    {id:'wind_dancer', adds:{moveSpeedMult:1.12,jumpPowerMult:1.08}, tags:['speed']},
    {id:'deep_vision', adds:{visionRadiusFlat:4}, tags:['vision']},
    {id:'earth_breaker', adds:{mineSpeedMult:1.35}, tags:['mining']},
    {id:'sky_bound', adds:{airJumpsFlat:1,jumpPowerMult:1.15}, tags:['jump']}
  ];

  function pickTier(r){ const total=Object.values(TIERS).reduce((a,b)=>a+b.weight,0); let x=r()*total; for(const [k,v] of Object.entries(TIERS)){ if(x<v.weight) return k; x-=v.weight; } return 'common'; }

  function randInt(r,min,max){ return Math.floor(r()*(max-min+1))+min; }
  function randRange(r,min,max){ return min + (max-min)*r(); }

  function genItem(r,tier){ const baseKeys=Object.keys(BASE_ITEMS); const baseKind=baseKeys[randInt(r,0,baseKeys.length-1)]; const item=BASE_ITEMS[baseKind](); item.id = baseKind+ '_' + Math.random().toString(36).slice(2,7); item.tier=tier; const tierDef=TIERS[tier];
    // allocate attribute budget -> number of different stats to enhance
    const attribCount=randInt(r,tierDef.attribBudget[0], tierDef.attribBudget[1]);
    const statsPool=['move','jump','mine','vision','air'];
    const chosen=[]; while(chosen.length<attribCount && statsPool.length){ const idx=randInt(r,0,statsPool.length-1); chosen.push(statsPool.splice(idx,1)[0]); }
    chosen.forEach(stat=>{
      if(stat==='move'){ const inc=randRange(r, tierDef.multRange.move[0], tierDef.multRange.move[1]); item.moveSpeedMult=(item.moveSpeedMult||1)*(1+inc); }
      else if(stat==='jump'){ const inc=randRange(r, tierDef.multRange.jump[0], tierDef.multRange.jump[1]); item.jumpPowerMult=(item.jumpPowerMult||1)*(1+inc); }
      else if(stat==='mine'){ const inc=randRange(r, tierDef.multRange.mine[0], tierDef.multRange.mine[1]); item.mineSpeedMult=(item.mineSpeedMult||1)*(1+inc); }
      else if(stat==='vision'){ const inc=randRange(r, tierDef.multRange.vision[0], tierDef.multRange.vision[1]); item.visionRadius = (item.visionRadius||10) + Math.round(inc); }
      else if(stat==='air'){ item.airJumps = (item.airJumps||0) + 1; }
    });
    // unique affix chance
    if(r()<tierDef.uniqueChance){ const aff=UNIQUE_AFFIXES[randInt(r,0,UNIQUE_AFFIXES.length-1)]; item.unique=aff.id; if(aff.adds.moveSpeedMult) item.moveSpeedMult=(item.moveSpeedMult||1)*aff.adds.moveSpeedMult; if(aff.adds.jumpPowerMult) item.jumpPowerMult=(item.jumpPowerMult||1)*aff.adds.jumpPowerMult; if(aff.adds.mineSpeedMult) item.mineSpeedMult=(item.mineSpeedMult||1)*aff.adds.mineSpeedMult; if(aff.adds.visionRadiusFlat) item.visionRadius=(item.visionRadius||10)+aff.adds.visionRadiusFlat; if(aff.adds.airJumpsFlat) item.airJumps=(item.airJumps||0)+aff.adds.airJumpsFlat; }
    return item;
  }

  function openChestAt(x,y){ const t=WORLD.getTile(x,y); const info=INFO[t]; if(!info || !info.chestTier) return null; // not chest
    // remove chest tile
    WORLD.setTile(x,y,T.AIR);
    const r=RNG( (x*73856093) ^ (y*19349663) ^ WORLDGEN.worldSeed );
    const tier=info.chestTier;
    const tierDef=TIERS[tier];
    const rolls=randInt(r,tierDef.rolls[0], tierDef.rolls[1]);
    const items=[]; for(let i=0;i<rolls;i++) items.push(genItem(r,tier));
    // Add to player's unlock pools -> push into customization categories
    if(!MM.dynamicLoot){ MM.dynamicLoot={capes:[],eyes:[],outfits:[]}; }
    items.forEach(it=>{ if(it.kind==='cape') MM.dynamicLoot.capes.push(it); else if(it.kind==='eyes') MM.dynamicLoot.eyes.push(it); else if(it.kind==='outfit') MM.dynamicLoot.outfits.push(it); });
    saveDynamicLoot();
    if(MM.onLootGained) MM.onLootGained(items,tier);
    return {tier,items};
  }

  MM.chests={openChestAt,TIERS,genItem,saveDynamicLoot};
})();
// ESM export (progressive migration)
export const chests = (typeof window!=='undefined' && window.MM) ? window.MM.chests : undefined;
export default chests;
