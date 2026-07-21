// Lingering world consequences after guardian defeats.
// One aftermath can be active at a time: the next guardian death replaces it.
import { CHUNK_W, WORLD_H, T, INFO } from '../constants.js';
import { isSolidCollisionTile as isSolid, isGasTile, isBlastProtectedTile } from './material_physics.js';

const guardianAftermath = (function(){
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const MM = root.MM = root.MM || {};

  const DAY_SECONDS = 600;
  const DURATION_SECONDS = DAY_SECONDS * 3;
  const VALID = new Set(['fire','ice','earth']);
  const CFG = {
    DAY_SECONDS,
    DURATION_SECONDS,
    SKY_INTERVAL: 60,
    EARTH_INTERVAL: 300,
    FIRST_SKY_MIN: 8,
    FIRST_SKY_MAX: 18,
    FIRST_EARTH_MIN: 34,
    FIRST_EARTH_MAX: 62,
    SPAWN_RADIUS_X: 46,
    MAX_FALLING: 9,
    MAX_EFFECTS: 110,
    MAX_SAVED_FALLING: 6,
    FALL_GRAVITY: 22,
    FALL_VMAX: 64,
    FIRE_LAVA_CAP: 3,
    WAKE_CAP: 60,
    SAVE_MARK_MIN_INTERVAL: 1200,
    AMBIENT_INTERVAL: 1.35,
    AMBIENT_CHUNKS_PER_TICK: 2,
    AMBIENT_RADIUS_CHUNKS: 3,
    AMBIENT_SEEN_CAP: 1600,
    AMBIENT_SAVE_CAP: 900
  };

  const state = {
    active: null,
    elapsed: 0,
    nextIn: 0,
    seq: 1,
    salt: 1,
    ambientAcc: 0,
    ambientCursor: 0,
    lastMark: -Infinity
  };
  const falling = [];
  const effects = [];
  const ambientChunks = new Map();

  const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
  const finite = (v,f)=>Number.isFinite(Number(v)) ? Number(v) : f;
  const round3 = v=>+finite(v,0).toFixed(3);
  const key = (x,y)=>x+','+y;

  function normalizeKind(kind){
    if(kind === 'east') return 'fire';
    if(kind === 'west' || kind === 'sky') return 'ice';
    if(kind === 'underground' || kind === 'ground') return 'earth';
    return VALID.has(kind) ? kind : null;
  }
  function nowMs(){
    try{ if(root.performance && typeof root.performance.now === 'function') return root.performance.now(); }catch(e){}
    try{ return Date.now(); }catch(e){ return 0; }
  }
  function markWorldChanged(force){
    const now = nowMs();
    if(!force && Number.isFinite(state.lastMark) && now - state.lastMark < CFG.SAVE_MARK_MIN_INTERVAL) return false;
    state.lastMark = now;
    try{
      if(typeof root.__mmMarkWorldChanged === 'function') root.__mmMarkWorldChanged('guardian_aftermath');
      else if(root.saveState) root.saveState();
    }catch(e){}
    return true;
  }
  function strength(){
    if(!state.active) return 0;
    return clamp(1 - state.elapsed / DURATION_SECONDS, 0, 1);
  }
  function baseInterval(kind){
    return kind === 'earth' ? CFG.EARTH_INTERVAL : CFG.SKY_INTERVAL;
  }
  function scheduleNext(kind){
    const s = Math.max(0.12, strength());
    const base = baseInterval(kind);
    const jitter = 0.78 + Math.random() * 0.46;
    return base * jitter / s;
  }
  function firstDelay(kind, opts){
    if(opts && opts.immediate) return 0;
    if(opts && Number.isFinite(opts.nextIn)) return Math.max(0, Number(opts.nextIn));
    if(kind === 'earth') return CFG.FIRST_EARTH_MIN + Math.random() * (CFG.FIRST_EARTH_MAX - CFG.FIRST_EARTH_MIN);
    return CFG.FIRST_SKY_MIN + Math.random() * (CFG.FIRST_SKY_MAX - CFG.FIRST_SKY_MIN);
  }

  function start(kind, opts){
    kind = normalizeKind(kind);
    if(!kind) return false;
    state.active = kind;
    state.elapsed = Math.max(0, finite(opts && opts.elapsed, 0));
    state.nextIn = firstDelay(kind, opts || {});
    state.seq = (state.seq + 1) | 0;
    state.salt = Math.max(1, Math.floor(finite(opts && opts.salt, 0)) || ((Math.random() * 0x7fffffff) | 0) || 1);
    state.ambientAcc = 0;
    state.ambientCursor = 0;
    falling.length = 0;
    effects.length = 0;
    ambientChunks.clear();
    markWorldChanged(true);
    return true;
  }
  function reset(){
    state.active = null;
    state.elapsed = 0;
    state.nextIn = 0;
    state.seq = 1;
    state.salt = 1;
    state.ambientAcc = 0;
    state.ambientCursor = 0;
    state.lastMark = -Infinity;
    falling.length = 0;
    effects.length = 0;
    ambientChunks.clear();
  }

  function tileInfo(t){ return INFO[t] || INFO[T.AIR] || {}; }
  function isRelicStructureTile(t){
    return t === T.ALIEN_BIOMASS || t === T.ANTIMATTER_CRYSTAL || t === T.IRIDIUM || t === T.METEOR_DUST;
  }
  function isProtected(t){
    if(t === T.AIR) return false;
    const info = tileInfo(t);
    if(t === T.TORCH || t === T.GRAVE || t === T.WIRE || t === T.COPPER_WIRE || t === T.SILVER_WIRE ||
      t === T.WATER_PIPE || t === T.LADDER || t === T.BEDROCK_LADDER) return true;
    if(isRelicStructureTile(t)) return true;
    return isBlastProtectedTile(t) || !!(info.chestTier || info.machine || info.story || info.unmineable);
  }
  function isOpenForImpact(t){
    return t === T.AIR || t === T.WATER || t === T.LAVA || isGasTile(t) || !!tileInfo(t).passable;
  }
  function isGroundTile(t){
    return t === T.WATER || t === T.LAVA || isSolid(t);
  }
  function canSurfaceReplace(t){
    if(isProtected(t)) return false;
    if(isOpenForImpact(t)) return true;
    return t === T.GRASS || t === T.GRASS_SNOW || t === T.SAND || t === T.DIRT || t === T.MUD ||
      t === T.CLAY || t === T.WET_CLAY || t === T.SNOW || t === T.ICE ||
      t === T.FROZEN_DIRT || t === T.FROZEN_SAND || t === T.FROZEN_CLAY ||
      t === T.STONE || t === T.GRANITE || t === T.BASALT || t === T.COAL ||
      t === T.METEOR_DUST || t === T.ALIEN_BIOMASS;
  }
  function motherCoreTile(kind){
    return kind === 'ice' ? T.MOTHER_ICE : (kind === 'fire' ? T.MOTHER_LAVA : null);
  }
  function depositMotherCore(kind, cx, cy, r, getTile, setTile, batch, protectedAreas){
    const tile = motherCoreTile(kind);
    if(tile == null) return 0;
    const span = Math.max(1, Math.ceil(r * 0.45));
    const spots = [{x:cx,y:cy},{x:cx,y:cy-1},{x:cx-1,y:cy},{x:cx+1,y:cy},{x:cx,y:cy+1}];
    for(let dy=-span; dy<=span; dy++){
      for(let dx=-span; dx<=span; dx++){
        if(dx*dx + dy*dy > span*span) continue;
        spots.push({x:cx+dx,y:cy+dy});
      }
    }
    const used = new Set();
    for(const s of spots){
      const x = Math.round(s.x), y = Math.round(s.y);
      const k = key(x,y);
      if(used.has(k)) continue;
      used.add(k);
      if(!canSurfaceReplace(getTile(x,y))) continue;
      if(setTileNotified(x, y, tile, getTile, setTile, batch, protectedAreas)) return 1;
    }
    return 0;
  }
  function surfaceYAt(x, getTile){
    if(typeof getTile !== 'function') return WORLD_H - 4;
    const tx = Math.round(finite(x, 0));
    for(let y=1; y<WORLD_H-2; y++){
      const t = getTile(tx, y);
      if(isGroundTile(t)) return y;
    }
    return WORLD_H - 4;
  }
  function localFloorY(x, hintY, getTile){
    if(typeof getTile !== 'function') return surfaceYAt(x, getTile);
    const tx = Math.round(finite(x, 0));
    const start = clamp(Math.floor(finite(hintY, surfaceYAt(tx, getTile))) - 10, 1, WORLD_H - 3);
    const end = clamp(Math.floor(finite(hintY, start)) + 28, start, WORLD_H - 3);
    for(let y=start; y<=end; y++){
      const t = getTile(tx, y);
      const above = getTile(tx, y-1);
      if(isGroundTile(t) && !isGroundTile(above)) return y;
    }
    return surfaceYAt(tx, getTile);
  }
  function selectWakeCells(cells, cap){
    if(!Array.isArray(cells) || !cells.length) return [];
    const out = [];
    const used = new Set();
    const stride = Math.max(1, Math.ceil(cells.length / Math.max(1, cap)));
    for(let i=0; i<cells.length && out.length<cap; i+=stride){
      const c = cells[i];
      if(!c) continue;
      const k = key(c.x, c.y);
      if(used.has(k)) continue;
      used.add(k);
      out.push(c);
    }
    return out;
  }
  function flushBatch(batch, getTile){
    if(!batch) return;
    try{
      const f = MM.fallingSolids;
      if(f && typeof f.onTilesChangedBatch === 'function'){
        f.onTilesChangedBatch(batch.removed, batch.placed, {source:'guardian_aftermath', wakeCap:CFG.WAKE_CAP});
      }else if(f){
        for(const c of selectWakeCells(batch.removed, CFG.WAKE_CAP)) if(f.onTileRemoved) f.onTileRemoved(c.x, c.y);
        for(const c of selectWakeCells(batch.placed, CFG.WAKE_CAP)) if(f.afterPlacement) f.afterPlacement(c.x, c.y);
      }
    }catch(e){}
    try{
      const w = MM.water;
      if(w && typeof w.onTilesChangedBatch === 'function'){
        w.onTilesChangedBatch(batch.water, getTile, {source:'guardian_aftermath', cap:CFG.WAKE_CAP});
      }else if(w && w.onTileChanged){
        for(const c of selectWakeCells(batch.water, CFG.WAKE_CAP)) w.onTileChanged(c.x, c.y, getTile);
      }
    }catch(e){}
  }
  function areaFromLayout(L, pad){
    if(!L) return null;
    const minX = Number(L.minX), maxX = Number(L.maxX), minY = Number(L.minY), maxY = Number(L.maxY);
    if(!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
    pad = Math.max(0, Math.round(finite(pad, 0)));
    return {
      minX:Math.floor(minX) - pad,
      maxX:Math.ceil(maxX) + pad,
      minY:Math.floor(minY) - pad,
      maxY:Math.ceil(maxY) + pad
    };
  }
  function addProtectedArea(areas, L, pad){
    const a = areaFromLayout(L, pad);
    if(a) areas.push(a);
  }
  function progressionProtectedAreas(){
    const areas = [];
    try{
      const g = MM.guardianLairs || MM.guardians;
      if(g && typeof g.layoutFor === 'function'){
        addProtectedArea(areas, g.layoutFor('fire'), 5);
        addProtectedArea(areas, g.layoutFor('ice'), 5);
      }
      if(g && typeof g.undergroundGateLayout === 'function') addProtectedArea(areas, g.undergroundGateLayout(), 5);
    }catch(e){}
    try{
      const u = MM.undergroundBoss || MM.earthBoss;
      if(u && typeof u.layoutFor === 'function') addProtectedArea(areas, u.layoutFor(), 5);
    }catch(e){}
    return areas;
  }
  function pointInAreas(areas, x, y){
    if(!areas || !areas.length) return false;
    x = Math.floor(x); y = Math.floor(y);
    for(const a of areas){
      if(x >= a.minX && x <= a.maxX && y >= a.minY && y <= a.maxY) return true;
    }
    return false;
  }
  function setTileNotified(x, y, tile, getTile, setTile, batch, protectedAreas){
    if(typeof getTile !== 'function' || typeof setTile !== 'function') return false;
    x = Math.round(x); y = Math.round(y);
    if(y < 1 || y >= WORLD_H - 1) return false;
    if(pointInAreas(protectedAreas, x, y)) return false;
    const old = getTile(x, y);
    if(old === tile || isProtected(old)) return false;
    setTile(x, y, tile);
    if(batch){
      if(tile === T.AIR) batch.removed.push({x,y});
      else batch.placed.push({x,y});
      batch.water.push({x,y});
    }
    try{
      if(tile === T.LAVA && MM.fire && MM.fire.noteLava){
        MM.fire.noteLava(x, y, {priority:true, fast:true, source:'guardian_aftermath'});
        if(MM.fire.heatAround) MM.fire.heatAround(x, y, getTile, setTile, {includeCenter:false});
      }else if(tile === T.COAL && MM.fire && MM.fire.ignite){
        MM.fire.ignite(x, y, getTile, setTile);
      }
    }catch(e){}
    return true;
  }
  function worldSeed(){
    try{
      const wg = MM.worldGen || root.worldGen;
      if(wg && Number.isFinite(Number(wg.worldSeed))) return Number(wg.worldSeed) | 0;
    }catch(e){}
    return 0;
  }
  function hash01(a,b,c,d){
    let h = Math.imul((a|0) ^ 0x9e3779b9, 374761393) ^
      Math.imul((b|0) ^ 0x85ebca6b, 668265263) ^
      Math.imul((c|0) ^ 0xc2b2ae35, 1274126177) ^
      Math.imul((d|0) ^ 0x27d4eb2d, 2246822519);
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function kindIndex(kind){
    return kind === 'fire' ? 11 : (kind === 'ice' ? 23 : 37);
  }
  function ambientHash(cx, site, off){
    return hash01(cx, site, (state.salt|0) ^ worldSeed(), off + kindIndex(state.active));
  }
  function ambientKey(cx){
    return state.active+':'+(state.salt|0)+':'+Math.floor(cx);
  }
  function rememberAmbientChunk(cx){
    const k = ambientKey(cx);
    ambientChunks.set(k, +state.elapsed.toFixed(1));
    while(ambientChunks.size > CFG.AMBIENT_SEEN_CAP){
      const first = ambientChunks.keys().next().value;
      if(first == null) break;
      ambientChunks.delete(first);
    }
  }
  function ambientDensity(kind){
    const s = strength();
    const base = kind === 'earth' ? 0.44 : 0.70;
    return clamp(base * (0.24 + s * 0.76), 0.05, 0.92);
  }
  function ambientSitesForChunk(kind, cx, opts){
    if(!kind) return [];
    const force = !!(opts && opts.force);
    if(!force && ambientHash(cx, 0, 3) > ambientDensity(kind)) return [];
    const s = Math.max(0.10, strength());
    const maxExtra = kind === 'earth' ? 1 : 2;
    const extra = Math.floor(ambientHash(cx, 0, 5) * (maxExtra + 1) * (0.35 + s * 0.65));
    const count = clamp(1 + extra, 1, kind === 'earth' ? 2 : 3);
    const out = [];
    for(let i=0; i<count; i++){
      const lx = 3 + Math.floor(ambientHash(cx, i + 1, 9) * Math.max(1, CHUNK_W - 6));
      const wx = cx * CHUNK_W + lx;
      const rawSize = kind === 'earth'
        ? 5 + ambientHash(cx, i + 1, 13) * 12 * (0.55 + s * 0.55)
        : 1 + ambientHash(cx, i + 1, 13) * 9;
      out.push({
        x:wx,
        size:clamp(Math.round(rawSize), kind === 'earth' ? 5 : 1, kind === 'earth' ? 16 : 10),
        seed:i + 1
      });
    }
    return out;
  }
  function makeArrayMutator(arr, cx, protectedAreas){
    const baseX = cx * CHUNK_W;
    return {
      get(x,y){
        x = Math.floor(x); y = Math.floor(y);
        const lx = x - baseX;
        if(lx < 0 || lx >= CHUNK_W || y < 0 || y >= WORLD_H) return T.AIR;
        return arr[y * CHUNK_W + lx] ?? T.AIR;
      },
      set(x,y,tile){
        x = Math.floor(x); y = Math.floor(y);
        const lx = x - baseX;
        if(lx < 0 || lx >= CHUNK_W || y < 1 || y >= WORLD_H - 1) return false;
        if(pointInAreas(protectedAreas, x, y)) return false;
        const idx = y * CHUNK_W + lx;
        const old = arr[idx] ?? T.AIR;
        if(old === tile || isProtected(old)) return false;
        arr[idx] = tile;
        return true;
      }
    };
  }
  function makeWorldMutator(getTile, setTile, batch, player, protectedAreas){
    return {
      get(x,y){
        return typeof getTile === 'function' ? getTile(Math.floor(x), Math.floor(y)) : T.AIR;
      },
      set(x,y,tile){
        x = Math.floor(x); y = Math.floor(y);
        if(skipHeroCell(x, y, player)) return false;
        return setTileNotified(x, y, tile, getTile, setTile, batch, protectedAreas);
      }
    };
  }
  function surfaceYForMutator(mut, x){
    if(!mut || typeof mut.get !== 'function') return WORLD_H - 4;
    const tx = Math.round(finite(x, 0));
    for(let y=1; y<WORLD_H-2; y++){
      if(isGroundTile(mut.get(tx, y))) return y;
    }
    return WORLD_H - 4;
  }
  function canAmbientReplace(t){
    return canSurfaceReplace(t) && t !== T.LAVA;
  }
  function setAmbientTile(mut, x, y, tile){
    if(!mut || typeof mut.set !== 'function') return false;
    const old = mut.get(x, y);
    if(!canAmbientReplace(old)) return false;
    return mut.set(x, y, tile);
  }
  function applyAmbientIceSite(site, mut, cx){
    const impactY = surfaceYForMutator(mut, site.x);
    const r = Math.max(0.7, site.size * 0.45);
    const rx = r * (0.92 + ambientHash(cx, site.seed, 21) * 0.18);
    const ry = Math.max(0.7, r * (0.70 + ambientHash(cx, site.seed, 22) * 0.18));
    const cy = Math.round(impactY - Math.max(1, r * 0.34));
    let changed = 0;
    for(let y=Math.floor(cy-ry-1); y<=Math.ceil(cy+ry+1); y++){
      for(let x=Math.floor(site.x-rx-1); x<=Math.ceil(site.x+rx+1); x++){
        const nx = (x - site.x) / rx;
        const ny = (y - cy) / ry;
        const d = nx*nx + ny*ny;
        if(d > 1.0 || hash01(x, y, state.salt, 101 + site.seed) > 1.04 - d * 0.22) continue;
        const tile = d < 0.26 ? T.ICE : (hash01(x, y, state.salt, 102 + site.seed) < 0.34 ? T.ICE : T.SNOW);
        if(setAmbientTile(mut, x, y, tile)) changed++;
      }
    }
    return changed;
  }
  function applyAmbientFireSite(site, mut, cx){
    const impactY = surfaceYForMutator(mut, site.x);
    const r = Math.max(0.75, site.size * 0.42);
    const rx = r * (0.86 + ambientHash(cx, site.seed, 31) * 0.22);
    const ry = Math.max(0.65, r * (0.58 + ambientHash(cx, site.seed, 32) * 0.20));
    const cy = Math.round(impactY - Math.max(0, r * 0.18));
    let changed = 0, lavaPlaced = 0;
    const lavaBudget = site.size >= 6 ? 1 : 0;
    for(let y=Math.floor(cy-ry-1); y<=Math.ceil(cy+ry+1); y++){
      for(let x=Math.floor(site.x-rx-1); x<=Math.ceil(site.x+rx+1); x++){
        const nx = (x - site.x) / rx;
        const ny = (y - cy) / ry;
        const d = nx*nx + ny*ny;
        if(d > 1.0 || hash01(x, y, state.salt, 201 + site.seed) > 1.02 - d * 0.20) continue;
        let tile = T.COAL;
        if(d < 0.18 && lavaPlaced < lavaBudget && hash01(x, y, state.salt, 202 + site.seed) < 0.28){
          tile = T.LAVA;
          lavaPlaced++;
        }else if(d > 0.64){
          tile = hash01(x, y, state.salt, 203 + site.seed) < 0.45 ? T.METEOR_DUST : T.BASALT;
        }else if(hash01(x, y, state.salt, 204 + site.seed) < 0.32){
          tile = T.BASALT;
        }
        if(setAmbientTile(mut, x, y, tile)) changed++;
      }
    }
    return changed;
  }
  function applyAmbientEarthSite(site, mut, cx){
    const half = Math.max(3, Math.round(site.size * 0.5));
    const amp = Math.max(1, Math.round(1 + strength() * 2 + ambientHash(cx, site.seed, 41) * 2));
    const sink = ambientHash(cx, site.seed, 42) < 0.28;
    let changed = 0;
    for(let dx=-half; dx<=half; dx++){
      const x = Math.round(site.x + dx);
      const floor = surfaceYForMutator(mut, x);
      const profile = clamp(1 - Math.abs(dx) / (half + 0.35), 0, 1);
      const h = Math.max(1, Math.round(amp * (0.20 + profile * 0.88)));
      if(sink && Math.abs(dx) < half - 1){
        for(let yy=0; yy<h; yy++){
          const y = floor - yy;
          const old = mut.get(x, y);
          if(!canAmbientReplace(old) || isOpenForImpact(old)) continue;
          if(mut.set(x, y, T.AIR)) changed++;
        }
      }else{
        const baseOld = mut.get(x, floor);
        for(let yy=1; yy<=h; yy++){
          const y = floor - yy;
          const old = mut.get(x, y);
          if(!canAmbientReplace(old) || (!isOpenForImpact(old) && y < floor - 1)) continue;
          const tile = earthMaterial(baseOld, yy === h, hash01(x, y, state.salt, 301 + site.seed));
          if(mut.set(x, y, tile)) changed++;
        }
      }
      if(Math.abs(dx) === half && ambientHash(cx, site.seed + dx, 43) < 0.62){
        const y = floor;
        const old = mut.get(x, y);
        if(canAmbientReplace(old) && mut.set(x, y, ambientHash(cx, site.seed + dx, 44) < 0.5 ? T.BASALT : T.GRANITE)) changed++;
      }
    }
    return changed;
  }
  function applyAmbientSites(kind, cx, mut, opts){
    const sites = ambientSitesForChunk(kind, cx, opts);
    let changed = 0;
    for(const site of sites){
      if(kind === 'ice') changed += applyAmbientIceSite(site, mut, cx);
      else if(kind === 'fire') changed += applyAmbientFireSite(site, mut, cx);
      else if(kind === 'earth') changed += applyAmbientEarthSite(site, mut, cx);
    }
    return changed;
  }
  function applyAmbientChunk(cx, player, getTile, setTile, opts){
    if(!state.active || typeof getTile !== 'function' || typeof setTile !== 'function') return false;
    cx = Math.floor(finite(cx, 0));
    const k = ambientKey(cx);
    if(!(opts && opts.force) && ambientChunks.has(k)) return false;
    const batch = {removed:[], placed:[], water:[]};
    const protectedAreas = progressionProtectedAreas();
    const mut = makeWorldMutator(getTile, setTile, batch, player, protectedAreas);
    const changed = applyAmbientSites(state.active, cx, mut, opts || {});
    rememberAmbientChunk(cx);
    flushBatch(batch, getTile);
    if(changed > 0) markWorldChanged(false);
    return changed > 0;
  }
  function updateAmbient(dt, player, getTile, setTile){
    if(!state.active || !player || typeof getTile !== 'function' || typeof setTile !== 'function') return;
    state.ambientAcc += dt;
    if(state.ambientAcc < CFG.AMBIENT_INTERVAL) return;
    state.ambientAcc = 0;
    const center = Math.floor(finite(player.x, 0) / CHUNK_W);
    const span = CFG.AMBIENT_RADIUS_CHUNKS * 2 + 1;
    let processed = 0, tries = 0;
    while(processed < CFG.AMBIENT_CHUNKS_PER_TICK && tries < span){
      const idx = state.ambientCursor++ % span;
      const offset = idx === 0 ? 0 : (idx % 2 ? -Math.ceil(idx / 2) : Math.ceil(idx / 2));
      const cx = center + offset;
      tries++;
      if(ambientChunks.has(ambientKey(cx))) continue;
      applyAmbientChunk(cx, player, getTile, setTile);
      processed++;
    }
  }
  function applyToChunk(arr, cx){
    if(!state.active || !arr || !Number.isFinite(cx)) return 0;
    cx = Math.floor(cx);
    const protectedAreas = progressionProtectedAreas();
    const mut = makeArrayMutator(arr, cx, protectedAreas);
    const changed = applyAmbientSites(state.active, cx, mut, {});
    rememberAmbientChunk(cx);
    return changed;
  }
  function addEffect(fx){
    if(!fx) return;
    effects.push(fx);
    while(effects.length > CFG.MAX_EFFECTS) effects.shift();
  }

  function fallingSize(){
    const tri = (Math.random() + Math.random() + Math.random()) / 3;
    return clamp(Math.round(1 + tri * 9), 1, 10);
  }
  function spawnSkyChunk(kind, player, getTile){
    if(falling.length >= CFG.MAX_FALLING || !player) return false;
    const px = finite(player.x, 0);
    const tx = Math.round(px + (Math.random() * 2 - 1) * CFG.SPAWN_RADIUS_X);
    const surfaceY = surfaceYAt(tx, getTile);
    const size = fallingSize();
    const drift = (Math.random() * 2 - 1) * 8;
    const startY = Math.max(1.5, Math.min(surfaceY - 42 - Math.random() * 24, 2 + Math.random() * 5));
    const startX = tx + drift;
    falling.push({
      id:'aftermath-'+(state.seq++)+'-'+kind,
      kind,
      x:startX,
      y:startY,
      vx:(tx - startX) * (0.34 + Math.random() * 0.16),
      vy:20 + Math.random() * 12,
      size,
      rot:Math.random() * Math.PI * 2,
      spin:(Math.random() * 2 - 1) * 3.4,
      age:0,
      targetX:tx
    });
    return true;
  }
  function findImpactY(f, getTile){
    const tx = Math.round(f.x);
    const from = clamp(Math.floor(f.y - f.size * 0.35), 1, WORLD_H - 3);
    const to = clamp(Math.floor(f.y + f.size * 0.65 + 5), from, WORLD_H - 2);
    for(let y=from; y<=to; y++){
      if(isGroundTile(getTile(tx, y))) return y;
    }
    return surfaceYAt(tx, getTile);
  }
  function depositIce(f, impactY, getTile, setTile, protectedAreas){
    const cx = Math.round(f.x);
    const r = Math.max(0.7, f.size * 0.52);
    const rx = r * (0.92 + Math.random() * 0.18);
    const ry = Math.max(0.7, r * (0.76 + Math.random() * 0.20));
    const cy = Math.round(impactY - Math.max(1, r * 0.38));
    const batch = {removed:[], placed:[], water:[]};
    let changed = 0;
    for(let y=Math.floor(cy-ry-1); y<=Math.ceil(cy+ry+1); y++){
      for(let x=Math.floor(cx-rx-1); x<=Math.ceil(cx+rx+1); x++){
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        const d = nx*nx + ny*ny;
        if(d > 1.0 || Math.random() > 1.08 - d * 0.30) continue;
        const old = getTile(x,y);
        if(!canSurfaceReplace(old)) continue;
        const tile = d < 0.34 ? T.ICE : (Math.random() < 0.30 ? T.ICE : T.SNOW);
        if(setTileNotified(x, y, tile, getTile, setTile, batch, protectedAreas)) changed++;
      }
    }
    changed += depositMotherCore('ice', cx, cy, r, getTile, setTile, batch, protectedAreas);
    flushBatch(batch, getTile);
    return changed;
  }
  function depositFire(f, impactY, getTile, setTile, protectedAreas){
    const cx = Math.round(f.x);
    const r = Math.max(0.75, f.size * 0.50);
    const rx = r * (0.86 + Math.random() * 0.24);
    const ry = Math.max(0.65, r * (0.64 + Math.random() * 0.22));
    const cy = Math.round(impactY - Math.max(0, r * 0.20));
    const batch = {removed:[], placed:[], water:[]};
    let changed = 0, lavaPlaced = 0;
    const lavaBudget = clamp(Math.floor(f.size / 3), 1, CFG.FIRE_LAVA_CAP);
    for(let y=Math.floor(cy-ry-1); y<=Math.ceil(cy+ry+1); y++){
      for(let x=Math.floor(cx-rx-1); x<=Math.ceil(cx+rx+1); x++){
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        const d = nx*nx + ny*ny;
        if(d > 1.0 || Math.random() > 1.04 - d * 0.24) continue;
        const old = getTile(x,y);
        if(!canSurfaceReplace(old)) continue;
        let tile = T.COAL;
        const core = d < 0.25 && y >= cy - 1;
        if(core && lavaPlaced < lavaBudget && Math.random() < 0.42){
          tile = T.LAVA;
          lavaPlaced++;
        }else if(d > 0.62){
          tile = Math.random() < 0.45 ? T.METEOR_DUST : T.BASALT;
        }else if(Math.random() < 0.24){
          tile = T.BASALT;
        }
        if(setTileNotified(x, y, tile, getTile, setTile, batch, protectedAreas)) changed++;
      }
    }
    changed += depositMotherCore('fire', cx, cy, r, getTile, setTile, batch, protectedAreas);
    const hotCells = Math.min(5, Math.max(1, Math.floor(f.size / 2)));
    for(let i=0; i<hotCells; i++){
      const hx = cx + Math.round((Math.random() * 2 - 1) * Math.max(1, r));
      const hy = cy - 1 - Math.round(Math.random() * Math.max(1, r));
      if(getTile(hx, hy) === T.AIR) setTileNotified(hx, hy, T.HOT_AIR, getTile, setTile, batch, protectedAreas);
    }
    flushBatch(batch, getTile);
    return changed;
  }
  function impactFalling(f, getTile, setTile){
    const impactY = findImpactY(f, getTile);
    const protectedAreas = progressionProtectedAreas();
    const changed = f.kind === 'ice'
      ? depositIce(f, impactY, getTile, setTile, protectedAreas)
      : depositFire(f, impactY, getTile, setTile, protectedAreas);
    addEffect({type:'impact', kind:f.kind, x:f.x, y:impactY, r:f.size, t:0, max:f.kind==='ice'?1.0:1.25});
    if(changed > 0) markWorldChanged(false);
  }
  function updateFalling(dt, getTile, setTile){
    if(!falling.length) return;
    const step = Math.min(0.08, Math.max(0, dt));
    for(let i=falling.length-1; i>=0; i--){
      const f = falling[i];
      f.age += step;
      f.vy = Math.min(CFG.FALL_VMAX, f.vy + CFG.FALL_GRAVITY * step);
      f.x += f.vx * step;
      f.y += f.vy * step;
      f.rot += f.spin * step;
      const tx = Math.round(f.x);
      const ty = Math.round(f.y + f.size * 0.42);
      const surface = surfaceYAt(tx, getTile);
      const blocked = typeof getTile === 'function' && isGroundTile(getTile(tx, ty));
      if(blocked || f.y + f.size * 0.44 >= surface || f.y >= WORLD_H - 2){
        impactFalling(f, getTile, setTile);
        falling.splice(i,1);
      }else if(f.age > 12){
        falling.splice(i,1);
      }
    }
  }

  function skipHeroCell(x, y, player){
    if(!player) return false;
    return Math.abs((x + 0.5) - finite(player.x, 0)) < 1.35 && Math.abs((y + 0.5) - finite(player.y, 0)) < 1.85;
  }
  function earthMaterial(old, top, roll){
    if(top) return old === T.GRASS ? T.GRASS : (roll < 0.45 ? T.DIRT : T.STONE);
    if(roll < 0.34) return T.GRANITE;
    if(roll < 0.62) return T.STONE;
    if(roll < 0.82) return T.BASALT;
    return T.METEOR_DUST;
  }
  function applyEarthShift(player, getTile, setTile){
    if(!player || typeof getTile !== 'function' || typeof setTile !== 'function') return false;
    const px = Math.round(finite(player.x, 0));
    const py = Math.round(finite(player.y, surfaceYAt(px, getTile)));
    const cx = px + Math.round((Math.random() * 2 - 1) * 42);
    const half = Math.round(4 + Math.random() * 7);
    const amp = Math.max(1, Math.round(1 + strength() * (1 + Math.random() * 3)));
    const sink = Math.random() < 0.24;
    const batch = {removed:[], placed:[], water:[]};
    const protectedAreas = progressionProtectedAreas();
    let changed = 0;
    for(let dx=-half; dx<=half; dx++){
      const x = cx + dx;
      const floor = localFloorY(x, py, getTile);
      const profile = clamp(1 - Math.abs(dx) / (half + 0.35), 0, 1);
      const h = Math.max(1, Math.round(amp * (0.25 + profile * 0.95)));
      if(sink && Math.abs(dx) < half - 1){
        for(let yy=0; yy<h; yy++){
          const y = floor - yy;
          if(skipHeroCell(x, y, player)) continue;
          const old = getTile(x, y);
          if(!canSurfaceReplace(old) || isOpenForImpact(old)) continue;
          if(setTileNotified(x, y, T.AIR, getTile, setTile, batch, protectedAreas)) changed++;
        }
      }else{
        const baseOld = getTile(x, floor);
        for(let yy=1; yy<=h; yy++){
          const y = floor - yy;
          if(skipHeroCell(x, y, player)) continue;
          const old = getTile(x, y);
          if(!canSurfaceReplace(old) || (!isOpenForImpact(old) && y < floor - 1)) continue;
          const tile = earthMaterial(baseOld, yy === h, Math.random());
          if(setTileNotified(x, y, tile, getTile, setTile, batch, protectedAreas)) changed++;
        }
      }
      if(Math.abs(dx) === half && Math.random() < 0.72){
        const seamDepth = 1 + Math.floor(Math.random() * 3);
        for(let yy=0; yy<seamDepth; yy++){
          const y = floor + yy;
          if(skipHeroCell(x, y, player)) continue;
          const old = getTile(x, y);
          if(!canSurfaceReplace(old)) continue;
          const tile = yy === 0 && Math.random() < 0.35 ? T.AIR : (Math.random() < 0.5 ? T.BASALT : T.GRANITE);
          if(setTileNotified(x, y, tile, getTile, setTile, batch, protectedAreas)) changed++;
        }
      }
    }
    flushBatch(batch, getTile);
    if(changed > 0){
      addEffect({type:'quake', kind:'earth', x:cx, y:localFloorY(cx, py, getTile), r:half + amp + 2, t:0, max:1.35});
      markWorldChanged(false);
    }
    return changed > 0;
  }

  function spawnNow(player, getTile, setTile){
    const kind = state.active;
    if(kind === 'fire' || kind === 'ice') return spawnSkyChunk(kind, player, getTile);
    if(kind === 'earth') return applyEarthShift(player, getTile, setTile);
    return false;
  }
  function update(dt, player, getTile, setTile){
    dt = Math.max(0, Math.min(0.25, finite(dt, 0)));
    updateFalling(dt, getTile, setTile);
    for(let i=effects.length-1; i>=0; i--){
      const e = effects[i];
      e.t += dt;
      if(e.t >= e.max) effects.splice(i,1);
    }
    if(!state.active) return;
    state.elapsed += dt;
    if(state.elapsed >= DURATION_SECONDS){
      const had = state.active;
      reset();
      if(had) markWorldChanged(true);
      return;
    }
    updateAmbient(dt, player, getTile, setTile);
    state.nextIn -= dt;
    if(state.nextIn > 0) return;
    spawnNow(player, getTile, setTile);
    state.nextIn = scheduleNext(state.active);
  }

  function drawSkyChunk(ctx, TILE, f){
    const px = f.x * TILE;
    const py = f.y * TILE;
    const r = Math.max(5, f.size * TILE * 0.5);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(f.rot || 0);
    if(f.kind === 'ice'){
      const g = ctx.createRadialGradient(0,0,2,0,0,r*1.35);
      g.addColorStop(0,'rgba(255,255,255,0.96)');
      g.addColorStop(0.45,'rgba(157,238,255,0.78)');
      g.addColorStop(1,'rgba(52,126,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0,0,r*1.18,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#e9fbff';
      ctx.fillRect(-r*0.55,-r*0.42,r*1.1,r*0.84);
      ctx.fillStyle = '#8fd6ff';
      ctx.fillRect(-r*0.18,-r*0.58,r*0.36,r*1.16);
    }else{
      const g = ctx.createRadialGradient(0,0,2,0,0,r*1.65);
      g.addColorStop(0,'rgba(255,247,188,0.98)');
      g.addColorStop(0.36,'rgba(255,100,28,0.78)');
      g.addColorStop(1,'rgba(255,64,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0,0,r*1.35,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#282323';
      ctx.fillRect(-r*0.55,-r*0.42,r*1.1,r*0.84);
      ctx.fillStyle = '#ff6a21';
      ctx.fillRect(-r*0.22,-r*0.56,r*0.44,r*1.12);
    }
    ctx.restore();
  }
  function drawEffect(ctx, TILE, e){
    const t = clamp(e.t / Math.max(0.01, e.max), 0, 1);
    const px = e.x * TILE, py = e.y * TILE;
    const r = Math.max(1, e.r || 4) * TILE * (0.35 + t * 1.65);
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - t);
    if(e.type === 'quake'){
      ctx.strokeStyle = 'rgba(196,107,255,0.72)';
      ctx.lineWidth = Math.max(1, TILE * 0.08);
      ctx.beginPath();
      ctx.ellipse(px, py, r, r * 0.24, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(121,201,93,0.50)';
      for(let i=-2; i<=2; i++){
        ctx.beginPath();
        ctx.moveTo(px + i * r * 0.22, py - r * 0.10);
        ctx.lineTo(px + i * r * 0.22 + Math.sin(t*9+i)*TILE*0.5, py + r * 0.18);
        ctx.stroke();
      }
    }else{
      ctx.strokeStyle = e.kind === 'ice' ? 'rgba(180,245,255,0.85)' : 'rgba(255,108,34,0.82)';
      ctx.lineWidth = Math.max(1, TILE * 0.10);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  function draw(ctx, TILE, visible, camX, camY, W, H, zoom){
    if(!ctx || !TILE) return;
    const z = Number.isFinite(zoom) ? zoom : 1;
    const margin = 160 / Math.max(0.25, z);
    function onscreen(x,y,r){
      if(typeof visible === 'function' && !visible(Math.floor(x), Math.floor(y))) return false;
      if(!Number.isFinite(camX) || !Number.isFinite(camY) || !Number.isFinite(W) || !Number.isFinite(H)) return true;
      const sx = (x * TILE - camX) * z;
      const sy = (y * TILE - camY) * z;
      const rr = r * TILE * z;
      return sx > -margin - rr && sx < W + margin + rr && sy > -margin - rr && sy < H + margin + rr;
    }
    for(const e of effects) if(onscreen(e.x,e.y,e.r||4)) drawEffect(ctx, TILE, e);
    for(const f of falling) if(onscreen(f.x,f.y,f.size||3)) drawSkyChunk(ctx, TILE, f);
  }

  function snapshot(){
    if(!state.active) return {v:1, active:null};
    return {
      v:1,
      active:state.active,
      elapsed:round3(state.elapsed),
      nextIn:round3(state.nextIn),
      seq:state.seq|0,
      salt:state.salt|0,
      ambient:Array.from(ambientChunks.keys()).slice(-CFG.AMBIENT_SAVE_CAP),
      falling:falling.slice(0, CFG.MAX_SAVED_FALLING).map(f=>({
        kind:f.kind, x:round3(f.x), y:round3(f.y), vx:round3(f.vx), vy:round3(f.vy),
        size:clamp(Math.round(f.size||1),1,10), rot:round3(f.rot||0), spin:round3(f.spin||0), age:round3(f.age||0)
      }))
    };
  }
  function restore(data){
    reset();
    if(!data || typeof data !== 'object') return false;
    const kind = normalizeKind(data.active);
    if(!kind) return false;
    state.active = kind;
    state.elapsed = clamp(finite(data.elapsed, 0), 0, DURATION_SECONDS);
    if(state.elapsed >= DURATION_SECONDS){
      reset();
      return false;
    }
    state.nextIn = clamp(finite(data.nextIn, baseInterval(kind)), 0, baseInterval(kind) * 8);
    state.seq = Math.max(1, Math.floor(finite(data.seq, 1)));
    state.salt = Math.max(1, Math.floor(finite(data.salt, state.seq || 1)) || 1);
    if(Array.isArray(data.ambient)){
      for(const raw of data.ambient){
        if(typeof raw !== 'string' || ambientChunks.size >= CFG.AMBIENT_SAVE_CAP) continue;
        if(!raw.startsWith(kind+':'+(state.salt|0)+':')) continue;
        ambientChunks.set(raw, state.elapsed);
      }
    }
    if(Array.isArray(data.falling)){
      for(const raw of data.falling){
        const fk = normalizeKind(raw && raw.kind);
        if((fk !== 'fire' && fk !== 'ice') || falling.length >= CFG.MAX_SAVED_FALLING) continue;
        falling.push({
          id:'restored-aftermath-'+(state.seq++),
          kind:fk,
          x:finite(raw.x, 0),
          y:clamp(finite(raw.y, 2), 1, WORLD_H - 2),
          vx:clamp(finite(raw.vx, 0), -32, 32),
          vy:clamp(finite(raw.vy, 22), -8, CFG.FALL_VMAX),
          size:clamp(Math.round(finite(raw.size, 4)), 1, 10),
          rot:finite(raw.rot, 0),
          spin:clamp(finite(raw.spin, 0), -7, 7),
          age:clamp(finite(raw.age, 0), 0, 12)
        });
      }
    }
    return true;
  }
  function status(){
    return {
      active:state.active,
      elapsed:+state.elapsed.toFixed(1),
      daysLeft:+Math.max(0, (DURATION_SECONDS - state.elapsed) / DAY_SECONDS).toFixed(2),
      strength:+strength().toFixed(3),
      nextIn:+Math.max(0, state.nextIn).toFixed(1),
      falling:falling.length,
      effects:effects.length,
      ambientChunks:ambientChunks.size
    };
  }
  function metrics(){ return status(); }
  function _debug(){
    return {
      state,
      falling,
      effects,
      start,
      reset,
      spawnNow,
      setNext:(v)=>{ state.nextIn = Math.max(0, finite(v,0)); },
      setElapsed:(v)=>{ state.elapsed = clamp(finite(v,0), 0, DURATION_SECONDS + 1); },
      strength,
      surfaceYAt,
      applyEarthShift,
      applyAmbientChunk,
      applyToChunk,
      motherCoreTile,
      ambientSitesForChunk,
      ambientChunks
    };
  }

  const api = {config:CFG, start, update, draw, applyToChunk, snapshot, restore, reset, status, metrics, _debug};
  MM.guardianAftermath = api;
  MM.aftermath = api;
  return api;
})();

export { guardianAftermath };
export default guardianAftermath;
