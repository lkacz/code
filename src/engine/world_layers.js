// Procedural vertical layer model for generated sections above and below the
// legacy surface band. This keeps sky/deep material choices in one place so the
// world can evolve toward smooth layer blending instead of separate hard modes.
import { WORLD_H, WORLD_MAX_Y, T } from '../constants.js';

function clamp01(v){ return Math.max(0, Math.min(1, Number(v)||0)); }
function safeRand(WG,v){
  if(WG && typeof WG.randSeed === 'function') return WG.randSeed(v);
  const s=Math.sin(Number(v)||0)*43758.5453123;
  return s-Math.floor(s);
}
function safeNoise(WG,x,scale,seed){
  if(WG && typeof WG.valueNoise === 'function') return WG.valueNoise(x,scale,seed);
  return safeRand(WG,(Math.floor((Number(x)||0)/Math.max(1,scale))*928371)+seed*131.7);
}

function fade(t){ return t*t*(3-2*t); }
function safeNoise2D(WG,x,y,sx,sy,seed){
  sx=Math.max(1,Number(sx)||1);
  sy=Math.max(1,Number(sy)||1);
  const px=(Number(x)||0)/sx, py=(Number(y)||0)/sy;
  const ix=Math.floor(px), iy=Math.floor(py);
  const fx=fade(px-ix), fy=fade(py-iy);
  const h=(gx,gy)=>safeRand(WG,gx*374761.393 + gy*668265.263 + seed*127.413);
  const a=h(ix,iy), b=h(ix+1,iy), c=h(ix,iy+1), d=h(ix+1,iy+1);
  const ab=a+(b-a)*fx;
  const cd=c+(d-c)*fx;
  return ab+(cd-ab)*fy;
}
function fbm2D(WG,x,y,sx,sy,oct,seed){
  let amp=1, sum=0, norm=0, wx=sx, wy=sy, off=seed;
  for(let i=0; i<oct; i++){
    sum += amp*safeNoise2D(WG,x,y,wx,wy,off);
    norm += amp;
    amp *= 0.55;
    wx /= 1.92;
    wy /= 1.92;
    off += 101;
  }
  return norm>0 ? sum/norm : 0;
}

function ridgeNoise(WG,wx,y,scale,seed){
  return 1-Math.abs(safeNoise(WG,wx+y*0.37,scale,seed)*2-1);
}

