// Basic mob / animal system (birds, fish) with aggression propagation.
// Exposes MM.mobs API: {update, draw, serialize, deserialize, attackAt, damagePlayer}
(function(){
  const MM = window.MM = window.MM || {};
  const TILE = MM.TILE;
  const T = MM.T;
  const WORLD = MM.world;
  const INFO = MM.INFO;
  const isSolid = MM.isSolid;
  // Helper predicates
  const isWater = t => t===T.WATER;
  function isSolidGround(t){ return isSolid(t) && t!==T.LEAF; }

  // Precomputed color variant helper (once per mob instead of per-frame string math)
  function variantColor(spawnT, shiftBits, a, b){
    const t = ((spawnT>>>shiftBits)&7)/7; // 0..1 discrete steps
    const ca=parseInt(a.slice(1),16), cb=parseInt(b.slice(1),16);
    const r=((ca>>16)&255)+(((cb>>16)&255)-((ca>>16)&255))*t;
    const g=((ca>>8)&255)+(((cb>>8)&255)-((ca>>8)&255))*t;
    const b2=(ca&255)+((cb&255)-(ca&255))*t;
    return '#'+((r|0).toString(16).padStart(2,'0'))+((g|0).toString(16).padStart(2,'0'))+((b2|0).toString(16).padStart(2,'0'));
  }

  // Color jitter helpers to produce richer per-mob palette variation
  function hexToRgb(hex){ const n=parseInt(hex.slice(1),16); return {r:(n>>16)&255,g:(n>>8)&255,b:n&255}; }
  function rgbToHex(r,g,b){ return '#'+[r,g,b].map(v=>Math.max(0,Math.min(255,v|0)).toString(16).padStart(2,'0')).join(''); }
  function rgbToHsl(r,g,b){ r/=255; g/=255; b/=255; const max=Math.max(r,g,b), min=Math.min(r,g,b); let h,s,l=(max+min)/2; if(max===min){ h=s=0; } else { const d=max-min; s=l>0.5? d/(2-max-min): d/(max+min); switch(max){ case r: h=(g-b)/d+(g<b?6:0); break; case g: h=(b-r)/d+2; break; default: h=(r-g)/d+4; } h/=6; } return {h,s,l}; }
  function hslToRgb(h,s,l){ let r,g,b; if(s===0){ r=g=b=l; } else { const hue2rgb=(p,q,t)=>{ if(t<0) t+=1; if(t>1) t-=1; if(t<1/6) return p+(q-p)*6*t; if(t<1/2) return q; if(t<2/3) return p+(q-p)*(2/3-t)*6; return p; }; const q=l<0.5? l*(1+s): l+s-l*s; const p=2*l-q; r=hue2rgb(p,q,h+1/3); g=hue2rgb(p,q,h); b=hue2rgb(p,q,h-1/3); } return {r:(r*255)|0,g:(g*255)|0,b:(b*255)|0}; }
  function jitterColor(baseHex, opts){ const {h=12, s=0.12, l=0.10} = opts||{}; try{ const {r,g,b}=hexToRgb(baseHex); let {h:hh,s:ss,l:ll}=rgbToHsl(r,g,b); const dh=((Math.random()*2-1)*h)/360; const ds=1+ (Math.random()*2-1)*s; const dl=1+ (Math.random()*2-1)*l; hh=(hh+dh+1)%1; ss=Math.max(0,Math.min(1, ss*ds)); ll=Math.max(0,Math.min(1, ll*dl)); const {r:rr,g:gg,b:bb}=hslToRgb(hh,ss,ll); return rgbToHex(rr,gg,bb); }catch(e){ return baseHex; } }

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
  id: 'BIRD', max: 18, hp: 6, dmg: 4, speed: 3.2, wanderInterval: [2,6], xp:4, flying:true,
      variant:{shift:1, from:'#f5d16a', to:'#ffe07a'},
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
      variant:{shift:2, from:'#4eb2f1', to:'#63c6ff'},
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
  // biomeAt returns extended biome ids now: 0 forest,1 plains,2 snow,3 desert,4 swamp,5 sea,6 lake,7 mountain
  function biomeAt(x){ try{ return WG && WG.biomeType ? WG.biomeType(x) : 1; }catch(e){ return 1; } }

  registerSpecies({ // Large forest predator near trees
  id:'BEAR', max:6, hp:30, dmg:10, speed:2.0, wanderInterval:[3,7], xp:25, ground:true,
  move:{jumpVel:-2.6, maxClimb:1, avoidWater:true},
  variant:{shift:3, from:'#6b4a30', to:'#7d573b'},
  body:{w:1.6,h:1.2},
    loot:[{item:'wood', min:1, max:2, chance:0.4}],
    spawnTest(x,y,getTile){ const here=getTile(x,y); if(here!==T.AIR) return false; const below=getTile(x,y+1); if(!(below===T.GRASS||below===T.WOOD||below===T.LEAF)) return false; // require trunk or leaf adjacency
      const trunk = getTile(x-1,y+1)===T.WOOD || getTile(x+1,y+1)===T.WOOD; return trunk && biomeAt(x)===0; },
    biome:'forest',
    onUpdate(m,spec,{dt,player,aggressive,speed}){ // slow patrol, lunge when close (horizontal only, grounded)
      const sp = (speed||spec.speed||2);
      const dx=player.x-m.x; const dist=Math.abs(dx)||1;
      if(dist<6){ m.vx += (dx/dist)*sp*0.4*dt*30; m.facing = dx>=0?1:-1; if(dist<1.7){ m.vx += (dx/dist)*sp*0.9; } }
      else if(Math.random()<0.005){ m.vx += (Math.random()*2-1)*0.6; }
    }
  });

  registerSpecies({ // Tree-dwelling small mammal on leaves
  id:'SQUIRREL', max:20, hp:4, dmg:1, speed:3.0, wanderInterval:[1.2,3.5], xp:5, ground:true,
  move:{jumpVel:-3.2, maxClimb:2, avoidWater:true, preferLeaf:true},
  body:{w:0.8,h:0.7},
    loot:[{item:'leaf', min:1, max:2, chance:0.5}],
    spawnTest(x,y,getTile){ const here=getTile(x,y); const below=getTile(x,y+1); return here===T.AIR && below===T.LEAF; },
    biome:'forest',
    onUpdate(m,spec,{now,dt,player,speed}){ // quick horizontal dashes along canopy
      if(Math.random()<0.02){ m.vx = (Math.random()<0.5?-1:1)*(speed||spec.speed)*(0.6+Math.random()*0.4); m.vy *=0.3; }
      // constrain to leaf layer: if below leaves, nudge up
      const underLeaf = MM.world.getTile(Math.floor(m.x), Math.floor(m.y)+1)===T.LEAF;
      if(!underLeaf){ // treat like ground animal: ensure downward grav not cancelled so it stands
        if(m.onGround){ // occasional hop with varied height
          if(Math.random()<0.04){ m.vy = (spec.move.jumpVel||-3.2) * (m.jumpMul||1) * (0.85 + Math.random()*0.3); }
          else m.vy=0;
        }
      }
    }
  });

  registerSpecies({ // Fast herbivore on open grass
  id:'DEER', max:14, hp:12, dmg:3, speed:3.8, wanderInterval:[2,5], xp:12, ground:true,
  move:{jumpVel:-3.6, maxClimb:1, avoidWater:true},
  body:{w:1.4,h:1.1},
    loot:[{item:'leaf', min:1, max:1, chance:0.3}],
    spawnTest(x,y,getTile){ const here=getTile(x,y); const below=getTile(x,y+1); if(here!==T.AIR || below!==T.GRASS) return false; const above=getTile(x,y-1); return above===T.AIR && biomeAt(x)!==2; },
    biome:'plains',
  onUpdate(m,spec,{player,dt,now,aggressive,speed}){ const dx=player.x-m.x; const adx=Math.abs(dx); if(!aggressive && adx<8){ // flee
    const sp = (speed||spec.speed||2);
    const dir = dx>0?-1:1; m.vx += dir*sp*0.6; m.facing = m.vx>=0?1:-1; } }
  });

  registerSpecies({ // Snow biome predator (pack)
  id:'WOLF', max:10, hp:16, dmg:6, speed:3.4, wanderInterval:[2,5], xp:15, ground:true,
  move:{jumpVel:-4.0, maxClimb:1, avoidWater:true},
  variant:{shift:4, from:'#bcbcbc', to:'#d6d6d6'},
  body:{w:1.4,h:1.0},
    loot:[{item:'snow', min:1, max:2, chance:0.5}],
    spawnTest(x,y,getTile){ const here=getTile(x,y); if(here!==T.AIR) return false; const below=getTile(x,y+1); return below===T.SNOW || (below===T.GRASS && biomeAt(x)===2); },
    biome:'snow',
    onUpdate(m,spec,{player,aggressive,dt,speed}){ const spd=(speed||spec.speed||2); const dx=player.x-m.x; const adx=Math.abs(dx)||1; const biteGap=0.9; // stop at ~1 tile distance
      if(aggressive || adx<8){
        // Desired stand-off: approach until at bite gap, then hover
        if(adx > biteGap){
          const dir = dx>0?1:-1; m.vx = dir * spd * 0.9; m.facing = dir; }
        else {
          // within bite distance: slow / minor circling damp
          m.vx *= 0.6; if(Math.abs(m.vx)<0.05) m.vx = 0; m.facing = dx>=0?1:-1; }
        if(adx<3) window.MM && MM.mobs && MM.mobs.setAggro('WOLF');
      } else if(Math.random()<0.01){ m.vx += (Math.random()*2-1)*0.4 * (spd/ (spec.speed||1)); }
    }
  });

  registerSpecies({ // Small fast jumper on grass (skittish)
  id:'RABBIT', max:22, hp:5, dmg:2, speed:4.0, wanderInterval:[0.8,2.2], xp:6, ground:true,
  move:{jumpVel:-5.0, maxClimb:1, avoidWater:true},
  body:{w:0.8,h:0.7},
    loot:[{item:'grass', min:1, max:1, chance:0.4}],
    spawnTest(x,y,getTile){ const here=getTile(x,y); const below=getTile(x,y+1); return here===T.AIR && below===T.GRASS && biomeAt(x)!==2; },
    biome:'plains',
    onUpdate(m,spec,{player,aggressive,dt}){ const dx=player.x-m.x; const adx=Math.abs(dx); const jumpVel = (spec.move && spec.move.jumpVel) || -4; const now=performance.now();
      if(!m._nextJumpAt) m._nextJumpAt = 0;
      if(!aggressive && adx<6 && m.onGround && now>m._nextJumpAt){ // flee hop with randomness
        const dir = dx>0?-1:1; m.vx = dir * (spec.speed*(m.speedMul||1)) * (0.8+Math.random()*0.4); m.vy = jumpVel * (m.jumpMul||1) * (0.85 + Math.random()*0.3); m.facing = dir; m._nextJumpAt = now + 400 + Math.random()*300; return; }
      // Occasional idle hop (rarer)
      if(m.onGround && now>m._nextJumpAt && Math.random()<0.01){ m.vy = jumpVel * (m.jumpMul||1) * (0.45 + Math.random()*0.25); m._nextJumpAt = now + 500 + Math.random()*600; }
    }
  });

  registerSpecies({ // Night bird perched in trees
  id:'OWL', max:8, hp:8, dmg:5, speed:3.0, wanderInterval:[3,8], xp:9, flying:true,
    loot:[{item:'leaf', min:1, max:1, chance:0.25}],
    spawnTest(x,y,getTile){ const below=getTile(x,y+1); const here=getTile(x,y); return here===T.AIR && below===T.WOOD; },
    biome:'forest',
    onUpdate(m,spec,{player,dt,now,aggressive}){ // Slight horizontal glide, stronger pursuit at night (time simulated via MM.time?)
      if(aggressive){ const dx=player.x-m.x; const dy=player.y-m.y; const dist=Math.hypot(dx,dy)||1; m.vx += (dx/dist)*spec.speed*0.5; m.vy += (dy/dist)*spec.speed*0.15; m.facing=dx>=0?1:-1; }
      else if(Math.random()<0.01){ m.vx += (Math.random()*2-1)*0.4; }
    }
  });

  registerSpecies({ // Sand-edge crustacean
    id:'CRAB', max:18, hp:6, dmg:3, speed:2.2, wanderInterval:[1.5,4.5], xp:5, ground:true,
  move:{jumpVel:-2.0, maxClimb:0.5, avoidWater:false},
  body:{w:1.0,h:0.6},
    loot:[{item:'sand', min:1, max:2, chance:0.6}],
    spawnTest(x,y,getTile){ const here=getTile(x,y); const below=getTile(x,y+1); if(here!==T.AIR || below!==T.SAND) return false; return getTile(x-1,y+1)===T.WATER || getTile(x+1,y+1)===T.WATER; },
    biome:'shore'
      // end update
  });

  registerSpecies({ // Deep water predator
  id:'SHARK', max:4, hp:40, dmg:14, speed:3.5, wanderInterval:[2,5], aquatic:true, xp:40,
  variant:{shift:5, from:'#4d7690', to:'#5c87a2'},
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
    id:'GOAT', max:12, hp:14, dmg:4, speed:3.3, wanderInterval:[1.8,4.2], xp:13, ground:true,
  move:{jumpVel:-5.2, maxClimb:2.2, avoidWater:true},
  body:{w:1.2,h:1.0},
    loot:[{item:'snow', min:1, max:1, chance:0.3}],
    spawnTest(x,y,getTile){ const here=getTile(x,y); if(here!==T.AIR) return false; const below=getTile(x,y+1); if(!(below===T.STONE||below===T.SNOW)) return false; return y < 18; },
    biome:'mountain'
  });

  registerSpecies({ // Firefly – ambience (low HP) over grass, pulsating
    id:'FIREFLY', max:26, hp:2, dmg:0, speed:2.0, wanderInterval:[0.6,1.6], xp:2, flying:true,
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
  // Per-entity variability
  m.scale = 0.75 + Math.random()*0.25; // 0.75..1.0 visual & collider scaling
  m.speedMul = 0.75 + Math.random()*0.25; // 0.75..1.0 movement speed
  m.jumpMul = 0.75 + Math.random()*0.25; // 0.75..1.0 jump strength
  // Natural lifespan to avoid overpopulation: base span per species or default, scaled 0.5..1.5
  const BASE_LIFE_SEC = (spec.lifeSpanSec && spec.lifeSpanSec>0) ? spec.lifeSpanSec : 120; // default 2 minutes
  const lifeFactor = 0.5 + Math.random()*1.0; // 0.5..1.5
  m.lifeEndAt = now + BASE_LIFE_SEC * lifeFactor * 1000;
  const decayWindow = (4 + Math.random()*8) * 1000; // 4..12s fadeout
  m.decayStartAt = Math.max(now + 2000, m.lifeEndAt - decayWindow);
  if(spec.variant){
    const col = variantColor(m.spawnT, spec.variant.shift, spec.variant.from, spec.variant.to);
    m.baseColor = jitterColor(col, {h:16, s:0.20, l:0.16});
  }
  if(!m.baseColor){
    const BASE = { SQUIRREL:'#b07040', DEER:'#9c6a39', RABBIT:'#dddddd', OWL:'#c8a860', CRAB:'#c23a2e', EEL:'#2f8a4a', GOAT:'#c9c4b5', BEAR:'#6b4a30', WOLF:'#bcbcbc', FISH:'#4eb2f1', BIRD:'#f5d16a' };
    const base = BASE[spec.id] || '#a8a8a8';
    m.baseColor = jitterColor(base, {h:12, s:0.14, l:0.10});
  }
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

  // Aquatic enforcement (moved earlier so it's definitely defined before any habitatUpdate calls)
  function enforceAquatic(m, spec, getTile, dt){
    const nowP = performance.now();
    if(!m.waterTopY || nowP>m.nextWaterScan){ initWaterAnchor(m); }
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
  const targetY = m.waterTopY + (m.desiredDepth||1) + Math.sin(nowP*0.001 + m.spawnT*0.0003)*0.2;
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
  const maxS = (spec.speed * (m.speedMul||1)) * 1.2; const sp=Math.hypot(m.vx,m.vy); if(sp>maxS){ const s=maxS/sp; m.vx*=s; m.vy*=s; }
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
      // Natural lifespan: apply health decay when past decayStartAt; ensure it runs before far-sleep skip
      if(m.decayStartAt && now >= m.decayStartAt){
        const total = Math.max(0.5, ((m.lifeEndAt||now) - m.decayStartAt)/1000); // seconds window
        const rate = (spec.hp||5) / total; // hp per second to reach 0 by lifeEndAt
        m.hp -= rate * dt; if(m.hp <= 0){ m.hp = 0; m._naturalDeath = true; }
      }
      // Prepare player-like physics state for ground mobs
      const isGroundMob = !!spec.ground && !spec.aquatic && !spec.flying;
      let preVX=m.vx, preVY=m.vy, prevOnGround = m.onGround||false;
      m._wantJump=false;
      // Run species AI / behavior first
      updateMob(m, spec, {dt, now, aggressive, player, getTile});
      if(isGroundMob){
        // Interpret AI changes: any upward impulse (vy<-1) becomes a jump intent
        if(m.vy < -1){ m._wantJump=true; }
        // Desired horizontal velocity coming from AI modifications (mutable for heuristics)
        let desired = m.vx;
        m.vx = preVX; // restore actual velocity; desired used for acceleration targeting
  const MOVE = MM.MOVE || {ACC:32,FRICTION:28,MAX:6,JUMP:-9,GRAV:20};
  const maxSpeed = (spec.speed || MOVE.MAX) * (m.speedMul||1);
  const speedRatio = maxSpeed / (MOVE.MAX||6);
        // Environmental heuristics (water avoidance / obstacle climb) prior to acceleration
        if(spec.move){
          // Water avoidance: if about to step into water, turn/slow
            if(spec.move.avoidWater){
              const dir = desired>0?1: (desired<0?-1:0);
              if(dir!==0){
                const aheadX = Math.floor(m.x + dir*0.6);
                const footY = Math.floor(m.y+0.5);
                const belowAhead = getTile(aheadX, footY+1);
                if(belowAhead===T.WATER){
                  // Try opposite side if it's not water; else just stop
                  const oppBelow = getTile(Math.floor(m.x - dir*0.6), footY+1);
                  if(oppBelow!==T.WATER) desired = -desired*0.8; else desired *=0.2;
                }
              }
            }
          // Obstacle climb: detect low barrier and request jump if climbable
            if(prevOnGround && Math.abs(desired)>0.15 && spec.move.maxClimb>0){
              const dir = desired>0?1:-1;
              const baseX = Math.floor(m.x + dir*0.6);
              const footY = Math.floor(m.y+0.5);
              const barrier = getTile(baseX, footY); // tile at body level ahead
              if(isSolidGround(barrier)){
                const maxH = Math.ceil(spec.move.maxClimb);
                for(let h=1; h<=maxH; h++){
                  const space = getTile(baseX, footY - h);
                  if(space===T.AIR || space===T.LEAF){
                    // Found climbable gap within maxClimb
                    m._wantJump = true; // mark jump intent
                    break;
                  }
                  if(isSolidGround(space) && h===maxH){
                    // Fully blocked; stop desired to avoid pushing
                    desired = 0;
                  }
                }
              }
            }
        }
        const diff = desired - m.vx;
        if(Math.abs(desired) > 0.05){
          const accel = MOVE.ACC * speedRatio * dt * Math.sign(diff);
            if(Math.abs(accel) > Math.abs(diff)) m.vx = desired; else m.vx += accel;
        } else { // friction when no desired input
          const fr = MOVE.FRICTION * dt;
          if(Math.abs(m.vx) <= fr) m.vx=0; else m.vx -= fr * Math.sign(m.vx);
        }
        // Cap horizontal speed
        if(Math.abs(m.vx) > maxSpeed) m.vx = maxSpeed * Math.sign(m.vx);
        // Jump execution (uses spec.move.jumpVel or MOVE.JUMP)
        if(m._wantJump && prevOnGround){
          let jv = (spec.move && spec.move.jumpVel) ? spec.move.jumpVel : (MM.MOVE ? MM.MOVE.JUMP : -9) * (0.7 + 0.3*speedRatio);
          jv *= (m.jumpMul||1);
          if(m.id==='RABBIT' || m.id==='SQUIRREL'){ jv *= (0.85 + Math.random()*0.3); }
          m.vy = jv;
        } else {
          m.vy = preVY; // restore pre-AI vertical velocity (jump not triggered)
        }
      }
      // Separation using spatial grid neighbors (same species only)
      applySeparation(m, i);
      // Damping: only for non-ground flight/aquatic (ground handled via friction earlier)
      if(spec.aquatic || spec.flying){
        const damp = aggressive? 0.9 : 0.92; m.vx*=damp; m.vy*= (spec.aquatic? 0.95 : 0.92);
      }
      // Clamp speeds
  const maxS = (spec.speed * (m.speedMul||1)) * (aggressive?1.4:1); const sp=Math.hypot(m.vx,m.vy); if(sp>maxS){ const s=maxS/sp; m.vx*=s; m.vy*=s; }
      // Sleep logic for far, non-aggro mobs: update position only sparsely
  if(!aggressive){
        const distP = Math.abs(m.x - player.x) + Math.abs(m.y - player.y);
        if(distP > 140 && (frame & 3)!== (m.tickMod||0)){ continue; } // skip this frame
      }
      active++;
  // Ground / gravity integration + AABB collision for ground mobs
  if(!spec.aquatic && !spec.flying){
        const MOVE = MM.MOVE || {GRAV:20}; m.vy += MOVE.GRAV * dt; if(m.vy>24) m.vy=24;
        const body = spec.body || {w:1,h:1}; const sc=(m.scale||1); const halfW = (body.w||1)*0.5*sc, halfH=(body.h||1)*0.5*sc;
        // Integrate horizontal then resolve X collisions
        m.x += m.vx*dt;
        let minX = Math.floor(m.x - halfW), maxX = Math.floor(m.x + halfW);
        let minY = Math.floor(m.y - halfH), maxY = Math.floor(m.y + halfH);
        for(let y=minY; y<=maxY; y++){
          for(let x=minX; x<=maxX; x++){
            const t = getTile(x,y); if(isSolid && isSolid(t)){
              if(m.vx>0) m.x = x - halfW - 0.001; else if(m.vx<0) m.x = x + 1 + halfW + 0.001; m.vx=0;
              minX = Math.floor(m.x - halfW); maxX = Math.floor(m.x + halfW); // recalc
            }
          }
        }
        // Integrate vertical then resolve Y collisions
        m.y += m.vy*dt; minX = Math.floor(m.x - halfW); maxX = Math.floor(m.x + halfW); minY = Math.floor(m.y - halfH); maxY = Math.floor(m.y + halfH);
        const wasGround = m.onGround; m.onGround=false;
        for(let y=minY; y<=maxY; y++){
          for(let x=minX; x<=maxX; x++){
            const t=getTile(x,y); if(isSolid && isSolid(t)){
              if(m.vy>0){ m.y = y - halfH - 0.001; m.vy=0; m.onGround=true; }
              else if(m.vy<0){ m.y = y + 1 + halfH + 0.001; m.vy=0; }
              minY = Math.floor(m.y - halfH); maxY = Math.floor(m.y + halfH);
            }
          }
        }
        if(m.onGround){
          // Stand friction
          if(Math.abs(m.vx)<0.02) m.vx=0; else m.vx*=0.86;
          // Obstacle check for small step up using maxClimb
          if(spec.move && spec.move.maxClimb>0 && Math.abs(m.vx)>0.15){
            const dir = m.vx>0?1:-1; const stepX = Math.floor(m.x + dir*halfW + dir*0.2);
            // scan up to maxClimb blocks above feet to see if we can jump
            const maxClimb = Math.ceil(spec.move.maxClimb);
            let blocked=false, spaceFound=false;
            for(let h=0; h<=maxClimb; h++){
              const testY = Math.floor(m.y + halfH - h - 0.01);
              const t = getTile(stepX, testY);
              if(isSolid && isSolid(t)) blocked=true; else if(blocked){ spaceFound=true; break; }
            }
            if(spaceFound && Math.random()<0.12){ m.vy = (spec.move.jumpVel|| -4); m.onGround=false; }
            else if(blocked && !spaceFound){ // wall too high: halt
              m.vx=0;
            }
          }
        } else if(!m.onGround){
          // airborne horizontal damping slight
          m.vx *= 0.995;
        }
        if(m.onGround && !wasGround){ /* landing hook placeholder */ }
      } else {
        // Non-ground integrate simple
        m.x += m.vx*dt; m.y += m.vy*dt;
      }
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
  } // end update()
  function updateMob(m, spec, ctx){
    ctx.speed = (spec.speed||1) * (m.speedMul||1);
    if(typeof spec.onUpdate==='function'){ spec.onUpdate(m, spec, ctx); return; }
    const {dt, now, aggressive, player} = ctx; const toPlayerX=player.x - m.x; const toPlayerY=player.y - m.y; const distP=Math.hypot(toPlayerX,toPlayerY)||1;
    if(aggressive){
      const desiredVx = (toPlayerX/distP)*((spec.speed||1)*(m.speedMul||1))*0.9; m.vx += (desiredVx - m.vx)*Math.min(1, dt*4);
      const desiredVy = spec.aquatic? ((toPlayerY)*0.8) : (toPlayerY*0.6);
      m.vy += (desiredVy - m.vy)*Math.min(1, dt*2.5);
      m.facing = toPlayerX>=0?1:-1;
    } else {
      if(now>m.tNext){
        m.tNext = now + rand(spec.wanderInterval[0], spec.wanderInterval[1])*1000;
        if(Math.random()<0.65){ const ang = Math.random()*Math.PI*2; const speed = (spec.speed*(m.speedMul||1))*(0.3+Math.random()*0.7); m.vx = Math.cos(ang)*speed; m.vy = Math.sin(ang)*speed* (spec.aquatic?0.6:0.35); m.facing = m.vx>=0?1:-1; } else { m.vx*=0.4; m.vy*=0.4; }
      }
      if(spec.aquatic){
        const baseBob = Math.sin(now*0.002 + m.spawnT*0.0007)*0.4;
        m.vy += (baseBob - m.vy)*Math.min(1, dt*0.8);
      } else if(spec.flying){
        const baseBob = Math.sin(now*0.003 + m.spawnT*0.001)*0.25;
        m.vy += (baseBob - m.vy)*Math.min(1, dt*0.8);
      } // grounded: no vertical bob
    }
  }

  function draw(ctx, TILE, camX,camY, zoom){
    ctx.save(); ctx.imageSmoothingEnabled=false; const now=performance.now();
  // View bounds expressed in tile coordinates (camX/camY already in tiles)
  const viewL = camX - 2; const viewR = camX + (ctx.canvas.width/zoom)/TILE + 2; const viewT = camY - 2; const viewB = camY + (ctx.canvas.height/zoom)/TILE + 2;
  const disableCull = !!window.__mobDisableCull;
  for(const m of mobs){ if(!disableCull && (m.x < viewL || m.x > viewR || m.y < viewT || m.y > viewB)) continue; const spec=SPECIES[m.id]; const screenX = (m.x*TILE); let screenY=(m.y*TILE);
      // Anchor adjustment: center position to feet baseline so sprites don't float
      if(spec && spec.ground && spec.body){
        const halfHpx = (spec.body.h||1)*0.5*TILE*(m.scale||1);
        const currentBottom = (spec.body.h>1.05)? 2 : 1; // empirically: tall sprites drawn to +2px, small to +1px
        screenY += halfHpx - currentBottom;
      }
      ctx.save();
      // Apply visual scale per entity
      if((m.scale||1)!==1){ ctx.translate(screenX, screenY); ctx.scale(m.scale, m.scale); ctx.translate(-screenX, -screenY); }
      // Simple shadow ellipse for ground mobs to reinforce contact
      if(spec && spec.ground){
        ctx.fillStyle='rgba(0,0,0,0.18)'; const shW = (spec.body? (spec.body.w||1)*TILE*0.6 : TILE*0.6); const shH=Math.max(2, shW*0.22); ctx.beginPath(); ctx.ellipse(screenX, screenY+ (spec.body? (spec.body.h||1)*0.5*TILE -2 : 6), shW*0.5, shH*0.5, 0, 0, Math.PI*2); ctx.fill();
      }
      if(window.__mobDebug){ // simple origin marker
        ctx.fillStyle='rgba(255,0,0,0.4)'; ctx.fillRect(screenX-1, screenY-1,2,2);
      }
      if(window.__mobShowAABB && spec && spec.body){
        const halfW = (spec.body.w||1)*0.5*TILE*(m.scale||1); const halfH=(spec.body.h||1)*0.5*TILE*(m.scale||1);
        ctx.strokeStyle='rgba(0,255,255,0.5)'; ctx.lineWidth=1; ctx.strokeRect((m.x-halfW/TILE)*TILE, (m.y-halfH/TILE)*TILE, (halfW*2), (halfH*2));
        // ground / feet line (bottom of AABB)
        ctx.strokeStyle='rgba(255,255,0,0.6)'; ctx.beginPath(); ctx.moveTo((m.x-halfW/TILE)*TILE, (m.y+halfH/TILE)*TILE); ctx.lineTo((m.x+halfW/TILE)*TILE, (m.y+halfH/TILE)*TILE); ctx.stroke();
      }
      if(m.shake>0){ const ang=Math.random()*Math.PI*2; const mag=m.shake*1.5; ctx.translate(Math.cos(ang)*mag, Math.sin(ang)*mag); }
      const flashing= now < m.hitFlashUntil;
  let topY=screenY; // track highest pixel for HP bar positioning after scaling
  function hpTop(y){ const yy = screenY + (y - screenY) * (m.scale||1); if(yy<topY) topY=yy; }
      const faceDir = m.facing>0?1:-1;
      // Small per-entity phase for anim variety
      const phase = (now*0.005 + m.spawnT*0.37) % (Math.PI*2);
      const phase2 = (now*0.003 + m.spawnT*0.19) % (Math.PI*2);
      // Helper to draw outline rectangle
      function box(x,y,w,h,fill,stroke){ ctx.fillStyle=fill; ctx.fillRect(x,y,w,h); if(stroke){ ctx.strokeStyle=stroke; ctx.lineWidth=1; ctx.strokeRect(x+0.5,y+0.5,w-1,h-1);} hpTop(y); }
      function shade(x,y,w,h,col,alpha){ ctx.fillStyle=col; ctx.globalAlpha=alpha; ctx.fillRect(x,y,w,h); ctx.globalAlpha=1; }
      switch(m.id){
        case 'BIRD': { // enlarged with wings + beak + eye
          const flap = Math.sin(phase)*2; // wing flap
          const bodyCol = flashing? '#ffffff' : (m.baseColor||'#f5d16a');
          box(screenX-5, screenY-7,10,8, bodyCol,'#bc8a00'); // body
          // wings (two rectangles that move vertically)
          ctx.fillStyle='#f3c552'; ctx.fillRect(screenX-7, screenY-5+flap,4,6); ctx.fillRect(screenX+3, screenY-5-flap,4,6);
          // tail (fan)
          ctx.fillStyle='#d49600'; ctx.fillRect(screenX+(faceDir>0?3:-5), screenY-4,2,3);
          // head & beak
          ctx.fillStyle=bodyCol; ctx.fillRect(screenX+(faceDir>0?2:-4), screenY-8,4,4); hpTop(screenY-8);
          ctx.fillStyle='#ff9b00'; ctx.fillRect(screenX+(faceDir>0?6:-6), screenY-6,3,2);
          ctx.fillStyle='#222'; ctx.fillRect(screenX+(faceDir>0?4:-4), screenY-7,2,2);
          break; }
        case 'FISH': { // add dorsal/ventral fins + tail pattern
          const wag = Math.sin(phase)*2*faceDir;
          const body = flashing? '#bcecff' : (m.baseColor||'#4eb2f1');
          box(screenX-9, screenY-4,18,8, body,'#1d6b9c');
          ctx.fillStyle='#1d6b9c'; ctx.fillRect(screenX-4, screenY-5,8,1); // dorsal ridge
          ctx.fillRect(screenX-4, screenY+4,8,1); // ventral
          // tail (wag)
          ctx.fillStyle='#1d6b9c'; ctx.save(); ctx.translate(wag,0); ctx.fillRect(screenX+(faceDir>0?9:-11), screenY-3,3,6); ctx.restore();
          // eye & gill
          ctx.fillStyle='#fff'; ctx.fillRect(screenX+(faceDir>0?1:-3), screenY-2,2,2); ctx.fillStyle='#000'; ctx.fillRect(screenX+(faceDir>0?1:-3), screenY-2,1,1);
          ctx.fillStyle='rgba(0,0,0,0.25)'; ctx.fillRect(screenX+(faceDir>0?-1:1), screenY-1,1,2); // gill slit
          break; }
        case 'BEAR': { // large hulking (approx 2x1.2 tiles)
          const body = flashing? '#e8d5c0': (m.baseColor||'#6b4a30');
          const breathe = 1 + Math.sin(phase2)*0.1;
          box(screenX-14, screenY-12,28,14, body,'#3e2918'); // torso
          // back shading gradient bars
          shade(screenX-14, screenY+1,28,3,'#000',0.10); shade(screenX-14, screenY+4,28,2,'#000',0.05);
          // head
          ctx.fillStyle=body; ctx.fillRect(screenX+(faceDir>0?5:-11), screenY-16,12,10*breathe); hpTop(screenY-16);
          // snout
          ctx.fillStyle='#c4ad97'; ctx.fillRect(screenX+(faceDir>0?14:-11), screenY-10,4,4);
          ctx.fillStyle='#000'; ctx.fillRect(screenX+(faceDir>0?16:-11), screenY-9,2,2);
          // ears
          ctx.fillStyle='#3e2918'; ctx.fillRect(screenX+(faceDir>0?6:-9), screenY-16,3,3); ctx.fillRect(screenX+(faceDir>0?12:-3), screenY-16,3,3);
          // legs (front/back)
          ctx.fillStyle='#4d3421'; const legY=screenY+2; ctx.fillRect(screenX-12, legY,5,6); ctx.fillRect(screenX-2, legY,5,6); ctx.fillRect(screenX+6, legY,5,6); ctx.fillRect(screenX+12-4, legY,5,6);
          break; }
        case 'SQUIRREL': {
          const body = flashing? '#ffe3b5':(m.baseColor||'#b07040');
          box(screenX-6, screenY-7,12,8, body,'#6a3d18');
          // head
          ctx.fillStyle=body; ctx.fillRect(screenX+(faceDir>0?2:-6), screenY-10,6,5); hpTop(screenY-10);
          // ear
          ctx.fillStyle='#d19050'; ctx.fillRect(screenX+(faceDir>0?3:-5), screenY-11,2,2);
          // tail (arched sway)
          const sway = Math.sin(phase)*2;
          ctx.save(); ctx.translate(-sway*faceDir,0);
          ctx.fillStyle='#d19050'; ctx.fillRect(screenX-(faceDir>0?10:-2), screenY-14,6,12);
          ctx.fillRect(screenX-(faceDir>0?8:0), screenY-14,4,4);
          ctx.restore();
          break; }
        case 'DEER': {
          const body = flashing? '#fff2e0':(m.baseColor||'#9c6a39');
          box(screenX-10, screenY-9,20,10, body,'#664422');
          // head
          ctx.fillStyle=body; ctx.fillRect(screenX+(faceDir>0?8:-12), screenY-13,8,6); hpTop(screenY-13);
          // muzzle
          ctx.fillStyle='#d9c3a5'; ctx.fillRect(screenX+(faceDir>0?15:-12), screenY-10,3,3);
          ctx.fillStyle='#000'; ctx.fillRect(screenX+(faceDir>0?16:-11), screenY-9,1,1);
          // antlers
          ctx.fillStyle='#ccb28a'; const ax=screenX+(faceDir>0?9:-5); const baseY=screenY-13; ctx.fillRect(ax, baseY-5,2,5); ctx.fillRect(ax+4*faceDir, baseY-4,2,5);
          ctx.fillRect(ax+2*faceDir, baseY-8,2,3); ctx.fillRect(ax+6*faceDir, baseY-7,2,3);
          // spots
          ctx.fillStyle='rgba(255,255,255,0.6)'; for(let i=-6;i<=6;i+=4){ ctx.fillRect(screenX+i, screenY-2,2,2); }
          break; }
        case 'WOLF': {
          const body = flashing? '#f5f5f5': (m.baseColor||'#bcbcbc');
          box(screenX-12, screenY-7,24,9, body,'#555');
          // head + ears
          ctx.fillStyle=body; ctx.fillRect(screenX+(faceDir>0?8:-14), screenY-11,10,8); hpTop(screenY-11);
          ctx.fillStyle='#888'; ctx.fillRect(screenX+(faceDir>0?8:-14), screenY-11,3,3); ctx.fillRect(screenX+(faceDir>0?15:-7), screenY-11,3,3);
          // snout
          ctx.fillStyle='#ddd'; ctx.fillRect(screenX+(faceDir>0?16:-10), screenY-7,4,3); ctx.fillStyle='#222'; ctx.fillRect(screenX+(faceDir>0?18:-10), screenY-6,2,2);
          // tail
          const wag = Math.sin(phase*1.5)*2;
          ctx.save(); ctx.translate(wag*faceDir,0); ctx.fillStyle='#ddd'; ctx.fillRect(screenX-(faceDir>0?16:-0), screenY-5,6,3); ctx.restore();
          // darker back stripe
          shade(screenX-12, screenY-6,24,2,'#000',0.15);
          break; }
        case 'RABBIT': {
          const body = flashing? '#ffffff':(m.baseColor||'#dddddd');
          box(screenX-5, screenY-5,10,6, body,'#999');
          // head
          ctx.fillStyle=body; ctx.fillRect(screenX+(faceDir>0?4:-6), screenY-7,6,5); hpTop(screenY-7);
          // ears
          const earBob = Math.sin(phase2)*1.2;
          ctx.fillStyle='#bbb'; ctx.fillRect(screenX+(faceDir>0?5:-5), screenY-11-earBob,2,6+earBob); ctx.fillRect(screenX+(faceDir>0?8:-2), screenY-11+earBob,2,6-earBob);
          break; }
        case 'OWL': {
          const body = flashing? '#ffffff':(m.baseColor||'#c8a860');
          box(screenX-6, screenY-10,12,12, body,'#6a551e');
          // facial disk
          ctx.fillStyle='#ead5a0'; ctx.fillRect(screenX-4, screenY-8,8,6); hpTop(screenY-10);
          // eyes
          ctx.fillStyle='#000'; ctx.fillRect(screenX-2, screenY-7,2,2); ctx.fillRect(screenX+0, screenY-7,2,2);
          // beak
          ctx.fillStyle='#ffb94d'; ctx.fillRect(screenX-1, screenY-5,2,2);
          // wing flutter
          const f = Math.sin(phase)*2; ctx.fillStyle='#b99738'; ctx.fillRect(screenX-6, screenY-4+f,12,2);
          break; }
        case 'CRAB': {
          const body = flashing? '#ffdddd':(m.baseColor||'#c23a2e');
          box(screenX-8, screenY-4,16,6, body,'#8a1f17');
          // legs
          ctx.fillStyle='#8a1f17'; for(let i=-6;i<=6;i+=4){ ctx.fillRect(screenX+i, screenY+2,2,3); }
          // claws
          const pinch = Math.sin(phase)*1.5;
          ctx.fillStyle='#8a1f17'; ctx.fillRect(screenX-12-pinch, screenY-2,4,4); ctx.fillRect(screenX+8+pinch, screenY-2,4,4);
          break; }
        case 'SHARK': {
          const body = flashing? '#d0f4ff': (m.baseColor||'#4d7690');
          const sway = Math.sin(phase*0.8)*3*faceDir;
          ctx.save(); ctx.translate(sway,0);
          box(screenX-24, screenY-6,48,12, body,'#223b48'); // body
          // white belly stripe
          ctx.fillStyle='#e9f6fa'; ctx.fillRect(screenX-24, screenY+2,48,4);
          // dorsal fin
          ctx.fillStyle='#2a4a5a'; ctx.fillRect(screenX-4, screenY-12,6,6); hpTop(screenY-12);
          // tail
          ctx.fillRect(screenX+(faceDir>0?24:-30), screenY-4,6,8);
          ctx.fillRect(screenX+(faceDir>0?28:-34), screenY-8,4,6);
          ctx.fillRect(screenX+(faceDir>0?28:-34), screenY+2,4,6);
          // mouth & eye
          ctx.fillStyle='#000'; ctx.fillRect(screenX+(faceDir>0?18:-22), screenY-1,6,2); ctx.fillRect(screenX+(faceDir>0?12:-16), screenY-2,2,2);
          ctx.restore();
          break; }
        case 'EEL': {
          const body = flashing? '#e0ffe0':(m.baseColor||'#2f8a4a');
          // segmented body
          for(let i=-10;i<=10;i+=4){ ctx.fillStyle= (i%8===0)? body : '#256d38'; ctx.fillRect(screenX+i, screenY-2,4,4); hpTop(screenY-2); }
          // head
          ctx.fillStyle=body; ctx.fillRect(screenX+10, screenY-3,5,6); ctx.fillStyle='#fff'; ctx.fillRect(screenX+13, screenY-2,2,2); ctx.fillStyle='#000'; ctx.fillRect(screenX+13, screenY-2,1,1);
          break; }
        case 'GOAT': {
          const body = flashing? '#fafafa':(m.baseColor||'#c9c4b5');
          box(screenX-10, screenY-8,20,9, body,'#8d8779');
          // head
          ctx.fillStyle=body; ctx.fillRect(screenX+(faceDir>0?8:-12), screenY-12,8,6); hpTop(screenY-12);
          // horns
          ctx.fillStyle='#9b968a'; ctx.fillRect(screenX+(faceDir>0?8:-12), screenY-14,2,4); ctx.fillRect(screenX+(faceDir>0?14:-6), screenY-14,2,4);
          // beard
          ctx.fillStyle='#9b968a'; ctx.fillRect(screenX+(faceDir>0?14:-6), screenY-7,2,2);
          break; }
        case 'FIREFLY': {
          const pulse = (Math.sin(now*0.01 + m.spawnT*0.005)*0.5+0.5);
          const glowA = 0.55+0.45*pulse;
          ctx.fillStyle=`rgba(255,224,102,${glowA})`; ctx.fillRect(screenX-2, screenY-2,4,4); hpTop(screenY-2);
          ctx.fillStyle=`rgba(255,213,0,${0.4+0.4*pulse})`; ctx.fillRect(screenX-1, screenY-1,2,2);
          // outer halo
          ctx.globalAlpha=0.25*glowA; ctx.fillStyle='#ffe068'; ctx.beginPath(); ctx.arc(screenX, screenY, 6,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1;
          break; }
        default: {
          // fallback: small box
          box(screenX-4, screenY-4,8,8, flashing? '#ffffff':'#888', '#444');
        }
      }
      // HP bar (position above highest drawn pixel)
      if(m.hp < (SPECIES[m.id]?.hp||1)){
        // draw HP bar in screen space (unscaled)
        const saved = ctx.getTransform ? ctx.getTransform() : null;
        ctx.setTransform(1,0,0,1,0,0);
        const maxHp = SPECIES[m.id].hp; const w= Math.max(12, Math.min(36, (SPECIES[m.id].hp||10))); const frac=m.hp/maxHp; const barY = topY - 6; ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(screenX-w/2, barY, w,3); ctx.fillStyle='#ff5252'; ctx.fillRect(screenX-w/2, barY, w*frac,3);
        if(saved && ctx.setTransform) ctx.setTransform(saved);
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
    // Natural death: no loot or XP, just silently despawn
    if(m._naturalDeath){ return; }
    // XP gain
    if(window.player && typeof player.xp==='number'){ player.xp += spec.xp||1; }
    // Loot
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
    return { v:3, list: mobs.map(m=>({id:m.id,x:m.x,y:m.y,vx:m.vx,vy:m.vy,hp:m.hp,state:m.state,facing:m.facing,spawnT:m.spawnT,attackCd:m.attackCd,waterTopY:m.waterTopY,desiredDepth:m.desiredDepth,scale:m.scale,speedMul:m.speedMul,jumpMul:m.jumpMul,baseColor:m.baseColor,lifeEndAt:m.lifeEndAt,decayStartAt:m.decayStartAt})), aggro:{mode:'rel', m:rel} }; }
  function deserialize(data){ // clear
    for(const m of mobs) removeFromGrid(m); mobs.length=0; // reset live counts before rebuild
    for(const k in speciesCounts) delete speciesCounts[k];
    if(data && Array.isArray(data.list)){
  for(const r of data.list){ if(!SPECIES[r.id]) continue; const spec=SPECIES[r.id]; const m=create(spec, r.x, r.y); m.vx=r.vx||0; m.vy=r.vy||0; m.hp=r.hp||spec.hp; m.state=r.state||'idle'; m.facing=r.facing||1; m.spawnT=r.spawnT||performance.now(); m.attackCd=r.attackCd||0; if(typeof r.scale==='number') m.scale=r.scale; if(typeof r.speedMul==='number') m.speedMul=r.speedMul; if(typeof r.jumpMul==='number') m.jumpMul=r.jumpMul; if(typeof r.baseColor==='string') m.baseColor=r.baseColor; if(typeof r.lifeEndAt==='number') m.lifeEndAt=r.lifeEndAt; if(typeof r.decayStartAt==='number') m.decayStartAt=r.decayStartAt;
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
  }

    function diagnose(getTile){
      const report={total:mobs.length, species:{}, groundHoverIssues:[], overlaps:0};
      for(const m of mobs){ report.species[m.id]=(report.species[m.id]||0)+1; const spec=SPECIES[m.id]; if(spec && spec.ground && spec.body){
          const halfH=(spec.body.h||1)*0.5; const tileBelow = getTile? getTile(Math.floor(m.x), Math.floor(m.y+halfH)) : null;
          if(tileBelow===MM.T.AIR){ report.groundHoverIssues.push({id:m.id,x:m.x,y:m.y}); }
        }
      }
      // naive overlap detect (same tile center proximity)
      for(let i=0;i<mobs.length;i++){
        for(let j=i+1;j<mobs.length;j++){
          const a=mobs[i], b=mobs[j]; const dx=a.x-b.x, dy=a.y-b.y; if(dx*dx+dy*dy < 0.16) report.overlaps++; }
      }
      report.metrics={...metrics};
      return report;
    }
    MM.mobs = { update, draw, attackAt, serialize, deserialize, setAggro, speciesAggro, forceSpawn, species: Object.keys(SPECIES), registerSpecies, metrics:()=>metrics, diagnose };
    try{ window.dispatchEvent(new CustomEvent('mm-mobs-ready')); }catch(e){}
  })(); // end IIFE
// (File end)

