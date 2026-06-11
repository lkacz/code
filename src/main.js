// Nowy styl / pełny ekran inspirowany Diamonds Explorer
// Module entry: import constants (also hydrates window.MM via shim) and side-effect engine modules
import { CHUNK_W, WORLD_H, TILE, T, INFO, isSolid, MOVE } from './constants.js';
// Ensure worldgen initializes before world (world.js reads MM.worldGen on load)
import { worldGen as WORLDGEN } from './engine/worldgen.js';
import world from './engine/world.js';
import { trees as TREES } from './engine/trees.js';
import { fallingSolids as FALLING } from './engine/falling.js';
import { water as WATER } from './engine/water.js';
import { cape as CAPE } from './engine/cape.js';
import { chests as CHESTS } from './engine/chests.js';
import './inventory.js';
import { mobs as MOBS } from './engine/mobs.js';
import { background as BACKGROUND } from './engine/background.js';
import { fog as FOG } from './engine/fog.js';
import { eyes as EYES } from './engine/eyes.js';
import { particles as PARTICLES } from './engine/particles.js';
import { clouds as CLOUDS } from './engine/clouds.js';
import { bosses as BOSSES } from './engine/bosses.js';
import { grass as GRASS } from './engine/grass.js';
import { fire as FIRE } from './engine/fire.js';
import { weapons as WEAPONS } from './engine/weapons.js';
import { plants as PLANTS } from './engine/plants.js';
import { progress as PROGRESS } from './engine/progress.js';
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
// Biome ID to name mapping used for HUD label (kept simple)
const BIOME_NAMES = [
	'Forest',
	'Plains',
	'Snow/Ice',
	'Desert',
	'Swamp',
	'Sea',
	'Lake',
	'Mountain'
];
// --- Dynamic Background delegated to engine/background.js ---
function drawBackground(){ if(BACKGROUND && BACKGROUND.draw) BACKGROUND.draw(ctx, W, H, player.x, TILE, WORLDGEN); }
function applyAtmosphericTint(){ if(!VISUAL.atmoTint) return; if(BACKGROUND && BACKGROUND.applyTint) BACKGROUND.applyTint(ctx, W, H); }
let grassDensityScalar = 1; // user adjustable (exponential scaling)
let grassHeightScalar = 1; // user adjustable linear multiplier
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
	function updDensity(){ if(!rngD||!labD) return; const val = parseFloat(rngD.value); if(isNaN(val)) return; grassDensityScalar = Math.pow(3, val); const approx = Math.round( (4 * grassDensityScalar) ); labD.textContent=approx+'x'; try{ localStorage.setItem('mm_grass_density', String(val)); }catch(e){} }
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
if(FALLING && FALLING.init) FALLING.init(getTile,setTile);

// --- Gracz / inwentarz ---
const player={x:0,y:0,w:0.7,h:0.95,vx:0,vy:0,onGround:false,facing:1,tool:'basic',jumpCount:0,maxHp:100,hp:100,hpInvul:0,atkCd:0,xp:0};
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
	// Also persist to main save so reloads keep the look/feel in sync
	try{ saveGame(false); }catch(e){}
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
function cycleHotbar(idx){ if(idx<0||idx>=HOTBAR_ORDER.length) return; hotbarIndex=idx; updateHotbarSel(); saveState(); }
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
		if(t===T.AIR || t===T.WATER) setTile(gx,gy,T.GRAVE);
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
const SAVE_KEY='mm_save_v6';
const OLD_SAVE_KEYS=['mm_save_v5','mm_save_v4','mm_save_v3','mm_save_v2'];
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
// --- Integrity helpers (stable stringify + FNV1a hash) ---
function stableStringify(v){ if(v===null||typeof v!=='object') return JSON.stringify(v); if(Array.isArray(v)) return '['+v.map(stableStringify).join(',')+']'; const keys=Object.keys(v).sort(); return '{'+keys.map(k=>JSON.stringify(k)+':'+stableStringify(v[k])).join(',')+'}'; }
function computeHash(str){ // FNV-1a 32-bit
 let h=0x811c9dc5; for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h = (h>>>0) * 0x01000193; h>>>0; } return ('00000000'+(h>>>0).toString(16)).slice(-8); }
function attachHash(obj){ const clone=JSON.parse(JSON.stringify(obj)); const core=stableStringify(clone); const hash=computeHash(core); clone.h=hash; return {object:clone, hash}; }
function verifyHash(obj){ if(!obj || typeof obj!=='object' || !obj.h) return {ok:true, reason:!obj?'no-object':'no-hash'}; const h=obj.h; const tmp=Object.assign({}, obj); delete tmp.h; const core=stableStringify(tmp); const calc=computeHash(core); return {ok: h===calc, expected: h, got: calc}; }
function gatherModifiedChunks(){ const out=[]; const worldMap=WORLD._world; if(!worldMap) return out; for(const [k,arr] of worldMap.entries()){ const cx=parseInt(k.slice(1), 10); if(isNaN(cx)) continue; const ver=WORLD._versions.get(k)||0; if(ver===0) continue; out.push({cx,data:encodeRLE(arr),rle:true}); } return out; }
function restoreModifiedChunks(list){ if(!Array.isArray(list)) return; for(const ch of list){ if(typeof ch.cx!=='number'||!ch.data) continue; const arr = ch.rle? decodeRLE(ch.data, CHUNK_W*WORLD_H): decodeRaw(ch.data); WORLD._world.set('c'+ch.cx, arr); WORLD._versions.set('c'+ch.cx,1); } }
// (legacy v4 export*/import* save helpers removed — v5 persists only blocks + player position)
function buildSaveObject(){ // v5: minimal persistence — only blocks and player position
 // Saves capture tiles only: land any airborne sand/stone first so reloads can't lose it
 try{ if(FALLING && FALLING.settleAll) FALLING.settleAll(); }catch(e){}
 return {
	v:6,
	seed: WORLDGEN.worldSeed,
	world:{ modified: gatherModifiedChunks() },
	// Persist player coordinates + XP (the progression spine needs XP to survive reloads)
	player: { x: player.x, y: player.y, xp: player.xp|0 },
	savedAt: Date.now()
}; }
function saveGameCore(manual){ try{ const data=buildSaveObject(); const {object:withHash} = attachHash(data); const json=JSON.stringify(withHash); localStorage.setItem(SAVE_KEY,json); if(manual){ const mods=(data.world && data.world.modified)? data.world.modified.length:0; msg('Zapisano ('+((json.length/1024)|0)+' KB, modyf.chunks:'+mods+')'); } }catch(e){ console.warn('Save failed',e); if(manual) msg('Błąd zapisu'); } }
// Lightweight autosave indicator (created lazily)
function showAutoSaveHint(sizeKB){ try{ let el=document.getElementById('autoSaveHint'); if(!el){ el=document.createElement('div'); el.id='autoSaveHint'; el.style.cssText='position:fixed; left:8px; bottom:8px; background:rgba(0,0,0,0.55); color:#fff; font:11px system-ui; padding:4px 8px; border-radius:6px; pointer-events:none; opacity:0; transition:opacity .4s; z-index:5000;'; document.body.appendChild(el); }
 const now=new Date(); const t=now.toLocaleTimeString(); el.textContent='Auto-zapis '+t+' ('+sizeKB+' KB)'; el.style.opacity='1'; clearTimeout(showAutoSaveHint._t); showAutoSaveHint._t=setTimeout(()=>{ el.style.opacity='0'; },2800); }catch(e){} }
