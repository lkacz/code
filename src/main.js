// Nowy styl / pełny ekran inspirowany Diamonds Explorer
// Module entry: import constants (also hydrates window.MM via shim) and side-effect engine modules
import { CHUNK_W, WORLD_H, TILE, SURFACE_GRASS_DEPTH, SAND_DEPTH, T, INFO, SNOW_LINE, isSolid, MOVE, CAPE as CAPE_CONST } from './constants.js';
// Ensure worldgen initializes before world (world.js reads MM.worldGen on load)
import { worldGen as WORLDGEN } from './engine/worldgen.js';
import world from './engine/world.js';
import { trees as TREES } from './engine/trees.js';
import { fallingSolids as FALLING } from './engine/falling.js';
import { water as WATER } from './engine/water.js';
import { cape as CAPE } from './engine/cape.js';
import { chests as CHESTS } from './engine/chests.js';
import './customization.js';
import { mobs as MOBS } from './engine/mobs.js';
import { background as BACKGROUND } from './engine/background.js';
import { fog as FOG } from './engine/fog.js';
import { eyes as EYES } from './engine/eyes.js';
import { particles as PARTICLES } from './engine/particles.js';
import { clouds as CLOUDS } from './engine/clouds.js';
import { bosses as BOSSES } from './engine/bosses.js';
import { grass as GRASS } from './engine/grass.js';
import './engine/ui.js';
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
let surfaceHeight, biomeType, randSeed, diamondChance, worldSeed;
try {
	if(!WORLDGEN) throw new Error('MM.worldGen missing (worldgen.js not loaded)');
	surfaceHeight = WORLDGEN.surfaceHeight;
	biomeType = WORLDGEN.biomeType;
	randSeed = WORLDGEN.randSeed;
	diamondChance = WORLDGEN.diamondChance;
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
})();

function getTile(x,y){ return WORLD.getTile(x,y); }
function setTile(x,y,v){ WORLD.setTile(x,y,v); }
if(FALLING && FALLING.init) FALLING.init(getTile,setTile);

