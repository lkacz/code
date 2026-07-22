// Save-schema regression: resources and hotbar state must survive save/load.
// This is a light static guard because main.js is browser/DOM-bound.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const src = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const indexSrc = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const progressSrc = await readFile(new URL('../src/engine/progress.js', import.meta.url), 'utf8');
const inventorySrc = await readFile(new URL('../src/inventory.js', import.meta.url), 'utf8');
const inventoryUiSrc = await readFile(new URL('../src/inventory_ui.js', import.meta.url), 'utf8');
const chestsSrc = await readFile(new URL('../src/engine/chests.js', import.meta.url), 'utf8');
const weaponsSrc = await readFile(new URL('../src/engine/weapons.js', import.meta.url), 'utf8');
const worldSrc = await readFile(new URL('../src/engine/world.js', import.meta.url), 'utf8');

// Exercise the real codec declarations without booting the DOM-bound game.
// Randomized alternating bytes hit the worst-case RLE expansion, while the
// malformed samples pin strict length/run validation used by imported saves.
{
  const start=src.indexOf('function _b64FromBytes');
  const end=src.indexOf('function isTransientTerrainTile');
  assert.ok(start>=0 && end>start,'save codec source block is discoverable');
  const sandbox={Uint8Array,btoa,atob};
  runInNewContext(src.slice(start,end)+';globalThis.codec={encodeRLE,decodeRLE,decodeRaw};',sandbox);
  for(const n of [1,2,17,255,256,4480,8960]){
    const input=new Uint8Array(n);
    let seed=(n*2654435761)>>>0;
    for(let i=0;i<n;i++){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      input[i]=(seed>>>24)&255;
    }
    const decoded=sandbox.codec.decodeRLE(sandbox.codec.encodeRLE(input),n);
    assert.ok(decoded && decoded.length===n && decoded.every((v,i)=>v===input[i]),'RLE round-trip preserves '+n+' randomized bytes');
  }
  assert.equal(sandbox.codec.decodeRLE(btoa(String.fromCharCode(7,0)),1),null,'RLE rejects a zero-length run');
  assert.equal(sandbox.codec.decodeRLE(btoa(String.fromCharCode(7,2)),1),null,'RLE rejects a run exceeding the declared chunk');
  assert.equal(sandbox.codec.decodeRLE(btoa(String.fromCharCode(7)),1),null,'RLE rejects a truncated pair');
}

