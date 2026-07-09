// Alien mech simulation contract.
// Far-world mechs are block machines with real power-source parts,
// separate pilot/hull defeat paths, boarding, armor absorption, tree crushing,
// block collapse, pilot loot and save/restore support.
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
  waterTurret:0, steelTrapdoor:0, glass:0, coal:5
};
globalThis.player = {x:0,y:0,w:0.7,h:0.95,vx:0,vy:0,onGround:false,hp:100,maxHp:100,xp:0,energy:0,maxEnergy:120};
globalThis.MM.heroEnergy = {
  info(){ return {energy:globalThis.player.energy||0, max:globalThis.player.maxEnergy||120}; },
  canSpend(n){ return (globalThis.player.energy||0)+1e-6 >= Math.max(0,Number(n)||0); },
  spend(n){
    const cost=Math.max(0,Number(n)||0);
    if((globalThis.player.energy||0)+1e-6 < cost) return false;
    globalThis.player.energy=Math.max(0,(globalThis.player.energy||0)-cost);
    return true;
  }
};
globalThis.damageHero = (amount,opts) => {
  globalThis.player.hp -= Math.round(amount);
  events.push({type:'damageHero',detail:{amount,opts}});
  return true;
};

const { T, INFO } = await import('../src/constants.js');
const { worldGen } = await import('../src/engine/worldgen.js');
const { mechs } = await import('../src/engine/mechs.js');
await import('../src/engine/dynamo.js'); // mech dynamos charge through the shared machine

