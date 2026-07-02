import { T, INFO, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y, TILE as DEFAULT_TILE } from '../constants.js';
import {
  isDoorTile,
  isObjectFootingTile,
  isPlayerBuiltMaterial,
  isReplaceableNaturalOpenTile,
  isRigidObjectTile,
  isSolidCollisionTile as isSolid,
  isTrapdoorTile
} from './material_physics.js';

// Night invasions are intentionally team-based. Today the implemented team type
// is "aliens", but the save shape and scheduler can host more invader kinds.
const invasions = (function(){
  const root = typeof window !== 'undefined' ? window : globalThis;
  const MM = root.MM = root.MM || {};
  const SAVE_KEY = 'mm_invasions_v1';
  const WORLD_TOP = Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;
  const LASER_CAP = 80;
  const TILE_DAMAGE_CAP = 220;
  const teams = [];
  const caches = [];
  const lasers = [];
  const tileDamage = new Map();
  let seq = 1;
  let lastNightDay = 0;
  let saveAcc = 0;

  function finiteNum(v){ return typeof v === 'number' && Number.isFinite(v); }
  function clamp(v,a,b){ return v < a ? a : (v > b ? b : v); }
  function randRange(a,b){ return a + Math.random() * (b - a); }
  function floor(v){ return Math.floor(Number(v) || 0); }
  function tileKey(x,y){ return floor(x)+','+floor(y); }
  function deepCopy(v){ return JSON.parse(JSON.stringify(v)); }
  function getWorldSeed(){ try{ return (MM.worldGen && MM.worldGen.worldSeed) || 0; }catch(e){ return 0; } }
  function nowMs(){ return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
  function say(text){ try{ if(root.msg) root.msg(text); }catch(e){} }
  function play(name){ try{ if(MM.audio && MM.audio.play) MM.audio.play(name); }catch(e){} }
  function burst(x,y,tier){
    try{
      if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst(x*(MM.TILE || DEFAULT_TILE), y*(MM.TILE || DEFAULT_TILE), tier || 'rare');
    }catch(e){}
  }
  function saveLocal(){
    try{ if(root.localStorage) root.localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot())); }catch(e){}
  }
  function maybeSave(dt){
    saveAcc += Math.max(0, Number(dt) || 0);
    if(saveAcc < 3) return;
    saveAcc = 0;
    saveLocal();
  }
  function currentDayInfo(){
    let dayFloat = 1;
    let isNight = false;
    try{
      const s = MM.seasons && MM.seasons.metrics ? MM.seasons.metrics() : null;
      if(s && Number.isFinite(Number(s.dayFloat))) dayFloat = Number(s.dayFloat);
    }catch(e){}
    try{
      const b = MM.background && MM.background.timeInfo ? MM.background.timeInfo() : null;
      if(b){
        if(b.phase === 'night') isNight = true;
        else if(b.isDay === false) isNight = true;
        else if(Number.isFinite(Number(b.hour))){
          const h = Number(b.hour);
          isNight = h >= 19 || h < 5;
        }
      }
    }catch(e){}
    return {dayFloat, dayIndex:Math.max(1, Math.floor(dayFloat)), isNight};
  }
  function surfaceY(x, fallback){
    const tx = floor(x);
    try{
      const wg = (MM.worldGen && MM.worldGen.surfaceHeight) ? MM.worldGen : null;
      if(wg && wg.surfaceHeight){
        const y = wg.surfaceHeight(tx);
        if(Number.isFinite(y)) return y;
      }
    }catch(e){}
    return Number.isFinite(fallback) ? fallback : 60;
  }
  function readTile(getTile,x,y){
    try{
      if(typeof getTile === 'function') return getTile(floor(x),floor(y));
      if(MM.world && MM.world.getTile) return MM.world.getTile(floor(x),floor(y));
    }catch(e){}
    return T.AIR;
  }
  function writeTile(setTile,x,y,t){
    try{
      if(typeof setTile === 'function'){ setTile(floor(x),floor(y),t); return true; }
      if(MM.world && MM.world.setTile){ MM.world.setTile(floor(x),floor(y),t); return true; }
    }catch(e){}
    return false;
  }
  function inWorldY(y,pad=1){ return Number.isFinite(y) && y >= WORLD_TOP + pad && y < WORLD_BOTTOM - pad; }
  function isAlienOpenTile(t){
    return (isReplaceableNaturalOpenTile(t,false) && t !== T.WATER && t !== T.LAVA) ||
      t === T.TORCH || t === T.GRAVE || t === T.LADDER;
  }
  function canStandAt(tx,ty,getTile){
    if(!inWorldY(ty,2)) return false;
    const here = readTile(getTile,tx,ty);
    const head = readTile(getTile,tx,ty-1);
    const below = readTile(getTile,tx,ty+1);
    return isAlienOpenTile(here) && isAlienOpenTile(head) && below !== T.WATER && below !== T.LAVA && isSolid(below);
  }
  function findSurfaceStandSpot(x, nearY, getTile){
    const tx = floor(x);
    const s = surfaceY(tx, nearY);
    const start = clamp(floor(s) - 10, WORLD_TOP + 3, WORLD_BOTTOM - 5);
    const end = clamp(floor(s) + 28, WORLD_TOP + 3, WORLD_BOTTOM - 4);
    for(let y=start; y<=end; y++){
      if(canStandAt(tx,y,getTile)) return {x:tx+0.5,y};
    }
    for(let y=clamp(floor(nearY || s) - 20, WORLD_TOP + 3, WORLD_BOTTOM - 5); y<WORLD_BOTTOM-4; y++){
      if(canStandAt(tx,y,getTile)) return {x:tx+0.5,y};
    }
    return {x:tx+0.5, y:clamp(floor(s)-1, WORLD_TOP+3, WORLD_BOTTOM-4)};
  }
  function findLandingSpot(player, side, index, getTile){
    const px = floor(player && Number.isFinite(player.x) ? player.x : 0);
    const py = player && Number.isFinite(player.y) ? player.y : surfaceY(px,60);
    const base = 22 + index * 12;
    const candidates = [];
    for(let r=0; r<9; r++){
      const offset = base + r * 5 + Math.floor(Math.random() * 4);
      candidates.push(px + side * offset);
      if(r % 2 === 0) candidates.push(px - side * (offset + 3));
    }
    for(const x of candidates){
      const spot = findSurfaceStandSpot(x, py, getTile);
      if(canStandAt(floor(spot.x), floor(spot.y), getTile)) return spot;
    }
    return findSurfaceStandSpot(px + side * base, py, getTile);
  }
  function teamCountForDay(day){
    return Math.max(1, Math.min(4, 1 + Math.floor(Math.max(0,(day|0)-1) / 4)));
  }
  function alienCountForDay(day,index){
    return Math.max(3, Math.min(11, 3 + Math.floor((day|0) / 2) + Math.floor(index / 2)));
  }
  function xpRewardForTeam(day,count){
    return 160 + Math.max(0,day|0) * 24 + Math.max(1,count|0) * 30;
  }
  function makeAlien(team, x, y, i){
    const day = Math.max(1, team.day|0);
    const hp = 18 + day * 3 + Math.floor(i * 1.5);
    return {
      id:team.id+':a'+i,
      teamId:team.id,
      x:x + (i - (team.alienCount-1)/2) * 0.75,
      y,
      vx:randRange(-0.2,0.2),
      vy:0,
      hp,
      maxHp:hp,
      attackCd:0.35 + Math.random() * 0.8,
      breakCd:0,
      onGround:false,
      facing:Math.random() < 0.5 ? -1 : 1,
      hitFlashUntil:0,
      dead:false,
      phase:Math.random()*Math.PI*2
    };
  }
  function makeAlienTeam(player, getTile, opts){
    opts = opts || {};
    const day = Math.max(1, opts.day || currentDayInfo().dayIndex || 1);
    const index = Math.max(0, opts.index|0);
    const side = opts.side || (index % 2 === 0 ? -1 : 1);
    const spot = opts.spot || findLandingSpot(player, side, index, getTile);
    const alienCount = Math.max(1, opts.alienCount || alienCountForDay(day,index));
    const id = 'inv_'+(seq++);
    const landY = spot.y - 2.3;
    return {
      id,
      kind:'aliens',
      day,
      index,
      state:'landing',
      x:spot.x,
      y:spot.y,
      alienCount,
      xpReward:xpRewardForTeam(day,alienCount),
      startedAt:Date.now(),
      defeatedAt:0,
      announced:false,
      lander:{
        x:spot.x,
        y:Math.max(WORLD_TOP + 6, spot.y - 26 - index * 2),
        targetY:landY,
        vx:0,
        vy:3.8 + Math.min(1.8, day * 0.04),
        hp:80 + day * 18,
        maxHp:80 + day * 18,
        destroyed:false,
        landed:false,
        phase:Math.random()*Math.PI*2
      },
      aliens:[]
    };
  }
  function spawnNightInvasion(player, getTile, setTile, opts){
    opts = opts || {};
    const day = Math.max(1, opts.day || currentDayInfo().dayIndex || 1);
    const count = Math.max(1, Math.min(6, opts.teams || teamCountForDay(day)));
    const spawned = [];
    for(let i=0; i<count; i++){
      const team = makeAlienTeam(player, getTile, {day,index:i,side:i%2===0?-1:1,alienCount:opts.alienCount});
      teams.push(team);
      spawned.push(team);
    }
    if(spawned.length){
      lastNightDay = Math.max(lastNightDay, day);
      say(count > 1 ? 'Nocna inwazja: '+count+' oddzialy obcych laduja w okolicy.' : 'Nocna inwazja: obcy laduja w okolicy.');
      play('warning');
      maybeSave(99);
    }
    return spawned;
  }
  function activeAlienTeams(){
    return teams.filter(t=>t && t.kind === 'aliens' && t.state !== 'defeated' && t.state !== 'retreat');
  }
  function maybeScheduleNight(player,getTile,setTile){
    const info = currentDayInfo();
    if(!info.isNight || !player || player.hp <= 0) return false;
    if(lastNightDay >= info.dayIndex) return false;
    spawnNightInvasion(player,getTile,setTile,{day:info.dayIndex});
    return true;
  }
  function landerTileHit(lander,tx,ty){
    if(!lander || lander.destroyed) return false;
    return Math.abs((tx+0.5) - lander.x) <= 2.1 && Math.abs((ty+0.5) - lander.y) <= 1.2;
  }
  function spawnAliens(team){
    if(!team || team.aliens.length) return;
    const baseY = team.y;
    for(let i=0; i<team.alienCount; i++){
      team.aliens.push(makeAlien(team, team.x, baseY, i));
    }
    team.state = 'active';
    team.lander.landed = true;
  }
  function alienCollidesAt(a,x,y,getTile){
    const hw = 0.28;
    const h = 0.86;
    const xs = [x-hw, x+hw];
    const ys = [y-0.05, y-h*0.5, y-h];
    for(const sx of xs){
      for(const sy of ys){
        const t = readTile(getTile, Math.floor(sx), Math.floor(sy));
        if(isSolid(t)) return true;
      }
    }
    return false;
  }
  function moveAlien(a,dt,getTile){
    const stepDt = Math.max(0, Math.min(0.05, dt || 0));
    a.vy = Math.min(18, (a.vy || 0) + 22 * stepDt);
    const ox = a.x;
    const nx = a.x + (a.vx || 0) * stepDt;
    if(!alienCollidesAt(a,nx,a.y,getTile)){
      a.x = nx;
    } else {
      a.x = ox;
      a.vx *= -0.10;
    }
    const oy = a.y;
    const ny = a.y + (a.vy || 0) * stepDt;
    if(!alienCollidesAt(a,a.x,ny,getTile)){
      a.y = ny;
      a.onGround = false;
    } else {
      if(a.vy > 0){
        let yy = oy;
        for(let i=0;i<8;i++){
          const test = yy + 0.03;
          if(alienCollidesAt(a,a.x,test,getTile)) break;
          yy = test;
        }
        a.y = yy;
        a.onGround = true;
      } else {
        a.y = oy;
      }
      a.vy = 0;
    }
    if(!inWorldY(a.y,1)){ a.hp = 0; a.dead = true; }
  }
  function laserBlockedTile(t){
    return t !== T.AIR && t !== T.WATER && isSolid(t);
  }
  function traceLine(sx,sy,tx,ty,getTile,maxDist){
    const dx = tx - sx;
    const dy = ty - sy;
    const len = Math.hypot(dx,dy) || 1;
    const dist = Math.min(maxDist || 16, len);
    const nx = dx / len;
    const ny = dy / len;
    let endX = sx + nx * dist;
    let endY = sy + ny * dist;
    for(let d=0.35; d<=dist; d+=0.20){
      const x = sx + nx * d;
      const y = sy + ny * d;
      const txi = Math.floor(x), tyi = Math.floor(y);
      const t = readTile(getTile,txi,tyi);
      if(laserBlockedTile(t)){
        endX = sx + nx * Math.max(0,d - 0.08);
        endY = sy + ny * Math.max(0,d - 0.08);
        return {x:endX,y:endY,blocked:true,clear:false,tx:txi,ty:tyi,tile:t};
      }
    }
    return {x:endX,y:endY,blocked:false,clear:Math.hypot(tx-endX,ty-endY) < 0.75,tx:Math.floor(endX),ty:Math.floor(endY),tile:T.AIR};
  }
  function pushLaser(x1,y1,x2,y2,hit,blocked){
    lasers.push({x1,y1,x2,y2,t:0,life:0.20,hit:!!hit,blocked:!!blocked,phase:Math.random()*Math.PI*2});
    while(lasers.length > LASER_CAP) lasers.shift();
  }
  function isAttackableStructureTile(t){
    if(t === T.AIR || t === T.WATER || t === T.LAVA || t === T.BEDROCK || t === T.INVASION_CACHE) return false;
    const info = INFO[t];
    if(info && (info.story || info.unmineable)) return false;
    return isPlayerBuiltMaterial(t) || isDoorTile(t) || isTrapdoorTile(t) || isRigidObjectTile(t) ||
      t === T.WOOD || t === T.STEEL || t === T.GLASS || t === T.BRICK || t === T.STONE;
  }
  function wakeTileChanged(ctx,x,y,oldTile,newTile){
    try{
      if(ctx && typeof ctx.onStructureChanged === 'function') ctx.onStructureChanged(x,y,oldTile,newTile);
      else if(ctx && typeof ctx.notifyStructureTileChanged === 'function') ctx.notifyStructureTileChanged(x,y,oldTile,newTile);
    }catch(e){}
  }
  function damageStructureTile(tx,ty,amount,getTile,setTile,ctx){
    const t = readTile(getTile,tx,ty);
    if(!isAttackableStructureTile(t)) return false;
    const info = INFO[t] || INFO[T.STONE];
    const hp = Math.max(2, Math.min(34, (Number(info.hp) || 4) * (isPlayerBuiltMaterial(t) ? 1.35 : 2.15)));
    const key = tileKey(tx,ty);
    const next = (tileDamage.get(key) || 0) + Math.max(0.4, amount || 1);
    if(next < hp){
      tileDamage.set(key,next);
      if(tileDamage.size > TILE_DAMAGE_CAP) tileDamage.delete(tileDamage.keys().next().value);
      return true;
    }
    tileDamage.delete(key);
    if(writeTile(setTile,tx,ty,T.AIR)){
      wakeTileChanged(ctx,tx,ty,t,T.AIR);
      burst(tx+0.5,ty+0.5,'common');
      return true;
    }
    return false;
  }
  function shouldBreakBlockedTile(hit,player){
    if(!hit || !hit.blocked || !isAttackableStructureTile(hit.tile)) return false;
    const px = player && Number.isFinite(player.x) ? player.x : 0;
    const py = player && Number.isFinite(player.y) ? player.y : 0;
    return Math.hypot((hit.tx+0.5)-px,(hit.ty+0.5)-py) <= 7.5;
  }
  function fireAlienLaser(a,team,player,getTile,setTile,ctx){
    const range = 14 + Math.min(6, (team.day || 1) * 0.35);
    const ox = a.x + (a.facing || 1) * 0.23;
    const oy = a.y - 0.62;
    const aimX = (Number.isFinite(player.vx) ? player.x + player.vx * 0.08 : player.x);
    const aimY = (Number.isFinite(player.vy) ? player.y - 0.52 + player.vy * 0.035 : player.y - 0.52);
    const hit = traceLine(ox,oy,aimX,aimY,getTile,range);
    pushLaser(ox,oy,hit.x,hit.y,hit.clear,hit.blocked);
    if(hit.clear){
      try{
        if(root.damageHero) root.damageHero(5 + Math.min(4, Math.floor((team.day || 1) / 5)), {srcX:a.x,srcY:a.y-0.4,kb:3.5,kbY:-2.2,invulMs:430,cause:'alien_invasion'});
      }catch(e){}
      return true;
    }
    if(shouldBreakBlockedTile(hit,player)){
      damageStructureTile(hit.tx,hit.ty,3.6 + Math.min(3, (team.day || 1) * 0.22),getTile,setTile,ctx);
      return true;
    }
    return false;
  }
  function updateAlien(a,team,dt,player,getTile,setTile,ctx){
    if(!a || a.dead || a.hp <= 0) return;
    const px = player && Number.isFinite(player.x) ? player.x : a.x;
    const py = player && Number.isFinite(player.y) ? player.y : a.y;
    const dx = px - a.x;
    const dy = (py - 0.4) - (a.y - 0.45);
    const dist = Math.hypot(dx,dy) || 1;
    a.facing = dx >= 0 ? 1 : -1;
    const speed = 2.35 + Math.min(1.4, (team.day || 1) * 0.06);
    const desired = Math.abs(dx) > 0.45 ? Math.sign(dx) * speed : 0;
    a.vx += (desired - (a.vx || 0)) * Math.min(1, dt * 5.8);
    const aheadX = a.x + a.facing * 0.42;
    if(a.onGround && alienCollidesAt(a,aheadX,a.y,getTile)){
      a.vy = -7.4 - Math.min(1.4, (team.day || 1) * 0.04);
      a.onGround = false;
    }
    a.attackCd = Math.max(0, (a.attackCd || 0) - dt);
    if(dist < 14.5 && a.attackCd <= 0){
      fireAlienLaser(a,team,player,getTile,setTile,ctx);
      a.attackCd = 0.72 + Math.random() * 0.38;
      a.vx *= 0.62;
    }
    if(dist < 0.72 && Math.abs(dy) < 1.0 && a.attackCd <= 0.15){
      try{ if(root.damageHero) root.damageHero(3,{srcX:a.x,srcY:a.y,kb:2.4,invulMs:500,cause:'alien_invasion'}); }catch(e){}
      a.attackCd = 0.55;
    }
    const steps = Math.max(1, Math.min(4, Math.ceil(Math.max(Math.abs(a.vx || 0), Math.abs(a.vy || 0)) * dt / 0.25)));
    for(let i=0;i<steps;i++) moveAlien(a,dt/steps,getTile);
  }
  function updateLander(team,dt){
    const l = team && team.lander;
    if(!l || l.destroyed || l.landed) return;
    l.phase = (l.phase || 0) + dt * 2.4;
    l.y += (l.vy || 2.8) * dt;
    if(l.y >= l.targetY){
      l.y = l.targetY;
      spawnAliens(team);
      say('Obcy wyszli z ladowiska i namierzaja bohatera.');
      play('laser');
    }
  }
  function defeatTeam(team,player){
    if(!team || team.state === 'defeated') return false;
    team.state = 'defeated';
    team.defeatedAt = Date.now();
    const reward = Math.max(60, team.xpReward || 160);
    if(player && typeof player.xp === 'number') player.xp += reward;
    say('Oddzial obcych pokonany: +'+reward+' XP.');
    play('milestone');
    burst(team.x,team.y-1,'epic');
    return true;
  }
  function updateTeams(dt,player,getTile,setTile,ctx){
    for(const team of teams){
      if(!team || team.state === 'defeated' || team.state === 'retreat') continue;
      updateLander(team,dt);
      if(team.lander && team.lander.destroyed && !team.aliens.length){
        defeatTeam(team,player);
        continue;
      }
      let alive = 0;
      for(const a of team.aliens){
        if(!a || a.dead || a.hp <= 0) continue;
        updateAlien(a,team,dt,player,getTile,setTile,ctx);
        if(a.hp > 0 && !a.dead) alive++;
      }
      if(team.state === 'active' && alive <= 0) defeatTeam(team,player);
    }
    for(let i=teams.length-1;i>=0;i--){
      const t = teams[i];
      if(t && t.state === 'defeated' && t.defeatedAt && Date.now() - t.defeatedAt > 5000) teams.splice(i,1);
    }
  }
  function updateLasers(dt){
    for(let i=lasers.length-1;i>=0;i--){
      lasers[i].t += dt;
      if(lasers[i].t >= lasers[i].life) lasers.splice(i,1);
    }
  }
  function update(dt,player,getTile,setTile,ctx){
    ctx = ctx || {};
    dt = Math.max(0, Math.min(0.08, Number(dt) || 0));
    maybeScheduleNight(player,getTile,setTile);
    updateTeams(dt,player,getTile,setTile,ctx);
    updateLasers(dt);
    maybeSave(dt);
  }
  function findTargetAt(tx,ty){
    for(const team of teams){
      if(!team || team.state === 'defeated') continue;
      if(team.lander && landerTileHit(team.lander,tx,ty)) return {team,lander:team.lander};
      for(const a of team.aliens){
        if(!a || a.dead || a.hp <= 0) continue;
        if(Math.abs((tx+0.5)-a.x) <= 0.75 && Math.abs((ty+0.5)-(a.y-0.45)) <= 0.95) return {team,alien:a};
      }
    }
    return null;
  }
  function damageAt(tx,ty,dmg){
    const hit = findTargetAt(tx,ty);
    if(!hit) return false;
    const amount = Math.max(0.5, Number(dmg) || 1);
    if(hit.alien){
      hit.alien.hp -= amount;
      hit.alien.hitFlashUntil = nowMs() + 120;
      if(hit.alien.hp <= 0){
        hit.alien.dead = true;
        burst(hit.alien.x,hit.alien.y-0.4,'rare');
      }
      return true;
    }
    if(hit.lander){
      hit.lander.hp -= amount;
      if(hit.lander.hp <= 0){
        hit.lander.destroyed = true;
        hit.lander.landed = true;
        burst(hit.lander.x,hit.lander.y,'epic');
      }
      return true;
    }
    return false;
  }
  function attackAt(tx,ty,bonus){
    return damageAt(tx,ty,3 + Math.max(0, Number(bonus) || 0));
  }
  function blastRadius(wx,wy,r,dmg){
    let hit = false;
    const radius = Math.max(0.5, Number(r) || 1);
    const amount = Math.max(1, Number(dmg) || 6);
    for(const team of teams){
      if(!team || team.state === 'defeated') continue;
      if(team.lander && !team.lander.destroyed && Math.hypot(team.lander.x-wx,team.lander.y-wy) <= radius + 1.8){
        team.lander.hp -= amount;
        if(team.lander.hp <= 0){ team.lander.destroyed = true; team.lander.landed = true; }
        hit = true;
      }
      for(const a of team.aliens){
        if(!a || a.dead || a.hp <= 0) continue;
        if(Math.hypot(a.x-wx,(a.y-0.4)-wy) <= radius){
          a.hp -= amount;
          a.hitFlashUntil = nowMs() + 150;
          if(a.hp <= 0){ a.dead = true; burst(a.x,a.y-0.4,'rare'); }
          hit = true;
        }
      }
    }
    return hit;
  }
  function draw(ctx,tileSize,canDrawTile){
    const TILE_SIZE = tileSize || DEFAULT_TILE;
    const visible = (x,y)=> typeof canDrawTile === 'function' ? !!canDrawTile(Math.floor(x),Math.floor(y)) : true;
    const now = nowMs();
    ctx.save();
    ctx.lineCap = 'round';
    for(const l of lasers){
      const a = Math.max(0, 1 - l.t / Math.max(0.001,l.life));
      if(!visible(l.x1,l.y1) && !visible(l.x2,l.y2)) continue;
      ctx.globalAlpha = a;
      ctx.strokeStyle = l.hit ? 'rgba(115,255,222,0.92)' : 'rgba(255,111,91,0.86)';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(l.x1*TILE_SIZE,l.y1*TILE_SIZE);
      ctx.lineTo(l.x2*TILE_SIZE,l.y2*TILE_SIZE);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(236,255,255,0.85)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(l.x1*TILE_SIZE,l.y1*TILE_SIZE);
      ctx.lineTo(l.x2*TILE_SIZE,l.y2*TILE_SIZE);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for(const team of teams){
      if(!team || team.state === 'defeated') continue;
      const l = team.lander;
      if(l && !l.destroyed && visible(l.x,l.y)){
        const px = l.x*TILE_SIZE, py = l.y*TILE_SIZE;
        const pulse = 0.5 + Math.sin((l.phase||0)*2.4)*0.5;
        ctx.fillStyle = 'rgba(28,44,52,0.92)';
        ctx.beginPath(); ctx.ellipse(px,py,TILE_SIZE*1.9,TILE_SIZE*0.55,0,0,Math.PI*2); ctx.fill();
        ctx.fillStyle = 'rgba(118,255,218,'+(0.22+pulse*0.24).toFixed(3)+')';
        ctx.beginPath(); ctx.ellipse(px,py+TILE_SIZE*0.22,TILE_SIZE*1.05,TILE_SIZE*0.20,0,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle = 'rgba(194,255,236,0.70)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(px,py-TILE_SIZE*0.12,TILE_SIZE*1.20,TILE_SIZE*0.36,0,0,Math.PI*2); ctx.stroke();
        if(l.hp < l.maxHp){
          ctx.fillStyle='rgba(0,0,0,0.48)'; ctx.fillRect(px-TILE_SIZE*1.25,py-TILE_SIZE*1.1,TILE_SIZE*2.5,4);
          ctx.fillStyle='#7dffdc'; ctx.fillRect(px-TILE_SIZE*1.25,py-TILE_SIZE*1.1,TILE_SIZE*2.5*Math.max(0,l.hp/l.maxHp),4);
        }
      }
      for(const a of team.aliens){
        if(!a || a.dead || a.hp <= 0 || !visible(a.x,a.y)) continue;
        const px = a.x*TILE_SIZE, foot = a.y*TILE_SIZE;
        const hurt = now < (a.hitFlashUntil || 0);
        ctx.fillStyle = hurt ? '#eaffff' : '#9edac1';
        ctx.beginPath(); ctx.ellipse(px,foot-TILE_SIZE*0.62,TILE_SIZE*0.24,TILE_SIZE*0.30,0,0,Math.PI*2); ctx.fill();
        ctx.fillStyle = hurt ? '#a9fff1' : '#4f897a';
        ctx.fillRect(px-TILE_SIZE*0.18,foot-TILE_SIZE*0.45,TILE_SIZE*0.36,TILE_SIZE*0.34);
        ctx.fillStyle = '#07110f';
        ctx.fillRect(px-TILE_SIZE*0.12,foot-TILE_SIZE*0.68,TILE_SIZE*0.08,TILE_SIZE*0.10);
        ctx.fillRect(px+TILE_SIZE*0.04,foot-TILE_SIZE*0.68,TILE_SIZE*0.08,TILE_SIZE*0.10);
        ctx.strokeStyle = 'rgba(110,255,221,0.76)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(px-a.facing*TILE_SIZE*0.08,foot-TILE_SIZE*0.42);
        ctx.lineTo(px+a.facing*TILE_SIZE*0.33,foot-TILE_SIZE*0.55);
        ctx.stroke();
        if(a.hp < a.maxHp){
          ctx.fillStyle='rgba(0,0,0,0.45)'; ctx.fillRect(px-TILE_SIZE*0.32,foot-TILE_SIZE*1.02,TILE_SIZE*0.64,3);
          ctx.fillStyle='#79ffcf'; ctx.fillRect(px-TILE_SIZE*0.32,foot-TILE_SIZE*1.02,TILE_SIZE*0.64*Math.max(0,a.hp/a.maxHp),3);
        }
      }
    }
    ctx.restore();
  }
  function shuffle(arr){
    for(let i=arr.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }
  function stealResources(inv,resourceKeys){
    const stolen = {};
    if(!inv) return stolen;
    for(const key of resourceKeys || []){
      const cur = Math.max(0, Math.floor(Number(inv[key]) || 0));
      if(cur <= 0) continue;
      let n = cur === 1 ? (Math.random() < 0.5 ? 1 : 0) : Math.floor(cur * (0.42 + Math.random()*0.18));
      n = Math.max(0, Math.min(cur,n));
      if(n > 0){
        stolen[key] = n;
        inv[key] = cur - n;
      }
    }
    return stolen;
  }
  function stealGear(inventory){
    if(!inventory || typeof inventory.snapshot !== 'function' || typeof inventory.restore !== 'function') return {gear:[],equipped:{}};
    const snap = inventory.snapshot();
    if(!snap || !Array.isArray(snap.bag)) return {gear:[],equipped:{}};
    const bag = snap.bag.filter(i=>i && typeof i.id === 'string');
    if(!bag.length) return {gear:[],equipped:{}};
    const stealN = Math.max(1, Math.floor(bag.length / 2));
    const chosen = new Set();
    const equipped = snap.equipped && typeof snap.equipped === 'object' ? snap.equipped : {};
    const dynamicIds = new Set(bag.map(i=>i.id));
    const equippedIds = shuffle(Object.values(equipped).filter(id=>typeof id === 'string' && dynamicIds.has(id)));
    for(const id of equippedIds){
      if(chosen.size >= stealN) break;
      if(Math.random() < 0.72) chosen.add(id);
    }
    for(const item of shuffle(bag.slice())){
      if(chosen.size >= stealN) break;
      chosen.add(item.id);
    }
    if(!chosen.size) return {gear:[],equipped:{}};
    const stolenGear = bag.filter(item=>chosen.has(item.id)).map(item=>Object.assign({}, item));
    const next = deepCopy(snap);
    next.bag = (next.bag || []).filter(item=>!(item && chosen.has(item.id)));
    next.newItems = Array.isArray(next.newItems) ? next.newItems.filter(id=>!chosen.has(id)) : [];
    next.shortcutOff = Array.isArray(next.shortcutOff) ? next.shortcutOff.filter(id=>!chosen.has(id)) : [];
    const stolenEquipped = {};
    const slots = Array.isArray(inventory.SLOTS) ? inventory.SLOTS : [
      {id:'cape',required:true,def:'classic'},
      {id:'eyes',required:true,def:'bright'},
      {id:'outfit',required:true,def:'default'},
      {id:'weapon',required:false,def:null},
      {id:'charm',required:false,def:null}
    ];
    next.equipped = next.equipped && typeof next.equipped === 'object' ? next.equipped : {};
    for(const slot of slots){
      const cur = next.equipped[slot.id];
      if(cur && chosen.has(cur)){
        stolenEquipped[slot.id] = cur;
        next.equipped[slot.id] = slot.required ? slot.def : null;
      }
    }
    inventory.restore(next,{persist:true,silent:false});
    return {gear:stolenGear,equipped:stolenEquipped};
  }
  function resourceCount(obj){
    let total = 0;
    for(const k in obj || {}) total += Math.max(0, Math.floor(Number(obj[k]) || 0));
    return total;
  }
  function findCacheSpot(player,getTile,ctx){
    const px = floor(player && Number.isFinite(player.x) ? player.x : 0);
    const py = player && Number.isFinite(player.y) ? player.y : surfaceY(px,60);
    const dirs = shuffle([-1,1]);
    const candidates = [];
    for(const dir of dirs){
      for(let d=18; d<=72; d+=4){
        candidates.push(px + dir * (d + Math.floor(Math.random()*3)));
      }
    }
    for(const x of candidates){
      const s = findSurfaceStandSpot(x,py,getTile);
      const tx = floor(s.x);
      const ty = floor(s.y);
      for(let y=ty; y>=ty-4; y--){
        const here = readTile(getTile,tx,y);
        const below = readTile(getTile,tx,y+1);
        if(isReplaceableNaturalOpenTile(here,false) && here !== T.WATER && below !== T.WATER && below !== T.LAVA && isObjectFootingTile(below)){
          if(ctx && typeof ctx.ensureChunkAtY === 'function') try{ ctx.ensureChunkAtY(Math.floor(tx/64), y); }catch(e){}
          return {x:tx,y};
        }
      }
    }
    const fallback = findSurfaceStandSpot(px + (Math.random()<0.5?-36:36),py,getTile);
    return {x:floor(fallback.x), y:floor(fallback.y)};
  }
  function onHeroKilled(ctx){
    ctx = ctx || {};
    const inv = ctx.inv || root.inv;
    const inventory = ctx.inventory || MM.inventory;
    const stolenResources = stealResources(inv, ctx.resourceKeys || []);
    const stolenGear = stealGear(inventory);
    const totalResources = resourceCount(stolenResources);
    const totalGear = stolenGear.gear.length;
    if(totalResources <= 0 && totalGear <= 0){
      say('Obcy przeszukali plecak, ale nie mieli czego zabrac.');
      return {handled:true,empty:true};
    }
    const player = ctx.player || {};
    const spot = findCacheSpot(player,ctx.getTile,ctx);
    const cache = {
      id:'cache_'+(seq++),
      x:spot.x,
      y:spot.y,
      resources:stolenResources,
      gear:stolenGear.gear,
      equipped:stolenGear.equipped,
      seed:getWorldSeed(),
      createdAt:Date.now()
    };
    caches.push(cache);
    writeTile(ctx.setTile,spot.x,spot.y,T.INVASION_CACHE);
    wakeTileChanged(ctx,spot.x,spot.y,T.AIR,T.INVASION_CACHE);
    burst(spot.x+0.5,spot.y+0.5,'epic');
    say('Obcy zabrali lup i ukryli skrytke gdzies w okolicy.');
    play('grave');
    saveLocal();
    return {handled:true,cache,resources:totalResources,gear:totalGear};
  }
  function restoreCacheLoot(cache,ctx){
    const inv = ctx.inv || root.inv;
    const inventory = ctx.inventory || MM.inventory;
    const got = [];
    for(const key in cache.resources || {}){
      const n = Math.max(0, Math.floor(Number(cache.resources[key]) || 0));
      if(n > 0 && inv && typeof inv[key] === 'number'){
        inv[key] += n;
        got.push(n+'x '+key);
      }
    }
    let gearCount = 0;
    if(inventory && typeof inventory.grantItem === 'function'){
      for(const item of cache.gear || []){
        if(item && item.id && inventory.grantItem(item,{markNew:true,essential:true})) gearCount++;
      }
      if(cache.equipped && typeof inventory.equip === 'function'){
        for(const slot in cache.equipped){
          const id = cache.equipped[slot];
          if(typeof id === 'string') inventory.equip(id);
        }
      }
    }
    return {resourceStacks:got.length,resourceUnits:resourceCount(cache.resources),gearCount};
  }
  function openCacheAt(tx,ty,ctx){
    ctx = ctx || {};
    if(readTile(ctx.getTile,tx,ty) !== T.INVASION_CACHE) return false;
    const idx = caches.findIndex(c=>c && c.x === tx && c.y === ty);
    writeTile(ctx.setTile,tx,ty,T.AIR);
    wakeTileChanged(ctx,tx,ty,T.INVASION_CACHE,T.AIR);
    if(idx < 0){
      say('Pusta skrytka obcych.');
      return true;
    }
    const cache = caches.splice(idx,1)[0];
    const restored = restoreCacheLoot(cache,ctx);
    try{ if(typeof ctx.updateInventory === 'function') ctx.updateInventory(); }catch(e){}
    burst(tx+0.5,ty+0.5,'epic');
    play('chest');
    const parts = [];
    if(restored.resourceUnits) parts.push(restored.resourceUnits+' zasobow');
    if(restored.gearCount) parts.push(restored.gearCount+' przedm.');
    say('Odzyskano skrytke obcych: '+(parts.length ? parts.join(', ') : 'pusto')+'.');
    saveLocal();
    try{ if(typeof ctx.saveState === 'function') ctx.saveState(); }catch(e){}
    return true;
  }
  function snapshot(){
    return {
      v:1,
      lastNightDay,
      seq,
      teams:teams.map(t=>deepCopy(t)),
      caches:caches.map(c=>deepCopy(c))
    };
  }
  function normalizeAlien(a){
    if(!a || typeof a !== 'object') return null;
    return {
      id:String(a.id || 'alien'),
      teamId:String(a.teamId || ''),
      x:finiteNum(a.x)?a.x:0,
      y:finiteNum(a.y)?a.y:0,
      vx:finiteNum(a.vx)?a.vx:0,
      vy:finiteNum(a.vy)?a.vy:0,
      hp:finiteNum(a.hp)?a.hp:1,
      maxHp:finiteNum(a.maxHp)?a.maxHp:Math.max(1,Number(a.hp)||1),
      attackCd:finiteNum(a.attackCd)?a.attackCd:0.5,
      breakCd:finiteNum(a.breakCd)?a.breakCd:0,
      onGround:!!a.onGround,
      facing:a.facing < 0 ? -1 : 1,
      hitFlashUntil:0,
      dead:!!a.dead || (Number(a.hp)||0) <= 0,
      phase:finiteNum(a.phase)?a.phase:0
    };
  }
  function normalizeTeam(t){
    if(!t || typeof t !== 'object') return null;
    const alienCount = Math.max(0, Math.min(20, Number(t.alienCount) || (Array.isArray(t.aliens) ? t.aliens.length : 0)));
    const lander = t.lander && typeof t.lander === 'object' ? t.lander : {};
    return {
      id:String(t.id || ('inv_'+(seq++))),
      kind:t.kind === 'aliens' ? 'aliens' : String(t.kind || 'aliens'),
      day:Math.max(1, Number(t.day)||1),
      index:Math.max(0, Number(t.index)||0),
      state:t.state === 'active' || t.state === 'defeated' || t.state === 'retreat' ? t.state : 'landing',
      x:finiteNum(t.x)?t.x:0,
      y:finiteNum(t.y)?t.y:60,
      alienCount,
      xpReward:Math.max(1, Number(t.xpReward)||xpRewardForTeam(t.day||1,alienCount||3)),
      startedAt:Number(t.startedAt)||Date.now(),
      defeatedAt:Number(t.defeatedAt)||0,
      announced:!!t.announced,
      lander:{
        x:finiteNum(lander.x)?lander.x:(finiteNum(t.x)?t.x:0),
        y:finiteNum(lander.y)?lander.y:(finiteNum(t.y)?t.y-3:57),
        targetY:finiteNum(lander.targetY)?lander.targetY:(finiteNum(t.y)?t.y-2.3:57),
        vx:finiteNum(lander.vx)?lander.vx:0,
        vy:finiteNum(lander.vy)?lander.vy:3.5,
        hp:finiteNum(lander.hp)?lander.hp:80,
        maxHp:finiteNum(lander.maxHp)?lander.maxHp:Math.max(80, Number(lander.hp)||80),
        destroyed:!!lander.destroyed,
        landed:!!lander.landed,
        phase:finiteNum(lander.phase)?lander.phase:0
      },
      aliens:Array.isArray(t.aliens) ? t.aliens.map(normalizeAlien).filter(Boolean).slice(0,24) : []
    };
  }
  function normalizeCache(c){
    if(!c || typeof c !== 'object' || !Number.isFinite(Number(c.x)) || !Number.isFinite(Number(c.y))) return null;
    const resources = {};
    if(c.resources && typeof c.resources === 'object'){
      for(const k in c.resources){
        const n = Math.max(0, Math.floor(Number(c.resources[k]) || 0));
        if(n > 0) resources[k] = n;
      }
    }
    return {
      id:String(c.id || ('cache_'+(seq++))),
      x:floor(c.x),
      y:floor(c.y),
      resources,
      gear:Array.isArray(c.gear) ? c.gear.filter(i=>i && i.id).map(i=>Object.assign({},i)).slice(0,80) : [],
      equipped:c.equipped && typeof c.equipped === 'object' ? Object.assign({},c.equipped) : {},
      seed:Number(c.seed)||getWorldSeed(),
      createdAt:Number(c.createdAt)||Date.now()
    };
  }
  function restore(data,getTile,setTile){
    teams.length = 0;
    caches.length = 0;
    lasers.length = 0;
    tileDamage.clear();
    if(!data || typeof data !== 'object') return false;
    lastNightDay = Math.max(0, Number(data.lastNightDay)||0);
    seq = Math.max(1, Number(data.seq)||1);
    if(Array.isArray(data.teams)) teams.push(...data.teams.map(normalizeTeam).filter(Boolean).slice(0,12));
    if(Array.isArray(data.caches)){
      caches.push(...data.caches.map(normalizeCache).filter(Boolean).slice(0,24));
      for(const c of caches){
        if(readTile(getTile,c.x,c.y) !== T.INVASION_CACHE) writeTile(setTile,c.x,c.y,T.INVASION_CACHE);
      }
    }
    saveLocal();
    return true;
  }
  function reset(){
    teams.length = 0;
    caches.length = 0;
    lasers.length = 0;
    tileDamage.clear();
    lastNightDay = 0;
    seq = 1;
    saveLocal();
  }
  function metrics(){
    let aliens = 0;
    for(const t of teams) for(const a of t.aliens || []) if(a && !a.dead && a.hp > 0) aliens++;
    return {teams:teams.length, activeTeams:activeAlienTeams().length, aliens, caches:caches.length, lasers:lasers.length, lastNightDay};
  }
  function forceNightInvasion(player,getTile,setTile,opts){
    return spawnNightInvasion(player,getTile,setTile,opts || {});
  }

  try{
    if(root.localStorage){
      const raw = root.localStorage.getItem(SAVE_KEY);
      if(raw) restore(JSON.parse(raw));
    }
  }catch(e){}

  const api = {
    update,
    draw,
    attackAt,
    damageAt,
    blastRadius,
    onHeroKilled,
    openCacheAt,
    forceNightInvasion,
    snapshot,
    restore,
    reset,
    metrics,
    state:()=>({teams:teams.map(t=>deepCopy(t)), caches:caches.map(c=>deepCopy(c)), lastNightDay, seq}),
    _debug:{teams,caches,lasers,tileDamage,traceLine,damageStructureTile,findCacheSpot,stealResources,stealGear}
  };
  MM.invasions = api;
  return api;
})();

export { invasions };
export default invasions;
