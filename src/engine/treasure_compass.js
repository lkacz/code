// Treasure compass / dowsing pendant.
//
// This module deliberately knows nothing about inventory, DOM or fog storage.
// The game supplies `getTile` and `isDiscovered`; discovery is checked BEFORE a
// tile read, so a pendant can never leak a hidden cave through timing, labels or
// pointer movement.  A circular scan is split across frames and hard-capped.
// Integration owns the equipment level (0..4) and canvas placement.
import { T, INFO } from '../constants.js';

const ABSOLUTE_MAX_RANGE=96;
const ABSOLUTE_MAX_BUDGET=1024;
const ABSOLUTE_MAX_EXTRA_TARGETS=256;
const ABSOLUTE_MAX_EXTRA_BUDGET=64;
const DEFAULT_RANGES=Object.freeze([0,12,22,36,52]);
const DEFAULT_BUDGETS=Object.freeze([0,80,128,192,256]);
const DEFAULT_CADENCE=Object.freeze([0,0.8,0.62,0.46,0.32]);

export const TREASURE_COMPASS_LEVELS=Object.freeze([
  Object.freeze({level:0,range:0,label:'Brak strojenia'}),
  Object.freeze({level:1,range:DEFAULT_RANGES[1],label:'Poszept'}),
  Object.freeze({level:2,range:DEFAULT_RANGES[2],label:'Tropiciel'}),
  Object.freeze({level:3,range:DEFAULT_RANGES[3],label:'Różdżkarz'}),
  Object.freeze({level:4,range:DEFAULT_RANGES[4],label:'Wszechwidzący'}),
]);

const CHEST_VALUE=Object.freeze({common:60,uncommon:72,rare:88,epic:106,legendary:124});
const CHEST_LABEL=Object.freeze({
  common:'zwykła skrzynia', uncommon:'niezwykła skrzynia', rare:'rzadka skrzynia',
  epic:'epicka skrzynia', legendary:'legendarna skrzynia'
});
const TILE_VALUE=new Map([
  [T.DIAMOND,{category:'ore',value:84,label:'diament'}],
  [T.GOLD_ORE,{category:'ore',value:76,label:'ruda złota'}],
  [T.SILVER_ORE,{category:'ore',value:72,label:'ruda srebra'}],
  [T.IRIDIUM,{category:'resource',value:104,label:'iryd'}],
  [T.METEORIC_IRON,{category:'resource',value:86,label:'żelazo meteorytowe'}],
  [T.RADIOACTIVE_ORE,{category:'resource',value:108,label:'ruda radioaktywna'}],
  [T.ANTIMATTER_CRYSTAL,{category:'resource',value:126,label:'kryształ antymaterii'}],
  [T.METEOR_DUST,{category:'resource',value:62,label:'pył meteorytowy'}],
  [T.ALIEN_BIOMASS,{category:'resource',value:54,label:'obca biomasa'}],
  [T.MOTHER_ICE,{category:'relic',value:120,label:'relikt Matki Lodu'}],
  [T.MOTHER_LAVA,{category:'relic',value:120,label:'relikt Matki Lawy'}],
]);

export const TREASURE_CATEGORY_COLORS=Object.freeze({
  chest:'#ffd166', cache:'#61f5d2', ore:'#72e7ff', resource:'#d692ff', relic:'#ff8e72'
});

function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function finite(v,fallback){ v=Number(v); return Number.isFinite(v)?v:fallback; }
function normalizeLevel(v){ return clamp(Math.floor(finite(v,0)),0,4); }

function normalizeSeries(value,fallback,maxValue,monotonic){
  const src=Array.isArray(value)?value:fallback;
  const out=[0];
  for(let i=1;i<=4;i++){
    const raw=src[i]===undefined?fallback[i]:src[i];
    const n=clamp(Math.round(finite(raw,fallback[i])),1,maxValue);
    out[i]=monotonic?Math.max(out[i-1],n):n;
  }
  return Object.freeze(out);
}

