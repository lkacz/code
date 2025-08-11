// Basic mob / animal system (birds, fish) with aggression propagation.
// Exposes MM.mobs API: {update, draw, serialize, deserialize, attackAt, damagePlayer}
(function(){
  const MM = window.MM = window.MM || {};
  const TILE = MM.TILE;
  const T = MM.T;
  const WORLD = MM.world;
  const INFO = MM.INFO;
  const isSolid = MM.isSolid;

  const mobs = []; // entities
  const speciesAggro = {}; // speciesId -> expiry timestamp (ms)
  const speciesCounts = {}; // live counts for quick spawn capping
  // Spatial partitioning (uniform grid) to speed up point queries (attackAt)
  const CELL=16; // tiles per cell both axes
  const grid = new Map(); // key "cx,cy" -> Set of mob refs
  function cellKey(x,y){ return ((x/CELL)|0)+','+((y/CELL)|0); }
  function addToGrid(m){ const k=cellKey(m.x,m.y); let set=grid.get(k); if(!set){ set=new Set(); grid.set(k,set); } set.add(m); m._cellKey=k; }
  function updateGridCell(m){ const k=cellKey(m.x,m.y); if(k!==m._cellKey){ // move
    if(m._cellKey){ const prev=grid.get(m._cellKey); if(prev){ prev.delete(m); if(!prev.size) grid.delete(m._cellKey); } }
    let set=grid.get(k); if(!set){ set=new Set(); grid.set(k,set); } set.add(m); m._cellKey=k; }
  }
  function removeFromGrid(m){ if(m._cellKey){ const set=grid.get(m._cellKey); if(set){ set.delete(m); if(!set.size) grid.delete(m._cellKey); } m._cellKey=null; } if(m && m.id){ speciesCounts[m.id] = (speciesCounts[m.id]||1)-1; if(speciesCounts[m.id]<0) speciesCounts[m.id]=0; } }

  // --- Species registry (extensible) ---
  const SPECIES = {
    BIRD: {
  id: 'BIRD', max: 18, hp: 6, dmg: 4, speed: 3.2, wanderInterval: [2,6], xp:4,
      spawnTest(x,y,getTile){ // spawn perched above leaves (air above leaf)
        const below = getTile(x,y+1); const here = getTile(x,y);
        return here===T.AIR && below===T.LEAF; },
      biome: 'any',
      habitatUpdate(m, spec, getTile){ // keep slightly above ground
        const groundTile = getTile(Math.floor(m.x), Math.floor(m.y)+1); if(groundTile!==T.AIR){ m.vy -= 0.8; }
      }
    },
    FISH: {
  id: 'FISH', max: 24, hp: 4, dmg: 3, speed: 2.2, wanderInterval:[1,4], xp:3,
      spawnTest(x,y,getTile){ // inside water with air or water above
        const here = getTile(x,y); const above = getTile(x,y-1);
        return here===T.WATER && (above===T.WATER || above===T.AIR); },
      biome: 'any', aquatic:true,
      onCreate(m){ initWaterAnchor(m); },
      habitatUpdate(m, spec, getTile, dt){ enforceAquatic(m, spec, getTile, dt); }
    }
  };

  // Additional biome-aware species
  const WG = MM.worldGen;
  // Helper biome query (0,1,2) fallback to 1 if missing
  function biomeAt(x){ try{ return WG && WG.biomeType ? WG.biomeType(x) : 1; }catch(e){ return 1; } }

  registerSpecies({ // Large forest predator near trees
    id:'BEAR', max:6, hp:30, dmg:10, speed:2.0, wanderInterval:[3,7], xp:25,
    loot:[{item:'wood', min:1, max:2, chance:0.4}],
    spawnTest(x,y,getTile){ const here=getTile(x,y); if(here!==T.AIR) return false; const below=getTile(x,y+1); if(!(below===T.GRASS||below===T.WOOD||below===T.LEAF)) return false; // require trunk or leaf adjacency
      const trunk = getTile(x-1,y+1)===T.WOOD || getTile(x+1,y+1)===T.WOOD; return trunk && biomeAt(x)===0; },
    biome:'forest',
    onUpdate(m,spec,{dt,player,aggressive}){ // slow patrol, lunge when close
      const dx=player.x-m.x; const dy=player.y-m.y; const dist=Math.hypot(dx,dy)||1;
      if(dist<6){ m.vx += (dx/dist)*spec.speed*0.4*dt*30; m.facing = dx>=0?1:-1; if(dist<1.7){ m.vx += (dx/dist)*spec.speed*0.9; } }
      else if(Math.random()<0.005){ m.vx += (Math.random()*2-1)*0.6; }
      // keep near ground
      if(Math.random()<0.01) m.vy -= 0.2;
    }
  });

  registerSpecies({ // Tree-dwelling small mammal on leaves
    id:'SQUIRREL', max:20, hp:4, dmg:1, speed:3.0, wanderInterval:[1.2,3.5], xp:5,
    loot:[{item:'leaf', min:1, max:2, chance:0.5}],
    spawnTest(x,y,getTile){ const here=getTile(x,y); const below=getTile(x,y+1); return here===T.AIR && below===T.LEAF; },
    biome:'forest',
    onUpdate(m,spec,{now,dt,player}){ // quick horizontal dashes along canopy
      if(Math.random()<0.02){ m.vx = (Math.random()<0.5?-1:1)*spec.speed*(0.6+Math.random()*0.4); m.vy *=0.3; }
      // constrain to leaf layer: if below leaves, nudge up
      const underLeaf = MM.world.getTile(Math.floor(m.x), Math.floor(m.y)+1)===T.LEAF;
      if(!underLeaf){ m.vy -= 0.15; }
    }
  });

  registerSpecies({ // Fast herbivore on open grass
    id:'DEER', max:14, hp:12, dmg:3, speed:3.8, wanderInterval:[2,5], xp:12,
    loot:[{item:'leaf', min:1, max:1, chance:0.3}],
    spawnTest(x,y,getTile){ const here=getTile(x,y); const below=getTile(x,y+1); if(here!==T.AIR || below!==T.GRASS) return false; const above=getTile(x,y-1); return above===T.AIR && biomeAt(x)!==2; },
    biome:'plains',
    onUpdate(m,spec,{player,dt,now,aggressive}){ const dx=player.x-m.x; const adx=Math.abs(dx); if(!aggressive && adx<8){ // flee
        const dir = dx>0?-1:1; m.vx += dir*spec.speed*0.6; m.facing = m.vx>=0?1:-1; }
      if(Math.random()<0.01) m.vy -= 0.3; }
  });

  registerSpecies({ // Snow biome predator (pack)
    id:'WOLF', max:10, hp:16, dmg:6, speed:3.4, wanderInterval:[2,5], xp:15,
    loot:[{item:'snow', min:1, max:2, chance:0.5}],
    spawnTest(x,y,getTile){ const here=getTile(x,y); if(here!==T.AIR) return false; const below=getTile(x,y+1); return below===T.SNOW || (below===T.GRASS && biomeAt(x)===2); },
    biome:'snow',
    onUpdate(m,spec,{player,aggressive,dt}){ const dx=player.x-m.x; const dy=player.y-m.y; const dist=Math.hypot(dx,dy)||1; if(aggressive || dist<7){ // pack engage
        m.vx += (dx/dist)*spec.speed*0.9*dt*30; m.vy += (dy/dist)*spec.speed*0.3*dt*20; m.facing=dx>=0?1:-1; if(dist<3) window.MM && MM.mobs && MM.mobs.setAggro('WOLF'); }
      else if(Math.random()<0.01){ m.vx += (Math.random()*2-1)*0.5; }
    }
  });

  registerSpecies({ // Small fast jumper on grass (skittish)
    id:'RABBIT', max:22, hp:5, dmg:2, speed:4.0, wanderInterval:[0.8,2.2], xp:6,
    loot:[{item:'grass', min:1, max:1, chance:0.4}],
    spawnTest(x,y,getTile){ const here=getTile(x,y); const below=getTile(x,y+1); return here===T.AIR && below===T.GRASS && biomeAt(x)!==2; },
    biome:'plains',
    onUpdate(m,spec,{player,aggressive,dt}){ const dx=player.x-m.x; const dist=Math.abs(dx); if(!aggressive && dist<6){ m.vx += (dx>0?-1:1)*spec.speed; m.vy -= 0.4; m.facing = m.vx>=0?1:-1; }
      if(Math.random()<0.02) m.vy -= 0.25; }
  });

  registerSpecies({ // Night bird perched in trees
    id:'OWL', max:8, hp:8, dmg:5, speed:3.0, wanderInterval:[3,8], xp:9,
    loot:[{item:'leaf', min:1, max:1, chance:0.25}],
    spawnTest(x,y,getTile){ const below=getTile(x,y+1); const here=getTile(x,y); return here===T.AIR && below===T.WOOD; },
    biome:'forest',
    onUpdate(m,spec,{player,dt,now,aggressive}){ // Slight horizontal glide, stronger pursuit at night (time simulated via MM.time?)
      if(aggressive){ const dx=player.x-m.x; const dy=player.y-m.y; const dist=Math.hypot(dx,dy)||1; m.vx += (dx/dist)*spec.speed*0.5; m.vy += (dy/dist)*spec.speed*0.15; m.facing=dx>=0?1:-1; }
      else if(Math.random()<0.01){ m.vx += (Math.random()*2-1)*0.4; }
    }
  });

  registerSpecies({ // Sand-edge crustacean
    id:'CRAB', max:18, hp:6, dmg:3, speed:2.2, wanderInterval:[1.5,4.5], xp:5,
    loot:[{item:'sand', min:1, max:2, chance:0.6}],
    spawnTest(x,y,getTile){ const here=getTile(x,y); const below=getTile(x,y+1); if(here!==T.AIR || below!==T.SAND) return false; return getTile(x-1,y+1)===T.WATER || getTile(x+1,y+1)===T.WATER; },
    biome:'shore'
  });

  registerSpecies({ // Deep water predator
    id:'SHARK', max:4, hp:40, dmg:14, speed:3.5, wanderInterval:[2,5], aquatic:true, xp:40,
    loot:[{item:'diamond', min:1, max:1, chance:0.15}],
    spawnTest(x,y,getTile){ const here=getTile(x,y); if(here!==T.WATER) return false; for(let d=1; d<=3; d++){ if(getTile(x,y+d)!==T.WATER) return false; } return getTile(x-2,y)===T.WATER && getTile(x+2,y)===T.WATER; },
    onCreate(m){ initWaterAnchor(m); m.desiredDepth = 2 + (Math.random()*2)|0; },
    habitatUpdate(m, spec, getTile, dt){ enforceAquatic(m, spec, getTile, dt); },
    onUpdate(m,spec,{player,dt}){ // strong pursuit if player in water column horizontally
      const py=Math.floor(player.y); const my=Math.floor(m.y); if(Math.abs(player.x-m.x)<10 && Math.abs(py-my)<3){ const dx=player.x-m.x; const dist=Math.abs(dx)||1; m.vx += (dx/dist)*spec.speed*0.5; m.facing=dx>=0?1:-1; }
    }
  });

  registerSpecies({ // Deep eel: slower but agile vertical
    id:'EEL', max:10, hp:10, dmg:5, speed:2.6, wanderInterval:[1.5,4], aquatic:true, xp:11,
    loot:[{item:'stone', min:1, max:1, chance:0.4}],
    spawnTest(x,y,getTile){ const here=getTile(x,y); if(here!==T.WATER) return false; let stone=false; for(let d=2; d<=5; d++){ const t=getTile(x,y+d); if(t===T.STONE){ stone=true; break; } if(t!==T.WATER) break; } if(!stone) return false; return true; },
    onCreate(m){ initWaterAnchor(m); m.desiredDepth = 3; },
    habitatUpdate(m,spec,getTile,dt){ enforceAquatic(m,spec,getTile,dt); },
    onUpdate(m,spec,{dt}){ // gentle sinusoidal slither
      m.vy += Math.sin(performance.now()*0.004 + m.spawnT*0.002)*0.02; }
  });

  registerSpecies({ // Mountain goat: high elevation
    id:'GOAT', max:12, hp:14, dmg:4, speed:3.3, wanderInterval:[1.8,4.2], xp:13,
    loot:[{item:'snow', min:1, max:1, chance:0.3}],
    spawnTest(x,y,getTile){ const here=getTile(x,y); if(here!==T.AIR) return false; const below=getTile(x,y+1); if(!(below===T.STONE||below===T.SNOW)) return false; return y < 18; },
    biome:'mountain'
  });

  registerSpecies({ // Firefly – ambience (low HP) over grass, pulsating
    id:'FIREFLY', max:26, hp:2, dmg:0, speed:2.0, wanderInterval:[0.6,1.6], xp:2,
    spawnTest(x,y,getTile){ const here=getTile(x,y); const below=getTile(x,y+1); return here===T.AIR && (below===T.GRASS || below===T.LEAF); },
    biome:'plains',
    onUpdate(m,spec,{dt,now}){ if(Math.random()<0.03){ m.vx += (Math.random()*2-1)*0.4; m.vy += (Math.random()*2-1)*0.2; } }
  });


  function registerSpecies(def){
    if(!def || !def.id) return false; if(SPECIES[def.id]) return false; // already exists
    // Fill defaults
    def.max = def.max||10; def.hp = def.hp||5; def.dmg= def.dmg||1; def.speed=def.speed||2.5; def.wanderInterval = def.wanderInterval||[2,5];
    SPECIES[def.id]=def; return true;
  }

  function rand(a,b){ return a + Math.random()*(b-a); }
  function choose(arr){ return arr[(Math.random()*arr.length)|0]; }

  function create(spec, x,y){
    const now = performance.now();
    const m={ id: spec.id, x, y, vx:0, vy:0, hp: spec.hp, state:'idle', tNext: now + rand(spec.wanderInterval[0], spec.wanderInterval[1])*1000, facing:1, spawnT: now, attackCd:0, hitFlashUntil:0, shake:0, tickMod: (Math.random()<0.5?1:0), sleepUntil:0 };
    if(typeof spec.onCreate==='function') spec.onCreate(m, spec);
    addToGrid(m); speciesCounts[spec.id]=(speciesCounts[spec.id]||0)+1; return m; }

  // --- Aquatic helpers (fish) ---
  function initWaterAnchor(m){
    // Determine the top water tile in this column (scan upward until not water)
    let ty = Math.floor(m.y);
    const tx = Math.floor(m.x);
    let topY = ty;
    for(let scan=0; scan<24; scan++){ // safety cap
      const t = MM.world.getTile ? MM.world.getTile(tx, topY-1) : null; // if API exists
      if(t!==T.WATER) break; else topY--;
    }
    m.waterTopY = topY; // y of first water tile at surface (there is air or non-water above waterTopY-1)
    // pick desired depth (1-3 tiles below surface) but ensure within existing water column
    let depth = 1 + (Math.random()*2)|0; // 1 or 2 or maybe 2? adjust range
    // Validate depth: ensure tile exists below; if shallow adjust
    let maxDepth=depth;
    for(let d=1; d<=depth; d++){
      const t = MM.world.getTile ? MM.world.getTile(tx, topY + d) : null;
      if(t!==T.WATER){ maxDepth = d-1; break; }
    }
    if(maxDepth<1) maxDepth=1;
    m.desiredDepth = maxDepth;
    m.nextWaterScan = performance.now() + 4000 + Math.random()*4000;
    m.strandedTime = 0;
  }

  function forceSpawn(specId, player, getTile){ const spec=SPECIES[specId]; if(!spec) return false; if((speciesCounts[specId]||0) >= spec.max) return false; // cap
    // try valid spawn positions first
    for(let tries=0; tries<20; tries++){ const dx=(Math.random()*10 -5); const dy=(Math.random()*6 -3); const tx=Math.floor(player.x+dx); const ty=Math.floor(player.y+dy); if(spec.spawnTest(tx,ty,getTile)){ mobs.push(create(spec, tx+0.5, ty+0.5)); return true; } }
    // fallback: drop directly near player even if test fails
    mobs.push(create(spec, player.x + (Math.random()*2-1), player.y - 0.5)); return true; }

  function countSpecies(id){ return speciesCounts[id]||0; }

  let nextSpawnCheck = 0;
  function trySpawnNearPlayer(player, getTile, now){
    if(now < nextSpawnCheck) return; // throttle globally
    nextSpawnCheck = now + 1200 + Math.random()*800; // 1.2-2s
    for(const key in SPECIES){ const spec=SPECIES[key]; if(countSpecies(spec.id) >= spec.max) continue; if(Math.random()<0.55) continue; // variety
      for(let a=0;a<6;a++){ const dx = (Math.random()<0.5?-1:1)*(8+Math.random()*32); const dy = -6 + Math.random()*12; const tx = Math.floor(player.x + dx); const ty = Math.floor(player.y + dy); if(spec.spawnTest(tx,ty,getTile)){ mobs.push(create(spec, tx+0.5, ty+0.5)); break; } }
    }
  }

  // --- Steering Helpers (must be defined before update uses it) ---
  function applySeparation(m){
    // Look in neighboring grid cells only (same-species simple avoidance)
    const baseKey = m._cellKey; if(!baseKey) return; const [cxStr, cyStr] = baseKey.split(','); const cx=+cxStr, cy=+cyStr;
    for(let gx=cx-1; gx<=cx+1; gx++){
      for(let gy=cy-1; gy<=cy+1; gy++){
        const set = grid.get(gx+','+gy); if(!set) continue; for(const o of set){ if(o===m) continue; if(o.id!==m.id) continue; const dx=m.x-o.x; const dy=m.y-o.y; const d2=dx*dx+dy*dy; const minDist=0.6; if(d2>0 && d2 < minDist*minDist){ const d=Math.sqrt(d2); const push=(minDist-d)/d*0.5; // apply only to m to avoid double-count when o processed later
          m.vx += dx*push; m.vy += dy*push*0.2; }
        }
      }
    }
  }

  function isAggro(specId){ const exp=speciesAggro[specId]; return exp && exp> Date.now(); }

  function setAggro(specId){ speciesAggro[specId] = Date.now() + 5*60*1000; }

  let frame=0; let lastMetricsSample=0; let metrics={count:0, active:0, dtAvg:0};
  function update(dt, player, getTile){ const now = performance.now(); frame++;
    // Despawn far / off-screen old passive mobs (not aggro)
    for(let i=mobs.length-1;i>=0;i--){ const m=mobs[i]; if(m.hp<=0){ removeFromGrid(m); mobs.splice(i,1); continue; } const dist = Math.abs(m.x-player.x); if(dist>220 && !isAggro(m.id)) { removeFromGrid(m); mobs.splice(i,1); continue; } }
    // Spawn attempt occasionally
    trySpawnNearPlayer(player,getTile, now);
    // Precompute separation: basic O(n^2) for small counts (opt: grid neighbor query)
    metrics.count = mobs.length; let active=0;
    for(let i=0;i<mobs.length;i++){
      const m=mobs[i]; const spec=SPECIES[m.id]; if(!spec) continue; const aggressive=isAggro(m.id);
      updateMob(m, spec, {dt, now, aggressive, player, getTile});
  // Separation using spatial grid neighbors (same species only)
  applySeparation(m, i);
      // Friction / damping
      const damp = aggressive? 0.9 : 0.92; m.vx*=damp; m.vy*= (spec.aquatic? 0.95 : 0.92);
      // Clamp speeds
      const maxS = spec.speed * (aggressive?1.4:1); const sp=Math.hypot(m.vx,m.vy); if(sp>maxS){ const s=maxS/sp; m.vx*=s; m.vy*=s; }
      // Sleep logic for far, non-aggro mobs: update position only sparsely
      if(!aggressive){
        const distP = Math.abs(m.x - player.x) + Math.abs(m.y - player.y);
        if(distP > 140 && (frame & 3)!== (m.tickMod||0)){ continue; } // skip this frame
      }
      active++;
      m.x += m.vx*dt; m.y += m.vy*dt;
  // Habitat constraints via species hook
  if(typeof spec.habitatUpdate==='function') spec.habitatUpdate(m, spec, getTile, dt);
      updateGridCell(m);
      if(m.shake>0) m.shake=Math.max(0,m.shake-dt*10);
      // Contact damage + bounce (touch) independent of attack cooldown
      const dxP = player.x - m.x; const dyP = player.y - m.y; const distTouch = Math.hypot(dxP,dyP);
      if(distTouch < 0.9){ // bounce push
        const nx=dxP/(distTouch||1); const ny=dyP/(distTouch||1);
        player.vx += nx*3*dt; player.vy += ny*2*dt; // gentle continuous push
        if(isAggro(m.id)){ if(m.attackCd>0) m.attackCd-=dt; if(m.attackCd<=0){ damagePlayer(spec.dmg, m.x, m.y); m.attackCd=0.8 + Math.random()*0.5; } }
      }
  }
  metrics.active = active;
  if(now - lastMetricsSample > 1000){ metrics.dtAvg = (metrics.dtAvg*0.7 + dt*0.3); lastMetricsSample = now; if(window.__mobDebug){ window.__mobMetrics = {...metrics, frame}; } }
  }
  function updateMob(m, spec, ctx){
    if(typeof spec.onUpdate==='function'){ spec.onUpdate(m, spec, ctx); return; }
    const {dt, now, aggressive, player} = ctx; const toPlayerX=player.x - m.x; const toPlayerY=player.y - m.y; const distP=Math.hypot(toPlayerX,toPlayerY)||1;
    if(aggressive){
      const desiredVx = (toPlayerX/distP)*spec.speed*0.9; m.vx += (desiredVx - m.vx)*Math.min(1, dt*4);
      const desiredVy = spec.aquatic? ((toPlayerY)*0.8) : (toPlayerY*0.6);
      m.vy += (desiredVy - m.vy)*Math.min(1, dt*2.5);
      m.facing = toPlayerX>=0?1:-1;
    } else {
      if(now>m.tNext){
        m.tNext = now + rand(spec.wanderInterval[0], spec.wanderInterval[1])*1000;
        if(Math.random()<0.65){ const ang = Math.random()*Math.PI*2; const speed = spec.speed*(0.3+Math.random()*0.7); m.vx = Math.cos(ang)*speed; m.vy = Math.sin(ang)*speed* (spec.aquatic?0.6:0.35); m.facing = m.vx>=0?1:-1; } else { m.vx*=0.4; m.vy*=0.4; }
      }
      const baseBob = spec.aquatic? Math.sin(now*0.002 + m.spawnT*0.0007)*0.4 : Math.sin(now*0.003 + m.spawnT*0.001)*0.25;
      m.vy += (baseBob - m.vy)*Math.min(1, dt*0.8);
    }
  }

  function draw(ctx, TILE, camX,camY, zoom){
    ctx.save(); ctx.imageSmoothingEnabled=false;
    for(const m of mobs){ const screenX = (m.x*TILE); const screenY=(m.y*TILE); ctx.save();
      // shake offset
      if(m.shake>0){ const ang=Math.random()*Math.PI*2; const mag=m.shake*1.5; ctx.translate(Math.cos(ang)*mag, Math.sin(ang)*mag); }
      // flash: if hit recently, overlay lighten
      const now=performance.now(); const flashing= now < m.hitFlashUntil; // basic sprite
      if(m.id==='BIRD'){
        ctx.fillStyle= flashing? '#ffffff' : '#ffe07a'; ctx.fillRect(screenX-4, screenY-6,8,6); // body
        ctx.fillStyle='#ff9b00'; ctx.fillRect(screenX+(m.facing>0?2:-4), screenY-4,3,2); // beak
        ctx.fillStyle='#222'; ctx.fillRect(screenX+(m.facing>0?1:-2), screenY-5,2,2);
      } else if(m.id==='FISH'){
        ctx.fillStyle= flashing? '#bcecff' : '#5bc0ff'; ctx.fillRect(screenX-5, screenY-3,10,6); ctx.fillStyle='#1d6b9c'; ctx.fillRect(screenX+(m.facing>0?4:-6), screenY-2,2,4);
        ctx.fillStyle='#fff'; ctx.fillRect(screenX+(m.facing>0?2:-4), screenY-2,2,2); ctx.fillStyle='#000'; ctx.fillRect(screenX+(m.facing>0?2:-4), screenY-2,1,1);
      } else if(m.id==='BEAR'){
        ctx.fillStyle= flashing? '#e8d5c0':'#7b5135'; ctx.fillRect(screenX-7, screenY-8,14,10); ctx.fillRect(screenX-5, screenY-10,10,4); // head hump
        ctx.fillStyle='#000'; ctx.fillRect(screenX+(m.facing>0?2:-3), screenY-6,2,2);
      } else if(m.id==='SQUIRREL'){
        ctx.fillStyle= flashing? '#ffe3b5':'#b07040'; ctx.fillRect(screenX-3, screenY-5,6,5); ctx.fillRect(screenX+(m.facing>0?2:-4), screenY-6,3,3); // head
        ctx.fillStyle='#d19050'; ctx.fillRect(screenX-(m.facing>0?5:-1), screenY-6,4,4); // tail
      } else if(m.id==='DEER'){
        ctx.fillStyle= flashing? '#fff2e0':'#996633'; ctx.fillRect(screenX-5, screenY-7,10,8); ctx.fillStyle='#664422'; ctx.fillRect(screenX+(m.facing>0?2:-4), screenY-8,3,3); // head
        ctx.fillStyle='#ccb28a'; ctx.fillRect(screenX+(m.facing>0?1:-3), screenY-9,1,2); ctx.fillRect(screenX+(m.facing>0?3:-5), screenY-9,1,2); // antlers
      } else if(m.id==='WOLF'){
        ctx.fillStyle= flashing? '#f5f5f5':'#bcbcbc'; ctx.fillRect(screenX-5, screenY-6,10,7); ctx.fillStyle='#888'; ctx.fillRect(screenX+(m.facing>0?2:-4), screenY-5,3,3); // head
      } else if(m.id==='RABBIT'){
        ctx.fillStyle= flashing? '#ffffff':'#dddddd'; ctx.fillRect(screenX-3, screenY-4,6,4); ctx.fillStyle='#bbb'; ctx.fillRect(screenX+(m.facing>0?1:-3), screenY-6,2,3); // ears
      } else if(m.id==='OWL'){
        ctx.fillStyle= flashing? '#ffffff':'#c8a860'; ctx.fillRect(screenX-4, screenY-7,8,7); ctx.fillStyle='#704c10'; ctx.fillRect(screenX+(m.facing>0?1:-3), screenY-6,3,3);
      } else if(m.id==='CRAB'){
        ctx.fillStyle= flashing? '#ffdddd':'#c23a2e'; ctx.fillRect(screenX-4, screenY-3,8,4); ctx.fillStyle='#8a1f17'; ctx.fillRect(screenX-6, screenY-2,2,2); ctx.fillRect(screenX+4, screenY-2,2,2); // claws
      } else if(m.id==='SHARK'){
        ctx.fillStyle= flashing? '#d0f4ff':'#507c94'; ctx.fillRect(screenX-8, screenY-4,16,8); ctx.fillStyle='#2a4a5a'; ctx.fillRect(screenX+(m.facing>0?6:-8), screenY-2,2,4); // tail
      } else if(m.id==='EEL'){
        ctx.fillStyle= flashing? '#e0ffe0':'#2f8a4a'; ctx.fillRect(screenX-6, screenY-2,12,4);
      } else if(m.id==='GOAT'){
        ctx.fillStyle= flashing? '#fafafa':'#c9c4b5'; ctx.fillRect(screenX-5, screenY-6,10,6); ctx.fillStyle='#9b968a'; ctx.fillRect(screenX+(m.facing>0?2:-4), screenY-5,3,3);
      } else if(m.id==='FIREFLY'){
  const pulse = (Math.sin(performance.now()*0.01 + m.spawnT*0.005)*0.5+0.5);
  ctx.fillStyle= flashing? '#fffbb0': `rgba(255,224,102,${0.5+0.5*pulse})`; ctx.fillRect(screenX-2, screenY-2,4,3); ctx.fillStyle=`rgba(255,213,0,${0.6+0.4*pulse})`; ctx.fillRect(screenX-1, screenY-1,2,2);
      }
      // HP bar small
      if(m.hp < (SPECIES[m.id]?.hp||1)){
        const maxHp = SPECIES[m.id].hp; const w=12; const frac=m.hp/maxHp; ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(screenX-w/2, screenY-10, w,3); ctx.fillStyle='#ff5252'; ctx.fillRect(screenX-w/2, screenY-10, w*frac,3);
      }
      ctx.restore(); }
    ctx.restore();
  }

  function findAt(x,y){ // tile space coords using spatial grid
    const wx = x+0.5, wy = y+0.5; const k=cellKey(wx,wy); const set=grid.get(k); if(!set) return null; for(const m of set){ if(Math.abs(m.x-wx)<0.8 && Math.abs(m.y-wy)<0.8) return m; } return null; }

  function attackAt(tileX,tileY){ const m=findAt(tileX,tileY); if(!m) return false; damageMob(m, 3); setAggro(m.id); return true; }

  function damageMob(m,amount){ if(m.hp<=0) return; m.hp-=amount; m.hitFlashUntil = performance.now()+120; m.shake = 0.6; if(m.hp<=0){ m.hp=0; m.shake=1; onMobDeath(m); }
  }

  function onMobDeath(m){
    const spec = SPECIES[m.id]; if(!spec) return;
    // XP gain
    if(window.player && typeof player.xp==='number'){ player.xp += spec.xp||1; }
    // Loot: push into lootInbox (if present) else directly inventory if matches tile drops
    if(spec.loot && Array.isArray(spec.loot)){
      const drops=[]; for(const entry of spec.loot){ if(Math.random() <= (entry.chance||1)){ const count = entry.min + ((entry.max && entry.max>entry.min)? (Math.random()*(entry.max-entry.min+1))|0 : 0); drops.push({item:entry.item, qty: count||entry.min||1}); } }
      if(drops.length){
        if(window.lootInbox){ for(const d of drops) window.lootInbox.push(d); if(window.updateLootInboxIndicator) updateLootInboxIndicator(); }
        else if(window.inv){ for(const d of drops){ if(typeof inv[d.item]==='number') inv[d.item]+=d.qty; } if(window.updateInventory) updateInventory(); }
      }
    }
  }

  function damagePlayer(amount, srcX, srcY){ if(typeof window.player!=='object') return; if(player.hpInvul && performance.now()<player.hpInvul) return; player.hp -= amount; player.hpInvul = performance.now()+600; // knockback
    if(typeof srcX==='number' && typeof srcY==='number'){ const dx = (player.x - srcX); const dy=(player.y - srcY); const d = Math.hypot(dx,dy)||1; player.vx += (dx/d)*4; player.vy -= 2.5; }
    if(player.hp<=0){ player.hp=0; playerDead(); }
  }

  function playerDead(){ // simple respawn
    const msg = window.msg || function(){}; msg('Zginąłeś – respawn'); player.hp = player.maxHp; // drop nothing for now
    // relocate
    if(window.placePlayer) placePlayer(true); }

  const AGGRO_SKEW_GRACE_MS = 30000; // accept up to 30s negative skew
  function serialize(){ const now=Date.now(); const rel={}; for(const k in speciesAggro){ const rem = speciesAggro[k]-now; if(rem>0) rel[k]=rem; }
    return { v:1, list: mobs.map(m=>({id:m.id,x:m.x,y:m.y,vx:m.vx,vy:m.vy,hp:m.hp,state:m.state,facing:m.facing,spawnT:m.spawnT,attackCd:m.attackCd,waterTopY:m.waterTopY,desiredDepth:m.desiredDepth})), aggro:{mode:'rel', m:rel} }; }
  function deserialize(data){ // clear
    for(const m of mobs) removeFromGrid(m); mobs.length=0; // reset live counts before rebuild
    for(const k in speciesCounts) delete speciesCounts[k];
    if(data && Array.isArray(data.list)){
      for(const r of data.list){ if(!SPECIES[r.id]) continue; const spec=SPECIES[r.id]; const m=create(spec, r.x, r.y); m.vx=r.vx||0; m.vy=r.vy||0; m.hp=r.hp||spec.hp; m.state=r.state||'idle'; m.facing=r.facing||1; m.spawnT=r.spawnT||performance.now(); m.attackCd=r.attackCd||0;
        if(spec.aquatic){ if(typeof r.waterTopY==='number') m.waterTopY=r.waterTopY; if(typeof r.desiredDepth==='number') m.desiredDepth=r.desiredDepth; m.nextWaterScan = performance.now() + 3000; m.strandedTime=0; }
        mobs.push(m);
      }
    }
    for(const k in speciesAggro) delete speciesAggro[k];
    if(data && data.aggro){ const now=Date.now(); if(data.aggro.mode==='rel' && data.aggro.m){ for(const k in data.aggro.m){ const rem=data.aggro.m[k]; if(typeof rem==='number' && rem>0){ speciesAggro[k]= now + Math.min(rem, 5*60*1000); } }
      } else { // legacy absolute timestamps
        for(const k in data.aggro){ const exp=data.aggro[k]; if(typeof exp==='number'){ if(exp>now) speciesAggro[k]=exp; else if(now-exp < AGGRO_SKEW_GRACE_MS){ speciesAggro[k]= now + 5000; } }
        }
      }
  }

  function enforceAquatic(m, spec, getTile, dt){
    if(!m.waterTopY || performance.now()>m.nextWaterScan){ initWaterAnchor(m); }
    const tx = Math.floor(m.x); const ty=Math.floor(m.y);
    const here = getTile(tx,ty);
    if(here!==T.WATER){
      m.strandedTime += dt;
      let best=null, bestD=1e9;
      for(let dy=-3; dy<=3; dy++){
        for(let dx=-5; dx<=5; dx++){
          const nx=tx+dx, ny=ty+dy; const t=getTile(nx,ny); if(t===T.WATER){ const d=dx*dx+dy*dy; if(d<bestD){ bestD=d; best={x:nx+0.5,y:ny+0.5}; } }
        }
      }
      if(best){
        m.vx += (best.x - m.x)*3*dt; m.vy += (best.y - m.y)*3*dt;
        if(bestD>25){ m.x=best.x; m.y=best.y; m.vx*=0.3; m.vy*=0.3; }
        m.strandedTime = 0;
      } else {
        m.vx *= 0.6; m.vy += 0.15; if(m.strandedTime>6){ m.hp=0; }
      }
      return;
    } else { m.strandedTime = 0; }
    if(typeof m.waterTopY==='number'){
      const topTile = getTile(Math.floor(m.x), m.waterTopY);
      if(topTile!==T.WATER){ initWaterAnchor(m); }
      const targetY = m.waterTopY + (m.desiredDepth||1) + Math.sin(performance.now()*0.001 + m.spawnT*0.0003)*0.2;
      const dy = targetY - m.y; m.vy += dy * Math.min(1, dt*2.2);
      const above = getTile(Math.floor(m.x), Math.floor(m.y-0.6));
      if(above!==T.WATER){ if(m.vy < 0) m.vy *= 0.2; m.vy += 0.04; }
    }
    if(Math.abs(m.vx)>0.01){
      const aheadX = Math.floor(m.x + Math.sign(m.vx)*0.7);
      const aheadY = Math.floor(m.y);
      const ahead = getTile(aheadX, aheadY);
      if(ahead!==T.WATER){
        m.vx *= -0.55; m.vy += (Math.random()*0.6 -0.3);
        const inwardX = Math.floor(m.x - Math.sign(m.vx)*1);
        if(getTile(inwardX, aheadY)===T.WATER){ m.vx += (inwardX + 0.5 - m.x)*0.4; }
      }
    }
    const maxS = spec.speed * 1.2; const sp=Math.hypot(m.vx,m.vy); if(sp>maxS){ const s=maxS/sp; m.vx*=s; m.vy*=s; }
  }
  }

  MM.mobs = { update, draw, attackAt, serialize, deserialize, setAggro, speciesAggro, forceSpawn, species: Object.keys(SPECIES), registerSpecies, metrics:()=>metrics };
  try{ window.dispatchEvent(new CustomEvent('mm-mobs-ready')); }catch(e){}
})();
// (File end)

