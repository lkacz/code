import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis;
globalThis.MM = {};

const { MOVE, T } = await import('../src/constants.js');
const { JUMP_ARC, applyHorizontalMovement, applyJumpArcControl, surfaceTraction } = await import('../src/engine/movement.js');

function coast(tile, seconds){
  let vx = MOVE.MAX * 2;
  const dt = 1 / 60;
  for(let t=0; t<seconds; t+=dt) vx = applyHorizontalMovement(vx, 0, dt, 2, MOVE, tile);
  return vx;
}

function accelerate(tile, seconds){
  let vx = 0;
  const dt = 1 / 60;
  for(let t=0; t<seconds; t+=dt) vx = applyHorizontalMovement(vx, 1, dt, 2, MOVE, tile);
  return vx;
}

const normal = surfaceTraction(T.GRASS);
const snow = surfaceTraction(T.SNOW);
const ice = surfaceTraction(T.ICE);

assert.equal(normal.kind, 'normal', 'ordinary ground uses normal traction');
assert.equal(snow.kind, 'snow', 'snow has its own traction profile');
assert.equal(ice.kind, 'ice', 'ice has its own traction profile');
assert.ok(snow.friction < normal.friction, 'snow reduces braking friction');
assert.ok(ice.friction < snow.friction, 'ice reduces braking friction more than snow');
assert.ok(ice.accel < snow.accel && snow.accel < normal.accel, 'snow and ice reduce steering acceleration');

const normalAfter = coast(T.GRASS, 0.5);
const snowAfter = coast(T.SNOW, 0.5);
const iceAfter = coast(T.ICE, 0.5);
assert.ok(normalAfter < 0.1, 'ordinary ground stops quickly');
assert.ok(snowAfter > normalAfter + 3, 'snow keeps the hero sliding after releasing input');
assert.ok(iceAfter > snowAfter + 5, 'ice keeps substantially more glide than snow');

assert.ok(accelerate(T.ICE, 0.25) < accelerate(T.SNOW, 0.25), 'ice starts/turns more slowly than snow');

const defaultHeroGravity = MOVE.GRAV * 2;
const fullJumpVy = MOVE.JUMP * 2;
assert.equal(applyJumpArcControl(fullJumpVy, defaultHeroGravity, {release:true}), fullJumpVy, 'releasing jump no longer trims the arc into a small hop');
const downCancelVy = applyJumpArcControl(fullJumpVy, defaultHeroGravity, {cancel:true});
assert.ok(downCancelVy > 0, 'pressing down during upward jump turns the arc into a fall');
assert.equal(applyJumpArcControl(8, defaultHeroGravity, {cancel:true}), 8, 'down cancel does not slow an already faster fall');
assert.equal(JUMP_ARC.DOWN_CANCEL_FALL_TILES, 0.08, 'down cancel keeps a crisp fall impulse');

