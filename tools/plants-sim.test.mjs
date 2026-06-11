// Deterministic Node test for the living-plant ecosystem (no browser needed):
// watered plants grow through stages and absorb whole water tiles every few
// sips; rain hydrates; the hose (waterAt) keeps a garden alive; dry plants
// wilt and die; old plants degrade and crumble; fire/lava chars them; mined
// soil destroys them; the berry harvest heals the hero.
// Run: node tools/plants-sim.test.mjs
import { strict as assert } from 'assert';

globalThis.window = globalThis; // engine modules attach to window.MM
globalThis.MM = {};

const { T } = await import('../src/constants.js');
const { plants } = await import('../src/engine/plants.js');
assert.ok(plants, 'plants module exports');

// deterministic RNG (mulberry32)
function mulberry(seed){ let a=seed>>>0; return function(){ a|=0; a=(a+0x6D2B79F5)|0; let t=Math.imul(a^(a>>>15),1|a); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }

let tiles;
const getTile=(x,y)=>{ const v=tiles.get(x+','+y); if(v!==undefined) return v; return y>=10? T.GRASS : T.AIR; }; // soil plain at y=10
const setTile=(x,y,v)=>{ tiles.set(x+','+y,v); };
let raining=false;
MM.clouds={ isRainingAt:()=>raining };
MM.water={ onTileChanged(){}, addSource:(x,y,g,s)=>s(x,y,T.WATER) };
MM.fire={ isBurning:()=>false };

function fresh(seed){ tiles=new Map(); plants.reset(); plants._setRng(mulberry(seed||42)); raining=false; delete globalThis.player; }
const step=(seconds)=>{ const dt=1/30; for(let i=0;i<seconds*30;i++) plants.update(getTile,setTile,dt); };

// 1) watered plant grows through stages and eventually drinks tiles away
fresh(11);
setTile(1,10,T.WATER); setTile(2,10,T.WATER); // pond beside the sprout
const p1=plants.sow('sunflower',0,getTile);
assert.ok(p1,'sows on grass');
step(120);
assert.ok(p1.stage>=3, 'watered sunflower grows (stage '+p1.stage+')');
const pondLeft=[...tiles.values()].filter(v=>v===T.WATER).length;
assert.ok(pondLeft<2, 'growing plants absorb water tiles over time (left '+pondLeft+')');

// 2) dry plant wilts and dies; the hose keeps a twin alive
fresh(22);
const dry=plants.sow('fern',0,getTile);
const watered=plants.sow('fern',5,getTile);
assert.ok(dry && watered,'two ferns sown');
for(let i=0;i<360;i++){ plants.update(getTile,setTile,1/30); }
for(let s=0;s<400;s++){ plants.waterAt(5.5,9.5,0.3,1.6); step(1); if(plants.count()<2) break; }
assert.ok(!plants._debug().has(0), 'unwatered fern withers and is removed');
assert.ok(plants._debug().has(5), 'hosed fern survives');

// 3) rain hydrates without water tiles
fresh(33);
raining=true;
const r1=plants.sow('berrybush',0,getTile);
step(150);
assert.ok(r1.stage>=3, 'rain-fed bush grows (stage '+r1.stage+')');

// 4) old age degrades and kills even a watered plant
fresh(44);
setTile(1,10,T.WATER); setTile(-1,10,T.WATER); setTile(2,10,T.WATER); setTile(-2,10,T.WATER);
const old=plants.sow('reed',0,getTile);
old.lifespan=10; // fast-forward old age
raining=true;    // keep it watered the whole time
let gone=false;
for(let s=0;s<300;s++){ step(1); if(!plants._debug().has(0)){ gone=true; break; } }
assert.ok(gone, 'aged plant degrades and crumbles despite water');

// 5) fire chars the garden
fresh(55);
raining=true;
const f1=plants.sow('sunflower',0,getTile);
MM.fire.isBurning=(x,y)=>(x===0&&y===10);
step(10);
assert.ok(f1.withered || !plants._debug().has(0), 'plant beside fire withers');
MM.fire.isBurning=()=>false;

// 6) mining the soil under a plant destroys it
fresh(66);
raining=true;
plants.sow('fern',0,getTile);
setTile(0,10,T.AIR); // dig out the soil
step(6);
assert.ok(!plants._debug().has(0), 'plant dies when its soil is mined');

// 7) berry harvest heals the hero and resets the bush a stage
fresh(77);
raining=true;
const bush=plants.sow('berrybush',0,getTile);
step(200);
assert.equal(bush.stage, 4, 'bush ripens to berries');
globalThis.player={hp:50, maxHp:100};
assert.ok(plants.harvestAt(0, bush.y), 'harvest accepts a click on the bush');
assert.equal(globalThis.player.hp, 56, 'berries heal +6');
assert.equal(bush.stage, 3, 'harvest resets the bush to regrow');

console.log('OK: all plant ecosystem tests passed');
