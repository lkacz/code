// Fishing regression tests: rod gating, water scouting, seeded bite timing,
// the hook reaction window, multi-pull fights (early pull spooks, late pull
// loses), rewards (fish/golden fish/XP), and the cancel rules (walking off,
// drained water). The rng is injected so every branch runs deterministically.
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};
const messages = [];
globalThis.msg = (t)=>messages.push(String(t));

const { T } = await import('../src/constants.js');
const { fishing } = await import('../src/engine/fishing.js');
assert.ok(fishing, 'fishing module exports');

// ---- pond world: ground at y=30, water pool at x=10..20, y=28..29 ----------
const tiles = new Map();
const key=(x,y)=>x+','+y;
const setT=(x,y,t)=>tiles.set(key(x,y),t);
const getTile=(x,y)=>{
  const v=tiles.get(key(x,y));
  if(v!==undefined) return v;
  return y>=30 ? T.STONE : T.AIR;
};
for(let x=10;x<=20;x++) for(let y=28;y<=29;y++) setT(x,y,T.WATER);

const player={x:8.5,y:29.2,facing:1,hp:50,maxHp:100,xp:0};
globalThis.player=player;
globalThis.inv={fishingRod:0,fish:0,goldenFish:0};

// rng queue: shift values in the order the module consumes them
let rngQueue=[];
fishing._setRng(()=>rngQueue.length?rngQueue.shift():0.5);
const T_FISH=fishing._tuning();

// 1) no rod: F does nothing fishing-related
assert.equal(fishing.onKey(player,getTile), false, 'without a rod the F key is not consumed');
assert.equal(fishing.isActive(), false, 'no cast without a rod');

// 2) rod but no water in reach: hint, consumed key
inv.fishingRod=1;
player.x=60.5; // far from the pond, on plain stone
assert.equal(fishing.onKey(player,getTile), true, 'dry-cast press is consumed');
assert.equal(fishing.isActive(), false, 'no bobber without water');
assert.ok(messages.some(m=>m.includes('Za daleko od wody')), 'dry cast explains itself');

// 3) cast: facing scan finds the water surface (WATER with AIR above)
player.x=8.5; player.facing=1;
rngQueue=[0.0, 0.0]; // fish roll → small (chance .55), biteAt → biteMin
assert.equal(fishing.onKey(player,getTile), true, 'cast consumes the press');
assert.equal(fishing.phase(), 'waiting', 'bobber is out');
const bob=fishing.bobber();
assert.equal(Math.floor(bob.x), 10, 'bobber lands on the nearest water column');
assert.equal(Math.floor(bob.y), 28, 'bobber sits on the surface tile');

// 4) bite after the seeded delay; catching a small fish is one clean hook
fishing.update(T_FISH.biteMin+0.01, player, getTile);
assert.equal(fishing.phase(), 'bite', 'bite fires after the seeded wait');
const xpBefore=player.xp;
assert.equal(fishing.onKey(player,getTile), true, 'hook press consumed');
assert.equal(fishing.phase(), 'idle', 'small fish lands on the first hook');
assert.equal(inv.fish, 1, 'small fish pays one fish');
assert.ok(player.xp>xpBefore, 'catch grants XP');

// 5) missing the bite window loses the fish
rngQueue=[0.0, 0.0];
fishing.onKey(player,getTile);
fishing.update(T_FISH.biteMin+0.01, player, getTile);
assert.equal(fishing.phase(), 'bite', 'second bite fires');
fishing.update(T_FISH.hookWindow+0.05, player, getTile);
assert.equal(fishing.phase(), 'idle', 'late reaction loses the fish');
assert.equal(inv.fish, 1, 'no reward for a missed hook');

