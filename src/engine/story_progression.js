// The story's narrator-of-goals: a small watcher that turns world state into
// diegetic guidance. It never says "go to X" — it plays one-time world reactions
// (progressionBeats from story_lore) and keeps the task tracker holding exactly
// the goals the story currently implies:
//
//   mentor steps → the two horizons (ice/fire lairs) → the alien passage down to
//   the Third Mole → the Tower of Ambition up to the Sky Gate → the center.
//
// Tasks are DERIVED, re-asserted on a slow tick from hearts/quest phases, so a
// lost save part or a mid-transition reload self-heals. Only the "already played
// this beat" flags persist (snapshot/restore ride the world save).
import { STORY_LORE } from './story_lore.js';

const storyProgression = (function(){
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const MM = root.MM = root.MM || {};
  const BEATS = STORY_LORE.progressionBeats || {};

  const CFG = {
    TICK: 0.75,
    BEAT_GAP: 3.0,
    TASK_SOURCE: 'story',
    TASK_PRIORITY: 70
  };
  const MENTOR_TASKS = {
    watch_area:  {title:'Obserwacja okolicy',      detail:'Stary Kwadrat chce wiedziec, czy teren zachowuje sie grzecznie pod spojrzeniem.'},
    tree_watch_short:{title:'Dowolne drzewo (10 s)',detail:'Wejdz na dowolne drzewo. Zielony licznik nad glowa potwierdzi, ze czas plynie.'},
    tree_watch_long:{title:'Dowolne drzewo (30 s)', detail:'Stan na dowolnym drzewie. Dluga obserwacja sprawdza obserwatora, nie teren.'},
    sand_hide:   {title:'Ukrycie w piasku (30 s)', detail:'Znikniecie tez jest pomiarem. Piasek ma dobre referencje.'},
    water:       {title:'Woda dla mentora',        detail:'Przynies 1 blok wody. Pragnienie albo skrypt - sprawdzimy.'},
    raw_meat:    {title:'Surowe mieso',            detail:'Przynies 1 surowe mieso. Tutorial nie ocenia.'},
    cooked_meat: {title:'Pieczone mieso',          detail:'Upiecz mieso ogniem i wroc, gdy pachnie zwyciestwem.'},
    duel:        {title:'Ostatnia lekcja',         detail:'Pokonaj nauczyciela. On to zaplanowal, wiec sie nie krepuj.'},
    master_stone:{title:'Kamien mistrza',          detail:'Aktywny wulkan gubi kamien mistrza po odpowiednim zamieszaniu.'},
    reward_choice:{title:'Wybor nagrody',          detail:'Wroc do Starego Kwadrata: waz wodny, miotacz ognia albo emiter gazu.'}
  };
  const ARC_TASKS = {
    west: {id:'story:west',   title:'Cisza na zachodzie', detail:'Zachodni wezel odmawia odpowiedzi. Idz w strone chlodu.',   label:'Zachodni Guardian'},
    east: {id:'story:east',   title:'Zar na wschodzie',   detail:'Wschodni wezel plonie bez ujscia. Idz w strone goraca.',    label:'Wschodni Guardian'},
    gate: {id:'story:gate',   title:'Oddech pod mapa',    detail:'Obcy korytarz schodzi do snu Trzeciego Kreta.',             label:'Podziemna brama'},
    sky:  {id:'story:sky',    title:'Wieza ambicji',      detail:'Wschody prowadza nad plansze, do bramy nieba.',             label:'Wieza ambicji'},
    center:{id:'story:center',title:'Srodek',             detail:'Wroc tam, gdzie uslyszales pierwsza prosbe o wode.',        label:'Obelisk'}
  };

  const state = {
    seen: {},        // beat id -> 1 (persisted)
    tickAcc: 0,
    beatQueue: [],   // pending staged lines {t,text}
    lastTaskIds: []
  };

  function say(t){ try{ if(root.msg) root.msg(t); }catch(e){} }
  function tasksApi(){ return MM.tasks || null; }
  function heartsNow(){
    try{ if(MM.progress && MM.progress.guardianHearts) return MM.progress.guardianHearts() || {}; }catch(e){}
    const inv = root.inv || {};
    const out = {};
    if((Number(inv.heartFire)||0)>0) out.fire = 1;
    if((Number(inv.heartIce)||0)>0) out.ice = 1;
    if((Number(inv.heartEarth)||0)>0) out.earth = 1;
    if((Number(inv.heartAir)||0)>0) out.air = 1;
    if((Number(inv.heartMother)||0)>0) out.mother = 1;
    return out;
  }
  function mentorApi(){
    try{
      if(MM.npcs && MM.npcs.mentor) return MM.npcs.mentor;
      if(MM.tutorialNpc) return MM.tutorialNpc;
    }catch(e){}
    return null;
  }
  function mentorSummary(){
    const api = mentorApi();
    if(!api || typeof api.summary!=='function') return null;
    try{ return api.summary(); }catch(e){ return null; }
  }
  function playBeat(id,lines){
    if(state.seen[id]) return false;
    state.seen[id] = 1;
    let at = 0.6;
    for(const line of (Array.isArray(lines)?lines:[lines])){
      const text = String(line||'').trim();
      if(!text) continue;
      state.beatQueue.push({t:at, text});
      at += CFG.BEAT_GAP;
    }
    try{ if(typeof root.__mmMarkWorldChanged === 'function') root.__mmMarkWorldChanged('story_progression'); }catch(e){}
    return true;
  }
  function tickBeats(dt){
    for(let i=state.beatQueue.length-1;i>=0;i--){
      const b=state.beatQueue[i];
      b.t-=dt;
      if(b.t<=0){
        state.beatQueue.splice(i,1);
        say(b.text);
      }
    }
  }

  function lairTarget(kind){
    try{
      if(MM.guardianLairs && MM.guardianLairs.layoutFor){
        const L = MM.guardianLairs.layoutFor(kind);
        if(L && Number.isFinite(Number(L.ax))) return {x:L.ax+0.5, y:(Number(L.floorY)||60)-2};
      }
    }catch(e){}
    return null;
  }
  function gateTarget(){
    try{
      if(MM.guardianLairs && MM.guardianLairs.status){
        const s = MM.guardianLairs.status();
        const u = s && s.underground;
        if(u && u.enabled && Number.isFinite(Number(u.mouthX))) return {x:Number(u.mouthX)+0.5, y:Number(u.mouthY)||60};
        if(u && Number.isFinite(Number(u.x))) return {x:Number(u.x)+0.5, y:Number(u.y)||60};
      }
    }catch(e){}
    return null;
  }
  function skyTarget(){
    try{
      if(MM.skyGuardian && MM.skyGuardian.layoutFor){
        const L = MM.skyGuardian.layoutFor();
        if(L && Number.isFinite(Number(L.ax))){
          let surface = 60;
          try{ if(MM.worldGen && MM.worldGen.surfaceHeight) surface = Math.round(MM.worldGen.surfaceHeight(Math.round(L.ax))); }catch(e){}
          return {x:L.ax+0.5, y:surface-1};
        }
      }
    }catch(e){}
    return null;
  }
  function centerTarget(){
    try{
      if(MM.centerGuardian && MM.centerGuardian.callTarget) return MM.centerGuardian.callTarget();
    }catch(e){}
    return null;
  }

  function upsertStoryTask(def,target){
    const tasks = tasksApi();
    if(!tasks || typeof tasks.upsert!=='function') return null;
    const src = {
      id:def.id,
      source:CFG.TASK_SOURCE,
      kind:'arc',
      title:def.title,
      detail:def.detail,
      priority:CFG.TASK_PRIORITY,
      pointer:!!target,
      target:target ? {x:target.x, y:target.y, label:def.label||def.title} : null
    };
    return tasks.upsert(src);
  }
  function syncStoryTasks(desired){
    const tasks = tasksApi();
    if(!tasks) return;
    const keep = new Set();
    for(const d of desired){
      if(!d) continue;
      keep.add(d.def.id);
      upsertStoryTask(d.def, d.target);
    }
    // Retire story tasks the arc no longer implies.
    if(typeof tasks.activeList==='function' && typeof tasks.complete==='function'){
      for(const t of tasks.activeList()){
        if(t && t.source===CFG.TASK_SOURCE && !keep.has(t.id)) tasks.complete(t.id);
      }
    }
  }
  function mentorTaskFor(summary){
    if(!summary || !summary.phase) return null;
    const meta = MENTOR_TASKS[summary.phase];
    if(!meta) return null;
    let detail = meta.detail;
    if(summary.required && Number.isFinite(Number(summary.required.have)) && Number(summary.required.amount)>0){
      const amount=Number(summary.required.amount);
      const have=Math.min(Number(summary.required.have),amount);
      const suffix=summary.observe && summary.observe.mode==='tree_top'
        ? (summary.observe.active ? ' - naliczanie trwa' : ' - wejdz na korone drzewa')
        : '';
      detail = meta.detail+' ('+have+'/'+amount+')'+suffix;
    }
    const def = {id:'story:mentor', title:'Stary Kwadrat: '+meta.title, detail, label:'Stary Kwadrat'};
    const anywhere=summary.phase==='tree_watch_short' || summary.phase==='tree_watch_long';
    const target = !anywhere && (Number.isFinite(Number(summary.x)) && Number.isFinite(Number(summary.y)))
      ? {x:Number(summary.x), y:Number(summary.y)} : null;
    return {def, target};
  }

  function centerPhase(){
    try{
      if(MM.centerGuardian && MM.centerGuardian.status) return MM.centerGuardian.status().phase || 'dormant';
    }catch(e){}
    return 'dormant';
  }

  function evaluate(getTile,setTile){
    const hearts = heartsNow();
    const summary = mentorSummary();
    const mentorDone = !summary || summary.phase==='done' || summary.status==='completed';
    const desired = [];

    // The center's call outranks everything, including an unfinished tutorial:
    // once the sky falls, the world has exactly one direction left.
    const phase = centerPhase();
    const centerActive = hearts.air && !hearts.mother &&
      (phase==='calling' || phase==='reveal' || phase==='battle');
    if(centerActive){
      desired.push({def:ARC_TASKS.center, target:centerTarget()});
    } else if(!mentorDone){
      desired.push(mentorTaskFor(summary));
    } else if(!hearts.ice || !hearts.fire){
      playBeat('horizons', BEATS.horizons);
      if(!hearts.ice) desired.push({def:ARC_TASKS.west, target:lairTarget('ice')});
      if(!hearts.fire) desired.push({def:ARC_TASKS.east, target:lairTarget('fire')});
      if(hearts.ice) playBeat('ice', BEATS.ice);
      if(hearts.fire) playBeat('fire', BEATS.fire);
    } else if(!hearts.earth){
      playBeat('ice', BEATS.ice);
      playBeat('fire', BEATS.fire);
      playBeat('gate', BEATS.gate);
      // Self-heal the passage if the defeat-time hook was missed (old save).
      try{
        if(MM.guardianLairs && MM.guardianLairs.enableUndergroundGate) MM.guardianLairs.enableUndergroundGate(getTile,setTile);
      }catch(e){}
      desired.push({def:ARC_TASKS.gate, target:gateTarget()});
    } else if(!hearts.air){
      playBeat('earth', BEATS.earth);
      // The tower rises with the earth beat: materialize the sky arena (with its
      // ladder spire) so ambition is visible from the ground.
      try{
        if(MM.skyGuardian && MM.skyGuardian.materializeArena) MM.skyGuardian.materializeArena(getTile,setTile);
      }catch(e){}
      desired.push({def:ARC_TASKS.sky, target:skyTarget()});
    }
    // hearts.air with the center still dormant: the false-final omen (played by
    // the center guardian) carries the beat until the call opens the final goal.
    syncStoryTasks(desired.filter(Boolean));
  }

  function update(dt,player,getTile,setTile){
    if(!(dt>0) || !Number.isFinite(dt)) return;
    dt=Math.min(2,dt); // slow watcher: no physics to protect, just avoid huge jumps
    tickBeats(dt);
    state.tickAcc+=dt;
    if(state.tickAcc<CFG.TICK) return;
    state.tickAcc=0;
    evaluate(getTile,setTile);
  }

  function snapshot(){
    return {v:1, seen:Object.assign({},state.seen)};
  }
  function restore(data){
    state.seen={};
    state.beatQueue.length=0;
    state.tickAcc=0;
    if(!data || typeof data!=='object') return false;
    if(data.seen && typeof data.seen==='object'){
      for(const k of Object.keys(data.seen)){
        if(data.seen[k]) state.seen[String(k).slice(0,32)]=1;
      }
    }
    return true;
  }
  function reset(){
    state.seen={};
    state.beatQueue.length=0;
    state.tickAcc=0;
    try{
      const tasks=tasksApi();
      if(tasks && tasks.removeSource) tasks.removeSource(CFG.TASK_SOURCE);
    }catch(e){}
  }
  function metrics(){
    return {seen:Object.keys(state.seen).length, queued:state.beatQueue.length};
  }
  function _debug(){ return {state, evaluate, playBeat, ARC_TASKS, MENTOR_TASKS}; }

  const api={update, snapshot, restore, reset, metrics, config:CFG, _debug};
  MM.storyProgression=api;
  return api;
})();

export { storyProgression };
export default storyProgression;
