// Living plant ecosystem: plants sprout on suitable soil, drink from adjacent
// water (every few sips they absorb the tile outright), from rain (clouds.isRainingAt)
// and from the player's water hose, spend hydration to grow through stages, dry
// out when thirsty, wilt with old age, and finally wither and crumble away.
// One plant per world column; entities are persisted to localStorage so a garden
// survives reloads. The sim core is DOM-free (Node-testable); only draw() touches
// canvas. Hooks used: MM.water, MM.clouds.isRainingAt, MM.fire.isBurning.
import { T, INFO, WORLD_H } from '../constants.js';
(function(){
  window.MM = window.MM || {};

  // --- Species registry (data-driven: add an entry and it grows) ---------------
  // stages: growth steps; growEvery: seconds between growth attempts; growCost:
  // hydration spent per stage; decay: hydration lost /s; lifespan: seconds until
  // old age sets in; soil: tiles it roots in; dryTolerant: desert metabolism.
  const SPECIES={
    sunflower:{ stages:4, growEvery:[7,12],  growCost:0.30, decay:0.012, lifespan:[160,280], soil:[T.GRASS,T.MUD] },
    berrybush:{ stages:4, growEvery:[9,16],  growCost:0.35, decay:0.010, lifespan:[240,400], soil:[T.GRASS,T.MUD],
                harvest:{stage:4, heal:6, backTo:3} },
    reed:     { stages:3, growEvery:[6,10],  growCost:0.22, decay:0.008, lifespan:[130,230], soil:[T.SAND,T.MUD,T.GRASS] },
    fern:     { stages:3, growEvery:[8,14],  growCost:0.25, decay:0.014, lifespan:[110,200], soil:[T.GRASS,T.MUD] },
    cactus:   { stages:4, growEvery:[14,24], growCost:0.18, decay:0.003, lifespan:[320,520], soil:[T.SAND], dryTolerant:true },
    alienbloom:{ stages:4, growEvery:[10,18], growCost:0.16, decay:0.006, lifespan:[420,720], soil:[T.ALIEN_BIOMASS,T.METEOR_DUST,T.GRASS,T.MUD], alien:true },
  };
  const TYPES=Object.keys(SPECIES);
  const MAX_PLANTS=160;
  const SAVE_KEY='mm_plants_v1';
  const ENV_INTERVAL=2.0;     // seconds between per-plant environment checks
  const SIPS_PER_TILE=3;      // drinks absorbed from one water tile before it vanishes

  const plants=new Map();     // column x -> plant
  let seedAcc=0, saveAcc=0, dirty=false;
  let rng=Math.random;        // swappable for deterministic tests

  function rand(a,b){ return a + rng()*(b-a); }
  function isGasTile(t){ return !!(INFO[t] && INFO[t].gas); }
  function openAir(t){ return t===T.AIR || isGasTile(t); }
  function plantSpace(t){ return t===T.AIR || t===T.WATER || isGasTile(t); }

  // --- Lifecycle ----------------------------------------------------------------
  // Surface lookup: prefer the worldgen column cache; fall back to a tile scan
  // (Node tests stub no worldGen, and dug-out terrain can differ from the model).
  function surfaceAt(x,getTile){
    let y=2;
    try{
      const wg=MM.worldGen;
      if(wg && wg.surfaceHeight){ y=Math.max(2, wg.surfaceHeight(x)-6); } // start near the cached surface
    }catch(e){}
    while(y<WORLD_H-2 && openAir(getTile(x,y))) y++;
    return y;
  }
  // Anchor: plant.y is the AIR row just above its soil tile (soil at y+1).
  function sow(type,x,getTile){
    if(!SPECIES[type] || plants.has(x) || plants.size>=MAX_PLANTS) return null;
    const spec=SPECIES[type];
    const y=surfaceAt(x,getTile);
    if(y<=2 || y>=WORLD_H-2) return null;
    if(!spec.soil.includes(getTile(x,y))) return null;
    if(!openAir(getTile(x,y-1))) return null;
    const p={
      type, x, y:y-1,
      stage:1, hyd:0.6, health:1, age:0,
      lifespan:rand(spec.lifespan[0],spec.lifespan[1]),
      growT:rand(spec.growEvery[0],spec.growEvery[1]),
      envT:rng()*ENV_INTERVAL, sips:0,
      withered:false, witherT:0, sway:rng()*6.28,
    };
    plants.set(x,p); dirty=true;
    return p;
  }
  function wither(p){ if(!p.withered){ p.withered=true; p.witherT=6; p.health=0; dirty=true; } }
  function radioactiveNear(p,getTile){
    if(!p || typeof getTile!=='function') return false;
    for(let dx=-3;dx<=3;dx++) for(let dy=-2;dy<=2;dy++){
      const t=getTile(p.x+dx,p.y+dy);
      if(t===T.RADIOACTIVE_ORE || t===T.METEOR_DUST) return true;
    }
    return false;
  }
  function mutatePlant(p){
    if(!p || p.withered || p.type==='alienbloom') return false;
    const spec=SPECIES.alienbloom;
    p.type='alienbloom';
    p.stage=Math.max(1,Math.min(spec.stages,(p.stage|0)+1));
    p.hyd=Math.min(1,Math.max(p.hyd||0,0.5));
    p.health=Math.min(1,Math.max(p.health||0,0.75));
    p.lifespan=Math.max(p.lifespan||0,rand(spec.lifespan[0],spec.lifespan[1]));
    p.growT=rand(spec.growEvery[0],spec.growEvery[1]);
    dirty=true;
    return true;
  }

  function envCheck(p,getTile,setTile){
    const spec=SPECIES[p.type];
    // soil gone or anchor blocked → the plant is destroyed outright
    if(!spec.soil.includes(getTile(p.x,p.y+1)) || !plantSpace(getTile(p.x,p.y))){
      plants.delete(p.x); dirty=true; return;
    }
    // fire / lava nearby chars it instantly (plants are the most organic thing there is)
    const F=MM.fire;
    for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=2;dy++){
      if(getTile(p.x+dx,p.y+dy)===T.LAVA || (F && F.isBurning && F.isBurning(p.x+dx,p.y+dy))){ wither(p); return; }
    }
    if(p.type!=='alienbloom' && radioactiveNear(p,getTile)){
      mutatePlant(p);
      return;
    }
    if(p.type==='alienbloom' && radioactiveNear(p,getTile)) p.hyd=Math.min(1,p.hyd+0.18);
    // --- hydration intake ---
    // adjacent/below water: drink; every SIPS_PER_TILE sips the tile is absorbed
    let drank=false;
    outer: for(let dy=2;dy>=-1;dy--){ // prefer drinking from below (roots first)
      for(let dx=-2;dx<=2;dx++){
        if(getTile(p.x+dx,p.y+dy)!==T.WATER) continue;
        p.hyd=Math.min(1,p.hyd+0.5); p.sips++; drank=true;
        if(p.sips>=SIPS_PER_TILE && typeof setTile==='function'){
          p.sips=0; setTile(p.x+dx,p.y+dy,T.AIR);
          try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(p.x+dx,p.y+dy,getTile); }catch(e){}
        }
        break outer;
      }
    }
    // rain waters everything under it; wet mud keeps roots damp
    if(!drank && MM.clouds && MM.clouds.isRainingAt && MM.clouds.isRainingAt(p.x)) p.hyd=Math.min(1,p.hyd+0.35);
    if(getTile(p.x,p.y+1)===T.MUD) p.hyd=Math.min(1,p.hyd+0.15);
    // hydration decay + thirst/aging damage vs slow recovery
    p.hyd=Math.max(0, p.hyd - spec.decay*ENV_INTERVAL*(spec.dryTolerant?0.5:1));
    if(p.hyd<=0) p.health-=0.05*ENV_INTERVAL;
    else if(p.age>p.lifespan) p.health-=0.03*ENV_INTERVAL;   // old age wins in the end
    else p.health=Math.min(1, p.health+0.02*ENV_INTERVAL);
    if(p.health<=0) wither(p);
  }

  function update(getTile,setTile,dt){
    if(typeof getTile!=='function' || !(dt>0)) return;
    for(const p of plants.values()){
      if(p.withered){
        p.witherT-=dt;
        if(p.witherT<=0){ plants.delete(p.x); dirty=true; }
        continue;
      }
      p.age+=dt;
      p.envT-=dt;
      if(p.envT<=0){ p.envT=ENV_INTERVAL; envCheck(p,getTile,setTile); if(p.withered) continue; }
      // growth: spends hydration, only while reasonably watered and healthy
      const spec=SPECIES[p.type];
      if(p.stage<spec.stages && p.hyd>0.25 && p.health>0.4){
        p.growT-=dt;
        if(p.growT<=0){
          p.stage++; p.hyd=Math.max(0,p.hyd-spec.growCost);
          p.growT=rand(spec.growEvery[0],spec.growEvery[1]);
          dirty=true;
        }
      }
    }
    // --- natural seeding near the hero: sprouts favour watered ground ---
    seedAcc+=dt;
    if(seedAcc>=2.5){
      seedAcc=0;
      const pl=(typeof window!=='undefined' && window.player)||null;
      if(pl && plants.size<MAX_PLANTS){
        for(let tries=0;tries<4;tries++){
          const x=Math.round(pl.x + (rng()*2-1)*60);
          if(plants.has(x) || plants.has(x-1) || plants.has(x+1)) continue;
          const type=TYPES[(rng()*TYPES.length)|0];
          const spec=SPECIES[type];
          // find surface & validate soil cheaply before deciding on water needs
          const y=surfaceAt(x,getTile);
          if(!spec.soil.includes(getTile(x,y))) continue;
          // sprouting needs moisture: nearby water, rain, or wet mud — cacti don't care
          let wet=spec.dryTolerant;
          if(!wet && MM.clouds && MM.clouds.isRainingAt && MM.clouds.isRainingAt(x)) wet=true;
          if(!wet){ scan: for(let dx=-3;dx<=3;dx++) for(let dy=-1;dy<=2;dy++){ if(getTile(x+dx,y+dy)===T.WATER){ wet=true; break scan; } } }
          if(!wet && getTile(x,y)===T.MUD) wet=true;
          if(!wet) continue;
          if(sow(type,x,getTile)) break;
        }
      }
    }
    // debounced persistence
    saveAcc+=dt;
    if(dirty && saveAcc>=10){ saveAcc=0; save(); }
  }

  // --- External influences --------------------------------------------------------
  // Hose / splash watering: hydrate every plant within r of the world point
  function waterAt(wx,wy,amt,r){
    r=r||1.5; amt=amt||0.3;
    for(let x=Math.floor(wx-r); x<=Math.floor(wx+r); x++){
      const p=plants.get(x);
      if(p && !p.withered && Math.abs(p.y+0.5-wy)<=r+2){ p.hyd=Math.min(1,p.hyd+amt); }
    }
  }
  // Flame: chars plants in the radius
  function scorchAt(wx,wy,r){
    r=r||1.2;
    for(let x=Math.floor(wx-r); x<=Math.floor(wx+r); x++){
      const p=plants.get(x);
      if(p && !p.withered && Math.abs(p.y+0.5-wy)<=r+2) wither(p);
    }
  }
  function mutateAt(wx,wy,r,getTile,setTile){
    r=Math.max(1,Number(r)||4);
    let changed=0;
    for(let x=Math.floor(wx-r); x<=Math.floor(wx+r); x++){
      const p=plants.get(x);
      if(!p || p.withered) continue;
      if(Math.hypot((p.x+0.5)-wx,(p.y+0.5)-wy)>r+2) continue;
      if(mutatePlant(p)) changed++;
    }
    if(!changed && plants.size<MAX_PLANTS && typeof getTile==='function'){
      for(let tries=0; tries<5; tries++){
        const x=Math.round(wx + (rng()*2-1)*r);
        if(plants.has(x)) continue;
        try{
          if(sow('alienbloom',x,getTile)){ changed++; break; }
        }catch(e){}
      }
    }
    return changed;
  }
  // Click interaction: harvest ripe berries (heals), or clear the plant
  function harvestAt(tx,ty){
    const p=plants.get(tx);
    if(!p || p.withered) return false;
    // hitbox scales with growth: a sprout must not swallow clicks aimed at the
    // tiles above it (mining behind a seedling used to be impossible)
    const top=p.y-Math.min(2, p.stage-1);
    if(ty<top || ty>p.y) return false;
    const spec=SPECIES[p.type];
    const pl=(typeof window!=='undefined' && window.player)||null;
    if(spec.harvest && p.stage>=spec.harvest.stage){
      p.stage=spec.harvest.backTo; p.growT=rand(spec.growEvery[0],spec.growEvery[1]); dirty=true;
      if(pl && typeof pl.hp==='number'){ pl.hp=Math.min(pl.maxHp||100, pl.hp+spec.harvest.heal); }
      try{ if(window.msg) window.msg('🫐 Jagody: +'+spec.harvest.heal+' HP'); }catch(e){}
      try{ window.dispatchEvent(new CustomEvent('mm-berry-harvest')); }catch(e){} // milestones (progress.js)
      return true;
    }
    // clearing a plant returns a leaf scrap
    plants.delete(tx); dirty=true;
    try{ const inv=(typeof window!=='undefined' && window.inv)||null; if(inv && typeof inv.leaf==='number'){ inv.leaf++; if(window.updateInventoryHud) window.updateInventoryHud(); } }catch(e){}
    return true;
  }

  // --- Persistence ------------------------------------------------------------------
  function finite(v,fallback){ const n=Number(v); return isFinite(n)? n : fallback; }
  function clamp(v,min,max){ return Math.min(max, Math.max(min, finite(v,min))); }
  function clampOr(v,min,max,fallback){ return clamp(finite(v,fallback),min,max); }
  function packPlants(){
    const arr=[];
    for(const p of plants.values()){
      if(!p || !SPECIES[p.type]) continue;
      arr.push({
        t:p.type,
        x:Math.round(finite(p.x,0)),
        y:Math.round(finite(p.y,0)),
        s:Math.max(1,p.stage|0),
        h:+clamp(p.hyd,0,1).toFixed(2),
        hp:+clamp(p.health,0,1).toFixed(2),
        a:Math.round(Math.max(0,finite(p.age,0))),
        L:Math.round(Math.max(60,finite(p.lifespan,60))),
        w:p.withered?1:0,
        wt:+Math.max(0,finite(p.witherT,0)).toFixed(2),
      });
      if(arr.length>=MAX_PLANTS) break;
    }
    return arr;
  }
  function snapshot(){ return {v:1, list:packPlants()}; }
  function restoreList(data){
    const arr=Array.isArray(data) ? data : (data && Array.isArray(data.list) ? data.list : null);
    if(!arr) return false;
    plants.clear();
    arr.slice(0,MAX_PLANTS).forEach(d=>{
      if(!d || !SPECIES[d.t]) return;
      const x=Math.round(finite(d.x,NaN));
      const y=Math.round(finite(d.y,NaN));
      if(!isFinite(x) || !isFinite(y)) return;
      const spec=SPECIES[d.t];
      plants.set(x,{
        type:d.t, x, y,
        stage:Math.min(spec.stages, Math.max(1,d.s|0)),
        hyd:clampOr(d.h,0,1,0.4),
        health:Math.max(0.05, clampOr(d.hp,0,1,1)),
        age:Math.max(0,finite(d.a,0)),
        lifespan:Math.max(60,finite(d.L,spec.lifespan[0])),
        growT:rand(spec.growEvery[0],spec.growEvery[1]),
        envT:rng()*ENV_INTERVAL,
        sips:0,
        withered:!!d.w,
        witherT:Math.max(0,finite(d.wt,0)),
        sway:rng()*6.28,
      });
    });
    return true;
  }
  function save(){
    dirty=false;
    try{ localStorage.setItem(SAVE_KEY, JSON.stringify(packPlants())); }
    catch(e){ /* storage unavailable - garden lives for the session */ }
  }
  function restore(data){
    if(!restoreList(data)) return false;
    dirty=true;
    save();
    return true;
  }
  function load(){
    try{
      const raw=localStorage.getItem(SAVE_KEY); if(!raw) return;
      restoreList(JSON.parse(raw));
      dirty=false;
    }catch(e){ /* corrupt save - start with bare soil */ }
  }
  function reset(){ plants.clear(); dirty=false; try{ localStorage.removeItem(SAVE_KEY); }catch(e){} }
  if(typeof window!=='undefined' && window.addEventListener){
    window.addEventListener('pagehide',()=>{ if(dirty) save(); });
  }

  // --- Rendering ----------------------------------------------------------------------
  // Palettes keyed by condition: healthy, thirsty (hyd low), withered
  function pal(p){
    if(p.withered) return {a:'#6b5536',b:'#52412a',c:'#7a6645'};
    if(p.hyd<0.22) return {a:'#9aa44e',b:'#7c8440',c:'#c9b25a'};
    return null; // healthy → species colors
  }
  function draw(ctx,TILE,sx,sy,viewX,viewY,canDrawTile){
    const visibleTile = typeof canDrawTile === 'function' ? canDrawTile : null;
    if(!plants.size) return;
    const now=(typeof performance!=='undefined')? performance.now():0;
    for(const p of plants.values()){
      if(p.x<sx-2||p.x>sx+viewX+2||p.y<sy-4||p.y>sy+viewY+4) continue;
      if(visibleTile && !visibleTile(p.x,p.y)) continue;
      const baseX=(p.x+0.5)*TILE, baseY=(p.y+1)*TILE; // soil line under the anchor tile
      const sw=Math.sin(now*0.0016+p.sway)*1.6;       // gentle sway at the tips
      const o=pal(p);
      const fade=p.withered? Math.max(0.25,p.witherT/6) : 1;
      ctx.save(); ctx.globalAlpha=fade;
      const st=p.stage;
      if(p.type==='sunflower'){
        const stem=o?o.b:'#3e7d2f', petal=o?o.c:'#ffd23e', heart=o?o.b:'#7a4a18';
        const h=TILE*(0.4+st*0.5);
        ctx.strokeStyle=stem; ctx.lineWidth=2;
        ctx.beginPath(); ctx.moveTo(baseX,baseY); ctx.quadraticCurveTo(baseX, baseY-h*0.6, baseX+sw, baseY-h); ctx.stroke();
        ctx.fillStyle=stem; ctx.fillRect(baseX-4,baseY-h*0.45,3,2); ctx.fillRect(baseX+2,baseY-h*0.6,3,2);
        if(st>=3){
          const cy=baseY-h, r=st===4?5:3;
          ctx.fillStyle=petal;
          for(let i=0;i<8;i++){ const a=i/8*Math.PI*2; ctx.fillRect(baseX+sw+Math.cos(a)*r-1.4, cy+Math.sin(a)*r-1.4, 2.8,2.8); }
          ctx.fillStyle=heart; ctx.beginPath(); ctx.arc(baseX+sw,cy,r*0.62,0,Math.PI*2); ctx.fill();
        }
      } else if(p.type==='berrybush'){
        const leaf=o?o.a:'#2f8a35';
        const r=3+st*2.2;
        ctx.fillStyle=leaf;
        ctx.beginPath(); ctx.arc(baseX,baseY-r*0.8,r,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(baseX-r*0.7,baseY-r*0.45,r*0.7,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(baseX+r*0.7,baseY-r*0.45,r*0.7,0,Math.PI*2); ctx.fill();
        if(st>=4 && !p.withered){
          ctx.fillStyle='#c2284b';
          ctx.fillRect(baseX-r*0.6,baseY-r,2.4,2.4); ctx.fillRect(baseX+r*0.3,baseY-r*0.7,2.4,2.4); ctx.fillRect(baseX-2,baseY-r*1.5,2.4,2.4);
        }
      } else if(p.type==='reed'){
        const stalk=o?o.a:'#5d9b46', head=o?o.b:'#6e4a22';
        const h=TILE*(0.6+st*0.65);
        ctx.strokeStyle=stalk; ctx.lineWidth=2;
        for(const off of [-3,0,3]){
          ctx.beginPath(); ctx.moveTo(baseX+off,baseY); ctx.quadraticCurveTo(baseX+off, baseY-h*0.6, baseX+off+sw*0.8, baseY-h*(0.8+0.1*Math.abs(off))); ctx.stroke();
        }
        if(st>=3){ ctx.fillStyle=head; ctx.fillRect(baseX+sw*0.8-2, baseY-h-6, 4, 8); }
      } else if(p.type==='fern'){
        const leaf=o?o.a:'#2c7a3a';
        ctx.strokeStyle=leaf; ctx.lineWidth=2; ctx.lineCap='round';
        const n=1+st*2;
        for(let i=0;i<n;i++){
          const a=Math.PI*(0.25+0.5*i/(n-1||1)) + sw*0.02;
          const len=TILE*(0.35+st*0.22);
          ctx.beginPath(); ctx.moveTo(baseX,baseY);
          ctx.quadraticCurveTo(baseX+Math.cos(a)*len*0.5, baseY-Math.sin(a)*len*0.9, baseX+Math.cos(a)*len+sw*0.5, baseY-Math.sin(a)*len*0.55);
          ctx.stroke();
        }
      } else if(p.type==='cactus'){
        const body=o?o.a:'#3f8f4f', rib=o?o.b:'#2e6e3b';
        const h=TILE*(0.45*st);
        ctx.fillStyle=body; ctx.fillRect(baseX-3,baseY-h,6,h);
        ctx.fillStyle=rib; ctx.fillRect(baseX-0.8,baseY-h,1.6,h);
        if(st>=3){ ctx.fillStyle=body; ctx.fillRect(baseX-9,baseY-h*0.65,6,4); ctx.fillRect(baseX-9,baseY-h*0.65,4,h*0.3); }
        if(st>=4){ ctx.fillStyle=body; ctx.fillRect(baseX+3,baseY-h*0.8,6,4); ctx.fillRect(baseX+5,baseY-h*0.8,4,h*0.35);
          if(!p.withered){ ctx.fillStyle='#ff8fb3'; ctx.fillRect(baseX-2,baseY-h-3,4,3); } }
      } else if(p.type==='alienbloom'){
        const stalk=o?o.b:'#4aa85c', glow=o?o.c:'#b8ff72', vein=o?o.a:'#7a62ff';
        const h=TILE*(0.45+st*0.38);
        ctx.strokeStyle=stalk; ctx.lineWidth=2; ctx.lineCap='round';
        ctx.beginPath(); ctx.moveTo(baseX,baseY); ctx.quadraticCurveTo(baseX+sw*0.25,baseY-h*0.62,baseX+sw,baseY-h); ctx.stroke();
        ctx.strokeStyle=vein; ctx.lineWidth=1.2;
        for(let i=0;i<st+1;i++){
          const side=i%2?1:-1;
          const yy=baseY-h*(0.22+i*0.16);
          ctx.beginPath(); ctx.moveTo(baseX+sw*0.2,yy); ctx.quadraticCurveTo(baseX+side*TILE*0.18,yy-TILE*0.10,baseX+side*TILE*(0.28+st*0.04),yy-TILE*0.02); ctx.stroke();
        }
        ctx.fillStyle=glow;
        ctx.globalAlpha*=0.82;
        ctx.beginPath(); ctx.arc(baseX+sw,baseY-h,2.5+st*1.6,0,Math.PI*2); ctx.fill();
      }
      ctx.restore();
    }
  }

  load();
  MM.plants={
    update, draw, sow, waterAt, scorchAt, mutateAt, harvestAt, reset, save, snapshot, restore,
    count:()=>plants.size,
    metrics:()=>({count:plants.size}),
    _setRng:(fn)=>{ rng=fn||Math.random; },     // deterministic tests
    _debug:()=>plants,
    SPECIES,
  };
})();
// ESM export (progressive migration)
export const plants = (typeof window!=='undefined' && window.MM) ? window.MM.plants : undefined;
export default plants;