// Wrapper adds the autosave hint on non-manual saves
function saveGame(manual){ saveGameCore(manual); if(!manual){ try{ const raw=localStorage.getItem(SAVE_KEY); if(raw) showAutoSaveHint((raw.length/1024)|0); }catch(e){} } }
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
	try{ if(MM.trees && MM.trees._fallingBlocks) MM.trees._fallingBlocks.length=0; }catch(e){}
	try{ if(GRASS && GRASS.reset) GRASS.reset(); }catch(e){}
	try{ if(PARTICLES && PARTICLES.reset) PARTICLES.reset(); }catch(e){}
	try{ if(FIRE && FIRE.reset) FIRE.reset(); }catch(e){}
	try{ if(WEAPONS && WEAPONS.reset) WEAPONS.reset(); }catch(e){}
	// (plants persist independently in mm_plants_v1 and survive a reload of the same world)

	// If seed differs, swap to saved seed and clear world gen caches
	// (typeof guard: an imported file could carry a non-numeric seed, which would NaN the terrain math)
	if(typeof data.seed==='number' && data.seed!==WORLDGEN.worldSeed){
		if(WORLDGEN.setSeedFromInput){ WORLDGEN.worldSeed=data.seed; if(WORLD.clearHeights) WORLD.clearHeights(); }
		WORLD.clear();
	}
	dropWorldBoundMarkers(); // totem/grave from another world must not apply here

	// Restore only modified blocks and player position
	if(data.world && Array.isArray(data.world.modified)) restoreModifiedChunks(data.world.modified);
	// Restore only player position
	if(data.player && typeof data.player.x==='number') player.x = data.player.x;
	if(data.player && typeof data.player.y==='number') player.y = data.player.y;
	if(data.player && typeof data.player.xp==='number') player.xp = data.player.xp;

	// Recenter camera or place player if needed
	if(data.player && typeof data.player.x==='number' && typeof data.player.y==='number') { centerOnPlayer(); } else { placePlayer(true); }
	return true;
 }catch(e){ console.warn('Load failed',e); return false; }
}
// Auto-save interval (60s)
setInterval(()=>{ saveGame(false); },60000);
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
			&& (obj.world==null || (typeof obj.world==='object' && (obj.world.modified==null || Array.isArray(obj.world.modified))))
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
// Lightweight saveState(): debounced full save. Mining/placing call this on every tile
// change and a synchronous whole-world serialization per dig caused visible hitches.
let _saveStateT=null;
function saveState(){ if(_saveStateT) return; _saveStateT=setTimeout(()=>{ _saveStateT=null; saveGameCore(false); },2500); }
function flushPendingSave(){ if(_saveStateT){ clearTimeout(_saveStateT); _saveStateT=null; saveGameCore(false); } }
window.addEventListener('pagehide',flushPendingSave);
window.addEventListener('beforeunload',flushPendingSave);
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
	{id:'obsidian_sword', name:'Miecz obsydianowy', cost:{obsidian:4, wood:2}, make(){ grantCraftedItem({kind:'weapon',weaponType:'melee',name:'Miecz obsydianowy',attackDamage:6,tier:'rare',desc:'Wykuty z hartowanej lawy'}); }},
	{id:'lucky_charm', name:'Talizman diamentowy', cost:{diamond:3}, make(){ grantCraftedItem({kind:'charm',name:'Talizman diamentowy',mineSpeedMult:1.15,visionRadius:12,tier:'rare',desc:'Diament oszlifowany w talizman'}); }},
	{id:'respawn', name:'Totem odrodzenia', cost:{stone:5, wood:2}, make(){ setRespawnPoint(); }},
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
function buildCraftPanel(){
	const host=document.getElementById('craft'); if(!host) return;
	host.innerHTML='';
	const title=document.createElement('strong'); title.textContent='Rzemiosło'; host.appendChild(title);
	RECIPES.forEach(r=>{
		const b=document.createElement('button'); b.className='craftBtn'; b.id='craft_'+r.id; b.textContent=r.name;
		b.addEventListener('click',()=>doCraft(r));
		const req=document.createElement('div'); req.className='req';
		req.textContent=Object.entries(r.cost).map(([k,v])=>v+' × '+(RES_LABEL[k]||k)).join(' + ');
		host.appendChild(b); host.appendChild(req);
	});
}
function updateCraftButtons(){ RECIPES.forEach(r=>{ const b=document.getElementById('craft_'+r.id); if(!b) return; b.disabled=!canCraft(r); if(r.done && r.done()) b.textContent=r.name+' ✓'; }); }
// Blink moved to engine/eyes.js
function updateBlink(now){ if(EYES && EYES.update) EYES.update(now); }
 // Cape physics: chain with gravity that droops when idle and streams when moving
function initScarf(){ CAPE.init(player); }
function updateCape(dt){ CAPE.update(player,dt,getTile,isSolid); }
function drawCape(){ CAPE.draw(ctx,TILE); }
function drawPlayer(){ const c=MM.customization||{}; const bodyX=(player.x-player.w/2)*TILE; const bodyY=(player.y-player.h/2)*TILE; const bw=player.w*TILE, bh=player.h*TILE;
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
	ctx.fillStyle='rgba(0,0,0,0.25)'; const shw=bw*0.6; ctx.beginPath(); ctx.ellipse(player.x*TILE, (player.y+player.h/2)*TILE+2, shw/2, 4,0,0,Math.PI*2); ctx.fill(); }

// Chunk render cache (offscreen canvas per chunk)
const chunkCanvases = new Map(); // key: chunkX -> {canvas,ctx,version}
function hash32(x,y){ let h = (x|0)*374761393 + (y|0)*668265263; h = (h^(h>>>13))*1274126177; h = h^(h>>>16); return h>>>0; }
function shadeColor(hex,delta){ // hex like #rgb or #rrggbb (we use rrggbb)
	const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
	const clamp=v=>v<0?0:v>255?255:v; const nr=clamp(r+delta), ng=clamp(g+delta), nb=clamp(b+delta);
	return '#'+nr.toString(16).padStart(2,'0')+ng.toString(16).padStart(2,'0')+nb.toString(16).padStart(2,'0'); }
