import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GENERAL_MEMORIES,
  MAX_HISTORY,
  layerGraveEntry,
  layerGraveLoot,
  layerGraveMemory,
  normalizeLayerHistory
} from '../src/engine/layer_graves.js';

assert.ok(GENERAL_MEMORIES.length>=6,'the simulation has a real pool of grave lore');
assert.equal(new Set(GENERAL_MEMORIES.map(row=>row.text)).size,GENERAL_MEMORIES.length,'general memories do not repeat');

const seed=20260801;
const a=layerGraveEntry(seed,144,-3,{completions:0});
const again=layerGraveEntry(seed,144,-3,{completions:0});
assert.deepEqual(a,again,'the same world grave always yields the same lore and resources');
assert.equal(a.memory.kind,'simulation','a fresh player never receives invented personal history');
assert.ok(a.memory.text.length>40 && a.memory.signal.length>8,'a grave carries a meaningful lore fragment');

let varied=null;
for(let x=145;x<220;x++){
  const candidate=layerGraveEntry(seed,x,-3,{completions:0});
  if(JSON.stringify(candidate.loot)!==JSON.stringify(a.loot) || candidate.memory.title!==a.memory.title){ varied=candidate; break; }
}
assert.ok(varied,'different coordinates vary the deterministic archive');

const validKeys=new Set(['stone','coal','gold','silverOre','diamond']);
for(let x=-200;x<=200;x++){
  const loot=layerGraveLoot(seed,x,12);
  assert.ok(loot.length>=2 && loot.length<=4,'each grave has a small resource bundle');
  assert.equal(new Set(loot.map(row=>row[0])).size,loot.length,'one resource appears at most once');
  for(const [key,amount] of loot){
    assert.ok(validKeys.has(key),'loot uses a real inventory resource: '+key);
    assert.ok(Number.isInteger(amount) && amount>=1 && amount<=5,'loot amount stays modest');
  }
}

const record={
  layer:4,seed:424242,day:19,level:13,deaths:7,bossKills:6,
  discoveries:{count:31,total:44},milestones:{done:8,total:10},
  verdict:{key:'observer',title:'Obserwator Uważny',note:'Warstwa rozpoznała cierpliwość.'}
};
const archive={completions:4,history:[record]};
let personal=null;
for(let x=0;x<100;x++){
  const candidate=layerGraveMemory(seed,x,20,archive);
  if(candidate.kind==='personal'){ personal=candidate; break; }
}
assert.ok(personal,'completed layers can surface as personal echoes');
assert.equal(personal.layer,4);
assert.match(personal.title,/warstwy #4/i);
assert.match(personal.signal,/Obserwator Uważny/);
assert.match(personal.text,/Warstwa rozpoznała cierpliwość/);
assert.match(personal.measurements,/424242.*dzień 19.*poziom 13.*zgony 7/);
assert.match(personal.progress,/31\/44.*8\/10/);

const lootWithoutHistory=layerGraveLoot(seed,17,20);
const lootWithHistory=layerGraveEntry(seed,17,20,archive).loot;
assert.deepEqual(lootWithHistory,lootWithoutHistory,'player history can change lore, never host-owned loot');

const legacy=normalizeLayerHistory({completions:3,lastVerdict:{key:'phoenix',title:'Feniks Współrzędnych'}});
assert.equal(legacy.history.length,1,'v1 verdict-only profiles receive a synthetic archive record');
assert.equal(legacy.history[0].layer,3);
assert.equal(legacy.history[0].verdict.key,'phoenix');

const oversized=normalizeLayerHistory({completions:30,history:Array.from({length:30},(_,i)=>({
  layer:i+1,verdict:{key:'observer',title:'Warstwa '+(i+1),note:'zapis'}
}))});
assert.equal(oversized.history.length,MAX_HISTORY,'the cross-world archive is bounded');
assert.equal(oversized.history[0].layer,19,'the newest bounded records survive');

const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const finale=readFileSync(new URL('../src/engine/finale.js',import.meta.url),'utf8');
const host=readFileSync(new URL('../src/engine/ghost_host.js',import.meta.url),'utf8');
const client=readFileSync(new URL('../src/engine/ghost_client.js',import.meta.url),'utf8');
const world=readFileSync(new URL('../src/engine/world.js',import.meta.url),'utf8');
const catalog=readFileSync(new URL('../src/engine/discovery_catalog.js',import.meta.url),'utf8');
const moduleSrc=readFileSync(new URL('../src/engine/layer_graves.js',import.meta.url),'utf8');

assert.match(world,/buildRuinChurch[\s\S]*T\.GRAVE/,'rare churchyards remain the generated source of memory graves');
assert.match(main,/function tryOpenGraveAt\(tx,ty\)[\s\S]{0,400}isTrackedRecoveryGraveAt/,'tracked recovery graves keep priority');
assert.match(main,/function breakMinedTile\(\)[\s\S]{0,700}T\.GRAVE\) return MM\.ghostHeroIntents\.use/,'guest mining routes graves through the host use transaction');
assert.match(main,/ghostHeroMineAt[\s\S]*tId===T\.GRAVE\) return \{ok:false, reason:'grave'\}/,'forged guest mine packets cannot bypass grave lore');
assert.match(main,/claimGeneratedLayerGraveAt[\s\S]*presentLayerGraveMemory/,'untracked graves become lore archives');
assert.match(main,/drawGraveTile\(cctx,[^\n]*!isTrackedRecoveryGraveAt/,'memory graves have distinct tile art');
assert.match(main,/ghostHeroUseAt[\s\S]*memoryGrave:true/,'the host owns multiplayer world removal');
assert.match(main,/ghostHeroLayerGraveOpened/,'the guest presents its own archive');
assert.match(host,/memoryGrave:\s*!!\(res && res\.memoryGrave\)/,'the host ack identifies memory-grave loot');
assert.match(client,/pl\.memoryGrave[\s\S]{0,900}ghostHeroLayerGraveOpened/,'the guest banks validated loot before showing lore');
assert.match(finale,/const data = \{v: 2, completions: layer, history\}/,'completed-layer reports persist bounded history');
assert.match(finale,/addCompletion\(verdict\(rep\), rep\)/,'finale records the report used for its verdict');
assert.match(catalog,/id:'layer_graves_hold_memory'[\s\S]*id:'previous_layers_leave_echoes'/,'the journal teaches both archive tiers');
assert.match(moduleSrc,/aria-modal','true'/,'the lore view is a real modal');
assert.match(moduleSrc,/el\.textContent=text[\s\S]*addText\(card,'lgText',memory\.text\)/,'guest-visible lore uses textContent');
assert.doesNotMatch(moduleSrc,/\.innerHTML\s*=/,'the lore modal has no HTML injection sink');

console.log('layer-graves-sim: all assertions passed');
