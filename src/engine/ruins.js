// Underground ruin complexes: weathered surface traces (pillar stubs, rubble,
// an arch, a well ring — or a rare obsidian monolith) whisper "dig here".
// Below waits anything from a tiny burial crypt to a sprawling temple — and,
// once in a hundred ruins, a whole TORCH-LIT CITY carved into a cavern just
// above the bedrock, with towers, bridges, a lava moat, a crystal garden and
// an obsidian ziggurat hiding the richest treasure in the game.
//
// Variety comes from three stacked layers of seeded choices:
//   theme    — biome-driven material accents (ice walls in the cold, sandstone
//              in deserts, flooded floors in swamps, obsidian veins in peaks)
//   variant  — per-class architecture (crypt: plain/sarcophagus/collapsed;
//              cellar: stacked/twin/open well; temple treasure room:
//              obsidian vault / lava altar / flooded reliquary; zigzag shafts)
//   decay    — per-ruin erosion level applied to every wall
//
// ARCHITECTURE NOTE — anchors, not chunks: ruins can span chunk borders, so
// they cannot be generated per-chunk like placeStructures' surface props.
// Deterministic anchor cells repeat every SPACING columns; a layout is a pure
// function of (worldSeed, cell) producing an ordered op list in WORLD
// coordinates (later ops win, so corridors cut through walls). ensureChunk
// asks applyToChunk() for the slice crossing it, so every chunk reconstructs
// the same ruin regardless of generation order. Ops are 'force' (interiors,
// masonry, chests, fluids) or 'soft' (surface hints that only settle onto
// open air, never cutting into terrain or trees).
import { CHUNK_W, WORLD_H, T } from '../constants.js';
import { worldGen as WG } from './worldgen.js';

