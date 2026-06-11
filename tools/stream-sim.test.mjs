// Deterministic Node test for the stream-weapon elemental interactions
// (no browser needed): flame melts stone → LAVA and boils water → vapor,
// the hose quenches lava → OBSIDIAN, soaks sand → MUD and condenses water,
// gas pools and converts to flame over burning tiles, arrows catch fire.
// Run: node tools/stream-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis; // engine modules attach to window.MM
globalThis.MM = {};

const { T } = await import('../src/constants.js');
const { fire } = await import('../src/engine/fire.js');
const { weapons } = await import('../src/engine/weapons.js');
assert.ok(fire && weapons, 'modules export');

// Sparse strip world
let tiles;
const getTile = (x,y)=>{ const v=tiles.get(x+','+y); return v===undefined? T.AIR : v; };
const setTile = (x,y,v)=>{ tiles.set(x+','+y,v); };
function fill(x0,x1,y0,y1,t){ for(let x=x0;x<=x1;x++) for(let y=y0;y<=y1;y++) setTile(x,y,t); }
function count(t){ let n=0; for(const v of tiles.values()) if(v===t) n++; return n; }

let vaporInjected=0;
MM.clouds={ injectVapor:(x,m)=>{ vaporInjected+=m; } };
MM.water={ onTileChanged(){}, addSource:(x,y,g,s)=>{ s(x,y,T.WATER); } };
MM.fallingSolids={ onTileRemoved(){} };

const player={x:0.5, y:0.5, facing:1, atkCd:0};
const weaponItems={ flame:{weaponType:'flame', fireDps:6, fireRange:6.5},
                    hose:{weaponType:'hose', fireDps:2, fireRange:6},
                    gas:{weaponType:'gas', fireDps:5, fireRange:5.5} };
let equipped=null;
MM.inventory={ equippedItem:()=>equipped, TIER_COLORS:{} };

function spray(kind, aimX, aimY, seconds){
  equipped=weaponItems[kind];
  const dt=1/60;
  for(let i=0;i<seconds*60;i++){
    weapons.fireHeld(player, aimX, aimY, dt);
    weapons.update(dt, getTile, setTile);
    fire.update(getTile, setTile, dt);
  }
  // let remaining puffs land
  for(let i=0;i<120;i++){ weapons.update(dt, getTile, setTile); fire.update(getTile, setTile, dt); }
}

// 1) flame vs stone wall → lava
tiles=new Map(); weapons.reset(); fire.reset();
fill(5,7,-2,2,T.STONE);
spray('flame', 6, 0.5, 5);
assert.ok(count(T.LAVA)>=1, 'flame melts stone into lava (got '+count(T.LAVA)+')');

// 2) flame vs water pool → evaporation + vapor
tiles=new Map(); weapons.reset(); fire.reset(); vaporInjected=0;
fill(3,8,1,2,T.WATER);
spray('flame', 6, 1.5, 5);
assert.ok(vaporInjected>=1, 'boiled water mass joins the cloud vapor (got '+vaporInjected+')');

// 3) hose vs lava pool → obsidian
tiles=new Map(); weapons.reset(); fire.reset();
fill(4,7,0,1,T.LAVA);
spray('hose', 5.5, 0.5, 5);
assert.ok(count(T.OBSIDIAN)>=1, 'hose quenches lava into obsidian (got '+count(T.OBSIDIAN)+')');

// 4) hose vs sand wall → mud (per-puff chance, so spray long enough to be reliable)
tiles=new Map(); weapons.reset(); fire.reset();
fill(5,7,-2,2,T.SAND);
spray('hose', 6, 0.5, 8);
assert.ok(count(T.MUD)>=1, 'hose soaks sand into mud (got '+count(T.MUD)+')');

// 5) hose into open air long enough → occasional condensed water tile
tiles=new Map(); weapons.reset(); fire.reset();
spray('hose', 6, 0.5, 12);
assert.ok(count(T.WATER)>=1, 'hose condenses water now and then (got '+count(T.WATER)+')');

// 6) tile fire: ignite wood, spreads and burns out to AIR
tiles=new Map(); weapons.reset(); fire.reset();
fill(5,5,-3,2,T.WOOD);
spray('flame', 5.5, 0.5, 3);
let burned=false;
for(let i=0;i<60*20;i++){ fire.update(getTile,setTile,1/60); if(count(T.WOOD)<6){ burned=true; break; } }
assert.ok(burned, 'sustained flame sets wood alight and it burns away');

const stepFire=(seconds)=>{ const dt=1/30; for(let i=0;i<seconds*30;i++) fire.update(getTile,setTile,dt); };

// 7) lava is liquid: falls to the floor, and a stack levels out sideways
tiles=new Map(); weapons.reset(); fire.reset();
fill(-3,9,3,3,T.STONE);                      // floor at y=3
setTile(0,0,T.LAVA); fire.noteLava(0,0);     // lava high above the floor
stepFire(20);
assert.equal(getTile(0,2), T.LAVA, 'lava falls until it rests on the floor');
fill(5,5,0,2,T.LAVA); for(let y=0;y<=2;y++) fire.noteLava(5,y); // a 3-tall column
stepFire(40);
let row2=0; for(let x=2;x<=8;x++) if(getTile(x,2)===T.LAVA) row2++;
assert.ok(row2>=2, 'a lava column levels out under its own pressure (bottom row spread: '+row2+')');

// 8) settled lava exposed to open air crusts into obsidian after a long time
tiles=new Map(); weapons.reset(); fire.reset();
fill(-1,1,3,3,T.STONE); fill(-1,1,2,2,T.STONE); setTile(0,2,T.LAVA); fire.noteLava(0,2); // pocket: lava with air above
stepFire(100);
assert.equal(getTile(0,2), T.OBSIDIAN, 'open-air lava cools into obsidian');

// 9) lava meeting water hardens immediately
tiles=new Map(); weapons.reset(); fire.reset();
fill(-1,1,3,3,T.STONE);
setTile(0,2,T.LAVA); fire.noteLava(0,2); setTile(1,2,T.WATER);
stepFire(3);
assert.equal(getTile(0,2), T.OBSIDIAN, 'water contact quenches flowing lava');

// 10) gas detonates on lava: crater in the stone floor + the cloud is consumed
tiles=new Map(); weapons.reset(); fire.reset();
fill(0,12,1,4,T.STONE);                      // thick stone shelf
fill(4,6,0,0,T.LAVA);                        // exposed lava strip at the surface
for(let x=4;x<=6;x++) fire.noteLava(x,0);
const stoneBefore=count(T.STONE);
spray('gas', 5, 0.8, 4);                     // spray slightly downward into the lava
const stoneAfter=count(T.STONE);
assert.ok(stoneAfter<stoneBefore-3, 'gas explosion craters the stone shelf ('+(stoneBefore-stoneAfter)+' tiles blasted)');

console.log('OK: all stream-weapon elemental interaction tests passed');
