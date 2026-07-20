// Audio engine regression tests. Two layers:
//  1. Static registry coverage — every sound name any module requests
//     (play/sfx/playSound/playReadyAudio literals + turret `sound:` configs)
//     must synthesize actual WebAudio nodes; a missing FX entry used to no-op
//     silently ('warning', 'thud', 'fire', 'spark' were dead for months).
//  2. Behavior against a mock AudioContext — mixer graph reaches the
//     destination through the limiter, positional plays pan/attenuate/cull,
//     submersion drives the underwater lowpass, ambience beds follow the
//     scene, the music director changes modes, movement foley fires, and
//     settings persist (including migration from pre-bus volume blobs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'src');

// ---------------- environment: fake clock, DOM shims, localStorage ----------
let nowMs = 1_000_000;
Date.now = () => nowMs;
globalThis.window = globalThis;
globalThis.MM = {};
globalThis.performance = { now: () => nowMs };
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
let winListeners = {};
globalThis.addEventListener = (t, f) => { (winListeners[t] = winListeners[t] || []).push(f); };
globalThis.removeEventListener = () => {};
function fireUnlock(){ for(const f of (winListeners.keydown || [])) f(); }

// ---------------- mock WebAudio -------------------------------------------
// Params record their automation events; setTargetAtTime also stamps .value so
// the engine's debugState (which reads .value live in a browser) is assertable.
class FakeParam {
  constructor(v){ this.value = v; this.events = []; }
  setValueAtTime(v, t){ this.events.push(['set', v, t]); this.value = v; }
  linearRampToValueAtTime(v, t){ this.events.push(['lin', v, t]); }
  exponentialRampToValueAtTime(v, t){ this.events.push(['exp', v, t]); }
  setTargetAtTime(v, t, tc){ this.events.push(['target', v, t, tc]); this.value = v; }
  cancelScheduledValues(t){ this.events.push(['cancel', t]); }
}
let lastCtx = null;
class FakeCtx {
  constructor(){
    this.sampleRate = 48000; this.currentTime = 0; this.state = 'running';
    this.nodes = [];
    this.destination = this._node('destination');
    lastCtx = this;
  }
  _node(kind, extra){
    const n = { kind, out: [], connect(t){ this.out.push(t); }, disconnect(){}, ...extra };
    this.nodes.push(n); return n;
  }
  resume(){ this.state = 'running'; }
  createGain(){ return this._node('gain', { gain: new FakeParam(1) }); }
  createOscillator(){ return this._node('osc', { type: 'sine', frequency: new FakeParam(440), detune: new FakeParam(0), start(t){ this.startedAt = t; }, stop(t){ this.stoppedAt = t; } }); }
  createBufferSource(){ return this._node('bufsrc', { buffer: null, loop: false, playbackRate: new FakeParam(1), start(t){ this.startedAt = t; }, stop(t){ this.stoppedAt = t; } }); }
  createBiquadFilter(){ return this._node('biquad', { type: 'lowpass', frequency: new FakeParam(350), Q: new FakeParam(1) }); }
  createDynamicsCompressor(){ return this._node('compressor', { threshold: new FakeParam(-24), knee: new FakeParam(30), ratio: new FakeParam(12), attack: new FakeParam(0.003), release: new FakeParam(0.25) }); }
  createStereoPanner(){ return this._node('panner', { pan: new FakeParam(0) }); }
  createConvolver(){ return this._node('convolver', { buffer: null }); }
  createDelay(){ return this._node('delay', { delayTime: new FakeParam(0) }); }
  createBuffer(ch, len, rate){
    const data = Array.from({ length: ch }, () => new Float32Array(len));
    return { duration: len / rate, numberOfChannels: ch, getChannelData: (i) => data[i] };
  }
}
function reaches(node, target, seen){
  seen = seen || new Set();
  if(node === target) return true;
  if(!node || seen.has(node)) return false;
  seen.add(node);
  return (node.out || []).some(n => reaches(n, target, seen));
}
function nodeCount(){ return lastCtx ? lastCtx.nodes.length : 0; }

