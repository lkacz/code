import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTemporalEchoController } from '../src/engine/temporal_echo.js';
import { createTemporalCycleRewind, temporalCycleAt } from '../src/engine/temporal_sky_rewind.js';

const echo=createTemporalEchoController({durationSeconds:60,cooldownSeconds:180});
assert.equal(echo.state().phase,'idle');
assert.equal(echo.arm({death:{x:4,y:9}}),true);
assert.equal(echo.arm({}),false,'nested checkpoints are refused');
assert.equal(echo.update(30),null,'timer does not run during death travel');
assert.equal(echo.state().remaining,60);
assert.equal(echo.beginRace(),true);
assert.equal(echo.update(59.75),null);
assert.ok(echo.state().remaining>0 && echo.state().remaining<0.26);
assert.deepEqual(echo.update(0.25),{type:'expired'});
assert.equal(echo.collapse('expired'),true);
assert.equal(echo.arm({death:{x:-2,y:17}}),true);
assert.equal(echo.beginRace(),true);
assert.equal(echo.beginRewind(),true);
assert.equal(echo.finishRewind(),true);
assert.equal(echo.state().cooldown,180);
echo.update(179.9);
assert.equal(echo.arm({}),false);
echo.update(0.1);
assert.equal(echo.arm({}),true);

const repeatableEcho=createTemporalEchoController({durationSeconds:60,cooldownSeconds:0});
assert.equal(repeatableEcho.arm({death:{x:1,y:12}}),true);
assert.equal(repeatableEcho.beginRace(),true);
assert.equal(repeatableEcho.beginRewind(),true);
assert.equal(repeatableEcho.finishRewind(),true);
assert.equal(repeatableEcho.state().cooldown,0,'the gameplay configuration has no post-rewind lock');
assert.equal(repeatableEcho.arm({death:{x:2,y:18}}),true,'the next death can arm Echo immediately');

const daylightPlan=createTemporalCycleRewind(0.32,0.14);
assert.ok(Math.abs(daylightPlan.distance-0.18)<1e-9);
assert.ok(Math.abs(temporalCycleAt(daylightPlan,0)-0.32)<1e-9);
assert.ok(Math.abs(temporalCycleAt(daylightPlan,1)-0.14)<1e-9);
const midnightPlan=createTemporalCycleRewind(0.05,0.95);
assert.ok(Math.abs(midnightPlan.distance-0.1)<1e-9,'sky rewind crosses midnight backwards');
assert.ok(temporalCycleAt(midnightPlan,0.5)<0.05 || temporalCycleAt(midnightPlan,0.5)>0.95,'mid-rewind sky travels through midnight');

