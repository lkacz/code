// Steam circuit contract (engine/steam_machines.js + mech flight in mechs.js):
//  1. KOCIOŁ PAROWY physics — drinks REAL adjacent water tiles (volume-true:
//     one tile = WATER_PER_TILE units), boils only with heat (electric heat
//     drains the network at the pinned rate; lava/embers beside the shell heat
//     for free), and over-pressure vents REAL T.STEAM gas cells.
//  2. DYSZA PAROWA updraft — a fed jet lifts the hero and loose drops in its
//     open column (blocked columns lift nothing), burns pressure faster while
//     actually lifting, and notes the steam_lift discovery.
//  3. Steam airship — chair + hull + boiler + a full bottom row of jets
//     assembles as drive 'steam'; W burns boiler steam for real upward thrust,
//     no steam means no lift; boiler tanks survive the park/assemble round
//     trip through steam_machines.primeBoilerAt.
//  4. Save + wiring — boiler tanks snapshot/restore; world.setTile notifies
//     the registry; recipes, picker group and journal entries exist.
//  5. Hardening pins — a fallen boiler keeps its tank (orphan stash, one-shot,
//     same column only); steam flight belongs to variant 'steam' alone (a jet
//     bolted mid-hull onto a tracks mech is dormant cargo); hull boiler tanks
//     ride the MECH save (a reloaded airship must not fall out of the sky);
//     assembly leaves no charged orphan behind (no tank duplication).
// Run: node tools/steam-machines-sim.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.CustomEvent = globalThis.CustomEvent || class { constructor(type,opts){ this.type=type; this.detail=opts&&opts.detail; } };
globalThis.dispatchEvent = () => true;
globalThis.msg = () => {};
globalThis.inv = {};
globalThis.player = {x:0,y:0,w:0.7,h:0.95,vx:0,vy:0,onGround:true,hp:100,maxHp:100,energy:0,maxEnergy:120};
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
globalThis.damageHero = () => true;
const infra=new Map();
const infraKey=(x,y)=>Math.floor(x)+','+Math.floor(y);
globalThis.MM.world={
  getInfrastructureStack(x,y){ const s=infra.get(infraKey(x,y)); return s?[...s]:[]; },
  hasInfrastructure(x,y,t){ return (infra.get(infraKey(x,y))||[]).includes(t); },
  setInfrastructure(x,y,t){ const k=infraKey(x,y); const s=infra.get(k)||[]; if(!s.includes(t)) s.push(t); infra.set(k,s); },
  clearInfrastructure(x,y,t){ const k=infraKey(x,y); const s=infra.get(k)||[]; const i=s.indexOf(t); if(i>=0) s.splice(i,1); if(!s.length) infra.delete(k); }
};
// controllable stubs for the machine's neighbours
let drainedEnergy=0, offeredEnergy=Infinity;
globalThis.MM.dynamo={ absorbNear(x,y,need){ const got=Math.min(need,offeredEnergy); drainedEnergy+=got; return {amount:got}; } };
const gasAdds=[];
globalThis.MM.gases={ add(kind,x,y){ gasAdds.push({kind,x,y}); return 1; } };
globalThis.MM.particles={ spawnSmoke(){}, spawnBurst(){} };
const notes=[];
globalThis.MM.discovery={ note(id){ if(!notes.includes(id)) notes.push(id); return true; } };

const { T, INFO } = await import('../src/constants.js');
const { worldGen } = await import('../src/engine/worldgen.js');
const { steamMachines: SM } = await import('../src/engine/steam_machines.js');
const { mechs } = await import('../src/engine/mechs.js');
assert.ok(SM && SM.CFG, 'steam machines module exports its physics table');
const CFG=SM.CFG;

worldGen.surfaceHeight = () => 20;
const tiles=new Map();
const K=(x,y)=>Math.floor(x)+','+Math.floor(y);
const setTile=(x,y,t)=>{
  const old=tiles.get(K(x,y)) ?? (y>=20?T.STONE:T.AIR);
  tiles.set(K(x,y),t);
  SM.onTileChanged(Math.floor(x),Math.floor(y),old,t); // world.js does this in-game
};
const getTile=(x,y)=>{
  const k=K(x,y);
  if(tiles.has(k)) return tiles.get(k);
  return y>=20 ? T.STONE : T.AIR;
};
function tick(n,dt){ for(let i=0;i<n;i++) SM.update(dt||1/30,globalThis.player,getTile,setTile); }

