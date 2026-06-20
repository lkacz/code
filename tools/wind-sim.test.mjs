import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.window = globalThis;
globalThis.__mmFrameMs = 16;
globalThis.MM = {
  worldGen: {worldSeed: 24680, surfaceHeight:()=>90, temperature:()=>0.7, settings:{seaLevel:95}},
  background: {getCycleInfo:()=>({cycleT:0.25, isDay:true, tDay:0.5})},
};

const { T } = await import('../src/constants.js');
const { wind } = await import('../src/engine/wind.js');

assert.ok(wind, 'wind module exports');

const openTile = (x,y)=> (y>=90 ? T.STONE : T.AIR);
const roofTile = (x,y)=> {
  if(y>=90) return T.STONE;
  if(y===42 && x>=-3 && x<=3) return T.STONE;
  return T.AIR;
};
const player = {x:0,y:50,vx:0,vy:0,onGround:false,w:0.7,h:0.95};

// Debug overrides are explicit and reset with world transitions.
wind.reset();
wind.setOverride(3);
assert.equal(wind.metrics().override, 3, 'wind debug override is visible in metrics');
wind.reset();
assert.equal(wind.metrics().override, null, 'wind reset clears debug override');
assert.equal(wind.speed(), 0, 'wind reset returns weather speed to zero');

// Environment factors: night and sun+cloud contrast both amplify the wind model.
const dayClear = wind._debug.computeEnvironment({isDay:true,tDay:0.5},{clouds:0,cloudMass:0,storm:{active:false}});
const dayCloudy = wind._debug.computeEnvironment({isDay:true,tDay:0.5},{clouds:12,cloudMass:42,storm:{active:false}});
const night = wind._debug.computeEnvironment({isDay:false,tDay:0.5},{clouds:0,cloudMass:0,storm:{active:false}});
assert.equal(dayClear.sun, 1, 'midday sun factor is high');
assert.ok(dayCloudy.thermal > dayClear.thermal, 'sun plus clouds creates thermal gust potential');
assert.ok(night.night > dayClear.night, 'night wind boost is represented');

// Debug weather profiles cover the natural wind variants without needing live clouds.
wind.reset();
assert.equal(wind.setWeatherProfile('thermal'), true, 'thermal profile is available');
wind.update(1/30,player,openTile);
let profileMetrics = wind.metrics();
assert.equal(profileMetrics.weatherProfile, 'thermal', 'thermal profile appears in metrics');
assert.equal(profileMetrics.override, null, 'weather profiles do not force exact wind speed');
assert.ok(profileMetrics.thermal > 0.8, `thermal profile produces strong thermal input (${profileMetrics.thermal})`);

assert.equal(wind.setWeatherProfile('night'), true, 'night profile is available');
wind.update(1/30,player,openTile);
profileMetrics = wind.metrics();
assert.equal(profileMetrics.weatherProfile, 'night', 'night profile appears in metrics');
assert.ok(profileMetrics.night > 1, `night profile produces night wind input (${profileMetrics.night})`);

assert.equal(wind.setWeatherProfile('storm'), true, 'storm profile is available');
wind.update(1/30,player,openTile);
profileMetrics = wind.metrics();
assert.equal(profileMetrics.weatherProfile, 'storm', 'storm profile appears in metrics');
assert.equal(profileMetrics.storm, 1, 'storm profile exposes full storm wind input');

assert.equal(wind.setWeatherProfile(null), true, 'natural weather profile clears debug weather');
wind.update(1/30,player,openTile);
assert.equal(wind.metrics().weatherProfile, null, 'natural profile clears weather profile metrics');

// Airborne hero is pushed; standing hero only moves in severe wind.
wind.reset();
wind.setOverride(2.4);
player.vx=0; player.onGround=false;
let applied = wind.applyToHero(player,1,openTile,{inWater:false});
assert.ok(applied.applied && player.vx>1, `airborne hero drifted with wind (vx=${player.vx.toFixed(2)})`);

wind.setOverride(2.4);
player.vx=0; player.vy=-9; player.onGround=false;
const jumpingPush = wind.applyToHero(player,1,openTile,{inWater:false}).delta;
wind.setOverride(2.4);
player.vx=0; player.vy=5; player.onGround=false;
const fallingPush = wind.applyToHero(player,1,openTile,{inWater:false}).delta;
assert.ok(jumpingPush > fallingPush*1.35, `jumping catches stronger wind than falling (${jumpingPush.toFixed(2)} vs ${fallingPush.toFixed(2)})`);

wind.setOverride(2.4);
player.vx=0; player.onGround=true;
applied = wind.applyToHero(player,1,openTile,{inWater:false});
assert.equal(applied.applied, false, 'ordinary wind does not shove a grounded hero');
assert.equal(player.vx, 0, 'grounded hero stayed put in normal wind');

