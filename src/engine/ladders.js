export function ladderConnections(tx,ty,hasLadder){
  const at=typeof hasLadder==='function' ? hasLadder : (()=>false);
  return {up:!!at(tx,ty-1), down:!!at(tx,ty+1)};
}

export function ladderRun(tx,ty,hasLadder,maxRun=128){
  const at=typeof hasLadder==='function' ? hasLadder : (()=>false);
  let top=ty, bottom=ty;
  for(let i=1;i<=maxRun && at(tx,ty-i);i++) top=ty-i;
  for(let i=1;i<=maxRun && at(tx,ty+i);i++) bottom=ty+i;
  return {top,bottom,length:bottom-top+1,up:top<ty,down:bottom>ty};
}

export function canPlaceLadderFixture(opts){
  opts=opts||{};
  const tx=Math.floor(Number(opts.tx)||0);
  const ty=Math.floor(Number(opts.ty)||0);
  const hasLadder=typeof opts.hasLadder==='function' ? opts.hasLadder : (()=>false);
  const hasAnchor=typeof opts.hasAnchor==='function' ? opts.hasAnchor : (()=>false);
  const hasBacking=typeof opts.hasBacking==='function' ? opts.hasBacking : (()=>false);
  if(opts.naturalSolidBlocked){
    return {ok:false, reason:opts.underground?'Najpierw wykop miejsce':'Drabinka tylko na budowli'};
  }
  const run=ladderRun(tx,ty,hasLadder,opts.maxRun||128);
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
