// Discovery journal regressions: catalog completeness (every note() id used in
// src has a player-facing label), progress math, one-shot toasts and reset.
// Run: node tools/discovery-sim.test.mjs
import { strict as assert } from 'assert';
import { readFileSync, readdirSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};
let toasts = [];
globalThis.msg = (t) => { toasts.push(String(t)); };
const eventListeners=new Map();
globalThis.CustomEvent=class {
  constructor(type,opts={}){
    this.type=type;
    this.detail=opts.detail;
    this.cancelable=!!opts.cancelable;
    this.defaultPrevented=false;
  }
  preventDefault(){ if(this.cancelable) this.defaultPrevented=true; }
};
globalThis.addEventListener=(type,fn)=>{
  const rows=eventListeners.get(type)||[];
  rows.push(fn);
  eventListeners.set(type,rows);
};
globalThis.dispatchEvent=event=>{
  for(const fn of eventListeners.get(event.type)||[]) fn(event);
  return !event.defaultPrevented;
};
const hostileDiscoveryProfile=['stone_melt'];
for(let i=0;i<600;i++) hostileDiscoveryProfile.push('unknown_'+i);
hostileDiscoveryProfile.push('sandstorm');
const discoveryStore = {
  mm_discoveries_v1: JSON.stringify(hostileDiscoveryProfile)
};
globalThis.localStorage = {
  getItem(key){ return Object.prototype.hasOwnProperty.call(discoveryStore,key) ? discoveryStore[key] : null; },
  setItem(key,value){ discoveryStore[key]=String(value); },
  removeItem(key){ delete discoveryStore[key]; }
};
function storedDiscoveryList(){
  const profile=JSON.parse(discoveryStore.mm_discoveries_v1);
  return Array.isArray(profile)?profile:(Array.isArray(profile&&profile.list)?profile.list:[]);
}

const { discovery } = await import('../src/engine/discovery.js');
assert.ok(discovery, 'discovery module exports');
assert.equal(discovery.count(), 1, 'restore keeps only known catalog discoveries from a corrupted profile');
assert.equal(discovery.has('not_in_catalog'), false, 'restore rejects unknown discovery ids');
assert.equal(discovery.has('sandstorm'),false,'discovery restore has a bounded hostile-array scan');
discovery.reset();

