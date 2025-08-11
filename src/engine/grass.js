// Grass and overlay animations module (grass blades, leaf shimmer, diamond glow)
// API: MM.grass.drawOverlays(ctx, pass, sx, sy, viewX, viewY, TILE, WORLD_H, getTile, T, zoom, densityScalar, heightScalar)
//      MM.grass.getBudgetInfo() -> string for FPS HUD suffix
(function(){
  window.MM = window.MM || {};
  const grass = {};

  // Internal perf controls
  const GRASS_ITER_BUDGET = 30000; // soft cap total blade draws per frame (both passes)
  let grassThinningFactor = 1; // dynamic 0..1
  let grassBudgetInfo = '';

  function hash32(x,y){ let h = (x|0)*374761393 + (y|0)*668265263; h = (h^(h>>>13))*1274126177; h = h^(h>>>16); return h>>>0; }

  grass.getBudgetInfo = function(){ return grassBudgetInfo; };

  grass.drawOverlays = function(ctx, pass, sx, sy, viewX, viewY, TILE, WORLD_H, getTile, T, zoom, densityScalar, heightScalar){
    const now=performance.now();
    const wind = Math.sin(now*0.0003)*1.2 + Math.sin(now*0.0011)*0.8;
    const diamondPulse = (Math.sin(now*0.005)+1)/2;

    if(pass==='back'){
      // Estimate cost and set thinning factor once per frame region
      let grassTiles=0;
      for(let y=sy; y<sy+viewY+2; y++){
        if(y<0||y>=WORLD_H) continue;
        for(let x=sx; x<sx+viewX+2; x++){
          if(getTile(x,y)===T.GRASS && getTile(x,y-1)===T.AIR) grassTiles++;
        }
      }
      const basePerTile = Math.min(120, Math.max(1, Math.round(3 * densityScalar)));
      const zoomLod = zoom < 1 ? (0.35 + 0.65*zoom) : 1;
      const estimatedIterations = grassTiles * basePerTile * 2 * zoomLod;
      if(estimatedIterations > GRASS_ITER_BUDGET){
        grassThinningFactor = GRASS_ITER_BUDGET / estimatedIterations;
        if(grassThinningFactor < 0.05) grassThinningFactor = 0.05;
        grassBudgetInfo = ' grass:'+(grassThinningFactor*100|0)+'%';
      } else {
        grassThinningFactor = 1;
        grassBudgetInfo = '';
      }
    }

    for(let y=sy; y<sy+viewY+2; y++){
      if(y<0||y>=WORLD_H) continue;
      for(let x=sx; x<sx+viewX+2; x++){
        const t=getTile(x,y); if(t===T.AIR) continue;
        // Grass blades (surface)
        if(t===T.GRASS && getTile(x,y-1)===T.AIR){
          const seed=hash32(x,y);
          const base = 3;
          let bladeCount = Math.min(120, Math.max(1, Math.round(base * densityScalar * grassThinningFactor * (zoom<1? (0.35 + 0.65*zoom):1))));
          for(let b=0;b<bladeCount;b++){
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
            const frontBlade = ((bSeed>>5)&1)===1; if((pass==='front' && !frontBlade) || (pass==='back' && frontBlade)) continue;
            ctx.strokeStyle = (bSeed&2)? 'rgba(46,165,46,'+(frontBlade? (0.85*shadeMod).toFixed(2):(0.55*shadeMod).toFixed(2))+')' : 'rgba(34,125,34,'+(frontBlade? (0.80*shadeMod).toFixed(2):(0.50*shadeMod).toFixed(2))+')';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(baseX, baseY);
            ctx.quadraticCurveTo(midX, midY, topX, topY);
            ctx.stroke();
          }
        }
        // Leaf shimmer
        if(t===T.LEAF){ const h=hash32(x,y); const frontLeaf = ((h>>7)&1)===1; if((pass==='back' && frontLeaf) || (pass==='front' && !frontLeaf)){} else { const phase=(h&255)/255; const offset = Math.sin(now*0.0025 + phase*6.283)*2.5; ctx.fillStyle='rgba(255,255,255,'+(frontLeaf?0.10:0.06)+')'; ctx.fillRect(x*TILE + TILE/2 + offset - TILE*0.22, y*TILE+3, TILE*0.44, TILE*0.44); } }
        // Diamond shimmer + flash (back pass)
        if(pass==='back' && t===T.DIAMOND){ const h=hash32(x,y); const flash = Math.sin(now*0.006 + (h&1023))*0.5 + 0.5; if(flash>0.8){ const alpha=(flash-0.8)/0.2; ctx.fillStyle='rgba(255,255,255,'+(0.3*alpha)+')'; const cxp=x*TILE+TILE/2, cyp=y*TILE+TILE/2; ctx.fillRect(cxp-1,cyp-1,2,2); ctx.fillRect(cxp-3,cyp,6,1); ctx.fillRect(cxp,cyp-3,1,6); }
          ctx.fillStyle='rgba(255,255,255,'+(0.05+diamondPulse*0.07)+')'; ctx.fillRect(x*TILE,y*TILE,TILE,TILE); }
      }
    }
  };

  MM.grass = grass;
})();
