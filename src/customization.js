// Advanced scalable customization UI
// Provides tabbed selection for capes, eyes, outfits with live preview.
(function(){
  const STORAGE_KEY='mm_custom_inv_v1';
  const DEFAULT_LOAD={ capeStyle:'classic', eyeStyle:'bright', outfitStyle:'default', capeColor:'#b91818', outfitColor:'#f4c05a' };
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
      {id:'winged', name:'Skrzydlata', shiny:true, airJumps:3, moveSpeedMult:1.10, jumpPowerMult:1.12, desc:'Cztery skoki (4) + duża mobilność'},
      {id:'shadow', name:'Cienista', airJumps:2, moveSpeedMult:1.06, jumpPowerMult:1.05, desc:'Trzy skoki (3) + zwinność cienia'}
    ],
    // visionRadius influences fog reveal; base previously 10
    // Eyes can also give minor speed / jump adjustments (sleepy penalizes)
    eyes:[
      {id:'sleepy', name:'Wąskie', visionRadius:7, moveSpeedMult:0.95, jumpPowerMult:0.95, desc:'Mały zasięg, spowolnienie'},
      {id:'bright', name:'Szerokie', visionRadius:11, moveSpeedMult:1.03, jumpPowerMult:1.00, desc:'Duży zasięg + lekka szybkość'},
      {id:'glow', name:'Przełomowe', visionRadius:15, moveSpeedMult:1.05, jumpPowerMult:1.04, desc:'Bardzo duży zasięg + mobilność'},
      {id:'gold', name:'Złote', visionRadius:13, moveSpeedMult:1.02, jumpPowerMult:1.02, desc:'Duży zasięg + drobna mobilność'}
    ],
    // Outfits: miner trades mobility for mining; mystic boosts mobility
    outfits:[
      {id:'default', name:'Podstawowy', desc:'Brak bonusów'},
      {id:'miner', name:'Górnik', mineSpeedMult:1.5, moveSpeedMult:0.90, jumpPowerMult:0.90, desc:'Kopanie +50% kosztem mobilności (-10% ruch/skok)'},
      {id:'mystic', name:'Mistyk', moveSpeedMult:1.15, jumpPowerMult:1.08, desc:'Ruch +15%, skok +8%'},
      {id:'ninja', name:'Ninja', moveSpeedMult:1.20, jumpPowerMult:1.15, desc:'Ruch +20%, skok +15%'},
      {id:'ironperson', name:'Iron', mineSpeedMult:1.25, moveSpeedMult:1.05, jumpPowerMult:1.05, desc:'Kopanie +25%, mobilność +5%'}
    ]
  };

  // Outfit palette shared by the in-game player renderer and the preview panel.
  const OUTFIT_BODY={ default:null /* uses cust.outfitColor */, miner:'#c89b50', mystic:'#6b42c7', ninja:'#23262e', ironperson:'#b3202a' };
  function outfitBaseColor(style, cust){ return OUTFIT_BODY[style] || (cust && cust.outfitColor) || '#f4c05a'; }

  // Shared outfit body renderer — main.js drawPlayer() calls MM.drawOutfit (was missing; the
  // game silently fell back to a plain rectangle for every outfit).
  function drawOutfit(ctx,x,y,w,h,style,cust){
    const base=outfitBaseColor(style,cust);
    ctx.fillStyle=base; ctx.fillRect(x,y,w,h);
    if(style==='miner'){
      // helmet band + lamp
      ctx.fillStyle='#8a6a30'; ctx.fillRect(x, y, w, h*0.18);
      ctx.fillStyle='#ffe27a'; ctx.fillRect(x+w*0.5-w*0.1, y+h*0.04, w*0.2, h*0.10);
      ctx.fillStyle='#6e5526'; ctx.fillRect(x, y+h*0.62, w, h*0.08); // belt
    } else if(style==='mystic'){
      // robe shading + sparkles
      ctx.fillStyle='rgba(255,255,255,0.10)'; ctx.fillRect(x, y, w, h*0.25);
      ctx.fillStyle='#cdb4ff';
      ctx.fillRect(x+w*0.2, y+h*0.55, 2, 2); ctx.fillRect(x+w*0.65, y+h*0.7, 2, 2); ctx.fillRect(x+w*0.45, y+h*0.85, 2, 2);
    } else if(style==='ninja'){
      // headband + sash
      ctx.fillStyle='#3a3f4d'; ctx.fillRect(x, y+h*0.28, w, h*0.14);
      ctx.fillStyle='#5560a8'; ctx.fillRect(x, y+h*0.55, w, h*0.07);
    } else if(style==='ironperson'){
      // gold chest plate + arc reactor
      ctx.fillStyle='#e3a934'; ctx.fillRect(x+w*0.18, y+h*0.5, w*0.64, h*0.34);
      ctx.fillStyle='#7df9ff'; ctx.beginPath(); ctx.arc(x+w*0.5, y+h*0.62, Math.max(1.5, w*0.09), 0, Math.PI*2); ctx.fill();
    }
    ctx.strokeStyle='#4b3212'; ctx.lineWidth=1; ctx.strokeRect(x,y,w,h);
  }
  MM.drawOutfit=drawOutfit;

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
  mods.moveSpeedMult = clampRange(mods.moveSpeedMult, 0.3, 30);
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
  function save(){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify({capeStyle:MM.customization.capeStyle, eyeStyle:MM.customization.eyeStyle, outfitStyle:MM.customization.outfitStyle, capeColor:MM.customization.capeColor, outfitColor:MM.customization.outfitColor})); }catch(e){} }
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
  // Persistent discarded loot IDs so they aren't re-added
  const DISCARD_KEY='mm_discarded_loot_v1';
  try{ const raw=localStorage.getItem(DISCARD_KEY); if(raw){ const arr=JSON.parse(raw); if(Array.isArray(arr)){ MM.discardedLoot=new Set(arr); } } }catch(e){}
  if(!MM.discardedLoot) MM.discardedLoot=new Set();
  MM.addDiscardedLoot=function(id){ if(!id) return; MM.discardedLoot.add(id); try{ localStorage.setItem(DISCARD_KEY, JSON.stringify([...MM.discardedLoot])); }catch(e){} };

  const categories=[
    {key:'capeStyle', label:'Peleryny', list:ITEMS.capes},
    {key:'eyeStyle', label:'Oczy', list:ITEMS.eyes},
    {key:'outfitStyle', label:'Stroje', list:ITEMS.outfits}
  ];
  // Ensure stored selection IDs still exist (dynamic loot not persisted or removed)
  function ensureValid(){
    categories.forEach(cat=>{ const arr=cat.list; if(!arr.find(i=>i.id===MM.customization[cat.key])){ MM.customization[cat.key]=arr[0].id; } });
  }
  ensureValid();
  let activeCat=categories[0];

  function setActive(cat){ activeCat=cat; tabsEl.querySelectorAll('.custTabBtn').forEach(b=>{ b.classList.toggle('sel', b.dataset.key===cat.key); }); buildGrid(); }

  function buildTabs(){ tabsEl.innerHTML=''; categories.forEach(cat=>{ const b=document.createElement('button'); b.className='custTabBtn'; b.textContent=cat.label; b.dataset.key=cat.key; b.addEventListener('click',()=>setActive(cat)); tabsEl.appendChild(b); }); setActive(activeCat); }

  function buildGrid(){ grid.innerHTML=''; const list=activeCat.list; list.forEach((item,idx)=>{ const div=document.createElement('div'); div.className='custItem'; div.dataset.id=item.id; div.tabIndex=0; if(MM.customization[activeCat.key]===item.id) div.classList.add('sel'); const c=document.createElement('canvas'); c.width=80; c.height=80; const g=c.getContext('2d'); drawItemPreview(g, item, activeCat.key); div.appendChild(c); const nm=document.createElement('div'); nm.className='nm'; nm.textContent=item.name; div.appendChild(nm); if(item.desc){ const d=document.createElement('div'); d.style.fontSize='9px'; d.style.opacity='0.7'; d.textContent=item.desc; div.appendChild(d); }
      function choose(){ if(div.classList.contains('locked')) return; if(MM.customization[activeCat.key]===item.id) return; MM.customization[activeCat.key]=item.id; computeActiveModifiers(); save(); window.dispatchEvent(new CustomEvent('mm-customization-change',{detail:{key:activeCat.key,value:item.id}})); buildGrid(); updatePreview(); updateSelInfo(); }
        div.addEventListener('click',choose);
        div.addEventListener('keydown',e=>{ if(e.key==='Enter' || e.key===' ') { e.preventDefault(); choose(); } });
        grid.appendChild(div); }); }

  function displayName(list,id){ const it=list.find(i=>i.id===id); return (it && it.name) ? it.name : id; }
  function updateSelInfo(){ const m=MM.activeModifiers||{}; const mine=(m.mineSpeedMult && m.mineSpeedMult!==1? (' kop:'+(m.mineSpeedMult.toFixed(2)+'x')):''); const mv=(m.moveSpeedMult && m.moveSpeedMult!==1? (' ruch:'+(m.moveSpeedMult.toFixed(2)+'x')):''); const jp=(m.jumpPowerMult && m.jumpPowerMult!==1? (' skokMoc:'+(m.jumpPowerMult.toFixed(2)+'x')):''); selInfo.textContent='Peleryna: '+displayName(ITEMS.capes,MM.customization.capeStyle)+' (skoki:'+( (m.maxAirJumps||0)+1 )+') | Oczy: '+displayName(ITEMS.eyes,MM.customization.eyeStyle)+' (zasięg:'+(m.visionRadius||10)+') | Strój: '+displayName(ITEMS.outfits,MM.customization.outfitStyle)+mine+mv+jp; updateStatsBreakdown(); }

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
  function itemLabel(it){ return (it && (it.name||it.id))? (it.name||it.id) : '—'; }
    // Vision radius (max rule)
  const visionLines=[]; Object.values(sel).forEach(it=>{ if(it && typeof it.visionRadius==='number') visionLines.push(itemLabel(it)+': '+it.visionRadius); }); statsBox.appendChild(statRow('Zasięg widzenia', m.visionRadius||10, visionLines));
    // Total jumps (1 base + sum air)
  const jumpLines=[]; Object.values(sel).forEach(it=>{ if(it && typeof it.airJumps==='number' && it.airJumps!==0) jumpLines.push(itemLabel(it)+': +'+it.airJumps+' powietrzny'); }); statsBox.appendChild(statRow('Całkowite skoki', 1 + (m.maxAirJumps||0), jumpLines));
    // Move speed multiplier (mul rule)
  const moveLines=[]; Object.values(sel).forEach(it=>{ if(it && typeof it.moveSpeedMult==='number' && it.moveSpeedMult!==1) moveLines.push(itemLabel(it)+': '+fmtMult(it.moveSpeedMult)); }); statsBox.appendChild(statRow('Prędkość ruchu', fmtMult(m.moveSpeedMult||1), moveLines));
    // Jump power multiplier
  const jumpPowLines=[]; Object.values(sel).forEach(it=>{ if(it && typeof it.jumpPowerMult==='number' && it.jumpPowerMult!==1) jumpPowLines.push(itemLabel(it)+': '+fmtMult(it.jumpPowerMult)); }); statsBox.appendChild(statRow('Moc skoku', fmtMult(m.jumpPowerMult||1), jumpPowLines));
    // Mining speed multiplier
  const mineLines=[]; Object.values(sel).forEach(it=>{ if(it && typeof it.mineSpeedMult==='number' && it.mineSpeedMult!==1) mineLines.push(itemLabel(it)+': '+fmtMult(it.mineSpeedMult)); }); statsBox.appendChild(statRow('Szybkość kopania', fmtMult(m.mineSpeedMult||1), mineLines));
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

  // Eye renderer shared by the big preview and grid thumbnails (mirrors main.js styles)
  function drawEyesMini(ctx, c, bw, bh){
    const outfit=c.outfitStyle;
    const eyeY=bh*0.35, eyeW=4, eyeH=4, off=4.5;
    if(outfit==='ninja'){
      [bw/2-off, bw/2+off].forEach(cx=>{ ctx.fillStyle='#fff'; ctx.fillRect(cx-eyeW/2, eyeY-1, eyeW, 2.4); ctx.fillStyle='#3cf'; ctx.fillRect(cx-1, eyeY-0.6, 1.6, 1.4); });
      return;
    }
    if(outfit==='ironperson'){
      ctx.fillStyle='#ffd700';
      [bw/2-off, bw/2+off].forEach(cx=>ctx.fillRect(cx-eyeW/2, eyeY-eyeH/2, eyeW, eyeH));
      return;
    }
    [bw/2-off, bw/2+off].forEach(cx=>{
      if(c.eyeStyle==='glow'){ ctx.fillStyle='rgba(139,249,255,0.25)'; ctx.fillRect(cx-eyeW/2-1, eyeY-eyeH/2-1, eyeW+2, eyeH+2); ctx.fillStyle='#8bf9ff'; ctx.fillRect(cx-eyeW/2, eyeY-eyeH/2, eyeW, eyeH); }
      else if(c.eyeStyle==='sleepy'){ ctx.fillStyle='#fff'; ctx.fillRect(cx-eyeW/2, eyeY-1, eyeW, 2); }
      else if(c.eyeStyle==='gold'){ ctx.fillStyle='#ffce3a'; ctx.fillRect(cx-eyeW/2, eyeY-eyeH/2, eyeW, eyeH); ctx.fillStyle='#5a3b00'; ctx.fillRect(cx-1, eyeY-1, 2, 2); }
      else { ctx.fillStyle='#fff'; ctx.fillRect(cx-eyeW/2, eyeY-eyeH/2, eyeW, eyeH); ctx.fillStyle='#111'; ctx.fillRect(cx-eyeW/2+1, eyeY-1, 2, 2); }
    });
  }

  function drawPlayerPreview(ctx){ ctx.save(); ctx.clearRect(0,0,previewCanvas.width,previewCanvas.height);
    const SCALE=3.4; ctx.scale(SCALE,SCALE);
    const c=MM.customization; const bw=14, bh=20;
    const areaW=previewCanvas.width/SCALE, areaH=previewCanvas.height/SCALE;
    ctx.translate((areaW-bw)/2, (areaH-bh)/2);
    // soft ground shadow for context
    ctx.fillStyle='rgba(0,0,0,0.30)'; ctx.beginPath(); ctx.ellipse(bw/2, bh+2.5, bw*0.62, 2.2, 0, 0, Math.PI*2); ctx.fill();
    // Cape first (behind body), then shared outfit body, then eyes
    drawCapeMiniAnimated(ctx, c.capeStyle, bw, bh);
    drawOutfit(ctx, 0, 0, bw, bh, c.outfitStyle, c);
    drawEyesMini(ctx, c, bw, bh);
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
    ctx.closePath();
    const capeCol=MM.customization.capeColor||'#b91818';
    if(st.shiny){
      const g=ctx.createLinearGradient(0,0,0,miniCape[MINI_SEGS-1].y);
      g.addColorStop(0, capeCol); g.addColorStop(0.55, shadeHex(capeCol,40)); g.addColorStop(1, shadeHex(capeCol,-20));
      ctx.fillStyle=g;
    } else ctx.fillStyle=capeCol;
    ctx.fill(); ctx.restore(); requestAnimationFrame(()=>{ if(overlay.style.display==='block') updatePreview(); }); }

  function shadeHex(col,delta){ const r=parseInt(col.slice(1,3),16), g=parseInt(col.slice(3,5),16), b=parseInt(col.slice(5,7),16); const cl=v=>Math.min(255,Math.max(0,v)); return '#'+cl(r+delta).toString(16).padStart(2,'0')+cl(g+delta).toString(16).padStart(2,'0')+cl(b+delta).toString(16).padStart(2,'0'); }

  function updatePreview(){ drawPlayerPreview(pctx); }

  // Static cape thumbnail: hanging cape silhouette matching the engine's edge styles
  // (straight / point / scallop / ragged / wave) with shiny gradient where applicable.
  function drawCapeMini(ctx, styleId){
    const st=(MM.cape && MM.cape.getStyle)? MM.cape.getStyle(styleId): {wTop:0.1,wBot:0.24,edge:'straight',shiny:false};
    const col=MM.customization.capeColor||'#b91818';
    const topY=12, botY=64; const W=110; // width scale: engine units -> px
    const wTop=Math.max(5, st.wTop*W/2), wBot=Math.max(7, st.wBot*W/2);
    const cx=40;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx-wTop, topY);
    // left edge (waves for 'wave' style)
    if(st.edge==='wave'){
      for(let i=1;i<=4;i++){ const t=i/4; const y=topY+(botY-topY)*t; const w=wTop+(wBot-wTop)*t; ctx.quadraticCurveTo(cx-w-4*Math.sin(t*Math.PI*2+1), y-(botY-topY)/8, cx-w, y); }
    } else ctx.lineTo(cx-wBot, botY);
    // bottom edge per style
    if(st.edge==='point'){ ctx.lineTo(cx, botY+10); ctx.lineTo(cx+wBot, botY); }
    else if(st.edge==='scallop'){ const n=4; for(let i=1;i<=n;i++){ const x0=cx-wBot+((2*wBot)/n)*(i-1); const x1=cx-wBot+((2*wBot)/n)*i; ctx.quadraticCurveTo((x0+x1)/2, botY+8, x1, botY); } }
    else if(st.edge==='ragged'){ const n=6; for(let i=1;i<=n;i++){ const x=cx-wBot+((2*wBot)/n)*i; ctx.lineTo(x-((2*wBot)/n)/2, botY+(i%2?7:1)); ctx.lineTo(x, botY); } }
    else { ctx.lineTo(cx+wBot, botY); }
    // right edge back up
    if(st.edge==='wave'){
      for(let i=3;i>=0;i--){ const t=i/4; const y=topY+(botY-topY)*t; const w=wTop+(wBot-wTop)*t; ctx.quadraticCurveTo(cx+w+4*Math.sin(t*Math.PI*2+1), y+(botY-topY)/8, cx+w, y); }
    } else ctx.lineTo(cx+wTop, topY);
    ctx.closePath();
    if(st.shiny){ const g=ctx.createLinearGradient(0,topY,0,botY); g.addColorStop(0,col); g.addColorStop(0.55,shadeHex(col,40)); g.addColorStop(1,shadeHex(col,-20)); ctx.fillStyle=g; }
    else ctx.fillStyle = styleId==='shadow' ? shadeHex(col,-60) : col;
    ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=1; ctx.stroke();
    // hanger bar to read as "cape on display"
    ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.fillRect(cx-wTop-4, topY-3, wTop*2+8, 2);
    ctx.restore();
  }

  function drawItemPreview(ctx,item,catKey){ ctx.clearRect(0,0,80,80);
    if(catKey==='capeStyle'){ drawCapeMini(ctx,item.id); }
    else if(catKey==='eyeStyle'){
      ctx.fillStyle='#222'; ctx.fillRect(10,22,60,36); ctx.fillStyle='#f4c05a'; ctx.fillRect(25,28,30,30); // head
      if(item.id==='glow'){ ctx.fillStyle='rgba(139,249,255,0.25)'; ctx.fillRect(28,38,12,12); ctx.fillRect(40,38,12,12); ctx.fillStyle='#8bf9ff'; ctx.fillRect(30,40,8,8); ctx.fillRect(42,40,8,8); }
      else if(item.id==='sleepy'){ ctx.fillStyle='#fff'; ctx.fillRect(30,42,8,4); ctx.fillRect(42,42,8,4); }
      else if(item.id==='gold'){ ctx.fillStyle='#ffce3a'; ctx.fillRect(30,38,8,12); ctx.fillRect(42,38,8,12); ctx.fillStyle='#5a3b00'; ctx.fillRect(32,42,4,4); ctx.fillRect(44,42,4,4); }
      else { ctx.fillStyle='#fff'; ctx.fillRect(30,38,8,12); ctx.fillRect(42,38,8,12); ctx.fillStyle='#111'; ctx.fillRect(32,42,4,4); ctx.fillRect(44,42,4,4); }
    } else if(catKey==='outfitStyle'){
      // shared renderer + matching eye overlay so thumbnails look like the real player
      drawOutfit(ctx, 18, 12, 44, 56, item.id, MM.customization);
      ctx.save(); ctx.translate(18,12); ctx.scale(44/14, 56/20);
      drawEyesMini(ctx, {outfitStyle:item.id, eyeStyle:MM.customization.eyeStyle}, 14, 20);
      ctx.restore();
    }
  }

  // --- Color pickers (cape always; outfit color applies to the 'Podstawowy' outfit) ---
  const CAPE_SWATCHES=['#b91818','#1d6fd6','#1f9d44','#7a25c9','#e08a00','#d6336c','#11b5ad','#222831'];
  const OUTFIT_SWATCHES=['#f4c05a','#e0e0e0','#7fb2e5','#9adf7c','#e58f7f','#c9a0ff'];
  const colorsEl=document.getElementById('custColors');
  function buildColorRow(labelText, swatches, getCur, apply){
    const wrap=document.createElement('div');
    const lab=document.createElement('div'); lab.className='swLabel'; lab.textContent=labelText; wrap.appendChild(lab);
    const row=document.createElement('div'); row.className='swRow';
    function refreshSel(){ row.querySelectorAll('.sw').forEach(b=>{ b.classList.toggle('sel', b.dataset.col===getCur()); }); }
    swatches.forEach(col=>{ const b=document.createElement('button'); b.className='sw'; b.dataset.col=col; b.style.background=col; b.title=col; b.addEventListener('click',()=>{ apply(col); refreshSel(); }); row.appendChild(b); });
    const custom=document.createElement('label'); custom.className='sw swCustom'; custom.title='Własny kolor';
    const inp=document.createElement('input'); inp.type='color'; inp.value=getCur();
    inp.addEventListener('input',()=>{ apply(inp.value); refreshSel(); });
    custom.appendChild(inp); row.appendChild(custom);
    wrap.appendChild(row);
    refreshSel();
    return wrap;
  }
  function buildColors(){ if(!colorsEl) return; colorsEl.innerHTML='';
    colorsEl.appendChild(buildColorRow('Kolor peleryny', CAPE_SWATCHES, ()=>MM.customization.capeColor||'#b91818', col=>{ MM.customization.capeColor=col; afterColorChange(); }));
    colorsEl.appendChild(buildColorRow('Kolor stroju (Podstawowy)', OUTFIT_SWATCHES, ()=>MM.customization.outfitColor||'#f4c05a', col=>{ MM.customization.outfitColor=col; afterColorChange(); }));
  }
  function afterColorChange(){ save(); buildGrid(); updatePreview(); window.dispatchEvent(new CustomEvent('mm-customization-change',{detail:{key:'color'}})); }

  // --- Action buttons: randomize & reset ---
  const actionsEl=document.getElementById('custActions');
  function buildActions(){ if(!actionsEl) return; actionsEl.innerHTML='';
    const rnd=document.createElement('button'); rnd.textContent='🎲 Losuj'; rnd.title='Losowa stylizacja';
    rnd.addEventListener('click',()=>{
      const pick=a=>a[Math.floor(Math.random()*a.length)];
      MM.customization.capeStyle=pick(ITEMS.capes).id;
      MM.customization.eyeStyle=pick(ITEMS.eyes).id;
      MM.customization.outfitStyle=pick(ITEMS.outfits).id;
      MM.customization.capeColor=pick(CAPE_SWATCHES);
      MM.customization.outfitColor=pick(OUTFIT_SWATCHES);
      applyAll();
    });
    const rst=document.createElement('button'); rst.textContent='↺ Reset'; rst.title='Przywróć domyślne';
    rst.addEventListener('click',()=>{ Object.assign(MM.customization, DEFAULT_LOAD); applyAll(); });
    actionsEl.appendChild(rnd); actionsEl.appendChild(rst);
  }
  function applyAll(){ computeActiveModifiers(); save(); buildColors(); buildGrid(); updatePreview(); updateSelInfo(); window.dispatchEvent(new CustomEvent('mm-customization-change',{detail:{key:'all'}})); }

  buildTabs();
  buildColors();
  buildActions();
  computeActiveModifiers();
  updatePreview();
  updateSelInfo();

  // Expose internal data & recompute for other systems (loot comparison popup)
  MM.getCustomizationItems = ()=>ITEMS;
  MM.recomputeModifiers = computeActiveModifiers;

  // Hook for dynamic loot integration
  window.updateDynamicCustomization = function(){
    if(!MM.dynamicLoot) return;
    // Merge new items (avoid id collisions)
  function merge(list,newOnes){ newOnes.forEach(it=>{ if(MM.discardedLoot && MM.discardedLoot.has(it.id)) return; if(!list.find(e=>e.id===it.id)){ list.push(it); } }); }
    merge(ITEMS.capes, MM.dynamicLoot.capes||[]);
    merge(ITEMS.eyes, MM.dynamicLoot.eyes||[]);
    merge(ITEMS.outfits, MM.dynamicLoot.outfits||[]);
    // Rebuild UI if overlay open
    if(overlay.style.display==='block'){
      buildGrid(); updateSelInfo();
    }
  };
})();
