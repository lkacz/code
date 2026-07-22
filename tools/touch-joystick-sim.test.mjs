import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
	nextTouchActionMode,
	normalizeTouchActionMode,
	normalizeTouchGridTarget,
	quantizeTouchDirection,
	sampleTouchStick,
	stepTouchGridTarget,
	touchMovementIntent
} from '../src/engine/touch_joystick.js';

function close(actual,expected,message,epsilon=1e-10){
	assert.ok(
		Math.abs(actual-expected)<=epsilon,
		`${message}: expected ${expected}, received ${actual}`
	);
}

// --- 1. The dead zone suppresses drift, then remaps the usable radius to 0..1.
{
	const centered=sampleTouchStick({x:50,y:50},{x:59,y:50},{range:100,deadZone:0.1});
	assert.equal(centered.active,false,'motion inside the dead zone is inactive');
	assert.equal(centered.magnitude,0,'motion inside the dead zone has no filtered magnitude');
	assert.equal(centered.x,0,'motion inside the dead zone has no horizontal output');
	assert.equal(centered.displayX,9,'the knob still follows the finger inside the dead zone');

	const boundary=sampleTouchStick({x:0,y:0},{x:10,y:0},{range:100,deadZone:0.1});
	assert.equal(boundary.active,false,'the exact dead-zone boundary remains neutral');

	const outside=sampleTouchStick({x:0,y:0},{x:20,y:0},{range:100,deadZone:0.1});
	close(outside.rawMagnitude,0.2,'raw magnitude is normalized against the stick range');
	close(outside.magnitude,1/9,'usable travel is remapped after the dead zone');
	close(outside.x,1/9,'filtered horizontal output retains its analog magnitude');
	assert.equal(outside.y,0);
	assert.equal(outside.active,true,'motion beyond the dead zone is active');
}

// --- 2. Over-travel is radially clamped without changing direction.
{
	const sample=sampleTouchStick({x:10,y:20},{x:70,y:100},{range:50,deadZone:0});
	close(sample.rawMagnitude,1,'reported raw magnitude is capped at one');
	close(sample.magnitude,1,'filtered magnitude reaches one at maximum travel');
	close(sample.unitX,0.6,'unit direction preserves the horizontal component');
	close(sample.unitY,0.8,'unit direction preserves the vertical component');
	close(sample.x,0.6,'normalized output preserves radial direction');
	close(sample.y,0.8,'normalized output preserves radial direction');
	close(sample.displayX,30,'display travel is radially clamped on x');
	close(sample.displayY,40,'display travel is radially clamped on y');
	close(Math.hypot(sample.displayX,sample.displayY),50,'clamped knob stays on the range circle');
}

// --- 3. Horizontal movement has a threshold but remains analog beyond it.
{
	const neutral=touchMovementIntent({x:0.19,y:0},{horizontalThreshold:0.2});
	assert.deepEqual(neutral,{left:false,right:false,up:false,down:false,axisX:0,axisY:0});

	const right=touchMovementIntent({x:0.55,y:0},{horizontalThreshold:0.2});
	assert.equal(right.right,true,'positive travel selects right movement');
	assert.equal(right.left,false);
	assert.equal(right.axisX,0.55,'horizontal intent retains analog strength');

	const left=touchMovementIntent({x:-0.72,y:0},{horizontalThreshold:0.2});
	assert.equal(left.left,true,'negative travel selects left movement');
	assert.equal(left.right,false);
	assert.equal(left.axisX,-0.72,'left movement retains signed analog strength');
}

// --- 4. Vertical gestures engage exactly at their independent threshold.
{
	const almostUp=touchMovementIntent({x:0,y:-0.459},{verticalThreshold:0.46});
	assert.equal(almostUp.up,false,'a near-threshold upward wobble remains neutral');
	assert.equal(almostUp.axisY,0);

	const up=touchMovementIntent({x:0,y:-0.46},{verticalThreshold:0.46});
	assert.equal(up.up,true,'up engages at the configured threshold');
	assert.equal(up.down,false);
	assert.equal(up.axisY,-0.46);

	const down=touchMovementIntent({x:0,y:0.7},{verticalThreshold:0.46});
	assert.equal(down.down,true,'down engages beyond the configured threshold');
	assert.equal(down.up,false);
	assert.equal(down.axisY,0.7);
}

// --- 5. Tool/action aim quantizes consistently through every 45-degree sector.
{
	assert.equal(
		quantizeTouchDirection({x:0.07,y:0},{minMagnitude:0.08}),
		null,
		'aim below the minimum magnitude has no direction'
	);

	const cases=[
		[{x:1,y:0},{dx:1,dy:0,octant:0},'right'],
		[{x:1,y:1},{dx:1,dy:1,octant:1},'down-right'],
		[{x:0,y:1},{dx:0,dy:1,octant:2},'down'],
		[{x:-1,y:1},{dx:-1,dy:1,octant:3},'down-left'],
		[{x:-1,y:0},{dx:-1,dy:0,octant:4},'left'],
		[{x:-1,y:-1},{dx:-1,dy:-1,octant:5},'up-left'],
		[{x:0,y:-1},{dx:0,dy:-1,octant:6},'up'],
		[{x:1,y:-1},{dx:1,dy:-1,octant:7},'up-right']
	];

	for(const [sample,expected,label] of cases){
		const actual=quantizeTouchDirection(sample);
		assert.deepEqual(
			{dx:actual.dx,dy:actual.dy,octant:actual.octant},
			expected,
			`${label} maps to the expected octant`
		);
	}
}

