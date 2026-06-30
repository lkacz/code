import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

assert.match(mainSource, /let deathTravelFx=null;/, 'death respawn transit has a single active state object');
assert.match(mainSource, /function startDeathTravelFx\(cause\)[\s\S]*deathRespawnTarget\(\)[\s\S]*releaseGameplayInput\(\)[\s\S]*spawnEnergyAbsorb/, 'starting death transit locks input and emits energy toward the respawn target');
assert.match(mainSource, /function finishDeathTravelRespawn\(\)[\s\S]*player\.hp=player\.maxHp[\s\S]*placePlayer\(true,\{center:false\}\)[\s\S]*updateInventory\(\)/, 'respawn completion restores health and uses the normal spawn placement path without snapping the camera');
assert.match(mainSource, /const DEATH_TRAVEL_SPEED_TILES_PER_SEC=\d+;/, 'death transit has an explicit world-speed target');
assert.match(mainSource, /const DEATH_TRAVEL_GROUND_CLEARANCE=10;/, 'death transit cruises about ten blocks above the terrain');
assert.match(mainSource, /function deathTravelProgressAt\(raw\)[\s\S]*slowZone=0\.28[\s\S]*u \+ u\*u - u\*u\*u/, 'death transit keeps most travel steady but eases out before respawn');
assert.match(mainSource, /function deathTravelTrailStartRaw\(fx,raw\)[\s\S]*0\.42\/dur[\s\S]*deathClamp01\(raw\)-slice/, 'death transit renders only a short time-based recent trail instead of the whole route');
assert.match(mainSource, /function deathTravelParticleTailRaw\(fx,raw\)[\s\S]*0\.13\/dur[\s\S]*deathClamp01\(raw\)-slice/, 'death transit particle emission samples a short time slice so flares do not crawl on long respawns');
assert.match(mainSource, /function deathTravelTailAlpha\(v\)[\s\S]*t\*t\*\(3-2\*t\)/, 'death transit lightning tail has a smooth alpha ramp');
assert.match(mainSource, /function deathTravelLightningBolt\(fx,startRaw,endRaw,frame\)[\s\S]*stormScale=Math\.max\(0\.45, Math\.min\(1\.15, trailLen\/10\)\)[\s\S]*segs=9\+Math\.floor/, 'death transit uses storm-lightning segment counts and tile-scale wobble');
assert.match(mainSource, /function deathTravelLightningBolt\(fx,startRaw,endRaw,frame\)[\s\S]*branches=\[\][\s\S]*1\.2\+deathRand[\s\S]*\*1\.6[\s\S]*return \{pts,branches\};/, 'death transit bolt forks use storm-lightning branch lengths');
assert.match(mainSource, /function drawDeathLightningPath\(ctx,bolt,passes\)[\s\S]*deathTravelTailAlpha\(i\/last\)[\s\S]*a\*fade[\s\S]*anchorFade=deathTravelTailAlpha\(bp\.fade\|\|0\)/, 'death transit lightning is drawn segment-by-segment so the tail end fades out');
assert.match(mainSource, /function deathTravelRawGroundYAt\(fx,tx\)[\s\S]*WORLDGEN\.surfaceHeight\(tx\)/, 'death transit samples world surface height along the route');
assert.match(mainSource, /function deathTravelGroundYAt\(fx,x\)[\s\S]*for\(let dx=-4; dx<=4; dx\+\+\)[\s\S]*weight=5-Math\.abs\(dx\)/, 'death transit smooths nearby terrain samples instead of following every tile bump');
assert.match(mainSource, /function deathTravelPointAt\(fx,p\)[\s\S]*cruiseY=deathTravelGroundYAt\(fx,x\)-DEATH_TRAVEL_GROUND_CLEARANCE[\s\S]*cruiseBlend/, 'death transit blends from the death point into a terrain-following spirit flight and back to respawn');
assert.match(mainSource, /function deathTravelEstimatedPathLength\(fx\)[\s\S]*deathTravelPointAt\(fx,i\/steps\)/, 'death transit speed is estimated from the sampled spirit path rather than a straight line');
assert.match(mainSource, /function deathTravelDurationForPathLength\(pathLength\)[\s\S]*len\/DEATH_TRAVEL_SPEED_TILES_PER_SEC/, 'death transit duration is derived from sampled path length and speed');
assert.match(mainSource, /route\.pathLen=deathTravelEstimatedPathLength\(route\);[\s\S]*route\.dur=deathTravelDurationForPathLength\(route\.pathLen\);/, 'death transit no longer forces far respawns into a fixed short duration');
assert.ok(!/0\.9 \+ dist\*0\.018/.test(mainSource), 'death transit does not use the old capped distance fudge');
assert.ok(!/DEATH_TRAVEL_MAX_DUR=2\.35/.test(mainSource), 'death transit no longer has the short max duration that made far flights too fast');
assert.match(mainSource, /function placePlayer\(skipMsg,opts\)[\s\S]*if\(opts\.center===false\)\{ revealAround\(\); ensureChunks\(\); initScarf\(\); \}/, 'placePlayer supports a no-snap mode for smooth death transit handoff');

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
assert.match(mainSource, /function drawPlayer\(\)\{ if\(drawDeathTravelFx\(\)\) return;/, 'player body renderer is replaced by the death energy renderer during transit');
assert.match(mainSource, /if\(!deathTravelFx && WEAPONS && WEAPONS\.drawHeld\) WEAPONS\.drawHeld\(ctx,TILE,player\);/, 'held weapon is hidden during death transit');
assert.match(mainSource, /function cameraCenterForPlayer\(\)\{[\s\S]*deathTravelFx \? deathTravelCurrentPoint\(deathTravelFx\) : player/, 'camera follows the traveling energy while death transit is active');
assert.match(mainSource, /function updateCameraFollow\(dt\)[\s\S]*if\(deathTravelFx\)\{[\s\S]*camSX=c\.x; camSY=c\.y;[\s\S]*applyCameraFromCenter\(\);[\s\S]*return;/, 'death transit keeps the spirit centered instead of camera-lagging behind it');
assert.match(mainSource, /function runGameStep\(dt,ts\)\{\s*if\(updateDeathTravelFx\(dt\)\)\{[\s\S]*updateParticles\(dt\);[\s\S]*updateBlink\(ts\);[\s\S]*return;/, 'simulation pauses gameplay and still advances particles during death transit');

console.log('death-respawn-fx-sim: all assertions passed');
