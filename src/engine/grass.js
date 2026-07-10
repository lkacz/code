// Grass and overlay animations module (grass blades, leaf shimmer, diamond glow)
// API: MM.grass.drawOverlays(ctx, pass, sx, sy, viewX, viewY, TILE, worldMaxY, getTile, T, zoom, densityScalar, heightScalar, canDrawTile, worldMinY)
//      MM.grass.getBudgetInfo() -> string for FPS HUD suffix
import { isAirOrGasTile, isFoliageTile } from './material_physics.js';

(function(){
  window.MM = window.MM || {};
  const grass = {};

  // Internal perf controls
  const GRASS_STROKE_BUDGET = 6500; // soft cap total blade strokes per frame (both passes)
  const GRASS_CRITICAL_BUDGET = 1800;
  const GRASS_MAX_BLADES_PER_TILE = 56;
  let grassThinningFactor = 1; // dynamic 0..1
  let grassBladeTarget = 3;
  let grassBudgetInfo = '';
  let overlayCache = {key:'', ver:-1, at:-1e9, tiles:[], grassTiles:0};

  function hash32(x,y){ let h = (x|0)*374761393 + (y|0)*668265263; h = (h^(h>>>13))*1274126177; h = h^(h>>>16); return h>>>0; }
  function openAbove(t){ return isAirOrGasTile(t); }

  grass.getBudgetInfo = function(){ return grassBudgetInfo; };

  // Reset any internal dynamic state (called on world regen)
  grass.reset = function(){
    grassThinningFactor = 1;
    grassBladeTarget = 3;
    grassBudgetInfo = '';
    overlayCache = {key:'', ver:-1, at:-1e9, tiles:[], grassTiles:0};
  };

  function leafTile(t){ return isFoliageTile(t); }
  function overlayKey(sx,sy,viewX,viewY,worldMinY,worldMaxY,visibleTile){
    return sx+'|'+sy+'|'+viewX+'|'+viewY+'|'+worldMinY+'|'+worldMaxY+'|'+(visibleTile?1:0);
  }
  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function cleanNumber(v,fallback){
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  }
  function readWindFrame(now){
    const W = window.MM && window.MM.wind;
    let speed = 0;
    let intensity = 0;
    let storm = 0;
    let thermal = 0;
    let night = 0;
    let squall = 0;
    if(W){
      let m = null;
      if(typeof W.metrics === 'function'){
        try{ m = W.metrics(); }catch(e){}
      }
      if(m && typeof m === 'object'){
        speed = cleanNumber(m.speed, 0);
        intensity = cleanNumber(m.intensity, Math.min(1, Math.abs(speed)/5.2));
        storm = cleanNumber(m.storm, 0);
        thermal = cleanNumber(m.thermal, 0);
        night = cleanNumber(m.night, 0);
        squall = m.squall && m.squall.active ? Math.min(1, Math.abs(cleanNumber(m.squall.speed, speed))/5.2) : 0;
      } else if(typeof W.speed === 'function'){
        try{ speed = cleanNumber(W.speed(), 0); }catch(e){}
        intensity = Math.min(1, Math.abs(speed)/5.2);
      }
    }
    const mag = Math.min(5.2, Math.abs(speed));
    const dir = speed < -0.01 ? -1 : (speed > 0.01 ? 1 : 0);
    const motion = clamp(mag/5.2,0,1);
    const pulse = (Math.sin(now*0.0003)*0.55 + Math.sin(now*0.0011)*0.35) * motion;
    return {
      speed,
      dir,
      mag,
      motion,
      intensity:clamp(intensity,0,1),
      storm:clamp(storm,0,1),
      thermal:clamp(thermal,0,1),
      night:clamp(night,0,2),
      squall:clamp(squall,0,1),
      pulse
    };
  }
  function buildOverlayCandidates(sx,sy,viewX,viewY,worldMinY,worldMaxY,getTile,T,visibleTile){
    const tiles=[];
    let grassTiles=0;
    for(let y=sy; y<sy+viewY+2; y++){
      if(y<worldMinY||y>=worldMaxY) continue;
      for(let x=sx; x<sx+viewX+2; x++){
        const t=getTile(x,y);
        if(t===T.AIR) continue;
        const visible=!visibleTile || visibleTile(x,y);
        if(t===T.GRASS){
          if(visible && openAbove(getTile(x,y-1))){
            grassTiles++;
            tiles.push([x,y,t]);
          }
        } else if(visible && (leafTile(t) || t===T.DIAMOND || t===T.GOLD_ORE)){
          tiles.push([x,y,t]);
        }
      }
    }
    return {tiles, grassTiles};
  }

  grass.drawOverlays = function(ctx, pass, sx, sy, viewX, viewY, TILE, worldMaxY, getTile, T, zoom, densityScalar, heightScalar, canDrawTile, worldMinY){
    const visibleTile = typeof canDrawTile === 'function' ? canDrawTile : null;
    const minY = Number.isFinite(worldMinY) ? worldMinY : 0;
    const maxY = Number.isFinite(worldMaxY) ? worldMaxY : 0;
    const now=performance.now();
    const wind = readWindFrame(now);
    const diamondPulse = (Math.sin(now*0.005)+1)/2;
    const key=overlayKey(sx,sy,viewX,viewY,minY,maxY,visibleTile);
    // Cross-frame candidate cache: the full-viewport scan used to rerun every
    // frame (the 'back' pass forced it). Rebuild on camera move, on any world
    // change (MM.worldRenderVersion stamp from main), or after 400ms as a net
    // for visibility drift (fog reveals without tile changes).
    const ver=(window.MM && Number.isFinite(window.MM.worldRenderVersion)) ? window.MM.worldRenderVersion : 0;
    if(overlayCache.key!==key || overlayCache.ver!==ver || now-overlayCache.at>400){
      const next=buildOverlayCandidates(sx,sy,viewX,viewY,minY,maxY,getTile,T,visibleTile);
      overlayCache={key, ver, at:now, tiles:next.tiles, grassTiles:next.grassTiles};
    }
    const candidates=overlayCache.tiles;

    if(pass==='back'){
      // Estimate cost and set thinning factor once per frame region
      const basePerTile = Math.min(GRASS_MAX_BLADES_PER_TILE, Math.max(1, Math.round(3 * densityScalar)));
      const zoomLod = zoom < 1 ? (0.35 + 0.65*zoom) : 1;
      const desiredBlades = Math.max(1, Math.round(basePerTile * zoomLod));
      const frameMs = (typeof window!=='undefined' && Number.isFinite(window.__mmFrameMs)) ? window.__mmFrameMs : 16;
      const budget = frameMs>40 ? GRASS_CRITICAL_BUDGET : (frameMs>24 ? 3400 : GRASS_STROKE_BUDGET);
      const estimatedStrokes = overlayCache.grassTiles * desiredBlades;
      if(estimatedStrokes > budget){
        grassThinningFactor = budget / estimatedStrokes;
        if(grassThinningFactor < 0.03) grassThinningFactor = 0.03;
        grassBladeTarget = Math.max(1, Math.min(GRASS_MAX_BLADES_PER_TILE, Math.round(desiredBlades * grassThinningFactor)));
        grassBudgetInfo = ' grass:'+grassBladeTarget+'/tile';
      } else {
        grassThinningFactor = 1;
        grassBladeTarget = desiredBlades;
        grassBudgetInfo = '';
      }
    }

    for(const item of candidates){
        const x=item[0], y=item[1], t=item[2];
        // Grass blades (surface)
        if(t===T.GRASS){
          const seed=hash32(x,y);
          const bladeCount = grassBladeTarget;
          const start = pass==='front' ? 1 : 0;
          for(let b=start;b<bladeCount;b+=2){
            const bSeed = seed ^ (b*1103515245);
            const randA = ((bSeed>>>1)&1023)/1023;
            const randB = ((bSeed>>>11)&1023)/1023;
            const randC = ((bSeed>>>21)&1023)/1023;
            let heightFactor = 0.10 + randA*0.40;
            heightFactor *= heightScalar;
            if(heightFactor>0.8) heightFactor=0.8;
            const typeEnergy = 1 + wind.thermal*0.18 + wind.night*0.06 + wind.storm*0.34 + wind.squall*0.42;
            const freq = (0.0018 + randB*0.0025) * (0.6 + wind.motion*1.5 + wind.storm*0.7 + wind.squall*0.9);
            const amp = (1.1 + randC*2.4) * wind.motion * typeEnergy;
            const phase = ((bSeed>>>6)&1023)/1023 * Math.PI*2;
            const rolling = Math.sin(now*0.00042 + x*0.17 + phase) * wind.motion * wind.thermal*1.7;
            const stormJitter = Math.sin(now*(0.006 + randB*0.006) + phase*1.7) * wind.motion * (wind.storm*1.8 + wind.squall*2.2);
            const timeTerm = now*freq + phase + wind.pulse*0.25 + rolling*0.08;
            const gustLean = wind.dir * (wind.mag*1.15 + wind.motion*2.8 + wind.squall*2.2);
            const sway = Math.sin(timeTerm) * amp + rolling + stormJitter + gustLean;
            const jitter = ((bSeed>>>26)&63)/63; const frac = (b + jitter)/bladeCount;
            const baseX = x*TILE + (frac - 0.5)*TILE*0.98 + TILE/2;
            const baseY = y*TILE;
            const bendDir = Math.sin(phase)*0.14 + wind.dir*(wind.motion*0.92 + wind.squall*0.24);
            const curvature = 0.2 + randB*0.4;
            const topX = baseX + sway*0.45;
            const topY = baseY - TILE*heightFactor;
            const midX = baseX + (sway*0.25) + bendDir*curvature*4;
            const midY = baseY - TILE*heightFactor*0.55;
            const shadeMod = 0.65 + randC*0.5;
            const frontBlade = pass==='front';
            ctx.strokeStyle = (bSeed&2)? 'rgba(46,165,46,'+(frontBlade? (0.85*shadeMod).toFixed(2):(0.55*shadeMod).toFixed(2))+')' : 'rgba(34,125,34,'+(frontBlade? (0.80*shadeMod).toFixed(2):(0.50*shadeMod).toFixed(2))+')';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(baseX, baseY);
            ctx.quadraticCurveTo(midX, midY, topX, topY);
            ctx.stroke();
          }
        }
        // Leaf shimmer
        if(leafTile(t)){ const h=hash32(x,y); const frontLeaf = ((h>>7)&1)===1; if((pass==='back' && frontLeaf) || (pass==='front' && !frontLeaf)){} else { const phase=(h&255)/255; const offset = Math.sin(now*0.0025 + phase*6.283)*2.5; ctx.fillStyle='rgba(255,255,255,'+(frontLeaf?0.10:0.06)+')'; ctx.fillRect(x*TILE + TILE/2 + offset - TILE*0.22, y*TILE+3, TILE*0.44, TILE*0.44); } }
        // Diamond shimmer + flash (back pass)
        if(pass==='back' && t===T.DIAMOND){ const h=hash32(x,y); const flash = Math.sin(now*0.006 + (h&1023))*0.5 + 0.5; if(flash>0.8){ const alpha=(flash-0.8)/0.2; ctx.fillStyle='rgba(255,255,255,'+(0.3*alpha)+')'; const cxp=x*TILE+TILE/2, cyp=y*TILE+TILE/2; ctx.fillRect(cxp-1,cyp-1,2,2); ctx.fillRect(cxp-3,cyp,6,1); ctx.fillRect(cxp,cyp-3,1,6); }
          ctx.fillStyle='rgba(255,255,255,'+(0.05+diamondPulse*0.07)+')'; ctx.fillRect(x*TILE,y*TILE,TILE,TILE); }
        if(pass==='back' && t===T.GOLD_ORE){ const h=hash32(x,y); const flash = Math.sin(now*0.0048 + (h&1023))*0.5 + 0.5; if(flash>0.72){ const alpha=(flash-0.72)/0.28; ctx.fillStyle='rgba(255,235,118,'+(0.22*alpha)+')'; const cxp=x*TILE+TILE/2+(((h>>>5)&3)-1), cyp=y*TILE+TILE/2+(((h>>>9)&3)-1); ctx.fillRect(cxp-1,cyp,3,1); ctx.fillRect(cxp,cyp-1,1,3); }
          ctx.fillStyle='rgba(255,202,58,'+(0.035+diamondPulse*0.045)+')'; ctx.fillRect(x*TILE,y*TILE,TILE,TILE); }
    }
  };

  MM.grass = grass;
})();
// ESM export (progressive migration)
export const grass = (typeof window!=='undefined' && window.MM) ? window.MM.grass : undefined;
export default grass;