function normalizeCadence(value){
  const src=Array.isArray(value)?value:DEFAULT_CADENCE;
  const out=[0];
  for(let i=1;i<=4;i++) out[i]=clamp(finite(src[i],DEFAULT_CADENCE[i]),0,10);
  return Object.freeze(out);
}

export function classifyTreasureTile(tile,info=INFO[tile]){
  if(!info || !Number.isInteger(tile)) return null;
  if(info.chestTier){
    const tier=Object.prototype.hasOwnProperty.call(CHEST_VALUE,info.chestTier)?info.chestTier:'common';
    return {category:'chest',value:CHEST_VALUE[tier],label:CHEST_LABEL[tier],tier};
  }
  if(info.cache) return {category:'cache',value:122,label:'rzadka skrytka',tier:'legendary'};
  const authored=TILE_VALUE.get(tile);
  if(authored) return {...authored,tier:authored.value>=115?'legendary':authored.value>=100?'epic':authored.value>=80?'rare':'uncommon'};
  // Future ore types automatically become detectable without making ordinary
  // stone/geology attractive. Authored precious ores above retain richer labels.
  if(info.ore) return {category:'ore',value:68,label:'cenna ruda',tier:'uncommon'};
  return null;
}

export function classifyTreasureTarget(entry){
  if(!entry || typeof entry!=='object') return null;
  if(entry.kind==='chest'){
    const tier=Object.prototype.hasOwnProperty.call(CHEST_VALUE,entry.tier)?entry.tier:'common';
    return {category:'chest',value:CHEST_VALUE[tier],label:CHEST_LABEL[tier],tier};
  }
  if(entry.kind==='cache') return {category:'cache',value:122,label:'rzadka skrytka',tier:'legendary'};
  const category=['chest','cache','ore','resource','relic'].includes(entry.category)?entry.category:null;
  const value=clamp(finite(entry.value,0),1,126);
  if(!category || !(value>0)) return null;
  const tier=['common','uncommon','rare','epic','legendary'].includes(entry.tier)?entry.tier
    :value>=115?'legendary':value>=100?'epic':value>=80?'rare':'uncommon';
  const label=typeof entry.label==='string'&&entry.label.length<=60?entry.label:'cenny obiekt';
  return {category,value,label,tier};
}

const OFFSET_CACHE=new Map();
function offsetsFor(range){
  if(OFFSET_CACHE.has(range)) return OFFSET_CACHE.get(range);
  const out=[Object.freeze({dx:0,dy:0})];
  for(let ring=1;ring<=range;ring++){
    const add=(dx,dy)=>{
      if(dx*dx+dy*dy<=range*range) out.push(Object.freeze({dx,dy}));
    };
    for(let dx=-ring;dx<=ring;dx++){ add(dx,-ring); add(dx,ring); }
    for(let dy=-ring+1;dy<=ring-1;dy++){ add(-ring,dy); add(ring,dy); }
  }
  const frozen=Object.freeze(out);
  OFFSET_CACHE.set(range,frozen);
  return frozen;
}

function directionFor(dx,dy){
  const angle=Math.atan2(dy,dx);
  const names=['E','SE','S','SW','W','NW','N','NE'];
  const octant=names[(Math.round(angle/(Math.PI/4))+8)%8];
  const len=Math.hypot(dx,dy)||1;
  return {x:dx/len,y:dy/len,angle,octant};
}

function targetAt(x,y,tile,spec,player,range){
  const dx=x+0.5-finite(player.x,0);
  const dy=y+0.5-finite(player.y,0);
  const distance=Math.hypot(dx,dy);
  const proximity=clamp(1-distance/Math.max(1,range),0,1);
  const value=spec.value;
  const score=value+proximity*28;
  const signal=clamp(0.12+proximity*0.48+(value/126)*0.4,0.12,1);
  return {
    x,y,worldX:x+0.5,worldY:y+0.5,key:`tile:${x},${y}`,source:'tile',tile,
    category:spec.category,value,label:spec.label,tier:spec.tier,
    distance,score,signal,direction:directionFor(dx,dy)
  };
}

