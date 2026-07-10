// Ruin traps — the live half of the buried-ruin system. Trap DEFINITIONS are
// pure data inside ruin layouts (engine/ruins.js), so they are deterministic
// and regeneration-safe; this module owns everything that moves: arming
// instances near the hero, watching triggers, firing effects and painting the
// subtle telltales a careful player can spot before it is too late.
//
// The catalog (each with its tell):
//   dart     — a hair-thin glinting tripwire across a passage; crossing it
//              looses a volley of bolts from the nearest wall
//   gas      — green wisps curl up from a guarded chest; disturbing it vents
//              a grave-gas cloud (poisons nearby creatures too)
//   boom     — a faintly pulsing rune ring on a floor slab; stepping on it
//              (or mining it!) sets off a rune blast (weapons.explodeAt)
//   keystone — warm glow seeping between blocks (or dripping water): a sealed
//              lava/water pocket waits behind; mining a rigged block unseals
//              the whole pocket and the fluid sim does the rest — lava can
//              flood the very treasure room it guarded
//   collapse — hairline cracks across a corridor floor; it crumbles underfoot
//              into a hidden pit holding either a lava bath or a bonus chest
//
// Triggers are double-wired: every trap also springs when any of its watched
// tiles is disturbed (mined, or a chest opened), so "careful" means looking,
// not just walking slowly. Fired traps stay dead for the session.
import { T } from '../constants.js';
import { isSolidCollisionTile as isSolid } from './material_physics.js';