// --- Gracz / inwentarz ---
const player={x:0,y:0,w:0.7,h:0.95,vx:0,vy:0,onGround:false,facing:1,tool:'basic',jumpCount:0,maxHp:100,hp:100,hpInvul:0,atkCd:0,xp:0};
// Expose player globally so mobs module (loaded separately) can reference and damage the player
window.player = player;
// Global customization state comes from customization.js (advanced system)
window.MM = window.MM || {};
const DEFAULT_CUST={ capeStyle:'classic', capeColor:'#b91818', eyeStyle:'bright', outfitStyle:'default', outfitColor:'#f4c05a' };
// Only set defaults if customization hasn't been loaded yet - don't overwrite loaded values!
if(!MM.customization || Object.keys(MM.customization).length === 0) {
  MM.customization = Object.assign({}, DEFAULT_CUST);
} else {
  // Ensure all required properties exist without overwriting loaded ones
  Object.keys(DEFAULT_CUST).forEach(key => {
    if(!(key in MM.customization)) {
      MM.customization[key] = DEFAULT_CUST[key];
    }
  });
}
MM.activeModifiers = MM.activeModifiers || {}; // ensure present
window.addEventListener('mm-customization-change',()=>{
	// customization.js already recomputed MM.activeModifiers.
	// Adjust vision immediately.
	revealAround();
	// Clamp jumpCount if cape downgraded mid‑air.
	const maxAir = (MM.activeModifiers && typeof MM.activeModifiers.maxAirJumps==='number')? MM.activeModifiers.maxAirJumps : 0;
	const totalAllowed = 1 + maxAir;
	if(player.jumpCount > totalAllowed) player.jumpCount = totalAllowed;
	// Also persist to main save so reloads keep the look/feel in sync
	try{ saveGame(false); }catch(e){}
});
// If customization script already provided computeActiveModifiers, call it indirectly by dispatching a synthetic event if empty.
if(!('maxAirJumps' in MM.activeModifiers) || !('visionRadius' in MM.activeModifiers)){
	// Attempt to trigger computation (customization.js runs its own compute on load)
	if(typeof MM.activeModifiers !== 'object') MM.activeModifiers={};
}
const tools={basic:1,stone:2,diamond:4};
// Inventory counts for placeable tiles
const inv={grass:0,sand:0,stone:0,diamond:0,wood:0,leaf:0,snow:0,water:0,tools:{stone:false,diamond:false}};
// Expose inventory for cross-module loot insertion
window.inv = inv;
// Hotbar (slots triggered by keys 4..9)
// HOTBAR_ORDER now mutable and can include CHEST_* pseudo entries (only placeable in god mode)
const HOTBAR_ORDER=['GRASS','SAND','STONE','WOOD','LEAF','SNOW','WATER'];
let hotbarIndex=0; // 0..length-1
function selectedTileId(){ const name=HOTBAR_ORDER[hotbarIndex]; return T[name]; }
function isChestSelection(name){ return name==='CHEST_COMMON'||name==='CHEST_RARE'||name==='CHEST_EPIC'; }
function cycleHotbar(idx){ if(idx<0||idx>=HOTBAR_ORDER.length) return; hotbarIndex=idx; updateHotbarSel(); saveState(); }
// Persistence key
// --- Persistent Save System (minimal: only blocks + player position) ---
// Versioned schema to allow future migrations
// NOTE: Schema v5 simplifies to only blocks and player position.
// v6: terrain generator v2 (real oceans/mountains/caves) — older saves carry chunks
// generated by the inverted v1 height model and cannot be merged into new worlds
const SAVE_KEY='mm_save_v6';
const OLD_SAVE_KEYS=['mm_save_v5','mm_save_v4','mm_save_v3','mm_save_v2'];
// We keep old key for one-time migration
const LEGACY_INV_KEY='mm_inv_v1';
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
	// Persist only player coordinates (ignore velocity, hp, inventory, etc.)
	player: { x: player.x, y: player.y },
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

	// If seed differs, swap to saved seed and clear world gen caches
	if(data.seed!=null && data.seed!==WORLDGEN.worldSeed){
		if(WORLDGEN.setSeedFromInput){ WORLDGEN.worldSeed=data.seed; if(WORLD.clearHeights) WORLD.clearHeights(); }
		WORLD.clear();
	}

	// Restore only modified blocks and player position
	if(data.world && Array.isArray(data.world.modified)) restoreModifiedChunks(data.world.modified);
	// Restore only player position
	if(data.player && typeof data.player.x==='number') player.x = data.player.x;
	if(data.player && typeof data.player.y==='number') player.y = data.player.y;

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
	function serializeCurrent(){ return JSON.stringify(buildSaveObject()); }
	function refreshList(){ list.innerHTML=''; const slots=loadSlots().sort((a,b)=> b.time-a.time); if(!slots.length){ const empty=document.createElement('div'); empty.textContent='(brak zapisów)'; empty.style.fontSize='11px'; empty.style.opacity='0.6'; list.appendChild(empty); }
		// Recompute storage usage (approx) for keys starting with mm_
		let used=0; try{ for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k && k.startsWith('mm_')){ const v=localStorage.getItem(k); if(v) used += k.length + v.length; } } }catch(e){}
		const totalCap = 5*1024*1024; const pct=((used/totalCap)*100).toFixed(1);
		usageLine.textContent='Użycie storage: '+((used/1024)|0)+' KB (~'+pct+'% z 5MB)'; if(used/totalCap>0.85) usageLine.style.color='#ff8080'; else usageLine.style.color='';
		slots.forEach(s=>{ const row=document.createElement('div'); const isCur=currentSlotId===s.id; row.style.cssText='display:flex; gap:6px; align-items:center; background:'+(isCur?'rgba(60,130,255,0.25)':'rgba(255,255,255,0.05)')+'; padding:4px 6px; border-radius:6px;'+(isCur?'outline:1px solid #2d7bff;':'');
			const info=document.createElement('div'); info.style.flex='1'; info.style.minWidth='0'; const raw=localStorage.getItem(slotKey(s.id)); const sizeKB=raw? ((raw.length/1024)|0):0; let hashState=''; if(raw){ try{ const obj=JSON.parse(raw); const v=verifyHash(obj); if(obj && obj.h){ hashState = v.ok? ('#'+obj.h.slice(0,6)) : '(USZKODZONY)'; if(!v.ok) row.style.background='rgba(255,60,60,0.25)'; } }catch(e){ hashState='(BŁĄD)'; row.style.background='rgba(255,60,60,0.25)'; } }
			const nameDisp=(s.name||'Bez nazwy'); info.innerHTML='<b>'+ nameDisp + (isCur?' *':'') +'</b><br><span style="font-size:10px; opacity:.65;">'+ new Date(s.time).toLocaleString() +' • '+sizeKB+' KB • '+hashState+' • seed '+ (s.seed??'-') +'</span>';
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
	fileInput.addEventListener('change',e=>{ const f=fileInput.files&&fileInput.files[0]; if(!f){ return; } const reader=new FileReader(); reader.onload=()=>{ try{ const txt=String(reader.result); const obj=JSON.parse(txt); if(!obj || typeof obj!=='object' || !obj.v){ msg('Niepoprawny plik'); return; } const slots=loadSlots(); const id=Date.now().toString(36)+Math.random().toString(36).slice(2,6); localStorage.setItem(slotKey(id), txt); slots.push({id,name:(f.name||'import').replace(/\.json$/i,'')||null,time:Date.now(),seed:obj.seed}); storeSlots(slots); msg('Zaimportowano'); refreshList(); }catch(err){ msg('Błąd importu'); } fileInput.value=''; };
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
function canCraftStone(){return inv.stone>=10;}
function craftStone(){ if(canCraftStone()){ inv.stone-=10; inv.tools.stone=true; msg('Kilof kamienny (2)'); updateInventory(); }}
function canCraftDiamond(){return inv.diamond>=5;}
function craftDiamond(){ if(canCraftDiamond()){ inv.diamond-=5; inv.tools.diamond=true; msg('Kilof diamentowy (3)'); updateInventory(); }}
// Blink moved to engine/eyes.js
function updateBlink(now){ if(EYES && EYES.update) EYES.update(now); }
 // Cape physics: chain with gravity that droops when idle and streams when moving
const CAPE_SEGMENTS=CAPE_CONST.SEGMENTS; 
const CAPE_ANCHOR_FRAC=CAPE_CONST.ANCHOR_FRAC; // 0 = top of body, 1 = bottom. Middle requested.
function initScarf(){ CAPE.init(player); }
function updateCape(dt){ CAPE.update(player,dt,getTile,isSolid); }
function drawCape(){ CAPE.draw(ctx,TILE); }
function drawPlayer(){ const c=MM.customization||DEFAULT_CUST; const bodyX=(player.x-player.w/2)*TILE; const bodyY=(player.y-player.h/2)*TILE; const bw=player.w*TILE, bh=player.h*TILE; 
	// Normalize outfit style to avoid hidden whitespace/case issues
	const style = ((c && c.outfitStyle)!=null ? String(c.outfitStyle) : 'default').trim().toLowerCase();
		 // draw outfit body using shared renderer from customization.js
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
				if(t===T.AIR || t===T.WATER){
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
		if(!_preGodInventory){ _preGodInventory={grass:inv.grass,sand:inv.sand,stone:inv.stone,diamond:inv.diamond,wood:inv.wood,leaf:inv.leaf,snow:inv.snow,water:inv.water}; }
		inv.grass=inv.sand=inv.stone=inv.diamond=inv.wood=inv.leaf=inv.snow=inv.water=100;
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
window.addEventListener('keydown',e=>{ if(isEditableTarget(e.target)) return; const k=e.key.toLowerCase(); keys[k]=true; if(k==='escape'){ closeHotSelect(); }
 if(['1','2','3'].includes(e.key)){ if(e.key==='1') player.tool='basic'; if(e.key==='2'&&inv.tools.stone) player.tool='stone'; if(e.key==='3'&&inv.tools.diamond) player.tool='diamond'; updateInventory(); }
 // Hotbar numeric (4..9,0) -> slots 0..6
 if(['4','5','6','7','8','9','0'].includes(e.key)){
	 const slot = (e.key==='0') ? 6 : (parseInt(e.key,10)-4);
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
	if(['arrowup','arrowdown','w',' '].includes(k)) e.preventDefault(); });
window.addEventListener('keyup',e=>{ const k=e.key.toLowerCase(); keys[k]=false; keysOnce.delete(k); });
// Losing focus while keys are held would leave the player running forever — release everything
window.addEventListener('blur',()=>{ for(const k in keys) keys[k]=false; keysOnce.clear(); stopMining(); minePointerId=null; mineBtnHeld=false; activePointers.clear(); pinch=null; });

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
let jumpPrev=false; let swimBuoySmooth=0; let wasInWater=false; let bubbleAcc=0; let swimWakeAcc=0; function physics(dt){
	// Horizontal input
	let input=0; if(keys['a']||keys['arrowleft']) input-=1; if(keys['d']||keys['arrowright']) input+=1; if(input!==0) player.facing=input;
	// Combine all movement multipliers, including dropdown
	const moveMult = ((MM.activeModifiers && MM.activeModifiers.moveSpeedMult)||1) * (window.playerSpeedMultiplier || 2);
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
	if(jumpNow && !jumpPrev){
		const maxAir = (MM.activeModifiers && typeof MM.activeModifiers.maxAirJumps==='number')? MM.activeModifiers.maxAirJumps : 0; // additional beyond ground jump
		const totalAllowed = 1 + maxAir; // total sequential presses allowed while airborne
		const jumpMult = ((MM.activeModifiers && MM.activeModifiers.jumpPowerMult)||1) * (window.playerSpeedMultiplier || 2);
		if(player.onGround || godMode){ // primary jump
			player.vy=MOVE.JUMP * jumpMult; player.onGround=false; player.jumpCount=1;
		}
		else if(!inWater && player.jumpCount>0 && player.jumpCount < totalAllowed){
			// mid-air extra jump
			player.vy=MOVE.JUMP * jumpMult; player.jumpCount++;
		}
		else if(inWater){ // gentle swim kick (does not consume jump charges)
			player.vy = Math.min(player.vy,0);
			player.vy += MOVE.JUMP * 0.32 * (0.6 + 0.4*subFrac) * jumpMult;
		}
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
		// Clamp speeds (tighter downward, allow brisk upward correction)
		const maxDown=2.8, maxUp=9.0; if(player.vy>maxDown) player.vy=maxDown; if(player.vy<-maxUp) player.vy=-maxUp;
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
	// Drag mining: if the held cursor moved to a different tile, re-target immediately
	if(minePointerId!=null && !mineBtnHeld && lastPointer.has){
		const p=screenToWorldTile(lastPointer.x,lastPointer.y);
		if((p.tx!==mineTx||p.ty!==mineTy) && withinReach(p.tx,p.ty,MINE_REACH) && getTile(p.tx,p.ty)!==T.AIR && !(INFO[getTile(p.tx,p.ty)]&&INFO[getTile(p.tx,p.ty)].chestTier)){ mineTx=p.tx; mineTy=p.ty; mineTimer=0; }
	}
	const mineMult=(MM.activeModifiers && MM.activeModifiers.mineSpeedMult)||1; mineTimer += dt * tools[player.tool] * mineMult; const curId=getTile(mineTx,mineTy); const info=INFO[curId]; const need=Math.max(0.1, info.hp/6); if(mineTimer>=need){ if(curId===T.WOOD && isTreeBase(mineTx,mineTy)){ if(startTreeFall(mineTx,mineTy)){ stopMining(); return; } } const fellAbove = curId===T.WOOD && getTile(mineTx,mineTy-1)===T.WOOD; const drop=info.drop; setTile(mineTx,mineTy,T.AIR); if(drop) inv[drop]=(inv[drop]||0)+1; if(fellAbove) startTreeFall(mineTx,mineTy-1); if(FALLING && FALLING.onTileRemoved) FALLING.onTileRemoved(mineTx,mineTy); if(WATER && WATER.onTileChanged) WATER.onTileChanged(mineTx,mineTy,getTile); pushUndo(mineTx,mineTy,curId,T.AIR,'break'); stopMining(); updateInventory(); resumeHeldMining(); } }

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
function haveBlocksFor(tileId){ switch(tileId){ case T.GRASS: return inv.grass>0; case T.SAND: return inv.sand>0; case T.STONE: return inv.stone>0; case T.WOOD: return inv.wood>0; case T.LEAF: return inv.leaf>0; case T.SNOW: return inv.snow>0; case T.WATER: return inv.water>0; default: return false; }}
function consumeFor(tileId){ if(godMode) return; if(tileId===T.GRASS) inv.grass--; else if(tileId===T.SAND) inv.sand--; else if(tileId===T.STONE) inv.stone--; else if(tileId===T.WOOD) inv.wood--; else if(tileId===T.LEAF) inv.leaf--; else if(tileId===T.SNOW) inv.snow--; else if(tileId===T.WATER) inv.water--; }
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
	if(WATER){ if(id===T.WATER) WATER.addSource(tx,ty,getTile,setTile); else if(v.replacedWater && WATER.onTileChanged) WATER.onTileChanged(tx,ty,getTile); }
	// Queue a stability check: unsupported sand starts falling, stone placed without a
	// load path collapses as a cluster, etc. (event-driven in engine/falling.js)
	if(FALLING && FALLING.afterPlacement) FALLING.afterPlacement(tx,ty);
}
function updateHotbarCounts(){ const map={GRASS:'grass',SAND:'sand',STONE:'stone',WOOD:'wood',LEAF:'leaf',SNOW:'snow',WATER:'water'}; for(const k in map){ const el=document.getElementById('hotCnt'+k); if(el) el.textContent=inv[map[k]]; } }
function updateHotbarSel(){ document.querySelectorAll('.hotSlot').forEach((el,i)=>{ if(i===hotbarIndex) el.classList.add('sel'); else el.classList.remove('sel'); }); }
// --- Undo system for tile edits ---
const UNDO_LIMIT=200; const undoStack=[]; // {x,y,oldId,newId,kind}
function invKeyForTile(id){ if(id===T.GRASS) return 'grass'; if(id===T.SAND) return 'sand'; if(id===T.STONE) return 'stone'; if(id===T.DIAMOND) return 'diamond'; if(id===T.WOOD) return 'wood'; if(id===T.LEAF) return 'leaf'; if(id===T.SNOW) return 'snow'; if(id===T.WATER) return 'water'; return null; }
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
let hotSelectSlotIndex=-1;
function closeHotSelect(){ if(hotSelectMenu){ hotSelectMenu.style.display='none'; hotSelectSlotIndex=-1; } }
function openHotSelect(slot,anchorEl){ if(!hotSelectMenu) return; hotSelectSlotIndex=slot; hotSelectOptions.innerHTML='';
	const baseTypes=[
		{k:'GRASS',label:'Trawa'}, {k:'SAND',label:'Piasek'}, {k:'STONE',label:'Kamień'}, {k:'WOOD',label:'Drewno'}, {k:'LEAF',label:'Liść'}, {k:'SNOW',label:'Śnieg'}, {k:'WATER',label:'Woda'}
	];
	let types=[...baseTypes];
	if(godMode){ types.push({k:'CHEST_COMMON',label:'Skrzynia zwykła',col:'#b07f2c'}); types.push({k:'CHEST_RARE',label:'Skrzynia rzadka',col:'#a74cc9'}); types.push({k:'CHEST_EPIC',label:'Skrzynia epicka',col:'#e0b341'}); }
	types.forEach(t=>{ const b=document.createElement('button'); b.textContent=t.label; const baseBg='rgba(255,255,255,.08)'; const rareBg=t.col? t.col+'33': baseBg; const border=t.col? t.col+'88':'rgba(255,255,255,.15)'; b.style.cssText='text-align:left; background:'+rareBg+'; border:1px solid '+border+'; color:#fff; border-radius:8px; padding:4px 8px; cursor:pointer; font-size:12px;'; if(HOTBAR_ORDER[slot]===t.k) b.style.outline='2px solid #2c7ef8'; b.addEventListener('click',()=>{ HOTBAR_ORDER[slot]=t.k; closeHotSelect(); cycleHotbar(slot); msg('Slot '+(slot+4)+' -> '+t.label); }); hotSelectOptions.appendChild(b); });
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
		if(dxRange<=3 && dyRange<=3 && player.atkCd<=0 && ((BOSSES && BOSSES.attackAt && BOSSES.attackAt(tx,ty)) || (MOBS && MOBS.attackAt && MOBS.attackAt(tx,ty)))){ player.atkCd=0.35; return; }
		if(tryOpenChestAt(tx,ty)) return;
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
 // mobs
 if(MOBS && MOBS.draw) MOBS.draw(ctx,TILE,camX,camY,zoom);
 // boss monsters (multi-part procedural creatures, world-space)
 if(BOSSES && BOSSES.draw) BOSSES.draw(ctx,TILE);
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
	// Underwater immersion: blue tint + vignette while the player's head is submerged
	if(getTile(Math.floor(player.x), Math.floor(player.y - player.h/2))===T.WATER){
		ctx.save();
		ctx.fillStyle='rgba(24,80,170,0.16)'; ctx.fillRect(0,0,W,H);
		const vg=ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*0.35, W/2,H/2,Math.max(W,H)*0.65);
		vg.addColorStop(0,'rgba(8,30,90,0)'); vg.addColorStop(1,'rgba(8,30,90,0.34)');
		ctx.fillStyle=vg; ctx.fillRect(0,0,W,H);
		ctx.restore();
	}
	// Screen-space atmospheric tint (after world scaling restore)
	applyAtmosphericTint();
	// Off-screen monster pointer (screen space, after the world transform is gone)
	if(BOSSES && BOSSES.drawHUD) BOSSES.drawHUD(ctx,W,H,camRenderX,camRenderY,zoom,TILE);
	// HUD: health bar
	ctx.save(); const barW=200, barH=18; const pad=12; const x=pad, y=H - barH - pad; ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(x,y,barW,barH); const frac=player.hp/player.maxHp; const g=ctx.createLinearGradient(x,y,x+barW,y); g.addColorStop(0,'#ff3636'); g.addColorStop(1,'#ff9a3d'); ctx.fillStyle=g; ctx.fillRect(x,y,Math.max(0,barW*frac),barH); ctx.strokeStyle='rgba(255,255,255,0.3)'; ctx.lineWidth=2; ctx.strokeRect(x,y,barW,barH); ctx.fillStyle='#fff'; ctx.font='12px system-ui'; ctx.fillText('HP '+player.hp+' / '+player.maxHp, x+8, y-4); ctx.fillText('XP '+(player.xp||0), x+8, y+barH+12); // damage flash overlay
	if(player.hpInvul && performance.now()<player.hpInvul){ const alpha = (player.hpInvul - performance.now())/600; ctx.fillStyle='rgba(255,0,0,'+(0.25*alpha)+')'; ctx.fillRect(0,0,W,H); }
	ctx.restore();

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

// UI aktualizacja
const el={grass:document.getElementById('grass'),sand:document.getElementById('sand'),stone:document.getElementById('stone'),diamond:document.getElementById('diamond'),wood:document.getElementById('wood'),snow:document.getElementById('snow'),water:document.getElementById('water'),pick:document.getElementById('pick'),fps:document.getElementById('fps'),msg:document.getElementById('messages')}; function updateInventory(){ el.grass.textContent=inv.grass; el.sand.textContent=inv.sand; el.stone.textContent=inv.stone; el.diamond.textContent=inv.diamond; el.wood.textContent=inv.wood; if(el.snow) el.snow.textContent=inv.snow; if(el.water) el.water.textContent=inv.water; el.pick.textContent=player.tool; document.getElementById('craftStone').disabled=!canCraftStone(); document.getElementById('craftDiamond').disabled=!canCraftDiamond(); updateHotbarCounts(); saveState(); }
document.getElementById('craftStone').addEventListener('click', craftStone); document.getElementById('craftDiamond').addEventListener('click', craftDiamond);
// Menu / przyciski
document.getElementById('mapBtn')?.addEventListener('click',toggleMap);
const godBtn=document.getElementById('godBtn'); if(godBtn) godBtn.addEventListener('click',toggleGod);
updateGodBtn();
const menuBtn=document.getElementById('menuBtn'); const menuPanel=document.getElementById('menuPanel');
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
	mining=false; if(FALLING && FALLING.reset) FALLING.reset(); if(WATER && WATER.reset) WATER.reset(); if(CLOUDS && CLOUDS.reset) CLOUDS.reset(); if(BOSSES && BOSSES.reset) BOSSES.reset(); if(MM.trees && MM.trees._fallingBlocks) MM.trees._fallingBlocks.length=0; if(GRASS && GRASS.reset) GRASS.reset(); if(PARTICLES && PARTICLES.reset) PARTICLES.reset();

	// Reset inventory/tools/hotbar
	inv.grass=inv.sand=inv.stone=inv.diamond=inv.wood=inv.leaf=inv.snow=inv.water=0; inv.tools.stone=inv.tools.diamond=false; player.tool='basic'; hotbarIndex=0; // if god mode active, restore 100 stack after reset
	// Ensure all animals are removed when creating a new world and prevent immediate respawn
	if(MOBS){ try{ if(MOBS.clearAll) MOBS.clearAll(); else if(MOBS.deserialize) MOBS.deserialize({v:3, list:[], aggro:{mode:'rel', m:{}}}); }catch(e){} }
	if(godMode){ if(!_preGodInventory) _preGodInventory={grass:0,sand:0,stone:0,diamond:0,wood:0,leaf:0,snow:0,water:0}; inv.grass=inv.sand=inv.stone=inv.diamond=inv.wood=inv.leaf=inv.snow=inv.water=100; }
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
updateInventory(); updateGodBtn(); if(MM.ui && MM.ui.updateMapButton && FOG && FOG.getRevealAll) MM.ui.updateMapButton(FOG.getRevealAll()); updateHotbarSel(); if(!loaded) msg('Sterowanie: A/D/W + LPM kopie, PPM stawia (4-9, 0 wybór). G=Bóg (nieskończone skoki), M=Mapa, C=Centrum, H=Pomoc'); else msg('Wczytano zapis – miłej gry!');
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
		physics(dt); if(player.atkCd>0) player.atkCd-=dt; updateMining(dt); updateFallingBlocks(dt); if(FALLING && FALLING.update) FALLING.update(getTile,setTile,dt); if(WATER && WATER.update) WATER.update(getTile,setTile,dt); if(CLOUDS && CLOUDS.update) CLOUDS.update(getTile,setTile,dt); if(BOSSES && BOSSES.update) BOSSES.update(getTile,setTile,dt); if(MOBS && MOBS.update) MOBS.update(dt, player, getTile); updateParticles(dt); updateCape(dt); updateBlink(ts); draw(); if(MM.ui && MM.ui.setRadarPulsing) MM.ui.setRadarPulsing(ts<radarFlash); updateFps(ts);
	}catch(err){
		if(ts-lastLoopErrAt>2000){ lastLoopErrAt=ts; console.error('game loop error (frame skipped):', err); }
	}
	requestAnimationFrame(loop); } requestAnimationFrame(loop);
// Update background time-based elements
setInterval(()=>{ /* keep cycleStart anchored; could adjust for pause logic later */ },60000);

// (Re)define loot popup helpers if not already present (guard for reloads)
// Deferred loot inbox system
if(!window.__lootPopupInit){
	window.__lootPopupInit=true;
	window.lootInbox = window.lootInbox || [];
	let lootInboxUnread = 0; // separate unread counter so viewing doesn't erase items
	const LOOT_INBOX_KEY='mm_loot_inbox_v1';
	try{ const saved=localStorage.getItem(LOOT_INBOX_KEY); if(saved){ const parsed=JSON.parse(saved); if(Array.isArray(parsed.items)){ window.lootInbox = parsed.items; lootInboxUnread = parsed.unread|0; } } }catch(e){}
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
	function buildRows(items){ lootItemsBox.innerHTML=''; const all=MM.getCustomizationItems? MM.getCustomizationItems():null; const curSel={cape:MM.customization.capeStyle, eyes:MM.customization.eyeStyle, outfit:MM.customization.outfitStyle}; function cur(kind){ if(!all) return null; const list=kind==='cape'? all.capes: kind==='eyes'? all.eyes: all.outfits; return list.find(i=>i.id===curSel[kind]); }
		function fmtMult(v){ return (v||1).toFixed(2)+'x'; }
		items.forEach(it=>{ const row=document.createElement('div'); row.className='lootRow '+it.tier; const left=document.createElement('div'); const title=document.createElement('div'); title.style.fontWeight='600'; title.textContent=(it.name||it.id)+' ['+it.kind+']'; if(it.unique){ const b=document.createElement('span'); b.textContent='★ '+it.unique; b.style.marginLeft='6px'; b.style.fontSize='10px'; b.style.color='#ffd54a'; title.appendChild(b); }
			left.appendChild(title); const stats=document.createElement('div'); stats.className='lootStats'; const current=cur(it.kind);
			function diff(label, curV, newV, betterHigh=true, fmt=v=>v){ if(newV==null) return; const base=curV==null? (label==='move'||label==='jump'||label==='mine'?1: (label==='air'?0: (label==='vision'?10:null))):curV; const better = betterHigh? newV>base : newV<base; const worse = betterHigh? newV<base : newV>base; const cls=better?'diffPlus': worse?'diffMinus':''; stats.innerHTML+= label+': <span class="'+cls+'">'+fmt(newV)+(newV!==base? (' ('+fmt(base)+')'):'')+'</span><br>'; }
			diff('air', current&&current.airJumps, it.airJumps, true, v=>'+'+v);
			diff('vision', current&&current.visionRadius, it.visionRadius, true, v=>v);
			diff('move', current&&current.moveSpeedMult, it.moveSpeedMult, true, fmtMult);
			diff('jump', current&&current.jumpPowerMult, it.jumpPowerMult, true, fmtMult);
			diff('mine', current&&current.mineSpeedMult, it.mineSpeedMult, true, fmtMult);
			left.appendChild(stats); row.appendChild(left);
			const btns=document.createElement('div'); btns.style.display='flex'; btns.style.flexDirection='column'; btns.style.gap='6px';
			const equip=document.createElement('button'); equip.textContent='Wyposaż'; const keep=document.createElement('button'); keep.textContent='Zachowaj'; keep.className='sec'; const discard=document.createElement('button'); discard.textContent='Odrzuć'; discard.className='danger';
			function disable(){ equip.disabled=keep.disabled=discard.disabled=true; row.style.opacity='.45'; }
				equip.addEventListener('click',()=>{ if(it.kind==='cape') MM.customization.capeStyle=it.id; else if(it.kind==='eyes') MM.customization.eyeStyle=it.id; else MM.customization.outfitStyle=it.id; if(MM.recomputeModifiers) MM.recomputeModifiers(); window.dispatchEvent(new CustomEvent('mm-customization-change')); disable(); persistInbox(); });
				keep.addEventListener('click',()=>{ disable(); persistInbox(); });
				discard.addEventListener('click',()=>{ if(MM.dynamicLoot){ const arr = it.kind==='cape'? MM.dynamicLoot.capes : it.kind==='eyes'? MM.dynamicLoot.eyes : MM.dynamicLoot.outfits; const idx=arr.indexOf(it); if(idx>=0) arr.splice(idx,1); } if(MM.addDiscardedLoot) MM.addDiscardedLoot(it.id); if(CHESTS && CHESTS.saveDynamicLoot) CHESTS.saveDynamicLoot(); disable(); updateLootInboxIndicator(); persistInbox(); });
			btns.appendChild(equip); btns.appendChild(keep); btns.appendChild(discard); row.appendChild(btns); lootItemsBox.appendChild(row); row.__item=it; });
	}
	function openInbox(){ if(!window.lootInbox.length){ msg('Brak przedmiotów'); return; } buildRows(window.lootInbox); lootInboxUnread=0; updateLootInboxIndicator(); persistInbox(); lootPopup.classList.add('show'); lootDim.style.display='block'; lootPrevFocus=document.activeElement; installTrap(); const first=lootPopup.querySelector('button'); if(first) first.focus(); }
	function closeInbox(){ lootPopup.classList.remove('show'); lootDim.style.display='none'; removeTrap(); if(lootPrevFocus && lootPrevFocus.focus) lootPrevFocus.focus(); }
	function installTrap(){ function handler(e){ if(lootPopup.style.display!=='flex') return; if(e.key==='Escape'){ closeInbox(); return; } if(e.key==='Tab'){ const f=[...lootPopup.querySelectorAll('button')].filter(b=>!b.disabled); if(!f.length) return; const first=f[0], last=f[f.length-1]; if(e.shiftKey){ if(document.activeElement===first){ e.preventDefault(); last.focus(); } } else { if(document.activeElement===last){ e.preventDefault(); first.focus(); } } } } window.addEventListener('keydown',handler); lootPopup.__trapHandler=handler; }
	function removeTrap(){ if(lootPopup.__trapHandler){ window.removeEventListener('keydown', lootPopup.__trapHandler); lootPopup.__trapHandler=null; } }
	lootInboxBtn?.addEventListener('click',openInbox);
	lootCloseBtn?.addEventListener('click',closeInbox); lootDim?.addEventListener('click',closeInbox);
	lootEquipAllBtn?.addEventListener('click',()=>{ const rows=[...lootItemsBox.querySelectorAll('.lootRow')]; const latest={}; rows.forEach(r=>{ const it=r.__item; if(it) latest[it.kind]=it; }); Object.values(latest).forEach(it=>{ if(it.kind==='cape') MM.customization.capeStyle=it.id; else if(it.kind==='eyes') MM.customization.eyeStyle=it.id; else MM.customization.outfitStyle=it.id; }); if(MM.recomputeModifiers) MM.recomputeModifiers(); window.dispatchEvent(new CustomEvent('mm-customization-change')); persistInbox(); closeInbox(); });
	lootKeepAllBtn?.addEventListener('click',closeInbox);
	window.addEventListener('keydown',e=>{ if(isEditableTarget(e.target)) return; if(e.key.toLowerCase()==='i'){ if(lootPopup.classList.contains('show')) closeInbox(); else openInbox(); } });
	MM.onLootGained = function(items){ if(window.updateDynamicCustomization) window.updateDynamicCustomization(); if(window.lootInbox){ window.lootInbox.push(...items); lootInboxUnread += items.length; updateLootInboxIndicator(); persistInbox(); } };
	// Initial indicator on load (if persisted)
	updateLootInboxIndicator();
}

// Regenerate world using the CURRENT seed (do not change WG.worldSeed)
window.regenWorldSameSeed = function(){ try{ if(MOBS && MOBS.clearAll) try{ MOBS.clearAll(); }catch(e){} if(WORLD && WORLD.clear) WORLD.clear(); if(typeof chunkCanvases!=='undefined') chunkCanvases.clear(); if(WORLD && WORLD.clearHeights) WORLD.clearHeights(); if(FALLING && FALLING.reset) FALLING.reset(); if(WATER && WATER.reset) WATER.reset(); if(CLOUDS && CLOUDS.reset) CLOUDS.reset(); if(BOSSES && BOSSES.reset) BOSSES.reset(); if(MM.trees && MM.trees._fallingBlocks) MM.trees._fallingBlocks.length=0; if(GRASS && GRASS.reset) GRASS.reset(); if(PARTICLES && PARTICLES.reset) PARTICLES.reset();
	// Reset fog-of-war as well
	try{ if(FOG && FOG.importSeen) FOG.importSeen([]); if(FOG && FOG.setRevealAll) FOG.setRevealAll(false); if(MM.ui && MM.ui.updateMapButton && FOG && FOG.getRevealAll) MM.ui.updateMapButton(FOG.getRevealAll()); }catch(e){}
	inv.grass=inv.sand=inv.stone=inv.diamond=inv.wood=inv.leaf=inv.snow=inv.water=0; inv.tools.stone=inv.tools.diamond=false; player.tool='basic'; hotbarIndex=0; 
	// Also remove all animals when regenerating with same seed and freeze spawns briefly
	if(MOBS){ try{ if(MOBS.clearAll) MOBS.clearAll(); else if(MOBS.deserialize) MOBS.deserialize({v:3, list:[], aggro:{mode:'rel', m:{}}}); if(MOBS.freezeSpawns) MOBS.freezeSpawns(4000); }catch(e){} }
	updateInventory(); updateHotbarSel(); placePlayer(true); saveState(); msg('Odświeżono świat (seed '+WORLDGEN.worldSeed+', ustawienia zmienione)'); }catch(e){ console.warn('regenWorldSameSeed failed',e); }}
window.addEventListener('mm-regen-same-seed', ()=>{ if(window.regenWorldSameSeed) window.regenWorldSameSeed(); });
