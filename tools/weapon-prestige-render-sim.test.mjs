// Held-weapon visual hierarchy: distinct melee silhouettes and deterministic,
// progressively richer rare/epic/legendary effects plus cosmetic hit metadata.
// Run: node tools/weapon-prestige-render-sim.test.mjs
import { strict as assert } from 'assert';
import { readFileSync } from 'node:fs';

globalThis.window=globalThis;
globalThis.MM={};
globalThis.performance={now:()=>123456};
const combatEvents=[];
globalThis.CustomEvent=class { constructor(type,opts){ this.type=type; this.detail=opts&&opts.detail; } };
globalThis.dispatchEvent=ev=>{ if(ev&&ev.type==='mm-combat-event') combatEvents.push(ev.detail); return true; };

let equipped=null;
MM.inventory={
  equippedItem:()=>equipped,
  TIER_COLORS:{common:'#b07f2c',uncommon:'#3fa650',rare:'#a74cc9',epic:'#e0b341',legendary:'#58e0d8'}
};
globalThis.inv={harpoonBolt:5};

const { weapons }=await import('../src/engine/weapons.js');
assert.ok(weapons&&weapons._debug,'weapons renderer exports its debug contract');

function mockCtx(){
  const calls=[];
  const ctx={calls,
    save(){calls.push(['save']);},restore(){calls.push(['restore']);},translate(x,y){calls.push(['translate',x,y]);},rotate(a){calls.push(['rotate',a]);},
    beginPath(){calls.push(['beginPath']);},closePath(){calls.push(['closePath']);},moveTo(x,y){calls.push(['moveTo',x,y]);},lineTo(x,y){calls.push(['lineTo',x,y]);},
    arc(x,y,r,a,b){calls.push(['arc',x,y,r,a,b]);},fill(){calls.push(['fill']);},stroke(){calls.push(['stroke']);},fillRect(x,y,w,h){calls.push(['fillRect',x,y,w,h]);},
    createRadialGradient(...args){ calls.push(['createRadialGradient',...args]); return {addColorStop(at,col){calls.push(['addColorStop',at,col]);}}; }
  };
  for(const key of ['globalCompositeOperation','globalAlpha','shadowColor','shadowBlur','fillStyle','strokeStyle','lineWidth','lineCap']){
    Object.defineProperty(ctx,key,{set(v){calls.push(['set',key,v]);},get(){return undefined;},configurable:true});
  }
  return ctx;
}
const player={x:4.5,y:6.5,w:0.7,h:0.95,facing:1,atkCd:0};

function render(item){ equipped=item; const ctx=mockCtx(); weapons.drawHeld(ctx,20,player); return ctx.calls; }
function count(calls,name){ return calls.filter(c=>c[0]===name).length; }
function lighterCount(calls){ return calls.filter(c=>c[0]==='set'&&c[1]==='globalCompositeOperation'&&c[2]==='lighter').length; }

const D=weapons._debug;
assert.equal(D.weaponPrestigeRank({tier:'common'}),0,'common has no prestige aura');
assert.equal(D.weaponPrestigeRank({tier:'rare'}),2,'rare begins the visible prestige effects');
assert.equal(D.weaponPrestigeRank({tier:'epic'}),3,'epic gets the second effect layer');
assert.equal(D.weaponPrestigeRank({tier:'legendary'}),4,'legendary gets the complete effect stack');
assert.equal(D.weaponPrestigeRank({tier:'common',unique:'relic'}),3,'a unique relic is visibly exceptional even with old tier data');
assert.equal(D.weaponMaterialProfile({id:'iridium_blade'}).id,'iridium','iridium keeps a dedicated violet material identity');
assert.equal(D.weaponMaterialProfile({id:'diamond_axe'}).id,'diamond','diamond keeps a dedicated crystalline material identity');
assert.equal(D.weaponMaterialProfile({id:'obsidian_sword'}).id,'obsidian','obsidian keeps a dedicated dark material identity');
assert.equal(D.weaponMaterialProfile({id:'storm_coil',weaponType:'electric'}).id,'arc','electric devices use a conductive material profile');
assert.equal(D.weaponMaterialProfile({id:'deep_harpoon',aquaticStyle:'harpoon'}).id,'aquatic','underwater weapons use a corrosion-resistant visual profile');
const impactMeta=D.weaponCombatVisualMeta({id:'iridium_blade',weaponType:'melee',tier:'legendary'},'melee');
assert.deepEqual(
  {material:impactMeta.weaponMaterial,prestige:impactMeta.weaponPrestige,weaponClass:impactMeta.weaponClass,form:impactMeta.weaponForm,forced:impactMeta.forceVisual},
  {material:'iridium',prestige:4,weaponClass:'melee',form:'sword',forced:true},
  'landed-hit events carry the weapon identity into the central impact renderer'
);
weapons.reset();
equipped={id:'iridium_blade',name:'Iridium blade',weaponType:'melee',tier:'legendary',attackDamage:9};
MM.activeModifiers={attackDamage:7};
MM.mobs={attackAt(){return true;}};
assert.equal(weapons.fireHeld(player,player.x+1,player.y,1/60),true,'test melee strike lands');
assert.ok(combatEvents.some(e=>e.weaponMaterial==='iridium'&&e.weaponPrestige===4&&e.weaponClass==='melee'),'real landed strike emits material-aware impact metadata');
weapons.reset();

