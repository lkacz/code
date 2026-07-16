import { T } from '../constants.js';
import { createQuestNpc } from './npc_system.js';
import { STORY_LORE } from './story_lore.js';

const MAX_HP = 28;
const QUEST_BOW = {
  id:'mentor_bow_wood',
  kind:'weapon',
  weaponType:'bow',
  name:'Luk Starego Kwadrata',
  tier:'common',
  attackDamage:4,
  fireCooldown:0.50,
  desc:'Prosty drewniany luk od starego mentora.'
};
const STREAM_REWARDS = [
  {
    key:'1',
    id:'mentor_water_hose',
    kind:'weapon',
    weaponType:'hose',
    name:'Waz Ratunkowy Starego Kwadrata',
    tier:'rare',
    fireDps:4,
    fireRange:7.0,
    desc:'Questowy waz wodny: gasi, spycha i ujarzmia lawe po lekcji z wulkanem.'
  },
  {
    key:'2',
    id:'mentor_flamethrower',
    kind:'weapon',
    weaponType:'flame',
    name:'Miotacz Wulkaniczny Starego Kwadrata',
    tier:'rare',
    fireDps:8,
    fireRange:7.0,
    desc:'Questowy miotacz ognia: pali mocniej niz zwykla wersja i topi teren.'
  },
  {
    key:'3',
    id:'mentor_gas_emitter',
    kind:'weapon',
    weaponType:'gas',
    name:'Emiter Siarkowy Starego Kwadrata',
    tier:'rare',
    fireDps:7,
    fireRange:6.5,
    desc:'Questowy emiter gazu: stawia trujace oblokowe problemy tam, gdzie celujesz.'
  }
];
const LORE_TUTORIAL = STORY_LORE.tutorial;
const TREE_SHORT_REWARD = {
  once:'tree_watch_short_chest',
  // Keep the physical reward close and vertical. The old sideways launch could
  // throw it several tiles down a slope from a tall tree, making a successful
  // quest look unrewarded.
  chest:{tier:'uncommon',source:'mentor_tree_watch_short',offsetX:0.8,offsetY:-0.8,vx:0,vy:0},
  data:{pendingTreeShortChest:false},
  failureLine:'Skrzynia nie ma gdzie bezpiecznie wyladowac. Zrob odrobine miejsca i wejdz na drzewo jeszcze raz.',
  message:'Proba 10 s zaliczona: niezwykla skrzynia spada tuz obok ciebie.',
  line:'Dziesiec sekund i ani jednego oszustwa grawitacji. Skrzynia spada tuz obok; teraz dluzsza proba.'
};
const TREE_LONG_REWARD = {
  once:'tree_watch_long_master_stone',
  resources:{masterStone:1},
  data:{pendingTreeLongStone:false},
  message:'Proba 30 s zaliczona: otrzymujesz 1 kamien mistrza.',
  line:'Kamien mistrza jest twoj. Wrzuc go do duzego zbiornika wody albo ukryj wsrod co najmniej 5 polaczonych lisci, aby przywolac pomocnika.',
  lineT:8
};
const QUEST_STEPS = [
  {
    id:'watch_area',
    kind:'observe',
    mode:'scan_area',
    label:'obserwacja okolicy',
    seconds:12,
    next:'tree_watch_short',
    prompt:LORE_TUTORIAL.watchArea.prompt,
    missing:LORE_TUTORIAL.watchArea.missing,
    progress:'Patrz jeszcze chwile. Najgorsze prawdy pojawiaja sie jako brak dowodu.',
    complete:LORE_TUTORIAL.watchArea.complete
  },
  {
    id:'tree_watch_short',
    kind:'observe',
    mode:'tree_top',
    label:'czubek drzewa',
    seconds:10,
    next:'tree_watch_long',
    prompt:LORE_TUTORIAL.treeWatchShort.prompt,
    missing:LORE_TUTORIAL.treeWatchShort.missing,
    progress:'Nie ruszaj sie. Drzewo liczy ciezar, a ja licze sekundy.',
    complete:LORE_TUTORIAL.treeWatchShort.complete,
    reward:TREE_SHORT_REWARD
  },
  {
    id:'tree_watch_long',
    kind:'observe',
    mode:'tree_top',
    label:'dluga obserwacja drzewa',
    seconds:30,
    next:'sand_hide',
    prompt:LORE_TUTORIAL.treeWatchLong.prompt,
    missing:LORE_TUTORIAL.treeWatchLong.missing,
    progress:'Dluzej. Jesli swiat udaje cierpliwosc, musi sie w koncu zmeczyc.',
    complete:LORE_TUTORIAL.treeWatchLong.complete,
    reward:TREE_LONG_REWARD
  },
  {
    id:'sand_hide',
    kind:'observe',
    mode:'sand_hide',
    label:'ukrycie w piasku',
    seconds:30,
    next:'water',
    prompt:LORE_TUTORIAL.sandHide.prompt,
    missing:LORE_TUTORIAL.sandHide.missing,
    progress:'Cicho. Piasek jest tani, ale ma dobre referencje jako zaslona.',
    complete:LORE_TUTORIAL.sandHide.complete
  },
  {
    id:'water',
    kind:'handoff',
    item:'water', amount:1, next:'raw_meat',
    prompt:[
      'Hej, nowy kwadracie. Teraz normalna czesc: przynies mi 1 blok wody. Mam pragnienie jak pustynia po eksperymencie.',
      'Skoro swiat jeszcze udaje stabilny, przynies 1 blok wody. Tak, blok. Nie pytaj fizyki o godnosc.',
      'Dobrze. Potrzebuje 1 bloku wody. Jesli woda da sie nosic jak kostka, to tez jest dowod.'
    ],
    missing:[
      'Wode wydobywa sie jak blok. Tak, to brzmi podejrzanie, ale dziala.',
      'Przynies 1 blok wody. W tej warstwie rzeczy lubia byc kwadratowe, nawet gdy nie powinny.',
      'Bez wody nie sprawdzimy, czy pragnienie jest funkcja organizmu, czy skryptu.'
    ],
    complete:[
      'Glup! Dobra woda. Teraz przynies surowe mieso. Naukowo, oczywiscie.',
      'Woda przyjeta. Jesli to byla czesc symulacji, smakowala bardzo mokro. Teraz mieso.',
      'Tak. Blok wody zniknal w mentorze. To normalne zdanie w tym swiecie. Przynies mieso.'
    ]
  },
  {
    id:'raw_meat',
    kind:'handoff',
    item:'meat', amount:1, next:'cooked_meat',
    prompt:'Potrzebuje 1 surowego miesa. Nie pytaj z czego. Tutorial nie ocenia.',
    missing:'Surowe mieso wypada ze zwierzat. Badz mily, ale skuteczny.',
    complete:'Mieso jest. Nie zjem go, bo mam standardy. Upiecz je.'
  },
  {
    id:'cooked_meat',
    kind:'handoff',
    item:'bakedMeat', amount:1, next:'duel',
    prompt:'Teraz przynies 1 pieczone mieso. Ognia uzywaj odpowiedzialnie, czyli daleko ode mnie.',
    missing:'Upiecz mieso ogniem. Jak zacznie pachniec zwyciestwem, wroc.',
    complete:'Chrup. Swietne. Ostatnia lekcja: pokonaj nauczyciela.'
  },
  {
    id:'duel',
    kind:'duel',
    prompt:'Ostatnia lekcja: traf mentora.',
    complete:'Au. Dobrze. Masz luk. Uzywaj go madrzej niz ja uzywam kolan.'
  },
  {
    id:'master_stone',
    kind:'handoff',
    item:'masterStone', amount:1, next:'reward_choice',
    prompt:'Dobra, masz luk. Teraz znajdz wulkan i przynies 1 kamien mistrza. Nie liz go.',
    missing:'Kamien mistrza wypada z aktywnego wulkanu po odpowiednim zamieszaniu. Pomaranczowy, teatralny, niebezpieczny.',
    complete:'Oho. Kamien mistrza. Czyli jednak przezyles spacer do wulkanu.'
  },
  {
    id:'reward_choice',
    kind:'choice',
    prompt:'Wybierz nagrode: 1 waz wodny, 2 miotacz ognia, 3 emiter gazu.',
    missing:'Podejdz blizej i wybierz: 1 waz wodny, 2 miotacz ognia, 3 emiter gazu.',
    complete:'Dobra decyzja. Albo przynajmniej decyzja.'
  },
  {
    id:'done',
    kind:'done',
    prompt:'Pamietaj: wulkan uczy pokory, a mentor tylko udaje, ze mial plan.'
  }
];

