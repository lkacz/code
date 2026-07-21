// Shared soft-flame sprite vocabulary. Both the hero's flamethrower stream and
// persistent world fire stamp these exact hot/mid/tail images, so they differ in
// motion and scale but never drift into two unrelated visual styles.
let flamePuffSprites=null;

function makeRadialSprite(stops){
  if(typeof document==='undefined' || !document.createElement) return null;
  const S=32;
  const c=document.createElement('canvas');
  c.width=c.height=S*2;
  const g=c.getContext('2d');
  if(!g) return null;
  const gr=g.createRadialGradient(S,S,1,S,S,S);
  stops.forEach(([t,color])=>gr.addColorStop(t,color));
  g.fillStyle=gr;
  g.beginPath();
  g.arc(S,S,S,0,Math.PI*2);
  g.fill();
  return c;
}

export function getFlamePuffSprites(){
  if(flamePuffSprites) return flamePuffSprites;
  const hot=makeRadialSprite([[0,'rgba(255,245,200,0.85)'],[0.5,'rgba(255,180,60,0.55)'],[1,'rgba(255,90,20,0)']]);
  const mid=makeRadialSprite([[0,'rgba(255,170,60,0.6)'],[1,'rgba(230,70,20,0)']]);
  const tail=makeRadialSprite([[0,'rgba(120,90,70,0.35)'],[1,'rgba(80,60,50,0)']]);
  if(!hot || !mid || !tail) return null;
  flamePuffSprites={hot,mid,tail};
  return flamePuffSprites;
}

export function flamePuffFrame(sprites,freshness){
  if(!sprites) return null;
  const fr=Math.max(0,Math.min(1,Number(freshness)||0));
  return fr>0.6 ? sprites.hot : (fr>0.3 ? sprites.mid : sprites.tail);
}

export function flamePuffAlpha(freshness){
  const fr=Math.max(0,Math.min(1,Number(freshness)||0));
  return fr>0.3 ? 1 : Math.max(0,fr/0.3);
}

export function flamePuffRadius(tileSize,freshness,scale=1){
  const fr=Math.max(0,Math.min(1,Number(freshness)||0));
  return Math.max(0,Number(tileSize)||0)*(0.25+(1-fr)*0.65)*Math.max(0,Number(scale)||0);
}
