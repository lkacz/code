// Deterministic background-biome regression test.
// Verifies that the parallax sky palette follows actual worldgen biome ids and
// blends across biome boundaries instead of using unrelated backdrop noise.
// Run: node tools/background-biome-sim.test.mjs
import { strict as assert } from 'assert';
import { readFileSync } from 'fs';

globalThis.window = globalThis;
globalThis.MM = {};

const { background } = await import('../src/engine/background.js');
assert.ok(background && background._debugBiomeBlend, 'background exposes biome debug blend');
assert.ok(background._debugSeasonTint, 'background exposes season tint debug hook');
const backgroundSource = readFileSync(new URL('../src/engine/background.js', import.meta.url), 'utf8');

const palettes = background._debugSkyPalettes;
const pure = (id)=>({
  biomeType(){ return id; },
  cityAt(){ return null; }
});

for(let id=0; id<=8; id++){
  const blend = background._debugBiomeBlend(0,pure(id));
  assert.equal(blend.a,id, 'dominant palette follows pure biome '+id);
  assert.equal(blend.b,id, 'secondary palette matches pure biome '+id);
  assert.equal(blend.t,0, 'pure biome '+id+' does not blend');
  assert.equal(blend.pal.dayTop,palettes[id].dayTop, 'pure biome '+id+' day top matches its palette');
  assert.deepEqual(blend.pal.mount,palettes[id].mount, 'pure biome '+id+' mountain colors match');
}

const boundary = {
  biomeType(x){ return x<0 ? 0 : 3; },
  cityAt(){ return null; }
};
const edge = background._debugBiomeBlend(0,boundary);
assert.equal(edge.a,3, 'boundary dominant side is the local desert biome');
assert.equal(edge.b,0, 'boundary secondary side is the nearby forest biome');
assert.ok(edge.t>0.30 && edge.t<0.48, 'boundary blends without overpowering the dominant biome');
assert.notEqual(edge.pal.dayTop,palettes[3].dayTop, 'boundary palette differs from pure desert');
assert.notEqual(edge.pal.dayTop,palettes[0].dayTop, 'boundary palette differs from pure forest');

const cityNearby = {
  biomeType(){ return 1; },
  cityAt(x){ return {center:0,radius:160}; }
};
const city = background._debugBiomeBlend(0,cityNearby);
assert.equal(city.a,1, 'city influence does not falsify the underlying biome id');
assert.ok(city.city>0.9, 'nearby city influence is strong at city center');
assert.notEqual(city.pal.dayTop,palettes[1].dayTop, 'city influence tints the base biome palette');
assert.equal(city.volcano.amount,0, 'city backdrop does not infer a volcano without volcano metadata');
assert.ok(city.relief<=0.34, 'flat city backdrop damps tall mountain silhouettes');

const realVolcano = {
  biomeType(){ return 7; },
  cityAt(){ return null; },
  volcanoAt(){ return {center:0,radius:24}; },
  nearestVolcano(){ return {center:0,radius:24}; }
};
const volcano = background._debugBiomeBlend(0,realVolcano);
assert.ok(volcano.volcano.amount>0.98, 'real volcano metadata enables volcano background cues');
assert.ok(volcano.relief>0.9, 'real volcano keeps strong distant relief');

const winterTint = background._debugSeasonTint({
  season:'winter', from:'winter', to:'winter', transition:false, blend:1,
  snowStrength:1, leafDropStrength:0, leafGrowStrength:0
});
assert.equal(winterTint.season,'winter', 'season tint reports the active season');
assert.ok(winterTint.alpha>=0.055 && winterTint.alpha<=0.075, 'winter tint is visible but bounded');
const autumnWinterTint = background._debugSeasonTint({
  season:'winter', from:'autumn', to:'winter', transition:true, blend:0.5,
  snowStrength:0.5, leafDropStrength:0.5, leafGrowStrength:0
});
assert.ok(autumnWinterTint.transition, 'season tint preserves transition state');
assert.notEqual(autumnWinterTint.color, winterTint.color, 'transition tint blends between seasons');
assert.ok(autumnWinterTint.alpha>0.035 && autumnWinterTint.alpha<winterTint.alpha, 'transition tint eases in smoothly');