wind.setOverride(5.0);
player.vx=0; player.onGround=true;
applied = wind.applyToHero(player,1,openTile,{inWater:false});
assert.ok(applied.applied && player.vx>0.2, `severe gust can shove a grounded hero (vx=${player.vx.toFixed(2)})`);

// Roofs and tunnels attenuate wind strongly.
wind.setOverride(4.0);
const openExposure = wind.exposureAt(0,50,openTile);
const roofExposure = wind.exposureAt(0,50,roofTile);
assert.ok(openExposure > 0.9, 'open sky has full wind exposure');
assert.ok(roofExposure < openExposure*0.35, `roofed exposure is reduced (${roofExposure.toFixed(2)})`);
assert.ok(wind.gasDrift(0,50,T.STEAM,openTile) > wind.gasDrift(0,50,T.STEAM,roofTile)*2, 'gas drift also respects exposure');
const highWind = wind.speedAt(0,18,openTile);
const lowWind = wind.speedAt(0,84,openTile);
assert.ok(highWind > lowWind*1.35, `open-air wind strengthens with altitude (${highWind.toFixed(2)} vs ${lowWind.toFixed(2)})`);
assert.ok(wind._debug.altitudeMultiplier(18) > wind._debug.altitudeMultiplier(84), 'altitude multiplier increases toward the top of the map');
assert.ok(wind.gasDrift(0,18,T.STEAM,openTile) > wind.gasDrift(0,84,T.STEAM,openTile)*1.35, 'gas drift also strengthens higher in the map');

wind.setOverride(2.4);
player.vx=0; player.y=18; player.vy=0; player.onGround=false;
const highHeroPush = wind.applyToHero(player,1,openTile,{inWater:false}).delta;
wind.setOverride(2.4);
player.vx=0; player.y=84; player.vy=0; player.onGround=false;
const lowHeroPush = wind.applyToHero(player,1,openTile,{inWater:false}).delta;
assert.ok(highHeroPush > lowHeroPush*1.35, `hero catches stronger wind at altitude (${highHeroPush.toFixed(2)} vs ${lowHeroPush.toFixed(2)})`);

// Visual particles are bounded even under a long high-wind run.
wind.reset();
wind.setOverride(5.0);
player.onGround=false; player.x=0; player.y=52;
for(let i=0;i<60*12;i++) wind.update(1/60,player,openTile);
let wm = wind.metrics();
assert.ok(wm.particles <= wm.particleCap, `wind particles stay capped (${wm.particles}/${wm.particleCap})`);
assert.ok(wm.particles > 0, 'visible wind particles spawned in open air');
assert.equal(wind._debug.particles.some(p=>p.kind==='leaf'), false, 'visible wind no longer spawns leaf particles');

const snowTile = (x,y)=> (y===90 ? T.SNOW : (y>90 ? T.STONE : T.AIR));
const sandTile = (x,y)=> (y===90 ? T.SAND : (y>90 ? T.STONE : T.AIR));
wind.reset();
wind.setOverride(5.0);
player.onGround=true; player.x=0; player.y=88;
for(let i=0;i<60*8;i++) wind.update(1/60,player,snowTile);
wm = wind.metrics();
assert.ok(wm.particles <= wm.particleCap, `snow gust particles stay capped (${wm.particles}/${wm.particleCap})`);
assert.ok(wind._debug.particles.some(p=>p.material===T.SNOW && (p.kind==='snow' || p.kind==='gust')), 'strong wind lifts visible snow particles from snowy ground');

wind.reset();
wind.setOverride(5.0);
player.onGround=true; player.x=0; player.y=88;
for(let i=0;i<60*8;i++) wind.update(1/60,player,sandTile);
assert.ok(wind._debug.particles.some(p=>p.material===T.SAND && (p.kind==='sand' || p.kind==='gust')), 'strong wind lifts visible sand particles from sandy ground');

// Squalls can be forced for debug and persisted as weather state, not as a cheat override.
wind.reset();
assert.equal(wind.forceSquall(-1,3.1,12), true, 'debug squall can be forced');
assert.ok(wind.speed() < -2.8, `forced squall changes wind speed immediately (speed=${wind.speed().toFixed(2)})`);
wind.update(1/30,player,openTile);
let squallMetrics = wind.metrics();
assert.ok(squallMetrics.squall.active, 'forced squall remains active after update');
assert.equal(squallMetrics.squall.dir, -1, 'forced squall stores direction');
assert.ok(squallMetrics.speed < -2.4, `forced squall remains visible after update smoothing (speed=${squallMetrics.speed})`);
assert.ok(squallMetrics.squall.speed < -2.4, `forced squall exposes a nonzero transient speed (${squallMetrics.squall.speed})`);
wind.reset();
wind.setOverride(1.35);
assert.equal(wind.forceSquall(1,2.4,10), true, 'debug squall can stack onto a fixed wind override');
assert.ok(wind.speed() > 3.2, `squall stacks on override instead of being ignored (speed=${wind.speed().toFixed(2)})`);
wind.setOverride(-4.65);
assert.equal(wind.forceSquall(1,3.2,10), true, 'opposite squall can interrupt a gale override');
assert.ok(wind.speed() > -2.2, `opposite squall affects a previous gale override (speed=${wind.speed().toFixed(2)})`);
wind.reset();
assert.equal(wind.forceSquall(-1,3.1,12), true, 'debug squall can be forced before snapshot');
const windSnapshot = wind.snapshot();
wind.reset();
assert.equal(wind.metrics().squall.active, false, 'reset clears squall state');
assert.equal(wind.restore(windSnapshot), true, 'wind snapshot restores');
assert.equal(wind.metrics().squall.dir, -1, 'wind restore keeps squall direction');
assert.equal(wind.metrics().override, null, 'wind restore does not persist debug override');
wind.reset();

