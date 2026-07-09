// Alien mech simulation contract.
// Far-world mechs are block machines with real power-source parts,
// separate pilot/hull defeat paths, boarding, armor absorption, tree crushing,
// salvage drops and save/restore support.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.CustomEvent = globalThis.CustomEvent || class { constructor(type,opts){ this.type=type; this.detail=opts&&opts.detail; } };
const events=[];
globalThis.dispatchEvent = ev => { events.push(ev); return true; };
globalThis.msg = text => { events.push({type:'msg',detail:{text}}); };
globalThis.inv = {
  alienBiomass:0, dynamo:0, steel:0, track:0, copperWire:0, transistor:0,
  fireTurret:0, turret:0, solarPanel:0, solarBattery:0, springPlatform:0,
  steelTrapdoor:0, glass:0, coal:5
};
globalThis.player = {x:0,y:0,w:0.7,h:0.95,vx:0,vy:0,onGround:false,hp:100,maxHp:100,xp:0};
globalThis.damageHero = (amount,opts) => {
  globalThis.player.hp -= Math.round(amount);
  events.push({type:'damageHero',detail:{amount,opts}});
  return true;
};

const { T, INFO } = await import('../src/constants.js');
const { worldGen } = await import('../src/engine/worldgen.js');
const { mechs } = await import('../src/engine/mechs.js');

