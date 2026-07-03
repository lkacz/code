import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.performance = { now:()=>1000 };
globalThis.MM = { TILE:20 };
const messages = [];
globalThis.msg = text => messages.push(String(text));
globalThis.inv = { alienBiomass:0, meat:0, clay:0, masterStone:0, leaf:0, servantStone:0, water:0, ufoConcrete:0, motherIce:0, motherLava:0 };

const { T, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } = await import('../src/constants.js');
const { companions } = await import('../src/engine/companions.js');

function getTile(_x,y){
  if(y>=10) return T.GRASS;
  return T.AIR;
}
function setTile(){}
const player = {x:0,y:9.96,facing:1};

companions.reset();
const made = companions.spawnFromCraft(player,{biomass:3,meat:2,getTile});
assert.ok(made, 'crafting creates a companion when there is capacity');
assert.equal(companions.count(), 1, 'created companion is active');
let m = companions.metrics();
assert.equal(m.maxHp, 34+3*18, 'initial biomass determines max HP');

const beforeHp = m.maxHp;
assert.equal(companions.feedNearest(player,2,{refund:{alienBiomass:2,meat:1}}), true, 'nearby companion can be fed');
m = companions.metrics();
assert.equal(m.biomass, 5, 'feeding increases tracked biomass');
assert.equal(m.maxHp, beforeHp+2*18, 'feeding increases max HP by biomass amount');

const g1 = companions._debug.makeGenome(101);
const g2 = companions._debug.makeGenome(202);
const visualKeys = ['body','primary','secondary','glow','eyes','legs','tendrils','horns','plates','archetype','size','width','eyeLayout','legStyle','tail','crest','marking','glowPattern','gait','shoulder'];
const visualDiffs = visualKeys.filter(k=>g1[k]!==g2[k]).length;
assert.ok(visualDiffs>=8, 'procedural companions differ in many visible traits');

