// Weapon use system: melee swings (with a visible slash + held-weapon animation),
// bow arrows (projectiles with gravity) and three stream weapons selected by the
// equipped item's weaponType:
//   'flame' — ignites organic creatures (mobs.igniteRadius) and flammable tiles
//   'hose'  — water jet: extinguishes tile fire and burning creatures, knocks a
//             little damage loose, and now and then condenses into a real WATER tile
//   'gas'   — toxic cloud: poisons living (organic) creatures; lingers and pools
// The equipped weapon comes from MM.inventory.
import { T, INFO, isSolid, WORLD_H } from '../constants.js';
import { fire as FIRE } from './fire.js';
(function(){
  window.MM = window.MM || {};

  const arrows=[]; // {x,y,vx,vy,dmg,life,stuck,stuckT,ang}
  const puffs=[];  // {kind,x,y,vx,vy,life,total,dps}
  const ARROW_SPEED=22, ARROW_GRAV=14, ARROW_LIFE=5, ARROW_STUCK=4, MAX_ARROWS=64;
  const MAX_PUFFS=220;
  // Per-kind stream tuning: emission count/frame, muzzle speed, vertical pull
  // (negative = rises like heat, positive = arcs down like water), lifetime factor
  // lifeMult compensates for in-flight friction so the actual reach matches the
  // weapon's fireRange (with drag ~0.9/s a puff covers ~60% of v0*t — without the
  // boost puffs died ~2 tiles short and never touched the terrain they should melt)
  const STREAMS={
    flame:{speed:10, emit:3, grav:-2.2, lifeMult:1.45},
    hose: {speed:12, emit:3, grav:3.0,  lifeMult:1.45},
    gas:  {speed:6,  emit:2, grav:-1.2, lifeMult:1.9},
    steam:{speed:2,  emit:0, grav:-3.2, lifeMult:1.0}  // cosmetic, spawned by boiling
  };
  const WATER_CONDENSE_CHANCE=0.008; // per dying hose puff (~1 tile per second of spray)
  // Elemental conversion odds (per puff contact — sustained streams transform terrain)
  const EVAPORATE_CHANCE=0.05;  // flame boils a water tile away → vapor joins the clouds
  const MELT_CHANCE=0.008;      // flame melts stone → lava (slow, needs sustained fire)
  const QUENCH_CHANCE=0.5;      // hose hardens lava → obsidian
  const MUD_CHANCE=0.25;        // hose soaks sand → mud
  let bowCd=0, meleeCd=0, bossAcc=0;
  // Melee swing visual: drawHeld animates the held blade, draw() adds a slash arc
  const swing={t:0, dur:0.2, tx:0, ty:0, dir:1};

  function equippedWeapon(){ return (MM.inventory && MM.inventory.equippedItem)? MM.inventory.equippedItem('weapon'):null; }
  function weaponType(w){ return (w && w.weaponType)||'melee'; }
  function tierColor(it){ const tc=(MM.inventory && MM.inventory.TIER_COLORS)||{}; return (it && tc[it.tier])||null; }

  function notifyMeleeSwing(tx,ty,player){
    swing.t=swing.dur; swing.tx=tx; swing.ty=ty; swing.dir=(player && player.facing>=0)?1:-1;
  }

  // ---- Firing (called every frame while the fire input is held) ----
  function fireHeld(player, aimX, aimY, dt){
    const w=equippedWeapon();
    const type=weaponType(w);
    if(type==='bow') return fireBow(player, aimX, aimY, w);
    if(STREAMS[type]) return fireStream(player, aimX, aimY, w, dt||0.016, type);
    return fireMelee(player, aimX, aimY);
  }
  function fireMelee(player, aimX, aimY){
    if(meleeCd>0 || (player.atkCd && player.atkCd>0)) return false;
    // Strike the aimed tile clamped to melee reach (matches click combat)
    const px=Math.floor(player.x), py=Math.floor(player.y);
    let tx=Math.floor(aimX), ty=Math.floor(aimY);
    tx=Math.max(px-3, Math.min(px+3, tx)); ty=Math.max(py-3, Math.min(py+3, ty));
    const bonus=(MM.activeModifiers && MM.activeModifiers.attackDamage)||0;
    const hit=(MM.bosses && MM.bosses.attackAt && MM.bosses.attackAt(tx,ty,bonus))
           || (MM.ufo && MM.ufo.attackAt && MM.ufo.attackAt(tx,ty,bonus))
           || (MM.mobs && MM.mobs.attackAt && MM.mobs.attackAt(tx,ty,bonus));
    meleeCd=0.35; player.atkCd=Math.max(player.atkCd||0, 0.35);
    player.facing = tx>=px? 1 : -1;
    notifyMeleeSwing(tx,ty,player);
    try{ if(MM.audio && MM.audio.play) MM.audio.play('swing'); }catch(e){}
    return !!hit;
  }
  function fireBow(player, aimX, aimY, w){
    if(bowCd>0) return false;
    bowCd=Math.max(0.25, (w && w.fireCooldown)||0.55);
    if(arrows.length>=MAX_ARROWS) arrows.shift();
    let dx=aimX-player.x, dy=aimY-player.y;
    const d=Math.hypot(dx,dy)||1; dx/=d; dy/=d;
    arrows.push({
      x:player.x + dx*0.7,
      y:player.y - 0.15 + dy*0.7,
      vx:dx*ARROW_SPEED,
      vy:dy*ARROW_SPEED - 1.2, // slight lob so mid-range shots arc naturally
      dmg:(w && w.attackDamage)||3,
      life:ARROW_LIFE, stuck:false, stuckT:ARROW_STUCK
    });
    player.facing = dx>=0?1:-1;
    try{ if(MM.audio && MM.audio.play) MM.audio.play('bow'); }catch(e){}
    return true;
  }
  function fireStream(player, aimX, aimY, w, dt, kind){
    try{ if(MM.audio && MM.audio.play) MM.audio.play(kind==='flame'?'flame': kind==='hose'?'hose':'gas'); }catch(e){}
    const cfg=STREAMS[kind];
    let dx=aimX-player.x, dy=aimY-player.y;
    const d=Math.hypot(dx,dy)||1; dx/=d; dy/=d;
    player.facing = dx>=0?1:-1;
    const range=(w && w.fireRange)||6;
    const dps=(w && w.fireDps)||(kind==='hose'?2:6);
    for(let i=0;i<cfg.emit && puffs.length<MAX_PUFFS;i++){
      const spread=(Math.random()-0.5)*0.22;
      const ca=Math.cos(spread), sa=Math.sin(spread);
      const ex=dx*ca - dy*sa, ey=dx*sa + dy*ca;
      const sp=cfg.speed*(0.85+Math.random()*0.3);
      puffs.push({
        kind,
        x:player.x + ex*0.6, y:player.y - 0.1 + ey*0.6,
        vx:ex*sp, vy:ey*sp - 0.3,
        life:range/cfg.speed*cfg.lifeMult*(0.9+Math.random()*0.25),
        total:range/cfg.speed*cfg.lifeMult,
        dps
      });
    }
    // flame & gas tick direct damage into boss parts / a hovering saucer along
    // the stream (bosses have no burn/poison status; the hose is harmless to them)
    if(kind!=='hose'){
      bossAcc+=dt;
      if(bossAcc>=0.2 && ((MM.bosses && MM.bosses.damageAt) || (MM.ufo && MM.ufo.damageAt))){
        bossAcc=0;
        for(const t of [0.35,0.6,0.85]){
          const sx=Math.floor(player.x + dx*range*t), sy=Math.floor(player.y + dy*range*t);
          if(MM.bosses && MM.bosses.damageAt && MM.bosses.damageAt(sx,sy, dps*0.2)) break;
          if(MM.ufo && MM.ufo.damageAt && MM.ufo.damageAt(sx,sy, dps*0.2)) break;
        }
      }
    }
    return true;
  }

  // A dying hose puff sometimes condenses into a real water tile
  function condenseWater(x,y,getTile,setTile){
    if(typeof setTile!=='function') return;
    if(Math.random()>=WATER_CONDENSE_CHANCE) return;
    const tx=Math.floor(x), ty=Math.floor(y);
    if(getTile(tx,ty)!==T.AIR) return;
    try{
      if(MM.water && MM.water.addSource) MM.water.addSource(tx,ty,getTile,setTile);
      else setTile(tx,ty,T.WATER);
    }catch(e){ /* fluid sim unavailable — no puddle */ }
  }
  // --- Gas detonation (TNT effect) ----------------------------------------------
  // Toxic vapour touching open flame or lava explodes: nearby gas puffs are
  // consumed into the blast (bigger cloud → bigger boom), soft terrain craters
  // (chests, obsidian and diamond survive), creatures and the hero are hurt and
  // knocked back, the rim catches fire. A short cooldown turns a stream sprayed
  // straight onto lava into rhythmic booms instead of a 60-per-second buzz.
  const blastsFx=[]; // {x,y,R,t,max}
  let explodeCd=0;
  function explodeAt(wx,wy,getTile,setTile){
    if(explodeCd>0){ return false; } // fizzle — the triggering puff just burns off
    explodeCd=0.5;
    // consume the surrounding cloud into the blast
    let consumed=0;
    for(let i=puffs.length-1;i>=0;i--){
      const q=puffs[i];
      if(q.kind!=='gas') continue;
      const dx=q.x-wx, dy=q.y-wy;
      if(dx*dx+dy*dy<=9){ puffs.splice(i,1); consumed++; }
    }
    const R=2.2+Math.min(1.6, consumed*0.06);
    const bx=Math.round(wx), by=Math.round(wy);
    // crater: soft tiles blasted out; precious and blast-resistant tiles survive
    const Ri=Math.ceil(R);
    for(let dy=-Ri;dy<=Ri;dy++){
      for(let dx=-Ri;dx<=Ri;dx++){
        if(dx*dx+dy*dy>R*R) continue;
        const tx=bx+dx, ty=by+dy;
        if(ty<1 || ty>=WORLD_H-3) continue;
        const t=getTile(tx,ty);
        if(t===T.AIR||t===T.CHEST_COMMON||t===T.CHEST_RARE||t===T.CHEST_EPIC||t===T.OBSIDIAN||t===T.DIAMOND) continue;
        if(typeof setTile!=='function') continue;
        setTile(tx,ty,T.AIR);
        try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(tx,ty); }catch(e){}
        try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(tx,ty,getTile); }catch(e){}
      }
    }
    // the rim catches fire
    if(FIRE && FIRE.ignite){
      for(let k=0;k<6;k++){ const a=Math.random()*6.283; FIRE.ignite(Math.round(bx+Math.cos(a)*R), Math.round(by+Math.sin(a)*R), getTile); }
    }
    // creatures, bosses, plants
    try{ if(MM.mobs && MM.mobs.blastRadius) MM.mobs.blastRadius(wx,wy,R+1.5,14); }catch(e){}
    try{ if(MM.bosses && MM.bosses.damageAt){ MM.bosses.damageAt(bx,by,12); MM.bosses.damageAt(bx+1,by,8); MM.bosses.damageAt(bx-1,by,8); MM.bosses.damageAt(bx,by-1,8); } }catch(e){}
    try{ if(MM.ufo && MM.ufo.damageAt){ MM.ufo.damageAt(bx,by,14); MM.ufo.damageAt(bx,by-1,8); } }catch(e){}
    try{ if(MM.plants && MM.plants.scorchAt) MM.plants.scorchAt(wx,wy,R+1); }catch(e){}
    // the hero standing close is hurt and hurled (central damageHero handles
    // i-frames/knockback/death; explosions just bring bigger numbers)
    const pl=(typeof window!=='undefined' && window.player)||null;
    if(pl && typeof pl.hp==='number' && typeof window.damageHero==='function'){
      const d=Math.hypot(pl.x-wx,pl.y-wy);
      if(d<R+2){
        window.damageHero(Math.max(4, Math.round(16*(1-d/(R+2.5)))), {srcX:wx, srcY:wy, kb:6, kbY:-5, cause:'explosion'});
      }
    }
    // FX: expanding ring + spark burst + scattered short flames
    blastsFx.push({x:wx,y:wy,R,t:0,max:0.5});
    try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(wx*(MM.TILE||20),wy*(MM.TILE||20),'epic'); }catch(e){}
    try{ if(MM.audio && MM.audio.play) MM.audio.play('explosion'); }catch(e){}
    for(let k=0;k<8 && puffs.length<MAX_PUFFS;k++){
      const a=Math.random()*6.283, sp=4+Math.random()*5;
      puffs.push({kind:'flame', x:wx, y:wy, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp-1, life:0.3+Math.random()*0.3, total:0.55, dps:5});
    }
    return true;
  }

  // White cosmetic steam wisps (boiled water, quenched lava)
  function emitSteam(x,y,n){
    for(let i=0;i<n && puffs.length<MAX_PUFFS;i++){
      puffs.push({
        kind:'steam',
        x:x+(Math.random()-0.5)*0.5, y:y+(Math.random()-0.5)*0.3,
        vx:(Math.random()-0.5)*1.2, vy:-1.5-Math.random()*1.5,
        life:0.6+Math.random()*0.5, total:1.0, dps:0
      });
    }
  }

  // ---- Simulation ----
  function update(dt, getTile, setTile){
    if(bowCd>0) bowCd-=dt;
    if(meleeCd>0) meleeCd-=dt;
    if(swing.t>0) swing.t-=dt;
    if(explodeCd>0) explodeCd-=dt;
    for(let i=blastsFx.length-1;i>=0;i--){ blastsFx[i].t+=dt; if(blastsFx[i].t>blastsFx[i].max) blastsFx.splice(i,1); }
    // Arrows
    for(let i=arrows.length-1;i>=0;i--){
      const a=arrows[i];
      if(a.stuck){ a.stuckT-=dt; if(a.stuckT<=0) arrows.splice(i,1); continue; }
      a.life-=dt; if(a.life<=0){ arrows.splice(i,1); continue; }
      // a burning arrow flying into a gas cloud detonates it
      if(a.fire){
        for(const q of puffs){
          if(q.kind!=='gas') continue;
          const ddx=q.x-a.x, ddy=q.y-a.y;
          if(ddx*ddx+ddy*ddy<1.4){ explodeAt(q.x,q.y,getTile,setTile); break; }
        }
      }
      a.vy+=ARROW_GRAV*dt;
      const steps=Math.max(1, Math.ceil(Math.max(Math.abs(a.vx),Math.abs(a.vy))*dt/0.35));
      const sdt=dt/steps;
      for(let s=0;s<steps;s++){
        a.x+=a.vx*sdt; a.y+=a.vy*sdt;
        const tx=Math.floor(a.x), ty=Math.floor(a.y);
        // an arrow flying through open flame or over lava catches fire
        if(!a.fire && ((FIRE && FIRE.isBurning(tx,ty)) || getTile(tx,ty)===T.LAVA)) a.fire=true;
        // Creature hit (mob, boss part or a hovering saucer)
        if((MM.mobs && MM.mobs.damageAt && MM.mobs.damageAt(tx,ty,a.dmg))
        || (MM.bosses && MM.bosses.damageAt && MM.bosses.damageAt(tx,ty,a.dmg))
        || (MM.ufo && MM.ufo.damageAt && MM.ufo.damageAt(tx,ty,a.dmg))){
          if(a.fire && MM.mobs && MM.mobs.igniteAt) MM.mobs.igniteAt(tx,ty,{dur:2.5,dps:2});
          arrows.splice(i,1); break;
        }
        const t=getTile(tx,ty);
        if(isSolid(t)){
          a.x-=a.vx*sdt*0.6; a.y-=a.vy*sdt*0.6; // sit at the surface, not inside
          a.stuck=true;
          if(a.fire && FIRE){ FIRE.ignite(tx,ty,getTile); FIRE.ignite(Math.floor(a.x),Math.floor(a.y),getTile); }
          break;
        }
        if(t===T.WATER){ a.vx*=0.96; a.vy*=0.96; a.fire=false; } // water drag douses it too
      }
    }
    // Stream puffs
    for(let i=puffs.length-1;i>=0;i--){
      const p=puffs[i];
      p.life-=dt;
      if(p.life<=0){
        if(p.kind==='hose') condenseWater(p.x,p.y,getTile,setTile);
        puffs.splice(i,1); continue;
      }
      const px0=p.x, py0=p.y;
      const cfg=STREAMS[p.kind]||STREAMS.flame;
      p.x+=p.vx*dt; p.y+=p.vy*dt;
      p.vy+=cfg.grav*dt;
      p.vx*=1-Math.min(1,dt*0.9); p.vy*=1-Math.min(1,dt*(p.kind==='hose'?0.5:0.9));
      const tx=Math.floor(p.x), ty=Math.floor(p.y);
      const t=getTile(tx,ty);
      const info=INFO[t];
      const hitWall=info && !info.passable && t!==T.AIR;
      if(p.kind==='flame'){
        if(t===T.WATER){
          // boiling: sometimes the tile evaporates outright — its mass rises as
          // vapor into the cloud system (volume-true: 1 tile == 1.0 vapor mass)
          if(typeof setTile==='function' && Math.random()<EVAPORATE_CHANCE){
            setTile(tx,ty,T.AIR);
            try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(tx,ty,getTile); }catch(e){}
            try{ if(MM.clouds && MM.clouds.injectVapor) MM.clouds.injectVapor(tx,1); }catch(e){}
            emitSteam(p.x,p.y-0.3,3);
          } else if(Math.random()<0.35) emitSteam(p.x,p.y-0.3,1); // hissing surface
          puffs.splice(i,1); continue;
        }
        if(info && info.flammable && Math.random()<0.22 && FIRE) FIRE.ignite(tx,ty,getTile);
        if(hitWall){
          // sustained flame melts bare rock into a lava pool; snow and ice thaw to water
          if(t===T.STONE && typeof setTile==='function' && Math.random()<MELT_CHANCE){
            setTile(tx,ty,T.LAVA);
            if(FIRE && FIRE.noteLava) FIRE.noteLava(tx,ty); // fresh melt joins the flow sim
            try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(tx,ty); }catch(e){}
          } else if((t===T.SNOW||t===T.ICE) && typeof setTile==='function' && Math.random()<0.3){
            try{
              if(MM.water && MM.water.addSource) MM.water.addSource(tx,ty,getTile,setTile);
              else setTile(tx,ty,T.WATER);
            }catch(e){}
            try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(tx,ty); }catch(e){}
            emitSteam(p.x,p.y-0.2,1);
          }
          puffs.splice(i,1); continue;
        }
        if(Math.random()<0.3 && MM.mobs && MM.mobs.igniteRadius) MM.mobs.igniteRadius(p.x,p.y,0.9,{dur:2.5, dps:(p.dps||6)*0.6});
        if(Math.random()<0.25 && MM.plants && MM.plants.scorchAt) MM.plants.scorchAt(p.x,p.y,1.2);
      } else if(p.kind==='hose'){
        if(FIRE && FIRE.isBurning(tx,ty)) FIRE.extinguish(tx,ty);
        if(Math.random()<0.3 && MM.mobs && MM.mobs.douseRadius) MM.mobs.douseRadius(p.x,p.y,1.0);
        // watering can: the jet hydrates the garden it passes over
        if(Math.random()<0.3 && MM.plants && MM.plants.waterAt) MM.plants.waterAt(p.x,p.y,0.3,1.6);
        if(Math.random()<0.10 && MM.mobs && MM.mobs.damageAt) MM.mobs.damageAt(tx,ty, Math.max(1,(p.dps||2)*0.5));
        if(t===T.LAVA){
          // quenching: molten rock hardens to obsidian under the jet
          if(typeof setTile==='function' && Math.random()<QUENCH_CHANCE){
            setTile(tx,ty,T.OBSIDIAN);
            emitSteam(p.x,p.y-0.2,3);
          } else emitSteam(p.x,p.y-0.2,1);
          puffs.splice(i,1); continue;
        }
        if(t===T.WATER){ puffs.splice(i,1); continue; } // merged into the body of water
        if(hitWall){
          // soaked sand turns to boggy mud (halves the speed of anything walking on it)
          if(t===T.SAND && typeof setTile==='function' && Math.random()<MUD_CHANCE){
            setTile(tx,ty,T.MUD);
          } else condenseWater(px0,py0,getTile,setTile);
          puffs.splice(i,1); continue;
        }
      } else if(p.kind==='gas'){
        if(t===T.WATER){ puffs.splice(i,1); continue; }
        // toxic vapour DETONATES on contact with open flame or lava
        if((FIRE && FIRE.isBurning(tx,ty)) || t===T.LAVA){
          puffs.splice(i,1);
          explodeAt(p.x,p.y,getTile,setTile);
          continue;
        }
        if(hitWall){ p.x=px0; p.y=py0; p.vx*=0.3; p.vy=-Math.abs(p.vy)*0.3; } // pools against walls
        if(Math.random()<0.3 && MM.mobs && MM.mobs.poisonRadius) MM.mobs.poisonRadius(p.x,p.y,0.95,{dur:4, dps:(p.dps||5)*0.7});
      } else { // steam: purely cosmetic, fades on contact
        if(hitWall || t===T.WATER){ puffs.splice(i,1); continue; }
      }
    }
  }

  // ---- Rendering ----
  function draw(ctx,TILE){
    if(arrows.length){
      ctx.save();
      for(const a of arrows){
        const ang=a.stuck? a.ang||0 : Math.atan2(a.vy,a.vx);
        if(!a.stuck) a.ang=ang;
        ctx.save();
        ctx.translate(a.x*TILE, a.y*TILE); ctx.rotate(ang);
        ctx.strokeStyle='#caa472'; ctx.lineWidth=2;
        ctx.beginPath(); ctx.moveTo(-10,0); ctx.lineTo(6,0); ctx.stroke();
        ctx.fillStyle='#dfe6f1'; // head
        ctx.beginPath(); ctx.moveTo(9,0); ctx.lineTo(4,-2.6); ctx.lineTo(4,2.6); ctx.closePath(); ctx.fill();
        ctx.fillStyle='#e8e2d2'; // fletching
        ctx.fillRect(-11,-2.4,4,1.6); ctx.fillRect(-11,0.8,4,1.6);
        if(a.fire){ // burning arrowhead
          const fl=Math.sin(performance.now()*0.03 + a.x)*0.5+0.5;
          ctx.fillStyle='rgba(255,170,50,'+(0.6+0.3*fl)+')';
          ctx.beginPath(); ctx.arc(7,0,3+fl*1.5,0,Math.PI*2); ctx.fill();
        }
        ctx.restore();
      }
      ctx.restore();
    }
    if(puffs.length){
      if(!spriteCache) buildPuffSprites();
      ctx.save();
      let comp='';
      for(const p of puffs){
        // flame glows additively; water and gas read better as murky overlays
        const want=p.kind==='flame'? 'lighter':'source-over';
        if(comp!==want){ ctx.globalCompositeOperation=want; comp=want; }
        const fr=Math.max(0, p.life/p.total); // 1 fresh → 0 dying
        const r=TILE*(0.25 + (1-fr)*0.65);
        const set=spriteCache[p.kind]||spriteCache.flame;
        const sp= fr>0.6? set.hot : fr>0.3? set.mid : set.tail;
        ctx.globalAlpha= fr>0.3? 1 : Math.max(0, fr/0.3);
        ctx.drawImage(sp, p.x*TILE-r, p.y*TILE-r, r*2, r*2);
      }
      ctx.globalAlpha=1;
      ctx.restore();
    }
    // Explosion shockwave rings
    if(blastsFx.length){
      ctx.save();
      for(const b of blastsFx){
        const fr=b.t/b.max;                 // 0 → 1 over the blast's life
        const r=(0.4+fr*1.6)*b.R*TILE;
        ctx.lineWidth=4*(1-fr)+1;
        ctx.strokeStyle='rgba(255,235,180,'+(0.9*(1-fr)).toFixed(2)+')';
        ctx.beginPath(); ctx.arc(b.x*TILE,b.y*TILE,r,0,Math.PI*2); ctx.stroke();
        ctx.lineWidth=2*(1-fr)+0.5;
        ctx.strokeStyle='rgba(255,120,40,'+(0.7*(1-fr)).toFixed(2)+')';
        ctx.beginPath(); ctx.arc(b.x*TILE,b.y*TILE,r*0.7,0,Math.PI*2); ctx.stroke();
      }
      ctx.restore();
    }
    // Melee slash arc at the struck tile
    if(swing.t>0){
      const a=swing.t/swing.dur;
      const cx=(swing.tx+0.5)*TILE, cy=(swing.ty+0.5)*TILE;
      const base=swing.dir===1? -0.8 : Math.PI+0.8;
      const sweep=(1-a)*1.9*swing.dir;
      ctx.save();
      ctx.lineCap='round';
      ctx.strokeStyle='rgba(255,255,255,'+(0.75*a).toFixed(2)+')';
      ctx.lineWidth=3;
      ctx.beginPath(); ctx.arc(cx,cy,TILE*0.78, base-0.6+sweep, base+0.25+sweep); ctx.stroke();
      ctx.strokeStyle='rgba(255,255,255,'+(0.4*a).toFixed(2)+')';
      ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.arc(cx,cy,TILE*0.52, base-0.5+sweep, base+0.18+sweep); ctx.stroke();
      ctx.restore();
    }
  }
  // The equipped weapon in the hero's hand (world space, called after drawPlayer).
  // Melee blades sweep forward during a swing so hits read on the character too.
  function drawHeld(ctx,TILE,player){
    const it=equippedWeapon(); if(!it) return;
    const type=weaponType(it);
    const facing=(player.facing>=0)?1:-1;
    const bw=player.w*TILE, bh=player.h*TILE;
    const col=tierColor(it);
    ctx.save();
    ctx.translate(player.x*TILE + facing*(bw*0.5+1), player.y*TILE + bh*0.10);
    if(type==='melee'){
      const prog= swing.t>0? 1-swing.t/swing.dur : 0;
      const ang= facing*(-0.5 + (swing.t>0? (-1.3+2.1*prog) : 0));
      ctx.rotate(ang);
      ctx.fillStyle='#e9eef8'; ctx.fillRect(-1,-12,2,12);
      ctx.beginPath(); ctx.moveTo(-1,-12); ctx.lineTo(0,-15); ctx.lineTo(1,-12); ctx.closePath(); ctx.fill();
      ctx.fillStyle=col||'#cfd6e4'; ctx.fillRect(-2.6,0,5.2,1.6);
      ctx.fillStyle='#6e4a22'; ctx.fillRect(-0.9,1.6,1.8,3.4);
    } else if(type==='bow'){
      ctx.strokeStyle=col||'#9a6a32'; ctx.lineWidth=1.6; ctx.lineCap='round';
      const a0=facing===1? -1.15 : Math.PI-1.15, a1=facing===1? 1.15 : Math.PI+1.15;
      ctx.beginPath(); ctx.arc(0,-2,6,a0,a1); ctx.stroke();
      ctx.strokeStyle='#e8e2d2'; ctx.lineWidth=0.8;
      const ex=Math.cos(1.15)*6*facing, ey=Math.sin(1.15)*6;
      ctx.beginPath(); ctx.moveTo(ex,-2-ey); ctx.lineTo(ex,-2+ey); ctx.stroke();
    } else {
      // stream device: body + nozzle tinted by class, with a faint idle wisp
      const tint= type==='flame'? '#b35324' : type==='hose'? '#2c7ef8' : '#4d9230';
      ctx.fillStyle='#3c414d'; ctx.fillRect(facing===1?-2:-4.5, -4, 6.5, 3);
      ctx.fillStyle=col||tint; ctx.fillRect(facing===1?4.5:-6.5, -3.7, 2.2, 2.4);
      ctx.fillStyle='#6e4a22'; ctx.fillRect(facing===1?-0.5:-1.5, -1, 2, 3.4);
      ctx.globalAlpha=0.5;
      ctx.fillStyle=tint;
      ctx.fillRect(facing===1?7:-9, -3.4, 2, 1.8);
      ctx.globalAlpha=1;
    }
    ctx.restore();
  }
  // Baked radial sprites per stream kind: a per-puff createRadialGradient at up to
  // 220 puffs × 60fps caused constant allocation churn — stamp these instead.
  let spriteCache=null;
  function buildPuffSprites(){
    function mk(stops){
      const S=32, c=document.createElement('canvas'); c.width=c.height=S*2;
      const g=c.getContext('2d');
      const gr=g.createRadialGradient(S,S,1,S,S,S);
      stops.forEach(([t,col])=>gr.addColorStop(t,col));
      g.fillStyle=gr; g.beginPath(); g.arc(S,S,S,0,Math.PI*2); g.fill();
      return c;
    }
    spriteCache={
      flame:{
        hot:  mk([[0,'rgba(255,245,200,0.85)'],[0.5,'rgba(255,180,60,0.55)'],[1,'rgba(255,90,20,0)']]),
        mid:  mk([[0,'rgba(255,170,60,0.6)'],[1,'rgba(230,70,20,0)']]),
        tail: mk([[0,'rgba(120,90,70,0.35)'],[1,'rgba(80,60,50,0)']])
      },
      hose:{
        hot:  mk([[0,'rgba(225,245,255,0.9)'],[0.5,'rgba(140,195,255,0.6)'],[1,'rgba(60,120,230,0)']]),
        mid:  mk([[0,'rgba(150,200,255,0.65)'],[1,'rgba(60,110,220,0)']]),
        tail: mk([[0,'rgba(140,180,230,0.4)'],[1,'rgba(90,130,200,0)']])
      },
      gas:{
        hot:  mk([[0,'rgba(215,255,170,0.75)'],[0.5,'rgba(150,230,90,0.5)'],[1,'rgba(80,160,40,0)']]),
        mid:  mk([[0,'rgba(140,220,90,0.55)'],[1,'rgba(70,150,40,0)']]),
        tail: mk([[0,'rgba(95,145,65,0.45)'],[1,'rgba(50,90,40,0)']])
      },
      steam:{
        hot:  mk([[0,'rgba(255,255,255,0.7)'],[0.6,'rgba(225,232,240,0.4)'],[1,'rgba(210,220,230,0)']]),
        mid:  mk([[0,'rgba(235,240,246,0.5)'],[1,'rgba(210,220,230,0)']]),
        tail: mk([[0,'rgba(220,228,236,0.3)'],[1,'rgba(205,215,228,0)']])
      }
    };
  }

  function reset(){ arrows.length=0; puffs.length=0; blastsFx.length=0; bowCd=0; meleeCd=0; bossAcc=0; explodeCd=0; swing.t=0; }
  MM.weapons={fireHeld,update,draw,drawHeld,notifyMeleeSwing,reset,explodeAt,
    metrics:()=>({arrows:arrows.length,puffs:puffs.length})};
})();
// ESM export (progressive migration)
export const weapons = (typeof window!=='undefined' && window.MM) ? window.MM.weapons : undefined;
export default weapons;
