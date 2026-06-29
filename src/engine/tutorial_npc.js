import { createQuestNpc } from './npc_system.js';

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
const QUEST_STEPS = [
  {
    id:'water',
    kind:'handoff',
    item:'water', amount:1, next:'raw_meat',
    prompt:'Hej, nowy kwadracie. Przynies mi 1 blok wody. Mam pragnienie jak pustynia.',
    missing:'Wode wydobywa sie jak blok. Tak, to brzmi podejrzanie, ale dziala.',
    complete:'Glup! Dobra woda. Teraz przynies surowe mieso. Naukowo, oczywiscie.'
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
    v:3,
    x:helpers.finite(state.x)?+state.x.toFixed(3):null,
    y:helpers.finite(state.y)?+state.y.toFixed(3):null,
    phase:helpers.cleanPhase(state.phase),
    hp:Math.max(0,Math.min(helpers.maxHp,Number(state.hp)||0)),
    rewarded:!!state.rewards.bow,
    bowRewarded:!!state.rewards.bow,
    streamRewarded:!!state.rewards.stream,
    streamChoice:state.data.streamChoice || null
  };
}
function migrateMentorSnapshot(data,helpers){
  const restoredPhase=helpers.cleanPhase(data.phase);
  const streamItem=helpers.rewardForChoice(data.streamChoice);
  const streamChoice=streamItem ? streamItem.id : null;
  const streamRewarded=!!data.streamRewarded || (restoredPhase==='done' && !!streamChoice);
  const bowRewarded=!!data.bowRewarded || !!data.rewarded || streamRewarded || ['master_stone','reward_choice','done'].includes(restoredPhase);
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
    rewards:{bow:bowRewarded,stream:streamRewarded},
    data:{streamChoice}
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
  choiceRewards:STREAM_REWARDS,
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

export { tutorialNpc };
export default tutorialNpc;