// --- 1. boiler: water intake + electric heat --------------------------------
SM.reset();
globalThis.player.x=6; globalThis.player.y=18;
setTile(5,18,T.STEAM_BOILER);
setTile(4,18,T.WATER);
drainedEnergy=0; offeredEnergy=Infinity;
tick(1);
const b=SM.boilerAt(5,18);
assert.ok(b, 'placed boiler registers (setTile notification)');
assert.equal(getTile(4,18), T.AIR, 'boiler drinks the adjacent water tile whole');
assert.equal(Math.round(b.water+b.steam/CFG.STEAM_PER_WATER), CFG.WATER_PER_TILE, 'the tank is volume-true: one tile of water entered the system');
tick(60); // 2 seconds of boiling
assert.ok(b.steam > CFG.BOIL_RATE*1.6 && b.steam <= CFG.BOIL_RATE*2.4, 'electric heat boils at the pinned rate (got '+b.steam.toFixed(2)+')');
assert.ok(drainedEnergy > CFG.BOIL_ENERGY_PER_SEC*1.5, 'electric heat drains the power network');
// no power, no lava -> boiling stalls
offeredEnergy=0;
const steamBefore=b.steam;
tick(30);
assert.ok(Math.abs(b.steam-steamBefore) < 0.001, 'without heat the boiler makes no steam');

// --- 1b. lava heats for free -------------------------------------------------
setTile(9,18,T.STEAM_BOILER);
setTile(8,18,T.WATER);
setTile(9,17,T.LAVA);
tick(1);
const bl=SM.boilerAt(9,18);
tick(45);
assert.ok(bl.steam > 1.5, 'lava beside the shell boils with zero electric cost');
assert.equal(SM.metrics().lavaHeat > 0, true, 'free heat is accounted as lava heat');

// --- 1c. over-pressure vents REAL steam gas ----------------------------------
gasAdds.length=0;
SM.primeBoilerAt(5,18, 10, CFG.BOILER_STEAM_CAP*0.95);
tick(2);
assert.ok(gasAdds.some(g=>g.kind==='steam' && g.x===5 && g.y===17), 'safety valve vents T.STEAM gas above the boiler');
assert.ok(SM.boilerAt(5,18).steam < CFG.BOILER_STEAM_CAP*0.95, 'venting costs pressure');

// --- 2. jet updraft ------------------------------------------------------------
SM.reset();
setTile(12,19,T.STEAM_JET);
setTile(10,19,T.STEAM_BOILER);
SM.primeBoilerAt(10,19, 0, 40);
globalThis.player.x=12.5; globalThis.player.y=16; globalThis.player.vy=0;
const drop={x:12.5,y:15,vy:0,settled:true};
globalThis.MM.drops={_debug:{list:[drop]}};
tick(15);
assert.ok(globalThis.player.vy < -1, 'the steam column lifts the hero (vy '+globalThis.player.vy.toFixed(2)+')');
assert.ok(drop.vy < 0 && drop.settled===false, 'loose drops ride the column too');
assert.ok(notes.includes('steam_lift'), 'first ride notes the steam_lift discovery');
const activeSteam=SM.boilerAt(10,19).steam;
assert.ok(activeSteam < 40, 'lifting burns boiler pressure');
// out of the column: only the idle hiss remains
globalThis.player.x=30; globalThis.player.y=5; globalThis.player.vy=0;
globalThis.MM.drops={_debug:{list:[]}};
tick(30);
const idleBurn=activeSteam-SM.boilerAt(10,19).steam;
assert.ok(idleBurn>0 && idleBurn < CFG.JET_BURN_ACTIVE, 'an unused jet only sips (idle '+idleBurn.toFixed(2)+')');
// a roofed jet moves nothing
setTile(16,19,T.STEAM_JET);
setTile(16,18,T.STEEL);
setTile(15,19,T.STEAM_BOILER);
SM.primeBoilerAt(15,19, 0, 30);
globalThis.player.x=16.5; globalThis.player.y=17; globalThis.player.vy=0;
tick(15);
assert.equal(globalThis.player.vy, 0, 'a blocked column lifts nothing');

