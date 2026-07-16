// Player-built mech contract.
// A chair-crowned block machine (full bottom row of tracks) assembles straight
// from the world grid into a drivable mech, drives left/right on onboard or
// hero energy through the pilot chair, and parks back into the exact same
// editable blocks on jump. Mech-mounted dynamos are the ONE placed machine
// (engine/dynamo.js): wind plus water/steam/hot-air flow — never coal or lava.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.CustomEvent = globalThis.CustomEvent || class { constructor(type,opts){ this.type=type; this.detail=opts&&opts.detail; } };
const events=[];
globalThis.dispatchEvent = ev => { events.push(ev); return true; };
globalThis.msg = text => { events.push({type:'msg',detail:{text}}); };
globalThis.inv = { coal:5, steel:0, track:0, chairWood:0, chairStone:0, chairSteel:0 };
globalThis.player = {x:0,y:0,w:0.7,h:0.95,vx:0,vy:0,onGround:true,hp:100,maxHp:100,xp:0,energy:0,maxEnergy:120};
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

// Minimal world-infrastructure overlay layer (copper wire / ladders on blocks)
const infra=new Map();
const infraKey=(x,y)=>Math.floor(x)+','+Math.floor(y);
globalThis.MM.world={
  getInfrastructureStack(x,y){ const s=infra.get(infraKey(x,y)); return s?[...s]:[]; },
  hasInfrastructure(x,y,t){ return (infra.get(infraKey(x,y))||[]).includes(t); },
  setInfrastructure(x,y,t){ const k=infraKey(x,y); const s=infra.get(k)||[]; if(!s.includes(t)) s.push(t); infra.set(k,s); },
  clearInfrastructure(x,y,t){ const k=infraKey(x,y); const s=infra.get(k)||[]; const i=s.indexOf(t); if(i>=0) s.splice(i,1); if(!s.length) infra.delete(k); }
};

const { T, INFO } = await import('../src/constants.js');
const { worldGen } = await import('../src/engine/worldgen.js');
const { mechs } = await import('../src/engine/mechs.js');
await import('../src/engine/dynamo.js');

// --- Source-shape contract -------------------------------------------------
const mechsSource=readFileSync(new URL('../src/engine/mechs.js', import.meta.url),'utf8');
assert.match(mechsSource, /function scanBuiltStructure/, 'built mechs are scanned from the live world grid');
assert.match(mechsSource, /function parkBuiltMech/, 'built mechs park back into world blocks');
assert.match(mechsSource, /BUILT_MAX_CELLS/, 'built-mech size is capped for scalability');
assert.match(mechsSource, /trySeatFromWorld/, 'chair seating is exposed to the main loop');
// One dynamo implementation: the mech module holds NO private generation physics
assert.match(mechsSource, /function tileOverlayAt/, 'mech cells are exposed as a tile overlay for engine/dynamo.js');
assert.match(mechsSource, /function absorbDynamoFlow/, 'flow energy is deposited by dynamo.js, not computed in mechs.js');
assert.match(mechsSource, /windEnergyPerSecAt/, 'mech wind charge delegates to the shared dynamo wind curve');
assert.doesNotMatch(mechsSource, /BUILT_WIND|BUILT_WATER|FORGE_FUEL|FORGE_CHARGE|forgeCharge|consumeForgeInventoryFuel|hasFirebox/, 'mechs.js keeps no private wind/water curves and no coal-burning dynamo fuel');
const dynamoSource=readFileSync(new URL('../src/engine/dynamo.js', import.meta.url),'utf8');
assert.match(dynamoSource, /function mechTileAt/, 'dynamo.js reads mech cells through the tile overlay');
assert.match(dynamoSource, /MM\.mechs\.absorbDynamoFlow/, 'dynamo.js routes mech-slot flow energy into the hull battery');
assert.match(dynamoSource, /function windEnergyPerSecAt/, 'dynamo.js exports its own wind response for mech-mounted slots');
const mainSource=readFileSync(new URL('../src/main.js', import.meta.url),'utf8');
assert.match(mainSource, /MECHS\.trySeatFromWorld\(player,getTile,setTile\)/, 'hero physics step attempts chair seating each frame');
assert.match(mainSource, /function drawChairTile/, 'chairs render as open seat glyphs, not filled blocks');
assert.match(mainSource, /chair_wood/, 'wood chair recipe exists');
assert.match(mainSource, /chair_stone/, 'stone chair recipe exists');
assert.match(mainSource, /chair_steel/, 'steel chair recipe exists');
const invSource=readFileSync(new URL('../src/inventory.js', import.meta.url),'utf8');
assert.match(invSource, /chairWood/, 'chair resources ride the shared resource registry');
const invUiSource=readFileSync(new URL('../src/inventory_ui.js', import.meta.url),'utf8');
assert.match(invUiSource, /wantsInteractKey/, 'E prefers mech boarding/seating over the wardrobe panel near machines');

