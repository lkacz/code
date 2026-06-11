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
        MM.dynamicLoot = MM.dynamicLoot || {capes:[],eyes:[],outfits:[],weapons:[],charms:[]};
        ['capes','eyes','outfits','weapons','charms'].forEach(k=>{
          if(!Array.isArray(MM.dynamicLoot[k])) MM.dynamicLoot[k]=[];
          if(Array.isArray(d[k])){
            d[k].forEach(it=>{
              if(!MM.dynamicLoot[k].find(e=>e.id===it.id)) MM.dynamicLoot[k].push(it);
            });
          }
        });
      }
    }
  }catch(e){}
  function saveDynamicLoot(){ try{ if(MM.dynamicLoot) localStorage.setItem(DYN_KEY, JSON.stringify({version:DYN_VERSION, ...MM.dynamicLoot})); }catch(e){} }

  // Multiplier bonuses roll DISCRETE clean percent steps (matching the 5%-ladder
  // the inventory displays) — no more 1.0437x oddities; vision rolls whole tiles.
  const TIERS={
    common:{weight:70, rolls:[1,1], attribBudget:[1,2], pctSteps:{move:[5],        jump:[5],        mine:[5,10,15]},  vision:[0,1], dmg:[1,2], flameDps:[4,6],  flameRange:[5,6],   uniqueChance:0.02},
    rare:{weight:23, rolls:[1,2], attribBudget:[2,3], pctSteps:{move:[5,10],     jump:[5,10],     mine:[10,20,30]}, vision:[1,3], dmg:[2,4], flameDps:[6,9],  flameRange:[6,7.5], uniqueChance:0.07},
    epic:{weight:7, rolls:[2,3], attribBudget:[3,4], pctSteps:{move:[10,15,20], jump:[10,15,20], mine:[20,30,50]}, vision:[2,5], dmg:[4,7], flameDps:[9,14], flameRange:[7,9],   uniqueChance:0.18}
  };

  // Pool of base item kinds we can grant, each with base stat skeleton
  const BASE_ITEMS={
    cape:()=>({kind:'cape', airJumps:0}),
    eyes:()=>({kind:'eyes', visionRadius:11}),
    outfit:()=>({kind:'outfit'}),
    weapon:()=>({kind:'weapon'}),
    charm:()=>({kind:'charm'})
  };
  // Procedural display names: "<base> <suffix>" (tier shown separately in the UI)
  const NAME_BASES={cape:'Peleryna', eyes:'Oczy', outfit:'Strój', weapon:'Ostrze', charm:'Talizman'};
  const WEAPON_NAME_BASES={melee:'Ostrze', bow:'Łuk', flame:'Miotacz', hose:'Sikawka', gas:'Emiter'};
  const NAME_SUFFIXES=['wiatru','cienia','głębin','świtu','gór','burzy','lasu','żaru','echa','mrozu','otchłani','słońca'];

  // Unique affixes add clean percent steps (additive, so totals stay on the ladder)
  const UNIQUE_AFFIXES=[
    {id:'wind_dancer', adds:{movePct:10,jumpPct:10}, tags:['speed']},
    {id:'deep_vision', adds:{visionRadiusFlat:4}, tags:['vision']},
    {id:'earth_breaker', adds:{minePct:35}, tags:['mining']},
    {id:'sky_bound', adds:{airJumpsFlat:1,jumpPct:15}, tags:['jump']},
    {id:'storm_edge', adds:{attackDamageFlat:3}, tags:['damage']}
  ];

  function randInt(r,min,max){ return Math.floor(r()*(max-min+1))+min; }
  function randRange(r,min,max){ return min + (max-min)*r(); }
  function pick(r,arr){ return arr[randInt(r,0,arr.length-1)]; }
  // Add a clean percent step to a multiplier stat, additively: 1.05 + 10% = 1.15
  function addPct(item,key,pct){ item[key]=+(((item[key]||1)+pct/100).toFixed(2)); }

  function genItem(r,tier){ const baseKeys=Object.keys(BASE_ITEMS); const baseKind=baseKeys[randInt(r,0,baseKeys.length-1)]; const item=BASE_ITEMS[baseKind](); item.id = baseKind+ '_' + Math.random().toString(36).slice(2,7); item.tier=tier; const tierDef=TIERS[tier];
    // allocate attribute budget -> number of different stats to enhance
    const attribCount=randInt(r,tierDef.attribBudget[0], tierDef.attribBudget[1]);
    const statsPool=['move','jump','mine','vision','air','dmg'];
    const chosen=[]; while(chosen.length<attribCount && statsPool.length){ const idx=randInt(r,0,statsPool.length-1); chosen.push(statsPool.splice(idx,1)[0]); }
    chosen.forEach(stat=>{
      if(stat==='move'){ addPct(item,'moveSpeedMult', pick(r,tierDef.pctSteps.move)); }
      else if(stat==='jump'){ addPct(item,'jumpPowerMult', pick(r,tierDef.pctSteps.jump)); }
      else if(stat==='mine'){ addPct(item,'mineSpeedMult', pick(r,tierDef.pctSteps.mine)); }
      else if(stat==='vision'){ item.visionRadius = (item.visionRadius||10) + randInt(r, tierDef.vision[0], tierDef.vision[1]); }
      else if(stat==='air'){ item.airJumps = (item.airJumps||0) + 1; }
      else if(stat==='dmg'){ item.attackDamage = (item.attackDamage||0) + Math.max(1, Math.round(randInt(r,tierDef.dmg[0],tierDef.dmg[1])/2)); }
    });
    // Weapons roll a class: melee strike, bow (arrows), or a stream weapon
    // (flamethrower ignites, water hose extinguishes, gas emitter poisons)
    if(baseKind==='weapon'){
      const wRoll=r();
      if(wRoll<0.40){ item.weaponType='melee'; item.attackDamage=(item.attackDamage||0) + randInt(r, tierDef.dmg[0], tierDef.dmg[1]); }
      else if(wRoll<0.65){ item.weaponType='bow'; item.attackDamage=(item.attackDamage||0) + randInt(r, tierDef.dmg[0], tierDef.dmg[1]) + 1; item.fireCooldown=Math.max(0.3, +(0.6 - 0.05*randInt(r,0,3)).toFixed(2)); }
      else {
        item.weaponType= wRoll<0.80? 'flame' : wRoll<0.90? 'hose' : 'gas';
        const dps=randInt(r, tierDef.flameDps[0], tierDef.flameDps[1]);
        item.fireDps= item.weaponType==='hose'? Math.max(1,Math.round(dps/2)) : dps;
        item.fireRange=Math.round(randRange(r, tierDef.flameRange[0], tierDef.flameRange[1])*2)/2; // 0.5-tile steps
      }
    }
    const nameBase = baseKind==='weapon'? (WEAPON_NAME_BASES[item.weaponType]||'Ostrze') : (NAME_BASES[baseKind]||'Przedmiot');
    item.name = nameBase + ' ' + NAME_SUFFIXES[randInt(r,0,NAME_SUFFIXES.length-1)];
    // unique affix chance
    if(r()<tierDef.uniqueChance){ const aff=UNIQUE_AFFIXES[randInt(r,0,UNIQUE_AFFIXES.length-1)]; item.unique=aff.id; if(aff.adds.movePct) addPct(item,'moveSpeedMult',aff.adds.movePct); if(aff.adds.jumpPct) addPct(item,'jumpPowerMult',aff.adds.jumpPct); if(aff.adds.minePct) addPct(item,'mineSpeedMult',aff.adds.minePct); if(aff.adds.visionRadiusFlat) item.visionRadius=(item.visionRadius||10)+aff.adds.visionRadiusFlat; if(aff.adds.airJumpsFlat) item.airJumps=(item.airJumps||0)+aff.adds.airJumpsFlat; if(aff.adds.attackDamageFlat) item.attackDamage=(item.attackDamage||0)+aff.adds.attackDamageFlat; }
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
    // Add to player's loot pools -> synced into the inventory bag (inventory.js)
    if(!MM.dynamicLoot){ MM.dynamicLoot={capes:[],eyes:[],outfits:[],weapons:[],charms:[]}; }
    ['capes','eyes','outfits','weapons','charms'].forEach(k=>{ if(!Array.isArray(MM.dynamicLoot[k])) MM.dynamicLoot[k]=[]; });
    items.forEach(it=>{ if(it.kind==='cape') MM.dynamicLoot.capes.push(it); else if(it.kind==='eyes') MM.dynamicLoot.eyes.push(it); else if(it.kind==='outfit') MM.dynamicLoot.outfits.push(it); else if(it.kind==='weapon') MM.dynamicLoot.weapons.push(it); else if(it.kind==='charm') MM.dynamicLoot.charms.push(it); });
    saveDynamicLoot();
    if(MM.onLootGained) MM.onLootGained(items,tier);
    return {tier,items};
  }

  MM.chests={openChestAt,TIERS,genItem,saveDynamicLoot};
})();
// ESM export (progressive migration)
export const chests = (typeof window!=='undefined' && window.MM) ? window.MM.chests : undefined;
export default chests;
