import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
	quantizeTouchDirection,
	sampleTouchStick,
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

// --- 6. Integration seams keep joystick and direct-touch interaction parallel.
{
	const mainSource=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
	const dropsSource=fs.readFileSync(new URL('../src/engine/drops.js',import.meta.url),'utf8');
	assert.match(mainSource,/moveStickController=createTouchJoystick/,'the movement zone is bound as a joystick');
	assert.match(mainSource,/actionStickController=createTouchJoystick/,'the contextual action zone is bound as a joystick');
	assert.match(mainSource,/let input=moveControl\.x/,'touch movement reaches physics as an analog horizontal axis');
	assert.match(mainSource,/jumpHeldEarly=!!keys\[' '\] \|\| touchJumpHeld/,'the dedicated jump button participates in jump physics');
	assert.match(mainSource,/jumpBtn[\s\S]{0,900}queueJumpInput\(' '\)/,'every dedicated jump press queues a discrete jump, including mid-air jumps');
	assert.match(mainSource,/pickupOpts=\{visible:worldFxVisible,hitScale:e\.pointerType==='touch'\?1\.5:1\}/,'direct touch taps receive a forgiving single-drop target');
	assert.doesNotMatch(mainSource,/e\.pointerType!=='touch' && DROPS && DROPS\.pickupAt/,'touch pickup is not excluded from canvas selection');
	assert.match(mainSource,/MOBS\.nearestLiving\(aim\.x,aim\.y,0\.9\)/,'a direct touch can snap to the specifically tapped mob');
	assert.match(mainSource,/e\.pointerType==='touch' && touchPlaceMode/,'placement is explicit while ordinary canvas taps remain mine, attack, collect, or interact');
	assert.match(dropsSource,/const hitScale=Math\.max\(1,Math\.min\(1\.8/,'drop hit enlargement is bounded');
}

console.log('touch-joystick-sim: all assertions passed');
