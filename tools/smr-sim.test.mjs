// SMR nuclear cell + carbon chain regressions:
//   * the smallest but ENDLESS trickle — only while the host hero or a co-op
//     body is nearby (a personal reactor, not an AFK farm)
//   * inspection lifecycle: interval -> alarm -> (answered? reset : SCRAM);
//     a SCRAMmed cell restarts on inspection, nothing explodes
//   * submerged boiling: ONE water tile in, STEAM_PER_WATER_TILE steam cells
//     out — pinned EQUAL to gases.js STEAM_TO_WATER, so the water<->steam
//     loop is closed by construction
//   * electric annealing: 3 bolts turn GRAPHITE into GRAPHENE (charge recipe)
//   * pinned seams: network source kind 'smr' in every consumer, main wiring,
//     hot-picker groups, resources, recipes, discovery catalog
// Run: node tools/smr-sim.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

globalThis.window = globalThis;
globalThis.MM = {};

const { T, INFO, WORLD_MIN_Y, WORLD_MAX_Y } = await import('../src/constants.js');
MM.T = T;
MM.TILE = 20;

const msgs = [];
globalThis.msg = (t)=>msgs.push(String(t));
const steamAdds = [];
MM.gases = { add: (kind,x,y)=>{ if(kind==='steam'){ steamAdds.push([Math.floor(x),Math.floor(y)]); return 1; } return 0; } };
MM.water = { onTileChanged(){} };
MM.audio = { play(){} };
const notes = [];
MM.discovery = { note:(k)=>notes.push(k) };
MM.coopBodies = [];

const SURF = 30;
const tiles = new Map();
const key = (x,y)=>Math.floor(x)+','+Math.floor(y);
function getTile(x,y){
  x=Math.floor(x); y=Math.floor(y);
  if(y<WORLD_MIN_Y || y>=WORLD_MAX_Y) return T.STONE;
  const k=key(x,y);
  if(tiles.has(k)) return tiles.get(k);
  return y>=SURF ? T.STONE : T.AIR;
}
function setTile(x,y,t){
  x=Math.floor(x); y=Math.floor(y);
  if(y>=WORLD_MIN_Y && y<WORLD_MAX_Y) tiles.set(key(x,y),t);
}
globalThis.player = { x: 10, y: SURF - 2, w: 0.7, h: 0.95 };

const { smr } = await import('../src/engine/smr.js');
assert.ok(smr, 'smr module exports');
const CFG = smr.config;
const DBG = smr._debug;

function advance(seconds){
  const steps = Math.ceil(seconds*10);
  for(let i=0;i<steps;i++) smr.update(0.1, player, getTile, setTile);
}
function reset(){
  tiles.clear();
  smr.reset();
  MM.coopBodies = [];
  msgs.length = 0; steamAdds.length = 0; notes.length = 0;
  player.x = 10; player.y = SURF - 2;
}

// --- 0. tile/INFO contract ---------------------------------------------------
assert.ok(INFO[T.GRAPHITE] && INFO[T.GRAPHITE].drop === 'graphite', 'graphite mines into the graphite resource');
assert.ok(INFO[T.GRAPHENE] && INFO[T.GRAPHENE].drop === 'graphene' && INFO[T.GRAPHENE].hp > INFO[T.OBSIDIAN].hp,
  'graphene is the hardest mineable build material');
assert.ok(INFO[T.SMR_CELL] && INFO[T.SMR_CELL].powerSource && INFO[T.SMR_CELL].conductor
  && INFO[T.SMR_CELL].energyCapacity === CFG.CAPACITY,
  'the SMR tile is a conducting power source whose INFO capacity mirrors the module');

// --- 1. presence-gated trickle ----------------------------------------------
reset();
setTile(10, SURF-1, T.SMR_CELL);
advance(10);
{
  const e = smr.energyAt(10, SURF-1);
  assert.ok(Math.abs(e - CFG.RATE*10) < 0.5, `a tended reactor trickles at RATE (${e})`);
}
player.x = 200; // walk away
const frozen = smr.energyAt(10, SURF-1);
advance(10);
assert.ok(Math.abs(smr.energyAt(10, SURF-1) - frozen) < 1e-6, 'an unattended reactor idles — no output, no timers');
MM.coopBodies = [{ x: 11, y: SURF-2, w: 0.7, h: 0.95 }]; // a guest camps the plant
advance(5);
assert.ok(smr.energyAt(10, SURF-1) > frozen + CFG.RATE*4, 'any co-op body counts as presence');
MM.coopBodies = [];
player.x = 10;
{
  const got = smr.drainAt(10, SURF-1, 3);
  assert.ok(got && Math.abs(got.amount - 3) < 1e-6, 'consumers drain the internal buffer');
}

