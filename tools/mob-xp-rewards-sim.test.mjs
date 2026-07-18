// Nonlinear combat progression contract:
// - actual mob power is compared with a weapon-neutral hero-development floor
// - dangerous and regionally strengthened enemies pay much more than base XP
// - weak enemies pay diminishing XP for several hero levels before reaching zero
// - repeated same-species farming has a grace run, then decays and resets daily
// - weapon choice never changes the XP payout; it only changes combat efficiency.
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.MM = {};
globalThis.localStorage = {
  getItem(){ return null; },
  setItem(){},
  removeItem(){}
};
const listeners = new Map();
globalThis.CustomEvent = class {
  constructor(type,opts){ this.type=type; this.detail=opts && opts.detail; }
};
globalThis.addEventListener = (type,fn)=>{
  const list=listeners.get(type) || [];
  list.push(fn);
  listeners.set(type,list);
};
globalThis.dispatchEvent = (ev)=>{
  for(const fn of listeners.get(ev.type) || []) fn(ev);
  return true;
};
let simNow = 1000;
globalThis.performance = { now:()=>simNow };
const messages=[];
globalThis.msg = t=>messages.push(String(t));

let heroLevel=1;
let heroAttack=3;
MM.progress={level:()=>({level:heroLevel})};
MM.inventory={attackDamage:()=>heroAttack};
MM.activeModifiers={attackDamage:0,damageReductionBonus:0,moveSpeedMult:1};

const { T } = await import('../src/constants.js');
const { mobs } = await import('../src/engine/mobs.js');
const { createVitalsModel, vitalsHud } = await import('../src/engine/vitals_hud.js');

let dayFloat = 1;
MM.seasons = { metrics:()=>({dayFloat}) };

const events = [];
const combatEvents = [];
addEventListener('mm-xp-awarded',ev=>events.push(ev.detail));
addEventListener('mm-combat-event',ev=>combatEvents.push(ev.detail));

const world = {
  getTile(x,y){ return y>=10 ? T.STONE : T.AIR; },
  setTile(){}
};
const species = mobs._debugSpecies();
const progression=mobs._debugProgression;
const id = 'STONE_GOLEM';
let remoteDamagedHooks=0;
let remoteDeathHooks=0;
const remoteHookId='REMOTE_WOUND_HOOK_TEST';
assert.equal(mobs.registerSpecies({
  id:remoteHookId, displayName:'Remote wound hook test', hp:12, xp:500, dmg:0, speed:1,
  wanderInterval:[2,3], max:1, ground:true, organic:false,
  spawnTest(){ return false; },
  onDamaged(){ remoteDamagedHooks++; },
  onDeath(){ remoteDeathHooks++; }
}),true,'remote wound regression species registered once');
globalThis.player = {x:0.5,y:9.15,w:0.7,h:0.95,vx:0,vy:0,hp:100,maxHp:100,hpInvul:0,xp:0};

function currentFatigue(){
  return mobs.serialize().xpFatigue;
}
function spawnTestMob(specId=id,x=0.5){
  const fatigue=currentFatigue();
  const spec=species[specId];
  mobs.deserialize({
    v:5,
    list:[{id:specId,x,y:9.124,vx:0,vy:0,hp:spec.hp,maxHp:spec.hp,state:'dormant',facing:1,scale:1,speedMul:1,jumpMul:1,attackCd:0}],
    aggro:{mode:'rel',m:{}},
    xpFatigue:fatigue
  });
  mobs.freezeSpawns(10000);
}
function kill(specId=id,opts,x=0.5){
  spawnTestMob(specId,x);
  const before=player.xp;
  assert.equal(mobs.damageAt(Math.floor(x),9,999,Object.assign({source:'hero'},opts||{})), true, 'test mob can be killed');
  return player.xp-before;
}
function challengeFor(specId,mobOverrides){
  const spec=species[specId];
  const m=Object.assign({id:specId,maxHp:spec.hp,dmgMult:1,speedMul:1},mobOverrides||{});
  return progression.challenge(m,spec,player);
}