// wantsInteractKey: E belongs to the mech system exactly when the chair crowns
// a valid machine — a plain furniture chair leaves E to the wardrobe panel.
{
  const wiTiles=new Map();
  const wiSet=(x,y,t)=>wiTiles.set(x+','+y,t);
  const wiGet=(x,y)=>wiTiles.get(Math.floor(x)+','+Math.floor(y)) ?? (y>=20?T.STONE:T.AIR);
  mechs.reset();
  const wiPlayer={x:50.5,y:16.3,w:0.7,h:0.95,onGround:true};
  mechs.update(1/60,wiPlayer,wiGet,()=>{},{}); // remember world fns
  assert.equal(mechs.wantsInteractKey(wiPlayer), false, 'away from chairs and hulls E stays with the inventory panel');
  wiSet(50,16,T.CHAIR_WOOD);
  assert.equal(mechs.wantsInteractKey(wiPlayer), false, 'a lone furniture chair does not claim the E key');
  wiSet(50,17,T.TRACK);
  wiSet(51,17,T.TRACK);
  assert.equal(mechs.wantsInteractKey(wiPlayer), true, 'a chair crowning a valid track machine claims E for the mech system');
  wiTiles.clear();
  mechs.reset();
}

// --- Chair tile contract -----------------------------------------------------
for(const [tile,mat] of [[T.CHAIR_WOOD,'wood'],[T.CHAIR_STONE,'stone'],[T.CHAIR_STEEL,'steel']]){
  assert.ok(INFO[tile], 'chair tile '+mat+' has an INFO entry');
  assert.equal(INFO[tile].chair, true, mat+' chair carries the chair flag');
  assert.equal(INFO[tile].chairMaterial, mat, mat+' chair names its material');
  assert.equal(INFO[tile].passable, true, mat+' chair is a passable seat fixture');
  assert.ok(INFO[tile].drop, mat+' chair drops its item when mined');
}
assert.equal(INFO[T.CHAIR_WOOD].flammable, true, 'wooden chair burns like other wood fixtures');

// --- Test world --------------------------------------------------------------
worldGen.surfaceHeight = () => 20;
const tiles=new Map();
const K=(x,y)=>Math.floor(x)+','+Math.floor(y);
const setTile=(x,y,t)=>tiles.set(K(x,y),t);
const getTile=(x,y)=>{
  const k=K(x,y);
  if(tiles.has(k)) return tiles.get(k);
  return y>=20 ? T.STONE : T.AIR;
};
function settle(n,controls={}){
  for(let i=0;i<n;i++) mechs.update(1/60,globalThis.player,getTile,setTile,{controls});
}
function countTileNear(t,cx,cy,r=10){
  let n=0;
  for(const [raw,v] of tiles){
    if(v!==t) continue;
    const comma=raw.indexOf(',');
    const x=+raw.slice(0,comma), y=+raw.slice(comma+1);
    if(Math.abs(x-cx)<=r && Math.abs(y-cy)<=r) n++;
  }
  return n;
}
function sitAt(x,y){
  globalThis.player.x=x+0.5;
  globalThis.player.y=y+0.30;
  globalThis.player.vx=0;
  globalThis.player.vy=0;
  globalThis.player.onGround=true;
}
function seat(){ return mechs.trySeatFromWorld(globalThis.player,getTile,setTile,{force:true}); }

// --- Scenario 1: hero-energy crawler (no onboard power source) ---------------
// (101,17) chair / y18 steel x4 / y19 tracks x4 on stone ground
mechs.reset();
setTile(101,17,T.CHAIR_WOOD);
for(let x=100;x<=103;x++) setTile(x,18,T.STEEL);
for(let x=100;x<=103;x++) setTile(x,19,T.TRACK);
sitAt(101,17);
assert.equal(seat(), true, 'standing in the chair assembles the valid track machine');
const crawler=mechs.heroMech();
assert.ok(crawler && crawler.kind==='built', 'assembled machine is a built-kind mech ridden by the hero');
assert.equal(crawler.variant,'tracks', 'bottom row of tracks makes a track-drive mech');
assert.equal(crawler.cells.length,9, 'all nine placed blocks became mech cells');
assert.equal(getTile(101,17),T.AIR, 'chair was carved out of the world grid');
assert.equal(getTile(100,19),T.AIR, 'tracks were carved out of the world grid');
assert.ok(crawler.cells.some(c=>c.role==='chair'), 'chair cell keeps its pilot-seat role');
assert.equal(mechs._debug.chairEnergyMult(crawler),1.38, 'wood chair is the least efficient hero-energy link');
assert.equal(crawler.energy,0, 'freshly assembled mech starts with an empty reserve (no free energy)');

