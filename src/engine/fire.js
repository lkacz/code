// Tile fire simulation: flammable tiles (grass / wood / leaf — see INFO.flammable
// in constants.js) ignite, burn for their burnTime, spread to flammable neighbours
// and finally burn away to AIR. Used by the flamethrower (engine/weapons.js); any
// future system (lightning, lava) can call ignite() too.
//
// ARCHITECTURE NOTE — why lava lives here and not in water.js:
// water.js is a high-volume wave/pressure sim (springs, caustics, column
// accounting) tuned for thousands of fast cells; lava is a sparse, viscous
// cellular automaton (≤400 player-made cells, one move per ~second) with
// thermal state (cooling → obsidian, water-contact quench, neighbour ignition).
// Folding lava into water.js would couple thermal conversions into that hot
// loop and force its invariants (volume conservation, surface waves) onto a
// fluid that intentionally violates them (it crusts away). The two interact
// only at tile boundaries (LAVA+WATER→OBSIDIAN here; water never enters a LAVA
// cell because it is not T.AIR), so the seam is one conversion rule, not a
// shared engine. Revisit only if lava ever needs waves/pressure of its own.
import { T, INFO, WORLD_H, TILE as TILE_PX } from '../constants.js';
import { reactions as REACTIONS } from './reactions.js';
(function(){
  window.MM = window.MM || {};
  const burning=new Map(); // key "x,y" -> {x,y,left,total,spreadAcc,mobAcc}
  const MAX_BURNING=240;   // hard cap so a forest fire cannot grow unbounded
  const SPREAD_INTERVAL=0.45; // seconds between spread attempts per burning tile
  const SPREAD_CHANCE=0.5;    // per attempt, before per-neighbour filtering
  const TORCH_HEAT_INTERVAL=0.35;
  const TORCH_HEAT_BUDGET=24;
  const BURNING_HOT_AIR_INTERVAL=0.85;
  const LAVA_HOT_AIR_INTERVAL=8.5; // 10% of a burning coal/wood tile's hot-air cadence
  // 8-neighbourhood; fire prefers climbing (trees burn upward)
  const NEIGHBORS=[[0,-1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[1,1],[-1,1]];
  const HEAT_NEIGHBORS=[[0,0],[0,-1],[1,0],[-1,0],[0,1],[1,-1],[-1,-1],[1,1],[-1,1]];

  function key(x,y){ return x+','+y; }
  function flammableAt(getTile,x,y){
    if(y<0||y>=WORLD_H) return false;
    const info=INFO[getTile(x,y)];
    return !!(info && info.flammable);
  }
  function wetAt(getTile,x,y){
    // A tile touching water (or underwater) won't hold a flame
    if(getTile(x,y)===T.WATER) return true;
    return [[0,-1],[1,0],[-1,0],[0,1]].some(([dx,dy])=>getTile(x+dx,y+dy)===T.WATER);
  }
  function thawAt(x,y,getTile,setTile){
    if(typeof getTile!=='function' || typeof setTile!=='function') return false;
    x|=0; y|=0;
    const t=getTile(x,y);
    if(t!==T.SNOW && t!==T.ICE) return false;
    setTile(x,y,T.WATER);
    try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(x,y,getTile); }catch(e){}
    try{ if(MM.water && MM.water.disturb) MM.water.disturb(x,80); }catch(e){}
    try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(x,y); }catch(e){}
    return true;
  }
  function cookAt(x,y,getTile,setTile){
    if(typeof getTile!=='function' || typeof setTile!=='function') return false;
    x|=0; y|=0;
    if(getTile(x,y)!==T.MEAT) return false;
    burning.delete(key(x,y));
    setTile(x,y,T.BAKED_MEAT);
    try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst((x+0.5)*TILE_PX,(y+0.5)*TILE_PX,'common'); }catch(e){}
    return true;
  }
  function applyHeatReaction(x,y,getTile,setTile){
    try{
      return !!(REACTIONS && REACTIONS.apply && REACTIONS.apply('heat',x,y,getTile,setTile));
    }catch(e){ return false; }
  }
  function heatAround(x,y,getTile,setTile,opts){
    opts=opts||{};
    let changed=0;
    const includeCenter=opts.includeCenter!==false;
    for(const [dx,dy] of HEAT_NEIGHBORS){
      if(!includeCenter && dx===0 && dy===0) continue;
      const hx=(x|0)+dx, hy=(y|0)+dy;
      if(applyHeatReaction(hx,hy,getTile,setTile) || thawAt(hx,hy,getTile,setTile) || cookAt(hx,hy,getTile,setTile)) changed++;
    }
    return changed;
  }
  function ignite(x,y,getTile,setTile){
    x|=0; y|=0;
    const k=key(x,y);
    if(burning.has(k)) return false;
    if(getTile(x,y)===T.MEAT && cookAt(x,y,getTile,setTile)) return true;
    if(burning.size>=MAX_BURNING) return false;
    if(!flammableAt(getTile,x,y)) return false;
    if(wetAt(getTile,x,y)) return false;
    const info=INFO[getTile(x,y)];
    const total=Math.max(0.4, info.burnTime||2);
    burning.set(k,{x,y,left:total,total,spreadAcc:Math.random()*SPREAD_INTERVAL,envAcc:Math.random()*0.25,hotAcc:Math.random()*0.8});
    return true;
  }
  function burnOut(b,getTile,setTile){
    burning.delete(key(b.x,b.y));
    if(!flammableAt(getTile,b.x,b.y)) return; // tile mined/changed while burning
    const burntTile=getTile(b.x,b.y);
    if(burntTile===T.MEAT && cookAt(b.x,b.y,getTile,setTile)) return;
    setTile(b.x,b.y,T.AIR);
    // A burned log behaves like a mined log: the unsupported tree section above detaches.
    if(burntTile===T.WOOD){
      try{ if(MM.trees && MM.trees.startTreeFall) MM.trees.startTreeFall(getTile,setTile,1,b.x,b.y-1); }catch(e){}
    }
    // Stability + fluids react like after mining
    try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(b.x,b.y); }catch(e){}
    try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(b.x,b.y,getTile); }catch(e){}
    try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst((b.x+0.5)*TILE_PX,(b.y+0.5)*TILE_PX,'common'); }catch(e){}
  }
  const torchHeat=new Map();
  let torchHeatAcc=0;
  function noteTorch(x,y){
    x|=0; y|=0;
    const k=key(x,y);
    if(!torchHeat.has(k) && torchHeat.size>=1000){
      const first=torchHeat.keys().next();
      if(!first.done) torchHeat.delete(first.value);
    }
    torchHeat.set(k,{x,y});
  }
  function updateTorchHeat(getTile,setTile,dt){
    if(!torchHeat.size) return;
    torchHeatAcc+=dt;
    if(torchHeatAcc<TORCH_HEAT_INTERVAL) return;
    torchHeatAcc=0;
    const batch=[...torchHeat.entries()].slice(0,TORCH_HEAT_BUDGET);
    for(const [k,h] of batch){
      if(getTile(h.x,h.y)!==T.TORCH){ torchHeat.delete(k); continue; }
      heatAround(h.x,h.y,getTile,setTile,{includeCenter:false});
      torchHeat.delete(k);
      torchHeat.set(k,h);
    }
  }
  function update(getTile,setTile,dt){
    if(lavaSet.size) updateLava(getTile,setTile,dt);
    updateTorchHeat(getTile,setTile,dt);
    if(!burning.size) return;
    // Direct Map iteration: JS Maps support delete-during-iteration, and an entry
    // ignited mid-pass just receives its first tick this frame (harmless), so no
    // per-frame snapshot array is needed.
    for(const b of burning.values()){
      // Environment re-check (mined / flooded → flame dies) is throttled: five
      // getTile calls per burning tile per frame added up to ~70k lookups/s at cap
      b.envAcc=(b.envAcc||0)+dt;
      if(b.envAcc>=0.25){
        b.envAcc=0;
        if(!flammableAt(getTile,b.x,b.y) || wetAt(getTile,b.x,b.y)){ burning.delete(key(b.x,b.y)); continue; }
      }
      b.left-=dt;
      if(b.left<=0){ burnOut(b,getTile,setTile); continue; }
      b.hotAcc=(b.hotAcc||0)+dt;
      if(b.hotAcc>=BURNING_HOT_AIR_INTERVAL){
        b.hotAcc=0;
        try{ if(MM.gases && MM.gases.add) MM.gases.add('hot',b.x+0.5,b.y-0.05,{power:0.2,cells:1,getTile,setTile}); }catch(e){}
      }
      // Spread to flammable neighbours; the heat also thaws snow and ice to water
      b.spreadAcc+=dt;
      if(b.spreadAcc>=SPREAD_INTERVAL){
        b.spreadAcc-=SPREAD_INTERVAL;
        if(Math.random()<SPREAD_CHANCE){
          const [dx,dy]=NEIGHBORS[(Math.random()*NEIGHBORS.length)|0];
          // climbing spreads eagerly, sideways/down less so — and grass chains
          // more reluctantly than tree material so a lawn doesn't wipe a biome
          const nx=b.x+dx, ny=b.y+dy;
          const nt=getTile(nx,ny);
          const nInfo=INFO[nt];
          if(nInfo && nInfo.flammable){
            let p = dy<0? 0.95 : (dy===0? 0.6 : 0.35);
            if(nt===T.GRASS) p*=0.3; // grass chains reluctantly — fire favours trees
            if(Math.random()<p) ignite(nx,ny,getTile,setTile);
          } else if((nt===T.SNOW || nt===T.ICE) && Math.random()<0.5) thawAt(nx,ny,getTile,setTile);
        }
      }
      // (Creatures catching fire from tiles: mobs.js polls MM.fire.isBurning —
      // O(mobs) Map lookups instead of this loop scanning all mobs per tile.)
    }
  }
  // --- Pre-rendered flame sprites: gradient allocation per tile per frame caused
  // GC churn at the 240-tile cap (4 gradients × 240 × 60fps ≈ 58k allocs/s), so the
  // tongues and glow are baked once into small canvases and stamped with drawImage.
  let spriteTile=0; const flameFrames=[]; let glowSprite=null; const FRAMES=6;
  function buildSprites(TILE){
    spriteTile=TILE; flameFrames.length=0;
    const FH=Math.ceil(TILE*1.6); // flames can rise above the tile
    for(let f=0; f<FRAMES; f++){
      const c=document.createElement('canvas'); c.width=TILE; c.height=FH;
      const g=c.getContext('2d');
      const phase=(f/FRAMES)*Math.PI*2;
      const flick=Math.sin(phase)*0.5+0.5;
      for(let i=0;i<3;i++){
        const fx=TILE*(0.2+0.3*i) + Math.sin(phase+i*2.1)*2;
        const h=TILE*(0.5+0.45*flick)*(0.7+0.3*Math.sin(phase*1.3+i*1.7));
        const w=TILE*0.22;
        const grd=g.createLinearGradient(fx,FH,fx,FH-h);
        grd.addColorStop(0,'rgba(255,120,20,0.85)');
        grd.addColorStop(0.6,'rgba(255,200,60,0.7)');
        grd.addColorStop(1,'rgba(255,255,180,0)');
        g.fillStyle=grd;
        g.beginPath();
        g.moveTo(fx-w/2,FH);
        g.quadraticCurveTo(fx-w*0.2,FH-h*0.5,fx,FH-h);
        g.quadraticCurveTo(fx+w*0.2,FH-h*0.5,fx+w/2,FH);
        g.closePath(); g.fill();
      }
      flameFrames.push(c);
    }
    const GS=Math.ceil(TILE*2.2);
    glowSprite=document.createElement('canvas'); glowSprite.width=glowSprite.height=GS;
    const gg=glowSprite.getContext('2d');
    const rg=gg.createRadialGradient(GS/2,GS/2,2,GS/2,GS/2,GS/2);
    rg.addColorStop(0,'rgba(255,150,40,0.30)');
    rg.addColorStop(1,'rgba(255,150,40,0)');
    gg.fillStyle=rg; gg.fillRect(0,0,GS,GS);
  }
  // Lava behavior is tile-derived (no registry, so it survives world save/load):
  // the visible viewport is scanned each frame — same pattern as the chest-aura
  // pass in main.js — for glow, surface shimmer, and periodic neighbour ignition.
  let lastLavaTick=0;
  let lastLavaWakeTick=-Infinity;
  let lastSmokeTick=-Infinity;
  const smokeEmissionBuckets=new Map();
  function smokeHash(x,y,bucket){
    const v=Math.sin(x*127.1 + y*311.7 + bucket*43.3)*43758.5453;
    return v-Math.floor(v);
  }
  function shouldEmitSmoke(x,y,now,period,chance){
    const phase=smokeHash(x,y,0)*period;
    const bucket=Math.floor((now+phase)/period);
    const k=key(x,y);
    if(smokeEmissionBuckets.get(k)===bucket) return false;
    smokeEmissionBuckets.set(k,bucket);
    if(smokeEmissionBuckets.size>1200){
      const first=smokeEmissionBuckets.keys().next();
      if(!first.done) smokeEmissionBuckets.delete(first.value);
    }
    return smokeHash(x,y,bucket)<chance;
  }
  function emitBlackSmoke(x,y,TILE,intensity,tileX,tileY){
    try{
      const p=MM.particles;
      if(!p || !p.spawnSmoke) return;
      p.spawnSmoke((x+0.5)*TILE, y*TILE+TILE*0.15, intensity||1, {tileSize:TILE, tileX, tileY});
    }catch(e){}
  }
  function volcanoSmokePower(x,y){
    try{
      const wg=MM.worldGen;
      if(!wg || !wg.volcanoAt) return 1;
      const v=wg.volcanoAt(x);
      if(!v) return 1;
      const surface=wg.surfaceHeight ? wg.surfaceHeight(x) : y;
      if(Math.abs(x-v.center)<=v.crater+1 && y<=surface+1) return 3.2;
    }catch(e){}
    return 1;
  }
  function drawLava(ctx,TILE,sx,sy,viewX,viewY,getTile,now,visibility,smokeTick){
    const GS=glowSprite.width, FH=flameFrames[0].height;
    const igniteTick = now-lastLavaTick>500;
    if(igniteTick) lastLavaTick=now;
    const frameMs=(typeof window!=='undefined' && Number.isFinite(window.__mmFrameMs)) ? window.__mmFrameMs : 16;
    const stressed=frameMs>18, critical=frameMs>32;
    let glowBudget=critical?54:(stressed?115:260);
    let flameBudget=critical?24:(stressed?52:112);
    let wakeBudget=critical?10:(stressed?26:58);
    let smokeBudget=critical?5:(stressed?12:26);
    let frontierProbeBudget=critical?90:(stressed?190:420);
    let flameProbeBudget=critical?90:(stressed?190:420);
    const wakeTick = now-lastLavaWakeTick>460;
    if(wakeTick) lastLavaWakeTick=now;
    const openForLava=t=>lavaOpenTile(t);
    const canSee = visibility && typeof visibility.visible==='function' ? visibility.visible : null;
    const canRemember = visibility && typeof visibility.seen==='function' ? visibility.seen : canSee;
    const revealAll = !!(visibility && visibility.revealAll);
    const visibleTile = (x,y)=>revealAll || !canSee || canSee(x,y);
    const rememberedTile = (x,y)=>revealAll || !canRemember || canRemember(x,y);
    // torch glow strengthens after dark so light sources matter at night
    let night=0.35;
    try{ const cy=MM.background && MM.background.getCycleInfo && MM.background.getCycleInfo(); if(cy) night=cy.isDay? 0.25:0.85; }catch(e){}
    for(let x=sx; x<=sx+viewX+2; x++){
      for(let y=sy; y<=sy+viewY+2; y++){
        const tt=getTile(x,y);
        if(tt===T.TORCH){
          if(!rememberedTile(x,y)) continue;
          noteTorch(x,y);
          const px=x*TILE, py=y*TILE;
          const flick=Math.sin(now*0.01 + x*5.3)*0.5+0.5;
          // stick + ember head
          ctx.fillStyle='#6e4a22'; ctx.fillRect(px+TILE/2-1.5, py+TILE*0.35, 3, TILE*0.6);
          ctx.fillStyle='#ffd56e'; ctx.fillRect(px+TILE/2-2.5, py+TILE*0.22, 5, 5);
          if(!visibleTile(x,y)) continue;
          // small flame + radial glow (baked sprites)
          const fi=(((now*0.012)|0)+x*7)%FRAMES;
          ctx.globalAlpha=0.8;
          ctx.drawImage(flameFrames[fi<0?fi+FRAMES:fi], px+TILE*0.25, py-FH*0.45+TILE*0.25, TILE*0.5, FH*0.5);
          ctx.globalAlpha=(0.5+0.3*flick)*night*1.6;
          const gs=GS*2.4;
          ctx.drawImage(glowSprite, px+TILE/2-gs/2, py+TILE*0.3-gs/2, gs, gs);
          ctx.globalAlpha=1;
          continue;
        }
        if(tt!==T.LAVA) continue;
        if(!visibleTile(x,y)) continue;
        let aboveT=T.STONE, belowT=T.STONE, leftT=T.STONE, rightT=T.STONE, frontier=false;
        const ignitionRoll=igniteTick && Math.random()<0.4;
        const wantFlameProbe=flameBudget>0 || (smokeTick && smokeBudget>0);
        const needFrontierProbe=frontierProbeBudget>0 && ((wakeTick && wakeBudget>0) || glowBudget>0);
        const needFlameProbe=wantFlameProbe && (needFrontierProbe || flameProbeBudget>0);
        if(needFlameProbe || needFrontierProbe) aboveT=getTile(x,y-1);
        if(needFlameProbe && !needFrontierProbe) flameProbeBudget--;
        if(needFrontierProbe){
          frontierProbeBudget--;
          belowT=getTile(x,y+1);
          leftT=getTile(x-1,y);
          rightT=getTile(x+1,y);
          frontier=openForLava(aboveT) || openForLava(belowT) || openForLava(leftT) || openForLava(rightT);
        } else if(aboveT===T.AIR){
          frontier=true;
        }
        if(frontier && wakeTick && wakeBudget-->0){
          noteLava(x,y,{fast:belowT===T.AIR, priority:aboveT===T.AIR || belowT===T.AIR || leftT===T.AIR || rightT===T.AIR});
        }
        const px=x*TILE, py=y*TILE;
        const flick=Math.sin(now*0.004 + x*2.1 + y*1.7)*0.5+0.5;
        // molten body + crust speckles over the baked tile color
        ctx.fillStyle='rgba(255,140,30,'+(0.25+0.2*flick).toFixed(2)+')';
        ctx.fillRect(px,py,TILE,TILE);
        if((frontier || (!stressed && ((x+y)&3)===0)) && glowBudget-->0){
          ctx.globalAlpha=0.5+0.4*flick;
          ctx.drawImage(glowSprite, px+TILE/2-GS/2, py+TILE/2-GS/2);
        }
        // small surface flames where lava meets open air
        if(aboveT===T.AIR && flameBudget-->0 && (!critical || ((x+y)&1)===0)){
          const fi=(((now*0.01)|0) + x*5 + y*11) % FRAMES;
          ctx.globalAlpha=0.45+0.25*flick;
          ctx.drawImage(flameFrames[fi<0? fi+FRAMES : fi], px, py-FH+TILE*0.4, TILE, FH*0.7);
          if(smokeTick && smokeBudget-->0){
            const vp=volcanoSmokePower(x,y);
            const perfMul=critical?0.30:(stressed?0.55:1);
            const lavaLoad=lavaSet.size;
            const loadMul=lavaLoad>440?0.35:(lavaLoad>260?0.58:1);
            const chance=Math.min(0.80, vp>1 ? 0.56*perfMul*loadMul : 0.16*perfMul*loadMul);
            const period=vp>1 ? 680 : 1120;
            if(shouldEmitSmoke(x,y,now,period,chance)) emitBlackSmoke(x,y,TILE,vp>1?vp:1.1,x,y);
          }
        }
        ctx.globalAlpha=1;
        // heat ignites flammable neighbours (organic matter catches from lava)
        if(ignitionRoll){
          for(const [dx,dy] of [[0,-1],[1,0],[-1,0],[0,1]]){
            const nInfo=INFO[getTile(x+dx,y+dy)];
            if(nInfo && nInfo.flammable && Math.random()<0.5){ ignite(x+dx,y+dy,getTile); break; }
          }
        }
      }
    }
  }
  function draw(ctx,TILE,sx,sy,viewX,viewY,getTile,visibility){
    if(spriteTile!==TILE || !glowSprite) buildSprites(TILE);
    const now=performance.now();
    const smokeTick = now-lastSmokeTick>130;
    if(smokeTick) lastSmokeTick=now;
    const canSee = visibility && typeof visibility.visible==='function' ? visibility.visible : null;
    const revealAll = !!(visibility && visibility.revealAll);
    const visibleTile = (x,y)=>revealAll || !canSee || canSee(x,y);
    ctx.save();
    if(typeof getTile==='function') drawLava(ctx,TILE,sx,sy,viewX,viewY,getTile,now,visibility,smokeTick);
    if(!burning.size){ ctx.restore(); return; }
    const FH=flameFrames[0].height, GS=glowSprite.width;
    for(const b of burning.values()){
      if(b.x<sx-1||b.x>sx+viewX+2||b.y<sy-1||b.y>sy+viewY+2) continue;
      if(!visibleTile(b.x,b.y)) continue;
      const px=b.x*TILE, py=b.y*TILE;
      const flick=Math.sin(now*0.02 + b.x*3.7 + b.y*1.3)*0.5+0.5;
      const stage=1-(b.left/b.total); // 0 fresh → 1 burnt
      if(smokeTick && Math.random()<0.42){
        const bt=getTile(b.x,b.y);
        const power=bt===T.COAL ? 2.15 : (bt===T.WOOD ? 1.55 : (bt===T.LEAF ? 1.0 : 0.7));
        emitBlackSmoke(b.x,b.y,TILE,power,b.x,b.y);
      }
      // charring overlay
      ctx.fillStyle='rgba(20,12,8,'+(0.25+stage*0.45).toFixed(2)+')';
      ctx.fillRect(px,py,TILE,TILE);
      // glow (baked radial sprite, alpha-flickered)
      ctx.globalAlpha=0.6+0.4*flick;
      ctx.drawImage(glowSprite, px+TILE/2-GS/2, py+TILE/2-GS/2);
      // flame tongues: cycle baked frames, de-synced per tile
      const fi=(((now*0.012)|0) + b.x*7 + b.y*13) % FRAMES;
      ctx.globalAlpha=0.85+0.15*flick;
      ctx.drawImage(flameFrames[fi<0? fi+FRAMES : fi], px, py+TILE-FH);
      ctx.globalAlpha=1;
      // sparks
      if(((now*0.01+b.x*7+b.y*13)|0)%5===0){
        ctx.fillStyle='rgba(255,220,120,0.9)';
        ctx.fillRect(px+TILE*0.3+flick*6, py+TILE*0.2 - flick*5, 2,2);
      }
    }
    ctx.restore();
  }
  // --- Lava as a viscous fluid -------------------------------------------------
  // Registry-driven: weapons.js notes freshly melted tiles, and the viewport scan
  // in drawLava() re-registers any lava it sees, so flow resumes after a reload.
  // Rules per (slow) tick: harden on water contact; fall into air; pour over an
  // edge; spread sideways only under the pressure of lava above (so puddles rest
  // instead of smearing one tile thin). Settled lava exposed to open air slowly
  // crusts into obsidian.
  const lavaSet=new Map(); // key -> {x,y,coolT,moveT,pressure,source}
  const MAX_LAVA=560;
  const LAVA_MOVE_BUDGET=64;
  const LAVA_MOVE_BUDGET_LOW_FPS=28;
  const LAVA_MOVE_BUDGET_CRITICAL=10;
  const LAVA_LEVEL_PRESSURE=0.32;
  function lavaCoolTime(){ return 40+Math.random()*40; }
  function lavaMoveDelay(pressurized){
    return pressurized ? (1.10+Math.random()*0.85) : (2.20+Math.random()*1.80);
  }
  function lavaWakeDelay(pressurized){
    return pressurized ? (0.78+Math.random()*0.48) : (1.15+Math.random()*0.70);
  }
  function sourceClonePause(horizontal){
    return horizontal ? (1.20+Math.random()*0.70) : (0.90+Math.random()*0.55);
  }
  function lavaMoveBudget(){
    const ms=(typeof window!=='undefined' && Number.isFinite(window.__mmFrameMs)) ? window.__mmFrameMs : 16;
    return ms>32 ? LAVA_MOVE_BUDGET_CRITICAL : (ms>18 ? LAVA_MOVE_BUDGET_LOW_FPS : LAVA_MOVE_BUDGET);
  }
  function lavaHotAirBudget(){
    const ms=(typeof window!=='undefined' && Number.isFinite(window.__mmFrameMs)) ? window.__mmFrameMs : 16;
    return ms>32 ? 2 : (ms>18 ? 5 : 12);
  }
  function lavaOpenTile(t){
    return t===T.AIR || t===T.WATER || t===T.TORCH || t===T.GRAVE || (INFO[t] && INFO[t].gas);
  }
  function emitLavaHotAir(L,getTile,setTile){
    if(!L || typeof getTile!=='function' || typeof setTile!=='function') return 0;
    if(getTile(L.x,L.y)!==T.LAVA) return 0;
    if(!lavaOpenTile(getTile(L.x,L.y-1))) return 0;
    try{
      if(MM.gases && MM.gases.add) return MM.gases.add('hot',L.x+0.5,L.y-0.05,{power:0.2,cells:1,getTile,setTile});
    }catch(e){}
    return 0;
  }
  function lavaTouchesWater(L,getTile){
    for(const [dx,dy] of [[0,-1],[1,0],[-1,0],[0,1]]){
      if(getTile(L.x+dx,L.y+dy)===T.WATER) return true;
    }
    return false;
  }
  function volcanoAtTile(x){
    try{
      const wg=MM.worldGen;
      return wg && wg.volcanoAt ? wg.volcanoAt(Math.round(x)) : null;
    }catch(e){ return null; }
  }
  function volcanicTile(x,y){
    const v=volcanoAtTile(x);
    if(!v) return false;
    try{
      const wg=MM.worldGen;
      const surf=wg && wg.surfaceHeight ? wg.surfaceHeight(Math.round(x)) : 0;
      return y>=surf-2;
    }catch(e){ return true; }
  }
  function magmaSourceTile(x,y){
    const v=volcanoAtTile(x);
    if(!v) return false;
    try{
      const wg=MM.worldGen;
      const surf=wg && wg.surfaceHeight ? wg.surfaceHeight(Math.round(x)) : 0;
      const d=Math.abs(Math.round(x)-(v.center||0));
      if(d<=(v.pipe||1) && y>=surf && y<WORLD_H-3) return true;
      if(d<=(v.reservoir||0) && y>=WORLD_H-9 && y<WORLD_H-3) return true;
    }catch(e){}
    return false;
  }
  function evictDormantLava(){
    for(const [k,L] of lavaSet.entries()){
      if(!L.source && !(L.pressure>0)){ lavaSet.delete(k); return true; }
    }
    return false;
  }
  function evictNonSourceLava(){
    if(evictDormantLava()) return true;
    for(const [k,L] of lavaSet.entries()){
      if(!L.source){ lavaSet.delete(k); return true; }
    }
    return false;
  }
  function setLavaEntry(x,y,opts){
    x|=0; y|=0; const k=key(x,y);
    opts=opts||{};
    const pressure=opts.pressure ? Math.max(0, Math.min(1, opts.pressure===true?1:opts.pressure)) : 0;
    const source=!!opts.source || magmaSourceTile(x,y);
    const old=lavaSet.get(k);
    if(old){
      if(pressure) old.pressure=Math.max(old.pressure||0, pressure);
      if(opts.fast){
        const wake=lavaWakeDelay((old.pressure||0)>0.03 || pressure>0);
        if(!Number.isFinite(old.moveT) || old.moveT>wake) old.moveT=wake;
      }
      if(source) old.source=true;
      return old;
    }
    if(lavaSet.size>=MAX_LAVA){
      const important=source || pressure || opts.priority || opts.fast;
      if(!important || !evictNonSourceLava()) return null;
    }
    const entry={x,y,coolT:lavaCoolTime(),moveT:opts.fast?lavaWakeDelay(pressure>0.03):(Math.random()*lavaMoveDelay(pressure>0.03)),hotT:Number.isFinite(opts.hotT)?Math.max(0,opts.hotT):Math.random()*LAVA_HOT_AIR_INTERVAL,pressure,source};
    lavaSet.set(k,entry);
    return entry;
  }
  function noteLava(x,y,opts){
    return setLavaEntry(x,y,opts);
  }
  function wakeLavaAround(x,y,getTile,opts){
    if(typeof getTile!=='function') return 0;
    opts=opts||{};
    x|=0; y|=0;
    let adjacentLava=false;
    for(const [dx,dy] of [[0,-1],[1,0],[-1,0],[0,1],[1,-1],[-1,-1],[1,1],[-1,1]]){
      if(getTile(x+dx,y+dy)===T.LAVA){ adjacentLava=true; break; }
    }
    if(!adjacentLava) return 0;
    const inVolcano=!!(opts.volcano || volcanicTile(x,y));
    const r=Math.max(2, Math.min(28, opts.radius || (inVolcano?18:5)));
    let woke=0;
    for(let dy=-r; dy<=r; dy++){
      for(let dx=-r; dx<=r; dx++){
        if(dx*dx+dy*dy>r*r) continue;
        const lx=x+dx, ly=y+dy;
        if(getTile(lx,ly)!==T.LAVA) continue;
        if(!scanOpenToLava(getTile,lx,ly) && (Math.abs(dx)>2 || Math.abs(dy)>5)) continue;
        const pressured=inVolcano || volcanicTile(lx,ly);
        if(setLavaEntry(lx,ly,{fast:true,pressure:pressured?1:0})) woke++;
      }
    }
    return woke;
  }
  function scanOpenToLava(getTile,x,y){
    for(const [dx,dy] of [[0,-1],[1,0],[-1,0],[0,1]]){
      const t=getTile(x+dx,y+dy);
      if(t===T.AIR || t===T.TORCH || t===T.GRAVE || (INFO[t] && INFO[t].gas)) return true;
    }
    return false;
  }
  function wakeVolcanoLeaksNear(px,py,getTile,opts){
    if(typeof getTile!=='function') return 0;
    opts=opts||{};
    const readTile = typeof opts.peekTile==='function'
      ? ((x,y)=>opts.peekTile(x,y,T.STONE))
      : getTile;
    const tx=Math.floor(px), ty=Math.floor(py);
    const rx=Math.max(8, Math.min(72, opts.rx||56));
    const ry=Math.max(8, Math.min(52, opts.ry||38));
    const colVolcano=new Map();
    const colSurface=new Map();
    const volcanoAtX=(x)=>{
      x|=0;
      if(colVolcano.has(x)) return colVolcano.get(x);
      const v=volcanoAtTile(x) || false;
      colVolcano.set(x,v);
      return v;
    };
    const surfaceAtX=(x)=>{
      x|=0;
      if(colSurface.has(x)) return colSurface.get(x);
      let s=0;
      try{ const wg=MM.worldGen; s=wg && wg.surfaceHeight ? wg.surfaceHeight(x) : 0; }catch(e){}
      colSurface.set(x,s);
      return s;
    };
    let anyVolcano=false;
    const sampleStep=Math.max(2, Math.floor(rx/10));
    for(let x=tx-rx; x<=tx+rx; x+=sampleStep){ if(volcanoAtX(x)){ anyVolcano=true; break; } }
    if(!anyVolcano) return 0;
    if(ty < surfaceAtX(tx)-1) return 0;
    let woke=0;
    for(let y=Math.max(0,ty-ry); y<=Math.min(WORLD_H-1,ty+ry); y++){
      for(let x=tx-rx; x<=tx+rx; x++){
        if(readTile(x,y)!==T.LAVA) continue;
        const v=volcanoAtX(x);
        if(!v || y<surfaceAtX(x)-2) continue;
        if(!scanOpenToLava(readTile,x,y)) continue;
        if(setLavaEntry(x,y,{fast:true,pressure:1})) woke++;
        // Wake a short slice of the conduit so the breach is fed by pressure, even
        // if the saved chunk's lava was not previously in the sparse simulation.
        for(let dy=-5; dy<=5; dy++){
          if(dy && readTile(x,y+dy)===T.LAVA && setLavaEntry(x,y+dy,{fast:true,pressure:1})) woke++;
        }
        for(let dx=-2; dx<=2; dx++){
          if(dx && readTile(x+dx,y)===T.LAVA && setLavaEntry(x+dx,y,{fast:true,pressure:1})) woke++;
        }
      }
    }
    return woke;
  }
  // All tile probes (validity, water contact, exposure, flow targets) happen at the
  // tick rate, not per frame: at the 400-tile cap the old per-frame checks cost up
  // to ~120k getTile/s; now ~4k/s. The ≤1.1 s reaction delay is invisible for a
  // viscous fluid. Only the final crust conversion re-validates the tile, so a
  // stale entry can never overwrite something the world changed in between.
  function updateLava(getTile,setTile,dt){
    let moveBudget=lavaMoveBudget();
    let hotAirBudget=lavaHotAirBudget();
    const entries=[...lavaSet.entries()];
    for(const [k,L] of entries){
      if(lavaSet.get(k)!==L) continue;
      L.waterT=(L.waterT==null?Math.random()*0.12:L.waterT)-dt;
      if(L.waterT<=0){
        L.waterT=0.22+Math.random()*0.12;
        if(getTile(L.x,L.y)!==T.LAVA){ lavaSet.delete(k); continue; }
        if(lavaTouchesWater(L,getTile)){ setTile(L.x,L.y,T.OBSIDIAN); lavaSet.delete(k); continue; }
      }
      L.hotT=(L.hotT==null?Math.random()*LAVA_HOT_AIR_INTERVAL:L.hotT)-dt;
      if(L.hotT<=0){
        L.hotT=LAVA_HOT_AIR_INTERVAL*(0.85+Math.random()*0.30);
        if(hotAirBudget>0 && emitLavaHotAir(L,getTile,setTile)>0) hotAirBudget--;
      }
      const source=!!L.source;
      if(L.pressure>0 && !source) L.pressure=Math.max(0,L.pressure-dt*0.10);
      const pressureLevel=L.pressure||0;
      const pressure=pressureLevel>0.03;
      L.moveT-=dt;
      if(L.moveT<=0){
        if(moveBudget--<=0){ L.moveT=0.025; continue; }
        L.moveT=lavaMoveDelay(pressure);  // viscous normally; volcano leaks react fast
        if(getTile(L.x,L.y)!==T.LAVA){ lavaSet.delete(k); continue; }
        // water contact hardens (checked each tick — steam rises from the boundary)
        if(lavaTouchesWater(L,getTile)){ setTile(L.x,L.y,T.OBSIDIAN); lavaSet.delete(k); continue; }
        let nx=L.x, ny=L.y, moved=false, clone=false;
        const belowT=getTile(L.x,L.y+1);
        if(lavaOpenTile(belowT)){ ny=L.y+1; moved=true; }
        else {
          const lFree=lavaOpenTile(getTile(L.x-1,L.y)), rFree=lavaOpenTile(getTile(L.x+1,L.y));
          const pourL=lFree && lavaOpenTile(getTile(L.x-1,L.y+1));
          const pourR=rFree && lavaOpenTile(getTile(L.x+1,L.y+1));
          const aboveT=getTile(L.x,L.y-1);
          const roofed=!lavaOpenTile(aboveT);
          const canLevel=pressureLevel>=LAVA_LEVEL_PRESSURE && (roofed || aboveT===T.LAVA);
          const levelL=canLevel && lFree && !lavaOpenTile(getTile(L.x-1,L.y+1));
          const levelR=canLevel && rFree && !lavaOpenTile(getTile(L.x+1,L.y+1));
          if(pourL||pourR){ nx=L.x+((pourL&&pourR)? (Math.random()<0.5?-1:1) : (pourL?-1:1)); moved=true; }
          else if(levelL||levelR){ nx=L.x+((levelL&&levelR)? (Math.random()<0.5?-1:1) : (levelL?-1:1)); moved=true; clone=source && roofed; }
          else if(aboveT===T.LAVA && (lFree||rFree) && roofed){ // pressure from above levels enclosed pools
            nx=L.x+((lFree&&rFree)? (Math.random()<0.5?-1:1) : (lFree?-1:1)); moved=true;
          }
        }
        if(moved){
          const horizontal=nx!==L.x && ny===L.y;
          clone = clone || (source && (!horizontal || !lavaOpenTile(getTile(L.x,L.y-1))));
          if(!clone){
            setTile(L.x,L.y,T.AIR);
            try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(L.x,L.y); }catch(e){}
            lavaSet.delete(k);
          }
          setTile(nx,ny,T.LAVA);
          const decay=source ? (horizontal?0.78:0.88) : (horizontal?0.68:0.72);
          const nextPressure=pressure ? pressureLevel*decay : 0;
          setLavaEntry(nx,ny,{pressure:nextPressure,priority:nextPressure>=0.45});
          if(source && clone) L.moveT=Math.max(L.moveT, sourceClonePause(horizontal));
          continue;
        }
        L.exposed = lavaOpenTile(getTile(L.x,L.y-1)); // refresh exposure at tick rate
      }
      // settled and exposed to open air → the crust slowly forms
      if(L.exposed){
        L.coolT-=dt;
        if(L.coolT<=0){
          if(getTile(L.x,L.y)===T.LAVA) setTile(L.x,L.y,T.OBSIDIAN); // re-validate before converting
          lavaSet.delete(k);
        }
      }
    }
  }

  function reset(){ burning.clear(); lavaSet.clear(); torchHeat.clear(); torchHeatAcc=0; lastSmokeTick=-Infinity; smokeEmissionBuckets.clear(); }
  function isBurning(x,y){ return burning.has(key(x|0,y|0)); }
  // Put out a single tile (water hose, rain, …) — the tile keeps whatever charring it had
  function extinguish(x,y){ return burning.delete(key(x|0,y|0)); }
  MM.fire={ignite,extinguish,update,draw,reset,isBurning,thawAt,cookAt,heatAround,noteTorch,noteLava,wakeLavaAround,wakeVolcanoLeaksNear,count:()=>burning.size,lavaCount:()=>lavaSet.size};
})();
// ESM export (progressive migration)
export const fire = (typeof window!=='undefined' && window.MM) ? window.MM.fire : undefined;
export default fire;
