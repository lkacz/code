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

  // Function-pure loot (contract shared with inventory.js KIND_STAT_PRIORITY):
  // an item rolls ONLY its kind's job stats — capes jump, eyes see, outfits carry
  // one work/movement profile, weapons their class numbers, charms one passive.
  // Rarity buys BIGGER numbers of those same stats (ranges barely overlap so a
  // rare/epic find is obviously superior), never extra unrelated stats. Percent
  // values sit on the clean 5% ladder; vision in whole tiles, range half-tiles.
  const TIERS={
    common:{weight:70, rolls:[1,1], uniqueChance:0.02,
      airJumps:1, vision:[11,12],
      outfitPct:{mine:[10,15], move:[5,10],  jump:[5,10]},
      charmPct:{mine:[5,10],  move:[5],     jump:[5]},
      meleeDmg:[2,3],  bowDmg:[3,4],  bowCd:[0.55,0.6],      dps:[4,6],   range:[5,6],
      energyCap:[15,20,25], crush:[1], eCost:[13,14]},
    rare:{weight:23, rolls:[1,2], uniqueChance:0.07,
      airJumps:2, vision:[13,14],
      outfitPct:{mine:[25,30,35], move:[10,15], jump:[10,15]},
      charmPct:{mine:[15,20], move:[10], jump:[10]},
      meleeDmg:[4,6],  bowDmg:[5,7],  bowCd:[0.45,0.5],      dps:[7,10],  range:[6.5,7.5],
      energyCap:[30,40,50], crush:[2], eCost:[10,12]},
    epic:{weight:7, rolls:[2,3], uniqueChance:0.18,
      airJumps:3, vision:[15,17],
      outfitPct:{mine:[50,60,70], move:[20,25], jump:[20,25]},
      charmPct:{mine:[25,30], move:[15,20], jump:[15,20]},
      meleeDmg:[8,12], bowDmg:[9,13], bowCd:[0.3,0.35,0.4],  dps:[12,16], range:[8,9],
      energyCap:[60,80,100], crush:[3,4], eCost:[8,9]}
  };

  // Procedural display names: "<base> <suffix>" (tier shown separately in the UI)
  const NAME_BASES={cape:'Peleryna', eyes:'Oczy', outfit:'Strój', weapon:'Ostrze', charm:'Talizman'};
  const WEAPON_NAME_BASES={melee:'Ostrze', bow:'Łuk', flame:'Miotacz', hose:'Sikawka', gas:'Emiter', electric:'Elektromiotacz'};
  const NAME_SUFFIXES=['wiatru','cienia','głębin','świtu','gór','burzy','lasu','żaru','echa','mrozu','otchłani','słońca'];

  function randInt(r,min,max){ return Math.floor(r()*(max-min+1))+min; }
  function randRange(r,min,max){ return min + (max-min)*r(); }
  function pick(r,arr){ return arr[randInt(r,0,arr.length-1)]; }
  // Add a clean percent step to a multiplier stat, additively: 1.05 + 10% = 1.15
  function addPct(item,key,pct){ item[key]=+(((item[key]||1)+pct/100).toFixed(2)); }
  const PROFILE_KEYS={mine:'mineSpeedMult', move:'moveSpeedMult', jump:'jumpPowerMult'};

  // Unique find (rarer the higher the tier chance): the item's PRIMARY stat gets a
  // further visible boost — a superior version of its own function, nothing new.
  const UNIQUE_NAMES={cape:'sky_bound', eyes:'deep_vision', outfit:'earth_breaker', charm:'wind_dancer', weapon:'storm_edge'};
  function applyUniqueBoost(item){
    item.unique=UNIQUE_NAMES[item.kind]||'storm_edge';
    if(item.kind==='cape'){ item.airJumps=(item.airJumps||0)+1; return; }
    if(item.kind==='eyes'){ item.visionRadius=(item.visionRadius||10)+2; return; }
    if(item.kind==='outfit' || item.kind==='charm'){
      if(typeof item.crushResistBonus==='number'){ item.crushResistBonus+=1; return; }
      if(typeof item.energyCapacityBonus==='number'){ item.energyCapacityBonus+=25; return; }
      for(const k of ['mineSpeedMult','moveSpeedMult','jumpPowerMult']){
        if(typeof item[k]==='number'){ addPct(item,k,10); return; }
      }
      return;
    }
    if(item.weaponType==='melee' || item.weaponType==='bow'){ item.attackDamage=(item.attackDamage||0)+3; return; }
    item.fireDps=(item.fireDps||0)+3;
    item.fireRange=Math.min(10,(item.fireRange||5)+1);
  }

  function genItem(r,tier){
    const kinds=['cape','eyes','outfit','weapon','charm'];
    const kind=kinds[randInt(r,0,kinds.length-1)];
    const item={kind, id:kind+'_'+Math.random().toString(36).slice(2,7), tier};
    const td=TIERS[tier];
    if(kind==='cape'){ item.airJumps=td.airJumps; }
    else if(kind==='eyes'){ item.visionRadius=randInt(r, td.vision[0], td.vision[1]); }
    else if(kind==='outfit'){
      const pool= tier==='common'? ['mine','move','jump'] : ['mine','move','jump','crush'];
      const p=pick(r,pool);
      if(p==='crush') item.crushResistBonus=pick(r, td.crush);
      else addPct(item, PROFILE_KEYS[p], pick(r, td.outfitPct[p]));
    }
    else if(kind==='charm'){
      const pool= tier==='common'? ['mine','move','jump','energy'] : ['mine','move','jump','energy','crush'];
      const p=pick(r,pool);
      if(p==='energy') item.energyCapacityBonus=pick(r, td.energyCap);
      else if(p==='crush') item.crushResistBonus=pick(r, td.crush);
      else addPct(item, PROFILE_KEYS[p], pick(r, td.charmPct[p]));
    }
    else {
      // Weapon class roll: melee strike, bow (arrows), or a stream weapon
      // (flame/hose/gas terrain streams, electric energy beam) — class numbers only.
      const wRoll=r();
      if(wRoll<0.40){ item.weaponType='melee'; item.attackDamage=randInt(r, td.meleeDmg[0], td.meleeDmg[1]); }
      else if(wRoll<0.65){ item.weaponType='bow'; item.attackDamage=randInt(r, td.bowDmg[0], td.bowDmg[1]); item.fireCooldown=pick(r, td.bowCd); }
      else {
        item.weaponType= wRoll<0.78? 'flame' : wRoll<0.87? 'hose' : wRoll<0.95? 'gas' : 'electric';
        const dps=randInt(r, td.dps[0], td.dps[1]);
        item.fireDps= item.weaponType==='hose'? Math.max(1,Math.round(dps/2)) : item.weaponType==='electric'? dps+2 : dps;
        item.fireRange=Math.round(randRange(r, td.range[0], td.range[1])*2)/2; // 0.5-tile steps
        if(item.weaponType==='electric'){
          item.fireRange=Math.min(10, item.fireRange+1);
          item.energyCost=randInt(r, td.eCost[0], td.eCost[1]);
        }
      }
    }
    const nameBase = kind==='weapon'? (WEAPON_NAME_BASES[item.weaponType]||'Ostrze') : (NAME_BASES[kind]||'Przedmiot');
    item.name = nameBase + ' ' + NAME_SUFFIXES[randInt(r,0,NAME_SUFFIXES.length-1)];
    if(r()<td.uniqueChance) applyUniqueBoost(item);
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