// ---------------- phase A: no audio backend → latched silent no-op ---------
{
  const { audio } = await import('../src/engine/audio.js?phase=nobackend');
  assert.ok(audio, 'audio module exports');
  assert.doesNotThrow(() => { audio.play('dig'); audio.play('dig'); audio.update(0.1); },
    'no AudioContext: every entry point stays a silent no-op');
  assert.equal(audio.debugState().failed, true, 'missing backend latches ctxFailed (no per-frame retry storm)');
  winListeners = {}; // drop phase-A unlock handlers so they cannot build a stray ctx
}

// ---------------- phase B: full engine against the mock --------------------
globalThis.AudioContext = FakeCtx;
store['mm_audio_v1'] = JSON.stringify({ vol: 0.3, mute: false }); // pre-bus blob
const { audio: A, RADIO_STATIONS } = await import('../src/engine/audio.js?phase=main');
const { T } = await import('../src/constants.js');
assert.equal(MM.audio, A, 'module installs itself on MM');

// settings migration: old blobs keep their master volume, buses get defaults
assert.equal(A.getVolume(), 0.3, 'master volume migrates from the pre-bus settings blob');
assert.ok(A.getBusVolume('music') > 0 && A.getBusVolume('sfx') > 0, 'bus volumes default sensibly when absent from an old blob');

globalThis.player = { x: 0, y: 0, vx: 0, vy: 0, onGround: true };
fireUnlock();
assert.ok(A.isReady(), 'unlock gesture builds a running context');
assert.equal(typeof A.activate, 'function', 'audio exposes an explicit trusted-gesture activation path');
{
  const originalResume=lastCtx.resume;
  let resumeCalls=0;
  lastCtx.state='suspended';
  lastCtx.resume=()=>{ resumeCalls++; return Promise.resolve().then(()=>{ lastCtx.state='running'; }); };
  const first=A.activate(), second=A.activate();
  assert.equal(A.isReady(),false,'an asynchronous browser resume is not reported ready prematurely');
  assert.equal(first,second,'concurrent radio/UI activation shares one in-flight resume request');
  await first;
  assert.equal(resumeCalls,1,'only one AudioContext resume is issued for the gesture');
  assert.equal(A.isReady(),true,'audio becomes ready after asynchronous resume resolves');
  lastCtx.resume=originalResume;
}

// mixer graph: a voice must reach the destination through the limiter
const comp = lastCtx.nodes.find(n => n.kind === 'compressor');
assert.ok(comp, 'master chain includes a dynamics compressor (limiter)');
assert.ok(comp.out.includes(lastCtx.destination), 'limiter feeds the destination');
{
  const before = nodeCount();
  A.play('heal');
  assert.ok(nodeCount() > before, 'play() synthesizes nodes');
  const osc = lastCtx.nodes.slice(before).find(n => n.kind === 'osc');
  assert.ok(osc && reaches(osc, lastCtx.destination), 'voices route through the mixer to the destination');
  assert.ok(reachesKind(osc, 'compressor'), 'voices pass the limiter');
}
function reachesKind(node, kind, seen){
  seen = seen || new Set();
  if(!node || seen.has(node)) return false;
  seen.add(node);
  if(node.kind === kind) return true;
  return (node.out || []).some(n => reachesKind(n, kind, seen));
}

// unknown names must not throw and must not synthesize anything
{
  const before = nodeCount();
  assert.doesNotThrow(() => A.play('definitely_not_a_sound'));
  assert.equal(nodeCount(), before, 'unknown effect names stay silent no-ops');
}

