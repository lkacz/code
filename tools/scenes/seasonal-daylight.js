const fail = message => 'FAIL :: ' + message;

if(!window.MM || !MM.background || !MM.seasons || !MM.background._debugDaylightModel || !MM.background._debugMoonlight)
  return fail('season/daylight APIs did not finish booting');

const summer=MM.background._debugDaylightModel({dayFloat:1,season:'summer',forced:true});
const winter=MM.background._debugDaylightModel({dayFloat:1,season:'winter',forced:true});
if(Math.abs(summer.dayHours-16)>0.01 || Math.abs(winter.dayHours-8)>0.01)
  return fail('solstice lengths are incorrect: summer='+summer.dayHours+', winter='+winter.dayHours);

const summerMetrics={dayFloat:16,season:'summer'};
const winterMetrics={dayFloat:36,season:'winter'};
const summerMid=summer.dayFrac/2;
const winterMid=winter.dayFrac/2;
const summerP=MM.background._debugCelestialCyclePosition('sun',summerMid,1100,620,summerMetrics);
const winterP=MM.background._debugCelestialCyclePosition('sun',winterMid,1100,620,winterMetrics);
const summerP2=MM.background._debugCelestialCyclePosition('sun',summerMid+0.005,1100,620,summerMetrics);
const winterP2=MM.background._debugCelestialCyclePosition('sun',winterMid+0.005,1100,620,winterMetrics);
const summerSpeed=Math.hypot(summerP2.x-summerP.x,summerP2.y-summerP.y);
const winterSpeed=Math.hypot(winterP2.x-winterP.x,winterP2.y-winterP.y);
if(!(summerP.y<winterP.y-180) || Math.abs(summerSpeed-winterSpeed)/Math.max(summerSpeed,winterSpeed)>0.03)
  return fail('seasonal Sun orbit height/speed is inconsistent');

const summerMoonMid=summer.dayFrac+(1-summer.dayFrac)/2;
const winterMoonMid=winter.dayFrac+(1-winter.dayFrac)/2;
const summerMoon=MM.background._debugCelestialCyclePosition('moon',summerMoonMid,1100,620,summerMetrics);
const winterMoon=MM.background._debugCelestialCyclePosition('moon',winterMoonMid,1100,620,winterMetrics);
const summerMoon2=MM.background._debugCelestialCyclePosition('moon',summerMoonMid+0.005,1100,620,summerMetrics);
const winterMoon2=MM.background._debugCelestialCyclePosition('moon',winterMoonMid+0.005,1100,620,winterMetrics);
const summerMoonSpeed=Math.hypot(summerMoon2.x-summerMoon.x,summerMoon2.y-summerMoon.y);
const winterMoonSpeed=Math.hypot(winterMoon2.x-winterMoon.x,winterMoon2.y-winterMoon.y);
if(!(winterMoon.y<summerMoon.y-220) || Math.abs(summerMoonSpeed-winterMoonSpeed)/Math.max(summerMoonSpeed,winterMoonSpeed)>0.03)
  return fail('seasonal Moon orbit height/speed is inconsistent');

// Exercise the real season clock + public timeInfo path on every calendar day,
// including the exact sunset transition where rounding bugs tend to hide.
MM.seasons.forceSeason(null);
for(let day=1;day<=40;day++){
  MM.seasons.setDay(day);
  const metrics=MM.seasons.metrics();
  const model=MM.background._debugDaylightModel(metrics);
  MM.background.importState({cycleT:0});
  const rise=MM.background.timeInfo();
  MM.background.importState({cycleT:model.dayFrac/2});
  const noon=MM.background.timeInfo();
  MM.background.importState({cycleT:model.dayFrac});
  const set=MM.background.timeInfo();
  const riseClock=rise.hour+rise.minute/60;
  const noonClock=noon.hour+noon.minute/60;
  const setClock=set.hour+set.minute/60;
  if(Math.abs(model.dayHours+model.nightHours-24)>1e-8
    || Math.abs(riseClock-model.sunriseHour)>0.03
    || Math.abs(noonClock-12)>0.03
    || Math.abs(setClock-model.sunsetHour)>0.03
    || rise.isDay!==true || noon.isDay!==true || set.isDay!==false)
    return fail('real 40-day clock audit failed on day '+day+': '+JSON.stringify({model,rise,noon,set,riseClock,noonClock,setClock}));
}

MM.seasons.forceSeason('summer');
MM.background.importState({cycleT:0.5});
await sleep(250);
const summerLate=MM.background.timeInfo();
if(!summerLate.isDay || summerLate.hour!==16)
  return fail('summer late-afternoon sample should still be daylight near 16:00: '+JSON.stringify(summerLate));

MM.seasons.forceSeason('winter');
MM.background.importState({cycleT:0.5});
await sleep(250);
const winterEvening=MM.background.timeInfo();
if(winterEvening.isDay || winterEvening.hour!==20)
  return fail('winter sample should already be night near 20:00: '+JSON.stringify(winterEvening));

// Find a real full-moon calendar day for this world seed, then leave the frame
// at its highest point so both the body and its brighter night are visible.
MM.seasons.forceSeason(null);
let best={day:1,light:-1,cycleT:0.75};
for(let day=1;day<=40;day++){
  MM.seasons.setDay(day);
  const metrics=MM.seasons.metrics();
  const model=MM.background._debugDaylightModel(metrics);
  const cycleT=model.dayFrac+(1-model.dayFrac)*0.5;
  const lunar=MM.background._debugMoonlight(cycleT,metrics,MM.worldGen,performance.now());
  if(lunar.moonlight>best.light) best={day,light:lunar.moonlight,cycleT};
}
MM.seasons.setDay(best.day);
MM.background.importState({cycleT:best.cycleT});
if(window.__mmDebugHero && window.player && MM.worldGen && MM.worldGen.surfaceHeight){
  const px=window.player.x;
  window.__mmDebugHero(px,MM.worldGen.surfaceHeight(px)-2);
}
if(MM.fog && MM.fog.setRevealAll) MM.fog.setRevealAll(true);
const ui=document.getElementById('ui'); if(ui) ui.style.display='none';
await sleep(350);
const finalInfo=MM.background.timeInfo();
if(finalInfo.isDay || finalInfo.moonAltitude<0.98 || finalInfo.moonlight<0.20)
  return fail('full Moon did not produce a bright high-night sample: '+JSON.stringify(finalInfo));

return 'ok :: summer='+summer.dayHours+'h day/'+summer.nightHours+'h night'
  +'; winter='+winter.dayHours+'h day/'+winter.nightHours+'h night'
  +'; calendarAudit=40/40'
  +'; sunSpeed='+summerSpeed.toFixed(2)+'/'+winterSpeed.toFixed(2)
  +'; moonSpeed='+summerMoonSpeed.toFixed(2)+'/'+winterMoonSpeed.toFixed(2)
  +'; fullMoonDay='+best.day+' light='+finalInfo.moonlight.toFixed(3);
