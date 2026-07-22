// Touch joystick geometry and pointer binding.
//
// The geometry helpers are deliberately DOM-free so the dead zone, clamping,
// movement thresholds and eight-way tool direction remain regression-testable.
// createTouchJoystick only owns one pointer and one pair of visual elements; the
// game decides what a sampled vector means (movement, mining, aiming, and so on).

export const TOUCH_STICK_DEFAULTS=Object.freeze({
	deadZone:0.18,
	horizontalThreshold:0.20,
	verticalThreshold:0.46
});

export const TOUCH_ACTION_MODES=Object.freeze(['mine','build','combat']);

function finite(value,fallback){
	value=Number(value);
	return Number.isFinite(value)?value:fallback;
}

export function sampleTouchStick(origin,point,opts){
	opts=opts||{};
	const ox=finite(origin&&origin.x,0), oy=finite(origin&&origin.y,0);
	const px=finite(point&&point.x,ox), py=finite(point&&point.y,oy);
	const range=Math.max(1,finite(opts.range,48));
	const deadZone=Math.max(0,Math.min(0.8,finite(opts.deadZone,TOUCH_STICK_DEFAULTS.deadZone)));
	const rawX=px-ox, rawY=py-oy;
	const rawDistance=Math.hypot(rawX,rawY);
	const scale=rawDistance>range && rawDistance>0 ? range/rawDistance : 1;
	const displayX=rawX*scale, displayY=rawY*scale;
	const magnitude=Math.min(1,rawDistance/range);
	const filteredMagnitude=magnitude<=deadZone ? 0 : (magnitude-deadZone)/(1-deadZone);
	const ux=rawDistance>0?rawX/rawDistance:0, uy=rawDistance>0?rawY/rawDistance:0;
	return {
		x:ux*filteredMagnitude,
		y:uy*filteredMagnitude,
		unitX:ux,
		unitY:uy,
		magnitude:filteredMagnitude,
		rawMagnitude:magnitude,
		displayX,
		displayY,
		active:filteredMagnitude>0
	};
}

export function touchMovementIntent(sample,opts){
	opts=opts||{};
	const h=Math.max(0.05,Math.min(0.9,finite(opts.horizontalThreshold,TOUCH_STICK_DEFAULTS.horizontalThreshold)));
	const v=Math.max(0.05,Math.min(0.95,finite(opts.verticalThreshold,TOUCH_STICK_DEFAULTS.verticalThreshold)));
	const x=finite(sample&&sample.x,0), y=finite(sample&&sample.y,0);
	return {
		left:x<=-h,
		right:x>=h,
		up:y<=-v,
		down:y>=v,
		axisX:Math.abs(x)>=h?x:0,
		axisY:Math.abs(y)>=v?y:0
	};
}

export function quantizeTouchDirection(sample,opts){
	opts=opts||{};
	const min=Math.max(0,Math.min(0.95,finite(opts.minMagnitude,0.08)));
	const x=finite(sample&&sample.x,0), y=finite(sample&&sample.y,0);
	const magnitude=Math.hypot(x,y);
	if(magnitude<min) return null;
	const angle=Math.atan2(y,x);
	const octant=Math.round(angle/(Math.PI/4));
	const dx=Math.round(Math.cos(octant*Math.PI/4));
	const dy=Math.round(Math.sin(octant*Math.PI/4));
	return {dx,dy,octant:(octant+8)%8,angle};
}

export function normalizeTouchActionMode(value,fallback){
	const safeFallback=TOUCH_ACTION_MODES.includes(fallback)?fallback:'mine';
	return TOUCH_ACTION_MODES.includes(value)?value:safeFallback;
}

export function nextTouchActionMode(value){
	const mode=normalizeTouchActionMode(value);
	return TOUCH_ACTION_MODES[(TOUCH_ACTION_MODES.indexOf(mode)+1)%TOUCH_ACTION_MODES.length];
}

// Grid actions keep the eight-way direction, while radial travel selects how
// far along that direction the cursor sits. A tiny deliberate movement always
// selects the adjacent tile; full travel reaches maxDistance.
export function touchTargetSelection(sample,opts){
	opts=opts||{};
	const fallback=opts.fallback||{dx:1,dy:0};
	const direction=quantizeTouchDirection(sample,{minMagnitude:opts.minMagnitude})
		|| quantizeTouchDirection({x:fallback.dx,y:fallback.dy},{minMagnitude:0.01})
		|| {dx:1,dy:0,octant:0,angle:0};
	const maxDistance=Math.max(1,Math.min(8,Math.trunc(finite(opts.maxDistance,3))));
	const vectorMagnitude=Math.hypot(finite(sample&&sample.x,0),finite(sample&&sample.y,0));
	const magnitude=Math.max(0,Math.min(1,finite(sample&&sample.magnitude,vectorMagnitude)));
	const distance=Math.max(1,Math.min(maxDistance,Math.ceil(magnitude*maxDistance)));
	return {
		dx:direction.dx,
		dy:direction.dy,
		octant:direction.octant,
		distance,
		offsetX:direction.dx*distance,
		offsetY:direction.dy*distance
	};
}