globalThis.player.energy=40;
const startX=crawler.x;
settle(150,{right:true});
assert.ok(crawler.x>startX+0.4, 'chair drive moves the mech right on hero energy alone');
assert.ok(globalThis.player.energy<40, 'driving an unpowered machine drains the seated hero');
assert.ok(Math.abs(globalThis.player.x-(crawler.x+1.5))<0.2, 'seated hero rides along in the chair cell');
settle(60,{left:true});
const leftX=crawler.x;
settle(60,{left:true});
assert.ok(crawler.x<leftX, 'chair drive also steers left');
globalThis.player.energy=0;
crawler.energy=0;
const stuckX=crawler.x;
settle(80,{right:true});
assert.ok(Math.abs(crawler.x-stuckX)<0.05, 'no hero energy and no reserve means the mech refuses to move');

// jump parks the machine back into blocks
globalThis.player.energy=20;
settle(30,{});
assert.equal(mechs.trySeatFromWorld(globalThis.player,getTile,setTile), false, 'trySeat is a no-op while already riding');
settle(4,{jump:true});
assert.equal(mechs.heroMech(),null, 'jump ejects the hero out of the chair');
settle(1,{});
assert.equal(mechs.metrics().count,0, 'parked mech leaves the active simulation');
const parkX=Math.round(stuckX);
assert.equal(getTile(parkX+1,17),T.CHAIR_WOOD, 'parked chair returns as a real world tile');
assert.equal(getTile(parkX,19),T.TRACK, 'parked tracks return as real world tiles');
assert.equal(countTileNear(T.STEEL,parkX+1,18,4),4, 'the full steel hull returns to the grid');
assert.equal(countTileNear(T.TRACK,parkX+1,19,4),4, 'the full track row returns to the grid');

// auto-reseat stays blocked until the hero steps off the chair once
sitAt(parkX+1,17);
globalThis.player.onGround=true;
assert.equal(mechs.trySeatFromWorld(globalThis.player,getTile,setTile), false, 'landing back on the parked chair does not instantly re-assemble');
globalThis.player.x=parkX+6.5;
assert.equal(mechs.trySeatFromWorld(globalThis.player,getTile,setTile), false, 'off the chair there is nothing to seat');
sitAt(parkX+1,17);
assert.equal(mechs.trySeatFromWorld(globalThis.player,getTile,setTile), true, 'stepping off and back on re-assembles the machine');
assert.equal(seatParkCleanup(), true, 'cleanup parks scenario 1');
function seatParkCleanup(){
  const m=mechs.heroMech();
  if(!m) return true;
  return mechs._debug.parkBuiltMech(m,globalThis.player,getTile,setTile,{});
}

// --- Scenario 2: missing chassis refuses without touching the world ----------
mechs.reset();
setTile(151,17,T.CHAIR_STONE);
for(let x=150;x<=153;x++) setTile(x,18,T.STEEL);
for(let x=150;x<=153;x++) setTile(x,19,T.STEEL); // steel floor, no tracks
sitAt(151,17);
assert.equal(seat(), false, 'a machine without a track bottom row refuses to assemble');
assert.equal(mechs.metrics().count,0, 'refused assembly spawns no mech');
assert.equal(getTile(151,17),T.CHAIR_STONE, 'refused assembly leaves the chair in the world');
assert.equal(getTile(150,19),T.STEEL, 'refused assembly leaves the hull in the world');
assert.ok(mechs._debug.seatState().lastTry, 'failed chair scans are recorded for throttling');

// a single track is not a platform either
mechs.reset();
setTile(161,17,T.CHAIR_STONE);
setTile(161,18,T.STEEL);
setTile(161,19,T.TRACK);
sitAt(161,17);
assert.equal(seat(), false, 'one lone track is below the minimum platform width');

// --- Scenario 3: oversized structures are rejected ---------------------------
mechs.reset();
setTile(400,16,T.CHAIR_STEEL);
for(let x=392;x<=411;x++) setTile(x,17,T.TRACK); // 20 wide > BUILT_MAX_W
setTile(400,17,T.TRACK);
sitAt(400,16);
assert.equal(seat(), false, 'a structure wider than the cap refuses to assemble');
assert.equal(getTile(400,16),T.CHAIR_STEEL, 'oversized structure stays untouched');
for(let x=392;x<=411;x++) tiles.delete(K(x,17));
tiles.delete(K(400,16));

