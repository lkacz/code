// Soot graffiti: soot is a PIGMENT. With a lump of sadza in the pouch the
// player smears one of a few stencils — an arrow (pointing where they face),
// an X, a heart, a dot — onto any backed cell: a solid tile face or a spot
// with a back wall behind it. Marks are world state: they persist in the save
// and every watcher/guest sees them, so in co-op they are trail signs you
// leave for your partner ("this way", "danger", "home").
//
// Multiplayer contract:
//   * the mark store is host truth; the save carries it (applyGameData hands
//     it to every joining guest) and the low-Hz 'gfx' plane streams live
//     changes (version-counter sig-skip — silence costs nothing).
//   * hero guests paint through the 'gfx' hact intent: the HOST validates
//     reach, rate and the glyph whitelist and writes the mark; the guest's
//     soot is its own pouch truth (hero trust model), so the client spends it
//     locally and paints a prediction the next plane packet confirms.
//   * paintAt validates the backing against WORLD truth — a modified client
//     cannot hang a mark in empty air.
import { T, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } from '../constants.js';

window.MM = window.MM || {};
(function(){
  const WORLD_TOP = Number.isFinite(WORLD_MIN_Y) ? WORLD_MIN_Y : 0;
  const WORLD_BOTTOM = Number.isFinite(WORLD_MAX_Y) ? WORLD_MAX_Y : WORLD_H;

  const GLYPHS = ['arrow','x','heart','dot']; // wire/whitelist order (pinned)
  const CFG = {
    CAP: 400,          // marks kept world-wide (oldest evicted)
    REACH: 6,          // same envelope as mine/place
    FADE_DAYS: 0,      // 0 = permanent until overwritten/mined (owner default)
  };

  const marks = new Map(); // "x,y" -> {x,y,g,dir}
  const K=(x,y)=>x+','+y;
  let version=0, painted=0, noted=false;

  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function validGlyph(g){ return typeof g==='string' && GLYPHS.includes(g); }
  function inWorld(x,y){ return Number.isFinite(x) && Number.isFinite(y) && y>=WORLD_TOP && y<WORLD_BOTTOM && Math.abs(x)<1000000; }
  function backgroundAt(x,y){
    try{
      const w=MM.world;
      if(w && typeof w.getConstructionBackground==='function'){
        const bg=w.getConstructionBackground(x,y);
        if(bg && bg!==T.AIR) return true;
      }
    }catch(e){}
    return false;
  }
  // A mark needs something to sit ON: the face of a solid tile, or an open
  // cell with a back wall behind it. Empty sky takes no pigment.
  function canPaintAt(x,y,getTile){
    if(!inWorld(x,y) || typeof getTile!=='function') return false;
    const t=getTile(x,y);
    if(t===undefined || t===null) return false;
    if(t!==T.AIR) return t!==T.WATER && t!==T.LAVA; // any real tile face holds soot
    return backgroundAt(x,y);
  }
  function paintAt(x,y,glyph,dir,getTile){
    x=Math.floor(Number(x)); y=Math.floor(Number(y));
    if(!validGlyph(glyph) || !canPaintAt(x,y,getTile)) return false;
    if(marks.size>=CFG.CAP && !marks.has(K(x,y))){
      const oldest=marks.keys().next().value;
      if(oldest!==undefined) marks.delete(oldest);
    }
    marks.set(K(x,y),{x,y,g:glyph,dir:Number(dir)>=0?1:-1});
    version++;
    painted++;
    try{ if(MM.audio && MM.audio.play) MM.audio.play('dig',{x:x+0.5,y:y+0.5}); }catch(e){}
    if(!noted){
      noted=true;
      try{ if(MM.discovery && MM.discovery.note) MM.discovery.note('graffiti','Sadza to pigment — znaki na ścianach prowadzą drużynę.'); }catch(e){}
    }
    return true;
  }
  function eraseAt(x,y){
    const had=marks.delete(K(Math.floor(x),Math.floor(y)));
    if(had) version++;
    return had;
  }
  // Mined-out backing sheds its mark (validated lazily on draw + plane reads).
  function validateCell(x,y,getTile){
    const m=marks.get(K(x,y));
    if(!m) return;
    if(!canPaintAt(x,y,getTile)){ marks.delete(K(x,y)); version++; }
  }
  function update(dt,player,getTile){
    if(!(dt>0) || typeof getTile!=='function' || !marks.size) return;
    // lazy validation: a handful of marks per frame keeps the store honest
    let n=0;
    for(const m of marks.values()){
      if(++n>6) break;
      validateCell(m.x,m.y,getTile);
    }
  }

  function drawGlyph(ctx,TILE,m){
    const x=m.x*TILE, y=m.y*TILE, cx=x+TILE*0.5, cy=y+TILE*0.5;
    ctx.strokeStyle='rgba(24,26,30,0.82)';
    ctx.fillStyle='rgba(24,26,30,0.82)';
    ctx.lineWidth=Math.max(1.6,TILE*0.11);
    ctx.lineCap='round';
    if(m.g==='arrow'){
      const d=m.dir>=0?1:-1;
      ctx.beginPath();
      ctx.moveTo(cx-d*TILE*0.28,cy);
      ctx.lineTo(cx+d*TILE*0.28,cy);
      ctx.moveTo(cx+d*TILE*0.1,cy-TILE*0.16);
      ctx.lineTo(cx+d*TILE*0.3,cy);
      ctx.lineTo(cx+d*TILE*0.1,cy+TILE*0.16);
      ctx.stroke();
    } else if(m.g==='x'){
      ctx.beginPath();
      ctx.moveTo(cx-TILE*0.22,cy-TILE*0.22);
      ctx.lineTo(cx+TILE*0.22,cy+TILE*0.22);
      ctx.moveTo(cx+TILE*0.22,cy-TILE*0.22);
      ctx.lineTo(cx-TILE*0.22,cy+TILE*0.22);
      ctx.stroke();
    } else if(m.g==='heart'){
      ctx.beginPath();
      ctx.moveTo(cx,cy+TILE*0.22);
      ctx.bezierCurveTo(cx-TILE*0.34,cy-TILE*0.05,cx-TILE*0.16,cy-TILE*0.3,cx,cy-TILE*0.08);
      ctx.bezierCurveTo(cx+TILE*0.16,cy-TILE*0.3,cx+TILE*0.34,cy-TILE*0.05,cx,cy+TILE*0.22);
      ctx.fill();
    } else { // dot
      ctx.beginPath();
      ctx.arc(cx,cy,TILE*0.12,0,Math.PI*2);
      ctx.fill();
    }
  }
  function draw(ctx,TILE,visible){
    if(!ctx || !marks.size) return;
    ctx.save();
    for(const m of marks.values()){
      if(typeof visible==='function' && !visible(m.x,m.y)) continue;
      drawGlyph(ctx,TILE,m);
    }
    ctx.restore();
  }

  // --- save + wire ------------------------------------------------------------
  function snapshot(){
    const out=[];
    for(const m of marks.values()){
      out.push([m.x,m.y,GLYPHS.indexOf(m.g),m.dir]);
      if(out.length>=CFG.CAP) break;
    }
    return {v:1, marks:out};
  }
  function sanitizeRows(rows){
    const out=[];
    if(!Array.isArray(rows)) return out;
    for(const row of rows.slice(0,CFG.CAP)){
      if(!Array.isArray(row) || row.length<3) continue;
      const x=Math.floor(Number(row[0])), y=Math.floor(Number(row[1]));
      const g=GLYPHS[clamp(Math.floor(Number(row[2]))||0,0,GLYPHS.length-1)];
      if(!inWorld(x,y) || !g) continue;
      out.push({x,y,g,dir:Number(row[3])>=0?1:-1});
    }
    return out;
  }
  function restore(s){
    marks.clear();
    version++;
    if(!s || typeof s!=='object') return;
    for(const m of sanitizeRows(s.marks)) marks.set(K(m.x,m.y),m);
  }
  // 'gfx' plane: the full (bounded) mark list, sig-skipped by version.
  function ghostVersion(){ return version; }
  function ghostOut(){ return snapshot().marks; }
  function ghostApply(rows){
    marks.clear();
    for(const m of sanitizeRows(rows)) marks.set(K(m.x,m.y),m);
    version++;
    return marks.size;
  }

  function reset(){
    marks.clear();
    version++;
    painted=0; noted=false;
  }
  function metrics(){
    return {marks:marks.size, painted, version};
  }

  MM.graffiti={update, draw, paintAt, eraseAt, canPaintAt, validGlyph, reset, metrics,
    snapshot, restore, ghostVersion, ghostOut, ghostApply,
    GLYPHS:GLYPHS.slice(), config:CFG,
    _debug:{marks, sanitizeRows, drawGlyph}};
})();

export const graffiti = (typeof window!=='undefined' && window.MM) ? window.MM.graffiti : globalThis.MM && globalThis.MM.graffiti;
export default graffiti;
