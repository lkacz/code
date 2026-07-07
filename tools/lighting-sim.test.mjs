// Cave-lighting regression tests: skylight column scan, torch/lava BFS spread,
// light-tight walls, water attenuation, hero glow, day-night response, dirty
// tracking and the PELZACZ darkness spawn gate (mobs.js contract: crawlers
// refuse to spawn where lightAt > 0.25).
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.CustomEvent = class { constructor(type,opts){ this.type=type; this.detail=opts&&opts.detail; } };
globalThis.dispatchEvent = () => true;
let simNow = 0;
globalThis.performance = { now:()=>simNow };
globalThis.damageHero = () => {};

const { T } = await import('../src/constants.js');
const { lighting } = await import('../src/engine/lighting.js');
assert.ok(lighting, 'lighting module exports');

// ---- world: flat surface at row 20, everything below is stone --------------
const SURF = 20;
const tiles = new Map();
const key = (x,y)=>x+','+y;
const setT = (x,y,t)=>tiles.set(key(x,y),t);
const getTile = (x,y)=>{
  const v = tiles.get(key(x,y));
  if(v!==undefined) return v;
  return y>=SURF ? T.STONE : T.AIR;
};
const surfaceHeight = ()=>SURF;

// Cave A: sealed gallery x=10..20, y=30..34 (torch arrives later)
for(let x=10;x<=20;x++) for(let y=30;y<=34;y++) setT(x,y,T.AIR);
// Cave B: pocket x=23..25, y=30..34 behind a 2-tile wall (x=21..22 stays stone)
for(let x=23;x<=25;x++) for(let y=30;y<=34;y++) setT(x,y,T.AIR);
// Shaft open to sky at x=40 (y=20..30) with side gallery y=28..30, x=40..50
for(let y=SURF;y<=30;y++) setT(40,y,T.AIR);
for(let x=40;x<=50;x++) for(let y=28;y<=30;y++) setT(x,y,T.AIR);
// Roofed hut above ground: roof y=15 x=60..66, walls x=60/x=66 y=16..19,
// interior air, one door gap at (66,18)
for(let x=60;x<=66;x++) setT(x,15,T.STONE);
for(let y=16;y<=19;y++){ setT(60,y,T.STONE); setT(66,y,T.STONE); }
setT(66,18,T.AIR);
// Water pit open to sky at x=80: water y=20..26
for(let y=20;y<=26;y++) setT(80,y,T.WATER);

function ensureField(opts){
  return lighting.ensure(0,0,100,40,Object.assign({getTile,surfaceHeight,daylight:1},opts||{}));
}

lighting.reset();
const f1 = ensureField();
assert.ok(f1, 'ensure builds a field');
assert.ok(f1.x0<=0 && f1.y0<=0 && f1.x0+f1.w>=100, 'field window pads the view');

// 1) open sky + surface face
assert.equal(lighting.lightAt(5,10), 1, 'open sky is fully lit at noon');
assert.equal(lighting.lightAt(5,SURF), 1, 'the surface tile face receives full skylight');
assert.equal(lighting.lightAt(5,SURF+1), 0, 'rock right under the surface is dark');
assert.equal(lighting.darkAlphaAt(5,10), 0, 'no darkness overlay above ground');
assert.ok(lighting.darkAlphaAt(5,SURF+1) > 0.1, 'shallow buried rock picks up some darkness');

// 2) sealed cave is pitch dark and heavily overlaid
assert.equal(lighting.lightAt(15,32), 0, 'sealed cave has no light');
assert.ok(lighting.darkAlphaAt(15,32) > 0.8, 'sealed cave overlay is nearly opaque');

// 3) shaft skylight + lateral BFS decay into the gallery
assert.equal(lighting.lightAt(40,25), 1, 'open shaft carries full skylight down');
const gAtShaft = lighting.lightAt(40,29);
const gMid = lighting.lightAt(45,29);
const gFar = lighting.lightAt(50,29);
assert.ok(gAtShaft > gMid && gMid > gFar, 'gallery light decays away from the shaft');
assert.ok(gFar > 0, 'light still reaches 10 tiles into the gallery');

// 4) roofed hut: no direct skylight, door gap feeds attenuated light
const hutCenter = lighting.lightAt(63,17);
assert.ok(hutCenter > 0 && hutCenter < 0.9, 'hut interior is dimmer than open sky but not black');
assert.ok(lighting.lightAt(65,18) > lighting.lightAt(61,16), 'hut light falls off away from the door');

// 5) water column attenuates skylight faster than air
assert.equal(lighting.lightAt(80,20), 1, 'water surface face gets full sky');
const wShallow = lighting.lightAt(80,21);
const wDeep = lighting.lightAt(80,26);
assert.ok(wShallow > wDeep, 'deeper water is darker');
assert.ok(wDeep > 0 && wDeep < 0.35, 'six tiles of water eat most of the light');