// ---------------- static registry coverage ---------------------------------
// Collect every literal sound name requested anywhere in src and demand each
// one produces nodes. This is the guard against silently-dead effect names.
function collectRequestedNames(){
  const names = new Set();
  const files = [];
  (function walk(dir){
    for(const e of fs.readdirSync(dir, { withFileTypes: true })){
      const p = path.join(dir, e.name);
      if(e.isDirectory()) walk(p);
      else if(e.name.endsWith('.js')) files.push(p);
    }
  })(SRC);
  const callRe = /\b(?:play|sfx|playSound|playReadyAudio|playAt)\(([^)]*)\)/g;
  const litRe = /'([a-zA-Z][a-zA-Z]{2,14})'/g;
  for(const f of files){
    const src = fs.readFileSync(f, 'utf8');
    let m;
    while((m = callRe.exec(src))){
      let lit;
      while((lit = litRe.exec(m[1]))){
        // skip comparison operands: play(kind==='speed' ? 'heal' : 'chest')
        const before = m[1].slice(0, lit.index).trimEnd();
        if(/[=!]==?$/.test(before)) continue;
        names.add(lit[1]);
      }
    }
    const soundRe = /\bsound:\s*'([a-zA-Z]+)'/g;
    while((m = soundRe.exec(src))) names.add(m[1]);
  }
  return names;
}
const requested = collectRequestedNames();
assert.ok(requested.size >= 25, 'registry scan finds a realistic name set (got ' + requested.size + ')');
for(const name of ['homeWater','homeTick','homeHum','homeRadio','homeCoffee','homeMedical','homeDream','homeChime']){
  assert.ok(requested.has(name), 'furnishing sound contract includes ' + name);
}
for(const name of requested){
  nowMs += 8000; // clear throttles and expire tracked voices between shots
  const before = nodeCount();
  A.play(name);
  assert.ok(nodeCount() > before, "requested sound '" + name + "' is defined and synthesizes nodes");
}

// ---------------- spatial one-shots ----------------------------------------
function lastVoicePeak(from){
  let peak = 0;
  for(const n of lastCtx.nodes.slice(from)){
    if(n.kind !== 'gain') continue;
    for(const ev of n.gain.events) if(ev[0] === 'lin') peak = Math.max(peak, ev[1]);
  }
  return peak;
}
{
  nowMs += 8000;
  let from = nodeCount();
  A.playAt('step', 2, 0);
  const near = lastVoicePeak(from);
  nowMs += 8000;
  from = nodeCount();
  A.playAt('step', 40, 0);
  const far = lastVoicePeak(from);
  assert.ok(near > 0 && far > 0, 'near and far positional plays both sound');
  assert.ok(far < near * 0.55, 'distance rolls volume off (near ' + near.toFixed(3) + ' vs far ' + far.toFixed(3) + ')');
  const panner = lastCtx.nodes.slice(from).find(n => n.kind === 'panner');
  assert.ok(panner && panner.pan.value > 0.4, 'a source to the east pans right');
  assert.ok(reaches(panner, lastCtx.destination) && reachesKind(panner, 'compressor'),
    'the stereo panner remains routed through the mixer and limiter');
  nowMs += 8000;
  from = nodeCount();
  A.playAt('step', -10, 0);
  const leftPanner = lastCtx.nodes.slice(from).find(n => n.kind === 'panner');
  assert.ok(leftPanner && Math.abs(leftPanner.pan.value + 0.5) < 1e-9, 'a source to the west pans left');
  nowMs += 8000;
  player.x = 20;
  from = nodeCount();
  A.playAt('step', 10, 0);
  const movedListenerPanner = lastCtx.nodes.slice(from).find(n => n.kind === 'panner');
  assert.ok(movedListenerPanner && Math.abs(movedListenerPanner.pan.value + 0.5) < 1e-9,
    'pan is relative to the moving listener, not absolute world x');
  player.x = 0;
  nowMs += 8000;
  from = nodeCount();
  A.playAt('step', -40, 0);
  const clampedLeft = lastCtx.nodes.slice(from).find(n => n.kind === 'panner');
  assert.equal(clampedLeft && clampedLeft.pan.value, -0.85, 'far-left pan is safely clamped');
  // Identical chatty effects on opposite sides must not suppress each other.
  nowMs += 8000;
  A.playAt('spark', -8, 0);
  const afterLeftSpark = nodeCount();
  A.playAt('spark', 8, 0);
  assert.ok(nodeCount() > afterLeftSpark, 'left and right effects have independent throttle buckets');
  nowMs += 8000;
  from = nodeCount();
  A.playAt('step', 80, 0);
  assert.equal(nodeCount(), from, 'sources beyond the cull distance spawn no voices');

  const createStereoPanner = lastCtx.createStereoPanner;
  lastCtx.createStereoPanner = undefined;
  nowMs += 8000;
  from = nodeCount();
  assert.doesNotThrow(() => A.playAt('step', 8, 0), 'positional audio falls back when StereoPanner is unavailable');
  const fallbackVoice = lastCtx.nodes.slice(from).find(n => n.kind === 'bufsrc');
  assert.ok(fallbackVoice && reaches(fallbackVoice, lastCtx.destination), 'fallback voice still reaches the output');
  lastCtx.createStereoPanner = createStereoPanner;
}

