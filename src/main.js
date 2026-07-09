// Nowy styl / pełny ekran inspirowany Diamonds Explorer
// Module entry: import constants (also hydrates window.MM via shim) and side-effect engine modules
import { CHUNK_W, WORLD_H, WORLD_SECTION_H, WORLD_MIN_SECTION, WORLD_MAX_SECTION, WORLD_MIN_Y, WORLD_MAX_Y, TILE, T, INFO, MOVE, isAutumnLeaf, isLeaf } from './constants.js';
// Ensure worldgen initializes before world (world.js reads MM.worldGen on load)
import { worldGen as WORLDGEN } from './engine/worldgen.js';
import world from './engine/world.js';
import { trees as TREES } from './engine/trees.js';
import { fallingSolids as FALLING } from './engine/falling.js';
import { isAirOrGasTile, isDoorTile, isGasTile, isHeroPassableTile, isLooseItemMaterial, isMeteorPickDenseRockMaterial, isMeteorPickSparkMaterial, isPlayerBuiltMaterial, isPlayerPassableTile, isReplaceableNaturalOpenTile, isSafeLandingFloorTile, isSolidCollisionTile as isSolid, isStableMachineSupportTile, isTrapdoorTile } from './engine/material_physics.js';
import { water as WATER } from './engine/water.js';
import { gases as GASES } from './engine/gases.js';
import { dynamo as DYNAMO } from './engine/dynamo.js';
import { solar as SOLAR } from './engine/solar.js';
import { teleporters as TELEPORTERS } from './engine/teleporters.js';
import { pumps as PUMPS } from './engine/pumps.js';
import { canPlaceLadderFixture, ladderConnections } from './engine/ladders.js';
import { applyHorizontalMovement, applyJumpArcControl, surfaceTraction } from './engine/movement.js';
import './engine/input_mode.js'; // stamps data-input-mode on <html>; touch clusters gate off it
import { CRUSH_TUNING, crushTickDamage, heroCrushCapacity, heroEmbeddedTiles, resolveHeroBurial } from './engine/hero_crush.js';
import { cape as CAPE } from './engine/cape.js';
import { necklace as NECKLACE } from './engine/necklace.js';
import { chests as CHESTS } from './engine/chests.js';
import { createCraftingModel, SOURCE_HINTS as CRAFT_SOURCE_HINTS } from './engine/crafting.js';
import './inventory.js';
import { mobs as MOBS } from './engine/mobs.js';
import { tutorialNpc as TUTORIAL_NPC } from './engine/tutorial_npc.js';
import { npcRegistry as NPCS } from './engine/npc_system.js';
import { generatedNpcs as GENERATED_NPCS } from './engine/generated_npcs.js';
import { background as BACKGROUND } from './engine/background.js';
import { seasons as SEASONS } from './engine/seasons.js';
import { fog as FOG } from './engine/fog.js';
import { eyes as EYES } from './engine/eyes.js';
import { particles as PARTICLES } from './engine/particles.js';
import { clouds as CLOUDS } from './engine/clouds.js';
import { wind as WIND } from './engine/wind.js';
import { bosses as BOSSES } from './engine/bosses.js';
import { guardianLairs as GUARDIANS } from './engine/guardian_lairs.js';
import { undergroundBoss as UNDERGROUND } from './engine/underground_boss.js';
import { skyGuardian as SKY_GUARDIAN } from './engine/sky_guardian.js';
import { guardianAftermath as AFTERMATH } from './engine/guardian_aftermath.js';
import { centerGuardian as CENTER_GUARDIAN } from './engine/center_guardian.js';
import { storyProgression as STORY_PROGRESSION } from './engine/story_progression.js';
import { grass as GRASS } from './engine/grass.js';
import { fire as FIRE } from './engine/fire.js';
import { weapons as WEAPONS } from './engine/weapons.js';
import { meat as MEAT } from './engine/meat.js';
import { companions as COMPANIONS } from './engine/companions.js';
import { food as FOOD } from './engine/food.js';
import { volcano as VOLCANO } from './engine/volcano.js';
import { atomicWinter as ATOMIC_WINTER } from './engine/atomic_winter.js';
import { plants as PLANTS } from './engine/plants.js';
import { progress as PROGRESS } from './engine/progress.js';
import { survival as SURVIVAL } from './engine/survival.js';
import { houseHealing as HOUSE_HEALING } from './engine/house_healing.js';
import { audio as AUDIO } from './engine/audio.js';
import { ufo as UFO } from './engine/ufo.js';
import { tasks as TASKS } from './engine/tasks.js';
import { invasions as INVASIONS } from './engine/invasions.js';
import { traps as TRAPS } from './engine/traps.js';
import { terrainTraps as TERRAIN_TRAPS } from './engine/terrain_traps.js';
import { ruins as RUINS } from './engine/ruins.js';
import { alienRuins as ALIEN_RUINS } from './engine/alien_ruins.js';
import { meteorites as METEORITES } from './engine/meteorites.js';
import { turrets as TURRETS } from './engine/turrets.js';
import { springPlatforms as SPRING_PLATFORMS } from './engine/spring_platforms.js';
import { vending as VENDING } from './engine/vending.js';
import { trader as TRADER } from './engine/trader.js';
import { fishing as FISHING } from './engine/fishing.js';
import { boats as BOATS } from './engine/boats.js';
import { mechs as MECHS } from './engine/mechs.js';
import { altar as ALTAR } from './engine/altar.js';
import { lighting as LIGHTING } from './engine/lighting.js';
import { vitalsHud as VITALS_HUD } from './engine/vitals_hud.js';
import './engine/ui.js';
import './inventory_ui.js';
// Bind global MM into a module-scoped constant for convenience
const MM = window.MM;
// Game init
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', {alpha:false});
let W=0,H=0,DPR=1; function resize(){ DPR=Math.max(1,Math.min(2,window.devicePixelRatio||1)); canvas.width=Math.floor(window.innerWidth*DPR); canvas.height=Math.floor(window.innerHeight*DPR); canvas.style.width=window.innerWidth+'px'; canvas.style.height=window.innerHeight+'px'; ctx.setTransform(DPR,0,0,DPR,0,0); W=window.innerWidth; H=window.innerHeight; } window.addEventListener('resize',resize,{passive:true}); resize();
function resetFrameCanvasState(){
	if(ctx.setTransform) ctx.setTransform(DPR,0,0,DPR,0,0);
	ctx.globalAlpha=1;
	ctx.globalCompositeOperation='source-over';
	ctx.imageSmoothingEnabled=false;
}

// --- Świat (łagodniejsze biomy: równiny / wzgórza / góry) ---
const WORLD = world || MM.world;
function worldSectionHeight(){ return (WORLD && Number.isFinite(WORLD.sectionHeight)) ? WORLD.sectionHeight : WORLD_SECTION_H; }
function worldMinY(){ return (WORLD && Number.isFinite(WORLD.minY)) ? WORLD.minY : WORLD_MIN_Y; }
function worldMaxY(){ return (WORLD && Number.isFinite(WORLD.maxY)) ? WORLD.maxY : WORLD_MAX_Y; }
function worldMinSection(){ return (WORLD && Number.isFinite(WORLD.minSection)) ? WORLD.minSection : WORLD_MIN_SECTION; }
function worldMaxSection(){ return (WORLD && Number.isFinite(WORLD.maxSection)) ? WORLD.maxSection : WORLD_MAX_SECTION; }
function worldSectionY(y){ return (WORLD && WORLD.sectionYFor) ? WORLD.sectionYFor(y) : Math.floor(Math.floor(y)/worldSectionHeight()); }
function worldSectionOriginY(sy){ return (WORLD && WORLD.sectionOriginY) ? WORLD.sectionOriginY(sy) : sy*worldSectionHeight(); }
function worldSectionLocalY(y,sy){ return (WORLD && WORLD.sectionLocalY) ? WORLD.sectionLocalY(y,sy) : Math.floor(y)-worldSectionOriginY(sy); }
function worldYInBounds(y){ return Number.isFinite(y) && y>=worldMinY() && y<worldMaxY(); }
function baseWorldSectionMax(){ return Math.max(0, Math.ceil(WORLD_H/worldSectionHeight())-1); }
function isBaseWorldSection(sy){ return sy==null || (sy>=0 && sy<=baseWorldSectionMax()); }
function fallbackNormalizeChunkRef(ref){
	if(typeof ref==='number' && Number.isFinite(ref)) return {cx:Math.floor(ref), sy:null, base:true, key:'c'+Math.floor(ref), h:WORLD_H};
	if(ref && typeof ref==='object' && Number.isFinite(ref.cx)){
		const sy=Number.isFinite(ref.sy) ? Math.floor(ref.sy) : null;
		const base=isBaseWorldSection(sy);
		return {cx:Math.floor(ref.cx), sy, base, key:base?('c'+Math.floor(ref.cx)):('c'+Math.floor(ref.cx)+':s'+sy), h:base?WORLD_H:worldSectionHeight()};
	}
	if(typeof ref==='string' && ref[0]==='c'){
		const body=ref.slice(1), split=body.indexOf(':s');
		if(split<0){
			const cx=Number(body);
			return Number.isFinite(cx) ? {cx:Math.floor(cx), sy:null, base:true, key:'c'+Math.floor(cx), h:WORLD_H} : null;
		}
		const cx=Number(body.slice(0,split)), sy=Number(body.slice(split+2));
		if(!Number.isFinite(cx) || !Number.isFinite(sy)) return null;
		return {cx:Math.floor(cx), sy:Math.floor(sy), base:false, key:'c'+Math.floor(cx)+':s'+Math.floor(sy), h:worldSectionHeight()};
	}
	return null;
}
function normalizeWorldChunkRef(ref){
	if(WORLD && typeof WORLD.normalizeChunkRef==='function'){
		const out=WORLD.normalizeChunkRef(ref);
		if(out) return out;
	}
	return fallbackNormalizeChunkRef(ref);
}
function worldRenderSectionKey(cx,sy){ return 'c'+Math.floor(cx)+':r'+Math.floor(sy); }
function parseWorldRenderSectionKey(key){
	if(typeof key!=='string') return null;
	const split=key.indexOf(':r');
	if(split<0) return normalizeWorldChunkRef(key);
	const cx=Number(key.slice(1,split)), sy=Number(key.slice(split+2));
	return Number.isFinite(cx) && Number.isFinite(sy) ? {cx:Math.floor(cx), sy:Math.floor(sy)} : null;
}
function worldChunkVersion(ref){
	const norm=normalizeWorldChunkRef(ref);
	if(!norm) return 0;
	if(WORLD && typeof WORLD.chunkVersion==='function') return WORLD.chunkVersion(norm.cx,norm.sy);
	return WORLD && WORLD._versions ? (WORLD._versions.get(norm.key)||0) : 0;
}
function worldChunkArrayFor(ref,generate){
	const norm=normalizeWorldChunkRef(ref);
	if(!norm) return null;
	if(generate && WORLD && typeof WORLD.ensureSection==='function' && Number.isFinite(norm.sy)) return WORLD.ensureSection(norm.cx,norm.sy);
	if(generate && norm.base && WORLD && typeof WORLD.ensureChunk==='function') return WORLD.ensureChunk(norm.cx);
	if(WORLD && typeof WORLD.chunkArray==='function') return WORLD.chunkArray(norm);
	return WORLD && WORLD._world ? (WORLD._world.get(norm.key)||null) : null;
}
// Using ESM imports for trees and cape
// const TREES = MM.trees;
// const CAPE = MM.cape;
// Visual enhancement config
const VISUAL={animations:true, atmoTint:true};
// Biome ID to name mapping used for the HUD pill + debug overlay (UI language: Polish)
const BIOME_NAMES = [
	'Las',
	'Równiny',
	'Śnieg/Lód',
	'Pustynia',
	'Bagno',
	'Morze',
	'Jezioro',
	'Góry',
	'Zniszczone miasto'
];
// HUD biome pill: DOM write only when the hero crosses into a different biome
let _lastBiomeId=-1, _lastBiomeSeason='';
function atomicWinterCalendarActive(){
	try{ return !!(ATOMIC_WINTER && typeof ATOMIC_WINTER.isActive==='function' && ATOMIC_WINTER.isActive()); }catch(e){ return false; }
}
function formatSeasonCalendarLabel(sm){
	if(!sm || sm.enabled===false) return '';
	const label=String(sm.label || '').replace(/^☢️\s*❄️\s*/, '').replace(/^☢️\s*/, '') || 'Zima';
	if(atomicWinterCalendarActive() && sm.season==='winter') return '☢️ ❄️ '+label;
	return sm.label || '';
}
function seasonMetricsForCalendar(){
	try{
		const sm=(SEASONS && SEASONS.metrics)? SEASONS.metrics() : null;
		if(!sm) return null;
		const label=formatSeasonCalendarLabel(sm);
		return label && label!==sm.label ? Object.assign({}, sm, {label}) : sm;
	}catch(e){ return null; }
}
function updateBiomeLabel(){
	if(!WORLDGEN || !WORLDGEN.biomeType) return;
	const id=WORLDGEN.biomeType(Math.floor(player.x));
	let seasonLabel='';
	try{ const sm=seasonMetricsForCalendar(); if(sm && sm.label) seasonLabel=' / '+sm.label; }catch(e){}
	if(id===_lastBiomeId && seasonLabel===_lastBiomeSeason) return;
	_lastBiomeId=id;
	_lastBiomeSeason=seasonLabel;
	const el=document.getElementById('biome');
	if(el) el.textContent=(BIOME_NAMES[id]||'---')+seasonLabel;
}
// Compact at-a-glance world status: hero position, in-world clock, live weather
// and season. Reads the same sources the world already simulates (no new state)
// and only touches the DOM when the rendered text actually changes.
const STATUS_SEASON_ICON={spring:'🌱', summer:'🌻', autumn:'🍂', winter:'❄️'};
function formatSeasonStatusIcon(sm){
	if(!sm || sm.enabled===false) return '';
	const icon=STATUS_SEASON_ICON[sm.season] || '';
	if(!icon) return '';
	return atomicWinterCalendarActive() && sm.season==='winter' ? '☢️ '+icon : icon;
}
let _lastStatusText='';
let _lastStatusAt=0;
function fmtStatusCoord(v){
	if(!Number.isFinite(v)) return '?';
	return Math.abs(v)>=10000 ? (v/1000).toFixed(1)+'k' : String(Math.round(v));
}
function fmtStatusDistance(v){
	const n=Math.max(0, Number(v)||0);
	if(n>=10000) return (n/1000).toFixed(1)+'km';
	return Math.ceil(n)+'m';
}
function fmtStatusSeconds(v){
	const n=Math.max(0, Number(v)||0);
	if(n>=10) return Math.ceil(n)+'s';
	return n.toFixed(1)+'s';
}
function deathTravelRemainingPathLength(fx,progress){
	if(!fx) return 0;
	const start=deathClamp01(progress);
	if(start>=1) return 0;
	const estimate=Math.max(1, (Number(fx.pathLen)||Number(fx.dist)||1) * (1-start));
	const steps=Math.max(4,Math.min(48,Math.ceil(estimate/8)));
	let len=0;
	let prev=deathTravelPointAt(fx,start);
	for(let i=1;i<=steps;i++){
		const p=start+(1-start)*(i/steps);
		const pt=deathTravelPointAt(fx,p);
		len+=Math.hypot(pt.x-prev.x,pt.y-prev.y);
		prev=pt;
	}
	return len;
}
function deathTravelHudMetrics(){
	const fx=deathTravelFx;
	if(!fx) return null;
	const dur=Math.max(0.001, Number(fx.dur)||0.001);
	const t=Math.max(0, Number(fx.t)||0);
	const raw=deathClamp01(t/dur);
	const progress=deathTravelProgressAt(raw);
	const pos=deathTravelPointAt(fx,progress);
	return {
		pos,
		distanceLeft:deathTravelRemainingPathLength(fx,progress),
		secondsLeft:Math.max(0,dur-t)
	};
}
function updateStatusHud(ts){
	const el=document.getElementById('worldStatus');
	if(!el || !player) return;
	const now=(typeof ts==='number') ? ts : performance.now();
	if(now-_lastStatusAt < 250) return; // throttle: a HUD line never needs per-frame DOM writes
	_lastStatusAt=now;
	const travel=deathTravelHudMetrics();
	const pos=(travel && travel.pos) || player;
	const parts=['📍 '+fmtStatusCoord(pos.x)+','+fmtStatusCoord(pos.y)];
	if(travel){
		parts.push('🧭 '+fmtStatusDistance(travel.distanceLeft));
		parts.push('⏱ '+fmtStatusSeconds(travel.secondsLeft));
	}
	let isDay=true;
	try{
		const ti=(BACKGROUND && BACKGROUND.timeInfo) ? BACKGROUND.timeInfo() : null;
		if(ti){
			isDay=ti.isDay;
			const hh=String(ti.hour).padStart(2,'0'), mm=String(ti.minute).padStart(2,'0');
			const icon = ti.phase==='dawn'?'🌅' : ti.phase==='dusk'?'🌆' : ti.phase==='night'?'🌙' : '🕐';
			parts.push(icon+' '+hh+':'+mm);
		}
	}catch(e){}
	try{
		const wm=(WIND && WIND.metrics) ? WIND.metrics() : null;
		const cm=(CLOUDS && CLOUDS.metrics) ? CLOUDS.metrics() : null;
		const raining=(CLOUDS && CLOUDS.isRainingAt) ? CLOUDS.isRainingAt(Math.floor(pos.x)) : false;
		const storming=!!(cm && cm.storm && cm.storm.active);
		const speed=wm ? wm.speed : 0;
		const squall=!!(wm && wm.squall && wm.squall.active);
		let wicon;
		if(storming) wicon='⛈️';
		else if(raining) wicon='🌧️';
		else if(squall || (wm && wm.intensity>0.55)) wicon='💨';
		else if(wm && wm.cloudiness>0.5) wicon='☁️';
		else wicon = isDay ? '☀️' : '✨';
		parts.push(Math.abs(speed)>0.8 ? wicon+(speed<0?'←':'→') : wicon);
	}catch(e){}
	try{
		const sm=(SEASONS && SEASONS.metrics) ? SEASONS.metrics() : null;
		const seasonIcon=formatSeasonStatusIcon(sm);
		if(seasonIcon) parts.push(seasonIcon);
	}catch(e){}
	const text=parts.join('  ·  ');
	const title=travel ? 'Podroz po smierci: aktualna pozycja, pozostaly dystans i szacowany czas' : 'Pozycja bohatera, zegar, pogoda i pora roku';
	if(text!==_lastStatusText){ _lastStatusText=text; el.textContent=text; }
	if(el.title!==title) el.title=title;
}
// --- Dynamic Background delegated to engine/background.js ---
function drawBackground(){
	if(BACKGROUND && BACKGROUND.draw){
		const focus=deathTravelFx ? deathTravelCurrentPoint(deathTravelFx) : player;
		BACKGROUND.draw(ctx, W, H, focus.x, TILE, WORLDGEN, zoom);
	}
}
function applyAtmosphericTint(){ if(!VISUAL.atmoTint) return; if(BACKGROUND && BACKGROUND.applyTint) BACKGROUND.applyTint(ctx, W, H); }
let currentRenderDetail={tier:0, visibleTiles:0, fogStep:1, grass:true, label:'full'};
function renderDetailFor(z,viewX,viewY){
	const visibleTiles=Math.max(0,(Math.ceil(viewX)||0)*(Math.ceil(viewY)||0));
	return {
		tier:0,
		visibleTiles,
		fogStep:1,
		grass:true,
		label:'full'
	};
}
function publishRenderDetail(detail,z){
	currentRenderDetail=detail || currentRenderDetail;
	try{ window.__mmRenderDetail=Object.assign({zoom:+(z||0).toFixed(3)}, currentRenderDetail); }catch(e){}
}
let grassDensityScalar = 1; // user adjustable (exponential scaling)
let grassHeightScalar = 1; // user adjustable linear multiplier
const GRASS_DENSITY_CAP = 18; // prevents saved extreme UI values from flooding the renderer
// Grass performance management
const FRAME_CAP_FPS=120;
const FRAME_CAP_SMOOTH_NATIVE_MAX_FPS=180;
const FRAME_CAP_STORAGE_KEY='mm_fps_unlocked';
let frameCapUnlocked=false;
let frameCapRafLast=0;
let frameCapNativeMs=0;
let frameCapDivisor=1;
let frameCapPhase=0;
let frameCapPublishAt=0;
let frameCapCandidate=1;
let frameCapCandidateStreak=0;

function publishFrameCapState(){
	try{
		const nativeFps=frameCapNativeMs>0 ? 1000/frameCapNativeMs : 0;
		const effective=frameCapUnlocked ? 0 : (nativeFps>0 ? nativeFps/Math.max(1,frameCapDivisor) : FRAME_CAP_FPS);
		window.__mmFrameCap={
			fps:frameCapUnlocked?0:FRAME_CAP_FPS,
			unlocked:frameCapUnlocked,
			divisor:frameCapDivisor,
			nativeFps:+(nativeFps||0).toFixed(1),
			effectiveFps:+(effective||0).toFixed(1),
			smoothNative:!frameCapUnlocked && frameCapDivisor===1 && nativeFps>FRAME_CAP_FPS+4
		};
	}catch(e){}
}
function setFrameCapUnlocked(value){
	frameCapUnlocked=value===true;
	const chk=document.getElementById('fpsUnlockCheckbox');
	const label=document.getElementById('fpsCapLabel');
	if(chk) chk.checked=frameCapUnlocked;
	if(label) label.textContent=frameCapUnlocked?'bez limitu':('plynny ~'+FRAME_CAP_FPS);
	try{ localStorage.setItem(FRAME_CAP_STORAGE_KEY, frameCapUnlocked?'1':'0'); }catch(e){}
	publishFrameCapState();
}
function initFrameCapControls(){
	const chk=document.getElementById('fpsUnlockCheckbox');
	let saved=false;
	try{ saved=localStorage.getItem(FRAME_CAP_STORAGE_KEY)==='1'; }catch(e){ saved=false; }
	setFrameCapUnlocked(saved);
	if(chk) chk.addEventListener('change',()=>{ setFrameCapUnlocked(chk.checked); resetFrameTiming('fps-cap'); });
}
function resetFrameCapScheduler(ts,publish){
	frameCapRafLast=Number.isFinite(ts) ? ts : 0;
	frameCapNativeMs=0;
	frameCapDivisor=1;
	frameCapPhase=0;
	frameCapPublishAt=0;
	frameCapCandidate=1;
	frameCapCandidateStreak=0;
	if(publish!==false) publishFrameCapState();
}
function shouldSkipFrameForCap(ts){
	if(frameCapUnlocked){
		resetFrameCapScheduler(ts,false);
		return false;
	}
	if(frameClock.resetFrames>0){
		resetFrameCapScheduler(ts,false);
		return false;
	}
	if(!(ts>=0) || !Number.isFinite(ts)) return false;
	if(!(frameCapRafLast>0)){
		resetFrameCapScheduler(ts);
		return false;
	}
	const elapsed=ts-frameCapRafLast;
	const measured=Math.max(0, Math.min(1000, elapsed));
	frameCapRafLast=ts;
	if(measured>0 && measured<100){
		frameCapNativeMs = frameCapNativeMs ? frameCapNativeMs*0.9 + measured*0.1 : measured;
	}
	const native=frameCapNativeMs>0 ? frameCapNativeMs : measured;
	const nativeFps=native>0 ? 1000/native : 0;
	let nextDivisor=1;
	if(nativeFps>FRAME_CAP_SMOOTH_NATIVE_MAX_FPS){
		// round, not ceil: a 240Hz-class display measures ~240.05 native and ceil
		// picked divisor 3 (every 3rd frame = 80fps, flapping with 2 = the reported
		// unstable ~70fps under the 120 cap); round gives 2 → a clean ~120
		nextDivisor=Math.max(1, Math.round(nativeFps/FRAME_CAP_FPS));
	}
	// Debounce: EMA jitter near a divisor boundary must not flap the cadence —
	// only adopt a new divisor after it stays the winner for ~45 consecutive frames
	if(nextDivisor!==frameCapDivisor){
		if(nextDivisor===frameCapCandidate) frameCapCandidateStreak++;
		else { frameCapCandidate=nextDivisor; frameCapCandidateStreak=1; }
		if(frameCapCandidateStreak>=45){
			frameCapDivisor=nextDivisor;
			frameCapPhase=0;
			frameCapPublishAt=0;
			frameCapCandidateStreak=0;
		}
	}else{
		frameCapCandidate=frameCapDivisor;
		frameCapCandidateStreak=0;
	}
	if(!frameCapPublishAt || ts-frameCapPublishAt>1000){
		frameCapPublishAt=ts;
		publishFrameCapState();
	}
	if(frameCapDivisor<=1) return false;
	frameCapPhase=(frameCapPhase+1)%frameCapDivisor;
	return frameCapPhase!==0;
}

// --- Player Speed Slider Controls ---
function initPlayerSpeedControls() {
	const dropdown = document.getElementById('playerSpeedDropdown');
	const label = document.getElementById('playerSpeedLabel');
	function update() {
		if (!dropdown || !label) return;
		let val = Number(dropdown.value);
		if (isNaN(val) || val < 2) val = 2;
		window.playerSpeedMultiplier = val;
		label.textContent = 'x' + val;
		try{ localStorage.setItem('mm_player_speed_mult', String(val)); }catch(e){}
	}
	if (dropdown) {
		dropdown.addEventListener('change', update);
	}
	// Set default multiplier if not set
	if (typeof window.playerSpeedMultiplier !== 'number') {
		try{ const saved = parseInt(localStorage.getItem('mm_player_speed_mult')||'2',10); window.playerSpeedMultiplier = (isNaN(saved)?2:saved); }catch(e){ window.playerSpeedMultiplier = 2; }
	}
	// Initialize dropdown from saved value
	if(dropdown){ dropdown.value = String(window.playerSpeedMultiplier||2); }
	update();
}

function initGrassControls(){
	const rngD=document.getElementById('grassDensity');
	const labD=document.getElementById('grassDensityLabel');
	const rngH=document.getElementById('grassHeight');
	const labH=document.getElementById('grassHeightLabel');
	function updDensity(){ if(!rngD||!labD) return; let val = parseFloat(rngD.value); if(isNaN(val)) return; if(val<0) val=0; if(val>4) val=4; grassDensityScalar = Math.min(GRASS_DENSITY_CAP, Math.pow(3, val)); const approx = Math.round(4 * grassDensityScalar); labD.textContent=approx+'x'; try{ localStorage.setItem('mm_grass_density', String(val)); }catch(e){} }
	function updHeight(){ if(!rngH||!labH) return; const val = parseFloat(rngH.value); if(isNaN(val)) return; grassHeightScalar = val; labH.textContent=grassHeightScalar.toFixed(2)+'x'; try{ localStorage.setItem('mm_grass_height', String(val)); }catch(e){} }
	if(rngD) rngD.addEventListener('input',updDensity); if(rngH) rngH.addEventListener('input',updHeight);
	// Initialize from saved values
	try{
		const d = localStorage.getItem('mm_grass_density'); if(d!=null && rngD){ rngD.value = d; }
		const h = localStorage.getItem('mm_grass_height'); if(h!=null && rngH){ rngH.value = h; }
	}catch(e){}
	updDensity(); updHeight();
}
let worldSeed;
try {
	if(!WORLDGEN) throw new Error('MM.worldGen missing (worldgen.js not loaded)');
	worldSeed = WORLDGEN.worldSeed;
} catch(e){
	const box=document.getElementById('errorBox');
	if(box){ box.textContent='Init error: '+e.message; box.style.display='block'; }
	console.error('[InitFailure]', e);
	// abort further setup to avoid cascading issues
	throw e;
}
function setSeedFromInput(){ WORLDGEN.setSeedFromInput(); worldSeed=WORLDGEN.worldSeed; }
function ensureChunk(cx){ return WORLD.ensureChunk(cx); }
function ensureChunkAtY(cx,y){
	if(WORLD && typeof WORLD.ensureSection==='function' && Number.isFinite(y)){
		const sy=worldSectionY(y);
		const section=WORLD.ensureSection(cx,sy);
		if(section) return section;
	}
	return ensureChunk(cx);
}

// light error overlay (keep minimal)
(function(){ const box=document.getElementById('errorBox'); if(!box) return; function show(msg){ box.textContent=msg; box.style.display='block'; }
	window.addEventListener('error',e=>{ show('[Error] '+e.message); });
	window.addEventListener('unhandledrejection',e=>{ const r=e.reason; show('[Promise] '+((r && r.message) || String(r))); });
})();

function getTile(x,y){ return WORLD.getTile(x,y); }
function getInfrastructureTile(x,y){ return (WORLD && WORLD.getInfrastructure) ? WORLD.getInfrastructure(x,y) : T.AIR; }
function getInfrastructureTiles(x,y){ return (WORLD && WORLD.getInfrastructureStack) ? WORLD.getInfrastructureStack(x,y) : (getInfrastructureTile(x,y)!==T.AIR?[getInfrastructureTile(x,y)]:[]); }
function hasInfrastructureTile(x,y,t){ return (WORLD && WORLD.hasInfrastructure) ? WORLD.hasInfrastructure(x,y,t) : getInfrastructureTile(x,y)===t; }
function getConstructionBackgroundTile(x,y){ return (WORLD && WORLD.getConstructionBackground) ? WORLD.getConstructionBackground(x,y) : T.AIR; }
function getPlayerConstructionBackgroundTile(x,y){ return (WORLD && WORLD.getPlayerConstructionBackground) ? WORLD.getPlayerConstructionBackground(x,y) : T.AIR; }
function isBackgroundBuildTileId(t){ return isPlayerBuiltMaterial(t) && !isDoorTile(t) && !isTrapdoorTile(t) && !!TILE_TO_RES[t]; }
function getNetworkTile(x,y){ return (WORLD && WORLD.getNetworkTile) ? WORLD.getNetworkTile(x,y) : getTile(x,y); }
function getElectricNetworkTile(x,y){ return hasInfrastructureTile(x,y,T.COPPER_WIRE) ? T.COPPER_WIRE : (getNetworkTile(x,y)===T.COPPER_WIRE ? T.COPPER_WIRE : getTile(x,y)); }
function getFluidNetworkTile(x,y){ return hasInfrastructureTile(x,y,T.WATER_PIPE) ? T.WATER_PIPE : (getNetworkTile(x,y)===T.WATER_PIPE ? T.WATER_PIPE : getTile(x,y)); }
function isInfrastructureTileId(t){ return !!(WORLD && WORLD.isInfrastructureTile && WORLD.isInfrastructureTile(t)); }
function getRenderInfrastructureTiles(x,y){
	const overs=getInfrastructureTiles(x,y);
	if(overs.length) return overs.slice().sort((a,b)=>{
		const rank=t=> t===T.WATER_PIPE ? 1 : (t===T.COPPER_WIRE ? 2 : (t===T.LADDER ? 3 : 0));
		return rank(a)-rank(b);
	});
	const base=getTile(x,y);
	return isInfrastructureTileId(base) ? [base] : [];
}
function getRenderInfrastructureTile(x,y){
	const list=getRenderInfrastructureTiles(x,y);
	return list.length ? list[list.length-1] : T.AIR;
}
function setTile(x,y,v){
	// render-dirty marking + border invalidation ride on MM.onTileRenderChanged,
	// which world.js fires for every real change regardless of the caller
	WORLD.setTile(x,y,v);
}
// world.js invokes this after every non-transient tile change AND its version
// bump — including engines that call world.setTile directly (plants, trees,
// seasons). Recording the dirty band here keeps chunk-cache redraws partial;
// before this hook those paths only bumped the version, forcing full-section
// rebakes (the dominant frame cost whenever water/rain/growth was active).
MM.onTileRenderChanged=function(tx,ty,old,next){
	if(window.__mmNoRenderHook) return;
	if(!Number.isFinite(tx) || !Number.isFinite(ty) || !worldYInBounds(ty)) return;
	tx=Math.floor(tx); ty=Math.floor(ty);
	noteRespawnTotemTileChanged(tx,ty,old,next);
	noteHealingShelterTileChanged(tx,ty);
	noteTileBuriesHero(tx,ty,next);
	if(LIGHTING && LIGHTING.onTileChanged) LIGHTING.onTileChanged(tx,ty);
	const cx=Math.floor(tx/CHUNK_W), sy=worldSectionY(ty);
	const after=(WORLD && WORLD.chunkVersion) ? WORLD.chunkVersion(cx,sy) : undefined;
	markChunkRenderDirty(cx,ty,2,Number.isFinite(after)?after-1:undefined,after);
	if(window.__mmNoSibling) return;
	markSiblingBaseSectionVersion(cx,sy,after);
	if(edgeRenderSignature(old)!==edgeRenderSignature(next)) invalidateAdjacentRenderCaches(tx,ty,cx,sy);
};
// The two base sections (sy 0 and 1) share a single world-version key, so an
// edit in one bumps the other's version with no changed pixels. Record that as
// an empty, version-only dirty band — the renderer then adopts the new version
// without repainting instead of full-rebaking the sibling on every water tick.
function markSiblingBaseSectionVersion(cx,sy,after){
	const sibling = sy===0 ? 1 : (sy===1 ? 0 : null);
	if(sibling===null || !Number.isFinite(after) || typeof chunkCanvases==='undefined') return;
	const key=worldRenderSectionKey(cx,sibling);
	const e=chunkCanvases.get(key);
	if(!e || e.version<0) return;
	let d=chunkRenderDirty.get(key);
	if(!d){
		d={min:worldSectionHeight(),max:-1,baseVersion:e.version,version:after,full:false};
		chunkRenderDirty.set(key,d);
	}else d.version=after;
}
// How a tile looks to a NEIGHBOR's edge-lighting pass: universally open (air and
// water are interchangeable there — critical, since the water sim moves tiles via
// setTile every tick and must never trigger neighbor rebakes), lava (ember rims),
// family-gated passables (leaves etc.), or an opaque wall. Only transitions that
// change this signature can alter a neighbor's baked pixels.
function edgeRenderSignature(t){
	if(t===T.AIR || t===T.WATER) return 1;
	if(t===T.LAVA) return 2;
	const inf=INFO[t];
	if(inf && inf.passable) return 16+tileEdgeFamily(t);
	return 0;
}
// Edge lighting reads across chunk/section borders, so a border tile change must
// refresh the neighboring cached canvas. Marked as edgeStale + a partial dirty
// band: the rebake goes through the normal per-frame budget (stale pixels stay
// visible meanwhile) instead of forcing unbudgeted full redraws every frame.
function invalidateAdjacentRenderCaches(tx,ty,cx,sy){
	if(typeof chunkCanvases==='undefined') return;
	const markStale=(ncx,dirtyY)=>{
		const nsy=worldSectionY(dirtyY);
		const e=chunkCanvases.get(worldRenderSectionKey(ncx,nsy));
		if(!e || e.version<0) return;
		e.edgeStale=true;
		// nextVersion must be the key's CURRENT version: the neighbor may have pending
		// dirty bands ahead of its canvas (e.version), and rewinding dirty.version to
		// the canvas version breaks the partial-redraw check, forcing a full rebake
		const cur=(WORLD && WORLD.chunkVersion) ? WORLD.chunkVersion(ncx,nsy) : e.version;
		markChunkRenderDirty(ncx,dirtyY,2,e.version,Math.max(cur,e.version));
	};
	const lx=((tx%CHUNK_W)+CHUNK_W)%CHUNK_W;
	if(lx===0) markStale(cx-1,ty);
	if(lx===CHUNK_W-1) markStale(cx+1,ty);
	const ly=worldSectionLocalY(ty,sy);
	if(ly===0 && sy-1>=worldMinSection()) markStale(cx,ty-1);
	if(ly===worldSectionHeight()-1 && sy+1<=worldMaxSection()) markStale(cx,ty+1);
}
setTile.transient = function(x,y,v){
	if(WORLD && typeof WORLD.setTransientTile==='function') WORLD.setTransientTile(x,y,v);
	else WORLD.setTile(x,y,v);
};
if(FALLING && FALLING.init) FALLING.init(getTile,setTile);

// --- Gracz / inwentarz ---
const player={x:0,y:0,w:0.7,h:0.95,vx:0,vy:0,onGround:false,facing:1,tool:'basic',jumpCount:0,maxHp:100,hp:100,hpInvul:0,hurtFlashUntil:0,atkCd:0,xp:0,energy:0,maxEnergy:0};
const HURT_FLASH_MS=520;
const HERO_ENERGY_BASE=40;
const HERO_ENERGY_PER_LEVEL=8;
const TURBO_SPEED_MULT=1.5;
const TURBO_JUMP_MULT=1.5;
const TURBO_ENERGY_PER_SEC=8;
const TURBO_MIN_ENERGY=0.03;
const HERO_SOLAR_ENERGY_PER_SEC=1;
const HERO_SOLAR_CAP_FRAC=0.25;
const WATER_MOVE_SPEED_BASE=0.5;
const WATER_MOVE_SPEED_MIN=0.25;
const WATER_MOVE_SPEED_MAX=1.25;
const DEFEND_ABSORB_FRACTION=0.25;
const DEFEND_TAP_GRACE_MS=700;
const DEFEND_RELEASE_GRACE_MS=220;
const DEFEND_MESSAGE_COOLDOWN_MS=900;
const HERO_DEFENSE_BYPASS_CAUSES=new Set(['crushed','drowning','lava','underwater_energy','water_chill','water_pressure']);
function heroWaterMoveSpeedMult(){
	const raw=MM.activeModifiers && typeof MM.activeModifiers.waterMoveSpeedMult==='number' ? MM.activeModifiers.waterMoveSpeedMult : WATER_MOVE_SPEED_BASE;
	const value=Number.isFinite(raw) ? raw : WATER_MOVE_SPEED_BASE;
	return Math.max(WATER_MOVE_SPEED_MIN, Math.min(WATER_MOVE_SPEED_MAX, value));
}
let energyChargeFx={t:0,intensity:0,source:null,flash:0};
let energyFxEmitT=0;
let heroEnergyDeltaAcc=0;
let turboFx=0, turboSparkT=0;
let turboRechargePauseT=0;
let underwaterEnergyShockMsgAt=0;
let heroDefendPointerId=null;
let heroDefendHeld=false;
let heroDefendUntil=0;
let heroDefendFlashUntil=0;
let heroDefendMsgAt=0;
let heroJoyUntil=0;
let heroCombatJoyUntil=0;
let heroPainUntil=0;
let heroBodyRecoilFx={t:999,life:0,dir:0,power:0,kind:''};
let combatScreenShakeFx={t:999,life:0,power:0,seed:0,dir:0};
let heroCriticalHurtFx={t:999,life:0,power:0,element:''};
let _lastEnergySaveAt=0;
let waterDamageFx=0, waterDamageDropT=0;
let waterPressureFx=0, waterPressureCriticalFx=0;
const worldNumbers=[];
const combatImpactFx=[];
function worldNumberIconFor(kind,cause,element){
	const raw=String(element||cause||kind||'').toLowerCase();
	if(kind==='xp' || raw.includes('xp')) return 'xp';
	if(kind==='skill') return 'skill';
	if(kind==='home') return 'heart';
	if(kind==='heal') return 'heal';
	if(kind==='energy') return 'energy';
	if(kind==='pressure' || raw.includes('pressure')) return 'pressure';
	if(raw.includes('water') || raw.includes('drown') || raw.includes('hose')) return 'water';
	if(raw.includes('electric') || raw.includes('shock') || raw.includes('lightning') || raw.includes('laser')) return 'electric';
	if(raw.includes('fire') || raw.includes('flame') || raw.includes('burn') || raw.includes('heat') || raw.includes('lava')) return 'fire';
	if(raw.includes('ice') || raw.includes('frost') || raw.includes('chill') || raw.includes('cold')) return 'ice';
	if(raw.includes('gas') || raw.includes('poison') || raw.includes('toxic')) return 'gas';
	if(raw.includes('blast') || raw.includes('explosion') || raw.includes('meteor')) return 'blast';
	return '';
}
function drawWorldNumberIcon(icon,color,alpha){
	if(!icon) return;
	const a=Math.max(0,Math.min(1,alpha==null?1:alpha));
	ctx.save();
	ctx.globalAlpha*=a;
	ctx.lineCap='round';
	ctx.lineJoin='round';
	ctx.strokeStyle='rgba(6,8,12,0.42)';
	ctx.lineWidth=2;
	ctx.fillStyle=color;
	if(icon==='water' || icon==='pressure'){
		ctx.beginPath();
		ctx.moveTo(0,-7);
		ctx.bezierCurveTo(6,-1,5,7,0,8);
		ctx.bezierCurveTo(-5,7,-6,-1,0,-7);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		if(icon==='pressure'){
			ctx.strokeStyle='rgba(230,248,255,0.78)';
			ctx.lineWidth=1.3;
			ctx.beginPath();
			ctx.moveTo(-5,-1);
			ctx.lineTo(5,-1);
			ctx.moveTo(-4,3);
			ctx.lineTo(4,3);
			ctx.stroke();
		}
	} else if(icon==='fire'){
		ctx.beginPath();
		ctx.moveTo(0,8);
		ctx.bezierCurveTo(-7,2,-2,-4,-1,-9);
		ctx.bezierCurveTo(2,-5,8,-1,4,8);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle='rgba(255,246,160,0.82)';
		ctx.beginPath();
		ctx.moveTo(0,6);
		ctx.bezierCurveTo(-3,2,0,-2,1,-5);
		ctx.bezierCurveTo(4,-1,4,3,0,6);
		ctx.fill();
	} else if(icon==='electric' || icon==='energy'){
		ctx.beginPath();
		ctx.moveTo(2,-8);
		ctx.lineTo(-4,1);
		ctx.lineTo(1,1);
		ctx.lineTo(-2,9);
		ctx.lineTo(6,-2);
		ctx.lineTo(1,-2);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
	} else if(icon==='ice'){
		ctx.beginPath();
		for(let i=0;i<6;i++){
			const ang=i*Math.PI/3-Math.PI/2;
			const r=i%2?4.3:8;
			const px=Math.cos(ang)*r, py=Math.sin(ang)*r;
			if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
		}
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
	} else if(icon==='gas'){
		ctx.strokeStyle=color;
		ctx.lineWidth=2.2;
		for(let i=0;i<3;i++){
			ctx.beginPath();
			ctx.arc((i-1)*4,Math.sin(i)*2,3.8,0,Math.PI*2);
			ctx.stroke();
		}
	} else if(icon==='defend'){
		ctx.beginPath();
		ctx.moveTo(0,-8);
		ctx.lineTo(7,-5);
		ctx.lineTo(5,4);
		ctx.quadraticCurveTo(0,8,-5,4);
		ctx.lineTo(-7,-5);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
	} else if(icon==='finish' || icon==='lucky' || icon==='skill'){
		ctx.beginPath();
		for(let i=0;i<10;i++){
			const ang=i*Math.PI/5-Math.PI/2;
			const r=i%2?3.6:8;
			const px=Math.cos(ang)*r, py=Math.sin(ang)*r;
			if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
		}
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
	} else if(icon==='xp'){
		ctx.beginPath();
		ctx.moveTo(0,-8);
		ctx.lineTo(7,0);
		ctx.lineTo(0,8);
		ctx.lineTo(-7,0);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
	} else if(icon==='heart' || icon==='brokenHeart'){
		if(icon==='brokenHeart'){
			ctx.save();
			ctx.translate(0,0);
			ctx.beginPath();
			ctx.moveTo(0,8);
			ctx.bezierCurveTo(-12,0,-8,-10,-1,-6);
			ctx.lineTo(0,-3);
			ctx.lineTo(2,-7);
			ctx.bezierCurveTo(9,-10,12,0,0,8);
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
			ctx.strokeStyle='rgba(255,245,250,0.82)';
			ctx.lineWidth=1.4;
			ctx.beginPath();
			ctx.moveTo(-1,-6);
			ctx.lineTo(2,-2);
			ctx.lineTo(-1,1);
			ctx.lineTo(2,5);
			ctx.stroke();
			ctx.restore();
		} else {
			ctx.beginPath();
			ctx.moveTo(0,8);
			ctx.bezierCurveTo(-13,0,-8,-11,0,-5);
			ctx.bezierCurveTo(8,-11,13,0,0,8);
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
			ctx.fillStyle='rgba(255,255,255,0.42)';
			ctx.beginPath();
			ctx.arc(-3,-3,2.2,0,Math.PI*2);
			ctx.fill();
		}
	} else if(icon==='heal'){
		ctx.fillRect(-2,-8,4,16);
		ctx.fillRect(-8,-2,16,4);
		ctx.strokeRect(-2,-8,4,16);
		ctx.strokeRect(-8,-2,16,4);
	} else {
		ctx.beginPath();
		ctx.arc(0,0,6.5,0,Math.PI*2);
		ctx.fill();
		ctx.stroke();
	}
	ctx.restore();
}
function pushWorldNumber(detail){
	detail=detail||{};
	const amount=Number(detail.amount);
	const kind=String(detail.kind||'info');
	if(kind!=='damage' && kind!=='heal' && kind!=='xp' && kind!=='energy' && kind!=='home') return null;
	const hasAmount=kind!=='home' && Number.isFinite(amount) && Math.round(amount)!==0;
	const icon=String(detail.icon||worldNumberIconFor(kind,detail.cause,detail.element)||'');
	const now=performance.now();
	let text=kind==='home' ? '' : (detail.text!=null ? String(detail.text) : '');
	if(!text && hasAmount){
		const v=Math.round(amount);
		if(kind==='xp') text='+'+Math.max(0,v);
		else text=(v>0?'+':'')+v;
	}
	if(!text && !icon) return null;
	const x=Number.isFinite(Number(detail.x)) ? Number(detail.x) : player.x;
	const y=Number.isFinite(Number(detail.y)) ? Number(detail.y) : player.y-player.h*0.85;
	const target=String(detail.target||kind);
	const last=worldNumbers[worldNumbers.length-1];
	if(last && now-last.born<230 && last.kind===kind && last.target===target && Math.abs(last.x-x)<0.8 && Math.abs(last.y-y)<1.2 && Number.isFinite(last.amount) && hasAmount){
		last.amount+=Math.round(amount);
		const v=Math.round(last.amount);
		last.text=kind==='xp' ? ('+'+Math.max(0,v)) : ((v>0?'+':'')+v);
		last.born=now;
		if(icon) last.icon=icon;
		if(detail.special) last.special=true;
		last.life=Math.max(last.life,kind==='xp'?1450:(kind==='home'?1550:(kind==='heal'?1180:1050)));
		return last;
	}
	const n={
		text,
		amount:hasAmount?Math.round(amount):NaN,
		kind,
		icon,
		cause:detail.cause,
		special:!!detail.special,
		target,
		x,
		y,
		born:now,
		life:kind==='xp'?1450:(kind==='home'?1550:(kind==='heal'?1180:1050)),
		jitter:(Math.random()-0.5)*0.26
	};
	worldNumbers.push(n);
	if(worldNumbers.length>48) worldNumbers.splice(0,worldNumbers.length-48);
	return n;
}
function drawWorldNumbers(){
	if(!worldNumbers.length) return;
	const now=performance.now();
	ctx.save();
	ctx.textAlign='center';
	ctx.textBaseline='middle';
	for(let i=worldNumbers.length-1;i>=0;i--){
		const n=worldNumbers[i];
		const age=now-n.born;
		if(age>n.life){ worldNumbers.splice(i,1); continue; }
		const k=Math.max(0,Math.min(1,age/n.life));
		const alpha=k<0.12?k/0.12:1-Math.max(0,(k-0.62)/0.38);
		const lift=(0.18+k*1.18+(n.kind==='xp'?0.25:0))*TILE;
		const x=(n.x+n.jitter)*TILE;
		const y=n.y*TILE-lift;
		const scale=1+(1-k)*0.10;
		ctx.save();
		ctx.globalAlpha=Math.max(0,Math.min(1,alpha));
		ctx.translate(x,y);
		ctx.scale(scale,scale);
		ctx.font=(n.kind==='xp'?'800 13px ':'800 12px ')+'system-ui, "Segoe UI", sans-serif';
		let color='#ff7d72';
		if(n.kind==='home') color=n.icon==='brokenHeart' ? '#ff6f91' : '#ff83aa';
		else if(n.kind==='heal') color='#7dff9a';
		else if(n.kind==='energy') color='#ffd66b';
		else if(n.kind==='xp') color=n.special ? '#ffd54a' : '#7dff9a';
		const hasIcon=!!n.icon;
		const hasText=!!n.text;
		if(hasIcon){
			const tw=hasText ? ctx.measureText(n.text).width : 0;
			const ix=hasText ? -tw*0.5-9 : 0;
			ctx.save();
			ctx.translate(ix,0);
			drawWorldNumberIcon(n.icon,color,0.95);
			ctx.restore();
			if(hasText) ctx.translate(5,0);
		}
		if(hasText){
			ctx.lineWidth=n.kind==='xp'?2.4:2.15;
			ctx.strokeStyle='rgba(4,6,10,0.46)';
			ctx.strokeText(n.text,0,0);
			ctx.fillStyle=color;
			ctx.fillText(n.text,0,0);
		}
		ctx.restore();
	}
	ctx.restore();
}
function combatFinite(v,fallback){
	const n=Number(v);
	return Number.isFinite(n) ? n : fallback;
}
function combatElementFromDetail(detail){
	const raw=String((detail && (detail.element || detail.cause || detail.kind || detail.type || detail.weaponType)) || '').toLowerCase();
	if(raw.includes('fire') || raw.includes('flame') || raw.includes('burn') || raw.includes('heat') || raw.includes('lava')) return 'fire';
	if(raw.includes('electric') || raw.includes('shock') || raw.includes('lightning') || raw.includes('laser')) return 'electric';
	if(raw.includes('water') || raw.includes('hose') || raw.includes('drown') || raw.includes('pressure')) return 'water';
	if(raw.includes('ice') || raw.includes('frost') || raw.includes('chill') || raw.includes('cold')) return 'ice';
	if(raw.includes('gas') || raw.includes('poison') || raw.includes('toxic')) return 'gas';
	if(raw.includes('explosion') || raw.includes('blast') || raw.includes('meteor')) return 'blast';
	return '';
}
function combatPalette(element,kind){
	const e=String(element||'').toLowerCase();
	const k=String(kind||'').toLowerCase();
	if(k==='lucky' || k==='crit') return {ring:'rgba(255,216,74,',core:'rgba(255,246,166,',slash:'rgba(255,143,64,',text:'crit'};
	if(e==='fire') return {ring:'rgba(255,124,48,',core:'rgba(255,232,128,',slash:'rgba(255,75,42,',text:'element'};
	if(e==='electric') return {ring:'rgba(112,246,255,',core:'rgba(236,255,255,',slash:'rgba(79,138,255,',text:'element'};
	if(e==='water') return {ring:'rgba(116,213,255,',core:'rgba(226,250,255,',slash:'rgba(76,137,255,',text:'element'};
	if(e==='ice') return {ring:'rgba(192,244,255,',core:'rgba(248,255,255,',slash:'rgba(132,186,255,',text:'element'};
	if(e==='gas') return {ring:'rgba(150,244,112,',core:'rgba(232,255,142,',slash:'rgba(66,184,88,',text:'element'};
	if(e==='blast') return {ring:'rgba(255,190,92,',core:'rgba(255,241,180,',slash:'rgba(255,93,75,',text:'special'};
	if(k==='defend') return {ring:'rgba(116,240,255,',core:'rgba(255,248,166,',slash:'rgba(94,156,255,',text:'special'};
	if(k==='special') return {ring:'rgba(255,222,92,',core:'rgba(255,250,190,',slash:'rgba(255,138,54,',text:'special'};
	return {ring:'rgba(255,226,170,',core:'rgba(255,250,224,',slash:'rgba(218,148,78,',text:'special'};
}
function triggerHeroBodyRecoil(kind,dir,power){
	const p=Math.max(0.35,Math.min(2.4,Number(power)||1));
	heroBodyRecoilFx={
		t:0,
		life:kind==='hurt' ? 0.30+Math.min(0.12,p*0.04) : 0.24,
		dir:dir>=0?1:-1,
		power:p,
		kind
	};
}
function noteCombatScreenShake(power,dir){
	const p=Math.max(0,Math.min(2.2,Number(power)||0));
	if(p<=0.05) return;
	const keep=(combatScreenShakeFx.life-combatScreenShakeFx.t)>0 && combatScreenShakeFx.power>p*0.75;
	if(keep) return;
	combatScreenShakeFx={
		t:0,
		life:0.16+Math.min(0.16,p*0.055),
		power:p,
		seed:Math.random()*1000+performance.now()*0.017,
		dir:dir>=0?1:-1
	};
}
function combatScreenShakeOffset(now){
	if(!(combatScreenShakeFx.t<combatScreenShakeFx.life)) return null;
	const life=Math.max(0.001,combatScreenShakeFx.life);
	const k=Math.max(0,Math.min(1,1-combatScreenShakeFx.t/life));
	const amp=Math.min(10,TILE*(0.045+0.028*combatScreenShakeFx.power))*k*k;
	const seed=combatScreenShakeFx.seed||0;
	return {
		x:(Math.sin(now*0.066+seed)+Math.sin(now*0.041+seed*1.7)*0.55)*amp*(combatScreenShakeFx.dir||1),
		y:(Math.cos(now*0.073+seed*0.8)+Math.sin(now*0.049+seed*2.1)*0.45)*amp*0.62
	};
}
function combineScreenShakes(a,b){
	if(a && b) return {x:(a.x||0)+(b.x||0), y:(a.y||0)+(b.y||0)};
	return a || b || null;
}
function heroBodyRecoilVisual(){
	if(!(heroBodyRecoilFx.t<heroBodyRecoilFx.life)) return null;
	const life=Math.max(0.001,heroBodyRecoilFx.life);
	const u=Math.max(0,Math.min(1,heroBodyRecoilFx.t/life));
	const kick=Math.sin(u*Math.PI)*Math.pow(1-u,0.35);
	const p=Math.max(0.25,Math.min(2.2,heroBodyRecoilFx.power||1));
	const hurt=heroBodyRecoilFx.kind==='hurt';
	const dir=(heroBodyRecoilFx.dir||1)>=0?1:-1;
	return {
		ox:dir*TILE*(hurt?0.060:0.038)*p*kick,
		oy:-TILE*(hurt?0.020:0.032)*p*kick,
		sx:1+(hurt?0.052:-0.020)*Math.min(1.2,p)*kick,
		sy:1+(hurt?-0.040:0.032)*Math.min(1.2,p)*kick
	};
}
function triggerHeroCriticalHurtFx(power,element){
	heroCriticalHurtFx={
		t:0,
		life:0.42,
		power:Math.max(0.45,Math.min(2.2,Number(power)||1)),
		element:String(element||'')
	};
}
function triggerCombatFeedback(detail){
	detail=detail||{};
	const now=performance.now();
	const kind=String(detail.kind||'impact');
	const target=String(detail.target||'');
	const source=String(detail.source||'');
	const element=combatElementFromDetail(detail);
	const amount=Math.abs(Number(detail.amount)||0);
	const x=combatFinite(detail.x, target==='hero'?player.x:player.x+(player.facing||1)*0.9);
	const y=combatFinite(detail.y, target==='hero'?player.y-player.h*0.28:player.y-player.h*0.65);
	const bonusPct=Number.isFinite(Number(detail.bonusDamagePct)) ? Math.max(0,Number(detail.bonusDamagePct)) : 0;
	const major=!!(detail.major || detail.lucky || detail.critical || detail.finisher || bonusPct>0 || amount>=Math.max(8,player.maxHp*0.10));
	const power=Math.max(0.55,Math.min(2.5,Number(detail.power)||((major?1.25:0.85)+Math.min(0.9,amount/22))));
	const fxKey=source+'|'+kind+'|'+element;
	const dir=combatFinite(detail.dir, target==='hero' && combatFinite(detail.srcX,NaN)<player.x ? 1 : (target==='hero'?-1:(x>=player.x?1:-1)));
	for(let i=combatImpactFx.length-1;i>=0;i--){
		const fx=combatImpactFx[i];
		if(now-fx.born>140) break;
		if(fx.key===fxKey && Math.hypot(fx.x-x,fx.y-y)<0.55) return false;
	}
	const defendedBlock=kind==='defend' || !!detail.defendedBlock;
	if(target==='hero'){
		if(defendedBlock){
			heroDefendFlashUntil=Math.max(heroDefendFlashUntil,now+360);
			triggerHeroBodyRecoil('strike',-dir,Math.min(1.15,power));
			noteCombatScreenShake(major?0.72:0.42,dir);
		} else {
			heroPainUntil=Math.max(heroPainUntil,now+(major?980:620));
			triggerHeroBodyRecoil('hurt',dir,power);
			noteCombatScreenShake(major?Math.max(0.85,power):0.58,dir);
			if(major) triggerHeroCriticalHurtFx(power,element);
		}
	} else if(source==='hero' || detail.hero || detail.special || detail.lucky){
		heroCombatJoyUntil=Math.max(heroCombatJoyUntil,now+(detail.finisher?1450:(detail.lucky?1350:(major?980:760))));
		if(major || bonusPct>0 || detail.special || detail.lucky) triggerHeroBodyRecoil('strike',x>=player.x?1:-1,Math.min(1.5,power));
		if(detail.lucky || detail.special || bonusPct>0 || detail.finisher) noteCombatScreenShake(detail.lucky?1.1:(detail.finisher?1.0:(bonusPct>0?0.88:0.66)),x>=player.x?1:-1);
	}
	const palette=combatPalette(element,kind);
	combatImpactFx.push({
		x,y,kind,element,target,key:fxKey,palette,
		born:now,t:0,life:major?0.56:0.38,
		power,major,bonusPct,dir,
		finisher:!!detail.finisher,
		lucky:!!detail.lucky,
		special:!!detail.special
	});
	if(combatImpactFx.length>36) combatImpactFx.splice(0,combatImpactFx.length-36);
	try{
		if(PARTICLES && PARTICLES.spawnImpactChips){
			PARTICLES.spawnImpactChips(x*TILE,y*TILE,{element:element || kind,kind,major,lucky:!!detail.lucky,critical:!!detail.critical,power,dir:x>=player.x?1:-1});
		}
		if(PARTICLES && PARTICLES.spawnSparks && (element==='electric' || detail.lucky)){
			PARTICLES.spawnSparks(x*TILE,y*TILE,element==='electric'?'electric':'rare',detail.lucky?8:5);
		}
		if(PARTICLES && PARTICLES.spawnSparks && detail.finisher){
			PARTICLES.spawnSparks(x*TILE,y*TILE,detail.lucky?'epic':'rare',detail.lucky?8:5);
		}
	}catch(e){}
	return true;
}
function updateCombatImpactFx(dt){
	for(let i=combatImpactFx.length-1;i>=0;i--){
		const fx=combatImpactFx[i];
		fx.t+=Math.max(0,Math.min(0.08,dt||0));
		if(fx.t>fx.life) combatImpactFx.splice(i,1);
	}
	if(heroBodyRecoilFx.t<heroBodyRecoilFx.life) heroBodyRecoilFx.t+=Math.max(0,Math.min(0.08,dt||0));
	if(combatScreenShakeFx.t<combatScreenShakeFx.life) combatScreenShakeFx.t+=Math.max(0,Math.min(0.08,dt||0));
	if(heroCriticalHurtFx.t<heroCriticalHurtFx.life) heroCriticalHurtFx.t+=Math.max(0,Math.min(0.08,dt||0));
}
function drawCombatImpactFx(){
	if(!combatImpactFx.length) return;
	ctx.save();
	ctx.lineCap='round';
	for(let i=0;i<combatImpactFx.length;i++){
		const fx=combatImpactFx[i];
		if(typeof worldFxVisible==='function' && !worldFxVisible(Math.floor(fx.x),Math.floor(fx.y))) continue;
		const k=Math.max(0,Math.min(1,fx.t/fx.life));
		const alpha=(k<0.16?k/0.16:1-Math.max(0,(k-0.58)/0.42));
		if(alpha<=0) continue;
		const cx=fx.x*TILE, cy=fx.y*TILE;
		const p=fx.power||1;
		const r=TILE*(0.20+p*0.10+k*(0.42+p*0.14));
		const ring=fx.palette && fx.palette.ring ? fx.palette.ring : 'rgba(255,226,170,';
		const core=fx.palette && fx.palette.core ? fx.palette.core : 'rgba(255,250,224,';
		const slash=fx.palette && fx.palette.slash ? fx.palette.slash : 'rgba(218,148,78,';
		ctx.save();
		ctx.globalCompositeOperation='lighter';
		ctx.globalAlpha=Math.max(0,Math.min(1,alpha));
		ctx.strokeStyle=ring+(0.65*alpha).toFixed(3)+')';
		ctx.lineWidth=Math.max(1,TILE*(fx.major?0.075:0.052)*(1-k*0.35));
		ctx.beginPath();
		ctx.arc(cx,cy,r,0,Math.PI*2);
		ctx.stroke();
		ctx.fillStyle=core+(0.20*alpha*(1-k)).toFixed(3)+')';
		ctx.beginPath();
		ctx.arc(cx,cy,TILE*(0.18+p*0.08)*(1+0.35*Math.sin(k*Math.PI)),0,Math.PI*2);
		ctx.fill();
		ctx.strokeStyle=slash+(0.84*alpha).toFixed(3)+')';
		ctx.lineWidth=Math.max(1.2,TILE*(fx.major?0.070:0.050));
		const dir=(fx.dir||1)>=0?1:-1;
		for(let s=0;s<(fx.major?3:2);s++){
			const off=(s-1)*TILE*0.15;
			const a=-0.82*dir + (s-1)*0.18;
			const len=TILE*(0.35+p*0.18)*(1-k*0.28);
			ctx.beginPath();
			ctx.moveTo(cx-Math.cos(a)*len*0.55,cy-Math.sin(a)*len*0.40+off);
			ctx.lineTo(cx+Math.cos(a)*len*0.58,cy+Math.sin(a)*len*0.46-off*0.2);
			ctx.stroke();
		}
		if(fx.element==='fire' || fx.element==='electric'){
			ctx.strokeStyle=core+(0.58*alpha).toFixed(3)+')';
			ctx.lineWidth=Math.max(1,TILE*0.035);
			for(let j=0;j<3;j++){
				const a=j*Math.PI*2/3 + k*1.7*(fx.element==='electric'?-1:1);
				ctx.beginPath();
				ctx.moveTo(cx+Math.cos(a)*r*0.25,cy+Math.sin(a)*r*0.25);
				ctx.lineTo(cx+Math.cos(a)*r*0.92,cy+Math.sin(a)*r*0.92);
				ctx.stroke();
			}
		}
		if(fx.bonusPct>0){
			const bonusAlpha=alpha*(1-Math.min(1,k*0.85));
			ctx.strokeStyle=core+(0.72*bonusAlpha).toFixed(3)+')';
			ctx.lineWidth=Math.max(1,TILE*0.035);
			for(let j=0;j<2;j++){
				const rr=r*(0.72+j*0.32)+TILE*0.08*Math.sin(k*Math.PI);
				ctx.beginPath();
				ctx.arc(cx,cy,rr,Math.PI*0.12+j*0.55+k*0.9,Math.PI*1.35+j*0.55+k*0.9);
				ctx.stroke();
			}
			ctx.fillStyle=slash+(0.24*bonusAlpha).toFixed(3)+')';
			ctx.beginPath();
			ctx.ellipse(cx,cy+TILE*0.05,TILE*(0.26+0.12*fx.power),TILE*(0.08+0.05*fx.power),0,0,Math.PI*2);
			ctx.fill();
		}
		if(fx.finisher){
			const finishAlpha=alpha*(1-Math.min(1,k*0.72));
			const finishR=r+TILE*(0.22+0.40*k);
			ctx.strokeStyle='rgba(255,229,92,'+(0.70*finishAlpha).toFixed(3)+')';
			ctx.lineWidth=Math.max(1,TILE*0.050*(1-k*0.25));
			for(let j=0;j<2;j++){
				ctx.beginPath();
				ctx.arc(cx,cy,finishR+TILE*j*0.16,Math.PI*(0.05+j*0.12)+k*1.7,Math.PI*(1.42+j*0.12)+k*1.7);
				ctx.stroke();
			}
			ctx.fillStyle='rgba(255,246,166,'+(0.72*finishAlpha).toFixed(3)+')';
			for(let j=0;j<6;j++){
				const a=j*Math.PI*2/6 + k*1.8;
				const rr=finishR*(0.72+0.18*Math.sin(j+k*Math.PI));
				const s=TILE*(0.045+0.012*((j+1)%3));
				ctx.save();
				ctx.translate(cx+Math.cos(a)*rr,cy+Math.sin(a)*rr);
				ctx.rotate(a+k*Math.PI);
				ctx.fillRect(-s*0.5,-s*0.5,s,s);
				ctx.restore();
			}
		}
		if(fx.target==='hero' && fx.major){
			ctx.strokeStyle='rgba(255,106,126,'+(0.46*alpha).toFixed(3)+')';
			ctx.lineWidth=Math.max(1,TILE*0.045);
			const rr=TILE*(0.36+0.24*k+0.06*fx.power);
			ctx.beginPath();
			ctx.arc(cx,cy,rr,-Math.PI*0.82,-Math.PI*0.18);
			ctx.arc(cx,cy,rr,Math.PI*0.18,Math.PI*0.82);
			ctx.stroke();
		}
		ctx.restore();
	}
	ctx.restore();
}
function drawCombatScreenFx(){
	if(!(heroCriticalHurtFx.t<heroCriticalHurtFx.life)) return;
	const life=Math.max(0.001,heroCriticalHurtFx.life);
	const k=Math.max(0,Math.min(1,heroCriticalHurtFx.t/life));
	const pulse=Math.sin(k*Math.PI);
	const a=Math.pow(1-k,1.35)*(0.20+0.16*Math.min(1.4,heroCriticalHurtFx.power||1));
	const element=String(heroCriticalHurtFx.element||'');
	const edge=element==='electric' ? 'rgba(112,246,255,' : (element==='water' ? 'rgba(126,210,255,' : 'rgba(255,76,92,');
	ctx.save();
	ctx.globalCompositeOperation='source-over';
	const grd=ctx.createRadialGradient(W*0.5,H*0.52,Math.min(W,H)*0.18,W*0.5,H*0.52,Math.max(W,H)*0.72);
	grd.addColorStop(0,'rgba(255,255,255,0)');
	grd.addColorStop(0.58,'rgba(255,255,255,0)');
	grd.addColorStop(1,edge+a.toFixed(3)+')');
	ctx.fillStyle=grd;
	ctx.fillRect(0,0,W,H);
	ctx.globalCompositeOperation='lighter';
	ctx.strokeStyle=edge+(0.34*pulse).toFixed(3)+')';
	ctx.lineWidth=Math.max(1,Math.min(6,2+heroCriticalHurtFx.power*1.4));
	ctx.beginPath();
	ctx.moveTo(W*0.12,H*0.18);
	ctx.lineTo(W*0.24,H*0.12);
	ctx.moveTo(W*0.88,H*0.82);
	ctx.lineTo(W*0.76,H*0.88);
	ctx.stroke();
	ctx.restore();
}
function healHero(amount, source){
	const n=Math.max(0,Number(amount)||0);
	if(n<=0) return 0;
	const before=player.hp;
	player.hp=Math.min(player.maxHp, player.hp+n);
	const delta=player.hp-before;
	if(delta>0){
		pushWorldNumber({kind:'heal',amount:delta,x:player.x,y:player.y-player.h*0.72,target:'hero',source});
		notifyInvasionHeroAction('hero_heal',{amount:delta,source:source||'heal'});
	}
	return delta;
}
function waterDamageCause(cause){
	return cause==='drowning' || cause==='water_chill' || cause==='underwater_energy' || cause==='water_pressure';
}
function triggerWaterDamageDistress(cause,amount){
	if(!waterDamageCause(cause)) return;
	const k=Math.max(0.28,Math.min(1.35,(Number(amount)||1)/16));
	waterDamageFx=Math.max(waterDamageFx,k);
	if(cause==='water_pressure'){
		waterPressureFx=Math.max(waterPressureFx,0.55);
		waterPressureCriticalFx=Math.max(waterPressureCriticalFx,k>0.9?0.7:0.25);
	}
	if(PARTICLES){
		const px=player.x*TILE, py=(player.y-player.h*0.26)*TILE;
		try{
			if(cause==='water_pressure' && PARTICLES.spawnBubble){
				for(let i=0;i<4;i++) PARTICLES.spawnBubble(px+(Math.random()-0.5)*TILE*0.7,py+(Math.random()-0.5)*TILE*0.9);
			} else if(PARTICLES.spawnSplash){
				PARTICLES.spawnSplash(px,py,Math.min(1,k));
			}
		}catch(e){}
	}
}
function updateWaterDistressFx(dt,inWater,pressure){
	const targetPressure=pressure && pressure.stack>0 && pressure.capacity>0
		? Math.max(0,Math.min(1.4,((pressure.load/Math.max(0.1,pressure.capacity))-0.58)/0.62 + Math.max(0,pressure.excess)*0.045))
		: 0;
	const targetCritical=pressure && (pressure.implode || pressure.excess>=(SURVIVAL && SURVIVAL.WATER_PRESSURE_IMPLODE_EXCESS ? SURVIVAL.WATER_PRESSURE_IMPLODE_EXCESS*0.72 : 7))
		? 1 : 0;
	const rise=1-Math.exp(-dt*8);
	const fall=1-Math.exp(-dt*3.2);
	waterPressureFx += (targetPressure-waterPressureFx) * (targetPressure>waterPressureFx?rise:fall);
	waterPressureCriticalFx += (targetCritical-waterPressureCriticalFx) * (targetCritical>waterPressureCriticalFx?rise:fall);
	waterDamageFx=Math.max(0,waterDamageFx-dt*(inWater?1.15:2.4));
	if(PARTICLES && inWater && waterDamageFx>0.12){
		waterDamageDropT-=dt;
		if(waterDamageDropT<=0){
			waterDamageDropT=0.09+Math.random()*0.12;
			try{
				if(PARTICLES.spawnBubble) PARTICLES.spawnBubble((player.x+(Math.random()-0.5)*0.55)*TILE,(player.y-player.h*0.35+Math.random()*0.45)*TILE);
			}catch(e){}
		}
	} else waterDamageDropT=0;
}
if(typeof window!=='undefined' && window.addEventListener){
	window.addEventListener('mm-entity-number',ev=>{
		const d=(ev && ev.detail) || {};
		const target=String(d.target||'');
		const kind=String(d.kind||'');
		if((target==='hero' || target.indexOf('hero:')===0) && (kind==='damage' || kind==='heal')) pushWorldNumber(d);
	});
	window.addEventListener('mm-combat-event',ev=>{ triggerCombatFeedback((ev && ev.detail) || {}); });
	window.addEventListener('mm-xp-awarded',ev=>{
		const d=(ev && ev.detail) || {};
		const x=Number.isFinite(Number(d.x)) ? Number(d.x) : player.x;
		const y=Number.isFinite(Number(d.y)) ? Number(d.y)-1.05 : player.y-player.h*1.05;
		pushWorldNumber({kind:'xp',amount:d.amount,x,y,target:'xp:'+String(d.species||'mob'),special:!!d.special});
	});
	window.addEventListener('mm-skill-point-gained',ev=>{
		const d=(ev && ev.detail) || {};
		const gained=Math.max(1,Math.min(99,Math.round(Number(d.gained)||1)));
		heroJoyUntil=Math.max(heroJoyUntil,performance.now()+1800);
		triggerHeroBodyRecoil('strike',player.facing||1,0.85+Math.min(0.55,gained*0.12));
		try{
			if(PARTICLES && PARTICLES.spawnSparks){
				PARTICLES.spawnSparks(player.x*TILE,(player.y-player.h*0.55)*TILE,'epic',Math.min(14,8+gained*2));
			}
		}catch(e){}
	});
}
// Expose player globally so mobs module (loaded separately) can reference and damage the player
window.player = player;
// Equipment state lives in inventory.js, which is imported above and guarantees
// MM.customization and MM.activeModifiers are fully populated before this runs.
window.addEventListener('mm-customization-change',()=>{
	// inventory.js already recomputed MM.activeModifiers.
	// Adjust vision immediately.
	revealAround();
	// Clamp jumpCount if cape downgraded mid‑air.
	const maxAir = (MM.activeModifiers && typeof MM.activeModifiers.maxAirJumps==='number')? MM.activeModifiers.maxAirJumps : 0;
	const totalAllowed = 1 + maxAir;
	if(player.jumpCount > totalAllowed) player.jumpCount = totalAllowed;
	applyHeroEnergyCapacity();
	// Also persist to main save so reloads keep the look/feel in sync, but let
	// the idle autosave path serialize it instead of blocking slider/menu input.
	try{ saveState(); }catch(e){}
});
// Trained Witalność raises max HP (engine/progress.js); keep the HP fraction on change
function applyProgressHp(){
	const pb=(MM.progress && MM.progress.bonuses)? MM.progress.bonuses() : null;
	const target=100 + ((pb && pb.maxHpBonus)||0);
	if(player.maxHp!==target){
		const frac=player.maxHp>0? player.hp/player.maxHp : 1;
		player.maxHp=target;
		player.hp=Math.min(target, Math.max(1, Math.round(target*frac)));
	}
}
window.addEventListener('mm-progress-change',applyProgressHp);
applyProgressHp();
function heroEnergyCapacity(){
	const lv=(MM.progress && MM.progress.level)? MM.progress.level() : {level:1};
	const mods=MM.activeModifiers||{};
	const levelBonus=Math.max(0,((lv.level||1)-1))*HERO_ENERGY_PER_LEVEL;
	const modifierBonus=Math.max(0, Number(mods.energyCapacityBonus)||0);
	return Math.max(1, Math.round(HERO_ENERGY_BASE + levelBonus + modifierBonus));
}
function applyHeroEnergyCapacity(){
	const target=heroEnergyCapacity();
	player.maxEnergy=target;
	player.energy=Math.max(0, Math.min(target, Number(player.energy)||0));
}
function noteHeroEnergyDelta(delta,opts){
	const n=Number(delta)||0;
	if(!Number.isFinite(n) || Math.abs(n)<=1e-6) return;
	opts=opts||{};
	if(opts.silent) return;
	if(heroEnergyDeltaAcc!==0 && Math.sign(heroEnergyDeltaAcc)!==Math.sign(n)) heroEnergyDeltaAcc=0;
	heroEnergyDeltaAcc+=n;
	if(!opts.force && Math.abs(heroEnergyDeltaAcc)<1) return;
	let shown=Math.round(heroEnergyDeltaAcc);
	if(shown===0) shown=heroEnergyDeltaAcc>0 ? 1 : -1;
	heroEnergyDeltaAcc=0;
	pushWorldNumber({
		kind:'energy',
		amount:shown,
		x:player.x,
		y:player.y-player.h*0.55,
		target:'hero:energy',
		cause:opts.cause||'energy'
	});
}
function heroEnergyDisplayValue(){
	applyHeroEnergyCapacity();
	return Math.floor(Math.max(0, Number(player.energy)||0)+1e-9);
}
function canSpendHeroEnergy(amount){
	const n=Math.max(0, Number(amount)||0);
	if(n<=0 || godMode) return true;
	applyHeroEnergyCapacity();
	const energy=Math.max(0, Number(player.energy)||0);
	if(n>=1) return Math.floor(energy+1e-9) >= Math.ceil(n-1e-9);
	return energy>=n && Math.floor(energy+1e-9)>=1;
}
function addHeroEnergy(amount,opts){
	const n=Math.max(0, Number(amount)||0);
	if(n<=0) return 0;
	applyHeroEnergyCapacity();
	const before=player.energy||0;
	player.energy=Math.min(player.maxEnergy||heroEnergyCapacity(), before+n);
	const delta=player.energy-before;
	if(delta>0) noteHeroEnergyDelta(delta,opts);
	return delta;
}
function spendHeroEnergy(amount){
	const n=Math.max(0, Number(amount)||0);
	if(n<=0) return true;
	applyHeroEnergyCapacity();
	if(!canSpendHeroEnergy(n)) return false;
	const before=Math.max(0,Number(player.energy)||0);
	player.energy=Math.max(0,(player.energy||0)-n);
	if(player.energy<0.0001) player.energy=0;
	noteHeroEnergyDelta(player.energy-before,{force:n>=1});
	applyUnderwaterEnergyUseDamage(n);
	return true;
}
function chargeHeroEnergy(amount, opts){
	opts=opts||{};
	const charged=addHeroEnergy(amount,opts);
	if(charged<=0) return 0;
	const source=opts.source;
	const hasSource=source && typeof source.x==='number' && isFinite(source.x) && typeof source.y==='number' && isFinite(source.y);
	const lightning=opts.cause==='lightning';
	const intensity=Math.max(0.35, Math.min(1.8, Number(opts.intensity)|| (lightning?1.65:0.9)));
	energyChargeFx.t=Math.max(energyChargeFx.t||0, lightning?0.95:0.62);
	energyChargeFx.intensity=Math.max(energyChargeFx.intensity||0,intensity);
	energyChargeFx.source=hasSource ? {x:source.x,y:source.y} : null;
	if(hasSource && PARTICLES && PARTICLES.spawnEnergyAbsorb){
		PARTICLES.spawnEnergyAbsorb(source.x*TILE,source.y*TILE,player.x*TILE,(player.y-0.05)*TILE,intensity);
	}
	if(AUDIO && AUDIO.play) AUDIO.play('charge');
	noteSaveActivity();
	saveState();
	return charged;
}
function drainHeroEnergy(opts){
	opts=opts||{};
	applyHeroEnergyCapacity();
	const before=Math.max(0, Number(player.energy)||0);
	if(before<=0) return 0;
	player.energy=0;
	noteHeroEnergyDelta(-before,{force:true});
	if(opts.cause==='ufo'){
		energyChargeFx.t=0;
		energyChargeFx.intensity=0;
		energyChargeFx.source=null;
	}
	noteSaveActivity();
	saveState();
	return before;
}
function spendTurboEnergy(dt){
	if(godMode) return true;
	if(!(dt>0) || !isFinite(dt)) return false;
	applyHeroEnergyCapacity();
	const before=Math.max(0, Number(player.energy)||0);
	if(before<=TURBO_MIN_ENERGY) return false;
	const want=TURBO_ENERGY_PER_SEC*dt;
	const spent=Math.min(before,want);
	player.energy=Math.max(0, before-spent);
	if(spent>0) turboRechargePauseT=Math.max(turboRechargePauseT,0.18);
	if(player.energy<0.0001) player.energy=0;
	noteHeroEnergyDelta(-spent);
	applyUnderwaterEnergyUseDamage(spent);
	const now=performance.now();
	if(now-_lastEnergySaveAt>2500){ _lastEnergySaveAt=now; saveState(); }
	return true;
}
function updateTurboFx(dt,active){
	if(active) turboFx=Math.min(1, turboFx+dt*9);
	else turboFx=Math.max(0, turboFx-dt*5.5);
	if(!(VISUAL.animations && active && PARTICLES && PARTICLES.spawnTurboSparks)){
		turboSparkT=0;
		return;
	}
	turboSparkT-=dt;
	if(turboSparkT>0) return;
	const speedK=Math.max(0.35, Math.min(1.25, Math.abs(player.vx||0)/Math.max(1,MOVE.MAX)));
	PARTICLES.spawnTurboSparks(player.x*TILE,(player.y-0.02)*TILE,player.facing,0.65+speedK*0.35);
	const frameMs=(typeof window!=='undefined' && Number.isFinite(window.__mmFrameMs)) ? window.__mmFrameMs : 16;
	turboSparkT=frameMs>34 ? 0.13 : 0.065;
}
function heroEnergyInfo(){
	applyHeroEnergyCapacity();
	return {energy:player.energy||0,displayEnergy:heroEnergyDisplayValue(),max:player.maxEnergy||heroEnergyCapacity(),base:HERO_ENERGY_BASE,perLevel:HERO_ENERGY_PER_LEVEL};
}
MM.heroEnergy={capacity:heroEnergyCapacity, info:heroEnergyInfo, add:addHeroEnergy, chargeExternal:chargeHeroEnergy, spend:spendHeroEnergy, canSpend:canSpendHeroEnergy, drain:drainHeroEnergy};
window.addEventListener('mm-progress-change',applyHeroEnergyCapacity);
applyHeroEnergyCapacity();
function turboKeyHeld(){ return !!(keys['shift']||keys['shiftleft']||keys['shiftright']); }
function companionControlState(){
	return {
		left:!!(keys['a']||keys['arrowleft']),
		right:!!(keys['d']||keys['arrowright']),
		up:!!(keys['w']||keys['arrowup']),
		down:!!(keys['s']||keys['arrowdown']),
		jump:!!keys[' '],
		turbo:turboKeyHeld()
	};
}
const tools={basic:1,stone:2,meteor:3.3,diamond:4,bedrock:2.6};
const BEDROCK_PICK_MAX_DURABILITY=10;
const BEDROCK_MINE_NEED=1.35;
// --- Resource registry: SINGLE source for collectable/placeable resources,
// derived from MM.inventory.RESOURCES ({key,label,color,tile}). Adding a new
// resource there (plus its INFO tile entry) automatically wires: inv counts,
// HUD counters, hotbar remap menu + counts, god-mode stacks, world-reset zeroing,
// placement/consumption checks, undo refunds, crafting labels and death drops.
const RESOURCE_DEFS=(MM.inventory && MM.inventory.RESOURCES)? MM.inventory.RESOURCES.slice() : [];
const RESOURCE_KEYS=RESOURCE_DEFS.map(r=>r.key);
const RESOURCE_KEY_SET=new Set(RESOURCE_KEYS);
const TILE_TO_RES={}; RESOURCE_DEFS.forEach(r=>{ if(r.tile && T[r.tile]!=null) TILE_TO_RES[T[r.tile]]=r.key; });
const RES_LABEL={}; RESOURCE_DEFS.forEach(r=>{ RES_LABEL[r.key]=r.label.toLowerCase(); });
const RES_COLOR={}; RESOURCE_DEFS.forEach(r=>{ RES_COLOR[r.key]=r.color || '#9ca3af'; });
const TILE_LABELS={};
RESOURCE_DEFS.forEach(r=>{ if(r.tile && T[r.tile]!=null) TILE_LABELS[T[r.tile]]=r.label; });
Object.assign(TILE_LABELS,{
	[T.AIR]:'Powietrze',
	[T.STONE]:'Skala',
	[T.BEDROCK]:'Skala macierzysta',
	[T.CHEST_COMMON]:'Skrzynia zwykla',
	[T.CHEST_RARE]:'Skrzynia rzadka',
	[T.CHEST_EPIC]:'Skrzynia epicka',
	[T.ICE]:'Lod',
	[T.LAVA]:'Lawa',
	[T.MUD]:'Bloto',
	[T.WET_CLAY]:'Mokra glina',
	[T.GRAVE]:'Nagrobek',
	[T.INVASION_CACHE]:'Skrytka obcych',
	[T.UFO_CONCRETE]:'Beton UFO',
	[T.VOLCANO_MASTER_STONE]:'Kamien mistrza',
	[T.SERVANT_STONE]:'Kamien slugi',
	[T.AUTUMN_LEAF_ORANGE]:'Jesienny lisc',
	[T.AUTUMN_LEAF_RED]:'Brazowy lisc',
	[T.MEAT]:'Mieso',
	[T.ROTTEN_MEAT]:'Zepsute mieso',
	[T.BAKED_MEAT]:'Pieczone mieso',
	[T.GLASS]:'Szklo',
	[T.WIRE]:'Przewody',
	[T.ELECTRONICS]:'Elektronika',
	[T.TRANSISTOR]:'Tranzystor',
	[T.HOT_AIR]:'Gorace powietrze',
	[T.STEAM]:'Para',
	[T.POISON_GAS]:'Trujacy gaz',
	[T.FUEL_GAS]:'Gaz palny',
	[T.DYNAMO]:'Dynamo',
	[T.DYNAMO_SLOT]:'Szczelina dynama',
	[T.COPPER_WIRE]:'Przewod miedziany',
	[T.TELEPORTER]:'Teleporter',
	[T.ANTIGRAVITY_BEACON]:'Beacon antygrawitacyjny',
	[T.SOLAR_PANEL]:'Panel sloneczny',
	[T.SOLAR_BATTERY]:'Panel sloneczny z bateria',
	[T.TURRET]:'Wiezyczka',
	[T.FIRE_TURRET]:'Wiezyczka ogniowa',
	[T.WATER_TURRET]:'Wiezyczka wodna',
	[T.SPRING_PLATFORM]:'Platforma sprezynowa',
	[T.TRACK]:'Gasienica',
	[T.CHAIR_WOOD]:'Fotel drewniany',
	[T.CHAIR_STONE]:'Fotel kamienny',
	[T.CHAIR_STEEL]:'Fotel stalowy',
	[T.WATER_PIPE]:'Rura fluidowa',
	[T.WATER_PUMP]:'Pompa fluidowa',
	[T.METEOR_SIREN]:'Syrena meteorytowa',
	[T.VENDING_MACHINE]:'Automat vendingowy',
	[T.RADIOACTIVE_ORE]:'Ruda radioaktywna',
	[T.ALIEN_BIOMASS]:'Biomasa obca',
	[T.METEOR_DUST]:'Pyl meteorytowy',
	[T.ANTIMATTER_CRYSTAL]:'Krysztal antymaterii',
	[T.UNSTABLE_SAND]:'Niestabilny piasek',
	[T.UNSTABLE_GRASS]:'Niestabilna trawa',
	[T.QUICKSAND]:'Ruchome piaski'
});
function tileLabel(t){ return TILE_LABELS[t] || 'Nieznany blok'; }
function isChairTileId(t){ return !!(INFO[t] && INFO[t].chair); }
function tileHoverColor(t){ return t===T.AIR ? '#9fb8d1' : ((INFO[t]&&INFO[t].color) || '#9fb8d1'); }
function isGasTileId(t){ return isGasTile(t); }
function isLooseItemTile(t){ return isLooseItemMaterial(t); }
function gasSkyExposedTile(x,y){
	if(GASES && typeof GASES.skyExposed==='function') return GASES.skyExposed(x,y,getTile);
	for(let yy=Math.floor(y)-1; yy>=0; yy--){
		const t=getTile(x,yy);
		if(isAirOrGasTile(t)) continue;
		return false;
	}
	return true;
}
// Inventory counts for resources (+ tool unlock flags)
const inv={tools:{stone:false,meteor:false,diamond:false}};
inv.tools.bedrock=false;
inv.bedrockPickDurability=0;
RESOURCE_KEYS.forEach(k=>{ inv[k]=0; });
// Expose inventory for cross-module loot insertion
window.inv = inv;
// Hotbar (slots triggered by keys 5..9, 0 — keys 1..4 belong to the weapon shortcuts)
// HOTBAR_ORDER now mutable and can include CHEST_* pseudo entries (only placeable in god mode)
const HOTBAR_ORDER=['GRASS','SAND','STONE','WOOD','LEAF','WATER'];
let hotbarIndex=0; // 0..length-1
function hotbarKeyLabel(slot){ return slot===HOTBAR_ORDER.length-1? '0' : String(slot+5); }
function selectedTileId(){ const name=HOTBAR_ORDER[hotbarIndex]; return T[name]; }
function isChestSelection(name){ return name==='CHEST_COMMON'||name==='CHEST_RARE'||name==='CHEST_EPIC'; }
function cycleHotbar(idx,opts){
	if(idx<0||idx>=HOTBAR_ORDER.length) return;
	hotbarIndex=idx;
	if(!(opts&&opts.keepWeapon)) selectToolMode({quiet:true});
	updateHotbarSel(); refreshHotbarDom(); saveState();
}
const DYNAMO_ORIENTATION_KEY='mm_dynamo_orientation_v1';
const PUMP_ORIENTATION_KEY='mm_pump_orientation_v1';
let dynamoOrientation='horizontal';
let pumpOrientation='east';
try{
	const savedDynamoOrientation=localStorage.getItem(DYNAMO_ORIENTATION_KEY);
	if(savedDynamoOrientation==='vertical') dynamoOrientation='vertical';
	const savedPumpOrientation=localStorage.getItem(PUMP_ORIENTATION_KEY);
	if(['east','south','west','north'].includes(savedPumpOrientation)) pumpOrientation=savedPumpOrientation;
}catch(e){}
function dynamoOrientationLabel(){ return dynamoOrientation==='vertical' ? 'pionowo' : 'poziomo'; }
function toggleDynamoOrientation(){
	dynamoOrientation=dynamoOrientation==='vertical' ? 'horizontal' : 'vertical';
	try{ localStorage.setItem(DYNAMO_ORIENTATION_KEY,dynamoOrientation); }catch(e){}
	msg('Dynamo: '+dynamoOrientationLabel()+' (R obraca)');
}
function pumpOrientationLabel(){
	return pumpOrientation==='east' ? 'wyjscie w prawo'
		: (pumpOrientation==='west' ? 'wyjscie w lewo'
		: (pumpOrientation==='south' ? 'wyjscie w dol' : 'wyjscie w gore'));
}
function togglePumpOrientation(){
	pumpOrientation=(PUMPS && PUMPS.rotateDir) ? PUMPS.rotateDir(pumpOrientation) : (pumpOrientation==='east'?'south':pumpOrientation==='south'?'west':pumpOrientation==='west'?'north':'east');
	try{ localStorage.setItem(PUMP_ORIENTATION_KEY,pumpOrientation); }catch(e){}
	msg('Pompa: '+pumpOrientationLabel()+' (R obraca)');
}
function toggleBackgroundBuildMode(){
	const id=selectedTileId();
	if(!isBackgroundBuildTileId(id)){
		backgroundBuildMode=false;
		msg('Tlo: wybierz zwykly material budowlany.');
		updateHotbarSel();
		return;
	}
	backgroundBuildMode=!backgroundBuildMode;
	msg(backgroundBuildMode ? 'Budowanie w tle: ON (R przelacza)' : 'Budowanie w tle: OFF');
	updateHotbarSel();
}
// --- Respawn totems + death with gravestone resource drop ---
// Graves and totems are bound to the world seed: coordinates from world A must not
// teleport the hero into world B's rock. Totems are real placeable tiles; the list
// only indexes them so death can choose the nearest one quickly.
const LEGACY_RESPAWN_KEY='mm_respawn_v1';
const RESPAWN_TOTEMS_KEY='mm_respawn_totems_v1';
const HEALING_SHELTERS_KEY='mm_healing_shelters_v1';
let respawnTotems=[];
let healingShelters=[];
function respawnTotemKey(tx,ty){ return Math.floor(tx)+','+Math.floor(ty); }
function cleanRespawnTotemList(list){
	const out=[], seen=new Set();
	if(!Array.isArray(list)) return out;
	for(const raw of list){
		if(!raw || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) continue;
		const x=Math.floor(raw.x), y=Math.floor(raw.y);
		if(!worldYInBounds(y)) continue;
		const key=respawnTotemKey(x,y);
		if(seen.has(key)) continue;
		seen.add(key);
		out.push({x,y});
	}
	return out.slice(0,512);
}
function saveRespawnTotems(){
	try{
		if(respawnTotems.length) localStorage.setItem(RESPAWN_TOTEMS_KEY, JSON.stringify({seed:WORLDGEN.worldSeed,list:respawnTotems}));
		else localStorage.removeItem(RESPAWN_TOTEMS_KEY);
		localStorage.removeItem(LEGACY_RESPAWN_KEY);
	}catch(e){}
}
function snapshotRespawnTotems(){ return {v:1,seed:WORLDGEN.worldSeed,list:cleanRespawnTotemList(respawnTotems)}; }
function restoreRespawnTotems(src){
	if(src && typeof src==='object' && src.seed!=null && src.seed!==WORLDGEN.worldSeed){ respawnTotems=[]; saveRespawnTotems(); return false; }
	const list=src && typeof src==='object' ? src.list : src;
	respawnTotems=cleanRespawnTotemList(list);
	saveRespawnTotems();
	return true;
}
function loadRespawnTotemsFromStorage(){
	let list=[];
	try{
		const raw=localStorage.getItem(RESPAWN_TOTEMS_KEY);
		if(raw){
			const d=JSON.parse(raw);
			if(d && d.seed===WORLDGEN.worldSeed) list=d.list;
		}
		if(!list || !list.length){
			const oldRaw=localStorage.getItem(LEGACY_RESPAWN_KEY);
			if(oldRaw){
				const old=JSON.parse(oldRaw);
				if(old && old.seed===WORLDGEN.worldSeed && Number.isFinite(old.x) && Number.isFinite(old.y)) list=[{x:Math.floor(old.x),y:Math.floor(old.y)}];
			}
		}
	}catch(e){ list=[]; }
	respawnTotems=cleanRespawnTotemList(list);
	saveRespawnTotems();
}
function noteRespawnTotemTileChanged(tx,ty,old,next){
	if(old!==T.RESPAWN_TOTEM && next!==T.RESPAWN_TOTEM) return;
	const x=Math.floor(tx), y=Math.floor(ty);
	const key=respawnTotemKey(x,y);
	let changed=false;
	if(next===T.RESPAWN_TOTEM){
		if(!respawnTotems.some(p=>respawnTotemKey(p.x,p.y)===key)){ respawnTotems.push({x,y}); changed=true; }
	}else{
		const before=respawnTotems.length;
		respawnTotems=respawnTotems.filter(p=>respawnTotemKey(p.x,p.y)!==key);
		changed=respawnTotems.length!==before;
	}
	if(changed){
		respawnTotems=cleanRespawnTotemList(respawnTotems);
		saveRespawnTotems();
	}
}
function isRespawnTotemAt(tx,ty){ return getTile(tx,ty)===T.RESPAWN_TOTEM; }
function clearRespawnTotems(){
	respawnTotems=[];
	saveRespawnTotems();
}
function validRespawnTotemCells(){
	const list=cleanRespawnTotemList(respawnTotems);
	const valid=[];
	for(const p of list){
		ensureChunkAtY(Math.floor(p.x/CHUNK_W),p.y);
		if(getTile(p.x,p.y)===T.RESPAWN_TOTEM) valid.push(p);
	}
	if(valid.length!==respawnTotems.length){
		respawnTotems=valid;
		saveRespawnTotems();
	}
	return valid;
}
function totemRespawnSpot(tx,ty){
	ensureChunkAtY(Math.floor(tx/CHUNK_W),ty);
	const candidates=[{x:tx,y:ty}];
	for(let r=1;r<=5;r++){
		for(let dy=-r;dy<=r;dy++){
			for(let dx=-r;dx<=r;dx++){
				if(Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
				candidates.push({x:tx+dx,y:ty+dy});
			}
		}
	}
	for(const c of candidates){
		if(!worldYInBounds(c.y) || !worldYInBounds(c.y-1) || !worldYInBounds(c.y+1)) continue;
		ensureChunkAtY(Math.floor(c.x/CHUNK_W),c.y);
		if(!bodySpaceOpen(getTile(c.x,c.y),false) || !bodySpaceOpen(getTile(c.x,c.y-1),false)) continue;
		if(!safeLandingFloor(getTile(c.x,c.y+1))) continue;
		return {x:c.x+0.5,y:c.y,kind:'totem',tileX:tx,tileY:ty};
	}
	return {x:tx+0.5,y:ty,kind:'totem',tileX:tx,tileY:ty};
}
function nearestRespawnTotem(){
	const list=validRespawnTotemCells();
	let best=null, bestD=Infinity;
	for(const p of list){
		const dx=(p.x+0.5)-player.x, dy=p.y-player.y;
		const d=dx*dx+dy*dy;
		if(d<bestD){ bestD=d; best=p; }
	}
	return best;
}
function healingShelterBoundsFromStatus(status){
	const b=status && status.bounds;
	if(!b) return null;
	const left=Math.floor(Math.min(b.left,b.right)), right=Math.floor(Math.max(b.left,b.right));
	const top=Math.floor(Math.min(b.top,b.bottom)), bottom=Math.floor(Math.max(b.top,b.bottom));
	if(!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(top) || !Number.isFinite(bottom)) return null;
	if(right-left>HOUSE_HEALING.config.maxRadiusX*2+4 || bottom-top>HOUSE_HEALING.config.maxRadiusY*2+4) return null;
	return {left,right,top,bottom};
}
function healingShelterRecordFromStatus(status){
	if(!status || !status.ok) return null;
	const bounds=healingShelterBoundsFromStatus(status);
	if(!bounds) return null;
	const x=(bounds.left+bounds.right+1)/2;
	const y=(bounds.top+bounds.bottom+1)/2;
	return {
		x,y,bounds,
		cells:Math.floor(status.cells||0),
		totalCells:Math.floor(status.totalCells||status.cells||0),
		healRateFrac:Number.isFinite(Number(status.healRateFrac)) ? +Number(status.healRateFrac).toFixed(5) : 0,
		seenAt:Date.now()
	};
}
function cleanHealingShelterList(list){
	const out=[];
	if(!Array.isArray(list)) return out;
	for(const raw of list){
		if(!raw || !Number.isFinite(raw.x) || !Number.isFinite(raw.y) || !worldYInBounds(raw.y)) continue;
		const b=healingShelterBoundsFromStatus({bounds:raw.bounds || raw});
		if(!b) continue;
		const rec={
			x:Number(raw.x),
			y:Number(raw.y),
			bounds:b,
			cells:Math.max(0,Math.floor(raw.cells||0)),
			totalCells:Math.max(0,Math.floor(raw.totalCells||raw.cells||0)),
			healRateFrac:Number.isFinite(Number(raw.healRateFrac)) ? Number(raw.healRateFrac) : 0,
			seenAt:Number.isFinite(Number(raw.seenAt)) ? Number(raw.seenAt) : 0
		};
		if(!out.some(old=>healingSheltersOverlap(old,rec))) out.push(rec);
	}
	return out.slice(0,128);
}
function saveHealingShelters(){
	try{
		if(healingShelters.length) localStorage.setItem(HEALING_SHELTERS_KEY, JSON.stringify({seed:WORLDGEN.worldSeed,list:healingShelters}));
		else localStorage.removeItem(HEALING_SHELTERS_KEY);
	}catch(e){}
}
function snapshotHealingShelters(){ return {v:1,seed:WORLDGEN.worldSeed,list:cleanHealingShelterList(healingShelters)}; }
function restoreHealingShelters(src){
	if(src && typeof src==='object' && src.seed!=null && src.seed!==WORLDGEN.worldSeed){ healingShelters=[]; saveHealingShelters(); return false; }
	const list=src && typeof src==='object' ? src.list : src;
	healingShelters=cleanHealingShelterList(list);
	saveHealingShelters();
	return true;
}
function loadHealingSheltersFromStorage(){
	let list=[];
	try{
		const raw=localStorage.getItem(HEALING_SHELTERS_KEY);
		if(raw){
			const d=JSON.parse(raw);
			if(d && d.seed===WORLDGEN.worldSeed) list=d.list;
		}
	}catch(e){ list=[]; }
	healingShelters=cleanHealingShelterList(list);
	saveHealingShelters();
}
function clearHealingShelters(){
	healingShelters=[];
	saveHealingShelters();
}
function healingSheltersOverlap(a,b){
	if(!a || !b || !a.bounds || !b.bounds) return false;
	const pad=2;
	return !(a.bounds.right+pad<b.bounds.left || b.bounds.right+pad<a.bounds.left || a.bounds.bottom+pad<b.bounds.top || b.bounds.bottom+pad<a.bounds.top);
}
function healingShelterTileNear(rec,tx,ty,pad){
	if(!rec || !rec.bounds) return false;
	pad=Number.isFinite(Number(pad)) ? Number(pad) : 1;
	return tx>=rec.bounds.left-pad && tx<=rec.bounds.right+pad && ty>=rec.bounds.top-pad && ty<=rec.bounds.bottom+pad;
}
function healingShelterSignalAt(rec,broken){
	if(!rec || !rec.bounds) return;
	const x=(rec.bounds.left+rec.bounds.right+1)/2;
	const y=rec.bounds.top-0.35;
	pushWorldNumber({kind:'home',icon:broken?'brokenHeart':'heart',x,y,target:'home:'+rec.bounds.left+','+rec.bounds.top});
	try{ if(PARTICLES && PARTICLES.spawnSparks) PARTICLES.spawnSparks(x*TILE,y*TILE,broken?'rare':'epic',broken?5:7); }catch(e){}
}
function validateHealingShelterRecord(rec){
	if(!rec) return null;
	ensureChunkAtY(Math.floor(rec.x/CHUNK_W),rec.y);
	const probe={x:rec.x,y:rec.y,w:player.w||0.7,h:player.h||0.95};
	const status=HOUSE_HEALING && HOUSE_HEALING.analyzeHouseAt ? HOUSE_HEALING.analyzeHouseAt(probe,getTile,{
		isBurning:(x,y)=>!!(FIRE && FIRE.isBurning && FIRE.isBurning(x,y)),
		backgroundAt:getConstructionBackgroundTile
	}) : null;
	return status && status.ok ? healingShelterRecordFromStatus(status) : null;
}
function validateHealingShelters(opts){
	opts=opts||{};
	if(!healingShelters.length) return [];
	const changed=opts.changed || null;
	const valid=[];
	let removed=false;
	for(let i=0;i<healingShelters.length;i++){
		const rec=healingShelters[i];
		if(changed && !healingShelterTileNear(rec,changed.x,changed.y,3)){ valid.push(rec); continue; }
		const next=validateHealingShelterRecord(rec);
		if(next) valid.push(next);
		else {
			removed=true;
			if(opts.signal!==false) healingShelterSignalAt(rec,true);
		}
	}
	if(removed || valid.length!==healingShelters.length){
		healingShelters=cleanHealingShelterList(valid);
		saveHealingShelters();
	}
	return healingShelters;
}
function registerHealingShelterStatus(status,opts){
	const rec=healingShelterRecordFromStatus(status);
	if(!rec) return null;
	opts=opts||{};
	const idx=healingShelters.findIndex(old=>healingSheltersOverlap(old,rec));
	if(idx>=0){
		healingShelters[idx]=Object.assign({},healingShelters[idx],rec);
		saveHealingShelters();
		return healingShelters[idx];
	}
	healingShelters=cleanHealingShelterList(healingShelters.concat(rec));
	saveHealingShelters();
	if(opts.signal!==false) healingShelterSignalAt(rec,false);
	return rec;
}
function noteHealingShelterTileChanged(tx,ty){
	if(!healingShelters.length) return;
	for(const rec of healingShelters){
		if(healingShelterTileNear(rec,tx,ty,3)){
			validateHealingShelters({changed:{x:tx,y:ty},signal:true});
			return;
		}
	}
}
function healingShelterBarrierAt(tx,ty){
	if(!healingShelters.length) return false;
	tx=Math.floor(tx); ty=Math.floor(ty);
	if(!Number.isFinite(tx) || !Number.isFinite(ty) || !worldYInBounds(ty)) return false;
	const tile=getTile(tx,ty);
	if(!isPlayerBuiltMaterial(tile) && !isDoorTile(tile) && !isTrapdoorTile(tile)) return false;
	for(const rec of healingShelters){
		if(!rec || !rec.bounds) continue;
		const b=rec.bounds;
		if(tx<b.left-1 || tx>b.right+1 || ty<b.top-1 || ty>b.bottom+1) continue;
		if(tx>=b.left && tx<=b.right && ty>=b.top && ty<=b.bottom) continue;
		return true;
	}
	return false;
}
MM.healingShelters = Object.assign(MM.healingShelters || {}, {
	isBarrierAt:healingShelterBarrierAt,
	snapshot:()=>snapshotHealingShelters(),
	count:()=>healingShelters.length
});
function healingShelterRespawnSpot(rec){
	if(!rec || !rec.bounds) return null;
	ensureChunkAtY(Math.floor(rec.x/CHUNK_W),rec.y);
	const candidates=[];
	for(let y=rec.bounds.top; y<=rec.bounds.bottom; y++){
		for(let x=rec.bounds.left; x<=rec.bounds.right; x++){
			const d=Math.abs((x+0.5)-rec.x)+Math.abs(y-rec.y);
			candidates.push({x,y,d});
		}
	}
	candidates.sort((a,b)=>a.d-b.d);
	for(const c of candidates){
		if(!worldYInBounds(c.y) || !worldYInBounds(c.y-1) || !worldYInBounds(c.y+1)) continue;
		ensureChunkAtY(Math.floor(c.x/CHUNK_W),c.y);
		if(!bodySpaceOpen(getTile(c.x,c.y),false) || !bodySpaceOpen(getTile(c.x,c.y-1),false)) continue;
		if(!safeLandingFloor(getTile(c.x,c.y+1))) continue;
		return {x:c.x+0.5,y:c.y,kind:'home',homeX:rec.x,homeY:rec.y};
	}
	return {x:rec.x,y:rec.y,kind:'home',homeX:rec.x,homeY:rec.y};
}
function nearestHealingShelter(){
	const list=validHealingShelterRecords();
	let best=null, bestD=Infinity;
	for(const rec of list){
		const dx=rec.x-player.x, dy=rec.y-player.y;
		const d=dx*dx+dy*dy;
		if(d<bestD){ bestD=d; best=rec; }
	}
	return best;
}
function respawnDestinationCandidate(kind,spot,ref){
	if(!spot) return null;
	return {
		kind,
		spot,
		ref:ref||null,
		d:(spot.x-player.x)*(spot.x-player.x)+(spot.y-player.y)*(spot.y-player.y)
	};
}
function nearestRespawnDestination(){
	const totem=nearestRespawnTotem();
	const home=nearestHealingShelter();
	const totemCand=totem ? respawnDestinationCandidate('totem',totemRespawnSpot(totem.x,totem.y),totem) : null;
	const homeCand=home ? respawnDestinationCandidate('home',healingShelterRespawnSpot(home),home) : null;
	if(totemCand && homeCand) return totemCand.d<=homeCand.d ? totemCand : homeCand;
	return totemCand || homeCand || null;
}
function validHealingShelterRecords(){
	const before=healingShelters.length;
	healingShelters=cleanHealingShelterList(healingShelters);
	validateHealingShelters({signal:false});
	if(before!==healingShelters.length) saveHealingShelters();
	return healingShelters;
}
loadRespawnTotemsFromStorage();
loadHealingSheltersFromStorage();
let grave=null; const GRAVE_KEY='mm_grave_v1';
try{ const raw=localStorage.getItem(GRAVE_KEY); if(raw){ const d=JSON.parse(raw); if(d && isFinite(d.x) && isFinite(d.y) && d.res && d.seed===WORLDGEN.worldSeed) grave=d; } }catch(e){}
function saveGrave(){ try{ if(grave) localStorage.setItem(GRAVE_KEY, JSON.stringify(grave)); else localStorage.removeItem(GRAVE_KEY); }catch(e){} }
const DEATH_TRAVEL_MIN_DUR=0.95;
const DEATH_TRAVEL_SPEED_TILES_PER_SEC=38;
const DEATH_TRAVEL_FAILSAFE_MAX_DUR=60;
const DEATH_TRAVEL_GROUND_CLEARANCE=10;
let deathTravelFx=null;
function deathClamp01(v){ return Math.max(0, Math.min(1, Number(v)||0)); }
function deathEase(v){ v=deathClamp01(v); return v*v*(3-2*v); }
function deathLerp(a,b,t){ return a+(b-a)*deathClamp01(t); }
function deathTravelProgressAt(raw){
	const r=deathClamp01(raw);
	const slowZone=0.28;
	const edge=1-slowZone;
	if(r<=edge) return r;
	const u=(r-edge)/slowZone;
	return edge + slowZone*(u + u*u - u*u*u);
}
function deathTravelTrailStartRaw(fx,raw){
	const dur=Math.max(0.001, fx && Number.isFinite(fx.dur) ? fx.dur : 1);
	const slice=Math.max(0.006, Math.min(0.20, 0.42/dur));
	return Math.max(0, deathClamp01(raw)-slice);
}
function deathTravelParticleTailRaw(fx,raw){
	const dur=Math.max(0.001, fx && Number.isFinite(fx.dur) ? fx.dur : 1);
	const slice=Math.max(0.004, Math.min(0.06, 0.13/dur));
	return Math.max(0, deathClamp01(raw)-slice);
}
function deathRand(seed,i){
	const x=Math.sin((seed||1)*12.9898 + i*78.233)*43758.5453;
	return x-Math.floor(x);
}
function deathTravelTailAlpha(v){
	const t=deathClamp01(v);
	return t*t*(3-2*t);
}
function deathTravelLightningBolt(fx,startRaw,endRaw,frame){
	const a=deathClamp01(startRaw), b=deathClamp01(endRaw);
	const span=Math.max(0,b-a);
	const start=deathTravelPointAt(fx,deathTravelProgressAt(a));
	const end=deathTravelPointAt(fx,deathTravelProgressAt(b));
	const trailLen=Math.hypot(end.x-start.x,end.y-start.y);
	const stormScale=Math.max(0.45, Math.min(1.15, trailLen/10));
	const segs=9+Math.floor(deathRand(fx.seed+frame*13,2)*4);
	const pts=[];
	for(let i=0;i<=segs;i++){
		const f=i/segs;
		const rr=a+span*f;
		const base=deathTravelPointAt(fx,deathTravelProgressAt(rr));
		let x=base.x, y=base.y;
		if(i>0 && i<segs){
			const p0=deathTravelPointAt(fx,deathTravelProgressAt(Math.max(a,rr-span/segs)));
			const p1=deathTravelPointAt(fx,deathTravelProgressAt(Math.min(b,rr+span/segs)));
			const dx=p1.x-p0.x, dy=p1.y-p0.y;
			const len=Math.hypot(dx,dy)||1;
			const nx=-dy/len, ny=dx/len;
			const wob=(deathRand(fx.seed+frame*17,i)-0.5)*5*stormScale*(1-f*0.4);
			x+=nx*wob;
			y+=ny*wob;
		}
		pts.push([x,y]);
	}
	const branches=[];
	const nb=1+Math.floor(deathRand(fx.seed+frame*29,3)*3);
	for(let bi=0; bi<nb && pts.length>4; bi++){
		const si=1+Math.floor(deathRand(fx.seed+frame*31,bi)*Math.max(1,pts.length-3));
		const anchor=pts[si];
		const prev=pts[Math.max(0,si-1)], next=pts[Math.min(pts.length-1,si+1)];
		const dx=next[0]-prev[0], dy=next[1]-prev[1];
		const len=Math.hypot(dx,dy)||1;
		const dir=deathRand(fx.seed+frame*37,bi)>0.5 ? 1 : -1;
		const nx=-dy/len*dir, ny=dx/len*dir;
		const tx=dx/len, ty=dy/len;
		const bp=[[anchor[0],anchor[1]]];
		bp.fade=si/(pts.length-1);
		let bx=anchor[0], by=anchor[1];
		const bl=2+Math.floor(deathRand(fx.seed+frame*41,bi)*3);
		for(let s=1;s<=bl;s++){
			const step=(1.2+deathRand(fx.seed+frame*47,bi+s)*1.6)*stormScale;
			bx+=nx*step + tx*step*0.16;
			by+=ny*step + ty*step*0.16;
			bp.push([bx,by]);
		}
		branches.push(bp);
	}
	return {pts,branches};
}
function drawDeathLightningPath(ctx,bolt,passes){
	if(!bolt || !bolt.pts || bolt.pts.length<2) return;
	const last=Math.max(1,bolt.pts.length-1);
	for(const pass of passes){
		const lw=pass[0], r=pass[1], g=pass[2], b=pass[3], a=pass[4];
		ctx.lineWidth=lw;
		for(let i=1;i<bolt.pts.length;i++){
			const fade=deathTravelTailAlpha(i/last);
			if(fade<=0.01) continue;
			ctx.strokeStyle='rgba('+r+','+g+','+b+','+(a*fade).toFixed(3)+')';
			ctx.beginPath();
			ctx.moveTo(bolt.pts[i-1][0]*TILE,bolt.pts[i-1][1]*TILE);
			ctx.lineTo(bolt.pts[i][0]*TILE,bolt.pts[i][1]*TILE);
			ctx.stroke();
		}
		ctx.lineWidth=lw*0.6;
		for(const bp of bolt.branches){
			const branchLast=Math.max(1,bp.length-1);
			const anchorFade=deathTravelTailAlpha(bp.fade||0);
			for(let i=1;i<bp.length;i++){
				const tipFade=1-0.45*(i/branchLast);
				const fade=anchorFade*tipFade;
				if(fade<=0.01) continue;
				ctx.strokeStyle='rgba('+r+','+g+','+b+','+(a*fade).toFixed(3)+')';
				ctx.beginPath();
				ctx.moveTo(bp[i-1][0]*TILE,bp[i-1][1]*TILE);
				ctx.lineTo(bp[i][0]*TILE,bp[i][1]*TILE);
				ctx.stroke();
			}
		}
	}
}
function defaultRespawnTarget(){
	const SEA=(WORLDGEN.settings && WORLDGEN.settings.seaLevel!==undefined)? WORLDGEN.settings.seaLevel : 62;
	let x=0;
	outer: for(let r=0; r<=4000; r+=4){
		for(const c of (r===0? [0] : [r,-r])){
			const b=WORLDGEN.biomeType(c);
			const s=WORLDGEN.surfaceHeight(c);
			if(b!==5 && b!==6 && s<SEA-1){ x=c; break outer; }
		}
	}
	ensureChunk(Math.floor(x/CHUNK_W));
	let y=0; while(y<WORLD_H-1){ const tt=getTile(x,y); if(!isHeroPassableTile(tt)) break; y++; }
	return {x:x+0.5, y:y-1, kind:'spawn'};
}
function deathRespawnTarget(){
	const dest=nearestRespawnDestination();
	if(dest && dest.spot) return dest.spot;
	return defaultRespawnTarget();
}
function deathTravelPointAt(fx,p){
	const t=deathClamp01(p);
	const x=deathLerp(fx.from.x,fx.to.x,t);
	const endpointY=deathLerp(fx.from.y,fx.to.y,t);
	const cruiseY=deathTravelGroundYAt(fx,x)-DEATH_TRAVEL_GROUND_CLEARANCE;
	const takeoff=deathEase(Math.min(1,t/0.20));
	const landing=deathEase(Math.min(1,(1-t)/0.20));
	const cruiseBlend=Math.min(takeoff,landing);
	const wave=Math.sin((t*Math.PI*2.0)+(fx.seed||0)*0.013)*0.35*cruiseBlend;
	return {
		x,
		y:deathLerp(endpointY,cruiseY,cruiseBlend)+wave
	};
}
function deathTravelRawGroundYAt(fx,tx){
	tx=Math.floor(Number(tx)||0);
	if(fx){
		if(!fx.groundCache) fx.groundCache=Object.create(null);
		const key='r'+tx;
		if(fx.groundCache[key]!==undefined) return fx.groundCache[key];
	}
	let y=null;
	try{ if(WORLDGEN && WORLDGEN.surfaceHeight) y=WORLDGEN.surfaceHeight(tx); }catch(e){ y=null; }
	if(!Number.isFinite(y)) y=deathLerp(fx && fx.from ? fx.from.y : 0, fx && fx.to ? fx.to.y : 0, 0.5);
	y=Math.max(2,Math.min(WORLD_H-2,y));
	if(fx && fx.groundCache) fx.groundCache['r'+tx]=y;
	return y;
}
function deathTravelGroundYAt(fx,x){
	const tx=Math.floor(Number(x)||0);
	if(fx){
		if(!fx.groundCache) fx.groundCache=Object.create(null);
		const key='s'+tx;
		if(fx.groundCache[key]!==undefined) return fx.groundCache[key];
	}
	let sum=0, weightSum=0;
	for(let dx=-4; dx<=4; dx++){
		const weight=5-Math.abs(dx);
		sum+=deathTravelRawGroundYAt(fx,tx+dx)*weight;
		weightSum+=weight;
	}
	const y=weightSum>0 ? sum/weightSum : deathTravelRawGroundYAt(fx,tx);
	if(fx && fx.groundCache) fx.groundCache['s'+tx]=y;
	return y;
}
function deathTravelEstimatedPathLength(fx){
	if(!fx) return 0;
	const steps=Math.max(8,Math.min(96,Math.ceil(Math.max(1,fx.dist||0)/8)));
	let len=0;
	let prev=deathTravelPointAt(fx,0);
	for(let i=1;i<=steps;i++){
		const pt=deathTravelPointAt(fx,i/steps);
		len+=Math.hypot(pt.x-prev.x,pt.y-prev.y);
		prev=pt;
	}
	return len;
}
function deathTravelDurationForPathLength(pathLength){
	const len=Math.max(0, Number(pathLength)||0);
	const dur=len/DEATH_TRAVEL_SPEED_TILES_PER_SEC;
	return Math.max(DEATH_TRAVEL_MIN_DUR, Math.min(DEATH_TRAVEL_FAILSAFE_MAX_DUR, dur));
}
function deathTravelCurrentPoint(fx){
	if(!fx) return null;
	const raw=deathClamp01(fx.dur>0 ? fx.t/fx.dur : 1);
	return deathTravelPointAt(fx,deathTravelProgressAt(raw));
}
function startDeathTravelFx(cause){
	const from={x:player.x, y:player.y-0.08};
	const to=deathRespawnTarget();
	const dist=Math.hypot(to.x-from.x,to.y-from.y);
	const seed=((Math.abs(Math.round(from.x*97)) ^ Math.abs(Math.round(from.y*193)) ^ Math.round(performance.now())) >>> 0) || 1;
	const route={from,to,dist,t:0,emitT:0,seed,cause:cause||'damage',groundCache:Object.create(null)};
	route.pathLen=deathTravelEstimatedPathLength(route);
	route.dur=deathTravelDurationForPathLength(route.pathLen);
	deathTravelFx=route;
	player.vx=0; player.vy=0; player.onGround=false; player.hpInvul=performance.now()+route.dur*1000+900;
	releaseGameplayInput();
	try{
		if(PARTICLES && PARTICLES.spawnEnergyAbsorb){
			const launch=deathTravelPointAt(route,deathTravelProgressAt(Math.min(0.08,Math.max(0.025,0.16/route.dur))));
			PARTICLES.spawnEnergyAbsorb(from.x*TILE,from.y*TILE,launch.x*TILE,launch.y*TILE,1.1,{quick:true,hue:'gold'});
		}
	}catch(e){}
	return deathTravelFx;
}
function finishDeathTravelRespawn(){
	const fx=deathTravelFx;
	if(!fx) return false;
	deathTravelFx=null;
	player.hp=player.maxHp; player.hpInvul=performance.now()+1700; player.vx=0; player.vy=0;
	placePlayer(true,{center:false});
	const to={x:player.x, y:player.y};
	try{ if(PARTICLES && PARTICLES.spawnEnergyAbsorb) PARTICLES.spawnEnergyAbsorb(to.x*TILE,to.y*TILE,player.x*TILE,(player.y-0.08)*TILE,1.2,{quick:true,hue:'gold'}); }catch(e){}
	try{ if(MM.audio && MM.audio.play) MM.audio.play('charge'); }catch(e){}
	updateInventory();
	return true;
}
function updateDeathTravelFx(dt){
	const fx=deathTravelFx;
	if(!fx) return false;
	fx.t+=Math.max(0,dt||0);
	fx.emitT-=Math.max(0,dt||0);
	const raw=deathClamp01(fx.t/fx.dur);
	const p=deathTravelProgressAt(raw);
	const pos=deathTravelPointAt(fx,p);
	if(fx.emitT<=0){
		fx.emitT=(lastFrameMs>34)?0.095:0.038;
		const tail=deathTravelPointAt(fx,deathTravelProgressAt(deathTravelParticleTailRaw(fx,raw)));
		try{ if(PARTICLES && PARTICLES.spawnEnergyAbsorb) PARTICLES.spawnEnergyAbsorb(tail.x*TILE,tail.y*TILE,pos.x*TILE,pos.y*TILE,0.62+0.36*(1-p),{quick:true,hue:'gold'}); }catch(e){}
	}
	if(fx.t>=fx.dur) finishDeathTravelRespawn();
	return true;
}
// Loading a save with a different seed invalidates both markers
function dropWorldBoundMarkers(){
	const before=respawnTotems.length;
	respawnTotems=cleanRespawnTotemList(respawnTotems);
	if(before!==respawnTotems.length) saveRespawnTotems();
	const homeBefore=healingShelters.length;
	healingShelters=cleanHealingShelterList(healingShelters);
	if(homeBefore!==healingShelters.length) saveHealingShelters();
	if(grave && grave.seed!==WORLDGEN.worldSeed){ grave=null; saveGrave(); }
}
function heroDefenseCanAbsorb(opts){
	if(opts && opts.defenseBypass) return false;
	const cause=opts && opts.cause!=null ? String(opts.cause) : '';
	return !HERO_DEFENSE_BYPASS_CAUSES.has(cause);
}
function heroDefending(now){
	return heroDefendHeld || now<heroDefendUntil;
}
function beginHeroDefense(pointerId){
	const it=activeWeaponItem();
	if(!it || deathTravelFx) return false;
	const now=performance.now();
	heroDefendPointerId=pointerId==null ? null : pointerId;
	heroDefendHeld=true;
	heroDefendUntil=Math.max(heroDefendUntil, now+DEFEND_TAP_GRACE_MS);
	heroDefendFlashUntil=Math.max(heroDefendFlashUntil, now+260);
	if(now-heroDefendMsgAt>DEFEND_MESSAGE_COOLDOWN_MS){
		heroDefendMsgAt=now;
		msg('Obrona: -25% obrazen');
	}
	try{ if(MM.audio && MM.audio.play) MM.audio.play('charge'); }catch(e){}
	return true;
}
function endHeroDefense(pointerId,opts){
	if(pointerId!=null && heroDefendPointerId!=null && pointerId!==heroDefendPointerId) return false;
	const now=performance.now();
	const was=heroDefendHeld || heroDefendPointerId!=null || now<heroDefendUntil;
	heroDefendHeld=false;
	heroDefendPointerId=null;
	if(opts && opts.cancel) heroDefendUntil=0;
	else if(was) heroDefendUntil=Math.max(heroDefendUntil, now+DEFEND_RELEASE_GRACE_MS);
	return was;
}
function applyHeroDefense(amount,opts,now){
	if(!heroDefending(now) || !heroDefenseCanAbsorb(opts)) return {amount,absorbed:0};
	const absorbed=amount*DEFEND_ABSORB_FRACTION;
	heroDefendFlashUntil=Math.max(heroDefendFlashUntil, now+240);
	return {amount:Math.max(0,amount-absorbed),absorbed};
}
function tryWeaponUltOrDefend(player,aimX,aimY,item,pointerId,source){
	if(!item) return false;
	if(WEAPONS && WEAPONS.fireUlt && WEAPONS.fireUlt(player,aimX,aimY)){
		notifyInvasionWeaponUse(item,{ult:true});
		return true;
	}
	if(beginHeroDefense(pointerId)){
		notifyInvasionWeaponUse(item,{defend:true,source:source||'mouse',absorb:DEFEND_ABSORB_FRACTION});
		return true;
	}
	return false;
}
// Single entry for hurting the hero — i-frames, knockback, hurt audio and death
// routing live HERE, not in each damage source. mobs/bosses/weapons delegate to
// this (with local fallbacks only for the DOM-less Node sims).
// opts: {srcX,srcY (knockback origin), kb (impulse, default 4), kbY (upward cap,
//        default -2.5), launch (hard upward fling), invulMs, cause}
window.damageHero=function(amount, opts){
	opts=opts||{};
	if(!(amount>0) || !isFinite(amount)) return false;
	if(deathTravelFx) return false;
	if(immunityMode){ player.hp=player.maxHp; return false; }
	const now=performance.now();
	if(player.hpInvul && now<player.hpInvul) return false;
	if(MECHS && MECHS.absorbHeroDamage){
		const mechGuard=MECHS.absorbHeroDamage(amount,opts,player);
		if(mechGuard && mechGuard.absorbed>0){
			amount=mechGuard.amount;
			if(amount<0.5){
				player.hpInvul=now+(opts.invulMs||520);
				try{ if(MM.audio && MM.audio.play) MM.audio.play('charge'); }catch(e){}
				return true;
			}
		}
	}
	if(COMPANIONS && COMPANIONS.absorbHeroDamage){
		const guard=COMPANIONS.absorbHeroDamage(amount,opts,player);
		if(guard && guard.absorbed>0){
			amount=guard.amount;
			if(amount<0.5){
				player.hpInvul=now+(opts.invulMs||520);
				try{ if(MM.audio && MM.audio.play) MM.audio.play('charge'); }catch(e){}
				return true;
			}
		}
	}
	const defended=applyHeroDefense(amount,opts,now);
	if(defended.absorbed>0){
		triggerCombatFeedback({
			kind:'defend',
			target:'hero',
			source:'hero_defense',
			x:player.x,
			y:player.y-player.h*0.34,
			srcX:opts.srcX,
			srcY:opts.srcY,
			amount:defended.absorbed,
			cause:opts.cause||'defend',
			defendedBlock:true,
			major:defended.absorbed>=Math.max(5,player.maxHp*0.08),
			power:Math.max(0.65,Math.min(1.8,defended.absorbed/8))
		});
		amount=defended.amount;
		opts=Object.assign({},opts,{defended:true,defendedAbsorbed:defended.absorbed});
	}
	const dealt=Math.round(amount);
	player.hp-=dealt;
	player.hpInvul=now+(opts.invulMs||600);
	player.hurtFlashUntil=now+HURT_FLASH_MS;
	pushWorldNumber({kind:'damage',amount:-dealt,x:player.x,y:player.y-player.h*0.72,target:'hero',cause:opts.cause});
	triggerWaterDamageDistress(opts.cause,dealt);
	{
		const hitElement=combatElementFromDetail(opts);
		const notable=dealt>=Math.max(6,player.maxHp*0.10) || !!hitElement || opts.launch!=null;
		if(notable){
			triggerCombatFeedback({
				kind:hitElement?'elemental':'heavy',
				target:'hero',
				source:opts.source||opts.cause||'enemy',
				x:player.x,
				y:player.y-player.h*0.30,
				srcX:opts.srcX,
				srcY:opts.srcY,
				amount:dealt,
				cause:opts.cause,
				element:hitElement,
				major:dealt>=Math.max(8,player.maxHp*0.12) || opts.launch!=null,
				power:Math.max(0.75,Math.min(2.2,dealt/12))
			});
		}
	}
	try{ if(MM.audio && MM.audio.play) MM.audio.play('hurt'); }catch(e){}
	if(typeof opts.srcX==='number' && isFinite(opts.srcX)){
		const dx=player.x-opts.srcX;
		const dy=(typeof opts.srcY==='number' && isFinite(opts.srcY))? player.y-opts.srcY : 0;
		const d=Math.hypot(dx,dy)||1;
		player.vx+=(dx/d)*((opts.kb!=null)?opts.kb:4);
		player.vy=Math.min(player.vy, (opts.kbY!=null)?opts.kbY:-2.5);
	}
	if(typeof opts.launch==='number') player.vy=Math.min(player.vy, opts.launch);
	const invasionHitCause = opts.cause==='alien_invasion' || opts.cause==='molekin_invasion';
	notifyInvasionHeroAction(invasionHitCause?'hero_hit':'hero_hurt', {
		amount:dealt,
		cause:opts.cause||'damage',
		hp:player.hp,
		maxHp:player.maxHp,
		srcX:opts.srcX,
		srcY:opts.srcY,
		defended:!!opts.defended,
		absorbed:opts.defendedAbsorbed||0
	});
	if(player.hp<=0){ player.hp=0; window.heroDied(opts.cause||'damage'); }
	return true;
};
function notifyInvasionHeroAction(type, detail){
	try{
		if(!INVASIONS || !INVASIONS.onHeroAction) return null;
		return INVASIONS.onHeroAction(type, Object.assign({player}, detail||{}));
	}catch(e){ return null; }
}
function notifyInvasionWeaponUse(item, detail){
	const it=item || activeWeaponItem();
	const weaponType=(detail && detail.weaponType) || (it && it.weaponType) || 'melee';
	return notifyInvasionHeroAction('hero_weapon', Object.assign({
		weaponType,
		weaponName:it && (it.name || it.id)
	}, detail||{}));
}
function notifyInvasionMining(tId,tx,ty){
	return notifyInvasionHeroAction('hero_mine', {
		x:tx+0.5,
		y:ty+0.5,
		tile:tId,
		tileLabel:tileLabel(tId),
		tool:player.tool,
		toolLabel:pickLabel(player.tool)
	});
}
// Central death handler (mobs/bosses/lava/explosions all route here): half of every
// resource is left behind in a gravestone tile — click it to recover the loss.
window.heroDied=function(cause){
	if(deathTravelFx) return;
	if(immunityMode){ player.hp=player.maxHp; return; }
	player.hurtFlashUntil=Math.max(player.hurtFlashUntil||0, performance.now()+HURT_FLASH_MS);
	if(cause==='alien_invasion' && INVASIONS && INVASIONS.onHeroKilled){
		const stolen=INVASIONS.onHeroKilled({player, inv, resourceKeys:RESOURCE_KEYS, inventory:MM.inventory, getTile, setTile, ensureChunkAtY, updateInventory, notifyStructureTileChanged, saveState, msg, spawnBurst});
		if(stolen && stolen.handled){
			try{ if(MM.audio && MM.audio.play) MM.audio.play('grave'); }catch(e){}
			updateInventory();
			startDeathTravelFx(cause);
			return;
		}
	}
	// The mirror fight at the center: falling to yourself costs nothing material.
	// 'inner_self_final' is the mutual killing blow (story completes); the other
	// inner causes pause the battle and wait for the hero's return.
	if((cause==='inner_self' || cause==='inner_mirror' || cause==='inner_self_final') && CENTER_GUARDIAN && CENTER_GUARDIAN.onHeroKilled){
		const mirror=CENTER_GUARDIAN.onHeroKilled({cause, player});
		if(mirror && mirror.handled){
			try{ if(MM.audio && MM.audio.play) MM.audio.play(cause==='inner_self_final'?'milestone':'grave'); }catch(e){}
			updateInventory();
			startDeathTravelFx(cause);
			return;
		}
	}
	const res={}; let any=false;
	for(const k of RESOURCE_KEYS){
		const half=Math.floor((inv[k]||0)/2);
		if(half>0){ res[k]=half; inv[k]-=half; any=true; }
	}
	if(any){
		let gx=Math.round(player.x); let gy=Math.round(player.y);
		const here=getTile(gx,gy);
		if(here!==T.AIR && here!==T.WATER && getTile(gx,gy-1)===T.AIR) gy=gy-1;
		// A crush death leaves the hero inside solid rubble — hunt for the nearest
		// open cell so the gravestone (and half his resources) stays reachable.
		if(!isReplaceableNaturalOpenTile(getTile(gx,gy),false)){
			const spot=nearestOpenGraveCell(gx,gy);
			if(spot){ gx=spot.x; gy=spot.y; }
		}
		grave={x:gx, y:gy, res, seed:WORLDGEN.worldSeed}; saveGrave();
		const t=getTile(gx,gy);
		if(isReplaceableNaturalOpenTile(t,false)) setTile(gx,gy,T.GRAVE);
		msg('☠ Zginąłeś — połowa zasobów czeka w nagrobku ('+gx+', '+gy+')');
	} else {
		msg('☠ Zginąłeś – respawn');
	}
	try{ if(MM.audio && MM.audio.play) MM.audio.play('grave'); }catch(e){}
	updateInventory();
	startDeathTravelFx(cause);
};
function nearestOpenGraveCell(cx,cy){
	for(let r=1;r<=6;r++){
		for(let dy=-r;dy<=r;dy++){
			for(let dx=-r;dx<=r;dx++){
				if(Math.max(Math.abs(dx),Math.abs(dy))!==r) continue; // ring perimeter only
				const x=cx+dx, y=cy+dy;
				if(y<worldMinY() || y>=worldMaxY()) continue;
				if(isReplaceableNaturalOpenTile(getTile(x,y),false)) return {x,y};
			}
		}
	}
	return null;
}
function tryOpenGraveAt(tx,ty){
	if(getTile(tx,ty)!==T.GRAVE) return false;
	setTile(tx,ty,T.AIR);
	if(grave && grave.x===tx && grave.y===ty && grave.res){
		const got=[];
		for(const k in grave.res){ if(typeof inv[k]==='number'){ inv[k]+=grave.res[k]; got.push(grave.res[k]+'× '+(RES_LABEL[k]||k)); } }
		grave=null; saveGrave();
		msg('🪦 Odzyskano: '+got.join(', '));
		try{ if(MM.audio && MM.audio.play) MM.audio.play('chest'); }catch(e){}
		updateInventory();
	} else msg('🪦 Pusty nagrobek');
	return true;
}
// Bridge for the inventory resources tab: remap a hotbar slot to a block type
MM.hotbar={
	assign(slot,key){ if(slot<0||slot>=HOTBAR_ORDER.length) return false; if(!(key in T)) return false; HOTBAR_ORDER[slot]=key; cycleHotbar(slot); updateHotbarCounts(); return true; },
	index:()=>hotbarIndex,
	order:()=>HOTBAR_ORDER.slice()
};
// Persistence key
// --- Persistent Save System (minimal: only blocks + player position) ---
// Versioned schema to allow future migrations
// NOTE: Schema v5 simplifies to only blocks and player position.
// v6: terrain generator v2 (real oceans/mountains/caves) — older saves carry chunks
// generated by the inverted v1 height model and cannot be merged into new worlds
const SAVE_KEY='mm_save_v7';
const OLD_SAVE_KEYS=['mm_save_v6','mm_save_v5','mm_save_v4','mm_save_v3','mm_save_v2'];
const AUTOSAVE_CHUNK_PREFIX='mm_save_v7_chunk_';
const CRITICAL_SAVE_KEY='mm_save_critical_v1';
const CRITICAL_SAVE_INTERVAL_MS=2500;
// --- Compression helpers (RLE + base64) ---
function _b64FromBytes(bytes){ let bin=''; for(let i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]); return btoa(bin); }
function _bytesFromB64(b64){ const bin=atob(b64); const out=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i); return out; }
function encodeRLE(arr){ 
	if(!arr || arr.length === 0) return _b64FromBytes(new Uint8Array(0));
	const out=[]; 
	for(let i=0; i<arr.length;){ 
		const v=arr[i]; 
		let run=1; 
		while(i+run<arr.length && arr[i+run]===v && run<65535) run++; 
		let remain=run; 
		while(remain>0){ 
			const take=Math.min(255,remain); 
			out.push(v,take); 
			remain-=take; 
		} 
		i+=run; 
	} 
	return _b64FromBytes(Uint8Array.from(out)); 
}
function decodeRLE(b64,totalLen){ 
	const bytes=_bytesFromB64(b64); 
	const out=new Uint8Array(totalLen); 
	let oi=0; 
	for(let i=0; i<bytes.length && oi<totalLen; i+=2){ 
		const v=bytes[i]; 
		const count=bytes[i+1]; 
		if(i+1>=bytes.length) break; // Prevent reading past array
		for(let r=0; r<count && oi<totalLen; r++) {
			out[oi++]=v; 
		}
	} 
	return out; 
}
function decodeRaw(b64){ return _bytesFromB64(b64); }
function isTransientTerrainTile(t){
	return isGasTile(t);
}
function chunkForTerrainSave(arr){
	let copy=null;
	for(let i=0;i<arr.length;i++){
		if(!isTransientTerrainTile(arr[i])) continue;
		if(!copy) copy=new Uint8Array(arr);
		copy[i]=T.AIR;
	}
	return copy || arr;
}
function stripTransientTerrainTiles(arr){
	if(!arr || typeof arr.length!=='number') return arr;
	for(let i=0;i<arr.length;i++){
		if(isTransientTerrainTile(arr[i])) arr[i]=T.AIR;
	}
	return arr;
}
function legacyInfrastructureBase(arr,lx,y,t){
	if(t!==T.WATER_PIPE) return T.AIR;
	const neighbors=[[1,0],[-1,0],[0,1],[0,-1]];
	for(const n of neighbors){
		const nx=lx+n[0], ny=y+n[1];
		if(nx<0 || nx>=CHUNK_W || ny<0 || ny>=WORLD_H) continue;
		if(arr[ny*CHUNK_W+nx]===T.WATER) return T.WATER;
	}
	return T.AIR;
}
function migrateLegacyInfrastructureTerrain(cx,arr){
	const sy=arguments.length>2 ? arguments[2] : null;
	if(Number.isFinite(sy)) return arr;
	if(!arr || typeof arr.length!=='number' || !WORLD || !WORLD.setInfrastructure) return arr;
	for(let i=0;i<arr.length;i++){
		const t=arr[i];
		if(!isInfrastructureTileId(t)) continue;
		const lx=i%CHUNK_W, y=(i/CHUNK_W)|0;
		WORLD.setInfrastructure(cx*CHUNK_W+lx,y,t);
		arr[i]=legacyInfrastructureBase(arr,lx,y,t);
	}
	return arr;
}
function restoreTerrainChunk(cx,arr){
	const sy=arguments.length>2 ? arguments[2] : null;
	const ref=normalizeWorldChunkRef({cx, sy:Number.isFinite(sy)?sy:null});
	if(!ref) return;
	stripTransientTerrainTiles(arr);
	migrateLegacyInfrastructureTerrain(cx,arr,ref.base?null:ref.sy);
	try{ if(ref.base && TREES && TREES.clearChunk) TREES.clearChunk(ref.cx); }catch(e){}
	// setChunkArray drops the section-view cache — plain _world.set would leave
	// getTile reading the orphaned pre-restore buffer through stale views
	if(typeof WORLD.setChunkArray==='function') WORLD.setChunkArray(ref.key, arr);
	else WORLD._world.set(ref.key, arr);
	markWorldChunkModified(ref.cx,ref.sy);
}
// --- Integrity helpers (stable stringify + FNV1a hash) ---
function stableStringify(v){ if(v===null||typeof v!=='object') return JSON.stringify(v); if(Array.isArray(v)) return '['+v.map(stableStringify).join(',')+']'; const keys=Object.keys(v).sort(); return '{'+keys.map(k=>JSON.stringify(k)+':'+stableStringify(v[k])).join(',')+'}'; }
function computeHash(str){ // FNV-1a 32-bit
 let h=0x811c9dc5; for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h = (h>>>0) * 0x01000193; h>>>0; } return ('00000000'+(h>>>0).toString(16)).slice(-8); }
function attachHash(obj){ const clone=JSON.parse(JSON.stringify(obj)); const core=stableStringify(clone); const hash=computeHash(core); clone.h=hash; return {object:clone, hash}; }
function verifyHash(obj){ if(!obj || typeof obj!=='object' || !obj.h) return {ok:true, reason:!obj?'no-object':'no-hash'}; const h=obj.h; const tmp=Object.assign({}, obj); delete tmp.h; const core=stableStringify(tmp); const calc=computeHash(core); return {ok: h===calc, expected: h, got: calc}; }
function savePerfNow(){ return (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now(); }
function timedSavePart(label,fn,perf){
	const t=savePerfNow();
	try{ return fn(); }
	finally{
		if(perf && Array.isArray(perf.parts)){
			const ms=savePerfNow()-t;
			perf.parts.push({label:String(label), ms:+ms.toFixed(2)});
		}
	}
}
function addSavePerfPart(perf,label,ms){
	if(perf && Array.isArray(perf.parts) && typeof ms==='number' && isFinite(ms)) perf.parts.push({label:String(label), ms:+ms.toFixed(2)});
}
function publishSavePerf(perf){
	if(!perf || !Array.isArray(perf.parts)) return;
	try{
		const parts=perf.parts
			.filter(p=>p && typeof p.label==='string' && typeof p.ms==='number' && isFinite(p.ms) && p.ms>=0.01)
			.sort((a,b)=>b.ms-a.ms)
			.slice(0,10);
		window.__lastSavePerfParts=parts;
	}catch(e){}
}
// Save scheduler state is declared before saveGame(): customization events can
// request a save before later DOM setup code has finished running.
let _saveStateT=null, _autoSaveWorkT=null, _autoSaveJob=null, _lastAutoSaveAt=Date.now(), _saveDirty=false, _lastSaveActivityAt=Date.now(), _saveRevision=0, _saveFailureCount=0, _nextAutoSaveRetryAt=0, _lastSaveError='';
let _lastCriticalSaveAt=0, _lastCriticalSaveSignature='', _criticalSaveFailureCount=0;
const AUTO_SAVE_IDLE_CHECK_MS=3000;
const AUTO_SAVE_IDLE_REQUIRED_MS=12000;
const AUTO_SAVE_MIN_GAP_MS=90000;
const AUTO_SAVE_CHUNK_BATCH_MS=5;
function noteSaveActivity(){ _lastSaveActivityAt=Date.now(); }
function modifiedChunkIds(){ if(WORLD && typeof WORLD.modifiedChunkIds==='function') return WORLD.modifiedChunkIds(); const out=[]; const worldMap=WORLD._world; if(!worldMap) return out; for(const [k] of worldMap.entries()){ const ref=normalizeWorldChunkRef(k); if(!ref) continue; const ver=WORLD._versions.get(ref.key)||0; if(ver!==0) out.push(ref.base?ref.cx:{cx:ref.cx,sy:ref.sy}); } return out; }
function gatherModifiedChunks(ids){
	const out=[]; const worldMap=WORLD._world; if(!worldMap) return out;
	const rawList=Array.isArray(ids) ? ids : [...worldMap.keys()];
	const seen=new Set();
	for(const raw of rawList){
		const ref=normalizeWorldChunkRef(raw);
		if(!ref || seen.has(ref.key)) continue;
		seen.add(ref.key);
		const arr=worldChunkArrayFor(ref,false);
		const ver=worldChunkVersion(ref);
		if(!arr || ver===0) continue;
		const item={cx:ref.cx,data:encodeRLE(chunkForTerrainSave(arr)),rle:true};
		if(!ref.base){ item.sy=ref.sy; item.sectionH=ref.h||worldSectionHeight(); }
		out.push(item);
	}
	return out;
}
function baseChunkIdsForAudits(ids){
	const out=[], seen=new Set();
	if(!Array.isArray(ids)) return out;
	for(const raw of ids){
		const ref=normalizeWorldChunkRef(raw);
		if(!ref || !ref.base || seen.has(ref.cx)) continue;
		seen.add(ref.cx); out.push(ref.cx);
	}
	return out;
}
function markWorldChunkModified(cx){
	const sy=arguments.length>1 && Number.isFinite(arguments[1]) ? Math.floor(arguments[1]) : null;
	const ref=normalizeWorldChunkRef({cx, sy});
	if(!ref) return;
	const beforeVer=(WORLD && WORLD.chunkVersion) ? WORLD.chunkVersion(ref.cx,ref.sy) : undefined;
	if(WORLD && typeof WORLD.markModifiedChunk==='function') WORLD.markModifiedChunk(ref.cx,1,ref.sy); else if(WORLD && WORLD._versions) WORLD._versions.set(ref.key,1);
	if(WORLD && WORLD._modifiedChunks) WORLD._modifiedChunks.add(ref.base?ref.cx:ref.key);
	markChunkRenderDirtyFull(ref.cx,beforeVer,(WORLD && WORLD.chunkVersion) ? WORLD.chunkVersion(ref.cx,ref.sy) : undefined,ref.sy);
}
function restoreModifiedChunks(list){ const restored=[]; if(!Array.isArray(list)) return restored; for(const ch of list){ if(typeof ch.cx!=='number'||!ch.data) continue; const sy=Number.isFinite(ch.sy)?Math.floor(ch.sy):null; const size=CHUNK_W*(sy==null?WORLD_H:(Number.isFinite(ch.sectionH)?ch.sectionH:worldSectionHeight())); const arr = ch.rle? decodeRLE(ch.data, size): decodeRaw(ch.data); if(sy==null) restoreTerrainChunk(ch.cx,arr); else restoreTerrainChunk(ch.cx,arr,sy); restored.push(sy==null?ch.cx:{cx:ch.cx,sy}); } return restored; }
function autosaveChunkKey(cx,jobId){ const sy=arguments.length>2 && Number.isFinite(arguments[2]) ? Math.floor(arguments[2]) : null; return AUTOSAVE_CHUNK_PREFIX+WORLDGEN.worldSeed+'_'+cx+(sy==null?'':('_s'+sy))+(jobId?('_'+jobId):''); }
function currentAutosaveRefs(){ try{ const raw=localStorage.getItem(SAVE_KEY); if(!raw) return []; const data=JSON.parse(raw); const refs=data && data.world && Array.isArray(data.world.chunkRefs) ? data.world.chunkRefs : []; return refs.filter(r=>r && typeof r.key==='string' && r.key.startsWith(AUTOSAVE_CHUNK_PREFIX)); }catch(e){ return []; } }
function cleanupAutosaveChunks(keepKeys,oldRefs){ if(!Array.isArray(oldRefs)) return; for(const r of oldRefs){ try{ if(r && typeof r.key==='string' && r.key.startsWith(AUTOSAVE_CHUNK_PREFIX) && !keepKeys.has(r.key)) localStorage.removeItem(r.key); }catch(e){} } }
function scanAutosaveRefs(raw,keep){
	if(!raw) return;
	try{
		const data=JSON.parse(raw);
		const refs=data && data.world && Array.isArray(data.world.chunkRefs) ? data.world.chunkRefs : [];
		refs.forEach(r=>{ if(r && typeof r.key==='string' && r.key.startsWith(AUTOSAVE_CHUNK_PREFIX)) keep.add(r.key); });
	}catch(e){}
}
function referencedAutosaveKeys(){
	const keep=new Set();
	try{ scanAutosaveRefs(localStorage.getItem(SAVE_KEY),keep); }catch(e){}
	try{
		for(let i=0;i<localStorage.length;i++){
			const k=localStorage.key(i);
			if(k && k.startsWith('mm_slot_')) scanAutosaveRefs(localStorage.getItem(k),keep);
		}
	}catch(e){}
	return keep;
}
function cleanupOrphanAutosaveChunks(){
	const keep=referencedAutosaveKeys();
	const del=[];
	try{
		for(let i=0;i<localStorage.length;i++){
			const k=localStorage.key(i);
			if(k && k.startsWith(AUTOSAVE_CHUNK_PREFIX) && !keep.has(k)) del.push(k);
		}
		del.forEach(k=>{ try{ localStorage.removeItem(k); }catch(e){} });
	}catch(e){}
	return del.length;
}
function isQuotaSaveError(e){ return !!(e && (e.name==='QuotaExceededError' || e.name==='NS_ERROR_DOM_QUOTA_REACHED' || e.code===22 || e.code===1014)); }
function saveErrorText(e){ return (e && (e.name || e.message)) ? String(e.name || e.message).slice(0,80) : 'storage'; }
function recordSaveSuccess(){
	_saveFailureCount=0; _nextAutoSaveRetryAt=0; _lastSaveError='';
	try{ window.__lastSaveError=''; window.__lastSaveFailures=0; window.__nextSaveRetryAt=0; }catch(e){}
}
function recordSaveFailure(e,manual){
	const quota=isQuotaSaveError(e);
	const reclaimed=quota ? cleanupOrphanAutosaveChunks() : 0;
	_saveFailureCount=Math.min(8,_saveFailureCount+1);
	const backoff=Math.min(300000, AUTO_SAVE_IDLE_CHECK_MS*Math.pow(2, Math.min(6,_saveFailureCount)));
	_nextAutoSaveRetryAt=Date.now()+backoff;
	_lastSaveError=saveErrorText(e)+(reclaimed?(' cleaned '+reclaimed):'');
	try{ window.__lastSaveError=_lastSaveError; window.__lastSaveFailures=_saveFailureCount; window.__nextSaveRetryAt=_nextAutoSaveRetryAt; }catch(err){}
	if(manual) msg(quota?'Blad zapisu - brak miejsca?':'Blad zapisu');
}
function restoreReferencedChunks(refs){ const restored=[]; if(!Array.isArray(refs)) return restored; for(const ref of refs){ if(!ref || typeof ref.cx!=='number' || typeof ref.key!=='string' || !ref.key.startsWith(AUTOSAVE_CHUNK_PREFIX)) continue; let data=null; try{ data=localStorage.getItem(ref.key); }catch(e){ data=null; } if(!data) continue; if(ref.h && computeHash(data)!==ref.h){ console.warn('Autosave chunk hash mismatch',ref.cx); continue; } const sy=Number.isFinite(ref.sy)?Math.floor(ref.sy):null; const size=CHUNK_W*(sy==null?WORLD_H:(Number.isFinite(ref.sectionH)?ref.sectionH:worldSectionHeight())); const arr = ref.rle===false ? decodeRaw(data) : decodeRLE(data, size); if(sy==null) restoreTerrainChunk(ref.cx,arr); else restoreTerrainChunk(ref.cx,arr,sy); restored.push(sy==null?ref.cx:{cx:ref.cx,sy}); } return restored; }
function restoreWorldChunks(worldData){ if(!worldData || typeof worldData!=='object') return []; if(Array.isArray(worldData.modified)) return restoreModifiedChunks(worldData.modified); if(Array.isArray(worldData.chunkRefs)) return restoreReferencedChunks(worldData.chunkRefs); return []; }
// (legacy v4 export*/import* save helpers removed — v5 persists only blocks + player position)
function snapshotInventory(){
	const out={tools:{stone:!!inv.tools.stone, meteor:!!inv.tools.meteor, diamond:!!inv.tools.diamond, bedrock:!!inv.tools.bedrock, bedrockDurability:bedrockPickDurability()}};
	RESOURCE_KEYS.forEach(k=>{ out[k]=Math.max(0, inv[k]|0); });
	return out;
}
function restoreInventory(src){
	RESOURCE_KEYS.forEach(k=>{ inv[k]=0; });
	inv.tools.stone=false; inv.tools.meteor=false; inv.tools.diamond=false; inv.tools.bedrock=false; inv.bedrockPickDurability=0;
	if(!src || typeof src!=='object') return;
	RESOURCE_KEYS.forEach(k=>{
		const v=src[k];
		inv[k]=Number.isFinite(v) ? Math.max(0, v|0) : 0;
	});
	if(src.tools && typeof src.tools==='object'){
		inv.tools.stone=!!src.tools.stone;
		inv.tools.meteor=!!src.tools.meteor;
		inv.tools.diamond=!!src.tools.diamond;
		inv.tools.bedrock=!!src.tools.bedrock;
		inv.bedrockPickDurability=inv.tools.bedrock ? Math.max(0, Math.min(BEDROCK_PICK_MAX_DURABILITY, Number.isFinite(src.tools.bedrockDurability) ? (src.tools.bedrockDurability|0) : BEDROCK_PICK_MAX_DURABILITY)) : 0;
		if(inv.bedrockPickDurability<=0) inv.tools.bedrock=false;
	}
}
function snapshotHotbar(){
	return {order:HOTBAR_ORDER.slice(), index:hotbarIndex|0, tool:player.tool};
}
function restoreHotbar(src){
	if(!src || typeof src!=='object') return;
	if(Array.isArray(src.order)){
		for(let i=0; i<HOTBAR_ORDER.length && i<src.order.length; i++){
			if(typeof src.order[i]==='string' && T[src.order[i]]!=null) HOTBAR_ORDER[i]=src.order[i];
		}
	}
	if(typeof src.index==='number' && src.index>=0 && src.index<HOTBAR_ORDER.length) hotbarIndex=src.index|0;
	const owned=ownedPicks();
	const savedTool=(typeof src.tool==='string' && tools[src.tool]) ? src.tool : null;
	player.tool=(savedTool && owned.includes(savedTool)) ? savedTool : (owned.includes(player.tool)?player.tool:'basic');
}
function snapshotEquipment(){
	try{
		return (MM.inventory && typeof MM.inventory.snapshot==='function') ? MM.inventory.snapshot() : null;
	}catch(e){ return null; }
}
function restoreEquipment(src){
	if(!src || typeof src!=='object') return false;
	try{
		return !!(MM.inventory && typeof MM.inventory.restore==='function' && MM.inventory.restore(src,{persist:false,silent:true}));
	}catch(e){
		console.warn('Equipment restore failed',e);
		return false;
	}
}
function saveNumber(v,digits){
	const n=Number(v);
	if(!Number.isFinite(n)) return 0;
	const p=Math.pow(10, digits==null ? 2 : digits);
	return Math.round(n*p)/p;
}
function snapshotPlayerState(){
	return {
		x:saveNumber(player.x,3),
		y:saveNumber(player.y,3),
		facing:player.facing>=0?1:-1,
		xp:Math.max(0,player.xp|0),
		hp:saveNumber(player.hp,2),
		maxHp:saveNumber(player.maxHp,2),
		tool:player.tool,
		energy:saveNumber(player.energy,2)
	};
}
function restorePlayerState(src){
	if(!src || typeof src!=='object') return false;
	let hasX=false, hasY=false;
	const x=Number(src.x), y=Number(src.y);
	if(Number.isFinite(x)){ player.x=x; hasX=true; }
	if(Number.isFinite(y)){ player.y=y; hasY=true; }
	if(Number.isFinite(Number(src.xp))) player.xp=Math.max(0, Number(src.xp)|0);
	if(Number.isFinite(Number(src.energy))) player.energy=Math.max(0, Number(src.energy));
	if(src.facing<0) player.facing=-1; else if(src.facing>0) player.facing=1;
	player.vx=0; player.vy=0; player.onGround=false;
	return hasX && hasY;
}
function restorePlayerHealth(src){
	if(!src || typeof src!=='object') return false;
	const hp=Number(src.hp);
	if(!Number.isFinite(hp)) return false;
	const fallbackMax=Number.isFinite(Number(src.maxHp)) ? Number(src.maxHp) : 100;
	const max=Math.max(1, Number.isFinite(Number(player.maxHp)) ? Number(player.maxHp) : fallbackMax);
	player.hp=Math.max(1, Math.min(max, hp));
	return true;
}
function snapshotCriticalState(reason){
	return {
		v:1,
		seed:WORLDGEN.worldSeed,
		savedAt:Date.now(),
		revision:_saveRevision|0,
		reason:String(reason||'').slice(0,32),
		player:snapshotPlayerState(),
		inv:snapshotInventory(),
		hotbar:snapshotHotbar(),
		equipment:snapshotEquipment()
	};
}
function criticalStateComparable(state){
	return {
		seed:state && state.seed,
		player:state && state.player,
		inv:state && state.inv,
		hotbar:state && state.hotbar,
		equipment:state && state.equipment
	};
}
function criticalStateSignature(state){
	return stableStringify(criticalStateComparable(state));
}
function saveCriticalState(reason,force){
	try{
		const now=Date.now();
		if(!force && now-_lastCriticalSaveAt<CRITICAL_SAVE_INTERVAL_MS) return false;
		const state=snapshotCriticalState(reason);
		const sig=criticalStateSignature(state);
		if(!force && sig===_lastCriticalSaveSignature){ _lastCriticalSaveAt=now; return false; }
		state.stateHash=computeHash(sig);
		const json=JSON.stringify(state);
		localStorage.setItem(CRITICAL_SAVE_KEY,json);
		_lastCriticalSaveAt=now;
		_lastCriticalSaveSignature=sig;
		_criticalSaveFailureCount=0;
		try{ window.__lastCriticalSaveAt=now; window.__lastCriticalSaveSizeKb=(json.length/1024)|0; window.__lastCriticalSaveReason=state.reason; window.__lastCriticalSaveError=''; }catch(e){}
		return true;
	}catch(e){
		_criticalSaveFailureCount=Math.min(8,_criticalSaveFailureCount+1);
		try{ window.__lastCriticalSaveError=saveErrorText(e); window.__lastCriticalSaveFailures=_criticalSaveFailureCount; }catch(err){}
		return false;
	}
}
function loadCriticalStateForSave(data,opts){
	opts=opts||{};
	if(opts.ignoreCritical) return null;
	try{
		const raw=localStorage.getItem(CRITICAL_SAVE_KEY);
		if(!raw) return null;
		const state=JSON.parse(raw);
		if(!state || state.v!==1 || typeof state!=='object') return null;
		const saveSeed=Number.isFinite(Number(data && data.seed)) ? Number(data.seed) : WORLDGEN.worldSeed;
		const criticalSeed=Number(state.seed);
		if(!Number.isFinite(criticalSeed) || criticalSeed!==saveSeed) return null;
		const saveTime=Number(data && data.savedAt)||0;
		const criticalTime=Number(state.savedAt)||0;
		if(!(criticalTime>saveTime)) return null;
		if(state.stateHash && computeHash(criticalStateSignature(state))!==state.stateHash){
			console.warn('Critical save hash mismatch');
			return null;
		}
		return state;
	}catch(e){ return null; }
}
function restoreCriticalState(state){
	if(!state || typeof state!=='object') return false;
	let applied=false;
	if(state.inv && typeof state.inv==='object'){ restoreInventory(state.inv); applied=true; }
	if(state.hotbar || (state.player && state.player.tool)){
		restoreHotbar(state.hotbar || {tool:state.player.tool});
		applied=true;
	}
	if(state.equipment && typeof state.equipment==='object'){ restoreEquipment(state.equipment); applied=true; }
	if(state.player && typeof state.player==='object'){
		restorePlayerState(state.player);
		applyProgressHp();
		applyHeroEnergyCapacity();
		restorePlayerHealth(state.player);
		applied=true;
	}
	if(applied){
		try{ window.__lastCriticalSaveAppliedAt=Date.now(); window.__lastCriticalSaveAppliedFrom=state.savedAt||0; }catch(e){}
	}
	return applied;
}
function buildSaveObject(opts){
 opts=opts||{};
 const perf=opts.perf||null;
 let saveChunkIds = Array.isArray(opts.auditChunkIds) ? opts.auditChunkIds : null;
 if(!opts.lightweight){
	 saveChunkIds=timedSavePart('world.modified',()=>modifiedChunkIds(),perf);
	 const auditChunkIds=baseChunkIdsForAudits(saveChunkIds);
	 timedSavePart('falling.audit',()=>{ try{ if(auditChunkIds.length && FALLING && FALLING.auditChunks) FALLING.auditChunks(auditChunkIds,{force:true,immediate:true}); }catch(e){} },perf);
	 timedSavePart('falling.settle',()=>{ try{ if(FALLING && FALLING.settleAll) FALLING.settleAll(); }catch(e){} },perf);
	 timedSavePart('trees.audit',()=>{ try{ if(TREES && TREES.auditChunks) TREES.auditChunks(auditChunkIds,getTile); }catch(e){} },perf);
	 timedSavePart('trees.settle',()=>{ try{ if(TREES && TREES.settleAll) TREES.settleAll(getTile,setTile); }catch(e){} },perf);
	 saveChunkIds=timedSavePart('world.modified2',()=>modifiedChunkIds(),perf);
 }
 if(saveChunkIds==null) saveChunkIds = Array.isArray(opts.chunkRefs) ? [] : timedSavePart('world.modified',()=>modifiedChunkIds(),perf);
 const saveAuditChunkIds=baseChunkIdsForAudits(saveChunkIds);
 timedSavePart('meat.audit',()=>{ try{ if(saveAuditChunkIds.length && MEAT && MEAT.auditChunks) MEAT.auditChunks(saveAuditChunkIds,getTile); }catch(e){} },perf);
 timedSavePart('gases.audit',()=>{ try{ if(saveAuditChunkIds.length && GASES && GASES.auditChunks) GASES.auditChunks(saveAuditChunkIds,getTile); }catch(e){} },perf);
 const worldData = timedSavePart(Array.isArray(opts.chunkRefs)?'world.refs':'world.chunks',()=>(
	Array.isArray(opts.chunkRefs) ? {chunkRefs:opts.chunkRefs, external:true} : {modified: gatherModifiedChunks(saveChunkIds)}
 ),perf);
	return {
	v:7,
	seed: WORLDGEN.worldSeed,
	world:worldData,
	respawnTotems: timedSavePart('respawnTotems',()=>snapshotRespawnTotems(),perf),
	healingShelters: timedSavePart('healingShelters',()=>snapshotHealingShelters(),perf),
	fog: timedSavePart('fog',()=>((FOG && FOG.exportSeen) ? {v:2,revealAll:!!(FOG.getRevealAll && FOG.getRevealAll()),seen:FOG.exportSeen()} : null),perf),
	infrastructure: timedSavePart('infrastructure',()=>((WORLD && WORLD.snapshotInfrastructure) ? WORLD.snapshotInfrastructure() : null),perf),
	background: timedSavePart('background',()=>((BACKGROUND && BACKGROUND.snapshot) ? BACKGROUND.snapshot() : ((BACKGROUND && BACKGROUND.exportState) ? BACKGROUND.exportState() : null)),perf),
	trees: timedSavePart('trees',()=>((TREES && TREES.snapshot) ? TREES.snapshot() : null),perf),
	constructionBackground: timedSavePart('constructionBackground',()=>((WORLD && WORLD.snapshotConstructionBackground) ? WORLD.snapshotConstructionBackground() : null),perf),
	falling: timedSavePart('falling',()=>((FALLING && FALLING.snapshot) ? FALLING.snapshot() : null),perf),
	meat: timedSavePart('meat',()=>((MEAT && MEAT.snapshot) ? MEAT.snapshot() : null),perf),
	gases: timedSavePart('gases',()=>((GASES && GASES.snapshot) ? GASES.snapshot() : null),perf),
	fire: timedSavePart('fire',()=>((FIRE && FIRE.snapshot) ? FIRE.snapshot() : null),perf),
	boats: timedSavePart('boats',()=>((BOATS && BOATS.snapshot) ? BOATS.snapshot() : null),perf),
	mechs: timedSavePart('mechs',()=>((MECHS && MECHS.snapshot) ? MECHS.snapshot() : null),perf),
	wind: timedSavePart('wind',()=>((WIND && WIND.snapshot) ? WIND.snapshot() : null),perf),
	seasons: timedSavePart('seasons',()=>((SEASONS && SEASONS.snapshot) ? SEASONS.snapshot() : null),perf),
	clouds: timedSavePart('clouds',()=>((CLOUDS && CLOUDS.snapshot) ? CLOUDS.snapshot() : null),perf),
	dynamo: timedSavePart('dynamo',()=>((DYNAMO && DYNAMO.snapshot) ? DYNAMO.snapshot() : null),perf),
	solar: timedSavePart('solar',()=>((SOLAR && SOLAR.snapshot) ? SOLAR.snapshot() : null),perf),
	teleporters: timedSavePart('teleporters',()=>((TELEPORTERS && TELEPORTERS.snapshot) ? TELEPORTERS.snapshot() : null),perf),
	pumps: timedSavePart('pumps',()=>((PUMPS && PUMPS.snapshot) ? PUMPS.snapshot() : null),perf),
	turrets: timedSavePart('turrets',()=>((TURRETS && TURRETS.snapshot) ? TURRETS.snapshot() : null),perf),
	springPlatforms: timedSavePart('springPlatforms',()=>((SPRING_PLATFORMS && SPRING_PLATFORMS.snapshot) ? SPRING_PLATFORMS.snapshot() : null),perf),
	vending: timedSavePart('vending',()=>((VENDING && VENDING.snapshot) ? VENDING.snapshot() : null),perf),
	volcano: timedSavePart('volcano',()=>((VOLCANO && VOLCANO.snapshot) ? VOLCANO.snapshot() : null),perf),
	atomicWinter: timedSavePart('atomicWinter',()=>((ATOMIC_WINTER && ATOMIC_WINTER.snapshot) ? ATOMIC_WINTER.snapshot() : null),perf),
	guardians: timedSavePart('guardians',()=>((GUARDIANS && GUARDIANS.snapshot) ? GUARDIANS.snapshot() : null),perf),
	undergroundBoss: timedSavePart('undergroundBoss',()=>((UNDERGROUND && UNDERGROUND.snapshot) ? UNDERGROUND.snapshot() : null),perf),
	skyGuardian: timedSavePart('skyGuardian',()=>((SKY_GUARDIAN && SKY_GUARDIAN.snapshot) ? SKY_GUARDIAN.snapshot() : null),perf),
	guardianAftermath: timedSavePart('guardianAftermath',()=>((AFTERMATH && AFTERMATH.snapshot) ? AFTERMATH.snapshot() : null),perf),
	centerGuardian: timedSavePart('centerGuardian',()=>((CENTER_GUARDIAN && CENTER_GUARDIAN.snapshot) ? CENTER_GUARDIAN.snapshot() : null),perf),
	storyProgression: timedSavePart('storyProgression',()=>((STORY_PROGRESSION && STORY_PROGRESSION.snapshot) ? STORY_PROGRESSION.snapshot() : null),perf),
	meteorites: timedSavePart('meteorites',()=>((METEORITES && METEORITES.snapshot) ? METEORITES.snapshot() : null),perf),
	mobs: timedSavePart('mobs',()=>((MOBS && MOBS.serialize) ? MOBS.serialize() : null),perf),
	companions: timedSavePart('companions',()=>((COMPANIONS && COMPANIONS.snapshot) ? COMPANIONS.snapshot() : null),perf),
	generatedNpcs: timedSavePart('generatedNpcs',()=>((GENERATED_NPCS && GENERATED_NPCS.snapshot) ? GENERATED_NPCS.snapshot() : null),perf),
	npcs: timedSavePart('npcs',()=>((NPCS && NPCS.snapshot) ? NPCS.snapshot() : null),perf),
	tutorialNpc: timedSavePart('tutorialNpc',()=>((TUTORIAL_NPC && TUTORIAL_NPC.snapshot) ? TUTORIAL_NPC.snapshot() : null),perf),
	ufo: timedSavePart('ufo',()=>((UFO && UFO.snapshot) ? UFO.snapshot() : null),perf),
	tasks: timedSavePart('tasks',()=>((TASKS && TASKS.snapshot) ? TASKS.snapshot() : null),perf),
	invasions: timedSavePart('invasions',()=>((INVASIONS && INVASIONS.snapshot) ? INVASIONS.snapshot() : null),perf),
	progress: timedSavePart('progress',()=>((PROGRESS && PROGRESS.snapshot) ? PROGRESS.snapshot() : null),perf),
	plants: timedSavePart('plants',()=>((PLANTS && PLANTS.snapshot) ? PLANTS.snapshot() : null),perf),
	inv: timedSavePart('inventory',()=>snapshotInventory(),perf),
	crafting: timedSavePart('crafting',()=>snapshotCrafting(),perf),
	hotbar: timedSavePart('hotbar',()=>snapshotHotbar(),perf),
	equipment: timedSavePart('equipment',()=>snapshotEquipment(),perf),
	player: snapshotPlayerState(),
	savedAt: Date.now()
}; }
function saveGameCore(manual){
	try{
		const t0=savePerfNow();
		const perf={parts:[]};
		const oldRefs=currentAutosaveRefs();
		const data=buildSaveObject({perf});
		const mods=(data.world && data.world.modified)? data.world.modified.length:0;
		const {object:withHash} = timedSavePart('hash',()=>attachHash(data),perf);
		const json=timedSavePart('json',()=>JSON.stringify(withHash),perf);
		const writeT=savePerfNow();
		localStorage.setItem(SAVE_KEY,json);
		const writeMs=savePerfNow()-writeT;
		addSavePerfPart(perf,'storage.write',writeMs);
		timedSavePart('storage.cleanup',()=>cleanupAutosaveChunks(referencedAutosaveKeys(),oldRefs),perf);
		recordSaveSuccess();
		publishSavePerf(perf);
		try{ window.__lastSaveMs=savePerfNow()-t0; window.__lastSaveSizeKb=(json.length/1024)|0; window.__lastSaveChunks=mods; window.__lastSaveMode='full'; window.__lastSaveWriteMs=writeMs; }catch(e){}
		if(manual){ msg('Zapisano ('+((json.length/1024)|0)+' KB, modyf.chunks:'+mods+', '+Math.round(window.__lastSaveMs||0)+' ms)'); }
		return true;
	}catch(e){
		console.warn('Save failed',e);
		recordSaveFailure(e,manual);
		return false;
	}
}
// Lightweight autosave indicator (created lazily)
function showAutoSaveHint(sizeKB){ try{ let el=document.getElementById('autoSaveHint'); if(!el){ el=document.createElement('div'); el.id='autoSaveHint'; el.style.cssText='position:fixed; left:8px; bottom:8px; background:rgba(0,0,0,0.55); color:#fff; font:11px system-ui; padding:4px 8px; border-radius:6px; pointer-events:none; opacity:0; transition:opacity .4s; z-index:5000;'; document.body.appendChild(el); }
 const now=new Date(); const t=now.toLocaleTimeString(); el.textContent='Auto-zapis '+t+' ('+sizeKB+' KB)'; el.style.opacity='1'; clearTimeout(showAutoSaveHint._t); showAutoSaveHint._t=setTimeout(()=>{ el.style.opacity='0'; },2800); }catch(e){} }
// Wrapper adds the autosave hint on non-manual saves
function saveGame(manual){ saveCriticalState(manual?'manual-attempt':'full-attempt',true); const ok=saveGameCore(manual); if(ok){ saveCriticalState(manual?'manual':'full',true); _saveDirty=false; _lastAutoSaveAt=Date.now(); _autoSaveJob=null; if(_saveStateT){ clearTimeout(_saveStateT); _saveStateT=null; } if(_autoSaveWorkT){ clearTimeout(_autoSaveWorkT); _autoSaveWorkT=null; } } if(ok && !manual){ try{ const raw=localStorage.getItem(SAVE_KEY); if(raw) showAutoSaveHint((raw.length/1024)|0); }catch(e){} } return ok; }
function loadGame(opts){
 opts=opts||{};
 try{
	let raw=localStorage.getItem(SAVE_KEY);
	if(!raw){ for(const k of OLD_SAVE_KEYS){ raw=localStorage.getItem(k); if(raw) break; } }
	if(!raw){ return false; }
	const data=JSON.parse(raw);
	if(!data|| typeof data!=='object') return false;
	const hashInfo=verifyHash(data); if(!hashInfo.ok){ msg('UWAGA: uszkodzony zapis (hash)'); console.warn('Hash mismatch',hashInfo); }
	const ver=data.v||5; // proceed even if hash mismatch
	const criticalState=loadCriticalStateForSave(data,opts);
	// Saves older than v6 store chunks from the previous (inverted) terrain model;
	// pasting them into a v2 world corrupts it — start fresh instead
	if(ver<6){ console.warn('Save version',ver,'predates terrain v2 — starting a new world'); return false; }

	// Reset volatile systems regardless of seed to avoid stale state
	try{ if(MOBS && MOBS.clearAll) MOBS.clearAll(); }catch(e){}
	try{ if(COMPANIONS && COMPANIONS.reset) COMPANIONS.reset(); }catch(e){}
	try{ if(NPCS && NPCS.reset) NPCS.reset(); }catch(e){}
	try{ if(GENERATED_NPCS && GENERATED_NPCS.reset) GENERATED_NPCS.reset(); }catch(e){}
	try{ if(MOBS && MOBS.freezeSpawns) MOBS.freezeSpawns(3000); }catch(e){}
	try{ if(typeof chunkCanvases!=='undefined') chunkCanvases.clear(); if(typeof chunkRenderDirty!=='undefined') chunkRenderDirty.clear(); }catch(e){}
	try{ if(FOG && FOG.importSeen) FOG.importSeen([]); if(FOG && FOG.setRevealAll) FOG.setRevealAll(false); }catch(e){}
	try{ if(WATER && WATER.reset) WATER.reset(); }catch(e){}
	try{ if(CLOUDS && CLOUDS.reset) CLOUDS.reset(); }catch(e){}
	try{ if(BOSSES && BOSSES.reset) BOSSES.reset(); }catch(e){}
	try{ if(GUARDIANS && GUARDIANS.reset) GUARDIANS.reset(); }catch(e){}
	try{ if(UNDERGROUND && UNDERGROUND.reset) UNDERGROUND.reset(); }catch(e){}
	try{ if(SKY_GUARDIAN && SKY_GUARDIAN.reset) SKY_GUARDIAN.reset(); }catch(e){}
	try{ if(AFTERMATH && AFTERMATH.reset) AFTERMATH.reset(); }catch(e){}
	try{ if(CENTER_GUARDIAN && CENTER_GUARDIAN.reset) CENTER_GUARDIAN.reset(); }catch(e){}
	try{ if(STORY_PROGRESSION && STORY_PROGRESSION.reset) STORY_PROGRESSION.reset(); }catch(e){}
	try{ if(FALLING && FALLING.reset) FALLING.reset(); }catch(e){}
	try{ if(BOATS && BOATS.reset) BOATS.reset(); }catch(e){}
	try{ if(MECHS && MECHS.reset) MECHS.reset(); }catch(e){}
	try{ if(TREES && TREES.reset) TREES.reset(); }catch(e){}
	try{ if(GRASS && GRASS.reset) GRASS.reset(); }catch(e){}
	try{ if(PARTICLES && PARTICLES.reset) PARTICLES.reset(); }catch(e){}
	try{ if(FIRE && FIRE.reset) FIRE.reset(); }catch(e){}
	try{ if(WEAPONS && WEAPONS.reset) WEAPONS.reset(); }catch(e){}
	try{ if(MEAT && MEAT.reset) MEAT.reset(); }catch(e){}
	try{ if(GASES && GASES.reset) GASES.reset(); if(WIND && WIND.reset) WIND.reset(); if(SEASONS && SEASONS.reset) SEASONS.reset(); }catch(e){}
	try{ if(DYNAMO && DYNAMO.reset) DYNAMO.reset(); }catch(e){}
	try{ if(SOLAR && SOLAR.reset) SOLAR.reset(); }catch(e){}
	try{ if(TELEPORTERS && TELEPORTERS.reset) TELEPORTERS.reset(); }catch(e){}
	try{ if(PUMPS && PUMPS.reset) PUMPS.reset(); }catch(e){}
	try{ if(TURRETS && TURRETS.reset) TURRETS.reset(); }catch(e){}
	try{ if(SPRING_PLATFORMS && SPRING_PLATFORMS.reset) SPRING_PLATFORMS.reset(); }catch(e){}
	try{ if(VENDING && VENDING.reset) VENDING.reset(); }catch(e){}
	try{ if(VOLCANO && VOLCANO.reset) VOLCANO.reset(); }catch(e){}
	try{ if(ATOMIC_WINTER && ATOMIC_WINTER.reset) ATOMIC_WINTER.reset(); }catch(e){}
	try{ if(TERRAIN_TRAPS && TERRAIN_TRAPS.reset) TERRAIN_TRAPS.reset(); }catch(e){}
	try{ if(UFO && UFO.clearActive) UFO.clearActive(); }catch(e){}
	try{ if(TASKS && TASKS.reset) TASKS.reset(); }catch(e){}
	try{ if(INVASIONS && INVASIONS.reset) INVASIONS.reset(); }catch(e){}
	try{ if(METEORITES && METEORITES.clearActive) METEORITES.clearActive(); }catch(e){}
	// Plants/progress restore from the save snapshot below; old saves still fall
	// back to their historical mm_* side stores for compatibility.

	// If seed differs, swap to saved seed and clear world gen caches.
	// Always clear chunks before loading so a save is restored as a snapshot,
	// not overlaid on unsaved same-seed world state.
	if(typeof data.seed==='number' && data.seed!==WORLDGEN.worldSeed){
		WORLDGEN.worldSeed=data.seed;
		worldSeed=WORLDGEN.worldSeed;
		if(WORLD.clearHeights) WORLD.clearHeights();
	}
	if(WORLD && WORLD.clear) WORLD.clear();
	dropWorldBoundMarkers(); // totem/grave from another world must not apply here
	try{ if(BACKGROUND && BACKGROUND.restore) BACKGROUND.restore(data.background); else if(BACKGROUND && BACKGROUND.importState) BACKGROUND.importState(data.background); }catch(e){}

	// Restore modified blocks and player position. v6 saves are self-contained;
	// v7 autosaves may reference separately stored chunk blobs.
	const restoredChunks=restoreWorldChunks(data.world);
	restoreRespawnTotems(data.respawnTotems || {seed:WORLDGEN.worldSeed,list:respawnTotems});
	validRespawnTotemCells();
	const restoredBaseChunks=baseChunkIdsForAudits(restoredChunks);
	try{ if(WORLD && WORLD.restoreInfrastructure) WORLD.restoreInfrastructure(data.infrastructure); }catch(e){}
	try{ if(WORLD && WORLD.restoreConstructionBackground) WORLD.restoreConstructionBackground(data.constructionBackground); }catch(e){}
	restoreHealingShelters(data.healingShelters || {seed:WORLDGEN.worldSeed,list:healingShelters});
	validHealingShelterRecords();
	try{ if(TREES && TREES.restore) TREES.restore(data.trees,getTile); }catch(e){}
	try{ if(TREES && TREES.auditChunks) TREES.auditChunks(restoredBaseChunks,getTile); }catch(e){}
	try{ if(FALLING && FALLING.restore) FALLING.restore(data.falling); }catch(e){}
	try{ if(FALLING && FALLING.auditChunks) FALLING.auditChunks(restoredBaseChunks,{force:true}); }catch(e){}
	try{ if(MEAT && MEAT.restore) MEAT.restore(data.meat,getTile); }catch(e){}
	try{ if(GASES && GASES.restore) GASES.restore(data.gases,getTile,setTile); }catch(e){}
	try{ if(GASES && GASES.auditChunks) GASES.auditChunks(restoredBaseChunks,getTile); }catch(e){}
	try{ if(FIRE && FIRE.restore) FIRE.restore(data.fire,getTile); }catch(e){}
	try{ if(BOATS && BOATS.restore) BOATS.restore(data.boats); }catch(e){}
	try{ if(MECHS && MECHS.restore) MECHS.restore(data.mechs,getTile); }catch(e){}
	try{ if(WIND && WIND.restore) WIND.restore(data.wind); }catch(e){}
	try{ if(SEASONS && SEASONS.restore) SEASONS.restore(data.seasons); }catch(e){}
	try{ if(CLOUDS && CLOUDS.restore) CLOUDS.restore(data.clouds); }catch(e){}
	try{ if(DYNAMO && DYNAMO.restore) DYNAMO.restore(data.dynamo,getTile); }catch(e){}
	try{ if(SOLAR && SOLAR.restore) SOLAR.restore(data.solar,getTile); }catch(e){}
	try{ if(TELEPORTERS && TELEPORTERS.restore) TELEPORTERS.restore(data.teleporters,getTile); }catch(e){}
	try{ if(PUMPS && PUMPS.restore) PUMPS.restore(data.pumps,getTile); }catch(e){}
	try{ if(TURRETS && TURRETS.restore) TURRETS.restore(data.turrets,getTile); }catch(e){}
	try{ if(SPRING_PLATFORMS && SPRING_PLATFORMS.restore) SPRING_PLATFORMS.restore(data.springPlatforms,getTile); }catch(e){}
	try{ if(VENDING && VENDING.restore) VENDING.restore(data.vending,getTile); }catch(e){}
	try{ if(VOLCANO && VOLCANO.restore) VOLCANO.restore(data.volcano,getTile); }catch(e){}
	try{ if(ATOMIC_WINTER && ATOMIC_WINTER.restore) ATOMIC_WINTER.restore(data.atomicWinter); }catch(e){}
	try{ if(GUARDIANS && GUARDIANS.restore) GUARDIANS.restore(data.guardians); }catch(e){}
	try{ if(UNDERGROUND && UNDERGROUND.restore) UNDERGROUND.restore(data.undergroundBoss); }catch(e){}
	try{ if(SKY_GUARDIAN && SKY_GUARDIAN.restore) SKY_GUARDIAN.restore(data.skyGuardian); }catch(e){}
	try{ if(AFTERMATH && AFTERMATH.restore) AFTERMATH.restore(data.guardianAftermath); }catch(e){}
	try{ if(CENTER_GUARDIAN && CENTER_GUARDIAN.restore) CENTER_GUARDIAN.restore(data.centerGuardian); }catch(e){}
	try{ if(STORY_PROGRESSION && STORY_PROGRESSION.restore) STORY_PROGRESSION.restore(data.storyProgression); }catch(e){}
	try{ if(FOG && data.fog){ if(FOG.importSeen) FOG.importSeen(Array.isArray(data.fog) ? data.fog : data.fog.seen); if(FOG.setRevealAll) FOG.setRevealAll(!!data.fog.revealAll); } }catch(e){}
	try{ if(METEORITES && METEORITES.restore) METEORITES.restore(data.meteorites); }catch(e){}
	try{ if(MOBS && MOBS.deserialize && data.mobs) MOBS.deserialize(data.mobs); }catch(e){}
	try{ if(COMPANIONS && COMPANIONS.restore) COMPANIONS.restore(data.companions,getTile); }catch(e){}
	try{ if(GENERATED_NPCS && GENERATED_NPCS.restore) GENERATED_NPCS.restore(data.generatedNpcs); }catch(e){}
	try{ if(NPCS && NPCS.restore && data.npcs) NPCS.restore(data.npcs); }catch(e){}
	try{ if(!data.npcs && TUTORIAL_NPC && TUTORIAL_NPC.restore && data.tutorialNpc) TUTORIAL_NPC.restore(data.tutorialNpc); }catch(e){}
	try{ if(UFO && UFO.restore && data.ufo) UFO.restore(data.ufo); }catch(e){}
	try{ if(TASKS && TASKS.restore) TASKS.restore(data.tasks); }catch(e){}
	try{ if(INVASIONS && INVASIONS.restore && data.invasions) INVASIONS.restore(data.invasions,getTile,setTile); }catch(e){}
	try{ if(PROGRESS && PROGRESS.restore && data.progress) PROGRESS.restore(data.progress); }catch(e){}
	try{ if(PLANTS && PLANTS.restore && data.plants) PLANTS.restore(data.plants); }catch(e){}
	restoreInventory(data.inv);
	restoreCraftingAvailability(data.crafting);
	restoreHotbar(data.hotbar || (data.player && {tool:data.player.tool}));
	restoreEquipment(data.equipment);
	const hasSavedPlayerPos=restorePlayerState(data.player);
	applyProgressHp();
	applyHeroEnergyCapacity();
	restorePlayerHealth(data.player);
	const criticalApplied=restoreCriticalState(criticalState);
	const hasCriticalPlayerPos=!!(criticalApplied && criticalState && criticalState.player && Number.isFinite(Number(criticalState.player.x)) && Number.isFinite(Number(criticalState.player.y)));

	// Recenter camera or place player if needed
	if(hasCriticalPlayerPos || hasSavedPlayerPos) { centerOnPlayer(); } else { placePlayer(true); }
	heroBuriedCells.clear(); // stale cells from the previous world
	seedHeroBurialFromWorld(); // a save taken mid-collapse may wake the hero buried
	try{ if(TUTORIAL_NPC && TUTORIAL_NPC.hasPosition && !TUTORIAL_NPC.hasPosition() && TUTORIAL_NPC.placeNearWorldStart) TUTORIAL_NPC.placeNearWorldStart(getTile,WORLDGEN); }catch(e){}
	try{
		updateInventory({noSave:true,noCraftNotify:true});
		refreshHotbarDom();
		updateHotbarSel();
		updateWeaponBar();
	}catch(e){}
	saveCriticalState(criticalApplied?'load-critical':'load',true);
	return true;
 }catch(e){ console.warn('Load failed',e); return false; }
}
// Auto-save heartbeat: it only asks the dirty scheduler to try saving. The heavy
// serialization itself is delayed until gameplay is idle, so the heartbeat cannot
// create rhythmic frame stalls while digging or travelling.
setInterval(()=>{ saveState(); },60000);
setInterval(()=>{ saveCriticalState('heartbeat'); },CRITICAL_SAVE_INTERVAL_MS);
// Expose manual save/load via menu buttons (injected later if menu exists)
window.__injectSaveButtons = function(){ const menuPanel=document.getElementById('menuPanel'); if(!menuPanel || document.getElementById('saveGameBtn')) return; const group=document.createElement('div'); group.className='group'; group.style.cssText='display:flex; flex-direction:column; gap:6px;';
	const row=document.createElement('div'); row.style.cssText='display:flex; gap:6px; flex-wrap:wrap;';
	// Added 'Continue' quick-resume button and Export/Import later
	const continueBtn=document.createElement('button'); continueBtn.id='continueBtn'; continueBtn.textContent='Kontynuuj'; continueBtn.style.minWidth='92px'; continueBtn.style.flex='1';
	const saveBtn=document.createElement('button'); saveBtn.id='saveGameBtn'; saveBtn.textContent='Zapisz';
	const loadBtn=document.createElement('button'); loadBtn.id='loadGameBtn'; loadBtn.textContent='Wczytaj';
	const saveAsBtn=document.createElement('button'); saveAsBtn.id='saveAsBtn'; saveAsBtn.textContent='Zapisz jako';
	[continueBtn,saveBtn,loadBtn,saveAsBtn].forEach(b=>{ b.style.minWidth='72px'; b.style.flex='1'; });
	row.appendChild(continueBtn); row.appendChild(saveBtn); row.appendChild(loadBtn); row.appendChild(saveAsBtn); group.appendChild(row);
	// Save browser
	const browser=document.createElement('div'); browser.id='saveBrowser'; browser.style.cssText='display:none; flex-direction:column; gap:4px; background:rgba(0,0,0,0.35); padding:8px; border:1px solid rgba(255,255,255,0.1); border-radius:8px; max-height:220px; overflow:auto;';
	const browserHeader=document.createElement('div'); browserHeader.style.cssText='display:flex; justify-content:space-between; align-items:center;';
	const title=document.createElement('span'); title.textContent='Zapisy'; title.style.fontSize='12px'; title.style.opacity='0.8';
	const closeB=document.createElement('button'); closeB.textContent='×'; closeB.style.cssText='padding:2px 6px;'; closeB.addEventListener('click',()=>{ browser.style.display='none'; });
	browserHeader.appendChild(title); browserHeader.appendChild(closeB); browser.appendChild(browserHeader);
	// Storage usage line
	const usageLine=document.createElement('div'); usageLine.style.cssText='font-size:10px; opacity:.65; margin-bottom:2px;'; browser.appendChild(usageLine);
	const list=document.createElement('div'); list.style.display='flex'; list.style.flexDirection='column'; list.style.gap='4px'; browser.appendChild(list);
	const SAVE_LIST_KEY='mm_save_slots_meta_v1';
	let currentSlotId=null; // active slot id (persisted separately)
	const LAST_SLOT_KEY='mm_last_slot_v1';
	currentSlotId = localStorage.getItem(LAST_SLOT_KEY) || null;
	function loadSlots(){ try{ const raw=localStorage.getItem(SAVE_LIST_KEY); if(!raw) return []; const arr=JSON.parse(raw); return Array.isArray(arr)?arr:[]; }catch(e){ return []; } }
	function storeSlots(slots){ try{ localStorage.setItem(SAVE_LIST_KEY, JSON.stringify(slots)); }catch(e){} }
	function slotKey(id){ return 'mm_slot_'+id; }
	function writeSaveSlot(key,data,perf){ const t=savePerfNow(); localStorage.setItem(key,data); addSavePerfPart(perf,'slot.write',savePerfNow()-t); publishSavePerf(perf); }
	function refreshList(){ list.innerHTML=''; const slots=loadSlots().sort((a,b)=> b.time-a.time); if(!slots.length){ const empty=document.createElement('div'); empty.textContent='(brak zapisów)'; empty.style.fontSize='11px'; empty.style.opacity='0.6'; list.appendChild(empty); }
		// Recompute storage usage (approx) for keys starting with mm_
		let used=0; try{ for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k && k.startsWith('mm_')){ const v=localStorage.getItem(k); if(v) used += k.length + v.length; } } }catch(e){}
		const totalCap = 5*1024*1024; const pct=((used/totalCap)*100).toFixed(1);
		usageLine.textContent='Użycie storage: '+((used/1024)|0)+' KB (~'+pct+'% z 5MB)'; if(used/totalCap>0.85) usageLine.style.color='#ff8080'; else usageLine.style.color='';
		slots.forEach(s=>{ const row=document.createElement('div'); const isCur=currentSlotId===s.id; row.style.cssText='display:flex; gap:6px; align-items:center; background:'+(isCur?'rgba(60,130,255,0.25)':'rgba(255,255,255,0.05)')+'; padding:4px 6px; border-radius:6px;'+(isCur?'outline:1px solid #2d7bff;':'');
			const info=document.createElement('div'); info.style.flex='1'; info.style.minWidth='0'; const raw=localStorage.getItem(slotKey(s.id)); const sizeKB=raw? ((raw.length/1024)|0):0; let hashState=''; if(raw){ try{ const obj=JSON.parse(raw); const v=verifyHash(obj); if(obj && obj.h){ hashState = v.ok? ('#'+obj.h.slice(0,6)) : '(USZKODZONY)'; if(!v.ok) row.style.background='rgba(255,60,60,0.25)'; } else { hashState='(brak hash)'; } }catch(e){ hashState='(BŁĄD)'; row.style.background='rgba(255,60,60,0.25)'; } }
			// Slot name and seed are user/import-controlled — never interpolate them into HTML
			const nameDisp=(s.name||'Bez nazwy');
			const nameB=document.createElement('b'); nameB.textContent=nameDisp+(isCur?' *':'');
			const meta=document.createElement('span'); meta.style.cssText='font-size:10px; opacity:.65;'; meta.textContent=new Date(s.time).toLocaleString()+' • '+sizeKB+' KB • '+hashState+' • seed '+(s.seed??'-');
			info.textContent=''; info.appendChild(nameB); info.appendChild(document.createElement('br')); info.appendChild(meta);
			const loadB=document.createElement('button'); loadB.textContent='Wczytaj'; loadB.style.fontSize='11px'; loadB.addEventListener('click',()=>{ const raw=localStorage.getItem(slotKey(s.id)); if(raw){ try{ localStorage.setItem(SAVE_KEY,raw); const ok=loadGame({ignoreCritical:true}); if(ok){ currentSlotId=s.id; localStorage.setItem(LAST_SLOT_KEY,currentSlotId); msg('Wczytano '+nameDisp); refreshList(); } else msg('Błąd wczyt.'); }catch(e){ msg('Błąd wczyt.'); } } });
			const exportB=document.createElement('button'); exportB.textContent='Eksport'; exportB.style.fontSize='11px'; exportB.addEventListener('click',()=>{ const raw=localStorage.getItem(slotKey(s.id)); if(!raw){ msg('Brak danych'); return; } try{ const blob=new Blob([raw],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); const safe=nameDisp.replace(/[^a-z0-9_-]+/gi,'_'); a.download='save_'+safe+'.json'; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },0); msg('Wyeksportowano'); }catch(e){ msg('Błąd eksportu'); } });
			const renameB=document.createElement('button'); renameB.textContent='Nazwa'; renameB.style.fontSize='11px'; renameB.addEventListener('click',()=>{ const nn=prompt('Nowa nazwa zapisu:', s.name||''); if(nn!=null){ s.name=nn.trim(); storeSlots(slots); refreshList(); }});
			const delB=document.createElement('button'); 
			delB.textContent='Usuń'; 
			delB.style.fontSize='11px'; 
			delB.addEventListener('click',()=>{ 
				if(confirm('Usunąć zapis '+(s.name||s.id)+'?')){ 
					localStorage.removeItem(slotKey(s.id)); 
					const idx=slots.findIndex(x=>x.id===s.id); 
					if(idx>=0 && idx<slots.length){ 
						slots.splice(idx,1); 
						storeSlots(slots); 
						if(currentSlotId===s.id) currentSlotId=null; 
						refreshList(); 
					} 
				} 
			});
			[loadB,exportB,renameB,delB].forEach(b=>{ b.style.padding='2px 6px'; });
			row.appendChild(info); row.appendChild(loadB); row.appendChild(exportB); row.appendChild(renameB); row.appendChild(delB); list.appendChild(row);
		});
		// Enable/disable Continue button visibility
		continueBtn.style.display = slots.length? 'block':'none';
	}
	function performNamedSave(forcePrompt){ const slots=loadSlots(); let initial=''; if(!forcePrompt && currentSlotId){ const cur=slots.find(s=>s.id===currentSlotId); if(cur) initial=cur.name||''; } const name=prompt('Nazwa zapisu:', initial); if(name==null) return; const trimmed=name.trim(); let target=null; if(currentSlotId) target=slots.find(s=>s.id===currentSlotId && (trimmed==='' || s.name===trimmed)); if(!target && trimmed) target=slots.find(s=>s.name===trimmed); const perf={parts:[]}; const rawCore=buildSaveObject({perf}); const {object:withHash} = timedSavePart('hash',()=>attachHash(rawCore),perf); const data=timedSavePart('json',()=>JSON.stringify(withHash),perf); if(target){ try{ writeSaveSlot(slotKey(target.id), data, perf); target.time=Date.now(); if(trimmed) target.name=trimmed; target.seed=WORLDGEN.worldSeed; storeSlots(slots); currentSlotId=target.id; localStorage.setItem(LAST_SLOT_KEY,currentSlotId); msg('Nadpisano '+(target.name||target.id)); refreshList(); }catch(e){ msg('Błąd zapisu'); } } else { const id=Date.now().toString(36)+Math.random().toString(36).slice(2,6); try{ writeSaveSlot(slotKey(id), data, perf); slots.push({id,name:trimmed||null,time:Date.now(),seed:WORLDGEN.worldSeed}); storeSlots(slots); currentSlotId=id; localStorage.setItem(LAST_SLOT_KEY,currentSlotId); msg('Zapisano '+(trimmed||id)); browser.style.display='flex'; refreshList(); }catch(e){ msg('Błąd – brak miejsca?'); } } }

	// Continue button logic
	continueBtn.addEventListener('click',()=>{
		const slots=loadSlots(); if(!slots.length){ msg('Brak zapisów'); return; }
		let targetId=currentSlotId || localStorage.getItem(LAST_SLOT_KEY);
		if(!targetId){ targetId = slots.sort((a,b)=>b.time-a.time)[0].id; }
		const raw=localStorage.getItem(slotKey(targetId)); if(!raw){ msg('Brak danych'); return; }
		try{ localStorage.setItem(SAVE_KEY,raw); const ok=loadGame({ignoreCritical:true}); if(ok){ currentSlotId=targetId; localStorage.setItem(LAST_SLOT_KEY,currentSlotId); msg('Kontynuowano'); refreshList(); } else msg('Błąd'); }catch(e){ msg('Błąd'); }
	});

	// Global import (adds as new slot)
	const importBtn=document.createElement('button'); importBtn.textContent='Importuj plik'; importBtn.style.cssText='margin-top:4px;';
	const fileInput=document.createElement('input'); fileInput.type='file'; fileInput.accept='.json,application/json'; fileInput.style.display='none';
	fileInput.addEventListener('change',e=>{ const f=fileInput.files&&fileInput.files[0]; if(!f){ return; } const reader=new FileReader(); reader.onload=()=>{ try{ const txt=String(reader.result); const obj=JSON.parse(txt);
		// Validate shape before trusting anything from the file (seed reaches worldgen and slot metadata)
		const valid = obj && typeof obj==='object' && typeof obj.v==='number'
			&& (obj.seed==null || typeof obj.seed==='number')
			&& (obj.world==null || (typeof obj.world==='object' && (obj.world.modified==null || Array.isArray(obj.world.modified)) && (obj.world.chunkRefs==null || Array.isArray(obj.world.chunkRefs))))
			&& (obj.player==null || typeof obj.player==='object');
		if(!valid){ msg('Niepoprawny plik'); return; }
		const slots=loadSlots(); const id=Date.now().toString(36)+Math.random().toString(36).slice(2,6); localStorage.setItem(slotKey(id), txt); slots.push({id,name:(f.name||'import').replace(/\.json$/i,'')||null,time:Date.now(),seed:(typeof obj.seed==='number'? obj.seed:null)}); storeSlots(slots); msg('Zaimportowano'); refreshList(); }catch(err){ msg('Błąd importu'); } fileInput.value=''; };
	reader.readAsText(f); });
	importBtn.addEventListener('click',()=>fileInput.click());
	group.appendChild(importBtn); group.appendChild(fileInput);
	saveBtn.addEventListener('click',()=>{ performNamedSave(false); });
	loadBtn.addEventListener('click',()=>{ const ok=loadGame(); msg(ok?'Wczytano zapis główny':'Brak głównego zapisu'); });
	saveAsBtn.addEventListener('click',()=>{ performNamedSave(true); });
	const openBrowserBtn=document.createElement('button'); openBrowserBtn.textContent='Lista zapisów'; openBrowserBtn.style.cssText='margin-top:4px;'; openBrowserBtn.addEventListener('click',()=>{ browser.style.display= browser.style.display==='flex' ? 'none':'flex'; if(browser.style.display==='flex') refreshList(); });
	group.appendChild(openBrowserBtn); group.appendChild(browser);
	menuPanel.appendChild(group);
};
document.addEventListener('DOMContentLoaded',()=>{ setTimeout(()=>window.__injectSaveButtons(),200); });
// Lightweight saveState(): mark dirty now, serialize later only when the player is
// idle. Full save serialization can be expensive after long tunnel edits because it
// encodes every modified chunk and writes localStorage synchronously.
function canRunIdleAutoSave(){
	const now=Date.now();
	if(_nextAutoSaveRetryAt && now<_nextAutoSaveRetryAt) return false;
	if(now-_lastAutoSaveAt<AUTO_SAVE_MIN_GAP_MS) return false;
	if(now-_lastSaveActivityAt<AUTO_SAVE_IDLE_REQUIRED_MS) return false;
	try{
		if(document.visibilityState==='hidden') return true;
		if(Math.abs(player.vx)>0.05 || Math.abs(player.vy)>0.05) return false;
		if(mining || mineBtnHeld || fireBtnHeld || minePointerId!=null || weaponPointerId!=null) return false;
		if(activePointers && activePointers.size) return false;
		for(const k in keys){ if(keys[k]) return false; }
	}catch(e){ return false; }
	return true;
}
function scheduleAutoSaveWork(delay){
	if(_autoSaveWorkT || !_saveDirty) return;
	_autoSaveWorkT=setTimeout(runAutoSaveWork, Math.max(0, delay||0));
}
function createAutoSaveJob(){
	return {id:Date.now().toString(36)+'_'+(_saveRevision|0).toString(36), chunks:modifiedChunkIds(), index:0, refs:[], oldRefs:currentAutosaveRefs(), revision:_saveRevision, t0:savePerfNow(), bytes:0, encodeMs:0, chunkWriteMs:0, auditMs:0};
}
function finishIncrementalAutoSave(){
	const job=_autoSaveJob; if(!job) return false;
	const t0=savePerfNow();
	const perf={parts:[]};
	addSavePerfPart(perf,'chunks.encode',job.encodeMs||0);
	addSavePerfPart(perf,'chunks.write',job.chunkWriteMs||0);
	addSavePerfPart(perf,'chunks.audit',job.auditMs||0);
	try{
		const data=buildSaveObject({lightweight:true, chunkRefs:job.refs, auditChunkIds:[], perf});
		const {object:withHash} = timedSavePart('hash',()=>attachHash(data),perf);
		const json=timedSavePart('json',()=>JSON.stringify(withHash),perf);
		const writeT=savePerfNow();
		localStorage.setItem(SAVE_KEY,json);
		const writeMs=savePerfNow()-writeT;
		addSavePerfPart(perf,'storage.write',writeMs);
		timedSavePart('storage.cleanup',()=>cleanupAutosaveChunks(new Set(job.refs.map(r=>r.key)),job.oldRefs),perf);
		const elapsed=(savePerfNow()-job.t0);
		const finalMs=(savePerfNow()-t0);
		const totalKB=((json.length+job.bytes)/1024)|0;
		publishSavePerf(perf);
		try{ window.__lastSaveMs=elapsed; window.__lastSaveWriteMs=finalMs; window.__lastSaveSizeKb=totalKB; window.__lastSaveChunks=job.refs.length; window.__lastSaveMode='incremental'; }catch(e){}
		recordSaveSuccess();
		saveCriticalState('incremental',true);
		_autoSaveJob=null;
		_lastAutoSaveAt=Date.now();
		_saveDirty = _saveRevision!==job.revision;
		showAutoSaveHint(totalKB);
		if(_saveDirty) scheduleDirtySave(AUTO_SAVE_IDLE_CHECK_MS);
		return true;
	}catch(e){
		console.warn('Incremental autosave failed',e);
		cleanupAutosaveChunks(new Set(),job.refs);
		recordSaveFailure(e,false);
		_autoSaveJob=null;
		return false;
	}
}
function runAutoSaveWork(){
	_autoSaveWorkT=null;
	if(!_saveDirty) return;
	if(!canRunIdleAutoSave()){ scheduleDirtySave(AUTO_SAVE_IDLE_CHECK_MS); return; }
	try{
		if(!_autoSaveJob) _autoSaveJob=createAutoSaveJob();
		const job=_autoSaveJob;
		const t0=savePerfNow();
		const worldMap=WORLD._world;
		let processed=0;
		while(job.index<job.chunks.length){
			const rawRef=job.chunks[job.index++];
			const ref=normalizeWorldChunkRef(rawRef);
			if(!ref) continue;
			const cx=ref.cx;
			const arr=worldMap && worldMap.get(ref.key);
			const ver=worldChunkVersion(ref);
			if(!arr || ver===0) continue;
			const auditT=savePerfNow();
			if(ref.base){
				try{ if(FALLING && FALLING.auditChunks) FALLING.auditChunks([cx],{force:true,immediate:true}); }catch(e){}
				try{ if(MEAT && MEAT.auditChunks) MEAT.auditChunks([cx],getTile); }catch(e){}
				try{ if(GASES && GASES.auditChunks) GASES.auditChunks([cx],getTile); }catch(e){}
			}
			job.auditMs += savePerfNow()-auditT;
			const encT=savePerfNow();
			const data=encodeRLE(chunkForTerrainSave(arr));
			job.encodeMs += savePerfNow()-encT;
			const saveRef={cx,key:ref.base?autosaveChunkKey(cx,job.id):autosaveChunkKey(cx,job.id,ref.sy),rle:true,h:computeHash(data)};
			if(!ref.base){ saveRef.sy=ref.sy; saveRef.sectionH=ref.h||worldSectionHeight(); }
			const writeT=savePerfNow();
			localStorage.setItem(saveRef.key,data);
			job.chunkWriteMs += savePerfNow()-writeT;
			job.refs.push(saveRef);
			job.bytes+=data.length;
			processed++;
			if(processed>=1 && savePerfNow()-t0>=AUTO_SAVE_CHUNK_BATCH_MS) break;
		}
		if(job.index<job.chunks.length) scheduleAutoSaveWork(16);
		else if(!finishIncrementalAutoSave()) scheduleDirtySave(AUTO_SAVE_IDLE_CHECK_MS);
	}catch(e){
		console.warn('Autosave batch failed',e);
		if(_autoSaveJob) cleanupAutosaveChunks(new Set(),_autoSaveJob.refs);
		recordSaveFailure(e,false);
		_autoSaveJob=null;
		scheduleDirtySave(AUTO_SAVE_IDLE_CHECK_MS);
	}
}
function scheduleDirtySave(delay){
	if(_saveStateT || _autoSaveWorkT || !_saveDirty) return;
	const retryDelay=_nextAutoSaveRetryAt ? Math.max(0,_nextAutoSaveRetryAt-Date.now()) : 0;
	const baseDelay=delay==null ? AUTO_SAVE_IDLE_CHECK_MS : delay;
	_saveStateT=setTimeout(()=>{
		_saveStateT=null;
		if(!_saveDirty) return;
		if(!canRunIdleAutoSave()){ scheduleDirtySave(AUTO_SAVE_IDLE_CHECK_MS); return; }
		scheduleAutoSaveWork(0);
	}, Math.max(baseDelay,retryDelay));
}
function saveState(){
	_saveDirty=true;
	_saveRevision++;
	saveCriticalState('dirty');
	scheduleDirtySave();
}
window.__mmMarkWorldChanged = function(){
	noteSaveActivity();
	saveState();
};
// Debug/visual-test hook (tools/tile-art-shot.mjs): teleport the hero so headless
// screenshot runs can frame surface/cave scenes without simulated input.
window.__mmDebugHero = function(x,y){
	if(Number.isFinite(x)) player.x=x;
	if(Number.isFinite(y)) player.y=y;
	player.vx=0; player.vy=0;
	return {x:player.x, y:player.y};
};
function flushPendingSave(){
	if(_saveStateT){ clearTimeout(_saveStateT); _saveStateT=null; }
	if(_autoSaveWorkT){ clearTimeout(_autoSaveWorkT); _autoSaveWorkT=null; }
	_autoSaveJob=null;
	saveCriticalState('flush',true);
	if(_saveDirty){ if(saveGame(false)) _saveDirty=false; }
}
window.addEventListener('pagehide',flushPendingSave);
window.addEventListener('beforeunload',flushPendingSave);
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') flushPendingSave(); });
// --- Crafting (data-driven: a recipe is cost + effect; the panel renders itself;
// ingredient labels come from the resource registry RES_LABEL) ---
// Crafted gear flows through the chest-loot pipeline (dynamicLoot → inventory bag),
// so it persists and is equippable like any drop.
function grantCraftedItem(def){
	def.id='crafted_'+def.kind+'_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
	if(!MM.dynamicLoot) MM.dynamicLoot={capes:[],eyes:[],outfits:[],weapons:[],charms:[]};
	const keyMap={cape:'capes', eyes:'eyes', outfit:'outfits', weapon:'weapons', charm:'charms'};
	const key=keyMap[def.kind] || 'charms';
	if(!Array.isArray(MM.dynamicLoot[key])) MM.dynamicLoot[key]=[];
	MM.dynamicLoot[key].push(def);
	if(CHESTS && CHESTS.saveDynamicLoot) CHESTS.saveDynamicLoot();
	if(window.updateDynamicCustomization) window.updateDynamicCustomization();
	if(MM.inventory) MM.inventory.equip(def.id);
	msg('Wytworzono: '+def.name+' (założono)');
}
const RECIPES=[
	{id:'pick_bedrock', name:'Kilof macierzysty', cost:{motherIce:1, motherLava:1, diamond:1}, done:()=>hasBedrockPick(), make(){ inv.tools.bedrock=true; inv.bedrockPickDurability=BEDROCK_PICK_MAX_DURABILITY; msg('Kilof macierzysty: niszczy skale macierzysta, ale ma tylko '+BEDROCK_PICK_MAX_DURABILITY+' uderzen'); }},
	{id:'pick_stone', name:'Kilof kamienny', cost:{stone:10}, done:()=>inv.tools.stone, make(){ inv.tools.stone=true; msg('Kilof kamienny (przełączaj klawiszem 1)'); }},
	{id:'pick_meteoric_iron', name:'Kilof meteorytowy', cost:{meteoricIron:5, coal:2}, done:()=>inv.tools.meteor, make(){ inv.tools.meteor=true; msg('Kilof meteorytowy iskrzy na kamieniu (przelaczaj klawiszem 1)'); }},
	{id:'pick_diamond', name:'Kilof diamentowy', cost:{diamond:5}, done:()=>inv.tools.diamond, make(){ inv.tools.diamond=true; msg('Kilof diamentowy (przełączaj klawiszem 1)'); }},
	{id:'torches', name:'Pochodnie ×4', cost:{wood:2}, make(){ inv.torch+=4; msg('Pochodnie +4 — przypisz do paska i stawiaj (świecą nocą)'); }},
	{id:'coal_torches', name:'Pochodnie z węgla ×8', cost:{wood:1, coal:1}, make(){ inv.torch+=8; msg('Pochodnie +8 — węgiel pali się długo'); }},
	{id:'ladders', name:'Drabinki x6', cost:{wood:3}, make(){ inv.ladder+=6; msg('Drabinki +6 - stawiaj na blokach; W/S wspina sie po nich'); }},
	{id:'wood_doors', name:'Drzwi drewniane x2', cost:{wood:3}, make(){ inv.woodDoor+=2; msg('Drzwi drewniane +2 - przepuszczaja bohatera i NPC, ale blokuja zwierzeta i gaz'); }},
	{id:'stone_doors', name:'Drzwi kamienne x2', cost:{stone:4}, make(){ inv.stoneDoor+=2; msg('Drzwi kamienne +2 - ciezsze, mocniejsze, dalej przechodnie dla ludzi'); }},
	{id:'steel_doors', name:'Drzwi stalowe x2', cost:{steel:2}, make(){ inv.steelDoor+=2; msg('Drzwi stalowe +2 - solidne przejscie dla baz i ruin'); }},
	{id:'wood_trapdoors', name:'Zapadnie drewniane x2', cost:{wood:2}, make(){ inv.woodTrapdoor+=2; msg('Zapadnie drewniane +2 - chodzisz po nich, S/dol otwiera przejscie'); }},
	{id:'stone_trapdoors', name:'Zapadnie kamienne x2', cost:{stone:3}, make(){ inv.stoneTrapdoor+=2; msg('Zapadnie kamienne +2 - nosne przejscie pionowe dla ludzi'); }},
	{id:'steel_trapdoors', name:'Zapadnie stalowe x2', cost:{steel:2}, make(){ inv.steelTrapdoor+=2; msg('Zapadnie stalowe +2 - mocny luk techniczny dla baz'); }},
	{id:'arrows_wood_small', name:'Strzaly drewniane x10', cost:{wood:1}, make(){ inv.arrowWood+=10; msg('Strzaly drewniane +10'); }},
	{id:'arrows_wood_bulk', name:'Strzaly drewniane x100', cost:{wood:10}, make(){ inv.arrowWood+=100; msg('Strzaly drewniane +100'); }},
	{id:'arrows_stone_bulk', name:'Strzaly kamienne x100', cost:{wood:10, stone:1}, make(){ inv.arrowStone+=100; msg('Strzaly kamienne +100'); }},
	{id:'arrows_obsidian_bulk', name:'Strzaly obsydianowe x100', cost:{wood:10, obsidian:1}, make(){ inv.arrowObsidian+=100; msg('Strzaly obsydianowe +100'); }},
	{id:'arrows_diamond_bulk', name:'Strzaly diamentowe x100', cost:{wood:10, diamond:1}, make(){ inv.arrowDiamond+=100; msg('Strzaly diamentowe +100'); }},
	{id:'arrows_iridium_bulk', name:'Strzaly irydowe x100', cost:{wood:10, iridium:1}, make(){ inv.arrowIridium+=100; msg('Strzaly irydowe +100'); }},
	{id:'obsidian_sword', name:'Miecz obsydianowy', cost:{obsidian:4, wood:2}, make(){ grantCraftedItem({kind:'weapon',weaponType:'melee',name:'Miecz obsydianowy',attackDamage:6,tier:'rare',desc:'Wykuty z hartowanej lawy'}); }},
	{id:'lucky_charm', name:'Talizman diamentowy', cost:{diamond:3}, make(){ grantCraftedItem({kind:'charm',name:'Talizman diamentowy',mineSpeedMult:1.15,visionRadius:12,tier:'rare',desc:'Diament oszlifowany w talizman'}); }},
	{id:'spring_antler_charm', name:'Wieniec wiosny', cost:{springAntler:1, leaf:6, wood:2}, make(){ grantCraftedItem({kind:'charm',name:'Wieniec wiosny',moveSpeedMult:1.10,visionRadius:14,tier:'epic',desc:'Trofeum wiosennego jelenia; lekki krok i czujne oczy'}); }},
	{id:'summer_horn_charm', name:'Rog letniego zubra', cost:{summerHorn:1, grass:8, copper:1}, make(){ grantCraftedItem({kind:'charm',name:'Rog letniego zubra',attackDamage:3,energyCapacityBonus:40,tier:'epic',desc:'Ciezki talizman sily, ciepla i zapasu energii'}); }},
	{id:'autumn_heartwood_bow', name:'Luk jesiennego serca', cost:{autumnHeartwood:1, wood:4, leaf:4, copperWire:1}, make(){ grantCraftedItem({kind:'weapon',weaponType:'bow',name:'Luk jesiennego serca',attackDamage:8,fireCooldown:0.45,jumpPowerMult:1.05,tier:'epic',desc:'Sprezyste drewno z jesiennego losia; szybki, mocny luk'}); }},
	{id:'winter_fur_cape', name:'Plaszcz zimowego futra', cost:{winterFur:1, snow:8, leaf:2}, make(){ grantCraftedItem({kind:'cape',name:'Plaszcz zimowego futra',airJumps:2,moveSpeedMult:1.05,jumpPowerMult:1.10,tier:'epic',desc:'Cieply plaszcz z zimowego niedzwiedzia; pomaga przetrwac wiatr i mroz'}); }},
	{id:'glass_from_sand', name:'Wypalone szklo x2', cost:{sand:2, coal:1}, make(){ inv.glass+=2; msg('Szklo +2 - piasek wypalony weglem'); }},
	{id:'bricks_from_clay', name:'Cegly z gliny x3', cost:{clay:3, coal:1}, make(){ inv.brick+=3; msg('Cegly +3 - glina wypalona na ceramiczny budulec'); }},
	{id:'chimneys', name:'Kominy x3', cost:{brick:3}, make(){ inv.chimney+=3; msg('Kominy +3 - pionowy przewod wypuszcza dym i gazy przez dach'); }},
	{id:'steel_from_meteoric_iron', name:'Stal x2', cost:{meteoricIron:2, coal:1}, make(){ inv.steel+=2; msg('Stal +2 - stop meteorytowego zelaza'); }},
	{id:'transistor_basic', name:'Tranzystor', cost:{copper:1, plastic:1, meteorDust:1}, make(){ inv.transistor+=1; msg('Tranzystor +1 - podstawowy element maszyn'); }},
	{id:'respawn', name:'Totem odrodzenia', cost:{stone:5, wood:2}, make(){ inv.respawnTotem+=1; msg('Totem odrodzenia +1 - postaw go jak blok; po smierci wracasz do najblizszego'); }},
	{id:'dynamo', name:'Dynamo', cost:{steel:4, wire:2, copper:2, transistor:1}, make(){ inv.dynamo+=1; msg('Dynamo +1 - R obraca; pionowe dziala w zaporach wodnych'); }},
	{id:'copper_wire', name:'Przewod miedziany x4', cost:{copper:2, plastic:1}, make(){ inv.copperWire+=4; msg('Przewod miedziany +4 - laczy dynama z maszynami'); }},
	{id:'solar_panel', name:'Panel sloneczny x2', cost:{glass:3, wire:3, copperWire:1}, make(){ inv.solarPanel+=2; msg('Panel sloneczny +2 - wystaw na czyste niebo i pelne slonce'); }},
	{id:'solar_battery', name:'Panel sloneczny z bateria', cost:{solarPanel:2, transistor:1, copperWire:2}, make(){ inv.solarBattery+=1; msg('Panel sloneczny z bateria +1 - powoli magazynuje energie dla sieci'); }},
	{id:'spring_platform', name:'Platforma sprezynowa', cost:{steel:2, copperWire:2, transistor:1}, make(){ inv.springPlatform+=1; msg('Platforma sprezynowa +1 - zasil ja dla pelnego wybicia'); }},
	{id:'tracks', name:'Gasienice x3', cost:{steel:2, coal:1}, make(){ inv.track+=3; msg('Gasienice +3 - modul napedu dla ciezkich konstrukcji'); }},
	{id:'chair_wood', name:'Fotel drewniany', cost:{wood:3}, make(){ inv.chairWood+=1; msg('Fotel drewniany +1 - mebel: w domu przyspiesza leczenie, na maszynie z gasienicami sterujesz nia jak mechem'); }},
	{id:'chair_stone', name:'Fotel kamienny', cost:{stone:4, wood:1}, make(){ inv.chairStone+=1; msg('Fotel kamienny +1 - trwalszy mebel do domu i kabiny mecha'); }},
	{id:'chair_steel', name:'Fotel stalowy', cost:{steel:2, copperWire:1}, make(){ inv.chairSteel+=1; msg('Fotel stalowy +1 - mebel; jako fotel pilota najlepiej przenosi energie bohatera na naped'); }},
	{id:'water_pipe', name:'Rury fluidowe x6', cost:{steel:1, plastic:1}, make(){ inv.waterPipe+=6; msg('Rury fluidowe +6 - prowadza wode, pare, gorace powietrze i gazy'); }},
	{id:'water_pump', name:'Pompa fluidowa', cost:{steel:3, copperWire:2, transistor:1}, make(){ inv.waterPump+=1; msg('Pompa fluidowa +1 - R obraca wejscie/wyjscie dla wody i gazow'); }},
	{id:'vending_machine', name:'Automat vendingowy', cost:{steel:4, glass:2, copperWire:3, waterPipe:1, transistor:2}, make(){ inv.vendingMachine+=1; msg('Automat vendingowy +1 - podlacz do zasilania i licz na szczescie'); }},
	{id:'teleporter', name:'Teleporter', cost:{steel:6, copperWire:6, transistor:2, diamond:1, dynamo:1}, make(){ inv.teleporter+=1; msg('Teleporter +1 - wejdz w lewo/prawo, aby skoczyc do kolejnego'); }},
	{id:'antigravity_beacon', name:'Beacon antygrawitacyjny', cost:{antimatter:1, iridium:2, meteoricIron:4, copperWire:4, transistor:1}, make(){ inv.antigravityBeacon+=1; msg('Beacon antygrawitacyjny +1 - odchyla nadlatujace meteoryty'); }},
	{id:'meteor_siren', name:'Syrena meteorytowa', cost:{meteoricIron:2, copperWire:3, transistor:1, coal:1}, make(){ inv.meteorSiren+=1; msg('Syrena meteorytowa +1 - ostrzega przed meteorytami w okolicy'); }},
	{id:'crater_scanner', name:'Skaner kraterow', cost:{meteoricIron:2, copperWire:1, transistor:1, iridium:1}, make(){ inv.craterScanner+=1; msg('Skaner kraterow +1 - analizuje najblizszy krater meteorytowy'); }},
	{id:'turret', name:'Wiezyczka', cost:{steel:4, copperWire:3, transistor:1}, make(){ inv.turret+=1; msg('Wiezyczka +1 - laduje sie z przewodow i strzela do wrogow'); }},
	{id:'fire_turret', name:'Wiezyczka ogniowa', cost:{steel:4, copperWire:4, transistor:1, coal:3}, make(){ inv.fireTurret+=1; msg('Wiezyczka ogniowa +1 - podpala nadchodzacych wrogow'); }},
	{id:'water_turret', name:'Wiezyczka wodna', cost:{steel:4, copperWire:4, transistor:1, water:4}, make(){ inv.waterTurret+=1; msg('Wiezyczka wodna +1 - gasi i odpycha cele strumieniem wody'); }},
	{id:'bio_companion', name:'Bio-pomocnik', cost:{alienBiomass:3, meat:2}, make(){ const c=(COMPANIONS && COMPANIONS.spawnFromCraft) ? COMPANIONS.spawnFromCraft(player,{biomass:3,meat:2,getTile,refund:{alienBiomass:3,meat:2}}) : null; return !!c; }},
	{id:'bio_companion_feed', name:'Dokarm bio-pomocnika', cost:{alienBiomass:1, meat:1}, make(){ return !!(COMPANIONS && COMPANIONS.feedNearest && COMPANIONS.feedNearest(player,1,{meat:1,refund:{alienBiomass:1,meat:1}})); }},
	{id:'ufo_alien_companion', name:'Macierzysty alien-companion', cost:{motherIce:1}, make(){ const c=(COMPANIONS && COMPANIONS.spawnUfoAlienFromCraft) ? COMPANIONS.spawnUfoAlienFromCraft(player,{motherIce:1,getTile,refund:{motherIce:1}}) : null; return !!c; }},
	{id:'leaf_monster', name:'Lisciany potworek', cost:{leaf:8, servantStone:1}, make(){ const c=(COMPANIONS && COMPANIONS.spawnLeafMonsterFromCraft) ? COMPANIONS.spawnLeafMonsterFromCraft(player,{leaves:8,servantStone:1,getTile,refund:{leaf:8,servantStone:1}}) : null; return !!c; }},
	// Fishing (engine/fishing.js): rod unlocks the F-key minigame; fish feed soups
	{id:'fishing_rod', name:'Wędka', cost:{wood:2, grass:4}, make(){ inv.fishingRod+=1; msg('🎣 Wędka +1 — stań nad wodą i naciśnij F. Gdy spławik drgnie (❗), F podcina!'); }},
	{id:'fish_soup', name:'Zupa rybna', cost:{fish:2, water:1}, make(){ healHero(30,'fish_soup'); msg('🍲 Zupa rybna: +30 HP'); try{ if(MM.audio && MM.audio.play) MM.audio.play('heal'); }catch(e){} }},
	{id:'mushroom_soup', name:'Zupa grzybowa', cost:{glowshroom:3, water:1}, make(){ healHero(25,'mushroom_soup'); msg('🍄 Zupa grzybowa: +25 HP'); try{ if(MM.audio && MM.audio.play) MM.audio.play('heal'); }catch(e){} }},
	{id:'potion_depths', name:'Eliksir głębin', cost:{goldenFish:1, water:2}, make(){ if(MM.progress && MM.progress.addBuff) MM.progress.addBuff({name:'Głębiny', icon:'🐠', dur:90, stats:{waterMoveSpeedMult:1.25, jumpPowerMult:1.2}}); msg('🐠 Eliksir głębin: ruch w wodzie 125%, skok +20% (90 s)'); try{ if(MM.audio && MM.audio.play) MM.audio.play('heal'); }catch(e){} }},
	// Consumables: brewed and drunk on the spot (timed buffs ride the modifier-source registry)
	{id:'potion_heal', name:'Eliksir życia', cost:{water:2, leaf:3}, make(){ healHero(40,'potion_heal'); msg('🧪 Eliksir życia: +40 HP'); try{ if(MM.audio && MM.audio.play) MM.audio.play('heal'); }catch(e){} }},
	{id:'potion_speed', name:'Mikstura szybkości', cost:{water:1, leaf:2, diamond:1}, make(){ if(MM.progress && MM.progress.addBuff) MM.progress.addBuff({name:'Szybkość', icon:'💨', dur:60, stats:{moveSpeedMult:1.3, jumpPowerMult:1.15}}); msg('💨 Szybkość +30%, skok +15% (60 s)'); try{ if(MM.audio && MM.audio.play) MM.audio.play('heal'); }catch(e){} }},
	{id:'potion_strength', name:'Mikstura siły', cost:{water:1, obsidian:1}, make(){ if(MM.progress && MM.progress.addBuff) MM.progress.addBuff({name:'Siła', icon:'💪', dur:60, stats:{attackDamage:5}}); msg('💪 Obrażenia +5 (60 s)'); try{ if(MM.audio && MM.audio.play) MM.audio.play('heal'); }catch(e){} }},
	// Big-ticket sink: summon a boss on demand (works over water — sea beasts answer too)
	{id:'boss_horn', name:'Róg przyzwania', cost:{diamond:5, obsidian:5}, make(){
		let m=null;
		try{ if(MM.bosses && MM.bosses.forceSpawn){ const side=Math.random()<0.5?-1:1; m=MM.bosses.forceSpawn(null,{x:Math.round(player.x+side*20)}) || MM.bosses.forceSpawn(null,{x:Math.round(player.x-side*20)}); } }catch(e){}
		msg(m? ('📯 '+m.name+' odpowiedział na zew!') : '📯 Róg zabrzmiał w pustkę… (zwrot kosztów)');
		if(!m){ inv.diamond+=5; inv.obsidian+=5; }
	}},
	// Antimatter sink (the resource drops from downed UFOs)
	{id:'potion_antigrav', name:'Mikstura antygrawitacji', cost:{antimatter:1, water:1}, make(){ if(MM.progress && MM.progress.addBuff) MM.progress.addBuff({name:'Antygrawitacja', icon:'🛸', dur:60, stats:{jumpPowerMult:1.6, moveSpeedMult:1.15}}); msg('🛸 Antygrawitacja: skok +60%, ruch +15% (60 s)'); try{ if(MM.audio && MM.audio.play) MM.audio.play('heal'); }catch(e){} }},
];
const CRAFT_GROUPS=[
	{id:'all',label:'Wszystko'},
	{id:'survival',label:'Start'},
	{id:'tools',label:'Narzedzia'},
	{id:'building',label:'Budowle'},
	{id:'processing',label:'Przerob'},
	{id:'weapons',label:'Walka'},
	{id:'machines',label:'Maszyny'},
	{id:'alchemy',label:'Eliksiry'},
	{id:'relics',label:'Relikty'},
	{id:'other',label:'Inne'}
];
const CRAFT_GROUP_LABELS={}; CRAFT_GROUPS.forEach(g=>{ CRAFT_GROUP_LABELS[g.id]=g.label; });
const CRAFT_GROUP_ORDER={}; CRAFT_GROUPS.forEach((g,i)=>{ CRAFT_GROUP_ORDER[g.id]=i; });
const CRAFT_RECIPE_META={
	pick_bedrock:{group:'tools',icon:'⛏️',tint:'#9b8cff',desc:'Kruchy reliktowy kilof: przebija skale macierzysta, po 10 przelamaniach rozpada sie.'},
	pick_stone:{group:'tools',icon:'⛏️',tint:'#888a90',desc:'Pierwszy realny krok ponad kopanie rekami.'},
	pick_meteoric_iron:{group:'tools',icon:'⛏️',tint:'#c56f32',desc:'Szybsze kopanie twardej skaly i materialow z kraterow.'},
	pick_diamond:{group:'tools',icon:'⛏️',tint:'#3ef',desc:'Najczystszy klasyczny awans narzedziowy.'},
	torches:{group:'survival',icon:'🕯️',out:'torch',amount:4,desc:'Male swiatlo do nocy, jaskin i baz.'},
	coal_torches:{group:'survival',icon:'🕯️',out:'torch',amount:8,desc:'Wiecej swiatla z tej samej ilosci drewna.'},
	ladders:{group:'building',icon:'🪜',out:'ladder',amount:6,desc:'Przechodnie szczeble do pionowych szybikow i scian.'},
	wood_doors:{group:'building',icon:'🚪',out:'woodDoor',amount:2,desc:'Nosne, przechodnie dla bohatera i NPC.'},
	stone_doors:{group:'building',icon:'🚪',out:'stoneDoor',amount:2,desc:'Ciezsze drzwi do baz i ruin.'},
	steel_doors:{group:'building',icon:'🚪',out:'steelDoor',amount:2,desc:'Najmocniejsza wersja drzwi.'},
	wood_trapdoors:{group:'building',icon:'🕳️',out:'woodTrapdoor',amount:2,desc:'Poziome przejscie: chodzisz po nim, schodzisz po wskazaniu dolu.'},
	stone_trapdoors:{group:'building',icon:'🕳️',out:'stoneTrapdoor',amount:2,desc:'Nosna zapadnia do szybikow i pieter.'},
	steel_trapdoors:{group:'building',icon:'🕳️',out:'steelTrapdoor',amount:2,desc:'Techniczna zapadnia dla mocnych konstrukcji.'},
	arrows_wood_small:{group:'weapons',icon:'🏹',out:'arrowWood',amount:10,desc:'Tania amunicja do pierwszego luku.'},
	arrows_wood_bulk:{group:'weapons',icon:'🏹',out:'arrowWood',amount:100,desc:'Paczka amunicji na dluzsza wyprawe.'},
	arrows_stone_bulk:{group:'weapons',icon:'🏹',out:'arrowStone',amount:100,desc:'Kamienne groty sa stabilniejsze i mocniejsze.'},
	arrows_obsidian_bulk:{group:'weapons',icon:'🏹',out:'arrowObsidian',amount:100,desc:'Ostre groty z wulkanicznego szkla.'},
	arrows_diamond_bulk:{group:'weapons',icon:'🏹',out:'arrowDiamond',amount:100,desc:'Droga, precyzyjna amunicja.'},
	arrows_iridium_bulk:{group:'weapons',icon:'🏹',out:'arrowIridium',amount:100,desc:'Amunicja z materialu meteorytowego.'},
	obsidian_sword:{group:'weapons',icon:'🗡️',tint:'#7a5cc1',desc:'Craftowany ekwipunek trafia do torby i od razu sie zaklada.'},
	lucky_charm:{group:'relics',icon:'🍀',tint:'#3ef',desc:'Pasywny talizman z klasycznego rzadkiego surowca.'},
	spring_antler_charm:{group:'relics',icon:'🦌',tint:'#d8a96b',desc:'Sezonowe trofeum zamienione w staly bonus.'},
	summer_horn_charm:{group:'relics',icon:'🐂',tint:'#9b6b38',desc:'Ciezki talizman sily i energii.'},
	autumn_heartwood_bow:{group:'relics',icon:'🏹',tint:'#b57936',desc:'Sezonowy luk z wyraznym progiem rozwoju.'},
	winter_fur_cape:{group:'relics',icon:'🧥',tint:'#e8f4ff',desc:'Ciepla peleryna do zimnych i wietrznych wypraw.'},
	glass_from_sand:{group:'processing',icon:'🪟',out:'glass',amount:2,desc:'Podstawowy lancuch: piasek plus paliwo daje szklo.'},
	bricks_from_clay:{group:'processing',icon:'🧱',out:'brick',amount:3,desc:'Glina wypalona paliwem daje twardy ceramiczny budulec.'},
	chimneys:{group:'building',icon:'K',out:'chimney',amount:3,desc:'Pionowy przewod przez dach: wypuszcza dym, pare, gorace powietrze i gazy.'},
	steel_from_meteoric_iron:{group:'processing',icon:'⚙️',out:'steel',amount:2,desc:'Przetop metalu z kraterow w budowlana stal.'},
	transistor_basic:{group:'processing',icon:'🧩',out:'transistor',amount:1,desc:'Maly komponent spinajacy maszyny wyzszego poziomu.'},
	respawn:{group:'survival',icon:'🚩',tint:'#ff6a21',desc:'Tworzy stawiany totem; po smierci wracasz do najblizszego.'},
	dynamo:{group:'machines',icon:'⚡',out:'dynamo',amount:1,desc:'Zrodlo energii dla miasta, pomp i maszyn.'},
	copper_wire:{group:'machines',icon:'🔌',out:'copperWire',amount:4,desc:'Laczy zasilanie z maszynami.'},
	solar_panel:{group:'machines',icon:'🔆',out:'solarPanel',amount:2,desc:'Slaby panel: dziala tylko w bezchmurne, pelne swiatlo dnia.'},
	solar_battery:{group:'machines',icon:'🔋',out:'solarBattery',amount:1,desc:'Slaby panel z magazynem; laduje sie tylko w czystym sloncu.'},
	spring_platform:{group:'machines',icon:'⏫',out:'springPlatform',amount:1,desc:'Wybija bardzo wysoko po zasileniu; bez energii daje tylko jedna trzecia wysokosci.'},
	tracks:{group:'machines',icon:'=',out:'track',amount:3,desc:'Trzyblokowy modul napedu gasienicowego.'},
	chair_wood:{group:'building',icon:'🪑',out:'chairWood',amount:1,desc:'Zwykly mebel: w oswietlonym domu przyspiesza leczenie. Postawiony na maszynie z gasienicami staje sie fotelem pilota (drewno slabo przenosi energie bohatera).'},
	chair_stone:{group:'building',icon:'🪑',out:'chairStone',amount:1,desc:'Trwalszy mebel do domu i kabiny mecha; lepiej przenosi energie bohatera.'},
	chair_steel:{group:'building',icon:'🪑',out:'chairSteel',amount:1,desc:'Najtrwalszy fotel: komfort w domu, a jako fotel pilota pelne przeniesienie energii bohatera na naped.'},
	water_pipe:{group:'machines',icon:'🚰',out:'waterPipe',amount:6,desc:'Prowadzi wode, pare, gorace powietrze i gazy.'},
	water_pump:{group:'machines',icon:'🌀',out:'waterPump',amount:1,desc:'Wymusza przeplyw fluidow i gazow przez rury.'},
	vending_machine:{group:'machines',icon:'🎰',out:'vendingMachine',amount:1,desc:'Losowy automat do baz: cenny lup albo kompletne rozczarowanie.'},
	teleporter:{group:'machines',icon:'🌌',out:'teleporter',amount:1,desc:'Paruje odlegle punkty podrozy.'},
	antigravity_beacon:{group:'machines',icon:'🛸',out:'antigravityBeacon',amount:1,desc:'Ochrona przed meteorytami dla dojrzalszych baz.'},
	meteor_siren:{group:'machines',icon:'📢',out:'meteorSiren',amount:1,desc:'Ostrzega przed zagrozeniem z nieba.'},
	crater_scanner:{group:'machines',icon:'📡',out:'craterScanner',amount:1,desc:'Wykrywa i opisuje okoliczne kratery.'},
	turret:{group:'machines',icon:'🗼',out:'turret',amount:1,desc:'Podstawowa obrona zasilanej bazy.'},
	fire_turret:{group:'machines',icon:'🔥',out:'fireTurret',amount:1,desc:'Obrona ogniowa do walki z falami wrogow.'},
	water_turret:{group:'machines',icon:'💦',out:'waterTurret',amount:1,desc:'Obrona wodna, gaszenie i kontrola terenu.'},
	bio_companion:{group:'weapons',icon:'🐾',tint:'#79c95d',desc:'Tworzy proceduralnego pomocnika z biomasy i surowego miesa; chodzi za bohaterem, strzela laserem i emituje trucizne.'},
	bio_companion_feed:{group:'weapons',icon:'🍖',tint:'#bd5145',desc:'Wzmacnia najblizszego bio-pomocnika. Kazda porcja biomasy zwieksza jego maksymalne HP.'},
	ufo_alien_companion:{group:'weapons',icon:'👽',tint:'#d8fbff',desc:'Tworzy elitarnego kompana z lodu macierzystego. Rola i wyglad pochodza z alien teamu.'},
	leaf_monster:{group:'weapons',icon:'🍃',tint:'#2faa2f',desc:'Tworzy kruchego, bardzo szybkiego potworka z lisci i kamienia slugi. Lata, ale wiatr rzuca nim mocniej niz innymi.'},
	fishing_rod:{group:'survival',icon:'🎣',out:'fishingRod',amount:1,desc:'Odblokowuje wędkowanie: F przy wodzie zarzuca, F przy braniu (❗) podcina. Duże ryby szarpią kilka razy!'},
	fish_soup:{group:'alchemy',icon:'🍲',tint:'#6fb7d9',desc:'Sycące leczenie ze świeżego połowu.'},
	mushroom_soup:{group:'alchemy',icon:'🍄',tint:'#7de3a8',desc:'Leczenie ze świecących grzybów jaskiniowych.'},
	potion_depths:{group:'alchemy',icon:'🐠',tint:'#ffd76a',desc:'Dar złotej rybki: szybkie pływanie i mocniejszy skok.'},
	potion_heal:{group:'alchemy',icon:'🧪',tint:'#ff5a5a',desc:'Natychmiastowe leczenie.'},
	potion_speed:{group:'alchemy',icon:'💨',tint:'#a8d7ff',desc:'Czasowy buff ruchu i skoku.'},
	potion_strength:{group:'alchemy',icon:'💪',tint:'#ffb84a',desc:'Czasowy buff obrazen.'},
	boss_horn:{group:'relics',icon:'📯',tint:'#e0b341',desc:'Dobrowolne wzywanie klopotow, kiedy nagroda kusi za mocno.'},
	potion_antigrav:{group:'alchemy',icon:'🎈',tint:'#c46bff',desc:'Czasowy buff skoku i lekkiego ruchu.'}
};
RECIPES.forEach(r=>{ if(CRAFT_RECIPE_META[r.id]) Object.assign(r, CRAFT_RECIPE_META[r.id]); });
function recipeDone(r){ try{ return !!(r.done && r.done()); }catch(e){ return false; } }
// Crafting meta-state (favorites, the 📌-tracked recipe, NEW badges, craft
// counters) lives in engine/crafting.js and is covered headless by
// crafting-sim; main.js keeps recipe effects and the DOM.
const CRAFT_MODEL=createCraftingModel({recipes:RECIPES, getHave:k=>inv[k]||0, isDone:recipeDone});
function recipeCostEntries(r){ return Object.entries(r.cost || {}); }
function recipeGroup(r){
	if(r.group) return r.group;
	if(/^pick_/.test(r.id)) return 'tools';
	if(/door|trapdoor|glass/.test(r.id)) return 'building';
	if(/arrow|sword|bow/.test(r.id)) return 'weapons';
	if(/potion|horn/.test(r.id)) return 'alchemy';
	if(/wire|pipe|pump|turret|dynamo|solar|spring|teleporter|beacon|siren|scanner|vending|transistor/.test(r.id)) return 'machines';
	return 'other';
}
function recipeOutputName(r){ return r.out ? (RES_LABEL[r.out] || r.out) : (r.name || r.id); }
function recipeMaxCrafts(r){
	return CRAFT_MODEL.maxCrafts(r);
}
function recipeMissing(r){
	return CRAFT_MODEL.missing(r);
}
function canCraft(r){ return recipeMaxCrafts(r)>0; }
function doCraft(r,count){
	const target=Math.max(1, Math.min(99, count|0 || 1));
	let made=0;
	for(let i=0;i<target;i++){
		if(!canCraft(r)) break;
		for(const k in r.cost) inv[k]-=r.cost[k];
		const madeOk=r.make();
		if(madeOk===false) break;
		made++;
		if(recipeDone(r)) break;
	}
	if(!made) return;
	CRAFT_MODEL.recordCraft(r.id, made);
	craftFlashId=r.id;
	try{ if(MM.audio && MM.audio.play) MM.audio.play('craft'); }catch(e){}
	updateInventory();
}
const CRAFT_COLLAPSED_KEY='mm_craft_collapsed_v1';
const CRAFT_GROUP_KEY='mm_craft_group_v1';
const CRAFT_AVAIL_KEY='mm_craft_avail_v1';
let selectedCraftId=null;
let craftQuery='';
let craftGroup='all';
let craftAvailOnly=false;
let craftFlashId=null;       // recipe id to pulse the detail panel for after a craft
let craftTrackerBooted=false; // first tracker refresh swallows a stale justReady toast on load
function resetCraftingAvailability(){ CRAFT_MODEL.reset(); }
function snapshotCrafting(){
	return CRAFT_MODEL.snapshot();
}
function restoreCraftingAvailability(src){
	CRAFT_MODEL.restore(src);
}
function checkCraftingAvailability(opts){
	const silent=!!(opts&&opts.silent);
	if(silent){ CRAFT_MODEL.seedSeen(); return; }
	const newly=CRAFT_MODEL.syncAvailability();
	if(!newly.length) return;
	const shown=newly.slice(0,3).map(r=>r.name||r.id).join(', ');
	const extra=newly.length>3 ? ' (+'+(newly.length-3)+')' : '';
	msg('Nowe receptury w Rzemiosle: '+shown+extra);
}
function loadCraftCollapsed(){
	try{
		const v=localStorage.getItem(CRAFT_COLLAPSED_KEY);
		if(v!==null) return v==='1';
	}catch(e){ return false; }
	// No saved preference: on a touch screen the open panel would cover the whole
	// view (phones especially), so first runs boot with it tucked away.
	return !!(MM.inputMode && MM.inputMode.isTouch());
}
function loadCraftGroup(){
	try{ return localStorage.getItem(CRAFT_GROUP_KEY) || 'all'; }catch(e){ return 'all'; }
}
function saveCraftGroup(group){
	try{ localStorage.setItem(CRAFT_GROUP_KEY, group); }catch(e){}
}
function loadCraftAvailOnly(){
	try{ return localStorage.getItem(CRAFT_AVAIL_KEY)==='1'; }catch(e){ return false; }
}
function setCraftCollapsed(host, collapsed){
	if(!host) return;
	host.dataset.collapsed=collapsed?'true':'false';
	const body=document.getElementById('craftBody');
	const toggle=document.getElementById('craftToggle');
	if(body) body.hidden=!!collapsed;
	if(toggle){
		toggle.textContent=collapsed?'+':'-';
		toggle.setAttribute('aria-expanded', String(!collapsed));
		toggle.title=(collapsed?'Rozwiń rzemiosło':'Zwiń rzemiosło')+' (T)';
	}
	try{ localStorage.setItem(CRAFT_COLLAPSED_KEY, collapsed?'1':'0'); }catch(e){}
}
function toggleCraftPanel(){
	const host=document.getElementById('craft'); if(!host) return;
	setCraftCollapsed(host, host.dataset.collapsed!=='true');
}
function recipeSearchText(r){
	const parts=[r.id,r.name,recipeOutputName(r),CRAFT_GROUP_LABELS[recipeGroup(r)]||'',r.desc||''];
	recipeCostEntries(r).forEach(([k])=>parts.push(k,RES_LABEL[k]||''));
	return parts.join(' ').toLowerCase();
}
function filteredCraftRecipes(){
	const q=craftQuery.trim().toLowerCase();
	let list=RECIPES.filter(r=> craftGroup==='fav' ? CRAFT_MODEL.isFavorite(r.id) : (craftGroup==='all' || recipeGroup(r)===craftGroup));
	if(craftAvailOnly) list=list.filter(r=>canCraft(r) && !recipeDone(r));
	if(q) list=list.filter(r=>recipeSearchText(r).includes(q));
	return list.sort((a,b)=>{
		const fa=CRAFT_MODEL.isFavorite(a.id)?0:1, fb=CRAFT_MODEL.isFavorite(b.id)?0:1;
		if(fa!==fb) return fa-fb;
		if(craftGroup==='all' || craftGroup==='fav'){
			const ga=CRAFT_GROUP_ORDER[recipeGroup(a)] ?? 999;
			const gb=CRAFT_GROUP_ORDER[recipeGroup(b)] ?? 999;
			if(ga!==gb) return ga-gb;
		}
		const ra=canCraft(a)?0:(recipeDone(a)?2:1);
		const rb=canCraft(b)?0:(recipeDone(b)?2:1);
		if(ra!==rb) return ra-rb;
		const na=CRAFT_MODEL.isFresh(a.id)?0:1, nb=CRAFT_MODEL.isFresh(b.id)?0:1;
		if(na!==nb) return na-nb;
		return (a.name||a.id).localeCompare(b.name||b.id);
	});
}
function makeCraftChip(k,need,compact){
	const have=inv[k]||0;
	const chip=document.createElement('span');
	chip.className='craftChip'+(have<need?' missing':'');
	const hint=have<need ? CRAFT_SOURCE_HINTS[k] : null;
	chip.title=(RES_LABEL[k]||k)+': '+have+' / '+need+(hint?' — '+hint:'');
	const sw=document.createElement('i');
	sw.style.background=RES_COLOR[k] || '#9ca3af';
	chip.appendChild(sw);
	const text=document.createElement('span');
	text.textContent=compact ? have+'/'+need : (RES_LABEL[k]||k)+' '+have+'/'+need;
	chip.appendChild(text);
	return chip;
}
function appendCraftCosts(parent,r,compact){
	const entries=recipeCostEntries(r);
	if(!entries.length){
		const chip=document.createElement('span'); chip.className='craftChip'; chip.textContent='bez kosztu'; parent.appendChild(chip); return;
	}
	entries.forEach(([k,v])=>parent.appendChild(makeCraftChip(k,v,compact)));
}
// Detail-pane ingredient row: swatch + label + have/need + fill bar; short
// recipes also say WHERE to find the missing resource (SOURCE_HINTS).
function makeIngredientRow(k,need){
	const have=inv[k]||0;
	const ok=have>=need;
	const row=document.createElement('div'); row.className='craftIng'+(ok?' ok':' short');
	const top=document.createElement('div'); top.className='craftIngTop';
	const sw=document.createElement('i'); sw.className='craftIngSwatch'; sw.style.background=RES_COLOR[k]||'#9ca3af';
	const lab=document.createElement('span'); lab.className='craftIngLabel'; lab.textContent=RES_LABEL[k]||k;
	const val=document.createElement('b'); val.className='craftIngVal'; val.textContent=Math.min(have,9999)+' / '+need;
	top.appendChild(sw); top.appendChild(lab); top.appendChild(val); row.appendChild(top);
	const bar=document.createElement('div'); bar.className='craftIngBar';
	const fill=document.createElement('i'); fill.style.width=Math.round(100*Math.min(1,have/Math.max(1,need)))+'%';
	bar.appendChild(fill); row.appendChild(bar);
	if(!ok && CRAFT_SOURCE_HINTS[k]){
		const hint=document.createElement('div'); hint.className='craftIngHint'; hint.textContent='↳ '+CRAFT_SOURCE_HINTS[k];
		row.appendChild(hint);
	}
	return row;
}
function renderCraftTabs(){
	const tabs=document.getElementById('craftTabs'); if(!tabs) return;
	tabs.innerHTML='';
	const favIds=new Set(CRAFT_MODEL.favoriteIds());
	const defs=CRAFT_GROUPS.slice();
	if(favIds.size) defs.splice(1,0,{id:'fav',label:'★'});
	const known=new Set(defs.map(g=>g.id));
	if(!known.has(craftGroup)) craftGroup='all';
	defs.forEach(g=>{
		const members=g.id==='all' ? RECIPES : (g.id==='fav' ? RECIPES.filter(r=>favIds.has(r.id)) : RECIPES.filter(r=>recipeGroup(r)===g.id));
		if(g.id!=='all' && !members.length) return;
		const avail=members.filter(canCraft).length;
		const hasFresh=members.some(r=>CRAFT_MODEL.isFresh(r.id));
		const b=document.createElement('button');
		b.type='button';
		b.className='craftTab'+(craftGroup===g.id?' selected':'');
		b.setAttribute('aria-pressed', String(craftGroup===g.id));
		b.title=g.label+': dostępne teraz '+avail+' z '+members.length;
		const lab=document.createElement('span'); lab.textContent=g.label; b.appendChild(lab);
		if(avail){ const c=document.createElement('span'); c.className='craftTabCount'; c.textContent=String(avail); b.appendChild(c); }
		if(hasFresh){ const dot=document.createElement('span'); dot.className='craftTabNew'; dot.title='Nowe receptury'; b.appendChild(dot); }
		b.addEventListener('click',()=>{ craftGroup=g.id; saveCraftGroup(g.id); renderCraftPanel(); });
		tabs.appendChild(b);
	});
}
function craftIconTint(r){ return (r.out && RES_COLOR[r.out]) || r.tint || null; }
function renderCraftDetail(r){
	const detail=document.getElementById('craftDetail'); if(!detail) return;
	detail.innerHTML='';
	detail.classList.remove('flash');
	if(!r){
		const empty=document.createElement('div'); empty.className='craftEmpty'; empty.textContent='Brak receptur dla filtra.'; detail.appendChild(empty); return;
	}
	if(craftFlashId===r.id){ detail.classList.add('flash'); craftFlashId=null; }
	const done=recipeDone(r);
	const max=recipeMaxCrafts(r);
	const head=document.createElement('div'); head.className='craftDetailHeader';
	const icon=document.createElement('span'); icon.className='craftDetailIcon'; icon.textContent=r.icon || (recipeOutputName(r)[0]||'?').toUpperCase();
	const tint=craftIconTint(r);
	if(tint) icon.style.background='linear-gradient(160deg,'+tint+'44, rgba(255,255,255,.08))';
	const names=document.createElement('div');
	const h=document.createElement('strong'); h.textContent=r.name;
	const sub=document.createElement('span'); sub.textContent=(CRAFT_GROUP_LABELS[recipeGroup(r)]||'Inne')+(r.out && r.amount ? ' · wynik: '+r.amount+' × '+recipeOutputName(r) : '');
	names.appendChild(h); names.appendChild(sub);
	const favOn=CRAFT_MODEL.isFavorite(r.id);
	const fav=document.createElement('button'); fav.type='button'; fav.className='craftFavBtn'+(favOn?' on':'');
	fav.textContent=favOn?'★':'☆';
	fav.title=favOn?'Usuń z ulubionych':'Dodaj do ulubionych (przypina na górze listy)';
	fav.addEventListener('click',()=>{ CRAFT_MODEL.toggleFavorite(r.id); renderCraftPanel(); });
	head.appendChild(icon); head.appendChild(names); head.appendChild(fav); detail.appendChild(head);
	if(r.desc){
		const desc=document.createElement('div'); desc.className='craftDesc'; desc.textContent=r.desc; detail.appendChild(desc);
	}
	const ings=document.createElement('div'); ings.className='craftIngs';
	const entries=recipeCostEntries(r);
	if(entries.length) entries.forEach(([k,v])=>ings.appendChild(makeIngredientRow(k,v)));
	else { const free=document.createElement('div'); free.className='craftIngHint'; free.textContent='Bez kosztu.'; ings.appendChild(free); }
	detail.appendChild(ings);
	const miss=recipeMissing(r);
	const status=document.createElement('div'); status.className='craftStatus';
	if(done){ status.classList.add('done'); status.textContent='Gotowe - masz juz ten wariant.'; }
	else if(miss.length) status.textContent='Brakuje: '+miss.map(x=>x.missing+' × '+(RES_LABEL[x.key]||x.key)).join(', ');
	else { status.classList.add('ok'); status.textContent='Mozesz wytworzyc teraz'+(max>1?' (zapas na ×'+Math.min(99,max)+')':'')+'.'; }
	detail.appendChild(status);
	const crafted=CRAFT_MODEL.countOf(r.id);
	if(crafted>0){
		const st=document.createElement('div'); st.className='craftCrafted'; st.textContent='Wytworzono dotąd: ×'+crafted;
		detail.appendChild(st);
	}
	const actions=document.createElement('div'); actions.className='craftActions';
	const tracking=CRAFT_MODEL.trackedId()===r.id;
	const track=document.createElement('button'); track.type='button'; track.className='craftTrackBtn'+(tracking?' on':'');
	track.textContent=tracking?'📌 Śledzone':'📌 Śledź';
	track.title=tracking?'Przestań śledzić składniki tej receptury':'Przypnij licznik składników tej receptury do ekranu';
	track.addEventListener('click',()=>{ CRAFT_MODEL.toggleTracked(r.id); renderCraftPanel(); });
	actions.appendChild(track);
	const primary=document.createElement('button'); primary.type='button'; primary.className='craftPrimary'; primary.textContent=done?'Gotowe':'Wytwórz'; primary.disabled=!canCraft(r);
	primary.addEventListener('click',()=>doCraft(r,1));
	actions.appendChild(primary);
	if(!done && max>=5){
		const b5=document.createElement('button'); b5.type='button'; b5.className='craftSecondary'; b5.textContent='×5'; b5.title='Wytwórz 5 sztuk';
		b5.addEventListener('click',()=>doCraft(r,5)); actions.appendChild(b5);
	}
	if(!done && max>=2){
		const bm=document.createElement('button'); bm.type='button'; bm.className='craftSecondary'; bm.textContent='Max ×'+Math.min(99,max); bm.title='Wytwórz maksymalną liczbę od razu';
		bm.addEventListener('click',()=>doCraft(r,Math.min(99,max))); actions.appendChild(bm);
	}
	detail.appendChild(actions);
}
function makeCraftRow(r){
	const done=recipeDone(r);
	const available=canCraft(r);
	const fresh=CRAFT_MODEL.isFresh(r.id);
	const row=document.createElement('div');
	row.id='craft_'+r.id;
	row.className='craftRecipe craftBtn'+(available?' available':'')+(done?' done':'')+(selectedCraftId===r.id?' selected':'')+(fresh?' fresh':'');
	row.tabIndex=0;
	row.setAttribute('role','button');
	row.setAttribute('aria-pressed', String(selectedCraftId===r.id));
	function choose(){ selectedCraftId=r.id; CRAFT_MODEL.markSeen(r.id); renderCraftPanel(); }
	row.addEventListener('click',choose);
	row.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); choose(); } });
	const icon=document.createElement('span'); icon.className='craftIcon'; icon.textContent=r.icon || (recipeOutputName(r)[0]||'?').toUpperCase();
	const tint=craftIconTint(r);
	if(tint) icon.style.background='linear-gradient(160deg,'+tint+'55, rgba(255,255,255,.07))';
	row.appendChild(icon);
	const main=document.createElement('span'); main.className='craftRecipeMain';
	const top=document.createElement('span'); top.className='craftRecipeTop';
	const name=document.createElement('span'); name.className='craftName'; name.textContent=r.name;
	top.appendChild(name);
	if(fresh){ const nb=document.createElement('span'); nb.className='craftNewBadge'; nb.textContent='NOWE'; top.appendChild(nb); }
	main.appendChild(top);
	const cost=document.createElement('span'); cost.className='craftCost';
	appendCraftCosts(cost,r,true);
	main.appendChild(cost);
	if(!available && !done){
		// bottleneck-ingredient progress toward affordability
		const bar=document.createElement('span'); bar.className='craftRowBar';
		const fill=document.createElement('i'); fill.style.width=Math.round(100*CRAFT_MODEL.progress(r))+'%';
		bar.appendChild(fill); main.appendChild(bar);
	}
	row.appendChild(main);
	const side=document.createElement('span'); side.className='craftRecipeSide';
	const favOn=CRAFT_MODEL.isFavorite(r.id);
	const fav=document.createElement('button'); fav.type='button'; fav.className='craftFavStar'+(favOn?' on':''); fav.textContent=favOn?'★':'☆';
	fav.title=favOn?'Usuń z ulubionych':'Dodaj do ulubionych';
	fav.addEventListener('click',e=>{ e.stopPropagation(); CRAFT_MODEL.toggleFavorite(r.id); renderCraftPanel(); });
	side.appendChild(fav);
	const state=document.createElement('span'); state.className='craftRecipeState';
	state.textContent=done?'✓':(available?'×'+Math.min(99,recipeMaxCrafts(r)):'');
	if(done) state.title='Masz już ten wariant';
	else if(available) state.title='Możesz wytworzyć tyle sztuk teraz';
	side.appendChild(state);
	row.appendChild(side);
	return row;
}
function renderCraftList(){
	const list=document.getElementById('craftList'); if(!list) return;
	const recipes=filteredCraftRecipes();
	if(!recipes.some(r=>r.id===selectedCraftId)) selectedCraftId=(recipes.find(canCraft)||recipes[0]||{}).id || null;
	list.innerHTML='';
	if(!recipes.length){
		const empty=document.createElement('div'); empty.className='craftEmpty';
		empty.textContent=craftAvailOnly ? 'Nic do wytworzenia - zbierz surowce albo wyłącz filtr „Dostępne".' : 'Brak receptur dla filtra.';
		list.appendChild(empty);
	}
	let lastSection=null;
	recipes.forEach(r=>{
		if(craftGroup==='all'){
			const sec=CRAFT_MODEL.isFavorite(r.id) ? '★ Ulubione' : (CRAFT_GROUP_LABELS[recipeGroup(r)]||'Inne');
			if(sec!==lastSection){
				lastSection=sec;
				const head=document.createElement('div'); head.className='craftListSection'; head.textContent=sec;
				list.appendChild(head);
			}
		}
		list.appendChild(makeCraftRow(r));
	});
	renderCraftDetail(recipes.find(r=>r.id===selectedCraftId) || null);
}
function renderCraftPanel(){
	const host=document.getElementById('craft'); if(!host) return;
	const summary=document.getElementById('craftSummary');
	if(summary){
		const available=RECIPES.filter(canCraft).length;
		const freshN=CRAFT_MODEL.freshCount();
		summary.textContent=available+' dostępnych'+(freshN?' · '+freshN+' NOWE':'');
		summary.classList.toggle('hasNew', freshN>0);
	}
	renderCraftTabs();
	renderCraftList();
	updateCraftTracker();
}
function buildCraftPanel(){
	const host=document.getElementById('craft'); if(!host) return;
	const existingTitle=host.querySelector('.craftTitle') || host.querySelector('strong');
	const label=((existingTitle && existingTitle.textContent) || host.textContent || 'Rzemioslo').trim().replace(/^🛠️\s*/,'') || 'Rzemioslo';
	const wasCollapsed = host.dataset.collapsed==='true' || loadCraftCollapsed();
	craftGroup=loadCraftGroup();
	craftAvailOnly=loadCraftAvailOnly();
	host.innerHTML='';
	const header=document.createElement('div'); header.className='craftHeader';
	const title=document.createElement('strong'); title.className='craftTitle'; title.textContent='🛠️ '+label;
	const summary=document.createElement('span'); summary.id='craftSummary'; summary.className='craftSummary';
	const titleWrap=document.createElement('div'); titleWrap.className='craftTitleWrap'; titleWrap.appendChild(title); titleWrap.appendChild(summary);
	const toggle=document.createElement('button'); toggle.id='craftToggle'; toggle.className='topbtn'; toggle.type='button'; toggle.setAttribute('aria-controls','craftBody');
	toggle.addEventListener('click',()=>{ setCraftCollapsed(host, host.dataset.collapsed!=='true'); });
	header.appendChild(titleWrap); header.appendChild(toggle); host.appendChild(header);
	const body=document.createElement('div'); body.id='craftBody'; body.className='craftBody'; host.appendChild(body);
	const toolbar=document.createElement('div'); toolbar.className='craftToolbar';
	const search=document.createElement('input'); search.id='craftSearch'; search.type='search'; search.placeholder='Szukaj receptury'; search.autocomplete='off'; search.value=craftQuery;
	search.addEventListener('input',()=>{ craftQuery=search.value||''; renderCraftPanel(); });
	toolbar.appendChild(search);
	const availBtn=document.createElement('button'); availBtn.type='button'; availBtn.id='craftAvailBtn'; availBtn.className='craftFilterBtn'+(craftAvailOnly?' on':'');
	availBtn.textContent='✔ Dostępne';
	availBtn.title='Pokazuj tylko receptury, które możesz wytworzyć teraz';
	availBtn.setAttribute('aria-pressed', String(craftAvailOnly));
	availBtn.addEventListener('click',()=>{
		craftAvailOnly=!craftAvailOnly;
		availBtn.classList.toggle('on', craftAvailOnly);
		availBtn.setAttribute('aria-pressed', String(craftAvailOnly));
		try{ localStorage.setItem(CRAFT_AVAIL_KEY, craftAvailOnly?'1':'0'); }catch(e){}
		renderCraftPanel();
	});
	toolbar.appendChild(availBtn);
	body.appendChild(toolbar);
	const tabs=document.createElement('div'); tabs.id='craftTabs'; tabs.className='craftTabs'; body.appendChild(tabs);
	const content=document.createElement('div'); content.className='craftContent';
	const list=document.createElement('div'); list.id='craftList'; list.className='craftList';
	const detail=document.createElement('div'); detail.id='craftDetail'; detail.className='craftDetail';
	content.appendChild(list); content.appendChild(detail); body.appendChild(content);
	setCraftCollapsed(host, wasCollapsed);
	renderCraftPanel();
}
function updateCraftButtons(){ renderCraftPanel(); }
// --- HUD ingredient tracker: the one 📌-pinned recipe stays on screen with
// live have/need chips and announces once whenever it crosses into craftable.
function ensureCraftTracker(){
	let el=document.getElementById('craftTracker');
	if(!el){
		el=document.createElement('div'); el.id='craftTracker'; el.hidden=true;
		const ui=document.getElementById('ui')||document.body;
		ui.appendChild(el);
	}
	return el;
}
function updateCraftTracker(){
	const el=ensureCraftTracker();
	const st=CRAFT_MODEL.trackedStatus();
	const booted=craftTrackerBooted; craftTrackerBooted=true;
	if(!st){ el.hidden=true; el.innerHTML=''; return; }
	if(st.justReady && booted) msg('📌 '+(st.recipe.name||st.recipe.id)+': wszystkie składniki gotowe!');
	el.hidden=false;
	el.innerHTML='';
	el.classList.toggle('ready', st.canCraft);
	const r=st.recipe;
	const head=document.createElement('div'); head.className='craftTrackerHead';
	const name=document.createElement('button'); name.type='button'; name.className='craftTrackerName';
	name.textContent='📌 '+(r.name||r.id);
	name.title='Pokaż recepturę w panelu Rzemiosło';
	name.addEventListener('click',()=>{
		const host=document.getElementById('craft');
		if(host) setCraftCollapsed(host,false);
		craftGroup='all'; craftQuery='';
		const search=document.getElementById('craftSearch'); if(search) search.value='';
		if(craftAvailOnly && !st.canCraft){
			craftAvailOnly=false;
			const ab=document.getElementById('craftAvailBtn');
			if(ab){ ab.classList.remove('on'); ab.setAttribute('aria-pressed','false'); }
		}
		selectedCraftId=r.id;
		renderCraftPanel();
	});
	const close=document.createElement('button'); close.type='button'; close.className='craftTrackerClose'; close.textContent='×'; close.title='Przestań śledzić';
	close.addEventListener('click',()=>{ CRAFT_MODEL.setTracked(null); renderCraftPanel(); });
	head.appendChild(name); head.appendChild(close); el.appendChild(head);
	const chips=document.createElement('div'); chips.className='craftTrackerChips';
	appendCraftCosts(chips,r,true);
	el.appendChild(chips);
	const bar=document.createElement('div'); bar.className='craftTrackerBar';
	const fill=document.createElement('i'); fill.style.width=Math.round(100*st.progress)+'%';
	bar.appendChild(fill); el.appendChild(bar);
	const act=document.createElement('button'); act.type='button'; act.className='craftTrackerCraft';
	act.textContent=st.done?'Gotowe':'Wytwórz';
	act.disabled=!st.canCraft;
	act.addEventListener('click',()=>doCraft(r,1));
	el.appendChild(act);
}
// Blink moved to engine/eyes.js
function updateBlink(now){ if(EYES && EYES.update) EYES.update(now); }
 // Cape physics: chain with gravity that droops when idle and streams when moving
function initScarf(){ CAPE.init(player); if(NECKLACE && NECKLACE.init) NECKLACE.init(player); }
function updateCape(dt){ CAPE.update(player,dt,getTile,isSolid); if(NECKLACE && NECKLACE.update) NECKLACE.update(player,dt,getTile); }
function drawDeathTravelFx(){
	const fx=deathTravelFx;
	if(!fx) return false;
	const raw=deathClamp01(fx.t/fx.dur);
	const travelP=deathTravelProgressAt(raw);
	const pos=deathTravelPointAt(fx,travelP);
	const now=performance.now()*0.001;
	const px=pos.x*TILE, py=pos.y*TILE;
	ctx.save();
	ctx.globalCompositeOperation='lighter';
	ctx.lineCap='round';
	ctx.lineJoin='round';
	const trailStart=deathTravelTrailStartRaw(fx,raw);
	const bolt=deathTravelLightningBolt(fx,trailStart,raw,Math.floor(now*34));
	const flick=0.55+0.45*Math.sin(now*70+fx.seed*0.01);
	const boltA=(0.45+0.42*Math.sin(raw*Math.PI))*flick;
	const passes=[[7,160,190,255,boltA*0.25],
	              [3.2,210,230,255,boltA*0.7],
	              [1.5,255,255,255,boltA]];
	drawDeathLightningPath(ctx,bolt,passes);
	if(raw<0.34){
		const a=1-raw/0.34;
		const sx=fx.from.x*TILE, sy=fx.from.y*TILE;
		ctx.fillStyle='rgba(255,236,132,'+(0.13*a).toFixed(3)+')';
		ctx.fillRect(sx-player.w*TILE*0.52, sy-player.h*TILE*0.58, player.w*TILE*1.04, player.h*TILE*1.05);
		ctx.strokeStyle='rgba(255,244,150,'+(0.54*a).toFixed(3)+')';
		ctx.lineWidth=Math.max(1,TILE*0.045);
		ctx.strokeRect(sx-player.w*TILE*0.48, sy-player.h*TILE*0.54, player.w*TILE*0.96, player.h*TILE*0.96);
		for(let i=0;i<12;i++){
			const r=deathRand(fx.seed,i);
			const ox=(r-0.5)*player.w*TILE*1.2;
			const oy=(deathRand(fx.seed,i+31)-0.5)*player.h*TILE*1.2 - raw*TILE*(0.6+deathRand(fx.seed,i+63));
			const s=Math.max(2,TILE*(0.045+deathRand(fx.seed,i+91)*0.035));
			ctx.fillStyle=(i%3===0)?'rgba(255,244,130,'+(0.75*a).toFixed(3)+')':'rgba(255,208,94,'+(0.58*a).toFixed(3)+')';
			ctx.fillRect(Math.round(sx+ox),Math.round(sy+oy),s,s);
		}
	}
	const rg=ctx.createRadialGradient(px,py,2,px,py,TILE*(1.0+0.35*Math.sin(now*10+fx.seed)));
	rg.addColorStop(0,'rgba(255,255,230,0.92)');
	rg.addColorStop(0.24,'rgba(255,232,96,0.58)');
	rg.addColorStop(0.55,'rgba(255,184,64,0.28)');
	rg.addColorStop(1,'rgba(255,132,42,0)');
	ctx.fillStyle=rg;
	ctx.beginPath();
	ctx.arc(px,py,TILE*(1.08+0.18*Math.sin(now*12)),0,Math.PI*2);
	ctx.fill();
	for(let i=0;i<18;i++){
		const spin=now*(5.0+deathRand(fx.seed,i)*4.4) + i*0.72 + fx.seed*0.017;
		const r=TILE*(0.22 + deathRand(fx.seed,i+7)*0.76) * (0.82+0.28*Math.sin(now*9+i));
		const x=px+Math.cos(spin)*r;
		const y=py+Math.sin(spin*1.25)*r*0.66;
		const s=Math.max(2,TILE*(0.035+deathRand(fx.seed,i+19)*0.05));
		ctx.fillStyle=(i%4===0)?'rgba(255,255,214,0.84)':'rgba(255,205,86,0.76)';
		ctx.fillRect(Math.round(x-s/2),Math.round(y-s/2),s,s);
	}
	if(raw>0.72){
		const a=(raw-0.72)/0.28;
		const tx=fx.to.x*TILE, ty=fx.to.y*TILE;
		ctx.strokeStyle='rgba(255,246,145,'+(0.42*a).toFixed(3)+')';
		ctx.lineWidth=Math.max(1,TILE*0.04);
		for(let i=0;i<3;i++){
			const rr=TILE*(0.42+i*0.28+a*0.5);
			ctx.beginPath();
			ctx.arc(tx,ty,rr,now*2+i,now*2+i+Math.PI*1.45);
			ctx.stroke();
		}
	}
	ctx.restore();
	return true;
}
function drawCape(){ if(deathTravelFx) return; CAPE.draw(ctx,TILE); }
function drawPlayer(){ if(drawDeathTravelFx()) return; const c=MM.customization||{}; let bodyX=(player.x-player.w/2)*TILE; let bodyY=(player.y-player.h/2)*TILE; let bw=player.w*TILE, bh=player.h*TILE;
	const recoil=heroBodyRecoilVisual();
	if(recoil){
		const cx=bodyX+bw*0.5;
		const foot=bodyY+bh;
		bw*=recoil.sx;
		bh*=recoil.sy;
		bodyX=cx-bw*0.5+recoil.ox;
		bodyY=foot-bh+recoil.oy;
	}
	if(energyChargeFx.t>0.01){
		const k=Math.max(0, Math.min(1, energyChargeFx.t/0.55)) * Math.max(0.2, Math.min(1.4, energyChargeFx.intensity||0.4));
		const cx=player.x*TILE, cy=(player.y-0.02)*TILE;
		const pulse=0.5+0.5*Math.sin(performance.now()*0.018);
		ctx.save();
		ctx.globalCompositeOperation='lighter';
		if(energyChargeFx.source){
			const sx=energyChargeFx.source.x*TILE, sy=energyChargeFx.source.y*TILE;
			ctx.strokeStyle='rgba(124,242,255,'+(0.36*k).toFixed(3)+')';
			ctx.lineWidth=Math.max(1,TILE*0.06);
			ctx.beginPath();
			ctx.moveTo(sx,sy);
			const mx=(sx+cx)*0.5 + Math.sin(performance.now()*0.02)*TILE*0.18;
			const my=(sy+cy)*0.5 + Math.cos(performance.now()*0.017)*TILE*0.18;
			ctx.lineTo(mx,my);
			ctx.lineTo(cx,cy);
			ctx.stroke();
		}
		const rg=ctx.createRadialGradient(cx,cy,2,cx,cy,TILE*(0.9+0.45*pulse));
		rg.addColorStop(0,'rgba(255,248,150,'+(0.32*k).toFixed(3)+')');
		rg.addColorStop(0.35,'rgba(90,244,255,'+(0.24*k).toFixed(3)+')');
		rg.addColorStop(1,'rgba(60,120,255,0)');
		ctx.fillStyle=rg;
		ctx.beginPath();
		ctx.arc(cx,cy,TILE*(0.95+0.45*pulse),0,Math.PI*2);
		ctx.fill();
		ctx.strokeStyle='rgba(120,250,255,'+(0.50*k).toFixed(3)+')';
		ctx.lineWidth=Math.max(1,TILE*0.07);
		for(let i=0;i<2;i++){
			const r=TILE*(0.46+i*0.22+0.10*pulse);
			ctx.beginPath();
			ctx.arc(cx,cy,r,performance.now()*0.004+i,performance.now()*0.004+i+Math.PI*1.35);
			ctx.stroke();
		}
		ctx.restore();
	}
	if(turboFx>0.01){
		const k=Math.max(0, Math.min(1, turboFx));
		const cx=player.x*TILE, cy=player.y*TILE;
		const pulse=0.5+0.5*Math.sin(performance.now()*0.026);
		ctx.save();
		ctx.globalCompositeOperation='lighter';
		const rg=ctx.createRadialGradient(cx,cy,TILE*0.15,cx,cy,TILE*(0.72+0.20*pulse));
		rg.addColorStop(0,'rgba(255,255,255,'+(0.20*k).toFixed(3)+')');
		rg.addColorStop(0.38,'rgba(90,245,255,'+(0.22*k).toFixed(3)+')');
		rg.addColorStop(1,'rgba(42,110,255,0)');
		ctx.fillStyle=rg;
		ctx.beginPath();
		ctx.arc(cx,cy,TILE*(0.78+0.20*pulse),0,Math.PI*2);
		ctx.fill();
		ctx.strokeStyle='rgba(150,250,255,'+(0.55*k).toFixed(3)+')';
		ctx.lineWidth=Math.max(1,TILE*0.045);
		for(let i=0;i<2;i++){
			const side=player.facing>=0?1:-1;
			const ox=-side*TILE*(0.24+i*0.12);
			ctx.beginPath();
			ctx.moveTo(cx+ox,cy-TILE*(0.34-i*0.08));
			ctx.lineTo(cx+ox-side*TILE*(0.18+0.08*pulse),cy+TILE*(0.03+i*0.13));
			ctx.lineTo(cx+ox+side*TILE*(0.04+0.05*pulse),cy+TILE*(0.19+i*0.10));
			ctx.stroke();
		}
		ctx.restore();
	}
	if(NECKLACE && NECKLACE.drawBack) NECKLACE.drawBack(ctx,TILE,player);
	// Normalize outfit style to avoid hidden whitespace/case issues
	const style = ((c && c.outfitStyle)!=null ? String(c.outfitStyle) : 'default').trim().toLowerCase();
		 // draw outfit body using shared renderer from inventory.js
		 if(MM && typeof MM.drawOutfit === 'function'){
			 MM.drawOutfit(ctx, bodyX, bodyY, bw, bh, style, c);
		 } else {
			 // fallback (default look)
			 ctx.fillStyle=c.outfitColor||'#f4c05a';
			 ctx.fillRect(bodyX,bodyY,bw,bh);
			 ctx.strokeStyle='#4b3212'; ctx.lineWidth=2; ctx.strokeRect(bodyX,bodyY,bw,bh);
		 }
	if(waterPressureFx>0.03 || waterDamageFx>0.03){
		const t=performance.now();
		ctx.save();
		if(waterPressureFx>0.03){
			const k=Math.max(0,Math.min(1.35,waterPressureFx));
			const crit=Math.max(0,Math.min(1,waterPressureCriticalFx));
			const trem=(Math.sin(t*0.055)+Math.sin(t*0.091+2.4))*TILE*0.018*k;
			const inset=TILE*(0.05+0.08*k+0.045*crit);
			ctx.globalCompositeOperation='source-over';
			ctx.fillStyle='rgba(92,184,255,'+(0.10+0.10*Math.min(1,k)).toFixed(3)+')';
			ctx.fillRect(bodyX+inset+trem,bodyY+bh*0.12,bw*0.22,bh*0.76);
			ctx.fillRect(bodyX+bw-inset-bw*0.22-trem,bodyY+bh*0.12,bw*0.22,bh*0.76);
			ctx.strokeStyle='rgba(194,232,255,'+(0.42+0.32*Math.min(1,k)).toFixed(3)+')';
			ctx.lineWidth=Math.max(1,TILE*(0.035+0.018*crit));
			ctx.lineCap='round';
			for(let i=0;i<3;i++){
				const yy=bodyY+bh*(0.24+i*0.22)+Math.sin(t*0.04+i)*TILE*0.025*k;
				ctx.beginPath();
				ctx.moveTo(bodyX+TILE*0.03,yy);
				ctx.quadraticCurveTo(bodyX+inset+TILE*(0.06+0.02*i),yy+TILE*(0.05-i*0.02),bodyX+bw*0.36,yy);
				ctx.moveTo(bodyX+bw-TILE*0.03,yy);
				ctx.quadraticCurveTo(bodyX+bw-inset-TILE*(0.06+0.02*i),yy-TILE*(0.04-i*0.02),bodyX+bw*0.64,yy);
				ctx.stroke();
			}
			if(crit>0.05){
				ctx.strokeStyle='rgba(255,92,132,'+(0.22+0.42*crit).toFixed(3)+')';
				ctx.lineWidth=Math.max(1,TILE*0.05);
				ctx.strokeRect(bodyX+inset*0.6+trem,bodyY+bh*0.08,bw-inset*1.2-trem*2,bh*0.84);
			}
		}
		if(waterDamageFx>0.03){
			const a=Math.max(0,Math.min(1,waterDamageFx));
			ctx.fillStyle='rgba(175,232,255,'+(0.40*a).toFixed(3)+')';
			const drift=Math.sin(t*0.018)*TILE*0.04;
			for(let i=0;i<5;i++){
				const px=bodyX+bw*(0.15+i*0.18)+Math.sin(t*0.022+i)*TILE*0.08;
				const py=bodyY+bh*(0.10+(i%3)*0.22)+((t*0.035+i*13)%18)*a;
				ctx.beginPath();
				ctx.ellipse(px+drift,py,TILE*0.035,TILE*(0.07+0.015*(i%2)),0,0,Math.PI*2);
				ctx.fill();
			}
		}
		ctx.restore();
	}
	if(NECKLACE && NECKLACE.drawFront) NECKLACE.drawFront(ctx,TILE,player);
	const defendFaceT=(()=>{
		const now=performance.now();
		if(heroDefending(now)) return 1;
		const flash=Math.max(0,(heroDefendFlashUntil||0)-now);
		return Math.max(0,Math.min(1,flash/240));
	})();
	function defendSquintHeight(open,min){
		return Math.max(min,Math.round(open*(1-0.58*defendFaceT)));
	}
	function drawDefendEyeTension(eyeY,eyeOffsetX,eyeW){
		if(defendFaceT<=0.01) return;
		const a=(0.24+0.38*defendFaceT).toFixed(3);
		const left=bodyX+bw/2-eyeOffsetX;
		const right=bodyX+bw/2+eyeOffsetX;
		const y=eyeY-TILE*(0.13+0.02*defendFaceT);
		ctx.save();
		ctx.strokeStyle='rgba(48,31,18,'+a+')';
		ctx.lineWidth=Math.max(1,TILE*0.035);
		ctx.lineCap='round';
		ctx.beginPath();
		ctx.moveTo(left-eyeW*0.75,y-eyeW*0.18);
		ctx.lineTo(left+eyeW*0.62,y+eyeW*0.12);
		ctx.moveTo(right-eyeW*0.62,y+eyeW*0.12);
		ctx.lineTo(right+eyeW*0.75,y-eyeW*0.18);
		ctx.stroke();
		ctx.restore();
	}
	 // Eyes (for all outfits except ninja/ironperson which draw their own above)
	 if(style!=='ninja' && style!=='ironperson') {
		const eyeW=6, eyeHOpen=6; let eyeH = (EYES && EYES.getEyeHeight)? EYES.getEyeHeight(eyeHOpen, c.eyeStyle): eyeHOpen;
		eyeH=defendSquintHeight(eyeH,2);
		 const eyeY=bodyY + bh*0.35; const eyeOffsetX=bw*0.18; const pupilW=2; const pupilShift=player.facing*1.5;
		 function eye(cx){ if(c.eyeStyle==='glow'){ ctx.fillStyle='rgba(255,255,255,0.08)'; ctx.fillRect(cx-eyeW/2-2, eyeY-eyeH/2-2, eyeW+4, eyeH+4); ctx.fillStyle='#8bf9ff'; ctx.fillRect(cx-eyeW/2, eyeY-eyeH/2, eyeW, eyeH); }
			 else if(c.eyeStyle==='sleepy'){ const h=defendSquintHeight(eyeHOpen-3,1); ctx.fillStyle='#fff'; ctx.fillRect(cx-eyeW/2, eyeY-h/2, eyeW, h); if(h>2){ ctx.fillStyle='#111'; ctx.fillRect(cx - pupilW/2 + pupilShift, eyeY - Math.min(h/2-1,2), pupilW, Math.min(h-2,4)); } }
			 else if(c.eyeStyle==='gold'){ ctx.fillStyle='#ffce3a'; ctx.fillRect(cx-eyeW/2, eyeY-eyeH/2, eyeW, eyeH); if(eyeH>2){ ctx.fillStyle='#5a3b00'; ctx.fillRect(cx - pupilW/2 + pupilShift, eyeY - Math.min(eyeH/2-1,2), pupilW, Math.min(eyeH-2,4)); } }
			 else { ctx.fillStyle='#fff'; ctx.fillRect(cx-eyeW/2, eyeY-eyeH/2, eyeW, eyeH); if(eyeH>2){ ctx.fillStyle='#111'; ctx.fillRect(cx - pupilW/2 + pupilShift, eyeY - Math.min(eyeH/2-1,2), pupilW, Math.min(eyeH-2,4)); } } }
		 eye(bodyX+bw/2-eyeOffsetX); eye(bodyX+bw/2+eyeOffsetX);
		 drawDefendEyeTension(eyeY,eyeOffsetX,eyeW);
	 }

	// Draw special eyes overlays for ninja / ironperson
	if(style==='ninja'){
		const eyeW=6, eyeH=defendSquintHeight(3,1), eyeY=bodyY+bh*0.35, eyeOffsetX=bw*0.18;
		const ey=eyeY-eyeH/2;
		ctx.fillStyle='#fff';
		ctx.fillRect(bodyX+bw/2-eyeOffsetX-eyeW/2, ey, eyeW, eyeH);
		ctx.fillRect(bodyX+bw/2+eyeOffsetX-eyeW/2, ey, eyeW, eyeH);
		if(eyeH>1){
			ctx.fillStyle='#3cf';
			ctx.fillRect(bodyX+bw/2-eyeOffsetX-eyeW/2+2, eyeY,2,1);
			ctx.fillRect(bodyX+bw/2+eyeOffsetX-eyeW/2+2, eyeY,2,1);
		}
		drawDefendEyeTension(eyeY,eyeOffsetX,eyeW);
	}
	else if(style==='ironperson'){
		const eyeW=6, eyeH=defendSquintHeight(6,2), eyeY=bodyY+bh*0.35, eyeOffsetX=bw*0.18;
		ctx.fillStyle='#ffd700';
		ctx.fillRect(bodyX+bw/2-eyeOffsetX-eyeW/2, eyeY-eyeH/2, eyeW, eyeH);
		ctx.fillRect(bodyX+bw/2+eyeOffsetX-eyeW/2, eyeY-eyeH/2, eyeW, eyeH);
		drawDefendEyeTension(eyeY,eyeOffsetX,eyeW);
	}
	const faceNow=performance.now();
	if(heroPainUntil>faceNow){
		const k=Math.max(0,Math.min(1,(heroPainUntil-faceNow)/980));
		const mouthY=bodyY+bh*0.60;
		const cx=bodyX+bw/2;
		const wob=Math.sin(faceNow*0.045)*TILE*0.015*k;
		ctx.save();
		ctx.globalAlpha=0.72+0.28*k;
		ctx.strokeStyle=style==='ironperson'?'#ffd36d':'rgba(43,25,18,0.95)';
		ctx.fillStyle='rgba(255,244,220,'+(0.78*k).toFixed(3)+')';
		ctx.lineWidth=Math.max(1,TILE*0.035);
		ctx.fillRect(cx-bw*0.14,mouthY-bh*0.018+wob,bw*0.28,bh*0.045);
		ctx.strokeRect(cx-bw*0.14,mouthY-bh*0.018+wob,bw*0.28,bh*0.045);
		ctx.beginPath();
		ctx.moveTo(cx-bw*0.12,mouthY+wob);
		ctx.lineTo(cx+bw*0.12,mouthY+wob);
		ctx.stroke();
		ctx.lineWidth=Math.max(1,TILE*0.04);
		const eyeY=bodyY+bh*0.30;
		ctx.beginPath();
		ctx.moveTo(cx-bw*0.30,eyeY-bh*0.08);
		ctx.lineTo(cx-bw*0.08,eyeY-bh*0.02);
		ctx.moveTo(cx+bw*0.08,eyeY-bh*0.02);
		ctx.lineTo(cx+bw*0.30,eyeY-bh*0.08);
		ctx.stroke();
		ctx.restore();
	}
	const joyUntil=Math.max(heroJoyUntil,heroCombatJoyUntil);
	if(joyUntil>faceNow && heroPainUntil<=faceNow){
		const combatJoy=heroCombatJoyUntil>faceNow;
		const k=Math.max(0,Math.min(1,(joyUntil-faceNow)/(combatJoy?1350:1800)));
		const mouthY=bodyY+bh*0.58;
		const cx=bodyX+bw/2;
		ctx.save();
		ctx.globalAlpha=0.68+0.32*k;
		ctx.strokeStyle=style==='ironperson'?'#ffe27a':'rgba(55,33,19,0.92)';
		ctx.lineWidth=Math.max(1.4,TILE*0.045);
		ctx.lineCap='round';
		ctx.beginPath();
		ctx.moveTo(cx-bw*0.16,mouthY);
		ctx.quadraticCurveTo(cx,mouthY+bh*(0.13+0.03*Math.sin(performance.now()*0.018)),cx+bw*0.16,mouthY);
		ctx.stroke();
		ctx.fillStyle='rgba(255,230,94,'+((combatJoy?0.38:0.26)*k).toFixed(3)+')';
		ctx.beginPath();
		ctx.arc(cx,mouthY-bh*0.02,TILE*((combatJoy?0.22:0.18)+0.10*k),0,Math.PI*2);
		ctx.fill();
		if(combatJoy){
			ctx.strokeStyle='rgba(255,246,160,'+(0.44*k).toFixed(3)+')';
			ctx.lineWidth=Math.max(1,TILE*0.03);
			ctx.beginPath();
			ctx.moveTo(cx-bw*0.24,mouthY-bh*0.23);
			ctx.lineTo(cx-bw*0.12,mouthY-bh*0.18);
			ctx.moveTo(cx+bw*0.12,mouthY-bh*0.18);
			ctx.lineTo(cx+bw*0.24,mouthY-bh*0.23);
			ctx.stroke();
		}
		ctx.restore();
	}
	// Drop shadow projected onto the ground below (not glued to the feet): it
	// shrinks and fades with height, which sells the jump arc visually.
	{
		const footY=player.y+player.h/2;
		const tx=Math.floor(player.x);
		let gy=-1;
		for(let i=0;i<7;i++){ const yy=Math.floor(footY)+i; if(solidAt(tx,yy)){ gy=yy; break; } }
		if(gy>=0){
			const k=Math.max(0, 1-(gy-footY)/6);
			if(k>0.05){
				ctx.fillStyle='rgba(0,0,0,'+(0.25*k).toFixed(3)+')';
				const shw=bw*0.6*(0.55+0.45*k);
				ctx.beginPath(); ctx.ellipse(player.x*TILE, gy*TILE+2, shw/2, 4*(0.55+0.45*k), 0, 0, Math.PI*2); ctx.fill();
			}
		}
	} }

// Chunk render cache (offscreen canvas per horizontal chunk and vertical section)
const chunkCanvases = new Map(); // key: cX or cX:sY -> {canvas,ctx,version,chests,doorways}
const CHUNK_CANVAS_MIN_KEEP = 10;
const CHUNK_CANVAS_MAX_KEEP = 32;
const chunkRenderDirty = new Map(); // section key -> {min,max,baseVersion,version,full}
let chunkCacheRebuildBudget=3;
let chunkCacheRebuiltThisFrame=0;
let chunkCacheDeferredThisFrame=0;
let chunkCachePartialRebuiltThisFrame=0;
function markChunkRenderDirty(cx,y,pad,baseVersion,nextVersion){
	if(!Number.isFinite(cx)) return;
	if(!Number.isFinite(y) || !worldYInBounds(y)){ return; }
	const sy=worldSectionY(y);
	const key=worldRenderSectionKey(cx,sy);
	const row=worldSectionLocalY(y,sy);
	const p=Math.max(0, Math.min(6, Number.isFinite(pad)?pad:1));
	let d=chunkRenderDirty.get(key);
	if(!d){
		const ver=(WORLD && WORLD.chunkVersion)?WORLD.chunkVersion(cx,sy):0;
		d={min:worldSectionHeight(),max:-1,baseVersion:Number.isFinite(baseVersion)?baseVersion:ver,version:Number.isFinite(nextVersion)?nextVersion:ver,full:false};
		chunkRenderDirty.set(key,d);
	}
	d.min=Math.max(0,Math.min(d.min,row-p));
	d.max=Math.min(worldSectionHeight()-1,Math.max(d.max,row+p));
	if(Number.isFinite(nextVersion)) d.version=nextVersion;
}
function markChunkRenderDirtyFull(cx,baseVersion,nextVersion){
	if(!Number.isFinite(cx)) return;
	const syArg=arguments.length>3 && Number.isFinite(arguments[3]) ? Math.floor(arguments[3]) : null;
	const sections=syArg==null ? Array.from({length:baseWorldSectionMax()+1},(_,i)=>i) : [syArg];
	for(const sy of sections) markChunkRenderDirtyFullSection(cx,sy,baseVersion,nextVersion);
}
function markChunkRenderDirtyFullSection(cx,sy,baseVersion,nextVersion){
	const key=worldRenderSectionKey(cx,sy);
	const h=worldSectionHeight();
	let d=chunkRenderDirty.get(key);
	if(!d){
		const ver=(WORLD && WORLD.chunkVersion)?WORLD.chunkVersion(cx,sy):0;
		d={min:0,max:h-1,baseVersion:Number.isFinite(baseVersion)?baseVersion:ver,version:Number.isFinite(nextVersion)?nextVersion:ver,full:true};
		chunkRenderDirty.set(key,d);
		return;
	}
	d.min=0; d.max=h-1; d.full=true;
	if(Number.isFinite(nextVersion)) d.version=nextVersion;
}
function beginChunkCacheFrame(){
	const ms=Number.isFinite(lastFrameMs) && lastFrameMs>0 ? lastFrameMs : 16;
	chunkCacheRebuildBudget = ms>28 ? 1 : (ms>20 ? 2 : 3);
	chunkCacheRebuiltThisFrame=0;
	chunkCacheDeferredThisFrame=0;
	chunkCachePartialRebuiltThisFrame=0;
}
function canRebuildChunkCache(entry,currentVersion){
	if(!entry || (entry.version===currentVersion && !entry.edgeStale)) return false;
	if(entry.version<0){
		chunkCacheRebuiltThisFrame++;
		if(chunkCacheRebuildBudget>0) chunkCacheRebuildBudget--;
		return true;
	}
	if(chunkCacheRebuildBudget<=0){
		chunkCacheDeferredThisFrame++;
		return false;
	}
	chunkCacheRebuildBudget--;
	chunkCacheRebuiltThisFrame++;
	return true;
}
function trimChunkCanvasCache(centerCx, keep, centerSy){
	keep=Math.max(CHUNK_CANVAS_MIN_KEEP, Math.min(CHUNK_CANVAS_MAX_KEEP, keep|0));
	if(chunkCanvases.size<=keep) return;
	centerSy=Number.isFinite(centerSy) ? centerSy : 0;
	const keys=[...chunkCanvases.keys()].sort((a,b)=>{
		const ar=parseWorldRenderSectionKey(a), br=parseWorldRenderSectionKey(b);
		const ad=ar ? Math.abs(ar.cx-centerCx)+Math.abs((ar.sy==null?0:ar.sy)-centerSy)*0.35 : 999999;
		const bd=br ? Math.abs(br.cx-centerCx)+Math.abs((br.sy==null?0:br.sy)-centerSy)*0.35 : 999999;
		return bd-ad;
	});
	for(const key of keys){
		if(chunkCanvases.size<=keep) break;
		chunkCanvases.delete(key);
	}
}
function hash32(x,y){ let h = (x|0)*374761393 + (y|0)*668265263; h = (h^(h>>>13))*1274126177; h = h^(h>>>16); return h>>>0; }
const shadeColorCache=new Map(); // (hex,delta) pairs recur thousands of times per section bake
function shadeColor(hex,delta){ // hex like #rgb or #rrggbb (we use rrggbb)
	const key=hex+((delta|0)+512);
	const hit=shadeColorCache.get(key);
	if(hit) return hit;
	const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
	const clamp=v=>v<0?0:v>255?255:v; const nr=clamp(r+delta), ng=clamp(g+delta), nb=clamp(b+delta);
	const out='#'+nr.toString(16).padStart(2,'0')+ng.toString(16).padStart(2,'0')+nb.toString(16).padStart(2,'0');
	if(shadeColorCache.size>4096) shadeColorCache.clear();
	shadeColorCache.set(key,out);
	return out; }
function smoothstep(t){ return t*t*(3-2*t); }
function lerp(a,b,t){ return a+(b-a)*t; }
function latticeShade(ix,iy){
	return ((hash32(ix,iy)&0xFF)/255)-0.5;
}
function smoothTerrainNoise(wx,y,scale){
	const fx=wx/scale;
	const fy=y/scale;
	const ix=Math.floor(fx);
	const iy=Math.floor(fy);
	const tx=smoothstep(fx-ix);
	const ty=smoothstep(fy-iy);
	const a=lerp(latticeShade(ix,iy), latticeShade(ix+1,iy), tx);
	const b=lerp(latticeShade(ix,iy+1), latticeShade(ix+1,iy+1), tx);
	return lerp(a,b,ty);
}
function isContinuousTerrainTile(t){
	return t===T.GRASS || t===T.UNSTABLE_GRASS || t===T.SAND || t===T.UNSTABLE_SAND || t===T.QUICKSAND || t===T.CLAY || t===T.WET_CLAY || t===T.BRICK || t===T.CHIMNEY || t===T.DIRT || t===T.STONE || t===T.GRANITE || t===T.BASALT || t===T.BEDROCK || t===T.COAL || t===T.GOLD_ORE || t===T.SNOW || t===T.ICE || t===T.MOTHER_ICE || t===T.MOTHER_LAVA || t===T.MUD || t===T.OBSIDIAN || t===T.WOOD || t===T.STEEL || t===T.TRACK || t===T.UFO_CONCRETE || t===T.IRIDIUM || t===T.METEORIC_IRON || t===T.RADIOACTIVE_ORE || t===T.ALIEN_BIOMASS || t===T.METEOR_DUST || t===T.ANTIMATTER_CRYSTAL || t===T.GLASS || isLeaf(t) || t===T.LAVA;
}
function tileShadeAmp(t){
	if(t===T.DIRT) return 5;
	if(t===T.CLAY) return 5;
	if(t===T.WET_CLAY) return 4;
	if(t===T.BRICK || t===T.CHIMNEY) return 6;
	if(t===T.STONE) return 5;
	if(t===T.GRANITE) return 6;
	if(t===T.BASALT) return 5;
	if(t===T.BEDROCK) return 4;
	if(t===T.SAND || t===T.UNSTABLE_SAND || t===T.QUICKSAND) return 4;
	if(t===T.COAL) return 4;
	if(t===T.GOLD_ORE) return 0;
	if(t===T.STEEL) return 8;
	if(t===T.TRACK) return 6;
	if(t===T.UFO_CONCRETE) return 6;
	if(t===T.METEORIC_IRON) return 6;
	if(t===T.IRIDIUM) return 4;
	if(t===T.RADIOACTIVE_ORE) return 5;
	if(t===T.ALIEN_BIOMASS) return 8;
	if(t===T.METEOR_DUST) return 3;
	if(t===T.ANTIMATTER_CRYSTAL) return 4;
	if(t===T.DIAMOND) return 0;
	if(t===T.WOOD) return 8;
	if(t===T.GRASS || t===T.UNSTABLE_GRASS) return 8;
	if(isLeaf(t)) return 9;
	if(t===T.MUD) return 6;
	if(t===T.LAVA) return 10;
	if(t===T.SNOW) return 3;
	if(t===T.ICE) return 4;
	if(t===T.MOTHER_ICE) return 3;
	if(t===T.MOTHER_LAVA) return 8;
	if(t===T.OBSIDIAN) return 5;
	if(t===T.GLASS) return 3;
	if(t===T.ELECTRONICS || t===T.TRANSISTOR) return 7;
	if(t===T.SOLAR_PANEL || t===T.SOLAR_BATTERY) return 3;
	if(t===T.TELEPORTER) return 5;
	if(t===T.TURRET || t===T.FIRE_TURRET || t===T.WATER_TURRET) return 4;
	if(t===T.SPRING_PLATFORM) return 4;
	if(t===T.ANTIGRAVITY_BEACON) return 3;
	if(t===T.METEOR_SIREN) return 4;
	if(INFO[t] && INFO[t].chestTier) return 4;
	if(INFO[t] && INFO[t].cache) return 5;
	return 22;
}
function terrainShadeDelta(t,wx,y,h){
	const amp=tileShadeAmp(t);
	if(!amp) return 0;
	if(isContinuousTerrainTile(t)){
		const scale = t===T.SNOW || t===T.ICE || t===T.MOTHER_ICE ? 9 : (t===T.COAL || t===T.OBSIDIAN || t===T.BASALT || t===T.BEDROCK || t===T.MOTHER_LAVA ? 6 : 7);
		// two octaves: small-scale grain plus broad patchiness so large rock/soil
		// masses show natural light variation instead of a uniform wash. Rock keeps
		// the macro octave gentle — worldgen already interleaves granite/basalt there
		const fam=tileEdgeFamily(t);
		const macroW=fam===EDGE_ROCK ? 0.30 : 0.55;
		return Math.round((smoothTerrainNoise(wx,y,scale)*0.72 + smoothTerrainNoise(wx,y,scale*3.6)*macroW)*amp*1.12);
	}
	return Math.round(((h & 0xFF)/255 - 0.5)*amp);
}
const backdropColorCache=new Map(); // quantized (brightness, depth) -> css string
function undergroundBackdropColor(wx,y,surf){
	const dd=Math.min(1,(y-surf)/45);
	const hv=hash32(wx,y);
	const jitter=((hv&15)-8)*0.55;
	const macro=window.__mmNoCaveFX?0:smoothTerrainNoise(wx,y,13)*9;
	const L=Math.max(5, Math.round(34-19*dd+jitter+macro));
	// deep caves drift from cool blue toward warm violet-brown rock; quantized so
	// the css string is built once per (L,depth) pair instead of per air tile
	const wq=Math.min(8,Math.max(0,Math.round(dd*8)));
	const key=(L<<4)|wq;
	let c=backdropColorCache.get(key);
	if(!c){
		const warm=wq*0.0275;
		c='rgb('+Math.round(L*(0.92+warm*0.5))+','+Math.round(L*(0.86+warm*0.15))+','+Math.round(L*(1.18-warm*0.45))+')';
		backdropColorCache.set(key,c);
	}
	return c;
}
function drawUndergroundBackdrop(g,px,py,wx,y,surf){
	if(y<=surf) return;
	g.fillStyle=undergroundBackdropColor(wx,y,surf);
	g.fillRect(px,py,TILE,TILE);
	// wavy sediment strata: noise-warped row bands so cave walls read as layered rock
	if(window.__mmNoCaveFX) return;
	const warp=Math.floor(smoothTerrainNoise(wx,y,23)*8);
	if(((y+warp)%11+11)%11===0){
		g.fillStyle='rgba(0,0,0,0.10)';
		g.fillRect(px,py+((hash32(wx,y)>>>7)&7),TILE,2);
	}
}
// Soft contact shadows painted onto cave backdrops along adjacent solid tiles:
// caves stop looking like flat cutouts and gain volume at every wall/ceiling/floor
function drawCaveContactShade(g,px,py,sU,sD,sL,sR){
	if(window.__mmNoCaveFX) return;
	if(sU){ g.fillStyle='rgba(0,0,0,0.17)'; g.fillRect(px,py,TILE,1); g.fillStyle='rgba(0,0,0,0.08)'; g.fillRect(px,py+1,TILE,2); }
	if(sD){ g.fillStyle='rgba(0,0,0,0.12)'; g.fillRect(px,py+TILE-1,TILE,1); g.fillStyle='rgba(0,0,0,0.05)'; g.fillRect(px,py+TILE-3,TILE,2); }
	if(sL){ g.fillStyle='rgba(0,0,0,0.13)'; g.fillRect(px,py,1,TILE); g.fillStyle='rgba(0,0,0,0.06)'; g.fillRect(px+1,py,2,TILE); }
	if(sR){ g.fillStyle='rgba(0,0,0,0.13)'; g.fillRect(px+TILE-1,py,1,TILE); g.fillStyle='rgba(0,0,0,0.06)'; g.fillRect(px+TILE-3,py,2,TILE); }
}
// ---- Tile art v2: neighbor-aware edge lighting ------------------------------
// Tiles of one family render as continuous mass (no seams inside a dirt patch or
// rock face); only faces exposed to open space get sunlit rims, AO shadows and
// material caps. This removes the per-tile grid look without any sprite assets.
const EDGE_ROCK=1, EDGE_EARTH=2, EDGE_SAND=3, EDGE_FROST=4, EDGE_WOOD=5, EDGE_LEAF=6, EDGE_BUILT=7, EDGE_METEOR=8, EDGE_LAVA=9;
function tileEdgeFamily(t){
	switch(t){
		case T.STONE: case T.GRANITE: case T.BASALT: case T.BEDROCK: case T.COAL: case T.GOLD_ORE: case T.DIAMOND:
		case T.OBSIDIAN: case T.VOLCANO_MASTER_STONE: case T.SERVANT_STONE: return EDGE_ROCK;
		case T.DIRT: case T.GRASS: case T.UNSTABLE_GRASS: case T.MUD: case T.CLAY: case T.WET_CLAY: return EDGE_EARTH;
		case T.SAND: case T.UNSTABLE_SAND: case T.QUICKSAND: return EDGE_SAND;
		case T.SNOW: case T.ICE: return EDGE_FROST;
		case T.WOOD: return EDGE_WOOD;
		case T.LEAF: case T.AUTUMN_LEAF_ORANGE: case T.AUTUMN_LEAF_RED: return EDGE_LEAF;
		case T.STEEL: case T.TRACK: case T.BRICK: case T.CHIMNEY: return EDGE_BUILT;
		case T.UFO_CONCRETE: return EDGE_METEOR;
		case T.IRIDIUM: case T.METEORIC_IRON: case T.RADIOACTIVE_ORE: case T.ALIEN_BIOMASS:
		case T.METEOR_DUST: case T.ANTIMATTER_CRYSTAL: return EDGE_METEOR;
		case T.LAVA: return EDGE_LAVA;
		default: return 0;
	}
}
// A neighbor counts as "open" (this face is exposed and should be lit/shaded)
// when it lets light through and belongs to a different material family.
function tileOpenForEdge(fam,n){
	if(n===T.AIR || n===T.WATER) return true;
	const inf=INFO[n];
	if(!inf || !inf.passable) return false;
	return tileEdgeFamily(n)!==fam;
}
// Rounds the sky silhouette of soft materials by clearing 1-2 px corner notches.
// Above ground the notch reveals sky; in caves it is refilled with backdrop color.
function cutTopCornerNotch(g,px,py,left,deep,wx,y,surf){
	const w=deep?3:2;
	const x0=left?px:px+TILE-w;
	const x1=left?px:px+TILE-1;
	const bg=(WORLD && WORLD.getConstructionBackground) ? WORLD.getConstructionBackground(wx,y) : T.AIR;
	if(bg!==T.AIR) return;
	if(y>surf){
		g.fillStyle=undergroundBackdropColor(wx,y,surf);
		g.fillRect(x0,py,w,1);
		g.fillRect(x1,py+1,1,1);
	}else{
		g.clearRect(x0,py,w,1);
		g.clearRect(x1,py+1,1,1);
	}
}
function drawGrassTurfCap(g,px,py,h,x0,x1,openL,openR,sun){
	// under-lip shade so the blade row reads as standing above the soil
	g.fillStyle='rgba(18,60,20,'+(0.24*sun).toFixed(3)+')';
	g.fillRect(px+x0,py+4,x1-x0,2);
	// lush lip: bright sun-struck line over a saturated second row
	g.fillStyle='rgba(212,255,128,'+(0.42*sun).toFixed(3)+')';
	g.fillRect(px+x0,py,x1-x0,1);
	g.fillStyle='rgba(142,224,84,'+(0.34*sun).toFixed(3)+')';
	g.fillRect(px+x0,py+1,x1-x0,1);
	// dense blade tuft texture in the top rows
	for(let i=0;i<7;i++){
		const r=hash32(h+i*53,i*97);
		const bx=px+1+((r>>>3)%18);
		const bh=2+((r>>>8)%4);
		g.fillStyle=(r&1)?'rgba(58,150,44,0.55)':'rgba(126,214,74,0.50)';
		g.fillRect(bx,py+1,1,bh);
	}
	// occasional wildflower
	if((h%23)<2){
		const fx=px+4+((h>>>9)%12);
		const petal=(h>>>13)&3;
		g.fillStyle=petal===0?'rgba(255,255,255,0.85)':petal===1?'rgba(255,214,92,0.85)':petal===2?'rgba(255,132,160,0.85)':'rgba(150,170,255,0.85)';
		g.fillRect(fx-1,py+2,3,1);
		g.fillRect(fx,py+1,1,3);
		g.fillStyle='rgba(255,196,60,0.9)';
		g.fillRect(fx,py+2,1,1);
	}
	// turf drapes a few pixels down exposed sides
	if(openL){
		g.fillStyle='rgba(96,190,64,'+(0.45*sun).toFixed(3)+')';
		g.fillRect(px,py,1,5);
		g.fillStyle='rgba(46,118,44,'+(0.30*sun).toFixed(3)+')';
		g.fillRect(px,py+5,1,3);
	}
	if(openR){
		g.fillStyle='rgba(96,190,64,'+(0.45*sun).toFixed(3)+')';
		g.fillRect(px+TILE-1,py,1,5);
		g.fillStyle='rgba(46,118,44,'+(0.30*sun).toFixed(3)+')';
		g.fillRect(px+TILE-1,py+5,1,3);
	}
}
// The main edge pass: called last for every bakeable terrain tile.
function drawTerrainEdgeFX(g,t,arr,cx,lx,y,originY,sectionH,wx,px,py,h,surf){
	if(window.__mmNoEdgeFX) return;
	const fam=tileEdgeFamily(t);
	if(!fam || t===T.GLASS) return;
	const nU=chunkTileAt(arr,cx,lx,y-1,originY,sectionH);
	const nD=chunkTileAt(arr,cx,lx,y+1,originY,sectionH);
	const nL=chunkTileAt(arr,cx,lx-1,y,originY,sectionH);
	const nR=chunkTileAt(arr,cx,lx+1,y,originY,sectionH);
	const oU=tileOpenForEdge(fam,nU), oD=tileOpenForEdge(fam,nD);
	const oL=tileOpenForEdge(fam,nL), oR=tileOpenForEdge(fam,nR);
	// sunlight strength fades with depth below the surface but never to zero
	const sun=Math.max(0.35, 1-Math.max(0,y-surf)/26);
	// silhouette rounding for soft materials against the sky / cave air above
	let notchL=false, notchR=false;
	if(oU && nU===T.AIR && (fam===EDGE_EARTH || fam===EDGE_SAND || t===T.SNOW)){
		const deep=t===T.SNOW;
		if(oL){ cutTopCornerNotch(g,px,py,true,deep,wx,y,surf); notchL=true; }
		if(oR){ cutTopCornerNotch(g,px,py,false,deep,wx,y,surf); notchR=true; }
	}
	const x0=notchL?(t===T.SNOW?3:2):0;
	const x1=TILE-(notchR?(t===T.SNOW?3:2):0);
	if(oU){
		if(t===T.GRASS || t===T.UNSTABLE_GRASS){
			drawGrassTurfCap(g,px,py,h,x0,x1,oL,oR,sun);
		}else if(t===T.SNOW){
			g.fillStyle='rgba(255,255,255,'+(0.40*sun).toFixed(3)+')'; g.fillRect(px+x0,py,x1-x0,1);
			g.fillStyle='rgba(255,255,255,'+(0.22*sun).toFixed(3)+')'; g.fillRect(px+x0,py+1,x1-x0,1);
			g.fillStyle='rgba(255,255,255,'+(0.10*sun).toFixed(3)+')'; g.fillRect(px+x0,py+2,x1-x0,1);
		}else if(t===T.ICE){
			g.fillStyle='rgba(255,255,255,'+(0.32*sun).toFixed(3)+')'; g.fillRect(px,py,TILE,1);
			g.fillStyle='rgba(214,240,255,'+(0.14*sun).toFixed(3)+')'; g.fillRect(px,py+1,TILE,1);
		}else if(t===T.SAND || t===T.UNSTABLE_SAND || t===T.QUICKSAND){
			g.fillStyle='rgba(255,247,202,'+(0.30*sun).toFixed(3)+')'; g.fillRect(px+x0,py,x1-x0,1);
			g.fillStyle='rgba(255,240,180,'+(0.13*sun).toFixed(3)+')'; g.fillRect(px+x0,py+1,x1-x0,1);
			if((h&7)===0){ g.fillStyle='rgba(255,255,238,0.55)'; g.fillRect(px+3+((h>>>6)%13),py+1,1,1); }
		}else if(fam===EDGE_EARTH){
			g.fillStyle='rgba(236,204,150,'+(0.20*sun).toFixed(3)+')'; g.fillRect(px+x0,py,x1-x0,1);
			g.fillStyle='rgba(214,176,120,'+(0.09*sun).toFixed(3)+')'; g.fillRect(px+x0,py+1,x1-x0,1);
		}else if(t===T.OBSIDIAN){
			g.fillStyle='rgba(168,126,236,'+(0.24*sun).toFixed(3)+')'; g.fillRect(px,py,TILE,1);
			g.fillStyle='rgba(120,86,190,'+(0.10*sun).toFixed(3)+')'; g.fillRect(px,py+1,TILE,1);
		}else if(fam===EDGE_ROCK){
			g.fillStyle='rgba(228,236,246,'+(0.20*sun).toFixed(3)+')'; g.fillRect(px,py,TILE,1);
			g.fillStyle='rgba(228,236,246,'+(0.08*sun).toFixed(3)+')'; g.fillRect(px,py+1,TILE,1);
		}else if(fam===EDGE_WOOD){
			g.fillStyle='rgba(255,214,130,'+(0.20*sun).toFixed(3)+')'; g.fillRect(px,py,TILE,1);
		}else if(fam===EDGE_BUILT){
			g.fillStyle='rgba(255,255,255,'+(0.22*sun).toFixed(3)+')'; g.fillRect(px,py,TILE,1);
			g.fillStyle='rgba(255,255,255,'+(0.09*sun).toFixed(3)+')'; g.fillRect(px,py+1,TILE,1);
		}else if(fam===EDGE_METEOR){
			g.fillStyle='rgba(202,222,255,'+(0.20*sun).toFixed(3)+')'; g.fillRect(px,py,TILE,1);
		}else if(fam===EDGE_LEAF){
			g.fillStyle='rgba(216,255,150,0.30)';
			for(let i=0;i<4;i++){ const r=hash32(h+i*31,i*67); g.fillRect(px+1+((r>>>4)%17),py+((r>>>9)&1),2,1); }
		}else if(fam===EDGE_LAVA){
			g.fillStyle='rgba(255,246,190,0.85)'; g.fillRect(px,py,TILE,1);
			g.fillStyle='rgba(255,196,84,0.45)'; g.fillRect(px,py+1,TILE,1);
			g.fillStyle='rgba(255,124,32,0.18)'; g.fillRect(px,py+2,TILE,2);
		}
	}
	if(oD){
		if(fam===EDGE_LAVA){
			g.fillStyle='rgba(96,18,2,0.42)'; g.fillRect(px,py+TILE-1,TILE,1);
		}else if(fam===EDGE_LEAF){
			g.fillStyle='rgba(10,50,16,0.30)';
			for(let i=0;i<4;i++){ const r=hash32(h+i*41,i*89); g.fillRect(px+1+((r>>>5)%17),py+TILE-1-((r>>>10)&1),2,1); }
		}else if(t===T.ICE){
			g.fillStyle='rgba(40,90,160,0.16)'; g.fillRect(px,py+TILE-3,TILE,3);
		}else if(t===T.SNOW){
			g.fillStyle='rgba(110,140,195,0.16)'; g.fillRect(px,py+TILE-2,TILE,2);
		}else{
			const deep=fam===EDGE_ROCK||fam===EDGE_BUILT||fam===EDGE_METEOR;
			g.fillStyle='rgba(6,8,16,'+(deep?0.26:0.20)+')'; g.fillRect(px,py+TILE-1,TILE,1);
			g.fillStyle='rgba(6,8,16,'+(deep?0.13:0.10)+')'; g.fillRect(px,py+TILE-2,TILE,1);
			g.fillStyle='rgba(6,8,16,0.05)'; g.fillRect(px,py+TILE-3,TILE,1);
			// grass/dirt overhangs sprout hanging root fibers
			if(fam===EDGE_EARTH && t!==T.CLAY && t!==T.WET_CLAY && (h&3)!==3){
				g.fillStyle='rgba(58,40,24,0.42)';
				g.fillRect(px+3+((h>>>4)%6),py+TILE-3,1,3);
				g.fillRect(px+11+((h>>>8)%6),py+TILE-2,1,2);
			}
		}
	}
	if(oL && fam!==EDGE_LEAF){
		if(fam===EDGE_LAVA){ g.fillStyle='rgba(255,170,70,0.30)'; g.fillRect(px,py,1,TILE); }
		else{
			g.fillStyle='rgba(235,242,250,'+(0.11*sun).toFixed(3)+')'; g.fillRect(px,py+(oU?2:0),1,TILE-(oU?2:0)-(oD?1:0));
			g.fillStyle='rgba(8,10,18,0.05)'; g.fillRect(px+1,py+2,1,TILE-4);
		}
	}
	if(oR && fam!==EDGE_LEAF){
		if(fam===EDGE_LAVA){ g.fillStyle='rgba(255,170,70,0.30)'; g.fillRect(px+TILE-1,py,1,TILE); }
		else{
			g.fillStyle='rgba(8,10,18,'+(fam===EDGE_ROCK||fam===EDGE_BUILT?0.15:0.11)+')'; g.fillRect(px+TILE-1,py+(oU?2:0),1,TILE-(oU?2:0));
			g.fillStyle='rgba(8,10,18,0.06)'; g.fillRect(px+TILE-2,py+2,1,TILE-4);
		}
	}
	// hot ember rims where solid rock borders lava pools
	if(fam!==EDGE_LAVA){
		if(nD===T.LAVA){ g.fillStyle='rgba(255,140,44,0.34)'; g.fillRect(px,py+TILE-1,TILE,1); g.fillStyle='rgba(255,96,20,0.12)'; g.fillRect(px,py+TILE-3,TILE,2); }
		if(nL===T.LAVA){ g.fillStyle='rgba(255,140,44,0.30)'; g.fillRect(px,py,1,TILE); }
		if(nR===T.LAVA){ g.fillStyle='rgba(255,140,44,0.30)'; g.fillRect(px+TILE-1,py,1,TILE); }
		if(nU===T.LAVA){ g.fillStyle='rgba(255,150,50,0.26)'; g.fillRect(px,py,TILE,1); }
	}
	// inner-corner ambient occlusion: a diagonal opening beside two solid faces
	// gets a small dark wedge, grounding staircase terrain into crevices
	if(fam!==EDGE_LEAF && fam!==EDGE_LAVA){
		g.fillStyle='rgba(8,10,18,0.13)';
		if(!oU && !oL && tileOpenForEdge(fam,chunkTileAt(arr,cx,lx-1,y-1,originY,sectionH))){ g.fillRect(px,py,3,1); g.fillRect(px,py+1,1,2); }
		if(!oU && !oR && tileOpenForEdge(fam,chunkTileAt(arr,cx,lx+1,y-1,originY,sectionH))){ g.fillRect(px+TILE-3,py,3,1); g.fillRect(px+TILE-1,py+1,1,2); }
		if(!oD && !oL && tileOpenForEdge(fam,chunkTileAt(arr,cx,lx-1,y+1,originY,sectionH))){ g.fillRect(px,py+TILE-1,3,1); g.fillRect(px,py+TILE-3,1,2); }
		if(!oD && !oR && tileOpenForEdge(fam,chunkTileAt(arr,cx,lx+1,y+1,originY,sectionH))){ g.fillRect(px+TILE-3,py+TILE-1,3,1); g.fillRect(px+TILE-1,py+TILE-3,1,2); }
	}
	// convex rock corners get a chamfer pixel so hard edges don't glare
	if((fam===EDGE_ROCK || fam===EDGE_BUILT || fam===EDGE_METEOR)){
		g.fillStyle='rgba(8,10,18,0.20)';
		if(oU&&oL) g.fillRect(px,py,1,1);
		if(oU&&oR) g.fillRect(px+TILE-1,py,1,1);
	}
	// cave dressing: mossy growth on rock faces that touch underground air
	if(fam===EDGE_ROCK && y>surf+4 && t!==T.OBSIDIAN && t!==T.BASALT && t!==T.BEDROCK){
		if(oU && (h%11)<3){
			g.fillStyle='rgba(96,168,92,0.34)';
			g.fillRect(px+2+((h>>>5)%12),py,3,1);
			g.fillRect(px+3+((h>>>5)%12),py+1,1,1);
		}
		if(oD && (h%13)<2){
			g.fillStyle='rgba(70,140,80,0.26)';
			g.fillRect(px+4+((h>>>7)%11),py+TILE-1,2,1);
			g.fillRect(px+4+((h>>>7)%11),py+TILE-3,1,2);
		}
	}
}
// ---- Tile art v2: richer inner material art ---------------------------------
function drawDiamondOreArt(g,px,py,h){
	// gems read as crystals embedded in host rock, not a flat cyan block
	const cx0=px+7+((h>>>3)&6), cy0=py+8+((h>>>6)&4);
	g.fillStyle='rgba(60,210,255,0.10)';
	g.beginPath(); g.arc(cx0,cy0,6.5,0,Math.PI*2); g.fill();
	const rhomb=(x,y,r)=>{ g.beginPath(); g.moveTo(x,y-r); g.lineTo(x+r,y); g.lineTo(x,y+r); g.lineTo(x-r,y); g.closePath(); };
	rhomb(cx0,cy0,5); g.fillStyle='#1c5f80'; g.fill();
	rhomb(cx0,cy0,4); g.fillStyle='#37d3f2'; g.fill();
	g.fillStyle='rgba(226,255,255,0.85)';
	g.beginPath(); g.moveTo(cx0,cy0-4); g.lineTo(cx0+4,cy0); g.lineTo(cx0,cy0); g.closePath(); g.fill();
	g.fillStyle='rgba(8,52,80,0.55)';
	g.beginPath(); g.moveTo(cx0,cy0+4); g.lineTo(cx0-4,cy0); g.lineTo(cx0,cy0); g.closePath(); g.fill();
	const dx=((h>>>9)&1)?-6:6, dy=((h>>>10)&1)?-4:4;
	const sx=Math.max(px+3,Math.min(px+TILE-3,cx0+dx)), sy2=Math.max(py+3,Math.min(py+TILE-3,cy0+dy));
	rhomb(sx,sy2,2.5); g.fillStyle='#2aa9cf'; g.fill();
	rhomb(sx,sy2,1.5); g.fillStyle='rgba(190,247,255,0.9)'; g.fill();
	g.fillStyle='rgba(255,255,255,0.95)';
	g.fillRect(cx0-1,cy0-2,1,1);
	g.fillRect(cx0-2,cy0-1,3,1);
	g.fillRect(cx0-1,cy0,1,1);
}
function drawGoldOreArt(g,px,py,h){
	// Gold reads as a metal vein: curved seams in host rock, not a yellow slab.
	const pts=[
		[px+2, py+8+((h>>>3)&3)],
		[px+6+((h>>>6)&3), py+5+((h>>>9)&2)],
		[px+11+((h>>>11)&3), py+8+((h>>>14)&3)],
		[px+18, py+6+((h>>>17)&5)]
	];
	g.save();
	g.lineCap='round';
	g.lineJoin='round';
	g.strokeStyle='rgba(64,38,6,0.42)';
	g.lineWidth=4;
	g.beginPath();
	g.moveTo(pts[0][0],pts[0][1]);
	g.bezierCurveTo(pts[1][0],pts[1][1],pts[2][0],pts[2][1],pts[3][0],pts[3][1]);
	g.stroke();
	g.strokeStyle='rgba(173,111,18,0.95)';
	g.lineWidth=2.5;
	g.beginPath();
	g.moveTo(pts[0][0],pts[0][1]);
	g.bezierCurveTo(pts[1][0],pts[1][1],pts[2][0],pts[2][1],pts[3][0],pts[3][1]);
	g.stroke();
	g.strokeStyle='rgba(255,220,92,0.96)';
	g.lineWidth=1.15;
	g.beginPath();
	g.moveTo(pts[0][0]+1,pts[0][1]-1);
	g.bezierCurveTo(pts[1][0],pts[1][1]-1,pts[2][0],pts[2][1]-1,pts[3][0]-1,pts[3][1]-1);
	g.stroke();
	const s1x=px+5+((h>>>19)&3), s1y=py+13+((h>>>22)&2);
	const s2x=px+12+((h>>>24)&3), s2y=py+3+((h>>>27)&3);
	g.strokeStyle='rgba(120,73,10,0.58)';
	g.lineWidth=2.1;
	g.beginPath(); g.moveTo(px+3,s1y); g.quadraticCurveTo(s1x,s1y-3,px+10,s1y); g.stroke();
	g.beginPath(); g.moveTo(px+10,s2y+4); g.quadraticCurveTo(s2x,s2y,px+17,s2y+3); g.stroke();
	g.strokeStyle='rgba(255,205,68,0.82)';
	g.lineWidth=1;
	g.beginPath(); g.moveTo(px+4,s1y-1); g.quadraticCurveTo(s1x,s1y-3,px+9,s1y-1); g.stroke();
	g.beginPath(); g.moveTo(px+11,s2y+3); g.quadraticCurveTo(s2x,s2y+1,px+16,s2y+2); g.stroke();
	g.fillStyle='rgba(255,246,172,0.96)';
	const glint=(x,y)=>{ g.fillRect(x-1,y,3,1); g.fillRect(x,y-1,1,3); };
	glint(px+7+((h>>>4)&1),py+7+((h>>>8)&1));
	if((h&5)===0) glint(px+14,py+5+((h>>>10)&3));
	g.restore();
}
// Clamp a fill to the tile rect so world-lattice art never spills onto neighbor
// tiles (partial chunk redraws would re-composite spill pixels on uncleared rows)
function fillRectClampedToTile(g,px,py,x,y,w,h){
	const x0=Math.max(px,x), y0=Math.max(py,y);
	const x1=Math.min(px+TILE,x+w), y1=Math.min(py+TILE,y+h);
	if(x1>x0 && y1>y0) g.fillRect(x0,y0,x1-x0,y1-y0);
}
function drawLeafClumpArt(g,t,px,py,wx,y,h){
	const red=t===T.AUTUMN_LEAF_RED, orange=t===T.AUTUMN_LEAF_ORANGE;
	const dark=red?'rgba(96,52,22,0.42)':orange?'rgba(150,66,20,0.40)':'rgba(18,88,32,0.40)';
	const mid=red?'rgba(158,94,40,0.40)':orange?'rgba(216,122,34,0.42)':'rgba(52,150,52,0.42)';
	const lite=red?'rgba(214,142,66,0.36)':orange?'rgba(255,184,84,0.38)':'rgba(126,220,90,0.38)';
	// Dapple discs live on a world-space lattice so clumps straddle tile borders
	// and the canopy reads as one organic mass. Discs are rendered as two clamped
	// fillRects (a pixel-art disc) — the earlier clip+arc version made canopy
	// bakes an order of magnitude slower.
	const CELL=9;
	const wpx=wx*TILE, wpy=y*TILE;
	const c0x=Math.floor((wpx-6)/CELL), c1x=Math.floor((wpx+TILE+6)/CELL);
	const c0y=Math.floor((wpy-6)/CELL), c1y=Math.floor((wpy+TILE+6)/CELL);
	for(let cy=c0y;cy<=c1y;cy++){
		for(let cx2=c0x;cx2<=c1x;cx2++){
			const r=hash32(cx2*7349,cy*9151);
			const ax=px+(cx2*CELL+((r>>>3)%CELL)-wpx);
			const ay=py+(cy*CELL+((r>>>8)%CELL)-wpy);
			const rr=2+((r>>>13)%3);
			const tone=(r>>>16)%3;
			g.fillStyle=tone===0?dark:tone===1?mid:lite;
			fillRectClampedToTile(g,px,py,ax-rr,ay-rr+1,rr*2,rr*2-2);
			fillRectClampedToTile(g,px,py,ax-rr+1,ay-rr,rr*2-2,rr*2);
		}
	}
	if(!red && !orange && (h%17)===0){
		g.fillStyle='rgba(220,60,70,0.85)';
		g.fillRect(px+5+((h>>>6)%10),py+6+((h>>>10)%9),2,2);
	}
}
function drawMudDetail(g,px,py,h){
	g.fillStyle='rgba(35,24,13,0.28)';
	g.fillRect(px+2+((h>>>5)&7),py+11,6,2);
	g.fillRect(px+10,py+4+((h>>>9)&3),5,2);
	g.fillStyle='rgba(128,103,67,0.26)';
	g.fillRect(px+4,py+6+((h>>>7)&3),4,2);
	// wet gloss streaks
	g.fillStyle='rgba(196,224,244,0.10)';
	g.fillRect(px+3+((h>>>4)&5),py+3,5,1);
	g.fillRect(px+9,py+13+((h>>>11)&2),6,1);
}
function drawLavaCrustArt(g,px,py,h){
	// cooling crust islands with white-hot fissures between them
	g.fillStyle='rgba(58,14,4,0.50)';
	g.fillRect(px+2+((h>>>4)&4),py+4+((h>>>7)&3),6,4);
	g.fillRect(px+11,py+11+((h>>>10)&3),6,4);
	g.fillStyle='rgba(96,26,8,0.42)';
	g.fillRect(px+12,py+3+((h>>>12)&2),5,3);
	g.fillRect(px+3,py+13,5,3);
	strokePath(g,'rgba(255,232,130,0.65)',1,[[px+2,py+9+((h>>>5)&3)],[px+8,py+10],[px+12,py+7+((h>>>8)&4)],[px+18,py+9]]);
	g.fillStyle='rgba(255,255,208,0.85)';
	g.fillRect(px+7+((h>>>6)&6),py+9+((h>>>9)&2),2,1);
	g.fillStyle='rgba(255,180,70,0.30)';
	g.fillRect(px+4+((h>>>11)&8),py+6,2,2);
}
function drawGrassBodyGradient(g,px,py,col){
	// turf block: fresh green up top fading into root-zone soil at the base
	// (band overlays, not createLinearGradient — gradients per tile bake slowly)
	g.fillStyle=col;
	g.fillRect(px,py,TILE,TILE);
	g.fillStyle='rgba(224,255,152,0.10)';
	g.fillRect(px,py,TILE,7);
	g.fillStyle='rgba(16,40,14,0.10)';
	g.fillRect(px,py+13,TILE,7);
	g.fillStyle='rgba(94,66,40,0.26)';
	g.fillRect(px,py+TILE-3,TILE,3);
	g.fillStyle='rgba(70,48,30,0.22)';
	g.fillRect(px,py+TILE-1,TILE,1);
}
function chunkTileAt(arr,cx,lx,y,originY,sectionH){
	originY=Number.isFinite(originY) ? originY : 0;
	sectionH=Number.isFinite(sectionH) ? sectionH : WORLD_H;
	if(!worldYInBounds(y)) return y>=worldMaxY() ? T.BEDROCK : T.AIR;
	const localY=y-originY;
	if(lx>=0 && lx<CHUNK_W && localY>=0 && localY<sectionH) return arr[localY*CHUNK_W+lx];
	return getTile(cx*CHUNK_W+lx,y);
}
// Gravestone marker: a rounded headstone with an etched cross instead of the old
// anonymous gray block (players kept reading their death marker as plain stone)
function drawGraveTile(g,px,py){
	g.fillStyle='#6f7480'; g.fillRect(px+2, py+TILE-4, TILE-4, 4); // plinth
	g.fillStyle='#9aa0ab';
	g.beginPath();
	g.moveTo(px+5, py+TILE-4);
	g.lineTo(px+5, py+7);
	g.arc(px+TILE/2, py+7, TILE/2-5, Math.PI, 0);
	g.lineTo(px+TILE-5, py+TILE-4);
	g.closePath(); g.fill();
	g.strokeStyle='rgba(20,22,30,0.55)'; g.lineWidth=1; g.stroke();
	g.fillStyle='rgba(255,255,255,0.18)'; g.fillRect(px+6, py+4, TILE-12, 2); // crown light
	g.strokeStyle='rgba(40,44,54,0.85)'; g.lineWidth=1.5; // etched cross
	g.beginPath();
	g.moveTo(px+TILE/2, py+8); g.lineTo(px+TILE/2, py+TILE-7);
	g.moveTo(px+TILE/2-3.5, py+11); g.lineTo(px+TILE/2+3.5, py+11);
	g.stroke();
	g.fillStyle='rgba(86,140,70,0.8)'; g.fillRect(px+3, py+TILE-6, 4, 2); // moss tuft
}
function drawRespawnTotemTile(g,px,py){
	g.fillStyle='rgba(56,30,17,0.48)';
	g.fillRect(px+5,py+TILE-4,TILE-10,3);
	g.fillStyle='#6e4a22';
	g.fillRect(px+9,py+5,2,TILE-7);
	g.fillStyle='#9b6730';
	g.fillRect(px+7,py+TILE-7,6,4);
	g.fillStyle='#e23b4e';
	g.beginPath();
	g.moveTo(px+11,py+4);
	g.lineTo(px+17,py+7);
	g.lineTo(px+11,py+10);
	g.closePath();
	g.fill();
	g.fillStyle='rgba(255,230,130,0.92)';
	g.fillRect(px+8,py+TILE-10,5,2);
	g.fillStyle='rgba(255,255,255,0.22)';
	g.fillRect(px+12,py+5,3,1);
	g.strokeStyle='rgba(45,18,22,0.55)';
	g.lineWidth=1;
	g.strokeRect(px+7.5,py+TILE-7.5,6,4);
}
// Mech pilot chair: passable seat fixture drawn as a side-view armchair glyph.
// Material (wood/stone/steel) only recolors the same silhouette.
const CHAIR_TILE_SKINS={
	wood:  {body:'#a9743c', dark:'#6e4a22', pad:'#8a5c2e', glint:'rgba(255,224,170,0.35)'},
	stone: {body:'#8d939c', dark:'#565c66', pad:'#767d88', glint:'rgba(235,242,250,0.30)'},
	steel: {body:'#9fb0bd', dark:'#5f6f7c', pad:'#7d93a4', glint:'rgba(240,250,255,0.45)'}
};
function drawChairTile(g,px,py,t){
	const mat=(INFO[t] && INFO[t].chairMaterial) || 'wood';
	const skin=CHAIR_TILE_SKINS[mat] || CHAIR_TILE_SKINS.wood;
	g.save();
	// floor shadow
	g.fillStyle='rgba(8,12,16,0.30)';
	g.fillRect(px+3,py+TILE-3,TILE-6,2);
	// legs / base
	g.fillStyle=skin.dark;
	g.fillRect(px+5,py+TILE-7,2,5);
	g.fillRect(px+TILE-6,py+TILE-7,2,5);
	// seat plank
	g.fillStyle=skin.body;
	g.fillRect(px+4,py+TILE-9,TILE-7,3);
	// backrest (left side, slight lean)
	g.beginPath();
	g.moveTo(px+4,py+TILE-8);
	g.lineTo(px+3,py+4);
	g.lineTo(px+7,py+3);
	g.lineTo(px+8,py+TILE-8);
	g.closePath();
	g.fill();
	// seat + backrest padding
	g.fillStyle=skin.pad;
	g.fillRect(px+5,py+TILE-10,TILE-9,2);
	g.fillRect(px+4.5,py+5,3,TILE-15);
	// armrest stub on the open side
	g.fillStyle=skin.dark;
	g.fillRect(px+TILE-7,py+TILE-12,4,2);
	// material glint
	g.fillStyle=skin.glint;
	g.fillRect(px+4,py+4,2,3);
	g.strokeStyle='rgba(10,14,18,0.45)';
	g.lineWidth=1;
	g.strokeRect(px+3.5,py+3.5,4,TILE-11);
	g.restore();
}
function meatPath(g,px,py,pad){
	g.beginPath();
	g.moveTo(px+pad+2,py+pad+2);
	g.lineTo(px+TILE-pad-7,py+pad);
	g.quadraticCurveTo(px+TILE-pad-1,py+pad+1,px+TILE-pad,py+pad+7);
	g.lineTo(px+TILE-pad-2,py+TILE-pad-5);
	g.quadraticCurveTo(px+TILE-pad-5,py+TILE-pad,px+TILE-pad-10,py+TILE-pad);
	g.lineTo(px+pad+4,py+TILE-pad-2);
	g.quadraticCurveTo(px+pad,py+TILE-pad-5,px+pad,py+pad+8);
	g.quadraticCurveTo(px+pad,py+pad+4,px+pad+2,py+pad+2);
	g.closePath();
}
function drawMeatTile(g,px,py,state,h){
	const rotten = state===true || state==='rotten';
	const baked = state==='baked';
	const edge = baked ? '#6f351b' : rotten ? '#35401f' : '#6f2629';
	const fat = baked ? '#d79a64' : rotten ? '#aeb56e' : '#f2b99c';
	const meat = baked ? '#9b5a2e' : rotten ? '#647136' : '#bd5145';
	const dark = baked ? 'rgba(83,39,17,0.32)' : rotten ? 'rgba(26,39,19,0.28)' : 'rgba(86,24,26,0.28)';
	const marble = baked ? 'rgba(246,173,91,0.62)' : rotten ? 'rgba(202,214,126,0.72)' : 'rgba(255,222,190,0.76)';
	const shine = baked ? 'rgba(255,188,104,0.24)' : rotten ? 'rgba(218,232,148,0.28)' : 'rgba(255,238,208,0.28)';
	meatPath(g,px,py,2);
	g.fillStyle=edge; g.fill();
	meatPath(g,px,py,3);
	g.fillStyle=fat; g.fill();
	meatPath(g,px,py,5);
	g.fillStyle=meat; g.fill();
	g.fillStyle=dark;
	g.fillRect(px+9,py+6,5,2);
	g.fillRect(px+6,py+13,6,2);
	g.fillStyle=shine;
	g.fillRect(px+6,py+6,6,1);
	g.fillRect(px+4,py+9,2,4);
	g.strokeStyle=marble;
	g.lineWidth=1.35;
	g.beginPath();
	g.moveTo(px+7,py+9);
	g.quadraticCurveTo(px+10,py+7,px+13,py+10);
	g.moveTo(px+8,py+14);
	g.quadraticCurveTo(px+11,py+12,px+15,py+13);
	g.stroke();
	if(baked){
		g.strokeStyle='rgba(74,31,13,0.62)';
		g.lineWidth=1.4;
		g.beginPath();
		g.moveTo(px+6,py+6); g.lineTo(px+14,py+14);
		g.moveTo(px+12,py+5); g.lineTo(px+17,py+10);
		g.stroke();
	}
	const spotX=px+6+((h>>>7)&1);
	const spotY=py+7+((h>>>10)&1);
	g.fillStyle=baked?'#f2b05e':rotten?'#d4d27e':'#ffe1b8';
	g.beginPath(); g.ellipse(spotX,spotY,2.4,2.0,0,0,Math.PI*2); g.fill();
	g.fillStyle=baked?'rgba(99,45,20,0.38)':rotten?'rgba(74,83,39,0.45)':'rgba(181,92,63,0.38)';
	g.beginPath(); g.ellipse(spotX,spotY,1.1,0.8,0,0,Math.PI*2); g.fill();
}
function drawChestTile(g,px,py,t,h){
	const epic=t===T.CHEST_EPIC;
	const rare=t===T.CHEST_RARE;
	const p=epic
		? {body:'#a76a13', body2:'#6b4109', lid:'#f1be38', lid2:'#b87b16', trim:'#ffe58a', dark:'#3b2408', gem:'#54f7ff', inset:'#8c3fd1'}
		: rare
			? {body:'#57307b', body2:'#321744', lid:'#8c48bb', lid2:'#5a287f', trim:'#d7a2ff', dark:'#1c0d28', gem:'#79f6ff', inset:'#b05cff'}
			: {body:'#9b5c2a', body2:'#623819', lid:'#c77b31', lid2:'#7c481f', trim:'#d7a957', dark:'#311b0b', gem:'#ffd970', inset:'#f0b456'};
	g.save();
	g.fillStyle='rgba(0,0,0,0.30)';
	g.fillRect(px+3,py+TILE-3,TILE-6,2);
	g.fillStyle=p.dark;
	g.fillRect(px+2,py+7,TILE-4,TILE-8);
	g.fillRect(px+3,py+5,TILE-6,4);
	g.fillStyle=p.lid2;
	g.fillRect(px+3,py+7,TILE-6,4);
	g.fillStyle=p.lid;
	g.fillRect(px+4,py+5,TILE-8,3);
	g.fillRect(px+5,py+4,TILE-10,2);
	g.fillStyle='rgba(255,255,255,0.24)';
	g.fillRect(px+5,py+5,TILE-10,1);
	g.fillStyle=p.body2;
	g.fillRect(px+3,py+11,TILE-6,6);
	g.fillStyle=p.body;
	g.fillRect(px+4,py+10,TILE-8,5);
	g.fillStyle='rgba(255,255,255,0.14)';
	g.fillRect(px+5,py+10,TILE-10,1);
	g.fillStyle='rgba(0,0,0,0.22)';
	g.fillRect(px+4,py+15,TILE-8,2);
	g.fillStyle=p.trim;
	g.fillRect(px+4,py+8,2,8);
	g.fillRect(px+14,py+8,2,8);
	g.fillRect(px+3,py+9,TILE-6,1);
	g.fillRect(px+3,py+12,TILE-6,1);
	g.fillRect(px+9,py+5,2,12);
	g.fillStyle=p.dark;
	g.fillRect(px+9,py+8,2,2);
	g.fillStyle=p.trim;
	g.fillRect(px+8,py+11,4,4);
	g.fillStyle=p.gem;
	g.fillRect(px+9,py+12,2,2);
	g.fillStyle=epic?'rgba(255,255,255,0.80)':rare?'rgba(255,255,255,0.62)':'rgba(255,244,180,0.58)';
	g.fillRect(px+5,py+8,1,1);
	g.fillRect(px+14,py+8,1,1);
	g.fillRect(px+5,py+14,1,1);
	g.fillRect(px+14,py+14,1,1);
	if(rare || epic){
		g.fillStyle='rgba(255,255,255,0.20)';
		g.fillRect(px+4,py+4,2,1);
		g.fillRect(px+14,py+5,2,1);
		g.fillStyle=p.inset;
		g.fillRect(px+6,py+14,2,1);
		g.fillRect(px+12,py+14,2,1);
	}
	if(epic){
		g.fillStyle=p.trim;
		g.fillRect(px+5,py+3,2,2);
		g.fillRect(px+9,py+2,2,3);
		g.fillRect(px+13,py+3,2,2);
		g.fillStyle='rgba(255,255,255,0.75)';
		g.fillRect(px+10,py+2,1,1);
		if(((h>>>8)&3)!==0){
			g.fillStyle='rgba(84,247,255,0.72)';
			g.fillRect(px+7+((h>>>4)&6),py+6+((h>>>10)&1),2,1);
		}
	} else if(((h>>>11)&7)===0){
		g.fillStyle='rgba(255,255,255,0.62)';
		g.fillRect(px+6+((h>>>3)&6),py+6,2,1);
	}
	g.restore();
}
function drawInvasionCacheTile(g,px,py,h){
	g.save();
	const pulse=((h>>>5)&7)/7;
	drawBlockBevel(g,px,py,'rgba(122,255,222,0.28)','rgba(0,5,8,0.55)');
	g.fillStyle='rgba(4,12,18,0.88)';
	g.fillRect(px+2,py+4,TILE-4,TILE-7);
	g.fillStyle='rgba(24,70,76,0.92)';
	g.fillRect(px+3,py+5,TILE-6,TILE-9);
	g.fillStyle='rgba(8,24,30,0.85)';
	g.fillRect(px+5,py+7,TILE-10,TILE-12);
	g.strokeStyle='rgba(121,255,219,0.88)';
	g.lineWidth=1.5;
	g.beginPath();
	g.moveTo(px+4,py+7);
	g.lineTo(px+10,py+3);
	g.lineTo(px+16,py+7);
	g.moveTo(px+5,py+14);
	g.lineTo(px+15,py+14);
	g.stroke();
	g.fillStyle='rgba(126,255,225,'+(0.42+pulse*0.22).toFixed(3)+')';
	g.fillRect(px+8,py+8,4,4);
	g.fillStyle='rgba(230,255,249,0.82)';
	g.fillRect(px+9,py+8,2,1);
	g.fillStyle='rgba(0,0,0,0.36)';
	g.fillRect(px+3,py+17,TILE-6,2);
	if((h&3)!==0){
		g.fillStyle='rgba(123,255,226,0.52)';
		g.fillRect(px+5+((h>>>8)&7),py+5+((h>>>12)&1),2,1);
	}
	g.restore();
}
function dot(g,px,py,x,y,w,h,c){ g.fillStyle=c; g.fillRect(px+x,py+y,w,h); }
function strokePath(g,c,w,pts){
	g.strokeStyle=c; g.lineWidth=w; g.beginPath();
	for(let i=0;i<pts.length;i++){
		const p=pts[i];
		if(i===0) g.moveTo(p[0],p[1]);
		else g.lineTo(p[0],p[1]);
	}
	g.stroke();
}
function drawBlockBevel(g,px,py,light,dark){
	g.fillStyle=light;
	g.fillRect(px,py,TILE,1);
	g.fillRect(px,py,1,TILE);
	g.fillStyle=dark;
	g.fillRect(px,py+TILE-1,TILE,1);
	g.fillRect(px+TILE-1,py,1,TILE);
}
function drawVendingMachineTile(g,px,py,h,pulse){
	const p=Math.max(0,Math.min(1,Number(pulse)||0));
	drawBlockBevel(g,px,py,'rgba(124,232,255,0.22)','rgba(3,7,14,0.42)');
	dot(g,px,py,2,2,TILE-4,TILE-4,'rgba(13,25,43,0.80)');
	dot(g,px,py,4,3,TILE-8,3,'rgba(86,219,255,'+(0.48+0.28*p).toFixed(3)+')');
	dot(g,px,py,4,7,8,8,'rgba(6,13,24,0.78)');
	dot(g,px,py,5,8,2,2,'rgba(89,224,255,0.76)');
	dot(g,px,py,9,8,2,2,'rgba(255,222,88,0.82)');
	dot(g,px,py,5,12,5,1,'rgba(232,252,255,0.46)');
	dot(g,px,py,13,5,3,2,'rgba(255,222,88,0.82)');
	dot(g,px,py,13,9,3,2,'rgba(85,235,255,0.74)');
	dot(g,px,py,13,13,3,2,'rgba(255,96,135,0.72)');
	strokePath(g,'rgba(117,242,255,'+(0.38+0.34*p).toFixed(3)+')',1,[[px+4,py+4],[px+TILE-5,py+4],[px+TILE-5,py+TILE-4]]);
	if(((h>>>5)&3)!==0) dot(g,px,py,6+((h>>>3)&4),10,2,1,'rgba(255,255,255,0.52)');
	dot(g,px,py,3,TILE-4,TILE-6,2,'rgba(2,6,12,0.60)');
}
function drawTurretTilePixels(g,t,px,py,h){
	const fire=t===T.FIRE_TURRET;
	const water=t===T.WATER_TURRET;
	const accent=fire?'rgba(255,119,36,0.92)':(water?'rgba(77,216,255,0.92)':'rgba(181,229,255,0.88)');
	const accentSoft=fire?'rgba(255,212,95,0.62)':(water?'rgba(202,250,255,0.58)':'rgba(235,250,255,0.48)');
	const body=fire?'rgba(83,29,18,0.82)':(water?'rgba(14,55,77,0.82)':'rgba(31,43,59,0.84)');
	const bodyDark=fire?'rgba(37,12,8,0.82)':(water?'rgba(5,22,35,0.82)':'rgba(8,14,23,0.82)');
	const bodyMid=fire?'rgba(129,46,24,0.58)':(water?'rgba(24,92,124,0.58)':'rgba(58,76,101,0.56)');
	const core=fire?'rgba(255,229,118,0.95)':(water?'rgba(223,253,255,0.95)':'rgba(245,250,255,0.92)');
	drawBlockBevel(g,px,py,fire?'rgba(255,170,84,0.23)':(water?'rgba(93,224,255,0.21)':'rgba(196,226,255,0.18)'),'rgba(3,6,12,0.46)');
	dot(g,px,py,2,3,TILE-4,TILE-5,'rgba(4,9,16,0.74)');
	dot(g,px,py,3,4,TILE-6,1,'rgba(255,255,255,0.08)');
	dot(g,px,py,3,TILE-6,TILE-6,2,'rgba(0,0,0,0.30)');
	dot(g,px,py,3,TILE-4,5,2,'rgba(2,5,10,0.76)');
	dot(g,px,py,TILE-8,TILE-4,5,2,'rgba(2,5,10,0.76)');
	dot(g,px,py,4,7,12,8,body);
	dot(g,px,py,5,8,10,1,'rgba(255,255,255,0.10)');
	dot(g,px,py,5,14,10,1,'rgba(0,0,0,0.28)');
	dot(g,px,py,4,7,2,8,bodyDark);
	dot(g,px,py,14,7,2,8,'rgba(0,0,0,0.24)');
	dot(g,px,py,7,8,6,5,bodyMid);
	dot(g,px,py,8,8,4,4,core);
	dot(g,px,py,9,7,2,1,accentSoft);
	dot(g,px,py,9,12,2,1,'rgba(0,0,0,0.28)');
	dot(g,px,py,7,10,1,1,accent);
	dot(g,px,py,12,10,1,1,accent);
	dot(g,px,py,5,5,2,2,'rgba(225,238,255,0.34)');
	dot(g,px,py,13,5,2,2,'rgba(0,0,0,0.34)');
	dot(g,px,py,6,16,3,1,accentSoft);
	dot(g,px,py,11,16,3,1,accentSoft);
	// Stepped barrel pixels keep the turret crisp in cached world chunks.
	dot(g,px,py,10,7,3,2,'rgba(2,5,10,0.86)');
	dot(g,px,py,12,5,3,2,'rgba(2,5,10,0.78)');
	dot(g,px,py,14,3,3,2,'rgba(2,5,10,0.70)');
	dot(g,px,py,10,6,3,2,accent);
	dot(g,px,py,12,4,3,2,accent);
	dot(g,px,py,15,2,3,2,accentSoft);
	dot(g,px,py,17,2,1,3,'rgba(255,255,255,0.34)');
	dot(g,px,py,6,13,2,1,'rgba(0,0,0,0.35)');
	dot(g,px,py,9,13,2,1,'rgba(0,0,0,0.35)');
	dot(g,px,py,12,13,2,1,'rgba(0,0,0,0.35)');
	if(fire){
		dot(g,px,py,4,5,2,2,'rgba(255,112,36,0.72)');
		dot(g,px,py,15,15,2,2,'rgba(255,212,95,0.62)');
		if(((h>>>6)&1)===0) dot(g,px,py,3,10,1,2,'rgba(255,226,120,0.54)');
	} else if(water){
		dot(g,px,py,3,10,2,3,'rgba(73,188,255,0.50)');
		dot(g,px,py,15,8,2,5,'rgba(181,242,255,0.38)');
		if(((h>>>7)&1)===0) dot(g,px,py,5,5,3,1,'rgba(221,252,255,0.44)');
	} else {
		dot(g,px,py,4,6,2,1,'rgba(205,238,255,0.44)');
		dot(g,px,py,14,12,2,1,'rgba(144,196,232,0.42)');
		if(((h>>>8)&1)===0) dot(g,px,py,5,5,1,1,'rgba(255,255,255,0.52)');
	}
}
function drawSpringPlatformTilePixels(g,px,py,h,pulse){
	const p=Math.max(0,Math.min(1,Number(pulse)||0));
	const glow=(0.18+0.38*p).toFixed(3);
	drawBlockBevel(g,px,py,'rgba(180,238,255,0.22)','rgba(5,12,19,0.42)');
	dot(g,px,py,2,4,TILE-4,TILE-6,'rgba(8,19,29,0.78)');
	dot(g,px,py,3,5,TILE-6,1,'rgba(255,255,255,0.10)');
	dot(g,px,py,3,14,TILE-6,2,'rgba(0,0,0,0.34)');
	dot(g,px,py,2,3,TILE-4,3,'rgba(111,199,216,0.58)');
	dot(g,px,py,4,2,TILE-8,2,'rgba(206,246,255,0.44)');
	dot(g,px,py,5,6,2,8,'rgba(35,58,69,0.86)');
	dot(g,px,py,TILE-7,6,2,8,'rgba(35,58,69,0.86)');
	dot(g,px,py,6,15,TILE-12,2,'rgba(39,48,58,0.86)');
	dot(g,px,py,4,16,4,2,'rgba(8,13,20,0.82)');
	dot(g,px,py,TILE-8,16,4,2,'rgba(8,13,20,0.82)');
	g.strokeStyle='rgba(220,247,255,0.66)';
	g.lineWidth=1.4;
	g.beginPath();
	g.moveTo(px+7,py+7);
	g.lineTo(px+13,py+7);
	g.lineTo(px+7,py+10);
	g.lineTo(px+13,py+10);
	g.lineTo(px+7,py+13);
	g.stroke();
	g.strokeStyle='rgba(255,224,118,'+glow+')';
	g.lineWidth=1;
	g.beginPath();
	g.moveTo(px+4,py+4);
	g.lineTo(px+8,py+8);
	g.moveTo(px+TILE-5,py+4);
	g.lineTo(px+TILE-9,py+8);
	g.stroke();
	dot(g,px,py,4,5,2,2,'rgba(124,238,255,0.70)');
	dot(g,px,py,TILE-6,5,2,2,'rgba(255,228,118,0.72)');
	if(((h>>>6)&3)!==0 || p>0.2) dot(g,px,py,8+((h>>>10)&3),3,3,1,'rgba(255,255,255,0.58)');
	if(p>0.01){
		g.fillStyle='rgba(124,238,255,'+(0.12+0.22*p).toFixed(3)+')';
		g.fillRect(px+3,py+2,TILE-6,TILE-3);
	}
}
function drawMeteorSirenTilePixels(g,px,py,h){
	drawBlockBevel(g,px,py,'rgba(255,213,116,0.25)','rgba(42,14,4,0.42)');
	dot(g,px,py,2,4,TILE-4,TILE-6,'rgba(46,18,10,0.72)');
	dot(g,px,py,3,5,TILE-6,1,'rgba(255,169,74,0.16)');
	dot(g,px,py,4,14,TILE-8,2,'rgba(20,7,4,0.42)');
	dot(g,px,py,5,11,TILE-10,3,'rgba(255,159,69,0.34)');
	dot(g,px,py,6,15,8,2,'rgba(255,112,36,0.54)');
	dot(g,px,py,9,4,2,1,'rgba(255,231,140,0.86)');
	dot(g,px,py,8,5,4,1,'rgba(255,202,86,0.86)');
	dot(g,px,py,7,6,6,1,'rgba(255,184,64,0.86)');
	dot(g,px,py,6,7,8,1,'rgba(255,159,69,0.82)');
	dot(g,px,py,5,8,10,2,'rgba(255,127,48,0.74)');
	dot(g,px,py,7,8,6,1,'rgba(54,18,8,0.66)');
	dot(g,px,py,8,7,4,1,'rgba(54,18,8,0.58)');
	dot(g,px,py,9,6,2,1,'rgba(54,18,8,0.52)');
	dot(g,px,py,9,6,2,8,'rgba(255,240,166,0.78)');
	dot(g,px,py,8,10,1,3,'rgba(255,201,86,0.58)');
	dot(g,px,py,11,10,1,3,'rgba(255,201,86,0.58)');
	dot(g,px,py,4,6,2,2,'rgba(255,214,100,0.62)');
	dot(g,px,py,14,6,2,2,'rgba(255,112,36,0.62)');
	dot(g,px,py,5,12,2,1,'rgba(0,0,0,0.36)');
	dot(g,px,py,8,12,2,1,'rgba(0,0,0,0.36)');
	dot(g,px,py,11,12,2,1,'rgba(0,0,0,0.36)');
	if(((h>>>7)&1)===0) dot(g,px,py,13,5,2,1,'rgba(255,236,158,0.54)');
}
function drawSandGrains(g,px,py,h){
	let seed=(h||1)>>>0;
	function next(){
		seed=(Math.imul(seed,1664525)+1013904223)>>>0;
		return seed;
	}
	g.fillStyle='rgba(255,246,190,0.13)';
	g.fillRect(px+1,py+2,TILE-2,1);
	g.fillStyle='rgba(111,88,48,0.16)';
	g.fillRect(px+2+(next()%8),py+5+(next()%3),3+(next()%4),1);
	g.fillStyle='rgba(255,248,196,0.20)';
	g.fillRect(px+7+(next()%7),py+11+(next()%4),3+(next()%5),1);
	g.fillStyle='rgba(143,112,56,0.12)';
	g.fillRect(px+3+(next()%9),py+15+(next()%3),2+(next()%4),1);
	const palette=[
		'rgba(96,76,41,0.24)',
		'rgba(146,116,61,0.20)',
		'rgba(226,205,134,0.30)',
		'rgba(255,247,190,0.26)'
	];
	for(let i=0;i<18;i++){
		const r=next();
		g.fillStyle=palette[r&3];
		const gx=px+1+((r>>>3)%18);
		const gy=py+2+((r>>>8)%16);
		g.fillRect(gx,gy,1,1);
	}
	for(let i=0;i<5;i++){
		const r=next();
		g.fillStyle=(r&1)?'rgba(100,79,42,0.13)':'rgba(255,244,178,0.18)';
		g.fillRect(px+2+((r>>>5)%15),py+4+((r>>>10)%12),2,1);
	}
}
const terrainPatternCache = new Map();
const TERRAIN_PATTERN_VARIANTS = 6;
function hasTerrainPattern(t){
	return t===T.SAND || t===T.UNSTABLE_SAND || t===T.QUICKSAND || t===T.CLAY || t===T.WET_CLAY || t===T.BRICK || t===T.CHIMNEY || t===T.DIRT || t===T.STONE || t===T.GRANITE || t===T.BASALT || t===T.BEDROCK || t===T.COAL || t===T.UFO_CONCRETE;
}
function terrainTextureVariant(t,wx,y,h){
	const patch=hash32(Math.floor(wx/2),Math.floor(y/2));
	return ((patch ^ (h>>>7) ^ (t*97))>>>0) % TERRAIN_PATTERN_VARIANTS;
}
function terrainPatternRng(seed){
	let s=seed>>>0;
	return function(){
		s=(Math.imul(s,1664525)+1013904223)>>>0;
		return s/4294967296;
	};
}
function terrainPatternCanvas(t,variant){
	const key=t+':'+variant;
	let c=terrainPatternCache.get(key);
	if(c) return c;
	c=document.createElement('canvas');
	c.width=TILE; c.height=TILE;
	const g=c.getContext('2d');
	if(!g) return c;
	g.imageSmoothingEnabled=false;
	const rnd=terrainPatternRng(hash32(t*131+variant*17,variant*241+7));
	if(t===T.SAND || t===T.UNSTABLE_SAND || t===T.QUICKSAND){
		const grain=['rgba(88,68,37,0.24)','rgba(138,107,57,0.20)','rgba(223,200,128,0.34)','rgba(255,245,184,0.28)'];
		for(let i=0;i<18;i++){
			g.fillStyle=grain[(rnd()*grain.length)|0];
			const x=1+((rnd()*18)|0), y=2+((rnd()*16)|0);
			g.fillRect(x,y,1+(rnd()<0.16?1:0),1);
		}
		for(let i=0;i<3;i++){
			g.fillStyle=i===0?'rgba(255,246,186,0.18)':'rgba(107,82,43,0.13)';
			const x=2+((rnd()*9)|0), y=4+((rnd()*12)|0);
			g.fillRect(x,y,6+((rnd()*7)|0),1);
		}
		if(t===T.UNSTABLE_SAND){
			g.strokeStyle='rgba(70,54,30,0.28)';
			g.lineWidth=1;
			g.beginPath();
			g.moveTo(3+((rnd()*4)|0),5+((rnd()*3)|0));
			g.lineTo(9+((rnd()*4)|0),8+((rnd()*3)|0));
			g.lineTo(15+((rnd()*2)|0),7+((rnd()*5)|0));
			g.stroke();
		}else if(t===T.QUICKSAND){
			g.strokeStyle='rgba(74,58,35,0.25)';
			g.lineWidth=1;
			for(let i=0;i<2;i++){
				const y=7+i*4+((rnd()*2)|0);
				g.beginPath();
				g.moveTo(3,y);
				g.quadraticCurveTo(10, y-3+((rnd()*6)|0), 17, y+((rnd()*3)|0));
				g.stroke();
			}
		}
	} else if(t===T.CLAY || t===T.WET_CLAY){
		const wet=t===T.WET_CLAY;
		const clay=wet
			? ['rgba(45,35,24,0.30)','rgba(106,82,55,0.25)','rgba(164,133,91,0.16)','rgba(22,18,14,0.18)']
			: ['rgba(76,56,38,0.24)','rgba(145,113,78,0.22)','rgba(205,170,118,0.15)','rgba(42,30,20,0.14)'];
		for(let i=0;i<13;i++){
			g.fillStyle=clay[(rnd()*clay.length)|0];
			const x=1+((rnd()*17)|0), y=2+((rnd()*16)|0);
			g.fillRect(x,y,2+((rnd()*3)|0),1);
		}
		for(let i=0;i<4;i++){
			g.strokeStyle=wet?'rgba(26,19,13,0.26)':'rgba(94,63,38,0.22)';
			const x=2+((rnd()*12)|0), y=4+((rnd()*11)|0);
			g.beginPath(); g.moveTo(x,y); g.lineTo(x+3+((rnd()*5)|0),y+((rnd()*2)|0)); g.stroke();
		}
	} else if(t===T.BRICK || t===T.CHIMNEY){
		g.strokeStyle='rgba(61,31,20,0.28)';
		g.lineWidth=1;
		for(let y=5;y<TILE;y+=6){ g.beginPath(); g.moveTo(1,y); g.lineTo(TILE-1,y); g.stroke(); }
		for(let y=0;y<TILE;y+=6){
			const off=((y/6)&1)?8:0;
			for(let x=off;x<TILE;x+=10){ g.beginPath(); g.moveTo(x,y); g.lineTo(x,y+6); g.stroke(); }
		}
		for(let i=0;i<8;i++){
			g.fillStyle=(rnd()<0.5)?'rgba(255,184,120,0.12)':'rgba(61,25,16,0.13)';
			g.fillRect(1+((rnd()*17)|0),2+((rnd()*16)|0),2+((rnd()*3)|0),1);
		}
	} else if(t===T.DIRT){
		const soil=['rgba(45,28,16,0.26)','rgba(93,63,38,0.24)','rgba(151,111,68,0.18)','rgba(34,58,28,0.12)'];
		for(let i=0;i<14;i++){
			g.fillStyle=soil[(rnd()*soil.length)|0];
			const x=1+((rnd()*17)|0), y=2+((rnd()*16)|0);
			g.fillRect(x,y,1+((rnd()*2)|0),1+((rnd()*2)|0));
		}
		for(let i=0;i<3;i++){
			g.strokeStyle=i===0?'rgba(42,30,18,0.28)':'rgba(132,96,56,0.16)';
			const x=2+((rnd()*12)|0), y=5+((rnd()*10)|0);
			g.beginPath(); g.moveTo(x,y); g.lineTo(x+3+((rnd()*5)|0),y+((rnd()*3)|0)); g.stroke();
		}
	} else if(t===T.STONE){
		const chips=['rgba(33,37,44,0.20)','rgba(102,107,116,0.18)','rgba(225,231,238,0.13)'];
		for(let i=0;i<6;i++){
			g.fillStyle=chips[(rnd()*chips.length)|0];
			g.fillRect(2+((rnd()*14)|0),3+((rnd()*12)|0),2+((rnd()*4)|0),1+((rnd()*2)|0));
		}
		g.strokeStyle='rgba(35,39,48,0.30)';
		g.lineWidth=1;
		for(let i=0;i<2;i++){
			const x=3+((rnd()*10)|0), y=4+((rnd()*9)|0);
			g.beginPath();
			g.moveTo(x,y);
			g.lineTo(x+3+((rnd()*5)|0),y+1+((rnd()*4)|0));
			g.lineTo(x+6+((rnd()*4)|0),y-1+((rnd()*5)|0));
			g.stroke();
		}
		g.strokeStyle='rgba(235,240,246,0.12)';
		g.beginPath();
		g.moveTo(3+((rnd()*9)|0),3+((rnd()*5)|0));
		g.lineTo(9+((rnd()*7)|0),3+((rnd()*5)|0));
		g.stroke();
	} else if(t===T.GRANITE){
		const grains=['rgba(32,34,39,0.20)','rgba(102,94,94,0.24)','rgba(190,178,172,0.18)','rgba(116,84,72,0.16)'];
		for(let i=0;i<18;i++){
			g.fillStyle=grains[(rnd()*grains.length)|0];
			g.fillRect(1+((rnd()*17)|0),2+((rnd()*16)|0),1+((rnd()*2)|0),1);
		}
		g.strokeStyle='rgba(42,43,49,0.24)';
		for(let i=0;i<2;i++){
			const x=2+((rnd()*11)|0), y=4+((rnd()*10)|0);
			g.beginPath(); g.moveTo(x,y); g.lineTo(x+5+((rnd()*5)|0),y+1+((rnd()*3)|0)); g.stroke();
		}
	} else if(t===T.BASALT){
		const dark=['rgba(0,0,0,0.26)','rgba(16,18,22,0.32)','rgba(62,67,76,0.16)'];
		for(let i=0;i<7;i++){
			g.fillStyle=dark[(rnd()*dark.length)|0];
			const x=2+((rnd()*13)|0), y=2+((rnd()*14)|0);
			g.fillRect(x,y,2+((rnd()*5)|0),1+((rnd()*3)|0));
		}
		g.strokeStyle='rgba(105,111,124,0.18)';
		for(let i=0;i<3;i++){
			const x=3+((rnd()*10)|0), y=3+((rnd()*10)|0);
			g.beginPath(); g.moveTo(x,y); g.lineTo(x+2+((rnd()*6)|0),y+5+((rnd()*4)|0)); g.stroke();
		}
	} else if(t===T.BEDROCK){
		const plates=['rgba(0,0,0,0.34)','rgba(18,22,30,0.34)','rgba(88,96,112,0.13)'];
		for(let i=0;i<8;i++){
			g.fillStyle=plates[(rnd()*plates.length)|0];
			const x=1+((rnd()*15)|0), y=2+((rnd()*14)|0);
			g.fillRect(x,y,4+((rnd()*5)|0),1+((rnd()*2)|0));
		}
		g.strokeStyle='rgba(128,140,158,0.18)';
		g.beginPath();
		g.moveTo(2+((rnd()*6)|0),4+((rnd()*8)|0));
		g.lineTo(10+((rnd()*5)|0),7+((rnd()*7)|0));
		g.stroke();
	} else if(t===T.COAL){
		const dark=['rgba(0,0,0,0.30)','rgba(5,6,9,0.38)','rgba(22,23,29,0.26)'];
		for(let i=0;i<5;i++){
			g.fillStyle=dark[(rnd()*dark.length)|0];
			const x=2+((rnd()*13)|0), y=3+((rnd()*12)|0);
			g.fillRect(x,y,3+((rnd()*4)|0),2+((rnd()*3)|0));
		}
		g.strokeStyle='rgba(0,0,0,0.30)';
		g.lineWidth=1;
		g.beginPath();
		g.moveTo(3+((rnd()*4)|0),5+((rnd()*7)|0));
		g.lineTo(9+((rnd()*4)|0),8+((rnd()*5)|0));
		g.lineTo(15+((rnd()*2)|0),5+((rnd()*8)|0));
		g.stroke();
		const shine=rnd()<0.6?'rgba(230,238,245,0.28)':'rgba(120,132,145,0.26)';
		g.fillStyle=shine;
		g.fillRect(4+((rnd()*10)|0),4+((rnd()*10)|0),2,1);
		g.fillStyle='rgba(255,255,255,0.12)';
		g.fillRect(7+((rnd()*8)|0),10+((rnd()*5)|0),3,1);
	} else if(t===T.UFO_CONCRETE){
		const plates=['rgba(8,18,24,0.24)','rgba(28,58,68,0.22)','rgba(128,255,229,0.12)','rgba(255,224,118,0.10)'];
		for(let i=0;i<9;i++){
			g.fillStyle=plates[(rnd()*plates.length)|0];
			const x=1+((rnd()*15)|0), y=2+((rnd()*14)|0);
			g.fillRect(x,y,3+((rnd()*5)|0),1+((rnd()*2)|0));
		}
		g.strokeStyle='rgba(126,255,229,0.20)';
		g.lineWidth=1;
		for(let i=0;i<2;i++){
			const y=5+((rnd()*8)|0);
			g.beginPath();
			g.moveTo(3,y);
			g.lineTo(8+((rnd()*3)|0),y-2+((rnd()*4)|0));
			g.lineTo(16,y+1+((rnd()*3)|0));
			g.stroke();
		}
		g.strokeStyle='rgba(255,226,118,0.18)';
		g.beginPath();
		g.moveTo(4+((rnd()*4)|0),4+((rnd()*4)|0));
		g.lineTo(14+((rnd()*2)|0),12+((rnd()*3)|0));
		g.stroke();
	}
	terrainPatternCache.set(key,c);
	return c;
}
function drawTerrainPattern(g,t,px,py,wx,y,h){
	if(!hasTerrainPattern(t)) return;
	if((t===T.STONE || t===T.GRANITE || t===T.BASALT || t===T.BEDROCK) && (h&1)) return;
	const variant=terrainTextureVariant(t,wx,y,h);
	g.drawImage(terrainPatternCanvas(t,variant),px,py);
}
function doorPalette(t){
	if(t===T.STEEL_DOOR || t===T.STEEL_TRAPDOOR) return {panel:'#8795a3', edge:'#3d4854', line:'rgba(233,241,248,0.32)', knob:'#dbe6ef', dark:'rgba(12,18,24,0.70)'};
	if(t===T.STONE_DOOR || t===T.STONE_TRAPDOOR) return {panel:'#8d9098', edge:'#4f535c', line:'rgba(224,228,235,0.22)', knob:'#cfd4dc', dark:'rgba(18,20,25,0.70)'};
	return {panel:'#9b6730', edge:'#5b3417', line:'rgba(239,181,94,0.34)', knob:'#f1c76e', dark:'rgba(24,14,8,0.68)'};
}
function drawDoorTile(g,t,px,py,h,open){
	const p=doorPalette(t);
	const o=Math.max(0,Math.min(1,Number(open)||0));
	drawBlockBevel(g,px,py,'rgba(255,255,255,0.12)','rgba(0,0,0,0.28)');
	if(o>0.08){
		g.fillStyle=p.dark;
		g.fillRect(px+3,py+2,TILE-6,TILE-3);
	}
	const inset=2, panelW=TILE-4, panelH=TILE-4;
	const slide=o*(TILE*0.36);
	const tilt=o*2;
	g.save();
	g.translate(px+inset+slide,py+inset);
	g.fillStyle=p.panel;
	g.fillRect(tilt,0,Math.max(4,panelW-slide*0.35),panelH);
	g.strokeStyle=p.edge;
	g.lineWidth=1;
	g.strokeRect(tilt+0.5,0.5,Math.max(4,panelW-slide*0.35)-1,panelH-1);
	g.fillStyle='rgba(0,0,0,0.16)';
	g.fillRect(tilt+4,2,1,panelH-4);
	g.fillRect(tilt+panelW-6-slide*0.35,2,1,panelH-4);
	g.strokeStyle=p.line;
	g.beginPath();
	if(t===T.WOOD_DOOR){
		g.moveTo(tilt+5,4+((h>>7)&2)); g.lineTo(tilt+panelW-5-slide*0.35,7+((h>>11)&3));
		g.moveTo(tilt+6,panelH-5); g.lineTo(tilt+panelW-6-slide*0.35,panelH-9);
	} else if(t===T.STONE_DOOR){
		g.moveTo(tilt+4,6+((h>>5)&3)); g.lineTo(tilt+panelW-5-slide*0.35,5+((h>>9)&4));
		g.moveTo(tilt+5,12); g.lineTo(tilt+panelW-6-slide*0.35,13+((h>>12)&2));
	} else {
		g.moveTo(tilt+panelW*0.5,2); g.lineTo(tilt+panelW*0.5-slide*0.18,panelH-2);
		g.moveTo(tilt+4,7); g.lineTo(tilt+panelW-5-slide*0.35,7);
		g.moveTo(tilt+4,13); g.lineTo(tilt+panelW-5-slide*0.35,13);
	}
	g.stroke();
	g.fillStyle=p.knob;
	g.fillRect(tilt+Math.max(5,panelW-7-slide*0.35),9,2,2);
	g.restore();
}
function drawTrapdoorTile(g,t,px,py,h,open){
	const p=doorPalette(t);
	const o=Math.max(0,Math.min(1,Number(open)||0));
	drawBlockBevel(g,px,py,'rgba(255,255,255,0.10)','rgba(0,0,0,0.30)');
	if(o>0.04){
		g.fillStyle=p.dark;
		g.fillRect(px+2,py+2,TILE-4,TILE-4);
		g.fillStyle='rgba(0,0,0,0.22)';
		g.fillRect(px+3,py+TILE-5,TILE-6,2);
	}
	const panelW=TILE-4;
	const panelH=Math.max(3,7-o*2.5);
	const baseY=py+7+o*6;
	const slide=o*7;
	g.save();
	g.translate(px+2+slide,baseY-o*5);
	g.rotate(-o*0.45);
	g.fillStyle=p.panel;
	g.fillRect(0,0,Math.max(5,panelW-slide*0.45),panelH);
	g.strokeStyle=p.edge;
	g.lineWidth=1;
	g.strokeRect(0.5,0.5,Math.max(5,panelW-slide*0.45)-1,panelH-1);
	g.strokeStyle=p.line;
	g.beginPath();
	const w2=Math.max(5,panelW-slide*0.45);
	if(t===T.WOOD_TRAPDOOR){
		g.moveTo(3,2+((h>>6)&1)); g.lineTo(w2-3,2+((h>>10)&2));
		g.moveTo(4,panelH-2); g.lineTo(w2-4,panelH-3);
	} else if(t===T.STONE_TRAPDOOR){
		g.moveTo(3,2); g.lineTo(w2-4,2+((h>>9)&2));
		g.moveTo(5,panelH-2); g.lineTo(w2-3,panelH-2);
	} else {
		g.moveTo(3,2); g.lineTo(w2-3,2);
		g.moveTo(3,panelH-2); g.lineTo(w2-3,panelH-2);
		g.moveTo(w2*0.5,1); g.lineTo(w2*0.5,panelH-1);
	}
	g.stroke();
	g.fillStyle=p.knob;
	g.fillRect(Math.max(4,w2-7),Math.max(1,panelH-3),2,2);
	g.restore();
}
function drawTrackTileArt(g,px,py,h,phase){
	const ph=Number.isFinite(Number(phase)) ? Number(phase) : (((h>>>7)&7)/8);
	g.save();
	g.fillStyle='rgba(13,17,22,0.78)';
	g.fillRect(px+2,py+5,TILE-4,TILE-10);
	g.strokeStyle='rgba(205,214,220,0.46)';
	g.lineWidth=1;
	g.strokeRect(px+2.5,py+5.5,TILE-5,TILE-11);
	g.fillStyle='rgba(0,0,0,0.36)';
	g.fillRect(px+3,py+6,TILE-6,2);
	g.fillRect(px+3,py+TILE-8,TILE-6,2);
	g.fillStyle='rgba(146,156,163,0.90)';
	for(let i=0;i<3;i++){
		const cx=px+TILE*(0.23+i*0.27+ph*0.035);
		g.beginPath();
		g.arc(cx,py+TILE*0.5,TILE*0.085,0,Math.PI*2);
		g.fill();
		g.fillStyle='rgba(34,40,46,0.72)';
		g.fillRect(cx-1,py+TILE*0.5-1,2,2);
		g.fillStyle='rgba(146,156,163,0.90)';
	}
	g.strokeStyle='rgba(72,81,91,0.95)';
	g.lineWidth=2;
	g.beginPath();
	for(let i=0;i<4;i++){
		const x=px+4+i*4+Math.floor(ph*3);
		g.moveTo(x,py+6);
		g.lineTo(x+3,py+TILE-6);
	}
	g.stroke();
	g.fillStyle='rgba(255,255,255,0.18)';
	g.fillRect(px+4+((h>>4)&5),py+6,3,1);
	g.restore();
}
function _drawMaterialTile(g,t,px,py,h){
	const rx=(h>>>5)&7, ry=(h>>>9)&7;
	if(t===T.GRASS || t===T.UNSTABLE_GRASS){
		drawBlockBevel(g,px,py,'rgba(130,220,92,0.22)','rgba(10,55,18,0.20)');
		dot(g,px,py,0,0,TILE,4,'rgba(74,190,58,0.55)');
		dot(g,px,py,1+rx,3,3,2,'rgba(151,229,83,0.55)');
		dot(g,px,py,10+((h>>>12)&5),2,3,2,'rgba(52,143,42,0.55)');
		dot(g,px,py,4,12,2,5,'rgba(42,112,35,0.30)');
		dot(g,px,py,13,10,2,6,'rgba(28,92,30,0.22)');
		if(t===T.UNSTABLE_GRASS){
			dot(g,px,py,3,8,TILE-6,5,'rgba(31,54,22,0.16)');
			strokePath(g,'rgba(12,35,14,0.38)',1,[[px+4,py+6],[px+9+((h>>>6)&2),py+10],[px+15,py+8]]);
			strokePath(g,'rgba(12,35,14,0.28)',1,[[px+6,py+14],[px+11,py+11],[px+17,py+15]]);
		}
	} else if(t===T.SAND || t===T.UNSTABLE_SAND || t===T.QUICKSAND){
		drawSandGrains(g,px,py,h);
		if(t===T.UNSTABLE_SAND){
			dot(g,px,py,4,7,TILE-8,6,'rgba(88,64,32,0.11)');
			strokePath(g,'rgba(70,50,25,0.35)',1,[[px+3,py+6],[px+8+((h>>>6)&3),py+10],[px+15,py+7]]);
			strokePath(g,'rgba(70,50,25,0.26)',1,[[px+5,py+14],[px+10,py+11],[px+16,py+15]]);
		}else if(t===T.QUICKSAND){
			g.strokeStyle='rgba(78,58,34,0.28)';
			g.lineWidth=1;
			g.beginPath();
			g.ellipse(px+TILE/2,py+TILE/2+1,6+((h>>>6)&2),3+((h>>>9)&1),0,0,Math.PI*2);
			g.stroke();
			g.beginPath();
			g.ellipse(px+TILE/2+((h>>>11)&1),py+TILE/2+2,3,1.4,0,0,Math.PI*2);
			g.stroke();
			dot(g,px,py,5+rx,6+ry,3,2,'rgba(245,224,145,0.18)');
		}
	} else if(t===T.CLAY || t===T.WET_CLAY){
		const wet=t===T.WET_CLAY;
		drawBlockBevel(g,px,py,wet?'rgba(164,132,91,0.12)':'rgba(212,170,116,0.13)',wet?'rgba(25,18,12,0.31)':'rgba(54,35,20,0.24)');
		dot(g,px,py,2+rx,5,6,2,wet?'rgba(45,35,24,0.30)':'rgba(96,67,42,0.25)');
		dot(g,px,py,9,10+ry,6,2,wet?'rgba(132,103,70,0.23)':'rgba(169,126,78,0.22)');
		strokePath(g,wet?'rgba(25,18,12,0.20)':'rgba(88,57,32,0.19)',1,[[px+3,py+13],[px+7,py+10],[px+14,py+12]]);
		if(wet) dot(g,px,py,5,4,2,2,'rgba(226,200,145,0.12)');
	} else if(t===T.BRICK){
		drawBlockBevel(g,px,py,'rgba(255,171,104,0.15)','rgba(55,20,12,0.27)');
		g.strokeStyle='rgba(70,31,20,0.34)';
		g.lineWidth=1;
		g.beginPath();
		g.moveTo(px+1,py+6); g.lineTo(px+TILE-1,py+6);
		g.moveTo(px+1,py+13); g.lineTo(px+TILE-1,py+13);
		g.moveTo(px+7,py+0); g.lineTo(px+7,py+6);
		g.moveTo(px+14,py+6); g.lineTo(px+14,py+13);
		g.moveTo(px+5,py+13); g.lineTo(px+5,py+TILE);
		g.stroke();
		dot(g,px,py,3+rx,3,4,2,'rgba(255,184,120,0.15)');
		dot(g,px,py,11,10+ry,5,2,'rgba(74,27,17,0.15)');
	} else if(t===T.CHIMNEY){
		drawBlockBevel(g,px,py,'rgba(220,150,96,0.14)','rgba(38,18,12,0.32)');
		g.strokeStyle='rgba(70,31,20,0.34)';
		g.lineWidth=1;
		g.beginPath();
		g.moveTo(px+1,py+5); g.lineTo(px+TILE-1,py+5);
		g.moveTo(px+1,py+12); g.lineTo(px+TILE-1,py+12);
		g.moveTo(px+6,py+0); g.lineTo(px+6,py+5);
		g.moveTo(px+14,py+5); g.lineTo(px+14,py+12);
		g.moveTo(px+5,py+12); g.lineTo(px+5,py+TILE);
		g.stroke();
		dot(g,px,py,6,2,8,TILE-4,'rgba(24,18,15,0.48)');
		dot(g,px,py,8,3,4,TILE-6,'rgba(8,7,6,0.56)');
		dot(g,px,py,4+rx,3,3,2,'rgba(255,184,120,0.13)');
		dot(g,px,py,13,10+ry,3,2,'rgba(48,21,14,0.18)');
	} else if(t===T.DIRT){
		drawBlockBevel(g,px,py,'rgba(184,132,78,0.13)','rgba(31,20,11,0.28)');
		dot(g,px,py,2+rx,4,5,3,'rgba(55,35,20,0.30)');
		dot(g,px,py,10,9+ry,6,3,'rgba(119,80,45,0.24)');
		dot(g,px,py,4,14,4,2,'rgba(35,55,28,0.18)');
		strokePath(g,'rgba(33,24,16,0.22)',1,[[px+3,py+10],[px+8,py+9],[px+14,py+12]]);
	} else if(t===T.STONE){
		drawBlockBevel(g,px,py,'rgba(255,255,255,0.13)','rgba(23,25,31,0.20)');
		strokePath(g,'rgba(51,55,64,0.32)',1,[[px+3,py+6+ry],[px+8,py+7+ry],[px+11,py+5+ry]]);
		strokePath(g,'rgba(230,235,242,0.16)',1,[[px+4+rx,py+3],[px+9+rx,py+3]]);
		dot(g,px,py,13,11,3,2,'rgba(52,55,63,0.16)');
		dot(g,px,py,5,14,2,1,'rgba(235,238,244,0.15)');
	} else if(t===T.GRANITE){
		drawBlockBevel(g,px,py,'rgba(235,222,215,0.16)','rgba(31,31,38,0.24)');
		dot(g,px,py,2,2,TILE-4,TILE-4,'rgba(96,88,88,0.22)');
		dot(g,px,py,4+rx,5,4,3,'rgba(196,184,176,0.28)');
		dot(g,px,py,12,10+ry,4,3,'rgba(92,68,62,0.22)');
		strokePath(g,'rgba(45,47,54,0.30)',1,[[px+3,py+6],[px+9,py+8],[px+16,py+6]]);
	} else if(t===T.BASALT){
		drawBlockBevel(g,px,py,'rgba(132,142,156,0.10)','rgba(0,0,0,0.34)');
		dot(g,px,py,2,2,TILE-4,TILE-4,'rgba(16,18,22,0.46)');
		dot(g,px,py,4+rx,4,5,4,'rgba(63,69,78,0.28)');
		dot(g,px,py,11,12,5,2,'rgba(0,0,0,0.24)');
		strokePath(g,'rgba(105,114,128,0.22)',1,[[px+5,py+3],[px+8,py+9],[px+5,py+16]]);
		strokePath(g,'rgba(16,18,22,0.40)',1,[[px+13,py+4],[px+11,py+10],[px+15,py+15]]);
	} else if(t===T.BEDROCK){
		drawBlockBevel(g,px,py,'rgba(112,123,142,0.10)','rgba(0,0,0,0.44)');
		dot(g,px,py,1,2,TILE-2,TILE-4,'rgba(16,20,28,0.55)');
		dot(g,px,py,3+rx,5,7,2,'rgba(92,101,119,0.18)');
		dot(g,px,py,9,11+ry,8,3,'rgba(0,0,0,0.26)');
		strokePath(g,'rgba(142,153,174,0.18)',1,[[px+3,py+13],[px+8,py+8],[px+16,py+9]]);
		strokePath(g,'rgba(0,0,0,0.36)',1,[[px+2,py+5],[px+7,py+6],[px+13,py+3],[px+18,py+5]]);
	} else if(t===T.WOOD){
		drawBlockBevel(g,px,py,'rgba(255,211,124,0.12)','rgba(45,24,7,0.24)');
		dot(g,px,py,3+((h>>>7)&2),0,2,TILE,'rgba(74,43,19,0.30)');
		dot(g,px,py,11+((h>>>11)&2),0,2,TILE,'rgba(58,32,13,0.24)');
		strokePath(g,'rgba(235,173,91,0.32)',1,[[px+6,py+5],[px+11,py+7],[px+7,py+11],[px+13,py+14]]);
		dot(g,px,py,8,8,4,3,'rgba(73,39,16,0.23)');
	} else if(isDoorTile(t)){
		drawDoorTile(g,t,px,py,h,0);
	} else if(isTrapdoorTile(t)){
		drawTrapdoorTile(g,t,px,py,h,0);
	} else if(isLeaf(t)){
		const autumn=isAutumnLeaf(t);
		const brown=t===T.AUTUMN_LEAF_RED;
		drawBlockBevel(g,px,py,autumn?'rgba(255,212,112,0.18)':'rgba(129,241,84,0.16)',autumn?'rgba(105,30,18,0.24)':'rgba(12,82,30,0.22)');
		dot(g,px,py,2+rx,4,5,4,brown?'rgba(139,86,38,0.38)':(autumn?'rgba(230,132,38,0.36)':'rgba(74,191,61,0.34)'));
		dot(g,px,py,10,3+ry,5,5,brown?'rgba(88,52,24,0.36)':(autumn?'rgba(176,82,29,0.34)':'rgba(31,132,50,0.34)'));
		dot(g,px,py,5,12,6,4,brown?'rgba(188,124,55,0.28)':(autumn?'rgba(245,172,57,0.30)':'rgba(87,205,70,0.28)'));
		dot(g,px,py,14,14,2,2,brown?'rgba(62,35,17,0.30)':(autumn?'rgba(100,47,18,0.26)':'rgba(10,78,27,0.26)'));
	} else if(t===T.GOLD_ORE){
		drawBlockBevel(g,px,py,'rgba(255,223,118,0.22)','rgba(33,24,16,0.30)');
		dot(g,px,py,2,2,TILE-4,TILE-4,'rgba(82,83,78,0.30)');
		strokePath(g,'rgba(73,45,9,0.55)',4,[[px+2,py+10],[px+7,py+6],[px+12,py+9],[px+18,py+6]]);
		strokePath(g,'rgba(181,111,20,0.90)',2,[[px+2,py+10],[px+7,py+6],[px+12,py+9],[px+18,py+6]]);
		strokePath(g,'rgba(255,221,92,0.92)',1,[[px+3,py+9],[px+8,py+6],[px+13,py+8],[px+17,py+6]]);
		strokePath(g,'rgba(255,201,65,0.72)',1,[[px+4,py+14],[px+9,py+12],[px+15,py+14]]);
		dot(g,px,py,7,7,2,2,'rgba(255,248,182,0.92)');
		dot(g,px,py,14,5,2,1,'rgba(255,248,182,0.78)');
	} else if(t===T.DIAMOND){
		drawBlockBevel(g,px,py,'rgba(220,255,255,0.42)','rgba(0,75,125,0.22)');
		g.fillStyle='rgba(8,79,120,0.36)';
		g.beginPath(); g.moveTo(px+TILE/2,py+3); g.lineTo(px+TILE-4,py+9); g.lineTo(px+TILE/2,py+TILE-3); g.lineTo(px+4,py+9); g.closePath(); g.fill();
		g.fillStyle='rgba(122,255,255,0.80)';
		g.beginPath(); g.moveTo(px+TILE/2,py+4); g.lineTo(px+TILE-6,py+9); g.lineTo(px+TILE/2,py+TILE-6); g.lineTo(px+6,py+9); g.closePath(); g.fill();
		strokePath(g,'rgba(255,255,255,0.72)',1,[[px+6,py+9],[px+TILE-6,py+9],[px+TILE/2,py+TILE-6],[px+TILE/2,py+4]]);
		dot(g,px,py,7,6,3,2,'rgba(255,255,255,0.82)');
	} else if(t===T.IRIDIUM){
		drawBlockBevel(g,px,py,'rgba(225,242,255,0.34)','rgba(10,16,28,0.36)');
		dot(g,px,py,2,2,TILE-4,TILE-4,'rgba(28,37,52,0.42)');
		dot(g,px,py,4+rx,4,5,4,'rgba(185,215,245,0.36)');
		dot(g,px,py,11,10+ry,5,3,'rgba(75,93,120,0.32)');
		strokePath(g,'rgba(226,248,255,0.64)',1,[[px+4,py+13],[px+8,py+8],[px+13,py+9],[px+17,py+4]]);
		strokePath(g,'rgba(119,173,220,0.38)',1,[[px+3,py+5],[px+7,py+6],[px+10,py+3]]);
		dot(g,px,py,6,6,2,2,'rgba(255,255,255,0.78)');
		dot(g,px,py,14,13,2,2,'rgba(210,236,255,0.62)');
	} else if(t===T.METEORIC_IRON){
		drawBlockBevel(g,px,py,'rgba(216,222,226,0.22)','rgba(12,14,16,0.34)');
		dot(g,px,py,2,2,TILE-4,TILE-4,'rgba(37,42,46,0.40)');
		dot(g,px,py,5+rx,4,5,3,'rgba(147,156,163,0.34)');
		dot(g,px,py,11,10+ry,5,4,'rgba(34,38,42,0.30)');
		dot(g,px,py,4,13,3,2,'rgba(185,122,68,0.28)');
		strokePath(g,'rgba(219,229,236,0.28)',1,[[px+4,py+6],[px+9,py+7],[px+14,py+5]]);
		dot(g,px,py,13,5,2,2,'rgba(235,241,245,0.42)');
	} else if(t===T.UFO_CONCRETE){
		drawBlockBevel(g,px,py,'rgba(152,255,232,0.18)','rgba(2,10,16,0.40)');
		dot(g,px,py,2,2,TILE-4,TILE-4,'rgba(9,22,30,0.32)');
		dot(g,px,py,3+rx,5,6,2,'rgba(126,255,229,0.16)');
		dot(g,px,py,11,10+ry,5,2,'rgba(255,226,118,0.13)');
		strokePath(g,'rgba(126,255,229,0.32)',1,[[px+3,py+6],[px+8,py+4],[px+15,py+7]]);
		strokePath(g,'rgba(255,226,118,0.26)',1,[[px+5,py+14],[px+10,py+10],[px+16,py+12]]);
		dot(g,px,py,5,9,2,2,'rgba(125,255,229,0.45)');
		dot(g,px,py,13,4,2,1,'rgba(245,239,170,0.38)');
	} else if(t===T.RADIOACTIVE_ORE){
		drawBlockBevel(g,px,py,'rgba(190,255,120,0.25)','rgba(8,30,9,0.36)');
		dot(g,px,py,2,2,TILE-4,TILE-4,'rgba(13,43,17,0.48)');
		dot(g,px,py,4+rx,5,5,4,'rgba(138,255,79,0.38)');
		dot(g,px,py,11,10+ry,5,3,'rgba(40,120,34,0.32)');
		strokePath(g,'rgba(205,255,140,0.54)',1,[[px+4,py+13],[px+9,py+6],[px+15,py+10]]);
		dot(g,px,py,8,8,3,3,'rgba(229,255,142,0.72)');
	} else if(t===T.ALIEN_BIOMASS){
		drawBlockBevel(g,px,py,'rgba(205,255,154,0.18)','rgba(45,8,28,0.30)');
		dot(g,px,py,2,3,TILE-4,TILE-6,'rgba(42,86,45,0.52)');
		dot(g,px,py,4+rx,5,6,5,'rgba(121,201,93,0.42)');
		dot(g,px,py,10,10+ry,6,4,'rgba(190,76,118,0.28)');
		g.strokeStyle='rgba(236,255,190,0.36)';
		g.lineWidth=1;
		g.beginPath(); g.arc(px+TILE*0.52,py+TILE*0.54,5.5,0,Math.PI*2); g.stroke();
		dot(g,px,py,7,7,2,2,'rgba(255,207,142,0.65)');
	} else if(t===T.METEOR_DUST){
		drawBlockBevel(g,px,py,'rgba(236,215,255,0.18)','rgba(31,20,45,0.20)');
		dot(g,px,py,2,12,TILE-4,4,'rgba(124,91,166,0.34)');
		dot(g,px,py,3+rx,5,3,2,'rgba(200,166,255,0.44)');
		dot(g,px,py,11,8+ry,4,2,'rgba(124,247,255,0.26)');
		dot(g,px,py,6,14,8,1,'rgba(238,220,255,0.22)');
	} else if(t===T.ANTIMATTER_CRYSTAL){
		drawBlockBevel(g,px,py,'rgba(244,218,255,0.32)','rgba(4,4,18,0.42)');
		dot(g,px,py,2,2,TILE-4,TILE-4,'rgba(14,6,30,0.58)');
		g.fillStyle='rgba(211,107,255,0.78)';
		g.beginPath(); g.moveTo(px+TILE/2,py+3); g.lineTo(px+TILE-5,py+TILE/2); g.lineTo(px+TILE/2,py+TILE-3); g.lineTo(px+5,py+TILE/2); g.closePath(); g.fill();
		strokePath(g,'rgba(124,247,255,0.62)',1,[[px+5,py+TILE/2],[px+TILE/2,py+3],[px+TILE-5,py+TILE/2],[px+TILE/2,py+TILE-3],[px+5,py+TILE/2]]);
		dot(g,px,py,9,8,2,3,'rgba(255,255,255,0.80)');
	} else if(t===T.LAVA){
		drawBlockBevel(g,px,py,'rgba(255,225,98,0.25)','rgba(66,13,3,0.30)');
		dot(g,px,py,0,0,TILE,3,'rgba(255,190,46,0.33)');
		dot(g,px,py,4+rx,5,8,5,'rgba(255,121,22,0.34)');
		dot(g,px,py,2,14,7,3,'rgba(95,30,7,0.20)');
		dot(g,px,py,13,10,5,4,'rgba(255,219,74,0.22)');
		strokePath(g,'rgba(255,230,92,0.30)',1,[[px+3,py+8],[px+8,py+10],[px+13,py+7],[px+17,py+9]]);
	} else if(t===T.MUD){
		drawBlockBevel(g,px,py,'rgba(172,140,91,0.12)','rgba(35,24,13,0.28)');
		dot(g,px,py,2+rx,11,6,2,'rgba(48,35,20,0.26)');
		dot(g,px,py,9,5+ry,5,3,'rgba(128,103,67,0.26)');
		dot(g,px,py,5,4,2,2,'rgba(215,181,112,0.14)');
		dot(g,px,py,14,14,3,1,'rgba(35,25,15,0.24)');
	} else if(t===T.COAL){
		drawBlockBevel(g,px,py,'rgba(255,255,255,0.08)','rgba(0,0,0,0.35)');
		dot(g,px,py,4+rx,4,5,3,'rgba(9,10,13,0.48)');
		dot(g,px,py,11,10+((h>>>14)&3),5,3,'rgba(0,0,0,0.32)');
		dot(g,px,py,5,13,3,1,'rgba(210,220,230,0.20)');
	} else if(t===T.OBSIDIAN){
		drawBlockBevel(g,px,py,'rgba(170,126,255,0.13)','rgba(0,0,0,0.35)');
		dot(g,px,py,4+rx,4,4,10,'rgba(18,12,31,0.33)');
		dot(g,px,py,12,3+ry,3,12,'rgba(64,44,93,0.24)');
		dot(g,px,py,8,7,2,2,'rgba(188,136,255,0.30)');
	} else if(t===T.STEEL){
		drawBlockBevel(g,px,py,'rgba(255,255,255,0.22)','rgba(22,29,36,0.24)');
		dot(g,px,py,0,7,TILE,1,'rgba(42,51,60,0.20)');
		dot(g,px,py,7,0,1,TILE,'rgba(255,255,255,0.13)');
		dot(g,px,py,4,4,3,3,'rgba(45,53,63,0.24)');
		dot(g,px,py,13,13,3,3,'rgba(246,252,255,0.22)');
	} else if(t===T.TRACK){
		drawBlockBevel(g,px,py,'rgba(255,255,255,0.16)','rgba(7,10,14,0.30)');
		drawTrackTileArt(g,px,py,h,0);
	} else if(t===T.GLASS){
		drawBlockBevel(g,px,py,'rgba(230,255,255,0.45)','rgba(0,68,110,0.18)');
		dot(g,px,py,2,2,TILE-4,1,'rgba(255,255,255,0.30)');
		dot(g,px,py,2,TILE-3,TILE-4,1,'rgba(23,91,124,0.16)');
		dot(g,px,py,3,3,1,TILE-6,'rgba(255,255,255,0.24)');
		dot(g,px,py,TILE-4,3,1,TILE-6,'rgba(23,91,124,0.20)');
		dot(g,px,py,TILE>>1,4,1,TILE-8,'rgba(255,255,255,0.16)');
		dot(g,px,py,4,TILE>>1,TILE-8,1,'rgba(17,84,122,0.12)');
		strokePath(g,'rgba(255,255,255,0.30)',1,[[px+5,py+TILE-6],[px+TILE-6,py+5]]);
	} else if(t===T.ELECTRONICS || t===T.TRANSISTOR){
		const chip=t===T.TRANSISTOR;
		drawBlockBevel(g,px,py,chip?'rgba(148,255,206,0.22)':'rgba(114,240,190,0.15)','rgba(3,12,15,0.35)');
		dot(g,px,py,3,3,TILE-6,TILE-6,chip?'rgba(9,37,32,0.48)':'rgba(6,18,27,0.52)');
		dot(g,px,py,chip?7:6,chip?6:7,chip?6:8,chip?8:6,chip?'rgba(58,214,139,0.58)':'rgba(20,56,67,0.70)');
		strokePath(g,'rgba(96,255,191,0.44)',1,[[px+4,py+TILE-6],[px+8,py+TILE-10],[px+TILE-5,py+TILE-10]]);
		strokePath(g,'rgba(255,226,130,0.42)',1,[[px+TILE-5,py+5],[px+TILE-9,py+9],[px+TILE-9,py+TILE-4]]);
		dot(g,px,py,4+rx,5,2,2,'rgba(95,238,255,0.58)');
		dot(g,px,py,TILE-7,12,2,2,'rgba(255,226,130,0.46)');
		if(chip){
			dot(g,px,py,5,TILE-3,2,3,'rgba(255,226,130,0.58)');
			dot(g,px,py,TILE>>1,TILE-3,2,3,'rgba(255,226,130,0.58)');
			dot(g,px,py,TILE-7,TILE-3,2,3,'rgba(255,226,130,0.58)');
		}
	} else if(t===T.SOLAR_PANEL || t===T.SOLAR_BATTERY){
		const battery=t===T.SOLAR_BATTERY;
		drawBlockBevel(g,px,py,'rgba(117,248,235,0.18)','rgba(1,18,31,0.34)');
		dot(g,px,py,2,2,TILE-4,TILE-4,'rgba(3,10,17,0.42)');
		for(let yy=0; yy<2; yy++){
			for(let xx=0; xx<3; xx++){
				const a=0.16+(((h>>>(xx+yy*4))&3)*0.035);
				dot(g,px,py,4+xx*5,4+yy*6,4,5,'rgba(58,169,219,'+a.toFixed(3)+')');
			}
		}
		strokePath(g,'rgba(130,255,239,0.40)',1,[[px+3,py+10],[px+TILE-4,py+10]]);
		strokePath(g,'rgba(255,239,133,0.44)',1,[[px+4,py+TILE-5],[px+TILE-5,py+5]]);
		if(battery){
			dot(g,px,py,TILE-8,TILE-8,5,5,'rgba(4,27,29,0.80)');
			dot(g,px,py,TILE-7,TILE-7,3,3,'rgba(70,255,215,0.74)');
		}
	} else if(t===T.SPRING_PLATFORM){
		drawSpringPlatformTilePixels(g,px,py,h,0);
	} else if(t===T.DYNAMO || t===T.DYNAMO_SLOT){
		const slot=t===T.DYNAMO_SLOT;
		drawBlockBevel(g,px,py,slot?'rgba(90,218,255,0.18)':'rgba(255,224,104,0.18)','rgba(5,9,17,0.38)');
		if(slot){
			dot(g,px,py,5,2,TILE-10,TILE-4,'rgba(3,8,15,0.74)');
			dot(g,px,py,8,3,TILE-16,TILE-6,'rgba(84,204,255,0.22)');
			strokePath(g,'rgba(255,218,94,0.40)',1,[[px+6,py+4],[px+TILE-6,py+TILE-5]]);
		} else {
			dot(g,px,py,3,3,TILE-6,TILE-6,'rgba(15,22,31,0.36)');
			g.strokeStyle='rgba(255,211,70,0.46)';
			g.lineWidth=1.5;
			g.beginPath(); g.arc(px+TILE/2,py+TILE/2,5,0,Math.PI*2); g.stroke();
			strokePath(g,'rgba(255,236,137,0.56)',1,[[px+5,py+7],[px+TILE-5,py+7],[px+5,py+13],[px+TILE-5,py+13]]);
			dot(g,px,py,TILE>>1,4,1,TILE-8,'rgba(96,238,255,0.34)');
		}
	} else if(t===T.TELEPORTER){
		drawBlockBevel(g,px,py,'rgba(144,255,255,0.20)','rgba(0,8,18,0.42)');
		dot(g,px,py,2,2,TILE-4,TILE-4,'rgba(3,8,22,0.56)');
		g.strokeStyle='rgba(124,247,255,0.52)';
		g.lineWidth=1.5;
		g.beginPath(); g.arc(px+TILE/2,py+TILE/2,6,0,Math.PI*2); g.stroke();
		g.strokeStyle='rgba(255,226,120,0.45)';
		g.beginPath(); g.arc(px+TILE/2,py+TILE/2,3,0,Math.PI*2); g.stroke();
		strokePath(g,'rgba(124,247,255,0.30)',1,[[px+TILE/2,py+3],[px+TILE/2,py+TILE-3]]);
	} else if(t===T.WATER_PIPE){
		const conn={left:true,right:true,up:false,down:false};
		if(PUMPS && PUMPS.drawPipeTile) PUMPS.drawPipeTile(g,TILE,px,py,conn,h);
	} else if(t===T.WATER_PUMP){
		if(PUMPS && PUMPS.drawPumpTile) PUMPS.drawPumpTile(g,TILE,px,py,'east',0.15,0,0);
	} else if(t===T.TURRET || t===T.FIRE_TURRET || t===T.WATER_TURRET){
		drawTurretTilePixels(g,t,px,py,h);
	} else if(t===T.ANTIGRAVITY_BEACON){
		drawBlockBevel(g,px,py,'rgba(229,170,255,0.24)','rgba(8,3,18,0.42)');
		dot(g,px,py,2,2,TILE-4,TILE-4,'rgba(14,6,30,0.62)');
		g.strokeStyle='rgba(196,107,255,0.76)';
		g.lineWidth=1.4;
		g.beginPath(); g.arc(px+TILE/2,py+TILE/2,6.5,0,Math.PI*2); g.stroke();
		g.strokeStyle='rgba(124,247,255,0.54)';
		g.beginPath(); g.ellipse(px+TILE/2,py+TILE/2,7.5,3.2,-0.35,0,Math.PI*2); g.stroke();
		g.beginPath(); g.ellipse(px+TILE/2,py+TILE/2,3.2,7.2,0.28,0,Math.PI*2); g.stroke();
		dot(g,px,py,8,8,4,4,'rgba(244,218,255,0.88)');
		dot(g,px,py,9,4,2,3,'rgba(124,247,255,0.62)');
		dot(g,px,py,9,13,2,3,'rgba(124,247,255,0.42)');
	} else if(t===T.METEOR_SIREN){
		drawMeteorSirenTilePixels(g,px,py,h);
	} else if(t===T.VOLCANO_MASTER_STONE || t===T.SERVANT_STONE){
		const master=t===T.VOLCANO_MASTER_STONE;
		drawBlockBevel(g,px,py,master?'rgba(255,224,111,0.28)':'rgba(255,130,85,0.17)','rgba(45,9,3,0.36)');
		g.fillStyle=master?'rgba(255,198,46,0.78)':'rgba(105,32,18,0.72)';
		g.beginPath(); g.moveTo(px+TILE/2,py+3); g.lineTo(px+TILE-4,py+TILE/2); g.lineTo(px+TILE/2,py+TILE-3); g.lineTo(px+4,py+TILE/2); g.closePath(); g.fill();
		g.fillStyle=master?'rgba(255,86,22,0.84)':'rgba(255,86,35,0.42)';
		g.beginPath(); g.arc(px+TILE/2,py+TILE/2,master?4.3:3.0,0,Math.PI*2); g.fill();
		dot(g,px,py,5,5,2,2,master?'rgba(255,255,180,0.75)':'rgba(255,172,120,0.32)');
		dot(g,px,py,13,13,2,2,master?'rgba(255,120,35,0.72)':'rgba(80,18,10,0.55)');
	}
}
function drawEntityTileDetails(g,t,px,py,h,opts){
	if(t===T.GLASS){
		g.fillStyle='rgba(255,255,255,0.38)';
		g.fillRect(px+2,py+2,TILE-4,2);
		g.fillRect(px+3,py+4,2,TILE-8);
		g.fillStyle='rgba(28,95,130,0.22)';
		g.fillRect(px+TILE-4,py+3,2,TILE-6);
		if((h&5)===0){
			g.strokeStyle='rgba(255,255,255,0.42)';
			g.lineWidth=1;
			g.beginPath();
			g.moveTo(px+6,py+TILE-5);
			g.lineTo(px+TILE-5,py+6);
			g.stroke();
		}
	}
	if(isDoorTile(t)) drawDoorTile(g,t,px,py,h,0);
	if(isTrapdoorTile(t)) drawTrapdoorTile(g,t,px,py,h,0);
	if(t===T.WIRE){
		drawLooseWireOverlay(g,px,py,h);
	}
	if(t===T.COPPER_WIRE){
		const conn={left:true,right:true,up:false,down:false};
		if(TELEPORTERS && TELEPORTERS.drawCableTile) TELEPORTERS.drawCableTile(g,TILE,px,py,conn,h);
	}
	if(t===T.ELECTRONICS){
		g.fillStyle='rgba(7,14,19,0.28)';
		g.fillRect(px+2,py+2,TILE-4,TILE-4);
		g.strokeStyle='rgba(71,209,140,0.72)';
		g.lineWidth=1;
		g.beginPath();
		g.moveTo(px+4,py+6+((h>>3)&5));
		g.lineTo(px+TILE-5,py+6+((h>>8)&5));
		g.moveTo(px+8+((h>>11)&4),py+4);
		g.lineTo(px+8+((h>>11)&4),py+TILE-5);
		g.stroke();
		g.fillStyle='rgba(97,238,255,0.82)';
		g.fillRect(px+5+((h>>5)&8),py+5+((h>>12)&8),2,2);
		g.fillStyle='rgba(0,0,0,0.35)';
		g.fillRect(px+TILE-5,py+TILE-5,3,3);
	}
	if(t===T.TRANSISTOR){
		g.fillStyle='rgba(6,16,14,0.38)';
		g.fillRect(px+3,py+3,TILE-6,TILE-6);
		g.fillStyle='rgba(71,209,140,0.88)';
		g.fillRect(px+6,py+5,TILE-12,TILE-10);
		g.fillStyle='rgba(10,34,29,0.85)';
		g.fillRect(px+8,py+7,TILE-16,TILE-14);
		g.strokeStyle='rgba(255,226,130,0.76)';
		g.lineWidth=1;
		g.beginPath();
		g.moveTo(px+5,py+TILE-5); g.lineTo(px+5,py+TILE-2);
		g.moveTo(px+TILE*0.5,py+TILE-5); g.lineTo(px+TILE*0.5,py+TILE-2);
		g.moveTo(px+TILE-5,py+TILE-5); g.lineTo(px+TILE-5,py+TILE-2);
		g.stroke();
		g.fillStyle='rgba(120,255,210,0.75)';
		g.fillRect(px+TILE-7,py+5,2,2);
	}
	if(t===T.SOLAR_PANEL || t===T.SOLAR_BATTERY){
		g.fillStyle='rgba(3,11,18,0.55)';
		g.fillRect(px+2,py+2,TILE-4,TILE-4);
		g.strokeStyle='rgba(95,247,220,0.55)';
		g.lineWidth=1;
		g.strokeRect(px+3,py+3,TILE-6,TILE-6);
		const cellW=(TILE-8)/3, cellH=(TILE-8)/3;
		for(let yy=0; yy<3; yy++){
			for(let xx=0; xx<3; xx++){
				const shine=0.16+(((h>>(xx+yy*3))&3)*0.035);
				g.fillStyle='rgba(42,157,204,'+shine.toFixed(3)+')';
				g.fillRect(px+4+xx*cellW,py+4+yy*cellH,Math.max(2,cellW-1),Math.max(2,cellH-1));
			}
		}
		g.strokeStyle='rgba(255,228,118,0.62)';
		g.lineWidth=1;
		g.beginPath();
		g.moveTo(px+4,py+TILE-5);
		g.lineTo(px+TILE-5,py+4);
		g.stroke();
		if(t===T.SOLAR_BATTERY){
			g.fillStyle='rgba(6,18,21,0.82)';
			g.fillRect(px+TILE-8,py+TILE-8,5,4);
			g.fillStyle='rgba(84,247,212,0.85)';
			g.fillRect(px+TILE-7,py+TILE-7,3,2);
		}
	}
	if(t===T.SPRING_PLATFORM) drawSpringPlatformTilePixels(g,px,py,h,0);
	if(t===T.DYNAMO || t===T.DYNAMO_SLOT){
		if(t===T.DYNAMO){
			g.fillStyle='rgba(255,255,255,0.18)';
			g.fillRect(px+2,py+2,TILE-4,3);
			g.fillStyle='rgba(0,0,0,0.28)';
			g.fillRect(px+2,py+TILE-5,TILE-4,3);
			g.strokeStyle='rgba(255,210,74,0.75)';
			g.lineWidth=2;
			g.beginPath();
			g.moveTo(px+4,py+TILE*0.35);
			g.lineTo(px+TILE-4,py+TILE*0.35);
			g.moveTo(px+4,py+TILE*0.65);
			g.lineTo(px+TILE-4,py+TILE*0.65);
			g.stroke();
			g.fillStyle='rgba(15,20,28,0.36)';
			g.fillRect(px+5,py+5,TILE-10,TILE-10);
		} else {
			g.fillStyle='rgba(4,8,14,0.72)';
			g.fillRect(px+4,py+2,TILE-8,TILE-4);
			g.fillStyle='rgba(84,204,255,0.24)';
			g.fillRect(px+7,py+3,TILE-14,TILE-6);
			g.strokeStyle='rgba(255,210,74,0.55)';
			g.lineWidth=1.5;
			g.strokeRect(px+5,py+2,TILE-10,TILE-4);
		}
	}
	if(t===T.COAL){
		g.fillStyle='rgba(255,255,255,0.10)';
		g.fillRect(px+2+((h>>3)&5),py+3+((h>>8)&4),3,2);
		if((h&3)===0){
			g.fillStyle='rgba(180,190,198,0.28)';
			g.fillRect(px+6+((h>>6)&8),py+8+((h>>11)&5),2,2);
		}
	}
	if(t===T.STEEL){
		g.fillStyle='rgba(0,0,0,0.22)';
		g.fillRect(px+((h>>8)&3),py,2,TILE);
		g.fillStyle='rgba(230,245,255,0.55)';
		g.fillRect(px+4+((h>>4)&9),py+5+((h>>9)&7),2,2);
		g.fillStyle='rgba(30,38,48,0.35)';
		g.fillRect(px+3,py+4,2,2);
		g.fillRect(px+TILE-5,py+TILE-6,2,2);
	}
	if(t===T.TRACK){
		const phase=opts && Number.isFinite(Number(opts.trackPhase)) ? Number(opts.trackPhase) : 0;
		drawTrackTileArt(g,px,py,h,phase);
	}
}
function drawEntityTile(g,t,px,py,wx,wy,opts){
	const info=INFO[t];
	if(!g || !info || !info.color || t===T.AIR) return false;
	wx=Math.floor(Number.isFinite(Number(wx)) ? Number(wx) : 0);
	wy=Math.floor(Number.isFinite(Number(wy)) ? Number(wy) : 0);
	const h=hash32(wx,wy);
	g.save();
	const oldAlpha=g.globalAlpha;
	if(opts && Number.isFinite(Number(opts.alpha))) g.globalAlpha=oldAlpha*Number(opts.alpha);
	if(isChairTileId(t)){
		// chairs are open fixtures: glyph only, never a filled block square
		drawChairTile(g,px,py,t);
		g.restore();
		return true;
	}
	if(t===T.GOLD_ORE){
		const host=(h&2)?T.GRANITE:T.STONE;
		const rockCol=shadeColor(INFO[host].color, terrainShadeDelta(host,wx,wy,h));
		g.fillStyle=rockCol; g.fillRect(px,py,TILE,TILE);
		drawTerrainPattern(g,host,px,py,wx,wy,h);
		drawGoldOreArt(g,px,py,h);
	}else if(t===T.DIAMOND){
		const rockCol=shadeColor(INFO[T.STONE].color, terrainShadeDelta(T.STONE,wx,wy,h));
		g.fillStyle=rockCol; g.fillRect(px,py,TILE,TILE);
		drawTerrainPattern(g,T.STONE,px,py,wx,wy,h);
		drawDiamondOreArt(g,px,py,h);
	}else if(t===T.GRASS){
		const delta=terrainShadeDelta(t,wx,wy,h);
		drawGrassBodyGradient(g,px,py,delta?shadeColor(info.color,delta):info.color);
	}else{
		const delta=terrainShadeDelta(t,wx,wy,h);
		g.fillStyle=delta ? shadeColor(info.color,delta) : info.color;
		g.fillRect(px,py,TILE,TILE);
		drawTerrainPattern(g,t,px,py,wx,wy,h);
	}
	if(isLeaf(t)) drawLeafClumpArt(g,t,px,py,wx,wy,h);
	if(t===T.MUD) drawMudDetail(g,px,py,h);
	if(t===T.LAVA) drawLavaCrustArt(g,px,py,h);
	drawEntityTileDetails(g,t,px,py,h,opts||null);
	g.restore();
	return true;
}
MM.drawEntityTile=drawEntityTile;
const BACKGROUND_BUILD_SHADE_DELTA=-30;
const BACKGROUND_BUILD_PATTERN_DARKEN='rgba(0,0,0,0.10)';
function drawBackgroundBuildTile(g,t,px,py,wx,y,h){
	const info=INFO[t];
	if(!info || !info.color) return;
	const delta=terrainShadeDelta(t,wx,y,h)+BACKGROUND_BUILD_SHADE_DELTA;
	const col=shadeColor(info.color,delta);
	g.save();
	g.globalAlpha=1;
	g.fillStyle=col;
	g.fillRect(px,py,TILE,TILE);
	drawTerrainPattern(g,t,px,py,wx,y,h);
	g.fillStyle=BACKGROUND_BUILD_PATTERN_DARKEN;
	g.fillRect(px,py,TILE,TILE);
	g.restore();
	g.fillStyle='rgba(0,0,0,0.18)';
	g.fillRect(px,py,TILE,1);
	g.fillRect(px,py,1,TILE);
	g.fillStyle='rgba(255,255,255,0.08)';
	g.fillRect(px+2,py+2,TILE-4,1);
	g.fillRect(px+2,py+2,1,TILE-4);
	if(((h>>>3)&3)===0){
		g.fillStyle='rgba(255,255,255,0.07)';
		g.fillRect(px+4+((h>>>7)&7),py+5+((h>>>11)&7),3,1);
	}
}
function drawChunkToCache(cx,sy,centerCx){ sy=Number.isFinite(sy) ? Math.floor(sy) : 0; const key=worldRenderSectionKey(cx,sy); const arr=worldChunkArrayFor({cx,sy},true); if(!arr) return; const originY=worldSectionOriginY(sy); const sectionH=worldSectionHeight(); let entry=chunkCanvases.get(key); if(!entry){
		// each cached chunk holds a full-height canvas (megabytes of pixels) — evict the
		// chunks farthest from the current view so a long trek can't accumulate them forever
		trimChunkCanvasCache(Number.isFinite(centerCx)?centerCx:cx, CHUNK_CANVAS_MAX_KEEP-1, sy);
		const c=document.createElement('canvas'); c.width=CHUNK_W*TILE; c.height=sectionH*TILE; const cctx=c.getContext('2d'); cctx.imageSmoothingEnabled=false; entry={canvas:c,ctx:cctx,version:-1,sy,chests:[],doorways:[]}; chunkCanvases.set(key,entry); }
	const currentVersion=WORLD.chunkVersion(cx,sy); if(entry.version===currentVersion && !entry.edgeStale){ chunkRenderDirty.delete(key); return; }
	// Version-only sync: the shared base-section version moved but no pixels in
	// THIS section changed (empty dirty band) — adopt the version, skip repainting
	if(entry.version>=0 && !entry.edgeStale){
		const d0=chunkRenderDirty.get(key);
		if(d0 && !d0.full && d0.min>d0.max && d0.baseVersion===entry.version && d0.version===currentVersion){
			entry.version=currentVersion; chunkRenderDirty.delete(key); return;
		}
	}
	if(entry.version>=0 && METEORITES && METEORITES.isChunkBusy && METEORITES.isChunkBusy(cx)){ chunkCacheDeferredThisFrame++; return; } if(!canRebuildChunkCache(entry,currentVersion)) return; const cctx=entry.ctx; const dirty=chunkRenderDirty.get(key); const partial=!!(entry.version>=0 && dirty && !dirty.full && dirty.baseVersion===entry.version && dirty.version===currentVersion && dirty.min<=dirty.max);
	const __bakeT0=performance.now();
	const redrawY0=partial?Math.max(0,dirty.min|0):0;
	const redrawY1=partial?Math.min(sectionH-1,dirty.max|0):sectionH-1;
	const redrawWorldY0=originY+redrawY0;
	const redrawWorldY1=originY+redrawY1;
	if(cctx.setTransform) cctx.setTransform(1,0,0,1,0,0);
	if(partial){
		chunkCachePartialRebuiltThisFrame++;
		cctx.clearRect(0,redrawY0*TILE,cctx.canvas.width,(redrawY1-redrawY0+1)*TILE);
		entry.chests=(entry.chests||[]).filter(o=>o.y<redrawWorldY0 || o.y>redrawWorldY1);
		entry.doorways=(entry.doorways||[]).filter(o=>o.y<redrawWorldY0 || o.y>redrawWorldY1);
	}else{
		cctx.clearRect(0,0,cctx.canvas.width,cctx.canvas.height);
		entry.chests=[];
		entry.doorways=[];
	}
	cctx.save();
	cctx.translate(0,-originY*TILE);
		for(let lx=0; lx<CHUNK_W; lx++){
			const wx=cx*CHUNK_W+lx;
			const surf=WORLDGEN.surfaceHeight(wx);
			for(let y=redrawWorldY0;y<=redrawWorldY1;y++){
				const localY=y-originY;
				const t=arr[localY*CHUNK_W+lx];
				// TORCH renders as a sprite in the fire.js pass; GRAVE gets a headstone shape
				// below — both bake only their backdrop here
				const gasTile = isGasTileId(t);
				const bgT=(WORLD && WORLD.getConstructionBackground) ? WORLD.getConstructionBackground(wx,y) : T.AIR;
				const hasBg=bgT!==T.AIR && INFO[bgT] && INFO[bgT].color;
				if(hasBg){
					if((t===T.AIR || t===T.WATER || t===T.TORCH || t===T.GRAVE || t===T.RESPAWN_TOTEM || isChairTileId(t) || t===T.WIRE || t===T.COPPER_WIRE || t===T.WATER_PIPE || gasTile) && y>surf && !(gasTile && gasSkyExposedTile(wx,y))){
						drawUndergroundBackdrop(cctx,lx*TILE,y*TILE,wx,y,surf);
					}
					drawBackgroundBuildTile(cctx,bgT,lx*TILE,y*TILE,wx,y,hash32(wx,y));
				}
				if(t===T.AIR || t===T.WATER || t===T.TORCH || t===T.GRAVE || t===T.RESPAWN_TOTEM || isChairTileId(t) || t===T.WIRE || t===T.COPPER_WIRE || t===T.WATER_PIPE || gasTile){
					// Water is rendered by the dynamic fluid layer (springs/waves/caustics), not
					// baked here — only its backdrop is. Underground air or water = carved cave /
					// aquifer: paint a dark rock backdrop so the sky parallax never shows through
					const hasBackdrop=y>surf && !(gasTile && gasSkyExposedTile(wx,y));
					if(!hasBg && hasBackdrop){
						drawUndergroundBackdrop(cctx,lx*TILE,y*TILE,wx,y,surf);
					}
					if(hasBg || hasBackdrop){
						drawCaveContactShade(cctx,lx*TILE,y*TILE,
							isSolid(chunkTileAt(arr,cx,lx,y-1,originY,sectionH)),
							isSolid(chunkTileAt(arr,cx,lx,y+1,originY,sectionH)),
							isSolid(chunkTileAt(arr,cx,lx-1,y,originY,sectionH)),
							isSolid(chunkTileAt(arr,cx,lx+1,y,originY,sectionH)));
					}
					if(t===T.GRAVE) drawGraveTile(cctx, lx*TILE, y*TILE);
					if(t===T.RESPAWN_TOTEM) drawRespawnTotemTile(cctx, lx*TILE, y*TILE);
					if(isChairTileId(t)) drawChairTile(cctx, lx*TILE, y*TILE, t);
					if(t===T.WIRE){
						const px=lx*TILE, py=y*TILE, h=hash32(wx,y);
						const y1=py+9+((h>>4)&2);
						const y2=py+5+((h>>7)&3);
						const y3=py+13-((h>>10)&3);
						const y4=py+9+((h>>13)&2);
						cctx.save();
						cctx.lineCap='round';
						cctx.lineJoin='round';
						cctx.strokeStyle='rgba(24,18,16,0.78)';
						cctx.lineWidth=4;
						cctx.beginPath();
						cctx.moveTo(px+1, y1);
						cctx.bezierCurveTo(px+6, y2, px+13, y3, px+TILE-1, y4);
						cctx.stroke();
						cctx.strokeStyle='rgba(219,126,51,0.96)';
						cctx.lineWidth=2;
						cctx.beginPath();
						cctx.moveTo(px+2, y1);
						cctx.bezierCurveTo(px+6, y2, px+13, y3, px+TILE-2, y4);
						cctx.stroke();
						cctx.strokeStyle='rgba(255,207,116,0.82)';
						cctx.lineWidth=1;
						cctx.beginPath();
						cctx.moveTo(px+4, y1-1);
						cctx.bezierCurveTo(px+8, y2-1, px+12, y3-1, px+TILE-4, y4-1);
						cctx.stroke();
						cctx.fillStyle='rgba(13,15,18,0.72)';
						cctx.fillRect(px+2,py+12,4,2);
						cctx.fillRect(px+TILE-6,py+6+((h>>9)&5),4,2);
						cctx.fillStyle='rgba(255,202,110,0.85)';
						if((h&3)===0) cctx.fillRect(px+4+((h>>6)&8), py+7+((h>>11)&3), 2, 2);
						cctx.restore();
					}
					if(t===T.COPPER_WIRE){
						const px=lx*TILE, py=y*TILE, h=hash32(wx,y);
						const peek=(qx,qy)=> (WORLD && WORLD.peekTile) ? WORLD.peekTile(qx,qy,T.AIR) : getTile(qx,qy);
						const conn=(TELEPORTERS && TELEPORTERS.cableConnections) ? TELEPORTERS.cableConnections(wx,y,peek) : {left:true,right:true,up:false,down:false};
						if(TELEPORTERS && TELEPORTERS.drawCableTile) TELEPORTERS.drawCableTile(cctx,TILE,px,py,conn,h);
					}
					continue;
				}
				const h = hash32(wx,y);
				if(isLooseItemTile(t)){
					drawUndergroundBackdrop(cctx,lx*TILE,y*TILE,wx,y,surf);
					if(t===T.MEAT || t===T.ROTTEN_MEAT || t===T.BAKED_MEAT){
						drawMeatTile(cctx,lx*TILE,y*TILE,t===T.ROTTEN_MEAT?'rotten':(t===T.BAKED_MEAT?'baked':'fresh'),h);
					}
					continue;
				}
				let base=INFO[t].color; if(!base) continue;
				// static depth shade folded into the base fill: buried terrain darkens
				// gently so caves feel deep (emissive matter keeps glowing in the dark)
				const depthDelta=(y>surf && t!==T.LAVA && t!==T.RADIOACTIVE_ORE && t!==T.ANTIMATTER_CRYSTAL)
					? -Math.min(14,(y-surf)*0.5)|0 : 0;
				if(t===T.GOLD_ORE){
					const host=(h&2)?T.GRANITE:T.STONE;
					const rockCol=shadeColor(INFO[host].color, terrainShadeDelta(host,wx,y,h)+depthDelta);
					cctx.fillStyle=rockCol; cctx.fillRect(lx*TILE,y*TILE,TILE,TILE);
					drawTerrainPattern(cctx,host,lx*TILE,y*TILE,wx,y,h);
					drawGoldOreArt(cctx,lx*TILE,y*TILE,h);
				}else if(t===T.DIAMOND){
					// diamond bakes as crystals embedded in host stone, not a flat cyan slab
					const rockCol=shadeColor(INFO[T.STONE].color, terrainShadeDelta(T.STONE,wx,y,h)+depthDelta);
					cctx.fillStyle=rockCol; cctx.fillRect(lx*TILE,y*TILE,TILE,TILE);
					drawTerrainPattern(cctx,T.STONE,lx*TILE,y*TILE,wx,y,h);
					drawDiamondOreArt(cctx,lx*TILE,y*TILE,h);
				}else if(t===T.GRASS){
					const delta = terrainShadeDelta(t,wx,y,h)+depthDelta;
					drawGrassBodyGradient(cctx,lx*TILE,y*TILE,delta?shadeColor(base,delta):base);
				}else{
					const delta = terrainShadeDelta(t,wx,y,h)+depthDelta;
					const col = delta? shadeColor(base, delta) : base;
					cctx.fillStyle=col; cctx.fillRect(lx*TILE,y*TILE,TILE,TILE);
					drawTerrainPattern(cctx,t,lx*TILE,y*TILE,wx,y,h);
				}
				if(isLeaf(t)) drawLeafClumpArt(cctx,t,lx*TILE,y*TILE,wx,y,h);
				if(t===T.MUD) drawMudDetail(cctx,lx*TILE,y*TILE,h);
				if(t===T.LAVA) drawLavaCrustArt(cctx,lx*TILE,y*TILE,h);
				// Keep chunk-cache rebuilds cheap; special tiles below carry the high-detail pass.
				if(t===T.GLASS){
					const px=lx*TILE, py=y*TILE;
					cctx.fillStyle='rgba(255,255,255,0.38)';
					cctx.fillRect(px+2,py+2,TILE-4,2);
					cctx.fillRect(px+3,py+4,2,TILE-8);
					cctx.fillStyle='rgba(28,95,130,0.22)';
					cctx.fillRect(px+TILE-4,py+3,2,TILE-6);
					if((h&5)===0){
						cctx.strokeStyle='rgba(255,255,255,0.42)';
						cctx.lineWidth=1;
						cctx.beginPath();
						cctx.moveTo(px+6,py+TILE-5);
						cctx.lineTo(px+TILE-5,py+6);
						cctx.stroke();
					}
				}
				if(isDoorTile(t)){
					entry.doorways.push({x:wx,y,t,h});
					drawDoorTile(cctx,t,lx*TILE,y*TILE,h,0);
				}
				if(isTrapdoorTile(t)){
					entry.doorways.push({x:wx,y,t,h});
					drawTrapdoorTile(cctx,t,lx*TILE,y*TILE,h,0);
				}
				if(t===T.ELECTRONICS){
					const px=lx*TILE, py=y*TILE;
					cctx.fillStyle='rgba(7,14,19,0.28)';
					cctx.fillRect(px+2,py+2,TILE-4,TILE-4);
					cctx.strokeStyle='rgba(71,209,140,0.72)';
					cctx.lineWidth=1;
					cctx.beginPath();
					cctx.moveTo(px+4,py+6+((h>>3)&5));
					cctx.lineTo(px+TILE-5,py+6+((h>>8)&5));
					cctx.moveTo(px+8+((h>>11)&4),py+4);
					cctx.lineTo(px+8+((h>>11)&4),py+TILE-5);
					cctx.stroke();
					cctx.fillStyle='rgba(97,238,255,0.82)';
					cctx.fillRect(px+5+((h>>5)&8),py+5+((h>>12)&8),2,2);
					cctx.fillStyle='rgba(0,0,0,0.35)';
					cctx.fillRect(px+TILE-5,py+TILE-5,3,3);
				}
				if(t===T.TRANSISTOR){
					const px=lx*TILE, py=y*TILE;
					cctx.fillStyle='rgba(6,16,14,0.38)';
					cctx.fillRect(px+3,py+3,TILE-6,TILE-6);
					cctx.fillStyle='rgba(71,209,140,0.88)';
					cctx.fillRect(px+6,py+5,TILE-12,TILE-10);
					cctx.fillStyle='rgba(10,34,29,0.85)';
					cctx.fillRect(px+8,py+7,TILE-16,TILE-14);
					cctx.strokeStyle='rgba(255,226,130,0.76)';
					cctx.lineWidth=1;
					cctx.beginPath();
					cctx.moveTo(px+5,py+TILE-5); cctx.lineTo(px+5,py+TILE-2);
					cctx.moveTo(px+TILE*0.5,py+TILE-5); cctx.lineTo(px+TILE*0.5,py+TILE-2);
					cctx.moveTo(px+TILE-5,py+TILE-5); cctx.lineTo(px+TILE-5,py+TILE-2);
					cctx.stroke();
					cctx.fillStyle='rgba(120,255,210,0.75)';
					cctx.fillRect(px+TILE-7,py+5,2,2);
				}
				if(t===T.VENDING_MACHINE){
					drawVendingMachineTile(cctx,lx*TILE,y*TILE,h,0);
				}
				if(t===T.SOLAR_PANEL || t===T.SOLAR_BATTERY){
					const px=lx*TILE, py=y*TILE;
					cctx.fillStyle='rgba(3,11,18,0.55)';
					cctx.fillRect(px+2,py+2,TILE-4,TILE-4);
					cctx.strokeStyle='rgba(95,247,220,0.55)';
					cctx.lineWidth=1;
					cctx.strokeRect(px+3,py+3,TILE-6,TILE-6);
					const cellW=(TILE-8)/3;
					const cellH=(TILE-8)/3;
					for(let yy=0; yy<3; yy++){
						for(let xx=0; xx<3; xx++){
							const shine=0.16+(((h>>(xx+yy*3))&3)*0.035);
							cctx.fillStyle='rgba(42,157,204,'+shine.toFixed(3)+')';
							cctx.fillRect(px+4+xx*cellW,py+4+yy*cellH,Math.max(2,cellW-1),Math.max(2,cellH-1));
						}
					}
					cctx.strokeStyle='rgba(255,228,118,0.62)';
					cctx.lineWidth=1;
					cctx.beginPath();
					cctx.moveTo(px+4,py+TILE-5);
					cctx.lineTo(px+TILE-5,py+4);
					cctx.stroke();
					if(t===T.SOLAR_BATTERY){
						cctx.fillStyle='rgba(6,18,21,0.82)';
						cctx.fillRect(px+TILE-8,py+TILE-8,5,4);
						cctx.fillStyle='rgba(84,247,212,0.85)';
						cctx.fillRect(px+TILE-7,py+TILE-7,3,2);
					}
				}
				if(t===T.SPRING_PLATFORM){
					drawSpringPlatformTilePixels(cctx,lx*TILE,y*TILE,h,0);
				}
				if(t===T.DYNAMO || t===T.DYNAMO_SLOT){
					const px=lx*TILE, py=y*TILE;
					if(t===T.DYNAMO){
						cctx.fillStyle='rgba(255,255,255,0.18)';
						cctx.fillRect(px+2,py+2,TILE-4,3);
						cctx.fillStyle='rgba(0,0,0,0.28)';
						cctx.fillRect(px+2,py+TILE-5,TILE-4,3);
						cctx.strokeStyle='rgba(255,210,74,0.75)';
						cctx.lineWidth=2;
						cctx.beginPath();
						cctx.moveTo(px+4,py+TILE*0.35);
						cctx.lineTo(px+TILE-4,py+TILE*0.35);
						cctx.moveTo(px+4,py+TILE*0.65);
						cctx.lineTo(px+TILE-4,py+TILE*0.65);
						cctx.stroke();
						cctx.fillStyle='rgba(15,20,28,0.36)';
						cctx.fillRect(px+5,py+5,TILE-10,TILE-10);
					} else {
						cctx.fillStyle='rgba(4,8,14,0.72)';
						cctx.fillRect(px+4,py+2,TILE-8,TILE-4);
						cctx.fillStyle='rgba(84,204,255,0.24)';
						cctx.fillRect(px+7,py+3,TILE-14,TILE-6);
						cctx.strokeStyle='rgba(255,210,74,0.55)';
						cctx.lineWidth=1.5;
						cctx.strokeRect(px+5,py+2,TILE-10,TILE-4);
					}
				}
				if(t===T.TELEPORTER){
					const px=lx*TILE, py=y*TILE;
					cctx.fillStyle='rgba(5,10,22,0.82)';
					cctx.fillRect(px+2,py+2,TILE-4,TILE-4);
					cctx.strokeStyle='rgba(124,247,255,0.86)';
					cctx.lineWidth=2;
					cctx.strokeRect(px+3,py+2,TILE-6,TILE-4);
					cctx.strokeStyle='rgba(255,225,115,0.58)';
					cctx.lineWidth=1.3;
					cctx.beginPath();
					cctx.arc(px+TILE*0.5,py+TILE*0.5,TILE*0.22,0,Math.PI*2);
					cctx.stroke();
					cctx.fillStyle='rgba(124,247,255,0.22)';
					cctx.fillRect(px+TILE*0.30,py+TILE*0.18,TILE*0.40,TILE*0.64);
				}
				if(t===T.WATER_PUMP){
					const px=lx*TILE, py=y*TILE;
					const dir=(PUMPS && PUMPS.orientationAt) ? PUMPS.orientationAt(wx,y,(qx,qy)=> (WORLD && WORLD.peekTile) ? WORLD.peekTile(qx,qy,T.AIR) : getTile(qx,qy)) : 'east';
					if(PUMPS && PUMPS.drawPumpTile) PUMPS.drawPumpTile(cctx,TILE,px,py,dir,0.15,0,0);
				}
				if(t===T.TURRET || t===T.FIRE_TURRET || t===T.WATER_TURRET){
					const px=lx*TILE, py=y*TILE;
					drawTurretTilePixels(cctx,t,px,py,h);
				}
				if(t===T.ANTIGRAVITY_BEACON){
					const px=lx*TILE, py=y*TILE;
					cctx.fillStyle='rgba(13,5,28,0.84)';
					cctx.fillRect(px+2,py+2,TILE-4,TILE-4);
					cctx.strokeStyle='rgba(196,107,255,0.86)';
					cctx.lineWidth=2;
					cctx.beginPath();
					cctx.arc(px+TILE*0.5,py+TILE*0.5,TILE*0.28,0,Math.PI*2);
					cctx.stroke();
					cctx.strokeStyle='rgba(124,247,255,0.62)';
					cctx.lineWidth=1.2;
					cctx.beginPath();
					cctx.ellipse(px+TILE*0.5,py+TILE*0.5,TILE*0.39,TILE*0.15,-0.32,0,Math.PI*2);
					cctx.stroke();
					cctx.beginPath();
					cctx.ellipse(px+TILE*0.5,py+TILE*0.5,TILE*0.16,TILE*0.36,0.22,0,Math.PI*2);
					cctx.stroke();
					cctx.fillStyle='rgba(244,218,255,0.92)';
					cctx.fillRect(px+8,py+8,4,4);
					cctx.fillStyle='rgba(124,247,255,0.62)';
					cctx.fillRect(px+9,py+4,2,3);
					cctx.fillRect(px+9,py+13,2,3);
				}
				if(t===T.METEOR_SIREN){
					drawMeteorSirenTilePixels(cctx,lx*TILE,y*TILE,h);
				}
				// Snow sparkle (caps/rims now come from the neighbor-aware edge pass)
				if(t===T.SNOW){
					if((h&7)===0){
						cctx.fillStyle='rgba(255,255,255,0.18)';
						cctx.fillRect(lx*TILE+4+((h>>5)&8), y*TILE+6+((h>>10)&6), 3, 1);
					}
				}
				// Ice reads glossy, not grainy: deterministic diagonal glint pair
				// (snow stays matte for contrast); crown/depth shading is edge-pass work
				if(t===T.ICE){
					const gx=lx*TILE+3+((h>>5)&7), gy=y*TILE+4;
					cctx.strokeStyle='rgba(255,255,255,0.30)'; cctx.lineWidth=1.5;
					cctx.beginPath(); cctx.moveTo(gx, gy+9); cctx.lineTo(gx+8, gy); cctx.stroke();
					cctx.strokeStyle='rgba(140,195,235,0.35)'; cctx.lineWidth=1;
					cctx.beginPath(); cctx.moveTo(gx-2, gy+12); cctx.lineTo(gx+4, gy+5); cctx.stroke();
				}
				// Obsidian: volcanic glass — a rare glint pixel (violet sheen via edge pass)
				if(t===T.OBSIDIAN){
					if((h&7)===0){
						cctx.fillStyle='rgba(190,150,255,0.45)';
						cctx.fillRect(lx*TILE+3+((h>>6)&13), y*TILE+4+((h>>10)&11), 2, 2);
					}
				}
				if(t===T.COAL){
					cctx.fillStyle='rgba(255,255,255,0.10)';
					cctx.fillRect(lx*TILE+2+((h>>3)&5), y*TILE+3+((h>>8)&4), 3, 2);
					if((h&3)===0){
						cctx.fillStyle='rgba(180,190,198,0.28)';
						cctx.fillRect(lx*TILE+6+((h>>6)&8), y*TILE+8+((h>>11)&5), 2, 2);
					}
				}
				if(t===T.STEEL){
					cctx.fillStyle='rgba(0,0,0,0.22)';
					cctx.fillRect(lx*TILE+((h>>8)&3), y*TILE, 2, TILE);
					cctx.fillStyle='rgba(230,245,255,0.55)';
					cctx.fillRect(lx*TILE+4+((h>>4)&9), y*TILE+5+((h>>9)&7), 2, 2);
					cctx.fillStyle='rgba(30,38,48,0.35)';
					cctx.fillRect(lx*TILE+3, y*TILE+4, 2, 2);
					cctx.fillRect(lx*TILE+TILE-5, y*TILE+TILE-6, 2, 2);
				}
				if(t===T.TRACK){
					drawTrackTileArt(cctx,lx*TILE,y*TILE,h,0);
				}
				if(t===T.IRIDIUM){
					cctx.strokeStyle='rgba(220,244,255,0.44)';
					cctx.lineWidth=1;
					cctx.beginPath();
					cctx.moveTo(lx*TILE+3, y*TILE+13);
					cctx.lineTo(lx*TILE+7+((h>>5)&3), y*TILE+8);
					cctx.lineTo(lx*TILE+13, y*TILE+9);
					cctx.lineTo(lx*TILE+17, y*TILE+4+((h>>9)&3));
					cctx.stroke();
					if((h&3)===0){
						cctx.fillStyle='rgba(255,255,255,0.68)';
						cctx.fillRect(lx*TILE+4+((h>>7)&10), y*TILE+4+((h>>11)&9), 2, 2);
					}
				}
				if(t===T.METEORIC_IRON){
					cctx.fillStyle='rgba(26,31,35,0.26)';
					cctx.fillRect(lx*TILE+4+((h>>7)&4), y*TILE+5, 4, 3);
					cctx.fillStyle='rgba(179,113,58,0.24)';
					cctx.fillRect(lx*TILE+11, y*TILE+11+((h>>5)&3), 3, 2);
					if((h&5)===0){
						cctx.fillStyle='rgba(230,238,244,0.40)';
						cctx.fillRect(lx*TILE+5+((h>>9)&9), y*TILE+4+((h>>12)&7), 2, 2);
					}
				}
				if(t===T.UFO_CONCRETE){
					const px=lx*TILE, py=y*TILE;
					cctx.strokeStyle='rgba(126,255,229,0.28)';
					cctx.lineWidth=1;
					cctx.beginPath();
					cctx.moveTo(px+3,py+5+((h>>4)&4));
					cctx.lineTo(px+8+((h>>8)&4),py+4);
					cctx.lineTo(px+16,py+8+((h>>11)&3));
					cctx.moveTo(px+4,py+15);
					cctx.lineTo(px+9+((h>>6)&3),py+11);
					cctx.lineTo(px+16,py+13+((h>>13)&2));
					cctx.stroke();
					if((h&3)===0){
						cctx.fillStyle='rgba(255,226,118,0.44)';
						cctx.fillRect(px+4+((h>>6)&10),py+4+((h>>10)&9),2,2);
					}
				}
				// Chest highlight & tier flair
				if(t===T.CHEST_COMMON||t===T.CHEST_RARE||t===T.CHEST_EPIC){
					entry.chests.push({x:wx,y,t});
					drawChestTile(cctx,lx*TILE,y*TILE,t,h);
				}
				if(t===T.INVASION_CACHE){
					drawInvasionCacheTile(cctx,lx*TILE,y*TILE,h);
				}
				if(t===T.STONE){
					const px=lx*TILE, py=y*TILE;
					cctx.fillStyle='rgba(34,38,46,0.09)';
					cctx.fillRect(px+4+((h>>8)&7), py+6+((h>>12)&5), 5, 1);
					if((h&5)===0){
						cctx.fillStyle='rgba(225,230,238,0.10)';
						cctx.fillRect(px+6+((h>>5)&6), py+12+((h>>10)&3), 4, 1);
					}
				}
				if(t===T.WOOD){ cctx.fillStyle='rgba(0,0,0,0.05)'; cctx.fillRect(lx*TILE + ((h>>8)&3), y*TILE, 2, TILE); }
				// Final neighbor-aware pass: sunlit rims, AO shadows, silhouette
				// notching and material caps on every exposed face
				drawTerrainEdgeFX(cctx,t,arr,cx,lx,y,originY,sectionH,wx,lx*TILE,y*TILE,h,surf);
			}
		}
	cctx.restore();
	entry.version=currentVersion; entry.edgeStale=false; chunkRenderDirty.delete(key);
	try{ const ms=performance.now()-__bakeT0; const s=window.__mmBakeStats=window.__mmBakeStats||{fullN:0,fullMs:0,fullMax:0,partN:0,partMs:0}; if(partial){ s.partN++; s.partMs+=ms; } else { s.fullN++; s.fullMs+=ms; s.fullMax=Math.max(s.fullMax,ms); } }catch(e){}
}
function drawLooseWireOverlay(g,px,py,h){
	const y1=py+9+((h>>4)&2);
	const y2=py+5+((h>>7)&3);
	const y3=py+13-((h>>10)&3);
	const y4=py+9+((h>>13)&2);
	g.save();
	g.lineCap='round';
	g.lineJoin='round';
	g.strokeStyle='rgba(24,18,16,0.78)';
	g.lineWidth=4;
	g.beginPath();
	g.moveTo(px+1,y1);
	g.bezierCurveTo(px+6,y2,px+13,y3,px+TILE-1,y4);
	g.stroke();
	g.strokeStyle='rgba(219,126,51,0.96)';
	g.lineWidth=2;
	g.beginPath();
	g.moveTo(px+2,y1);
	g.bezierCurveTo(px+6,y2,px+13,y3,px+TILE-2,y4);
	g.stroke();
	g.strokeStyle='rgba(255,207,116,0.82)';
	g.lineWidth=1;
	g.beginPath();
	g.moveTo(px+4,y1-1);
	g.bezierCurveTo(px+8,y2-1,px+12,y3-1,px+TILE-4,y4-1);
	g.stroke();
	g.fillStyle='rgba(13,15,18,0.72)';
	g.fillRect(px+2,py+12,4,2);
	g.fillRect(px+TILE-6,py+6+((h>>9)&5),4,2);
	g.fillStyle='rgba(255,202,110,0.85)';
	if((h&3)===0) g.fillRect(px+4+((h>>6)&8),py+7+((h>>11)&3),2,2);
	g.restore();
}
function drawLadderOverlay(g,px,py,h,conn){
	g.save();
	conn=conn||{};
	const up=!!conn.up, down=!!conn.down;
	const railTop=up?0:1;
	const railBottom=down?TILE:TILE-1;
	const railH=Math.max(1,railBottom-railTop);
	const railShadow='rgba(58,34,17,0.72)';
	const rail='rgba(184,124,61,0.94)';
	const railHi='rgba(244,185,96,0.56)';
	const rung='rgba(203,145,75,0.95)';
	const rungDark='rgba(88,48,22,0.72)';
	g.fillStyle='rgba(0,0,0,0.20)';
	g.fillRect(px+5,py+railTop+1,2,Math.max(1,railH-1));
	g.fillRect(px+14,py+railTop+1,2,Math.max(1,railH-1));
	g.fillStyle=railShadow;
	g.fillRect(px+4,py+railTop,3,railH);
	g.fillRect(px+13,py+railTop,3,railH);
	g.fillStyle=rail;
	g.fillRect(px+5,py+railTop,2,railH);
	g.fillRect(px+14,py+railTop,2,railH);
	g.fillStyle=railHi;
	g.fillRect(px+5,py+railTop+1,1,Math.max(1,railH-2));
	g.fillRect(px+14,py+railTop+1,1,Math.max(1,railH-2));
	if(!up || !down){
		g.fillStyle='rgba(74,40,18,0.62)';
		if(!up){ g.fillRect(px+4,py+1,3,1); g.fillRect(px+13,py+1,3,1); }
		if(!down){ g.fillRect(px+4,py+TILE-2,3,1); g.fillRect(px+13,py+TILE-2,3,1); }
	}
	for(let y=4;y<TILE-2;y+=5){
		g.fillStyle=rungDark;
		g.fillRect(px+5,py+y+1,11,2);
		g.fillStyle=rung;
		g.fillRect(px+5,py+y,11,2);
		g.fillStyle='rgba(255,221,143,0.36)';
		g.fillRect(px+6,py+y,8,1);
	}
	if(((h>>>6)&3)===0){
		g.fillStyle='rgba(255,231,160,0.45)';
		g.fillRect(px+6,py+3+((h>>>10)&8),2,1);
	}
	g.restore();
}
let infrastructureOverlayFrameCache=null;
function infrastructureOverlayCacheKey(sx,sy,viewX,viewY){
	return Math.floor(sx)+','+Math.floor(sy)+','+Math.ceil(viewX)+','+Math.ceil(viewY);
}
function collectInfrastructureOverlayCells(sx,sy,viewX,viewY){
	if(!WORLD || !WORLD.getInfrastructure) return;
	const x0=Math.floor(sx)-2, x1=Math.ceil(sx+viewX)+2;
	const y0=Math.max(worldMinY(),Math.floor(sy)-2), y1=Math.min(worldMaxY()-1,Math.ceil(sy+viewY)+2);
	const cells=[];
	for(let y=y0; y<=y1; y++){
		for(let x=x0; x<=x1; x++){
			const tiles=getRenderInfrastructureTiles(x,y);
			if(!tiles.length) continue;
			if(!worldFxVisible(x,y)) continue;
			cells.push({x,y,px:x*TILE,py:y*TILE,h:hash32(x,y),tiles});
		}
	}
	return cells;
}
function infrastructureOverlayCellsFor(sx,sy,viewX,viewY){
	const key=infrastructureOverlayCacheKey(sx,sy,viewX,viewY);
	if(infrastructureOverlayFrameCache && infrastructureOverlayFrameCache.key===key) return infrastructureOverlayFrameCache.cells;
	const cells=collectInfrastructureOverlayCells(sx,sy,viewX,viewY) || [];
	infrastructureOverlayFrameCache={key,cells};
	return cells;
}
function drawInfrastructureOverlays(sx,sy,viewX,viewY,opts){
	if(!WORLD || !WORLD.getInfrastructure) return;
	opts=opts||{};
	const only=opts.only||null;
	const exclude=opts.exclude||null;
	const cells=infrastructureOverlayCellsFor(sx,sy,viewX,viewY);
	for(const cell of cells){
		for(const t of cell.tiles){
			if(only && t!==only) continue;
			if(exclude && t===exclude) continue;
			if(t===T.WIRE) drawLooseWireOverlay(ctx,cell.px,cell.py,cell.h);
			else if(t===T.WATER_PIPE && PUMPS && PUMPS.drawPipeTile){
				const conn=PUMPS.pipeConnections ? PUMPS.pipeConnections(cell.x,cell.y,getFluidNetworkTile) : {left:true,right:true,up:false,down:false};
				PUMPS.drawPipeTile(ctx,TILE,cell.px,cell.py,conn,cell.h);
			}else if(t===T.LADDER){
				drawLadderOverlay(ctx,cell.px,cell.py,cell.h,ladderConnections(cell.x,cell.y,hasLadderAt));
			}else if(t===T.COPPER_WIRE && TELEPORTERS && TELEPORTERS.drawCableTile){
				const conn=TELEPORTERS.cableConnections ? TELEPORTERS.cableConnections(cell.x,cell.y,getElectricNetworkTile) : {left:true,right:true,up:false,down:false};
				TELEPORTERS.drawCableTile(ctx,TILE,cell.px,cell.py,conn,cell.h);
			}
		}
	}
}
const doorOpenAnim = new Map();
const trapdoorOpenAnim = new Map();
function actorOpensDoor(x,y,npcs){
	const cx=x+0.5, cy=y+0.5;
	if(player && Math.abs((player.x||0)-cx)<1.25 && Math.abs((player.y||0)-cy)<1.7) return true;
	for(const n of npcs){
		if(!n || typeof n.x!=='number' || typeof n.y!=='number') continue;
		if(Math.abs(n.x-cx)<1.25 && Math.abs(n.y-cy)<1.7) return true;
	}
	return false;
}
function heroDropThroughInput(){
	return !!(keys['s'] || keys['arrowdown'] || trapdoorDropBufferT>0);
}
function actorOpensTrapdoor(x,y,npcs){
	const cx=x+0.5;
	if(player && Math.abs((player.x||0)-cx)<1.15){
		const py=player.y || 0;
		if(heroDropThroughInput() && py>y-1.4 && py<y+0.95) return true;
		if((player.vy||0)<-0.05 && py>y+0.45 && py<y+2.1) return true;
	}
	for(const n of npcs){
		if(!n || typeof n.x!=='number' || typeof n.y!=='number') continue;
		if(Math.abs(n.x-cx)<1.15 && n.y>y+0.45 && n.y<y+2.1) return true;
	}
	return false;
}
function collectDoorwayCellsInRange(x0,x1,y0,y1,cells){
	for(let y=y0; y<=y1; y++){
		for(let x=x0; x<=x1; x++){
			const t=getTile(x,y);
			if(!isDoorTile(t) && !isTrapdoorTile(t)) continue;
			if(!worldFxVisible(x,y)) continue;
			cells.push({x,y,t,h:hash32(x,y)});
		}
	}
}
function visibleDoorwayCellsFor(sx,sy,viewX,viewY){
	const x0=Math.floor(sx)-2, x1=Math.ceil(sx+viewX)+2;
	const y0=Math.max(worldMinY(),Math.floor(sy)-2), y1=Math.min(worldMaxY()-1,Math.ceil(sy+viewY)+2);
	const cells=[];
	collectDoorwayCellsInRange(x0,x1,y0,y1,cells);
	return {cells,x0,x1,y0,y1};
}
function drawDoorOpenOverlays(sx,sy,viewX,viewY){
	const doorwayView=visibleDoorwayCellsFor(sx,sy,viewX,viewY);
	const {cells,x0,x1,y0,y1}=doorwayView;
	let npcs=[];
	try{ npcs=(NPCS && NPCS.summaries) ? NPCS.summaries() : []; }catch(e){ npcs=[]; }
	const frameMs=Number.isFinite(lastFrameMs) && lastFrameMs>0 ? lastFrameMs : 16;
	const k=Math.min(1,frameMs/85);
	for(const cell of cells){
		const {x,y,t,h}=cell;
		const key=x+','+y;
		if(isDoorTile(t)){
			const target=actorOpensDoor(x,y,npcs) ? 1 : 0;
			const prev=doorOpenAnim.get(key) || 0;
			const next=prev+(target-prev)*k;
			if(next<0.025 && target<=0){ doorOpenAnim.delete(key); continue; }
			doorOpenAnim.set(key,next);
			drawDoorTile(ctx,t,x*TILE,y*TILE,h,next);
		} else {
			const target=actorOpensTrapdoor(x,y,npcs) ? 1 : 0;
			const prev=trapdoorOpenAnim.get(key) || 0;
			const next=prev+(target-prev)*k;
			if(next<0.025 && target<=0){ trapdoorOpenAnim.delete(key); continue; }
			trapdoorOpenAnim.set(key,next);
			drawTrapdoorTile(ctx,t,x*TILE,y*TILE,h,next);
		}
	}
	if(doorOpenAnim.size>256){
		for(const key of doorOpenAnim.keys()){
			const comma=key.indexOf(',');
			const x=Number(key.slice(0,comma)), y=Number(key.slice(comma+1));
			if(x<x0-8 || x>x1+8 || y<y0-8 || y>y1+8) doorOpenAnim.delete(key);
			if(doorOpenAnim.size<=192) break;
		}
	}
	if(trapdoorOpenAnim.size>256){
		for(const key of trapdoorOpenAnim.keys()){
			const comma=key.indexOf(',');
			const x=Number(key.slice(0,comma)), y=Number(key.slice(comma+1));
			if(x<x0-8 || x>x1+8 || y<y0-8 || y>y1+8) trapdoorOpenAnim.delete(key);
			if(trapdoorOpenAnim.size<=192) break;
		}
	}
}
function beginPrecisionSafeWorldLayer(opts){
	if(!opts || !Number.isFinite(opts.camX) || !Number.isFinite(opts.camY) || !ctx.setTransform) return false;
	ctx.save();
	ctx.setTransform(DPR,0,0,DPR,0,0);
	if(opts.shake && (opts.shake.x || opts.shake.y)) ctx.translate(opts.shake.x,opts.shake.y);
	ctx.scale(zoom,zoom);
	ctx.imageSmoothingEnabled=false;
	return true;
}
function drawSeamSafeChunkCanvas(canvas, dx, dy, clipX0, clipY0, clipX1, clipY1){
	if(!canvas) return;
	const sw=canvas.width, sh=canvas.height;
	if(sw<=0 || sh<=0) return;
	// Blit only the sub-rect of this (1280x1400) section canvas that intersects the
	// view window (layer px): full-canvas draws made the compositor the top frame
	// cost — most of each tall section is offscreen and was rasterized away by clip.
	let sx0=0, sy0=0, sx1=sw, sy1=sh;
	if(Number.isFinite(clipX0) && Number.isFinite(clipY0) && Number.isFinite(clipX1) && Number.isFinite(clipY1)){
		sx0=Math.max(0, Math.floor(clipX0-dx)); sx1=Math.min(sw, Math.ceil(clipX1-dx));
		sy0=Math.max(0, Math.floor(clipY0-dy)); sy1=Math.min(sh, Math.ceil(clipY1-dy));
		if(sx0>=sx1 || sy0>=sy1) return;
	}
	ctx.drawImage(canvas,sx0,sy0,sx1-sx0,sy1-sy0,dx+sx0,dy+sy0,sx1-sx0,sy1-sy0);
	if(sw<=1) return; // degenerate canvas: main blit only, no seam strips
	const overlap=Math.max(1, Math.min(4, Math.ceil(1/Math.max(0.35, zoom))));
	// seam strips only where that canvas edge is actually inside the view window
	if(sx0===0) ctx.drawImage(canvas,0,sy0,1,sy1-sy0,dx-overlap,dy+sy0,overlap,sy1-sy0);
	if(sx1===sw) ctx.drawImage(canvas,sw-1,sy0,1,sy1-sy0,dx+sw,dy+sy0,overlap,sy1-sy0);
}
function drawWorldVisible(sx,sy,viewX,viewY,opts){ opts=opts||{}; const minChunk=Math.floor(sx/CHUNK_W)-1; const maxChunk=Math.floor((sx+viewX+2)/CHUNK_W)+1; const centerChunk=Math.floor((sx+viewX*0.5)/CHUNK_W); const minSection=Math.max(worldMinSection(),worldSectionY(Math.floor(sy)-2)); const maxSection=Math.min(worldMaxSection(),worldSectionY(Math.ceil(sy+viewY)+2)); const centerSection=worldSectionY(sy+viewY*0.5); // prepare caches
	const visibleChunkCount=(maxChunk-minChunk+1)*Math.max(1,maxSection-minSection+1);
	const visibleChunks=[], visibleChunkSeen=new Set();
	const fallingAuditChunks=[], fallingAuditChunkSeen=new Set();
	beginChunkCacheFrame();
	for(let cx=minChunk; cx<=maxChunk; cx++){
		for(let section=minSection; section<=maxSection; section++){
			drawChunkToCache(cx,section,centerChunk);
			if(!fallingAuditChunkSeen.has(cx)){ fallingAuditChunkSeen.add(cx); fallingAuditChunks.push(cx); }
			if(isBaseWorldSection(section) && !visibleChunkSeen.has(cx)){ visibleChunkSeen.add(cx); visibleChunks.push(cx); }
		}
	}
	if(FALLING && FALLING.auditChunks) FALLING.auditChunks(fallingAuditChunks);
	trimChunkCanvasCache(centerChunk, visibleChunkCount+6, centerSection);
	// Draw whole chunks that intersect view (avoids per-tile seams)
	const localLayer=beginPrecisionSafeWorldLayer(opts);
	const camDrawX=localLayer?opts.camX:0;
	const camDrawY=localLayer?opts.camY:0;
	const viewPX0 = sx*TILE, viewPX1=(sx+viewX+2)*TILE;
	// view window in layer px (camera-relative when localLayer), padded 3 tiles:
	// covers max meteor shake (amp 26 -> ~38 device px, > 2 tiles at min zoom 0.72)
	// plus rounding, while still clipping each tall section canvas to the band
	// actually on screen instead of submitting all ~1.8Mpx of it every frame
	const clipX0=((sx-3)-camDrawX)*TILE, clipX1=((sx+viewX+5)-camDrawX)*TILE;
	const clipY0=((sy-3)-camDrawY)*TILE, clipY1=((sy+viewY+5)-camDrawY)*TILE;
	for(let cx=minChunk; cx<=maxChunk; cx++){
		for(let section=minSection; section<=maxSection; section++){
			const entry=chunkCanvases.get(worldRenderSectionKey(cx,section)); if(!entry) continue; const chunkXpx = cx*CHUNK_W*TILE;
			const chunkRight = chunkXpx + CHUNK_W*TILE; if(chunkRight < viewPX0-CHUNK_W*TILE || chunkXpx > viewPX1+CHUNK_W*TILE) continue;
			const originY=worldSectionOriginY(section);
			drawSeamSafeChunkCanvas(entry.canvas, localLayer?(cx*CHUNK_W-camDrawX)*TILE:chunkXpx, localLayer?((originY-camDrawY)*TILE):(originY*TILE), clipX0, clipY0, clipX1, clipY1);
		}
	}
		// Chest aura second pass (not cached) for pulsing glow
		const nowA=performance.now();
		const y0=sy, y1=sy+viewY+2;
		for(let cx2=minChunk; cx2<=maxChunk; cx2++){
			for(let section=minSection; section<=maxSection; section++){
				const entry=chunkCanvases.get(worldRenderSectionKey(cx2,section));
				const chests=entry && Array.isArray(entry.chests) ? entry.chests : [];
				for(const ch of chests){
					const wx=ch.x, y=ch.y, t=ch.t;
					if(y<y0 || y>=y1) continue;
					if(!chestDebug && !worldFxVisible(wx,y)) continue;
					const pulse=Math.sin(nowA*0.004 + wx*0.7 + y*0.3)*0.5+0.5;
					const rad=TILE*0.6 + pulse*TILE*0.25;
					const cxp=(localLayer?(wx-camDrawX):wx)*TILE+TILE/2;
					const cyp=(localLayer?(y-camDrawY):y)*TILE+TILE/2;
					const g=ctx.createRadialGradient(cxp,cyp,rad*0.2,cxp,cyp,rad);
					const col = t===T.CHEST_EPIC? 'rgba(224,179,65,' : (t===T.CHEST_RARE? 'rgba(167,76,201,' : 'rgba(176,127,44,');
					g.addColorStop(0,col+(0.45+0.35*pulse)+(chestDebug?0.15:0)+')');
					g.addColorStop(1,col+'0)');
					ctx.fillStyle=g;
					ctx.beginPath();
					ctx.arc(cxp,cyp,rad*(chestDebug?1.15:1),0,Math.PI*2);
					ctx.fill();
					if(chestDebug){ ctx.strokeStyle='#fff'; ctx.lineWidth=1; ctx.strokeRect((localLayer?(wx-camDrawX):wx)*TILE+1,(localLayer?(y-camDrawY):y)*TILE+1,TILE-2,TILE-2); }
				}
			}
		}
		if(chestDebug){ const pcx=Math.floor(player.x/CHUNK_W); const cnt=countChestsAround(pcx,4); ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(sx*TILE+6, sy*TILE+6, 140,24); ctx.fillStyle='#fff'; ctx.font='14px system-ui'; ctx.fillText('Skrzynie ±4: '+cnt, sx*TILE+12, sy*TILE+24); }
	if(localLayer) ctx.restore();
	if(VISUAL.animations && GRASS && GRASS.drawOverlays){ GRASS.drawOverlays(ctx,'back', sx,sy,viewX,viewY,TILE,worldMaxY(),getTile,T,zoom,grassDensityScalar,grassHeightScalar,worldFxVisible,worldMinY()); }
}

// Cave darkness: BFS light field from sky/torches/lava/fire, blitted as one
// smoothed overlay. Drawn before the ghost preview + fog so mining/placement
// indicators stay readable and undiscovered black still wins on top.
function currentDaylight(){
	try{
		const ti=(BACKGROUND && BACKGROUND.timeInfo) ? BACKGROUND.timeInfo() : null;
		if(ti){
			const tDay=Math.max(0,Math.min(1,ti.tDay));
			// day: solar arc; night: faint moonlight arc so surface never goes void-black
			return ti.isDay ? Math.max(0,Math.sin(tDay*Math.PI)) : 0.10*Math.sin(tDay*Math.PI);
		}
	}catch(e){}
	return 1;
}
function drawLightingOverlay(sx,sy,viewX,viewY,opts){
	if(!(LIGHTING && LIGHTING.draw)) return;
	const localLayer=beginPrecisionSafeWorldLayer(opts);
	LIGHTING.draw(ctx, TILE, sx, sy, viewX, viewY, {
		originX: localLayer ? opts.camX : 0,
		originY: localLayer ? opts.camY : 0,
		getTile,
		surfaceHeight: (WORLDGEN && WORLDGEN.surfaceHeight) ? WORLDGEN.surfaceHeight : null,
		daylight: currentDaylight(),
		hero: player,
		burningAt: (FIRE && FIRE.isBurning) ? FIRE.isBurning : null
	});
	if(localLayer) ctx.restore();
}
function drawFogOverlay(sx,sy,viewX,viewY,opts){
	if(FOG && FOG.applyOverlay){
		const localLayer=beginPrecisionSafeWorldLayer(opts);
		FOG.applyOverlay(ctx, sx, sy, viewX, viewY, TILE, getTile, T, {
			showMemory: visionRemembersMap(),
			originX: localLayer ? opts.camX : 0,
			originY: localLayer ? opts.camY : 0
		});
		if(localLayer) ctx.restore();
	}
}

function fogRevealAll(){ return !!(FOG && FOG.getRevealAll && FOG.getRevealAll()); }
function fogHasVisible(x,y){
	if(!FOG || fogRevealAll()) return true;
	const fn=FOG.hasVisible || FOG._hasVisible;
	return typeof fn==='function' ? !!fn(x,y) : true;
}
function fogHasSeen(x,y){
	if(!FOG || fogRevealAll()) return true;
	const fn=FOG.hasSeen || FOG._hasSeen;
	return typeof fn==='function' ? !!fn(x,y) : true;
}
function worldFxCurrentlyVisible(x,y){ return fogHasVisible(x,y); }
function worldTileDiscovered(x,y){ return fogHasSeen(x,y); }
// Rendering uses discovery, not only current line-of-sight: once a tile has been
// seen, water, creatures, objects, particles, and other world FX can draw there.
// The final fog overlay still blackens truly undiscovered areas and dims memory.
function worldFxVisible(x,y){ return worldTileDiscovered(x,y); }
function worldFxVisibility(){ return {visible:worldFxVisible, seen:worldTileDiscovered, current:worldFxCurrentlyVisible, revealAll:fogRevealAll()}; }
function fallbackLineOfSight(x0,y0,x1,y1){
	if(x0===x1 && y0===y1) return true;
	const dx=Math.abs(x1-x0), dy=Math.abs(y1-y0);
	const sx=x0<x1?1:-1, sy=y0<y1?1:-1;
	let err=dx-dy, x=x0, y=y0;
	for(let guard=0; guard<512; guard++){
		const e2=err*2;
		const px=x, py=y;
		let stepX=0, stepY=0;
		if(e2>-dy){ err-=dy; x+=sx; stepX=sx; }
		if(e2< dx){ err+=dx; y+=sy; stepY=sy; }
		if(stepX && stepY && isSolid(getTile(px+stepX,py)) && isSolid(getTile(px,py+stepY))) return false;
		if(x===x1 && y===y1) return true;
		if(isSolid(getTile(x,y))) return false;
	}
	return false;
}
function targetFaceExposedToPlayer(tx,ty){
	const px=Math.floor(player.x), py=Math.floor(player.y);
	const dx=Math.sign(tx-px), dy=Math.sign(ty-py);
	if(dx===0 && dy===0) return true;
	if(dx!==0 && dy!==0){
		return !isSolid(getTile(tx-dx,ty)) || !isSolid(getTile(tx,ty-dy));
	}
	if(dx!==0) return !isSolid(getTile(tx-dx,ty));
	return !isSolid(getTile(tx,ty-dy));
}
function canPhysicallyTargetTile(tx,ty){
	if(!Number.isFinite(tx) || !Number.isFinite(ty)) return false;
	if(!worldYInBounds(ty)) return false;
	const px=Math.floor(player.x), py=Math.floor(player.y);
	const los=(FOG && (FOG.hasLineOfSight || FOG._hasLineOfSight)) || null;
	const rayClear = typeof los==='function' ? los(px,py,tx,ty,getTile,(t)=>isSolid(t)) : fallbackLineOfSight(px,py,tx,ty);
	return rayClear && targetFaceExposedToPlayer(tx,ty);
}
function blockedTargetReason(tx,ty){
	return canPhysicallyTargetTile(tx,ty) ? null : 'Zasłonięte';
}

// Input + tryby specjalne
const keys={}; let godMode=false, immunityMode=false; const keysOnce=new Set();
let backgroundBuildMode=false;
let fireBtnHeld=false; // declared with the other input state — the blur handler below references it
let paused=false;      // B toggles; the loop keeps drawing but freezes the simulation
let showMinimap=true;  // N toggles the cross-section minimap
// Player-facing settings persistence (the pause panel writes these; boot restores)
const LIGHTING_OFF_KEY='mm_lighting_off_v1';
const MINIMAP_OFF_KEY='mm_minimap_off_v1';
try{ if(LIGHTING && localStorage.getItem(LIGHTING_OFF_KEY)==='1') LIGHTING.config.enabled=false; }catch(e){}
try{ if(localStorage.getItem(MINIMAP_OFF_KEY)==='1') showMinimap=false; }catch(e){}
// Pause panel: B freezes the simulation and raises a settings card — resume,
// volume, minimap, cave lighting, help. DOM is built lazily on first pause.
let pausePanel=null;
function pausePanelVisible(){ return !!(pausePanel && !pausePanel.hidden); }
function buildPauseRow(labelText){
	const row=document.createElement('div'); row.className='pauseRow';
	const label=document.createElement('span'); label.textContent=labelText; row.appendChild(label);
	return row;
}
function ensurePausePanel(){
	if(pausePanel) return pausePanel;
	pausePanel=document.createElement('div'); pausePanel.id='pausePanel'; pausePanel.hidden=true;
	const head=document.createElement('div'); head.className='pauseHead';
	const title=document.createElement('strong'); title.textContent='⏸ Pauza';
	const resume=document.createElement('button'); resume.type='button'; resume.className='pauseResume'; resume.textContent='▶ Wznów (B)';
	resume.addEventListener('click',()=>setPaused(false));
	head.appendChild(title); head.appendChild(resume); pausePanel.appendChild(head);
	// volume slider rides the persisted WebAudio master gain
	const volRow=buildPauseRow('🔊 Głośność');
	const vol=document.createElement('input'); vol.type='range'; vol.min='0'; vol.max='100'; vol.step='5';
	vol.value=String(Math.round(((MM.audio && MM.audio.getVolume)?MM.audio.getVolume():0.8)*100));
	vol.addEventListener('input',()=>{ if(MM.audio && MM.audio.setVolume) MM.audio.setVolume((+vol.value)/100); });
	volRow.appendChild(vol); pausePanel.appendChild(volRow);
	const muteRow=buildPauseRow('🔇 Wycisz dźwięk');
	const mute=document.createElement('input'); mute.type='checkbox';
	mute.checked=!!(MM.audio && MM.audio.isMuted && MM.audio.isMuted());
	mute.addEventListener('change',()=>{ if(MM.audio && MM.audio.setMute) MM.audio.setMute(mute.checked); });
	muteRow.appendChild(mute); pausePanel.appendChild(muteRow);
	const mapRow=buildPauseRow('🗺️ Minimapa (N)');
	const map=document.createElement('input'); map.type='checkbox'; map.checked=showMinimap;
	map.addEventListener('change',()=>{ showMinimap=map.checked; try{ localStorage.setItem(MINIMAP_OFF_KEY, showMinimap?'0':'1'); }catch(e){} });
	mapRow.appendChild(map); pausePanel.appendChild(mapRow);
	const lightRow=buildPauseRow('💡 Oświetlenie jaskiń');
	const light=document.createElement('input'); light.type='checkbox'; light.checked=!!(LIGHTING && LIGHTING.config && LIGHTING.config.enabled);
	light.addEventListener('change',()=>{ if(LIGHTING && LIGHTING.config) LIGHTING.config.enabled=light.checked; try{ localStorage.setItem(LIGHTING_OFF_KEY, light.checked?'0':'1'); }catch(e){} });
	lightRow.appendChild(light); pausePanel.appendChild(lightRow);
	const helpRow=buildPauseRow('❔ Sterowanie i porady');
	const help=document.createElement('button'); help.type='button'; help.textContent='Pomoc (H)';
	help.addEventListener('click',()=>{ setPaused(false); try{ toggleHelp(); }catch(e){} });
	helpRow.appendChild(help); pausePanel.appendChild(helpRow);
	const foot=document.createElement('div'); foot.className='pauseFoot';
	foot.textContent='Świat stoi w miejscu, dopóki panel jest otwarty.';
	pausePanel.appendChild(foot);
	(document.getElementById('ui')||document.body).appendChild(pausePanel);
	return pausePanel;
}
function pauseTrapKeydown(e){
	if(!pausePanelVisible()) return;
	if(e.key==='Escape'){ e.preventDefault(); e.stopImmediatePropagation(); setPaused(false); }
}
function setPaused(v){
	paused=!!v;
	const panel=ensurePausePanel();
	if(paused){
		// refresh live values each open (N/H/menu may have changed them meanwhile)
		panel.querySelectorAll('.pauseRow input[type=checkbox]').forEach(chk=>{
			const label=chk.parentElement && chk.parentElement.firstChild ? chk.parentElement.firstChild.textContent : '';
			if(label.includes('Minimapa')) chk.checked=showMinimap;
			else if(label.includes('Oświetlenie')) chk.checked=!!(LIGHTING && LIGHTING.config && LIGHTING.config.enabled);
			else if(label.includes('Wycisz')) chk.checked=!!(MM.audio && MM.audio.isMuted && MM.audio.isMuted());
		});
		panel.hidden=false;
		window.addEventListener('keydown',pauseTrapKeydown,true);
	}else{
		panel.hidden=true;
		window.removeEventListener('keydown',pauseTrapKeydown,true);
	}
}
const activePointers=new Map(); let pinch=null;
let minePointerId=null;   // pointer that initiated cursor mining (left button / touch on canvas)
let weaponPointerId=null; // pointer that is holding normal weapon fire on the canvas
let mineBtnHeld=false;    // dedicated pickaxe button held -> keep mining in selected direction
function modalInputOpen(){ return !!(MM.modalInput && MM.modalInput.isOpen && MM.modalInput.isOpen()); }
function releaseGameplayInput(){
	for(const k in keys) keys[k]=false;
	keysOnce.clear();
	jumpBufferT=0;
	jumpPrev=false;
	trapdoorDropBufferT=0;
	try{ stopMining(); }catch(e){}
	try{ if(WEAPONS && WEAPONS.cancelHeld) WEAPONS.cancelHeld(); }catch(e){}
	try{ endHeroDefense(null,{cancel:true}); }catch(e){}
	minePointerId=null; weaponPointerId=null; mineBtnHeld=false; fireBtnHeld=false;
	activePointers.clear();
	pinch=null;
}
function queueJumpInput(k){
	if(k===' ' || ((k==='w' || k==='arrowup') && !heroTouchesLadder())) jumpBufferT=JUMP_BUFFER;
}
window.addEventListener('mm-modal-input',e=>{ if(e.detail && e.detail.open) releaseGameplayInput(); });
// Debug overlay toggle (F3)
let showPerfHud = false;
// Chest debug helpers
let chestDebug=false; // toggled to highlight chests strongly
function countChestsInChunk(cx){
	const k='c'+cx;
	const arr=WORLD._world.get(k);
	if(!arr || typeof arr.length!=='number') return 0;
	let c=0;
	for(let i=0; i<arr.length; i++){
		const t=arr[i];
		if(t===T.CHEST_COMMON||t===T.CHEST_RARE||t===T.CHEST_EPIC) c++;
	}
	return c; 
}
function countChestsAround(centerCx,r){ let total=0; for(let d=-r; d<=r; d++){ total+=countChestsInChunk(centerCx+d); } return total; }
let _preGodInventory=null; // store inventory snapshot before granting resources
function updateGodBtn(){ if(MM.ui && MM.ui.updateGodButton) MM.ui.updateGodButton(godMode); }
function updateImmunityBtn(){ if(MM.ui && MM.ui.updateImmunityButton) MM.ui.updateImmunityButton(immunityMode); }
function toggleGod(){
	godMode=!godMode;
	if(godMode){
		// snapshot current counts if not already taken
		if(!_preGodInventory){ _preGodInventory={}; RESOURCE_KEYS.forEach(k=>{ _preGodInventory[k]=inv[k]; }); }
		RESOURCE_KEYS.forEach(k=>{ inv[k]=100; });
	} else {
		// restore previous counts if snapshot exists
		if(_preGodInventory){ Object.assign(inv,_preGodInventory); _preGodInventory=null; }
	}
	updateInventory(); updateGodBtn(); saveState();
	msg('Tryb boga '+(godMode?'ON – 100 materiałów':'OFF – przywrócono zapasy'));
}
function toggleImmunity(){
	immunityMode=!immunityMode;
	if(immunityMode){ player.hp=player.maxHp; player.hpInvul=0; }
	updateImmunityBtn(); saveState();
	msg('Immunity '+(immunityMode?'ON - health locked':'OFF'));
}
function toggleMap(){ const on = (FOG && FOG.toggleRevealAll)? FOG.toggleRevealAll(): false; if(MM.ui && MM.ui.updateMapButton) MM.ui.updateMapButton(on); msg('Mapa '+(on?'ON':'OFF')); }
function centerCam(){ snapCameraToPlayer(); msg('Wyśrodkowano'); }
function toggleHelp(){ const h=document.getElementById('help'); const show=h.style.display!=='block'; h.style.display=show?'block':'none'; document.getElementById('helpBtn').setAttribute('aria-expanded', String(show)); }
// Keyboard events targeting editable controls (seed input, sliders, selects) must not drive the game
function isEditableTarget(t){ if(!t || !t.tagName) return false; const tag=t.tagName; return tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||t.isContentEditable; }
function activeWeaponItem(){ const INV=MM.inventory; return (INV && INV.equippedItem)? INV.equippedItem('weapon'):null; }
function isToolMode(){ return !activeWeaponItem(); }
// --- Weapon shortcuts (keys 1..4) ---
// 1: build/destroy mode — holsters the weapon; pressed again it cycles owned pickaxes.
// 2/3/4: cycle the weapons of the matching MM.inventory.WEAPON_CATEGORIES entry
// (which weapons take part is chosen per item in the inventory panel).
const PICK_ORDER=['basic','stone','meteor','diamond','bedrock'];
const PICK_LABELS={basic:'podstawowy', stone:'kamienny', meteor:'meteorytowy', diamond:'diamentowy', bedrock:'macierzysty'};
function bedrockPickDurability(){ return Math.max(0, Math.min(BEDROCK_PICK_MAX_DURABILITY, inv.bedrockPickDurability|0)); }
function hasBedrockPick(){ return !!(inv.tools && inv.tools.bedrock && bedrockPickDurability()>0); }
function pickLabel(id){
	if(id==='bedrock') return 'macierzysty '+bedrockPickDurability()+'/'+BEDROCK_PICK_MAX_DURABILITY;
	return PICK_LABELS[id]||id;
}
function ownedPicks(){ return PICK_ORDER.filter(t=>t==='basic'||(t==='bedrock'?hasBedrockPick():inv.tools[t])); }
function selectToolMode(opts){
	opts=opts||{};
	if(WEAPONS && WEAPONS.cancelHeld) WEAPONS.cancelHeld();
	endHeroDefense(null,{cancel:true});
	weaponPointerId=null;
	const INV=MM.inventory;
	const hadWeapon=!!(INV && INV.equippedId && INV.equippedId('weapon'));
	if(hadWeapon && INV.unequip) INV.unequip('weapon');
	if(hadWeapon || opts.refresh){
		updateInventory();
		updateWeaponBar();
	}else if(!opts.quiet){
		updateWeaponBar();
	}
	return hadWeapon;
}
function selectWeaponKey(key){
	if(NPCS && NPCS.handleKey && NPCS.handleKey(key,player,tutorialNpcCtx)) return;
	const INV=MM.inventory;
	if(key==='1'){
		const hadWeapon=selectToolMode({quiet:true});
		if(!hadWeapon){ const owned=ownedPicks(); const i=owned.indexOf(player.tool); player.tool=owned[(i+1)%owned.length]; }
		msg('⛏ Kilof '+pickLabel(player.tool)+(hadWeapon?' — broń schowana':''));
		updateInventory(); updateWeaponBar();
		return;
	}
	if(WEAPONS && WEAPONS.cancelHeld) WEAPONS.cancelHeld();
	endHeroDefense(null,{cancel:true});
	if(!INV || !INV.cycleWeaponCategory) return;
	const cat=(INV.WEAPON_CATEGORIES||[]).find(c=>c.key===key); if(!cat) return;
	const it=INV.cycleWeaponCategory(cat.id);
	minePointerId=null; stopMining();
	if(it) msg(cat.icon+' '+(it.name||it.id));
	else msg(cat.label+': brak broni w skrócie — zaznacz „Skrót" w Ekwipunku');
	updateWeaponBar();
}
// Weapon shortcut bar (above the block hotbar): highlights the active mode and
// previews what each key holds — the held item on the active slot, the weapon
// the key WOULD select on the others (categories cycle strongest-first), dimmed
// when the category has nothing enabled. Clicking a slot = pressing its key.
// Every slot also carries a live status line so ammo problems are visible before
// a trigger click fails: pickaxe durability/mining speed, melee damage, the arrow
// tier the bow will actually fire (with per-tier pips — click a pip to pin that
// tier), thrower fuel and electric energy. A thin gauge on the bottom edge shows
// ult charge on the active weapon (bow-draw progress while drawing, bedrock pick
// durability on slot 1).
const AMMO_LOW=15;
const wepBarSlotCache={};
document.querySelectorAll('#weaponBar .wepSlot').forEach(el=>{
	wepBarSlotCache[el.getAttribute('data-wkey')]={
		el,
		name:el.querySelector('.wname'),
		sub:el.querySelector('.wsub'),
		pips:el.querySelector('.wpips'),
		cyc:el.querySelector('.wcyc'),
		gauge:el.querySelector('.wgauge'),
		fill:el.querySelector('.wgauge i')
	};
});
// Status line = optional color swatch + short text (rebuilt per update; ~2 nodes)
function setWepSub(slot,parts){
	if(!slot.sub) return;
	slot.sub.textContent='';
	(parts||[]).forEach(p=>{
		if(p && p.dot){
			const d=document.createElement('span'); d.className='ammoDot'; d.style.background=p.dot;
			slot.sub.appendChild(d);
		}else if(p!=null && p!==''){
			slot.sub.appendChild(document.createTextNode(String(p)));
		}
	});
}
function toggleArrowPin(id){
	if(!WEAPONS || !WEAPONS.setArrowPref || !WEAPONS.arrowInfo) return;
	const cur=WEAPONS.arrowInfo();
	const next=(cur.pref===id)?'auto':id;
	WEAPONS.setArrowPref(next);
	const tier=cur.tiers.find(t=>t.id===id);
	msg(next==='auto' ? '🏹 Strzały: auto (najmocniejsze dostępne)' : '🏹 Przypięte strzały: '+(tier?tier.label:id));
	updateWeaponBar(); // also refreshes an open tooltip
}
function ensureArrowPips(){
	const slot=wepBarSlotCache['3'];
	if(!slot || !slot.pips || slot.pips.childElementCount || !WEAPONS || !WEAPONS.arrowInfo) return;
	WEAPONS.arrowInfo().tiers.forEach(t=>{
		const b=document.createElement('button');
		b.type='button'; b.className='pip'; b.setAttribute('data-tier',t.id);
		b.addEventListener('click',ev=>{ ev.stopPropagation(); toggleArrowPin(t.id); });
		slot.pips.appendChild(b);
	});
}
function updateArrowPips(slot,info){
	if(!slot.pips) return;
	for(const p of slot.pips.children){
		const t=info? info.tiers.find(x=>x.id===p.getAttribute('data-tier')):null;
		if(!t){ p.classList.remove('on','act','pin'); p.style.background=''; p.title=''; continue; }
		p.classList.toggle('on', t.count>0);
		p.classList.toggle('act', !!t.active);
		p.classList.toggle('pin', !!t.pinned);
		p.style.background= t.count>0 ? t.color : '';
		p.title='Strzały '+t.label+': '+t.count+(t.pinned?' — przypięte':'')+(t.active?' — te lecą teraz':'');
	}
}
function updateWeaponBar(){
	const INV=MM.inventory; if(!INV) return;
	const it=activeWeaponItem();
	const cat=(it && INV.weaponCategory)? INV.weaponCategory(it):null;
	const activeKey= cat? cat.key : (it? null : '1'); // uncategorised weapon → nothing lit
	ensureArrowPips();
	Object.keys(wepBarSlotCache).forEach(k=>{
		const slot=wepBarSlotCache[k];
		if(!slot.name) return;
		slot.el.classList.toggle('sel', k===activeKey);
		let low=false, out=false, cycText='';
		if(k==='1'){
			slot.name.textContent=PICK_LABELS[player.tool]||player.tool;
			slot.el.classList.remove('empty');
			const owned=ownedPicks();
			cycText= owned.length>1 ? (owned.indexOf(player.tool)+1)+'/'+owned.length : '';
			if(player.tool==='bedrock'){
				const dur=bedrockPickDurability();
				setWepSub(slot,[dur+'/'+BEDROCK_PICK_MAX_DURABILITY]);
				low= dur<=3;
				slot.gauge.classList.add('show','dura');
				slot.gauge.classList.remove('ready','draw');
				slot.fill.style.width=Math.round(dur*100/BEDROCK_PICK_MAX_DURABILITY)+'%';
			}else{
				setWepSub(slot,['×'+(tools[player.tool]||1)]);
				slot.gauge.classList.remove('show','dura','ready','draw');
			}
		}else{
			const c=(INV.WEAPON_CATEGORIES||[]).find(x=>x.key===k);
			const list=(c && INV.categoryWeapons)? INV.categoryWeapons(c.id):[];
			const preview=(cat && c && cat.key===k)? it : list[0];
			slot.name.textContent= preview? (preview.name||preview.id) : '—';
			slot.el.classList.toggle('empty', !list.length);
			const idx=preview? list.indexOf(preview) : -1;
			cycText= (list.length>1 && idx>=0) ? (idx+1)+'/'+list.length : '';
			slot.el.dataset.streamKind='';
			if(!preview){
				setWepSub(slot,[]);
				if(slot.pips) updateArrowPips(slot,null);
			}else if(c.id==='melee'){
				setWepSub(slot, typeof preview.attackDamage==='number' ? ['+'+preview.attackDamage+' obr.'] : []);
			}else if(c.id==='bow'){
				const info=(WEAPONS && WEAPONS.arrowInfo)? WEAPONS.arrowInfo():null;
				if(info){
					const act=info.tiers.find(t=>t.active);
					if(act){ setWepSub(slot,[{dot:act.color},String(act.count)]); low=act.count<AMMO_LOW; }
					else { setWepSub(slot,['Brak strzał']); out=true; }
					updateArrowPips(slot,info);
				}
			}else{ // throwers: fuel resource, or hero energy for the electric beam
				const kind=preview.weaponType;
				slot.el.dataset.streamKind=kind||'';
				if(kind==='electric'){
					const en=(MM.heroEnergy && MM.heroEnergy.info)? MM.heroEnergy.info():null;
					const cost=Math.max(1,Number(preview.energyCost)||10);
					if(en){
						setWepSub(slot,[{dot:'#ffd24a'},Math.floor(Math.max(0,en.energy||0))+'/'+Math.round(en.max)]);
						out= en.energy<cost*0.2; low= !out && en.energy<cost*1.5;
					}
				}else{
					const fuel=(WEAPONS && WEAPONS.fuelInfo)? WEAPONS.fuelInfo(kind):null;
					if(fuel){
						setWepSub(slot,[{dot:RES_COLOR[fuel.key]||'#9ca3af'},String(fuel.count)]);
						out= fuel.count<=0; low= !out && fuel.count<AMMO_LOW;
					}else setWepSub(slot,[]);
				}
			}
		}
		if(slot.cyc) slot.cyc.textContent=cycText;
		slot.el.classList.toggle('low', low && !out);
		slot.el.classList.toggle('out', out);
	});
	refreshHudTip();
}
// Per-frame gauge pass (called from the game loop): ult charge on the active
// weapon slot, bow-draw progress while drawing, live energy readout for the
// electric beam. Change-detected so idle frames cost zero DOM writes.
function updateWeaponGauges(){
	if(!WEAPONS || !WEAPONS.hudStatus) return;
	const st=WEAPONS.hudStatus();
	const INV=MM.inventory;
	const it=activeWeaponItem();
	const cat=(it && INV && INV.weaponCategory)? INV.weaponCategory(it):null;
	const activeKey=cat? cat.key:null;
	const s4=wepBarSlotCache['4'];
	if(s4 && s4.el && s4.el.dataset.streamKind==='electric' && MM.heroEnergy && MM.heroEnergy.info){
		const rounded=Math.floor(Math.max(0,MM.heroEnergy.info().energy||0));
		if(s4.lastEnergy!==rounded){ s4.lastEnergy=rounded; updateWeaponBar(); }
	}
	['2','3','4'].forEach(k=>{
		const slot=wepBarSlotCache[k]; if(!slot || !slot.gauge) return;
		let mode='', frac=0, ready=false;
		if(k==='3' && st.bowActive){ mode='draw'; frac=st.bowRatio; ready=st.bowFull; }
		else if(k===activeKey){ mode='ult'; frac=st.ult; ready=st.ult>=1; }
		const sig=mode+((frac*50)|0)+(ready?'R':'');
		if(slot.gaugeSig===sig) return;
		slot.gaugeSig=sig;
		if(!mode){ slot.gauge.classList.remove('show','draw','ready','dura'); slot.fill.style.width='0%'; return; }
		slot.gauge.classList.add('show');
		slot.gauge.classList.toggle('draw', mode==='draw');
		slot.gauge.classList.toggle('ready', ready);
		slot.gauge.classList.remove('dura');
		slot.fill.style.width=Math.round(Math.max(0,Math.min(1,frac))*100)+'%';
	});
	// Touch ult trigger mirrors the active weapon's charge (fills bottom-up, pulses at 100%)
	if(ultBtn){
		const usable=!!activeKey;
		const charge=usable? Math.max(0,Math.min(1,st.ult)) : 0;
		const sig=(usable?'u':'-')+((charge*50)|0);
		if(ultBtn.ultSig!==sig){
			ultBtn.ultSig=sig;
			ultBtn.style.setProperty('--ult', charge.toFixed(2));
			ultBtn.classList.toggle('ready', usable && charge>=1);
			ultBtn.style.opacity=usable? '' : '.4';
		}
	}
}
document.querySelectorAll('#weaponBar .wepSlot').forEach(el=>{
	el.addEventListener('click',()=>selectWeaponKey(el.getAttribute('data-wkey')));
});
window.addEventListener('mm-customization-change',updateWeaponBar);
// --- Rich HUD tooltip (weapon bar + hotbar) ---------------------------------
// One shared #hudTip popover: weapon stats via MM.inventory.statChips, the full
// arrow-tier breakdown, fuel/energy readouts and control hints. Mouse-only —
// touch keeps the plain tap behaviour.
const hudTipEl=document.getElementById('hudTip');
var hudTipAnchor=null;
function hudTipNode(cls,text){ const n=document.createElement('div'); n.className=cls; if(text!=null) n.textContent=text; return n; }
function hudTipTitle(text,color){
	const t=hudTipNode('tipTitle');
	if(color){ const d=document.createElement('span'); d.className='tdot'; d.style.background=color; t.appendChild(d); }
	t.appendChild(document.createTextNode(text));
	return t;
}
function hudTipRow(color,label,value,opts){
	const r=hudTipNode('tipRow');
	if(opts && opts.dim) r.classList.add('dim');
	if(opts && opts.mark){ const m=document.createElement('span'); m.className='tmark'; m.textContent=opts.mark; r.appendChild(m); }
	if(color){ const d=document.createElement('span'); d.className='tdot'; d.style.background=color; r.appendChild(d); }
	r.appendChild(document.createTextNode(label));
	if(value!=null){ const v=document.createElement('span'); v.className='tval'; v.textContent=value; r.appendChild(v); }
	return r;
}
const TIP_MARK_NONE=' '; // figure space keeps the ➤ column aligned
function buildWeaponTip(k){
	const INV=MM.inventory;
	const frag=document.createDocumentFragment();
	if(!INV) return frag;
	if(k==='1'){
		frag.appendChild(hudTipTitle('⛏️ Kilof '+(PICK_LABELS[player.tool]||player.tool)));
		const owned=ownedPicks();
		if(owned.length>1){
			frag.appendChild(hudTipNode('tipSection','Posiadane kilofy — 1 przełącza'));
			owned.forEach(id=>{
				frag.appendChild(hudTipRow(null,(PICK_LABELS[id]||id),'×'+(tools[id]||1),{mark:id===player.tool?'➤':TIP_MARK_NONE, dim:id!==player.tool}));
			});
		}else{
			frag.appendChild(hudTipNode('tipHint','Szybkość kopania ×'+(tools[player.tool]||1)));
		}
		if(player.tool==='bedrock') frag.appendChild(hudTipNode('tipHint','Wytrzymałość: '+bedrockPickDurability()+'/'+BEDROCK_PICK_MAX_DURABILITY+' uderzeń w skałę macierzystą'));
		frag.appendChild(hudTipNode('tipHint','LPM kopie · PPM stawia blok'));
		return frag;
	}
	const c=(INV.WEAPON_CATEGORIES||[]).find(x=>x.key===k);
	if(!c) return frag;
	const list=(c && INV.categoryWeapons)? INV.categoryWeapons(c.id):[];
	const it=activeWeaponItem();
	const cat=(it && INV.weaponCategory)? INV.weaponCategory(it):null;
	const preview=(cat && cat.key===k)? it : list[0];
	const tierColors=INV.TIER_COLORS||{};
	if(!preview){
		frag.appendChild(hudTipTitle(c.icon+' '+c.label));
		frag.appendChild(hudTipNode('tipWarn','Brak broni w skrócie'));
		frag.appendChild(hudTipNode('tipHint','Zaznacz „Skrót" przy broni w Ekwipunku (E)'));
		return frag;
	}
	frag.appendChild(hudTipTitle(c.icon+' '+(preview.name||preview.id), tierColors[preview.tier]||null));
	const chips=INV.statChips? INV.statChips(preview):[];
	if(chips.length){
		const wrap=hudTipNode('tipChips');
		chips.forEach(ch=>{ const s=document.createElement('span'); s.className='tipChip'; s.textContent=ch.icon+' '+ch.label+' '+ch.text; wrap.appendChild(s); });
		frag.appendChild(wrap);
	}
	if(c.id==='bow' && WEAPONS && WEAPONS.arrowInfo){
		const info=WEAPONS.arrowInfo();
		frag.appendChild(hudTipNode('tipSection','Strzały — ➤ leci jako następna'));
		info.tiers.forEach(t=>{
			frag.appendChild(hudTipRow(t.color,t.label+(t.pinned?' 📌':''),'×'+t.count,{mark:t.active?'➤':TIP_MARK_NONE, dim:t.count<=0}));
		});
		if(!info.total) frag.appendChild(hudTipNode('tipWarn','Brak strzał — wytwórz je w Wytwarzaniu (T)'));
		frag.appendChild(hudTipNode('tipHint', info.pref==='auto'
			? 'Auto: najmocniejsze dostępne · klik w kwadracik na slocie przypina typ'
			: 'Typ przypięty — po wyczerpaniu wraca do auto · ponowny klik = auto'));
	}
	if(c.id==='stream'){
		const kind=preview.weaponType;
		if(kind==='electric'){
			const en=(MM.heroEnergy && MM.heroEnergy.info)? MM.heroEnergy.info():null;
			if(en) frag.appendChild(hudTipRow('#ffd24a','Energia bohatera',Math.floor(Math.max(0,en.energy||0))+'/'+Math.round(en.max)));
		}else if(WEAPONS && WEAPONS.fuelInfo){
			const fuel=WEAPONS.fuelInfo(kind);
			if(fuel){
				frag.appendChild(hudTipRow(RES_COLOR[fuel.key]||'#9ca3af','Paliwo: '+(RES_LABEL[fuel.key]||fuel.key),'×'+fuel.count));
				if(fuel.count<=0) frag.appendChild(hudTipNode('tipWarn','Brak paliwa — broń nie wystrzeli'));
			}
		}
	}
	if(list.length>1){
		frag.appendChild(hudTipNode('tipSection','W skrócie — '+k+' przełącza'));
		list.forEach(w=>{
			frag.appendChild(hudTipRow(tierColors[w.tier]||null, w.name||w.id, null, {mark:(it && it.id===w.id)?'➤':TIP_MARK_NONE, dim:!(it && it.id===w.id)}));
		});
	}
	frag.appendChild(hudTipNode('tipHint','LPM atak · PPM ult, a gdy niedostepny: obrona -25%'));
	return frag;
}
function buildHotbarTip(i){
	const frag=document.createDocumentFragment();
	const name=HOTBAR_ORDER[i];
	if(!name) return frag;
	const res=RESOURCE_DEFS.find(r=>r.tile===name);
	const chest=isChestSelection(name);
	const label=res? res.label : (chest? ({CHEST_COMMON:'Skrzynia zwykła',CHEST_RARE:'Skrzynia rzadka',CHEST_EPIC:'Skrzynia epicka'})[name] : name);
	const color=res? res.color : (chest? ({CHEST_COMMON:'#b07f2c',CHEST_RARE:'#a74cc9',CHEST_EPIC:'#e0b341'})[name] : '#888');
	frag.appendChild(hudTipTitle(label,color));
	const key=TILE_TO_RES[T[name]];
	if(key) frag.appendChild(hudTipRow(null,'W plecaku','×'+(inv[key]|0)));
	if(chest) frag.appendChild(hudTipNode('tipHint','Skrzynie stawiasz tylko w trybie Boga'));
	const id=T[name];
	if(id===T.DYNAMO) frag.appendChild(hudTipNode('tipHint','R obraca dynamo ('+dynamoOrientationLabel()+')'));
	else if(id===T.WATER_PUMP) frag.appendChild(hudTipNode('tipHint','R obraca pompę ('+pumpOrientationLabel()+')'));
	else if(isBackgroundBuildTileId(id)) frag.appendChild(hudTipNode('tipHint','R przełącza budowanie w tle'));
	frag.appendChild(hudTipNode('tipHint','Klawisz '+hotbarKeyLabel(i)+' · PPM w świecie stawia · drugi klik = zmiana typu'));
	return frag;
}
function hideHudTip(){ if(!hudTipEl) return; hudTipEl.classList.remove('show'); hudTipEl.textContent=''; hudTipAnchor=null; }
function positionHudTip(){
	if(!hudTipEl || !hudTipAnchor) return;
	const r=hudTipAnchor.getBoundingClientRect();
	const tw=hudTipEl.offsetWidth, th=hudTipEl.offsetHeight;
	let x=r.left + r.width/2 - tw/2;
	x=Math.max(8, Math.min(window.innerWidth-tw-8, x));
	let y=r.top - th - 10;
	if(y<8) y=r.bottom+10;
	hudTipEl.style.left=Math.round(x)+'px';
	hudTipEl.style.top=Math.round(y)+'px';
}
function showHudTip(anchorEl,contentFrag){
	if(!hudTipEl || !contentFrag || !contentFrag.childNodes.length) return;
	hudTipEl.textContent='';
	hudTipEl.appendChild(contentFrag);
	hudTipEl.classList.add('show');
	hudTipAnchor=anchorEl;
	positionHudTip();
}
// Live refresh while visible: counts keep moving mid-fight and after clicks
function refreshHudTip(){
	if(!hudTipAnchor) return;
	const wkey=hudTipAnchor.getAttribute('data-wkey');
	if(wkey){ showHudTip(hudTipAnchor, buildWeaponTip(wkey)); return; }
	if(typeof hudTipAnchor.__hotIdx==='number') showHudTip(hudTipAnchor, buildHotbarTip(hudTipAnchor.__hotIdx));
}
function bindHudTip(el,builder){
	el.addEventListener('pointerenter',ev=>{ if(ev.pointerType==='touch') return; showHudTip(el,builder()); });
	el.addEventListener('pointerleave',hideHudTip);
	el.addEventListener('pointerdown',ev=>{ if(ev.pointerType==='touch') hideHudTip(); });
}
document.querySelectorAll('#weaponBar .wepSlot').forEach(el=>{
	bindHudTip(el,()=>buildWeaponTip(el.getAttribute('data-wkey')));
});
document.querySelectorAll('#hotbarWrap .hotSlot').forEach((el,i)=>{
	el.__hotIdx=i;
	bindHudTip(el,()=>buildHotbarTip(i));
});
window.addEventListener('mm-resources-change',()=>{ if(hudTipAnchor) refreshHudTip(); });
window.addEventListener('keydown',e=>{ if(isEditableTarget(e.target)) return; if(modalInputOpen()){ releaseGameplayInput(); return; } noteSaveActivity(); const k=e.key.toLowerCase(); const code=(e.code||'').toLowerCase(); keys[k]=true; if(code) keys[code]=true; if(!e.repeat) queueJumpInput(k); if(k==='s' || k==='arrowdown') trapdoorDropBufferT=TRAPDOOR_DROP_BUFFER; if(k==='escape'){ closeHotSelect(); }
 if(!e.repeat && NPCS && NPCS.handleKey && NPCS.handleKey(e.key,player,tutorialNpcCtx)){ e.preventDefault(); return; }
 // Weapon shortcuts: 1 = pickaxe/build mode (cycles owned tiers), 2/3/4 cycle weapon categories
 if(!e.repeat && ['1','2','3','4'].includes(e.key)){ selectWeaponKey(e.key); }
 // Hotbar numeric (5..9,0) -> slots 0..5
 if(['5','6','7','8','9','0'].includes(e.key)){
	 const slot = (e.key==='0') ? HOTBAR_ORDER.length-1 : (parseInt(e.key,10)-5);
	 cycleHotbar(slot);
 }
	// Toggle performance HUD (F3)
	if(k==='f3' && !keysOnce.has('f3')){ showPerfHud=!showPerfHud; msg('Debug '+(showPerfHud?'ON':'OFF')); keysOnce.add('f3'); }
	if(k==='g'&&!keysOnce.has('g')){ toggleGod(); keysOnce.add('g'); }
	if(k==='i'&&!keysOnce.has('i')){ toggleImmunity(); keysOnce.add('i'); }
	if(k==='p'&&!keysOnce.has('p')){ chestDebug=!chestDebug; msg('Chest debug '+(chestDebug?'ON':'OFF')); keysOnce.add('p'); }
	if(k==='j'&&!keysOnce.has('j')){ keysOnce.add('j'); const pcx=Math.floor(player.x/CHUNK_W); msg('Skrzynie w pobliżu: '+countChestsAround(pcx,4)); }
	if(k==='k'&&!keysOnce.has('k')){ // force spawn a chest at feet (cycle tiers)
		keysOnce.add('k'); const px=Math.floor(player.x); const py=Math.floor(player.y)-1; const tiers=[T.CHEST_COMMON,T.CHEST_RARE,T.CHEST_EPIC]; const cur=getTile(px,py); if(cur===T.AIR){ const idx=Math.floor(performance.now()/1000)%tiers.length; setTile(px,py,tiers[idx]); msg('Debug: wstawiono skrzynię '+(idx===2?'epicką':idx===1?'rzadką':'zwykłą')); } }
	// Debug chest placement (L)
	if(k==='l'&&!keysOnce.has('l')){ keysOnce.add('l'); const px=Math.floor(player.x); const py=Math.floor(player.y); const below=py; if(getTile(px,below)===T.AIR){ const r=Math.random(); let cid=T.CHEST_COMMON; if(r>0.9) cid=T.CHEST_RARE; if(r>0.97) cid=T.CHEST_EPIC; setTile(px,below,cid); msg('Postawiono skrzynię ('+(cid===T.CHEST_EPIC?'epicka':cid===T.CHEST_RARE?'rzadka':'zwykła')+')'); } }
	if(k==='m'&&!keysOnce.has('m')){ toggleMap(); keysOnce.add('m'); }
	if(k==='c'&&!keysOnce.has('c')){ centerCam(); keysOnce.add('c'); }
	if(k==='t'&&!keysOnce.has('t')){ toggleCraftPanel(); keysOnce.add('t'); }
	if(k==='r'&&!keysOnce.has('r') && selectedTileId()===T.DYNAMO){ toggleDynamoOrientation(); keysOnce.add('r'); e.preventDefault(); }
	if(k==='r'&&!keysOnce.has('r') && selectedTileId()===T.WATER_PUMP){ togglePumpOrientation(); keysOnce.add('r'); e.preventDefault(); }
	if(k==='r'&&!keysOnce.has('r') && isBackgroundBuildTileId(selectedTileId())){ toggleBackgroundBuildMode(); keysOnce.add('r'); e.preventDefault(); }
	if(k==='e'&&!keysOnce.has('e')){
		keysOnce.add('e');
		if(MECHS && MECHS.toggleBoard && MECHS.toggleBoard(player,getTile)){
			noteSaveActivity();
			saveState();
		}
	}
	if(k==='h'&&!keysOnce.has('h')){ toggleHelp(); keysOnce.add('h'); }
	if(k==='v'&&!keysOnce.has('v')){ window.__mobDebug = !window.__mobDebug; msg('Mob debug '+(window.__mobDebug?'ON':'OFF')); keysOnce.add('v'); }
	if(k==='x'&&!keysOnce.has('x')){ useCraterScanner(); keysOnce.add('x'); }
	if(k==='f'&&!keysOnce.has('f')){ if(FISHING && FISHING.onKey) FISHING.onKey(player,getTile); keysOnce.add('f'); }
	if(k==='o'&&!keysOnce.has('o')){ keysOnce.add('o'); if(VOLCANO && VOLCANO.forceMasterEruption) VOLCANO.forceMasterEruption(); }
	if(k==='b'&&!keysOnce.has('b')){ setPaused(!paused); keysOnce.add('b'); }
	if(k==='n'&&!keysOnce.has('n')){ showMinimap=!showMinimap; msg('Minimapa '+(showMinimap?'ON':'OFF')); keysOnce.add('n'); }
	if(['arrowup','arrowdown','w',' '].includes(k)) e.preventDefault(); });
window.addEventListener('keyup',e=>{ if(modalInputOpen()){ releaseGameplayInput(); return; } noteSaveActivity(); const k=e.key.toLowerCase(); const code=(e.code||'').toLowerCase(); keys[k]=false; if(code) keys[code]=false; keysOnce.delete(k); });
// Losing focus while keys are held would leave the player running forever — release everything
window.addEventListener('blur',releaseGameplayInput);

// Kierunek kopania
let mineDir={dx:1,dy:0}; document.querySelectorAll('.dirbtn').forEach(b=>{ b.addEventListener('click',()=>{ noteSaveActivity(); mineDir.dx=+b.getAttribute('data-dx'); mineDir.dy=+b.getAttribute('data-dy'); document.querySelectorAll('.dirbtn').forEach(o=>o.classList.remove('sel')); b.classList.add('sel'); }); }); document.querySelector('.dirbtn[data-dx="1"][data-dy="0"]').classList.add('sel');

// Pad dotykowy
function bindPad(){ document.querySelectorAll('#pad .btn').forEach(btn=>{ const code=btn.getAttribute('data-key'); if(!code) return; btn.addEventListener('pointerdown',ev=>{ ev.preventDefault(); noteSaveActivity(); const k=code.toLowerCase(); keys[k]=true; btn.classList.add('on'); queueJumpInput(k); if(code==='ArrowDown') trapdoorDropBufferT=TRAPDOOR_DROP_BUFFER; if(code==='ArrowUp') keys['w']=true; }); ['pointerup','pointerleave','pointercancel'].forEach(evName=> btn.addEventListener(evName,()=>{ noteSaveActivity(); keys[code.toLowerCase()]=false; btn.classList.remove('on'); if(code==='ArrowUp') keys['w']=false; })); }); } bindPad();

// Kamera
let camX=0,camY=0,camSX=0,camSY=0; let zoom=1, zoomTarget=1;
function ensureChunks(){
	const pcx=Math.floor(player.x/CHUNK_W);
	for(let d=-2; d<=2; d++) ensureChunkAtY(pcx+d,player.y);
}
const MIN_ZOOM=0.72, MAX_ZOOM=3;
const CAMERA_FOLLOW_RATE=8;
const CAMERA_MAX_DT=0.05;
let lastFrameMs=0;
const frameClock={last:(typeof performance!=='undefined' && performance.now)?performance.now():Date.now(), resetFrames:0};
// camSX/camSY track the smoothed camera CENTER, locked on the hero. The viewport
// top-left (camX/camY) is derived from that center and the CURRENT zoom every
// frame (applyCameraFromCenter), so a changing zoom scales the world around the
// hero rather than the canvas top-left corner. The follow smoothing then only
// lags hero movement, never the zoom — keeping the hero fixed on screen as you
// zoom in/out.
function cameraCenterForPlayer(){
	const subject=deathTravelFx ? deathTravelCurrentPoint(deathTravelFx) : player;
	return {
		x:subject.x + player.w/2,
		y:subject.y + player.h/2
	};
}
function applyCameraFromCenter(){
	if(!Number.isFinite(camSX) || !Number.isFinite(camSY)) return;
	const viewW=(TILE>0 && zoom>0) ? W/(TILE*zoom) : 0;
	const viewH=(TILE>0 && zoom>0) ? H/(TILE*zoom) : 0;
	camX=camSX - viewW/2;
	camY=camSY - viewH/2;
}
function snapCameraToPlayer(){
	const c=cameraCenterForPlayer();
	if(!Number.isFinite(c.x) || !Number.isFinite(c.y)) return;
	camSX=c.x; camSY=c.y;
	applyCameraFromCenter();
}
function followCameraAxis(current,target,dt){
	if(!Number.isFinite(current)) return target;
	const alpha=1-Math.exp(-CAMERA_FOLLOW_RATE*Math.max(0,dt||0));
	return current + (target-current)*Math.min(1,Math.max(0,alpha));
}
function updateCameraFollow(dt){
	const c=cameraCenterForPlayer();
	if(!Number.isFinite(c.x) || !Number.isFinite(c.y)) return;
	if(deathTravelFx){
		camSX=c.x; camSY=c.y;
		applyCameraFromCenter();
		return;
	}
	// Snap on big jumps (teleport/respawn); the threshold is the center's drift.
	if(!Number.isFinite(camSX) || !Number.isFinite(camSY) || Math.abs(c.x-camSX)>160 || Math.abs(c.y-camSY)>90){
		snapCameraToPlayer();
		return;
	}
	const cdt=Math.min(CAMERA_MAX_DT, Math.max(0,dt||0));
	camSX=followCameraAxis(camSX,c.x,cdt);
	camSY=followCameraAxis(camSY,c.y,cdt);
	applyCameraFromCenter();
}
function renderCameraCoord(v){
	const scale=TILE*zoom*DPR;
	if(!Number.isFinite(v) || !Number.isFinite(scale) || scale<=0) return v;
	return Math.round(v*scale)/scale;
}
function currentRenderCamera(){
	return {x:renderCameraCoord(camX), y:renderCameraCoord(camY)};
}
function currentViewportState(){
	const viewW=(TILE>0 && zoom>0) ? W/(TILE*zoom) : 0;
	const viewH=(TILE>0 && zoom>0) ? H/(TILE*zoom) : 0;
	return {x0:camX, y0:camY, x1:camX+viewW, y1:camY+viewH};
}
function seasonUpdateContext(){
	const inputActive=!!(
		keys['a'] || keys['d'] || keys['arrowleft'] || keys['arrowright'] ||
		keys['w'] || keys['arrowup'] || keys[' '] || keys['s'] || keys['arrowdown'] ||
		mining || mineBtnHeld || fireBtnHeld || minePointerId!=null || weaponPointerId!=null ||
		(activePointers && activePointers.size)
	);
	return {
		viewport:currentViewportState(),
		inputActive
	};
}
function resetFrameTiming(reason){
	const now=(typeof performance!=='undefined' && performance.now)?performance.now():Date.now();
	frameClock.last=now;
	frameClock.resetFrames=2;
	frameCapRafLast=0;
	frameCapNativeMs=0;
	frameCapDivisor=1;
	frameCapPhase=0;
	publishFrameCapState();
	lastFrameMs=0;
	try{ window.__mmFrameMs=0; window.__mmFrameResetReason=reason||'reset'; }catch(e){}
}
function clampZoom(z){ return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)); }
function setZoom(z){ zoomTarget = clampZoom(z); }
function nudgeZoom(f){ setZoom(zoomTarget * f); }
canvas.addEventListener('wheel',e=>{ if(modalInputOpen()) return; noteSaveActivity(); if(e.ctrlKey){ // let browser zoom work
	return; }
	e.preventDefault(); const dir = e.deltaY>0?1:-1; const factor = dir>0? 1/1.1 : 1.1; nudgeZoom(factor);
},{passive:false});
window.addEventListener('keydown',e=>{ if(isEditableTarget(e.target) || modalInputOpen()) return; noteSaveActivity(); if(e.key==='+'||e.key==='='||e.key===']'){ nudgeZoom(1.1); }
	if(e.key==='-'||e.key==='['){ nudgeZoom(1/1.1); }
});

// Fizyka
// Movement constants imported from canonical constants module
let jumpPrev=false; let swimBuoySmooth=0; let wasInWater=false; let bubbleAcc=0; let swimWakeAcc=0;
const drowningState = SURVIVAL && SURVIVAL.createDrowningState ? SURVIVAL.createDrowningState() : {airless:0, damageAcc:0, warned:false};
const underwaterEnergyState = SURVIVAL && SURVIVAL.createUnderwaterEnergyState ? SURVIVAL.createUnderwaterEnergyState() : {damageAcc:0};
const swimChillState = SURVIVAL && SURVIVAL.createSwimChillState ? SURVIVAL.createSwimChillState() : {exposure:0, damageAcc:0, warned:false};
const waterPressureState = SURVIVAL && SURVIVAL.createWaterPressureState ? SURVIVAL.createWaterPressureState() : {damageAcc:0, warned:false};
const houseHealingState = HOUSE_HEALING && HOUSE_HEALING.createState ? HOUSE_HEALING.createState() : {scanT:0, inside:false, last:null, reportAcc:0, wasHealing:false};
let houseHealMsgAt=0, waterPressureMsgAt=0;
function updateHouseHealing(dt){
	if(!HOUSE_HEALING || !HOUSE_HEALING.update) return;
	const res=HOUSE_HEALING.update(houseHealingState,dt,player,getTile,{
		isBurning:(x,y)=>!!(FIRE && FIRE.isBurning && FIRE.isBurning(x,y)),
		backgroundAt:getConstructionBackgroundTile
	});
	if(res && res.entered && res.status && res.status.ok){
		registerHealingShelterStatus(res.status);
		noteSaveActivity();
	}
	if(res && res.exited){
		validateHealingShelters({changed:{x:Math.floor(player.x),y:Math.floor(player.y)},signal:true});
	}
	if(res && res.report>0){
		pushWorldNumber({kind:'heal',amount:res.report,x:player.x,y:player.y-player.h*0.72,target:'hero',source:'house'});
		notifyInvasionHeroAction('hero_heal',{amount:res.report,source:'house'});
	}
	if(res && res.started){
		const now=performance.now();
		if(now-houseHealMsgAt>14000){
			houseHealMsgAt=now;
			const chairs=(res.status && res.status.chairs)|0;
			msg(chairs>0 ? 'Dom: fotel przy swietle - odpoczywasz i leczysz sie szybciej' : 'Dom: dach, sciany i swiatlo powoli lecza rany');
		}
	}
}
// Jump feel: a press is buffered for a short window instead of being consumed on
// the exact frame it arrives (presses used to die silently on micro-airborne
// frames over rough terrain → "I have to press jump twice"). Coyote time keeps a
// ground jump valid just after stepping off a ledge.
const JUMP_BUFFER=0.12, COYOTE_TIME=0.1;
const TRAPDOOR_DROP_BUFFER=0.22;
let jumpBufferT=0, coyoteT=0, ladderReleaseT=0, trapdoorDropBufferT=0;
// Rowing: rising-edge trackers for oar strokes + message throttle for empty energy
let rowPrevLeft=false, rowPrevRight=false, rowNoEnergyMsgAt=0;
function heroRowStroke(dir){
	if(!BOATS || !BOATS.row) return;
	const res=BOATS.row(dir,{heroEnergy:MM.heroEnergy, godMode, player});
	if(!res || !res.ok) return;
	noteSaveActivity();
	try{ if(MM.audio && MM.audio.play) MM.audio.play('splash'); }catch(e){}
	if(!res.strong){
		const now=performance.now();
		if(now-rowNoEnergyMsgAt>2500){ rowNoEnergyMsgAt=now; msg('Brak energii — wiosłujesz z trudem'); }
	}
}
function groundTileUnderPlayer(){
	if(!player.onGround) return T.AIR;
	const y=Math.floor(player.y+player.h/2+0.05);
	const samples=[player.x, player.x-player.w*0.42, player.x+player.w*0.42];
	let ground=T.AIR;
	for(const sx of samples){
		const t=getTile(Math.floor(sx),y);
		if(t===T.ICE) return T.ICE;
		if(t===T.SNOW) ground=T.SNOW;
		else if(t===T.MUD && ground!==T.SNOW) ground=T.MUD;
		else if(ground===T.AIR && t!==T.AIR) ground=t;
	}
	return ground;
}
function hasLadderAt(x,y){
	return hasInfrastructureTile(x,y,T.LADDER) || getTile(x,y)===T.LADDER;
}
function heroTouchesLadder(){
	const left=Math.floor(player.x-player.w*0.42);
	const right=Math.floor(player.x+player.w*0.42);
	const top=Math.floor(player.y-player.h/2+0.04);
	const bottom=Math.floor(player.y+player.h/2-0.04);
	for(let y=top;y<=bottom;y++){
		for(let x=left;x<=right;x++){
			if(hasLadderAt(x,y)) return true;
		}
	}
	return false;
}
function heroTouchesSideBlock(){
	const halfW=player.w/2;
	const probe=0.035;
	const leftX=Math.floor(player.x-halfW-probe);
	const rightX=Math.floor(player.x+halfW+probe);
	const top=Math.floor(player.y-player.h/2+0.04);
	const bottom=Math.floor(player.y+player.h/2-0.04);
	for(let y=top;y<=bottom;y++){
		if(solidAt(leftX,y,'x') || solidAt(rightX,y,'x')) return true;
	}
	return false;
}
function waterLevelUnitsAt(tx,ty){
	if(getTile(tx,ty)!==T.WATER) return 0;
	const U=(WATER && WATER.UNITS) || 10;
	const raw=(WATER && WATER.levelAt) ? WATER.levelAt(tx,ty,getTile) : U;
	const lvl=Number.isFinite(Number(raw)) ? Number(raw) : U;
	return Math.max(0,Math.min(U,lvl));
}
function waterSurfaceYAt(tx,ty){
	const U=(WATER && WATER.UNITS) || 10;
	const lvl=waterLevelUnitsAt(tx,ty);
	return ty + 1 - (lvl>0?lvl:U)/U;
}
function waterStackAboveY(tx,worldY){
	if(!Number.isFinite(tx) || !Number.isFinite(worldY)) return 0;
	tx=Math.floor(tx);
	const startY=Math.floor(worldY);
	if(getTile(tx,startY)!==T.WATER) return 0;
	const minY=worldMinY();
	const maxScan=192;
	let stack=0;
	for(let y=startY, n=0; y>=minY && n<maxScan; y--, n++){
		if(getTile(tx,y)!==T.WATER) break;
		const surface=waterSurfaceYAt(tx,y);
		const lower=(y===startY) ? worldY : y+1;
		stack += Math.max(0, lower-surface);
	}
	return stack;
}
function heroWaterExposure(){
	const samples=5;
	let submerged=0;
	const headY=player.y-player.h/2;
	const footY=player.y+player.h/2;
	const step=(footY-headY)/(samples-1);
	const tileX=Math.floor(player.x);
	// Water cells carry sub-tile fill levels: a sample only counts as submerged when it
	// sits below the cell's actual surface, so ankle-deep films don't trigger swimming.
	for(let i=0;i<samples;i++){
		const sy=headY+step*i;
		const ty=Math.floor(sy);
		if(getTile(tileX,ty)===T.WATER && sy>=waterSurfaceYAt(tileX,ty)){
			const fracInside=1-(sy-ty);
			submerged += 0.5+0.5*fracInside;
		}
	}
	const subFrac=Math.min(1,submerged/samples);
	const headTy=Math.floor(headY);
	return {
		headY,
		footY,
		tileX,
		subFrac,
		inWater:subFrac>0.05,
		headCovered:getTile(tileX,headTy)===T.WATER && subFrac>0.88 && headY>=waterSurfaceYAt(tileX,headTy)
	};
}
function applyUnderwaterEnergyUseDamage(energySpent){
	if(godMode || !(energySpent>0) || !SURVIVAL || !SURVIVAL.updateUnderwaterEnergyShock) return false;
	const exposure=heroWaterExposure();
	const submerged=exposure.subFrac>0.45;
	const shock=SURVIVAL.updateUnderwaterEnergyShock(underwaterEnergyState,energySpent,submerged);
	if(!shock || !(shock.damage>0)) return false;
	const now=performance.now();
	if(player.hpInvul && now<player.hpInvul) return false;
	const dmg=Math.min(SURVIVAL.UNDERWATER_ENERGY_DAMAGE_MAX||10,shock.damage);
	if(window.damageHero && window.damageHero(dmg,{cause:'underwater_energy',invulMs:420})){
		if(SURVIVAL.consumeUnderwaterEnergyDamage) SURVIVAL.consumeUnderwaterEnergyDamage(underwaterEnergyState,dmg);
		if(player.hp>0 && now-underwaterEnergyShockMsgAt>1200){
			underwaterEnergyShockMsgAt=now;
			msg('Energia razi pod woda!');
		}
		return true;
	}
	return false;
}
function solarWeatherAllowsHeroCharge(){
	const ti=(BACKGROUND && BACKGROUND.timeInfo) ? BACKGROUND.timeInfo() : null;
	if(!ti || !ti.isDay || ti.hour<10 || ti.hour>=16) return false;
	const m=(CLOUDS && CLOUDS.metrics) ? CLOUDS.metrics() : null;
	if(m && m.storm && m.storm.active) return false;
	if(m && ((m.clouds||0)>0 || (m.cloudMass||0)>0.08)) return false;
	try{ if(CLOUDS && CLOUDS.isRainingAt && CLOUDS.isRainingAt(player.x)) return false; }catch(e){}
	return true;
}
function solarHeroSkyOpen(){
	const top=Math.floor(player.y-player.h/2)-1;
	const probes=[Math.floor(player.x),Math.floor(player.x-player.w*0.42),Math.floor(player.x+player.w*0.42)];
	for(const tx of probes){
		for(let yy=top; yy>=WORLD_MIN_Y; yy--){
			const t=getTile(tx,yy);
			if(t!==T.AIR && t!==T.WATER && t!==T.WIRE && t!==T.COPPER_WIRE && t!==T.WATER_PIPE) return false;
		}
	}
	return true;
}
function heroStandingOnTreeTopForSolar(){
	if(!player.onGround) return false;
	const footY=Math.floor(player.y+player.h/2+0.06);
	const probes=[Math.floor(player.x),Math.floor(player.x-player.w*0.42),Math.floor(player.x+player.w*0.42)];
	for(const tx of probes){
		const under=getTile(tx,footY);
		if((under===T.WOOD || isLeaf(under)) && getTile(tx,footY-1)===T.AIR && solarHeroSkyOpen()) return true;
	}
	return false;
}
function heroInSolarChargeSpot(){
	if(!solarWeatherAllowsHeroCharge()) return null;
	const biome=(WORLDGEN && WORLDGEN.biomeType) ? WORLDGEN.biomeType(Math.floor(player.x)) : null;
	const desert=biome===3 && solarHeroSkyOpen();
	const treeTop=heroStandingOnTreeTopForSolar();
	if(!desert && !treeTop) return null;
	return {kind:desert?'desert':'tree',x:player.x,y:player.y-player.h*0.42};
}
function updateHeroEnergy(dt){
	if(!(dt>0) || !isFinite(dt)) return;
	if(!player.maxEnergy) applyHeroEnergyCapacity();
	let charged=0, got=null;
	const max=player.maxEnergy||heroEnergyCapacity();
	const turboRechargeBlocked=turboRechargePauseT>0;
	if(turboRechargePauseT>0) turboRechargePauseT=Math.max(0,turboRechargePauseT-dt);
	if(!turboRechargeBlocked && DYNAMO && typeof DYNAMO.absorbNear==='function' && (player.energy||0)<max-0.02){
		const lv=(MM.progress && MM.progress.level)? MM.progress.level() : {level:1};
		const st=(MM.progress && MM.progress.stats)? MM.progress.stats() : {cap:0};
		const capPts=(st && st.cap)||0;
		const chargeRate=10 + Math.min(80, (lv.level||1)*1.4 + capPts*3.8);
		const want=Math.min(max-(player.energy||0), chargeRate*dt);
		got=DYNAMO.absorbNear(player.x,player.y,want,getTile,2.7);
		if(got && got.amount>0){
			charged=addHeroEnergy(got.amount);
			if(charged>0){
				const targetIntensity=Math.max(0.25, Math.min(1.6, chargeRate/32));
				energyChargeFx.t=0.62;
				energyChargeFx.intensity=Math.max(energyChargeFx.intensity||0,targetIntensity);
				energyChargeFx.source={x:got.x+0.5,y:got.y+0.5};
				energyFxEmitT-=dt;
				if(energyFxEmitT<=0 && PARTICLES && PARTICLES.spawnEnergyAbsorb){
					PARTICLES.spawnEnergyAbsorb((got.x+0.5)*TILE,(got.y+0.5)*TILE,player.x*TILE,(player.y-0.05)*TILE,targetIntensity);
					energyFxEmitT=0.055;
				}
				if(AUDIO && AUDIO.play) AUDIO.play('charge');
				const now=performance.now();
				if(now-_lastEnergySaveAt>2500){ _lastEnergySaveAt=now; saveState(); }
			}
		}
	}
	const solar=heroInSolarChargeSpot();
	if(solar && (player.energy||0)<max*HERO_SOLAR_CAP_FRAC-0.001){
		const cap=max*HERO_SOLAR_CAP_FRAC;
		const want=Math.min(cap-(player.energy||0),HERO_SOLAR_ENERGY_PER_SEC*dt);
		const gained=addHeroEnergy(want,{cause:'solar',source:solar,intensity:0.4});
		if(gained>0){
			charged+=gained;
			energyChargeFx.t=Math.max(energyChargeFx.t||0,0.30);
			energyChargeFx.intensity=Math.max(energyChargeFx.intensity||0,0.38);
			energyChargeFx.source=null;
			const now=performance.now();
			if(now-_lastEnergySaveAt>2500){ _lastEnergySaveAt=now; saveState(); }
		}
	}
	if(charged<=0) energyFxEmitT=Math.max(0,energyFxEmitT-dt);
	if(energyChargeFx.t>0){
		energyChargeFx.t=Math.max(0, energyChargeFx.t-dt);
		energyChargeFx.intensity=Math.max(0, (energyChargeFx.intensity||0)-dt*1.6);
		if(energyChargeFx.t<=0) energyChargeFx.source=null;
	}
}
// --- Collapse burial (engine/hero_crush.js): the hero is a block, never a pinball ---
// Cells that become solid *while overlapping the hero* are burial events; light
// loads get re-loosened and rest on him, heavy loads pin and crush him in place.
// Cells he is merely pushed against (boss shoves) ease him out without snapping.
const heroBuriedCells=new Set();
function noteTileBuriesHero(tx,ty,next){
	const p=window.player;
	if(!p || next===T.AIR || isHeroPassableTile(next)) return;
	const w=p.w/2, h=p.h/2;
	if(tx+1>p.x-w && tx<p.x+w && ty+1>p.y-h && ty<p.y+h){
		if(heroBuriedCells.size>=64) heroBuriedCells.clear(); // pathological cascade guard
		heroBuriedCells.add(tx+','+ty);
	}
}
let crushMsgAt=0, pileMsgAt=0, crushSeeded=false;
let heroPileWeight=0; // hovering debris resting on the hero (falling.js/trees.js entities)
function seedHeroBurialFromWorld(){ crushSeeded=false; } // a (re)loaded save may wake the hero already buried
function heroCrushLooseLoad(x,y,t){
	return t===T.SAND
		|| (FALLING && FALLING.isSettledRubbleAt && FALLING.isSettledRubbleAt(x,y))
		|| (TREES && TREES.isFallenDebrisAt && TREES.isFallenDebrisAt(x,y));
}
function measureHeroPile(){
	let w=0;
	try{ if(FALLING && FALLING.heroRestingLoad) w+=FALLING.heroRestingLoad().weight; }catch(e){}
	try{ if(TREES && TREES.heroRestingLoad) w+=TREES.heroRestingLoad().weight; }catch(e){}
	return w;
}
function updateHeroCrush(dt){
	if(deathTravelFx) return;
	if(!crushSeeded){
		// Whatever the hero wakes up embedded in was a collapse, not a wall he walked into
		crushSeeded=true;
		for(const c of heroEmbeddedTiles(player,(x,y)=>solidAt(x,y),getTile)) heroBuriedCells.add(c.x+','+c.y);
	}
	if(godMode) return;
	const res=resolveHeroBurial({
		player, getTile,
		solidAt:(x,y)=>solidAt(x,y),
		buriedCells:heroBuriedCells,
		capacityBonus:(MM.activeModifiers && MM.activeModifiers.crushResistBonus)||0,
		isLooseLoad:heroCrushLooseLoad,
		minY:worldMinY(),
		dt
	});
	if(res.status==='rest'){
		for(const c of res.eject){
			setTile(c.x,c.y,T.AIR);
			heroBuriedCells.delete(c.x+','+c.y);
			if(FALLING && FALLING.onTileRemoved) FALLING.onTileRemoved(c.x,c.y);
			if(WATER && WATER.onTileChanged) WATER.onTileChanged(c.x,c.y,getTile);
			if(FALLING && FALLING.spawnLoose) FALLING.spawnLoose(c.x,c.y,c.t);
		}
	} else if(res.status==='pinned'){
		// Too heavy to shoulder: no relocation and no walking out from under it —
		// the hero digs free (mining still works) or dies where he stands.
		player.vx*=Math.max(0,1-12*dt);
		if(player.vy<0) player.vy=0;
		if(window.damageHero(res.damage,{cause:'crushed',invulMs:CRUSH_TUNING.TICK_MS}) && player.hp>0){
			const now=performance.now();
			if(now-crushMsgAt>2500){ crushMsgAt=now; msg('⛰ Miażdży cię zawał — odkop się!'); }
		}
	} else if(res.status==='shoved' && res.push){
		player.x+=res.push.dx;
		player.y+=res.push.dy;
	}
	// Debris resting on the hero as hovering entities is load too: it blocks
	// jumping (enforced in physics) and, when it outweighs his Twardość capacity,
	// presses like a burial. Horizontal movement stays free — entities cannot be
	// mined, so stepping out from under the pile must remain the escape route.
	heroPileWeight=measureHeroPile();
	const pileExcess=heroPileWeight-heroCrushCapacity((MM.activeModifiers && MM.activeModifiers.crushResistBonus)||0);
	if(pileExcess>0 && res.status!=='pinned'){
		if(window.damageHero(crushTickDamage(pileExcess),{cause:'crushed',invulMs:CRUSH_TUNING.TICK_MS}) && player.hp>0){
			const now=performance.now();
			if(now-crushMsgAt>2500){ crushMsgAt=now; msg('⛰ Miażdży cię zawał — odkop się!'); }
		}
	}
}
function physics(dt){
	updateHeroCrush(dt);
	if(MECHS && MECHS.heroMech && MECHS.heroMech(player)){
		if(MECHS.syncRider) MECHS.syncRider(player);
		ensureChunks();
		return;
	}
	// Standing in a pilot chair assembles the block machine under it into a
	// drivable mech (engine/mechs.js validates chassis + energy and carves the
	// blocks out of the grid). Once seated, the branch above takes over.
	if(MECHS && MECHS.trySeatFromWorld && MECHS.trySeatFromWorld(player,getTile,setTile)){
		ensureChunks();
		return;
	}
	// Horizontal input
	let input=0; if(keys['a']||keys['arrowleft']) input-=1; if(keys['d']||keys['arrowright']) input+=1; if(input!==0) player.facing=input;
	// Aboard a floating raft the deck is the vehicle: each fresh tap of A/D is an
	// oar stroke (energy-burning impulse on the boat), holding only shuffles the
	// hero slowly across the deck. Beached rafts walk like ordinary ground.
	const heroBoatNow=BOATS ? (BOATS.heroOnBoat ? BOATS.heroOnBoat(player) : (BOATS.heroBoat ? BOATS.heroBoat() : null)) : null;
	const ridingFloatingBoat = !!(heroBoatNow && heroBoatNow.inWater && !heroBoatNow.grounded);
	const heroTrackNow=MECHS && MECHS.heroOnTracks ? MECHS.heroOnTracks(player) : null;
	if(ridingFloatingBoat){
		const leftNow=!!(keys['a']||keys['arrowleft']);
		const rightNow=!!(keys['d']||keys['arrowright']);
		if(leftNow && !rowPrevLeft) heroRowStroke(-1);
		if(rightNow && !rowPrevRight) heroRowStroke(1);
		rowPrevLeft=leftNow; rowPrevRight=rightNow;
		input*=0.45;
	} else {
		rowPrevLeft=false; rowPrevRight=false;
		if(heroTrackNow) input=0;
	}
	const climbUpInput=!!(keys['w']||keys['arrowup']);
	const climbDownInput=!!(keys['s']||keys['arrowdown']);
	const ladderContact=heroTouchesLadder();
	if(ladderReleaseT>0) ladderReleaseT=Math.max(0,ladderReleaseT-dt);
	if(trapdoorDropBufferT>0) trapdoorDropBufferT=Math.max(0,trapdoorDropBufferT-dt);
	const jumpHeldEarly=!!keys[' '] || (!ladderContact && climbUpInput);
	const turboRequested=turboKeyHeld();
	const turboDoingWork=turboRequested && (Math.abs(input)>0 || Math.abs(player.vx||0)>0.25 || jumpHeldEarly || (ladderContact && (climbUpInput||climbDownInput)) || !player.onGround);
	const turboActive=turboDoingWork && spendTurboEnergy(dt);
	updateTurboFx(dt,turboActive);
	const turboSpeedMult=turboActive ? TURBO_SPEED_MULT : 1;
	const turboJumpMult=turboActive ? TURBO_JUMP_MULT : 1;

	// Submersion sampling (5 points along body) with fractional sampling for smoother transitions
	const waterExposure=heroWaterExposure();
	const headY=waterExposure.headY, footY=waterExposure.footY, tileX=waterExposure.tileX;
	const subFrac=waterExposure.subFrac;
	const inWater=waterExposure.inWater; // tiny contact ignored
	let pressureVisual=null;
	if(!inWater && SURVIVAL && SURVIVAL.resetUnderwaterEnergyShock) SURVIVAL.resetUnderwaterEnergyShock(underwaterEnergyState);
	if(!inWater && SURVIVAL && SURVIVAL.resetWaterPressure) SURVIVAL.resetWaterPressure(waterPressureState);

	// Combine all movement multipliers, including dropdown, turbo and water drag.
	// Ground material affects traction: mud slows, snow slides, ice slides hard.
	const waterMoveMult = (inWater && !ridingFloatingBoat) ? heroWaterMoveSpeedMult() : 1;
	const moveMult = ((MM.activeModifiers && MM.activeModifiers.moveSpeedMult)||1) * (window.playerSpeedMultiplier || 2) * turboSpeedMult * waterMoveMult;
	if(TERRAIN_TRAPS && TERRAIN_TRAPS.stepEntity) TERRAIN_TRAPS.stepEntity(player,getTile,setTile,{kind:'hero'});
	const groundTile = groundTileUnderPlayer();
	const groundTraction = surfaceTraction(groundTile);
	player.vx = applyHorizontalMovement(player.vx, input, dt, moveMult, MOVE, groundTile);
	// Lava sears: standing in it hurts and flings the hero upward (central handler)
	if(getTile(tileX, Math.floor(player.y))===T.LAVA || getTile(tileX, Math.floor(player.y+player.h/2-0.05))===T.LAVA){
		if(window.damageHero(8, {cause:'lava', launch:-7}) && player.hp>0) msg('🔥 Lawa parzy!');
	}
	if(SURVIVAL && SURVIVAL.updateDrowning){
		const headCovered = waterExposure.headCovered;
		const drown = SURVIVAL.updateDrowning(drowningState, dt, headCovered && !godMode);
		if(drown.warn) msg('Brakuje powietrza — wynurz się!');
		else if(drown.recovered) msg('Łapiesz oddech');
		if(drown.damage>0 && (!player.hpInvul || performance.now()>=player.hpInvul)){
			const dmg=Math.min(12, drown.damage);
			if(window.damageHero(dmg, {cause:'drowning', invulMs:450})){
				if(SURVIVAL.consumeDrowningDamage) SURVIVAL.consumeDrowningDamage(drowningState, dmg);
			}
		}
	}
	// Deep-water pressure shares the Twardosc crush capacity with cave-ins. The
	// load is the continuous stack of water over the hero's head; air pockets break it.
	if(SURVIVAL && SURVIVAL.updateWaterPressure){
		const headCovered=waterExposure.headCovered;
		const waterStack=headCovered ? waterStackAboveY(tileX,headY) : 0;
		const pressure=SURVIVAL.updateWaterPressure(
			waterPressureState,dt,waterStack,
			(MM.activeModifiers && MM.activeModifiers.crushResistBonus)||0,
			headCovered && !godMode
		);
		pressureVisual=pressure;
		const now=performance.now();
		if(pressure && pressure.warn && player.hp>0 && now-waterPressureMsgAt>2200){
			waterPressureMsgAt=now;
			msg('Cisnienie wody rosnie - Twardosc zwieksza limit glebin.');
		}
		if(pressure && pressure.damage>0 && (!player.hpInvul || now>=player.hpInvul || pressure.implode)){
			const maxHp=Number.isFinite(player.maxHp) ? player.maxHp : 100;
			const dmg=pressure.implode ? Math.max(maxHp+20,pressure.damage) : Math.min(24,pressure.damage);
			if(pressure.implode) player.hpInvul=0;
			if(window.damageHero(dmg,{cause:'water_pressure',invulMs:pressure.implode?900:700})){
				if(SURVIVAL.consumeWaterPressureDamage) SURVIVAL.consumeWaterPressureDamage(waterPressureState,dmg);
				if(player.hp>0 && now-waterPressureMsgAt>2200){
					waterPressureMsgAt=now;
					msg(pressure.implode ? 'Cisnienie glebin imploduje cialo!' : 'Cisnienie glebin miazdzy - wynurz sie albo zwieksz Twardosc!');
				}
			}
		}
	}
	updateWaterDistressFx(dt,inWater,pressureVisual);
	// Swim chill: treading open water (feet off the bottom) saps health after a
	// grace period — a lake dip is safe, an ocean crossing needs a wooden boat.
	if(SURVIVAL && SURVIVAL.updateSwimChill){
		const swimming = inWater && !player.onGround && !ridingFloatingBoat && !godMode;
		const chill = SURVIVAL.updateSwimChill(swimChillState, dt, swimming);
		if(chill.warn) msg('🥶 Woda wychładza — zbuduj łódź z drewna!');
		if(chill.damage>0 && (!player.hpInvul || performance.now()>=player.hpInvul)){
			const dmg=Math.min(8, chill.damage);
			if(window.damageHero(dmg, {cause:'water_chill', invulMs:600})){
				if(SURVIVAL.consumeSwimChillDamage) SURVIVAL.consumeSwimChillDamage(swimChillState, dmg);
			}
		}
	}
	const diveInput = climbDownInput && !ladderContact;
	const jumpNow=jumpHeldEarly;
	const groundedSolidInWater = inWater && player.onGround && groundTile!==T.AIR && groundTile!==T.WATER && isSolid(groundTile);
	const sideSolidInWater = inWater && heroTouchesSideBlock();
	const boatDeckInWater = inWater && player.onGround && !!heroBoatNow;
	const boatContactInWater = inWater && !boatDeckInWater && BOATS && BOATS.heroTouchingBoat && !!BOATS.heroTouchingBoat(player,{floating:true});
	const waterJumpSupport = groundedSolidInWater || sideSolidInWater || boatDeckInWater || boatContactInWater;
	const swimUpInput = inWater && jumpNow && !diveInput && !waterJumpSupport;
	const jumpPressedNow = jumpNow && !jumpPrev;
	const quicksandState = (TERRAIN_TRAPS && TERRAIN_TRAPS.updateHeroQuicksand)
		? TERRAIN_TRAPS.updateHeroQuicksand(dt,player,getTile,setTile,{jumpPressed:jumpPressedNow,jumpHeld:jumpNow,input})
		: null;

	// --- Water entry/exit splashes + dive bubbles (cosmetic only) ---
	if(VISUAL.animations && PARTICLES){
		if(inWater!==wasInWater && PARTICLES.spawnSplash){
			const speed=Math.abs(player.vy);
			if(speed>2.5){
				// find the water surface near the player (topmost water tile with air above)
				let surfY=Math.floor(player.y);
				for(let sy=Math.floor(headY)-1; sy<=Math.floor(footY)+1; sy++){
					if(getTile(tileX,sy)===T.WATER && getTile(tileX,sy-1)===T.AIR){ surfY=sy; break; }
				}
				PARTICLES.spawnSplash(player.x*TILE, surfY*TILE, Math.min(1, speed/14));
			}
		}
		if(subFrac>0.5 && PARTICLES.spawnBubble){
			bubbleAcc+=dt;
			if(bubbleAcc>0.22+Math.random()*0.4){
				bubbleAcc=0;
				PARTICLES.spawnBubble((player.x+(Math.random()-0.5)*0.4)*TILE, (headY+0.2)*TILE);
			}
		} else if(subFrac<=0.5){ bubbleAcc=0; }
	}
	// Surface-wave coupling: entering kicks the springs down, leaving pulls them up
	if(WATER && WATER.disturb){
		if(inWater!==wasInWater && Math.abs(player.vy)>0.8) WATER.disturb(tileX, player.vy*26);
		// Wake ripples while stroking along near the surface
		swimWakeAcc+=dt;
		if(inWater && Math.abs(player.vx)>1.6 && subFrac<0.95 && swimWakeAcc>0.09){
			swimWakeAcc=0;
			WATER.disturb(Math.floor(player.x+Math.sign(player.vx)*0.6), (Math.random()-0.5)*Math.abs(player.vx)*22);
		}
	}
	wasInWater=inWater;

	if(inWater){
		// Water drag scales with immersion and adds subtle variation
		const time=performance.now();
		const micro = Math.sin(time*0.0012 + player.x*0.37) * 0.15 + Math.sin(time*0.00047 + player.y*0.52)*0.1;
		const dragBase=2.2 + micro; // softer than before
		const drag = dragBase * (0.35 + subFrac*0.65) * (window.playerSpeedMultiplier || 2);
		player.vx -= player.vx * Math.min(1, drag*dt);
	}
	// Buffer the press (rising edge) and tick the assist timers
	if(jumpPressedNow && !(quicksandState && quicksandState.inQuicksand)) jumpBufferT=JUMP_BUFFER; else if(jumpBufferT>0) jumpBufferT=Math.max(0, jumpBufferT-dt);
	if(player.onGround) coyoteT=COYOTE_TIME; else if(coyoteT>0) coyoteT=Math.max(0, coyoteT-dt);
	let ladderJumped=false;
	if(jumpBufferT>0){
		const maxAir = (MM.activeModifiers && typeof MM.activeModifiers.maxAirJumps==='number')? MM.activeModifiers.maxAirJumps : 0; // additional beyond ground jump
		const totalAllowed = 1 + maxAir; // total sequential presses allowed while airborne
		const jumpMult = ((MM.activeModifiers && MM.activeModifiers.jumpPowerMult)||1) * (window.playerSpeedMultiplier || 2) * turboJumpMult;
		if(ladderContact && keys[' ']){
			player.vy=MOVE.JUMP * jumpMult * 0.78; player.onGround=false; player.jumpCount=1; jumpBufferT=0; coyoteT=0; ladderJumped=true; ladderReleaseT=0.2;
		}
		else if(boatContactInWater && BOATS && BOATS.boardHeroFromWater && BOATS.boardHeroFromWater(player,{getTile}).ok){
			jumpBufferT=0; coyoteT=COYOTE_TIME; swimBuoySmooth=0;
		}
		else if((player.onGround && (!inWater || groundedSolidInWater || boatDeckInWater)) || (inWater && sideSolidInWater) || (!inWater && (godMode || (coyoteT>0 && player.jumpCount===0)))){ // primary jump (incl. coyote window after a ledge)
			player.vy=MOVE.JUMP * jumpMult; player.onGround=false; player.jumpCount=1; jumpBufferT=0; coyoteT=0;
		}
		else if(!inWater && player.jumpCount>0 && player.jumpCount < totalAllowed){
			// mid-air extra jump
			player.vy=MOVE.JUMP * jumpMult; player.jumpCount++; jumpBufferT=0;
		}
		else if(inWater){
			jumpBufferT=0;
		}
		// otherwise: keep the press buffered — landing within the window fires the jump
	}
	const jumpArcControlAllowed=!inWater && (!ladderContact || ladderJumped) && !player.onGround && player.jumpCount>0;
	if(jumpArcControlAllowed){
		const downCancel=heroDropThroughInput() && !ladderContact;
		if(downCancel){
			const gravForCut=MOVE.GRAV * (window.playerSpeedMultiplier || 2);
			player.vy=applyJumpArcControl(player.vy, gravForCut, {cancel:true});
			jumpBufferT=0;
		}
	}
	jumpPrev=jumpNow;
	if(WIND && WIND.applyToHero) WIND.applyToHero(player,dt,getTile,{inWater,godMode,groundSpeedCap:MOVE.MAX*moveMult*(groundTraction.speed||1)});

	if(ladderContact && !ladderJumped && ladderReleaseT<=0){
		const climbDir=(climbDownInput?1:0)-(climbUpInput?1:0);
		const climbSpeed=3.6*Math.sqrt(Math.max(0.5, window.playerSpeedMultiplier || 2));
		player.vy=climbDir*climbSpeed;
		if(climbDir===0) player.vx-=player.vx*Math.min(1,6*dt);
		player.onGround=false;
		player.jumpCount=0;
		coyoteT=COYOTE_TIME;
		swimBuoySmooth=0;
	} else if(inWater){
		// Stronger buoyancy with PD control so player reliably floats at surface.
		const time=performance.now();
		const desiredSub = diveInput? 0.88 : (swimUpInput?0.36:0.66); // target fraction of body submerged
		const neutralPoint = 0.50; // submersion where gravity mostly neutralizes
		const gravScale = 1 - subFrac*0.82; // deeper -> less gravity
		const gravMult = (window.playerSpeedMultiplier || 2);
		player.vy += MOVE.GRAV * gravMult * gravScale * dt;
		// PD controller: proportional on immersion error, derivative on vertical velocity
		const error = desiredSub - subFrac; // positive -> need to sink more, negative -> need to rise
		const Kp = diveInput? 55 : (swimUpInput?82:70); // strong proportional for crisp float/swim
		const Kd = diveInput? 7 : (swimUpInput?8:9);  // damping
		let buoyAccel = (error * Kp) - (player.vy * Kd);
		// Additional lift when past neutral and not diving (prevents creeping downward)
		const excess = subFrac - neutralPoint; if(excess>0 && !diveInput) buoyAccel -= excess * 30;
		// Micro wave variation
		const wave = Math.sin(time*0.0012 + player.x*0.3)*0.6 + Math.sin(time*0.00047 + player.x*0.07 + player.y*0.11)*0.4;
		buoyAccel += wave * 0.8; // ~ -0.8..0.8
		if(diveInput) buoyAccel *= 0.5; // still allow descent when diving
		if(swimUpInput && subFrac>0.18){
			const swimPowerMult = Math.sqrt(Math.max(0.5, (window.playerSpeedMultiplier || 2))) * ((MM.activeModifiers && MM.activeModifiers.jumpPowerMult)||1);
			const strokeAccel = 18 * (0.45 + 0.55*subFrac) * swimPowerMult;
			buoyAccel -= strokeAccel;
			if(player.vy>0) player.vy -= Math.min(player.vy, strokeAccel*0.75*dt);
		}
		// Low-pass filter final buoyancy for smoothness
		swimBuoySmooth += (buoyAccel - swimBuoySmooth) * Math.min(1, dt*6);
		player.vy += swimBuoySmooth * dt;
		if(diveInput){ player.vy += 5*dt; }
		// Hard surface assist: if head is near surface & not diving, clamp downward motion strongly
		const headTile = getTile(tileX, Math.floor(headY));
		const aboveHead = getTile(tileX, Math.floor(headY)-1);
		if(!diveInput && headTile===T.WATER && aboveHead===T.AIR){
			if(player.vy>0.4) player.vy -= Math.min(player.vy, 16*dt); // fast stop sinking
			// slight upward bias to keep head clear
			player.vy -= 4.5*dt;
			player.vx -= player.vx * 0.15 * dt;
		}
		// Clamp water speed while buoyancy keeps the swimmer afloat.
		const maxDown=swimUpInput?2.0:2.8, maxUp=swimUpInput?10.5:9.0; if(player.vy>maxDown) player.vy=maxDown; if(player.vy<-maxUp) player.vy=-maxUp;
	} else {
		// Normal gravity when not in water
		const gravMult = (window.playerSpeedMultiplier || 2);
		player.vy += MOVE.GRAV*gravMult*dt; if(player.vy>20*gravMult) player.vy=20*gravMult; swimBuoySmooth=0; // reset filter
	}

	// A pile resting on the hero is a ceiling: block upward motion so jump-spam
	// cannot ratchet him up through his own debris (each jump used to settle a
	// block under his feet, extruding a 1-wide chimney). Sideways stays free.
	if(heroPileWeight>0 && player.vy<0 && !godMode){
		player.vy=0;
		if(jumpNow || climbUpInput){
			const now=performance.now();
			if(now-pileMsgAt>2500){ pileMsgAt=now; msg('📦 Rumowisko przygniata cię z góry — odsuń się!'); }
		}
	}

	// Integrate & collisions — substepped so high speed multipliers / low FPS cannot tunnel through tiles
	{
		const maxDisp=Math.max(Math.abs(player.vx),Math.abs(player.vy))*dt;
		const steps=Math.min(12, Math.max(1, Math.ceil(maxDisp/0.4)));
		const sdt=dt/steps;
		for(let i=0;i<steps;i++){
			const px=player.x; player.x += player.vx*sdt; collide('x',px);
			const py=player.y; player.y += player.vy*sdt; collide('y',py);
			if(player.vx===0 && player.vy===0) break;
		}
	}
	// Boats are rigid platforms: the hero lands on deck and rides the raft's drift.
	// Boat drift happens after normal player integration, so sweep that carried
	// displacement through terrain too; otherwise a raft can slide the hero into
	// a shoreline block and the next frame starts already embedded.
	const boatPrevX=player.x;
	const boatPrevY=player.y;
	try{ if(BOATS && BOATS.collideHero) BOATS.collideHero(player, dt); }catch(e){}
	if(Math.abs(player.x-boatPrevX)>1e-6) collide('x',boatPrevX);
	if(Math.abs(player.y-boatPrevY)>1e-6) collide('y',boatPrevY);
	// Boss monsters are rigid: the hero lands on, stands on and is pushed by them
	try{ if(BOSSES && BOSSES.collideHero) BOSSES.collideHero(player, dt); }catch(e){}
	try{ if(GUARDIANS && GUARDIANS.collideHero) GUARDIANS.collideHero(player, dt); }catch(e){}
	try{ if(UNDERGROUND && UNDERGROUND.collideHero) UNDERGROUND.collideHero(player, dt); }catch(e){}
	try{ if(SKY_GUARDIAN && SKY_GUARDIAN.collideHero) SKY_GUARDIAN.collideHero(player, dt); }catch(e){}
	try{ if(CENTER_GUARDIAN && CENTER_GUARDIAN.collideHero) CENTER_GUARDIAN.collideHero(player, dt); }catch(e){}

	ensureChunks();
}
// Tiles below the world bottom act as bedrock so a mined-out bottom row can't drop the player into the void
function heroTrapdoorOpenForCollision(t,x,y,axis){
	if(!isTrapdoorTile(t)) return false;
	const opening=((player.vy||0)<0 || heroDropThroughInput());
	if(axis==='y') return opening;
	if(axis!=='x' || !opening) return false;
	const left=player.x-player.w/2, right=player.x+player.w/2;
	const top=player.y-player.h/2, bottom=player.y+player.h/2;
	return right>x+0.02 && left<x+0.98 && bottom>y-0.08 && top<y+1.08;
}
function solidAt(x,y,axis){
	if(y>=worldMaxY()) return true;
	if(y<worldMinY()) return false;
	const t=getTile(x,y);
	if(hasLadderAt(x,y)) return false;
	if(heroTrapdoorOpenForCollision(t,x,y,axis)) return false;
	return !isHeroPassableTile(t);
}
// Swept per-axis resolution: only tiles the hero *entered during this substep*
// (his pre-move span did not overlap them) push back. Tiles that already
// overlapped are embedded — a collapse solidified around him — and belong to
// updateHeroCrush(); resolving them here is what used to teleport him 1–2 tiles
// diagonally out of a pile. OVER_EPS keeps the 0.001 resting margin from
// reading as an overlap.
const COLLIDE_OVER_EPS=1e-4;
function collide(axis, prevC){
	const w=player.w/2, h=player.h/2;
	if(axis==='x'){
		const prev=(typeof prevC==='number' && isFinite(prevC)) ? prevC : player.x;
		const moved=player.x-prev;
		const dir=moved>COLLIDE_OVER_EPS?1:moved<-COLLIDE_OVER_EPS?-1:(player.vx>0?1:player.vx<0?-1:0);
		const prevL=prev-w, prevR=prev+w;
		const minX=Math.floor(player.x-w), maxX=Math.floor(player.x+w), minY=Math.floor(player.y-h), maxY=Math.floor(player.y+h);
		// Resolve against the least-penetrating tile only; applying every tile in scan
		// order could push the player out one side and back into a neighbour.
		let target=player.x, hit=false;
		for(let y=minY;y<=maxY;y++){
			for(let x=minX;x<=maxX;x++){
				if(!solidAt(x,y,axis)) continue;
				if(prevR>x+COLLIDE_OVER_EPS && prevL<x+1-COLLIDE_OVER_EPS) continue; // embedded before the move
				if(dir>0){ const cand=x - w - 0.001; if(!hit || cand<target) target=cand; hit=true; }
				else if(dir<0){ const cand=x + 1 + w + 0.001; if(!hit || cand>target) target=cand; hit=true; }
			}
		}
		if(hit){ player.x=target; player.vx=0; }
	} else {
		const prev=(typeof prevC==='number' && isFinite(prevC)) ? prevC : player.y;
		const moved=player.y-prev;
		const dir=moved>COLLIDE_OVER_EPS?1:moved<-COLLIDE_OVER_EPS?-1:(player.vy>0?1:player.vy<0?-1:0);
		const prevT=prev-h, prevB=prev+h;
		const minX=Math.floor(player.x-w), maxX=Math.floor(player.x+w), minY=Math.floor(player.y-h), maxY=Math.floor(player.y+h);
		const wasGround=player.onGround;
		player.onGround=false;
		let target=player.y, hit=false, landed=false, landingTile=null;
		for(let y=minY;y<=maxY;y++){
			for(let x=minX;x<=maxX;x++){
				if(!solidAt(x,y,axis)) continue;
				if(prevB>y+COLLIDE_OVER_EPS && prevT<y+1-COLLIDE_OVER_EPS) continue; // embedded before the move
				if(dir>0){ const cand=y - h - 0.001; if(!hit || cand<target){ target=cand; landingTile={x,y}; } hit=true; landed=true; }
				else if(dir<0){ const cand=y + 1 + h + 0.001; if(!hit || cand>target) target=cand; hit=true; }
			}
		}
		if(hit){
			player.y=target; player.vy=0; if(landed) player.onGround=true;
			if(landed && landingTile && getTile(landingTile.x,landingTile.y)===T.SPRING_PLATFORM && SPRING_PLATFORMS && SPRING_PLATFORMS.launchHero){
				const launched=SPRING_PLATFORMS.launchHero(player,landingTile.x,landingTile.y,getElectricNetworkTile,{dynamo:DYNAMO,teleporters:TELEPORTERS});
				if(launched){
					player.onGround=false;
					coyoteT=0;
					jumpBufferT=0;
					if(launched.powered) noteSaveActivity();
					try{ if(PARTICLES && PARTICLES.spawnEnergyAbsorb) PARTICLES.spawnEnergyAbsorb((landingTile.x+0.5)*TILE,(landingTile.y+0.35)*TILE,player.x*TILE,(player.y-0.25)*TILE,launched.powered?1.25:0.45); }catch(e){}
					try{ if(AUDIO && AUDIO.play) AUDIO.play(launched.powered?'charge':'jump'); }catch(e){}
				}
			}
		}
		if(player.onGround && !wasGround){
			player.jumpCount=0;
		}
	}
}

// Mgła / widoczność moved to engine/fog.js. Ordinary eyes reveal only line-of-sight;
// special/x-ray style eyes keep the older "pierce through blocks" reveal.
function currentEyeItem(){ return (MM.inventory && MM.inventory.equippedItem)? MM.inventory.equippedItem('eyes'):null; }
function currentEyeId(){ const eye=currentEyeItem(); return (eye && eye.id) || (MM.customization && MM.customization.eyeStyle) || 'bright'; }
function visionPiercesBlocks(){
	const eye=currentEyeItem();
	const id=currentEyeId();
	return id==='glow' || id==='gold' || (eye && eye.unique==='alien_sight');
}
function visionRemembersMap(){ return true; }
function revealAround(){
	const m=MM.activeModifiers||{};
	const r = (typeof m.visionRadius==='number')? m.visionRadius : 10;
	if(FOG && FOG.revealAround) FOG.revealAround(player.x, player.y, r, {
		lineOfSight: !visionPiercesBlocks(),
		rememberSeen: visionRemembersMap(),
		getTile,
		blocksSight: (t)=>isSolid(t)
	});
}
function revealDebugTravelArea(){
	if(!FOG) return;
	const viewW=(TILE>0 && zoom>0) ? W/(TILE*zoom) : 80;
	const viewH=(TILE>0 && zoom>0) ? H/(TILE*zoom) : 48;
	const x0=Math.floor(camX)-6;
	const x1=Math.ceil(camX+viewW)+6;
	const y0=Math.max(worldMinY(),Math.floor(camY)-6);
	const y1=Math.min(worldMaxY()-1,Math.ceil(camY+viewH)+6);
	const opts={
		originX:Math.floor(player.x),
		originY:Math.floor(player.y),
		lineOfSight:true,
		rememberSeen:true,
		getTile,
		blocksSight:(t)=>isSolid(t)
	};
	if(FOG.revealRect) FOG.revealRect(x0,y0,x1,y1,opts);
	else if(FOG.revealAround) FOG.revealAround(player.x,player.y,Math.ceil(Math.hypot(viewW,viewH)*0.55),opts);
}

// --- Pointer → world conversion ---
// The canvas context is pre-scaled by DPR (setTransform in resize) and client coords are
// already CSS pixels, so the only factors between screen and world are zoom and camera.
function screenToWorldTile(clientX,clientY){
	const rect=canvas.getBoundingClientRect();
	const mx=(clientX-rect.left)/zoom + camX*TILE;
	const my=(clientY-rect.top)/zoom + camY*TILE;
	return {tx:Math.floor(mx/TILE), ty:Math.floor(my/TILE)};
}
// Fractional variant for weapon aiming (arrows / flame stream need sub-tile direction)
function screenToWorld(clientX,clientY){
	const rect=canvas.getBoundingClientRect();
	return { x:(clientX-rect.left)/(zoom*TILE) + camX, y:(clientY-rect.top)/(zoom*TILE) + camY };
}
// Last known cursor position (client coords) so mining/ghost can re-aim while the camera moves
const lastPointer={x:0,y:0,has:false};
const hoverInfoEl=document.getElementById('hoverInfo');
let hoverInfoKey='';
function hoverTargetInfo(){
	if(!hoverInfoEl || !lastPointer.has || pinch) return null;
	const p=screenToWorldTile(lastPointer.x,lastPointer.y);
	if(p.ty<worldMinY()) return {key:'sky:'+p.tx+','+p.ty,label:'Niebo',color:'#8bbff5'};
	if(p.ty>=worldMaxY()) return {key:'bottom:'+p.tx+','+p.ty,label:'Dno swiata',color:'#343944'};
	const t=getTile(p.tx,p.ty);
	const overs=getRenderInfrastructureTiles(p.tx,p.ty);
	const topOver=getRenderInfrastructureTile(p.tx,p.ty);
	const surface=(WORLDGEN && WORLDGEN.surfaceHeight)? WORLDGEN.surfaceHeight(p.tx) : -1;
	const hidden=!fogRevealAll() && !worldTileDiscovered(p.tx,p.ty) && (t!==T.AIR || p.ty>surface);
	if(hidden) return {key:'hidden:'+p.tx+','+p.ty,label:'Nieodkryte',color:'#2d3744'};
	if(overs.length) return {key:p.tx+','+p.ty+':'+t+':'+overs.join('|'),label:overs.map(tileLabel).join(' + ')+' / '+tileLabel(t),color:tileHoverColor(topOver)};
	if(isRespawnTotemAt(p.tx,p.ty)) return {key:p.tx+','+p.ty+':respawnTotem',label:'Totem odrodzenia',color:'#e23b4e'};
	return {key:p.tx+','+p.ty+':'+t,label:tileLabel(t),color:tileHoverColor(t)};
}
function updateHoverInfo(){
	if(!hoverInfoEl) return;
	const info=hoverTargetInfo();
	if(!info){
		if(hoverInfoKey!==''){ hoverInfoKey=''; hoverInfoEl.classList.remove('show'); hoverInfoEl.textContent=''; }
		return;
	}
	if(info.key===hoverInfoKey) return;
	hoverInfoKey=info.key;
	hoverInfoEl.textContent=info.label;
	hoverInfoEl.style.setProperty('--hover-color',info.color);
	hoverInfoEl.classList.add('show');
}
// Kopanie (kierunkowe + wskazywane kursorem)
const MINE_REACH=3; // Chebyshev tile distance for cursor mining
const MELEE_REACH=1; // melee damage stays adjacent; stronger hits add damage, not reach
let mining=false,mineTimer=0,mineTx=0,mineTy=0,meteorPickSparkT=0; const mineBtn=document.getElementById('mineBtn');
let mineBoatTarget=null; // {boatId,dx,dy} — raft planks are entities, mined via their own branch
function stopMining(){ mining=false; mineBoatTarget=null; mineBtn.classList.remove('on'); }
// Raft planks dismantle through the normal mining flow (wood-tile pace) and give
// the wood back. The target is tracked by boat id + local cell so a drifting raft
// keeps the right plank under the pick.
function boatPlankAt(tx,ty){
	if(!BOATS || !BOATS.cellAt) return null;
	const hit=BOATS.cellAt(tx+0.5,ty+0.5);
	return hit ? {boatId:hit.boat.id, dx:hit.cell.dx, dy:hit.cell.dy, boat:hit.boat} : null;
}
function tryStartBoatMine(tx,ty,opts){
	const hit=boatPlankAt(tx,ty);
	if(!hit) return false;
	if(!canPhysicallyTargetTile(tx,ty)){
		if(!(opts&&opts.quiet)){
			const reason=blockedTargetReason(tx,ty);
			if(reason) msg(reason);
		}
		return true;
	}
	mining=true; mineTimer=0; mineTx=tx; mineTy=ty; mineBoatTarget=hit; mineBtn.classList.add('on');
	if(godMode) breakBoatPlank();
	return true;
}
function resolveBoatPlankPoint(){
	if(!mineBoatTarget || !BOATS || !BOATS.heroBoat) return null;
	const b=(BOATS._debug && BOATS._debug.boats ? BOATS._debug.boats() : []).find(x=>x.id===mineBoatTarget.boatId);
	if(!b || !b.cells.some(c=>c.dx===mineBoatTarget.dx && c.dy===mineBoatTarget.dy)) return null;
	return {x:b.x+mineBoatTarget.dx+0.5, y:b.y+mineBoatTarget.dy+0.5};
}
function breakBoatPlank(){
	const p=resolveBoatPlankPoint();
	if(!p){ stopMining(); return false; }
	const res=BOATS.removeCellAt(p.x,p.y);
	if(!res){ stopMining(); return false; }
	awardTileDrops(INFO[T.WOOD]);
	spawnBurst(p.x*TILE,p.y*TILE,0,{color:'#8b5a2b'});
	updateInventory(); updateHotbarCounts(); saveState();
	try{ if(MM.audio && MM.audio.play) MM.audio.play('break'); }catch(e){}
	stopMining();
	return true;
}
function updateBoatMining(dt){
	const p=resolveBoatPlankPoint();
	if(!p){ stopMining(); resumeHeldMining(); return; }
	mineTx=Math.floor(p.x); mineTy=Math.floor(p.y);
	if(!withinReach(mineTx,mineTy,MINE_REACH)){ stopMining(); return; }
	if(!canPhysicallyTargetTile(mineTx,mineTy)){ stopMining(); resumeHeldMining(); return; }
	if(godMode){ breakBoatPlank(); return; }
	try{ if(MM.audio && MM.audio.play) MM.audio.play('dig'); }catch(e){}
	const mineMult=(MM.activeModifiers && MM.activeModifiers.mineSpeedMult)||1;
	mineTimer += dt * tools[player.tool] * mineMult;
	if(mineTimer>=Math.max(0.1,INFO[T.WOOD].hp/6)) breakBoatPlank();
}
function withinReach(tx,ty,reach){ const px=Math.floor(player.x), py=Math.floor(player.y); return Math.abs(tx-px)<=reach && Math.abs(ty-py)<=reach; }
function templeDisturbanceKindForTile(t){
	const info=INFO[t];
	if(info && info.chestTier) return 'treasure';
	if(t===T.GOLD_ORE || t===T.DIAMOND) return 'treasure';
	if(t===T.STONE || t===T.OBSIDIAN || t===T.TORCH || t===T.WOOD || isLeaf(t) || t===T.GLOWSHROOM) return 'structure';
	return null;
}
function notifyTempleDisturbance(kind,tx,ty,oldTile,newTile){
	if(!kind || !MOBS || !MOBS.notifyTempleDisturbed) return false;
	let temple=null;
	try{ temple=RUINS.templeAt(tx,ty,{tile:oldTile}); }catch(e){ temple=null; }
	if(!temple && WORLD && typeof WORLD.surfaceTempleAt==='function'){
		try{ temple=WORLD.surfaceTempleAt(tx,ty,{tile:oldTile}); }catch(e){ temple=null; }
	}
	if(!temple) return false;
	const res=MOBS.notifyTempleDisturbed(tx,ty,{kind,temple,oldTile,newTile,getTile,player});
	if(res && (res.alerted||res.spawned)){
		try{ msg(kind==='treasure' ? 'Straznicy swiatyni bronia skarbu!' : 'Straznicy swiatyni bronia budowli!'); }catch(e){}
	}
	return !!(res && (res.alerted||res.spawned));
}
// Opening chests is shared between click handling and directional mining so the ⛏️
// button can never silently destroy a chest together with its loot.
function tryOpenChestAt(tx,ty){
	const oldTile=getTile(tx,ty);
	const info=INFO[oldTile];
	if(!info || !info.chestTier || !CHESTS) return false;
	const res=CHESTS.openChestAt(tx,ty);
	if(res){
		notifyTempleDisturbance('treasure',tx,ty,oldTile,T.AIR);
		try{ if(MM.audio && MM.audio.play) MM.audio.play('chest'); }catch(e){}
		lastChestOpen={t:performance.now(),x:tx,y:ty};
		if(!MM.onLootGained && window.updateDynamicCustomization) window.updateDynamicCustomization();
		const ownedItems=(MM.inventory && MM.inventory.getItem) ? res.items.filter(it=>MM.inventory.getItem(it.id)) : res.items;
		let upgradeText='';
		if(MM.inventory && MM.inventory.compareItem){
			const best=ownedItems.map(it=>MM.inventory.compareItem(it.id)).filter(Boolean).sort((a,b)=>{
				const ar=Math.max(a.bestDelta==null?999:a.bestDelta, a.equippedDelta==null?-999:a.equippedDelta);
				const br=Math.max(b.bestDelta==null?999:b.bestDelta, b.equippedDelta==null?-999:b.equippedDelta);
				return br-ar;
			})[0];
			if(best && (best.bestDelta==null || best.bestDelta>0 || best.isEquippedUpgrade)){
				const delta=best.bestDelta!=null ? best.bestDelta : best.equippedDelta;
				upgradeText=delta==null ? ' | Nowa najlepsza opcja: '+(best.item.name||best.item.id) : ' | Ulepszenie '+(delta>0?'+'+delta:'')+': '+(best.item.name||best.item.id);
			}
		}
		msg((ownedItems.length===res.items.length
			? 'Skrzynia '+info.chestTier+': +'+ownedItems.length+' przedm. (I aby zobaczyć)'
			: 'Skrzynia '+info.chestTier+': torba pełna, dodano '+ownedItems.length+'/'+res.items.length)+upgradeText);
		spawnBurst((tx+0.5)*TILE,(ty+0.5)*TILE, info.chestTier);
	}
	return !!res;
}
function tryOpenInvasionCacheAt(tx,ty){
	if(getTile(tx,ty)!==T.INVASION_CACHE || !INVASIONS || !INVASIONS.openCacheAt) return false;
	const ok=INVASIONS.openCacheAt(tx,ty,{inv, inventory:MM.inventory, getTile, setTile, updateInventory, notifyStructureTileChanged, saveState, msg, spawnBurst});
	if(ok){
		try{ if(MM.audio && MM.audio.play) MM.audio.play('chest'); }catch(e){}
		noteSaveActivity();
		saveState();
	}
	return !!ok;
}
function vendingLootText(d){
	if(!d) return 'nic';
	const label=(RES_LABEL[d.key] || d.label || d.key);
	return d.n+'x '+label;
}
function currentGameDayFloat(){
	const m=(SEASONS && SEASONS.metrics) ? SEASONS.metrics() : null;
	return m && Number.isFinite(Number(m.dayFloat)) ? Number(m.dayFloat) : 1;
}
function tryUseVendingAt(tx,ty){
	if(getTile(tx,ty)!==T.VENDING_MACHINE || !VENDING || !VENDING.vendAt) return false;
	if(!withinReach(tx,ty,MINE_REACH)){ msg('Za daleko'); return true; }
	const addResource=(key,n)=>{
		const amount=Math.max(0,n|0);
		if(!key || amount<=0 || !RESOURCE_KEY_SET.has(key)) return false;
		inv[key]=(inv[key]||0)+amount;
		return true;
	};
	const onBreak=(x,y)=>{
		notifyStructureTileChanged(x,y,T.VENDING_MACHINE,T.AIR);
		if(FIRE && FIRE.wakeLavaAround) FIRE.wakeLavaAround(x,y,getTile,{radius:22});
		if(FALLING && FALLING.onTileRemoved) FALLING.onTileRemoved(x,y);
		if(WATER && WATER.onTileChanged) WATER.onTileChanged(x,y,getTile);
	};
	const res=VENDING.vendAt(tx,ty,{getTile,setTile,inv,addResource,onBreak,dynamo:DYNAMO,solar:SOLAR,teleporters:TELEPORTERS,getElectricNetworkTile,gameDayFloat:currentGameDayFloat});
	if(!res || !res.ok){
		if(res && res.message) msg(res.message);
		else msg('Automat milczy');
		updateInventory();
		return true;
	}
	const prize=vendingLootText(res.loot);
	const next=res.powered && !res.broke ? ' | nastepne losowanie jutro' : '';
	const tail=res.broke ? ' | automat pekl i wyplul zlomy' : (next+' | zapas '+res.usesLeft+'/'+(VENDING.MAX_USES||10));
	msg((res.powered?'Automat':'Stary automat')+': '+prize+tail);
	try{ if(MM.audio && MM.audio.play) MM.audio.play(res.broke?'break':'chest'); }catch(e){}
	spawnBurst((tx+0.5)*TILE,(ty+0.5)*TILE,res.loot && res.loot.tier==='rare'?'epic':(res.loot && res.loot.tier==='value'?'rare':'common'));
	updateInventory();
	noteSaveActivity();
	saveState();
	return true;
}
function mineTileIdAt(tx,ty){
	const over=getInfrastructureTile(tx,ty);
	if(over!==T.AIR) return over;
	const front=getTile(tx,ty);
	if(front!==T.AIR && !isGasTileId(front)) return front;
	const bg=getConstructionBackgroundTile(tx,ty);
	if(bg!==T.AIR) return bg;
	return front;
}
function mineInfoForId(t){ return INFO[t]; }
function miningTargetsConstructionBackground(tx,ty){
	if(getInfrastructureTile(tx,ty)!==T.AIR) return false;
	const front=getTile(tx,ty);
	return (front===T.AIR || isGasTileId(front)) && getConstructionBackgroundTile(tx,ty)!==T.AIR;
}
function isUnmineableTile(t){ return !!(INFO[t] && INFO[t].unmineable); }
function isOceanBasinBedrockAt(tx,ty,t){
	if(t!==T.BEDROCK || !Number.isFinite(tx) || !Number.isFinite(ty)) return false;
	if(!WORLDGEN || typeof WORLDGEN.oceanSealTop!=='function') return false;
	const sealTop=WORLDGEN.oceanSealTop(Math.floor(tx));
	return Number.isFinite(sealTop) && Math.floor(ty)>=sealTop;
}
function canMineBedrockWithCurrentTool(t,tx,ty){
	return t===T.BEDROCK && player.tool==='bedrock' && hasBedrockPick() && !isOceanBasinBedrockAt(tx,ty,t);
}
function canMineTileWithCurrentTool(t,tx,ty){ return !isUnmineableTile(t) || canMineBedrockWithCurrentTool(t,tx,ty); }
function unmineableReason(t,tx,ty){
	if(isOceanBasinBedrockAt(tx,ty,t)) return 'Skała macierzysta pod oceanem jest nienaruszalna';
	if(t===T.BEDROCK) return hasBedrockPick() ? 'Wybierz kilof macierzysty klawiszem 1' : 'Skala macierzysta wymaga kilofa macierzystego';
	return tileLabel(t)+' jest nie do ruszenia';
}
function companionHarvestAssignableTile(t){
	const info=INFO[t];
	return !!info && t!==T.AIR && !isGasTileId(t) && !info.unmineable && !info.chestTier && !info.cache && !info.machine && !info.story;
}
function assignCompanionHarvestTargetAt(tx,ty){
	if(!COMPANIONS || !COMPANIONS.awaitingHarvestTarget || !COMPANIONS.awaitingHarvestTarget()) return false;
	const t=mineTileIdAt(tx,ty);
	if(!companionHarvestAssignableTile(t)){
		msg('Pomocnicy potrzebuja zwyklego, kopalnego materialu.');
		return true;
	}
	COMPANIONS.assignHarvestTarget(t,tileLabel(t));
	noteSaveActivity();
	saveState();
	return true;
}
// Begin mining a specific tile (cursor-driven). Returns true when mining started.
function startMineAt(tx,ty,opts){
	const quiet=opts&&opts.quiet;
	if(!isToolMode()) return false;
	if(!withinReach(tx,ty,MINE_REACH)){ if(!quiet) msg('Za daleko'); return false; }
	if(tryStartBoatMine(tx,ty,opts)) return true;
	const t=mineTileIdAt(tx,ty);
	if(t===T.AIR || isGasTileId(t)) return false;
	if(!canMineTileWithCurrentTool(t,tx,ty)){ if(!quiet) msg(unmineableReason(t,tx,ty)); return false; }
	const blocked=blockedTargetReason(tx,ty);
	if(blocked){ if(!quiet) msg(blocked); return false; }
	if(t===T.INVASION_CACHE){ if(quiet) return false; return tryOpenInvasionCacheAt(tx,ty); }
	if(t===T.VENDING_MACHINE){ if(quiet) return false; return tryUseVendingAt(tx,ty); }
	const info=mineInfoForId(t);
	if(info && info.chestTier){ if(quiet) return false; return tryOpenChestAt(tx,ty); }
	mining=true; mineTimer=0; mineTx=tx; mineTy=ty; mineBtn.classList.add('on');
	if(godMode) instantBreak();
	return true;
}
function startMine(opts){
	const quiet=opts&&opts.quiet;
	if(!isToolMode()){ if(!quiet) msg('Wybierz 1, aby kopać'); return; }
	const tx=Math.floor(player.x + mineDir.dx + (mineDir.dx>0?player.w/2:mineDir.dx<0?-player.w/2:0));
	const ty=Math.floor(player.y + mineDir.dy);
	if(tryStartBoatMine(tx,ty,opts)) return;
	const t=mineTileIdAt(tx,ty);
	if(t===T.AIR || isGasTileId(t)) return;
	if(!canMineTileWithCurrentTool(t,tx,ty)){ if(!quiet) msg(unmineableReason(t,tx,ty)); return; }
	const blocked=blockedTargetReason(tx,ty);
	if(blocked){ if(!quiet) msg(blocked); return; }
	if(t===T.INVASION_CACHE){ tryOpenInvasionCacheAt(tx,ty); return; }
	if(t===T.VENDING_MACHINE){ tryUseVendingAt(tx,ty); return; }
	const info=mineInfoForId(t);
	if(info && info.chestTier){ tryOpenChestAt(tx,ty); return; }
	mining=true; mineTimer=0; mineTx=tx; mineTy=ty; mineBtn.classList.add('on');
	if(godMode) instantBreak();
}
mineBtn.addEventListener('pointerdown',e=>{ e.preventDefault(); noteSaveActivity(); if(!isToolMode()){ msg('Wybierz 1, aby kopać'); return; } mineBtnHeld=true; startMine(); });
['pointerup','pointerleave','pointercancel'].forEach(evName=> mineBtn.addEventListener(evName,()=>{ noteSaveActivity(); mineBtnHeld=false; stopMining(); }));
// Weapon fire button (touch): hold to use the equipped weapon in the facing direction
const fireBtn=document.getElementById('fireBtn');
function releaseTouchWeaponFire(cancel){
	if(!fireBtnHeld) return false;
	const aim={x:player.x+player.facing*5, y:player.y-0.4};
	const it=activeWeaponItem();
	let used=false;
	if(WEAPONS){
		if(cancel && WEAPONS.cancelHeld) WEAPONS.cancelHeld();
		else if(WEAPONS.releaseHeld) used=!!WEAPONS.releaseHeld(player, aim.x, aim.y);
	}
	if(used) notifyInvasionWeaponUse(it,{released:true});
	return true;
}
if(fireBtn){
	fireBtn.addEventListener('pointerdown',e=>{ e.preventDefault(); noteSaveActivity(); if(!activeWeaponItem()){ msg('Wybierz broń — stuknij pasek broni (2–4)'); return; } fireBtnHeld=true; fireBtn.classList.add('on'); });
	['pointerup','pointerleave'].forEach(evName=> fireBtn.addEventListener(evName,()=>{ noteSaveActivity(); releaseTouchWeaponFire(false); fireBtnHeld=false; fireBtn.classList.remove('on'); }));
	fireBtn.addEventListener('pointercancel',()=>{ noteSaveActivity(); releaseTouchWeaponFire(true); fireBtnHeld=false; fireBtn.classList.remove('on'); });
	// Icon reflects the equipped weapon class
	function refreshFireBtn(){
		const it=activeWeaponItem();
		const type=(it && it.weaponType)||'melee';
		fireBtn.textContent= type==='bow'? '🏹' : type==='flame'? '🔥' : type==='hose'? '💧' : type==='gas'? '☠️' : type==='electric'? '⚡' : '⚔️';
		fireBtn.title='Użyj broni'+(it? ' – '+(it.name||it.id):'');
	}
	refreshFireBtn();
	window.addEventListener('mm-customization-change',refreshFireBtn);
}
// Touch ult trigger: the PPM-ult without a right button. Aims in the facing
// direction like the fire button; charge state is fed by updateWeaponGauges.
const ultBtn=document.getElementById('ultBtn');
if(ultBtn){
	ultBtn.addEventListener('pointerdown',e=>{
		e.preventDefault(); noteSaveActivity();
		const it=activeWeaponItem();
		if(!it){ msg('Wybierz broń — stuknij pasek broni (2–4)'); return; }
		const aim={x:player.x+player.facing*5, y:player.y-0.4};
		if(tryWeaponUltOrDefend(player, aim.x, aim.y, it, e.pointerId, 'touch')) ultBtn.classList.add('on');
	});
	['pointerup','pointerleave'].forEach(evName=>ultBtn.addEventListener(evName,e=>{ noteSaveActivity(); endHeroDefense(e.pointerId,{cancel:false}); ultBtn.classList.remove('on'); }));
	ultBtn.addEventListener('pointercancel',e=>{ noteSaveActivity(); endHeroDefense(e.pointerId,{cancel:true}); ultBtn.classList.remove('on'); });
}
// Only the pointer that started cursor mining may stop it — releasing another finger
// (e.g. a movement button on the touch pad) must not cancel digging.
function releasePointerWeaponFire(e,cancel){
	if(e.pointerId!==weaponPointerId) return false;
	if(WEAPONS){
		if(cancel && WEAPONS.cancelHeld) WEAPONS.cancelHeld();
		else if(WEAPONS.releaseHeld){
			const it=activeWeaponItem();
			const aim=screenToWorld(e.clientX,e.clientY);
			if(WEAPONS.releaseHeld(player, aim.x, aim.y)) notifyInvasionWeaponUse(it,{released:true});
		}
	}
	weaponPointerId=null;
	return true;
}
window.addEventListener('pointerup',e=>{ noteSaveActivity(); if(touchHold && e.pointerId===touchHold.id) cancelTouchHold(); activePointers.delete(e.pointerId); if(activePointers.size<2) pinch=null; releasePointerWeaponFire(e,false); endHeroDefense(e.pointerId,{cancel:false}); if(e.pointerId===minePointerId){ minePointerId=null; if(!mineBtnHeld) stopMining(); } });
window.addEventListener('pointercancel',e=>{ noteSaveActivity(); if(touchHold && e.pointerId===touchHold.id) cancelTouchHold(); activePointers.delete(e.pointerId); if(activePointers.size<2) pinch=null; releasePointerWeaponFire(e,true); endHeroDefense(e.pointerId,{cancel:true}); if(e.pointerId===minePointerId){ minePointerId=null; if(!mineBtnHeld) stopMining(); } });
function waterCollectionChanceAt(tx,ty){
	if(getTile(tx,ty)!==T.WATER) return 0;
	const unitsMax=Math.max(1,(WATER && WATER.UNITS) || 10);
	let units=unitsMax;
	try{
		if(WATER && WATER.levelAt) units=WATER.levelAt(tx,ty,getTile);
	}catch(e){}
	return Math.max(0,Math.min(1,(Number(units)||0)/unitsMax));
}
function dropContextForTile(tileId,tx,ty){
	if(tileId===T.WATER) return {tileId, waterChance:waterCollectionChanceAt(tx,ty)};
	return {tileId};
}
function awardTileDrops(info,opts){
	const awarded=[];
	const add=(key,n)=>{
		const amount=Math.max(0,n|0);
		if(!key || amount<=0) return;
		if(!RESOURCE_KEY_SET.has(key)){ try{ console.warn('unregistered drop skipped:', key); }catch(e){} return; }
		inv[key]=(inv[key]||0)+amount;
		awarded.push({key,n:amount});
	};
	if(!info) return awarded;
	if(info.drop){
		const waterDrop=opts && opts.tileId===T.WATER && info.drop==='water';
		const chance=waterDrop ? Math.max(0,Math.min(1,Number(opts.waterChance)||0)) : 1;
		if(chance>=1 || Math.random()<chance) add(info.drop,1);
	}
	if(Array.isArray(info.drops)){
		info.drops.forEach(d=>{
			if(!d || !d.item) return;
			const chance=(typeof d.chance==='number')?d.chance:1;
			if(chance<1 && Math.random()>chance) return;
			const min=Math.max(0, d.min==null?1:(d.min|0));
			const max=Math.max(min, d.max==null?min:(d.max|0));
			const n=min + (max>min? Math.floor(Math.random()*(max-min+1)) : 0);
			add(d.item,n);
		});
	}
	return awarded;
}
function collectLooseItemAt(tx,ty,opts){
	if(!Number.isFinite(tx) || !Number.isFinite(ty)) return false;
	tx=Math.floor(tx); ty=Math.floor(ty);
	const t=getTile(tx,ty);
	if(!isLooseItemTile(t)) return false;
	const info=INFO[t];
	if(!info) return false;
	const hasRegisteredDrop=(info.drop && RESOURCE_KEY_SET.has(info.drop))
		|| (Array.isArray(info.drops) && info.drops.some(d=>d && d.item && RESOURCE_KEY_SET.has(d.item)));
	if(!hasRegisteredDrop) return false;
	const dropCtx=dropContextForTile(t,tx,ty);
	setTile(tx,ty,T.AIR);
	if(FIRE && FIRE.wakeLavaAround) FIRE.wakeLavaAround(tx,ty,getTile,{radius:12});
	const drops=awardTileDrops(info,dropCtx);
	if(FALLING && FALLING.onTileRemoved) FALLING.onTileRemoved(tx,ty);
	if(WATER && WATER.onTileChanged) WATER.onTileChanged(tx,ty,getTile);
	pushUndo(tx,ty,t,T.AIR,'break',drops);
	updateInventory();
	try{
		if(!(opts && opts.silent) && MM.audio && MM.audio.play) MM.audio.play('harvest');
	}catch(e){}
	return true;
}
MM.collectLooseItemAt=collectLooseItemAt;
function dismantleDynamoAt(tx,ty){
	if(!DYNAMO || !DYNAMO.structureCellsAt) return false;
	const cells=DYNAMO.structureCellsAt(tx,ty,getTile);
	if(!cells.length) return false;
	const undoCells=cells.map(cell=>({x:cell.x,y:cell.y,oldId:getTile(cell.x,cell.y),newId:T.AIR}));
	for(const cell of cells){
		const oldId=getTile(cell.x,cell.y);
		setTile(cell.x,cell.y,T.AIR);
		notifyStructureTileChanged(cell.x,cell.y,oldId,T.AIR);
		if(FIRE && FIRE.wakeLavaAround) FIRE.wakeLavaAround(cell.x,cell.y,getTile,{radius:22});
		if(FALLING && FALLING.onTileRemoved) FALLING.onTileRemoved(cell.x,cell.y);
	}
	if(!godMode) inv.dynamo=(inv.dynamo||0)+1;
	pushUndo(tx,ty,T.DYNAMO,T.AIR,'breakDynamo',[{key:'dynamo',n:1}],{cells:undoCells});
	updateInventory();
	return true;
}
function meteorPickSparkTile(t){
	return isMeteorPickSparkMaterial(t);
}
function emitMeteorPickSpark(tx,ty,count){
	try{
		if(PARTICLES && PARTICLES.spawnSparks) PARTICLES.spawnSparks((tx+0.5)*TILE,(ty+0.5)*TILE,'rare',count||4);
	}catch(e){}
}
function updateMeteorPickMiningFx(dt,tId){
	if(player.tool!=='meteor' || !meteorPickSparkTile(tId)){ meteorPickSparkT=0; return; }
	meteorPickSparkT-=dt;
	if(meteorPickSparkT>0) return;
	emitMeteorPickSpark(mineTx,mineTy,3);
	meteorPickSparkT=0.075+Math.random()*0.055;
}
function applyMaterialBreakPersonality(tId,tx,ty){
	if(tId===T.ANTIMATTER_CRYSTAL){
		try{ if(METEORITES && METEORITES.triggerAntimatterBurst) METEORITES.triggerAntimatterBurst(tx+0.5,ty+0.5,1.2); }catch(e){}
		emitMeteorPickSpark(tx,ty,12);
		return;
	}
	if(player.tool==='meteor' && meteorPickSparkTile(tId)){
		emitMeteorPickSpark(tx,ty,isMeteorPickDenseRockMaterial(tId)?7:5);
		try{ if(MM.gases && MM.gases.add && tId===T.COAL) MM.gases.add('hot',tx+0.5,ty+0.5,{power:0.16,cells:1,getTile,setTile}); }catch(e){}
	}
}
function consumeBedrockPickUse(){
	if(player.tool!=='bedrock' || !inv.tools.bedrock) return;
	inv.bedrockPickDurability=Math.max(0, bedrockPickDurability()-1);
	if(inv.bedrockPickDurability<=0){
		inv.tools.bedrock=false;
		const owned=ownedPicks();
		player.tool=owned.includes('diamond') ? 'diamond' : owned[owned.length-1] || 'basic';
		msg('Kilof macierzysty rozpadl sie po przebiciu skaly macierzystej');
		return;
	}
	msg('Kilof macierzysty: '+inv.bedrockPickDurability+'/'+BEDROCK_PICK_MAX_DURABILITY+' uderzen');
}
function breakTileByCompanion(tx,ty,expectedTile){
	const tId=mineTileIdAt(tx,ty);
	if(expectedTile!=null && tId!==expectedTile) return false;
	if(!companionHarvestAssignableTile(tId)) return false;
	const overId=getInfrastructureTile(tx,ty);
	if(overId!==T.AIR){
		const info=INFO[overId];
		if(!info || !companionHarvestAssignableTile(overId)) return false;
		if(WORLD && WORLD.clearInfrastructure) WORLD.clearInfrastructure(tx,ty,overId);
		const drops=awardTileDrops(info);
		pushUndo(tx,ty,overId,T.AIR,'breakOverlay',drops);
		updateInventory();
		noteSaveActivity();
		return true;
	}
	if(miningTargetsConstructionBackground(tx,ty)){
		const bgId=getConstructionBackgroundTile(tx,ty);
		const info=INFO[bgId];
		if(!info || !companionHarvestAssignableTile(bgId)) return false;
		if(WORLD && WORLD.clearConstructionBackground) WORLD.clearConstructionBackground(tx,ty);
		const drops=awardTileDrops(info);
		pushUndo(tx,ty,bgId,T.AIR,'breakBackground',drops);
		wakeConstructionBackgroundChanged(tx,ty);
		updateInventory();
		noteSaveActivity();
		return true;
	}
	const info=INFO[tId];
	if(!info) return false;
	const dropCtx=dropContextForTile(tId,tx,ty);
	setTile(tx,ty,T.AIR);
	if(tId===T.VENDING_MACHINE && VENDING && VENDING.onTileRemoved) VENDING.onTileRemoved(tx,ty);
	if(tId===T.SPRING_PLATFORM && SPRING_PLATFORMS && SPRING_PLATFORMS.onTileChanged) SPRING_PLATFORMS.onTileChanged(tx,ty,tId,T.AIR,getTile);
	applyMaterialBreakPersonality(tId,tx,ty);
	if(FIRE && FIRE.wakeLavaAround) FIRE.wakeLavaAround(tx,ty,getTile,{radius:22});
	const drops=awardTileDrops(info,dropCtx);
	if(tId===T.WOOD && getTile(tx,ty-1)===T.WOOD) startTreeFall(tx,ty-1);
	if(FALLING && FALLING.onTileRemoved) FALLING.onTileRemoved(tx,ty);
	if(WATER && WATER.onTileChanged) WATER.onTileChanged(tx,ty,getTile);
	pushUndo(tx,ty,tId,T.AIR,'companionBreak',drops);
	notifyTempleDisturbance(templeDisturbanceKindForTile(tId),tx,ty,tId,T.AIR);
	updateInventory();
	noteSaveActivity();
	return true;
}
function breakMinedTile(){
	if(!canPhysicallyTargetTile(mineTx,mineTy)) return false;
	const overId=getInfrastructureTile(mineTx,mineTy);
	if(overId!==T.AIR){
		const info=INFO[overId];
		if(!info) return false;
		if(WORLD && WORLD.clearInfrastructure) WORLD.clearInfrastructure(mineTx,mineTy,overId);
		const drops=awardTileDrops(info);
		pushUndo(mineTx,mineTy,overId,T.AIR,'breakOverlay',drops);
		updateInventory();
		notifyInvasionMining(overId,mineTx,mineTy);
		return true;
	}
	if(miningTargetsConstructionBackground(mineTx,mineTy)){
		const bgId=getConstructionBackgroundTile(mineTx,mineTy);
		const info=INFO[bgId];
		if(!info) return false;
		if(WORLD && WORLD.clearConstructionBackground) WORLD.clearConstructionBackground(mineTx,mineTy);
		const drops=awardTileDrops(info);
		pushUndo(mineTx,mineTy,bgId,T.AIR,'breakBackground',drops);
		wakeConstructionBackgroundChanged(mineTx,mineTy);
		updateInventory();
		notifyInvasionMining(bgId,mineTx,mineTy);
		return true;
	}
	const tId=mineTileIdAt(mineTx,mineTy);
	const info=mineInfoForId(tId);
	if(!info) return false;
	if(info.unmineable && !canMineBedrockWithCurrentTool(tId,mineTx,mineTy)) return false;
	if(tId===T.INVASION_CACHE) return tryOpenInvasionCacheAt(mineTx,mineTy);
	if(isGasTileId(tId)) return false;
	if(tId===T.DYNAMO || tId===T.DYNAMO_SLOT) return dismantleDynamoAt(mineTx,mineTy);
	const dropCtx=dropContextForTile(tId,mineTx,mineTy);
	const templeKind=templeDisturbanceKindForTile(tId);
	setTile(mineTx,mineTy,T.AIR);
	if(tId===T.VENDING_MACHINE && VENDING && VENDING.onTileRemoved) VENDING.onTileRemoved(mineTx,mineTy);
	if(tId===T.SPRING_PLATFORM && SPRING_PLATFORMS && SPRING_PLATFORMS.onTileChanged) SPRING_PLATFORMS.onTileChanged(mineTx,mineTy,tId,T.AIR,getTile);
	applyMaterialBreakPersonality(tId,mineTx,mineTy);
	if(FIRE && FIRE.wakeLavaAround) FIRE.wakeLavaAround(mineTx,mineTy,getTile,{radius:22});
	const drops=awardTileDrops(info,dropCtx);
	if(tId===T.WOOD && getTile(mineTx,mineTy-1)===T.WOOD) startTreeFall(mineTx,mineTy-1);
	if(FALLING && FALLING.onTileRemoved) FALLING.onTileRemoved(mineTx,mineTy);
	if(WATER && WATER.onTileChanged) WATER.onTileChanged(mineTx,mineTy,getTile);
	pushUndo(mineTx,mineTy,tId,T.AIR,'break',drops);
	if(tId===T.BEDROCK) consumeBedrockPickUse();
	updateInventory();
	notifyTempleDisturbance(templeKind,mineTx,mineTy,tId,T.AIR);
	notifyInvasionMining(tId,mineTx,mineTy);
	return true;
}
function instantBreak(){
	const t=mineTileIdAt(mineTx,mineTy);
	if(t===T.AIR || !canMineTileWithCurrentTool(t,mineTx,mineTy)){ mining=false; mineBtn.classList.remove('on'); return; }
	if(breakMinedTile()){ mining=false; mineBtn.classList.remove('on'); }
}
// Falling tree system (per-block physics)
function startTreeFall(bx,by){ return TREES.startTreeFall(getTile,setTile,player.facing,bx,by); }
function updateFallingBlocks(dt){
	const viewX=Math.ceil(W/(TILE*zoom));
	const viewY=Math.ceil(H/(TILE*zoom));
	const sx=Math.floor(camX)-1;
	const sy=Math.floor(camY)-1;
	TREES.updateFallingBlocks(getTile,setTile,dt,{sx,sy,viewX,viewY,frameMs:lastFrameMs});
}
function drawFallingBlocks(){ TREES.drawFallingBlocks(ctx,TILE,INFO,worldFxVisible); }
// While the initiating pointer/⛏️ stays held, mining continues: the ⛏️ button keeps digging in
// its direction, a held left button re-aims at whatever tile is under the cursor (drag mining).
function resumeHeldMining(){
	if(!isToolMode()) return;
	if(mineBtnHeld){ startMine({quiet:true}); return; }
	if(minePointerId!=null && lastPointer.has){ const p=screenToWorldTile(lastPointer.x,lastPointer.y); startMineAt(p.tx,p.ty,{quiet:true}); }
}
function updateMining(dt){
	if(!isToolMode()){ if(mining) stopMining(); return; }
	if(!mining){ resumeHeldMining(); if(!mining) return; }
	if(mineBoatTarget){ updateBoatMining(dt); return; }
	const activeMineId=mineTileIdAt(mineTx,mineTy);
	if(activeMineId===T.AIR || isGasTileId(activeMineId) || !canMineTileWithCurrentTool(activeMineId,mineTx,mineTy)){ stopMining(); resumeHeldMining(); if(!mining) return; }
	if(!canPhysicallyTargetTile(mineTx,mineTy)){ stopMining(); resumeHeldMining(); if(!mining) return; }
	if(godMode){ instantBreak(); return; }
	try{ if(MM.audio && MM.audio.play) MM.audio.play('dig'); }catch(e){}
	// Drag mining: if the held cursor moved to a different tile, re-target immediately
	if(minePointerId!=null && !mineBtnHeld && lastPointer.has){
		const p=screenToWorldTile(lastPointer.x,lastPointer.y);
		const pt=mineTileIdAt(p.tx,p.ty);
		if((p.tx!==mineTx||p.ty!==mineTy) && withinReach(p.tx,p.ty,MINE_REACH) && canPhysicallyTargetTile(p.tx,p.ty) && pt!==T.AIR && !isGasTileId(pt) && canMineTileWithCurrentTool(pt,p.tx,p.ty) && !(INFO[pt]&&(INFO[pt].chestTier||INFO[pt].cache))){ mineTx=p.tx; mineTy=p.ty; mineTimer=0; }
	}
	const mineMult=(MM.activeModifiers && MM.activeModifiers.mineSpeedMult)||1;
	const curId=mineTileIdAt(mineTx,mineTy);
	const info=mineInfoForId(curId);
	if(!info || !canMineTileWithCurrentTool(curId,mineTx,mineTy)){ stopMining(); return; }
	updateMeteorPickMiningFx(dt,curId);
	mineTimer += dt * tools[player.tool] * mineMult;
	const need=curId===T.BEDROCK ? BEDROCK_MINE_NEED : Math.max(0.1, info.hp/6);
	if(mineTimer>=need && breakMinedTile()){ stopMining(); try{ if(MM.audio && MM.audio.play) MM.audio.play('break'); }catch(e){} resumeHeldMining(); } }

// --- Placement ---
// Suppress accidental placement immediately after opening a chest with right-click
let lastChestOpen={t:0,x:0,y:0};
const CHEST_PLACE_SUPPRESS_MS=250; // extended to reduce accidental placements
const PLACE_REACH=5; // build reach in tiles (Chebyshev); god mode is unlimited
let lastRightPlaceT=0; // right-button pointerdown already placed for this gesture (contextmenu dedupe)
// Touch long-press = place block. Android surfaces it as a contextmenu event, iOS
// never fires contextmenu at all — so a pointer-based hold timer covers both, and
// lastRightPlaceT dedupes whichever path lands first on Android.
let touchHold=null; // {id,x,y,timer} pending long-press placement
const TOUCH_HOLD_MS=550, TOUCH_HOLD_SLOP=12;
function cancelTouchHold(){ if(touchHold){ clearTimeout(touchHold.timer); touchHold=null; } }
function armTouchHold(e){
	cancelTouchHold();
	const x=e.clientX, y=e.clientY;
	touchHold={ id:e.pointerId, x, y, timer:setTimeout(()=>{
		touchHold=null;
		if(pinch || activePointers.size>1 || modalInputOpen()) return;
		if(!isToolMode()) return;
		const now=performance.now();
		if(now-lastRightPlaceT<400) return;
		if(now-lastChestOpen.t<CHEST_PLACE_SUPPRESS_MS) return;
		lastRightPlaceT=now;
		// the initial touch started cursor mining — cancel it before placing
		if(minePointerId!=null){ minePointerId=null; stopMining(); }
		const p=screenToWorldTile(x,y);
		useToolSecondaryAt(p.tx,p.ty);
	}, TOUCH_HOLD_MS) };
}
canvas.addEventListener('contextmenu',e=>{ if(modalInputOpen()){ e.preventDefault(); return; } e.preventDefault(); noteSaveActivity(); const now=performance.now();
	// Right mouse button is handled on pointerdown; contextmenu remains only for touch long-press.
	if(now-lastRightPlaceT<400) return;
	if(!isToolMode()) return;
	if(now-lastChestOpen.t<CHEST_PLACE_SUPPRESS_MS) return;
	lastRightPlaceT=now; // beat the pointer-hold timer to this gesture
	cancelTouchHold();
	// Touch long-press: the initial touch started cursor mining — cancel it before placing
	if(minePointerId!=null){ minePointerId=null; stopMining(); }
	const p=screenToWorldTile(e.clientX,e.clientY);
	useToolSecondaryAt(p.tx,p.ty); });
// Placeability is exactly "the resource registry maps this tile"; MUD/LAVA/GRAVE/WET_CLAY
// are not resources at all.
function haveBlocksFor(tileId){ const k=TILE_TO_RES[tileId]; return !!k && (inv[k]||0)>0; }
function consumeFor(tileId){ if(godMode) return; const k=TILE_TO_RES[tileId]; if(k) inv[k]--; }
function finishFoodUse(effect,result){
	if(!result.ok){
		if(result.reason==='full') msg('HP pelne');
		else if(result.reason==='none') msg('Brak: '+(effect.label||'jedzenie'));
		return true;
	}
	const delta=result.delta||0;
	if(result.immune){
		msg((effect.label||'Jedzenie')+': HP bez zmian');
		try{ if(MM.audio && MM.audio.play) MM.audio.play('charge'); }catch(e){}
	}else{
		msg((effect.label||'Jedzenie')+': '+(delta>0?'+':'')+delta+' HP');
		try{ if(MM.audio && MM.audio.play) MM.audio.play(delta>=0?'heal':'hurt'); }catch(e){}
		if(delta!==0) pushWorldNumber({kind:delta>0?'heal':'damage',amount:delta,x:player.x,y:player.y-player.h*0.72,target:'hero',source:'food'});
		if(delta>0) notifyInvasionHeroAction('hero_heal',{amount:delta,source:'food',label:effect.label||'Jedzenie'});
	}
	updateInventory();
	if(result.dead && window.heroDied) window.heroDied('rotten_meat');
	return true;
}
function eatSelectedFood(){
	const tileId=selectedTileId();
	const effect=selectedFoodEffect();
	if(!effect) return false;
	const result=FOOD.applyFoodEffect(player, inv, tileId, {godMode, immunityMode});
	return finishFoodUse(effect,result);
}
function selectedFoodEffect(){
	const tileId=selectedTileId();
	return (FOOD && FOOD.effectForTile) ? FOOD.effectForTile(tileId) : null;
}
function useToolSecondaryAt(tx,ty){
	if(tryEatWorldFoodAt(tx,ty)) return true;
	const placeAllowed=performance.now()-lastChestOpen.t>=CHEST_PLACE_SUPPRESS_MS;
	if(placeAllowed && tryToggleBlockLayerAt(tx,ty)) return true;
	const selectedFood=selectedFoodEffect();
	if(selectedFood){
		if(placeAllowed) return tryPlace(tx,ty);
		return false;
	}
	if(eatSelectedFood()) return true;
	if(placeAllowed) return tryPlace(tx,ty);
	return false;
}
function tryEatWorldFoodAt(tx,ty){
	const tileId=getTile(tx,ty);
	const effect=(FOOD && FOOD.effectForTile) ? FOOD.effectForTile(tileId) : null;
	if(!effect) return false;
	if(!withinReach(tx,ty,MINE_REACH)){ msg('Za daleko'); return true; }
	const blocked=blockedTargetReason(tx,ty);
	if(blocked){ msg(blocked); return true; }
	const tmpInv={}; tmpInv[effect.key]=1;
	const result=FOOD.applyFoodEffect(player,tmpInv,tileId,{godMode:false, immunityMode});
	if(!result.ok) return finishFoodUse(effect,result);
	pushUndo(tx,ty,tileId,T.AIR,'break',[]);
	setTile(tx,ty,T.AIR);
	if(FIRE && FIRE.wakeLavaAround) FIRE.wakeLavaAround(tx,ty,getTile,{radius:22});
	if(FALLING && FALLING.onTileRemoved) FALLING.onTileRemoved(tx,ty);
	if(WATER && WATER.onTileChanged) WATER.onTileChanged(tx,ty,getTile);
	return finishFoodUse(effect,result);
}
function layerToggleCommonBlocker(tx,ty){
	if(!WORLD || !WORLD.setConstructionBackground || !WORLD.clearConstructionBackground) return 'Brak warstwy tla';
	if(getInfrastructureTiles(tx,ty).length) return 'Instalacja blokuje przelaczenie';
	if(!godMode && !withinReach(tx,ty,PLACE_REACH)) return 'Za daleko';
	const blocked=blockedTargetReason(tx,ty);
	if(blocked) return blocked;
	return '';
}
function notifyForegroundTileRemovedForLayerToggle(tx,ty,id){
	if(id===T.WOOD && getTile(tx,ty-1)===T.WOOD) startTreeFall(tx,ty-1);
	if(FIRE && FIRE.wakeLavaAround) FIRE.wakeLavaAround(tx,ty,getTile,{radius:22});
	if(FALLING && FALLING.onTileRemoved) FALLING.onTileRemoved(tx,ty);
	if(WATER && WATER.onTileChanged) WATER.onTileChanged(tx,ty,getTile);
}
function notifyForegroundTilePlacedForLayerToggle(tx,ty,prev,id,replacedWater){
	if(COMPANIONS && COMPANIONS.onTileChanged) COMPANIONS.onTileChanged(tx,ty,prev,id,getTile,setTile);
	if(VOLCANO && VOLCANO.onTileChanged) VOLCANO.onTileChanged(tx,ty,id,getTile,setTile);
	if(WATER){ if(id===T.WATER) WATER.addSource(tx,ty,getTile,setTile); else if(replacedWater && WATER.onTileChanged) WATER.onTileChanged(tx,ty,getTile); }
	if(FIRE){
		if(id===T.TORCH){
			if(FIRE.noteTorch) FIRE.noteTorch(tx,ty);
			if(FIRE.heatAround) FIRE.heatAround(tx,ty,getTile,setTile,{includeCenter:false});
		} else if(id===T.SNOW || id===T.ICE){
			const heated=[[0,0],[0,-1],[1,0],[-1,0],[0,1],[1,-1],[-1,-1],[1,1],[-1,1]].some(([dx,dy])=>{
				const ht=getTile(tx+dx,ty+dy);
				return ht===T.TORCH || ht===T.LAVA || (FIRE.isBurning && FIRE.isBurning(tx+dx,ty+dy));
			});
			if(heated && FIRE.thawAt) FIRE.thawAt(tx,ty,getTile,setTile);
		}
	}
	if(FALLING && FALLING.afterPlacement) FALLING.afterPlacement(tx,ty);
}
function tryToggleForegroundToBackgroundAt(tx,ty,id){
	const blocker=layerToggleCommonBlocker(tx,ty);
	if(blocker){ msg(blocker); return true; }
	if(getConstructionBackgroundTile(tx,ty)!==T.AIR){ msg('Tlo zajete'); return true; }
	const front=getTile(tx,ty);
	if(front!==id) return false;
	if(!(WORLD && WORLD.setConstructionBackground && WORLD.setConstructionBackground(tx,ty,id))){ msg('Nie mozna przelaczyc'); return true; }
	setTile(tx,ty,T.AIR);
	pushUndo(tx,ty,id,T.AIR,'toggleForegroundToBackground',null,{tileId:id});
	notifyForegroundTileRemovedForLayerToggle(tx,ty,id);
	wakeConstructionBackgroundChanged(tx,ty);
	saveState();
	msg('Blok przeniesiony do tla');
	try{ if(MM.audio && MM.audio.play) MM.audio.play('place'); }catch(e){}
	return true;
}
function canToggleBackgroundToForegroundAt(tx,ty,id){
	const blocker=layerToggleCommonBlocker(tx,ty);
	if(blocker) return {ok:false, reason:blocker};
	const cur=getTile(tx,ty);
	if(!isReplaceableNaturalOpenTile(cur,false)) return {ok:false, reason:'Pierwszy plan zajety'};
	if(cellOverlapsPlayer(tx,ty)) return {ok:false, reason:'Za blisko'};
	let pressureCells=null;
	if(!godMode){
		let checkedStructural=false;
		if(FALLING && FALLING.canSupportPlacement){
			const structural=FALLING.canSupportPlacement(tx,ty,id);
			checkedStructural=!!(structural && structural.applies);
			if(checkedStructural && Array.isArray(structural.pressureCells) && structural.pressureCells.length) pressureCells=structural.pressureCells;
			if(checkedStructural && !structural.ok) return {ok:false, reason:structural.reason||'Brak podparcia', pressureCells};
		}
		if(!checkedStructural){
			const support = isStableConstructionSupportAt(tx,ty+1)
				|| [[1,0],[-1,0],[0,-1]].some(([dx,dy])=>isStableConstructionSupportAt(tx+dx,ty+dy));
			if(!support) return {ok:false, reason:'Brak podparcia'};
		}
	}
	return {ok:true, oldForeground:isGasTileId(cur)?T.AIR:cur, replacedWater:cur===T.WATER, pressureCells};
}
function tryToggleBackgroundToForegroundAt(tx,ty,id){
	const v=canToggleBackgroundToForegroundAt(tx,ty,id);
	if(!v.ok){ if(v.reason) msg(v.reason); return true; }
	if(getPlayerConstructionBackgroundTile(tx,ty)!==id) return false;
	if(v.replacedWater && WATER && WATER.displaceAt && getTile(tx,ty)===T.WATER) WATER.displaceAt(tx,ty,getTile,setTile);
	if(WORLD && WORLD.clearConstructionBackground) WORLD.clearConstructionBackground(tx,ty);
	setTile(tx,ty,id);
	pushUndo(tx,ty,v.oldForeground,id,'toggleBackgroundToForeground',null,{tileId:id});
	notifyForegroundTilePlacedForLayerToggle(tx,ty,v.oldForeground,id,v.replacedWater);
	wakeConstructionBackgroundChanged(tx,ty);
	saveState();
	msg('Blok przeniesiony na pierwszy plan');
	try{ if(MM.audio && MM.audio.play) MM.audio.play('place'); }catch(e){}
	return true;
}
function tryToggleBlockLayerAt(tx,ty){
	const selected=selectedTileId();
	if(!isBackgroundBuildTileId(selected)) return false;
	if(getTile(tx,ty)===selected) return tryToggleForegroundToBackgroundAt(tx,ty,selected);
	if(getPlayerConstructionBackgroundTile(tx,ty)===selected) return tryToggleBackgroundToForegroundAt(tx,ty,selected);
	return false;
}
function cellOverlapsPlayer(tx,ty){
	return tx+1 > player.x - player.w/2 && tx < player.x + player.w/2 && ty+1 > player.y - player.h/2 && ty < player.y + player.h/2;
}
function isStableMachineSupport(t){
	return isStableMachineSupportTile(t);
}
function isStableConstructionSupportAt(x,y){
	return isStableMachineSupport(getTile(x,y)) || isStableMachineSupport(getConstructionBackgroundTile(x,y));
}
function isPlayerBuiltForegroundAt(x,y){
	return !!(FALLING && FALLING.isPlayerBuiltAt && FALLING.isPlayerBuiltAt(x,y));
}
function ladderTargetHasBuiltBackingAt(x,y){
	return isPlayerBuiltForegroundAt(x,y) || isPlayerBuiltMaterial(getConstructionBackgroundTile(x,y));
}
function ladderUndergroundAt(x,y){
	try{
		if(!WORLDGEN || !WORLDGEN.surfaceHeight) return false;
		return y>=Math.floor(WORLDGEN.surfaceHeight(x));
	}catch(e){ return false; }
}
function ladderAnchorAt(x,y){
	if(!worldYInBounds(y)) return false;
	return isStableConstructionSupportAt(x,y) || ladderTargetHasBuiltBackingAt(x,y);
}
function ladderBaseIsOpen(t){
	return isReplaceableNaturalOpenTile(t,false) || isHeroPassableTile(t);
}
function canPlaceLadderAt(tx,ty,cur){
	if(hasLadderAt(tx,ty)) return {ok:false, id:T.LADDER, overlay:true, reason:'Juz jest taka instalacja'};
	if(cur===T.LAVA) return {ok:false, id:T.LADDER, overlay:true, reason:'Lawa blokuje drabinke'};
	const backing=ladderTargetHasBuiltBackingAt(tx,ty);
	const naturalSolidBlocked=!ladderBaseIsOpen(cur) && !backing;
	const rule=canPlaceLadderFixture({
		tx,ty,
		underground:ladderUndergroundAt(tx,ty),
		naturalSolidBlocked,
		hasLadder:hasLadderAt,
		hasBacking:ladderTargetHasBuiltBackingAt,
		hasAnchor:ladderAnchorAt
	});
	if(!rule.ok) return {ok:false, id:T.LADDER, overlay:true, reason:rule.reason||'Brak podparcia'};
	return {ok:true, id:T.LADDER, overlay:true};
}
function canDynamoCellReplace(cell,cur){
	const slot=cell && (cell.role==='slot' || cell.t===T.DYNAMO_SLOT);
	return isReplaceableNaturalOpenTile(cur,false) && (slot || cur!==T.WATER);
}
function dynamoCellLabel(cell){
	const role=cell && cell.role;
	if(role==='slot') return 'szczelina';
	if(role==='left') return 'lewa obudowa';
	if(role==='right') return 'prawa obudowa';
	if(role==='top') return 'gorna obudowa';
	if(role==='bottom') return 'dolna obudowa';
	return 'obudowa';
}
function canPlaceDynamoAt(tx,ty){
	const cells=(DYNAMO && DYNAMO.plannedCells) ? DYNAMO.plannedCells(tx,ty,dynamoOrientation) : (
		dynamoOrientation==='vertical'
			? [{x:tx,y:ty-1,t:T.DYNAMO},{x:tx,y:ty,t:T.DYNAMO_SLOT},{x:tx,y:ty+1,t:T.DYNAMO}]
			: [{x:tx-1,y:ty,t:T.DYNAMO},{x:tx,y:ty,t:T.DYNAMO_SLOT},{x:tx+1,y:ty,t:T.DYNAMO}]
	);
	if(!godMode && !withinReach(tx,ty,PLACE_REACH)) return {ok:false, id:T.DYNAMO, structure:'dynamo', cells, reason:'Za daleko'};
	const blocked=blockedTargetReason(tx,ty);
	if(blocked) return {ok:false, id:T.DYNAMO, structure:'dynamo', cells, reason:blocked};
	for(const cell of cells){
		const cur=getTile(cell.x,cell.y);
		if(!canDynamoCellReplace(cell,cur)) return {ok:false, id:T.DYNAMO, structure:'dynamo', cells, reason:dynamoCellLabel(cell)+': '+(TILE_LABELS[cur]||'blok')};
		if(cellOverlapsPlayer(cell.x,cell.y)) return {ok:false, id:T.DYNAMO, structure:'dynamo', cells, reason:'Za blisko'};
	}
	if(!godMode){
		const casingCells=cells.filter(cell=>cell.role!=='slot' && cell.t!==T.DYNAMO_SLOT);
		const support=casingCells.some(cell=>{
			return [[0,1],[1,0],[-1,0],[0,-1]].some(([dx,dy])=>isStableConstructionSupportAt(cell.x+dx,cell.y+dy));
		});
		if(!support) return {ok:false, id:T.DYNAMO, structure:'dynamo', cells, reason:'Dynamo wymaga podparcia obudowy'};
		if(!haveBlocksFor(T.DYNAMO)) return {ok:false, id:T.DYNAMO, structure:'dynamo', cells, reason:'Brak blokĂłw'};
	}
	return {ok:true, id:T.DYNAMO, structure:'dynamo', cells};
}
function canPlaceInfrastructureAt(tx,ty,id){
	if(!isInfrastructureTileId(id)) return null;
	const cur=getTile(tx,ty);
	if(id===T.LADDER && hasLadderAt(tx,ty)) return {ok:false, id, overlay:true, reason:'Juz jest taka instalacja'};
	if(hasInfrastructureTile(tx,ty,id)) return {ok:false, id, overlay:true, reason:'Juz jest taka instalacja'};
	if(INFO[cur] && INFO[cur].chestTier) return {ok:false, id, overlay:true, reason:'Skrzynia blokuje instalacje'};
	if(INFO[cur] && INFO[cur].cache) return {ok:false, id, overlay:true, reason:'Skrytka blokuje instalacje'};
	if(cur===T.DYNAMO || cur===T.DYNAMO_SLOT || cur===T.TELEPORTER || cur===T.WATER_PUMP || cur===T.VENDING_MACHINE || cur===T.TURRET || cur===T.FIRE_TURRET || cur===T.WATER_TURRET || cur===T.SPRING_PLATFORM || cur===T.SOLAR_PANEL || cur===T.SOLAR_BATTERY || cur===T.ANTIGRAVITY_BEACON || cur===T.METEOR_SIREN) return {ok:false, id, overlay:true, reason:'Maszyna blokuje instalacje'};
	if(!godMode && !withinReach(tx,ty,PLACE_REACH)) return {ok:false, id, overlay:true, reason:'Za daleko'};
	const blocked=blockedTargetReason(tx,ty);
	if(blocked) return {ok:false, id, overlay:true, reason:blocked};
	if(id===T.LADDER){
		const ladder=canPlaceLadderAt(tx,ty,cur);
		if(!ladder.ok) return ladder;
	}
	if(!godMode && !haveBlocksFor(id)) return {ok:false, id, overlay:true, reason:'Brak blokow'};
	return {ok:true, id, overlay:true};
}
function constructionBackgroundBlockedReason(cur){
	if(cur===T.LAVA) return 'Lawa blokuje tlo';
	const info=INFO[cur];
	if(info && (info.chestTier || info.cache || info.machine || info.story || info.unmineable)) return 'Blokuje tlo';
	if(cur!==T.AIR && !isGasTileId(cur) && cur!==T.WATER && !isHeroPassableTile(cur)) return 'Pierwszy plan zajety';
	return '';
}
function canPlaceConstructionBackgroundAt(tx,ty,id){
	if(!isBackgroundBuildTileId(id)) return {ok:false, id, background:true, reason:'Tylko material budowlany'};
	if(!WORLD || !WORLD.setConstructionBackground) return {ok:false, id, background:true, reason:'Brak warstwy tla'};
	const existing=getConstructionBackgroundTile(tx,ty);
	if(existing===id) return {ok:false, id, background:true, reason:'Juz jest w tle'};
	if(existing!==T.AIR) return {ok:false, id, background:true, reason:'Tlo zajete'};
	const cur=getTile(tx,ty);
	const blockedByTile=constructionBackgroundBlockedReason(cur);
	if(blockedByTile) return {ok:false, id, background:true, reason:blockedByTile};
	if(!godMode && !withinReach(tx,ty,PLACE_REACH)) return {ok:false, id, background:true, reason:'Za daleko'};
	const blocked=blockedTargetReason(tx,ty);
	if(blocked) return {ok:false, id, background:true, reason:blocked};
	if(!godMode && !haveBlocksFor(id)) return {ok:false, id, background:true, reason:'Brak blokow'};
	return {ok:true, id, background:true};
}
function wakeConstructionBackgroundChanged(tx,ty){
	if(FALLING && FALLING.recheckNeighborhood){
		[[0,0],[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx,dy])=>FALLING.recheckNeighborhood(tx+dx,ty+dy));
	}
}
function notifyStructureTileChanged(x,y,oldTile,newTile){
	const tx=Math.floor(x), ty=Math.floor(y);
	// WORLD.setTile() is the single source for tile lifecycle hooks
	// (machines, cables, gases, trees, meat). This helper only wakes systems
	// that intentionally live outside the world storage hook.
	if(VOLCANO && VOLCANO.onTileChanged) VOLCANO.onTileChanged(tx,ty,newTile,getTile,setTile);
	if(SPRING_PLATFORMS && SPRING_PLATFORMS.onTileChanged) SPRING_PLATFORMS.onTileChanged(tx,ty,oldTile,newTile,getTile);
	if(FALLING && FALLING.recheckNeighborhood) FALLING.recheckNeighborhood(tx,ty);
	if(WATER && WATER.onTileChanged) WATER.onTileChanged(tx,ty,getTile);
}
function placeDynamoStructure(v){
	const cells=v && Array.isArray(v.cells) ? v.cells : [];
	if(cells.length!==3) return false;
	const undoCells=cells.map(cell=>{
		const oldRaw=getTile(cell.x,cell.y);
		const oldId=isGasTileId(oldRaw)?T.AIR:oldRaw;
		return {x:cell.x,y:cell.y,oldId,newId:cell.t};
	});
	for(const cell of cells){
		setTile(cell.x,cell.y,cell.t);
		const prev=undoCells.find(c=>c.x===cell.x && c.y===cell.y);
		notifyStructureTileChanged(cell.x,cell.y,prev?prev.oldId:T.AIR,cell.t);
	}
	consumeFor(T.DYNAMO);
	pushUndo(cells[1].x,cells[1].y,T.AIR,T.DYNAMO,'placeDynamo',null,{cells:undoCells});
	updateInventory(); updateHotbarCounts(); saveState();
	try{ if(MM.audio && MM.audio.play) MM.audio.play('place'); }catch(e){}
	if(FALLING && FALLING.afterPlacement) cells.forEach(cell=>FALLING.afterPlacement(cell.x,cell.y));
	return true;
}
// Single source of truth for "can a block go here" — used by tryPlace AND the ghost preview,
// so the preview can never show a placement that would then be rejected.
function canPlaceAt(tx,ty){
	const cur=getTile(tx,ty);
	const selName=HOTBAR_ORDER[hotbarIndex];
	const chest=isChestSelection(selName);
	const id= chest? T[selName] : selectedTileId();
	if(!chest && isUnmineableTile(id)) return {ok:false, reason:unmineableReason(id)};
	if(!chest && backgroundBuildMode && isBackgroundBuildTileId(id)) return canPlaceConstructionBackgroundAt(tx,ty,id);
	if(!chest && id===T.DYNAMO) return canPlaceDynamoAt(tx,ty);
	const overlay=canPlaceInfrastructureAt(tx,ty,id);
	if(overlay) return overlay;
	const waterGolemDrop=id===T.VOLCANO_MASTER_STONE && cur===T.WATER;
	const molekinMotherLavaDrop=id===T.VOLCANO_MASTER_STONE && cur===T.MOTHER_LAVA && !!(COMPANIONS && COMPANIONS.fireGuardianDefeated && COMPANIONS.fireGuardianDefeated());
	const loosePlacement=!chest && isLooseItemTile(id);
	// Solid blocks may also replace water (building under water); water into water is a no-op.
	// After the fire guardian falls, the master stone may be dropped into mother lava for the molekin ritual.
	if(!isReplaceableNaturalOpenTile(cur,molekinMotherLavaDrop)) return {ok:false};
	if(cur===T.WATER && id===T.WATER) return {ok:false};
	// Tile [tx,tx+1)×[ty,ty+1) vs player AABB — full-tile overlap test
	if(cellOverlapsPlayer(tx,ty)) return {ok:false};
	if(chest && !godMode) return {ok:false, reason:'Tylko w trybie Boga'};
	if(!godMode && !withinReach(tx,ty,PLACE_REACH)) return {ok:false, reason:'Za daleko'};
	{
		const blocked=blockedTargetReason(tx,ty);
		if(blocked) return {ok:false, reason:blocked};
	}
	// Wood built on water floats: it becomes (or extends) a raft entity instead of
	// a tile. Air cells above water only float when no solid support would carry a
	// normal build — planks against a dock keep behaving like ordinary tiles.
	if(!chest && id===T.WOOD && !backgroundBuildMode && BOATS && BOATS.placementMode){
		let hasSupport=false;
		if(cur===T.AIR){
			if(FALLING && FALLING.canSupportPlacement){
				const structural=FALLING.canSupportPlacement(tx,ty,id);
				hasSupport=!!(structural && structural.applies && structural.ok);
			} else {
				hasSupport=isStableConstructionSupportAt(tx,ty+1)
					|| [[1,0],[-1,0],[0,-1]].some(([dx,dy])=>isStableConstructionSupportAt(tx+dx,ty+dy));
			}
		}
		const boatMode=BOATS.placementMode(tx,ty,getTile,{hasSupport,water:WATER});
		if(boatMode){
			if(!haveBlocksFor(id)) return {ok:false, reason:'Brak bloków'};
			return {ok:true, id, boat:true, boatHasSupport:hasSupport};
		}
	}
	let pressureCells=null;
	if(!chest && !godMode && id!==T.SAND && id!==T.WATER && !loosePlacement && !waterGolemDrop && !molekinMotherLavaDrop){
		let checkedStructural=false;
		if(FALLING && FALLING.canSupportPlacement){
			const structural=FALLING.canSupportPlacement(tx,ty,id);
			checkedStructural=!!(structural && structural.applies);
			if(checkedStructural && Array.isArray(structural.pressureCells) && structural.pressureCells.length) pressureCells=structural.pressureCells;
			if(checkedStructural && !structural.ok) return {ok:false, reason:structural.reason||'Brak podparcia', pressureCells};
		}
		if(!checkedStructural){
			// Fallback when the physics module is unavailable: direct footing or a wall/ceiling contact.
			const support = isStableConstructionSupportAt(tx,ty+1)
				|| [[1,0],[-1,0],[0,-1]].some(([dx,dy])=>isStableConstructionSupportAt(tx+dx,ty+dy));
			if(!support) return {ok:false, reason:'Brak podparcia'};
		}
	}
	if(!chest && !haveBlocksFor(id)) return {ok:false, reason:'Brak bloków', pressureCells};
	return {ok:true, id, chest, replacedWater:cur===T.WATER, pressureCells};
}
function tryPlace(tx,ty){
	const v=canPlaceAt(tx,ty);
	if(!v.ok){ if(v.reason) msg(v.reason); return false; }
	const id=v.id; const prevRaw=getTile(tx,ty); const prev=isGasTileId(prevRaw)?T.AIR:prevRaw;
	// A solid placed into water pushes the fluid unit out (up/sideways) instead of
	// deleting it, so player builds conserve volume like falling blocks, trees and meat.
	const displacePlacedWater=()=>{ if(WATER && WATER.displaceAt && id!==T.WATER && getTile(tx,ty)===T.WATER) WATER.displaceAt(tx,ty,getTile,setTile); };
	if(v.chest){ displacePlacedWater(); setTile(tx,ty,id); if(FALLING && FALLING.afterPlacement) FALLING.afterPlacement(tx,ty); return true; }
	if(v.boat){
		const placed=(BOATS && BOATS.placeWood) ? BOATS.placeWood(tx,ty,getTile,{hasSupport:!!v.boatHasSupport,water:WATER}) : null;
		if(!placed || !placed.ok){ if(placed && placed.reason) msg(placed.reason); return false; }
		consumeFor(id); updateInventory(); updateHotbarCounts(); saveState();
		if(placed.created) msg('⛵ Drewno nie tonie — masz tratwę! Dokładaj drewno, by ją powiększyć');
		try{ if(MM.audio && MM.audio.play) MM.audio.play('place'); }catch(e){}
		return true;
	}
	if(v.structure==='dynamo') return placeDynamoStructure(v);
	if(v.overlay){
		const oldOver=getInfrastructureTile(tx,ty);
		if(WORLD && WORLD.setInfrastructure) WORLD.setInfrastructure(tx,ty,id);
		else setTile(tx,ty,id);
		pushUndo(tx,ty,oldOver,id,'placeOverlay');
		consumeFor(id); updateInventory(); updateHotbarCounts(); saveState();
		try{ if(MM.audio && MM.audio.play) MM.audio.play('place'); }catch(e){}
		return true;
	}
	if(v.background){
		const oldBg=getConstructionBackgroundTile(tx,ty);
		if(WORLD && WORLD.setConstructionBackground) WORLD.setConstructionBackground(tx,ty,id);
		pushUndo(tx,ty,oldBg,id,'placeBackground');
		consumeFor(id); updateInventory(); updateHotbarCounts(); saveState();
		wakeConstructionBackgroundChanged(tx,ty);
		try{ if(MM.audio && MM.audio.play) MM.audio.play('place'); }catch(e){}
		return true;
	}
	pushUndo(tx,ty,prev,id,'place');
	displacePlacedWater();
	setTile(tx,ty,id);
	if(COMPANIONS && COMPANIONS.onTileChanged) COMPANIONS.onTileChanged(tx,ty,prev,id,getTile,setTile);
	if(id===T.VENDING_MACHINE && VENDING && VENDING.onPlaced) VENDING.onPlaced(tx,ty,getTile);
	if(id===T.SPRING_PLATFORM && SPRING_PLATFORMS && SPRING_PLATFORMS.onTileChanged) SPRING_PLATFORMS.onTileChanged(tx,ty,prev,id,getTile);
	if(VOLCANO && VOLCANO.onTileChanged) VOLCANO.onTileChanged(tx,ty,id,getTile,setTile); consumeFor(id); updateInventory(); updateHotbarCounts(); saveState();
	if(id===T.WATER_PUMP && PUMPS && PUMPS.setOrientationAt) PUMPS.setOrientationAt(tx,ty,pumpOrientation,getTile);
	try{ if(MM.audio && MM.audio.play) MM.audio.play('place'); }catch(e){}
	if(WATER){ if(id===T.WATER) WATER.addSource(tx,ty,getTile,setTile); else if(v.replacedWater && WATER.onTileChanged) WATER.onTileChanged(tx,ty,getTile); }
	if(FIRE){
		if(id===T.TORCH){
			if(FIRE.noteTorch) FIRE.noteTorch(tx,ty);
			if(FIRE.heatAround) FIRE.heatAround(tx,ty,getTile,setTile,{includeCenter:false});
		} else if(id===T.SNOW || id===T.ICE){
			const heated=[[0,0],[0,-1],[1,0],[-1,0],[0,1],[1,-1],[-1,-1],[1,1],[-1,1]].some(([dx,dy])=>{
				const ht=getTile(tx+dx,ty+dy);
				return ht===T.TORCH || ht===T.LAVA || (FIRE.isBurning && FIRE.isBurning(tx+dx,ty+dy));
			});
			if(heated && FIRE.thawAt) FIRE.thawAt(tx,ty,getTile,setTile);
		}
	}
	// Queue a stability check: unsupported sand starts falling, stone placed without a
	// load path collapses as a cluster, etc. (event-driven in engine/falling.js)
	if(FALLING && FALLING.afterPlacement) FALLING.afterPlacement(tx,ty);
	return true;
}
// Per-slot counts (not per-type ids): two slots may hold the same resource after a
// remap, and chest slots show ∞ in god mode instead of a meaningless number.
// Big stacks compact to "1,2k" so they fit the slot; low (<10) stacks turn amber
// and empty ones red + dim the whole slot, so running dry is visible at a glance.
function fmtHudCount(n){
	n=n|0;
	if(n>=100000) return Math.floor(n/1000)+'k';
	if(n>=10000) return Math.round(n/1000)+'k';
	if(n>=1000) return (n/1000).toFixed(1).replace('.',',')+'k';
	return String(n);
}
function updateHotbarCounts(){
	document.querySelectorAll('#hotbarWrap .hotSlot').forEach((slotEl,i)=>{
		const c=slotEl.querySelector('.count'); if(!c) return;
		const name=HOTBAR_ORDER[i];
		const key=TILE_TO_RES[T[name]];
		const n=key? (inv[key]|0) : 0;
		c.textContent= key? fmtHudCount(n) : (isChestSelection(name)? '∞' : '');
		const track=!!key && !godMode;
		c.classList.toggle('out', track && n<=0);
		c.classList.toggle('low', track && n>0 && n<10);
		slotEl.classList.toggle('depleted', track && n<=0);
	});
}
// Chest pseudo-entries for hotbar dressing (label + tier accent color)
const HOTBAR_CHEST_DEFS={
	CHEST_COMMON:{label:'skrzynia', color:'#b07f2c'},
	CHEST_RARE:{label:'skrz. rzadka', color:'#a74cc9'},
	CHEST_EPIC:{label:'skrz. epicka', color:'#e0b341'}
};
// Sync each slot's label + color accent with HOTBAR_ORDER. The old static HTML
// labels went stale the moment a slot was remapped to another block type.
function refreshHotbarDom(){
	document.querySelectorAll('#hotbarWrap .hotSlot').forEach((slotEl,i)=>{
		const name=HOTBAR_ORDER[i]; if(!name) return;
		const res=RESOURCE_DEFS.find(r=>r.tile===name);
		const chest=HOTBAR_CHEST_DEFS[name];
		const label=res? res.label.toLowerCase() : (chest? chest.label : name.toLowerCase());
		const color=res? res.color : (chest? chest.color : '#888');
		const lbl=slotEl.querySelector('.lbl')||slotEl.querySelectorAll('span')[1];
		if(lbl) lbl.textContent=label;
		slotEl.setAttribute('aria-label', label+', klawisz '+hotbarKeyLabel(i));
		// resource color as an inset underline — ties the slot to its HUD swatch
		slotEl.style.boxShadow='0 2px 8px rgba(0,0,0,.5), inset 0 -3px 0 '+color;
	});
	updateHotbarCounts();
}
function updateHotbarSel(){
	const bgActive=backgroundBuildMode && isBackgroundBuildTileId(selectedTileId());
	document.querySelectorAll('.hotSlot').forEach((el,i)=>{
		el.classList.toggle('sel', i===hotbarIndex);
		el.classList.toggle('bgMode', bgActive && i===hotbarIndex);
	});
}
// --- Undo system for tile edits ---
const UNDO_LIMIT=200; const undoStack=[]; // {x,y,oldId,newId,kind,drops}
function invKeyForTile(id){ return TILE_TO_RES[id]||null; }
function pushUndo(x,y,oldId,newId,kind,drops,extra){
	if(oldId===newId) return;
	undoStack.push(Object.assign({x,y,oldId,newId,kind,drops:Array.isArray(drops)?drops:null}, extra||{}));
	if(undoStack.length>UNDO_LIMIT){
		undoStack.shift();
	}
}
function undoLastChange(){
	const e=undoStack.pop();
	if(!e){ msg('Brak zmian'); return; }
	if(e.kind==='placeDynamo' && Array.isArray(e.cells)){
		e.cells.forEach(cell=>{
			setTile(cell.x,cell.y,cell.oldId);
			notifyStructureTileChanged(cell.x,cell.y,cell.newId,cell.oldId);
		});
		if(!godMode) inv.dynamo=(inv.dynamo||0)+1;
		updateInventory(); updateHotbarCounts(); saveState(); msg('CofniÄ™to'); return;
	}
	if(e.kind==='breakDynamo' && Array.isArray(e.cells)){
		e.cells.forEach(cell=>{
			setTile(cell.x,cell.y,cell.oldId);
			notifyStructureTileChanged(cell.x,cell.y,cell.newId,cell.oldId);
		});
		if(!godMode) inv.dynamo=Math.max(0,(inv.dynamo||0)-1);
		updateInventory(); updateHotbarCounts(); saveState(); msg('CofniÄ™to'); return;
	}
	if(e.kind==='placeOverlay'){
		if(!hasInfrastructureTile(e.x,e.y,e.newId)){ msg('Nie mozna cofnac'); return; }
		if(WORLD && WORLD.clearInfrastructure) WORLD.clearInfrastructure(e.x,e.y,e.newId);
		const k=invKeyForTile(e.newId);
		if(k && !godMode) inv[k]=(inv[k]||0)+1;
		updateInventory(); updateHotbarCounts(); saveState(); msg('Cofnieto'); return;
	}
	if(e.kind==='breakOverlay'){
		if(hasInfrastructureTile(e.x,e.y,e.oldId)){ msg('Nie mozna cofnac'); return; }
		if(WORLD && WORLD.setInfrastructure) WORLD.setInfrastructure(e.x,e.y,e.oldId);
		if(Array.isArray(e.drops)){
			e.drops.forEach(d=>{
				if(d && d.key && !godMode) inv[d.key]=Math.max(0,(inv[d.key]||0)-((d.n|0)||1));
			});
		}
		updateInventory(); updateHotbarCounts(); saveState(); msg('Cofnieto'); return;
	}
	if(e.kind==='toggleForegroundToBackground'){
		const tile=e.tileId||e.oldId;
		if(getPlayerConstructionBackgroundTile(e.x,e.y)!==tile){ msg('Nie mozna cofnac'); return; }
		const cur=getTile(e.x,e.y);
		if(!isReplaceableNaturalOpenTile(cur,false)){ msg('Nie mozna cofnac'); return; }
		if(cur===T.WATER && WATER && WATER.displaceAt) WATER.displaceAt(e.x,e.y,getTile,setTile);
		if(WORLD && WORLD.clearConstructionBackground) WORLD.clearConstructionBackground(e.x,e.y);
		const prev=isGasTileId(cur)?T.AIR:cur;
		setTile(e.x,e.y,tile);
		notifyForegroundTilePlacedForLayerToggle(e.x,e.y,prev,tile,cur===T.WATER);
		wakeConstructionBackgroundChanged(e.x,e.y);
		saveState(); msg('Cofnieto'); return;
	}
	if(e.kind==='toggleBackgroundToForeground'){
		const tile=e.tileId||e.newId;
		if(getTile(e.x,e.y)!==tile){ msg('Nie mozna cofnac'); return; }
		setTile(e.x,e.y,e.oldId);
		if(WORLD && WORLD.setConstructionBackground) WORLD.setConstructionBackground(e.x,e.y,tile);
		notifyForegroundTileRemovedForLayerToggle(e.x,e.y,tile);
		wakeConstructionBackgroundChanged(e.x,e.y);
		saveState(); msg('Cofnieto'); return;
	}
	if(e.kind==='placeBackground'){
		if(getConstructionBackgroundTile(e.x,e.y)!==e.newId){ msg('Nie mozna cofnac'); return; }
		if(WORLD && WORLD.clearConstructionBackground) WORLD.clearConstructionBackground(e.x,e.y);
		const k=invKeyForTile(e.newId);
		if(k && !godMode) inv[k]=(inv[k]||0)+1;
		wakeConstructionBackgroundChanged(e.x,e.y);
		updateInventory(); updateHotbarCounts(); saveState(); msg('Cofnieto'); return;
	}
	if(e.kind==='breakBackground'){
		if(getConstructionBackgroundTile(e.x,e.y)!==T.AIR){ msg('Nie mozna cofnac'); return; }
		if(WORLD && WORLD.setConstructionBackground) WORLD.setConstructionBackground(e.x,e.y,e.oldId);
		if(Array.isArray(e.drops)){
			e.drops.forEach(d=>{
				if(d && d.key && !godMode) inv[d.key]=Math.max(0,(inv[d.key]||0)-((d.n|0)||1));
			});
		}
		wakeConstructionBackgroundChanged(e.x,e.y);
		updateInventory(); updateHotbarCounts(); saveState(); msg('Cofnieto'); return;
	}
	const cur=getTile(e.x,e.y);
	if(cur!==e.newId){ msg('Nie można cofnąć'); return; }
	if(e.kind==='place'){
		setTile(e.x,e.y,e.oldId);
		if(e.newId===T.VENDING_MACHINE && VENDING && VENDING.onTileRemoved) VENDING.onTileRemoved(e.x,e.y);
		if(e.newId===T.SPRING_PLATFORM && SPRING_PLATFORMS && SPRING_PLATFORMS.onTileChanged) SPRING_PLATFORMS.onTileChanged(e.x,e.y,e.newId,e.oldId,getTile);
		const k=invKeyForTile(e.newId);
		if(k && !godMode) inv[k] = (inv[k]||0)+1;
	} else if(e.kind==='break'){
		setTile(e.x,e.y,e.oldId);
		if(e.oldId===T.VENDING_MACHINE && VENDING && VENDING.onPlaced) VENDING.onPlaced(e.x,e.y,getTile);
		if(e.oldId===T.SPRING_PLATFORM && SPRING_PLATFORMS && SPRING_PLATFORMS.onTileChanged) SPRING_PLATFORMS.onTileChanged(e.x,e.y,e.newId,e.oldId,getTile);
		if(Array.isArray(e.drops)){
			e.drops.forEach(d=>{
				if(d && d.key && !godMode) inv[d.key]=Math.max(0,(inv[d.key]||0)-((d.n|0)||1));
			});
		} else {
			const info=INFO[e.oldId];
			if(info && info.drop && inv[info.drop]>0 && !godMode) inv[info.drop]--;
		}
	}
	if(VOLCANO && VOLCANO.onTileChanged) VOLCANO.onTileChanged(e.x,e.y,getTile(e.x,e.y),getTile,setTile);
	if(FALLING && FALLING.recheckNeighborhood) FALLING.recheckNeighborhood(e.x,e.y);
	if(WATER && WATER.onTileChanged) WATER.onTileChanged(e.x,e.y,getTile);
	updateInventory();
	updateHotbarCounts();
	saveState();
	msg('Cofnięto');
}
window.addEventListener('keydown',ev=>{ if(isEditableTarget(ev.target) || modalInputOpen() || ev.repeat) return; if(ev.key==='z' && !ev.ctrlKey && !ev.metaKey){ undoLastChange(); } });
// (legacy saveState/loadState removed – unified saveGame/loadGame used everywhere)
// Hotbar slot click: select OR (Shift/click again) open type remap popup
const hotSelectMenu=document.getElementById('hotSelectMenu');
const hotSelectOptions=document.getElementById('hotSelectOptions');
function closeHotSelect(){ if(hotSelectMenu){ hotSelectMenu.style.display='none'; } }
function openHotSelect(slot,anchorEl){ if(!hotSelectMenu) return; hotSelectOptions.innerHTML='';
	if(MM.groupedHotSelect) return MM.groupedHotSelect(slot,anchorEl);
	const baseTypes=RESOURCE_DEFS.filter(r=>r.tile).map(r=>({k:r.tile, label:r.label}));
	let types=[...baseTypes];
	if(godMode){ types.push({k:'CHEST_COMMON',label:'Skrzynia zwykła',col:'#b07f2c'}); types.push({k:'CHEST_RARE',label:'Skrzynia rzadka',col:'#a74cc9'}); types.push({k:'CHEST_EPIC',label:'Skrzynia epicka',col:'#e0b341'}); }
	types.forEach(t=>{ const b=document.createElement('button'); b.textContent=t.label; const baseBg='rgba(255,255,255,.08)'; const rareBg=t.col? t.col+'33': baseBg; const border=t.col? t.col+'88':'rgba(255,255,255,.15)'; b.style.cssText='text-align:left; background:'+rareBg+'; border:1px solid '+border+'; color:#fff; border-radius:8px; padding:4px 8px; cursor:pointer; font-size:12px;'; if(HOTBAR_ORDER[slot]===t.k) b.style.outline='2px solid #2c7ef8'; b.addEventListener('click',()=>{ HOTBAR_ORDER[slot]=t.k; closeHotSelect(); cycleHotbar(slot); msg('Slot '+hotbarKeyLabel(slot)+' -> '+t.label); }); hotSelectOptions.appendChild(b); });
	const rect=anchorEl.getBoundingClientRect(); hotSelectMenu.style.display='block'; hotSelectMenu.style.left=(rect.left + rect.width/2)+'px'; hotSelectMenu.style.top=(rect.top - 8)+'px'; hotSelectMenu.style.transform='translate(-50%,-100%)'; }
const HOT_SELECT_GROUPS=[
	{id:'basic',label:'Podstawowe',tiles:['GRASS','SAND','CLAY','DIRT','STONE','WOOD','LEAF','SNOW','WATER']},
	{id:'rock',label:'Skały i rudy',tiles:['GRANITE','BASALT','COAL','GOLD_ORE','OBSIDIAN','DIAMOND','IRIDIUM','METEORIC_IRON','RADIOACTIVE_ORE','METEOR_DUST','ANTIMATTER_CRYSTAL']},
	{id:'build',label:'Budulce',tiles:['BRICK','CHIMNEY','GLASS','WOOD_DOOR','STONE_DOOR','STEEL_DOOR','WOOD_TRAPDOOR','STONE_TRAPDOOR','STEEL_TRAPDOOR','STEEL','CHAIR_WOOD','CHAIR_STONE','CHAIR_STEEL','ALIEN_BIOMASS','VOLCANO_MASTER_STONE','SERVANT_STONE']},
		{id:'machine',label:'Maszyny',tiles:['DYNAMO','SOLAR_PANEL','SOLAR_BATTERY','SPRING_PLATFORM','TRACK','VENDING_MACHINE','TELEPORTER','ANTIGRAVITY_BEACON','METEOR_SIREN','TURRET','FIRE_TURRET','WATER_TURRET']},
	{id:'utility',label:'Instalacje',tiles:['WIRE','COPPER_WIRE','WATER_PIPE','LADDER','WATER_PUMP','TRANSISTOR','TORCH','RESPAWN_TOTEM']},
	{id:'food',label:'Jedzenie',tiles:['MEAT','ROTTEN_MEAT','BAKED_MEAT']},
	{id:'chest',label:'Skrzynie',tiles:['CHEST_COMMON','CHEST_RARE','CHEST_EPIC']},
	{id:'other',label:'Inne',tiles:[]}
];
const HOT_SELECT_GROUP_BY_TILE=new Map();
HOT_SELECT_GROUPS.forEach(g=>g.tiles.forEach(t=>HOT_SELECT_GROUP_BY_TILE.set(t,g.id)));
function hotSelectGroupId(tileKey){ return HOT_SELECT_GROUP_BY_TILE.get(tileKey) || 'other'; }
function hotSelectCount(t){
	if(t.chest) return godMode ? '\u221e' : '';
	if(!t.resKey) return '';
	return godMode ? '\u221e' : String(inv[t.resKey]||0);
}
function makeHotSelectButton(t,slot){
	const b=document.createElement('button');
	const baseBg='rgba(255,255,255,.075)';
	const rareBg=t.col? t.col+'2e':baseBg;
	const border=t.col? t.col+'78':'rgba(255,255,255,.13)';
	b.style.cssText='display:flex; align-items:center; justify-content:space-between; gap:10px; text-align:left; background:'+rareBg+'; border:1px solid '+border+'; color:#fff; border-radius:8px; padding:5px 8px; cursor:pointer; font-size:12px; min-height:28px;';
	if(HOTBAR_ORDER[slot]===t.k) b.style.outline='2px solid #2c7ef8';
	const lab=document.createElement('span');
	lab.textContent=t.label;
	lab.style.cssText='min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
	b.appendChild(lab);
	const count=hotSelectCount(t);
	if(count){
		const qty=document.createElement('span');
		qty.textContent=count;
		qty.style.cssText='font-size:11px; opacity:.72; flex:0 0 auto;';
		b.appendChild(qty);
	}
	b.addEventListener('click',()=>{ HOTBAR_ORDER[slot]=t.k; closeHotSelect(); cycleHotbar(slot); msg('Slot '+hotbarKeyLabel(slot)+' -> '+t.label); });
	return b;
}
function appendHotSelectGroup(group,items,slot,isOpen){
	if(!items.length) return;
	const section=document.createElement('details');
	section.open=!!isOpen;
	section.style.cssText='border:1px solid rgba(255,255,255,.10); border-radius:9px; background:rgba(255,255,255,.045); overflow:hidden;';
	const summary=document.createElement('summary');
	summary.textContent=group.label+' ('+items.length+')';
	summary.style.cssText='cursor:pointer; padding:6px 8px; font-weight:600; color:#fff; opacity:.9; user-select:none;';
	section.appendChild(summary);
	const body=document.createElement('div');
	body.style.cssText='display:flex; flex-direction:column; gap:4px; padding:0 6px 6px;';
	items.forEach(t=>body.appendChild(makeHotSelectButton(t,slot)));
	section.appendChild(body);
	section.addEventListener('toggle',()=>{
		if(section.open && hotSelectOptions){
			requestAnimationFrame(()=>section.scrollIntoView({block:'nearest'}));
		}
	});
	hotSelectOptions.appendChild(section);
}
function openHotSelectGrouped(slot,anchorEl){ if(!hotSelectMenu) return; hotSelectOptions.innerHTML='';
	const baseTypes=RESOURCE_DEFS.filter(r=>r.tile).map(r=>({k:r.tile,label:r.label,col:r.color,resKey:r.key}));
	const types=[...baseTypes];
	if(godMode){
		types.push({k:'CHEST_COMMON',label:'Skrzynia zwykła',col:'#b07f2c',chest:true});
		types.push({k:'CHEST_RARE',label:'Skrzynia rzadka',col:'#a74cc9',chest:true});
		types.push({k:'CHEST_EPIC',label:'Skrzynia epicka',col:'#e0b341',chest:true});
	}
	const grouped=new Map(HOT_SELECT_GROUPS.map(g=>[g.id,[]]));
	types.forEach(t=>{
		const gid=hotSelectGroupId(t.k);
		if(!grouped.has(gid)) grouped.set(gid,[]);
		grouped.get(gid).push(t);
	});
	const currentGroup=hotSelectGroupId(HOTBAR_ORDER[slot]);
	let opened=false;
	HOT_SELECT_GROUPS.forEach(g=>{
		const items=grouped.get(g.id)||[];
		const open=!opened && (g.id===currentGroup || (currentGroup==='other' && g.id==='basic'));
		if(items.length && open) opened=true;
		appendHotSelectGroup(g,items,slot,open);
	});
	const rect=anchorEl.getBoundingClientRect(); hotSelectMenu.style.display='flex'; hotSelectMenu.style.left=(rect.left + rect.width/2)+'px'; hotSelectMenu.style.top=(rect.top - 8)+'px'; hotSelectMenu.style.transform='translate(-50%,-100%)'; }
MM.groupedHotSelect=openHotSelectGrouped;
document.addEventListener('click',e=>{ if(hotSelectMenu && hotSelectMenu.style.display!=='none'){ if(!hotSelectMenu.contains(e.target) && !(e.target.closest && e.target.closest('.hotSlot'))){ closeHotSelect(); } }});
// Shift+click or a second click/tap on the already-selected slot opens the remap menu
// (previously Shift-only outside god mode, which made remapping impossible on touch)
document.querySelectorAll('.hotSlot').forEach((el,i)=>{ el.addEventListener('click',e=>{ if(e.shiftKey || hotbarIndex===i) { openHotSelect(i,el); } else { cycleHotbar(i); } }); });
// Left click mining convenience
// Simple particle + sound system extracted to engine module
function spawnBurst(x,y,tier,opts){ if(PARTICLES && PARTICLES.spawnBurst) PARTICLES.spawnBurst(x,y,tier,opts); }
function updateParticles(dt){ if(PARTICLES && PARTICLES.update) PARTICLES.update(dt,TILE,getTile); }
function drawParticles(){ if(PARTICLES && PARTICLES.draw) PARTICLES.draw(ctx,worldFxVisible,TILE); }

canvas.addEventListener('pointerdown',e=>{
	if(modalInputOpen()){ e.preventDefault(); return; }
	noteSaveActivity();
	if(touchHold && e.pointerId!==touchHold.id) cancelTouchHold(); // a second finger is not a long-press
	activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
	if(activePointers.size===2){
		// Second finger down → pinch zoom; abort the mining gesture from the first finger
		minePointerId=null; stopMining();
		const pts=[...activePointers.values()];
		pinch={d:Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y)||1, z:zoomTarget};
		return;
	}
	if(activePointers.size>2 || pinch) return;
	lastPointer.x=e.clientX; lastPointer.y=e.clientY; lastPointer.has=true;
	const {tx,ty}=screenToWorldTile(e.clientX,e.clientY);
	const weaponMode=!isToolMode();
	if(e.button===0){
		if(assignCompanionHarvestTargetAt(tx,ty)) return;
		if(weaponMode){
			weaponPointerId=e.pointerId;
			const aim=screenToWorld(e.clientX,e.clientY);
			const it=activeWeaponItem();
			if(WEAPONS && WEAPONS.fireHeld && WEAPONS.fireHeld(player, aim.x, aim.y, 0.016)) notifyInvasionWeaponUse(it,{held:true});
			return;
		}
		// Left click: adjacent melee first, else open chest, else mine the clicked tile.
		// The pointer stays registered so holding/dragging keeps mining (see updateMining).
		minePointerId=e.pointerId;
		const dxRange = Math.abs(tx - Math.floor(player.x)); const dyRange=Math.abs(ty - Math.floor(player.y));
		// Equipped weapon/charm bonus damage on top of base melee / tool damage
		const atkBonus=(MM.activeModifiers && MM.activeModifiers.attackDamage)||0;
		if(dxRange<=MELEE_REACH && dyRange<=MELEE_REACH && player.atkCd<=0 && ((CENTER_GUARDIAN && CENTER_GUARDIAN.attackAt && CENTER_GUARDIAN.attackAt(tx,ty,atkBonus)) || (GUARDIANS && GUARDIANS.attackAt && GUARDIANS.attackAt(tx,ty,atkBonus)) || (UNDERGROUND && UNDERGROUND.attackAt && UNDERGROUND.attackAt(tx,ty,atkBonus)) || (SKY_GUARDIAN && SKY_GUARDIAN.attackAt && SKY_GUARDIAN.attackAt(tx,ty,atkBonus)) || (BOSSES && BOSSES.attackAt && BOSSES.attackAt(tx,ty,atkBonus)) || (INVASIONS && INVASIONS.attackAt && INVASIONS.attackAt(tx,ty,atkBonus)) || (MECHS && MECHS.attackAt && MECHS.attackAt(tx,ty,atkBonus,{source:'hero'})) || (NPCS && NPCS.attackAt && NPCS.attackAt(tx,ty,atkBonus,tutorialNpcCtx)) || (MOBS && MOBS.attackAt && MOBS.attackAt(tx,ty,atkBonus,{source:'hero'})))){ player.atkCd=0.35; if(WEAPONS && WEAPONS.notifyMeleeSwing) WEAPONS.notifyMeleeSwing(tx,ty,player); return; }
		// The center's confession/epilogue dialogue outranks ordinary NPC talk: the
		// obelisk (and the mentor standing at it) belongs to the story while it speaks.
		if(CENTER_GUARDIAN && CENTER_GUARDIAN.interactAt && CENTER_GUARDIAN.interactAt(tx,ty,player)) return;
		// Click an NPC (non-duel) to talk: they speak the next line in their repertoire.
		if(NPCS && NPCS.interactAt && NPCS.interactAt(tx,ty,player,tutorialNpcCtx)) return;
		if(tryUseVendingAt(tx,ty)) return;
		if(ALTAR && ALTAR.tryUseAt && dxRange<=3 && dyRange<=3 && ALTAR.tryUseAt(tx,ty,{getTile,inv,player,gameDayFloat:tutorialNpcCtx.gameDayFloat,onInventoryChange:updateInventory,onChange:saveState})) return;
		if(tryOpenChestAt(tx,ty)) return;
		if(tryOpenInvasionCacheAt(tx,ty)) return;
		if(dxRange<=3 && dyRange<=3 && tryOpenGraveAt(tx,ty)) return;
		// plants: harvest ripe berries / clear vegetation before digging the tile behind it
		if(dxRange<=3 && dyRange<=3 && PLANTS && PLANTS.harvestAt && PLANTS.harvestAt(tx,ty)){ try{ if(MM.audio && MM.audio.play) MM.audio.play('harvest'); }catch(e){} return; }
		startMineAt(tx,ty,{quiet:true});
		if(e.pointerType==='touch') armTouchHold(e); // hold in place → block placement (iOS-safe)
	} else if(e.button===2){
		e.preventDefault();
		lastRightPlaceT=performance.now();
		if(COMPANIONS && COMPANIONS.commandAt && COMPANIONS.commandAt(tx,ty,player)){
			noteSaveActivity();
			saveState();
			return;
		}
		if(weaponMode){
			const aim=screenToWorld(e.clientX,e.clientY);
			const it=activeWeaponItem();
			tryWeaponUltOrDefend(player, aim.x, aim.y, it, e.pointerId, 'mouse');
			return;
		}
		useToolSecondaryAt(tx,ty);
	}
});
canvas.addEventListener('pointermove',e=>{
	lastPointer.x=e.clientX; lastPointer.y=e.clientY; lastPointer.has=true;
	if(touchHold && e.pointerId===touchHold.id && (Math.abs(e.clientX-touchHold.x)>TOUCH_HOLD_SLOP || Math.abs(e.clientY-touchHold.y)>TOUCH_HOLD_SLOP)) cancelTouchHold(); // drag = mining gesture
	const ap=activePointers.get(e.pointerId);
	if(ap){ noteSaveActivity(); ap.x=e.clientX; ap.y=e.clientY;
		if(pinch && activePointers.size>=2){
			const pts=[...activePointers.values()];
			const d=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y)||1;
			setZoom(pinch.z * d/pinch.d);
		}
	}
});
canvas.addEventListener('pointerleave',()=>{ lastPointer.has=false; });

// Render
function draw(){ // Background first
 resetFrameCanvasState();
 const renderCam=currentRenderCamera();
 drawBackground();
 const meteorShake=(METEORITES && METEORITES.screenShakeOffset) ? METEORITES.screenShakeOffset(performance.now()) : null;
 const combatShake=combatScreenShakeOffset(performance.now());
 const screenShake=combineScreenShakes(meteorShake,combatShake);
 // Keep simulation camera continuous, but render on the device-pixel grid. This
 // removes subpixel shimmer without snapping the camera to whole tile pixels.
 const camRenderX = renderCam.x;
 const camRenderY = renderCam.y;
 const viewX=Math.ceil(W/(TILE*zoom)); const viewY=Math.ceil(H/(TILE*zoom)); const renderDetail=renderDetailFor(zoom,viewX,viewY); publishRenderDetail(renderDetail,zoom); const sx=Math.floor(camRenderX)-1; const sy=Math.floor(camRenderY)-1; infrastructureOverlayFrameCache=null; ctx.save(); if(screenShake && (screenShake.x || screenShake.y)) ctx.translate(screenShake.x,screenShake.y); ctx.scale(zoom,zoom);
 ctx.translate(-camRenderX*TILE,-camRenderY*TILE);
 ctx.imageSmoothingEnabled=false; // avoid anti-alias gaps
 try {
 // render tiles (solids + passables) first
 drawWorldVisible(sx,sy,viewX,viewY,{camX:camRenderX,camY:camRenderY,shake:screenShake});
 drawInfrastructureOverlays(sx,sy,viewX,viewY,{only:T.LADDER});
 drawDoorOpenOverlays(sx,sy,viewX,viewY);
 // weather layer: clouds, rain/snow, lightning, evaporation mist (world-space, sky)
 if(CLOUDS && CLOUDS.draw) CLOUDS.draw(ctx,TILE,getTile,sx,sy,viewX,viewY);
 drawFallingBlocks();
 // cape behind player body but above tiles
 drawCape();
 if(GENERATED_NPCS && GENERATED_NPCS.draw) GENERATED_NPCS.draw(ctx,TILE,worldFxVisible,getTile,WORLDGEN);
 // player body + overlays (back pass for vegetation done earlier)
 drawPlayer();
 // equipped weapon in hand (melee blades sweep during a swing)
 if(!deathTravelFx && WEAPONS && WEAPONS.drawHeld) WEAPONS.drawHeld(ctx,TILE,player);
 if(NPCS && NPCS.draw) NPCS.draw(ctx,TILE,worldFxVisible);
 // living plants (rooted vegetation over terrain, under fire/creatures)
 if(PLANTS && PLANTS.draw) PLANTS.draw(ctx,TILE,sx,sy,viewX,viewY,worldFxVisible);
 // burning tiles + lava glow (flames over terrain, under mobs so creatures stay readable)
 if(FIRE && FIRE.draw) FIRE.draw(ctx,TILE,sx,sy,viewX,viewY,getTile,worldFxVisibility());
 // volcano hazards and story-item effects (over terrain, under creatures)
 if(VOLCANO && VOLCANO.draw) VOLCANO.draw(ctx,TILE,worldFxVisible,getTile);
 // world gases (steam, poison, fuel, hot air) drift over terrain and obey fog
 if(GASES && GASES.draw) GASES.draw(ctx,TILE,sx,sy,viewX,viewY,worldFxVisible);
 // visible wind: bounded dust/snow streaks, hidden by fog
 if(WIND && WIND.draw) WIND.draw(ctx,TILE,sx,sy,viewX,viewY,worldFxVisible);
 // ruin surface markers dressed as worked masonry (mortar, moss, etched rune)
 if(RUINS && RUINS.drawHints) RUINS.drawHints(ctx,TILE,worldFxVisible);
 if(ALIEN_RUINS && ALIEN_RUINS.drawHints) ALIEN_RUINS.drawHints(ctx,TILE,worldFxVisible);
 // ruin-trap telltales + live effects (darts, gas) — over tiles, under mobs
 if(TRAPS && TRAPS.draw) TRAPS.draw(ctx,TILE,worldFxVisible);
 if(TERRAIN_TRAPS && TERRAIN_TRAPS.draw) TERRAIN_TRAPS.draw(ctx,TILE,worldFxVisible);
 if(AFTERMATH && AFTERMATH.draw) AFTERMATH.draw(ctx,TILE,worldFxVisible,camRenderX,camRenderY,W,H,zoom);
 // mobs
 if(MOBS && MOBS.draw) MOBS.draw(ctx,TILE,camRenderX,camRenderY,zoom,worldFxVisible);
 if(INVASIONS && INVASIONS.draw) INVASIONS.draw(ctx,TILE,worldFxVisible);
 if(MECHS && MECHS.draw) MECHS.draw(ctx,TILE,worldFxVisible);
 if(COMPANIONS && COMPANIONS.draw) COMPANIONS.draw(ctx,TILE,camRenderX,camRenderY,zoom,worldFxVisible);
 if(GUARDIANS && GUARDIANS.draw) GUARDIANS.draw(ctx,TILE,worldFxVisible,camRenderX,camRenderY,W,H,zoom);
 if(UNDERGROUND && UNDERGROUND.draw) UNDERGROUND.draw(ctx,TILE,worldFxVisible,camRenderX,camRenderY,W,H,zoom);
 if(SKY_GUARDIAN && SKY_GUARDIAN.draw) SKY_GUARDIAN.draw(ctx,TILE,worldFxVisible,camRenderX,camRenderY,W,H,zoom);
 if(CENTER_GUARDIAN && CENTER_GUARDIAN.draw) CENTER_GUARDIAN.draw(ctx,TILE,worldFxVisible,camRenderX,camRenderY,W,H,zoom);
 // boss monsters (multi-part procedural creatures, world-space)
 if(BOSSES && BOSSES.draw) BOSSES.draw(ctx,TILE,worldFxVisible);
 // visiting saucer + tractor beam (above creatures — the beam shines over its victim)
 if(UFO && UFO.draw) UFO.draw(ctx,TILE,worldFxVisible);
 // weapon projectiles: arrows + flamethrower stream (above creatures)
 if(WEAPONS && WEAPONS.draw) WEAPONS.draw(ctx,TILE,worldFxVisible);
 // meteors, impact shockwaves and hot crater smoke
 if(METEORITES && METEORITES.draw) METEORITES.draw(ctx,TILE,worldFxVisible);
  // particles (screen-space in world coords)
  drawParticles();
  drawCombatImpactFx();
  // front vegetation pass (blades/leaves that should appear in front)
 if(VISUAL.animations && GRASS && GRASS.drawOverlays){ GRASS.drawOverlays(ctx,'front', sx,sy,viewX,viewY,TILE,worldMaxY(),getTile,T,zoom,grassDensityScalar,grassHeightScalar,worldFxVisible,worldMinY()); }
 // Water overlay shimmer (after vegetation front to avoid overdraw? place before falling solids for clarity)
 if(WATER){ WATER.drawOverlay(ctx,TILE,getTile,sx,sy,viewX,viewY,worldFxVisible); }
 // fishing line + bobber float on the finished water surface
 if(FISHING && FISHING.draw) FISHING.draw(ctx,TILE,player,worldFxVisible);
 // wooden rafts ride the finished water surface (above the shimmer, below the hero)
 if(BOATS && BOATS.draw) BOATS.draw(ctx,TILE,worldFxVisible);
 drawInfrastructureOverlays(sx,sy,viewX,viewY,{exclude:T.LADDER});
 // Draw falling solids after terrain so they appear on top
 if(FALLING){ FALLING.draw(ctx,TILE,worldFxVisible); }
 if(SOLAR && SOLAR.draw) SOLAR.draw(ctx,TILE,sx,sy,viewX,viewY,worldFxVisible,getTile);
 if(DYNAMO && DYNAMO.draw) DYNAMO.draw(ctx,TILE,sx,sy,viewX,viewY,worldFxVisible,getTile);
 if(TELEPORTERS && TELEPORTERS.draw) TELEPORTERS.draw(ctx,TILE,sx,sy,viewX,viewY,worldFxVisible,getElectricNetworkTile);
 if(PUMPS && PUMPS.draw) PUMPS.draw(ctx,TILE,sx,sy,viewX,viewY,worldFxVisible,getFluidNetworkTile);
 if(TURRETS && TURRETS.draw) TURRETS.draw(ctx,TILE,sx,sy,viewX,viewY,worldFxVisible,getTile);
 if(SPRING_PLATFORMS && SPRING_PLATFORMS.draw) SPRING_PLATFORMS.draw(ctx,TILE,sx,sy,viewX,viewY,worldFxVisible,getElectricNetworkTile);
 if(VENDING && VENDING.draw) VENDING.draw(ctx,TILE,sx,sy,viewX,viewY,worldFxVisible,getTile,{dynamo:DYNAMO,solar:SOLAR,teleporters:TELEPORTERS,getElectricNetworkTile,gameDayFloat:currentGameDayFloat});
 // Cave darkness overlay: darkens unlit underground before UI-ish indicators,
 // so the ghost preview, mining progress and fog (final occlusion) stay on top.
 drawLightingOverlay(sx,sy,viewX,viewY,{camX:camRenderX,camY:camRenderY,shake:screenShake});
 // Ghost block preview — recomputed each frame so camera motion can't leave it stale.
 // Green = placement allowed right now; red = blocked (reach/support/no blocks).
 if(isToolMode() && lastPointer.has && !pinch && !mining){
	 const gp=screenToWorldTile(lastPointer.x,lastPointer.y);
	 const curT=getTile(gp.tx,gp.ty);
	 const placingDynamo=selectedTileId()===T.DYNAMO;
	 const placingInfrastructure=isInfrastructureTileId(selectedTileId());
	 const placingBackground=backgroundBuildMode && isBackgroundBuildTileId(selectedTileId());
	 if(placingBackground || placingInfrastructure || placingDynamo || isReplaceableNaturalOpenTile(curT,false)){
		 const v=canPlaceAt(gp.tx,gp.ty);
		 ctx.strokeStyle= v.ok? (v.background?'rgba(120,220,255,0.82)':'rgba(140,255,140,0.7)'):'rgba(255,110,110,0.6)';
		 ctx.lineWidth=1;
		 const cells=Array.isArray(v.cells) ? v.cells : [{x:gp.tx,y:gp.ty}];
		 cells.forEach(cell=>{
			 if(v.background && v.ok){
				 ctx.fillStyle='rgba(90,190,255,0.16)';
				 ctx.fillRect(cell.x*TILE+2, cell.y*TILE+2, TILE-4, TILE-4);
			 }
			 ctx.strokeRect(cell.x*TILE+0.5, cell.y*TILE+0.5, TILE-1, TILE-1);
		 });
		 const pressureCells=Array.isArray(v.pressureCells) ? v.pressureCells.slice(0,16) : [];
		 if(pressureCells.length){
			 ctx.save();
			 pressureCells.forEach(cell=>{
				 const px=cell.x*TILE, py=cell.y*TILE;
				 const danger=Math.max(0,Math.min(1,Number(cell.ratio)||0));
				 ctx.fillStyle='rgba(255,205,92,'+(0.08+0.12*danger).toFixed(3)+')';
				 ctx.fillRect(px+2,py+2,TILE-4,TILE-4);
				 ctx.strokeStyle=v.ok ? 'rgba(255,226,130,0.92)' : 'rgba(255,154,98,0.96)';
				 ctx.lineWidth=Math.max(1,TILE*0.045);
				 ctx.strokeRect(px+3,py+3,Math.max(1,TILE-6),Math.max(1,TILE-6));
				 ctx.strokeStyle='rgba(255,250,212,0.88)';
				 ctx.lineWidth=Math.max(1,TILE*0.028);
				 ctx.beginPath();
				 ctx.moveTo(px+TILE*0.30,py+TILE*0.38);
				 ctx.lineTo(px+TILE*0.50,py+TILE*0.62);
				 ctx.lineTo(px+TILE*0.70,py+TILE*0.38);
				 ctx.moveTo(px+TILE*0.34,py+TILE*0.58);
				 ctx.lineTo(px+TILE*0.50,py+TILE*0.76);
				 ctx.lineTo(px+TILE*0.66,py+TILE*0.58);
				 ctx.stroke();
			 });
			 ctx.restore();
		 }
		 if(!v.ok && v.reason){
			 const lx=Math.min(...cells.map(c=>c.x))*TILE;
			 const ly=(Math.min(...cells.map(c=>c.y))*TILE)-6;
			 ctx.save();
			 ctx.font='10px system-ui';
			 ctx.textBaseline='bottom';
			 const text=String(v.reason);
			 const tw=ctx.measureText(text).width;
			 ctx.fillStyle='rgba(12,8,8,0.72)';
			 ctx.fillRect(lx-2,ly-13,tw+8,13);
			 ctx.fillStyle='rgba(255,210,210,0.96)';
			 ctx.fillText(text,lx+2,ly-2);
			 ctx.restore();
		 }
	 }
 }
 if(mining){ ctx.strokeStyle='#fff'; ctx.strokeRect(mineTx*TILE+1,mineTy*TILE+1,TILE-2,TILE-2); const info=mineInfoForId(mineTileIdAt(mineTx,mineTy))||{hp:1}; const need=Math.max(0.1,info.hp/6); const p=mineTimer/need; ctx.fillStyle='rgba(255,255,255,.3)'; ctx.fillRect(mineTx*TILE, mineTy*TILE + (1-p)*TILE, TILE, p*TILE); }
 drawWorldNumbers();
 // Final world-space occlusion. Keep this after late overlays (especially water)
 // so unexplored tiles cannot leak through the fog layer.
 drawFogOverlay(sx,sy,viewX,viewY,{camX:camRenderX,camY:camRenderY,shake:screenShake});
 } finally {
	 ctx.restore();
 }
	// (Underwater tint/vignette removed: darkening the screen while submerged
	// added no information and players found it distracting.)
	// Screen-space atmospheric tint (after world scaling restore)
	applyAtmosphericTint();
	drawCombatScreenFx();
	if(METEORITES && METEORITES.drawScreen) METEORITES.drawScreen(ctx,W,H);
	// Off-screen monster pointer (screen space, after the world transform is gone)
	const taskPointerDrawn=(TASKS && TASKS.drawHUD) ? TASKS.drawHUD(ctx,W,H,camRenderX,camRenderY,zoom,TILE,worldFxVisible,player) : false;
	if(!taskPointerDrawn && BOSSES && BOSSES.drawHUD) BOSSES.drawHUD(ctx,W,H,camRenderX,camRenderY,zoom,TILE,worldFxVisible);
	if(GUARDIANS && GUARDIANS.drawHUD) GUARDIANS.drawHUD(ctx,W,H,camRenderX,camRenderY,zoom,TILE,worldFxVisible);
	if(UNDERGROUND && UNDERGROUND.drawHUD) UNDERGROUND.drawHUD(ctx,W,H,camRenderX,camRenderY,zoom,TILE,worldFxVisible);
	if(SKY_GUARDIAN && SKY_GUARDIAN.drawHUD) SKY_GUARDIAN.drawHUD(ctx,W,H,camRenderX,camRenderY,zoom,TILE,worldFxVisible);
	if(CENTER_GUARDIAN && CENTER_GUARDIAN.drawHUD) CENTER_GUARDIAN.drawHUD(ctx,W,H,camRenderX,camRenderY,zoom,TILE,worldFxVisible);
	// HUD: vitals cluster (HP / energy / level+XP / buffs) — engine/vitals_hud.js
	ctx.save();
	{
		const lv=(MM.progress && MM.progress.level)? MM.progress.level() : {level:1,into:player.xp||0,need:60};
		const pts=(MM.progress && MM.progress.points)? MM.progress.points():0;
		const bf=(MM.progress && MM.progress.getBuffs)? MM.progress.getBuffs():[];
		VITALS_HUD.draw(ctx,{
			W,H,
			hp:player.hp, maxHp:player.maxHp,
			energy:player.energy||0, energyMax:player.maxEnergy||heroEnergyCapacity(),
			level:lv, points:pts, buffs:bf
		});
	}
	// damage flash overlay
	{
		const flashLeft=(player.hurtFlashUntil||0)-performance.now();
		if(flashLeft>0){
			const alpha=0.25*Math.max(0,Math.min(1,flashLeft/HURT_FLASH_MS));
			ctx.fillStyle='rgba(255,0,0,'+alpha.toFixed(3)+')';
			ctx.fillRect(0,0,W,H);
		}
	}
	ctx.restore();

	drawMinimap();
	// Optional Performance HUD
	if(showPerfHud){
		const vx=Math.ceil(W/(TILE*zoom));
		const vy=Math.ceil(H/(TILE*zoom));
		const minChunk=Math.floor(camX/CHUNK_W)-1;
		const maxChunk=Math.floor((camX+vx+2)/CHUNK_W)+1;
		const visChunks=(maxChunk-minChunk+1);
		const biomeId = (WORLDGEN && WORLDGEN.biomeType)? WORLDGEN.biomeType(Math.floor(player.x)) : null;
		const biomeName = biomeId!=null? (BIOME_NAMES[biomeId]||('Biome '+biomeId)) : 'Biome -';
		const lines=[
			'FPS: '+(currentFps||'~')+' ('+lastFrameMs.toFixed(1)+'ms)  Zoom: '+zoom.toFixed(2)+'  Detail: '+currentRenderDetail.label,
			'Perf: sim '+framePerf.simMs.toFixed(1)+'ms  draw '+framePerf.drawMs.toFixed(1)+'ms  pace '+framePerf.avgFrameMs.toFixed(1)+'+/-'+framePerf.jitterMs.toFixed(1)+'ms  max '+framePerf.maxFrameMs.toFixed(1)+'ms  long '+framePerf.longFrames,
			'Pos: '+player.x.toFixed(2)+','+player.y.toFixed(2)+'  Tile: '+(Math.floor(player.x))+','+(Math.floor(player.y)),
			'Cam: '+camX.toFixed(2)+','+camY.toFixed(2)+'  View: '+vx+'x'+vy+' tiles',
			'Biome: '+biomeName+'  Chunks: '+visChunks+' vis / '+chunkCanvases.size+' cache  rebuild '+chunkCacheRebuiltThisFrame+' partial '+chunkCachePartialRebuiltThisFrame+' def '+chunkCacheDeferredThisFrame
		];
		try{
			if(TREES && TREES.metrics){
				const tm=TREES.metrics();
				lines.push('Trees: fall '+tm.fallingTrees+'/'+tm.fallingBlocks+'  debris '+tm.fallen+'  q '+tm.unstableStanding+'/'+tm.unstableFallen+'  litter '+tm.leafLitter);
			}
		}catch(e){}
		// Optional mobs metrics line
		try{
			const worldMetrics = (WORLD && WORLD.metrics)? WORLD.metrics() : null;
			if(worldMetrics){ lines.push('World: '+worldMetrics.chunks+' loaded / '+worldMetrics.modified+' edited  height cache '+worldMetrics.heightCache+'  lake '+worldMetrics.lakeCache); }
		}catch(e){}
		try{
			const waterMetrics = (WATER && WATER.metrics)? WATER.metrics() : null;
			if(waterMetrics){ lines.push('Water: '+waterMetrics.active+' active  springs '+waterMetrics.springs+'  streams '+waterMetrics.streams); }
		}catch(e){}
		try{
			const fm=(FALLING && FALLING.metrics)? FALLING.metrics() : null;
			if(fm){ lines.push('Falling: queue '+fm.queue+'  blocks '+fm.active+'  sand '+fm.sand); }
		}catch(e){}
		try{
			const idleSec=Math.max(0, Math.round((Date.now()-_lastSaveActivityAt)/1000));
			const saveAgeSec=Math.max(0, Math.round((Date.now()-_lastAutoSaveAt)/1000));
			const mode=window.__lastSaveMode? (' '+window.__lastSaveMode) : '';
			const writeMs=window.__lastSaveWriteMs!=null ? (' write '+Math.round(window.__lastSaveWriteMs)+'ms') : '';
			const saveParts=Array.isArray(window.__lastSavePerfParts) && window.__lastSavePerfParts.length ? ('  slow '+window.__lastSavePerfParts.slice(0,4).map(p=>p.label+' '+Math.round(p.ms)+'ms').join(', ')) : '';
			lines.push('Save: '+(_saveDirty?'dirty':'clean')+(_saveStateT?' pending':'')+'  last '+Math.round(window.__lastSaveMs||0)+'ms'+mode+writeMs+' / '+(window.__lastSaveSizeKb||0)+'KB / '+(window.__lastSaveChunks||0)+' chunks  idle '+idleSec+'s  auto '+saveAgeSec+'s ago'+saveParts);
		}catch(e){}
		try{
			const mm = (MOBS && MOBS.metrics)? MOBS.metrics() : null;
			if(mm){ lines.push('Mobs: '+mm.count+' live, ~'+mm.active+' active  dt '+(mm.dtAvg*1000).toFixed(1)+'ms'); }
		}catch(e){}
		try{
			const im = (INVASIONS && INVASIONS.metrics)? INVASIONS.metrics() : null;
			if(im && (im.activeTeams || im.caches || im.aliens || im.molekin)){ lines.push('Invasions: '+im.activeTeams+'/'+im.teams+' teams  aliens '+im.aliens+'  molekin '+(im.molekin||0)+'  caches '+im.caches+'  lasers '+im.lasers); }
		}catch(e){}
		try{
			const cm = (COMPANIONS && COMPANIONS.metrics)? COMPANIONS.metrics() : null;
			if(cm && cm.count){ lines.push('Pomocnicy: '+cm.count+'  HP '+cm.hp+'/'+cm.maxHp+'  biomasa '+cm.biomass+'  lasery '+cm.lasers); }
		}catch(e){}
		try{
			const bm = (BOSSES && BOSSES.metrics)? BOSSES.metrics() : null;
			if(bm){ lines.push('Bosses: '+bm.alive+' alive ('+bm.parts+' parts)  spawned '+bm.spawned+' / killed '+bm.killed+(bm.nextIn!=null? '  next ~'+Math.ceil(bm.nextIn)+'s':'')); }
		}catch(e){}
		try{
			const wm = (WEAPONS && WEAPONS.metrics)? WEAPONS.metrics() : null;
			const fc = (FIRE && FIRE.count)? FIRE.count() : 0;
			if(wm && (wm.arrows||wm.puffs||fc)){ lines.push('Weapons: '+wm.arrows+' arrows, '+wm.puffs+' puffs  Fire: '+fc+' tiles'); }
		}catch(e){}
		try{
			const pm = (PARTICLES && PARTICLES.metrics)? PARTICLES.metrics() : null;
			const vm = (VOLCANO && VOLCANO.metrics)? VOLCANO.metrics() : null;
			const mt = (METEORITES && METEORITES.metrics)? METEORITES.metrics() : null;
			const gm = (GASES && GASES.metrics)? GASES.metrics() : null;
			const wm = (WIND && WIND.metrics)? WIND.metrics() : null;
			const lava = (FIRE && FIRE.lavaCount)? FIRE.lavaCount() : 0;
			const meteorNext=mt ? (Number.isFinite(mt.nextInDays) ? mt.nextInDays+'d' : mt.nextIn+'s') : '';
			if(pm || vm || mt || gm || wm || lava){ lines.push('FX: particles '+(pm?pm.particles:0)+' smoke '+(pm?pm.smoke:0)+'/'+(pm?pm.smokeCap:0)+' windFx '+(wm?wm.particles:0)+'/'+(wm?wm.particleCap:0)+' lava '+lava+' gas '+(gm?gm.active:0)+' (s '+(gm?gm.steam:0)+', p '+(gm?gm.poison:0)+', f '+(gm?gm.fuel:0)+')  volcanoes '+(vm?vm.activeVolcanoes:0)+' rocks '+(vm?vm.rocks:0)+' master '+(vm?vm.masterShots:0)+' meteor '+(mt?(mt.enabled?'ON ':'OFF ')+mt.meteors+' fall q'+mt.queuedOps+' next '+meteorNext:'-')); }
		}catch(e){}
		try{
			const dm = (DYNAMO && DYNAMO.metrics)? DYNAMO.metrics() : null;
			if(dm && (dm.machines || dm.currentPower || dm.storedEnergy)){ lines.push('Dynamo: '+dm.active+'/'+dm.machines+' active  '+dm.currentPower+' E/s  stored '+dm.storedEnergy+' E'); }
		}catch(e){}
		try{
			const sm = (SOLAR && SOLAR.metrics)? SOLAR.metrics() : null;
			if(sm && sm.cells){ lines.push('Solar: '+sm.active+'/'+sm.cells+' active  '+sm.currentPower+' E/s  stored '+sm.storedEnergy+' E  sun '+Math.round(sm.sun*100)+'%'); }
		}catch(e){}
		try{
			const tm = (TELEPORTERS && TELEPORTERS.metrics)? TELEPORTERS.metrics() : null;
			if(tm && tm.machines){ lines.push('Teleporters: '+tm.charged+'/'+tm.machines+' charged  stored '+tm.storedEnergy+' E'); }
		}catch(e){}
		try{
			const pm = (PUMPS && PUMPS.metrics)? PUMPS.metrics() : null;
			if(pm && pm.machines){ lines.push('Pumps: '+pm.active+'/'+pm.machines+' active  '+pm.charged+' charged  stored '+pm.storedEnergy+' E  moved '+pm.moved+' W  pipes '+pm.activePipes); }
		}catch(e){}
		try{
			const trm = (TURRETS && TURRETS.metrics)? TURRETS.metrics() : null;
			if(trm && trm.machines){ lines.push('Turrets: '+trm.active+'/'+trm.machines+' active  '+trm.charged+' charged  stored '+trm.storedEnergy+' E  water '+(trm.storedWater||0)+'  shots '+trm.shots+' fx '+trm.effects); }
			const spm = (SPRING_PLATFORMS && SPRING_PLATFORMS.metrics)? SPRING_PLATFORMS.metrics() : null;
			if(spm && spm.machines){ lines.push('Spring: '+spm.charged+'/'+spm.machines+' charged  stored '+spm.storedEnergy+' E  launches '+spm.poweredLaunches+'/'+spm.launches); }
			const vdm = (VENDING && VENDING.metrics)? VENDING.metrics() : null;
			if(vdm && vdm.machines){ lines.push('Vending: '+vdm.machines+' tracked  placed '+vdm.placed+'  stock '+vdm.stock); }
		}catch(e){}
		try{
			const sm = (SEASONS && SEASONS.metrics)? SEASONS.metrics() : null;
			if(sm){
				const scan=sm.scan||{};
				const terrain=sm.terrain||{};
				const daily=Number(sm.diurnalTemperatureDelta||0);
				const scanState=scan.deferred ? (' deferred'+(scan.deferReason?' '+scan.deferReason:'')) : '';
				const terrainState=terrain.deferReason ? (' '+terrain.deferReason) : '';
				lines.push('Season: '+sm.label+'  day '+sm.dayFloat.toFixed(1)+'  temp '+sm.temperatureDelta.toFixed(2)+' daily '+(daily>=0?'+':'')+daily.toFixed(2)+'  wind x'+sm.windMult.toFixed(2)+'  animals x'+sm.animalSpawnMult.toFixed(2)+'  rain x'+sm.rainRateMult.toFixed(2)+'  terrain '+(terrain.target||'-')+' q'+(terrain.queued||0)+' p'+(terrain.prepared||0)+' a'+(terrain.applied||0)+terrainState+'  scan '+(scan.columns||0)+'c/'+(scan.ops||0)+'op '+Number(scan.ms||0).toFixed(2)+'ms'+scanState+(sm.transition?'  blend '+Math.round(sm.blend*100)+'%':''));
			}
		}catch(e){}
		try{
			const cm = (CLOUDS && CLOUDS.metrics)? CLOUDS.metrics() : null;
			const wm = (WIND && WIND.metrics)? WIND.metrics() : null;
			if(cm || wm){ lines.push('Weather: '+(cm?cm.clouds:0)+' clouds ('+(cm?cm.cloudMass.toFixed(1):'0.0')+'m)  vapor '+(cm?cm.vapor.toFixed(1):'0.0')+'  wind '+(wm?wm.speed.toFixed(2):(cm?cm.wind.toFixed(2):'0.00'))+' t/s  gust '+(wm?Math.round(wm.intensity*100):0)+'%  drops '+(cm?cm.drops:0)+'  strikes '+(cm?cm.strikes:0)+((cm && cm.storm && cm.storm.active)? '  STORM '+Math.round(cm.storm.intensity*100)+'% ('+Math.round(cm.storm.tLeft)+'s)':'')+((wm && wm.squall && wm.squall.active)? '  SQUALL':'') ); }
		}catch(e){}
		const boxW = 520; const lineH=16; const boxH = 8 + lines.length*lineH + 6; const boxX=10; const boxY=10;
		ctx.save();
		ctx.fillStyle='rgba(0,0,0,0.58)'; ctx.fillRect(boxX,boxY,boxW,boxH);
		ctx.strokeStyle='rgba(255,255,255,0.2)'; ctx.lineWidth=1; ctx.strokeRect(boxX,boxY,boxW,boxH);
		ctx.fillStyle='#fff'; ctx.font='12px system-ui'; ctx.textBaseline='top';
		lines.forEach((ln,i)=>{ ctx.fillText(ln, boxX+8, boxY+6+i*lineH); });
		ctx.restore();
	}
}

// --- Minimap: compressed tile cross-section around the hero (N toggles).
// Rebuilt to an offscreen canvas twice a second; blitted under the FPS panel.
// Keep it translucent: the minimap is a navigational aid, not a hard cover over
// sky enemies, bosses, UFOs, or build targeting near the top of the screen.
const MINIMAP_W=220, MINIMAP_H=96, MINIMAP_RANGE=220;
const MINIMAP_ALPHA=0.62, MINIMAP_POINTER_ALPHA=0.18, MINIMAP_BACKDROP_ALPHA=0.12;
let mmCanvas=null, mmLastBuild=0;
function minimapTileColor(t){
	if(t===T.WATER) return '#2278de';
	if(t===T.LAVA) return '#e25822';
	if(t===T.GOLD_ORE) return '#f2b93b';
	if(t===T.DIAMOND) return '#3ef';
	if(t===T.IRIDIUM) return '#b8d7ff';
	if(t===T.UFO_CONCRETE) return '#536977';
	if(t===T.METEORIC_IRON) return '#7f878d';
	if(t===T.RADIOACTIVE_ORE) return '#8aff4f';
	if(t===T.ALIEN_BIOMASS) return '#79c95d';
	if(t===T.METEOR_DUST) return '#c8a6ff';
	if(t===T.ANTIMATTER_CRYSTAL) return '#d36bff';
	if(t===T.COAL) return '#25272b';
	if(t===T.VOLCANO_MASTER_STONE) return '#ff6a21';
	if(t===T.SERVANT_STONE) return '#8b2d17';
	if(t===T.CHEST_COMMON || t===T.CHEST_RARE || t===T.CHEST_EPIC) return '#dba33a';
	if(t===T.INVASION_CACHE) return '#7dffdc';
	if(t===T.TORCH) return '#ffc24b';
	if(t===T.OBSIDIAN) return '#4a3b66';
	if(t===T.WOOD_DOOR) return '#9b6730';
	if(t===T.STONE_DOOR) return '#8d9098';
	if(t===T.STEEL_DOOR) return '#9aa8b5';
	if(t===T.WOOD_TRAPDOOR) return '#a57136';
	if(t===T.STONE_TRAPDOOR) return '#858992';
	if(t===T.STEEL_TRAPDOOR) return '#91a0ad';
	if(t===T.STEEL) return '#8f9aa6';
	if(t===T.TRACK) return '#48515b';
	if(isChairTileId(t)) return (INFO[t] && INFO[t].color) || '#a9743c';
	if(t===T.GLASS) return '#9deeff';
	if(t===T.WIRE) return '#c56f32';
	if(t===T.COPPER_WIRE) return '#d68535';
	if(t===T.WATER_PIPE) return '#2d8ec9';
	if(t===T.VENDING_MACHINE) return '#55d7ff';
	if(t===T.WATER_PUMP) return '#58d4ff';
	if(t===T.ELECTRONICS) return '#47d18c';
	if(t===T.TRANSISTOR) return '#47d18c';
	if(t===T.DYNAMO) return '#ffd24a';
	if(t===T.DYNAMO_SLOT) return '#54ccff';
	if(t===T.TELEPORTER) return '#7cf7ff';
	if(t===T.ANTIGRAVITY_BEACON) return '#c46bff';
	if(t===T.METEOR_SIREN) return '#ff9f45';
	if(t===T.TURRET) return '#9fb0c8';
	if(t===T.FIRE_TURRET) return '#ff6a21';
	if(t===T.WATER_TURRET) return '#38a7ff';
	if(t===T.SPRING_PLATFORM) return '#7cc7d8';
	if(t===T.SOLAR_PANEL) return '#2290b2';
	if(t===T.SOLAR_BATTERY) return '#19b3a8';
	if(t===T.MEAT) return '#bd5145';
	if(t===T.ROTTEN_MEAT) return '#647136';
	if(t===T.BAKED_MEAT) return '#9b5a2e';
	if(t===T.HOT_AIR) return '#f4b65e';
	if(t===T.STEAM) return '#dce8ef';
	if(t===T.POISON_GAS) return '#82d45b';
	if(t===T.FUEL_GAS) return '#a79a64';
	if(t===T.ICE) return '#a9e4ff';
	if(t===T.SNOW) return '#dceeff';
	if(t===T.UNSTABLE_SAND) return '#a99155';
	if(t===T.QUICKSAND) return '#9f8551';
	if(t===T.SAND) return '#c8b772';
	if(t===T.CLAY) return '#8f7a62';
	if(t===T.WET_CLAY) return '#6f5c46';
	if(t===T.BRICK) return '#a65a3a';
	if(t===T.CHIMNEY) return '#6b5548';
	if(t===T.DIRT) return '#73543a';
	if(t===T.GRANITE) return '#7d7f87';
	if(t===T.BASALT) return '#30333a';
	if(t===T.BEDROCK) return '#1c2028';
	if(t===T.UNSTABLE_GRASS) return '#336d2f';
	if(t===T.GRASS || t===T.MUD) return '#4a8f3a';
	if(t===T.WOOD) return '#8b5a2b';
	if(t===T.AUTUMN_LEAF_RED) return '#8f5a2a';
	if(t===T.AUTUMN_LEAF_ORANGE) return '#d7832f';
	if(t===T.LEAF) return '#2faa2f';
	if(t===T.GRAVE) return '#a8adb8';
	if(t===T.RESPAWN_TOTEM) return '#e23b4e';
	return '#686d78';
}
function minimapConcealsUndiscovered(t){
	return t===T.WATER || t===T.LAVA || t===T.GOLD_ORE || t===T.DIAMOND || t===T.IRIDIUM || t===T.UFO_CONCRETE || t===T.METEORIC_IRON || t===T.RADIOACTIVE_ORE || t===T.ALIEN_BIOMASS || t===T.METEOR_DUST || t===T.ANTIMATTER_CRYSTAL || t===T.COAL || t===T.VOLCANO_MASTER_STONE || t===T.SERVANT_STONE || t===T.TORCH || t===T.OBSIDIAN || isDoorTile(t) || isTrapdoorTile(t) || t===T.STEEL || t===T.TRACK || isChairTileId(t) || t===T.GLASS || t===T.BRICK || t===T.CHIMNEY || t===T.WIRE || t===T.COPPER_WIRE || t===T.WATER_PIPE || t===T.WATER_PUMP || t===T.VENDING_MACHINE || t===T.ELECTRONICS || t===T.TRANSISTOR || t===T.DYNAMO || t===T.DYNAMO_SLOT || t===T.TELEPORTER || t===T.ANTIGRAVITY_BEACON || t===T.METEOR_SIREN || t===T.TURRET || t===T.FIRE_TURRET || t===T.WATER_TURRET || t===T.SPRING_PLATFORM || t===T.SOLAR_PANEL || t===T.SOLAR_BATTERY || t===T.MEAT || t===T.ROTTEN_MEAT || t===T.BAKED_MEAT || isGasTileId(t) || t===T.GRAVE || t===T.RESPAWN_TOTEM || t===T.INVASION_CACHE || t===T.CHEST_COMMON || t===T.CHEST_RARE || t===T.CHEST_EPIC;
}
function minimapWorldYToPixel(row,mh,minY,maxY){
	const span=Math.max(1,maxY-minY-1);
	return Math.max(1, Math.min(mh-2, Math.round((row-minY)*(mh-1)/span)));
}
function drawMinimapBands(g,mw,mh,minY,maxY){
	const topBase=minimapWorldYToPixel(0,mh,minY,maxY);
	const deep=minimapWorldYToPixel(WORLD_H,mh,minY,maxY);
	g.fillStyle='rgba(71,122,176,0.16)';
	g.fillRect(0,0,mw,Math.max(0,topBase));
	g.fillStyle='rgba(37,31,24,0.16)';
	g.fillRect(0,deep,mw,Math.max(0,mh-deep));
	g.strokeStyle='rgba(190,220,255,0.26)';
	g.beginPath(); g.moveTo(0.5,topBase+0.5); g.lineTo(mw-0.5,topBase+0.5); g.stroke();
	g.strokeStyle='rgba(120,96,82,0.32)';
	g.beginPath(); g.moveTo(0.5,deep+0.5); g.lineTo(mw-0.5,deep+0.5); g.stroke();
}
function drawMinimap(){
	if(!showMinimap) return;
	const MW=MINIMAP_W, MH=MINIMAP_H, RANGE=MINIMAP_RANGE;
	if(!mmCanvas || mmCanvas.width!==MW || mmCanvas.height!==MH){ mmCanvas=document.createElement('canvas'); mmCanvas.width=MW; mmCanvas.height=MH; mmLastBuild=0; }
	const now=performance.now();
	const frameLoaded=Number.isFinite(lastFrameMs) && lastFrameMs>28;
	const rebuildEvery = lastFrameMs>40 ? 3200 : (lastFrameMs>24 ? 1800 : 900);
	if(frameLoaded && mmLastBuild>0 && now-mmLastBuild<rebuildEvery*1.75){
		ctx.save();
		const mx=W-MW-12, my=44;
		const pointerOver=lastPointer.has && lastPointer.x>=mx && lastPointer.x<=mx+MW && lastPointer.y>=my && lastPointer.y<=my+MH;
		const alpha=pointerOver ? MINIMAP_POINTER_ALPHA : MINIMAP_ALPHA;
		ctx.fillStyle='rgba(6,10,18,'+(MINIMAP_BACKDROP_ALPHA*(alpha/MINIMAP_ALPHA)).toFixed(3)+')';
		ctx.fillRect(mx,my,MW,MH);
		ctx.globalAlpha=alpha;
		ctx.drawImage(mmCanvas,mx,my);
		ctx.globalAlpha=1;
		ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=1; ctx.strokeRect(mx+0.5,my+0.5,MW-1,MH-1);
		ctx.restore();
		return;
	}
	if(now-mmLastBuild>rebuildEvery){
		mmLastBuild=now;
		const g=mmCanvas.getContext('2d');
		g.clearRect(0,0,MW,MH);
		const minY=worldMinY(), maxY=worldMaxY();
		drawMinimapBands(g,MW,MH,minY,maxY);
		const cx=Math.floor(player.x);
		const xScale=(RANGE*2)/MW;
		const yScale=(maxY-minY)/MH;
		const surfCache=new Map();
		const surfaceAt=(wx)=>{
			let s=surfCache.get(wx);
			if(s===undefined){ s=WORLDGEN.surfaceHeight(wx); surfCache.set(wx,s); }
			return s;
		};
		const rowToY=(row)=>minimapWorldYToPixel(row,MH,minY,maxY);
		for(let py=0; py<MH; py++){
			const y0=Math.max(minY, Math.floor(minY+py*yScale));
			const y1=Math.min(maxY-1, Math.ceil(minY+(py+1)*yScale)-1);
			let runColor=null, runStart=0;
			const flushRun=(i)=>{
				if(!runColor) return;
				g.fillStyle=runColor;
				g.fillRect(runStart,py,i-runStart,1);
				runColor=null;
			};
			for(let i=0;i<MW;i++){
				const wx0=Math.floor(cx-RANGE+i*xScale);
				const wx1=Math.floor(cx-RANGE+(i+1)*xScale-0.001);
				let color=null, cave=false, priority=false;
				for(let wx=wx0; wx<=wx1; wx++){
					const surf=surfaceAt(wx);
					for(let wy=y0; wy<=y1; wy++){
						const t=getTile(wx,wy);
						if(t===T.AIR){
							if(wy>surf) cave=true;
							continue;
						}
						const outsideLegacyBand = wy<0 || wy>=WORLD_H;
						const discovered=worldTileDiscovered(wx,wy);
						if((wy>surf || outsideLegacyBand) && !discovered && minimapConcealsUndiscovered(t)){
							if(isPlayerPassableTile(t) || t===T.TORCH) cave=true;
							else if(!color) color=outsideLegacyBand?'rgba(99,121,148,0.62)':'#686d78';
							continue;
						}
						const c=minimapTileColor(t);
						if(t===T.WATER || t===T.LAVA || t===T.GOLD_ORE || t===T.DIAMOND || t===T.IRIDIUM || t===T.UFO_CONCRETE || t===T.METEORIC_IRON || t===T.RADIOACTIVE_ORE || t===T.ALIEN_BIOMASS || t===T.METEOR_DUST || t===T.ANTIMATTER_CRYSTAL || t===T.COAL || t===T.VOLCANO_MASTER_STONE || t===T.SERVANT_STONE || t===T.TORCH || isDoorTile(t) || isTrapdoorTile(t) || t===T.STEEL || t===T.TRACK || isChairTileId(t) || t===T.GLASS || t===T.CHIMNEY || t===T.WIRE || t===T.COPPER_WIRE || t===T.WATER_PIPE || t===T.WATER_PUMP || t===T.VENDING_MACHINE || t===T.ELECTRONICS || t===T.TRANSISTOR || t===T.DYNAMO || t===T.DYNAMO_SLOT || t===T.TELEPORTER || t===T.ANTIGRAVITY_BEACON || t===T.METEOR_SIREN || t===T.TURRET || t===T.FIRE_TURRET || t===T.WATER_TURRET || t===T.SPRING_PLATFORM || t===T.SOLAR_PANEL || t===T.SOLAR_BATTERY || t===T.MEAT || t===T.ROTTEN_MEAT || t===T.BAKED_MEAT || isGasTileId(t) || t===T.RESPAWN_TOTEM || INFO[t].chestTier || INFO[t].cache){ color=c; priority=true; wx=wx1+1; break; }
						if(!color) color=outsideLegacyBand && !discovered ? 'rgba(120,145,176,0.58)' : c;
					}
				}
				const pxColor=priority?color:(cave?'rgba(2,5,10,0.72)':(color||null));
				if(pxColor!==runColor){
					flushRun(i);
					if(pxColor){ runStart=i; runColor=pxColor; }
				}
			}
			flushRun(MW);
		}
		// hero marker
		g.fillStyle='#ffd23e';
		const py=rowToY(Math.round(player.y));
		g.fillRect(MW/2-1, Math.max(2,py-3), 3, 5);
	}
	ctx.save();
	const mx=W-MW-12, my=44;
	const pointerOver=lastPointer.has && lastPointer.x>=mx && lastPointer.x<=mx+MW && lastPointer.y>=my && lastPointer.y<=my+MH;
	const alpha=pointerOver ? MINIMAP_POINTER_ALPHA : MINIMAP_ALPHA;
	ctx.fillStyle='rgba(6,10,18,'+(MINIMAP_BACKDROP_ALPHA*(alpha/MINIMAP_ALPHA)).toFixed(3)+')';
	ctx.fillRect(mx,my,MW,MH);
	ctx.globalAlpha=alpha;
	ctx.drawImage(mmCanvas,mx,my);
	ctx.globalAlpha=1;
	ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=1; ctx.strokeRect(mx+0.5,my+0.5,MW-1,MH-1);
	ctx.restore();
}
// UI aktualizacja
// Build the HUD resource counters from the registry so every collectable resource
// (including ones added later) gets a counter with the canonical swatch color —
// the old hand-written HTML list had drifted (missing leaf, stale snow color).
function buildResourceHud(){
	const panel=document.getElementById('inv'); if(!panel) return;
	const anchor=panel.firstElementChild; // resource items go before the biome/pick pills
	RESOURCE_DEFS.forEach(r=>{
		if(document.getElementById(r.key)) return; // already present (idempotent)
		const s=document.createElement('span'); s.className='item';
		const dot=document.createElement('span'); dot.className='dot'; dot.style.background=r.color;
		const b=document.createElement('b'); b.id=r.key; b.textContent='0';
		s.appendChild(dot); s.appendChild(document.createTextNode(' '+r.label.toLowerCase()+': ')); s.appendChild(b);
		panel.insertBefore(s, anchor);
	});
}
buildResourceHud();
const el={pick:document.getElementById('pick'),fps:document.getElementById('fps'),msg:document.getElementById('messages')};
RESOURCE_KEYS.forEach(k=>{ el[k]=document.getElementById(k); }); // HUD counters share the resource keys as element ids
function updateInventory(opts){
	opts=opts||{};
	RESOURCE_KEYS.forEach(k=>{ if(el[k]) el[k].textContent=inv[k]; });
	el.pick.textContent=pickLabel(player.tool);
	checkCraftingAvailability({silent:!!opts.noCraftNotify});
	updateCraftButtons();
	updateHotbarCounts();
	updateWeaponBar();
	if(!opts.noSave) saveState();
	try{ window.dispatchEvent(new CustomEvent('mm-resources-change')); }catch(e){}
}
// Inventory overlay (resources tab) refreshes the HUD after dropping resources
window.updateInventoryHud = updateInventory;
const tutorialNpcCtx = {damageHero:window.damageHero, onInventoryChange:updateInventory, onChange:saveState, worldGen:WORLDGEN, gameDayFloat:()=>{ const m=(SEASONS && SEASONS.metrics) ? SEASONS.metrics() : null; return m && Number.isFinite(Number(m.dayFloat)) ? Number(m.dayFloat) : 1; }};
if(NPCS && NPCS.setContext) NPCS.setContext(tutorialNpcCtx);
if(FISHING && FISHING.setContext) FISHING.setContext({onInventoryChange:updateInventory, onChange:saveState});
// Wandering trader panel: DOM host for engine/trader.js. The module opens it
// via the npc_system click dispatch and closes it on departure / walking away.
(function(){
	if(!TRADER || !TRADER.setOpenHandler) return;
	let panel=null;
	const tradeCtx={
		inv, player,
		addBuff:(b)=>{ if(MM.progress && MM.progress.addBuff) MM.progress.addBuff(b); },
		getTile, setTile,
		notifyTileChanged:notifyStructureTileChanged,
		onInventoryChange:()=>{ updateInventory(); updateHotbarCounts(); renderPanel(); },
		onChange:saveState,
		worldGen:WORLDGEN
	};
	function ensurePanel(){
		if(panel) return panel;
		panel=document.createElement('div'); panel.id='traderPanel'; panel.hidden=true;
		(document.getElementById('ui')||document.body).appendChild(panel);
		return panel;
	}
	function formatTradeCost(cost){
		if(TRADER && TRADER.formatCost) return TRADER.formatCost(cost);
		if(typeof cost==='number') return cost+' 💎';
		return Object.keys(cost||{}).map(k=>cost[k]+' '+k).join(' + ') || '0';
	}
	function traderCanAfford(entry){
		if(TRADER && TRADER.canAffordOffer) return TRADER.canAffordOffer(entry,inv);
		if(typeof entry.cost==='number') return (inv.diamond|0)>=entry.cost;
		return Object.keys(entry.cost||{}).every(k=>(inv[k]|0)>=entry.cost[k]);
	}
	function tradeRow(entry,kind){
		const row=document.createElement('div'); row.className='tradeRow';
		const name=document.createElement('span'); name.className='tName'; name.textContent=entry.icon+' '+entry.label; name.title=entry.label;
		const price=document.createElement('span'); price.className='tPrice';
		const btn=document.createElement('button'); btn.type='button';
		if(kind==='buy'){
			price.textContent=formatTradeCost(entry.cost);
			btn.textContent='Kup';
			btn.disabled=!traderCanAfford(entry);
			btn.addEventListener('click',()=>{ const r=TRADER.tradeBuy(entry.id,tradeCtx); if(!r.ok && r.reason) msg('🧺 '+r.reason); renderPanel(); });
		}else{
			const needKey=Object.keys(entry.take)[0];
			const needAmount=entry.take[needKey];
			price.textContent='+'+entry.pay+' 💎';
			btn.textContent='Sprzedaj';
			btn.disabled=(inv[needKey]|0)<needAmount;
			btn.addEventListener('click',()=>{ const r=TRADER.tradeSell(entry.id,tradeCtx); if(!r.ok && r.reason) msg('🧺 '+r.reason); renderPanel(); });
		}
		row.appendChild(name); row.appendChild(price); row.appendChild(btn);
		return row;
	}
	function renderPanel(){
		if(!panel || panel.hidden) return;
		const stock=TRADER.stock();
		if(!stock){ closePanel(); return; }
		panel.innerHTML='';
		const head=document.createElement('div'); head.className='tradeHead';
		const title=document.createElement('strong'); title.textContent='🧺 Wędrowny Handlarz';
		const wallet=document.createElement('span'); wallet.className='tradeWallet'; wallet.textContent='💎 × '+(inv.diamond|0)+'   Ir × '+(inv.iridium|0);
		const close=document.createElement('button'); close.className='tradeClose'; close.type='button'; close.textContent='✕'; close.title='Zamknij (Esc)';
		close.addEventListener('click',closePanel);
		head.appendChild(title); head.appendChild(wallet); head.appendChild(close);
		panel.appendChild(head);
		const cols=document.createElement('div'); cols.className='tradeCols';
		const buySec=document.createElement('div'); buySec.className='tradeSection';
		const buyTitle=document.createElement('b'); buyTitle.textContent='Na sprzedaż'; buySec.appendChild(buyTitle);
		stock.offers.forEach(o=>buySec.appendChild(tradeRow(o,'buy')));
		const sellSec=document.createElement('div'); sellSec.className='tradeSection';
		const sellTitle=document.createElement('b'); sellTitle.textContent='Skupuję'; sellSec.appendChild(sellTitle);
		stock.rates.forEach(r=>sellSec.appendChild(tradeRow(r,'sell')));
		cols.appendChild(buySec); cols.appendChild(sellSec);
		panel.appendChild(cols);
		const foot=document.createElement('div'); foot.className='tradeFoot';
		foot.textContent='Kram zwija się po pół dnia. Asortyment zmienia się z każdą wizytą.';
		panel.appendChild(foot);
	}
	function trapKeydown(e){
		if(!panel || panel.hidden) return;
		if(e.key==='Escape'){ e.preventDefault(); e.stopImmediatePropagation(); closePanel(); }
	}
	function openPanel(){
		ensurePanel();
		if(!panel.hidden){ renderPanel(); return; }
		panel.hidden=false;
		renderPanel();
		if(MM.modalInput && MM.modalInput.push) MM.modalInput.push('trader');
		window.addEventListener('keydown',trapKeydown,true);
	}
	function closePanel(){
		if(!panel || panel.hidden) return;
		panel.hidden=true;
		if(MM.modalInput && MM.modalInput.pop) MM.modalInput.pop('trader');
		window.removeEventListener('keydown',trapKeydown,true);
	}
	TRADER.setOpenHandler(openPanel);
	TRADER.setCloseHandler(closePanel);
})();
buildCraftPanel();
// Menu / przyciski
document.getElementById('mapBtn')?.addEventListener('click',toggleMap);
// Sound toggle (procedural WebAudio — engine/audio.js)
(function(){
	const b=document.getElementById('audioBtn'); if(!b || !MM.audio) return;
	function refresh(){ b.textContent=MM.audio.isMuted()? '🔇' : '🔊'; }
	b.addEventListener('click',()=>{ MM.audio.setMute(!MM.audio.isMuted()); refresh(); });
	refresh();
})();
const godBtn=document.getElementById('godBtn'); if(godBtn) godBtn.addEventListener('click',toggleGod);
const immunityBtn=document.getElementById('immunityBtn'); if(immunityBtn) immunityBtn.addEventListener('click',toggleImmunity);
updateGodBtn();
updateImmunityBtn();
const menuPanel=document.getElementById('menuPanel');
if(MM.ui && MM.ui.initMenuToggle) MM.ui.initMenuToggle();
function debugGasOrigin(){
	const facing=player.facing<0 ? -1 : 1;
	const bx=Math.floor(player.x + facing*2);
	const by=Math.floor(player.y - 1);
	const offsets=[[0,0],[0,-1],[facing,0],[-facing,0],[0,1],[facing,-1],[-facing,-1],[facing,1],[-facing,1],[facing*2,0],[0,-2],[facing*2,-1],[-facing*2,-1]];
	for(const [dx,dy] of offsets){
		const tx=bx+dx, ty=by+dy;
		ensureChunkAtY(Math.floor(tx/CHUNK_W),ty);
		const t=getTile(tx,ty);
		if(t===T.AIR || isGasTileId(t)) return {x:tx+0.5,y:ty+0.5,tileX:tx,tileY:ty};
	}
	return {x:bx+0.5,y:by+0.5,tileX:bx,tileY:by};
}
function spawnDebugGas(kind,power){
	if(!GASES || !GASES.add){ msg('Brak systemu gazow'); return 0; }
	const p=Number.isFinite(power) ? Math.max(0.5, Math.min(5, power)) : 2;
	const at=debugGasOrigin();
	const placed=GASES.add(kind,at.x,at.y,{power:p,cells:Math.round(3+p*4),getTile,setTile});
	if(placed>0){ noteSaveActivity(); saveState(); }
	return placed;
}
function igniteDebugGas(power){
	if(!GASES || !GASES.igniteAt){ msg('Brak zaplonu gazu'); return false; }
	const at=debugGasOrigin();
	const ok=!!GASES.igniteAt(at.x,at.y,getTile,setTile,Math.max(2.5,(Number.isFinite(power)?power:2)*1.6));
	if(ok){ noteSaveActivity(); saveState(); }
	return ok;
}
function clearDebugGases(){
	if(!GASES) return 0;
	let removed=0;
	const seen=new Set();
	function clearAt(x,y){
		x=Math.floor(x); y=Math.floor(y);
		const k=x+','+y;
		if(seen.has(k)) return;
		seen.add(k);
		if(!isGasTileId(getTile(x,y))) return;
		if(typeof setTile.transient==='function') setTile.transient(x,y,T.AIR);
		else setTile(x,y,T.AIR);
		removed++;
	}
	try{
		const snap=(GASES.snapshot && GASES.snapshot()) || null;
		const list=(snap && Array.isArray(snap.list)) ? snap.list : [];
		for(const g of list){
			if(!g || !Number.isFinite(g.x) || !Number.isFinite(g.y)) continue;
			clearAt(g.x,g.y);
		}
		const worldMap=WORLD && WORLD._world;
		if(worldMap && typeof worldMap.forEach==='function'){
			worldMap.forEach((arr,k)=>{
				if(!arr || typeof k!=='string' || k[0]!=='c') return;
				const ref=normalizeWorldChunkRef(k);
				if(!ref) return;
				const cx=ref.cx;
				const originY=ref.base ? 0 : worldSectionOriginY(ref.sy);
				const h=ref.h || (ref.base ? WORLD_H : worldSectionHeight());
				const x0=cx*CHUNK_W;
				for(let ly=0; ly<h; ly++){
					const row=ly*CHUNK_W;
					for(let lx=0; lx<CHUNK_W; lx++){
						if(isGasTileId(arr[row+lx])) clearAt(x0+lx,originY+ly);
					}
				}
			});
		}
		if(GASES.reset) GASES.reset();
	}catch(e){
		if(GASES.reset) GASES.reset();
	}
	if(removed>0){ noteSaveActivity(); saveState(); }
	return removed;
}
function giveDebugDynamo(){
	inv.dynamo=(inv.dynamo||0)+1;
	updateInventory();
	updateHotbarCounts();
	noteSaveActivity();
	saveState();
	return 1;
}
function debugDynamoCellsClear(cells){
	for(const cell of cells){
		const t=getTile(cell.x,cell.y);
		if(t!==T.AIR && !isGasTileId(t)) return false;
		if(cellOverlapsPlayer(cell.x,cell.y)) return false;
	}
	return true;
}
function placeDebugDynamo(){
	if(!DYNAMO || !DYNAMO.plannedCells) return false;
	const facing=player.facing<0 ? -1 : 1;
	const baseX=Math.floor(player.x + facing*4);
	const baseY=Math.floor(player.y);
	const dxs=[0,facing,-facing,facing*2,-facing*2,facing*3,-facing*3];
	const dys=[0,-1,1,-2,2,-3,3];
	for(const dy of dys){
		for(const dx of dxs){
			const cx=baseX+dx, cy=baseY+dy;
			const cells=DYNAMO.plannedCells(cx,cy,dynamoOrientation);
			cells.forEach(cell=>ensureChunkAtY(Math.floor(cell.x/CHUNK_W),cell.y));
			if(!debugDynamoCellsClear(cells)) continue;
			placeDebugCells(cells);
			if(FALLING && FALLING.afterPlacement) cells.forEach(cell=>FALLING.afterPlacement(cell.x,cell.y));
			if(WATER && WATER.onTileChanged) cells.forEach(cell=>WATER.onTileChanged(cell.x,cell.y,getTile));
			try{ DYNAMO.recordFlow(cx,cy,T.WATER,3,getTile); }catch(e){}
			noteSaveActivity();
			saveState();
			return true;
		}
	}
	return false;
}
function nearestDebugDynamoSlot(){
	if(!DYNAMO || !DYNAMO.isValidSlot) return null;
	const cx=Math.floor(player.x), cy=Math.floor(player.y);
	let best=null, bestD=Infinity;
	for(let y=Math.max(worldMinY(),cy-28); y<=Math.min(worldMaxY()-1,cy+28); y++){
		for(let x=cx-40; x<=cx+40; x++){
			if(!DYNAMO.isValidSlot(x,y,getTile)) continue;
			const d=Math.abs(x-cx)+Math.abs(y-cy);
			if(d<bestD){ bestD=d; best={x,y}; }
		}
	}
	return best;
}
function pulseDebugDynamo(){
	const s=nearestDebugDynamoSlot();
	if(!s || !DYNAMO || !DYNAMO.recordFlow) return false;
	const ok=!!DYNAMO.recordFlow(s.x,s.y,T.WATER,3,getTile);
	if(ok){ noteSaveActivity(); saveState(); }
	return ok;
}
function chargeDebugDynamo(){
	const s=nearestDebugDynamoSlot();
	if(!s || !DYNAMO || !DYNAMO.recordFlow) return false;
	let ok=false;
	for(let i=0;i<12;i++) ok=!!DYNAMO.recordFlow(s.x,s.y,T.WATER,4,getTile) || ok;
	if(ok){
		if(PARTICLES && PARTICLES.spawnEnergyAbsorb) PARTICLES.spawnEnergyAbsorb((s.x+0.5)*TILE,(s.y+0.5)*TILE,player.x*TILE,(player.y-0.05)*TILE,1.2);
		if(AUDIO && AUDIO.play) AUDIO.play('charge');
		noteSaveActivity(); saveState();
	}
	return ok;
}
function fillDebugHeroEnergy(){
	if(!MM.heroEnergy || !MM.heroEnergy.info) return false;
	const info=MM.heroEnergy.info();
	const before=info.energy||0;
	player.energy=info.max||heroEnergyCapacity();
	energyChargeFx.t=0.85;
	energyChargeFx.intensity=1.35;
	energyChargeFx.source=null;
	if(AUDIO && AUDIO.play) AUDIO.play('charge');
	if((player.energy||0)>before){ noteSaveActivity(); saveState(); }
	return true;
}
function emptyDebugHeroEnergy(){
	if(!MM.heroEnergy || !MM.heroEnergy.info) return false;
	player.energy=0;
	energyChargeFx.t=0;
	energyChargeFx.intensity=0;
	energyChargeFx.source=null;
	noteSaveActivity(); saveState();
	return true;
}
function giveDebugTeleporter(){
	inv.teleporter=(inv.teleporter||0)+1;
	updateInventory();
	updateHotbarCounts();
	noteSaveActivity();
	saveState();
	return 1;
}
function giveDebugCopperWire(){
	inv.copperWire=(inv.copperWire||0)+20;
	updateInventory();
	updateHotbarCounts();
	noteSaveActivity();
	saveState();
	return 20;
}
function debugRigCellsClear(cells){
	for(const cell of cells){
		if(!worldYInBounds(cell.y)) return false;
		ensureChunkAtY(Math.floor(cell.x/CHUNK_W),cell.y);
		if(isInfrastructureTileId(cell.t)){
			if(hasInfrastructureTile(cell.x,cell.y,cell.t)) return false;
			const base=getTile(cell.x,cell.y);
			if(INFO[base] && INFO[base].chestTier) return false;
			if(INFO[base] && INFO[base].cache) return false;
			if(base===T.DYNAMO || base===T.DYNAMO_SLOT || base===T.TELEPORTER || base===T.WATER_PUMP || base===T.VENDING_MACHINE || base===T.TURRET || base===T.FIRE_TURRET || base===T.WATER_TURRET || base===T.SPRING_PLATFORM || base===T.SOLAR_PANEL || base===T.SOLAR_BATTERY || base===T.ANTIGRAVITY_BEACON || base===T.METEOR_SIREN) return false;
			continue;
		}
		const t=getTile(cell.x,cell.y);
		if(t!==T.AIR && !isGasTileId(t)) return false;
		if(cellOverlapsPlayer(cell.x,cell.y)) return false;
	}
	return true;
}
function placeDebugCell(cell){
	if(!cell) return;
	if(isInfrastructureTileId(cell.t) && WORLD && WORLD.setInfrastructure) WORLD.setInfrastructure(cell.x,cell.y,cell.t);
	else setTile(cell.x,cell.y,cell.t);
}
function placeDebugCells(cells){
	cells.forEach(placeDebugCell);
}
function finalizeDebugPlacedCells(cells,playSound){
	cells.forEach(cell=>{
		if(isInfrastructureTileId(cell.t)) return;
		if(SPRING_PLATFORMS && SPRING_PLATFORMS.onTileChanged) SPRING_PLATFORMS.onTileChanged(cell.x,cell.y,T.AIR,cell.t,getTile);
		if(FALLING && FALLING.afterPlacement) FALLING.afterPlacement(cell.x,cell.y);
		if(WATER && WATER.onTileChanged) WATER.onTileChanged(cell.x,cell.y,getTile);
	});
	if(playSound && AUDIO && AUDIO.play) AUDIO.play(playSound);
	noteSaveActivity();
	saveState();
}
function placeDebugSolarTile(tile){
	const facing=player.facing<0 ? -1 : 1;
	const baseX=Math.floor(player.x + facing*3);
	const baseY=Math.floor(player.y)-2;
	const dxs=[0,facing,-facing,facing*2,-facing*2,facing*3,-facing*3];
	const dys=[0,-1,1,-2,2,-3,3,4];
	for(const dy of dys){
		for(const dx of dxs){
			const x=baseX+dx, y=baseY+dy;
			const cells=[{x,y,t:tile}];
			if(!debugRigCellsClear(cells)) continue;
			setTile(x,y,tile);
			finalizeDebugPlacedCells(cells,'place');
			return {x,y};
		}
	}
	return null;
}
function placeDebugSolarPanel(){
	return !!placeDebugSolarTile(T.SOLAR_PANEL);
}
function placeDebugSolarBattery(){
	const p=placeDebugSolarTile(T.SOLAR_BATTERY);
	if(p && SOLAR && SOLAR._debug && SOLAR._debug.debugChargeAt) SOLAR._debug.debugChargeAt(p.x,p.y,80,getTile);
	return !!p;
}
function placeDebugAntigravityBeacon(){
	const facing=player.facing<0 ? -1 : 1;
	const baseX=Math.floor(player.x + facing*5);
	const xs=[0,facing,-facing,facing*2,-facing*2,facing*3,-facing*3].map(dx=>baseX+dx);
	for(const x of xs){
		ensureChunkAtY(Math.floor(x/CHUNK_W),player.y);
		let y=null;
		try{ y=Math.floor(WORLDGEN.surfaceHeight(x))-1; }catch(e){ y=null; }
		const candidates=[];
		if(Number.isFinite(y)) candidates.push(y,y-1,y+1,y-2,y+2);
		const py=Math.floor(player.y);
		for(let dy=-3; dy<=5; dy++) candidates.push(py+dy);
		for(const cyRaw of candidates){
			const cy=Math.floor(cyRaw);
			if(cy<worldMinY()+1 || cy>=worldMaxY()-2) continue;
			const cells=[{x,y:cy,t:T.ANTIGRAVITY_BEACON}];
			if(!debugRigCellsClear(cells)) continue;
			if(!isStableMachineSupport(getTile(x,cy+1)) && !isStableMachineSupport(getTile(x-1,cy)) && !isStableMachineSupport(getTile(x+1,cy))) continue;
			setTile(x,cy,T.ANTIGRAVITY_BEACON);
			finalizeDebugPlacedCells(cells,'place');
			return true;
		}
	}
	return false;
}
function placeDebugMeteorSiren(){
	const p=placeDebugSolarTile(T.METEOR_SIREN);
	return !!p;
}
function scanDebugMeteorCrater(){
	if(!METEORITES || !METEORITES.scanNearestCrater) return false;
	const scan=METEORITES.scanNearestCrater(player,getTile);
	return !!(scan && scan.ok);
}
function useCraterScanner(){
	if(!METEORITES || !METEORITES.scanNearestCrater) return false;
	if(!godMode && (inv.craterScanner||0)<=0){ msg('Brak skanera kraterow'); return false; }
	const scan=METEORITES.scanNearestCrater(player,getTile);
	return !!(scan && scan.ok);
}
function nearestDebugSolar(){
	const cx=Math.floor(player.x), cy=Math.floor(player.y);
	let best=null, bestD=Infinity;
	for(let y=Math.max(worldMinY(),cy-34); y<=Math.min(worldMaxY()-1,cy+34); y++){
		for(let x=cx-52; x<=cx+52; x++){
			const t=getTile(x,y);
			if(t!==T.SOLAR_PANEL && t!==T.SOLAR_BATTERY) continue;
			const d=Math.abs(x-cx)+Math.abs(y-cy);
			if(d<bestD){ bestD=d; best={x,y,t}; }
		}
	}
	return best;
}
function chargeDebugSolar(){
	const s=nearestDebugSolar();
	if(!s || !SOLAR || !SOLAR._debug || !SOLAR._debug.debugChargeAt) return false;
	const got=SOLAR._debug.debugChargeAt(s.x,s.y,160,getTile);
	if(got>0){
		if(PARTICLES && PARTICLES.spawnEnergyAbsorb) PARTICLES.spawnEnergyAbsorb((s.x+0.5)*TILE,(s.y+0.5)*TILE,player.x*TILE,(player.y-0.05)*TILE,1.15);
		if(AUDIO && AUDIO.play) AUDIO.play('charge');
		noteSaveActivity(); saveState();
	}
	return got>0;
}
function emptyDebugSolar(){
	const s=nearestDebugSolar();
	if(!s || !SOLAR || !SOLAR._debug || !SOLAR._debug.debugSetEnergyAt) return false;
	const ok=!!SOLAR._debug.debugSetEnergyAt(s.x,s.y,0,getTile);
	if(ok){ noteSaveActivity(); saveState(); }
	return ok;
}
function giveDebugPumps(){
	inv.waterPipe=(inv.waterPipe||0)+24;
	inv.waterPump=(inv.waterPump||0)+1;
	inv.waterTurret=(inv.waterTurret||0)+1;
	updateInventory();
	updateHotbarCounts();
	noteSaveActivity();
	saveState();
	return 1;
}
function placeDebugPump(){
	const p=placeDebugSolarTile(T.WATER_PUMP);
	if(p && PUMPS && PUMPS.setOrientationAt) PUMPS.setOrientationAt(p.x,p.y,pumpOrientation,getTile);
	if(p && PUMPS && PUMPS._debug && PUMPS._debug.debugChargeAt) PUMPS._debug.debugChargeAt(p.x,p.y,PUMPS._debug.PUMP_CAPACITY,getTile);
	if(p){ noteSaveActivity(); saveState(); }
	return !!p;
}
function nearestDebugPump(){
	const cx=Math.floor(player.x), cy=Math.floor(player.y);
	let best=null, bestD=Infinity;
	for(let y=Math.max(worldMinY(),cy-34); y<=Math.min(worldMaxY()-1,cy+34); y++){
		for(let x=cx-52; x<=cx+52; x++){
			if(getTile(x,y)!==T.WATER_PUMP) continue;
			const d=Math.abs(x-cx)+Math.abs(y-cy);
			if(d<bestD){ bestD=d; best={x,y}; }
		}
	}
	return best;
}
function chargeDebugPump(){
	const s=nearestDebugPump();
	if(!s || !PUMPS || !PUMPS._debug || !PUMPS._debug.debugChargeAt) return false;
	const got=PUMPS._debug.debugChargeAt(s.x,s.y,PUMPS._debug.PUMP_CAPACITY,getTile);
	if(got>0){
		if(PARTICLES && PARTICLES.spawnEnergyAbsorb) PARTICLES.spawnEnergyAbsorb((s.x+0.5)*TILE,(s.y+0.5)*TILE,player.x*TILE,(player.y-0.05)*TILE,1.15);
		if(AUDIO && AUDIO.play) AUDIO.play('charge');
		noteSaveActivity(); saveState();
	}
	return got>0;
}
function emptyDebugPump(){
	const s=nearestDebugPump();
	if(!s || !PUMPS || !PUMPS._debug || !PUMPS._debug.debugSetEnergyAt) return false;
	const ok=!!PUMPS._debug.debugSetEnergyAt(s.x,s.y,0,getTile);
	if(ok){ noteSaveActivity(); saveState(); }
	return ok;
}
function placeDebugPumpRig(){
	if(!PUMPS || !DYNAMO || !DYNAMO.plannedCells) return false;
	const facing=player.facing<0 ? -1 : 1;
	const dir=facing<0 ? 'west' : 'east';
	const baseX=Math.floor(player.x + facing*5);
	const baseY=Math.floor(player.y)-1;
	const yOffsets=[0,-1,1,-2,2,-3,3];
	const xOffsets=[0,facing*2,-facing*2,facing*4,-facing*4];
	for(const dy of yOffsets){
		for(const dx of xOffsets){
			const y=baseY+dy;
			const pumpX=baseX+dx;
			const sourceX=pumpX-facing*3;
			const turretX=pumpX+facing*3;
			const dynCx=pumpX;
			const cells=[
				{x:sourceX,y,t:T.WATER},
				{x:sourceX,y:y+1,t:T.WATER},
				{x:pumpX-facing*2,y,t:T.WATER_PIPE},
				{x:pumpX-facing,y,t:T.WATER_PIPE},
				{x:pumpX,y,t:T.WATER_PUMP},
				{x:pumpX+facing,y,t:T.WATER_PIPE},
				{x:pumpX+facing*2,y,t:T.WATER_PIPE},
				{x:turretX,y,t:T.WATER_TURRET},
				{x:pumpX,y:y+1,t:T.COPPER_WIRE},
				{x:pumpX,y:y+2,t:T.COPPER_WIRE},
				...DYNAMO.plannedCells(dynCx,y+3,'horizontal')
			];
			if(!debugRigCellsClear(cells)) continue;
			placeDebugCells(cells);
			try{ PUMPS.setOrientationAt(pumpX,y,dir,getTile); }catch(e){}
			try{ for(let i=0;i<18;i++) DYNAMO.recordFlow(dynCx,y+3,T.WATER,4,getTile); }catch(e){}
			try{ if(PUMPS._debug && PUMPS._debug.debugChargeAt) PUMPS._debug.debugChargeAt(pumpX,y,PUMPS._debug.PUMP_CAPACITY,getTile); }catch(e){}
			try{ if(TURRETS && TURRETS._debug && TURRETS._debug.debugChargeAt) TURRETS._debug.debugChargeAt(turretX,y,TURRETS._debug.TURRET_CAPACITY,getTile); }catch(e){}
			try{ if(TURRETS && TURRETS._debug && TURRETS._debug.debugSetWaterAt) TURRETS._debug.debugSetWaterAt(turretX,y,0,getTile); }catch(e){}
			finalizeDebugPlacedCells(cells,'charge');
			return true;
		}
	}
	return false;
}
function placeDebugSolarRig(){
	const facing=player.facing<0 ? -1 : 1;
	const baseX=Math.floor(player.x + facing*4);
	const baseY=Math.floor(player.y)-2;
	const xOffsets=[0,facing,-facing,facing*3,-facing*3,facing*5,-facing*5];
	const yOffsets=[0,-1,1,-2,2,-3,3,4];
	for(const dy of yOffsets){
		for(const dx of xOffsets){
			const panelX=baseX+dx, y=baseY+dy;
			const wireX=panelX+facing;
			const teleX=panelX+facing*2;
			const cells=[
				{x:panelX,y,t:T.SOLAR_BATTERY},
				{x:wireX,y,t:T.COPPER_WIRE},
				{x:teleX,y,t:T.TELEPORTER}
			];
			if(!debugRigCellsClear(cells)) continue;
			placeDebugCells(cells);
			if(SOLAR && SOLAR._debug && SOLAR._debug.debugChargeAt) SOLAR._debug.debugChargeAt(panelX,y,120,getTile);
			try{ if(TELEPORTERS && TELEPORTERS._debug && TELEPORTERS._debug.ensureMachine) TELEPORTERS._debug.ensureMachine(teleX,y,getTile); }catch(e){}
			try{ if(TELEPORTERS && TELEPORTERS.update) TELEPORTERS.update(0.55,{x:teleX+0.5,y:y+0.5,w:0.7,h:0.95,vx:0,vy:0,energy:0},getElectricNetworkTile,setTile,{dynamo:DYNAMO,heroEnergy:MM.heroEnergy}); }catch(e){}
			finalizeDebugPlacedCells(cells,'charge');
			return true;
		}
	}
	return false;
}
function placeDebugTeleporterPair(){
	if(!TELEPORTERS || !DYNAMO || !DYNAMO.plannedCells) return false;
	const baseX=Math.floor(player.x);
	const baseY=Math.floor(player.y);
	const yOffsets=[0,-1,1,-2,2,-3,3];
	const xOffsets=[0,4,-4,8,-8];
	for(const dy of yOffsets){
		for(const dx of xOffsets){
			const y=baseY+dy;
			const leftX=baseX-7+dx;
			const rightX=baseX+7+dx;
			const dynCx=leftX-4;
			const cells=[
				...DYNAMO.plannedCells(dynCx,y,'horizontal'),
				{x:leftX-2,y,t:T.COPPER_WIRE},
				{x:leftX-1,y,t:T.COPPER_WIRE},
				{x:leftX,y,t:T.TELEPORTER},
				{x:rightX,y,t:T.TELEPORTER}
			];
			if(!debugRigCellsClear(cells)) continue;
			placeDebugCells(cells);
			if(FALLING && FALLING.afterPlacement) cells.forEach(cell=>FALLING.afterPlacement(cell.x,cell.y));
			if(WATER && WATER.onTileChanged) cells.forEach(cell=>WATER.onTileChanged(cell.x,cell.y,getTile));
			try{ for(let i=0;i<18;i++) DYNAMO.recordFlow(dynCx,y,T.WATER,4,getTile); }catch(e){}
			try{
				if(TELEPORTERS._debug && TELEPORTERS._debug.debugCharge){
					TELEPORTERS._debug.debugCharge(leftX,y,TELEPORTERS._debug.TELEPORTER_CAPACITY,getTile);
					TELEPORTERS._debug.debugCharge(rightX,y,TELEPORTERS._debug.TELEPORTER_CAPACITY,getTile);
				}
			}catch(e){}
			if(AUDIO && AUDIO.play) AUDIO.play('charge');
			noteSaveActivity();
			saveState();
			return true;
		}
	}
	return false;
}
function placeDebugTeleporterOne(){
	const facing=player.facing<0 ? -1 : 1;
	const baseX=Math.floor(player.x + facing*3);
	const baseY=Math.floor(player.y);
	const dxs=[0,facing,-facing,facing*2,-facing*2,facing*3,-facing*3];
	const dys=[0,-1,1,-2,2,-3,3];
	for(const dy of dys){
		for(const dx of dxs){
			const x=baseX+dx, y=baseY+dy;
			if(!debugRigCellsClear([{x,y,t:T.TELEPORTER}])) continue;
			setTile(x,y,T.TELEPORTER);
			if(FALLING && FALLING.afterPlacement) FALLING.afterPlacement(x,y);
			if(WATER && WATER.onTileChanged) WATER.onTileChanged(x,y,getTile);
			if(TELEPORTERS && TELEPORTERS._debug && TELEPORTERS._debug.debugCharge) TELEPORTERS._debug.debugCharge(x,y,TELEPORTERS._debug.TRAVEL_COST,getTile);
			if(AUDIO && AUDIO.play) AUDIO.play('place');
			noteSaveActivity();
			saveState();
			return true;
		}
	}
	return false;
}
function nearestDebugTeleporter(){
	const cx=Math.floor(player.x), cy=Math.floor(player.y);
	let best=null, bestD=Infinity;
	for(let y=Math.max(worldMinY(),cy-28); y<=Math.min(worldMaxY()-1,cy+28); y++){
		for(let x=cx-48; x<=cx+48; x++){
			if(getTile(x,y)!==T.TELEPORTER) continue;
			const d=Math.abs(x-cx)+Math.abs(y-cy);
			if(d<bestD){ bestD=d; best={x,y}; }
		}
	}
	return best;
}
function jumpDebugTeleporter(dir){
	if(!TELEPORTERS || !TELEPORTERS.nearestTeleporter) return false;
	const target=TELEPORTERS.nearestTeleporter(Math.floor(player.x),Math.floor(player.y),dir<0?-1:1,getTile);
	if(!target) return false;
	player.x=target.x+0.5;
	player.y=target.y+0.5;
	player.vx=0;
	player.vy=0;
	player._teleporterCooldown=0.45;
	centerOnPlayer();
	if(PARTICLES && PARTICLES.spawnEnergyAbsorb) PARTICLES.spawnEnergyAbsorb(player.x*TILE,player.y*TILE,player.x*TILE,(player.y-0.05)*TILE,1.0);
	if(AUDIO && AUDIO.play) AUDIO.play('charge');
	noteSaveActivity();
	saveState();
	return true;
}
function jumpDebugTeleporterLeft(){ return jumpDebugTeleporter(-1); }
function jumpDebugTeleporterRight(){ return jumpDebugTeleporter(1); }
function chargeDebugTeleporter(){
	const s=nearestDebugTeleporter();
	if(!s || !TELEPORTERS || !TELEPORTERS._debug) return false;
	let ok=false;
	if(TELEPORTERS._debug.debugSetEnergy) ok=!!TELEPORTERS._debug.debugSetEnergy(s.x,s.y,TELEPORTERS._debug.TELEPORTER_CAPACITY,getTile);
	else if(TELEPORTERS._debug.debugCharge) ok=TELEPORTERS._debug.debugCharge(s.x,s.y,TELEPORTERS._debug.TELEPORTER_CAPACITY,getTile)>=0;
	if(ok){
		if(PARTICLES && PARTICLES.spawnEnergyAbsorb) PARTICLES.spawnEnergyAbsorb((s.x+0.5)*TILE,(s.y+0.5)*TILE,player.x*TILE,(player.y-0.05)*TILE,1.2);
		if(AUDIO && AUDIO.play) AUDIO.play('charge');
		noteSaveActivity(); saveState();
	}
	return ok;
}
function emptyDebugTeleporter(){
	const s=nearestDebugTeleporter();
	if(!s || !TELEPORTERS || !TELEPORTERS._debug || !TELEPORTERS._debug.debugSetEnergy) return false;
	const ok=TELEPORTERS._debug.debugSetEnergy(s.x,s.y,0,getTile);
	if(ok){ noteSaveActivity(); saveState(); }
	return !!ok;
}
function giveDebugTurrets(){
	inv.turret=(inv.turret||0)+1;
	inv.fireTurret=(inv.fireTurret||0)+1;
	inv.waterTurret=(inv.waterTurret||0)+1;
	updateInventory();
	updateHotbarCounts();
	noteSaveActivity();
	saveState();
	return 3;
}
function placeDebugTurretTile(tile){
	const p=placeDebugSolarTile(tile);
	if(p && TURRETS && TURRETS._debug && TURRETS._debug.debugChargeAt) TURRETS._debug.debugChargeAt(p.x,p.y,TURRETS._debug.TURRET_CAPACITY,getTile);
	return !!p;
}
function placeDebugTurret(){ return placeDebugTurretTile(T.TURRET); }
function placeDebugFireTurret(){ return placeDebugTurretTile(T.FIRE_TURRET); }
function placeDebugWaterTurret(){ return placeDebugTurretTile(T.WATER_TURRET); }
function placeDebugTurretRig(){
	if(!DYNAMO || !DYNAMO.plannedCells) return false;
	const facing=player.facing<0 ? -1 : 1;
	const baseX=Math.floor(player.x + facing*4);
	const baseY=Math.floor(player.y)-1;
	const yOffsets=[0,-1,1,-2,2,-3,3,4];
	const xOffsets=[0,facing*2,-facing*2,facing*4,-facing*4];
	for(const dy of yOffsets){
		for(const dx of xOffsets){
			const y=baseY+dy;
			const dynCx=baseX+dx;
			const turretX=dynCx+facing*5;
			const cells=[
				...DYNAMO.plannedCells(dynCx,y,'horizontal'),
				{x:dynCx+facing*2,y,t:T.COPPER_WIRE},
				{x:dynCx+facing*3,y,t:T.COPPER_WIRE},
				{x:dynCx+facing*4,y,t:T.COPPER_WIRE},
				{x:turretX,y,t:T.TURRET}
			];
			if(!debugRigCellsClear(cells)) continue;
			placeDebugCells(cells);
			try{ for(let i=0;i<18;i++) DYNAMO.recordFlow(dynCx,y,T.WATER,4,getTile); }catch(e){}
			try{ if(TURRETS && TURRETS._debug && TURRETS._debug.debugChargeAt) TURRETS._debug.debugChargeAt(turretX,y,TURRETS._debug.TURRET_CAPACITY,getTile); }catch(e){}
			finalizeDebugPlacedCells(cells,'charge');
			return true;
		}
	}
	return false;
}
function nearestDebugTurret(){
	const cx=Math.floor(player.x), cy=Math.floor(player.y);
	let best=null, bestD=Infinity;
	for(let y=Math.max(worldMinY(),cy-28); y<=Math.min(worldMaxY()-1,cy+28); y++){
		for(let x=cx-48; x<=cx+48; x++){
			const t=getTile(x,y);
			if(t!==T.TURRET && t!==T.FIRE_TURRET && t!==T.WATER_TURRET) continue;
			const d=Math.abs(x-cx)+Math.abs(y-cy);
			if(d<bestD){ bestD=d; best={x,y,t}; }
		}
	}
	return best;
}
function chargeDebugTurret(){
	const s=nearestDebugTurret();
	if(!s || !TURRETS || !TURRETS._debug || !TURRETS._debug.debugChargeAt) return false;
	const got=TURRETS._debug.debugChargeAt(s.x,s.y,TURRETS._debug.TURRET_CAPACITY,getTile);
	if(got>0){
		if(PARTICLES && PARTICLES.spawnEnergyAbsorb) PARTICLES.spawnEnergyAbsorb((s.x+0.5)*TILE,(s.y+0.5)*TILE,player.x*TILE,(player.y-0.05)*TILE,1.15);
		if(AUDIO && AUDIO.play) AUDIO.play('charge');
		noteSaveActivity(); saveState();
	}
	return got>0;
}
function emptyDebugTurret(){
	const s=nearestDebugTurret();
	if(!s || !TURRETS || !TURRETS._debug || !TURRETS._debug.debugSetEnergyAt) return false;
	const ok=!!TURRETS._debug.debugSetEnergyAt(s.x,s.y,0,getTile);
	if(ok){ noteSaveActivity(); saveState(); }
	return ok;
}
function giveDebugSpringPlatforms(){
	inv.springPlatform=(inv.springPlatform||0)+2;
	inv.copperWire=(inv.copperWire||0)+12;
	updateInventory();
	updateHotbarCounts();
	noteSaveActivity();
	saveState();
	return 2;
}
function placeDebugSpringPlatform(){
	const p=placeDebugSolarTile(T.SPRING_PLATFORM);
	if(p && SPRING_PLATFORMS && SPRING_PLATFORMS._debug && SPRING_PLATFORMS._debug.debugChargeAt){
		SPRING_PLATFORMS._debug.debugChargeAt(p.x,p.y,SPRING_PLATFORMS._debug.CAPACITY,getTile);
	}
	return !!p;
}
function nearestDebugSpringPlatform(){
	const cx=Math.floor(player.x), cy=Math.floor(player.y);
	let best=null, bestD=Infinity;
	for(let y=Math.max(worldMinY(),cy-28); y<=Math.min(worldMaxY()-1,cy+28); y++){
		for(let x=cx-48; x<=cx+48; x++){
			if(getTile(x,y)!==T.SPRING_PLATFORM) continue;
			const d=Math.abs(x-cx)+Math.abs(y-cy);
			if(d<bestD){ bestD=d; best={x,y}; }
		}
	}
	return best;
}
function chargeDebugSpringPlatform(){
	const s=nearestDebugSpringPlatform();
	if(!s || !SPRING_PLATFORMS || !SPRING_PLATFORMS._debug || !SPRING_PLATFORMS._debug.debugChargeAt) return false;
	const got=SPRING_PLATFORMS._debug.debugChargeAt(s.x,s.y,SPRING_PLATFORMS._debug.CAPACITY,getTile);
	if(got>0){
		if(PARTICLES && PARTICLES.spawnEnergyAbsorb) PARTICLES.spawnEnergyAbsorb((s.x+0.5)*TILE,(s.y+0.5)*TILE,player.x*TILE,(player.y-0.05)*TILE,1.15);
		if(AUDIO && AUDIO.play) AUDIO.play('charge');
		noteSaveActivity(); saveState();
	}
	return got>0;
}
function emptyDebugSpringPlatform(){
	const s=nearestDebugSpringPlatform();
	if(!s || !SPRING_PLATFORMS || !SPRING_PLATFORMS._debug || !SPRING_PLATFORMS._debug.debugSetEnergyAt) return false;
	const ok=!!SPRING_PLATFORMS._debug.debugSetEnergyAt(s.x,s.y,0,getTile);
	if(ok){ noteSaveActivity(); saveState(); }
	return ok;
}
function placeDebugSpringRig(){
	if(!DYNAMO || !DYNAMO.plannedCells) return false;
	const facing=player.facing<0 ? -1 : 1;
	const baseX=Math.floor(player.x + facing*4);
	const baseY=Math.floor(player.y)-1;
	const yOffsets=[0,-1,1,-2,2,-3,3,4];
	const xOffsets=[0,facing*2,-facing*2,facing*4,-facing*4];
	for(const dy of yOffsets){
		for(const dx of xOffsets){
			const y=baseY+dy;
			const dynCx=baseX+dx;
			const springX=dynCx+facing*4;
			const cells=[
				...DYNAMO.plannedCells(dynCx,y,'horizontal'),
				{x:dynCx+facing*2,y,t:T.COPPER_WIRE},
				{x:dynCx+facing*3,y,t:T.COPPER_WIRE},
				{x:springX,y,t:T.SPRING_PLATFORM}
			];
			if(!debugRigCellsClear(cells)) continue;
			placeDebugCells(cells);
			try{ for(let i=0;i<18;i++) DYNAMO.recordFlow(dynCx,y,T.WATER,4,getTile); }catch(e){}
			try{ if(SPRING_PLATFORMS && SPRING_PLATFORMS._debug && SPRING_PLATFORMS._debug.debugChargeAt) SPRING_PLATFORMS._debug.debugChargeAt(springX,y,SPRING_PLATFORMS._debug.CAPACITY,getTile); }catch(e){}
			finalizeDebugPlacedCells(cells,'charge');
			return true;
		}
	}
	return false;
}
function markDebugCompanionChanged(){
	noteSaveActivity();
	saveState();
	return true;
}
window.addEventListener('mm-companion-change',()=>{ markDebugCompanionChanged(); });
function giveDebugCompanionIngredients(){
	inv.alienBiomass=(inv.alienBiomass||0)+20;
	inv.meat=(inv.meat||0)+20;
	updateInventory();
	updateHotbarCounts();
	markDebugCompanionChanged();
	return true;
}
function debugGolemClayMass(amount){
	const min=(COMPANIONS && COMPANIONS._debug && COMPANIONS._debug.clayGolemMin) || 6;
	const max=(COMPANIONS && COMPANIONS._debug && COMPANIONS._debug.clayGolemMax) || 18;
	const v=Math.floor(Number(amount)||8);
	return Math.max(min,Math.min(max,v));
}
function debugLeafMonsterMass(amount){
	const min=(COMPANIONS && COMPANIONS._debug && COMPANIONS._debug.leafMonsterMin) || 5;
	const max=(COMPANIONS && COMPANIONS._debug && COMPANIONS._debug.leafMonsterMax) || 16;
	const v=Math.floor(Number(amount)||8);
	return Math.max(min,Math.min(max,v));
}
function debugWaterGolemMass(amount){
	const min=(COMPANIONS && COMPANIONS._debug && COMPANIONS._debug.waterGolemMin) || 6;
	const max=(COMPANIONS && COMPANIONS._debug && COMPANIONS._debug.waterGolemMax) || 20;
	const v=Math.floor(Number(amount)||10);
	return Math.max(min,Math.min(max,v));
}
function debugMeatGolemMass(amount){
	const min=(COMPANIONS && COMPANIONS._debug && COMPANIONS._debug.meatGolemMin) || 6;
	const max=(COMPANIONS && COMPANIONS._debug && COMPANIONS._debug.meatGolemMax) || 18;
	const v=Math.floor(Number(amount)||10);
	return Math.max(min,Math.min(max,v));
}
function debugMolekinLavaMass(amount){
	const min=(COMPANIONS && COMPANIONS._debug && COMPANIONS._debug.molekinMin) || 1;
	const max=(COMPANIONS && COMPANIONS._debug && COMPANIONS._debug.molekinMax) || 20;
	const v=Math.floor(Number(amount)||4);
	return Math.max(min,Math.min(max,v));
}
function giveDebugGolemIngredients(){
	inv.clay=(inv.clay||0)+24;
	inv.masterStone=(inv.masterStone||0)+3;
	updateInventory();
	updateHotbarCounts();
	noteSaveActivity();
	saveState();
	return true;
}
function giveDebugLeafMonsterIngredients(){
	inv.leaf=(inv.leaf||0)+40;
	inv.servantStone=(inv.servantStone||0)+4;
	updateInventory();
	updateHotbarCounts();
	noteSaveActivity();
	saveState();
	return true;
}
function giveDebugWaterGolemIngredients(){
	inv.water=(inv.water||0)+40;
	inv.masterStone=(inv.masterStone||0)+4;
	updateInventory();
	updateHotbarCounts();
	noteSaveActivity();
	saveState();
	return true;
}
function giveDebugMeatGolemIngredients(){
	inv.meat=(inv.meat||0)+40;
	inv.masterStone=(inv.masterStone||0)+4;
	updateInventory();
	updateHotbarCounts();
	noteSaveActivity();
	saveState();
	return true;
}
function giveDebugMolekinIngredients(){
	inv.masterStone=(inv.masterStone||0)+4;
	inv.motherLava=(inv.motherLava||0)+8;
	updateInventory();
	updateHotbarCounts();
	noteSaveActivity();
	saveState();
	return true;
}
function spawnDebugCompanion(biomass){
	if(!COMPANIONS || !COMPANIONS._debug || !COMPANIONS._debug.spawn) return false;
	const c=COMPANIONS._debug.spawn(player,biomass,getTile);
	if(c) markDebugCompanionChanged();
	return !!c;
}
function spawnDebugGolem(clay){
	if(!COMPANIONS || !COMPANIONS._debug || !COMPANIONS._debug.spawnGolem) return false;
	const c=COMPANIONS._debug.spawnGolem(player,debugGolemClayMass(clay),getTile);
	if(c) markDebugCompanionChanged();
	return !!c;
}
function spawnDebugLeafMonster(leaves){
	if(!COMPANIONS || !COMPANIONS._debug || !COMPANIONS._debug.spawnLeafMonster) return false;
	const c=COMPANIONS._debug.spawnLeafMonster(player,debugLeafMonsterMass(leaves),getTile);
	if(c) markDebugCompanionChanged();
	return !!c;
}
function spawnDebugWaterGolem(water){
	if(!COMPANIONS || !COMPANIONS._debug || !COMPANIONS._debug.spawnWaterGolem) return false;
	const c=COMPANIONS._debug.spawnWaterGolem(player,debugWaterGolemMass(water),getTile);
	if(c) markDebugCompanionChanged();
	return !!c;
}
function spawnDebugMeatGolem(meat){
	if(!COMPANIONS || !COMPANIONS._debug || !COMPANIONS._debug.spawnMeatGolem) return false;
	const c=COMPANIONS._debug.spawnMeatGolem(player,debugMeatGolemMass(meat),getTile);
	if(c) markDebugCompanionChanged();
	return !!c;
}
function spawnDebugMolekin(lava){
	if(!COMPANIONS || !COMPANIONS._debug || !COMPANIONS._debug.spawnMolekin) return false;
	const c=COMPANIONS._debug.spawnMolekin(player,debugMolekinLavaMass(lava),getTile);
	if(c) markDebugCompanionChanged();
	return !!c;
}
function setDebugGolemClay(clay){
	if(!COMPANIONS || !COMPANIONS._debug || !COMPANIONS._debug.setClay) return false;
	const ok=!!COMPANIONS._debug.setClay(player,debugGolemClayMass(clay));
	if(ok) markDebugCompanionChanged();
	return ok;
}
function setDebugLeafMonsterLeaves(leaves){
	if(!COMPANIONS || !COMPANIONS._debug || !COMPANIONS._debug.setLeaves) return false;
	const ok=!!COMPANIONS._debug.setLeaves(player,debugLeafMonsterMass(leaves));
	if(ok) markDebugCompanionChanged();
	return ok;
}
function setDebugWaterGolemMass(water){
	if(!COMPANIONS || !COMPANIONS._debug || !COMPANIONS._debug.setWater) return false;
	const ok=!!COMPANIONS._debug.setWater(player,debugWaterGolemMass(water));
	if(ok) markDebugCompanionChanged();
	return ok;
}
function setDebugMeatGolemMass(meat){
	if(!COMPANIONS || !COMPANIONS._debug || !COMPANIONS._debug.setMeat) return false;
	const ok=!!COMPANIONS._debug.setMeat(player,debugMeatGolemMass(meat));
	if(ok) markDebugCompanionChanged();
	return ok;
}
function setDebugMolekinLava(lava){
	if(!COMPANIONS || !COMPANIONS._debug || !COMPANIONS._debug.setLava) return false;
	const ok=!!COMPANIONS._debug.setLava(player,debugMolekinLavaMass(lava));
	if(ok) markDebugCompanionChanged();
	return ok;
}
function rotDebugMeatGolem(){
	if(!COMPANIONS || !COMPANIONS._debug || !COMPANIONS._debug.rotMeatGolem) return false;
	const ok=!!COMPANIONS._debug.rotMeatGolem(player);
	if(ok) markDebugCompanionChanged();
	return ok;
}
function cookDebugMeatGolem(){
	if(!COMPANIONS || !COMPANIONS._debug || !COMPANIONS._debug.cookMeatGolem) return false;
	const ok=!!COMPANIONS._debug.cookMeatGolem(player);
	if(ok) markDebugCompanionChanged();
	return ok;
}
function feedDebugCompanion(amount){
	if(!COMPANIONS || !COMPANIONS._debug || !COMPANIONS._debug.feed) return false;
	const ok=!!COMPANIONS._debug.feed(player,amount);
	if(ok) markDebugCompanionChanged();
	return ok;
}
function setDebugCompanionBiomass(amount){
	if(!COMPANIONS || !COMPANIONS._debug || !COMPANIONS._debug.setBiomass) return false;
	const ok=!!COMPANIONS._debug.setBiomass(player,amount);
	if(ok) markDebugCompanionChanged();
	return ok;
}
function healDebugCompanion(){
	if(!COMPANIONS || !COMPANIONS._debug || !COMPANIONS._debug.heal) return false;
	const ok=!!COMPANIONS._debug.heal(player);
	if(ok) markDebugCompanionChanged();
	return ok;
}
function damageDebugCompanion(amount){
	if(!COMPANIONS || !COMPANIONS._debug || !COMPANIONS._debug.damageNearest) return false;
	const ok=!!COMPANIONS._debug.damageNearest(player,amount);
	if(ok) markDebugCompanionChanged();
	return ok;
}
function killDebugCompanion(){
	if(!COMPANIONS || !COMPANIONS._debug || !COMPANIONS._debug.kill) return false;
	const ok=!!COMPANIONS._debug.kill(player);
	if(ok) markDebugCompanionChanged();
	return ok;
}
function teleportDebugCompanion(){
	if(!COMPANIONS || !COMPANIONS._debug || !COMPANIONS._debug.teleportToHero) return false;
	const ok=!!COMPANIONS._debug.teleportToHero(player,getTile);
	if(ok) markDebugCompanionChanged();
	return ok;
}
function gasDebugCompanion(){
	if(!COMPANIONS || !COMPANIONS._debug || !COMPANIONS._debug.forceGas) return false;
	const ok=!!COMPANIONS._debug.forceGas(player,getTile,setTile);
	if(ok) markDebugCompanionChanged();
	return ok;
}
function laserDebugCompanion(){
	if(!COMPANIONS || !COMPANIONS._debug || !COMPANIONS._debug.forceLaser) return false;
	const ok=!!COMPANIONS._debug.forceLaser(player,getTile);
	if(ok) markDebugCompanionChanged();
	return ok;
}
function waterSprayDebugCompanion(){
	if(!COMPANIONS || !COMPANIONS._debug || !COMPANIONS._debug.forceWaterSpray) return false;
	const ok=!!COMPANIONS._debug.forceWaterSpray(player,getTile);
	if(ok) markDebugCompanionChanged();
	return ok;
}
function molekinFireDebugCompanion(){
	if(!COMPANIONS || !COMPANIONS._debug || !COMPANIONS._debug.forceMolekinFire) return false;
	const ok=!!COMPANIONS._debug.forceMolekinFire(player,getTile,setTile);
	if(ok) markDebugCompanionChanged();
	return ok;
}
function guardDebugGolem(amount){
	if(!COMPANIONS || !COMPANIONS._debug || !COMPANIONS._debug.guardHero) return false;
	const ok=!!COMPANIONS._debug.guardHero(player,Math.max(1,Number(amount)||30));
	if(ok) markDebugCompanionChanged();
	return ok;
}
function shieldDebugGolem(){
	if(!COMPANIONS || !COMPANIONS._debug || !COMPANIONS._debug.shieldGolem) return false;
	const ok=!!COMPANIONS._debug.shieldGolem(player);
	if(ok) markDebugCompanionChanged();
	return ok;
}
function meleeDebugGolem(){
	if(!COMPANIONS || !COMPANIONS._debug || !COMPANIONS._debug.forceGolemStrike) return false;
	const ok=!!COMPANIONS._debug.forceGolemStrike(player,getTile);
	if(ok) markDebugCompanionChanged();
	return ok;
}
function debugGolemWetClayOffsets(){
	return [
		[-1,0],[1,0],[0,-1],[0,1],[-1,1],[1,1],[-1,-1],[1,-1],
		[-2,0],[2,0],[0,-2],[0,2],[-2,1],[2,1],[-1,2],[1,2],[-2,-1],[2,-1]
	];
}
function placeDebugGolemRitual(clay){
	if(!COMPANIONS || !COMPANIONS.tryClayGolemRitualAt) return false;
	const mass=debugGolemClayMass(clay);
	const facing=player.facing<0 ? -1 : 1;
	const baseY=Math.floor(player.y)-2;
	const offsets=debugGolemWetClayOffsets().slice(0,mass);
	const dists=[4,5,6,3,7,8];
	const yShifts=[0,-1,1,-2,2];
	for(const dist of dists){
		for(const yShift of yShifts){
			const mx=Math.floor(player.x)+facing*dist;
			const my=baseY+yShift;
			const cells=offsets.map(([dx,dy])=>({x:mx+dx,y:my+dy,t:T.WET_CLAY}));
			cells.push({x:mx,y:my,t:T.VOLCANO_MASTER_STONE});
			if(!debugRigCellsClear(cells)) continue;
			const before=COMPANIONS.count ? COMPANIONS.count() : 0;
			const beforeGolems=(COMPANIONS.metrics && COMPANIONS.metrics().golems) || 0;
			for(let i=0;i<cells.length-1;i++) setTile(cells[i].x,cells[i].y,cells[i].t);
			const master=cells[cells.length-1];
			setTile(master.x,master.y,master.t);
			let after=COMPANIONS.count ? COMPANIONS.count() : before;
			if(after<=before){
				COMPANIONS.tryClayGolemRitualAt(master.x,master.y,getTile,setTile,{announce:true,debugReplace:true});
				after=COMPANIONS.count ? COMPANIONS.count() : before;
			}
			const afterGolems=(COMPANIONS.metrics && COMPANIONS.metrics().golems) || 0;
			if(after>before || afterGolems>beforeGolems){
				noteSaveActivity();
				saveState();
				return true;
			}
			finalizeDebugPlacedCells(cells,'place');
			msg('Debug golema: ulozono rytual, ale nie powstal golem');
			return false;
		}
	}
	msg('Debug golema: brak miejsca na rytual');
	return false;
}
function debugLeafRitualOffsets(){
	return [
		[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1],
		[-2,0],[2,0],[0,-2],[0,2],[-2,-1],[2,-1],[-1,-2],[1,-2]
	];
}
function placeDebugLeafRitual(leaves){
	if(!COMPANIONS || !COMPANIONS.tryLeafMonsterRitualAt) return false;
	const mass=debugLeafMonsterMass(leaves);
	const facing=player.facing<0 ? -1 : 1;
	const baseY=Math.floor(player.y)-3;
	const offsets=debugLeafRitualOffsets().slice(0,mass);
	const dists=[4,5,6,3,7,8];
	const yShifts=[0,-1,1,-2,2];
	for(const dist of dists){
		for(const yShift of yShifts){
			const sx=Math.floor(player.x)+facing*dist;
			const sy=baseY+yShift;
			const cells=offsets.map(([dx,dy])=>({x:sx+dx,y:sy+dy,t:T.LEAF}));
			cells.push({x:sx,y:sy,t:T.SERVANT_STONE});
			if(!debugRigCellsClear(cells)) continue;
			const before=COMPANIONS.count ? COMPANIONS.count() : 0;
			const beforeLeaf=(COMPANIONS.metrics && COMPANIONS.metrics().leafMonsters) || 0;
			for(let i=0;i<cells.length-1;i++) setTile(cells[i].x,cells[i].y,cells[i].t);
			const stone=cells[cells.length-1];
			setTile(stone.x,stone.y,stone.t);
			let after=COMPANIONS.count ? COMPANIONS.count() : before;
			if(after<=before){
				COMPANIONS.tryLeafMonsterRitualAt(stone.x,stone.y,getTile,setTile,{announce:true,debugReplace:true});
				after=COMPANIONS.count ? COMPANIONS.count() : before;
			}
			const afterLeaf=(COMPANIONS.metrics && COMPANIONS.metrics().leafMonsters) || 0;
			if(after>before || afterLeaf>beforeLeaf){
				noteSaveActivity();
				saveState();
				return true;
			}
			finalizeDebugPlacedCells(cells,'place');
			msg('Debug lisciaka: ulozono rytual, ale nie powstal potworek');
			return false;
		}
	}
	msg('Debug lisciaka: brak miejsca na rytual');
	return false;
}
function debugWaterRitualOffsets(){
	return [
		[-1,0],[1,0],[0,-1],[0,1],
		[-1,-1],[1,-1],[-1,1],[1,1],
		[-2,0],[2,0],[0,-2],[0,2],
		[-2,-1],[2,-1],[-2,1],[2,1],
		[-1,-2],[1,-2],[-1,2],[1,2]
	];
}
function placeDebugWaterRitual(water){
	if(!COMPANIONS || !COMPANIONS.tryWaterGolemRitualAt) return false;
	const mass=debugWaterGolemMass(water);
	const facing=player.facing<0 ? -1 : 1;
	const baseY=Math.floor(player.y)-3;
	const offsets=debugWaterRitualOffsets().slice(0,mass);
	const dists=[4,5,6,3,7,8];
	const yShifts=[0,-1,1,-2,2];
	for(const dist of dists){
		for(const yShift of yShifts){
			const sx=Math.floor(player.x)+facing*dist;
			const sy=baseY+yShift;
			const cells=offsets.map(([dx,dy])=>({x:sx+dx,y:sy+dy,t:T.WATER}));
			cells.push({x:sx,y:sy,t:T.VOLCANO_MASTER_STONE});
			if(!debugRigCellsClear(cells)) continue;
			const before=COMPANIONS.count ? COMPANIONS.count() : 0;
			const beforeWater=(COMPANIONS.metrics && COMPANIONS.metrics().waterGolems) || 0;
			for(let i=0;i<cells.length-1;i++) setTile(cells[i].x,cells[i].y,cells[i].t);
			const stone=cells[cells.length-1];
			setTile(stone.x,stone.y,stone.t);
			let after=COMPANIONS.count ? COMPANIONS.count() : before;
			if(after<=before){
				COMPANIONS.tryWaterGolemRitualAt(stone.x,stone.y,getTile,setTile,{announce:true,debugReplace:true});
				after=COMPANIONS.count ? COMPANIONS.count() : before;
			}
			const afterWater=(COMPANIONS.metrics && COMPANIONS.metrics().waterGolems) || 0;
			if(after>before || afterWater>beforeWater){
				noteSaveActivity();
				saveState();
				return true;
			}
			finalizeDebugPlacedCells(cells,'place');
			msg('Debug wodnego golema: ulozono rytual, ale nie powstal golem');
			return false;
		}
	}
	msg('Debug wodnego golema: brak miejsca na rytual');
	return false;
}
function placeDebugMolekinRitual(lava){
	if(!COMPANIONS || !COMPANIONS.tryMolekinRitualAt) return false;
	const mass=debugMolekinLavaMass(lava);
	const facing=player.facing<0 ? -1 : 1;
	const baseY=Math.floor(player.y)-3;
	const offsets=debugWaterRitualOffsets().slice(0,mass);
	const dists=[4,5,6,3,7,8];
	const yShifts=[0,-1,1,-2,2];
	for(const dist of dists){
		for(const yShift of yShifts){
			const sx=Math.floor(player.x)+facing*dist;
			const sy=baseY+yShift;
			const cells=offsets.map(([dx,dy])=>({x:sx+dx,y:sy+dy,t:T.MOTHER_LAVA}));
			cells.push({x:sx,y:sy,t:T.VOLCANO_MASTER_STONE});
			if(!debugRigCellsClear(cells)) continue;
			const before=COMPANIONS.count ? COMPANIONS.count() : 0;
			const beforeMole=(COMPANIONS.metrics && COMPANIONS.metrics().molekin) || 0;
			for(let i=0;i<cells.length-1;i++) setTile(cells[i].x,cells[i].y,cells[i].t);
			const stone=cells[cells.length-1];
			setTile(stone.x,stone.y,stone.t);
			let after=COMPANIONS.count ? COMPANIONS.count() : before;
			if(after<=before){
				COMPANIONS.tryMolekinRitualAt(stone.x,stone.y,getTile,setTile,{announce:true,debugReplace:true,ignoreGuardian:true});
				after=COMPANIONS.count ? COMPANIONS.count() : before;
			}
			const afterMole=(COMPANIONS.metrics && COMPANIONS.metrics().molekin) || 0;
			if(after>before || afterMole>beforeMole){
				noteSaveActivity();
				saveState();
				return true;
			}
			finalizeDebugPlacedCells(cells,'place');
			msg('Debug kretoludzia: ulozono rytual, ale nie powstal kretoludz');
			return false;
		}
	}
	msg('Debug kretoludzia: brak miejsca na rytual');
	return false;
}
function debugMeatRitualOffsets(){
	return [
		[-1,0],[1,0],[0,-1],[0,1],[-1,1],[1,1],[-1,-1],[1,-1],
		[-2,0],[2,0],[0,-2],[0,2],[-2,1],[2,1],[-1,2],[1,2],[-2,-1],[2,-1]
	];
}
function placeDebugMeatRitual(meat){
	if(!COMPANIONS || !COMPANIONS.tryMeatGolemRitualAt) return false;
	const mass=debugMeatGolemMass(meat);
	const facing=player.facing<0 ? -1 : 1;
	const baseY=Math.floor(player.y)-2;
	const offsets=debugMeatRitualOffsets().slice(0,mass);
	const dists=[4,5,6,3,7,8];
	const yShifts=[0,-1,1,-2,2];
	for(const dist of dists){
		for(const yShift of yShifts){
			const sx=Math.floor(player.x)+facing*dist;
			const sy=baseY+yShift;
			const cells=offsets.map(([dx,dy])=>({x:sx+dx,y:sy+dy,t:T.MEAT}));
			cells.push({x:sx,y:sy,t:T.VOLCANO_MASTER_STONE});
			if(!debugRigCellsClear(cells)) continue;
			const before=COMPANIONS.count ? COMPANIONS.count() : 0;
			const beforeMeat=(COMPANIONS.metrics && COMPANIONS.metrics().meatGolems) || 0;
			for(let i=0;i<cells.length-1;i++) setTile(cells[i].x,cells[i].y,cells[i].t);
			const stone=cells[cells.length-1];
			setTile(stone.x,stone.y,stone.t);
			let after=COMPANIONS.count ? COMPANIONS.count() : before;
			if(after<=before){
				COMPANIONS.tryMeatGolemRitualAt(stone.x,stone.y,getTile,setTile,{announce:true,debugReplace:true});
				after=COMPANIONS.count ? COMPANIONS.count() : before;
			}
			const afterMeat=(COMPANIONS.metrics && COMPANIONS.metrics().meatGolems) || 0;
			if(after>before || afterMeat>beforeMeat){
				noteSaveActivity();
				saveState();
				return true;
			}
			finalizeDebugPlacedCells(cells,'place');
			msg('Debug miesnego golema: ulozono rytual, ale nie powstal golem');
			return false;
		}
	}
	msg('Debug miesnego golema: brak miejsca na rytual');
	return false;
}
function clearDebugCompanions(){
	if(!COMPANIONS || !COMPANIONS._debug || !COMPANIONS._debug.clear) return false;
	const ok=!!COMPANIONS._debug.clear();
	if(ok) markDebugCompanionChanged();
	return ok;
}
function debugCompanionList(){
	return (COMPANIONS && COMPANIONS._debug && COMPANIONS._debug.list) ? COMPANIONS._debug.list() : [];
}
function debugMechList(){
	return (MECHS && MECHS._debug && MECHS._debug.mechs) ? MECHS._debug.mechs() : [];
}
function debugMechBounds(m){
	let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
	const cells=(m&&m.cells)||[];
	for(const c of cells){
		minX=Math.min(minX,c.dx);
		minY=Math.min(minY,c.dy);
		maxX=Math.max(maxX,c.dx);
		maxY=Math.max(maxY,c.dy);
	}
	if(!cells.length) return {minX:0,minY:0,maxX:4,maxY:5,w:5,h:6};
	return {minX,maxX,minY,maxY,w:maxX-minX+1,h:maxY-minY+1};
}
function debugMechCenter(m){
	const b=debugMechBounds(m);
	return {x:m.x+(b.minX+b.maxX+1)*0.5,y:m.y+(b.minY+b.maxY+1)*0.5};
}
function debugMechCockpit(m){
	return (m&&m.cells||[]).find(c=>c.role==='cockpit') || (m&&m.cells||[]).find(c=>c.t===T.GLASS) || {dx:2,dy:1};
}
function debugNearestMech(maxDist){
	const riding=(MECHS && MECHS.heroMech) ? MECHS.heroMech() : null;
	if(riding) return riding;
	const max2=Number.isFinite(maxDist) ? maxDist*maxDist : Infinity;
	let best=null,bestD=max2;
	for(const m of debugMechList()){
		if(!m || m.hp<=0) continue;
		const c=debugMechCenter(m);
		const d2=(c.x-player.x)*(c.x-player.x)+(c.y-player.y)*(c.y-player.y);
		if(d2<bestD){ best=m; bestD=d2; }
	}
	return best;
}
function debugMechFocus(){
	const m=debugNearestMech(120);
	if(!m) return null;
	return {
		id:m.id,
		kind:m.kind,
		x:+m.x.toFixed(1),
		y:+m.y.toFixed(1),
		hp:+(m.hp||0).toFixed(1),
		maxHp:+(m.maxHp||0).toFixed(1),
		pilot:+(m.pilotHp||0).toFixed(1),
		pilotMax:+(m.pilotMaxHp||0).toFixed(1),
		pilotAlive:!!m.pilotAlive,
		rider:!!m.rider,
		energy:+(m.energy||0).toFixed(1),
		maxEnergy:+(m.maxEnergy||0).toFixed(1),
		fuel:+(m.fuel||0).toFixed(1),
		maxFuel:+(m.maxFuel||0).toFixed(1),
		trackCircuit:m.trackCircuitOk!==false,
		hasTurret:!!(MECHS && MECHS._debug && MECHS._debug.mountedTurretCell && MECHS._debug.mountedTurretCell(m)),
		turretCircuit:!!m.turretCircuitOk,
		onGround:!!m.onGround,
		blocked:+(m.blockedT||m.obstacleStrikeT||0).toFixed(1),
		jumps:m.uncertainJumpTries||0
	};
}
function debugMechMetrics(){
	const base=(MECHS && MECHS.metrics) ? MECHS.metrics() : null;
	if(!base) return null;
	return Object.assign({},base,{focus:debugMechFocus()});
}
function markDebugMechChanged(){
	noteSaveActivity();
	saveState();
	return true;
}
function debugStepMechs(frames,controls){
	if(!MECHS || !MECHS.update) return false;
	const n=Math.max(1,Math.min(180,frames|0));
	for(let i=0;i<n;i++){
		MECHS.update(1/60,player,getTile,setTile,{controls:controls||companionControlState(),godMode,heroEnergy:MM.heroEnergy});
		if(MECHS.syncRider) MECHS.syncRider(player);
	}
	return true;
}
function spawnDebugMech(kind){
	if(!MECHS || !MECHS.forceSpawn) return false;
	const spawnKind=kind==='solar' ? 'solar' : (kind==='forge_tracks' ? 'forge_tracks' : 'forge');
	const m=MECHS.forceSpawn(spawnKind,player,getTile,setTile);
	if(!m) return false;
	debugStepMechs(18,{});
	centerOnPlayer();
	return markDebugMechChanged();
}
function debugJumpMechZone(dir){
	const dbg=MECHS && MECHS._debug;
	const cfg=dbg && dbg.CFG;
	if(!dbg || !cfg || !dbg.zoneShouldSpawn || !dbg.zoneSpawnX) return debugJumpHero(dir>0?6000:-6000);
	const min=Math.max(5000,Number(cfg.MIN_DISTANCE)||5000);
	const zoneW=Math.max(100,Number(cfg.ZONE_W)||380);
	let z=dir>0 ? Math.floor(min/zoneW) : -Math.floor(min/zoneW)-1;
	for(let i=0;i<120;i++,z+=dir>0?1:-1){
		if(dbg.zoneShouldSpawn(z)){
			const x=dbg.zoneSpawnX(z);
			return debugJumpHero(Math.round(x + (dir>0?-1:1)*Math.max(18,Number(cfg.PLAYER_SPAWN_GAP)||24)));
		}
	}
	return debugJumpHero(dir>0?6000:-6000);
}
function spawnDebugZoneMech(dir){
	const dbg=MECHS && MECHS._debug;
	const cfg=dbg && dbg.CFG;
	if(!dbg || !dbg.trySpawnZone || !dbg.zoneShouldSpawn || !dbg.zoneSpawnX || !cfg) return false;
	const min=Math.max(5000,Number(cfg.MIN_DISTANCE)||5000);
	const zoneW=Math.max(100,Number(cfg.ZONE_W)||380);
	let z=dir>0 ? Math.floor(min/zoneW) : -Math.floor(min/zoneW)-1;
	for(let i=0;i<180;i++,z+=dir>0?1:-1){
		if(!dbg.zoneShouldSpawn(z)) continue;
		const x=dbg.zoneSpawnX(z);
		if(Math.abs(x)<min) continue;
		const m=dbg.trySpawnZone(z,getTile,null);
		if(!m) continue;
		const b=debugMechBounds(m);
		player.x=m.x+(dir>0 ? b.minX-Math.max(16,Number(cfg.PLAYER_SPAWN_GAP)||24) : b.maxX+Math.max(16,Number(cfg.PLAYER_SPAWN_GAP)||24));
		player.y=Math.max(WORLD_MIN_Y+2,Math.min(WORLD_MAX_Y-2,m.y+b.maxY-1.2));
		player.vx=0; player.vy=0;
		centerOnPlayer();
		return markDebugMechChanged();
	}
	return false;
}
function debugMoveHeroToMech(m){
	if(!m) return false;
	const c=debugMechCockpit(m);
	player.x=m.x+c.dx+0.5;
	player.y=m.y+c.dy+0.1;
	player.vx=0; player.vy=0;
	centerOnPlayer();
	return true;
}
function killDebugMechPilot(){
	const m=debugNearestMech(160) || (spawnDebugMech('forge') && debugNearestMech(160));
	if(!m || !m.pilotAlive) return false;
	const c=debugMechCockpit(m);
	for(let i=0;i<16 && m.pilotAlive;i++){
		MECHS.damageAt(Math.floor(m.x+c.dx),Math.floor(m.y+c.dy),18,{source:'hero',kind:'debug_pilot'});
	}
	debugStepMechs(4,{});
	m.pilotHp=Math.max(0,Number(m.pilotHp)||0);
	if(m.pilotHp<=0) m.pilotAlive=false;
	return markDebugMechChanged() && !m.pilotAlive;
}
function toggleDebugMechBoard(){
	if(!MECHS || !MECHS.toggleBoard) return false;
	if(MECHS.heroMech && MECHS.heroMech()){
		const ok=!!MECHS.toggleBoard(player,getTile);
		if(ok){ centerOnPlayer(); markDebugMechChanged(); }
		return ok;
	}
	const m=debugNearestMech(160);
	if(!m || m.pilotAlive) return false;
	debugMoveHeroToMech(m);
	const ok=!!MECHS.toggleBoard(player,getTile);
	if(ok){ debugStepMechs(3,{}); centerOnPlayer(); markDebugMechChanged(); }
	return ok;
}
function captureDebugMech(){
	const m=debugNearestMech(160) || (spawnDebugMech('forge') && debugNearestMech(160));
	if(!m) return false;
	if(m.pilotAlive && !killDebugMechPilot()) return false;
	debugMoveHeroToMech(m);
	return toggleDebugMechBoard();
}
function driveDebugMech(dir){
	const m=(MECHS && MECHS.heroMech) ? MECHS.heroMech() : null;
	if(!m) return false;
	const beforeX=m.x;
	debugStepMechs(48,dir<0?{left:true}:{right:true});
	centerOnPlayer();
	markDebugMechChanged();
	return Math.abs(m.x-beforeX)>0.05;
}
function jumpDebugMech(){
	const m=(MECHS && MECHS.heroMech) ? MECHS.heroMech() : null;
	if(!m) return false;
	const beforeVy=Number(m.vy)||0;
	const beforeY=m.y;
	debugStepMechs(8,{jump:true});
	centerOnPlayer();
	markDebugMechChanged();
	return (Number(m.vy)||0)<Math.min(-0.2,beforeVy-0.2) || m.y<beforeY-0.05;
}
function setDebugMechEnergy(full){
	const m=debugNearestMech(160);
	if(!m) return false;
	const cfg=(MECHS && MECHS._debug && MECHS._debug.CFG) || {};
	m.maxEnergy=Math.max(1,Number(m.maxEnergy)|| (m.kind==='solar'?cfg.ENERGY_SOLAR_CAP:cfg.ENERGY_FORGE_CAP) || 75);
	m.energy=full ? m.maxEnergy : 0;
	m.noPowerT=full ? 0 : 0.8;
	return markDebugMechChanged();
}
function placeDebugMechPowerRig(){
	let m=debugNearestMech(180);
	if(!m){
		spawnDebugMech('forge');
		m=debugNearestMech(180);
	}
	if(!m) return false;
	const c=debugMechCenter(m);
	const dir=(m.facing||1)<0?-1:1;
	const baseX=Math.floor(c.x+dir*3);
	const baseY=Math.floor(c.y);
	let ok=false;
	if(m.kind==='solar'){
		const cells=[
			{x:baseX,y:baseY-1,t:T.SOLAR_BATTERY},
			{x:baseX-1,y:baseY-1,t:T.SOLAR_PANEL},
			{x:baseX+1,y:baseY-1,t:T.SOLAR_PANEL},
			{x:baseX,y:baseY,t:T.COPPER_WIRE}
		];
		ok=setDebugMechCells(cells);
		if(SOLAR && SOLAR._debug && SOLAR._debug.debugSetEnergyAt) SOLAR._debug.debugSetEnergyAt(baseX,baseY-1,120,getTile);
	} else {
		const cells=[
			{x:baseX-1,y:baseY,t:T.DYNAMO},
			{x:baseX,y:baseY,t:T.DYNAMO_SLOT},
			{x:baseX+1,y:baseY,t:T.DYNAMO},
			{x:baseX,y:baseY-1,t:T.STEAM}
		];
		ok=setDebugMechCells(cells);
		if(DYNAMO && DYNAMO.recordFlow){
			for(let i=0;i<18;i++) DYNAMO.recordFlow(baseX,baseY,'steam',4,getTile);
		}
	}
	if(ok && m.rider) debugStepMechs(90,{});
	return ok && markDebugMechChanged();
}
function damageDebugMech(){
	const m=debugNearestMech(180);
	if(!m || !MECHS || !MECHS.blastRadius) return false;
	const c=debugMechCenter(m);
	const hit=MECHS.blastRadius(c.x,c.y,4.5,24,{source:'hero',kind:'debug_damage'});
	debugStepMechs(4,{});
	markDebugMechChanged();
	return hit!==false;
}
function shieldDebugMech(){
	const m=(MECHS && MECHS.heroMech) ? MECHS.heroMech() : null;
	if(!m || !MECHS || !MECHS.absorbHeroDamage) return false;
	const beforeHp=m.hp;
	const res=MECHS.absorbHeroDamage(22,{cause:'debug_shield'},player);
	if(MECHS.syncRider) MECHS.syncRider(player);
	markDebugMechChanged();
	return !!(res && res.absorbed>0 && m.hp<beforeHp);
}
function elementalDebugMech(kind){
	const m=debugNearestMech(180);
	if(!m || !MECHS) return false;
	const c=debugMechCenter(m);
	let hit=0;
	if(kind==='fire' && MECHS.igniteRadius) hit=MECHS.igniteRadius(c.x,c.y,4.5,{source:'hero',kind:'debug_fire',dps:14});
	else if(kind==='water' && MECHS.douseRadius) hit=MECHS.douseRadius(c.x,c.y,4.5,{source:'hero',kind:'debug_water',dps:10});
	debugStepMechs(4,{});
	markDebugMechChanged();
	return hit>0;
}
function destroyDebugMech(){
	const m=debugNearestMech(180);
	if(!m || !MECHS || !MECHS.blastRadius) return false;
	const c=debugMechCenter(m);
	MECHS.blastRadius(c.x,c.y,9,999,{source:'hero',kind:'debug_destroy'});
	debugStepMechs(4,{});
	updateInventory();
	updateHotbarCounts();
	markDebugMechChanged();
	return !debugMechList().includes(m) || m.hp<=0;
}
function resetDebugMechs(){
	if(!MECHS || !MECHS.reset) return false;
	MECHS.reset({suppressSpawns:6});
	player.vx=0; player.vy=0;
	return markDebugMechChanged();
}
function saveLoadDebugMech(){
	if(!MECHS || !MECHS.snapshot || !MECHS.restore) return false;
	const before=debugMechList().length;
	const data=MECHS.snapshot();
	const ok=!!MECHS.restore(data,getTile);
	if(ok && MECHS.syncRider) MECHS.syncRider(player);
	const after=debugMechList().length;
	centerOnPlayer();
	markDebugMechChanged();
	return ok && before===after;
}
function forceHostileDebugMech(kind){
	let m=debugNearestMech(160);
	if(!m){
		spawnDebugMech(kind||'forge');
		m=debugNearestMech(200);
	}
	if(!m) return null;
	if(m.rider && MECHS && MECHS.toggleBoard) MECHS.toggleBoard(player,getTile);
	m.pilotAlive=true;
	m.pilotMaxHp=Math.max(1,Number(m.pilotMaxHp)||44);
	m.pilotHp=m.pilotMaxHp;
	m.rider=false;
	return m;
}
function setDebugMechCells(cells){
	if(!Array.isArray(cells) || !cells.length) return false;
	for(const cell of cells){
		if(!worldYInBounds(cell.y)) continue;
		ensureChunkAtY(Math.floor(cell.x/CHUNK_W),cell.y);
		const prev=getTile(cell.x,cell.y);
		if(prev===cell.t) continue;
		setTile(cell.x,cell.y,cell.t);
		if(FALLING && FALLING.afterPlacement && cell.t!==T.AIR) FALLING.afterPlacement(cell.x,cell.y);
		if(WATER && WATER.onTileChanged) WATER.onTileChanged(cell.x,cell.y,getTile);
	}
	noteSaveActivity();
	saveState();
	return true;
}
function placeDebugMechWall(){
	const m=forceHostileDebugMech('forge');
	if(!m) return false;
	const b=debugMechBounds(m);
	const dir=(m.facing||1)<0?-1:1;
	const x=Math.floor(dir>0 ? m.x+b.maxX+1 : m.x+b.minX-1);
	const y0=Math.floor(m.y+b.minY);
	const y1=Math.floor(m.y+b.maxY);
	const cells=[];
	for(let y=y0;y<=y1;y++) cells.push({x,y,t:T.STEEL});
	const ok=setDebugMechCells(cells);
	player.x=x+dir*5.2;
	player.y=Math.max(WORLD_MIN_Y+2,Math.min(WORLD_MAX_Y-2,m.y+b.maxY-1.3));
	player.vx=0; player.vy=0;
	m.facing=dir;
	centerOnPlayer();
	return ok;
}
function placeDebugMechTrees(){
	const m=forceHostileDebugMech('solar');
	if(!m) return false;
	const b=debugMechBounds(m);
	const dir=(m.facing||1)<0?-1:1;
	const trunkX=Math.floor(dir>0 ? m.x+b.maxX+3 : m.x+b.minX-3);
	const baseY=Math.floor(m.y+b.maxY);
	const cells=[];
	for(let y=baseY-5;y<=baseY-1;y++) cells.push({x:trunkX,y,t:T.WOOD});
	for(let dx=-2;dx<=2;dx++){
		for(let dy=-8;dy<=-5;dy++){
			if(Math.abs(dx)+Math.abs(dy+6)<=3) cells.push({x:trunkX+dx,y:baseY+dy,t:T.LEAF});
		}
	}
	m.facing=dir;
	player.x=trunkX+dir*5.5;
	player.y=baseY-1.2;
	player.vx=0; player.vy=0;
	centerOnPlayer();
	return setDebugMechCells(cells);
}
function placeDebugMechPit(){
	const m=forceHostileDebugMech('forge');
	if(!m) return false;
	const b=debugMechBounds(m);
	const dir=(m.facing||1)<0?-1:1;
	const floorY=Math.floor(m.y+b.maxY+1);
	const front=dir>0 ? Math.floor(m.x+b.maxX+1) : Math.floor(m.x+b.minX-1);
	const cells=[];
	for(let x=Math.floor(m.x+b.minX)-3;x<=Math.floor(m.x+b.maxX)+3;x++){
		cells.push({x,y:floorY,t:T.STONE});
		cells.push({x,y:floorY+1,t:T.STONE});
	}
	for(let i=0;i<5;i++){
		const x=front+dir*i;
		for(let y=floorY-4;y<=floorY+3;y++) cells.push({x,y,t:T.AIR});
	}
	const landing=front+dir*6;
	for(let i=0;i<5;i++){
		const x=landing+dir*i;
		cells.push({x,y:floorY,t:T.STONE});
		cells.push({x,y:floorY+1,t:T.STONE});
	}
	m.facing=dir;
	player.x=landing+dir*6+0.5;
	player.y=floorY-1.3;
	player.vx=0; player.vy=0;
	centerOnPlayer();
	return setDebugMechCells(cells);
}
function spawnDebugMechMob(){
	const m=forceHostileDebugMech('forge');
	if(!m || !MOBS || !MOBS.forceSpawn) return false;
	const c=debugMechCenter(m);
	const dir=(m.facing||1)<0?-1:1;
	const anchor={x:c.x+dir*2.2,y:c.y,w:0.7,h:0.95};
	for(const id of ['STONE_GOLEM','BEAR','WOLF','ALIEN']){
		try{
			if(MOBS.forceSpawn(id,anchor,getTile)){ noteSaveActivity(); saveState(); return true; }
		}catch(e){}
	}
	return false;
}
// Inject debug time-of-day slider (non-intrusive) at end of menu only once
if(MM.ui && MM.ui.injectTimeSlider) MM.ui.injectTimeSlider(menuPanel);
if(MM.ui && MM.ui.injectBackgroundDebugPanel) MM.ui.injectBackgroundDebugPanel(menuPanel);
if(MM.ui && MM.ui.injectHostilityDebugPanel) MM.ui.injectHostilityDebugPanel({
	set:(intensity,reach)=>{ if(!MM.worldHostility || !MM.worldHostility.setTuning) return null; return MM.worldHostility.setTuning({intensity,reach}); },
	get:()=> (MM.worldHostility && MM.worldHostility.getTuning) ? MM.worldHostility.getTuning() : null,
	sample:()=>{ try{ return (MM.worldHostility && MM.worldHostility.at && player && Number.isFinite(player.x)) ? MM.worldHostility.at(player.x) : null; }catch(e){ return null; } }
}, menuPanel);
if(MM.ui && MM.ui.injectTravelDebugPanel) MM.ui.injectTravelDebugPanel({
	move:(dx)=> debugShiftHero(dx),
	jump:(x,y)=> debugJumpHero(x, y),
	sky:(layer)=> debugJumpSky(layer),
	guardian:(kind)=> debugJumpGuardian(kind),
	underground:()=> debugJumpUndergroundBoss(),
	undergroundFight:()=> debugStartUndergroundFight(),
	skyGate:()=> debugJumpSkyGuardian(),
	skyFight:()=> debugStartSkyGuardianFight(),
	center:()=> debugJumpCenterGuardian(),
	centerFight:()=> debugStartCenterFight(),
	atlantis:(dir)=> debugJumpAtlantis(dir),
	aftermath:(kind)=> debugGuardianAftermath(kind),
	pos:()=> ({x:Math.round(player.x), y:Math.round(player.y)})
}, menuPanel);
if(MM.ui && MM.ui.injectMobSpawnPanel) MM.ui.injectMobSpawnPanel((id)=>{
	if(MOBS && MOBS.forceSpawn){ const ok=MOBS.forceSpawn(id, player, getTile); if(ok) msg('Spawn '+id); }
}, menuPanel, {
	biome:(id,dir)=> debugJumpBiome(id,dir),
	biomeThreat:(key,dir)=> debugJumpBiomeThreat(key,dir)
});
if(MM.ui && MM.ui.injectGasDebugPanel) MM.ui.injectGasDebugPanel({
	spawn:spawnDebugGas,
	ignite:igniteDebugGas,
	clear:clearDebugGases,
	metrics:()=> (GASES && GASES.metrics) ? GASES.metrics() : null
}, menuPanel);
if(MM.ui && MM.ui.injectInvasionDebugPanel) MM.ui.injectInvasionDebugPanel({
	alien:()=>{
		if(!INVASIONS || !INVASIONS.forceNightInvasion) return [];
		const spawned=INVASIONS.forceNightInvasion(player,getTile,setTile,{teams:1,kind:'aliens',forceVisible:true,immediate:true,ctx:{saveState,notifyStructureTileChanged}});
		if(spawned && spawned.length){ noteSaveActivity(); saveState(); }
		return spawned;
	},
	molekin:()=>{
		if(!INVASIONS || !INVASIONS.forceMolekinInvasion) return [];
		const spawned=INVASIONS.forceMolekinInvasion(player,getTile,setTile,{teams:1,forceVisible:true,immediate:true,ctx:{saveState,notifyStructureTileChanged}});
		if(spawned && spawned.length){ noteSaveActivity(); saveState(); }
		return spawned;
	},
	metrics:()=> (INVASIONS && INVASIONS.metrics) ? INVASIONS.metrics() : null
}, menuPanel);
if(MM.ui && MM.ui.injectWindDebugPanel) MM.ui.injectWindDebugPanel({
	calm:()=>{ if(!WIND || !WIND.setOverride) return false; WIND.setOverride(0); return true; },
	exact:(value)=>{ if(!WIND || !WIND.setOverride) return false; const v=Number(value); if(!Number.isFinite(v)) return false; WIND.setOverride(v); return true; },
	breeze:(dir)=>{ if(!WIND || !WIND.setOverride) return false; WIND.setOverride((dir<0?-1:1)*1.35); return true; },
	gale:(dir)=>{ if(!WIND || !WIND.setOverride) return false; WIND.setOverride((dir<0?-1:1)*6.4); return true; },
	natural:()=>{ if(!WIND || !WIND.setOverride) return false; WIND.setOverride(null); if(WIND.setWeatherProfile) WIND.setWeatherProfile(null); return true; },
	profile:(id)=>{ if(!WIND || !WIND.setWeatherProfile) return false; return !!WIND.setWeatherProfile(id); },
	squall:(dir)=>{ if(!WIND || !WIND.forceSquall) return false; return !!WIND.forceSquall(dir<0?-1:1,4.9,26); },
	storm:()=>{ let ok=false; try{ if(CLOUDS && CLOUDS.startStorm){ CLOUDS.startStorm(75,1); ok=true; } }catch(e){} try{ if(WIND && WIND.forceSquall) ok=!!WIND.forceSquall(player.facing<0?-1:1,5.7,32) || ok; }catch(e){} return ok; },
	metrics:()=> (WIND && WIND.metrics) ? WIND.metrics() : null
}, menuPanel);
if(MM.ui && MM.ui.injectSeasonDebugPanel) MM.ui.injectSeasonDebugPanel({
	force:(id)=>{ if(!SEASONS || !SEASONS.forceSeason) return false; const ok=!!SEASONS.forceSeason(id); if(ok) updateBiomeLabel(); return ok; },
	natural:()=>{ if(!SEASONS || !SEASONS.forceSeason) return false; const ok=!!SEASONS.forceSeason('natural'); if(ok) updateBiomeLabel(); return ok; },
	transition:()=>{ if(!SEASONS || !SEASONS.jumpToNextTransition) return false; const ok=!!SEASONS.jumpToNextTransition(); if(ok){ updateBiomeLabel(); noteSaveActivity(); saveState(); } return ok; },
	hallmark:()=>{ if(!MOBS || !MOBS.spawnSeasonalHallmark) return false; const ok=!!MOBS.spawnSeasonalHallmark(null,player,getTile); if(ok){ noteSaveActivity(); saveState(); } return ok; },
	event:(id)=>{ if(!SEASONS || !SEASONS.forceSeasonEvent) return false; const ok=!!SEASONS.forceSeasonEvent(id,{player}); if(ok){ noteSaveActivity(); saveState(); } return ok; },
	scan:()=>{ if(!SEASONS || !SEASONS.scanNow) return false; const m=SEASONS.scanNow(getTile,setTile,player); if(m && m.ops>0){ noteSaveActivity(); saveState(); } return !!m; },
	setEnabled:(enabled)=>{ if(!SEASONS || !SEASONS.setEnabled) return false; const ok=!!SEASONS.setEnabled(enabled); if(ok) updateBiomeLabel(); return ok; },
	advance:(days)=>{ if(!SEASONS || !SEASONS.advanceDays) return false; const ok=!!SEASONS.advanceDays(days); if(ok){ updateBiomeLabel(); noteSaveActivity(); saveState(); } return ok; },
	metrics:()=> seasonMetricsForCalendar()
}, menuPanel);
if(MM.ui && MM.ui.injectMeteorDebugPanel) MM.ui.injectMeteorDebugPanel({
	setEnabled:(enabled)=>{ if(!METEORITES || !METEORITES.setEnabled) return false; const ok=!!METEORITES.setEnabled(enabled); if(ok){ noteSaveActivity(); saveState(); } return ok; },
	spawn:()=>{ if(!METEORITES || !METEORITES.forceSpawn) return false; const ok=!!METEORITES.forceSpawn({nearHero:true,intensity:1.65},player,getTile); if(ok){ noteSaveActivity(); saveState(); } return ok; },
	spawnClass:(classId)=>{ if(!METEORITES || !METEORITES.forceSpawn) return false; const ok=!!METEORITES.forceSpawn({nearHero:true,intensity:1.65,classId},player,getTile); if(ok){ noteSaveActivity(); saveState(); } return ok; },
	beacon:()=> placeDebugAntigravityBeacon(),
	siren:()=> placeDebugMeteorSiren(),
	scan:()=> scanDebugMeteorCrater(),
	roll:()=>{ if(!METEORITES || !METEORITES.rollSchedule) return false; const ok=!!METEORITES.rollSchedule(); if(ok){ noteSaveActivity(); saveState(); } return ok; },
	clear:()=>{ if(!METEORITES || !METEORITES.clearActive) return false; METEORITES.clearActive(); return true; },
	metrics:()=> (METEORITES && METEORITES.metrics) ? METEORITES.metrics() : null
}, menuPanel);
if(MM.ui && MM.ui.injectDynamoDebugPanel) MM.ui.injectDynamoDebugPanel({
	give:giveDebugDynamo,
	place:placeDebugDynamo,
	pulse:pulseDebugDynamo,
	charge:chargeDebugDynamo,
	fillHero:fillDebugHeroEnergy,
	emptyHero:emptyDebugHeroEnergy,
	hero:()=> (MM.heroEnergy && MM.heroEnergy.info) ? MM.heroEnergy.info() : null,
	metrics:()=> (DYNAMO && DYNAMO.metrics) ? DYNAMO.metrics() : null
}, menuPanel);
if(MM.ui && MM.ui.injectSolarDebugPanel) MM.ui.injectSolarDebugPanel({
	placePanel:placeDebugSolarPanel,
	placeBattery:placeDebugSolarBattery,
	placeRig:placeDebugSolarRig,
	charge:chargeDebugSolar,
	empty:emptyDebugSolar,
	metrics:()=> (SOLAR && SOLAR.metrics) ? SOLAR.metrics() : null
}, menuPanel);
if(MM.ui && MM.ui.injectTeleporterDebugPanel) MM.ui.injectTeleporterDebugPanel({
	giveTeleporter:giveDebugTeleporter,
	giveCable:giveDebugCopperWire,
	placeOne:placeDebugTeleporterOne,
	placePair:placeDebugTeleporterPair,
	jumpLeft:jumpDebugTeleporterLeft,
	jumpRight:jumpDebugTeleporterRight,
	charge:chargeDebugTeleporter,
	empty:emptyDebugTeleporter,
	hero:()=> (MM.heroEnergy && MM.heroEnergy.info) ? MM.heroEnergy.info() : null,
	metrics:()=> (TELEPORTERS && TELEPORTERS.metrics) ? TELEPORTERS.metrics() : null
}, menuPanel);
if(MM.ui && MM.ui.injectPumpDebugPanel) MM.ui.injectPumpDebugPanel({
	give:giveDebugPumps,
	place:placeDebugPump,
	placeRig:placeDebugPumpRig,
	charge:chargeDebugPump,
	empty:emptyDebugPump,
	metrics:()=> (PUMPS && PUMPS.metrics) ? PUMPS.metrics() : null
}, menuPanel);
if(MM.ui && MM.ui.injectTurretDebugPanel) MM.ui.injectTurretDebugPanel({
	give:giveDebugTurrets,
	place:placeDebugTurret,
	placeFire:placeDebugFireTurret,
	placeWater:placeDebugWaterTurret,
	placeRig:placeDebugTurretRig,
	charge:chargeDebugTurret,
	empty:emptyDebugTurret,
	metrics:()=> (TURRETS && TURRETS.metrics) ? TURRETS.metrics() : null
}, menuPanel);
if(MM.ui && MM.ui.injectSpringPlatformDebugPanel) MM.ui.injectSpringPlatformDebugPanel({
	give:giveDebugSpringPlatforms,
	place:placeDebugSpringPlatform,
	placeRig:placeDebugSpringRig,
	charge:chargeDebugSpringPlatform,
	empty:emptyDebugSpringPlatform,
	metrics:()=> (SPRING_PLATFORMS && SPRING_PLATFORMS.metrics) ? SPRING_PLATFORMS.metrics() : null
}, menuPanel);
if(MM.ui && MM.ui.injectMechDebugPanel) MM.ui.injectMechDebugPanel({
	zoneLeft:()=>debugJumpMechZone(-1),
	zoneRight:()=>debugJumpMechZone(1),
	procLeft:()=>spawnDebugZoneMech(-1),
	procRight:()=>spawnDebugZoneMech(1),
	spawnSolar:()=>spawnDebugMech('solar'),
	spawnForge:()=>spawnDebugMech('forge'),
	spawnCrawler:()=>spawnDebugMech('forge_tracks'),
	killPilot:killDebugMechPilot,
	board:toggleDebugMechBoard,
	capture:captureDebugMech,
	driveLeft:()=>driveDebugMech(-1),
	driveRight:()=>driveDebugMech(1),
	jumpTest:jumpDebugMech,
	fillPower:()=>setDebugMechEnergy(true),
	emptyPower:()=>setDebugMechEnergy(false),
	powerRig:placeDebugMechPowerRig,
	shield:shieldDebugMech,
	damage:damageDebugMech,
	fireHit:()=>elementalDebugMech('fire'),
	waterHit:()=>elementalDebugMech('water'),
	destroy:destroyDebugMech,
	wall:placeDebugMechWall,
	trees:placeDebugMechTrees,
	pit:placeDebugMechPit,
	mob:spawnDebugMechMob,
	saveLoad:saveLoadDebugMech,
	reset:resetDebugMechs,
	metrics:debugMechMetrics
}, menuPanel);
if(MM.ui && MM.ui.injectNpcDebugPanel) MM.ui.injectNpcDebugPanel({
	jump:jumpDebugNpc,
	nearest:jumpDebugNearestNpc,
	metrics:debugNpcMetrics
}, menuPanel);
if(MM.ui && MM.ui.injectCompanionDebugPanel) MM.ui.injectCompanionDebugPanel({
	give:giveDebugCompanionIngredients,
	giveGolem:giveDebugGolemIngredients,
	giveLeaf:giveDebugLeafMonsterIngredients,
	giveWater:giveDebugWaterGolemIngredients,
	giveMeat:giveDebugMeatGolemIngredients,
	giveMolekin:giveDebugMolekinIngredients,
	spawn:spawnDebugCompanion,
	spawnGolem:spawnDebugGolem,
	spawnLeaf:spawnDebugLeafMonster,
	spawnWater:spawnDebugWaterGolem,
	spawnMeat:spawnDebugMeatGolem,
	spawnMolekin:spawnDebugMolekin,
	ritualGolem:placeDebugGolemRitual,
	ritualLeaf:placeDebugLeafRitual,
	ritualWater:placeDebugWaterRitual,
	ritualMeat:placeDebugMeatRitual,
	ritualMolekin:placeDebugMolekinRitual,
	feed:feedDebugCompanion,
	setBiomass:setDebugCompanionBiomass,
	setClay:setDebugGolemClay,
	setLeaves:setDebugLeafMonsterLeaves,
	setWater:setDebugWaterGolemMass,
	setMeat:setDebugMeatGolemMass,
	setLava:setDebugMolekinLava,
	rotMeat:rotDebugMeatGolem,
	cookMeat:cookDebugMeatGolem,
	heal:healDebugCompanion,
	damage:damageDebugCompanion,
	kill:killDebugCompanion,
	teleport:teleportDebugCompanion,
	gas:gasDebugCompanion,
	laser:laserDebugCompanion,
	waterSpray:waterSprayDebugCompanion,
	molekinFire:molekinFireDebugCompanion,
	guard:guardDebugGolem,
	shield:shieldDebugGolem,
	golemMelee:meleeDebugGolem,
	clear:clearDebugCompanions,
	metrics:()=> (COMPANIONS && COMPANIONS.metrics) ? COMPANIONS.metrics() : null,
	list:debugCompanionList
}, menuPanel);
// Regeneracja świata z nowym ziarnem
document.getElementById('regenBtn')?.addEventListener('click',()=>{ setSeedFromInput(); regenWorld(); if(MM.ui && MM.ui.closeMenu) MM.ui.closeMenu(); });
function regenWorld(){
	// Purge mobs and freeze spawns briefly
	if(MOBS && MOBS.clearAll) try{ MOBS.clearAll(); }catch(e){}
	if(COMPANIONS && COMPANIONS.reset) try{ COMPANIONS.reset(); }catch(e){}
	if(MOBS && MOBS.freezeSpawns) try{ MOBS.freezeSpawns(4000); }catch(e){}

	// Clear world data and caches
	WORLD.clear(); if(WORLD.clearHeights) WORLD.clearHeights();
	if(typeof chunkCanvases!=='undefined') chunkCanvases.clear();
	if(typeof chunkRenderDirty!=='undefined') chunkRenderDirty.clear();

	// Reset fog-of-war (seen tiles) and ensure full fog state
	try{ if(FOG && FOG.importSeen) FOG.importSeen([]); if(FOG && FOG.setRevealAll) FOG.setRevealAll(false); if(MM.ui && MM.ui.updateMapButton && FOG && FOG.getRevealAll) MM.ui.updateMapButton(FOG.getRevealAll()); }catch(e){}

	// Reset transient systems
	mining=false; if(FALLING && FALLING.reset) FALLING.reset(); if(BOATS && BOATS.reset) BOATS.reset(); if(MECHS && MECHS.reset) MECHS.reset(); if(TREES && TREES.reset) TREES.reset(); if(WATER && WATER.reset) WATER.reset(); if(GASES && GASES.reset) GASES.reset(); if(WIND && WIND.reset) WIND.reset(); if(SEASONS && SEASONS.reset) SEASONS.reset(); if(DYNAMO && DYNAMO.reset) DYNAMO.reset(); if(SOLAR && SOLAR.reset) SOLAR.reset(); if(TELEPORTERS && TELEPORTERS.reset) TELEPORTERS.reset(); if(PUMPS && PUMPS.reset) PUMPS.reset(); if(TURRETS && TURRETS.reset) TURRETS.reset(); if(SPRING_PLATFORMS && SPRING_PLATFORMS.reset) SPRING_PLATFORMS.reset(); if(VENDING && VENDING.reset) VENDING.reset(); if(CLOUDS && CLOUDS.reset) CLOUDS.reset(); if(BOSSES && BOSSES.reset) BOSSES.reset(); if(GUARDIANS && GUARDIANS.reset) GUARDIANS.reset(); if(UNDERGROUND && UNDERGROUND.reset) UNDERGROUND.reset(); if(SKY_GUARDIAN && SKY_GUARDIAN.reset) SKY_GUARDIAN.reset(); if(AFTERMATH && AFTERMATH.reset) AFTERMATH.reset(); if(NPCS && NPCS.reset) NPCS.reset(); if(GENERATED_NPCS && GENERATED_NPCS.reset) GENERATED_NPCS.reset(); if(COMPANIONS && COMPANIONS.reset) COMPANIONS.reset(); if(GRASS && GRASS.reset) GRASS.reset(); if(PARTICLES && PARTICLES.reset) PARTICLES.reset(); if(FIRE && FIRE.reset) FIRE.reset(); if(WEAPONS && WEAPONS.reset) WEAPONS.reset(); if(MEAT && MEAT.reset) MEAT.reset(); if(VOLCANO && VOLCANO.reset) VOLCANO.reset(); if(ATOMIC_WINTER && ATOMIC_WINTER.reset) ATOMIC_WINTER.reset(); if(TERRAIN_TRAPS && TERRAIN_TRAPS.reset) TERRAIN_TRAPS.reset(); if(UFO && UFO.reset) UFO.reset(); if(TASKS && TASKS.reset) TASKS.reset(); if(INVASIONS && INVASIONS.reset) INVASIONS.reset(); if(METEORITES && METEORITES.reset) METEORITES.reset(); if(PLANTS && PLANTS.reset) PLANTS.reset();

	// Reset inventory/tools/hotbar
	RESOURCE_KEYS.forEach(k=>{ inv[k]=0; }); inv.tools.stone=inv.tools.meteor=inv.tools.diamond=inv.tools.bedrock=false; inv.bedrockPickDurability=0; player.tool='basic'; hotbarIndex=0; // if god mode active, restore 100 stack after reset
	// Fresh world = fresh hero arc: XP, level, skill points and milestones restart
	player.xp=0; player.energy=0; if(PROGRESS && PROGRESS.reset) PROGRESS.reset(); applyProgressHp(); applyHeroEnergyCapacity(); clearRespawnTotems(); clearHealingShelters(); grave=null; saveGrave();
	// Ensure all animals are removed when creating a new world and prevent immediate respawn
	if(MOBS){ try{ if(MOBS.clearAll) MOBS.clearAll(); else if(MOBS.deserialize) MOBS.deserialize({v:3, list:[], aggro:{mode:'rel', m:{}}}); }catch(e){} }
	if(godMode){ if(!_preGodInventory){ _preGodInventory={}; RESOURCE_KEYS.forEach(k=>{ _preGodInventory[k]=0; }); } RESOURCE_KEYS.forEach(k=>{ inv[k]=100; }); }
	resetCraftingAvailability();
	updateInventory({noCraftNotify:true}); updateHotbarSel(); placePlayer(true); try{ if(TUTORIAL_NPC && TUTORIAL_NPC.placeNearWorldStart) TUTORIAL_NPC.placeNearWorldStart(getTile,WORLDGEN); }catch(e){} saveState(); msg('Nowy świat seed '+worldSeed); }
document.getElementById('centerBtn').addEventListener('click',()=>{ snapCameraToPlayer(); });
document.getElementById('helpBtn').addEventListener('click',()=>{ const h=document.getElementById('help'); const show=h.style.display!=='block'; h.style.display=show?'block':'none'; document.getElementById('helpBtn').setAttribute('aria-expanded', String(show)); });
const radarBtn=document.getElementById('radarBtn'); radarBtn.addEventListener('click',()=>{ radarFlash=performance.now()+1500; }); let radarFlash=0;
// Listen for UI-dispatched radar pulse from the menu
window.addEventListener('mm-radar-pulse',()=>{ radarFlash=performance.now()+1500; });
function msg(t){ if(MM.ui && MM.ui.msg) MM.ui.msg(t); else { el.msg.textContent=t; clearTimeout(msg._t); msg._t=setTimeout(()=>{ el.msg.textContent=''; },4000); } }
// Engine modules (mobs death, lightning electrocution) reach messages via window.msg
window.msg = msg;
window.forceVolcanoMasterStone = function(){ return !!(VOLCANO && VOLCANO.forceMasterEruption && VOLCANO.forceMasterEruption()); };
window.forceMeteor = function(classId){ return !!(METEORITES && METEORITES.forceSpawn && METEORITES.forceSpawn({nearHero:true,intensity:1.65,classId},player,getTile)); };
window.scanMeteorCrater = function(){ return METEORITES && METEORITES.scanNearestCrater ? METEORITES.scanNearestCrater(player,getTile) : null; };

// FPS
let frames=0,lastFps=performance.now(), currentFps=0; function updateFps(now){ frames++; if(now-lastFps>1000){ currentFps=frames; const budget = (GRASS && GRASS.getBudgetInfo)? GRASS.getBudgetInfo():''; el.fps.textContent=currentFps+' FPS'+ (budget? (' '+budget):''); frames=0; lastFps=now; }}
const framePerf={simMs:0,drawMs:0,frameMs:0,avgFrameMs:0,jitterMs:0,maxFrameMs:0,longFrames:0,samples:0};
function framePerfNow(){ return (typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now(); }
function recordFramePerf(frameMs,simMs,drawMs){
	framePerf.frameMs=Number.isFinite(frameMs) ? frameMs : 0;
	framePerf.simMs=Number.isFinite(simMs) ? simMs : 0;
	framePerf.drawMs=Number.isFinite(drawMs) ? drawMs : 0;
	if(framePerf.frameMs>0){
		const prevAvg=framePerf.avgFrameMs || framePerf.frameMs;
		framePerf.avgFrameMs=prevAvg*0.94 + framePerf.frameMs*0.06;
		framePerf.jitterMs=framePerf.jitterMs*0.92 + Math.abs(framePerf.frameMs-prevAvg)*0.08;
	}
	framePerf.maxFrameMs=Math.max(framePerf.maxFrameMs*0.995, framePerf.frameMs);
	framePerf.samples++;
	if(framePerf.frameMs>33) framePerf.longFrames++;
	try{
		window.__mmPerf={
			frameMs:+framePerf.frameMs.toFixed(2),
			simMs:+framePerf.simMs.toFixed(2),
			drawMs:+framePerf.drawMs.toFixed(2),
			avgFrameMs:+framePerf.avgFrameMs.toFixed(2),
			jitterMs:+framePerf.jitterMs.toFixed(2),
			maxFrameMs:+framePerf.maxFrameMs.toFixed(2),
			longFrames:framePerf.longFrames,
			samples:framePerf.samples,
			chunks:{rebuilt:chunkCacheRebuiltThisFrame,partial:chunkCachePartialRebuiltThisFrame,deferred:chunkCacheDeferredThisFrame,cache:chunkCanvases.size},
			trees:(TREES && TREES.metrics) ? TREES.metrics() : null,
			renderDetail:currentRenderDetail
		};
	}catch(e){}
}

// Spawn
function placePlayer(skipMsg,opts){
	opts=opts||{};
	const dest=nearestRespawnDestination();
	if(dest && dest.spot){
		const spot=dest.spot;
		ensureChunkAtY(Math.floor(spot.x/CHUNK_W),spot.y);
		player.x=spot.x; player.y=spot.y; player.vx=0; player.vy=0;
		if(opts.center===false){ revealAround(); ensureChunks(); initScarf(); }
		else centerOnPlayer();
		if(!skipMsg) msg(dest.kind==='totem' ? 'Odrodzono przy totemie' : 'Odrodzono w domu');
		return;
	}
	// Find dry land near the origin: skip oceans/lakes so the player never spawns on water
	const SEA=(WORLDGEN.settings && WORLDGEN.settings.seaLevel!==undefined)? WORLDGEN.settings.seaLevel : 62;
	let x=0;
	outer: for(let r=0; r<=4000; r+=4){
		for(const c of (r===0? [0] : [r,-r])){
			const b=WORLDGEN.biomeType(c); const s=WORLDGEN.surfaceHeight(c);
			if(b!==5 && b!==6 && s<SEA-1){ x=c; break outer; }
		}
	}
	ensureChunk(Math.floor(x/CHUNK_W));
	let y=0; while(y<WORLD_H-1){ const tt=getTile(x,y); if(!isHeroPassableTile(tt)) break; y++; }
	player.x=x+0.5; player.y=y-1; try{ if(TUTORIAL_NPC && TUTORIAL_NPC.hasPosition && !TUTORIAL_NPC.hasPosition() && TUTORIAL_NPC.placeNearWorldStart) TUTORIAL_NPC.placeNearWorldStart(getTile,WORLDGEN); }catch(e){}
	if(opts.center===false){ revealAround(); ensureChunks(); initScarf(); }
	else centerOnPlayer();
	if(!skipMsg) msg('Seed '+worldSeed); }
window.placePlayer = placePlayer; // mobs.js respawn-on-death relies on this bridge
function centerOnPlayer(){ revealAround(); snapCameraToPlayer(); initScarf(); resetFrameTiming('center'); }
function teleportHeroTo(x,y,opts){
	opts=opts||{};
	if(typeof x!=='number'||!isFinite(x)||typeof y!=='number'||!isFinite(y)) return false;
	ensureChunkAtY(Math.floor(x/CHUNK_W),y);
	player.x=x; player.y=y; player.vx=0; player.vy=0;
	if(opts.center!==false) centerOnPlayer(); else ensureChunks();
	if(opts.message) msg(opts.message);
	try{ if(MOBS && MOBS.freezeSpawns) MOBS.freezeSpawns(1500); }catch(e){}
	return true;
}
window.teleportHeroTo = teleportHeroTo;
// Debug travel helpers: hop a fixed number of columns, or jump to an absolute
// coordinate. Both drop the hero onto the surface at the target column unless an
// explicit Y is given. Returns the resulting {x,y} (or false) so the UI can sync.
function debugJumpHero(x, y){
	if(typeof x!=='number' || !isFinite(x)) return false;
	x=Math.max(-5000000, Math.min(5000000, Math.round(x)));
	ensureChunk(Math.floor(x/CHUNK_W));
	let ty;
	if(typeof y==='number' && isFinite(y)) ty=Math.round(y);
	else { try{ ty=Math.floor(WORLDGEN.surfaceHeight(x))-1; }catch(e){ ty=Math.round(player.y); } }
	if(!isFinite(ty)) ty=Math.round(player.y);
	const ok=teleportHeroTo(x+0.5, ty, {message:'Teleport → x='+x+', y='+ty});
	if(!ok) return false;
	revealDebugTravelArea();
	noteSaveActivity(); saveState();
	return {x:Math.round(player.x), y:Math.round(player.y)};
}
function debugShiftHero(dx){
	if(typeof dx!=='number' || !isFinite(dx)) return false;
	return debugJumpHero(Math.round(player.x)+Math.round(dx));
}
function safeLandingFloor(t){
	return isSafeLandingFloorTile(t);
}
function skyLandingSpot(layer){
	const sy=layer==='high' ? -2 : -1;
	const y0=worldSectionOriginY(sy), y1=y0+worldSectionHeight()-1;
	const origin=Math.round(player.x);
	const tries=[0];
	for(let d=8; d<=1800; d+=8){ tries.push(d,-d); }
	for(const dx of tries){
		const tx=origin+dx;
		const cx=Math.floor(tx/CHUNK_W);
		if(WORLD && WORLD.ensureSection) WORLD.ensureSection(cx,sy); else ensureChunk(cx);
		for(let fy=y0+2; fy<=y1; fy++){
			const floor=getTile(tx,fy), body=getTile(tx,fy-1), head=getTile(tx,fy-2);
			if(!safeLandingFloor(floor)) continue;
			if(!bodySpaceOpen(body,false) || !bodySpaceOpen(head,false)) continue;
			return {x:tx+0.5,y:fy-1,tileX:tx,surface:fy,sy};
		}
	}
	return null;
}
function debugJumpSky(layer){
	const spot=skyLandingSpot(layer);
	if(!spot){ msg('Sky layer: brak wyspy w poblizu'); return false; }
	const label=spot.sy<=-2 ? 'High sky island' : 'Low sky island';
	const ok=teleportHeroTo(spot.x, spot.y, {message:label+' @ x='+Math.round(spot.tileX)+', y='+Math.round(spot.surface), center:true});
	if(!ok) return false;
	revealDebugTravelArea();
	noteSaveActivity(); saveState();
	return {x:Math.round(player.x), y:Math.round(player.y), kind:'sky', layer:spot.sy<=-2?'high':'low'};
}
window.teleportHeroToSkyLayer = function(layer){ return debugJumpSky(layer); };
function safeVolcanoLandingAt(tx){
	if(typeof tx!=='number' || !isFinite(tx)) return null;
	tx=Math.round(tx);
	ensureChunk(Math.floor(tx/CHUNK_W));
	const surface = WORLDGEN.surfaceHeight(tx);
	if(surface<3 || surface>=WORLD_H-2) return null;
	const floor=getTile(tx,surface);
	const body=getTile(tx,surface-1);
	const head=getTile(tx,surface-2);
	const bodyOk = body!==T.WATER && body!==T.LAVA && (isHeroPassableTile(body) || isLeaf(body) || body===T.TORCH || body===T.GRAVE);
	const headOk = head!==T.WATER && head!==T.LAVA && (isHeroPassableTile(head) || isLeaf(head) || head===T.TORCH || head===T.GRAVE);
	if(!safeLandingFloor(floor) || !bodyOk || !headOk) return null;
	return {x:tx+0.5, y:surface-1, tileX:tx, surface};
}
function bodySpaceOpen(t,allowWater){
	if(t===T.LAVA) return false;
	if(!allowWater && (t===T.WATER || t===T.ICE)) return false;
	return isHeroPassableTile(t) || isLeaf(t) || t===T.TORCH || t===T.GRAVE || (allowWater && t===T.WATER);
}
function safeBiomeLandingAt(tx,biomeId){
	if(typeof tx!=='number' || !isFinite(tx)) return null;
	tx=Math.round(tx);
	ensureChunk(Math.floor(tx/CHUNK_W));
	const waterBiome=biomeId===5 || biomeId===6;
	if(waterBiome){
		for(let y=2; y<WORLD_H-3; y++){
			const here=getTile(tx,y);
			if(here===T.ICE){
				if(bodySpaceOpen(getTile(tx,y-1),false) && bodySpaceOpen(getTile(tx,y-2),false)) return {x:tx+0.5,y:y-1,tileX:tx,surface:y,water:true};
			}
			if(here===T.WATER && bodySpaceOpen(getTile(tx,y-1),true) && bodySpaceOpen(getTile(tx,y-2),true)) return {x:tx+0.5,y:y-0.8,tileX:tx,surface:y,water:true};
		}
	}
	const surface=Math.round(WORLDGEN && WORLDGEN.surfaceHeight ? WORLDGEN.surfaceHeight(tx) : 2);
	const tryLandAt=(y)=>{
		if(y<2 || y>=WORLD_H-2) return null;
		const floor=getTile(tx,y), body=getTile(tx,y-1), head=getTile(tx,y-2);
		if(!safeLandingFloor(floor)) return null;
		if(!bodySpaceOpen(body,false) || !bodySpaceOpen(head,false)) return null;
		return {x:tx+0.5, y:y-1, tileX:tx, surface:y, water:false};
	};
	const nearTop=Math.max(2,surface-8);
	const nearBottom=Math.min(WORLD_H-2,surface+18);
	for(let y=nearTop; y<=nearBottom; y++){
		const spot=tryLandAt(y);
		if(spot) return spot;
	}
	for(let y=2; y<WORLD_H-2; y++){
		if(y>=nearTop && y<=nearBottom) continue;
		const spot=tryLandAt(y);
		if(spot) return spot;
	}
	return null;
}
function guardianLandingSpot(kind){
	if(!GUARDIANS || !GUARDIANS.layoutFor) return null;
	const L=GUARDIANS.layoutFor(kind);
	if(!L || typeof L.ax!=='number' || typeof L.floorY!=='number') return null;
	const offsets=[0,-4,4,-8,8,-12,12,-18,18,-26,26,-34,34,-42,42];
	const floorYs=[L.floorY-2,L.floorY-1,L.floorY,L.floorY+1,L.floorY-3,L.floorY+2];
	for(const off of offsets){
		const tx=Math.round(L.ax+off);
		ensureChunk(Math.floor(tx/CHUNK_W));
		for(const fy of floorYs){
			if(fy<3 || fy>=WORLD_H-2) continue;
			const floor=getTile(tx,fy), body=getTile(tx,fy-1), head=getTile(tx,fy-2);
			if(!safeLandingFloor(floor)) continue;
			if(!bodySpaceOpen(body,false) || !bodySpaceOpen(head,false)) continue;
			return {x:tx+0.5,y:fy-1,tileX:tx,surface:fy,layout:L};
		}
	}
	return {x:L.ax+0.5,y:L.floorY-4,tileX:Math.round(L.ax),surface:L.floorY-3,layout:L,fallback:true};
}
function debugJumpGuardian(kind){
	kind = kind==='ice' ? 'ice' : 'fire';
	const spot=guardianLandingSpot(kind);
	if(!spot){ msg('Guardian: brak danych lair'); return false; }
	const name=kind==='fire' ? 'Fire Guardian' : 'Ice Guardian';
	const ok=teleportHeroTo(spot.x, spot.y, {message:name+' lair @ x='+Math.round(spot.tileX)+' (threshold 10000)', center:true});
	if(!ok) return false;
	revealDebugTravelArea();
	noteSaveActivity(); saveState();
	return {x:Math.round(player.x), y:Math.round(player.y), kind, fallback:!!spot.fallback};
}
window.teleportHeroToGuardian = function(kind){ return debugJumpGuardian(kind); };
function undergroundLandingSpot(){
	if(!UNDERGROUND || !UNDERGROUND.layoutFor) return null;
	try{ if(GUARDIANS && GUARDIANS.enableUndergroundGate) GUARDIANS.enableUndergroundGate(getTile,setTile,{force:true}); }catch(e){}
	const L=UNDERGROUND.layoutFor();
	if(!L) return null;
	const minCx=Math.floor((L.minX-4)/CHUNK_W), maxCx=Math.floor((L.maxX+4)/CHUNK_W);
	for(let cx=minCx; cx<=maxCx; cx++) ensureChunkAtY(cx,L.floorY);
	try{ if(UNDERGROUND.materializeArena) UNDERGROUND.materializeArena(getTile,setTile); }catch(e){}
	return UNDERGROUND.landingSpot ? UNDERGROUND.landingSpot(getTile) : {x:L.ax+0.5,y:L.floorY-3,tileX:Math.round(L.ax),surface:L.floorY,layout:L,fallback:true};
}
function debugJumpUndergroundBoss(){
	const spot=undergroundLandingSpot();
	if(!spot){ msg('Underground boss: brak danych areny'); return false; }
	const ok=teleportHeroTo(spot.x, spot.y, {message:'Underground gate @ x='+Math.round(spot.tileX), center:true});
	if(!ok) return false;
	revealDebugTravelArea();
	noteSaveActivity(); saveState();
	return {x:Math.round(player.x), y:Math.round(player.y), kind:'underground', fallback:!!spot.fallback};
}
window.teleportHeroToUndergroundBoss = function(){ return debugJumpUndergroundBoss(); };
function debugStartUndergroundFight(){
	const jumped=debugJumpUndergroundBoss();
	if(jumped===false) return false;
	let started=false;
	try{ if(UNDERGROUND && UNDERGROUND.forceAwaken) started=!!UNDERGROUND.forceAwaken(getTile,setTile); }catch(e){ started=false; }
	if(!started){ msg('Underground boss: nie udało się wymusić startu walki'); return false; }
	msg('Underground boss fight started.');
	noteSaveActivity(); saveState();
	return {x:Math.round(player.x), y:Math.round(player.y), kind:'underground', started:true, fallback:!!jumped.fallback};
}
window.startUndergroundBossFight = function(){ return debugStartUndergroundFight(); };
function skyGuardianLandingSpot(){
	if(!SKY_GUARDIAN || !SKY_GUARDIAN.layoutFor) return null;
	const L=SKY_GUARDIAN.layoutFor();
	if(!L) return null;
	const minCx=Math.floor((L.minX-4)/CHUNK_W), maxCx=Math.floor((L.maxX+4)/CHUNK_W);
	for(let cx=minCx; cx<=maxCx; cx++) ensureChunkAtY(cx,L.floorY);
	try{ if(SKY_GUARDIAN.materializeArena) SKY_GUARDIAN.materializeArena(getTile,setTile); }catch(e){}
	return SKY_GUARDIAN.landingSpot ? SKY_GUARDIAN.landingSpot(getTile) : {x:L.ax+0.5,y:L.floorY-1,tileX:Math.round(L.ax),surface:L.floorY,layout:L,fallback:true};
}
function debugJumpSkyGuardian(){
	const spot=skyGuardianLandingSpot();
	if(!spot){ msg('Sky Guardian: brak danych areny'); return false; }
	const ok=teleportHeroTo(spot.x, spot.y, {message:'Sky Gate @ x='+Math.round(spot.tileX)+', y='+Math.round(spot.surface), center:true});
	if(!ok) return false;
	revealDebugTravelArea();
	noteSaveActivity(); saveState();
	return {x:Math.round(player.x), y:Math.round(player.y), kind:'skyGuardian', fallback:!!spot.fallback};
}
window.teleportHeroToSkyGuardian = function(){ return debugJumpSkyGuardian(); };
function debugStartSkyGuardianFight(){
	const jumped=debugJumpSkyGuardian();
	if(jumped===false) return false;
	let started=false;
	try{ if(SKY_GUARDIAN && SKY_GUARDIAN.forceAwaken) started=!!SKY_GUARDIAN.forceAwaken(getTile,setTile); }catch(e){ started=false; }
	if(!started){ msg('Sky Guardian: nie udalo sie wymusic startu walki'); return false; }
	msg('Sky Guardian fight started.');
	noteSaveActivity(); saveState();
	return {x:Math.round(player.x), y:Math.round(player.y), kind:'skyGuardian', started:true, fallback:!!jumped.fallback};
}
window.startSkyGuardianFight = function(){ return debugStartSkyGuardianFight(); };
function debugJumpCenterGuardian(){
	if(!CENTER_GUARDIAN || !CENTER_GUARDIAN.layoutFor){ msg('Center: brak modulu'); return false; }
	const L=CENTER_GUARDIAN.layoutFor();
	const minCx=Math.floor((L.minX-4)/CHUNK_W), maxCx=Math.floor((L.maxX+4)/CHUNK_W);
	for(let cx=minCx; cx<=maxCx; cx++) ensureChunkAtY(cx,L.floorY);
	try{ if(CENTER_GUARDIAN.forceCall) CENTER_GUARDIAN.forceCall(getTile,setTile); }catch(e){}
	const spot=CENTER_GUARDIAN.landingSpot ? CENTER_GUARDIAN.landingSpot(getTile) : {x:L.ax+0.5,y:L.floorY-1,tileX:Math.round(L.ax),surface:L.floorY,fallback:true};
	const ok=teleportHeroTo(spot.x, spot.y, {message:'Obelisk @ x='+Math.round(spot.tileX)+', y='+Math.round(spot.surface), center:true});
	if(!ok) return false;
	revealDebugTravelArea();
	noteSaveActivity(); saveState();
	return {x:Math.round(player.x), y:Math.round(player.y), kind:'centerGuardian', fallback:!!spot.fallback};
}
window.teleportHeroToCenterGuardian = function(){ return debugJumpCenterGuardian(); };
function debugStartCenterFight(){
	const jumped=debugJumpCenterGuardian();
	if(jumped===false) return false;
	let started=false;
	try{ if(CENTER_GUARDIAN && CENTER_GUARDIAN.forceBattle) started=!!CENTER_GUARDIAN.forceBattle(getTile,setTile); }catch(e){ started=false; }
	if(!started){ msg('Center: nie udalo sie wymusic walki z lustrem'); return false; }
	msg('Mirror fight started.');
	noteSaveActivity(); saveState();
	return {x:Math.round(player.x), y:Math.round(player.y), kind:'centerGuardian', started:true};
}
window.startCenterGuardianFight = function(){ return debugStartCenterFight(); };
function debugGuardianAftermath(kind){
	if(!AFTERMATH || !AFTERMATH.start) return false;
	if(kind==='clear'){
		try{ if(AFTERMATH.reset) AFTERMATH.reset(); }catch(e){ return false; }
		msg('Guardian aftermath cleared.');
		noteSaveActivity(); saveState();
		return {x:Math.round(player.x), y:Math.round(player.y), kind:'clear'};
	}
	if(kind==='scars'){
		if(!AFTERMATH._debug || !AFTERMATH._debug().applyAmbientChunk) return false;
		const st=AFTERMATH.status ? AFTERMATH.status() : null;
		if(!st || !st.active){ msg('Start guardian aftermath first.'); return false; }
		let changed=0;
		const cx=Math.floor(player.x/CHUNK_W);
		const dbg=AFTERMATH._debug();
		for(let dx=-3; dx<=3; dx++){
			try{ if(dbg.applyAmbientChunk(cx+dx, player, getTile, setTile, {force:true})) changed++; }catch(e){}
		}
		if(!changed){ msg('Guardian aftermath scars: no eligible terrain nearby.'); return false; }
		msg('Guardian aftermath scars applied: '+changed+' chunks.');
		noteSaveActivity(); saveState();
		return {x:Math.round(player.x), y:Math.round(player.y), kind:'scars', chunks:changed};
	}
	const id = kind==='fire' || kind==='ice' || kind==='earth' ? kind : null;
	if(!id) return false;
	let ok=false;
	try{ ok=!!AFTERMATH.start(id,{immediate:true}); }catch(e){ ok=false; }
	if(!ok) return false;
	msg('Guardian aftermath: '+id+'.');
	noteSaveActivity(); saveState();
	return {x:Math.round(player.x), y:Math.round(player.y), kind:id};
}
window.startGuardianAftermath = function(kind){ return debugGuardianAftermath(kind); };
window.clearGuardianAftermath = function(){ return debugGuardianAftermath('clear'); };
window.applyGuardianAftermathScars = function(){ return debugGuardianAftermath('scars'); };
function biomeLandingSpot(hit,biomeId){
	if(!hit) return null;
	const fallback=Math.round(hit.center!=null ? hit.center : hit.x);
	const left=Math.round(hit.left!=null ? hit.left : fallback-48);
	const right=Math.round(hit.right!=null ? hit.right : fallback+48);
	const rawAnchor=Math.round(biomeId===8 && hit.center!=null ? hit.center : (hit.nearest!=null ? hit.nearest : (hit.entry!=null ? hit.entry : fallback)));
	const anchor=Math.max(left,Math.min(right,rawAnchor));
	const offsets=[];
	const maxOff=Math.max(Math.abs(anchor-left), Math.abs(right-anchor));
	for(let d=0; d<=maxOff; d++){
		if(anchor-d>=left) offsets.push(-d);
		if(d && anchor+d<=right) offsets.push(d);
	}
	for(const off of offsets){
		const tx=anchor+off;
		if(WORLDGEN.biomeType(tx)!==biomeId) continue;
		const spot=safeBiomeLandingAt(tx,biomeId);
		if(spot) return spot;
	}
	return safeBiomeLandingAt(anchor,biomeId);
}
function atlantisSignatureTile(t){
	return t===T.GLASS || t===T.OBSIDIAN || t===T.STEEL || t===T.TRACK || t===T.SOLAR_BATTERY ||
		t===T.ANTIGRAVITY_BEACON || t===T.IRIDIUM || t===T.METEORIC_IRON ||
		t===T.ANTIMATTER_CRYSTAL || t===T.CHEST_RARE || t===T.CHEST_EPIC ||
		t===T.STEEL_DOOR || t===T.GLOWSHROOM;
}
function atlantisSignatureNear(tx,ty){
	for(let dx=-4; dx<=4; dx++){
		for(let dy=-4; dy<=4; dy++){
			if(atlantisSignatureTile(getTile(tx+dx,ty+dy))) return true;
			if(getConstructionBackgroundTile(tx+dx,ty+dy)!==T.AIR) return true;
		}
	}
	return false;
}
function atlantisLandingSpot(site){
	if(!site || !Number.isFinite(site.center)) return null;
	const left=Math.round(Number.isFinite(site.left) ? site.left : site.center-(site.radius||60));
	const right=Math.round(Number.isFinite(site.right) ? site.right : site.center+(site.radius||60));
	const center=Math.round(site.entry!=null ? site.entry : site.center);
	const floorRef=Number.isFinite(site.baseFloor) ? site.baseFloor : ((WORLDGEN && WORLDGEN.surfaceHeight) ? WORLDGEN.surfaceHeight(center) : WORLD_H-8);
	const minCx=Math.floor((left-8)/CHUNK_W);
	const maxCx=Math.floor((right+8)/CHUNK_W);
	for(let cx=minCx; cx<=maxCx; cx++) ensureChunkAtY(cx,floorRef);
	const offsets=[];
	const radius=Math.max(Math.abs(center-left),Math.abs(right-center));
	for(let d=0; d<=radius; d++){
		if(center-d>=left) offsets.push(-d);
		if(d && center+d<=right) offsets.push(d);
	}
	const sea=(site.sea!=null ? site.sea : ((WORLDGEN && WORLDGEN.settings && WORLDGEN.settings.seaLevel) || 62));
	const topY=Math.max(3,Math.floor(sea)+2);
	const bottomY=Math.min(WORLD_H-2,Math.ceil(floorRef)+4);
	for(let fy=topY+2; fy<=bottomY; fy++){
		for(const off of offsets){
			const tx=center+off;
			const floor=getTile(tx,fy);
			const body=getTile(tx,fy-1);
			const head=getTile(tx,fy-2);
			if(!safeLandingFloor(floor)) continue;
			if(!bodySpaceOpen(body,true) || !bodySpaceOpen(head,true)) continue;
			if(!atlantisSignatureNear(tx,fy)) continue;
			return {x:tx+0.5,y:fy-1,tileX:tx,surface:fy,site};
		}
	}
	for(let y=Math.min(bottomY-2,Math.floor(floorRef)-4); y>=topY; y--){
		for(const off of offsets){
			const tx=center+off;
			if(!bodySpaceOpen(getTile(tx,y),true) || !bodySpaceOpen(getTile(tx,y-1),true)) continue;
			if(!atlantisSignatureNear(tx,y)) continue;
			return {x:tx+0.5,y,tileX:tx,surface:y+1,site,fallback:true};
		}
	}
	return null;
}
function volcanoLandingSpot(v,dir){
	if(!v || typeof v.center!=='number') return null;
	const nearSide = dir>=0 ? -1 : 1;
	const preferred = nearSide * Math.min(Math.max(4,(v.crater||2)+5), Math.max(4,(v.radius||18)-2));
	const offsets=[];
	const radius=Math.max(12,(v.radius||18)+5);
	for(let dx=-radius; dx<=radius; dx++) offsets.push(dx);
	offsets.sort((a,b)=>{
		const da=Math.abs(a-preferred), db=Math.abs(b-preferred);
		return da-db || Math.abs(a)-Math.abs(b);
	});
	for(const dx of offsets){
		const spot=safeVolcanoLandingAt(v.center+dx);
		if(spot) return spot;
	}
	return safeVolcanoLandingAt(v.center + nearSide*(radius+2));
}
function debugJumpAtlantis(dir){
	dir = dir<0 ? -1 : (dir>0 ? 1 : 0);
	if(!WORLD || !WORLD.nearestAtlantis){ msg('Brak wyszukiwarki Atlantis'); return false; }
	const originX=player.x;
	const site=WORLD.nearestAtlantis(originX,dir,120000);
	if(!site){ msg('Nie znaleziono Atlantis w tym kierunku'); return false; }
	const spot=atlantisLandingSpot(site);
	if(!spot){ msg('Atlantis znalezione, ale brak miejsca teleportu'); return false; }
	const ok=teleportHeroTo(spot.x, spot.y, {message:'Atlantis @ x='+Math.round(site.center)+' (dystans '+Math.round(Math.abs(site.center-originX))+' blokow)', center:true});
	if(!ok) return false;
	revealDebugTravelArea();
	noteSaveActivity(); saveState();
	return {x:Math.round(player.x), y:Math.round(player.y), kind:'atlantis', site, fallback:!!spot.fallback};
}
window.teleportHeroToNearestAtlantis = function(dir){ return debugJumpAtlantis(dir); };
window.teleportHeroToNextVolcano = function(dir){
	dir = dir<0 ? -1 : 1;
	const WGl=WORLDGEN || (MM && MM.worldGen);
	if(!WGl || !WGl.nearestVolcano){ msg('Brak wyszukiwarki wulkanow'); return null; }
	const originX=player.x;
	let searchX=originX;
	const current=(WGl.volcanoAt)? WGl.volcanoAt(Math.round(originX)) : null;
	if(current) searchX=current.center + dir*((current.radius||18)+2);
	const v=WGl.nearestVolcano(searchX, dir);
	if(!v){ msg('Nie znaleziono wulkanu w tym kierunku'); return null; }
	const spot=volcanoLandingSpot(v,dir);
	if(!spot){ msg('Wulkan znaleziony, ale brak bezpiecznego miejsca ladowania'); return null; }
	const ok=teleportHeroTo(spot.x, spot.y, {message:'Wulkan @ x='+v.center+' (dystans '+Math.round(Math.abs(v.center-originX))+' blokow)', center:true});
	return ok ? {volcano:v, spot} : null;
};
function jumpBiomeCore(biomeId,dir){
	biomeId=biomeId|0;
	dir = dir<0 ? -1 : (dir>0 ? 1 : 0);
	if(!WORLDGEN || !WORLDGEN.nearestBiome){ msg('Brak wyszukiwarki biomow'); return null; }
	if(biomeId<0 || biomeId>=BIOME_NAMES.length){ msg('Nieznany biom: '+biomeId); return null; }
	const originX=player.x;
	const hit=WORLDGEN.nearestBiome(originX,biomeId,dir,60000);
	if(!hit){ msg('Nie znaleziono biomu: '+(BIOME_NAMES[biomeId]||biomeId)); return null; }
	const spot=biomeLandingSpot(hit,biomeId);
	if(!spot){ msg('Biom znaleziony, ale brak bezpiecznego miejsca ladowania'); return null; }
	const name=BIOME_NAMES[biomeId]||('Biom '+biomeId);
	const msgX=Math.round(spot.tileX!=null ? spot.tileX : (hit.nearest!=null ? hit.nearest : hit.center));
	const ok=teleportHeroTo(spot.x, spot.y, {message:name+' @ x='+msgX+' (dystans '+Math.round(Math.abs(msgX-originX))+' blokow)', center:true});
	return ok ? {biome:hit, spot} : null;
}
function debugTravelResult(kind,data){
	revealDebugTravelArea();
	updateBiomeLabel();
	noteSaveActivity(); saveState();
	return Object.assign({x:Math.round(player.x), y:Math.round(player.y), kind}, data||{});
}
function debugJumpBiome(biomeId,dir){
	const res=jumpBiomeCore(biomeId,dir);
	if(!res) return null;
	return debugTravelResult('biome',{biomeId:biomeId|0, biome:res.biome, spot:res.spot, dir:dir<0?-1:(dir>0?1:0)});
}
function surfaceTempleMatchesBiome(L,biomeId){
	if(!L || !WORLDGEN || typeof WORLDGEN.biomeType!=='function') return false;
	const b=WORLDGEN.biomeType(Math.round(L.ax));
	return b===(biomeId|0);
}
function nearestSurfaceTempleLayout(biomeId,dir,maxRange){
	if(!WORLD || typeof WORLD.surfaceTempleLayoutsInRange!=='function') return null;
	const originX=player.x;
	const range=Math.max(1000,Math.min(160000,Number(maxRange)||90000));
	const layouts=WORLD.surfaceTempleLayoutsInRange(originX-range,originX+range)
		.filter(L=>surfaceTempleMatchesBiome(L,biomeId));
	let best=null, bestD=Infinity;
	for(const L of layouts){
		const cx=Number(L.ax);
		if(!Number.isFinite(cx)) continue;
		if(dir<0 && cx>=originX-3) continue;
		if(dir>0 && cx<=originX+3) continue;
		const d=dir<0 ? originX-cx : (dir>0 ? cx-originX : Math.abs(cx-originX));
		if(d<bestD){ best=L; bestD=d; }
	}
	return best;
}
function surfaceTempleLandingSpot(L){
	if(!L || !Number.isFinite(L.ax) || !Number.isFinite(L.floor)) return null;
	const minCx=Math.floor((L.minX-4)/CHUNK_W);
	const maxCx=Math.floor((L.maxX+4)/CHUNK_W);
	for(let cx=minCx; cx<=maxCx; cx++) ensureChunk(cx);
	const center=Math.round(L.ax);
	const minX=Math.round(Number.isFinite(L.minX)?L.minX:center-16)-4;
	const maxX=Math.round(Number.isFinite(L.maxX)?L.maxX:center+16)+4;
	const offsets=[];
	const radius=Math.max(Math.abs(center-minX),Math.abs(maxX-center));
	for(let d=0; d<=radius; d++){
		if(center-d>=minX) offsets.push(-d);
		if(d && center+d<=maxX) offsets.push(d);
	}
	const floor=Math.round(L.floor);
	const floorYs=[floor-1,floor,floor+1,floor-2,floor+2,floor-3,floor+3];
	for(const off of offsets){
		const tx=center+off;
		for(const fy of floorYs){
			if(fy<3 || fy>=WORLD_H-2) continue;
			if(!safeLandingFloor(getTile(tx,fy))) continue;
			if(!bodySpaceOpen(getTile(tx,fy-1),false) || !bodySpaceOpen(getTile(tx,fy-2),false)) continue;
			return {x:tx+0.5,y:fy-1,tileX:tx,surface:fy,layout:L};
		}
	}
	return {x:center+0.5,y:floor-3,tileX:center,surface:floor-2,layout:L,fallback:true};
}
function debugJumpSurfaceTemple(biomeId,dir){
	dir = dir<0 ? -1 : (dir>0 ? 1 : 0);
	const L=nearestSurfaceTempleLayout(biomeId,dir,120000);
	if(!L){ msg('Nie znaleziono naziemnej swiatyni w tym kierunku'); return null; }
	const spot=surfaceTempleLandingSpot(L);
	if(!spot){ msg('Swiatynia znaleziona, ale brak miejsca teleportu'); return null; }
	const label=biomeId===4 ? 'Swamp temple' : 'Forest temple';
	const ok=teleportHeroTo(spot.x,spot.y,{message:label+' @ x='+Math.round(L.ax)+' (wariant '+L.variant+', poziomy '+L.tiers+')', center:true});
	if(!ok) return null;
	return debugTravelResult('surfaceTemple',{biomeId:biomeId|0, temple:L, spot, dir, fallback:!!spot.fallback});
}
const BIOME_THREAT_DEBUG = Object.freeze({
	forest_bear: Object.freeze({label:'Forest bear', biome:0, mobs:Object.freeze([Object.freeze({id:'BEAR', count:1})])}),
	forest_bramble: Object.freeze({label:'Forest bramble stalker', biome:0, mobs:Object.freeze([Object.freeze({id:'BRAMBLE_STALKER', count:1})])}),
	forest_grass_trap: Object.freeze({label:'Forest grass trap', biome:0, hazards:Object.freeze([Object.freeze({tile:T.UNSTABLE_GRASS, count:3})])}),
	forest_temple: Object.freeze({label:'Forest temple guards', biome:0, surfaceTempleBiome:0, mobs:Object.freeze([Object.freeze({id:'TEMPLE_GUARD', count:2})])}),
	plains_bison: Object.freeze({label:'Plains thunder bison', biome:1, mobs:Object.freeze([Object.freeze({id:'THUNDER_BISON', count:1})])}),
	plains_grass_trap: Object.freeze({label:'Plains grass trap', biome:1, hazards:Object.freeze([Object.freeze({tile:T.UNSTABLE_GRASS, count:3})])}),
	plains_zubr: Object.freeze({label:'Plains zubr charge', biome:1, mobs:Object.freeze([Object.freeze({id:'LETNI_ZUBR', count:1})])}),
	snow_pack: Object.freeze({label:'Snow wolf pack', biome:2, mobs:Object.freeze([Object.freeze({id:'WOLF', count:3})])}),
	snow_wraith: Object.freeze({label:'Snow ice wraith', biome:2, mobs:Object.freeze([Object.freeze({id:'ICE_WRAITH', count:1})])}),
	snow_golem: Object.freeze({label:'Snow stone golem', biome:2, mobs:Object.freeze([Object.freeze({id:'STONE_GOLEM', count:1})])}),
	snow_yeti: Object.freeze({label:'Snow jackpot yeti', biome:2, mobs:Object.freeze([Object.freeze({id:'JACKPOT_YETI', count:1})])}),
	desert_worm: Object.freeze({label:'Desert sand worm', biome:3, mobs:Object.freeze([Object.freeze({id:'SAND_WORM', count:1})])}),
	desert_scorpion: Object.freeze({label:'Desert giant scorpion', biome:3, mobs:Object.freeze([Object.freeze({id:'GIANT_SCORPION', count:1})])}),
	desert_sand_traps: Object.freeze({label:'Desert sand traps', biome:3, hazards:Object.freeze([Object.freeze({tile:T.UNSTABLE_SAND, count:3}), Object.freeze({tile:T.QUICKSAND, count:2, depth:4})])}),
	swamp_lurker: Object.freeze({label:'Swamp bog lurkers', biome:4, mobs:Object.freeze([Object.freeze({id:'BOG_LURKER', count:2})])}),
	swamp_temple: Object.freeze({label:'Swamp temple guards', biome:4, surfaceTempleBiome:4, mobs:Object.freeze([Object.freeze({id:'TEMPLE_GUARD', count:2})])}),
	sea_piranhas: Object.freeze({label:'Sea piranha swarm', biome:5, mobs:Object.freeze([Object.freeze({id:'PIRANHA', count:6})])}),
	sea_shark: Object.freeze({label:'Sea shark', biome:5, mobs:Object.freeze([Object.freeze({id:'SHARK', count:1})])}),
	sea_whale: Object.freeze({label:'Sea jackpot whale', biome:5, mobs:Object.freeze([Object.freeze({id:'JACKPOT_WHALE', count:1})])}),
	lake_eels: Object.freeze({label:'Lake eels', biome:6, mobs:Object.freeze([Object.freeze({id:'EEL', count:2})])}),
	lake_serpent: Object.freeze({label:'Lake serpent', biome:6, mobs:Object.freeze([Object.freeze({id:'LAKE_SERPENT', count:1})])}),
	mountain_vulture: Object.freeze({label:'Mountain vulture nest', biome:7, mobs:Object.freeze([Object.freeze({id:'VULTURE', count:1})])}),
	mountain_golem: Object.freeze({label:'Mountain stone golem', biome:7, mobs:Object.freeze([Object.freeze({id:'STONE_GOLEM', count:1})])}),
	volcano_vulture: Object.freeze({label:'Volcano vulture nest', volcano:true, mobs:Object.freeze([Object.freeze({id:'VULTURE', count:1})])}),
	city_sentinels: Object.freeze({label:'City robot sentinels', biome:8, mobs:Object.freeze([Object.freeze({id:'STRAZNIK', count:3})])}),
	city_atomic_bomb: Object.freeze({label:'City atomic bomb', biome:8, mobs:Object.freeze([Object.freeze({id:'ATOMIC_BOMB', count:1}), Object.freeze({id:'RADIATION_COCKROACH', count:3})])})
});
function debugHazardReplaceable(t){
	if(t===T.AIR || isGasTileId(t)) return true;
	if(t===T.WATER || t===T.LAVA || t===T.BEDROCK) return false;
	const info=INFO[t] || null;
	if(info && (info.chestTier || info.cache || info.story || info.unmineable || info.machine)) return false;
	if(t===T.GOLD_ORE || t===T.DIAMOND || t===T.IRIDIUM || t===T.UFO_CONCRETE || t===T.METEORIC_IRON || t===T.RADIOACTIVE_ORE || t===T.ALIEN_BIOMASS || t===T.METEOR_DUST || t===T.ANTIMATTER_CRYSTAL) return false;
	if(t===T.VOLCANO_MASTER_STONE || t===T.SERVANT_STONE || t===T.GRAVE || t===T.RESPAWN_TOTEM) return false;
	if(isDoorTile(t) || isTrapdoorTile(t)) return false;
	return true;
}
function debugHazardSurfaceAt(tx,biomeId){
	if(typeof tx!=='number' || !isFinite(tx)) return null;
	tx=Math.round(tx);
	if(WORLDGEN && typeof WORLDGEN.biomeType==='function' && typeof biomeId==='number' && WORLDGEN.biomeType(tx)!==(biomeId|0)) return null;
	ensureChunk(Math.floor(tx/CHUNK_W));
	const y=Math.round(WORLDGEN && WORLDGEN.surfaceHeight ? WORLDGEN.surfaceHeight(tx) : Math.floor(player.y+1));
	if(y<3 || y>=WORLD_H-5) return null;
	if(!bodySpaceOpen(getTile(tx,y-1),false) || !bodySpaceOpen(getTile(tx,y-2),false)) return null;
	return {x:tx,y};
}
function placeDebugHazardTile(tx,ty,t){
	if(!Number.isFinite(tx) || !Number.isFinite(ty) || ty<2 || ty>=WORLD_H-2) return false;
	tx=Math.floor(tx); ty=Math.floor(ty);
	const old=getTile(tx,ty);
	if(old===t) return true;
	if(!debugHazardReplaceable(old)) return false;
	setTile(tx,ty,t);
	return true;
}
function placeDebugHazardColumn(surface,tile,depth){
	let placed=0;
	const n=Math.max(1,Math.min(8,Number(depth)||1));
	for(let dy=0; dy<n; dy++){
		if(placeDebugHazardTile(surface.x,surface.y+dy,tile)) placed++;
	}
	return placed;
}
function placeDebugTerrainHazards(hazardDefs,biomeId){
	if(!Array.isArray(hazardDefs) || !hazardDefs.length) return {total:0, byTile:{}};
	const byTile={};
	let total=0, lane=0;
	for(const def of hazardDefs){
		const tile=def && Number(def.tile);
		if(!Number.isFinite(tile)) continue;
		const count=Math.max(1,Math.min(8,(def && def.count)|0 || 1));
		for(let i=0;i<count;i++){
			let surface=null;
			for(let attempt=0; attempt<40 && !surface; attempt++){
				const step=3+lane*3+attempt;
				const dir=(attempt%2===0) ? 1 : -1;
				surface=debugHazardSurfaceAt(Math.round(player.x)+dir*step,biomeId);
			}
			lane++;
			if(!surface) continue;
			const n = tile===T.QUICKSAND
				? placeDebugHazardColumn(surface,tile,def && def.depth)
				: (placeDebugHazardTile(surface.x,surface.y,tile) ? 1 : 0);
			if(n>0){
				total++;
				byTile[tile]=(byTile[tile]||0)+1;
			}
		}
	}
	return {total, byTile};
}
function spawnDebugThreatMobs(mobDefs){
	if(!MOBS || !MOBS.forceSpawn || !Array.isArray(mobDefs)) return {total:0, bySpecies:{}};
	const bySpecies={};
	let total=0;
	for(const def of mobDefs){
		const id=def && def.id;
		const count=Math.max(1, Math.min(12, (def && def.count)|0 || 1));
		if(!id) continue;
		for(let i=0;i<count;i++){
			const ok=MOBS.forceSpawn(id, player, getTile);
			if(ok){ total++; bySpecies[id]=(bySpecies[id]||0)+1; }
		}
		if(bySpecies[id] && MOBS.setAggro) MOBS.setAggro(id);
	}
	return {total, bySpecies};
}
function debugJumpBiomeThreat(key,dir){
	const cfg=BIOME_THREAT_DEBUG[String(key||'')];
	if(!cfg){ msg('Nieznane zagrozenie biomu: '+key); return false; }
	let jumped=null;
	if(cfg.volcano){
		const res=(typeof window.teleportHeroToNextVolcano==='function') ? window.teleportHeroToNextVolcano(dir<0?-1:1) : null;
		if(!res) return false;
		jumped=debugTravelResult('volcano',{volcano:res.volcano, spot:res.spot, dir:dir<0?-1:1});
	} else if(typeof cfg.surfaceTempleBiome==='number') {
		jumped=debugJumpSurfaceTemple(cfg.surfaceTempleBiome,dir);
	} else {
		jumped=debugJumpBiome(cfg.biome,dir);
	}
	if(!jumped) return false;
	const spawned=spawnDebugThreatMobs(cfg.mobs);
	const hazards=placeDebugTerrainHazards(cfg.hazards,cfg.biome);
	if(spawned.total>0 || hazards.total>0){
		const parts=[];
		if(spawned.total>0) parts.push('mobs +'+spawned.total);
		if(hazards.total>0) parts.push('hazards +'+hazards.total);
		msg(cfg.label+' @ x='+Math.round(player.x)+' | '+parts.join(' | '));
		noteSaveActivity(); saveState();
		return Object.assign(jumped,{kind:'biomeThreat', threat:String(key), spawned:spawned.total, bySpecies:spawned.bySpecies, hazards:hazards.total, byTile:hazards.byTile});
	}
	msg(cfg.label+': teleport OK, ale brak miejsca/limit spawn');
	return Object.assign(jumped,{kind:'biomeThreat', threat:String(key), spawned:0, bySpecies:{}, hazards:0, byTile:{}});
};
window.teleportHeroToNearestBiome = function(biomeId,dir){ return debugJumpBiome(biomeId,dir); };
window.teleportHeroToBiomeThreat = function(key,dir){ return debugJumpBiomeThreat(key,dir); };
function finiteNpcSummary(s){
	return s && typeof s.x==='number' && isFinite(s.x) && typeof s.y==='number' && isFinite(s.y);
}
function npcDebugSummaries(){
	try{ if(GENERATED_NPCS && GENERATED_NPCS.ensureAround) GENERATED_NPCS.ensureAround(player.x,getTile,WORLDGEN,tutorialNpcCtx); }catch(e){}
	if(!NPCS || !NPCS.summaries) return [];
	return NPCS.summaries().filter(finiteNpcSummary).sort((a,b)=>a.x-b.x || String(a.id||'').localeCompare(String(b.id||'')));
}
function materializeDebugNpcCandidate(candidate){
	if(!candidate || !GENERATED_NPCS || !GENERATED_NPCS.ensureAround) return null;
	try{ GENERATED_NPCS.ensureAround(candidate.x,getTile,WORLDGEN,tutorialNpcCtx); }catch(e){}
	const npc=NPCS && NPCS.get ? NPCS.get(candidate.id) : null;
	if(npc && npc.summary){
		const summary=npc.summary();
		if(finiteNpcSummary(summary)) return summary;
	}
	return null;
}
function teleportToNpcSummary(summary,originX){
	if(!finiteNpcSummary(summary)) return false;
	const role=summary.role && summary.role!==summary.name ? (' / '+summary.role) : '';
	const status=summary.status ? (' ['+summary.status+']') : '';
	const dist=typeof originX==='number' && isFinite(originX) ? ' dystans '+Math.round(Math.abs(summary.x-originX))+' blokow' : '';
	return teleportHeroTo(summary.x, summary.y, {message:'NPC: '+summary.name+role+status+dist, center:true});
}
function jumpDebugNpc(dir){
	dir=dir<0 ? -1 : 1;
	const originX=player.x;
	const active=npcDebugSummaries();
	const current=dir>0 ? active.find(s=>s.x>originX+1.25) : active.slice().reverse().find(s=>s.x<originX-1.25);
	let generated=null;
	try{
		generated=(GENERATED_NPCS && GENERATED_NPCS.findNext) ? GENERATED_NPCS.findNext(originX,dir,WORLDGEN,220) : null;
	}catch(e){ generated=null; }
	let target=current || null;
	if(generated){
		const genDist=Math.abs(generated.x-originX);
		const activeDist=target ? Math.abs(target.x-originX) : Infinity;
		if(genDist<activeDist || !target) target=materializeDebugNpcCandidate(generated) || target;
	}
	if(!target && active.length) target=dir>0 ? active[0] : active[active.length-1];
	if(!target){ msg('Nie znaleziono NPC w tym kierunku'); return false; }
	return teleportToNpcSummary(target,originX);
}
function jumpDebugNearestNpc(){
	const originX=player.x;
	const active=npcDebugSummaries();
	let target=active.reduce((best,s)=>{
		const d=Math.hypot((s.x||0)-player.x,(s.y||0)-player.y);
		return !best || d<best.d ? {s,d} : best;
	},null);
	if(!target){
		let left=null, right=null;
		try{
			left=(GENERATED_NPCS && GENERATED_NPCS.findNext) ? GENERATED_NPCS.findNext(originX,-1,WORLDGEN,220) : null;
			right=(GENERATED_NPCS && GENERATED_NPCS.findNext) ? GENERATED_NPCS.findNext(originX,1,WORLDGEN,220) : null;
		}catch(e){}
		const pick=(!left || (right && Math.abs(right.x-originX)<Math.abs(left.x-originX))) ? right : left;
		const summary=materializeDebugNpcCandidate(pick);
		if(summary) target={s:summary,d:Math.abs(summary.x-originX)};
	}
	if(!target){ msg('Nie znaleziono NPC'); return false; }
	return teleportToNpcSummary(target.s,originX);
}
function debugNpcMetrics(){
	const active=npcDebugSummaries();
	const nearby=NPCS && NPCS.nearby ? NPCS.nearby(player,18).length : 0;
	const current=active.reduce((best,s)=>{
		const d=Math.hypot((s.x||0)-player.x,(s.y||0)-player.y);
		return !best || d<best.d ? {s,d} : best;
	},null);
	return {total:active.length, nearby, current:current ? {name:current.s.name, status:current.s.status} : null};
}
window.teleportHeroToNextNpc = function(dir){ return jumpDebugNpc(dir); };
window.teleportHeroToNearestNpc = function(){ return jumpDebugNearestNpc(); };
const loaded=loadGame();
if(!loaded){ placePlayer(); } else { centerOnPlayer(); }
updateInventory({noCraftNotify:true}); updateGodBtn(); updateImmunityBtn(); if(MM.ui && MM.ui.updateMapButton && FOG && FOG.getRevealAll) MM.ui.updateMapButton(FOG.getRevealAll()); updateHotbarSel(); refreshHotbarDom(); updateWeaponBar(); if(!loaded) msg('Sterowanie: A/D/W. 1=kilof: LPM kopie, PPM stawia. 2/3/4=broń: LPM strzela/atakuje, PPM ult/obrona. E=Ekwipunek, G=Bóg, I=Immune, M=Mapa, C=Centrum, H=Pomoc'); else msg('Wczytano zapis – miłej gry!');
// (Ghost preview is computed per-frame in draw() from lastPointer — see canPlaceAt)

// Robustly initialize both grass and player speed controls after DOM is ready
function initAllMenuControls() {
	initGrassControls();
	initPlayerSpeedControls();
	initFrameCapControls();
}
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initAllMenuControls);
} else {
	initAllMenuControls();
}

// Pętla
let volcanoLeakWakeT=0;
const MAX_FRAME_DT=0.05;
let lastPowerCatchupSaveAt=0;
function catchUpPowerSystems(dt){
	const simDt=Math.max(0,Math.min(1800,Number(dt)||0));
	if(simDt<=0.001) return false;
	let changed=false;
	try{ if(DYNAMO && DYNAMO.catchUp) changed=!!DYNAMO.catchUp(simDt,getTile,{wind:WIND}) || changed; }catch(e){ console.warn('dynamo catch-up failed',e); }
	try{ if(SOLAR && SOLAR.catchUp) changed=!!SOLAR.catchUp(simDt,player,getTile,{background:BACKGROUND,clouds:CLOUDS}) || changed; }catch(e){ console.warn('solar catch-up failed',e); }
	try{ if(TELEPORTERS && TELEPORTERS.catchUp) changed=!!TELEPORTERS.catchUp(simDt,player,getElectricNetworkTile,setTile,{dynamo:DYNAMO,heroEnergy:MM.heroEnergy}) || changed; }catch(e){ console.warn('teleporter catch-up failed',e); }
	try{ if(PUMPS && PUMPS.catchUp) changed=!!PUMPS.catchUp(simDt,player,getFluidNetworkTile,setTile,{dynamo:DYNAMO,teleporters:TELEPORTERS}) || changed; }catch(e){ console.warn('pump catch-up failed',e); }
	try{ if(TURRETS && TURRETS.catchUp) changed=!!TURRETS.catchUp(simDt,player,getTile,setTile,{dynamo:DYNAMO,teleporters:TELEPORTERS,pumps:PUMPS}) || changed; }catch(e){ console.warn('turret catch-up failed',e); }
	try{ if(SPRING_PLATFORMS && SPRING_PLATFORMS.catchUp) changed=!!SPRING_PLATFORMS.catchUp(simDt,player,getElectricNetworkTile,{dynamo:DYNAMO,teleporters:TELEPORTERS}) || changed; }catch(e){ console.warn('spring platform catch-up failed',e); }
	if(changed){
		const now=Date.now();
		noteSaveActivity();
		if(now-lastPowerCatchupSaveAt>2500){
			lastPowerCatchupSaveAt=now;
			saveState();
		}
	}
	return changed;
}
// --- Ocean shore hint: first contact with a sealed deep-water basin teaches boats ---
let oceanHintT=0, oceanHintShown=(function(){ try{ return localStorage.getItem('mm_ocean_hint_v1')==='1'; }catch(e){ return false; } })();
function updateOceanHint(dt){
	if(oceanHintShown) return;
	oceanHintT-=dt;
	if(oceanHintT>0) return;
	oceanHintT=1.6;
	if(!WORLDGEN || !WORLDGEN.oceanBasinAt) return;
	const sea=(WORLDGEN.settings && WORLDGEN.settings.seaLevel)||62;
	if(player.y>sea+9) return; // hint belongs to the shoreline, not the deep caves
	const px=Math.floor(player.x);
	for(let d=0; d<=10; d++){
		for(const dir of (d? [-1,1] : [1])){
			if(!WORLDGEN.oceanBasinAt(px+d*dir)) continue;
			oceanHintShown=true;
			try{ localStorage.setItem('mm_ocean_hint_v1','1'); }catch(e){}
			msg('🌊 Ocean: wpław go nie przepłyniesz, a pod dnem leży skała macierzysta. Połóż drewno na wodzie — drewno nie tonie, powstanie łódź!');
			return;
		}
	}
}
function runGameStep(dt,ts){
	if(updateDeathTravelFx(dt)){
		updateParticles(dt);
		updateBlink(ts);
		return;
	}
	physics(dt); if(player.atkCd>0) player.atkCd-=dt;
	// Weapon use: selected weapon slots fire from LPM; the touch button aims forward.
	const heldWeapon=activeWeaponItem();
	if(heldWeapon && ((weaponPointerId!=null && lastPointer.has)||fireBtnHeld) && WEAPONS && WEAPONS.fireHeld){
		const aim=(weaponPointerId!=null && lastPointer.has && !fireBtnHeld)? screenToWorld(lastPointer.x,lastPointer.y) : {x:player.x+player.facing*5, y:player.y-0.4};
		if(WEAPONS.fireHeld(player, aim.x, aim.y, dt)) notifyInvasionWeaponUse(heldWeapon,{held:true});
	}
	if(WEAPONS && WEAPONS.update) WEAPONS.update(dt, getTile, setTile);
	if(GENERATED_NPCS && GENERATED_NPCS.update) GENERATED_NPCS.update(dt, player, getTile, setTile, tutorialNpcCtx);
	if(NPCS && NPCS.update) NPCS.update(dt, player, getTile, setTile, tutorialNpcCtx);
	if(FISHING && FISHING.update) FISHING.update(dt, player, getTile);
	updateOceanHint(dt);
	updateHouseHealing(dt);
	if(MEAT && MEAT.update) MEAT.update(dt, player, getTile, setTile);
	volcanoLeakWakeT-=dt;
	if(volcanoLeakWakeT<=0){
		const slowLavaWake=lastFrameMs>32;
		volcanoLeakWakeT=slowLavaWake?0.65:0.28;
		if(FIRE && FIRE.wakeVolcanoLeaksNear) FIRE.wakeVolcanoLeaksNear(player.x, player.y, getTile, {rx:slowLavaWake?36:56, ry:slowLavaWake?28:38, peekTile:WORLD.peekTile});
	}
	if(SEASONS && SEASONS.update) SEASONS.update(dt, getTile, setTile, player, seasonUpdateContext());
	if(FIRE && FIRE.update) FIRE.update(getTile, setTile, dt);
	if(VOLCANO && VOLCANO.update) VOLCANO.update(dt, player, getTile, setTile);
	if(WIND && WIND.update) WIND.update(dt, player, getTile, {clouds:CLOUDS, worldGen:WORLDGEN, background:BACKGROUND});
	if(BOATS && BOATS.update) BOATS.update(dt, player, getTile, {wind:WIND, water:WATER, heroEnergy:MM.heroEnergy, mobs:MOBS});
	if(MECHS && MECHS.update) MECHS.update(dt, player, getTile, setTile, {controls:companionControlState(), godMode, heroEnergy:MM.heroEnergy});
	if(GASES && GASES.update) GASES.update(dt, getTile, setTile, player);
	if(PLANTS && PLANTS.update) PLANTS.update(getTile, setTile, dt);
	if(PROGRESS && PROGRESS.update) PROGRESS.update(dt);
updateMining(dt); updateFallingBlocks(dt); if(FALLING && FALLING.update) FALLING.update(getTile,setTile,dt); if(WATER && WATER.update) WATER.update(getTile,setTile,dt); if(DYNAMO && DYNAMO.update) DYNAMO.update(dt,getTile); if(SOLAR && SOLAR.update) SOLAR.update(dt,player,getTile); if(TELEPORTERS && TELEPORTERS.update) TELEPORTERS.update(dt, player, getElectricNetworkTile, setTile, {dynamo:DYNAMO, heroEnergy:MM.heroEnergy}); if(PUMPS && PUMPS.update) PUMPS.update(dt, player, getFluidNetworkTile, setTile, {dynamo:DYNAMO, teleporters:TELEPORTERS}); if(TURRETS && TURRETS.update) TURRETS.update(dt, player, getTile, setTile, {dynamo:DYNAMO, teleporters:TELEPORTERS, pumps:PUMPS}); if(SPRING_PLATFORMS && SPRING_PLATFORMS.update) SPRING_PLATFORMS.update(dt, player, getElectricNetworkTile, {dynamo:DYNAMO, teleporters:TELEPORTERS}); if(VENDING && VENDING.update) VENDING.update(dt,getTile); updateHeroEnergy(dt); if(CLOUDS && CLOUDS.update) CLOUDS.update(getTile,setTile,dt); if(ATOMIC_WINTER && ATOMIC_WINTER.update) ATOMIC_WINTER.update(dt, player, getTile, setTile); if(GUARDIANS && GUARDIANS.update) GUARDIANS.update(dt, player, getTile, setTile); if(UNDERGROUND && UNDERGROUND.update) UNDERGROUND.update(dt, player, getTile, setTile); if(SKY_GUARDIAN && SKY_GUARDIAN.update) SKY_GUARDIAN.update(dt, player, getTile, setTile); if(CENTER_GUARDIAN && CENTER_GUARDIAN.update) CENTER_GUARDIAN.update(dt, player, getTile, setTile); if(STORY_PROGRESSION && STORY_PROGRESSION.update) STORY_PROGRESSION.update(dt, player, getTile, setTile); if(AFTERMATH && AFTERMATH.update) AFTERMATH.update(dt, player, getTile, setTile); if(BOSSES && BOSSES.update) BOSSES.update(getTile,setTile,dt); if(MOBS && MOBS.update) MOBS.update(dt, player, getTile, setTile); if(INVASIONS && INVASIONS.update) INVASIONS.update(dt, player, getTile, setTile, {inv, viewport:currentViewportState(), resourceKeys:RESOURCE_KEYS, inventory:MM.inventory, ensureChunkAtY, updateInventory, notifyStructureTileChanged, saveState, msg, spawnBurst}); if(ALIEN_RUINS && ALIEN_RUINS.update) ALIEN_RUINS.update(dt, player, getTile, setTile, {saveState, msg}); if(COMPANIONS && COMPANIONS.update) COMPANIONS.update(dt, player, getTile, setTile, {breakTile:breakTileByCompanion, harvestSpeed:tools[player.tool]*((MM.activeModifiers && MM.activeModifiers.mineSpeedMult)||1), controls:companionControlState()}); if(UFO && UFO.update) UFO.update(dt, player); if(TRAPS && TRAPS.update) TRAPS.update(dt, player, getTile, setTile); if(TERRAIN_TRAPS && TERRAIN_TRAPS.update) TERRAIN_TRAPS.update(dt); if(METEORITES && METEORITES.update) METEORITES.update(dt, player, getTile, setTile); updateParticles(dt); updateCombatImpactFx(dt); updateCape(dt); updateBlink(ts);
}
let lastLoopErrAt=0; function loop(ts){
	if(shouldSkipFrameForCap(ts)){ requestAnimationFrame(loop); return; }
	if(frameClock.resetFrames>0){ frameClock.last=ts; frameClock.resetFrames--; }
	const rawDt=Math.max(0,(ts-frameClock.last)/1000);
	const frameDt=Math.min(MAX_FRAME_DT,rawDt);
	frameClock.last=ts;
	lastFrameMs=rawDt*1000;
	window.__mmFrameMs=lastFrameMs; // smooth zoom interpolation
	// the whole frame is guarded: one bad subsystem tick must skip a frame, not kill
	// the rAF chain with an uncaught error (e.g. a cache blowing its size limit)
	try{
		let simMs=0, drawMs=0;
		if(!paused && rawDt-frameDt>0.25) catchUpPowerSystems(rawDt-frameDt);
		if(Math.abs(zoomTarget-zoom)>0.0001){ zoom += (zoomTarget-zoom)*Math.min(1, frameDt*8); applyCameraFromCenter(); }
		if(!paused){
			const simT=framePerfNow();
			runGameStep(frameDt,ts);
			updateCameraFollow(frameDt);
			revealAround();
			simMs=framePerfNow()-simT;
		}
		if(AUDIO && AUDIO.update) AUDIO.update(frameDt);
		const drawT=framePerfNow();
		draw();
		drawMs=framePerfNow()-drawT;
		recordFramePerf(lastFrameMs,simMs,drawMs);
		updateHoverInfo();
		updateWeaponGauges();
		if(paused){
			ctx.save();
			ctx.fillStyle='rgba(5,8,14,0.45)'; ctx.fillRect(0,0,W,H);
			if(!pausePanelVisible()){
				ctx.fillStyle='#fff'; ctx.font='bold 28px system-ui'; ctx.textAlign='center';
				ctx.fillText('⏸ PAUZA', W/2, H/2-8);
				ctx.font='13px system-ui'; ctx.fillText('Naciśnij B, aby wznowić', W/2, H/2+18);
			}
			ctx.restore();
		}
		if(MM.ui && MM.ui.setRadarPulsing) MM.ui.setRadarPulsing(ts<radarFlash); updateFps(ts); updateBiomeLabel(); updateStatusHud(ts); if(TASKS && TASKS.updateHud) TASKS.updateHud(player);
	}catch(err){
		try{ window.__mmLoopErrors=(window.__mmLoopErrors||0)+1; }catch(e){}
		if(ts-lastLoopErrAt>2000){ lastLoopErrAt=ts; console.error('game loop error (frame skipped):', err); }
	}
	requestAnimationFrame(loop); } requestAnimationFrame(loop);
// (Re)define loot popup helpers if not already present (guard for reloads)
// Deferred loot inbox system
if(!window.__lootPopupInit){
	window.__lootPopupInit=true;
	window.lootInbox = window.lootInbox || [];
	let lootInboxUnread = 0; // separate unread counter so viewing doesn't erase items
	const LOOT_INBOX_KEY='mm_loot_inbox_v1';
	// Inbox rows need gear shape ({id,kind,...}); older saves may also contain
	// resource-drop entries ({item,qty}) which rendered as broken rows — drop them.
	function isGearItem(it){ return !!(it && typeof it==='object' && typeof it.id==='string' && typeof it.kind==='string'); }
	function dedupeGearItems(items){
		const seen=new Set(), out=[];
		(items||[]).forEach(it=>{
			if(!isGearItem(it) || seen.has(it.id)) return;
			seen.add(it.id); out.push(it);
		});
		return out;
	}
	function ownedGearItems(items){
		const INV=MM.inventory;
		const seen=new Set(), out=[];
		(items||[]).forEach(raw=>{
			if(!isGearItem(raw) || seen.has(raw.id)) return;
			const owned=INV && INV.getItem ? INV.getItem(raw.id) : raw;
			if(!isGearItem(owned)) return;
			seen.add(owned.id); out.push(owned);
		});
		return out;
	}
	try{ const saved=localStorage.getItem(LOOT_INBOX_KEY); if(saved){ const parsed=JSON.parse(saved); if(Array.isArray(parsed.items)){ window.lootInbox = dedupeGearItems(parsed.items); lootInboxUnread = Math.min(parsed.unread|0, window.lootInbox.length); } } }catch(e){}
	const lootInboxBtn=document.getElementById('lootInboxBtn');
	const lootInboxCount=document.getElementById('lootInboxCount');
	const lootPopup=document.getElementById('lootPopup');
	const lootDim=document.getElementById('lootDim');
	const lootItemsBox=document.getElementById('lootPopupItems');
	const lootEquipAllBtn=document.getElementById('lootEquipAll');
	const lootKeepAllBtn=document.getElementById('lootKeepAll');
	const lootCloseBtn=document.getElementById('lootClose');
	let lootPrevFocus=null;
	function persistInbox(){ window.lootInbox=ownedGearItems(window.lootInbox); lootInboxUnread=Math.min(lootInboxUnread, window.lootInbox.length); try{ localStorage.setItem(LOOT_INBOX_KEY, JSON.stringify({items:window.lootInbox, unread:lootInboxUnread})); }catch(e){} }
	function updateLootInboxIndicator(){ const count=lootInboxUnread; if(!lootInboxBtn) return; if(count>0){ lootInboxBtn.style.display='inline-block'; lootInboxCount.textContent=''+count; lootInboxBtn.classList.add('pulseNew'); } else { lootInboxBtn.style.display='none'; lootInboxCount.textContent=''; lootInboxBtn.classList.remove('pulseNew'); } }
	window.updateLootInboxIndicator=updateLootInboxIndicator;
	function removeInboxItem(id){ window.lootInbox=window.lootInbox.filter(it=>it && it.id!==id); lootInboxUnread=Math.min(lootInboxUnread, window.lootInbox.length); persistInbox(); updateLootInboxIndicator(); }
	function clearInbox(){ window.lootInbox=[]; lootInboxUnread=0; persistInbox(); updateLootInboxIndicator(); }
	function lootNoticeName(it){ return it ? (it.name||it.id) : 'brak'; }
	function lootNoticeSigned(n){ return n>0? '+'+n : String(n); }
	function lootNoticeSuffix(cmp){
		if(!cmp) return '';
		if(cmp.equippedComparable && cmp.equippedDelta!=null) return ' vs noszone '+lootNoticeSigned(cmp.equippedDelta)+' Moc';
		if(cmp.equipped) return ' - inna rola niz noszone';
		return ' - pierwszy w slocie';
	}
	function lootNoticeRank(row){
		const cmp=row && row.cmp;
		if(!cmp) return -1;
		let rank=0;
		if(cmp.equippedComparable && cmp.equippedDelta!=null){
			rank=10000+Math.abs(cmp.equippedDelta);
			if(cmp.equippedDelta>0) rank+=100000;
		} else if(cmp.equipped) rank=5000;
		else rank=2500;
		if(cmp.isNewBest) rank+=1000;
		return rank;
	}
	function notifyFreshLoot(fresh){
		const INV=MM.inventory;
		if(!INV || !INV.compareItem || !fresh || !fresh.length) return;
		const rows=fresh.map(it=>({item:it, cmp:INV.compareItem(it.id)})).filter(row=>row.item && row.cmp);
		if(!rows.length) return;
		rows.sort((a,b)=>lootNoticeRank(b)-lootNoticeRank(a));
		const top=rows[0];
		const extra=fresh.length>1 ? ' (+'+(fresh.length-1)+')' : '';
		msg('Nowy przedmiot: '+lootNoticeName(top.item)+lootNoticeSuffix(top.cmp)+extra);
	}
	function addInboxItems(items){
		const before=new Set(window.lootInbox.map(it=>it.id));
		const fresh=ownedGearItems(items).filter(it=>!before.has(it.id));
		if(!fresh.length) return 0;
		window.lootInbox.push(...fresh);
		lootInboxUnread += fresh.length;
		persistInbox(); updateLootInboxIndicator();
		notifyFreshLoot(fresh);
		return fresh.length;
	}
	function buildRows(items){ lootItemsBox.innerHTML='';
		const INV=MM.inventory;
		const KIND_NAME={cape:'peleryna', eyes:'oczy', outfit:'strój', weapon:'broń', charm:'talizman'};
		// Benchmark = the equipped item this loot would replace; weapons only compare
		// within their own shortcut category (a bow is never judged against a sword).
		function benchmarkFor(it){
			if(!INV) return null;
			const slot=INV.slotForKind? INV.slotForKind(it.kind):null;
			const eq=slot? INV.equippedItem(slot.id):null;
			if(!eq) return null;
			if(it.kind==='weapon' && INV.weaponCategory){
				const c1=INV.weaponCategory(it), c2=INV.weaponCategory(eq);
				if(!c1 || !c2 || c1.id!==c2.id) return null;
			}
			return eq;
		}
		function itemName(it){ return it ? (it.name||it.id) : 'brak'; }
		function signed(n){ return n>0? '+'+n : String(n); }
		function relationClass(cmp){
			if(!cmp) return 'option';
			if(cmp.bestDelta==null || cmp.bestDelta>0) return 'best';
			if(cmp.equippedDelta!=null && cmp.equippedDelta>0) return 'upgrade';
			if(cmp.bestDelta===0) return 'match';
			return 'worse';
		}
		function verdictText(cmp){
			if(!cmp) return 'Nowa opcja';
			if(cmp.bestDelta==null) return 'Pierwszy taki przedmiot';
			if(cmp.bestDelta>0) return 'NAJLEPSZE W TORBIE '+signed(cmp.bestDelta);
			if(cmp.equippedDelta!=null && cmp.equippedDelta>0) return 'LEPSZE OD NOSZONEGO '+signed(cmp.equippedDelta);
			if(cmp.bestDelta===0) return 'REMIS Z NAJLEPSZYM';
			return 'SŁABSZE OD NAJLEPSZEGO '+signed(cmp.bestDelta);
		}
		function addCompareRow(box,label,item,delta,score){
			const row=document.createElement('div'); row.className='lootCompareRow '+(delta>0?'up':delta<0?'down':'eq');
			const l=document.createElement('span'); l.textContent=label;
			const v=document.createElement('b'); v.textContent=item ? itemName(item)+' · Moc '+score+(delta==null?'':' · '+signed(delta)) : 'brak';
			row.appendChild(l); row.appendChild(v); box.appendChild(row);
		}
		items.forEach(raw=>{ if(!isGearItem(raw)) return; const it=(INV && INV.getItem && INV.getItem(raw.id)) || raw; if(!isGearItem(it)) return; const row=document.createElement('div'); row.className='lootRow '+(typeof it.tier==='string'? it.tier:''); const left=document.createElement('div'); const title=document.createElement('div'); title.style.fontWeight='600'; title.textContent=(it.name||it.id)+' · '+(KIND_NAME[it.kind]||it.kind); if(it.unique){ const b=document.createElement('span'); b.textContent='★ '+it.unique; b.style.marginLeft='6px'; b.style.fontSize='10px'; b.style.color='#ffd54a'; title.appendChild(b); }
			left.appendChild(title);
			if(INV && INV.compareItem){
				const cmp=INV.compareItem(it.id);
				const verdict=document.createElement('div'); verdict.className='lootVerdict '+relationClass(cmp); verdict.textContent=verdictText(cmp);
				left.appendChild(verdict);
				if(cmp){
					const comp=document.createElement('div'); comp.className='lootCompare';
					if(cmp.equipped) addCompareRow(comp, cmp.equippedComparable?'Noszone':'Noszone (inna rola)', cmp.equipped, cmp.equippedDelta, cmp.equippedScore);
					else addCompareRow(comp,'Noszone',null,null,null);
					if(cmp.bestExisting) addCompareRow(comp,'Najlepsze w torbie',cmp.bestExisting,cmp.bestDelta,cmp.bestScore);
					else addCompareRow(comp,'Najlepsze w torbie',null,null,null);
					left.appendChild(comp);
				}
			}
			// Same presentation as the inventory grid: "Moc" + ▲/▼ vs equipped, then stat chips
			if(INV && INV.itemScore){
				const score=INV.itemScore(it); const eq=benchmarkFor(it);
				const power=document.createElement('div'); power.className='invPowerLine'; power.style.margin='3px 0';
				const lab=document.createElement('span'); lab.textContent='Moc '+score; power.appendChild(lab);
				if(eq){
					const d=score-INV.itemScore(eq);
					const di=document.createElement('span');
					di.className= d>0?'invDeltaUp': d<0?'invDeltaDown':'invDeltaEq';
					di.textContent= d>0? '▲ +'+d+' (lepsza)' : d<0? '▼ '+d+' (gorsza)' : '= jak założona';
					power.appendChild(di);
				}
				left.appendChild(power);
			}
			if(INV && INV.statChips){
				const chips=document.createElement('div'); chips.className='invChips';
				INV.statChips(it).forEach(ch=>{
					const c=document.createElement('span'); c.className='chip'+(ch.good?'':' chipBad');
					c.title=ch.label; c.textContent=ch.icon+' '+ch.text; chips.appendChild(c);
				});
				if(chips.childNodes.length) left.appendChild(chips);
			}
			row.appendChild(left);
			const btns=document.createElement('div'); btns.style.display='flex'; btns.style.flexDirection='column'; btns.style.gap='6px';
			const equip=document.createElement('button'); equip.textContent='Wyposaż'; const keep=document.createElement('button'); keep.textContent='Zachowaj'; keep.className='sec'; const discard=document.createElement('button'); discard.textContent='Odrzuć'; discard.className='danger';
			function resolveRow(){ removeInboxItem(it.id); row.remove(); if(!lootItemsBox.children.length) closeInbox(); }
				equip.addEventListener('click',()=>{ if(MM.inventory && !MM.inventory.equip(it.id)){ msg('Nie można założyć (przedmiot odrzucony?)'); return; } resolveRow(); });
				keep.addEventListener('click',resolveRow);
				discard.addEventListener('click',()=>{ if(MM.inventory) MM.inventory.discard(it.id); resolveRow(); });
			btns.appendChild(equip); btns.appendChild(keep); btns.appendChild(discard); row.appendChild(btns); lootItemsBox.appendChild(row); row.__item=it; });
	}
	function openInbox(){ if(lootPopup.classList.contains('show')) return; window.lootInbox=ownedGearItems(window.lootInbox); if(!window.lootInbox.length){ msg('Brak przedmiotów'); persistInbox(); updateLootInboxIndicator(); return; } buildRows(window.lootInbox); lootInboxUnread=0; updateLootInboxIndicator(); persistInbox(); lootPopup.classList.add('show'); lootDim.style.display='block'; if(MM.modalInput) MM.modalInput.push('loot'); lootPrevFocus=document.activeElement; installTrap(); const first=lootPopup.querySelector('button'); if(first) first.focus(); }
	function closeInbox(){ if(!lootPopup.classList.contains('show')) return; lootPopup.classList.remove('show'); lootDim.style.display='none'; if(MM.modalInput) MM.modalInput.pop('loot'); removeTrap(); if(lootPrevFocus && lootPrevFocus.focus) lootPrevFocus.focus(); }
	function installTrap(){ removeTrap(); function handler(e){ if(!lootPopup.classList.contains('show')) return; if(e.key==='Escape'){ e.preventDefault(); closeInbox(); e.stopImmediatePropagation(); return; } if(e.key==='Tab'){ const f=[...lootPopup.querySelectorAll('button')].filter(b=>!b.disabled); if(!f.length) return; const first=f[0], last=f[f.length-1]; if(e.shiftKey){ if(document.activeElement===first){ e.preventDefault(); last.focus(); } } else { if(document.activeElement===last){ e.preventDefault(); first.focus(); } } e.stopImmediatePropagation(); } } window.addEventListener('keydown',handler); lootPopup.__trapHandler=handler; }
	function removeTrap(){ if(lootPopup.__trapHandler){ window.removeEventListener('keydown', lootPopup.__trapHandler); lootPopup.__trapHandler=null; } }
	lootInboxBtn?.addEventListener('click',openInbox);
	lootCloseBtn?.addEventListener('click',closeInbox); lootDim?.addEventListener('click',closeInbox);
	// "Wyposaż najlepsze": equip the highest-Moc inbox item per kind, and only if it
	// actually beats what's equipped; never auto-switches the weapon class (a new epic
	// bow stays in the bag when a sword is in hand — the player picks weapon roles).
	lootEquipAllBtn?.addEventListener('click',()=>{
		const INV=MM.inventory;
		if(!INV || !INV.itemScore){ closeInbox(); return; }
		const best={}; // kind -> strongest inbox item
		[...lootItemsBox.querySelectorAll('.lootRow')].forEach(r=>{
			const it=r.__item; if(!it) return;
			if(!best[it.kind] || INV.itemScore(it)>INV.itemScore(best[it.kind])) best[it.kind]=it;
		});
		let n=0;
		Object.values(best).forEach(it=>{
			const slot=INV.slotForKind(it.kind); if(!slot) return;
			const eq=INV.equippedItem(slot.id);
			if(eq){
				if(INV.itemScore(it)<=INV.itemScore(eq)) return; // not an upgrade
				if(it.kind==='weapon' && INV.weaponCategory){
					const c1=INV.weaponCategory(it), c2=INV.weaponCategory(eq);
					if(!c1 || !c2 || c1.id!==c2.id) return;
				}
			}
			if(INV.equip(it.id)) n++;
		});
		msg(n? 'Założono '+n+' lepszych przedmiotów' : 'Nic nie przebija obecnego wyposażenia');
		clearInbox(); closeInbox();
	});
	lootKeepAllBtn?.addEventListener('click',()=>{ clearInbox(); closeInbox(); });
	window.addEventListener('keydown',e=>{ if(isEditableTarget(e.target)) return; if(MM.modalInput && MM.modalInput.isOpen() && !lootPopup.classList.contains('show')) return; if(e.key.toLowerCase()==='i'){ e.preventDefault(); e.stopImmediatePropagation(); if(lootPopup.classList.contains('show')) closeInbox(); else openInbox(); } });
	MM.onLootGained = function(items){ if(window.updateDynamicCustomization) window.updateDynamicCustomization(); addInboxItems(items); };
	// Initial indicator on load (if persisted)
	persistInbox();
	updateLootInboxIndicator();
}

// Regenerate world using the CURRENT seed (do not change WG.worldSeed)
window.regenWorldSameSeed = function(){ try{ if(MOBS && MOBS.clearAll) try{ MOBS.clearAll(); }catch(e){} if(COMPANIONS && COMPANIONS.reset) try{ COMPANIONS.reset(); }catch(e){} if(WORLD && WORLD.clear) WORLD.clear(); if(typeof chunkCanvases!=='undefined') chunkCanvases.clear(); if(typeof chunkRenderDirty!=='undefined') chunkRenderDirty.clear(); if(WORLD && WORLD.clearHeights) WORLD.clearHeights(); if(FALLING && FALLING.reset) FALLING.reset(); if(MECHS && MECHS.reset) MECHS.reset(); if(TREES && TREES.reset) TREES.reset(); if(WATER && WATER.reset) WATER.reset(); if(GASES && GASES.reset) GASES.reset(); if(WIND && WIND.reset) WIND.reset(); if(SEASONS && SEASONS.reset) SEASONS.reset(); if(DYNAMO && DYNAMO.reset) DYNAMO.reset(); if(SOLAR && SOLAR.reset) SOLAR.reset(); if(TELEPORTERS && TELEPORTERS.reset) TELEPORTERS.reset(); if(PUMPS && PUMPS.reset) PUMPS.reset(); if(TURRETS && TURRETS.reset) TURRETS.reset(); if(SPRING_PLATFORMS && SPRING_PLATFORMS.reset) SPRING_PLATFORMS.reset(); if(VENDING && VENDING.reset) VENDING.reset(); if(CLOUDS && CLOUDS.reset) CLOUDS.reset(); if(BOSSES && BOSSES.reset) BOSSES.reset(); if(GUARDIANS && GUARDIANS.reset) GUARDIANS.reset(); if(UNDERGROUND && UNDERGROUND.reset) UNDERGROUND.reset(); if(SKY_GUARDIAN && SKY_GUARDIAN.reset) SKY_GUARDIAN.reset(); if(AFTERMATH && AFTERMATH.reset) AFTERMATH.reset(); if(NPCS && NPCS.reset) NPCS.reset(); if(GENERATED_NPCS && GENERATED_NPCS.reset) GENERATED_NPCS.reset(); if(GRASS && GRASS.reset) GRASS.reset(); if(PARTICLES && PARTICLES.reset) PARTICLES.reset(); if(FIRE && FIRE.reset) FIRE.reset(); if(WEAPONS && WEAPONS.reset) WEAPONS.reset(); if(MEAT && MEAT.reset) MEAT.reset(); if(VOLCANO && VOLCANO.reset) VOLCANO.reset(); if(ATOMIC_WINTER && ATOMIC_WINTER.reset) ATOMIC_WINTER.reset(); if(TERRAIN_TRAPS && TERRAIN_TRAPS.reset) TERRAIN_TRAPS.reset(); if(UFO && UFO.reset) UFO.reset(); if(TASKS && TASKS.reset) TASKS.reset(); if(INVASIONS && INVASIONS.reset) INVASIONS.reset(); if(METEORITES && METEORITES.reset) METEORITES.reset(); if(PLANTS && PLANTS.reset) PLANTS.reset();
	// Reset fog-of-war as well
	try{ if(FOG && FOG.importSeen) FOG.importSeen([]); if(FOG && FOG.setRevealAll) FOG.setRevealAll(false); if(MM.ui && MM.ui.updateMapButton && FOG && FOG.getRevealAll) MM.ui.updateMapButton(FOG.getRevealAll()); }catch(e){}
	RESOURCE_KEYS.forEach(k=>{ inv[k]=0; }); inv.tools.stone=inv.tools.meteor=inv.tools.diamond=inv.tools.bedrock=false; inv.bedrockPickDurability=0; player.tool='basic'; hotbarIndex=0; player.xp=0; player.energy=0; if(PROGRESS && PROGRESS.reset) PROGRESS.reset(); applyProgressHp(); applyHeroEnergyCapacity(); clearRespawnTotems(); clearHealingShelters(); grave=null; saveGrave();
	// Also remove all animals when regenerating with same seed and freeze spawns briefly
	if(MOBS){ try{ if(MOBS.clearAll) MOBS.clearAll(); else if(MOBS.deserialize) MOBS.deserialize({v:3, list:[], aggro:{mode:'rel', m:{}}}); if(MOBS.freezeSpawns) MOBS.freezeSpawns(4000); }catch(e){} } if(godMode){ if(!_preGodInventory){ _preGodInventory={}; RESOURCE_KEYS.forEach(k=>{ _preGodInventory[k]=0; }); } RESOURCE_KEYS.forEach(k=>{ inv[k]=100; }); }
	resetCraftingAvailability();
	updateInventory({noCraftNotify:true}); updateHotbarSel(); placePlayer(true); try{ if(TUTORIAL_NPC && TUTORIAL_NPC.placeNearWorldStart) TUTORIAL_NPC.placeNearWorldStart(getTile,WORLDGEN); }catch(e){} saveState(); msg('Odświeżono świat (seed '+WORLDGEN.worldSeed+', ustawienia zmienione)'); }catch(e){ console.warn('regenWorldSameSeed failed',e); }}
window.addEventListener('mm-regen-same-seed', ()=>{ if(window.regenWorldSameSeed) window.regenWorldSameSeed(); });
