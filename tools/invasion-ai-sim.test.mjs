// Node simulation tests for the team-agnostic invasion AI:
// pathfinding (walk / climb / jump / drop), line of sight, cover search,
// separation, role assignment and squad-brain tactics (approach, strike,
// flee, siege/breach, engineer builds).
import assert from 'node:assert/strict';
import {
  applySeparation,
  assignRoles,
  beginAIFrame,
  createNav,
  createSquadBrain,
  makeTeamProfile,
  DEFAULT_ROLES
} from '../src/engine/invasion_ai.js';

// --- tiny tile world -------------------------------------------------------
// 0 = air, 1 = solid. Default terrain: flat solid ground for y >= 50.
const solids = new Map();
const holes = new Set();
function key(x,y){ return x+','+y; }
function setSolid(x,y){ solids.set(key(x,y),1); }
function clearSolid(x,y){ holes.add(key(x,y)); }
function resetWorld(){ solids.clear(); holes.clear(); }
const world = {
  readTile(x,y){
    const k = key(x,y);
    if(solids.has(k)) return 1;
    if(holes.has(k)) return 0;
    return y >= 50 ? 1 : 0;
  },
  isOpen:t=>t===0,
  isSolid:t=>t===1,
  minY:-100,
  maxY:300
};
const nav = createNav(world);

// --- pathfinding -----------------------------------------------------------
resetWorld();
let res = nav.findPath(0.5, 50, 20.5, 50);
assert.ok(res && res.reached, 'flat ground path reaches the goal');
const flatEnd = res.path[res.path.length-1];
assert.equal(flatEnd.x, 20, 'flat path ends at the goal column');
for(const wp of res.path) assert.ok(nav.canStand(wp.x, wp.y), 'every flat waypoint is standable');

// staircase: each step one tile higher starting at x=5
resetWorld();
for(let i=0;i<5;i++) for(let x=5+i; x<30; x++) setSolid(x, 49-i);
res = nav.findPath(0.5, 50, 20.5, 45);
assert.ok(res && res.reached, 'stair path climbs one-tile steps to the goal');

// jump-worthy ledge: a two-tall platform requires a jump edge
resetWorld();
for(let x=10; x<30; x++){ setSolid(x,49); setSolid(x,48); }
res = nav.findPath(0.5, 50, 20.5, 47);
assert.ok(res && res.reached, 'two-tall ledge is climbable via a jump edge');
assert.ok(res.path.some(wp=>wp.jump), 'ledge path marks at least one waypoint as a jump');

// unreachable: a tall smooth wall, goal behind it
resetWorld();
for(let y=38; y<50; y++) setSolid(12,y);
res = nav.findPath(0.5, 50, 25.5, 50);
assert.ok(res && !res.reached, 'a 12-tall wall makes the goal unreachable');
assert.ok(res.path.length >= 1, 'unreachable goals still produce a best-effort partial path');
const partialEnd = res.path[res.path.length-1];
assert.ok(partialEnd.x <= 12, 'partial path presses toward the wall, not past it');

// gap crossing: 2-wide pit is jumped, waypoint flagged
resetWorld();
for(let y=50; y<60; y++){ clearSolid(8,y); clearSolid(9,y); }
res = nav.findPath(0.5, 50, 20.5, 50);
assert.ok(res && res.reached, 'a two-wide pit can be crossed');
assert.ok(res.path.some(wp=>wp.jump), 'pit crossing is marked as a jump');

// drop down: goal on a lower shelf
resetWorld();
for(let x=-20; x<10; x++) for(let y=44; y<50; y++) setSolid(x,y);
res = nav.findPath(0.5, 44, 20.5, 50);
assert.ok(res && res.reached, 'units drop off ledges toward lower goals');

// --- line of sight & cover -------------------------------------------------
resetWorld();
let sight = nav.los(0.5, 49.5, 10.5, 49.5, 24);
assert.equal(sight.clear, true, 'open air line of sight is clear');
for(let y=46; y<50; y++) setSolid(6,y);
sight = nav.los(0.5, 49.5, 10.5, 49.5, 24);
assert.equal(sight.clear, false, 'a wall blocks line of sight');
assert.equal(sight.tx, 6, 'blocked sight reports the blocking tile column');

