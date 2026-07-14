import { WORLD_H, WORLD_MAX_Y, WORLD_MIN_Y, WORLD_SECTION_H } from '../constants.js';

function finite(v,fallback){
  const n=Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function clamp01(v){ return clamp(finite(v,0),0,1); }

function routeConfig(opts={}){
  const sectionHeight=Math.max(1,finite(opts.sectionHeight,WORLD_SECTION_H));
  const baseSectionMin=Math.floor(finite(opts.baseSectionMin,0));
  const baseSectionMax=Math.floor(finite(opts.baseSectionMax,Math.max(0,Math.ceil(WORLD_H/sectionHeight)-1)));
  const minY=finite(opts.minY,WORLD_MIN_Y);
  const maxY=Math.max(minY+1,finite(opts.maxY,WORLD_MAX_Y));
  const clearance=Math.max(0,finite(opts.clearance,10));
  const edgeMargin=Math.max(0,Math.min(sectionHeight*0.25,finite(opts.edgeMargin,2)));
  const sourceSurfaceY=opts.sourceSurfaceY!=null && Number.isFinite(Number(opts.sourceSurfaceY)) ? Number(opts.sourceSurfaceY) : null;
  const targetSurfaceY=opts.targetSurfaceY!=null && Number.isFinite(Number(opts.targetSurfaceY)) ? Number(opts.targetSurfaceY) : null;
  const surfaceBand=Math.max(1,finite(opts.surfaceBand,18));
  return {sectionHeight,baseSectionMin,baseSectionMax,minY,maxY,clearance,edgeMargin,sourceSurfaceY,targetSurfaceY,surfaceBand};
}

export function respawnTravelSection(y,sectionHeight=WORLD_SECTION_H){
  const h=Math.max(1,finite(sectionHeight,WORLD_SECTION_H));
  return Math.floor(Math.floor(finite(y,0))/h);
}

// The original terrain-following flight is meaningful only in the contiguous
// legacy surface band. Sky islands and deep strata are independent vertical
// sections, so sampling WORLDGEN.surfaceHeight there pulls the camera into a
// different world layer.
export function usesSurfaceRespawnRoute(fromY,toY,opts={}){
  const cfg=routeConfig(opts);
  const fromSection=respawnTravelSection(fromY,cfg.sectionHeight);
  const toSection=respawnTravelSection(toY,cfg.sectionHeight);
  const inBase=fromSection>=cfg.baseSectionMin && fromSection<=cfg.baseSectionMax &&
    toSection>=cfg.baseSectionMin && toSection<=cfg.baseSectionMax;
  if(!inBase || cfg.sourceSurfaceY===null || cfg.targetSurfaceY===null) return false;
  const sourceNear=Math.abs(finite(fromY,0)-cfg.sourceSurfaceY)<=cfg.surfaceBand;
  const targetNear=Math.abs(finite(toY,0)-cfg.targetSurfaceY)<=cfg.surfaceBand;
  return sourceNear && targetNear;
}

// Returns the cruise reference blended by main.js between takeoff and landing.
// Cross-layer travel follows the vertical interpolation instead of an unrelated
// surface column. Same-section travel is clamped inside that section so its small
// lift cannot briefly expose an adjacent layer at a section seam.
export function sectionAwareRespawnCruiseY(fromY,toY,progress,terrainY,opts={}){
  const cfg=routeConfig(opts);
  const t=clamp01(progress);
  const from=finite(fromY,0), to=finite(toY,from);
  const linear=from+(to-from)*t;
  if(usesSurfaceRespawnRoute(from,to,cfg) && Number.isFinite(Number(terrainY))){
    return clamp(Number(terrainY)-cfg.clearance,cfg.minY+cfg.edgeMargin,cfg.maxY-cfg.edgeMargin);
  }

  const lift=Math.min(cfg.clearance*0.60,cfg.sectionHeight*0.12);
  const fromSection=respawnTravelSection(from,cfg.sectionHeight);
  const toSection=respawnTravelSection(to,cfg.sectionHeight);
  // Crossing a section boundary is a real vertical journey. Keep it monotone;
  // even a small cosmetic lift would make a short seam crossing loop backward.
  if(fromSection!==toSection) return clamp(linear,cfg.minY+cfg.edgeMargin,cfg.maxY-cfg.edgeMargin);
  let y=linear-lift;
  const top=fromSection*cfg.sectionHeight;
  y=clamp(y,top+cfg.edgeMargin,top+cfg.sectionHeight-cfg.edgeMargin);
  return clamp(y,cfg.minY+cfg.edgeMargin,cfg.maxY-cfg.edgeMargin);
}

function smoothstep(v){ const t=clamp01(v); return t*t*(3-2*t); }

export function sectionAwareRespawnPoint(route,progress,terrainY,opts={}){
  const cfg=routeConfig(opts);
  const t=clamp01(progress);
  const from=route&&route.from ? route.from : {x:0,y:0};
  const to=route&&route.to ? route.to : from;
  const fromX=finite(from.x,0), toX=finite(to.x,fromX);
  const fromY=finite(from.y,0), toY=finite(to.y,fromY);
  const x=fromX+(toX-fromX)*t;
  const endpointY=fromY+(toY-fromY)*t;
  const cruiseY=sectionAwareRespawnCruiseY(fromY,toY,t,terrainY,cfg);
  const takeoff=smoothstep(Math.min(1,t/0.20));
  const landing=smoothstep(Math.min(1,(1-t)/0.20));
  const cruiseBlend=Math.min(takeoff,landing);
  const fromSection=respawnTravelSection(fromY,cfg.sectionHeight);
  const toSection=respawnTravelSection(toY,cfg.sectionHeight);
  const crossesSection=fromSection!==toSection;
  const seed=finite(route&&route.seed,0);
  const wave=crossesSection ? 0 : Math.sin((t*Math.PI*2)+seed*0.013)*0.35*cruiseBlend;
  let y=endpointY+(cruiseY-endpointY)*cruiseBlend+wave;
  if(!usesSurfaceRespawnRoute(fromY,toY,cfg) && !crossesSection && cruiseBlend>0){
    const top=fromSection*cfg.sectionHeight;
    // The cruise reference keeps a comfortable margin, but the complete path
    // must stay continuous with legitimate endpoints right beside a seam. Clamp
    // only to the real section bounds here; clamping to edgeMargin would jump on
    // the first/last animation frame.
    const epsilon=Math.max(1e-9,cfg.sectionHeight*1e-9);
    const lower=Math.max(cfg.minY,top);
    const upper=Math.min(cfg.maxY-epsilon,top+cfg.sectionHeight-epsilon);
    y=clamp(y,lower,upper);
  }
  return {x,y};
}

export default Object.freeze({
  respawnTravelSection,
  usesSurfaceRespawnRoute,
  sectionAwareRespawnCruiseY,
  sectionAwareRespawnPoint
});