function extraTargetAt(entry,spec,player,range,index=0){
  const x=finite(entry.x,0),y=finite(entry.y,0);
  const dx=x-finite(player.x,0),dy=y-finite(player.y,0);
  const distance=Math.hypot(dx,dy);
  const proximity=clamp(1-distance/Math.max(1,range),0,1);
  const value=spec.value,score=value+proximity*28;
  const signal=clamp(0.12+proximity*0.48+(value/126)*0.4,0.12,1);
  const authoredId=(typeof entry.id==='string'||Number.isFinite(entry.id))?String(entry.id):null;
  const key=authoredId?`extra:${entry.kind||spec.category}:${authoredId}`
    :`extra:${entry.kind||spec.category}:${Math.round(x*100)},${Math.round(y*100)}:${index}`;
  return {
    x,y,worldX:x,worldY:y,key,source:'extra',tile:null,
    category:spec.category,value,label:spec.label,tier:spec.tier,
    distance,score,signal,direction:directionFor(dx,dy)
  };
}

function better(a,b,mode){
  if(!a) return b;
  if(!b) return a;
  let delta=0;
  if(mode==='nearest') delta=b.distance-a.distance;
  else if(mode==='valuable') delta=a.value-b.value;
  else delta=a.score-b.score;
  if(Math.abs(delta)>1e-7) return delta>0?a:b;
  if(a.value!==b.value) return a.value>b.value?a:b;
  if(Math.abs(a.distance-b.distance)>1e-7) return a.distance<b.distance?a:b;
  if(a.y!==b.y) return a.y<b.y?a:b;
  return a.x<=b.x?a:b;
}

function nearest(a,b){
  if(!a) return b;
  if(!b) return a;
  if(Math.abs(a.distance-b.distance)>1e-7) return a.distance<b.distance?a:b;
  return a.value>=b.value?a:b;
}

function sameTarget(a,b){ return !!a&&!!b&&a.key===b.key; }
function nowMs(){ return typeof performance!=='undefined'&&performance.now?performance.now():Date.now(); }

// Keeps one bounded dynamic-target window stable for an entire terrain scan.
// Callers commonly prepare extra targets once per frame, while the scanner
// snapshots them only when a new pass begins. Advancing a rotating cursor on
// every frame would therefore skip windows during the scan/cooldown and can
// permanently starve entries for some list lengths. A pass token (normally
// `scanner.metrics().completedPasses`) advances the window exactly once.
export function createRotatingTargetWindow(options={}){
  const limit=clamp(Math.round(finite(options.limit,96)),1,ABSOLUTE_MAX_EXTRA_TARGETS);
  let cursor=0,token=null,hasToken=false,cached=[];

  function sample(list,passToken,mapEntry){
    if(!Array.isArray(list) || !list.length){
      cursor=0; cached=[]; token=passToken; hasToken=true;
      return cached;
    }
    if(hasToken && Object.is(token,passToken)) return cached;
    const inspected=Math.min(limit,list.length);
    const out=[];
    for(let i=0;i<inspected;i++){
      const sourceIndex=(cursor+i)%list.length;
      const entry=list[sourceIndex];
      let mapped=entry;
      if(typeof mapEntry==='function'){
        try{ mapped=mapEntry(entry,sourceIndex,i); }catch(e){ mapped=null; }
      }
      if(mapped!=null && out.length<limit) out.push(mapped);
    }
    cursor=(cursor+inspected)%list.length;
    cached=out;
    token=passToken;
    hasToken=true;
    return cached;
  }

  return Object.freeze({
    sample,
    reset(){ cursor=0; token=null; hasToken=false; cached=[]; },
    metrics:()=>({limit,cursor,hasToken,cached:cached.length,token})
  });
}