// --- Scenario 4: onboard power drives before hero energy ---------------------
// dynamo casing sits directly on the tracks: adjacency is a valid circuit
mechs.reset();
setTile(141,16,T.CHAIR_STEEL);
for(let x=140;x<=143;x++) setTile(x,17,T.STEEL);
setTile(140,18,T.DYNAMO); setTile(141,18,T.DYNAMO_SLOT); setTile(142,18,T.DYNAMO); setTile(143,18,T.COAL);
for(let x=140;x<=143;x++) setTile(x,19,T.TRACK);
sitAt(141,16);
assert.equal(seat(), true, 'powered machine assembles');
const powered=mechs.heroMech();
assert.equal(mechs._debug.chairEnergyMult(powered),1.0, 'steel chair is the cleanest hero-energy link');
assert.equal(mechs._debug.mechTrackCircuitConnected(powered), true, 'dynamo touching the tracks closes the drive circuit');
powered.energy=15;
globalThis.player.energy=30;
const pStart=powered.x;
settle(80,{right:true});
assert.ok(powered.x>pStart+0.4, 'powered mech drives on its reserve');
assert.ok(powered.energy<15, 'driving consumes the onboard reserve');
assert.equal(globalThis.player.energy,30, 'hero energy is untouched while the reserve pays');

// water/steam flow through the mech slot recharges it via the ONE shared
// dynamo implementation (DYNAMO.recordFlow), with the world machine's gains
powered.energy=0;
const pSlot=powered.cells.find(c=>c.t===T.DYNAMO_SLOT);
const pSlotX=Math.floor(powered.x+pSlot.dx), pSlotY=Math.floor(powered.y+pSlot.dy);
assert.equal(globalThis.MM.dynamo.recordFlow(pSlotX,pSlotY,T.WATER,3,getTile), true, 'water flow passes the mech-mounted dynamo slot');
assert.ok(powered.energy>1, 'water flow charges the built mech through DYNAMO.recordFlow');
for(let i=0;i<10;i++) globalThis.MM.dynamo.recordFlow(pSlotX,pSlotY,T.STEAM,2,getTile);
assert.ok(powered.energy>3, 'steam flow keeps charging through the same shared path');
assert.equal(globalThis.MM.dynamo.energyAt(pSlotX,pSlotY,getTile), 0, 'no phantom world machine record forms at the mech slot');
// coal aboard is inert cargo and standing water without flow does nothing —
// exactly like the placed machine
const idleBefore=powered.energy;
globalThis.inv.coal=5;
setTile(pSlotX,pSlotY-3,T.WATER);
settle(180,{});
assert.ok(powered.energy<=idleBefore+0.01, 'still water and onboard coal never power the dynamo');
assert.equal(globalThis.inv.coal,5, 'no coal is ever consumed for dynamo energy');
tiles.delete(K(pSlotX,pSlotY-3));
mechs._debug.parkBuiltMech(powered,globalThis.player,getTile,setTile,{});

// --- Scenario 5: wire overlays carry the circuit and survive parking ---------
mechs.reset();
setTile(301,17,T.CHAIR_STEEL);
setTile(302,17,T.SOLAR_BATTERY);
for(let x=300;x<=303;x++) setTile(x,18,T.STEEL);
globalThis.MM.world.setInfrastructure(302,18,T.COPPER_WIRE);
for(let x=300;x<=303;x++) setTile(x,19,T.TRACK);
sitAt(301,17);
assert.equal(seat(), true, 'wired battery machine assembles');
const wired=mechs.heroMech();
assert.equal(mechs._debug.mechTrackCircuitConnected(wired), true, 'copper-wire overlay joins battery to tracks');
assert.equal(mechs._debug.mechTrackCircuitEfficiency(wired),0.5,'copper-wired mech drive loses half of transmitted energy');
assert.equal(globalThis.MM.world.hasInfrastructure(302,18,T.COPPER_WIRE), false, 'assembly lifts the wire overlay off the world layer');
const wireCell=wired.cells.find(c=>c.wire===T.COPPER_WIRE);
assert.ok(wireCell && wireCell.t===T.STEEL, 'the steel block carries the wire as a cell overlay');
settle(30,{});
settle(4,{jump:true});
assert.equal(mechs.heroMech(),null, 'jump parks the wired machine');
settle(1,{});
const wparkX=Math.round(300);
assert.equal(globalThis.MM.world.hasInfrastructure(wparkX+2,18,T.COPPER_WIRE), true, 'parking writes the wire overlay back to the world layer');
assert.equal(getTile(wparkX+2,17),T.SOLAR_BATTERY, 'parked battery returns to the grid');

// Silver is a drop-in cable substitute aboard player-built machines and keeps
// its material identity through assembly, save state and parking.
globalThis.MM.world.clearInfrastructure(wparkX+2,18,T.COPPER_WIRE);
globalThis.MM.world.setInfrastructure(wparkX+2,18,T.SILVER_WIRE);
sitAt(wparkX+1,17);
assert.equal(seat(),true,'silver-wired battery machine assembles');
const silverWired=mechs.heroMech();
assert.equal(mechs._debug.mechTrackCircuitConnected(silverWired),true,'silver-wire overlay joins battery to tracks');
assert.equal(mechs._debug.mechTrackCircuitEfficiency(silverWired),1,'silver-wired mech drive delivers the full onboard reserve');
assert.ok(silverWired.cells.some(c=>c.wire===T.SILVER_WIRE),'assembled mech retains the silver cable material');
mechs._debug.parkBuiltMech(silverWired,globalThis.player,getTile,setTile,{});
assert.equal(globalThis.MM.world.hasInfrastructure(wparkX+2,18,T.SILVER_WIRE),true,'parking writes silver wire back to the world layer');

