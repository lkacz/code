import { createQuestNpc } from './npc_system.js';
import { houseHealing } from './house_healing.js';

const FIXED_MENTOR_DISTANCE = 500;
const LARGE_WATER_SCAN_MAX = 6000;
const LARGE_WATER_FALLBACK_SPAN = 32;

function seaLevel(worldGen){
  return Number(worldGen && worldGen.settings && worldGen.settings.seaLevel) || 62;
}

function waterColumn(worldGen,x){
  try{ return Number(worldGen.surfaceHeight(Math.round(x)))>seaLevel(worldGen); }
  catch(e){ return false; }
}

function fallbackLargeWaterShore(worldGen){
  for(let radius=24;radius<=LARGE_WATER_SCAN_MAX;radius+=4){
    for(const sign of [1,-1]){
      const probe=sign*radius;
      if(!waterColumn(worldGen,probe)) continue;
      let left=probe, right=probe;
      while(probe-left<256 && waterColumn(worldGen,left-1)) left--;
      while(right-probe<256 && waterColumn(worldGen,right+1)) right++;
      if(right-left+1<LARGE_WATER_FALLBACK_SPAN) continue;
      return sign>0 ? left-2 : right+2;
    }
  }
  return 900;
}

function findFirstLargeWaterShoreX(worldGen){
  if(!worldGen) return 900;
  if(typeof worldGen.oceanBasinAt==='function'){
    for(let radius=24;radius<=LARGE_WATER_SCAN_MAX;radius+=8){
      const shores=[];
      for(const sign of [1,-1]){
        let basin=null;
        try{ basin=worldGen.oceanBasinAt(sign*radius); }catch(e){ basin=null; }
        if(!basin || !(Number(basin.width)>=LARGE_WATER_FALLBACK_SPAN)) continue;
        const shore=sign>0 ? Number(basin.left)-2 : Number(basin.right)+2;
        if(Number.isFinite(shore)) shores.push(shore);
      }
      if(shores.length) return shores.sort((a,b)=>Math.abs(a)-Math.abs(b))[0];
    }
  }
  return fallbackLargeWaterShore(worldGen);
}

function cachedCheck(interval,check){
  let at=-Infinity, value=false;
  return args=>{
    const now=Number(args && args.state && args.state.tick)||0;
    if(now>=at && now-at<interval) return value;
    at=now;
    value=!!check(args||{});
    return value;
  };
}

const houseBuiltCheck=cachedCheck(0.45,({player,getTile,ctx})=>{
  if(!player || typeof getTile!=='function') return false;
  const opts={
    backgroundAt:ctx && ctx.backgroundAt,
    isBurning:ctx && ctx.isBurning,
    isFurnishingPowered:ctx && ctx.isFurnishingPowered
  };
  try{ return !!houseHealing.analyzeHouseAt(player,getTile,opts).ok; }
  catch(e){ return false; }
});

const coalPowerCheck=cachedCheck(0.2,({player})=>{
  try{
    return !!(player && globalThis.MM && MM.dynamo && typeof MM.dynamo.generatedNear==='function' &&
      MM.dynamo.generatedNear(player.x,player.y,'hot',10));
  }catch(e){ return false; }
});

function heroOnBoatCheck({player}){
  try{ return !!(player && globalThis.MM && MM.boats && typeof MM.boats.heroOnBoat==='function' && MM.boats.heroOnBoat(player)); }
  catch(e){ return false; }
}

const triangleMentor=createQuestNpc({
  id:'mentor_triangle',
  displayName:'Trojkat',
  spawn:{x:FIXED_MENTOR_DISTANCE},
  spawnOffsets:[0,-4,4,-8,8,-14,14,-22,22],
  initialData:{role:'Mentor budowy',home:{x:FIXED_MENTOR_DISTANCE}},
  bodyColor:'#b97720',
  accentColor:'#ffe08a',
  steps:[
    {
      id:'briefing',kind:'briefing',next:'build_house',
      prompt:'Jestem Trojkat. Kliknij mnie, a pokaze ci, jak zbudowac prawdziwy domek.',
      reward:{
        once:'house_lesson_kit',resources:{wood:24,glass:4,torch:2},
        message:'Trojkat dal ci 24 drewna, 4 szkla i 2 pochodnie na pierwszy dom.',
        line:'Zbuduj zamkniety domek: podloga, sciany, dach, wejscie, tlo wewnatrz i pochodnia. Gdy staniesz w bezpiecznym, oswietlonym srodku, uznam lekcje.'
      }
    },
    {
      id:'build_house',kind:'observe',mode:'built_house',label:'bezpieczny domek',seconds:1,next:'done',
      prompt:'Zbuduj zamkniety domek z dachem, scianami, tlem i swiatlem, a potem stan w srodku.',
      missing:'Sama fasada nie wystarczy. Zamknij wnetrze, poloz tlo i dodaj pochodnie.',
      progress:'Tak, to jest dom. Jeszcze chwila w srodku.',
      complete:'Domek zaliczony. Schronienie leczy, a wyposazenie zwieksza jego komfort.',
      completeMessage:'Lekcja Trojkata ukonczona: bohater potrafi budowac bezpieczny dom.',
      check:houseBuiltCheck
    },
    {id:'done',kind:'done',prompt:'Moja lekcja jest skonczona. Dach nad glowa to plan, nie gwarancja.'}
  ]
});