// 6) big fish: three timed pulls, early pull spooks it
rngQueue=[0.90, 0.0]; // fish roll 0.90 → big (0.55+0.30 < 0.90 < 0.97)
fishing.onKey(player,getTile);
fishing.update(T_FISH.biteMin+0.01, player, getTile);
rngQueue=[0.0]; // first pullWait delay → pullDelayMin
fishing.onKey(player,getTile); // hook 1 of 3
assert.equal(fishing.phase(), 'pullWait', 'big fish keeps fighting after the first hook');
assert.equal(fishing.onKey(player,getTile), true, 'early pull is consumed');
assert.equal(fishing.phase(), 'idle', 'pulling between windows spooks the fish');
assert.equal(inv.fish, 1, 'spooked fish pays nothing');

// 7) big fish landed: hook every window
rngQueue=[0.90, 0.0];
fishing.onKey(player,getTile);
fishing.update(T_FISH.biteMin+0.01, player, getTile);
rngQueue=[0.0];
fishing.onKey(player,getTile); // hook 1
fishing.update(T_FISH.pullDelayMin+0.01, player, getTile);
assert.equal(fishing.phase(), 'pullWindow', 'second pull telegraphs then opens');
rngQueue=[0.0];
fishing.onKey(player,getTile); // hook 2
fishing.update(T_FISH.pullDelayMin+0.01, player, getTile);
assert.equal(fishing.phase(), 'pullWindow', 'third pull opens');
fishing.onKey(player,getTile); // hook 3 → landed
assert.equal(fishing.phase(), 'idle', 'big fish lands after three hooks');
assert.equal(inv.fish, 4, 'big fish pays three fish');

// 8) golden fish: rare roll pays the potion ingredient
rngQueue=[0.98, 0.0];
fishing.onKey(player,getTile);
fishing.update(T_FISH.biteMin+0.01, player, getTile);
rngQueue=[0.0];
fishing.onKey(player,getTile);
fishing.update(T_FISH.pullDelayMin+0.01, player, getTile);
rngQueue=[0.0];
fishing.onKey(player,getTile);
fishing.update(T_FISH.pullDelayMin+0.01, player, getTile);
fishing.onKey(player,getTile);
assert.equal(inv.goldenFish, 1, 'golden fish pays the potion ingredient');

// 9) walking away reels the line in
rngQueue=[0.0, 0.9];
fishing.onKey(player,getTile);
assert.equal(fishing.phase(), 'waiting', 'line is out again');
player.x += T_FISH.moveCancel + 0.2;
fishing.update(0.016, player, getTile);
assert.equal(fishing.phase(), 'idle', 'moving cancels the cast');
player.x -= T_FISH.moveCancel + 0.2;

// 10) drained water cancels
rngQueue=[0.0, 0.9];
fishing.onKey(player,getTile);
const b2=fishing.bobber();
setT(Math.floor(b2.x), Math.floor(b2.y), T.AIR);
fishing.update(0.016, player, getTile);
assert.equal(fishing.phase(), 'idle', 'losing the water under the bobber cancels');
setT(Math.floor(b2.x), Math.floor(b2.y), T.WATER);

// 11) reeling in early during the wait is a clean cancel
rngQueue=[0.0, 0.9];
fishing.onKey(player,getTile);
assert.equal(fishing.onKey(player,getTile), true, 'reel-in press consumed');
assert.equal(fishing.phase(), 'idle', 'second F during the wait reels in');

// 12) fish table sanity: chances form a full distribution, rewards escalate
{
  const table=fishing._fishTable();
  const total=table.reduce((s,f)=>s+f.chance,0);
  assert.ok(Math.abs(total-1)<1e-9, 'fish chances sum to 1');
  for(const f of table){ assert.ok(f.hooks>=1 && f.xp>0, f.id+' has a fight and a reward'); }
  const small=table.find(f=>f.id==='small'), big=table.find(f=>f.id==='big');
  assert.ok(big.xp>small.xp && big.hooks>small.hooks, 'bigger fights pay more');
}

// 13) API safety: update/draw with no context never throw
fishing.reset();
fishing.update(0.016, null, null);
fishing.draw(null, 20, player, null);

console.log('fishing-sim: all assertions passed');