export function createTreasureCompass(options={}){
  const config=Object.freeze({
    ranges:normalizeSeries(options.ranges,DEFAULT_RANGES,ABSOLUTE_MAX_RANGE,true),
    budgets:normalizeSeries(options.budgets,DEFAULT_BUDGETS,ABSOLUTE_MAX_BUDGET,false),
    cadence:normalizeCadence(options.cadence),
    switchMargin:clamp(finite(options.switchMargin,0.12),0,1),
    recenterMin:clamp(finite(options.recenterMin,2),1,16),
    recenterFraction:clamp(finite(options.recenterFraction,0.12),0.03,0.5),
    maxExtraTargets:clamp(Math.round(finite(options.maxExtraTargets,96)),1,ABSOLUTE_MAX_EXTRA_TARGETS),
    extraBudget:clamp(Math.round(finite(options.extraBudget,24)),1,ABSOLUTE_MAX_EXTRA_BUDGET),
    selection:['balanced','nearest','valuable'].includes(options.selection)?options.selection:'balanced'
  });
  let level=0,range=0,originX=0,originY=0,offsets=Object.freeze([]),cursor=0,cooldown=0;
  let extraTargets=null,extraCursor=0;
  let target=null,bestTarget=null,nearestTarget=null,passBest=null,passNearest=null;
  let passCurrent=null,passStarted=0,hasOrigin=false;
  const metric={
    updates:0,totalTiles:0,discoveryChecks:0,tileReads:0,skippedUndiscovered:0,
    candidates:0,completedPasses:0,restarts:0,recenters:0,errors:0,
    lastUpdateTiles:0,maxTilesPerUpdate:0,lastPassTiles:0,lastPassMs:0,
    extraOffered:0,extraChecked:0,extraSkippedUndiscovered:0,extraCandidates:0,
    extraTruncated:0,lastUpdateExtra:0,maxExtraPerUpdate:0,lastPassExtra:0
  };

  function clearPass(){
    cursor=0; extraTargets=null; extraCursor=0;
    passBest=null; passNearest=null; passCurrent=null; passStarted=nowMs();
  }
  function beginAt(x,y,recenter){
    originX=x; originY=y; hasOrigin=true; clearPass(); metric.restarts++;
    if(recenter) metric.recenters++;
  }
  function setLevel(next,px,py){
    next=normalizeLevel(next);
    if(next===level) return false;
    level=next; range=config.ranges[level]; offsets=level?offsetsFor(range):Object.freeze([]);
    cooldown=0; target=null; bestTarget=null; nearestTarget=null; hasOrigin=false; clearPass();
    if(level) beginAt(px,py,false);
    return true;
  }
  function reproject(t,player){
    if(!t) return null;
    const fresh=t.source==='extra'?extraTargetAt(t,t,player,range,0):targetAt(t.x,t.y,t.tile,t,player,range);
    fresh.key=t.key; fresh.category=t.category; fresh.value=t.value; fresh.label=t.label; fresh.tier=t.tier;
    return fresh;
  }
  function finishPass(player){
    bestTarget=passBest;
    nearestTarget=passNearest;
    if(!passBest) target=null;
    else if(!target) target=passBest;
    else if(!passCurrent) target=passBest;
    else if(sameTarget(passBest,passCurrent)) target=passCurrent;
    else {
      const incumbent=passCurrent;
      const required=incumbent.score+Math.max(4,incumbent.value*config.switchMargin);
      target=passBest.score>required?passBest:incumbent;
    }
    target=reproject(target,player);
    metric.completedPasses++;
    metric.lastPassTiles=offsets.length;
    metric.lastPassExtra=extraTargets?extraTargets.length:0;
    metric.lastPassMs=Math.max(0,nowMs()-passStarted);
    cooldown=config.cadence[level];
    clearPass();
  }

  function update(args={}){
    metric.updates++; metric.lastUpdateTiles=0; metric.lastUpdateExtra=0;
    const player=args.player||{};
    const px=Math.floor(finite(player.x,0));
    const py=Math.floor(finite(player.y,0));
    setLevel(args.level,px,py);
    if(!level) return null;
    target=reproject(target,player);
    bestTarget=reproject(bestTarget,player);
    nearestTarget=reproject(nearestTarget,player);

    const shift=Math.hypot(px-originX,py-originY);
    const recenterAt=Math.max(config.recenterMin,range*config.recenterFraction);
    if(!hasOrigin || shift>=recenterAt) beginAt(px,py,hasOrigin);
    const dt=clamp(finite(args.dt,0),0,1);
    if(cooldown>0){ cooldown=Math.max(0,cooldown-dt); return target; }

    const getTile=typeof args.getTile==='function'?args.getTile:null;
    const isDiscovered=typeof args.isDiscovered==='function'?args.isDiscovered:null;
    // Fail closed. In particular, never fall back to reading terrain first and
    // checking discovery afterwards: doing so would let fogged chunks leak.
    if(!getTile || !isDiscovered) return target;
    if(extraTargets===null){
      const supplied=Array.isArray(args.extraTargets)?args.extraTargets:[];
      const count=Math.min(supplied.length,config.maxExtraTargets);
      extraTargets=supplied.slice(0,count);
      metric.extraOffered+=count;
      if(supplied.length>count) metric.extraTruncated+=supplied.length-count;
    }
    const budget=config.budgets[level];
    const startCursor=cursor;
    while(cursor<offsets.length && cursor-startCursor<budget){
      const off=offsets[cursor++];
      const x=originX+off.dx,y=originY+off.dy;
      metric.totalTiles++; metric.discoveryChecks++; metric.lastUpdateTiles++;
      let discovered=false;
      try{ discovered=!!isDiscovered(x,y); }catch(e){ metric.errors++; }
      if(!discovered){ metric.skippedUndiscovered++; continue; }
      let tile;
      try{ tile=getTile(x,y); metric.tileReads++; }catch(e){ metric.errors++; continue; }
      const spec=classifyTreasureTile(tile,INFO[tile]);
      if(!spec) continue;
      const candidate=targetAt(x,y,tile,spec,player,range);
      if(candidate.distance>range+0.75) continue;
      metric.candidates++;
      passBest=better(passBest,candidate,config.selection);
      passNearest=nearest(passNearest,candidate);
      if(target&&sameTarget(target,candidate)) passCurrent=candidate;
    }
    const extraStart=extraCursor;
    while(extraCursor<extraTargets.length && extraCursor-extraStart<config.extraBudget){
      const index=extraCursor,entry=extraTargets[extraCursor++];
      metric.extraChecked++; metric.lastUpdateExtra++;
      if(!entry || !Number.isFinite(Number(entry.x)) || !Number.isFinite(Number(entry.y))) continue;
      const ex=Number(entry.x),ey=Number(entry.y);
      if(Math.hypot(ex-finite(player.x,0),ey-finite(player.y,0))>range+0.75) continue;
      let discovered=false;
      metric.discoveryChecks++;
      try{ discovered=!!isDiscovered(Math.floor(ex),Math.floor(ey)); }catch(e){ metric.errors++; }
      if(!discovered){ metric.skippedUndiscovered++; metric.extraSkippedUndiscovered++; continue; }
      const spec=classifyTreasureTarget(entry);
      if(!spec) continue;
      const candidate=extraTargetAt(entry,spec,player,range,index);
      metric.candidates++; metric.extraCandidates++;
      passBest=better(passBest,candidate,config.selection);
      passNearest=nearest(passNearest,candidate);
      if(target&&sameTarget(target,candidate)) passCurrent=candidate;
    }
    metric.maxTilesPerUpdate=Math.max(metric.maxTilesPerUpdate,metric.lastUpdateTiles);
    metric.maxExtraPerUpdate=Math.max(metric.maxExtraPerUpdate,metric.lastUpdateExtra);
    if(cursor>=offsets.length && extraCursor>=extraTargets.length) finishPass(player);
    return target;
  }

  return Object.freeze({
    update,
    target:()=>target,
    bestTarget:()=>bestTarget,
    nearestTarget:()=>nearestTarget,
    reset(){ target=null; bestTarget=null; nearestTarget=null; hasOrigin=false; cooldown=0; clearPass(); },
    config:()=>config,
    metrics:()=>({
      ...metric,level,range,budget:config.budgets[level],offsetCount:offsets.length,cursor,
      progress:offsets.length?cursor/offsets.length:0,cooldown,
      maxExtraTargets:config.maxExtraTargets,extraBudget:config.extraBudget,
      extraCount:extraTargets?extraTargets.length:0,extraCursor
    })
  });
}

