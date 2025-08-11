// Simple UI utilities: message toast and top button label helpers
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
  // Radar pulse helper (adds/removes pulse class on #radarBtn)
  function setRadarPulsing(active){
    const b = document.getElementById('radarBtn');
    if(!b) return;
    if(active) b.classList.add('pulse'); else b.classList.remove('pulse');
  }
  // public API
  const api = { msg, updateGodButton, updateMapButton, initMenuToggle, injectTimeSlider, setRadarPulsing, closeMenu: ()=>{} };
  // expose as global msg for legacy callers
  try{ window.msg = msg; }catch(e){}
  return api;
})();
