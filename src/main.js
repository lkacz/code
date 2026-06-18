// Nowy styl / pełny ekran inspirowany Diamonds Explorer
// Module entry: import constants (also hydrates window.MM via shim) and side-effect engine modules
import { CHUNK_W, WORLD_H, TILE, T, INFO, isSolid, MOVE } from './constants.js';
// Ensure worldgen initializes before world (world.js reads MM.worldGen on load)
import { worldGen as WORLDGEN } from './engine/worldgen.js';
import world from './engine/world.js';
import { trees as TREES } from './engine/trees.js';
import { fallingSolids as FALLING } from './engine/falling.js';
import { water as WATER } from './engine/water.js';
import { gases as GASES } from './engine/gases.js';
import { dynamo as DYNAMO } from './engine/dynamo.js';
import { solar as SOLAR } from './engine/solar.js';
import { teleporters as TELEPORTERS } from './engine/teleporters.js';
import { applyHorizontalMovement } from './engine/movement.js';
import { cape as CAPE } from './engine/cape.js';
import { chests as CHESTS } from './engine/chests.js';
import './inventory.js';
import { mobs as MOBS } from './engine/mobs.js';
import { background as BACKGROUND } from './engine/background.js';
import { fog as FOG } from './engine/fog.js';
import { eyes as EYES } from './engine/eyes.js';
import { particles as PARTICLES } from './engine/particles.js';
import { clouds as CLOUDS } from './engine/clouds.js';
import { wind as WIND } from './engine/wind.js';
import { bosses as BOSSES } from './engine/bosses.js';
import { grass as GRASS } from './engine/grass.js';
import { fire as FIRE } from './engine/fire.js';
import { weapons as WEAPONS } from './engine/weapons.js';
import { meat as MEAT } from './engine/meat.js';
import { volcano as VOLCANO } from './engine/volcano.js';
import { plants as PLANTS } from './engine/plants.js';
import { progress as PROGRESS } from './engine/progress.js';
import { survival as SURVIVAL } from './engine/survival.js';
import { audio as AUDIO } from './engine/audio.js';
import { ufo as UFO } from './engine/ufo.js';
import { traps as TRAPS } from './engine/traps.js';
import { ruins as RUINS } from './engine/ruins.js';
import './engine/ui.js';
import './inventory_ui.js';
// Bind global MM into a module-scoped constant for convenience
const MM = window.MM;
// Game init
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', {alpha:false});
let W=0,H=0,DPR=1; function resize(){ DPR=Math.max(1,Math.min(2,window.devicePixelRatio||1)); canvas.width=Math.floor(window.innerWidth*DPR); canvas.height=Math.floor(window.innerHeight*DPR); canvas.style.width=window.innerWidth+'px'; canvas.style.height=window.innerHeight+'px'; ctx.setTransform(DPR,0,0,DPR,0,0); W=window.innerWidth; H=window.innerHeight; } window.addEventListener('resize',resize,{passive:true}); resize();

// --- Świat (łagodniejsze biomy: równiny / wzgórza / góry) ---
const WORLD = world || MM.world;
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
let _lastBiomeId=-1;
function updateBiomeLabel(){
	if(!WORLDGEN || !WORLDGEN.biomeType) return;
	const id=WORLDGEN.biomeType(Math.floor(player.x));
	if(id===_lastBiomeId) return;
	_lastBiomeId=id;
	const el=document.getElementById('biome');
	if(el) el.textContent=BIOME_NAMES[id]||'—';
}
// --- Dynamic Background delegated to engine/background.js ---
function drawBackground(){ if(BACKGROUND && BACKGROUND.draw) BACKGROUND.draw(ctx, W, H, player.x, TILE, WORLDGEN); }
function applyAtmosphericTint(){ if(!VISUAL.atmoTint) return; if(BACKGROUND && BACKGROUND.applyTint) BACKGROUND.applyTint(ctx, W, H); }
let grassDensityScalar = 1; // user adjustable (exponential scaling)
let grassHeightScalar = 1; // user adjustable linear multiplier
const GRASS_DENSITY_CAP = 18; // prevents saved extreme UI values from flooding the renderer
// Grass performance management

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

// light error overlay (keep minimal)
(function(){ const box=document.getElementById('errorBox'); if(!box) return; function show(msg){ box.textContent=msg; box.style.display='block'; }
	window.addEventListener('error',e=>{ show('[Error] '+e.message); });
	window.addEventListener('unhandledrejection',e=>{ const r=e.reason; show('[Promise] '+((r && r.message) || String(r))); });
})();

function getTile(x,y){ return WORLD.getTile(x,y); }
function setTile(x,y,v){ WORLD.setTile(x,y,v); }
setTile.transient = function(x,y,v){
	if(WORLD && typeof WORLD.setTransientTile==='function') WORLD.setTransientTile(x,y,v);
	else WORLD.setTile(x,y,v);
};
if(FALLING && FALLING.init) FALLING.init(getTile,setTile);

// --- Gracz / inwentarz ---
const player={x:0,y:0,w:0.7,h:0.95,vx:0,vy:0,onGround:false,facing:1,tool:'basic',jumpCount:0,maxHp:100,hp:100,hpInvul:0,atkCd:0,xp:0,energy:0,maxEnergy:0};
const HERO_ENERGY_BASE=40;
const HERO_ENERGY_PER_LEVEL=8;
let energyChargeFx={t:0,intensity:0,source:null,flash:0};
let energyFxEmitT=0;
let _lastEnergySaveAt=0;
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
function addHeroEnergy(amount){
	const n=Math.max(0, Number(amount)||0);
	if(n<=0) return 0;
	applyHeroEnergyCapacity();
	const before=player.energy||0;
	player.energy=Math.min(player.maxEnergy||heroEnergyCapacity(), before+n);
	return player.energy-before;
}
function spendHeroEnergy(amount){
	const n=Math.max(0, Number(amount)||0);
	if(n<=0) return true;
	applyHeroEnergyCapacity();
	if((player.energy||0)+1e-6<n) return false;
	player.energy=Math.max(0,(player.energy||0)-n);
	return true;
}
function chargeHeroEnergy(amount, opts){
	opts=opts||{};
	const charged=addHeroEnergy(amount);
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
	if(opts.cause==='ufo'){
		energyChargeFx.t=0;
		energyChargeFx.intensity=0;
		energyChargeFx.source=null;
	}
	noteSaveActivity();
	saveState();
	return before;
}
function heroEnergyInfo(){
	applyHeroEnergyCapacity();
	return {energy:player.energy||0,max:player.maxEnergy||heroEnergyCapacity(),base:HERO_ENERGY_BASE,perLevel:HERO_ENERGY_PER_LEVEL};
}
MM.heroEnergy={capacity:heroEnergyCapacity, info:heroEnergyInfo, add:addHeroEnergy, chargeExternal:chargeHeroEnergy, spend:spendHeroEnergy, drain:drainHeroEnergy};
window.addEventListener('mm-progress-change',applyHeroEnergyCapacity);
applyHeroEnergyCapacity();
const tools={basic:1,stone:2,diamond:4};
// --- Resource registry: SINGLE source for collectable/placeable resources,
// derived from MM.inventory.RESOURCES ({key,label,color,tile}). Adding a new
// resource there (plus its INFO tile entry) automatically wires: inv counts,
// HUD counters, hotbar remap menu + counts, god-mode stacks, world-reset zeroing,
// placement/consumption checks, undo refunds, crafting labels and death drops.
const RESOURCE_DEFS=(MM.inventory && MM.inventory.RESOURCES)? MM.inventory.RESOURCES.slice() : [];
const RESOURCE_KEYS=RESOURCE_DEFS.map(r=>r.key);
const TILE_TO_RES={}; RESOURCE_DEFS.forEach(r=>{ if(r.tile && T[r.tile]!=null) TILE_TO_RES[T[r.tile]]=r.key; });
const RES_LABEL={}; RESOURCE_DEFS.forEach(r=>{ RES_LABEL[r.key]=r.label.toLowerCase(); });
const TILE_LABELS={};
RESOURCE_DEFS.forEach(r=>{ if(r.tile && T[r.tile]!=null) TILE_LABELS[T[r.tile]]=r.label; });
Object.assign(TILE_LABELS,{
	[T.AIR]:'Powietrze',
	[T.CHEST_COMMON]:'Skrzynia zwykla',
	[T.CHEST_RARE]:'Skrzynia rzadka',
	[T.CHEST_EPIC]:'Skrzynia epicka',
	[T.ICE]:'Lod',
	[T.LAVA]:'Lawa',
	[T.MUD]:'Bloto',
	[T.GRAVE]:'Nagrobek',
	[T.VOLCANO_MASTER_STONE]:'Kamien mistrza',
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
	[T.SOLAR_PANEL]:'Panel sloneczny',
	[T.SOLAR_BATTERY]:'Panel sloneczny z bateria'
});
function tileLabel(t){ return TILE_LABELS[t] || 'Nieznany blok'; }
function tileHoverColor(t){ return t===T.AIR ? '#9fb8d1' : ((INFO[t]&&INFO[t].color) || '#9fb8d1'); }
function isGasTileId(t){ return !!(INFO[t] && INFO[t].gas); }
function gasSkyExposedTile(x,y){
	if(GASES && typeof GASES.skyExposed==='function') return GASES.skyExposed(x,y,getTile);
	for(let yy=Math.floor(y)-1; yy>=0; yy--){
		const t=getTile(x,yy);
		if(t===T.AIR || isGasTileId(t)) continue;
		return false;
	}
	return true;
}
// Inventory counts for resources (+ tool unlock flags)
const inv={tools:{stone:false,diamond:false}};
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
function cycleHotbar(idx){ if(idx<0||idx>=HOTBAR_ORDER.length) return; hotbarIndex=idx; updateHotbarSel(); refreshHotbarDom(); saveState(); }
const DYNAMO_ORIENTATION_KEY='mm_dynamo_orientation_v1';
let dynamoOrientation='horizontal';
try{
	const savedDynamoOrientation=localStorage.getItem(DYNAMO_ORIENTATION_KEY);
	if(savedDynamoOrientation==='vertical') dynamoOrientation='vertical';
}catch(e){}
function dynamoOrientationLabel(){ return dynamoOrientation==='vertical' ? 'pionowo' : 'poziomo'; }
function toggleDynamoOrientation(){
	dynamoOrientation=dynamoOrientation==='vertical' ? 'horizontal' : 'vertical';
	try{ localStorage.setItem(DYNAMO_ORIENTATION_KEY,dynamoOrientation); }catch(e){}
	msg('Dynamo: '+dynamoOrientationLabel()+' (R obraca)');
}
// --- Respawn point (Totem odrodzenia) + death with gravestone resource drop ---
// Both are bound to the world seed: a totem from world A must not teleport the hero
// into world B's rock, and a grave's coordinates are meaningless in another world.
let respawnPoint=null; const RESPAWN_KEY='mm_respawn_v1';
try{ const raw=localStorage.getItem(RESPAWN_KEY); if(raw){ const d=JSON.parse(raw); if(d && isFinite(d.x) && isFinite(d.y) && d.seed===WORLDGEN.worldSeed) respawnPoint=d; } }catch(e){}
function saveRespawnPoint(){ try{ if(respawnPoint) localStorage.setItem(RESPAWN_KEY, JSON.stringify(respawnPoint)); else localStorage.removeItem(RESPAWN_KEY); }catch(e){} }
function setRespawnPoint(){ respawnPoint={x:player.x, y:player.y, seed:WORLDGEN.worldSeed}; saveRespawnPoint(); msg('🚩 Totem postawiony — tu się odrodzisz'); }
let grave=null; const GRAVE_KEY='mm_grave_v1';
try{ const raw=localStorage.getItem(GRAVE_KEY); if(raw){ const d=JSON.parse(raw); if(d && isFinite(d.x) && isFinite(d.y) && d.res && d.seed===WORLDGEN.worldSeed) grave=d; } }catch(e){}
function saveGrave(){ try{ if(grave) localStorage.setItem(GRAVE_KEY, JSON.stringify(grave)); else localStorage.removeItem(GRAVE_KEY); }catch(e){} }
// Loading a save with a different seed invalidates both markers
function dropWorldBoundMarkers(){
	if(respawnPoint && respawnPoint.seed!==WORLDGEN.worldSeed){ respawnPoint=null; saveRespawnPoint(); }
	if(grave && grave.seed!==WORLDGEN.worldSeed){ grave=null; saveGrave(); }
}
// Single entry for hurting the hero — i-frames, knockback, hurt audio and death
// routing live HERE, not in each damage source. mobs/bosses/weapons delegate to
// this (with local fallbacks only for the DOM-less Node sims).
// opts: {srcX,srcY (knockback origin), kb (impulse, default 4), kbY (upward cap,
//        default -2.5), launch (hard upward fling), invulMs, cause}
window.damageHero=function(amount, opts){
	opts=opts||{};
	if(!(amount>0) || !isFinite(amount)) return false;
	const now=performance.now();
	if(player.hpInvul && now<player.hpInvul) return false;
	player.hp-=Math.round(amount);
	player.hpInvul=now+(opts.invulMs||600);
	try{ if(MM.audio && MM.audio.play) MM.audio.play('hurt'); }catch(e){}
	if(typeof opts.srcX==='number' && isFinite(opts.srcX)){
		const dx=player.x-opts.srcX;
		const dy=(typeof opts.srcY==='number' && isFinite(opts.srcY))? player.y-opts.srcY : 0;
		const d=Math.hypot(dx,dy)||1;
		player.vx+=(dx/d)*((opts.kb!=null)?opts.kb:4);
		player.vy=Math.min(player.vy, (opts.kbY!=null)?opts.kbY:-2.5);
	}
	if(typeof opts.launch==='number') player.vy=Math.min(player.vy, opts.launch);
	if(player.hp<=0){ player.hp=0; window.heroDied(opts.cause||'damage'); }
	return true;
};
// Central death handler (mobs/bosses/lava/explosions all route here): half of every
// resource is left behind in a gravestone tile — click it to recover the loss.
window.heroDied=function(){
	const res={}; let any=false;
	for(const k of RESOURCE_KEYS){
		const half=Math.floor((inv[k]||0)/2);
		if(half>0){ res[k]=half; inv[k]-=half; any=true; }
	}
	if(any){
		const gx=Math.round(player.x); let gy=Math.round(player.y);
		const here=getTile(gx,gy);
		if(here!==T.AIR && here!==T.WATER && getTile(gx,gy-1)===T.AIR) gy=gy-1;
		grave={x:gx, y:gy, res, seed:WORLDGEN.worldSeed}; saveGrave();
		const t=getTile(gx,gy);
		if(t===T.AIR || t===T.WATER || isGasTileId(t)) setTile(gx,gy,T.GRAVE);
		msg('☠ Zginąłeś — połowa zasobów czeka w nagrobku ('+gx+', '+gy+')');
	} else {
		msg('☠ Zginąłeś – respawn');
	}
	try{ if(MM.audio && MM.audio.play) MM.audio.play('grave'); }catch(e){}
	player.hp=player.maxHp; player.hpInvul=performance.now()+1500; player.vx=0; player.vy=0;
	updateInventory();
	placePlayer(true);
};
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
	return !!(INFO[t] && INFO[t].gas);
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
// --- Integrity helpers (stable stringify + FNV1a hash) ---
function stableStringify(v){ if(v===null||typeof v!=='object') return JSON.stringify(v); if(Array.isArray(v)) return '['+v.map(stableStringify).join(',')+']'; const keys=Object.keys(v).sort(); return '{'+keys.map(k=>JSON.stringify(k)+':'+stableStringify(v[k])).join(',')+'}'; }
function computeHash(str){ // FNV-1a 32-bit
 let h=0x811c9dc5; for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h = (h>>>0) * 0x01000193; h>>>0; } return ('00000000'+(h>>>0).toString(16)).slice(-8); }