const clayGenome1 = companions._debug.makeClayGenome(111,6);
const clayGenome2 = companions._debug.makeClayGenome(222,12);
const clayVisualKeys = ['primary','secondary','highlight','head','torso','arms','eyeCount','cracks','drips','pebbles','shoulder','belly','armScale','legGap','asym','coreX','coreY','wetSheen','backSlab','rune'];
const clayDiffs = clayVisualKeys.filter(k=>clayGenome1[k]!==clayGenome2[k]).length;
assert.ok(clayDiffs>=8, 'procedural clay golems differ while keeping the wet clay silhouette');
assert.ok(/^#/.test(clayGenome1.core) && /^#/.test(clayGenome1.primary), 'clay golem genome carries clay and master-stone colors');

const leafGenome1 = companions._debug.makeLeafGenome(333,5);
const leafGenome2 = companions._debug.makeLeafGenome(444,14);
const leafVisualKeys = ['primary','secondary','edge','glow','stem','silhouette','wings','eyeCount','leaflets','tatters','veins','width','height','fan','curl','asym','flutter','antenna','seedCore'];
const leafDiffs = leafVisualKeys.filter(k=>leafGenome1[k]!==leafGenome2[k]).length;
assert.ok(leafDiffs>=8, 'procedural leaf monsters differ while keeping the leafy flying silhouette');
assert.ok(/^#/.test(leafGenome1.primary) && /^#/.test(leafGenome1.edge), 'leaf monster genome carries leaf palette colors');

const waterGenome1 = companions._debug.makeWaterGenome(555,6);
const waterGenome2 = companions._debug.makeWaterGenome(666,20);
const waterVisualKeys = ['primary','secondary','highlight','foam','core','head','torso','arms','eyeCount','bubbles','droplets','shoulder','belly','armScale','wave','swirl','coreX','coreY','transparency','crest','foamBand'];
const waterDiffs = waterVisualKeys.filter(k=>waterGenome1[k]!==waterGenome2[k]).length;
assert.ok(waterDiffs>=8, 'procedural water golems differ while keeping a watery golem silhouette');
assert.ok(/^#/.test(waterGenome1.primary) && /^#/.test(waterGenome1.core), 'water golem genome carries water and master-stone colors');

const ufoGenome1 = companions._debug.makeUfoAlienGenome(777,6,'tank');
const ufoGenome2 = companions._debug.makeUfoAlienGenome(888,12,'sniper');
const ufoVisualKeys = ['primary','secondary','glow','laser','body','alienRole','eyeLayout','legStyle','tail','crest','marking','eyes','legs','tendrils','horns','plates','size','width','iceFractures','crownShard','circuitBands'];
const ufoDiffs = ufoVisualKeys.filter(k=>ufoGenome1[k]!==ufoGenome2[k]).length;
assert.ok(ufoDiffs>=10, 'procedural UFO alien companions differ while keeping alien-team role silhouettes');
assert.equal(ufoGenome1.alienRole, 'tank', 'UFO alien genome preserves the alien-team role');
assert.ok(/^#/.test(ufoGenome1.primary) && /^#/.test(ufoGenome1.glow), 'UFO alien genome carries mother-ice and tech glow colors');

const moleGenome1 = companions._debug.makeMolekinGenome(779,6,'tank');
const moleGenome2 = companions._debug.makeMolekinGenome(889,16,'sniper');
const moleVisualKeys = ['fur','dark','deep','eye','accent','ember','moleRole','body','height','head','eyeScale','arm','leg','stance','gait','glow','helmet','snout','beard','claw','ears','braids','rankBands','soot'];
const moleDiffs = moleVisualKeys.filter(k=>moleGenome1[k]!==moleGenome2[k]).length;
assert.ok(moleDiffs>=12, 'procedural molekin companions differ while keeping the lava mole-team silhouette');
assert.equal(moleGenome1.moleRole, 'tank', 'molekin genome preserves the mole-team role');
assert.ok(/^#/.test(moleGenome1.fur) && /^#/.test(moleGenome1.accent), 'molekin genome carries fur and lava accent colors');

companions.reset();
const ritualTiles = new Map();
const rk = (x,y)=>Math.floor(x)+','+Math.floor(y);
function ritualGetTile(x,y){
  const k=rk(x,y);
  if(ritualTiles.has(k)) return ritualTiles.get(k);
  return y>=12 ? T.GRASS : T.AIR;
}
function ritualSetTile(x,y,v){
  const k=rk(x,y);
  if(v===T.AIR) ritualTiles.delete(k);
  else ritualTiles.set(k,v);
}
ritualSetTile(2,8,T.VOLCANO_MASTER_STONE);
for(const [x,y] of [[1,8],[3,8],[2,7],[2,9],[1,9],[3,9],[1,7],[3,7]]) ritualSetTile(x,y,T.WET_CLAY);
const golem = companions.tryClayGolemRitualAt(2,8,ritualGetTile,ritualSetTile,{announce:true});
assert.ok(golem, 'wet clay plus master stone ritual creates a clay golem');
assert.equal(golem.kind, 'clay_golem', 'ritual result is a clay golem companion');
assert.equal(golem.clay, 8, 'ritual mass comes from nearby wet clay cells');
assert.equal(ritualGetTile(2,8), T.AIR, 'ritual consumes the master stone');
assert.equal([...ritualTiles.values()].filter(t=>t===T.WET_CLAY).length, 0, 'ritual consumes nearby wet clay');
assert.equal(companions.metrics().golems, 1, 'metrics count clay golems separately');
assert.ok(golem.maxHp>=300, 'clay golem has tank-scale HP');
const hpBeforeGuard = golem.hp;
const guarded = companions.absorbHeroDamage(30,{cause:'mob'}, {x:golem.x+0.8,y:golem.y-0.2});
assert.ok(guarded.absorbed>20, 'nearby clay golem absorbs most hero damage');
assert.ok(guarded.amount<10, 'hero receives only the remainder after golem guard');
assert.ok(companions._debug.list()[0].hp<hpBeforeGuard, 'absorbing damage wears down the golem');
const golemSnap = companions.snapshot();
assert.equal(golemSnap.list[0].kind, 'clay_golem', 'snapshot persists golem kind');
assert.equal(golemSnap.list[0].clay, 8, 'snapshot persists clay mass');
companions.reset();
ritualTiles.clear();
ritualSetTile(20,8,T.VOLCANO_MASTER_STONE);
for(let x=21;x<=26;x++) ritualSetTile(x,8,T.WET_CLAY);
assert.equal(companions.onTileChanged(26,8,T.AIR,T.WET_CLAY,ritualGetTile,ritualSetTile), true, 'a six-wet-clay row connected to a master stone triggers when the far end is placed');
const lineGolem = companions._debug.list()[0];
assert.equal(lineGolem.kind, 'clay_golem', 'row ritual creates a clay golem');
assert.equal(lineGolem.clay, 6, 'row ritual consumes the connected six-cell wet clay body');
assert.equal(ritualGetTile(20,8), T.AIR, 'row ritual consumes the master stone');
companions.reset();
ritualTiles.clear();
ritualSetTile(-4,8,T.VOLCANO_MASTER_STONE);
for(let x=-3;x<=2;x++) ritualSetTile(x,8,T.WET_CLAY);
for(let i=0;i<45;i++) companions.update(1/30,{x:0,y:9.96,facing:1},ritualGetTile,ritualSetTile);
assert.equal(companions.metrics().golems, 1, 'nearby update scan converts an already-built wet clay row into a golem');
assert.equal(companions._debug.list()[0].clay, 6, 'update-scan ritual keeps the row body mass');
companions.reset();
ritualTiles.clear();
ritualSetTile(9,8,T.SERVANT_STONE);
for(const [x,y] of [[8,8],[10,8],[9,7],[9,9],[8,7],[10,7],[8,9],[10,9]]) ritualSetTile(x,y,T.LEAF);
const leafMonster = companions.tryLeafMonsterRitualAt(9,8,ritualGetTile,ritualSetTile,{announce:true});
assert.ok(leafMonster, 'leaf cluster plus servant stone ritual creates a leaf monster');
assert.equal(leafMonster.kind, 'leaf_monster', 'ritual result is a leaf monster companion');
assert.equal(leafMonster.leaves, 8, 'leaf monster mass comes from nearby leaf cells');
assert.ok(leafMonster.maxHp<=50, 'leaf monster has deliberately low HP');
assert.equal(ritualGetTile(9,8), T.AIR, 'leaf ritual consumes the servant stone');
assert.equal([...ritualTiles.values()].filter(t=>t===T.LEAF).length, 0, 'leaf ritual consumes nearby leaves');
assert.equal(companions.metrics().leafMonsters, 1, 'metrics count leaf monsters separately');
const leafSnap = companions.snapshot();
assert.equal(leafSnap.list[0].kind, 'leaf_monster', 'snapshot persists leaf monster kind');
assert.equal(leafSnap.list[0].leaves, 8, 'snapshot persists leaf mass');
companions.reset();
ritualTiles.clear();
ritualSetTile(-7,8,T.SERVANT_STONE);
for(let x=-6;x<=-2;x++) ritualSetTile(x,8,T.AUTUMN_LEAF_ORANGE);
for(let i=0;i<45;i++) companions.update(1/30,{x:-4,y:9.96,facing:1},ritualGetTile,ritualSetTile);
assert.equal(companions.metrics().leafMonsters, 1, 'nearby update scan converts an already-built autumn-leaf row into a leaf monster');
assert.equal(companions._debug.list()[0].leaves, 5, 'leaf update-scan ritual keeps the connected leaf mass');
companions.reset();
assert.ok(companions.spawnLeafMonsterFromCraft(player,{leaves:8,servantStone:1,getTile}), 'crafting can create a leaf monster companion');
assert.equal(companions._debug.list()[0].kind, 'leaf_monster', 'crafted leaf monster uses the leaf companion kind');
companions.reset();
ritualTiles.clear();
ritualSetTile(30,8,T.VOLCANO_MASTER_STONE);
for(let x=31;x<=55;x++) ritualSetTile(x,8,T.WATER);
const waterGolem = companions.tryWaterGolemRitualAt(30,8,ritualGetTile,ritualSetTile,{announce:true});
assert.ok(waterGolem, 'master stone dropped into a connected pool creates a water golem');
assert.equal(waterGolem.kind, 'water_golem', 'water ritual result is a water golem companion');
assert.equal(waterGolem.water, 20, 'water golem ritual mass caps at twenty water cells');
assert.equal(ritualGetTile(30,8), T.AIR, 'water ritual consumes the master stone');
assert.equal([...ritualTiles.values()].filter(t=>t===T.WATER).length, 5, 'water ritual consumes only the capped water body amount');
assert.equal(companions.metrics().waterGolems, 1, 'metrics count water golems separately');
assert.equal(companions.metrics().water, 20, 'metrics track water golem mass');
const waterSnap = companions.snapshot();
assert.equal(waterSnap.list[0].kind, 'water_golem', 'snapshot persists water golem kind');
assert.equal(waterSnap.list[0].water, 20, 'snapshot persists water mass');
companions.reset();
ritualTiles.clear();
ritualSetTile(-10,8,T.VOLCANO_MASTER_STONE);
for(let x=-9;x<=-4;x++) ritualSetTile(x,8,T.WATER);
assert.equal(companions.onTileChanged(-10,8,T.WATER,T.VOLCANO_MASTER_STONE,ritualGetTile,ritualSetTile), true, 'placing a master stone into water triggers the water golem ritual');
assert.equal(companions._debug.list()[0].water, 7, 'water ritual counts the replaced water tile plus the connected water mass');
companions.reset();
ritualTiles.clear();
ritualSetTile(-30,8,T.VOLCANO_MASTER_STONE);
for(let x=-29;x<=-25;x++) ritualSetTile(x,8,T.WATER);
assert.equal(companions.onTileChanged(-30,8,T.WATER,T.VOLCANO_MASTER_STONE,ritualGetTile,ritualSetTile), true, 'placing a master stone into an exact six-block pool counts the replaced water');
assert.equal(companions._debug.list()[0].water, 6, 'exact six-block water ritual creates a minimum water golem');
companions.reset();
ritualTiles.clear();
ritualSetTile(-40,8,T.VOLCANO_MASTER_STONE);
for(const [dx,dy] of [[1,1],[2,1],[1,2],[2,2],[3,1],[3,2]]) ritualSetTile(-40+dx,8+dy,T.WATER);
assert.ok(companions.tryWaterGolemRitualAt(-40,8,ritualGetTile,ritualSetTile,{announce:true}), 'water ritual accepts diagonal contact with a visible pool corner');
assert.equal(companions._debug.list()[0].water, 6, 'diagonal pool contact keeps the connected six-cell water mass');
companions.reset();
ritualTiles.clear();
ritualSetTile(60,8,T.VOLCANO_MASTER_STONE);
for(let x=61;x<=68;x++) ritualSetTile(x,8,T.MEAT);
const meatGolem = companions.tryMeatGolemRitualAt(60,8,ritualGetTile,ritualSetTile,{announce:true});
assert.ok(meatGolem, 'master stone plus connected raw meat creates a meat golem');
assert.equal(meatGolem.kind, 'meat_golem', 'meat ritual result is a raw meat golem companion');
assert.equal(meatGolem.meat, 8, 'meat golem mass comes from nearby meat cells');
assert.ok(meatGolem.maxHp>180, 'meat golem is a strong companion');
assert.equal(ritualGetTile(60,8), T.AIR, 'meat ritual consumes the master stone');
assert.equal([...ritualTiles.values()].filter(t=>t===T.MEAT).length, 0, 'meat ritual consumes the raw meat body');
assert.equal(companions.metrics().meatGolems, 1, 'metrics count raw meat golems separately');
assert.equal(companions.metrics().meat, 8, 'metrics track meat golem mass');
const meatSnap = companions.snapshot();
assert.equal(meatSnap.list[0].kind, 'meat_golem', 'snapshot persists meat golem kind');
assert.equal(meatSnap.list[0].meat, 8, 'snapshot persists meat mass');
companions.reset();
ritualTiles.clear();
ritualSetTile(-20,8,T.VOLCANO_MASTER_STONE);
for(let x=-19;x<=-14;x++) ritualSetTile(x,8,T.MEAT);
assert.equal(companions.onTileChanged(-14,8,T.AIR,T.MEAT,ritualGetTile,ritualSetTile), true, 'placing the sixth raw meat block triggers the meat golem ritual');
assert.equal(companions._debug.list()[0].meat, 6, 'minimum meat ritual keeps the connected six-cell mass');
companions.reset();
assert.ok(companions.spawnFromCraft(player,{biomass:3,meat:2,getTile}), 'regular companion can still be created after a clay ritual');
companions.reset();

const oldGuardianLairs = globalThis.MM.guardianLairs;
globalThis.MM.guardianLairs = {status:()=>({defeated:{fire:false, ice:false}})};
globalThis.inv.motherIce = 0;
assert.equal(companions.spawnUfoAlienFromCraft(player,{motherIce:1,getTile,role:'tank',refund:{motherIce:1}}), null, 'mother-ice alien companion waits until the west ice guardian is defeated');
assert.equal(companions.metrics().ufoAliens, 0, 'blocked mother-ice craft creates no companion');
assert.equal(globalThis.inv.motherIce, 1, 'blocked mother-ice craft refunds the ice core cost');
globalThis.inv.motherIce = 0;
globalThis.MM.guardianLairs = {status:()=>({defeated:{fire:false, ice:true}})};
const ufoCompanion = companions.spawnUfoAlienFromCraft(player,{motherIce:1,getTile,role:'tank'});
assert.ok(ufoCompanion, 'mother-ice craft creates an elite alien companion');
assert.equal(ufoCompanion.kind, 'ufo_alien', 'crafted mother-ice companion uses the UFO alien kind');
assert.equal(ufoCompanion.ufoRole, 'tank', 'crafted UFO companion can be one of the normal alien-team roles');
assert.ok(companions._debug.ufoAlienRoles.includes(ufoCompanion.ufoRole), 'UFO companion role is drawn from the alien-team role pool');
assert.ok(ufoCompanion.maxHp>companions._debug.maxHpForClay(companions._debug.clayGolemMax), 'UFO alien tank has more HP than the largest clay golem');
assert.equal(companions.metrics().ufoAliens, 1, 'metrics count UFO alien companions separately');
assert.equal(companions.metrics().motherIce, 1, 'metrics track mother-ice alien mass');
const ufoSnap = companions.snapshot();
assert.equal(ufoSnap.list[0].kind, 'ufo_alien', 'snapshot persists UFO alien kind');
assert.equal(ufoSnap.list[0].motherIce, 1, 'snapshot persists mother-ice mass');
assert.equal(ufoSnap.list[0].ufoRole, 'tank', 'snapshot persists UFO alien role');
companions.reset();
assert.equal(companions.restore(ufoSnap,getTile), true, 'restore accepts UFO alien snapshots');
assert.equal(companions._debug.list()[0].ufoRole, 'tank', 'restore rebuilds the UFO alien role');
companions.reset();
assert.ok(companions.spawnFromCraft(player,{biomass:3,meat:2,getTile}), 'regular companion can still be created after a UFO alien craft');

globalThis.MM.guardianLairs = {status:()=>({defeated:{fire:false, ice:true}})};
companions.reset();
ritualTiles.clear();
ritualSetTile(80,8,T.VOLCANO_MASTER_STONE);
for(let x=81;x<=86;x++) ritualSetTile(x,8,T.MOTHER_LAVA);
assert.equal(companions.tryMolekinRitualAt(80,8,ritualGetTile,ritualSetTile,{announce:true}), null, 'molekin lava ritual waits until the fire guardian is defeated');
assert.equal(companions.metrics().molekin, 0, 'blocked molekin ritual does not create a companion');
globalThis.MM.guardianLairs = {status:()=>({defeated:{fire:true, ice:true}})};
const molekin = companions.tryMolekinRitualAt(80,8,ritualGetTile,ritualSetTile,{announce:true,role:'tank'});
assert.ok(molekin, 'master stone plus mother lava creates a molekin companion after the fire guardian falls');
assert.equal(molekin.kind, 'molekin', 'mother-lava ritual result is a molekin companion');
assert.equal(molekin.moleRole, 'tank', 'molekin ritual can select one of the mole-team roles');
assert.equal(molekin.lava, 6, 'molekin ritual mass comes from nearby lava cells');
assert.equal(ritualGetTile(80,8), T.AIR, 'molekin ritual consumes the master stone');
assert.equal([...ritualTiles.values()].filter(t=>t===T.MOTHER_LAVA).length, 0, 'molekin ritual consumes the mother-lava body');
assert.equal([...ritualTiles.values()].filter(t=>t===T.BASALT).length, 6, 'molekin ritual cools consumed mother lava into basalt traces');
assert.equal(companions.metrics().molekin, 1, 'metrics count molekin companions separately');
assert.equal(companions.metrics().lava, 6, 'metrics track molekin lava mass');
const moleSnap = companions.snapshot();
assert.equal(moleSnap.list[0].kind, 'molekin', 'snapshot persists molekin kind');
assert.equal(moleSnap.list[0].lava, 6, 'snapshot persists molekin lava mass');
assert.equal(moleSnap.list[0].moleRole, 'tank', 'snapshot persists molekin role');
companions.reset();
assert.equal(companions.restore(moleSnap,getTile), true, 'restore accepts molekin snapshots');
assert.equal(companions._debug.list()[0].moleRole, 'tank', 'restore rebuilds the molekin role');

companions.reset();
ritualTiles.clear();
globalThis.MM.guardianLairs = {status:()=>({defeated:{fire:true, ice:true}})};
ritualSetTile(-60,8,T.VOLCANO_MASTER_STONE);
for(let x=-59;x<=-55;x++) ritualSetTile(x,8,T.MOTHER_LAVA);
assert.equal(companions.onTileChanged(-60,8,T.MOTHER_LAVA,T.VOLCANO_MASTER_STONE,ritualGetTile,ritualSetTile), true, 'placing a master stone into mother lava triggers the molekin ritual after fire guardian defeat');
assert.equal(companions._debug.list()[0].lava, 6, 'molekin ritual counts the replaced mother-lava tile plus the connected mother-lava mass');
companions.reset();
ritualTiles.clear();
ritualSetTile(-80,8,T.VOLCANO_MASTER_STONE);
for(let x=-79;x<=-75;x++) ritualSetTile(x,8,T.MOTHER_LAVA);
for(let x=-81;x>=-86;x--) ritualSetTile(x,8,T.WATER);
assert.equal(companions.onTileChanged(-80,8,T.MOTHER_LAVA,T.VOLCANO_MASTER_STONE,ritualGetTile,ritualSetTile), true, 'mother-lava replacement prioritizes the molekin ritual even if water nearby could form a water golem');
assert.equal(companions._debug.list()[0].kind, 'molekin', 'mixed mother-lava-water ritual creates a molekin, not a water golem');
assert.equal(companions.metrics().waterGolems, 0, 'mixed ritual does not steal the lava event for a water golem');
companions.reset();
ritualTiles.clear();
ritualSetTile(-90,8,T.VOLCANO_MASTER_STONE);
for(let x=-89;x<=-84;x++) ritualSetTile(x,8,T.LAVA);
assert.equal(companions.tryMolekinRitualAt(-90,8,ritualGetTile,ritualSetTile,{announce:true}), null, 'ordinary lava no longer creates a molekin after the fire guardian');
assert.equal(companions.onTileChanged(-90,8,T.LAVA,T.VOLCANO_MASTER_STONE,ritualGetTile,ritualSetTile), false, 'placing master stone into ordinary lava does not trigger the molekin ritual');
globalThis.MM.guardianLairs = oldGuardianLairs;
companions.reset();
assert.ok(companions.spawnFromCraft(player,{biomass:3,meat:2,getTile}), 'regular companion can still be created after a molekin ritual');

function traits(archetype, extraGenome={}){
  return companions._debug.traits({biomass:10, genome:Object.assign({archetype,size:1,gait:0}, extraGenome)});
}
const guardianTraits = traits('guardian');
const sniperTraits = traits('sniper');
const skirmisherTraits = traits('skirmisher');
const toxicTraits = traits('toxic');
const volatileTraits = traits('volatile');
const sentinelTraits = traits('sentinel');
assert.ok(sniperTraits.laserRange>guardianTraits.laserRange*1.35, 'sniper companion has a longer distinct engagement range');
assert.ok(sniperTraits.laserDamage>toxicTraits.laserDamage, 'sniper companion hits harder than toxic support');
assert.ok(skirmisherTraits.speed>guardianTraits.speed*1.35, 'skirmisher companion has a faster movement profile');
assert.ok(skirmisherTraits.laserCooldown<guardianTraits.laserCooldown, 'skirmisher companion fires in shorter bursts');
assert.ok(toxicTraits.poisonPower>guardianTraits.poisonPower*1.5, 'toxic companion has stronger poison behavior');
assert.ok(toxicTraits.poisonInterval<guardianTraits.poisonInterval*0.6, 'toxic companion vents poison more frequently');
assert.ok(volatileTraits.death>guardianTraits.death, 'volatile companion has a stronger death burst');
assert.ok(sentinelTraits.orbit>guardianTraits.orbit*5, 'sentinel companion has a distinct orbiting follow behavior');
const clayTankTraits = companions._debug.traits({kind:'clay_golem',clay:8,genome:{gait:0}});
assert.ok(clayTankTraits.speed<guardianTraits.speed*0.35, 'clay golem moves much slower than living companions');
assert.ok(clayTankTraits.accel<guardianTraits.accel*0.45, 'clay golem accelerates like a heavy tank companion');
const ufoTankTraits = companions._debug.traits({kind:'ufo_alien',motherIce:1,ufoRole:'tank',genome:companions._debug.makeUfoAlienGenome(990,1,'tank')});
assert.ok(ufoTankTraits.laserDamage>clayTankTraits.laserDamage*1.35, 'UFO alien tank hits harder than a clay golem tank');
assert.ok(ufoTankTraits.guardAbsorb>0, 'UFO alien tank can protect the hero as a top-tier companion');
const moleTankTraits = companions._debug.traits({kind:'molekin',lava:1,moleRole:'tank',genome:companions._debug.makeMolekinGenome(991,1,'tank')});
const moleHealerTraits = companions._debug.traits({kind:'molekin',lava:1,moleRole:'healer',genome:companions._debug.makeMolekinGenome(992,1,'healer')});
const moleSapperTraits = companions._debug.traits({kind:'molekin',lava:1,moleRole:'sapper',genome:companions._debug.makeMolekinGenome(993,1,'sapper')});
assert.ok(moleTankTraits.guardAbsorb>0.70, 'mother-lava molekin tank can guard the hero as a smart combat companion');
assert.ok(moleHealerTraits.healMult>1.5, 'mother-lava molekin healer has a dedicated strong support profile');
assert.ok(moleSapperTraits.harvest>2.4, 'mother-lava molekin sapper is especially useful for digging support');
assert.ok(companions._debug.maxHpForMolekin(1,'tank')>companions._debug.maxHpForClay(companions._debug.clayGolemMax), 'one mother-lava molekin is stronger than the largest clay golem');
assert.ok(companions._debug.maxHpForUfoAlien(1,'tank')>companions._debug.maxHpForWater(companions._debug.waterGolemMax), 'one mother-ice alien is stronger than the largest water golem');
const smallWaterTraits = companions._debug.traits({kind:'water_golem',water:6,genome:{wave:0}});
const largeWaterTraits = companions._debug.traits({kind:'water_golem',water:20,genome:{wave:0}});
assert.ok(largeWaterTraits.laserDamage>smallWaterTraits.laserDamage, 'larger water golems spray harder');
assert.ok(largeWaterTraits.laserRange>smallWaterTraits.laserRange, 'larger water golems spray farther');

const snap = companions.snapshot();
assert.equal(snap.list.length, 1, 'snapshot includes active companions');
companions.reset();
assert.equal(companions.count(), 0, 'reset clears companions');
assert.equal(companions.restore(snap,getTile), true, 'restore accepts snapshots');
assert.equal(companions.count(), 1, 'restore rebuilds active companions');

function extendedFloorTile(floorY){
  return (_x,y)=> y>=floorY ? T.GRASS : T.AIR;
}
const skyFloorY=Math.max(WORLD_MIN_Y+24,-32);
const skyCompanionY=skyFloorY-0.04;
companions.restore({v:1,list:[{x:0,y:skyCompanionY,biomass:3,hp:88,seed:913,laserCd:99,gasCd:99}]},extendedFloorTile(skyFloorY));
assert.ok(companions._debug.list()[0].y<0, 'restore keeps companions in sky-section coordinates instead of clamping to legacy y');
for(let i=0;i<12;i++) companions.update(1/30,{x:3,y:skyCompanionY,facing:1},extendedFloorTile(skyFloorY),setTile);
assert.ok(companions._debug.list()[0].y<0, 'sky-section companion update preserves extended negative y');

const deepFloorY=Math.min(WORLD_MAX_Y-24,WORLD_H+24);
const deepCompanionY=deepFloorY-0.04;
companions.restore({v:1,list:[{x:0,y:deepCompanionY,biomass:3,hp:88,seed:914,laserCd:99,gasCd:99}]},extendedFloorTile(deepFloorY));
assert.ok(companions._debug.list()[0].y>WORLD_H, 'restore keeps companions in deep-section coordinates instead of clamping to legacy bottom');
for(let i=0;i<12;i++) companions.update(1/30,{x:3,y:deepCompanionY,facing:1},extendedFloorTile(deepFloorY),setTile);
assert.ok(companions._debug.list()[0].y>WORLD_H, 'deep-section companion update preserves extended y');

companions.restore({v:1,list:[{
  x:0,y:9.96,biomass:2,hp:30,seed:909,
  genome:{body:'orb',archetype:'old-save-archetype',eyeLayout:'old-eye',legStyle:'old-leg',tail:'old-tail',crest:'old-crest',marking:'old-mark',size:99,width:-3,glowPattern:99}
}]},getTile);
const migratedGenome = companions._debug.list()[0].genome;
assert.equal(migratedGenome.body, 'orb', 'old saves preserve known visual fields');
assert.notEqual(migratedGenome.archetype, 'old-save-archetype', 'old saves get a valid companion archetype');
assert.ok(['row','stack','triad','halo','split','visor'].includes(migratedGenome.eyeLayout), 'old saves get a valid eye layout');
assert.ok(['joint','spider','stub','talon','hover','crawler'].includes(migratedGenome.legStyle), 'old saves get a valid leg style');
assert.ok(migratedGenome.size<=1.48 && migratedGenome.size>=0.72, 'old saves clamp companion size');
assert.ok(migratedGenome.width<=1.46 && migratedGenome.width>=0.72, 'old saves clamp companion width');
assert.ok(migratedGenome.glowPattern>=0 && migratedGenome.glowPattern<=4, 'old saves clamp glow pattern');
assert.equal(companions.restore(snap,getTile), true, 'restore can return to the current snapshot after migration');

const x0 = companions._debug.list()[0].x;
player.x += 6;
for(let i=0;i<40;i++) companions.update(1/30,player,getTile,setTile);
const x1 = companions._debug.list()[0].x;
assert.ok(x1>x0+0.5, 'companion walks toward the hero instead of staying static');

const originHero = {x:0,y:9.96,facing:1};
companions.restore({v:1,list:[{x:-3,y:9.96,biomass:3,hp:88,seed:709,laserCd:99,gasCd:99}]},getTile);
for(let i=0;i<45;i++) companions.update(1/30,originHero,getTile,setTile);
assert.ok(companions._debug.list()[0].x>-2.25, 'companion follows a hero at world x=0 instead of treating zero as a missing coordinate');

companions.restore({v:1,list:[{x:player.x-80,y:9.96,biomass:3,hp:88,seed:707,laserCd:99,gasCd:99}]},getTile);
const beforeAutoCatchup = companions._debug.list()[0];
companions.update(1/30,player,getTile,setTile);
const afterAutoCatchup = companions._debug.list()[0];
assert.ok(Math.abs(afterAutoCatchup.x-player.x)<4, 'abandoned companion catches up near the hero');
assert.ok(Math.abs(afterAutoCatchup.hp-(beforeAutoCatchup.hp-beforeAutoCatchup.maxHp*0.10))<0.001, 'automatic catch-up costs 10% max HP');

companions.restore({v:1,list:[{kind:'clay_golem',x:player.x-80,y:9.96,clay:8,hp:280,seed:717}]},getTile);
const beforeGolemStrain = companions._debug.list()[0];
companions.update(1/30,player,getTile,setTile);
const afterGolemStrain = companions._debug.list()[0];
assert.equal(afterGolemStrain.kind, 'clay_golem', 'far clay golem remains a golem while distance strain starts');
assert.ok(Math.abs(afterGolemStrain.x-beforeGolemStrain.x)<0.01, 'far clay golem does not reform near the hero');
assert.ok(afterGolemStrain.hp<beforeGolemStrain.hp, 'far clay golem loses health when abandoned');
for(let i=0;i<600 && companions.metrics().golems>0;i++) companions.update(0.12,player,getTile,setTile);
assert.equal(companions.metrics().golems, 0, 'abandoned clay golem eventually dies instead of respawning');

const bumpPlayer = {x:0,y:9.96,facing:1};
companions.restore({v:1,list:[
  {x:0,y:9.96,biomass:3,hp:88,seed:7171,laserCd:99,gasCd:99},
  {x:0.02,y:9.96,biomass:3,hp:88,seed:7172,laserCd:99,gasCd:99}
]},getTile);
companions.update(1/30,bumpPlayer,getTile,setTile);
let bumped = companions._debug.list();
assert.ok(Math.abs(bumped[0].x-bumped[1].x)>0.72, 'regular companions bump apart instead of overlaying');

companions.restore({v:1,list:[
  {x:0,y:9.96,biomass:3,hp:88,seed:8181,laserCd:99,gasCd:99},
  {kind:'clay_golem',x:0.03,y:9.96,clay:12,hp:360,seed:8182}
]},getTile);
companions.update(1/30,bumpPlayer,getTile,setTile);
bumped = companions._debug.list();
assert.ok(Math.abs(bumped[0].x-bumped[1].x)>0.90, 'regular companions and clay golems use their larger bodies when bumping apart');

const heroBump = {x:0,y:9.96,w:0.7,h:0.95,vx:2,vy:0,onGround:true,jumpCount:0,facing:1};
companions.restore({v:1,list:[{x:0.08,y:9.96,biomass:3,hp:88,seed:8183,laserCd:99,gasCd:99}]},getTile);
assert.equal(companions.collideHero(heroBump,1/30,getTile), true, 'hero collision resolver detects companion overlap');
const heroBumpCompanion = companions._debug.list()[0];
assert.ok(Math.abs(heroBump.x-heroBumpCompanion.x)>0.66, 'hero bumps against companions instead of overlaying them');

const heroGolemBump = {x:0,y:9.96,w:0.7,h:0.95,vx:2,vy:0,onGround:true,jumpCount:0,facing:1};
companions.restore({v:1,list:[{kind:'clay_golem',x:0.05,y:9.96,clay:12,hp:360,seed:8184,laserCd:99,gasCd:99}]},getTile);
companions.update(1/30,heroGolemBump,getTile,setTile);
const heroGolemBumpCompanion = companions._debug.list()[0];
assert.ok(Math.abs(heroGolemBump.x-heroGolemBumpCompanion.x)>0.86, 'hero and large golems separate using the golem body size');

globalThis.MM.wind = {
  speedAt(){ return 4.0; },
  exposureAt(){ return 1.0; }
};
companions.restore({v:1,list:[{kind:'leaf_monster',x:0,y:9.96,leaves:8,hp:30,seed:8282,laserCd:99}]},getTile);
const leafFlightStart = companions._debug.list()[0];
for(let i=0;i<25;i++) companions.update(1/30,{x:0,y:9.96,facing:1},getTile,setTile);
const leafFlight = companions._debug.list()[0];
assert.ok(leafFlight.y<leafFlightStart.y-0.35, 'leaf monster can fly upward toward its hover point');
assert.ok(leafFlight.x>leafFlightStart.x+0.15, 'leaf monster is strongly pushed by wind while flying');
assert.ok(leafFlight.lastWind>3.5, 'leaf monster records intense wind response for debug visibility');
globalThis.MM.wind = null;

const leafFeedTiles = new Map([['1,9', T.LEAF], ['2,9', T.AUTUMN_LEAF_RED]]);
function leafFeedTile(x,y){
  const k=x+','+y;
  if(leafFeedTiles.has(k)) return leafFeedTiles.get(k);
  if(y>=10) return T.GRASS;
  return T.AIR;
}
function leafFeedSetTile(x,y,v){
  const k=x+','+y;
  if(v===T.AIR) leafFeedTiles.delete(k);
  else leafFeedTiles.set(k,v);
}
companions.restore({v:1,list:[{kind:'leaf_monster',x:0,y:9.96,leaves:8,hp:10,seed:8381,laserCd:99}]},leafFeedTile);
companions.update(0.12,{x:0,y:9.96,facing:1},leafFeedTile,leafFeedSetTile);
const feedingLeafMonster = companions._debug.list()[0];
assert.ok(feedingLeafMonster.hp>=11.49 && feedingLeafMonster.hp<=11.51, 'low-health leaf monster heals for 5% max HP per consumed leaf');
assert.equal(leafFeedTile(1,9), T.AIR, 'leaf monster feeding consumes a real leaf block');
assert.equal(feedingLeafMonster.leafFeeding, true, 'damaged leaf monster stays in feeding mode until it recovers');
companions.restore({v:1,list:[{kind:'leaf_monster',x:0,y:9.96,leaves:8,hp:24,seed:8382,laserCd:99}]},leafFeedTile);
leafFeedTiles.set('1,9', T.LEAF);
companions.update(0.12,{x:0,y:9.96,facing:1},leafFeedTile,leafFeedSetTile);
assert.equal(leafFeedTile(1,9), T.LEAF, 'healthy leaf monster does not eat leaves just because they are nearby');
companions.restore({v:1,list:[{kind:'leaf_monster',x:0,y:9.96,leaves:8,hp:10,seed:8383,laserCd:99,leafFeedCd:0.31,leafFeedTarget:{x:2,y:9},leafFeeding:true}]},leafFeedTile);
const leafRuntimeSnapshot = companions.snapshot();
companions.restore(leafRuntimeSnapshot,leafFeedTile);
const restoredLeafRuntime = companions._debug.list()[0];
assert.equal(restoredLeafRuntime.leafFeedCd, 0.31, 'leaf monster save/restore preserves feeding cooldown');
assert.deepEqual(restoredLeafRuntime.leafFeedTarget, {x:2,y:9}, 'leaf monster save/restore preserves feeding target');
assert.equal(restoredLeafRuntime.leafFeeding, true, 'leaf monster save/restore preserves feeding mode');

companions.restore({v:1,list:[{kind:'leaf_monster',x:0,y:9.96,leaves:8,hp:30,seed:8384,laserCd:99}]},getTile);
assert.equal(companions._debug.command().mode, 'attack', 'leaf monster command starts in attack mode');
assert.equal(companions.commandAt(0,9,player), true, 'right-clicking a leaf monster first enters digging target mode');
assert.equal(companions._debug.command().mode, 'harvest', 'leaf command cycle reaches digging mode');
assert.equal(companions.commandAt(0,9,player), true, 'right-clicking a leaf monster from digging enters transport mode');
assert.equal(companions._debug.command().mode, 'transport', 'leaf command cycle reaches transport mode');
const transportSnap = companions.snapshot();
companions.restore(transportSnap,getTile);
assert.equal(companions._debug.command().mode, 'transport', 'leaf transport mode persists through save/restore');
assert.equal(companions.commandAt(0,9,player), true, 'right-clicking a leaf monster from transport returns to attack mode');
assert.equal(companions._debug.command().mode, 'attack', 'leaf command cycle returns to attack mode');

const riderHero = {x:0,y:8.63,w:0.7,h:0.95,vx:0,vy:0,onGround:false,jumpCount:2,facing:1};
companions.restore({v:1,command:{mode:'transport',transportBadgeT:5},list:[{kind:'leaf_monster',x:0,y:9.96,leaves:8,hp:30,seed:8385,laserCd:99}]},getTile);
const rideStart = companions._debug.list()[0];
for(let i=0;i<10;i++) companions.update(0.1,riderHero,getTile,setTile,{controls:{right:true,jump:true}});
const riddenLeaf = companions._debug.list()[0];
assert.ok(riddenLeaf.x>rideStart.x+0.9, 'mounted leaf monster moves under hero control');
assert.ok(riddenLeaf.y<rideStart.y-0.35, 'mounted leaf monster rises when jump/up is held');
assert.ok(Math.abs(riderHero.x-riddenLeaf.x)<0.001, 'mounted hero is carried with the leaf monster');
assert.equal(riderHero.onGround, true, 'mounted hero is treated as standing on the leaf monster');
assert.equal(riddenLeaf.transportMounted, true, 'debug state marks the leaf monster as mounted');
assert.equal(companions._debug.command().transportBadgeT, 0, 'mounted leaf transport clears the travel icon timer');
assert.ok(Math.abs((rideStart.hp-riddenLeaf.hp)-riddenLeaf.maxHp*0.10)<0.35, 'leaf transport drains 10% max HP per second while mounted');

let meatStrikeDamage = 0;
globalThis.MM.mobs = {
  nearestHostileLiving(x,y,range,opts){
    assert.equal(opts && opts.hostileOnly, true, 'meat golem hostile query stays hostile-only');
    return range>1 ? {x:x+0.7,y,hp:25,id:'MEAT_TARGET'} : null;
  },
  damageAt(tx,ty,dmg,opts){
    assert.equal(opts && opts.source, 'companion', 'meat golem melee damage is companion-sourced');
    assert.ok(dmg>10, 'meat golem melee hit is strong');
    meatStrikeDamage++;
    return true;
  }
};
companions.restore({v:1,list:[{kind:'meat_golem',x:0,y:9.96,meat:10,hp:232,seed:83810,laserCd:0}]},getTile);
companions.update(1/30,{x:0,y:9.96,facing:1},getTile,setTile);
assert.equal(meatStrikeDamage, 1, 'raw meat golem attacks hostile animals with a heavy melee strike');
globalThis.MM.mobs = null;

let zombieHeroDamage = 0;
const oldDamageHero = globalThis.damageHero;
globalThis.damageHero = (amount,opts)=>{
  assert.equal(opts && opts.cause, 'rotten_meat_golem', 'rotten meat golem uses central hero damage cause');
  zombieHeroDamage += amount;
  return true;
};
const zombieHero = {x:0.25,y:9.96,facing:1,w:0.7,h:0.95,hp:100,maxHp:100,vx:0,vy:0};
companions.restore({v:1,list:[{kind:'meat_golem',x:0,y:9.96,meat:8,hp:202,seed:83820,age:299.96,laserCd:99}]},getTile);
companions.update(0.12,zombieHero,getTile,setTile);
const rottenAfterTimer = companions._debug.list()[0];
assert.equal(rottenAfterTimer.kind, 'rotten_meat_golem', 'raw meat golem turns into a rotten zombie after five minutes');
assert.ok(zombieHeroDamage>10, 'rotten meat golem immediately attacks the hero when close');
globalThis.damageHero = oldDamageHero;

companions.restore({v:1,list:[{kind:'meat_golem',x:0,y:9.96,meat:8,hp:202,seed:83830,laserCd:99}]},getTile);
function lavaEverywhere(){ return T.LAVA; }
companions.update(0.12,{x:0,y:9.96,facing:1},lavaEverywhere,setTile);
assert.equal(companions._debug.list()[0].kind, 'fried_meat_golem', 'raw meat golem fries into an allied cooked meat golem when exposed to fire');
const friedAgedSnapshot = companions.snapshot();
friedAgedSnapshot.list[0].age = companions._debug.meatGolemRotSeconds + 1;
companions.restore(friedAgedSnapshot,getTile);
companions.update(0.12,{x:0,y:9.96,facing:1,hp:100,maxHp:100},getTile,setTile);
assert.equal(companions._debug.list()[0].kind, 'fried_meat_golem', 'cooked meat golem never rots into a zombie');

companions.restore({v:1,list:[{kind:'rotten_meat_golem',x:0,y:9.96,meat:8,hp:202,seed:83840,laserCd:99}]},getTile);
assert.equal(companions.heatAt(0,9,getTile,setTile,{element:'fire'}), true, 'direct heat API fries a rotten meat zombie golem');
assert.equal(companions._debug.list()[0].kind, 'fried_meat_golem', 'rotten meat golem becomes an allied cooked meat golem');

let friedUndergroundHits = 0;
globalThis.MM.undergroundBoss = {
  nearestForTurret(){ return {kind:'underground',x:0.8,y:9.40,hp:120}; },
  damageAt(tx,ty,dmg,opts){
    assert.equal(opts && opts.source, 'companion', 'fried meat golem damage is companion-sourced against underground boss');
    assert.ok(dmg>8, 'fried meat golem hits the underground boss with meaningful damage');
    friedUndergroundHits++;
    return true;
  }
};
companions.restore({v:1,list:[{kind:'fried_meat_golem',x:0,y:9.96,meat:8,hp:202,maxHp:202,seed:83845,laserCd:0}]},getTile);
companions.update(1/30,{x:0,y:9.96,facing:1,hp:100,maxHp:100},getTile,setTile);
assert.equal(friedUndergroundHits, 1, 'fried meat golem can fight the underground boss as an ally');
globalThis.MM.undergroundBoss = null;

const hungryHero = {x:0,y:9.96,facing:1,w:0.7,h:0.95,hp:50,maxHp:100,vx:0,vy:0};
companions.restore({v:1,list:[{kind:'fried_meat_golem',x:0,y:9.96,meat:8,hp:101,maxHp:202,seed:83850}]},getTile);
companions.update(0.12,hungryHero,getTile,setTile);
assert.equal(hungryHero.hp, 60, 'eating a half-health fried meat golem restores 10 percent of hero max HP');
assert.equal(companions.count(), 0, 'fried meat golem is consumed on wounded hero bump');

const fullHero = {x:0,y:9.96,facing:1,w:0.7,h:0.95,hp:100,maxHp:100,vx:0,vy:0};
companions.restore({v:1,list:[{kind:'fried_chicken',x:0,y:9.96,meat:8,seed:83855}]},getTile);
companions.update(0.12,fullHero,getTile,setTile);
assert.equal(companions._debug.list()[0].kind, 'fried_meat_golem', 'legacy fried chicken saves migrate into fried meat golems');
assert.equal(companions.count(), 1, 'full-health hero does not accidentally eat a fried meat golem');

companions.restore({v:1,list:[{kind:'water_golem',x:0,y:9.96,water:10,hp:180,seed:8383,laserCd:99}]},getTile);
const dryWaterGolemStart = companions._debug.list()[0];
for(let i=0;i<20;i++) companions.update(0.12,{x:0,y:9.96,facing:1},getTile,setTile);
const dryWaterGolem = companions._debug.list()[0];
assert.ok(dryWaterGolem.hp<dryWaterGolemStart.hp-20, 'water golem dries quickly while outside water');

const drinkTiles = new Map([['1,9', T.WATER]]);
function drinkTile(x,y){
  const k=x+','+y;
  if(drinkTiles.has(k)) return drinkTiles.get(k);
  if(y>=10) return T.GRASS;
  return T.AIR;
}
function drinkSetTile(x,y,v){
  const k=x+','+y;
  if(v===T.AIR) drinkTiles.delete(k);
  else drinkTiles.set(k,v);
}
companions.restore({v:1,list:[{kind:'water_golem',x:0,y:9.96,water:10,hp:80,seed:8484,laserCd:99}]},drinkTile);
companions.update(0.12,{x:0,y:9.96,facing:1},drinkTile,drinkSetTile);
const drinkingWaterGolem = companions._debug.list()[0];
assert.ok(drinkingWaterGolem.hp>100, 'water golem consumes nearby water to recover health');
assert.equal(drinkTile(1,9), T.AIR, 'water golem drinking consumes a real water block');
companions.restore({v:1,list:[{kind:'water_golem',x:0,y:9.96,water:10,hp:120,seed:8485,laserCd:99,waterDrinkCd:0.44,wateredT:1.2}]},drinkTile);
const waterRuntimeSnapshot = companions.snapshot();
companions.restore(waterRuntimeSnapshot,drinkTile);
const restoredWaterRuntime = companions._debug.list()[0];
assert.equal(restoredWaterRuntime.waterDrinkCd, 0.44, 'water golem save/restore preserves drinking cooldown');
assert.equal(restoredWaterRuntime.wateredT, 1.2, 'water golem save/restore preserves recent-water state');

let extinguished = 0;
globalThis.MM.fire = {
  isBurning(x,y){ return x===3 && y===9 && extinguished===0; },
  extinguish(x,y){ if(x===3 && y===9 && extinguished===0){ extinguished++; return true; } return false; }
};
globalThis.MM.weapons = { spawnExternalStream(){ return 1; } };
let fireTestMobDamage = 0;
globalThis.MM.mobs = {
  nearestHostileLiving(){ return {x:2,y:9.2,hp:20,id:'SHOULD_WAIT'}; },
  damageAt(){ fireTestMobDamage++; return true; },
  douseRadius(){ return 1; }
};
companions.restore({v:1,list:[{kind:'water_golem',x:0,y:9.96,water:12,hp:220,seed:8585,laserCd:0}]},getTile);
companions.update(1/30,{x:0,y:9.96,facing:1},getTile,setTile);
assert.equal(extinguished, 1, 'water golem prioritizes extinguishing visible fire');
assert.equal(fireTestMobDamage, 0, 'water golem does not attack a hostile before putting out visible fire');

globalThis.MM.fire = null;
let waterSprayDamage = 0;
let waterDouses = 0;
globalThis.MM.mobs = {
  nearestHostileLiving(x,y,range,opts){
    assert.equal(opts && opts.hostileOnly, true, 'water golem hostile query stays hostile-only');
    if(range<1.5) return null;
    return {x:x+2,y,hp:20,id:'WATER_TARGET'};
  },
  damageAt(tx,ty,dmg,opts){
    assert.equal(opts && opts.source, 'companion', 'water golem spray damage is companion-sourced');
    assert.ok(dmg>3, 'water golem spray has meaningful impact');
    waterSprayDamage++;
    return true;
  },
  douseRadius(){ waterDouses++; return 1; }
};
companions.restore({v:1,list:[{kind:'water_golem',x:0,y:9.96,water:12,hp:220,seed:8686,laserCd:0}]},getTile);
companions.update(1/30,{x:0,y:9.96,facing:1},getTile,setTile);
assert.equal(waterSprayDamage, 1, 'water golem attacks hostile animals with a water spray');
assert.ok(waterDouses>=1, 'water golem spray douses burning creatures around the target');
globalThis.MM.weapons = null;
globalThis.MM.mobs = null;
globalThis.MM.fire = null;

let molekinFireDamage = 0;
let molekinIgnites = 0;
globalThis.MM.mobs = {
  nearestHostileLiving(x,y,range,opts){
    assert.equal(opts && opts.hostileOnly, true, 'molekin hostile query stays hostile-only');
    if(range<2) return null;
    return {x:x+2,y,hp:60,id:'MOLEKIN_TARGET'};
  },
  damageAt(tx,ty,dmg,opts){
    assert.equal(opts && opts.source, 'companion', 'molekin fire damage is companion-sourced');
    assert.ok(dmg>14, 'molekin fire attack has high combat impact');
    molekinFireDamage++;
    return true;
  },
  igniteRadius(x,y,r,opts){
    assert.equal(opts && opts.hostileOnly, true, 'molekin ignition is hostile-only');
    molekinIgnites++;
    return 1;
  }
};
companions.restore({v:1,list:[{kind:'molekin',x:0,y:9.96,lava:12,moleRole:'sapper',hp:608,seed:87860,laserCd:0}]},getTile);
companions.update(1/30,{x:0,y:9.96,facing:1,hp:100,maxHp:100},getTile,setTile);
assert.equal(molekinFireDamage, 1, 'molekin companion attacks hostile animals with fire/lava');
assert.ok(molekinIgnites>=1, 'molekin fire attack adds hostile-only ignition pressure');

globalThis.MM.mobs = null;
const woundedHeroForMole = {x:0.5,y:9.96,facing:1,hp:40,maxHp:100};
companions.restore({v:1,list:[{kind:'molekin',x:0,y:9.96,lava:12,moleRole:'healer',hp:560,seed:87861,laserCd:99,attackCd:0}]},getTile);
companions.update(1/30,woundedHeroForMole,getTile,setTile);
assert.ok(woundedHeroForMole.hp>40, 'molekin healer actively heals a wounded hero in combat mode');

companions.restore({v:1,list:[{kind:'molekin',x:0,y:9.96,lava:12,moleRole:'tank',hp:790,seed:87862,laserCd:99}]},getTile);
const moleTank = companions._debug.list()[0];
const moleGuarded = companions.absorbHeroDamage(40,{cause:'mob'}, {x:moleTank.x+0.6,y:moleTank.y-0.3});
assert.ok(moleGuarded.absorbed>24, 'molekin tank absorbs a large chunk of hero damage');
assert.ok(companions._debug.list()[0].hp<moleTank.hp, 'molekin guard absorption costs the tank health');

function assertWalkingGolemFlatTravel(raw,label){
  companions.restore({v:1,list:[raw]},getTile);
  const startX = companions._debug.list()[0].x;
  let minY = Infinity;
  for(let i=0;i<90;i++){
    companions.update(1/30,{x:5,y:9.96,facing:1},getTile,setTile);
    const active = companions._debug.list()[0];
    assert.ok(active, label+' remains active while walking');
    minY = Math.min(minY, active.y);
  }
  const walked = companions._debug.list()[0];
  assert.ok(minY>9.78, label+' walks on flat ground without bunny hopping');
  assert.ok(walked.x>startX+0.45, label+' still travels forward while grounded');
}
assertWalkingGolemFlatTravel({kind:'clay_golem',x:0,y:9.96,clay:8,hp:320,seed:8787,laserCd:99}, 'clay golem');
assertWalkingGolemFlatTravel({kind:'water_golem',x:0,y:9.96,water:10,hp:220,seed:8788,laserCd:99}, 'water golem');
assertWalkingGolemFlatTravel({kind:'meat_golem',x:0,y:9.96,meat:10,hp:232,seed:8789,laserCd:99}, 'meat golem');
assertWalkingGolemFlatTravel({kind:'molekin',x:0,y:9.96,lava:10,moleRole:'flanker',hp:550,seed:8790,laserCd:99}, 'molekin companion');

companions.restore({v:1,list:[{x:0,y:9.96,biomass:3,hp:88,seed:8790,laserCd:99,gasCd:99}]},getTile);
const enemyTargetableCompanion = companions.nearestForEnemy(0,9.35,3);
assert.equal(enemyTargetableCompanion && enemyTargetableCompanion.kind, 'companion', 'enemy systems can locate a live companion target');
assert.equal(companions.damageAtWorld(0,9.35,11,{source:'mob',srcX:-1,srcY:9.35}), true, 'enemy systems can damage a companion at world coordinates');
assert.ok(companions._debug.list()[0].hp<88, 'world-coordinate enemy damage reduces companion HP');
companions.restore({v:1,list:[{x:0,y:9.96,biomass:3,hp:88,seed:87901,laserCd:99,gasCd:99}]},getTile);
assert.equal(companions.nearestForEnemy(NaN,9.35,3), null, 'enemy companion lookup ignores invalid x coordinates');
assert.equal(companions.nearestForEnemy(0,NaN,3), null, 'enemy companion lookup ignores invalid y coordinates');
assert.equal(companions.damageAtWorld(NaN,9.35,999,{source:'mob'}), false, 'world-coordinate companion damage ignores invalid x coordinates');
assert.equal(companions.damageAtWorld(0,NaN,999,{source:'mob'}), false, 'world-coordinate companion damage ignores invalid y coordinates');
assert.equal(companions.damageAt(NaN,9,999), false, 'tile-coordinate companion damage ignores invalid x coordinates');
assert.equal(companions._debug.list()[0].hp, 88, 'invalid enemy coordinates cannot damage the first companion by accident');

function steppedPathTile(x,y){
  if(x<=1 && y>=10) return T.GRASS;
  if(x===2 && y>=9) return T.GRASS;
  if(x===3 && y>=8) return T.GRASS;
  if(x>=4 && y>=8) return T.GRASS;
  return T.AIR;
}
companions.restore({v:1,list:[{x:0.5,y:9.96,biomass:3,hp:88,seed:9001,laserCd:99,gasCd:99}]},steppedPathTile);
for(let i=0;i<240;i++) companions.update(1/30,{x:6,y:7.96,facing:1},steppedPathTile,setTile);
const steppedPathCompanion = companions._debug.list()[0];
assert.ok(steppedPathCompanion.x>3.8 && steppedPathCompanion.y<8.5, 'lightweight local pathing follows a stepped route to an elevated target');

companions.restore({v:1,list:[{kind:'clay_golem',x:0.5,y:9.96,clay:8,hp:320,seed:818}]},getTile);
const ledge = new Map([['2,9', T.STONE]]);
function ledgeTile(x,y){
  const k=x+','+y;
  if(ledge.has(k)) return ledge.get(k);
  if(y>=10) return T.GRASS;
  return T.AIR;
}
let ledgeBreaks = 0;
let ledgeMinY = Infinity;
for(let i=0;i<170;i++){
  companions.update(1/30,{x:5,y:9.96,facing:1},ledgeTile,setTile,{breakTile(){ ledgeBreaks++; return false; }});
  const activeLedgeGolem = companions._debug.list()[0];
  if(activeLedgeGolem) ledgeMinY = Math.min(ledgeMinY, activeLedgeGolem.y);
}
const ledgeGolem = companions._debug.list()[0];
assert.ok(ledgeGolem.x>1.4 && ledgeMinY<9.4, 'clay golem can step onto a one-block obstacle');
assert.equal(ledgeBreaks, 0, 'one-block ledges are climbed instead of smashed');

companions.restore({v:1,list:[{kind:'clay_golem',x:0.5,y:9.96,clay:8,hp:320,seed:919}]},getTile);
const wall = new Map([['2,9', T.WOOD], ['2,8', T.WOOD]]);
function wallTile(x,y){
  const k=x+','+y;
  if(wall.has(k)) return wall.get(k);
  if(y>=10) return T.GRASS;
  return T.AIR;
}
let wallBreaks = 0;
let wallBreakFrame = -1;
let wallMinY = Infinity;
for(let i=0;i<320 && wallBreaks===0;i++){
  companions.update(1/30,{x:5,y:9.96,facing:1},wallTile,setTile,{
    breakTile(x,y,expected,c){
      assert.equal(expected, T.WOOD, 'golem path break asks to break the blocking wood tile');
      assert.equal(c.kind, 'clay_golem', 'path breaking is performed by the clay golem');
      wall.delete(x+','+y);
      wallBreaks++;
      wallBreakFrame = i;
      return true;
    }
  });
  const activeWallGolem = companions._debug.list()[0];
  if(activeWallGolem) wallMinY = Math.min(wallMinY, activeWallGolem.y);
}
assert.ok(wallMinY<9.75, 'clay golem jumps before breaking a tall obstacle');
assert.ok(wallBreakFrame>35, 'clay golem waits until after a failed jump attempt before breaking a path');
assert.ok(wallBreaks>=1, 'clay golem breaks a blocking wooden/tree obstacle while following');

companions.restore({v:1,list:[{x:player.x-1,y:9.96,biomass:3,hp:88,seed:808,laserCd:99,gasCd:99}]},getTile);
const clippedStart = companions._debug.list()[0];
const clipX = Math.floor(clippedStart.x);
const clipY = Math.floor(clippedStart.y-0.55);
function clippedByCollapseTile(x,y){
  if(x===clipX && y===clipY) return T.STONE;
  if(y>=10) return T.GRASS;
  return T.AIR;
}
companions.update(1/30,player,clippedByCollapseTile,setTile);
const clippedAfter = companions._debug.list()[0];
assert.ok(Math.floor(clippedAfter.x)!==clipX || Math.floor(clippedAfter.y-0.55)!==clipY, 'companion squeezed out of a newly occupied collapse cell');
assert.equal(Math.round(clippedAfter.hp), 88, 'one-cell collapse escape does not leave the companion stuck taking damage');

companions.restore({v:1,list:[{x:player.x-1,y:9.96,biomass:3,hp:88,seed:909,laserCd:99,gasCd:99}]},getTile);
const buriedStart = companions._debug.list()[0];
const buriedX = Math.floor(buriedStart.x);
const buriedY = Math.floor(buriedStart.y-0.55);
function buriedByCollapseTile(x,y){
  if(Math.abs(x-buriedX)<=4 && y>=buriedY-3 && y<=buriedY+1) return T.STONE;
  if(y>=10) return T.GRASS;
  return T.AIR;
}
companions.update(0.12,player,buriedByCollapseTile,setTile);
const buriedAfterHit = companions._debug.list()[0];
assert.ok(buriedAfterHit.hp<buriedStart.hp, 'fully buried companion takes crushing damage');
for(let i=0;i<60 && companions.count()>0;i++) companions.update(0.12,player,buriedByCollapseTile,setTile);
assert.equal(companions.count(), 0, 'fully buried companion eventually dies instead of remaining stuck forever');

let damaged = 0;
let poisonAdds = 0;
let poisonRadius = 0;
let blasts = 0;
globalThis.MM.gases = {
  add(kind,x,y,opts){
    assert.equal(kind, 'poison', 'companion emits poison gas');
    assert.ok(Number.isFinite(x) && Number.isFinite(y), 'gas emission has coordinates');
    assert.ok(opts && opts.power>0, 'gas emission carries power');
    poisonAdds++;
    return 1;
  }
};
let passiveHostileQueries = 0;
let passiveLivingQueries = 0;
let passiveDamage = 0;
globalThis.MM.mobs = {
  nearestHostileLiving(){
    passiveHostileQueries++;
    return null;
  },
  nearestLiving(){
    passiveLivingQueries++;
    return {x:player.x+2,y:player.y,hp:20,id:'PASSIVE_DEER'};
  },
  damageAt(){
    passiveDamage++;
    return true;
  },
  poisonRadius(){ return 0; },
  blastRadius(){ return 0; }
};
globalThis.MM.particles = { spawnBurst(){}, spawnSparks(){} };
globalThis.MM.audio = { play(){} };

companions.restore({v:1,list:[{x:player.x-1,y:9.96,biomass:6,hp:142,seed:302,laserCd:0,gasCd:99}]},getTile);
companions.update(1/30,player,getTile,setTile);
assert.ok(passiveHostileQueries>=1, 'companion asks the mob system for hostile animals');
assert.equal(passiveLivingQueries, 0, 'companion does not fall back to passive living animals when hostile lookup exists');
assert.equal(passiveDamage, 0, 'companion does not attack passive animals');

globalThis.MM.mobs = {
  nearestHostileLiving(x,y,range,opts){
    assert.ok(range>=0.9, 'companion asks for nearby hostile targets');
    assert.equal(opts && opts.hostileOnly, true, 'companion target query is hostile-only');
    assert.equal(opts && opts.preferHeroFocus, true, 'companion asks mobs to prioritize hero-attacked targets');
    return range>1.5 ? {x:x+3,y:y,hp:20,id:'QA_MOB'} : null;
  },
  damageAt(tx,ty,dmg){
    assert.ok(Number.isInteger(tx) && Number.isInteger(ty), 'laser damage is tile addressed');
    assert.ok(dmg>5, 'laser damage is meaningful');
    damaged++;
    return true;
  },
  poisonRadius(x,y,r,opts){ assert.equal(opts && opts.hostileOnly, true, 'companion poison affects hostile mobs only'); poisonRadius++; return 1; },
  blastRadius(x,y,r,dmg,opts){ assert.equal(opts && opts.hostileOnly, true, 'companion death blast affects hostile mobs only'); blasts++; return 1; }
};

companions.restore({v:1,list:[{x:player.x-1,y:9.96,biomass:6,hp:142,seed:303,laserCd:0,gasCd:99}]},getTile);
companions.update(1/30,player,getTile,setTile);
assert.ok(damaged>=1, 'companion laser damages hostile mobs');
assert.ok(companions.metrics().lasers>=1, 'laser shots are tracked for rendering');

companions.restore({v:1,list:[{x:player.x-1,y:9.96,biomass:4,hp:106,seed:404,laserCd:99,gasCd:0}]},getTile);
companions.update(1/30,player,getTile,setTile);
assert.ok(poisonAdds>=1 && poisonRadius>=1, 'companion emits poison gas and poisons nearby mobs');

companions.restore({v:1,list:[{x:player.x-1,y:9.96,biomass:5,hp:10,seed:505,laserCd:99,gasCd:99}]},getTile);
const c = companions._debug.list()[0];
assert.equal(companions.damageAt(Math.floor(c.x),Math.floor(c.y-0.5),99), true, 'direct damage can kill companion');
assert.equal(companions.count(), 0, 'dead companion disappears permanently');
assert.ok(blasts>=1, 'dead companion creates a light blast');
assert.ok(messages.some(text=>text.includes('rozpadl')), 'death is announced');

companions.reset();
globalThis.inv.alienBiomass = 7;
globalThis.inv.meat = 7;
for(let i=0;i<3;i++) assert.ok(companions.spawnFromCraft(player,{biomass:3,meat:2,getTile}), 'capacity allows three companions');
const failed = companions.spawnFromCraft(player,{biomass:3,meat:2,getTile,refund:{alienBiomass:3,meat:2}});
assert.equal(failed, null, 'capacity blocks extra companions');
assert.equal(globalThis.inv.alienBiomass, 10, 'failed craft refunds alien biomass');
assert.equal(globalThis.inv.meat, 9, 'failed craft refunds meat');

companions.reset();
for(let i=0;i<3;i++) assert.ok(companions._debug.spawn(player,3,getTile), 'debug spawn fills capacity');
const debugCapacityOldest = companions._debug.list()[0].id;
assert.ok(companions._debug.spawn(player,5,getTile), 'debug spawn makes room when capacity is full');
assert.equal(companions.count(), 3, 'debug spawn replacement does not exceed companion capacity');
assert.notEqual(companions._debug.list()[0].id, debugCapacityOldest, 'debug spawn removes the oldest companion when making room');
assert.equal(companions.metrics().biomass, 11, 'debug spawn replacement preserves the expected remaining biomass total');
companions.reset();
assert.ok(companions._debug.spawn(player,8,getTile), 'debug API can spawn a companion');
assert.ok(companions._debug.feed(player,3), 'debug API can feed without spending inventory');
assert.equal(companions.metrics().biomass, 11, 'debug feeding uses the same biomass growth model');
assert.ok(companions._debug.setBiomass(player,14), 'debug API can set biomass for boundary testing');
assert.equal(companions.metrics().biomass, 14, 'debug biomass override updates metrics');
assert.ok(companions._debug.heal(player), 'debug API can heal the nearest companion');
assert.ok(companions._debug.damageNearest(player,5), 'debug API can damage the nearest companion');
const beforeDebugTeleport = companions._debug.list()[0];
assert.ok(companions._debug.teleportToHero(player,getTile), 'debug API can teleport companion back to hero');
const afterDebugTeleport = companions._debug.list()[0];
assert.ok(Math.abs(afterDebugTeleport.hp-(beforeDebugTeleport.hp-beforeDebugTeleport.maxHp*0.10))<0.001, 'debug teleport-to-hero costs 10% max HP');
assert.ok(companions._debug.forceGas(player,getTile,setTile), 'debug API can force poison gas');
assert.ok(companions._debug.forceLaser(player,getTile), 'debug API can force a laser when a target exists');
assert.ok(companions._debug.kill(player), 'debug API can kill companion through normal death path');
assert.equal(companions.count(), 0, 'debug kill removes the companion');
assert.ok(companions._debug.spawn(player,4,getTile), 'debug API can spawn after a kill');
assert.ok(companions._debug.clear(), 'debug API can clear all companions');
assert.equal(companions.count(), 0, 'debug clear removes all companions');

for(let i=0;i<3;i++) assert.ok(companions._debug.spawn(player,3,getTile), 'debug setup fills companion capacity');
assert.ok(companions._debug.spawnGolem(player,12,getTile), 'debug API can spawn a clay golem directly');
assert.equal(companions.metrics().golems, 1, 'debug-spawned clay golem is tracked in metrics');
assert.equal(companions.metrics().clay, 12, 'debug-spawned clay golem records its clay mass');
assert.equal(companions.count(), 3, 'debug golem spawn makes room instead of exceeding companion capacity');
const debugGolemHp = companions._debug.list().find(c=>c.kind==='clay_golem').maxHp;
assert.ok(companions._debug.setClay(player,15), 'debug API can tune clay golem mass');
assert.equal(companions.metrics().clay, 15, 'debug clay override updates metrics');
assert.ok(companions._debug.list().find(c=>c.kind==='clay_golem').maxHp>debugGolemHp, 'increasing debug clay mass increases golem max HP');
assert.ok(companions._debug.guardHero(player,40)?.absorbed>0, 'debug API can simulate golem guard absorption');
assert.ok(companions._debug.shieldGolem(player), 'debug API can force a clay golem shield pulse');
assert.ok(companions._debug.forceGolemStrike(player,getTile), 'debug API can force a clay golem melee strike');
const debugGolemForKill = companions._debug.list().find(c=>c.kind==='clay_golem');
player.x=debugGolemForKill.x; player.y=debugGolemForKill.y;
assert.ok(companions._debug.kill(player), 'debug API can kill the clay golem through normal death path');
assert.equal(companions.metrics().golems, 0, 'debug golem kill removes the golem');
assert.ok(companions._debug.clear(), 'debug API can clear remaining companions after golem tests');
player.x=0; player.y=9.96;

for(let i=0;i<3;i++) assert.ok(companions._debug.spawn(player,3,getTile), 'debug setup fills capacity for leaf monster replacement');
assert.ok(companions._debug.spawnLeafMonster(player,10,getTile), 'debug API can spawn a leaf monster directly');
assert.equal(companions.metrics().leafMonsters, 1, 'debug-spawned leaf monster is tracked in metrics');
assert.equal(companions.metrics().leaves, 10, 'debug-spawned leaf monster records its leaf mass');
assert.equal(companions.count(), 3, 'debug leaf monster spawn makes room instead of exceeding companion capacity');
const debugLeafHp = companions._debug.list().find(c=>c.kind==='leaf_monster').maxHp;
assert.ok(debugLeafHp<=50, 'debug leaf monster keeps low HP');
assert.ok(companions._debug.setLeaves(player,14), 'debug API can tune leaf monster mass');
assert.equal(companions.metrics().leaves, 14, 'debug leaf mass override updates metrics');
assert.ok(companions._debug.list().find(c=>c.kind==='leaf_monster').maxHp>debugLeafHp, 'increasing debug leaf mass increases leaf monster max HP slightly');
const debugLeafForShot = companions._debug.list().find(c=>c.kind==='leaf_monster');
player.x=debugLeafForShot.x; player.y=debugLeafForShot.y;
assert.ok(companions._debug.forceLaser(player,getTile), 'debug API can force a leaf monster shot when a target exists');
const debugLeafForKill = companions._debug.list().find(c=>c.kind==='leaf_monster');
player.x=debugLeafForKill.x; player.y=debugLeafForKill.y;
assert.ok(companions._debug.kill(player), 'debug API can kill the leaf monster through normal death path');
assert.equal(companions.metrics().leafMonsters, 0, 'debug leaf monster kill removes the leaf monster');
assert.ok(companions._debug.clear(), 'debug API can clear remaining companions after leaf tests');
player.x=0; player.y=9.96;

for(let i=0;i<3;i++) assert.ok(companions._debug.spawn(player,3,getTile), 'debug setup fills capacity for water golem replacement');
assert.ok(companions._debug.spawnWaterGolem(player,12,getTile), 'debug API can spawn a water golem directly');
assert.equal(companions.metrics().waterGolems, 1, 'debug-spawned water golem is tracked in metrics');
assert.equal(companions.metrics().water, 12, 'debug-spawned water golem records its water mass');
assert.equal(companions.count(), 3, 'debug water golem spawn makes room instead of exceeding companion capacity');
const debugWaterHp = companions._debug.list().find(c=>c.kind==='water_golem').maxHp;
assert.ok(companions._debug.setWater(player,18), 'debug API can tune water golem mass');
assert.equal(companions.metrics().water, 18, 'debug water mass override updates metrics');
assert.ok(companions._debug.list().find(c=>c.kind==='water_golem').maxHp>debugWaterHp, 'increasing debug water mass increases water golem max HP');
const debugWaterForSpray = companions._debug.list().find(c=>c.kind==='water_golem');
globalThis.MM.fire = { isBurning(x,y){ return x===Math.floor(debugWaterForSpray.x)+2 && y===Math.floor(debugWaterForSpray.y-0.6); }, extinguish(){ return true; } };
assert.ok(companions._debug.forceWaterSpray(player,getTile), 'debug API can force a water golem spray at fire or a target');
globalThis.MM.fire = null;
const debugWaterForKill = companions._debug.list().find(c=>c.kind==='water_golem');
player.x=debugWaterForKill.x; player.y=debugWaterForKill.y;
assert.ok(companions._debug.kill(player), 'debug API can kill the water golem through normal death path');
assert.equal(companions.metrics().waterGolems, 0, 'debug water golem kill removes the golem');
assert.ok(companions._debug.clear(), 'debug API can clear remaining companions after water tests');
player.x=0; player.y=9.96;

for(let i=0;i<3;i++) assert.ok(companions._debug.spawn(player,3,getTile), 'debug setup fills capacity for meat golem replacement');
assert.ok(companions._debug.spawnMeatGolem(player,10,getTile), 'debug API can spawn a meat golem directly');
assert.equal(companions.metrics().meatGolems, 1, 'debug-spawned meat golem is tracked in metrics');
assert.equal(companions.metrics().meat, 10, 'debug-spawned meat golem records its meat mass');
assert.equal(companions.count(), 3, 'debug meat golem spawn makes room instead of exceeding companion capacity');
const debugMeatHp = companions._debug.list().find(c=>c.kind==='meat_golem').maxHp;
assert.ok(companions._debug.setMeat(player,16), 'debug API can tune meat golem mass');
assert.equal(companions.metrics().meat, 16, 'debug meat mass override updates metrics');
assert.ok(companions._debug.list().find(c=>c.kind==='meat_golem').maxHp>debugMeatHp, 'increasing debug meat mass increases meat golem max HP');
assert.ok(companions._debug.rotMeatGolem(player), 'debug API can rot a meat golem into a zombie');
assert.equal(companions.metrics().rottenMeatGolems, 1, 'debug-rotted meat golem is tracked as zombie');
assert.ok(companions._debug.cookMeatGolem(player), 'debug API can cook a meat or zombie golem into a fried ally');
assert.equal(companions.metrics().friedMeatGolems, 1, 'debug-cooked meat golem is tracked as a fried meat golem');
const debugFried = companions._debug.list().find(c=>c.kind==='fried_meat_golem');
player.x=debugFried.x; player.y=debugFried.y;
assert.ok(companions._debug.kill(player), 'debug API can remove fried meat golem through normal death path');
assert.equal(companions.metrics().friedMeatGolems, 0, 'debug fried meat golem kill removes the ally');
assert.ok(companions._debug.clear(), 'debug API can clear remaining companions after meat tests');
player.x=0; player.y=9.96;

for(let i=0;i<3;i++) assert.ok(companions._debug.spawn(player,3,getTile), 'debug setup fills capacity for molekin replacement');
assert.ok(companions._debug.spawnMolekin(player,12,getTile,'sapper'), 'debug API can spawn a molekin companion directly');
assert.equal(companions.metrics().molekin, 1, 'debug-spawned molekin is tracked in metrics');
assert.equal(companions.metrics().lava, 12, 'debug-spawned molekin records its lava mass');
assert.equal(companions.count(), 3, 'debug molekin spawn makes room instead of exceeding companion capacity');
const debugMoleHp = companions._debug.list().find(c=>c.kind==='molekin').maxHp;
assert.ok(companions._debug.setLava(player,18), 'debug API can tune molekin lava mass');
assert.equal(companions.metrics().lava, 18, 'debug molekin lava override updates metrics');
assert.ok(companions._debug.list().find(c=>c.kind==='molekin').maxHp>debugMoleHp, 'increasing debug lava mass increases molekin max HP');
const debugMoleForFire = companions._debug.list().find(c=>c.kind==='molekin');
player.x=debugMoleForFire.x; player.y=debugMoleForFire.y;
globalThis.MM.mobs = {
  nearestHostileLiving(x,y){ return {x:x+2,y,hp:30,id:'DEBUG_MOLE_TARGET'}; },
  damageAt(){ return true; }
};
assert.ok(companions._debug.forceMolekinFire(player,getTile,setTile), 'debug API can force a molekin fire strike');
globalThis.MM.mobs = null;
assert.ok(companions._debug.kill(player), 'debug API can kill the molekin through normal death path');
assert.equal(companions.metrics().molekin, 0, 'debug molekin kill removes the ally');
assert.ok(companions._debug.clear(), 'debug API can clear remaining companions after molekin tests');
player.x=0; player.y=9.96;

companions.restore({v:1,list:[{x:0,y:9.96,biomass:3,hp:88,seed:1001,laserCd:0,gasCd:0}]},getTile);
const harvestCompanion = companions._debug.list()[0];
assert.equal(companions.commandAt(Math.floor(harvestCompanion.x),Math.floor(harvestCompanion.y-0.55),player), true, 'right-click style command toggles a nearby companion squad');
assert.equal(companions.awaitingHarvestTarget(), true, 'harvest command starts in target-pick mode');
assert.equal(companions._debug.command().mode, 'harvest', 'command mode switches from attack to harvest');
assert.equal(companions.assignHarvestTarget(T.STONE,'Skala'), true, 'clicked material becomes the companion harvest target');
assert.equal(companions.awaitingHarvestTarget(), false, 'assigning a material clears the question-mark target-pick state');
assert.ok(companions._debug.command().harvestBadgeT>4.8, 'assigning a harvest material starts a visible pickaxe badge timer');
for(let i=0;i<40;i++) companions.update(0.12,player,getTile,setTile);
assert.ok(companions._debug.command().harvestBadgeT>0, 'pickaxe badge remains visible before five seconds expire');
for(let i=0;i<4;i++) companions.update(0.12,player,getTile,setTile);
assert.equal(companions._debug.command().harvestBadgeT, 0, 'pickaxe badge vanishes after five seconds');
const harvestSnapshot = companions.snapshot();
companions.restore(harvestSnapshot,getTile);
assert.equal(companions._debug.command().harvestTile, T.STONE, 'harvest command survives save/restore');
assert.equal(companions._debug.command().fightBadgeT, 0, 'harvest mode does not keep the fight badge timer active');
const harvestTiles = new Map([['0,8', T.STONE]]);
function getHarvestTile(x,y){
  const k=x+','+y;
  if(harvestTiles.has(k)) return harvestTiles.get(k);
  if(y>=10) return T.GRASS;
  return T.AIR;
}
let companionBreaks = 0;
let harvestModeShots = 0;
globalThis.MM.mobs = {
  nearestLiving(){ return {x:1,y:8,hp:20,id:'IGNORED_IN_HARVEST'}; },
  damageAt(){ harvestModeShots++; return true; },
  poisonRadius(){ return 1; },
  blastRadius(){ return 1; }
};
for(let i=0;i<120 && companionBreaks===0;i++){
  companions.update(0.12,player,getHarvestTile,setTile,{
    harvestSpeed:1,
    breakTile(x,y,expected){
      assert.equal(expected, T.STONE, 'companion harvest asks to break the assigned material');
      if(getHarvestTile(x,y)!==expected) return false;
      harvestTiles.set(x+','+y,T.AIR);
      companionBreaks++;
      return true;
    }
  });
}
assert.equal(companionBreaks, 1, 'companion slowly harvests the assigned material');
assert.equal(harvestModeShots, 0, 'harvest mode suppresses hostile attacks');
assert.equal(companions.commandAt(Math.floor(companions._debug.list()[0].x),Math.floor(companions._debug.list()[0].y-0.55),player), true, 'right-click style command can return companions to attack mode');
assert.equal(companions._debug.command().mode, 'attack', 'companions return to hostile-attack mode');
assert.ok(companions._debug.command().fightBadgeT>4.8, 'returning to fight mode starts a visible swords badge timer');
for(let i=0;i<40;i++) companions.update(0.12,player,getHarvestTile,setTile);
assert.ok(companions._debug.command().fightBadgeT>0, 'fight badge remains visible before five seconds expire');
for(let i=0;i<4;i++) companions.update(0.12,player,getHarvestTile,setTile);
assert.equal(companions._debug.command().fightBadgeT, 0, 'fight badge vanishes after five seconds');

let postDeathLaserDamage = 0;
const postDeathGas = [];
globalThis.MM.mobs = {
  nearestLiving(x,y,range){ return range>1 ? {x:x+2,y,hp:20,id:'POST_DEATH_TARGET'} : null; },
  damageAt(){ postDeathLaserDamage++; return true; },
  poisonRadius(){ return 1; },
  blastRadius(){ return 1; }
};
globalThis.MM.gases = {
  add(kind,x,y,opts){ postDeathGas.push({kind,x,y,opts:Object.assign({},opts)}); return 1; }
};
companions.restore({v:1,list:[{x:player.x-1,y:9.96,biomass:2,hp:1,seed:606,laserCd:0,gasCd:0}]},getTile);
function lavaTile(){ return T.LAVA; }
companions.update(0.12,player,lavaTile,setTile);
assert.equal(companions.count(), 0, 'environmental death removes companion during update');
assert.equal(postDeathLaserDamage, 0, 'dead companion cannot fire later in the same update tick');
assert.equal(postDeathGas.length, 1, 'dead companion only emits its death cloud, not an extra scheduled poison pulse');
assert.equal(postDeathGas[0].opts.cells, 4, 'the remaining poison cloud is the death effect');

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/engine/ui.js', import.meta.url), 'utf8');
const companionSource = readFileSync(new URL('../src/engine/companions.js', import.meta.url), 'utf8');
const mobSource = readFileSync(new URL('../src/engine/mobs.js', import.meta.url), 'utf8');
assert.match(main, /import \{ companions as COMPANIONS \}/, 'main imports companion system');
assert.match(main, /companions: timedSavePart\('companions'/, 'save payload includes companions');
assert.match(main, /COMPANIONS\.restore\(data\.companions,getTile\)/, 'load restores companions');
assert.match(main, /COMPANIONS\.update\(dt, player, getTile, setTile, \{breakTile:breakTileByCompanion, harvestSpeed:/, 'game loop updates companions with harvest integration');
assert.match(main, /controls:companionControlState\(\)/, 'game loop passes hero movement controls to rideable companions');
assert.match(main, /COMPANIONS\.draw\(ctx,TILE/, 'render loop draws companions');
assert.match(main, /COMPANIONS\.absorbHeroDamage\(amount,opts,player\)/, 'central hero damage lets clay golems absorb damage');
assert.match(main, /id:'bio_companion'/, 'crafting can create companions');
assert.match(main, /id:'bio_companion_feed'/, 'crafting can feed companions');
assert.match(main, /id:'leaf_monster'/, 'crafting can create leaf monsters');
assert.match(main, /assignCompanionHarvestTargetAt\(tx,ty\)/, 'left click can assign a pending companion harvest target');
assert.match(main, /COMPANIONS\.commandAt\(tx,ty,player\)/, 'right click can toggle companion command mode near a companion');
assert.match(main, /function breakTileByCompanion/, 'companion harvesting uses a main-owned tile break path');
assert.match(main, /injectCompanionDebugPanel/, 'main injects the companion debug menu');
assert.match(main, /giveDebugCompanionIngredients/, 'main wires companion debug actions');
assert.match(main, /spawnDebugGolem/, 'main wires direct clay golem debug spawning');
assert.match(main, /placeDebugGolemRitual/, 'main wires clay golem ritual debug placement');
assert.match(main, /guardDebugGolem/, 'main wires clay golem guard debug testing');
assert.match(main, /spawnDebugLeafMonster/, 'main wires direct leaf monster debug spawning');
assert.match(main, /placeDebugLeafRitual/, 'main wires leaf monster ritual debug placement');
assert.match(main, /spawnDebugWaterGolem/, 'main wires direct water golem debug spawning');
assert.match(main, /placeDebugWaterRitual/, 'main wires water golem ritual debug placement');
assert.match(main, /spawnDebugMeatGolem/, 'main wires direct meat golem debug spawning');
assert.match(main, /placeDebugMeatRitual/, 'main wires meat golem ritual debug placement');
assert.match(main, /rotDebugMeatGolem/, 'main wires meat golem rot debug action');
assert.match(main, /cookDebugMeatGolem/, 'main wires meat golem cook debug action');
assert.match(main, /molekinMotherLavaDrop/, 'main allows the post-fire-guardian master-stone-on-mother-lava molekin ritual placement');
assert.match(main, /function debugMolekinLavaMass\(amount\)\{[\s\S]*molekinMin\) \|\| 1;[\s\S]*Number\(amount\)\|\|4/, 'main debug molekin mass fallback honors the one-block mother-lava minimum');
assert.match(main, /spawnDebugMolekin/, 'main wires direct molekin debug spawning');
assert.match(main, /placeDebugMolekinRitual/, 'main wires molekin lava ritual debug placement');
assert.match(main, /molekinFireDebugCompanion/, 'main wires molekin fire debug action');
assert.match(main, /COMPANIONS\.onTileChanged\(tx,ty,prev,id,getTile,setTile\)/, 'main notifies companions when placed tiles can trigger rituals');
assert.match(ui, /function injectCompanionDebugPanel/, 'UI exposes a companion debug panel');
assert.match(ui, /Pomocnicy \(debug\)/, 'companion debug panel has a visible label');
assert.match(ui, /golemClay/, 'companion debug panel exposes clay golem mass input');
assert.match(ui, /Rytual golema/, 'companion debug panel exposes a clay golem ritual button');
assert.match(ui, /Stworz golema/, 'companion debug panel exposes a direct clay golem spawn button');
assert.match(ui, /Guard hit/, 'companion debug panel exposes a golem guard test button');
assert.match(ui, /leafMass/, 'companion debug panel exposes leaf monster mass input');
assert.match(ui, /Rytual lisciaka/, 'companion debug panel exposes a leaf monster ritual button');
assert.match(ui, /Stworz lisciaka/, 'companion debug panel exposes a direct leaf monster spawn button');
assert.match(ui, /waterMass/, 'companion debug panel exposes water golem mass input');
assert.match(ui, /Rytual wodny/, 'companion debug panel exposes a water golem ritual button');
assert.match(ui, /Stworz wodnego/, 'companion debug panel exposes a direct water golem spawn button');
assert.match(ui, /meatMass/, 'companion debug panel exposes meat golem mass input');
assert.match(ui, /Rytual miesny/, 'companion debug panel exposes a meat golem ritual button');
assert.match(ui, /Stworz miesnego/, 'companion debug panel exposes a direct meat golem spawn button');
assert.match(ui, /Zgnij teraz/, 'companion debug panel exposes meat golem rot button');
assert.match(ui, /Usmaz/, 'companion debug panel exposes meat golem cook button');
assert.match(ui, /molekinMass/, 'companion debug panel exposes molekin mother-lava mass input');
assert.match(ui, /Rytual lawy mac\./, 'companion debug panel exposes a molekin mother-lava ritual button');
assert.match(ui, /spawnMolekin'[\s\S]*readNumber\(molekinInput,4,1,20\)/, 'molekin debug spawn honors the one-block mother-lava minimum');
assert.match(ui, /setLava'[\s\S]*readNumber\(molekinInput,4,1,20\)/, 'molekin debug mass tuning honors the one-block mother-lava minimum');
assert.match(ui, /Stworz kreta/, 'companion debug panel exposes a direct molekin spawn button');
assert.match(ui, /Zar kreta/, 'companion debug panel exposes a molekin fire action button');
assert.match(companionSource, /function tryClayGolemRitualAt/, 'companion system exposes wet-clay master-stone ritual creation');
assert.match(companionSource, /function tryLeafMonsterRitualAt/, 'companion system exposes leaf servant-stone ritual creation');
assert.match(companionSource, /mode==='transport'/, 'companion command state supports leaf transport mode');
assert.match(companionSource, /LEAF_MONSTER_TRANSPORT_DRAIN_RATIO = 0\.10/, 'leaf transport mode drains ten percent max HP per second');
assert.match(companionSource, /function updateLeafMonsterTransport/, 'leaf monsters have a mounted transport movement path');
assert.match(companionSource, /!c\.transportMounted && \(command\.transportBadgeT\|\|0\)>0/, 'mounted leaf monsters hide the transport command badge');
assert.match(companionSource, /function tryWaterGolemRitualAt/, 'companion system exposes water master-stone ritual creation');
assert.match(companionSource, /function tryMolekinRitualAt/, 'companion system exposes post-fire lava master-stone molekin ritual creation');
assert.match(companionSource, /function fireGuardianDefeated/, 'molekin ritual checks the fire guardian defeat state');
assert.match(companionSource, /T\.MOTHER_LAVA/, 'molekin ritual uses mother lava instead of ordinary lava');
assert.match(companionSource, /function iceGuardianDefeated/, 'mother-ice alien companion crafting checks the west ice guardian defeat state');
assert.match(companionSource, /spawnUfoAlienFromCraft[\s\S]*iceGuardianDefeated/, 'mother-ice alien companion crafting is gated behind the west guardian');
assert.match(companionSource, /function sayVariant\(key,lines,vars\)/, 'companion event messages use a small anti-repeat variant helper');
assert.match(companionSource, /sayVariant\('molekin_ritual'[\s\S]*Hero-Prostokat[\s\S]*dawny zar/, 'mother-lava molekin ritual has multiple lore-aware message variants');
assert.match(companionSource, /sayVariant\('ufo_alien_craft'[\s\S]*Hero-Prostokat[\s\S]*alien teamu/, 'mother-ice alien companion craft has multiple hero-worship message variants');
assert.match(companionSource, /function tryMeatGolemRitualAt/, 'companion system exposes meat master-stone ritual creation');
assert.match(companionSource, /spawnGolem:debugSpawnGolem/, 'companion debug API exposes clay golem spawning');
assert.match(companionSource, /spawnLeafMonster:debugSpawnLeafMonster/, 'companion debug API exposes leaf monster spawning');
assert.match(companionSource, /spawnWaterGolem:debugSpawnWaterGolem/, 'companion debug API exposes water golem spawning');
assert.match(companionSource, /spawnMeatGolem:debugSpawnMeatGolem/, 'companion debug API exposes meat golem spawning');
assert.match(companionSource, /spawnMolekin:debugSpawnMolekin/, 'companion debug API exposes molekin spawning');
assert.match(companionSource, /setClay:debugSetClay/, 'companion debug API exposes clay golem mass tuning');
assert.match(companionSource, /setLeaves:debugSetLeaves/, 'companion debug API exposes leaf monster mass tuning');
assert.match(companionSource, /setWater:debugSetWater/, 'companion debug API exposes water golem mass tuning');
assert.match(companionSource, /setMeat:debugSetMeat/, 'companion debug API exposes meat golem mass tuning');
assert.match(companionSource, /setLava:debugSetLava/, 'companion debug API exposes molekin lava mass tuning');
assert.match(companionSource, /rotMeatGolem:debugRotMeatGolem/, 'companion debug API exposes meat golem rot action');
assert.match(companionSource, /cookMeatGolem:debugCookMeatGolem/, 'companion debug API exposes meat golem cook action');
assert.match(companionSource, /function drawMeatGolem/, 'companion renderer has a dedicated meat golem branch');
assert.match(companionSource, /KIND_FRIED_MEAT_GOLEM/, 'companion system has a fried meat golem ally state');
assert.match(companionSource, /FRIED_MEAT_GOLEM_HEAL_RATIO = 0\.20/, 'fried meat golem eating heals up to twenty percent of hero max HP');
assert.match(companionSource, /MM\.undergroundBoss && MM\.undergroundBoss\.nearestForTurret/, 'companions can target the underground boss');
assert.match(companionSource, /guardHero:debugGuardHero/, 'companion debug API exposes golem guard testing');
assert.match(companionSource, /nearestHostileLiving/, 'companions target hostile animals through the mob hostility API');
assert.match(companionSource, /hostileOnly:true,source:'companion'/, 'companion area attacks are limited to hostile mobs');
assert.match(companionSource, /function findCompanionPath/, 'companions have a bounded local pathfinder');
assert.match(companionSource, /COMPANION_PATH_MAX_NODES = 96/, 'companion pathfinding has a small hard node cap');
assert.match(companionSource, /function cachedTileGetter/, 'companion pathfinding can cache tile probes within one local plan');
assert.match(companionSource, /companionPathTarget\(c,targetX,targetY,dt,getTile\)/, 'companion motion steers through cached local path waypoints');
assert.match(companionSource, /nearestForEnemy/, 'companion system exposes target lookup for enemy attacks');
assert.match(companionSource, /damageAtWorld/, 'companion system exposes world-coordinate enemy damage');
assert.match(companionSource, /if\(!Number\.isFinite\(wx\) \|\| !Number\.isFinite\(wy\)\) return false/, 'companion enemy damage rejects invalid world coordinates');
assert.match(companionSource, /function collideHero/, 'companion system exposes hero-companion collision resolution');
assert.match(companionSource, /collideHero\(player,dt,getTile\)/, 'companion update resolves hero-companion overlap');
assert.match(companionSource, /function drawClayGolem/, 'companion renderer has a dedicated wet clay golem branch');
assert.match(companionSource, /function drawLeafMonster/, 'companion renderer has a dedicated leaf monster branch');
assert.match(companionSource, /function drawWaterGolem/, 'companion renderer has a dedicated water golem branch');
assert.match(companionSource, /function drawMolekin/, 'companion renderer has a dedicated molekin branch');
assert.match(companionSource, /spawnExternalStream\('hose'/, 'water golem spray reuses the hose-style stream visual when available');
assert.match(companionSource, /LEAF_MONSTER_WIND_DRIFT/, 'leaf monster movement has explicit wind sensitivity');
assert.match(companionSource, /WATER_GOLEM_MAX_WATER = 20/, 'water golem ritual has the requested twenty-water-cell cap');
assert.match(mobSource, /function nearestHostileLiving/, 'mob system exposes hostile-only target lookup');
assert.match(mobSource, /HERO_FOCUS_MS/, 'mob system tracks recently hero-attacked targets for companion priority');
assert.match(companionSource, /if\(ctx\.roundRect\)/, 'companion renderer guards optional Canvas roundRect support');
assert.match(companionSource, /function drawGlowPattern/, 'companion renderer uses generated glow patterns');
assert.match(companionSource, /traits\.archetype==='sentinel'/, 'companion motion branches by archetype');
assert.match(companionSource, /COMMAND_BADGE_ICONS = Object\.freeze/, 'companion command badges share interface icon constants');
assert.ok(companionSource.includes("swords:'⚔️'"), 'fight command badge uses the same swords icon as the interface');
assert.ok(companionSource.includes("pickaxe:'⛏️'"), 'harvest command badge uses the same pickaxe icon as the interface');
assert.match(companionSource, /function drawCommandInterfaceIcon/, 'companion renderer draws command badges through the shared interface icon path');
assert.ok(companionSource.includes("if(command.mode==='harvest') return command.awaiting ? 'ask' : ((command.harvestBadgeT||0)>0 ? 'pickaxe' : '');"), 'companion command badge switches between question mark and a timed pickaxe in harvest mode');
assert.match(companionSource, /command\.fightBadgeT=Math\.max\(0,\(command\.fightBadgeT\|\|0\)-dt\)/, 'companion update expires the fight-mode swords badge over time');
assert.match(companionSource, /command\.harvestBadgeT=5/, 'assigning a harvest target starts the five-second pickaxe badge');
assert.match(companionSource, /command\.harvestBadgeT=Math\.max\(0,\(command\.harvestBadgeT\|\|0\)-dt\)/, 'companion update expires the harvest pickaxe badge over time');

console.log('companions-sim: all assertions passed');
