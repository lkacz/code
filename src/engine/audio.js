import { T, INFO } from '../constants.js';
import { isLooseItemMaterial, isPlayerPassableTile } from './material_physics.js';

export const RADIO_STATIONS = Object.freeze([
  Object.freeze({id:'off',icon:'⏻',label:'Cisza radiowa',genre:'Wyłączone',accent:'#83909e',description:'Radio czuwa, ale nie nadaje.',tracks:Object.freeze([])}),
  Object.freeze({id:'lofi',icon:'📼',label:'Kopalniany Lo-Fi',genre:'Lo-Fi / chillhop',accent:'#69dfc0',description:'Miękkie akordy, winylowy pył i spokojny rytm po wyprawie.',tracks:Object.freeze(['Pył na kasecie','Kilof o północy','Ciepłe światło szybu'])}),
  Object.freeze({id:'synthwave',icon:'🌆',label:'Neonowy Horyzont',genre:'Synthwave',accent:'#ff63d8',description:'Pulsujący bas, analogowe arpeggia i nocna jazda przez piksele.',tracks:Object.freeze(['Chromowy zachód','Autostrada 8-bit','Różowy reaktor'])}),
  Object.freeze({id:'jazz',icon:'🎷',label:'Głębinowy Jazz',genre:'Jazz noir',accent:'#e5b66f',description:'Kołyszący kontrabas, szczotki i akordy z zadymionej podziemnej kawiarni.',tracks:Object.freeze(['Kwarc po zmroku','Niebieski kilof','Ostatni stolik w kopalni'])}),
  Object.freeze({id:'folk',icon:'🪕',label:'Leśne Struny',genre:'Folk akustyczny',accent:'#91d96f',description:'Jasne szarpane struny, dron i melodia przyniesiona przez wiatr.',tracks:Object.freeze(['Ścieżka paproci','Drewniany dom','Taniec świetlików'])}),
  Object.freeze({id:'cosmic',icon:'🪐',label:'Orbitalna Cisza',genre:'Ambient kosmiczny',accent:'#8da2ff',description:'Długie pady, szklane dzwonki i dużo miejsca między gwiazdami.',tracks:Object.freeze(['Perygeum snu','Echo z Orrery','Światło bez końca'])}),
  Object.freeze({id:'chiptune',icon:'👾',label:'Piksel FM',genre:'Chiptune',accent:'#ffd75d',description:'Kwadratowe fale, szybkie arpeggia i energia automatu z grami.',tracks:Object.freeze(['Combo ×32','Złoty kartridż','Boss na jednym sercu'])})
]);
const RADIO_STATION_BY_ID=new Map(RADIO_STATIONS.map(station=>[station.id,station]));

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
  let caveEchoDelay=null, caveEchoReturn=null, caveEchoFeedback=null;
  const buses={sfx:null, ambience:null, music:null, ui:null};
  let settings={vol:0.5, mute:false, sfx:1, ambience:0.8, music:0.55, ui:0.9, musicOn:true, radioStation:'lofi'};
  try{ const raw=localStorage.getItem(VOL_KEY); if(raw){ const d=JSON.parse(raw); if(d&&typeof d==='object'){
    if(typeof d.vol==='number') settings.vol=Math.min(1,Math.max(0,d.vol));
    settings.mute=!!d.mute;
    // per-bus fields are new — older blobs simply lack them and keep defaults
    for(const k of ['sfx','ambience','music','ui']) if(typeof d[k]==='number') settings[k]=Math.min(1,Math.max(0,d[k]));
    if(typeof d.musicOn==='boolean') settings.musicOn=d.musicOn;
    if(RADIO_STATION_BY_ID.has(String(d.radioStation||''))) settings.radioStation=String(d.radioStation);
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
    // A quiet, long stereo tail. The first milliseconds stay dry; a few sparse
    // early reflections make enclosed rock rooms read as space rather than hiss.
    const dur=2.35, len=Math.max(1,Math.floor(ctx.sampleRate*dur));
    const pre=Math.floor(ctx.sampleRate*0.011);
    const ir=ctx.createBuffer(2,len,ctx.sampleRate);
    for(let ch=0;ch<2;ch++){ const d=ir.getChannelData(ch);
      for(let i=pre;i<len;i++){
        const f=(i-pre)/Math.max(1,len-pre);
        d[i]=(Math.random()*2-1)*Math.pow(1-f,3.1)*0.34;
      }
      for(const tap of [0.037,0.061,0.103,0.157]){
        const i=Math.min(len-1,Math.floor(ctx.sampleRate*(tap+ch*0.003)));
        d[i]+=rand(0.18,0.34)*(ch? -1:1)*Math.pow(1-tap/dur,2);
      }
    }
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
        reverbReturn=ctx.createGain(); reverbReturn.gain.value=0.035;
        reverb.connect(reverbReturn); reverbReturn.connect(mixBus);
      }
      // A very low early echo complements the diffuse convolver in actual
      // enclosed caves. It is silent on the surface and optional for older
      // WebAudio implementations without DelayNode.
      if(ctx.createDelay){
        caveEchoDelay=ctx.createDelay(0.65); caveEchoDelay.delayTime.value=0.105;
        caveEchoReturn=ctx.createGain(); caveEchoReturn.gain.value=0;
        caveEchoFeedback=ctx.createGain(); caveEchoFeedback.gain.value=0.1;
        caveEchoDelay.connect(caveEchoReturn); caveEchoReturn.connect(mixBus);
        caveEchoDelay.connect(caveEchoFeedback); caveEchoFeedback.connect(caveEchoDelay);
      }
      makeNoiseBuffers();
      buildAmbienceBeds();
    }catch(e){
      // Without the latch every SFX call re-attempted construction (and threw)
      // each frame on machines with no audio backend.
      ctx=null; master=null; limiter=null; mixBus=null; wetFilter=null; duckGain=null;
      reverb=null; reverbReturn=null; noiseBuf=null; brownBuf=null;
      caveEchoDelay=null; caveEchoReturn=null; caveEchoFeedback=null;
      for(const k in buses) buses[k]=null;
      ctxFailed=true;
    }
    return ctx;
  }
  // Resume is asynchronous in real browsers. Keep one in-flight request so a
  // radio click cannot race several resume() calls, and expose the same path to
  // UI controls that are themselves trusted user gestures.
  let resumePending=null;
  function activate(){
    ctxFailed=false;
    const c=ensureCtx();
    if(!c) return Promise.resolve(false);
    if(c.state==='running') return Promise.resolve(true);
    if(resumePending) return resumePending;
    try{
      const resumed=typeof c.resume==='function' ? c.resume() : null;
      resumePending=Promise.resolve(resumed).then(()=>c.state==='running',()=>false).finally(()=>{ resumePending=null; });
    }catch(e){
      resumePending=Promise.resolve(false).finally(()=>{ resumePending=null; });
    }
    return resumePending;
  }
  // unlock on every gesture (tabs and mobile devices may suspend the context
  // again after it was initially started)
  if(typeof window!=='undefined' && window.addEventListener){
    const unlock=()=>{ activate(); };
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
    if(reverb && send>0){
      const s=ctx.createGain(); s.gain.value=send; head.connect(s); s.connect(reverb);
      if(caveEchoDelay) s.connect(caveEchoDelay);
    }
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
    const voiceGain=Number.isFinite(o.gain)?clamp(o.gain,0,4):1;
    const peak=(o.peak||0.1)*voiceGain*sp.g*rand(0.88,1.06);
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
    const g=c.createGain();
    const voiceGain=Number.isFinite(o.gain)?clamp(o.gain,0,4):1;
    const peak=(o.peak||0.1)*voiceGain*sp.g*rand(0.88,1.06);
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

  // ---------------- material-aware landing foley ----------------
  // The collision system supplies the exact supporting tile. These families
  // intentionally describe what a boot excites (vegetation, loose grains,
  // resonant wood, rigid rock...) rather than mirroring every inventory name.
  function landingSurfaceForTile(tile){
    const t=Number.isFinite(+tile)?+tile:T.STONE;
    switch(t){
      case T.WATER: return 'water';
      case T.GRASS: case T.UNSTABLE_GRASS: return 'grass';
      case T.SNOW: case T.TOXIC_SNOW: case T.GRASS_SNOW: return 'snow';
      case T.SAND: case T.UNSTABLE_SAND: case T.QUICKSAND: return 'sand';
      case T.MUD: case T.WET_CLAY: return 'mud';
      case T.DIRT: case T.CLAY: case T.FROZEN_DIRT: case T.FROZEN_CLAY: return 'earth';
      case T.WOOD: case T.GOLDEN_WOOD: case T.WOOD_DOOR: case T.WOOD_TRAPDOOR: case T.CHAIR_WOOD: return 'wood';
      case T.ICE: case T.MOTHER_ICE: case T.FROZEN_SAND: case T.GLASS:
      case T.DIAMOND: case T.ANTIMATTER_CRYSTAL: return 'ice';
      case T.STEEL: case T.STEEL_DOOR: case T.STEEL_TRAPDOOR: case T.CHAIR_STEEL:
      case T.METEORIC_IRON: case T.IRIDIUM: case T.TRACK: case T.SPRING_PLATFORM:
      case T.ELECTRONICS: return 'metal';
      case T.ALIEN_BIOMASS: case T.MEAT: case T.ROTTEN_MEAT: case T.BAKED_MEAT: return 'organic';
      default: break;
    }
    const info=INFO[t]||INFO[T.STONE];
    if(info.doorMaterial==='wood' || info.chairMaterial==='wood') return 'wood';
    if(info.doorMaterial==='steel' || info.chairMaterial==='steel' || info.machine || info.conductor) return 'metal';
    if(info.biological || isLooseItemMaterial(t)) return 'organic';
    if(info.wetClay) return 'mud';
    if(info.frozenEarth) return 'ice';
    if(info.ceramic || info.geology || info.hardRock || info.ore || info.story || info.chestTier || info.cache) return 'stone';
    return 'stone';
  }

  const landingVariants=Object.create(null);
  let lastLanding=null, landingSerial=0;
  function nextLandingVariant(surface){
    const count=4, previous=landingVariants[surface];
    let variant=Math.floor(Math.random()*count);
    if(variant===previous) variant=(variant+1+Math.floor(Math.random()*(count-1)))%count;
    landingVariants[surface]=variant;
    return variant;
  }
  function landingReverbSend(surface){
    const enclosed=(scene && scene.underground)?clamp(scene.enclosure||0,0,1):0;
    const hard=(surface==='stone'||surface==='metal'||surface==='ice')?1:0.55;
    return 0.025+enclosed*hard*0.13;
  }
  function synthLanding(o){
    o=o||{};
    const surface=o.surface||landingSurfaceForTile(o.tile);
    const impact=Math.max(0,Number.isFinite(+o.impact)?+o.impact:8);
    const strength=clamp((impact-1.5)/15.5,0,1);
    const variant=Number.isFinite(+o.variant)?Math.abs(Math.floor(+o.variant))%4:nextLandingVariant(surface);
    const pitch=[0.88,0.97,1.07,1.16][variant]*rand(0.97,1.03);
    const length=[0.88,1.12,0.96,1.2][variant];
    const delay=[0.004,0.013,0.008,0.018][variant];
    const send=landingReverbSend(surface);
    const at={...o,send,detune:(variant-1.5)*11};
    // Peak levels deliberately sit far below combat and UI effects. A normal
    // jump is felt as texture; only a genuinely hard fall gets a clear transient.
    switch(surface){
      case 'grass':
        noise({...at,dur:(0.048+strength*0.018)*length,peak:0.014+strength*0.014,fLo:620*pitch,fHi:2300*pitch,rate:pitch});
        noise({...at,dur:0.025*length,peak:0.005+strength*0.006,fLo:2100*pitch,fHi:4700*pitch,ftype:'highpass',delay,rate:pitch*1.1});
        tone({...at,type:'sine',f0:86*pitch,f1:56*pitch,dur:0.055*length,peak:0.004+strength*0.005});
        break;
      case 'snow':
        noise({...at,dur:(0.07+strength*0.025)*length,peak:0.012+strength*0.014,fLo:850*pitch,fHi:3300*pitch,rate:pitch*0.82});
        noise({...at,dur:0.022*length,peak:0.006+strength*0.007,fLo:3000*pitch,fHi:7200*pitch,ftype:'highpass',delay,rate:pitch*1.25});
        noise({...at,dur:0.018*length,peak:0.004+strength*0.004,fLo:1800*pitch,fHi:5100*pitch,delay:delay+0.019,rate:pitch*0.94});
        break;
      case 'sand':
        noise({...at,dur:(0.065+strength*0.02)*length,peak:0.014+strength*0.014,fLo:260*pitch,fHi:1250*pitch,ftype:'lowpass',buf:'brown',rate:pitch*0.76});
        noise({...at,dur:0.04*length,peak:0.005+strength*0.006,fLo:1500*pitch,fHi:3900*pitch,delay,rate:pitch*1.18});
        break;
      case 'earth':
        noise({...at,dur:(0.06+strength*0.018)*length,peak:0.016+strength*0.018,fLo:115*pitch,fHi:520*pitch,ftype:'lowpass',buf:'brown',rate:pitch*0.8});
        noise({...at,dur:0.03*length,peak:0.005+strength*0.006,fLo:760*pitch,fHi:1900*pitch,delay,rate:pitch});
        break;
      case 'mud':
        noise({...at,dur:(0.085+strength*0.035)*length,peak:0.015+strength*0.017,fLo:75*pitch,fHi:410*pitch,ftype:'lowpass',buf:'brown',rate:pitch*0.62});
        tone({...at,type:'sine',f0:105*pitch,f1:58*pitch,dur:0.09*length,peak:0.005+strength*0.006,delay});
        noise({...at,dur:0.025*length,peak:0.004+strength*0.004,fLo:520*pitch,fHi:1250*pitch,delay:delay+0.024,rate:pitch*0.7});
        break;
      case 'wood':
        noise({...at,dur:0.045*length,peak:0.014+strength*0.017,fLo:170*pitch,fHi:920*pitch,buf:'brown',rate:pitch});
        tone({...at,type:'triangle',f0:(155+variant*13)*pitch,f1:(105+variant*8)*pitch,dur:(0.085+strength*0.025)*length,peak:0.007+strength*0.009});
        noise({...at,dur:0.018*length,peak:0.004+strength*0.005,fLo:1200*pitch,fHi:3100*pitch,delay});
        break;
      case 'metal':
        noise({...at,dur:0.035*length,peak:0.013+strength*0.018,fLo:420*pitch,fHi:2100*pitch,rate:pitch});
        tone({...at,type:'triangle',f0:(310+variant*48)*pitch,f1:(230+variant*35)*pitch,dur:(0.1+variant*0.018)*length,peak:0.005+strength*0.008,send:send+0.025});
        noise({...at,dur:0.014*length,peak:0.004+strength*0.005,fLo:3600*pitch,fHi:8200*pitch,ftype:'highpass',delay});
        break;
      case 'ice':
        noise({...at,dur:0.027*length,peak:0.011+strength*0.014,fLo:2300*pitch,fHi:7600*pitch,ftype:'highpass',rate:pitch*1.2});
        tone({...at,type:'sine',f0:(760+variant*105)*pitch,f1:(510+variant*72)*pitch,dur:(0.075+variant*0.012)*length,peak:0.004+strength*0.007,send:send+0.035});
        noise({...at,dur:0.012*length,peak:0.004+strength*0.005,fLo:4700*pitch,fHi:10500*pitch,ftype:'highpass',delay});
        break;
      case 'organic':
        noise({...at,dur:0.075*length,peak:0.012+strength*0.016,fLo:90*pitch,fHi:620*pitch,ftype:'lowpass',buf:'brown',rate:pitch*0.68});
        noise({...at,dur:0.032*length,peak:0.004+strength*0.005,fLo:520*pitch,fHi:1450*pitch,delay,rate:pitch*0.8});
        break;
      case 'water':
        noise({...at,dur:(0.09+strength*0.055)*length,peak:0.018+strength*0.023,fLo:330*pitch,fHi:2100*pitch,f1:430*pitch,rate:pitch*0.88});
        tone({...at,type:'sine',f0:245*pitch,f1:92*pitch,dur:0.1*length,peak:0.005+strength*0.007});
        noise({...at,dur:0.026*length,peak:0.004+strength*0.005,fLo:1800*pitch,fHi:4800*pitch,delay:delay+0.018,rate:pitch*1.12});
        break;
      default:
        noise({...at,dur:0.052*length,peak:0.015+strength*0.018,fLo:130*pitch,fHi:780*pitch,buf:'brown',rate:pitch});
        tone({...at,type:'sine',f0:125*pitch,f1:68*pitch,dur:0.065*length,peak:0.005+strength*0.007});
    }
    lastLanding={tile:Number.isFinite(+o.tile)?+o.tile:null,surface,variant,impact,strength,send};
    return lastLanding;
  }
  function playLanding(tile,impact,opts){
    const surface=landingSurfaceForTile(tile);
    const speed=Math.max(0,Number.isFinite(+impact)?+impact:0);
    // Tiny floor corrections must remain silent. Water still gets a minimal
    // contact texture because stepping into a pool never produces a tile hit.
    if(surface!=='water' && speed<2.4) return false;
    const result=synthLanding({...(opts||{}),tile,surface,impact:speed});
    landingSerial++;
    return result;
  }

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
    spearThrust:(o)=>{ if(throttled('spearThrust',120,o)) return; noise({...o,dur:0.075,peak:0.13,fLo:1100,fHi:4200,f1:780,ftype:'bandpass'}); tone({...o,type:'triangle',f0:310,f1:185,dur:0.055,peak:0.055,delay:0.025}); },
    axeSwing:(o)=>{ if(throttled('axeSwing',190,o)) return; noise({...o,dur:0.16,peak:0.18,fLo:280,fHi:1900,f1:240,ftype:'bandpass',buf:'brown'}); noise({...o,dur:0.07,peak:0.09,fLo:1200,fHi:3600,delay:0.055}); },
    flame:  (o)=>{ if(throttled('flame',160,o)) return; noise({...o,dur:0.16,peak:0.07,fLo:300,fHi:1400,ftype:'lowpass'}); noise({...o,dur:0.05,peak:0.03,fLo:rand(1400,2600),fHi:rand(3000,4600),delay:rand(0.01,0.07)}); },
    hose:   (o)=>{ if(throttled('hose',160,o)) return; noise({...o,dur:0.16,peak:0.06,fLo:1000,fHi:4200}); },
    gas:    (o)=>{ if(throttled('gas',200,o)) return; noise({...o,dur:0.2,peak:0.045,fLo:600,fHi:1600,ftype:'lowpass'}); },
    chest:  (o)=>{ tone({...o,type:'triangle',f0:520,f1:780,dur:0.12,peak:0.14,send:0.2}); tone({...o,type:'triangle',f0:780,f1:1170,dur:0.18,peak:0.12,delay:0.09,send:0.2}); noise({...o,dur:0.2,peak:0.03,fLo:3800,fHi:8200,ftype:'highpass',delay:0.12}); },
    craft:  (o)=>{ noise({...o,dur:0.06,peak:0.14,fLo:1500,fHi:4200}); tone({...o,type:'square',f0:330,f1:330,dur:0.08,peak:0.08}); tone({...o,type:'triangle',f0:660,f1:640,dur:0.14,peak:0.05,delay:0.05}); },
    // Home equipment uses restrained positional one-shots rather than loops.
    // The furnishing director spaces these out; local throttles are a second
    // guard against custom integrations accidentally creating a voice storm.
    homeWater:(o)=>{ if(throttled('homeWater',850,o)) return; noise({...o,bus:'ambience',dur:0.22,peak:0.014,fLo:700,fHi:2600,ftype:'bandpass',send:0.16}); tone({...o,bus:'ambience',type:'sine',f0:420,f1:720,dur:0.11,peak:0.012,bend:0.08,delay:0.04,send:0.2}); },
    homeTick:(o)=>{ if(throttled('homeTick',420,o)) return; noise({...o,bus:'ambience',dur:0.018,peak:0.017,fLo:2600,fHi:7600,ftype:'highpass',send:0.08}); tone({...o,bus:'ambience',type:'triangle',f0:1320,f1:1050,dur:0.035,peak:0.012,send:0.1}); },
    homeHum:(o)=>{ if(throttled('homeHum',1200,o)) return; tone({...o,bus:'ambience',type:'sine',f0:82,f1:84,dur:0.42,peak:0.011,attack:0.08,send:0.08}); tone({...o,bus:'ambience',type:'sine',f0:164,f1:161,dur:0.3,peak:0.005,attack:0.06,send:0.06}); },
    homeRadio:(o)=>{ if(throttled('homeRadio',1200,o)) return; noise({...o,bus:'ambience',dur:0.28,peak:0.011,fLo:950,fHi:3600,ftype:'bandpass',send:0.12}); [392,494,440].forEach((f,i)=>tone({...o,bus:'ambience',type:'triangle',f0:f,f1:f*.995,dur:0.09,peak:0.006,delay:.035+i*.075,send:0.1})); },
    homeCoffee:(o)=>{ if(throttled('homeCoffee',1600,o)) return; noise({...o,bus:'ambience',dur:0.34,peak:0.018,fLo:900,fHi:4800,f1:2200,attack:0.06,send:0.14}); tone({...o,bus:'ambience',type:'triangle',f0:1780,f1:1220,dur:0.055,peak:0.013,delay:.18,send:0.12}); },
    homeMedical:(o)=>{ if(throttled('homeMedical',850,o)) return; tone({...o,bus:'ambience',type:'sine',f0:880,f1:900,dur:0.075,peak:0.014,send:0.14}); tone({...o,bus:'ambience',type:'sine',f0:1100,f1:1120,dur:0.07,peak:0.009,delay:.13,send:0.14}); },
    homeDream:(o)=>{ if(throttled('homeDream',1400,o)) return; tone({...o,bus:'ambience',type:'sine',f0:523,f1:659,dur:0.42,peak:0.009,bend:0.28,attack:0.08,send:0.3}); tone({...o,bus:'ambience',type:'sine',f0:784,f1:698,dur:0.34,peak:0.006,delay:.11,send:0.28}); },
    homeChime:(o)=>{ if(throttled('homeChime',1800,o)) return; [1047,1568,2093].forEach((f,i)=>tone({...o,bus:'ambience',type:'sine',f0:f,f1:f*1.004,dur:.34-i*.05,peak:.012-i*.002,delay:i*.055,send:.34})); },
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
    // Pavlovian jewel bell: a clean, repeated chime with a long resonant tail,
    // deliberately unlike hits/chests so one lucky drop teaches the cue forever.
    jewel:  (o)=>{ duck(0.68,0.55);
                   [1047,2093,3136,4186].forEach((f,i)=>tone({...o,type:i===0?'triangle':'sine',f0:f,f1:f*1.006,dur:0.72-i*0.07,peak:i===0?0.15:0.075,delay:i*0.028,send:0.48,priority:true}));
                   [1319,1760].forEach((f,i)=>tone({...o,type:'sine',f0:f,f1:f,dur:0.48,peak:0.08,delay:0.24+i*0.06,send:0.42,priority:true}));
                   noise({...o,dur:0.34,peak:0.018,fLo:6500,fHi:12000,ftype:'highpass',delay:0.04,send:0.35,priority:true}); },
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
    splashIn:(o)=>synthLanding({...o,tile:T.WATER,surface:'water'}),
    splashOut:(o)=>{ noise({...o,dur:0.11,peak:0.035,fLo:520,fHi:2400,f1:1900,send:0.035}); },
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
    // cave drip (icicles / wet ceilings): a tiny sine plink with a wet tail
    drip:   (o)=>{ if(throttled('drip',260,o)) return; tone({...o,type:'sine',f0:1450,f1:820,dur:0.07,peak:0.05,bend:0.5,send:0.34}); noise({...o,dur:0.03,peak:0.014,fLo:2400,fHi:6400,ftype:'highpass',delay:0.015,send:0.2}); },
    // thin ice under load: a dry fibrous groan before the break
    creak:  (o)=>{ if(throttled('creak',420,o)) return; tone({...o,type:'sawtooth',f0:180,f1:120,dur:0.22,peak:0.06,bend:0.4}); noise({...o,dur:0.16,peak:0.05,fLo:900,fHi:3200,f1:520,ftype:'bandpass',delay:0.03}); tone({...o,type:'triangle',f0:520,f1:310,dur:0.1,peak:0.03,delay:0.08}); },
    step:   (o)=>{ noise({...o,dur:0.04,peak:0.055,fLo:120,fHi:380,buf:'brown'}); },
    jump:   (o)=>{ noise({...o,dur:0.1,peak:0.04,fLo:500,fHi:1300,f1:1600,attack:0.02}); },
    land:   (o)=>synthLanding(o),
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
               enclosure:0, reflectivity:0, roomSize:0, acousticWet:0,
               rain:0, rainLevel:0, rainPan:0, snow:0, storm:0, wind:0, sandstorm:0, bossLevel:0, ready:false};
  let heroWater={inWater:false, subFrac:0};
  function acousticBarrier(tile){
    if(tile===T.AIR || tile===T.WATER || tile===T.LAVA) return false;
    return !isPlayerPassableTile(tile);
  }
  function surfaceReflectivity(tile){
    switch(landingSurfaceForTile(tile)){
      case 'snow': case 'grass': case 'organic': return 0.22;
      case 'sand': case 'earth': case 'mud': return 0.32;
      case 'wood': return 0.48;
      case 'metal': case 'ice': return 0.94;
      default: return 0.82;
    }
  }
  function senseLocalAcoustics(p){
    if(!scene.underground) return {enclosure:0,reflectivity:0,roomSize:0,wet:0};
    const world=MM.world;
    const read=world && (world.peekTile||world.getTile);
    // Headless providers and very early boot still receive a restrained cave
    // fallback; normal play always takes the geometry path below.
    if(typeof read!=='function') return {enclosure:0.58,reflectivity:0.76,roomSize:9,wet:0.56};
    const dirs=[[0,-1],[1,0],[-1,0],[0,1],[0.707,-0.707],[-0.707,-0.707],[0.707,0.707],[-0.707,0.707],
      [0.383,-0.924],[-0.383,-0.924],[0.924,-0.383],[-0.924,-0.383]];
    const maxDist=20, hits=[];
    for(const dir of dirs){
      let found=null, lastKey='';
      for(let d=1;d<=maxDist;d++){
        const x=Math.floor(p.x+dir[0]*d), y=Math.floor(p.y+dir[1]*d);
        const key=x+','+y;
        if(key===lastKey) continue;
        lastKey=key;
        let tile=T.AIR;
        try{ tile=read.call(world,x,y,T.AIR); }catch(e){ tile=T.AIR; }
        if(acousticBarrier(tile)){ found={distance:d,tile}; break; }
      }
      hits.push(found);
    }
    const boundaries=hits.filter(Boolean);
    if(!boundaries.length) return {enclosure:0.04,reflectivity:0.2,roomSize:maxDist,wet:0.03};
    const hitRatio=boundaries.length/dirs.length;
    const ceiling=hits[0]?clamp(1-hits[0].distance/maxDist,0.1,1):0;
    const sideCount=(hits[1]?1:0)+(hits[2]?1:0);
    const sideClosure=sideCount*0.5;
    const meanDistance=boundaries.reduce((sum,h)=>sum+h.distance,0)/boundaries.length;
    const reflectivity=boundaries.reduce((sum,h)=>sum+surfaceReflectivity(h.tile),0)/boundaries.length;
    const enclosure=clamp(hitRatio*0.58+ceiling*0.25+sideClosure*0.17,0,1);
    const roomSize=clamp(meanDistance,2,maxDist);
    const sizeTail=clamp((roomSize-3)/15,0,1);
    const wet=clamp(enclosure*(0.45+reflectivity*0.42)*(0.72+sizeTail*0.28),0,1);
    return {enclosure,reflectivity,roomSize,wet};
  }
  function setHeroWater(inWater,subFrac,verticalSpeed){
    const wasIn=heroWater.inWater;
    heroWater.inWater=!!inWater; heroWater.subFrac=clamp(+subFrac||0,0,1);
    // audible enter/exit handled here so main.js only publishes state
    if(heroWater.inWater!==wasIn && ctx && ctx.state==='running'){
      let speed=Number.isFinite(+verticalSpeed)?+verticalSpeed:0;
      if(!Number.isFinite(+verticalSpeed)){
        try{ speed=Number(window.player && window.player.vy)||0; }catch(e){ speed=0; }
      }
      if(heroWater.inWater) playLanding(T.WATER,Math.max(0,speed));
      else play('splashOut');
    }
  }
  function senseScene(){
    try{ const ci=MM.background && MM.background.getCycleInfo && MM.background.getCycleInfo();
      if(ci){ scene.isDay=!!ci.isDay; scene.tDay=+ci.tDay||0; } }catch(e){}
    try{ const p=window.player, wg=MM.worldGen;
      if(p && wg && wg.surfaceHeight){ scene.depth=Math.max(0, p.y - wg.surfaceHeight(Math.round(p.x))); }
    }catch(e){}
    scene.underground=scene.depth>6;
    try{
      const p=window.player;
      const acoustic=(p&&Number.isFinite(p.x)&&Number.isFinite(p.y))?senseLocalAcoustics(p):{enclosure:0,reflectivity:0,roomSize:0,wet:0};
      scene.enclosure=acoustic.enclosure; scene.reflectivity=acoustic.reflectivity;
      scene.roomSize=acoustic.roomSize; scene.acousticWet=acoustic.wet;
    }catch(e){ scene.enclosure=0; scene.reflectivity=0; scene.roomSize=0; scene.acousticWet=0; }
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
    scene.bossLevel=senseBossFight();
    scene.ready=true;
  }

  // Guardian-fight sensing: an awakened guardian boss near the hero flips the
  // music director into 'boss' mode. Reuses the turret target queries the four
  // guardian modules already expose (no fight-state plumbing), onlyBoss so the
  // ambient sidekick skirmishes around a dormant lair stay on plain danger.
  // Level 0 = no fight, else 0.6..1 escalating as the guardian's heart drains.
  const BOSS_SENSE_RANGE=56;
  function senseBossFight(){
    let p=null; try{ p=window.player; }catch(e){}
    if(!p || !Number.isFinite(p.x)) return 0;
    let level=0;
    for(const name of ['guardianLairs','skyGuardian','undergroundBoss']){
      try{
        const m=MM[name];
        if(!m || !m.nearestForTurret) continue;
        let t=m.nearestForTurret(p.x,p.y,BOSS_SENSE_RANGE,true);
        if(!t && name==='skyGuardian' && m.targetsForTurret){
          // a shielded sky boss hides from turret queries; live resonators
          // exist only mid-fight, so they mark the shield phase instead
          const list=m.targetsForTurret(p.x,p.y,BOSS_SENSE_RANGE,false)||[];
          t=list.find(e=>e && e.raw && (e.raw.resonator||e.raw.boss))||null;
        }
        if(t){
          const raw=t.raw||t;
          const frac=(raw && raw.maxHp>0)? clamp(raw.hp/raw.maxHp,0,1) : 1;
          level=Math.max(level, 0.6+0.4*(1-frac));
        }
      }catch(e){}
    }
    try{
      const cg=MM.centerGuardian;
      if(cg && cg.status){
        const s=cg.status();
        if(s && s.phase==='battle'){
          const mi=s.mimic;
          const frac=(mi && mi.maxHp>0)? clamp(mi.hp/mi.maxHp,0,1) : 1;
          level=Math.max(level, 0.65+0.35*(1-frac));
        }
      }
    }catch(e){}
    return level;
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
    const caveT=scene.underground? Math.min(0.11,0.04+scene.depth*0.0012)*(0.62+scene.enclosure*0.38)*muffle : 0;
    beds.cave.g.gain.setTargetAtTime(caveT,t,1.0);
    beds.water.g.gain.setTargetAtTime(sub?0.12:0, t,0.35);
    beds.water.f.frequency.setTargetAtTime(430+rand(-50,90), t, 0.8);
    // Geometry, room size and wall hardness drive the cave tail. An open mine
    // shaft stays nearly dry; a broad stone chamber gets a longer, brighter tail.
    const caveWet=scene.underground?clamp(0.055+scene.acousticWet*0.19,0.055,0.245):0.035;
    if(reverbReturn) reverbReturn.gain.setTargetAtTime(caveWet,t,0.8);
    if(caveEchoDelay && caveEchoReturn && caveEchoFeedback){
      const echoDelay=clamp(0.052+scene.roomSize*0.0085,0.055,0.22);
      caveEchoDelay.delayTime.setTargetAtTime(echoDelay,t,0.7);
      caveEchoReturn.gain.setTargetAtTime(scene.underground?scene.acousticWet*0.032:0,t,0.8);
      caveEchoFeedback.gain.setTargetAtTime(scene.underground?0.055+scene.acousticWet*0.095:0.04,t,0.8);
    }
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
  // scene (day/night/cave), recent alarms flip it to danger, and a guardian
  // boss near the hero flips it to boss. Deliberately quiet — it colors the
  // world, it must never compete with gameplay audio.
  //
  // Theme rotation: peaceful modes cycle through five personalities so the
  // score never loops one idea — a theme plays ~2-3 min, rests in a silent
  // break ~0.5-1 min, then the next theme (shuffled bag, no immediate repeat)
  // takes over. Danger/boss phrases ignore the breaks: combat always sounds.
  const RADIO_GAIN=3.2;
  const radio={source:null,powered:false,lastSeen:0,nextAt:0,phrase:0,trackIndex:0,trackUntil:0};
  function setRadioSource(x,y,opts){
    if(!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))){ clearRadioSource(); return false; }
    radio.source={x:Number(x),y:Number(y)};
    radio.powered=!(opts && opts.powered===false);
    radio.lastSeen=Date.now();
    return true;
  }
  function clearRadioSource(){ radio.source=null; radio.powered=false; radio.lastSeen=0; radio.nextAt=0; }
  function selectedRadioStation(){ return RADIO_STATION_BY_ID.get(settings.radioStation)||RADIO_STATION_BY_ID.get('off'); }
  function radioBlockReason(nowMs){
    if(settings.radioStation==='off') return 'off';
    if(settings.mute) return 'muted';
    if(!settings.musicOn) return 'music-off';
    if(settings.music<=0.001) return 'music-volume';
    if(!radio.source) return 'no-source';
    if(!radio.powered) return 'no-power';
    // A radio is domestic flavor, never a way to mask danger: guardian and
    // alarm scores interrupt it until the situation is safe again.
    if(scene.bossLevel>0 || nowMs<dangerUntil) return 'danger';
    return null;
  }
  function radioCanPlay(nowMs){ return !radioBlockReason(nowMs); }
  function setRadioStation(id){
    const next=RADIO_STATION_BY_ID.get(String(id||''));
    if(!next) return false;
    settings.radioStation=next.id;
    radio.nextAt=0; radio.phrase=0; radio.trackIndex=0; radio.trackUntil=0;
    saveSettings();
    return true;
  }
  function getRadioStation(){ return settings.radioStation; }
  function getRadioStationInfo(){
    const station=selectedRadioStation();
    const track=station.tracks.length ? station.tracks[radio.trackIndex%station.tracks.length] : null;
    const blockedReason=radioBlockReason(Date.now());
    const active=!blockedReason && !!(ctx && ctx.state==='running');
    return {...station,tracks:[...station.tracks],track,active,
      blockedReason:blockedReason || (active?null:'audio-suspended'),powered:radio.powered,source:radio.source?{...radio.source}:null};
  }
  const SCALES={
    day:   [0,2,4,7,9],      // major pentatonic
    night: [0,3,5,7,10],     // minor pentatonic
    cave:  [0,3,7,10],       // dark, sparse
    danger:[0,1,5,6,10],     // tense clusters
    boss:  [0,2,3,5,7,8,11], // harmonic minor — heroic dread
  };
  // Five personalities: same scales, different voice/tempo/register writing.
  const THEMES=[
    {id:'wedrowiec', pluck:'triangle', pad:'sine',    oct:0,  stepsMul:1.0,  durMul:1.0,  gapMul:1.0,  padEvery:2, peak:1.0,  roots:[196,220,246.94,164.81]},
    {id:'choral',    pluck:'sine',     pad:'sine',    oct:0,  stepsMul:0.6,  durMul:1.9,  gapMul:1.4,  padEvery:1, peak:0.85, roots:[174.61,196,146.83,220]},
    {id:'skoczny',   pluck:'square',   pad:'triangle',oct:1,  stepsMul:1.6,  durMul:0.55, gapMul:0.7,  padEvery:3, peak:0.7,  roots:[220,261.63,196,293.66]},
    {id:'nokturn',   pluck:'sine',     pad:'sine',    oct:-1, stepsMul:0.8,  durMul:1.5,  gapMul:1.25, padEvery:2, peak:0.9,  roots:[130.81,146.83,164.81,110]},
    {id:'dryf',      pluck:'triangle', pad:'triangle',oct:0,  stepsMul:0.5,  durMul:2.2,  gapMul:1.7,  padEvery:1, peak:0.8,  roots:[164.81,185,207.65,155.56]},
  ];
  const PLAY_MS=[120000,180000], BREAK_MS=[28000,48000];
  const rotation={bag:[], theme:null, phase:'play', until:0};
  function nextTheme(){
    if(!rotation.bag.length){
      rotation.bag=THEMES.map((_,i)=>i);
      for(let i=rotation.bag.length-1;i>0;i--){ const j=Math.random()*(i+1)|0; const t=rotation.bag[i]; rotation.bag[i]=rotation.bag[j]; rotation.bag[j]=t; }
      // a reshuffle must not replay the theme that just ended
      if(rotation.theme!=null && THEMES[rotation.bag[0]].id===rotation.theme && rotation.bag.length>1){
        const t=rotation.bag[0]; rotation.bag[0]=rotation.bag[1]; rotation.bag[1]=t;
      }
    }
    return THEMES[rotation.bag.shift()];
  }
  function startPlay(nowMs){
    rotation.theme=nextTheme().id;
    rotation.phase='play';
    rotation.until=nowMs+rand(PLAY_MS[0],PLAY_MS[1]);
  }
  function currentTheme(){ return THEMES.find(t=>t.id===rotation.theme)||THEMES[0]; }
  // Advances the play/break clock and answers "may a phrase sound right now?"
  // Combat (danger window or boss level) always sounds; silence would deflate
  // exactly the moments the score exists for.
  function musicGate(nowMs){
    if(!settings.musicOn || settings.mute || settings.music<=0.001) return false;
    if(!rotation.until){ startPlay(nowMs); }
    else if(nowMs>=rotation.until){
      if(rotation.phase==='play'){
        const overshoot=nowMs-rotation.until;
        // slept through the whole break (tab away, long pause) → fresh theme
        if(overshoot>BREAK_MS[1]) startPlay(nowMs);
        else { rotation.phase='break'; rotation.until=nowMs+rand(BREAK_MS[0],BREAK_MS[1]); }
      }else startPlay(nowMs);
    }
    const combat=scene.bossLevel>0 || Date.now()<dangerUntil;
    return combat || rotation.phase==='play';
  }
  const music={mode:'day', nextAt:0, root:220, phrase:0};
  function musicMode(){
    if(scene.bossLevel>0) return 'boss';
    if(Date.now()<dangerUntil) return 'danger';
    if(scene.underground) return 'cave';
    return scene.isDay? 'day':'night';
  }
  function noteHz(root,scale,deg,oct){ const n=scale[((deg%scale.length)+scale.length)%scale.length]; return root*Math.pow(2,(n+(oct||0)*12)/12); }
  function scheduleRadioPhrase(nowMs){
    const station=selectedRadioStation();
    if(!radio.source || station.id==='off') return;
    if(!radio.trackUntil){ radio.trackIndex=0; radio.trackUntil=nowMs+rand(48000,72000); }
    else if(nowMs>=radio.trackUntil){
      radio.trackIndex=station.tracks.length ? (radio.trackIndex+1)%station.tracks.length : 0;
      radio.trackUntil=nowMs+rand(48000,72000);
    }
    const p=radio.phrase++, track=radio.trackIndex;
    // A placed receiver should read as actual foreground music in a home. The
    // general world score is intentionally much quieter, so radio voices get a
    // bounded local lift while still respecting master/music/spatial gains.
    const o={bus:'music',x:radio.source.x,y:radio.source.y,send:.28,gain:RADIO_GAIN};
    if(station.id==='lofi'){
      const scale=[0,3,5,7,10], root=[174.61,196,220][track%3];
      const degree=[0,3,1,4][p%4];
      for(const d of [0,2,4,6]){
        const f=noteHz(root/2,scale,degree+d,0);
        tone({...o,type:d===0?'triangle':'sine',f0:f,f1:f*.998,dur:2.3,peak:d===0?.022:.012,attack:.08,delay:d*.018,send:.38,priority:d===0});
      }
      for(let i=0;i<4;i++) noise({...o,dur:.07,peak:i%2?.006:.012,fLo:i%2?1800:70,fHi:i%2?5200:220,ftype:i%2?'highpass':'lowpass',buf:i%2?undefined:'brown',delay:i*.72+.08,send:.08});
      radio.nextAt=nowMs+3000+rand(0,700);
    }else if(station.id==='synthwave'){
      const scale=[0,2,3,7,10], root=[110,123.47,98][track%3];
      for(let i=0;i<8;i++){
        const f=noteHz(root,scale,[0,0,2,0,3,2,4,3][i],0);
        tone({...o,type:'sawtooth',f0:f,f1:f,dur:.15,peak:.023,attack:.008,delay:i*.27,send:.12,priority:i===0});
        if(i%2===0){ const lead=noteHz(root*2,scale,(i/2+p)%5,1); tone({...o,type:'square',f0:lead,f1:lead*.995,dur:.12,peak:.012,delay:i*.27+.08,send:.22}); }
      }
      tone({...o,type:'triangle',f0:root/2,f1:root/2,dur:2.15,peak:.014,attack:.3,send:.25});
      radio.nextAt=nowMs+2350+rand(0,420);
    }else if(station.id==='jazz'){
      const scale=[0,2,3,5,7,9,10], root=[146.83,164.81,130.81][track%3];
      const swing=[0,.46,1.02,1.48];
      for(let i=0;i<4;i++){
        const f=noteHz(root/2,scale,(p+i*2)%7,0);
        tone({...o,type:'triangle',f0:f,f1:f*.993,dur:.28,peak:.024,delay:swing[i],send:.2,priority:i===0});
      }
      for(const at of [0,1.02]) for(const d of [0,2,5]){
        const f=noteHz(root,scale,(p+d)%7,0);
        tone({...o,type:'sine',f0:f,f1:f,dur:.42,peak:.009,attack:.025,delay:at+.03,send:.34});
      }
      for(const at of [.46,1.48]) noise({...o,dur:.16,peak:.008,fLo:2600,fHi:7200,ftype:'highpass',delay:at,send:.18});
      radio.nextAt=nowMs+2150+rand(0,520);
    }else if(station.id==='folk'){
      const scale=[0,2,4,7,9], root=[196,220,174.61][track%3];
      for(let i=0;i<7;i++){
        const deg=[0,2,4,3,1,2,0][(i+p)%7];
        const f=noteHz(root,scale,deg,i===3?1:0);
        tone({...o,type:'triangle',f0:f,f1:f*.997,dur:.26,peak:.022,attack:.008,delay:i*.31,send:.35,priority:i===0});
      }
      for(const f of [root/2,root*.75]) tone({...o,type:'sine',f0:f,f1:f,dur:2.25,peak:.009,attack:.45,send:.45});
      radio.nextAt=nowMs+2500+rand(0,650);
    }else if(station.id==='cosmic'){
      const scale=[0,2,5,7,9], root=[130.81,146.83,110][track%3];
      for(const d of [0,2,4]){
        const f=noteHz(root/2,scale,d,0);
        tone({...o,type:'sine',f0:f,f1:f*1.006,dur:5.2,peak:.012,attack:1.4,delay:d*.11,send:.72,priority:d===0});
      }
      for(let i=0;i<3;i++){
        const f=noteHz(root,scale,(p+i*2)%5,1);
        tone({...o,type:'sine',f0:f,f1:f*.992,dur:1.4,peak:.012,attack:.04,delay:.7+i*1.25,send:.85});
      }
      radio.nextAt=nowMs+6200+rand(0,1700);
    }else if(station.id==='chiptune'){
      const scale=[0,2,4,5,7,9,11], root=[220,246.94,261.63][track%3];
      const pattern=[0,2,4,7,4,2,1,3,5,8,5,3];
      for(let i=0;i<pattern.length;i++){
        const f=noteHz(root,scale,pattern[(i+p)%pattern.length],0);
        tone({...o,type:'square',f0:f,f1:f,dur:.095,peak:.014,attack:.004,delay:i*.135,send:.08,priority:i===0});
        if(i%3===0){ const bass=noteHz(root/2,scale,(i/3+p)%4,0); tone({...o,type:'square',f0:bass,f1:bass,dur:.11,peak:.018,delay:i*.135,send:.05}); }
      }
      radio.nextAt=nowMs+1900+rand(0,360);
    }
  }
  function scheduleMusicPhrase(nowMs){
    const mode=musicMode();
    if(mode!==music.mode){ music.mode=mode; music.phrase=0; }
    const scale=SCALES[mode];
    const th=currentTheme();
    // roots drift between phrases (theme picks its tonal neighbourhood)
    if(music.phrase%4===0) music.root=th.roots[Math.random()*th.roots.length|0];
    const o={bus:'music',send:0.4};
    if(mode==='boss'){
      // Guardian fight: driving low ostinato, timpani hits, rising minor
      // stabs. level (0.6..1) escalates tempo, density and register as the
      // guardian's heart drains — the fight audibly comes to a head.
      const level=clamp(scene.bossLevel,0.6,1);
      const root=music.root/2;
      const pulse=0.30-0.12*level;                     // ostinato tightens
      const pulses=8+Math.round(4*level);
      for(let i=0;i<pulses;i++){
        tone({...o,type:'sawtooth',f0:root,f1:root,dur:0.13,peak:0.04,delay:i*pulse,attack:0.008});
        if(i%4===0) noise({...o,dur:0.22,peak:0.05+0.03*level,fLo:55,fHi:220,ftype:'lowpass',buf:'brown',delay:i*pulse}); // timpani
      }
      // rising stabs over the pulse — more and higher as level climbs
      const stabs=2+Math.round(2.2*level);
      let deg=0;
      for(let i=0;i<stabs;i++){
        deg+=1+(Math.random()*2|0);
        const f=noteHz(music.root,scale,deg,level>0.85&&i===stabs-1?1:0);
        tone({...o,type:'square',f0:f,f1:f,dur:0.24,peak:0.032+0.02*level,delay:0.3+i*pulse*2,attack:0.012});
      }
      // dark fifth pad under everything
      for(const f of [root, root*1.498]) tone({...o,type:'triangle',f0:f,f1:f,dur:pulse*pulses,peak:0.016,attack:0.5,send:0.5});
      music.nextAt=nowMs+Math.round(pulse*pulses*1000)+rand(0,300);
    }else if(mode==='danger'){
      // low pulse ostinato + a tense pad
      for(let i=0;i<6;i++) tone({...o,type:'sawtooth',f0:music.root/2,f1:music.root/2,dur:0.14,peak:0.032,delay:i*0.32,attack:0.01});
      tone({...o,type:'triangle',f0:noteHz(music.root,scale,1,0),f1:noteHz(music.root,scale,1,0),dur:1.8,peak:0.02,attack:0.5});
      music.nextAt=nowMs+2000+rand(0,600);
    }else if(mode==='cave'){
      // lone bell every phrase, long tail into the cave reverb
      const f=noteHz(music.root,scale,Math.random()*4|0,Math.random()<0.4?1:0);
      tone({...o,type:'sine',f0:f,f1:f*0.995,dur:2.2*th.durMul,peak:0.035*th.peak,attack:0.02,send:0.8});
      tone({...o,type:'sine',f0:f*2.02,f1:f*2,dur:1.4*th.durMul,peak:0.012*th.peak,attack:0.02,send:0.8});
      music.nextAt=nowMs+rand(7000,13000)*th.gapMul;
    }else{
      const night=mode==='night';
      // a short pluck run — voice, register and cadence come from the theme…
      const baseSteps=night?2+(Math.random()*2|0):3+(Math.random()*3|0);
      const steps=Math.max(1,Math.round(baseSteps*th.stepsMul));
      let deg=Math.random()*5|0;
      for(let i=0;i<steps;i++){
        deg+=(Math.random()<0.5?-1:1)*(1+(Math.random()*2|0));
        const oct=th.oct+(night?0:(Math.random()<0.3?1:0));
        const f=noteHz(music.root,scale,deg,oct);
        tone({...o,type:th.pluck,f0:f,f1:f,dur:(night?0.5:0.35)*th.durMul,peak:(night?0.028:0.038)*th.peak,delay:i*(night?0.6:0.42)*th.durMul,attack:0.01});
      }
      // …over an occasional soft pad chord
      if(music.phrase%th.padEvery===th.padEvery-1){
        const pad=[0,2,4].map(d=>noteHz(music.root/2,scale,d,0));
        for(const f of pad) tone({...o,type:th.pad,f0:f,f1:f,dur:3.5*th.durMul,peak:0.016*th.peak,attack:0.9,send:0.5});
      }
      music.nextAt=nowMs+(night?rand(5200,9500):rand(3400,6800))*th.gapMul;
    }
    music.phrase++;
  }

  // ---------------- movement foley ----------------
  // Reads the hero directly each frame for footstep cadence and non-tile
  // fallback landings. Ordinary terrain collisions arrive through playLanding
  // with their exact material before physics zeroes the vertical speed.
  const move={prevGround:true, prevVy:0, stepAcc:0, seenLanding:landingSerial};
  function fallbackGroundTile(p){
    const world=MM.world, read=world&&(world.peekTile||world.getTile);
    if(typeof read!=='function') return T.STONE;
    const y=Math.floor((+p.y||0)+(+p.h||0.95)*0.5+0.055);
    const half=(+p.w||0.7)*0.42;
    const samples=[+p.x||0,(+p.x||0)-half,(+p.x||0)+half];
    let tile=T.AIR;
    for(const sx of samples){
      let value=T.AIR;
      try{ value=read.call(world,Math.floor(sx),y,T.AIR); }catch(e){ value=T.AIR; }
      if(value===T.SNOW||value===T.TOXIC_SNOW||value===T.GRASS_SNOW) return value;
      if(value!==T.AIR && tile===T.AIR) tile=value;
    }
    return tile===T.AIR?T.STONE:tile;
  }
  function driveMovement(dt){
    let p=null; try{ p=window.player; }catch(e){}
    if(!p) return;
    const vx=+p.vx||0, vy=+p.vy||0;
    const explicitLanding=move.seenLanding!==landingSerial;
    if(p.onGround && !move.prevGround && move.prevVy>2.4 && !explicitLanding && !heroWater.inWater){
      playLanding(fallbackGroundTile(p),move.prevVy,{x:p.x,y:p.y+(+p.h||0.95)*0.5});
    }
    if(!p.onGround && move.prevGround && vy<-6 && !heroWater.inWater){
      play('jump');
    }
    if(p.onGround && Math.abs(vx)>0.6 && !heroWater.inWater){
      move.stepAcc+=Math.abs(vx)*dt;
      if(move.stepAcc>2.4){ move.stepAcc=0; play('step'); }
    }else move.stepAcc=0;
    move.prevGround=!!p.onGround; move.prevVy=vy;
    move.seenLanding=landingSerial;
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
      if(radioCanPlay(nowMs)){
        if(nowMs>=radio.nextAt) scheduleRadioPhrase(nowMs);
      }else if(musicGate(nowMs) && nowMs>=music.nextAt) scheduleMusicPhrase(nowMs);
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
  function setMusicOn(v){ settings.musicOn=!!v; saveSettings(); }
  function isMusicOn(){ return !!settings.musicOn; }

  // QA/test snapshot: no live nodes leak out, only plain numbers
  function debugState(){
    return {
      ctx: !!ctx, state: ctx?ctx.state:'none', failed: ctxFailed, voices,
      buses:{sfx:settings.sfx, ambience:settings.ambience, music:settings.music, ui:settings.ui},
      scene:{...scene}, musicMode:music.mode, danger:Date.now()<dangerUntil,
      lastLanding:lastLanding?{...lastLanding}:null,
      acoustics:{reverb:reverbReturn?reverbReturn.gain.value:0,
        echo:caveEchoReturn?caveEchoReturn.gain.value:0,
        echoDelay:caveEchoDelay?caveEchoDelay.delayTime.value:0},
      musicOn:!!settings.musicOn, bossLevel:scene.bossLevel,
      radio:{station:settings.radioStation,active:radioCanPlay(Date.now()) && !!(ctx && ctx.state==='running'),
        blockedReason:radioBlockReason(Date.now()) || ((ctx && ctx.state==='running')?null:'audio-suspended'),
        gain:RADIO_GAIN,powered:radio.powered,source:radio.source?{...radio.source}:null,
        trackIndex:radio.trackIndex,track:selectedRadioStation().tracks[radio.trackIndex]||null,nextAt:radio.nextAt,lastSeen:radio.lastSeen},
      rotation:{theme:rotation.theme, phase:rotation.phase, until:rotation.until},
      beds: beds.rain? {rain:beds.rain.g.gain.value, patter:beds.patter.g.gain.value,
        rainPan:beds.rain.panner?beds.rain.panner.pan.value:0,
        patterPan:beds.patter.panner?beds.patter.panner.pan.value:0,
        stereoRain:!!(beds.rain.panner&&beds.patter.panner),
        wind:beds.wind.g.gain.value, cave:beds.cave.g.gain.value, water:beds.water.g.gain.value,
        sand:beds.sand?beds.sand.g.gain.value:0} : null,
    };
  }

  MM.audio={ play, playAt, playLanding, thunder, update, setHeroWater, activate,
    setVolume, setMute, setBusVolume, getBusVolume, setMusicOn, isMusicOn,
    setRadioSource, clearRadioSource, setRadioStation, getRadioStation, getRadioStationInfo,
    radioStations:RADIO_STATIONS,
    getVolume:()=>settings.vol, isMuted:()=>settings.mute,
    isReady:()=>!!(ctx && ctx.state==='running'), debugState };
})();
// ESM export (progressive migration)
export const audio = (typeof window!=='undefined' && window.MM) ? window.MM.audio : undefined;
export default audio;