assert.match(src, /function snapshotInventory\(\)/, 'save code defines an inventory snapshot helper');
assert.match(indexSrc, /id="immunityBtn"/, 'debug HUD exposes an immunity toggle button');
assert.match(src, /let godMode=false, immunityMode=false/, 'main tracks god mode and immunity independently');
assert.match(src, /function toggleImmunity\(\)/, 'main exposes an immunity toggle');
assert.match(src, /if\(immunityMode\)\{ player\.hp=player\.maxHp; return false; \}/, 'damageHero ignores damage while immunity is enabled');
assert.match(src, /if\(immunityMode\)\{ player\.hp=player\.maxHp; return; \}/, 'heroDied refuses death while immunity is enabled');
assert.match(src, /const DEFEND_ABSORB_FRACTION=0\.25;/, 'right-click defense absorbs one quarter of blockable attacks');
assert.match(src, /function applyHeroDefense\(amount,opts,now\)\{[\s\S]*const absorbed=amount\*DEFEND_ABSORB_FRACTION;[\s\S]*amount:Math\.max\(0,amount-absorbed\)/, 'damageHero applies the defend reduction before HP loss');
assert.match(src, /const defended=applyHeroDefense\(amount,opts,now\);[\s\S]*defendedAbsorbed:defended\.absorbed/, 'damageHero records defended hits for downstream systems');
assert.match(progressSrc, /TOUGHNESS_DAMAGE_REDUCTION_PER_POINT=0\.03/, 'each Twardość point grants 3% passive defense');
assert.match(progressSrc, /TOUGHNESS_DAMAGE_REDUCTION_MAX=0\.45/, 'Twardość passive defense stays below immunity');
assert.match(inventorySrc, /damageReductionBonus:'sum'/, 'the modifier engine merges passive defense contributions');
assert.match(inventoryUiSrc, /'hard','Twardość', '\+1\.5 udźwigu \/ -3% obrażeń, maks\. 45%'/, 'the development panel explains both Twardość effects and its defense cap');
assert.match(src, /function applyHeroToughness\(amount,opts\)\{[\s\S]*heroDefenseCanAbsorb\(opts\)[\s\S]*amount:Math\.max\(0,amount-absorbed\)/, 'Twardość reduces the same blockable damage family as active defense');
assert.match(src, /const toughened=applyHeroToughness\(amount,opts\);[\s\S]*const defended=applyHeroDefense\(amount,opts,now\);/, 'passive Twardość and active defense combine before HP loss');
assert.match(src, /const dealt=toughened\.reduction>0 \? Math\.max\(0\.01,Math\.round\(amount\*100\)\/100\) : Math\.round\(amount\);/, 'Twardość keeps fractional HP damage so small bonuses are not lost to integer rounding');
assert.match(src, /function tryWeaponUltOrDefend\(player,aimX,aimY,item,pointerId,source\)\{[\s\S]*WEAPONS\.fireUlt\(player,aimX,aimY\)[\s\S]*beginHeroDefense\(pointerId\)/, 'right-click first tries the extra shot, then falls back to defense');
assert.match(src, /tryWeaponUltOrDefend\(player, aim\.x, aim\.y, it, e\.pointerId, 'mouse'\)/, 'desktop right-click uses the ult-or-defend fallback');
assert.match(src, /tryWeaponUltOrDefend\(player, aim\.x, aim\.y, it, e\.pointerId, 'touch'\)/, 'touch ult button uses the same defend fallback');
assert.match(src, /endHeroDefense\(e\.pointerId,\{cancel:false\}\)/, 'pointer release clears held defense with a short grace window');
assert.match(src, /const defendFaceT=\(\(\)=>\{[\s\S]*heroDefending\(now\)[\s\S]*heroDefendFlashUntil/, 'defense feedback is expressed through the hero face state');
assert.match(src, /function drawDefendEyeTension\(eyeY,eyeOffsetX,eyeW\)\{[\s\S]*ctx\.moveTo\(left-eyeW\*0\.75[\s\S]*ctx\.lineTo\(right\+eyeW\*0\.75/, 'defense feedback draws native eye tension instead of a separate shield marker');
assert.ok(!src.includes('ctx.ellipse(cx,cy,TILE*(0.48+0.04*pulse),TILE*(0.72+0.04*pulse)'), 'defense no longer draws the blue ellipse shield around the hero');
assert.match(src, /immunityBtn.*addEventListener\('click',toggleImmunity\)/, 'immunity button is wired to the toggle');
assert.match(src, /k==='i'&&!keysOnce\.has\('i'\)/, 'I hotkey toggles immunity');
assert.match(src, /function restoreInventory\(src\)/, 'load code defines an inventory restore helper');
assert.match(src, /function snapshotHotbar\(\)/, 'save code defines a hotbar snapshot helper');
assert.match(src, /function restoreHotbar\(src\)/, 'load code defines a hotbar restore helper');
assert.match(src, /function snapshotEquipment\(\)/, 'save code defines an equipment snapshot helper');
assert.match(src, /function restoreEquipment\(src\)/, 'load code defines an equipment restore helper');
assert.match(src, /const CRITICAL_SAVE_KEY='mm_save_critical_v1'/, 'save code has a dedicated fast critical-state recovery key');
assert.match(src, /const CRITICAL_SAVE_SCHEMA_VERSION=3/, 'critical recovery rejects capsules from the earlier unbound schema');
assert.match(src, /function criticalStateIntegritySignature\(state\)[\s\S]{0,600}savedAt:state && state\.savedAt[\s\S]{0,300}baseManifestHash:state && state\.baseManifestHash[\s\S]{0,160}baseRevision:state && state\.baseRevision/, 'critical recovery integrity covers freshness and base-manifest metadata separately from deduplication');
assert.match(src, /state\.stateHash=computeHash\(criticalStateIntegritySignature\(state\)\)/, 'critical recovery signs metadata and payload together');
assert.match(src, /state\.v!==CRITICAL_SAVE_SCHEMA_VERSION[\s\S]{0,420}computeHash\(criticalStateIntegritySignature\(state\)\)!==state\.stateHash/, 'legacy or metadata-tampered critical capsules are rejected before freshness comparison');
assert.match(src, /function snapshotPlayerState\(\)[\s\S]*hp:saveNumber\(player\.hp,2\)[\s\S]*energy:saveNumber\(player\.energy,2\)/, 'player snapshot persists health and energy in one shared helper');
assert.match(src, /function restorePlayerHealth\(src\)/, 'load code restores saved hero health after max-HP progression is applied');
assert.match(src, /function snapshotCriticalState\(reason\)[\s\S]*player:snapshotPlayerState\(\)[\s\S]*inv:snapshotInventory\(\)[\s\S]*hotbar:snapshotHotbar\(\)[\s\S]*equipment:snapshotEquipment\(\)/, 'critical recovery snapshot includes player state, inventory, hotbar, and gear');
assert.match(src, /function loadCriticalStateForSave\(data,opts\)[\s\S]*opts\.ignoreCritical[\s\S]*state\.baseManifestHash\.toLowerCase\(\)!==saveManifestHash[\s\S]*state\.revision!==state\.baseRevision[\s\S]*criticalTime>saveTime/, 'critical recovery must be newer, tied to the exact main manifest, and free of unsaved world changes');
assert.match(src, /const criticalState=loadCriticalStateForSave\(data,opts\)/, 'load path checks for a newer critical recovery capsule');
assert.match(src, /const criticalApplied=restoreCriticalState\(criticalState\)/, 'load path overlays a valid critical recovery capsule after the main save');
assert.match(src, /setInterval\(\(\)=>\{ saveCriticalState\('heartbeat'\); \},CRITICAL_SAVE_INTERVAL_MS\)/, 'critical recovery state is refreshed by a cheap heartbeat');
assert.match(src, /function saveState\(\)\{[\s\S]*saveCriticalState\('dirty'\)/, 'dirty save scheduling also refreshes the critical recovery state');
assert.match(src, /saveCriticalState\('flush',true\)/, 'pagehide and unload force-write critical recovery before heavy serialization');
assert.match(src, /localStorage\.setItem\(SAVE_KEY,json\);\s*rememberCommittedSave\(withHash,snapshotRevision\)/, 'full saves advance the critical-state base only after the main manifest write succeeds');
assert.match(src, /function finishIncrementalAutoSave\(\)[\s\S]{0,420}!incrementalAutoSaveJobIsCurrent\(job\)/, 'incremental saves refuse to publish a stale multi-batch snapshot');
assert.match(src, /job\.versions\.set\(ref\.key,worldChunkVersion\(ref\)\)/, 'incremental jobs remember the exact version of every encoded chunk');
assert.match(src, /function finishIncrementalAutoSave\(\)[\s\S]*cleanupAutosaveChunks\(referencedAutosaveKeys\(\),job\.oldRefs\)/, 'incremental cleanup preserves blobs still reachable from named or fork slots');
assert.match(src, /function flushPendingSave\(\)[\s\S]{0,600}cancelPendingSaveWork\(\);[\s\S]{0,180}saveCriticalState\('flush',true\)/, 'flush cleans unpublished chunk blobs before writing a synchronous replacement');
assert.match(src, /loadSaveCandidate\(raw,\{ignoreCritical:true,transactional:true,persistAsMain:true\}\)/, 'named save-slot loads validate and apply transactionally without newer critical recovery data');
assert.match(src, /function portableSaveJson\(raw,storage\)[\s\S]*portable\.world=\{modified\}[\s\S]*attachHash\(portable\)/, 'exports materialize external autosave chunks into a self-contained rehashed manifest');
assert.match(src, /const portable=portableSaveJson\(raw,localStorage\); const blob=new Blob\(\[portable\]/, 'save-slot export always downloads the portable manifest');
assert.match(src, /infrastructure:\s*timedSavePart\('infrastructure',[^\n]*WORLD && WORLD\.snapshotInfrastructure/, 'save payload includes pipe and cable overlays');
assert.match(src, /background:\s*timedSavePart\('background',[^\n]*BACKGROUND && BACKGROUND\.snapshot/, 'save payload includes day-night background state');
assert.match(src, /constructionBackground:\s*timedSavePart\('constructionBackground',[^\n]*WORLD && WORLD\.snapshotConstructionBackground/, 'save payload includes background construction support tiles');
assert.match(src, /gases:\s*timedSavePart\('gases',[^\n]*GASES && GASES\.snapshot/, 'save payload includes active gas state');
assert.match(src, /smoke:\s*timedSavePart\('smoke',[^\n]*SMOKE && SMOKE\.snapshot/, 'save payload includes the independent black-smoke density layer');
assert.match(src, /fire:\s*timedSavePart\('fire',[^\n]*FIRE && FIRE\.snapshot/, 'save payload includes active burning fire state');
assert.match(src, /boats:\s*timedSavePart\('boats',[^\n]*BOATS && BOATS\.snapshot/, 'save payload includes floating wooden rafts');
assert.match(src, /BOATS && BOATS\.restore\) return BOATS\.restore\(data\.boats\)/, 'load code propagates floating-raft restore rejection');
assert.match(src, /wind:\s*timedSavePart\('wind',[^\n]*WIND && WIND\.snapshot/, 'save payload includes weather wind state');
assert.match(src, /seasons:\s*timedSavePart\('seasons',[^\n]*SEASONS && SEASONS\.snapshot/, 'save payload includes season clock state');
assert.match(src, /clouds:\s*timedSavePart\('clouds',[^\n]*CLOUDS && CLOUDS\.snapshot/, 'save payload includes cloud and storm weather state');
assert.match(src, /dynamo:\s*timedSavePart\('dynamo',[^\n]*DYNAMO && DYNAMO\.snapshot/, 'save payload includes dynamo machine state');
assert.match(src, /solar:\s*timedSavePart\('solar',[^\n]*SOLAR && SOLAR\.snapshot/, 'save payload includes solar panel battery state');
assert.match(src, /furnishingsPower:\s*timedSavePart\('furnishingsPower',[^\n]*FURNISHINGS && FURNISHINGS\.snapshotPower/, 'save payload includes remote household electrical loads');
assert.match(src, /FURNISHINGS && FURNISHINGS\.restorePower\) return FURNISHINGS\.restorePower\(data\.furnishingsPower,getTile\)/, 'load path propagates remote household restore rejection');
assert.match(src, /teleporters:\s*timedSavePart\('teleporters',[^\n]*TELEPORTERS && TELEPORTERS\.snapshot/, 'save payload includes teleporter machine state');
assert.match(src, /pumps:\s*timedSavePart\('pumps',[^\n]*PUMPS && PUMPS\.snapshot/, 'save payload includes water pump machine state');
assert.match(src, /turrets:\s*timedSavePart\('turrets',[^\n]*TURRETS && TURRETS\.snapshot/, 'save payload includes turret battery state');
assert.match(src, /springPlatforms:\s*timedSavePart\('springPlatforms',[^\n]*SPRING_PLATFORMS && SPRING_PLATFORMS\.snapshot/, 'save payload includes spring platform battery state');
assert.match(src, /vending:\s*timedSavePart\('vending',[^\n]*VENDING && VENDING\.snapshot/, 'save payload includes vending machine stock state');
assert.match(src, /volcano:\s*timedSavePart\('volcano',[^\n]*VOLCANO && VOLCANO\.snapshot/, 'save payload includes volcano story-item and hazard state');
assert.match(src, /atomicWinter:\s*timedSavePart\('atomicWinter',[^\n]*ATOMIC_WINTER && ATOMIC_WINTER\.snapshot/, 'save payload includes atomic winter fallout state');
assert.match(src, /guardians:\s*timedSavePart\('guardians',[^\n]*GUARDIANS && GUARDIANS\.snapshot/, 'save payload includes elemental guardian state');
assert.match(src, /undergroundBoss:\s*timedSavePart\('undergroundBoss',[^\n]*UNDERGROUND && UNDERGROUND\.snapshot/, 'save payload includes underground boss state');
assert.match(src, /skyGuardian:\s*timedSavePart\('skyGuardian',[^\n]*SKY_GUARDIAN && SKY_GUARDIAN\.snapshot/, 'save payload includes Sky Gate guardian state');
assert.match(src, /guardianAftermath:\s*timedSavePart\('guardianAftermath',[^\n]*AFTERMATH && AFTERMATH\.snapshot/, 'save payload includes lingering guardian aftermath state');
assert.match(src, /meteorites:\s*timedSavePart\('meteorites',[^\n]*METEORITES && METEORITES\.snapshot/, 'save payload includes meteorite schedule state');
assert.match(src, /mobs:\s*timedSavePart\('mobs',[^\n]*MOBS && MOBS\.serialize/, 'save payload includes live mob ecology state');
assert.match(src, /generatedNpcs:\s*timedSavePart\('generatedNpcs',[^\n]*GENERATED_NPCS && GENERATED_NPCS\.snapshot/, 'save payload includes generated NPC discovery state');
assert.match(src, /npcs:\s*timedSavePart\('npcs',[^\n]*NPCS && NPCS\.snapshot/, 'save payload includes registered NPC system state');
assert.match(src, /tutorialNpc:\s*timedSavePart\('tutorialNpc',[^\n]*TUTORIAL_NPC && TUTORIAL_NPC\.snapshot/, 'save payload includes tutorial mentor quest state');
assert.match(src, /ufo:\s*timedSavePart\('ufo',[^\n]*UFO && UFO\.snapshot/, 'save payload includes UFO visitor schedule state');
assert.match(src, /tasks:\s*timedSavePart\('tasks',[^\n]*TASKS && TASKS\.snapshot/, 'save payload includes active and completed task tracker state');
assert.match(src, /invasions:\s*timedSavePart\('invasions',[^\n]*INVASIONS && INVASIONS\.snapshot/, 'save payload includes active invasion teams and theft caches');
assert.match(src, /progress:\s*timedSavePart\('progress',[^\n]*PROGRESS && PROGRESS\.snapshot/, 'save payload includes trained progression state');
assert.match(src, /plants:\s*timedSavePart\('plants',[^\n]*PLANTS && PLANTS\.snapshot/, 'save payload includes living plant state');
assert.match(src, /inv:\s*timedSavePart\('inventory',[^\n]*snapshotInventory\(\)/, 'save payload includes resource inventory');
assert.match(src, /hotbar:\s*timedSavePart\('hotbar',[^\n]*snapshotHotbar\(\)/, 'save payload includes hotbar state');
assert.match(src, /equipment:\s*timedSavePart\('equipment',[^\n]*snapshotEquipment\(\)/, 'save payload includes equipped gear and outfit');
assert.match(src, /tool:\s*player\.tool/, 'save payload includes the active pickaxe');
assert.match(src, /player:\s*snapshotPlayerState\(\)/, 'save payload includes shared player vitals and position');
assert.match(src, /restoreInventory\(data\.inv\)/, 'load path restores resource inventory');
assert.match(src, /restoreHotbar\(data\.hotbar/, 'load path restores hotbar state');
assert.match(src, /restoreEquipment\(data\.equipment\)/, 'load path restores equipped gear and outfit');
assert.match(src, /WORLD\.restoreInfrastructure\(data\.infrastructure\)/, 'load path restores pipe and cable overlays after terrain');
assert.match(src, /WORLD\.restoreConstructionBackground\(data\.constructionBackground\)/, 'load path restores background construction support tiles after terrain');
assert.match(src, /BACKGROUND\.restore\(data\.background\)/, 'load path restores day-night background state');
assert.match(src, /GASES\.restore\(data\.gases,getTile,setTile\)/, 'load path restores active gas state through transient world writes');
assert.match(src, /SMOKE\.restore\(data\.smoke,getTile\)/, 'load path restores physical black smoke without replacing terrain gases');
assert.match(src, /function smokeDynamicOpenAt\(x,y,t\)\{[\s\S]*isDoorTile\(t\)[\s\S]*isTrapdoorTile\(t\)/, 'smoke has a shared resolver for actor-opened doors and trapdoors');
assert.match(src, /SMOKE\.update\(dt, getTile, smokeDynamicOpenAt\)/, 'main simulation lets smoke pass currently open doorway tiles');
assert.match(worldSrc, /MM\.smoke && MM\.smoke\.onTileChanged[^\n]*onTileChanged\(x,y,old,v,getTile\)/, 'world changes synchronously displace black smoke from newly blocked cells');
assert.match(src, /const restoredBaseChunks=baseChunkIdsForAudits\(restoredChunks\)/, 'load path narrows mixed vertical-section refs to legacy base chunks for old auditors');
assert.match(src, /GASES\.auditChunks\(restoredBaseChunks,getTile\)/, 'load path re-audits saved gas tiles from base chunks');
assert.match(src, /FIRE\.restore\(data\.fire,getTile\)/, 'load path restores active burning fire after terrain');
assert.match(src, /WIND\.restore\(data\.wind\)/, 'load path restores weather wind state');
assert.match(src, /SEASONS\.restore\(data\.seasons\)/, 'load path restores season clock state');
assert.match(src, /CLOUDS\.restore\(data\.clouds\)/, 'load path restores cloud and storm weather state');
assert.match(src, /DYNAMO\.restore\(data\.dynamo,getTile\)/, 'load path restores dynamo machine state after terrain');
assert.match(src, /SOLAR\.restore\(data\.solar,getTile\)/, 'load path restores solar panel battery state after terrain');
assert.match(src, /TELEPORTERS\.restore\(data\.teleporters,getTile\)/, 'load path restores teleporter batteries after terrain');
assert.match(src, /PUMPS\.restore\(data\.pumps,getTile\)/, 'load path restores water pump batteries after terrain');
assert.match(src, /TURRETS\.restore\(data\.turrets,getTile\)/, 'load path restores turret batteries after terrain');
assert.match(src, /SPRING_PLATFORMS\.restore\(data\.springPlatforms,getTile\)/, 'load path restores spring platform batteries after terrain');
assert.match(src, /VENDING\.restore\(data\.vending,getTile\)/, 'load path restores vending machine stock after terrain');
assert.match(src, /VOLCANO\.restore\(data\.volcano,getTile\)/, 'load path restores volcano story-item timers after terrain');
assert.match(src, /ATOMIC_WINTER\.restore\(data\.atomicWinter\)/, 'load path restores atomic winter fallout after terrain and weather');
assert.match(src, /GUARDIANS\.restore\(data\.guardians\)/, 'load path restores guardian progression runtime state');
assert.match(src, /UNDERGROUND\.restore\(data\.undergroundBoss\)/, 'load path restores underground boss runtime state');
assert.match(src, /SKY_GUARDIAN\.restore\(data\.skyGuardian\)/, 'load path restores Sky Gate guardian runtime state');
assert.match(src, /AFTERMATH\.restore\(data\.guardianAftermath\)/, 'load path restores lingering guardian aftermath runtime state');
assert.match(src, /METEORITES\.restore\(data\.meteorites\)/, 'load path restores meteorite schedule state');
assert.match(src, /MOBS\.deserialize\(data\.mobs\)/, 'load path restores live mob ecology after terrain');
assert.match(src, /GENERATED_NPCS\.restore\(data\.generatedNpcs\)/, 'load path restores generated NPC discovery metadata before the NPC registry');
assert.match(src, /NPCS\.restore\(data\.npcs\)/, 'load path restores the registered NPC system state');
assert.match(src, /TUTORIAL_NPC\.restore\(data\.tutorialNpc\)/, 'load path restores tutorial mentor quest state');
assert.match(src, /TUTORIAL_NPC\.placeNearWorldStart\(getTile,WORLDGEN\)/, 'old saves place the tutorial mentor near the world start');
assert.match(src, /const tutorialNpcCtx = \{[\s\S]*?player,[\s\S]*?damageHero:window\.damageHero,[\s\S]*?onInventoryChange:updateInventory,[\s\S]*?onChange:saveState,[\s\S]*?worldGen:WORLDGEN,[\s\S]*?gameDayFloat:\(\)=>\{[^}]+SEASONS && SEASONS\.metrics[^}]+\}[\s\S]*?\};\s*if\(NPCS && NPCS\.setContext\) NPCS\.setContext\(tutorialNpcCtx\);/, 'main registers one shared NPC context for positioned quest rewards, saves, HUD refreshes, hero damage, and in-game day scheduling');
assert.match(src, /backgroundAt:getConstructionBackgroundTile/, 'the shared NPC context exposes real construction backgrounds to the house mentor');
assert.match(src, /isBurning:\(x,y\)=>!!\(FIRE && FIRE\.isBurning/, 'the shared NPC context exposes real fire state to mentor validation');
assert.match(src, /isFurnishingPowered:\(x,y\)=>furnishingPoweredAt\(x,y\)/, 'the shared NPC context exposes furnishing power to the house validator');
assert.match(src, /NPCS\.handleKey\(e\.key,player,tutorialNpcCtx\)/, 'NPC reward-choice keys are handled before weapon shortcuts through the shared quest context');
assert.match(src, /function selectWeaponKey\(key\)\{\s*if\(NPCS && NPCS\.handleKey && NPCS\.handleKey\(key,player,tutorialNpcCtx\)\) return;/, 'on-screen weapon buttons can also answer NPC reward choices through the shared quest context');
assert.match(src, /NPCS\.attackAt\(tx,ty,atkBonus,tutorialNpcCtx\)/, 'direct melee attacks pass the shared NPC quest context');
assert.match(src, /GENERATED_NPCS\.update\(dt, player, getTile, setTile, tutorialNpcCtx\)/, 'generated NPC discovery runs before registered NPC simulation');
assert.match(src, /GENERATED_NPCS\.draw\(ctx,TILE,worldFxVisible,getTile,WORLDGEN,sx,sy,viewX,viewY\)/, 'generated NPC homes are drawn with viewport bounds before NPC actors');
assert.match(src, /NPCS\.update\(dt, player, getTile, setTile, tutorialNpcCtx\)/, 'NPC update uses the same shared quest context as damage and input paths');
assert.match(src, /UFO\.restore\(data\.ufo\)/, 'load path restores UFO visitor schedule');
assert.match(src, /TASKS\.restore\(data\.tasks\)/, 'load path restores task tracker state before source systems resync their tasks');
assert.match(src, /INVASIONS\.restore\(data\.invasions,getTile,setTile\)/, 'load path restores invasion teams and hidden theft caches');
assert.match(src, /PROGRESS\.restore\(data\.progress\)/, 'load path restores trained progression state');
assert.match(src, /PLANTS\.restore\(data\.plants\)/, 'load path restores living plant state');
assert.match(src, /import \{ guardianLairs as GUARDIANS \} from '\.\/engine\/guardian_lairs\.js';/, 'main imports the elemental guardian engine');
assert.match(src, /import \{ undergroundBoss as UNDERGROUND \} from '\.\/engine\/underground_boss\.js';/, 'main imports the underground boss engine');
assert.match(src, /import \{ skyGuardian as SKY_GUARDIAN \} from '\.\/engine\/sky_guardian\.js';/, 'main imports the Sky Gate guardian engine');
assert.match(src, /import \{ guardianAftermath as AFTERMATH \} from '\.\/engine\/guardian_aftermath\.js';/, 'main imports the lingering guardian aftermath engine');
assert.match(src, /import \{ tasks as TASKS \} from '\.\/engine\/tasks\.js';/, 'main imports the task tracker');
assert.match(src, /import \{ invasions as INVASIONS \} from '\.\/engine\/invasions\.js';/, 'main imports the nightly invasion engine');
assert.match(src, /GUARDIANS && GUARDIANS\.update/, 'main update loop advances elemental guardians');
assert.match(src, /UNDERGROUND && UNDERGROUND\.update/, 'main update loop advances the underground boss');
assert.match(src, /SKY_GUARDIAN && SKY_GUARDIAN\.update/, 'main update loop advances the Sky Gate guardian');
assert.match(src, /AFTERMATH && AFTERMATH\.update/, 'main update loop advances guardian aftermath consequences');
assert.match(src, /INVASIONS && INVASIONS\.update/, 'main update loop advances nightly invasions');
assert.match(src, /GUARDIANS && GUARDIANS\.draw/, 'main draw loop renders elemental guardians');
assert.match(src, /UNDERGROUND && UNDERGROUND\.draw/, 'main draw loop renders the underground boss');
assert.match(src, /SKY_GUARDIAN && SKY_GUARDIAN\.draw/, 'main draw loop renders the Sky Gate guardian');
assert.match(src, /AFTERMATH && AFTERMATH\.draw/, 'main draw loop renders guardian aftermath consequences');
assert.match(src, /INVASIONS && INVASIONS\.draw/, 'main draw loop renders nightly invasions');
assert.match(src, /TASKS\.drawHUD\(ctx,W,H,camRenderX,camRenderY,zoom,TILE,worldFxVisible,player\)/, 'main draws the task pointer with the shared red-arrow HUD');
assert.match(src, /if\(!taskPointerDrawn && BOSSES && BOSSES\.drawHUD\)/, 'boss red arrow yields to active off-screen task targets');
assert.match(src, /GUARDIANS && GUARDIANS\.attackAt/, 'melee attacks can hit elemental guardians');
assert.match(src, /UNDERGROUND && UNDERGROUND\.attackAt/, 'melee attacks can hit the underground boss');
assert.match(src, /SKY_GUARDIAN && SKY_GUARDIAN\.attackAt/, 'melee attacks can hit the Sky Gate guardian');
assert.match(src, /INVASIONS && INVASIONS\.attackAt/, 'melee attacks can hit invasion aliens');
assert.match(src, /cause==='alien_invasion'[\s\S]*INVASIONS\.onHeroKilled/, 'alien-caused deaths use the invasion theft-cache rule before normal gravestones');
assert.match(progressSrc, /trophies:cleanTrophies\(state\.trophies\)/, 'progress snapshots include seasonal trophy history');
assert.match(progressSrc, /state\.trophies=cleanTrophies\(d\.trophies\)/, 'progress restore keeps seasonal trophy history');
assert.match(progressSrc, /guardians:cleanGuardians\(state\.guardians\)/, 'progress snapshots include guardian heart history');
assert.match(progressSrc, /state\.guardians=cleanGuardians\(d\.guardians\)/, 'progress restore keeps guardian heart history');
assert.match(progressSrc, /GUARDIAN_KEYS=\[[^\]]*'earth'[^\]]*\]/, 'progress guardian heart history includes earth');
assert.match(progressSrc, /GUARDIAN_KEYS=\[[^\]]*'air'[^\]]*\]/, 'progress guardian heart history includes air');
assert.match(progressSrc, /function markGuardianHeart\(kind\)/, 'progress exposes one-time guardian heart marking');
assert.match(inventorySrc, /key:'heartFire'/, 'inventory resources include the Heart of Fire');
assert.match(inventorySrc, /key:'heartIce'/, 'inventory resources include the Heart of Ice');
assert.match(inventorySrc, /key:'heartEarth'/, 'inventory resources include the Heart of Earth');
assert.match(inventorySrc, /key:'heartAir'/, 'inventory resources include the Heart of Air');
assert.match(src, /restorePlayerState\(data\.player\)/, 'load path restores stored hero position, XP, facing, and energy');
assert.match(src, /restorePlayerHealth\(data\.player\)/, 'load path restores stored hero health');
assert.match(src, /function chunkForTerrainSave\(arr\)/, 'save path strips transient world layers from terrain chunks');
assert.match(src, /function stripTransientTerrainTiles\(arr\)/, 'load path sanitizes transient world layers from saved chunks');
assert.match(src, /function migrateLegacyInfrastructureTerrain\(cx,arr\)/, 'load path migrates legacy pipe and cable terrain into overlays');
assert.match(src, /function restoreTerrainChunk\(cx,arr\)/, 'chunk restore uses one shared terrain cleanup helper');
assert.match(src, /const SAVE_CHUNK_RESTORE_CAP=4096;/, 'save restore caps the number of chunk records processed from untrusted data');
assert.match(src, /function validSavedChunkRef\(cx,sy\)/, 'chunk restore validates coordinates and vertical section bounds before decoding');
assert.match(src, /function decodeSavedChunk\(data,rle,size\)/, 'chunk restore validates encoded and decoded payload sizes');
assert.match(src, /if\(!\(arr instanceof Uint8Array\) \|\| arr\.length!==expected\) return;/, 'terrain restore rejects malformed chunk array dimensions');
assert.match(src, /assertSaveChunkCapacity\(list,'inline restore'\);\s*for\(const ch of list\)/, 'inline chunk restore rejects over-cap data instead of truncating it');
assert.match(src, /assertSaveChunkCapacity\(refs,'referenced restore'\);\s*for\(const saved of refs\)/, 'referenced chunk restore rejects over-cap data instead of truncating it');
assert.match(src, /f\.size>IMPORT_SAVE_BYTE_CAP/, 'save-file import rejects oversized payloads before FileReader allocation');
assert.match(src, /SAVE_SUPPORTED_VERSIONS=Object\.freeze\(\[6,7\]\)/, 'runtime load has an explicit supported-version set');
assert.match(src, /!Number\.isInteger\(version\) \|\| !SAVE_SUPPORTED_VERSIONS\.includes\(version\)/, 'runtime preflight rejects non-integral and unsupported save versions');
assert.match(src, /typeof input\.seed!=='number' \|\| normalizeWorldSeed\(input\.seed\)===null/, 'runtime preflight requires a canonical numeric world seed');
assert.match(src, /stripTransientTerrainTiles\(arr\);\s*migrateLegacyInfrastructureTerrain\(cx,arr,ref\.base\?null:ref\.sy\);/, 'terrain restore strips transient tiles before migrating legacy base infrastructure overlays');
assert.match(src, /const auditChunkIds=baseChunkIdsForAudits\(saveChunkIds\)/, 'full save filters vertical-section refs before legacy chunk auditors run');
assert.match(src, /timedSavePart\('falling\.audit',[^\n]*FALLING\.auditChunks\(auditChunkIds,\{force:true,immediate:true\}\)/, 'full save audits base modified chunks through falling physics before settling terrain');
assert.match(src, /timedSavePart\('falling\.settle',[^\n]*FALLING\.settleAll\(\)/, 'full save settles queued falling physics before chunk serialization');
assert.match(src, /FALLING\.auditChunks\(\[cx\],\{force:true,immediate:true\}\)/, 'incremental autosave audits each chunk through falling physics before writing its blob');
assert.match(src, /encodeRLE\(chunkForTerrainSave\(arr\)\)/, 'full and incremental chunk saves encode sanitized terrain chunks');
assert.match(src, /restoreTerrainChunk\(ch\.cx,arr\)/, 'inline modified chunk restore removes transient and legacy overlay tiles from terrain');
assert.match(src, /restoreTerrainChunk\((?:ref|saved)\.cx,arr\)/, 'referenced autosave restore removes transient and legacy overlay tiles from terrain');
assert.match(src, /updateInventory\(\{noSave:true,noCraftNotify:true\}\)/, 'load path refreshes inventory UI without dirtying the save or replaying craft notifications');
assert.match(src, /refreshHotbarDom\(\)/, 'load path refreshes visible hotbar labels');
assert.match(src, /updateHotbarSel\(\)/, 'load path refreshes visible hotbar selection');
assert.match(src, /function updateInventory\(opts\)/, 'inventory refresh accepts options');
assert.match(src, /if\(!opts\.noSave\) saveState\(\)/, 'inventory refresh can suppress save scheduling');
assert.match(src, /function recordSaveFailure\(e,manual\)/, 'autosave records and backs off after storage failures');
assert.match(src, /function timedSavePart\(label,fn,perf\)/, 'save path has per-subsystem timing instrumentation');
assert.match(src, /window\.__lastSavePerfParts=parts/, 'save path publishes slowest save subsystems for the debug HUD');
assert.match(src, /saveParts=Array\.isArray\(window\.__lastSavePerfParts\)/, 'debug HUD reports slow save subsystems');
assert.match(src, /buildSaveObject\(\{lightweight:true, chunkRefs:job\.refs, auditChunkIds:\[\], perf\}\)/, 'incremental autosave measures lightweight metadata snapshots');
assert.match(src, /job\.encodeMs \+=/, 'incremental autosave tracks chunk encoding time');
assert.match(src, /job\.chunkWriteMs \+=/, 'incremental autosave tracks chunk storage write time');
assert.match(src, /autosaveChunkKey\(cx,job\.id\)/, 'autosave writes unique per-job chunk blobs');
assert.match(src, /cleanupAutosaveChunks\(new Set\(\),job\.refs\)/, 'failed autosave batches clean uncommitted blobs');
assert.match(src, /id:'coal_torches'/, 'crafting exposes a coal-assisted torch recipe');
assert.match(src, /cost:\{wood:1,\s*coal:1\}/, 'coal torch recipe consumes wood and coal');
assert.match(src, /inv\.torch\+=8/, 'coal torch recipe yields the larger torch batch');
assert.match(src, /tools=\{basic:1,stone:2,meteor:3\.3,diamond:4,bedrock:2\.6\}/, 'tool speed table includes meteoric and bedrock pickaxe tiers');
assert.match(src, /BEDROCK_PICK_MAX_DURABILITY=10/, 'bedrock pickaxe has the requested ten-use fragility limit');
assert.match(src, /function isOceanBasinBedrockAt\(tx,ty,t\)\{[\s\S]*WORLDGEN\.oceanSealTop/, 'ocean basin bedrock is detected by column seal metadata');
assert.match(src, /function canMineBedrockWithCurrentTool\(t,tx,ty\)\{[\s\S]*!isOceanBasinBedrockAt\(tx,ty,t\)/, 'bedrock mining is gated to the active mother pickaxe and excludes ocean basin jackets');
assert.match(src, /function canMineTileWithCurrentTool\(t,tx,ty\)\{ return !isUnmineableTile\(t\) \|\| canMineBedrockWithCurrentTool\(t,tx,ty\); \}/, 'mining centralizes unmineable tile checks with coordinate-aware bedrock-pick exceptions');
assert.match(src, /if\(!canMineTileWithCurrentTool\(t,tx,ty\)\)\{ if\(!quiet\) msg\(unmineableReason\(t,tx,ty\)\); return false; \}/, 'cursor mining rejects unmineable tiles before timers start');
assert.match(src, /if\(t===T\.AIR \|\| !canMineTileWithCurrentTool\(t,mineTx,mineTy\)\)/, 'instant break cannot bypass unmineable tiles');
assert.match(src, /if\(info\.unmineable && !canMineBedrockWithCurrentTool\(tId,mineTx,mineTy\)\) return false;/, 'breakMinedTile refuses unmineable terrain except the coordinate-aware bedrock pickaxe path');
assert.match(src, /tools:\{stone:!!inv\.tools\.stone,\s*meteor:!!inv\.tools\.meteor,\s*diamond:!!inv\.tools\.diamond,\s*bedrock:!!inv\.tools\.bedrock,\s*bedrockDurability:bedrockPickDurability\(\)\}/, 'inventory snapshot persists the meteoric and bedrock pickaxes');
assert.match(src, /inv\.tools\.stone=false;\s*inv\.tools\.meteor=false;\s*inv\.tools\.diamond=false;\s*inv\.tools\.bedrock=false;\s*inv\.bedrockPickDurability=0/, 'inventory restore clears the bedrock pickaxe before loading');
assert.match(src, /inv\.tools\.meteor=!!src\.tools\.meteor/, 'inventory restore loads the meteoric pickaxe flag');
assert.match(src, /inv\.tools\.bedrock=!!src\.tools\.bedrock/, 'inventory restore loads the bedrock pickaxe flag');
assert.match(src, /PICK_ORDER=\['basic','stone','meteor','diamond','bedrock'\]/, 'pickaxe cycling includes the bedrock pickaxe after diamond');
assert.match(inventoryUiSrc, /inv\.tools && inv\.tools\.bedrock && bedrockDur>0\?\['macierzysty '\+bedrockDur\+'\/10'\]:\[\]/, 'resource panel lists the bedrock pickaxe with durability when owned');
assert.match(src, /id:'pick_meteoric_iron'/, 'crafting exposes a meteoric iron pickaxe recipe');
assert.match(src, /cost:\{meteoricIron:5,\s*coal:2\}/, 'meteoric pickaxe recipe consumes meteor material');
assert.match(src, /id:'pick_bedrock'/, 'crafting exposes a bedrock pickaxe recipe');
assert.match(src, /cost:\{motherIce:1,\s*motherLava:1,\s*diamond:1\}/, 'bedrock pickaxe recipe consumes guardian core materials plus diamond');
assert.match(src, /consumeBedrockPickUse\(\)/, 'bedrock mining consumes fragile pickaxe durability');
assert.match(src, /id:'bedrock_ladders'[^\n]*cost:\{bedrock:1\}/, 'bedrock ladder recipe consumes the newly mined bedrock resource');
assert.match(src, /oneEndSupport:id===T\.BEDROCK_LADDER/, 'save-stable bedrock ladder tile receives one-end support semantics');
assert.match(src, /id:'arrows_wood_small'/, 'crafting exposes a small wooden arrow recipe');
assert.match(src, /cost:\{wood:1\}/, 'small wooden arrow recipe consumes one wood block');
assert.match(src, /inv\.arrowWood\+=10/, 'small wooden arrow recipe yields ten arrows');
assert.match(src, /id:'arrows_wood_bulk'/, 'crafting exposes bulk wooden arrows');
assert.match(src, /id:'arrows_stone_bulk'/, 'crafting exposes stone-tipped arrows');
assert.match(src, /id:'arrows_obsidian_bulk'/, 'crafting exposes obsidian-tipped arrows');
assert.match(src, /id:'arrows_diamond_bulk'/, 'crafting exposes diamond-tipped arrows');
assert.match(src, /id:'arrows_iridium_bulk'/, 'crafting exposes iridium-tipped arrows');
assert.match(src, /cost:\{wood:10,\s*iridium:1\}/, 'iridium arrow recipe consumes wood plus meteorite iridium');
assert.match(src, /inv\.arrowIridium\+=100/, 'bulk iridium arrow recipe yields one hundred arrows');
assert.match(src, /keyMap=\{cape:'capes', eyes:'eyes', outfit:'outfits', weapon:'weapons', charm:'charms'\}/, 'crafted gear routes to the correct inventory collection by kind');
assert.match(src, /id:'spring_antler_charm'/, 'crafting exposes a spring trophy recipe');
assert.match(src, /cost:\{springAntler:1,\s*leaf:6,\s*wood:2\}/, 'spring trophy recipe consumes the stag antler');
assert.match(src, /id:'summer_horn_charm'/, 'crafting exposes a summer trophy recipe');
assert.match(src, /cost:\{summerHorn:1,\s*grass:8,\s*copper:1\}/, 'summer trophy recipe consumes the bison horn');
assert.match(src, /id:'autumn_heartwood_bow'/, 'crafting exposes an autumn trophy weapon recipe');
assert.match(src, /cost:\{autumnHeartwood:1,\s*wood:4,\s*leaf:4,\s*copperWire:1\}/, 'autumn trophy recipe consumes heartwood and cable');
assert.match(src, /id:'winter_fur_cape'/, 'crafting exposes a winter trophy cape recipe');
assert.match(src, /cost:\{winterFur:1,\s*snow:8,\s*leaf:2\}/, 'winter trophy recipe consumes winter fur');
assert.match(src, /id:'copper_wire'/, 'crafting exposes copper power cable');
assert.match(src, /id:'water_pipe'/, 'crafting exposes water pipes');
assert.match(src, /id:'water_pump'/, 'crafting exposes water pumps');
assert.match(src, /id:'glass_from_sand'/, 'crafting exposes sand-to-glass processing');
assert.match(src, /cost:\{sand:2,\s*coal:1\}/, 'glass processing consumes sand and coal');
assert.match(src, /id:'bricks_from_clay'/, 'crafting exposes clay-to-brick processing');
assert.match(src, /cost:\{clay:3,\s*coal:1\}/, 'brick processing consumes clay and coal');
assert.match(src, /inv\.brick\+=3/, 'brick processing yields brick blocks');
assert.match(src, /id:'steel_from_meteoric_iron'/, 'crafting exposes meteoric iron steelmaking');
assert.match(src, /cost:\{meteoricIron:2,\s*coal:1\}/, 'steel processing consumes meteoric iron and coal');
assert.match(src, /id:'transistor_basic'/, 'crafting exposes a basic electronics recipe');
assert.match(src, /id:'vending_machine'/, 'crafting exposes placeable vending machines');
assert.match(src, /id:'teleporter'/, 'crafting exposes teleporters');
assert.match(src, /id:'turret'/, 'crafting exposes basic turrets');
assert.match(src, /id:'fire_turret'/, 'crafting exposes fire turrets');
assert.match(src, /id:'water_turret'/, 'crafting exposes water turrets');
assert.match(src, /id:'spring_platform'/, 'crafting exposes spring platforms');
assert.match(src, /cost:\{steel:2,\s*copperWire:2,\s*transistor:1\}/, 'spring platform recipe consumes steel and electronics components');
assert.match(src, /const CRAFT_GROUPS=\[/, 'crafting has recipe-book groups instead of one flat list');
assert.match(src, /const CRAFT_GROUP_ORDER=\{\}; CRAFT_GROUPS\.forEach\(\(g,i\)=>\{ CRAFT_GROUP_ORDER\[g\.id\]=i; \}\)/, 'crafting preserves recipe-book group order for the all-recipes view');
assert.match(src, /const CRAFT_RECIPE_META=\{/, 'crafting recipes carry UI metadata separately from effects');
assert.match(src, /function recipeMissing\(r\)/, 'crafting can report missing ingredients per recipe');
assert.match(src, /function recipeMaxCrafts\(r\)/, 'crafting computes craftable batch capacity from inventory');
assert.match(src, /crafting: timedSavePart\('crafting',\(\)=>snapshotCrafting\(\),perf\)/, 'save file persists which crafting recipes already announced availability');
assert.match(src, /restoreCraftingAvailability\(data\.crafting\)/, 'load path restores announced crafting availability state');
assert.match(src, /function checkCraftingAvailability\(opts\)/, 'crafting tracks newly available recipes from inventory changes');
assert.match(src, /msg\('Nowe receptury w Rzemiosle: '\+shown\+extra\)/, 'newly available crafting recipes show one player notification');
assert.match(src, /checkCraftingAvailability\(\{silent:!!opts\.noCraftNotify\}\)/, 'inventory refresh can silence initial crafting notifications');
assert.match(src, /function filteredCraftRecipes\(\)/, 'crafting filters recipes by group and search text');
assert.match(src, /function renderCraftPanel\(\)/, 'crafting renders through the recipe-book panel');
assert.match(src, /search\.addEventListener\('input',\(\)=>\{ craftQuery=search\.value\|\|''; renderCraftPanel\(\); \}\)/, 'crafting search updates the visible recipe list');
assert.match(src, /respawnTotems: timedSavePart\('respawnTotems',\(\)=>snapshotRespawnTotems\(\),perf\)/, 'save file persists placed respawn totem indexes');
assert.match(src, /healingShelters: timedSavePart\('healingShelters',\(\)=>snapshotHealingShelters\(\),perf\)/, 'save file persists healing shelter respawn indexes');
assert.match(src, /grave: timedSavePart\('grave',\(\)=>snapshotGrave\(\),perf\)/, 'save file scopes unrecovered grave resources to the saved world snapshot');
assert.match(src, /water: timedSavePart\('water',\(\)=>snapshotWaterForSave\(\),perf\)/, 'save payload includes the bounded water solver snapshot');
assert.match(src, /WATER\.restore\(data\.water\)/, 'load path restores sub-tile water, toxicity, and material timers after terrain');
assert.match(src, /snapshot\.complete===false|WATER\.validateSnapshot/, 'water snapshot completeness is checked before committing a save');
assert.match(src, /const sameLiveSeed=incomingSeed===WORLDGEN\.worldSeed;[\s\S]*respawnTotems:!hasOwn\('respawnTotems'\) && sameLiveSeed \? snapshotRespawnTotems\(\) : null,[\s\S]*healingShelters:!hasOwn\('healingShelters'\) && sameLiveSeed \? snapshotHealingShelters\(\) : null,[\s\S]*grave:!hasOwn\('grave'\) && sameLiveSeed \? snapshotGrave\(\) : null/, 'sparse legacy saves may migrate side-store markers only from the exact incoming seed');
assert.match(src, /restoreRespawnTotems\(hasOwn\('respawnTotems'\) \? data\.respawnTotems : \(legacyWorldMarkers\.respawnTotems \|\| \{seed:WORLDGEN\.worldSeed,list:\[\]\}\)\)/, 'totem restore prefers snapshot data and otherwise uses the guarded legacy migration');
assert.match(src, /restoreHealingShelters\(hasOwn\('healingShelters'\) \? data\.healingShelters : \(legacyWorldMarkers\.healingShelters \|\| \{seed:WORLDGEN\.worldSeed,list:\[\]\}\)\)/, 'shelter restore prefers snapshot data and otherwise uses the guarded legacy migration');
assert.match(src, /function restoreGrave\(src\)[\s\S]*getTile\(grave\.x,grave\.y\)!==T\.GRAVE[\s\S]*saveGrave\(\)/, 'a restored grave must still exist in the loaded terrain before its resources survive');
assert.match(src, /restoreGrave\(hasOwn\('grave'\) \? data\.grave : legacyWorldMarkers\.grave\)/, 'grave restore uses snapshot state with same-seed legacy compatibility');
assert.match(src, /function dropWorldBoundMarkers\(\)[\s\S]*respawnTotems=\[\];[\s\S]*healingShelters=\[\];[\s\S]*grave=null;/, 'snapshot replacement drops every side-store world marker before restore');

const sameSeedRegen = src.match(/window\.regenWorldSameSeed = function\(\)\{ try\{([\s\S]*?)window\.addEventListener\('mm-regen-same-seed'/)?.[1] || '';
assert.match(sameSeedRegen, /player\.xp=0/, 'same-seed regeneration resets hero XP');
assert.match(sameSeedRegen, /PROGRESS && PROGRESS\.reset/, 'same-seed regeneration resets progression milestones and trophy history');
assert.match(sameSeedRegen, /clearRespawnTotems\(\)/, 'same-seed regeneration clears stale respawn totem indexes');
assert.match(sameSeedRegen, /clearHealingShelters\(\)/, 'same-seed regeneration clears stale healing shelter indexes');
assert.match(sameSeedRegen, /grave=null/, 'same-seed regeneration clears stale graves');
assert.match(sameSeedRegen, /if\(godMode\)/, 'same-seed regeneration preserves debug god-mode resource stacks after reset');
assert.match(indexSrc, /id="taskPanel"/, 'HUD exposes a compact task tracker panel');
assert.match(indexSrc, /id="taskStatus"/, 'task tracker panel has a dedicated status text node');
assert.match(indexSrc, /id="taskListPanel"[^>]*role="dialog"/, 'task tracker opens an accessible full task list');
assert.match(indexSrc, /id="taskList"/, 'task tracker has a dedicated host for every active task');
assert.match(indexSrc, /czerwona strzałka prowadzi właśnie do niego/, 'task list explains priority pointer behavior');
assert.match(src, /TASKS\.setContext\(\{onChange:saveState\}\)/, 'task priority and discard choices request save persistence');
assert.match(src, /function resetWorldTransitionRuntime\(\)[\s\S]*undoStack\.length=0;[\s\S]*HERO_STATUS\.clearAll\(\)[\s\S]*FISHING\.reset\(\)[\s\S]*SANDSTORM\.reset\(\)/, 'one world-transition boundary clears undo, hero status, fishing, and sandstorm state');
assert.match(src, /SURVIVAL\.resetDrowning\(drowningState\)[\s\S]*SURVIVAL\.resetWaterPressure\(waterPressureState\)[\s\S]*SURVIVAL\.resetThermal\(thermalState\)/, 'world transitions clear accumulated survival damage and exposure');
assert.match(src, /loadSaveCandidate\(raw,\{ignoreCritical:true,transactional:true,persistAsMain:true\}\)/, 'named and continue loads use the transactional candidate path');
assert.doesNotMatch(src, /localStorage\.setItem\(SAVE_KEY,raw\);\s*const ok=loadGame/, 'slot candidates never overwrite the active manifest before validation and restore');
assert.match(src, /if\(typeof opts\.commit==='function'\) opts\.commit\(\)/, 'active-save commit runs only after the runtime restore completes');
assert.match(src, /function saveRestoreRejected\(value\)\{[\s\S]*value===false[\s\S]*value\.ok===false/, 'every explicit subsystem restore rejection is fatal');
assert.match(src, /if\(saveRestoreRejected\(value\)\)/, 'required-section restore delegates to the shared rejection contract');
assert.match(src, /function saveCriticalState\(reason,force\)\{[\s\S]{0,180}if\(_saveWritesBlocked\) return false;/, 'critical heartbeat cannot overwrite rejected-save recovery state');
assert.match(src, /function saveState\(\)\{[\s\S]{0,180}if\(_saveWritesBlocked\) return;/, 'dirty autosave scheduling is fail-closed after main-save rejection');
assert.match(src, /function flushPendingSave\(\)[\s\S]{0,500}if\(_saveWritesBlocked\)\{ cancelPendingSaveWork\(\); return; \}/, 'pagehide cannot bypass the rejected-save write lock');
assert.match(src, /function performNamedSave\(forcePrompt\)\{ if\(_saveWritesBlocked\)\{[^}]*return false; \} const slots=loadSlots\(\)/, 'named saves fail closed before prompting, snapshotting, or overwriting a recovery slot');
assert.match(src, /const schedulerState=transactional \? suspendSaveSchedulerForLoad\(\) : null;/, 'transactional loads fence any in-flight incremental save before mutation');
assert.match(src, /settleSaveSchedulerAfterLoad\(schedulerState,false\)/, 'failed loads resume only fresh dirty scheduling after rollback');
assert.match(src, /function snapshotWorldSectionForSave[\s\S]{0,500}snapshot\.complete===false/, 'lossy infrastructure snapshots fail the save instead of truncating silently');
assert.match(src, /function recordSaveFailure\(e,manual\)[\s\S]{0,700}SaveCapacityError[\s\S]{0,180}showPersistentSaveFailure/, 'capacity and repeated autosave failures raise a persistent player warning');
assert.match(chestsSrc, /function openFromWeaponHitAt\(x,y,opts\)/, 'chest engine exposes one shared weapon-impact opener');
assert.match(src, /CHESTS\.setWeaponHitHandler\(\(tx,ty,opts\)=>tryOpenChestAt\(tx,ty,opts\)\)/, 'weapon impacts retain the full chest UI, effects and save path');
assert.match(chestsSrc, /const wx=Number\(x\), wy=Number\(y\);[\s\S]*chestAtPoint\(wx,wy[\s\S]*const tx=Math\.floor\(wx\), ty=Math\.floor\(wy\)[\s\S]*weaponHitHandler\(tx,ty/, 'weapon chest impacts check physical coordinates before the legacy tile fallback');
assert.match(weaponsSrc, /kind:a\.thrown\?'thrown':'arrow'/, 'arrows and thrown projectiles route chest collisions through the opener');

// Exercise the real critical-capsule admission logic. A newer player/inventory
// payload is useful only while it is based on the exact manifest and no dirty
// save revision (mine/place/pickup) occurred after that manifest.
{
  const start=src.indexOf('function criticalStateComparable(state)');
  const end=src.indexOf('function restoreCriticalState(state)',start);
  assert.ok(start>=0 && end>start,'critical recovery source block is discoverable');
  const storage=new Map();
  const stable=value=>{
    if(value===null || typeof value!=='object') return JSON.stringify(value);
    if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
    return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';
  };
  const hash=text=>{
    let h=0x811c9dc5;
    for(let i=0;i<text.length;i++){ h^=text.charCodeAt(i); h=(h>>>0)*0x01000193; h>>>0; }
    return ('00000000'+(h>>>0).toString(16)).slice(-8);
  };
  const sandbox={
    CRITICAL_SAVE_SCHEMA_VERSION:3,
    CRITICAL_SAVE_KEY:'mm_save_critical_v1',
    CRITICAL_SAVE_INTERVAL_MS:2500,
    WORLDGEN:{worldSeed:42},
    MM:{ghostMode:false},
    localStorage:{getItem(key){ return storage.get(key)||null; },setItem(key,value){ storage.set(key,value); }},
    stableStringify:stable,
    computeHash:hash,
    console:{warn(){}},
    Date
  };
  runInNewContext(src.slice(start,end)+';globalThis.criticalApi={integrity:criticalStateIntegritySignature,load:loadCriticalStateForSave};',sandbox);
  const main={v:7,seed:42,h:'1234abcd',savedAt:100};
  const capsule=(overrides={})=>{
    const state=Object.assign({
      v:3,seed:42,savedAt:200,revision:7,baseManifestHash:main.h,baseRevision:7,reason:'heartbeat',
      player:{x:1,y:2,hp:100},inv:{stone:1},hotbar:{selected:0},equipment:{}
    },overrides);
    state.stateHash=hash(sandbox.criticalApi.integrity(state));
    return state;
  };
  const store=state=>storage.set('mm_save_critical_v1',JSON.stringify(state));

  store(capsule());
  assert.ok(sandbox.criticalApi.load(main,{}),'matching clean capsule overlays its exact newer main manifest');
  store(capsule({revision:8}));
  assert.equal(sandbox.criticalApi.load(main,{}),null,'a mine/place revision after the base rejects the partial inventory overlay');
  store(capsule({baseManifestHash:'deadbeef'}));
  assert.equal(sandbox.criticalApi.load(main,{}),null,'a capsule for another main manifest is rejected');
  const tampered=capsule(); tampered.baseRevision=6; store(tampered);
  assert.equal(sandbox.criticalApi.load(main,{}),null,'tampering with base revision without recomputing integrity is rejected');
}

// The guard in the real nested named-save handler must return before it can
// inspect or mutate any recovery slot.
{
  const start=src.indexOf('\tfunction performNamedSave(forcePrompt)');
  const end=src.indexOf('\n\n\t// Continue button logic',start);
  assert.ok(start>=0 && end>start,'named-save handler source block is discoverable');
  let calls=0;
  const existing='byte-for-byte-good-slot';
  const sandbox={
    _saveWritesBlocked:true,
    msg(){},
    loadSlots(){ calls++; throw new Error('blocked handler reached loadSlots'); },
    prompt(){ calls++; throw new Error('blocked handler reached prompt'); },
    buildSaveObject(){ calls++; throw new Error('blocked handler reached snapshot'); },
    writeSaveSlot(){ calls++; throw new Error('blocked handler reached slot write'); }
  };
  runInNewContext(src.slice(start,end)+';globalThis.performNamedSave=performNamedSave;',sandbox);
  assert.equal(sandbox.performNamedSave(false),false,'blocked named save reports refusal');
  assert.equal(calls,0,'blocked named save performs no read, prompt, snapshot, or write work');
  assert.equal(existing,'byte-for-byte-good-slot','the existing recovery slot remains unchanged');
}

// The real flush + cancellation helpers remove only unpublished refs; chunks
// referenced by the last committed manifest stay untouched.
{
  const cancelStart=src.indexOf('function cancelPendingSaveWork()');
  const cancelEnd=src.indexOf('function blockSaveWrites(reason)',cancelStart);
  const flushStart=src.indexOf('function flushPendingSave()');
  const flushEnd=src.indexOf("window.addEventListener('pagehide'",flushStart);
  assert.ok(cancelStart>=0 && cancelEnd>cancelStart && flushStart>=0 && flushEnd>flushStart,'flush cleanup source blocks are discoverable');
  const blobs=new Set(['committed','orphan-a','orphan-b']);
  const sandbox={
    _saveStateT:1,_autoSaveWorkT:2,_autoSaveJob:{refs:[{key:'orphan-a'},{key:'orphan-b'}]},
    _startingNewGame:false,_saveWritesBlocked:false,_saveDirty:false,
    clearTimeout(){},
    cleanupAutosaveChunks(keep,refs){ for(const ref of refs||[]) if(!keep.has(ref.key)) blobs.delete(ref.key); },
    saveCriticalState(){ return true; },
    saveGame(){ return true; },
    clearActiveGameStorage(){ throw new Error('not a new-game flush'); },
    localStorage:{}
  };
  runInNewContext(src.slice(cancelStart,cancelEnd)+src.slice(flushStart,flushEnd)+';globalThis.flush=flushPendingSave;',sandbox);
  sandbox.flush();
  assert.deepEqual([...blobs],['committed'],'flush deletes abandoned incremental blobs but preserves committed data');
}

// Multi-batch snapshots are valid only while their revision, modified-chunk set,
// and every already-encoded chunk version still match the live world.
{
  const start=src.indexOf('function incrementalAutoSaveJobIsCurrent(job)');
  const end=src.indexOf('function finishIncrementalAutoSave()',start);
  assert.ok(start>=0 && end>start,'incremental freshness helpers are discoverable');
  const cleaned=[];
  const sandbox={
    _saveRevision:5,
    _autoSaveJob:null,
    currentChunks:['c1','c2'],
    liveVersions:new Map([['c1',11],['c2',22]]),
    normalizeWorldChunkRef(raw){ const key=typeof raw==='string'?raw:raw&&raw.key; return key?{key}:null; },
    modifiedChunkIds(){ return sandbox.currentChunks.slice(); },
    worldChunkVersion(ref){ return sandbox.liveVersions.get(ref.key)||0; },
    cleanupAutosaveChunks(keep,refs){ cleaned.push(...refs.map(ref=>ref.key)); },
    Set,
    Map
  };
  runInNewContext(src.slice(start,end)+';globalThis.incrementalApi={current:incrementalAutoSaveJobIsCurrent,abandon:abandonIncrementalAutoSave};globalThis.job={revision:5,chunks:["c1","c2"],versions:new Map([["c1",11]]),refs:[{key:"orphan"}]};',sandbox);
  sandbox._autoSaveJob=sandbox.job;
  assert.equal(sandbox.incrementalApi.current(sandbox.job),true,'unchanged incremental job remains publishable');
  sandbox._saveRevision=6;
  assert.equal(sandbox.incrementalApi.current(sandbox.job),false,'a newer save revision invalidates the job');
  sandbox._saveRevision=5; sandbox.liveVersions.set('c1',12);
  assert.equal(sandbox.incrementalApi.current(sandbox.job),false,'a simulation-side chunk version change invalidates the job');
  sandbox.liveVersions.set('c1',11); sandbox.currentChunks.push('c3');
  assert.equal(sandbox.incrementalApi.current(sandbox.job),false,'a newly modified chunk invalidates the frozen manifest set');
  sandbox.incrementalApi.abandon(sandbox.job);
  assert.deepEqual(cleaned,['orphan'],'invalidated job removes its unpublished blobs');
}

// Exercise the real transaction wrapper with a tiny fake runtime. A failed core
// restore and a failed persistence commit must both put runtime A back, while a
// successful load commits B only after B has applied.
{
  const start=src.indexOf('function applyGameData(data,opts)');
  const end=src.indexOf('// Applies a parsed save object to the LIVE session',start);
  assert.ok(start>=0 && end>start,'transaction wrapper source block is discoverable');
  const runtime={id:'A'};
  let stored='A';
  const order=[];
  const sandbox={
    localStorage:{},
    preflightSaveData(){ throw new Error('preflightResult should be reused'); },
    loadFailureSummary(){ return 'invalid'; },
    publishLoadReport(report){ sandbox.lastReport=report; return report; },
    saveErrorText(e){ return String(e && (e.message||e.name)||'error'); },
    buildSaveObject(){ order.push('snapshot:'+runtime.id); return {id:runtime.id}; },
    captureWorldTransitionRuntime(){ return {id:runtime.id}; },
    restoreWorldTransitionRuntimeSnapshot(){ return true; },
    suspendSaveSchedulerForLoad(){ return {dirty:false}; },
    settleSaveSchedulerAfterLoad(){},
    applyGameDataCore(data){ order.push('apply:'+data.id); runtime.id=data.id; if(data.fail) throw new Error('restore boom'); if(data.reject) return false; return true; },
    saveCriticalState(){ order.push('critical'); return true; },
    console:{warn(){},error(){}},
    Date
  };
  runInNewContext(src.slice(start,end)+';globalThis.txApply=applyGameData;',sandbox);
  const preflight=data=>({ok:true,data,version:7,migratedFrom:null,warnings:[],errors:[]});

  assert.equal(sandbox.txApply({id:'B',fail:true},{preflightResult:preflight({id:'B',fail:true}),transactional:true,commit(){ stored='B'; }}),false,'failed restore reports failure');
  assert.equal(runtime.id,'A','failed restore rolls the live runtime back');
  assert.equal(stored,'A','failed restore does not commit SAVE_KEY');
  assert.equal(sandbox.lastReport.rolledBack,true,'failed restore publishes successful rollback state');

  runtime.id='A'; stored='A'; order.length=0;
  assert.equal(sandbox.txApply({id:'B',reject:true},{preflightResult:preflight({id:'B',reject:true}),transactional:true,commit(){ stored='B'; }}),false,'an explicit subsystem rejection fails the transaction');
  assert.equal(runtime.id,'A','an explicit subsystem rejection rolls the live runtime back');
  assert.equal(stored,'A','an explicit subsystem rejection cannot commit SAVE_KEY');

  order.length=0;
  assert.equal(sandbox.txApply({id:'B'},{preflightResult:preflight({id:'B'}),transactional:true,commit(){ order.push('commit'); stored='B'; }}),true,'valid candidate commits');
  assert.equal(runtime.id,'B','successful transaction leaves candidate runtime active');
  assert.equal(stored,'B','successful transaction commits candidate persistence');
  assert.deepEqual(order.slice(0,3),['snapshot:A','apply:B','commit'],'commit occurs after snapshot and runtime apply');

  runtime.id='A'; stored='A'; order.length=0;
  assert.equal(sandbox.txApply({id:'B'},{preflightResult:preflight({id:'B'}),transactional:true,commit(){ order.push('commit'); throw new Error('quota'); }}),false,'failed commit reports failure');
  assert.equal(runtime.id,'A','failed commit rolls the candidate runtime back');
  assert.equal(stored,'A','failed commit preserves the previous active manifest');
}

// The centralized envelope preflight is exercised independently from the DOM app.
// This pins the version/hash/seed/position/cap policy that runs before mutation.
{
  const start=src.indexOf('function isSaveRecord(v)');
  const end=src.indexOf('function savePerfNow()',start);
  assert.ok(start>=0 && end>start,'save preflight source block is discoverable');
  const sandbox={
    SAVE_SCHEMA_VERSION:7,
    SAVE_SUPPORTED_VERSIONS:Object.freeze([6,7]),
    SAVE_CHUNK_RESTORE_CAP:4096,
    SAVE_INFRASTRUCTURE_RESTORE_CAP:20000,
    SAVE_CONSTRUCTION_BACKGROUND_RESTORE_CAP:40000,
    BEDROCK_PICK_MAX_DURABILITY:10,
    IMPORT_SAVE_BYTE_CAP:24*1024*1024,
    AUTOSAVE_CHUNK_PREFIX:'mm_save_v7_chunk_',
    CHUNK_W:32,
    WORLD_H:140,
    WATER:{validateSnapshot(value){ return value && value.bad ? {ok:false,errors:['bad water']} : {ok:true,errors:[]}; }},
    WORLD:{isInfrastructureTile(value){ return value===101; },isConstructionBackgroundTile(value){ return value===201; }},
    normalizeWorldSeed(value){ return Number.isInteger(value) && value>0 && value<1000000000 ? value : null; },
    verifyHash(value){ return {ok:value.h==='12345678'}; },
    validSavedChunkRef(cx,sy){ return Number.isInteger(cx) && sy==null ? {cx,sy:null,base:true,key:'c'+cx} : null; },
    decodeSavedChunk(value,rle,size){ return value==='encoded' ? new Uint8Array(size) : null; },
    worldSectionHeight(){ return 280; },
    worldCellInBounds(x,y){ return Number.isFinite(x) && Math.abs(x)<=30000000 && Number.isFinite(y) && y>=-896 && y<1036; },
    computeHash(value){ return value==='encoded' ? 'feedbeef' : '12345678'; },
    attachHash(value){ return {object:Object.assign({},value,{h:'12345678'}),hash:'12345678'}; },
    assertSaveChunkCapacity(records){ return records; },
    loadFailureSummary(preflight){ return preflight.errors[0]?.detail||'invalid'; },
    localStorage:{getItem(){ return null; }}
  };
  const portableStart=src.indexOf('function portableSaveJson(raw,storage)');
  const portableEnd=src.indexOf('function loadSaveCandidate(raw,opts)',portableStart);
  assert.ok(portableStart>=0 && portableEnd>portableStart,'portable export helper source block is discoverable');
  runInNewContext(src.slice(start,end)+src.slice(portableStart,portableEnd)+';globalThis.preflight=preflightSaveData;globalThis.portable=portableSaveJson;',sandbox);
  const make=(overrides={})=>Object.assign({
    v:7,seed:42,h:'12345678',world:{modified:[]},player:{x:1,y:2},inv:{tools:{}}
  },overrides);
  assert.equal(sandbox.preflight(make(),{requireHash:true,storage:sandbox.localStorage}).ok,true,'canonical v7 envelope passes strict preflight');
  assert.equal(sandbox.preflight(make({h:undefined}),{requireHash:true,storage:sandbox.localStorage}).ok,false,'hashless v7 is rejected');
  assert.equal(sandbox.preflight(make({h:'deadbeef'}),{requireHash:true,storage:sandbox.localStorage}).ok,false,'hash mismatch is rejected');
  const legacy=sandbox.preflight({v:6,seed:42,world:{modified:[]},player:{x:1,y:2,xp:4},savedAt:123,h:undefined},{requireHash:true,storage:sandbox.localStorage});
  assert.equal(legacy.ok,true,'hashless v6 remains an explicit migration input');
  assert.equal(legacy.migratedFrom,6,'legacy v6 reports its migration source');
  assert.equal(legacy.data.v,7,'legacy v6 is promoted before the mutating core');
  assert.equal(JSON.stringify(legacy.data.inv.tools),JSON.stringify({stone:false,meteor:false,diamond:false,bedrock:false,bedrockDurability:0}),'historical v6 without inventory receives a canonical empty v7 inventory');
  assert.equal(sandbox.preflight(make({v:8}),{requireHash:true,storage:sandbox.localStorage}).ok,false,'future unsupported save versions are rejected');
  assert.equal(sandbox.preflight(make({seed:0}),{requireHash:true,storage:sandbox.localStorage}).ok,false,'non-canonical seeds are rejected');
  assert.equal(sandbox.preflight(make({player:{x:30000001,y:2}}),{requireHash:true,storage:sandbox.localStorage}).ok,false,'out-of-world player positions are rejected');
  assert.equal(sandbox.preflight(make({inv:{tools:{bedrock:'yes',bedrockDurability:999}}}),{requireHash:true,storage:sandbox.localStorage}).ok,false,'tool ownership and durability require canonical types and bounds');
  assert.equal(sandbox.preflight(make({world:{modified:new Array(4097).fill(null)}}),{requireHash:true,storage:sandbox.localStorage}).ok,false,'over-cap chunk manifests fail rather than truncate');
  assert.equal(sandbox.preflight(make({water:{bad:true}}),{requireHash:true,storage:sandbox.localStorage}).ok,false,'invalid bounded water state rejects the whole save');
  assert.equal(sandbox.preflight(make({infrastructure:{v:2,complete:false,list:[]}}),{requireHash:true,storage:sandbox.localStorage}).ok,false,'a truncated infrastructure snapshot rejects the whole save');
  assert.equal(sandbox.preflight(make({constructionBackground:{v:1,complete:true,list:[{x:1,y:2,t:201}]}}),{requireHash:true,storage:sandbox.localStorage}).ok,true,'a canonical complete construction-background snapshot passes');
  const externalKey='mm_save_v7_chunk_42_1_job';
  const external=make({savedAt:123,world:{external:true,chunkRefs:[{cx:1,key:externalKey,rle:true,h:'feedbeef'}]}});
  const sourceStorage={getItem(key){ return key===externalKey?'encoded':null; }};
  const exported=sandbox.portable(JSON.stringify(external),sourceStorage);
  const portableData=JSON.parse(exported);
  assert.equal(Array.isArray(portableData.world.modified),true,'fork export embeds referenced chunks inline');
  assert.equal(Object.hasOwn(portableData.world,'chunkRefs'),false,'fork export contains no localStorage-only references');
  assert.equal(sandbox.preflight(portableData,{requireHash:true,storage:{getItem(){ return null; }}}).ok,true,'portable fork export validates with empty destination storage');
}

console.log('save-schema-sim: all assertions passed');
