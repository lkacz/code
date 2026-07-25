// Fishing (wędkarstwo): a calm counter-loop to combat. Craft a rod (recipe in
// main.js), stand near water and press F — the line arcs to the nearest water
// surface in your facing direction. After a seeded wait the bobber dips (❗ +
// splash): press F inside the reaction window to set the hook. Bigger fish
// fight back with extra timed pulls — pressing early spooks them, pressing
// late loses them. Catches pay food fish (soup recipe), a rare golden fish
// (potion ingredient, trader money) and XP scaled by the fight.
//
// The whole state machine is DOM-free and rng-injectable (_setRng) so
// tools/fishing-sim.test.mjs can drive every branch deterministically.
// Rendering (line, bobber, ❗, catch arc) draws in world space from main.js.
import { T } from '../constants.js';

(function(){
  const root = (typeof window!=='undefined') ? window : globalThis;
  root.MM = root.MM || {};
  const MM = root.MM;

  const FISH = [
    {id:'small',  label:'Płotka',      icon:'🐟', chance:0.55, hooks:1, give:{fish:1},       xp:8},
    {id:'medium', label:'Okoń',        icon:'🐟', chance:0.30, hooks:2, give:{fish:2},       xp:18},
    {id:'big',    label:'Sum',         icon:'🐋', chance:0.12, hooks:3, give:{fish:3},       xp:35},
    {id:'golden', label:'Złota rybka', icon:'✨', chance:0.03, hooks:3, give:{goldenFish:1}, xp:60, golden:true}
  ];
  const TUNING = {
    biteMin:2.2, biteSpan:4.5,   // seconds until the first bite
    hookWindow:0.85,             // reaction window per pull
    pullDelayMin:0.5, pullDelaySpan:0.9, // telegraphed pause between pulls
    castDist:5,                  // columns scanned in front of the hero
    depthUp:3, depthDown:7,      // rows scanned around the hero's feet
    moveCancel:1.8               // walking this far reels the line in
  };

  const S = {
    phase:'idle',                // idle|waiting|bite|pullWait|pullWindow
    x:0, y:0,                    // bobber (world tiles)
    anchorX:0, anchorY:0,        // hero position at cast time
    t:0, windowT:0, biteAt:0,
    fish:null, hooksDone:0,
    bobT:0,
    anim:null                    // {t, fromX, fromY, icon} catch arc
  };
  let rng = Math.random;
  let ctxHooks = null;           // {onInventoryChange, onChange}

  function say(t){ try{ if(root.msg) root.msg(t); }catch(e){} }
  function playSound(id,x,y){
    try{
      if(MM.audio && MM.audio.play) MM.audio.play(id,Number.isFinite(x)&&Number.isFinite(y)?{x,y}:undefined);
    }catch(e){}
  }
  function splash(x, power){ try{ if(MM.water && MM.water.disturb) MM.water.disturb(Math.floor(x), power); }catch(e){} }
  function invRef(){ return root.inv || null; }

  function rollFish(){
    let r = rng();
    for(const f of FISH){ if(r < f.chance) return f; r -= f.chance; }
    return FISH[0];
  }
  // Nearest fishable water surface: a WATER tile with open air above it,
  // scanned column by column in the facing direction, then behind.
  function findWater(player, getTile){
    const px = Math.floor(player.x), py = Math.floor(player.y);
    const facing = (player.facing < 0) ? -1 : 1;
    for(const dir of [facing, -facing]){
      for(let d = 1; d <= TUNING.castDist; d++){
        const wx = px + dir * d;
        for(let wy = py - TUNING.depthUp; wy <= py + TUNING.depthDown; wy++){
          if(getTile(wx, wy) === T.WATER && getTile(wx, wy - 1) === T.AIR) return {x:wx, y:wy};
        }
      }
    }
    return null;
  }

  function reset(){
    S.phase='idle'; S.fish=null; S.hooksDone=0; S.t=0; S.windowT=0; S.bobT=0;
  }
  function escape(reason){
    if(reason) say('🎣 '+reason);
    splash(S.x, 60);
    reset();
  }
  function land(player){
    const f = S.fish || FISH[0];
    const inv = invRef();
    if(inv){ Object.keys(f.give).forEach(k=>{ inv[k]=(inv[k]|0)+f.give[k]; }); }
    if(player && typeof player.xp === 'number') player.xp += f.xp;
    S.anim = {t:0, fromX:S.x, fromY:S.y, icon:f.icon, golden:!!f.golden};
    say('🎣 Złowiono: '+f.label+'! (+'+f.xp+' XP)');
    playSound(f.golden ? 'golden' : 'harvest',S.x,S.y);
    splash(S.x, 140);
    if(ctxHooks && ctxHooks.onInventoryChange){ try{ ctxHooks.onInventoryChange(); }catch(e){} }
    if(ctxHooks && ctxHooks.onChange){ try{ ctxHooks.onChange(); }catch(e){} }
    reset();
  }
  function beginPullPhase(){
    S.phase='pullWait';
    S.windowT = TUNING.pullDelayMin + rng() * TUNING.pullDelaySpan;
  }
  function hook(player){
    S.hooksDone++;
    const f = S.fish || FISH[0];
    if(S.hooksDone >= f.hooks){ land(player); return; }
    playSound('splash',S.x,S.y);
    splash(S.x, 110);
    beginPullPhase();
  }

  // F key: cast / set the hook / reel in. Returns true when the press did
  // something fishing-related (main.js consumed the key either way).
  function onKey(player, getTile){
    if(!player || typeof getTile !== 'function') return false;
    if(S.phase === 'idle'){
      const inv = invRef();
      if(!inv || (inv.fishingRod|0) <= 0){ return false; } // no rod: let F stay silent
      const spot = findWater(player, getTile);
      if(!spot){ say('🎣 Za daleko od wody — podejdź do brzegu.'); return true; }
      S.phase='waiting';
      S.x=spot.x+0.5; S.y=spot.y+0.3;
      S.anchorX=player.x; S.anchorY=player.y;
      S.t=0; S.bobT=0; S.hooksDone=0;
      S.fish=rollFish();
      S.biteAt = TUNING.biteMin + rng() * TUNING.biteSpan;
      splash(S.x, 70);
      playSound('splash',S.x,S.y);
      return true;
    }
    if(S.phase === 'waiting'){ say('🎣 Zwinięto żyłkę.'); reset(); return true; }
    if(S.phase === 'bite' || S.phase === 'pullWindow'){ hook(player); return true; }
    if(S.phase === 'pullWait'){ escape('Za wcześnie! Ryba się wyrwała.'); return true; }
    return false;
  }

  function update(dt, player, getTile){
    if(S.anim){ S.anim.t += dt; if(S.anim.t > 0.8) S.anim = null; }
    if(S.phase === 'idle' || !player || typeof getTile !== 'function') return;
    S.bobT += dt;
    if(Math.hypot(player.x - S.anchorX, player.y - S.anchorY) > TUNING.moveCancel){ escape(null); say('🎣 Żyłka zwinięta w biegu.'); return; }
    if(getTile(Math.floor(S.x), Math.floor(S.y)) !== T.WATER){ escape('Woda zniknęła spod spławika.'); return; }
    if(S.phase === 'waiting'){
      S.t += dt;
      if(S.t >= S.biteAt){
        S.phase='bite'; S.windowT=TUNING.hookWindow;
        playSound('splash',S.x,S.y); splash(S.x, 150);
      }
      return;
    }
    if(S.phase === 'bite' || S.phase === 'pullWindow'){
      S.windowT -= dt;
      if(S.windowT <= 0) escape('Ryba uciekła z haczyka.');
      return;
    }
    if(S.phase === 'pullWait'){
      S.windowT -= dt;
      if(S.windowT <= 0){
        S.phase='pullWindow'; S.windowT=TUNING.hookWindow;
        playSound('splash',S.x,S.y); splash(S.x, 130);
      }
    }
  }

  function draw(ctx2d, TILE, player, canDrawTile){
    if(!ctx2d) return;
    if(S.anim){
      const a = S.anim, p = Math.min(1, a.t / 0.7);
      const ax = a.fromX + (player.x - a.fromX) * p;
      const ay = a.fromY + (player.y - 0.8 - a.fromY) * p - Math.sin(p * Math.PI) * 2.2;
      ctx2d.save();
      ctx2d.font = Math.round(TILE * 0.8) + 'px system-ui';
      ctx2d.textAlign = 'center';
      ctx2d.globalAlpha = 1 - p * 0.3;
      ctx2d.fillText(a.icon, ax * TILE, ay * TILE);
      ctx2d.restore();
    }
    if(S.phase === 'idle') return;
    if(typeof canDrawTile === 'function' && !canDrawTile(Math.floor(S.x), Math.floor(S.y))) return;
    const excited = S.phase === 'bite' || S.phase === 'pullWindow';
    const dip = excited ? 0.22 : Math.sin(S.bobT * 2.4) * 0.06;
    const bx = S.x * TILE, by = (S.y + dip) * TILE;
    const hx = player.x * TILE, hy = (player.y - 0.45) * TILE;
    ctx2d.save();
    // line with a light sag
    ctx2d.strokeStyle = 'rgba(230,240,250,0.55)';
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    ctx2d.moveTo(hx, hy);
    ctx2d.quadraticCurveTo((hx + bx) / 2, Math.max(hy, by) + TILE * 0.6, bx, by - TILE * 0.18);
    ctx2d.stroke();
    // bobber: red cap, white belly
    ctx2d.fillStyle = '#e23b3b';
    ctx2d.beginPath(); ctx2d.arc(bx, by - TILE * 0.12, TILE * 0.16, Math.PI, 0); ctx2d.fill();
    ctx2d.fillStyle = '#f3efe4';
    ctx2d.beginPath(); ctx2d.arc(bx, by - TILE * 0.12, TILE * 0.16, 0, Math.PI); ctx2d.fill();
    // strike alert
    if(excited){
      const bounce = Math.abs(Math.sin(S.bobT * 9)) * TILE * 0.3;
      ctx2d.font = Math.round(TILE * 0.7) + 'px system-ui';
      ctx2d.textAlign = 'center';
      ctx2d.fillStyle = '#ffd76a';
      ctx2d.fillText('❗', bx, by - TILE * 0.8 - bounce);
    } else if(S.phase === 'pullWait' && S.fish && S.fish.hooks > 1){
      // fight progress pips so multi-pull fish read as a sequence
      ctx2d.fillStyle = 'rgba(255,255,255,0.85)';
      for(let i = 0; i < S.fish.hooks; i++){
        ctx2d.globalAlpha = i < S.hooksDone ? 0.95 : 0.3;
        ctx2d.beginPath();
        ctx2d.arc(bx + (i - (S.fish.hooks - 1) / 2) * TILE * 0.34, by - TILE * 0.9, TILE * 0.08, 0, Math.PI * 2);
        ctx2d.fill();
      }
    }
    ctx2d.restore();
  }

  const api = {
    onKey, update, draw,
    isActive: ()=>S.phase !== 'idle',
    phase: ()=>S.phase,
    bobber: ()=>({x:S.x, y:S.y}),
    setContext(h){ ctxHooks = h || null; },
    reset,
    // test seams
    _state: ()=>S,
    _setRng(fn){ rng = typeof fn === 'function' ? fn : Math.random; },
    _fishTable: ()=>FISH.map(f=>Object.assign({}, f)),
    _tuning: ()=>Object.assign({}, TUNING)
  };
  MM.fishing = api;
})();
// ESM export (progressive migration)
export const fishing = (typeof window!=='undefined' && window.MM) ? window.MM.fishing : undefined;
export default fishing;
