// Inventory UI — overlay with equipment slots, loot bag, weapons, charms and
// resource management. DOM layer over the core model in inventory.js.
// Replaces the old "Stylizacja" customization panel.
import './inventory.js';
(function(){
  window.MM = window.MM || {};
  if(!MM.modalInput){
    const active=new Set();
    function setModalFlag(){
      if(!document.body) return;
      if(active.size) document.body.dataset.mmModalOpen='true';
      else delete document.body.dataset.mmModalOpen;
    }
    function emit(id){
      try{ window.dispatchEvent(new CustomEvent('mm-modal-input',{detail:{open:active.size>0,id,active:[...active]}})); }catch(e){}
    }
    MM.modalInput={
      push(id){ if(!id) return; const before=active.size; active.add(id); setModalFlag(); if(active.size!==before) emit(id); },
      pop(id){ if(!id || !active.has(id)) return; active.delete(id); setModalFlag(); emit(id); },
      isOpen(){ return active.size>0; }
    };
  }
  const INV=MM.inventory;
  if(!INV) return;

  // UI refs (markup skeleton lives in index.html)
  const openBtn=document.getElementById('openInv');
  const overlay=document.getElementById('invOverlay');
  const closeBtn=document.getElementById('invClose');
  const tabsEl=document.getElementById('invTabs');
  const rightEl=document.getElementById('invRight');
  const grid=document.getElementById('invGrid');
  const slotsEl=document.getElementById('invSlots');
  const previewCanvas=document.getElementById('invPreview');
  const selInfo=document.getElementById('invSelInfo');
  const statsBox=document.getElementById('invStatsBody');
  const colorsEl=document.getElementById('invColors');
  const actionsEl=document.getElementById('invActions');
  if(!overlay||!tabsEl||!grid||!previewCanvas||!slotsEl) return;
  const pctx=previewCanvas.getContext('2d');

  const TIER_COLORS=INV.TIER_COLORS||{common:'#b07f2c', rare:'#a74cc9', epic:'#e0b341'};
  const TIER_LABELS={common:'zwykły', uncommon:'niezwykły', rare:'rzadki', epic:'epicki', legendary:'legendarny'};
  const PRESTIGE_RANK={common:0,uncommon:1,rare:2,epic:3,legendary:4};
  const WEAPON_MATERIALS={
    wood:{body:'#76502b',edge:'#d7aa68',accent:'#ad7436',dark:'#3f2817',grip:'#5b351d'},
    stone:{body:'#727982',edge:'#dce3ea',accent:'#9da6af',dark:'#3c4249',grip:'#654321'},
    steel:{body:'#788694',edge:'#f2f8ff',accent:'#b9c8d6',dark:'#36424c',grip:'#674326'},
    obsidian:{body:'#3c3158',edge:'#c7a4f2',accent:'#7e59b5',dark:'#171020',grip:'#4a2f2b'},
    diamond:{body:'#70c9db',edge:'#f2ffff',accent:'#86f0f2',dark:'#285f72',grip:'#4f5363'},
    iridium:{body:'#7668a7',edge:'#f4eaff',accent:'#b887ff',dark:'#302749',grip:'#403557'},
    aquatic:{body:'#436d7c',edge:'#dffcff',accent:'#62dce7',dark:'#203d4a',grip:'#405764'},
    arc:{body:'#3e5968',edge:'#efffff',accent:'#58eaff',dark:'#1d303a',grip:'#3e434d'},
    exotic:{body:'#62528b',edge:'#fff2b8',accent:'#e7b85b',dark:'#28203d',grip:'#49354d'}
  };
  function prestigeRank(item){ return item&&item.unique?Math.max(3,PRESTIGE_RANK[item.tier]||0):(PRESTIGE_RANK[item&&item.tier]||0); }
  function weaponMaterialProfile(item){
    const name=String(item&&(item.id||item.name)||'').toLowerCase();
    if(item&&item.aquaticStyle) return WEAPON_MATERIALS.aquatic;
    if(/iryd|irid/.test(name)) return WEAPON_MATERIALS.iridium;
    if(/diament|diamond/.test(name)) return WEAPON_MATERIALS.diamond;
    if(/obsyd|obsid/.test(name)) return WEAPON_MATERIALS.obsidian;
    if(/kamie|stone|rock/.test(name)) return WEAPON_MATERIALS.stone;
    if(/drewn|wood|patyk|stick|maczug|club|luk|bow/.test(name)) return WEAPON_MATERIALS.wood;
    if((item&&item.weaponType)==='electric'||/elektr|electric|tesla|laser|plasm/.test(name)) return WEAPON_MATERIALS.arc;
    if(item&&(item.unique||prestigeRank(item)>=3)) return WEAPON_MATERIALS.exotic;
    return WEAPON_MATERIALS.steel;
  }
  function meleeMiniForm(item){
    if(item&&item.aquaticStyle==='trident') return 'trident';
    const name=String(item&&item.name||'').toLowerCase();
    if(/top[oó]r|axe/.test(name)) return 'axe';
    if(/maczug|patyk|club|stick/.test(name)) return 'club';
    if(/dzid|w[łl][oó]cz|spear/.test(name)||Number(item&&item.fireRange)>1) return 'spear';
    return 'sword';
  }
  function drawWeaponPrestigeAura(ctx,item,x,y,radius){
    const rank=prestigeRank(item); if(rank<2) return;
    const col=TIER_COLORS[item.tier]||(rank===4?'#65f4ff':rank===3?'#ffd45c':'#bd75ff');
    const now=performance.now()*0.001, pulse=0.90+Math.sin(now*2.4)*0.10;
    const r=radius*(rank===4?0.62:rank===3?0.54:0.46);
    ctx.save(); ctx.globalCompositeOperation='lighter'; ctx.shadowColor=col; ctx.shadowBlur=rank===4?5:rank===3?3.5:2;
    const glow=ctx.createRadialGradient(x,y,0,x,y,r);
    glow.addColorStop(0,col); glow.addColorStop(0.48,col); glow.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=glow; ctx.globalAlpha=(rank===4?0.075:rank===3?0.055:0.038)*pulse;
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }

  // --- Tabs: one per item kind + resources ---
  const TABS=MM.inventory.SLOTS.map(s=>({key:s.accepts, label:INV.KIND_LABELS[s.accepts]||s.accepts, kind:s.accepts}))
    .concat([{key:'jewels', label:'Juwele'},{key:'resources', label:'Surowce'},{key:'discovery', label:'Odkrycia'}]);
  const TAB_ICONS={cape:'🧥', eyes:'👁️', outfit:'👕', weapon:'⚔️', charm:'🧿', jewels:'💎', resources:'📦', discovery:'🧪'};
  let activeTab=TABS[0];
  let searchText='';
  let tierFilter='all';
  let sortMode='power';
  let selectedJewelKey=null;
  let toolbarEl=null, searchInput=null, tierSelect=null, sortSelect=null, capEl=null, undoBtn=null, newReviewEl=null;

  function isOpen(){ return overlay.style.display==='block'; }

  function setActive(tab){
    activeTab=tab;
    tabsEl.querySelectorAll('.invTabBtn').forEach(b=>{ b.classList.toggle('sel', b.dataset.key===tab.key); });
    buildGrid();
  }
  function buildTabs(){
    tabsEl.innerHTML='';
    TABS.forEach(tab=>{
      const b=document.createElement('button');
      b.className='invTabBtn'; b.dataset.key=tab.key;
      const ic=document.createElement('span'); ic.setAttribute('aria-hidden','true'); ic.textContent=TAB_ICONS[tab.key]||'';
      const lb=document.createElement('span'); lb.textContent=tab.label;
      const cnt=document.createElement('span'); cnt.className='cnt'; cnt.style.display='none';
      b.appendChild(ic); b.appendChild(lb); b.appendChild(cnt);
      b.addEventListener('click',()=>setActive(tab));
      tabsEl.appendChild(b);
    });
    updateTabMeta();
    setActive(activeTab);
  }
  // Per-tab meta: owned count + a cyan dot on tabs that hold unseen loot, so
  // "something new landed" is visible from any tab (standard in loot games).
  function updateTabMeta(){
    const news=INV.newItems? INV.newItems():[];
    tabsEl.querySelectorAll('.invTabBtn').forEach(b=>{
      const tab=TABS.find(t=>t.key===b.dataset.key); if(!tab) return;
      const cnt=b.querySelector('.cnt');
      if(cnt){
        let n=tab.kind? INV.items(tab.kind).length : 0;
        if(tab.key==='discovery' && MM.discovery && MM.discovery.count) n=MM.discovery.count();
        if(tab.key==='jewels') n=(INV.JEWELS||[]).reduce((sum,j)=>sum+Math.max(0,((window.inv||{})[j.key]|0)),0);
        cnt.textContent=n;
        cnt.style.display=((tab.kind || tab.key==='discovery' || tab.key==='jewels') && n)? '' : 'none';
      }
      const has=!!tab.kind && news.some(i=>i.kind===tab.kind);
      let dot=b.querySelector('.dotNew');
      if(has && !dot){ dot=document.createElement('i'); dot.className='dotNew'; b.appendChild(dot); }
      if(!has && dot) dot.remove();
    });
  }
  function ensureToolbar(){
    if(toolbarEl || !rightEl) return;
    toolbarEl=document.createElement('div');
    toolbarEl.id='invToolbar';
    const searchWrap=document.createElement('label');
    searchWrap.className='invSearchWrap';
    searchInput=document.createElement('input');
    searchInput.id='invSearch';
    searchInput.type='search';
    searchInput.placeholder='Szukaj';
    searchInput.autocomplete='off';
    searchInput.addEventListener('input',()=>{
      searchText=searchInput.value.trim().toLowerCase();
      buildGrid();
    });
    searchWrap.appendChild(searchInput);
    tierSelect=document.createElement('select');
    tierSelect.className='invSelect';
    [['all','Wszystkie'],['new','Nowe'],['common','Zwykle'],['uncommon','Niezwykle'],['rare','Rzadkie'],['epic','Epickie'],['legendary','Legendarne']].forEach(([v,t])=>{
      const o=document.createElement('option'); o.value=v; o.textContent=t; tierSelect.appendChild(o);
    });
    tierSelect.addEventListener('change',()=>{ tierFilter=tierSelect.value; buildGrid(); });
    sortSelect=document.createElement('select');
    sortSelect.className='invSelect';
    [['power','Moc'],['tier','Rzadkosc'],['new','Nowe'],['name','Nazwa']].forEach(([v,t])=>{
      const o=document.createElement('option'); o.value=v; o.textContent=t; sortSelect.appendChild(o);
    });
    sortSelect.addEventListener('change',()=>{ sortMode=sortSelect.value; buildGrid(); });
    capEl=document.createElement('div');
    capEl.className='invCapacity';
    undoBtn=document.createElement('button');
    undoBtn.className='invUndoBtn';
    undoBtn.textContent='Cofnij wyrzut';
    undoBtn.addEventListener('click',()=>{
      if(INV.undoDiscard && INV.undoDiscard()){
        if(window.msg) window.msg('Przywrocono ostatni przedmiot');
        refreshAll(true);
      } else if(window.msg) window.msg('Brak przedmiotu do przywrocenia');
    });
    toolbarEl.appendChild(searchWrap);
    toolbarEl.appendChild(tierSelect);
    toolbarEl.appendChild(sortSelect);
    toolbarEl.appendChild(capEl);
    toolbarEl.appendChild(undoBtn);
    rightEl.insertBefore(toolbarEl, grid);
    newReviewEl=document.createElement('div');
    newReviewEl.id='invNewReview';
    rightEl.insertBefore(newReviewEl, grid);
  }
  function updateToolbar(){
    ensureToolbar();
    if(!toolbarEl) return;
    const itemTab=!['resources','discovery','jewels'].includes(activeTab.key);
    searchInput.parentElement.style.display='';
    searchInput.placeholder=itemTab? 'Szukaj przedmiotów…  ( / )'
      : (activeTab.key==='discovery' ? 'Szukaj odkryć…  ( / )' : activeTab.key==='jewels' ? 'Szukaj juweli lub przedmiotów…  ( / )' : 'Szukaj surowców…  ( / )');
    tierSelect.style.display=itemTab?'':'none';
    sortSelect.style.display=itemTab?'':'none';
    tierSelect.value=tierFilter;
    sortSelect.value=sortMode;
    if(activeTab.key==='discovery' && MM.discovery && MM.discovery.progress){
      // journal progress replaces the bag counter on this tab
      const dp=MM.discovery.progress();
      capEl.textContent='🧪 '+dp.count+'/'+dp.total;
      capEl.classList.remove('warn');
      capEl.title='Odkryte sekrety świata';
    } else if(activeTab.key==='jewels'){
      const total=(INV.JEWELS||[]).reduce((sum,j)=>sum+Math.max(0,((window.inv||{})[j.key]|0)),0);
      capEl.textContent='💎 '+total;
      capEl.classList.toggle('warn',total>0);
      capEl.title=total?'Juwele gotowe do użycia':'Brak juweli';
    } else {
      const cap=INV.capacity? INV.capacity():null;
      if(cap){
        capEl.textContent='🎒 '+cap.used+'/'+cap.max;
        capEl.classList.toggle('warn', cap.warning);
        capEl.title=cap.full?'Torba pelna':(cap.free+' wolnych miejsc');
      }
    }
    undoBtn.disabled=!(INV.discardUndoCount && INV.discardUndoCount()>0);
    updateTabMeta();
    buildNewReview();
  }

  // --- Equipment slots panel ---
  function buildSlots(){
    slotsEl.innerHTML='';
    INV.SLOTS.forEach(slot=>{
      const box=document.createElement('div'); box.className='invSlot'; box.tabIndex=0;
      box.title='Przejdź do zakładki: '+(INV.KIND_LABELS[slot.accepts]||slot.label);
      const it=INV.equippedItem(slot.id);
      const ic=document.createElement('span'); ic.className='invSlotIcon'; ic.setAttribute('aria-hidden','true');
      ic.textContent=TAB_ICONS[slot.accepts]||'';
      const lab=document.createElement('div'); lab.className='invSlotLabel'; lab.textContent=slot.label;
      const val=document.createElement('div'); val.className='invSlotVal';
      val.textContent= it? displayName(it) : (slot.emptyLabel||'—');
      if(it && it.tier){ val.style.color=TIER_COLORS[it.tier]||''; }
      box.appendChild(ic); box.appendChild(lab); box.appendChild(val);
      if(!slot.required && it){
        const un=document.createElement('button'); un.className='invSlotUnequip'; un.textContent='×'; un.title='Zdejmij';
        un.addEventListener('click',e=>{ e.stopPropagation(); INV.unequip(slot.id); });
        box.appendChild(un);
      }
      const go=document.createElement('span'); go.className='invSlotGo'; go.setAttribute('aria-hidden','true'); go.textContent='›';
      box.appendChild(go);
      function goto(){ const tab=TABS.find(t=>t.kind===slot.accepts); if(tab) setActive(tab); }
      box.addEventListener('click',goto);
      box.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); goto(); } });
      slotsEl.appendChild(box);
    });
  }

  // --- Item grid ---
  function displayName(item){
    if(item.name) return item.name;
    const slot=INV.slotForKind(item.kind); // slot labels are the singular kind names
    return ((slot && slot.label)||'Przedmiot')+' '+String(item.id).slice(-4);
  }
  function compare(item){ return INV.compareItem ? INV.compareItem(item.id||item) : null; }
  function signed(n){ return n>0 ? '+'+n : String(n); }
  function relationClass(cmp){
    if(!cmp) return 'option';
    if(cmp.bestDelta==null || cmp.bestDelta>0) return 'best';
    if(cmp.equippedDelta!=null && cmp.equippedDelta>0) return 'upgrade';
    if(cmp.bestDelta===0) return 'match';
    return 'worse';
  }
  function verdictText(cmp){
    if(!cmp) return 'Nowa opcja';
    if(cmp.bestDelta==null) return 'Pierwszy taki przedmiot';
    if(cmp.bestDelta>0) return 'Najlepsze w torbie '+signed(cmp.bestDelta);
    if(cmp.equippedDelta!=null && cmp.equippedDelta>0) return 'Lepsze od noszonego '+signed(cmp.equippedDelta);
    if(cmp.bestDelta===0) return 'Remis z najlepszym';
    return 'Słabsze od najlepszego '+signed(cmp.bestDelta);
  }
  function compactVerdict(cmp){
    if(!cmp) return 'Opcja';
    if(cmp.bestDelta==null) return 'Pierwsze';
    if(cmp.bestDelta>0) return 'TOP '+signed(cmp.bestDelta);
    if(cmp.equippedDelta!=null && cmp.equippedDelta>0) return 'UP '+signed(cmp.equippedDelta);
    if(cmp.bestDelta===0) return 'Remis';
    return signed(cmp.bestDelta);
  }
  function compareLine(label,item,delta,score){
    const row=document.createElement('div');
    row.className='invCompareLine '+(delta>0?'up':delta<0?'down':'eq');
    const l=document.createElement('span'); l.textContent=label;
    const v=document.createElement('b');
    if(item) v.textContent=displayName(item)+' · Moc '+score+(delta==null?'':' · '+signed(delta));
    else v.textContent='brak porównania';
    row.appendChild(l); row.appendChild(v);
    return row;
  }
  function comparisonBlock(cmp, compact){
    const box=document.createElement('div');
    box.className=compact?'invCompareMini':'invCompareBlock';
    if(!cmp) return box;
    if(cmp.equipped){
      const label=cmp.equippedComparable?'Noszone':'Noszone (inna rola)';
      box.appendChild(compareLine(label, cmp.equipped, cmp.equippedDelta, cmp.equippedScore));
    } else {
      box.appendChild(compareLine('Noszone', null, null, null));
    }
    if(cmp.bestExisting){
      box.appendChild(compareLine('Najlepsze w torbie', cmp.bestExisting, cmp.bestDelta, cmp.bestScore));
    } else {
      box.appendChild(compareLine('Najlepsze w torbie', null, null, null));
    }
    return box;
  }
  function newComparisons(){
    const items=INV.newItems ? INV.newItems() : (INV.bagItems?INV.bagItems().filter(i=>INV.isNew&&INV.isNew(i.id)):[]);
    return items.map(compare).filter(Boolean).sort((a,b)=>{
      const ar=Math.max(a.bestDelta==null?999:a.bestDelta, a.equippedDelta==null?-999:a.equippedDelta);
      const br=Math.max(b.bestDelta==null?999:b.bestDelta, b.equippedDelta==null?-999:b.equippedDelta);
      return br-ar || b.score-a.score;
    });
  }
  function showNewItems(cmp){
    const target=cmp || newComparisons()[0];
    if(target){
      const tab=TABS.find(t=>t.kind===target.item.kind);
      if(tab) activeTab=tab;
    }
    tierFilter='new';
    sortMode='new';
    searchText='';
    if(searchInput) searchInput.value='';
    setActive(activeTab);
  }
  // One compact, dismissible line — the grid cards carry the per-item badges
  // and comparisons, so the strip only answers "did anything new land, and is
  // any of it an upgrade?" without pushing the collection below the fold.
  function buildNewReview(){
    if(!newReviewEl) return;
    const cmps=newComparisons();
    newReviewEl.innerHTML='';
    if(!cmps.length || ['resources','discovery','jewels'].includes(activeTab.key)){ newReviewEl.style.display='none'; return; }
    newReviewEl.style.display='block';
    const upgrades=cmps.filter(c=>c.isNewBest || c.isEquippedUpgrade).length;
    const head=document.createElement('div'); head.className='invNewReviewHead';
    const title=document.createElement('div');
    const count=document.createElement('b'); count.textContent='✨ Nowe przedmioty: '+cmps.length;
    title.appendChild(count);
    if(upgrades){
      const upgradeCount=document.createElement('span');
      upgradeCount.textContent=upgrades===1? '1 możliwe ulepszenie' : upgrades+' możliwych ulepszeń';
      title.appendChild(upgradeCount);
    }
    const actions=document.createElement('div');
    const show=document.createElement('button'); show.textContent='Pokaż nowe'; show.addEventListener('click',()=>showNewItems(cmps[0]));
    const seen=document.createElement('button'); seen.textContent='Oznacz widziane'; seen.className='sec'; seen.addEventListener('click',()=>{ if(INV.markSeen) INV.markSeen(cmps.map(c=>c.item.id)); refreshAll(true); });
    actions.appendChild(show); actions.appendChild(seen);
    head.appendChild(title); head.appendChild(actions); newReviewEl.appendChild(head);
  }
  function tierRank(item){ return item.tier==='legendary'?5:item.tier==='epic'?4:item.tier==='rare'?3:item.tier==='uncommon'?2:item.tier==='common'?1:0; }
  function itemSearchText(item){
    return [
      item.id, item.name, item.tier, item.unique, item.weaponType, item.desc,
      ...(INV.statChips? INV.statChips(item).map(c=>c.label+' '+c.text):[])
    ].filter(Boolean).join(' ').toLowerCase();
  }
  function matchesFilters(item){
    if(tierFilter==='new' && !(INV.isNew && INV.isNew(item.id))) return false;
    if(['common','uncommon','rare','epic','legendary'].includes(tierFilter) && item.tier!==tierFilter) return false;
    if(searchText && !itemSearchText(item).includes(searchText)) return false;
    return true;
  }
  function sortItems(list){
    return list.slice().sort((a,b)=>{
      if(sortMode==='name') return displayName(a).localeCompare(displayName(b));
      if(sortMode==='tier') return tierRank(b)-tierRank(a) || INV.itemScore(b)-INV.itemScore(a);
      if(sortMode==='new'){
        const na=(INV.isNew&&INV.isNew(a.id))?1:0, nb=(INV.isNew&&INV.isNew(b.id))?1:0;
        return nb-na || INV.itemScore(b)-INV.itemScore(a);
      }
      return INV.itemScore(b)-INV.itemScore(a) || tierRank(b)-tierRank(a);
    });
  }
  function discardItem(item){
    if(!item || !INV.discard) return;
    const valuable=item.tier==='rare' || item.tier==='epic' || item.tier==='legendary' || item.unique;
    if(valuable && !window.confirm('Wyrzucic '+displayName(item)+'?')) return;
    if(INV.discard(item.id) && window.msg) window.msg('Wyrzucono '+displayName(item)+' - mozna cofnac');
  }
  // --- Shared stat presentation: chips + power score (model lives in inventory.js) ---
  // Every place items are shown (grid, loot popup) renders the same compact pills:
  // green = bonus, red = malus, values are clean percentages or small integers.
  function chipsRow(item){
    const box=document.createElement('div'); box.className='invChips';
    (INV.statChips? INV.statChips(item):[]).forEach(ch=>{
      const c=document.createElement('span');
      c.className='chip'+(ch.good?'':' chipBad');
      c.title=ch.label;
      c.textContent=ch.icon+' '+ch.text;
      box.appendChild(c);
    });
    return box;
  }
  // "Moc" line + bar relative to the strongest owned item of the group; cards
  // that aren't equipped show ▲/▼ against the equipped benchmark so an upgrade
  // is obvious before reading a single stat.
  function powerRow(item,maxScore,refScore){
    const score=INV.itemScore? INV.itemScore(item):0;
    const wrap=document.createElement('div'); wrap.className='invPower';
    const line=document.createElement('div'); line.className='invPowerLine';
    const lab=document.createElement('span'); lab.textContent='Moc '+score;
    line.appendChild(lab);
    if(refScore!=null && !INV.isEquipped(item.id)){
      const d=score-refScore;
      const di=document.createElement('span');
      di.className= d>0?'invDeltaUp': d<0?'invDeltaDown':'invDeltaEq';
      di.textContent= d>0? '▲ +'+d : d<0? '▼ '+d : '=';
      di.title='Względem założonego przedmiotu';
      line.appendChild(di);
    }
    wrap.appendChild(line);
    const bar=document.createElement('div'); bar.className='invPowerBar';
    const fill=document.createElement('div');
    fill.style.width=Math.round(100*Math.max(0.04,Math.min(1,score/Math.max(1,maxScore))))+'%';
    bar.appendChild(fill); wrap.appendChild(bar);
    return wrap;
  }
  function makeCard(item,slot,maxScore,refScore){
    const div=document.createElement('div'); div.className='invItem'; div.tabIndex=0;
    const cmp=compare(item);
    const equipped=INV.isEquipped(item.id);
    const isNew=!!(INV.isNew && INV.isNew(item.id));
    if(item.tier && TIER_COLORS[item.tier]) div.style.setProperty('--tier',TIER_COLORS[item.tier]);
    if(equipped) div.classList.add('sel');
    if(isNew) div.classList.add('new',relationClass(cmp));
    // status badges live in one flow row — nothing ever overlaps art or name
    const badges=document.createElement('div'); badges.className='invBadges';
    if(equipped){ const b=document.createElement('span'); b.className='bEq'; b.textContent='✓ W użyciu'; badges.appendChild(b); }
    if(typeof item.enhancement==='number' && item.enhancement){
      const eb=document.createElement('span'); eb.className='bEnh'+(item.enhancement<0?' bad':'');
      eb.textContent='✦ '+(item.enhancement>0?'+':'')+item.enhancement; eb.title='Trwały poziom ulepszenia'; badges.appendChild(eb);
    }
    if(isNew){
      const nb=document.createElement('span'); nb.className='bNew'; nb.textContent='Nowe'; badges.appendChild(nb);
      const vb=document.createElement('span'); vb.className=relationClass(cmp); vb.textContent=compactVerdict(cmp);
      vb.title=verdictText(cmp); badges.appendChild(vb);
    }
    div.appendChild(badges);
    const thumb=document.createElement('div'); thumb.className='invThumb';
    const c=document.createElement('canvas'); c.width=80; c.height=80;
    drawItemThumb(c.getContext('2d'), item);
    thumb.appendChild(c); div.appendChild(thumb);
    const nm=document.createElement('div'); nm.className='nm'; nm.textContent=displayName(item);
    nm.title=displayName(item);
    div.appendChild(nm);
    if(item.tier){
      const tb=document.createElement('div'); tb.className='invTier'; tb.textContent=TIER_LABELS[item.tier]||item.tier;
      tb.style.color=TIER_COLORS[item.tier]||'#ccc'; div.appendChild(tb);
    }
    if(item.unique){
      const ub=document.createElement('div'); ub.className='invTier'; ub.style.color='#ffd54a'; ub.textContent='★ '+item.unique;
      div.appendChild(ub);
    }
    div.appendChild(powerRow(item,maxScore,refScore));
    if(isNew) div.appendChild(comparisonBlock(cmp,true));
    const chips=chipsRow(item);
    if(chips.childNodes.length) div.appendChild(chips);
    if(item.desc){
      const d=document.createElement('div'); d.className='invDesc'; d.textContent=item.desc; d.title=item.desc;
      div.appendChild(d);
    }
    // Action row: equip is the primary action; discard is a guarded icon so the
    // destructive path never competes visually with the constructive one.
    const row=document.createElement('div'); row.className='invItemBtns';
    if(equipped && slot && !slot.required){
      const un=document.createElement('button'); un.textContent='Zdejmij'; un.className='ghost';
      un.addEventListener('click',e=>{ e.stopPropagation(); INV.unequip(slot.id); });
      row.appendChild(un);
    } else if(!equipped){
      const eq=document.createElement('button'); eq.textContent='Załóż';
      eq.addEventListener('click',e=>{ e.stopPropagation(); if(INV.markSeen) INV.markSeen(item.id); INV.equip(item.id); });
      row.appendChild(eq);
    }
    // Weapons: opt in/out of the number-key shortcut cycle (keys 2/3/4)
    if(item.kind==='weapon' && INV.weaponCategory && INV.setShortcut){
      const cat=INV.weaponCategory(item);
      if(cat){
        const on=INV.isShortcut(item.id);
        const sc=document.createElement('button');
        sc.className='tgl'+(on?' on':'');
        sc.textContent=(on?'✓':'○')+' Skrót '+cat.key;
        sc.title= on? 'W skrócie pod klawiszem '+cat.key+' ('+cat.label+') — kliknij, aby wyłączyć'
                    : 'Poza skrótem klawisza '+cat.key+' ('+cat.label+') — kliknij, aby włączyć';
        sc.addEventListener('click',e=>{ e.stopPropagation(); INV.setShortcut(item.id, !on); });
        row.appendChild(sc);
      }
    }
    if(!INV.isBuiltin(item.id)){
      const del=document.createElement('button'); del.textContent='🗑'; del.className='danger';
      del.title='Wyrzuć — można cofnąć'; del.setAttribute('aria-label','Wyrzuć '+displayName(item));
      del.addEventListener('click',e=>{ e.stopPropagation(); discardItem(item); });
      row.appendChild(del);
    }
    if(row.childNodes.length) div.appendChild(row);
    function choose(){ if(INV.markSeen) INV.markSeen(item.id); if(!INV.isEquipped(item.id)) INV.equip(item.id); }
    div.addEventListener('click',choose);
    div.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); choose(); } });
    return div;
  }
  function buildGrid(){
    updateToolbar();
    grid.innerHTML='';
    if(activeTab.key==='jewels'){ buildJewelsGrid(); return; }
    if(activeTab.key==='resources'){ buildResourcesGrid(); return; }
    if(activeTab.key==='discovery'){ buildDiscoveryGrid(); return; }
    const kind=activeTab.kind;
    const list=sortItems(INV.items(kind).filter(matchesFilters));
    if(!list.length){
      const empty=document.createElement('div'); empty.className='invEmpty';
      empty.textContent=searchText || tierFilter!=='all' ? 'Brak wyników' : 'Brak przedmiotów - szukaj w skrzyniach!';
      grid.appendChild(empty);
      return;
    }
    const slot=INV.slotForKind(kind);
    if(kind==='weapon' && INV.WEAPON_CATEGORIES && INV.weaponCategory){ buildWeaponSections(list,slot); return; }
    const sorted=sortItems(list);
    const maxScore=INV.itemScore(sorted[0])||1;
    const eq=INV.equippedItem(slot.id);
    const refScore=eq? INV.itemScore(eq):null;
    sorted.forEach(item=>grid.appendChild(makeCard(item,slot,maxScore,refScore)));
  }
  // Weapons tab: one section per shortcut category (matching keys 2/3/4), each
  // sorted strongest-first; ▲/▼ compares only within the equipped weapon's own
  // category — a bow is never judged against the equipped sword.
  function buildWeaponSections(list,slot){
    const hint=document.createElement('div'); hint.className='invHint';
    hint.textContent='1 = kilof/budowanie. Klawisz kategorii przełącza jej bronie (najmocniejsze u góry); przycisk „Skrót" decyduje, które biorą udział w przełączaniu.';
    grid.appendChild(hint);
    const eq=INV.equippedItem('weapon');
    const eqCat=eq? (INV.weaponCategory(eq)||{}).id : null;
    const groups=INV.WEAPON_CATEGORIES.map(c=>({cat:c, items:[]}));
    const other={cat:{id:'other', label:'Inne', icon:'❔', key:null}, items:[]};
    sortItems(list).forEach(it=>{ const c=INV.weaponCategory(it); const g=c && groups.find(x=>x.cat.id===c.id); (g||other).items.push(it); });
    if(other.items.length) groups.push(other);
    groups.forEach(g=>{
      if(!g.items.length) return;
      const head=document.createElement('div'); head.className='invCatHead';
      const hl=document.createElement('span'); hl.textContent=g.cat.icon+' '+g.cat.label;
      head.appendChild(hl);
      if(g.cat.key){
        const hk=document.createElement('span'); hk.className='key'; hk.textContent='klawisz '+g.cat.key;
        head.appendChild(hk);
      }
      grid.appendChild(head);
      g.items=sortItems(g.items);
      const maxScore=INV.itemScore(g.items[0])||1;
      const refScore=(eq && eqCat===g.cat.id)? INV.itemScore(eq):null;
      g.items.forEach(item=>grid.appendChild(makeCard(item,slot,maxScore,refScore)));
    });
  }

  // --- Jewels: select a stone, inspect its exact odds, then choose a target ---
  function buildJewelsGrid(){
    const wrap=document.createElement('div'); wrap.className='invResources invJewels';
    const jewels=Array.isArray(INV.JEWELS)?INV.JEWELS:[];
    const owned=jewels.filter(j=>Math.max(0,((window.inv||{})[j.key]|0))>0);
    if(!selectedJewelKey || !jewels.some(j=>j.key===selectedJewelKey)) selectedJewelKey=(owned[0]||jewels[0]||{}).key||null;
    const hint=document.createElement('div'); hint.className='invHint';
    hint.textContent='Juwele trwale podnoszą główny parametr wybranego przedmiotu. Każda próba zużywa kamień; dodatnie i ujemne poziomy pozostają po zapisie.';
    wrap.appendChild(hint);
    const cards=document.createElement('div'); cards.className='invResGrid invJewelCards';
    for(const jewel of jewels){
      if(searchText && !String(jewel.label+' '+jewel.desc).toLowerCase().includes(searchText)) continue;
      const count=Math.max(0,((window.inv||{})[jewel.key]|0));
      const card=document.createElement('div'); card.className='invResCard invJewelCard'+(count?'':' zero')+(selectedJewelKey===jewel.key?' selected':'');
      card.style.setProperty('--jewel',jewel.color);
      const top=document.createElement('div'); top.className='invResTop';
      const gem=document.createElement('span'); gem.className='invJewelGem'; gem.setAttribute('aria-hidden','true');
      const lab=document.createElement('span'); lab.className='invResLabel'; lab.textContent=jewel.label; lab.title=jewel.label;
      const cnt=document.createElement('b'); cnt.className='invResCount'; cnt.textContent=count;
      top.appendChild(gem); top.appendChild(lab); top.appendChild(cnt); card.appendChild(top);
      const odds=document.createElement('div'); odds.className='invJewelOdds'; odds.textContent=jewel.desc;
      if(jewel.failDelta<0) odds.classList.add('risk');
      card.appendChild(odds);
      const btns=document.createElement('span'); btns.className='invResBtns';
      const choose=document.createElement('button'); choose.textContent=selectedJewelKey===jewel.key?'Wybrany':'Wybierz'; choose.disabled=!count;
      choose.addEventListener('click',()=>{ selectedJewelKey=jewel.key; buildGrid(); });
      btns.appendChild(choose); card.appendChild(btns); cards.appendChild(card);
    }
    wrap.appendChild(cards);
    const jewel=jewels.find(j=>j.key===selectedJewelKey);
    if(!jewel || Math.max(0,((window.inv||{})[jewel.key]|0))<1){
      const empty=document.createElement('div'); empty.className='invEmpty invJewelEmpty';
      empty.textContent='Pokonuj silnych przeciwników — szansa na jewel rośnie wraz z ich mocą.';
      wrap.appendChild(empty); grid.appendChild(wrap); return;
    }
    let targets=INV.allItems().map(item=>({item,info:INV.enhancementInfo(item.id)})).filter(row=>row.info&&row.info.eligible);
    if(searchText) targets=targets.filter(row=>itemSearchText(row.item).includes(searchText));
    targets.sort((a,b)=>(INV.itemScore(b.item)-INV.itemScore(a.item)) || displayName(a.item).localeCompare(displayName(b.item),'pl'));
    const forge=document.createElement('div'); forge.className='invJewelForge';
    const title=document.createElement('strong'); title.textContent='Użyj: '+jewel.label; forge.appendChild(title);
    if(!targets.length){
      const none=document.createElement('div'); none.className='invHint'; none.textContent='Brak przedmiotu z parametrem, który można ulepszyć.'; forge.appendChild(none);
    } else {
      const select=document.createElement('select'); select.className='invSelect invJewelTarget'; select.setAttribute('aria-label','Przedmiot do ulepszenia');
      for(const row of targets){
        const o=document.createElement('option'); o.value=row.item.id;
        const lv=row.info.level; const levelText=lv?(' ✦ '+(lv>0?'+':'')+lv):' ✦ +0';
        const statLabel=(INV.STAT_LABELS&&INV.STAT_LABELS[row.info.stat])||'Główny parametr';
        const value=['moveSpeedMult','jumpPowerMult','mineSpeedMult','waterMoveSpeedMult'].includes(row.info.stat)
          ? ((Math.round((row.info.value-1)*100)>=0?'+':'')+Math.round((row.info.value-1)*100)+'%')
          : String(row.info.value);
        o.textContent=displayName(row.item)+levelText+' — '+statLabel+': '+value;
        select.appendChild(o);
      }
      const equipped=targets.find(row=>INV.isEquipped(row.item.id)); if(equipped) select.value=equipped.item.id;
      const warning=document.createElement('div'); warning.className='invJewelWarning'+(jewel.failDelta<0?' risk':'');
      warning.textContent=jewel.failDelta<0?'50%: +2. Porażka: trwałe -1.':'Szansa powodzenia: '+Math.round(jewel.chance*100)+'%. Porażka zużywa kamień.';
      const apply=document.createElement('button'); apply.className='invJewelApply'; apply.textContent='Ulepsz przedmiot';
      apply.addEventListener('click',()=>{
        const target=INV.getItem(select.value); if(!target) return;
        if(jewel.failDelta<0 && !window.confirm('Kamień Divinity: 50% na +2, ale porażka obniży '+displayName(target)+' o 1. Kontynuować?')) return;
        const result=INV.applyJewel(target.id,jewel.key);
        if(!result || !result.ok){ if(window.msg) window.msg('Nie udało się użyć kamienia.'); buildGrid(); return; }
        const level=(result.level>0?'+':'')+result.level;
        if(result.success){
          if(window.msg) window.msg('✨ '+displayName(result.item)+' '+(result.delta>0?'+':'')+result.delta+' → poziom '+level);
          try{ if(MM.audio&&MM.audio.play) MM.audio.play('jewel',{priority:true}); }catch(e){}
        } else if(result.delta<0){
          if(window.msg) window.msg('💔 Divinity pękł: '+displayName(result.item)+' -1 → poziom '+level);
          try{ if(MM.audio&&MM.audio.play) MM.audio.play('thud'); }catch(e){}
        } else {
          if(window.msg) window.msg('Kamień rozpadł się bez ulepszenia.');
          try{ if(MM.audio&&MM.audio.play) MM.audio.play('thud'); }catch(e){}
        }
        buildGrid();
      });
      forge.appendChild(select); forge.appendChild(warning); forge.appendChild(apply);
    }
    wrap.appendChild(forge); grid.appendChild(wrap);
  }

  // --- Resources tab: card grid, owned first, searchable; empty stacks dimmed ---
  function buildResourcesGrid(){
    const wrap=document.createElement('div'); wrap.className='invResources';
    const hint=document.createElement('div'); hint.className='invHint';
    hint.textContent='Zebrane surowce — posiadane na górze. „Do paska” przypisuje surowiec do aktywnego slotu paska (5–9, 0).';
    wrap.appendChild(hint);
    const cards=document.createElement('div'); cards.className='invResGrid';
    let list=INV.resources().filter(r=>!r.jewel);
    if(searchText) list=list.filter(r=>String(r.label+' '+r.key).toLowerCase().includes(searchText));
    list=list.slice().sort((a,b)=>((b.count>0)-(a.count>0)) || String(a.label).localeCompare(String(b.label),'pl'));
    if(!list.length){
      const empty=document.createElement('div'); empty.className='invEmpty';
      empty.textContent='Brak surowców pasujących do wyszukiwania';
      cards.appendChild(empty);
    }
    list.forEach(r=>{
      const card=document.createElement('div'); card.className='invResCard'+(r.count>0?'':' zero');
      const top=document.createElement('div'); top.className='invResTop';
      const dot=document.createElement('span'); dot.className='invResDot'; dot.style.background=r.color;
      const lab=document.createElement('span'); lab.className='invResLabel'; lab.textContent=r.label; lab.title=r.label;
      const cnt=document.createElement('b'); cnt.className='invResCount'; cnt.textContent=(r.count|0).toLocaleString('pl-PL');
      top.appendChild(dot); top.appendChild(lab); top.appendChild(cnt);
      card.appendChild(top);
      const btns=document.createElement('span'); btns.className='invResBtns';
      if(r.tile && MM.hotbar && MM.hotbar.assign){
        const hb=document.createElement('button'); hb.textContent='Do paska'; hb.title='Przypisz do aktywnego slotu paska';
        hb.addEventListener('click',()=>{ if(MM.hotbar.assign(MM.hotbar.index(), r.tile) && window.msg) window.msg(r.label+' przypisano do paska'); });
        btns.appendChild(hb);
      }
      [['-1',1],['-10',10]].forEach(([t,n])=>{
        const b=document.createElement('button'); b.textContent=t; b.className='danger'; b.title='Wyrzuć '+n;
        b.disabled=r.count<n;
        b.addEventListener('click',()=>{ INV.dropResource(r.key,n); if(window.updateInventoryHud) window.updateInventoryHud(); buildGrid(); });
        btns.appendChild(b);
      });
      card.appendChild(btns);
      cards.appendChild(card);
    });
    wrap.appendChild(cards);
    // Tools summary (pickaxes live outside equipment slots, switched with 1/2/3)
    const inv=window.inv||{};
    const tools=document.createElement('div'); tools.className='invHint';
    const bedrockDur=Math.max(0, Math.min(10, inv.bedrockPickDurability|0));
    const owned=['podstawowy'].concat(inv.tools && inv.tools.stone?['kamienny']:[], inv.tools && inv.tools.meteor?['meteorytowy']:[], inv.tools && inv.tools.diamond?['diamentowy']:[], inv.tools && inv.tools.bedrock && bedrockDur>0?['macierzysty '+bedrockDur+'/10']:[]);
    tools.textContent='Kilofy: '+owned.join(', ')+' (klawisz 1 przełącza, craft w panelu Rzemiosło). Aktywny: '+((window.player&&window.player.tool)||'basic');
    wrap.appendChild(tools);
    grid.appendChild(wrap);
  }

  // --- Discovery journal tab: the world's secret interactions. Found entries
  // carry their full label; unfound ones show as "???" with only the category
  // and a foggy hint. Cards reuse the resources-grid styling.
  function buildDiscoveryGrid(){
    const wrap=document.createElement('div'); wrap.className='invResources';
    const hint=document.createElement('div'); hint.className='invHint';
    hint.textContent='Dziennik odkryć — sekrety świata zapisują się, gdy naprawdę się wydarzą. Każde nowe odkrycie: +'
      +((MM.discovery && MM.discovery.DISCOVERY_XP)||40)+' XP.';
    wrap.appendChild(hint);
    const all=(MM.discovery && MM.discovery.entries)? MM.discovery.entries():[];
    let list=all;
    if(searchText) list=list.filter(e=>String((e.label||'')+' '+e.cat+' '+e.hint).toLowerCase().includes(searchText));
    if(!list.length){
      const empty=document.createElement('div'); empty.className='invEmpty';
      empty.textContent=all.length? 'Brak odkryć pasujących do wyszukiwania' : 'Dziennik jest pusty';
      wrap.appendChild(empty);
      grid.appendChild(wrap);
      return;
    }
    const cats=[];
    for(const e of list) if(!cats.includes(e.cat)) cats.push(e.cat);
    for(const cat of cats){
      const head=document.createElement('div'); head.className='invCatHead';
      const hl=document.createElement('span'); hl.textContent=cat;
      head.appendChild(hl);
      wrap.appendChild(head);
      const cards=document.createElement('div'); cards.className='invResGrid';
      for(const e of list){
        if(e.cat!==cat) continue;
        const card=document.createElement('div'); card.className='invResCard'+(e.found?'':' zero');
        const top=document.createElement('div'); top.className='invResTop';
        const dot=document.createElement('span'); dot.className='invResDot';
        dot.style.background=e.found? '#7de3a8' : '#4a5262';
        const lab=document.createElement('span'); lab.className='invResLabel';
        lab.textContent=e.found? e.label : '???';
        lab.title=e.found? e.label : 'Jeszcze nieodkryte';
        const cnt=document.createElement('b'); cnt.className='invResCount'; cnt.textContent=e.found?'✓':'?';
        top.appendChild(dot); top.appendChild(lab); top.appendChild(cnt);
        card.appendChild(top);
        const sub=document.createElement('span'); sub.className='invDiscHint'+(e.found?' found':'');
        sub.textContent=e.found? 'Odkryte' : e.hint;
        sub.title=e.found? e.label : e.hint;
        card.appendChild(sub);
        cards.appendChild(card);
      }
      wrap.appendChild(cards);
    }
    grid.appendChild(wrap);
  }

  // --- Thumbnails ---
  function shadeHex(col,delta){ const r=parseInt(col.slice(1,3),16), g=parseInt(col.slice(3,5),16), b=parseInt(col.slice(5,7),16); const cl=v=>Math.min(255,Math.max(0,v)); return '#'+cl(r+delta).toString(16).padStart(2,'0')+cl(g+delta).toString(16).padStart(2,'0')+cl(b+delta).toString(16).padStart(2,'0'); }
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
  // Static cape thumbnail matching the engine's edge styles
  function drawCapeMini(ctx, styleId){
    const st=(MM.cape && MM.cape.getStyle)? MM.cape.getStyle(styleId): {wTop:0.1,wBot:0.24,edge:'straight',shiny:false};
    const col=INV.getColors().cape||'#b91818';
    const topY=12, botY=64; const W=110;
    const wTop=Math.max(5, st.wTop*W/2), wBot=Math.max(7, st.wBot*W/2);
    const cx=40;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx-wTop, topY);
    if(st.edge==='wave'){
      for(let i=1;i<=4;i++){ const t=i/4; const y=topY+(botY-topY)*t; const w=wTop+(wBot-wTop)*t; ctx.quadraticCurveTo(cx-w-4*Math.sin(t*Math.PI*2+1), y-(botY-topY)/8, cx-w, y); }
    } else ctx.lineTo(cx-wBot, botY);
    if(st.edge==='point'){ ctx.lineTo(cx, botY+10); ctx.lineTo(cx+wBot, botY); }
    else if(st.edge==='scallop'){ const n=4; for(let i=1;i<=n;i++){ const x0=cx-wBot+((2*wBot)/n)*(i-1); const x1=cx-wBot+((2*wBot)/n)*i; ctx.quadraticCurveTo((x0+x1)/2, botY+8, x1, botY); } }
    else if(st.edge==='ragged'){ const n=6; for(let i=1;i<=n;i++){ const x=cx-wBot+((2*wBot)/n)*i; ctx.lineTo(x-((2*wBot)/n)/2, botY+(i%2?7:1)); ctx.lineTo(x, botY); } }
    else { ctx.lineTo(cx+wBot, botY); }
    if(st.edge==='wave'){
      for(let i=3;i>=0;i--){ const t=i/4; const y=topY+(botY-topY)*t; const w=wTop+(wBot-wTop)*t; ctx.quadraticCurveTo(cx+w+4*Math.sin(t*Math.PI*2+1), y+(botY-topY)/8, cx+w, y); }
    } else ctx.lineTo(cx+wTop, topY);
    ctx.closePath();
    if(st.shiny){ const g=ctx.createLinearGradient(0,topY,0,botY); g.addColorStop(0,col); g.addColorStop(0.55,shadeHex(col,40)); g.addColorStop(1,shadeHex(col,-20)); ctx.fillStyle=g; }
    else ctx.fillStyle = styleId==='shadow' ? shadeHex(col,-60) : col;
    ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=1; ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.fillRect(cx-wTop-4, topY-3, wTop*2+8, 2);
    ctx.restore();
  }
  function drawWeaponMini(ctx,item){
    const type=item.weaponType||'melee';
    const mat=weaponMaterialProfile(item);
    drawWeaponPrestigeAura(ctx,item,40,40,31);
    if(type==='bow'){ drawBowMini(ctx,item); return; }
    if(type==='harpoon'){ drawHarpoonMini(ctx,item); return; }
    if(type==='flame'||type==='hose'||type==='gas'||type==='electric'){ drawStreamMini(ctx,item,type); return; }
    const col=TIER_COLORS[item.tier]||'#cfd6e4';
    ctx.save();
    ctx.translate(40,40); ctx.rotate(-Math.PI/4);
    const form=meleeMiniForm(item), rank=prestigeRank(item);
    if(form==='trident'){
      ctx.fillStyle=mat.body; ctx.fillRect(-3,-31,6,64);
      ctx.fillStyle=col==='#cfd6e4'?mat.accent:col; ctx.fillRect(-3,-39,6,12); ctx.fillRect(-13,-37,6,15); ctx.fillRect(7,-37,6,15); ctx.fillRect(-13,-28,26,5);
      ctx.restore(); return;
    }
    if(form==='spear'){
      ctx.fillStyle=mat.grip; ctx.fillRect(-2.5,-28,5,65);
      ctx.fillStyle=mat.edge; ctx.beginPath(); ctx.moveTo(0,-42); ctx.lineTo(-9,-27); ctx.lineTo(0,-20); ctx.lineTo(9,-27); ctx.closePath(); ctx.fill();
      ctx.fillStyle=col; ctx.fillRect(-7,-22,14,4);
      if(rank>=3){ ctx.beginPath(); ctx.moveTo(-5,-28); ctx.lineTo(-14,-20); ctx.lineTo(-4,-17); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(5,-28); ctx.lineTo(14,-20); ctx.lineTo(4,-17); ctx.closePath(); ctx.fill(); }
      ctx.restore(); return;
    }
    if(form==='axe'){
      ctx.fillStyle=mat.grip; ctx.fillRect(-3,-17,6,53);
      ctx.fillStyle=mat.edge; ctx.beginPath(); ctx.moveTo(-2,-31); ctx.lineTo(-24,-37); ctx.lineTo(-28,-15); ctx.lineTo(-9,-5); ctx.lineTo(1,-14); ctx.closePath(); ctx.fill();
      if(rank>=3){ ctx.beginPath(); ctx.moveTo(2,-31); ctx.lineTo(24,-36); ctx.lineTo(28,-14); ctx.lineTo(9,-5); ctx.lineTo(-1,-14); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle=col; ctx.fillRect(-7,-18,14,7); ctx.restore(); return;
    }
    if(form==='club'){
      ctx.fillStyle=mat.grip; ctx.fillRect(-3,-8,6,44);
      ctx.fillStyle=col==='#cfd6e4'?mat.body:col; ctx.beginPath(); ctx.moveTo(-8,-38); ctx.lineTo(9,-34); ctx.lineTo(12,-12); ctx.lineTo(3,-3); ctx.lineTo(-10,-8); ctx.lineTo(-13,-28); ctx.closePath(); ctx.fill();
      if(rank>=3){ ctx.fillStyle='#e8eef5'; ctx.fillRect(-17,-29,8,4); ctx.fillRect(9,-21,8,4); ctx.fillRect(-14,-12,8,4); }
      ctx.restore(); return;
    }
    // blade
    const g=ctx.createLinearGradient(0,-30,0,18);
    g.addColorStop(0,mat.edge); g.addColorStop(0.48,mat.accent); g.addColorStop(1,mat.body);
    ctx.fillStyle=g; ctx.beginPath();
    ctx.moveTo(-4,-30); ctx.lineTo(4,-30); ctx.lineTo(3,16); ctx.lineTo(-3,16); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-4,-30); ctx.lineTo(0,-38); ctx.lineTo(4,-30); ctx.closePath(); ctx.fill();
    // guard
    ctx.fillStyle=col==='#cfd6e4'?mat.accent:col; ctx.fillRect(-11,16,22,5);
    // hilt + pommel
    ctx.fillStyle=mat.grip; ctx.fillRect(-2.5,21,5,12);
    ctx.fillStyle=col; ctx.beginPath(); ctx.arc(0,36,4,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }
  function drawBowMini(ctx,item){
    const col=TIER_COLORS[item.tier]||'#9a6a32';
    const mat=weaponMaterialProfile(item);
    ctx.save();
    ctx.translate(40,40);
    if(item.aquaticStyle==='crossbow'){
      ctx.fillStyle=mat.body; ctx.fillRect(-28,-5,48,10);
      ctx.fillStyle=col||mat.accent; ctx.fillRect(10,-8,10,16);
      ctx.fillStyle=mat.grip; ctx.fillRect(-8,5,8,14);
    }
    // limb (arc opening to the left, string on the right)
    ctx.strokeStyle=col; ctx.lineWidth=4; ctx.lineCap='round';
    ctx.beginPath(); ctx.arc(0,0,24,-Math.PI*0.42,Math.PI*0.42); ctx.stroke();
    // string
    const sy=Math.sin(Math.PI*0.42)*24, sx=Math.cos(Math.PI*0.42)*24;
    ctx.strokeStyle='#e8e2d2'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(sx,-sy); ctx.lineTo(sx,sy); ctx.stroke();
    // nocked arrow
    ctx.strokeStyle='#caa472'; ctx.lineWidth=2.5;
    ctx.beginPath(); ctx.moveTo(sx,0); ctx.lineTo(-28,0); ctx.stroke();
    ctx.fillStyle='#dfe6f1';
    ctx.beginPath(); ctx.moveTo(-34,0); ctx.lineTo(-26,-4); ctx.lineTo(-26,4); ctx.closePath(); ctx.fill();
    ctx.fillStyle='#e8e2d2'; ctx.fillRect(sx-5,-3,5,2); ctx.fillRect(sx-5,1,5,2);
    ctx.restore();
  }
  function drawHarpoonMini(ctx,item){
    const col=TIER_COLORS[item.tier]||'#4ea5b8';
    const mat=weaponMaterialProfile(item);
    ctx.save(); ctx.translate(39,42);
    ctx.fillStyle=mat.dark; ctx.fillRect(-29,-8,42,14);
    ctx.fillStyle=col; ctx.fillRect(8,-6,15,10);
    ctx.fillStyle=mat.grip; ctx.fillRect(-10,5,8,15);
    ctx.strokeStyle=mat.body; ctx.lineWidth=4;
    ctx.beginPath(); ctx.moveTo(15,-1); ctx.lineTo(34,-1); ctx.stroke();
    ctx.fillStyle=mat.edge;
    ctx.beginPath(); ctx.moveTo(40,-1); ctx.lineTo(31,-7); ctx.lineTo(33,-1); ctx.lineTo(31,5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // Tank + nozzle device with a spray cone tinted per stream class
  const STREAM_CONES={
    flame:[['rgba(255,245,200,0.95)',0],['rgba(255,170,50,0.8)',0.5],['rgba(255,80,20,0)',1]],
    hose: [['rgba(230,245,255,0.95)',0],['rgba(120,185,255,0.8)',0.5],['rgba(50,110,230,0)',1]],
    gas:  [['rgba(225,255,180,0.9)',0],['rgba(140,220,80,0.75)',0.5],['rgba(70,150,40,0)',1]],
    electric:[['rgba(255,255,255,0.98)',0],['rgba(80,238,255,0.95)',0.45],['rgba(70,130,255,0)',1]]
  };
  const STREAM_BODY={flame:'#8a4a1f', hose:'#1f5fb0', gas:'#3f7a2b', electric:'#1797a8'};
  function drawStreamMini(ctx,item,kind){
    const col=TIER_COLORS[item.tier]||STREAM_BODY[kind]||'#8a4a1f';
    const mat=weaponMaterialProfile(item);
    ctx.save();
    ctx.translate(40,44);
    // fuel/water/toxin tank
    ctx.fillStyle=shadeHex((col.length===7?col:STREAM_BODY[kind]||'#8a4a1f'),-25);
    ctx.fillRect(-26,-8,14,20); ctx.strokeStyle='rgba(255,255,255,.3)'; ctx.strokeRect(-26,-8,14,20);
    // body + grip
    ctx.fillStyle=mat.dark; ctx.fillRect(-14,-6,26,9);
    ctx.fillStyle=mat.grip; ctx.fillRect(-6,3,5,10);
    // nozzle
    ctx.fillStyle=col; ctx.fillRect(12,-5,8,7);
    if(kind==='electric'){
      ctx.lineCap='round';
      ctx.globalCompositeOperation='lighter';
      ctx.strokeStyle='rgba(70,238,255,0.38)'; ctx.lineWidth=9;
      ctx.beginPath(); ctx.moveTo(20,-1); ctx.lineTo(46,-4); ctx.stroke();
      ctx.strokeStyle='rgba(145,250,255,0.95)'; ctx.lineWidth=3.5;
      ctx.beginPath(); ctx.moveTo(20,-1); ctx.lineTo(29,2); ctx.lineTo(37,-5); ctx.lineTo(46,-3); ctx.stroke();
      ctx.strokeStyle='rgba(255,255,255,0.98)'; ctx.lineWidth=1.3;
      ctx.beginPath(); ctx.moveTo(20,-1); ctx.lineTo(46,-3); ctx.stroke();
      ctx.restore();
      return;
    }
    // spray cone
    const g=ctx.createLinearGradient(20,0,46,0);
    (STREAM_CONES[kind]||STREAM_CONES.flame).forEach(([c,t])=>g.addColorStop(t,c));
    ctx.fillStyle=g;
    ctx.beginPath(); ctx.moveTo(20,-2); ctx.quadraticCurveTo(36,-9,46,-6); ctx.quadraticCurveTo(40,0,46,5); ctx.quadraticCurveTo(34,8,20,5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function drawCharmMini(ctx,item){
    const col=TIER_COLORS[item.tier]||'#5fd0c0';
    ctx.save();
    // cord
    ctx.strokeStyle='#9a8156'; ctx.lineWidth=2.5;
    ctx.beginPath(); ctx.arc(40,28,16,Math.PI*0.15,Math.PI*0.85,true); ctx.stroke();
    // medallion
    ctx.fillStyle='#3a3326'; ctx.beginPath(); ctx.arc(40,46,15,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='#9a8156'; ctx.lineWidth=2; ctx.stroke();
    // gem
    const g=ctx.createRadialGradient(36,42,2,40,46,11);
    g.addColorStop(0,'#ffffff'); g.addColorStop(0.35,col); g.addColorStop(1,shadeHex(col,-50));
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(40,46,9,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }
  function drawItemThumb(ctx,item){
    ctx.clearRect(0,0,80,80);
    const c=MM.customization||{};
    if(item.kind==='cape'){ drawCapeMini(ctx,item.id); }
    else if(item.kind==='eyes'){
      ctx.fillStyle='#222'; ctx.fillRect(10,22,60,36); ctx.fillStyle='#f4c05a'; ctx.fillRect(25,28,30,30);
      if(item.id==='glow'){ ctx.fillStyle='rgba(139,249,255,0.25)'; ctx.fillRect(28,38,12,12); ctx.fillRect(40,38,12,12); ctx.fillStyle='#8bf9ff'; ctx.fillRect(30,40,8,8); ctx.fillRect(42,40,8,8); }
      else if(item.id==='sleepy'){ ctx.fillStyle='#fff'; ctx.fillRect(30,42,8,4); ctx.fillRect(42,42,8,4); }
      else if(item.id==='gold'){ ctx.fillStyle='#ffce3a'; ctx.fillRect(30,38,8,12); ctx.fillRect(42,38,8,12); ctx.fillStyle='#5a3b00'; ctx.fillRect(32,42,4,4); ctx.fillRect(44,42,4,4); }
      else { ctx.fillStyle='#fff'; ctx.fillRect(30,38,8,12); ctx.fillRect(42,38,8,12); ctx.fillStyle='#111'; ctx.fillRect(32,42,4,4); ctx.fillRect(44,42,4,4); }
    } else if(item.kind==='outfit'){
      MM.drawOutfit(ctx, 18, 12, 44, 56, item.id, c);
      ctx.save(); ctx.translate(18,12); ctx.scale(44/14, 56/20);
      drawEyesMini(ctx, {outfitStyle:item.id, eyeStyle:c.eyeStyle}, 14, 20);
      ctx.restore();
    } else if(item.kind==='weapon'){ drawWeaponMini(ctx,item); }
    else if(item.kind==='charm'){ drawCharmMini(ctx,item); }
  }

  // --- Animated character preview (cape sim + outfit + eyes + weapon) ---
  const miniCape=[]; const MINI_SEGS=10; for(let i=0;i<MINI_SEGS;i++) miniCape.push({x:0,y:0});
  let miniFacing=1, lastTime=performance.now(), faceTimer=0, faceDir=1;
  function stepMiniCape(styleId,dt){
    const st=(MM.cape && MM.cape.getStyle)? MM.cape.getStyle(styleId): {wTop:0.1,wBot:0.24,flare:1};
    faceTimer+=dt; if(faceTimer>2.2){ faceTimer=0; faceDir*=-1; }
    miniFacing=faceDir;
    const targetFlare=(0.18+0.55)*st.flare;
    const segLen=0.5; miniCape[0].x=0; miniCape[0].y=0;
    for(let i=1;i<MINI_SEGS;i++){
      const prev=miniCape[i-1]; const seg=miniCape[i]; const t=i/(MINI_SEGS-1);
      const backDirX=-miniFacing;
      const wind=Math.sin(performance.now()/300 + i*0.8)*0.04 + Math.sin(performance.now()/1200 + i)*0.02;
      const desiredX=prev.x + backDirX*t*targetFlare + wind*(st.wind||1);
      const desiredY=prev.y + 0.18 + t*0.62;
      seg.x += (desiredX - seg.x)*Math.min(1,dt*9);
      seg.y += (desiredY - seg.y)*Math.min(1,dt*9);
    }
    for(let it=0; it<2; it++){
      for(let i=1;i<MINI_SEGS;i++){
        const a=miniCape[i-1], b=miniCape[i];
        let dx=b.x-a.x, dy=b.y-a.y; let d=Math.hypot(dx,dy)||0.0001;
        const excess=d-segLen;
        if(Math.abs(excess)>0.001){ const k=excess/d; b.x -= dx*k; b.y -= dy*k; }
      }
    }
  }
  function drawCapeAnimated(ctx, styleId, bw, bh){
    const now=performance.now(); const dt=Math.min(0.05,(now-lastTime)/1000); lastTime=now;
    stepMiniCape(styleId,dt);
    ctx.save();
    const anchorX = miniFacing===1 ? 1.5 : bw-1.5;
    const anchorY = bh*0.30;
    ctx.translate(anchorX, anchorY);
    const st=(MM.cape && MM.cape.getStyle)? MM.cape.getStyle(styleId): {wTop:0.1,wBot:0.24};
    const WIDTH_SCALE=40;
    const wTop=st.wTop*WIDTH_SCALE, wBot=st.wBot*WIDTH_SCALE;
    ctx.beginPath();
    for(let i=0;i<MINI_SEGS;i++){ const seg=miniCape[i]; const t=i/(MINI_SEGS-1); const w=wTop+(wBot-wTop)*t; const nx=(miniFacing===1? -seg.x: seg.x); const ny=seg.y; if(i===0){ ctx.moveTo(nx - w, ny); } ctx.lineTo(nx - w, ny); }
    for(let i=MINI_SEGS-1;i>=0;i--){ const seg=miniCape[i]; const t=i/(MINI_SEGS-1); const w=wTop+(wBot-wTop)*t; const nx=(miniFacing===1? -seg.x: seg.x); const ny=seg.y; ctx.lineTo(nx + w, ny); }
    ctx.closePath();
    const capeCol=INV.getColors().cape||'#b91818';
    if(st.shiny){
      const g=ctx.createLinearGradient(0,0,0,miniCape[MINI_SEGS-1].y);
      g.addColorStop(0, capeCol); g.addColorStop(0.55, shadeHex(capeCol,40)); g.addColorStop(1, shadeHex(capeCol,-20));
      ctx.fillStyle=g;
    } else ctx.fillStyle=capeCol;
    ctx.fill(); ctx.restore();
    // Single rAF chain: without the guard every equip click while open would
    // stack one more redraw-per-frame loop onto the preview
    if(!drawCapeAnimated._pending){
      drawCapeAnimated._pending=true;
      requestAnimationFrame(()=>{ drawCapeAnimated._pending=false; if(isOpen()) updatePreview(); });
    }
  }
  function drawWeaponInHand(ctx,bw,bh){
    const it=INV.equippedItem('weapon'); if(!it) return;
    const col=TIER_COLORS[it.tier]||'#cfd6e4';
    const mat=weaponMaterialProfile(it);
    const type=it.weaponType||'melee';
    const meleeForm=type==='melee'?meleeMiniForm(it):'';
    ctx.save();
    const hx= miniFacing===1? bw+0.5 : -0.5;
    ctx.translate(hx, bh*0.62);
    drawWeaponPrestigeAura(ctx,it,miniFacing*2.4,-4.5,8);
    if(type==='bow'){
      ctx.strokeStyle=col==='#cfd6e4'?'#9a6a32':col; ctx.lineWidth=1.2; ctx.lineCap='round';
      const dir=miniFacing===1?1:-1;
      ctx.beginPath(); ctx.arc(0,-2, 5, dir===1?-1.2:Math.PI-1.2, dir===1?1.2:Math.PI+1.2); ctx.stroke();
      ctx.strokeStyle='#e8e2d2'; ctx.lineWidth=0.6;
      const ex=Math.cos(1.2)*5*dir, ey=Math.sin(1.2)*5;
      ctx.beginPath(); ctx.moveTo(ex,-2-ey); ctx.lineTo(ex,-2+ey); ctx.stroke();
      if(it.aquaticStyle==='crossbow'){
        ctx.fillStyle=mat.body; ctx.fillRect(miniFacing===1?-4:-7,-3,11,2.5);
        ctx.fillStyle=mat.grip; ctx.fillRect(-1,-1,2,3);
      }
    } else if(type==='harpoon'){
      ctx.fillStyle=mat.dark; ctx.fillRect(miniFacing===1?-2:-7,-4,9,3);
      ctx.fillStyle=col; ctx.fillRect(miniFacing===1?5:-7,-3.6,3,2.2);
      ctx.strokeStyle=mat.body; ctx.lineWidth=1.3;
      ctx.beginPath(); ctx.moveTo(miniFacing===1?7:-7,-2.5); ctx.lineTo(miniFacing===1?13:-13,-2.5); ctx.stroke();
    } else if(type==='flame'||type==='hose'||type==='gas'||type==='electric'){
      const sprayCol= type==='flame'? ['rgba(255,240,180,0.9)','rgba(255,90,20,0)']
                    : type==='hose'? ['rgba(220,240,255,0.9)','rgba(60,120,230,0)']
                    : type==='electric'? ['rgba(255,255,255,0.95)','rgba(45,230,255,0)']
                    : ['rgba(220,255,170,0.9)','rgba(70,150,40,0)'];
      ctx.fillStyle=mat.dark; ctx.fillRect(miniFacing===1?-1:-4.5, -3.5, 5.5, 2.6);
      ctx.fillStyle=col==='#cfd6e4'?(STREAM_BODY[type]||'#8a4a1f'):col; ctx.fillRect(miniFacing===1?4.5:-6.5, -3.2, 2, 2);
      const fx=miniFacing===1?6.5:-6.5;
      const g=ctx.createLinearGradient(fx,0,fx+miniFacing*6,0);
      g.addColorStop(0,sprayCol[0]); g.addColorStop(1,sprayCol[1]);
      ctx.fillStyle=g;
      ctx.beginPath(); ctx.moveTo(fx,-2.6); ctx.lineTo(fx+miniFacing*6,-1.2); ctx.lineTo(fx+miniFacing*6,0.4); ctx.lineTo(fx,-0.4); ctx.closePath(); ctx.fill();
    } else if(meleeForm==='trident'){
      ctx.rotate(miniFacing===1?-0.5:0.5);
      ctx.fillStyle=mat.body; ctx.fillRect(-0.7,-11,1.4,14);
      ctx.fillStyle=col==='#cfd6e4'?mat.accent:col; ctx.fillRect(-0.7,-13,1.4,3); ctx.fillRect(-3,-12.5,1.2,3.5); ctx.fillRect(1.8,-12.5,1.2,3.5); ctx.fillRect(-3,-10.5,6,1);
    } else if(meleeForm==='spear'){
      ctx.rotate(miniFacing===1?-0.5:0.5);
      ctx.fillStyle=mat.grip; ctx.fillRect(-0.6,-11,1.2,14);
      ctx.fillStyle=mat.edge; ctx.beginPath(); ctx.moveTo(0,-14); ctx.lineTo(-2,-10); ctx.lineTo(2,-10); ctx.closePath(); ctx.fill();
      ctx.fillStyle=col; ctx.fillRect(-1.5,-10.5,3,0.8);
    } else if(meleeForm==='axe'){
      ctx.rotate(miniFacing===1?-0.5:0.5);
      ctx.fillStyle=mat.grip; ctx.fillRect(-0.7,-7,1.4,10);
      ctx.fillStyle=mat.edge; ctx.beginPath(); ctx.moveTo(0,-10); ctx.lineTo(-4,-11); ctx.lineTo(-5,-7); ctx.lineTo(-1,-5); ctx.closePath(); ctx.fill();
      if(prestigeRank(it)>=3){ ctx.beginPath(); ctx.moveTo(0,-10); ctx.lineTo(4,-11); ctx.lineTo(5,-7); ctx.lineTo(1,-5); ctx.closePath(); ctx.fill(); }
    } else if(meleeForm==='club'){
      ctx.rotate(miniFacing===1?-0.5:0.5);
      ctx.fillStyle=mat.grip; ctx.fillRect(-0.7,-6,1.4,9);
      ctx.fillStyle=col==='#cfd6e4'?mat.body:col; ctx.fillRect(-1.8,-11,3.6,6);
    } else {
      ctx.rotate(miniFacing===1? -0.5 : 0.5);
      ctx.fillStyle=mat.edge; ctx.fillRect(-0.7,-9,1.4,9);
      ctx.fillStyle=col==='#cfd6e4'?mat.accent:col; ctx.fillRect(-1.8,0,3.6,1.2);
      ctx.fillStyle=mat.grip; ctx.fillRect(-0.6,1.2,1.2,2.6);
    }
    ctx.restore();
  }
  function drawPlayerPreview(ctx){
    ctx.save(); ctx.clearRect(0,0,previewCanvas.width,previewCanvas.height);
    const SCALE=4.6; ctx.scale(SCALE,SCALE);
    const c=MM.customization; const bw=14, bh=20;
    const areaW=previewCanvas.width/SCALE, areaH=previewCanvas.height/SCALE;
    ctx.translate((areaW-bw)/2, (areaH-bh)/2);
    ctx.fillStyle='rgba(0,0,0,0.30)'; ctx.beginPath(); ctx.ellipse(bw/2, bh+2.5, bw*0.62, 2.2, 0, 0, Math.PI*2); ctx.fill();
    drawCapeAnimated(ctx, c.capeStyle, bw, bh);
    MM.drawOutfit(ctx, 0, 0, bw, bh, c.outfitStyle, c);
    drawEyesMini(ctx, c, bw, bh);
    drawWeaponInHand(ctx, bw, bh);
    ctx.restore();
  }
  function updatePreview(){ drawPlayerPreview(pctx); }

  // --- Stats breakdown ---
  function statRow(label,total,lines){
    const wrap=document.createElement('div');
    const head=document.createElement('div'); head.style.marginTop='4px';
    const labSpan=document.createElement('span'); labSpan.style.color='#fff'; labSpan.textContent=label+': ';
    const strong=document.createElement('strong'); strong.textContent=total;
    head.appendChild(labSpan); head.appendChild(strong); wrap.appendChild(head);
    if(lines && lines.length){
      const ul=document.createElement('ul'); ul.style.margin='2px 0 4px 12px'; ul.style.padding='0';
      lines.forEach(l=>{ const li=document.createElement('li'); li.style.listStyle='disc'; li.textContent=l; ul.appendChild(li); });
      wrap.appendChild(ul);
    }
    return wrap;
  }
  // Multipliers read as clean percentages ("+15%"), matching the item chips —
  // the player never sees a raw 1.15x anywhere.
  function fmtMult(v){ const p=INV.snapPct? INV.snapPct(((v||1)-1)*100) : Math.round(((v||1)-1)*100); return (p>0?'+':'')+p+'%'; }
  function equippedItems(){ return INV.SLOTS.map(s=>INV.equippedItem(s.id)).filter(Boolean); }
  function updateStats(){
    if(!statsBox) return;
    statsBox.innerHTML='';
    const m=MM.activeModifiers||{};
    const sel=equippedItems();
    const label=it=>(it && (it.name||it.id))||'—';
    const dmgLines=[]; sel.forEach(it=>{ if(typeof it.attackDamage==='number' && it.attackDamage) dmgLines.push(label(it)+': +'+it.attackDamage); });
    statsBox.appendChild(statRow('Obrażenia', INV.BASE_ATTACK+(m.attackDamage||0)+' (baza '+INV.BASE_ATTACK+')', dmgLines));
    const VB=INV.VISION_BASE||10;
    const visionPct=v=>fmtMult(v/VB);
    const visionLines=[]; sel.forEach(it=>{ if(typeof it.visionRadius==='number' && it.visionRadius!==VB) visionLines.push(label(it)+': '+visionPct(it.visionRadius)); });
    const vTot=m.visionRadius||VB, vp=visionPct(vTot);
    statsBox.appendChild(statRow('Zasięg widzenia', vTot+(vp==='0%'?'':' ('+vp+')'), visionLines));
    const jumpLines=[]; sel.forEach(it=>{ if(typeof it.airJumps==='number' && it.airJumps!==0) jumpLines.push(label(it)+': +'+it.airJumps+' powietrzny'); });
    statsBox.appendChild(statRow('Całkowite skoki', 1+(m.maxAirJumps||0), jumpLines));
    const moveLines=[]; sel.forEach(it=>{ if(typeof it.moveSpeedMult==='number' && it.moveSpeedMult!==1) moveLines.push(label(it)+': '+fmtMult(it.moveSpeedMult)); });
    statsBox.appendChild(statRow('Prędkość ruchu', fmtMult(m.moveSpeedMult||1), moveLines));
    const waterMoveLines=[]; sel.forEach(it=>{ if(typeof it.waterMoveSpeedMult==='number' && it.waterMoveSpeedMult!==0.5) waterMoveLines.push(label(it)+': '+Math.round(it.waterMoveSpeedMult*100)+'%'); });
    statsBox.appendChild(statRow('Ruch w wodzie', Math.round((m.waterMoveSpeedMult||0.5)*100)+'%', waterMoveLines));
    const jpLines=[]; sel.forEach(it=>{ if(typeof it.jumpPowerMult==='number' && it.jumpPowerMult!==1) jpLines.push(label(it)+': '+fmtMult(it.jumpPowerMult)); });
    statsBox.appendChild(statRow('Moc skoku', fmtMult(m.jumpPowerMult||1), jpLines));
    const mineLines=[]; sel.forEach(it=>{ if(typeof it.mineSpeedMult==='number' && it.mineSpeedMult!==1) mineLines.push(label(it)+': '+fmtMult(it.mineSpeedMult)); });
    statsBox.appendChild(statRow('Szybkość kopania', fmtMult(m.mineSpeedMult||1), mineLines));
    const defensePct=Math.round(Math.max(0,Math.min(0.45,Number(m.damageReductionBonus)||0))*100);
    const defenseLines=[];
    if(MM.progress && MM.progress.stats){
      const st=MM.progress.stats();
      if(st && st.hard){
        const hardReduction=MM.progress.toughnessDamageReduction ? MM.progress.toughnessDamageReduction(st.hard) : Math.min(0.45,st.hard*0.03);
        defenseLines.push('Twardość '+st.hard+': -'+Math.round(hardReduction*100)+'% obrażeń');
      }
    }
    statsBox.appendChild(statRow('Redukcja obrażeń', defensePct+'%', defenseLines));
    const energyInfo=(MM.heroEnergy && typeof MM.heroEnergy.info==='function') ? MM.heroEnergy.info() : null;
    if(energyInfo){
      const energyLines=[];
      sel.forEach(it=>{ if(typeof it.energyCapacityBonus==='number' && it.energyCapacityBonus) energyLines.push(label(it)+': +'+it.energyCapacityBonus+'E'); });
      if(MM.progress && MM.progress.stats){
        const st=MM.progress.stats();
        if(st && st.cap) energyLines.push('Pojemność: +'+(st.cap*25)+'E');
      }
      statsBox.appendChild(statRow('Energia', Math.round(energyInfo.energy)+' / '+Math.round(energyInfo.max), energyLines));
    }
  }
  // Footer = keyboard legend (the equipment rail above already lists what's worn)
  function updateSelInfo(){
    if(!selInfo) return;
    selInfo.textContent='';
    [['E','zamknij'],['Ctrl+←/→','karty'],['/','szukaj']].forEach(([k,t],i)=>{
      if(i) selInfo.appendChild(document.createTextNode('  ·  '));
      const kbd=document.createElement('kbd'); kbd.textContent=k;
      selInfo.appendChild(kbd);
      selInfo.appendChild(document.createTextNode(' '+t));
    });
  }

  // --- Colors ---
  const CAPE_SWATCHES=['#b91818','#1d6fd6','#1f9d44','#7a25c9','#e08a00','#d6336c','#11b5ad','#222831'];
  const OUTFIT_SWATCHES=['#f4c05a','#e0e0e0','#7fb2e5','#9adf7c','#e58f7f','#c9a0ff'];
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
  function buildColors(){
    if(!colorsEl) return; colorsEl.innerHTML='';
    colorsEl.appendChild(buildColorRow('Kolor peleryny', CAPE_SWATCHES, ()=>INV.getColors().cape, col=>INV.setColor('cape',col)));
    colorsEl.appendChild(buildColorRow('Kolor stroju (Podstawowy)', OUTFIT_SWATCHES, ()=>INV.getColors().outfit, col=>INV.setColor('outfit',col)));
  }

  // --- Character development (levels + skill points from engine/progress.js) ---
  function buildProgress(){
    const host=document.getElementById('invProgress'); if(!host) return;
    host.innerHTML='';
    const PR=MM.progress; if(!PR) { host.style.display='none'; return; }
    const lv=PR.level(), pts=PR.points(), st=PR.stats();
    const head=document.createElement('div');
    head.style.cssText='display:flex; justify-content:space-between; align-items:center; font-weight:650;';
    const lvSpan=document.createElement('span'); lvSpan.textContent='Poziom '+lv.level;
    const ptsSpan=document.createElement('span'); ptsSpan.textContent=pts>0? '+'+pts+' pkt do wydania' : 'Punkty: 0';
    if(pts>0) ptsSpan.style.cssText='color:#ffd968; background:rgba(246,201,69,.14); border:1px solid rgba(246,201,69,.45); border-radius:8px; padding:1px 7px; font-size:10px; font-weight:800;';
    head.appendChild(lvSpan); head.appendChild(ptsSpan); host.appendChild(head);
    // XP bar
    const bar=document.createElement('div'); bar.style.cssText='height:6px; background:rgba(255,255,255,.12); border-radius:4px; margin:5px 0 7px; overflow:hidden;';
    const fill=document.createElement('div'); fill.style.cssText='height:100%; width:'+Math.round(100*lv.into/lv.need)+'%; background:linear-gradient(90deg,#2c7ef8,#7df9ff); border-radius:4px;';
    bar.appendChild(fill); host.appendChild(bar);
    const rows=[
      ['vit','Witalność', '+10 HP', st.vit],
      ['str','Siła', '+1 obrażeń', st.str],
      ['agi','Zwinność', '+2% ruch/skok', st.agi],
      ['cap','Pojemność', '+25 energii', st.cap||0],
      ['hard','Twardość', '+1.5 udźwigu / -3% obrażeń, maks. 45%', st.hard||0],
    ];
    rows.forEach(([key,label,effect,val])=>{
      const row=document.createElement('div');
      row.style.cssText='display:flex; align-items:center; gap:6px; font-size:11px; margin:2px 0;';
      const lab=document.createElement('span'); lab.style.flex='1'; lab.textContent=label+' '+val+' ('+effect+')';
      const btn=document.createElement('button'); btn.textContent='+'; btn.disabled=pts<=0;
      btn.title=pts>0? 'Wydaj punkt: '+label : 'Brak punktów — zdobądź poziom';
      btn.style.cssText='width:26px; height:22px; border-radius:7px; border:none; background:'+(pts>0?'linear-gradient(180deg,#27c274,#1d9d5c)':'rgba(255,255,255,.13)')+'; color:#fff; cursor:'+(pts>0?'pointer':'default')+'; font-weight:800; font-size:13px;';
      btn.addEventListener('click',()=>{ PR.spend(key); buildProgress(); });
      row.appendChild(lab); row.appendChild(btn); host.appendChild(row);
    });
    // milestones (compact)
    const ms=PR.milestones();
    const done=ms.filter(m=>m.done).length;
    const mhead=document.createElement('div'); mhead.style.cssText='margin-top:4px; font-size:10px; opacity:.7;';
    mhead.textContent='Osiągnięcia: '+done+'/'+ms.length;
    host.appendChild(mhead);
  }
  window.addEventListener('mm-progress-change',()=>{ if(isOpen()){ buildProgress(); updateStats(); } });

  // --- Actions ---
  function buildActions(){
    if(!actionsEl) return; actionsEl.innerHTML='';
    const rnd=document.createElement('button'); rnd.textContent='🎲 Losuj'; rnd.title='Losowy zestaw z posiadanych przedmiotów';
    rnd.addEventListener('click',()=>{
      const pick=a=>a[Math.floor(Math.random()*a.length)];
      INV.SLOTS.forEach(s=>{ const list=INV.items(s.accepts); if(list.length) INV.equip(pick(list).id); });
      INV.setColor('cape', pick(CAPE_SWATCHES));
      INV.setColor('outfit', pick(OUTFIT_SWATCHES));
    });
    const rst=document.createElement('button'); rst.textContent='↺ Reset'; rst.title='Przywróć domyślne wyposażenie';
    rst.addEventListener('click',()=>{
      INV.SLOTS.forEach(s=>{ if(s.required) INV.equip(s.def); else INV.unequip(s.id); });
      INV.setColor('cape','#b91818'); INV.setColor('outfit','#f4c05a');
    });
    // Declutter: drop looted items strictly weaker (by power score) than what's
    // equipped. Conservative on purpose: built-ins stay, upgrades and side-grades
    // stay, weapons only compare within the equipped weapon's category.
    const clean=document.createElement('button'); clean.textContent='🧹 Wyrzuć gorsze';
    clean.title='Wyrzuca zdobyczne przedmioty słabsze od założonych (startowe i ulepszenia zostają)';
    clean.addEventListener('click',()=>{
      const doomed=[];
      INV.SLOTS.forEach(s=>{
        const eq=INV.equippedItem(s.id); if(!eq) return;
        const eqScore=INV.itemScore(eq);
        INV.items(s.accepts).forEach(it=>{
          if(it.id===eq.id || INV.isBuiltin(it.id) || INV.isEquipped(it.id)) return;
          if(s.accepts==='weapon' && INV.weaponCategory){
            const c1=INV.weaponCategory(it), c2=INV.weaponCategory(eq);
            if(!c1 || !c2 || c1.id!==c2.id) return; // never judge a bow against a sword
          }
          if(INV.itemScore(it)<eqScore) doomed.push(it);
        });
      });
      if(!doomed.length){ if(window.msg) window.msg('Nie ma nic słabszego do wyrzucenia'); return; }
      if(!window.confirm('Wyrzucić '+doomed.length+' przedmiot(ów) słabszych od założonych?')) return;
      doomed.forEach(it=>INV.discard(it.id));
      if(window.msg) window.msg('🧹 Wyrzucono: '+doomed.length+' (słabsze od założonych)');
    });
    actionsEl.appendChild(rnd); actionsEl.appendChild(rst); actionsEl.appendChild(clean);
  }

  // --- Refresh on model changes ---
  // Coalesced to one rebuild per frame: dragging the custom color picker fires
  // dozens of 'input' events per second, each dispatching mm-customization-change,
  // and a full DOM rebuild per event caused layout thrash while the panel was open.
  let refreshQueued=false;
  function refreshAll(force){
    if(!isOpen() && !force) return;
    if(refreshQueued) return;
    refreshQueued=true;
    requestAnimationFrame(()=>{
      refreshQueued=false;
      if(!isOpen()) return;
      updateToolbar(); buildSlots(); buildGrid(); buildColors(); updatePreview(); updateStats(); updateSelInfo(); buildProgress();
    });
  }
  window.addEventListener('mm-inventory-change',refreshAll);
  window.addEventListener('mm-customization-change',refreshAll);
  window.addEventListener('mm-resources-change',()=>{ if(isOpen() && (activeTab.key==='resources'||activeTab.key==='jewels')) refreshAll(); });

  // --- Open / close / focus management ---
  let lastFocus=null;
  function trapFocus(e){
    if(!isOpen() || e.key!=='Tab') return;
    const focusables=[...overlay.querySelectorAll('button,[tabindex]')].filter(el=>!el.disabled);
    if(!focusables.length) return;
    const first=focusables[0], last=focusables[focusables.length-1];
    if(e.shiftKey){ if(document.activeElement===first){ e.preventDefault(); last.focus(); } }
    else { if(document.activeElement===last){ e.preventDefault(); first.focus(); } }
  }
  function open(){
    if(isOpen()) return;
    overlay.style.display='block'; lastFocus=document.activeElement;
    if(MM.modalInput) MM.modalInput.push('inventory');
    ensureToolbar(); updateToolbar(); buildSlots(); buildGrid(); buildColors(); updatePreview(); updateStats(); updateSelInfo(); buildProgress();
    const firstTab=tabsEl.querySelector('.invTabBtn'); if(firstTab) firstTab.focus();
    document.addEventListener('keydown',trapFocus);
  }
  function close(){
    if(!isOpen()) return;
    overlay.style.display='none';
    if(MM.modalInput) MM.modalInput.pop('inventory');
    document.removeEventListener('keydown',trapFocus);
    if(lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function toggle(){ if(isOpen()) close(); else open(); }
  if(openBtn) openBtn.addEventListener('click',open);
  if(closeBtn) closeBtn.addEventListener('click',close);
  overlay.addEventListener('click',e=>{ if(e.target===overlay) close(); });
  function isEditableTarget(t){ if(!t || !t.tagName) return false; const tag=t.tagName; return tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'||t.isContentEditable; }
  // Hold-to-open: a short E tap belongs to the world (ground-drop sweep, mech
  // boarding — see the precedence probes below), but HOLDING E for a beat
  // always lands in the wardrobe, so loot underfoot can't lock the player out.
  const E_HOLD_MS=450;
  let eHoldTimer=null;
  function cancelEHold(){ if(eHoldTimer!=null){ clearTimeout(eHoldTimer); eHoldTimer=null; } }
  function armEHold(){
    cancelEHold();
    eHoldTimer=setTimeout(()=>{
      eHoldTimer=null;
      // fire only into a free screen: another modal (loot inbox, trader…) wins
      if(!isOpen() && !(MM.modalInput && MM.modalInput.isOpen())) open();
    },E_HOLD_MS);
  }
  // the interact key is rebindable (keybinds.js): compare against the logical
  // key so a remapped E follows the player's binding
  function logicalKey(e){
    const k=String(e.key||'').toLowerCase();
    try{ if(window.MM && MM.keybinds && MM.keybinds.translate) return MM.keybinds.translate(k); }catch(err){}
    return k;
  }
  window.addEventListener('keyup',e=>{ if(logicalKey(e)==='e') cancelEHold(); });
  window.addEventListener('blur',cancelEHold);
  window.addEventListener('keydown',e=>{
    if(isOpen()){
      if(e.key==='Escape'){
        e.preventDefault();
        // Esc backs out one layer: clear an active search first, then close
        if(searchInput && document.activeElement===searchInput && searchInput.value){
          searchInput.value=''; searchText=''; buildGrid();
        } else close();
        e.stopImmediatePropagation(); return;
      }
      // !repeat: the still-held E that hold-opened the panel must not close it
      if(!isEditableTarget(e.target) && !e.repeat && logicalKey(e)==='e' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); close(); e.stopImmediatePropagation(); return; }
      if(!isEditableTarget(e.target) && e.key==='/'){
        e.preventDefault();
        if(searchInput){ searchInput.focus(); searchInput.select(); }
        e.stopImmediatePropagation(); return;
      }
      if(e.ctrlKey && (e.key==='ArrowRight' || e.key==='ArrowLeft')){
        e.preventDefault();
        const idx=TABS.indexOf(activeTab);
        let ni=idx + (e.key==='ArrowRight'?1:-1);
        if(ni<0) ni=TABS.length-1; if(ni>=TABS.length) ni=0;
        setActive(TABS[ni]);
      }
      e.stopImmediatePropagation();
      return;
    }
    if(isEditableTarget(e.target)) return;
    if(!e.repeat && logicalKey(e)==='e' && !e.ctrlKey && !e.metaKey && !e.altKey){
      armEHold(); // holding past the tap window opens the wardrobe regardless
      // Machine context wins the interaction key: riding a mech, standing next
      // to a boardable hull or on a pilot chair routes E to the mech handler
      // (main.js keydown) — the wardrobe only opens away from machines.
      try{
        const mechs=window.MM && MM.mechs;
        if(mechs && mechs.wantsInteractKey && mechs.wantsInteractKey(window.player)) return;
        // A ground drop in reach also claims E (manual pickup, drops.js) —
        // the wardrobe only opens with nothing to grab nearby.
        const drops=window.MM && MM.drops;
        if(drops && drops.wantsInteractKey && drops.wantsInteractKey(window.player)) return;
      }catch(err){ /* mech module absent: plain toggle */ }
      cancelEHold(); // a plain tap opens right away — no need for the hold
      toggle();
    }
  });

  buildTabs();
  buildColors();
  buildActions();
  MM.inventoryUI={open, close, toggle, isOpen};
})();
// ESM export (progressive migration)
export const inventoryUI = (typeof window!=='undefined' && window.MM) ? window.MM.inventoryUI : undefined;
export default inventoryUI;
