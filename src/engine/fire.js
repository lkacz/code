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
(function(){
  window.MM = window.MM || {};
  const burning=new Map(); // key "x,y" -> {x,y,left,total,spreadAcc,mobAcc}
  const MAX_BURNING=240;   // hard cap so a forest fire cannot grow unbounded
  const SPREAD_INTERVAL=0.45; // seconds between spread attempts per burning tile
  const SPREAD_CHANCE=0.5;    // per attempt, before per-neighbour filtering
  // 8-neighbourhood; fire prefers climbing (trees burn upward)
  const NEIGHBORS=[[0,-1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[1,1],[-1,1]];

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
  function ignite(x,y,getTile){
    x|=0; y|=0;
    const k=key(x,y);
    if(burning.has(k)) return false;
    if(burning.size>=MAX_BURNING) return false;
    if(!flammableAt(getTile,x,y)) return false;
    if(wetAt(getTile,x,y)) return false;
    const info=INFO[getTile(x,y)];
    const total=Math.max(0.4, info.burnTime||2);
    burning.set(k,{x,y,left:total,total,spreadAcc:Math.random()*SPREAD_INTERVAL,envAcc:Math.random()*0.25});
    return true;
  }
  function burnOut(b,getTile,setTile){
    burning.delete(key(b.x,b.y));
    if(!flammableAt(getTile,b.x,b.y)) return; // tile mined/changed while burning
    setTile(b.x,b.y,T.AIR);
    // Stability + fluids react like after mining
    try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(b.x,b.y); }catch(e){}
    try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(b.x,b.y,getTile); }catch(e){}
    try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst((b.x+0.5)*TILE_PX,(b.y+0.5)*TILE_PX,'common'); }catch(e){}
  }
  function update(getTile,setTile,dt){
    if(lavaSet.size) updateLava(getTile,setTile,dt);
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
            if(Math.random()<p) ignite(nx,ny,getTile);
          } else if((nt===T.SNOW || nt===T.ICE) && Math.random()<0.5){
            try{
              if(MM.water && MM.water.addSource) MM.water.addSource(nx,ny,getTile,setTile);
              else setTile(nx,ny,T.WATER);
              if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(nx,ny);
            }catch(e){}
          }
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
  function drawLava(ctx,TILE,sx,sy,viewX,viewY,getTile,now){
    const GS=glowSprite.width, FH=flameFrames[0].height;
    const igniteTick = now-lastLavaTick>500;
    if(igniteTick) lastLavaTick=now;
    // torch glow strengthens after dark so light sources matter at night
    let night=0.35;
    try{ const cy=MM.background && MM.background.getCycleInfo && MM.background.getCycleInfo(); if(cy) night=cy.isDay? 0.25:0.85; }catch(e){}
    for(let x=sx; x<=sx+viewX+2; x++){
      for(let y=sy; y<=sy+viewY+2; y++){
        const tt=getTile(x,y);
        if(tt===T.TORCH){
          const px=x*TILE, py=y*TILE;
          const flick=Math.sin(now*0.01 + x*5.3)*0.5+0.5;
          // stick + ember head
          ctx.fillStyle='#6e4a22'; ctx.fillRect(px+TILE/2-1.5, py+TILE*0.35, 3, TILE*0.6);
          ctx.fillStyle='#ffd56e'; ctx.fillRect(px+TILE/2-2.5, py+TILE*0.22, 5, 5);
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
        noteLava(x,y); // re-register loaded/visible lava so the flow sim picks it up
        const px=x*TILE, py=y*TILE;
        const flick=Math.sin(now*0.004 + x*2.1 + y*1.7)*0.5+0.5;
        // molten body + crust speckles over the baked tile color
        ctx.fillStyle='rgba(255,140,30,'+(0.25+0.2*flick).toFixed(2)+')';
        ctx.fillRect(px,py,TILE,TILE);
        ctx.globalAlpha=0.5+0.4*flick;
        ctx.drawImage(glowSprite, px+TILE/2-GS/2, py+TILE/2-GS/2);
        // small surface flames where lava meets open air
        if(getTile(x,y-1)===T.AIR){
          const fi=(((now*0.01)|0) + x*5 + y*11) % FRAMES;
          ctx.globalAlpha=0.45+0.25*flick;
          ctx.drawImage(flameFrames[fi<0? fi+FRAMES : fi], px, py-FH+TILE*0.4, TILE, FH*0.7);
        }
        ctx.globalAlpha=1;
        // heat ignites flammable neighbours (organic matter catches from lava)
        if(igniteTick && Math.random()<0.4){
          for(const [dx,dy] of [[0,-1],[1,0],[-1,0],[0,1]]){
            const nInfo=INFO[getTile(x+dx,y+dy)];
            if(nInfo && nInfo.flammable && Math.random()<0.5){ ignite(x+dx,y+dy,getTile); break; }
          }
        }
      }
    }
  }
  function draw(ctx,TILE,sx,sy,viewX,viewY,getTile){
    if(spriteTile!==TILE || !glowSprite) buildSprites(TILE);
    const now=performance.now();
    ctx.save();
    if(typeof getTile==='function') drawLava(ctx,TILE,sx,sy,viewX,viewY,getTile,now);
    if(!burning.size){ ctx.restore(); return; }
    const FH=flameFrames[0].height, GS=glowSprite.width;
    for(const b of burning.values()){
      if(b.x<sx-1||b.x>sx+viewX+2||b.y<sy-1||b.y>sy+viewY+2) continue;
      const px=b.x*TILE, py=b.y*TILE;
      const flick=Math.sin(now*0.02 + b.x*3.7 + b.y*1.3)*0.5+0.5;
      const stage=1-(b.left/b.total); // 0 fresh → 1 burnt
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
  const lavaSet=new Map(); // key -> {x,y,coolT,moveT}
  const MAX_LAVA=400;
  function lavaCoolTime(){ return 40+Math.random()*40; }
  function noteLava(x,y){
    x|=0; y|=0; const k=key(x,y);
    if(lavaSet.has(k) || lavaSet.size>=MAX_LAVA) return;
    lavaSet.set(k,{x,y,coolT:lavaCoolTime(),moveT:Math.random()*0.8});
  }
  // All tile probes (validity, water contact, exposure, flow targets) happen at the
  // tick rate, not per frame: at the 400-tile cap the old per-frame checks cost up
  // to ~120k getTile/s; now ~4k/s. The ≤1.1 s reaction delay is invisible for a
  // viscous fluid. Only the final crust conversion re-validates the tile, so a
  // stale entry can never overwrite something the world changed in between.
  function updateLava(getTile,setTile,dt){
    for(const L of lavaSet.values()){
      const k=key(L.x,L.y);
      L.moveT-=dt;
      if(L.moveT<=0){
        L.moveT=0.55+Math.random()*0.55;  // viscous: far slower than water
        if(getTile(L.x,L.y)!==T.LAVA){ lavaSet.delete(k); continue; }
        // water contact hardens (checked each tick — steam rises from the boundary)
        let watered=false;
        for(const [dx,dy] of [[0,-1],[1,0],[-1,0],[0,1]]){ if(getTile(L.x+dx,L.y+dy)===T.WATER){ watered=true; break; } }
        if(watered){ setTile(L.x,L.y,T.OBSIDIAN); lavaSet.delete(k); continue; }
        let nx=L.x, ny=L.y, moved=false;
        if(getTile(L.x,L.y+1)===T.AIR){ ny=L.y+1; moved=true; }
        else {
          const lFree=getTile(L.x-1,L.y)===T.AIR, rFree=getTile(L.x+1,L.y)===T.AIR;
          const pourL=lFree && getTile(L.x-1,L.y+1)===T.AIR;
          const pourR=rFree && getTile(L.x+1,L.y+1)===T.AIR;
          if(pourL||pourR){ nx=L.x+((pourL&&pourR)? (Math.random()<0.5?-1:1) : (pourL?-1:1)); moved=true; }
          else if(getTile(L.x,L.y-1)===T.LAVA && (lFree||rFree)){ // pressure from above levels the pool
            nx=L.x+((lFree&&rFree)? (Math.random()<0.5?-1:1) : (lFree?-1:1)); moved=true;
          }
        }
        if(moved){
          setTile(L.x,L.y,T.AIR); setTile(nx,ny,T.LAVA);
          try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(L.x,L.y); }catch(e){}
          lavaSet.delete(k);
          lavaSet.set(key(nx,ny),{x:nx,y:ny,coolT:lavaCoolTime(),moveT:0.55+Math.random()*0.55,exposed:false});
          continue;
        }
        L.exposed = getTile(L.x,L.y-1)===T.AIR; // refresh exposure at tick rate
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

  function reset(){ burning.clear(); lavaSet.clear(); }
  function isBurning(x,y){ return burning.has(key(x|0,y|0)); }
  // Put out a single tile (water hose, rain, …) — the tile keeps whatever charring it had
  function extinguish(x,y){ return burning.delete(key(x|0,y|0)); }
  MM.fire={ignite,extinguish,update,draw,reset,isBurning,noteLava,count:()=>burning.size,lavaCount:()=>lavaSet.size};
})();
// ESM export (progressive migration)
export const fire = (typeof window!=='undefined' && window.MM) ? window.MM.fire : undefined;
export default fire;