const mechsSource = readFileSync(new URL('../src/engine/mechs.js', import.meta.url),'utf8');
assert.match(mechsSource, /function drawAlienTeamPilotMini/, 'cockpit renders a real alien-team-style pilot, not a placeholder icon');
assert.match(mechsSource, /function drawCockpitGlassForeground/, 'cockpit keeps a normal glass pane in front of the pilot');
assert.match(mechsSource, /cx:1\.22/, 'pilot is rendered in the empty cabin bay behind the front glass block');
assert.doesNotMatch(mechsSource, /ctx\.arc\(cx,cy,TILE\*\(role==='cockpit'\?0\.18:0\.22\)/, 'old circular cockpit icon is not used');

worldGen.surfaceHeight = () => 20;
const tiles=new Map();
const K=(x,y)=>Math.floor(x)+','+Math.floor(y);
const setTile=(x,y,t)=>tiles.set(K(x,y),t);
const getTile=(x,y)=>{
  const k=K(x,y);
  if(tiles.has(k)) return tiles.get(k);
  return y>=20 ? T.STONE : T.AIR;
};

function settle(n,player=globalThis.player,controls={}){
  for(let i=0;i<n;i++) mechs.update(1/60,player,getTile,setTile,{controls});
}
function cellOf(m,role){
  return m.cells.find(c=>c.role===role) || m.cells[0];
}
function cellSig(cells){
  return cells.map(c=>`${c.dx}:${c.dy}:${c.t}:${c.role||''}`).sort().join('|');
}
function tileAt(cells,x,y){
  return (cells.find(c=>c.dx===x && c.dy===y) || {}).t ?? T.AIR;
}
function roleAt(cells,x,y){
  return (cells.find(c=>c.dx===x && c.dy===y) || {}).role || '';
}
function assertForgeMatrix(bp,baseRole){
  const baseTile=baseRole==='track' ? T.TRACK : T.STEEL;
  const rows=[
    [T.STEEL,T.STEEL_TRAPDOOR,T.STEEL,T.AIR,T.AIR],
    [T.GLASS,T.AIR,T.DYNAMO,T.DYNAMO_SLOT,T.DYNAMO],
    [T.STEEL,T.STEEL,T.STEEL,T.AIR,T.AIR],
    [T.STEEL,T.STEEL,T.STEEL,T.COAL,T.STEEL],
    [T.STEEL,T.STEEL,T.STEEL,T.STEEL,T.STEEL],
    [T.AIR,baseTile,baseTile,baseTile,T.AIR]
  ];
  assert.equal(bp.bounds.w,5, 'forge prototype is exactly five tiles wide');
  assert.equal(bp.bounds.h,6, 'forge prototype is exactly six rows tall');
  for(let y=0;y<rows.length;y++){
    for(let x=0;x<rows[y].length;x++){
      assert.equal(tileAt(bp.cells,x,y),rows[y][x], `forge prototype tile at ${x},${y}`);
    }
  }
  assert.equal(roleAt(bp.cells,1,0),'hatch', 'top middle is the existing steel hatch block');
  assert.equal(roleAt(bp.cells,0,1),'cockpit', 'glass block is the cockpit with the alien inside');
  for(const x of [1,2,3]) assert.equal(roleAt(bp.cells,x,5),baseRole, `bottom drive block ${x} is ${baseRole}`);
}

mechs.reset();

const forgeBp=mechs._debug.makeBlueprint('forge',6100);
assert.equal(forgeBp.name,'Forge mech', 'forge prototype is the hard-coded primary steel design');
assertForgeMatrix(forgeBp,'leg');
assert.equal(forgeBp.cells.filter(c=>c.t===T.DYNAMO).length,2, 'forge mech uses the two real dynamo casing blocks');
assert.equal(forgeBp.cells.filter(c=>c.t===T.DYNAMO_SLOT).length,1, 'forge mech uses the real middle dynamo slot');
assert.equal(forgeBp.cells.filter(c=>c.t===T.COAL).length,1, 'forge mech uses one existing coal block as burning fuel');
assert.equal(forgeBp.cells.some(c=>c.t===T.SPRING_PLATFORM), false, 'forge primary design does not hide a special spring block');
assert.equal(forgeBp.cells.some(c=>c.t===T.LAVA), false, 'forge mech no longer fakes heat with a lava block');
assert.equal(forgeBp.cells.some(c=>c.t===T.ELECTRONICS || c.t===T.COPPER_WIRE || c.t===T.WIRE), false, 'forge prototype has no hidden electronics or wires');
assert.equal(forgeBp.cells.some(c=>['pilot','electronics','wire','rotor','power','frontPlate','rightFrame','engine','burner','spring'].includes(c.role)), false, 'forge prototype has no mech-only fake subsystem roles');
const crawlerBp=mechs._debug.makeBlueprint('forge',6000);
assert.equal(crawlerBp.name,'Forge crawler', 'some forge seeds create a tracked crawler variant');
assertForgeMatrix(crawlerBp,'track');
assert.equal(crawlerBp.cells.filter(c=>c.role==='track' && c.t===T.TRACK).length,3, 'crawler uses a three-block real track base');
assert.equal(crawlerBp.cells.some(c=>c.t===T.SPRING_PLATFORM), false, 'crawler tracks are track blocks, not a hidden spring machine');
assert.equal(INFO[T.TRACK].drop,'track', 'tracked crawler base salvages into the same placeable track resource');
assert.ok(crawlerBp.cells.every(c=>[T.STEEL,T.STEEL_TRAPDOOR,T.TRACK,T.GLASS,T.COAL,T.DYNAMO,T.DYNAMO_SLOT].includes(c.t)), 'crawler is made only from exact placeable prototype blocks');
globalThis.player.x=6000;
globalThis.player.y=15;
let debugForge=mechs.forceSpawn('forge',globalThis.player,getTile);
assert.equal(debugForge.name,'Forge mech', 'debug spawn forge always gives the leg prototype');
assertForgeMatrix({cells:debugForge.cells,bounds:debugForge._bounds},'leg');
mechs.reset();
globalThis.player.x=5990;
debugForge=mechs.forceSpawn('forge_tracks',globalThis.player,getTile);
assert.equal(debugForge.name,'Forge crawler', 'debug spawn crawler always gives the tracked prototype');
assertForgeMatrix({cells:debugForge.cells,bounds:debugForge._bounds},'track');
mechs.reset();
const solarBp=mechs._debug.makeBlueprint('solar',-6100);
assert.equal(solarBp.name,'Solar hopper', 'solar prototype follows the same hopper chassis');
assert.ok(solarBp.cells.filter(c=>c.t===T.SOLAR_PANEL).length>=4, 'solar mech carries exposed solar panels');
assert.ok(solarBp.cells.some(c=>c.t===T.SOLAR_BATTERY), 'solar mech has a solar battery power core');
assert.ok(solarBp.cells.some(c=>c.role==='spring' && c.t===T.SPRING_PLATFORM), 'solar mech also uses the spring jumper chassis');

// Deterministic far-zone spawn gate.
mechs.reset();
let rightZone=null;
for(let z=Math.floor(5000/mechs._debug.CFG.ZONE_W); z<80; z++){
  if(mechs._debug.zoneShouldSpawn(z)){ rightZone=z; break; }
}
assert.notEqual(rightZone,null, 'test seed has at least one right-side mech zone');
const rightSpawnX=mechs._debug.zoneSpawnX(rightZone);
globalThis.player.x=rightSpawnX;
globalThis.player.y=15;
mechs.update(2,globalThis.player,getTile,setTile,{});
assert.equal(mechs.metrics().count,0, 'far mech spawn waits if the hero is standing on the spawn point');
globalThis.player.x=rightSpawnX+mechs._debug.CFG.PLAYER_SPAWN_GAP+5;
settle(120);
assert.equal(mechs.metrics().count,1, 'walking beyond 5000m can materialize a probabilistic mech zone');
assert.equal(mechs._debug.mechs()[0].kind,'forge', 'right-side far spawn is forge/dynamo powered');
mechs.reset({suppressSpawns:3});
globalThis.player.x=rightSpawnX+mechs._debug.CFG.PLAYER_SPAWN_GAP+5;
settle(120);
assert.equal(mechs.metrics().count,0, 'debug reset can suppress immediate far-zone respawn while the tester recenters');
settle(220);
assert.equal(mechs.metrics().count,1, 'suppressed far-zone spawns resume after the reset grace window');

let leftZone=null;
for(let z=-Math.floor(5000/mechs._debug.CFG.ZONE_W)-1; z>-80; z--){
  if(mechs._debug.zoneShouldSpawn(z)){ leftZone=z; break; }
}
assert.notEqual(leftZone,null, 'test seed has at least one left-side mech zone');
mechs.reset();
globalThis.player.x=mechs._debug.zoneSpawnX(leftZone)-mechs._debug.CFG.PLAYER_SPAWN_GAP-5;
settle(120);
assert.equal(mechs._debug.mechs()[0].kind,'solar', 'left-side far spawn is solar powered');

// Pilot defeat leaves the hull boardable.
mechs.reset();
globalThis.player.x=6000;
globalThis.player.y=15;
const mech=mechs.forceSpawn('forge',globalThis.player,getTile);
settle(60);
globalThis.player.x=mech.x+2.5;
globalThis.player.y=mech.y+2.2;
assert.equal(mechs.toggleBoard(globalThis.player,getTile), false, 'live alien pilot prevents boarding');
const cockpit=cellOf(mech,'cockpit');
const cx=Math.floor(mech.x+cockpit.dx), cy=Math.floor(mech.y+cockpit.dy);
const hpBefore=mech.hp;
for(let i=0;i<7 && mech.pilotAlive;i++) mechs.damageAt(cx,cy,10,{source:'hero',kind:'melee'});
assert.equal(mech.pilotAlive,false, 'cockpit hits can defeat the alien pilot');
assert.ok(mech.hp>0 && mech.hp<hpBefore, 'pilot defeat leaves a damaged but intact hull');
assert.ok(globalThis.inv.alienBiomass>=1, 'pilot drops alien biomass');
assert.ok(globalThis.player.xp>0, 'pilot defeat grants XP');
globalThis.player.x=mech.x+2.5;
globalThis.player.y=mech.y+2.2;
assert.equal(mechs.toggleBoard(globalThis.player,getTile), true, 'empty hull can be boarded with the interaction key path');
assert.ok(mechs.heroMech(), 'hero is now riding the captured mech');

const hpArmorBefore=mech.hp;
const guard=mechs.absorbHeroDamage(20,{cause:'test'},globalThis.player);
assert.ok(guard && guard.absorbed>10 && guard.amount<20, 'ridden mech absorbs most incoming hero damage');
assert.ok(mech.hp<hpArmorBefore, 'absorbed damage wears down the hull');

// Captured mech crushes trees while walking.
const treeX=Math.floor(mech.x+6);
for(let y=15;y<=19;y++) setTile(treeX,y,T.WOOD);
settle(160,globalThis.player,{right:true});
let remainingWood=0;
for(let y=15;y<=19;y++) if(getTile(treeX,y)===T.WOOD) remainingWood++;
assert.equal(remainingWood,0, 'ridden mech crushes trees in its path');

// Leaving, destroying and salvaging the hull.
assert.equal(mechs.toggleBoard(globalThis.player,getTile), true, 'interaction key exits the mech');
assert.equal(mechs.heroMech(), null, 'hero is no longer riding after exit');
mechs.blastRadius(mech.x+2.5,mech.y+2.5,8,999,{source:'hero'});
assert.ok(globalThis.inv.dynamo>=1, 'destroyed forge mech salvages a usable dynamo');
assert.ok(globalThis.inv.steel>=1, 'destroyed forge mech salvages its structural steel blocks');
assert.ok(globalThis.inv.steelTrapdoor>=1, 'destroyed forge mech salvages its real steel hatch block');
assert.ok(globalThis.inv.glass>=1, 'destroyed forge mech salvages its real glass cockpit block');
assert.ok(globalThis.inv.coal>=1, 'destroyed forge mech salvages remaining coal fuel');
settle(1);
assert.equal(mechs.metrics().count,0, 'destroyed hull is removed from active simulation');

// Captured movement is gated by real reserve/supply, not free input.
mechs.reset();
globalThis.player.x=6000;
globalThis.player.y=15;
const powerless=mechs.forceSpawn('forge',globalThis.player,getTile);
settle(60);
const powerlessCockpit=cellOf(powerless,'cockpit');
for(let i=0;i<8 && powerless.pilotAlive;i++) mechs.damageAt(Math.floor(powerless.x+powerlessCockpit.dx),Math.floor(powerless.y+powerlessCockpit.dy),10,{source:'hero'});
globalThis.player.x=powerless.x+2.5;
globalThis.player.y=powerless.y+2.2;
assert.equal(mechs.toggleBoard(globalThis.player,getTile), true, 'power test boards an abandoned mech');
powerless.energy=0;
powerless.fuel=0;
const savedCoal=globalThis.inv.coal;
globalThis.inv.coal=0;
const stuckX=powerless.x;
settle(80,globalThis.player,{right:true});
assert.ok(Math.abs(powerless.x-stuckX)<0.05, 'captured mech does not walk with no energy or fuel');
powerless.fuel=20;
settle(80,globalThis.player,{right:true});
assert.ok(powerless.x>stuckX+0.2, 'captured forge mech walks again once its real fuel charges reserve');
assert.ok(powerless.energy<mechs._debug.CFG.ENERGY_FORGE_CAP, 'walking spends the captured mech reserve');
globalThis.inv.coal=savedCoal;
assert.equal(mechs.toggleBoard(globalThis.player,getTile), true, 'power test exits captured mech');

// A tracked abandoned mech can be driven like a boat by standing on it, but only with power.
mechs.reset();
globalThis.player.x=5990;
globalThis.player.y=15;
const crawler=mechs.forceSpawn('forge_tracks',globalThis.player,getTile);
assert.equal(crawler.name,'Forge crawler', 'standing drive test uses the tracked forge variant');
settle(60);
const crawlerCockpit=cellOf(crawler,'cockpit');
for(let i=0;i<8 && crawler.pilotAlive;i++) mechs.damageAt(Math.floor(crawler.x+crawlerCockpit.dx),Math.floor(crawler.y+crawlerCockpit.dy),10,{source:'hero'});
const deck=crawler.cells.find(c=>c.role==='roof') || crawler.cells[0];
globalThis.player.x=crawler.x+deck.dx+0.5;
globalThis.player.y=crawler.y+deck.dy-(globalThis.player.h||0.95)/2+0.03;
globalThis.player.vx=0;
globalThis.player.vy=0;
crawler.energy=0;
crawler.fuel=0;
const crawlerCoal=globalThis.inv.coal;
globalThis.inv.coal=0;
const crawlerStuckX=crawler.x;
settle(80,globalThis.player,{right:true});
assert.ok(Math.abs(crawler.x-crawlerStuckX)<0.05, 'standing on a powerless crawler does not move it for free');
crawler.fuel=20;
globalThis.player.x=crawler.x+deck.dx+0.5;
globalThis.player.y=crawler.y+deck.dy-(globalThis.player.h||0.95)/2+0.03;
settle(120,globalThis.player,{right:true});
assert.ok(crawler.x>crawlerStuckX+0.15, 'standing on a powered crawler drives it horizontally like a boat');
assert.ok(globalThis.player.x>crawlerStuckX+deck.dx+0.55, 'standing rider is carried along with the tracked mech');
globalThis.inv.coal=crawlerCoal;

// Hostile mechs can batter through a simple house wall while chasing the hero.
mechs.reset();
tiles.clear();
globalThis.player.x=6000;
globalThis.player.y=15;
const breaker=mechs.forceSpawn('forge',globalThis.player,getTile);
settle(60);
const wallX=Math.floor(breaker.x)-1;
for(let y=14;y<=19;y++) setTile(wallX,y,T.STEEL);
globalThis.player.x=breaker.x-9;
globalThis.player.y=15;
settle(520);
let wallBlocks=0;
for(let y=14;y<=19;y++) if(getTile(wallX,y)===T.STEEL) wallBlocks++;
assert.ok(wallBlocks<6, 'hostile mech damages and breaks player-built walls instead of staring at them');

// Hop logic does not become an endless jump loop when an escape is uncertain.
mechs.reset();
tiles.clear();
for(let x=5998;x<=6008;x++) for(let y=17;y<=25;y++) setTile(x,y,T.STONE);
for(let x=6000;x<=6005;x++) for(let y=17;y<=19;y++) setTile(x,y,T.AIR);
globalThis.player.x=5990;
globalThis.player.y=15;
const trapped=mechs.forceSpawn('forge',globalThis.player,getTile);
trapped.x=6001;
trapped.y=14;
trapped.onGround=true;
settle(600);
assert.ok((trapped.uncertainJumpTries||0)<=mechs._debug.CFG.UNCERTAIN_JUMP_LIMIT, 'trapped mech caps uncertain escape jumps');

// Mechs hand their rigid body to mobs for collision/knockback instead of ghosting.
mechs.reset();
tiles.clear();
let mobCollisions=0;
const oldMobs=globalThis.MM.mobs;
globalThis.MM.mobs={
  collideMech(m,r,dt,opts){
    mobCollisions++;
    assert.ok(r && r.right>r.left && r.bottom>r.top, 'mech collision exposes a real rigid hull rect');
    assert.equal(opts.source,'alien_mech');
    return {hits:1,damaged:1,blockers:1};
  }
};
globalThis.player.x=6000;
globalThis.player.y=15;
const collider=mechs.forceSpawn('forge',globalThis.player,getTile);
globalThis.player.x=collider.x-8;
settle(20);
assert.ok(mobCollisions>0, 'mech update calls mob collision hook');
globalThis.MM.mobs=oldMobs;

// A ridden mech that breaks under incoming damage ejects once and salvages once.
mechs.reset();
globalThis.player.x=6000;
globalThis.player.y=15;
const armored=mechs.forceSpawn('forge',globalThis.player,getTile);
settle(60);
const armoredCockpit=cellOf(armored,'cockpit');
for(let i=0;i<8 && armored.pilotAlive;i++) mechs.damageAt(Math.floor(armored.x+armoredCockpit.dx),Math.floor(armored.y+armoredCockpit.dy),10,{source:'hero'});
globalThis.player.x=armored.x+2.5;
globalThis.player.y=armored.y+2.2;
assert.equal(mechs.toggleBoard(globalThis.player,getTile), true, 'abandoned armor can be captured for destruction regression');
const dynBeforeBreak=globalThis.inv.dynamo;
const brokenGuard=mechs.absorbHeroDamage(10000,{cause:'stress'},globalThis.player);
assert.ok(brokenGuard && brokenGuard.absorbed>0, 'ridden armor absorbs the fatal stress hit');
assert.equal(mechs.heroMech(), null, 'destroyed ridden mech ejects the hero immediately');
const dynAfterBreak=globalThis.inv.dynamo;
assert.ok(dynAfterBreak>dynBeforeBreak, 'destroyed ridden mech salvages once');
mechs.blastRadius(armored.x+2.5,armored.y+2.5,8,999,{source:'hero'});
assert.equal(globalThis.inv.dynamo,dynAfterBreak, 'already-destroyed mech cannot award duplicate salvage');
settle(1);

// Saving while mounted keeps the captured mech mounted after restore.
mechs.reset();
globalThis.player.x=6000;
globalThis.player.y=15;
const mounted=mechs.forceSpawn('forge',globalThis.player,getTile);
settle(60);
const mountedCockpit=cellOf(mounted,'cockpit');
for(let i=0;i<8 && mounted.pilotAlive;i++) mechs.damageAt(Math.floor(mounted.x+mountedCockpit.dx),Math.floor(mounted.y+mountedCockpit.dy),10,{source:'hero'});
globalThis.player.x=mounted.x+2.5;
globalThis.player.y=mounted.y+2.2;
assert.equal(mechs.toggleBoard(globalThis.player,getTile), true, 'mounted save test boards the captured mech');
const mountedSnap=mechs.snapshot();
assert.equal(mountedSnap.list[0].rider,true, 'snapshot records that the captured mech is mounted');
mechs.reset();
assert.equal(mechs.restore(mountedSnap,getTile), true, 'mounted snapshot restores');
assert.ok(mechs.heroMech(), 'restore keeps the player attached to the captured mech');
const restoredMounted=mechs.heroMech();
restoredMounted.energy=0;
restoredMounted.fuel=0;
const mountedSavedCoal=globalThis.inv.coal;
globalThis.inv.coal=0;
const mountedStuckX=restoredMounted.x;
settle(70,globalThis.player,{right:true});
assert.ok(Math.abs(restoredMounted.x-mountedStuckX)<0.05, 'restored mounted mech still refuses free movement without power');
restoredMounted.fuel=20;
settle(90,globalThis.player,{right:true});
assert.ok(restoredMounted.x>mountedStuckX+0.2, 'restored mounted forge mech uses real fuel after load');
globalThis.inv.coal=mountedSavedCoal;
mechs.reset();

// Snapshot/restore keeps abandoned machines and used spawn zones.
mechs.reset();
globalThis.player.x=-6200;
const solar=mechs.forceSpawn('solar',globalThis.player,getTile);
const c2=cellOf(solar,'cockpit');
for(let i=0;i<8 && solar.pilotAlive;i++) mechs.damageAt(Math.floor(solar.x+c2.dx),Math.floor(solar.y+c2.dy),9,{source:'hero'});
const snap=mechs.snapshot();
assert.equal(snap.list.length,1, 'snapshot stores active mech hulls');
mechs.reset();
assert.equal(mechs.metrics().count,0, 'reset clears mechs');
assert.equal(mechs.restore(snap,getTile), true, 'restore accepts the mech snapshot');
assert.equal(mechs.metrics().count,1, 'restore brings the mech back');
assert.equal(mechs._debug.mechs()[0].pilotAlive,false, 'abandoned state survives restore');

// Snapshot/restore keeps the saved hard-coded variant even after walking.
mechs.reset();
const seedA=6000, seedB=6400;
const sigA=cellSig(mechs._debug.makeBlueprint('forge',seedA).cells);
assert.notEqual(cellSig(mechs._debug.makeBlueprint('forge',seedB).cells), sigA, 'test seeds cover both tracked and legged forge variants');
globalThis.player.x=seedA-10;
const variant=mechs.forceSpawn('forge',globalThis.player,getTile);
const bpA=mechs._debug.makeBlueprint('forge',seedA);
variant.cells=bpA.cells.map(c=>Object.assign({},c));
variant._bounds=bpA.bounds;
variant.salvageSeed=seedA;
variant.x=seedB+0.25;
const variantSnap=mechs.snapshot();
mechs.reset();
assert.equal(mechs.restore(variantSnap,getTile), true, 'variant snapshot restores');
assert.equal(cellSig(mechs._debug.mechs()[0].cells), cellSig(bpA.cells), 'restore uses the saved blueprint seed, not the current moved x-position');

// Corrupt or future saves cannot flood the active simulation with arbitrary list sizes.
mechs.reset();
const noisySave={v:1,list:Array.from({length:mechs._debug.CFG.MAX_ACTIVE+5},(_,i)=>({
  id:i+1, kind:i%2?'solar':'forge', x:6100+i*40, y:14, hp:20, maxHp:20,
  pilotHp:5, pilotMaxHp:5, pilotAlive:true, facing:1, salvageSeed:6100+i
}))};
assert.equal(mechs.restore(noisySave,getTile), true, 'oversized mech snapshots are accepted defensively');
assert.equal(mechs.metrics().count, mechs._debug.CFG.MAX_ACTIVE, 'restore caps active mechs to the simulation maximum');

console.log('mechs-sim ok');