export function compassNeedleGeometry(target,options={}){
  const radius=clamp(finite(options.radius,18),5,160);
  if(!target) return {active:false,angle:-Math.PI/2,length:radius*0.34,signal:0,radius,color:'#647184'};
  const signal=clamp(finite(target.signal,0),0,1);
  return {
    active:true,
    angle:finite(target.direction&&target.direction.angle,-Math.PI/2),
    // A strong signal physically pulls the pendant farther from its resting
    // centre, while a weak/far signal still gives an unambiguous direction.
    length:radius*(0.52+signal*0.4),signal,radius,
    color:TREASURE_CATEGORY_COLORS[target.category]||'#e9f4ff'
  };
}

export function drawTreasureCompass(ctx,target,options={}){
  if(!ctx || typeof ctx.save!=='function') return null;
  const g=compassNeedleGeometry(target,options);
  const x=finite(options.x,0),y=finite(options.y,0),alpha=clamp(finite(options.alpha,1),0,1);
  const time=finite(options.time,0),r=g.radius;
  ctx.save();
  ctx.globalAlpha*=alpha;
  ctx.translate(x,y);
  // Pendant body: dark enamel, metal rim and four quiet compass ticks.
  ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fillStyle='rgba(10,18,28,.88)'; ctx.fill();
  ctx.lineWidth=Math.max(1,r*0.12); ctx.strokeStyle=g.active?g.color:'#718096'; ctx.stroke();
  ctx.lineWidth=Math.max(1,r*0.045); ctx.strokeStyle='rgba(232,244,255,.42)';
  for(let i=0;i<4;i++){
    const a=i*Math.PI/2,inner=r*0.68,outer=r*0.84;
    ctx.beginPath(); ctx.moveTo(Math.cos(a)*inner,Math.sin(a)*inner); ctx.lineTo(Math.cos(a)*outer,Math.sin(a)*outer); ctx.stroke();
  }
  if(g.active){
    const pulse=0.82+Math.sin(time*5)*0.12*g.signal;
    ctx.save(); ctx.rotate(g.angle);
    ctx.shadowColor=g.color; ctx.shadowBlur=r*(0.16+g.signal*0.3);
    ctx.strokeStyle=g.color; ctx.fillStyle=g.color; ctx.lineCap='round';
    ctx.lineWidth=Math.max(2,r*0.13); ctx.beginPath(); ctx.moveTo(-r*0.2,0); ctx.lineTo(g.length-r*0.2,0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(g.length*pulse,0); ctx.lineTo(g.length-r*0.32,-r*0.22); ctx.lineTo(g.length-r*0.32,r*0.22); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.arc(0,0,Math.max(1.5,r*0.12),0,Math.PI*2); ctx.fillStyle='#f6fbff'; ctx.fill();
  } else {
    ctx.save(); ctx.rotate(g.angle+Math.sin(time*0.8)*0.08);
    ctx.strokeStyle='#7b8797'; ctx.lineWidth=Math.max(1.5,r*0.1); ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(0,r*0.1); ctx.lineTo(g.length,0); ctx.stroke(); ctx.restore();
  }
  ctx.restore();
  return g;
}

const api=Object.freeze({
  LEVELS:TREASURE_COMPASS_LEVELS,
  CATEGORY_COLORS:TREASURE_CATEGORY_COLORS,
  create:createTreasureCompass,
  createRotatingTargetWindow,
  classifyTile:classifyTreasureTile,
  classifyTarget:classifyTreasureTarget,
  needleGeometry:compassNeedleGeometry,
  draw:drawTreasureCompass
});

if(typeof window!=='undefined'){
  window.MM=window.MM||{};
  window.MM.treasureCompass=api;
}

export default api;
