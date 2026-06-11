// Procedural audio: every effect is synthesized with WebAudio (zero asset files,
// CSP-safe). The context starts suspended until the first user gesture (autoplay
// policy). One-shots via MM.audio.play(name); a looping filtered-noise bed for
// rain whose gain follows the weather (MM.audio.setRain). Volume/mute persist.
window.MM = window.MM || {};
(function(){
  const VOL_KEY='mm_audio_v1';
  let ctx=null, master=null, rainGain=null, rainTarget=0;
  let settings={vol:0.5, mute:false};
  try{ const raw=localStorage.getItem(VOL_KEY); if(raw){ const d=JSON.parse(raw); if(d&&typeof d==='object'){ if(typeof d.vol==='number') settings.vol=Math.min(1,Math.max(0,d.vol)); settings.mute=!!d.mute; } } }catch(e){}
  function saveSettings(){ try{ localStorage.setItem(VOL_KEY, JSON.stringify(settings)); }catch(e){} }

  let noiseBuf=null;
  function ensureCtx(){
    if(ctx || typeof window==='undefined') return ctx;
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC) return null;
    ctx=new AC();
    master=ctx.createGain(); master.gain.value=settings.mute?0:settings.vol; master.connect(ctx.destination);
    // shared 1s noise buffer
    noiseBuf=ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d=noiseBuf.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1;
    // rain bed: looped noise through a lowpass, silent until weather says otherwise
    const src=ctx.createBufferSource(); src.buffer=noiseBuf; src.loop=true;
    const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=900; lp.Q.value=0.4;
    rainGain=ctx.createGain(); rainGain.gain.value=0;
    src.connect(lp); lp.connect(rainGain); rainGain.connect(master); src.start();
    return ctx;
  }
  // unlock on the first gesture
  if(typeof window!=='undefined' && window.addEventListener){
    const unlock=()=>{ const c=ensureCtx(); if(c && c.state==='suspended') c.resume(); };
    window.addEventListener('pointerdown',unlock,{once:false});
    window.addEventListener('keydown',unlock,{once:false});
  }

  function env(g,t0,a,peak,dec){ g.gain.setValueAtTime(0.0001,t0); g.gain.linearRampToValueAtTime(peak,t0+a); g.gain.exponentialRampToValueAtTime(0.0001,t0+a+dec); }
  function tone(type,f0,f1,dur,peak,bendT){
    const c=ensureCtx(); if(!c||c.state!=='running') return;
    const o=c.createOscillator(), g=c.createGain(); const t=c.currentTime;
    o.type=type; o.frequency.setValueAtTime(f0,t);
    if(f1!==f0) o.frequency.exponentialRampToValueAtTime(Math.max(20,f1), t+(bendT||dur));
    env(g,t,0.005,peak,dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t+dur+0.1);
  }
  function noise(dur,peak,fLo,fHi,type){
    const c=ensureCtx(); if(!c||c.state!=='running') return;
    const s=c.createBufferSource(); s.buffer=noiseBuf;
    const f=c.createBiquadFilter(); f.type=type||'bandpass';
    f.frequency.value=(fLo+fHi)/2; f.Q.value=Math.max(0.3,(fLo+fHi)/(2*Math.max(60,fHi-fLo)));
    const g=c.createGain(); const t=c.currentTime;
    env(g,t,0.004,peak,dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t+dur+0.1);
  }

  // throttle very chatty effects so streams/digging don't machine-gun the mixer
  const lastAt={};
  function throttled(name,ms){ const now=Date.now(); if(lastAt[name] && now-lastAt[name]<ms) return true; lastAt[name]=now; return false; }

  const FX={
    dig:    ()=>{ if(throttled('dig',70)) return; noise(0.06,0.18,500,1800); },
    break:  ()=>{ noise(0.14,0.3,250,1200); tone('triangle',180,90,0.12,0.12); },
    place:  ()=>{ noise(0.05,0.2,900,2600); },
    hurt:   ()=>{ tone('sawtooth',280,110,0.22,0.25); },
    heal:   ()=>{ tone('sine',440,720,0.18,0.16); tone('sine',660,990,0.22,0.10); },
    bow:    ()=>{ tone('square',220,640,0.10,0.12,0.05); noise(0.07,0.10,1200,3200); },
    swing:  ()=>{ if(throttled('swing',150)) return; noise(0.10,0.14,700,2400,'bandpass'); },
    flame:  ()=>{ if(throttled('flame',160)) return; noise(0.16,0.07,300,1400,'lowpass'); },
    hose:   ()=>{ if(throttled('hose',160)) return; noise(0.16,0.06,1000,4200); },
    gas:    ()=>{ if(throttled('gas',200)) return; noise(0.2,0.045,600,1600,'lowpass'); },
    chest:  ()=>{ tone('triangle',520,780,0.12,0.14); tone('triangle',780,1170,0.18,0.12); },
    craft:  ()=>{ noise(0.06,0.14,1500,4200); tone('square',330,330,0.08,0.08); },
    harvest:()=>{ tone('sine',520,650,0.10,0.12); },
    levelup:()=>{ [392,494,587,784].forEach((f,i)=>setTimeout(()=>tone('triangle',f,f,0.18,0.16),i*90)); },
    milestone:()=>{ [523,659,784].forEach((f,i)=>setTimeout(()=>tone('sine',f,f,0.22,0.14),i*110)); },
    golden: ()=>{ [880,1175,1568,2093,2637].forEach((f,i)=>setTimeout(()=>tone('sine',f,f*1.02,0.45,0.07),i*65)); noise(0.5,0.025,3800,9000,'highpass'); },
    ufo:    ()=>{ tone('sine',520,820,0.9,0.09,0.45); setTimeout(()=>tone('sine',820,470,0.9,0.08,0.5),450); }, // theremin wobble
    beam:   ()=>{ if(throttled('beam',450)) return; tone('sawtooth',95,110,0.5,0.05,0.4); noise(0.45,0.03,1800,4200); },
    roar:   ()=>{ tone('sawtooth',90,45,0.8,0.22,0.6); noise(0.7,0.12,80,400,'lowpass'); },
    explosion:()=>{ noise(0.5,0.5,60,900,'lowpass'); tone('sine',120,32,0.6,0.4,0.45); },
    splash: ()=>{ if(throttled('splash',250)) return; noise(0.18,0.16,400,2400); },
    grave:  ()=>{ tone('sine',196,98,0.5,0.2,0.4); },
  };
  function play(name){ const f=FX[name]; if(!f) return; try{ f(); }catch(e){} }

  // rain bed follows the weather; called from the game loop
  let rainAcc=0;
  function update(dt){
    rainAcc+=dt; if(rainAcc<0.25) return; rainAcc=0;
    if(!ctx||!rainGain) return;
    try{
      const cm=(MM.clouds&&MM.clouds.metrics)? MM.clouds.metrics():null;
      rainTarget=(cm && cm.drops>0)? Math.min(0.16, 0.02+cm.drops*0.0006) : 0;
      const g=rainGain.gain; g.setTargetAtTime(rainTarget, ctx.currentTime, 0.4);
    }catch(e){}
  }
  function setVolume(v){ settings.vol=Math.min(1,Math.max(0,v)); if(master&&!settings.mute) master.gain.value=settings.vol; saveSettings(); }
  function setMute(m){ settings.mute=!!m; if(master) master.gain.value=settings.mute?0:settings.vol; saveSettings(); }

  MM.audio={ play, update, setVolume, setMute,
    getVolume:()=>settings.vol, isMuted:()=>settings.mute };
})();
// ESM export (progressive migration)
export const audio = (typeof window!=='undefined' && window.MM) ? window.MM.audio : undefined;
export default audio;
