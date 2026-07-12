// Procedural audio engine: every sound is synthesized with WebAudio (zero asset
// files, CSP-safe). The context starts suspended until the first user gesture
// (autoplay policy). Architecture:
//
//   voice → bus gain (sfx/ambience/music/ui) → [duck] → mix → underwater LP
//         ↘ reverb send → convolver (generated IR) ↗        → master → limiter → out
//
// One-shots via MM.audio.play(name, opts) — opts may carry world tile coords
// {x,y} for stereo panning + distance rolloff against the hero (playAt sugar).
// Every voice gets random detune/gain jitter so repeats never sound identical.
// A scene tick (4 Hz) reads live game state (day/night cycle, weather, depth,
// submersion) and drives ambience beds (wind/rain/cave/underwater), scheduled
// wildlife (birds/crickets/drips/bubbles) and a generative music director
// (day/night/cave/danger modes). Heavy events duck ambience+music briefly.
// Master + per-bus volumes persist in localStorage (mm_audio_v1, extended).
window.MM = window.MM || {};
(function(){
  const VOL_KEY='mm_audio_v1';
  let ctx=null, master=null, limiter=null, mixBus=null, wetFilter=null, duckGain=null;
  let reverb=null, reverbReturn=null;
  const buses={sfx:null, ambience:null, music:null, ui:null};
  let settings={vol:0.5, mute:false, sfx:1, ambience:0.8, music:0.55, ui:0.9};
  try{ const raw=localStorage.getItem(VOL_KEY); if(raw){ const d=JSON.parse(raw); if(d&&typeof d==='object'){
    if(typeof d.vol==='number') settings.vol=Math.min(1,Math.max(0,d.vol));
    settings.mute=!!d.mute;
    // per-bus fields are new — older blobs simply lack them and keep defaults
    for(const k of ['sfx','ambience','music','ui']) if(typeof d[k]==='number') settings[k]=Math.min(1,Math.max(0,d[k]));
  } } }catch(e){}
  function saveSettings(){ try{ localStorage.setItem(VOL_KEY, JSON.stringify(settings)); }catch(e){} }
  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function rand(a,b){ return a+Math.random()*(b-a); }

  let noiseBuf=null, brownBuf=null;
  let ctxFailed=false; // creation failed (no device/headless): retry only on a user gesture
  function makeNoiseBuffers(){
    // 2 s white so loops don't audibly cycle; brown (integrated white) for rumbles
    const len=ctx.sampleRate*2;
    noiseBuf=ctx.createBuffer(1,len,ctx.sampleRate);
    const w=noiseBuf.getChannelData(0); for(let i=0;i<len;i++) w[i]=Math.random()*2-1;
    brownBuf=ctx.createBuffer(1,len,ctx.sampleRate);
    const b=brownBuf.getChannelData(0); let last=0;
    for(let i=0;i<len;i++){ last=(last+0.02*(Math.random()*2-1))/1.02; b[i]=last*3.2; }
  }
  function makeReverbIR(){
    // small procedural hall: stereo noise with exponential decay
    const dur=1.6, len=Math.max(1,Math.floor(ctx.sampleRate*dur));
    const ir=ctx.createBuffer(2,len,ctx.sampleRate);
    for(let ch=0;ch<2;ch++){ const d=ir.getChannelData(ch);
      for(let i=0;i<len;i++){ const f=i/len; d[i]=(Math.random()*2-1)*Math.pow(1-f,2.4)*0.5; } }
    return ir;
  }
  function ensureCtx(){
    if(ctx || ctxFailed || typeof window==='undefined') return ctx;
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC){ ctxFailed=true; return null; }
    try{
      ctx=new AC();
      // master chain: mix → underwater lowpass → master gain → limiter → out
      master=ctx.createGain(); master.gain.value=settings.mute?0:settings.vol;
      limiter=ctx.createDynamicsCompressor ? ctx.createDynamicsCompressor() : null;
      if(limiter){
        limiter.threshold.value=-16; limiter.knee.value=22; limiter.ratio.value=8;
        limiter.attack.value=0.003; limiter.release.value=0.24;
        master.connect(limiter); limiter.connect(ctx.destination);
      }else master.connect(ctx.destination);
      wetFilter=ctx.createBiquadFilter(); wetFilter.type='lowpass'; wetFilter.frequency.value=18500; wetFilter.Q.value=0.4;
      wetFilter.connect(master);
      mixBus=ctx.createGain(); mixBus.gain.value=1; mixBus.connect(wetFilter);
      // buses: sfx/ui direct; ambience/music pass a shared duck stage
      duckGain=ctx.createGain(); duckGain.gain.value=1; duckGain.connect(mixBus);
      for(const name of ['sfx','ambience','music','ui']){
        const g=ctx.createGain(); g.gain.value=settings[name];
        g.connect(name==='ambience'||name==='music' ? duckGain : mixBus);
        buses[name]=g;
      }
      // procedural reverb: per-voice sends feed one convolver
      if(ctx.createConvolver){
        reverb=ctx.createConvolver(); reverb.buffer=makeReverbIR();
        reverbReturn=ctx.createGain(); reverbReturn.gain.value=0.07;
        reverb.connect(reverbReturn); reverbReturn.connect(mixBus);
      }
      makeNoiseBuffers();
      buildAmbienceBeds();
    }catch(e){
      // Without the latch every SFX call re-attempted construction (and threw)
      // each frame on machines with no audio backend.
      ctx=null; master=null; limiter=null; mixBus=null; wetFilter=null; duckGain=null;
      reverb=null; reverbReturn=null; noiseBuf=null; brownBuf=null;
      for(const k in buses) buses[k]=null;
      ctxFailed=true;
    }
    return ctx;
  }
  // unlock on the first gesture (a real gesture may succeed where autoplay failed)
  if(typeof window!=='undefined' && window.addEventListener){
    const unlock=()=>{ ctxFailed=false; const c=ensureCtx(); if(c && c.state==='suspended') c.resume(); };
    window.addEventListener('pointerdown',unlock,{once:false});
    window.addEventListener('keydown',unlock,{once:false});
  }

  // ---------------- voice plumbing ----------------
  const MAX_VOICES=28;
  let voices=0; const voiceEnds=[]; // fallback GC when onended never fires
  function voiceGate(priority){
    const now=Date.now();
    while(voiceEnds.length && voiceEnds[0]<=now){ voiceEnds.shift(); if(voices>0) voices--; }
    if(voices>=MAX_VOICES && !priority) return false;
    return true;
  }
  function voiceStarted(durMs){ voices++; voiceEnds.push(Date.now()+durMs+400); voiceEnds.sort((a,b)=>a-b); }

  // hero-relative stereo pan + distance rolloff; null = fully culled
  const CULL_DIST=52;
  function spatial(o){
    if(!o || !Number.isFinite(o.x)) return {g:1, pan:(o&&Number.isFinite(o.pan))?clamp(o.pan,-1,1):0};
    let p=null; try{ p=window.player; }catch(e){}
    if(!p || !Number.isFinite(p.x)) return {g:1, pan:0}; // no listener → non-spatial
    const py=Number.isFinite(p.y)?p.y:0;
    const hx=o.x-p.x, hy=(Number.isFinite(o.y)?o.y:py)-py;
    const d=Math.hypot(hx,hy);
    if(d>CULL_DIST) return null;
    return {g:1/(1+d*0.09), pan:clamp(hx/20,-0.85,0.85)};
  }
  // connect a voice's output gain to its bus (+ optional pan / reverb send)
  function route(g,o){
    const bus=buses[(o&&o.bus)||'sfx']||buses.sfx;
    let head=g;
    if(o && typeof o.pan==='number' && o.pan!==0 && ctx.createStereoPanner){
      const p=ctx.createStereoPanner(); p.pan.value=clamp(o.pan,-1,1); g.connect(p); head=p;
    }
    head.connect(bus);
    const send=(o&&typeof o.send==='number')?o.send:0.12;
    if(reverb && send>0){ const s=ctx.createGain(); s.gain.value=send; head.connect(s); s.connect(reverb); }
  }
  function env(g,t0,a,peak,dec){
    g.gain.setValueAtTime(0.0001,t0);
    g.gain.linearRampToValueAtTime(Math.max(0.001,peak),t0+a);
    g.gain.exponentialRampToValueAtTime(0.0001,t0+a+dec);
  }
  // o: {type,f0,f1,dur,peak,attack,bend,delay,detune,bus,send,x,y,pan,priority}
  function tone(o){
    const c=ensureCtx(); if(!c||c.state!=='running') return;
    const sp=spatial(o); if(!sp) return;
    if(!voiceGate(o.priority)) return;
    const t=c.currentTime+(o.delay||0);
    const osc=c.createOscillator(), g=c.createGain();
    osc.type=o.type||'sine';
    osc.frequency.setValueAtTime(Math.max(20,o.f0),t);
    if(o.f1 && o.f1!==o.f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20,o.f1), t+(o.bend||o.dur));
    // humanize: repeats never land on the exact same pitch/level
    if(osc.detune) osc.detune.value=(o.detune!=null?o.detune:rand(-14,14));
    const peak=(o.peak||0.1)*sp.g*rand(0.88,1.06);
    env(g,t,o.attack||0.005,peak,o.dur);
    osc.connect(g); route(g,{...o,pan:sp.pan});
    osc.start(t); osc.stop(t+o.dur+0.15);
    voiceStarted((o.delay||0)*1000+o.dur*1000);
  }
  // o: {dur,peak,fLo,fHi,ftype,f1,Q,rate,buf,attack,delay,bus,send,x,y,pan,priority}
  function noise(o){
    const c=ensureCtx(); if(!c||c.state!=='running') return;
    const sp=spatial(o); if(!sp) return;
    if(!voiceGate(o.priority)) return;
    const t=c.currentTime+(o.delay||0);
    const s=c.createBufferSource(); s.buffer=(o.buf==='brown')?brownBuf:noiseBuf; s.loop=true;
    if(s.playbackRate) s.playbackRate.value=(o.rate||1)*rand(0.94,1.06);
    const f=c.createBiquadFilter(); f.type=o.ftype||'bandpass';
    const fc=((o.fLo||400)+(o.fHi||1600))/2;
    f.frequency.setValueAtTime(fc*rand(0.94,1.06),t);
    if(o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(40,o.f1), t+o.dur);
    f.Q.value=o.Q!=null?o.Q:Math.max(0.3,fc/Math.max(60,(o.fHi||1600)-(o.fLo||400)));
    const g=c.createGain(); const peak=(o.peak||0.1)*sp.g*rand(0.88,1.06);
    env(g,t,o.attack||0.004,peak,o.dur);
    s.connect(f); f.connect(g); route(g,{...o,pan:sp.pan});
    s.start(t); s.stop(t+o.dur+0.15);
    voiceStarted((o.delay||0)*1000+o.dur*1000);
  }

  // throttle very chatty effects so streams/digging don't machine-gun the mixer
  const lastAt={};
  function throttleKey(name,o){
    let side='';
    if(o && Number.isFinite(o.x)){
      let listenerX=0; try{ if(window.player && Number.isFinite(window.player.x)) listenerX=window.player.x; }catch(e){}
      const dx=o.x-listenerX;
      side=dx<-2?':left':(dx>2?':right':':center');
    }else if(o && Number.isFinite(o.pan)) side=o.pan<-0.1?':left':(o.pan>0.1?':right':':center');
    return name+side;
  }
  function throttled(name,ms,o){ const key=throttleKey(name,o), now=Date.now(); if(lastAt[key] && now-lastAt[key]<ms) return true; lastAt[key]=now; return false; }

  // heavy events dip ambience+music for a moment so the impact owns the mix
  function duck(amount,recover){
    if(!ctx||!duckGain) return;
    const t=ctx.currentTime;
    try{
      duckGain.gain.cancelScheduledValues(t);
      duckGain.gain.setValueAtTime(duckGain.gain.value,t);
      duckGain.gain.linearRampToValueAtTime(clamp(amount!=null?amount:0.35,0.05,1), t+0.03);
      duckGain.gain.setTargetAtTime(1, t+0.12, recover!=null?recover:0.7);
    }catch(e){}
  }
  // alarms/roars flip the music director into danger mode for a while
  let dangerUntil=0;
  function flagDanger(ms){ dangerUntil=Math.max(dangerUntil, Date.now()+(ms||18000)); }

  // ---------------- one-shot effects ----------------
  // Each entry takes opts o (may carry {x,y} tile coords) and layers 1-4 voices.
  const FX={
    dig:    (o)=>{ if(throttled('dig',70,o)) return; noise({...o,dur:0.06,peak:0.18,fLo:500,fHi:1800}); noise({...o,dur:0.03,peak:0.07,fLo:rand(1800,3200),fHi:rand(3600,5200),delay:0.012}); },
    break:  (o)=>{ noise({...o,dur:0.14,peak:0.3,fLo:250,fHi:1200}); tone({...o,type:'triangle',f0:180,f1:90,dur:0.12,peak:0.12});
                   noise({...o,dur:0.05,peak:0.09,fLo:900,fHi:2600,delay:0.05}); noise({...o,dur:0.04,peak:0.06,fLo:1400,fHi:3600,delay:0.1}); },
    place:  (o)=>{ noise({...o,dur:0.05,peak:0.2,fLo:900,fHi:2600}); tone({...o,type:'sine',f0:230,f1:170,dur:0.06,peak:0.07}); },
    hurt:   (o)=>{ tone({...o,type:'sawtooth',f0:280,f1:110,dur:0.22,peak:0.25}); noise({...o,dur:0.1,peak:0.1,fLo:150,fHi:600,buf:'brown',ftype:'lowpass'}); },
    heal:   (o)=>{ tone({...o,type:'sine',f0:440,f1:720,dur:0.18,peak:0.16,send:0.22}); tone({...o,type:'sine',f0:660,f1:990,dur:0.22,peak:0.1,delay:0.05,send:0.22}); },
    bow:    (o)=>{ tone({...o,type:'square',f0:220,f1:640,dur:0.1,peak:0.12,bend:0.05}); noise({...o,dur:0.07,peak:0.1,fLo:1200,fHi:3200}); tone({...o,type:'triangle',f0:1180,f1:820,dur:0.05,peak:0.05}); },
    swing:  (o)=>{ if(throttled('swing',150,o)) return; noise({...o,dur:0.1,peak:0.14,fLo:700,fHi:2400,f1:520,ftype:'bandpass'}); },
    flame:  (o)=>{ if(throttled('flame',160,o)) return; noise({...o,dur:0.16,peak:0.07,fLo:300,fHi:1400,ftype:'lowpass'}); noise({...o,dur:0.05,peak:0.03,fLo:rand(1400,2600),fHi:rand(3000,4600),delay:rand(0.01,0.07)}); },
    hose:   (o)=>{ if(throttled('hose',160,o)) return; noise({...o,dur:0.16,peak:0.06,fLo:1000,fHi:4200}); },
    gas:    (o)=>{ if(throttled('gas',200,o)) return; noise({...o,dur:0.2,peak:0.045,fLo:600,fHi:1600,ftype:'lowpass'}); },
    chest:  (o)=>{ tone({...o,type:'triangle',f0:520,f1:780,dur:0.12,peak:0.14,send:0.2}); tone({...o,type:'triangle',f0:780,f1:1170,dur:0.18,peak:0.12,delay:0.09,send:0.2}); noise({...o,dur:0.2,peak:0.03,fLo:3800,fHi:8200,ftype:'highpass',delay:0.12}); },
    craft:  (o)=>{ noise({...o,dur:0.06,peak:0.14,fLo:1500,fHi:4200}); tone({...o,type:'square',f0:330,f1:330,dur:0.08,peak:0.08}); tone({...o,type:'triangle',f0:660,f1:640,dur:0.14,peak:0.05,delay:0.05}); },
    alarm:  (o)=>{ if(throttled('alarm',900,o)) return; flagDanger();
                   tone({...o,type:'square',f0:880,f1:660,dur:0.2,peak:0.13,bend:0.12,priority:true});
                   tone({...o,type:'square',f0:880,f1:660,dur:0.2,peak:0.12,bend:0.12,delay:0.26,priority:true});
                   noise({...o,dur:0.16,peak:0.035,fLo:1800,fHi:5200}); },
    warning:(o)=>{ if(throttled('warning',400,o)) return; flagDanger();
                   tone({...o,type:'square',f0:620,f1:930,dur:0.11,peak:0.11,bend:0.09,priority:true});
                   tone({...o,type:'square',f0:740,f1:1110,dur:0.13,peak:0.1,bend:0.1,delay:0.15,priority:true}); },
    charge: (o)=>{ if(throttled('charge',240,o)) return; tone({...o,type:'sine',f0:660,f1:1320,dur:0.18,peak:0.055,bend:0.11}); tone({...o,type:'triangle',f0:1480,f1:940,dur:0.22,peak:0.035,bend:0.18}); noise({...o,dur:0.1,peak:0.022,fLo:4200,fHi:9000,ftype:'highpass'}); },
    harvest:(o)=>{ tone({...o,type:'sine',f0:520,f1:650,dur:0.1,peak:0.12}); noise({...o,dur:0.03,peak:0.05,fLo:1600,fHi:3400,delay:0.02}); },
    levelup:(o)=>{ [392,494,587,784].forEach((f,i)=>tone({...o,type:'triangle',f0:f,f1:f,dur:0.18,peak:0.16,delay:i*0.09,send:0.28,priority:true}));
                   tone({...o,type:'sine',f0:196,f1:196,dur:0.6,peak:0.05,attack:0.1,send:0.3}); },
    milestone:(o)=>{ [523,659,784].forEach((f,i)=>tone({...o,type:'sine',f0:f,f1:f,dur:0.22,peak:0.14,delay:i*0.11,send:0.28,priority:true})); },
    golden: (o)=>{ [880,1175,1568,2093,2637].forEach((f,i)=>tone({...o,type:'sine',f0:f,f1:f*1.02,dur:0.45,peak:0.07,delay:i*0.065,send:0.3})); noise({...o,dur:0.5,peak:0.025,fLo:3800,fHi:9000,ftype:'highpass'}); },
    masterstone:(o)=>{ [1760,2349,3136,4186].forEach((f,i)=>tone({...o,type:i%2?'triangle':'sine',f0:f,f1:f*1.08,dur:0.34,peak:0.09,delay:i*0.045,send:0.3,priority:true}));
                   tone({...o,type:'square',f0:3520,f1:1408,dur:0.22,peak:0.045,bend:0.18,delay:0.08}); noise({...o,dur:0.28,peak:0.028,fLo:5200,fHi:11000,ftype:'highpass'}); },
    ufo:    (o)=>{ flagDanger(); tone({...o,type:'sine',f0:520,f1:820,dur:0.9,peak:0.09,bend:0.45}); tone({...o,type:'sine',f0:820,f1:470,dur:0.9,peak:0.08,bend:0.5,delay:0.45}); }, // theremin wobble
    beam:   (o)=>{ if(throttled('beam',450,o)) return; tone({...o,type:'sawtooth',f0:95,f1:110,dur:0.5,peak:0.05,bend:0.4}); noise({...o,dur:0.45,peak:0.03,fLo:1800,fHi:4200}); },
    laser:  (o)=>{ if(throttled('laser',120,o)) return; flagDanger(); tone({...o,type:'square',f0:1400,f1:220,dur:0.16,peak:0.09,bend:0.14}); noise({...o,dur:0.06,peak:0.04,fLo:3200,fHi:7800,ftype:'highpass'}); },
    roar:   (o)=>{ flagDanger(); duck(0.3,0.9); tone({...o,type:'sawtooth',f0:90,f1:45,dur:0.8,peak:0.22,bend:0.6,priority:true}); noise({...o,dur:0.7,peak:0.12,fLo:80,fHi:400,ftype:'lowpass',buf:'brown',priority:true}); tone({...o,type:'sine',f0:55,f1:30,dur:0.9,peak:0.14,bend:0.8}); },
    explosion:(o)=>{ duck(0.3,0.8); noise({...o,dur:0.5,peak:0.5,fLo:60,fHi:900,ftype:'lowpass',buf:'brown',priority:true}); tone({...o,type:'sine',f0:120,f1:32,dur:0.6,peak:0.4,bend:0.45,priority:true});
                   noise({...o,dur:0.12,peak:0.1,fLo:1200,fHi:4200,delay:0.09}); noise({...o,dur:0.09,peak:0.06,fLo:900,fHi:3200,delay:0.21}); },
    meteor: (o)=>{ if(throttled('meteor',900,o)) return; duck(0.35,0.8); noise({...o,dur:0.75,peak:0.36,fLo:55,fHi:620,ftype:'lowpass',buf:'brown',priority:true}); tone({...o,type:'sawtooth',f0:95,f1:28,dur:0.9,peak:0.26,bend:0.65,priority:true}); noise({...o,dur:0.22,peak:0.14,fLo:1600,fHi:6200,delay:0.08}); },
    splash: (o)=>{ if(throttled('splash',250,o)) return; noise({...o,dur:0.18,peak:0.16,fLo:400,fHi:2400}); tone({...o,type:'sine',f0:300,f1:120,dur:0.12,peak:0.06}); },
    splashIn:(o)=>{ noise({...o,dur:0.22,peak:0.18,fLo:300,fHi:1900,f1:420}); tone({...o,type:'sine',f0:260,f1:90,dur:0.16,peak:0.08}); },
    splashOut:(o)=>{ noise({...o,dur:0.16,peak:0.12,fLo:500,fHi:2600,f1:2100}); },
    grave:  (o)=>{ tone({...o,type:'sine',f0:196,f1:98,dur:0.5,peak:0.2,send:0.35}); tone({...o,type:'sine',f0:294,f1:147,dur:0.55,peak:0.08,delay:0.03,send:0.35}); },
    thud:   (o)=>{ if(throttled('thud',120,o)) return; noise({...o,dur:0.09,peak:0.16,fLo:90,fHi:280,ftype:'lowpass',buf:'brown'}); tone({...o,type:'sine',f0:140,f1:60,dur:0.1,peak:0.1}); },
    fire:   (o)=>{ if(throttled('fire',140,o)) return; noise({...o,dur:0.25,peak:0.08,fLo:250,fHi:1100,ftype:'lowpass'});
                   noise({...o,dur:0.03,peak:0.05,fLo:rand(900,1800),fHi:rand(2000,3400),delay:rand(0.02,0.09)});
                   noise({...o,dur:0.025,peak:0.04,fLo:rand(1200,2200),fHi:rand(2600,4200),delay:rand(0.1,0.18)}); },
    spark:  (o)=>{ if(throttled('spark',90,o)) return; noise({...o,dur:0.04,peak:0.07,fLo:3200,fHi:8600,ftype:'highpass'}); tone({...o,type:'square',f0:1800,f1:900,dur:0.06,peak:0.05,bend:0.05}); },
    hit:    (o)=>{ if(throttled('hit',90,o)) return; noise({...o,dur:0.05,peak:0.13,fLo:600,fHi:1400}); tone({...o,type:'sine',f0:260,f1:120,dur:0.08,peak:0.09}); },
    wind:   (o)=>{ if(throttled('wind',300,o)) return; noise({...o,dur:0.5,peak:0.09,fLo:300,fHi:900,f1:380,attack:0.12}); },
    // sandstorm front: a long grit-laden howl (low moan + hissing sand sheet)
    sandstorm:(o)=>{ if(throttled('sandstorm',1200,o)) return; duck(0.5,1.0);
                   noise({...o,dur:1.9,peak:0.16,fLo:180,fHi:640,f1:260,ftype:'bandpass',buf:'brown',rate:0.7,attack:0.25,priority:true});
                   noise({...o,dur:1.5,peak:0.07,fLo:2400,fHi:6200,ftype:'highpass',attack:0.35,delay:0.2});
                   tone({...o,type:'sine',f0:110,f1:70,dur:1.6,peak:0.05,bend:1.2,attack:0.3}); },
    // elemental reactions (mobs.js status matrix): each reads as its element
    freeze: (o)=>{ if(throttled('freeze',200,o)) return; tone({...o,type:'sine',f0:1240,f1:520,dur:0.22,peak:0.11,bend:0.16,send:0.3});
                   noise({...o,dur:0.14,peak:0.07,fLo:3600,fHi:9200,ftype:'highpass'});
                   tone({...o,type:'triangle',f0:2200,f1:2600,dur:0.08,peak:0.05,delay:0.05}); },
    thermalShock:(o)=>{ if(throttled('thermalShock',200,o)) return; noise({...o,dur:0.28,peak:0.14,fLo:900,fHi:3400,f1:600});
                   tone({...o,type:'square',f0:340,f1:120,dur:0.18,peak:0.09,bend:0.12});
                   noise({...o,dur:0.1,peak:0.06,fLo:4200,fHi:9000,ftype:'highpass',delay:0.06}); },
    toxicIgnite:(o)=>{ if(throttled('toxicIgnite',200,o)) return; noise({...o,dur:0.3,peak:0.16,fLo:220,fHi:1200,ftype:'lowpass',buf:'brown'});
                   tone({...o,type:'sawtooth',f0:190,f1:60,dur:0.26,peak:0.09,bend:0.2});
                   noise({...o,dur:0.12,peak:0.05,fLo:1800,fHi:4600,delay:0.08}); },
    chainShock:(o)=>{ if(throttled('chainShock',150,o)) return; tone({...o,type:'square',f0:1600,f1:420,dur:0.12,peak:0.08,bend:0.1});
                   tone({...o,type:'square',f0:1900,f1:560,dur:0.1,peak:0.06,bend:0.08,delay:0.07});
                   noise({...o,dur:0.08,peak:0.05,fLo:3800,fHi:8600,ftype:'highpass'}); },
    // perfect parry: a bright metallic ping that cuts through combat noise
    parry:  (o)=>{ tone({...o,type:'triangle',f0:1560,f1:2080,dur:0.14,peak:0.14,bend:0.06,send:0.25,priority:true});
                   tone({...o,type:'sine',f0:3120,f1:2600,dur:0.1,peak:0.06,delay:0.03});
                   noise({...o,dur:0.05,peak:0.05,fLo:5200,fHi:11000,ftype:'highpass'}); },
    step:   (o)=>{ noise({...o,dur:0.04,peak:0.055,fLo:120,fHi:380,buf:'brown'}); },
    jump:   (o)=>{ noise({...o,dur:0.1,peak:0.04,fLo:500,fHi:1300,f1:1600,attack:0.02}); },
    land:   (o)=>{ noise({...o,dur:0.08,peak:Math.min(0.2,0.06+(o&&o.impact||0)*0.01),fLo:110,fHi:340,buf:'brown'}); tone({...o,type:'sine',f0:150,f1:70,dur:0.08,peak:Math.min(0.12,0.03+(o&&o.impact||0)*0.006)}); },
    thunder:(o)=>thunder((o&&o.dist)||10,o),
    // ceremony voices (title_screen.js / finale.js): the dismiss click is the
    // gesture that unlocks the ctx, so titleStart doubles as the world's first sound
    titleStart:(o)=>{ [262,392,523].forEach((f,i)=>tone({...o,type:'sine',f0:f,f1:f*1.01,dur:0.5,peak:0.09,delay:i*0.12,send:0.3})); noise({...o,dur:0.5,peak:0.02,fLo:2400,fHi:7000,ftype:'highpass',delay:0.2}); },
    finaleFanfare:(o)=>{ [523,659,784,1047].forEach((f,i)=>tone({...o,type:'triangle',f0:f,f1:f,dur:0.3,peak:0.13,delay:i*0.14,send:0.3,priority:true}));
                   [262,330,392].forEach((f)=>tone({...o,type:'sine',f0:f,f1:f,dur:1.4,peak:0.05,delay:0.62,attack:0.2,send:0.35}));
                   tone({...o,type:'sine',f0:131,f1:131,dur:1.6,peak:0.06,delay:0.62,attack:0.25,send:0.3}); },
    // finale ceremony 2.0 (finale.js staged acts): de-rez rumble, per-guardian
    // rising chime (opts.step 0..4), verdict seal, upper-layer glitch, re-rez
    finaleShatter:(o)=>{ duck(0.4,1.2); noise({...o,dur:1.6,peak:0.18,fLo:180,fHi:2600,f1:220,ftype:'lowpass',buf:'brown',attack:0.05,send:0.3,priority:true});
                   tone({...o,type:'sine',f0:220,f1:55,dur:1.8,peak:0.12,bend:0.9,send:0.35,priority:true});
                   noise({...o,dur:0.5,peak:0.06,fLo:2800,fHi:9000,ftype:'highpass',delay:0.15}); },
    finaleGuardian:(o)=>{ const st=Math.max(0,Math.min(5,(o&&o.step)||0)); const f=392*Math.pow(1.1225,st);
                   tone({...o,type:'triangle',f0:f,f1:f*1.005,dur:0.35,peak:0.1,send:0.35});
                   tone({...o,type:'sine',f0:f*2,f1:f*2,dur:0.22,peak:0.04,delay:0.04,send:0.3}); },
    finaleSeal:(o)=>{ tone({...o,type:'triangle',f0:660,f1:990,dur:0.4,peak:0.12,send:0.35,priority:true});
                   tone({...o,type:'sine',f0:1320,f1:1320,dur:0.5,peak:0.05,delay:0.1,send:0.4});
                   noise({...o,dur:0.12,peak:0.05,fLo:3600,fHi:9800,ftype:'highpass'}); },
    finaleGlitch:(o)=>{ tone({...o,type:'square',f0:180,f1:2400,dur:0.14,peak:0.07,bend:0.02});
                   noise({...o,dur:0.2,peak:0.09,fLo:900,fHi:7600,f1:400});
                   tone({...o,type:'square',f0:1200,f1:90,dur:0.12,peak:0.06,delay:0.12}); },
    finaleRerez:(o)=>{ tone({...o,type:'sine',f0:70,f1:240,dur:0.9,peak:0.1,bend:0.5,send:0.3});
                   noise({...o,dur:0.8,peak:0.1,fLo:300,fHi:3200,f1:2600,attack:0.3,send:0.25});
                   [523,784].forEach((f,i)=>tone({...o,type:'triangle',f0:f,f1:f,dur:0.25,peak:0.06,delay:0.5+i*0.12,send:0.35})); },
    uiClick:(o)=>{ tone({...o,bus:'ui',type:'sine',f0:900,f1:700,dur:0.05,peak:0.06,send:0}); },
    uiOpen: (o)=>{ tone({...o,bus:'ui',type:'sine',f0:520,f1:760,dur:0.09,peak:0.07,send:0}); },
    uiClose:(o)=>{ tone({...o,bus:'ui',type:'sine',f0:760,f1:500,dur:0.09,peak:0.06,send:0}); },
  };
  function play(name,opts){ const f=FX[name]; if(!f) return; try{ f(opts||{}); }catch(e){} }
  function playAt(name,x,y,opts){ play(name,{...(opts||{}),x,y}); }

  // Rolling thunder: brown noise at low playback rate + sub drop, delayed and
  // attenuated by distance (tiles). Replaces the private ctx clouds.js once had
  // (which bypassed master volume/mute entirely).
  function thunder(distTiles,opts){
    const c=ensureCtx(); if(!c||c.state!=='running') return;
    if(throttled('thunder',600,opts)) return;
    const d=Math.max(0,distTiles||0);
    const delay=Math.min(2.5,d*0.012);
    const vol=Math.max(0.05,0.5*Math.exp(-d/120));
    duck(0.45,1.1);
    noise({...(opts||{}),x:undefined,y:undefined,dur:1.8,peak:vol,fLo:60,fHi:420,f1:85,ftype:'lowpass',buf:'brown',rate:rand(0.5,0.8),attack:0.03,delay,send:0.35,priority:true});
    tone({...(opts||{}),x:undefined,y:undefined,type:'sine',f0:70,f1:34,dur:1.2,peak:vol*0.5,bend:1.0,delay:delay+0.05,priority:true});
  }

  // ---------------- scene sensing ----------------
  // Live game state snapshot, refreshed at 4 Hz by update(). Everything is read
  // defensively — any subsystem may be absent (tests, boot order).
  const scene={isDay:true, tDay:0.5, depth:0, underground:false, submerged:0, inWater:false,
               rain:0, rainLevel:0, rainPan:0, snow:0, storm:0, wind:0, sandstorm:0, ready:false};
  let heroWater={inWater:false, subFrac:0};
  function setHeroWater(inWater,subFrac){
    const wasIn=heroWater.inWater;
    heroWater.inWater=!!inWater; heroWater.subFrac=clamp(+subFrac||0,0,1);
    // audible enter/exit handled here so main.js only publishes state
    if(heroWater.inWater!==wasIn && ctx && ctx.state==='running'){
      play(heroWater.inWater?'splashIn':'splashOut');
    }
  }
  function senseScene(){
    try{ const ci=MM.background && MM.background.getCycleInfo && MM.background.getCycleInfo();
      if(ci){ scene.isDay=!!ci.isDay; scene.tDay=+ci.tDay||0; } }catch(e){}
    try{ const p=window.player, wg=MM.worldGen;
      if(p && wg && wg.surfaceHeight){ scene.depth=Math.max(0, p.y - wg.surfaceHeight(Math.round(p.x))); }
    }catch(e){}
    scene.underground=scene.depth>6;
    scene.submerged=heroWater.subFrac; scene.inWater=heroWater.inWater;
    scene.rain=0; scene.rainLevel=0; scene.rainPan=0; scene.snow=0; scene.storm=0; scene.wind=0; scene.sandstorm=0;
    try{
      const p=window.player;
      if(MM.sandstorm && MM.sandstorm.intensityAt && p && Number.isFinite(p.x)){
        scene.sandstorm=clamp(Number(MM.sandstorm.intensityAt(p.x))||0,0,1);
      }
    }catch(e){}
    try{ const cm=MM.clouds && MM.clouds.metrics && MM.clouds.metrics();
      if(cm){
        scene.rain=Number.isFinite(cm.drops)?Math.max(0,cm.drops):0;
        scene.storm=(cm.storm&&cm.storm.active)?(cm.storm.intensity||0.5):0;
        scene.wind=Math.abs(cm.wind||0);
      }
      const p=window.player;
      const field=MM.clouds && MM.clouds.precipitationAudioAt && p && Number.isFinite(p.x)
        ? MM.clouds.precipitationAudioAt(p.x) : null;
      if(field){
        scene.rainLevel=clamp(Number(field.rain)||0,0,1.5);
        scene.snow=clamp(Number(field.snow)||0,0,1.5);
        scene.rainPan=scene.rainLevel>0?clamp(Number(field.pan)||0,-0.9,0.9):0;
      }else if(scene.rain>0){
        // Compatibility for older/custom weather providers that only expose the
        // cosmetic drop count. Direction is unknown, so keep that bed centered.
        scene.rainLevel=clamp(scene.rain/100,0,1.5);
      }
    }catch(e){}
    scene.ready=true;
  }

  // ---------------- ambience beds ----------------
  // Looping noise beds whose gains chase scene-driven targets. Built once with
  // the context; silent until the scene says otherwise.
  const beds={};
  function makeBed(buf,ftype,freq,Q,spatialized){
    const src=ctx.createBufferSource(); src.buffer=buf; src.loop=true;
    const f=ctx.createBiquadFilter(); f.type=ftype; f.frequency.value=freq; f.Q.value=Q;
    const g=ctx.createGain(); g.gain.value=0;
    let panner=null;
    if(spatialized && typeof ctx.createStereoPanner==='function'){
      try{ panner=ctx.createStereoPanner(); panner.pan.value=0; }catch(e){ panner=null; }
    }
    src.connect(f); f.connect(g);
    if(panner){ g.connect(panner); panner.connect(buses.ambience); }
    else g.connect(buses.ambience);
    src.start();
    return {src,f,g,panner};
  }
  function buildAmbienceBeds(){
    beds.rain=makeBed(noiseBuf,'lowpass',900,0.4,true);
    beds.patter=makeBed(noiseBuf,'highpass',2600,0.5,true);   // droplet sizzle over the low wash
    beds.wind=makeBed(noiseBuf,'bandpass',420,0.6);
    beds.cave=makeBed(brownBuf,'lowpass',130,0.4);
    beds.water=makeBed(brownBuf,'bandpass',480,0.8);     // underwater murk
    beds.sand=makeBed(noiseBuf,'bandpass',760,0.7);      // sandstorm grit hiss over the wind bed
  }
  function driveBeds(){
    if(!ctx||!beds.rain) return;
    const t=ctx.currentTime;
    const sub=scene.submerged>0.55;
    const muffle=sub?0.25:1; // surface weather fades when the hero dives
    // surface weather bleeds a few tiles into the ground, then dies out entirely
    const ug=scene.underground? Math.max(0, 1-(scene.depth-6)/18)*0.35 : 1;
    const rainT=(scene.rainLevel>0? Math.min(0.16,0.02+scene.rainLevel*0.07):0)*(1+scene.storm*0.6)*ug*muffle;
    beds.rain.g.gain.setTargetAtTime(rainT,t,0.4);
    beds.patter.g.gain.setTargetAtTime(rainT>0.04? (rainT-0.04)*0.5:0, t,0.5);
    if(beds.rain.panner) beds.rain.panner.pan.setTargetAtTime(scene.rainPan,t,0.25);
    if(beds.patter.panner) beds.patter.panner.pan.setTargetAtTime(scene.rainPan,t,0.25);
    const windT=(Math.min(0.09,0.015+scene.wind*0.012)+scene.storm*0.05+scene.sandstorm*0.04)*(scene.underground?ug*0.6:1)*muffle;
    beds.wind.g.gain.setTargetAtTime(windT,t,0.9);
    beds.wind.f.frequency.setTargetAtTime(380+rand(-60,120)+scene.storm*160+scene.sandstorm*120, t, 1.2); // slow organic drift
    // sandstorm bed: hissing grit riding the wind howl (dies out underground)
    const sandT=scene.sandstorm>0.05 ? Math.min(0.13,0.02+scene.sandstorm*0.11)*(scene.underground?ug*0.5:1)*muffle : 0;
    beds.sand.g.gain.setTargetAtTime(sandT,t,0.7);
    if(sandT>0) beds.sand.f.frequency.setTargetAtTime(700+rand(-80,140), t, 0.9);
    const caveT=scene.underground? Math.min(0.11,0.04+scene.depth*0.0012)*muffle : 0;
    beds.cave.g.gain.setTargetAtTime(caveT,t,1.0);
    beds.water.g.gain.setTargetAtTime(sub?0.12:0, t,0.35);
    beds.water.f.frequency.setTargetAtTime(430+rand(-50,90), t, 0.8);
    // reverb: caves get big and wet, the surface stays dry-ish
    if(reverbReturn) reverbReturn.gain.setTargetAtTime(scene.underground? Math.min(0.4,0.16+scene.depth*0.002) : 0.07, t, 0.8);
    // submersion muffles the whole mix via the master-side lowpass
    if(wetFilter) wetFilter.frequency.setTargetAtTime(sub?460:18500, t, 0.12);
  }

  // scheduled wildlife: one-shots on randomized timers, gated by the scene
  const sched={bird:0, cricket:0, drip:0, bubble:0, rumble:0};
  function driveWildlife(nowMs){
    const surface=!scene.underground && scene.submerged<0.4;
    if(surface && scene.isDay && scene.rain<8 && nowMs>=sched.bird){
      sched.bird=nowMs+rand(4000,14000);
      const base=rand(1900,3400), n=2+(Math.random()*4|0), pan=rand(-0.7,0.7);
      for(let i=0;i<n;i++) tone({bus:'ambience',type:'sine',f0:base*rand(0.9,1.25),f1:base*rand(0.75,1.3),dur:rand(0.05,0.12),peak:0.028,delay:i*rand(0.09,0.16),pan,send:0.25});
    }
    if(surface && !scene.isDay && nowMs>=sched.cricket){
      sched.cricket=nowMs+rand(1600,5200);
      const pan=rand(-0.8,0.8), f=rand(3800,4600);
      for(let i=0;i<3;i++) tone({bus:'ambience',type:'sine',f0:f,f1:f*0.98,dur:0.03,peak:0.02,delay:i*0.055,pan,send:0.1});
    }
    if(scene.underground && scene.submerged<0.4 && nowMs>=sched.drip){
      sched.drip=nowMs+rand(2500,9000);
      tone({bus:'ambience',type:'sine',f0:rand(900,1500),f1:rand(300,500),dur:0.07,peak:0.045,pan:rand(-0.8,0.8),send:0.85});
    }
    if(scene.submerged>0.55 && nowMs>=sched.bubble){
      sched.bubble=nowMs+rand(900,3200);
      tone({bus:'ambience',type:'sine',f0:rand(280,460),f1:rand(700,1200),dur:rand(0.08,0.16),peak:0.035,pan:rand(-0.5,0.5),send:0.2});
    }
    if(scene.storm>0 && !scene.underground && nowMs>=sched.rumble){
      sched.rumble=nowMs+rand(9000,26000);
      noise({bus:'ambience',dur:rand(1.2,2.2),peak:0.05+scene.storm*0.04,fLo:50,fHi:300,ftype:'lowpass',buf:'brown',rate:rand(0.4,0.7),attack:0.4,pan:rand(-0.65,0.65),send:0.4});
    }
  }

  // ---------------- generative music director ----------------
  // Sparse procedural score: pentatonic plucks + soft pads. Mode follows the
  // scene (day/night/cave) and recent alarms flip it to danger. Deliberately
  // quiet — it colors the world, it must never compete with gameplay audio.
  const SCALES={
    day:   [0,2,4,7,9],      // major pentatonic
    night: [0,3,5,7,10],     // minor pentatonic
    cave:  [0,3,7,10],       // dark, sparse
    danger:[0,1,5,6,10],     // tense clusters
  };
  const music={mode:'day', nextAt:0, root:220, phrase:0};
  function musicMode(){
    if(Date.now()<dangerUntil) return 'danger';
    if(scene.underground) return 'cave';
    return scene.isDay? 'day':'night';
  }
  function noteHz(root,scale,deg,oct){ const n=scale[((deg%scale.length)+scale.length)%scale.length]; return root*Math.pow(2,(n+(oct||0)*12)/12); }
  function scheduleMusicPhrase(nowMs){
    const mode=musicMode();
    if(mode!==music.mode){ music.mode=mode; music.phrase=0; }
    const scale=SCALES[mode];
    // roots drift between phrases (A minor-ish center, wanders a fourth)
    if(music.phrase%4===0) music.root=[196,220,246.94,164.81][Math.random()*4|0];
    const o={bus:'music',send:0.4};
    if(mode==='danger'){
      // low pulse ostinato + a tense pad
      for(let i=0;i<6;i++) tone({...o,type:'sawtooth',f0:music.root/2,f1:music.root/2,dur:0.14,peak:0.032,delay:i*0.32,attack:0.01});
      tone({...o,type:'triangle',f0:noteHz(music.root,scale,1,0),f1:noteHz(music.root,scale,1,0),dur:1.8,peak:0.02,attack:0.5});
      music.nextAt=nowMs+2000+rand(0,600);
    }else if(mode==='cave'){
      // lone bell every phrase, long tail into the cave reverb
      const f=noteHz(music.root,scale,Math.random()*4|0,Math.random()<0.4?1:0);
      tone({...o,type:'sine',f0:f,f1:f*0.995,dur:2.2,peak:0.035,attack:0.02,send:0.8});
      tone({...o,type:'sine',f0:f*2.02,f1:f*2,dur:1.4,peak:0.012,attack:0.02,send:0.8});
      music.nextAt=nowMs+rand(7000,13000);
    }else{
      const night=mode==='night';
      // a short pluck run…
      const steps=night?2+(Math.random()*2|0):3+(Math.random()*3|0);
      let deg=Math.random()*5|0;
      for(let i=0;i<steps;i++){
        deg+=(Math.random()<0.5?-1:1)*(1+(Math.random()*2|0));
        const f=noteHz(music.root,scale,deg,night?0:(Math.random()<0.3?1:0));
        tone({...o,type:'triangle',f0:f,f1:f,dur:night?0.5:0.35,peak:night?0.028:0.038,delay:i*(night?0.6:0.42),attack:0.01});
      }
      // …over an occasional soft pad chord
      if(music.phrase%2===1){
        const pad=[0,2,4].map(d=>noteHz(music.root/2,scale,d,0));
        for(const f of pad) tone({...o,type:'sine',f0:f,f1:f,dur:3.5,peak:0.016,attack:0.9,send:0.5});
      }
      music.nextAt=nowMs+(night?rand(5200,9500):rand(3400,6800));
    }
    music.phrase++;
  }

  // ---------------- movement foley ----------------
  // Reads the hero directly each frame: footstep cadence from ground speed,
  // landing thump from the previous frame's fall speed (physics zeroes vy
  // before we run, so we remember it ourselves).
  const move={prevGround:true, prevVy:0, stepAcc:0};
  function driveMovement(dt){
    let p=null; try{ p=window.player; }catch(e){}
    if(!p) return;
    const vx=+p.vx||0, vy=+p.vy||0;
    if(p.onGround && !move.prevGround && move.prevVy>7){
      play('land',{impact:move.prevVy});
    }
    if(!p.onGround && move.prevGround && vy<-6 && !heroWater.inWater){
      play('jump');
    }
    if(p.onGround && Math.abs(vx)>0.6 && !heroWater.inWater){
      move.stepAcc+=Math.abs(vx)*dt;
      if(move.stepAcc>2.4){ move.stepAcc=0; play('step'); }
    }else move.stepAcc=0;
    move.prevGround=!!p.onGround; move.prevVy=vy;
  }

  // ---------------- frame update ----------------
  let sceneAcc=0;
  function update(dt){
    if(!ctx||ctx.state!=='running') return;
    driveMovement(Math.min(0.1,+dt||0));
    sceneAcc+=dt;
    if(sceneAcc<0.25) return;
    sceneAcc=0;
    try{
      senseScene();
      driveBeds();
      const nowMs=Date.now();
      driveWildlife(nowMs);
      if(settings.music>0.001 && !settings.mute && nowMs>=music.nextAt) scheduleMusicPhrase(nowMs);
    }catch(e){}
  }

  // ---------------- settings ----------------
  function setVolume(v){ settings.vol=clamp(+v||0,0,1); if(master&&!settings.mute) master.gain.value=settings.vol; saveSettings(); }
  function setMute(m){ settings.mute=!!m; if(master) master.gain.value=settings.mute?0:settings.vol; saveSettings(); }
  function setBusVolume(name,v){
    if(!(name in buses)) return;
    settings[name]=clamp(+v||0,0,1);
    if(buses[name]) buses[name].gain.value=settings[name];
    saveSettings();
  }
  function getBusVolume(name){ return (name in settings)? settings[name] : 0; }

  // QA/test snapshot: no live nodes leak out, only plain numbers
  function debugState(){
    return {
      ctx: !!ctx, state: ctx?ctx.state:'none', failed: ctxFailed, voices,
      buses:{sfx:settings.sfx, ambience:settings.ambience, music:settings.music, ui:settings.ui},
      scene:{...scene}, musicMode:music.mode, danger:Date.now()<dangerUntil,
      beds: beds.rain? {rain:beds.rain.g.gain.value, patter:beds.patter.g.gain.value,
        rainPan:beds.rain.panner?beds.rain.panner.pan.value:0,
        patterPan:beds.patter.panner?beds.patter.panner.pan.value:0,
        stereoRain:!!(beds.rain.panner&&beds.patter.panner),
        wind:beds.wind.g.gain.value, cave:beds.cave.g.gain.value, water:beds.water.g.gain.value,
        sand:beds.sand?beds.sand.g.gain.value:0} : null,
    };
  }

  MM.audio={ play, playAt, thunder, update, setHeroWater,
    setVolume, setMute, setBusVolume, getBusVolume,
    getVolume:()=>settings.vol, isMuted:()=>settings.mute,
    isReady:()=>!!(ctx && ctx.state==='running'), debugState };
})();
// ESM export (progressive migration)
export const audio = (typeof window!=='undefined' && window.MM) ? window.MM.audio : undefined;
export default audio;