// ---------------- scene → ambience beds ------------------------------------
MM.background = { getCycleInfo: () => ({ cycleT: 0.3, isDay: true, tDay: 0.5 }) };
MM.worldGen = { surfaceHeight: () => 10 };
let precipitationField = { rain: 1, snow: 0, pan: -0.6 };
MM.clouds = {
  metrics: () => ({ drops: 120, wind: 2.0, storm: { active: true, intensity: 0.8 } }),
  precipitationAudioAt: () => precipitationField,
};
player.y = 8; // above ground
A.update(0.3); // one scene tick
{
  const d = A.debugState();
  assert.ok(d.scene.ready, 'scene sensing ran');
  assert.ok(d.beds.rain > 0.02, 'rain bed follows the weather (got ' + d.beds.rain + ')');
  assert.equal(d.beds.stereoRain, true, 'both continuous rain layers use StereoPanner nodes');
  assert.equal(d.beds.rainPan, -0.6, 'rain wash follows precipitation on the left');
  assert.equal(d.beds.patterPan, -0.6, 'droplet patter follows precipitation on the left');
  assert.ok(d.beds.wind > 0.02, 'storm wind raises the wind bed');
  assert.equal(d.beds.cave, 0, 'no cave bed on the surface');
  const pannerCount = lastCtx.nodes.filter(n => n.kind === 'panner').length;
  precipitationField = { rain: 0.8, snow: 0, pan: 0.65 };
  A.update(0.3);
  const moved = A.debugState();
  assert.equal(moved.beds.rainPan, 0.65, 'the existing rain wash moves smoothly to the right');
  assert.equal(moved.beds.patterPan, 0.65, 'the existing patter layer moves smoothly to the right');
  assert.equal(lastCtx.nodes.filter(n => n.kind === 'panner').length, pannerCount,
    'moving weather reuses its persistent panners');
}
// dive: the master lowpass sweeps down and the underwater bed rises
{
  const before = nodeCount();
  A.setHeroWater(true, 0.9);
  assert.ok(nodeCount() > before, 'entering water splashes');
  A.update(0.3);
  const d = A.debugState();
  assert.ok(d.beds.water > 0, 'submersion raises the underwater bed');
  const wet = lastCtx.nodes.find(n => n.kind === 'biquad' && n.frequency.events.some(ev => ev[0] === 'target' && ev[1] === 460));
  assert.ok(wet, 'submersion sweeps the master lowpass down to 460 Hz');
  A.setHeroWater(false, 0);
  A.update(0.3);
  assert.ok(wet.frequency.events.some(ev => ev[0] === 'target' && ev[1] === 18500), 'surfacing reopens the master lowpass');
}
// deep underground: cave bed + cave music mode
{
  player.y = 60; // depth 50 under surfaceHeight 10
  MM.clouds = { metrics: () => ({ drops: 0, wind: 0.3, storm: { active: false, intensity: 0 } }) };
  nowMs += 20000; // leave any danger window, let a music phrase re-schedule
  A.update(0.3);
  const d = A.debugState();
  assert.ok(d.scene.underground, 'depth marks the scene underground');
  assert.ok(d.beds.cave > 0.03, 'cave drone rises underground');
  assert.ok(d.beds.rain < 0.02, 'surface rain fades away underground');
  assert.equal(d.musicMode, 'cave', 'music director follows the hero underground');

  // Local room geometry, not depth alone, controls reflections. The first
  // provider describes a stone chamber; the second is an open vertical void.
  MM.world = { peekTile: (x,y) => (Math.abs(x-player.x)>=6 || Math.abs(y-player.y)>=5 ? T.STONE : T.AIR) };
  A.update(0.3);
  const chamber = A.debugState();
  assert.ok(chamber.scene.enclosure > 0.6, 'nearby cave boundaries register as an enclosed chamber');
  assert.ok(chamber.scene.reflectivity > 0.7, 'stone boundaries register as reflective');
  assert.ok(chamber.acoustics.echo > 0, 'an enclosed cave opens the subtle early-echo return');
  MM.world = { peekTile: () => T.AIR };
  A.update(0.3);
  const shaft = A.debugState();
  assert.ok(shaft.scene.acousticWet < chamber.scene.acousticWet, 'an open shaft is drier than a stone chamber at the same depth');
  assert.ok(shaft.acoustics.echo < chamber.acoustics.echo, 'open underground space reduces the early echo');
  MM.world = undefined;
}