// --- catalog completeness: scan src for every id fed to note() -------------
const ids = new Set();
function scanDir(dir){
  for(const entry of readdirSync(dir, {withFileTypes:true})){
    if(entry.isDirectory()){ scanDir(dir + '/' + entry.name); continue; }
    if(!entry.name.endsWith('.js')) continue;
    const src = readFileSync(dir + '/' + entry.name, 'utf8');
    for(const m of src.matchAll(/discovery\.note\('([a-z_]+)'/g)){
      if(m[1] !== 'react_') ids.add(m[1]); // dynamic reactions handled below
    }
    // dynamic reaction ids: noteStatusReaction(m,'kind',...) => react_<kind>
    for(const m of src.matchAll(/noteStatusReaction\([^,]+,'([a-z_]+)'/g)) ids.add('react_' + m[1]);
  }
}
scanDir(new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
assert.ok(ids.size >= 10, 'source scan found the discovery hooks (got ' + ids.size + ')');
for(const id of ids){
  assert.ok(discovery.CATALOG[id], `discovery id "${id}" used in src has a catalog label`);
}

// --- one-shot toasts, progress math ----------------------------------------
assert.equal(discovery.count(), 0, 'journal starts empty');
assert.equal(discovery.total(), Object.keys(discovery.CATALOG).length, 'total mirrors the catalog');
assert.equal(discovery.note('stone_melt', 'Ogień topi kamień w lawę!'), true, 'first occurrence is recorded');
assert.equal(toasts.length, 1, 'the first occurrence toasts');
assert.ok(toasts[0].includes('Odkrycie'), 'the toast is branded as a discovery');
assert.equal(discovery.note('stone_melt', 'Ogień topi kamień w lawę!'), false, 'repeats are silent');
assert.equal(toasts.length, 1, 'no duplicate toast');
assert.equal(discovery.has('stone_melt'), true, 'has() sees the entry');
assert.equal(discovery.count(), 1, 'count tracks the journal');
discovery.note('react_freeze', 'x');
const p = discovery.progress();
assert.equal(p.count, 2, 'progress counts found entries');
assert.equal(p.total, discovery.knowledgeTotal(), 'knowledge progress excludes Atlas collection cards');
assert.equal(p.collectionTotal, discovery.collectionTotal(), 'collection cards have their own completion denominator');
assert.ok(p.found.some(f => f.id === 'react_freeze' && /lodu/i.test(f.label)), 'progress lists catalog labels, not raw ids');
assert.ok(discovery.HINTS.jewel_drop && /przedmiot/i.test(discovery.HINTS.jewel_drop.hint), 'rare jewel discovery has a non-spoiling journal hint');
const discoveryCheckpoint=discovery.snapshot();
discovery.note('sandstorm','x');
assert.equal(discovery.has('sandstorm'),true);
assert.equal(discovery.restore(discoveryCheckpoint),true,'journal can return to an in-memory timeline checkpoint');
assert.equal(discovery.has('sandstorm'),false,'branch-only discovery is removed on rewind');
assert.equal(storedDiscoveryList().includes('sandstorm'),false,'rewound journal is persisted');

// --- entering each surface biome is a one-shot discovery -------------------
{
  globalThis.player = { xp: 25 };
  assert.equal(discovery.BIOME_DISCOVERY_IDS.length, 9, 'all surface biome ids are mapped');
  assert.equal(discovery.noteBiome(3, 'Pustynia'), true, 'first entry into a biome is discovered');
  assert.equal(discovery.has('biome_desert'), true, 'biome discovery lands in the journal');
  const biomeXp=discovery.xpFor('biome_desert');
  assert.equal(biomeXp,0,'biome stamps are Atlas cards, not XP-bearing knowledge');
  assert.equal(globalThis.player.xp, 25, 'a fresh biome card does not inflate the knowledge XP economy');
  assert.equal(discovery.noteBiome(3, 'Pustynia'), false, 're-entering a known biome is silent');
  assert.equal(globalThis.player.xp, 25, 're-entering a biome never pays XP');
  assert.equal(discovery.noteBiome(99, 'Nieznany'), false, 'unknown biome ids are refused');
  assert.ok(toasts.some(t => t.includes('Karta Atlasu') && t.includes('Nowy biom: Pustynia') && !t.includes('+0 XP')), 'biome toast is clearly branded as a non-XP Atlas card');
  delete globalThis.player;

  const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(mainSrc, /function noteCurrentBiomeDiscovery\(\)/, 'main exposes one biome-transition check');
  assert.match(mainSrc, /runGameFrame\(simulationDt,ts\);\s*noteCurrentBiomeDiscovery\(\);/, 'active scaled simulation checks the current biome after movement');
}

// --- unknown ids never crash and never count --------------------------------
assert.equal(discovery.note('', 'x'), false, 'empty id refused');
assert.equal(discovery.note(123, 'x'), false, 'non-string id refused');
assert.equal(discovery.note('not_in_catalog', 'x'), false, 'unknown string id refused');
assert.equal(discovery.count(), 3, 'unknown ids never inflate journal progress');

// --- journal-tab view: entries() masks unfound ids to ??? + category hint ----
{
  const all = discovery.entries();
  assert.ok(all.length>=240,'the expanded atlas contains foundational through end-game knowledge');
  assert.equal(all.length, discovery.total(), 'entries() covers the whole catalog');
  const found = all.find(e => e.id === 'stone_melt');
  assert.equal(found.found, true, 'found entries are flagged');
  assert.equal(found.label, discovery.CATALOG.stone_melt, 'found entries expose their label');
  const hidden = all.find(e => e.id === 'sandstorm');
  assert.equal(hidden.found, false, 'unfound entries stay masked');
  assert.equal(hidden.label, null, 'no label leaks before the discovery');
  assert.ok(hidden.cat && hidden.cat.length > 2, 'every entry carries a category');
  assert.ok(hidden.hint && hidden.hint.length > 8, 'unfound entries carry a foggy hint');
  assert.ok(all.every(e=>e.tierLabel && (e.collection?e.xp===0:e.xp>0) && e.color), 'knowledge exposes a reward tier while collection cards remain XP-free');
  assert.ok(all.every(e=>['observation','insight','discovery'].includes(e.stage) && e.stageLabel),'every entry has an independent cognition stage');
  assert.ok(all.every(e=>e.cat && e.cat!=='undefined' && e.hint.length>8),'every knowledge card has a useful category and non-empty clue');
  assert.equal(discovery.xpFor('water_boil'),20,'a basic physical observation pays less XP');
  assert.equal(discovery.xpFor('steam_flight'),120,'a complex application chain ends in a breakthrough reward');
  assert.ok(discovery.TOTAL_DISCOVERY_XP>discovery.knowledgeTotal()*20,'completion XP sums only knowledge rewards');
  assert.ok(all.filter(e=>e.collection).every(e=>e.xp===0),'every Atlas collection card is separated from the XP economy');
  for(const e of all) assert.ok(discovery.HINTS[e.id], `catalog id "${e.id}" has a journal hint entry`);
}

// --- +XP on every fresh discovery (progress.js turns player.xp into levels) --
{
  globalThis.player = { xp: 100 };
  assert.equal(discovery.note('sandstorm', 'test'), true, 'fresh discovery lands');
  assert.equal(globalThis.player.xp, 100 + discovery.DISCOVERY_XP, 'a fresh discovery pays +' + discovery.DISCOVERY_XP + ' XP');
  assert.equal(discovery.note('sandstorm', 'test'), false, 'repeat is silent');
  assert.equal(globalThis.player.xp, 100 + discovery.DISCOVERY_XP, 'repeats never re-pay the XP');
  assert.ok(toasts.some(t => t.includes('+' + discovery.DISCOVERY_XP + ' XP')), 'the toast advertises the XP award');
  delete globalThis.player;
}

// Corrupt XP cannot be propagated by a valid discovery reward.
{
  globalThis.player={xp:Infinity};
  assert.equal(discovery.note('water_boil','test'),true,'fresh discovery still works with a corrupt XP counter');
  assert.equal(globalThis.player.xp,discovery.xpFor('water_boil'),'non-finite XP is normalised before adding the catalog reward');
  globalThis.player.xp=1e300;
  assert.equal(discovery.note('gas_boom','test'),true,'another discovery can reward a huge finite XP profile');
  assert.equal(globalThis.player.xp,1000000000,'discovery XP has a finite global cap');
  assert.equal(toasts.at(-1).includes('+40 XP'),false,'a capped discovery toast does not claim XP that was not awarded');
  globalThis.player.xp=999999990;
  assert.equal(discovery.note('electric_water','test'),true,'a discovery can award the remaining fraction below the XP cap');
  assert.equal(globalThis.player.xp,1000000000,'a partial discovery reward stops exactly at the XP cap');
  assert.ok(toasts.at(-1).includes('+10 XP'),'the discovery toast reports the actual partial XP award');
  delete globalThis.player;
}

// The browser presentation receives one structured, cancelable event. Handling
// it suppresses the legacy central toast without changing the discovery result.
{
  let earned=null;
  addEventListener('mm-discovery-earned',event=>{
    if(event.detail.id!=='energy_sprint') return;
    earned=event.detail;
    event.preventDefault();
  });
  globalThis.player={xp:0,x:4,y:6};
  const beforeToasts=toasts.length;
  assert.equal(discovery.note('energy_sprint',undefined,{source:'hero_turbo',target:{x:4,y:6}}),true);
  assert.ok(earned && earned.stage==='observation' && earned.tier==='observation' && earned.xp===20,'structured discovery event carries stage, tier, XP and source data');
  assert.deepEqual(earned.target,{x:4,y:6});
  assert.equal(toasts.length,beforeToasts,'handled feed event suppresses the duplicate legacy toast');
  delete globalThis.player;
}

{
  MM.ghostMode=true;
  assert.equal(discovery.note('antenna_echo','watcher'),false,'a passive watcher cannot mutate the local knowledge profile');
  assert.equal(discovery.observe('hero_moved',{cell:'0,0'}),null,'fact rules also reject spectator learning');
  delete MM.ghostMode;
}

// Declarative facts enforce prerequisites, bounded evidence, one reveal per
// confirmed outcome and real witness distance for ambient phenomena.
{
  discovery.reset();
  globalThis.player={xp:0,x:0,y:0};
  const mined={layer:'foreground',material:'stone',tile:3,hardness:7,hasDrop:true,target:{x:.5,y:.5}};
  assert.equal(discovery.observe('tile_mined',mined),'blocks_can_be_mined','first mined block reveals only the foundational observation');
  assert.equal(discovery.has('mining_returns_material'),false,'one outcome cannot dump the whole knowledge chain');
  assert.equal(discovery.observe('tile_mined',mined),'mining_returns_material','the next confirmed block can promote the dependent insight');
  assert.equal(discovery.has('soil_over_stone'),false,'another ready rule remains queued for a later fact');
  assert.equal(discovery.observe('tile_mined',mined),'soil_over_stone','repeated stone alone does not prove material hardness differs');
  assert.equal(discovery.observe('tile_mined',{...mined,material:'dirt',tile:2,hardness:2}),'materials_have_hardness','hardness requires two genuinely different material values');

  discovery.reset();
  assert.equal(discovery.observe('hero_moved',{cell:'0,0',target:{x:0,y:0}}),'first_steps','movement starts with a single observation');
  for(let i=1;i<11;i++){
    globalThis.player.x=i;
    assert.equal(discovery.observe('hero_moved',{cell:i+',0',target:{x:i,y:0}}),null);
  }
  globalThis.player.x=11;
  assert.equal(discovery.observe('hero_moved',{cell:'11,0',target:{x:11,y:0}}),'world_has_distance','distance insight uses distinct visited cells, not step spam');

  discovery.reset();
  assert.equal(discovery.observe('falling_sand',{rolled:false}),null,'a witnessed rule refuses payloads without a target');
  assert.equal(discovery.evidenceFor('sand_obeys_gravity').count,0,'missing witness data cannot leave latent evidence');
  assert.equal(discovery.observe('falling_sand',{rolled:false,target:{x:40,y:0}}),null,'a far-off simulation is not learned');
  assert.equal(discovery.evidenceFor('sand_obeys_gravity').count,0,'off-screen outcomes do not count');
  assert.equal(discovery.observe('falling_sand',{rolled:false,target:{x:2,y:0}}),'sand_obeys_gravity','a nearby physical outcome is observable');
  discovery.observe('falling_sand',{rolled:true,target:{x:2,y:0}});
  discovery.observe('falling_sand',{rolled:true,target:{x:2,y:0}});
  const proof=discovery.evidenceFor('sand_forms_slopes');
  assert.equal(proof.count,2,'partial repeated evidence is retained without revealing early');
  const proofSnapshot=discovery.snapshot();
  assert.equal(proofSnapshot.v,2,'snapshot schema carries the bounded evidence map');
  assert.ok(Array.isArray(proofSnapshot.evidence.sand_forms_slopes),'partial evidence is serializable');
  assert.equal(discovery.restore(proofSnapshot),true,'v2 knowledge snapshots round-trip');
  assert.equal(discovery.observe('falling_sand',{rolled:true,target:{x:2,y:0}}),'sand_forms_slopes','restored evidence completes on the next real outcome');

  discovery.reset();
  discovery.note('water_entry','');
  discovery.note('water_buoyancy','');
  assert.equal(discovery.observe('hero_dive',{headCovered:true,controlled:false}),null,'falling into water is not credited as a controlled dive');
  assert.equal(discovery.observe('hero_dive',{headCovered:true,controlled:true}),'controlled_dive','the deliberate dive input is part of the evidence contract');

  discovery.reset();
  discovery.note('blocks_can_be_placed','');
  discovery.note('placement_needs_support','');
  assert.equal(discovery.observe('tile_placed',{layer:'foreground',support:'other'}),null,'a generic unsupported classification cannot masquerade as side bracing');
  assert.equal(discovery.observe('tile_placed',{layer:'foreground',support:'side'}),'side_bracing','a confirmed side anchor reveals the bracing application');

  discovery.reset();
  assert.equal(discovery.observe('hero_died',{costly:false}),null,'a cost-free story or guest death does not teach resource loss');
  assert.equal(discovery.observe('hero_died',{costly:true}),'death_teaches_risk','only a materially costly death unlocks the Echo lesson');

  const guardianPrinciples=[
    ['fire_torch_cooled','guardian_fire_water_window'],
    ['ice_silence_opened','guardian_ice_listens_to_silence'],
    ['earth_gas_repels','guardian_earth_fears_gas'],
    ['earth_cairn_releases_damage','guardian_earth_cairn_memory'],
    ['air_resonators_shield','guardian_air_resonator_shield'],
    ['center_mirror_reflects','guardian_center_reflects_damage'],
  ];
  discovery.reset();
  assert.equal(
    discovery.observe('guardian_principle',{kind:'fire_torch_cooled',actor:'world',target:{x:80,y:0}}),
    null,
    'an off-screen guardian interaction cannot become personal knowledge'
  );
  for(const [kind,id] of guardianPrinciples){
    discovery.reset();
    assert.equal(
      discovery.observe('guardian_principle',{kind,target:{x:0,y:0}}),
      id,
      `a confirmed guardian law reveals ${id}`
    );
  }

  discovery.reset();
  assert.equal(discovery.observe('fish_caught',{fish:'golden',golden:true}),'first_fish','a first golden catch records the fishing foundation');
  assert.equal(discovery.observe('golden_fish_caught',{fish:'golden',golden:true}),'golden_fish','the same rare catch has a dedicated follow-up fact and never requires a duplicate golden fish');

  discovery.reset();
  assert.equal(discovery.observe('chest_opened',{tier:'legendary',spawned:0}),null,'an empty/fallback chest does not claim physical world loot');
  assert.equal(discovery.observe('chest_opened',{tier:'legendary',spawned:3}),'chests_release_loot','physical loot establishes the chest foundation');
  assert.equal(discovery.observe('rare_chest_opened',{tier:'legendary',spawned:3}),'chest_rarity','the same rare opening can establish the rarity insight');
  assert.equal(discovery.observe('legendary_chest_opened',{tier:'legendary',spawned:3}),'legendary_chest','the legendary opening completes its chain without demanding another legendary chest');

  discovery.reset();
  assert.equal(discovery.observe('hero_died',{costly:true,resourcesAtRisk:8}),'death_teaches_risk','a costly death establishes the survival prerequisite');
  assert.equal(discovery.observe('temporal_echo_started',{resources:8}),'death_leaves_escrow','a real escrow establishes the Echo deposit');
  assert.equal(discovery.observe('temporal_echo_timer_seen',{seconds:60}),'echo_is_timed','the visible countdown establishes the time limit');
  assert.equal(discovery.observe('temporal_echo_recovered',{worldRestored:false,fullHealth:true}),null,'a degraded restore cannot claim that the world rewound');
  assert.equal(discovery.observe('temporal_echo_recovered',{worldRestored:true,fullHealth:true}),'echo_rewinds_world','a complete return proves the signature time-rewind rule');

  discovery.reset();
  discovery.note('death_teaches_risk','');
  discovery.note('death_leaves_escrow','');
  discovery.note('echo_is_timed','');
  assert.equal(discovery.observe('temporal_echo_expired',{lost:0}),null,'an empty Echo cannot claim that resources were lost');
  assert.equal(discovery.observe('temporal_echo_expired',{lost:5}),'expired_echo_loses_resources','a forfeited escrow proves the deadline consequence');

  discovery.reset();
  discovery.note('power_source_placed','');
  assert.equal(discovery.observe('power_generated',{medium:'water',amount:0}),null,'a spinning but full or non-generating dynamo is not evidence');
  assert.equal(discovery.observe('power_generated',{medium:'water',amount:0.2}),'power_generation_real','accepted generated energy proves real generation');
  assert.equal(discovery.observe('power_generated',{medium:'water',amount:0.2}),null,'repeating one medium does not prove generation variety');
  assert.equal(discovery.observe('power_generated',{medium:'wind',amount:0.1}),'power_generation_media','two distinct moving media complete the power insight');

  discovery.reset();
  assert.equal(discovery.observe('teleport_completed',{entity:'projectile',moving:true}),null,'a projectile cannot reveal the advanced portal rule before the pair is understood');
  assert.equal(discovery.observe('teleport_completed',{entity:'hero',moving:false}),'teleport_pair_transports','a completed hero jump proves the portal pair');
  assert.equal(discovery.observe('teleport_completed',{entity:'hero',moving:true}),'teleport_rotates_momentum','a moving hero proves momentum survives the portal');
  assert.equal(discovery.observe('teleport_completed',{entity:'projectile',moving:true}),'teleport_transports_projectiles','a later projectile jump completes its dedicated application');

  discovery.reset();
  assert.equal(discovery.observe('season_changed',{season:'winter'}),'seasons_change_world','the first real boundary reveals seasonal change');
  for(const season of ['spring','summer']) assert.equal(discovery.observe('season_changed',{season}),null);
  assert.equal(discovery.observe('season_changed',{season:'autumn'}),'full_season_cycle','four distinct seasons prove the complete cycle');

  discovery.reset();
  discovery.note('first_steps','');
  discovery.note('quiet_steps','');
  assert.equal(discovery.observe('hero_moved',{sprinting:true,cell:'fast-1'}),'sprint_is_audible','a real sprint establishes the loud movement contrast');
  discovery.note('blocks_can_be_mined','');
  assert.equal(discovery.observe('mining_noise',{band:'soft',hardness:4}),null,'one material cannot prove the hardness-to-noise comparison');
  assert.equal(discovery.observe('mining_noise',{band:'hard',hardness:80}),'hard_mining_is_louder','soft and hard mining prove the sound-radius rule');
  assert.equal(discovery.observe('noise_attracted_creature',{heard:true,actor:'remote-hero',target:{x:1,y:0}}),null,'a guest sound cannot teach the host profile');
  assert.equal(discovery.observe('noise_attracted_creature',{heard:true,actor:'local-hero',target:{x:1,y:0}}),'noise_attracts_creatures','a nearby creature beginning an investigation proves hearing affects AI');
  delete globalThis.player;
}

discovery.reset();
assert.equal(discovery.count(), 0, 'reset clears the journal');

console.log('discovery-sim: all assertions passed');