// --- 3. steam airship ----------------------------------------------------------
SM.reset();
mechs.reset();
function sitAt(x,y){
  globalThis.player.x=x+0.5;
  globalThis.player.y=y+0.30;
  globalThis.player.vx=0; globalThis.player.vy=0;
  globalThis.player.onGround=true;
}
function settle(n,controls={}){
  for(let i=0;i<n;i++) mechs.update(1/60,globalThis.player,getTile,setTile,{controls});
}
// (201,17) chair / y18 hull with boiler / y19 full row of jets on the ground
setTile(201,17,T.CHAIR_STEEL);
setTile(200,18,T.STEEL);
setTile(201,18,T.STEEL);
setTile(202,18,T.STEAM_BOILER);
for(let x=200;x<=202;x++) setTile(x,19,T.STEAM_JET);
// world boiler pre-tanked: assembly must lift the tank into the hull
SM.primeBoilerAt(202,18, 12, 25);
sitAt(201,17);
assert.equal(mechs.trySeatFromWorld(globalThis.player,getTile,setTile,{force:true}), true, 'chair + boiler + jet row assembles');
const ship=mechs.heroMech();
assert.ok(ship && ship.kind==='built', 'hero rides the assembled hull');
assert.equal(ship.variant, 'steam', 'a full bottom row of steam jets is the steam drive');
assert.ok(Math.abs(mechs.steamTotal(ship)-25) < 0.001, 'assembly lifted the world boiler tank into the hull');
// W = thrust: the ship actually climbs
const startY=ship.y;
settle(90,{up:true});
assert.ok(ship.vy < 0 || ship.y < startY-0.5, 'held W lifts the airship on steam');
assert.ok(ship.y < startY, 'the hull gained altitude ('+(startY-ship.y).toFixed(2)+' tiles)');
assert.ok(mechs.steamTotal(ship) < 25, 'flight burns boiler steam');
assert.ok(notes.includes('steam_flight'), 'first flight notes the steam_flight discovery');
// dry boiler: thrust dies, gravity wins
const bc=ship.cells.find(c=>c.t===T.STEAM_BOILER);
ship.boilerStates[bc.dx+','+bc.dy]={water:0,steam:0};
const highY=ship.y;
settle(90,{up:true});
assert.ok(ship.y > highY, 'no steam, no lift - the ship sinks back');
// onboard boiling: hull reserve + tanked water refill the pressure mid-air
ship.boilerStates[bc.dx+','+bc.dy]={water:10,steam:0};
ship.energy=40;
settle(60,{});
assert.ok(mechs.steamTotal(ship) > 1, 'the hull reserve re-boils tanked water in flight');
assert.ok(ship.energy < 40, 'onboard boiling drinks the hull reserve');
// park pours the tank back into the world machine
const tankAtPark=mechs.steamTotal(ship)+0; // snapshot before eject
settle(4,{jump:true});
assert.equal(mechs.heroMech(), null, 'jump parks the airship');
let parkedBoiler=null;
for(const [k,v] of tiles){
  if(v!==T.STEAM_BOILER) continue;
  const comma=k.indexOf(',');
  const bx=+k.slice(0,comma), by=+k.slice(comma+1);
  if(Math.abs(bx-201)<8){ parkedBoiler=SM.boilerAt(bx,by); break; }
}
assert.ok(parkedBoiler, 'parked hull writes the boiler back as a world machine');
assert.ok(Math.abs(parkedBoiler.steam-tankAtPark) < 0.75, 'the parked boiler keeps the tank it flew with');

// --- 4. save round-trip + wiring ------------------------------------------------
const snap=SM.snapshot();
SM.reset();
assert.equal(SM.boilerAt(5,18), null, 'reset clears the registry');
SM.restore(snap,getTile);
assert.ok(parkedBoiler && SM.boilerAt(parkedBoiler.x,parkedBoiler.y), 'restore rebuilds boilers that still stand in the world');

const mainSource=readFileSync(new URL('../src/main.js', import.meta.url),'utf8');
assert.match(mainSource, /steam_boiler/, 'boiler recipe exists');
assert.match(mainSource, /steam_jet/, 'jet recipe exists');
assert.match(mainSource, /'STEAM_BOILER','STEAM_JET'/, 'both machines live in the hot-picker machine group');
assert.match(mainSource, /STEAM_MACHINES\.update\(dt, player, getTile, setTile\)/, 'main loop ticks the steam machines');
assert.match(mainSource, /steamMachines: timedSavePart/, 'boiler tanks ride the save file');
const worldSource=readFileSync(new URL('../src/engine/world.js', import.meta.url),'utf8');
assert.match(worldSource, /MM\.steamMachines\.onTileChanged/, 'world.setTile notifies the steam registry');
const discoverySource=readFileSync(new URL('../src/engine/discovery.js', import.meta.url),'utf8');
assert.match(discoverySource, /steam_lift/, 'steam_lift has a journal label');
assert.match(discoverySource, /steam_flight/, 'steam_flight has a journal label');
assert.ok(INFO[T.STEAM_BOILER] && INFO[T.STEAM_BOILER].machine==='steamBoiler', 'boiler tile is a machine (rigid-object physics route)');
assert.ok(INFO[T.STEAM_JET] && INFO[T.STEAM_JET].machine==='steamJet', 'jet tile is a machine (rigid-object physics route)');
assert.equal(INFO[T.STEAM_BOILER].energyCapacity, undefined, 'boiler stores steam pressure, never electric energy — no energyCapacity flag');
assert.ok(INFO[T.STEAM_BOILER].powerDevice && INFO[T.STEAM_BOILER].conductor, 'boiler stays wired into electric networks as a heat consumer');
const liveMetrics=SM.metrics();
assert.ok(typeof liveMetrics.pressure==='number' && typeof liveMetrics.tankedWater==='number', 'metrics expose live tank totals for QA drivers');