// --- 2. inspection lifecycle: interval -> alarm -> SCRAM -> restart ----------
reset();
setTile(10, SURF-1, T.SMR_CELL);
advance(1);
DBG.setTimers(10, SURF-1, 0.05, undefined); // due for inspection
advance(1);
{
  const m = smr.metrics();
  assert.equal(m.alarms, 1, 'the due reactor raises an inspection alarm');
  assert.ok(msgs.some(t=>t.includes('kontrol')), 'the alarm is announced');
  assert.ok(notes.includes('smr'), 'the first alarm lands in the discovery journal');
}
DBG.setTimers(10, SURF-1, undefined, 0.05); // window about to lapse
advance(1);
{
  const m = smr.metrics();
  assert.equal(m.off, 1, 'an unanswered alarm SCRAMs the reactor');
  assert.equal(m.scrams, 1, 'the SCRAM is counted');
}
const eOff = smr.energyAt(10, SURF-1);
advance(5);
assert.ok(Math.abs(smr.energyAt(10, SURF-1) - eOff) < 1e-6, 'a SCRAMmed reactor produces nothing');
assert.equal(smr.inspectNear(player), true, 'standing at the cell, E inspects it');
{
  const m = smr.metrics();
  assert.equal(m.off, 0, 'inspection restarts the reactor');
  assert.equal(m.on, 1, 'it runs again with a fresh interval');
}
advance(3);
assert.ok(smr.energyAt(10, SURF-1) > eOff, 'production resumes after the restart');

// --- 3. submerged boiling: closed water<->steam loop -------------------------
reset();
setTile(10, SURF-1, T.SMR_CELL);
setTile(9, SURF-1, T.WATER);
advance(1);
assert.equal(getTile(9, SURF-1), T.AIR, 'the running reactor drinks ONE adjacent water tile');
{
  const m = smr.metrics();
  assert.equal(m.boiledTiles, 1, 'the drink is metered');
}
advance(CFG.BOIL_INTERVAL * (CFG.STEAM_PER_WATER_TILE + 2));
{
  const m = smr.metrics();
  assert.equal(m.ventedCells, CFG.STEAM_PER_WATER_TILE, `one water tile vents exactly ${CFG.STEAM_PER_WATER_TILE} steam cells`);
  assert.equal(steamAdds.length, CFG.STEAM_PER_WATER_TILE, 'each vent is a REAL steam gas cell');
  assert.equal(m.boiledTiles, 1, 'no second tile was drunk — the credit ran dry and no water remains');
}
// the ratio is the gases module's condensation ratio — the loop closes exactly
const here = dirname(fileURLToPath(import.meta.url));
const gasesSrc = readFileSync(join(here, '../src/engine/gases.js'), 'utf8');
{
  const m = gasesSrc.match(/const STEAM_TO_WATER = (\d+);/);
  assert.ok(m, 'gases.js pins its condensation ratio');
  assert.equal(Number(m[1]), CFG.STEAM_PER_WATER_TILE,
    'SMR steam-per-water-tile EQUALS gases condensation steam-per-water — 1 tile in, 1 tile back');
}
// no presence -> no boiling (the reactor idles cold)
reset();
setTile(10, SURF-1, T.SMR_CELL);
setTile(9, SURF-1, T.WATER);
player.x = 200;
advance(3);
assert.equal(getTile(9, SURF-1), T.WATER, 'an unattended reactor boils nothing');

// --- 4. electric annealing: 3 bolts turn graphite into graphene --------------
reset();
const { reactions } = await import('../src/engine/reactions.js');
setTile(20, SURF-1, T.GRAPHITE);
{
  const r1 = reactions.apply('electric', 20, SURF-1, getTile, setTile);
  assert.ok(r1 && r1.charging, 'the first bolt only charges the block');
  assert.equal(getTile(20, SURF-1), T.GRAPHITE, 'still graphite after one hit');
  const r2 = reactions.apply('electric', 20, SURF-1, getTile, setTile);
  assert.ok(r2 && r2.charging, 'the second bolt charges further');
  const r3 = reactions.apply('electric', 20, SURF-1, getTile, setTile);
  assert.ok(r3 && !r3.charging && r3.changed.length === 1, 'the third bolt completes the annealing');
  assert.equal(getTile(20, SURF-1), T.GRAPHENE, 'graphite annealed into graphene');
  assert.ok(notes.includes('graphene'), 'the annealing lands in the discovery journal');
}