try{
  mobs.deserialize({v:5,list:[],aggro:{mode:'rel',m:{}},xpFatigue:{mode:'day',m:{}}});

  // Network-owned attacks may help wound an ordinary creature, but they never
  // own host kill rewards or arbitrary species callbacks (some real callbacks
  // crater terrain, alter weather, and spawn follow-up mobs).
  for(const source of ['coop','ghost']){
    spawnTestMob(remoteHookId);
    const xpBefore=player.xp;
    assert.equal(mobs.damageAt(0,9,99999,{source}),true,source+' remote hit reaches the creature');
    const survivor=mobs.serialize().list.find(m=>m.id===remoteHookId);
    assert.ok(survivor && survivor.hp===0.5,source+' damage stops at the remote wound floor');
    assert.equal(player.xp,xpBefore,source+' damage awards no host XP');
  }
  assert.equal(remoteDamagedHooks,0,'remote hits cannot run species onDamaged world hooks');
  assert.equal(remoteDeathHooks,0,'remote hits cannot run species onDeath world hooks');
  spawnTestMob(remoteHookId);
  assert.equal(mobs.damageAt(0,9,99999,{source:'hero'}),true,'CONTROL: the host hero can finish the same species');
  assert.equal(remoteDamagedHooks,1,'CONTROL: an owner hit retains the species damage hook');
  assert.equal(remoteDeathHooks,1,'CONTROL: an owner kill retains the species death hook');
  mobs.deserialize({v:5,list:[],aggro:{mode:'rel',m:{}},xpFatigue:{mode:'day',m:{}}});
  player.xp=0;

  const fairBear=challengeFor('BEAR');
  const weakWolf=challengeFor('WOLF');
  const hardGolem=challengeFor(id);
  assert.equal(fairBear.tier,'fair','a fresh hero and a bear are an approximately fair match');
  assert.equal(weakWolf.tier,'weak','a wolf is already less rewarding than a bear for the fresh hero');
  assert.ok(hardGolem.challengeMult>2,'a materially stronger golem receives a nonlinear risk bonus');
  assert.ok(hardGolem.recommendedLevel>fairBear.recommendedLevel,'recommended level follows actual threat power');

  const basicRewardProfile=challengeFor(id);
  const basicThreat=progression.threatProfile(player);
  heroAttack=300;
  const strongRewardProfile=challengeFor(id);
  const strongThreat=progression.threatProfile(player);
  assert.equal(strongRewardProfile.totalMult,basicRewardProfile.totalMult,'equipping a much stronger weapon does not reduce creature XP');
  assert.equal(strongRewardProfile.ratio,basicRewardProfile.ratio,'XP challenge ratio is independent of weapon damage');
  assert.ok(strongThreat.power>basicThreat.power*4,'AI threat perception still sees the power of the equipped weapon');
  const strongWeaponXp=kill(id);
  mobs.deserialize({v:5,list:[],aggro:{mode:'rel',m:{}},xpFatigue:{mode:'day',m:{}}});
  player.xp=0;
  heroAttack=3;
  const basicWeaponXp=kill(id);
  assert.equal(strongWeaponXp,basicWeaponXp,'the same creature awards exactly the same XP for weak and powerful weapons');
  mobs.deserialize({v:5,list:[],aggro:{mode:'rel',m:{}},xpFatigue:{mode:'day',m:{}}});
  player.xp=0;

  // Even the weakest wildlife teaches a new hero something. Its level-based
  // floor then fades in visible steps instead of producing an immediate zero.
  for(const weakId of ['BIRD','FISH','FIREFLY']){
    const profile=challengeFor(weakId);
    assert.equal(profile.trivial,false,weakId+' is not trivial for a fresh hero');
    assert.ok(profile.levelGraceMult>0,weakId+' receives the early progression floor');
    assert.ok(kill(weakId)>0,weakId+' awards positive XP on an early kill');
  }
  mobs.deserialize({v:5,list:[],aggro:{mode:'rel',m:{}},xpFatigue:{mode:'day',m:{}}});
  heroLevel=4;
  const learningBird=challengeFor('BIRD');
  heroLevel=7;
  const fadingBird=challengeFor('BIRD');
  assert.ok(learningBird.levelGraceMult>fadingBird.levelGraceMult && fadingBird.levelGraceMult>0,'weak-species XP fades across hero levels');
  heroLevel=9;
  const outgrownBird=challengeFor('BIRD');
  assert.equal(outgrownBird.trivial,true,'weak wildlife becomes trivial only after the full level fade');
  assert.equal(kill('BIRD'),0,'fully outgrown wildlife eventually awards zero XP');
  mobs.deserialize({v:5,list:[],aggro:{mode:'rel',m:{}},xpFatigue:{mode:'day',m:{}}});
  heroLevel=1;
  player.xp=0;
  events.length=0;

  const regionalGolem=challengeFor(id,{maxHp:species[id].hp*4,dmgMult:3,speedMul:1.2});
  assert.ok(regionalGolem.mobPower>hardGolem.mobPower*3,'regional HP/damage produce a genuinely stronger entity rating');
  assert.ok(regionalGolem.variantMult>2,'a strengthened regional variant raises base payout as well as challenge');
  assert.ok(regionalGolem.totalMult>hardGolem.totalMult,'travelling toward stronger variants can pay XP unavailable near the center');

  const coldId='ICE_WRAITH';
  spawnTestMob(coldId);
  combatEvents.length=0;
  const coldBefore=species[coldId].hp;
  assert.equal(mobs.damageAt(0,9,10,{source:'hero',kind:'flame',element:'fire'}), true, 'fire can hit a cold biome threat');
  const coldAfter=mobs.serialize().list[0].hp;
  assert.ok(coldBefore-coldAfter >= 11.9, 'cold biome threats retain the 20% thermal fire bonus');
  assert.ok(combatEvents.some(e=>e && e.species===coldId && e.bonusDamagePct===20 && e.element==='fire'), 'thermal bonus still emits combat feedback');

  const mechXp=kill(id,{source:'hero_mech'});
  assert.ok(mechXp>species[id].xp*2,'captured-mech kills are credited with the dangerous-enemy bonus');
  mobs.deserialize({v:5,list:[],aggro:{mode:'rel',m:{}},xpFatigue:{mode:'day',m:{}}});
  player.xp=0;
  events.length=0;
  combatEvents.length=0;

  const first=kill();
  const second=kill();
  const special=kill(id,{specialAttack:true});
  assert.ok(first>species[id].xp*2,'first hard kill pays far above authored base XP');
  assert.equal(second,first,'early repeat kills retain full XP during the fatigue grace run');
  assert.equal(special,second,'a special killing blow has the same XP value as every other weapon action');
  assert.equal(events[0].challenge,'hard','award detail names the risk tier');
  assert.ok(events[0].challengeRatio>1 && events[0].challengeMult>2,'award detail exposes comparison and multiplier to UI');
  assert.equal(events[0].risk,true,'hard reward is highlighted in world-space feedback');
  assert.equal(events[2].special,true,'event preserves special-kill semantics');
  assert.equal(events[2].specialMult,1,'special-hit feedback no longer carries a weapon-dependent XP multiplier');

  const snap=mobs.serialize();
  assert.equal(snap.xpFatigue.m[id].kills,3,'snapshot persists same-species fatigue kills');
  const fourth=kill();
  const fifth=kill();
  const sixth=kill();
  assert.equal(fourth,first,'fourth same-species kill is still inside the grace run');
  assert.equal(fifth,first,'fifth same-species kill is the last full-value repeat');
  assert.ok(sixth<first && Math.abs(sixth-Math.round(first*0.96))<=1,'fatigue begins gradually only after five full-value kills');
  dayFloat+=1.05;
  const reset=kill();
  assert.equal(reset,first,'one game day without that kill type resets fatigue');

  // A low-base center species that becomes a legitimate fight through distant
  // regional scaling must not still pay low-level pocket change.
  mobs.deserialize({v:5,list:[],aggro:{mode:'rel',m:{}},xpFatigue:{mode:'day',m:{}}});
  heroLevel=20;
  player.x=26000.5;
  player.xp=0;
  events.length=0;
  const farBisonXp=kill('THUNDER_BISON',{},26000.5);
  const farBisonEvent=events.at(-1);
  assert.ok(farBisonEvent && farBisonEvent.floorApplied,'level-appropriate distant variant receives the progression floor');
  assert.ok(farBisonXp/progression.xpNeed(20)>=0.035,'fair distant fight pays a meaningful share of the next level');
  assert.ok(farBisonEvent.progressionFloor>farBisonEvent.authoredCombatXp,'floor specifically repairs underpayment from the low center-species base');

  // Once development overtakes the mob, it cannot be used to reproduce the
  // earlier risk reward and its AI yields even after being provoked.
  heroLevel=20;
  player.x=0.5;
  player.xp=0;
  events.length=0;
  const trivial=challengeFor('WOLF');
  assert.equal(trivial.trivial,true,'old low-tier opponent crosses the explicit trivial threshold');
  assert.equal(trivial.challengeMult,0,'trivial challenge has a hard zero multiplier');
  assert.equal(kill('WOLF'),0,'killing a trivial opponent awards zero XP');
  assert.equal(events.length,0,'zero-XP kills do not create fake positive award numbers');
  assert.ok(messages.some(t=>t.includes('0 EXP')),'first hunted trivial enemy explains why no XP was paid');

  // Weapon-neutral rewards do not weaken the existing fear response: a fresh
  // hero holding an extreme weapon still scares an otherwise relevant wolf.
  heroLevel=1;
  heroAttack=300;
  spawnTestMob('WOLF',3.5);
  mobs.setAggro('WOLF');
  assert.equal(mobs.damageAt(3,9,1,{source:'hero'}),true,'strong-weapon threat can provoke a living mob');
  simNow+=16;
  mobs.update(1/30,player,world.getTile,world.setTile);
  const weaponFleeing=mobs.serialize().list.find(m=>m.id==='WOLF');
  assert.ok(weaponFleeing && weaponFleeing.state==='flee_outmatched','mob AI still flees after seeing an overwhelmingly strong weapon');
  heroAttack=3;
  heroLevel=20;

  spawnTestMob('WOLF',3.5);
  mobs.setAggro('WOLF');
  let heroDamage=0;
  globalThis.damageHero=amount=>{ heroDamage+=amount; return true; };
  assert.equal(mobs.damageAt(3,9,1,{source:'hero'}),true,'a trivial mob can still be attacked for loot');
  simNow+=16;
  mobs.update(1/30,player,world.getTile,world.setTile);
  const fleeing=mobs.serialize().list.find(m=>m.id==='WOLF');
  assert.ok(fleeing && fleeing.state==='flee_outmatched','provoked trivial mob flees instead of switching back to attack AI');
  assert.ok(fleeing.vx>0,'mob on the right runs farther right, away from the hero');
  assert.equal(heroDamage,0,'outmatched mob cannot deal proactive contact damage while fleeing');

  assert.ok(combatEvents.some(e=>e && e.kind==='special' && e.special===true && e.finisher===true), 'special mob kill still emits finisher feedback');
  assert.equal(combatEvents.some(e=>e && e.kind==='special_xp'),false,'XP bonus does not duplicate combat numbers');

  const model=createVitalsModel();
  assert.equal(model.noteXpAward({amount:42,special:true,fatigueMult:0.91}),true,'HUD model accepts rich XP award details');
  let st=model.update({hp:100,maxHp:100,en:20,enMax:40,level:1,xpInto:42,xpNeed:60,buffs:[]},1/60);
  assert.equal(st.xpDeltas.length,1,'XP award queues a HUD record');
  assert.equal(st.xpDeltas[0].v,42,'XP record stores the awarded amount');
  for(let t=0;t<1.5;t+=1/60) st=model.update({hp:100,maxHp:100,en:20,enMax:40,level:1,xpInto:42,xpNeed:60,buffs:[]},1/60);
  assert.equal(st.xpDeltas.length,0,'XP record ages out');
  assert.ok(vitalsHud.noteXpAward({amount:7}),'exported HUD API accepts XP awards');
} finally {
  mobs.clearAll();
  delete globalThis.msg;
  delete globalThis.damageHero;
}

console.log('mob-xp-rewards-sim: all assertions passed');