const ruins = (function(){
  const MM = (typeof window!=='undefined')? (window.MM = window.MM || {}) : {};
  const CFG = { SPACING:160, GATE:0.55, MARGIN:34, CACHE_CAP:300, MEGA_ROLL:0.99 };
  const cache = new Map(); // `${worldSeed}:${cell}` -> layout | null

  function mulberry32(a){ a=a>>>0; return function(){ a|=0; a=(a+0x6D2B79F5)|0; let t=Math.imul(a^(a>>>15),1|a); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }

  // Deterministic anchor column for cell n, or null when the cell stays empty
  function anchorFor(n){
    if(WG.randSeed(n*17.93+8.41) >= CFG.GATE) return null;
    const span = CFG.SPACING - CFG.MARGIN*2;
    const ax = Math.round(n*CFG.SPACING + CFG.MARGIN + WG.randSeed(n*9.47+3.31)*span);
    try{ const b = WG.biomeType? WG.biomeType(ax) : 1; if(b===5 || b===6) return null; }catch(e){} // not under seas/lakes
    return ax;
  }

  function layoutFor(n){
    const key = (WG.worldSeed||0)+':'+n;
    if(cache.has(key)) return cache.get(key);
    if(cache.size > CFG.CACHE_CAP) cache.clear(); // pure cache: safe to rebuild
    const ax = anchorFor(n);
    const L = (ax==null)? null : build(n, ax);
    cache.set(key, L);
    return L;
  }

  function build(n, ax){
    const r = mulberry32(((WG.worldSeed||1) ^ Math.imul(n|0, 2654435761))>>>0);
    const surf = (x)=>{ try{ return WG.surfaceHeight(Math.round(x)); }catch(e){ return 60; } };
    const s0 = surf(ax);
    let biome = 1; try{ biome = WG.biomeType? WG.biomeType(ax) : 1; }catch(e){}
    const ops = []; // applied in order — later ops win
    const traps = []; // runtime defs picked up by engine/traps.js (pure data)
    const hints = []; // surface-marker cells — drawHints() dresses them as worked masonry
    const trap=(kind,x,y,d)=>traps.push(Object.assign({kind,x:Math.round(x),y:Math.round(y)},d||{}));
    let minX=ax, maxX=ax, minY=s0, maxY=s0;
    const put=(x,y,t,force)=>{
      x=Math.round(x); y=Math.round(y);
      if(y<1 || y>=WORLD_H-3) return; // bedrock shelf stays intact
      ops.push({x,y,t,f:force?1:0});
      if(!force) hints.push({x,y});
      if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y;
    };
    const ri=(a,b)=>a+Math.floor(r()*(b-a+1));
    const pick=(arr)=>arr[Math.floor(r()*arr.length)];

    // --- theme: biome-flavored masonry and floor treatment ---
    const accent = biome===2? T.ICE : biome===3? T.SAND : biome===7? T.OBSIDIAN : null;
    const accentP = accent? (biome===7? 0.10 : 0.30) : 0;
    const flooded = biome===4 && r()<0.6; // swamp ruins seep
    const decay = 0.12 + r()*0.2;
    const wallT = ()=> (accent && r()<accentP)? accent : T.STONE;

    // --- builders ---
    function room(x0,y0,w,h,opts){
      const dk=(opts&&opts.decay!==undefined)?opts.decay:decay;
      const shell=(opts&&opts.shell)||wallT;
      for(let y=y0;y<y0+h;y++) for(let x=x0;x<x0+w;x++){
        const edge=(x===x0||x===x0+w-1||y===y0||y===y0+h-1);
        if(edge){ if(r()>=dk) put(x,y, typeof shell==='function'? shell() : shell, true); }
        else put(x,y,T.AIR,true);
      }
      if(flooded && (!opts||!opts.dry)) for(let x=x0+1;x<x0+w-1;x++) put(x,y0+h-2,T.WATER,true);
    }
    function tunnelH(x0,x1,y){ const a=Math.min(x0,x1), b=Math.max(x0,x1);
      for(let x=a;x<=b;x++){ put(x,y-1,T.AIR,true); put(x,y,T.AIR,true); put(x,y+1,wallT(),true); } }
    function tunnelV(x,y0,y1,zigzag){
      let cx=x; const a=Math.min(y0,y1), b=Math.max(y0,y1); let leg=ri(4,7);
      for(let y=a;y<=b;y++){
        put(cx,y,T.AIR,true); put(cx+1,y,T.AIR,true);
        if(zigzag && --leg<=0 && y<b-2){ const d=r()<0.5?-2:2; tunnelH(cx, cx+d+(d>0?1:0), y); cx+=d; leg=ri(4,7); }
      }
      return cx; // where the shaft ends up after its jogs
    }
    function chest(x,y,t){ put(x,y+1,T.STONE,true); put(x,y,t,true); } // always on solid footing
    const torch=(x,y)=>put(x,y,T.TORCH,true);
    function rubblePile(x0,x1,y){ for(let x=x0;x<=x1;x++) if(r()<0.5) put(x,y,T.STONE,true); }

    // --- size & class ---
    const roll=r();
    const size = roll<0.50? 'small' : roll<0.84? 'medium' : roll<CFG.MEGA_ROLL? 'large' : 'mega';
    let chests=0, variant='plain';

    if(size==='small'){
      variant=pick(['plain','sarcophagus','collapsed']);
      const w=ri(5,8), h=ri(4,5)+(variant==='sarcophagus'?1:0), top=s0+ri(3,7), x0=ax-(w>>1);
      room(x0,top,w,h,{decay:variant==='collapsed'?0.32:decay});
      const cy=variant==='sarcophagus'? top+h-3 : top+h-2;
      if(variant==='sarcophagus'){ put(ax,top+h-2,T.STONE,true); chest(ax,cy, r()<0.5?T.CHEST_RARE:T.CHEST_COMMON); }
      else chest(ax, cy, r()<0.3? T.CHEST_COMMON : T.CHEST_RARE);
      chests++;
      if(variant==='collapsed') rubblePile(x0+1,x0+w-2,top+h-2);
      if(r()<0.4) torch(x0+1, top+1);
      // grave gas waits for whoever disturbs the chest (wisps betray it)
      if(r()<0.55) trap('gas', ax, cy, {r:2.6, cells:[[ax,cy]]});
    }
    else if(size==='medium'){
      variant=pick(['cellar','well','twin']);
      if(variant==='well'){
        // an open stone-ringed well: the one ruin you can fall into
        const d=ri(10,16), shX=ax;
        for(let y=s0;y<s0+d;y++){ put(shX-1,y,wallT(),true); put(shX,y,T.AIR,true); put(shX+1,y,wallT(),true); }
        put(shX-1,s0-1,T.STONE,false); put(shX+1,s0-1,T.STONE,false); // the rim, settled on the surface
        const w=ri(7,9), h=ri(4,5), x0=shX-(w>>1);
        room(x0,s0+d,w,h);
        chest(shX, s0+d+h-2, T.CHEST_RARE); chests++;
        torch(x0+1,s0+d+1); torch(x0+w-2,s0+d+1);
        // someone mined the well bottom... and left a rune behind
        if(r()<0.45) trap('boom', shX-2, s0+d+h-1, {});
      } else {
        const w1=ri(7,10), h1=ri(4,5), top=s0+ri(3,6), x0=ax-(w1>>1);
        room(x0,top,w1,h1);
        torch(x0+(w1>>1), top+1);
        const dir=r()<0.5?-1:1;
        const w2=ri(6,9), h2=ri(4,6);
        const x2= dir>0? x0+w1+ri(2,5) : x0-ri(2,5)-w2;
        const top2= variant==='twin'? top : top+h1+ri(1,4);
        room(x2,top2,w2,h2);
        let corrY, corrA, corrB;
        if(variant==='twin'){ corrA=dir>0? x0+w1-2 : x2+w2-2; corrB=dir>0? x2+1 : x0+1; corrY=top+h1-2; tunnelH(corrA, corrB, corrY); }
        else { const sx= dir>0? x0+w1-2 : x0+1; tunnelV(sx, top+h1-1, top2+1); corrY=top2+(h2>>1); corrA=sx; corrB=dir>0? x2+1 : x2+w2-2; tunnelH(corrA, corrB, corrY); }
        chest(x2+(w2>>1), top2+h2-2, T.CHEST_RARE); chests++;
        if(r()<0.5){ chest(x0+1, top+h1-2, T.CHEST_COMMON); chests++; }
        if(r()<0.6) torch(x2+(w2>>1), top2+1);
        if(r()<0.25){ put(x0+ri(1,w1-2), top+h1-1, T.DIAMOND, true); } // a glint in the floor
        const midX=Math.round((corrA+corrB)/2);
        if(variant==='cellar' && r()<0.5){
          // cracked corridor floor over a hidden pit: half the time a lava bath,
          // half the time... a bonus chest. Falling is a gamble.
          const surprise=r()<0.5?'lava':'chest';
          for(let yy=corrY+2; yy<=corrY+5; yy++) for(let xx=midX-1; xx<=midX+1; xx++) put(xx,yy,T.AIR,true);
          if(surprise==='lava'){ for(let xx=midX-1;xx<=midX+1;xx++){ put(xx,corrY+5,T.LAVA,true); put(xx,corrY+6,T.STONE,true); } put(midX-2,corrY+5,T.STONE,true); put(midX+2,corrY+5,T.STONE,true); }
          else { chest(midX, corrY+5, T.CHEST_COMMON); chests++; }
          trap('collapse', midX, corrY+1, {w:3, surprise});
        } else if(r()<0.6){
          // a hair-thin tripwire strung across the corridor
          trap('dart', midX, corrY, {dir});
        }
        if(variant==='twin' && r()<0.5){
          // a sealed water pocket behind the far wall — mine carefully
          const wx3 = dir>0? x2+w2-1 : x2;
          const ox = wx3 + (dir>0?1:-1);
          put(ox, top+h1-2, T.WATER, true); put(ox, top+h1-3, T.WATER, true);
          put(ox+(dir>0?1:-1), top+h1-2, wallT(), true); put(ox+(dir>0?1:-1), top+h1-3, wallT(), true);
          put(ox, top+h1-4, wallT(), true);
          trap('keystone', wx3, top+h1-2, {cells:[[wx3,top+h1-2],[wx3,top+h1-3]], fluid:'water'});
        }
      }
    }
    else if(size==='large'){
      // a buried temple: entry hall, grand (sometimes zigzag) shaft, side
      // galleries, and one of three treasure rooms at the bottom
      variant=pick(['vault','lavaAltar','flooded']);
      const hallW=ri(8,12), hallH=ri(4,5), top=s0+ri(3,5), hx0=ax-(hallW>>1);
      room(hx0,top,hallW,hallH,{dry:true});
      if(r()<0.5) for(let cx2=hx0+2; cx2<hx0+hallW-2; cx2+=3) for(let y=top+1;y<top+hallH-1;y++) put(cx2,y,wallT(),true); // colonnade
      torch(hx0+2,top+1); torch(hx0+hallW-3,top+1);
      const depth=ri(16,24);
      const shX0=ax+(r()<0.5?-1:1)*ri(0,2);
      const shX=tunnelV(shX0, top+hallH-1, top+depth, r()<0.5);
      const levels=ri(2,3);
      for(let i=0;i<levels;i++){
        const ly=top+((i+1)*Math.floor(depth/(levels+1)))+ri(0,2);
        const dir=(i%2===0)?1:-1;
        const w=ri(6,10), h=ri(4,5);
        const rx= dir>0? shX+ri(3,6) : shX-ri(3,6)-w;
        room(rx,ly,w,h);
        tunnelH(shX+1, dir>0? rx+1 : rx+w-2, ly+h-2);
        if(r()<0.6){ chest(rx+(w>>1)+ri(-1,1), ly+h-2, r()<0.5? T.CHEST_COMMON : T.CHEST_RARE); chests++; }
        if(r()<0.7) torch(dir>0? rx+1 : rx+w-2, ly+1);
        if(i===0 && r()<0.7) trap('dart', dir>0? shX+2 : shX-1, ly+h-2, {dir}); // wire at the gallery mouth
      }
      const vw=ri(7,9), vh=ri(4,5), vy=top+depth+1, vx=shX-(vw>>1);
      if(variant==='vault'){
        for(let y=vy;y<vy+vh;y++) for(let x=vx;x<vx+vw;x++){
          const edge=(x===vx||x===vx+vw-1||y===vy||y===vy+vh-1);
          put(x,y, edge? T.OBSIDIAN : T.AIR, true);
        }
        const studs=ri(2,4);
        for(let i=0;i<studs;i++) put(vx+ri(1,vw-2), (r()<0.5? vy : vy+vh-1), T.DIAMOND, true);
        torch(vx+1, vy+1); torch(vx+vw-2, vy+1);
        chest(shX, vy+vh-2, T.CHEST_EPIC); chests++;
        // rigged roof: lava sleeps above two roof blocks — mine the WRONG one
        // (the seeping glow gives it away) and the vault becomes a fondue pot
        put(vx+1,vy-2,T.STONE,true); put(vx+2,vy-2,T.STONE,true);
        put(vx+1,vy-1,T.LAVA,true); put(vx+2,vy-1,T.LAVA,true);
        trap('keystone', vx+1, vy, {cells:[[vx+1,vy],[vx+2,vy]], fluid:'lava'});
        if(r()<0.5) trap('boom', vx+2, vy+vh-1, {}); // and a rune plate before the chest
      } else if(variant==='lavaAltar'){
        room(vx,vy,vw,vh+1,{dry:true});
        for(let x=vx+1;x<vx+vw-1;x++){ put(x,vy+vh-1,T.LAVA,true); } // molten moat in a stone basin
        put(shX,vy+vh-1,T.STONE,true); put(shX,vy+vh-2,T.STONE,true); // the altar pedestal rises from the lava
        chest(shX,vy+vh-3,T.CHEST_EPIC); chests++;
      } else { // flooded reliquary: dive for it
        room(vx,vy,vw,vh,{dry:true});
        for(let y=vy+1;y<vy+vh-1;y++) for(let x=vx+1;x<vx+vw-1;x++) put(x,y,T.WATER,true);
        chest(vx+(vw>>1), vy+vh-2, T.CHEST_EPIC); chests++;
        torch(shX, vy-1);
      }
      put(shX, vy, T.AIR, true); // the only breach in the roof, under the shaft
    }
    else { // === mega (1 in 100): the Buried City ===
      variant='city';
      const floorY=WORLD_H-7;                       // streets just above the bedrock shelf
      const ceilY=Math.min(Math.max(s0+38, 96), floorY-22); // a LONG dig, but room to breathe
      const W=ri(54,64), x0=ax-(W>>1), half=W>>1;
      // the great cavern: domed ceiling, gently rolling floor
      for(let x=x0;x<x0+W;x++){
        const tx=(x-x0)/(W-1);
        const arc=Math.sin(tx*Math.PI);              // 0 at edges, 1 mid
        const cy=Math.round(ceilY + (1-arc)*6 + Math.sin(x*0.7)*1.5);
        const fy=Math.round(floorY - Math.sin(x*0.31+n)*1.5);
        for(let y=cy;y<=fy;y++) put(x,y,T.AIR,true);
        put(x,fy+1,wallT(),true);                    // paved street
      }
      // stalactites with diamond tips, kept clear of the city blocks
      for(let x=x0+2;x<x0+W-2;x+=ri(4,7)){
        const tx=(x-x0)/(W-1), arc=Math.sin(tx*Math.PI);
        const cy=Math.round(ceilY + (1-arc)*6 + Math.sin(x*0.7)*1.5);
        const len=ri(1,4);
        for(let i=0;i<len;i++) put(x,cy+i,T.STONE,true);
        if(r()<0.3) put(x,cy+len,T.DIAMOND,true);
      }
      // twin towers flanking the ziggurat, torch-lit windows, a slender bridge
      // arching between their roofs high over the city's heart
      const towerX=[ax-ri(14,18), ax+ri(14,18)];
      towerX.forEach((tx2,i)=>{
        const tw=ri(5,7), th=ri(9,13), base=floorY;
        for(let y=base-th;y<=base;y++) for(let x=tx2-(tw>>1);x<=tx2+(tw>>1);x++){
          const edge=(x===tx2-(tw>>1)||x===tx2+(tw>>1)||y===base-th);
          put(x,y, edge? wallT() : T.AIR, true);
        }
        put(tx2, base, T.AIR, true);                 // doorway
        for(let y=base-2;y>base-th;y-=3) torch(tx2, y); // lit windows climbing the tower
        if(i===0){ chest(tx2, base-1, T.CHEST_RARE); chests++; }
      });
      const by=floorY-ri(11,13);
      for(let x=towerX[0];x<=towerX[1];x++) if(r()>=0.12) put(x,by,T.STONE,true);
      // the obsidian ziggurat at the heart, treasure chamber inside
      const zx=ax, zl=ri(4,5);
      for(let lvl2=0;lvl2<zl;lvl2++){
        const hw=2*(zl-lvl2)+1, zy=floorY-lvl2*2;
        for(let x=zx-hw;x<=zx+hw;x++) for(let y=zy-1;y<=zy;y++)
          put(x,y, (Math.abs(x-zx)===hw||lvl2===zl-1)? T.OBSIDIAN : wallT(), true);
        torch(zx-hw, zy-2); torch(zx+hw, zy-2);
      }
      for(let x=zx-3;x<=zx+3;x++) for(let y=floorY-2;y<=floorY-1;y++) put(x,y,T.AIR,true); // chamber
      chest(zx-2, floorY-2, T.CHEST_EPIC); chest(zx+2, floorY-2, T.CHEST_EPIC); chests+=2;
      put(zx, floorY-1, T.DIAMOND, true);
      put(zx-3, floorY-2, T.DIAMOND, true); put(zx+3, floorY-2, T.DIAMOND, true);
      // lava moat in a stone basin on one outer flank — the city glows from below
      const mDir=r()<0.5?-1:1, m0=ax+mDir*ri(20,half-7), mw=ri(4,5);
      const ma=Math.min(m0,m0+mDir*mw), mb=Math.max(m0,m0+mDir*mw);
      for(let x=ma;x<=mb;x++){ put(x,floorY,T.LAVA,true); put(x,floorY+1,T.STONE,true); }
      put(ma-1,floorY,T.STONE,true); put(mb+1,floorY,T.STONE,true);
      // crystal garden on the other outer flank
      const g0=ax-mDir*ri(20,half-5);
      for(let i=0;i<ri(4,7);i++){ const gx=g0+ri(-3,3); put(gx, floorY-(r()<0.4?1:0), T.DIAMOND, true); }
      // street lights
      for(let x=x0+4;x<x0+W-4;x+=ri(6,9)) torch(x, floorY-1);
      // the city defends itself: tripwires by the towers, a rune plate on the
      // promenade, grave gas guarding the tower chest, and a rigged chamber
      // ceiling that turns the treasure room into a fondue pot if mined
      const fyAt=(x)=>Math.round(floorY - Math.sin(x*0.31+n)*1.5);
      towerX.forEach((tx3)=>{ const wx2=tx3+(tx3<ax? 4 : -4); trap('dart', wx2, fyAt(wx2)-1, {dir: tx3<ax? -1 : 1}); });
      const bx2=ax-mDir*ri(7,11); trap('boom', bx2, fyAt(bx2)+1, {});
      trap('gas', towerX[0], floorY-1, {r:2.8, cells:[[towerX[0],floorY-1]]});
      put(zx-1,floorY-5,T.OBSIDIAN,true); put(zx,floorY-5,T.OBSIDIAN,true); put(zx+1,floorY-5,T.OBSIDIAN,true);
      put(zx-1,floorY-4,T.LAVA,true); put(zx,floorY-4,T.LAVA,true); put(zx+1,floorY-4,T.LAVA,true);
      trap('keystone', zx-1, floorY-3, {cells:[[zx-1,floorY-3],[zx,floorY-3],[zx+1,floorY-3]], fluid:'lava'});
      // the surface marker: a lone obsidian monolith — the sign of the deep city
      const sy=surf(ax);
      for(let i=1;i<=3;i++) put(ax, sy-i, T.OBSIDIAN, false);
      put(ax-1, sy-1, T.STONE, false); put(ax+1, sy-1, T.STONE, false);
    }

    // surface hints for the non-mega classes: subtle weathered traces
    if(size!=='mega'){
      const hintT=()=> (accent && r()<0.4)? accent : T.STONE;
      // at least two blocks tall — a single stone vanishes into natural terrain
      const pillar=(x,maxH)=>{ const sy=surf(x); const hh=ri(2,Math.max(2,maxH)); for(let i=1;i<=hh;i++) put(x,sy-i,hintT(),false); };
      const rubble=(x)=>put(x, surf(x)-1, hintT(), false);
      if(size==='small'){
        pillar(ax+ri(-2,2), 2); rubble(ax+ri(1,3)); if(r()<0.6) rubble(ax-ri(1,3));
      } else if(size==='medium'){
        pillar(ax-ri(1,3), 2); pillar(ax+ri(1,3), 2); rubble(ax+ri(-4,4));
      } else {
        pillar(ax-2, 3); pillar(ax+2, 3);
        const syL=surf(ax-2), syR=surf(ax+2);
        if(Math.abs(syL-syR)<=1){ const ly2=Math.min(syL,syR)-3; put(ax-1,ly2,T.STONE,false); put(ax,ly2,T.STONE,false); put(ax+1,ly2,T.STONE,false); }
        rubble(ax-ri(3,5)); rubble(ax+ri(3,5));
      }
    }

    return { n, ax, size, variant, chests, traps, hints, ops, minX, maxX, minY, maxY };
  }

  // Write the slice of every nearby ruin that crosses chunk cx into its array
  function applyToChunk(arr, cx){
    const x0=cx*CHUNK_W, x1=x0+CHUNK_W-1;
    const n0=Math.floor((x0-CFG.SPACING)/CFG.SPACING), n1=Math.floor((x1+CFG.SPACING)/CFG.SPACING);
    for(let n=n0;n<=n1;n++){
      const L=layoutFor(n);
      if(!L || L.maxX<x0 || L.minX>x1) continue;
      for(const op of L.ops){
        if(op.x<x0 || op.x>x1) continue;
        const idx=op.y*CHUNK_W+(op.x-x0);
        if(op.f){ arr[idx]=op.t; }
        else { const cur=arr[idx]; if(cur===T.AIR || cur===T.WATER) arr[idx]=op.t; }
      }
    }
  }

  // Dress the surface markers so they read as ANCIENT MASONRY, not loose rock:
  // an inset chiseled frame + mortar seam on every hint block, moss tufts, and
  // a softly pulsing etched rune (with halo) on the topmost stone — violet on
  // the deep city's obsidian monolith, gold everywhere else. Mined-away hint
  // blocks lose their dressing automatically (the world tile is gone).
  function drawHints(ctx, TILE){
    if(typeof document==='undefined') return;
    const pl=(typeof window!=='undefined' && window.player)||null; if(!pl) return;
    const W=MM.world; if(!W || !W.getTile) return;
    const now=performance.now();
    let anchors=[]; try{ anchors=anchorsInRange(pl.x-90, pl.x+90); }catch(e){ return; }
    ctx.save();
    for(const a of anchors){
      const L=layoutFor(a.n); if(!L || !L.hints || !L.hints.length) continue;
      let top=0;
      for(let i=1;i<L.hints.length;i++){ const h=L.hints[i], t=L.hints[top]; if(h.y<t.y || (h.y===t.y && h.x<t.x)) top=i; }
      for(let i=0;i<L.hints.length;i++){
        const h=L.hints[i];
        const t=W.getTile(h.x,h.y);
        if(t===T.AIR || t===T.WATER) continue;
        const px=h.x*TILE, py=h.y*TILE;
        const obsid=(t===T.OBSIDIAN);
        ctx.strokeStyle='rgba(12,12,18,0.45)'; ctx.lineWidth=1;
        ctx.strokeRect(px+1.5, py+1.5, TILE-3, TILE-3);
        ctx.fillStyle='rgba(12,12,18,0.30)';
        ctx.fillRect(px+2, py+TILE*0.5-0.5, TILE-4, 1);
        if(!obsid && ((h.x*7+h.y*13)&3)!==0){
          ctx.fillStyle='rgba(86,140,70,0.8)';
          ctx.fillRect(px+2+((h.x*5)%3)*3, py-1, 4, 3);
          ctx.fillRect(px+TILE-7, py-1, 3, 2);
        }
        if(i===top){
          const a2=(obsid?0.5:0.35)+0.2*Math.sin(now*0.002+h.x);
          ctx.fillStyle=obsid? 'rgba(180,120,255,'+(a2*0.18).toFixed(2)+')' : 'rgba(255,220,140,'+(a2*0.15).toFixed(2)+')';
          ctx.beginPath(); ctx.arc(px+TILE/2, py+TILE/2, TILE*0.7, 0, Math.PI*2); ctx.fill();
          ctx.strokeStyle=obsid? 'rgba(205,150,255,'+a2.toFixed(2)+')' : 'rgba(255,224,150,'+a2.toFixed(2)+')';
          ctx.lineWidth=1.4; ctx.lineCap='round';
          const cx2=px+TILE/2, cy2=py+TILE/2;
          ctx.beginPath();
          ctx.moveTo(cx2, cy2-TILE*0.26); ctx.lineTo(cx2, cy2+TILE*0.26);
          ctx.moveTo(cx2-TILE*0.18, cy2-TILE*0.10); ctx.lineTo(cx2+TILE*0.18, cy2-TILE*0.10);
          ctx.moveTo(cx2-TILE*0.13, cy2+TILE*0.16); ctx.lineTo(cx2+TILE*0.13, cy2+TILE*0.16);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // Nearest ruin of a given size class (or any) strictly left/right of x —
  // debug teleports hop along these. Mega cities are ~1 in 200 cells, so their
  // scan horizon is much wider.
  function nearest(x, dir, size){
    const n0=Math.floor(x/CFG.SPACING);
    const limit = size==='mega'? 6000 : 600;
    for(let k=0;k<=limit;k++){
      const L=layoutFor(n0+dir*k);
      if(!L) continue;
      if(size && L.size!==size) continue;
      if(dir>0? L.ax>x+2 : L.ax<x-2) return {x:L.ax, n:L.n, size:L.size, variant:L.variant};
    }
    return null;
  }

  function anchorsInRange(xa,xb){
    const out=[];
    const n0=Math.floor(xa/CFG.SPACING), n1=Math.floor(xb/CFG.SPACING);
    for(let n=n0;n<=n1;n++){ const L=layoutFor(n); if(L && L.ax>=xa && L.ax<=xb) out.push({n:L.n, x:L.ax, size:L.size, variant:L.variant, chests:L.chests, minX:L.minX, maxX:L.maxX, minY:L.minY, maxY:L.maxY}); }
    return out;
  }

  const api={ applyToChunk, layoutFor, anchorFor, anchorsInRange, nearest, drawHints, config:CFG, clearCache:()=>cache.clear() };
  MM.ruins=api;
  return api;
})();

export { ruins };
export default ruins;
