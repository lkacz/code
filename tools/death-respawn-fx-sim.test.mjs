import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WORLD_H, WORLD_MAX_Y, WORLD_MIN_Y, WORLD_SECTION_H } from '../src/constants.js';
import {
  respawnTravelSection,
  sectionAwareRespawnPoint,
  usesSurfaceRespawnRoute
} from '../src/engine/respawn_travel.js';

const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const constantsSource = readFileSync(new URL('../src/constants.js', import.meta.url), 'utf8');

assert.match(mainSource, /let deathTravelFx=null;/, 'death respawn transit has a single active state object');
assert.match(mainSource, /const HERO_DEATH_SLOW_MOTION_HOLD_MS=3000;/, 'hero death holds slow motion for three real seconds');
assert.match(mainSource, /const HERO_DEATH_SLOW_MOTION_RECOVERY_MS=3000;/, 'hero death recovers over the following three real seconds');
assert.match(mainSource, /const HERO_DEATH_SLOW_MOTION_SCALE=0\.25;/, 'hero death uses quarter-speed simulation');
assert.match(mainSource, /function simulationTimeScaleAt\(now\)[\s\S]*recoveryStart[\s\S]*raw\*raw\*\(3-2\*raw\)[\s\S]*slowScale\+\(configured-slowScale\)\*eased/, 'death time eases smoothly from quarter speed back to the configured pace');
assert.match(mainSource, /window\.heroDied=function\(cause\)\{[\s\S]*beginHeroDeathSlowMotion\(\);/, 'every centralized hero death starts the slow-motion beat');
assert.match(mainSource, /const simulationDt=frameDt\*timeScale;[\s\S]*runGameFrame\(simulationDt,ts\)/, 'the shared time scale drives the complete game simulation');
assert.match(mainSource, /function runGameFrame\(totalDt,ts\)[\s\S]*Math\.ceil\([\s\S]*MAX_FRAME_DT[\s\S]*runGameStep\(stepDt,ts\)/, 'fast debug pacing is safely divided into bounded simulation steps');
assert.match(mainSource, /function startDeathTravelFx\(cause\)[\s\S]*lockDeathRespawnTarget\(deathRespawnTarget\(\)\)[\s\S]*surfaceRoute:usesSurfaceRespawnRoute[\s\S]*releaseGameplayInput\(\)[\s\S]*spawnEnergyAbsorb/, 'starting death transit freezes one section-aware target, locks input and emits energy toward it');
assert.match(mainSource, /function lockDeathRespawnTarget\(target\)[\s\S]*Object\.freeze/, 'the selected respawn target cannot drift after departure');
assert.match(mainSource, /function finishDeathTravelRespawn\(\)[\s\S]*player\.hp=player\.maxHp[\s\S]*placePlayerAtRespawnSpot\(fx\.to\)[\s\S]*centerOnPlayer\(\)[\s\S]*updateInventory\(\)/, 'respawn completion lands at the frozen target and synchronizes the camera in the same tick');
assert.match(mainSource, /const DEATH_TRAVEL_SPEED_TILES_PER_SEC=\d+;/, 'death transit has an explicit world-speed target');
assert.match(mainSource, /const DEATH_TRAVEL_GROUND_CLEARANCE=10;/, 'death transit cruises about ten blocks above the terrain');
assert.match(mainSource, /function deathTravelProgressAt\(raw\)[\s\S]*slowZone=0\.28[\s\S]*u \+ u\*u - u\*u\*u/, 'death transit keeps most travel steady but eases out before respawn');
assert.match(mainSource, /function deathTravelTrailStartRaw\(fx,raw\)[\s\S]*0\.42\/dur[\s\S]*deathClamp01\(raw\)-slice/, 'death transit renders only a short time-based recent trail instead of the whole route');
assert.match(mainSource, /function deathTravelParticleTailRaw\(fx,raw\)[\s\S]*0\.13\/dur[\s\S]*deathClamp01\(raw\)-slice/, 'death transit particle emission samples a short time slice so flares do not crawl on long respawns');
assert.match(mainSource, /function deathTravelTailAlpha\(v\)[\s\S]*t\*t\*\(3-2\*t\)/, 'death transit lightning tail has a smooth alpha ramp');
assert.match(mainSource, /function deathTravelLightningBolt\(fx,startRaw,endRaw,frame\)[\s\S]*stormScale=Math\.max\(0\.45, Math\.min\(1\.15, trailLen\/10\)\)[\s\S]*segs=9\+Math\.floor/, 'death transit uses storm-lightning segment counts and tile-scale wobble');
assert.match(mainSource, /function deathTravelLightningBolt\(fx,startRaw,endRaw,frame\)[\s\S]*branches=\[\][\s\S]*1\.2\+deathRand[\s\S]*\*1\.6[\s\S]*return \{pts,branches\};/, 'death transit bolt forks use storm-lightning branch lengths');
assert.match(mainSource, /function drawDeathLightningPath\(ctx,bolt,passes\)[\s\S]*deathTravelTailAlpha\(i\/last\)[\s\S]*a\*fade[\s\S]*anchorFade=deathTravelTailAlpha\(bp\.fade\|\|0\)/, 'death transit lightning is drawn segment-by-segment so the tail end fades out');
assert.match(mainSource, /function deathTravelRawGroundYAt\(fx,tx\)\{\s*if\(!fx \|\| fx\.surfaceRoute!==true\) return null;[\s\S]*WORLDGEN\.surfaceHeight\(tx\)/, 'surface height sampling is guarded so sky, cave and deep routes never use it');
assert.match(mainSource, /function deathTravelGroundYAt\(fx,x\)[\s\S]*for\(let dx=-4; dx<=4; dx\+\+\)[\s\S]*weight=5-Math\.abs\(dx\)/, 'death transit smooths nearby terrain samples instead of following every tile bump');
assert.match(mainSource, /function deathTravelPointAt\(fx,p\)[\s\S]*fx\.surfaceRoute \? deathTravelGroundYAt\(fx,x\) : null[\s\S]*sectionAwareRespawnPoint/, 'death transit delegates the complete vertical route to the section-aware point calculator');
assert.match(mainSource, /function deathTravelEstimatedPathLength\(fx\)[\s\S]*deathTravelPointAt\(fx,i\/steps\)/, 'death transit speed is estimated from the sampled spirit path rather than a straight line');
assert.match(mainSource, /function deathTravelDurationForPathLength\(pathLength\)[\s\S]*len\/DEATH_TRAVEL_SPEED_TILES_PER_SEC/, 'death transit duration is derived from sampled path length and speed');
assert.match(mainSource, /function deathTravelRemainingPathLength\(fx,progress\)[\s\S]*deathTravelPointAt\(fx,start\)[\s\S]*deathTravelPointAt\(fx,p\)/, 'death transit HUD samples the remaining route instead of showing straight-line distance');
assert.match(mainSource, /function deathTravelHudMetrics\(\)[\s\S]*const fx=deathTravelFx;[\s\S]*deathTravelPointAt\(fx,progress\)[\s\S]*distanceLeft:deathTravelRemainingPathLength\(fx,progress\)[\s\S]*secondsLeft:Math\.max\(0,dur-t\)/, 'death transit exposes live HUD position, remaining distance and ETA');
assert.match(mainSource, /route\.pathLen=deathTravelEstimatedPathLength\(route\);[\s\S]*route\.dur=deathTravelDurationForPathLength\(route\.pathLen\);/, 'death transit no longer forces far respawns into a fixed short duration');
assert.ok(!/0\.9 \+ dist\*0\.018/.test(mainSource), 'death transit does not use the old capped distance fudge');
assert.ok(!/DEATH_TRAVEL_MAX_DUR=2\.35/.test(mainSource), 'death transit no longer has the short max duration that made far flights too fast');
assert.match(mainSource, /function placePlayerAtRespawnSpot\(spot\)[\s\S]*ensureChunkAtY\(Math\.floor\(x\/CHUNK_W\),y\)[\s\S]*player\.x=x; player\.y=y/, 'the locked landing helper warms and places within the exact destination section');
assert.match(constantsSource, /RESPAWN_TOTEM:77/, 'respawn totem is a stable terrain tile rather than a virtual marker');
assert.match(constantsSource, /77:\{hp:8,color:'#e23b4e',drop:'respawnTotem',passable:true,\s*respawnTotem:true\}/, 'respawn totem drops as a placeable passable fixture');
assert.doesNotMatch(mainSource, /RESPAWN_TOTEM_MINE_ID/, 'respawn totem no longer uses a virtual mining target id');
assert.match(mainSource, /function noteRespawnTotemTileChanged\(tx,ty,old,next\)[\s\S]*old!==T\.RESPAWN_TOTEM && next!==T\.RESPAWN_TOTEM[\s\S]*saveRespawnTotems\(\)/, 'real terrain tile changes keep the respawn totem index synchronized');
assert.match(mainSource, /MM\.onTileRenderChanged=function\(tx,ty,old,next\)[\s\S]*noteRespawnTotemTileChanged\(tx,ty,old,next\)/, 'world tile lifecycle hook updates respawn totems for placement, mining and undo');
assert.match(mainSource, /function nearestRespawnTotem\(\)[\s\S]*validRespawnTotemCells\(\)[\s\S]*if\(d<bestD\)\{ bestD=d; best=p; \}/, 'death respawn ranks all living totems by distance to the hero');
assert.match(mainSource, /function nearestRespawnDestination\(\)[\s\S]*const totem=nearestRespawnTotem\(\);[\s\S]*const home=nearestHealingShelter\(\);[\s\S]*totemCand\.d<=homeCand\.d \? totemCand : homeCand/, 'death respawn compares the nearest totem and nearest healing shelter by actual landing distance, preferring totems on ties');
assert.match(mainSource, /function deathRespawnTarget\(\)\{\s*const dest=nearestRespawnDestination\(\);\s*if\(dest && dest\.spot\) return dest\.spot;\s*return defaultRespawnTarget\(\);\s*\}/, 'death transit targets the nearest valid totem or healing shelter, then falls back to map start');
assert.match(mainSource, /function placePlayer\(skipMsg,opts\)[\s\S]*const dest=nearestRespawnDestination\(\);[\s\S]*placePlayerAtRespawnSpot\(spot\)/, 'ordinary placement shares the exact section-aware landing helper');
assert.match(mainSource, /function registerHealingShelterStatus\(status,opts\)[\s\S]*healingShelterSignalAt\(rec,false\)/, 'valid healing shelters are indexed and show a heart when first registered');
assert.match(mainSource, /function noteHealingShelterTileChanged\(tx,ty\)[\s\S]*validateHealingShelters\(\{changed:\{x:tx,y:ty\},signal:true\}\)/, 'remembered homes revalidate nearby tile edits and can show a broken heart');
assert.match(mainSource, /pushWorldNumber\(\{kind:'home',icon:broken\?'brokenHeart':'heart'/, 'home and broken-home feedback uses icon-only world popups');

const deathHandler = mainSource.match(/window\.heroDied=function\(cause\)\{([\s\S]*?)\n\};/);
assert.ok(deathHandler, 'hero death handler is present');
assert.ok(!deathHandler[1].includes('placePlayer(true)'), 'hero death no longer teleports in the same frame');
assert.match(deathHandler[1], /updateInventory\(\);\s*startDeathTravelFx\(cause\);/, 'hero death schedules the transit after creating the grave drop');

assert.match(mainSource, /if\(deathTravelFx\) return false;\s*if\(immunityMode\)\{ player\.hp=player\.maxHp; return false; \}\s*const now=performance\.now\(\);/, 'damage is ignored while the hero is already in death transit or immune');
assert.match(mainSource, /const HURT_FLASH_MS=520;/, 'hurt screen flash has a fixed short duration');
assert.match(mainSource, /player\.hurtFlashUntil=now\+HURT_FLASH_MS;/, 'damage starts a fixed hurt flash independent of i-frame duration');
assert.match(mainSource, /player\.hurtFlashUntil=Math\.max\(player\.hurtFlashUntil\|\|0, performance\.now\(\)\+HURT_FLASH_MS\);/, 'direct death starts the same fixed hurt flash');
assert.match(mainSource, /const flashLeft=\(player\.hurtFlashUntil\|\|0\)-performance\.now\(\);[\s\S]*flashLeft\/HURT_FLASH_MS/, 'red screen overlay fades by fixed hurt flash timing instead of hpInvul');
assert.ok(!/player\.hpInvul[^;]*rgba\(255,0,0/.test(mainSource), 'red screen overlay is not tied to respawn invulnerability');
assert.match(mainSource, /function drawDeathTravelFx\(\)[\s\S]*globalCompositeOperation='lighter'[\s\S]*deathRand/, 'death transit draws a procedural bright energy trail');
assert.match(mainSource, /function drawDeathTravelFx\(\)[\s\S]*travelP=deathTravelProgressAt\(raw\)[\s\S]*deathTravelPointAt\(fx,travelP\)/, 'death transit renderer uses the slowed arrival position');
assert.match(mainSource, /function drawDeathTravelFx\(\)[\s\S]*deathTravelLightningBolt\(fx,trailStart,raw[\s\S]*\[7,160,190,255[\s\S]*\[3\.2,210,230,255[\s\S]*\[1\.5,255,255,255[\s\S]*drawDeathLightningPath\(ctx,bolt,passes\)/, 'death transit tail uses the storm-lightning stroke stack with faded segments');
assert.ok(!/rgba\(100,240,255/.test(mainSource), 'death transit no longer draws the unnecessary thick blue route line');
assert.match(mainSource, /spawnEnergyAbsorb\([^\n]+quick:true,hue:'gold'\}/, 'death transit requests quick warm energy particles');
assert.match(mainSource, /function drawCape\(\)\{ if\(deathTravelFx\) return; CAPE\.draw\(ctx,TILE\); \}/, 'cape is hidden while the hero is transformed into energy');
assert.match(mainSource, /function drawPlayer\(opts\)\{ if\(drawDeathTravelFx\(\)\) return;/, 'player body renderer is replaced by the death energy renderer during transit even with mirror-view options');
assert.match(mainSource, /if\(!deathTravelFx && heroCloakA>=0\.98 && WEAPONS && WEAPONS\.drawHeld\) WEAPONS\.drawHeld\(ctx,TILE,player\);/, 'held weapon is hidden during death transit (and while the antenna cloak runs)');
assert.match(mainSource, /function drawBackground\(\)\{[\s\S]*const focus=deathTravelFx \? deathTravelCurrentPoint\(deathTravelFx\) : player;[\s\S]*BACKGROUND\.draw\(ctx, W, H, focus\.x, TILE, WORLDGEN, zoom\);/, 'background biome and parallax anchor follow the traveling energy during death transit');
assert.match(mainSource, /function cameraCenterForPlayer\(\)\{[\s\S]*deathTravelFx \? deathTravelCurrentPoint\(deathTravelFx\) : player/, 'camera follows the traveling energy while death transit is active');
assert.match(mainSource, /function updateCameraFollow\(dt\)[\s\S]*if\(deathTravelFx\)\{[\s\S]*camSX=c\.x; camSY=c\.y;[\s\S]*applyCameraFromCenter\(\);[\s\S]*return;/, 'death transit keeps the spirit centered instead of camera-lagging behind it');
assert.match(mainSource, /function updateStatusHud\(ts\)[\s\S]*const travel=deathTravelHudMetrics\(\);[\s\S]*const pos=\(travel && travel\.pos\) \|\| player;[\s\S]*fmtStatusCoord\(pos\.x\)\+','\+fmtStatusCoord\(pos\.y\)/, 'status panel reports the traveling spirit position while death transit is active');
assert.match(mainSource, /function updateStatusHud\(ts\)[\s\S]*if\(travel\)\{[\s\S]*fmtStatusDistance\(travel\.distanceLeft\)[\s\S]*fmtStatusSeconds\(travel\.secondsLeft\)/, 'status panel adds remaining distance and ETA during death transit');
assert.match(mainSource, /function updateStatusHud\(ts\)[\s\S]*const pos=\(travel && travel\.pos\) \|\| player;[\s\S]*localTemperatureC\(pos\)/, 'status thermometer follows the same displayed position during death transit');
assert.match(indexSource, /id="worldStatus"[^>]*title="[^"]*temperatura[^"]*"/, 'status tooltip advertises the local temperature reading');
assert.match(mainSource, /CLOUDS\.isRainingAt\) \? CLOUDS\.isRainingAt\(Math\.floor\(pos\.x\)\)/, 'status panel weather lookup follows the live displayed position during death transit');
assert.match(indexSource, /#worldStatusPanel\{[^}]*max-width:min\(520px,58vw\)[^}]*overflow:hidden/, 'status panel is bounded so death transit HUD details do not break the top bar');
assert.match(indexSource, /#worldStatus\{[^}]*white-space:nowrap[^}]*text-overflow:ellipsis/, 'status text remains a single trimmed line on narrow screens');
assert.match(mainSource, /function runGameStep\(dt,ts\)\{\s*if\(updateDeathTravelFx\(dt\)\)\{[\s\S]*updateParticles\(dt\);[\s\S]*updateBlink\(ts\);[\s\S]*return;/, 'simulation pauses gameplay and still advances particles during death transit');

const routeOpts={
  sectionHeight:WORLD_SECTION_H,
  baseSectionMin:0,
  baseSectionMax:Math.ceil(WORLD_H/WORLD_SECTION_H)-1,
  minY:WORLD_MIN_Y,
  maxY:WORLD_MAX_Y,
  clearance:10,
  edgeMargin:2,
  sourceSurfaceY:60,
  targetSurfaceY:60,
  surfaceBand:18
};
assert.equal(usesSurfaceRespawnRoute(59,61,routeOpts),true,'near-surface middle-world travel retains terrain following');
assert.equal(usesSurfaceRespawnRoute(59,61,{...routeOpts,sourceSurfaceY:null}),false,'missing surface evidence safely disables terrain following');
assert.equal(usesSurfaceRespawnRoute(-105,-95,routeOpts),false,'high-sky travel never follows the middle-world surface');
assert.equal(usesSurfaceRespawnRoute(125,130,routeOpts),false,'deep cave travel inside the legacy array does not rise to the surface');
const surfaceMid=sectionAwareRespawnPoint({from:{x:0,y:59},to:{x:20,y:61},seed:0},0.5,64,routeOpts);
assert.ok(Math.abs(surfaceMid.y-54)<0.001,'near-surface route still cruises ten blocks above smoothed terrain');

for(const sy of [-2,-1,0,1,2,3]){
  const top=sy*WORLD_SECTION_H;
  const fromY=top+25, toY=top+43;
  const opts={...routeOpts,sourceSurfaceY:60,targetSurfaceY:60};
  for(let i=0;i<=40;i++){
    const point=sectionAwareRespawnPoint({from:{x:0,y:fromY},to:{x:80,y:toY},seed:sy+7},i/40,null,opts);
    assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.y),'section '+sy+' route remains finite');
    assert.equal(respawnTravelSection(point.y,WORLD_SECTION_H),sy,'same-section route remains inside section '+sy);
  }
}

for(const sy of [-2,-1,0,1,2,3]){
  const top=sy*WORLD_SECTION_H;
  for(const [fromY,toY,edge] of [
    [top+0.05,top+0.15,'top'],
    [top+WORLD_SECTION_H-0.15,top+WORLD_SECTION_H-0.05,'bottom']
  ]){
    const route={from:{x:0,y:fromY},to:{x:20,y:toY},seed:sy+31};
    const start=sectionAwareRespawnPoint(route,0,null,routeOpts);
    const justAfterStart=sectionAwareRespawnPoint(route,1e-6,null,routeOpts);
    const justBeforeEnd=sectionAwareRespawnPoint(route,1-1e-6,null,routeOpts);
    const end=sectionAwareRespawnPoint(route,1,null,routeOpts);
    assert.ok(Math.abs(justAfterStart.y-start.y)<0.001,'section '+sy+' '+edge+' departure is continuous');
    assert.ok(Math.abs(end.y-justBeforeEnd.y)<0.001,'section '+sy+' '+edge+' landing is continuous');
    assert.equal(respawnTravelSection(justAfterStart.y,WORLD_SECTION_H),sy,'section '+sy+' '+edge+' departure remains in its layer');
    assert.equal(respawnTravelSection(justBeforeEnd.y,WORLD_SECTION_H),sy,'section '+sy+' '+edge+' landing remains in its layer');
  }
}

for(const [fromY,toY] of [[60,-105],[-105,175],[175,-35],[-70.1,-69.9]]){
  const ascending=toY>=fromY;
  let previous=fromY;
  for(let i=0;i<=80;i++){
    const point=sectionAwareRespawnPoint({from:{x:0,y:fromY},to:{x:120,y:toY},seed:19},i/80,null,routeOpts);
    assert.ok(Number.isFinite(point.y),'cross-section route remains finite');
    if(i>0) assert.ok(ascending ? point.y>=previous-1e-9 : point.y<=previous+1e-9,'cross-section y stays monotone');
    previous=point.y;
  }
  assert.ok(Math.abs(previous-toY)<1e-9,'cross-section route ends at its exact frozen y');
}

for(const fromSection of [-2,-1,0,1,2,3]){
  for(const toSection of [-2,-1,0,1,2,3]){
    if(fromSection===toSection) continue;
    const fromY=fromSection*WORLD_SECTION_H+WORLD_SECTION_H*0.42;
    const toY=toSection*WORLD_SECTION_H+WORLD_SECTION_H*0.58;
    let previous=fromY;
    for(let i=1;i<=50;i++){
      const point=sectionAwareRespawnPoint({from:{x:-30,y:fromY},to:{x:260,y:toY},seed:73},i/50,null,routeOpts);
      assert.ok(toY>fromY ? point.y>=previous-1e-9 : point.y<=previous+1e-9,'section-pair '+fromSection+'→'+toSection+' remains monotone');
      previous=point.y;
    }
    assert.ok(Math.abs(previous-toY)<1e-9,'section-pair '+fromSection+'→'+toSection+' lands exactly');
  }
}

assert.match(mainSource, /function resetWorldTransitionRuntime\(\)[\s\S]*deathTravelFx=null;[\s\S]*resetHouseHealingRuntimeState\(\)[\s\S]*player\.hpInvul=0;[\s\S]*player\.hurtFlashUntil=0;[\s\S]*releaseGameplayInput\(\)/, 'world replacement cancels death travel, healing state, invulnerability and held input together');
assert.match(mainSource, /function resetHouseHealingRuntimeState\(\)[\s\S]*HOUSE_HEALING\.createState[\s\S]*Object\.assign\(houseHealingState,fresh\)[\s\S]*houseHealMsgAt=0;/, 'world replacement recreates the full house-healing runtime state');
assert.match(mainSource, /function applyGameDataCore\(data,opts\)[\s\S]*if\(ver!==SAVE_SCHEMA_VERSION\)[^\n]*[\s\S]*const legacyWorldMarkers=[\s\S]*resetWorldTransitionRuntime\(\);[\s\S]*if\(WORLD && WORLD\.clear\) WORLD\.clear\(\)/, 'preflight-migrated snapshot loading captures guarded legacy markers, then cancels transient respawn state before replacing chunks');
assert.match(mainSource, /function regenWorld\(\)\{\s*resetWorldTransitionRuntime\(\);[\s\S]*WORLD\.clear\(\)/, 'new-seed regeneration cancels transient respawn state before clearing the world');
assert.match(mainSource, /window\.regenWorldSameSeed = function\(\)\{ try\{ resetWorldTransitionRuntime\(\);[\s\S]*WORLD && WORLD\.clear/, 'same-seed regeneration cancels transient respawn state before clearing the world');

console.log('death-respawn-fx-sim: all assertions passed');