// 6) torch placement: dirty tracking + falloff + light-tight walls
setT(15,32,T.TORCH);
lighting.onTileChanged(15,32);
const f2 = ensureField();
assert.notEqual(f1, f2, 'tile change inside the window forces a recompute');
assert.equal(lighting.lightAt(15,32), 13/15, 'torch cell shines at torch level');
assert.ok(lighting.lightAt(19,32) > 0.5, 'torch light carries along the gallery');
assert.ok(lighting.lightAt(21,32) > 0, 'the cave wall face is lit by the torch');
assert.equal(lighting.lightAt(23,32), 0, 'light does not pass through a 2-tile wall');
assert.ok(lighting.darkAlphaAt(15,32) < 0.05, 'torch cell overlay is clear');

// 7) hero glow seeds a faint personal light
const f3 = ensureField({hero:{x:24.5,y:32.5}});
assert.notEqual(f2, f3, 'hero position keys the field');
assert.ok(Math.abs(lighting.lightAt(24,32) - 5/15) < 1e-9, 'hero glows faintly in the dark');
assert.ok(lighting.lightAt(23,32) > 0, 'hero glow spills one tile');

// 8) night: skylight dies, torches stay
ensureField({daylight:0});
assert.equal(lighting.lightAt(5,10), 0, 'night sky gives no skylight');
assert.equal(lighting.darkAlphaAt(5,10), 0, 'surface still not overlaid at night (atmosphere handles it)');
assert.equal(lighting.lightAt(15,32), 13/15, 'torch is unaffected by night');
assert.equal(lighting.lightAt(40,25), 0, 'open shaft goes dark at night');

// 9) burning-tile hook lights up like a fire source (via the 500ms fire heartbeat)
MM.fire = { count: ()=>1 };
simNow += 600;
ensureField({daylight:0, burningAt:(x,y)=>x===45&&y===29});
assert.equal(lighting.lightAt(45,29), 12/15, 'burning tile emits fire-level light');
MM.fire = null;

// 10) lightAt fallback outside the computed window
ensureField({daylight:1});
assert.equal(lighting.lightAt(5000,5), 1, 'outside window, above surface: daylight estimate');
assert.equal(lighting.lightAt(5000,120), 0, 'outside window, underground: dark');

// 11) determinism: identical inputs, identical fields
{
  const win={x0:0,y0:0,w:60,h:50};
  const a=lighting._compute(win,{getTile,surfaceHeight,daylight:1});
  const b=lighting._compute(win,{getTile,surfaceHeight,daylight:1});
  assert.deepEqual(Array.from(a.level), Array.from(b.level), 'light field is deterministic');
}

// 12) config toggle: disabled = no overlay, "dark/unknown" for spawn gates
lighting.config.enabled=false;
assert.equal(lighting.lightAt(15,32), 0, 'disabled lighting reports dark (legacy spawn behavior)');
assert.equal(lighting.darkAlphaAt(15,32), 0, 'disabled lighting draws no darkness');
lighting.config.enabled=true;

// 13) changes outside the window do not invalidate the field
{
  const before=ensureField();
  lighting.onTileChanged(100000,0);
  const after=ensureField();
  assert.equal(before, after, 'far-away tile changes leave the field cached');
}

// 14) PELZACZ contract: crawlers spawn in the dark, torch-lit galleries are safe
{
  const { mobs } = await import('../src/engine/mobs.js');
  MM.worldGen = { surfaceHeight };
  const spec = mobs._debugSpecies().PELZACZ;
  assert.ok(spec && typeof spec.spawnTest==='function', 'PELZACZ species registered');
  ensureField(); // no hero: cave B is pitch dark, cave A has the torch
  assert.equal(spec.spawnTest(24,34,getTile), true, 'crawler spawns in a dark cave');
  assert.equal(spec.spawnTest(16,34,getTile), false, 'crawler refuses a torch-lit gallery');
  lighting.config.enabled=false;
  assert.equal(spec.spawnTest(16,34,getTile), true, 'disabling lighting restores legacy cave spawns');
  lighting.config.enabled=true;
}

// 15) API safety before any field exists
lighting.reset();
assert.equal(lighting.lightAt(0,0), 0, 'lightAt is safe before the first ensure');
assert.equal(lighting.darkAlphaAt(0,0), 0, 'darkAlphaAt is safe before the first ensure');
lighting.onTileChanged(0,0);

// 16) pause-panel settings contract (source shape, like debug-settings-sim):
// the lighting toggle must persist and be restored at boot
{
  const { readFileSync } = await import('node:fs');
  const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(mainSrc, /const LIGHTING_OFF_KEY='mm_lighting_off_v1'/, 'lighting toggle uses one stable localStorage key');
  assert.match(mainSrc, /localStorage\.getItem\(LIGHTING_OFF_KEY\)==='1'\) LIGHTING\.config\.enabled=false/, 'boot restores a persisted lighting-off choice');
  assert.match(mainSrc, /localStorage\.setItem\(LIGHTING_OFF_KEY, light\.checked\?'0':'1'\)/, 'the pause panel persists the lighting toggle');
  assert.match(mainSrc, /function setPaused\(v\)/, 'pause state flows through one setter (panel + B key)');
  assert.match(mainSrc, /const MINIMAP_OFF_KEY='mm_minimap_off_v1'/, 'minimap toggle uses one stable localStorage key');
}

console.log('lighting-sim: all assertions passed');
