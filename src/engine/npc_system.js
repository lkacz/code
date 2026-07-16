import { T, WORLD_H, WORLD_MIN_Y, WORLD_MAX_Y } from '../constants.js';
import { isNpcPassableTile, isSafeLandingFloorTile, isSolidCollisionTile as isSolid, isTrapdoorTile } from './material_physics.js';
import { isLongCharacterSpeech, readableCharacterSpeechDuration } from './character_speech.js';

function runtimeRoot(){ return (typeof window!=='undefined') ? window : globalThis; }
function finite(v){ return typeof v==='number' && isFinite(v); }
function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
function now(){ try{ return performance.now(); }catch(e){ return Date.now(); } }
function clonePlain(obj){ return obj && typeof obj==='object' ? Object.assign({},obj) : obj; }
const NPC_RESTORE_CAP=4096;
const NPC_RESTORE_SCAN_CAP=8192;
const NPC_RECORD_KEY_CAP=128;
const NPC_RECORD_NODE_CAP=512;
const NPC_RECORD_ARRAY_CAP=64;
const NPC_RECORD_DEPTH_CAP=3;
const NPC_RECORD_STRING_CAP=512;
const NPC_RECORD_NUMBER_CAP=1000000000;
const NPC_MAX_ABS_X=30000000;
const NPC_Y_MARGIN=32;
const NPC_TRANSIENT_TIME_CAP=3600;
function safeRecordKey(k){ return k!=='__proto__' && k!=='prototype' && k!=='constructor'; }
function cleanJsonValue(value,depth,budget,seen){
  if(budget.left--<=0) return undefined;
  if(value===null || typeof value==='boolean') return value;
  if(typeof value==='string') return value.slice(0,NPC_RECORD_STRING_CAP);
  if(typeof value==='number'){
    if(!Number.isFinite(value)) return undefined;
    return clamp(value,-NPC_RECORD_NUMBER_CAP,NPC_RECORD_NUMBER_CAP);
  }
  if(typeof value!=='object' || depth>=NPC_RECORD_DEPTH_CAP) return undefined;
  if(seen.has(value)) return undefined;
  seen.add(value);
  if(Array.isArray(value)){
    const out=[];
    const count=Math.min(value.length,NPC_RECORD_ARRAY_CAP);
    for(let i=0;i<count && budget.left>0;i++){
      let item;
      try{ item=cleanJsonValue(value[i],depth+1,budget,seen); }catch(e){ item=undefined; }
      if(item!==undefined) out.push(item);
    }
    seen.delete(value);
    return out;
  }
  const out={};
  let processed=0;
  for(const k in value){
    if(processed>=NPC_RECORD_KEY_CAP || budget.left<=0) break;
    if(!Object.prototype.hasOwnProperty.call(value,k) || !safeRecordKey(k)) continue;
    processed++;
    let item;
    try{ item=cleanJsonValue(value[k],depth+1,budget,seen); }catch(e){ item=undefined; }
    if(item!==undefined) out[k.slice(0,128)]=item;
  }
  seen.delete(value);
  return out;
}
function cleanRecord(src){
  if(!src || typeof src!=='object') return {};
  const out=cleanJsonValue(src,0,{left:NPC_RECORD_NODE_CAP},new WeakSet());
  return out && !Array.isArray(out) && typeof out==='object' ? out : {};
}
function cleanId(v){
  const id=String(v||'').slice(0,160).trim().replace(/[^a-zA-Z0-9_:-]+/g,'_').slice(0,80);
  return id==='__proto__' || id==='prototype' || id==='constructor' ? '' : id;
}

function createNpcRegistry(){
  const entries=new Map();
  const pendingRestores=new Map();
  function ordered(){ return Array.from(entries.values()); }
  // NPC-NPC collision: gently push overlapping residents apart so they don't stack or
  // walk through each other. Duelling NPCs are skipped (they intentionally close in).
  function separate(){
    const bodies=[];
    for(const n of entries.values()){
      if(!n || !n.body || !n.nudge) continue;
      const b=n.body();
      if(b && !b.duel){ b.n=n; bodies.push(b); }
    }
    for(let i=0;i<bodies.length;i++){
      for(let j=i+1;j<bodies.length;j++){
        const a=bodies[i], c=bodies[j];
        const dx=c.x-a.x, dy=c.y-a.y;
        const minX=(a.w+c.w)/2, minY=(a.h+c.h)/2;
        if(Math.abs(dx)<minX && Math.abs(dy)<minY){
          const overlap=(minX-Math.abs(dx));
          const push=Math.min(0.12, overlap*0.5);
          const dir=dx===0 ? ((i+j)&1?1:-1) : (dx>0?1:-1);
          a.n.nudge(-dir*push); c.n.nudge(dir*push);
        }
      }
    }
  }
  return {
    register(id,api){
      const key=cleanId(id);
      if(!key) throw new Error('NPC registry requires an id');
      entries.set(key,api);
      if(api && api.restore && pendingRestores.has(key)){
        try{ api.restore(pendingRestores.get(key)); }catch(e){}
        pendingRestores.delete(key);
      }
      return api;
    },
    unregister(id){
      const key=cleanId(id);
      const ok=entries.delete(key);
      try{
        const root=runtimeRoot();
        if(root.MM && root.MM.npcs) delete root.MM.npcs[key];
      }catch(e){}
      return ok;
    },
    get(id){ return entries.get(cleanId(id)) || null; },
    list(){ return ordered(); },
    setContext(ctx){ ordered().forEach(n=>{ if(n && n.setContext) n.setContext(ctx); }); },
    reset(){ pendingRestores.clear(); ordered().forEach(n=>{ if(n && n.reset) n.reset(); }); },
    update(dt,player,getTile,setTile,ctx){
      ordered().forEach(n=>{ if(n && n.update) n.update(dt,player,getTile,setTile,ctx); });
      separate();
    },
    draw(ctx,tile,canDrawTile){ ordered().forEach(n=>{ if(n && n.draw) n.draw(ctx,tile,canDrawTile); }); },
    handleKey(key,player,ctx){ return ordered().some(n=>!!(n && n.handleKey && n.handleKey(key,player,ctx))); },
    // Click-to-talk dispatch: the first NPC under the clicked tile speaks.
    interactAt(tx,ty,player,ctx){ return ordered().some(n=>!!(n && n.interactAt && n.interactAt(tx,ty,player,ctx))); },
    attackAt(tx,ty,bonus,ctx){ return ordered().some(n=>!!(n && n.attackAt && n.attackAt(tx,ty,bonus,ctx))); },
    damageAt(tx,ty,dmg,ctx){ return ordered().some(n=>!!(n && n.damageAt && n.damageAt(tx,ty,dmg,ctx))); },
    summaries(){
      return ordered()
        .filter(n=>n && typeof n.summary==='function')
        .map(n=>n.summary())
        .filter(Boolean);
    },
    nearby(player,radius){
      const r=Math.max(0.1,Number(radius)||12);
      const px=player && typeof player.x==='number' ? player.x : null;
      const py=player && typeof player.y==='number' ? player.y : null;
      return ordered()
        .filter(n=>n && typeof n.summary==='function')
        .map(n=>n.summary())
        .filter(s=>s && typeof s.x==='number' && typeof s.y==='number' && px!=null && py!=null && Math.hypot(s.x-px,s.y-py)<=r);
    },
    snapshot(){
      const npcs=Object.create(null);
      let count=0;
      // Live actors take priority over deferred legacy entries when a hostile or
      // very old save has filled the pending registry.
      ordered().forEach(n=>{
        if(count>=NPC_RESTORE_CAP || !n || !n.id || !n.snapshot) return;
        try{
          const id=cleanId(n.id());
          if(!id) return;
          const snap=cleanRecord(n.snapshot());
          npcs[id]=snap;
          count++;
        }catch(e){}
      });
      pendingRestores.forEach((snap,id)=>{
        if(count>=NPC_RESTORE_CAP || Object.prototype.hasOwnProperty.call(npcs,id)) return;
        npcs[id]=cleanRecord(snap);
        count++;
      });
      return {v:1,npcs};
    },
    restore(data){
      const npcs=data && data.npcs && typeof data.npcs==='object' ? data.npcs : data;
      if(!npcs || typeof npcs!=='object') return false;
      pendingRestores.clear();
      let any=false;
      // Restore every actor that is already registered before scanning legacy
      // IDs.  Otherwise thousands of junk keys placed first in a hostile save
      // can starve the real residents at the end of the object.
      for(const [key,n] of entries){
        if(!n || typeof n.restore!=='function' || !Object.prototype.hasOwnProperty.call(npcs,key)) continue;
        try{ any=!!n.restore(npcs[key]) || any; }catch(e){}
      }
      let scanned=0;
      for(const id in npcs){
        if(!Object.prototype.hasOwnProperty.call(npcs,id)) continue;
        if(scanned++>=NPC_RESTORE_SCAN_CAP || pendingRestores.size>=NPC_RESTORE_CAP) break;
        const key=cleanId(id);
        // Sanitised aliases must never overwrite or re-run a known actor.
        if(!key || entries.has(key) || pendingRestores.has(key)) continue;
        pendingRestores.set(key,cleanRecord(npcs[id]));
        any=true;
      }
      return any;
    }
  };
}

const npcRegistry=createNpcRegistry();
try{
  const root=runtimeRoot();
  const MM=root.MM=root.MM||{};
  MM.npcSystem=npcRegistry;
  MM.npcDialogueBubble=drawDialogueBubble; // shared renderer: story modules speak in the same voice
}catch(e){}