const cover = nav.findCoverSpot(8.5, 50, 0.5, 50, {minHeroDist:3});
assert.ok(cover, 'a unit near a wall finds a cover spot');
const coverSight = nav.los(0.5, 49.5, cover.x+0.5, cover.y-0.5, 26);
assert.equal(coverSight.clear, false, 'the chosen cover spot is hidden from the hero');

// --- separation ------------------------------------------------------------
const ua = {x:5.0, y:50, vx:0, vy:0, hp:10, maxHp:10, dead:false};
const ub = {x:5.05, y:50, vx:0, vy:0, hp:10, maxHp:10, dead:false};
for(let i=0;i<12;i++) applySeparation([ua,ub], {radius:0.30});
assert.ok(Math.abs(ua.x-ub.x) >= 0.5, 'overlapping units are pushed apart to bump distance');
const heroPush = {x:2.02, y:50, vx:0, vy:0, hp:10, maxHp:10, dead:false};
applySeparation([heroPush], {radius:0.30, hero:{x:2.0, y:50}});
assert.ok(heroPush.x > 2.02, 'units overlapping the hero are shouldered aside');

// --- profiles & roles ------------------------------------------------------
const profile = makeTeamProfile({kind:'aliens'});
const roles6 = assignRoles(6, profile);
assert.equal(roles6.length, 6, 'role rollout covers the whole squad');
assert.ok(new Set(roles6).size >= 4, 'a six-unit squad fields at least four distinct tactics');
assert.deepEqual(assignRoles(1, profile), ['rusher'], 'a lone invader defaults to direct assault');
assert.ok(roles6.includes('tank') && roles6.includes('healer'), 'opening alien squads include tank and healer support roles');
const packProfile = makeTeamProfile({kind:'wolves', roles:{rusher:{weight:3}, flanker:{weight:2}}});
const packRoles = assignRoles(8, packProfile);
assert.ok(packRoles.every(r=>r==='rusher'||r==='flanker'), 'custom team profiles restrict the role pool');
assert.ok(Object.keys(DEFAULT_ROLES).length >= 8, 'default role table ships diverse tactics');

// --- squad brain -----------------------------------------------------------
function makeUnit(id, x, role){
  return {id, x, y:50, vx:0, vy:0, hp:24, maxHp:24, attackCd:0.4, onGround:true, facing:1, dead:false, lastHitAt:0, role};
}
function simulate(brainTeam, units, hero, hooks, seconds, dt){
  const brain = brainTeam.brain;
  let now = 1000;
  for(let t=0; t<seconds; t+=dt){
    now += dt*1000;
    beginAIFrame();
    brain.update(brainTeam.team, units, dt, hero, hooks, {now});
    for(const u of units){
      if(u.dead || u.hp<=0) continue;
      const intent = u._ai.intent;
      u.x += intent.moveX * 2.5 * (intent.speedMult||1) * dt;
      u.attackCd = Math.max(0, (u.attackCd||0) - dt);
      u.lastNow = now;
    }
  }
  return now;
}

// approach + strike: a rusher closes distance and opens fire
resetWorld();
{
  const team = {id:'t1', builtTiles:[]};
  const brain = createSquadBrain(profile, nav);
  const unit = makeUnit('u1', 30.5, 'rusher');
  const fires = [];
  const hooks = {
    fire:(u,opts)=>{ fires.push(opts||{}); return {clear:true}; },
    tileAttack:()=>true,
    isBreachableTile:()=>false,
    canBuildAt:()=>false,
    build:()=>false
  };
  simulate({team, brain}, [unit], {x:10.5, y:50, vx:0, vy:0}, hooks, 12, 0.1);
  const dist = Math.abs(unit.x - 10.5);
  assert.ok(dist < 6, 'rusher closes to short engagement range (was 20 tiles out)');
  assert.ok(fires.length >= 3, 'rusher repeatedly fires once in range with a strike token');
}

