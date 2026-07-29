function finiteInt(value,fallback=0){
  const n=Number(value);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function orderedHorizontalOffsets(radius){
  const out=[0];
  for(let distance=1;distance<=radius;distance++) out.push(-distance,distance);
  return out;
}

/**
 * Find an open cell whose lower neighbour can physically carry a grave.
 *
 * The first pass stays close to the death point. A narrow full-height fallback
 * handles unusually long falls without generating distant columns of terrain.
 */
export function findGroundedGraveCell(cx,cy,options={}){
  const getTile=options.getTile;
  const isOpen=options.isOpen;
  const isSupport=options.isSupport;
  if(typeof getTile!=='function' || typeof isOpen!=='function' || typeof isSupport!=='function') return null;

  const minY=finiteInt(options.minY,0);
  const maxY=finiteInt(options.maxY,minY);
  if(maxY-minY<2) return null;

  cx=finiteInt(cx,0);
  cy=finiteInt(cy,minY);
  const radius=Math.max(0,Math.min(32,finiteInt(options.horizontalRadius,10)));
  const rise=Math.max(0,finiteInt(options.rise,12));
  const fall=Math.max(0,finiteInt(options.fall,160));
  const offsets=orderedHorizontalOffsets(radius);

  const valid=(x,y)=>{
    if(y<minY || y+1>=maxY) return false;
    return isOpen(getTile(x,y)) && isSupport(getTile(x,y+1));
  };
  const choose=(y0,y1,searchOffsets)=>{
    let best=null;
    let bestScore=Infinity;
    for(const dx of searchOffsets){
      const x=cx+dx;
      for(let y=y0;y<=y1;y++){
        if(!valid(x,y)) continue;
        const vertical=y-cy;
        const score=Math.abs(vertical)+Math.abs(dx)*4+(vertical<0?3:0);
        if(score<bestScore){
          bestScore=score;
          best={x,y};
        }
      }
    }
    return best;
  };

  const localTop=Math.max(minY,cy-rise);
  const localBottom=Math.min(maxY-2,cy+fall);
  const local=choose(localTop,localBottom,offsets);
  if(local) return local;

  // Extreme sky/deep-shaft fallback: scan only the death column and its two
  // neighbours, avoiding an expensive full-world sweep across all 21 columns.
  return choose(minY,maxY-2,offsets.filter(dx=>Math.abs(dx)<=2));
}