assert.ok(background._debugBiomeBlendCached && background._debugClearBiomeBlendCache, 'background exposes blend cache debug hooks');
let biomeCalls=0, columnCalls=0, volcanoCalls=0;
const cachedWorld = {
  worldSeed:77,
  settings:{seaLevel:62,oceanFrac:0.22,mountainAmp:38,mountainThreshold:0.46,valleyGain:30,detailAmp:1},
  biomeType(){ biomeCalls++; return 1; },
  cityAt(){ return null; },
  volcanoAt(){ volcanoCalls++; return null; },
  nearestVolcano(){ return null; },
  column(){ columnCalls++; return {row:58,biome:1,mountainMask:0.12}; }
};
background._debugClearBiomeBlendCache();
background._debugBiomeBlendCached(10,cachedWorld);
background._debugBiomeBlendCached(11.9,cachedWorld);
assert.equal(background._debugBiomeBlendCacheSize(),2, 'nearby draw positions share the same cached interpolation endpoints');
assert.equal(biomeCalls,18, 'cached background blend samples each interpolation endpoint once');
assert.equal(volcanoCalls,18, 'cached background blend avoids repeated volcano sampling for shared endpoints');
assert.equal(columnCalls,14, 'cached background blend avoids repeated relief sampling for shared endpoints');
background._debugBiomeBlendCached(30,cachedWorld);
assert.equal(background._debugBiomeBlendCacheSize(),4, 'moving far enough computes a second endpoint pair');

assert.ok(background._debugStarPositions && background._debugStarLayerCount, 'background exposes star debug hooks');
assert.ok(background._debugCelestialPosition && background._debugCelestialCyclePosition, 'background exposes celestial debug positions');
assert.ok(background._debugMoonState && background._debugSunState, 'background exposes celestial character debug state');
assert.ok(background._debugMoonAlpha, 'background exposes moon visibility debug hook');
assert.ok(background._debugRedDwarfState, 'background exposes red dwarf debug state');
assert.ok(background._debugDaylightModel && background._debugCycleInfo && background._debugClockTime, 'background exposes seasonal daylight diagnostics');
assert.ok(background._debugMoonlight && background._debugNightTintAlpha, 'background exposes smooth lunar-light diagnostics');
assert.ok(background._debugDrawScene && background._debugBackdropBlurPx && background._debugBaseBackdropBlurPx && background._debugCameraZoomBlurScale && background._debugBackdropCacheState && background._debugBackdropRefreshIntervalMs && background._debugClearBackdropCache, 'background exposes scene and blur debug hooks');
const starLayers = background._debugStarLayerCount();
assert.ok(starLayers.dome>=140, 'single sky-dome star layer is populated');
assert.equal(starLayers.near,0, 'near parallax star layer is removed');
const noonSun = background._debugCelestialPosition('sun',0.5,900,500);
const sunriseSun = background._debugCelestialPosition('sun',0,900,500);
const midnightMoon = background._debugCelestialPosition('moon',0.5,900,500);
const moonrise = background._debugCelestialPosition('moon',0,900,500);
const cycleNoonSun = background._debugCelestialCyclePosition('sun',0.25,900,500);
const cycleDuskMoon = background._debugCelestialCyclePosition('moon',0.5,900,500);
const cycleMidnightMoon = background._debugCelestialCyclePosition('moon',0.75,900,500);
const cycleDawnMoon = background._debugCelestialCyclePosition('moon',0.999,900,500);
assert.ok(noonSun.y>130 && noonSun.y<150, 'midday sun peaks high while remaining fully inside the viewport');
assert.ok(sunriseSun.y>noonSun.y+290, 'sunrise/sunset remain near the horizon relative to noon');
assert.ok(midnightMoon.y>130 && midnightMoon.y<150, 'midnight moon peaks high while remaining fully inside the viewport');
assert.ok(moonrise.y>midnightMoon.y+370, 'moon rise/set arc stays below the horizon relative to the peak');
assert.ok(Math.abs(cycleNoonSun.y-noonSun.y)<0.001, 'cycle-time noon uses the high sun arc');
assert.ok(cycleMidnightMoon.y>130 && cycleMidnightMoon.y<150, 'cycle-time midnight uses the high moon arc');
assert.ok(cycleDuskMoon.y>cycleMidnightMoon.y+370, 'cycle-time dusk moon starts below the horizon');
assert.ok(cycleDawnMoon.y>cycleMidnightMoon.y+370, 'cycle-time dawn moon sets below the horizon');
assert.equal(background._debugMoonAlpha(0.25),0, 'midday moon is hidden instead of ghosting behind the sun');
assert.ok(background._debugMoonAlpha(0.01)>0.06, 'twilight moon can remain faintly visible');
assert.ok(background._debugMoonAlpha(0.75)>0.9, 'night moon remains fully visible');

