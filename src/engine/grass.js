// Grass and overlay animations module (grass blades, leaf shimmer, diamond glow)
// API: MM.grass.drawOverlays(ctx, pass, sx, sy, viewX, viewY, TILE, WORLD_H, getTile, T, zoom, densityScalar, heightScalar, canDrawTile)
//      MM.grass.getBudgetInfo() -> string for FPS HUD suffix
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
  let overlayCache = {key:'', tiles:[], grassTiles:0};

  function hash32(x,y){ let h = (x|0)*374761393 + (y|0)*668265263; h = (h^(h>>>13))*1274126177; h = h^(h>>>16); return h>>>0; }
  function openAbove(t,T){ return t===T.AIR || !!(MM.INFO && MM.INFO[t] && MM.INFO[t].gas); }

  grass.getBudgetInfo = function(){ return grassBudgetInfo; };

  // Reset any internal dynamic state (called on world regen)
  grass.reset = function(){
    grassThinningFactor = 1;
    grassBladeTarget = 3;
    grassBudgetInfo = '';
    overlayCache = {key:'', tiles:[], grassTiles:0};
  };

  function leafTile(t,T){ return t===T.LEAF || t===T.AUTUMN_LEAF_ORANGE || t===T.AUTUMN_LEAF_RED; }
  function overlayKey(sx,sy,viewX,viewY,WORLD_H,visibleTile){
    return sx+'|'+sy+'|'+viewX+'|'+viewY+'|'+WORLD_H+'|'+(visibleTile?1:0);
  }
  function buildOverlayCandidates(sx,sy,viewX,viewY,WORLD_H,getTile,T,visibleTile){
    const tiles=[];
    let grassTiles=0;
    for(let y=sy; y<sy+viewY+2; y++){
      if(y<0||y>=WORLD_H) continue;
      for(let x=sx; x<sx+viewX+2; x++){
        const t=getTile(x,y);
        if(t===T.AIR) continue;
        const visible=!visibleTile || visibleTile(x,y);
        if(t===T.GRASS){
          if(visible && openAbove(getTile(x,y-1),T)){
            grassTiles++;
            tiles.push([x,y,t]);
          }
        } else if(visible && (leafTile(t,T) || t===T.DIAMOND)){
          tiles.push([x,y,t]);
        }
      }
    }
    return {tiles, grassTiles};
  }

  grass.drawOverlays = function(ctx, pass, sx, sy, viewX, viewY, TILE, WORLD_H, getTile, T, zoom, densityScalar, heightScalar, canDrawTile){
    const visibleTile = typeof canDrawTile === 'function' ? canDrawTile : null;
    const now=performance.now();
    const wind = Math.sin(now*0.0003)*1.2 + Math.sin(now*0.0011)*0.8;
    const diamondPulse = (Math.sin(now*0.005)+1)/2;
    const key=overlayKey(sx,sy,viewX,viewY,WORLD_H,visibleTile);
    if(pass==='back' || overlayCache.key!==key){
      const next=buildOverlayCandidates(sx,sy,viewX,viewY,WORLD_H,getTile,T,visibleTile);
      overlayCache={key, tiles:next.tiles, grassTiles:next.grassTiles};
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
            const freq = 0.0025 + randB*0.0035;
            const amp = 2.0 + randC*3.0;
            const phase = ((bSeed>>>6)&1023)/1023 * Math.PI*2;
            const timeTerm = now*freq + phase + wind*0.4;
            const sway = Math.sin(timeTerm) * amp;
            const jitter = ((bSeed>>>26)&63)/63; const frac = (b + jitter)/bladeCount;
            const baseX = x*TILE + (frac - 0.5)*TILE*0.98 + TILE/2;
            const baseY = y*TILE;
            const bendDir = Math.sin(phase + wind*0.2);
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
        if(leafTile(t,T)){ const h=hash32(x,y); const frontLeaf = ((h>>7)&1)===1; if((pass==='back' && frontLeaf) || (pass==='front' && !frontLeaf)){} else { const phase=(h&255)/255; const offset = Math.sin(now*0.0025 + phase*6.283)*2.5; ctx.fillStyle='rgba(255,255,255,'+(frontLeaf?0.10:0.06)+')'; ctx.fillRect(x*TILE + TILE/2 + offset - TILE*0.22, y*TILE+3, TILE*0.44, TILE*0.44); } }
        // Diamond shimmer + flash (back pass)
        if(pass==='back' && t===T.DIAMOND){ const h=hash32(x,y); const flash = Math.sin(now*0.006 + (h&1023))*0.5 + 0.5; if(flash>0.8){ const alpha=(flash-0.8)/0.2; ctx.fillStyle='rgba(255,255,255,'+(0.3*alpha)+')'; const cxp=x*TILE+TILE/2, cyp=y*TILE+TILE/2; ctx.fillRect(cxp-1,cyp-1,2,2); ctx.fillRect(cxp-3,cyp,6,1); ctx.fillRect(cxp,cyp-3,1,6); }
          ctx.fillStyle='rgba(255,255,255,'+(0.05+diamondPulse*0.07)+')'; ctx.fillRect(x*TILE,y*TILE,TILE,TILE); }
    }
  };

  MM.grass = grass;
})();
// ESM export (progressive migration)
export const grass = (typeof window!=='undefined' && window.MM) ? window.MM.grass : undefined;
export default grass;
