import { T } from '../constants.js';
import {
  isDoorTile,
  isGasTile,
  isPlayerBuiltMaterial,
  isTrapdoorTile
} from './material_physics.js';

export const HOUSE_HEAL_RATE_MIN_FRAC = 0.001;
export const HOUSE_HEAL_RATE_MAX_FRAC = 0.01;
export const HOUSE_HEAL_RATE_MIN_SIZE = 9;
export const HOUSE_HEAL_RATE_FULL_SIZE = 100;
export const HOUSE_HEAL_RATE_FRAC = HOUSE_HEAL_RATE_MAX_FRAC;
export const HOUSE_SCAN_INTERVAL = 0.45;
export const HOUSE_MAX_CELLS = 900;
export const HOUSE_MAX_RADIUS_X = 36;
export const HOUSE_MAX_RADIUS_Y = 24;

const DIRS = Object.freeze([[1,0],[-1,0],[0,1],[0,-1]]);
const LIGHT_SOURCE_TILES = new Set([T.TORCH, T.LAVA, T.MOTHER_LAVA, T.ALTAR, T.GLOWSHROOM]);
const CRAFTED_HOUSE_SIGNAL_TILES = new Set([
  T.WOOD, T.GLASS, T.BRICK, T.STEEL,
  T.WOOD_DOOR, T.STONE_DOOR, T.STEEL_DOOR,
  T.WOOD_TRAPDOOR, T.STONE_TRAPDOOR, T.STEEL_TRAPDOOR
]);

function key(x,y){ return x+','+y; }

function safeTile(getTile,x,y){
  try{
    const t=getTile(Math.floor(x),Math.floor(y));
    return Number.isFinite(t) ? t : T.AIR;
  }catch(e){ return T.AIR; }
}

function safeBackground(opts,x,y){
  if(!opts || typeof opts.backgroundAt!=='function') return T.AIR;
  try{
    const t=opts.backgroundAt(Math.floor(x),Math.floor(y));
    return Number.isFinite(t) ? t : T.AIR;
  }catch(e){ return T.AIR; }
}

export function isHouseInteriorTile(t){
  return t===T.AIR || t===T.TORCH || t===T.LAVA || t===T.MOTHER_LAVA ||
    t===T.GLOWSHROOM || t===T.WIRE || t===T.COPPER_WIRE || t===T.WATER_PIPE ||
    t===T.LADDER || isGasTile(t);
}

export function isHouseSealTile(t){
  return isPlayerBuiltMaterial(t) || isDoorTile(t) || isTrapdoorTile(t);
}

export function isHouseLightSourceTile(t,x,y,opts){
  if(LIGHT_SOURCE_TILES.has(t)) return true;
  if(opts && typeof opts.isBurning==='function'){
    try{ if(opts.isBurning(Math.floor(x),Math.floor(y))) return true; }catch(e){}
  }
  return false;
}

function isCraftedHouseSignal(t){
  return CRAFTED_HOUSE_SIGNAL_TILES.has(t) || isDoorTile(t) || isTrapdoorTile(t);
}

function countHouseSizeCells(interior,sealCells,getTile){
  const cells=new Set(interior);
  for(const k of sealCells) cells.add(k);
  for(const k of interior){
    const parts=k.split(',');
    const x=Number(parts[0]), y=Number(parts[1]);
    if(!Number.isFinite(x) || !Number.isFinite(y)) continue;
    for(let dy=-1; dy<=1; dy++){
      for(let dx=-1; dx<=1; dx++){
        if(dx===0 && dy===0) continue;
        const nx=x+dx, ny=y+dy;
        const nk=key(nx,ny);
        if(cells.has(nk)) continue;
        if(isHouseSealTile(safeTile(getTile,nx,ny))) cells.add(nk);
      }
    }
  }
  return cells.size;
}