const springEquinox=background._debugDaylightModel({dayFloat:6,season:'spring'});
const summerSolstice=background._debugDaylightModel({dayFloat:16,season:'summer'});
const autumnEquinox=background._debugDaylightModel({dayFloat:26,season:'autumn'});
const winterSolstice=background._debugDaylightModel({dayFloat:36,season:'winter'});
assert.ok(Math.abs(springEquinox.dayHours-12)<0.001, 'spring equinox has an even twelve-hour day');
assert.ok(Math.abs(autumnEquinox.dayHours-12)<0.001, 'autumn equinox has an even twelve-hour day');
assert.ok(Math.abs(summerSolstice.dayHours-16)<0.001, 'midsummer stretches daylight to about sixteen hours');
assert.ok(Math.abs(winterSolstice.dayHours-8)<0.001, 'midwinter shortens daylight to about eight hours');
assert.equal(summerSolstice.dayHours+summerSolstice.nightHours,24, 'summer still preserves a complete 24-hour clock');
assert.equal(winterSolstice.dayHours+winterSolstice.nightHours,24, 'winter still preserves a complete 24-hour clock');
assert.ok(Math.abs(summerSolstice.sunriseHour-4)<0.001 && Math.abs(summerSolstice.sunsetHour-20)<0.001, 'summer sunrise and sunset move outward around noon');
assert.ok(Math.abs(winterSolstice.sunriseHour-8)<0.001 && Math.abs(winterSolstice.sunsetHour-16)<0.001, 'winter sunrise and sunset move inward around noon');
assert.equal(background._debugCycleInfo(0.5,{dayFloat:16,season:'summer'}).isDay,true, 'the same cycle moment remains daylight in summer');
assert.equal(background._debugCycleInfo(0.5,{dayFloat:36,season:'winter'}).isDay,false, 'the same cycle moment is already night in winter');
const beforeYearWrap=background._debugDaylightModel({dayFloat:40.99,season:'winter'});
const afterYearWrap=background._debugDaylightModel({dayFloat:1.01,season:'spring'});
assert.ok(Math.abs(beforeYearWrap.dayHours-afterYearWrap.dayHours)<0.02, 'day length changes continuously across the calendar year wrap');
assert.equal(background._debugDaylightModel({dayFloat:1,season:'summer',forced:true}).dayHours,16, 'forcing a season uses its representative daylight length');
assert.equal(background._debugDaylightModel({dayFloat:36,season:'off',enabled:false}).dayHours,12, 'disabling seasons restores a neutral twelve-hour day');

let priorDayHours=null;
for(let day=1;day<=40;day++){
  const metrics={dayFloat:day};
  const model=background._debugDaylightModel(metrics);
  assert.ok(model.dayHours>=8 && model.dayHours<=16, 'calendar day '+day+' keeps daylight inside Earth-like bounds');
  assert.ok(Math.abs(model.dayHours+model.nightHours-24)<1e-9, 'calendar day '+day+' preserves 24 total hours');
  assert.ok(Math.abs((model.sunriseHour+model.sunsetHour)/2-12)<1e-9, 'calendar day '+day+' remains centered on solar noon');
  assert.equal(background._debugCycleInfo(model.dayFrac-1e-8,metrics).isDay,true, 'calendar day '+day+' stays day immediately before sunset');
  assert.equal(background._debugCycleInfo(model.dayFrac,metrics).isDay,false, 'calendar day '+day+' becomes night exactly at sunset');
  assert.ok(Math.abs(background._debugClockTime(0,metrics).hourFloat-model.sunriseHour)<1e-8, 'calendar day '+day+' cycle starts at its sunrise');
  assert.ok(Math.abs(background._debugClockTime(model.dayFrac/2,metrics).hourFloat-12)<1e-8, 'calendar day '+day+' reaches 12:00 at solar noon');
  assert.ok(Math.abs(background._debugClockTime(model.dayFrac,metrics).hourFloat-model.sunsetHour)<1e-8, 'calendar day '+day+' reaches its advertised sunset time');
  assert.ok(background._debugClockTime(model.dayFrac+(1-model.dayFrac)/2,metrics).hourFloat<1e-8, 'calendar day '+day+' reaches 00:00 halfway through the night');
  if(priorDayHours!=null) assert.ok(Math.abs(model.dayHours-priorDayHours)<0.64, 'day length changes smoothly between calendar days '+(day-1)+' and '+day);
  priorDayHours=model.dayHours;
}

const summerMetrics={dayFloat:16,season:'summer'};
const winterMetrics={dayFloat:36,season:'winter'};
const summerNoonT=summerSolstice.dayFrac/2;
const winterNoonT=winterSolstice.dayFrac/2;
const summerNoonOrbit=background._debugCelestialCyclePosition('sun',summerNoonT,900,500,summerMetrics);
const winterNoonOrbit=background._debugCelestialCyclePosition('sun',winterNoonT,900,500,winterMetrics);
assert.ok(summerNoonOrbit.y<winterNoonOrbit.y-150, 'summer Sun follows a much higher arc than the winter Sun');
const summerRiseOrbit=background._debugCelestialCyclePosition('sun',0,900,500,summerMetrics);
const winterRiseOrbit=background._debugCelestialCyclePosition('sun',0,900,500,winterMetrics);
assert.ok(Math.abs(winterRiseOrbit.x-450)<Math.abs(summerRiseOrbit.x-450)*0.55, 'winter Sun covers a shorter horizontal orbit instead of the full summer path');
const summerStep=background._debugCelestialCyclePosition('sun',summerNoonT+0.005,900,500,summerMetrics);
const winterStep=background._debugCelestialCyclePosition('sun',winterNoonT+0.005,900,500,winterMetrics);
const summerSpeed=Math.hypot(summerStep.x-summerNoonOrbit.x,summerStep.y-summerNoonOrbit.y);
const winterSpeed=Math.hypot(winterStep.x-winterNoonOrbit.x,winterStep.y-winterNoonOrbit.y);
assert.ok(Math.abs(summerSpeed-winterSpeed)/Math.max(summerSpeed,winterSpeed)<0.03, 'short winter daylight does not make the Sun race faster across the screen');