const tesseractMentor=createQuestNpc({
  id:'mentor_tesseract',
  displayName:'Teserakt',
  spawn:{x:-FIXED_MENTOR_DISTANCE},
  spawnOffsets:[0,4,-4,8,-8,14,-14,22,-22],
  initialData:{role:'Mentor craftingu i energii',home:{x:-FIXED_MENTOR_DISTANCE}},
  bodyColor:'#59429b',
  accentColor:'#d8c7ff',
  steps:[
    {
      id:'briefing',kind:'briefing',next:'coal_power',
      prompt:'Jestem Teserakt. Kliknij mnie po lekcje craftingu i energii.',
      reward:{
        once:'coal_power_kit',resources:{dynamo:1,coal:3},
        message:'Teserakt dal ci 1 dynamo i 3 bloki wegla do eksperymentu.',
        line:'Daje ci dynamo. Kolejne zrobisz w Maszyny ze stali, przewodow, miedzi i tranzystora. Miotacz spala drewno albo wegiel; na weglu kopci czarnym dymem. Postaw dynamo poziomo, daj wegiel pod wirnik i podpal. R obraca.'
      }
    },
    {
      id:'coal_power',kind:'observe',mode:'coal_dynamo',label:'energia z wegla',seconds:1,next:'done',
      prompt:'Wytworz energie z wegla: podpal wegiel pod poziomym dynamem, aby gorace powietrze przeszlo przez wirnik.',
      missing:'Dynamo nie zjada wegla. Spalanie tworzy gorace powietrze; dopiero jego przeplyw przez slot obraca wirnik.',
      progress:'Wirnik lapie gorace powietrze. Utrzymaj przeplyw jeszcze chwile.',
      complete:'Energia zaliczona. Crafting buduje narzedzie, ale dopiero przeplyw materii uruchamia maszyne.',
      completeMessage:'Lekcja Teserakta ukonczona: dynamo wygenerowalo energie z goracego powietrza nad weglem.',
      check:coalPowerCheck
    },
    {id:'done',kind:'done',prompt:'Nie mam juz nic do dodania. Energia nie bierze sie z przedmiotu, tylko z przemiany i przeplywu.'}
  ]
});

const trapezoidMentor=createQuestNpc({
  id:'mentor_trapezoid',
  displayName:'Trapezoid',
  spawn:{findX:findFirstLargeWaterShoreX},
  spawnOffsets:[0,-3,3,-6,6,-10,10,-16,16,-24,24],
  initialData:{role:'Mentor zeglugi'},
  bodyColor:'#277a86',
  accentColor:'#a8f1ef',
  afterUpdate(state,helpers){
    if(state.data && (!state.data.home || !Number.isFinite(Number(state.data.home.x))) && Number.isFinite(Number(state.x))){
      state.data.home={x:Number(state.x)};
      helpers.markChanged();
    }
  },
  steps:[
    {
      id:'briefing',kind:'briefing',next:'build_boat',
      prompt:'Jestem Trapezoid. Kliknij mnie, zanim pierwsza duza woda nauczy cie tonięcia.',
      reward:{
        once:'boat_lesson_kit',resources:{wood:8},
        message:'Trapezoid dal ci 8 drewna na pierwsza tratwe.',
        line:'Poloz drewno w glebszej wodzie albo tuz nad jej powierzchnia. Pierwsza deska stanie sie tratwa; dokladaj drewno obok i wejdz na poklad.'
      }
    },
    {
      id:'build_boat',kind:'observe',mode:'wooden_boat',label:'drewniana tratwa',seconds:1,next:'done',
      prompt:'Zbuduj tratwe z drewna na wodzie i stan na jej pokladzie.',
      missing:'Drewno na suchej podporze zostaje blokiem. Umiesc je w wystarczajaco glebszej wodzie, aby zaczelo plywac.',
      progress:'Tratwa plywa. Postoj na niej jeszcze chwile.',
      complete:'Lodz zaliczona. Wiatr ja pcha, a kierunkiem ruchu mozesz wioslowac kosztem energii.',
      completeMessage:'Lekcja Trapezoida ukonczona: bohater zbudowal drewniana tratwe.',
      check:heroOnBoatCheck
    },
    {id:'done',kind:'done',prompt:'Pierwsza duza woda nie jest juz sciana. Reszte kursu wyznacza wiatr.'}
  ]
});

const mentorNpcs={triangle:triangleMentor,tesseract:tesseractMentor,trapezoid:trapezoidMentor};
try{
  const root=typeof window!=='undefined' ? window : globalThis;
  root.MM=root.MM||{};
  root.MM.mentorNpcs=mentorNpcs;
}catch(e){}

export { FIXED_MENTOR_DISTANCE, findFirstLargeWaterShoreX, triangleMentor, tesseractMentor, trapezoidMentor, mentorNpcs };
export default mentorNpcs;