// Clouds keep their old override API, but otherwise read the shared wind.
const { clouds } = await import('../src/engine/clouds.js');
clouds.reset();
wind.setOverride(1.75);
clouds.setWindOverride(null);
assert.equal(clouds.metrics().wind, 1.75, 'clouds read shared wind when not locally overridden');
clouds.setWindOverride(-0.5);
assert.equal(clouds.metrics().wind, -0.5, 'cloud local override still wins');
clouds.setWindOverride(null);

// Sparse gas simulation drifts sideways in exposed wind without a second grid scan.
const { gases } = await import('../src/engine/gases.js');
gases.reset();
const tiles = new Map();
const key = (x,y)=>x+','+y;
const getTile = (x,y)=> {
  if(y<0 || y>=140) return T.STONE;
  return tiles.get(key(x,y)) ?? (y>=90 ? T.STONE : T.AIR);
};
const setTile = (x,y,t)=> {
  if(y>=0 && y<140){
    const k=key(x,y);
    const old=tiles.get(k) ?? (y>=90 ? T.STONE : T.AIR);
    if(t===T.AIR) tiles.delete(k); else tiles.set(k,t);
    gases.onTileChanged(x,y,old,t);
  }
};
setTile.transient=setTile;
setTile(0,62,T.STEAM);
wind.setOverride(4.0);
for(let i=0;i<180;i++) gases.update(1/30,getTile,setTile,{x:0,y:80});
const gasCells=[...gases._debug.active.values()];
assert.ok(gasCells.length>0, 'steam remained active during wind drift');
assert.ok(gasCells.some(g=>g.x>0), 'positive wind drifted steam to the right');

wind.setOverride(null);
gases.reset();

const mainSrc = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const uiSrc = await readFile(new URL('../src/engine/ui.js', import.meta.url), 'utf8');
const windSrc = await readFile(new URL('../src/engine/wind.js', import.meta.url), 'utf8');
const jumpBlockIdx = mainSrc.indexOf('if(jumpBufferT>0){');
const windApplyIdx = mainSrc.indexOf('if(WIND && WIND.applyToHero)');
assert.ok(jumpBlockIdx >= 0 && windApplyIdx > jumpBlockIdx, 'main applies wind after jump impulse so new jumps catch gusts immediately');
assert.match(mainSrc, /wind:\s*timedSavePart\('wind',[^\n]*WIND && WIND\.snapshot/, 'save payload includes wind state');
assert.match(mainSrc, /WIND\.restore\(data\.wind\)/, 'load path restores wind state');
assert.match(mainSrc, /injectWindDebugPanel/, 'main menu injects the wind debug panel');
assert.match(mainSrc, /exact:\(value\)=>/, 'main wind debug actions support exact speed overrides');
assert.match(mainSrc, /profile:\(id\)=>/, 'main wind debug actions support named weather profiles');
assert.match(uiSrc, /function injectWindDebugPanel/, 'UI exposes a wind debug panel');
assert.match(uiSrc, /windDebugBox/, 'wind debug panel has a stable DOM id');
assert.match(uiSrc, /windDebugSpeed/, 'wind debug panel exposes an exact speed slider');
assert.match(uiSrc, /windDebugProfile_'\+id/, 'wind debug panel gives weather profile buttons stable dynamic ids');
assert.match(uiSrc, /\['thermal','Termika'/, 'wind debug panel exposes a thermal profile button');
assert.match(uiSrc, /Profile pogody/, 'wind debug panel groups named weather profiles');
assert.match(uiSrc, /Naturalnie/, 'wind debug panel can return to natural weather');
assert.match(windSrc, /function squallSpeed\(\)/, 'squalls are a transient speed layer, not only a smoothed target');
assert.match(windSrc, /base\+squallSpeed\(\)/, 'current wind speed includes active squalls even with debug overrides');

wind.reset();
console.log('wind-sim: all assertions passed');
