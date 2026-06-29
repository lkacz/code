import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.performance = { now:()=>1000 };
globalThis.MM = { TILE:20 };
const messages = [];
globalThis.msg = text => messages.push(String(text));
globalThis.inv = { alienBiomass:0, meat:0 };

const { T } = await import('../src/constants.js');
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

const snap = companions.snapshot();
assert.equal(snap.list.length, 1, 'snapshot includes active companions');
companions.reset();
assert.equal(companions.count(), 0, 'reset clears companions');
assert.equal(companions.restore(snap,getTile), true, 'restore accepts snapshots');
assert.equal(companions.count(), 1, 'restore rebuilds active companions');

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

companions.restore({v:1,list:[{x:player.x-80,y:9.96,biomass:3,hp:88,seed:707,laserCd:99,gasCd:99}]},getTile);
const beforeAutoCatchup = companions._debug.list()[0];
companions.update(1/30,player,getTile,setTile);
const afterAutoCatchup = companions._debug.list()[0];
assert.ok(Math.abs(afterAutoCatchup.x-player.x)<4, 'abandoned companion catches up near the hero');
assert.ok(Math.abs(afterAutoCatchup.hp-(beforeAutoCatchup.hp-beforeAutoCatchup.maxHp*0.10))<0.001, 'automatic catch-up costs 10% max HP');

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
globalThis.MM.mobs = {
  nearestLiving(x,y,range){
    assert.ok(range>=0.9, 'companion asks for nearby targets');
    return {x:x+3,y:y,hp:20,id:'QA_MOB'};
  },
  damageAt(tx,ty,dmg){
    assert.ok(Number.isInteger(tx) && Number.isInteger(ty), 'laser damage is tile addressed');
    assert.ok(dmg>5, 'laser damage is meaningful');
    damaged++;
    return true;
  },
  poisonRadius(){ poisonRadius++; return 1; },
  blastRadius(){ blasts++; return 1; }
};
globalThis.MM.particles = { spawnBurst(){}, spawnSparks(){} };
globalThis.MM.audio = { play(){} };

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

companions.restore({v:1,list:[{x:0,y:9.96,biomass:3,hp:88,seed:1001,laserCd:0,gasCd:0}]},getTile);
const harvestCompanion = companions._debug.list()[0];
assert.equal(companions.commandAt(Math.floor(harvestCompanion.x),Math.floor(harvestCompanion.y-0.55),player), true, 'right-click style command toggles a nearby companion squad');
assert.equal(companions.awaitingHarvestTarget(), true, 'harvest command starts in target-pick mode');
assert.equal(companions._debug.command().mode, 'harvest', 'command mode switches from attack to harvest');
assert.equal(companions.assignHarvestTarget(T.STONE,'Skala'), true, 'clicked material becomes the companion harvest target');
assert.equal(companions.awaitingHarvestTarget(), false, 'assigning a material clears the question-mark target-pick state');
const harvestSnapshot = companions.snapshot();
companions.restore(harvestSnapshot,getTile);
assert.equal(companions._debug.command().harvestTile, T.STONE, 'harvest command survives save/restore');
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
assert.match(main, /import \{ companions as COMPANIONS \}/, 'main imports companion system');
assert.match(main, /companions: timedSavePart\('companions'/, 'save payload includes companions');
assert.match(main, /COMPANIONS\.restore\(data\.companions,getTile\)/, 'load restores companions');
assert.match(main, /COMPANIONS\.update\(dt, player, getTile, setTile, \{breakTile:breakTileByCompanion, harvestSpeed:/, 'game loop updates companions with harvest integration');
assert.match(main, /COMPANIONS\.draw\(ctx,TILE/, 'render loop draws companions');
assert.match(main, /id:'bio_companion'/, 'crafting can create companions');
assert.match(main, /id:'bio_companion_feed'/, 'crafting can feed companions');
assert.match(main, /assignCompanionHarvestTargetAt\(tx,ty\)/, 'left click can assign a pending companion harvest target');
assert.match(main, /COMPANIONS\.commandAt\(tx,ty,player\)/, 'right click can toggle companion command mode near a companion');
assert.match(main, /function breakTileByCompanion/, 'companion harvesting uses a main-owned tile break path');
assert.match(main, /injectCompanionDebugPanel/, 'main injects the companion debug menu');
assert.match(main, /giveDebugCompanionIngredients/, 'main wires companion debug actions');
assert.match(ui, /function injectCompanionDebugPanel/, 'UI exposes a companion debug panel');
assert.match(ui, /Bio-pomocnik \(debug\)/, 'companion debug panel has a visible label');
assert.match(companionSource, /if\(ctx\.roundRect\)/, 'companion renderer guards optional Canvas roundRect support');
assert.match(companionSource, /function drawGlowPattern/, 'companion renderer uses generated glow patterns');
assert.match(companionSource, /traits\.archetype==='sentinel'/, 'companion motion branches by archetype');
assert.match(companionSource, /const badge=command\.awaiting \? '\?' : 'pick'/, 'companion renderer shows a question mark while choosing harvest material');

console.log('companions-sim: all assertions passed');