const mechsSource = readFileSync(new URL('../src/engine/mechs.js', import.meta.url),'utf8');
assert.match(mechsSource, /function drawAlienTeamPilotMini/, 'cockpit renders a real alien-team-style pilot, not a placeholder icon');
assert.match(mechsSource, /function drawCockpitGlassForeground/, 'cockpit keeps a normal glass pane in front of the pilot');
assert.match(mechsSource, /cx:1\.22/, 'pilot is rendered in the empty cabin bay behind the front glass block');
assert.doesNotMatch(mechsSource, /ctx\.arc\(cx,cy,TILE\*\(role==='cockpit'\?0\.18:0\.22\)/, 'old circular cockpit icon is not used');
assert.match(mechsSource, /TURRETS\.fireMountedAt/, 'hostile mech weapons delegate to the existing turret engine');
assert.doesNotMatch(mechsSource, /\bprojectiles\b|PROJECTILE_CAP|function shootAt|function updateProjectiles/, 'mechs do not keep a special projectile/bullet system');

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
function wireAt(cells,x,y){
  return (cells.find(c=>c.dx===x && c.dy===y) || {}).wire ?? T.AIR;
}
function countTileNear(t,cx,cy,r=8){
  let n=0;
  for(const [raw,v] of tiles){
    if(v!==t) continue;
    const comma=raw.indexOf(',');
    const x=+raw.slice(0,comma), y=+raw.slice(comma+1);
    if(Math.abs(x-cx)<=r && Math.abs(y-cy)<=r) n++;
  }
  return n;
}
function assertForgeMatrix(bp,baseRole){
  const baseTile=baseRole==='track' ? T.TRACK : T.STEEL;
  const rows=[
    [T.STEEL,T.STEEL_TRAPDOOR,T.STEEL,T.AIR,T.AIR],
    [T.GLASS,T.AIR,T.DYNAMO,T.DYNAMO_SLOT,T.DYNAMO],
    [T.STEEL,T.STEEL,T.STEEL,T.AIR,T.FIRE_TURRET],
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
  assert.equal(roleAt(bp.cells,4,2),'turret', 'side weapon is a real turret block, not a mech-only gun');
  for(const x of [1,2,3]) assert.equal(roleAt(bp.cells,x,5),baseRole, `bottom drive block ${x} is ${baseRole}`);
}

mechs.reset();

const forgeBp=mechs._debug.makeBlueprint('forge',6100);
assert.equal(forgeBp.name,'Forge mech', 'forge prototype is the hard-coded primary steel design');
assertForgeMatrix(forgeBp,'leg');
assert.equal(forgeBp.cells.filter(c=>c.t===T.DYNAMO).length,2, 'forge mech uses the two real dynamo casing blocks');
assert.equal(forgeBp.cells.filter(c=>c.t===T.DYNAMO_SLOT).length,1, 'forge mech uses the real middle dynamo slot');
assert.equal(forgeBp.cells.filter(c=>c.t===T.COAL).length,1, 'forge mech carries one coal block as cargo/salvage (dynamos are flow-powered, coal never burns for energy)');
assert.equal(forgeBp.cells.filter(c=>c.role==='turret' && c.t===T.FIRE_TURRET).length,1, 'forge mech mounts the existing craftable fire turret');
assert.equal(forgeBp.cells.some(c=>c.t===T.SPRING_PLATFORM), false, 'forge primary design does not hide a special spring block');
assert.equal(forgeBp.cells.some(c=>c.t===T.LAVA), false, 'forge mech no longer fakes heat with a lava block');
assert.equal(forgeBp.cells.some(c=>c.t===T.ELECTRONICS || c.t===T.COPPER_WIRE || c.t===T.WIRE), false, 'forge prototype has no hidden electronics or wires');
assert.equal(forgeBp.cells.some(c=>['pilot','electronics','wire','rotor','power','frontPlate','rightFrame','engine','burner','spring','gun','weapon'].includes(c.role)), false, 'forge prototype has no mech-only fake subsystem roles');
const crawlerBp=mechs._debug.makeBlueprint('forge',6000);
assert.equal(crawlerBp.name,'Forge crawler', 'some forge seeds create a tracked crawler variant');
assertForgeMatrix(crawlerBp,'track');
assert.equal(crawlerBp.cells.filter(c=>c.role==='track' && c.t===T.TRACK).length,3, 'crawler uses a three-block real track base');
assert.equal(crawlerBp.cells.filter(c=>c.wire===T.COPPER_WIRE).length,7, 'crawler overlays a real copper-wire harness from dynamo to tracks');
assert.equal(tileAt(crawlerBp.cells,2,3),T.STEEL, 'crawler wire can run over a normal steel body block');
assert.equal(wireAt(crawlerBp.cells,2,3),T.COPPER_WIRE, 'crawler body block carries copper wire as an overlay, not a fake tile');
assert.equal(wireAt(crawlerBp.cells,2,1),T.COPPER_WIRE, 'crawler wire starts on the real dynamo casing');
assert.equal(wireAt(crawlerBp.cells,2,5),T.COPPER_WIRE, 'crawler wire reaches the real center track block');
assert.equal(crawlerBp.cells.some(c=>c.t===T.SPRING_PLATFORM), false, 'crawler tracks are track blocks, not a hidden spring machine');
assert.equal(INFO[T.TRACK].drop,'track', 'tracked crawler base salvages into the same placeable track resource');
assert.ok(crawlerBp.cells.every(c=>[T.STEEL,T.STEEL_TRAPDOOR,T.TRACK,T.GLASS,T.COAL,T.DYNAMO,T.DYNAMO_SLOT,T.FIRE_TURRET].includes(c.t)), 'crawler is made only from exact placeable prototype blocks');
globalThis.player.x=6000;
globalThis.player.y=15;
let debugForge=mechs.forceSpawn('forge',globalThis.player,getTile,setTile);
assert.equal(debugForge.name,'Forge mech', 'debug spawn forge always gives the leg prototype');
assertForgeMatrix({cells:debugForge.cells,bounds:debugForge._bounds},'leg');
mechs.reset();
globalThis.player.x=6300;
globalThis.player.y=15;
const instantDebugForge=mechs.forceSpawn('forge',globalThis.player,getTile,setTile);
const instantCx=Math.floor(instantDebugForge.x+2.5), instantCy=Math.floor(instantDebugForge.y+2.5);
const instantDynamoBefore=countTileNear(T.DYNAMO,instantCx,instantCy);
const instantBody=cellOf(instantDebugForge,'body');
mechs.damageAt(Math.floor(instantDebugForge.x+instantBody.dx),Math.floor(instantDebugForge.y+instantBody.dy),999,{source:'debug'});
assert.equal(instantDebugForge.destroyed,true, 'debug-spawned mech can be destroyed before its first update tick');
assert.ok(countTileNear(T.DYNAMO,instantCx,instantCy)>instantDynamoBefore, 'immediately destroyed debug mech still collapses into real dynamo blocks');
mechs.reset();
globalThis.player.x=5990;
debugForge=mechs.forceSpawn('forge_tracks',globalThis.player,getTile,setTile);
assert.equal(debugForge.name,'Forge crawler', 'debug spawn crawler always gives the tracked prototype');
assertForgeMatrix({cells:debugForge.cells,bounds:debugForge._bounds},'track');
const groundTrack=debugForge.cells.find(c=>c.role==='track');
const groundTrackBottom0=debugForge.y+groundTrack.dy+1;
assert.equal(groundTrackBottom0,20, 'crawler tracks spawn exactly on top of the terrain tile');
settle(180,globalThis.player,{});
assert.equal(+(debugForge.y+groundTrack.dy+1).toFixed(4),20, 'idle crawler tracks do not sink fractionally into the terrain under gravity');
assert.equal(getTile(Math.floor(debugForge.x+groundTrack.dx),Math.floor(debugForge.y+groundTrack.dy+1)),T.STONE, 'crawler track has solid support immediately below it');
mechs.reset();
const solarBp=mechs._debug.makeBlueprint('solar',-6100);
assert.equal(solarBp.name,'Solar hopper', 'solar prototype follows the same hopper chassis');
assert.ok(solarBp.cells.filter(c=>c.t===T.SOLAR_PANEL).length>=4, 'solar mech carries exposed solar panels');
assert.ok(solarBp.cells.some(c=>c.t===T.SOLAR_BATTERY), 'solar mech has a solar battery power core');
assert.ok(solarBp.cells.some(c=>c.role==='turret' && c.t===T.TURRET), 'solar mech mounts the existing craftable standard turret');
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

// Hostile mech weaponry is a real mounted turret, not a bespoke mech bullet.
mechs.reset();
if(globalThis.MM.turrets && globalThis.MM.turrets.reset) globalThis.MM.turrets.reset();
globalThis.player.hp=100;
globalThis.player.x=6000;
globalThis.player.y=15;
const gunner=mechs.forceSpawn('forge',globalThis.player,getTile);
settle(30);
globalThis.player.x=gunner.x+8;
globalThis.player.y=gunner.y+2.1;
const hpBeforeTurret=globalThis.player.hp;
const shotsBeforeTurret=globalThis.MM.turrets.metrics().shots;
settle(180);
assert.ok(globalThis.MM.turrets.metrics().shots>shotsBeforeTurret, 'hostile mech fires through the shared turret engine');
assert.ok(globalThis.player.hp<hpBeforeTurret, 'mounted turret damages the hero through the normal damageHero path');
assert.ok(gunner.energy<gunner.maxEnergy, 'mounted turret spends the mech energy reserve');
globalThis.player.hp=100;

// The gun is a real turret block wired into the mech's own dynamo/solar network:
// it draws power the same way a placed turret does, never from a private pool.
assert.equal(mechs._debug.mechTurretCircuitConnected(gunner), true, 'forge turret is powered by the dynamo casing it is bolted to');
const gunnerDynamo=gunner.cells.find(c=>c.dx===4 && c.dy===1);
assert.equal(gunnerDynamo.t,T.DYNAMO, 'a real dynamo casing sits directly above the turret block');
gunnerDynamo.t=T.STEEL;                       // steel neither conducts nor generates
assert.equal(mechs._debug.mechTurretCircuitConnected(gunner), false, 'a turret cut off from every power source loses its circuit');
globalThis.MM.turrets.reset();
gunner.energy=gunner.maxEnergy;
globalThis.player.x=gunner.x+8;
globalThis.player.y=gunner.y+2.1;
const shotsStranded=globalThis.MM.turrets.metrics().shots;
settle(200);
assert.equal(globalThis.MM.turrets.metrics().shots,shotsStranded, 'a stranded turret cannot fire off the hull reserve');
assert.equal(globalThis.player.hp,100, 'a stranded turret cannot hurt the hero');
gunnerDynamo.wire=T.COPPER_WIRE;              // existing tech: run copper wire back to the dynamo bank
assert.equal(mechs._debug.mechTurretCircuitConnected(gunner), true, 'copper wire re-links the turret to the dynamo bank');
const shotsRewired=globalThis.MM.turrets.metrics().shots;
settle(220);
assert.ok(globalThis.MM.turrets.metrics().shots>shotsRewired, 'a re-wired turret fires again');
globalThis.player.hp=100;

// Solar hopper: the same rule, fed by its solar battery instead of a dynamo.
mechs.reset();
globalThis.player.x=-6200;
globalThis.player.y=15;
const solarGun=mechs.forceSpawn('solar',globalThis.player,getTile);
settle(20);
const solarBattery=solarGun.cells.find(c=>c.dx===4 && c.dy===1);
assert.equal(solarBattery.t,T.SOLAR_BATTERY, 'solar battery sits directly above the solar turret');
assert.equal(mechs._debug.mechTurretCircuitConnected(solarGun), true, 'solar turret is powered by its battery');
solarBattery.t=T.STEEL;
assert.equal(mechs._debug.mechTurretCircuitConnected(solarGun), false, 'solar turret dies when its battery is gone');
globalThis.player.hp=100;

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

// A pilotless hull that still has a live turret circuit turns the gun on the
// nearest hostile, exactly like a placed turret defending the base.
{
  const savedMobs=globalThis.MM.mobs;
  let defMobHp=70, defMobDmg=0;
  globalThis.MM.mobs={
    nearestLiving(){ return defMobHp>0 ? {x:mech.x+5.5,y:mech.y+2.2,hp:defMobHp,species:'ZOMBIE'} : null; },
    damageAt(tx,ty,d){ defMobHp-=d; defMobDmg+=d; return true; },
    collideMech(){ return null; }
  };
  if(globalThis.MM.turrets && globalThis.MM.turrets.reset) globalThis.MM.turrets.reset();
  mech.energy=mech.maxEnergy;
  globalThis.player.x=mech.x-40; // hero far away: only the mob is a target
  const defShots=globalThis.MM.turrets.metrics().shots;
  settle(240);
  assert.ok(globalThis.MM.turrets.metrics().shots>defShots, 'captured hull turret engages a hostile mob on its own');
  assert.ok(defMobDmg>0, 'captured hull turret damages the mob through the shared engine');
  assert.ok(mech.energy<mech.maxEnergy, 'defensive fire spends the captured hull reserve');
  globalThis.MM.mobs=savedMobs;
}
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

// Leaving and destroying the hull collapses it into its real blocks.
assert.equal(mechs.toggleBoard(globalThis.player,getTile), true, 'interaction key exits the mech');
assert.equal(mechs.heroMech(), null, 'hero is no longer riding after exit');
const collapseCx=Math.floor(mech.x+2.5), collapseCy=Math.floor(mech.y+2.5);
const invBeforeCollapse={dynamo:globalThis.inv.dynamo,steel:globalThis.inv.steel,fireTurret:globalThis.inv.fireTurret};
const beforeCollapse={
  steel:countTileNear(T.STEEL,collapseCx,collapseCy),
  dynamo:countTileNear(T.DYNAMO,collapseCx,collapseCy),
  hatch:countTileNear(T.STEEL_TRAPDOOR,collapseCx,collapseCy),
  glass:countTileNear(T.GLASS,collapseCx,collapseCy),
  coal:countTileNear(T.COAL,collapseCx,collapseCy),
  turret:countTileNear(T.FIRE_TURRET,collapseCx,collapseCy)
};
mechs.blastRadius(mech.x+2.5,mech.y+2.5,8,999,{source:'hero'});
assert.equal(globalThis.inv.dynamo,invBeforeCollapse.dynamo, 'destroyed forge mech no longer grants a dynamo directly to inventory');
assert.equal(globalThis.inv.steel,invBeforeCollapse.steel, 'destroyed forge mech no longer grants structural steel directly to inventory');
assert.equal(globalThis.inv.fireTurret,invBeforeCollapse.fireTurret, 'destroyed forge mech no longer grants its turret directly to inventory');
assert.ok(countTileNear(T.STEEL,collapseCx,collapseCy)>beforeCollapse.steel, 'destroyed forge mech collapses into real steel world blocks');
assert.ok(countTileNear(T.DYNAMO,collapseCx,collapseCy)>beforeCollapse.dynamo, 'destroyed forge mech leaves real dynamo casing blocks in the world');
assert.ok(countTileNear(T.STEEL_TRAPDOOR,collapseCx,collapseCy)>beforeCollapse.hatch, 'destroyed forge mech leaves its real steel hatch block in the world');
assert.ok(countTileNear(T.GLASS,collapseCx,collapseCy)>beforeCollapse.glass, 'destroyed forge mech leaves its real glass cockpit block in the world');
assert.ok(countTileNear(T.COAL,collapseCx,collapseCy)>beforeCollapse.coal, 'destroyed forge mech leaves its coal block in the world');
assert.ok(countTileNear(T.FIRE_TURRET,collapseCx,collapseCy)>beforeCollapse.turret, 'destroyed forge mech leaves the real fire turret block in the world');
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
const stuckX=powerless.x;
settle(80,globalThis.player,{right:true});
assert.ok(Math.abs(powerless.x-stuckX)<0.05, 'captured mech does not walk with an empty reserve');
// The mech-mounted dynamo IS the world machine: steam/water flow recorded
// through the shared DYNAMO.recordFlow path lands in the hull battery.
const powerSlot=powerless.cells.find(c=>c.t===T.DYNAMO_SLOT);
let flowHits=0;
for(let i=0;i<24;i++){
  if(globalThis.MM.dynamo.recordFlow(Math.floor(powerless.x+powerSlot.dx),Math.floor(powerless.y+powerSlot.dy),T.STEAM,2,getTile)) flowHits++;
}
assert.ok(flowHits>0, 'steam flow through the mech slot drives the shared dynamo implementation');
assert.ok(powerless.energy>1, 'recorded flow charges the mech battery');
settle(80,globalThis.player,{right:true});
assert.ok(powerless.x>stuckX+0.2, 'captured forge mech walks again once flow recharges its reserve');
assert.ok(powerless.energy<mechs._debug.CFG.ENERGY_FORGE_CAP, 'walking spends the captured mech reserve');
// Full battery: the turbine still passes flow (gas can be consumed) but never overfills,
// and no phantom WORLD machine record accumulates energy at the mech slot.
powerless.energy=powerless.maxEnergy;
const fullSlotX=Math.floor(powerless.x+powerSlot.dx), fullSlotY=Math.floor(powerless.y+powerSlot.dy);
assert.equal(globalThis.MM.dynamo.recordFlow(fullSlotX,fullSlotY,T.WATER,3,getTile), true, 'flow still passes a full mech dynamo');
assert.equal(powerless.energy,powerless.maxEnergy, 'full mech reserve is clamped, never overfilled');
assert.equal(globalThis.MM.dynamo.energyAt(fullSlotX,fullSlotY,getTile), 0, 'no world machine record shadows the mech-carried slot');
assert.equal(mechs.toggleBoard(globalThis.player,getTile), true, 'power test exits captured mech');

// A tracked abandoned mech can be driven like a boat by standing on it.
// The crawler itself must have a real copper-wire circuit from dynamo to tracks;
// when the mech battery is empty, the hero can still pay the track cost from
// stored hero energy, matching other electric devices.
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
assert.equal(mechs.heroOnTracks(globalThis.player),crawler, 'live track query detects the hero standing on the crawler deck');
crawler.energy=0;
globalThis.player.energy=0;
const crawlerStuckX=crawler.x;
settle(80,globalThis.player,{right:true});
assert.ok(Math.abs(crawler.x-crawlerStuckX)<0.05, 'standing on an empty crawler does not move it for free without hero energy');
globalThis.player.energy=20;
globalThis.player.x=crawler.x+deck.dx+0.5;
globalThis.player.y=crawler.y+deck.dy-(globalThis.player.h||0.95)/2+0.03;
const heroEnergyBeforeTracks=globalThis.player.energy;
settle(120,globalThis.player,{right:true});
assert.ok(crawler.x>crawlerStuckX+0.15, 'standing on a wired crawler can spend hero energy to drive tracks like a boat');
assert.ok(globalThis.player.energy<heroEnergyBeforeTracks, 'hero energy is consumed by standalone track driving');
assert.ok(globalThis.player.x>crawlerStuckX+deck.dx+0.55, 'standing rider is carried along with the tracked mech');
crawler.energy=5;
globalThis.player.energy=30;
globalThis.player.x=crawler.x+deck.dx+0.5;
globalThis.player.y=crawler.y+deck.dy-(globalThis.player.h||0.95)/2+0.03;
const mechReserveX=crawler.x, heroEnergyBeforeReserve=globalThis.player.energy, crawlerEnergyBeforeReserve=crawler.energy;
settle(80,globalThis.player,{right:true});
assert.ok(crawler.x>mechReserveX+0.1, 'standing track drive first uses the crawler reserve when it is available');
assert.equal(globalThis.player.energy,heroEnergyBeforeReserve, 'standing track drive does not spend hero energy while crawler reserve can pay');
assert.ok(crawler.energy<crawlerEnergyBeforeReserve, 'crawler reserve is actually consumed by standing track drive');
const oldDynamo=globalThis.MM.dynamo;
let externalTrackDrain=0;
globalThis.MM.dynamo={
  absorbNear(x,y,need,gt,radius){
    externalTrackDrain+=Math.max(0,Number(need)||0);
    return {amount:Math.max(0,Number(need)||0)};
  }
};
crawler.energy=0;
globalThis.player.energy=30;
globalThis.player.x=crawler.x+deck.dx+0.5;
globalThis.player.y=crawler.y+deck.dy-(globalThis.player.h||0.95)/2+0.03;
const externalDriveX=crawler.x, heroEnergyBeforeExternal=globalThis.player.energy;
settle(80,globalThis.player,{left:true});
assert.ok(crawler.x<externalDriveX-0.1, 'standing track drive can draw from an external power source before hero energy');
assert.equal(globalThis.player.energy,heroEnergyBeforeExternal, 'external track power prevents hero-energy drain');
assert.ok(externalTrackDrain>0, 'external dynamo source is queried for standing track drive');
globalThis.MM.dynamo=oldDynamo;
crawler.energy=8;
globalThis.player.energy=30;
globalThis.player.x=crawler.x+deck.dx+0.5;
globalThis.player.y=crawler.y+deck.dy-(globalThis.player.h||0.95)/2+0.03;
globalThis.player.vx=0;
globalThis.player.vy=0;
globalThis.player.onGround=true;
const jumpOffX=crawler.x;
settle(2,globalThis.player,{right:true,jump:true});
assert.ok(Math.abs(crawler.x-jumpOffX)<0.03, 'jump while standing on tracks does not jump or drive the crawler');
assert.ok(globalThis.player.vy< -0.1 && !globalThis.player.onGround, 'jump while standing on tracks releases the hero from the crawler');
assert.equal(mechs.heroOnTracks(globalThis.player),null, 'after jumping off, the hero is no longer considered to be riding the tracks');
const brokenWire=crawler.cells.find(c=>c.dx===2 && c.dy===4);
delete brokenWire.wire;
crawler.energy=40;
crawler.vx=0;
crawler.vy=0;
globalThis.player.energy=40;
globalThis.player.x=crawler.x+deck.dx+0.5;
globalThis.player.y=crawler.y+deck.dy-(globalThis.player.h||0.95)/2+0.03;
globalThis.player.vx=0;
globalThis.player.vy=0;
globalThis.player.onGround=true;
const brokenCircuitX=crawler.x;
settle(100,globalThis.player,{right:true});
assert.ok(Math.abs(crawler.x-brokenCircuitX)<0.05, 'crawler tracks refuse movement when copper wire no longer joins dynamo to tracks');

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

// A ridden mech that breaks under incoming damage ejects once and collapses once.
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
const armorCx=Math.floor(armored.x+2.5), armorCy=Math.floor(armored.y+2.5);
const worldDynBeforeBreak=countTileNear(T.DYNAMO,armorCx,armorCy);
const brokenGuard=mechs.absorbHeroDamage(10000,{cause:'stress'},globalThis.player);
assert.ok(brokenGuard && brokenGuard.absorbed>0, 'ridden armor absorbs the fatal stress hit');
assert.equal(mechs.heroMech(), null, 'destroyed ridden mech ejects the hero immediately');
const dynAfterBreak=globalThis.inv.dynamo;
assert.equal(dynAfterBreak,dynBeforeBreak, 'destroyed ridden mech does not grant direct inventory salvage');
assert.ok(countTileNear(T.DYNAMO,armorCx,armorCy)>worldDynBeforeBreak, 'destroyed ridden mech collapses its dynamo blocks into the world');
const worldDynAfterBreak=countTileNear(T.DYNAMO,armorCx,armorCy);
mechs.blastRadius(armored.x+2.5,armored.y+2.5,8,999,{source:'hero'});
assert.equal(globalThis.inv.dynamo,dynAfterBreak, 'already-destroyed mech cannot award duplicate salvage');
assert.equal(countTileNear(T.DYNAMO,armorCx,armorCy),worldDynAfterBreak, 'already-destroyed mech cannot collapse duplicate blocks');
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
const mountedStuckX=restoredMounted.x;
settle(70,globalThis.player,{right:true});
assert.ok(Math.abs(restoredMounted.x-mountedStuckX)<0.05, 'restored mounted mech still refuses free movement without power');
const restoredSlot=restoredMounted.cells.find(c=>c.t===T.DYNAMO_SLOT);
for(let i=0;i<24;i++) globalThis.MM.dynamo.recordFlow(Math.floor(restoredMounted.x+restoredSlot.dx),Math.floor(restoredMounted.y+restoredSlot.dy),T.STEAM,2,getTile);
settle(90,globalThis.player,{right:true});
assert.ok(restoredMounted.x>mountedStuckX+0.2, 'restored mounted forge mech recharges through the shared dynamo after load');
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
