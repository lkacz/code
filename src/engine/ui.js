// Simple UI utilities: message toast and top button label helpers
window.MM = window.MM || {};
MM.ui = (function(){
  let msgEl = null;
  let msgTimer = null;
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
  // Radar pulse helper (adds/removes pulse class on #radarBtn)
  function setRadarPulsing(active){
    const b = document.getElementById('radarBtn');
    if(!b) return;
    if(active) b.classList.add('pulse'); else b.classList.remove('pulse');
  }
  // public API
  const api = { msg, updateGodButton, updateMapButton, setRadarPulsing };
  // expose as global msg for legacy callers
  try{ window.msg = msg; }catch(e){}
  return api;
})();
