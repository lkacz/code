// Procedural boss monsters: large multi-part creatures that stalk the world.
//
//   spawning   — at every dawn and every dusk one monster materializes 35–95 columns
//                from the hero (never right on top, always on reachable land), with a
//                direction hint message and an off-screen HUD arrow to hunt it down
//   generation — fully seeded: a mirrored body blob on a part lattice (one part = one
//                tile), with legs, an eye, armor plating around a glowing HEART, plus
//                rolled stats (archetype, speed, senses, damage) — no two are alike
//   structure  — built from the game's own block tiles (stone armor, sandy/grassy/
//                snowy flesh, wooden legs) so it reads as one fused mass; every part
//                is individually destructible, and parts disconnected from the heart
//                break off as physical debris while the monster fights on
//   feeding    — between fights a beast grows hungry and grazes the world: it drinks
//                water, eats sand, plants, snow or wood, and accretes a matching body
//                block every few bites (water→ice, sand→sand, …). A feeding beast is
//                peaceable — it will not hunt or attack until full, struck, or cornered
//   balance    — legs hold the body upright; lose the legs on one side and it lurches
//                and lists toward the gap, a near-legless beast stumbles and can't hold
//                a pose. Limbs (legs, arms, tentacles) swing with the walk cycle
//   wounds     — a fall deeper than twice its height bruises every part (lure one off
//                a cliff!); losing the eye blinds it — a blind beast cannot track the
//                hero. A wounded beast
//                grazes to mend: each damaged part is cured only by eating the world
//                block of its own element, found within forage range
//   rigidity   — monsters are solid to each other and to the hero: bodies shove each
//                other apart, and the hero can land on and ride a beast's back. A
//                ridden beast throws shaking fits — staying aboard through one hurts
//   ranged     — a hunting beast out of close reach rips a loose block from the
//                terrain (never its own footing) and hurls it in a ballistic arc;
//                a block that connects hurts and knocks back the hero
//   physics    — continuous (sub-tile) motion with gravity and fractional terrain
//                collision, hopping up 2-tile ledges like the hero, hops and hovering;
//                knockback on the hero, debris and body chunks tumble under gravity
//   the heart  — armored deep inside and unstrikeable while body blocks seal it on
//                all four sides: blows glance off until the hero carves a path through
//                the plating. Once it is destroyed the monster detonates, blasting a
//                crater into the terrain (bedrock and chests survive), hurting a hero
//                who stands too close and paying out XP
//
// One prototype, three archetypes (walker / hopper / floater) — new species plug in
// by extending the generator (silhouette + stats) without touching physics or combat.
// The sim core runs headless; Node tests stub MM (see tools/boss-sim.test.mjs).
window.MM = window.MM || {};
(function(){
  const {T, WORLD_H} = MM;

  const CFG = {
    SPAWN_MIN: 35,      // closest a monster may spawn (columns from the hero)
    SPAWN_MAX: 95,      // farthest — close enough to find, far enough to hunt
    MAX_ALIVE: 2,       // day + night monster can coexist; further spawns skip
    HARD_CAP: 8,        // absolute ceiling, even for forced/console spawns
    INITIAL_DELAY: 12,  // seconds after world start until the first monster
    RETRY_DELAY: 10,    // seconds before retrying a failed spawn search
    CULL_DIST: 500,     // monsters this far behind the hero quietly despawn
    GRAV: 22,           // tiles/s^2
    MAX_FALL: 18,
    BLAST_BASE: 5,      // crater radius = base + sqrt(part count)
    DEBRIS_CAP: 140,
    TOOL_DMG: {basic:2, stone:4, diamond:8},
    // --- feeding & growth ---
    HUNGER_RATE: 1/26,  // hunger units/sec; reaches 1 (peckish) in ~26 s
    FORAGE_RANGE: 7,    // columns scanned around the beast for edible blocks
    BITE_TIME: 0.55,    // seconds to chew through one block
    GROW_PER_MEAL: 3,   // blocks eaten per accreted body part
    SATIATE_BITES: 12,  // blocks eaten before a meal ends and hunger resets
    GROWTH_CAP: 28,     // most parts a beast may accrete over its starting size
    FORAGE_RETRY: 0.6,  // seconds between food scans when the last one found nothing
    // --- balance / articulation ---
    TILT_MAX: 0.5,      // radians a fully off-balance beast leans before stumbling
    LEG_SUPPORT: 0.45,  // each leg's share of "uprightness"; fewer legs → more sway
    // --- wounds ---
    FALL_SAFE: 2,       // falls up to this many body-heights are harmless
    FALL_DMG: 0.8,      // hp every part loses per tile fallen beyond the safe drop
    HEAL_PER_BITE: 4,   // hp a curative bite restores to the matching body part
    // --- shake (hero riding the beast) ---
    SHAKE_TIME: 0.8,    // seconds one shake fit lasts
    SHAKE_CD: [3,7],    // seconds between fits
    SHAKE_DMG: 0.5,     // x attackDmg dealt to a hero riding through a shake
    // --- block throwing ---
    THROW_MIN: 5,       // closer than this it closes distance instead of throwing
    THROW_MAX: 30,      // farther than this the hero is out of throwing range
    THROW_CD: [2.2,4.5],// seconds between throws
    THROW_SPEED: 14,    // tiles/s horizontal pace used to time the ballistic arc
    THROW_DMG: 0.7,     // x attackDmg dealt by a block that hits the hero
    PROJ_CAP: 24,       // most blocks airborne at once across all monsters
  };
  // What a beast can consume from the world, and the body-block it grows in return
  // (drink water → icy flesh, eat sand → sandy flesh, graze grass/leaves → green, etc.)
  // Surface/plant/fluid blocks a beast grazes — never solid bedrock (stone/diamond),
  // so it browses the landscape and drinks from lakes instead of tunnelling.
  const EAT_GROW = {
    [T.WATER]: T.ICE, [T.SAND]: T.SAND, [T.GRASS]: T.GRASS,
    [T.LEAF]: T.LEAF, [T.SNOW]: T.SNOW, [T.WOOD]: T.WOOD,
    [T.AUTUMN_LEAF_ORANGE]: T.LEAF, [T.AUTUMN_LEAF_RED]: T.LEAF,
  };
  const EDIBLE = new Set(Object.keys(EAT_GROW).map(Number));
  // Inverse map for curative feeding: a damaged body part of type X is healed by
  // eating the world block that grows X (icy flesh ← water, sandy flesh ← sand, …)
  const HEAL_EAT = {};
  for(const k of Object.keys(EAT_GROW)) HEAL_EAT[EAT_GROW[k]] = +k;
  HEAL_EAT[T.LEAF] = T.LEAF;
  // Loose surface blocks a beast can rip out of the terrain and hurl at the hero
  const THROWABLE = new Set([T.SAND, T.GRASS, T.SNOW, T.WOOD, T.LEAF, T.AUTUMN_LEAF_ORANGE, T.AUTUMN_LEAF_RED, T.STONE, T.ICE]);
  // Block palette a body is built from, so beasts read as made of the game's own tiles
  const BODY_BLOCKS = [T.STONE, T.SAND, T.GRASS, T.SNOW, T.WOOD];
  function infoColor(t){ try{ const I=MM.INFO; if(I && I[t] && I[t].color) return I[t].color; }catch(e){} return null; }
  function shade(hex, d){
    if(typeof hex!=='string' || hex[0]!=='#' || hex.length<7) return hex;
    const c=v=>v<0?0:v>255?255:v;
    const r=c(parseInt(hex.slice(1,3),16)+d), g=c(parseInt(hex.slice(3,5),16)+d), b=c(parseInt(hex.slice(5,7),16)+d);
    return '#'+r.toString(16).padStart(2,'0')+g.toString(16).padStart(2,'0')+b.toString(16).padStart(2,'0');
  }

  // ---------------- State ----------------
  let monsters = [];
  let setTile_global = ()=>{};   // captured each update() so feeding can eat tiles
  const debris = [];           // tumbling part chunks {x,y,vx,vy,c,t,max,s}
  const blasts = [];           // expanding detonation rings {x,y,R,t,max}
  const projectiles = [];      // hurled blocks {x,y,vx,vy,t,max,tile,color,spin,dmg}
  let lastIsDay = null;
  let spawnTimer = CFG.INITIAL_DELAY;
  let monsterSeq = 1;
  let spawnedTotal = 0, killedTotal = 0;
  let cycleOverride = null;

  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function mulberry(seed){ let a=seed>>>0; return function(){ a|=0; a=(a+0x6D2B79F5)|0; let t=Math.imul(a^(a>>>15),1|a); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }
  function cycleInfo(){
    if(cycleOverride) return cycleOverride;
    const bg=MM.background;
    if(bg && bg.getCycleInfo) return bg.getCycleInfo();
    return {isDay:true, tDay:0.5};
  }
  function tileInfo(t){ return MM.INFO && MM.INFO[t]; }
  function isGasTile(t){ const info=tileInfo(t); return !!(info && info.gas); }
  function isLeafTile(t){ return t===T.LEAF || t===T.AUTUMN_LEAF_ORANGE || t===T.AUTUMN_LEAF_RED; }
  function openT(t){ return t===T.AIR || t===T.WATER || isLeafTile(t) || isGasTile(t); }
  // Monsters pass through air, water, leaves and transient gases; everything else is wall/floor.
  function solidT(t){ return !openT(t); }
  function playerRef(){ return (typeof window!=='undefined' && window.player) || null; }
  function say(t){ try{ if(typeof window!=='undefined' && window.msg) window.msg(t); }catch(e){} }
  // Hero damage is centralized in main.js (window.damageHero); the inline body
  // below is the fallback for the DOM-less Node sims, which stub neither handler.
  function damageHero(amount, srcX, cause){
    if(!(amount>0) || !isFinite(amount)) return;
    const p=playerRef();
    if(!p || typeof p.hp!=='number') return;
    if(typeof window!=='undefined' && typeof window.damageHero==='function'){
      window.damageHero(amount,{srcX, kb:4, kbY:-4.5, cause:cause||'boss'});
      return;
    }
    const now=(typeof performance!=='undefined')? performance.now() : 0;
    if(p.hpInvul && now<p.hpInvul) return;
    p.hp-=amount; p.hpInvul=now+600;
    if(typeof p.vx==='number'){ p.vx+=(p.x<srcX? -1:1)*4; p.vy=Math.min(p.vy||0,-4.5); }
    if(p.hp<=0){
      p.hp=0;
      try{ say('Potwór cię pokonał – respawn'); p.hp=p.maxHp||100; if(window.placePlayer) window.placePlayer(true); }catch(e){}
    }
  }

  // ---------------- Procedural generation ----------------
  const NAME_A=['Gro','Mor','Zar','Kru','Vol','Tar','Bru','Skal','Drog','Hul'];
  const NAME_B=['gnak','thar','mok','zur','gor','dath','rok','vash','grim','nax'];
  function hsl(h,s,l){ return 'hsl('+Math.round(h)+','+Math.round(s)+'%,'+Math.round(l)+'%)'; }

  // Build a seeded monster: mirrored blob silhouette, guaranteed-connected, with a
  // buried heart, armor shell, legs (for grounded archetypes) and a front eye.
  // opts.aquatic → a 'swimmer' (tentacled, icy palette, lives in oceans);
  // opts.scale  → silhouette dimensions multiplier (3 = gargantuan).
  function generateMonster(seed,x,y,opts){
    const rng=mulberry(seed);
    const scale=Math.max(1,(opts && opts.scale)||1);
    const aquatic=!!(opts && opts.aquatic);
    const roll=rng();
    const archetype = aquatic? 'swimmer' : (roll<0.5? 'walker' : roll<0.8? 'hopper' : 'floater');
    const legless = archetype==='floater' || archetype==='swimmer';
    const hw=(2+Math.floor(rng()*3))*scale;     // half-width 2..4 (×scale) → body 5..9 wide
    const bodyH=(4+Math.floor(rng()*4))*scale;  // body 4..7 tall (×scale)
    const cells=new Map();                      // "dx,dy" -> role placeholder
    const put=(dx,dy)=>cells.set(dx+','+dy,1);
    for(let dy=-(bodyH-1); dy<=0; dy++){
      for(let dx=0; dx<=hw; dx++){
        const nx=dx/hw, ny=(dy+(bodyH-1)/2)/(bodyH/2);
        if(rng() < 1.18-(nx*nx+ny*ny*0.8)){ put(dx,dy); put(-dx,dy); }
      }
    }
    // heart cell + a full armor ring around it must exist
    const coreDx=0, coreDy=-Math.floor(bodyH/2);
    for(let ddy=-1; ddy<=1; ddy++) for(let ddx=-1; ddx<=1; ddx++) put(coreDx+ddx, coreDy+ddy);
    // legs below the body for grounded archetypes
    if(!legless){
      const legLen=(1+Math.floor(rng()*2))*scale;
      const legXs=[-(hw-1), hw-1]; if(rng()<0.5) legXs.push(0);
      for(const lx of legXs){ if(!cells.has(lx+',0')) put(lx,0); for(let l=1;l<=legLen;l++) put(lx,l); }
    }
    // connectivity: keep only what the heart can reach
    const reach=new Set([coreDx+','+coreDy]); const q=[[coreDx,coreDy]];
    while(q.length){
      const [cx,cy]=q.pop();
      for(const [ddx,ddy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const k=(cx+ddx)+','+(cy+ddy);
        if(cells.has(k) && !reach.has(k)){ reach.add(k); q.push([cx+ddx,cy+ddy]); }
      }
    }
    // normalize so the lowest cells sit at dy=0 (the feet row)
    let maxDy=-99; for(const k of reach){ const dy=+k.slice(k.indexOf(',')+1); if(dy>maxDy) maxDy=dy; }
    const hue=rng()*360;
    const size=reach.size;
    // a body is built from one or two of the game's own block types, so it reads
    // as made of tiles; the heart stays a glowing organ and armor is always stone.
    // Sea beasts wear an icy/sandy palette so they read as creatures of the deep.
    const palette = aquatic? [T.ICE, T.SAND, T.STONE] : BODY_BLOCKS;
    const primary=palette[Math.floor(rng()*palette.length)];
    let accent=palette[Math.floor(rng()*palette.length)];
    if(accent===primary) accent=palette[(palette.indexOf(primary)+1)%palette.length];
    const bodyBlocks=[primary, accent];
    const legBlock = (primary===T.WOOD||accent===T.WOOD)? T.WOOD : T.STONE;
    function paintColor(blockType, isCore, nearCore){
      if(isCore) return '#ff3b5c';
      const base=infoColor(blockType);
      if(base) return shade(base, Math.round(rng()*26-13));
      // headless / no-INFO fallback (sim tests): keep the old hue scheme
      return nearCore? hsl(hue,30,26) : hsl(hue+rng()*24-12, 38+rng()*18, 34+rng()*14);
    }
    const parts=[]; let core=null;
    let minDx=99,maxDx=-99,topDy=99;
    for(const k of reach){
      const ci=k.indexOf(','); const dx=+k.slice(0,ci), dy=+k.slice(ci+1)-maxDy;
      if(dx<minDx)minDx=dx; if(dx>maxDx)maxDx=dx; if(dy<topDy)topDy=dy;
      const isCore=(dx===coreDx && dy===coreDy-maxDy);
      const nearCore=!isCore && Math.abs(dx-coreDx)<=1 && Math.abs(dy-(coreDy-maxDy))<=1;
      const role = isCore?'core': nearCore?'armor': dy===0?'leg':'flesh';
      const blockType = isCore? null : nearCore? T.STONE : role==='leg'? legBlock : (rng()<0.72? primary : accent);
      const p={
        dx, dy, role, blockType,
        color: paintColor(blockType, isCore, nearCore),
        hitT:0, limbP:rng()*6.28,
      };
      p.maxHp = isCore? 18+size : nearCore? 9+Math.floor(rng()*4) : dy===0? 5 : 4+Math.floor(rng()*3);
      p.hp=p.maxHp;
      parts.push(p); if(isCore) core=p;
    }
    // eye on the top row, biased to one side — gives each beast a "front"
    const facing=rng()<0.5?-1:1;
    let eye=null;
    for(const p of parts){ if(p.dy===topDy && (!eye || p.dx*facing>eye.dx*facing)) eye=p; }
    if(eye && eye!==core) eye.role='eye';
    // articulate the silhouette: the outermost mid-body cells become swinging arms,
    // and on floaters the lowest cells become trailing tentacles instead of feet
    for(const p of parts){
      if(p.role!=='flesh') continue;
      const midRow = p.dy<0 && p.dy>topDy;
      if(midRow && (p.dx===minDx || p.dx===maxDx) && Math.abs(p.dx)>=2) p.role='arm';
      else if(legless && p.dy===0) p.role='tentacle';
    }
    const name=NAME_A[Math.floor(rng()*NAME_A.length)]+NAME_B[Math.floor(rng()*NAME_B.length)];
    const gargantuan=scale>1;
    const m={
      id:monsterSeq++, seed, name, archetype, parts, core, hue, bodyBlocks,
      x, y, vx:0, vy:0, dir:facing, onGround:false,
      baseParts:reach.size, aquatic, gargantuan,
      speed:(1.2+rng()*1.4)*(gargantuan?0.75:1), sense:18+rng()*14+(gargantuan?10:0),
      jump:7+rng()*3, hopT:0, attackDmg:Math.round((6+rng()*6)*(gargantuan?2:1)),
      state:'roam', flipT:2+rng()*4, frozen:false, bobP:rng()*6.28,
      hunger:rng()*0.4, feed:null, biteT:0, mealBites:0, grown:0, forageCd:0,
      tilt:0, tiltV:0, gait:rng()*6.28, airFrom:null,
      shakeT:0, shakeCd:0, heroOnTop:false, throwCd:2+rng()*2,
    };
    refreshStructure(m);
    return m;
  }

  // Recompute silhouette bounds, the occupancy lattice ("dx,dy" → part exists)
  // that grounding, growth and outline rendering share, and whether the beast still
  // has its eye (a blind beast cannot track the hero). Call after any part change.
  function refreshStructure(m){
    let minDx=99,maxDx=-99,topDy=99,hasEye=false;
    const occ = m.occ instanceof Set ? m.occ : (m.occ=new Set());
    occ.clear();
    for(const p of m.parts){
      if(p.dx<minDx)minDx=p.dx; if(p.dx>maxDx)maxDx=p.dx; if(p.dy<topDy)topDy=p.dy;
      if(p.role==='eye') hasEye=true;
      occ.add(p.dx+','+p.dy);
    }
    m.minDx=minDx; m.maxDx=maxDx; m.height=-topDy+1; m.hasEye=hasEye;
  }

  // ---------------- Spawning ----------------
  function trySpawn(getTile, opts){
    if(monsters.length>=CFG.MAX_ALIVE && !(opts && opts.force)) return null;
    if(monsters.length>=CFG.HARD_CAP) return null; // even forced spawns have a ceiling
    const p=playerRef();
    const px=(p && isFinite(p.x))? p.x : 0;
    const wg=MM.worldGen;
    const seed=(opts && typeof opts.seed==='number')? (opts.seed>>>0) : ((Math.random()*0x7fffffff)|0);
    // 10% of natural spawns are gargantuan: 3x silhouette, double attack power,
    // an epic-chest hoard on death. Forced/test spawns stay normal unless asked.
    const scale=(opts && opts.scale) || ((!opts || !opts.force) && Math.random()<0.10? 3 : 1);
    for(let attempt=0; attempt<40; attempt++){
      let x;
      if(opts && typeof opts.x==='number'){
        if(!isFinite(opts.x)) return null;
        x=Math.round(opts.x);
      } else {
        const side=Math.random()<0.5?-1:1;
        x=Math.round(px + side*(CFG.SPAWN_MIN + Math.random()*(CFG.SPAWN_MAX-CFG.SPAWN_MIN)));
      }
      const biome=(wg && wg.biomeType)? wg.biomeType(x) : 0;
      const surf=(wg && wg.surfaceHeight)? wg.surfaceHeight(x) : 90;
      // Submerged column → spawn a sea beast swimming in the water. Keyed off the
      // actual water (not the biome) so the debug button / forced spawns work from
      // a boat too — previously explicit-x spawns skipped this path and all 40
      // attempts failed on the water check ("nie udało się przyzwać").
      if(getTile(x, surf-1)===T.WATER){
        // natural spawns leave lakes empty; explicit summons may use them if deep enough
        if(biome===6 && !(opts && typeof opts.x==='number')) continue;
        const m=generateMonster(seed, x, 0, {aquatic:true, scale});
        // find the local water surface (perched lakes sit above the global sea level)
        let waterTop=surf-1, scan=0;
        while(scan<40 && getTile(x, waterTop-1)===T.WATER){ waterTop--; scan++; }
        m.y=waterTop + m.height + 1;            // fully submerged below the surface
        if(m.y>surf-2) continue;                // too shallow for this body
        if(collides(m,getTile)) continue;
        monsters.push(m); spawnedTotal++;
        const dirTxt=(m.x>=px)? 'na wschodzie':'na zachodzie';
        say((m.gargantuan? '⚠ GARGANTUICZNY wodny potwór ':'🌊 Wodny potwór ')+m.name+' wynurzył się '+dirTxt+'!');
        try{ if(MM.audio && MM.audio.play) MM.audio.play('roar'); }catch(e){}
        return m;
      }
      if(biome===6 && !(opts && typeof opts.x==='number')) continue;
      const m=generateMonster(seed, x, surf-1, {aquatic:!!(opts && opts.aquatic), scale});
      if(opts && opts.archetype) m.archetype=opts.archetype;
      if(opts && opts.freeze) m.frozen=true;
      // lift out of hillsides so no part starts buried; if the column is sealed
      // under solid rock even after lifting, reject it and try another spot
      let lift=0; const liftMax=12*Math.max(1,scale);
      while(lift<liftMax && collides(m,getTile)){ m.y-=1; lift++; }
      if(collides(m,getTile)) continue;
      monsters.push(m); spawnedTotal++;
      const dirTxt=(m.x>=px)? 'na wschodzie':'na zachodzie';
      say((m.gargantuan? '⚠ GARGANTUICZNY potwór ':'⚠ Potwór ')+m.name+' pojawił się '+dirTxt+'!');
      try{ if(MM.audio && MM.audio.play) MM.audio.play('roar'); }catch(e){}
      return m;
    }
    return null;
  }
  function forceSpawn(getTile,opts){
    if(typeof getTile!=='function'){ const w=MM.world; getTile=w && w.getTile; }
    if(typeof getTile!=='function') return null;
    return trySpawn(getTile, Object.assign({force:true}, opts||{}));
  }

  // ---------------- Physics ----------------
  // Fractional collision: each part spans [x+dx, x+dx+1) × [y+dy, y+dy+1), so a
  // moving body overlaps up to 4 tiles per part. The old Math.round anchor made
  // the whole beast occupy the lattice a half-tile early/late, which is what made
  // it move block-by-block on screen once rendering followed the true position.
  function collides(m,getTile){
    const fx=Math.floor(m.x), fy=Math.floor(m.y);
    const xFrac=(m.x-fx)>1e-6, yFrac=(m.y-fy)>1e-6;
    for(const p of m.parts){
      const tx=fx+p.dx, ty=fy+p.dy;
      if(solidT(getTile(tx,ty))) return true;
      if(xFrac && solidT(getTile(tx+1,ty))) return true;
      if(yFrac && solidT(getTile(tx,ty+1))) return true;
      if(xFrac && yFrac && solidT(getTile(tx+1,ty+1))) return true;
    }
    return false;
  }
  // Grounded if any bottom face of the body rests on solid terrain. Checking only
  // the dy===0 feet row broke once a part grew at a lower row: the beast was lifted
  // out of the ground by collision resolution and then never registered as grounded.
  function groundedAt(m,getTile){
    for(const p of m.parts){
      if(m.occ.has(p.dx+','+(p.dy+1))) continue;   // another part below: not a bottom face
      const ry=Math.floor(m.y+p.dy+1+0.06);        // probe just under the bottom face
      const x0=Math.floor(m.x+p.dx), x1=Math.floor(m.x+p.dx+1-1e-6);
      if(solidT(getTile(x0,ry)) || (x1!==x0 && solidT(getTile(x1,ry)))) return true;
    }
    return false;
  }
  // A fall deeper than FALL_SAFE body-heights bruises the whole body: every part
  // takes hp per excess tile (never severing — clamped at 1) and the beast staggers.
  function fallDamage(m,drop){
    const dmg=Math.ceil((drop - m.height*CFG.FALL_SAFE)*CFG.FALL_DMG);
    if(dmg<=0) return;
    for(const p of m.parts){ p.hp=Math.max(1,p.hp-dmg); p.hitT=0.2; }
    m.vx*=0.3; m.tiltV+=(Math.random()-0.5)*2;      // the impact staggers it
    try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst((m.x+0.5)*(MM.TILE||20),(m.y+1)*(MM.TILE||20),'common'); }catch(e){}
    say('💢 '+m.name+' runęło z wysokości!');
  }
  function windSpeedAt(x,y,getTile){
    try{
      const W=MM.wind;
      if(W && typeof W.speedAt==='function') return W.speedAt(x,y,getTile);
    }catch(e){}
    return 0;
  }
  function windResponseForMonster(m){
    if(!m || m.aquatic || m.archetype==='swimmer') return 0;
    const size=Math.max(12, m.parts ? m.parts.length : 24);
    const massScale=clamp(28/size,0.18,0.9);
    if(m.archetype==='floater') return 0.12*massScale;
    if(m.archetype==='hopper' && !m.onGround) return 0.07*massScale;
    if(!m.onGround) return 0.035*massScale;
    return 0;
  }
  function applyWindToMonster(m,getTile,dt){
    const response=windResponseForMonster(m);
    if(response<=0) return false;
    const sp=windSpeedAt(m.x+(m.minDx+m.maxDx+1)/2, m.y-m.height*0.45, getTile);
    if(Math.abs(sp)<0.06) return false;
    const before=m.vx||0;
    const cap=Math.max(0.45,(m.speed||1.2)*(m.archetype==='floater'?1.35:1.12));
    m.vx = before + sp*response*dt;
    if(Math.sign(m.vx)===Math.sign(sp) && Math.abs(m.vx)>cap) m.vx=Math.sign(sp)*cap;
    m.tiltV += sp*response*0.014*dt;
    return m.vx!==before;
  }
  function thrownWindResponse(tile){
    if(isLeafTile(tile) || tile===T.SNOW) return 0.18;
    if(tile===T.WOOD || tile===T.SAND || tile===T.GRASS) return 0.10;
    if(tile===T.ICE) return 0.07;
    if(tile===T.STONE) return 0.035;
    return 0.055;
  }
  function applyWindToProjectile(pr,getTile,dt){
    if(!pr) return false;
    const sp=windSpeedAt(pr.x,pr.y,getTile);
    if(Math.abs(sp)<0.05) return false;
    const before=pr.vx||0;
    pr.vx = before + sp*thrownWindResponse(pr.tile)*dt;
    if(Math.abs(pr.vx)>18) pr.vx=Math.sign(pr.vx)*18;
    return pr.vx!==before;
  }
  function applyWindToDebris(d,getTile,dt,TILE){
    if(!d) return false;
    const wx=d.x/TILE, wy=d.y/TILE;
    const sp=windSpeedAt(wx,wy,getTile);
    if(Math.abs(sp)<0.06) return false;
    const size=Math.max(1,Number(d.s)||4);
    const response=0.12*Math.max(0.35,Math.min(1.4,5/size));
    d.vx += sp*response*TILE*dt;
    if(Math.abs(d.vx)>160) d.vx=Math.sign(d.vx)*160;
    return true;
  }
  function moveOnce(m,getTile,dt){
    // vertical
    m.vy+=CFG.GRAV*dt; if(m.vy>CFG.MAX_FALL) m.vy=CFG.MAX_FALL;
    m.y+=m.vy*dt;
    if(m.vy>0 && collides(m,getTile)){
      m.y=Math.floor(m.y);                          // land flush — no snap pop
      let n=0; while(n<8 && collides(m,getTile)){ m.y-=1; n++; }
      m.vy=0;
    } else if(m.vy<0 && collides(m,getTile)){
      m.y=Math.ceil(m.y);                           // flush under the ceiling
      let n=0; while(n<6 && collides(m,getTile)){ m.y+=1; n++; }
      m.vy=0;
    }
    m.onGround=groundedAt(m,getTile);
    // fall depth bookkeeping: remember the apex while airborne, settle up on landing
    if(m.onGround){
      if(m.airFrom!=null){
        const drop=m.y-m.airFrom;
        if(drop>m.height*CFG.FALL_SAFE) fallDamage(m,drop);
        m.airFrom=null;
      }
    } else {
      m.airFrom = (m.airFrom==null)? m.y : Math.min(m.airFrom,m.y);
    }
    // horizontal: a blocked beast hops climbable ledges (≤2 tiles) like the hero
    // and the animals do, instead of teleporting up the step a whole tile at a time
    if(m.vx!==0){
      const oldX=m.x, oldY=m.y;
      m.x+=m.vx*dt;
      if(collides(m,getTile)){
        let step=0;
        for(let s=1;s<=2;s++){ m.y=oldY-s; if(!collides(m,getTile)){ step=s; break; } }
        m.x=oldX; m.y=oldY;
        if(step && m.onGround){
          m.vy=-Math.sqrt(2*CFG.GRAV*(step+0.45));  // hop onto the ledge, keep vx for the arc
        } else if(!m.onGround){
          /* airborne against a wall: keep pressing, the jump arc resolves it */
        } else if(m.archetype!=='walker'){ m.vy=-m.jump; m.vx=0; } // hop over walls
        else { m.dir*=-1; m.vx=0; }                                // or turn around
      }
    }
  }
  function stepPhysics(m,getTile,dt){
    if(m.archetype==='swimmer'){
      // Buoyant in water: free 2-axis swimming. Out of water (beached or breaching
      // the surface) it sinks back under reduced gravity instead of hovering.
      const cx=Math.floor(m.x);
      const submerged = getTile(cx, Math.floor(m.y-m.height/2))===T.WATER || getTile(cx, Math.floor(m.y))===T.WATER;
      if(!submerged){ m.vy+=CFG.GRAV*0.6*dt; if(m.vy>CFG.MAX_FALL*0.6) m.vy=CFG.MAX_FALL*0.6; m.vx*=Math.max(0,1-dt*0.8); }
      const oldX=m.x, oldY=m.y;
      m.y+=m.vy*dt;
      if(collides(m,getTile)){ m.y=oldY; m.vy = submerged? -Math.abs(m.vy)*0.3 : 0; }
      m.x+=m.vx*dt;
      if(collides(m,getTile)){ m.x=oldX; m.dir*=-1; m.vx*=-0.3; }
      m.onGround=false;
      return;
    }
    if(m.archetype==='floater'){
      const oldX=m.x, oldY=m.y;
      m.x+=m.vx*dt; m.y+=m.vy*dt;
      let lifted=false;
      if(collides(m,getTile)){ const fy=Math.floor(m.y); if(fy!==m.y){ m.y=fy; lifted=true; } } // settle flush first
      let lift=0; while(lift<8 && collides(m,getTile)){ m.y-=1; lift++; lifted=true; } // hover over bumps
      if(collides(m,getTile)){
        // a cliff taller than the lift can clear: back off and turn away, so the
        // beast bounces along tall walls instead of embedding itself in the rock
        m.x=oldX; m.y=oldY; m.vx*=-0.3; m.dir*=-1; m.vy=Math.min(m.vy,0);
        let esc=0; while(esc<24 && collides(m,getTile)){ m.y-=1; esc++; } // terrain grew into us
      } else if(lifted) m.vy=Math.min(m.vy,0);
      return;
    }
    // Substepped so no axis moves more than ~0.45 tiles per resolve: a lag-spike dt
    // (clamped at 0.1 s) once let falling legs tunnel straight through 1-tile floors.
    let remaining=dt, iter=0;
    while(remaining>1e-6 && iter<6){
      iter++;
      const peak=Math.max(Math.abs(m.vy)+CFG.GRAV*remaining, Math.abs(m.vx), 1);
      const sdt=Math.min(remaining, 0.45/peak);
      moveOnce(m,getTile,sdt);
      remaining-=sdt;
    }
  }

  // ---------------- Rigid bodies ----------------
  // Monsters are solid to each other: overlapping bodies are pushed apart (the
  // higher one may come to rest on the lower). AABB over the part lattice — bodies
  // are dense blobs, so the box is a faithful stand-in for pairwise contact.
  function separateMonsters(getTile){
    for(let i=0;i<monsters.length;i++){
      const a=monsters[i];
      for(let j=i+1;j<monsters.length;j++){
        const b=monsters[j];
        const ox=Math.min(a.x+a.maxDx+1, b.x+b.maxDx+1)-Math.max(a.x+a.minDx, b.x+b.minDx);
        if(ox<=0) continue;
        const oy=Math.min(a.y+1, b.y+1)-Math.max(a.y-a.height+1, b.y-b.height+1);
        if(oy<=0) continue;
        if(oy<=ox*0.6){
          // shallow vertical overlap: the higher beast rests on the lower one's back
          const top=a.y<=b.y? a:b;
          const oldY=top.y;
          top.y-=oy;
          if(collides(top,getTile)){ top.y=oldY; }
          else { top.vy=Math.min(top.vy,0); top.onGround=true; }
        } else {
          // side contact: shove both apart, kill the velocities pressing inward
          const dirA=(a.x+(a.minDx+a.maxDx)/2) <= (b.x+(b.minDx+b.maxDx)/2)? -1:1;
          const ax0=a.x, bx0=b.x;
          a.x+=dirA*ox/2; if(collides(a,getTile)) a.x=ax0;
          b.x-=dirA*ox/2; if(collides(b,getTile)) b.x=bx0;
          if(dirA<0){ a.vx=Math.min(a.vx,0); b.vx=Math.max(b.vx,0); }
          else { a.vx=Math.max(a.vx,0); b.vx=Math.min(b.vx,0); }
        }
      }
    }
  }
  // The hero treats monsters as terrain: lands on their crown, rides along, gets
  // shoved by their flanks. Called from the game loop after the hero integrates.
  // Resolves against the deepest-overlapping part per monster (stable per frame).
  function collideHero(p,dt){
    if(!p) p=playerRef();
    if(!p || !isFinite(p.x) || !isFinite(p.y)) return false;
    const hw=(p.w||0.7)/2, hh=(p.h||0.95)/2;
    let standing=false;
    for(const m of monsters){
      if(p.x+hw<=m.x+m.minDx || p.x-hw>=m.x+m.maxDx+1) continue;
      if(p.y+hh<=m.y-m.height+1 || p.y-hh>=m.y+1) continue;
      let best=null,bx=0,by=0,bestOv=0;
      for(const part of m.parts){
        const px=m.x+part.dx, py=m.y+part.dy;
        const ox=Math.min(px+1,p.x+hw)-Math.max(px,p.x-hw);
        const oy=Math.min(py+1,p.y+hh)-Math.max(py,p.y-hh);
        if(ox<=0||oy<=0) continue;
        const ov=ox*oy;
        if(ov>bestOv){ bestOv=ov; best=part; bx=ox; by=oy; }
      }
      if(!best) continue;
      const px=m.x+best.dx, py=m.y+best.dy;
      if(by<=bx && p.y<py+0.5){
        // feet on the beast's back: stand, ride its motion, fall with its hops
        p.y=py-hh-0.001;
        if((p.vy||0)>0) p.vy=0;
        if(m.vy<0) p.vy=Math.min(p.vy||0, m.vy);
        p.onGround=true; if(typeof p.jumpCount==='number') p.jumpCount=0;
        if(dt) p.x+=m.vx*dt;
        m.heroOnTop=true; standing=true;
      } else if(by<=bx){
        p.y=py+1+hh+0.001; if((p.vy||0)<0) p.vy=0;   // bumped its belly from below
      } else if(p.x<px+0.5){
        p.x=px-hw-0.001; if((p.vx||0)>0) p.vx=0;     // shoved off the left flank
        if(m.vx<0) p.vx=Math.min(p.vx||0, m.vx);
      } else {
        p.x=px+1+hw+0.001; if((p.vx||0)<0) p.vx=0;   // shoved off the right flank
        if(m.vx>0) p.vx=Math.max(p.vx||0, m.vx);
      }
    }
    return standing;
  }

  // ---------------- Feeding, growth & balance ----------------
  // How well the beast can stand: legs on each side prop it up. Symmetric support
  // keeps it upright; a missing leg leaves that side sagging, so it leans and sways.
  function legSupport(m){
    let left=0,right=0;
    for(const p of m.parts){ if(p.role!=='leg' && p.role!=='tentacle') continue; if(p.dx<0)left++; else if(p.dx>0)right++; else { left+=0.5; right+=0.5; } }
    return {left,right,total:left+right};
  }
  function updateBalance(m,dt){
    if(m.archetype==='floater' || m.archetype==='swimmer'){ m.tilt*=Math.max(0,1-dt*3); return; }
    const s=legSupport(m);
    // target lean: imbalance between sides pulls the body toward the weak side;
    // a near-legless beast can't hold any pose and topples toward TILT_MAX
    const asym=(s.right-s.left);                       // +→ heavier right, leans left
    const upright=Math.min(1, s.total*CFG.LEG_SUPPORT);
    let target=clamp(-asym*0.32, -CFG.TILT_MAX, CFG.TILT_MAX) * (1.2-upright);
    // wobble grows as support fails; a well-footed beast barely trembles
    const instab=1-upright;
    const now=(typeof performance!=='undefined')? performance.now():0;
    target += Math.sin(now*0.004 + m.gait)*0.10*instab + Math.sin(m.gait*1.7)*0.04;
    if(!m.onGround) target*=0.4;                        // mid-air it straightens toward fall
    // critically maimed and grounded: it stumbles, momentarily losing footing
    if(m.onGround && upright<0.5 && Math.random()<dt*0.6){ m.vx*=0.4; if(Math.random()<0.3) m.vy=-2.2; }
    const stiff=6+upright*8, damp=2*Math.sqrt(stiff);
    m.tiltV += ((target-m.tilt)*stiff - m.tiltV*damp)*dt;
    m.tilt += m.tiltV*dt;
    m.tilt=clamp(m.tilt,-1.2,1.2);
  }
  // Scan nearby columns for the closest reachable edible tile (water/sand/plants/…).
  // An optional want-set narrows the search to specific tile types (curative foraging).
  function findFood(m,getTile,want){
    const bx=Math.round(m.x), by=Math.round(m.y);
    let best=null,bd=1e9;
    for(let dx=-CFG.FORAGE_RANGE; dx<=CFG.FORAGE_RANGE; dx++){
      for(let dy=-1; dy<=m.height+1; dy++){
        const tx=bx+dx, ty=by+1-dy;
        const t=getTile(tx,ty);
        if(!EDIBLE.has(t)) continue;
        if(want && !want.has(t)) continue;
        // must be exposed (an air/edible neighbour) so it isn't buried bedrock-deep
        if(solidT(getTile(tx,ty-1)) && solidT(getTile(tx+1,ty)) && solidT(getTile(tx-1,ty)) && t!==T.WATER) continue;
        const d=Math.abs(dx)+Math.abs(dy)*0.5;
        if(d<bd){ bd=d; best={tx,ty,t}; }
      }
    }
    return best;
  }
  // What a wounded beast would need to eat: the set of world blocks whose grown
  // body type matches a damaged part. Empty set → nothing curable by feeding.
  function healNeeds(m){
    const want=new Set();
    for(const p of m.parts){
      if(p.hp>=p.maxHp-0.01 || p.blockType==null) continue;
      const eat=HEAL_EAT[p.blockType];
      if(eat!==undefined) want.add(eat);
    }
    return want;
  }
  // A curative bite: the eaten block knits the most-damaged body part of the same
  // element back together. Returns true if something was healed.
  function healPart(m,eaten){
    const bt=EAT_GROW[eaten]; if(bt===undefined) return false;
    let best=null;
    for(const p of m.parts){
      if(p.blockType!==bt || p.hp>=p.maxHp-0.01) continue;
      if(!best || p.hp/p.maxHp < best.hp/best.maxHp) best=p;
    }
    if(!best) return false;
    best.hp=Math.min(best.maxHp, best.hp+CFG.HEAL_PER_BITE);
    best.healT=0.5;
    return true;
  }
  // Accrete one block of body, grown from the tile that was eaten, in an empty cell
  // adjacent to the existing body (keeps the lattice connected). Returns the new part.
  function growBody(m,eatenType){
    if(m.grown>=CFG.GROWTH_CAP) return null;
    const occupied=m.occ;
    const cands=[];
    for(const p of m.parts){
      if(p.role==='core') continue;
      for(const [ddx,ddy] of [[0,-1],[1,0],[-1,0],[0,1]]){
        const nx=p.dx+ddx, ny=p.dy+ddy, k=nx+','+ny;
        if(ny>0) continue;                               // never grow below the feet line
        if(!occupied.has(k)) cands.push([nx,ny,k]);
      }
    }
    if(!cands.length) return null;
    const pick=cands[Math.floor(Math.random()*cands.length)];
    const block=EAT_GROW[eatenType] ?? eatenType;
    const base=infoColor(block);
    const np={
      dx:pick[0], dy:pick[1], role: pick[1]===0?'leg':'flesh', blockType:block,
      color: base? shade(base, Math.round(Math.random()*26-13)) : m.parts[0].color,
      hitT:0.2, limbP:Math.random()*6.28, maxHp: pick[1]===0?5:4+Math.floor(Math.random()*3),
    };
    np.hp=np.maxHp;
    m.parts.push(np); m.grown++;
    refreshStructure(m);   // bigger silhouette: bounds + occupancy must follow
    if(m.core) m.core.maxHp += 1;                        // a larger beast guards a tougher heart
    return np;
  }
  // Drive a hungry OR wounded beast to forage and chew; while eating it is peaceable
  // (no attack). A beast that isn't hungry still grazes to cure itself — but only on
  // blocks matching its damaged flesh, and only if such a block is within range.
  // Returns true if feeding fully owns this tick's locomotion.
  function stepFeeding(m,getTile,setTile,dt){
    if(m.forageCd>0) m.forageCd-=dt;
    const curativeOnly = m.hunger<1;
    if(m.feed){
      // validate the target is still edible (terrain may have shifted under it)
      if(getTile(m.feed.tx,m.feed.ty)!==m.feed.t){ m.feed=findFood(m,getTile, curativeOnly? healNeeds(m):null); }
    }
    if(!m.feed){
      if(m.forageCd>0) return false;
      let want=null;
      if(curativeOnly){ want=healNeeds(m); if(!want.size) return false; }
      const f=findFood(m,getTile,want);
      if(!f){ m.forageCd=CFG.FORAGE_RETRY; return false; } // barren ground: rest the scan
      m.feed=f; m.biteT=0;
    }
    m.state='feed';
    const bx=Math.round(m.x);
    const drifts = m.archetype==='floater' || m.archetype==='swimmer';
    if(drifts) m.vy=clamp((m.feed.ty-1-m.y)*1.1,-4,4); // sink/rise to the morsel
    const reach=Math.abs(m.feed.tx-bx);
    if(reach>1){
      m.dir=m.feed.tx>=bx?1:-1;                          // shuffle over to the food
      const want=m.dir*m.speed*0.7;
      if(drifts) m.vx+=(want*1.2-m.vx)*Math.min(1,dt*2);
      else m.vx+=(want-m.vx)*Math.min(1,dt*4);
      return true;
    }
    // in range: chew
    m.vx*=0.6; m.dir=m.feed.tx>=bx?1:-1;
    m.biteT+=dt;
    if(m.biteT>=CFG.BITE_TIME){
      m.biteT=0;
      const eaten=m.feed.t;
      setTile(m.feed.tx,m.feed.ty,T.AIR);
      try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(m.feed.tx,m.feed.ty); }catch(e){}
      if(eaten===T.WATER){ try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(m.feed.tx,m.feed.ty,getTile); }catch(e){} }
      try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst((m.feed.tx+0.5)*(MM.TILE||20),(m.feed.ty+0.5)*(MM.TILE||20),'common'); }catch(e){}
      m.mealBites++;
      // a bite first knits matching wounded flesh; only surplus food grows new mass
      const healed=healPart(m,eaten);
      if(!healed && m.mealBites % CFG.GROW_PER_MEAL === 0){ const np=growBody(m,eaten); if(np) say(m.name+' urosło, żywiąc się '+foodWord(eaten)); }
      const cured = m.hunger<1 && !healNeeds(m).size;     // curative meal and nothing left to cure
      if(m.mealBites>=CFG.SATIATE_BITES || cured){        // full or mended: end the meal
        m.hunger=0; m.mealBites=0; m.feed=null; m.state='roam'; m.flipT=2+Math.random()*3;
        return true;
      }
      m.feed=findFood(m,getTile, m.hunger<1? healNeeds(m):null); // next bite (same spot now air)
      if(!m.feed){ m.hunger=Math.max(0,m.hunger-0.4); m.state='roam'; }
    }
    return true;
  }
  function foodWord(t){ return t===T.WATER?'wodą': t===T.SAND?'piaskiem': t===T.GRASS?'trawą': isLeafTile(t)?'liśćmi': t===T.SNOW?'śniegiem': t===T.WOOD?'drewnem':'kamieniem'; }

  // ---------------- Behavior ----------------
  // A hunting beast rips a loose block out of the nearby terrain to hurl at the hero.
  // Skips the strip it stands on so it never excavates its own footing.
  function findThrowBlock(m,getTile){
    const bx=Math.round(m.x), by=Math.round(m.y);
    let best=null,bd=1e9;
    for(let dx=-CFG.FORAGE_RANGE; dx<=CFG.FORAGE_RANGE; dx++){
      for(let dy=-2; dy<=m.height+2; dy++){
        const tx=bx+dx, ty=by+1-dy;
        if(ty>=WORLD_H-3 || ty>by+1) continue;                  // bedrock shelf / below footing
        if(ty===by+1 && tx>=bx+m.minDx-1 && tx<=bx+m.maxDx+1) continue; // its own floor strip
        const t=getTile(tx,ty);
        if(!THROWABLE.has(t)) continue;
        // must be exposed so the beast plucks from the surface, not through rock
        if(solidT(getTile(tx,ty-1)) && solidT(getTile(tx+1,ty)) && solidT(getTile(tx-1,ty))) continue;
        const d=Math.abs(dx)+Math.abs(dy)*0.5;
        if(d<bd){ bd=d; best={tx,ty,t}; }
      }
    }
    return best;
  }
  function tryThrow(m,p,dist,getTile,setTile,dt){
    if(m.throwCd>0 || dist<CFG.THROW_MIN || dist>CFG.THROW_MAX) return;
    if(projectiles.length>=CFG.PROJ_CAP) return;
    const b=findThrowBlock(m,getTile);
    if(!b){ m.throwCd=1; return; }                              // nothing loose nearby: retry soon
    setTile(b.tx,b.ty,T.AIR);                                   // the block leaves the world…
    try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(b.tx,b.ty); }catch(e){}
    const sx=m.x+(m.minDx+m.maxDx+1)/2, sy=m.y-m.height;        // …and launches from the crown
    const t=clamp(dist/CFG.THROW_SPEED, 0.45, 1.3);
    const g=CFG.GRAV*0.55;
    const aimX=p.x + (p.vx||0)*t*0.5;               // lead a moving hero by half his drift
    projectiles.push({
      x:sx, y:sy,
      vx:(aimX-sx)/t + (Math.random()-0.5)*0.8,
      vy:(p.y-0.5-sy)/t - 0.5*g*t,
      t:0, max:4, tile:b.t, color:infoColor(b.t)||'#9a9a9a',
      spin:Math.random()*6.28, dmg:Math.max(2, Math.round(m.attackDmg*CFG.THROW_DMG)),
    });
    m.throwCd=CFG.THROW_CD[0]+Math.random()*(CFG.THROW_CD[1]-CFG.THROW_CD[0]);
  }
  function stepBehavior(m,getTile,dt){
    // hunger accrues steadily — even while a nearby hero suppresses feeding
    m.hunger=Math.min(2, m.hunger + CFG.HUNGER_RATE*dt);
    if(m.throwCd>0) m.throwCd-=dt;
    // feeding takes priority over hunting: a grazing beast is peaceable until
    // it is full, attacked, or the hero is right on top of it
    const pNow=playerRef();
    const heroClose = pNow && Math.abs(pNow.x-m.x) < 4 && Math.abs(pNow.y-(m.y-m.height/2)) < m.height;
    if(!heroClose && stepFeeding(m,getTile,setTile_global,dt)) return;
    if(m.feed && (heroClose || m.core.hp<m.core.maxHp)){ m.feed=null; m.state='roam'; } // disturbed → stop eating
    const p=playerRef();
    const pdx=p? p.x-m.x : 1e9;
    const pdy=p? p.y-(m.y-m.height/2) : 1e9;
    const dist=Math.abs(pdx);
    const enraged=m.core.hp < m.core.maxHp*0.5;
    // hunt/roam with hysteresis so the monster doesn't flicker at the sense edge;
    // a beast that lost its eye is blind — it cannot pick up the hero's trail at all
    if(m.state==='roam' && m.hasEye && dist<m.sense && Math.abs(pdy)<30) m.state='hunt';
    else if(m.state==='hunt' && (!m.hasEye || dist>m.sense*1.5)) m.state='roam';
    let want=0;
    if(m.state==='hunt'){
      m.dir=pdx>=0?1:-1;
      want=m.dir*m.speed*(enraged?1.6:1.15);
      // out of close reach: rip a block from the terrain and hurl it instead
      if(p) tryThrow(m,p,dist,getTile,setTile_global,dt);
    } else {
      m.flipT-=dt;
      if(m.flipT<=0){ m.dir=Math.random()<0.5?-1:1; m.flipT=3+Math.random()*5; }
      want=m.dir*m.speed*0.45;
    }
    // mud bogs grounded beasts down to half pace (floaters/swimmers don't touch it)
    if(m.archetype!=='floater' && m.archetype!=='swimmer'){
      const fx=Math.floor(m.x), fy=Math.floor(m.y);
      if(getTile(fx,fy+1)===T.MUD || getTile(fx,fy)===T.MUD) want*=0.5;
    }
    if(m.archetype==='hopper'){
      // hops carry the momentum; between hops it crouches in place
      if(m.onGround){
        m.vx*=0.7;
        m.hopT-=dt;
        if(m.hopT<=0 && want!==0){ m.vy=-m.jump; m.vx=want*1.7; m.hopT=0.7+Math.random()*0.8; }
      }
    } else if(m.archetype==='floater'){
      m.vx+=(want*1.2-m.vx)*Math.min(1,dt*2);
      const wg=MM.worldGen;
      const surf=(wg && wg.surfaceHeight)? wg.surfaceHeight(Math.round(m.x)) : m.y+2;
      let targetY=surf-m.height-3;
      if(m.state==='hunt' && p) targetY=Math.max(targetY-2, p.y-2);   // swoop at prey
      m.bobP+=dt*2; if(m.bobP>1e3) m.bobP%=(Math.PI*2);
      m.vy=clamp((targetY-m.y)*1.1, -4, 4)+Math.sin(m.bobP)*0.8;
    } else if(m.archetype==='swimmer'){
      m.vx+=(want*1.1-m.vx)*Math.min(1,dt*2);
      // patrol just under the surface; while hunting, dive/rise toward the prey
      // but never above the waterline (the surface clamp keeps it submerged)
      const tx=Math.floor(m.x);
      let waterTop=Math.floor(m.y); let scan=0;
      while(scan<48 && getTile(tx,waterTop-1)===T.WATER){ waterTop--; scan++; }
      let targetY=waterTop + m.height + 1;
      if(m.state==='hunt' && p) targetY=Math.max(targetY, Math.min(p.y+1, m.y+12));
      m.bobP+=dt*1.6; if(m.bobP>1e3) m.bobP%=(Math.PI*2);
      m.vy=clamp((targetY-m.y)*1.1, -4, 4)+Math.sin(m.bobP)*0.6;
      // don't swim into the beach: water must continue at mid-body depth ahead
      const aheadX=Math.floor(m.x)+(m.vx>=0? m.maxDx+1 : m.minDx-1);
      const midY=Math.floor(m.y-m.height/2);
      if(getTile(aheadX,midY)!==T.WATER && getTile(aheadX,Math.floor(m.y))!==T.WATER){ m.dir*=-1; m.vx*=-0.5; }
    } else {
      m.vx+=(want-m.vx)*Math.min(1,dt*4);
    }
    // Boss bodies are solid terrain, not passive damage volumes. The hero may be
    // shoved by flanks or ride the crown through collideHero(); HP loss only comes
    // from explicit attacks in update(): shaking fits and hurled blocks.
  }

  // ---------------- Damage / structure ----------------
  function spawnDebris(m,p,count){
    const TILE=MM.TILE||20;
    for(let i=0;i<count;i++){
      if(debris.length>=CFG.DEBRIS_CAP) break;
      debris.push({
        x:(m.x+p.dx+0.5)*TILE, y:(m.y+p.dy+0.5)*TILE,
        vx:(Math.random()-0.5)*120, vy:-40-Math.random()*90,
        c:p.color, t:0, max:0.8+Math.random()*0.9, s:3+Math.random()*5,
      });
    }
  }
  // Remove a part, then break off everything the heart can no longer reach —
  // the severed chunks tumble away as debris and the beast fights on with the rest.
  function destroyPart(m,part,getTile,setTile){
    const idx=m.parts.indexOf(part);
    if(idx<0) return;
    spawnDebris(m,part,4);
    m.parts.splice(idx,1);
    if(part===m.core){ detonate(m,getTile,setTile); return; }
    const byKey=new Map(); for(const p of m.parts) byKey.set(p.dx+','+p.dy,p);
    const reach=new Set([m.core.dx+','+m.core.dy]); const q=[m.core];
    while(q.length){
      const c=q.pop();
      for(const [ddx,ddy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const k=(c.dx+ddx)+','+(c.dy+ddy);
        const n=byKey.get(k);
        if(n && !reach.has(k)){ reach.add(k); q.push(n); }
      }
    }
    for(let i=m.parts.length-1;i>=0;i--){
      const p=m.parts[i];
      if(!reach.has(p.dx+','+p.dy)){ spawnDebris(m,p,3); m.parts.splice(i,1); }
    }
    refreshStructure(m);   // a leaner body limps on with fresh bounds + occupancy
  }
  // The heart bursts: crater the terrain (bedrock and chests survive), hurl debris,
  // hurt a hero standing close, and pay out the bounty.
  function detonate(m,getTile,setTile){
    const bx=Math.round(m.x)+m.core.dx, by=Math.round(m.y)+m.core.dy;
    const R=CFG.BLAST_BASE+Math.round(Math.sqrt(m.parts.length+1));
    for(let dy=-R; dy<=R; dy++){
      for(let dx=-R; dx<=R; dx++){
        if(dx*dx+dy*dy>R*R) continue;
        const tx=bx+dx, ty=by+dy;
        if(ty<1 || ty>=WORLD_H-3) continue;                    // bedrock shelf survives
        const t=getTile(tx,ty);
        if(t===T.AIR) continue;
        if(t===T.CHEST_COMMON||t===T.CHEST_RARE||t===T.CHEST_EPIC) continue; // loot survives
        setTile(tx,ty,T.AIR);
        try{ if(MM.fallingSolids && MM.fallingSolids.onTileRemoved) MM.fallingSolids.onTileRemoved(tx,ty); }catch(e){}
      }
    }
    // wake the fluid sim at the center and rim so lakes pour into the fresh crater
    try{
      if(MM.water && MM.water.onTileChanged){
        MM.water.onTileChanged(bx,by,getTile);
        for(const [ox,oy] of [[-R,0],[R,0],[0,-R],[0,R]]) MM.water.onTileChanged(bx+ox,by+oy,getTile);
      }
    }catch(e){}
    for(const p of m.parts) spawnDebris(m,p,2);
    // The felled beast leaves its hoard: chests settle onto the crater floor
    // (a gargantuan drops a pile of epic chests; a normal beast one weighted chest)
    const chestN = m.gargantuan? 3 : 1;
    for(let c=0;c<chestN;c++){
      const tx=bx + (c===0?0: c===1?-2:2) + Math.round((Math.random()-0.5)*2);
      const tier = m.gargantuan? T.CHEST_EPIC
                 : (Math.random()<0.15? T.CHEST_EPIC : Math.random()<0.65? T.CHEST_RARE : T.CHEST_COMMON);
      let placed=false;
      for(let ty=Math.max(2,by-2); ty<WORLD_H-3; ty++){
        const tt=getTile(tx,ty);
        // air or water column with solid floor below — works on land and seabed
        if(openT(tt) && solidT(getTile(tx,ty+1))){
          setTile(tx,ty,tier);
          if(tt===T.WATER){ try{ if(MM.water && MM.water.onTileChanged) MM.water.onTileChanged(tx,ty,getTile); }catch(e){} }
          placed=true; break;
        }
      }
      if(!placed){ const tt=getTile(tx,by); if(openT(tt)) setTile(tx,by,tier); }
    }
    const TILE=MM.TILE||20;
    blasts.push({x:(bx+0.5)*TILE, y:(by+0.5)*TILE, R:R*TILE, t:0, max:0.7});
    try{ if(MM.particles && MM.particles.spawnBurst) MM.particles.spawnBurst((bx+0.5)*TILE,(by+0.5)*TILE,'epic'); }catch(e){}
    try{ if(MM.audio && MM.audio.play) MM.audio.play('explosion'); }catch(e){}
    const p=playerRef();
    if(p && isFinite(p.x) && isFinite(p.y)){
      const d=Math.max(Math.abs(p.x-bx), Math.abs(p.y-by));
      if(d<R+4) damageHero(Math.round(40*(1-d/(R+5))+6), bx, 'boss_blast');
    }
    if(p && typeof p.xp==='number') p.xp+=40+m.parts.length*2;
    say('💥 Serce potwora '+m.name+' zniszczone! +'+(40+m.parts.length*2)+' XP'+(m.gargantuan? ' — zostawił stos epickich skrzyń!':' — zostawił skrzynię!'));
    killedTotal++;
    try{ if(typeof window!=='undefined' && window.dispatchEvent) window.dispatchEvent(new CustomEvent('mm-boss-killed',{detail:{name:m.name, gargantuan:!!m.gargantuan}})); }catch(e){}
    m.dead=true;
    const i=monsters.indexOf(m); if(i>=0) monsters.splice(i,1); // gone the moment it bursts
  }
  // --- Abduction support (UFO): the saucer dematerializes a whole beast — no
  // detonation, no crater, no chest, no kill credit; it was taken, not slain ---
  function nearestForAbduction(wx,range){
    let best=null, bd=Infinity;
    for(const m of monsters){ if(m.dead) continue; const d=Math.abs(m.x-wx); if(d<=range && d<bd){ bd=d; best=m; } }
    return best;
  }
  function targetsForTurret(sx,sy,range,onlyMonster){
    if(!Number.isFinite(sx) || !Number.isFinite(sy)) return null;
    const r=Math.max(0,Number(range)||0);
    const r2=r*r;
    const targets=[];
    for(const m of monsters){
      if(!m || m.dead || (onlyMonster && m!==onlyMonster)) continue;
      const parts=Array.isArray(m.parts) ? m.parts : [];
      const sealed=coreProtected(m);
      for(const p of parts){
        if(!p || !(p.hp>0)) continue;
        if(p===m.core && sealed) continue;
        const x=m.x+p.dx+0.5, y=m.y+p.dy+0.5;
        const dx=x-sx, dy=y-sy, d2=dx*dx+dy*dy;
        if(d2>r2) continue;
        targets.push({kind:'boss',boss:m,part:p,x,y,tx:Math.floor(x),ty:Math.floor(y),hp:p.hp,d2});
      }
    }
    targets.sort((a,b)=>a.d2-b.d2);
    return targets;
  }
  function nearestForTurret(sx,sy,range,onlyMonster){
    const targets=targetsForTurret(sx,sy,range,onlyMonster);
    return targets && targets.length ? targets[0] : null;
  }
  function abduct(m){
    const i=monsters.indexOf(m); if(i<0) return false;
    for(const p of m.parts) spawnDebris(m,p,1); // body crumbles upward into the beam
    m.dead=true; monsters.splice(i,1);
    return true;
  }

  // The heart is unassailable while body blocks seal it on all four sides — the
  // hero has to carve a path through the plating before the heart can be struck.
  function coreProtected(m){
    const c=m.core; if(!c) return false;
    return m.occ.has((c.dx+1)+','+c.dy) && m.occ.has((c.dx-1)+','+c.dy)
        && m.occ.has(c.dx+','+(c.dy+1)) && m.occ.has(c.dx+','+(c.dy-1));
  }
  // Attack the part occupying world tile (tx,ty). Damage = hero's tool + optional
  // equipped-weapon bonus passed by main.js (MM.activeModifiers.attackDamage).
  function attackAt(tx,ty,dmgBonus){
    const p=playerRef();
    let dmg=CFG.TOOL_DMG[(p && p.tool)||'basic']||2;
    if(typeof dmgBonus==='number' && isFinite(dmgBonus) && dmgBonus>0) dmg+=dmgBonus;
    return strikeAt(tx,ty,dmg);
  }
  // Absolute-damage strike (arrows / flame): bypasses tool scaling
  function damageAt(tx,ty,dmg){
    return strikeAt(tx,ty, Math.max(0.5,(typeof dmg==='number' && isFinite(dmg))? dmg:1));
  }
  function strikeAt(tx,ty,dmg){
    if(typeof tx!=='number' || typeof ty!=='number' || !isFinite(tx) || !isFinite(ty)) return false;
    const w=MM.world;
    const getTile=(w && w.getTile)||(()=>T.AIR), setTile=(w && w.setTile)||(()=>{});
    for(const m of monsters){
      if(tx<m.x+m.minDx-1 || tx>m.x+m.maxDx+1 || ty<m.y-m.height || ty>m.y+2) continue;
      // the body sits at a fractional position, so a clicked tile can overlap up to
      // four parts — strike the one covering most of the tile (matches the visuals)
      const sealed=coreProtected(m);
      let best=null, bestOv=0, coreOv=0;
      for(const p of m.parts){
        const px=m.x+p.dx, py=m.y+p.dy;
        const ox=Math.min(px+1,tx+1)-Math.max(px,tx);
        const oy=Math.min(py+1,ty+1)-Math.max(py,ty);
        if(ox<=0 || oy<=0) continue;
        const ov=ox*oy;
        if(p===m.core && sealed){ if(ov>coreOv) coreOv=ov; continue; } // sealed heart: unhittable
        if(ov>bestOv){ bestOv=ov; best=p; }
      }
      if(best){
        best.hp-=dmg; best.hitT=0.18;
        // a struck beast stops grazing and turns to fight (a blind one only frets)
        m.feed=null; if(m.state==='feed') m.state = m.hasEye? 'hunt':'roam'; m.hunger=Math.min(m.hunger,0.8);
        if(best.hp<=0) destroyPart(m,best,getTile,setTile);
        return true;
      }
      if(coreOv>0){
        // the blow glances off the plating sealing the heart — flash the armor ring
        for(const p of m.parts){ if(Math.abs(p.dx-m.core.dx)+Math.abs(p.dy-m.core.dy)===1) p.hitT=0.15; }
        const now=(typeof performance!=='undefined')? performance.now():0;
        if(!m.sealMsgT || now-m.sealMsgT>1500){ m.sealMsgT=now; say('Serce '+m.name+' jest osłonięte – przebij się przez pancerz!'); }
        return true;
      }
    }
    return false;
  }

  // Debug: kill the monster nearest the hero through the real death path —
  // its heart bursts, with the full crater/debris/XP consequences.
  function killNearest(getTile,setTile){
    const w=MM.world;
    if(typeof getTile!=='function') getTile=w && w.getTile;
    if(typeof setTile!=='function') setTile=w && w.setTile;
    if(typeof getTile!=='function' || typeof setTile!=='function') return null;
    if(!monsters.length) return null;
    const p=playerRef();
    const px=(p && isFinite(p.x))? p.x : 0;
    let best=null, bd=Infinity;
    for(const m of monsters){ const d=Math.abs(m.x-px); if(d<bd){ bd=d; best=m; } }
    const name=best.name;
    detonate(best,getTile,setTile);
    return name;
  }

  // ---------------- Main update ----------------
  function update(getTile,setTile,dt){
    if(typeof getTile!=='function' || typeof setTile!=='function') return;
    if(typeof dt!=='number' || !(dt>0)) return;
    if(dt>0.1) dt=0.1;
    setTile_global=setTile;   // feeding (driven from stepBehavior) eats tiles through this
    // a monster at every dawn and every dusk: a successful spawn parks the timer
    // at Infinity until the next phase flip pulls it back down
    const isDay=!!cycleInfo().isDay;
    if(lastIsDay===null) lastIsDay=isDay;
    else if(isDay!==lastIsDay){ lastIsDay=isDay; spawnTimer=Math.min(spawnTimer,0.5); }
    if(spawnTimer>0){
      spawnTimer-=dt;
      if(spawnTimer<=0) spawnTimer = trySpawn(getTile)? Infinity : CFG.RETRY_DELAY;
    }
    const p=playerRef();
    const hasPlayer=!!(p && isFinite(p.x));
    const px=hasPlayer? p.x : 0;
    for(let i=monsters.length-1;i>=0;i--){
      const m=monsters[i];
      if(!isFinite(m.x) || !isFinite(m.y)){ monsters.splice(i,1); continue; } // corrupted: drop
      if(!m.frozen) stepBehavior(m,getTile,dt);
      if(!m.frozen) applyWindToMonster(m,getTile,dt);
      stepPhysics(m,getTile,dt);
      // a ridden beast throws a fit: it shakes, and a hero still standing on its
      // back through the fit is hurt and hurled off (knockback via damageHero)
      if(m.shakeCd>0) m.shakeCd-=dt;
      if(m.shakeT>0){
        m.shakeT-=dt;
        if(m.heroOnTop) damageHero(Math.max(2,Math.round(m.attackDmg*CFG.SHAKE_DMG)), m.x-m.dir, 'boss_shake');
      } else if(m.heroOnTop && !m.frozen && m.shakeCd<=0 && Math.random()<dt*1.2){
        m.shakeT=CFG.SHAKE_TIME;
        m.shakeCd=CFG.SHAKE_CD[0]+Math.random()*(CFG.SHAKE_CD[1]-CFG.SHAKE_CD[0]);
        say('🌀 '+m.name+' otrząsa się!');
      }
      m.heroOnTop=false;   // re-armed by collideHero when the hero is still up there
      // articulation + balance: the walk cycle advances with travel, the body
      // leans according to how many legs still hold it up
      m.gait += (Math.abs(m.vx)*0.9 + 0.6)*dt*Math.PI;
      if(m.gait>1e3) m.gait%=(Math.PI*2);   // keep the phase small for sin() precision
      updateBalance(m,dt);
      for(const part of m.parts){ if(part.hitT>0) part.hitT-=dt; if(part.healT>0) part.healT-=dt; }
      // distance culling only with a live hero — otherwise it measures from x=0
      if(m.dead || !m.parts.length || m.y>WORLD_H+10 || (hasPlayer && Math.abs(m.x-px)>CFG.CULL_DIST)){
        monsters.splice(i,1);
      }
    }
    separateMonsters(getTile);   // rigid bodies: no two beasts occupy the same space
    // hurled blocks: ballistic arcs that shatter on terrain or strike the hero
    for(let i=projectiles.length-1;i>=0;i--){
      const pr=projectiles[i];
      pr.t+=dt; pr.vy+=CFG.GRAV*0.55*dt; applyWindToProjectile(pr,getTile,dt); pr.x+=pr.vx*dt; pr.y+=pr.vy*dt; pr.spin+=dt*9;
      let dead=pr.t>pr.max || pr.y>WORLD_H+5;
      if(!dead && hasPlayer && Math.abs(p.x-pr.x)<0.75 && Math.abs(p.y-pr.y)<0.95){
        damageHero(pr.dmg, pr.x - pr.vx*0.1, 'boss_projectile');   // knock the hero along the block's flight
        dead=true;
      }
      if(!dead && solidT(getTile(Math.floor(pr.x),Math.floor(pr.y)))) dead=true;
      if(dead){
        const TILEpx=MM.TILE||20;
        for(let s=0;s<3 && debris.length<CFG.DEBRIS_CAP;s++){
          debris.push({x:pr.x*TILEpx, y:pr.y*TILEpx, vx:(Math.random()-0.5)*90, vy:-30-Math.random()*60,
                       c:pr.color, t:0, max:0.5+Math.random()*0.5, s:3+Math.random()*4});
        }
        projectiles.splice(i,1);
      }
    }
    const TILE=MM.TILE||20;
    for(let i=debris.length-1;i>=0;i--){
      const d=debris[i];
      d.t+=dt; d.vy+=CFG.GRAV*TILE*0.55*dt; applyWindToDebris(d,getTile,dt,TILE); d.x+=d.vx*dt; d.y+=d.vy*dt;
      if(d.t>d.max || d.y>WORLD_H*TILE) debris.splice(i,1);
    }
    for(let i=blasts.length-1;i>=0;i--){ blasts[i].t+=dt; if(blasts[i].t>blasts[i].max) blasts.splice(i,1); }
  }

  // ---------------- Rendering (world space) ----------------
  // Per-part articulation offset (pixels). Limbs swing with the walk cycle / sway;
  // the trunk only breathes. Offsets are visual only — collision uses the lattice.
  // Returns a shared scratch object (valid until the next call) to avoid allocating
  // per part per frame; callers must consume ox/oy before calling again.
  const LIMB_OFF={ox:0,oy:0};
  function limbOffset(m,p,now){
    const o=LIMB_OFF;
    const walk=clamp(Math.abs(m.vx)/((m.speed||1)*1.4),0,1);
    if(p.role==='leg'){
      const ph=m.gait + p.limbP + (p.dx<0?0:Math.PI);          // legs alternate L/R
      o.ox=Math.sin(ph)*2.6*(0.25+walk); o.oy=-Math.max(0,Math.sin(ph))*1.6*walk;
    } else if(p.role==='arm'){
      const ph=m.gait*0.9 + p.limbP + Math.PI;                 // arms counter-swing
      o.ox=Math.sin(ph)*3.0*(0.4+walk)+m.dir*0.5; o.oy=Math.cos(ph)*1.3;
    } else if(p.role==='tentacle'){
      const ph=now*0.004 + p.limbP + p.dx*0.5;                 // slow travelling dangle
      o.ox=Math.sin(ph)*3.5; o.oy=Math.sin(ph*0.6)*1.5+1.0;
    } else {
      o.ox=0; o.oy=Math.sin(now*0.0024 + (p.limbP||0))*0.5;    // trunk breathing
    }
    return o;
  }
  function tileVisible(canDrawTile,x,y){ return typeof canDrawTile !== 'function' || canDrawTile(Math.floor(x),Math.floor(y)); }
  function monsterVisible(canDrawTile,m){
    if(typeof canDrawTile !== 'function') return true;
    for(const p of m.parts){ if(tileVisible(canDrawTile,m.x+p.dx,m.y+p.dy)) return true; }
    return false;
  }
  function draw(ctx,TILE,canDrawTile){
    if(!monsters.length && !debris.length && !blasts.length && !projectiles.length) return;
    const now=(typeof performance!=='undefined')? performance.now() : 0;
    for(const m of monsters){
      if(!monsterVisible(canDrawTile,m)) continue;
      // true fractional position — rendering at Math.round() made the whole beast
      // hop a full tile at a time even though the physics moves continuously.
      // A shaking beast judders sideways to telegraph "get off my back".
      const bx=m.x + (m.shakeT>0? Math.sin(now*0.055)*0.18 : 0), by=m.y;
      const wob=(m.archetype==='floater'||m.archetype==='swimmer')? Math.sin(now*0.002+m.bobP)*2 : 0;
      const enraged=m.core.hp<m.core.maxHp*0.5;
      const occ=m.occ;   // occupancy lattice kept fresh by refreshStructure()
      // feeding cue: pulse the morsel being eaten (world space, untilted)
      if(m.state==='feed' && m.feed && tileVisible(canDrawTile,m.feed.tx,m.feed.ty)){
        const fx=m.feed.tx*TILE, fy=m.feed.ty*TILE, pul=0.4+0.3*Math.sin(now*0.012);
        ctx.strokeStyle='rgba(255,255,255,'+pul.toFixed(2)+')'; ctx.lineWidth=2;
        ctx.strokeRect(fx+1,fy+1,TILE-2,TILE-2);
      }
      // lean the whole beast about its feet according to its balance
      ctx.save();
      const pivX=(bx+(m.minDx+m.maxDx)/2+0.5)*TILE, pivY=(by+1)*TILE+wob;
      if(m.tilt){ ctx.translate(pivX,pivY); ctx.rotate(m.tilt); ctx.translate(-pivX,-pivY); }
      for(const p of m.parts){
        const off=limbOffset(m,p,now);
        const X=(bx+p.dx)*TILE+off.ox, Y=(by+p.dy)*TILE+wob+off.oy;
        const dmgF=1-p.hp/p.maxHp;
        if(p.role==='core'){
          const pulse=0.5+0.5*Math.sin(now*0.006);
          const g=ctx.createRadialGradient(X+TILE/2,Y+TILE/2,1,X+TILE/2,Y+TILE/2,TILE*(1.1+pulse*0.5));
          g.addColorStop(0,'rgba(255,70,100,'+(0.5+pulse*0.3)+')'); g.addColorStop(1,'rgba(255,70,100,0)');
          ctx.fillStyle=g; ctx.fillRect(X-TILE,Y-TILE,TILE*3,TILE*3);
          ctx.fillStyle=enraged? '#ff1840':'#ff3b5c';
        } else if(p.role==='eye'){
          ctx.fillStyle='#fff';
        } else ctx.fillStyle=p.color;
        // full-tile fill so adjacent blocks fuse into one body (no spacing gaps)
        ctx.fillRect(X,Y,TILE,TILE);
        if(p.role!=='core' && p.role!=='eye'){
          // block shading like the world tiles: top highlight, bottom shadow
          ctx.fillStyle='rgba(255,255,255,0.12)'; ctx.fillRect(X,Y,TILE,Math.max(2,TILE*0.22));
          ctx.fillStyle='rgba(0,0,0,0.16)'; ctx.fillRect(X,Y+TILE-Math.max(2,TILE*0.18),TILE,Math.max(2,TILE*0.18));
        }
        if(p.role==='eye'){ ctx.fillStyle=enraged?'#f00':'#111'; ctx.fillRect(X+TILE/2-2+m.dir*3, Y+TILE/2-2, 5, 5); }
        if(p.hitT>0){ ctx.fillStyle='rgba(255,255,255,'+(p.hitT*3).toFixed(2)+')'; ctx.fillRect(X,Y,TILE,TILE); }
        if(p.healT>0){ ctx.fillStyle='rgba(110,255,140,'+(p.healT*0.9).toFixed(2)+')'; ctx.fillRect(X,Y,TILE,TILE); } // knitting flesh glows green
        if(dmgF>0.25){ // cracks deepen as the part weakens
          ctx.strokeStyle='rgba(0,0,0,'+(0.25+dmgF*0.4).toFixed(2)+')'; ctx.lineWidth=1;
          ctx.beginPath(); ctx.moveTo(X+3,Y+TILE*0.3); ctx.lineTo(X+TILE*0.6,Y+TILE*0.55); ctx.lineTo(X+TILE*0.4,Y+TILE-3); ctx.stroke();
        }
      }
      // crisp silhouette: outline only the edges with no body neighbour, so the
      // creature reads as one fused mass of blocks rather than a grid of tiles.
      // All edges accumulate into one path → a single stroke per monster.
      ctx.strokeStyle='rgba(0,0,0,0.4)'; ctx.lineWidth=1;
      ctx.beginPath();
      for(const p of m.parts){
        const off=limbOffset(m,p,now);
        const X=(bx+p.dx)*TILE+off.ox, Y=(by+p.dy)*TILE+wob+off.oy;
        if(!occ.has(p.dx+','+(p.dy-1))){ ctx.moveTo(X,Y+0.5); ctx.lineTo(X+TILE,Y+0.5); }
        if(!occ.has(p.dx+','+(p.dy+1))){ ctx.moveTo(X,Y+TILE-0.5); ctx.lineTo(X+TILE,Y+TILE-0.5); }
        if(!occ.has((p.dx-1)+','+p.dy)){ ctx.moveTo(X+0.5,Y); ctx.lineTo(X+0.5,Y+TILE); }
        if(!occ.has((p.dx+1)+','+p.dy)){ ctx.moveTo(X+TILE-0.5,Y); ctx.lineTo(X+TILE-0.5,Y+TILE); }
      }
      ctx.stroke();
      ctx.restore();
      // health bar over the beast (total structural integrity) — drawn upright
      let hp=0,maxHp=0; for(const p of m.parts){ hp+=p.hp; maxHp+=p.maxHp; }
      const barW=(m.maxDx-m.minDx+1)*TILE*0.8;
      const barX=(bx+(m.minDx+m.maxDx)/2)*TILE+TILE/2-barW/2, barY=(by-m.height)*TILE-8+wob;
      ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(barX,barY,barW,4);
      ctx.fillStyle=enraged?'#ff4040':'#7fdc5a'; ctx.fillRect(barX,barY,barW*clamp(hp/maxHp,0,1),4);
      // a sated, growing beast shows a green feeding pip on its bar
      if(m.state==='feed'){ ctx.fillStyle='#9fe85a'; ctx.fillRect(barX-5,barY-1,4,6); }
    }
    // hurled blocks: spinning tiles of the material that was ripped out
    for(const pr of projectiles){
      if(!tileVisible(canDrawTile,pr.x,pr.y)) continue;
      ctx.save();
      ctx.translate(pr.x*TILE, pr.y*TILE); ctx.rotate(pr.spin);
      const s=TILE*0.7;
      ctx.fillStyle=pr.color; ctx.fillRect(-s/2,-s/2,s,s);
      ctx.strokeStyle='rgba(0,0,0,0.4)'; ctx.lineWidth=1; ctx.strokeRect(-s/2,-s/2,s,s);
      ctx.restore();
    }
    for(const d of debris){
      if(!tileVisible(canDrawTile,d.x/TILE,d.y/TILE)) continue;
      ctx.fillStyle=d.c; ctx.globalAlpha=clamp(1-d.t/d.max,0,1);
      ctx.fillRect(d.x-d.s/2,d.y-d.s/2,d.s,d.s);
      ctx.globalAlpha=1;
    }
    for(const b of blasts){
      if(!tileVisible(canDrawTile,b.x/TILE,b.y/TILE)) continue;
      const f=b.t/b.max;
      const r=b.R*(0.3+f*0.9);
      ctx.strokeStyle='rgba(255,200,120,'+(0.8*(1-f)).toFixed(2)+')'; ctx.lineWidth=4*(1-f)+1;
      ctx.beginPath(); ctx.arc(b.x,b.y,r,0,Math.PI*2); ctx.stroke();
      const g=ctx.createRadialGradient(b.x,b.y,1,b.x,b.y,r);
      g.addColorStop(0,'rgba(255,240,200,'+(0.45*(1-f)).toFixed(2)+')'); g.addColorStop(1,'rgba(255,150,60,0)');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(b.x,b.y,r,0,Math.PI*2); ctx.fill();
    }
  }
  // Screen-space hint: an edge arrow pointing at the nearest off-screen monster,
  // so "a monster appeared" is always findable without a minimap.
  function drawHUD(ctx,W,H,camX,camY,zoom,TILE,canDrawTile){
    if(!monsters.length) return;
    const p=playerRef(); if(!p) return;
    let best=null,bd=1e9;
    for(const m of monsters){ if(!monsterVisible(canDrawTile,m)) continue; const d=Math.abs(m.x-p.x); if(d<bd){ bd=d; best=m; } }
    if(!best) return;
    const sxp=(best.x-camX)*TILE*zoom, syp=(best.y-best.height/2-camY)*TILE*zoom;
    if(sxp>40 && sxp<W-40 && syp>40 && syp<H-40) return; // on screen: no arrow needed
    const cx=W/2, cy=H/2;
    const ang=Math.atan2(syp-cy, sxp-cx);
    const ex=cx+Math.cos(ang)*(Math.min(W,H)/2-46), ey=cy+Math.sin(ang)*(Math.min(W,H)/2-46);
    const pulse=0.6+0.4*Math.sin(((typeof performance!=='undefined')?performance.now():0)*0.005);
    ctx.save();
    ctx.translate(ex,ey); ctx.rotate(ang);
    ctx.fillStyle='rgba(255,60,80,'+pulse.toFixed(2)+')';
    ctx.beginPath(); ctx.moveTo(14,0); ctx.lineTo(-8,-9); ctx.lineTo(-8,9); ctx.closePath(); ctx.fill();
    ctx.rotate(-ang);
    ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.fillRect(-26,14,52,16);
    ctx.fillStyle='#fff'; ctx.font='11px system-ui'; ctx.textAlign='center';
    ctx.fillText(Math.round(bd)+'m', 0, 26);
    ctx.restore();
  }

  // ---------------- Lifecycle / introspection ----------------
  function clearAll(){ monsters=[]; debris.length=0; blasts.length=0; projectiles.length=0; }
  function reset(){
    clearAll();
    lastIsDay=null; spawnTimer=CFG.INITIAL_DELAY;
    spawnedTotal=0; killedTotal=0;
  }
  function metrics(){
    let parts=0; for(const m of monsters) parts+=m.parts.length;
    return {alive:monsters.length, parts, debris:debris.length, projectiles:projectiles.length,
            spawned:spawnedTotal, killed:killedTotal,
            nextIn:(spawnTimer>0 && isFinite(spawnTimer))? spawnTimer : null};
  }
  function setCycleOverride(o){
    if(o===null || o===undefined){ cycleOverride=null; return; }
    if(typeof o==='object' && typeof o.isDay==='boolean') cycleOverride=o;
  }
  function _debug(){ return {monsters, debris, blasts, projectiles, spawnTimer, lastIsDay}; }

  MM.bosses={update, draw, drawHUD, attackAt, damageAt, forceSpawn, killNearest, collideHero, clearAll, reset, metrics,
             nearestForAbduction, nearestForTurret, targetsForTurret, abduct, setCycleOverride, config:CFG, _debug};
})();
// ESM export (progressive migration)
export const bosses = (typeof window!=='undefined' && window.MM) ? window.MM.bosses : undefined;
export default bosses;