// flee: a wounded, freshly-hit unit runs away from the hero
resetWorld();
{
  const team = {id:'t2', builtTiles:[]};
  const brain = createSquadBrain(profile, nav);
  const unit = makeUnit('u2', 13.5, 'rusher');
  unit.hp = 4; // 4/24 < 32% flee threshold
  const hooks = {fire:()=>({clear:true}), tileAttack:()=>true, isBreachableTile:()=>false, canBuildAt:()=>false, build:()=>false};
  let now = 1000;
  beginAIFrame();
  brain.update(team, [unit], 0.1, {x:10.5, y:50}, hooks, {now});
  unit.lastHitAt = now; // hit right now
  const startX = unit.x;
  simulate({team, brain}, [unit], {x:10.5, y:50}, hooks, 3, 0.1);
  assert.equal(unit._ai.state === 'flee' || unit.x - startX > 2, true, 'a hurt unit disengages');
  assert.ok(unit.x > startX + 1.5, 'the fleeing unit gains distance from the hero');
}

// support: a healer seeks and restores wounded allies
resetWorld();
{
  const team = {id:'tSupport', builtTiles:[]};
  const brain = createSquadBrain(profile, nav);
  const healer = makeUnit('healer1', 17.5, 'healer');
  const tank = makeUnit('tank1', 15.5, 'tank');
  tank.hp = 9;
  const heals = [];
  const hooks = {
    fire:()=>({clear:true}),
    heal:(u,target,amount)=>{ heals.push([u.id,target.id,amount]); target.hp = Math.min(target.maxHp, target.hp + amount); return true; },
    tileAttack:()=>true,
    isBreachableTile:()=>false,
    canBuildAt:()=>false,
    build:()=>false
  };
  simulate({team, brain}, [healer,tank], {x:10.5, y:50, vx:0, vy:0}, hooks, 4, 0.1);
  assert.ok(heals.some(h=>h[0] === 'healer1' && h[1] === 'tank1'), 'healer spends support actions on the wounded tank');
  assert.ok(tank.hp > 9, 'support healing restores ally health');
}

// repair: wounded aliens above the panic threshold return to the landed saucer
resetWorld();
{
  const team = {
    id:'tRepair',
    builtTiles:[],
    x:30.5,
    y:50,
    lander:{x:30.5,y:48.65,targetY:48.65,landed:true,destroyed:false}
  };
  const brain = createSquadBrain(profile, nav);
  const unit = makeUnit('repair1', 12.5, 'rusher');
  unit.hp = 8; // 33%: low enough to repair, high enough not to flee.
  unit.lastHitAt = 1000;
  const repairs = [];
  const hooks = {
    fire:()=>({clear:true}),
    heal:()=>false,
    repairAtLander:(u,amount)=>{ repairs.push([u.id,amount]); u.hp = Math.min(u.maxHp,u.hp+amount); return true; },
    tileAttack:()=>true,
    isBreachableTile:()=>false,
    canBuildAt:()=>false,
    build:()=>false
  };
  const startX = unit.x;
  simulate({team, brain}, [unit], {x:10.5,y:50,vx:0,vy:0}, hooks, 5, 0.1);
  assert.equal(unit._ai.state, 'repair', 'wounded alien prioritizes saucer repair over attacking');
  assert.ok(unit.x > startX + 8, 'repairing alien retreats toward the landed saucer');
  unit.x = team.x;
  unit.y = team.y;
  unit.hp = 8;
  unit.vx = 0;
  unit._ai.path = null;
  unit._ai.repathIn = 0;
  simulate({team, brain}, [unit], {x:10.5,y:50,vx:0,vy:0}, hooks, 1, 0.1);
  assert.ok(repairs.length > 0, 'saucer repair hook charges health near the lander');
  assert.ok(unit.hp > 8, 'saucer repair restores alien health');
}