const summerMidnightT=summerSolstice.dayFrac+(1-summerSolstice.dayFrac)/2;
const winterMidnightT=winterSolstice.dayFrac+(1-winterSolstice.dayFrac)/2;
const summerMoonPeak=background._debugCelestialCyclePosition('moon',summerMidnightT,900,500,summerMetrics);
const winterMoonPeak=background._debugCelestialCyclePosition('moon',winterMidnightT,900,500,winterMetrics);
assert.ok(winterMoonPeak.y<summerMoonPeak.y-180, 'long winter night gives the Moon a higher and longer visible arc');
const summerMoonRise=background._debugCelestialCyclePosition('moon',summerSolstice.dayFrac,900,500,summerMetrics);
const winterMoonRise=background._debugCelestialCyclePosition('moon',winterSolstice.dayFrac,900,500,winterMetrics);
assert.ok(Math.abs(winterMoonRise.x-450)>Math.abs(summerMoonRise.x-450)*1.9, 'winter Moon covers a wider path while the summer Moon uses a short arc');
const summerMoonStep=background._debugCelestialCyclePosition('moon',summerMidnightT+0.005,900,500,summerMetrics);
const winterMoonStep=background._debugCelestialCyclePosition('moon',winterMidnightT+0.005,900,500,winterMetrics);
const summerMoonSpeed=Math.hypot(summerMoonStep.x-summerMoonPeak.x,summerMoonStep.y-summerMoonPeak.y);
const winterMoonSpeed=Math.hypot(winterMoonStep.x-winterMoonPeak.x,winterMoonStep.y-winterMoonPeak.y);
assert.ok(Math.abs(summerMoonSpeed-winterMoonSpeed)/Math.max(summerMoonSpeed,winterMoonSpeed)<0.03, 'short summer night does not make the Moon race faster across the screen');

const fullMoonMetrics={dayFloat:5,season:'spring'};
const newMoonMetrics={dayFloat:1,season:'spring'};
const highFullMoon=background._debugMoonlight(0.75,fullMoonMetrics,pure(0),1000);
const fullMoonDaylight=background._debugDaylightModel(fullMoonMetrics);
const lowMoonT=fullMoonDaylight.dayFrac+0.02*(1-fullMoonDaylight.dayFrac);
const lowFullMoon=background._debugMoonlight(lowMoonT,fullMoonMetrics,pure(0),1000);
const highNewMoon=background._debugMoonlight(0.75,newMoonMetrics,pure(0),1000);
assert.ok(highFullMoon.moonAltitude>0.99 && highFullMoon.moonlight>0.20, 'a high full Moon provides strong natural night light');
assert.ok(lowFullMoon.moonlight>0 && lowFullMoon.moonlight<highFullMoon.moonlight*0.2, 'moonlight fades smoothly near moonrise and moonset');
assert.ok(highNewMoon.moonlight<highFullMoon.moonlight*0.15, 'lunar phase strongly reduces light around new moon');
const highFullTint=background._debugNightTintAlpha(Object.assign(background._debugCycleInfo(0.75,fullMoonMetrics),highFullMoon));
const highNewTint=background._debugNightTintAlpha(Object.assign(background._debugCycleInfo(0.75,newMoonMetrics),highNewMoon));
assert.ok(highFullTint<highNewTint-0.12, 'a high full Moon visibly reduces the night-darkness overlay');
const summerFullMetrics={dayFloat:3,season:'summer',forced:true};
const winterFullMetrics={dayFloat:7,season:'winter',forced:true};
const summerFullModel=background._debugDaylightModel(summerFullMetrics);
const winterFullModel=background._debugDaylightModel(winterFullMetrics);
const summerFullLight=background._debugMoonlight(summerFullModel.dayFrac+(1-summerFullModel.dayFrac)/2,summerFullMetrics,pure(0),1000);
const winterFullLight=background._debugMoonlight(winterFullModel.dayFrac+(1-winterFullModel.dayFrac)/2,winterFullMetrics,pure(0),1000);
assert.ok(summerFullLight.moonAltitude<0.68 && winterFullLight.moonAltitude>0.99, 'reported lunar height follows the shorter summer and taller winter arcs');
assert.ok(winterFullLight.moonlight>summerFullLight.moonlight*1.45, 'the visibly higher winter full Moon provides correspondingly stronger light');