equipped={id:'plain_sword',name:'Plain sword',weaponType:'melee',tier:'common'};
assert.equal(D.weaponLightSource(player),null,'ordinary idle weapon does not add a redundant light source');
equipped={id:'rare_sword',name:'Rare sword',weaponType:'melee',tier:'rare'};
const rareLight=D.weaponLightSource(player);
assert.ok(rareLight&&rareLight.level===6&&rareLight.material==='steel','rare weapon begins with a restrained physical cave glow');
equipped={id:'legendary_iridium',name:'Iridium sword',weaponType:'melee',tier:'legendary'};
const legendaryLight=D.weaponLightSource(player);
assert.ok(legendaryLight.level>rareLight.level&&legendaryLight.color==='#d7b4ff','legendary material emits a stronger correctly coloured light');
const worldLightCtx=mockCtx();
assert.equal(weapons.drawWorldLight(worldLightCtx,20,player),true,'exceptional weapon composites coloured bounce into the world');
assert.ok(lighterCount(worldLightCtx.calls)>=1&&count(worldLightCtx.calls,'addColorStop')===3,'world bounce uses one bounded radial gradient');
const heroLightCtx=mockCtx();
assert.equal(weapons.drawHeroReflection(heroLightCtx,20,player),true,'same source produces a reflection on the hero-facing side');
assert.ok(count(heroLightCtx.calls,'addColorStop')===3,'hero reflection reuses the bounded three-stop falloff');
weapons.reset();
equipped={id:'common_coil',name:'Coil',weaponType:'electric',tier:'common'};
D.triggerHeldActionFx('electric',1.2,180,false);
assert.ok(D.weaponLightSource(player).level>=14,'active electric weapon flashes brightly even without rarity aura');
weapons.reset();

assert.equal(D.meleeVisualForm({name:'Miecz stalowy'}),'sword');
assert.equal(D.meleeVisualForm({name:'Topór diamentowy'}),'axe');
assert.equal(D.meleeVisualForm({name:'Maczuga'}),'club');
assert.equal(D.meleeVisualForm({name:'Dzida metalowa',fireRange:2}),'spear');
assert.equal(D.meleeVisualForm({name:'Trójząb',aquaticStyle:'trident'}),'trident');

const common=render({id:'common_sword',name:'Miecz',weaponType:'melee',tier:'common'});
const rare=render({id:'rare_sword',name:'Miecz',weaponType:'melee',tier:'rare'});
const epic=render({id:'epic_sword',name:'Miecz',weaponType:'melee',tier:'epic'});
const legendaryItem={id:'legendary_sword',name:'Miecz irydowy',weaponType:'melee',tier:'legendary',meleeEffect:'bleed'};
const legendary=render(legendaryItem);
assert.equal(lighterCount(common),0,'common weapon stays visually quiet');
assert.ok(lighterCount(rare)>=2,'rare weapon gets a back glow and a front glint');
assert.ok(count(rare,'arc')<count(epic,'arc')&&count(epic,'arc')<count(legendary,'arc'),'aura geometry grows with rarity');
assert.ok(legendary.some(c=>c[0]==='set'&&c[1]==='shadowBlur'&&c[2]>=15),'legendary weapon has the strongest bloom');

const repeat=render(legendaryItem);
assert.deepEqual(repeat,legendary,'prestige animation is deterministic for the same item and frame');
const alternate=render({...legendaryItem,id:'another_legendary'});
assert.notDeepEqual(alternate,legendary,'different exceptional items do not pulse in lockstep');