function drawChunkToCache(cx){ const key=cx; const k='c'+cx; const arr=WORLD._world.get(k); if(!arr) return; let entry=chunkCanvases.get(key); if(!entry){
		// each cached chunk holds a full-height canvas (megabytes of pixels) — evict the
		// chunks farthest from the camera so a long trek can't accumulate them forever
		if(chunkCanvases.size>=28){ const keys=[...chunkCanvases.keys()].sort((a,b)=>Math.abs(b-cx)-Math.abs(a-cx)); for(let i=0;i<8 && i<keys.length;i++) chunkCanvases.delete(keys[i]); }
		const c=document.createElement('canvas'); c.width=CHUNK_W*TILE; c.height=WORLD_H*TILE; const cctx=c.getContext('2d'); cctx.imageSmoothingEnabled=false; entry={canvas:c,ctx:cctx,version:-1}; chunkCanvases.set(key,entry); }
	const currentVersion=WORLD.chunkVersion(cx); if(entry.version===currentVersion) return; const cctx=entry.ctx; cctx.clearRect(0,0,cctx.canvas.width,cctx.canvas.height);
		for(let lx=0; lx<CHUNK_W; lx++){
			const wx=cx*CHUNK_W+lx;
			const surf=WORLDGEN.surfaceHeight(wx);
			for(let y=0;y<WORLD_H;y++){
				const t=arr[y*CHUNK_W+lx];
				// TORCH renders as a sprite in the fire.js pass — bake only its backdrop
				if(t===T.AIR || t===T.WATER || t===T.TORCH){
					// Water is rendered by the dynamic fluid layer (springs/waves/caustics), not
					// baked here — only its backdrop is. Underground air or water = carved cave /
					// aquifer: paint a dark rock backdrop so the sky parallax never shows through
					if(y>surf){
						const dd=Math.min(1,(y-surf)/45);
						const hv=hash32(wx,y); const jitter=((hv&15)-8)*0.6;
						const L=Math.max(6, 34-18*dd+jitter);
						cctx.fillStyle='rgb('+Math.round(L*0.92)+','+Math.round(L*0.86)+','+Math.round(L*1.18)+')';
						cctx.fillRect(lx*TILE,y*TILE,TILE,TILE);
					}
					continue;
				}
				let base=INFO[t].color; if(!base) continue;
				const h = hash32(wx,y);
				// Per-type amplitude (diamond fixed, stone extra subtle, grass medium, others default)
				let amp=22; if(t===T.STONE) amp=6; else if(t===T.DIAMOND) amp=0; else if(t===T.WOOD) amp=16; else if(t===T.GRASS) amp=18; else if(t===T.SNOW) amp=8;
				const delta = ((h & 0xFF)/255 - 0.5)*amp; // symmetrical
				const col = amp? shadeColor(base, delta|0) : base; // stone uses low amp so should not drift green
				cctx.fillStyle=col; cctx.fillRect(lx*TILE,y*TILE,TILE,TILE);
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
				// Chest highlight & tier flair
				if(t===T.CHEST_COMMON||t===T.CHEST_RARE||t===T.CHEST_EPIC){
					cctx.save();
					const stroke = t===T.CHEST_EPIC? '#e0b341' : (t===T.CHEST_RARE? '#a74cc9':'#b07f2c');
					cctx.strokeStyle=stroke; cctx.lineWidth=2; cctx.strokeRect(lx*TILE+1,y*TILE+1,TILE-2,TILE-2);
					// inner gradient sheen using simple vertical fade
					const g=cctx.createLinearGradient(lx*TILE,y*TILE,lx*TILE,y*TILE+TILE);
					g.addColorStop(0,'rgba(255,255,255,0.25)'); g.addColorStop(0.5,'rgba(255,255,255,0)'); g.addColorStop(1,'rgba(0,0,0,0.25)');
					cctx.fillStyle=g; cctx.fillRect(lx*TILE+2,y*TILE+2,TILE-4,TILE-4);
					if(((h>>11)&15)<2){ cctx.fillStyle='rgba(255,255,255,0.65)'; cctx.fillRect(lx*TILE+6 + (h&3), y*TILE+6 + ((h>>4)&3),2,2); }
					cctx.restore();
				}
				if(t===T.STONE || t===T.WOOD){ cctx.fillStyle='rgba(0,0,0,0.05)'; cctx.fillRect(lx*TILE + ((h>>8)&3), y*TILE, 2, TILE); }
			}
		}
	entry.version=currentVersion; }
function drawWorldVisible(sx,sy,viewX,viewY){ const minChunk=Math.floor(sx/CHUNK_W)-1; const maxChunk=Math.floor((sx+viewX+2)/CHUNK_W)+1; // prepare caches
	for(let cx=minChunk; cx<=maxChunk; cx++){ WORLD.ensureChunk(cx); drawChunkToCache(cx); }
	// Draw whole chunks that intersect view (avoids per-tile seams)
	const viewPX0 = sx*TILE, viewPX1=(sx+viewX+2)*TILE;
	for(let cx=minChunk; cx<=maxChunk; cx++){
		const entry=chunkCanvases.get(cx); if(!entry) continue; const chunkXpx = cx*CHUNK_W*TILE;
		const chunkRight = chunkXpx + CHUNK_W*TILE; if(chunkRight < viewPX0-CHUNK_W*TILE || chunkXpx > viewPX1+CHUNK_W*TILE) continue;
		ctx.drawImage(entry.canvas, chunkXpx, 0);
	}
		// Chest aura second pass (not cached) for pulsing glow
		const nowA=performance.now();
		for(let cx2=minChunk; cx2<=maxChunk; cx2++){
			for(let lx=0; lx<CHUNK_W; lx++){
				const wx=cx2*CHUNK_W+lx; for(let y=sy; y<sy+viewY+2; y++){ const t=getTile(wx,y); if(t===T.CHEST_COMMON||t===T.CHEST_RARE||t===T.CHEST_EPIC){ const pulse=Math.sin(nowA*0.004 + wx*0.7 + y*0.3)*0.5+0.5; const rad=TILE*0.6 + pulse*TILE*0.25; const cxp=wx*TILE+TILE/2; const cyp=y*TILE+TILE/2; const g=ctx.createRadialGradient(cxp,cyp,rad*0.2,cxp,cyp,rad); const col = t===T.CHEST_EPIC? 'rgba(224,179,65,' : (t===T.CHEST_RARE? 'rgba(167,76,201,' : 'rgba(176,127,44,'); g.addColorStop(0,col+(0.45+0.35*pulse)+(chestDebug?0.15:0)+')'); g.addColorStop(1,col+'0)'); ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cxp,cyp,rad*(chestDebug?1.15:1),0,Math.PI*2); ctx.fill(); if(chestDebug){ ctx.strokeStyle='#fff'; ctx.lineWidth=1; ctx.strokeRect(wx*TILE+1,y*TILE+1,TILE-2,TILE-2); } } }
			}
		}
		if(chestDebug){ const pcx=Math.floor(player.x/CHUNK_W); const cnt=countChestsAround(pcx,4); ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(sx*TILE+6, sy*TILE+6, 140,24); ctx.fillStyle='#fff'; ctx.font='14px system-ui'; ctx.fillText('Skrzynie ±4: '+cnt, sx*TILE+12, sy*TILE+24); }
	 // Apply fog overlay only for unseen tiles (module)
	 if(FOG && FOG.applyOverlay){ FOG.applyOverlay(ctx, sx, sy, viewX, viewY, TILE, getTile, T); }
	if(VISUAL.animations && GRASS && GRASS.drawOverlays){ GRASS.drawOverlays(ctx,'back', sx,sy,viewX,viewY,TILE,WORLD_H,getTile,T,zoom,grassDensityScalar,grassHeightScalar); }
}