const traps = (function(){
  const MM = (typeof window!=='undefined')? (window.MM = window.MM || {}) : {};
  const inst = new Map();   // id -> {id, d, watch:[{x,y,t0}]}
  const fired = new Set();  // session memory of sprung traps
  const volleys=[], darts=[], clouds=[];
  let scanAcc=1;

  function say(t){ try{ if(typeof window!=='undefined' && window.msg) window.msg(t); }catch(e){} }
  function sfx(n,o){ try{ if(MM.audio && MM.audio.play) MM.audio.play(n,o); }catch(e){} }
  function heroHit(amount,opts){
    if(typeof window!=='undefined' && typeof window.damageHero==='function'){ window.damageHero(amount,opts); return; }
    const p=(typeof window!=='undefined' && window.player)||null;
    if(p){ p.hp-=amount; if(p.hp<0) p.hp=0; }
  }
  function burst(x,y,tier){ try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst((x+0.5)*(MM.TILE||20),(y+0.5)*(MM.TILE||20),tier||'common'); }catch(e){} }
  const idFor=(L,i)=>((MM.worldGen && MM.worldGen.worldSeed)||0)+':'+L.n+':'+i;

  function ensureInstances(player,getTile){
    const R=MM.ruins; if(!R || !R.anchorsInRange || !R.layoutFor) return;
    let anchors=[]; try{ anchors=R.anchorsInRange(player.x-240, player.x+240); }catch(e){}
    for(const a of anchors){
      const L=R.layoutFor(a.n); if(!L || !L.traps || !L.traps.length) continue;
      L.traps.forEach((d,i)=>{
        const id=idFor(L,i);
        if(fired.has(id) || inst.has(id)) return;
        const cells=d.cells || [[d.x,d.y]];
        const watch=cells.map(([x,y])=>({x,y,t0:getTile(x,y)}));
        // already disturbed before arming (old digs)? the trap is spent
        if((d.kind==='keystone'||d.kind==='gas'||d.kind==='boom'||d.kind==='collapse') && watch.some(w=>w.t0===T.AIR)){ fired.add(id); return; }
        inst.set(id,{id,d,watch});
      });
    }
    for(const [id,it] of inst){ if(Math.abs(it.d.x-player.x)>320) inst.delete(id); }
  }

  function trigger(it,getTile,setTile){
    fired.add(it.id); inst.delete(it.id);
    const d=it.d, cx=d.x+0.5, cy=d.y+0.5;
    if(d.kind==='dart'){
      // bolts fly along d.dir, loosed from the nearest wall behind the wire
      let sx=d.x-d.dir*6;
      for(let i=1;i<=8;i++){ if(isSolid(getTile(d.x-d.dir*i, d.y))){ sx=d.x-d.dir*i+d.dir; break; } }
      volleys.push({x:sx+0.5, y:cy, dir:d.dir, n:5+((Math.random()*3)|0), t:0});
      say('🏹 Trach — linka! Strzałki ze ściany!'); sfx('bow',{x:sx+0.5,y:cy});
    } else if(d.kind==='gas'){
      clouds.push({x:cx, y:cy, t:6, r:d.r||2.6, acc:0});
      try{ if(MM.gases && MM.gases.add) MM.gases.add('poison',cx,cy,{power:1.3,cells:6,getTile,setTile}); }catch(e){}
      try{ if(MM.mobs && MM.mobs.poisonRadius) MM.mobs.poisonRadius(cx,cy,d.r||2.6,{dur:3,dps:2}); }catch(e){}
      say('☠️ Grobowy gaz! Wstrzymaj oddech i uciekaj!'); sfx('gas',{x:cx,y:cy});
    } else if(d.kind==='boom'){
      if(MM.weapons && MM.weapons.explodeAt && setTile) MM.weapons.explodeAt(cx, cy-1, getTile, setTile);
      else { heroHit(14,{srcX:cx,srcY:cy,cause:'trap'}); burst(d.x,d.y-1,'epic'); sfx('explosion',{x:cx,y:cy-1}); }
      say('💥 Runiczna mina! Kto to tu zostawił?!');
    } else if(d.kind==='keystone'){
      for(const w of it.watch){
        if(getTile(w.x,w.y)!==T.AIR && setTile) setTile(w.x,w.y,T.AIR);
        try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(w.x,w.y,getTile); }catch(e){}
      }
      say(d.fluid==='water'? '🌊 Zwornik puścił — woda!' : '🌋 Zwornik puścił — LAWA! Ratuj skarb!');
      sfx(d.fluid==='water'? 'splash' : 'flame',{x:cx,y:cy});
    } else if(d.kind==='collapse'){
      const half=(d.w||3)>>1;
      for(let x=d.x-half;x<=d.x+half;x++){ if(setTile) setTile(x,d.y,T.AIR); burst(x,d.y,'common'); }
      say(d.surprise==='chest'? '🕳️ Podłoga runęła… o, skrzynia na dnie!' : '🕳️ Podłoga runęła!');
      sfx('break',{x:cx,y:cy});
    }
  }

  function update(dt, player, getTile, setTile){
    if(!(dt>0) || !isFinite(dt) || !player || typeof getTile!=='function') return;
    scanAcc+=dt; if(scanAcc>=1){ scanAcc=0; ensureInstances(player,getTile); }
    const feet=player.y+((player.h||1)/2);
    for(const it of [...inst.values()]){
      const d=it.d; let go=false;
      for(const w of it.watch){ if(getTile(w.x,w.y)!==w.t0){ go=true; break; } } // disturbed
      if(!go){
        if(d.kind==='dart') go = Math.abs(player.x-(d.x+0.5))<0.65 && Math.abs(player.y-(d.y+0.5))<1.3;
        else if(d.kind==='gas') go = Math.hypot(player.x-(d.x+0.5), player.y-(d.y+0.5))<1.5;
        else if(d.kind==='boom' || d.kind==='collapse') go = Math.abs(player.x-(d.x+0.5))<0.8 && Math.abs(feet-d.y)<0.4 && player.vy>=-0.01;
      }
      if(go) trigger(it,getTile,setTile);
    }
    for(let i=volleys.length-1;i>=0;i--){
      const v=volleys[i]; v.t-=dt;
      if(v.t<=0){ v.t=0.16; darts.push({x:v.x, y:v.y, vx:v.dir*15, life:1.1}); v.n--; }
      if(v.n<=0) volleys.splice(i,1);
    }
    for(let i=darts.length-1;i>=0;i--){
      const a=darts[i]; a.life-=dt; a.x+=a.vx*dt;
      let dead=a.life<=0;
      if(!dead && Math.abs(player.x-a.x)<0.55 && Math.abs(player.y-a.y)<0.8){ heroHit(6,{srcX:a.x,srcY:a.y,cause:'trap',invulMs:220}); dead=true; }
      if(!dead && isSolid(getTile(Math.floor(a.x),Math.floor(a.y)))) dead=true;
      if(dead) darts.splice(i,1);
    }
    for(let i=clouds.length-1;i>=0;i--){
      const c=clouds[i]; c.t-=dt; c.acc+=dt;
      if(c.acc>=0.6){ c.acc=0; if(Math.hypot(player.x-c.x, player.y-c.y)<c.r) heroHit(3,{cause:'gas',invulMs:200}); }
      if(c.t<=0) clouds.splice(i,1);
    }
  }

  // Telltales for armed traps + live effects (world-space, same transform as mobs)
  function draw(ctx,TILE,canDrawTile){
    if(typeof document==='undefined') return;
    const now=performance.now();
    ctx.save();
    for(const it of inst.values()){
      const d=it.d; const px=(d.x+0.5)*TILE, py=(d.y+0.5)*TILE;
      if(typeof canDrawTile==='function' && !canDrawTile(d.x,d.y)) continue;
      if(d.kind==='dart'){
        ctx.strokeStyle='rgba(220,225,235,'+(0.16+0.1*Math.sin(now*0.003+d.x)).toFixed(2)+')';
        ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(d.x*TILE, py+3); ctx.lineTo((d.x+1)*TILE, py-3); ctx.stroke();
        const g=(now*0.0015+d.y*0.37)%1;
        ctx.fillStyle='rgba(255,255,255,0.7)'; ctx.fillRect(d.x*TILE+g*TILE-1, py+3-g*6-1, 2, 2);
      } else if(d.kind==='boom'){
        const a=0.22+0.16*Math.sin(now*0.004+d.x);
        ctx.strokeStyle='rgba(255,90,60,'+a.toFixed(2)+')'; ctx.lineWidth=1.2;
        ctx.beginPath(); ctx.arc(px, d.y*TILE+4, TILE*0.26, 0, Math.PI*2); ctx.stroke();
        ctx.fillStyle='rgba(255,90,60,'+(a*0.9).toFixed(2)+')'; ctx.fillRect(px-1, d.y*TILE+3, 2, 2);
      } else if(d.kind==='gas'){
        const k=(now*0.02+d.x*53)%(TILE*0.9);
        ctx.fillStyle='rgba(120,220,90,0.32)';
        ctx.fillRect(px-2+Math.sin(now*0.005+d.x)*3, d.y*TILE-k, 3, 3);
      } else if(d.kind==='keystone'){
        for(const w of it.watch){
          if(typeof canDrawTile==='function' && !canDrawTile(w.x,w.y)) continue;
          const wx=w.x*TILE, wy=w.y*TILE;
          if(d.fluid==='water'){ const k=(now*0.025+w.x*37)%(TILE*1.4); ctx.fillStyle='rgba(90,170,255,0.5)'; ctx.fillRect(wx+TILE/2-1, wy+TILE+k*0.4, 2, 4); }
          else { ctx.fillStyle='rgba(255,120,30,'+(0.18+0.12*Math.sin(now*0.006+w.x)).toFixed(2)+')'; ctx.fillRect(wx, wy+1, TILE, 2); }
        }
      } else if(d.kind==='collapse'){
        const half=(d.w||3)>>1;
        ctx.strokeStyle='rgba(8,8,12,0.55)'; ctx.lineWidth=1;
        for(let x=d.x-half;x<=d.x+half;x++){
          const bx=x*TILE, by=d.y*TILE;
          ctx.beginPath(); ctx.moveTo(bx+3, by+2); ctx.lineTo(bx+TILE*0.5, by+TILE*0.4); ctx.lineTo(bx+TILE-4, by+3); ctx.stroke();
        }
      }
    }
    for(const a of darts){
      if(typeof canDrawTile==='function' && !canDrawTile(Math.floor(a.x),Math.floor(a.y))) continue;
      ctx.fillStyle='#caa45a'; ctx.fillRect(a.x*TILE-4, a.y*TILE-1.5, 8, 3);
      ctx.fillStyle='#3a3f48'; ctx.fillRect(a.x*TILE+(a.vx>0?2:-4), a.y*TILE-1.5, 2, 3);
    }
    for(const c of clouds){
      if(typeof canDrawTile==='function' && !canDrawTile(Math.floor(c.x),Math.floor(c.y))) continue;
      for(let i=0;i<6;i++){
        const ph=now*0.001+i*1.9;
        ctx.fillStyle='rgba(110,210,80,'+(0.10+0.10*Math.min(1,c.t/2)).toFixed(2)+')';
        const rr=Math.abs(c.r*TILE*(0.35+0.3*Math.sin(ph+i)))*0.5+4;
        ctx.beginPath();
        ctx.arc(c.x*TILE+Math.cos(ph)*c.r*TILE*0.4, c.y*TILE+Math.sin(ph*1.3)*c.r*TILE*0.3-(6-c.t)*3, rr, 0, Math.PI*2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  const api={ update, draw,
    reset(){ inst.clear(); fired.clear(); volleys.length=0; darts.length=0; clouds.length=0; scanAcc=1; },
    _debug:()=>({armed:inst.size, fired:fired.size, darts:darts.length, volleys:volleys.length, clouds:clouds.length}) };
  MM.traps=api;
  return api;
})();

export { traps };
export default traps;
