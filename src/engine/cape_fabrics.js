// Cape fabric taxonomy: every cape item resolves to one of ten fabric
// archetypes (physics profile + paint rule). Resolution order is load-bearing:
// explicit item.fabric > builtin style id > Polish keyword scan of name then
// desc > tier default. Pure module — no DOM, no canvas — so Node suites can
// pin the whole item→fabric table.
window.MM = window.MM || {};
(function(){
  // Physics fields (consumed by cape.js update):
  //   lengthTiles — chain rest length in tiles (shoulder to hem)
  //   massMul    — gravity multiplier (heavy fabrics sink harder)
  //   drag       — aerodynamic normal-drag coefficient (flutter engine gain)
  //   damp       — base Verlet damping per 60fps frame (higher = livelier)
  //   bendLimit  — max turn per link in radians (stiff fabrics bend less)
  //   straighten — per-frame blend of each link toward its parent direction
  //   flutter    — traveling-wave seed amplitude multiplier
  //   windMul    — wind force multiplier
  // Paint fields (consumed by cape.js paintRibbon):
  //   edge       — hem silhouette: straight|wave|scallop|ragged|shard|feather
  //   sheenPow   — anisotropic band tightness (higher = narrower silk band)
  //   sheenAmp   — band strength 0..1 (0 disables — wool's identity)
  //   rim        — 'bright'|'dark'|null: silhouette response (velvet vs leather)
  //   pattern    — baked texture motif: null|'scale'|'weave'|'fur'
  //   tint       — 'full' (player swatch), 'bias' (swatch pulled toward
  //                identity), 'ignore' (identity color wins)
  //   identity   — base color for tint:'ignore'/'bias' fabrics
  //   lining     — lining hint color mixed into fold-back stops (null = auto)
  //   trim       — hem trim stroke color (null = none)
  //   alpha      — fill opacity (spectral translucency)
  //   glow       — emissive registration level 0..1 (post_fx bloom seam)
  // lengthTiles is anchor→hem: ~1.0-1.2 reads heroically past the 0.95-tile
  // body without reviving the old 1.76-tile floor smear (and stays inside the
  // 0.5-tile hero-backdrop erase pad around the spine).
  const FABRICS={
    cloth:   {label:'Płótno',   lengthTiles:1.05, massMul:1.00, drag:0.85, damp:0.985, bendLimit:0.62, straighten:0.030, flutter:1.00, windMul:1.00,
              edge:'straight', sheenPow:3,  sheenAmp:0.10, rim:'dark',  pattern:'weave', tint:'full', identity:null,      lining:null,      trim:null,      alpha:1,    glow:0},
    silk:    {label:'Jedwab',   lengthTiles:1.18, massMul:0.72, drag:1.25, damp:0.990, bendLimit:0.85, straighten:0.008, flutter:1.35, windMul:1.30,
              edge:'wave',     sheenPow:42, sheenAmp:0.55, rim:null,    pattern:null,    tint:'full', identity:null,      lining:null,      trim:null,      alpha:1,    glow:0},
    leather: {label:'Skóra',    lengthTiles:0.95, massMul:1.30, drag:0.45, damp:0.975, bendLimit:0.34, straighten:0.150, flutter:0.45, windMul:0.55,
              edge:'straight', sheenPow:9,  sheenAmp:0.30, rim:'dark',  pattern:null,    tint:'bias', identity:'#6b4a2e', lining:null,      trim:null,      alpha:1,    glow:0},
    fur:     {label:'Futro',    lengthTiles:1.02, massMul:1.55, drag:0.55, damp:0.972, bendLimit:0.45, straighten:0.080, flutter:0.50, windMul:0.50,
              edge:'ragged',   sheenPow:2,  sheenAmp:0.08, rim:'bright',pattern:'fur',   tint:'bias', identity:'#e8e2d4', lining:null,      trim:null,      alpha:1,    glow:0},
    feather: {label:'Pióra',    lengthTiles:1.12, massMul:0.80, drag:1.10, damp:0.986, bendLimit:0.70, straighten:0.020, flutter:1.10, windMul:1.15,
              edge:'feather',  sheenPow:12, sheenAmp:0.28, rim:'bright',pattern:null,    tint:'full', identity:null,      lining:null,      trim:null,      alpha:1,    glow:0},
    scale:   {label:'Łuska',    lengthTiles:1.03, massMul:1.20, drag:0.65, damp:0.978, bendLimit:0.40, straighten:0.070, flutter:0.55, windMul:0.70,
              edge:'scallop',  sheenPow:16, sheenAmp:0.48, rim:'bright',pattern:'scale', tint:'bias', identity:'#3f6d5a', lining:null,      trim:null,      alpha:1,    glow:0},
    ember:   {label:'Żar',      lengthTiles:1.08, massMul:0.85, drag:1.00, damp:0.988, bendLimit:0.75, straighten:0.010, flutter:1.25, windMul:1.15,
              edge:'ragged',   sheenPow:6,  sheenAmp:0.40, rim:'bright',pattern:null,    tint:'ignore', identity:'#d8480f', lining:'#ffb347', trim:null,    alpha:1,    glow:0.55},
    spectral:{label:'Cień',     lengthTiles:1.20, massMul:0.55, drag:1.15, damp:0.992, bendLimit:0.95, straighten:0.004, flutter:1.55, windMul:1.50,
              edge:'ragged',   sheenPow:4,  sheenAmp:0.18, rim:'bright',pattern:null,    tint:'bias', identity:'#241b33', lining:'#6f5a9e', trim:null,      alpha:0.72, glow:0},
    frost:   {label:'Lód',      lengthTiles:0.95, massMul:1.15, drag:0.50, damp:0.970, bendLimit:0.28, straighten:0.200, flutter:0.35, windMul:0.55,
              edge:'shard',    sheenPow:24, sheenAmp:0.50, rim:'bright',pattern:null,    tint:'bias', identity:'#bfe4f5', lining:null,      trim:null,      alpha:1,    glow:0},
    gilded:  {label:'Złoto',    lengthTiles:1.02, massMul:1.45, drag:0.55, damp:0.974, bendLimit:0.38, straighten:0.100, flutter:0.45, windMul:0.60,
              edge:'scallop',  sheenPow:10, sheenAmp:0.75, rim:'bright',pattern:'scale', tint:'ignore', identity:'#c9971d', lining:'#8a6410', trim:'#ffe9a3', alpha:1,  glow:0.25}
  };
  const FABRIC_IDS=Object.freeze(Object.keys(FABRICS));
  // Builtin style id → fabric. Royal keeps its satin heritage, winged its
  // plumage, shadow its smoke; the rest are honest cloth.
  const BUILTIN_FABRIC={classic:'cloth', triangle:'cloth', tattered:'cloth', royal:'silk', winged:'feather', shadow:'spectral'};

  // Diacritic fold so 'Łuska'/'żaru'/'pióro' match ascii keyword stems.
  function foldDiacritics(s){
    return String(s||'').toLowerCase()
      .replace(/ł/g,'l').replace(/[żź]/g,'z').replace(/ó/g,'o').replace(/ś/g,'s')
      .replace(/ę/g,'e').replace(/ą/g,'a').replace(/ć/g,'c').replace(/ń/g,'n');
  }
  // Ordered keyword table — FIRST match wins. The order carries real decisions:
  // 'zorz' before scale keeps aurora iridescent; ember before feather keeps
  // 'Pióropusz żaru' burning; fur before frost keeps 'zimowego futra' warm
  // ('zim' itself is deliberately not a key).
  const KEYWORD_RULES=[
    {fabric:'scale',   irid:true,  keys:['zorz']},
    {fabric:'ember',   irid:false, keys:['zar','plomien','feniks','ogni','wulkan','lawa','popiol']},
    {fabric:'spectral',irid:false, keys:['cien','mrok','otchlan','upior','widm','echa']},
    {fabric:'fur',     irid:false, keys:['futr','yeti','niedzwiedz','kudl']},
    {fabric:'frost',   irid:false, keys:['zamiec','snieg','mroz','lod','szron','krysztal']},
    {fabric:'scale',   irid:false, keys:['lusk','smok','zmij','glebin']},
    {fabric:'feather', irid:false, keys:['pior','puch','skrzyd','harpi','sep','ptak','pioropusz']},
    {fabric:'leather', irid:false, keys:['skor','blon','rzemien','nietoperz','plaszczk']},
    {fabric:'gilded',  irid:false, keys:['zlot','serafin','aureol','slonc','blask']},
    {fabric:'silk',    irid:false, keys:['jedwab','atlas','czasza','balon','oblo','chmur','wiatr','burz','swit','astrael']}
  ];
  const TIER_FABRIC={common:'cloth', uncommon:'cloth', rare:'silk', epic:'scale', legendary:'gilded'};

  function keywordScan(text){
    if(!text) return null;
    for(const rule of KEYWORD_RULES){
      for(const k of rule.keys){
        if(text.indexOf(k)!==-1) return rule;
      }
    }
    return null;
  }
  // item → {fabric, irid}. Accepts a full item, a partial {id,name,desc,tier},
  // or null (bare style ids come through as {id}).
  function resolve(item){
    if(!item) return {fabric:'cloth', irid:false};
    if(typeof item==='string') item={id:item};
    if(item.fabric && FABRICS[item.fabric]) return {fabric:item.fabric, irid:!!item.irid};
    if(item.id && BUILTIN_FABRIC[item.id]) return {fabric:BUILTIN_FABRIC[item.id], irid:false};
    const byName=keywordScan(foldDiacritics(item.name));
    if(byName) return {fabric:byName.fabric, irid:byName.irid};
    const byDesc=keywordScan(foldDiacritics(item.desc));
    if(byDesc) return {fabric:byDesc.fabric, irid:byDesc.irid};
    if(item.tier==='legendary') return {fabric:TIER_FABRIC.legendary, irid:true};
    return {fabric:TIER_FABRIC[item.tier]||'cloth', irid:false};
  }
  function get(id){ return FABRICS[id]||FABRICS.cloth; }

  MM.capeFabrics={FABRICS, FABRIC_IDS, BUILTIN_FABRIC, resolve, get, foldDiacritics, _debug:{KEYWORD_RULES, TIER_FABRIC, keywordScan}};
})();
export const capeFabrics = (typeof window!=='undefined' && window.MM) ? window.MM.capeFabrics : undefined;
export default capeFabrics;
