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
    capes:[
      {id:'classic', name:'Klasyczna'},
      {id:'triangle', name:'Trójkątna'},
      {id:'royal', name:'Królewska', shiny:true},
      {id:'tattered', name:'Postrzępiona'},
      {id:'winged', name:'Skrzydlata'}
    ],
    eyes:[
      {id:'bright', name:'Jasne'},
      {id:'glow', name:'Świetliste'},
      {id:'sleepy', name:'Śpiące'}
    ],
    outfits:[
      {id:'default', name:'Podstawowy'},
      {id:'miner', name:'Górnik'},
      {id:'mystic', name:'Mistyk'}
    ]
  };

  function load(){ try{ const raw=localStorage.getItem(STORAGE_KEY); if(raw){ const d=JSON.parse(raw); if(d && typeof d==='object'){ Object.assign(MM.customization,d); } } }catch(e){} }
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
  if(!openBtn||!overlay||!closeBtn||!tabsEl||!grid||!previewCanvas) return; // fail safe
  const pctx=previewCanvas.getContext('2d');

  const categories=[
    {key:'capeStyle', label:'Peleryny', list:ITEMS.capes},
    {key:'eyeStyle', label:'Oczy', list:ITEMS.eyes},
    {key:'outfitStyle', label:'Stroje', list:ITEMS.outfits}
  ];
  let activeCat=categories[0];

  function setActive(cat){ activeCat=cat; tabsEl.querySelectorAll('.custTabBtn').forEach(b=>{ b.classList.toggle('sel', b.dataset.key===cat.key); }); buildGrid(); }

  function buildTabs(){ tabsEl.innerHTML=''; categories.forEach(cat=>{ const b=document.createElement('button'); b.className='custTabBtn'; b.textContent=cat.label; b.dataset.key=cat.key; b.addEventListener('click',()=>setActive(cat)); tabsEl.appendChild(b); }); setActive(activeCat); }

  function buildGrid(){ grid.innerHTML=''; const list=activeCat.list; list.forEach(item=>{ const div=document.createElement('div'); div.className='custItem'; div.dataset.id=item.id; if(MM.customization[activeCat.key]===item.id) div.classList.add('sel'); const c=document.createElement('canvas'); c.width=80; c.height=80; const g=c.getContext('2d'); drawItemPreview(g, item, activeCat.key); div.appendChild(c); const nm=document.createElement('div'); nm.className='nm'; nm.textContent=item.name; div.appendChild(nm); div.addEventListener('click',()=>{ if(div.classList.contains('locked')) return; MM.customization[activeCat.key]=item.id; save(); buildGrid(); updatePreview(); updateSelInfo(); }); grid.appendChild(div); }); }

  function updateSelInfo(){ selInfo.textContent='Peleryna: '+MM.customization.capeStyle+' | Oczy: '+MM.customization.eyeStyle+' | Strój: '+MM.customization.outfitStyle; }

  function open(){ overlay.style.display='block'; updatePreview(); updateSelInfo(); }
  function close(){ overlay.style.display='none'; }
  openBtn.addEventListener('click',open); closeBtn.addEventListener('click',close); overlay.addEventListener('click',e=>{ if(e.target===overlay) close(); });
  window.addEventListener('keydown',e=>{ if(e.key==='Escape' && overlay.style.display==='block') close(); });

  function drawPlayerPreview(ctx){ ctx.save(); ctx.clearRect(0,0,previewCanvas.width,previewCanvas.height); ctx.scale(2.5,2.5); ctx.translate(20,30); // base pos
    // mimic player body using current customization
    const c=MM.customization;
    const bw=14, bh=20; ctx.fillStyle=c.outfitStyle==='default'? '#f4c05a': (c.outfitStyle==='miner'?'#c89b50': c.outfitStyle==='mystic'? '#6b42c7':'#f4c05a'); ctx.fillRect(0,0,bw,bh); ctx.strokeStyle='#4b3212'; ctx.lineWidth=1; ctx.strokeRect(0,0,bw,bh);
    // eyes
    const eyeY=bh*0.35; const eyeW=4; const eyeH=4; const off=4.5; if(c.eyeStyle==='glow'){ ctx.fillStyle='#8bf9ff'; ctx.fillRect(bw/2-off-eyeW/2, eyeY-eyeH/2, eyeW, eyeH); ctx.fillRect(bw/2+off-eyeW/2, eyeY-eyeH/2, eyeW, eyeH); }
    else if(c.eyeStyle==='sleepy'){ ctx.fillStyle='#fff'; ctx.fillRect(bw/2-off-eyeW/2, eyeY-1, eyeW, 2); ctx.fillRect(bw/2+off-eyeW/2, eyeY-1, eyeW, 2); }
    else { ctx.fillStyle='#fff'; ctx.fillRect(bw/2-off-eyeW/2, eyeY-eyeH/2, eyeW, eyeH); ctx.fillRect(bw/2+off-eyeW/2, eyeY-eyeH/2, eyeW, eyeH); ctx.fillStyle='#111'; ctx.fillRect(bw/2-off-eyeW/2+1, eyeY-1,2,2); ctx.fillRect(bw/2+off-eyeW/2+1, eyeY-1,2,2); }
    // simple cape silhouette behind
    drawCapeMini(ctx, c.capeStyle);
    ctx.restore(); }

  function drawCapeMini(ctx, styleId){ const styles={ classic:[4,10], triangle:[3,7], royal:[5,14], tattered:[4,11], winged:[3,12] }; const dims=styles[styleId]||styles.classic; ctx.save(); ctx.fillStyle='#b91818'; ctx.fillRect(-2,2,dims[0],dims[1]); ctx.restore(); }

  function updatePreview(){ drawPlayerPreview(pctx); }

  function drawItemPreview(ctx,item,catKey){ ctx.clearRect(0,0,80,80); if(catKey==='capeStyle'){ ctx.save(); ctx.translate(40,15); ctx.scale(4,4); drawCapeMini(ctx,item.id); ctx.restore(); } else if(catKey==='eyeStyle'){ ctx.fillStyle='#222'; ctx.fillRect(10,22,60,36); ctx.fillStyle='#f4c05a'; ctx.fillRect(25,28,30,30); // head
      if(item.id==='glow'){ ctx.fillStyle='#8bf9ff'; ctx.fillRect(30,40,8,8); ctx.fillRect(42,40,8,8); }
      else if(item.id==='sleepy'){ ctx.fillStyle='#fff'; ctx.fillRect(30,42,8,4); ctx.fillRect(42,42,8,4); }
      else { ctx.fillStyle='#fff'; ctx.fillRect(30,38,8,12); ctx.fillRect(42,38,8,12); ctx.fillStyle='#111'; ctx.fillRect(32,42,4,4); ctx.fillRect(44,42,4,4); }
    } else if(catKey==='outfitStyle'){ ctx.fillStyle=item.id==='miner'? '#c89b50': item.id==='mystic'? '#6b42c7':'#f4c05a'; ctx.fillRect(18,16,44,48); ctx.strokeStyle='#4b3212'; ctx.strokeRect(18,16,44,48); }
  }

  buildTabs();
  updatePreview();
})();
