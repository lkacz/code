// Slot-3 thrown mines: flight -> resting mine -> delayed proximity trigger,
// three-tile crater, and fragmentation falloff for host/co-op heroes.
// Run: node tools/antipersonnel-mines-sim.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window=globalThis;
globalThis.MM={};
globalThis.CustomEvent=class { constructor(type,opts){ this.type=type; this.detail=opts&&opts.detail; } };
globalThis.dispatchEvent=()=>true;
let now=0;
globalThis.performance={now:()=>now};

const { T }=await import('../src/constants.js');
const { weapons }=await import('../src/engine/weapons.js');
assert.ok(weapons,'weapons module exports');

const inventorySource=readFileSync(new URL('../src/inventory.js',import.meta.url),'utf8');
const mainSource=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const forgeSource=readFileSync(new URL('../src/engine/gear_forge.js',import.meta.url),'utf8');
assert.match(inventorySource,/thrownKind:'antipersonnelMine'/,'the antipersonnel mine is a slot-3 thrown technique');
assert.match(inventorySource,/thrownKind:'fragmentationMine'/,'the fragmentation mine is a slot-3 thrown technique');
assert.match(inventorySource,/\{key:'antipersonnelMine'/,'antipersonnel mines are saved inventory resources');
assert.match(inventorySource,/\{key:'fragmentationMine'/,'fragmentation mines are saved inventory resources');
assert.match(mainSource,/id:'antipersonnel_mines'[\s\S]*inv\.antipersonnelMine\+=3/,'crafting produces antipersonnel mines');
assert.match(mainSource,/id:'fragmentation_mines'[\s\S]*inv\.fragmentationMine\+=2/,'crafting produces fragmentation mines');
assert.match(forgeSource,/antipersonnelMine/,'the debug ammunition bundle includes mines');

let equipped={weaponType:'thrown',thrownKind:'antipersonnelMine',attackDamage:0,fireCooldown:0.1};
MM.inventory={equippedItem:()=>equipped,TIER_COLORS:{}};
globalThis.inv={antipersonnelMine:3,fragmentationMine:3};
const heroDamage=[];
globalThis.damageHero=(amount,opts)=>{ heroDamage.push({amount,opts}); return true; };
globalThis.player={x:-30,y:3.5,w:0.7,h:0.95,hp:100,maxHp:100};

let cells=new Map();
const key=(x,y)=>Math.floor(x)+','+Math.floor(y);
const getTile=(x,y)=>{
  const k=key(x,y);
  if(cells.has(k)) return cells.get(k);
  return Math.floor(y)>=5 ? T.STONE : T.AIR;
};
const removed=[];
const setTile=(x,y,t)=>{
  cells.set(key(x,y),t);
  if(t===T.AIR) removed.push({x:Math.floor(x),y:Math.floor(y)});
};

let mobStanding=false;
const mobBlastCalls=[];
MM.mobs={
  nearestLiving(){ return mobStanding?{x:4.5,y:4,hp:20}:null; },
  blastRadius(x,y,r,dmg,opts){ mobBlastCalls.push({x,y,r,dmg,opts}); return 1; }
};
MM.invasions={blastRadius:()=>0,nearestForEnemy:()=>null};
MM.mechs={blastRadius:()=>0,findAt:()=>null};
MM.companions={nearestForEnemy:()=>null};
MM.npcSystem={list:()=>[]};

// The item is thrown first. It must settle as a mine instead of exploding on impact.
const thrower={x:0.5,y:2.5,w:0.7,h:0.95,facing:1,atkCd:0,hp:100};
assert.equal(weapons.fireHeld(thrower,5,4.6,1/60),true,'an antipersonnel mine can be thrown from slot 3');
assert.equal(inv.antipersonnelMine,2,'throwing spends one mine');
for(let i=0;i<240 && weapons.metrics().mines===0;i++){
  now+=1000/60;
  weapons.update(1/60,getTile,setTile,{player:globalThis.player});
}
assert.equal(weapons.metrics().arrows,0,'the thrown projectile leaves flight after hitting the floor');
assert.equal(weapons.metrics().mines,1,'the impact leaves one resting mine');
assert.equal(removed.length,0,'landing alone does not explode or edit terrain');

// It arms after a safety delay and any ordinary mob can then step on it.
weapons.update(weapons._debug.mineTuning.armSeconds-0.05,getTile,setTile,{player:globalThis.player});
mobStanding=true;
weapons.update(0.02,getTile,setTile,{player:globalThis.player});
assert.equal(weapons.metrics().mines,1,'a mine cannot trigger before its arming delay');
weapons.update(0.06,getTile,setTile,{player:globalThis.player});
assert.equal(weapons.metrics().mines,0,'a mob stepping on the armed mine detonates it');
assert.ok(mobBlastCalls.some(c=>c.dmg===weapons._debug.mineTuning.blastDamage),'the blast reaches the shared creature damage router');
assert.ok(removed.length>=10,'the mine removes a substantial small crater');
const xs=removed.map(p=>p.x);
assert.ok(Math.max(...xs)-Math.min(...xs)>=5,'the crater spans approximately the configured three-tile radius');
assert.equal(weapons._debug.mineTuning.craterRadius,3,'the authored crater radius is exactly three tiles');

// The thrower/host is also a valid trigger, but the arming grace prevents an
// immediate self-detonation while the mine is still being placed.
weapons.reset();
cells=new Map(); removed.length=0; mobStanding=false; mobBlastCalls.length=0;
weapons._debug.deployMine({x:20.5,y:4.9,mineType:'blast'},getTile,setTile);
const steppingHero={x:20.5,y:4.425,w:0.7,h:0.95,hp:100};
globalThis.player=steppingHero;
weapons.update(0.4,getTile,setTile,{player:steppingHero});
assert.equal(weapons.metrics().mines,1,'the hero standing on a fresh mine is protected during arming');
weapons.update(0.2,getTile,setTile,{player:steppingHero});
assert.equal(weapons.metrics().mines,0,'the same hero triggers it once armed');
assert.ok(heroDamage.some(h=>h.opts&&h.opts.cause==='antipersonnel_mine'),'the host hero receives attributed mine damage');

// Fragmentation adds a wider radial damage pass and visible sideways fragments.
// Hero damage is distance-scaled: the close body must take more than the far body.
weapons.reset();
cells=new Map(); removed.length=0; heroDamage.length=0; mobBlastCalls.length=0;
globalThis.player={x:-30,y:3.5,w:0.7,h:0.95,hp:100,maxHp:100};
const coopDamage={near:[],far:[]};
MM.coopBodies=[
  {gid:'gnear',x:30.5,y:4.425,w:0.7,h:0.95,hp:100,hurt:n=>coopDamage.near.push(n)},
  {gid:'gfar',x:34.8,y:4.425,w:0.7,h:0.95,hp:100,hurt:n=>coopDamage.far.push(n)}
];
weapons._debug.deployMine({x:30.5,y:4.9,mineType:'fragmentation'},getTile,setTile);
weapons.update(0.5,getTile,setTile,{player:globalThis.player});
weapons.update(0.06,getTile,setTile,{player:globalThis.player});
assert.equal(weapons.metrics().mines,0,'a co-op hero can trigger the fragmentation mine');
assert.ok(weapons.metrics().mineFragments>=5,'fragmentation throws several visible shards sideways');
assert.ok(mobBlastCalls.some(c=>Math.abs(c.r-weapons._debug.mineTuning.fragmentRadius)<1e-9),'shrapnel has its own wider creature-damage radius');
const nearTotal=coopDamage.near.reduce((a,b)=>a+b,0);
const farTotal=coopDamage.far.reduce((a,b)=>a+b,0);
assert.ok(nearTotal>farTotal && farTotal>0,'nearby heroes take stronger fragmentation damage than distant heroes');

delete MM.coopBodies;
console.log('antipersonnel-mines-sim: all assertions passed');