// Unwire it: battery without either cable leaves the tracks on hero energy only.
globalThis.MM.world.clearInfrastructure(wparkX+2,18,T.SILVER_WIRE);
sitAt(wparkX+1,17);
assert.equal(seat(), true, 'unwired battery machine still assembles');
const unwired=mechs.heroMech();
assert.equal(mechs._debug.mechTrackCircuitConnected(unwired), false, 'without the wire the battery is not linked to the platform');
unwired.energy=25;
globalThis.player.energy=30;
const uStart=unwired.x;
settle(60,{right:true});
assert.ok(unwired.x>uStart+0.3, 'unwired machine still drives through the chair');
assert.ok(unwired.energy>=25, 'stranded reserve cannot be drained through the tracks without a circuit (solar may still trickle in)');
assert.ok(globalThis.player.energy<30, 'hero energy pays for the unwired drive');
mechs._debug.parkBuiltMech(unwired,globalThis.player,getTile,setTile,{});

// --- Scenario 6: wind on the mech follows the world dynamo curve -------------
mechs.reset();
setTile(181,15,T.CHAIR_STONE);
setTile(181,16,T.DYNAMO);
setTile(181,17,T.DYNAMO_SLOT);
setTile(181,18,T.DYNAMO);
for(let x=180;x<=183;x++) setTile(x,19,T.TRACK);
sitAt(181,15);
assert.equal(seat(), true, 'wind tower mech assembles');
const windy=mechs.heroMech();
assert.equal(windy.energy,0, 'wind test starts with an empty reserve');
const wSlot=windy.cells.find(c=>c.t===T.DYNAMO_SLOT);
const wSlotX=Math.floor(windy.x+wSlot.dx), wSlotY=Math.floor(windy.y+wSlot.dy);
globalThis.MM.wind={ speedAt:()=>5.6 };
const expectedEps=globalThis.MM.dynamo.windEnergyPerSecAt(wSlotX,wSlotY,getTile);
assert.ok(expectedEps>0, 'the shared dynamo wind response sees the mech-mounted vertical slot');
settle(600,{});
assert.ok(Math.abs(windy.energy-expectedEps*10)<expectedEps*3, 'mech wind charge accrues at the world dynamo rate, no private curve');
globalThis.MM.wind=null;
windy.energy=0;
globalThis.player.energy=60;
settle(180,{right:true});
assert.ok(windy.energy<0.01, 'driving alone generates nothing — the mech cannot power itself from its own motion');
mechs._debug.parkBuiltMech(windy,globalThis.player,getTile,setTile,{});