function validateQuestDefinition(def){
  const errors=[];
  const id=cleanId(def && def.id);
  if(!id) errors.push('missing id');
  const steps=Array.isArray(def && def.steps) ? def.steps : [];
  if(!steps.length) errors.push('missing steps');
  const ids=new Set();
  steps.forEach((step,i)=>{
    if(!step || typeof step!=='object'){ errors.push('step '+i+' is not an object'); return; }
    const sid=cleanId(step.id);
    if(!sid) errors.push('step '+i+' has no id');
    if(ids.has(sid)) errors.push('duplicate step '+sid);
    ids.add(sid);
    if(!['handoff','observe','duel','choice','done'].includes(step.kind)) errors.push('step '+sid+' has unsupported kind '+step.kind);
  });
  steps.forEach(step=>{
    if(!step || typeof step!=='object') return;
    const sid=cleanId(step.id);
    if(step.kind==='handoff'){
      if(!step.item) errors.push('handoff '+sid+' has no item');
      if(!(Number(step.amount)>0)) errors.push('handoff '+sid+' has invalid amount');
      if(!ids.has(cleanId(step.next))) errors.push('handoff '+sid+' points to missing next '+step.next);
    }
    if(step.kind==='observe'){
      if(!(Number(step.seconds)>0)) errors.push('observe '+sid+' has invalid seconds');
      if(!ids.has(cleanId(step.next))) errors.push('observe '+sid+' points to missing next '+step.next);
    }
    if(step.kind==='choice'){
      const choices=Array.isArray(step.choices) ? step.choices : (Array.isArray(def.choiceRewards) ? def.choiceRewards : []);
      if(!choices.length) errors.push('choice '+sid+' has no choices');
      const keys=new Set();
      choices.forEach(choice=>{
        const key=String(choice && choice.key || '').trim().toLowerCase();
        if(!key) errors.push('choice '+sid+' has a choice with no key');
        if(keys.has(key)) errors.push('choice '+sid+' repeats key '+key);
        keys.add(key);
      });
    }
    if(step.next && !ids.has(cleanId(step.next))) errors.push('step '+sid+' points to missing next '+step.next);
    if(step.reward && step.reward.next && !ids.has(cleanId(step.reward.next))) errors.push('step '+sid+' reward points to missing next '+step.reward.next);
  });
  const duelReward=def && def.duelReward;
  if(duelReward && duelReward.next && !ids.has(cleanId(duelReward.next))) errors.push('duel reward points to missing next '+duelReward.next);
  if(errors.length) throw new Error('Invalid NPC definition '+(id||'<unknown>')+': '+errors.join('; '));
  return true;
}