const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(mainSource, /function renderCameraCoord\(v\)/, 'render camera has a device-pixel snap helper');
assert.match(mainSource, /return Math\.round\(v\*scale\)\/scale;/, 'render camera snaps only to device pixels, not whole tiles');
assert.match(mainSource, /const renderCam=currentRenderCamera\(\);/, 'draw loop computes one stable render camera per frame');
assert.match(mainSource, /const camRenderX = renderCam\.x;\s+const camRenderY = renderCam\.y;/, 'world render uses the pixel-stable render camera');
assert.match(mainSource, /function drawBackground\(\)\{[\s\S]*const focus=deathTravelFx \? deathTravelCurrentPoint\(deathTravelFx\) : player;[\s\S]*BACKGROUND\.draw\(ctx, W, H, focus\.x, TILE, WORLDGEN, zoom\);/, 'background parallax follows the player normally and the traveling death point during respawn transit');
assert.ok(!mainSource.includes('backgroundCameraX('), 'background parallax does not use the snapped render camera');
assert.match(mainSource, /const CAMERA_MAX_DT=0\.05;/, 'camera follow delta matches the capped per-frame simulation delta');
assert.match(mainSource, /function runGameStep\(dt,ts\)/, 'game simulation is extracted into one rendered-frame step');
assert.match(mainSource, /const MAX_FRAME_DT=0\.05;/, 'long frames are capped to the stable single-step budget');
assert.match(mainSource, /runGameStep\(frameDt,ts\);/, 'game simulation advances once per rendered frame');
assert.ok(!mainSource.includes('MAX_SIM_STEPS'), 'frame loop does not run multiple catch-up simulation steps before one render');
assert.ok(!mainSource.includes('while(remaining>'), 'frame loop avoids catch-up substep bursts that can make the camera appear to jump');
assert.match(mainSource, /updateCameraFollow\(frameDt\)/, 'camera follow is applied once per rendered frame, not once per physics substep');
assert.match(mainSource, /function resetFrameTiming\(reason\)/, 'load/teleport recentering can reset animation timing');
assert.match(mainSource, /if\(frameClock\.resetFrames>0\)/, 'frame loop skips catch-up dt after a synchronous world load or recenter');
assert.match(mainSource, /const FRAME_CAP_FPS=120;/, 'game loop defaults to a 120 FPS cap');
assert.match(mainSource, /const FRAME_CAP_SMOOTH_NATIVE_MAX_FPS=180;/, 'frame pacing keeps common high-refresh monitors on native cadence');
assert.match(mainSource, /function shouldSkipFrameForCap\(ts\)/, 'game loop has a frame-cap scheduler');
assert.match(mainSource, /if\(shouldSkipFrameForCap\(ts\)\)\{ requestAnimationFrame\(loop\); return; \}/, 'frame cap skips before simulation and rendering work');
assert.match(mainSource, /nativeFps>FRAME_CAP_SMOOTH_NATIVE_MAX_FPS/, 'frame cap only skips when native refresh is too high for smooth native rendering');
assert.match(mainSource, /Math\.round\(nativeFps\/FRAME_CAP_FPS\)/, 'frame cap uses the NEAREST integer refresh divisor - ceil turned a 240Hz display into an unstable 80fps (divisor 3) under the 120 cap');
assert.match(mainSource, /frameCapCandidateStreak>=45/, 'frame cap divisor changes are debounced so EMA jitter cannot flap the cadence');
assert.match(mainSource, /frameCapPhase=\(frameCapPhase\+1\)%frameCapDivisor;/, 'frame cap skips in a stable cadence when a divisor is needed');
assert.ok(!mainSource.includes('elapsed<FRAME_CAP_MS-0.35'), 'frame cap no longer uses an uneven sub-deadline skip pattern');
assert.ok(!mainSource.includes('frameCapRafLast += FRAME_CAP_MS'), 'frame cap no longer advances a virtual 120 FPS deadline');
assert.match(mainSource, /localStorage\.setItem\(FRAME_CAP_STORAGE_KEY/, 'FPS cap menu setting is persisted');
assert.match(indexSource, /id="fpsUnlockCheckbox"/, 'menu exposes an FPS unlock checkbox');
assert.match(indexSource, /id="fpsCapLabel"/, 'menu exposes the current FPS cap state');
assert.match(indexSource, /plynny rytm ok\. 120 FPS/, 'menu explains the smooth frame pacing mode');
assert.match(mainSource, /function centerOnPlayer\(\)\{ revealAround\(\); snapCameraToPlayer\(\); initScarf\(\); resetFrameTiming\('center'\); \}/, 'centering resets frame timing after load/teleport');
assert.match(mainSource, /resetFrameCanvasState\(\);\s+const renderCam=currentRenderCamera\(\);\s+drawBackground\(\)/, 'each rendered frame resets canvas transform before parallax/background draw');
assert.ok(!mainSource.includes('drawMaterialTile(cctx,t,lx*TILE,y*TILE,h)'), 'chunk-cache rebuilds avoid expensive per-tile decoration');
assert.match(mainSource, /try \{\s+\/\/ render tiles[\s\S]*finally \{\s+ctx\.restore\(\);/, 'world transform is restored even if a draw subsystem fails');
assert.ok(!mainSource.includes('player.y += bob'), 'surface-water bob must stay visual/velocity based and not mutate hero position directly');
assert.match(mainSource, /function heroTouchesLadder\(\)[\s\S]*hasLadderAt\(x,y\)/, 'hero movement samples ladder overlays across the body');
assert.match(mainSource, /import \{ applyHorizontalMovement, applyJumpArcControl, surfaceTraction \} from '\.\/engine\/movement\.js';/, 'hero movement imports shared jump arc control');
assert.match(mainSource, /function queueJumpInput\(k\)\{[\s\S]*jumpBufferT=JUMP_BUFFER;[\s\S]*\}/, 'jump keydown and touch taps queue jump presses immediately');
assert.match(mainSource, /if\(!e\.repeat\) queueJumpInput\(k\);/, 'keyboard jump taps are buffered on keydown');
assert.match(mainSource, /btn\.addEventListener\('pointerdown'[\s\S]*queueJumpInput\(k\);/, 'touch up-button taps are buffered on pointerdown');
assert.match(mainSource, /const groundedSolidInWater = inWater && player\.onGround && groundTile!==T\.AIR && groundTile!==T\.WATER && isSolid\(groundTile\);/, 'water jump is allowed only while standing on solid ground');
assert.match(mainSource, /function heroTouchesSideBlock\(\)\{[\s\S]*const leftX=Math\.floor\(player\.x-halfW-probe\);[\s\S]*const rightX=Math\.floor\(player\.x\+halfW\+probe\);[\s\S]*solidAt\(leftX,y,'x'\) \|\| solidAt\(rightX,y,'x'\)/, 'water side jumps sample solid collision blocks just outside both sides of the hero body');
assert.match(mainSource, /const sideSolidInWater = inWater && heroTouchesSideBlock\(\);/, 'water side-wall jump support only applies while the hero is in water');
assert.match(mainSource, /const boatDeckInWater = inWater && player\.onGround && !!heroBoatNow;/, 'a live boat deck under the hero counts as water jump support');
assert.match(mainSource, /const boatContactInWater = inWater && !boatDeckInWater && BOATS && BOATS\.heroTouchingBoat && !!BOATS\.heroTouchingBoat\(player,\{floating:true\}\);/, 'touching a floating boat while swimming is recognized as a boarding contact');
assert.match(mainSource, /const waterJumpSupport = groundedSolidInWater \|\| sideSolidInWater \|\| boatDeckInWater \|\| boatContactInWater;/, 'water jump support accepts solid bottom contact, solid side contact, a boat deck, or a floating hull contact');
assert.match(mainSource, /const swimUpInput = inWater && jumpNow && !diveInput && !waterJumpSupport;/, 'jump/up input becomes a swim-up stroke only while floating in unsupported water');
assert.match(mainSource, /else if\(boatContactInWater && BOATS && BOATS\.boardHeroFromWater && BOATS\.boardHeroFromWater\(player,\{getTile\}\)\.ok\)\{[\s\S]*jumpBufferT=0; coyoteT=COYOTE_TIME; swimBuoySmooth=0;/, 'jumping while touching a floating boat boards the hero instead of treating it as open-water swimming');
assert.match(mainSource, /else if\(\(player\.onGround && \(!inWater \|\| groundedSolidInWater \|\| boatDeckInWater\)\) \|\| \(inWater && sideSolidInWater\) \|\| \(!inWater && \(godMode \|\| \(coyoteT>0 && player\.jumpCount===0\)\)\)\)/, 'ground jump path rejects free-swimming water jumps but allows boat-deck and underwater side-wall jumps');
assert.match(mainSource, /if\(swimUpInput && subFrac>0\.18\)\{[\s\S]*strokeAccel = 18/, 'open-water swim-up uses buoyancy stroke control, not a jump impulse');
assert.match(mainSource, /else if\(inWater\)\{\s*jumpBufferT=0;\s*\}/, 'open-water jump presses are consumed without spending jump charges');
assert.ok(!mainSource.includes('swimLeapT'), 'water surface leap state was removed');
assert.ok(!mainSource.includes('MOVE.JUMP * jumpMult * 0.95'), 'surface water jump impulse was removed');
assert.ok(!mainSource.includes('MOVE.JUMP * 0.32'), 'deep underwater swim-kick jump impulse was removed');
assert.match(mainSource, /const ladderContact=heroTouchesLadder\(\);[\s\S]*const jumpHeldEarly=!!keys\[' '\] \|\| \(!ladderContact && climbUpInput\);/, 'up input climbs ladders instead of becoming a jump press while on a ladder');
assert.ok(!mainSource.includes('releaseCut'), 'releasing jump does not cut upward speed into a small hop');
assert.ok(!mainSource.includes('jumpReleasedThisFrame'), 'jump release is not used for variable-height short hops');
assert.match(mainSource, /const downCancel=heroDropThroughInput\(\) && !ladderContact;/, 'pressing or tapping down in the air cancels the current jump arc');
assert.match(mainSource, /applyJumpArcControl\(player\.vy, gravForCut, \{cancel:true\}\)/, 'hero jump arc control only applies the down-cancel helper');
assert.match(mainSource, /if\(ladderContact && !ladderJumped && ladderReleaseT<=0\)\{[\s\S]*const climbDir=\(climbDownInput\?1:0\)-\(climbUpInput\?1:0\);[\s\S]*player\.vy=climbDir\*climbSpeed;[\s\S]*player\.jumpCount=0;/, 'ladder contact drives vertical climb speed and resets air jumps');
assert.match(mainSource, /ladderReleaseT=0\.2;/, 'jumping from a ladder briefly releases ladder grip');
assert.match(mainSource, /function solidAt\(x,y,axis\)\{[\s\S]*if\(hasLadderAt\(x,y\)\) return false;/, 'ladder overlays make their cells passable for hero collision');
assert.match(mainSource, /const TRAPDOOR_DROP_BUFFER=0\.22;/, 'trapdoor drop-through has a short input buffer');
assert.match(mainSource, /if\(k==='s' \|\| k==='arrowdown'\) trapdoorDropBufferT=TRAPDOOR_DROP_BUFFER;/, 'keyboard down taps buffer trapdoor drop-through');
assert.match(mainSource, /if\(code==='ArrowDown'\) trapdoorDropBufferT=TRAPDOOR_DROP_BUFFER;/, 'touch down taps buffer trapdoor drop-through');
assert.match(mainSource, /function heroDropThroughInput\(\)\{\s*return !!\(keys\['s'\] \|\| keys\['arrowdown'\] \|\| trapdoorDropBufferT>0\);\s*\}/, 'trapdoor drop-through uses buffered down input');
assert.match(mainSource, /if\(trapdoorDropBufferT>0\) trapdoorDropBufferT=Math\.max\(0,trapdoorDropBufferT-dt\);/, 'trapdoor input buffer decays in the physics step');
assert.match(mainSource, /function releaseGameplayInput\(\)\{[\s\S]*trapdoorDropBufferT=0;[\s\S]*activePointers\.clear\(\);/, 'input reset clears buffered trapdoor drops');
assert.match(mainSource, /const TURBO_SPEED_MULT=1\.5;/, 'turbo speed multiplier is 1.5x');
assert.match(mainSource, /const TURBO_JUMP_MULT=1\.5;/, 'turbo jump multiplier is 1.5x');
assert.match(mainSource, /const WATER_MOVE_SPEED_BASE=0\.5;/, 'baseline water movement is half speed');
assert.match(mainSource, /const WATER_MOVE_SPEED_MAX=1\.25;/, 'water movement supports fish-like 125% boosts');
assert.match(mainSource, /function heroWaterMoveSpeedMult\(\)[\s\S]*WATER_MOVE_SPEED_MIN[\s\S]*WATER_MOVE_SPEED_MAX/, 'water movement stat is clamped before use');
assert.match(mainSource, /function turboKeyHeld\(\)\{ return !!\(keys\['shift'\]\|\|keys\['shiftleft'\]\|\|keys\['shiftright'\]\); \}/, 'turbo listens to either Shift key');
assert.match(mainSource, /const ridingFloatingBoat = !!\(heroBoatNow && heroBoatNow\.inWater && !heroBoatNow\.grounded\);/, 'water movement drag ignores floating boats');
assert.match(mainSource, /const boatPrevX=player\.x;\s+const boatPrevY=player\.y;[\s\S]*BOATS\.collideHero\(player, dt\)[\s\S]*if\(Math\.abs\(player\.x-boatPrevX\)>1e-6\) collide\('x',boatPrevX\);[\s\S]*if\(Math\.abs\(player\.y-boatPrevY\)>1e-6\) collide\('y',boatPrevY\);/, 'boat-carried hero movement sweeps both axes through terrain');
assert.match(mainSource, /const waterMoveMult = \(inWater && !ridingFloatingBoat\) \? heroWaterMoveSpeedMult\(\) : 1;/, 'open-water movement uses the swim-speed stat');
assert.match(mainSource, /moveMult = [^;]*\* turboSpeedMult \* waterMoveMult \* heroChillMoveMult\(\) \* heroSandMoveMult\(\) \* socialBoostMult\('move'\) \* \(\(ANTENNAS&&ANTENNAS\.moveMult\)\?ANTENNAS\.moveMult\(\):1\);/, 'turbo, water, chill, sandstorm, ghost-audience and antenna-surge multipliers feed horizontal movement together');
assert.match(mainSource, /jumpMult = [^;]*\* turboJumpMult \* Math\.sqrt\(socialBoostMult\('jump'\)\);/, 'turbo jump and the ghost-audience height boost feed jump impulse');
assert.match(mainSource, /spendTurboEnergy\(dt\)/, 'turbo consumes hero energy while active');
assert.match(mainSource, /function recordTurboEnergyUse\(amount\)[\s\S]*turboEnergyHoldSpent\+=spent/, 'turbo accumulates energy use for the whole Shift hold');
assert.match(mainSource, /function reportTurboEnergyUse\(lockUntilRelease\)[\s\S]*noteHeroEnergyDelta\(-spent,\{force:true,cause:'turbo',target:'hero:energy:turbo'\}\)/, 'turbo reports one dedicated total when the hold finishes');
assert.match(mainSource, /function spendTurboEnergy\(dt\)[\s\S]*recordTurboEnergyUse\(spent\)[\s\S]*if\(player\.energy<=TURBO_MIN_ENERGY\) reportTurboEnergyUse\(true\)/, 'energy depletion immediately closes and reports the turbo session');
assert.doesNotMatch(mainSource.match(/function spendTurboEnergy\(dt\)\{[\s\S]*?\n\}/)?.[0]||'', /noteHeroEnergyDelta/, 'turbo no longer emits energy numbers every simulation pulse');
assert.match(mainSource, /window\.addEventListener\('keyup',[\s\S]*if\(!turboKeyHeld\(\)\) endTurboEnergyHold\(\)/, 'releasing the final Shift key reports the accumulated total');
assert.match(mainSource, /function releaseGameplayInput\(\)\{\s*endTurboEnergyHold\(\);/, 'blur and modal input release also close the turbo reporting session');
assert.match(mainSource, /turboRechargePauseT=Math\.max\(turboRechargePauseT,0\.18\)/, 'turbo spending briefly blocks passive recharge so cost is visible');
assert.match(mainSource, /if\(!turboRechargeBlocked && DYNAMO && typeof DYNAMO\.absorbNear==='function'/, 'passive dynamo recharge does not immediately erase turbo spending');
assert.match(mainSource, /spawnTurboSparks/, 'turbo emits electric spark feedback');
assert.match(mainSource, /const underwaterEnergyState = SURVIVAL && SURVIVAL\.createUnderwaterEnergyState/, 'hero tracks banked underwater energy shock separately from drowning');
assert.match(mainSource, /function heroWaterExposure\(\)[\s\S]*headCovered:getTile\(tileX,headTy\)===T\.WATER && subFrac>0\.88 && headY>=waterSurfaceYAt\(tileX,headTy\)/, 'water exposure sampling provides submersion and head-covered drowning state at sub-tile surface precision');
assert.match(mainSource, /function waterLevelUnitsAt\(tx,ty\)[\s\S]*WATER\.levelAt\(tx,ty,getTile\)[\s\S]*function waterSurfaceYAt\(tx,ty\)/, 'water exposure respects sub-tile water levels so thin films do not read as swimmable');
assert.match(mainSource, /function applyUnderwaterEnergyUseDamage\(energySpent\)[\s\S]*updateUnderwaterEnergyShock\(underwaterEnergyState,energySpent,submerged\)[\s\S]*cause:'underwater_energy'/, 'using hero energy while submerged routes shock damage through damageHero');
assert.match(mainSource, /function spendHeroEnergy\(amount\)[\s\S]*player\.energy=Math\.max\(0,\(player\.energy\|\|0\)-n\);[\s\S]*applyUnderwaterEnergyUseDamage\(n\);/, 'shared hero energy spending can shock the hero underwater');
assert.match(mainSource, /function spendTurboEnergy\(dt\)[\s\S]*applyUnderwaterEnergyUseDamage\(spent\);/, 'turbo energy spending can shock the hero underwater');
assert.match(mainSource, /if\(!inWater && SURVIVAL && SURVIVAL\.resetUnderwaterEnergyShock\) SURVIVAL\.resetUnderwaterEnergyShock\(underwaterEnergyState\);/, 'leaving water clears banked energy shock');
assert.match(mainSource, /if\(!inWater && SURVIVAL && SURVIVAL\.resetWaterPressure\) SURVIVAL\.resetWaterPressure\(waterPressureState\);/, 'leaving water clears banked pressure damage');

console.log('movement-sim: all assertions passed');