// unstuck: a unit that keeps trying to move but does not advance asks the host to dig it out
resetWorld();
{
  const team = {id:'tStuck', builtTiles:[]};
  const brain = createSquadBrain(profile, nav);
  const unit = makeUnit('stuck1', 12.5, 'rusher');
  const unstucks = [];
  const hooks = {
    fire:()=>({clear:true}),
    unstuck:(u,opts)=>{ unstucks.push([u.id,opts && opts.dir]); return true; },
    tileAttack:()=>true,
    isBreachableTile:()=>false,
    canBuildAt:()=>false,
    build:()=>false
  };
  let now = 1000;
  for(let i=0;i<14;i++){
    now += 100;
    beginAIFrame();
    brain.update(team, [unit], 0.1, {x:32.5,y:50,vx:0,vy:0}, hooks, {now});
    unit.attackCd = Math.max(0, (unit.attackCd || 0) - 0.1);
  }
  assert.ok(unstucks.length > 0, 'stuck watchdog asks host escape logic to clear a blockage');
  assert.ok(unstucks.some(u=>u[1] > 0), 'unstuck hook receives the last attempted movement direction');
}

// siege: hero sealed in a shelter -> squad switches modes and attacks the shell
resetWorld();
{
  for(let x=8; x<=12; x++) for(let y=46; y<=52; y++){
    if(x===8 || x===12 || y===46 || y===52) setSolid(x,y);
    else clearSolid(x,y);
  }
  const team = {id:'t3', builtTiles:[]};
  const brain = createSquadBrain(profile, nav);
  const unit = makeUnit('u3', 20.5, 'sapper');
  const tileHits = [];
  const breachFires = [];
  const modes = [];
  const hooks = {
    fire:(u,opts)=>{ if(opts && opts.breach) breachFires.push([opts.aimX,opts.aimY]); return {blocked:true}; },
    tileAttack:(u,tx,ty)=>{ tileHits.push([tx,ty]); return true; },
    isBreachableTile:(tx,ty)=>world.readTile(tx,ty)===1,
    canBuildAt:()=>false,
    build:()=>false,
    onModeChange:m=>modes.push(m)
  };
  simulate({team, brain}, [unit], {x:10.5, y:51, vx:0, vy:0}, hooks, 14, 0.1);
  assert.equal(brain.mode, 'siege', 'a sealed hero flips the squad into siege mode');
  assert.ok(modes.includes('siege'), 'mode transitions are reported to the host');
  assert.ok(tileHits.length + breachFires.length >= 1, 'siege units attack the shelter shell');
}

// engineer: builds barricade tiles, then takes cover behind them
resetWorld();
{
  const team = {id:'t4', builtTiles:[]};
  const brain = createSquadBrain(profile, nav);
  const unit = makeUnit('u4', 18.5, 'engineer');
  const builds = [];
  const hooks = {
    fire:()=>({clear:true}),
    tileAttack:()=>true,
    isBreachableTile:()=>false,
    canBuildAt:(tx,ty)=>world.readTile(tx,ty)===0,
    build:(u,tx,ty)=>{ builds.push([tx,ty]); setSolid(tx,ty); team.builtTiles.push({x:tx,y:ty}); return true; }
  };
  simulate({team, brain}, [unit], {x:10.5, y:50, vx:0, vy:0}, hooks, 10, 0.1);
  assert.ok(builds.length >= 2, 'engineer raises a barricade of at least two tiles');
  assert.ok(team.builtTiles.length === builds.length, 'every placed tile is tracked for cleanup');
  const [bx] = builds[0];
  assert.ok(Math.abs(bx - 10.5) > 2.4, 'barricades are not dropped on top of the hero');
}

// attack tokens: large squads do not all shoot at once
resetWorld();
{
  const team = {id:'t5', builtTiles:[]};
  const brain = createSquadBrain(profile, nav);
  const units = [];
  for(let i=0;i<8;i++) units.push(makeUnit('m'+i, 13 + i*0.8, 'rusher'));
  const hooks = {fire:()=>({clear:true}), tileAttack:()=>true, isBreachableTile:()=>false, canBuildAt:()=>false, build:()=>false};
  // two ticks: LoS is measured while stepping units, tokens grant next frame
  for(let i=0;i<2;i++){
    beginAIFrame();
    brain.update(team, units, 0.1, {x:10.5, y:50}, hooks, {now:1000+i*100});
  }
  const tokens = units.filter(u=>u._ai.token).length;
  assert.ok(tokens >= 1 && tokens <= 3, 'strike tokens limit simultaneous shooters ('+tokens+' of 8)');
}

console.log('invasion-ai-sim: all assertions passed');
