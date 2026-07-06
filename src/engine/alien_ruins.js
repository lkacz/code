// Alien ruin complexes: buried UFO-concrete vaults with surface sensor scars.
// They mirror engine/ruins.js mechanically (anchor cells, deterministic layouts,
// soft surface hints) but use a separate architectural language: oval pressure
// hulls, ribbed shafts, reactor pods, suspended bridges and tech cores.
import { CHUNK_W, WORLD_H, T } from '../constants.js';
import { isReplaceableNaturalOpenTile } from './material_physics.js';
import { worldGen as WG } from './worldgen.js';

const alienRuins = (function(){
  const root = typeof window !== 'undefined' ? window : globalThis;
  const MM = root.MM = root.MM || {};
  const CFG = {
    SPACING:220,
    GATE:0.42,
    MARGIN:46,
    CACHE_CAP:260,
    MEGA_ROLL:0.985,
    COMMANDER_WAKE_RADIUS:44,
    SCAN_INTERVAL:0.85,
    SEEN_KEY:'mm_alien_ruin_commanders_v1'
  };
  const cache = new Map();
  const sessionSeen = new Set();
  let seenSeed = null;
  let scanAcc = 0;

  function mulberry32(a){ a=a>>>0; return function(){ a|=0; a=(a+0x6D2B79F5)|0; let t=Math.imul(a^(a>>>15),1|a); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }
  function ri(r,a,b){ return a+Math.floor(r()*(b-a+1)); }
  function pick(r,arr){ return arr[Math.floor(r()*arr.length)]; }
  function seedKey(){ return String((WG && WG.worldSeed) || 0); }
  function storage(){
    try{ return root.localStorage || null; }catch(e){ return null; }
  }
  function loadSeen(){
    const seed = seedKey();
    if(seenSeed === seed) return;
    seenSeed = seed;
    sessionSeen.clear();
    const st = storage();
    if(!st) return;
    try{
      const raw = st.getItem(CFG.SEEN_KEY+':'+seed);
      const list = raw ? JSON.parse(raw) : [];
      if(Array.isArray(list)) for(const k of list) if(typeof k === 'string') sessionSeen.add(k);
    }catch(e){}
  }
  function saveSeen(){
    const st = storage();
    if(!st) return;
    try{ st.setItem(CFG.SEEN_KEY+':'+seedKey(), JSON.stringify([...sessionSeen].slice(-1200))); }catch(e){}
  }
  function rememberCommander(key){
    loadSeen();
    if(!key || sessionSeen.has(key)) return;
    sessionSeen.add(key);
    saveSeen();
  }

  function anchorFor(n){
    if(WG.randSeed(n*14.31+91.7) >= CFG.GATE) return null;
    const span = CFG.SPACING - CFG.MARGIN*2;
    const ax = Math.round(n*CFG.SPACING + CFG.MARGIN + WG.randSeed(n*8.83+17.2)*span);
    try{
      const b = WG.biomeType ? WG.biomeType(ax) : 1;
      if(b===5 || b===6 || b===8) return null;
      const s0 = WG.surfaceHeight(ax);
      const sL = WG.surfaceHeight(ax-5), sR = WG.surfaceHeight(ax+5);
      if(Math.abs(sL-s0)>9 || Math.abs(sR-s0)>9) return null;
    }catch(e){}
    return ax;
  }

  function layoutFor(n){
    const key = ((WG && WG.worldSeed) || 0)+':'+n;
    if(cache.has(key)) return cache.get(key);
    if(cache.size > CFG.CACHE_CAP) cache.clear();
    const ax = anchorFor(n);
    const L = ax==null ? null : build(n,ax);
    cache.set(key,L);
    return L;
  }

  function build(n,ax){
    const r = mulberry32((((WG.worldSeed||1)+0x4a11e1) ^ Math.imul(n|0, 2246822519))>>>0);
    const surf = (x)=>{ try{ return WG.surfaceHeight(Math.round(x)); }catch(e){ return 60; } };
    const s0 = surf(ax);
    const ops = [];
    const hints = [];
    const tech = [];
    const commanders = [];
    let minX=ax, maxX=ax, minY=s0, maxY=s0;
    let chests=0;
    const WALL = T.UFO_CONCRETE;
    const techTiles = [T.ANTIGRAVITY_BEACON,T.TELEPORTER,T.ELECTRONICS,T.DYNAMO,T.SOLAR_BATTERY,T.METEOR_SIREN,T.TRANSISTOR];

    function put(x,y,t,force){
      x=Math.round(x); y=Math.round(y);
      if(y<1 || y>=WORLD_H-3) return;
      ops.push({x,y,t,f:force?1:0});
      if(!force) hints.push({x,y,t});
      if(x<minX) minX=x; if(x>maxX) maxX=x; if(y<minY) minY=y; if(y>maxY) maxY=y;
    }
    function carve(x,y){ put(x,y,T.AIR,true); }
    function solid(x,y,t){ put(x,y,t||WALL,true); }
    function floorAt(x,y){ solid(x,y,WALL); }
    function techAt(x,y,t){
      t = t || pick(r,techTiles);
      if(t!==T.DYNAMO_SLOT && t!==T.WIRE && t!==T.COPPER_WIRE) floorAt(x,y+1);
      put(x,y,t,true);
      tech.push({x:Math.round(x),y:Math.round(y),t});
    }
    function chestAt(x,y,t){
      floorAt(x,y+1);
      put(x,y,t,true);
      chests++;
    }
    function maybeCommander(x,y,chance){
      if(r() >= chance) return;
      const key = seedKey()+':alien-ruin:'+n+':'+commanders.length;
      commanders.push({x:Math.round(x)+0.5,y:Math.round(y)+0.98,key});
    }
    function ovalRoom(cx,cy,rx,ry,opts){
      opts = opts || {};
      const shell = opts.shell || WALL;
      const shellScale = opts.shellScale || 1.28;
      for(let y=cy-ry-2;y<=cy+ry+2;y++){
        for(let x=cx-rx-2;x<=cx+rx+2;x++){
          const dx=(x-cx)/Math.max(1,rx);
          const dy=(y-cy)/Math.max(1,ry);
          const d=dx*dx+dy*dy;
          if(d<=1.0) carve(x,y);
          else if(d<=shellScale) solid(x,y,shell);
        }
      }
      if(opts.ribs){
        const step = opts.ribs===2 ? 3 : 4;
        for(let x=cx-rx+1;x<=cx+rx-1;x+=step){
          solid(x,cy-ry,WALL);
          solid(x,cy+ry,WALL);
        }
      }
    }
    function rectRoom(x0,y0,w,h,opts){
      opts = opts || {};
      for(let y=y0;y<y0+h;y++){
        for(let x=x0;x<x0+w;x++){
          const edge = x===x0 || x===x0+w-1 || y===y0 || y===y0+h-1;
          if(edge) solid(x,y,WALL);
          else carve(x,y);
        }
      }
      if(opts.ribs){
        for(let x=x0+2;x<x0+w-2;x+=3){
          solid(x,y0,WALL);
          solid(x,y0+h-1,WALL);
        }
      }
    }
    function corridorH(x0,x1,y){
      const a=Math.min(x0,x1), b=Math.max(x0,x1);
      for(let x=a;x<=b;x++){
        solid(x,y-2,WALL); carve(x,y-1); carve(x,y); solid(x,y+1,WALL);
      }
    }
    function corridorV(x,y0,y1){
      const a=Math.min(y0,y1), b=Math.max(y0,y1);
      for(let y=a;y<=b;y++){
        solid(x-2,y,WALL); carve(x-1,y); carve(x,y); solid(x+1,y,WALL);
      }
    }
    function sealShaftCap(x,y,thickness){
      const h=Math.max(1, thickness || 3);
      for(let i=0;i<h;i++){
        solid(x-1,y+i,WALL);
        solid(x,y+i,WALL);
      }
    }
    function bridge(x0,x1,y){
      const a=Math.min(x0,x1), b=Math.max(x0,x1);
      for(let x=a;x<=b;x++){
        floorAt(x,y);
        if((x-a)%4===0) solid(x,y-1,WALL);
      }
    }
    function cableRun(x0,x1,y){
      const a=Math.min(x0,x1), b=Math.max(x0,x1);
      for(let x=a;x<=b;x+=2) put(x,y,(x&2)?T.WIRE:T.COPPER_WIRE,true);
    }
    function surfaceMarker(kind,width){
      const w = width || 5;
      for(let dx=-w; dx<=w; dx++){
        if(Math.abs(dx)>w-2 && r()<0.35) continue;
        const sy=surf(ax+dx);
        if(Math.abs(dx)<=1 || (Math.abs(dx)%3===0)) put(ax+dx,sy-1,WALL,false);
        if(Math.abs(dx)===w-1) put(ax+dx,sy-2,T.METEOR_DUST,false);
      }
      const mastH = kind==='nexus' ? 5 : (kind==='array' ? 4 : 3);
      const sy0=surf(ax);
      for(let i=1;i<=mastH;i++) put(ax,sy0-i,WALL,false);
      put(ax,sy0-mastH-1,T.METEOR_DUST,false);
      put(ax-1,sy0-mastH,T.WIRE,false);
      put(ax+1,sy0-mastH,T.WIRE,false);
      if(kind!=='probe'){
        put(ax-2,sy0-2,T.COPPER_WIRE,false);
        put(ax+2,sy0-2,T.COPPER_WIRE,false);
      }
    }
    function addGlyphWalls(cx,cy,rx,ry){
      for(let i=0;i<6;i++){
        const ang=(i/6)*Math.PI*2 + r()*0.18;
        const x=Math.round(cx+Math.cos(ang)*rx);
        const y=Math.round(cy+Math.sin(ang)*ry);
        put(x,y,pick(r,[T.ELECTRONICS,T.WIRE,T.METEOR_DUST,T.TRANSISTOR]),true);
      }
    }
    // Hermetic hull: the vault may only be entered by destroying UFO concrete.
    // The oval shell band (d ≤ shellScale) is thinner than one tile along the
    // top/bottom of typical radii, corridor dead-ends stop in raw dirt, and
    // glyphs/cables/tech are soft, mineable materials — so every forced
    // non-concrete cell gets its untouched 8-neighbourhood backed with concrete.
    // Ops replay in order and this runs last, so it only fills cells no earlier
    // op touched; the invariant is enforced by construction for every layout.
    function sealHull(){
      const finalTiles=new Map();
      for(const op of ops) if(op.f) finalTiles.set(op.x+','+op.y, op.t);
      const toSeal=[];
      const planned=new Set();
      for(const [k,t] of finalTiles){
        if(t===WALL) continue;
        const c=k.indexOf(',');
        const x=+k.slice(0,c), y=+k.slice(c+1);
        for(let dy=-1;dy<=1;dy++){
          for(let dx=-1;dx<=1;dx++){
            if(!dx && !dy) continue;
            const nk=(x+dx)+','+(y+dy);
            if(finalTiles.has(nk) || planned.has(nk)) continue;
            planned.add(nk);
            toSeal.push({x:x+dx,y:y+dy});
          }
        }
      }
      for(const cell of toSeal) solid(cell.x,cell.y,WALL);
    }

    const roll = r();
    const size = roll<0.48 ? 'small' : (roll<0.82 ? 'medium' : (roll<CFG.MEGA_ROLL ? 'large' : 'mega'));
    const tier = size==='small' ? 1 : size==='medium' ? 2 : size==='large' ? 3 : 4;
    let variant='probe';

    if(size==='small'){
      variant=pick(r,['probe','burrow','signal']);
      const cy=s0+ri(r,7,12), rx=ri(r,4,6), ry=ri(r,3,4);
      ovalRoom(ax,cy,rx,ry,{ribs:1});
      const neckY=Math.max(s0+1,cy-ry-1);
      corridorV(ax,neckY,cy-ry+1);
      sealShaftCap(ax,neckY,3);
      techAt(ax,cy,pick(r,[T.ELECTRONICS,T.ANTIGRAVITY_BEACON,T.TELEPORTER]));
      addGlyphWalls(ax,cy,rx,ry);
      if(r()<0.42) chestAt(ax+ri(r,-2,2),cy+ry-1,r()<0.25?T.CHEST_RARE:T.CHEST_COMMON);
      maybeCommander(ax,cy,0.10);
      surfaceMarker('probe',3);
    } else if(size==='medium'){
      variant=pick(r,['array','twin-pod','inverter']);
      const top=s0+ri(r,6,9), shaftDepth=ri(r,10,15);
      corridorV(ax,top,top+shaftDepth);
      sealShaftCap(ax,top,3);
      const cy1=top+ri(r,4,7);
      const cy2=top+shaftDepth-ri(r,2,4);
      const dir=r()<0.5?-1:1;
      const leftX=ax-dir*ri(r,7,10), rightX=ax+dir*ri(r,7,10);
      ovalRoom(leftX,cy1,ri(r,4,6),3,{ribs:2});
      ovalRoom(rightX,cy2,ri(r,5,7),4,{ribs:1});
      corridorH(ax, leftX, cy1);
      corridorH(ax, rightX, cy2);
      techAt(leftX,cy1,pick(r,[T.ELECTRONICS,T.SOLAR_BATTERY,T.DYNAMO]));
      techAt(rightX,cy2,pick(r,[T.TELEPORTER,T.ANTIGRAVITY_BEACON,T.METEOR_SIREN]));
      cableRun(Math.min(leftX,rightX)+1,Math.max(leftX,rightX)-1,Math.round((cy1+cy2)/2));
      if(r()<0.58) chestAt(rightX+ri(r,-2,2),cy2+3,r()<0.62?T.CHEST_RARE:T.CHEST_COMMON);
      maybeCommander(rightX,cy2,0.20);
      surfaceMarker('array',4);
    } else if(size==='large'){
      variant=pick(r,['tri-spoke','vault-core','hanger']);
      const coreY=s0+ri(r,14,20);
      const coreRx=ri(r,7,9), coreRy=ri(r,5,6);
      ovalRoom(ax,coreY,coreRx,coreRy,{ribs:2,shellScale:1.34});
      corridorV(ax,s0+2,coreY-coreRy+1);
      sealShaftCap(ax,s0+2,3);
      const spokes=variant==='tri-spoke' ? 3 : 2+ri(r,0,1);
      for(let i=0;i<spokes;i++){
        const side=i%2===0?-1:1;
        const px=ax+side*ri(r,11,17);
        const py=coreY-coreRy+3+i*ri(r,3,4);
        ovalRoom(px,py,ri(r,4,6),ri(r,3,4),{ribs:1});
        corridorH(ax+side*(coreRx-1),px,py);
        if(i===0) techAt(px,py,pick(r,[T.METEOR_SIREN,T.SOLAR_BATTERY,T.ELECTRONICS]));
        else if(i===1 && r()<0.78) chestAt(px,py+3,r()<0.42?T.CHEST_EPIC:T.CHEST_RARE);
        else techAt(px,py,pick(r,[T.TRANSISTOR,T.ELECTRONICS,T.DYNAMO]));
      }
      techAt(ax,coreY,T.ANTIGRAVITY_BEACON);
      techAt(ax-2,coreY+1,T.TELEPORTER);
      addGlyphWalls(ax,coreY,coreRx+1,coreRy+1);
      bridge(ax-coreRx+1,ax+coreRx-1,coreY+coreRy-1);
      if(chests===0 || r()<0.36) chestAt(ax+coreRx-3,coreY+coreRy-1,T.CHEST_RARE);
      maybeCommander(ax,coreY,0.36);
      surfaceMarker('array',5);
    } else {
      variant='nexus';
      const top=s0+ri(r,18,24);
      const coreY=Math.min(WORLD_H-15,top+ri(r,12,18));
      const W=ri(r,46,58), x0=ax-(W>>1);
      rectRoom(x0,top,W,ri(r,6,8),{ribs:true});
      corridorV(ax,s0+2,top+2);
      sealShaftCap(ax,s0+2,4);
      const ringRx=ri(r,12,15), ringRy=ri(r,7,9);
      ovalRoom(ax,coreY,ringRx,ringRy,{ribs:2,shellScale:1.36});
      corridorV(ax,top+4,coreY-ringRy+1);
      for(let i=0;i<4;i++){
        const side=i<2?-1:1;
        const px=ax+side*ri(r,18,25);
        const py=coreY-ringRy+2+i*3;
        ovalRoom(px,py,ri(r,5,7),ri(r,3,4),{ribs:2});
        corridorH(ax+side*(ringRx-1),px,py);
        bridge(Math.min(ax,px)+2,Math.max(ax,px)-2,py+3);
        if(i%2===0) techAt(px,py,pick(r,[T.SOLAR_BATTERY,T.METEOR_SIREN,T.ELECTRONICS]));
        else chestAt(px,py+3,i===3?T.CHEST_EPIC:T.CHEST_RARE);
      }
      techAt(ax,coreY,T.ANTIGRAVITY_BEACON);
      techAt(ax,coreY+2,T.TELEPORTER);
      techAt(ax-3,coreY+1,T.DYNAMO);
      techAt(ax+3,coreY+1,T.SOLAR_BATTERY);
      addGlyphWalls(ax,coreY,ringRx+2,ringRy+2);
      chestAt(ax-5,coreY+ringRy-1,T.CHEST_EPIC);
      maybeCommander(ax,coreY,0.72);
      surfaceMarker('nexus',6);
    }

    if(!tech.length) techAt(ax,s0+8,T.ELECTRONICS);
    sealHull();
    return {n, ax, size, tier, variant, chests, tech, commanders, hints, ops, minX, maxX, minY, maxY};
  }

  function applyToChunk(arr,cx){
    const x0=cx*CHUNK_W, x1=x0+CHUNK_W-1;
    const n0=Math.floor((x0-CFG.SPACING)/CFG.SPACING), n1=Math.floor((x1+CFG.SPACING)/CFG.SPACING);
    for(let n=n0;n<=n1;n++){
      const L=layoutFor(n);
      if(!L || L.maxX<x0 || L.minX>x1) continue;
      for(const op of L.ops){
        if(op.x<x0 || op.x>x1) continue;
        const idx=op.y*CHUNK_W+(op.x-x0);
        if(op.f) arr[idx]=op.t;
        else {
          const cur=arr[idx];
          if(isReplaceableNaturalOpenTile(cur,false)) arr[idx]=op.t;
        }
      }
    }
  }

  function drawHints(ctx,TILE,canDrawTile){
    if(typeof document==='undefined') return;
    const pl=root.player || null; if(!pl) return;
    const W=MM.world; if(!W || !W.getTile) return;
    const now=(typeof performance!=='undefined' && performance.now) ? performance.now() : Date.now();
    let anchors=[]; try{ anchors=anchorsInRange(pl.x-110,pl.x+110); }catch(e){ return; }
    ctx.save();
    for(const a of anchors){
      const L=layoutFor(a.n); if(!L || !L.hints || !L.hints.length) continue;
      for(const h of L.hints){
        if(typeof canDrawTile==='function' && !canDrawTile(h.x,h.y)) continue;
        const t=W.getTile(h.x,h.y);
        if(t===T.AIR || t===T.WATER) continue;
        const px=h.x*TILE, py=h.y*TILE;
        const pulse=0.45+0.35*Math.sin(now*0.004+h.x*0.7+h.y*0.31);
        ctx.strokeStyle='rgba(125,255,229,'+(0.22+pulse*0.24).toFixed(3)+')';
        ctx.lineWidth=1.2;
        ctx.strokeRect(px+2.5,py+2.5,TILE-5,TILE-5);
        ctx.fillStyle='rgba(12,28,34,0.28)';
        ctx.fillRect(px+4,py+4,TILE-8,TILE-8);
        ctx.strokeStyle='rgba(255,226,118,'+(0.25+pulse*0.22).toFixed(3)+')';
        ctx.beginPath();
        ctx.moveTo(px+TILE*0.28,py+TILE*0.5);
        ctx.lineTo(px+TILE*0.72,py+TILE*0.5);
        ctx.moveTo(px+TILE*0.5,py+TILE*0.28);
        ctx.lineTo(px+TILE*0.5,py+TILE*0.72);
        ctx.stroke();
        if(t===T.METEOR_DUST || t===T.WIRE || t===T.COPPER_WIRE){
          ctx.fillStyle='rgba(130,255,236,'+(0.12+pulse*0.18).toFixed(3)+')';
          ctx.beginPath(); ctx.arc(px+TILE/2,py+TILE/2,TILE*0.42,0,Math.PI*2); ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  function anchorsInRange(xa,xb){
    const out=[];
    const n0=Math.floor(xa/CFG.SPACING), n1=Math.floor(xb/CFG.SPACING);
    for(let n=n0;n<=n1;n++){
      const L=layoutFor(n);
      if(L && L.ax>=xa && L.ax<=xb) out.push({n:L.n,x:L.ax,size:L.size,tier:L.tier,variant:L.variant,chests:L.chests,tech:L.tech.length,commanders:L.commanders.length,minX:L.minX,maxX:L.maxX,minY:L.minY,maxY:L.maxY});
    }
    return out;
  }

  function nearest(x,dir,size){
    const n0=Math.floor(x/CFG.SPACING);
    const limit=size==='mega'? 4000 : 600;
    for(let k=0;k<=limit;k++){
      const L=layoutFor(n0+dir*k);
      if(!L) continue;
      if(size && L.size!==size) continue;
      if(dir>0 ? L.ax>x+2 : L.ax<x-2) return {x:L.ax,n:L.n,size:L.size,tier:L.tier,variant:L.variant};
    }
    return null;
  }

  function commanderOpenAt(x,y,getTile){
    const t0=typeof getTile==='function' ? getTile(x,y) : T.AIR;
    const t1=typeof getTile==='function' ? getTile(x,y-1) : T.AIR;
    return isReplaceableNaturalOpenTile(t0,false) && isReplaceableNaturalOpenTile(t1,false);
  }
  function findCommanderSpot(c,getTile){
    const sx=Math.floor(c.x), sy=Math.floor(c.y);
    for(let r=0;r<=4;r++){
      for(let dy=-r;dy<=r;dy++){
        for(let dx=-r;dx<=r;dx++){
          if(Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
          const x=sx+dx, y=sy+dy;
          if(commanderOpenAt(x,y,getTile)) return {x:x+0.5,y:y+0.98};
        }
      }
    }
    return null;
  }
  function update(dt,player,getTile,setTile,ctx){
    dt=Math.max(0,Math.min(0.25,Number(dt)||0));
    if(!player || !Number.isFinite(Number(player.x)) || !Number.isFinite(Number(player.y))) return;
    scanAcc -= dt;
    if(scanAcc>0) return;
    scanAcc = CFG.SCAN_INTERVAL;
    loadSeen();
    const inv=MM.invasions;
    if(!inv || typeof inv.spawnRuinCommander!=='function') return;
    if(typeof inv.westGuardianDefeated==='function' && inv.westGuardianDefeated()) return;
    const px=Number(player.x), py=Number(player.y);
    const anchors=anchorsInRange(px-100,px+100);
    for(const a of anchors){
      const L=layoutFor(a.n);
      if(!L || !Array.isArray(L.commanders) || !L.commanders.length) continue;
      for(const c of L.commanders){
        if(!c || !c.key || sessionSeen.has(c.key)) continue;
        const d=Math.hypot(px-c.x,py-c.y);
        if(d>CFG.COMMANDER_WAKE_RADIUS) continue;
        const spot=findCommanderSpot(c,getTile);
        if(!spot) continue;
        const team=inv.spawnRuinCommander(spot.x,spot.y,{
          key:c.key,
          player,
          ctx,
          setTile,
          getTile,
          tier:L.tier,
          threatBonus:Math.max(2,L.tier*2)
        });
        if(team){
          rememberCommander(c.key);
          return;
        }
      }
    }
  }
  function reset(){
    scanAcc=0;
    sessionSeen.clear();
    seenSeed=null;
  }

  const api={applyToChunk,layoutFor,anchorFor,anchorsInRange,nearest,drawHints,update,reset,config:CFG,clearCache:()=>cache.clear(),_debug:{sessionSeen}};
  MM.alienRuins=api;
  return api;
})();

export { alienRuins };
export default alienRuins;