function attachHash(obj){ const clone=JSON.parse(JSON.stringify(obj)); const core=stableStringify(clone); const hash=computeHash(core); clone.h=hash; return {object:clone, hash}; }
function verifyHash(obj){ if(!obj || typeof obj!=='object' || !obj.h) return {ok:true, reason:!obj?'no-object':'no-hash'}; const h=obj.h; const tmp=Object.assign({}, obj); delete tmp.h; const core=stableStringify(tmp); const calc=computeHash(core); return {ok: h===calc, expected: h, got: calc}; }
// Save scheduler state is declared before saveGame(): customization events can
// request a save before later DOM setup code has finished running.
let _saveStateT=null, _autoSaveWorkT=null, _autoSaveJob=null, _lastAutoSaveAt=Date.now(), _saveDirty=false, _lastSaveActivityAt=Date.now(), _saveRevision=0, _saveFailureCount=0, _nextAutoSaveRetryAt=0, _lastSaveError='';
const AUTO_SAVE_IDLE_CHECK_MS=3000;
const AUTO_SAVE_IDLE_REQUIRED_MS=12000;
const AUTO_SAVE_MIN_GAP_MS=90000;
const AUTO_SAVE_CHUNK_BATCH_MS=5;
function noteSaveActivity(){ _lastSaveActivityAt=Date.now(); }
function modifiedChunkIds(){ if(WORLD && typeof WORLD.modifiedChunkIds==='function') return WORLD.modifiedChunkIds(); const out=[]; const worldMap=WORLD._world; if(!worldMap) return out; for(const [k] of worldMap.entries()){ const cx=parseInt(k.slice(1), 10); if(isNaN(cx)) continue; const ver=WORLD._versions.get(k)||0; if(ver!==0) out.push(cx); } return out; }
function gatherModifiedChunks(ids){ const out=[]; const worldMap=WORLD._world; if(!worldMap) return out; const list=Array.isArray(ids) ? [...new Set(ids)] : null; if(list){ for(const cx of list){ if(typeof cx!=='number' || !isFinite(cx)) continue; const arr=worldMap.get('c'+cx); const ver=WORLD._versions.get('c'+cx)||0; if(!arr || ver===0) continue; out.push({cx,data:encodeRLE(chunkForTerrainSave(arr)),rle:true}); } return out; } for(const [k,arr] of worldMap.entries()){ const cx=parseInt(k.slice(1), 10); if(isNaN(cx)) continue; const ver=WORLD._versions.get(k)||0; if(ver===0) continue; out.push({cx,data:encodeRLE(chunkForTerrainSave(arr)),rle:true}); } return out; }
function markWorldChunkModified(cx){ if(WORLD && typeof WORLD.markModifiedChunk==='function') WORLD.markModifiedChunk(cx,1); else if(WORLD && WORLD._versions) WORLD._versions.set('c'+cx,1); if(WORLD && WORLD._modifiedChunks) WORLD._modifiedChunks.add(cx); }
function restoreModifiedChunks(list){ const restored=[]; if(!Array.isArray(list)) return restored; for(const ch of list){ if(typeof ch.cx!=='number'||!ch.data) continue; const arr = stripTransientTerrainTiles(ch.rle? decodeRLE(ch.data, CHUNK_W*WORLD_H): decodeRaw(ch.data)); try{ if(TREES && TREES.clearChunk) TREES.clearChunk(ch.cx); }catch(e){} WORLD._world.set('c'+ch.cx, arr); markWorldChunkModified(ch.cx); restored.push(ch.cx); } return restored; }
function autosaveChunkKey(cx,jobId){ return AUTOSAVE_CHUNK_PREFIX+WORLDGEN.worldSeed+'_'+cx+(jobId?('_'+jobId):''); }
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
function restoreReferencedChunks(refs){ const restored=[]; if(!Array.isArray(refs)) return restored; for(const ref of refs){ if(!ref || typeof ref.cx!=='number' || typeof ref.key!=='string' || !ref.key.startsWith(AUTOSAVE_CHUNK_PREFIX)) continue; let data=null; try{ data=localStorage.getItem(ref.key); }catch(e){ data=null; } if(!data) continue; if(ref.h && computeHash(data)!==ref.h){ console.warn('Autosave chunk hash mismatch',ref.cx); continue; } const arr = stripTransientTerrainTiles(ref.rle===false ? decodeRaw(data) : decodeRLE(data, CHUNK_W*WORLD_H)); try{ if(TREES && TREES.clearChunk) TREES.clearChunk(ref.cx); }catch(e){} WORLD._world.set('c'+ref.cx, arr); markWorldChunkModified(ref.cx); restored.push(ref.cx); } return restored; }
function restoreWorldChunks(worldData){ if(!worldData || typeof worldData!=='object') return []; if(Array.isArray(worldData.modified)) return restoreModifiedChunks(worldData.modified); if(Array.isArray(worldData.chunkRefs)) return restoreReferencedChunks(worldData.chunkRefs); return []; }
// (legacy v4 export*/import* save helpers removed — v5 persists only blocks + player position)
function snapshotInventory(){
	const out={tools:{stone:!!inv.tools.stone, diamond:!!inv.tools.diamond}};
	RESOURCE_KEYS.forEach(k=>{ out[k]=Math.max(0, inv[k]|0); });
	return out;
}
function restoreInventory(src){
	RESOURCE_KEYS.forEach(k=>{ inv[k]=0; });
	inv.tools.stone=false; inv.tools.diamond=false;
	if(!src || typeof src!=='object') return;
	RESOURCE_KEYS.forEach(k=>{
		const v=src[k];
		inv[k]=Number.isFinite(v) ? Math.max(0, v|0) : 0;
	});
	if(src.tools && typeof src.tools==='object'){
		inv.tools.stone=!!src.tools.stone;
		inv.tools.diamond=!!src.tools.diamond;
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
function buildSaveObject(opts){
 opts=opts||{};
 let saveChunkIds = Array.isArray(opts.auditChunkIds) ? opts.auditChunkIds : null;
 if(!opts.lightweight){
	 try{ if(FALLING && FALLING.settleAll) FALLING.settleAll(); }catch(e){}
	 saveChunkIds=modifiedChunkIds();
	 try{ if(TREES && TREES.auditChunks) TREES.auditChunks(saveChunkIds,getTile); }catch(e){}
	 try{ if(TREES && TREES.settleAll) TREES.settleAll(getTile,setTile); }catch(e){}
	 saveChunkIds=modifiedChunkIds();
 }
 if(saveChunkIds==null) saveChunkIds = Array.isArray(opts.chunkRefs) ? [] : modifiedChunkIds();
 try{ if(saveChunkIds.length && MEAT && MEAT.auditChunks) MEAT.auditChunks(saveChunkIds,getTile); }catch(e){}
 try{ if(saveChunkIds.length && GASES && GASES.auditChunks) GASES.auditChunks(saveChunkIds,getTile); }catch(e){}
 const worldData = Array.isArray(opts.chunkRefs) ? {chunkRefs:opts.chunkRefs, external:true} : {modified: gatherModifiedChunks(saveChunkIds)};
 return {
	v:7,
	seed: WORLDGEN.worldSeed,
	world:worldData,
	trees: (TREES && TREES.snapshot) ? TREES.snapshot() : null,
	falling: (FALLING && FALLING.snapshot) ? FALLING.snapshot() : null,
	meat: (MEAT && MEAT.snapshot) ? MEAT.snapshot() : null,
	gases: (GASES && GASES.snapshot) ? GASES.snapshot() : null,
	wind: (WIND && WIND.snapshot) ? WIND.snapshot() : null,
	dynamo: (DYNAMO && DYNAMO.snapshot) ? DYNAMO.snapshot() : null,
	solar: (SOLAR && SOLAR.snapshot) ? SOLAR.snapshot() : null,
	teleporters: (TELEPORTERS && TELEPORTERS.snapshot) ? TELEPORTERS.snapshot() : null,
	inv: snapshotInventory(),
	hotbar: snapshotHotbar(),
	equipment: snapshotEquipment(),
	player: { x: player.x, y: player.y, xp: player.xp|0, tool: player.tool, energy:+(player.energy||0).toFixed(2) },
	savedAt: Date.now()
}; }
function saveGameCore(manual){
	try{
		const t0=performance.now();
		const oldRefs=currentAutosaveRefs();
		const data=buildSaveObject();
		const mods=(data.world && data.world.modified)? data.world.modified.length:0;
		const {object:withHash} = attachHash(data);
		const json=JSON.stringify(withHash);
		localStorage.setItem(SAVE_KEY,json);
		cleanupAutosaveChunks(referencedAutosaveKeys(),oldRefs);
		recordSaveSuccess();
		try{ window.__lastSaveMs=performance.now()-t0; window.__lastSaveSizeKb=(json.length/1024)|0; window.__lastSaveChunks=mods; window.__lastSaveMode='full'; window.__lastSaveWriteMs=0; }catch(e){}
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
function saveGame(manual){ const ok=saveGameCore(manual); if(ok){ _saveDirty=false; _lastAutoSaveAt=Date.now(); _autoSaveJob=null; if(_saveStateT){ clearTimeout(_saveStateT); _saveStateT=null; } if(_autoSaveWorkT){ clearTimeout(_autoSaveWorkT); _autoSaveWorkT=null; } } if(ok && !manual){ try{ const raw=localStorage.getItem(SAVE_KEY); if(raw) showAutoSaveHint((raw.length/1024)|0); }catch(e){} } return ok; }
function loadGame(){
 try{
	let raw=localStorage.getItem(SAVE_KEY);
	if(!raw){ for(const k of OLD_SAVE_KEYS){ raw=localStorage.getItem(k); if(raw) break; } }
	if(!raw){ return false; }
	const data=JSON.parse(raw);
	if(!data|| typeof data!=='object') return false;
	const hashInfo=verifyHash(data); if(!hashInfo.ok){ msg('UWAGA: uszkodzony zapis (hash)'); console.warn('Hash mismatch',hashInfo); }
	const ver=data.v||5; // proceed even if hash mismatch
	// Saves older than v6 store chunks from the previous (inverted) terrain model;
	// pasting them into a v2 world corrupts it — start fresh instead
	if(ver<6){ console.warn('Save version',ver,'predates terrain v2 — starting a new world'); return false; }

	// Reset volatile systems regardless of seed to avoid stale state
	try{ if(MOBS && MOBS.clearAll) MOBS.clearAll(); }catch(e){}
	try{ if(MOBS && MOBS.freezeSpawns) MOBS.freezeSpawns(3000); }catch(e){}
	try{ if(typeof chunkCanvases!=='undefined') chunkCanvases.clear(); }catch(e){}
	try{ if(FOG && FOG.importSeen) FOG.importSeen([]); if(FOG && FOG.setRevealAll) FOG.setRevealAll(false); }catch(e){}
	try{ if(WATER && WATER.reset) WATER.reset(); }catch(e){}
	try{ if(CLOUDS && CLOUDS.reset) CLOUDS.reset(); }catch(e){}
	try{ if(BOSSES && BOSSES.reset) BOSSES.reset(); }catch(e){}
	try{ if(FALLING && FALLING.reset) FALLING.reset(); }catch(e){}
	try{ if(TREES && TREES.reset) TREES.reset(); }catch(e){}
	try{ if(GRASS && GRASS.reset) GRASS.reset(); }catch(e){}
	try{ if(PARTICLES && PARTICLES.reset) PARTICLES.reset(); }catch(e){}
	try{ if(FIRE && FIRE.reset) FIRE.reset(); }catch(e){}
	try{ if(WEAPONS && WEAPONS.reset) WEAPONS.reset(); }catch(e){}
	try{ if(MEAT && MEAT.reset) MEAT.reset(); }catch(e){}
	try{ if(GASES && GASES.reset) GASES.reset(); if(WIND && WIND.reset) WIND.reset(); }catch(e){}
	try{ if(DYNAMO && DYNAMO.reset) DYNAMO.reset(); }catch(e){}
	try{ if(SOLAR && SOLAR.reset) SOLAR.reset(); }catch(e){}
	try{ if(TELEPORTERS && TELEPORTERS.reset) TELEPORTERS.reset(); }catch(e){}
	try{ if(VOLCANO && VOLCANO.reset) VOLCANO.reset(); }catch(e){}
	// (plants persist independently in mm_plants_v1 and survive a reload of the same world)

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

	// Restore modified blocks and player position. v6 saves are self-contained;
	// v7 autosaves may reference separately stored chunk blobs.
	const restoredChunks=restoreWorldChunks(data.world);
	try{ if(TREES && TREES.restore) TREES.restore(data.trees,getTile); }catch(e){}
	try{ if(TREES && TREES.auditChunks) TREES.auditChunks(restoredChunks,getTile); }catch(e){}
	try{ if(FALLING && FALLING.restore) FALLING.restore(data.falling); }catch(e){}
	try{ if(FALLING && FALLING.auditChunks) FALLING.auditChunks(restoredChunks,{force:true}); }catch(e){}
	try{ if(MEAT && MEAT.restore) MEAT.restore(data.meat,getTile); }catch(e){}
	try{ if(GASES && GASES.restore) GASES.restore(data.gases,getTile,setTile); }catch(e){}
	try{ if(GASES && GASES.auditChunks) GASES.auditChunks(restoredChunks,getTile); }catch(e){}
	try{ if(WIND && WIND.restore) WIND.restore(data.wind); }catch(e){}
	try{ if(DYNAMO && DYNAMO.restore) DYNAMO.restore(data.dynamo,getTile); }catch(e){}
	try{ if(SOLAR && SOLAR.restore) SOLAR.restore(data.solar,getTile); }catch(e){}
	try{ if(TELEPORTERS && TELEPORTERS.restore) TELEPORTERS.restore(data.teleporters,getTile); }catch(e){}
	restoreInventory(data.inv);
	restoreHotbar(data.hotbar || (data.player && {tool:data.player.tool}));
	restoreEquipment(data.equipment);
	// Restore only player position
	if(data.player && typeof data.player.x==='number') player.x = data.player.x;
	if(data.player && typeof data.player.y==='number') player.y = data.player.y;
	if(data.player && typeof data.player.xp==='number') player.xp = data.player.xp;
	player.energy = (data.player && typeof data.player.energy==='number') ? data.player.energy : 0;
	applyProgressHp();
	applyHeroEnergyCapacity();

	// Recenter camera or place player if needed
	if(data.player && typeof data.player.x==='number' && typeof data.player.y==='number') { centerOnPlayer(); } else { placePlayer(true); }
	try{
		updateInventory({noSave:true});
		refreshHotbarDom();
		updateHotbarSel();
		updateWeaponBar();
	}catch(e){}
	return true;
 }catch(e){ console.warn('Load failed',e); return false; }
}
// Auto-save heartbeat: it only asks the dirty scheduler to try saving. The heavy
// serialization itself is delayed until gameplay is idle, so the heartbeat cannot
// create rhythmic frame stalls while digging or travelling.
setInterval(()=>{ saveState(); },60000);
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
			const loadB=document.createElement('button'); loadB.textContent='Wczytaj'; loadB.style.fontSize='11px'; loadB.addEventListener('click',()=>{ const raw=localStorage.getItem(slotKey(s.id)); if(raw){ try{ localStorage.setItem(SAVE_KEY,raw); const ok=loadGame(); if(ok){ currentSlotId=s.id; localStorage.setItem(LAST_SLOT_KEY,currentSlotId); msg('Wczytano '+nameDisp); refreshList(); } else msg('Błąd wczyt.'); }catch(e){ msg('Błąd wczyt.'); } } });
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
	function performNamedSave(forcePrompt){ const slots=loadSlots(); let initial=''; if(!forcePrompt && currentSlotId){ const cur=slots.find(s=>s.id===currentSlotId); if(cur) initial=cur.name||''; } const name=prompt('Nazwa zapisu:', initial); if(name==null) return; const trimmed=name.trim(); let target=null; if(currentSlotId) target=slots.find(s=>s.id===currentSlotId && (trimmed==='' || s.name===trimmed)); if(!target && trimmed) target=slots.find(s=>s.name===trimmed); const rawCore=buildSaveObject(); const {object:withHash} = attachHash(rawCore); const data=JSON.stringify(withHash); if(target){ try{ localStorage.setItem(slotKey(target.id), data); target.time=Date.now(); if(trimmed) target.name=trimmed; target.seed=WORLDGEN.worldSeed; storeSlots(slots); currentSlotId=target.id; localStorage.setItem(LAST_SLOT_KEY,currentSlotId); msg('Nadpisano '+(target.name||target.id)); refreshList(); }catch(e){ msg('Błąd zapisu'); } } else { const id=Date.now().toString(36)+Math.random().toString(36).slice(2,6); try{ localStorage.setItem(slotKey(id), data); slots.push({id,name:trimmed||null,time:Date.now(),seed:WORLDGEN.worldSeed}); storeSlots(slots); currentSlotId=id; localStorage.setItem(LAST_SLOT_KEY,currentSlotId); msg('Zapisano '+(trimmed||id)); browser.style.display='flex'; refreshList(); }catch(e){ msg('Błąd – brak miejsca?'); } } }

	// Continue button logic
	continueBtn.addEventListener('click',()=>{
		const slots=loadSlots(); if(!slots.length){ msg('Brak zapisów'); return; }
		let targetId=currentSlotId || localStorage.getItem(LAST_SLOT_KEY);
		if(!targetId){ targetId = slots.sort((a,b)=>b.time-a.time)[0].id; }
		const raw=localStorage.getItem(slotKey(targetId)); if(!raw){ msg('Brak danych'); return; }
		try{ localStorage.setItem(SAVE_KEY,raw); const ok=loadGame(); if(ok){ currentSlotId=targetId; localStorage.setItem(LAST_SLOT_KEY,currentSlotId); msg('Kontynuowano'); refreshList(); } else msg('Błąd'); }catch(e){ msg('Błąd'); }
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
	return {id:Date.now().toString(36)+'_'+(_saveRevision|0).toString(36), chunks:modifiedChunkIds(), index:0, refs:[], oldRefs:currentAutosaveRefs(), revision:_saveRevision, t0:performance.now(), bytes:0};
}
function finishIncrementalAutoSave(){
	const job=_autoSaveJob; if(!job) return false;
	const t0=performance.now();
	try{
		const data=buildSaveObject({lightweight:true, chunkRefs:job.refs, auditChunkIds:[]});
		const {object:withHash} = attachHash(data);
		const json=JSON.stringify(withHash);
		localStorage.setItem(SAVE_KEY,json);
		cleanupAutosaveChunks(new Set(job.refs.map(r=>r.key)),job.oldRefs);
		const elapsed=(performance.now()-job.t0);
		const finalMs=(performance.now()-t0);
		const totalKB=((json.length+job.bytes)/1024)|0;
		try{ window.__lastSaveMs=elapsed; window.__lastSaveWriteMs=finalMs; window.__lastSaveSizeKb=totalKB; window.__lastSaveChunks=job.refs.length; window.__lastSaveMode='incremental'; }catch(e){}
		recordSaveSuccess();
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
		const t0=performance.now();
		const worldMap=WORLD._world;
		let processed=0;
		while(job.index<job.chunks.length){
			const cx=job.chunks[job.index++];
			const arr=worldMap && worldMap.get('c'+cx);
			const ver=WORLD._versions ? (WORLD._versions.get('c'+cx)||0) : 0;
			if(!arr || ver===0) continue;
			try{ if(MEAT && MEAT.auditChunks) MEAT.auditChunks([cx],getTile); }catch(e){}
			try{ if(GASES && GASES.auditChunks) GASES.auditChunks([cx],getTile); }catch(e){}
			const data=encodeRLE(chunkForTerrainSave(arr));
			const ref={cx,key:autosaveChunkKey(cx,job.id),rle:true,h:computeHash(data)};
			localStorage.setItem(ref.key,data);
			job.refs.push(ref);
			job.bytes+=data.length;
			processed++;
			if(processed>=1 && performance.now()-t0>=AUTO_SAVE_CHUNK_BATCH_MS) break;
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
	scheduleDirtySave();
}
function flushPendingSave(){
	if(_saveStateT){ clearTimeout(_saveStateT); _saveStateT=null; }
	if(_autoSaveWorkT){ clearTimeout(_autoSaveWorkT); _autoSaveWorkT=null; }
	_autoSaveJob=null;
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
	const key=def.kind==='weapon'?'weapons':'charms';
	if(!Array.isArray(MM.dynamicLoot[key])) MM.dynamicLoot[key]=[];
	MM.dynamicLoot[key].push(def);
	if(CHESTS && CHESTS.saveDynamicLoot) CHESTS.saveDynamicLoot();
	if(window.updateDynamicCustomization) window.updateDynamicCustomization();
	if(MM.inventory) MM.inventory.equip(def.id);
	msg('Wytworzono: '+def.name+' (założono)');
}
const RECIPES=[
	{id:'pick_stone', name:'Kilof kamienny', cost:{stone:10}, done:()=>inv.tools.stone, make(){ inv.tools.stone=true; msg('Kilof kamienny (przełączaj klawiszem 1)'); }},
	{id:'pick_diamond', name:'Kilof diamentowy', cost:{diamond:5}, done:()=>inv.tools.diamond, make(){ inv.tools.diamond=true; msg('Kilof diamentowy (przełączaj klawiszem 1)'); }},
	{id:'torches', name:'Pochodnie ×4', cost:{wood:2}, make(){ inv.torch+=4; msg('Pochodnie +4 — przypisz do paska i stawiaj (świecą nocą)'); }},
	{id:'coal_torches', name:'Pochodnie z węgla ×8', cost:{wood:1, coal:1}, make(){ inv.torch+=8; msg('Pochodnie +8 — węgiel pali się długo'); }},
	{id:'obsidian_sword', name:'Miecz obsydianowy', cost:{obsidian:4, wood:2}, make(){ grantCraftedItem({kind:'weapon',weaponType:'melee',name:'Miecz obsydianowy',attackDamage:6,tier:'rare',desc:'Wykuty z hartowanej lawy'}); }},
	{id:'lucky_charm', name:'Talizman diamentowy', cost:{diamond:3}, make(){ grantCraftedItem({kind:'charm',name:'Talizman diamentowy',mineSpeedMult:1.15,visionRadius:12,tier:'rare',desc:'Diament oszlifowany w talizman'}); }},
	{id:'respawn', name:'Totem odrodzenia', cost:{stone:5, wood:2}, make(){ setRespawnPoint(); }},
	{id:'dynamo', name:'Dynamo', cost:{steel:4, wire:2, copper:2, transistor:1}, make(){ inv.dynamo+=1; msg('Dynamo +1 - R obraca; pionowe dziala w zaporach wodnych'); }},
	{id:'copper_wire', name:'Przewod miedziany x4', cost:{copper:2, plastic:1}, make(){ inv.copperWire+=4; msg('Przewod miedziany +4 - laczy dynama z maszynami'); }},
	{id:'teleporter', name:'Teleporter', cost:{steel:6, copperWire:6, transistor:2, diamond:1, dynamo:1}, make(){ inv.teleporter+=1; msg('Teleporter +1 - wejdz w lewo/prawo, aby skoczyc do kolejnego'); }},
	// Consumables: brewed and drunk on the spot (timed buffs ride the modifier-source registry)
	{id:'potion_heal', name:'Eliksir życia', cost:{water:2, leaf:3}, make(){ player.hp=Math.min(player.maxHp, player.hp+40); msg('🧪 Eliksir życia: +40 HP'); try{ if(MM.audio && MM.audio.play) MM.audio.play('heal'); }catch(e){} }},
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
function canCraft(r){ if(r.done && r.done()) return false; for(const k in r.cost){ if((inv[k]||0)<r.cost[k]) return false; } return true; }
function doCraft(r){ if(!canCraft(r)) return; for(const k in r.cost) inv[k]-=r.cost[k]; r.make(); try{ if(MM.audio && MM.audio.play) MM.audio.play('craft'); }catch(e){} updateInventory(); }
const CRAFT_COLLAPSED_KEY='mm_craft_collapsed_v1';
function loadCraftCollapsed(){
	try{ return localStorage.getItem(CRAFT_COLLAPSED_KEY)==='1'; }catch(e){ return false; }
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
		toggle.title=collapsed?'Show crafting':'Hide crafting';
	}
	try{ localStorage.setItem(CRAFT_COLLAPSED_KEY, collapsed?'1':'0'); }catch(e){}
}
function buildCraftPanel(){
	const host=document.getElementById('craft'); if(!host) return;
	const existingTitle=host.querySelector('.craftTitle') || host.querySelector('strong');
	const label=((existingTitle && existingTitle.textContent) || host.textContent || 'Rzemioslo').trim() || 'Rzemioslo';
	const wasCollapsed = host.dataset.collapsed==='true' || loadCraftCollapsed();
	host.innerHTML='';
	const header=document.createElement('div'); header.className='craftHeader';
	const title=document.createElement('strong'); title.className='craftTitle'; title.textContent=label;
	const toggle=document.createElement('button'); toggle.id='craftToggle'; toggle.className='topbtn'; toggle.type='button'; toggle.setAttribute('aria-controls','craftBody');
	toggle.addEventListener('click',()=>{ setCraftCollapsed(host, host.dataset.collapsed!=='true'); });
	header.appendChild(title); header.appendChild(toggle); host.appendChild(header);
	const body=document.createElement('div'); body.id='craftBody'; body.className='craftBody'; host.appendChild(body);
	RECIPES.forEach(r=>{
		const b=document.createElement('button'); b.className='craftBtn'; b.id='craft_'+r.id; b.textContent=r.name;
		b.addEventListener('click',()=>doCraft(r));
		const req=document.createElement('div'); req.className='req';
		req.textContent=Object.entries(r.cost).map(([k,v])=>v+' × '+(RES_LABEL[k]||k)).join(' + ');
		body.appendChild(b); body.appendChild(req);
	});
	setCraftCollapsed(host, wasCollapsed);
}
function updateCraftButtons(){ RECIPES.forEach(r=>{ const b=document.getElementById('craft_'+r.id); if(!b) return; b.disabled=!canCraft(r); if(r.done && r.done()) b.textContent=r.name+' ✓'; }); }
// Blink moved to engine/eyes.js
function updateBlink(now){ if(EYES && EYES.update) EYES.update(now); }
 // Cape physics: chain with gravity that droops when idle and streams when moving
function initScarf(){ CAPE.init(player); }
function updateCape(dt){ CAPE.update(player,dt,getTile,isSolid); }
function drawCape(){ CAPE.draw(ctx,TILE); }
function drawPlayer(){ const c=MM.customization||{}; const bodyX=(player.x-player.w/2)*TILE; const bodyY=(player.y-player.h/2)*TILE; const bw=player.w*TILE, bh=player.h*TILE;
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
	 // Eyes (for all outfits except ninja/ironperson which draw their own above)
	 if(style!=='ninja' && style!=='ironperson') {
		const eyeW=6, eyeHOpen=6; let eyeH = (EYES && EYES.getEyeHeight)? EYES.getEyeHeight(eyeHOpen, c.eyeStyle): eyeHOpen;
		 const eyeY=bodyY + bh*0.35; const eyeOffsetX=bw*0.18; const pupilW=2; const pupilShift=player.facing*1.5;
		 function eye(cx){ if(c.eyeStyle==='glow'){ ctx.fillStyle='rgba(255,255,255,0.08)'; ctx.fillRect(cx-eyeW/2-2, eyeY-eyeHOpen/2-2, eyeW+4, eyeHOpen+4); ctx.fillStyle='#8bf9ff'; ctx.fillRect(cx-eyeW/2, eyeY-eyeHOpen/2, eyeW, eyeHOpen); }
			 else if(c.eyeStyle==='sleepy'){ const h=Math.max(2, eyeHOpen-3); ctx.fillStyle='#fff'; ctx.fillRect(cx-eyeW/2, eyeY-h/2, eyeW, h); if(h>2){ ctx.fillStyle='#111'; ctx.fillRect(cx - pupilW/2 + pupilShift, eyeY - Math.min(h/2-1,2), pupilW, Math.min(h-2,4)); } }
			 else if(c.eyeStyle==='gold'){ ctx.fillStyle='#ffce3a'; ctx.fillRect(cx-eyeW/2, eyeY-eyeH/2, eyeW, eyeH); if(eyeH>2){ ctx.fillStyle='#5a3b00'; ctx.fillRect(cx - pupilW/2 + pupilShift, eyeY - Math.min(eyeH/2-1,2), pupilW, Math.min(eyeH-2,4)); } }
			 else { ctx.fillStyle='#fff'; ctx.fillRect(cx-eyeW/2, eyeY-eyeH/2, eyeW, eyeH); if(eyeH>2){ ctx.fillStyle='#111'; ctx.fillRect(cx - pupilW/2 + pupilShift, eyeY - Math.min(eyeH/2-1,2), pupilW, Math.min(eyeH-2,4)); } } }
		 eye(bodyX+bw/2-eyeOffsetX); eye(bodyX+bw/2+eyeOffsetX);
	 }

	// Draw special eyes overlays for ninja / ironperson
	if(style==='ninja'){
		const eyeW=6, eyeH=3, eyeY=bodyY+bh*0.35, eyeOffsetX=bw*0.18;
		ctx.fillStyle='#fff';
		ctx.fillRect(bodyX+bw/2-eyeOffsetX-eyeW/2, eyeY-1, eyeW, eyeH);
		ctx.fillRect(bodyX+bw/2+eyeOffsetX-eyeW/2, eyeY-1, eyeW, eyeH);
		ctx.fillStyle='#3cf';
		ctx.fillRect(bodyX+bw/2-eyeOffsetX-eyeW/2+2, eyeY,2,1);
		ctx.fillRect(bodyX+bw/2+eyeOffsetX-eyeW/2+2, eyeY,2,1);
	}
	else if(style==='ironperson'){
		const eyeW=6, eyeH=6, eyeY=bodyY+bh*0.35, eyeOffsetX=bw*0.18;
		ctx.fillStyle='#ffd700';
		ctx.fillRect(bodyX+bw/2-eyeOffsetX-eyeW/2, eyeY-eyeH/2, eyeW, eyeH);
		ctx.fillRect(bodyX+bw/2+eyeOffsetX-eyeW/2, eyeY-eyeH/2, eyeW, eyeH);
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

// Chunk render cache (offscreen canvas per chunk)
const chunkCanvases = new Map(); // key: chunkX -> {canvas,ctx,version}
const CHUNK_CANVAS_MIN_KEEP = 10;
const CHUNK_CANVAS_MAX_KEEP = 16;
function trimChunkCanvasCache(centerCx, keep){
	keep=Math.max(CHUNK_CANVAS_MIN_KEEP, Math.min(CHUNK_CANVAS_MAX_KEEP, keep|0));
	if(chunkCanvases.size<=keep) return;
	const keys=[...chunkCanvases.keys()].sort((a,b)=>Math.abs(b-centerCx)-Math.abs(a-centerCx));
	for(const key of keys){
		if(chunkCanvases.size<=keep) break;
		chunkCanvases.delete(key);
	}
}
function hash32(x,y){ let h = (x|0)*374761393 + (y|0)*668265263; h = (h^(h>>>13))*1274126177; h = h^(h>>>16); return h>>>0; }
function shadeColor(hex,delta){ // hex like #rgb or #rrggbb (we use rrggbb)
	const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
	const clamp=v=>v<0?0:v>255?255:v; const nr=clamp(r+delta), ng=clamp(g+delta), nb=clamp(b+delta);
	return '#'+nr.toString(16).padStart(2,'0')+ng.toString(16).padStart(2,'0')+nb.toString(16).padStart(2,'0'); }
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
	g.fillStyle=baked?'rgba(54,26,12,0.25)':rotten?'rgba(23,29,18,0.28)':'rgba(48,16,14,0.24)';
	g.fillRect(px+4,py+TILE-4,TILE-8,2);
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
function drawChunkToCache(cx,centerCx){ const key=cx; const k='c'+cx; const arr=WORLD._world.get(k); if(!arr) return; let entry=chunkCanvases.get(key); if(!entry){
		// each cached chunk holds a full-height canvas (megabytes of pixels) — evict the
		// chunks farthest from the current view so a long trek can't accumulate them forever
		trimChunkCanvasCache(Number.isFinite(centerCx)?centerCx:cx, CHUNK_CANVAS_MAX_KEEP-1);
		const c=document.createElement('canvas'); c.width=CHUNK_W*TILE; c.height=WORLD_H*TILE; const cctx=c.getContext('2d'); cctx.imageSmoothingEnabled=false; entry={canvas:c,ctx:cctx,version:-1,chests:[]}; chunkCanvases.set(key,entry); }
	const currentVersion=WORLD.chunkVersion(cx); if(entry.version===currentVersion) return; const cctx=entry.ctx; cctx.clearRect(0,0,cctx.canvas.width,cctx.canvas.height); entry.chests=[];
		for(let lx=0; lx<CHUNK_W; lx++){
			const wx=cx*CHUNK_W+lx;
			const surf=WORLDGEN.surfaceHeight(wx);
			for(let y=0;y<WORLD_H;y++){
				const t=arr[y*CHUNK_W+lx];
				// TORCH renders as a sprite in the fire.js pass; GRAVE gets a headstone shape
				// below — both bake only their backdrop here
				const gasTile = isGasTileId(t);
				if(t===T.AIR || t===T.WATER || t===T.TORCH || t===T.GRAVE || t===T.WIRE || t===T.COPPER_WIRE || gasTile){
					// Water is rendered by the dynamic fluid layer (springs/waves/caustics), not
					// baked here — only its backdrop is. Underground air or water = carved cave /
					// aquifer: paint a dark rock backdrop so the sky parallax never shows through
					if(y>surf && !(gasTile && gasSkyExposedTile(wx,y))){
						const dd=Math.min(1,(y-surf)/45);
						const hv=hash32(wx,y); const jitter=((hv&15)-8)*0.6;
						const L=Math.max(6, 34-18*dd+jitter);
						cctx.fillStyle='rgb('+Math.round(L*0.92)+','+Math.round(L*0.86)+','+Math.round(L*1.18)+')';
						cctx.fillRect(lx*TILE,y*TILE,TILE,TILE);
					}
					if(t===T.GRAVE) drawGraveTile(cctx, lx*TILE, y*TILE);
					if(t===T.WIRE){
						const px=lx*TILE, py=y*TILE, h=hash32(wx,y);
						cctx.strokeStyle='rgba(219,126,51,0.92)';
						cctx.lineWidth=2;
						cctx.beginPath();
						cctx.moveTo(px+1, py+9+((h>>4)&2));
						cctx.bezierCurveTo(px+6, py+5+((h>>7)&3), px+13, py+13-((h>>10)&3), px+TILE-1, py+9+((h>>13)&2));
						cctx.stroke();
						cctx.strokeStyle='rgba(24,27,31,0.82)';
						cctx.lineWidth=1;
						cctx.beginPath();
						cctx.moveTo(px+2, py+12);
						cctx.lineTo(px+TILE-2, py+12-((h>>8)&3));
						cctx.stroke();
						cctx.fillStyle='rgba(255,202,110,0.85)';
						if((h&3)===0) cctx.fillRect(px+4+((h>>6)&8), py+7+((h>>11)&3), 2, 2);
					}
					if(t===T.COPPER_WIRE){
						const px=lx*TILE, py=y*TILE, h=hash32(wx,y);
						const peek=(qx,qy)=> (WORLD && WORLD.peekTile) ? WORLD.peekTile(qx,qy,T.AIR) : getTile(qx,qy);
						const conn=(TELEPORTERS && TELEPORTERS.cableConnections) ? TELEPORTERS.cableConnections(wx,y,peek) : {left:true,right:true,up:false,down:false};
						if(TELEPORTERS && TELEPORTERS.drawCableTile) TELEPORTERS.drawCableTile(cctx,TILE,px,py,conn,h);
					}
					continue;
				}
				let base=INFO[t].color; if(!base) continue;
				const h = hash32(wx,y);
				// Per-type amplitude (diamond fixed, stone/ice extra subtle, grass medium, others default)
				let amp=22; if(t===T.STONE) amp=6; else if(t===T.COAL) amp=5; else if(t===T.STEEL) amp=8; else if(t===T.DIAMOND) amp=0; else if(t===T.WOOD) amp=16; else if(t===T.GRASS) amp=18; else if(t===T.SNOW) amp=8; else if(t===T.ICE) amp=6; else if(t===T.OBSIDIAN) amp=10; else if(t===T.GLASS) amp=3; else if(t===T.ELECTRONICS || t===T.TRANSISTOR) amp=7; else if(t===T.SOLAR_PANEL || t===T.SOLAR_BATTERY) amp=3; else if(t===T.TELEPORTER) amp=5; else if(t===T.MEAT || t===T.ROTTEN_MEAT || t===T.BAKED_MEAT) amp=12; else if(INFO[t].chestTier) amp=4;
				const delta = ((h & 0xFF)/255 - 0.5)*amp; // symmetrical
				const col = amp? shadeColor(base, delta|0) : base; // stone uses low amp so should not drift green
				cctx.fillStyle=col; cctx.fillRect(lx*TILE,y*TILE,TILE,TILE);
				if(t===T.MEAT || t===T.ROTTEN_MEAT || t===T.BAKED_MEAT){
					drawMeatTile(cctx,lx*TILE,y*TILE,t===T.ROTTEN_MEAT?'rotten':(t===T.BAKED_MEAT?'baked':'fresh'),h);
				}
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
				// Snow-specific styling: soft top highlight and subtle dark rim for separation
				if(t===T.SNOW){
					// Top highlight band
					cctx.fillStyle='rgba(255,255,255,0.35)';
					cctx.fillRect(lx*TILE, y*TILE, TILE, Math.max(2, Math.floor(TILE*0.25)));
					// Bottom shadow for depth
					cctx.fillStyle='rgba(0,0,0,0.07)';
					cctx.fillRect(lx*TILE, y*TILE + TILE-2, TILE, 2);
					// Thin outline on left/right to separate from sky/ice
					cctx.fillStyle='rgba(0,0,0,0.08)';
					cctx.fillRect(lx*TILE, y*TILE, 1, TILE);
					cctx.fillRect(lx*TILE + TILE-1, y*TILE, 1, TILE);
				}
				// Ice reads glossy, not grainy: cool depth shade below, bright crown,
				// and a deterministic diagonal glint pair (snow stays matte for contrast)
				if(t===T.ICE){
					cctx.fillStyle='rgba(40,90,160,0.16)';
					cctx.fillRect(lx*TILE, y*TILE+TILE-3, TILE, 3);
					cctx.fillStyle='rgba(255,255,255,0.30)';
					cctx.fillRect(lx*TILE, y*TILE, TILE, 2);
					const gx=lx*TILE+3+((h>>5)&7), gy=y*TILE+4;
					cctx.strokeStyle='rgba(255,255,255,0.30)'; cctx.lineWidth=1.5;
					cctx.beginPath(); cctx.moveTo(gx, gy+9); cctx.lineTo(gx+8, gy); cctx.stroke();
					cctx.strokeStyle='rgba(140,195,235,0.35)'; cctx.lineWidth=1;
					cctx.beginPath(); cctx.moveTo(gx-2, gy+12); cctx.lineTo(gx+4, gy+5); cctx.stroke();
				}
				// Obsidian: volcanic glass — faint violet crown sheen + a rare glint pixel
				if(t===T.OBSIDIAN){
					cctx.fillStyle='rgba(150,110,220,0.12)';
					cctx.fillRect(lx*TILE, y*TILE, TILE, 2);
					if((h&7)===0){
						cctx.fillStyle='rgba(190,150,255,0.45)';
						cctx.fillRect(lx*TILE+3+((h>>6)&13), y*TILE+4+((h>>10)&11), 2, 2);
					}
				}
				if(t===T.COAL){
					cctx.fillStyle='rgba(0,0,0,0.28)';
					cctx.fillRect(lx*TILE, y*TILE+TILE-4, TILE, 4);
					cctx.fillStyle='rgba(255,255,255,0.10)';
					cctx.fillRect(lx*TILE+2+((h>>3)&5), y*TILE+3+((h>>8)&4), 3, 2);
					if((h&3)===0){
						cctx.fillStyle='rgba(180,190,198,0.28)';
						cctx.fillRect(lx*TILE+6+((h>>6)&8), y*TILE+8+((h>>11)&5), 2, 2);
					}
				}
				if(t===T.STEEL){
					cctx.fillStyle='rgba(255,255,255,0.20)';
					cctx.fillRect(lx*TILE, y*TILE, TILE, 2);
					cctx.fillStyle='rgba(15,22,30,0.18)';
					cctx.fillRect(lx*TILE, y*TILE+TILE-3, TILE, 3);
					cctx.fillStyle='rgba(0,0,0,0.22)';
					cctx.fillRect(lx*TILE+((h>>8)&3), y*TILE, 2, TILE);
					cctx.fillStyle='rgba(230,245,255,0.55)';
					cctx.fillRect(lx*TILE+4+((h>>4)&9), y*TILE+5+((h>>9)&7), 2, 2);
					cctx.fillStyle='rgba(30,38,48,0.35)';
					cctx.fillRect(lx*TILE+3, y*TILE+4, 2, 2);
					cctx.fillRect(lx*TILE+TILE-5, y*TILE+TILE-6, 2, 2);
				}
				// Chest highlight & tier flair
				if(t===T.CHEST_COMMON||t===T.CHEST_RARE||t===T.CHEST_EPIC){
					entry.chests.push({x:wx,y,t});
					drawChestTile(cctx,lx*TILE,y*TILE,t,h);
				}
				if(t===T.STONE || t===T.WOOD){ cctx.fillStyle='rgba(0,0,0,0.05)'; cctx.fillRect(lx*TILE + ((h>>8)&3), y*TILE, 2, TILE); }
			}
		}
	entry.version=currentVersion; }
function drawWorldVisible(sx,sy,viewX,viewY){ const minChunk=Math.floor(sx/CHUNK_W)-1; const maxChunk=Math.floor((sx+viewX+2)/CHUNK_W)+1; const centerChunk=Math.floor((sx+viewX*0.5)/CHUNK_W); // prepare caches
	const visibleChunkCount=maxChunk-minChunk+1;
	const visibleChunks=[];
	for(let cx=minChunk; cx<=maxChunk; cx++){ WORLD.ensureChunk(cx); drawChunkToCache(cx,centerChunk); }
	for(let cx=minChunk; cx<=maxChunk; cx++) visibleChunks.push(cx);
	if(FALLING && FALLING.auditChunks) FALLING.auditChunks(visibleChunks);
	trimChunkCanvasCache(centerChunk, visibleChunkCount+6);
	// Draw whole chunks that intersect view (avoids per-tile seams)
	const viewPX0 = sx*TILE, viewPX1=(sx+viewX+2)*TILE;
	for(let cx=minChunk; cx<=maxChunk; cx++){
		const entry=chunkCanvases.get(cx); if(!entry) continue; const chunkXpx = cx*CHUNK_W*TILE;
		const chunkRight = chunkXpx + CHUNK_W*TILE; if(chunkRight < viewPX0-CHUNK_W*TILE || chunkXpx > viewPX1+CHUNK_W*TILE) continue;
		ctx.drawImage(entry.canvas, chunkXpx, 0);
	}
		// Chest aura second pass (not cached) for pulsing glow
		const nowA=performance.now();
		const y0=sy, y1=sy+viewY+2;
		for(let cx2=minChunk; cx2<=maxChunk; cx2++){
			const entry=chunkCanvases.get(cx2);
			const chests=entry && Array.isArray(entry.chests) ? entry.chests : [];
			for(const ch of chests){
				const wx=ch.x, y=ch.y, t=ch.t;
				if(y<y0 || y>=y1) continue;
				if(!chestDebug && !worldFxVisible(wx,y)) continue;
				const pulse=Math.sin(nowA*0.004 + wx*0.7 + y*0.3)*0.5+0.5;
				const rad=TILE*0.6 + pulse*TILE*0.25;
				const cxp=wx*TILE+TILE/2;
				const cyp=y*TILE+TILE/2;
				const g=ctx.createRadialGradient(cxp,cyp,rad*0.2,cxp,cyp,rad);
				const col = t===T.CHEST_EPIC? 'rgba(224,179,65,' : (t===T.CHEST_RARE? 'rgba(167,76,201,' : 'rgba(176,127,44,');
				g.addColorStop(0,col+(0.45+0.35*pulse)+(chestDebug?0.15:0)+')');
				g.addColorStop(1,col+'0)');
				ctx.fillStyle=g;
				ctx.beginPath();
				ctx.arc(cxp,cyp,rad*(chestDebug?1.15:1),0,Math.PI*2);
				ctx.fill();
				if(chestDebug){ ctx.strokeStyle='#fff'; ctx.lineWidth=1; ctx.strokeRect(wx*TILE+1,y*TILE+1,TILE-2,TILE-2); }
			}
		}
		if(chestDebug){ const pcx=Math.floor(player.x/CHUNK_W); const cnt=countChestsAround(pcx,4); ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(sx*TILE+6, sy*TILE+6, 140,24); ctx.fillStyle='#fff'; ctx.font='14px system-ui'; ctx.fillText('Skrzynie ±4: '+cnt, sx*TILE+12, sy*TILE+24); }
	if(VISUAL.animations && GRASS && GRASS.drawOverlays){ GRASS.drawOverlays(ctx,'back', sx,sy,viewX,viewY,TILE,WORLD_H,getTile,T,zoom,grassDensityScalar,grassHeightScalar,worldFxVisible); }
}

function drawFogOverlay(sx,sy,viewX,viewY){
	if(FOG && FOG.applyOverlay){
		FOG.applyOverlay(ctx, sx, sy, viewX, viewY, TILE, getTile, T, {showMemory: visionRemembersMap()});
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
	if(ty<0 || ty>=WORLD_H) return false;
	const px=Math.floor(player.x), py=Math.floor(player.y);
	const los=(FOG && (FOG.hasLineOfSight || FOG._hasLineOfSight)) || null;
	const rayClear = typeof los==='function' ? los(px,py,tx,ty,getTile,(t)=>isSolid(t)) : fallbackLineOfSight(px,py,tx,ty);
	return rayClear && targetFaceExposedToPlayer(tx,ty);
}
function blockedTargetReason(tx,ty){
	return canPhysicallyTargetTile(tx,ty) ? null : 'Zasłonięte';
}

// Input + tryby specjalne
const keys={}; let godMode=false; const keysOnce=new Set();
let fireBtnHeld=false; // declared with the other input state — the blur handler below references it
let paused=false;      // B toggles; the loop keeps drawing but freezes the simulation
let showMinimap=true;  // N toggles the cross-section minimap
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
function toggleMap(){ const on = (FOG && FOG.toggleRevealAll)? FOG.toggleRevealAll(): false; if(MM.ui && MM.ui.updateMapButton) MM.ui.updateMapButton(on); msg('Mapa '+(on?'ON':'OFF')); }
function centerCam(){ camSX=player.x - (W/(TILE*zoom))/2; camSY=player.y - (H/(TILE*zoom))/2; camX=camSX; camY=camSY; msg('Wyśrodkowano'); }
function toggleHelp(){ const h=document.getElementById('help'); const show=h.style.display!=='block'; h.style.display=show?'block':'none'; document.getElementById('helpBtn').setAttribute('aria-expanded', String(show)); }
// Keyboard events targeting editable controls (seed input, sliders, selects) must not drive the game
function isEditableTarget(t){ if(!t || !t.tagName) return false; const tag=t.tagName; return tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||t.isContentEditable; }
function activeWeaponItem(){ const INV=MM.inventory; return (INV && INV.equippedItem)? INV.equippedItem('weapon'):null; }
function isToolMode(){ return !activeWeaponItem(); }
// --- Weapon shortcuts (keys 1..4) ---
// 1: build/destroy mode — holsters the weapon; pressed again it cycles owned pickaxes.
// 2/3/4: cycle the weapons of the matching MM.inventory.WEAPON_CATEGORIES entry
// (which weapons take part is chosen per item in the inventory panel).
const PICK_ORDER=['basic','stone','diamond'];
const PICK_LABELS={basic:'podstawowy', stone:'kamienny', diamond:'diamentowy'};
function ownedPicks(){ return PICK_ORDER.filter(t=>t==='basic'||inv.tools[t]); }
function selectWeaponKey(key){
	const INV=MM.inventory;
	if(key==='1'){
		weaponPointerId=null;
		const hadWeapon=!!(INV && INV.equippedId && INV.equippedId('weapon'));
		if(hadWeapon){ INV.unequip('weapon'); }
		else { const owned=ownedPicks(); const i=owned.indexOf(player.tool); player.tool=owned[(i+1)%owned.length]; }
		msg('⛏ Kilof '+(PICK_LABELS[player.tool]||player.tool)+(hadWeapon?' — broń schowana':''));
		updateInventory(); updateWeaponBar();
		return;
	}
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
function updateWeaponBar(){
	const bar=document.getElementById('weaponBar'); if(!bar) return;
	const INV=MM.inventory;
	const it=activeWeaponItem();
	const cat=(it && INV.weaponCategory)? INV.weaponCategory(it):null;
	const activeKey= cat? cat.key : (it? null : '1'); // uncategorised weapon → nothing lit
	bar.querySelectorAll('.wepSlot').forEach(el=>{
		const k=el.getAttribute('data-wkey');
		el.classList.toggle('sel', k===activeKey);
		const nm=el.querySelector('.wname');
		if(!nm) return;
		if(k==='1'){ nm.textContent=PICK_LABELS[player.tool]||player.tool; el.classList.remove('empty'); return; }
		const c=(INV && INV.WEAPON_CATEGORIES||[]).find(x=>x.key===k);
		const list=(c && INV.categoryWeapons)? INV.categoryWeapons(c.id):[];
		const preview=(cat && cat.key===k)? it : list[0];
		nm.textContent= preview? (preview.name||preview.id) : '—';
		el.classList.toggle('empty', !list.length);
	});
}
document.querySelectorAll('#weaponBar .wepSlot').forEach(el=>{
	el.addEventListener('click',()=>selectWeaponKey(el.getAttribute('data-wkey')));
});
window.addEventListener('mm-customization-change',updateWeaponBar);
window.addEventListener('keydown',e=>{ if(isEditableTarget(e.target)) return; noteSaveActivity(); const k=e.key.toLowerCase(); keys[k]=true; if(k==='escape'){ closeHotSelect(); }
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
	if(k==='p'&&!keysOnce.has('p')){ chestDebug=!chestDebug; msg('Chest debug '+(chestDebug?'ON':'OFF')); keysOnce.add('p'); }
	if(k==='j'&&!keysOnce.has('j')){ keysOnce.add('j'); const pcx=Math.floor(player.x/CHUNK_W); msg('Skrzynie w pobliżu: '+countChestsAround(pcx,4)); }
	if(k==='k'&&!keysOnce.has('k')){ // force spawn a chest at feet (cycle tiers)
		keysOnce.add('k'); const px=Math.floor(player.x); const py=Math.floor(player.y)-1; const tiers=[T.CHEST_COMMON,T.CHEST_RARE,T.CHEST_EPIC]; const cur=getTile(px,py); if(cur===T.AIR){ const idx=Math.floor(performance.now()/1000)%tiers.length; setTile(px,py,tiers[idx]); msg('Debug: wstawiono skrzynię '+(idx===2?'epicką':idx===1?'rzadką':'zwykłą')); } }
	// Debug chest placement (L)
	if(k==='l'&&!keysOnce.has('l')){ keysOnce.add('l'); const px=Math.floor(player.x); const py=Math.floor(player.y); const below=py; if(getTile(px,below)===T.AIR){ const r=Math.random(); let cid=T.CHEST_COMMON; if(r>0.9) cid=T.CHEST_RARE; if(r>0.97) cid=T.CHEST_EPIC; setTile(px,below,cid); msg('Postawiono skrzynię ('+(cid===T.CHEST_EPIC?'epicka':cid===T.CHEST_RARE?'rzadka':'zwykła')+')'); } }
	if(k==='m'&&!keysOnce.has('m')){ toggleMap(); keysOnce.add('m'); }
	if(k==='c'&&!keysOnce.has('c')){ centerCam(); keysOnce.add('c'); }
	if(k==='r'&&!keysOnce.has('r') && selectedTileId()===T.DYNAMO){ toggleDynamoOrientation(); keysOnce.add('r'); e.preventDefault(); }
	if(k==='h'&&!keysOnce.has('h')){ toggleHelp(); keysOnce.add('h'); }
	if(k==='v'&&!keysOnce.has('v')){ window.__mobDebug = !window.__mobDebug; msg('Mob debug '+(window.__mobDebug?'ON':'OFF')); keysOnce.add('v'); }
	if(k==='o'&&!keysOnce.has('o')){ keysOnce.add('o'); if(VOLCANO && VOLCANO.forceMasterEruption) VOLCANO.forceMasterEruption(); }
	if(k==='b'&&!keysOnce.has('b')){ paused=!paused; keysOnce.add('b'); }
	if(k==='n'&&!keysOnce.has('n')){ showMinimap=!showMinimap; msg('Minimapa '+(showMinimap?'ON':'OFF')); keysOnce.add('n'); }
	if(['arrowup','arrowdown','w',' '].includes(k)) e.preventDefault(); });
window.addEventListener('keyup',e=>{ noteSaveActivity(); const k=e.key.toLowerCase(); keys[k]=false; keysOnce.delete(k); });
// Losing focus while keys are held would leave the player running forever — release everything
window.addEventListener('blur',()=>{ for(const k in keys) keys[k]=false; keysOnce.clear(); stopMining(); minePointerId=null; weaponPointerId=null; mineBtnHeld=false; fireBtnHeld=false; activePointers.clear(); pinch=null; });

// Kierunek kopania
let mineDir={dx:1,dy:0}; document.querySelectorAll('.dirbtn').forEach(b=>{ b.addEventListener('click',()=>{ noteSaveActivity(); mineDir.dx=+b.getAttribute('data-dx'); mineDir.dy=+b.getAttribute('data-dy'); document.querySelectorAll('.dirbtn').forEach(o=>o.classList.remove('sel')); b.classList.add('sel'); }); }); document.querySelector('.dirbtn[data-dx="1"][data-dy="0"]').classList.add('sel');

// Pad dotykowy
function bindPad(){ document.querySelectorAll('#pad .btn').forEach(btn=>{ const code=btn.getAttribute('data-key'); if(!code) return; btn.addEventListener('pointerdown',ev=>{ ev.preventDefault(); noteSaveActivity(); keys[code.toLowerCase()]=true; btn.classList.add('on'); if(code==='ArrowUp') keys['w']=true; }); ['pointerup','pointerleave','pointercancel'].forEach(evName=> btn.addEventListener(evName,()=>{ noteSaveActivity(); keys[code.toLowerCase()]=false; btn.classList.remove('on'); if(code==='ArrowUp') keys['w']=false; })); }); } bindPad();

// Kamera
let camX=0,camY=0,camSX=0,camSY=0; let zoom=1, zoomTarget=1; function ensureChunks(){ const pcx=Math.floor(player.x/CHUNK_W); for(let d=-2; d<=2; d++) ensureChunk(pcx+d); }
function clampZoom(z){ return Math.min(3, Math.max(0.5, z)); }
function setZoom(z){ zoomTarget = clampZoom(z); }
function nudgeZoom(f){ setZoom(zoomTarget * f); }
canvas.addEventListener('wheel',e=>{ noteSaveActivity(); if(e.ctrlKey){ // let browser zoom work
	return; }
	e.preventDefault(); const dir = e.deltaY>0?1:-1; const factor = dir>0? 1/1.1 : 1.1; nudgeZoom(factor);
},{passive:false});
window.addEventListener('keydown',e=>{ if(isEditableTarget(e.target)) return; noteSaveActivity(); if(e.key==='+'||e.key==='='||e.key===']'){ nudgeZoom(1.1); }
	if(e.key==='-'||e.key==='['){ nudgeZoom(1/1.1); }
});

// Fizyka
// Movement constants imported from canonical constants module
let jumpPrev=false; let swimBuoySmooth=0; let wasInWater=false; let bubbleAcc=0; let swimWakeAcc=0;
const drowningState = SURVIVAL && SURVIVAL.createDrowningState ? SURVIVAL.createDrowningState() : {airless:0, damageAcc:0, warned:false};
// Jump feel: a press is buffered for a short window instead of being consumed on
// the exact frame it arrives (presses used to die silently on micro-airborne
// frames over rough terrain → "I have to press jump twice"). Coyote time keeps a
// ground jump valid just after stepping off a ledge. swimLeapT marks a recent
// water-surface leap so the swim speed clamp doesn't strangle it.
const JUMP_BUFFER=0.12, COYOTE_TIME=0.1;
let jumpBufferT=0, coyoteT=0, swimLeapT=0;
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
function updateHeroEnergy(dt){
	if(!(dt>0) || !isFinite(dt)) return;
	if(!player.maxEnergy) applyHeroEnergyCapacity();
	let charged=0, got=null;
	const max=player.maxEnergy||heroEnergyCapacity();
	if(DYNAMO && typeof DYNAMO.absorbNear==='function' && (player.energy||0)<max-0.02){
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
	if(charged<=0) energyFxEmitT=Math.max(0,energyFxEmitT-dt);
	if(energyChargeFx.t>0){
		energyChargeFx.t=Math.max(0, energyChargeFx.t-dt);
		energyChargeFx.intensity=Math.max(0, (energyChargeFx.intensity||0)-dt*1.6);
		if(energyChargeFx.t<=0) energyChargeFx.source=null;
	}
}
function physics(dt){
	// Horizontal input
	let input=0; if(keys['a']||keys['arrowleft']) input-=1; if(keys['d']||keys['arrowright']) input+=1; if(input!==0) player.facing=input;
	// Combine all movement multipliers, including dropdown.
	// Ground material affects traction: mud slows, snow slides, ice slides hard.
	const moveMult = ((MM.activeModifiers && MM.activeModifiers.moveSpeedMult)||1) * (window.playerSpeedMultiplier || 2);
	player.vx = applyHorizontalMovement(player.vx, input, dt, moveMult, MOVE, groundTileUnderPlayer());

	// Submersion sampling (5 points along body) with fractional sampling for smoother transitions
	const samples=5; let submerged=0; const headY=player.y - player.h/2; const footY=player.y + player.h/2; const step=(footY-headY)/(samples-1); const tileX=Math.floor(player.x);
	for(let i=0;i<samples;i++){
		const sy=headY + step*i; const ty=Math.floor(sy); const tId=getTile(tileX,ty); if(tId===T.WATER){
			// weight sample by how deep inside tile (reduces jumpiness when crossing boundary)
			const fracInside = 1 - (sy - ty); submerged += 0.5 + 0.5*fracInside; // 0.5..1 weighting
		}
	}
	const subFracRaw = submerged / samples; // can exceed 1 slightly; clamp below
	const subFrac = Math.min(1, subFracRaw);
	const inWater = subFrac>0.05; // tiny contact ignored
	// Lava sears: standing in it hurts and flings the hero upward (central handler)
	if(getTile(tileX, Math.floor(player.y))===T.LAVA || getTile(tileX, Math.floor(player.y+player.h/2-0.05))===T.LAVA){
		if(window.damageHero(8, {cause:'lava', launch:-7}) && player.hp>0) msg('🔥 Lawa parzy!');
	}
	if(SURVIVAL && SURVIVAL.updateDrowning){
		const headCovered = getTile(tileX, Math.floor(headY))===T.WATER && subFrac>0.88;
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
	const diveInput = keys['s']||keys['arrowdown'];
	const jumpNow=(keys['w']||keys['arrowup']||keys[' ']);
	const swimUpInput = jumpNow && !diveInput;

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
	if(WIND && WIND.applyToHero) WIND.applyToHero(player,dt,getTile,{inWater,godMode});
	// Buffer the press (rising edge) and tick the assist timers
	if(jumpNow && !jumpPrev) jumpBufferT=JUMP_BUFFER; else if(jumpBufferT>0) jumpBufferT=Math.max(0, jumpBufferT-dt);
	if(player.onGround) coyoteT=COYOTE_TIME; else if(coyoteT>0) coyoteT=Math.max(0, coyoteT-dt);
	if(swimLeapT>0) swimLeapT=Math.max(0, swimLeapT-dt);
	if(jumpBufferT>0){
		const maxAir = (MM.activeModifiers && typeof MM.activeModifiers.maxAirJumps==='number')? MM.activeModifiers.maxAirJumps : 0; // additional beyond ground jump
		const totalAllowed = 1 + maxAir; // total sequential presses allowed while airborne
		const jumpMult = ((MM.activeModifiers && MM.activeModifiers.jumpPowerMult)||1) * (window.playerSpeedMultiplier || 2);
		if(player.onGround || godMode || (!inWater && coyoteT>0 && player.jumpCount===0)){ // primary jump (incl. coyote window after a ledge)
			player.vy=MOVE.JUMP * jumpMult; player.onGround=false; player.jumpCount=1; jumpBufferT=0; coyoteT=0;
		}
		else if(!inWater && player.jumpCount>0 && player.jumpCount < totalAllowed){
			// mid-air extra jump
			player.vy=MOVE.JUMP * jumpMult; player.jumpCount++; jumpBufferT=0;
		}
		else if(inWater){
			const headTileJ=getTile(tileX, Math.floor(headY));
			const aboveHeadJ=getTile(tileX, Math.floor(headY)-1);
			const nearSurface = headTileJ!==T.WATER || aboveHeadJ===T.AIR || subFrac<0.7;
			if(nearSurface && !diveInput){
				// Surface leap: near-full jump so climbing out of water onto a bank works
				player.vy=MOVE.JUMP * jumpMult * 0.95; player.jumpCount=1; swimLeapT=0.3; jumpBufferT=0;
			} else { // deep underwater: gentle swim kick (does not consume jump charges)
				player.vy = Math.min(player.vy,0);
				player.vy += MOVE.JUMP * 0.32 * (0.6 + 0.4*subFrac) * jumpMult;
				jumpBufferT=0;
			}
		}
		// otherwise: keep the press buffered — landing within the window fires the jump
	}
	jumpPrev=jumpNow;

	if(inWater){
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
			// Gentle positional bob (two layered waves)
			const bob = Math.sin(time*0.002 + player.x*0.42)*0.55 + Math.sin(time*0.00085 + player.x*0.18)*0.28;
			player.y += bob/(TILE*75);
		}
		// Clamp speeds (tighter downward, allow brisk upward correction).
		// A fresh surface leap keeps its full speed — clamping it to 9 strangled
		// the jump to half strength and made exiting water nearly impossible.
		const maxDown=swimUpInput?2.0:2.8, maxUp=swimUpInput?10.5:9.0; if(player.vy>maxDown) player.vy=maxDown; if(player.vy<-maxUp && swimLeapT<=0) player.vy=-maxUp;
	} else {
		// Normal gravity when not in water
		const gravMult = (window.playerSpeedMultiplier || 2);
		player.vy += MOVE.GRAV*gravMult*dt; if(player.vy>20*gravMult) player.vy=20*gravMult; swimBuoySmooth=0; // reset filter
	}

	// Integrate & collisions — substepped so high speed multipliers / low FPS cannot tunnel through tiles
	{
		const maxDisp=Math.max(Math.abs(player.vx),Math.abs(player.vy))*dt;
		const steps=Math.min(12, Math.max(1, Math.ceil(maxDisp/0.4)));
		const sdt=dt/steps;
		for(let i=0;i<steps;i++){
			player.x += player.vx*sdt; collide('x');
			player.y += player.vy*sdt; collide('y');
			if(player.vx===0 && player.vy===0) break;
		}
	}
	// Boss monsters are rigid: the hero lands on, stands on and is pushed by them
	try{ if(BOSSES && BOSSES.collideHero) BOSSES.collideHero(player, dt); }catch(e){}

	// Camera follow
	const tX=player.x - (W/(TILE*zoom))/2 + player.w/2; const tY=player.y - (H/(TILE*zoom))/2 + player.h/2; camSX += (tX-camSX)*Math.min(1,dt*8); camSY += (tY-camSY)*Math.min(1,dt*8); camX=camSX; camY=camSY; ensureChunks(); revealAround(); }
// Tiles below the world bottom act as bedrock so a mined-out bottom row can't drop the player into the void
function solidAt(x,y){ if(y>=WORLD_H) return true; return isSolid(getTile(x,y)); }
function collide(axis){
	const w=player.w/2, h=player.h/2;
	if(axis==='x'){
		const minX=Math.floor(player.x-w), maxX=Math.floor(player.x+w), minY=Math.floor(player.y-h), maxY=Math.floor(player.y+h);
		// Resolve against the least-penetrating tile only; applying every tile in scan
		// order could push the player out one side and back into a neighbour.
		let target=player.x, hit=false;
		for(let y=minY;y<=maxY;y++){
			for(let x=minX;x<=maxX;x++){
				if(!solidAt(x,y)) continue;
				if(player.vx>0){ const cand=x - w - 0.001; if(!hit || cand<target) target=cand; hit=true; }
				else if(player.vx<0){ const cand=x + 1 + w + 0.001; if(!hit || cand>target) target=cand; hit=true; }
			}
		}
		if(hit){ player.x=target; player.vx=0; }
	} else {
		const minX=Math.floor(player.x-w), maxX=Math.floor(player.x+w), minY=Math.floor(player.y-h), maxY=Math.floor(player.y+h);
		const wasGround=player.onGround;
		player.onGround=false;
		let target=player.y, hit=false, landed=false;
		for(let y=minY;y<=maxY;y++){
			for(let x=minX;x<=maxX;x++){
				if(!solidAt(x,y)) continue;
				if(player.vy>0){ const cand=y - h - 0.001; if(!hit || cand<target) target=cand; hit=true; landed=true; }
				else if(player.vy<0){ const cand=y + 1 + h + 0.001; if(!hit || cand>target) target=cand; hit=true; }
			}
		}
		if(hit){ player.y=target; player.vy=0; if(landed) player.onGround=true; }
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
	if(p.ty<0) return {key:'sky:'+p.tx+','+p.ty,label:'Niebo',color:'#8bbff5'};
	if(p.ty>=WORLD_H) return {key:'bottom:'+p.tx+','+p.ty,label:'Dno swiata',color:'#343944'};
	const t=getTile(p.tx,p.ty);
	const surface=(WORLDGEN && WORLDGEN.surfaceHeight)? WORLDGEN.surfaceHeight(p.tx) : -1;
	const hidden=!fogRevealAll() && !worldTileDiscovered(p.tx,p.ty) && (t!==T.AIR || p.ty>surface);
	if(hidden) return {key:'hidden:'+p.tx+','+p.ty,label:'Nieodkryte',color:'#2d3744'};
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
// Multi-touch bookkeeping: pointers currently down on the canvas (for pinch zoom)
const activePointers=new Map(); let pinch=null;

// Kopanie (kierunkowe + wskazywane kursorem)
const MINE_REACH=3; // Chebyshev tile distance for cursor mining (matches attack range)
let mining=false,mineTimer=0,mineTx=0,mineTy=0; const mineBtn=document.getElementById('mineBtn');
let minePointerId=null;   // pointer that initiated cursor mining (left button / touch on canvas)
let weaponPointerId=null; // pointer that is holding normal weapon fire on the canvas
let mineBtnHeld=false;    // dedicated ⛏️ button held → keep mining in selected direction
function stopMining(){ mining=false; mineBtn.classList.remove('on'); }
function withinReach(tx,ty,reach){ const px=Math.floor(player.x), py=Math.floor(player.y); return Math.abs(tx-px)<=reach && Math.abs(ty-py)<=reach; }
// Opening chests is shared between click handling and directional mining so the ⛏️
// button can never silently destroy a chest together with its loot.
function tryOpenChestAt(tx,ty){
	const info=INFO[getTile(tx,ty)];
	if(!info || !info.chestTier || !CHESTS) return false;
	const res=CHESTS.openChestAt(tx,ty);
	if(res){
		try{ if(MM.audio && MM.audio.play) MM.audio.play('chest'); }catch(e){}
		lastChestOpen={t:performance.now(),x:tx,y:ty};
		res.items.forEach(it=>{ it._inbox=true; });
		if(window.lootInbox){ window.lootInbox.push(...res.items); if(window.updateLootInboxIndicator) window.updateLootInboxIndicator(); }
		msg('Skrzynia '+info.chestTier+': +'+res.items.length+' przedm. (I aby zobaczyć)');
		spawnBurst((tx+0.5)*TILE,(ty+0.5)*TILE, info.chestTier);
		if(window.updateDynamicCustomization) window.updateDynamicCustomization();
	}
	return !!res;
}
// Begin mining a specific tile (cursor-driven). Returns true when mining started.
function startMineAt(tx,ty,opts){
	const quiet=opts&&opts.quiet;
	if(!isToolMode()) return false;
	if(!withinReach(tx,ty,MINE_REACH)){ if(!quiet) msg('Za daleko'); return false; }
	const t=getTile(tx,ty);
	if(t===T.AIR || isGasTileId(t)) return false;
	const blocked=blockedTargetReason(tx,ty);
	if(blocked){ if(!quiet) msg(blocked); return false; }
	if(INFO[t] && INFO[t].chestTier){ if(quiet) return false; return tryOpenChestAt(tx,ty); }
	mining=true; mineTimer=0; mineTx=tx; mineTy=ty; mineBtn.classList.add('on');
	if(godMode) instantBreak();
	return true;
}
function startMine(opts){
	const quiet=opts&&opts.quiet;
	if(!isToolMode()){ if(!quiet) msg('Wybierz 1, aby kopać'); return; }
	const tx=Math.floor(player.x + mineDir.dx + (mineDir.dx>0?player.w/2:mineDir.dx<0?-player.w/2:0));
	const ty=Math.floor(player.y + mineDir.dy);
	const t=getTile(tx,ty);
	if(t===T.AIR || isGasTileId(t)) return;
	const blocked=blockedTargetReason(tx,ty);
	if(blocked){ if(!quiet) msg(blocked); return; }
	if(INFO[t] && INFO[t].chestTier){ tryOpenChestAt(tx,ty); return; }
	mining=true; mineTimer=0; mineTx=tx; mineTy=ty; mineBtn.classList.add('on');
	if(godMode) instantBreak();
}
mineBtn.addEventListener('pointerdown',e=>{ e.preventDefault(); noteSaveActivity(); if(!isToolMode()){ msg('Wybierz 1, aby kopać'); return; } mineBtnHeld=true; startMine(); });
['pointerup','pointerleave','pointercancel'].forEach(evName=> mineBtn.addEventListener(evName,()=>{ noteSaveActivity(); mineBtnHeld=false; stopMining(); }));
// Weapon fire button (touch): hold to use the equipped weapon in the facing direction
const fireBtn=document.getElementById('fireBtn');
if(fireBtn){
	fireBtn.addEventListener('pointerdown',e=>{ e.preventDefault(); noteSaveActivity(); if(!activeWeaponItem()){ msg('Wybierz broń klawiszem 2–4'); return; } fireBtnHeld=true; fireBtn.classList.add('on'); });
	['pointerup','pointerleave','pointercancel'].forEach(evName=> fireBtn.addEventListener(evName,()=>{ noteSaveActivity(); fireBtnHeld=false; fireBtn.classList.remove('on'); }));
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
// Only the pointer that started cursor mining may stop it — releasing another finger
// (e.g. a movement button on the touch pad) must not cancel digging.
window.addEventListener('pointerup',e=>{ noteSaveActivity(); activePointers.delete(e.pointerId); if(activePointers.size<2) pinch=null; if(e.pointerId===weaponPointerId) weaponPointerId=null; if(e.pointerId===minePointerId){ minePointerId=null; if(!mineBtnHeld) stopMining(); } });
window.addEventListener('pointercancel',e=>{ noteSaveActivity(); activePointers.delete(e.pointerId); if(activePointers.size<2) pinch=null; if(e.pointerId===weaponPointerId) weaponPointerId=null; if(e.pointerId===minePointerId){ minePointerId=null; if(!mineBtnHeld) stopMining(); } });
function awardTileDrops(info){
	const awarded=[];
	const add=(key,n)=>{
		const amount=Math.max(0,n|0);
		if(!key || amount<=0) return;
		inv[key]=(inv[key]||0)+amount;
		awarded.push({key,n:amount});
	};
	if(!info) return awarded;
	if(info.drop) add(info.drop,1);
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
function breakMinedTile(){
	if(!canPhysicallyTargetTile(mineTx,mineTy)) return false;
	const tId=getTile(mineTx,mineTy);
	const info=INFO[tId];
	if(!info) return false;
	if(info.gas) return false;
	if(tId===T.DYNAMO || tId===T.DYNAMO_SLOT) return dismantleDynamoAt(mineTx,mineTy);
	setTile(mineTx,mineTy,T.AIR);
	if(FIRE && FIRE.wakeLavaAround) FIRE.wakeLavaAround(mineTx,mineTy,getTile,{radius:22});
	const drops=awardTileDrops(info);
	if(tId===T.WOOD) startTreeFall(mineTx,mineTy-1);
	if(FALLING && FALLING.onTileRemoved) FALLING.onTileRemoved(mineTx,mineTy);
	if(WATER && WATER.onTileChanged) WATER.onTileChanged(mineTx,mineTy,getTile);
	pushUndo(mineTx,mineTy,tId,T.AIR,'break',drops);
	updateInventory();
	return true;
}
function instantBreak(){ if(getTile(mineTx,mineTy)===T.AIR){ mining=false; mineBtn.classList.remove('on'); return; } if(breakMinedTile()){ mining=false; mineBtn.classList.remove('on'); } }
// Falling tree system (per-block physics)
function startTreeFall(bx,by){ return TREES.startTreeFall(getTile,setTile,player.facing,bx,by); }
function updateFallingBlocks(dt){
	const viewX=Math.ceil(W/(TILE*zoom));
	const viewY=Math.ceil(H/(TILE*zoom));
	const sx=Math.floor(camX)-1;
	const sy=Math.floor(camY)-1;
	TREES.updateFallingBlocks(getTile,setTile,dt,{sx,sy,viewX,viewY});
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
	if(getTile(mineTx,mineTy)===T.AIR || isGasTileId(getTile(mineTx,mineTy))){ stopMining(); resumeHeldMining(); if(!mining) return; }
	if(!canPhysicallyTargetTile(mineTx,mineTy)){ stopMining(); resumeHeldMining(); if(!mining) return; }
	if(godMode){ instantBreak(); return; }
	try{ if(MM.audio && MM.audio.play) MM.audio.play('dig'); }catch(e){}
	// Drag mining: if the held cursor moved to a different tile, re-target immediately
	if(minePointerId!=null && !mineBtnHeld && lastPointer.has){
		const p=screenToWorldTile(lastPointer.x,lastPointer.y);
		if((p.tx!==mineTx||p.ty!==mineTy) && withinReach(p.tx,p.ty,MINE_REACH) && canPhysicallyTargetTile(p.tx,p.ty) && getTile(p.tx,p.ty)!==T.AIR && !isGasTileId(getTile(p.tx,p.ty)) && !(INFO[getTile(p.tx,p.ty)]&&INFO[getTile(p.tx,p.ty)].chestTier)){ mineTx=p.tx; mineTy=p.ty; mineTimer=0; }
	}
	const mineMult=(MM.activeModifiers && MM.activeModifiers.mineSpeedMult)||1; mineTimer += dt * tools[player.tool] * mineMult; const curId=getTile(mineTx,mineTy); const info=INFO[curId]; const need=Math.max(0.1, info.hp/6); if(mineTimer>=need && breakMinedTile()){ stopMining(); try{ if(MM.audio && MM.audio.play) MM.audio.play('break'); }catch(e){} resumeHeldMining(); } }

// --- Placement ---
// Suppress accidental placement immediately after opening a chest with right-click
let lastChestOpen={t:0,x:0,y:0};
const CHEST_PLACE_SUPPRESS_MS=250; // extended to reduce accidental placements
const PLACE_REACH=5; // build reach in tiles (Chebyshev); god mode is unlimited
let lastRightPlaceT=0; // right-button pointerdown already placed for this gesture (contextmenu dedupe)
canvas.addEventListener('contextmenu',e=>{ e.preventDefault(); noteSaveActivity(); const now=performance.now();
	// Right mouse button is handled on pointerdown; contextmenu remains only for touch long-press.
	if(now-lastRightPlaceT<400) return;
	if(!isToolMode()) return;
	if(now-lastChestOpen.t<CHEST_PLACE_SUPPRESS_MS) return;
	// Touch long-press: the initial touch started cursor mining — cancel it before placing
	if(minePointerId!=null){ minePointerId=null; stopMining(); }
	const p=screenToWorldTile(e.clientX,e.clientY); tryPlace(p.tx,p.ty); });
// Placeability is exactly "the resource registry maps this tile"; MUD/LAVA/GRAVE
// are not resources at all.
function haveBlocksFor(tileId){ const k=TILE_TO_RES[tileId]; return !!k && (inv[k]||0)>0; }
function consumeFor(tileId){ if(godMode) return; const k=TILE_TO_RES[tileId]; if(k) inv[k]--; }
function cellOverlapsPlayer(tx,ty){
	return tx+1 > player.x - player.w/2 && tx < player.x + player.w/2 && ty+1 > player.y - player.h/2 && ty < player.y + player.h/2;
}
function isStableMachineSupport(t){
	if(t===T.AIR || t===T.WATER || t===T.LAVA || t===T.LEAF || t===T.DYNAMO || t===T.DYNAMO_SLOT) return false;
	if(INFO[t] && INFO[t].gas) return false;
	return isSolid(t) || t===T.GRASS || t===T.SAND || t===T.SNOW || t===T.ICE || t===T.MUD || t===T.WOOD || t===T.STEEL || t===T.OBSIDIAN || t===T.STONE;
}
function canDynamoCellReplace(cell,cur){
	if(cell && (cell.role==='slot' || cell.t===T.DYNAMO_SLOT)){
		return cur===T.AIR || cur===T.WATER || (INFO[cur] && INFO[cur].gas);
	}
	return cur===T.AIR || (INFO[cur] && INFO[cur].gas);
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
			return [[0,1],[1,0],[-1,0],[0,-1]].some(([dx,dy])=>isStableMachineSupport(getTile(cell.x+dx,cell.y+dy)));
		});
		if(!support) return {ok:false, id:T.DYNAMO, structure:'dynamo', cells, reason:'Dynamo wymaga podparcia obudowy'};
		if(!haveBlocksFor(T.DYNAMO)) return {ok:false, id:T.DYNAMO, structure:'dynamo', cells, reason:'Brak blokĂłw'};
	}
	return {ok:true, id:T.DYNAMO, structure:'dynamo', cells};
}
function notifyStructureTileChanged(x,y,oldTile,newTile){
	const tx=Math.floor(x), ty=Math.floor(y);
	if(DYNAMO && DYNAMO.onTileChanged) DYNAMO.onTileChanged(tx,ty,oldTile,newTile);
	if(SOLAR && SOLAR.onTileChanged) SOLAR.onTileChanged(tx,ty,oldTile,newTile);
	if(TELEPORTERS && TELEPORTERS.onTileChanged) TELEPORTERS.onTileChanged(tx,ty,oldTile,newTile);
	if(GASES && GASES.onTileChanged) GASES.onTileChanged(tx,ty,oldTile,newTile);
	if(VOLCANO && VOLCANO.onTileChanged) VOLCANO.onTileChanged(tx,ty,newTile,getTile,setTile);
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
	if(!chest && id===T.DYNAMO) return canPlaceDynamoAt(tx,ty);
	// Solid blocks may also replace water (building under water); water into water is a no-op
	if(cur!==T.AIR && cur!==T.WATER && !(INFO[cur] && INFO[cur].gas)) return {ok:false};
	if(cur===T.WATER && id===T.WATER) return {ok:false};
	// Tile [tx,tx+1)×[ty,ty+1) vs player AABB — full-tile overlap test
	if(cellOverlapsPlayer(tx,ty)) return {ok:false};
	if(chest && !godMode) return {ok:false, reason:'Tylko w trybie Boga'};
	if(!godMode && !withinReach(tx,ty,PLACE_REACH)) return {ok:false, reason:'Za daleko'};
	{
		const blocked=blockedTargetReason(tx,ty);
		if(blocked) return {ok:false, reason:blocked};
	}
	if(!chest && !godMode && id!==T.SAND && id!==T.WATER){
		// Support: anything below, or a non-fluid neighbour on either side / above (wall & ceiling builds)
		const below=getTile(tx,ty+1);
		const support = (below!==T.AIR && below!==T.WATER && !(INFO[below] && INFO[below].gas))
			|| [[1,0],[-1,0],[0,-1]].some(([dx,dy])=>{ const n=getTile(tx+dx,ty+dy); return n!==T.AIR && n!==T.WATER && !(INFO[n] && INFO[n].gas); });
		if(!support) return {ok:false, reason:'Brak podparcia'};
	}
	if(!chest && !haveBlocksFor(id)) return {ok:false, reason:'Brak bloków'};
	return {ok:true, id, chest, replacedWater:cur===T.WATER};
}
function tryPlace(tx,ty){
	const v=canPlaceAt(tx,ty);
	if(!v.ok){ if(v.reason) msg(v.reason); return; }
	const id=v.id; const prevRaw=getTile(tx,ty); const prev=isGasTileId(prevRaw)?T.AIR:prevRaw;
	if(v.chest){ setTile(tx,ty,id); return; }
	if(v.structure==='dynamo'){ placeDynamoStructure(v); return; }
	pushUndo(tx,ty,prev,id,'place');
	setTile(tx,ty,id); if(VOLCANO && VOLCANO.onTileChanged) VOLCANO.onTileChanged(tx,ty,id,getTile,setTile); consumeFor(id); updateInventory(); updateHotbarCounts(); saveState();
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
}
// Per-slot counts (not per-type ids): two slots may hold the same resource after a
// remap, and chest slots show ∞ in god mode instead of a meaningless number.
function updateHotbarCounts(){
	document.querySelectorAll('#hotbarWrap .hotSlot').forEach((slotEl,i)=>{
		const c=slotEl.querySelector('.count'); if(!c) return;
		const name=HOTBAR_ORDER[i];
		const key=TILE_TO_RES[T[name]];
		c.textContent= key? String(inv[key]||0) : (isChestSelection(name)? '∞' : '');
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
		const spans=slotEl.querySelectorAll('span');
		if(spans[1]) spans[1].textContent=label;
		// resource color as an inset underline — ties the slot to its HUD swatch
		slotEl.style.boxShadow='0 2px 8px rgba(0,0,0,.5), inset 0 -3px 0 '+color;
	});
	updateHotbarCounts();
}
function updateHotbarSel(){ document.querySelectorAll('.hotSlot').forEach((el,i)=>{ if(i===hotbarIndex) el.classList.add('sel'); else el.classList.remove('sel'); }); }
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
	const cur=getTile(e.x,e.y);
	if(cur!==e.newId){ msg('Nie można cofnąć'); return; }
	if(e.kind==='place'){
		setTile(e.x,e.y,e.oldId);
		const k=invKeyForTile(e.newId);
		if(k && !godMode) inv[k] = (inv[k]||0)+1;
	} else if(e.kind==='break'){
		setTile(e.x,e.y,e.oldId);
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
window.addEventListener('keydown',ev=>{ if(isEditableTarget(ev.target) || ev.repeat) return; if(ev.key==='z' && !ev.ctrlKey && !ev.metaKey){ undoLastChange(); } });
// (legacy saveState/loadState removed – unified saveGame/loadGame used everywhere)
// Hotbar slot click: select OR (Shift/click again) open type remap popup
const hotSelectMenu=document.getElementById('hotSelectMenu');
const hotSelectOptions=document.getElementById('hotSelectOptions');
function closeHotSelect(){ if(hotSelectMenu){ hotSelectMenu.style.display='none'; } }
function openHotSelect(slot,anchorEl){ if(!hotSelectMenu) return; hotSelectOptions.innerHTML='';
	const baseTypes=RESOURCE_DEFS.filter(r=>r.tile).map(r=>({k:r.tile, label:r.label}));
	let types=[...baseTypes];
	if(godMode){ types.push({k:'CHEST_COMMON',label:'Skrzynia zwykła',col:'#b07f2c'}); types.push({k:'CHEST_RARE',label:'Skrzynia rzadka',col:'#a74cc9'}); types.push({k:'CHEST_EPIC',label:'Skrzynia epicka',col:'#e0b341'}); }
	types.forEach(t=>{ const b=document.createElement('button'); b.textContent=t.label; const baseBg='rgba(255,255,255,.08)'; const rareBg=t.col? t.col+'33': baseBg; const border=t.col? t.col+'88':'rgba(255,255,255,.15)'; b.style.cssText='text-align:left; background:'+rareBg+'; border:1px solid '+border+'; color:#fff; border-radius:8px; padding:4px 8px; cursor:pointer; font-size:12px;'; if(HOTBAR_ORDER[slot]===t.k) b.style.outline='2px solid #2c7ef8'; b.addEventListener('click',()=>{ HOTBAR_ORDER[slot]=t.k; closeHotSelect(); cycleHotbar(slot); msg('Slot '+hotbarKeyLabel(slot)+' -> '+t.label); }); hotSelectOptions.appendChild(b); });
	const rect=anchorEl.getBoundingClientRect(); hotSelectMenu.style.display='block'; hotSelectMenu.style.left=(rect.left + rect.width/2)+'px'; hotSelectMenu.style.top=(rect.top - 8)+'px'; hotSelectMenu.style.transform='translate(-50%,-100%)'; }
document.addEventListener('click',e=>{ if(hotSelectMenu && hotSelectMenu.style.display==='block'){ if(!hotSelectMenu.contains(e.target) && !(e.target.closest && e.target.closest('.hotSlot'))){ closeHotSelect(); } }});
// Shift+click or a second click/tap on the already-selected slot opens the remap menu
// (previously Shift-only outside god mode, which made remapping impossible on touch)
document.querySelectorAll('.hotSlot').forEach((el,i)=>{ el.addEventListener('click',e=>{ if(e.shiftKey || hotbarIndex===i) { openHotSelect(i,el); } else { cycleHotbar(i); } }); });
// Left click mining convenience
// Simple particle + sound system extracted to engine module
function spawnBurst(x,y,tier,opts){ if(PARTICLES && PARTICLES.spawnBurst) PARTICLES.spawnBurst(x,y,tier,opts); }
function updateParticles(dt){ if(PARTICLES && PARTICLES.update) PARTICLES.update(dt,TILE); }
function drawParticles(){ if(PARTICLES && PARTICLES.draw) PARTICLES.draw(ctx,worldFxVisible,TILE); }

canvas.addEventListener('pointerdown',e=>{
	noteSaveActivity();
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
		if(weaponMode){
			weaponPointerId=e.pointerId;
			const aim=screenToWorld(e.clientX,e.clientY);
			if(WEAPONS && WEAPONS.fireHeld) WEAPONS.fireHeld(player, aim.x, aim.y, 0.016);
			return;
		}
		// Left click: attack mob (range + cooldown) first, else open chest, else mine the clicked tile.
		// The pointer stays registered so holding/dragging keeps mining (see updateMining).
		minePointerId=e.pointerId;
		const dxRange = Math.abs(tx - Math.floor(player.x)); const dyRange=Math.abs(ty - Math.floor(player.y));
		// Equipped weapon/charm bonus damage on top of base melee / tool damage
		const atkBonus=(MM.activeModifiers && MM.activeModifiers.attackDamage)||0;
		if(dxRange<=3 && dyRange<=3 && player.atkCd<=0 && ((BOSSES && BOSSES.attackAt && BOSSES.attackAt(tx,ty,atkBonus)) || (MOBS && MOBS.attackAt && MOBS.attackAt(tx,ty,atkBonus)))){ player.atkCd=0.35; if(WEAPONS && WEAPONS.notifyMeleeSwing) WEAPONS.notifyMeleeSwing(tx,ty,player); return; }
		if(tryOpenChestAt(tx,ty)) return;
		if(dxRange<=3 && dyRange<=3 && tryOpenGraveAt(tx,ty)) return;
		// plants: harvest ripe berries / clear vegetation before digging the tile behind it
		if(dxRange<=3 && dyRange<=3 && PLANTS && PLANTS.harvestAt && PLANTS.harvestAt(tx,ty)){ try{ if(MM.audio && MM.audio.play) MM.audio.play('harvest'); }catch(e){} return; }
		startMineAt(tx,ty,{quiet:true});
	} else if(e.button===2){
		e.preventDefault();
		lastRightPlaceT=performance.now();
		if(weaponMode){
			const aim=screenToWorld(e.clientX,e.clientY);
			if(WEAPONS && WEAPONS.fireUlt) WEAPONS.fireUlt(player, aim.x, aim.y);
			return;
		}
		if(performance.now()-lastChestOpen.t>=CHEST_PLACE_SUPPRESS_MS) tryPlace(tx,ty);
	}
});
canvas.addEventListener('pointermove',e=>{
	lastPointer.x=e.clientX; lastPointer.y=e.clientY; lastPointer.has=true;
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
 drawBackground();
 const viewX=Math.ceil(W/(TILE*zoom)); const viewY=Math.ceil(H/(TILE*zoom)); const sx=Math.floor(camX)-1; const sy=Math.floor(camY)-1; ctx.save(); ctx.scale(zoom,zoom); // pixel snapping to avoid seams
 const camRenderX = Math.round(camX*TILE*zoom)/ (TILE*zoom);
 const camRenderY = Math.round(camY*TILE*zoom)/ (TILE*zoom);
 ctx.translate(-camRenderX*TILE,-camRenderY*TILE);
 ctx.imageSmoothingEnabled=false; // avoid anti-alias gaps
 // render tiles (solids + passables) first
 drawWorldVisible(sx,sy,viewX,viewY);
 // weather layer: clouds, rain/snow, lightning, evaporation mist (world-space, sky)
 if(CLOUDS && CLOUDS.draw) CLOUDS.draw(ctx,TILE,getTile,sx,sy,viewX,viewY);
 drawFallingBlocks();
 // cape behind player body but above tiles
 drawCape();
 // player body + overlays (back pass for vegetation done earlier)
 drawPlayer();
 // equipped weapon in hand (melee blades sweep during a swing)
 if(WEAPONS && WEAPONS.drawHeld) WEAPONS.drawHeld(ctx,TILE,player);
 // respawn totem flag (crafted spawn point)
 if(respawnPoint && typeof respawnPoint.x==='number'){
	 const fx=respawnPoint.x*TILE, fy=respawnPoint.y*TILE;
	 ctx.fillStyle='#6e4a22'; ctx.fillRect(fx-1, fy-18, 2, 22);
	 ctx.fillStyle='#e23b4e'; ctx.beginPath(); ctx.moveTo(fx+1,fy-18); ctx.lineTo(fx+12,fy-13); ctx.lineTo(fx+1,fy-8); ctx.closePath(); ctx.fill();
 }
 // living plants (rooted vegetation over terrain, under fire/creatures)
 if(PLANTS && PLANTS.draw) PLANTS.draw(ctx,TILE,sx,sy,viewX,viewY,worldFxVisible);
 // burning tiles + lava glow (flames over terrain, under mobs so creatures stay readable)
 if(FIRE && FIRE.draw) FIRE.draw(ctx,TILE,sx,sy,viewX,viewY,getTile,worldFxVisibility());
 // volcano hazards and story-item effects (over terrain, under creatures)
 if(VOLCANO && VOLCANO.draw) VOLCANO.draw(ctx,TILE,worldFxVisible,getTile);
 // world gases (steam, poison, fuel, hot air) drift over terrain and obey fog
 if(GASES && GASES.draw) GASES.draw(ctx,TILE,sx,sy,viewX,viewY,worldFxVisible);
 // visible wind: bounded dust streaks and windblown leaves, hidden by fog
 if(WIND && WIND.draw) WIND.draw(ctx,TILE,sx,sy,viewX,viewY,worldFxVisible);
 // ruin surface markers dressed as worked masonry (mortar, moss, etched rune)
 if(RUINS && RUINS.drawHints) RUINS.drawHints(ctx,TILE,worldFxVisible);
 // ruin-trap telltales + live effects (darts, gas) — over tiles, under mobs
 if(TRAPS && TRAPS.draw) TRAPS.draw(ctx,TILE,worldFxVisible);
 // mobs
 if(MOBS && MOBS.draw) MOBS.draw(ctx,TILE,camX,camY,zoom,worldFxVisible);
 // boss monsters (multi-part procedural creatures, world-space)
 if(BOSSES && BOSSES.draw) BOSSES.draw(ctx,TILE,worldFxVisible);
 // visiting saucer + tractor beam (above creatures — the beam shines over its victim)
 if(UFO && UFO.draw) UFO.draw(ctx,TILE,worldFxVisible);
 // weapon projectiles: arrows + flamethrower stream (above creatures)
 if(WEAPONS && WEAPONS.draw) WEAPONS.draw(ctx,TILE,worldFxVisible);
 // particles (screen-space in world coords)
 drawParticles();
 // front vegetation pass (blades/leaves that should appear in front)
 if(VISUAL.animations && GRASS && GRASS.drawOverlays){ GRASS.drawOverlays(ctx,'front', sx,sy,viewX,viewY,TILE,WORLD_H,getTile,T,zoom,grassDensityScalar,grassHeightScalar,worldFxVisible); }
 // Water overlay shimmer (after vegetation front to avoid overdraw? place before falling solids for clarity)
 if(WATER){ WATER.drawOverlay(ctx,TILE,getTile,sx,sy,viewX,viewY,worldFxVisible); }
 // Draw falling solids after terrain so they appear on top
 if(FALLING){ FALLING.draw(ctx,TILE,worldFxVisible); }
 if(SOLAR && SOLAR.draw) SOLAR.draw(ctx,TILE,sx,sy,viewX,viewY,worldFxVisible,getTile);
 if(DYNAMO && DYNAMO.draw) DYNAMO.draw(ctx,TILE,sx,sy,viewX,viewY,worldFxVisible,getTile);
 if(TELEPORTERS && TELEPORTERS.draw) TELEPORTERS.draw(ctx,TILE,sx,sy,viewX,viewY,worldFxVisible,getTile);
 // Ghost block preview — recomputed each frame so camera motion can't leave it stale.
 // Green = placement allowed right now; red = blocked (reach/support/no blocks).
 if(isToolMode() && lastPointer.has && !pinch && !mining){
	 const gp=screenToWorldTile(lastPointer.x,lastPointer.y);
	 const curT=getTile(gp.tx,gp.ty);
	 const placingDynamo=selectedTileId()===T.DYNAMO;
	 if(placingDynamo || curT===T.AIR || curT===T.WATER || (INFO[curT] && INFO[curT].gas)){
		 const v=canPlaceAt(gp.tx,gp.ty);
		 ctx.strokeStyle= v.ok? 'rgba(140,255,140,0.7)':'rgba(255,110,110,0.6)';
		 ctx.lineWidth=1;
		 const cells=Array.isArray(v.cells) ? v.cells : [{x:gp.tx,y:gp.ty}];
		 cells.forEach(cell=>ctx.strokeRect(cell.x*TILE+0.5, cell.y*TILE+0.5, TILE-1, TILE-1));
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
 if(mining){ ctx.strokeStyle='#fff'; ctx.strokeRect(mineTx*TILE+1,mineTy*TILE+1,TILE-2,TILE-2); const info=INFO[getTile(mineTx,mineTy)]||{hp:1}; const need=Math.max(0.1,info.hp/6); const p=mineTimer/need; ctx.fillStyle='rgba(255,255,255,.3)'; ctx.fillRect(mineTx*TILE, mineTy*TILE + (1-p)*TILE, TILE, p*TILE); }
 // Final world-space occlusion. Keep this after late overlays (especially water)
 // so unexplored tiles cannot leak through the fog layer.
 drawFogOverlay(sx,sy,viewX,viewY);
 ctx.restore();
	// (Underwater tint/vignette removed: darkening the screen while submerged
	// added no information and players found it distracting.)
	// Screen-space atmospheric tint (after world scaling restore)
	applyAtmosphericTint();
	// Off-screen monster pointer (screen space, after the world transform is gone)
	if(BOSSES && BOSSES.drawHUD) BOSSES.drawHUD(ctx,W,H,camRenderX,camRenderY,zoom,TILE,worldFxVisible);
	// HUD: energy + health bars
	ctx.save(); const barW=200, barH=18; const pad=12; const x=pad, y=H - barH - pad - 18;
	const energyMax=player.maxEnergy||heroEnergyCapacity();
	const energyFrac=energyMax>0? Math.max(0,Math.min(1,(player.energy||0)/energyMax)) : 0;
	const ey=y-16;
	ctx.fillStyle='rgba(0,0,0,0.48)'; ctx.fillRect(x,ey,barW,10);
	const eg=ctx.createLinearGradient(x,ey,x+barW,ey); eg.addColorStop(0,'#43e7ff'); eg.addColorStop(0.55,'#4b7dff'); eg.addColorStop(1,'#ffe66d');
	ctx.fillStyle=eg; ctx.fillRect(x,ey,Math.max(0,barW*energyFrac),10);
	ctx.strokeStyle='rgba(190,245,255,0.34)'; ctx.lineWidth=1; ctx.strokeRect(x,ey,barW,10);
	ctx.fillStyle='#dffcff'; ctx.font='12px system-ui'; ctx.fillText('EN '+Math.round(player.energy||0)+' / '+Math.round(energyMax), x+8, ey-3);
	ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(x,y,barW,barH); const frac=player.hp/player.maxHp; const g=ctx.createLinearGradient(x,y,x+barW,y); g.addColorStop(0,'#ff3636'); g.addColorStop(1,'#ff9a3d'); ctx.fillStyle=g; ctx.fillRect(x,y,Math.max(0,barW*frac),barH); ctx.strokeStyle='rgba(255,255,255,0.3)'; ctx.lineWidth=2; ctx.strokeRect(x,y,barW,barH); ctx.fillStyle='#fff'; ctx.font='12px system-ui'; ctx.fillText('HP '+player.hp+' / '+player.maxHp, x+8, y-4);
	// level + XP progress bar (engine/progress.js)
	{
		const lv=(MM.progress && MM.progress.level)? MM.progress.level() : {level:1,into:player.xp||0,need:60};
		const xy=y+barH+4;
		ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(x,xy,barW,8);
		ctx.fillStyle='#2c7ef8'; ctx.fillRect(x,xy,Math.max(0,Math.min(1,lv.into/lv.need))*barW,8);
		ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=1; ctx.strokeRect(x,xy,barW,8);
		const pts=(MM.progress && MM.progress.points)? MM.progress.points():0;
		ctx.fillStyle='#fff'; ctx.fillText('Poz. '+lv.level+'  •  '+lv.into+'/'+lv.need+' XP'+(pts>0? '  •  +'+pts+' pkt (E)':''), x+8, xy+18);
		// active potion buffs: icon + seconds remaining, stacked right of the XP bar
		const bf=(MM.progress && MM.progress.getBuffs)? MM.progress.getBuffs():[];
		bf.forEach((b,i)=>{ ctx.fillText(b.icon+' '+Math.ceil(b.t)+'s', x+barW+12+i*64, xy+8); });
	}
	// damage flash overlay
	if(player.hpInvul && performance.now()<player.hpInvul){ const alpha = (player.hpInvul - performance.now())/600; ctx.fillStyle='rgba(255,0,0,'+(0.25*alpha)+')'; ctx.fillRect(0,0,W,H); }
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
			'FPS: '+(currentFps||'~')+' ('+lastFrameMs.toFixed(1)+'ms)  Zoom: '+zoom.toFixed(2),
			'Pos: '+player.x.toFixed(2)+','+player.y.toFixed(2)+'  Tile: '+(Math.floor(player.x))+','+(Math.floor(player.y)),
			'Cam: '+camX.toFixed(2)+','+camY.toFixed(2)+'  View: '+vx+'x'+vy+' tiles',
			'Biome: '+biomeName+'  Chunks: '+visChunks+' vis / '+chunkCanvases.size+' cache'
		];
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
			lines.push('Save: '+(_saveDirty?'dirty':'clean')+(_saveStateT?' pending':'')+'  last '+Math.round(window.__lastSaveMs||0)+'ms'+mode+writeMs+' / '+(window.__lastSaveSizeKb||0)+'KB / '+(window.__lastSaveChunks||0)+' chunks  idle '+idleSec+'s  auto '+saveAgeSec+'s ago');
		}catch(e){}
		try{
			const mm = (MOBS && MOBS.metrics)? MOBS.metrics() : null;
			if(mm){ lines.push('Mobs: '+mm.count+' live, ~'+mm.active+' active  dt '+(mm.dtAvg*1000).toFixed(1)+'ms'); }
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
			const gm = (GASES && GASES.metrics)? GASES.metrics() : null;
			const wm = (WIND && WIND.metrics)? WIND.metrics() : null;
			const lava = (FIRE && FIRE.lavaCount)? FIRE.lavaCount() : 0;
			if(pm || vm || gm || wm || lava){ lines.push('FX: particles '+(pm?pm.particles:0)+' smoke '+(pm?pm.smoke:0)+'/'+(pm?pm.smokeCap:0)+' windFx '+(wm?wm.particles:0)+'/'+(wm?wm.particleCap:0)+' lava '+lava+' gas '+(gm?gm.active:0)+' (s '+(gm?gm.steam:0)+', p '+(gm?gm.poison:0)+', f '+(gm?gm.fuel:0)+')  volcanoes '+(vm?vm.activeVolcanoes:0)+' rocks '+(vm?vm.rocks:0)+' master '+(vm?vm.masterShots:0)); }
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
let mmCanvas=null, mmLastBuild=0;
function minimapTileColor(t){
	if(t===T.WATER) return '#2278de';
	if(t===T.LAVA) return '#e25822';
	if(t===T.DIAMOND) return '#3ef';
	if(t===T.COAL) return '#25272b';
	if(t===T.VOLCANO_MASTER_STONE) return '#71fff1';
	if(t===T.CHEST_COMMON || t===T.CHEST_RARE || t===T.CHEST_EPIC) return '#dba33a';
	if(t===T.TORCH) return '#ffc24b';
	if(t===T.OBSIDIAN) return '#4a3b66';
	if(t===T.STEEL) return '#8f9aa6';
	if(t===T.GLASS) return '#9deeff';
	if(t===T.WIRE) return '#c56f32';
	if(t===T.COPPER_WIRE) return '#d68535';
	if(t===T.ELECTRONICS) return '#47d18c';
	if(t===T.TRANSISTOR) return '#47d18c';
	if(t===T.DYNAMO) return '#ffd24a';
	if(t===T.DYNAMO_SLOT) return '#54ccff';
	if(t===T.TELEPORTER) return '#7cf7ff';
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
	if(t===T.SAND) return '#c8b772';
	if(t===T.GRASS || t===T.MUD) return '#4a8f3a';
	if(t===T.WOOD) return '#8b5a2b';
	if(t===T.LEAF) return '#2faa2f';
	if(t===T.GRAVE) return '#a8adb8';
	return '#686d78';
}
function minimapConcealsUndiscovered(t){
	return t===T.WATER || t===T.LAVA || t===T.DIAMOND || t===T.COAL || t===T.VOLCANO_MASTER_STONE || t===T.TORCH || t===T.OBSIDIAN || t===T.STEEL || t===T.GLASS || t===T.WIRE || t===T.COPPER_WIRE || t===T.ELECTRONICS || t===T.TRANSISTOR || t===T.DYNAMO || t===T.DYNAMO_SLOT || t===T.TELEPORTER || t===T.SOLAR_PANEL || t===T.SOLAR_BATTERY || t===T.MEAT || t===T.ROTTEN_MEAT || t===T.BAKED_MEAT || (INFO[t] && INFO[t].gas) || t===T.GRAVE || t===T.CHEST_COMMON || t===T.CHEST_RARE || t===T.CHEST_EPIC;
}
function drawMinimap(){
	if(!showMinimap) return;
	const MW=220, MH=64, RANGE=220;
	if(!mmCanvas){ mmCanvas=document.createElement('canvas'); mmCanvas.width=MW; mmCanvas.height=MH; }
	const now=performance.now();
	const rebuildEvery = lastFrameMs>40 ? 1600 : (lastFrameMs>24 ? 900 : 500);
	if(now-mmLastBuild>rebuildEvery){
		mmLastBuild=now;
		const g=mmCanvas.getContext('2d');
		g.fillStyle='rgba(6,10,18,0.95)'; g.fillRect(0,0,MW,MH);
		const cx=Math.floor(player.x);
		const xScale=(RANGE*2)/MW;
		const yScale=WORLD_H/MH;
		const surfCache=new Map();
		const surfaceAt=(wx)=>{
			let s=surfCache.get(wx);
			if(s===undefined){ s=WORLDGEN.surfaceHeight(wx); surfCache.set(wx,s); }
			return s;
		};
		const rowToY=(row)=>Math.max(1, Math.min(MH-2, Math.round(row*(MH-1)/(WORLD_H-1))));
		for(let py=0; py<MH; py++){
			const y0=Math.max(0, Math.floor(py*yScale));
			const y1=Math.min(WORLD_H-1, Math.ceil((py+1)*yScale)-1);
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
						if(wy>surf && !worldTileDiscovered(wx,wy) && minimapConcealsUndiscovered(t)){
							if(t===T.WATER || t===T.LAVA || t===T.TORCH || INFO[t].passable) cave=true;
							else if(!color) color='#686d78';
							continue;
						}
						const c=minimapTileColor(t);
						if(t===T.WATER || t===T.LAVA || t===T.DIAMOND || t===T.COAL || t===T.VOLCANO_MASTER_STONE || t===T.TORCH || t===T.STEEL || t===T.GLASS || t===T.WIRE || t===T.COPPER_WIRE || t===T.ELECTRONICS || t===T.TRANSISTOR || t===T.DYNAMO || t===T.DYNAMO_SLOT || t===T.TELEPORTER || t===T.SOLAR_PANEL || t===T.SOLAR_BATTERY || t===T.MEAT || t===T.ROTTEN_MEAT || t===T.BAKED_MEAT || (INFO[t] && INFO[t].gas) || INFO[t].chestTier){ color=c; priority=true; wx=wx1+1; break; }
						if(!color) color=c;
					}
				}
				const pxColor=priority?color:(cave?'#02050a':(color||null));
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
	ctx.globalAlpha=0.92;
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
function updateInventory(opts){ RESOURCE_KEYS.forEach(k=>{ if(el[k]) el[k].textContent=inv[k]; }); el.pick.textContent=PICK_LABELS[player.tool]||player.tool; updateCraftButtons(); updateHotbarCounts(); updateWeaponBar(); if(!(opts&&opts.noSave)) saveState(); try{ window.dispatchEvent(new CustomEvent('mm-resources-change')); }catch(e){} }
// Inventory overlay (resources tab) refreshes the HUD after dropping resources
window.updateInventoryHud = updateInventory;
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
updateGodBtn();
const menuPanel=document.getElementById('menuPanel');
if(MM.ui && MM.ui.initMenuToggle) MM.ui.initMenuToggle();
function debugGasOrigin(){
	const facing=player.facing<0 ? -1 : 1;
	const bx=Math.floor(player.x + facing*2);
	const by=Math.floor(player.y - 1);
	const offsets=[[0,0],[0,-1],[facing,0],[-facing,0],[0,1],[facing,-1],[-facing,-1],[facing,1],[-facing,1],[facing*2,0],[0,-2],[facing*2,-1],[-facing*2,-1]];
	for(const [dx,dy] of offsets){
		const tx=bx+dx, ty=by+dy;
		ensureChunk(Math.floor(tx/CHUNK_W));
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
				const cx=Number(k.slice(1));
				if(!Number.isFinite(cx)) return;
				const x0=cx*CHUNK_W;
				for(let y=0; y<WORLD_H; y++){
					const row=y*CHUNK_W;
					for(let lx=0; lx<CHUNK_W; lx++){
						if(isGasTileId(arr[row+lx])) clearAt(x0+lx,y);
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
			cells.forEach(cell=>ensureChunk(Math.floor(cell.x/CHUNK_W)));
			if(!debugDynamoCellsClear(cells)) continue;
			cells.forEach(cell=>setTile(cell.x,cell.y,cell.t));
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
	for(let y=Math.max(0,cy-28); y<=Math.min(WORLD_H-1,cy+28); y++){
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
		if(cell.y<0 || cell.y>=WORLD_H) return false;
		ensureChunk(Math.floor(cell.x/CHUNK_W));
		const t=getTile(cell.x,cell.y);
		if(t!==T.AIR && !isGasTileId(t)) return false;
		if(cellOverlapsPlayer(cell.x,cell.y)) return false;
	}
	return true;
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
			cells.forEach(cell=>setTile(cell.x,cell.y,cell.t));
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
	for(let y=Math.max(0,cy-28); y<=Math.min(WORLD_H-1,cy+28); y++){
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
// Inject debug time-of-day slider (non-intrusive) at end of menu only once
if(MM.ui && MM.ui.injectTimeSlider) MM.ui.injectTimeSlider(menuPanel);
if(MM.ui && MM.ui.injectMobSpawnPanel) MM.ui.injectMobSpawnPanel((id)=>{
	if(MOBS && MOBS.forceSpawn){ const ok=MOBS.forceSpawn(id, player, getTile); if(ok) msg('Spawn '+id); }
}, menuPanel);
if(MM.ui && MM.ui.injectGasDebugPanel) MM.ui.injectGasDebugPanel({
	spawn:spawnDebugGas,
	ignite:igniteDebugGas,
	clear:clearDebugGases,
	metrics:()=> (GASES && GASES.metrics) ? GASES.metrics() : null
}, menuPanel);
if(MM.ui && MM.ui.injectWindDebugPanel) MM.ui.injectWindDebugPanel({
	calm:()=>{ if(!WIND || !WIND.setOverride) return false; WIND.setOverride(0); return true; },
	exact:(value)=>{ if(!WIND || !WIND.setOverride) return false; const v=Number(value); if(!Number.isFinite(v)) return false; WIND.setOverride(v); return true; },
	breeze:(dir)=>{ if(!WIND || !WIND.setOverride) return false; WIND.setOverride((dir<0?-1:1)*1.35); return true; },
	gale:(dir)=>{ if(!WIND || !WIND.setOverride) return false; WIND.setOverride((dir<0?-1:1)*4.65); return true; },
	natural:()=>{ if(!WIND || !WIND.setOverride) return false; WIND.setOverride(null); if(WIND.setWeatherProfile) WIND.setWeatherProfile(null); return true; },
	profile:(id)=>{ if(!WIND || !WIND.setWeatherProfile) return false; return !!WIND.setWeatherProfile(id); },
	squall:(dir)=>{ if(!WIND || !WIND.forceSquall) return false; return !!WIND.forceSquall(dir<0?-1:1,3.2,26); },
	storm:()=>{ let ok=false; try{ if(CLOUDS && CLOUDS.startStorm){ CLOUDS.startStorm(75,1); ok=true; } }catch(e){} try{ if(WIND && WIND.forceSquall) ok=!!WIND.forceSquall(player.facing<0?-1:1,3.6,32) || ok; }catch(e){} return ok; },
	metrics:()=> (WIND && WIND.metrics) ? WIND.metrics() : null
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
// Regeneracja świata z nowym ziarnem
document.getElementById('regenBtn')?.addEventListener('click',()=>{ setSeedFromInput(); regenWorld(); if(MM.ui && MM.ui.closeMenu) MM.ui.closeMenu(); });
function regenWorld(){
	// Purge mobs and freeze spawns briefly
	if(MOBS && MOBS.clearAll) try{ MOBS.clearAll(); }catch(e){}
	if(MOBS && MOBS.freezeSpawns) try{ MOBS.freezeSpawns(4000); }catch(e){}

	// Clear world data and caches
	WORLD.clear(); if(WORLD.clearHeights) WORLD.clearHeights();
	if(typeof chunkCanvases!=='undefined') chunkCanvases.clear();

	// Reset fog-of-war (seen tiles) and ensure full fog state
	try{ if(FOG && FOG.importSeen) FOG.importSeen([]); if(FOG && FOG.setRevealAll) FOG.setRevealAll(false); if(MM.ui && MM.ui.updateMapButton && FOG && FOG.getRevealAll) MM.ui.updateMapButton(FOG.getRevealAll()); }catch(e){}

	// Reset transient systems
	mining=false; if(FALLING && FALLING.reset) FALLING.reset(); if(TREES && TREES.reset) TREES.reset(); if(WATER && WATER.reset) WATER.reset(); if(GASES && GASES.reset) GASES.reset(); if(WIND && WIND.reset) WIND.reset(); if(DYNAMO && DYNAMO.reset) DYNAMO.reset(); if(SOLAR && SOLAR.reset) SOLAR.reset(); if(TELEPORTERS && TELEPORTERS.reset) TELEPORTERS.reset(); if(CLOUDS && CLOUDS.reset) CLOUDS.reset(); if(BOSSES && BOSSES.reset) BOSSES.reset(); if(GRASS && GRASS.reset) GRASS.reset(); if(PARTICLES && PARTICLES.reset) PARTICLES.reset(); if(FIRE && FIRE.reset) FIRE.reset(); if(WEAPONS && WEAPONS.reset) WEAPONS.reset(); if(MEAT && MEAT.reset) MEAT.reset(); if(VOLCANO && VOLCANO.reset) VOLCANO.reset(); if(PLANTS && PLANTS.reset) PLANTS.reset();

	// Reset inventory/tools/hotbar
	RESOURCE_KEYS.forEach(k=>{ inv[k]=0; }); inv.tools.stone=inv.tools.diamond=false; player.tool='basic'; hotbarIndex=0; // if god mode active, restore 100 stack after reset
	// Fresh world = fresh hero arc: XP, level, skill points and milestones restart
	player.xp=0; player.energy=0; if(PROGRESS && PROGRESS.reset) PROGRESS.reset(); applyProgressHp(); applyHeroEnergyCapacity(); respawnPoint=null; saveRespawnPoint(); grave=null; saveGrave();
	// Ensure all animals are removed when creating a new world and prevent immediate respawn
	if(MOBS){ try{ if(MOBS.clearAll) MOBS.clearAll(); else if(MOBS.deserialize) MOBS.deserialize({v:3, list:[], aggro:{mode:'rel', m:{}}}); }catch(e){} }
	if(godMode){ if(!_preGodInventory){ _preGodInventory={}; RESOURCE_KEYS.forEach(k=>{ _preGodInventory[k]=0; }); } RESOURCE_KEYS.forEach(k=>{ inv[k]=100; }); }
	updateInventory(); updateHotbarSel(); placePlayer(true); saveState(); msg('Nowy świat seed '+worldSeed); }
document.getElementById('centerBtn').addEventListener('click',()=>{ camSX=player.x - (W/(TILE*zoom))/2; camSY=player.y - (H/(TILE*zoom))/2; camX=camSX; camY=camSY; });
document.getElementById('helpBtn').addEventListener('click',()=>{ const h=document.getElementById('help'); const show=h.style.display!=='block'; h.style.display=show?'block':'none'; document.getElementById('helpBtn').setAttribute('aria-expanded', String(show)); });
const radarBtn=document.getElementById('radarBtn'); radarBtn.addEventListener('click',()=>{ radarFlash=performance.now()+1500; }); let radarFlash=0;
// Listen for UI-dispatched radar pulse from the menu
window.addEventListener('mm-radar-pulse',()=>{ radarFlash=performance.now()+1500; });
function msg(t){ if(MM.ui && MM.ui.msg) MM.ui.msg(t); else { el.msg.textContent=t; clearTimeout(msg._t); msg._t=setTimeout(()=>{ el.msg.textContent=''; },4000); } }
// Engine modules (mobs death, lightning electrocution) reach messages via window.msg
window.msg = msg;
window.forceVolcanoMasterStone = function(){ return !!(VOLCANO && VOLCANO.forceMasterEruption && VOLCANO.forceMasterEruption()); };

// FPS
let frames=0,lastFps=performance.now(), currentFps=0; function updateFps(now){ frames++; if(now-lastFps>1000){ currentFps=frames; const budget = (GRASS && GRASS.getBudgetInfo)? GRASS.getBudgetInfo():''; el.fps.textContent=currentFps+' FPS'+ (budget? (' '+budget):''); frames=0; lastFps=now; }}

// Spawn
function placePlayer(skipMsg){
	// A crafted Totem odrodzenia overrides the default spawn search
	if(respawnPoint && typeof respawnPoint.x==='number'){
		ensureChunk(Math.floor(respawnPoint.x/CHUNK_W));
		player.x=respawnPoint.x; player.y=respawnPoint.y; player.vx=0; player.vy=0;
		centerOnPlayer(); if(!skipMsg) msg('Odrodzono przy totemie');
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
	let y=0; while(y<WORLD_H-1){ const tt=getTile(x,y); if(tt!==T.AIR && !(INFO[tt] && INFO[tt].passable)) break; y++; }
	player.x=x+0.5; player.y=y-1; centerOnPlayer(); if(!skipMsg) msg('Seed '+worldSeed); }
window.placePlayer = placePlayer; // mobs.js respawn-on-death relies on this bridge
function centerOnPlayer(){ revealAround(); camSX=player.x - (W/(TILE*zoom))/2; camSY=player.y - (H/(TILE*zoom))/2; camX=camSX; camY=camSY; initScarf(); }
function teleportHeroTo(x,y,opts){
	opts=opts||{};
	if(typeof x!=='number'||!isFinite(x)||typeof y!=='number'||!isFinite(y)) return false;
	ensureChunk(Math.floor(x/CHUNK_W));
	player.x=x; player.y=y; player.vx=0; player.vy=0;
	if(opts.center!==false) centerOnPlayer(); else ensureChunks();
	if(opts.message) msg(opts.message);
	try{ if(MOBS && MOBS.freezeSpawns) MOBS.freezeSpawns(1500); }catch(e){}
	return true;
}
window.teleportHeroTo = teleportHeroTo;
function safeLandingFloor(t){
	if(!isSolid(t) || t===T.WATER || t===T.LAVA) return false;
	if(t===T.WOOD || t===T.DIAMOND || t===T.VOLCANO_MASTER_STONE) return false;
	if(t===T.CHEST_COMMON || t===T.CHEST_RARE || t===T.CHEST_EPIC) return false;
	return true;
}
function safeVolcanoLandingAt(tx){
	if(typeof tx!=='number' || !isFinite(tx)) return null;
	tx=Math.round(tx);
	ensureChunk(Math.floor(tx/CHUNK_W));
	const surface = WORLDGEN.surfaceHeight(tx);
	if(surface<3 || surface>=WORLD_H-2) return null;
	const floor=getTile(tx,surface);
	const body=getTile(tx,surface-1);
	const head=getTile(tx,surface-2);
	const bodyOk = body!==T.WATER && body!==T.LAVA && (!isSolid(body) || body===T.LEAF || body===T.TORCH || body===T.GRAVE);
	const headOk = head!==T.WATER && head!==T.LAVA && (!isSolid(head) || head===T.LEAF || head===T.TORCH || head===T.GRAVE);
	if(!safeLandingFloor(floor) || !bodyOk || !headOk) return null;
	return {x:tx+0.5, y:surface-1, tileX:tx, surface};
}
function bodySpaceOpen(t,allowWater){
	if(t===T.LAVA) return false;
	if(!allowWater && (t===T.WATER || t===T.ICE)) return false;
	return !isSolid(t) || t===T.LEAF || t===T.TORCH || t===T.GRAVE || (allowWater && t===T.WATER);
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
window.teleportHeroToNearestBiome = function(biomeId,dir){
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
};
const loaded=loadGame();
if(!loaded){ placePlayer(); } else { centerOnPlayer(); }
updateInventory(); updateGodBtn(); if(MM.ui && MM.ui.updateMapButton && FOG && FOG.getRevealAll) MM.ui.updateMapButton(FOG.getRevealAll()); updateHotbarSel(); refreshHotbarDom(); updateWeaponBar(); if(!loaded) msg('Sterowanie: A/D/W. 1=kilof: LPM kopie, PPM stawia. 2/3/4=broń: LPM strzela/atakuje, PPM ult. E=Ekwipunek, G=Bóg, M=Mapa, C=Centrum, H=Pomoc'); else msg('Wczytano zapis – miłej gry!');
// (Ghost preview is computed per-frame in draw() from lastPointer — see canPlaceAt)

// Robustly initialize both grass and player speed controls after DOM is ready
function initAllMenuControls() {
	initGrassControls();
	initPlayerSpeedControls();
}
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initAllMenuControls);
} else {
	initAllMenuControls();
}

// Pętla
let volcanoLeakWakeT=0;
 let last=performance.now(); let lastFrameMs=0; let lastLoopErrAt=0; function loop(ts){ const dt=Math.min(0.05,(ts-last)/1000); last=ts; lastFrameMs=dt*1000; window.__mmFrameMs=lastFrameMs; // smooth zoom interpolation
	// the whole frame is guarded: one bad subsystem tick must skip a frame, not kill
	// the rAF chain with an uncaught error (e.g. a cache blowing its size limit)
	try{
		if(Math.abs(zoomTarget-zoom)>0.0001){ zoom += (zoomTarget-zoom)*Math.min(1, dt*8); }
		if(!paused){
			physics(dt); if(player.atkCd>0) player.atkCd-=dt;
			// Weapon use: selected weapon slots fire from LPM; the touch button aims forward.
			if(activeWeaponItem() && ((weaponPointerId!=null && lastPointer.has)||fireBtnHeld) && WEAPONS && WEAPONS.fireHeld){
				const aim=(weaponPointerId!=null && lastPointer.has && !fireBtnHeld)? screenToWorld(lastPointer.x,lastPointer.y) : {x:player.x+player.facing*5, y:player.y-0.4};
				WEAPONS.fireHeld(player, aim.x, aim.y, dt);
			}
			if(WEAPONS && WEAPONS.update) WEAPONS.update(dt, getTile, setTile);
			if(MEAT && MEAT.update) MEAT.update(dt, player, getTile, setTile);
			volcanoLeakWakeT-=dt;
			if(volcanoLeakWakeT<=0){
				const slowLavaWake=lastFrameMs>32;
				volcanoLeakWakeT=slowLavaWake?0.65:0.28;
				if(FIRE && FIRE.wakeVolcanoLeaksNear) FIRE.wakeVolcanoLeaksNear(player.x, player.y, getTile, {rx:slowLavaWake?36:56, ry:slowLavaWake?28:38, peekTile:WORLD.peekTile});
			}
			if(FIRE && FIRE.update) FIRE.update(getTile, setTile, dt);
			if(VOLCANO && VOLCANO.update) VOLCANO.update(dt, player, getTile, setTile);
			if(WIND && WIND.update) WIND.update(dt, player, getTile, {clouds:CLOUDS, worldGen:WORLDGEN, background:BACKGROUND});
			if(GASES && GASES.update) GASES.update(dt, getTile, setTile, player);
			if(PLANTS && PLANTS.update) PLANTS.update(getTile, setTile, dt);
			if(PROGRESS && PROGRESS.update) PROGRESS.update(dt);
			updateMining(dt); updateFallingBlocks(dt); if(FALLING && FALLING.update) FALLING.update(getTile,setTile,dt); if(WATER && WATER.update) WATER.update(getTile,setTile,dt); if(DYNAMO && DYNAMO.update) DYNAMO.update(dt,getTile); if(SOLAR && SOLAR.update) SOLAR.update(dt,player,getTile); if(TELEPORTERS && TELEPORTERS.update) TELEPORTERS.update(dt, player, getTile, setTile, {dynamo:DYNAMO, heroEnergy:MM.heroEnergy}); updateHeroEnergy(dt); if(CLOUDS && CLOUDS.update) CLOUDS.update(getTile,setTile,dt); if(BOSSES && BOSSES.update) BOSSES.update(getTile,setTile,dt); if(MOBS && MOBS.update) MOBS.update(dt, player, getTile); if(UFO && UFO.update) UFO.update(dt, player); if(TRAPS && TRAPS.update) TRAPS.update(dt, player, getTile, setTile); updateParticles(dt); updateCape(dt); updateBlink(ts);
		}
		if(AUDIO && AUDIO.update) AUDIO.update(dt);
		draw();
		updateHoverInfo();
		if(paused){
			ctx.save();
			ctx.fillStyle='rgba(5,8,14,0.45)'; ctx.fillRect(0,0,W,H);
			ctx.fillStyle='#fff'; ctx.font='bold 28px system-ui'; ctx.textAlign='center';
			ctx.fillText('⏸ PAUZA', W/2, H/2-8);
			ctx.font='13px system-ui'; ctx.fillText('Naciśnij B, aby wznowić', W/2, H/2+18);
			ctx.restore();
		}
		if(MM.ui && MM.ui.setRadarPulsing) MM.ui.setRadarPulsing(ts<radarFlash); updateFps(ts); updateBiomeLabel();
	}catch(err){
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
	try{ const saved=localStorage.getItem(LOOT_INBOX_KEY); if(saved){ const parsed=JSON.parse(saved); if(Array.isArray(parsed.items)){ window.lootInbox = parsed.items.filter(isGearItem); lootInboxUnread = Math.min(parsed.unread|0, window.lootInbox.length); } } }catch(e){}
	const lootInboxBtn=document.getElementById('lootInboxBtn');
	const lootInboxCount=document.getElementById('lootInboxCount');
	const lootPopup=document.getElementById('lootPopup');
	const lootDim=document.getElementById('lootDim');
	const lootItemsBox=document.getElementById('lootPopupItems');
	const lootEquipAllBtn=document.getElementById('lootEquipAll');
	const lootKeepAllBtn=document.getElementById('lootKeepAll');
	const lootCloseBtn=document.getElementById('lootClose');
	let lootPrevFocus=null;
	function persistInbox(){ try{ localStorage.setItem(LOOT_INBOX_KEY, JSON.stringify({items:window.lootInbox, unread:lootInboxUnread})); }catch(e){} }
	function updateLootInboxIndicator(){ const count=lootInboxUnread; if(!lootInboxBtn) return; if(count>0){ lootInboxBtn.style.display='inline-block'; lootInboxCount.textContent=''+count; lootInboxBtn.classList.add('pulseNew'); } else { lootInboxBtn.style.display='none'; lootInboxCount.textContent=''; lootInboxBtn.classList.remove('pulseNew'); } }
	window.updateLootInboxIndicator=updateLootInboxIndicator;
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
		items.forEach(it=>{ if(!isGearItem(it)) return; const row=document.createElement('div'); row.className='lootRow '+(typeof it.tier==='string'? it.tier:''); const left=document.createElement('div'); const title=document.createElement('div'); title.style.fontWeight='600'; title.textContent=(it.name||it.id)+' · '+(KIND_NAME[it.kind]||it.kind); if(it.unique){ const b=document.createElement('span'); b.textContent='★ '+it.unique; b.style.marginLeft='6px'; b.style.fontSize='10px'; b.style.color='#ffd54a'; title.appendChild(b); }
			left.appendChild(title);
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
			function disable(){ equip.disabled=keep.disabled=discard.disabled=true; row.style.opacity='.45'; }
				equip.addEventListener('click',()=>{ if(MM.inventory && !MM.inventory.equip(it.id)) msg('Nie można założyć (przedmiot odrzucony?)'); disable(); persistInbox(); });
				keep.addEventListener('click',()=>{ disable(); persistInbox(); });
				discard.addEventListener('click',()=>{ if(MM.inventory) MM.inventory.discard(it.id); disable(); updateLootInboxIndicator(); persistInbox(); });
			btns.appendChild(equip); btns.appendChild(keep); btns.appendChild(discard); row.appendChild(btns); lootItemsBox.appendChild(row); row.__item=it; });
	}
	function openInbox(){ if(!window.lootInbox.length){ msg('Brak przedmiotów'); return; } buildRows(window.lootInbox); lootInboxUnread=0; updateLootInboxIndicator(); persistInbox(); lootPopup.classList.add('show'); lootDim.style.display='block'; lootPrevFocus=document.activeElement; installTrap(); const first=lootPopup.querySelector('button'); if(first) first.focus(); }
	function closeInbox(){ lootPopup.classList.remove('show'); lootDim.style.display='none'; removeTrap(); if(lootPrevFocus && lootPrevFocus.focus) lootPrevFocus.focus(); }
	function installTrap(){ function handler(e){ if(lootPopup.style.display!=='flex') return; if(e.key==='Escape'){ closeInbox(); return; } if(e.key==='Tab'){ const f=[...lootPopup.querySelectorAll('button')].filter(b=>!b.disabled); if(!f.length) return; const first=f[0], last=f[f.length-1]; if(e.shiftKey){ if(document.activeElement===first){ e.preventDefault(); last.focus(); } } else { if(document.activeElement===last){ e.preventDefault(); first.focus(); } } } } window.addEventListener('keydown',handler); lootPopup.__trapHandler=handler; }
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
		msg(n? '✓ Założono '+n+' lepszych przedmiotów' : 'Nic nie przebija obecnego wyposażenia');
		persistInbox(); closeInbox();
	});
	lootKeepAllBtn?.addEventListener('click',closeInbox);
	window.addEventListener('keydown',e=>{ if(isEditableTarget(e.target)) return; if(e.key.toLowerCase()==='i'){ if(lootPopup.classList.contains('show')) closeInbox(); else openInbox(); } });
	MM.onLootGained = function(items){ if(window.updateDynamicCustomization) window.updateDynamicCustomization(); if(window.lootInbox){ window.lootInbox.push(...items); lootInboxUnread += items.length; updateLootInboxIndicator(); persistInbox(); } };
	// Initial indicator on load (if persisted)
	updateLootInboxIndicator();
}

// Regenerate world using the CURRENT seed (do not change WG.worldSeed)
window.regenWorldSameSeed = function(){ try{ if(MOBS && MOBS.clearAll) try{ MOBS.clearAll(); }catch(e){} if(WORLD && WORLD.clear) WORLD.clear(); if(typeof chunkCanvases!=='undefined') chunkCanvases.clear(); if(WORLD && WORLD.clearHeights) WORLD.clearHeights(); if(FALLING && FALLING.reset) FALLING.reset(); if(TREES && TREES.reset) TREES.reset(); if(WATER && WATER.reset) WATER.reset(); if(GASES && GASES.reset) GASES.reset(); if(WIND && WIND.reset) WIND.reset(); if(DYNAMO && DYNAMO.reset) DYNAMO.reset(); if(SOLAR && SOLAR.reset) SOLAR.reset(); if(TELEPORTERS && TELEPORTERS.reset) TELEPORTERS.reset(); if(CLOUDS && CLOUDS.reset) CLOUDS.reset(); if(BOSSES && BOSSES.reset) BOSSES.reset(); if(GRASS && GRASS.reset) GRASS.reset(); if(PARTICLES && PARTICLES.reset) PARTICLES.reset(); if(FIRE && FIRE.reset) FIRE.reset(); if(WEAPONS && WEAPONS.reset) WEAPONS.reset(); if(MEAT && MEAT.reset) MEAT.reset(); if(VOLCANO && VOLCANO.reset) VOLCANO.reset(); if(PLANTS && PLANTS.reset) PLANTS.reset();
	// Reset fog-of-war as well
	try{ if(FOG && FOG.importSeen) FOG.importSeen([]); if(FOG && FOG.setRevealAll) FOG.setRevealAll(false); if(MM.ui && MM.ui.updateMapButton && FOG && FOG.getRevealAll) MM.ui.updateMapButton(FOG.getRevealAll()); }catch(e){}
	RESOURCE_KEYS.forEach(k=>{ inv[k]=0; }); inv.tools.stone=inv.tools.diamond=false; player.tool='basic'; hotbarIndex=0;
	// Also remove all animals when regenerating with same seed and freeze spawns briefly
	if(MOBS){ try{ if(MOBS.clearAll) MOBS.clearAll(); else if(MOBS.deserialize) MOBS.deserialize({v:3, list:[], aggro:{mode:'rel', m:{}}}); if(MOBS.freezeSpawns) MOBS.freezeSpawns(4000); }catch(e){} }
	updateInventory(); updateHotbarSel(); placePlayer(true); saveState(); msg('Odświeżono świat (seed '+WORLDGEN.worldSeed+', ustawienia zmienione)'); }catch(e){ console.warn('regenWorldSameSeed failed',e); }}
window.addEventListener('mm-regen-same-seed', ()=>{ if(window.regenWorldSameSeed) window.regenWorldSameSeed(); });