// --- 5. pinned source shapes: every seam this chain rides on -----------------
const mainSrc = readFileSync(join(here, '../src/main.js'), 'utf8');
const teleSrc = readFileSync(join(here, '../src/engine/teleporters.js'), 'utf8');
const vendSrc = readFileSync(join(here, '../src/engine/vending.js'), 'utf8');
const mechsSrc = readFileSync(join(here, '../src/engine/mechs.js'), 'utf8');
const invSrc = readFileSync(join(here, '../src/inventory.js'), 'utf8');
const uiSrc = readFileSync(join(here, '../src/engine/ui.js'), 'utf8');
const discoverySrc = readFileSync(join(here, '../src/engine/discovery.js'), 'utf8');
const driftsSrc = readFileSync(join(here, '../src/engine/soft_drifts.js'), 'utf8');

assert.ok(/if\(SMR && SMR\.update\) SMR\.update\(dt, player, getTile, setTile\);/.test(mainSrc),
  'the SMR steps in the host/solo world step (never in runHeroStep)');
assert.equal((mainSrc.match(/SMR\.update\(/g) || []).length, 1, 'exactly one SMR step call');
assert.ok(/if\(SMR && SMR\.draw\) SMR\.draw\(ctx,TILE,worldFxVisible\);/.test(mainSrc), 'SMR status glyphs render fog-gated');
assert.ok(/if\(SMR && SMR\.reset\) SMR\.reset\(\);/.test(mainSrc), 'world restore resets the reactor registry');
assert.ok(/SMR\.wantsInteractKey\(player\) && SMR\.inspectNear\(player\)/.test(mainSrc),
  'E at the cell inspects the reactor (host-only, outranks loot)');
assert.ok(/'GRAPHITE','GRAPHENE'/.test(mainSrc) && /'SMR_CELL'/.test(mainSrc),
  'the new placeables are declared in the hot-picker groups');
assert.ok(/id:'smr_cell'/.test(mainSrc) && /cost:\{graphite:4, radioactiveOre:2, transistor:3, meteoricIron:2, silverWire:4\}/.test(mainSrc),
  'the SMR recipe demands the hard-to-get pile');
assert.ok(/id:'graphene_exoplate'/.test(mainSrc) && /crushResistBonus/.test(mainSrc),
  'graphene feeds a durable-material craft');

assert.ok(/kind:'smr'/.test(teleSrc) && /R\.drainAt\(source\.x,source\.y,want\)/.test(teleSrc),
  'electric networks recognise and drain the smr source kind');
assert.ok(/kind:'smr'/.test(vendSrc), 'vending pays from the SMR buffer instead of the free generic pass');
assert.ok(/function externalSmrDrainNear/.test(mechsSrc), 'mechs can sip from a nearby reactor');
assert.ok(/\{key:'graphite'/.test(invSrc) && /\{key:'graphene'/.test(invSrc) && /\{key:'smrCell'/.test(invSrc),
  'the carbon resources are registered in the inventory');
assert.ok(/function injectSmrDebugPanel\(actions, menuPanel\)/.test(uiSrc) && /smrDebugBox/.test(uiSrc)
  && /injectSmrDebugPanel,/.test(uiSrc), 'the toolbox carries the SMR panel');
assert.ok(/if\(MM\.ui && MM\.ui\.injectSmrDebugPanel\) MM\.ui\.injectSmrDebugPanel\(\{/.test(mainSrc),
  'main.js wires the SMR debug panel');
for(const k of ['graphite','graphene','smr']){
  assert.equal((discoverySrc.match(new RegExp('\\b'+k+':','g')) || []).length >= 2, true,
    'the '+k+' discovery is registered in both catalog tables');
}
assert.ok(/compressTile: T\.GRAPHITE/.test(driftsSrc), 'a maxed soot film can compress into graphite');

console.log('smr-sim: all assertions passed');