function zeroSample(){
	return {x:0,y:0,unitX:0,unitY:0,magnitude:0,rawMagnitude:0,displayX:0,displayY:0,active:false};
}

export function createTouchJoystick(element,opts){
	if(!element || typeof element.addEventListener!=='function') return null;
	opts=opts||{};
	const base=element.querySelector(opts.baseSelector||'.touchStickBase');
	const knob=element.querySelector(opts.knobSelector||'.touchStickKnob');
	let pointerId=null;
	let origin={x:0,y:0};
	let last=zeroSample();

	function range(){
		const rect=base && base.getBoundingClientRect ? base.getBoundingClientRect() : null;
		return Math.max(24,finite(opts.range,rect&&rect.width?rect.width*0.34:42));
	}
	function paint(sample){
		if(knob && knob.style){
			knob.style.setProperty('--stick-x',sample.displayX.toFixed(2)+'px');
			knob.style.setProperty('--stick-y',sample.displayY.toFixed(2)+'px');
		}
		element.classList.toggle('active',!!sample.active);
	}
	function localPoint(ev){
		const rect=element.getBoundingClientRect();
		return {x:ev.clientX-rect.left,y:ev.clientY-rect.top,rect};
	}
	function placeBase(point){
		if(!base || !base.style) return;
		const br=base.getBoundingClientRect();
		const radius=Math.max(24,Math.min(br.width||112,br.height||112)/2);
		const x=Math.max(radius,Math.min(point.rect.width-radius,point.x));
		const y=Math.max(radius,Math.min(point.rect.height-radius,point.y));
		origin={x,y};
		base.style.left=x.toFixed(2)+'px';
		base.style.top=y.toFixed(2)+'px';
	}
	function emit(ev){
		const p=localPoint(ev);
		last=sampleTouchStick(origin,p,{range:range(),deadZone:opts.deadZone});
		paint(last);
		if(typeof opts.onChange==='function') opts.onChange(last,ev);
		return last;
	}
	function finish(ev,cancelled){
		if(pointerId==null || (ev && ev.pointerId!=null && ev.pointerId!==pointerId)) return false;
		const ended=last;
		const endedPointer=pointerId;
		pointerId=null;
		last=zeroSample();
		paint(last);
		element.classList.remove('engaged');
		if(opts.floating!==false && base && base.style){ base.style.left=''; base.style.top=''; }
		if(typeof opts.onEnd==='function') opts.onEnd(ended,ev||{pointerId:endedPointer},!!cancelled);
		return true;
	}
	function down(ev){
		if(pointerId!=null || (opts.touchOnly!==false && ev.pointerType==='mouse')) return;
		ev.preventDefault();
		pointerId=ev.pointerId;
		const p=localPoint(ev);
		if(opts.floating!==false) placeBase(p); else origin={x:p.rect.width/2,y:p.rect.height/2};
		try{ element.setPointerCapture(ev.pointerId); }catch(e){ /* capture is an enhancement */ }
		element.classList.add('engaged');
		last=sampleTouchStick(origin,p,{range:range(),deadZone:opts.deadZone});
		paint(last);
		if(typeof opts.onStart==='function') opts.onStart(last,ev);
		if(typeof opts.onChange==='function') opts.onChange(last,ev);
	}
	function move(ev){
		if(ev.pointerId!==pointerId) return;
		ev.preventDefault();
		emit(ev);
	}
	function up(ev){ if(ev.pointerId===pointerId){ ev.preventDefault(); finish(ev,false); } }
	function cancelEvent(ev){ if(ev.pointerId===pointerId) finish(ev,true); }

	element.addEventListener('pointerdown',down);
	element.addEventListener('pointermove',move);
	element.addEventListener('pointerup',up);
	element.addEventListener('pointercancel',cancelEvent);
	element.addEventListener('lostpointercapture',cancelEvent);

	return {
		active:()=>pointerId!=null,
		pointerId:()=>pointerId,
		sample:()=>Object.assign({},last),
		cancel:()=>finish(null,true),
		destroy(){
			finish(null,true);
			element.removeEventListener('pointerdown',down);
			element.removeEventListener('pointermove',move);
			element.removeEventListener('pointerup',up);
			element.removeEventListener('pointercancel',cancelEvent);
			element.removeEventListener('lostpointercapture',cancelEvent);
		}
	};
}
