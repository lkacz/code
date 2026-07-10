// Block-built alien mech prototypes for the far left/right world bands.
// They are entities made from real game tiles: the world grid stays editable,
// while the mech can move, fight, be boarded after the pilot is defeated, and
// collapse back into the same blocks players use for their own machines.
import { T, INFO, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } from '../constants.js';
import { isChairTile, isFoliageTile, isPlayerPassableTile, isReplaceableNaturalOpenTile, isSolidCollisionTile, isSunTransparentTile } from './material_physics.js';
import { worldGen as WORLDGEN } from './worldgen.js';
import { turrets as TURRETS } from './turrets.js';

(function(){
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.MM = root.MM || {};

  const CFG = {
    MIN_DISTANCE: 5000,
    ZONE_W: 380,
    SCAN_RADIUS: 210,
    SCAN_INTERVAL: 1.8,
    SPAWN_CHANCE: 0.42,
    MAX_ACTIVE: 6,
    MIN_ACTIVE_GAP: 210,
    GRAV: 21,
    WALK_ACCEL: 7.5,
    WALK_SPEED_AI: 1.85,
    WALK_SPEED_RIDER: 2.35,
    TRACK_ACCEL: 5.2,
    TRACK_SPEED_AI: 1.45,
    TRACK_SPEED_RIDER: 1.9,
    GROUND_DRAG: 9,
    AIR_DRAG: 1.4,
    JUMP: -7.2,
    SPRING_JUMP: -8.4,
    SPRING_KICK_AI: 1.45,
    SPRING_KICK_RIDER: 1.9,
    SPRING_CREEP: 0.28,
    HOP_INTERVAL_AI: 0.82,
    HOP_INTERVAL_RIDER: 0.46,
    HOSTILE_SIGHT: 38,
    HOSTILE_WAKE: 54,
    CONTACT_DAMAGE: 9,
    SHIELD_ABSORB: 0.82,
    BOARD_RADIUS: 2.2,
    PLAYER_SPAWN_GAP: 24,
    OBSTACLE_STRIKE_INTERVAL: 0.42,
    OBSTACLE_STRIKE_DAMAGE: 5.5,
    PIT_JUMP_CHANCE: 0.8,
    JUMP_SCAN_DIST: 5,
    UNCERTAIN_JUMP_LIMIT: 3,
    ENERGY_SOLAR_CAP: 90,
    ENERGY_FORGE_CAP: 75,
    RIDER_WALK_ENERGY: 1.65,
    RIDER_JUMP_ENERGY: 7.5,
    HERO_TRACK_ENERGY_MULT: 1.18,
    SOLAR_PANEL_CHARGE: 0.42,
    EXTERNAL_DRAIN_RADIUS: 4.5,
    // Player-built mechs: a chair-crowned block machine assembled straight from
    // the world grid (see the "built mech" section below). Their dynamos are
    // powered exactly like the placed machine (engine/dynamo.js): wind through
    // a vertical slot plus water/steam/hot-air flow — never coal or lava.
    BUILT_MAX_CELLS: 150,
    BUILT_MAX_W: 15,
    BUILT_MAX_H: 15,
    BUILT_MIN_TRACKS: 2,
    BUILT_BASE_ENERGY: 30,
    BUILT_BATTERY_ENERGY: 60,
    BUILT_DYNAMO_ENERGY: 20,
    BUILT_PANEL_ENERGY: 8,
    BUILT_MAX_ENERGY_CAP: 300,
    BUILT_SEAT_SCAN_COOLDOWN: 0.9,
    BUILT_SEAT_JUMP_GRACE: 0.35
  };
  // Chair material sets how efficiently the seated hero's own energy reaches the
  // drive: steel is a clean link, wood wastes the most.
  const CHAIR_ENERGY_MULT={wood:1.38, stone:1.18, steel:1.0};

  const WORLD_TOP = Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;
  let mechs = [];
  let usedZones = new Set();
  let nextId = 1;
  let scanT = 0;
  let simT = 0;
  let riderMechId = null;
  let spawnFreezeT = 0;
  let lastGetTile = null;
  let lastSetTile = null;

  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function finite(v){ return Number.isFinite(Number(v)); }
  function zoneKey(z){ return 'z'+z; }
  function getSafe(getTile,x,y,fallback){
    try{ return typeof getTile === 'function' ? getTile(Math.floor(x),Math.floor(y)) : fallback; }catch(e){ return fallback; }
  }
  function setSafe(setTile,x,y,t){
    if(typeof setTile !== 'function') return false;
    try{ setTile(Math.floor(x),Math.floor(y),t); return true; }catch(e){ return false; }
  }
  function rememberWorldFns(getTile,setTile){
    if(typeof getTile === 'function') lastGetTile=getTile;
    if(typeof setTile === 'function') lastSetTile=setTile;
  }
  function worldFns(opts){
    const w=root.MM && root.MM.world;
    return {
      getTile:(opts && opts.getTile) || lastGetTile || (w && w.getTile) || null,
      setTile:(opts && opts.setTile) || lastSetTile || (w && w.setTile) || null
    };
  }
  function seedNum(){
    try{ return (WORLDGEN && Number.isFinite(WORLDGEN.worldSeed)) ? WORLDGEN.worldSeed|0 : 12345; }catch(e){ return 12345; }
  }
  function hash01(a,b){
    let h = Math.imul((a|0) ^ seedNum(), 374761393) ^ Math.imul((b|0)+0x9e3779b9, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
  }
  function randCentered(seed,scale){ return (hash01(seed,731)-0.5)*(scale||1); }
  function inWorldY(y){ return Number.isFinite(y) && y>=WORLD_TOP && y<WORLD_BOTTOM; }
  function emit(type,detail){
    try{
      if(typeof root.dispatchEvent === 'function' && typeof root.CustomEvent !== 'undefined'){
        root.dispatchEvent(new root.CustomEvent(type,{detail}));
      }
    }catch(e){}
  }
  function say(text){
    try{ if(typeof root.msg === 'function') root.msg(text); }catch(e){}
  }
  function play(id){
    try{ if(root.MM.audio && root.MM.audio.play) root.MM.audio.play(id); }catch(e){}
  }
  function playMech(m,id,cooldown){
    if(!m) return play(id);
    const cd=Math.max(0,Number(cooldown)||0);
    const k='_sound_'+String(id||'fx');
    if(cd>0 && Number.isFinite(m[k]) && simT-m[k]<cd) return;
    m[k]=simT;
    play(id);
  }
  function notifyResources(key,n){
    try{
      if(typeof root.updateInventoryHud === 'function') root.updateInventoryHud();
      else emit('mm-resources-change',{key,gained:n});
    }catch(e){}
  }
  function addResource(key,n){
    const inv=root.inv;
    const amount=Math.max(0,n|0);
    if(!inv || !key || amount<=0) return false;
    if(typeof inv[key] !== 'number') inv[key]=0;
    inv[key]+=amount;
    notifyResources(key,amount);
    return true;
  }
  function addXp(amount,x,y,species){
    const p=root.player;
    const n=Math.max(0,Math.round(Number(amount)||0));
    if(p && typeof p.xp === 'number' && n>0) p.xp += n;
    emit('mm-xp-awarded',{amount:n,x,y,species:species||'ALIEN_MECH',special:true});
  }

  function isOpenTile(t){
    return isPlayerPassableTile(t);
  }
  function isCrushablePlant(t){
    return t===T.WOOD || isFoliageTile(t);
  }
  function isBlockingTile(t){
    if(isCrushablePlant(t)) return false;
    if(t===T.WATER || t===T.LAVA) return false;
    return isSolidCollisionTile(t);
  }
  function isSupportTile(t){
    if(t===T.WATER || t===T.LAVA) return false;
    return isSolidCollisionTile(t);
  }
  // Tiles a player-built mech may be assembled from. Natural terrain is excluded
  // so the chair scan never swallows the ground the machine parks on; positional
  // registries (teleporter pairs, vending stock, respawn totems) stay out too.
  const MECH_COMPONENT_TILES=new Set([
    T.TRACK,T.STEEL,T.GLASS,T.WOOD,T.BRICK,T.OBSIDIAN,T.COAL,
    T.ELECTRONICS,T.TRANSISTOR,T.DYNAMO,T.DYNAMO_SLOT,
    T.SOLAR_PANEL,T.SOLAR_BATTERY,T.TURRET,T.FIRE_TURRET,T.WATER_TURRET,
    T.SPRING_PLATFORM,T.COPPER_WIRE,T.WIRE,T.WATER_PIPE,T.TORCH,T.CHIMNEY,
    T.WOOD_DOOR,T.STONE_DOOR,T.STEEL_DOOR,
    T.WOOD_TRAPDOOR,T.STONE_TRAPDOOR,T.STEEL_TRAPDOOR,
    T.LADDER,T.CHAIR_WOOD,T.CHAIR_STONE,T.CHAIR_STEEL
  ]);
  function isMechComponentTile(t){ return MECH_COMPONENT_TILES.has(t); }
  // Infrastructure overlays (copper wire, ladders, pipes) ride on the world's
  // overlay layer; aboard a mech they become per-cell `infra` lists.
  function worldApi(){ return (root.MM && root.MM.world) || null; }
  function infraStackAt(x,y){
    const w=worldApi();
    if(!w || typeof w.getInfrastructureStack !== 'function') return [];
    try{
      const s=w.getInfrastructureStack(Math.floor(x),Math.floor(y));
      return Array.isArray(s) ? s.filter(t=>t!==T.AIR) : [];
    }catch(e){ return []; }
  }
  function clearInfraAt(x,y,t){
    const w=worldApi();
    if(!w || typeof w.clearInfrastructure !== 'function') return false;
    try{ w.clearInfrastructure(Math.floor(x),Math.floor(y),t); return true; }catch(e){ return false; }
  }
  function setInfraAt(x,y,t){
    const w=worldApi();
    if(!w || typeof w.setInfrastructure !== 'function') return false;
    try{ w.setInfrastructure(Math.floor(x),Math.floor(y),t); return true; }catch(e){ return false; }
  }
  function canBreakObstacleTile(t){
    if(t===T.AIR || t===T.WATER || t===T.LAVA) return false;
    if(isCrushablePlant(t)) return true;
    if(!isSolidCollisionTile(t)) return false;
    const info=INFO[t] || {};
    if(info.unmineable || info.protected || info.story || info.altar || info.guardianRelic) return false;
    return (Number(info.hp)||0)>0;
  }
  function durabilityForTile(t){
    const info=INFO[t] || {};
    if(t===T.DYNAMO || t===T.DYNAMO_SLOT) return 14;
    if(t===T.SOLAR_BATTERY) return 11;
    if(t===T.SOLAR_PANEL) return 8;
    if(t===T.FIRE_TURRET || t===T.TURRET || t===T.WATER_TURRET) return 13;
    if(t===T.COPPER_WIRE || t===T.WIRE) return 4;
    if(t===T.COAL || t===T.LAVA) return 6;
    return Math.max(2, Number(info.hp)||2);
  }
  function durabilityForCell(t,role){
    if(role==='cockpit') return 10;
    if(role==='pilot') return 8;
    if(role==='spring') return 12;
    return durabilityForTile(t);
  }
  function obstacleHp(t){
    const info=INFO[t] || {};
    return Math.max(1.5, Number(info.hp)||3);
  }
  function pushCell(cells,x,y,t,role,wireConn){
    const cell={dx:x,dy:y,t,role:role||'',hp:durabilityForCell(t,role||'')};
    if(wireConn){
      cell.wire=T.COPPER_WIRE;
      cell.wireConn=Object.assign({left:false,right:false,up:false,down:false},wireConn);
    }
    cells.push(cell);
  }
  function makeForgeBaseCells(trackDrive){
    const cells=[];
    pushCell(cells,0,0,T.STEEL,'roof');
    pushCell(cells,1,0,T.STEEL_TRAPDOOR,'hatch');
    pushCell(cells,2,0,T.STEEL,'roof');
    pushCell(cells,0,1,T.GLASS,'cockpit');
    pushCell(cells,2,1,T.DYNAMO,'dynamo',trackDrive?{down:true}:null);
    pushCell(cells,3,1,T.DYNAMO_SLOT,'dynamoSlot');
    pushCell(cells,4,1,T.DYNAMO,'dynamo');
    pushCell(cells,0,2,T.STEEL,'body');
    pushCell(cells,1,2,T.STEEL,'body');
    pushCell(cells,2,2,T.STEEL,'body',trackDrive?{up:true,down:true}:null);
    pushCell(cells,4,2,T.FIRE_TURRET,'turret');
    pushCell(cells,0,3,T.STEEL,'body');
    pushCell(cells,1,3,T.STEEL,'body');
    pushCell(cells,2,3,T.STEEL,'body',trackDrive?{up:true,down:true}:null);
    pushCell(cells,3,3,T.COAL,'coal');
    pushCell(cells,4,3,T.STEEL,'body');
    pushCell(cells,0,4,T.STEEL,'body');
    pushCell(cells,1,4,T.STEEL,'body');
    pushCell(cells,2,4,T.STEEL,'body',trackDrive?{up:true,down:true}:null);
    pushCell(cells,3,4,T.STEEL,'body');
    pushCell(cells,4,4,T.STEEL,'body');
    const baseRole=trackDrive ? 'track' : 'leg';
    const baseTile=trackDrive ? T.TRACK : T.STEEL;
    pushCell(cells,1,5,baseTile,baseRole,trackDrive?{right:true}:null);
    pushCell(cells,2,5,baseTile,baseRole,trackDrive?{left:true,right:true,up:true}:null);
    pushCell(cells,3,5,baseTile,baseRole,trackDrive?{left:true}:null);
    return cells;
  }
  function makeForgeLegCells(seed){
    return makeForgeBaseCells(false);
  }
  function makeForgeTrackCells(seed){
    return makeForgeBaseCells(true);
  }
  function forgeVariantForSeed(seed){
    return Math.abs(Number(seed)||0)%3===0 ? 'tracks' : 'legs';
  }
  function makeForgeCells(seed){
    return forgeVariantForSeed(seed)==='tracks' ? makeForgeTrackCells(seed) : makeForgeLegCells(seed);
  }
  function makeSolarCells(seed){
    const cells=[];
    pushCell(cells,0,0,T.SOLAR_PANEL,'solar');
    pushCell(cells,1,0,T.SOLAR_PANEL,'solar');
    pushCell(cells,2,0,T.SOLAR_PANEL,'solar');
    pushCell(cells,3,0,T.SOLAR_PANEL,'solar');
    pushCell(cells,4,0,T.SOLAR_PANEL,'solar');
    pushCell(cells,1,1,T.GLASS,'cockpit');
    pushCell(cells,2,1,T.ELECTRONICS,'pilot');
    pushCell(cells,3,1,T.STEEL,'armor');
    pushCell(cells,4,1,T.SOLAR_BATTERY,'power');
    pushCell(cells,0,2,T.STEEL,'floor');
    pushCell(cells,1,2,T.STEEL,'floor');
    pushCell(cells,2,2,T.STEEL,'floor');
    pushCell(cells,3,2,T.STEEL,'floor');
    pushCell(cells,4,2,T.TURRET,'turret');
    pushCell(cells,1,3,T.ELECTRONICS,'electronics');
    pushCell(cells,2,3,T.COPPER_WIRE,'wire');
    pushCell(cells,3,3,T.SOLAR_BATTERY,'power');
    pushCell(cells,0,4,T.STEEL,'floor');
    pushCell(cells,1,4,T.STEEL,'floor');
    pushCell(cells,2,4,T.STEEL,'floor');
    pushCell(cells,3,4,T.STEEL,'floor');
    pushCell(cells,2,5,T.SPRING_PLATFORM,'spring');
    return cells;
  }
  function normalizeCells(cells){
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const c of cells){ minX=Math.min(minX,c.dx); minY=Math.min(minY,c.dy); maxX=Math.max(maxX,c.dx); maxY=Math.max(maxY,c.dy); }
    return {minX,maxX,minY,maxY,w:maxX-minX+1,h:maxY-minY+1};
  }
  function makeBlueprint(kind,seed){
    const cells = kind==='solar' ? makeSolarCells(seed) : makeForgeCells(seed);
    const bounds=normalizeCells(cells);
    const maxHp=Math.round(cells.reduce((n,c)=>n+c.hp,0)*2.4);
    return {
      kind,
      cells,
      bounds,
      maxHp,
      pilotMaxHp: kind==='solar' ? 42 : 48,
      variant: kind==='forge' ? forgeVariantForSeed(seed) : 'solar',
      name: kind==='solar' ? 'Solar hopper' : (forgeVariantForSeed(seed)==='tracks' ? 'Forge crawler' : 'Forge mech')
    };
  }
  function cockpitCell(m){
    return (m.cells||[]).find(c=>c.role==='chair') || (m.cells||[]).find(c=>c.role==='cockpit') || (m.cells||[]).find(c=>c.t===T.GLASS) || {dx:2,dy:1};
  }
  function chairCell(m){
    return (m.cells||[]).find(c=>c.role==='chair') || null;
  }
  function bounds(m){
    if(!m._bounds) m._bounds=normalizeCells(m.cells||[]);
    return m._bounds;
  }
  function centerX(m){ const b=bounds(m); return m.x + (b.minX+b.maxX+1)*0.5; }
  function centerY(m){ const b=bounds(m); return m.y + (b.minY+b.maxY+1)*0.5; }
  function rect(m,x,y){
    const b=bounds(m);
    return {left:x+b.minX,right:x+b.maxX+1,top:y+b.minY,bottom:y+b.maxY+1,w:b.w,h:b.h};
  }
  function rectOverlap(a,b){
    return Math.min(a.right,b.right)>Math.max(a.left,b.left) && Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top);
  }
  function heroRect(player){
    const hw=(player.w||0.7)/2, hh=(player.h||0.95)/2;
    return {left:player.x-hw,right:player.x+hw,top:player.y-hh,bottom:player.y+hh};
  }
  function cellWorld(m,c,x,y){
    return {x:Math.floor((x==null?m.x:x)+c.dx),y:Math.floor((y==null?m.y:y)+c.dy)};
  }
  function supportCells(m){
    const byX=new Map();
    for(const c of (m && m.cells) || []){
      if(!c || c.t===T.AIR) continue;
      const prev=byX.get(c.dx);
      if(!prev || c.dy>prev.dy) byX.set(c.dx,c);
    }
    return [...byX.values()];
  }
  function supportSnapY(m,x,y,getTile){
    let target=null;
    for(const c of supportCells(m)){
      const sx=Math.floor(x+c.dx);
      const sy=Math.floor(y+c.dy+1);
      if(!inWorldY(sy)) continue;
      if(!isSupportTile(getSafe(getTile,sx,sy,T.AIR))) continue;
      const ty=sy-c.dy-1;
      target = target==null ? ty : Math.min(target,ty);
    }
    if(target==null || Math.abs(target-y)>1.05) return null;
    return canFitAt(m,x,target,getTile) ? target : null;
  }
  function supportAt(m,x,y,getTile){
    return supportSnapY(m,x,y,getTile)!=null;
  }
  function snapToGround(m,getTile){
    const y=supportSnapY(m,m.x,m.y,getTile);
    if(y==null){
      m.onGround=false;
      return false;
    }
    m.y=y;
    m.onGround=true;
    if((m.vy||0)>0) m.vy=0;
    return true;
  }
  function headClearAt(m,x,y,getTile,clearance){
    const dy=Math.max(1,Math.min(4,Number(clearance)||2));
    return canFitAt(m,x,y-dy,getTile);
  }
  function blockingCellsAt(m,x,y,getTile){
    const out=[];
    const seen=new Set();
    for(const c of m.cells){
      const p=cellWorld(m,c,x,y);
      if(!inWorldY(p.y)) continue;
      const t=getSafe(getTile,p.x,p.y,T.AIR);
      if(!isBlockingTile(t)) continue;
      const k=p.x+','+p.y;
      if(seen.has(k)) continue;
      seen.add(k);
      out.push({x:p.x,y:p.y,t});
    }
    return out;
  }
  function frontObstacleCells(m,dir,getTile){
    const r=rect(m,m.x,m.y);
    const tx=dir>0 ? Math.floor(r.right) : Math.floor(r.left)-1;
    const y0=Math.floor(r.top+0.35);
    const y1=Math.floor(r.bottom-0.2);
    const out=[];
    for(let y=y0; y<=y1; y++){
      const t=getSafe(getTile,tx,y,T.AIR);
      if(isBlockingTile(t)) out.push({x:tx,y,t});
    }
    return out;
  }
  function hasLandingAhead(m,dir,getTile){
    const stepDir=dir<0?-1:1;
    for(let dx=2; dx<=CFG.JUMP_SCAN_DIST; dx++){
      const x=m.x+stepDir*dx;
      for(let up=0; up<=4; up++){
        const y=m.y-up;
        if(!canFitAt(m,x,y,getTile)) continue;
        if(supportAt(m,x,y,getTile)) return true;
      }
    }
    return false;
  }
  function pitAhead(m,dir,getTile){
    if(!m.onGround || !dir) return false;
    const r=rect(m,m.x,m.y);
    const stepDir=dir<0?-1:1;
    const start=stepDir>0 ? Math.floor(r.right) : Math.floor(r.left)-1;
    const footY=Math.floor(r.bottom+0.05);
    let emptyCols=0;
    for(let i=0; i<3; i++){
      const x=start+stepDir*i;
      let support=false;
      for(let y=footY; y<=footY+3; y++){
        if(isSupportTile(getSafe(getTile,x,y,T.AIR))){ support=true; break; }
      }
      if(!support) emptyCols++;
    }
    return emptyCols>=2 && hasLandingAhead(m,dir,getTile);
  }
  function escapeJumpLikely(m,dir,getTile){
    if(!m.onGround || !dir) return false;
    if(!headClearAt(m,m.x,m.y,getTile,2)) return false;
    return hasLandingAhead(m,dir,getTile);
  }
  function cellAt(tx,ty){
    tx=Math.floor(tx); ty=Math.floor(ty);
    for(const m of mechs){
      for(const c of m.cells){
        const p=cellWorld(m,c);
        if(p.x===tx && p.y===ty) return {mech:m,cell:c};
      }
    }
    return null;
  }
  // World-position index of live mech cells, consumed by engine/dynamo.js as a
  // tile overlay: a mech-carried [casing|slot|casing] stack validates, catches
  // wind and receives water/steam/hot-air recordFlow exactly like the placed
  // machine. Rebuilt lazily — mechs move every update tick. Numeric keys keep
  // the water/gas hot paths allocation-free (see the getTile-allocation-tax
  // perf note: string keys per tile read once collapsed the frame rate).
  let cellIndex=new Map();
  let cellIndexDirty=true;
  function markCellIndexDirty(){ cellIndexDirty=true; }
  function overlayKey(x,y){ return Math.floor(x)*2048+(Math.floor(y)+520); }
  function liveCellIndex(){
    if(cellIndexDirty){
      cellIndexDirty=false;
      cellIndex.clear();
      for(const m of mechs){
        if(!m || m.hp<=0) continue;
        for(const c of m.cells||[]){
          if(!c || c.t===T.AIR) continue;
          cellIndex.set(overlayKey(m.x+c.dx,m.y+c.dy),{m,c});
        }
      }
    }
    return cellIndex;
  }
  function tileOverlayAt(x,y){
    if(!mechs.length) return null; // fast path: no live mechs, no overlay
    const hit=liveCellIndex().get(overlayKey(x,y));
    return hit ? hit.c.t : null;
  }
  // engine/dynamo.js pushes flow gains here when water/steam/hot-air passes a
  // mech-carried slot: same media, same gain numbers, hull battery as the store.
  function absorbDynamoFlow(x,y,kind,energy){
    const hit=liveCellIndex().get(overlayKey(x,y));
    if(!hit || hit.c.t!==T.DYNAMO_SLOT || hit.m.hp<=0) return false;
    const m=hit.m;
    const gain=Math.max(0,Number(energy)||0);
    if(!Number.isFinite(m.maxEnergy)) m.maxEnergy=mechMaxEnergy(m.kind);
    m.energy=Math.min(m.maxEnergy,(Number(m.energy)||0)+gain);
    m.powerPulse=Math.min(1,(m.powerPulse||0)+0.14+gain*0.05);
    return true;
  }
  function findAt(tx,ty){ const hit=cellAt(tx,ty); return hit ? hit.mech : null; }
  function findRiderMech(){
    if(riderMechId==null) return null;
    const m=mechs.find(x=>x.id===riderMechId && x.rider);
    if(!m) riderMechId=null;
    return m || null;
  }
  function heroMech(){ return findRiderMech(); }

  function canFitAt(m,x,y,getTile){
    for(const c of m.cells){
      const p=cellWorld(m,c,x,y);
      if(!inWorldY(p.y)) return false;
      const t=getSafe(getTile,p.x,p.y,T.AIR);
      if(isBlockingTile(t)) return false;
    }
    return true;
  }
  function clearCrushablesInRect(m,x,y,getTile,setTile,dir){
    const r=rect(m,x,y);
    const x0=Math.floor(r.left)-1, x1=Math.floor(r.right)+1;
    const y0=Math.floor(r.top)-1, y1=Math.floor(r.bottom);
    let cleared=0;
    for(let yy=y0; yy<=y1; yy++){
      for(let xx=x0; xx<=x1; xx++){
        const t=getSafe(getTile,xx,yy,T.AIR);
        if(!isCrushablePlant(t)) continue;
        if(t===T.WOOD){
          try{
            if(root.MM.trees && root.MM.trees.startTreeFall && root.MM.trees.startTreeFall(getTile,setTile,dir||1,xx,yy)){
              cleared++;
              continue;
            }
          }catch(e){}
        }
        if(setSafe(setTile,xx,yy,T.AIR)) cleared++;
      }
    }
    if(cleared>0){
      m.crushFx=Math.min(1,(m.crushFx||0)+0.35);
      playMech(m,'break',0.18);
    }
    return cleared;
  }
  function breakObstacleAt(m,x,y,t,setTile,getTile){
    if(!canBreakObstacleTile(t)) return false;
    const k=x+','+y;
    const damage=(m._obstacleDamage && m._obstacleDamage[k] || 0)+CFG.OBSTACLE_STRIKE_DAMAGE;
    const hp=obstacleHp(t)*(m.rider?1.15:1);
    if(!m._obstacleDamage) m._obstacleDamage=Object.create(null);
    if(damage<hp){
      m._obstacleDamage[k]=damage;
      return false;
    }
    delete m._obstacleDamage[k];
    if(setSafe(setTile,x,y,T.AIR)){
      try{ if(root.MM.water && root.MM.water.onTileChanged) root.MM.water.onTileChanged(x,y,getTile); }catch(e){}
      try{ if(root.MM.fallingSolids && root.MM.fallingSolids.onTileRemoved) root.MM.fallingSolids.onTileRemoved(x,y); }catch(e){}
      try{ if(root.__mmMarkWorldChanged) root.__mmMarkWorldChanged(x,y); }catch(e){}
      emit('mm-combat-event',{kind:'slam',target:'terrain',source:m.rider?'hero_mech':'alien_mech',x:x+0.5,y:y+0.5,amount:hp,power:1.1});
      return true;
    }
    return false;
  }
  function attackObstacles(m,dt,getTile,setTile,dir){
    if(!dir || !setTile) return 0;
    m.obstacleCd=Math.max(0,(m.obstacleCd||0)-dt);
    if(m.obstacleCd>0) return 0;
    const cells=(m.blockedTiles && m.blockedTiles.length) ? m.blockedTiles : frontObstacleCells(m,dir,getTile);
    const fresh=cells.map(c=>({x:c.x,y:c.y,t:getSafe(getTile,c.x,c.y,T.AIR)}));
    const targets=fresh.filter(c=>canBreakObstacleTile(c.t)).sort((a,b)=>{
      const midY=m.y+bounds(m).maxY*0.48;
      return Math.abs(a.y-midY)-Math.abs(b.y-midY);
    }).slice(0,3);
    if(!targets.length) return 0;
    m.obstacleCd=CFG.OBSTACLE_STRIKE_INTERVAL;
    let broken=0;
    for(const c of targets){
      if(breakObstacleAt(m,c.x,c.y,c.t,setTile,getTile)) broken++;
    }
    m.crushFx=Math.min(1,(m.crushFx||0)+0.28);
    playMech(m,broken?'break':'hit',broken?0.18:0.32);
    return broken;
  }
  function verticalCollisionSnapY(m,ny,sign,getTile){
    let target=null;
    for(const c of m.cells){
      const p=cellWorld(m,c,m.x,ny);
      if(!inWorldY(p.y)) continue;
      if(!isBlockingTile(getSafe(getTile,p.x,p.y,T.AIR))) continue;
      const limit=sign>0 ? p.y-c.dy-1 : p.y-c.dy+1;
      target = target==null ? limit : (sign>0 ? Math.min(target,limit) : Math.max(target,limit));
    }
    return target;
  }
  function horizontalMove(m,dt,getTile,setTile,dir){
    if(Math.abs(m.vx||0)<0.001) return;
    const maxStep=0.34;
    let rem=Math.abs(m.vx*dt);
    const sign=m.vx>0?1:-1;
    while(rem>0){
      const step=Math.min(maxStep,rem);
      const nx=m.x+sign*step;
      clearCrushablesInRect(m,nx,m.y,getTile,setTile,sign);
      if(canFitAt(m,nx,m.y,getTile)){
        m.x=nx;
        m.blockedTiles=null;
        m.blockedDir=0;
      }else{
        m.blockedDir=sign;
        m.blockedTiles=blockingCellsAt(m,nx,m.y,getTile);
        m.blockedT=simT;
        m.vx=0;
        break;
      }
      rem-=step;
    }
  }
  function verticalMove(m,dt,getTile,setTile){
    m.onGround=false;
    const maxStep=0.34;
    let rem=Math.abs((m.vy||0)*dt);
    const sign=(m.vy||0)>0?1:-1;
    while(rem>0){
      const step=Math.min(maxStep,rem);
      const ny=m.y+sign*step;
      clearCrushablesInRect(m,m.x,ny,getTile,setTile,m.facing||1);
      if(canFitAt(m,m.x,ny,getTile)){
        m.y=ny;
      }else{
        const snap=verticalCollisionSnapY(m,ny,sign,getTile);
        if(snap!=null && canFitAt(m,m.x,snap,getTile)) m.y=snap;
        if(sign>0) m.onGround=true;
        m.vy=0;
        break;
      }
      rem-=step;
    }
  }
  function updatePhysics(m,dt,getTile,setTile,desiredDir,jump){
    desiredDir = desiredDir<0 ? -1 : (desiredDir>0 ? 1 : 0);
    snapToGround(m,getTile);
    if(desiredDir) m.facing=desiredDir;
    const springDrive=hasSpringDrive(m);
    const trackDrive=hasTrackDrive(m);
    const maxSpeed=trackDrive
      ? (m.rider ? CFG.TRACK_SPEED_RIDER : CFG.TRACK_SPEED_AI)
      : (m.rider ? CFG.WALK_SPEED_RIDER : CFG.WALK_SPEED_AI);
    m.hopCd=Math.max(0,(m.hopCd||0)-dt);
    if(m.springT>0) m.springT=Math.max(0,m.springT-dt*2.4);
    if(m.trackT>0) m.trackT=Math.max(0,m.trackT-dt*2.8);
    if(desiredDir){
      if(springDrive){
        m.vx += desiredDir*CFG.WALK_ACCEL*CFG.SPRING_CREEP*dt;
        m.vx=clamp(m.vx,-maxSpeed*0.75,maxSpeed*0.75);
        if(m.onGround && m.hopCd<=0){
          const kick=m.rider ? CFG.SPRING_KICK_RIDER : CFG.SPRING_KICK_AI;
          m.vx=clamp((m.vx||0)+desiredDir*kick,-maxSpeed,maxSpeed);
          m.vy=Math.min(m.vy||0,CFG.SPRING_JUMP);
          m.hopCd=m.rider ? CFG.HOP_INTERVAL_RIDER : CFG.HOP_INTERVAL_AI;
          m.springT=1;
        }
      }else if(trackDrive){
        const accel=(m.onGround ? CFG.TRACK_ACCEL : CFG.WALK_ACCEL*0.36);
        m.vx += desiredDir*accel*dt;
        m.vx=clamp(m.vx,-maxSpeed,maxSpeed);
        m.trackT=Math.min(1,(m.trackT||0)+Math.abs(m.vx)*dt*1.3);
      }else{
        m.vx += desiredDir*CFG.WALK_ACCEL*dt;
        m.vx=clamp(m.vx,-maxSpeed,maxSpeed);
      }
    }else{
      const drag=(m.onGround?CFG.GROUND_DRAG:CFG.AIR_DRAG)*dt;
      m.vx*=Math.max(0,1-drag);
      if(Math.abs(m.vx)<0.01) m.vx=0;
    }
    if(jump && m.onGround){
      m.vy=springDrive ? CFG.SPRING_JUMP : CFG.JUMP;
      m.onGround=false;
      if(springDrive){
        m.hopCd=m.rider ? CFG.HOP_INTERVAL_RIDER : CFG.HOP_INTERVAL_AI;
        m.springT=1;
      }
    }
    const rested=m.onGround && (m.vy||0)>=0 && supportAt(m,m.x,m.y,getTile);
    m.vy=rested ? 0 : clamp((m.vy||0)+CFG.GRAV*dt,-24,22);
    horizontalMove(m,dt,getTile,setTile,m.facing||1);
    if((m.vy||0)>=0 && snapToGround(m,getTile)){
      m.vy=0;
    }else{
      if((m.vy||0)===0) m.vy=clamp(CFG.GRAV*dt,-24,22);
      verticalMove(m,dt,getTile,setTile);
      if((m.vy||0)>=0) snapToGround(m,getTile);
    }
  }
  function isMountedTurretTile(t){
    return TURRETS && typeof TURRETS.isTurretTile === 'function'
      ? TURRETS.isTurretTile(t)
      : (t===T.TURRET || t===T.FIRE_TURRET || t===T.WATER_TURRET);
  }
  function mountedTurretCell(m){
    if(!m || !Array.isArray(m.cells)) return null;
    return m.cells.find(c=>c && c.role==='turret' && isMountedTurretTile(c.t)) || m.cells.find(c=>c && isMountedTurretTile(c.t)) || null;
  }
  function mountedTurretCells(m){
    if(!m || !Array.isArray(m.cells)) return [];
    return m.cells.filter(c=>c && isMountedTurretTile(c.t));
  }
  // Every turret block draws from the hull reserve only through the mech's own
  // electric network, each with its own cooldown state (two guns of different
  // kinds must not share a fire clock). `target` of null lets the shared turret
  // engine pick the nearest hostile, exactly like a turret placed on the ground.
  function fireMountedTurret(m,dt,getTile,target,source){
    if(!m || !TURRETS || typeof TURRETS.fireMountedAt !== 'function') return false;
    const cells=mountedTurretCells(m);
    if(!cells.length) return false;
    const energised=energisedCells(m);
    let firedAny=false;
    for(const cell of cells){
      if(!cellPowered(cell,energised)) continue;
      const state=turretStateFor(m,cell);
      const beforeEnergy=Math.max(0,Number(m.energy)||0);
      const res=TURRETS.fireMountedAt(
        cell.t,
        state,
        dt,
        {x:m.x+cell.dx,y:m.y+cell.dy,energy:beforeEnergy},
        target,
        getTile
      );
      // Subtract only what the shot consumed: the engine's working copy is
      // clamped to placed-turret capacity, while a mech battery bank can hold
      // far more — adopting the clamped total would wipe the excess reserve.
      const spent=(res && Number.isFinite(Number(res.spent))) ? Math.max(0,Number(res.spent)) : 0;
      if(spent>0) m.energy=Math.max(0,beforeEnergy-spent);
      if(res && res.fired){
        firedAny=true;
        m.recoilT=0.18;
        m.powerPulse=Math.min(1,(m.powerPulse||0)+0.2);
        const fire=cell.t===T.FIRE_TURRET;
        emit('mm-combat-event',{kind:fire?'fire':'laser',target:target?'hero':'mob',source:source||'mech_turret',x:m.x+cell.dx+0.5,y:m.y+cell.dy+0.5,element:fire?'fire':'electric',amount:fire?3.2:5.5,power:0.75});
      }
    }
    return firedAny;
  }
  function fireMountedTurretAtHero(m,player,dt,getTile){
    if(!m || !m.pilotAlive || m.rider || !player) return false;
    const hp=Number.isFinite(Number(player.hp)) ? Number(player.hp) : 1;
    return fireMountedTurret(m,dt,getTile,
      {kind:'hero',hero:player,x:player.x,y:(Number(player.y)||0)-0.25,hp,source:'alien_mech'},
      'alien_mech_turret');
  }
  // No alien pilot left: the block is just a turret, and it defends whoever
  // powers it — the same auto-targeting a placed turret uses.
  function fireMountedTurretDefensive(m,dt,getTile){
    if(!m || m.pilotAlive) return false;
    return fireMountedTurret(m,dt,getTile,null,'mech_turret');
  }
  function turretStateFor(m,cell){
    m.turretStates=m.turretStates || {};
    const key=cell.dx+','+cell.dy;
    return m.turretStates[key]=m.turretStates[key] || {};
  }
  function turretWaterCapacity(){
    const info=INFO[T.WATER_TURRET] || {};
    return Math.max(1,Number(info.waterCapacity)||24);
  }
  function turretStartWater(){
    const dbg=TURRETS && TURRETS._debug;
    const start=dbg && Number(dbg.WATER_TURRET_START_WATER);
    return Math.min(turretWaterCapacity(),Number.isFinite(start)?start:18);
  }
  function turretWaterLevel(state){
    return Number.isFinite(Number(state && state.water)) ? Math.max(0,Number(state.water)) : turretStartWater();
  }
  function addTurretWater(m,cell,amount){
    const add=Math.max(0,Number(amount)||0);
    if(!m || !cell || add<=0) return 0;
    const state=turretStateFor(m,cell);
    const cur=turretWaterLevel(state);
    const next=Math.min(turretWaterCapacity(),cur+add);
    state.water=next;
    return next-cur;
  }
  // The water hose (and anything else that sprays water) can top up a
  // mech-mounted water turret exactly like the placed machine's tank.
  function refillMountedWaterAt(tx,ty,amount){
    tx=Math.floor(tx); ty=Math.floor(ty);
    if(tileOverlayAt(tx,ty)!==T.WATER_TURRET) return 0;
    const hit=cellAt(tx,ty);
    if(!hit || hit.cell.t!==T.WATER_TURRET) return 0;
    return addTurretWater(hit.mech,hit.cell,amount);
  }
  // Mech plumbing mirrors the powered world pump feeding a placed water
  // turret (engine/pumps.js pumpTransfer): a live water source touching the
  // intake pipes lets the tank refill at PUMP_RATE, paying the pump's
  // ENERGY_PER_WATER from the machine's own energy — here the hull reserve.
  const WATER_INTAKE_RATE=8;       // pumps.js PUMP_RATE
  const WATER_INTAKE_ENERGY=0.7;   // pumps.js ENERGY_PER_WATER
  function pipeIntakeWet(m,c,getTile){
    const p=cellWorld(m,c);
    if(getSafe(getTile,p.x,p.y,T.AIR)===T.WATER) return true;
    for(const d of CIRCUIT_DIRS){
      if(getSafe(getTile,p.x+d[0],p.y+d[1],T.AIR)===T.WATER) return true;
    }
    return false;
  }
  // Flood the pipe run out from every submerged intake; a water turret on or
  // beside the wet run can drink, same adjacency rule as the electric circuit.
  function wettedPipeCells(m,getTile){
    const seen=new Set();
    const pipes=(m && m.cells || []).filter(c=>c && c.t===T.WATER_PIPE);
    if(!pipes.length) return seen;
    const byPos=new Map(pipes.map(c=>[c.dx+','+c.dy,c]));
    const queue=[];
    for(const c of pipes){
      if(!pipeIntakeWet(m,c,getTile)) continue;
      const key=c.dx+','+c.dy;
      if(seen.has(key)) continue;
      seen.add(key);
      queue.push(c);
    }
    for(let i=0;i<queue.length;i++){
      const c=queue[i];
      for(const d of CIRCUIT_DIRS){
        const key=(c.dx+d[0])+','+(c.dy+d[1]);
        if(seen.has(key) || !byPos.has(key)) continue;
        seen.add(key);
        queue.push(byPos.get(key));
      }
    }
    return seen;
  }
  function updateWaterIntake(m,dt,getTile){
    const tanks=(m.cells||[]).filter(c=>c && c.t===T.WATER_TURRET);
    if(!tanks.length) return 0;
    const wet=wettedPipeCells(m,getTile);
    if(!wet.size) return 0;
    let moved=0;
    for(const cell of tanks){
      if(!cellPowered(cell,wet)) continue;
      const state=turretStateFor(m,cell);
      const cur=turretWaterLevel(state);
      const need=turretWaterCapacity()-cur;
      if(need<=0.001) continue;
      const energy=Math.max(0,Number(m.energy)||0);
      const want=Math.min(need,WATER_INTAKE_RATE*dt,energy/WATER_INTAKE_ENERGY);
      if(want<=0.0001) continue;
      state.water=cur+want;
      m.energy=Math.max(0,energy-want*WATER_INTAKE_ENERGY);
      moved+=want;
    }
    if(moved>0) m.powerPulse=Math.min(1,(m.powerPulse||0)+0.1);
    return moved;
  }
  function decideAiJump(m,dir,getTile,dt){
    if(!dir || !m.onGround) return false;
    m.jumpCd=Math.max(0,(m.jumpCd||0)-dt);
    if(m.jumpCd>0) return false;
    if(pitAhead(m,dir,getTile)){
      m.jumpCd=0.9;
      const bucket=Math.floor(simT*2)+(m._pitJumpSalt||0);
      m._pitJumpSalt=(m._pitJumpSalt||0)+1;
      return hash01(m.id,bucket)<CFG.PIT_JUMP_CHANCE;
    }
    const blockedRecently=m.blockedDir===dir && simT-(m.blockedT||0)<0.35;
    if(!blockedRecently) return false;
    if(escapeJumpLikely(m,dir,getTile)){
      m.uncertainJumpTries=0;
      m.jumpCd=0.75;
      return true;
    }
    m.uncertainJumpTries=Math.max(0,m.uncertainJumpTries||0);
    if(m.uncertainJumpTries>=CFG.UNCERTAIN_JUMP_LIMIT) return false;
    if(!headClearAt(m,m.x,m.y,getTile,1)) return false;
    m.uncertainJumpTries++;
    m.jumpCd=1.15;
    return true;
  }
  function updateAi(m,dt,player,getTile){
    if(!m.pilotAlive || m.rider) return {dir:0,jump:false};
    if(!player || !finite(player.x) || !finite(player.y)) return {dir:0,jump:false};
    const cx=centerX(m), cy=centerY(m);
    const dx=player.x-cx, dy=player.y-cy;
    const dist=Math.hypot(dx,dy);
    if(dist>CFG.HOSTILE_WAKE) return {dir:0,jump:false};
    const dir=Math.abs(dx)>3.2 ? (dx>0?1:-1) : 0;
    if(dist<CFG.HOSTILE_SIGHT && Math.abs(dy)<12) fireMountedTurretAtHero(m,player,dt,getTile);
    return {dir,jump:decideAiJump(m,dir,getTile,dt)};
  }
  function playerOverlapsMech(m,player,pad){
    if(!player) return false;
    const r=rect(m,m.x,m.y);
    const pr=heroRect(player);
    const p=pad||0;
    return rectOverlap({left:r.left-p,right:r.right+p,top:r.top-p,bottom:r.bottom+p},pr);
  }
  function updateContactDamage(m,player){
    if(!m.pilotAlive || m.rider || !player || typeof root.damageHero !== 'function') return;
    if(!playerOverlapsMech(m,player,0.02)) return;
    const now=(typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
    if(now<(m.contactCd||0)) return;
    m.contactCd=now+900;
    root.damageHero(CFG.CONTACT_DAMAGE,{cause:'alien_mech',srcX:centerX(m),srcY:centerY(m),kb:5.5,kbY:-3});
  }
  function daylight(){
    try{
      const dbg=root.MM.solar && root.MM.solar._debug;
      if(dbg && typeof dbg.daylight==='function') return Math.max(0,Math.min(1,Number(dbg.daylight())||0));
    }catch(e){}
    try{
      const bg=root.MM.background;
      const c=bg && bg.timeInfo && bg.timeInfo();
      if(c && typeof c.isDay==='boolean') return c.isDay ? Math.max(0,Math.min(1,Math.sin(Math.max(0,Math.min(1,Number(c.tDay)||0))*Math.PI))) : 0;
    }catch(e){}
    return 0.65;
  }
  function skyExposed(x,y,getTile){
    x=Math.floor(x); y=Math.floor(y);
    for(let yy=y-1; yy>=WORLD_TOP; yy--){
      const t=getSafe(getTile,x,yy,T.STONE);
      if(!isSunTransparentTile(t)) return false;
    }
    return true;
  }
  function mechMaxEnergy(kind){ return kind==='solar' ? CFG.ENERGY_SOLAR_CAP : CFG.ENERGY_FORGE_CAP; }
  function countCells(m,pred){
    let n=0;
    for(const c of m.cells||[]) if(pred(c)) n++;
    return n;
  }
  function hasSpringDrive(m){
    return countCells(m,c=>c.t===T.SPRING_PLATFORM || c.role==='spring')>0;
  }
  function hasTrackDrive(m){
    return countCells(m,c=>c.t===T.TRACK || (c.role==='track' && c.t===T.STEEL))>0;
  }
  // A cell conducts when it carries a copper-wire overlay or is made of a
  // conductive/power-source block (tracks, panels, batteries, dynamo casings).
  function isPowerSourceCell(c){
    const info=INFO[c && c.t] || {};
    return !!info.powerSource;
  }
  function isConductorCell(c){
    if(!c) return false;
    if(c.wire===T.COPPER_WIRE) return true;
    if(Array.isArray(c.infra) && c.infra.includes(T.COPPER_WIRE)) return true;
    const info=INFO[c.t] || {};
    return !!(info.conductor || info.powerSource);
  }
  const CIRCUIT_DIRS=[[1,0],[-1,0],[0,1],[0,-1]];
  function isTrackCell(c){ return !!c && (c.t===T.TRACK || c.role==='track'); }
  // Flood the conductor graph out from every power-source cell and return the
  // keys of the cells the current reaches. Same shape as the placed-machine
  // network in engine/teleporters.js networkFor(): copper wire (block or
  // overlay) and conductive machine blocks carry the current, dynamo casings /
  // slots / panels / batteries feed it.
  function energisedCells(m){
    const seen=new Set();
    const nodes=(m && m.cells || []).filter(isConductorCell);
    if(!nodes.length) return seen;
    const byPos=new Map(nodes.map(c=>[c.dx+','+c.dy,c]));
    const queue=[];
    for(const c of nodes){
      if(!isPowerSourceCell(c)) continue;
      const key=c.dx+','+c.dy;
      if(seen.has(key)) continue;
      seen.add(key);
      queue.push(c);
    }
    for(let i=0;i<queue.length;i++){
      const c=queue[i];
      for(const d of CIRCUIT_DIRS){
        const key=(c.dx+d[0])+','+(c.dy+d[1]);
        if(seen.has(key) || !byPos.has(key)) continue;
        seen.add(key);
        queue.push(byPos.get(key));
      }
    }
    return seen;
  }
  // A non-conductive consumer (a turret housing) is powered when it sits on the
  // live network or a live node touches it — the neighbour scan networkFor()
  // runs for a placed turret. So a turret bolted straight onto a dynamo casing
  // needs no extra wire, and a stranded one stays dead until copper wire
  // reaches it. Conductive consumers (tracks) simply have to be on the network.
  function cellPowered(cell,energised){
    if(!cell || !energised || !energised.size) return false;
    if(energised.has(cell.dx+','+cell.dy)) return true;
    for(const d of CIRCUIT_DIRS){
      if(energised.has((cell.dx+d[0])+','+(cell.dy+d[1]))) return true;
    }
    return false;
  }
  function mechTrackCircuitConnected(m){
    if(!hasTrackDrive(m)) return false;
    const energised=energisedCells(m);
    if(!energised.size) return false;
    return (m.cells||[]).some(c=>isTrackCell(c) && energised.has(c.dx+','+c.dy));
  }
  // The mounted guns are real turret blocks: one only shoots while the same
  // dynamo/solar network that drives the tracks actually reaches it. True when
  // ANY turret cell is powered — each cell is still gated individually when
  // firing, so a stranded first turret cannot silence a wired second one.
  function mechTurretCircuitConnected(m){
    const cells=mountedTurretCells(m);
    if(!cells.length) return false;
    const energised=energisedCells(m);
    return cells.some(c=>cellPowered(c,energised));
  }
  function trackDriveReady(m){
    return !hasTrackDrive(m) || mechTrackCircuitConnected(m);
  }
  function solarCharge(m,dt,getTile){
    const sun=daylight();
    if(sun<=0.01) return 0;
    let exposed=0;
    for(const c of m.cells||[]){
      if(c.t!==T.SOLAR_PANEL && c.t!==T.SOLAR_BATTERY) continue;
      const p=cellWorld(m,c);
      if(skyExposed(p.x,p.y,getTile)) exposed += c.t===T.SOLAR_BATTERY ? 1.45 : 1;
    }
    return exposed>0 ? exposed*CFG.SOLAR_PANEL_CHARGE*sun*dt : 0;
  }
  // Mech-mounted dynamos ARE the placed machine: engine/dynamo.js reads mech
  // cells through tileOverlayAt, so slot validation, wind response and
  // water/steam/hot-air recordFlow all follow the one world implementation.
  // Flow energy arrives via absorbDynamoFlow (pushed by water.js/gases.js
  // through DYNAMO.recordFlow); only the per-tick wind sample is pulled here.
  function dynamoWindCharge(m,dt,getTile){
    const dyn=root.MM && root.MM.dynamo;
    if(!dyn || typeof dyn.windEnergyPerSecAt!=='function') return 0;
    let gain=0;
    for(const c of m.cells||[]){
      if(c.t!==T.DYNAMO_SLOT) continue;
      try{ gain+=dyn.windEnergyPerSecAt(Math.floor(m.x+c.dx),Math.floor(m.y+c.dy),getTile)*dt; }catch(e){}
    }
    return gain;
  }
  function externalSolarDrainNear(m,amount,getTile){
    const api=root.MM.solar;
    if(!api || typeof api.drainAt!=='function') return 0;
    const need=Math.max(0,Number(amount)||0);
    if(need<=0) return 0;
    const cx=centerX(m), cy=centerY(m);
    const r=Math.ceil(CFG.EXTERNAL_DRAIN_RADIUS);
    for(let yy=Math.floor(cy)-r; yy<=Math.floor(cy)+r; yy++){
      for(let xx=Math.floor(cx)-r; xx<=Math.floor(cx)+r; xx++){
        const t=getSafe(getTile,xx,yy,T.AIR);
        if(t!==T.SOLAR_PANEL && t!==T.SOLAR_BATTERY) continue;
        const d=Math.hypot((xx+0.5)-cx,(yy+0.5)-cy);
        if(d>CFG.EXTERNAL_DRAIN_RADIUS) continue;
        try{
          const got=api.drainAt(xx,yy,need,getTile);
          if(got && got.amount>0) return got.amount;
        }catch(e){}
      }
    }
    return 0;
  }
  function externalPowerDrainNear(m,amount,getTile){
    const need=Math.max(0,Number(amount)||0);
    if(need<=0 || typeof getTile !== 'function') return 0;
    let gained=0;
    try{
      const dyn=root.MM.dynamo;
      if(dyn && typeof dyn.absorbNear==='function'){
        const got=dyn.absorbNear(centerX(m),centerY(m),need,getTile,CFG.EXTERNAL_DRAIN_RADIUS);
        if(got && got.amount>0) gained+=Math.min(need,Number(got.amount)||0);
      }
    }catch(e){}
    if(gained<need) gained+=externalSolarDrainNear(m,need-gained,getTile);
    return Math.max(0,Math.min(need,gained));
  }
  function externalCharge(m,dt,getTile){
    if(!m.rider) return 0;
    const need=Math.max(0,(m.maxEnergy||mechMaxEnergy(m.kind))-(m.energy||0));
    if(need<=0.05) return 0;
    let gained=0;
    try{
      const dyn=root.MM.dynamo;
      if(dyn && typeof dyn.absorbNear==='function'){
        const got=dyn.absorbNear(centerX(m),centerY(m),Math.min(need,14*dt),getTile,CFG.EXTERNAL_DRAIN_RADIUS);
        if(got && got.amount>0) gained+=got.amount;
      }
    }catch(e){}
    if(gained<need) gained+=externalSolarDrainNear(m,Math.min(need-gained,12*dt),getTile);
    return gained;
  }
  function updateEnergy(m,dt,getTile){
    if(!Number.isFinite(m.maxEnergy)) m.maxEnergy=mechMaxEnergy(m.kind);
    if(!Number.isFinite(m.energy)) m.energy=m.pilotAlive ? m.maxEnergy*0.65 : m.maxEnergy*0.28;
    const solarGain=(m.kind==='solar' || m.kind==='built') ? solarCharge(m,dt,getTile) : 0;
    const gain=solarGain+dynamoWindCharge(m,dt,getTile)+externalCharge(m,dt,getTile);
    if(gain>0){
      m.energy=Math.min(m.maxEnergy,(m.energy||0)+gain);
      m.powerPulse=Math.min(1,(m.powerPulse||0)+gain*0.08);
    }
    m.powerPulse=Math.max(0,(m.powerPulse||0)-dt*1.9);
    m.heatPulse=Math.max(0,(m.heatPulse||0)-dt*2.2);
    return gain;
  }
  function heroEnergyFor(ctx){
    return (ctx && ctx.heroEnergy) || (root.MM && root.MM.heroEnergy) || null;
  }
  function spendHeroEnergyForTrack(amount,ctx){
    const n=Math.max(0,Number(amount)||0);
    if(n<=0) return true;
    if(ctx && ctx.godMode) return true;
    const api=heroEnergyFor(ctx);
    if(!api || typeof api.spend!=='function') return false;
    try{ return api.spend(n)!==false; }catch(e){ return false; }
  }
  function spendMechOrHeroTrackEnergy(m,amount,ctx,getTile){
    const want=Math.max(0,Number(amount)||0);
    if(want<=0) return true;
    const have=Math.max(0,Number(m.energy)||0);
    if(have+0.00001>=want){
      m.energy=Math.max(0,have-want);
      return true;
    }
    let remaining=Math.max(0,want-have);
    if(remaining<=0.00001) return true;
    if(hasTrackDrive(m) && mechTrackCircuitConnected(m)){
      const external=externalPowerDrainNear(m,remaining,getTile);
      if(external>0){
        m.energy=0;
        m.powerPulse=Math.min(1,(m.powerPulse||0)+0.24+external*0.04);
        remaining=Math.max(0,remaining-external);
        if(remaining<=0.00001) return true;
      }
      const heroCost=remaining*CFG.HERO_TRACK_ENERGY_MULT;
      if(spendHeroEnergyForTrack(heroCost,ctx)){
        m.energy=0;
        m.heroPowerPulse=Math.min(1,(m.heroPowerPulse||0)+0.35+heroCost*0.025);
        m.powerPulse=Math.min(1,(m.powerPulse||0)+0.18);
        return true;
      }
    }
    return false;
  }
  function consumeRiderEnergy(m,dt,dir,jump,ctx,getTile){
    if(!m.rider) return {dir,jump};
    if(hasTrackDrive(m) && !mechTrackCircuitConnected(m)){
      m.vx=0;
      m.noPowerT=0.8;
      return {dir:0,jump:false};
    }
    const moving=dir!==0;
    const walkCost=Math.max(0,moving ? CFG.RIDER_WALK_ENERGY*dt : 0);
    let want=walkCost;
    let allowJump=!!jump;
    if(allowJump && m.onGround) want+=CFG.RIDER_JUMP_ENERGY;
    if(want<=0) return {dir,jump:false};
    const have=Math.max(0,Number(m.energy)||0);
    const canPayWalk=!moving || have>=walkCost || (hasTrackDrive(m) && mechTrackCircuitConnected(m));
    if(!canPayWalk || (have<=0.02 && !hasTrackDrive(m))){
      m.energy=0;
      m.vx=0;
      m.noPowerT=0.8;
      return {dir:0,jump:false};
    }
    const canJump=!allowJump || !m.onGround || have>=want || (hasTrackDrive(m) && mechTrackCircuitConnected(m));
    if(moving){
      if(!spendMechOrHeroTrackEnergy(m,walkCost,ctx,getTile)){
        m.vx=0;
        m.noPowerT=0.8;
        return {dir:0,jump:false};
      }
    }
    if(allowJump && m.onGround && canJump){
      if(!spendMechOrHeroTrackEnergy(m,CFG.RIDER_JUMP_ENERGY,ctx,getTile)){
        allowJump=false;
      }
    } else {
      allowJump=false;
    }
    return {dir:moving?dir:0,jump:allowJump};
  }
  function consumeTrackStandEnergy(m,dt,dir,ctx,getTile){
    dir=dir<0?-1:(dir>0?1:0);
    if(!dir || !hasTrackDrive(m)) return 0;
    if(!mechTrackCircuitConnected(m)){
      m.vx=0;
      m.noPowerT=0.8;
      return 0;
    }
    const want=Math.max(0.02,CFG.RIDER_WALK_ENERGY*dt*0.9);
    if(!spendMechOrHeroTrackEnergy(m,want,ctx,getTile)){
      m.vx=0;
      m.noPowerT=0.8;
      return 0;
    }
    return dir;
  }
  function standingTrackTop(m,player,tolerance){
    if(!player || !m || !hasTrackDrive(m)) return false;
    const pr=heroRect(player);
    if((player.vy||0)<-0.05) return false;
    const tol=Math.max(0.02,Number(tolerance)||0.22);
    let top=null;
    for(const c of m.cells||[]){
      const left=m.x+c.dx, right=left+1;
      const cy=m.y+c.dy;
      if(pr.right<=left+0.06 || pr.left>=right-0.06) continue;
      if(Math.abs(pr.bottom-cy)<=tol) top = top==null ? cy : Math.min(top,cy);
    }
    return top;
  }
  function playerStandingOnMech(m,player){
    return standingTrackTop(m,player,0.22)!==false;
  }
  function snapStandingTrackHero(m,player,dx){
    if(!player || !m) return false;
    if(Math.abs(Number(dx)||0)>0) player.x+=(Number(dx)||0);
    const top=standingTrackTop(m,player,0.42);
    if(top===false) return false;
    player.y=top-((player.h||0.95)/2)-0.012;
    player.vx=0;
    if((player.vy||0)>0) player.vy=0;
    player.onGround=true;
    if(typeof player.jumpCount === 'number') player.jumpCount=0;
    return true;
  }
  function heroOnTracks(player){
    for(const m of mechs){
      if(!m || m.rider || m.pilotAlive || !hasTrackDrive(m) || m.hp<=0) continue;
      if(playerStandingOnMech(m,player)) return m;
    }
    return null;
  }
  function releaseStandingTrackHero(m,player){
    if(!player || !m) return false;
    const top=standingTrackTop(m,player,0.28);
    if(top!==false) player.y=top-((player.h||0.95)/2)-0.012;
    player.vy=Math.min(Number(player.vy)||0,CFG.JUMP*0.82);
    player.vx=(Number(player.vx)||0)+(Number(m.vx)||0)*0.22;
    player.onGround=false;
    if(typeof player.jumpCount === 'number') player.jumpCount=Math.max(1,player.jumpCount||0);
    m.standingReleaseT=0.2;
    return true;
  }

  // ===== Player-built mechs ==================================================
  // The world grid stays the editor: build any machine from manufactured blocks,
  // crown it with a pilot chair and give it a full bottom row of tracks (or
  // spring platforms). Standing in the chair lifts the connected structure out
  // of the grid into a drivable mech; jumping out of the chair parks it back
  // into the exact same blocks, ready for mining and rebuilding.
  let seatBlock=null;        // chair pos the hero must step off before auto-reseating
  let lastSeatTry=null;      // failed-scan throttle {x,y,t}
  let seatHintAt=-99;
  function seatHint(text){
    if(simT-seatHintAt<2.2) return;
    seatHintAt=simT;
    say(text);
  }
  function builtRoleFor(t){
    if(isChairTile(t)) return 'chair';
    if(t===T.TRACK) return 'track';
    if(t===T.SPRING_PLATFORM) return 'spring';
    if(isMountedTurretTile(t)) return 'turret';
    if(t===T.SOLAR_PANEL) return 'solar';
    if(t===T.SOLAR_BATTERY) return 'power';
    if(t===T.DYNAMO) return 'dynamo';
    if(t===T.DYNAMO_SLOT) return 'dynamoSlot';
    if(t===T.COAL) return 'coal';
    if(t===T.COPPER_WIRE) return 'wire';
    return '';
  }
  function builtMemberAt(x,y,getTile){
    if(!inWorldY(y)) return null;
    const t=getSafe(getTile,x,y,T.AIR);
    const infra=infraStackAt(x,y);
    if(isMechComponentTile(t)) return {t,infra};
    // bare overlays (a wire run through air) still join the machine, but the
    // base tile itself (air/water) is never carved into the mech
    if(infra.length && isPlayerPassableTile(t)) return {t:T.AIR,infra};
    return null;
  }
  function isDriveTile(t){ return t===T.TRACK || t===T.SPRING_PLATFORM; }
  function scanBuiltStructure(sx,sy,getTile){
    sx=Math.floor(sx); sy=Math.floor(sy);
    if(!isChairTile(getSafe(getTile,sx,sy,T.AIR))) return {ok:false,reason:'chair'};
    const seen=new Set([sx+','+sy]);
    const stack=[[sx,sy]];
    const cells=[];
    // sawDrive marks "this construction was meant to be a mech" — hints stay
    // silent for plain furniture chairs in houses (no tracks anywhere)
    let sawDrive=false;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    while(stack.length){
      const [x,y]=stack.pop();
      const member=builtMemberAt(x,y,getTile);
      if(!member) continue;
      cells.push({x,y,t:member.t,infra:member.infra});
      if(isDriveTile(member.t)) sawDrive=true;
      if(cells.length>CFG.BUILT_MAX_CELLS) return {ok:false,reason:'too_big',sawDrive};
      minX=Math.min(minX,x); maxX=Math.max(maxX,x);
      minY=Math.min(minY,y); maxY=Math.max(maxY,y);
      if(maxX-minX+1>CFG.BUILT_MAX_W || maxY-minY+1>CFG.BUILT_MAX_H) return {ok:false,reason:'too_big',sawDrive};
      for(const d of [[1,0],[-1,0],[0,1],[0,-1]]){
        const nx=x+d[0], ny=y+d[1], key=nx+','+ny;
        if(seen.has(key)) continue;
        if(!builtMemberAt(nx,ny,getTile)) continue;
        seen.add(key);
        stack.push([nx,ny]);
      }
    }
    return {ok:true,cells,sawDrive,minX,minY,maxX,maxY};
  }
  function analyzeBuiltCells(cells){
    let chairs=0, maxY=-Infinity;
    for(const c of cells){
      if(isChairTile(c.t)) chairs++;
      if(c.t!==T.AIR) maxY=Math.max(maxY,c.y);
    }
    if(!chairs) return {ok:false,reason:'chair'};
    const bottom=cells.filter(c=>c.t!==T.AIR && c.y===maxY);
    const tracks=bottom.filter(c=>c.t===T.TRACK).length;
    const springs=bottom.filter(c=>c.t===T.SPRING_PLATFORM).length;
    let drive=null;
    if(tracks===bottom.length && tracks>=CFG.BUILT_MIN_TRACKS) drive='tracks';
    else if(springs===bottom.length && springs>=1) drive='springs';
    if(!drive) return {ok:false,reason:'platform'};
    return {ok:true,drive};
  }
  function computeBuiltWireConn(cells){
    const byPos=new Map(cells.map(c=>[c.dx+','+c.dy,c]));
    const links=(a,b)=>{
      if(!b) return false;
      const aw=a.wire===T.COPPER_WIRE, bw=b.wire===T.COPPER_WIRE;
      if(aw && bw) return true;
      return (aw && isConductorCell(b)) || (bw && isConductorCell(a));
    };
    for(const c of cells){
      if(c.wire!==T.COPPER_WIRE) continue;
      c.wireConn={
        left:links(c,byPos.get((c.dx-1)+','+c.dy)),
        right:links(c,byPos.get((c.dx+1)+','+c.dy)),
        up:links(c,byPos.get(c.dx+','+(c.dy-1))),
        down:links(c,byPos.get(c.dx+','+(c.dy+1)))
      };
    }
  }
  function makeBuiltMechFromCells(cells,x,y,drive){
    if(!Array.isArray(cells) || !cells.length) return null;
    computeBuiltWireConn(cells);
    const bounds=normalizeCells(cells);
    const hp=Math.round(cells.reduce((n,c)=>n+(c.hp||2),0)*2.4);
    const batteries=cells.filter(c=>c.t===T.SOLAR_BATTERY).length;
    const dynamos=cells.filter(c=>c.t===T.DYNAMO).length;
    const panels=cells.filter(c=>c.t===T.SOLAR_PANEL).length;
    const maxEnergy=clamp(
      CFG.BUILT_BASE_ENERGY+batteries*CFG.BUILT_BATTERY_ENERGY+dynamos*CFG.BUILT_DYNAMO_ENERGY+panels*CFG.BUILT_PANEL_ENERGY,
      20,CFG.BUILT_MAX_ENERGY_CAP);
    return {
      id:nextId++,
      kind:'built',
      variant:drive||'tracks',
      name:'Wlasny mech',
      x:+x, y:+y, vx:0, vy:0, facing:1,
      cells,
      _bounds:bounds,
      hp, maxHp:hp,
      pilotHp:0, pilotMaxHp:1, pilotAlive:false,
      rider:false,
      energy:0, maxEnergy,
      zone:null, aimT:999, onGround:false, spawnT:simT, salvageSeed:0
    };
  }
  function builtCellFromScan(sc,minX,minY){
    const role=builtRoleFor(sc.t);
    const cell={dx:sc.x-minX,dy:sc.y-minY,t:sc.t,role,hp:durabilityForCell(sc.t,role)};
    if(Array.isArray(sc.infra) && sc.infra.length){
      cell.infra=sc.infra.slice(0,3);
      if(cell.infra.includes(T.COPPER_WIRE)) cell.wire=T.COPPER_WIRE;
    }
    return cell;
  }
  function afterWorldTileRemoved(x,y,getTile){
    try{ if(root.MM.water && root.MM.water.onTileChanged) root.MM.water.onTileChanged(x,y,getTile); }catch(e){}
    try{ if(root.MM.fallingSolids && root.MM.fallingSolids.onTileRemoved) root.MM.fallingSolids.onTileRemoved(x,y); }catch(e){}
    try{ if(root.__mmMarkWorldChanged) root.__mmMarkWorldChanged(x,y); }catch(e){}
  }
  function carveBuiltCells(scanCells,getTile,setTile){
    // top-down so any falling recheck sees the upper blocks already gone
    const ordered=scanCells.slice().sort((a,b)=>(a.y-b.y)||(a.x-b.x));
    for(const c of ordered){
      for(const it of c.infra||[]) clearInfraAt(c.x,c.y,it);
      if(c.t!==T.AIR && getSafe(getTile,c.x,c.y,T.AIR)===c.t){
        setSafe(setTile,c.x,c.y,T.AIR);
        afterWorldTileRemoved(c.x,c.y,getTile);
      }
    }
  }
  function chairEnergyMult(m){
    const c=chairCell(m);
    const mat=c && INFO[c.t] && INFO[c.t].chairMaterial;
    return CHAIR_ENERGY_MULT[mat] || CHAIR_ENERGY_MULT.wood;
  }
  // Drive power order: onboard reserve through the wire circuit, then nearby
  // external sources, then the seated hero's own energy through the chair (the
  // chair itself is the hero-energy link, so an unwired machine still drives).
  function spendBuiltDriveEnergy(m,amount,ctx,getTile){
    const want=Math.max(0,Number(amount)||0);
    if(want<=0) return true;
    let remaining=want;
    if(mechTrackCircuitConnected(m)){
      const have=Math.max(0,Number(m.energy)||0);
      const used=Math.min(have,remaining);
      if(used>0){
        m.energy=have-used;
        remaining-=used;
        m.powerPulse=Math.min(1,(m.powerPulse||0)+0.10);
      }
      if(remaining>0.00001){
        const external=externalPowerDrainNear(m,remaining,getTile);
        if(external>0){
          remaining=Math.max(0,remaining-external);
          m.powerPulse=Math.min(1,(m.powerPulse||0)+0.18+external*0.04);
        }
      }
      if(remaining<=0.00001) return true;
    }
    if(spendHeroEnergyForTrack(remaining*chairEnergyMult(m),ctx)){
      m.heroPowerPulse=Math.min(1,(m.heroPowerPulse||0)+0.3);
      return true;
    }
    // partial reserves stay spent: the machine sputters instead of refunding
    return false;
  }
  function boardBuiltMech(m,player){
    m.rider=true;
    m._seatT=simT;
    riderMechId=m.id;
    syncRider(player);
  }
  function assembleBuiltMechAt(cx,cy,player,getTile,setTile){
    if(typeof getTile!=='function' || typeof setTile!=='function') return null;
    const scan=scanBuiltStructure(cx,cy,getTile);
    if(!scan.ok){
      // chairs are ordinary furniture: only nag when tracks show mech intent
      if(scan.reason==='too_big' && scan.sawDrive) seatHint('Konstrukcja jest za duza na mecha (limit '+CFG.BUILT_MAX_CELLS+' blokow, '+CFG.BUILT_MAX_W+'x'+CFG.BUILT_MAX_H+').');
      return null;
    }
    const analysis=analyzeBuiltCells(scan.cells);
    if(!analysis.ok){
      if(analysis.reason==='platform' && scan.sawDrive) seatHint('Fotel jest, ale brakuje podwozia: caly dolny rzad musza tworzyc gasienice (min. '+CFG.BUILT_MIN_TRACKS+') albo platformy sprezynowe.');
      return null;
    }
    const cells=scan.cells.map(sc=>builtCellFromScan(sc,scan.minX,scan.minY));
    const m=makeBuiltMechFromCells(cells,scan.minX,scan.minY,analysis.drive);
    if(!m) return null;
    carveBuiltCells(scan.cells,getTile,setTile);
    mechs.push(m);
    markCellIndexDirty();
    boardBuiltMech(m,player);
    const hasSource=countCells(m,isPowerSourceCell)>0;
    if(analysis.drive==='tracks' && !hasSource){
      say('Mech zlozony! Ruszy na twojej energii - dynamo, panele lub bateria odciaza bohatera.');
    } else if(analysis.drive==='tracks' && hasSource && !mechTrackCircuitConnected(m)){
      say('Mech zlozony, ale zrodlo energii nie laczy sie przewodem z gasienicami - naped pojdzie z energii bohatera.');
    } else {
      say('Zasiadasz w fotelu pilota. A/D prowadzi mecha, skok wysiada.');
    }
    play('charge');
    emit('mm-mech-built',{id:m.id,cells:m.cells.length,drive:analysis.drive});
    return m;
  }
  function builtParkOrigins(m){
    const bx=Math.round(m.x), by=Math.round(m.y);
    return [[bx,by],[bx,by-1],[bx-1,by],[bx+1,by],[bx,by+1],[bx-1,by-1],[bx+1,by-1]];
  }
  function canParkAt(m,ox,oy,getTile){
    for(const c of m.cells){
      const x=Math.floor(ox+c.dx), y=Math.floor(oy+c.dy);
      if(!inWorldY(y)) return false;
      if(c.t===T.AIR) continue;
      if(!isReplaceableNaturalOpenTile(getSafe(getTile,x,y,T.AIR),false)) return false;
    }
    return true;
  }
  function writeParkedCell(x,y,c,getTile,setTile){
    let ok=true;
    if(c.t!==T.AIR){
      if(getSafe(getTile,x,y,T.AIR)===T.WATER){
        try{ if(root.MM.water && root.MM.water.displaceAt) root.MM.water.displaceAt(x,y,getTile,setTile); }catch(e){}
      }
      ok=setSafe(setTile,x,y,c.t);
      if(ok){
        try{ if(root.MM.water && root.MM.water.onTileChanged) root.MM.water.onTileChanged(x,y,getTile); }catch(e){}
        try{ if(root.MM.fallingSolids && root.MM.fallingSolids.afterPlacement) root.MM.fallingSolids.afterPlacement(x,y); }catch(e){}
        try{ if(root.__mmMarkWorldChanged) root.__mmMarkWorldChanged(x,y); }catch(e){}
      }
    }
    if(ok) for(const it of c.infra||[]) setInfraAt(x,y,it);
    return ok;
  }
  function parkBuiltMech(m,player,getTile,setTile,opts){
    if(!m || m.kind!=='built' || m._parked) return false;
    const fns=worldFns({getTile,setTile});
    if(typeof fns.getTile!=='function' || typeof fns.setTile!=='function') return false;
    let origin=null;
    for(const [ox,oy] of builtParkOrigins(m)){
      if(canParkAt(m,ox,oy,fns.getTile)){ origin=[ox,oy]; break; }
    }
    if(origin){
      // bottom-up so every written block already has its support row below
      const ordered=m.cells.slice().sort((a,b)=>(b.dy-a.dy)||(a.dx-b.dx));
      for(const c of ordered) writeParkedCell(origin[0]+c.dx,origin[1]+c.dy,c,fns.getTile,fns.setTile);
    } else {
      collapseMechBlocks(m,{getTile:fns.getTile,setTile:fns.setTile});
    }
    const chair=chairCell(m);
    m.rider=false;
    if(riderMechId===m.id) riderMechId=null;
    if(player){
      player.x=(origin?origin[0]:Math.round(m.x))+(chair?chair.dx:0)+0.5;
      player.y=(origin?origin[1]:Math.round(m.y))+(chair?chair.dy:0)+0.30;
      player.vx=0;
      player.vy=(opts && opts.hop) ? -6.4 : 0;
      player.onGround=false;
    }
    if(origin && chair) seatBlock={x:origin[0]+chair.dx,y:origin[1]+chair.dy};
    m._parked=true;
    m.destroyed=true; // parked hulls must never ALSO collapse into duplicate blocks
    m.hp=0;
    markCellIndexDirty();
    say(origin ? 'Mech zaparkowany - bloki wrocily do swiata. Stan na fotelu, by znow ruszyc.' : 'Brak miejsca na rowne parkowanie - mech rozsypal sie na bloki obok.');
    play('charge');
    emit('mm-mech-parked',{id:m.id,ok:!!origin});
    return true;
  }
  function updateSeatedBuiltMech(m,dt,player,getTile,setTile,ctx){
    const controls=(ctx && ctx.controls) || {};
    if(controls.jump && simT-(m._seatT||0)>CFG.BUILT_SEAT_JUMP_GRACE){
      parkBuiltMech(m,player,getTile,setTile,{hop:true});
      return;
    }
    let dir=0;
    if(controls.left) dir--;
    if(controls.right) dir++;
    if(dir){
      const cost=Math.max(0.015,CFG.RIDER_WALK_ENERGY*dt);
      if(!spendBuiltDriveEnergy(m,cost,ctx,getTile)){
        dir=0;
        m.vx=0;
        m.noPowerT=0.8;
        if(simT-(m._noPowerMsgT||-9)>2.5){
          m._noPowerMsgT=simT;
          say('Brak energii do napedu: przepusc wode, pare lub wiatr przez dynamo, wystaw panele albo naladuj energie bohatera.');
        }
      }
    }
    updatePhysics(m,dt,getTile,setTile,dir,false);
    if(dir && m.blockedDir===dir) attackObstacles(m,dt,getTile,setTile,dir);
    syncRider(player);
  }
  function findHeroChairTile(player,getTile){
    if(!player || !finite(player.x) || !finite(player.y)) return null;
    const hh=((player.h)||0.95)/2;
    const checks=[[player.x,player.y+hh-0.25],[player.x,player.y],[player.x,player.y-hh+0.25]];
    const seen=new Set();
    for(const [x,y] of checks){
      const tx=Math.floor(x), ty=Math.floor(y);
      const key=tx+','+ty;
      if(seen.has(key)) continue;
      seen.add(key);
      if(isChairTile(getSafe(getTile,tx,ty,T.AIR))) return {x:tx,y:ty};
    }
    return null;
  }
  // True when the interaction key (E) should go to the mech system instead of
  // other E-bound UI: while riding, next to a boardable hull, or standing on a
  // chair that actually crowns a valid machine. A plain furniture chair (in a
  // house, at a campfire) never claims E — the wardrobe keeps working there.
  function wantsInteractKey(player){
    player=player || root.player;
    if(!player) return false;
    if(findRiderMech()) return true;
    if(nearestBoardable(player)) return true;
    const fns=worldFns(null);
    if(typeof fns.getTile!=='function') return false;
    const chair=findHeroChairTile(player,fns.getTile);
    if(!chair) return false;
    const scan=scanBuiltStructure(chair.x,chair.y,fns.getTile);
    return !!(scan.ok && analyzeBuiltCells(scan.cells).ok);
  }
  // Called every frame from the hero physics step: standing in a world chair
  // tries to assemble the machine under it. Failed scans are throttled and a
  // freshly-parked chair stays inert until the hero steps off it once
  // (or forces re-entry with the interaction key).
  function trySeatFromWorld(player,getTile,setTile,opts){
    if(!player || findRiderMech()) return false;
    rememberWorldFns(getTile,setTile);
    const fns=worldFns({getTile,setTile});
    if(typeof fns.getTile!=='function' || typeof fns.setTile!=='function') return false;
    const chair=findHeroChairTile(player,fns.getTile);
    if(!chair){
      // only a grounded step off the chair releases the reseat block — the
      // eject hop itself leaves the tile mid-air and must not re-arm the seat
      if(player.onGround) seatBlock=null;
      return false;
    }
    if(seatBlock && (seatBlock.x!==chair.x || seatBlock.y!==chair.y)) seatBlock=null;
    const force=!!(opts && opts.force);
    if(seatBlock && !force) return false;
    if(!force && lastSeatTry && lastSeatTry.x===chair.x && lastSeatTry.y===chair.y && simT-lastSeatTry.t<CFG.BUILT_SEAT_SCAN_COOLDOWN) return false;
    lastSeatTry={x:chair.x,y:chair.y,t:simT};
    const m=assembleBuiltMechAt(chair.x,chair.y,player,fns.getTile,fns.setTile);
    if(!m) return false;
    seatBlock=null;
    return true;
  }
  // ===== end player-built mechs =============================================

  function collideMobs(m,dt,getTile){
    try{
      const api=root.MM.mobs;
      if(!api || typeof api.collideMech!=='function') return null;
      const res=api.collideMech(m,rect(m,m.x,m.y),dt,{getTile,source:m.rider?'hero_mech':'alien_mech',damage:m.rider?12:16});
      if(res && res.blockers>0 && Math.abs(m.vx)>0.05) m.vx*=Math.max(0.4,1-res.blockers*0.08);
      return res;
    }catch(e){ return null; }
  }
  function syncRider(player){
    const m=findRiderMech();
    if(!m || !player) return false;
    const c=cockpitCell(m);
    player.x=m.x+c.dx+0.5;
    player.y=m.y+c.dy+0.18;
    player.vx=m.vx||0;
    player.vy=m.vy||0;
    player.onGround=false;
    if(typeof player.jumpCount === 'number') player.jumpCount=0;
    return true;
  }
  function updateRiderMech(m,dt,player,getTile,setTile,ctx){
    const controls=(ctx && ctx.controls) || {};
    let dir=0;
    if(controls.left) dir--;
    if(controls.right) dir++;
    const gated=consumeRiderEnergy(m,dt,dir,!!controls.jump,ctx,getTile);
    updatePhysics(m,dt,getTile,setTile,gated.dir,gated.jump);
    if(gated.dir && m.blockedDir===gated.dir) attackObstacles(m,dt,getTile,setTile,gated.dir);
    syncRider(player);
  }
  function updateStandingTrackMech(m,dt,player,getTile,setTile,ctx){
    if(m.rider || m.pilotAlive || !hasTrackDrive(m) || !playerStandingOnMech(m,player)) return false;
    const controls=(ctx && ctx.controls) || {};
    if(controls.jump){
      releaseStandingTrackHero(m,player);
      return true;
    }
    let dir=0;
    if(controls.left) dir--;
    if(controls.right) dir++;
    dir=consumeTrackStandEnergy(m,dt,dir,ctx,getTile);
    const beforeX=m.x;
    updatePhysics(m,dt,getTile,setTile,dir,false);
    if(dir && m.blockedDir===dir) attackObstacles(m,dt,getTile,setTile,dir);
    const dx=m.x-beforeX;
    snapStandingTrackHero(m,player,dx);
    return true;
  }
  function updateMech(m,dt,player,getTile,setTile,ctx){
    if(m.hp<=0) return;
    m.trackCircuitOk=trackDriveReady(m);
    m.turretCircuitOk=mechTurretCircuitConnected(m);
    updateEnergy(m,dt,getTile);
    updateWaterIntake(m,dt,getTile);
    m.heroPowerPulse=Math.max(0,(m.heroPowerPulse||0)-dt*2.6);
    if(m.crushFx>0) m.crushFx=Math.max(0,m.crushFx-dt*1.9);
    if(m.recoilT>0) m.recoilT=Math.max(0,m.recoilT-dt);
    if(m.noPowerT>0) m.noPowerT=Math.max(0,m.noPowerT-dt);
    if(m.rider && m.kind==='built'){
      updateSeatedBuiltMech(m,dt,player,getTile,setTile,ctx);
      if(m._parked) return;
    }
    else if(m.rider) updateRiderMech(m,dt,player,getTile,setTile,ctx);
    else if(updateStandingTrackMech(m,dt,player,getTile,setTile,ctx)){
      updateContactDamage(m,player);
    }
    else {
      const ai=updateAi(m,dt,player,getTile);
      updatePhysics(m,dt,getTile,setTile,ai.dir,ai.jump);
      if(ai.dir && m.blockedDir===ai.dir) attackObstacles(m,dt,getTile,setTile,ai.dir);
      updateContactDamage(m,player);
    }
    // A pilotless hull (captured alien or the player's own build) turns its
    // mounted turret on the nearest hostile once the circuit is live.
    if(!m.pilotAlive) fireMountedTurretDefensive(m,dt,getTile);
    collideMobs(m,dt,getTile);
  }
  function standingSurfaceY(x){
    try{ if(WORLDGEN && WORLDGEN.surfaceHeight) return Math.floor(WORLDGEN.surfaceHeight(Math.floor(x))); }catch(e){}
    return 60;
  }
  function spawnYFor(x,getTile,bp){
    const s=standingSurfaceY(x);
    const h=bp && bp.bounds ? bp.bounds.h : 6;
    const probe={cells:(bp && Array.isArray(bp.cells)) ? bp.cells : [{dx:0,dy:0}],_bounds:bp && bp.bounds};
    const base=s-h;
    const candidates=[];
    for(let off=0; off<=28; off++){
      const y=base-off;
      if(y<WORLD_TOP+1) break;
      candidates.push(y);
    }
    for(let off=1; off<=8; off++){
      const y=base+off;
      if(y>=WORLD_BOTTOM-h-1) break;
      candidates.push(y);
    }
    for(const y of candidates){
      if(canFitAt(probe,x,y,getTile) && supportAt(probe,x,y,getTile)) return y;
    }
    for(const y of candidates){
      if(canFitAt(probe,x,y,getTile)) return y;
    }
    return null;
  }
  function buildMech(kind,x,y,bp,zone,seed){
    const hp=Math.round(bp.maxHp*(0.92+hash01(seed,91)*0.18));
    const maxEnergy=mechMaxEnergy(kind);
    return {
      id:nextId++,
      kind,
      variant:bp.variant || (kind==='forge' ? forgeVariantForSeed(seed) : 'solar'),
      name:bp.name,
      x:+x,
      y:+y,
      vx:0,
      vy:0,
      facing:x<0?1:-1,
      cells:bp.cells.map(c=>Object.assign({},c)),
      _bounds:bp.bounds,
      hp,
      maxHp:hp,
      pilotHp:bp.pilotMaxHp,
      pilotMaxHp:bp.pilotMaxHp,
      pilotAlive:true,
      rider:false,
      energy:maxEnergy*(kind==='solar'?0.38:0.52),
      maxEnergy,
      zone:zone||null,
      aimT:0.8+hash01(seed,17)*0.9,
      onGround:false,
      spawnT:simT,
      salvageSeed:seed
    };
  }
  function makeMech(kind,x,getTile,zone,seedOverride){
    kind=kind==='solar' ? 'solar' : 'forge';
    const seed=Number.isFinite(Number(seedOverride)) ? Number(seedOverride)|0 : Math.floor(x);
    const bp=makeBlueprint(kind,seed);
    const y=spawnYFor(x,getTile,bp);
    if(!Number.isFinite(y)) return null;
    return buildMech(kind,x,y,bp,zone,seed);
  }
  function activeNear(x,dist){
    const d=Math.max(1,dist||CFG.MIN_ACTIVE_GAP);
    return mechs.some(m=>Math.abs(centerX(m)-x)<d);
  }
  function zoneShouldSpawn(zone){
    const center=Math.round((zone+0.5)*CFG.ZONE_W);
    if(Math.abs(center)<CFG.MIN_DISTANCE) return false;
    return hash01(zone,4041)<CFG.SPAWN_CHANCE;
  }
  function zoneSpawnX(zone){
    const base=Math.round((zone+0.5)*CFG.ZONE_W);
    return Math.round(base + randCentered(zone*31,CFG.ZONE_W*0.44));
  }
  function kindForX(x){ return x<0 ? 'solar' : 'forge'; }
  function trySpawnZone(zone,getTile,player){
    const key=zoneKey(zone);
    if(usedZones.has(key) || !zoneShouldSpawn(zone) || mechs.length>=CFG.MAX_ACTIVE) return false;
    const x=zoneSpawnX(zone);
    if(player && finite(player.x) && Math.abs(x-player.x)<CFG.PLAYER_SPAWN_GAP) return false;
    if(Math.abs(x)<CFG.MIN_DISTANCE || activeNear(x,CFG.MIN_ACTIVE_GAP)) return false;
    const m=makeMech(kindForX(x),x,getTile,key);
    if(!m) return false;
    mechs.push(m);
    usedZones.add(key);
    return m;
  }
  function scanSpawns(player,getTile){
    if(!player || !finite(player.x) || Math.abs(player.x)<CFG.MIN_DISTANCE-150) return;
    const px=Math.floor(player.x);
    const z0=Math.floor((px-CFG.SCAN_RADIUS)/CFG.ZONE_W);
    const z1=Math.floor((px+CFG.SCAN_RADIUS)/CFG.ZONE_W);
    for(let z=z0; z<=z1; z++){
      const x=zoneSpawnX(z);
      if(Math.abs(x-px)>CFG.SCAN_RADIUS) continue;
      const m=trySpawnZone(z,getTile,player);
      if(m){
        say(m.kind==='solar' ? 'W snieznym pasie budzi sie solar-mech alienow.' : 'W goracym pasie dudni mech z dynamem i paleniskiem.');
        return true;
      }
    }
    return false;
  }
  function update(dt,player,getTile,setTile,ctx){
    if(!(dt>0) || !isFinite(dt)) return;
    rememberWorldFns(getTile,setTile);
    dt=Math.min(0.1,dt);
    simT+=dt;
    spawnFreezeT=Math.max(0,spawnFreezeT-dt);
    scanT-=dt;
    if(scanT<=0){
      scanT=CFG.SCAN_INTERVAL;
      if(spawnFreezeT<=0) scanSpawns(player,getTile);
    }
    for(const m of mechs) updateMech(m,dt,player,getTile,setTile,ctx||{});
    for(let i=mechs.length-1;i>=0;i--){
      const m=mechs[i];
      if(m.hp<=0 || !finite(m.x) || !finite(m.y) || m.y>WORLD_BOTTOM+30){
        if(m.rider) ejectRider(m,player,getTile);
        mechs.splice(i,1);
      }
    }
    markCellIndexDirty();
  }
  function damageNumbers(m,amount,kind,opts){
    emit('mm-combat-event',{
      kind:kind||'impact',
      target:'alien_mech',
      source:(opts && opts.source) || 'hero',
      x:centerX(m),
      y:m.y+0.8,
      amount,
      element:opts && (opts.element || opts.kind),
      major:amount>=12,
      power:Math.max(0.65,Math.min(1.9,amount/10))
    });
  }
  function awardPilotLoot(m){
    addResource('alienBiomass',1+(hash01(m.id,991)>0.55?1:0));
    addXp(m.kind==='solar'?90:105,centerX(m),m.y,'ALIEN_MECH_PILOT');
  }
  function collapseOffsets(){
    const out=[[0,0]];
    for(let r=1;r<=5;r++){
      for(let dy=-r; dy<=r; dy++){
        for(let dx=-r; dx<=r; dx++){
          if(Math.abs(dx)+Math.abs(dy)!==r) continue;
          out.push([dx,dy]);
        }
      }
    }
    return out;
  }
  const COLLAPSE_OFFSETS = collapseOffsets();
  function collapseCellOpen(x,y,getTile,occupied){
    x=Math.floor(x); y=Math.floor(y);
    if(!inWorldY(y)) return false;
    const k=x+','+y;
    if(occupied && occupied.has(k)) return false;
    const t=getSafe(getTile,x,y,T.AIR);
    return isReplaceableNaturalOpenTile(t,true);
  }
  function findCollapseSpot(x,y,getTile,occupied){
    for(const [dx,dy] of COLLAPSE_OFFSETS){
      const px=Math.floor(x+dx), py=Math.floor(y+dy);
      if(collapseCellOpen(px,py,getTile,occupied)) return {x:px,y:py};
    }
    return null;
  }
  function collapseTileViaPhysics(x,y,t,setTile){
    const falling=root.MM && root.MM.fallingSolids;
    try{
      if(falling && typeof falling.spawnLoose === 'function' && falling.spawnLoose(x,y,t)) return true;
    }catch(e){}
    if(!setSafe(setTile,x,y,t)) return false;
    try{ if(falling && typeof falling.afterPlacement === 'function') falling.afterPlacement(x,y); }catch(e){}
    try{ if(root.MM.water && root.MM.water.onTileChanged) root.MM.water.onTileChanged(x,y,worldFns().getTile); }catch(e){}
    return true;
  }
  function collapseMaterialList(c){
    const out=[];
    if(c && c.t!=null && c.t!==T.AIR) out.push(c.t);
    const infra=(c && Array.isArray(c.infra) && c.infra.length) ? c.infra : null;
    if(infra){ for(const it of infra){ if(it!==T.AIR) out.push(it); } }
    else if(c && c.wire===T.COPPER_WIRE) out.push(T.COPPER_WIRE);
    return out;
  }
  function collapseMechBlocks(m,opts){
    const fns=worldFns(opts);
    const getTile=fns.getTile;
    const setTile=fns.setTile;
    if(typeof getTile !== 'function' || typeof setTile !== 'function') return {placed:0,total:0};
    const occupied=new Set();
    let placed=0,total=0;
    const cells=(m.cells||[]).slice().sort((a,b)=>(b.dy-a.dy)||(a.dx-b.dx));
    for(const c of cells){
      const p=cellWorld(m,c);
      for(const t of collapseMaterialList(c)){
        total++;
        const spot=findCollapseSpot(p.x,p.y,getTile,occupied);
        if(!spot) continue;
        if(collapseTileViaPhysics(spot.x,spot.y,t,setTile)){
          occupied.add(spot.x+','+spot.y);
          placed++;
        }
      }
    }
    try{
      const falling=root.MM && root.MM.fallingSolids;
      if(falling && typeof falling.recheckNeighborhood === 'function'){
        for(const raw of occupied){
          const comma=raw.indexOf(',');
          falling.recheckNeighborhood(+raw.slice(0,comma),+raw.slice(comma+1));
        }
      }
    }catch(e){}
    if(placed>0) say('Wrak mecha rozsypal sie na '+placed+' blokow.');
    else say('Wrak mecha rozpadl sie, ale nie mial wolnego miejsca na bloki.');
    return {placed,total};
  }
  function killPilot(m){
    if(!m.pilotAlive) return false;
    m.pilotAlive=false;
    m.pilotHp=0;
    m.aimT=999;
    awardPilotLoot(m);
    say('Alien-pilot pokonany. Kadlub mecha jest pusty - podejdz i nacisnij E.');
    play('hurt');
    return true;
  }
  function destroyMech(m,opts){
    if(m.destroyed) return false;
    m.destroyed=true;
    m.hp=0;
    markCellIndexDirty();
    collapseMechBlocks(m,opts||{});
    addXp(m.kind==='solar'?130:155,centerX(m),m.y,'ALIEN_MECH');
    damageNumbers(m,22,'blast',Object.assign({source:'hero',element:'blast'},opts||{}));
    play('explosion');
    return true;
  }
  function damageMech(m,cell,dmg,opts){
    if(!m || m.hp<=0) return false;
    const amount=Math.max(0,Number(dmg)||0);
    if(amount<=0) return false;
    const cockpit=cell && (cell.role==='cockpit' || cell.role==='pilot');
    let hullDamage=amount;
    if(cockpit && m.pilotAlive){
      const pilotDamage=amount*0.78;
      m.pilotHp=Math.max(0,(m.pilotHp||0)-pilotDamage);
      hullDamage=amount*0.35;
      if(m.pilotHp<=0) killPilot(m);
    }
    m.hp=Math.max(0,(m.hp||0)-hullDamage);
    m.flashT=0.16;
    damageNumbers(m,amount,opts && opts.kind,opts||{});
    if(m.hp<=0) destroyMech(m,opts);
    return true;
  }
  function attackAt(tx,ty,dmgBonus,opts){
    const hit=cellAt(tx,ty);
    if(!hit) return false;
    const bonus=(typeof dmgBonus==='number' && isFinite(dmgBonus) && dmgBonus>0) ? dmgBonus : 0;
    return damageMech(hit.mech,hit.cell,4+bonus,opts||{source:'hero',kind:'melee'});
  }
  function damageAt(tx,ty,dmg,opts){
    const hit=cellAt(tx,ty);
    if(!hit) return false;
    return damageMech(hit.mech,hit.cell,dmg,opts||{source:'hero'});
  }
  function damageRadius(x,y,r,dmg,opts){
    let hits=0;
    const rr=Math.max(0.5,Number(r)||1);
    for(const m of mechs){
      const d=Math.hypot(centerX(m)-x,centerY(m)-y);
      if(d>rr+3) continue;
      const scaled=(Number(dmg)||1)*clamp(1-d/(rr+3),0.25,1);
      if(damageMech(m,cockpitCell(m),scaled,opts||{source:'hero',kind:'blast'})) hits++;
    }
    return hits;
  }
  function blastRadius(x,y,r,dmg,opts){ return damageRadius(x,y,r,dmg,Object.assign({kind:'blast',element:'blast'},opts||{})); }
  function igniteRadius(x,y,r,opts){ return damageRadius(x,y,r,Math.max(2,(opts&&opts.dps)||5)*0.45,Object.assign({kind:'flame',element:'fire'},opts||{})); }
  function douseRadius(x,y,r,opts){ return damageRadius(x,y,r,Math.max(1,(opts&&opts.dps)||2)*0.25,Object.assign({kind:'hose',element:'water'},opts||{})); }

  function nearestBoardable(player){
    if(!player) return null;
    let best=null, bestD=CFG.BOARD_RADIUS*CFG.BOARD_RADIUS;
    for(const m of mechs){
      if(m.pilotAlive || m.hp<=0 || m.rider) continue;
      const d2=(centerX(m)-player.x)*(centerX(m)-player.x)+(centerY(m)-player.y)*(centerY(m)-player.y);
      if(d2<bestD || playerOverlapsMech(m,player,0.85)){ best=m; bestD=d2; }
    }
    return best;
  }
  function isHeroExitOpen(t){
    return t!==T.LAVA && isOpenTile(t);
  }
  function canPlaceHeroAt(px,py,getTile,player){
    const hw=((player && player.w)||0.7)/2;
    const hh=((player && player.h)||0.95)/2;
    const xs=[px-hw*0.82,px+hw*0.82];
    const ys=[py-hh*0.86,py,py+hh*0.82];
    for(const yy of ys){
      if(!inWorldY(Math.floor(yy))) return false;
      for(const xx of xs){
        if(!isHeroExitOpen(getSafe(getTile,xx,yy,T.AIR))) return false;
      }
    }
    return true;
  }
  function hasFooting(px,py,getTile,player){
    const hw=((player && player.w)||0.7)/2;
    const hh=((player && player.h)||0.95)/2;
    const y=py+hh+0.08;
    for(const ox of [-hw*0.65,hw*0.65]){
      const t=getSafe(getTile,px+ox,y,T.AIR);
      if(t!==T.WATER && t!==T.LAVA && !isOpenTile(t)) return true;
    }
    return false;
  }
  function findExitSpot(m,player,getTile){
    const r=rect(m,m.x,m.y);
    const facing=(m.facing||1)>0 ? 1 : -1;
    const sides=[facing,-facing];
    const baseY=clamp(m.y+2,WORLD_TOP+2,WORLD_BOTTOM-2);
    for(const side of sides){
      for(const dist of [0.55,1.1,1.7,2.4,3.1]){
        const px=side>0 ? r.right+dist : r.left-dist;
        for(const dy of [0,-1,1,-2,2,3,-3,4]){
          const py=clamp(baseY+dy,WORLD_TOP+2,WORLD_BOTTOM-2);
          if(canPlaceHeroAt(px,py,getTile,player) && hasFooting(px,py,getTile,player)) return {x:px,y:py};
        }
      }
    }
    const c=cockpitCell(m);
    const top={x:m.x+c.dx+0.5,y:Math.max(WORLD_TOP+2,m.y-0.65)};
    if(canPlaceHeroAt(top.x,top.y,getTile,player)) return top;
    return {x:facing>0 ? r.right+0.5 : r.left-0.5,y:baseY};
  }
  function ejectRider(m,player,getTile){
    if(!m || !m.rider) return false;
    m.rider=false;
    if(riderMechId===m.id) riderMechId=null;
    if(player){
      const spot=findExitSpot(m,player,getTile);
      player.x=spot.x;
      player.y=spot.y;
      player.vx=(m.vx||0)*0.25;
      player.vy=0;
    }
    say('Wysiadles z mecha.');
    return true;
  }
  function boardMech(m,player){
    if(!m || !player || m.pilotAlive || m.rider || m.hp<=0) return false;
    m.rider=true;
    riderMechId=m.id;
    syncRider(player);
    say(m.kind==='solar' ? 'Wsiadasz do solar-mecha. Panele laduja pancerz w swietle.' : 'Wsiadasz do forge-mecha. Dynamo i palenisko dudnia pod kadlubem.');
    play('charge');
    return true;
  }
  function toggleBoard(player,getTile){
    const current=findRiderMech();
    if(current){
      if(current.kind==='built') return parkBuiltMech(current,player,getTile,null,{});
      return ejectRider(current,player,getTile);
    }
    if(boardMech(nearestBoardable(player),player)) return true;
    // E on a world chair force-assembles even while the auto-reseat block holds
    return trySeatFromWorld(player,getTile,null,{force:true});
  }
  function absorbHeroDamage(amount,opts,player){
    const m=findRiderMech();
    if(!m || !player) return null;
    const n=Math.max(0,Number(amount)||0);
    if(n<=0) return null;
    const absorbed=n*CFG.SHIELD_ABSORB;
    const hullDamage=absorbed*0.72;
    m.hp=Math.max(0,(m.hp||0)-hullDamage);
    m.flashT=0.18;
    emit('mm-combat-event',{kind:'defend',target:'hero',source:'mech_armor',x:player.x,y:player.y-0.25,amount:absorbed,cause:(opts&&opts.cause)||'mech',defendedBlock:true,major:absorbed>=8,power:1.15});
    if(m.hp<=0){
      destroyMech(m,{source:'enemy',kind:'blast'});
      ejectRider(m,player);
      return {amount:Math.max(0,n-absorbed)+Math.max(2,n*0.18),absorbed};
    }
    return {amount:Math.max(0,n-absorbed),absorbed};
  }
  const ALIEN_TEAM_PILOT_SKIN = {
    alive:  {tint:'#9edac1', dark:'#48796a', deep:'#2c4f44', eye:'#c9fff2', accent:'#4fe9b5'},
    empty:  {tint:'#8ea1a8', dark:'#44545b', deep:'#253137', eye:'#d9eef5', accent:'#88a4ad'}
  };
  function drawAlienTeamPilotMini(ctx,TILE,m,px,py,alpha,opts){
    opts = opts || {};
    const alive=!!(m && m.pilotAlive);
    const skin=alive ? ALIEN_TEAM_PILOT_SKIN.alive : ALIEN_TEAM_PILOT_SKIN.empty;
    const face=(m && m.facing)<0 ? -1 : 1;
    const bob=alive ? Math.sin(simT*5+(m && m.id || 0))*TILE*0.018 : TILE*0.025;
    const scale=Number.isFinite(opts.scale) ? opts.scale : 0.82;
    const cx=px+TILE*(Number.isFinite(opts.cx) ? opts.cx : 0.52);
    const foot=py+TILE*(Number.isFinite(opts.foot) ? opts.foot : 0.88)+bob;
    ctx.save();
    ctx.globalAlpha=alpha*(alive ? 0.96 : 0.64);
    ctx.translate(cx,foot);
    ctx.scale(face*scale,scale);
    if(!alive) ctx.rotate(-0.10);
    ctx.lineCap='round';

    ctx.fillStyle='rgba(5,14,18,0.28)';
    ctx.beginPath();
    ctx.ellipse(0,TILE*0.005,TILE*0.18,TILE*0.045,0,0,Math.PI*2);
    ctx.fill();

    ctx.strokeStyle=skin.deep;
    ctx.lineWidth=Math.max(1,TILE*0.055);
    ctx.beginPath();
    ctx.moveTo(-TILE*0.08,-TILE*0.31);
    ctx.quadraticCurveTo(-TILE*0.13,-TILE*0.14,-TILE*0.11,-TILE*0.02);
    ctx.moveTo(TILE*0.08,-TILE*0.31);
    ctx.quadraticCurveTo(TILE*0.14,-TILE*0.14,TILE*0.10,-TILE*0.02);
    ctx.stroke();
    ctx.fillStyle=skin.deep;
    ctx.fillRect(-TILE*0.17,-TILE*0.035,TILE*0.13,TILE*0.045);
    ctx.fillRect(TILE*0.04,-TILE*0.035,TILE*0.13,TILE*0.045);

    ctx.fillStyle=skin.dark;
    ctx.beginPath();
    ctx.ellipse(0,-TILE*0.42,TILE*0.18,TILE*0.23,0,0,Math.PI*2);
    ctx.fill();
    ctx.fillStyle=skin.tint;
    ctx.beginPath();
    ctx.ellipse(TILE*0.035,-TILE*0.44,TILE*0.125,TILE*0.17,0.12,0,Math.PI*2);
    ctx.fill();
    ctx.strokeStyle=skin.deep;
    ctx.lineWidth=Math.max(1,TILE*0.038);
    ctx.beginPath();
    ctx.moveTo(-TILE*0.11,-TILE*0.52);
    ctx.lineTo(TILE*0.12,-TILE*0.38);
    ctx.stroke();
    ctx.fillStyle=skin.accent;
    ctx.fillRect(-TILE*0.02,-TILE*0.48,TILE*0.065,TILE*0.065);

    const headY=-TILE*0.70;
    ctx.fillStyle=skin.tint;
    ctx.beginPath();
    ctx.ellipse(TILE*0.02,headY,TILE*0.20,TILE*0.17,0,0,Math.PI*2);
    ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.30)';
    ctx.beginPath();
    ctx.ellipse(-TILE*0.045,headY-TILE*0.07,TILE*0.10,TILE*0.048,-0.4,0,Math.PI*2);
    ctx.fill();
    ctx.fillStyle='#0a1512';
    ctx.beginPath();
    ctx.ellipse(TILE*0.09,headY+TILE*0.008,TILE*0.10,TILE*0.068,0.22,0,Math.PI*2);
    ctx.fill();
    ctx.fillStyle=skin.eye;
    ctx.beginPath();
    ctx.ellipse(TILE*0.105,headY+TILE*0.004,TILE*0.058,TILE*0.040,0.22,0,Math.PI*2);
    ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.92)';
    ctx.fillRect(TILE*0.125,headY-TILE*0.030,TILE*0.030,TILE*0.024);

    ctx.strokeStyle=skin.dark;
    ctx.lineWidth=Math.max(1,TILE*0.028);
    ctx.beginPath();
    ctx.moveTo(-TILE*0.045,headY-TILE*0.13);
    ctx.quadraticCurveTo(-TILE*0.13,headY-TILE*0.25,-TILE*0.16,headY-TILE*0.21);
    ctx.moveTo(TILE*0.055,headY-TILE*0.135);
    ctx.quadraticCurveTo(TILE*0.10,headY-TILE*0.27,TILE*0.15,headY-TILE*0.25);
    ctx.stroke();
    const pulse=alive ? 0.62+0.38*Math.sin(simT*7+(m && m.id || 0)) : 0.28;
    ctx.fillStyle='rgba(126,255,225,'+clamp(pulse,0.18,0.92).toFixed(3)+')';
    ctx.beginPath();
    ctx.arc(-TILE*0.16,headY-TILE*0.21,TILE*0.032,0,Math.PI*2);
    ctx.arc(TILE*0.15,headY-TILE*0.25,TILE*0.032,0,Math.PI*2);
    ctx.fill();

    ctx.strokeStyle=skin.deep;
    ctx.lineWidth=Math.max(1,TILE*0.05);
    ctx.beginPath();
    ctx.moveTo(TILE*0.06,-TILE*0.49);
    ctx.lineTo(TILE*0.23,-TILE*0.54);
    ctx.stroke();
    ctx.fillStyle=alive ? '#1d2a26' : '#2f3b41';
    ctx.fillRect(TILE*0.20,-TILE*0.59,TILE*0.18,TILE*0.075);
    ctx.fillStyle=skin.accent;
    ctx.fillRect(TILE*0.33,-TILE*0.575,TILE*0.045,TILE*0.048);
    ctx.restore();
  }
  function drawCockpitGlassForeground(ctx,TILE,px,py,alpha){
    ctx.save();
    ctx.globalAlpha=alpha;
    ctx.fillStyle='rgba(145,235,255,0.13)';
    ctx.fillRect(px+TILE*0.08,py+TILE*0.08,TILE*0.84,TILE*0.84);
    ctx.strokeStyle='rgba(230,255,255,0.62)';
    ctx.lineWidth=Math.max(1,TILE*0.026);
    ctx.beginPath();
    ctx.moveTo(px+TILE*0.16,py+TILE*0.78);
    ctx.lineTo(px+TILE*0.68,py+TILE*0.18);
    ctx.moveTo(px+TILE*0.22,py+TILE*0.18);
    ctx.lineTo(px+TILE*0.82,py+TILE*0.18);
    ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,0.22)';
    ctx.fillRect(px+TILE*0.14,py+TILE*0.12,TILE*0.12,TILE*0.60);
    ctx.restore();
  }
  function drawCopperWireOverlay(ctx,TILE,px,py,conn,alpha,powered){
    conn=conn||{};
    ctx.save();
    ctx.globalAlpha=alpha*(powered?0.98:0.84);
    ctx.lineCap='round';
    ctx.lineJoin='round';
    const cx=px+TILE*0.5, cy=py+TILE*0.5;
    const ends=[];
    if(conn.left) ends.push([px+TILE*0.12,cy]);
    if(conn.right) ends.push([px+TILE*0.88,cy]);
    if(conn.up) ends.push([cx,py+TILE*0.12]);
    if(conn.down) ends.push([cx,py+TILE*0.88]);
    if(!ends.length) ends.push([px+TILE*0.16,cy],[px+TILE*0.84,cy]);
    ctx.strokeStyle='rgba(44,24,10,0.72)';
    ctx.lineWidth=Math.max(2,TILE*0.14);
    ctx.beginPath();
    for(const e of ends){ ctx.moveTo(cx,cy); ctx.lineTo(e[0],e[1]); }
    ctx.stroke();
    ctx.strokeStyle=powered?'#ffc35d':'#d68535';
    ctx.lineWidth=Math.max(1,TILE*0.075);
    ctx.beginPath();
    for(const e of ends){ ctx.moveTo(cx,cy); ctx.lineTo(e[0],e[1]); }
    ctx.stroke();
    ctx.fillStyle=powered?'#fff0a8':'#f0a34b';
    ctx.beginPath();
    ctx.arc(cx,cy,TILE*(powered?0.085:0.065),0,Math.PI*2);
    ctx.fill();
    if(powered){
      ctx.globalAlpha=alpha*0.32;
      ctx.strokeStyle='rgba(255,240,150,0.82)';
      ctx.lineWidth=Math.max(1,TILE*0.025);
      ctx.beginPath();
      for(const e of ends){ ctx.moveTo(cx,cy); ctx.lineTo(e[0],e[1]); }
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawCellWireOverlay(ctx,TILE,m,c,px,py,alpha){
    if(!c || c.wire!==T.COPPER_WIRE) return;
    const powered=!!(m && (m.powerPulse>0.05 || m.heroPowerPulse>0.05 || (hasTrackDrive(m) && mechTrackCircuitConnected(m) && (m.energy||0)>0)));
    drawCopperWireOverlay(ctx,TILE,px,py,c.wireConn,alpha,powered);
  }
  function drawCellLegacy(ctx,TILE,m,c,px,py,alpha){
    if(c.t===T.AIR){
      // bare-overlay cell (a wire run through open air): no body square
      drawCellWireOverlay(ctx,TILE,m,c,px,py,alpha);
      return;
    }
    const info=INFO[c.t] || {};
    const role=c.role||'';
    let col=info.color || '#8f9aa6';
    if(role==='pilot') col='#22353b';
    ctx.save();
    ctx.globalAlpha=alpha;
    ctx.fillStyle=col;
    ctx.fillRect(px,py,TILE,TILE);
    ctx.fillStyle='rgba(255,255,255,0.18)';
    ctx.fillRect(px+1,py+1,TILE-2,Math.max(1,TILE*0.13));
    ctx.strokeStyle='rgba(0,0,0,0.48)';
    ctx.lineWidth=Math.max(1,TILE*0.045);
    ctx.strokeRect(px+0.5,py+0.5,TILE-1,TILE-1);

    if(c.t===T.STEEL || c.t===T.STEEL_TRAPDOOR){
      ctx.strokeStyle='rgba(65,73,82,0.46)';
      ctx.lineWidth=Math.max(1,TILE*0.025);
      ctx.beginPath();
      ctx.moveTo(px+TILE*0.08,py+TILE*0.5);
      ctx.lineTo(px+TILE*0.92,py+TILE*0.5);
      ctx.moveTo(px+TILE*0.5,py+TILE*0.08);
      ctx.lineTo(px+TILE*0.5,py+TILE*0.92);
      ctx.stroke();
      ctx.fillStyle='rgba(226,236,242,0.52)';
      ctx.fillRect(px+TILE*0.18,py+TILE*0.2,TILE*0.08,TILE*0.08);
      ctx.fillRect(px+TILE*0.7,py+TILE*0.72,TILE*0.08,TILE*0.08);
    }

    if(role==='hatch' || c.t===T.STEEL_TRAPDOOR){
      ctx.fillStyle='rgba(27,35,43,0.58)';
      ctx.fillRect(px+TILE*0.18,py+TILE*0.27,TILE*0.64,TILE*0.46);
      ctx.strokeStyle='rgba(222,232,239,0.46)';
      ctx.lineWidth=Math.max(1,TILE*0.035);
      ctx.strokeRect(px+TILE*0.18,py+TILE*0.27,TILE*0.64,TILE*0.46);
      ctx.fillStyle='rgba(225,235,240,0.76)';
      ctx.fillRect(px+TILE*0.6,py+TILE*0.47,TILE*0.11,TILE*0.08);
    }

    if(role==='track'){
      const phase=((simT*4 + (m.x||0)*0.8)%1+1)%1;
      ctx.fillStyle='rgba(20,24,26,0.72)';
      ctx.fillRect(px+TILE*0.08,py+TILE*0.22,TILE*0.84,TILE*0.56);
      ctx.strokeStyle='rgba(210,220,226,0.62)';
      ctx.lineWidth=Math.max(1,TILE*0.04);
      ctx.strokeRect(px+TILE*0.08,py+TILE*0.22,TILE*0.84,TILE*0.56);
      ctx.fillStyle='rgba(150,160,166,0.9)';
      for(let i=0;i<3;i++){
        const cx=px+TILE*(0.22+i*0.28+phase*0.08);
        ctx.beginPath();
        ctx.arc(cx,py+TILE*0.5,TILE*0.085,0,Math.PI*2);
        ctx.fill();
      }
      ctx.fillStyle='rgba(80,88,94,0.9)';
      ctx.fillRect(px+TILE*0.13,py+TILE*0.28,TILE*0.74,TILE*0.08);
      ctx.fillRect(px+TILE*0.13,py+TILE*0.64,TILE*0.74,TILE*0.08);
    }

    if(role==='cockpit'){
      ctx.fillStyle='rgba(125,225,255,0.44)';
      ctx.fillRect(px+TILE*0.14,py+TILE*0.16,TILE*0.72,TILE*0.68);
      ctx.strokeStyle='rgba(229,255,255,0.7)';
      ctx.lineWidth=Math.max(1,TILE*0.035);
      ctx.beginPath();
      ctx.moveTo(px+TILE*0.25,py+TILE*0.22);
      ctx.lineTo(px+TILE*0.62,py+TILE*0.76);
      ctx.stroke();
      drawCockpitGlassForeground(ctx,TILE,px,py,alpha*0.88);
      drawAlienTeamPilotMini(ctx,TILE,m,px,py,alpha,{scale:0.94,cx:1.22,foot:0.94});
    }

    if(role==='pilot'){
      drawAlienTeamPilotMini(ctx,TILE,m,px,py,alpha,{scale:0.86,cx:0.50,foot:0.92});
    }

    if(role==='electronics'){
      ctx.fillStyle='rgba(12,20,24,0.62)';
      ctx.fillRect(px+TILE*0.18,py+TILE*0.28,TILE*0.64,TILE*0.44);
      ctx.fillStyle='rgba(168,204,214,0.8)';
      ctx.fillRect(px+TILE*0.28,py+TILE*0.42,TILE*0.3,TILE*0.08);
      ctx.fillRect(px+TILE*0.64,py+TILE*0.42,TILE*0.08,TILE*0.08);
      ctx.strokeStyle='rgba(230,246,250,0.55)';
      ctx.lineWidth=Math.max(1,TILE*0.035);
      ctx.strokeRect(px+TILE*0.18,py+TILE*0.28,TILE*0.64,TILE*0.44);
    }

    if(role==='power' || role==='rotor' || c.t===T.DYNAMO || c.t===T.DYNAMO_SLOT){
      const pulse=0.38+0.32*Math.sin(simT*8+m.id);
      ctx.globalAlpha=alpha*(0.28+pulse*0.34);
      ctx.fillStyle='#7cf7ff';
      ctx.beginPath();
      ctx.arc(px+TILE*0.5,py+TILE*0.5,TILE*0.33,0,Math.PI*2);
      ctx.fill();
      ctx.globalAlpha=alpha;
      ctx.strokeStyle='#e6ffff';
      ctx.lineWidth=Math.max(1,TILE*0.055);
      ctx.beginPath();
      ctx.arc(px+TILE*0.5,py+TILE*0.5,TILE*0.22,0,Math.PI*2);
      ctx.stroke();
      if(role==='rotor' || c.t===T.DYNAMO_SLOT){
        ctx.beginPath();
        ctx.moveTo(px+TILE*0.24,py+TILE*0.5);
        ctx.lineTo(px+TILE*0.76,py+TILE*0.5);
        ctx.moveTo(px+TILE*0.5,py+TILE*0.24);
        ctx.lineTo(px+TILE*0.5,py+TILE*0.76);
        ctx.stroke();
      }
    }

    if(c.t===T.COAL && m.kind==='forge'){
      // coal is inert cargo now (dynamos are flow-powered); keep a dim ember look
      const hot=0.28;
      const pulse=0.75+0.25*Math.sin(simT*12+m.id);
      ctx.fillStyle='#101010';
      ctx.beginPath();
      ctx.arc(px+TILE*0.36,py+TILE*0.68,TILE*0.14,0,Math.PI*2);
      ctx.arc(px+TILE*0.54,py+TILE*0.72,TILE*0.16,0,Math.PI*2);
      ctx.arc(px+TILE*0.68,py+TILE*0.64,TILE*0.12,0,Math.PI*2);
      ctx.fill();
      ctx.globalAlpha=alpha*(0.45+hot*0.35);
      ctx.fillStyle='#ffcf62';
      ctx.beginPath();
      ctx.moveTo(px+TILE*0.5,py+TILE*0.18);
      ctx.quadraticCurveTo(px+TILE*(0.26+0.06*pulse),py+TILE*0.52,px+TILE*0.45,py+TILE*0.66);
      ctx.quadraticCurveTo(px+TILE*(0.72-0.05*pulse),py+TILE*0.5,px+TILE*0.5,py+TILE*0.18);
      ctx.fill();
      ctx.fillStyle='#ff6a21';
      ctx.beginPath();
      ctx.moveTo(px+TILE*0.55,py+TILE*0.32);
      ctx.quadraticCurveTo(px+TILE*0.4,py+TILE*0.52,px+TILE*0.54,py+TILE*0.64);
      ctx.quadraticCurveTo(px+TILE*0.72,py+TILE*0.5,px+TILE*0.55,py+TILE*0.32);
      ctx.fill();
      ctx.globalAlpha=alpha;
    }

    if(role==='wire'){
      ctx.strokeStyle='#e3a357';
      ctx.lineWidth=Math.max(1,TILE*0.08);
      ctx.beginPath();
      ctx.moveTo(px+TILE*0.15,py+TILE*0.5);
      ctx.lineTo(px+TILE*0.85,py+TILE*0.5);
      ctx.stroke();
    }

    if(role==='solar'){
      ctx.strokeStyle='rgba(210,255,255,0.85)';
      ctx.lineWidth=Math.max(1,TILE*0.035);
      ctx.beginPath();
      ctx.moveTo(px+TILE*0.5,py+TILE*0.12);
      ctx.lineTo(px+TILE*0.5,py+TILE*0.88);
      ctx.moveTo(px+TILE*0.13,py+TILE*0.5);
      ctx.lineTo(px+TILE*0.87,py+TILE*0.5);
      ctx.stroke();
    }

    if(role==='chair'){
      ctx.fillStyle='rgba(12,16,20,0.35)';
      ctx.fillRect(px+TILE*0.15,py+TILE*0.85,TILE*0.7,TILE*0.08);
      ctx.fillStyle='rgba(255,255,255,0.30)';
      ctx.fillRect(px+TILE*0.2,py+TILE*0.55,TILE*0.6,TILE*0.14);
      ctx.fillRect(px+TILE*0.16,py+TILE*0.18,TILE*0.16,TILE*0.5);
    }

    if(role==='spring'){
      const squash=1-(m.springT||0)*0.18;
      const y0=py+TILE*0.18, y1=py+TILE*(0.86*squash);
      ctx.strokeStyle='#dfe9ee';
      ctx.lineWidth=Math.max(2,TILE*0.07);
      ctx.beginPath();
      ctx.moveTo(px+TILE*0.3,y0);
      ctx.lineTo(px+TILE*0.7,y0);
      ctx.lineTo(px+TILE*0.3,py+TILE*0.36*squash);
      ctx.lineTo(px+TILE*0.7,py+TILE*0.52*squash);
      ctx.lineTo(px+TILE*0.3,py+TILE*0.68*squash);
      ctx.lineTo(px+TILE*0.7,y1);
      ctx.stroke();
      ctx.fillStyle='rgba(20,25,28,0.58)';
      ctx.fillRect(px+TILE*0.16,py+TILE*0.82,TILE*0.68,TILE*0.12);
    }

    drawCellWireOverlay(ctx,TILE,m,c,px,py,alpha);
    ctx.restore();
  }
  function drawCellOccupantOverlay(ctx,TILE,m,c,px,py,alpha){
    const role=c.role||'';
    if(role!=='cockpit' && role!=='pilot') return;
    if(role==='cockpit'){
      drawCockpitGlassForeground(ctx,TILE,px,py,alpha*0.90);
      drawAlienTeamPilotMini(ctx,TILE,m,px,py,alpha,{scale:0.94,cx:1.22,foot:0.94});
      return;
    }
    drawAlienTeamPilotMini(ctx,TILE,m,px,py,alpha,{scale:0.86,cx:0.50,foot:0.92});
  }
  function drawCell(ctx,TILE,m,c,px,py,alpha){
    const drawTile=root.MM && root.MM.drawEntityTile;
    if(typeof drawTile==='function'){
      const phase=((simT*4+(m.x||0)*0.8)%1+1)%1;
      try{
        drawTile(ctx,c.t,px,py,Math.floor(m.x+c.dx),Math.floor(m.y+c.dy),{alpha,trackPhase:phase});
        drawCellWireOverlay(ctx,TILE,m,c,px,py,alpha);
        drawCellOccupantOverlay(ctx,TILE,m,c,px,py,alpha);
        return;
      }catch(e){}
    }
    drawCellLegacy(ctx,TILE,m,c,px,py,alpha);
  }
  function drawBar(ctx,TILE,m){
    const r=rect(m,m.x,m.y);
    const x=r.left*TILE, y=(r.top-0.35)*TILE, w=r.w*TILE;
    const hp=clamp((m.hp||0)/(m.maxHp||1),0,1);
    ctx.fillStyle='rgba(0,0,0,0.55)';
    ctx.fillRect(x,y,w,Math.max(3,TILE*0.12));
    ctx.fillStyle=m.rider?'#7cf7ff':(m.pilotAlive?'#ff6a55':'#ffd76a');
    ctx.fillRect(x,y,w*hp,Math.max(3,TILE*0.12));
    if(m.pilotAlive){
      const p=clamp((m.pilotHp||0)/(m.pilotMaxHp||1),0,1);
      ctx.fillStyle='rgba(121,201,93,0.92)';
      ctx.fillRect(x,y+Math.max(4,TILE*0.16),w*p,Math.max(2,TILE*0.08));
    }
    if(m.rider || !m.pilotAlive){
      const e=clamp((m.energy||0)/(m.maxEnergy||1),0,1);
      ctx.fillStyle='rgba(0,0,0,0.45)';
      ctx.fillRect(x,y+Math.max(7,TILE*0.28),w,Math.max(2,TILE*0.07));
      ctx.fillStyle=m.noPowerT>0?'#ff785f':'#7cf7ff';
      ctx.fillRect(x,y+Math.max(7,TILE*0.28),w*e,Math.max(2,TILE*0.07));
    }
  }
  function draw(ctx,TILE,visible){
    if(!ctx || !TILE) return;
    ctx.save();
    for(const m of mechs){
      let any=false;
      for(const c of m.cells){
        const p=cellWorld(m,c);
        if(!visible || visible(p.x,p.y)){ any=true; break; }
      }
      if(!any) continue;
      const bob=(m.onGround?Math.sin(simT*6+m.id)*0.025:0);
      const shake=(m.flashT>0 ? (hash01(m.id,Math.floor(simT*80))-0.5)*0.08 : 0);
      for(const c of m.cells){
        const wx=m.x+c.dx+shake, wy=m.y+c.dy+bob;
        const px=wx*TILE, py=wy*TILE;
        const a=m.hp<=0?0.45:1;
        drawCell(ctx,TILE,m,c,px,py,a);
      }
      if(m.rider){
        const c=cockpitCell(m);
        ctx.strokeStyle='rgba(124,247,255,0.95)';
        ctx.lineWidth=Math.max(2,TILE*0.08);
        ctx.strokeRect((m.x+c.dx)*TILE+2,(m.y+c.dy+bob)*TILE+2,TILE-4,TILE-4);
      }
      drawBar(ctx,TILE,m);
    }
    ctx.restore();
  }
  function snapshot(){
    return {
      v:2,
      used:[...usedZones].slice(0,2400),
      list:mechs.filter(m=>m && m.hp>0).map(m=>{
        const out={
          id:m.id,
          kind:m.kind,
          x:+m.x.toFixed(3),
          y:+m.y.toFixed(3),
          vx:+(m.vx||0).toFixed(3),
          vy:+(m.vy||0).toFixed(3),
          hp:+(m.hp||0).toFixed(2),
          maxHp:+(m.maxHp||1).toFixed(2),
          pilotHp:+(m.pilotHp||0).toFixed(2),
          pilotMaxHp:+(m.pilotMaxHp||1).toFixed(2),
          pilotAlive:!!m.pilotAlive,
          energy:+(m.energy||0).toFixed(2),
          maxEnergy:+(m.maxEnergy||mechMaxEnergy(m.kind)).toFixed(2),
          facing:m.facing<0?-1:1,
          zone:m.zone||null,
          rider:!!m.rider,
          salvageSeed:m.salvageSeed||0
        };
        if(m.kind==='built'){
          // built hulls have no blueprint seed: the actual cells are the save
          out.cells=(m.cells||[]).slice(0,CFG.BUILT_MAX_CELLS).map(c=>{
            const cell={dx:c.dx,dy:c.dy,t:c.t};
            if(c.role) cell.role=c.role;
            if(Array.isArray(c.infra) && c.infra.length) cell.infra=c.infra.slice(0,3);
            return cell;
          });
          out.variant=m.variant||'tracks';
        }
        return out;
      })
    };
  }
  function sanitizeSavedBuiltCells(rawCells){
    const out=[];
    const seen=new Set();
    const INFRA_OK=new Set([T.COPPER_WIRE,T.WIRE,T.WATER_PIPE,T.LADDER]);
    for(const rc of rawCells.slice(0,CFG.BUILT_MAX_CELLS)){
      if(!rc) continue;
      const dx=Number(rc.dx), dy=Number(rc.dy), t=Number(rc.t);
      if(!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(t)) continue;
      if(t!==T.AIR && !INFO[t]) continue;
      const key=(dx|0)+','+(dy|0);
      if(seen.has(key)) continue;
      seen.add(key);
      const infra=Array.isArray(rc.infra) ? rc.infra.filter(it=>INFRA_OK.has(it)).slice(0,3) : [];
      if(t===T.AIR && !infra.length) continue;
      const role=builtRoleFor(t|0);
      const cell={dx:dx|0,dy:dy|0,t:t|0,role,hp:durabilityForCell(t|0,role)};
      if(infra.length){
        cell.infra=infra;
        if(infra.includes(T.COPPER_WIRE)) cell.wire=T.COPPER_WIRE;
      }
      out.push(cell);
    }
    return out;
  }
  function restore(data,getTile){
    reset();
    if(!data || typeof data !== 'object') return false;
    if(Array.isArray(data.used)) usedZones=new Set(data.used.filter(x=>typeof x==='string').slice(0,2400));
    if(Array.isArray(data.list)){
      for(const raw of data.list.slice(0,CFG.MAX_ACTIVE)){
        if(!raw || !finite(raw.x) || !finite(raw.y)) continue;
        let m=null;
        let seed=Number.isFinite(Number(raw.salvageSeed)) ? Number(raw.salvageSeed)|0 : Math.floor(Number(raw.x));
        if(raw.kind==='built' && Array.isArray(raw.cells)){
          const cells=sanitizeSavedBuiltCells(raw.cells);
          m=makeBuiltMechFromCells(cells,Number(raw.x),Number(raw.y),raw.variant==='springs'?'springs':'tracks');
          if(!m) continue;
          seed=0;
        } else {
          const kind=raw.kind==='solar'?'solar':'forge';
          const bp=makeBlueprint(kind,seed);
          m=buildMech(kind,Number(raw.x),Number(raw.y),bp,raw.zone||null,seed);
        }
        m.id=Number.isFinite(raw.id)?Math.max(1,raw.id|0):nextId++;
        nextId=Math.max(nextId,m.id+1);
        m.x=Number(raw.x);
        m.y=Number(raw.y);
        m.vx=clamp(Number(raw.vx)||0,-8,8);
        m.vy=clamp(Number(raw.vy)||0,-20,20);
        m.maxHp=Math.max(1,Number(raw.maxHp)||m.maxHp);
        m.hp=clamp(Number(raw.hp)||m.maxHp,0.1,m.maxHp);
        m.pilotMaxHp=Math.max(1,Number(raw.pilotMaxHp)||m.pilotMaxHp);
        m.pilotHp=clamp(Number(raw.pilotHp),0,m.pilotMaxHp);
        if(!Number.isFinite(raw.pilotHp)) m.pilotHp=m.pilotMaxHp;
        m.pilotAlive=raw.pilotAlive!==false && m.pilotHp>0;
        m.maxEnergy=Math.max(1,Number(raw.maxEnergy)||m.maxEnergy||mechMaxEnergy(m.kind));
        m.energy=clamp(Number(raw.energy),0,m.maxEnergy);
        if(!Number.isFinite(raw.energy)) m.energy=Math.min(m.maxEnergy,m.energy||m.maxEnergy*0.3);
        m.rider=!!raw.rider && !m.pilotAlive && m.hp>0 && riderMechId==null;
        if(m.rider) riderMechId=m.id;
        m.facing=raw.facing<0?-1:1;
        m.salvageSeed=seed;
        mechs.push(m);
      }
    }
    return true;
  }
  function reset(opts){
    mechs=[];
    usedZones=new Set();
    riderMechId=null;
    nextId=1;
    scanT=0;
    simT=0;
    seatBlock=null;
    lastSeatTry=null;
    seatHintAt=-99;
    markCellIndexDirty();
    spawnFreezeT=Math.max(0,Math.min(20,Number(opts&&opts.suppressSpawns)||0));
  }
  function forceSpawn(kind,player,getTile,setTile){
    const requested=String(kind||'');
    const normalized=requested==='solar'?'solar':'forge';
    const base=player && finite(player.x) ? player.x : (normalized==='solar'?-CFG.MIN_DISTANCE:CFG.MIN_DISTANCE);
    const dir=normalized==='solar'?-1:1;
    let x=Math.round(base + dir*10);
    if(normalized==='forge'){
      const want=requested==='forge_tracks'?'tracks':'legs';
      for(let i=0;i<12 && forgeVariantForSeed(x)!==want;i++) x+=dir;
    }
    let m=makeMech(normalized,x,getTile,null);
    rememberWorldFns(getTile,setTile);
    if(!m){
      const seed=Math.floor(x);
      const bp=makeBlueprint(normalized,seed);
      const y=spawnYFor(x,getTile,bp);
      if(!Number.isFinite(y)) return null;
      m=buildMech(normalized,x,y,bp,null,seed);
    }
    mechs.push(m);
    markCellIndexDirty();
    return m;
  }
  function metrics(){
    return {
      count:mechs.length,
      ridden:!!findRiderMech(),
      pilots:mechs.filter(m=>m.pilotAlive).length,
      abandoned:mechs.filter(m=>!m.pilotAlive && !m.rider).length,
      built:mechs.filter(m=>m.kind==='built').length,
      energy:+mechs.reduce((n,m)=>n+(m.energy||0),0).toFixed(2),
      mountedTurrets:mechs.filter(m=>!!mountedTurretCell(m)).length,
      poweredTurrets:mechs.filter(m=>mechTurretCircuitConnected(m)).length,
      usedZones:usedZones.size,
      spawnFreeze:+spawnFreezeT.toFixed(2)
    };
  }

  const api={
    update,draw,attackAt,damageAt,damageRadius,blastRadius,igniteRadius,douseRadius,
    toggleBoard,heroMech,syncRider,absorbHeroDamage,cellAt,findAt,
    snapshot,restore,reset,forceSpawn,metrics,heroOnTracks,
    trySeatFromWorld,wantsInteractKey,tileOverlayAt,absorbDynamoFlow,
    refillMountedWaterAt,
    _debug:{
      mechs:()=>mechs,mountedTurretCell,makeBlueprint,trySpawnZone,zoneShouldSpawn,zoneSpawnX,CFG,
      isMechComponentTile,scanBuiltStructure,analyzeBuiltCells,assembleBuiltMechAt,parkBuiltMech,
      mechTrackCircuitConnected,mechTurretCircuitConnected,energisedCells,chairEnergyMult,
      seatState:()=>({block:seatBlock,lastTry:lastSeatTry})
    }
  };
  root.MM.mechs=api;
})();

export const mechs = (typeof window !== 'undefined' && window.MM) ? window.MM.mechs : globalThis.MM && globalThis.MM.mechs;
export default mechs;