function safeTile(getTile,x,y){
  try{ return getTile ? getTile(Math.floor(x),Math.floor(y)) : T.AIR; }catch(e){ return T.AIR; }
}
function isTreeMaterial(t){
  return t===T.WOOD || t===T.LEAF || t===T.AUTUMN_LEAF_ORANGE || t===T.AUTUMN_LEAF_RED;
}
function treeSupportAtPlayer(player,getTile){
  const px=Number(player && player.x), py=Number(player && player.y);
  if(!Number.isFinite(px) || !Number.isFinite(py)) return null;
  const width=Math.max(0.2,Math.min(1.8,Number(player.w)||0.7));
  const height=Math.max(0.2,Math.min(2.5,Number(player.h)||0.95));
  const bottom=py+height*0.5;
  const supportY=Math.floor(bottom+0.12);
  const gap=supportY-bottom;
  // A tile merely somewhere below the hero is not enough: the feet have to be
  // resting on its top edge. This also prevents mid-jump progress exploits.
  if(gap < -0.08 || gap > 0.16) return null;
  const inset=Math.min(0.08,width*0.22);
  const samples=[px-width*0.5+inset,px,px+width*0.5-inset];
  const seen=new Set();
  for(const sx of samples){
    const tx=Math.floor(sx);
    if(seen.has(tx)) continue;
    seen.add(tx);
    const tile=safeTile(getTile,tx,supportY);
    if(isTreeMaterial(tile)) return {x:tx,y:supportY,tile};
  }
  return null;
}
function connectedTreeAt(startX,startY,getTile){
  const queue=[{x:startX,y:startY}];
  const seen=new Set([startX+','+startY]);
  const dirs=[[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
  let cells=0,wood=0;
  while(queue.length && cells<72){
    const cell=queue.shift();
    const tile=safeTile(getTile,cell.x,cell.y);
    if(!isTreeMaterial(tile)) continue;
    cells++;
    if(tile===T.WOOD) wood++;
    for(const [dx,dy] of dirs){
      const x=cell.x+dx, y=cell.y+dy;
      if(Math.abs(x-startX)>5 || Math.abs(y-startY)>7) continue;
      const key=x+','+y;
      if(seen.has(key)) continue;
      seen.add(key);
      if(isTreeMaterial(safeTile(getTile,x,y))) queue.push({x,y});
    }
  }
  return wood>0 && cells>=3;
}
function treeCanopyContactAtPlayer(player,getTile){
  const px=Number(player && player.x), py=Number(player && player.y);
  if(!Number.isFinite(px) || !Number.isFinite(py)) return null;
  const width=Math.max(0.2,Math.min(1.8,Number(player.w)||0.7));
  const height=Math.max(0.2,Math.min(2.5,Number(player.h)||0.95));
  const minX=Math.floor(px-width*0.5+0.035);
  const maxX=Math.floor(px+width*0.5-0.035);
  const minY=Math.floor(py-height*0.5+0.035);
  const maxY=Math.floor(py+height*0.5-0.035);
  for(let y=minY;y<=maxY;y++){
    for(let x=minX;x<=maxX;x++){
      const tile=safeTile(getTile,x,y);
      if(isTreeMaterial(tile) && connectedTreeAt(x,y,getTile)) return {x,y,tile};
    }
  }
  return null;
}
function mentorObserveCheck(step,player,getTile,setTile,ctx,state){
  void setTile; void ctx;
  if(!player || !Number.isFinite(Number(player.x)) || !Number.isFinite(Number(player.y))) return false;
  const mode=step && step.mode;
  if(mode==='scan_area'){
    const dx=Math.abs(Number(player.x)-Number(state.x));
    const dy=Math.abs(Number(player.y)-Number(state.y));
    return dx>=4 && dx<=20 && dy<=8;
  }
  const tx=Math.floor(Number(player.x));
  const footY=Math.floor(Number(player.y)+1.05);
  if(mode==='tree_top'){
    // Natural leaves are intentionally passable. Count either a proper perch
    // on wood or direct body contact with a connected crown/trunk, otherwise a
    // player visibly inside the tree receives no timer feedback at all.
    return !!(treeSupportAtPlayer(player,getTile) || treeCanopyContactAtPlayer(player,getTile));
  }
  if(mode==='sand_hide'){
    return safeTile(getTile,tx,footY)===T.SAND || safeTile(getTile,tx,footY-1)===T.SAND;
  }
  return false;
}

function drawMentorObservationSignal(api,ctx,tileSize,player,visible,clockMs){
  if(!ctx || !player || visible===false || !api || typeof api.summary!=='function') return false;
  const phase=typeof api.phase==='function' ? api.phase() : '';
  if(!['tree_watch_short','tree_watch_long'].includes(phase)) return false;
  const summary=api.summary();
  const observation=summary && summary.observe;
  if(!observation || !observation.active) return false;
  const seconds=Math.max(0.1,Number(observation.seconds)||1);
  const progress=Math.max(0,Math.min(seconds,Number(observation.progress)||0));
  const ratio=progress/seconds;
  const tile=Math.max(8,Number(tileSize)||20);
  const size=Math.max(10,Math.min(28,tile));
  const px=Number(player.x)*tile;
  const py=(Number(player.y)-(Number(player.h)||0.95)*0.5-0.62)*tile;
  const now=Number.isFinite(Number(clockMs)) ? Number(clockMs) : 0;
  const pulse=1+Math.sin(now*0.008)*0.035;
  const radius=size*0.48;
  const remaining=Math.max(0,Math.ceil(seconds-progress));
  ctx.save();
  ctx.translate(px,py);
  ctx.scale(pulse,pulse);
  ctx.globalAlpha=0.96;
  ctx.lineCap='round';
  ctx.lineJoin='round';
  ctx.fillStyle='rgba(8,24,18,0.90)';
  ctx.strokeStyle='rgba(154,255,139,0.42)';
  ctx.lineWidth=Math.max(1.2,size*0.075);
  ctx.beginPath();
  ctx.arc(0,0,radius,0,Math.PI*2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle='rgba(255,255,255,0.16)';
  ctx.lineWidth=Math.max(1.5,size*0.09);
  ctx.beginPath();
  ctx.arc(0,0,radius+size*0.11,-Math.PI*0.5,Math.PI*1.5);
  ctx.stroke();
  ctx.strokeStyle='#91f47d';
  ctx.lineWidth=Math.max(2,size*0.105);
  ctx.beginPath();
  ctx.arc(0,0,radius+size*0.11,-Math.PI*0.5,-Math.PI*0.5+Math.PI*2*ratio);
  ctx.stroke();
  // Small vector tree: no font/emoji dependency and readable at every zoom.
  ctx.fillStyle='#8b5a32';
  ctx.fillRect(-size*0.075,size*0.02,size*0.15,size*0.30);
  ctx.fillStyle='#76da62';
  for(const crown of [[0,-0.16,0.22],[-0.15,-0.02,0.16],[0.15,-0.02,0.16]]){
    ctx.beginPath();
    ctx.arc(crown[0]*size,crown[1]*size,crown[2]*size,0,Math.PI*2);
    ctx.fill();
  }
  const label=remaining+' s';
  ctx.font='800 '+Math.max(9,Math.round(size*0.46))+'px system-ui, "Segoe UI", sans-serif';
  ctx.textAlign='center';
  ctx.textBaseline='middle';
  const labelY=radius+size*0.55;
  const labelW=Math.max(size*1.15,ctx.measureText(label).width+size*0.42);
  ctx.fillStyle='rgba(5,13,11,0.90)';
  ctx.fillRect(-labelW*0.5,labelY-size*0.32,labelW,size*0.64);
  ctx.fillStyle='#e8ffe3';
  ctx.fillText(label,0,labelY+0.5);
  ctx.restore();
  return true;
}

function choiceShortLabel(item){
  if(!item) return '';
  if(item.weaponType==='hose') return 'Waz';
  if(item.weaponType==='flame') return 'Ogien';
  if(item.weaponType==='gas') return 'Gaz';
  return item.name || item.id || '';
}
function choiceFill(item){
  if(!item) return 'rgba(255,255,255,0.82)';
  if(item.weaponType==='hose') return 'rgba(116,184,255,0.28)';
  if(item.weaponType==='flame') return 'rgba(255,136,56,0.28)';
  if(item.weaponType==='gas') return 'rgba(132,216,86,0.28)';
  return 'rgba(255,255,255,0.82)';
}
function snapshotMentor(state,helpers){
  return {
    v:6,
    x:helpers.finite(state.x)?+state.x.toFixed(3):null,
    y:helpers.finite(state.y)?+state.y.toFixed(3):null,
    phase:helpers.cleanPhase(state.phase),
    hp:Math.max(0,Math.min(helpers.maxHp,Number(state.hp)||0)),
    rewarded:!!state.rewards.bow,
    bowRewarded:!!state.rewards.bow,
    treeShortRewarded:!!state.rewards.tree_watch_short_chest,
    treeLongRewarded:!!state.rewards.tree_watch_long_master_stone,
    pendingTreeShortChest:!!(state.data && state.data.pendingTreeShortChest),
    pendingTreeLongStone:!!(state.data && state.data.pendingTreeLongStone),
    streamRewarded:!!state.rewards.stream,
    streamChoice:state.data.streamChoice || null,
    observe:helpers.cleanObserve ? helpers.cleanObserve(state.observe) : null
  };
}
function migrateMentorSnapshot(data,helpers){
  const restoredPhase=helpers.cleanPhase(data.phase);
  const streamItem=helpers.rewardForChoice(data.streamChoice);
  const streamChoice=streamItem ? streamItem.id : null;
  const streamRewarded=!!data.streamRewarded || (restoredPhase==='done' && !!streamChoice);
  const bowRewarded=!!data.bowRewarded || !!data.rewarded || streamRewarded || ['master_stone','reward_choice','done'].includes(restoredPhase);
  const passedShort=['tree_watch_long','sand_hide','water','raw_meat','cooked_meat','duel','master_stone','reward_choice','done'].includes(restoredPhase);
  const passedLong=['sand_hide','water','raw_meat','cooked_meat','duel','master_stone','reward_choice','done'].includes(restoredPhase);
  const knowsShortReward=Object.prototype.hasOwnProperty.call(data,'treeShortRewarded');
  const knowsLongReward=Object.prototype.hasOwnProperty.call(data,'treeLongRewarded');
  const pendingTreeShortChest=!!data.pendingTreeShortChest || (!knowsShortReward && passedShort);
  const pendingTreeLongStone=!!data.pendingTreeLongStone || (!knowsLongReward && passedLong);
  let phase=restoredPhase;
  const rawHp=Number(data.hp);
  let hp=helpers.clamp(helpers.finite(rawHp)?rawHp:helpers.maxHp,0,helpers.maxHp);
  if(streamRewarded){
    phase='done';
    hp=0;
  } else if(bowRewarded && restoredPhase==='done'){
    phase='master_stone';
    hp=0;
  } else if(bowRewarded && phase==='duel'){
    phase='master_stone';
    hp=0;
  } else if(bowRewarded && phase!=='reward_choice' && phase!=='master_stone'){
    phase='master_stone';
    hp=0;
  } else if(phase==='duel' && hp<=0){
    hp=1;
  }
  return {
    x:helpers.finite(data.x)?data.x:null,
    y:helpers.finite(data.y)?data.y:null,
    phase,
    hp,
    rewards:{
      bow:bowRewarded,
      stream:streamRewarded,
      tree_watch_short_chest:!!data.treeShortRewarded,
      tree_watch_long_master_stone:!!data.treeLongRewarded
    },
    data:{streamChoice,pendingTreeShortChest,pendingTreeLongStone},
    observe:data.observe
  };
}
const tutorialNpc = createQuestNpc({
  id:'mentor',
  legacyGlobalKey:'tutorialNpc',
  displayName:'Stary Kwadrat',
  maxHp:MAX_HP,
  interactR:2.4,
  bubbleR:13,
  // The mentor is the hero's species too — rendered by the shared actor with his own
  // weathered colours so he reads as a distinct elder of the same kind.
  bodyColor:'#6b5a48',
  accentColor:'#e8e5d2',
  steps:QUEST_STEPS,
  observeCheck:mentorObserveCheck,
  afterUpdate(state,helpers){
    if(state.data && state.data.pendingTreeShortChest){
      if(state.rewards.tree_watch_short_chest){ state.data.pendingTreeShortChest=false; helpers.markChanged(); }
      else helpers.applyReward(TREE_SHORT_REWARD);
    }
    if(state.data && state.data.pendingTreeLongStone){
      if(state.rewards.tree_watch_long_master_stone){ state.data.pendingTreeLongStone=false; helpers.markChanged(); }
      else helpers.applyReward(TREE_LONG_REWARD);
    }
  },
  choiceRewards:STREAM_REWARDS,
  rewardOnceKeys:['stream'],
  duelReward:{
    once:'bow',
    gear:QUEST_BOW,
    resources:{arrowWood:30},
    next:'master_stone',
    hp:0,
    defeatedT:3,
    failureLine:'Masz pelny plecak. Zrob miejsce na luk, bo trzymam go w dramatycznej pozie.',
    message:'Stary Kwadrat dal ci luk i 30 drewnianych strzal.',
    line:'Au. Dobrze. Masz luk. A teraz znajdz wulkan i przynies kamien mistrza.',
    lineT:6
  },
  choiceReward(item){
    return {
      once:'stream',
      gear:item,
      next:'done',
      data:{streamChoice:item.id},
      failureLine:'Masz pelny plecak. Zrob miejsce na nagrode, bo inaczej bede musial ja nazwac wystawa.',
      message:'Stary Kwadrat dal ci: '+(item.name||item.id)+'.',
      line:'Masz '+(item.name||item.id)+'. Teraz swiat moze bac sie ciebie bardziej precyzyjnie.',
      lineT:5
    };
  },
  combat:{
    contactLine:'Bonk. To byla lekcja o dystansie osobistym.',
    chaseLine:'No dalej. Pokonaj mnie, zanim zapomne po co walczymy.',
    hitLine:'Oj. Dobra technika. Zla empatia.'
  },
  choiceShortLabel,
  choiceFill,
  snapshot:snapshotMentor,
  migrateSnapshot:migrateMentorSnapshot,
  debug(state){
    return {
      rewarded:!!state.rewards.bow,
      bowRewarded:!!state.rewards.bow,
      streamRewarded:!!state.rewards.stream,
      streamChoice:state.data.streamChoice || null,
      questBow:Object.assign({},QUEST_BOW),
      streamRewards:STREAM_REWARDS.map(r=>Object.assign({},r))
    };
  }
});

tutorialNpc.questBow=()=>Object.assign({},QUEST_BOW);
tutorialNpc.streamRewards=()=>STREAM_REWARDS.map(r=>Object.assign({},r));
tutorialNpc.drawObservationSignal=(ctx,tileSize,player,visible,clockMs)=>drawMentorObservationSignal(tutorialNpc,ctx,tileSize,player,visible,clockMs);

export { tutorialNpc };
export default tutorialNpc;