// Input + tryby specjalne
const keys={}; let godMode=false; const keysOnce=new Set();
let fireBtnHeld=false; // declared with the other input state — the blur handler below references it
let paused=false;      // B toggles; the loop keeps drawing but freezes the simulation
let showMinimap=true;  // N toggles the surface minimap
// Debug overlay toggle (F3)
let showPerfHud = false;
// Chest debug helpers
let chestDebug=false; // toggled to highlight chests strongly
function countChestsInChunk(cx){ 
	const k='c'+cx; 
	const arr=WORLD._world.get(k); 
	if(!arr || !Array.isArray(arr)) return 0; 
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
	const it=(INV && INV.equippedItem)? INV.equippedItem('weapon'):null;
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
window.addEventListener('keydown',e=>{ if(isEditableTarget(e.target)) return; const k=e.key.toLowerCase(); keys[k]=true; if(k==='escape'){ closeHotSelect(); }
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
	if(k==='h'&&!keysOnce.has('h')){ toggleHelp(); keysOnce.add('h'); }
	if(k==='v'&&!keysOnce.has('v')){ window.__mobDebug = !window.__mobDebug; msg('Mob debug '+(window.__mobDebug?'ON':'OFF')); keysOnce.add('v'); }
	if(k==='b'&&!keysOnce.has('b')){ paused=!paused; keysOnce.add('b'); }
	if(k==='n'&&!keysOnce.has('n')){ showMinimap=!showMinimap; msg('Minimapa '+(showMinimap?'ON':'OFF')); keysOnce.add('n'); }
	if(['arrowup','arrowdown','w',' '].includes(k)) e.preventDefault(); });
window.addEventListener('keyup',e=>{ const k=e.key.toLowerCase(); keys[k]=false; keysOnce.delete(k); });
// Losing focus while keys are held would leave the player running forever — release everything
window.addEventListener('blur',()=>{ for(const k in keys) keys[k]=false; keysOnce.clear(); stopMining(); minePointerId=null; mineBtnHeld=false; fireBtnHeld=false; activePointers.clear(); pinch=null; });

// Kierunek kopania
let mineDir={dx:1,dy:0}; document.querySelectorAll('.dirbtn').forEach(b=>{ b.addEventListener('click',()=>{ mineDir.dx=+b.getAttribute('data-dx'); mineDir.dy=+b.getAttribute('data-dy'); document.querySelectorAll('.dirbtn').forEach(o=>o.classList.remove('sel')); b.classList.add('sel'); }); }); document.querySelector('.dirbtn[data-dx="1"][data-dy="0"]').classList.add('sel');

// Pad dotykowy
function bindPad(){ document.querySelectorAll('#pad .btn').forEach(btn=>{ const code=btn.getAttribute('data-key'); if(!code) return; btn.addEventListener('pointerdown',ev=>{ ev.preventDefault(); keys[code.toLowerCase()]=true; btn.classList.add('on'); if(code==='ArrowUp') keys['w']=true; }); ['pointerup','pointerleave','pointercancel'].forEach(evName=> btn.addEventListener(evName,()=>{ keys[code.toLowerCase()]=false; btn.classList.remove('on'); if(code==='ArrowUp') keys['w']=false; })); }); } bindPad();

// Kamera
let camX=0,camY=0,camSX=0,camSY=0; let zoom=1, zoomTarget=1; function ensureChunks(){ const pcx=Math.floor(player.x/CHUNK_W); for(let d=-2; d<=2; d++) ensureChunk(pcx+d); }
function clampZoom(z){ return Math.min(3, Math.max(0.5, z)); }
function setZoom(z){ zoomTarget = clampZoom(z); }
function nudgeZoom(f){ setZoom(zoomTarget * f); }
canvas.addEventListener('wheel',e=>{ if(e.ctrlKey){ // let browser zoom work
	return; }
	e.preventDefault(); const dir = e.deltaY>0?1:-1; const factor = dir>0? 1/1.1 : 1.1; nudgeZoom(factor);
},{passive:false});
window.addEventListener('keydown',e=>{ if(isEditableTarget(e.target)) return; if(e.key==='+'||e.key==='='||e.key===']'){ nudgeZoom(1.1); }
	if(e.key==='-'||e.key==='['){ nudgeZoom(1/1.1); }
});

// Fizyka
// Movement constants imported from canonical constants module
let jumpPrev=false; let swimBuoySmooth=0; let wasInWater=false; let bubbleAcc=0; let swimWakeAcc=0;
// Jump feel: a press is buffered for a short window instead of being consumed on
// the exact frame it arrives (presses used to die silently on micro-airborne
// frames over rough terrain → "I have to press jump twice"). Coyote time keeps a
// ground jump valid just after stepping off a ledge. swimLeapT marks a recent
// water-surface leap so the swim speed clamp doesn't strangle it.
const JUMP_BUFFER=0.12, COYOTE_TIME=0.1;
let jumpBufferT=0, coyoteT=0, swimLeapT=0;
function physics(dt){
	// Horizontal input
	let input=0; if(keys['a']||keys['arrowleft']) input-=1; if(keys['d']||keys['arrowright']) input+=1; if(input!==0) player.facing=input;
	// Combine all movement multipliers, including dropdown.
	// Mud (hosed-down sand) bogs the hero to half pace while standing on it.
	const onMud = getTile(Math.floor(player.x), Math.floor(player.y+player.h/2+0.05))===T.MUD;
	const moveMult = ((MM.activeModifiers && MM.activeModifiers.moveSpeedMult)||1) * (window.playerSpeedMultiplier || 2) * (onMud?0.5:1);
	const target=input*MOVE.MAX*moveMult; const diff=target-player.vx; const accel=MOVE.ACC*dt*Math.sign(diff)*moveMult;
	if(target!==0){ if(Math.abs(accel)>Math.abs(diff)) player.vx=target; else player.vx+=accel; } else { const fr=MOVE.FRICTION*dt*moveMult; if(Math.abs(player.vx)<=fr) player.vx=0; else player.vx-=fr*Math.sign(player.vx); }

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
	const diveInput = keys['s']||keys['arrowdown'];
	const jumpNow=(keys['w']||keys['arrowup']||keys[' ']);

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
		const desiredSub = diveInput? 0.88 : 0.66; // target fraction of body submerged
		const neutralPoint = 0.50; // submersion where gravity mostly neutralizes
		const gravScale = 1 - subFrac*0.82; // deeper -> less gravity
		const gravMult = (window.playerSpeedMultiplier || 2);
		player.vy += MOVE.GRAV * gravMult * gravScale * dt;
		// PD controller: proportional on immersion error, derivative on vertical velocity
		const error = desiredSub - subFrac; // positive -> need to sink more, negative -> need to rise
		const Kp = diveInput? 55 : 70; // strong proportional for crisp float
		const Kd = diveInput? 7 : 9;  // damping
		let buoyAccel = (error * Kp) - (player.vy * Kd);
		// Additional lift when past neutral and not diving (prevents creeping downward)
		const excess = subFrac - neutralPoint; if(excess>0 && !diveInput) buoyAccel -= excess * 30;
		// Micro wave variation
		const wave = Math.sin(time*0.0012 + player.x*0.3)*0.6 + Math.sin(time*0.00047 + player.x*0.07 + player.y*0.11)*0.4;
		buoyAccel += wave * 0.8; // ~ -0.8..0.8
		if(diveInput) buoyAccel *= 0.5; // still allow descent when diving
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
		const maxDown=2.8, maxUp=9.0; if(player.vy>maxDown) player.vy=maxDown; if(player.vy<-maxUp && swimLeapT<=0) player.vy=-maxUp;
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

// Mgła / widoczność moved to engine/fog.js
function revealAround(){ const m=MM.activeModifiers||{}; const r = (typeof m.visionRadius==='number')? m.visionRadius : 10; if(FOG && FOG.revealAround) FOG.revealAround(player.x, player.y, r); }

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
// Multi-touch bookkeeping: pointers currently down on the canvas (for pinch zoom)
const activePointers=new Map(); let pinch=null;

// Kopanie (kierunkowe + wskazywane kursorem)
const MINE_REACH=3; // Chebyshev tile distance for cursor mining (matches attack range)
let mining=false,mineTimer=0,mineTx=0,mineTy=0; const mineBtn=document.getElementById('mineBtn');
let minePointerId=null;   // pointer that initiated cursor mining (left button / touch on canvas)
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
	if(!withinReach(tx,ty,MINE_REACH)){ if(!quiet) msg('Za daleko'); return false; }
	const t=getTile(tx,ty);
	if(t===T.AIR) return false;
	if(INFO[t] && INFO[t].chestTier){ if(quiet) return false; return tryOpenChestAt(tx,ty); }
	mining=true; mineTimer=0; mineTx=tx; mineTy=ty; mineBtn.classList.add('on');
	if(godMode) instantBreak();
	return true;
}
function startMine(){ const tx=Math.floor(player.x + mineDir.dx + (mineDir.dx>0?player.w/2:mineDir.dx<0?-player.w/2:0)); const ty=Math.floor(player.y + mineDir.dy); const t=getTile(tx,ty); if(t===T.AIR) return; if(INFO[t] && INFO[t].chestTier){ tryOpenChestAt(tx,ty); return; } mining=true; mineTimer=0; mineTx=tx; mineTy=ty; mineBtn.classList.add('on'); if(godMode) instantBreak(); }
mineBtn.addEventListener('pointerdown',e=>{ e.preventDefault(); mineBtnHeld=true; startMine(); });
['pointerup','pointerleave','pointercancel'].forEach(evName=> mineBtn.addEventListener(evName,()=>{ mineBtnHeld=false; stopMining(); }));
// Weapon fire button (touch): hold to use the equipped weapon in the facing direction
const fireBtn=document.getElementById('fireBtn');
if(fireBtn){
	fireBtn.addEventListener('pointerdown',e=>{ e.preventDefault(); fireBtnHeld=true; fireBtn.classList.add('on'); });
	['pointerup','pointerleave','pointercancel'].forEach(evName=> fireBtn.addEventListener(evName,()=>{ fireBtnHeld=false; fireBtn.classList.remove('on'); }));
	// Icon reflects the equipped weapon class
	function refreshFireBtn(){
		const it=(MM.inventory && MM.inventory.equippedItem)? MM.inventory.equippedItem('weapon'):null;
		const type=(it && it.weaponType)||'melee';
		fireBtn.textContent= type==='bow'? '🏹' : type==='flame'? '🔥' : type==='hose'? '💧' : type==='gas'? '☠️' : '⚔️';
		fireBtn.title='Użyj broni (F)'+(it? ' – '+(it.name||it.id):'');
	}
	refreshFireBtn();
	window.addEventListener('mm-customization-change',refreshFireBtn);
}
// Only the pointer that started cursor mining may stop it — releasing another finger
// (e.g. a movement button on the touch pad) must not cancel digging.
window.addEventListener('pointerup',e=>{ activePointers.delete(e.pointerId); if(activePointers.size<2) pinch=null; if(e.pointerId===minePointerId){ minePointerId=null; if(!mineBtnHeld) stopMining(); } });
window.addEventListener('pointercancel',e=>{ activePointers.delete(e.pointerId); if(activePointers.size<2) pinch=null; if(e.pointerId===minePointerId){ minePointerId=null; if(!mineBtnHeld) stopMining(); } });
function instantBreak(){ if(getTile(mineTx,mineTy)===T.AIR){ mining=false; mineBtn.classList.remove('on'); return; } const tId=getTile(mineTx,mineTy); if(tId===T.WOOD && isTreeBase(mineTx,mineTy)){ if(startTreeFall(mineTx,mineTy)){ mining=false; mineBtn.classList.remove('on'); return; } } const fellAbove = tId===T.WOOD && getTile(mineTx,mineTy-1)===T.WOOD; const info=INFO[tId]; const drop=info.drop; setTile(mineTx,mineTy,T.AIR); if(drop) inv[drop]=(inv[drop]||0)+1; if(fellAbove) startTreeFall(mineTx,mineTy-1); if(FALLING && FALLING.onTileRemoved) FALLING.onTileRemoved(mineTx,mineTy); if(WATER && WATER.onTileChanged) WATER.onTileChanged(mineTx,mineTy,getTile); pushUndo(mineTx,mineTy,tId,T.AIR,'break'); mining=false; mineBtn.classList.remove('on'); updateInventory(); }
// Falling tree system (per-block physics)
function isTreeBase(x,y){ return TREES.isTreeBase(getTile,x,y); }
function startTreeFall(bx,by){ return TREES.startTreeFall(getTile,setTile,player.facing,bx,by); }
function updateFallingBlocks(dt){ TREES.updateFallingBlocks(getTile,setTile,dt); }
function drawFallingBlocks(){ TREES.drawFallingBlocks(ctx,TILE,INFO); }
// While the initiating pointer/⛏️ stays held, mining continues: the ⛏️ button keeps digging in
// its direction, a held left button re-aims at whatever tile is under the cursor (drag mining).
function resumeHeldMining(){
	if(mineBtnHeld){ startMine(); return; }
	if(minePointerId!=null && lastPointer.has){ const p=screenToWorldTile(lastPointer.x,lastPointer.y); startMineAt(p.tx,p.ty,{quiet:true}); }
}
function updateMining(dt){
	if(!mining){ resumeHeldMining(); if(!mining) return; }
	if(getTile(mineTx,mineTy)===T.AIR){ stopMining(); resumeHeldMining(); if(!mining) return; }
	if(godMode){ instantBreak(); return; }
	try{ if(MM.audio && MM.audio.play) MM.audio.play('dig'); }catch(e){}
	// Drag mining: if the held cursor moved to a different tile, re-target immediately
	if(minePointerId!=null && !mineBtnHeld && lastPointer.has){
		const p=screenToWorldTile(lastPointer.x,lastPointer.y);
		if((p.tx!==mineTx||p.ty!==mineTy) && withinReach(p.tx,p.ty,MINE_REACH) && getTile(p.tx,p.ty)!==T.AIR && !(INFO[getTile(p.tx,p.ty)]&&INFO[getTile(p.tx,p.ty)].chestTier)){ mineTx=p.tx; mineTy=p.ty; mineTimer=0; }
	}
	const mineMult=(MM.activeModifiers && MM.activeModifiers.mineSpeedMult)||1; mineTimer += dt * tools[player.tool] * mineMult; const curId=getTile(mineTx,mineTy); const info=INFO[curId]; const need=Math.max(0.1, info.hp/6); if(mineTimer>=need){ if(curId===T.WOOD && isTreeBase(mineTx,mineTy)){ if(startTreeFall(mineTx,mineTy)){ stopMining(); return; } } const fellAbove = curId===T.WOOD && getTile(mineTx,mineTy-1)===T.WOOD; const drop=info.drop; setTile(mineTx,mineTy,T.AIR); if(drop) inv[drop]=(inv[drop]||0)+1; if(fellAbove) startTreeFall(mineTx,mineTy-1); if(FALLING && FALLING.onTileRemoved) FALLING.onTileRemoved(mineTx,mineTy); if(WATER && WATER.onTileChanged) WATER.onTileChanged(mineTx,mineTy,getTile); pushUndo(mineTx,mineTy,curId,T.AIR,'break'); stopMining(); updateInventory(); try{ if(MM.audio && MM.audio.play) MM.audio.play('break'); }catch(e){} resumeHeldMining(); } }

// --- Placement ---
// Suppress accidental placement immediately after opening a chest with right-click
let lastChestOpen={t:0,x:0,y:0};
const CHEST_PLACE_SUPPRESS_MS=250; // extended to reduce accidental placements
const PLACE_REACH=5; // build reach in tiles (Chebyshev); god mode is unlimited
let lastRightPlaceT=0; // right-button pointerdown already placed for this gesture (contextmenu dedupe)
canvas.addEventListener('contextmenu',e=>{ e.preventDefault(); const now=performance.now();
	// Right mouse button is handled on pointerdown; contextmenu remains only for touch long-press.
	if(now-lastRightPlaceT<400) return;
	if(now-lastChestOpen.t<CHEST_PLACE_SUPPRESS_MS) return;
	// Touch long-press: the initial touch started cursor mining — cancel it before placing
	if(minePointerId!=null){ minePointerId=null; stopMining(); }
	const p=screenToWorldTile(e.clientX,e.clientY); tryPlace(p.tx,p.ty); });
// Placeability is exactly "the resource registry maps this tile" (diamond has
// tile:null → mined-only; MUD/LAVA/GRAVE aren't resources at all)
function haveBlocksFor(tileId){ const k=TILE_TO_RES[tileId]; return !!k && (inv[k]||0)>0; }
function consumeFor(tileId){ if(godMode) return; const k=TILE_TO_RES[tileId]; if(k) inv[k]--; }
// Single source of truth for "can a block go here" — used by tryPlace AND the ghost preview,
// so the preview can never show a placement that would then be rejected.
function canPlaceAt(tx,ty){
	const cur=getTile(tx,ty);
	const selName=HOTBAR_ORDER[hotbarIndex];
	const chest=isChestSelection(selName);
	const id= chest? T[selName] : selectedTileId();
	// Solid blocks may also replace water (building under water); water into water is a no-op
	if(cur!==T.AIR && cur!==T.WATER) return {ok:false};
	if(cur===T.WATER && id===T.WATER) return {ok:false};
	// Tile [tx,tx+1)×[ty,ty+1) vs player AABB — full-tile overlap test
	if(tx+1 > player.x - player.w/2 && tx < player.x + player.w/2 && ty+1 > player.y - player.h/2 && ty < player.y + player.h/2) return {ok:false};
	if(chest && !godMode) return {ok:false, reason:'Tylko w trybie Boga'};
	if(!godMode && !withinReach(tx,ty,PLACE_REACH)) return {ok:false, reason:'Za daleko'};
	if(!chest && !godMode && id!==T.SAND && id!==T.WATER){
		// Support: anything below, or a non-fluid neighbour on either side / above (wall & ceiling builds)
		const below=getTile(tx,ty+1);
		const support = below!==T.AIR
			|| [[1,0],[-1,0],[0,-1]].some(([dx,dy])=>{ const n=getTile(tx+dx,ty+dy); return n!==T.AIR && n!==T.WATER; });
		if(!support) return {ok:false, reason:'Brak podparcia'};
	}
	if(!chest && !haveBlocksFor(id)) return {ok:false, reason:'Brak bloków'};
	return {ok:true, id, chest, replacedWater:cur===T.WATER};
}
function tryPlace(tx,ty){
	const v=canPlaceAt(tx,ty);
	if(!v.ok){ if(v.reason) msg(v.reason); return; }
	const id=v.id; const prev=getTile(tx,ty);
	if(v.chest){ setTile(tx,ty,id); return; }
	pushUndo(tx,ty,prev,id,'place');
	setTile(tx,ty,id); consumeFor(id); updateInventory(); updateHotbarCounts(); saveState();
	try{ if(MM.audio && MM.audio.play) MM.audio.play('place'); }catch(e){}
	if(WATER){ if(id===T.WATER) WATER.addSource(tx,ty,getTile,setTile); else if(v.replacedWater && WATER.onTileChanged) WATER.onTileChanged(tx,ty,getTile); }
	// Queue a stability check: unsupported sand starts falling, stone placed without a
	// load path collapses as a cluster, etc. (event-driven in engine/falling.js)
	if(FALLING && FALLING.afterPlacement) FALLING.afterPlacement(tx,ty);
}
function updateHotbarCounts(){ RESOURCE_DEFS.forEach(r=>{ if(!r.tile) return; const el=document.getElementById('hotCnt'+r.tile); if(el) el.textContent=inv[r.key]; }); }
function updateHotbarSel(){ document.querySelectorAll('.hotSlot').forEach((el,i)=>{ if(i===hotbarIndex) el.classList.add('sel'); else el.classList.remove('sel'); }); }
// --- Undo system for tile edits ---
const UNDO_LIMIT=200; const undoStack=[]; // {x,y,oldId,newId,kind}
function invKeyForTile(id){ return TILE_TO_RES[id]||null; }
function pushUndo(x,y,oldId,newId,kind){ 
	if(oldId===newId) return; 
	undoStack.push({x,y,oldId,newId,kind}); 
	if(undoStack.length>UNDO_LIMIT){
		undoStack.shift(); 
	}
}
function undoLastChange(){ const e=undoStack.pop(); if(!e){ msg('Brak zmian'); return; } const cur=getTile(e.x,e.y); if(cur!==e.newId){ msg('Nie można cofnąć'); return; } if(e.kind==='place'){ setTile(e.x,e.y,e.oldId); const k=invKeyForTile(e.newId); if(k && !godMode) inv[k] = (inv[k]||0)+1; } else if(e.kind==='break'){ setTile(e.x,e.y,e.oldId); const info=INFO[e.oldId]; if(info && info.drop && inv[info.drop]>0 && !godMode) inv[info.drop]--; } if(FALLING && FALLING.recheckNeighborhood) FALLING.recheckNeighborhood(e.x,e.y); if(WATER && WATER.onTileChanged) WATER.onTileChanged(e.x,e.y,getTile); updateInventory(); updateHotbarCounts(); saveState(); msg('Cofnięto'); }
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
function spawnBurst(x,y,tier){ if(PARTICLES && PARTICLES.spawnBurst) PARTICLES.spawnBurst(x,y,tier); }
function updateParticles(dt){ if(PARTICLES && PARTICLES.update) PARTICLES.update(dt,TILE); }
function drawParticles(){ if(PARTICLES && PARTICLES.draw) PARTICLES.draw(ctx); }

canvas.addEventListener('pointerdown',e=>{
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
	if(e.button===0){
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
		if(performance.now()-lastChestOpen.t>=CHEST_PLACE_SUPPRESS_MS) tryPlace(tx,ty);
	}
});
canvas.addEventListener('pointermove',e=>{
	lastPointer.x=e.clientX; lastPointer.y=e.clientY; lastPointer.has=true;
	const ap=activePointers.get(e.pointerId);
	if(ap){ ap.x=e.clientX; ap.y=e.clientY;
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
 // Draw biome name in top panel (next to axe)
 if(typeof WORLDGEN !== 'undefined' && WORLDGEN && WORLDGEN.biomeType && typeof player !== 'undefined') {
 	 const biomeId = WORLDGEN.biomeType(Math.floor(player.x));
	 const biomeName = BIOME_NAMES[biomeId] || 'Unknown';
	 ctx.save();
	 ctx.font = '18px Arial';
	 ctx.fillStyle = '#222';
	 ctx.textAlign = 'left';
	 ctx.fillText('Biome: ' + biomeName, 180, 38); // adjust X as needed to fit next to axe
	 ctx.restore();
 }
 // living plants (rooted vegetation over terrain, under fire/creatures)
 if(PLANTS && PLANTS.draw) PLANTS.draw(ctx,TILE,sx,sy,viewX,viewY);
 // burning tiles + lava glow (flames over terrain, under mobs so creatures stay readable)
 if(FIRE && FIRE.draw) FIRE.draw(ctx,TILE,sx,sy,viewX,viewY,getTile);
 // ruin surface markers dressed as worked masonry (mortar, moss, etched rune)
 if(RUINS && RUINS.drawHints) RUINS.drawHints(ctx,TILE);
 // ruin-trap telltales + live effects (darts, gas) — over tiles, under mobs
 if(TRAPS && TRAPS.draw) TRAPS.draw(ctx,TILE);
 // mobs
 if(MOBS && MOBS.draw) MOBS.draw(ctx,TILE,camX,camY,zoom);
 // boss monsters (multi-part procedural creatures, world-space)
 if(BOSSES && BOSSES.draw) BOSSES.draw(ctx,TILE);
 // visiting saucer + tractor beam (above creatures — the beam shines over its victim)
 if(UFO && UFO.draw) UFO.draw(ctx,TILE);
 // weapon projectiles: arrows + flamethrower stream (above creatures)
 if(WEAPONS && WEAPONS.draw) WEAPONS.draw(ctx,TILE);
 // particles (screen-space in world coords)
 drawParticles();
 // front vegetation pass (blades/leaves that should appear in front)
 if(VISUAL.animations && GRASS && GRASS.drawOverlays){ GRASS.drawOverlays(ctx,'front', sx,sy,viewX,viewY,TILE,WORLD_H,getTile,T,zoom,grassDensityScalar,grassHeightScalar); }
 // Water overlay shimmer (after vegetation front to avoid overdraw? place before falling solids for clarity)
 if(WATER){ WATER.drawOverlay(ctx,TILE,getTile,sx,sy,viewX,viewY); }
 // Draw falling solids after terrain so they appear on top
 if(FALLING){ FALLING.draw(ctx,TILE); }
 // Ghost block preview — recomputed each frame so camera motion can't leave it stale.
 // Green = placement allowed right now; red = blocked (reach/support/no blocks).
 if(lastPointer.has && !pinch && !mining){
	 const gp=screenToWorldTile(lastPointer.x,lastPointer.y);
	 const curT=getTile(gp.tx,gp.ty);
	 if(curT===T.AIR || curT===T.WATER){
		 const v=canPlaceAt(gp.tx,gp.ty);
		 ctx.strokeStyle= v.ok? 'rgba(140,255,140,0.7)':'rgba(255,110,110,0.6)';
		 ctx.lineWidth=1;
		 ctx.strokeRect(gp.tx*TILE+0.5, gp.ty*TILE+0.5, TILE-1, TILE-1);
	 }
 }
 if(mining){ ctx.strokeStyle='#fff'; ctx.strokeRect(mineTx*TILE+1,mineTy*TILE+1,TILE-2,TILE-2); const info=INFO[getTile(mineTx,mineTy)]||{hp:1}; const need=Math.max(0.1,info.hp/6); const p=mineTimer/need; ctx.fillStyle='rgba(255,255,255,.3)'; ctx.fillRect(mineTx*TILE, mineTy*TILE + (1-p)*TILE, TILE, p*TILE); }
 ctx.restore();
	// (Underwater tint/vignette removed: darkening the screen while submerged
	// added no information and players found it distracting.)
	// Screen-space atmospheric tint (after world scaling restore)
	applyAtmosphericTint();
	// Off-screen monster pointer (screen space, after the world transform is gone)
	if(BOSSES && BOSSES.drawHUD) BOSSES.drawHUD(ctx,W,H,camRenderX,camRenderY,zoom,TILE);
	// HUD: health bar
	ctx.save(); const barW=200, barH=18; const pad=12; const x=pad, y=H - barH - pad - 14; ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(x,y,barW,barH); const frac=player.hp/player.maxHp; const g=ctx.createLinearGradient(x,y,x+barW,y); g.addColorStop(0,'#ff3636'); g.addColorStop(1,'#ff9a3d'); ctx.fillStyle=g; ctx.fillRect(x,y,Math.max(0,barW*frac),barH); ctx.strokeStyle='rgba(255,255,255,0.3)'; ctx.lineWidth=2; ctx.strokeRect(x,y,barW,barH); ctx.fillStyle='#fff'; ctx.font='12px system-ui'; ctx.fillText('HP '+player.hp+' / '+player.maxHp, x+8, y-4);
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
			const cm = (CLOUDS && CLOUDS.metrics)? CLOUDS.metrics() : null;
			if(cm){ lines.push('Weather: '+cm.clouds+' clouds ('+cm.cloudMass.toFixed(1)+'m)  vapor '+cm.vapor.toFixed(1)+'  wind '+cm.wind.toFixed(2)+' t/s  drops '+cm.drops+'  strikes '+cm.strikes+(cm.storm && cm.storm.active? '  STORM '+Math.round(cm.storm.intensity*100)+'% ('+Math.round(cm.storm.tLeft)+'s)':'')); }
		}catch(e){}
		const boxW = 370; const lineH=16; const boxH = 8 + lines.length*lineH + 6; const boxX=10; const boxY=10;
		ctx.save();
		ctx.fillStyle='rgba(0,0,0,0.58)'; ctx.fillRect(boxX,boxY,boxW,boxH);
		ctx.strokeStyle='rgba(255,255,255,0.2)'; ctx.lineWidth=1; ctx.strokeRect(boxX,boxY,boxW,boxH);
		ctx.fillStyle='#fff'; ctx.font='12px system-ui'; ctx.textBaseline='top';
		lines.forEach((ln,i)=>{ ctx.fillText(ln, boxX+8, boxY+6+i*lineH); });
		ctx.restore();
	}
}

// --- Minimap: a surface profile of ±220 columns around the hero (N toggles).
// Rebuilt to an offscreen canvas twice a second; blitted under the FPS panel.
let mmCanvas=null, mmLastBuild=0;
function drawMinimap(){
	if(!showMinimap) return;
	const MW=220, MH=64, RANGE=220;
	if(!mmCanvas){ mmCanvas=document.createElement('canvas'); mmCanvas.width=MW; mmCanvas.height=MH; }
	const now=performance.now();
	if(now-mmLastBuild>500){
		mmLastBuild=now;
		const g=mmCanvas.getContext('2d');
		g.fillStyle='rgba(8,12,20,0.92)'; g.fillRect(0,0,MW,MH);
		const cx=Math.floor(player.x);
		const rowToY=(row)=>Math.max(2, Math.min(MH-2, Math.round((row-14)*(MH-8)/86)+4));
		const seaY=rowToY((WORLDGEN.settings && WORLDGEN.settings.seaLevel)||62);
		for(let i=0;i<MW;i++){
			const wx=cx + Math.round((i-MW/2)*(RANGE*2)/MW);
			const s=WORLDGEN.surfaceHeight(wx), b=WORLDGEN.biomeType(wx);
			const yy=rowToY(s);
			const col= b===3? '#d8c27a' : b===2? '#cfe8ff' : b===7? '#9aa0ab' : (b===5||b===6)? '#7a6a4a' : '#3f9b3f';
			g.fillStyle=col; g.fillRect(i,yy,1,MH-yy);
			if((b===5||b===6) && seaY<yy){ g.fillStyle='#1b5fd2'; g.fillRect(i,seaY,1,yy-seaY); } // water column
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
const el={pick:document.getElementById('pick'),fps:document.getElementById('fps'),msg:document.getElementById('messages')};
RESOURCE_KEYS.forEach(k=>{ el[k]=document.getElementById(k); }); // HUD counters share the resource keys as element ids
function updateInventory(){ RESOURCE_KEYS.forEach(k=>{ if(el[k]) el[k].textContent=inv[k]; }); el.pick.textContent=PICK_LABELS[player.tool]||player.tool; updateCraftButtons(); updateHotbarCounts(); updateWeaponBar(); saveState(); try{ window.dispatchEvent(new CustomEvent('mm-resources-change')); }catch(e){} }
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
// Inject debug time-of-day slider (non-intrusive) at end of menu only once
if(MM.ui && MM.ui.injectTimeSlider) MM.ui.injectTimeSlider(menuPanel);
if(MM.ui && MM.ui.injectMobSpawnPanel) MM.ui.injectMobSpawnPanel((id)=>{
	if(MOBS && MOBS.forceSpawn){ const ok=MOBS.forceSpawn(id, player, getTile); if(ok) msg('Spawn '+id); }
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
	mining=false; if(FALLING && FALLING.reset) FALLING.reset(); if(WATER && WATER.reset) WATER.reset(); if(CLOUDS && CLOUDS.reset) CLOUDS.reset(); if(BOSSES && BOSSES.reset) BOSSES.reset(); if(MM.trees && MM.trees._fallingBlocks) MM.trees._fallingBlocks.length=0; if(GRASS && GRASS.reset) GRASS.reset(); if(PARTICLES && PARTICLES.reset) PARTICLES.reset(); if(FIRE && FIRE.reset) FIRE.reset(); if(WEAPONS && WEAPONS.reset) WEAPONS.reset(); if(PLANTS && PLANTS.reset) PLANTS.reset();

	// Reset inventory/tools/hotbar
	RESOURCE_KEYS.forEach(k=>{ inv[k]=0; }); inv.tools.stone=inv.tools.diamond=false; player.tool='basic'; hotbarIndex=0; // if god mode active, restore 100 stack after reset
	// Fresh world = fresh hero arc: XP, level, skill points and milestones restart
	player.xp=0; if(PROGRESS && PROGRESS.reset) PROGRESS.reset(); respawnPoint=null; saveRespawnPoint(); grave=null; saveGrave();
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
const loaded=loadGame();
if(!loaded){ placePlayer(); } else { centerOnPlayer(); }
updateInventory(); updateGodBtn(); if(MM.ui && MM.ui.updateMapButton && FOG && FOG.getRevealAll) MM.ui.updateMapButton(FOG.getRevealAll()); updateHotbarSel(); updateWeaponBar(); if(!loaded) msg('Sterowanie: A/D/W + LPM kopie, PPM stawia (5-9, 0 wybór). 1=Kilof 2=Broń biała 3=Łuk 4=Miotacz, E=Ekwipunek, F=Broń, G=Bóg, M=Mapa, C=Centrum, H=Pomoc'); else msg('Wczytano zapis – miłej gry!');
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
 let last=performance.now(); let lastFrameMs=0; let lastLoopErrAt=0; function loop(ts){ const dt=Math.min(0.05,(ts-last)/1000); last=ts; lastFrameMs=dt*1000; // smooth zoom interpolation
	// the whole frame is guarded: one bad subsystem tick must skip a frame, not kill
	// the rAF chain with an uncaught error (e.g. a cache blowing its size limit)
	try{
		if(Math.abs(zoomTarget-zoom)>0.0001){ zoom += (zoomTarget-zoom)*Math.min(1, dt*8); }
		if(!paused){
			physics(dt); if(player.atkCd>0) player.atkCd-=dt;
			// Weapon use: F key (aims at cursor) or the touch ⚔️ button (aims in facing direction)
			if((keys['f']||fireBtnHeld) && WEAPONS && WEAPONS.fireHeld){
				const aim=(lastPointer.has && !fireBtnHeld)? screenToWorld(lastPointer.x,lastPointer.y) : {x:player.x+player.facing*5, y:player.y-0.4};
				WEAPONS.fireHeld(player, aim.x, aim.y, dt);
			}
			if(WEAPONS && WEAPONS.update) WEAPONS.update(dt, getTile, setTile);
			if(FIRE && FIRE.update) FIRE.update(getTile, setTile, dt);
			if(PLANTS && PLANTS.update) PLANTS.update(getTile, setTile, dt);
			if(PROGRESS && PROGRESS.update) PROGRESS.update(dt);
			updateMining(dt); updateFallingBlocks(dt); if(FALLING && FALLING.update) FALLING.update(getTile,setTile,dt); if(WATER && WATER.update) WATER.update(getTile,setTile,dt); if(CLOUDS && CLOUDS.update) CLOUDS.update(getTile,setTile,dt); if(BOSSES && BOSSES.update) BOSSES.update(getTile,setTile,dt); if(MOBS && MOBS.update) MOBS.update(dt, player, getTile); if(UFO && UFO.update) UFO.update(dt, player); if(TRAPS && TRAPS.update) TRAPS.update(dt, player, getTile, setTile); updateParticles(dt); updateCape(dt); updateBlink(ts);
		}
		if(AUDIO && AUDIO.update) AUDIO.update(dt);
		draw();
		if(paused){
			ctx.save();
			ctx.fillStyle='rgba(5,8,14,0.45)'; ctx.fillRect(0,0,W,H);
			ctx.fillStyle='#fff'; ctx.font='bold 28px system-ui'; ctx.textAlign='center';
			ctx.fillText('⏸ PAUZA', W/2, H/2-8);
			ctx.font='13px system-ui'; ctx.fillText('Naciśnij B, aby wznowić', W/2, H/2+18);
			ctx.restore();
		}
		if(MM.ui && MM.ui.setRadarPulsing) MM.ui.setRadarPulsing(ts<radarFlash); updateFps(ts);
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
window.regenWorldSameSeed = function(){ try{ if(MOBS && MOBS.clearAll) try{ MOBS.clearAll(); }catch(e){} if(WORLD && WORLD.clear) WORLD.clear(); if(typeof chunkCanvases!=='undefined') chunkCanvases.clear(); if(WORLD && WORLD.clearHeights) WORLD.clearHeights(); if(FALLING && FALLING.reset) FALLING.reset(); if(WATER && WATER.reset) WATER.reset(); if(CLOUDS && CLOUDS.reset) CLOUDS.reset(); if(BOSSES && BOSSES.reset) BOSSES.reset(); if(MM.trees && MM.trees._fallingBlocks) MM.trees._fallingBlocks.length=0; if(GRASS && GRASS.reset) GRASS.reset(); if(PARTICLES && PARTICLES.reset) PARTICLES.reset(); if(FIRE && FIRE.reset) FIRE.reset(); if(WEAPONS && WEAPONS.reset) WEAPONS.reset(); if(PLANTS && PLANTS.reset) PLANTS.reset();
	// Reset fog-of-war as well
	try{ if(FOG && FOG.importSeen) FOG.importSeen([]); if(FOG && FOG.setRevealAll) FOG.setRevealAll(false); if(MM.ui && MM.ui.updateMapButton && FOG && FOG.getRevealAll) MM.ui.updateMapButton(FOG.getRevealAll()); }catch(e){}
	RESOURCE_KEYS.forEach(k=>{ inv[k]=0; }); inv.tools.stone=inv.tools.diamond=false; player.tool='basic'; hotbarIndex=0;
	// Also remove all animals when regenerating with same seed and freeze spawns briefly
	if(MOBS){ try{ if(MOBS.clearAll) MOBS.clearAll(); else if(MOBS.deserialize) MOBS.deserialize({v:3, list:[], aggro:{mode:'rel', m:{}}}); if(MOBS.freezeSpawns) MOBS.freezeSpawns(4000); }catch(e){} }
	updateInventory(); updateHotbarSel(); placePlayer(true); saveState(); msg('Odświeżono świat (seed '+WORLDGEN.worldSeed+', ustawienia zmienione)'); }catch(e){ console.warn('regenWorldSameSeed failed',e); }}
window.addEventListener('mm-regen-same-seed', ()=>{ if(window.regenWorldSameSeed) window.regenWorldSameSeed(); });