// --- Scenario 6b: a turret block is structural and fires only when the mech's
// own power network reaches it — the same rule as a turret placed on the ground.
mechs.reset();
setTile(211,16,T.CHAIR_STEEL);
setTile(210,17,T.SOLAR_BATTERY); setTile(211,17,T.STEEL); setTile(212,17,T.STEEL);
setTile(210,18,T.STEEL);         setTile(211,18,T.STEEL); setTile(212,18,T.TURRET);
for(let x=210;x<=212;x++) setTile(x,19,T.TRACK);
sitAt(211,16);
assert.equal(seat(), true, 'machine with a mounted turret assembles');
const gunMech=mechs.heroMech();
const gunCell=gunMech.cells.find(c=>c.t===T.TURRET);
assert.ok(gunCell, 'the turret is a structural cell of the built mech');
assert.equal(gunCell.role,'turret', 'the turret block carries the turret role');
// Plain steel between the battery and the turret carries no current.
assert.equal(mechs._debug.mechTurretCircuitConnected(gunMech), false, 'a turret walled off from the battery by steel is unpowered');
{
  let mobHp=90, mobDmg=0;
  globalThis.MM.mobs={
    nearestLiving(){ return mobHp>0 ? {x:gunMech.x+4.5,y:gunMech.y+1.5,hp:mobHp,species:'ZOMBIE'} : null; },
    damageAt(tx,ty,d){ mobHp-=d; mobDmg+=d; return true; },
    collideMech(){ return null; }
  };
  if(globalThis.MM.turrets && globalThis.MM.turrets.reset) globalThis.MM.turrets.reset();
  gunMech.energy=gunMech.maxEnergy;
  const s0=(globalThis.MM.turrets?globalThis.MM.turrets.metrics().shots:0);
  settle(240,{});
  if(globalThis.MM.turrets) assert.equal(globalThis.MM.turrets.metrics().shots,s0, 'the stranded built turret never fires');
  assert.equal(mobDmg,0, 'the stranded built turret deals no damage');
  // Run one copper wire from the battery down to the track chassis: now the whole
  // network — tracks and turret alike — is live off the onboard battery.
  mechs._debug.parkBuiltMech(gunMech,globalThis.player,getTile,setTile,{});
  globalThis.MM.mobs=null;
}
mechs.reset();
setTile(211,16,T.CHAIR_STEEL);
setTile(210,17,T.SOLAR_BATTERY); setTile(211,17,T.STEEL); setTile(212,17,T.STEEL);
setTile(210,18,T.STEEL);         setTile(211,18,T.FIRE_TURRET); setTile(212,18,T.TURRET);
for(let x=210;x<=212;x++) setTile(x,19,T.TRACK);
globalThis.MM.world.setInfrastructure(210,18,T.COPPER_WIRE); // battery -> track chassis
sitAt(211,16);
assert.equal(seat(), true, 'wired turret machine assembles');
const gunMech2=mechs.heroMech();
assert.equal(mechs._debug.mechTrackCircuitConnected(gunMech2), true, 'copper wire closes the drive circuit');
assert.equal(mechs._debug.mechTurretCircuitConnected(gunMech2), true, 'the turrets share the same live network as the tracks');
{
  let mobHp=200, mobDmg=0;
  globalThis.MM.mobs={
    nearestLiving(){ return mobHp>0 ? {x:gunMech2.x+4.5,y:gunMech2.y+1.5,hp:mobHp,species:'ZOMBIE'} : null; },
    damageAt(tx,ty,d){ mobHp-=d; mobDmg+=d; return true; },
    collideMech(){ return null; }
  };
  if(globalThis.MM.turrets && globalThis.MM.turrets.reset) globalThis.MM.turrets.reset();
  // A battery bank can hold far more than one placed turret's capacity (90):
  // firing must subtract only real shot costs, never truncate the reserve.
  gunMech2.maxEnergy=250;
  gunMech2.energy=250;
  const s1=(globalThis.MM.turrets?globalThis.MM.turrets.metrics().shots:0);
  settle(240,{});
  if(globalThis.MM.turrets) assert.ok(globalThis.MM.turrets.metrics().shots>s1, 'the wired built turrets engage a hostile');
  assert.ok(mobDmg>0, 'the wired built turrets damage the mob off the onboard battery');
  assert.ok(gunMech2.energy<250, 'built turret fire spends the onboard reserve');
  assert.ok(gunMech2.energy<80, 'sustained turret fire pays the doubled raw-energy cost of its copper circuit');
  // Each turret block is its own gun with its own fire clock.
  assert.equal(Object.keys(gunMech2.turretStates||{}).length, 2, 'both turret blocks fire with independent per-cell states');
  mechs._debug.parkBuiltMech(gunMech2,globalThis.player,getTile,setTile,{});
  globalThis.MM.mobs=null;
}
mechs.reset();

// A stranded first turret must not silence a wired second one: gating is per
// turret cell, not per mech. Turret A sits isolated in steel; only B touches
// the battery.
setTile(311,16,T.CHAIR_STEEL);
setTile(309,17,T.TURRET); setTile(310,17,T.STEEL); setTile(311,17,T.STEEL); setTile(312,17,T.SOLAR_BATTERY);
setTile(309,18,T.STEEL);  setTile(310,18,T.STEEL); setTile(311,18,T.STEEL); setTile(312,18,T.TURRET);
for(let x=309;x<=312;x++) setTile(x,19,T.TRACK);
sitAt(311,16);
assert.equal(seat(), true, 'stranded-plus-wired turret machine assembles');
const splitMech=mechs.heroMech();
{
  let mobHp=200, mobDmg=0;
  globalThis.MM.mobs={
    nearestLiving(){ return mobHp>0 ? {x:splitMech.x+5.5,y:splitMech.y+2.5,hp:mobHp,species:'ZOMBIE'} : null; },
    damageAt(tx,ty,d){ mobHp-=d; mobDmg+=d; return true; },
    collideMech(){ return null; }
  };
  if(globalThis.MM.turrets && globalThis.MM.turrets.reset) globalThis.MM.turrets.reset();
  splitMech.energy=splitMech.maxEnergy;
  settle(240,{});
  assert.ok(mobDmg>0, 'the battery-adjacent turret fires even though another turret is stranded');
  const firedKeys=Object.keys(splitMech.turretStates||{});
  assert.ok(!firedKeys.includes('0,1'), 'the steel-walled turret never gets a fire state');
  assert.ok(firedKeys.includes('3,2'), 'the powered turret carries the fire state');
  mechs._debug.parkBuiltMech(splitMech,globalThis.player,getTile,setTile,{});
  globalThis.MM.mobs=null;
}
mechs.reset();

