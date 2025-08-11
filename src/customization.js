// Advanced scalable customization UI
// Provides tabbed selection for capes, eyes, outfits with live preview.
(function(){
  const STORAGE_KEY='mm_custom_inv_v1';
  const DEFAULT_LOAD={ capeStyle:'classic', eyeStyle:'bright', outfitStyle:'default' };
  window.MM = window.MM || {}; // ensure namespace
  // Merge any old simple customization
  if(!MM.customization){ MM.customization={}; }
  Object.assign(MM.customization, DEFAULT_LOAD, MM.customization);

  // Data model (future scalable): each category has items {id,name,kind,locked?,data?}
  const ITEMS={
    // airJumps: additional mid-air jumps allowed (0 => only ground jump)
    // moveSpeedMult & jumpPowerMult now also optionally contributed by capes
    capes:[
      {id:'classic', name:'Klasyczna', airJumps:0, desc:'Tylko skok z ziemi'},
      {id:'triangle', name:'Trójkątna', airJumps:1, moveSpeedMult:1.02, jumpPowerMult:1.03, desc:'Podwójny skok (2) + lekka mobilność'},
      {id:'royal', name:'Królewska', shiny:true, airJumps:3, moveSpeedMult:1.08, jumpPowerMult:1.10, desc:'Cztery skoki (4) + szybkość'},
      {id:'tattered', name:'Postrzępiona', airJumps:1, moveSpeedMult:1.00, jumpPowerMult:1.00, desc:'Podwójny skok (2)'},
      {id:'winged', name:'Skrzydlata', shiny:true, airJumps:3, moveSpeedMult:1.10, jumpPowerMult:1.12, desc:'Cztery skoki (4) + duża mobilność'}
    ],
    // visionRadius influences fog reveal; base previously 10
    // Eyes can also give minor speed / jump adjustments (sleepy penalizes)
    eyes:[
      {id:'sleepy', name:'Wąskie', visionRadius:7, moveSpeedMult:0.95, jumpPowerMult:0.95, desc:'Mały zasięg, spowolnienie'},
      {id:'bright', name:'Szerokie', visionRadius:11, moveSpeedMult:1.03, jumpPowerMult:1.00, desc:'Duży zasięg + lekka szybkość'},
      {id:'glow', name:'Przełomowe', visionRadius:15, moveSpeedMult:1.05, jumpPowerMult:1.04, desc:'Bardzo duży zasięg + mobilność'}
    ],
    // Outfits: miner trades mobility for mining; mystic boosts mobility
    outfits:[
      {id:'default', name:'Podstawowy', desc:'Brak bonusów'},
      {id:'miner', name:'Górnik', mineSpeedMult:1.5, moveSpeedMult:0.90, jumpPowerMult:0.90, desc:'Kopanie +50% kosztem mobilności (-10% ruch/skok)'},
      {id:'mystic', name:'Mistyk', moveSpeedMult:1.15, jumpPowerMult:1.08, desc:'Ruch +15%, skok +8%'}
    ]
  };

  // Generic combination rules for extensibility
  // sum: additive, mul: multiplicative (default 1), max: maximum value, set: last write wins
  const STAT_RULES={
    maxAirJumps:'sum',
    visionRadius:'max',
    mineSpeedMult:'mul',
    moveSpeedMult:'mul',
    jumpPowerMult:'mul'
  };
  function applyStat(mods,key,val){
    if(val==null) return;
    const rule=STAT_RULES[key];
    if(!rule){ // unknown -> set
      mods[key]=val; return;
    }
    if(rule==='sum'){ mods[key]=(mods[key]||0)+val; }
    else if(rule==='mul'){ mods[key]=(mods[key]==null?1:mods[key])*val; }
    else if(rule==='max'){ mods[key]=Math.max(mods[key]||0,val); }
    else { mods[key]=val; }
  }
  function clampRange(v,min,max){ return Math.min(max, Math.max(min,v)); }
  function computeActiveModifiers(){
    const mods={};
    const selected=[
      ITEMS.capes.find(c=>c.id===MM.customization.capeStyle),
      ITEMS.eyes.find(e=>e.id===MM.customization.eyeStyle),
      ITEMS.outfits.find(o=>o.id===MM.customization.outfitStyle)
    ];
    selected.forEach(it=>{
      if(!it) return;
      // Map item raw stats to canonical modifier keys
      if(typeof it.airJumps==='number') applyStat(mods,'maxAirJumps', it.airJumps);
      if(typeof it.visionRadius==='number') applyStat(mods,'visionRadius', it.visionRadius);
      if(typeof it.mineSpeedMult==='number') applyStat(mods,'mineSpeedMult', it.mineSpeedMult);
      if(typeof it.moveSpeedMult==='number') applyStat(mods,'moveSpeedMult', it.moveSpeedMult);
      if(typeof it.jumpPowerMult==='number') applyStat(mods,'jumpPowerMult', it.jumpPowerMult);
    });
  // Defaults to keep engine stable
  if(mods.moveSpeedMult==null) mods.moveSpeedMult=1;
  if(mods.mineSpeedMult==null) mods.mineSpeedMult=1;
  if(mods.jumpPowerMult==null) mods.jumpPowerMult=1;
  // Safety clamps (future-proof against extreme stacking)
  mods.moveSpeedMult = clampRange(mods.moveSpeedMult, 0.3, 3);
  mods.jumpPowerMult = clampRange(mods.jumpPowerMult, 0.3, 3);
    MM.activeModifiers = mods;
  MM.getModifiers = ()=>Object.assign({},mods);
  MM.STAT_RULES = STAT_RULES; // expose for debugging / extensions
  }

  function migrateLegacy(){
    // Migrate once from older simple key if new storage absent
    if(localStorage.getItem(STORAGE_KEY)) return; // already using new
    try{
      const legacy=localStorage.getItem('mm_simplecust_v1');
      if(!legacy) return; const d=JSON.parse(legacy);
      if(d && typeof d==='object'){
        const m={};
        if(d.capeStyle) m.capeStyle=d.capeStyle;
        if(d.eyeStyle) m.eyeStyle=d.eyeStyle;
        if(d.outfitStyle) m.outfitStyle=d.outfitStyle;
        Object.assign(MM.customization,m);
      }
    }catch(e){}
  }
  function load(){ migrateLegacy(); try{ const raw=localStorage.getItem(STORAGE_KEY); if(raw){ const d=JSON.parse(raw); if(d && typeof d==='object'){ Object.assign(MM.customization,d); } } }catch(e){} }
  function save(){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify({capeStyle:MM.customization.capeStyle, eyeStyle:MM.customization.eyeStyle, outfitStyle:MM.customization.outfitStyle})); }catch(e){} }
  load();

  // UI refs
  const openBtn=document.getElementById('openCust');
  const overlay=document.getElementById('custOverlay');
  const closeBtn=document.getElementById('custClose');
  const tabsEl=document.getElementById('custTabs');
  const grid=document.getElementById('custGrid');
  const previewCanvas=document.getElementById('custPreview');
  const selInfo=document.getElementById('custSelInfo');
  const statsBox=document.getElementById('custStatsBody');
  if(!openBtn||!overlay||!closeBtn||!tabsEl||!grid||!previewCanvas){
    // Defer until DOM fully parsed (in case script loads before injected markup)
    if(document.readyState!=='complete' && document.readyState!=='interactive'){
      document.addEventListener('DOMContentLoaded',()=>{ if(!window.MM.__custRetry){ window.MM.__custRetry=true; const s=document.createElement('script'); s.src='src/customization.js?retry'; document.head.appendChild(s); } });
    }
    return;
  }
  const pctx=previewCanvas.getContext('2d');

  const categories=[
    {key:'capeStyle', label:'Peleryny', list:ITEMS.capes},
    {key:'eyeStyle', label:'Oczy', list:ITEMS.eyes},
    {key:'outfitStyle', label:'Stroje', list:ITEMS.outfits}
  ];
  let activeCat=categories[0];

  function setActive(cat){ activeCat=cat; tabsEl.querySelectorAll('.custTabBtn').forEach(b=>{ b.classList.toggle('sel', b.dataset.key===cat.key); }); buildGrid(); }

  function buildTabs(){ tabsEl.innerHTML=''; categories.forEach(cat=>{ const b=document.createElement('button'); b.className='custTabBtn'; b.textContent=cat.label; b.dataset.key=cat.key; b.addEventListener('click',()=>setActive(cat)); tabsEl.appendChild(b); }); setActive(activeCat); }

  function buildGrid(){ grid.innerHTML=''; const list=activeCat.list; list.forEach((item,idx)=>{ const div=document.createElement('div'); div.className='custItem'; div.dataset.id=item.id; div.tabIndex=0; if(MM.customization[activeCat.key]===item.id) div.classList.add('sel'); const c=document.createElement('canvas'); c.width=80; c.height=80; const g=c.getContext('2d'); drawItemPreview(g, item, activeCat.key); div.appendChild(c); const nm=document.createElement('div'); nm.className='nm'; nm.textContent=item.name; div.appendChild(nm); if(item.desc){ const d=document.createElement('div'); d.style.fontSize='9px'; d.style.opacity='0.7'; d.textContent=item.desc; div.appendChild(d); }
      function choose(){ if(div.classList.contains('locked')) return; if(MM.customization[activeCat.key]===item.id) return; MM.customization[activeCat.key]=item.id; computeActiveModifiers(); save(); window.dispatchEvent(new CustomEvent('mm-customization-change',{detail:{key:activeCat.key,value:item.id}})); buildGrid(); updatePreview(); updateSelInfo(); }
        div.addEventListener('click',choose);
        div.addEventListener('keydown',e=>{ if(e.key==='Enter' || e.key===' ') { e.preventDefault(); choose(); } });
        grid.appendChild(div); }); }

  function updateSelInfo(){ const m=MM.activeModifiers||{}; const mine=(m.mineSpeedMult && m.mineSpeedMult!==1? (' kop:'+(m.mineSpeedMult.toFixed(2)+'x')):''); const mv=(m.moveSpeedMult && m.moveSpeedMult!==1? (' ruch:'+(m.moveSpeedMult.toFixed(2)+'x')):''); const jp=(m.jumpPowerMult && m.jumpPowerMult!==1? (' skokMoc:'+(m.jumpPowerMult.toFixed(2)+'x')):''); selInfo.textContent='Peleryna: '+MM.customization.capeStyle+' (skoki:'+( (m.maxAirJumps||0)+1 )+') | Oczy: '+MM.customization.eyeStyle+' (zasięg:'+(m.visionRadius||10)+') | Strój: '+MM.customization.outfitStyle+mine+mv+jp; updateStatsBreakdown(); }

  function statRow(label,total,lines){
    const wrap=document.createElement('div');
    const head=document.createElement('div'); head.style.marginTop='4px'; head.innerHTML='<span style="color:#fff">'+label+':</span> <strong>'+total+'</strong>';
    wrap.appendChild(head);
    if(lines && lines.length){ const ul=document.createElement('ul'); ul.style.margin='2px 0 4px 12px'; ul.style.padding='0'; lines.forEach(l=>{ const li=document.createElement('li'); li.style.listStyle='disc'; li.textContent=l; ul.appendChild(li); }); wrap.appendChild(ul); }
    return wrap;
  }
  function fmtMult(v){ return (v).toFixed(2)+'x'; }
  function updateStatsBreakdown(){ if(!statsBox) return; statsBox.innerHTML=''; const sel={
      cape:ITEMS.capes.find(c=>c.id===MM.customization.capeStyle),
      eyes:ITEMS.eyes.find(e=>e.id===MM.customization.eyeStyle),
      outfit:ITEMS.outfits.find(o=>o.id===MM.customization.outfitStyle)
    };
    const m=MM.activeModifiers||{};
    // Vision radius (max rule)
    const visionLines=[]; Object.values(sel).forEach(it=>{ if(it && typeof it.visionRadius==='number') visionLines.push(it.name+': '+it.visionRadius); }); statsBox.appendChild(statRow('Zasięg widzenia', m.visionRadius||10, visionLines));
    // Total jumps (1 base + sum air)
    const jumpLines=[]; Object.values(sel).forEach(it=>{ if(it && typeof it.airJumps==='number' && it.airJumps!==0) jumpLines.push(it.name+': +'+it.airJumps+' powietrzny'); }); statsBox.appendChild(statRow('Całkowite skoki', 1 + (m.maxAirJumps||0), jumpLines));
    // Move speed multiplier (mul rule)
    const moveLines=[]; Object.values(sel).forEach(it=>{ if(it && typeof it.moveSpeedMult==='number' && it.moveSpeedMult!==1) moveLines.push(it.name+': '+fmtMult(it.moveSpeedMult)); }); statsBox.appendChild(statRow('Prędkość ruchu', fmtMult(m.moveSpeedMult||1), moveLines));
    // Jump power multiplier
    const jumpPowLines=[]; Object.values(sel).forEach(it=>{ if(it && typeof it.jumpPowerMult==='number' && it.jumpPowerMult!==1) jumpPowLines.push(it.name+': '+fmtMult(it.jumpPowerMult)); }); statsBox.appendChild(statRow('Moc skoku', fmtMult(m.jumpPowerMult||1), jumpPowLines));
    // Mining speed multiplier
    const mineLines=[]; Object.values(sel).forEach(it=>{ if(it && typeof it.mineSpeedMult==='number' && it.mineSpeedMult!==1) mineLines.push(it.name+': '+fmtMult(it.mineSpeedMult)); }); statsBox.appendChild(statRow('Szybkość kopania', fmtMult(m.mineSpeedMult||1), mineLines));
  }

  let lastFocus=null;
  function trapFocus(e){ if(overlay.style.display!=='block') return; if(e.key!=='Tab') return; const focusables=[...overlay.querySelectorAll('button,[tabindex]')].filter(el=>!el.disabled); if(!focusables.length) return; const first=focusables[0], last=focusables[focusables.length-1]; if(e.shiftKey){ if(document.activeElement===first){ e.preventDefault(); last.focus(); } } else { if(document.activeElement===last){ e.preventDefault(); first.focus(); } } }
  function open(){ overlay.style.display='block'; lastFocus=document.activeElement; updatePreview(); updateSelInfo(); // focus first tab
  const firstTab=tabsEl.querySelector('.custTabBtn'); if(firstTab) firstTab.focus(); document.addEventListener('keydown',trapFocus); }
  function close(){ overlay.style.display='none'; document.removeEventListener('keydown',trapFocus); if(lastFocus && lastFocus.focus) lastFocus.focus(); }
  openBtn.addEventListener('click',open); closeBtn.addEventListener('click',close); overlay.addEventListener('click',e=>{ if(e.target===overlay) close(); });
  window.addEventListener('keydown',e=>{ if(e.key==='Escape' && overlay.style.display==='block') close(); });
  // Keyboard shortcuts while open: Ctrl+ArrowLeft/Right to switch tabs
  window.addEventListener('keydown',e=>{ if(overlay.style.display!=='block') return; if(e.ctrlKey && (e.key==='ArrowRight' || e.key==='ArrowLeft')){ e.preventDefault(); const idx=categories.indexOf(activeCat); let ni=idx + (e.key==='ArrowRight'?1:-1); if(ni<0) ni=categories.length-1; if(ni>=categories.length) ni=0; setActive(categories[ni]); const firstItem=grid.querySelector('.custItem'); if(firstItem) firstItem.focus(); }});

  function drawPlayerPreview(ctx){ ctx.save(); ctx.clearRect(0,0,previewCanvas.width,previewCanvas.height); ctx.scale(2.5,2.5); ctx.translate(40,34); // centered with extra left space for cape swing
    const c=MM.customization; const bw=14, bh=20;
    // Draw cape first (behind body)
    drawCapeMiniAnimated(ctx, c.capeStyle, bw, bh);
    // Body
    ctx.fillStyle=c.outfitStyle==='default'? '#f4c05a': (c.outfitStyle==='miner'?'#c89b50': c.outfitStyle==='mystic'? '#6b42c7':'#f4c05a');
    ctx.fillRect(0,0,bw,bh);
    ctx.strokeStyle='#4b3212'; ctx.lineWidth=1; ctx.strokeRect(0,0,bw,bh);
    // Eyes
    const eyeY=bh*0.35; const eyeW=4; const eyeH=4; const off=4.5;
    if(c.eyeStyle==='glow'){ ctx.fillStyle='#8bf9ff'; ctx.fillRect(bw/2-off-eyeW/2, eyeY-eyeH/2, eyeW, eyeH); ctx.fillRect(bw/2+off-eyeW/2, eyeY-eyeH/2, eyeW, eyeH); }
    else if(c.eyeStyle==='sleepy'){ ctx.fillStyle='#fff'; ctx.fillRect(bw/2-off-eyeW/2, eyeY-1, eyeW, 2); ctx.fillRect(bw/2+off-eyeW/2, eyeY-1, eyeW, 2); }
    else { ctx.fillStyle='#fff'; ctx.fillRect(bw/2-off-eyeW/2, eyeY-eyeH/2, eyeW, eyeH); ctx.fillRect(bw/2+off-eyeW/2, eyeY-eyeH/2, eyeW, eyeH); ctx.fillStyle='#111'; ctx.fillRect(bw/2-off-eyeW/2+1, eyeY-1,2,2); ctx.fillRect(bw/2+off-eyeW/2+1, eyeY-1,2,2); }
    ctx.restore(); }

  // Animated mini cape simulation (lightweight)
  const miniCape=[]; const MINI_SEGS=10; for(let i=0;i<MINI_SEGS;i++) miniCape.push({x:0,y:0}); let miniFacing=1; let lastTime=performance.now(); let faceTimer=0; let faceDir=1;
  function stepMiniCape(styleId,dt){ const st=(MM.cape && MM.cape.getStyle)? MM.cape.getStyle(styleId): {wTop:0.1,wBot:0.24,flare:1};
    // Force full-speed flare (speed=1) for "full swing" preview; alternate direction every 2.2s to show both extremes.
    faceTimer += dt; if(faceTimer>2.2){ faceTimer=0; faceDir*=-1; }
    miniFacing=faceDir; // player facing (1 right, -1 left)
    const targetFlare=(0.18+0.55*1)*st.flare; // max speed
    const segLen=0.5; miniCape[0].x=0; miniCape[0].y=0; for(let i=1;i<MINI_SEGS;i++){ const prev=miniCape[i-1]; const seg=miniCape[i]; const t=i/(MINI_SEGS-1); const backDirX=-miniFacing; const wind=Math.sin(performance.now()/300 + i*0.8)*0.04 + Math.sin(performance.now()/1200 + i)*0.02; const desiredX=prev.x + backDirX*t*targetFlare + wind*(st.wind||1); const desiredY=prev.y + 0.18 + t*0.62; seg.x += (desiredX - seg.x)*Math.min(1,dt*9); seg.y += (desiredY - seg.y)*Math.min(1,dt*9); }
    // length constraint
    for(let it=0; it<2; it++){ for(let i=1;i<MINI_SEGS;i++){ const a=miniCape[i-1], b=miniCape[i]; let dx=b.x-a.x, dy=b.y-a.y; let d=Math.hypot(dx,dy)||0.0001; const excess=d-segLen; if(Math.abs(excess)>0.001){ const k=excess/d; b.x -= dx*k; b.y -= dy*k; } } }
  }
  function drawCapeMiniAnimated(ctx, styleId, bw, bh){ const now=performance.now(); const dt=Math.min(0.05,(now-lastTime)/1000); lastTime=now; stepMiniCape(styleId,dt); ctx.save();
    // Anchor at mid-back depending on facing
    const anchorX = miniFacing===1 ? 1.5 : bw-1.5; // attach near edge
    const anchorY = bh*0.30; // mid upper back
    ctx.translate(anchorX, anchorY);
    const st=(MM.cape && MM.cape.getStyle)? MM.cape.getStyle(styleId): {wTop:0.1,wBot:0.24};
    const WIDTH_SCALE=40; // bigger visual
    const wTop=st.wTop*WIDTH_SCALE, wBot=st.wBot*WIDTH_SCALE;
    ctx.beginPath();
    for(let i=0;i<MINI_SEGS;i++){ const seg=miniCape[i]; const t=i/(MINI_SEGS-1); const w=wTop+(wBot-wTop)*t; const nx= (miniFacing===1? -seg.x: seg.x); const ny=seg.y; if(i===0){ ctx.moveTo(nx - w, ny); } ctx.lineTo(nx - w, ny); }
    for(let i=MINI_SEGS-1;i>=0;i--){ const seg=miniCape[i]; const t=i/(MINI_SEGS-1); const w=wTop+(wBot-wTop)*t; const nx= (miniFacing===1? -seg.x: seg.x); const ny=seg.y; ctx.lineTo(nx + w, ny); }
    ctx.closePath(); ctx.fillStyle='#b91818'; ctx.fill(); ctx.restore(); requestAnimationFrame(()=>{ if(overlay.style.display==='block') updatePreview(); }); }

  function updatePreview(){ drawPlayerPreview(pctx); }

  // Static cape icon (grid thumbnails) – previously removed causing ReferenceError
  function drawCapeMini(ctx, styleId){
    const map={ classic:[4,10], triangle:[3,7], royal:[5,14], tattered:[4,11], winged:[3,12] };
    const dims=map[styleId]||map.classic; ctx.save(); ctx.fillStyle='#b91818'; ctx.fillRect(-dims[0]/2,0,dims[0],dims[1]); ctx.restore();
  }

  function drawItemPreview(ctx,item,catKey){ ctx.clearRect(0,0,80,80); if(catKey==='capeStyle'){ ctx.save(); ctx.translate(40,15); ctx.scale(4,4); drawCapeMini(ctx,item.id); ctx.restore(); } else if(catKey==='eyeStyle'){ ctx.fillStyle='#222'; ctx.fillRect(10,22,60,36); ctx.fillStyle='#f4c05a'; ctx.fillRect(25,28,30,30); // head
    if(item.id==='glow'){ ctx.fillStyle='#8bf9ff'; ctx.fillRect(30,40,8,8); ctx.fillRect(42,40,8,8); }
    else if(item.id==='sleepy'){ ctx.fillStyle='#fff'; ctx.fillRect(30,42,8,4); ctx.fillRect(42,42,8,4); }
      else { ctx.fillStyle='#fff'; ctx.fillRect(30,38,8,12); ctx.fillRect(42,38,8,12); ctx.fillStyle='#111'; ctx.fillRect(32,42,4,4); ctx.fillRect(44,42,4,4); }
    } else if(catKey==='outfitStyle'){ ctx.fillStyle=item.id==='miner'? '#c89b50': item.id==='mystic'? '#6b42c7':'#f4c05a'; ctx.fillRect(18,16,44,48); ctx.strokeStyle='#4b3212'; ctx.strokeRect(18,16,44,48); }
  }

  buildTabs();
  computeActiveModifiers();
  updatePreview();
  updateSelInfo();
})();