// ---------------- music director -------------------------------------------
{
  player.y = 8; // back to the surface, daytime
  nowMs += 30000; // clears even the slowest theme's phrase gap (13 s × dryf 1.7)
  const before = nodeCount();
  A.update(0.3);
  assert.ok(nodeCount() > before, 'music director schedules phrases on its own');
  assert.equal(A.debugState().musicMode, 'day', 'daytime surface picks the day scale');
  nowMs += 8000;
  A.play('alarm'); // alarms flip the director into danger mode
  nowMs += 8000;
  A.update(0.3);
  const d = A.debugState();
  assert.ok(d.danger, 'alarms open a danger window');
  assert.equal(d.musicMode, 'danger', 'the next phrase turns tense');
  // muting music volume stops scheduling entirely (rain keeps the birds quiet
  // so any oscillator that appears here could only be the music director)
  A.setBusVolume('music', 0);
  MM.clouds = { metrics: () => ({ drops: 60, wind: 0.5, storm: { active: false, intensity: 0 } }) };
  nowMs += 30000;
  const quiet = nodeCount();
  A.update(0.3);
  const grew = lastCtx.nodes.slice(quiet).filter(n => n.kind === 'osc').length;
  assert.equal(grew, 0, 'music volume 0 stops the director scheduling notes');
  A.setBusVolume('music', 0.5);
}

// ---------------- music on/off + theme rotation ----------------------------
// (heavy rain stays configured above, so the wildlife scheduler adds no
//  oscillators of its own — any osc growth below is the music director)
function oscGrowthAfterUpdate(){
  const before = nodeCount();
  A.update(0.3);
  return lastCtx.nodes.slice(before).filter(n => n.kind === 'osc').length;
}
{
  // the explicit music switch beats volume: off = no scheduling at all
  nowMs += 30000; // clear the alarm danger window
  A.setMusicOn(false);
  assert.equal(A.isMusicOn(), false, 'setMusicOn(false) reads back');
  assert.equal(JSON.parse(store['mm_audio_v1']).musicOn, false, 'music switch persists');
  nowMs += 15000;
  assert.equal(oscGrowthAfterUpdate(), 0, 'music off: the director schedules nothing');
  A.setMusicOn(true);
  nowMs += 600000; // far past any window: the gate re-anchors into a fresh play window
  assert.ok(oscGrowthAfterUpdate() > 0, 'music back on: scheduling resumes');
}

