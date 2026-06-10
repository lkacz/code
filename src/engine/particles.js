// Chest burst particles + simple sfx
// API: MM.particles.spawnBurst(x,y,tier), MM.particles.update(dt, TILE), MM.particles.draw(ctx)
(function(){
  window.MM = window.MM || {};
  const mod = {};

  const PARTICLE_CAP = 800;
  const particles = [];
  let audioCtx = null;

  function playChestSound(tier){
    try{
      if(!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'triangle';
      let base = tier==='epic'?660 : tier==='rare'?520 : 420;
      o.frequency.setValueAtTime(base,audioCtx.currentTime);
      o.frequency.linearRampToValueAtTime(base + (tier==='epic'?240 : tier==='rare'?160 : 80), audioCtx.currentTime+0.25);
      g.gain.setValueAtTime(0.001, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.3, audioCtx.currentTime+0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime+0.5);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime+0.52);
    }catch(e){ /* ignore */ }
  }

  mod.spawnBurst = function(x,y,tier){
    const count = 24 + (tier==='epic'?24 : tier==='rare'?12 : 0);
    for(let i=0;i<count;i++){
      if(particles.length>=PARTICLE_CAP) break;
      const ang = Math.random()*Math.PI*2;
      const sp = (Math.random()*2 + 1.5) * (tier==='epic'?1.6 : tier==='rare'?1.3 : 1);
      particles.push({ x, y, vx:Math.cos(ang)*sp, vy:Math.sin(ang)*sp*0.6-1, life:0, max:0.9+Math.random()*0.5, tier });
    }
    playChestSound(tier);
  };

  // Water splash: droplets fan upward from the surface, fall back under gravity.
  // x,y in world pixels; intensity 0..1 scales count and speed.
  mod.spawnSplash = function(x,y,intensity){
    const k = Math.max(0.15, Math.min(1, intensity||0.5));
    const count = Math.round(6 + 18*k);
    for(let i=0;i<count;i++){
      if(particles.length>=PARTICLE_CAP) break;
      const ang = -Math.PI/2 + (Math.random()-0.5)*1.4; // mostly upward fan
      const sp = (1.2 + Math.random()*2.4) * (0.5 + k);
      particles.push({ kind:'splash', x:x+(Math.random()-0.5)*10, y, vx:Math.cos(ang)*sp, vy:Math.sin(ang)*sp, life:0, max:0.35+Math.random()*0.45 });
    }
  };

  // Air bubble: rises with a sine wobble, pops at the end of its life.
  mod.spawnBubble = function(x,y){
    if(particles.length>=PARTICLE_CAP) return;
    particles.push({ kind:'bubble', x, y, vx:0, vy:-(0.6+Math.random()*0.9), life:0, max:0.8+Math.random()*1.2, phase:Math.random()*Math.PI*2, r:1.5+Math.random()*2 });
  };

  mod.update = function(dt, TILE){
    for(let i=particles.length-1;i>=0;i--){
      const p=particles[i];
      p.life += dt;
      if(p.kind==='bubble'){
        p.x += Math.sin(p.life*7 + p.phase)*dt*TILE*0.18; // wobble
        p.y += p.vy*dt*TILE;
        p.vy -= 0.8*dt; if(p.vy<-2.4) p.vy=-2.4; // gentle buoyant acceleration
      } else {
        p.x += p.vx*dt*TILE;
        p.y += p.vy*dt*TILE;
        p.vy += 8*dt;
      }
      if(p.life>p.max) particles.splice(i,1);
    }
    if(particles.length>PARTICLE_CAP){
      particles.splice(0, particles.length-PARTICLE_CAP);
    }
  };

  mod.draw = function(ctx){
    particles.forEach(p=>{
      const alpha = 1 - p.life/p.max;
      if(p.kind==='splash'){
        ctx.fillStyle = 'rgba(120,190,255,'+(alpha*0.9)+')';
        ctx.fillRect(p.x-1.5, p.y-1.5, 3, 3);
      } else if(p.kind==='bubble'){
        ctx.strokeStyle = 'rgba(210,235,255,'+(alpha*0.8)+')';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.stroke();
      } else {
        ctx.fillStyle = p.tier==='epic'? 'rgba(224,179,65,'+alpha+')' : (p.tier==='rare'? 'rgba(167,76,201,'+alpha+')' : 'rgba(176,127,44,'+alpha+')');
        ctx.fillRect(p.x -2, p.y -2, 4, 4);
      }
    });
  };

  // Clear particles (world regen / fresh start)
  mod.reset = function(){ particles.length = 0; };
  // Live particle count (debug / tests)
  mod.count = function(){ return particles.length; };

  MM.particles = mod;
})();
// ESM export (progressive migration)
export const particles = (typeof window!=='undefined' && window.MM) ? window.MM.particles : undefined;
export default particles;
