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
  // Spatial partitioning (uniform grid) to speed up point queries (attackAt)
  const CELL=16; // tiles per cell both axes
  const grid = new Map(); // key "cx,cy" -> Set of mob refs
  function cellKey(x,y){ return ((x/CELL)|0)+','+((y/CELL)|0); }
  function addToGrid(m){ const k=cellKey(m.x,m.y); let set=grid.get(k); if(!set){ set=new Set(); grid.set(k,set); } set.add(m); m._cellKey=k; }
  function updateGridCell(m){ const k=cellKey(m.x,m.y); if(k!==m._cellKey){ // move
    if(m._cellKey){ const prev=grid.get(m._cellKey); if(prev){ prev.delete(m); if(!prev.size) grid.delete(m._cellKey); } }
    let set=grid.get(k); if(!set){ set=new Set(); grid.set(k,set); } set.add(m); m._cellKey=k; }
  }
  function removeFromGrid(m){ if(m._cellKey){ const set=grid.get(m._cellKey); if(set){ set.delete(m); if(!set.size) grid.delete(m._cellKey); } m._cellKey=null; } }

  const SPECIES = {
    BIRD: {
      id: 'BIRD', max: 18, hp: 6, dmg: 4, speed: 3.2, wanderInterval: [2,6],
      spawnTest(x,y,getTile){ // spawn perched above leaves (air above leaf)
        const below = getTile(x,y+1); const here = getTile(x,y);
        return here===T.AIR && below===T.LEAF; },
      biome: 'any'
    },
    FISH: {
      id: 'FISH', max: 24, hp: 4, dmg: 3, speed: 2.2, wanderInterval:[1,4],
      spawnTest(x,y,getTile){ // inside water with air or water above
        const here = getTile(x,y); const above = getTile(x,y-1);
        return here===T.WATER && (above===T.WATER || above===T.AIR); },
      biome: 'any', aquatic:true
    }
  };

  function rand(a,b){ return a + Math.random()*(b-a); }
  function choose(arr){ return arr[(Math.random()*arr.length)|0]; }

  function create(spec, x,y){ const m={ id: spec.id, x, y, vx:0, vy:0, hp: spec.hp, state:'idle', tNext: performance.now() + rand(spec.wanderInterval[0], spec.wanderInterval[1])*1000, facing:1, spawnT: performance.now(), attackCd:0, hitFlashUntil:0, shake:0 }; addToGrid(m); return m; }

  function countSpecies(id){ let c=0; for(const m of mobs) if(m.id===id) c++; return c; }

  function trySpawnNearPlayer(player, getTile){
    const now = performance.now();
    for(const key in SPECIES){ const spec=SPECIES[key]; if(countSpecies(spec.id) >= spec.max) continue; // cap
      if(Math.random()<0.5) continue; // throttle variety
  for(let a=0;a<6;a++){ const dx = (Math.random()<0.5?-1:1)*(8+Math.random()*32); const dy = -6 + Math.random()*12; const tx = Math.floor(player.x + dx); const ty = Math.floor(player.y + dy); if(spec.spawnTest(tx,ty,getTile)){ mobs.push(create(spec, tx+0.5, ty+0.5)); break; } }
    }
  }

  function isAggro(specId){ const exp=speciesAggro[specId]; return exp && exp> Date.now(); }

  function setAggro(specId){ speciesAggro[specId] = Date.now() + 5*60*1000; }

  function update(dt, player, getTile){ const now = performance.now();
    // Despawn far / off-screen old passive mobs (not aggro)
    for(let i=mobs.length-1;i>=0;i--){ const m=mobs[i]; if(m.hp<=0){ removeFromGrid(m); mobs.splice(i,1); continue; } const dist = Math.abs(m.x-player.x); if(dist>220 && !isAggro(m.id)) { removeFromGrid(m); mobs.splice(i,1); continue; } }
    // Spawn attempt occasionally
    if(Math.random()<0.02) trySpawnNearPlayer(player,getTile);
    for(const m of mobs){ const spec=SPECIES[m.id]; if(!spec) continue; // wander or chase
      const aggressive = isAggro(m.id);
      if(aggressive){ // move toward player horizontal simple
        const dx=player.x - m.x; m.vx += Math.sign(dx)*spec.speed*0.6*dt; if(Math.abs(dx)<0.3) m.vx*=0.5; m.facing = dx>=0?1:-1; }
      else if(now>m.tNext){ // pick new wander velocity
        m.tNext = now + rand(spec.wanderInterval[0], spec.wanderInterval[1])*1000;
        if(Math.random()<0.65){ m.vx = (Math.random()*2-1)*spec.speed; m.facing = m.vx>=0?1:-1; } else { m.vx = 0; }
      }
      // friction
      m.vx += -m.vx * Math.min(1, dt*2.5);
      if(Math.abs(m.vx)<0.02) m.vx=0;
      // vertical simple (fish float, birds bob)
      if(spec.aquatic){ // fish vertical sine drift
        m.vy = Math.sin(now*0.002 + m.spawnT*0.0007)*0.4;
      } else { m.vy = Math.sin(now*0.003 + m.spawnT*0.001)*0.25; }
      // integrate
      m.x += m.vx*dt; m.y += m.vy*dt;
      // keep inside water for fish
      if(spec.aquatic){ const under = getTile(Math.floor(m.x), Math.floor(m.y)); if(under!==T.WATER){ m.vx*=0.2; m.y+=0.2; }
      }
      updateGridCell(m);
      // decay shake
      if(m.shake>0){ m.shake=Math.max(0, m.shake - dt*10); }
      // attack if aggressive & close
      if(aggressive){ if(m.attackCd>0) m.attackCd-=dt; const dx=player.x-m.x; const dy=player.y-m.y; const d = Math.hypot(dx,dy); if(d<1.6 && m.attackCd<=0){ damagePlayer(spec.dmg, m.x, m.y); m.attackCd=1 + Math.random()*0.6; }
      }
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

  function damageMob(m,amount){ if(m.hp<=0) return; m.hp-=amount; m.hitFlashUntil = performance.now()+120; m.shake = 0.6; if(m.hp<=0){ m.hp=0; m.shake=1; }
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
    return { list: mobs.map(m=>({id:m.id,x:m.x,y:m.y,vx:m.vx,vy:m.vy,hp:m.hp,state:m.state,facing:m.facing,spawnT:m.spawnT,attackCd:m.attackCd})), aggro:{mode:'rel', m:rel} }; }
  function deserialize(data){ // clear
    for(const m of mobs) removeFromGrid(m); mobs.length=0; if(data && Array.isArray(data.list)){ for(const r of data.list){ if(!SPECIES[r.id]) continue; const m=create(SPECIES[r.id], r.x, r.y); m.vx=r.vx||0; m.vy=r.vy||0; m.hp=r.hp||SPECIES[r.id].hp; m.state=r.state||'idle'; m.facing=r.facing||1; m.spawnT=r.spawnT||performance.now(); m.attackCd=r.attackCd||0; mobs.push(m); } }
    for(const k in speciesAggro) delete speciesAggro[k];
    if(data && data.aggro){ const now=Date.now(); if(data.aggro.mode==='rel' && data.aggro.m){ for(const k in data.aggro.m){ const rem=data.aggro.m[k]; if(typeof rem==='number' && rem>0){ speciesAggro[k]= now + Math.min(rem, 5*60*1000); } }
      } else { // legacy absolute timestamps
        for(const k in data.aggro){ const exp=data.aggro[k]; if(typeof exp==='number'){ if(exp>now) speciesAggro[k]=exp; else if(now-exp < AGGRO_SKEW_GRACE_MS){ speciesAggro[k]= now + 5000; } }
        }
      }
  }
  }

  MM.mobs = { update, draw, attackAt, serialize, deserialize, setAggro, speciesAggro };
})();