export function houseHealRateFracForSize(totalCells){
  const cells=Math.max(0,Number(totalCells)||0);
  if(cells<=HOUSE_HEAL_RATE_MIN_SIZE) return HOUSE_HEAL_RATE_MIN_FRAC;
  if(cells>=HOUSE_HEAL_RATE_FULL_SIZE) return HOUSE_HEAL_RATE_MAX_FRAC;
  const span=HOUSE_HEAL_RATE_FULL_SIZE-HOUSE_HEAL_RATE_MIN_SIZE;
  const t=(cells-HOUSE_HEAL_RATE_MIN_SIZE)/span;
  return HOUSE_HEAL_RATE_MIN_FRAC + (HOUSE_HEAL_RATE_MAX_FRAC-HOUSE_HEAL_RATE_MIN_FRAC)*t;
}

export function houseHealRateFrac(status){
  if(!status || !status.ok) return 0;
  return houseHealRateFracForSize(status.totalCells || status.cells || 0);
}

function playerSampleTiles(player){
  const x=Number(player && player.x) || 0;
  const y=Number(player && player.y) || 0;
  const w=Math.max(0.1, Number(player && player.w) || 0.7);
  const h=Math.max(0.1, Number(player && player.h) || 0.95);
  return [
    [Math.floor(x), Math.floor(y)],
    [Math.floor(x), Math.floor(y-h*0.35)],
    [Math.floor(x), Math.floor(y+h*0.25)],
    [Math.floor(x-w*0.25), Math.floor(y)],
    [Math.floor(x+w*0.25), Math.floor(y)]
  ];
}

function noteAdjacentLight(x,y,getTile,opts){
  for(const [dx,dy] of DIRS){
    const tx=x+dx, ty=y+dy;
    if(isHouseLightSourceTile(safeTile(getTile,tx,ty),tx,ty,opts)) return true;
  }
  return false;
}

export function analyzeHouseAt(player,getTile,opts={}){
  if(!player || typeof getTile!=='function') return {ok:false, reason:'missing_context'};
  let start=null;
  for(const [sx,sy] of playerSampleTiles(player)){
    const t=safeTile(getTile,sx,sy);
    if(isHouseInteriorTile(t)){ start={x:sx,y:sy}; break; }
    if(isDoorTile(t) || isTrapdoorTile(t)){
      for(const [dx,dy] of DIRS){
        const nx=sx+dx, ny=sy+dy;
        if(isHouseInteriorTile(safeTile(getTile,nx,ny))){ start={x:nx,y:ny}; break; }
      }
      if(start) break;
    }
  }
  if(!start) return {ok:false, reason:'not_inside'};

  const minX=start.x-HOUSE_MAX_RADIUS_X, maxX=start.x+HOUSE_MAX_RADIUS_X;
  const minY=start.y-HOUSE_MAX_RADIUS_Y, maxY=start.y+HOUSE_MAX_RADIUS_Y;
  const q=[start];
  const seen=new Set([key(start.x,start.y)]);
  const sealCells=new Set();
  let qi=0, light=false, crafted=false, seals=0, missingBackwall=null;
  let left=start.x, right=start.x, top=start.y, bottom=start.y;

  while(qi<q.length){
    const c=q[qi++];
    if(q.length>HOUSE_MAX_CELLS) return {ok:false, reason:'too_large', cells:q.length};
    if(c.x<minX || c.x>maxX || c.y<minY || c.y>maxY) return {ok:false, reason:'open', cells:q.length};
    left=Math.min(left,c.x); right=Math.max(right,c.x); top=Math.min(top,c.y); bottom=Math.max(bottom,c.y);

    const t=safeTile(getTile,c.x,c.y);
    if(!isHouseInteriorTile(t)) return {ok:false, reason:'blocked_start'};
    if(isHouseLightSourceTile(t,c.x,c.y,opts) || noteAdjacentLight(c.x,c.y,getTile,opts)) light=true;
    const bg=safeBackground(opts,c.x,c.y);
    if(isPlayerBuiltMaterial(bg)) crafted=true;
    else if(!missingBackwall) missingBackwall={x:c.x,y:c.y};

    for(const [dx,dy] of DIRS){
      const nx=c.x+dx, ny=c.y+dy;
      const nt=safeTile(getTile,nx,ny);
      if(isHouseInteriorTile(nt)){
        if(nx<minX || nx>maxX || ny<minY || ny>maxY) return {ok:false, reason:'open', cells:q.length};
        const k=key(nx,ny);
        if(!seen.has(k)){ seen.add(k); q.push({x:nx,y:ny}); }
        continue;
      }
      if(!isHouseSealTile(nt)) return {ok:false, reason:'unsealed', blocker:nt, x:nx, y:ny, cells:q.length};
      seals++;
      sealCells.add(key(nx,ny));
      if(isCraftedHouseSignal(nt)) crafted=true;
      if(isHouseLightSourceTile(nt,nx,ny,opts)) light=true;
    }
  }

  const footprintCells=(right-left+3)*(bottom-top+3);
  const totalCells=countHouseSizeCells(seen,sealCells,getTile);
  const healRateFrac=houseHealRateFracForSize(totalCells);
  if(!seals) return {ok:false, reason:'unsealed', cells:q.length};
  if(missingBackwall) return {ok:false, reason:'no_background', x:missingBackwall.x, y:missingBackwall.y, cells:q.length, seals};
  if(!crafted) return {ok:false, reason:'not_built', cells:q.length, seals};
  if(!light) return {ok:false, reason:'dark', cells:q.length, seals};
  return {ok:true, reason:'house', cells:q.length, sealCells:sealCells.size, footprintCells, totalCells, healRateFrac, seals, lit:light, built:crafted, bounds:{left,right,top,bottom}};
}

