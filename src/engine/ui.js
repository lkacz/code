// Simple UI utilities: message toast and top button label helpers (ESM + global)
import { worldGen as WORLDGEN } from './worldgen.js';
import { mobs as MOBS } from './mobs.js';
try{
  const host=String(window.location && window.location.hostname || '').toLowerCase();
  const local=window.location && window.location.protocol==='file:' || host==='localhost' || host==='::1' || host==='[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host);
  if(local) document.documentElement.dataset.devTools='1';
}catch(e){ /* production stays fail-closed: developer controls remain hidden */ }
window.MM = window.MM || {};
MM.ui = (function(){
  let msgEl = null;
  let msgTimer = null;
  let _menu = { btn: null, panel: null };
  let worldSettingsLastFocus = null;
  const DEBUG_SETTINGS_KEY='mm_debug_menu_settings_v1';
  const DEBUG_DEFAULTS={
    time:{active:false,value:0},
    simulation:{speed:1},
    background:{blur:1},
    gas:{power:2},
    wind:{speed:0,mode:'natural',profile:null},
    seasons:{enabled:true,forced:null},
    hostility:{intensity:1,reach:1}
  };
  function debugStorageAvailable(){ return typeof localStorage!=='undefined'; }
  function debugDefaultSection(section){ return Object.assign({}, DEBUG_DEFAULTS[section] || {}); }
  function readDebugSettingsRaw(){
    if(!debugStorageAvailable()) return null;
    try{
      const raw=localStorage.getItem(DEBUG_SETTINGS_KEY);
      if(!raw) return null;
      const data=JSON.parse(raw);
      return data && typeof data==='object' ? data : null;
    }catch(e){ return null; }
  }
  function readDebugSettings(){
    const raw=readDebugSettingsRaw() || {};
    const data=Object.assign({}, raw);
    Object.keys(DEBUG_DEFAULTS).forEach(section=>{
      const src=raw[section] && typeof raw[section]==='object' ? raw[section] : {};
      data[section]=Object.assign(debugDefaultSection(section), src);
    });
    return data;
  }
  function writeDebugSettings(data){
    if(!debugStorageAvailable()) return;
    try{ localStorage.setItem(DEBUG_SETTINGS_KEY, JSON.stringify(data)); }catch(e){}
  }
  function debugSection(section){
    const raw=readDebugSettingsRaw();
    const src=raw && raw[section] && typeof raw[section]==='object' ? raw[section] : {};
    return Object.assign(debugDefaultSection(section), src);
  }
  function debugHasSection(section){
    const raw=readDebugSettingsRaw();
    return !!(raw && raw[section] && typeof raw[section]==='object');
  }
  function debugHasKey(section,key){
    const raw=readDebugSettingsRaw();
    return !!(raw && raw[section] && typeof raw[section]==='object' && Object.prototype.hasOwnProperty.call(raw[section],key));
  }
  function debugSet(section,key,value){
    const data=readDebugSettingsRaw() || {};
    const src=data[section] && typeof data[section]==='object' ? data[section] : {};
    data[section]=Object.assign(debugDefaultSection(section), src);
    data[section][key]=value;
    writeDebugSettings(data);
  }
  function debugNumber(section,key,fallback,min,max){
    const raw=debugSection(section)[key];
    const n=Number(raw);
    if(!Number.isFinite(n)) return fallback;
    return Math.max(min,Math.min(max,n));
  }
  function ensureMsgEl(){
    if(!msgEl){ msgEl = document.getElementById('messages'); }
    return msgEl;
  }
  function msg(text){
    const el = ensureMsgEl();
    if(!el) return; // silently ignore if UI not present
    el.textContent = String(text);
    if(msgTimer) clearTimeout(msgTimer);
    msgTimer = setTimeout(()=>{ if(el) el.textContent=''; }, 4000);
  }
  function updateGodButton(on){
    const b = document.getElementById('godBtn');
    if(!b) return;
    b.classList.toggle('toggled', !!on);
    b.textContent = 'Bóg: ' + (on?'ON':'OFF');
  }
  function updateImmunityButton(on){
    const b = document.getElementById('immunityBtn');
    if(!b) return;
    b.classList.toggle('toggled', !!on);
    b.textContent = 'Immune: ' + (on?'ON':'OFF');
  }
  function updateMapButton(on){
    const b = document.getElementById('mapBtn');
    if(!b) return;
    b.classList.toggle('toggled', !!on);
    b.textContent = 'Mapa: ' + (on?'ON':'OFF');
  }
  function openWorldSettings(){
    const wsOverlay=document.getElementById('worldSettingsOverlay');
    const wsBody=document.getElementById('worldSettingsBody');
    if(!wsOverlay || !wsBody) return false;
    if(!wsBody.__injected){ injectWorldSettings(wsBody); wsBody.__injected=true; }
    worldSettingsLastFocus=document.activeElement && document.activeElement!==document.body ? document.activeElement : null;
    wsOverlay.style.display='block';
    wsOverlay.setAttribute('aria-hidden','false');
    const pause=document.getElementById('pausePanel');
    if(pause && !pause.hidden){ pause.setAttribute('aria-hidden','true'); wsOverlay.dataset.pauseWasModal='1'; }
    try{ api.closeMenu(); }catch(e){}
    try{ const first=wsOverlay.querySelector('#worldSettingsClose,button,input,select,textarea,[href],[tabindex]:not([tabindex="-1"])'); if(first) first.focus({preventScroll:true}); }catch(e){}
    return true;
  }
  function closeWorldSettings(){
    const wsOverlay=document.getElementById('worldSettingsOverlay');
    if(!wsOverlay) return false;
    wsOverlay.style.display='none';
    wsOverlay.setAttribute('aria-hidden','true');
    if(wsOverlay.dataset.pauseWasModal){
      const pause=document.getElementById('pausePanel');
      if(pause && !pause.hidden) pause.setAttribute('aria-hidden','false');
      delete wsOverlay.dataset.pauseWasModal;
    }
    try{
      let target=worldSettingsLastFocus && worldSettingsLastFocus.isConnected ? worldSettingsLastFocus : null;
      if(target && target.getClientRects && target.getClientRects().length===0) target=null;
      if(!target){
        const candidates=[document.getElementById('debugMenuBtn'),document.getElementById('menuBtn')];
        target=candidates.find(el=>el && el.isConnected && (!el.getClientRects || el.getClientRects().length>0)) || null;
      }
      if(target && target.focus) target.focus({preventScroll:true});
    }catch(e){}
    worldSettingsLastFocus=null;
    return true;
  }
  function trapWorldSettingsFocus(e,wsOverlay){
    const visible=wsOverlay && wsOverlay.style.display!=='none' && wsOverlay.style.display!=='';
    if(!visible) return false;
    if(window.MM && MM.finale && MM.finale.isOpen && MM.finale.isOpen()) return false;
    if(e.ctrlKey || e.metaKey || e.altKey) return false;
    if(e.key==='Escape'){
      e.preventDefault(); e.stopImmediatePropagation(); closeWorldSettings(); return true;
    }
    if(e.key!=='Tab') return false;
    const items=[...wsOverlay.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[href],[tabindex]:not([tabindex="-1"])')]
      .filter(el=>el.getClientRects().length>0);
    if(!items.length){ e.preventDefault(); return true; }
    const at=items.indexOf(document.activeElement);
    const next=at<0 ? (e.shiftKey?items.length-1:0) : (at+(e.shiftKey?-1:1)+items.length)%items.length;
    e.preventDefault();
    items[next].focus();
    e.stopImmediatePropagation();
    return true;
  }
  function bindWorldSettings(){
    const openWS=document.getElementById('openWorldSettingsBtn');
    const wsOverlay=document.getElementById('worldSettingsOverlay');
    const wsClose=document.getElementById('worldSettingsClose');
    if(openWS && !openWS.__mmWorldSettingsBound){ openWS.__mmWorldSettingsBound=true; openWS.addEventListener('click',openWorldSettings); }
    if(wsClose && !wsClose.__mmWorldSettingsBound){ wsClose.__mmWorldSettingsBound=true; wsClose.addEventListener('click',closeWorldSettings); }
    if(wsOverlay && !wsOverlay.__mmWorldSettingsBound){
      wsOverlay.__mmWorldSettingsBound=true;
      wsOverlay.addEventListener('click',e=>{ if(e.target===wsOverlay) closeWorldSettings(); });
      window.addEventListener('keydown',e=>{ trapWorldSettingsFocus(e,wsOverlay); },true);
    }
  }
  function initMenuToggle(){
    bindWorldSettings();
    const menuBtn = document.getElementById('debugMenuBtn');
    const menuPanel = document.getElementById('menuPanel');
    if(!menuBtn || !menuPanel) return;
    _menu.btn = menuBtn; _menu.panel = menuPanel;
    function setOpen(open){
      menuPanel.hidden = !open;
      menuBtn.setAttribute('aria-expanded', String(!!open));
      menuBtn.classList.toggle('toggled', !!open);
    }
    function close(){ setOpen(false); }
    api.closeMenu = close;
    api.openMenu = ()=>setOpen(true);
    api.toggleMenu = ()=>setOpen(menuPanel.hidden);
    setOpen(!menuPanel.hidden);
    if(menuBtn.__mmMenuToggleBound) return;
    menuBtn.__mmMenuToggleBound = true;
    menuBtn.addEventListener('click',(e)=>{
      e.preventDefault();
      e.stopPropagation();
      setOpen(menuPanel.hidden);
    });
    document.addEventListener('click',(e)=>{
      if(menuPanel.hidden) return;
      if(menuPanel.contains(e.target) || menuBtn.contains(e.target)) return;
      close();
    });
    window.addEventListener('keydown',(e)=>{ if(e.key==='Escape' && !menuPanel.hidden) close(); });
    // Radar menu button triggers a custom event so game can respond without tight coupling
    const radarMenuBtn = document.getElementById('radarMenuBtn');
    radarMenuBtn?.addEventListener('click',()=>{
      try{ window.dispatchEvent(new CustomEvent('mm-radar-pulse')); }catch(e){}
      close();
    });
  }
  function injectWorldSettings(menuPanel){
    const panel = menuPanel || document.getElementById('menuPanel'); if(!panel) return;
    if(document.getElementById('worldSettingsBox')) return;
    const WG = WORLDGEN || (MM.worldGen||null);
    const s = (WG && WG.getSettings)? WG.getSettings(): {};
    const box=document.createElement('div'); box.id='worldSettingsBox'; box.className='group'; box.style.cssText='flex-direction:column; align-items:stretch; gap:6px; border-top:1px solid rgba(255,255,255,.08); padding-top:8px;';
    const h=document.createElement('div'); h.textContent='Ustawienia świata'; h.style.cssText='font-size:12px; font-weight:700; opacity:.85;'; box.appendChild(h);
    function row(label, id, min, max, step, value, fmt){
      const wrap=document.createElement('div'); wrap.style.cssText='display:flex; flex-direction:column; gap:4px;';
      const lab=document.createElement('label'); lab.style.cssText='font-size:12px; display:flex; justify-content:space-between; gap:8px; align-items:center;';
      const span=document.createElement('span'); span.id=id+'Lbl'; span.style.fontSize='11px'; span.style.opacity='0.8'; span.textContent=fmt?fmt(value):String(value);
      lab.textContent=label+" "; lab.appendChild(span);
      const input=document.createElement('input'); input.type='range'; input.min=String(min); input.max=String(max); input.step=String(step); input.value=String(value);
      input.id=id; input.style.width='100%';
      lab.htmlFor=id;
      input.addEventListener('input',()=>{ span.textContent = fmt? fmt(input.value): String(input.value); });
      wrap.appendChild(lab); wrap.appendChild(input); box.appendChild(wrap);
      return {input,span};
    }
    const r1=row('Poziom morza', 'setSeaLevel', 45, 80, 1, (s.seaLevel===undefined?62:s.seaLevel));
    const r2=row('Ilość oceanów', 'setOceanFrac', 0.15, 0.50, 0.01, (s.oceanFrac===undefined?0.22:s.oceanFrac), v=>Number(v).toFixed(2));
  const r3=row('Wysokość gór', 'setMountainAmp', 10, 54, 1, (s.mountainAmp===undefined?38:s.mountainAmp));
  const r4=row('Próg gór', 'setMountainTh', 0.30, 0.70, 0.01, (s.mountainThreshold===undefined?0.46:s.mountainThreshold), v=>Number(v).toFixed(2));
  const r5=row('Głębokość dolin', 'setValleyGain', 0, 50, 1, (s.valleyGain===undefined?30:s.valleyGain));
  const r6=row('Próg dolin', 'setValleyCut', 0.40, 0.90, 0.01, (s.valleyCutoff===undefined?0.58:s.valleyCutoff), v=>Number(v).toFixed(2));
  const r7=row('Szczegóły terenu', 'setDetailAmp', 0, 2, 0.05, (s.detailAmp===undefined?1:s.detailAmp), v=>Number(v).toFixed(2));
  const r8=row('Gęstość jaskiń', 'setCaveDensity', 0, 2, 0.05, (s.caveDensity===undefined?1:s.caveDensity), v=>Number(v).toFixed(2));
  const r9=row('Gęstość tuneli', 'setTunnelDensity', 0, 2, 0.05, (s.tunnelDensity===undefined?1:s.tunnelDensity), v=>Number(v).toFixed(2));
  const r10=row('Wąwozy', 'setRavineFreq', 0, 3, 0.1, (s.ravineFreq===undefined?1:s.ravineFreq), v=>Number(v).toFixed(1));
  const r11=row('Wody podziemne (rząd)', 'setAquifer', 75, 130, 1, (s.aquiferLevel===undefined?112:s.aquiferLevel));
  const r12=row('Głębokość jezior', 'setLakeDepth', 3, 20, 1, (s.lakeMaxDepth===undefined?12:s.lakeMaxDepth));
  const r13=row('Gęstość lasu', 'setForestMul', 0.2, 3.0, 0.05, (s.forestDensityMul===undefined?1.0:s.forestDensityMul), v=>Number(v).toFixed(2));
    const applyRow=document.createElement('div'); applyRow.style.cssText='display:flex; gap:6px;';
  const apply=document.createElement('button'); apply.className='topbtn'; apply.textContent='Zastosuj i utwórz świat od nowa';
  apply.addEventListener('click',()=>{
      try{
        if(typeof window.confirm==='function' && !window.confirm('Zastosować ustawienia generatora?\n\nBieżący świat i postęp zostaną rozpoczęte od nowa z tym samym ziarnem. Ręczne zapisy zostaną zachowane.')) return;
        const ns={
          seaLevel: parseInt(r1.input.value,10),
          oceanFrac: parseFloat(r2.input.value),
          mountainAmp: parseInt(r3.input.value,10),
          mountainThreshold: parseFloat(r4.input.value),
          valleyGain: parseInt(r5.input.value,10),
          valleyCutoff: parseFloat(r6.input.value),
          detailAmp: parseFloat(r7.input.value),
          caveDensity: parseFloat(r8.input.value),
          tunnelDensity: parseFloat(r9.input.value),
          ravineFreq: parseFloat(r10.input.value),
          aquiferLevel: parseInt(r11.input.value,10),
          lakeMaxDepth: parseInt(r12.input.value,10),
          forestDensityMul: parseFloat(r13.input.value)
        };
  const WG2 = WORLDGEN || (MM.worldGen||null);
  if(WG2 && WG2.setSettings) WG2.setSettings(ns);
    if(MM.ui && MM.ui.msg) MM.ui.msg('Zastosowano ustawienia świata');
        // Regenerate world with the SAME seed
        if(window.regenWorldSameSeed){ window.regenWorldSameSeed(); }
        else { window.dispatchEvent(new CustomEvent('mm-regen-same-seed')); }
        closeWorldSettings();
      }catch(e){}
    });
    applyRow.appendChild(apply); box.appendChild(applyRow);
    panel.appendChild(box);
  }
  function injectTimeSlider(menuPanel){
    const panel = menuPanel || document.getElementById('menuPanel');
    if(!panel) return;
    if(window.__timeSliderInjected) return; window.__timeSliderInjected = true;
    const wrap=document.createElement('div'); wrap.className='group'; wrap.style.cssText='flex-direction:column; align-items:stretch; margin-top:6px; border-top:1px solid rgba(255,255,255,.08); padding-top:6px;';
    const label=document.createElement('label'); label.style.cssText='font-size:12px; display:flex; justify-content:space-between; gap:8px; align-items:center;'; label.textContent='Czas doby';
    const span=document.createElement('span'); span.style.fontSize='11px'; span.style.opacity='0.7'; span.textContent='—'; label.appendChild(span);
    const timeSaved=debugSection('time');
    const range=document.createElement('input'); range.type='range'; range.min='0'; range.max='1'; range.step='0.0001'; range.value=String(debugNumber('time','value',0,0,1)); range.style.width='100%';
    const chkWrap=document.createElement('div'); chkWrap.style.cssText='display:flex; align-items:center; gap:6px; font-size:11px; margin-top:4px;';
    const chk=document.createElement('input'); chk.type='checkbox'; chk.id='timeOverrideChk';
    chk.checked=timeSaved.active===true;
    const chkLab=document.createElement('label'); chkLab.htmlFor='timeOverrideChk'; chkLab.textContent='Steruj ręcznie';
    chkWrap.appendChild(chk); chkWrap.appendChild(chkLab);
    const simLabel=document.createElement('label'); simLabel.style.cssText='font-size:12px; display:flex; justify-content:space-between; gap:8px; align-items:center; margin-top:7px; padding-top:7px; border-top:1px solid rgba(255,255,255,.06);'; simLabel.textContent='Tempo symulacji';
    const simValue=document.createElement('span'); simValue.style.fontSize='11px'; simValue.style.opacity='0.8'; simLabel.appendChild(simValue);
    const simSelect=document.createElement('select'); simSelect.id='simulationSpeedDropdown'; simSelect.style.cssText='width:100%; background:rgba(20,20,25,.7); color:#e8e8e8; border:1px solid rgba(255,255,255,.18); border-radius:8px; padding:4px 6px; font-size:12px;';
    const simSpeeds=[0.1,0.25,0.5,0.75,1,1.5,2,3,4];
    const savedSpeed=debugNumber('simulation','speed',1,0.1,4);
    const initialSpeed=simSpeeds.reduce((best,value)=>Math.abs(value-savedSpeed)<Math.abs(best-savedSpeed)?value:best,1);
    for(const speed of simSpeeds){
      const option=document.createElement('option'); option.value=String(speed); option.textContent='×'+speed.toFixed(speed<1?2:(Number.isInteger(speed)?0:1)); simSelect.appendChild(option);
    }
    simSelect.value=String(initialSpeed);
    const simHint=document.createElement('div'); simHint.className='hint'; simHint.textContent='Wspólny zegar dla fizyki, pogody, stworzeń, maszyn i pozostałych symulacji.';
    wrap.appendChild(label); wrap.appendChild(range); wrap.appendChild(chkWrap); wrap.appendChild(simLabel); wrap.appendChild(simSelect); wrap.appendChild(simHint);
    panel.appendChild(wrap);
    window.__timeSliderEl = range;
    function readTimeValue(){ const n=parseFloat(range.value); return Number.isFinite(n) ? Math.max(0,Math.min(1,n)) : 0; }
    function upd(){ span.textContent=(readTimeValue()*100).toFixed(2)+'%'; }
    function applySimulationSpeed(){
      const speed=Math.max(0.1,Math.min(4,Number(simSelect.value)||1));
      window.__simulationTimeScale=speed;
      simValue.textContent='×'+speed.toFixed(speed<1?2:(Number.isInteger(speed)?0:1));
      debugSet('simulation','speed',speed);
    }
    function applyTimeOverride(){
      const val=readTimeValue();
      // a challenge night lock (permanight) owns the override while the manual
      // box is unchecked — building this panel at boot used to clobber it off
      const chalNight=(window.MM && MM.challenge && MM.challenge.nightLock) ? MM.challenge.nightLock() : null;
      window.__timeOverrideActive=chk.checked || chalNight!=null;
      window.__timeOverrideValue=chk.checked ? val : (chalNight!=null ? chalNight : val);
      window.__timeSliderLocked=chk.checked;
    }
    range.addEventListener('input',()=>{
      upd();
      debugSet('time','value',readTimeValue());
      if(window.__timeOverrideActive) window.__timeOverrideValue=readTimeValue();
    });
    chk.addEventListener('change',()=>{
      applyTimeOverride();
      debugSet('time','active',chk.checked);
      debugSet('time','value',readTimeValue());
    });
    simSelect.addEventListener('change',applySimulationSpeed);
    applyTimeOverride();
    applySimulationSpeed();
    upd();
  }
  function injectBackgroundDebugPanel(menuPanel){
    const panel = menuPanel || document.getElementById('menuPanel');
    if(!panel) return;
    if(window.__backgroundDebugPanelInjected) return; window.__backgroundDebugPanelInjected = true;
    const wrap=document.createElement('div');
    wrap.id='backgroundDebugBox';
    wrap.className='group';
    wrap.style.cssText='flex-direction:column; align-items:stretch; margin-top:6px; border-top:1px solid rgba(255,255,255,.08); padding-top:6px;';
    const label=document.createElement('label');
    label.style.cssText='font-size:12px; display:flex; justify-content:space-between; gap:8px; align-items:center;';
    label.textContent='Rozmycie tla';
    const span=document.createElement('span');
    span.style.fontSize='11px';
    span.style.opacity='0.7';
    label.appendChild(span);
    const blur=document.createElement('input');
    blur.type='range';
    blur.min='0.5';
    blur.max='2.2';
    blur.step='0.05';
    blur.value=String(debugNumber('background','blur',1,0.5,2.2));
    blur.style.width='100%';
    wrap.appendChild(label);
    wrap.appendChild(blur);
    panel.appendChild(wrap);
    function readBlur(){
      const n=parseFloat(blur.value);
      return Number.isFinite(n) ? Math.max(0.5,Math.min(2.2,n)) : 1;
    }
    function upd(){
      const value=readBlur();
      span.textContent='x'+value.toFixed(2);
      window.__backdropBlurScale=value;
    }
    blur.addEventListener('input',()=>{
      upd();
      debugSet('background','blur',readBlur());
    });
    upd();
  }
  // Playtest knob for the long-distance difficulty ramp (world_hostility.js).
  // Two sliders: how STRONG the ramp gets, and how FAR you travel before it bites.
  // Persists to the shared debug-settings store and reapplies on the next run.
  function injectHostilityDebugPanel(actions, menuPanel){
    const panel = menuPanel || document.getElementById('menuPanel');
    if(!panel) return;
    if(window.__hostilityDebugPanelInjected) return; window.__hostilityDebugPanelInjected = true;
    actions = actions || {};
    const wrap=document.createElement('div');
    wrap.id='hostilityDebugBox';
    wrap.className='group';
    wrap.style.cssText='flex-direction:column; align-items:stretch; margin-top:6px; border-top:1px solid rgba(255,255,255,.08); padding-top:6px;';
    const title=document.createElement('div');
    title.textContent='Wrogość świata (dystans)';
    title.style.cssText='font-size:12px; opacity:.85; margin-bottom:2px;';
    wrap.appendChild(title);
    function makeRow(labelText, min, max, step, value){
      const label=document.createElement('label');
      label.style.cssText='font-size:11px; display:flex; justify-content:space-between; gap:8px; align-items:center; margin-top:2px;';
      label.textContent=labelText;
      const span=document.createElement('span');
      span.style.cssText='font-size:11px; opacity:.7;';
      label.appendChild(span);
      const range=document.createElement('input');
      range.type='range'; range.min=String(min); range.max=String(max); range.step=String(step);
      range.value=String(value); range.style.width='100%';
      wrap.appendChild(label); wrap.appendChild(range);
      return {range, span};
    }
    const intensity=makeRow('Siła narastania', 0, 3, 0.05, debugNumber('hostility','intensity',1,0,3));
    const reach=makeRow('Zasięg (dystans)', 0.25, 4, 0.05, debugNumber('hostility','reach',1,0.25,4));
    const readout=document.createElement('div');
    readout.style.cssText='font-size:11px; opacity:.65; margin-top:3px;';
    wrap.appendChild(readout);
    const resetBtn=document.createElement('button');
    resetBtn.textContent='Reset (x1.0 / x1.0)';
    resetBtn.style.cssText='font-size:11px; padding:3px 6px; margin-top:4px;';
    wrap.appendChild(resetBtn);
    panel.appendChild(wrap);
    function readIntensity(){ const n=parseFloat(intensity.range.value); return Number.isFinite(n)?Math.max(0,Math.min(3,n)):1; }
    function readReach(){ const n=parseFloat(reach.range.value); return Number.isFinite(n)?Math.max(0.25,Math.min(4,n)):1; }
    function describe(){
      const i=readIntensity(), r=readReach();
      intensity.span.textContent='x'+i.toFixed(2);
      reach.span.textContent='x'+r.toFixed(2);
      const sample = typeof actions.sample==='function' ? actions.sample() : null;
      if(sample && typeof sample.hostility==='number'){
        readout.textContent='tu: wrogość '+sample.hostility.toFixed(2)+' ('+(sample.side||'center')+')';
      } else {
        readout.textContent = i===0 ? 'ramp wyłączony' : 'idź dalej w bok, by poczuć zmianę';
      }
    }
    function apply(){
      if(typeof actions.set==='function') actions.set(readIntensity(), readReach());
      describe();
    }
    intensity.range.addEventListener('input',()=>{ debugSet('hostility','intensity',readIntensity()); apply(); });
    reach.range.addEventListener('input',()=>{ debugSet('hostility','reach',readReach()); apply(); });
    resetBtn.addEventListener('click',()=>{
      intensity.range.value='1'; reach.range.value='1';
      debugSet('hostility','intensity',1); debugSet('hostility','reach',1);
      apply();
    });
    // Reapply the persisted tuning to the live module so runtime matches the UI.
    apply();
  }
  // Debug travel: fixed-distance hops (±1000/±100 columns) plus an absolute
  // coordinate jump. Surface-drops the hero unless an explicit Y is supplied.
  function injectTravelDebugPanel(actions, menuPanel){
    const panel = menuPanel || document.getElementById('menuPanel');
    if(!panel) return;
    if(window.__travelDebugPanelInjected) return; window.__travelDebugPanelInjected = true;
    actions = actions || {};
    const wrap=document.createElement('div');
    wrap.id='travelDebugBox';
    wrap.className='group';
    wrap.style.cssText='flex-direction:column; align-items:stretch; margin-top:6px; border-top:1px solid rgba(255,255,255,.08); padding-top:6px;';
    const title=document.createElement('div');
    title.textContent='Podróż / teleport (debug)';
    title.style.cssText='font-size:12px; opacity:.85; margin-bottom:2px;';
    wrap.appendChild(title);
    const readout=document.createElement('div');
    readout.style.cssText='font-size:11px; opacity:.65; margin-top:1px;';
    function syncFromPos(pos){
      const p = pos || (typeof actions.pos==='function' ? actions.pos() : null);
      if(p && typeof p.x==='number' && isFinite(p.x)){
        readout.textContent='pozycja: x='+Math.round(p.x)+', y='+Math.round(p.y);
        if(document.activeElement!==xIn) xIn.value=String(Math.round(p.x));
      }
    }
    const moveRow=document.createElement('div');
    moveRow.style.cssText='display:flex; gap:4px; margin-top:2px;';
    [[-1000,'◀ 1000'],[-100,'◀ 100'],[100,'100 ▶'],[1000,'1000 ▶']].forEach(([dx,label])=>{
      const b=document.createElement('button'); b.textContent=label;
      b.style.cssText='flex:1 1 0; min-width:0; font-size:11px; padding:3px 4px;';
      b.addEventListener('click',()=>{ syncFromPos(typeof actions.move==='function' ? actions.move(dx) : null); });
      moveRow.appendChild(b);
    });
    wrap.appendChild(moveRow);
    const jumpRow=document.createElement('div');
    jumpRow.style.cssText='display:flex; gap:4px; margin-top:4px; align-items:center;';
    function mkInput(ph){
      const i=document.createElement('input'); i.type='number'; i.placeholder=ph;
      i.style.cssText='flex:1 1 0; min-width:0; width:100%; font-size:11px; padding:3px 4px; background:rgba(20,20,25,.7); color:#e8e8e8; border:1px solid rgba(255,255,255,.18); border-radius:6px;';
      return i;
    }
    const xIn=mkInput('X'); const yIn=mkInput('Y (opcj.)');
    const goBtn=document.createElement('button'); goBtn.textContent='Teleport';
    goBtn.style.cssText='flex:0 0 auto; font-size:11px; padding:3px 8px;';
    jumpRow.appendChild(xIn); jumpRow.appendChild(yIn); jumpRow.appendChild(goBtn);
    wrap.appendChild(jumpRow);
    if(typeof actions.guardian==='function'){
      const guardianRow=document.createElement('div');
      guardianRow.style.cssText='display:flex; gap:4px; margin-top:4px;';
      [['fire','Fire gate'],['ice','Ice gate']].forEach(([kind,label])=>{
        const b=document.createElement('button');
        b.textContent=label;
        b.title='Teleport to the '+label+' lair';
        b.style.cssText='flex:1 1 0; min-width:0; font-size:11px; padding:3px 6px; border:1px solid '+(kind==='fire'?'rgba(255,120,50,.65)':'rgba(130,220,255,.65)')+';';
        b.addEventListener('click',()=>{
          const r=actions.guardian(kind);
          if(r===false){ msg('Guardian teleport failed'); return; }
          syncFromPos(r);
        });
        guardianRow.appendChild(b);
      });
      wrap.appendChild(guardianRow);
    }
    if(typeof actions.sky==='function'){
      const skyRow=document.createElement('div');
      skyRow.style.cssText='display:flex; gap:4px; margin-top:4px;';
      [['low','Sky low'],['high','Sky high']].forEach(([layer,label])=>{
        const b=document.createElement('button');
        b.textContent=label;
        b.title='Teleport to a generated sky island layer';
        b.style.cssText='flex:1 1 0; min-width:0; font-size:11px; padding:3px 6px; border:1px solid rgba(150,205,255,.65);';
        b.addEventListener('click',()=>{
          const r=actions.sky(layer);
          if(r===false){ msg('Sky teleport failed'); return; }
          syncFromPos(r);
        });
        skyRow.appendChild(b);
      });
      wrap.appendChild(skyRow);
    }
    if(typeof actions.atlantis==='function'){
      const atlantisRow=document.createElement('div');
      atlantisRow.style.cssText='display:flex; gap:4px; margin-top:4px;';
      [[-1,'Atlantis <','travelDebugAtlantisLeft'],[1,'Atlantis >','travelDebugAtlantisRight']].forEach(([dir,label,id])=>{
        const b=document.createElement('button');
        b.id=id;
        b.textContent=label;
        b.title='Teleport to the nearest generated Atlantis city '+(dir<0?'to the left':'to the right');
        b.style.cssText='flex:1 1 0; min-width:0; font-size:11px; padding:3px 6px; border:1px solid rgba(80,225,255,.75);';
        b.addEventListener('click',()=>{
          const r=actions.atlantis(dir);
          if(r===false){ msg('Atlantis teleport failed'); return; }
          syncFromPos(r);
        });
        atlantisRow.appendChild(b);
      });
      wrap.appendChild(atlantisRow);
    }
    if(typeof actions.underground==='function'){
      const undergroundRow=document.createElement('div');
      undergroundRow.style.cssText='display:flex; gap:4px; margin-top:4px;';
      const b=document.createElement('button');
      b.textContent='Underground gate';
      b.title='Teleport to the underground guardian gate';
      b.style.cssText='flex:1 1 0; min-width:0; font-size:11px; padding:3px 6px; border:1px solid rgba(196,107,255,.7);';
      b.addEventListener('click',()=>{
        const r=actions.underground();
        if(r===false){ msg('Underground teleport failed'); return; }
        syncFromPos(r);
      });
      undergroundRow.appendChild(b);
      if(typeof actions.undergroundFight==='function'){
        const fightBtn=document.createElement('button');
        fightBtn.textContent='Underground fight';
        fightBtn.title='Teleport to the underground arena and start the boss fight';
        fightBtn.style.cssText='flex:1 1 0; min-width:0; font-size:11px; padding:3px 6px; border:1px solid rgba(121,201,93,.7);';
        fightBtn.addEventListener('click',()=>{
          const r=actions.undergroundFight();
          if(r===false){ msg('Underground fight start failed'); return; }
          syncFromPos(r);
        });
        undergroundRow.appendChild(fightBtn);
      }
      wrap.appendChild(undergroundRow);
    }
    if(typeof actions.skyGate==='function'){
      const skyGateRow=document.createElement('div');
      skyGateRow.style.cssText='display:flex; gap:4px; margin-top:4px;';
      const b=document.createElement('button');
      b.textContent='Sky Gate';
      b.title='Teleport to the post-mole sky guardian gate';
      b.style.cssText='flex:1 1 0; min-width:0; font-size:11px; padding:3px 6px; border:1px solid rgba(168,215,255,.75);';
      b.addEventListener('click',()=>{
        const r=actions.skyGate();
        if(r===false){ msg('Sky Gate teleport failed'); return; }
        syncFromPos(r);
      });
      skyGateRow.appendChild(b);
      if(typeof actions.skyFight==='function'){
        const fightBtn=document.createElement('button');
        fightBtn.textContent='Sky fight';
        fightBtn.title='Teleport to the Sky Gate and awaken the air guardian';
        fightBtn.style.cssText='flex:1 1 0; min-width:0; font-size:11px; padding:3px 6px; border:1px solid rgba(255,231,122,.72);';
        fightBtn.addEventListener('click',()=>{
          const r=actions.skyFight();
          if(r===false){ msg('Sky fight start failed'); return; }
          syncFromPos(r);
        });
        skyGateRow.appendChild(fightBtn);
      }
      wrap.appendChild(skyGateRow);
    }
    if(typeof actions.center==='function'){
      const centerRow=document.createElement('div');
      centerRow.style.cssText='display:flex; gap:4px; margin-top:4px;';
      const b=document.createElement('button');
      b.textContent='Centrum';
      b.title='Teleport to the mirror obelisk at the world start (wakes the call)';
      b.style.cssText='flex:1 1 0; min-width:0; font-size:11px; padding:3px 6px; border:1px solid rgba(155,140,255,.75);';
      b.addEventListener('click',()=>{
        const r=actions.center();
        if(r===false){ msg('Centrum teleport failed'); return; }
        syncFromPos(r);
      });
      centerRow.appendChild(b);
      if(typeof actions.centerFight==='function'){
        const fightBtn=document.createElement('button');
        fightBtn.textContent='Mirror fight';
        fightBtn.title='Teleport to the obelisk and start the inner-self mirror battle';
        fightBtn.style.cssText='flex:1 1 0; min-width:0; font-size:11px; padding:3px 6px; border:1px solid rgba(232,229,210,.72);';
        fightBtn.addEventListener('click',()=>{
          const r=actions.centerFight();
          if(r===false){ msg('Mirror fight start failed'); return; }
          syncFromPos(r);
        });
        centerRow.appendChild(fightBtn);
      }
      wrap.appendChild(centerRow);
    }
    if(typeof actions.aftermath==='function'){
      const aftermathLab=document.createElement('div');
      aftermathLab.textContent='Aftermath (debug):';
      aftermathLab.style.cssText='font-size:11px; opacity:.68; margin-top:5px;';
      wrap.appendChild(aftermathLab);
      const aftermathRow=document.createElement('div');
      aftermathRow.style.cssText='display:flex; gap:4px; margin-top:3px;';
      [
        ['fire','Fire','rgba(255,120,50,.7)'],
        ['ice','Ice','rgba(130,220,255,.7)'],
        ['earth','Earth','rgba(196,107,255,.7)'],
        ['scars','Scars','rgba(121,201,93,.7)'],
        ['clear','Clear','rgba(255,255,255,.28)']
      ].forEach(([kind,label,border])=>{
        const b=document.createElement('button');
        b.textContent=label;
        b.title=kind==='clear' ? 'Clear the active guardian aftermath' : (kind==='scars' ? 'Force old aftermath scars around the hero' : 'Force '+label+' guardian aftermath near the hero');
        b.style.cssText='flex:1 1 0; min-width:0; font-size:11px; padding:3px 5px; border:1px solid '+border+';';
        b.addEventListener('click',()=>{
          const r=actions.aftermath(kind);
          if(r===false){ msg('Aftermath debug failed'); return; }
          syncFromPos(typeof actions.pos==='function' ? actions.pos() : null);
        });
        aftermathRow.appendChild(b);
      });
      wrap.appendChild(aftermathRow);
    }
    wrap.appendChild(readout);
    panel.appendChild(wrap);
    goBtn.addEventListener('click',()=>{
      const x=parseFloat(xIn.value);
      if(!isFinite(x)){ msg('Podaj współrzędną X'); return; }
      const yRaw=parseFloat(yIn.value);
      const r=(typeof actions.jump==='function') ? actions.jump(x, isFinite(yRaw)?yRaw:undefined) : null;
      if(r===false){ msg('Teleport nieudany'); return; }
      syncFromPos(r);
    });
    [xIn,yIn].forEach(i=> i.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); goBtn.click(); } }));
    syncFromPos();
  }
  function injectMobSpawnPanel(spawnCb, menuPanel, actions){
    const panel = menuPanel || document.getElementById('menuPanel');
    if(!panel) return;
    actions = actions || {};
    const mobBox=document.createElement('div'); mobBox.id='mobSpawnBox'; mobBox.style.cssText='display:flex; flex-wrap:wrap; gap:4px; margin-top:6px;';
    const label2=document.createElement('div'); label2.textContent='Spawn Moby:'; label2.style.cssText='width:100%; font-size:11px; opacity:.7;'; mobBox.appendChild(label2);
    const placeholder=document.createElement('div'); placeholder.textContent='(Ładowanie...)'; placeholder.style.cssText='font-size:11px; opacity:.5;'; mobBox.appendChild(placeholder);
    panel.appendChild(mobBox);
    function populate(){
      const box=document.getElementById('mobSpawnBox'); if(!box) return;
      while(box.children.length>1) box.removeChild(box.lastChild);
      // Prefer ESM mobs registry, fallback to legacy global
      const speciesList = (MOBS && MOBS.species) ? MOBS.species : ((window.MM && MM.mobs && MM.mobs.species) ? MM.mobs.species : null);
      if(!speciesList){
        const p=document.createElement('div'); p.textContent='(Brak systemu mobów)'; p.style.cssText='font-size:11px; opacity:.5;'; box.appendChild(p); return;
      }
      // ZLOTY has its own dedicated buttons below (forceSpawn would skip its form setup)
      speciesList.filter(id=>id!=='ZLOTY').forEach(id=>{
        const b=document.createElement('button'); b.textContent=id; b.style.cssText='flex:1 1 70px; font-size:11px; padding:3px 6px;';
        b.addEventListener('click',()=>{ try{ if(typeof spawnCb==='function') spawnCb(id); }catch(e){} });
        box.appendChild(b);
      });
      // Golden sprinter debug: summon a chosen form on demand (normally it
      // visits on its own once every ~7 in-game days)
      const goldLab=document.createElement('div'); goldLab.textContent='✨ Złoty sprinter (debug):'; goldLab.style.cssText='width:100%; font-size:11px; opacity:.7; margin-top:4px;';
      box.appendChild(goldLab);
      [['bird','🐦 Ptak'],['runner','🦌 Biegacz'],['mole','🐹 Kret'],[null,'✨ Losowy']].forEach(([form,label])=>{
        const b=document.createElement('button'); b.textContent=label; b.style.cssText='flex:1 1 70px; font-size:11px; padding:3px 6px; border:1px solid rgba(255,200,60,.6);';
        b.addEventListener('click',()=>{
          try{
            const M=(MOBS && MOBS.spawnGolden)? MOBS : (window.MM && MM.mobs);
            const ok=(M && M.spawnGolden)? M.spawnGolden(form): null;
            if(!ok) msg('Złoty sprinter już tu jest (limit 1)');
          }catch(e){}
        });
        box.appendChild(b);
      });
      // Ruin teleports: hop to the nearest ruin of a class, left or right
      const ruinLab=document.createElement('div'); ruinLab.textContent='🏛️ Ruiny — skocz do (debug):'; ruinLab.style.cssText='width:100%; font-size:11px; opacity:.7; margin-top:4px;';
      box.appendChild(ruinLab);
      const RUIN_KINDS=[[null,'Ruina'],['small','Krypta'],['medium','Piwnice'],['large','Świątynia'],['mega','Miasto 1%']];
      function tpRuin(dir,size,label){
        try{
          const R=window.MM && MM.ruins, WGl=window.MM && MM.worldGen, pl=window.player;
          if(!R || !R.nearest || !pl) return;
          const hit=R.nearest(pl.x, dir, size);
          if(!hit){ msg('Brak: '+label+' w tym kierunku (zasięg skanu)'); return; }
          pl.x=hit.x+0.5;
          pl.y=(WGl && WGl.surfaceHeight? WGl.surfaceHeight(Math.round(hit.x)) : pl.y)-2;
          pl.vx=0; pl.vy=0;
          msg('🏛️ '+label+' ('+hit.size+(hit.variant?'/'+hit.variant:'')+') @ x='+hit.x+' — kop pod znakami!');
        }catch(e){}
      }
      RUIN_KINDS.forEach(([size,label])=>{
        const row=document.createElement('div'); row.style.cssText='display:flex; gap:4px; flex:1 1 100%;';
        const bl=document.createElement('button'); bl.textContent='◀'; bl.title='Najbliższa w lewo: '+label;
        const mid=document.createElement('span'); mid.textContent=label; mid.style.cssText='flex:1; font-size:11px; text-align:center; align-self:center; opacity:.85;';
        const br=document.createElement('button'); br.textContent='▶'; br.title='Najbliższa w prawo: '+label;
        [bl,br].forEach(b=>{ b.style.cssText='flex:0 0 34px; font-size:11px; padding:3px 6px; border:1px solid rgba(200,180,140,.55);'; });
        bl.addEventListener('click',()=>tpRuin(-1,size,label));
        br.addEventListener('click',()=>tpRuin(1,size,label));
        row.appendChild(bl); row.appendChild(mid); row.appendChild(br);
        box.appendChild(row);
      });
      // Volcano debug: jump to the next seeded volcano without landing inside lava
      const volcanoLab=document.createElement('div'); volcanoLab.textContent='Wulkan - skocz do (debug):'; volcanoLab.style.cssText='width:100%; font-size:11px; opacity:.7; margin-top:4px;';
      box.appendChild(volcanoLab);
      const volcanoBtn=document.createElement('button'); volcanoBtn.id='nextVolcanoBtn'; volcanoBtn.textContent='Następny wulkan'; volcanoBtn.title='Teleportuj do następnego wulkanu po prawej';
      volcanoBtn.style.cssText='flex:1 1 100%; font-size:11px; padding:3px 6px; border:1px solid rgba(255,120,40,.65);';
      volcanoBtn.addEventListener('click',()=>{
        try{
          const hit=(typeof window.teleportHeroToNextVolcano==='function') ? window.teleportHeroToNextVolcano(1) : null;
          if(!hit) msg('Nie udało się znaleźć wulkanu');
        }catch(e){}
      });
      box.appendChild(volcanoBtn);
      const masterBtn=document.createElement('button'); masterBtn.id='volcanoMasterBtn'; masterBtn.textContent='Kamien mistrza (O)'; masterBtn.title='Debug: wyrzuc kamien mistrza z najblizszego wulkanu';
      masterBtn.style.cssText='flex:1 1 100%; font-size:11px; padding:3px 6px; border:1px solid rgba(90,255,240,.7);';
      masterBtn.addEventListener('click',()=>{
        try{
          const ok=(typeof window.forceVolcanoMasterStone==='function') ? window.forceVolcanoMasterStone() : null;
          if(!ok) msg('Nie udalo sie znalezc wulkanu');
        }catch(e){}
      });
      box.appendChild(masterBtn);
      const biomeLab=document.createElement('div'); biomeLab.textContent='Biom - skocz do (debug):'; biomeLab.style.cssText='width:100%; font-size:11px; opacity:.7; margin-top:4px;';
      box.appendChild(biomeLab);
      const BIOME_DEBUG_BUTTONS=[[0,'Las'],[1,'Rowniny'],[2,'Snieg'],[3,'Pustynia'],[4,'Bagno'],[5,'Morze'],[6,'Jezioro'],[7,'Gory'],[8,'Miasto']];
      function callBiomeTravel(id,dir,label){
        const fn=(typeof actions.biome==='function') ? actions.biome : (typeof window.teleportHeroToNearestBiome==='function' ? window.teleportHeroToNearestBiome : null);
        if(!fn){ msg('Teleport biomu niedostepny'); return null; }
        const hit=fn(id,dir);
        if(!hit) msg('Nie znaleziono biomu: '+label);
        return hit;
      }
      function callBiomeThreat(key,dir,label){
        const fn=(typeof actions.biomeThreat==='function') ? actions.biomeThreat : (typeof window.teleportHeroToBiomeThreat==='function' ? window.teleportHeroToBiomeThreat : null);
        if(!fn){ msg('Teleport zagrozenia niedostepny'); return null; }
        const hit=fn(key,dir);
        if(!hit) msg('Nie znaleziono zagrozenia: '+label);
        return hit;
      }
      function addDebugTravelRow(prefix,key,label,border,handler){
        const row=document.createElement('div');
        row.style.cssText='display:flex; gap:4px; flex:1 1 100%; min-width:0;';
        [[-1,'<','Left','poprzedni'],[0,label,'Near','najblizszy'],[1,'>','Right','nastepny']].forEach(([dir,text,suffix,title])=>{
          const b=document.createElement('button');
          b.id=prefix+suffix+'_'+key;
          b.textContent=text;
          b.title=title+': '+label;
          b.style.cssText=(dir===0
            ? 'flex:1 1 auto; min-width:0; white-space:normal; overflow-wrap:anywhere;'
            : 'flex:0 0 34px;')+'font-size:11px; padding:3px 6px; border:1px solid '+border+';';
          b.addEventListener('click',()=>{ try{ handler(dir); }catch(e){} });
          row.appendChild(b);
        });
        box.appendChild(row);
      }
      BIOME_DEBUG_BUTTONS.forEach(([id,label])=>{
        addDebugTravelRow('biomeDebug', id, label, 'rgba(90,180,255,.55)', (dir)=>callBiomeTravel(id,dir,label));
      });
      const threatLab=document.createElement('div'); threatLab.textContent='Biome threats - jump + spawn (debug):'; threatLab.style.cssText='width:100%; font-size:11px; opacity:.7; margin-top:4px;';
      box.appendChild(threatLab);
      const BIOME_THREAT_BUTTONS=[
        ['forest_bear','Forest bear'],
        ['forest_bramble','Forest bramble stalker'],
        ['forest_grass_trap','Forest grass trap'],
        ['forest_temple','Forest surface temple'],
        ['plains_bison','Plains thunder bison'],
        ['plains_grass_trap','Plains grass trap'],
        ['plains_zubr','Plains zubr charge'],
        ['snow_pack','Snow wolf pack'],
        ['snow_wraith','Snow ice wraith'],
        ['snow_golem','Snow stone golem'],
        ['snow_yeti','Snow jackpot yeti'],
        ['desert_worm','Desert sand worm'],
        ['desert_scorpion','Desert giant scorpion'],
        ['desert_sand_traps','Desert sand traps'],
        ['swamp_lurker','Swamp bog lurkers'],
        ['swamp_temple','Swamp surface temple'],
        ['sea_piranhas','Sea piranha swarm'],
        ['sea_shark','Sea shark'],
        ['sea_whale','Sea jackpot whale'],
        ['lake_eels','Lake eels'],
        ['lake_serpent','Lake serpent'],
        ['mountain_vulture','Mountain vulture nest'],
        ['mountain_golem','Mountain stone golem'],
        ['volcano_vulture','Volcano vulture nest'],
        ['city_sentinels','City robot sentinels'],
        ['city_atomic_bomb','City atomic bomb']
      ];
      BIOME_THREAT_BUTTONS.forEach(([key,label])=>{
        addDebugTravelRow('biomeThreat', key, label, 'rgba(255,155,95,.62)', (dir)=>callBiomeThreat(key,dir,label));
      });
      // UFO debug: summon the saucer on demand (normally it visits every 2-3 in-game days)
      const ufoLab=document.createElement('div'); ufoLab.textContent='🛸 UFO (debug):'; ufoLab.style.cssText='width:100%; font-size:11px; opacity:.7; margin-top:4px;';
      box.appendChild(ufoLab);
      [[null,'🛸 UFO'],['mob','🛸 na zwierzę'],['hero','🛸 na CIEBIE'],['boss','🛸 na bossa']].forEach(([prefer,label])=>{
        const b=document.createElement('button'); b.textContent=label; b.style.cssText='flex:1 1 70px; font-size:11px; padding:3px 6px; border:1px solid rgba(120,220,255,.6);';
        b.addEventListener('click',()=>{
          try{
            const U=window.MM && MM.ufo;
            const c=(U && U.forceSpawn)? U.forceSpawn(prefer? {prefer}: undefined) : null;
            if(!c) msg('Spodek już krąży nad światem (limit 1)');
          }catch(e){}
        });
        box.appendChild(b);
      });
      // Boss debug controls: summon one beside the hero / detonate the nearest heart
      const bossLab=document.createElement('div'); bossLab.textContent='Boss (debug):'; bossLab.style.cssText='width:100%; font-size:11px; opacity:.7; margin-top:4px;';
      box.appendChild(bossLab);
      const bossBtn=document.createElement('button'); bossBtn.textContent='👹 Boss'; bossBtn.style.cssText='flex:1 1 70px; font-size:11px; padding:3px 6px; border:1px solid rgba(255,80,100,.55);';
      bossBtn.addEventListener('click',()=>{
        try{
          const B=window.MM && MM.bosses; const pl=window.player;
          if(!B || !B.forceSpawn || !pl) return;
          // try both sides at growing offsets so a lake beside the hero can't block the button
          let m=null;
          const side=Math.random()<0.5?-1:1;
          for(const off of [side*14, -side*14, side*22, -side*22, side*30]){
            m=B.forceSpawn(null,{x:Math.round(pl.x+off)});
            if(m) break;
          }
          msg(m? ('Przyzwano bossa '+m.name+' ('+m.archetype+')') : 'Boss: nie udało się przyzwać (limit?)');
        }catch(e){}
      });
      box.appendChild(bossBtn);
      const killBtn=document.createElement('button'); killBtn.textContent='💀 Kill boss'; killBtn.style.cssText='flex:1 1 70px; font-size:11px; padding:3px 6px; border:1px solid rgba(255,80,100,.55);';
      killBtn.addEventListener('click',()=>{
        try{
          const B=window.MM && MM.bosses;
          if(!B || !B.killNearest) return;
          const name=B.killNearest();
          msg(name? ('Serce bossa '+name+' zdetonowane') : 'Brak bossów do zabicia');
        }catch(e){}
      });
      box.appendChild(killBtn);
      const guardianLab=document.createElement('div'); guardianLab.textContent='Guardians (debug):'; guardianLab.style.cssText='width:100%; font-size:11px; opacity:.7; margin-top:4px;';
      box.appendChild(guardianLab);
      [['fire','Fire gate'],['ice','Ice gate']].forEach(([kind,label])=>{
        const b=document.createElement('button'); b.textContent=label; b.style.cssText='flex:1 1 70px; font-size:11px; padding:3px 6px; border:1px solid rgba(130,220,255,.55);';
        b.addEventListener('click',()=>{
          try{
            const G=window.MM && (MM.guardianLairs || MM.guardians);
            if(!G || !G.forceAwaken) return;
            const ok=G.forceAwaken(kind);
            msg(ok? ('Przyzwano '+label) : 'Guardian: limit aktywnych spotkan?');
          }catch(e){}
        });
        box.appendChild(b);
      });
    }
    // Expose populate for any external triggers (keeps backward compatibility)
    api.populateMobSpawnButtons = populate;
    try{ window.__populateMobSpawnButtons = populate; }catch(e){}
    setTimeout(()=>{ populate(); },300);
    window.addEventListener('mm-mobs-ready',()=>{ populate(); });
  }
  function injectGasDebugPanel(actions, menuPanel){
    const panel = menuPanel || document.getElementById('menuPanel');
    if(!panel || document.getElementById('gasDebugBox')) return;
    actions = actions || {};
    const box=document.createElement('div');
    box.id='gasDebugBox';
    box.style.cssText='display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; border-top:1px solid rgba(255,255,255,.08); padding-top:6px;';
    const label=document.createElement('div');
    label.textContent='Gazy (debug):';
    label.style.cssText='width:100%; font-size:11px; opacity:.7;';
    box.appendChild(label);

    const powerRow=document.createElement('label');
    powerRow.style.cssText='width:100%; display:flex; align-items:center; gap:8px; font-size:11px; opacity:.85;';
    const powerText=document.createElement('span');
    powerText.textContent='Moc';
    const powerVal=document.createElement('span');
    powerVal.style.cssText='min-width:30px; text-align:right; opacity:.7;';
    const power=document.createElement('input');
    power.id='gasDebugPower';
    power.type='range';
    power.min='0.5';
    power.max='5';
    power.step='0.5';
    power.value=String(debugNumber('gas','power',2,0.5,5));
    power.style.cssText='flex:1; min-width:90px;';
    function readPower(){
      const n=parseFloat(power.value);
      return Number.isFinite(n) ? Math.max(0.5, Math.min(5, n)) : 2;
    }
    function refreshPower(){ powerVal.textContent=readPower().toFixed(1); }
    power.addEventListener('input',()=>{ refreshPower(); debugSet('gas','power',readPower()); });
    powerRow.appendChild(powerText);
    powerRow.appendChild(power);
    powerRow.appendChild(powerVal);
    box.appendChild(powerRow);

    const metrics=document.createElement('div');
    metrics.id='gasDebugMetrics';
    metrics.style.cssText='width:100%; font-size:10px; opacity:.68;';
    function refreshMetrics(){
      const m=(typeof actions.metrics==='function') ? actions.metrics() : null;
      metrics.textContent=m ? ('aktywne '+m.active+' | hot '+m.hot+' | para '+m.steam+' | trucizna '+m.poison+' | paliwo '+m.fuel) : 'brak metryk gazu';
    }
    const GAS_DEBUG_BUTTONS=[
      ['hot','Gorace','#f4b65e'],
      ['steam','Para','#dfe8ee'],
      ['poison','Trujacy','#82d45b'],
      ['fuel','Palny','#b1a36c']
    ];
    GAS_DEBUG_BUTTONS.forEach(([kind,txt,color])=>{
      const b=document.createElement('button');
      b.textContent=txt;
      b.title='Wygeneruj gaz: '+txt;
      b.style.cssText='flex:1 1 72px; font-size:11px; padding:3px 6px; border:1px solid '+color+'99;';
      b.addEventListener('click',()=>{
        try{
          const placed=(typeof actions.spawn==='function') ? actions.spawn(kind, readPower()) : 0;
          msg(placed ? ('Gaz '+txt+': +'+placed) : ('Gaz '+txt+': brak miejsca'));
          refreshMetrics();
        }catch(e){ msg('Debug gazu: blad'); }
      });
      box.appendChild(b);
    });
    const ignite=document.createElement('button');
    ignite.textContent='Podpal paliwo';
    ignite.title='Detonuje najblizszy gaz palny przy miejscu testu';
    ignite.style.cssText='flex:1 1 100%; font-size:11px; padding:3px 6px; border:1px solid rgba(255,110,40,.75);';
    ignite.addEventListener('click',()=>{
      try{
        const ok=(typeof actions.ignite==='function') ? actions.ignite(readPower()) : false;
        msg(ok ? 'Gaz palny: detonacja' : 'Brak gazu palnego w zasiegu');
        refreshMetrics();
      }catch(e){ msg('Debug gazu: blad detonacji'); }
    });
    box.appendChild(ignite);

    const clear=document.createElement('button');
    clear.textContent='Wyczysc gazy';
    clear.title='Usuwa aktywne gazy z widocznego swiata testowego';
    clear.style.cssText='flex:1 1 100%; font-size:11px; padding:3px 6px; border:1px solid rgba(180,220,255,.55);';
    clear.addEventListener('click',()=>{
      try{
        const n=(typeof actions.clear==='function') ? actions.clear() : 0;
        msg(n ? ('Usunieto gaz: '+n+' komorek') : 'Brak aktywnych gazow');
        refreshMetrics();
      }catch(e){ msg('Debug gazu: blad czyszczenia'); }
    });
    box.appendChild(clear);
    box.appendChild(metrics);
    refreshPower();
    refreshMetrics();
    const timer=setInterval(()=>{
      if(!document.body.contains(box)){ clearInterval(timer); return; }
      if(!panel.hidden) refreshMetrics();
    },1500);
    panel.appendChild(box);
  }

  // Carbon chain + SMR (engine/smr.js): hand out the industry kit, place a
  // reactor at the hero, force its inspection alarm, watch the loop metrics.
  function injectSmrDebugPanel(actions, menuPanel){
    const panel = menuPanel || document.getElementById('menuPanel');
    if(!panel || document.getElementById('smrDebugBox')) return;
    actions = actions || {};
    const box=document.createElement('div');
    box.id='smrDebugBox';
    box.style.cssText='display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; border-top:1px solid rgba(255,255,255,.08); padding-top:6px;';
    const label=document.createElement('div');
    label.textContent='Grafit i SMR (debug):';
    label.style.cssText='width:100%; font-size:11px; opacity:.7;';
    box.appendChild(label);
    const metrics=document.createElement('div');
    metrics.id='smrDebugMetrics';
    metrics.style.cssText='width:100%; font-size:10px; opacity:.68;';
    function refreshMetrics(){
      const m=(typeof actions.metrics==='function') ? actions.metrics() : null;
      metrics.textContent=m
        ? ('ogniwa '+m.cells+' (pracuje '+m.on+' | alarm '+m.alarms+' | wygasle '+m.off+') | energia '+m.energy
          +' | kontrole '+m.inspections+' | scram '+m.scrams+' | woda '+m.boiledTiles+' kafli -> para '+m.ventedCells+' kom. (obieg '+m.loop.steamPerWaterTile+':1)')
        : 'brak metryk SMR';
    }
    const SMR_DEBUG_BUTTONS=[
      ['kit','Daj zestaw wegla','#3d4048'],
      ['place','Postaw SMR','#4a6a58'],
      ['alarm','Wymus alarm','#ffbe40'],
      ['inspect','Skontroluj','#6eeb8c']
    ];
    SMR_DEBUG_BUTTONS.forEach(([act,txt,color])=>{
      const b=document.createElement('button');
      b.textContent=txt;
      b.title=act==='kit' ? 'Grafit, grafen, ogniwo SMR i materialy do receptury'
        : act==='place' ? 'Stawia ogniwo SMR obok bohatera'
        : act==='alarm' ? 'Najblizsze ogniwo natychmiast prosi o kontrole'
        : 'Kontroluje/wznawia najblizsze ogniwo';
      b.style.cssText='flex:1 1 100px; font-size:11px; padding:3px 6px; border:1px solid '+color+'99;';
      b.addEventListener('click',()=>{
        try{
          const ok=(typeof actions[act]==='function') ? actions[act]() : false;
          msg(ok ? ('SMR debug: '+txt) : ('SMR debug: '+txt+' — brak celu'));
          refreshMetrics();
        }catch(e){ msg('SMR debug: blad'); }
      });
      box.appendChild(b);
    });
    box.appendChild(metrics);
    refreshMetrics();
    const timer=setInterval(()=>{
      if(!document.body.contains(box)){ clearInterval(timer); return; }
      if(!panel.hidden) refreshMetrics();
    },1500);
    panel.appendChild(box);
  }

  // Nature-details wave (avalanche/icicles/thin_ice/geothermal/sky_moods/
  // weather_instruments/graffiti + mob nature drives): every feature gets a
  // one-click trigger here — the standing owner rule for new systems.
  function injectNatureDebugPanel(actions, menuPanel){
    const panel = menuPanel || document.getElementById('menuPanel');
    if(!panel || document.getElementById('natureDebugBox')) return;
    actions = actions || {};
    const box=document.createElement('div');
    box.id='natureDebugBox';
    box.style.cssText='display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; border-top:1px solid rgba(255,255,255,.08); padding-top:6px;';
    const label=document.createElement('div');
    label.textContent='Natura: lawiny, sople, lód, źródła, niebo (debug):';
    label.style.cssText='width:100%; font-size:11px; opacity:.7;';
    box.appendChild(label);
    const metrics=document.createElement('div');
    metrics.id='natureDebugMetrics';
    metrics.style.cssText='width:100%; font-size:10px; opacity:.68;';
    function refreshMetrics(){
      const m=(typeof actions.metrics==='function') ? actions.metrics() : null;
      metrics.textContent=m
        ? ('lawiny '+m.avalanche+' | sople '+m.icicles+' | tafle '+m.panes+' | zrodla '+m.pools
          +' | mgla '+Math.round((m.fog||0)*100)+'% | zorza '+Math.round((m.aurora||0)*100)+'%'
          +' | maszty '+m.rods+' (E '+m.rodEnergy+') | znaki '+m.marks
          +' | mob: pije '+m.nature.drinks+' czai '+m.nature.lurks+' ucieka '+m.nature.flees+' kapie '+m.nature.baths)
        : 'brak metryk natury';
    }
    const NATURE_DEBUG_BUTTONS=[
      ['slope','Usyp stok sniegu','#e9f2fc','Buduje glęboki zasnieżony stok obok bohatera'],
      ['avalanche','Wyzwol lawine','#cfe6ff','Wstrzasa najblizszym stokiem — glęboki snieg na zboczu rusza'],
      ['icicles','Zasiej sople','#c8e6f8','Wyrasta dojrzale sople na kazdym nawisie w poblizu'],
      ['dropIcicles','Strac sople','#9fc4dd','Wszystkie wiszace sople spadaja teraz'],
      ['freeze','Zamroz tafle','#cfe8f2','Skuwa cienkim lodem otwarta wode w poblizu'],
      ['spring','Zbuduj gorace zrodlo','#e8a04a','Basen + kamien + lawa pod spodem — grzeje organicznie'],
      ['fog','Nawiej mgle','#dfe7ec','Poranna mgla nadciaga i sama sie rozwiewa (ponow: znow)'],
      ['aurora','Rozpal zorze','#8de6b8','Zorza rozblyska i sama przygasa (ponow: znow)'],
      ['instruments','Daj instrumenty','#c8a860','Wiatrowskaz, piorunochron, sadza i material do receptur'],
      ['strikeRod','Piorun w maszt','#ffe27a','Uderza piorunem w najblizszy piorunochron (bankuje ladunek)'],
      ['nature','Wymus zachowania','#a8d7a8','Natychmiastowy przydzial wodopoju/ucieczki/kapieli stadom'],
      ['paint','Namaluj znak','#3a3d44','Stawia znak sadzy na najblizszej scianie przy bohaterze']
    ];
    NATURE_DEBUG_BUTTONS.forEach(([act,txt,color,tip])=>{
      const b=document.createElement('button');
      b.textContent=txt;
      b.title=tip;
      b.style.cssText='flex:1 1 100px; font-size:11px; padding:3px 6px; border:1px solid '+color+'99;';
      b.addEventListener('click',()=>{
        try{
          const ok=(typeof actions[act]==='function') ? actions[act]() : false;
          msg(ok!==false && ok!==0 ? ('Natura debug: '+txt) : ('Natura debug: '+txt+' — brak celu'));
          refreshMetrics();
        }catch(e){ msg('Natura debug: blad'); }
      });
      box.appendChild(b);
    });
    box.appendChild(metrics);
    refreshMetrics();
    const timer=setInterval(()=>{
      if(!document.body.contains(box)){ clearInterval(timer); return; }
      if(!panel.hidden) refreshMetrics();
    },1500);
    panel.appendChild(box);
  }

  // Soft drifts + drift gales (engine/soft_drifts.js): pour a drift belt around
  // the hero, force/stop a leaf or snow gale, clear the fluff ledger.
  function injectDriftDebugPanel(actions, menuPanel){
    const panel = menuPanel || document.getElementById('menuPanel');
    if(!panel || document.getElementById('driftDebugBox')) return;
    actions = actions || {};
    const box=document.createElement('div');
    box.id='driftDebugBox';
    box.style.cssText='display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; border-top:1px solid rgba(255,255,255,.08); padding-top:6px;';
    const label=document.createElement('div');
    label.textContent='Zaspy i zamiecie (debug):';
    label.style.cssText='width:100%; font-size:11px; opacity:.7;';
    box.appendChild(label);
    const metrics=document.createElement('div');
    metrics.id='driftDebugMetrics';
    metrics.style.cssText='width:100%; font-size:10px; opacity:.68;';
    function refreshMetrics(){
      const m=(typeof actions.metrics==='function') ? actions.metrics() : null;
      if(!m){ metrics.textContent='brak metryk zasp'; return; }
      const GALE_NAMES={snow:'sniezna', leaves:'lisciowa', sand:'piaskowa', soot:'sadzy'};
      const st=m.storm && m.storm.active
        ? ('zamiec '+(GALE_NAMES[m.storm.mat]||m.storm.mat)+' '+Math.round((m.storm.k||0)*100)+'%'+(m.storm.forced?' (wymuszona)':' (naturalna)'))
        : 'bez zamieci';
      metrics.textContent='komorki '+m.cells+' (snieg '+m.byMat.snow+' | liscie '+m.byMat.leaves+' | sadza '+m.byMat.soot+' | piasek '+(m.byMat.sand||0)+')'
        +' | kafle '+(m.minted.snow+m.minted.leaves+(m.minted.sand||0))+' | rozbicia '+m.bursts+' | '+st;
    }
    const DRIFT_GALE_BUTTONS=[
      ['snow','Zamiec sniezna','#cfe6ff'],
      ['leaves','Zamiec lisciowa','#d09a3c'],
      ['sand','Zamiec piaskowa','#d9c078'],
      ['soot','Zamiec sadzy','#3a3d44']
    ];
    DRIFT_GALE_BUTTONS.forEach(([mat,txt,color])=>{
      const b=document.createElement('button');
      b.textContent=txt;
      b.title='Wymus zamiec: wiatr niesie material i usypuje zaspy';
      b.style.cssText='flex:1 1 100px; font-size:11px; padding:3px 6px; border:1px solid '+color+'99;';
      b.addEventListener('click',()=>{
        try{
          const t=(typeof actions.gale==='function') ? actions.gale(mat) : null;
          msg(t ? ('Zamiec ('+txt+'): '+Math.round(t.duration)+' s') : 'Zamiec: nie wystartowala');
          refreshMetrics();
        }catch(e){ msg('Debug zamieci: blad'); }
      });
      box.appendChild(b);
    });
    const stop=document.createElement('button');
    stop.textContent='Stop zamieci';
    stop.title='Zatrzymuje wymuszona zamiec (naturalna trwa poki wieje wiatr)';
    stop.style.cssText='flex:1 1 100%; font-size:11px; padding:3px 6px; border:1px solid rgba(180,220,255,.55);';
    stop.addEventListener('click',()=>{
      try{
        const ok=(typeof actions.stopGale==='function') ? actions.stopGale() : false;
        msg(ok ? 'Zamiec zatrzymana' : 'Brak wymuszonej zamieci');
        refreshMetrics();
      }catch(e){ msg('Debug zamieci: blad stop'); }
    });
    box.appendChild(stop);
    const DRIFT_SEED_BUTTONS=[
      ['snow','Usyp snieg','#e9f2fc'],
      ['leaves','Usyp liscie','#b3812f'],
      ['soot','Usyp sadze','#3a3d44'],
      ['sand','Usyp piasek','#d9c078']
    ];
    DRIFT_SEED_BUTTONS.forEach(([mat,txt,color])=>{
      const b=document.createElement('button');
      b.textContent=txt;
      b.title='Usypuje pas zasp wokol bohatera (te same reguly co pogoda)';
      b.style.cssText='flex:1 1 84px; font-size:11px; padding:3px 6px; border:1px solid '+color+'99;';
      b.addEventListener('click',()=>{
        try{
          const n=(typeof actions.seed==='function') ? actions.seed(mat) : 0;
          msg(n ? ('Usypano ('+txt+'): '+n+' jednostek') : 'Brak miejsca na zaspy');
          refreshMetrics();
        }catch(e){ msg('Debug zasp: blad usypywania'); }
      });
      box.appendChild(b);
    });
    const clear=document.createElement('button');
    clear.textContent='Wyczysc zaspy';
    clear.title='Usuwa cale sypkie pokrycie (mintowane kafle zostaja)';
    clear.style.cssText='flex:1 1 100%; font-size:11px; padding:3px 6px; border:1px solid rgba(180,220,255,.55);';
    clear.addEventListener('click',()=>{
      try{
        const n=(typeof actions.clear==='function') ? actions.clear() : 0;
        msg(n ? ('Usunieto zaspy: '+n+' komorek') : 'Brak zasp do usuniecia');
        refreshMetrics();
      }catch(e){ msg('Debug zasp: blad czyszczenia'); }
    });
    box.appendChild(clear);
    box.appendChild(metrics);
    refreshMetrics();
    const timer=setInterval(()=>{
      if(!document.body.contains(box)){ clearInterval(timer); return; }
      if(!panel.hidden) refreshMetrics();
    },1500);
    panel.appendChild(box);
  }
  function injectInvasionDebugPanel(actions, menuPanel){
    const panel = menuPanel || document.getElementById('menuPanel');
    if(!panel || document.getElementById('invasionDebugBox')) return;
    actions = actions || {};
    const box=document.createElement('div');
    box.id='invasionDebugBox';
    box.style.cssText='display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; border-top:1px solid rgba(255,120,80,.12); padding-top:6px;';
    const label=document.createElement('div');
    label.textContent='Inwazje nocne (debug):';
    label.style.cssText='width:100%; font-size:11px; opacity:.7;';
    box.appendChild(label);
    const metrics=document.createElement('div');
    metrics.id='invasionDebugMetrics';
    metrics.style.cssText='width:100%; font-size:10px; opacity:.68;';
    function refreshMetrics(){
      const m=(typeof actions.metrics==='function') ? actions.metrics() : null;
      metrics.textContent=m ? ('teams '+m.activeTeams+'/'+m.teams+' | aliens '+(m.aliens||0)+' | molekin '+(m.molekin||0)+' | caches '+(m.caches||0)+' | lasers '+(m.lasers||0)) : 'brak metryk inwazji';
    }
    [
      ['alien','UFO team','Wymusza nocny alien team obok bohatera'],
      ['molekin','Kretoludzie','Wymusza podziemny atak kretoludzi']
    ].forEach(([id,txt,title])=>{
      const b=document.createElement('button');
      b.textContent=txt;
      b.title=title;
      b.style.cssText='flex:1 1 95px; font-size:11px; padding:3px 6px; border:1px solid '+(id==='molekin'?'rgba(255,120,50,.68)':'rgba(124,247,255,.65)')+';';
      b.addEventListener('click',()=>{
        try{
          const fn=id==='molekin' ? actions.molekin : actions.alien;
          const spawned=(typeof fn==='function') ? fn() : null;
          const n=Array.isArray(spawned) ? spawned.length : (spawned ? 1 : 0);
          msg(n ? (txt+': '+n+' team') : (txt+': nie przyzwano'));
          refreshMetrics();
        }catch(e){ msg('Debug inwazji: blad'); }
      });
      box.appendChild(b);
    });
    box.appendChild(metrics);
    refreshMetrics();
    const timer=setInterval(()=>{
      if(!document.body.contains(box)){ clearInterval(timer); return; }
      if(!panel.hidden) refreshMetrics();
    },1500);
    panel.appendChild(box);
  }
  function injectWindDebugPanel(actions, menuPanel){
    const panel = menuPanel || document.getElementById('menuPanel');
    if(!panel || document.getElementById('windDebugBox')) return;
    actions = actions || {};
    const box=document.createElement('div');
    box.id='windDebugBox';
    box.style.cssText='display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; border-top:1px solid rgba(210,235,255,.12); padding-top:6px;';
    const label=document.createElement('div');
    label.textContent='Wiatr (debug):';
    label.style.cssText='width:100%; font-size:11px; opacity:.7;';
    box.appendChild(label);
    const metrics=document.createElement('div');
    metrics.id='windDebugMetrics';
    metrics.style.cssText='width:100%; font-size:10px; opacity:.68;';
    function refreshMetrics(){
      const m=(typeof actions.metrics==='function') ? actions.metrics() : null;
      if(!m){ metrics.textContent='brak metryk wiatru'; return; }
      const ov=m.override==null ? 'naturalny' : ('wymuszony '+m.override);
      const prof=m.weatherProfile ? (' | profil '+m.weatherProfile) : '';
      const sq=m.squall && m.squall.active ? (' | szkwal '+m.squall.tLeft+'s') : '';
      metrics.textContent='v '+m.speed+' | '+ov+prof+' | sila '+m.intensity+' | czastki '+m.particles+'/'+m.particleCap+' | noc '+m.night+' | termika '+m.thermal+' | burza '+m.storm+sq;
    }
    const speedRow=document.createElement('label');
    speedRow.style.cssText='width:100%; display:flex; align-items:center; gap:8px; font-size:11px; opacity:.85;';
    const speedText=document.createElement('span');
    speedText.textContent='Moc/kier.';
    const speed=document.createElement('input');
    speed.id='windDebugSpeed';
    speed.type='range';
    speed.min='-7.2';
    speed.max='7.2';
    speed.step='0.1';
    speed.value=String(debugNumber('wind','speed',0,-7.2,7.2));
    speed.style.cssText='flex:1; min-width:92px;';
    const speedVal=document.createElement('span');
    speedVal.style.cssText='min-width:36px; text-align:right; opacity:.7;';
    function readSpeed(){
      const n=parseFloat(speed.value);
      return Number.isFinite(n) ? Math.max(-7.2, Math.min(7.2, n)) : 0;
    }
    function refreshSpeed(){ speedVal.textContent=readSpeed().toFixed(1); }
    speed.addEventListener('input',()=>{ refreshSpeed(); debugSet('wind','speed',readSpeed()); });
    function persistWindOverride(value){
      const v=Math.max(-7.2,Math.min(7.2,Number(value)||0));
      speed.value=String(v);
      refreshSpeed();
      debugSet('wind','mode','override');
      debugSet('wind','speed',readSpeed());
      debugSet('wind','profile',null);
    }
    function persistWindNatural(){
      debugSet('wind','mode','natural');
      debugSet('wind','profile',null);
    }
    function persistWindProfile(id){
      debugSet('wind','mode','profile');
      debugSet('wind','profile',id);
    }
    function applyStoredWindDebugSettings(){
      if(!debugHasSection('wind')) return;
      const saved=debugSection('wind');
      const mode=String(saved.mode||'natural');
      if(!debugHasKey('wind','mode')) return;
      if(mode==='override'){
        const v=debugNumber('wind','speed',0,-7.2,7.2);
        speed.value=String(v);
        refreshSpeed();
        if(actions.exact) actions.exact(v);
      } else if(mode==='profile' && saved.profile){
        if(actions.profile) actions.profile(saved.profile);
      } else if(mode==='natural'){
        if(actions.natural) actions.natural();
      }
    }
    speedRow.appendChild(speedText);
    speedRow.appendChild(speed);
    speedRow.appendChild(speedVal);
    box.appendChild(speedRow);
    const buttons=[
      ['calm','Cisza','Wymusza zerowy wiatr',()=>{ const ok=actions.calm && actions.calm(); if(ok) persistWindOverride(0); return ok; },'Wiatr: cisza'],
      ['exact','Ustaw','Wymusza dokladna moc i kierunek z suwaka',()=>{ const ok=actions.exact && actions.exact(readSpeed()); if(ok) persistWindOverride(readSpeed()); return ok; },'Wiatr: ustawiony '+readSpeed().toFixed(1)],
      ['breezeLeft','Bryza <-','Lekka bryza w lewo',()=>{ const ok=actions.breeze && actions.breeze(-1); if(ok) persistWindOverride(-1.35); return ok; },'Wiatr: bryza w lewo'],
      ['breezeRight','Bryza ->','Lekka bryza w prawo',()=>{ const ok=actions.breeze && actions.breeze(1); if(ok) persistWindOverride(1.35); return ok; },'Wiatr: bryza w prawo'],
      ['galeLeft','Wichura <-','Silny wiatr w lewo',()=>{ const ok=actions.gale && actions.gale(-1); if(ok) persistWindOverride(-6.4); return ok; },'Wiatr: wichura w lewo'],
      ['galeRight','Wichura ->','Silny wiatr w prawo',()=>{ const ok=actions.gale && actions.gale(1); if(ok) persistWindOverride(6.4); return ok; },'Wiatr: wichura w prawo'],
      ['squallLeft','Szkwal <-','Jednorazowy poryw w lewo',()=>actions.squall && actions.squall(-1),'Wiatr: szkwal w lewo'],
      ['squallRight','Szkwal ->','Jednorazowy poryw w prawo',()=>actions.squall && actions.squall(1),'Wiatr: szkwal w prawo'],
      ['storm','Burza + szkwal','Uruchamia burze i mocny poryw',()=>{ const p=actions.profile && actions.profile('storm'); const s=actions.storm && actions.storm(); if(p) persistWindProfile('storm'); return !!(p||s); },'Wiatr: burza i szkwal'],
      ['natural','Naturalnie','Wraca do modelu pogody',()=>{ const ok=actions.natural && actions.natural(); if(ok) persistWindNatural(); return ok; },'Wiatr: tryb naturalny']
    ];
    buttons.forEach(([id,txt,title,fn,okMsg])=>{
      const b=document.createElement('button');
      b.id='windDebug_'+id;
      b.textContent=txt;
      b.title=title;
      b.style.cssText='flex:1 1 78px; font-size:11px; padding:3px 6px; border:1px solid rgba(210,235,255,.58);';
      b.addEventListener('click',()=>{
        try{
          const ok=(typeof fn==='function') ? fn() : false;
          msg(ok ? okMsg : 'Debug wiatru: brak akcji');
          refreshMetrics();
        }catch(e){ msg('Debug wiatru: blad'); }
      });
      box.appendChild(b);
    });
    const profileLab=document.createElement('div');
    profileLab.textContent='Profile pogody:';
    profileLab.style.cssText='width:100%; font-size:11px; opacity:.7; margin-top:2px;';
    box.appendChild(profileLab);
    const profiles=[
      ['dayClear','Dzien czysty','Czyste poludnie: bazowy wiatr dzienny'],
      ['thermal','Termika','Slonce plus chmury: test termiki i porywow'],
      ['night','Noc','Noc: mocniejszy naturalny wiatr'],
      ['storm','Burza profil','Burza bez dodatkowego recznego szkwalu']
    ];
    profiles.forEach(([id,txt,title])=>{
      const b=document.createElement('button');
      b.id='windDebugProfile_'+id;
      b.textContent=txt;
      b.title=title;
      b.style.cssText='flex:1 1 88px; font-size:11px; padding:3px 6px; border:1px solid rgba(145,205,255,.58);';
      b.addEventListener('click',()=>{
        try{
          const ok=(typeof actions.profile==='function') ? actions.profile(id) : false;
          if(ok) persistWindProfile(id);
          msg(ok ? ('Wiatr: profil '+txt) : 'Debug wiatru: brak profilu');
          refreshMetrics();
        }catch(e){ msg('Debug wiatru: blad profilu'); }
      });
      box.appendChild(b);
    });
    box.appendChild(metrics);
    refreshSpeed();
    applyStoredWindDebugSettings();
    refreshMetrics();
    const timer=setInterval(()=>{
      if(!document.body.contains(box)){ clearInterval(timer); return; }
      if(!panel.hidden) refreshMetrics();
    },1500);
    panel.appendChild(box);
  }
  function injectDynamoDebugPanel(actions, menuPanel){
    const panel = menuPanel || document.getElementById('menuPanel');
    if(!panel || document.getElementById('dynamoDebugBox')) return;
    actions = actions || {};
    const box=document.createElement('div');
    box.id='dynamoDebugBox';
    box.style.cssText='display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; border-top:1px solid rgba(255,255,255,.08); padding-top:6px;';
    const label=document.createElement('div');
    label.textContent='Dynamo (debug):';
    label.style.cssText='width:100%; font-size:11px; opacity:.7;';
    box.appendChild(label);
    const metrics=document.createElement('div');
    metrics.id='dynamoDebugMetrics';
    metrics.style.cssText='width:100%; font-size:10px; opacity:.68;';
    function refreshMetrics(){
      const m=(typeof actions.metrics==='function') ? actions.metrics() : null;
      const h=(typeof actions.hero==='function') ? actions.hero() : null;
      const heroText=h ? (' | hero '+Math.round(h.energy)+'/'+Math.round(h.max)+' E') : '';
      metrics.textContent=m ? ('maszyny '+m.machines+' | aktywne '+m.active+' | '+m.currentPower+' E/s | suma '+m.storedEnergy+' E'+heroText) : 'brak metryk dynama';
    }
    const buttons=[
      ['give','Dynamo +1','Dodaje jedno dynamo do zasobow'],
      ['place','Postaw testowe','Stawia pelna 3-blokowa strukture przy bohaterze'],
      ['pulse','Impuls','Zasila najblizsze poprawne dynamo krotkim impulsem'],
      ['charge','Laduj dynamo','Dodaje duzy zapas energii do najblizszego dynama'],
      ['fillHero','Hero pelny','Laduje baterie bohatera do maksimum'],
      ['emptyHero','Hero pusty','Rozladowuje baterie bohatera']
    ];
    buttons.forEach(([id,txt,title])=>{
      const b=document.createElement('button');
      b.textContent=txt;
      b.title=title;
      b.style.cssText='flex:1 1 92px; font-size:11px; padding:3px 6px; border:1px solid rgba(255,210,74,.65);';
      b.addEventListener('click',()=>{
        try{
          const fn=actions[id];
          const ok=(typeof fn==='function') ? fn() : false;
          if(id==='give') msg(ok ? ('Dynamo +'+ok) : 'Nie dodano dynama');
          else if(id==='place') msg(ok ? 'Dynamo testowe postawione' : 'Brak miejsca na dynamo');
          else if(id==='charge') msg(ok ? 'Dynamo naladowane' : 'Brak dynama w poblizu');
          else if(id==='fillHero') msg(ok ? 'Hero naladowany' : 'Brak baterii bohatera');
          else if(id==='emptyHero') msg(ok ? 'Hero rozladowany' : 'Brak baterii bohatera');
          else msg(ok ? 'Dynamo: impuls energii' : 'Brak dynama w poblizu');
          refreshMetrics();
        }catch(e){ msg('Debug dynama: blad'); }
      });
      box.appendChild(b);
    });
    box.appendChild(metrics);
    refreshMetrics();
    const timer=setInterval(()=>{
      if(!document.body.contains(box)){ clearInterval(timer); return; }
      if(!panel.hidden) refreshMetrics();
    },1500);
    panel.appendChild(box);
  }
  function injectSeasonDebugPanel(actions, menuPanel){
    const panel = menuPanel || document.getElementById('menuPanel');
    if(!panel || document.getElementById('seasonDebugBox')) return;
    actions = actions || {};
    const box=document.createElement('div');
    box.id='seasonDebugBox';
    box.style.cssText='display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; border-top:1px solid rgba(160,210,255,.14); padding-top:6px;';
    const label=document.createElement('div');
    label.textContent='Pory roku (debug):';
    label.style.cssText='width:100%; font-size:11px; opacity:.7;';
    box.appendChild(label);
    const metrics=document.createElement('div');
    metrics.id='seasonDebugMetrics';
    metrics.style.cssText='width:100%; font-size:10px; opacity:.68;';
    const toggle=document.createElement('button');
    toggle.id='seasonDebugToggle';
    toggle.title='Wlacza lub wylacza sezonowe modyfikatory, skan terenu i zdarzenia';
    toggle.style.cssText='flex:1 1 100%; font-size:11px; padding:4px 6px; border:1px solid rgba(255,225,140,.7);';
    function applyStoredSeasonDebugSettings(){
      if(!debugHasSection('seasons')) return;
      const saved=debugSection('seasons');
      if(debugHasKey('seasons','forced') && saved.forced && saved.forced!=='natural'){
        if(actions.force) actions.force(saved.forced);
      } else if(debugHasKey('seasons','forced') && saved.forced==null){
        if(actions.natural) actions.natural();
      }
      if(debugHasKey('seasons','enabled') && typeof saved.enabled==='boolean' && actions.setEnabled) actions.setEnabled(saved.enabled);
    }
    function updateToggle(m){
      const on = !m || m.enabled !== false;
      toggle.textContent = on ? 'Sezony: ON' : 'Sezony: OFF';
      toggle.style.background = on ? '' : 'rgba(255,210,110,.14)';
    }
    toggle.addEventListener('click',()=>{
      try{
        const m=(typeof actions.metrics==='function') ? actions.metrics() : null;
        const on=!m || m.enabled !== false;
        const ok=(typeof actions.setEnabled==='function') ? actions.setEnabled(!on) : false;
        if(ok) debugSet('seasons','enabled',!on);
        msg(ok ? ('Pory roku: '+(!on?'ON':'OFF')) : 'Debug sezonow: brak przelacznika');
        refreshMetrics();
      }catch(e){ msg('Debug sezonow: blad przelacznika'); }
    });
    box.appendChild(toggle);
    function refreshMetrics(){
      const m=(typeof actions.metrics==='function') ? actions.metrics() : null;
      updateToggle(m);
      if(!m){ metrics.textContent='brak metryk sezonow'; return; }
      const scan=m.scan || {};
      const changed=scan.changed || {};
      const changes=['freeze','thaw','snow','snowMelt','leafGrow','leafDrop']
        .map(k=>changed[k]? (k+':'+changed[k]) : '')
        .filter(Boolean)
        .join(' ');
      const next=Number(m.nextInDays||0).toFixed(1);
      const blend=m.transition ? (' | blend '+Math.round(Number(m.blend||0)*100)+'%') : '';
      const evs=Array.isArray(m.events) ? m.events : [];
      const last=evs.length ? evs[evs.length-1].type : '';
      const daily=Number(m.diurnalTemperatureDelta||0);
      const scanState=scan.deferred ? (' odroczony'+(scan.deferReason?' '+scan.deferReason:'')) : '';
      metrics.textContent=m.label+' | dzien '+Number(m.dayFloat||m.day||1).toFixed(1)+' | next '+next+'d'+blend+' | temp '+Number(m.temperatureDelta||0).toFixed(2)+' dob '+(daily>=0?'+':'')+daily.toFixed(2)+' | wiatr x'+Number(m.windMult||1).toFixed(2)+' | zwierz x'+Number(m.animalSpawnMult||1).toFixed(2)+' | skan '+(scan.columns||0)+' kol, '+(scan.ops||0)+' zmian, lisc '+(scan.leafOps||0)+scanState+(changes?' | '+changes:'')+(last?' | '+last:'');
    }
    const buttons=[
      ['natural','Naturalnie','Wraca do naturalnego kalendarza'],
      ['spring','Wiosna','Wymusza wiosne'],
      ['summer','Lato','Wymusza lato'],
      ['autumn','Jesien','Wymusza jesien'],
      ['winter','Zima','Wymusza zime'],
      ['transition','Przejscie','Skacze do najblizszego naturalnego przejscia miedzy porami roku'],
      ['hallmark','Zwierze sezonu','Przywoluje duze zwierze-symbol aktualnej pory roku'],
      ['event','Zdarzenie sezonu','Uruchamia pogode/niebezpieczenstwo aktualnej pory roku'],
      ['springEvent','Wiosenny deszcz','Testuje wiosenny intensywny deszcz i lagodny wiatr'],
      ['summerEvent','Letnia burza','Testuje letnia burze z silnymi chmurami'],
      ['autumnEvent','Jesienny wichr','Testuje jesienna wichure'],
      ['winterEvent','Zimowa zamiec','Testuje zimowa zamiec'],
      ['scan','Skan teraz','Uruchamia natychmiastowy skan efektow sezonowych przy bohaterze'],
      ['day','+1 dzien','Przesuwa kalendarz o jeden dzien'],
      ['season','+sezon','Przesuwa kalendarz o pelne 10 dni']
    ];
    buttons.forEach(([id,txt,title])=>{
      const b=document.createElement('button');
      b.textContent=txt;
      b.title=title;
      b.style.cssText='flex:1 1 78px; font-size:11px; padding:3px 6px; border:1px solid rgba(160,210,255,.65);';
      b.addEventListener('click',()=>{
        try{
          let ok=false;
          if(id==='natural'){
            ok=(typeof actions.natural==='function') ? actions.natural() : false;
            if(ok) debugSet('seasons','forced',null);
          }
          else if(id==='transition') ok=(typeof actions.transition==='function') ? actions.transition() : false;
          else if(id==='hallmark') ok=(typeof actions.hallmark==='function') ? actions.hallmark() : false;
          else if(id==='event') ok=(typeof actions.event==='function') ? actions.event() : false;
          else if(id==='springEvent') ok=(typeof actions.event==='function') ? actions.event('spring') : false;
          else if(id==='summerEvent') ok=(typeof actions.event==='function') ? actions.event('summer') : false;
          else if(id==='autumnEvent') ok=(typeof actions.event==='function') ? actions.event('autumn') : false;
          else if(id==='winterEvent') ok=(typeof actions.event==='function') ? actions.event('winter') : false;
          else if(id==='scan') ok=(typeof actions.scan==='function') ? actions.scan() : false;
          else if(id==='day') ok=(typeof actions.advance==='function') ? actions.advance(1) : false;
          else if(id==='season') ok=(typeof actions.advance==='function') ? actions.advance(10) : false;
          else{
            ok=(typeof actions.force==='function') ? actions.force(id) : false;
            if(ok) debugSet('seasons','forced',id);
          }
          msg(ok ? ('Pora roku: '+txt) : 'Debug sezonow: brak akcji');
          refreshMetrics();
        }catch(e){ msg('Debug sezonow: blad'); }
      });
      box.appendChild(b);
    });
    box.appendChild(metrics);
    applyStoredSeasonDebugSettings();
    refreshMetrics();
    const timer=setInterval(()=>{
      if(!document.body.contains(box)){ clearInterval(timer); return; }
      if(!panel.hidden) refreshMetrics();
    },1500);
    panel.appendChild(box);
  }
  function injectMeteorDebugPanel(actions, menuPanel){
    const panel = menuPanel || document.getElementById('menuPanel');
    if(!panel || document.getElementById('meteorDebugBox')) return;
    actions = actions || {};
    const box=document.createElement('div');
    box.id='meteorDebugBox';
    box.style.cssText='display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; border-top:1px solid rgba(255,130,80,.16); padding-top:6px;';
    const label=document.createElement('div');
    label.textContent='Meteoryty (debug):';
    label.style.cssText='width:100%; font-size:11px; opacity:.7;';
    box.appendChild(label);
    const metrics=document.createElement('div');
    metrics.id='meteorDebugMetrics';
    metrics.style.cssText='width:100%; font-size:10px; opacity:.68;';
    const toggle=document.createElement('button');
    toggle.id='meteorDebugToggle';
    toggle.title='Wlacza lub wylacza naturalne losowe spadki meteorytow';
    toggle.style.cssText='flex:1 1 100%; font-size:11px; padding:4px 6px; border:1px solid rgba(255,154,92,.72);';
    function updateToggle(m){
      const on=!!(m && m.enabled);
      toggle.textContent=on ? 'Meteoryty: ON' : 'Meteoryty: OFF';
      toggle.style.background=on ? 'rgba(255,120,45,.18)' : '';
    }
    function refreshMetrics(){
      const m=(typeof actions.metrics==='function') ? actions.metrics() : null;
      updateToggle(m);
      if(!m){ metrics.textContent='brak metryk meteorytow'; return; }
      const fx=(m.embers||0)+(m.debris||0)+(m.plumes||0)+(m.beaconWaves||0)+(m.gravityBursts||0)+(m.sirenPulses||0);
      const days=Number.isFinite(m.nextInDays) ? Number(m.nextInDays).toFixed(2)+'d' : Number(m.nextIn||0).toFixed(0)+'s';
      const cls=(m.lastImpact && m.lastImpact.label) ? (' | last '+m.lastImpact.label) : '';
      const cons=m.lastConsequence ? (' | skutki '+m.lastConsequence.site+':'+(m.lastConsequence.severity||1)) : '';
      metrics.textContent=(m.enabled?'ON':'OFF')+' | next '+days+' | lot '+(m.meteors||0)+' | krater job '+(m.terrainJobs||0)+' q'+(m.queuedOps||0)+' | kr '+(m.craters||0)+' jez '+(m.lakeCraters||0)+' | syreny '+(m.sirens||0)+' | fx '+fx+' | impakty '+(m.impacts||0)+' | odchylenia '+(m.deflections||0)+cls+cons;
    }
    toggle.addEventListener('click',()=>{
      try{
        const m=(typeof actions.metrics==='function') ? actions.metrics() : null;
        const on=!!(m && m.enabled);
        const ok=(typeof actions.setEnabled==='function') ? actions.setEnabled(!on) : false;
        msg(ok ? ('Meteoryty: '+(!on?'ON':'OFF')) : 'Debug meteorytow: brak przelacznika');
        refreshMetrics();
      }catch(e){ msg('Debug meteorytow: blad przelacznika'); }
    });
    box.appendChild(toggle);
    const buttons=[
      ['spawn','Meteoryt teraz','Natychmiast spuszcza meteoryt niedaleko bohatera'],
      ['iron','Zelazny','Spuszcza meteoryt zelazny'],
      ['iridium','Irydowy','Spuszcza meteoryt irydowy'],
      ['ice','Lodowy','Spuszcza meteoryt lodowy'],
      ['radioactive','Radioaktywny','Spuszcza meteoryt radioaktywny'],
      ['antimatter','Antymateria','Spuszcza meteoryt antymaterialny'],
      ['biological','Biologiczny','Spuszcza meteoryt biologiczny'],
      ['beacon','Postaw beacon','Stawia beacon antygrawitacyjny do testowania odchylania meteorytow'],
      ['siren','Postaw syrene','Stawia syrene meteorytowa do testowania ostrzezen'],
      ['scan','Skan krateru','Skanuje najblizszy znany krater meteorytowy'],
      ['natural','Reset licznika','Losuje nowy czas do nastepnego naturalnego spadku'],
      ['clear','Wyczysc FX','Usuwa aktywne meteory i efekty bez cofania juz zrobionego krateru']
    ];
    buttons.forEach(([id,txt,title])=>{
      const b=document.createElement('button');
      b.id='meteorDebug_'+id;
      b.textContent=txt;
      b.title=title;
      b.style.cssText='flex:1 1 86px; font-size:11px; padding:3px 6px; border:1px solid rgba(255,154,92,.62);';
      b.addEventListener('click',()=>{
        try{
          let ok=false;
          if(id==='spawn') ok=(typeof actions.spawn==='function') ? actions.spawn() : false;
          else if(['iron','iridium','ice','radioactive','antimatter','biological'].includes(id)) ok=(typeof actions.spawnClass==='function') ? actions.spawnClass(id) : false;
          else if(id==='beacon') ok=(typeof actions.beacon==='function') ? actions.beacon() : false;
          else if(id==='siren') ok=(typeof actions.siren==='function') ? actions.siren() : false;
          else if(id==='scan') ok=(typeof actions.scan==='function') ? actions.scan() : false;
          else if(id==='natural') ok=(typeof actions.roll==='function') ? actions.roll() : false;
          else if(id==='clear') ok=(typeof actions.clear==='function') ? actions.clear() : false;
          msg(ok ? ('Meteoryty: '+txt) : 'Debug meteorytow: brak akcji');
          refreshMetrics();
        }catch(e){ msg('Debug meteorytow: blad'); }
      });
      box.appendChild(b);
    });
    box.appendChild(metrics);
    refreshMetrics();
    const timer=setInterval(()=>{
      if(!document.body.contains(box)){ clearInterval(timer); return; }
      if(!panel.hidden) refreshMetrics();
    },1200);
    panel.appendChild(box);
  }
  function injectSolarDebugPanel(actions, menuPanel){
    const panel = menuPanel || document.getElementById('menuPanel');
    if(!panel || document.getElementById('solarDebugBox')) return;
    actions = actions || {};
    const box=document.createElement('div');
    box.id='solarDebugBox';
    box.style.cssText='display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; border-top:1px solid rgba(95,247,220,.12); padding-top:6px;';
    const label=document.createElement('div');
    label.textContent='Solar (debug):';
    label.style.cssText='width:100%; font-size:11px; opacity:.7;';
    box.appendChild(label);
    const metrics=document.createElement('div');
    metrics.id='solarDebugMetrics';
    metrics.style.cssText='width:100%; font-size:10px; opacity:.68;';
    function refreshMetrics(){
      const m=(typeof actions.metrics==='function') ? actions.metrics() : null;
      metrics.textContent=m ? ('panele '+m.cells+' | aktywne '+m.active+' | '+m.currentPower+' E/s | suma '+m.storedEnergy+' E | slonce '+Math.round((m.sun||0)*100)+'%') : 'brak metryk solara';
    }
    const buttons=[
      ['placePanel','Panel','Stawia zwykly panel sloneczny obok bohatera'],
      ['placeBattery','Panel bateria','Stawia panel sloneczny z bateria obok bohatera'],
      ['placeRig','Uklad testowy','Stawia panel z bateria, przewod i teleporter'],
      ['charge','Laduj solar','Laduje najblizszy panel z bateria'],
      ['empty','Rozladuj solar','Rozladowuje najblizszy panel solarny']
    ];
    buttons.forEach(([id,txt,title])=>{
      const b=document.createElement('button');
      b.textContent=txt;
      b.title=title;
      b.style.cssText='flex:1 1 96px; font-size:11px; padding:3px 6px; border:1px solid rgba(95,247,220,.65);';
      b.addEventListener('click',()=>{
        try{
          const fn=actions[id];
          const ok=(typeof fn==='function') ? fn() : false;
          if(id==='placePanel') msg(ok ? 'Panel solarny postawiony' : 'Brak miejsca na panel');
          else if(id==='placeBattery') msg(ok ? 'Panel z bateria postawiony' : 'Brak miejsca na panel');
          else if(id==='placeRig') msg(ok ? 'Solar testowy postawiony' : 'Brak miejsca na uklad');
          else if(id==='charge') msg(ok ? 'Solar naladowany' : 'Brak solara w poblizu');
          else if(id==='empty') msg(ok ? 'Solar rozladowany' : 'Brak solara w poblizu');
          refreshMetrics();
        }catch(e){ msg('Debug solara: blad'); }
      });
      box.appendChild(b);
    });
    box.appendChild(metrics);
    refreshMetrics();
    const timer=setInterval(()=>{
      if(!document.body.contains(box)){ clearInterval(timer); return; }
      if(!panel.hidden) refreshMetrics();
    },1500);
    panel.appendChild(box);
  }
  function injectTeleporterDebugPanel(actions, menuPanel){
    const panel = menuPanel || document.getElementById('menuPanel');
    if(!panel || document.getElementById('teleporterDebugBox')) return;
    actions = actions || {};
    const box=document.createElement('div');
    box.id='teleporterDebugBox';
    box.style.cssText='display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; border-top:1px solid rgba(124,247,255,.12); padding-top:6px;';
    const label=document.createElement('div');
    label.textContent='Teleportery (debug):';
    label.style.cssText='width:100%; font-size:11px; opacity:.7;';
    box.appendChild(label);
    const metrics=document.createElement('div');
    metrics.id='teleporterDebugMetrics';
    metrics.style.cssText='width:100%; font-size:10px; opacity:.68;';
    function refreshMetrics(){
      const m=(typeof actions.metrics==='function') ? actions.metrics() : null;
      const h=(typeof actions.hero==='function') ? actions.hero() : null;
      const heroText=h ? (' | hero '+Math.round(h.energy)+'/'+Math.round(h.max)+' E') : '';
      metrics.textContent=m ? ('maszyny '+m.machines+' | naladowane '+m.charged+' | suma '+m.storedEnergy+' E'+heroText) : 'brak metryk teleportera';
    }
    const buttons=[
      ['giveTeleporter','Teleporter +1','Dodaje jeden teleporter do zasobow'],
      ['giveCable','Przewod +20','Dodaje miedziane przewody zasilania'],
      ['placeOne','Postaw jeden','Stawia pojedynczy teleporter obok bohatera'],
      ['placePair','Postaw pare','Stawia dwa naladowane teleportery po bokach bohatera'],
      ['jumpLeft','Skocz w lewo','Przenosi bohatera do najblizszego teleportera po lewej'],
      ['jumpRight','Skocz w prawo','Przenosi bohatera do najblizszego teleportera po prawej'],
      ['charge','Laduj najblizszy','Laduje najblizszy teleporter'],
      ['empty','Rozladuj najblizszy','Rozladowuje najblizszy teleporter']
    ];
    buttons.forEach(([id,txt,title])=>{
      const b=document.createElement('button');
      b.textContent=txt;
      b.title=title;
      b.style.cssText='flex:1 1 102px; font-size:11px; padding:3px 6px; border:1px solid rgba(124,247,255,.65);';
      b.addEventListener('click',()=>{
        try{
          const fn=actions[id];
          const ok=(typeof fn==='function') ? fn() : false;
          if(id==='giveTeleporter') msg(ok ? ('Teleporter +'+ok) : 'Nie dodano teleportera');
          else if(id==='giveCable') msg(ok ? ('Przewod +'+ok) : 'Nie dodano przewodu');
          else if(id==='placeOne') msg(ok ? 'Teleporter postawiony' : 'Brak miejsca na teleporter');
          else if(id==='placePair') msg(ok ? 'Para teleporterow postawiona' : 'Brak miejsca na pare teleporterow');
          else if(id==='jumpLeft') msg(ok ? 'Skok do teleportera po lewej' : 'Brak teleportera po lewej');
          else if(id==='jumpRight') msg(ok ? 'Skok do teleportera po prawej' : 'Brak teleportera po prawej');
          else if(id==='charge') msg(ok ? 'Teleporter naladowany' : 'Brak teleportera w poblizu');
          else if(id==='empty') msg(ok ? 'Teleporter rozladowany' : 'Brak teleportera w poblizu');
          refreshMetrics();
        }catch(e){ msg('Debug teleportera: blad'); }
      });
      box.appendChild(b);
    });
    box.appendChild(metrics);
    refreshMetrics();
    const timer=setInterval(()=>{
      if(!document.body.contains(box)){ clearInterval(timer); return; }
      if(!panel.hidden) refreshMetrics();
    },1500);
    panel.appendChild(box);
  }
  function injectTurretDebugPanel(actions, menuPanel){
    const panel = menuPanel || document.getElementById('menuPanel');
    if(!panel || document.getElementById('turretDebugBox')) return;
    actions = actions || {};
    const box=document.createElement('div');
    box.id='turretDebugBox';
    box.style.cssText='display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; border-top:1px solid rgba(160,190,230,.13); padding-top:6px;';
    const label=document.createElement('div');
    label.textContent='Wiezyczki (debug):';
    label.style.cssText='width:100%; font-size:11px; opacity:.7;';
    box.appendChild(label);
    const metrics=document.createElement('div');
    metrics.id='turretDebugMetrics';
    metrics.style.cssText='width:100%; font-size:10px; opacity:.68;';
    function refreshMetrics(){
      const m=(typeof actions.metrics==='function') ? actions.metrics() : null;
      metrics.textContent=m ? ('maszyny '+m.machines+' | aktywne '+m.active+' | naladowane '+m.charged+' | suma '+m.storedEnergy+' E | strzaly '+m.shots+' | fx '+m.effects) : 'brak metryk wiezyczek';
    }
    const buttons=[
      ['give','Wiezyczki +3','Dodaje zwykla, ogniowa i wodna wiezyczke do zasobow'],
      ['place','Postaw zwykla','Stawia naladowana zwykla wiezyczke obok bohatera'],
      ['placeFire','Postaw ogniowa','Stawia naladowana wiezyczke ogniowa obok bohatera'],
      ['placeWater','Postaw wodna','Stawia naladowana wiezyczke wodna obok bohatera'],
      ['placeRig','Uklad testowy','Stawia dynamo, przewody i naladowana wiezyczke'],
      ['charge','Laduj najblizsza','Laduje najblizsza wiezyczke'],
      ['empty','Rozladuj najblizsza','Rozladowuje najblizsza wiezyczke']
    ];
    buttons.forEach(([id,txt,title])=>{
      const b=document.createElement('button');
      b.textContent=txt;
      b.title=title;
      b.style.cssText='flex:1 1 104px; font-size:11px; padding:3px 6px; border:1px solid rgba(160,190,230,.65);';
      b.addEventListener('click',()=>{
        try{
          const fn=actions[id];
          const ok=(typeof fn==='function') ? fn() : false;
          if(id==='give') msg(ok ? 'Wiezyczki +3' : 'Nie dodano wiezyczek');
          else if(id==='place') msg(ok ? 'Wiezyczka postawiona' : 'Brak miejsca na wiezyczke');
          else if(id==='placeFire') msg(ok ? 'Wiezyczka ogniowa postawiona' : 'Brak miejsca na wiezyczke');
          else if(id==='placeWater') msg(ok ? 'Wiezyczka wodna postawiona' : 'Brak miejsca na wiezyczke');
          else if(id==='placeRig') msg(ok ? 'Uklad wiezyczki postawiony' : 'Brak miejsca na uklad');
          else if(id==='charge') msg(ok ? 'Wiezyczka naladowana' : 'Brak wiezyczki w poblizu');
          else if(id==='empty') msg(ok ? 'Wiezyczka rozladowana' : 'Brak wiezyczki w poblizu');
          refreshMetrics();
        }catch(e){ msg('Debug wiezyczek: blad'); }
      });
      box.appendChild(b);
    });
    box.appendChild(metrics);
    refreshMetrics();
    const timer=setInterval(()=>{
      if(!document.body.contains(box)){ clearInterval(timer); return; }
      if(!panel.hidden) refreshMetrics();
    },1200);
    panel.appendChild(box);
  }
  function injectSpringPlatformDebugPanel(actions, menuPanel){
    const panel = menuPanel || document.getElementById('menuPanel');
    if(!panel || document.getElementById('springPlatformDebugBox')) return;
    actions = actions || {};
    const box=document.createElement('div');
    box.id='springPlatformDebugBox';
    box.style.cssText='display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; border-top:1px solid rgba(124,199,216,.14); padding-top:6px;';
    const label=document.createElement('div');
    label.textContent='Platformy sprezynowe (debug):';
    label.style.cssText='width:100%; font-size:11px; opacity:.7;';
    box.appendChild(label);
    const metrics=document.createElement('div');
    metrics.id='springPlatformDebugMetrics';
    metrics.style.cssText='width:100%; font-size:10px; opacity:.68;';
    function refreshMetrics(){
      const m=(typeof actions.metrics==='function') ? actions.metrics() : null;
      metrics.textContent=m ? ('platformy '+m.machines+' | naladowane '+m.charged+' | suma '+m.storedEnergy+' E | skoki '+m.launches+' | pelne '+m.poweredLaunches+' | slabe '+m.unpoweredLaunches) : 'brak metryk platform';
    }
    const buttons=[
      ['give','Platformy +','Dodaje platformy sprezynowe i przewody do zasobow'],
      ['place','Postaw naladowana','Stawia naladowana platforme obok bohatera'],
      ['placeRig','Uklad testowy','Stawia dynamo, przewody i naladowana platforme'],
      ['charge','Laduj najblizsza','Laduje najblizsza platforme'],
      ['empty','Rozladuj najblizsza','Rozladowuje najblizsza platforme']
    ];
    buttons.forEach(([id,txt,title])=>{
      const b=document.createElement('button');
      b.textContent=txt;
      b.title=title;
      b.style.cssText='flex:1 1 108px; font-size:11px; padding:3px 6px; border:1px solid rgba(124,199,216,.68);';
      b.addEventListener('click',()=>{
        try{
          const fn=actions[id];
          const ok=(typeof fn==='function') ? fn() : false;
          if(id==='give') msg(ok ? ('Platformy +'+ok) : 'Nie dodano platform');
          else if(id==='place') msg(ok ? 'Platforma postawiona' : 'Brak miejsca na platforme');
          else if(id==='placeRig') msg(ok ? 'Uklad platformy postawiony' : 'Brak miejsca na uklad');
          else if(id==='charge') msg(ok ? 'Platforma naladowana' : 'Brak platformy w poblizu');
          else if(id==='empty') msg(ok ? 'Platforma rozladowana' : 'Brak platformy w poblizu');
          refreshMetrics();
        }catch(e){ msg('Debug platformy: blad'); }
      });
      box.appendChild(b);
    });
    box.appendChild(metrics);
    refreshMetrics();
    const timer=setInterval(()=>{
      if(!document.body.contains(box)){ clearInterval(timer); return; }
      if(!panel.hidden) refreshMetrics();
    },1200);
    panel.appendChild(box);
  }
  function injectMechDebugPanel(actions, menuPanel){
    const panel = menuPanel || document.getElementById('menuPanel');
    if(!panel || document.getElementById('mechDebugBox')) return;
    actions = actions || {};
    const box=document.createElement('div');
    box.id='mechDebugBox';
    box.style.cssText='display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; border-top:1px solid rgba(118,236,255,.16); padding-top:6px;';
    const label=document.createElement('div');
    label.textContent='Mechy (debug):';
    label.style.cssText='width:100%; font-size:11px; opacity:.7;';
    box.appendChild(label);
    const metrics=document.createElement('div');
    metrics.id='mechDebugMetrics';
    metrics.style.cssText='width:100%; min-height:30px; font-size:10px; line-height:1.35; opacity:.72;';
    function fmt(v){ return Number.isFinite(v) ? Math.round(v) : '-'; }
    function refreshMetrics(){
      const m=(typeof actions.metrics==='function') ? actions.metrics() : null;
      if(!m){ metrics.textContent='brak metryk mecha'; return; }
      let text='mechy '+(m.count||0)+' | piloci '+(m.pilots||0)+' | puste '+(m.abandoned||0)+' | jazda '+(m.ridden?'tak':'nie')+' | wieze '+(m.mountedTurrets||0)+' (zasil '+(m.poweredTurrets||0)+')';
      const f=m.focus;
      if(f){
        text+=' | bliski '+(f.kind||'?')+' hp '+fmt(f.hp)+'/'+fmt(f.maxHp)+' pilot '+(f.pilotAlive?'zyje':'brak')+' '+fmt(f.pilot)+'/'+fmt(f.pilotMax);
        text+=' E '+fmt(f.energy)+'/'+fmt(f.maxEnergy)+' F '+fmt(f.fuel)+'/'+fmt(f.maxFuel)+' obwod '+(f.trackCircuit?'tak':'brak');
        if(f.hasTurret) text+=' dzialo '+(f.turretCircuit?'zasilone':'martwe');
        text+=' blok '+fmt(f.blocked)+' skoki '+fmt(f.jumps);
      }
      metrics.textContent=text;
    }
    function run(id, okText, failText){
      try{
        const fn=actions[id];
        const ok=(typeof fn==='function') ? fn() : false;
        refreshMetrics();
        msg(ok===false ? failText : okText);
      }catch(e){
        console.error(e);
        refreshMetrics();
        msg('Debug mecha: blad');
      }
    }
    const buttons=[
      ['zoneLeft','<- 6km snieg','Skocz do lewej strefy solar-mechow','Mech: lewa strefa','Mech: nie udalo sie skoczyc'],
      ['zoneRight','6km ogien ->','Skocz do prawej strefy forge-mechow','Mech: prawa strefa','Mech: nie udalo sie skoczyc'],
      ['procLeft','Strefa <-','Wymusza prawdziwy spawn prototypu w lewej strefie 5000m+','Strefowy solar-mech utworzony','Nie znaleziono wolnej lewej strefy'],
      ['procRight','Strefa ->','Wymusza prawdziwy spawn prototypu w prawej strefie 5000m+','Strefowy forge-mech utworzony','Nie znaleziono wolnej prawej strefy'],
      ['spawnSolar','Spawn solar','Wymusza solar-mecha przy graczu','Mech solarny przyzwany','Brak miejsca na solar-mecha'],
      ['spawnForge','Spawn forge','Wymusza forge-mecha przy graczu','Forge-mech przyzwany','Brak miejsca na forge-mecha'],
      ['spawnCrawler','Spawn gasienice','Wymusza forge crawlera z 3-blokowa realna gasienica TRACK','Crawler przyzwany','Brak miejsca na crawlera'],
      ['killPilot','Pilot KO','Pokonuje pilota bez niszczenia kadluba','Pilot pokonany','Brak pilota do pokonania'],
      ['board','Wsiadz/wyjdz','Przejmuje pustego mecha albo z niego wysiada','Przelaczono jazde mechem','Najpierw pokonaj pilota'],
      ['capture','Przejmij','Pokonuje pilota i od razu wsiada','Mech przejety','Nie udalo sie przejac mecha'],
      ['driveLeft','Krok <-','Symuluje lewy krok gracza w przejetym mechu','Mech ruszyl w lewo','Brak jazdy albo energii'],
      ['driveRight','Krok ->','Symuluje prawy krok gracza w przejetym mechu','Mech ruszyl w prawo','Brak jazdy albo energii'],
      ['jumpTest','Skok','Symuluje skok gracza w przejetym mechu','Mech wykonal skok','Brak jazdy, gruntu albo energii'],
      ['fillPower','Energia max','Laduje baterie mecha','Energia mecha pelna','Brak mecha do ladowania'],
      ['emptyPower','Energia 0','Rozladowuje baterie mecha','Energia mecha wyzerowana','Brak mecha do rozladowania'],
      ['powerRig','Zasil rig','Stawia realny lokalny rig zasilania dla przejetego mecha','Rig zasilania gotowy','Nie ustawiono zasilania'],
      ['shield','Pancerz','Testuje pochloniecie obrazen bohatera przez pancerz mecha','Pancerz pochlonal obrazenia','Najpierw przejmij mecha'],
      ['damage','Uszkodz','Zadaje kontrolowane obrazenia kadlubowi','Mech uszkodzony','Brak mecha do uszkodzenia'],
      ['fireHit','Ogien','Testuje promien ognia na kadlubie','Mech trafiony ogniem','Brak mecha do trafienia'],
      ['waterHit','Woda','Testuje strumien wody na kadlubie','Mech trafiony woda','Brak mecha do trafienia'],
      ['destroy','Zniszcz','Niszczy kadlub i testuje drop czesci','Mech zniszczony','Brak mecha do zniszczenia'],
      ['wall','Sciana','Buduje sciane/dom przed hostylnym mechem','Sciana testowa gotowa','Nie ustawiono sciany'],
      ['trees','Drzewa','Stawia drzewa na trasie kroku','Drzewa testowe gotowe','Nie ustawiono drzew'],
      ['pit','Dol','Buduje test dolu, przeskoku i wyjscia','Dol testowy gotowy','Nie ustawiono dolu'],
      ['mob','Mob','Spawnuje moba przy mech-kolizji','Mob przy mech-kolizji','Nie przyzwano moba'],
      ['saveLoad','Save/load','Snapshot i restore stanu mecha','Mech save/load OK','Mech save/load nie przeszedl'],
      ['reset','Reset','Usuwa wszystkie mechy','Mechy zresetowane','Nie zresetowano mechow']
    ];
    buttons.forEach(([id,txt,title,okText,failText])=>{
      const b=document.createElement('button');
      b.id='mechDebug_'+id;
      b.textContent=txt;
      b.title=title;
      b.style.cssText='flex:1 1 92px; min-width:0; font-size:11px; line-height:1.15; white-space:normal; padding:3px 6px; border:1px solid rgba(118,236,255,.62);';
      b.addEventListener('click',()=>run(id, okText, failText));
      box.appendChild(b);
    });
    box.appendChild(metrics);
    refreshMetrics();
    const timer=setInterval(()=>{
      if(!document.body.contains(box)){ clearInterval(timer); return; }
      if(!panel.hidden) refreshMetrics();
    },1200);
    panel.appendChild(box);
  }
  function injectPumpDebugPanel(actions, menuPanel){
    const panel = menuPanel || document.getElementById('menuPanel');
    if(!panel || document.getElementById('pumpDebugBox')) return;
    actions = actions || {};
    const box=document.createElement('div');
    box.id='pumpDebugBox';
    box.style.cssText='display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; border-top:1px solid rgba(84,216,255,.13); padding-top:6px;';
    const label=document.createElement('div');
    label.textContent='Pompy wodne (debug):';
    label.style.cssText='width:100%; font-size:11px; opacity:.7;';
    box.appendChild(label);
    const metrics=document.createElement('div');
    metrics.id='pumpDebugMetrics';
    metrics.style.cssText='width:100%; font-size:10px; opacity:.68;';
    function refreshMetrics(){
      const m=(typeof actions.metrics==='function') ? actions.metrics() : null;
      metrics.textContent=m ? ('pompy '+m.machines+' | aktywne '+m.active+' | naladowane '+m.charged+' | suma '+m.storedEnergy+' E | woda '+m.moved+' | rury '+m.activePipes+' | cache '+(m.cacheSize||0)+' b'+(m.cacheBuilds||0)+'/h'+(m.cacheHits||0)+' inv '+(m.cacheInvalidations||0)+' cap '+(m.capHits||0)+' src '+(m.sourceChecks||0)) : 'brak metryk pomp';
    }
    const buttons=[
      ['give','Hydraulika +','Dodaje rury wodne, pompe i wiezyczke wodna do zasobow'],
      ['place','Postaw pompe','Stawia naladowana pompe w aktualnym kierunku R'],
      ['placeRig','Uklad testowy','Stawia zrodlo wody, rury, pompe, zasilanie i wiezyczke wodna'],
      ['charge','Laduj najblizsza','Laduje najblizsza pompe'],
      ['empty','Rozladuj najblizsza','Rozladowuje najblizsza pompe']
    ];
    buttons.forEach(([id,txt,title])=>{
      const b=document.createElement('button');
      b.textContent=txt;
      b.title=title;
      b.style.cssText='flex:1 1 104px; font-size:11px; padding:3px 6px; border:1px solid rgba(84,216,255,.65);';
      b.addEventListener('click',()=>{
        try{
          const fn=actions[id];
          const ok=(typeof fn==='function') ? fn() : false;
          if(id==='give') msg(ok ? 'Hydraulika dodana do zasobow' : 'Nie dodano hydrauliki');
          else if(id==='place') msg(ok ? 'Pompa postawiona' : 'Brak miejsca na pompe');
          else if(id==='placeRig') msg(ok ? 'Uklad pomp postawiony' : 'Brak miejsca na uklad pomp');
          else if(id==='charge') msg(ok ? 'Pompa naladowana' : 'Brak pompy w poblizu');
          else if(id==='empty') msg(ok ? 'Pompa rozladowana' : 'Brak pompy w poblizu');
          refreshMetrics();
        }catch(e){ msg('Debug pomp: blad'); }
      });
      box.appendChild(b);
    });
    box.appendChild(metrics);
    refreshMetrics();
    const timer=setInterval(()=>{
      if(!document.body.contains(box)){ clearInterval(timer); return; }
      if(!panel.hidden) refreshMetrics();
    },1200);
    panel.appendChild(box);
  }
  function injectNpcDebugPanel(actions, menuPanel){
    const panel = menuPanel || document.getElementById('menuPanel');
    if(!panel || document.getElementById('npcDebugBox')) return;
    actions = actions || {};
    const box=document.createElement('div');
    box.id='npcDebugBox';
    box.style.cssText='display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; border-top:1px solid rgba(226,200,128,.14); padding-top:6px;';
    const label=document.createElement('div');
    label.textContent='NPC (debug):';
    label.style.cssText='width:100%; font-size:11px; opacity:.7;';
    box.appendChild(label);
    const metrics=document.createElement('div');
    metrics.id='npcDebugMetrics';
    metrics.style.cssText='width:100%; font-size:10px; opacity:.68;';
    function refreshMetrics(){
      const m=(typeof actions.metrics==='function') ? actions.metrics() : null;
      if(!m){ metrics.textContent='brak metryk NPC'; return; }
      const current=m.current ? (' | '+m.current.name+' / '+m.current.status) : '';
      metrics.textContent='aktywni '+(m.total||0)+' | blisko '+(m.nearby||0)+current;
    }
    const buttons=[
      ['prev','< NPC','Przenosi bohatera do poprzedniego NPC po lewej'],
      ['nearest','Najblizszy','Przenosi bohatera do najblizszego aktywnego NPC'],
      ['next','NPC >','Przenosi bohatera do nastepnego NPC po prawej']
    ];
    buttons.forEach(([id,txt,title])=>{
      const b=document.createElement('button');
      b.textContent=txt;
      b.title=title;
      b.style.cssText='flex:1 1 82px; font-size:11px; padding:3px 6px; border:1px solid rgba(226,200,128,.65);';
      b.addEventListener('click',()=>{
        try{
          let ok=false;
          if(id==='prev') ok=!!(actions.jump && actions.jump(-1));
          else if(id==='next') ok=!!(actions.jump && actions.jump(1));
          else ok=!!(actions.nearest && actions.nearest());
          msg(ok ? 'Skok do NPC' : 'Nie znaleziono NPC');
          refreshMetrics();
        }catch(e){ msg('Debug NPC: blad'); }
      });
      box.appendChild(b);
    });
    box.appendChild(metrics);
    refreshMetrics();
    const timer=setInterval(()=>{
      if(!document.body.contains(box)){ clearInterval(timer); return; }
      if(!panel.hidden) refreshMetrics();
    },1500);
    panel.appendChild(box);
  }
  function injectCompanionDebugPanel(actions, menuPanel){
    const panel = menuPanel || document.getElementById('menuPanel');
    if(!panel || document.getElementById('companionDebugBox')) return;
    actions = actions || {};
    const box=document.createElement('div');
    box.id='companionDebugBox';
    box.style.cssText='display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; border-top:1px solid rgba(115,255,160,.16); padding-top:6px;';
    const label=document.createElement('div');
    label.textContent='Pomocnicy (debug):';
    label.style.cssText='width:100%; font-size:11px; opacity:.72;';
    box.appendChild(label);
    function makeGroup(text){
      const g=document.createElement('div');
      g.textContent=text;
      g.style.cssText='width:100%; font-size:10px; opacity:.58; margin-top:2px;';
      box.appendChild(g);
      return g;
    }
    function makeNumber(id,labelText,min,max,step,value){
      const wrap=document.createElement('label');
      wrap.style.cssText='flex:1 1 82px; display:flex; flex-direction:column; gap:2px; font-size:10px; opacity:.8;';
      const text=document.createElement('span');
      text.textContent=labelText;
      const input=document.createElement('input');
      input.type='number'; input.min=String(min); input.max=String(max); input.step=String(step); input.value=String(value);
      input.style.cssText='width:100%; box-sizing:border-box; padding:3px 4px; font-size:11px;';
      input.addEventListener('change',()=>{ debugSet('companions',id,readNumber(input,value,min,max)); });
      wrap.appendChild(text); wrap.appendChild(input);
      box.appendChild(wrap);
      return input;
    }
    function readNumber(input,fallback,min,max){
      const v=Number(input && input.value);
      if(!Number.isFinite(v)) return fallback;
      return Math.max(min,Math.min(max,v));
    }
    makeGroup('Bio');
    const spawnInput=makeNumber('spawnBiomass','start biomasy',1,30,1,debugNumber('companions','spawnBiomass',5,1,30));
    const feedInput=makeNumber('feedBiomass','dokarm +',1,30,1,debugNumber('companions','feedBiomass',1,1,30));
    makeGroup('Golem z mokrej gliny');
    const golemClayInput=makeNumber('golemClay','masa gliny',6,18,1,debugNumber('companions','golemClay',8,6,18));
    const guardInput=makeNumber('guardDamage','test guard',1,999,1,debugNumber('companions','guardDamage',30,1,999));
    makeGroup('Lisciany potworek');
    const leafInput=makeNumber('leafMass','masa lisci',5,16,1,debugNumber('companions','leafMass',8,5,16));
    makeGroup('Wodny golem');
    const waterInput=makeNumber('waterMass','masa wody',6,20,1,debugNumber('companions','waterMass',10,6,20));
    makeGroup('Miesny golem');
    const meatInput=makeNumber('meatMass','masa miesa',6,18,1,debugNumber('companions','meatMass',10,6,18));
    makeGroup('Lawowi kretoludzie');
    const molekinInput=makeNumber('molekinMass','masa lawy mac.',1,20,1,debugNumber('companions','molekinMass',4,1,20));
    makeGroup('Wspolne');
    const damageInput=makeNumber('damage','obrazenia',1,999,1,debugNumber('companions','damage',25,1,999));
    const metrics=document.createElement('div');
    metrics.id='companionDebugMetrics';
    metrics.style.cssText='width:100%; font-size:10px; opacity:.72;';
    const details=document.createElement('div');
    details.id='companionDebugDetails';
    details.style.cssText='width:100%; font-size:10px; opacity:.62; line-height:1.25;';
    function listText(list){
      if(!Array.isArray(list) || !list.length) return 'brak aktywnych pomocnikow';
      return list.slice(0,4).map((c,i)=>{
        const g=c.genome || {};
        if(c.kind==='clay_golem'){
          return '#'+(i+1)+' '+(c.name||c.id)+' GOLEM HP '+Math.round(c.hp||0)+'/'+Math.round(c.maxHp||0)+' glina '+(c.clay||0)+' '+(g.torso||'?')+'/'+(g.arms||'?')+' oczy '+(g.eyeCount||0);
        }
        if(c.kind==='leaf_monster'){
          return '#'+(i+1)+' '+(c.name||c.id)+' LISC HP '+Math.round(c.hp||0)+'/'+Math.round(c.maxHp||0)+' liscie '+(c.leaves||0)+' wiatr '+Number(c.lastWind||0).toFixed(2)+' '+(g.silhouette||'?')+'/'+(g.wings||'?');
        }
        if(c.kind==='water_golem'){
          return '#'+(i+1)+' '+(c.name||c.id)+' WODA HP '+Math.round(c.hp||0)+'/'+Math.round(c.maxHp||0)+' woda '+(c.water||0)+' mokry '+Number(c.wateredT||0).toFixed(1)+' '+(g.torso||'?')+'/'+(g.arms||'?');
        }
        if(c.kind==='meat_golem'){
          return '#'+(i+1)+' '+(c.name||c.id)+' MIESO HP '+Math.round(c.hp||0)+'/'+Math.round(c.maxHp||0)+' mieso '+(c.meat||0)+' zgnije za '+Math.round(c.rotIn||0)+'s '+(g.torso||'?')+'/'+(g.arms||'?');
        }
        if(c.kind==='rotten_meat_golem'){
          return '#'+(i+1)+' '+(c.name||c.id)+' ZOMBI HP '+Math.round(c.hp||0)+'/'+Math.round(c.maxHp||0)+' mieso '+(c.meat||0)+' atak '+Number(c.attackCd||0).toFixed(1)+' '+(g.torso||'?')+'/'+(g.head||'?');
        }
        if(c.kind==='fried_meat_golem' || c.kind==='fried_chicken'){
          return '#'+(i+1)+' '+(c.name||c.id)+' PIECZONY HP '+Math.round(c.hp||0)+'/'+Math.round(c.maxHp||0)+' mieso '+(c.meat||0);
        }
        if(c.kind==='molekin'){
          return '#'+(i+1)+' '+(c.name||c.id)+' KRET HP '+Math.round(c.hp||0)+'/'+Math.round(c.maxHp||0)+' lawa '+(c.lava||0)+' rola '+(c.moleRole||'?')+' '+(g.snout?'pysk':'?')+'/'+(g.claw?'pazur':'?');
        }
        return '#'+(i+1)+' '+(c.name||c.id)+' BIO HP '+Math.round(c.hp||0)+'/'+Math.round(c.maxHp||0)+' bio '+(c.biomass||0)+' '+(g.body||'?')+' oczy '+(g.eyes||0)+' nogi '+(g.legs||0);
      }).join(' | ');
    }
    function refreshMetrics(){
      const m=(typeof actions.metrics==='function') ? actions.metrics() : null;
      const list=(typeof actions.list==='function') ? actions.list() : [];
      metrics.textContent=m ? ('aktywni '+(m.count||0)+' | HP '+(m.hp||0)+'/'+(m.maxHp||0)+' | bio '+(m.biomass||0)+' | golemy '+(m.golems||0)+' | glina '+(m.clay||0)+' | lisciaki '+(m.leafMonsters||0)+' | liscie '+(m.leaves||0)+' | wodne '+(m.waterGolems||0)+' | woda '+(m.water||0)+' | miesne '+(m.meatGolems||0)+' | zombi '+(m.rottenMeatGolems||0)+' | pieczone '+(m.friedMeatGolems||m.friedChickens||0)+' | krety '+(m.molekin||0)+' | lawa '+(m.lava||0)+' | lasery '+(m.lasers||0)) : 'brak metryk pomocnikow';
      details.textContent=listText(list);
    }
    const buttons=[
      ['give','Bio skladniki','Dodaje biomase obcych i surowe mieso do ekwipunku'],
      ['spawn','Stworz bio','Tworzy bio-pomocnika z wybrana poczatkowa biomasa'],
      ['spawnStrong','Mocny bio','Tworzy silniejszego bio-pomocnika testowego'],
      ['feed','Dokarm bio','Dodaje wybrana porcje biomasy do najblizszego bio-pomocnika'],
      ['setBiomass','Ustaw bio','Ustawia biomase najblizszego bio-pomocnika na wartosc startowa'],
      ['giveGolem','Glina + kamien','Dodaje gline i kamienie mistrza do ekwipunku'],
      ['ritualGolem','Rytual golema','Uklada mokra gline wokol kamienia mistrza i uruchamia prawdziwy rytual'],
      ['spawnGolem','Stworz golema','Tworzy glinianego golema debugowego z wybrana masa gliny'],
      ['setClay','Ustaw gline','Ustawia mase gliny najblizszego golema'],
      ['guard','Guard hit','Symuluje obrazenia bohatera, aby sprawdzic absorpcje golema'],
      ['shield','Tarcza','Wymusza widoczny puls tarczy najblizszego golema'],
      ['golemMelee','Cios golema','Wymusza cios golema, jezeli istnieje cel w zasiegu'],
      ['giveLeaf','Liscie + kamien','Dodaje liscie i kamienie slugi do ekwipunku'],
      ['ritualLeaf','Rytual lisciaka','Uklada liscie wokol kamienia slugi i uruchamia rytual'],
      ['spawnLeaf','Stworz lisciaka','Tworzy debugowego liscianego potworka z wybrana masa lisci'],
      ['setLeaves','Ustaw liscie','Ustawia mase lisci najblizszego liscianego potworka'],
      ['giveWater','Woda + kamien','Dodaje wode i kamienie mistrza do ekwipunku'],
      ['ritualWater','Rytual wodny','Uklada basen wody, wrzuca kamien mistrza i uruchamia rytual'],
      ['spawnWater','Stworz wodnego','Tworzy debugowego wodnego golema z wybrana masa wody'],
      ['setWater','Ustaw wode','Ustawia mase wody najblizszego wodnego golema'],
      ['waterSpray','Strumien wody','Wymusza gaszenie ognia albo strzal wodny, jezeli jest cel'],
      ['giveMeat','Mieso + kamien','Dodaje surowe mieso i kamienie mistrza do ekwipunku'],
      ['ritualMeat','Rytual miesny','Uklada surowe mieso wokol kamienia mistrza i uruchamia rytual'],
      ['spawnMeat','Stworz miesnego','Tworzy debugowego miesnego golema z wybrana masa miesa'],
      ['setMeat','Ustaw mieso','Ustawia mase miesa najblizszego miesnego golema'],
      ['rotMeat','Zgnij teraz','Natychmiast zmienia najblizszego surowego miesnego golema w zombi'],
      ['cookMeat','Usmaz','Zamienia najblizszego miesnego lub zombi golema w pieczonego sprzymierzenca'],
      ['giveMolekin','Kamien + lawa mac.','Dodaje kamienie mistrza; rytual debugowy sam uklada lawe macierzysta'],
      ['ritualMolekin','Rytual lawy mac.','Uklada lawe macierzysta, kladzie kamien mistrza i przyzywa kretoludzia'],
      ['spawnMolekin','Stworz kreta','Tworzy debugowego lawowego kretoludzia z wybrana masa lawy'],
      ['setLava','Ustaw lawe','Ustawia mase lawy najblizszego kretoludzia'],
      ['molekinFire','Zar kreta','Wymusza lawowy atak kretoludzia, jezeli jest cel'],
      ['heal','Pelne HP','Leczy najblizszego pomocnika do maksimum'],
      ['damage','Ran','Zadaje najblizszemu pomocnikowi wybrane obrazenia'],
      ['kill','Zabij','Testuje smierc i lekka eksplozje pomocnika'],
      ['teleport','Do hero','Przenosi najblizszego pomocnika obok bohatera; kosztuje go 10% maks. HP'],
      ['gas','Gaz','Wymusza emisje trujacego gazu'],
      ['laser','Laser','Wymusza strzal, jezeli istnieje cel w zasiegu'],
      ['clear','Wyczysc','Usuwa wszystkich pomocnikow']
    ];
    function failText(id){
      if(id==='spawnGolem') return 'Debug golema: nie udalo sie znalezc/spawnac golema';
      if(id==='ritualGolem') return 'Debug golema: brak wolnego miejsca na rytual';
      if(id==='setClay' || id==='shield') return 'Debug golema: brak aktywnego golema';
      if(id==='guard') return 'Debug golema: brak golema blisko bohatera';
      if(id==='golemMelee') return 'Debug golema: brak celu w zasiegu';
      if(id==='spawnLeaf') return 'Debug lisciaka: nie udalo sie znalezc/spawnac potworka';
      if(id==='ritualLeaf') return 'Debug lisciaka: brak wolnego miejsca na rytual';
      if(id==='setLeaves') return 'Debug lisciaka: brak aktywnego liscianego potworka';
      if(id==='spawnWater') return 'Debug wodnego golema: nie udalo sie znalezc/spawnac golema';
      if(id==='ritualWater') return 'Debug wodnego golema: brak wolnego miejsca na rytual';
      if(id==='setWater') return 'Debug wodnego golema: brak aktywnego wodnego golema';
      if(id==='waterSpray') return 'Debug wodnego golema: brak ognia lub celu w zasiegu';
      if(id==='spawnMeat') return 'Debug miesnego golema: nie udalo sie znalezc/spawnac golema';
      if(id==='ritualMeat') return 'Debug miesnego golema: brak wolnego miejsca na rytual';
      if(id==='setMeat') return 'Debug miesnego golema: brak aktywnego miesnego golema';
      if(id==='rotMeat') return 'Debug miesnego golema: brak surowego miesnego golema';
      if(id==='cookMeat') return 'Debug miesnego golema: brak miesnego/zombi golema';
      if(id==='spawnMolekin') return 'Debug kretoludzia: nie udalo sie znalezc/spawnac kompana';
      if(id==='ritualMolekin') return 'Debug kretoludzia: brak wolnego miejsca na rytual';
      if(id==='setLava' || id==='molekinFire') return 'Debug kretoludzia: brak aktywnego kretoludzia albo celu';
      return 'Debug pomocnika: brak celu / miejsca';
    }
    buttons.forEach(([id,txt,title])=>{
      const b=document.createElement('button');
      b.textContent=txt;
      b.title=title;
      b.style.cssText='flex:1 1 76px; font-size:11px; padding:3px 6px; border:1px solid rgba(115,255,160,.58);';
      b.addEventListener('click',()=>{
        try{
          let ok=false;
          if(id==='give') ok=!!(actions.give && actions.give());
          else if(id==='giveGolem') ok=!!(actions.giveGolem && actions.giveGolem());
          else if(id==='giveLeaf') ok=!!(actions.giveLeaf && actions.giveLeaf());
          else if(id==='giveWater') ok=!!(actions.giveWater && actions.giveWater());
          else if(id==='giveMeat') ok=!!(actions.giveMeat && actions.giveMeat());
          else if(id==='giveMolekin') ok=!!(actions.giveMolekin && actions.giveMolekin());
          else if(id==='spawn') ok=!!(actions.spawn && actions.spawn(readNumber(spawnInput,5,1,30)));
          else if(id==='spawnStrong') ok=!!(actions.spawn && actions.spawn(18));
          else if(id==='spawnGolem') ok=!!(actions.spawnGolem && actions.spawnGolem(readNumber(golemClayInput,8,6,18)));
          else if(id==='ritualGolem') ok=!!(actions.ritualGolem && actions.ritualGolem(readNumber(golemClayInput,8,6,18)));
          else if(id==='spawnLeaf') ok=!!(actions.spawnLeaf && actions.spawnLeaf(readNumber(leafInput,8,5,16)));
          else if(id==='ritualLeaf') ok=!!(actions.ritualLeaf && actions.ritualLeaf(readNumber(leafInput,8,5,16)));
          else if(id==='spawnWater') ok=!!(actions.spawnWater && actions.spawnWater(readNumber(waterInput,10,6,20)));
          else if(id==='ritualWater') ok=!!(actions.ritualWater && actions.ritualWater(readNumber(waterInput,10,6,20)));
          else if(id==='spawnMeat') ok=!!(actions.spawnMeat && actions.spawnMeat(readNumber(meatInput,10,6,18)));
          else if(id==='ritualMeat') ok=!!(actions.ritualMeat && actions.ritualMeat(readNumber(meatInput,10,6,18)));
          else if(id==='spawnMolekin') ok=!!(actions.spawnMolekin && actions.spawnMolekin(readNumber(molekinInput,4,1,20)));
          else if(id==='ritualMolekin') ok=!!(actions.ritualMolekin && actions.ritualMolekin(readNumber(molekinInput,4,1,20)));
          else if(id==='feed') ok=!!(actions.feed && actions.feed(readNumber(feedInput,1,1,30)));
          else if(id==='setBiomass') ok=!!(actions.setBiomass && actions.setBiomass(readNumber(spawnInput,5,1,30)));
          else if(id==='setClay') ok=!!(actions.setClay && actions.setClay(readNumber(golemClayInput,8,6,18)));
          else if(id==='setLeaves') ok=!!(actions.setLeaves && actions.setLeaves(readNumber(leafInput,8,5,16)));
          else if(id==='setWater') ok=!!(actions.setWater && actions.setWater(readNumber(waterInput,10,6,20)));
          else if(id==='setMeat') ok=!!(actions.setMeat && actions.setMeat(readNumber(meatInput,10,6,18)));
          else if(id==='setLava') ok=!!(actions.setLava && actions.setLava(readNumber(molekinInput,4,1,20)));
          else if(id==='rotMeat') ok=!!(actions.rotMeat && actions.rotMeat());
          else if(id==='cookMeat') ok=!!(actions.cookMeat && actions.cookMeat());
          else if(id==='guard') ok=!!(actions.guard && actions.guard(readNumber(guardInput,30,1,999)));
          else if(id==='shield') ok=!!(actions.shield && actions.shield());
          else if(id==='golemMelee') ok=!!(actions.golemMelee && actions.golemMelee());
          else if(id==='waterSpray') ok=!!(actions.waterSpray && actions.waterSpray());
          else if(id==='molekinFire') ok=!!(actions.molekinFire && actions.molekinFire());
          else if(id==='heal') ok=!!(actions.heal && actions.heal());
          else if(id==='damage') ok=!!(actions.damage && actions.damage(readNumber(damageInput,25,1,999)));
          else if(id==='kill') ok=!!(actions.kill && actions.kill());
          else if(id==='teleport') ok=!!(actions.teleport && actions.teleport());
          else if(id==='gas') ok=!!(actions.gas && actions.gas());
          else if(id==='laser') ok=!!(actions.laser && actions.laser());
          else if(id==='clear') ok=!!(actions.clear && actions.clear());
          msg(ok ? 'Debug pomocnika: OK' : failText(id));
          refreshMetrics();
        }catch(e){ msg('Debug pomocnika: blad'); }
      });
      box.appendChild(b);
    });
    box.appendChild(metrics);
    box.appendChild(details);
    refreshMetrics();
    const timer=setInterval(()=>{
      if(!document.body.contains(box)){ clearInterval(timer); return; }
      if(!panel.hidden) refreshMetrics();
    },1100);
    panel.appendChild(box);
  }
  // Radar pulse helper (the treasure scan lives in the menu; the mobile rail
  // uses its former slot for the explicit mine/build/combat mode switch).
  function setRadarPulsing(active){
    const b = document.getElementById('radarMenuBtn');
    if(!b) return;
    if(active) b.classList.add('pulse'); else b.classList.remove('pulse');
  }
  // public API
  const api = { msg, updateGodButton, updateImmunityButton, updateMapButton, initMenuToggle, openWorldSettings, closeWorldSettings, injectTimeSlider, injectBackgroundDebugPanel, injectHostilityDebugPanel, injectTravelDebugPanel, injectMobSpawnPanel, injectGasDebugPanel, injectDriftDebugPanel, injectSmrDebugPanel, injectNatureDebugPanel, injectInvasionDebugPanel, injectWindDebugPanel, injectSeasonDebugPanel, injectMeteorDebugPanel, injectDynamoDebugPanel, injectSolarDebugPanel, injectTeleporterDebugPanel, injectTurretDebugPanel, injectSpringPlatformDebugPanel, injectMechDebugPanel, injectPumpDebugPanel, injectNpcDebugPanel, injectCompanionDebugPanel, setRadarPulsing, debugSettings:{load:readDebugSettings,set:debugSet,section:debugSection}, closeMenu: ()=>{}, openMenu: ()=>{}, toggleMenu: ()=>{}, populateMobSpawnButtons: ()=>{} };
  // expose as global msg for legacy callers
  try{ window.msg = msg; }catch(e){}
  return api;
})();

// ESM export (progressive migration)
export const ui = (typeof window!=='undefined' && window.MM) ? window.MM.ui : undefined;
export default ui;