// ---------------- placeable home radio ------------------------------------
{
  player.x=0; player.y=1; // stand beside the receiver for an audible-mix assertion
  const audible=RADIO_STATIONS.filter(station=>station.id!=='off');
  assert.equal(audible.length,6,'the home radio offers six audible stations plus off');
  assert.equal(new Set(audible.map(station=>station.genre)).size,6,'every radio choice has a distinct genre');
  assert.ok(audible.every(station=>station.tracks.length===3),'every genre advertises three original rotating track titles');
  assert.ok(audible.every(station=>/^#[0-9a-f]{6}$/i.test(station.accent)),'every station has a safe visual accent');
  const voiceSignatures=[];
  for(const station of audible){
    nowMs += 30000;
    assert.equal(A.setRadioStation(station.id),true,station.id+' can be selected');
    assert.equal(A.setRadioSource(2,1),true,'a nearby placed radio publishes a positional source');
    const before=nodeCount();
    A.update(0.3);
    const phraseNodes=lastCtx.nodes.slice(before);
    const oscillators=phraseNodes.filter(node=>node.kind==='osc').length;
    voiceSignatures.push(oscillators);
    assert.ok(oscillators>0,station.id+' schedules its own procedural phrase');
    const loudestEnvelope=Math.max(0,...phraseNodes.filter(node=>node.kind==='gain')
      .flatMap(node=>node.gain.events.filter(event=>event[0]==='lin').map(event=>event[1])));
    assert.ok(loudestEnvelope>=0.025,station.id+' has an intentionally audible receiver-level mix');
    const state=A.debugState().radio;
    assert.equal(state.station,station.id,'debug state reports '+station.id);
    assert.equal(state.active,true,station.id+' is active while its radio is nearby');
    assert.equal(state.blockedReason,null,station.id+' exposes no hidden playback blocker while broadcasting');
    assert.equal(state.gain,3.2,station.id+' uses the bounded radio mix lift');
    assert.equal(state.track,station.tracks[0],station.id+' starts with its first named track');
    const panner=lastCtx.nodes.slice(before).find(node=>node.kind==='panner');
    assert.ok(panner && panner.pan.value>0,'radio music is spatialized from the placed receiver');
  }
  assert.ok(new Set(voiceSignatures).size>=5,'genres have materially different phrase density and orchestration');
  const selected=A.getRadioStation();
  assert.equal(A.setRadioStation('tampered-station'),false,'unknown station ids fail closed');
  assert.equal(A.getRadioStation(),selected,'a rejected station cannot corrupt the selection');
  assert.equal(JSON.parse(store['mm_audio_v1']).radioStation,selected,'radio selection persists in audio settings');
  nowMs += 10000;
  assert.equal(A.debugState().radio.active,true,'a stationary placed radio does not silently expire between scans or pauses');
  A.setMusicOn(false);
  assert.equal(A.debugState().radio.active,false,'the global music switch also silences home radio');
  assert.equal(A.debugState().radio.blockedReason,'music-off','debug state explains a disabled music setting');
  A.setMusicOn(true);
  A.setRadioSource(2,1,{powered:false});
  assert.equal(A.debugState().radio.active,false,'an unpowered receiver cannot schedule music');
  assert.equal(A.debugState().radio.blockedReason,'no-power','radio diagnostics distinguish a missing house circuit');
  A.setRadioSource(2,1,{powered:true});
  assert.equal(A.debugState().radio.active,true,'supplying the receiver restores the selected station');
  assert.equal(A.setRadioStation('off'),true,'radio has an explicit off position');
  assert.equal(A.debugState().radio.active,false,'off prevents radio scheduling even with a source');
  A.clearRadioSource();
  assert.equal(A.debugState().radio.source,null,'leaving or removing the receiver clears its source');
  A.setRadioStation('lofi');
  player.y=8;
  nowMs += 30000;
}
{
  // rotation: a theme plays for a window, rests in a silent break, then the
  // NEXT theme takes over — never the same one twice in a row
  const d0 = A.debugState();
  assert.equal(d0.rotation.phase, 'play', 'rotation starts in a play window');
  const THEME_IDS = ['wedrowiec','choral','skoczny','nokturn','dryf'];
  assert.ok(THEME_IDS.includes(d0.rotation.theme), 'an active theme is one of the five');
  nowMs = d0.rotation.until + 1000; // just past the play window
  A.update(0.3);
  const d1 = A.debugState();
  assert.equal(d1.rotation.phase, 'break', 'the play window ends in a break');
  nowMs += 5000;
  assert.equal(oscGrowthAfterUpdate(), 0, 'breaks are silent (no phrases scheduled)');
  nowMs = d1.rotation.until + 1;
  A.update(0.3);
  const d2 = A.debugState();
  assert.equal(d2.rotation.phase, 'play', 'the break ends into the next play window');
  assert.notEqual(d2.rotation.theme, d0.rotation.theme, 'the next window picks a different theme');
  // long absence (tab away / long pause): re-anchor into a fresh play window
  nowMs = d2.rotation.until + 600000;
  A.update(0.3);
  assert.equal(A.debugState().rotation.phase, 'play', 'a long gap re-anchors into play instead of a stale break');
}
{
  // guardian fights: a boss near the hero flips the director into 'boss' mode,
  // which sounds even through a break and outranks plain danger
  const dPlay = A.debugState();
  nowMs = dPlay.rotation.until + 1000;
  A.update(0.3);
  assert.equal(A.debugState().rotation.phase, 'break', 'setup: rotation rests in a break');
  MM.guardianLairs = { nearestForTurret: (x, y, r, onlyBoss) => (onlyBoss ? { raw: { hp: 30, maxHp: 100 } } : null) };
  nowMs += 8000;
  assert.ok(oscGrowthAfterUpdate() > 0, 'a guardian fight sounds even during a rotation break');
  const db = A.debugState();
  assert.equal(db.musicMode, 'boss', 'guardian fight selects the boss score');
  assert.ok(Math.abs(db.bossLevel - 0.88) < 1e-9, 'boss level escalates as the guardian heart drains (0.6+0.4*(1-hp/max))');
  A.play('alarm'); // plain danger must not displace the boss score
  nowMs += 8000;
  A.update(0.3);
  assert.equal(A.debugState().musicMode, 'boss', 'boss mode outranks the danger window');
  // the center mimic battle reports through status().phase instead
  MM.guardianLairs = undefined;
  MM.centerGuardian = { status: () => ({ phase: 'battle', mimic: { hp: 50, maxHp: 100 } }) };
  nowMs += 8000;
  A.update(0.3);
  const dc = A.debugState();
  assert.equal(dc.musicMode, 'boss', 'the center mimic battle also selects the boss score');
  assert.ok(Math.abs(dc.bossLevel - 0.825) < 1e-9, 'mimic escalation follows its heart (0.65+0.35*(1-hp/max))');
  MM.centerGuardian = undefined;
  // the music switch silences even an active boss fight
  MM.guardianLairs = { nearestForTurret: () => ({ raw: { hp: 30, maxHp: 100 } }) };
  A.setMusicOn(false);
  nowMs += 8000;
  assert.equal(oscGrowthAfterUpdate(), 0, 'music off silences even a boss fight');
  A.setMusicOn(true);
  MM.guardianLairs = undefined;
  nowMs += 30000; // let the alarm danger window lapse before the next sections
  A.update(0.3);
}

// ---------------- movement foley -------------------------------------------
{
  nowMs += 8000;
  player.onGround = false; player.vy = 14; player.vx = 0;
  A.update(0.016);
  player.onGround = true; player.vy = 0;
  const before = nodeCount();
  A.update(0.016);
  assert.ok(nodeCount() > before, 'a hard landing thumps');
  // footsteps accumulate with ground speed
  nowMs += 8000;
  player.vx = 6;
  const stepsBefore = nodeCount();
  for(let i = 0; i < 12; i++){ nowMs += 100; A.update(0.05); }
  assert.ok(nodeCount() > stepsBefore, 'running on the ground produces footsteps');
  player.vx = 0;
}

// ---------------- landing materials + variation ----------------------------
{
  const cases = [
    [T.GRASS, 'grass'], [T.STONE, 'stone'], [T.SNOW, 'snow'], [T.WATER, 'water'],
    [T.SAND, 'sand'], [T.MUD, 'mud'], [T.WOOD, 'wood'], [T.STEEL, 'metal'], [T.ICE, 'ice'],
  ];
  for(const [tile, surface] of cases){
    nowMs += 1000;
    const before = nodeCount();
    assert.ok(A.playLanding(tile, 9), surface + ' landing is accepted');
    assert.ok(nodeCount() > before, surface + ' landing synthesizes a voice');
    assert.equal(A.debugState().lastLanding.surface, surface, tile + ' maps to ' + surface + ' foley');
  }

  nowMs += 1000;
  A.playLanding(T.GRASS, 9);
  const firstVariant = A.debugState().lastLanding.variant;
  nowMs += 1000;
  A.playLanding(T.GRASS, 9);
  assert.notEqual(A.debugState().lastLanding.variant, firstVariant,
    'successive landings on the same block cannot repeat the exact variant');

  nowMs += 1000;
  const quietStart = nodeCount();
  A.playLanding(T.STONE, 9);
  const landingGains = lastCtx.nodes.slice(quietStart).filter(n => n.kind === 'gain');
  const landingPeaks = landingGains.flatMap(n => n.gain.events.filter(e => e[0] === 'lin').map(e => e[1]));
  assert.ok(landingPeaks.length && Math.max(...landingPeaks) < 0.05,
    'a normal landing remains deliberately quieter than gameplay effects');

  nowMs += 1000;
  const correctionStart = nodeCount();
  assert.equal(A.playLanding(T.STONE, 1.2), false, 'tiny floor correction is not treated as a landing');
  assert.equal(nodeCount(), correctionStart, 'tiny floor correction stays silent');
  assert.ok(A.playLanding(T.WATER, 0), 'gentle water contact still gets a minimal water texture');
}

// ---------------- thunder + settings persistence ---------------------------
{
  nowMs += 8000;
  let before = nodeCount();
  A.thunder(40, { pan: -0.7 });
  assert.ok(nodeCount() > before, 'thunder synthesizes through the shared mixer');
  let thunderPanners = lastCtx.nodes.slice(before).filter(n => n.kind === 'panner');
  assert.ok(thunderPanners.length >= 2 && thunderPanners.every(n => n.pan.value === -0.7),
    'thunder to the west stays in the left channel');
  before = nodeCount();
  A.thunder(40, { pan: 0.7 });
  thunderPanners = lastCtx.nodes.slice(before).filter(n => n.kind === 'panner');
  assert.ok(thunderPanners.length >= 2 && thunderPanners.every(n => n.pan.value === 0.7),
    'a simultaneous thunderclap to the east stays in the right channel');
  A.setBusVolume('ambience', 0.25);
  A.setMute(true);
  const blob = JSON.parse(store['mm_audio_v1']);
  assert.equal(blob.ambience, 0.25, 'bus volumes persist');
  assert.equal(blob.mute, true, 'mute persists');
  const masterGain = lastCtx.nodes.find(n => n.kind === 'gain' && n.out.includes(comp));
  assert.ok(masterGain, 'master gain feeds the limiter');
  assert.equal(masterGain.gain.value, 0, 'mute zeroes the master gain');
  A.setMute(false);
  assert.equal(masterGain.gain.value, 0.3, 'unmute restores the persisted master volume');
}

// ---------------- source-shape pins ----------------------------------------
// clouds.js must never regrow its own AudioContext (it bypassed volume/mute)
const cloudsSrc = fs.readFileSync(path.join(SRC, 'engine', 'clouds.js'), 'utf8');
assert.ok(!/new\s*\(window\.AudioContext/.test(cloudsSrc) && !/\baudioCtx\b/.test(cloudsSrc),
  'clouds.js has no private AudioContext (thunder rides MM.audio.thunder)');
assert.match(cloudsSrc, /MM\.audio\.thunder/, 'clouds.js delegates thunder to the shared mixer');
const particlesSrc = fs.readFileSync(path.join(SRC, 'engine', 'particles.js'), 'utf8');
assert.ok(!/AudioContext/.test(particlesSrc), 'particle effects never bypass the shared mixer with a private AudioContext');
assert.match(particlesSrc, /MM\.audio\.play/, 'opt-in particle sounds use the shared positional mixer');
// main.js keeps feeding submersion + exposes the per-bus mixer sliders
const mainSrc = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8');
assert.match(mainSrc, /AUDIO\.setHeroWater\(inWater,\s*subFrac,\s*player\.vy\)/, 'physics publishes submersion and water-entry speed to the audio scene');
assert.match(mainSrc, /AUDIO\.playLanding\(getTile\(landingTile\.x,landingTile\.y\),landingImpact/,
  'tile collision publishes the exact landing material and pre-zeroed impact speed');
assert.match(mainSrc, /dataset\.bus=bus/, 'pause panel builds per-bus volume sliders');
assert.match(mainSrc, /AUDIO\.update\(simulationDt\)/, 'the game loop drives audio.update from the shared simulation pace every frame');

console.log('audio-sim: all tests passed');