function drawDialogueBubble(ctx,x,y,text,choices,opts){
  if(!ctx || !text) return;
  const choiceItems=Array.isArray(choices) ? choices.slice(0,3) : [];
  const choiceShortLabel=(opts && opts.choiceShortLabel) || (item=>item ? (item.name||item.id||'') : '');
  const choiceFill=(opts && opts.choiceFill) || (()=>'rgba(255,255,255,0.82)');
  const words=String(text||'').split(/\s+/).filter(Boolean);
  const lines=[];
  let line='';
  ctx.save();
  ctx.font='12px system-ui';
  ctx.textBaseline='top';
  const maxW=210;
  for(const w of words){
    const next=line ? line+' '+w : w;
    const width=ctx.measureText ? ctx.measureText(next).width : next.length*7;
    if(line && width>maxW){ lines.push(line); line=w; }
    else line=next;
  }
  if(line) lines.push(line);
  const visibleLines=lines.slice(0,4);
  const w=Math.max(116,Math.min(236,visibleLines.reduce((m,l)=>Math.max(m,ctx.measureText?ctx.measureText(l).width:80),0)+28));
  const choiceH=choiceItems.length ? 23 : 0;
  const h=visibleLines.length*15+16+choiceH;
  const bx=x-w*0.45;
  const by=y-h-28;
  const roundedPath=(rx,ry,rw,rh,rr)=>{
    ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(rx,ry,rw,rh,rr);
    else {
      const r=rr;
      ctx.moveTo(rx+r,ry);
      ctx.lineTo(rx+rw-r,ry);
      ctx.quadraticCurveTo(rx+rw,ry,rx+rw,ry+r);
      ctx.lineTo(rx+rw,ry+rh-r);
      ctx.quadraticCurveTo(rx+rw,ry+rh,rx+rw-r,ry+rh);
      ctx.lineTo(rx+r,ry+rh);
      ctx.quadraticCurveTo(rx,ry+rh,rx,ry+rh-r);
      ctx.lineTo(rx,ry+r);
      ctx.quadraticCurveTo(rx,ry,rx+r,ry);
    }
  };
  const cloudPuffs=[
    [0.10,0.24,12],[0.25,0.03,11],[0.45,-0.08,14],[0.68,0.02,12],
    [0.88,0.20,13],[0.96,0.55,11],[0.78,0.90,10],[0.18,0.88,11],[0.02,0.56,10]
  ];
  ctx.shadowColor='rgba(0,0,0,0.18)';
  ctx.shadowBlur=4;
  ctx.shadowOffsetY=1;
  ctx.fillStyle='rgba(245,248,255,0.94)';
  cloudPuffs.forEach(c=>{
    ctx.beginPath();
    ctx.arc(bx+w*c[0],by+h*c[1],c[2],0,Math.PI*2);
    ctx.fill();
  });
  roundedPath(bx,by,w,h,13);
  ctx.fill();
  ctx.shadowBlur=0;
  ctx.shadowOffsetY=0;
  ctx.strokeStyle='rgba(55,63,78,0.58)';
  ctx.lineWidth=1.1;
  cloudPuffs.forEach(c=>{
    ctx.beginPath();
    ctx.arc(bx+w*c[0],by+h*c[1],c[2],0,Math.PI*2);
    ctx.stroke();
  });
  roundedPath(bx,by,w,h,13);
  ctx.stroke();
  ctx.fillStyle='rgba(245,248,255,0.92)';
  ctx.beginPath(); ctx.arc(x-7,y-30,5,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(x-2,y-20,3,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.fillStyle='#17202c';
  visibleLines.forEach((l,i)=>ctx.fillText(l,bx+14,by+9+i*15));
  if(choiceItems.length){
    const gap=5;
    const chipW=(w-28-gap*2)/3;
    const chipY=by+10+visibleLines.length*15;
    choiceItems.forEach((item,i)=>{
      const chipX=bx+14+i*(chipW+gap);
      ctx.fillStyle=choiceFill(item);
      roundedPath(chipX,chipY,chipW,17,7);
      ctx.fill();
      ctx.strokeStyle='rgba(55,63,78,0.42)';
      ctx.stroke();
      ctx.fillStyle='#17202c';
      ctx.fillText(String(item.key||'')+' '+choiceShortLabel(item),chipX+6,chipY+3);
    });
  }
  ctx.restore();
}

// --- Shared NPC appearance -------------------------------------------------
// NPCs are the hero's species: the same blocky, eyed "square" body plan, drawn with
// the same primitives, but every resident gets a procedurally distinct face, hat,
// hair and trim so the world feels populated by individuals rather than clones.
function clampByte(v){ v=v|0; return v<0?0:(v>255?255:v); }
function parseHex(hex){
  let h=String(hex||'#888').replace('#','');
  if(h.length===3) h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  const n=parseInt(h,16)||0;
  return {r:(n>>16)&255,g:(n>>8)&255,b:n&255};
}
function shade(hex,f){ const c=parseHex(hex); return 'rgb('+clampByte(c.r*f)+','+clampByte(c.g*f)+','+clampByte(c.b*f)+')'; }
function hashStr(s){
  let h=2166136261>>>0;
  s=String(s||'');
  for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); }
  return h>>>0;
}
const NPC_SKIN=['#f1c9a5','#e8b88a','#d99a6c','#c98a5a','#a9714a','#86552f'];
const NPC_HAIR=['#2b2118','#4a3320','#6b4a26','#8a8f98','#c8c2b6','#7a3b1e','#3a3340'];
// Build a stable look for an NPC from a numeric seed + optional job colours.
function npcLook(seed,baseColor,accentColor){
  const r=n=>((seed=Math.imul(seed^0x9e3779b9,2654435761))>>>0)/4294967296*n;
  const body=baseColor || ['#6b5a48','#5d6a7c','#6f6745','#7a5636','#52677a'][Math.floor(r(5))];
  const accent=accentColor || ['#d0b27c','#c2df8a','#f0c77a','#b9d98a','#e6cf72'][Math.floor(r(5))];
  return {
    body,
    accent,
    skin:NPC_SKIN[Math.floor(r(NPC_SKIN.length))],
    hair:NPC_HAIR[Math.floor(r(NPC_HAIR.length))],
    hat:Math.floor(r(5)),            // 0 none,1 brim,2 hood,3 beanie,4 cap
    hairStyle:Math.floor(r(4)),      // 0 short,1 tuft,2 long,3 bald
    beard:r(1)<0.45,
    eyeStyle:Math.floor(r(3)),       // 0 normal,1 wide,2 gold
    accessory:Math.floor(r(3))       // 0 none,1 scarf,2 satchel
  };
}
// The shared hero-like body. Reads animation from `m` (facing, walkT, onGround, vy)
// and look from `look`. Drawn centred on the NPC's world position (state.x,state.y).
function drawActorBody(ctx,TILE,state,opts){
  opts=opts||{};
  const m=state.move||{};
  const look=opts.look||npcLook(opts.seed||1);
  const now=opts.now?opts.now():(typeof performance!=='undefined'?performance.now():Date.now());
  const face=(m.facing||1)>=0?1:-1;
  const w=0.7*TILE, h=0.95*TILE;
  const cxp=state.x*TILE, cyp=state.y*TILE;
  const moving=Math.abs(m.vx||0)>0.4 && m.onGround;
  const air=!m.onGround;
  const walkT=m.walkT||0;
  const stride=moving?Math.sin(walkT*9):0;
  const bob=moving?Math.abs(Math.sin(walkT*9))*1.1:Math.sin((state.tick||0)*2.0)*0.5;
  const tick=state.tick||0;
  const blink=((tick*1000+(opts.seed||0))%3400)<120;
  ctx.save();
  // contact shadow
  ctx.fillStyle='rgba(0,0,0,0.26)';
  ctx.beginPath(); ctx.ellipse(cxp,cyp+h*0.50,w*0.46*(air?0.7:1),3.0,0,0,Math.PI*2); ctx.fill();
  let shake=0;
  if(state.hurtT>0) shake=Math.sin(now*0.09)*1.5;
  ctx.translate(cxp+shake,cyp+bob);
  if(face<0 && ctx.scale) ctx.scale(-1,1);   // mirror so details face travel direction

  const left=-w/2, top=-h/2;
  const lineCol='rgba(28,22,18,0.9)';
  // Legs (swing while walking)
  const legY=h*0.30, legH=h*0.18;
  ctx.fillStyle=shade(look.body,0.55);
  if(air){
    ctx.fillRect(-w*0.26,legY,w*0.2,legH*0.8);
    ctx.fillRect(w*0.06,legY+legH*0.2,w*0.2,legH*0.8);
  } else {
    ctx.fillRect(-w*0.26+stride*2,legY,w*0.2,legH);
    ctx.fillRect(w*0.06-stride*2,legY,w*0.2,legH);
  }
  // Body block (the hero silhouette) with a subtle light/shade split
  let grad=null;
  if(ctx.createLinearGradient){
    grad=ctx.createLinearGradient(left,0,left+w,0);
    grad.addColorStop(0,shade(look.body,1.14));
    grad.addColorStop(0.55,look.body);
    grad.addColorStop(1,shade(look.body,0.78));
  }
  ctx.fillStyle=grad||look.body;
  ctx.fillRect(left,top+h*0.16,w,h*0.62);
  ctx.strokeStyle=lineCol; ctx.lineWidth=1; ctx.strokeRect(left,top+h*0.16,w,h*0.62);
  // Belt / trim
  ctx.fillStyle=look.accent;
  ctx.fillRect(left,top+h*0.52,w,h*0.07);
  // Accessory
  if(look.accessory===1){ ctx.fillStyle=shade(look.accent,1.05); ctx.fillRect(left,top+h*0.17,w,h*0.05); }
  else if(look.accessory===2){ ctx.fillStyle=shade(look.accent,0.8); ctx.fillRect(left+w*0.74,top+h*0.30,w*0.2,h*0.26); ctx.strokeRect(left+w*0.74,top+h*0.30,w*0.2,h*0.26); }
  // Arm (swings opposite to legs)
  ctx.fillStyle=shade(look.body,0.9);
  const armSwing=moving?stride*3:0;
  ctx.fillRect(left+w*0.80,top+h*0.20+armSwing,w*0.16,h*0.30);

  // Face patch
  const faceY=top+h*0.16, faceH=h*0.24;
  ctx.fillStyle=look.skin;
  ctx.fillRect(left+w*0.10,faceY,w*0.80,faceH);
  ctx.fillStyle=shade(look.skin,0.84);
  ctx.fillRect(left+w*0.66,faceY,w*0.24,faceH);
  // Eyes (hero-style sclera + pupil that looks toward travel/facing), with blink
  const eyeY=faceY+faceH*0.42, eyeOff=w*0.18, eyeW=w*0.13, eyeHo=faceH*0.42;
  function eye(ex){
    if(blink){ ctx.fillStyle='#1a232e'; ctx.fillRect(ex-eyeW/2,eyeY,eyeW,1.4); return; }
    if(look.eyeStyle===2){ ctx.fillStyle='#ffce3a'; ctx.fillRect(ex-eyeW/2,eyeY-eyeHo/2,eyeW,eyeHo); ctx.fillStyle='#5a3b00'; ctx.fillRect(ex-1+1.2,eyeY-eyeHo/2+1,2,eyeHo-2); return; }
    const ww=look.eyeStyle===1?eyeW*1.2:eyeW;
    ctx.fillStyle='#fff'; ctx.fillRect(ex-ww/2,eyeY-eyeHo/2,ww,eyeHo);
    ctx.fillStyle='#15212e'; ctx.fillRect(ex-1+1.4,eyeY-eyeHo/2+1,2,eyeHo-2);
  }
  eye(eyeOff);
  eye(-eyeOff);
  // Beard / mouth
  if(look.beard){ ctx.fillStyle=shade(look.hair,0.9); ctx.fillRect(left+w*0.22,faceY+faceH*0.74,w*0.5,faceH*0.3); }
  else { ctx.fillStyle=shade(look.skin,0.55); ctx.fillRect(left+w*0.34,faceY+faceH*0.78,w*0.22,1.4); }
  // Hair
  if(look.hairStyle!==3){
    ctx.fillStyle=look.hair;
    ctx.fillRect(left+w*0.08,faceY-faceH*0.10,w*0.84,faceH*0.22);
    if(look.hairStyle===2){ ctx.fillRect(left+w*0.06,faceY,w*0.10,faceH*0.7); ctx.fillRect(left+w*0.84,faceY,w*0.10,faceH*0.7); }
    if(look.hairStyle===1){ ctx.fillRect(left+w*0.42,faceY-faceH*0.28,w*0.12,faceH*0.22); }
  }
  // Hat
  const hatCol=shade(look.body,0.7);
  ctx.fillStyle=hatCol; ctx.strokeStyle='rgba(18,14,10,0.9)';
  if(look.hat===1){ ctx.fillRect(left-w*0.06,faceY-2,w+w*0.12,3); ctx.fillRect(left+w*0.2,faceY-faceH*0.34,w*0.6,faceH*0.36); ctx.fillStyle=look.accent; ctx.fillRect(left+w*0.2,faceY-2,w*0.6,2); }
  else if(look.hat===2){ ctx.beginPath(); ctx.moveTo(left,faceY+faceH*0.3); ctx.lineTo(0,faceY-faceH*0.4); ctx.lineTo(left+w,faceY+faceH*0.3); if(ctx.closePath) ctx.closePath(); ctx.fill(); }
  else if(look.hat===3){ ctx.fillRect(left+w*0.12,faceY-faceH*0.22,w*0.76,faceH*0.3); ctx.fillStyle=look.accent; ctx.beginPath(); ctx.arc(0,faceY-faceH*0.22,2.2,0,Math.PI*2); ctx.fill(); }
  else if(look.hat===4){ ctx.fillRect(left+w*0.14,faceY-faceH*0.4,w*0.62,faceH*0.5); ctx.fillStyle=look.accent; ctx.fillRect(left+w*0.14,faceY-2,w*0.62,3); }

  // Hit flash
  if(state.hurtT>0){ ctx.fillStyle='rgba(255,90,70,'+(0.4*Math.min(1,state.hurtT/0.25)).toFixed(3)+')'; ctx.fillRect(left-2,top,w+4,h*0.8); }
  // Duel health bar
  if(state.phase==='duel' && opts.maxHp){
    ctx.fillStyle='rgba(0,0,0,0.45)'; ctx.fillRect(-18,top-10,36,4);
    ctx.fillStyle='#e25a43'; ctx.fillRect(-18,top-10,36*Math.max(0,Math.min(1,state.hp/opts.maxHp)),4);
  }
  ctx.restore();
}

