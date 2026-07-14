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
const { createHeroLampModel } = await import('../src/engine/hero_lamp.js');
assert.ok(lighting, 'lighting module exports');
assert.equal(typeof createHeroLampModel,'function','hero lamp model exports');

// Energy contract: the lamp cannot start empty, drains continuously while on,
// switches itself off at depletion, and persists only its compact on/off state.
{
  const lamp=createHeroLampModel({drainPerSecond:2,minStartEnergy:1});
  let energy=3;
  const pool={
    canSpend(n){ return energy>=n; },
    spend(n){ if(energy<n) return false; energy-=n; return true; },
    spendContinuous(n){ const spent=Math.min(energy,n); energy-=spent; if(energy<1e-9) energy=0; return spent; },
    info(){ return {energy,max:40}; }
  };
  assert.equal(lamp.toggle(pool).on,true,'flashlight toggle turns the eye lamp on when energy is available');
  for(let i=0;i<5;i++) lamp.update(0.1,pool);
  assert.ok(Math.abs(energy-2)<1e-9,'eye lamp drains energy at its configured per-second rate');
  const saved=lamp.snapshot();
  const restored=createHeroLampModel();
  assert.equal(restored.restore(saved),true,'eye-lamp on state survives save restore');
  const hardened=createHeroLampModel({drainPerSecond:-20,range:999,level:999});
  assert.equal(hardened.restore('false'),false,'malformed string state cannot switch the lamp on');
  assert.ok(hardened.info().drainPerSecond>0 && hardened.info().range<=18 && hardened.info().level<=15,'lamp configuration is clamped to safe simulation bounds');
  for(let i=0;i<20 && lamp.isOn();i++) lamp.update(0.1,pool);
  assert.equal(lamp.isOn(),false,'eye lamp turns itself off when the energy pool is depleted');
  assert.equal(energy,0,'eye lamp consumes the final fractional energy instead of stranding it');
  assert.equal(lamp.lightSource({x:1,y:1,facing:1}),null,'depleted lamp no longer contributes a light source');
  const empty=createHeroLampModel();
  assert.equal(empty.toggle({canSpend(){ return false; }}).blocked,'energy','empty energy pool blocks lamp activation');

  const finalFraction=createHeroLampModel({drainPerSecond:2,minStartEnergy:0.05});
  let fraction=0.07;
  const fractionPool={
    canSpend(n){ return fraction>=n; },
    spendContinuous(n){ const spent=Math.min(fraction,n); fraction-=spent; return spent; },
    info(){ return {energy:fraction,max:40}; }
  };
  assert.equal(finalFraction.toggle(fractionPool).on,true,'lamp can start for the final-fraction regression');
  const depleted=finalFraction.update(0.1,fractionPool);
  assert.equal(fraction,0,'a drain larger than the remaining fraction consumes all remaining energy');
  assert.equal(depleted.depleted,true,'partial final payment reports depletion immediately');
  assert.equal(finalFraction.isOn(),false,'lamp switches off in the same tick as final fractional drain');
}

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

// 5b) data-driven furniture emitters honor INFO.lightLevel proportionally
{
  const win={x0:0,y0:25,w:9,h:5};
  const fieldFor=(tile)=>lighting._compute(win,{
    getTile(x,y){ return x===4 && y===27 ? tile : T.AIR; },
    surfaceHeight:()=>SURF,
    daylight:0
  }).level;
  const center=2*win.w+4;
  const aquarium=fieldFor(T.AQUARIUM);
  const chandelier=fieldFor(T.CHANDELIER);
  const miniatureSun=fieldFor(T.MINIATURE_SUN);
  assert.equal(aquarium[center],4,'aquarium uses its exact INFO.lightLevel seed');
  assert.equal(chandelier[center],12,'chandelier uses its exact INFO.lightLevel seed');
  assert.equal(miniatureSun[center],15,'miniature sun reaches the lighting-engine maximum');
  assert.ok(aquarium[center]<chandelier[center] && chandelier[center]<miniatureSun[center],
    'higher furniture lightLevel values produce proportionally stronger sources');
  assert.equal(chandelier[center+2],10,'data-driven furniture light uses the standard one-level-per-tile falloff');
}

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

