const LADDER_RUN_HARD_CAP=2048;

function finiteCell(value){
  const n=Number(value);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

function ladderAt(provider,x,y){
  if(typeof provider!=='function') return false;
  try{ return !!provider(x,y); }catch(e){ return false; }
}

function boundedRunLimit(value){
  const n=Number(value);
  if(!Number.isFinite(n)) return Number.isNaN(n) ? 0 : LADDER_RUN_HARD_CAP;
  return Math.max(0,Math.min(LADDER_RUN_HARD_CAP,Math.floor(n)));
}

export function ladderConnections(tx,ty,hasLadder){
  tx=finiteCell(tx); ty=finiteCell(ty);
  if(tx===null || ty===null) return {up:false,down:false};
  return {up:ladderAt(hasLadder,tx,ty-1), down:ladderAt(hasLadder,tx,ty+1)};
}

export function ladderRun(tx,ty,hasLadder,maxRun=128){
  tx=finiteCell(tx); ty=finiteCell(ty);
  if(tx===null || ty===null) return {top:0,bottom:0,length:0,up:false,down:false,invalid:true};
  const limit=boundedRunLimit(maxRun);
  let top=ty, bottom=ty;
  for(let i=1;i<=limit && ladderAt(hasLadder,tx,ty-i);i++) top=ty-i;
  for(let i=1;i<=limit && ladderAt(hasLadder,tx,ty+i);i++) bottom=ty+i;
  return {top,bottom,length:bottom-top+1,up:top<ty,down:bottom>ty};
}

export function canPlaceLadderFixture(opts){
  opts=opts||{};
  const tx=finiteCell(opts.tx);
  const ty=finiteCell(opts.ty);
  if(tx===null || ty===null) return {ok:false,reason:'Nieprawidlowe miejsce'};
  const hasLadder=typeof opts.hasLadder==='function' ? opts.hasLadder : (()=>false);
  const hasAnchor=typeof opts.hasAnchor==='function' ? opts.hasAnchor : (()=>false);
  const hasBacking=typeof opts.hasBacking==='function' ? opts.hasBacking : (()=>false);
  if(opts.naturalSolidBlocked){
    return {ok:false, reason:opts.underground?'Najpierw wykop miejsce':'Drabinka tylko na budowli'};
  }
  const run=ladderRun(tx,ty,hasLadder,opts.maxRun===undefined?128:opts.maxRun);
  if(opts.oneEndSupport){
    const topAnchor=!!hasAnchor(tx,run.top-1);
    const bottomAnchor=!!hasAnchor(tx,run.bottom+1);
    if(topAnchor || bottomAnchor) return {ok:true, run, topAnchor, bottomAnchor, oneEndSupport:true};
    return {
      ok:false,
      run,
      topAnchor,
      bottomAnchor,
      reason:'Drabinka macierzysta wymaga zaczepu u gory lub u dolu'
    };
  }
  if(opts.underground) return {ok:true, run};
  if(hasBacking(tx,ty)) return {ok:true, run};
  const topAnchor=!!hasAnchor(tx,run.top-1);
  const bottomAnchor=!!hasAnchor(tx,run.bottom+1);
  if(topAnchor && bottomAnchor) return {ok:true, run, topAnchor, bottomAnchor};
  const sideAnchor=!!(hasAnchor(tx-1,ty) || hasAnchor(tx+1,ty));
  if(run.length===1 && (topAnchor || bottomAnchor || sideAnchor)){
    return {ok:true, run, topAnchor, bottomAnchor, sideAnchor, single:true};
  }
  return {
    ok:false,
    run,
    topAnchor,
    bottomAnchor,
    sideAnchor,
    reason:run.length===1 ? 'Drabinka wymaga zaczepu' : 'Drabinka musi laczyc gore i dol'
  };
}