function createQuestNpc(def){
  validateQuestDefinition(def);
  const root=def.root || runtimeRoot();
  const MM=root.MM=root.MM||{};
  const id=cleanId(def.id);
  const displayName=String(def.displayName || id);
  const maxHp=Math.max(1,Math.round(Number(def.maxHp)||20));
  const interactR=Math.max(0.5,Number(def.interactR)||2.4);
  const bubbleR=Math.max(interactR,Number(def.bubbleR)||12);
  const steps=def.steps.map(step=>Object.assign({},step,{id:cleanId(step.id), next:step.next?cleanId(step.next):step.next}));
  const stepMap=steps.reduce((acc,step)=>{ acc[step.id]=step; return acc; },{});
  const initialPhase=cleanId(def.initialPhase || steps[0].id);
  const choiceRewards=(Array.isArray(def.choiceRewards)?def.choiceRewards:[]).map(clonePlain);
  const rewardOnceKeys=new Set();
  function rewardKey(value){ return cleanId(value); }
  function registerRewardKey(value){ const key=rewardKey(value); if(key) rewardOnceKeys.add(key); }
  steps.forEach(step=>{ if(step && step.reward) registerRewardKey(step.reward.once); });
  choiceRewards.forEach(reward=>registerRewardKey(reward && reward.once));
  if(def.duelReward && typeof def.duelReward==='object') registerRewardKey(def.duelReward.once);
  if(steps.some(step=>step && step.kind==='choice')) registerRewardKey('choice');
  if(Array.isArray(def.rewardOnceKeys)) def.rewardOnceKeys.slice(0,32).forEach(registerRewardKey);
  function validNpcX(value){ return finite(value) && Math.abs(value)<=NPC_MAX_ABS_X; }
  function validNpcY(value){ return finite(value) && value>=WORLD_MIN_Y-NPC_Y_MARGIN && value<=WORLD_MAX_Y+NPC_Y_MARGIN; }
  function cleanNpcData(src,fallback){
    const base=cleanRecord(fallback);
    const out=Object.assign({},base,cleanRecord(src));
    const fallbackHome=base.home && typeof base.home==='object' && !Array.isArray(base.home) ? cleanRecord(base.home) : null;
    if(out.home!==undefined || fallbackHome){
      let home=out.home && typeof out.home==='object' && !Array.isArray(out.home) ? cleanRecord(out.home) : {};
      if(!validNpcX(home.x)){
        if(fallbackHome && validNpcX(fallbackHome.x)) home.x=fallbackHome.x;
        else delete home.x;
      }
      out.home=home;
    }
    if(Object.prototype.hasOwnProperty.call(out,'hidden')) out.hidden=out.hidden===true;
    if(Object.prototype.hasOwnProperty.call(out,'generated')) out.generated=out.generated===true;
    for(const key of ['cycle','completedJobs']){
      if(Object.prototype.hasOwnProperty.call(out,key)){
        const value=Number(out[key]);
        out[key]=Number.isFinite(value) ? Math.floor(clamp(value,0,1000000)) : 0;
      }
    }
    return out;
  }
  function cleanRewards(src){
    const out={};
    if(!src || typeof src!=='object') return out;
    for(const key of rewardOnceKeys){
      try{ if(src[key]) out[key]=true; }catch(e){}
    }
    return out;
  }
  const initialData=cleanNpcData(def.initialData,null);
  const combat=Object.assign({
    chaseRadius:9,
    chaseY:4,
    speed:2.0,
    stopDistance:0.85,
    attackRangeX:1.05,
    attackRangeY:1.2,
    attackCooldown:1.1,
    contactDamage:5,
    hitLine:'Oj. Dobra technika. Zla empatia.',
    chaseLine:'No dalej. Pokonaj mnie, zanim zapomne po co walczymy.',
    contactLine:'Bonk. To byla lekcja o dystansie osobistym.'
  }, def.combat || {});
  const hitbox=Object.assign({x:0.95,y:1.15}, def.hitbox || {});
  const state={
    v:1,
    x:null,
    y:null,
    phase:initialPhase,
    hp:maxHp,
    line:'',
    lineT:0,
    lineLong:false,
    attackCd:0,
    hurtT:0,
    defeatedT:0,
    ambientT:0,
    tick:0,
    talkT:0,
    talkIdx:0,
    rewards:{},
    data:cleanNpcData(initialData,null),
    observe:{phase:'',t:0,best:0,ok:false,lineCd:0},
    // Transient movement + behaviour (never snapshotted; the home anchor reseeds it).
    move:{vx:0,vy:0,facing:1,onGround:false,walkT:0},
    ai:{mode:'idle',t:0.6,targetX:null,job:null,jobT:0,jumpCd:0}
  };
  const lookSeed=hashStr(def.id||'npc');
  let look=null;
  function npcBodyW(){ return 0.7; }
  function npcBodyH(){ return 0.95; }
  function homeAnchorX(){
    const home=state.data && state.data.home;
    if(home && validNpcX(home.x)) return home.x;
    return validNpcX(state.x)?state.x:0;
  }
  let defaultCtx={};

  function cleanPhase(v){ const p=cleanId(v); return stepMap[p] ? p : initialPhase; }
  function contextFor(ctx){
    if(ctx && typeof ctx==='object'){
      if(typeof ctx.onChange==='function' || typeof ctx.onInventoryChange==='function' || typeof ctx.damageHero==='function' || ctx.worldGen) return ctx;
    }
    return defaultCtx;
  }
  function setContext(ctx){
    defaultCtx=(ctx && typeof ctx==='object') ? ctx : {};
    return true;
  }
  function markChanged(ctx){
    ctx=contextFor(ctx);
    try{ if(ctx && typeof ctx.onChange==='function') ctx.onChange(); }catch(e){}
  }
  function refreshInventory(ctx){
    ctx=contextFor(ctx);
    try{ if(ctx && typeof ctx.onInventoryChange==='function'){ ctx.onInventoryChange(); return; } }catch(e){}
    try{ if(root.updateInventoryHud) root.updateInventoryHud(); }catch(e){}
  }
  function message(text){ try{ if(text && root.msg) root.msg(text); }catch(e){} }
  function safeGet(getTile,x,y){ try{ return getTile ? getTile(Math.floor(x),Math.floor(y)) : T.AIR; }catch(e){ return T.AIR; } }
  function bodyOpen(t){ return t!==T.WATER && t!==T.LAVA && (isNpcPassableTile(t) || t===T.TORCH || t===T.GRAVE); }
  function landingAt(tx,getTile,worldGen){
    tx=Math.round(tx);
    let surface=60;
    try{ if(worldGen && worldGen.surfaceHeight) surface=Math.round(worldGen.surfaceHeight(tx)); }catch(e){}
    const top=Math.max(2,surface-8), bottom=Math.min(WORLD_H-2,surface+16);
    for(let y=top; y<=bottom; y++){
      const floor=safeGet(getTile,tx,y);
      if(!isSafeLandingFloorTile(floor)) continue;
      if(!bodyOpen(safeGet(getTile,tx,y-1)) || !bodyOpen(safeGet(getTile,tx,y-2))) continue;
      return {x:tx+0.5,y:y-1};
    }
    return null;
  }
  function defaultSpawnX(worldGen){
    if(def.spawn && finite(def.spawn.x)) return Math.round(def.spawn.x);
    if(def.spawn && typeof def.spawn.findX==='function'){
      const found=def.spawn.findX(worldGen);
      if(finite(found)) return Math.round(found);
    }
    if(!worldGen) return 0;
    const sea=(worldGen.settings && worldGen.settings.seaLevel!==undefined) ? worldGen.settings.seaLevel : 62;
    for(let r=0; r<=4000; r+=4){
      const cols=r===0 ? [0] : [r,-r];
      for(const c of cols){
        try{
          const b=worldGen.biomeType ? worldGen.biomeType(c) : 1;
          const s=worldGen.surfaceHeight ? worldGen.surfaceHeight(c) : 50;
          if(b!==5 && b!==6 && s<sea-1) return c;
        }catch(e){}
      }
    }
    return 0;
  }
  function placeAround(anchorX,getTile,worldGen){
    const offsets=Array.isArray(def.spawnOffsets) ? def.spawnOffsets : [6,-6,9,-9,13,-13,18,-18,24,-24,32,-32];
    for(const off of offsets){
      const spot=landingAt(anchorX+off,getTile,worldGen);
      if(spot){
        state.x=spot.x;
        state.y=spot.y;
        state.hp=maxHp;
        return true;
      }
    }
    const fallback=landingAt(anchorX,getTile,worldGen);
    if(fallback){
      state.x=fallback.x;
      state.y=fallback.y;
      state.hp=maxHp;
      return true;
    }
    return false;
  }
  function placeNearPlayer(player,getTile,worldGen){
    if(!player || !finite(player.x)) return false;
    return placeAround(Math.round(player.x),getTile,worldGen);
  }
  function placeNearWorldStart(getTile,worldGen){
    return placeAround(defaultSpawnX(worldGen || MM.worldGen),getTile,worldGen || MM.worldGen);
  }
  function hasPosition(){ return validNpcX(state.x) && validNpcY(state.y); }
  function ensurePlaced(player,getTile,worldGen){
    if(hasPosition()) return true;
    return placeNearWorldStart(getTile,worldGen) || placeNearPlayer(player,getTile,worldGen);
  }
  function distToPlayer(player){
    if(!player || !hasPosition()) return Infinity;
    return Math.hypot((player.x||0)-state.x,(player.y||0)-state.y);
  }
  function setLine(text,t,replace){
    state.line=textOf(text).slice(0,220);
    state.lineLong=isLongCharacterSpeech(state.line);
    const ttl=readableCharacterSpeechDuration(Math.max(0.2,Number(t)||3.5),state.line);
    state.lineT=replace ? ttl : Math.max(state.lineT,ttl);
    return ttl;
  }
  function textOf(value){
    if(Array.isArray(value)){
      const list=value.map(v=>String(v||'').trim()).filter(Boolean);
      if(!list.length) return '';
      const drift=Math.floor((state.tick||0)/8)+Math.abs(Math.floor((state.x||0)*3))+state.phase.length;
      return list[drift%list.length];
    }
    if(typeof value==='function') return String(value(state)||'');
    return String(value||'');
  }
  function currentStep(){ return stepMap[state.phase] || null; }
  function stepForPhase(){ const step=currentStep(); return step && step.kind==='handoff' ? step : null; }
  function observeSeconds(step){
    const value=Number(step && step.seconds);
    return clamp(Number.isFinite(value) ? value : 1,0.1,NPC_TRANSIENT_TIME_CAP);
  }
  function observeProgress(step){
    const obs=state.observe && step && state.observe.phase===step.id ? state.observe : null;
    return obs ? clamp(Number(obs.t)||0,0,observeSeconds(step)) : 0;
  }
  function ensureObserveState(step){
    if(!state.observe || state.observe.phase!==step.id){
      state.observe={phase:step.id,t:0,best:0,ok:false,lineCd:0};
    }
    return state.observe;
  }
  function cleanObserve(src){
    if(!src || typeof src!=='object') return {phase:'',t:0,best:0,ok:false,lineCd:0};
    const phase=cleanId(src.phase);
    const step=stepMap[phase];
    const limit=step && step.kind==='observe' ? observeSeconds(step) : 0;
    const cleanTime=value=>{
      const number=Number(value);
      return Number.isFinite(number) ? clamp(number,0,limit) : 0;
    };
    const lineCd=Number(src.lineCd);
    return {
      phase:step ? phase : '',
      t:cleanTime(src.t),
      best:cleanTime(src.best),
      ok:src.ok===true,
      lineCd:Number.isFinite(lineCd) ? clamp(lineCd,0,60) : 0
    };
  }
  function observeReady(step,player,getTile,setTile,ctx){
    try{
      if(typeof step.check==='function') return !!step.check({step,player,getTile,setTile,ctx,state,helpers:{T,finite,clamp,distToPlayer,safeGet,npcBodyH,npcBodyW}});
      if(typeof def.observeCheck==='function') return !!def.observeCheck(step,player,getTile,setTile,ctx,state,{T,finite,clamp,distToPlayer,safeGet,npcBodyH,npcBodyW});
    }catch(e){ return false; }
    return distToPlayer(player)<=bubbleR;
  }
  function appendTalkLines(lines,value){
    if(Array.isArray(value)){
      value.map(v=>String(v||'').trim()).filter(Boolean).forEach(v=>lines.push(v));
    } else {
      const text=textOf(value).trim();
      if(text) lines.push(text);
    }
  }
  function atomicWinterTalkLine(){
    try{
      const aw=MM.atomicWinter;
      const list=(aw && typeof aw.contextLines==='function') ? aw.contextLines('npc') : [];
      if(!Array.isArray(list) || !list.length) return '';
      const seed=id+':'+state.phase+':'+(state.talkIdx|0)+':atomic';
      const text=String(list[hashStr(seed) % list.length] || '').trim();
      return text;
    }catch(e){ return ''; }
  }
  function jobStatus(){
    const step=currentStep();
    if(!step) return 'unknown';
    if(step.kind==='done') return 'completed';
    if(step.kind==='observe') return 'observe';
    if(step.kind==='duel') return 'duel';
    if(step.kind==='choice') return 'choice';
    return 'available';
  }
  function jobSummary(){
    const step=currentStep();
    if(!step) return null;
    const summary={
      id,
      name:displayName,
      x:validNpcX(state.x)?state.x:null,
      y:validNpcY(state.y)?state.y:null,
      phase:state.phase,
      status:jobStatus(),
      prompt:textOf(step.prompt || phaseText()),
      line:state.lineT>0 ? state.line : '',
      generated:!!(state.data && state.data.generated),
      role:state.data && state.data.role || displayName,
      lore:state.data && state.data.lore || '',
      moral:state.data && state.data.moral || '',
      home:cleanRecord(state.data && state.data.home),
      cycle:state.data && Number.isFinite(Number(state.data.cycle)) ? Number(state.data.cycle) : 0,
      completedJobs:state.data && Number.isFinite(Number(state.data.completedJobs)) ? Number(state.data.completedJobs) : 0,
      biome:state.data && state.data.biome!=null ? state.data.biome : null,
      biomeName:state.data && state.data.biomeName || null,
      rewards:cleanRecord(state.data && state.data.reward),
      required:null
    };
    if(step.kind==='handoff'){
      summary.required={item:step.item, amount:Math.max(1,step.amount|0), have:resourceCount(step.item)};
      if(summary.required.have>=summary.required.amount) summary.status='ready';
    } else if(step.kind==='observe'){
      const seconds=observeSeconds(step);
      const progress=observeProgress(step);
      const obs=state.observe && state.observe.phase===step.id ? state.observe : null;
      summary.required={item:'observe', amount:Math.ceil(seconds), have:Math.floor(progress)};
      summary.observe={
        mode:step.mode || null,
        label:step.label || step.id,
        seconds,
        progress,
        active:!!(obs && obs.ok),
        best:obs ? Math.max(progress,Number(obs.best)||0) : progress
      };
    }
    return summary;
  }
  function choicesForStep(step){
    if(!step || step.kind!=='choice') return [];
    return (Array.isArray(step.choices) ? step.choices : choiceRewards).map(clonePlain);
  }
  function rewardForChoice(choice){
    const key=String(choice||'').trim().toLowerCase();
    return choiceRewards.find(r=>String(r.key||'').toLowerCase()===key || String(r.id||'').toLowerCase()===key || String(r.weaponType||'').toLowerCase()===key) || null;
  }
  function spendResource(key,amount){
    const inv=root.inv;
    const need=Math.max(1,amount|0);
    if(!inv || typeof inv[key]!=='number' || (inv[key]|0)<need) return false;
    inv[key]=Math.max(0,(inv[key]|0)-need);
    return true;
  }
  function resourceCount(key){
    const inv=root.inv;
    return inv && typeof inv[key]==='number' ? Math.max(0,inv[key]|0) : 0;
  }
  function addResources(resources){
    const inv=root.inv || (root.inv={});
    Object.keys(resources||{}).forEach(k=>{
      const add=Math.max(0,Number(resources[k])||0);
      inv[k]=Math.max(0,inv[k]|0)+add;
    });
  }
  function beginDuel(){
    state.phase='duel';
    state.hp=maxHp;
    state.attackCd=Math.max(0.1,Number(combat.initialCooldown)||1.0);
    state.hurtT=0;
  }
  function grantGear(item,reward){
    if(!item) return true;
    const gear=clonePlain(item);
    const opts=Object.assign({equip:true,markNew:true,essential:true}, reward && reward.itemOptions || {});
    let granted=false;
    try{
      if(MM.inventory && MM.inventory.grantItem){
        granted=!!MM.inventory.grantItem(gear,opts);
      }
    }catch(e){ granted=false; }
    if(!granted && MM.inventory && MM.inventory.getItem && MM.inventory.getItem(gear.id)){
      granted=true;
      try{ if(MM.inventory.equip) MM.inventory.equip(gear.id); }catch(e){}
    }
    if(granted && opts.equip){
      try{ if(MM.inventory && MM.inventory.equip) MM.inventory.equip(gear.id); }catch(e){}
    }
    return granted;
  }
  function rewardText(v,item){
    if(typeof v==='function') return v(item,state);
    return v;
  }
  function spawnRewardChest(chest,ctx){
    if(!chest) return true;
    const spec=typeof chest==='string' ? {tier:chest} : chest;
    if(!spec || typeof spec!=='object') return false;
    const drops=MM.drops;
    if(!drops || typeof drops.spawnChest!=='function') return false;
    const actor=ctx && ctx.player;
    const x=actor && finite(Number(actor.x)) ? Number(actor.x) : state.x;
    const y=actor && finite(Number(actor.y)) ? Number(actor.y) : state.y;
    if(!finite(x) || !finite(y)) return false;
    const facing=actor && Number(actor.facing)<0 ? -1 : 1;
    const tier=String(spec.tier||'common');
    const rawOffsetX=Number(spec.offsetX), rawOffsetY=Number(spec.offsetY);
    try{
      return !!drops.spawnChest(
        x+facing*clamp(finite(rawOffsetX)?rawOffsetX:0.55,-3,3),
        y+clamp(finite(rawOffsetY)?rawOffsetY:-0.55,-3,3),
        tier,
        {
          source:String(spec.source||('quest_'+id)).slice(0,64),
          vx:finite(Number(spec.vx)) ? Number(spec.vx) : facing*1.25,
          vy:finite(Number(spec.vy)) ? Number(spec.vy) : -2.6
        }
      );
    }catch(e){ return false; }
  }
  function applyReward(reward,ctx,item){
    ctx=contextFor(ctx);
    if(!reward) return true;
    const once=rewardKey(reward.once);
    if(once) rewardOnceKeys.add(once);
    if(once && state.rewards[once]) return true;
    const gearList=[];
    if(reward.gear) gearList.push(reward.gear);
    if(Array.isArray(reward.items)) reward.items.forEach(it=>gearList.push(it));
    let inventorySnapshot=null;
    try{
      if(gearList.length && MM.inventory && typeof MM.inventory.snapshot==='function' && typeof MM.inventory.restore==='function'){
        inventorySnapshot=MM.inventory.snapshot();
      }
    }catch(e){ inventorySnapshot=null; }
    for(const gear of gearList){
      if(!grantGear(gear,reward)){
        try{ if(inventorySnapshot && MM.inventory && MM.inventory.restore) MM.inventory.restore(inventorySnapshot); }catch(e){}
        setLine(rewardText(reward.failureLine,item) || 'Nie mam gdzie wcisnac nagrody. Zrob miejsce.',4,true);
        return false;
      }
    }
    if(reward.chest && !spawnRewardChest(reward.chest,ctx)){
      try{ if(inventorySnapshot && MM.inventory && MM.inventory.restore) MM.inventory.restore(inventorySnapshot); }catch(e){}
      setLine(rewardText(reward.failureLine,item) || 'Nagroda nie ma jeszcze bezpiecznego miejsca. Sprobuj ponownie za chwile.',4,true);
      return false;
    }
    addResources(reward.resources || {});
    if(once) state.rewards[once]=true;
    if(reward.data){
      const data=typeof reward.data==='function' ? reward.data(item,state) : reward.data;
      state.data=cleanNpcData(data,state.data);
    }
    if(reward.next) state.phase=cleanPhase(reward.next);
    if(reward.hp!==undefined) state.hp=clamp(Number(reward.hp)||0,0,maxHp);
    if(reward.defeatedT!==undefined){
      const value=Number(reward.defeatedT);
      state.defeatedT=Number.isFinite(value) ? clamp(value,0,NPC_TRANSIENT_TIME_CAP) : 0;
    }
    refreshInventory(ctx);
    markChanged(ctx);
    message(rewardText(reward.message,item));
    const line=rewardText(reward.line,item);
    if(line) setLine(line,Number(reward.lineT)||5,true);
    return true;
  }
  function duelReward(){
    return typeof def.duelReward==='function' ? def.duelReward(state) : def.duelReward;
  }
  function choiceReward(item){
    if(typeof def.choiceReward==='function') return def.choiceReward(item,state);
    return {
      once:'choice',
      gear:item,
      next:'done',
      data:{choice:item && item.id},
      failureLine:'Nie mam gdzie wcisnac nagrody. Zrob miejsce.',
      message:item ? displayName+' dal ci: '+(item.name||item.id)+'.' : '',
      line:item ? 'Masz '+(item.name||item.id)+'.' : ''
    };
  }
  function advanceStep(step,ctx){
    const inv=root.inv;
    const resourceBefore=inv && typeof inv[step.item]==='number' ? inv[step.item] : null;
    const before={phase:state.phase,hp:state.hp,attackCd:state.attackCd,hurtT:state.hurtT};
    if(!spendResource(step.item,step.amount)) return false;
    refreshInventory(ctx);
    const next=cleanPhase(step.next);
    const nextStep=stepMap[next];
    if(nextStep && nextStep.kind==='duel') beginDuel();
    else state.phase=next;
    if(step.complete) setLine(step.complete,4.5,true);
    if(step.reward && !applyReward(step.reward,ctx)){
      if(inv && resourceBefore!==null) inv[step.item]=resourceBefore;
      state.phase=before.phase;
      state.hp=before.hp;
      state.attackCd=before.attackCd;
      state.hurtT=before.hurtT;
      refreshInventory(ctx);
      markChanged(ctx);
      return false;
    }
    markChanged(ctx);
    return true;
  }
  function advanceObserveStep(step,ctx){
    const before={phase:state.phase,hp:state.hp,attackCd:state.attackCd,hurtT:state.hurtT,observe:Object.assign({},state.observe)};
    const next=cleanPhase(step.next);
    const nextStep=stepMap[next];
    state.observe={phase:'',t:0,best:0,ok:false,lineCd:0};
    if(nextStep && nextStep.kind==='duel') beginDuel();
    else state.phase=next;
    if(step.complete) setLine(step.complete,5.2,true);
    if(step.reward && !applyReward(step.reward,ctx)){
      state.phase=before.phase;
      state.hp=before.hp;
      state.attackCd=before.attackCd;
      state.hurtT=before.hurtT;
      state.observe=before.observe;
      markChanged(ctx);
      return false;
    }
    markChanged(ctx);
    return true;
  }
  function updateObserveStep(step,dt,player,getTile,setTile,ctx){
    const obs=ensureObserveState(step);
    obs.lineCd=Math.max(0,(Number(obs.lineCd)||0)-dt);
    const active=observeReady(step,player,getTile,setTile,ctx);
    obs.ok=!!active;
    const seconds=observeSeconds(step);
    if(active){
      obs.t=clamp((Number(obs.t)||0)+dt,0,seconds);
      obs.best=Math.max(Number(obs.best)||0,obs.t);
      if(obs.t>=seconds) advanceObserveStep(step,ctx);
    } else if(obs.t>0){
      obs.t=Math.max(0,obs.t-dt*0.35);
    }
  }
  // Dialogue is now click-driven (see talk()/interactAt). updateQuest only auto-resolves
  // a handoff when the player is adjacent and already carrying the goods — the NPC stays
  // quiet until spoken to, then reacts.
  function updateQuest(dt,player,ctx,getTile,setTile){
    const current=currentStep();
    if(current && current.kind==='observe'){
      updateObserveStep(current,dt,player,getTile,setTile,ctx);
      return;
    }
    const step=current && current.kind==='handoff' ? current : null;
    if(step && distToPlayer(player)<=interactR && resourceCount(step.item)>=step.amount){
      advanceStep(step,ctx);
    }
  }
  function talkLines(){
    const lines=[];
    const step=currentStep();
    const role=state.data && state.data.role;
    const tag=t=>role && state.data && state.data.generated ? role+': '+t : t;
    if(step){
      if(step.kind==='handoff'){
        appendTalkLines(lines,step.prompt);
        const need=Math.max(1,step.amount|0)-resourceCount(step.item);
        if(need>0 && step.missing) appendTalkLines(lines,step.missing);
      } else if(step.kind==='observe'){
        appendTalkLines(lines,step.prompt);
        const progress=observeProgress(step);
        if(progress>0 && progress<observeSeconds(step) && step.progress) appendTalkLines(lines,step.progress);
        else if(step.missing) appendTalkLines(lines,step.missing);
      } else {
        appendTalkLines(lines,step.prompt);
      }
    }
    if(state.data){
      if(state.data.lore) lines.push(tag(state.data.lore));
      if(state.data.moral) lines.push(state.data.moral);
    }
    const atomicLine=atomicWinterTalkLine();
    if(atomicLine) lines.push(tag(atomicLine));
    return lines.map(l=>String(l||'').trim()).filter(Boolean);
  }
  // Make the NPC speak: turn to the player and surface the next line in its repertoire.
  function talk(player){
    const lines=talkLines();
    if(!lines.length) return false;
    if(player && finite(player.x) && finite(state.x)) state.move.facing = player.x>=state.x ? 1 : -1;
    let idx=(state.talkIdx|0) % lines.length;
    let text=lines[idx];
    if(lines.length>1 && text===state.lastTalkLine){
      idx=(idx+1)%lines.length;
      text=lines[idx];
    }
    state.talkIdx=(state.talkIdx|0)+1;
    state.lastTalkLine=text;
    setLine(text, 4.6, true);
    state.talkT=state.lineT;
    return true;
  }
  function bodyCoversTile(tileX,tileY){
    if(!hasPosition()) return false;
    const w=npcBodyW()/2, h=npcBodyH()/2;
    return (tileX+1)>(state.x-w) && tileX<(state.x+w) && (tileY+1)>(state.y-h) && tileY<(state.y+h);
  }
  // Story modules can pull an NPC off-stage (the center guardian absorbs the
  // mentor for the mirror fight). Hidden NPCs keep their position and quest
  // state but neither render, speak, collide nor accept clicks.
  function isHidden(){ return !!(state.data && state.data.hidden); }
  function setHidden(v){
    if(!state.data) state.data={};
    const next=v?1:0;
    if((state.data.hidden?1:0)===next) return false;
    state.data.hidden=next;
    if(next){ state.line=''; state.lineT=0; state.talkT=0; }
    return true;
  }
  // Click-to-talk: returns true (and speaks) when a non-duel NPC is clicked within reach.
  function interactAt(tileX,tileY,player){
    if(isHidden()) return false;
    const step=currentStep();
    if(step && step.kind==='duel') return false;
    if(!bodyCoversTile(tileX,tileY)) return false;
    if(player && distToPlayer(player)>Math.max(interactR,3.2)) return false;
    return talk(player);
  }
  function damageHero(player,amount,ctx){
    ctx=contextFor(ctx);
    try{
      if(ctx && typeof ctx.damageHero==='function'){
        ctx.damageHero(amount,{srcX:state.x,srcY:state.y,cause:id,invulMs:420,kb:3,kbY:-2});
        return;
      }
    }catch(e){}
    if(player && typeof player.hp==='number') player.hp=Math.max(0,player.hp-amount);
  }
  function followGround(getTile,worldGen){
    const spot=landingAt(state.x,getTile,worldGen || MM.worldGen);
    if(spot) state.y=spot.y;
  }
  // --- Roaming physics + procedural behaviour -------------------------------
  const NPC_GRAV=26, NPC_MAXV=13, NPC_WALK=1.9, NPC_JUMP=-8.2, NPC_HOME_RADIUS=7, NPC_SIM_RADIUS=72;
  const DIGGABLE=new Set([T.DIRT,T.GRASS,T.GRASS_SNOW,T.SAND,T.STONE,T.SNOW,T.FROZEN_DIRT,T.FROZEN_SAND,T.FROZEN_CLAY]);
  function tileAt(getTile,x,y){ try{ return getTile(Math.floor(x),Math.floor(y)); }catch(e){ return T.AIR; } }
  function solidNpc(getTile,x,y,axis){
    if(y>=WORLD_H) return true;
    if(!(y>=0)) return false;
    const t=tileAt(getTile,x,y);
    if(isTrapdoorTile(t) && axis==='y' && state.move && state.move.vy<0) return false;
    return !isNpcPassableTile(t);
  }
  function protectedAt(x,y){
    try{ const fs=root.MM && root.MM.fallingSolids; return !!(fs && fs.isProtectedBuild && fs.isProtectedBuild(Math.floor(x),Math.floor(y))); }catch(e){ return false; }
  }
  function collideNpc(getTile,axis){
    const mv=state.move, w=npcBodyW()/2, h=npcBodyH()/2;
    const minX=Math.floor(state.x-w), maxX=Math.floor(state.x+w);
    const minY=Math.floor(state.y-h), maxY=Math.floor(state.y+h);
    if(axis==='x'){
      let target=state.x, hit=false;
      for(let y=minY;y<=maxY;y++) for(let x=minX;x<=maxX;x++){
        if(!solidNpc(getTile,x,y,axis)) continue;
        if(mv.vx>0){ const c=x-w-0.001; if(!hit||c<target) target=c; hit=true; }
        else if(mv.vx<0){ const c=x+1+w+0.001; if(!hit||c>target) target=c; hit=true; }
      }
      if(hit){ state.x=target; mv.vx=0; mv.blockedX=true; } else mv.blockedX=false;
    } else {
      mv.onGround=false;
      let target=state.y, hit=false, landed=false;
      for(let y=minY;y<=maxY;y++) for(let x=minX;x<=maxX;x++){
        if(!solidNpc(getTile,x,y,axis)) continue;
        if(mv.vy>0){ const c=y-h-0.001; if(!hit||c<target){ target=c; landed=true; } hit=true; }
        else if(mv.vy<0){ const c=y+1+h+0.001; if(!hit||c>target) target=c; hit=true; }
      }
      if(hit){ state.y=target; mv.vy=0; if(landed) mv.onGround=true; }
    }
  }
  function physicsStep(dt,getTile){
    const mv=state.move;
    mv.vy=Math.min(NPC_MAXV, (mv.vy||0)+NPC_GRAV*dt);
    state.x += (mv.vx||0)*dt;
    collideNpc(getTile,'x');
    state.y += mv.vy*dt;
    collideNpc(getTile,'y');
    if(state.y>WORLD_H+4){ const spot=landingAt(state.x,getTile,MM.worldGen); if(spot){ state.x=spot.x; state.y=spot.y; mv.vy=0; } }
    if(Math.abs(mv.vx)>0.3 && mv.onGround) mv.walkT=(mv.walkT||0)+dt;
  }
  function hazardAhead(getTile,dir){
    const fx=state.x+dir*0.6;
    if(tileAt(getTile,fx,state.y)===T.LAVA || tileAt(getTile,fx,state.y)===T.WATER) return true;
    const footY=Math.floor(state.y+npcBodyH()/2+0.1);
    for(let i=0;i<3;i++){ if(solidNpc(getTile,fx,footY+i,'x')) return false; }
    return true; // ledge: nothing to stand on within 3 tiles
  }
  function restoreJob(){
    const job=state.ai.job;
    if(!job || !job.setTile) return;
    try{
      if(job.kind==='dig' && job.orig!=null) job.setTile(job.x,job.y,job.orig);
      else if(job.kind==='build') job.setTile(job.x,job.y,T.AIR);
    }catch(e){}
    state.ai.job=null;
  }
  function noteWork(x,y,kind){
    try{
      const p=root.MM && root.MM.particles;
      if(p && p.spawnBlockBreak) p.spawnBlockBreak((x+0.5)*(root.MM.TILE||20),(y+0.5)*(root.MM.TILE||20));
      else if(p && p.spawnSplash) p.spawnSplash((x+0.5)*(root.MM.TILE||20),(y+0.5)*(root.MM.TILE||20),0.4);
    }catch(e){}
    void kind;
  }
  // Begin a short dig or build chore in front of the NPC. Both self-heal after a few
  // seconds so residents look busy without permanently scarring the world or touching
  // protected structures (their own houses).
  function startChore(getTile,setTile){
    if(typeof setTile!=='function' || !state.move.onGround) return false;
    const dir=state.move.facing>=0?1:-1;
    const fx=Math.floor(state.x+dir*0.7);
    const footRow=Math.floor(state.y+npcBodyH()/2+0.05);
    if(Math.random()<0.5){
      // dig a natural surface block in front
      const dy=footRow;
      const t=tileAt(getTile,fx,dy);
      if(DIGGABLE.has(t) && !protectedAt(fx,dy)){
        state.ai.job={kind:'dig',x:fx,y:dy,orig:t,setTile,t:1.6+Math.random()*1.6};
        try{ setTile(fx,dy,T.AIR); }catch(e){}
        noteWork(fx,dy,'dig');
        return true;
      }
    } else {
      // build a block onto empty ground in front
      const dy=footRow;
      const below=tileAt(getTile,fx,dy+1);
      if(tileAt(getTile,fx,dy)===T.AIR && isSolid(below) && !protectedAt(fx,dy)){
        const mat=DIGGABLE.has(below)?below:T.DIRT;
        state.ai.job={kind:'build',x:fx,y:dy,orig:T.AIR,setTile,t:1.8+Math.random()*1.8};
        try{ setTile(fx,dy,mat); }catch(e){}
        noteWork(fx,dy,'build');
        return true;
      }
    }
    return false;
  }
  function behaviorStep(dt,player,getTile,setTile){
    const mv=state.move;
    // Long dialogue owns the pose until its bubble disappears. Short barks can
    // be delivered without interrupting a walk, jump, chore or combat reaction.
    if(state.lineLong && state.lineT>0){
      mv.vx=0;
      if(player && finite(player.x)) mv.facing=player.x>=state.x?1:-1;
      return;
    }
    state.ai.t-=dt; state.ai.jumpCd=Math.max(0,(state.ai.jumpCd||0)-dt);
    // Resolve an in-progress chore.
    if(state.ai.job){
      mv.vx*=0.6;
      state.ai.job.t-=dt;
      if(state.ai.job.t<=0) restoreJob();
      return;
    }
    // Talk pose: stand and face the player.
    if(state.ai.mode==='talk'){
      mv.vx*=0.5;
      if(player && finite(player.x)) mv.facing=player.x>=state.x?1:-1;
      if(state.ai.t<=0) state.ai.mode='idle', state.ai.t=0.5;
      return;
    }
    const home=homeAnchorX();
    if(state.ai.t<=0){
      const tooFar=Math.abs(state.x-home)>NPC_HOME_RADIUS;
      const r=Math.random();
      if(tooFar){ state.ai.mode='wander'; state.ai.targetX=home; state.ai.t=3+Math.random()*2; }
      else if(r<0.32){ state.ai.mode='idle'; state.ai.t=0.8+Math.random()*2.2; }
      else if(r<0.82){ state.ai.mode='wander'; state.ai.targetX=home+(Math.random()*2-1)*NPC_HOME_RADIUS; state.ai.t=1.5+Math.random()*3; }
      else { state.ai.mode='work'; state.ai.t=0.4; if(!startChore(getTile,setTile)){ state.ai.mode='idle'; state.ai.t=1; } }
    }
    if(state.ai.mode==='wander' && state.ai.targetX!=null){
      const dir=state.ai.targetX>state.x?1:-1;
      mv.facing=dir;
      if(hazardAhead(getTile,dir) || (mv.blockedX && mv.onGround)){
        // turn back, and hop if a low wall blocks the way
        if(mv.blockedX && mv.onGround && state.ai.jumpCd<=0 && !hazardAhead(getTile,dir)){
          mv.vy=NPC_JUMP; mv.onGround=false; state.ai.jumpCd=0.6;
        } else {
          state.ai.targetX=home-(state.ai.targetX-home);
          mv.vx*=-0.3;
        }
      } else {
        mv.vx=dir*NPC_WALK;
        if(Math.abs(state.x-state.ai.targetX)<0.4){ state.ai.mode='idle'; state.ai.t=0.6+Math.random()*1.5; }
      }
      // occasional joyful hop
      if(mv.onGround && state.ai.jumpCd<=0 && Math.random()<0.012){ mv.vy=NPC_JUMP*0.8; mv.onGround=false; state.ai.jumpCd=1.2; }
    } else { // idle
      mv.vx*=0.6;
    }
  }
  function updateRoam(dt,player,getTile,setTile,worldGen){
    if(!hasPosition()){ return; }
    const far = player && finite(player.x) ? Math.abs(player.x-state.x)>NPC_SIM_RADIUS : true;
    if(far){
      // Off in the distance: keep the resident planted on the surface, no churn.
      if(state.ai.job) restoreJob();
      followGround(getTile,worldGen);
      state.move.vx=0; state.move.vy=0; state.move.onGround=true;
      return;
    }
    behaviorStep(dt,player,getTile,setTile);
    physicsStep(dt,getTile);
  }
  function updateDuel(dt,player,getTile,worldGen,ctx){
    const step=currentStep();
    if(!step || step.kind!=='duel' || !player) return;
    const dx=(player.x||0)-state.x;
    const dy=(player.y||0)-state.y;
    const adx=Math.abs(dx);
    if(!(state.lineLong && state.lineT>0) && adx<combat.chaseRadius && Math.abs(dy)<combat.chaseY){
      state.x += Math.sign(dx||1)*Math.min(combat.speed*dt, Math.max(0,adx-combat.stopDistance));
      followGround(getTile,worldGen);
    }
    state.attackCd=Math.max(0,state.attackCd-dt);
    if(adx<combat.attackRangeX && Math.abs(dy)<combat.attackRangeY && state.attackCd<=0){
      state.attackCd=combat.attackCooldown;
      damageHero(player,combat.contactDamage,ctx);
      setLine(combat.contactLine,2.2,true);
    } else if(distToPlayer(player)<=bubbleR && state.lineT<=0.1){
      setLine(combat.chaseLine,2.4,true);
    }
  }
  function update(dt,player,getTile,setTile,ctx){
    ctx=contextFor(ctx);
    dt=Math.max(0,Math.min(0.1,Number(dt)||0));
    state.tick+=dt;
    state.lineT=Math.max(0,state.lineT-dt);
    if(state.lineT<=0) state.lineLong=false;
    state.hurtT=Math.max(0,state.hurtT-dt);
    state.defeatedT=Math.max(0,state.defeatedT-dt);
    state.ambientT=Math.max(0,state.ambientT-dt);
    state.talkT=Math.max(0,(state.talkT||0)-dt);
    const worldGen=(ctx && ctx.worldGen) || MM.worldGen;
    ensurePlaced(player,getTile,worldGen);
    if(isHidden()) return; // off-stage: keep position/state frozen until revealed
    updateQuest(dt,player,ctx,getTile,setTile);
    const step=currentStep();
    if(step && step.kind==='duel') updateDuel(dt,player,getTile,worldGen,ctx);
    else if(step && step.kind==='observe'){
      if(state.ai && state.ai.job) restoreJob();
      state.move.vx*=0.5;
      followGround(getTile,worldGen);
    }
    else updateRoam(dt,player,getTile,setTile,worldGen);
    if(typeof def.afterUpdate==='function'){
      try{
        def.afterUpdate(state,{
          player,getTile,setTile,ctx,
          step:currentStep(),
          applyReward:(reward,item)=>applyReward(reward,ctx,item),
          markChanged:()=>markChanged(ctx),
          refreshInventory:()=>refreshInventory(ctx)
        });
      }catch(e){}
    }
  }
  function hitAt(tileX,tileY){
    if(isHidden()) return false;
    const step=currentStep();
    if(!step || step.kind!=='duel' || !hasPosition() || state.hp<=0) return false;
    const wx=tileX+0.5, wy=tileY+0.5;
    return Math.abs(wx-state.x)<hitbox.x && Math.abs(wy-state.y)<hitbox.y;
  }
  function hurt(amount,ctx){
    ctx=contextFor(ctx);
    const step=currentStep();
    if(!step || step.kind!=='duel' || state.hp<=0) return false;
    const nextHp=Math.max(0,state.hp-Math.max(0.5,Number(amount)||1));
    state.hurtT=0.25;
    if(nextHp<=0){
      state.hp=0;
      if(!applyReward(duelReward(),ctx)){
        state.hp=1;
        state.hurtT=0.18;
      }
    } else {
      state.hp=nextHp;
      setLine(combat.hitLine,1.6,true);
    }
    return true;
  }
  function attackAt(tileX,tileY,dmgBonus,ctx){
    if(!hitAt(tileX,tileY)) return false;
    const bonus=(typeof dmgBonus==='number' && isFinite(dmgBonus) && dmgBonus>0) ? dmgBonus : 0;
    return hurt(3+bonus,ctx);
  }
  function damageAt(tileX,tileY,dmg,ctx){
    if(!hitAt(tileX,tileY)) return false;
    return hurt(Math.max(0.5,(typeof dmg==='number' && isFinite(dmg)) ? dmg : 1),ctx);
  }
  function chooseReward(choice,player,ctx){
    ctx=contextFor(ctx);
    const step=currentStep();
    if(!step || step.kind!=='choice') return false;
    if(player && distToPlayer(player)>interactR){
      setLine(step.missing || step.prompt,3,true);
      return false;
    }
    const item=rewardForChoice(choice);
    if(!item){
      setLine(step.missing || step.prompt,3,true);
      return false;
    }
    return applyReward(choiceReward(item),ctx,item);
  }
  function handleKey(key,player,ctx){
    ctx=contextFor(ctx);
    const step=currentStep();
    if(!step || step.kind!=='choice') return false;
    const k=String(key||'').toLowerCase();
    const choices=choicesForStep(step);
    if(!choices.some(choice=>String(choice.key||'').toLowerCase()===k)) return false;
    return chooseReward(k,player,ctx);
  }
  function phaseText(){
    if(state.lineT>0 && state.line) return state.line;
    const step=stepForPhase();
    if(step) return textOf(step.prompt);
    const phase=currentStep();
    if(phase && phase.prompt) return textOf(phase.prompt);
    return '';
  }
  function drawDefaultBody(ctx,tile){
    if(!look){
      const bc=(state.data && state.data.color) || def.bodyColor || def.color;
      const ac=(state.data && state.data.accent) || def.accentColor || def.accent;
      look=npcLook(lookSeed,bc,ac);
    }
    drawActorBody(ctx,tile,state,{look,seed:lookSeed,now,maxHp});
  }
  function draw(ctx,tile,canDrawTile){
    if(!ctx || !hasPosition() || isHidden()) return;
    const TILE_SIZE=tile||20;
    const tx=Math.floor(state.x), ty=Math.floor(state.y);
    if(typeof canDrawTile==='function' && !canDrawTile(tx,ty)) return;
    // Every NPC is the hero's species — rendered by the shared actor so they read as
    // individuals of the same kind. (def.drawBody is still honoured for special cases.)
    if(typeof def.drawBody==='function') def.drawBody(ctx,TILE_SIZE,state,{clamp,now,maxHp,phase:state.phase,look:look||(look=npcLook(lookSeed,(state.data&&state.data.color)||def.color,(state.data&&state.data.accent)||def.accent)),drawActorBody});
    else drawDefaultBody(ctx,TILE_SIZE);
    // Speech bubbles are click-driven now: only shown while a line is active.
    const step=currentStep();
    if(state.lineT>0 && state.line){
      drawDialogueBubble(
        ctx,
        state.x*TILE_SIZE,
        (state.y-0.98)*TILE_SIZE,
        state.line,
        step && step.kind==='choice' ? choicesForStep(step) : null,
        {choiceShortLabel:def.choiceShortLabel, choiceFill:def.choiceFill}
      );
    }
  }
  function questDefinitions(){
    return steps.map(step=>({
      id:step.id,
      kind:step.kind,
      item:step.item || null,
      amount:step.amount || 0,
      seconds:step.kind==='observe' ? observeSeconds(step) : 0,
      mode:step.mode || null,
      label:step.label || null,
      next:step.next || null,
      choices:step.kind==='choice' ? choicesForStep(step).map(r=>({key:r.key,id:r.id,weaponType:r.weaponType,name:r.name})) : null
    }));
  }
  function snapshot(){
    if(typeof def.snapshot==='function'){
      try{ return cleanRecord(def.snapshot(state,{cleanPhase,maxHp,finite,clamp,cleanObserve})); }
      catch(e){ return {}; }
    }
    return {
      v:1,
      id,
      x:validNpcX(state.x)?+state.x.toFixed(3):null,
      y:validNpcY(state.y)?+state.y.toFixed(3):null,
      phase:cleanPhase(state.phase),
      hp:clamp(Number(state.hp)||0,0,maxHp),
      rewards:cleanRewards(state.rewards),
      data:cleanNpcData(state.data,initialData),
      observe:cleanObserve(state.observe)
    };
  }
  function restore(data){
    if(!data || typeof data!=='object') return false;
    let restored;
    try{ restored=typeof def.migrateSnapshot==='function' ? def.migrateSnapshot(data,{cleanPhase,maxHp,finite,clamp,rewardForChoice}) : data; }
    catch(e){ return false; }
    if(!restored || typeof restored!=='object') return false;
    state.x=validNpcX(restored.x)?restored.x:null;
    state.y=validNpcY(restored.y)?restored.y:null;
    state.phase=cleanPhase(restored.phase);
    state.hp=clamp(Number(restored.hp)||0,0,maxHp);
    state.rewards=cleanRewards(restored.rewards);
    state.data=cleanNpcData(restored.data,initialData);
    state.observe=cleanObserve(restored.observe);
    state.line='';
    state.lineT=0;
    state.lineLong=false;
    state.attackCd=0;
    state.hurtT=0;
    const defeatedT=Number(restored.defeatedT);
    state.defeatedT=Number.isFinite(defeatedT) ? clamp(defeatedT,0,NPC_TRANSIENT_TIME_CAP) : 0;
    state.ambientT=0;
    state.talkT=0; state.talkIdx=0;
    state.move={vx:0,vy:0,facing:1,onGround:false,walkT:0};
    state.ai={mode:'idle',t:0.6,targetX:null,job:null,jobT:0,jumpCd:0};
    return true;
  }
  function reset(){
    if(state.ai && state.ai.job) restoreJob();
    state.x=null;
    state.y=null;
    state.phase=initialPhase;
    state.hp=maxHp;
    state.line='';
    state.lineT=0;
    state.lineLong=false;
    state.attackCd=0;
    state.hurtT=0;
    state.defeatedT=0;
    state.ambientT=0;
    state.tick=0;
    state.talkT=0; state.talkIdx=0;
    state.rewards={};
    state.data=cleanNpcData(initialData,null);
    state.observe={phase:'',t:0,best:0,ok:false,lineCd:0};
    state.move={vx:0,vy:0,facing:1,onGround:false,walkT:0};
    state.ai={mode:'idle',t:0.6,targetX:null,job:null,jobT:0,jumpCd:0};
  }
  function debug(){
    const base=Object.assign({},state,{rewards:cleanRewards(state.rewards), data:cleanNpcData(state.data,initialData), maxHp});
    if(typeof def.debug==='function') return Object.assign(base,def.debug(state,{maxHp}));
    return base;
  }

  const api={
    id:()=>id,
    displayName:()=>displayName,
    update,
    draw,
    interactAt,
    talk:(player)=>talk(player),
    attackAt,
    damageAt,
    chooseReward,
    handleKey,
    snapshot,
    restore,
    reset,
    setContext,
    summary:jobSummary,
    placeNearPlayer,
    placeNearWorldStart,
    hasPosition,
    setHidden,
    hidden:isHidden,
    questSteps:questDefinitions,
    phase:()=>state.phase,
    // Lightweight position accessor + nudge used by the registry's NPC-NPC separation.
    body:()=>(hasPosition() && !isHidden())?{x:state.x,y:state.y,w:npcBodyW(),h:npcBodyH(),duel:(currentStep()&&currentStep().kind==='duel')}:null,
    nudge:(dx)=>{
      if(validNpcX(state.x) && finite(dx)){
        const next=state.x+clamp(dx,-1,1);
        if(validNpcX(next)) state.x=next;
        if(state.move) state.move.vx*=0.5;
      }
    },
    _debug:debug
  };
  npcRegistry.register(id,api);
  if(def.legacyGlobalKey) MM[def.legacyGlobalKey]=api;
  if(!MM.npcs || typeof MM.npcs!=='object') MM.npcs={};
  MM.npcs[id]=api;
  return api;
}

export { createQuestNpc, drawDialogueBubble, npcRegistry, validateQuestDefinition };
export default npcRegistry;
