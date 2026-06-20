// Simple UI utilities: message toast and top button label helpers (ESM + global)
import { worldGen as WORLDGEN } from './worldgen.js';
import { mobs as MOBS } from './mobs.js';
window.MM = window.MM || {};
MM.ui = (function(){
  let msgEl = null;
  let msgTimer = null;
  let _menu = { btn: null, panel: null };
  const DEBUG_SETTINGS_KEY='mm_debug_menu_settings_v1';
  const DEBUG_DEFAULTS={
    time:{active:false,value:0},
    gas:{power:2},
    wind:{speed:0,mode:'natural',profile:null},
    seasons:{enabled:true,forced:null}
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
    const timeSaved=debugSection('time');
    const range=document.createElement('input'); range.type='range'; range.min='0'; range.max='1'; range.step='0.0001'; range.value=String(debugNumber('time','value',0,0,1)); range.style.width='100%';
    const chkWrap=document.createElement('div'); chkWrap.style.cssText='display:flex; align-items:center; gap:6px; font-size:11px; margin-top:4px;';
    const chk=document.createElement('input'); chk.type='checkbox'; chk.id='timeOverrideChk';
    chk.checked=timeSaved.active===true;
    const chkLab=document.createElement('label'); chkLab.htmlFor='timeOverrideChk'; chkLab.textContent='Steruj ręcznie';
    chkWrap.appendChild(chk); chkWrap.appendChild(chkLab);
    wrap.appendChild(label); wrap.appendChild(range); wrap.appendChild(chkWrap);
    panel.appendChild(wrap);
    window.__timeSliderEl = range;
    function readTimeValue(){ const n=parseFloat(range.value); return Number.isFinite(n) ? Math.max(0,Math.min(1,n)) : 0; }
    function upd(){ span.textContent=(readTimeValue()*100).toFixed(2)+'%'; }
    function applyTimeOverride(){
      const val=readTimeValue();
      window.__timeOverrideActive=chk.checked;
      window.__timeOverrideValue=val;
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
    applyTimeOverride();
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
      BIOME_DEBUG_BUTTONS.forEach(([id,label])=>{
        const b=document.createElement('button');
        b.textContent=label;
        b.title='Teleportuj do najblizszego biomu: '+label;
        b.style.cssText='flex:1 1 72px; font-size:11px; padding:3px 6px; border:1px solid rgba(90,180,255,.55);';
        b.addEventListener('click',()=>{
          try{
            const hit=(typeof window.teleportHeroToNearestBiome==='function') ? window.teleportHeroToNearestBiome(id,0) : null;
            if(!hit) msg('Nie znaleziono biomu: '+label);
          }catch(e){}
        });
        box.appendChild(b);
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
    speed.min='-5.2';
    speed.max='5.2';
    speed.step='0.1';
    speed.value=String(debugNumber('wind','speed',0,-5.2,5.2));
    speed.style.cssText='flex:1; min-width:92px;';
    const speedVal=document.createElement('span');
    speedVal.style.cssText='min-width:36px; text-align:right; opacity:.7;';
    function readSpeed(){
      const n=parseFloat(speed.value);
      return Number.isFinite(n) ? Math.max(-5.2, Math.min(5.2, n)) : 0;
    }
    function refreshSpeed(){ speedVal.textContent=readSpeed().toFixed(1); }
    speed.addEventListener('input',()=>{ refreshSpeed(); debugSet('wind','speed',readSpeed()); });
    function persistWindOverride(value){
      const v=Math.max(-5.2,Math.min(5.2,Number(value)||0));
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
        const v=debugNumber('wind','speed',0,-5.2,5.2);
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
      ['galeLeft','Wichura <-','Silny wiatr w lewo',()=>{ const ok=actions.gale && actions.gale(-1); if(ok) persistWindOverride(-4.65); return ok; },'Wiatr: wichura w lewo'],
      ['galeRight','Wichura ->','Silny wiatr w prawo',()=>{ const ok=actions.gale && actions.gale(1); if(ok) persistWindOverride(4.65); return ok; },'Wiatr: wichura w prawo'],
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
      const fx=(m.embers||0)+(m.debris||0)+(m.plumes||0)+(m.beaconWaves||0)+(m.gravityBursts||0);
      const days=Number.isFinite(m.nextInDays) ? Number(m.nextInDays).toFixed(2)+'d' : Number(m.nextIn||0).toFixed(0)+'s';
      metrics.textContent=(m.enabled?'ON':'OFF')+' | next '+days+' | lot '+(m.meteors||0)+' | krater job '+(m.terrainJobs||0)+' q'+(m.queuedOps||0)+' | fx '+fx+' | impakty '+(m.impacts||0)+' | odchylenia '+(m.deflections||0);
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
      ['beacon','Postaw beacon','Stawia beacon antygrawitacyjny do testowania odchylania meteorytow'],
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
          else if(id==='beacon') ok=(typeof actions.beacon==='function') ? actions.beacon() : false;
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
  // Radar pulse helper (adds/removes pulse class on #radarBtn)
  function setRadarPulsing(active){
    const b = document.getElementById('radarBtn');
    if(!b) return;
    if(active) b.classList.add('pulse'); else b.classList.remove('pulse');
  }
  // public API
  const api = { msg, updateGodButton, updateMapButton, initMenuToggle, injectTimeSlider, injectMobSpawnPanel, injectGasDebugPanel, injectWindDebugPanel, injectSeasonDebugPanel, injectMeteorDebugPanel, injectDynamoDebugPanel, injectSolarDebugPanel, injectTeleporterDebugPanel, injectTurretDebugPanel, setRadarPulsing, debugSettings:{load:readDebugSettings,set:debugSet,section:debugSection}, closeMenu: ()=>{}, openMenu: ()=>{}, toggleMenu: ()=>{}, populateMobSpawnButtons: ()=>{} };
  // expose as global msg for legacy callers
  try{ window.msg = msg; }catch(e){}
  return api;
})();

// ESM export (progressive migration)
export const ui = (typeof window!=='undefined' && window.MM) ? window.MM.ui : undefined;
export default ui;