const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const world=readFileSync(new URL('../src/engine/world.js',import.meta.url),'utf8');
const mobs=readFileSync(new URL('../src/engine/mobs.js',import.meta.url),'utf8');
const trees=readFileSync(new URL('../src/engine/trees.js',import.meta.url),'utf8');
const falling=readFileSync(new URL('../src/engine/falling.js',import.meta.url),'utf8');
const audio=readFileSync(new URL('../src/engine/audio.js',import.meta.url),'utf8');
function sourceSlice(source,startMarker,endMarker){
  const start=source.indexOf(startMarker);
  assert.notEqual(start,-1,'missing source marker: '+startMarker);
  const end=source.indexOf(endMarker,start+startMarker.length);
  assert.notEqual(end,-1,'missing source marker after '+startMarker+': '+endMarker);
  return source.slice(start,end);
}
function declaredFunctionSource(source,signature){
  const start=source.indexOf(signature);
  assert.notEqual(start,-1,'missing function: '+signature);
  const end=source.indexOf('\nfunction ',start+signature.length);
  return source.slice(start,end<0?source.length:end);
}
assert.match(main,/captureTemporalEcho\(cause\)[\s\S]*buildSaveObject\(\{lightweight:true[\s\S]*TEMPORAL_ECHO\.arm/);
assert.match(main,/const incomplete=Object\.entries\(payload\.data[\s\S]*complete===false/, 'lossy subsystem snapshots refuse to arm an inaccurate rewind');
assert.match(main,/window\.heroDied=function\(cause\)[\s\S]*captureTemporalEcho\(cause\)[\s\S]*HERO_STATUS\.clearAll/);
assert.match(main,/temporalEchoEligible\(cause\)[\s\S]*MM\.challenge\.isIronman/, 'ironman runs cannot rewind their one permitted death');
assert.match(main,/rememberTemporalPending\(payload\)[\s\S]*TEMPORAL_PENDING_KEY/, 'an unresolved branch leaves crash-recovery evidence');
assert.match(main,/createTemporalEchoController\(\{durationSeconds:60,cooldownSeconds:0\}\)/, 'every eligible death can arm a fresh Echo without a hidden cooldown');
assert.match(main,/LEGACY_TEMPORAL_COOLDOWN_KEY[\s\S]*temporalStorageRemove\(LEGACY_TEMPORAL_COOLDOWN_KEY\)/, 'old persisted cooldowns are retired on boot');
assert.doesNotMatch(main,/function persistTemporalCooldown|persistTemporalCooldown\(\)/, 'successful rewind does not suppress the next death');
assert.match(main,/const echoWasActive=temporalEchoActive\(\);[\s\S]{0,500}collapseTemporalEcho\('second-death'[\s\S]{0,500}const echoArmed=captureTemporalEcho\(cause\)/, 'a death during an active race forfeits the old escrow but arms a new Echo');
assert.match(main,/resetWorldTransitionRuntime\(\)[\s\S]*clearTemporalPending\(\)/, 'intentional world transitions clear the crash marker');
assert.match(main,/finishDeathTravelRespawn\(\)[\s\S]*TEMPORAL_ECHO\.beginRace/);
assert.match(main,/function tryOpenGraveAt\(tx,ty\)[\s\S]*activeTemporalGraveAt\(tx,ty\)[\s\S]*wejdź w jego światło[\s\S]*return true/, 'tools cannot trigger the spirit remotely; they teach physical contact');
assert.doesNotMatch(main,/function tryOpenGraveAt\(tx,ty\)\{[\s\S]{0,260}beginTemporalRewind/, 'grave interaction no longer bypasses the contact objective');
assert.match(main,/function breakMinedTile\(\)[\s\S]*tId===T\.GRAVE\) return tryOpenGraveAt/, 'finishing a grave mining action resolves the grave instead of deleting its tile');
assert.match(main,/function playerTouchesTemporalSpirit\(\)[\s\S]*activeTemporalGraveAt[\s\S]*return px1>=sx0/, 'the spirit has a generous body-contact volume');
assert.match(main,/playerTouchesTemporalSpirit\(\) && beginTemporalRewind\(\)/, 'touching the spirit automatically starts the rewind');
assert.match(main,/findGroundedGraveCell\(cx,cy,[\s\S]*isSupport:isObjectFootingTile/, 'death markers require physical footing instead of freezing in open air');
assert.match(main,/t===T\.GRAVE && !activeTemporalSpiritAt\(wx,y\)[\s\S]*drawGraveTile/, 'the temporal interaction anchor never bakes a floating stone marker');
assert.match(main,/function drawTemporalEchoSpirit\([\s\S]*Clock halo[\s\S]*Temporal motes/, 'the Echo target is a distinct animated spirit');
assert.match(main,/function forfeitTemporalEscrow\(\)[\s\S]*grave=null[\s\S]*refreshGraveMarkerVisual/, 'an expired spirit leaves a visually refreshed but untracked empty gravestone');
assert.match(main,/function collapseTemporalEcho\(reason,notice\)[\s\S]*forfeitTemporalEscrow\(\)[\s\S]*saveGrave\(\); saveState\(\)/, 'every failed Echo resolution destroys its escrow before persistence');
assert.match(main,/event&&event\.type==='expired'[\s\S]*zasoby z Echa przepadły[\s\S]*pusty nagrobek/, 'the timeout clearly communicates permanent resource loss');
assert.match(main,/kind:'spirit'/, 'the QA contract identifies the new target presentation');
assert.match(main,/restoreTemporalEchoPayload\(payload\)[\s\S]*restoreTemporalCheckpoint\(\)[\s\S]*player\.hp=player\.maxHp[\s\S]*hpInvul/);
assert.match(main,/restoreTemporalEchoPayload\(payload\)[\s\S]*DISCOVERY\.restore\(payload\.discovery\)/, 'branch-only discoveries are rolled back with their XP');
assert.match(main,/restoreTemporalEchoPayload\(payload\)[\s\S]*applyProgressHp\(\)[\s\S]*applyHeroEnergyCapacity\(\)/, 'derived hero capacities are recomputed from restored progression and gear');
assert.match(main,/getTile\(gx,gy\)!==T\.GRAVE[\s\S]*zasoby zostały zwrócone/, 'failed grave placement refunds resources instead of creating an impossible objective');
assert.match(main,/previousGrave && previousGrave!==grave[\s\S]{0,700}setForegroundConfirmed\(previousGrave\.x,previousGrave\.y,T\.AIR\)[\s\S]{0,400}Poprzedni nagrobek wygasł/, 'a replacement death retires the old marker and explicitly reports its forfeited payload');
assert.match(main,/function reconcileGraveReturnTask\(\)[\s\S]{0,1800}if\(discardedGraveTask\) return true[\s\S]{0,500}upsertGraveReturnTask\(grave,false,\{[\s\S]{0,180}preservePriority:keepOtherPriority\|\|activeGraveTask/, 'restored graves reconcile their canonical recovery objective without resurrecting or repinning a dismissed target');
assert.match(main,/restoreRequired\('tasks'[\s\S]{0,260}reconcileGraveReturnTask\(\)/, 'save loading reconciles grave geometry only after task state has been restored');
assert.match(main,/restoreGrave\(d\.grave\);\s*reconcileGraveReturnTask\(\)/, 'temporal restoration also reconciles a migrated or restored grave target');
const trackedGraveSource=declaredFunctionSource(main,'function repairTrackedGrave()');
assert.match(trackedGraveSource,/graveHasStableGround|nearestOpenGraveCell/, 'tracked grave repair validates footing instead of merely repainting a floating marker');
assert.match(trackedGraveSource,/T\.GRAVE[\s\S]*(?:setForegroundConfirmed|setTile)/, 'tracked grave repair restores an externally destroyed marker through the world write path');
assert.match(trackedGraveSource,/reconcileGraveReturnTask|upsertGraveReturnTask/, 'tracked grave relocation keeps the recovery task synchronized with its physical marker');
assert.match(trackedGraveSource,/wasEcho[\s\S]*upsertGraveReturnTask\(grave,true,\{[\s\S]*reactivate:false[\s\S]*\}[\s\S]*(?:else[\s\S]*)?reconcileGraveReturnTask/,
  'repair preserves the temporal task identity and a dismissed/unpinned decision; only an ordinary grave uses ordinary reconciliation');
assert.match(trackedGraveSource,/grave=null|refund|zwr[oĂł]cone/i, 'an impossible ordinary-grave repair cannot leave an inaccessible escrow record behind');
assert.equal(main.includes('repairTemporalGrave'),false, 'the superseded temporal-only repair seam has no dangling callers');
assert.match(main,/function tryOpenGraveAt\(tx,ty\)[\s\S]{0,180}repairTrackedGrave\(\)/,
  'tool interaction rechecks the same tracked-grave invariant instead of calling a removed temporal-only helper');
const echoUpdateSource=sourceSlice(main,'function updateTemporalEcho(dt)','MM.temporalEcho={');
const trackedRepairAt=echoUpdateSource.indexOf('repairTrackedGrave()');
const phaseReadAt=echoUpdateSource.indexOf('const state=temporalEchoState()');
assert.ok(trackedRepairAt>=0 && phaseReadAt>=0 && trackedRepairAt<phaseReadAt,
  'every frame repairs the tracked marker before phase-specific Echo handling, including ordinary graves');
const applyGameDataSource=sourceSlice(main,'function applyGameData(data,opts)','function applyGameDataCore(data,opts)');
const loadEchoGuardAt=applyGameDataSource.indexOf('temporalEchoActive()');
const loadPreflightAt=applyGameDataSource.indexOf('preflightSaveData');
const loadRollbackSnapshotAt=applyGameDataSource.indexOf('buildSaveObject');
assert.ok(loadEchoGuardAt>=0 && loadPreflightAt>=0 && loadRollbackSnapshotAt>=0
  && loadEchoGuardAt<loadPreflightAt && loadEchoGuardAt<loadRollbackSnapshotAt,
  'the central load chokepoint refuses an active Echo before preflight or rollback capture can consume its checkpoint');
assert.match(applyGameDataSource.slice(loadEchoGuardAt,Math.min(loadPreflightAt,loadRollbackSnapshotAt)),/return false/,
  'the active-Echo load guard fails closed');
const replacementSource=sourceSlice(main,'function prepareHostedWorldReplacement()','function startNewGame(requestedSeed)');
const replacementEchoGuardAt=replacementSource.indexOf('temporalEchoActive()');
const roomRotationAt=replacementSource.indexOf('rotateRoomNamespace');
assert.ok(replacementEchoGuardAt>=0 && roomRotationAt>=0 && replacementEchoGuardAt<roomRotationAt,
  'player-facing world replacement refuses an active Echo before rotating or stopping a hosted room');
assert.match(replacementSource.slice(replacementEchoGuardAt,roomRotationAt),/return false/,
  'the world-replacement UX guard leaves the active escrow untouched');
assert.match(main,/function saveState\(\)[\s\S]*temporalEchoActive\(\)\) return/);
assert.match(main,/function drawTemporalEchoOverlay\(ts\)[\s\S]*globalCompositeOperation='screen'/);
assert.match(main,/function drawTemporalEchoOverlay\(ts\)[\s\S]*createRadialGradient/);
assert.match(main,/function drawTemporalEchoOverlay\(ts\)[\s\S]*COFANIE/);
assert.match(main,/STAWKA: '\+escrow\+' ZASOBÓW — PRZEPADNĄ PO CZASIE/, 'the HUD makes the resource stakes explicit');
assert.match(main,/function temporalSkyRewindFor\(payload\)[\s\S]*createTemporalCycleRewind/, 'rewind captures a backwards celestial route from the current sky to the death sky');
assert.match(main,/function applyTemporalSkyRewind\(fx,progress\)[\s\S]*BACKGROUND\.importState/, 'the real background clock is animated during rewind');
assert.match(main,/function drawTemporalCelestialRewindTrail\(fx,pulse\)[\s\S]*_debugCelestialCyclePosition/, 'the sun or moon gains readable reverse-motion afterimages');
assert.match(main,/Po śmierci utracone zasoby przejmuje Duch Chwili — dotknij go przed końcem odliczania, aby odzyskać depozyt i cofnąć świat/, 'help teaches contact, the deadline, escrow recovery and rewind');
assert.match(world,/TEMPORAL_SECTION_CAP=2048/);
assert.match(world,/function rememberTemporalSection[\s\S]*arr\.slice\(\)/, 'terrain uses section-level copy-on-write');
assert.match(world,/function invalidateTemporalJournal[\s\S]*temporalJournal\.invalid=true/);
assert.match(world,/function restoreTemporalCheckpoint\(\)[\s\S]*journal\.sections\.values\(\)/);
assert.match(world,/journal\.chunkMeta\.values\(\)[\s\S]*modifiedChunks/, 'discarded branches do not permanently pin generated chunks');
assert.match(mobs,/function temporalSnapshot\(\)[\s\S]*projectiles:mobProjectiles[\s\S]*lasers:mobLasers/);
assert.match(mobs,/function temporalRestore\(src\)[\s\S]*mobProjectiles\.length=0[\s\S]*mobLasers\.length=0/, 'fatal-moment hostile combat transients are restored');
assert.match(trees,/complete=fallenTreeTiles\.size[\s\S]*rotating/, 'falling trees and oversized registries are represented explicitly');
assert.match(falling,/const complete=active\.length[\s\S]*unstable\.size<=6000/, 'falling-terrain truncation fails closed for temporal capture');
assert.match(audio,/temporalArm:[\s\S]*temporalRewind:[\s\S]*temporalReturn:/);
console.log('temporal-echo-sim: all assertions passed');