// 7b) eye lamp: directional, follows facing, and cannot shine through walls
setT(15,32,T.AIR);
lighting.onTileChanged(15,32);
const lampHero={x:15.5,y:32.5,h:0.95,facing:1};
const rightLamp={enabled:true,facing:1,range:11,level:15,spread:0.28};
const rightField=ensureField({daylight:0,hero:lampHero,heroLamp:rightLamp});
assert.ok(lighting.lightAt(19,32)>0.75,'eye lamp casts a strong cone in front of the hero');
assert.ok(lighting.lightAt(19,32)>lighting.lightAt(11,32)+0.5,'eye lamp stays directional instead of flooding behind the hero');
assert.ok(lighting.lightAt(21,32)>0.5,'eye lamp lights the near face of a blocking wall');
assert.equal(lighting.lightAt(23,32),0,'blocking wall stops the eye-lamp cone');
const leftField=ensureField({daylight:0,hero:lampHero,heroLamp:Object.assign({},rightLamp,{facing:-1})});
assert.notEqual(leftField,rightField,'turning the hero invalidates the cached lamp field');
assert.ok(lighting.lightAt(11,32)>0.75,'eye-lamp cone flips with hero facing');
assert.ok(lighting.lightAt(11,32)>lighting.lightAt(19,32)+0.5,'flipped cone leaves the old forward side dim');

// 7c) exceptional held weapon: quantized radial seed shares wall-tight BFS
const rareWeaponLight={enabled:true,x:15.8,y:32.2,level:9};
const weaponField=ensureField({daylight:0,hero:null,heroLamp:null,weaponLight:rareWeaponLight});
assert.equal(lighting.lightAt(15,32),9/15,'held weapon seeds its exact quantized light level');
assert.ok(lighting.lightAt(19,32)>0.25,'held weapon glow reaches the nearby cave wall');
assert.equal(lighting.lightAt(23,32),0,'held weapon light cannot leak through a two-tile wall');
const sameWeaponField=ensureField({daylight:0,hero:null,heroLamp:null,weaponLight:Object.assign({},rareWeaponLight)});
assert.equal(sameWeaponField,weaponField,'animated colour pulse with unchanged light bucket reuses the cached field');
const strongerWeaponField=ensureField({daylight:0,hero:null,heroLamp:null,weaponLight:Object.assign({},rareWeaponLight,{level:12})});
assert.notEqual(strongerWeaponField,weaponField,'crossing a quantized weapon-light level invalidates the field');
assert.equal(lighting.lightAt(15,32),12/15,'stronger activation impulse raises the physical light level');
setT(15,32,T.TORCH);
lighting.onTileChanged(15,32);

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
  assert.match(mainSrc, /updateHeroEnergy\(dt\); updateHeroLamp\(dt\)/, 'lamp drain runs in the live simulation immediately after energy charging');
  assert.match(mainSrc, /lamp:\(HERO_LAMP && HERO_LAMP\.snapshot\)/, 'player save snapshot persists the eye-lamp toggle');
  assert.match(mainSrc, /weaponLight: \(WEAPONS && WEAPONS\.lightSource\)/, 'finished scene feeds the equipped weapon into the physical cave-light field');
  assert.match(mainSrc, /WEAPONS\.drawHeroReflection[\s\S]*WEAPONS\.drawWorldLight/, 'weapon light affects both the hero sprite and the later world composite');
  const htmlSrc = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(htmlSrc, /id="lampBtn"[\s\S]*aria-pressed="false"/, 'HUD exposes an accessible flashlight icon toggle');
}

console.log('lighting-sim: all assertions passed');