const redDwarfNow = background._debugRedDwarfState(0,900,500,pure(1),0.75);
const redDwarfNextDay = background._debugRedDwarfState(1,900,500,pure(1),0.75);
const redDwarfPeriodReturn = background._debugRedDwarfState(redDwarfNow.periodCycles,900,500,pure(1),0.75);
const redDwarfDay = background._debugRedDwarfState(0,900,500,pure(1),0.25);
assert.ok(redDwarfNow.periodCycles>3 && redDwarfNow.periodCycles<8, 'red dwarf uses a multi-day orbital period');
assert.ok(Math.hypot(redDwarfNow.x-redDwarfNextDay.x,redDwarfNow.y-redDwarfNextDay.y)>35, 'red dwarf does not repeat after one normal day/night cycle');
assert.ok(Math.hypot(redDwarfNow.x-redDwarfPeriodReturn.x,redDwarfNow.y-redDwarfPeriodReturn.y)<0.01, 'red dwarf repeats only after its own orbital period');
assert.ok(redDwarfNow.alpha>redDwarfDay.alpha, 'red dwarf is stronger at night than at noon');
assert.match(redDwarfNow.color, /^#(?:d|e|f|[89a-c])[0-9a-f]{5}$/i, 'red dwarf exposes a reddish body color');
const summerSun = background._debugSunState({
  day:12, dayFloat:12, season:'summer', from:'summer', to:'summer', transition:false, blend:1
}, pure(3), 0.25, 900, 500, 1000, 0);
const winterCitySun = background._debugSunState({
  day:31, dayFloat:31, season:'winter', from:'winter', to:'winter', transition:false, blend:1,
  snowStrength:1
}, cityNearby, 0.25, 900, 500, 1000, 0);
assert.equal(summerSun.season, 'summer', 'sun state follows the active season');
assert.equal(summerSun.world, 'desert', 'sun state follows the local biome context');
assert.equal(winterCitySun.season, 'winter', 'sun state reports winter when the calendar is winter');
assert.equal(winterCitySun.world, 'city', 'sun state picks up strong generated-world landmarks');
assert.notEqual(summerSun.accent, winterCitySun.accent, 'sun palette changes with season and world context');
assert.ok(summerSun.heat>winterCitySun.heat, 'summer sun is hotter than winter sun');
assert.ok(summerSun.sizeScale>winterCitySun.sizeScale, 'summer sun has a larger seasonal size scale than winter sun');
assert.ok(summerSun.radius>winterCitySun.radius+10, 'sun rendered radius follows the seasonal size scale at the same viewport');
assert.ok(backgroundSource.includes('halo.addColorStop(1,hexToRgba(state.ray,0));'), 'sun halo fades to transparent warm light instead of transparent black');
assert.ok(backgroundSource.includes('body.addColorStop(1,blendColor(state.core,state.accent,0.18));'), 'sun body rim stays warm and bright instead of using a dark edge shade');
assert.equal(Object.prototype.hasOwnProperty.call(summerSun,'eye'), false, 'sun debug state does not expose face-only eye styling');
assert.equal(Object.prototype.hasOwnProperty.call(summerSun,'mood'), false, 'sun debug state does not expose face-only mood styling');
const springMoon = background._debugMoonState({
  day:1, dayFloat:1, season:'spring', from:'spring', to:'spring', transition:false, blend:1
}, pure(0), 0.75, 900, 500, 1000, 0);
const winterMoon = background._debugMoonState({
  day:31, dayFloat:31, season:'winter', from:'winter', to:'winter', transition:false, blend:1,
  snowStrength:1
}, realVolcano, 0.75, 900, 500, 1000, 0);
const winterNextMoon = background._debugMoonState({
  day:32, dayFloat:32, season:'winter', from:'winter', to:'winter', transition:false, blend:1,
  snowStrength:1
}, realVolcano, 0.75, 900, 500, 1000, 0);
assert.equal(springMoon.season, 'spring', 'moon state follows the active season');
assert.equal(winterMoon.season, 'winter', 'moon state reports winter when the calendar is winter');
assert.equal(winterMoon.world, 'volcano', 'moon state picks up strong nearby world landmarks');
assert.notEqual(springMoon.accent, winterMoon.accent, 'moon palette changes with season and world context');
assert.notEqual(winterMoon.phaseIndex, winterNextMoon.phaseIndex, 'moon phase advances from the season calendar day');
assert.ok(winterMoon.illumination>=0 && winterMoon.illumination<=1, 'moon illumination remains normalized');
assert.equal(Object.prototype.hasOwnProperty.call(winterMoon,'eye'), false, 'moon debug state does not expose face-only eye styling');
assert.equal(Object.prototype.hasOwnProperty.call(winterMoon,'mood'), false, 'moon debug state does not expose face-only mood styling');
const starsHere = background._debugStarPositions(900,500,0.72,0,20).slice(0,30);
const starsFarAway = background._debugStarPositions(900,500,0.72,12000,20).slice(0,30);
assert.deepEqual(starsHere, starsFarAway, 'star field does not shift when the player walks');
const starsLater = background._debugStarPositions(900,500,0.78,0,20).slice(0,30);
assert.notDeepEqual(starsHere, starsLater, 'star field still rotates slowly with celestial time');
const starsBeforeWrap = background._debugStarPositions(900,500,0.999,0,20).slice(0,30);
const starsAfterWrap = background._debugStarPositions(900,500,0.001,0,20).slice(0,30);
const maxWrapJump = starsBeforeWrap.reduce((best,s,i)=>{
  const t=starsAfterWrap[i];
  const d=Math.hypot(s.x-t.x,s.y-t.y);
  return Math.max(best,d);
},0);
assert.ok(maxWrapJump<18, 'star dome rotation is continuous across the day/night cycle wrap');

function gradient(){ return {addColorStop(){}}; }
function makeOffscreenCtx(){
  return {
    fillStyle:'',
    strokeStyle:'',
    lineWidth:1,
    globalAlpha:1,
    globalCompositeOperation:'source-over',
    filter:'none',
    save(){},
    restore(){},
    clearRect(){},
    fillRect(){},
    drawImage(){},
    beginPath(){},
    closePath(){},
    moveTo(){},
    lineTo(){},
    quadraticCurveTo(){},
    clip(){},
    arc(){},
    ellipse(){},
    fill(){},
    stroke(){},
    createLinearGradient(){ return gradient(); },
    createRadialGradient(){ return gradient(); }
  };
}
globalThis.document = {
  createElement(){ return {width:0,height:0,getContext(){ return makeOffscreenCtx(); }}; }
};
function makeBackgroundCtx(){
  const calls=[];
  const state=[];
  const ctx={
    calls,
    fillStyle:'',
    strokeStyle:'',
    lineWidth:1,
    globalAlpha:1,
    globalCompositeOperation:'source-over',
    filter:'none',
    save(){ state.push({fillStyle:this.fillStyle,strokeStyle:this.strokeStyle,lineWidth:this.lineWidth,globalAlpha:this.globalAlpha,globalCompositeOperation:this.globalCompositeOperation,filter:this.filter}); },
    restore(){ const s=state.pop(); if(!s) return; Object.assign(this,s); },
    fillRect(x,y,w,h){ calls.push(['fillRect',+x.toFixed(3),+y.toFixed(3),+w.toFixed(3),+h.toFixed(3),+this.globalAlpha.toFixed(3)]); },
    drawImage(img,x=0,y=0){ calls.push(['drawImage',+Number(x||0).toFixed(3),+Number(y||0).toFixed(3),img && img.width || 0,img && img.height || 0,this.filter,+this.globalAlpha.toFixed(3)]); },
    beginPath(){},
    closePath(){},
    moveTo(){},
    lineTo(){},
    quadraticCurveTo(){},
    clip(){},
    arc(){},
    ellipse(x,y,rx,ry){ calls.push(['ellipse',+x.toFixed(3),+y.toFixed(3),+rx.toFixed(3),+ry.toFixed(3),+this.globalAlpha.toFixed(3),this.globalCompositeOperation]); },
    fill(){},
    stroke(){},
    createLinearGradient(){ return gradient(); },
    createRadialGradient(){ return gradient(); },
    canvas:{width:900,height:500}
  };
  return ctx;
}
const drawScene = background._debugDrawScene || background.draw;

const oldSeasonApi = globalThis.MM.seasons;
const oldTintOverrideActive = globalThis.__timeOverrideActive;
const oldTintOverrideValue = globalThis.__timeOverrideValue;
const oldTintNow = globalThis.performance.now;
globalThis.MM.seasons = {
  metrics(){ return {
    season:'winter', from:'winter', to:'winter', transition:false, blend:1,
    snowStrength:1, leafDropStrength:0, leafGrowStrength:0
  }; }
};
globalThis.__timeOverrideActive = true;
globalThis.__timeOverrideValue = 0.25;
globalThis.performance.now = ()=>2345678;
background.draw(makeBackgroundCtx(),320,180,0,20,pure(1));
const tintCtx = makeBackgroundCtx();
background.applyTint(tintCtx,320,180);
const seasonTintFills = tintCtx.calls.filter(c=>c[0]==='fillRect' && c[3]===320 && c[4]===180 && c[5]>=0.055 && c[5]<=0.075);
assert.equal(seasonTintFills.length,1, 'applyTint adds one screen-space seasonal atmosphere fill');
globalThis.MM.seasons = oldSeasonApi;
globalThis.performance.now = oldTintNow;
globalThis.__timeOverrideActive = oldTintOverrideActive;
globalThis.__timeOverrideValue = oldTintOverrideValue;

const oldTimeOverrideActive = globalThis.__timeOverrideActive;
const oldTimeOverrideValue = globalThis.__timeOverrideValue;
const oldNow = globalThis.performance.now;
globalThis.__timeOverrideActive = true;
globalThis.__timeOverrideValue = 0.72;
globalThis.performance.now = ()=>1234567;
const drawCtxA = makeBackgroundCtx();
const drawCtxB = makeBackgroundCtx();
const blurredBackdropCtx = makeBackgroundCtx();
background._debugClearBackdropCache();
background.draw(blurredBackdropCtx,900,500,0,20,pure(1));
const blurredComposites = blurredBackdropCtx.calls.filter(c=>c[0]==='drawImage' && c[3]===900 && c[4]===500);
assert.equal(blurredComposites.length,1, 'public background draw emits one screen-sized backdrop composite');
assert.equal(blurredComposites[0][5], 'none', 'public background draw reuses an already-blurred full-quality cache without re-filtering the visible canvas');
assert.equal(blurredComposites[0][3],900, 'background blur keeps the source buffer at full viewport width');
assert.equal(blurredComposites[0][4],500, 'background blur keeps the source buffer at full viewport height');
assert.ok(background._debugBackdropBlurPx(900,500)>=1.90 && background._debugBackdropBlurPx(900,500)<=2.80, 'background blur stays within the intended stronger range');
const cacheAfterFirstBlur = background._debugBackdropCacheState();
assert.equal(cacheAfterFirstBlur.w,900, 'background blur cache keeps full viewport width');
assert.equal(cacheAfterFirstBlur.h,500, 'background blur cache keeps full viewport height');
assert.equal(+cacheAfterFirstBlur.blur.toFixed(3), background._debugBackdropBlurPx(900,500), 'background cache stores the authored full-quality blur amount');
const blurRefreshes = cacheAfterFirstBlur.refreshes;
background.draw(makeBackgroundCtx(),900,500,0,20,pure(1));
assert.equal(background._debugBackdropCacheState().refreshes, blurRefreshes, 'same-timestamp background draw reuses the full-quality blur cache');
globalThis.performance.now = ()=>1234567+20;
background.draw(makeBackgroundCtx(),900,500,0,20,pure(1));
assert.ok(background._debugBackdropCacheState().refreshes>blurRefreshes, 'background blur cache refreshes at the capped 60 FPS cadence');
globalThis.performance.now = ()=>1234567;
const oldFrameMs = globalThis.__mmFrameMs;
background._debugClearBackdropCache();
globalThis.__mmFrameMs = 12;
assert.ok(background._debugBackdropRefreshIntervalMs()>=66, 'slow frame pressure drops background blur cache to a 15 FPS cadence');
globalThis.performance.now = ()=>2234567;
background.draw(makeBackgroundCtx(),900,500,0,20,pure(1));
const pressureRefreshes = background._debugBackdropCacheState().refreshes;
globalThis.performance.now = ()=>2234567+40;
background.draw(makeBackgroundCtx(),900,500,8,20,pure(1));
assert.equal(background._debugBackdropCacheState().refreshes, pressureRefreshes, 'under frame pressure, movement does not force an early full-screen blur refresh');
globalThis.performance.now = ()=>2234567+80;
background.draw(makeBackgroundCtx(),900,500,8,20,pure(1));
assert.ok(background._debugBackdropCacheState().refreshes>pressureRefreshes, 'under frame pressure, background blur cache still refreshes at the slower cadence');
if(oldFrameMs===undefined) delete globalThis.__mmFrameMs;
else globalThis.__mmFrameMs = oldFrameMs;
globalThis.performance.now = ()=>1234567;
const oldBackdropBlurScale = globalThis.__backdropBlurScale;
const baseBackdropBlur = background._debugBaseBackdropBlurPx(900,500);
assert.equal(background._debugCameraZoomBlurScale(0.5),0.5, 'max zoom-out uses the minimal automatic backdrop blur scale');
assert.equal(background._debugCameraZoomBlurScale(1),1, 'normal camera zoom keeps the authored backdrop blur scale');
assert.equal(background._debugCameraZoomBlurScale(3),2, 'max zoom-in doubles the automatic backdrop blur scale');
assert.equal(background._debugBackdropBlurPx(900,500,0.5), +(baseBackdropBlur*0.5).toFixed(3), 'zoomed-out camera reduces background blur');
assert.equal(background._debugBackdropBlurPx(900,500,3), +(baseBackdropBlur*2).toFixed(3), 'zoomed-in camera increases background blur up to 2x');
globalThis.__backdropBlurScale = 2;
assert.equal(background._debugBackdropBlurPx(900,500,1), +(baseBackdropBlur*2).toFixed(3), 'debug blur slider scale is applied to the rendered backdrop blur');
globalThis.__backdropBlurScale = 0.5;
assert.equal(background._debugBackdropBlurPx(900,500,1), +(baseBackdropBlur*0.5).toFixed(3), 'debug blur slider can make the backdrop blur subtler');
if(oldBackdropBlurScale===undefined) delete globalThis.__backdropBlurScale;
else globalThis.__backdropBlurScale = oldBackdropBlurScale;
drawScene(drawCtxA,900,500,0,20,pure(1));
drawScene(drawCtxB,900,500,12000,20,pure(1));
const smallStarsA = drawCtxA.calls.filter(c=>c[0]==='fillRect' && c[3]<=2 && c[4]<=2);
const smallStarsB = drawCtxB.calls.filter(c=>c[0]==='fillRect' && c[3]<=2 && c[4]<=2);
assert.ok(smallStarsA.length>60, 'actual draw emits visible sky-dome stars at night');
assert.deepEqual(smallStarsA, smallStarsB, 'actual star draw does not shift with player position');
assert.equal(drawCtxA.calls.some(c=>c.includes && c.includes('destination-out')), false, 'moon renderer does not punch transparent holes into the sky');
const drawImagesA = drawCtxA.calls.filter(c=>c[0]==='drawImage');
const celestialCompositeIndex = drawImagesA.findIndex(c=>c[3]===900 && c[4]===500);
const landscapeImageIndex = drawImagesA.findIndex((c,i)=>i>celestialCompositeIndex && c[3]>=2000);
assert.ok(celestialCompositeIndex>=0, 'sun and moon are composited from a screen-sized sky layer');
assert.ok(landscapeImageIndex>celestialCompositeIndex, 'background landscape draws after the celestial layer so it hides sun and moon');
const mountainImageAlphas = drawImagesA.filter(c=>c[3]===2200).map(c=>c[6]);
assert.ok(mountainImageAlphas.length>0, 'actual draw emits parallax mountain repeats');
assert.ok(mountainImageAlphas.every(a=>a>=0.92), 'parallax mountain silhouettes stay solid instead of ghost-transparent');
const tallBackdropCtx = makeBackgroundCtx();
drawScene(tallBackdropCtx,900,1080,0,20,pure(1));
const nearPlaneExtensions = tallBackdropCtx.calls.filter(c=>c[0]==='fillRect' && c[1]===0 && c[3]===900 && c[2]>600 && c[5]>=0.90);
assert.ok(nearPlaneExtensions.some(c=>Math.abs((c[2]+c[4])-1080)<0.001), 'nearest parallax background plane extends to the bottom of tall viewports');
const cityBackdropCtx = makeBackgroundCtx();
background._debugClearBiomeBlendCache();
drawScene(cityBackdropCtx,900,500,0,20,cityNearby);
const cityImageAlphas = cityBackdropCtx.calls.filter(c=>c[0]==='drawImage' && c[3]===2400).map(c=>c[6]);
assert.ok(cityImageAlphas.length>0, 'actual draw emits generated-city backdrop repeats near cities');
assert.ok(cityImageAlphas.every(a=>a>=0.80), 'generated-city backdrop silhouettes stay substantial once present');
background._debugClearBiomeBlendCache();
const fractionalParallaxCtx = makeBackgroundCtx();
const oldDpr = globalThis.devicePixelRatio;
globalThis.devicePixelRatio = 2;
drawScene(fractionalParallaxCtx,900,500,0.13,20,pure(7));
globalThis.devicePixelRatio = oldDpr;
const parallaxImages = fractionalParallaxCtx.calls.filter(c=>c[0]==='drawImage');
assert.ok(parallaxImages.every(c=>Math.abs(c[1]*2-Math.round(c[1]*2))<0.001), 'mountain parallax repeats snap to device pixels');
assert.ok(parallaxImages.some(c=>Math.abs(c[1]-Math.round(c[1]))>0.001), 'high-DPI mountain parallax can still move in sub-CSS-pixel increments');
const volcanoDrawCtx = makeBackgroundCtx();
drawScene(volcanoDrawCtx,900,500,0,20,realVolcano);
const volcanoEllipses = volcanoDrawCtx.calls.filter(c=>c[0]==='ellipse');
const volcanoSmokePuffs = volcanoEllipses.filter(c=>c[6]==='source-over' && Math.abs(c[1]-450)<180 && c[2]>140 && c[2]<250 && c[4]>12);
assert.equal(volcanoSmokePuffs.length,0, 'background volcano cue does not draw detached parallax smoke puffs');
globalThis.performance.now = oldNow;
globalThis.__timeOverrideActive = oldTimeOverrideActive;
globalThis.__timeOverrideValue = oldTimeOverrideValue;

console.log('background-biome-sim: all assertions passed');