// --- Scenario 6c: water turret plumbing — the mech intake mirrors the world
// pump. WATER_PIPE cells form the intake run; a live water source touching the
// run refills the connected water-turret tank at pump rate, paying the pump's
// energy-per-water from the hull reserve. The water hose tops up the same tank.
assert.match(mechsSource, /function updateWaterIntake/, 'mech plumbing intake exists');
assert.match(mechsSource, /function refillMountedWaterAt/, 'hose refill entry point exists on mechs');
const weaponsSource=readFileSync(new URL('../src/engine/weapons.js', import.meta.url),'utf8');
assert.match(weaponsSource, /refillMountedWaterAt\(tx,ty,HOSE_TURRET_REFILL\)/, 'hose puffs top up mech-mounted water turrets');
assert.match(weaponsSource, /receiveWaterAt\(tx,ty,HOSE_TURRET_REFILL,getTile\)/, 'hose puffs top up placed water turrets through the shared tank API');
// chair(651,16) / battery beside the turret (electric) / pipe below it (plumbing)
setTile(651,16,T.CHAIR_STEEL);
setTile(650,17,T.WATER_TURRET); setTile(651,17,T.SOLAR_BATTERY); setTile(652,17,T.STEEL);
setTile(650,18,T.WATER_PIPE);   setTile(651,18,T.STEEL);         setTile(652,18,T.STEEL);
for(let x=650;x<=652;x++) setTile(x,19,T.TRACK);
setTile(649,18,T.WATER); // the pool the intake drinks from (player-built stone basin etc.)
sitAt(651,16);
assert.equal(seat(), true, 'plumbed water-turret machine assembles');
const tanker=mechs.heroMech();
tanker.energy=40;
settle(1,{});
const tankState=tanker.turretStates && tanker.turretStates['0,1'];
assert.ok(tankState, 'submerged intake creates the turret tank state');
tankState.water=2;
const tankEnergy0=tanker.energy;
settle(300,{});
assert.ok(tankState.water>23.9, 'wet intake pipes fill the water-turret tank to capacity');
assert.ok(tanker.energy<tankEnergy0-10, 'the intake pays hull energy like a pump (0.7 per water)');
// the filled tank feeds real water shots once the pool is gone
tiles.delete(K(649,18));
{
  let mobHp=200, mobDmg=0;
  globalThis.MM.mobs={
    nearestLiving(){ return mobHp>0 ? {x:tanker.x+4.5,y:tanker.y+1.5,hp:mobHp,species:'ZOMBIE'} : null; },
    damageAt(tx,ty,d){ mobHp-=d; mobDmg+=d; return true; },
    collideMech(){ return null; }
  };
  if(globalThis.MM.turrets && globalThis.MM.turrets.reset) globalThis.MM.turrets.reset();
  tanker.energy=tanker.maxEnergy;
  const waterBeforeShots=tankState.water;
  settle(240,{});
  assert.ok(mobDmg>0, 'the mounted water turret fires off its refilled tank');
  assert.ok(tankState.water<waterBeforeShots, 'water shots drain the mounted tank');
  globalThis.MM.mobs=null;
}
// dry pipes never refill, and an empty hull reserve cannot pump
tankState.water=5;
settle(120,{});
assert.equal(+tankState.water.toFixed(3), 5, 'a dry intake adds no water');
// At night (no solar trickle into the hull battery) an empty reserve cannot
// pump: moving water costs energy, exactly like the world pump.
setTile(649,18,T.WATER);
tanker.energy=0;
globalThis.MM.background={ timeInfo:()=>({isDay:false,tDay:0}) };
settle(120,{});
globalThis.MM.background=null;
assert.equal(+tankState.water.toFixed(3), 5, 'an empty hull reserve cannot pump water aboard');
// hose refill API: clamps at tank capacity and reports accepted water
let hosePoured=0;
const hoseTx=Math.floor(tanker.x), hoseTy=Math.floor(tanker.y+1);
for(let i=0;i<100;i++) hosePoured+=mechs.refillMountedWaterAt(hoseTx,hoseTy,0.35);
assert.ok(Math.abs(tankState.water-24)<0.001, 'hose refill fills the mounted tank to capacity');
assert.ok(Math.abs(hosePoured-19)<0.01, 'hose refill reports exactly the accepted water');
assert.equal(mechs.refillMountedWaterAt(hoseTx,hoseTy,1), 0, 'a full mounted tank accepts nothing');
assert.equal(mechs.refillMountedWaterAt(hoseTx+1,hoseTy,1), 0, 'a non-turret mech cell accepts no hose water');
mechs._debug.parkBuiltMech(tanker,globalThis.player,getTile,setTile,{});
mechs.reset();