function finiteNumber(v,fallback){
  const n=Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeColumn(WG,wx){
  try{
    if(WG && typeof WG.column === 'function') return WG.column(Math.round(wx)) || null;
  }catch(e){}
  return null;
}

function safeClimate(WG,fn,wx,fallback){
  try{
    if(WG && typeof WG[fn] === 'function') return clamp01(WG[fn](Math.round(wx)));
  }catch(e){}
  return fallback;
}

function safeVolcanoBody(WG,wx){
  try{
    if(WG && typeof WG.volcanoInfluenceAt === 'function') return WG.volcanoInfluenceAt(Math.round(wx), 48);
  }catch(e){}
  const col=safeColumn(WG,wx);
  return (col && col.volcano) || null;
}

function safeAquifer(WG,wx){
  try{
    if(WG && typeof WG.aquiferAt === 'function') return WG.aquiferAt(Math.round(wx));
  }catch(e){}
  return null;
}

function safeCoalVein(WG,wx,y){
  try{
    if(WG && typeof WG.coalVeinAt === 'function') return !!WG.coalVeinAt(Math.round(wx), y, false);
  }catch(e){}
  return false;
}

export function columnProfile(WG,wx){
  const ix=Math.round(finiteNumber(wx,0));
  const c=safeColumn(WG,ix);
  let surface=64;
  if(c && Number.isFinite(c.row)) surface=c.row;
  else {
    try{
      if(WG && typeof WG.surfaceHeight === 'function') surface=WG.surfaceHeight(ix);
    }catch(e){}
  }
  const biome=c && Number.isFinite(c.biome) ? (c.biome|0) : 0;
  const temperature=clamp01(c ? finiteNumber(c.t,0.5) : safeClimate(WG,'temperature',ix,0.5));
  const moisture=clamp01(c ? finiteNumber(c.m,0.5) : safeClimate(WG,'moisture',ix,0.5));
  const continental=clamp01(c ? finiteNumber(c.cont,0.5) : 0.5);
  const erosion=clamp01(c ? finiteNumber(c.ero,0.5) : 0.5);
  const peak=clamp01(c ? finiteNumber(c.pv,0) : 0);
  const mountain=clamp01(Math.max(
    biome===7 ? 0.74 : 0,
    c ? finiteNumber(c.mountainMask,0) : 0,
    c ? Math.max(0,finiteNumber(c.elev,0)-18)/34 : 0
  ));
  const volcanic=c && c.volcano ? 1 : 0;
  const city=clamp01(c && c.city ? Math.max(0.20,finiteNumber(c.city.core,0)) : 0);
  const ocean=clamp01(biome===5 ? 1 : (biome===6 ? 0.42 : (c ? Math.max(0,0.30-continental)/0.30 : 0)));
  const lake=biome===6 ? 1 : 0;
  const desert=biome===3 ? 1 : 0;
  const snow=biome===2 ? 1 : 0;
  const swamp=biome===4 ? 1 : 0;
  const island=c && c.island ? 1 : 0;
  const beach=c && c.beach ? 1 : 0;
  const valley=clamp01(c ? finiteNumber(c.valleyDepth,0)/34 : 0);
  const ravine=clamp01(c ? finiteNumber(c.ravine,0) : 0);
  const skySignal=safeNoise(WG,ix,960,7341);
  const deepSignal=safeNoise(WG,ix,740,7342);
  const crystalSignal=safeNoise(WG,ix,520,7343);
  const skyFlux=clamp01(0.30 + skySignal*0.20 + mountain*0.20 + volcanic*0.18 + city*0.14 + desert*0.08 + island*0.08 - ocean*0.08 - moisture*0.04);
  const crystalBias=clamp01(0.34 + crystalSignal*0.22 + mountain*0.20 + city*0.16 + snow*0.12 + ocean*0.10 + (1-moisture)*0.08);
  const basaltBias=clamp01(0.24 + volcanic*0.36 + mountain*0.18 + temperature*0.12 + peak*0.10 - ocean*0.07);
  const deepFracture=clamp01(0.22 + deepSignal*0.18 + ravine*0.26 + valley*0.16 + mountain*0.13 + city*0.10 + volcanic*0.10 - lake*0.04);
  return {
    biome,
    surface:Math.round(finiteNumber(surface,64)),
    temperature,
    moisture,
    continental,
    erosion,
    peak,
    mountain,
    volcanic,
    city,
    ocean,
    lake,
    desert,
    snow,
    swamp,
    island,
    beach,
    valley,
    ravine,
    skyFlux,
    crystalBias,
    basaltBias,
    deepFracture
  };
}

export function layerEnvelope(WG,wx,y){
  const profile=columnProfile(WG,wx);
  const surface=profile.surface;
  const skyDepth=Math.max(0,-y);
  const deepDepth=Math.max(0,y-WORLD_H);
  const surfaceDelta=y-surface;
  return {
    profile,
    surface,
    sky:clamp01(skyDepth/120),
    lowSky:clamp01((70+y)/70),
    highSky:clamp01((-70-y)/70),
    surfaceBand:clamp01(1-Math.abs(surfaceDelta)/28),
    upperCrust:clamp01(1-deepDepth/42),
    deep:clamp01(deepDepth/120),
    mantle:clamp01((deepDepth-38)/78),
    core:clamp01((deepDepth-96)/42),
    biome:profile.biome,
    temperature:profile.temperature,
    moisture:profile.moisture,
    mountain:profile.mountain,
    volcanic:profile.volcanic,
    city:profile.city,
    ocean:profile.ocean,
    lake:profile.lake,
    desert:profile.desert,
    snow:profile.snow,
    swamp:profile.swamp,
    island:profile.island,
    beach:profile.beach,
    valley:profile.valley,
    ravine:profile.ravine,
    skyFlux:profile.skyFlux,
    crystalBias:profile.crystalBias,
    basaltBias:profile.basaltBias,
    deepFracture:profile.deepFracture
  };
}

function geologyMix(WG,wx,y,primary,secondary,seed,amount){
  return safeNoise(WG,wx+y*0.23,18,seed)<clamp01(amount) ? primary : secondary;
}

export function midLowContactY(WG,wx){
  const env=columnProfile(WG,wx);
  const broad=(fbm2D(WG,wx,0,190,1,3,7471)-0.5)*30;
  const shelf=(safeNoise(WG,wx,61,7472)-0.5)*10;
  const fold=Math.sin(wx*0.016 + safeNoise(WG,wx,360,7473)*6.28318)*6;
  const context=env.ravine*9 + env.valley*5 + env.volcanic*4 + env.city*3 - env.ocean*4 - env.mountain*3;
  return Math.round(WORLD_H + broad + shelf + fold + context);
}

function lowerContactBlend(WG,wx,y){
  const contact=midLowContactY(WG,wx);
  const warp=(fbm2D(WG,wx,y,34,18,2,7474)-0.5)*11 + (safeNoise(WG,wx+y*0.13,17,7475)-0.5)*5;
  return clamp01((y + warp - (contact - 12))/24);
}

function lowerWorldDominatesContact(WG,wx,y){
  const p=lowerContactBlend(WG,wx,y);
  if(p<=0) return false;
  if(p>=1) return true;
  // Coherent interfingering tongues along the contact instead of per-tile static
  const tongue=fbm2D(WG,wx,y,27,13,2,7476);
  return tongue < 0.18 + p*0.64;
}

export function legacyGeologyLayerDepth(WG,wx,y,depth,biome){
  const long=(safeNoise(WG,wx,92,4607)-0.5)*18;
  const fold=Math.sin(wx*0.021 + safeNoise(WG,wx,180,4608)*6.28318)*5;
  const shear=(safeNoise(WG,wx+y*0.16,38,4609)-0.5)*8;
  const mountain=biome===7 ? 7 : 0;
  return depth + Math.max(0,y-72)*0.45 + long + fold + shear + mountain;
}

export function volcanoRootProfile(WG,wx,y){
  const col=safeColumn(WG,wx);
  const v=safeVolcanoBody(WG,wx);
  if(!v) return {active:false};
  const surface=col && Number.isFinite(col.row) ? col.row : 64;
  if(y<surface) return {active:false};
  const sub=Math.max(0,y-surface);                 // depth under this column's surface
  const rootDepth=Math.max(0,y-WORLD_H);           // depth into the low world
  const endFade=clamp01(1-Math.max(0,rootDepth-112)/30);
  const dx=wx-v.center;
  const bend=(safeNoise(WG,y+v.center*0.17,54,7461)-0.5)*(2.4+rootDepth*0.045);
  const ad=Math.abs(dx-bend);
  const pipeRadius=Math.max(1.25,(v.pipe||1)+1.15-rootDepth*0.010);
  const chamberY=WORLD_H + 54 + safeNoise(WG,v.center,180,7462)*26;
  const chamberHalf=12 + Math.max(4,(v.reservoir||5)*0.42);
  const chamberT=clamp01(1-Math.abs(y-chamberY)/chamberHalf);
  const chamberRadius=(v.reservoir||5) + 5 + rootDepth*0.055;
  const rootRadius=Math.max((v.radius||18)*0.34, chamberRadius*0.72) + rootDepth*0.055;
  const influence=clamp01(1-ad/Math.max(1,rootRadius+chamberT*chamberRadius))*endFade;
  const core=ad<=pipeRadius && rootDepth<122 && endFade>0;
  const chamber=chamberT>0 && ad<chamberRadius*(0.35+chamberT*0.65) && endFade>0.12;
  // Dikes flare continuously from just below the vent, through the mid/low
  // contact, down to the terminal fade — one formula, no per-band restart.
  const dikeA=Math.abs(dx + sub*0.115 + bend*0.55);
  const dikeB=Math.abs(dx - sub*0.13 - bend*0.50);
  const ring=Math.abs(ad-(pipeRadius+2.2+sub*0.028));
  const dike=(sub>9 && rootDepth<124 && endFade>0.05 && (dikeA<0.95 || dikeB<0.95 || ring<0.80));
  const lava=(core && (rootDepth<96 || safeNoise(WG,wx+y*0.11,23,7463)>0.34)) || (chamber && chamberT>0.46 && safeNoise(WG,wx-y*0.13,31,7464)>0.38);
  return {active:influence>0.02 || core || chamber || dike, col, volcano:v, sub, rootDepth, endFade, influence, core, chamber, chamberT, dike, lava};
}

// Volcanic contact aureole: baked country rock, basaltic intrusion lobes and
// quench obsidian wrap the conduit in a warped, noise-dissolved thermal jacket.
// The jacket bends with depth, dissolves into ordinary geology before the cone
// edge, and fades out before the deep root zone takes over — no straight box
// edges and no material family swap at WORLD_H or any other fixed row.
export function volcanoAureoleTile(WG,col,wx,y,ground,depth){
  const v=col && col.volcano;
  if(!v || y<ground) return undefined;
  const rawD=Math.abs(wx-v.center);
  if(rawD<=(v.pipe||1)+2) return safeRand(WG,wx*3.91+y*0.27)<0.30 ? T.OBSIDIAN : T.BASALT;
  if(y<WORLD_H-18){
    const root=volcanoRootProfile(WG,wx,y);
    if(root.active && root.dike) return safeRand(WG,wx*9.11+y*0.53)<0.18 ? T.OBSIDIAN : T.BASALT;
  }
  const sway=(safeNoise(WG,y+v.center*0.31,47,4524)-0.5)*(2.6+depth*0.07);
  const d=Math.abs(wx-v.center-sway);
  const outer=Math.max(6,(v.radius||18)-1.5);
  const r=safeRand(WG,wx*3.91+y*0.27);
  if(depth<12){
    if(d>outer+5) return undefined;
    if(d<=(v.crater||2)+3 || safeRand(WG,wx*4.73+y*0.19)<0.16) return T.OBSIDIAN;
    return r<0.58 ? T.BASALT : T.STONE;
  }
  const depthFade=clamp01(1-Math.max(0,depth-40)/52);
  const shell=clamp01(1-d/outer)*depthFade;
  if(shell<=0) return undefined;
  const dissolve=fbm2D(WG,wx,y,24,15,2,4526);
  if(dissolve>0.34+shell*0.55) return undefined;
  const heat=clamp01(1-d/Math.max(1,(v.pipe||1)+4+depth*0.10));
  if(heat>0.40 || d<=(v.reservoir||5)+3) return r<0.76 ? T.BASALT : T.OBSIDIAN;
  if(shell>0.30) return r<0.44 ? T.BASALT : (r<0.62 ? T.GRANITE : T.STONE);
  return r<0.30 ? T.BASALT : (r<0.52 ? T.GRANITE : undefined);
}

function legacyGeologyRockCoreTile(WG,wx,y,depth,biome){
  const deep=legacyGeologyLayerDepth(WG,wx,y,depth,biome);
  const band=safeNoise(WG,wx+y*0.11,64,4601);
  const lens=safeNoise(WG,wx-y*0.18,27,4602);
  const fleck=safeRand(WG,wx*5.13+y*0.41);
  const graniteCut=27 + (band-0.5)*12 + (biome===7 ? -6 : 0);
  const basaltCut=54 + (safeNoise(WG,wx+y*0.07,78,4603)-0.5)*16 + (lens>0.78 ? -8 : 0);
  const bedrockCut=80 + (safeNoise(WG,wx-y*0.05,110,4604)-0.5)*12;
  const bottomBlend=clamp01((y-(WORLD_H-18))/18);
  if(y>=WORLD_H-8 || deep>bedrockCut) return fleck<0.18+bottomBlend*0.18 ? T.GRANITE : T.BASALT;
  if(deep>bedrockCut-6) return geologyMix(WG,wx,y,T.BASALT,T.GRANITE,4610,0.10 + ((deep-(bedrockCut-6))/6)*0.78);
  if(deep>basaltCut) return (lens>0.68 || fleck<0.74) ? T.BASALT : T.GRANITE;
  if(deep>basaltCut-7) return geologyMix(WG,wx,y,T.BASALT,T.GRANITE,4611,0.12 + ((deep-(basaltCut-7))/7)*0.78);
  if(deep>graniteCut) return lens>0.76 ? T.BASALT : (band>0.43 || fleck<0.58 ? T.GRANITE : T.STONE);
  if(deep>graniteCut-5) return geologyMix(WG,wx,y,T.GRANITE,T.STONE,4612,0.10 + ((deep-(graniteCut-5))/5)*0.76);
  if(lens>0.82 && depth>16) return T.GRANITE;
  return fleck<0.055 ? T.GRANITE : T.STONE;
}

export function legacyGeologyRockTile(WG,wx,y,depth,biome){
  const root=volcanoRootProfile(WG,wx,y);
  if(root.active && y>=WORLD_H-18){
    if(root.lava) return T.LAVA;
    if(root.core || root.chamber) return safeRand(WG,wx*7.31+y*0.53)<0.36 ? T.OBSIDIAN : T.BASALT;
    if(root.dike || root.influence>0.45) return safeRand(WG,wx*4.77+y*0.41)<0.72 ? T.BASALT : T.GRANITE;
  }
  if(y>=WORLD_H-34 && lowerWorldDominatesContact(WG,wx,y)){
    const contact=midLowContactY(WG,wx);
    const mappedY=WORLD_H + Math.max(0, Math.round(y-contact+8));
    return deepRockMaterialTile(WG,wx,mappedY);
  }
  return legacyGeologyRockCoreTile(WG,wx,y,depth,biome);
}

export function skyLayerConfig(sy){
  const high=sy<=-2;
  return {
    high,
    spacing:high?96:78,
    baseY:high?-108:-38,
    gate:high?0.42:0.34,
    rx0:high?22:18,
    rxJ:high?34:30,
    thick0:high?9:7,
    thickJ:high?15:12,
    crown0:high?4:3,
    crownJ:high?10:8
  };
}

export function skyCellTraits(WG,cell,sy,cfg){
  const c=cfg || skyLayerConfig(sy);
  const roughCenter=(cell+0.5)*c.spacing;
  const profile=columnProfile(WG,roughCenter);
  const high=c.high ? 1 : 0;
  const gate=clamp01(c.gate - profile.skyFlux*0.16 - profile.mountain*0.08 - profile.volcanic*0.06 - profile.city*0.05 + profile.ocean*0.10 + profile.swamp*0.03);
  const mass=clamp01(0.44 + profile.skyFlux*0.30 + profile.crystalBias*0.14 + profile.mountain*0.12 + profile.volcanic*0.08 + profile.city*0.07 - profile.ocean*0.09);
  const spread=clamp01(0.42 + profile.crystalBias*0.20 + profile.ocean*0.18 + profile.island*0.08 + profile.city*0.06 - profile.mountain*0.05);
  const keel=clamp01(0.34 + profile.basaltBias*0.32 + profile.mountain*0.18 + profile.volcanic*0.18 - profile.ocean*0.10);
  const crown=clamp01(0.36 + profile.crystalBias*0.24 + profile.snow*0.12 + profile.city*0.10 + high*0.06);
  const lift=profile.mountain*8 + profile.volcanic*10 + profile.city*4 - profile.ocean*5 - profile.swamp*2;
  const jag=clamp01(0.24 + profile.mountain*0.22 + profile.volcanic*0.18 + profile.skyFlux*0.12 - profile.ocean*0.07);
  return {profile, roughCenter, gate, mass, spread, keel, crown, lift, jag};
}

export function skyIslandDescriptor(WG,cell,sy,cfg){
  cfg=cfg || skyLayerConfig(sy);
  const traits=skyCellTraits(WG,cell,sy,cfg);
  const gate=safeRand(WG,cell*17.13 + sy*101.7);
  if(gate<traits.gate) return null;
  const spacing=cfg.spacing;
  const center=(cell+0.5)*spacing + (safeRand(WG,cell*19.31+sy*67.9)-0.5)*spacing*0.46;
  const profile=columnProfile(WG,center);
  const cy=cfg.baseY - traits.lift + (safeRand(WG,cell*23.73+sy*29.1)-0.5)*(cfg.high?28:24);
  const rx=(cfg.rx0 + safeRand(WG,cell*31.41+sy*13.7)*cfg.rxJ) * (0.84 + traits.mass*0.24 + traits.spread*0.20 + profile.ocean*0.10);
  const thickness=(cfg.thick0 + safeRand(WG,cell*37.17+sy*43.3)*cfg.thickJ) * (0.78 + traits.mass*0.30 + traits.keel*0.18 - profile.ocean*0.10);
  const crown=(cfg.crown0 + safeRand(WG,cell*41.91+sy*11.9)*cfg.crownJ) * (0.80 + traits.crown*0.32 + profile.mountain*0.10);
  return {cell,center,cy,rx,thickness,crown,traits,profile};
}

export function skyIslandBody(WG,wx,y,sy){
  const cfg=skyLayerConfig(sy);
  const cell=Math.floor(wx/cfg.spacing);
  let best=null;
  for(let dc=-1; dc<=1; dc++){
    const d=skyIslandDescriptor(WG,cell+dc,sy,cfg);
    if(!d) continue;
    const nx=(wx-d.center)/Math.max(1,d.rx);
    if(Math.abs(nx)>1) continue;
    const cap=Math.max(0,1-nx*nx);
    const edge=Math.pow(cap,0.54);
    const crown=Math.pow(cap,0.78);
    const jag=0.75 + (d.traits ? d.traits.jag*0.75 : 0.25);
    const serr=((safeNoise(WG,wx,11,7211+sy*31+d.cell*3)-0.5)*3.1 + (safeNoise(WG,wx,29,7212+sy*37+d.cell*5)-0.5)*2.2) * jag;
    const top=Math.round(d.cy - d.crown*crown + serr);
    const bottom=Math.round(d.cy + d.thickness*edge + Math.abs(nx)*5 + (safeNoise(WG,wx,17,7213+sy*41+d.cell*7)-0.5)*4);
    if(y<top || y>bottom) continue;
    const depth=(y-top)/Math.max(1,bottom-top);
    const core=(1-Math.abs(depth-0.55)*1.6)*edge;
    if(!best || core>best.core) best={desc:d,top,bottom,core,depth,nx,cfg};
  }
  return best;
}

export function skyRibbonTile(WG,wx,y,sy){
  const high=sy<=-2;
  const env=layerEnvelope(WG,wx,y);
  const center=(high?-127:-62) + (safeNoise(WG,wx,210,7241+sy*19)-0.5)*22 + (safeNoise(WG,wx,46,7242+sy*23)-0.5)*5;
  const density=safeNoise(WG,wx,118,7243+sy*29);
  const groundFade=y>-10 ? clamp01((-y)/10) : 1;
  if(density<0.63+(1-groundFade)*0.18-env.skyFlux*0.05+env.ocean*0.02) return T.AIR;
  const dy=Math.abs(y-center);
  if(dy>(density>0.82?1.8:0.85)) return T.AIR;
  const fleck=safeRand(WG,wx*3.19+y*0.41+sy*171.3);
  if(fleck<0.040+env.highSky*0.035+env.crystalBias*0.034) return T.IRIDIUM;
  if(fleck<0.16+env.sky*0.02+env.skyFlux*0.060) return T.METEOR_DUST;
  return T.GLASS;
}

export function skyTransitionTile(WG,wx,y){
  if(y<-28 || y>=0) return T.AIR;
  const env=layerEnvelope(WG,wx,y);
  const lift=clamp01((-y)/28);
  const veil=safeNoise(WG,wx+y*0.17,72,7261) + ridgeNoise(WG,wx,y,23,7262)*0.55;
  if(veil<1.15+lift*0.18-env.skyFlux*0.08+env.ocean*0.035+env.swamp*0.018) return T.AIR;
  const fleck=safeRand(WG,wx*4.91+y*2.67+7263);
  if(fleck<(0.006+env.crystalBias*0.010)*lift) return T.IRIDIUM;
  if(fleck<(0.018+env.crystalBias*0.022)*lift) return T.GLASS;
  if(fleck<0.38+env.lowSky*0.10+env.skyFlux*0.16) return T.METEOR_DUST;
  return T.AIR;
}

export function skyRelicTile(WG,body,wx,y,fleck,shellTop,shellBottom){
  if(!body || shellBottom) return null;
  const local=Math.abs(wx-body.desc.center)/Math.max(1,body.desc.rx);
  const crownCrest=shellTop && body.depth<0.22 && local<0.62;
  const innerCrest=body.core>0.58 && local<0.62;
  if(crownCrest){
    const nest=safeRand(WG,Math.floor(body.desc.cell)*53.17 + body.cfg.high*19.3 + body.desc.rx*0.07);
    const line=Math.abs(Math.sin((wx-body.desc.center)*0.43 + nest*6.283));
    const roll=safeRand(WG,wx*9.73+y*1.37+body.desc.cell*5.11+body.cfg.high*71.3);
    if(line<0.28 && roll<(body.cfg.high?0.070:0.046)) return T.SOLAR_PANEL;
    if(local<0.22 && roll>0.955) return T.SOLAR_BATTERY;
    if(body.cfg.high && local<0.16 && roll>0.925 && roll<=0.955) return T.SPRING_PLATFORM;
  }
  if(!shellTop && innerCrest && body.depth>0.16 && body.depth<0.36){
    const roll=safeRand(WG,wx*6.91+y*2.21+body.desc.cell*13.7);
    if(roll>0.982) return T.SOLAR_BATTERY;
    if(roll>0.964 && body.cfg.high) return T.ANTIGRAVITY_BEACON;
  }
  if(fleck>0.996 && body.core>0.45) return T.SOLAR_BATTERY;
  return null;
}

export function skyTile(WG,wx,y,sy){
  const body=skyIslandBody(WG,wx,y,sy);
  if(!body){
    const transition=sy===-1 ? skyTransitionTile(WG,wx,y) : T.AIR;
    return transition!==T.AIR ? transition : skyRibbonTile(WG,wx,y,sy);
  }
  const env=layerEnvelope(WG,wx,y);
  const fleck=safeRand(WG,wx*5.31+y*0.73+sy*91.7);
  const shellTop=y<=body.top+1;
  const shellBottom=y>=body.bottom-1;
  const relic=skyRelicTile(WG,body,wx,y,fleck,shellTop,shellBottom);
  if(relic!=null) return relic;
  if(!shellTop && !shellBottom && body.depth>0.24 && body.depth<0.82 && body.core>0.34){
    const hollow=safeNoise(WG,wx+y*0.73,19,7221+sy*43) + safeNoise(WG,wx-y*0.41,8,7222+sy*47);
    if(hollow>1.34 && fleck<0.72) return T.AIR;
  }
  if(Math.abs(wx-body.desc.center)<1.35 && Math.abs(y-body.desc.cy)<1.35 && fleck<0.50+env.skyFlux*0.18) return T.ANTIGRAVITY_BEACON;
  if(body.core>0.76 && fleck<(body.cfg.high?0.012:0.007)+env.crystalBias*0.012) return T.ANTIMATTER_CRYSTAL;
  if(body.core>0.54 && fleck<0.038+env.crystalBias*0.034) return T.IRIDIUM;
  if(shellBottom) return fleck<0.46+env.basaltBias*0.28+env.mountain*0.08-env.ocean*0.05 ? T.BASALT : T.GRANITE;
  if(shellTop) return fleck<0.14+env.skyFlux*0.16+env.desert*0.04 ? T.METEOR_DUST : T.GLASS;
  if(fleck<0.24+env.skyFlux*0.18) return T.METEOR_DUST;
  return body.cfg.high && fleck<0.38+env.crystalBias*0.16 ? T.IRIDIUM : T.GLASS;
}

export function deepStrataProfile(WG,wx,y){
  const env=layerEnvelope(WG,wx,y);
  const root=volcanoRootProfile(WG,wx,y);
  const deep=Math.max(0,y-WORLD_H);
  const crustDepth=Math.max(0,y-env.surface);
  const fold=(safeNoise(WG,wx,92,4607)-0.5)*18 + Math.sin(wx*0.021 + safeNoise(WG,wx,180,4608)*6.28318)*5 + (safeNoise(WG,wx+y*0.16,38,4609)-0.5)*8;
  const band=safeNoise(WG,wx+y*0.11,64,4601);
  const lens=safeNoise(WG,wx-y*0.18,27,4602);
  const rootBoost=root.active ? root.influence*0.28 + (root.core?0.22:0) + (root.chamber?0.18:0) + (root.dike?0.10:0) : 0;
  const igneous=clamp01(0.20 + env.basaltBias*0.46 + env.volcanic*0.18 + env.mountain*0.10 + lens*0.08 - env.ocean*0.05 + rootBoost);
  const crystal=clamp01(0.16 + env.crystalBias*0.44 + band*0.12 + env.city*0.08 + env.snow*0.05);
  const fracture=clamp01(0.18 + env.deepFracture*0.48 + lens*0.12 + env.ravine*0.12 + (root.dike?0.08:0));
  const continuityDepth=legacyGeologyLayerDepth(WG,wx,y,crustDepth,env.biome);
  const massWarp=(fbm2D(WG,wx,y,230,82,2,7466)-0.5)*16 + (fbm2D(WG,wx+73,y-41,96,55,2,7467)-0.5)*9;
  const virtualDepth=continuityDepth + massWarp + env.mountain*4 + env.volcanic*8 - env.ocean*3 + (root.active?root.influence*13:0);
  const graniteLine=27 + (band-0.5)*12 - env.mountain*4 - env.city*2;
  const basaltLine=54 + (safeNoise(WG,wx+y*0.07,78,4603)-0.5)*16 - igneous*14;
  const mantleLine=86 + (safeNoise(WG,wx-y*0.05,110,4604)-0.5)*13 - env.volcanic*11 - (root.active?root.influence*13:0);
  return {env, root, deep, crustDepth, continuityDepth, fold, band, lens, massWarp, igneous, crystal, fracture, virtualDepth, graniteLine, basaltLine, mantleLine};
}

export function deepCaveProfile(WG,wx,y,strataOpt){
  const strata=strataOpt || deepStrataProfile(WG,wx,y);
  const env=strata.env;
  const deep=strata.deep;
  const depthN=clamp01((deep-8)/112);
  let legacyCave=0;
  if(deep<58 && WG && typeof WG.caveAt === 'function'){
    try{
      const col=safeColumn(WG,wx);
      legacyCave=col ? WG.caveAt(Math.round(wx), y, col) : 0;
    }catch(e){ legacyCave=0; }
  }
  const cavern=fbm2D(WG,wx,y,92,42,3,7401);
  const chamber=fbm2D(WG,wx+37,y-19,46,30,2,7402);
  const channel=fbm2D(WG,wx,y,180,46,2,7411);
  const branch=fbm2D(WG,wx-17,y+23,68,92,2,7412);
  const grain=fbm2D(WG,wx,y,24,18,2,7421);
  // Passages pinch out approaching the world floor: rare sealed pockets remain,
  // but no tunnel runs flat along the bedrock boundary.
  const floorSeal=clamp01((y-(WORLD_MAX_Y-18))/12);
  const cavernThreshold=0.805 - depthN*0.075 - strata.fracture*0.080 + floorSeal*0.14;
  const cavernOpen=cavern>cavernThreshold && chamber>0.42;
  const channelWidth=(0.014 + depthN*0.020 + strata.fracture*0.012)*(1-floorSeal*0.85);
  const tunnelOpen=Math.abs(channel-0.5)<channelWidth && grain>0.34;
  const branchOpen=Math.abs(branch-0.5)<channelWidth*0.72 && grain>0.55 && deep>18;
  const shaftGate=safeNoise(WG,wx,310,7431)>0.82 || env.ravine>0.35;
  const shaft=shaftGate && deep>12 && y<WORLD_MAX_Y-16 && Math.abs(fbm2D(WG,wx,y,18,118,2,7432)-0.5)<0.018+env.ravine*0.020;
  // Deep flooding follows the same regional water table as the mid-world
  // aquifer: wet stretches stay wet into the low world, dry stretches carry
  // open caves far deeper before pooling.
  const tableRef=safeAquifer(WG,wx);
  const tableT=tableRef==null ? clamp01(safeNoise(WG,wx,260,7441)) : clamp01((tableRef-88)/92);
  const waterLine=WORLD_H + 16 + tableT*44 + (safeNoise(WG,wx,140,7444)-0.5)*14 + env.ocean*16 + env.lake*10 - env.mountain*7 - env.volcanic*5;
  const wet=safeNoise2D(WG,wx,y,64,24,7442)>0.30 || env.ocean>0.55 || env.lake>0.5;
  const carryFade=clamp01(1-deep/50);
  const carryChance=clamp01(0.20 + carryFade*0.58 + env.deepFracture*0.08 + env.ravine*0.10);
  const carryLegacy=legacyCave>0 && safeNoise2D(WG,wx,y,42,26,7440)<carryChance;
  if(deep<5 && !carryLegacy) return {open:false, flooded:false, cavern, tunnel:1, shaft:false, waterLine};
  const open=carryLegacy || cavernOpen || tunnelOpen || branchOpen || shaft;
  const flooded=open && y>=waterLine && wet && (deep>16 || env.ocean>0.35);
  const legacyPocket=carryLegacy && legacyCave===2 && deep<18 && wet && safeNoise2D(WG,wx,y,38,18,7443)>0.70;
  return {open, flooded:flooded || legacyPocket, cavern, tunnel:Math.min(Math.abs(channel-0.5),Math.abs(branch-0.5)), shaft, waterLine};
}

export function deepCaveDressingTile(WG,wx,y,caveOpt,strataOpt){
  const strata=strataOpt || deepStrataProfile(WG,wx,y);
  const cave=caveOpt || deepCaveProfile(WG,wx,y,strata);
  if(!cave.open || cave.flooded) return null;
  const env=strata.env;
  const root=strata.root || volcanoRootProfile(WG,wx,y);
  const above=deepCaveProfile(WG,wx,y-1);
  const below=deepCaveProfile(WG,wx,y+1);
  const ceiling=!above.open || above.flooded;
  const floor=!below.open || below.flooded;
  const roll=safeRand(WG,wx*14.91+y*0.73+7488);
  if(root.active && roll>0.938) return roll>0.980 || root.lava ? T.STEAM : T.HOT_AIR;
  if(ceiling && env.snow>0.55 && roll<0.040) return T.ICE;
  if(floor && env.swamp>0.45){
    if(roll<0.045) return T.POISON_GAS;
    if(roll<0.112) return T.GLOWSHROOM;
  }
  if(floor && env.biome===0 && env.moisture>0.46 && roll<0.062) return T.GLOWSHROOM;
  if(floor && env.desert>0.55 && roll>0.952) return T.FUEL_GAS;
  if(env.city>0.24 && roll<0.048) return T.POISON_GAS;
  if((env.volcanic>0.24 || env.mountain>0.68) && roll>0.966) return env.volcanic>0.24 ? T.HOT_AIR : T.STEAM;
  return null;
}

function bedrockDiamondBias(y){
  const rise=clamp01((y-(WORLD_MAX_Y-78))/56);
  const floorFade=clamp01(1-(y-(WORLD_MAX_Y-18))/12);
  return Math.pow(rise,1.7) * Math.max(0.12,floorFade);
}

function deepRockMaterialTile(WG,wx,y,strataOpt){
  const strata=strataOpt || deepStrataProfile(WG,wx,y);
  const env=strata.env;
  const deep=strata.deep;
  const ore=safeRand(WG,wx*8.17+y*0.47);
  const goldOre=safeRand(WG,wx*9.47+y*0.59+7460);
  const diamondOre=safeRand(WG,wx*10.91+y*0.83+7459);
  const texture=fbm2D(WG,wx,y,22,16,2,7451);
  const vein=ridgeNoise(WG,wx,y,39,7452);
  const goldVein=ridgeNoise(WG,wx,y,51,7465);
  const inMantle=strata.virtualDepth>strata.mantleLine;
  const inBasalt=strata.virtualDepth>strata.basaltLine;
  const inGranite=strata.virtualDepth>strata.graniteLine;
  // Ores concentrate in warped pocket masses instead of uniform salt-and-pepper
  // flecks; outside a pocket the same rolls run much leaner.
  const pocket=fbm2D(WG,wx+29,y+13,36,20,2,7455);
  const oreScale=0.42 + clamp01((pocket-0.58)/0.16)*1.9;
  const goldPocket=fbm2D(WG,wx-19,y+7,54,24,2,7468);
  const goldScale=0.35 + clamp01((goldPocket-0.54)/0.18)*2.4;
  const goldBody=fbm2D(WG,wx+11,y-5,18,13,2,7469);
  const goldThread=1-Math.abs(fbm2D(WG,wx+y*0.21,y-wx*0.08,44,15,2,7470)*2-1);
  const diamondScale=0.06 + clamp01((pocket-0.61)/0.13)*3.1;
  const diamondBias=bedrockDiamondBias(y);
  // Coal seams continue across the mid/low contact and taper out with depth
  if(deep<48 && safeCoalVein(WG,wx,y) && safeRand(WG,wx*3.37+y*0.61)<1-deep/48) return T.COAL;
  if(deep<64 && (env.lake>0.5 || env.ocean>0.35) && ore<0.045 && texture>0.58) return ore<0.026 ? T.WET_CLAY : T.CLAY;
  if(env.desert>0.55 && deep<58 && ore<0.040 && texture>0.70) return T.SAND;
  if(env.snow>0.55 && deep<74 && ore>0.965 && vein>0.68) return T.ICE;
  if(env.city>0.24 && deep>18 && ore>0.976 && vein>0.34) return T.RADIOACTIVE_ORE;
  if(env.city>0.24 && ore>0.989-deep*0.00008 && vein>0.20) return T.METEORIC_IRON;
  if(deep>16 && deep<114 && goldPocket>0.605 && goldVein>0.80 && goldBody>0.625) return T.GOLD_ORE;
  if(deep>28 && deep<110 && goldPocket>0.655 && goldThread>0.78 && goldBody>0.575) return T.GOLD_ORE;
  if(deep>34 && deep<104 && goldVein>0.93 && goldPocket>0.56 && goldOre<(0.010+strata.crystal*0.016)*goldScale) return T.GOLD_ORE;
  if(deep>86 && ore<(0.006+strata.crystal*0.010)*oreScale) return T.ANTIMATTER_CRYSTAL;
  if(deep>52 && ore<(0.012+strata.crystal*0.022)*oreScale) return T.IRIDIUM;
  if(deep>72 && vein>0.91 && diamondOre<(0.006+strata.crystal*0.013)*diamondScale*diamondBias) return T.DIAMOND;
  if(deep>96 && vein>0.70 && diamondOre<(0.003+strata.crystal*0.010)*diamondScale*diamondBias) return T.DIAMOND;
  if(deep>58 && env.volcanic>0 && ore<0.050+strata.igneous*0.090) return T.OBSIDIAN;
  if(inMantle) return texture<0.50+strata.igneous*0.20 || vein<0.15 ? T.BASALT : T.GRANITE;
  if(inBasalt) return (texture<0.54+strata.igneous*0.20 || vein<0.22) ? T.BASALT : T.GRANITE;
  if(inGranite) return texture<0.70 ? T.GRANITE : (vein>0.89 && strata.igneous>0.45 ? T.BASALT : T.STONE);
  return texture<0.50 ? T.STONE : T.GRANITE;
}

export function deepTile(WG,wx,y){
  // Sealed ocean bedrock basins ("skała macierzysta") continue through the whole
  // deep world: no cave, ore pocket or tunnel may pass under a real ocean at any
  // depth — crossing the water means going over it.
  if(WG && typeof WG.oceanBasinAt==='function' && WG.oceanBasinAt(wx)) return T.BEDROCK;
  if(y>=WORLD_MAX_Y-3) return T.BEDROCK;
  // Ragged bedrock roof: the absolute floor rises a few tiles on a warped line
  // with scattered bedrock teeth above it, never a clean flat shelf.
  if(y>=WORLD_MAX_Y-12){
    const floorRise=safeNoise(WG,wx,23,7481)*2.4 + safeNoise(WG,wx,64,7482)*2.8;
    if(y>=WORLD_MAX_Y-3-floorRise) return T.BEDROCK;
    if(y>=WORLD_MAX_Y-6-floorRise && safeRand(WG,wx*6.53+y*0.71)<0.34) return T.BEDROCK;
  }
  const strata=deepStrataProfile(WG,wx,y);
  const env=strata.env;
  const root=strata.root || volcanoRootProfile(WG,wx,y);
  const deep=strata.deep;
  if(root.active){
    if(root.lava) return T.LAVA;
    if(root.core || root.chamber) return safeRand(WG,wx*8.81+y*0.37)<0.42 ? T.OBSIDIAN : T.BASALT;
    if(root.dike) return safeRand(WG,wx*5.19+y*0.49)<0.78 ? T.BASALT : T.GRANITE;
  }
  const cave=deepCaveProfile(WG,wx,y,strata);
  if(cave.open){
    const dressed=deepCaveDressingTile(WG,wx,y,cave,strata);
    return dressed!=null ? dressed : (cave.flooded ? T.WATER : T.AIR);
  }
  if(deep<38 && !lowerWorldDominatesContact(WG,wx,y)){
    return legacyGeologyRockCoreTile(WG,wx,y,strata.crustDepth,env.biome);
  }
  return deepRockMaterialTile(WG,wx,y,strata);
}

export const worldLayers = Object.freeze({
  columnProfile,
  layerEnvelope,
  legacyGeologyLayerDepth,
  midLowContactY,
  volcanoRootProfile,
  volcanoAureoleTile,
  legacyGeologyRockTile,
  skyLayerConfig,
  skyCellTraits,
  skyIslandDescriptor,
  skyIslandBody,
  skyRibbonTile,
  skyTransitionTile,
  skyRelicTile,
  skyTile,
  deepStrataProfile,
  deepCaveProfile,
  deepCaveDressingTile,
  deepTile
});

export default worldLayers;
