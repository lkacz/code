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
import { T, INFO, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y, TILE as TILE_PX, thawedEarthVariant, isFrozenEarth } from '../constants.js';
import { isLavaExposureOpenTile, isLavaVentOpenTile } from './material_physics.js';
import { reactions as REACTIONS } from './reactions.js';
import { getFlamePuffSprites, flamePuffFrame, flamePuffAlpha, flamePuffRadius } from './flame_fx.js';
import { authoritativeBodyBlocksCell } from './body_footprint.js';
(function(){
  window.MM = window.MM || {};
  const burning=new Map(); // key "x,y" -> {x,y,left,total,spreadAcc,mobAcc}
  const MAX_BURNING=240;   // hard cap so a forest fire cannot grow unbounded
  const SPREAD_INTERVAL=0.45; // seconds between spread attempts per burning tile
  const SPREAD_CHANCE=0.5;    // per attempt, before per-neighbour filtering
  const TORCH_HEAT_INTERVAL=0.35;
  const TORCH_HEAT_BUDGET=24;
  const TORCH_SMOKE_RATE=0.018;   // roughly 3.5% of a burning coal block
  const TORCH_SMOKE_PACKET=0.028; // small but above smoke's minimum density
  const BURNING_HOT_AIR_INTERVAL=0.85;
  const LAVA_HOT_AIR_INTERVAL=8.5; // 10% of a burning coal/wood tile's hot-air cadence
  // 8-neighbourhood; fire prefers climbing (trees burn upward)
  const NEIGHBORS=[[0,-1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[1,1],[-1,1]];
  const HEAT_NEIGHBORS=[[0,0],[0,-1],[1,0],[-1,0],[0,1],[1,-1],[-1,-1],[1,1],[-1,1]];
  const COMBUSTION_FACES=[[0,-1],[1,0],[0,1],[-1,0]];
  const WORLD_TOP = Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;

  function key(x,y){ return x+','+y; }
  function finiteTile(_x,y){ return Number.isFinite(y) && y>=WORLD_TOP && y<WORLD_BOTTOM; }
  function flammableAt(getTile,x,y){
    if(!finiteTile(x,y)) return false;
    const info=INFO[getTile(x,y)];
    return !!(info && info.flammable);
  }
  function wetAt(getTile,x,y){
    // A tile touching water (or underwater) won't hold a flame
    if(getTile(x,y)===T.WATER) return true;
    return [[0,-1],[1,0],[-1,0],[0,1]].some(([dx,dy])=>getTile(x+dx,y+dy)===T.WATER);
  }
  function coalHasAirAccess(getTile,x,y){
    // Fire needs an exposed face. Diagonal pockets do not ventilate a solid
    // seam, and another coal block remains fuel/rock rather than free space.
    return COMBUSTION_FACES.some(([dx,dy])=>isLavaVentOpenTile(getTile(x+dx,y+dy)));
  }
  function spreadInMultiplier(info){
    const v=info && Number.isFinite(info.spreadInMult) ? info.spreadInMult : 1;
    return Math.max(0,v);
  }
  function thawAt(x,y,getTile,setTile){
    if(typeof getTile!=='function' || typeof setTile!=='function') return false;
    x|=0; y|=0;
    if(!finiteTile(x,y)) return false;
    const t=getTile(x,y);
    // Snow-dusted turf dries back to plain grass (no meltwater in a thin cover)
    if(t===T.GRASS_SNOW){
      setTile(x,y,T.GRASS);
      return true;
    }
    // Permafrost unbinds into its diggable base soil
    const thawed=thawedEarthVariant(t);
    if(thawed!=null){
      setTile(x,y,thawed);
      try{ if(MM.fallingSolids && MM.fallingSolids.afterPlacement) MM.fallingSolids.afterPlacement(x,y); }catch(e){}
      return true;
    }
    if(t!==T.SNOW && t!==T.ICE && t!==T.TOXIC_SNOW) return false;
    setTile(x,y,T.WATER);
    try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(x,y,getTile); }catch(e){}
    // toxic snowpack never melts clean: the meltwater carries the contamination
    if(t===T.TOXIC_SNOW){
      try{ if(MM.water && MM.water.polluteAt) MM.water.polluteAt(x,y,getTile,setTile,{source:'toxic_snow'}); }catch(e){}
    }
    try{ if(MM.water && MM.water.disturb) MM.water.disturb(x,80); }catch(e){}
    try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(x,y); }catch(e){}
    return true;
  }
  function cookAt(x,y,getTile,setTile){
    if(typeof getTile!=='function' || typeof setTile!=='function') return false;
    x|=0; y|=0;
    if(!finiteTile(x,y)) return false;
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
    const tile=getTile(x,y);
    if(tile===T.MEAT && cookAt(x,y,getTile,setTile)) return true;
    if(burning.size>=MAX_BURNING) return false;
    const info=INFO[tile];
    if(!finiteTile(x,y) || !(info && info.flammable)) return false;
    if(wetAt(getTile,x,y)) return false;
    if(tile===T.COAL && !coalHasAirAccess(getTile,x,y)) return false;
    const total=Math.max(0.4, info.burnTime||2);
    burning.set(k,{x,y,left:total,total,fuel:tile,spreadAcc:Math.random()*SPREAD_INTERVAL,envAcc:Math.random()*0.25,hotAcc:Math.random()*0.8,smokeAcc:Math.random()*0.18});
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
  const torchBatchScratch=[]; // reused per-tick key/value snapshot for the rotating budget slice
  let torchHeatAcc=0;
  let torchRuntime=0;
  function noteTorch(x,y){
    x|=0; y|=0;
    const k=key(x,y);
    const known=torchHeat.get(k);
    if(known){ known.x=x; known.y=y; return; }
    if(!torchHeat.has(k) && torchHeat.size>=1000){
      const first=torchHeat.keys().next();
      if(!first.done) torchHeat.delete(first.value);
    }
    // Coordinate staggering prevents a row of torches from puffing in unison.
    const phase=((Math.imul(x,73856093)^Math.imul(y,19349663))>>>0)/4294967296;
    torchHeat.set(k,{x,y,smokeAcc:phase*TORCH_SMOKE_PACKET,smokeAt:torchRuntime});
  }
  function updateTorchHeat(getTile,setTile,dt){
    torchRuntime+=dt;
    if(!torchHeat.size) return;
    torchHeatAcc+=dt;
    if(torchHeatAcc<TORCH_HEAT_INTERVAL) return;
    torchHeatAcc=0;
    // first-N slice without spreading the whole Map (it retains every torch the
    // player has ever seen, up to its 1000 cap; only 24 are processed per tick)
    torchBatchScratch.length=0;
    for(const k of torchHeat.keys()){
      if(torchBatchScratch.length>=TORCH_HEAT_BUDGET*2) break;
      torchBatchScratch.push(k,torchHeat.get(k));
    }
    for(let si=0; si<torchBatchScratch.length; si+=2){
      const k=torchBatchScratch[si], h=torchBatchScratch[si+1];
      if(getTile(h.x,h.y)!==T.TORCH){ torchHeat.delete(k); continue; }
      heatAround(h.x,h.y,getTile,setTile,{includeCenter:false});
      const elapsed=Math.max(0,Math.min(5,torchRuntime-(Number.isFinite(h.smokeAt)?h.smokeAt:torchRuntime)));
      h.smokeAt=torchRuntime;
      h.smokeAcc=Math.min(TORCH_SMOKE_PACKET*2,Math.max(0,Number(h.smokeAcc)||0)+elapsed*TORCH_SMOKE_RATE);
      if(h.smokeAcc>=TORCH_SMOKE_PACKET){
        const packet=Math.min(TORCH_SMOKE_PACKET*1.35,h.smokeAcc);
        h.smokeAcc-=packet;
        emitBlackSmoke(h.x,h.y,packet,getTile);
      }
      torchHeat.delete(k);
      torchHeat.set(k,h);
    }
  }
  function update(getTile,setTile,dt){
    if(!(dt>0) || !isFinite(dt) || typeof getTile!=='function' || typeof setTile!=='function') return;
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
      const smokeRate=burningSmokeRate(b.fuel);
      b.smokeAcc=(b.smokeAcc||0)+dt*smokeRate*(0.85+0.35*(1-b.left/b.total));
      if(b.smokeAcc>=0.18){
        const packet=Math.min(0.38,b.smokeAcc);
        b.smokeAcc-=packet;
        emitBlackSmoke(b.x,b.y,packet,getTile);
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
            p*=spreadInMultiplier(nInfo);
            if(Math.random()<p) ignite(nx,ny,getTile,setTile);
          } else if((nt===T.SNOW || nt===T.TOXIC_SNOW || nt===T.ICE || nt===T.GRASS_SNOW || isFrozenEarth(nt)) && Math.random()<0.5) thawAt(nx,ny,getTile,setTile);
        }
      }
      // (Creatures catching fire from tiles: mobs.js polls MM.fire.isBurning —
      // O(mobs) Map lookups instead of this loop scanning all mobs per tile.)
    }
  }
  // --- Shared flamethrower-style fire ------------------------------------------
  // World flames are precomposed from the exact hot/mid/tail radial sprites used
  // by the hero's flame stream. Runtime still stamps one baked frame per burning
  // tile, avoiding hundreds of puff draws at the 240-tile fire cap.
  let spriteTile=0; const flameFrames=[]; let glowSprite=null;
  let flameWidth=0,flameHeight=0;
  const FRAMES=16;
  const FLAME_VARIANTS=4;
  const FLAME_SUPERSAMPLE=2;
  const BLOCK_FLAME_PUFFS=6;
  function flameRand(variant,index){
    let h=Math.imul((variant+1)|0,0x45d9f3b)^Math.imul((index+17)|0,0x27d4eb2d);
    h=Math.imul(h^(h>>>16),0x45d9f3b); h^=h>>>16;
    return (h>>>0)/4294967296;
  }
  function buildSprites(TILE){
    spriteTile=TILE; flameFrames.length=0;
    flameWidth=Math.ceil(TILE*1.24);
    flameHeight=Math.ceil(TILE*1.78);
    const pad=(flameWidth-TILE)*0.5;
    const shared=getFlamePuffSprites();
    for(let variant=0;variant<FLAME_VARIANTS;variant++) for(let f=0;f<FRAMES;f++){
      const c=document.createElement('canvas');
      c.width=flameWidth*FLAME_SUPERSAMPLE;
      c.height=flameHeight*FLAME_SUPERSAMPLE;
      const g=c.getContext('2d');
      if(typeof g.scale==='function') g.scale(FLAME_SUPERSAMPLE,FLAME_SUPERSAMPLE);
      g.imageSmoothingEnabled=true;
      if('imageSmoothingQuality' in g) g.imageSmoothingQuality='high';
      const base=flameHeight-1;
      g.globalCompositeOperation='lighter';
      for(let i=0;i<BLOCK_FLAME_PUFFS;i++){
        const r0=flameRand(variant,i*5+1), r1=flameRand(variant,i*5+2), r2=flameRand(variant,i*5+3);
        const age=((f/FRAMES)+(i/BLOCK_FLAME_PUFFS)+variant*0.037)%1;
        const freshness=1-age;
        const puff=flamePuffFrame(shared,freshness);
        if(!puff) continue;
        const scale=(0.34+r0*0.20)*(0.92+0.08*Math.sin((f/FRAMES)*Math.PI*2+i));
        const radius=flamePuffRadius(TILE,freshness,scale);
        const lane=0.17+r1*0.66;
        const sway=Math.sin((f/FRAMES)*Math.PI*2+i*1.83+r2*3)*TILE*(0.04+age*0.10);
        const cx=pad+TILE*lane+sway;
        const cy=base-TILE*(0.05+age*(0.72+r2*0.34));
        g.globalAlpha=flamePuffAlpha(freshness)*(0.62+r2*0.28);
        g.drawImage(puff,cx-radius,cy-radius,radius*2,radius*2);
      }
      g.globalAlpha=1;
      g.globalCompositeOperation='source-over';
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
  function flameFrameAt(x,y,frame){
    const h=Math.imul(x|0,73856093)^Math.imul(y|0,19349663);
    const variant=(h>>>0)%FLAME_VARIANTS;
    const fi=((frame%FRAMES)+FRAMES)%FRAMES;
    return flameFrames[variant*FRAMES+fi];
  }
  function drawFlameSprite(ctx,TILE,x,y,baseY,now,scale,alpha){
    const fi=(((now*0.018)|0)+x*7+y*13)%FRAMES;
    const frame=flameFrameAt(x,y,fi);
    if(!frame) return;
    const pulse=Math.sin(now*0.006+x*2.71+y*1.93);
    const w=flameWidth*scale*(1+pulse*0.025);
    const h=flameHeight*scale*(1-pulse*0.018);
    const sway=Math.sin(now*0.004+x*1.37-y*2.11)*TILE*0.035*scale;
    const oldAlpha=ctx.globalAlpha;
    ctx.globalAlpha=alpha;
    ctx.drawImage(frame,x*TILE+(TILE-w)*0.5+sway,baseY-h,w,h);
    ctx.globalAlpha=oldAlpha;
  }
  // Lava behavior is tile-derived (no registry, so it survives world save/load):
  // the visible viewport is scanned each frame — same pattern as the chest-aura
  // pass in main.js — for glow, surface shimmer, and periodic neighbour ignition.
  let lastLavaTick=0;
  let lastLavaWakeTick=-Infinity;
  function smokeChimneyOutlet(x,y,getTile){
    if(typeof getTile!=='function') return null;
    const tx=Math.floor(x);
    let cy=Math.floor(y)-1;
    if(cy<WORLD_TOP || cy>=WORLD_BOTTOM) return null;
    if(getTile(tx,cy)!==T.CHIMNEY) return null;
    let guard=0;
    while(cy>=WORLD_TOP && cy<WORLD_BOTTOM && guard++<96 && getTile(tx,cy)===T.CHIMNEY) cy--;
    if(cy<WORLD_TOP) return {x:tx,y:WORLD_TOP};
    if(cy>=WORLD_BOTTOM) return null;
    return isLavaVentOpenTile(getTile(tx,cy)) ? {x:tx,y:cy} : null;
  }
  function burningSmokeRate(t){
    if(t===T.COAL) return 0.52;
    if(t===T.WOOD || t===T.WOOD_DOOR || t===T.WOOD_TRAPDOOR) return 0.28;
    if(t===T.ALIEN_BIOMASS) return 0.36;
    if(t===T.LEAF || t===T.AUTUMN_LEAF_ORANGE || t===T.AUTUMN_LEAF_RED || t===T.GRASS || t===T.GRASS_SNOW || t===T.UNSTABLE_GRASS) return 0.12;
    if(t===T.MEAT || t===T.ROTTEN_MEAT) return 0.20;
    return 0.16;
  }
  function emitBlackSmoke(tileX,tileY,amount,getTile){
    try{
      const layer=MM.smoke;
      if(!layer || typeof layer.emit!=='function') return 0;
      const outlet=smokeChimneyOutlet(tileX,tileY,getTile);
      const sx=outlet?outlet.x:Math.floor(tileX);
      const sy=outlet?outlet.y:Math.floor(tileY)-1;
      return layer.emit(sx+0.5,sy+0.5,amount,{getTile});
    }catch(e){ return 0; }
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
  const DRAW_SCAN_INTERVAL_MS = 120;
  let drawScanCache = {key:'', at:0, tiles:[]};
  function drawLavaCandidates(sx,sy,viewX,viewY,getTile,now){
    const x0=Math.floor(sx), x1=Math.ceil(sx+viewX+2);
    const y0=Math.max(WORLD_TOP,Math.floor(sy)), y1=Math.min(WORLD_BOTTOM-1,Math.ceil(sy+viewY+2));
    const scanKey=x0+','+x1+','+y0+','+y1;
    if(drawScanCache.key===scanKey && now-drawScanCache.at<DRAW_SCAN_INTERVAL_MS) return {tiles:drawScanCache.tiles, reused:true};
    const tiles=[];
    for(let x=x0; x<=x1; x++){
      for(let y=y0; y<=y1; y++){
        const t=getTile(x,y);
        if(t===T.TORCH || t===T.LAVA) tiles.push([x,y,t]);
      }
    }
    drawScanCache={key:scanKey, at:now, tiles};
    return {tiles, reused:false};
  }
  function radioactiveLampBoost(x,y,getTile){
    if(typeof getTile!=='function') return 0;
    for(let dx=-2;dx<=2;dx++) for(let dy=-2;dy<=2;dy++){
      if(Math.abs(dx)+Math.abs(dy)>3) continue;
      const t=getTile(x+dx,y+dy);
      if(t===T.RADIOACTIVE_ORE) return 1;
      if(t===T.METEOR_DUST) return 0.55;
    }
    return 0;
  }
  function drawLava(ctx,TILE,sx,sy,viewX,viewY,getTile,now,visibility){
    const GS=glowSprite.width;
    const igniteTick = now-lastLavaTick>500;
    if(igniteTick) lastLavaTick=now;
    const frameMs=(typeof window!=='undefined' && Number.isFinite(window.__mmFrameMs)) ? window.__mmFrameMs : 16;
    const stressed=frameMs>18, critical=frameMs>32;
    let glowBudget=critical?54:(stressed?115:260);
    let flameBudget=critical?24:(stressed?52:112);
    let wakeBudget=critical?10:(stressed?26:58);
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
    const candidateScan=drawLavaCandidates(sx,sy,viewX,viewY,getTile,now);
    for(const cell of candidateScan.tiles){
        const x=cell[0], y=cell[1], tt=candidateScan.reused ? getTile(x,y) : cell[2];
        if(tt===T.TORCH){
          if(!rememberedTile(x,y)) continue;
          noteTorch(x,y);
          const px=x*TILE, py=y*TILE;
          const flick=Math.sin(now*0.01 + x*5.3)*0.5+0.5;
          const radBoost=radioactiveLampBoost(x,y,getTile);
          // stick + ember head
          ctx.fillStyle='#6e4a22'; ctx.fillRect(px+TILE/2-1.5, py+TILE*0.35, 3, TILE*0.6);
          ctx.fillStyle=radBoost>0 ? '#caff73' : '#ffd56e'; ctx.fillRect(px+TILE/2-2.5, py+TILE*0.22, 5, 5);
          if(!visibleTile(x,y)) continue;
          // small flame + radial glow (baked sprites)
          drawFlameSprite(ctx,TILE,x,y,py+TILE*0.33,now,0.48,0.80);
          ctx.globalAlpha=(0.5+0.3*flick)*night*1.6;
          const gs=GS*2.4;
          ctx.drawImage(glowSprite, px+TILE/2-gs/2, py+TILE*0.3-gs/2, gs, gs);
          if(radBoost>0){
            ctx.save();
            ctx.globalCompositeOperation='lighter';
            ctx.globalAlpha=(0.18+0.12*flick)*radBoost;
            const rg=ctx.createRadialGradient(px+TILE/2,py+TILE*0.32,1,px+TILE/2,py+TILE*0.32,GS*(1.55+radBoost*0.85));
            rg.addColorStop(0,'rgba(190,255,105,0.85)');
            rg.addColorStop(0.42,'rgba(110,235,70,0.34)');
            rg.addColorStop(1,'rgba(110,235,70,0)');
            ctx.fillStyle=rg;
            ctx.beginPath();
            ctx.arc(px+TILE/2,py+TILE*0.32,GS*(1.55+radBoost*0.85),0,Math.PI*2);
            ctx.fill();
            ctx.restore();
          }
          ctx.globalAlpha=1;
          continue;
        }
        if(tt!==T.LAVA) continue;
        if(!visibleTile(x,y)) continue;
        let aboveT=T.STONE, belowT=T.STONE, leftT=T.STONE, rightT=T.STONE, frontier=false;
        const ignitionRoll=igniteTick && Math.random()<0.4;
        const wantFlameProbe=flameBudget>0;
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
        const chimneySmokeOutlet=aboveT===T.CHIMNEY && smokeChimneyOutlet(x,y,getTile);
        if((aboveT===T.AIR || chimneySmokeOutlet) && flameBudget-->0 && (!critical || ((x+y)&1)===0)){
          if(aboveT===T.AIR){
            drawFlameSprite(ctx,TILE,x,y,py+TILE*0.13,now,0.68,0.45+0.25*flick);
          }
        }
        ctx.globalAlpha=1;
        // heat ignites flammable neighbours (organic matter catches from lava)
        if(ignitionRoll){
          for(const [dx,dy] of [[0,-1],[1,0],[-1,0],[0,1]]){
            const nInfo=INFO[getTile(x+dx,y+dy)];
            if(nInfo && nInfo.flammable && Math.random()<0.5*spreadInMultiplier(nInfo)){ ignite(x+dx,y+dy,getTile); break; }
          }
        }
    }
  }
  function draw(ctx,TILE,sx,sy,viewX,viewY,getTile,visibility){
    if(spriteTile!==TILE || !glowSprite) buildSprites(TILE);
    const now=performance.now();
    const canSee = visibility && typeof visibility.visible==='function' ? visibility.visible : null;
    const revealAll = !!(visibility && visibility.revealAll);
    const visibleTile = (x,y)=>revealAll || !canSee || canSee(x,y);
    ctx.save();
    ctx.imageSmoothingEnabled=true;
    if('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality='high';
    if(typeof getTile==='function') drawLava(ctx,TILE,sx,sy,viewX,viewY,getTile,now,visibility);
    if(!burning.size){ ctx.restore(); return; }
    const GS=glowSprite.width;
    for(const b of burning.values()){
      if(b.x<sx-1||b.x>sx+viewX+2||b.y<sy-1||b.y>sy+viewY+2) continue;
      if(!visibleTile(b.x,b.y)) continue;
      const px=b.x*TILE, py=b.y*TILE;
      const flick=Math.sin(now*0.02 + b.x*3.7 + b.y*1.3)*0.5+0.5;
      const stage=1-(b.left/b.total); // 0 fresh → 1 burnt
      // charring overlay
      ctx.fillStyle='rgba(20,12,8,'+(0.25+stage*0.45).toFixed(2)+')';
      ctx.fillRect(px,py,TILE,TILE);
      // glow (baked radial sprite, alpha-flickered)
      ctx.globalAlpha=0.6+0.4*flick;
      ctx.drawImage(glowSprite, px+TILE/2-GS/2, py+TILE/2-GS/2);
      // Fuel changes the silhouette slightly; the final moments collapse toward
      // the block instead of ending as a full-height sprite pop.
      const leafy=b.fuel===T.LEAF||b.fuel===T.AUTUMN_LEAF_ORANGE||b.fuel===T.AUTUMN_LEAF_RED||b.fuel===T.GRASS||b.fuel===T.GRASS_SNOW;
      const fuelScale=b.fuel===T.COAL?1.06:(leafy?0.84:1);
      const burnout=stage>0.88?Math.max(0.24,(1-stage)/0.12):1;
      drawFlameSprite(ctx,TILE,b.x,b.y,py+TILE,now,fuelScale*(0.97+flick*0.06)*burnout,0.84+0.16*flick);
      ctx.globalAlpha=1;
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
  const lavaScratch=[];    // reused per-tick [k,L,k,L,...] snapshot (no per-frame pair allocs)
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
    return isLavaExposureOpenTile(t);
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
    if(!finiteTile(x,y)) return null;
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
    const entry={x,y,coolT:lavaCoolTime(),moveT:opts.fast?lavaWakeDelay(pressure>0.03):(Math.random()*lavaMoveDelay(pressure>0.03)),hotT:Number.isFinite(opts.hotT)?Math.max(0,opts.hotT):Math.random()*LAVA_HOT_AIR_INTERVAL,smokeT:Number.isFinite(opts.smokeT)?Math.max(0,opts.smokeT):Math.random()*2.8,pressure,source};
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
      if(isLavaVentOpenTile(t)) return true;
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
    for(let y=Math.max(WORLD_TOP,ty-ry); y<=Math.min(WORLD_BOTTOM-1,ty+ry); y++){
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
    // flat [k,L,k,L,...] snapshot in a reused scratch: identical semantics to
    // the old `[...lavaSet.entries()]` (moved/replaced lava is skipped via the
    // object-identity guard) without allocating ~560 pair arrays per frame for
    // the lifetime of every volcano the player ever visited
    lavaScratch.length=0;
    lavaSet.forEach((L,k)=>{ lavaScratch.push(k,L); });
    for(let si=0; si<lavaScratch.length; si+=2){
      const k=lavaScratch[si], L=lavaScratch[si+1];
      if(lavaSet.get(k)!==L) continue;
      L.waterT=(L.waterT==null?Math.random()*0.12:L.waterT)-dt;
      if(L.waterT<=0){
        L.waterT=0.22+Math.random()*0.12;
        if(getTile(L.x,L.y)!==T.LAVA){ lavaSet.delete(k); continue; }
        if(lavaTouchesWater(L,getTile)){
          if(!authoritativeBodyBlocksCell(L.x,L.y)){ setTile(L.x,L.y,T.OBSIDIAN); lavaSet.delete(k); }
          continue;
        }
      }
      L.hotT=(L.hotT==null?Math.random()*LAVA_HOT_AIR_INTERVAL:L.hotT)-dt;
      if(L.hotT<=0){
        L.hotT=LAVA_HOT_AIR_INTERVAL*(0.85+Math.random()*0.30);
        if(hotAirBudget>0 && emitLavaHotAir(L,getTile,setTile)>0) hotAirBudget--;
      }
      L.smokeT=(L.smokeT==null?Math.random()*2.8:L.smokeT)-dt;
      if(L.smokeT<=0){
        const vp=volcanoSmokePower(L.x,L.y);
        const heavy=vp>1;
        L.smokeT=(heavy?0.72:2.8)*(0.82+Math.random()*0.36);
        const above=getTile(L.x,L.y-1);
        if(lavaOpenTile(above)||above===T.CHIMNEY) emitBlackSmoke(L.x,L.y,heavy?0.24:0.14,getTile);
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
        if(lavaTouchesWater(L,getTile)){
          if(!authoritativeBodyBlocksCell(L.x,L.y)){ setTile(L.x,L.y,T.OBSIDIAN); lavaSet.delete(k); }
          continue;
        }
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
          if(getTile(L.x,L.y)!==T.LAVA) lavaSet.delete(k);
          else if(!authoritativeBodyBlocksCell(L.x,L.y)){
            setTile(L.x,L.y,T.OBSIDIAN); // re-validate both tile and body before converting
            lavaSet.delete(k);
          } else L.coolT=0.25; // retry after the body leaves; never delete the live lava entry
        }
      }
    }
  }

  function sanitizeBurnRecord(raw,getTile){
    if(!raw || typeof getTile!=='function') return null;
    const x=Math.floor(Number(raw.x)), y=Math.floor(Number(raw.y));
    if(!Number.isFinite(x) || !Number.isFinite(y) || !finiteTile(x,y)) return null;
    if(!flammableAt(getTile,x,y) || wetAt(getTile,x,y)) return null;
    const info=INFO[getTile(x,y)] || {};
    const fallbackTotal=Math.max(0.4, info.burnTime||2);
    const total=Math.max(0.4, Number.isFinite(raw.total) ? raw.total : fallbackTotal);
    const left=Math.max(0.05, Math.min(total, Number.isFinite(raw.left) ? raw.left : total));
    if(left<=0) return null;
    return {
      x,y,left,total,
      spreadAcc:Math.max(0, Math.min(SPREAD_INTERVAL, Number.isFinite(raw.spreadAcc) ? raw.spreadAcc : Math.random()*SPREAD_INTERVAL)),
      envAcc:Math.max(0, Math.min(0.25, Number.isFinite(raw.envAcc) ? raw.envAcc : Math.random()*0.25)),
      hotAcc:Math.max(0, Math.min(BURNING_HOT_AIR_INTERVAL, Number.isFinite(raw.hotAcc) ? raw.hotAcc : Math.random()*0.8)),
      smokeAcc:Math.max(0, Math.min(0.38, Number.isFinite(raw.smokeAcc) ? raw.smokeAcc : Math.random()*0.18)),
      fuel:getTile(x,y)
    };
  }
  function snapshot(){
    const list=[...burning.values()]
      .filter(b=>b && Number.isFinite(b.x) && Number.isFinite(b.y) && (b.left||0)>0)
      .sort((a,b)=>(a.x-b.x)||(a.y-b.y))
      .slice(0,MAX_BURNING)
      .map(b=>({
        x:b.x|0,
        y:b.y|0,
        left:+Math.max(0,b.left||0).toFixed(3),
        total:+Math.max(0.4,b.total||0.4).toFixed(3),
        spreadAcc:+Math.max(0,b.spreadAcc||0).toFixed(3),
        envAcc:+Math.max(0,b.envAcc||0).toFixed(3),
        hotAcc:+Math.max(0,b.hotAcc||0).toFixed(3),
        smokeAcc:+Math.max(0,b.smokeAcc||0).toFixed(3)
      }));
    return {v:1,list};
  }
  function restore(data,getTile){
    burning.clear();
    if(!data || !Array.isArray(data.list) || typeof getTile!=='function') return;
    for(const raw of data.list){
      if(burning.size>=MAX_BURNING) break;
      const b=sanitizeBurnRecord(raw,getTile);
      if(!b) continue;
      burning.set(key(b.x,b.y),b);
    }
  }
  function reset(){ burning.clear(); lavaSet.clear(); torchHeat.clear(); torchHeatAcc=0; torchRuntime=0; drawScanCache={key:'', at:0, tiles:[]}; }
  function isBurning(x,y){ return burning.has(key(x|0,y|0)); }
  // Put out a single tile (water hose, rain, …) — the tile keeps whatever charring it had
  function extinguish(x,y){ return burning.delete(key(x|0,y|0)); }
  MM.fire={ignite,extinguish,update,draw,reset,snapshot,restore,isBurning,thawAt,cookAt,heatAround,noteTorch,noteLava,wakeLavaAround,wakeVolcanoLeaksNear,count:()=>burning.size,lavaCount:()=>lavaSet.size,_debug:{coalHasAirAccess}};
})();
// ESM export (progressive migration)
export const fire = (typeof window!=='undefined' && window.MM) ? window.MM.fire : undefined;
export default fire;