// --- Scenario 7: save/restore keeps the built mech and its rider -------------
mechs.reset();
setTile(241,16,T.CHAIR_WOOD);
for(let x=240;x<=243;x++) setTile(x,17,T.STEEL);
for(let x=240;x<=243;x++) setTile(x,19,T.TRACK);
for(let x=240;x<=243;x++) setTile(x,18,T.STEEL);
sitAt(241,16);
assert.equal(seat(), true, 'save-test machine assembles');
const saved=mechs.heroMech();
saved.energy=7;
globalThis.player.energy=25;
settle(60,{right:true});
const savedCellSig=saved.cells.map(c=>`${c.dx}:${c.dy}:${c.t}:${c.role||''}`).sort().join('|');
const snap=mechs.snapshot();
assert.equal(snap.list.length,1, 'snapshot stores the built mech');
assert.equal(snap.list[0].kind,'built', 'snapshot marks the mech as built');
assert.ok(Array.isArray(snap.list[0].cells) && snap.list[0].cells.length===saved.cells.length, 'snapshot serializes the actual cells');
assert.equal(snap.list[0].rider,true, 'snapshot keeps the hero in the seat');
mechs.reset();
assert.equal(mechs.restore(snap,getTile), true, 'built snapshot restores');
const restored=mechs.heroMech();
assert.ok(restored, 'restore keeps the hero riding the built mech');
assert.equal(restored.kind,'built', 'restored mech stays built-kind');
assert.equal(restored.cells.map(c=>`${c.dx}:${c.dy}:${c.t}:${c.role||''}`).sort().join('|'), savedCellSig, 'restored cells match the saved machine exactly');
globalThis.player.energy=25;
const rStart=restored.x;
settle(80,{right:true});
assert.ok(restored.x>rStart+0.3, 'restored built mech still drives');
// corrupt cells are sanitized instead of crashing
const noisy=JSON.parse(JSON.stringify(snap));
noisy.list[0].cells.push({dx:'x',dy:2,t:9999},null,{dx:2,dy:2,t:T.STEEL,infra:['bogus',T.COPPER_WIRE]});
mechs.reset();
assert.equal(mechs.restore(noisy,getTile), true, 'noisy built snapshot restores defensively');
mechs.reset();

// --- Scenario 8: destroying a ridden built mech collapses it into blocks -----
mechs.reset();
for(const [raw] of [...tiles]) tiles.delete(raw);
infra.clear();
setTile(271,17,T.CHAIR_STEEL);
for(let x=270;x<=273;x++) setTile(x,18,T.STEEL);
for(let x=270;x<=273;x++) setTile(x,19,T.TRACK);
sitAt(271,17);
assert.equal(seat(), true, 'destruction-test machine assembles');
const doomed=mechs.heroMech();
const dCx=Math.floor(doomed.x+1.5), dCy=Math.floor(doomed.y+1);
mechs.blastRadius(doomed.x+1.5,doomed.y+1,8,999,{source:'enemy',kind:'blast'});
settle(1,{});
assert.equal(mechs.heroMech(),null, 'destroyed built mech ejects the hero');
assert.equal(mechs.metrics().count,0, 'destroyed built mech leaves the simulation');
assert.ok(countTileNear(T.TRACK,dCx,dCy)>=4, 'destroyed built mech collapses its tracks into the world');
assert.ok(countTileNear(T.CHAIR_STEEL,dCx,dCy)>=1, 'destroyed built mech drops its chair block back');

// --- Scenario 9: furniture contract ------------------------------------------
// A chair inside a wooden house is silent furniture — it never assembles the
// building, never nags about a missing chassis, and leaves E to the wardrobe.
// (Its healing-comfort role is pinned in house-healing-sim.)
mechs.reset();
for(let x=330;x<=336;x++){ setTile(x,14,T.WOOD); setTile(x,19,T.WOOD); }
for(let y=15;y<=18;y++){ setTile(330,y,T.WOOD); setTile(336,y,T.WOOD); }
setTile(331,18,T.CHAIR_WOOD); // touching the wall: the scan absorbs the whole house
sitAt(331,18);
const hintsBefore=events.filter(e=>e.type==='msg' && /podwozia|za duza/.test((e.detail && e.detail.text) || '')).length;
assert.equal(seat(), false, 'a furniture chair in a house never assembles the building');
assert.equal(mechs.metrics().count,0, 'the house stays a house');
assert.equal(getTile(331,18),T.CHAIR_WOOD, 'the chair stays placed as furniture');
assert.equal(getTile(330,16),T.WOOD, 'house walls are untouched');
const hintsAfter=events.filter(e=>e.type==='msg' && /podwozia|za duza/.test((e.detail && e.detail.text) || '')).length;
assert.equal(hintsAfter,hintsBefore, 'furniture chairs never nag about missing mech parts (no tracks = no mech intent)');
assert.equal(mechs.wantsInteractKey(globalThis.player), false, 'E over a furniture chair stays with the wardrobe panel');

console.log('built-mechs-sim ok');