// --- 5. a fallen boiler keeps its tank (orphan stash) ---------------------------
// Boilers are rigid-object machines: mine their support and falling.js moves the
// tile. The position-keyed registry must hand the tank to the landed boiler
// instead of re-registering it empty (silently venting everything).
SM.reset();
setTile(40,10,T.STEAM_BOILER);
SM.primeBoilerAt(40,10, 8, 22);
setTile(40,10,T.AIR);           // support gone: the tile leaves its cell...
setTile(40,14,T.STEAM_BOILER);  // ...and lands four tiles lower, same column
const landed=SM.boilerAt(40,14);
assert.ok(landed && Math.abs(landed.water-8)<0.001 && Math.abs(landed.steam-22)<0.001, 'a fallen boiler lands with the tank it had');
setTile(40,16,T.STEAM_BOILER);
assert.equal(SM.boilerAt(40,16).steam, 0, 'orphan tanks adopt exactly once — no duplication');
setTile(44,12,T.STEAM_BOILER);
SM.primeBoilerAt(44,12, 0, 15);
setTile(44,12,T.AIR);
setTile(45,13,T.STEAM_BOILER);
assert.equal(SM.boilerAt(45,13).steam, 0, 'orphans only transfer straight down their own column');

// --- 6. hybrid guard: jets bolted mid-hull are cargo, not thrusters --------------
SM.reset(); mechs.reset();
setTile(301,17,T.CHAIR_STEEL);
setTile(300,18,T.STEAM_JET);     // mid-hull jet: NOT the bottom row
setTile(301,18,T.STEEL);
setTile(302,18,T.STEAM_BOILER);
for(let x=300;x<=302;x++) setTile(x,19,T.TRACK);
sitAt(301,17);
assert.equal(mechs.trySeatFromWorld(globalThis.player,getTile,setTile,{force:true}), true, 'tracks hull with steam cargo still assembles');
const crawler=mechs.heroMech();
assert.equal(crawler.variant, 'tracks', 'bottom row of tracks = tracks drive');
assert.equal(mechs.hasSteamDrive(crawler), false, 'steam flight belongs to the steam drive alone');
crawler.boilerStates={'2,1':{water:5,steam:30}};
const crawlerY=crawler.y;
settle(60,{up:true});
assert.ok(crawler.y >= crawlerY-0.01, 'held W does not lift a tracks hull');
assert.ok(Math.abs(mechs.steamTotal(crawler)-30) < 0.001, 'the cargo boiler stays dormant and keeps its tank');

// --- 7. hull boiler tanks ride the MECH save -------------------------------------
// Without this a steam airship saved mid-air reloads dry and falls out of the sky.
SM.reset(); mechs.reset();
setTile(401,17,T.CHAIR_STEEL);
setTile(400,18,T.STEEL); setTile(401,18,T.STEEL); setTile(402,18,T.STEAM_BOILER);
for(let x=400;x<=402;x++) setTile(x,19,T.STEAM_JET);
SM.primeBoilerAt(402,18, 6, 33);
sitAt(401,17);
assert.equal(mechs.trySeatFromWorld(globalThis.player,getTile,setTile,{force:true}), true, 'airship for the save test assembles');
const flyer=mechs.heroMech();
assert.ok(Math.abs(mechs.steamTotal(flyer)-33) < 0.001, 'hull lifted the primed tank');
assert.ok(!SM._debug.orphanTanks.some(o=>o.steam>0.01||o.water>0.01), 'assembly zeroes the world entry — no charged orphan left to duplicate');
const mechSnap=mechs.snapshot();
mechs.reset();
assert.equal(mechs.restore(mechSnap,getTile), true, 'mech snapshot restores');
const reloaded=mechs._debug.mechs().find(m=>m.kind==='built');
assert.ok(reloaded && reloaded.variant==='steam', 'restored hull keeps the steam drive');
assert.ok(Math.abs(mechs.steamTotal(reloaded)-33) < 0.001, 'hull boiler tank survives the save round-trip (water+steam)');
assert.ok(Math.abs((reloaded.boilerStates['2,1']||{}).water-6) < 0.001, 'tanked water survives too');

console.log('OK steam-machines-sim: boiler water/heat/steam physics, venting, jet updraft, steam airship flight + park continuity, save & UI wiring, fall/hybrid/mech-save hardening');