export function createHouseHealingState(){
  return {scanT:0, inside:false, last:null, reportAcc:0, wasHealing:false};
}

export function updateHouseHealing(state,dt,player,getTile,opts={}){
  state=state || createHouseHealingState();
  const step=Math.max(0,Math.min(1,Number(dt)||0));
  state.scanT-=step;
  const wasInside=!!state.inside;
  if(state.scanT<=0){
    state.scanT=HOUSE_SCAN_INTERVAL;
    state.last=analyzeHouseAt(player,getTile,opts);
    state.inside=!!(state.last && state.last.ok);
  }
  let healed=0, report=0;
  if(state.inside && player && player.hp>0 && player.maxHp>0 && player.hp<player.maxHp){
    const before=player.hp;
    const healRate=houseHealRateFrac(state.last);
    player.hp=Math.min(player.maxHp, player.hp + player.maxHp*healRate*step);
    healed=Math.max(0,player.hp-before);
    state.reportAcc+=healed;
    if(state.reportAcc>=1 || player.hp>=player.maxHp){
      report=state.reportAcc;
      state.reportAcc=0;
    }
  } else if(!state.inside){
    state.reportAcc=0;
  }
  const started=healed>0 && !state.wasHealing;
  state.wasHealing=healed>0;
  return {inside:state.inside, entered:state.inside && !wasInside, exited:!state.inside && wasInside, started, healed, report, healRateFrac:houseHealRateFrac(state.last), status:state.last};
}

export const houseHealing = {
  analyzeHouseAt,
  createState:createHouseHealingState,
  healRateFrac:houseHealRateFrac,
  healRateFracForSize:houseHealRateFracForSize,
  update:updateHouseHealing,
  config:Object.freeze({
    healRateFrac:HOUSE_HEAL_RATE_FRAC,
    healRateMinFrac:HOUSE_HEAL_RATE_MIN_FRAC,
    healRateMaxFrac:HOUSE_HEAL_RATE_MAX_FRAC,
    healRateMinSize:HOUSE_HEAL_RATE_MIN_SIZE,
    healRateFullSize:HOUSE_HEAL_RATE_FULL_SIZE,
    scanInterval:HOUSE_SCAN_INTERVAL,
    maxCells:HOUSE_MAX_CELLS,
    maxRadiusX:HOUSE_MAX_RADIUS_X,
    maxRadiusY:HOUSE_MAX_RADIUS_Y
  })
};

if(typeof window!=='undefined'){
  window.MM = window.MM || {};
  window.MM.houseHealing = houseHealing;
}

export default houseHealing;