for(const item of [
  {id:'epic_axe',name:'Topór',weaponType:'melee',tier:'epic'},
  {id:'legendary_bow',name:'Łuk korony',weaponType:'bow',tier:'legendary'},
  {id:'legendary_harpoon',name:'Harpunnik',weaponType:'harpoon',tier:'legendary'},
  {id:'epic_flame',name:'Smoczy miotacz',weaponType:'flame',tier:'epic'},
  {id:'epic_hose',name:'Wąż głębin',weaponType:'hose',tier:'epic'},
  {id:'epic_gas',name:'Emiter zarazy',weaponType:'gas',tier:'epic'},
  {id:'legendary_electric',name:'Cewka burzy',weaponType:'electric',tier:'legendary'}
]){
  const calls=render(item);
  assert.ok(calls.length>20,item.weaponType+' has a full held silhouette');
  assert.ok(lighterCount(calls)>=2,item.weaponType+' inherits prestige effects');
}

weapons.reset();
D.triggerHeldActionFx('electric',1.4,240,false);
const firingElectric=render({id:'storm_coil',name:'Cewka burzy',weaponType:'electric',tier:'rare'});
assert.ok(D.heldActionState().active,'successful activation exposes a short cosmetic recoil state');
assert.ok(lighterCount(firingElectric)>=3,'active electric weapon adds a class-specific muzzle layer on top of prestige');
assert.ok(count(firingElectric,'lineTo')>=3,'electric activation draws a jagged discharge instead of a generic flash');

weapons.reset();
const plainTrail=mockCtx();
D.drawProjectilePrestigeTrail(plainTrail,20,{x:4,y:4,vx:8,vy:0,weaponPrestige:1,weaponGlow:'#ffffff'});
assert.equal(plainTrail.calls.length,0,'common and uncommon projectiles do not create noisy trails');
const legendaryTrail=mockCtx();
D.drawProjectilePrestigeTrail(legendaryTrail,20,{x:4,y:4,vx:8,vy:0,weaponPrestige:4,weaponGlow:'#65f4ff'});
assert.ok(lighterCount(legendaryTrail.calls)>=1&&count(legendaryTrail.calls,'lineTo')>=1,'legendary projectile carries the weapon prestige into flight');
const aquaticTrail=mockCtx();
D.drawProjectilePrestigeTrail(aquaticTrail,20,{x:4,y:4,vx:8,vy:0,aquatic:true,inWater:true,travel:2,weaponPrestige:4,weaponGlow:'#70efff'});
assert.ok(count(aquaticTrail.calls,'arc')>=4,'prestigious aquatic projectile replaces an air streak with a bubble wake underwater');

weapons.reset();
const idleCommonBow=render({id:'wood_bow',name:'Bow',weaponType:'bow',tier:'common'});
D.bowCharge.active=true; D.bowCharge.required=1; D.bowCharge.t=0.58; D.bowCharge.full=false;
const chargingCommonBow=render({id:'wood_bow',name:'Bow',weaponType:'bow',tier:'common'});
assert.ok(lighterCount(chargingCommonBow)>lighterCount(idleCommonBow),'drawing a bow builds a material-colored energy layer even without rarity aura');
assert.ok(count(chargingCommonBow,'arc')>count(idleCommonBow,'arc'),'charge progress grows visible orbit geometry around the held weapon');
D.bowCharge.t=1; D.bowCharge.full=true;
const fullCommonBow=render({id:'wood_bow',name:'Bow',weaponType:'bow',tier:'common'});
assert.ok(count(fullCommonBow,'lineTo')>count(chargingCommonBow,'lineTo'),'full draw resolves into a clear completion glyph rather than only more bloom');

const mainSrc=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const particleSrc=readFileSync(new URL('../src/engine/particles.js',import.meta.url),'utf8');
assert.ok(mainSrc.includes('WEAPON_IMPACT_PALETTES')&&mainSrc.includes('drawWeaponMaterialImpactFx'),'world impact renderer consumes weapon material metadata');
for(const material of ['wood','stone','steel','obsidian','diamond','iridium','aquatic','arc','exotic']){
  assert.ok(mainSrc.includes(material+':{ring:'),material+' owns an impact palette');
  assert.ok(particleSrc.includes("e.indexOf('"+material+"')>=0"),material+' owns a physical chip palette');
}

console.log('weapon-prestige-render-sim: all assertions passed');