// --- 6. Action modes are explicit; grid targets advance exactly one tile.
{
	assert.equal(normalizeTouchActionMode('mine'),'mine');
	assert.equal(normalizeTouchActionMode('unknown'),'mine','unknown persisted modes safely fall back to mining');
	assert.equal(nextTouchActionMode('mine'),'build');
	assert.equal(nextTouchActionMode('build'),'combat');
	assert.equal(nextTouchActionMode('combat'),'mine');

	assert.deepEqual(normalizeTouchGridTarget(null,{fallback:{x:-1,y:0},maxDistance:3}),{x:-1,y:0,maxDistance:3});
	assert.deepEqual(normalizeTouchGridTarget({x:8,y:-7},{maxDistance:3}),{x:3,y:-3,maxDistance:3},'stored targets are clamped to reach');
	const up=stepTouchGridTarget({x:1,y:0},{dx:0,dy:-1},{maxDistance:3});
	assert.deepEqual(up,{x:1,y:-1,maxDistance:3,changed:true},'up changes only one row');
	const left=stepTouchGridTarget(up,{dx:-1,dy:0},{maxDistance:3});
	assert.deepEqual(left,{x:0,y:-1,maxDistance:3,changed:true},'left changes only one column');
	const centre=stepTouchGridTarget({x:1,y:0},{dx:-1,dy:0},{maxDistance:3});
	assert.deepEqual(centre,{x:0,y:0,maxDistance:3,changed:true},'the hero tile is traversed rather than skipped');
	const edge=stepTouchGridTarget({x:3,y:-2},{dx:1,dy:0},{maxDistance:3});
	assert.deepEqual(edge,{x:3,y:-2,maxDistance:3,changed:false},'presses stop cleanly at reach');
}

// --- 7. Integration seams keep joystick and direct-touch interaction parallel.
{
	const mainSource=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
	const indexSource=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
	const dropsSource=fs.readFileSync(new URL('../src/engine/drops.js',import.meta.url),'utf8');
	assert.match(mainSource,/moveStickController=createTouchJoystick/,'the movement zone is bound as a joystick');
	assert.match(mainSource,/actionStickController=createTouchJoystick[\s\S]{0,180}canStart:\(\)=>touchActionMode==='combat'/,'the right stick activates only for combat');
	assert.match(mainSource,/let input=moveControl\.x/,'touch movement reaches physics as an analog horizontal axis');
	assert.match(mainSource,/jumpHeldEarly=!!keys\[' '\] \|\| touchJumpHeld/,'the dedicated jump button participates in jump physics');
	assert.match(mainSource,/jumpBtn[\s\S]{0,900}queueJumpInput\(' '\)/,'every dedicated jump press queues a discrete jump, including mid-air jumps');
	assert.match(mainSource,/pickupOpts=\{visible:worldFxVisible,hitScale:e\.pointerType==='touch'\?1\.5:1\}/,'direct touch taps receive a forgiving single-drop target');
	assert.doesNotMatch(mainSource,/e\.pointerType!=='touch' && DROPS && DROPS\.pickupAt/,'touch pickup is not excluded from canvas selection');
	assert.match(mainSource,/MOBS\.nearestLiving\(aim\.x,aim\.y,0\.9\)/,'a direct touch can snap to the specifically tapped mob');
	assert.match(mainSource,/e\.pointerType==='touch' && touchPlaceMode/,'placement is explicit while ordinary canvas taps remain mine, attack, collect, or interact');
	assert.match(mainSource,/setTouchActionMode\(nextTouchActionMode\(touchActionMode\)\)/,'the mode button explicitly cycles the right-stick action');
	assert.match(mainSource,/nudgeTouchGridTarget\(Number\(button\.dataset\.dx\)[\s\S]{0,120}Number\(button\.dataset\.dy\)/,'grid buttons advance the selected tile explicitly');
	assert.match(mainSource,/if\(mode==='mine'\)[\s\S]{0,500}startTouchSelectedMine\(\)[\s\S]{0,300}else if\(mode==='build'\)/,'the contextual action button executes mining and building after target selection');
	assert.match(mainSource,/drawTouchActionTarget\(\)/,'the selected tile or combat aim has a persistent world cursor');
	assert.doesNotMatch(mainSource,/function applyActionStickSample\(sample\)[\s\S]{0,900}armTouchActionWeapon\(\)/,'moving the right stick alone never starts an attack');
	assert.match(indexSource,/id="actionModeBtn"[\s\S]{0,300}touchModeLabel">TRYB/,'the touch rail exposes a labelled action-mode switch');
	assert.match(indexSource,/id="actionModeBtn"[\s\S]{0,240}touchModeIcon">↻/,'the mode switch uses a neutral change symbol instead of duplicating the active action');
	assert.match(indexSource,/id="touchGridUp"[\s\S]{0,900}id="touchGridDown"/,'the grid selector exposes four directions and a centre reset');
	assert.match(indexSource,/id="fireBtn"[\s\S]{0,300}touchActionLabel">KOP/,'the contextual trigger states the action it will perform');
	assert.doesNotMatch(indexSource,/id="radarBtn"/,'the unexplained compass button no longer occupies the primary touch rail');
	assert.match(dropsSource,/const hitScale=Math\.max\(1,Math\.min\(1\.8/,'drop hit enlargement is bounded');
}

console.log('touch-joystick-sim: all assertions passed');
