// Simple UI utilities: message toast and top button label helpers (ESM + global)
import { worldGen as WORLDGEN } from './worldgen.js';
import { mobs as MOBS } from './mobs.js';
window.MM = window.MM || {};
MM.ui = (function(){
  let msgEl = null;
  let msgTimer = null;
  let _menu = { btn: null, panel: null };
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
  function updateMapButton(on){
    const b = document.getElementById('mapBtn');
    if(!b) return;
    b.classList.toggle('toggled', !!on);
    b.textContent = 'Mapa: ' + (on?'ON':'OFF');
  }
  function initMenuToggle(){
    const menuBtn = document.getElementById('menuBtn');
    const menuPanel = document.getElementById('menuPanel');
    if(!menuBtn || !menuPanel) return;
    _menu.btn = menuBtn; _menu.panel = menuPanel;
    function close(){ menuPanel.hidden = true; menuBtn.setAttribute('aria-expanded','false'); }
    // expose
    api.closeMenu = close;
    menuBtn.addEventListener('click',()=>{
      const vis = menuPanel.hidden;
      menuPanel.hidden = !vis;
      menuBtn.setAttribute('aria-expanded', String(vis));
    });
    document.addEventListener('click',(e)=>{
      if(menuPanel.hidden) return;
      if(menuPanel.contains(e.target) || menuBtn.contains(e.target)) return;
      close();
    });
    // Radar menu button triggers a custom event so game can respond without tight coupling
    const radarMenuBtn = document.getElementById('radarMenuBtn');
    radarMenuBtn?.addEventListener('click',()=>{
      try{ window.dispatchEvent(new CustomEvent('mm-radar-pulse')); }catch(e){}
      close();
    });
  // Do not inject world settings into the dropdown menu anymore; use the dedicated modal instead.
    // Hook world settings modal open/close
    const openWS = document.getElementById('openWorldSettingsBtn');
    const wsOverlay = document.getElementById('worldSettingsOverlay');
    const wsBody = document.getElementById('worldSettingsBody');
    const wsClose = document.getElementById('worldSettingsClose');
    function openWorldSettings(){ if(!wsOverlay||!wsBody) return; // lazy inject content the first time
      if(!wsBody.__injected){ injectWorldSettings(wsBody); wsBody.__injected=true; }
      wsOverlay.style.display='block';
      try{ api.closeMenu(); }catch(e){}
    }
    function closeWorldSettings(){ if(wsOverlay) wsOverlay.style.display='none'; }
    openWS?.addEventListener('click', openWorldSettings);
    wsClose?.addEventListener('click', closeWorldSettings);
    wsOverlay?.addEventListener('click', (e)=>{ if(e.target===wsOverlay) closeWorldSettings(); });
    window.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && wsOverlay && wsOverlay.style.display!=='none' && wsOverlay.style.display!==''){ closeWorldSettings(); e.stopPropagation(); } });
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
      input.addEventListener('input',()=>{ span.textContent = fmt? fmt(input.value): String(input.value); });
      wrap.appendChild(lab); wrap.appendChild(input); box.appendChild(wrap);
      return {input,span};
    }
    const r1=row('Poziom morza', 'setSeaLevel', 45, 80, 1, (s.seaLevel===undefined?62:s.seaLevel));
    const r2=row('Ilość oceanów', 'setOceanFrac', 0.15, 0.50, 0.01, (s.oceanFrac===undefined?0.32:s.oceanFrac), v=>Number(v).toFixed(2));
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
  const apply=document.createElement('button'); apply.className='topbtn'; apply.textContent='Zastosuj i odśwież';
  apply.addEventListener('click',()=>{
      try{
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
    const range=document.createElement('input'); range.type='range'; range.min='0'; range.max='1'; range.step='0.0001'; range.value='0'; range.style.width='100%';
    const chkWrap=document.createElement('div'); chkWrap.style.cssText='display:flex; align-items:center; gap:6px; font-size:11px; margin-top:4px;';
    const chk=document.createElement('input'); chk.type='checkbox'; chk.id='timeOverrideChk';
    const chkLab=document.createElement('label'); chkLab.htmlFor='timeOverrideChk'; chkLab.textContent='Steruj ręcznie';
    chkWrap.appendChild(chk); chkWrap.appendChild(chkLab);
    wrap.appendChild(label); wrap.appendChild(range); wrap.appendChild(chkWrap);
    panel.appendChild(wrap);
    window.__timeSliderEl = range;
    function upd(){ span.textContent=(parseFloat(range.value)*100).toFixed(2)+'%'; }
    range.addEventListener('input',()=>{ upd(); if(window.__timeOverrideActive){ window.__timeOverrideValue=parseFloat(range.value); }});
    chk.addEventListener('change',()=>{ window.__timeOverrideActive=chk.checked; if(chk.checked){ window.__timeOverrideValue=parseFloat(range.value); window.__timeSliderLocked=true; } else { window.__timeSliderLocked=false; } });
    upd();
  }
  function injectMobSpawnPanel(spawnCb, menuPanel){
    const panel = menuPanel || document.getElementById('menuPanel');
    if(!panel) return;
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
      speciesList.forEach(id=>{
        const b=document.createElement('button'); b.textContent=id; b.style.cssText='flex:1 1 70px; font-size:11px; padding:3px 6px;';
        b.addEventListener('click',()=>{ try{ if(typeof spawnCb==='function') spawnCb(id); }catch(e){} });
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
    }
    // Expose populate for any external triggers (keeps backward compatibility)
    api.populateMobSpawnButtons = populate;
    try{ window.__populateMobSpawnButtons = populate; }catch(e){}
    setTimeout(()=>{ populate(); },300);
    window.addEventListener('mm-mobs-ready',()=>{ populate(); });
  }
  // Radar pulse helper (adds/removes pulse class on #radarBtn)
  function setRadarPulsing(active){
    const b = document.getElementById('radarBtn');
    if(!b) return;
    if(active) b.classList.add('pulse'); else b.classList.remove('pulse');
  }
  // public API
  const api = { msg, updateGodButton, updateMapButton, initMenuToggle, injectTimeSlider, injectMobSpawnPanel, setRadarPulsing, closeMenu: ()=>{}, populateMobSpawnButtons: ()=>{} };
  // expose as global msg for legacy callers
  try{ window.msg = msg; }catch(e){}
  return api;
})();

// ESM export (progressive migration)
export const ui = (typeof window!=='undefined' && window.MM) ? window.MM.ui : undefined;
export default ui;
