import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soundFor, alertSound, scoreEvent, createAudio, VOICE_CAP } from '../js/audio/audio.js';
import { weightOf } from '../js/config/alerts.js';

const EVENTS = [
  { type: 'shot', sx: 10, sz: 10, tx: 12, tz: 12, w: 'rifle', hit: true },
  { type: 'explode', x: 10, z: 10, r: 3, kind: 'shell' },
  { type: 'artillery', x: 10, z: 10, tx: 20, tz: 20 },
  { type: 'death', kind: 'dead', x: 10, z: 10 },
  { type: 'scream', x: 10, z: 10 },
  { type: 'siren', x: 10, z: 10 },
  { type: 'climb', x: 10, z: 10 },
  { type: 'claw', x: 10, z: 10 },
  { type: 'bite', x: 10, z: 10 },
  { type: 'alert', kind: 'law', level: 'warn', merged: false },
  { type: 'built', x: 10, z: 10 },
  { type: 'placed', x: 10, z: 10 },
  { type: 'destroyed', x: 10, z: 10 },
  { type: 'upgraded' },
  { type: 'decision' },
  { type: 'letter' },
  { type: 'request' },
  { type: 'news' },
  { type: 'tech' },
  { type: 'promoted' },
  { type: 'hordeRumour' },
  { type: 'recon', x: 10, z: 10 },
  { type: 'strikeCalled', x: 10, z: 10 },
  { type: 'rejected', x: 10, z: 10 },
  { type: 'turn', x: 10, z: 10 },
];
// The events the score answers itself (sequencer.js), so their old stingers are not heard twice.
const SCORED = [
  { type: 'hordeContact' }, { type: 'fall' }, { type: 'act' }, { type: 'over', won: true }, { type: 'over', won: false },
  ...['hordeContact', 'fall'].map((kind) => ({ type: 'alert', kind, level: 'bad' })),
];
// Alerts the score answers on the beat that keep their own sounds as well (spec 5.6: all other alert tones stay): a
// breakout its tone; the horde crossing, a critical kind without a tone of its own, the alarm (the feed's, via ui()).
const ANSWERED = [
  { type: 'alert', kind: 'hordeArrived', level: 'bad' }, { type: 'alert', kind: 'hordeDestroyed', level: 'good' },
  { type: 'alert', kind: 'breakout', level: 'bad' },
];

const WEAPONS = ['rifle', 'mg', 'hmg', 'pistol', 'carbine', 'sniper', 'flamer', 'tower', 'checkpoint', 'hq', 'gunship', 'melee', 'baton'];
const ALERT_KINDS = ['outbreak', 'breakout', 'hordeRumour', 'pileup', 'unitLost', 'built', 'trained', 'tech', 'promiseKept', 'promiseBroken'];

// Every variant soundFor distinguishes, so the mock run exercises every synth.
const VARIANTS = [
  ...EVENTS,
  ...WEAPONS.map((w) => ({ type: 'shot', sx: 10, sz: 10, tx: 11, tz: 11, w, hit: false })),
  ...['shell', 'mortar', 'napalm', 'mine', 'blast'].map((kind) => ({ type: 'explode', x: 10, z: 10, r: 2, kind })),
  { type: 'artillery', x: 10, z: 10, tx: 20, tz: 20, w: 'mortar' },
  ...['dead', 'unit', 'refugee', 'bus'].map((kind) => ({ type: 'death', kind, x: 10, z: 10 })),
  ...['info', 'warn', 'bad', 'good'].map((level) => ({ type: 'alert', kind: 'misc', level })),
  ...ALERT_KINDS.map((kind) => ({ type: 'alert', kind, level: 'info' })),
];

test('soundFor maps every sim event type to a sound', () => {
  for (const ev of EVENTS) {
    const s = soundFor(ev);
    assert.ok(s, `no sound for ${ev.type}`);
    assert.equal(typeof s.id, 'string');
    assert.ok(s.gain >= 0 && s.gain <= 1, `gain out of range for ${ev.type}`);
    assert.equal(typeof s.spatial, 'boolean');
    assert.ok(s.throttle === null || typeof s.throttle === 'string');
  }
});

test('soundFor leaves the events the score answers to the score; scoreEvent names them', () => {
  for (const ev of SCORED) assert.equal(soundFor(ev), null, `${ev.type} ${ev.kind ?? ''}`);
  assert.equal(soundFor({ type: 'alert', kind: 'outbreak', level: 'bad' }).id, 'alert.outbreak', 'other alert tones stay');
  assert.equal(soundFor({ type: 'alert', kind: 'misc', level: 'bad' }).id, 'alert.bad');
  // Only the sighting, the fall, the act change and game over lose their stingers (F6): the horde crossing (now the
  // alarm, a critical kind with no tone of its own), a horde destroyed and a breakout keep their sounds under the
  // score's answer.
  assert.deepEqual(ANSWERED.map(alertSound), ['ui.alarm', 'alert.good', 'alert.breakout']);
  assert.deepEqual(ANSWERED.map((ev) => soundFor(ev)?.id), [undefined, 'alert.good', 'alert.breakout']);
  assert.deepEqual(ANSWERED.map(scoreEvent), ['hordeArrived', 'hordeDestroyed', 'breakout']);
  assert.deepEqual(SCORED.map(scoreEvent), [
    'hordeContact', 'fall', null, 'victory', 'defeat', null, null,
  ], 'the sighting and the fall arrive as their own events; act changes are the song change');
  for (const ev of [...EVENTS, null, { type: 'alert', kind: 'toString' }]) assert.equal(scoreEvent(ev), null);
});

test('soundFor ignores unknown events', () => {
  assert.equal(soundFor({ type: 'nonsense' }), null);
  assert.equal(soundFor(null), null);
});

test('weapons: MG shots share a throttle key; rifle and sniper differ', () => {
  const mg1 = soundFor({ type: 'shot', sx: 1, sz: 1, tx: 2, tz: 2, w: 'mg', hit: true });
  const mg2 = soundFor({ type: 'shot', sx: 40, sz: 9, tx: 41, tz: 9, w: 'mg', hit: false });
  assert.equal(mg1.throttle, mg2.throttle);
  assert.equal(typeof mg1.throttle, 'string');
  const rifle = soundFor({ type: 'shot', w: 'rifle' });
  const sniper = soundFor({ type: 'shot', w: 'sniper' });
  assert.notEqual(rifle.id, sniper.id);
  assert.equal(new Set(WEAPONS.map((w) => soundFor({ type: 'shot', w }).id)).size, WEAPONS.length);
});

test('a mortar team has its own launch and burst, lighter than artillery, and no incoming whistle', () => {
  const launch = soundFor({ type: 'artillery', x: 1, z: 1, tx: 9, tz: 9, w: 'mortar' });
  const gun = soundFor({ type: 'artillery', x: 1, z: 1, tx: 9, tz: 9, w: 'artillery' });
  assert.equal(launch.id, 'artillery.mortar');
  assert.equal(gun.id, 'artillery');
  assert.ok(launch.gain < gun.gain);
  const burst = soundFor({ type: 'explode', x: 1, z: 1, r: 1.5, kind: 'mortar' });
  const shell = soundFor({ type: 'explode', x: 1, z: 1, r: 2.5, kind: 'shell' });
  assert.equal(burst.id, 'explode.mortar');
  assert.ok(burst.gain < shell.gain);
});

test('with Web Audio: a battery’s shell whistles on its way down; a mortar’s does not', async () => {
  await withMock(async (a, stats) => {
    const late = (w) => {
      stats.ctx.currentTime += 10;
      const now = stats.ctx.currentTime, n = stats.starts.length;
      a.onEvents([{ type: 'artillery', x: 10, z: 10, tx: 14, tz: 14, w }]);
      return stats.starts.slice(n).filter((t) => t > now + 1).length;
    };
    assert.ok(late('artillery') > 0, 'the whistle, 1.2 s later');
    assert.equal(late('mortar'), 0);
  });
});

test('alerts: distinct level tones, distinct kind sounds, merged repeats quieter', () => {
  const levels = ['info', 'warn', 'bad', 'good'].map((level) => soundFor({ type: 'alert', kind: 'misc', level }).id);
  assert.equal(new Set(levels).size, 4);
  const kinds = ALERT_KINDS.map((kind) => soundFor({ type: 'alert', kind, level: 'info' }).id);
  assert.equal(new Set(kinds).size, ALERT_KINDS.length);
  const fresh = soundFor({ type: 'alert', kind: 'outbreak', level: 'bad' });
  const merged = soundFor({ type: 'alert', kind: 'outbreak', level: 'bad', merged: true });
  assert.ok(merged.gain < fresh.gain);
});

// kind -> the one sound its alert makes. A kind with a tone of its own keeps it, whatever its weight (a breakout is
// critical, an outbreak important); a critical kind without one plays the alarm, an important one the ping, a routine
// one its level's tone; the sighting and the fall are the score's. The levels are the ones the sim raises them at.
const ALERT_TABLE = [
  ['outbreak', 'bad', 'alert.outbreak'], ['breakout', 'bad', 'alert.breakout'], ['hordeRumour', 'warn', 'alert.hordeRumour'],
  ['pileup', 'warn', 'alert.pileup'], ['unitLost', 'bad', 'alert.unitLost'], ['built', 'good', 'alert.built'],
  ['trained', 'good', 'alert.trained'], ['tech', 'good', 'alert.tech'], ['promiseKept', 'good', 'alert.promiseKept'],
  ['promiseBroken', 'bad', 'alert.promiseBroken'],
  ['hordeArrived', 'bad', 'ui.alarm'], ['hq', 'bad', 'ui.alarm'], ['hqAttack', 'bad', 'ui.alarm'], ['danger', 'bad', 'ui.alarm'],
  ['destroyed', 'bad', 'ui.ping'], ['underAttack', 'warn', 'ui.ping'], ['starving', 'bad', 'ui.ping'], ['ammo', 'bad', 'ui.ping'],
  ['broke', 'bad', 'ui.ping'], ['deadline', 'warn', 'ui.ping'], ['busLost', 'bad', 'ui.ping'],
  ['hordeDestroyed', 'good', 'alert.good'], ['law', 'info', 'alert.info'], ['scandal', 'warn', 'alert.warn'],
  ['letterExpired', 'bad', 'alert.bad'], ['day', 'info', 'alert.info'],
  ['fall', 'bad', null], ['hordeContact', 'bad', null],
];

test('alerts: each kind makes one sound: its own tone, else the alarm (critical), the ping (important) or its level tone', () => {
  for (const [kind, level, want] of ALERT_TABLE) {
    for (const merged of [false, true]) {
      const ev = { type: 'alert', kind, level, weight: weightOf(kind), merged };
      assert.equal(alertSound(ev), want, kind);
      // The world plays the tones; the alarm and the ping are the feed's alone, with no tone on top.
      assert.equal(soundFor(ev)?.id ?? null, want && want.startsWith('alert.') ? want : null, `${kind} world sound`);
    }
  }
  // Every critical and important kind is in the table, so none is left to chance.
  for (const kind of ['hordeArrived', 'breakout', 'fall', 'hq', 'hqAttack', 'danger', 'hordeContact', 'outbreak', 'destroyed',
    'unitLost', 'busLost', 'pileup', 'starving', 'ammo', 'broke', 'deadline', 'promiseBroken', 'underAttack']) {
    assert.ok(ALERT_TABLE.some(([k]) => k === kind), kind);
  }
});

test('createAudio without AudioContext is a safe no-op', async () => {
  assert.equal(globalThis.AudioContext, undefined);
  const a = createAudio();
  await a.unlock();
  a.setListener({ x: 10, z: 10, zoom: 1 });
  a.onEvents(EVENTS);
  a.onEvents([{ type: 'nonsense' }]);
  a.onEvents(SCORED);
  for (const type of ['hordeContact', 'hordeArrived', 'fall', 'hordeDestroyed', 'breakout', 'victory', 'defeat']) a.labEvent(type);
  a.update(0.016, { threat: 0.9, night: true, deadNearby: 40, paused: false });
  for (const k of ['click', 'hover', 'place', 'error', 'open', 'close', 'select', 'order', 'alarm', 'ping']) a.ui(k);
  for (const c of ['master', 'sfx', 'ui', 'music', 'ambient']) {
    a.setVolume(c, 0.3);
    assert.equal(a.getVolume(c), 0.3);
  }
});


// Minimal Web Audio mock that rejects the inputs a real browser rejects. It also records the graph: every node
// (`created`, with its `kind`, a biquad's `type`, and outgoing `outs`) and every scheduled parameter change
// (`events`, also kept on each parameter, so a filter's set and swept frequencies can be read back).
function installMock() {
  const stats = { nodes: 0, ctx: null, panners: [], created: [], events: [], starts: [] };
  const finite = (v, what) => { if (!Number.isFinite(v)) throw new TypeError(`non-finite ${what}: ${v}`); };
  class Param {
    constructor(v, owner) { this.value = v; this.owner = owner; this.events = []; }
    get value() { return this.now; }
    set value(v) { finite(v, 'value'); this.now = v; }
    log(kind, v, t, c) { const e = { param: this, kind, v, t, c }; this.events.push(e); stats.events.push(e); }
    setValueAtTime(v, t) { finite(v, 'value'); finite(t, 'time'); this.log('set', v, t); }
    linearRampToValueAtTime(v, t) { finite(v, 'value'); finite(t, 'time'); this.log('linear', v, t); }
    exponentialRampToValueAtTime(v, t) {
      finite(v, 'value'); finite(t, 'time');
      if (v <= 0) throw new RangeError('exponential ramp to a non-positive value');
      this.log('exponential', v, t);
    }
    setTargetAtTime(v, t, c) { finite(v, 'value'); finite(t, 'time'); assert.ok(c > 0); this.log('target', v, t, c); }
  }
  class Node {
    constructor(params = {}, kind = 'node') {
      stats.nodes++;
      this.kind = kind;
      this.outs = [];
      stats.created.push(this);
      for (const [k, v] of Object.entries(params)) this[k] = new Param(v, this);
    }
    connect(n) { assert.ok(n, 'connect to a missing node'); this.outs.push(n); return n; }
    disconnect() {}
  }
  class Source extends Node {
    start(t = 0) { finite(t, 'start'); stats.starts.push(t); this.at = t; }
    stop(t = 0) { finite(t, 'stop'); this.until = t; }
  }
  class Shaper extends Node {
    constructor() { super({}, 'shaper'); this.shape = null; this.oversample = 'none'; }
    get curve() { return this.shape; }
    set curve(c) {
      if (c !== null && !(c instanceof Float32Array && c.length >= 2)) throw new TypeError('a WaveShaper curve is a Float32Array of 2+ points');
      this.shape = c;
    }
  }
  class Ctx {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 8000;
      this.state = 'suspended';
      this.destination = new Node({}, 'destination');
      stats.ctx = this;
    }
    resume() { this.state = 'running'; return Promise.resolve(); }
    createGain() { return new Node({ gain: 1 }, 'gain'); }
    createStereoPanner() { const n = new Node({ pan: 0 }, 'panner'); stats.panners.push(n); return n; }
    createBiquadFilter() {
      const n = new Node({ frequency: 350, Q: 1, gain: 0 }, 'biquad');
      n.type = 'lowpass';
      return n;
    }
    createOscillator() { const n = new Source({ frequency: 440, detune: 0 }, 'osc'); n.type = 'sine'; return n; }
    createBufferSource() { return new Source({ playbackRate: 1 }, 'buffer'); }
    createConvolver() { return new Node({}, 'convolver'); }
    createDelay(max = 1) { const n = new Node({ delayTime: 0 }, 'delay'); n.maxDelayTime = max; return n; }
    createWaveShaper() { return new Shaper(); }
    createDynamicsCompressor() { return new Node({ threshold: 0, knee: 0, ratio: 1, attack: 0, release: 0 }, 'compressor'); }
    createBuffer(ch, len, sr) {
      const data = Array.from({ length: ch }, () => new Float32Array(len));
      return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => data[i] };
    }
  }
  globalThis.AudioContext = Ctx;
  return stats;
}

async function withMock(fn) {
  const stats = installMock();
  try {
    const a = createAudio();
    await a.unlock();
    a.setListener({ x: 10, z: 10, zoom: 1.5 });
    await fn(a, stats);
  } finally {
    delete globalThis.AudioContext;
  }
}

test('with Web Audio: every event variant and ui kind synthesises with valid parameters', async () => {
  await withMock(async (a, stats) => {
    for (const ev of VARIANTS) {
      stats.ctx.currentTime += 5;
      const before = stats.nodes;
      a.onEvents([ev]);
      assert.ok(stats.nodes > before, `no sound synthesised for ${JSON.stringify(ev)}`);
    }
    for (const k of ['click', 'hover', 'place', 'error', 'open', 'close', 'select', 'order', 'alarm', 'ping']) {
      stats.ctx.currentTime += 1;
      const before = stats.nodes;
      a.ui(k);
      assert.ok(stats.nodes > before, `no ui sound for ${k}`);
    }
    for (let i = 0; i < 80; i++) {
      stats.ctx.currentTime += 0.25;
      a.update(0.25, { threat: i / 80, night: i > 40, deadNearby: 60, paused: i === 60 });
    }
    for (const c of ['master', 'sfx', 'ui', 'music', 'ambient']) a.setVolume(c, 0.5);
    assert.equal(a.getVolume('music'), 0.5);
  });
});

test('with Web Audio: far sounds are silent and a flood of shots is throttled', async () => {
  await withMock(async (a, stats) => {
    stats.ctx.currentTime = 10;
    let before = stats.nodes;
    a.onEvents([{ type: 'explode', x: 80, z: 80, r: 3, kind: 'shell' }]);
    assert.equal(stats.nodes, before, 'a blast 99 tiles away should be inaudible');

    stats.ctx.currentTime = 20;
    before = stats.nodes;
    a.onEvents([{ type: 'shot', sx: 10, sz: 10, tx: 11, tz: 11, w: 'rifle', hit: true }]);
    const one = stats.nodes - before;

    stats.ctx.currentTime = 30;
    before = stats.nodes;
    const flood = Array.from({ length: 500 }, (_, i) => ({ type: 'shot', sx: 8 + (i % 5), sz: 10, tx: 11, tz: 11, w: 'rifle', hit: false }));
    a.onEvents(flood);
    assert.equal(stats.nodes - before, one, '500 rifle shots in one frame should play as one voice');

    stats.ctx.currentTime = 40;
    before = stats.nodes;
    const mixed = [];
    for (let i = 0; i < 300; i++) {
      mixed.push({ type: 'death', kind: 'dead', x: 10 + (i % 9), z: 10 });
      mixed.push({ type: 'claw', x: 12, z: 10 });
      mixed.push({ type: 'shot', sx: 10, sz: 12, tx: 11, tz: 11, w: ['mg', 'rifle', 'sniper', 'tower'][i % 4], hit: true });
    }
    a.onEvents(mixed);
    assert.ok(stats.nodes - before < 200, `mixed flood created ${stats.nodes - before} nodes`);
  });
});

test('with Web Audio: world sounds never exceed the voice cap; alerts still get through', async () => {
  await withMock(async (a, stats) => {
    stats.ctx.currentTime = 100;
    // Every spatial sound variant, many times, at the listener, over several frames inside one second.
    const spatial = VARIANTS.filter((ev) => soundFor(ev)?.spatial);
    for (let f = 0; f < 12; f++) {
      stats.ctx.currentTime += 0.02;
      a.onEvents(spatial.flatMap((ev) => Array.from({ length: 6 }, (_, i) => ({ ...ev, x: 10 + i * 0.3, z: 10, sx: 10 + i * 0.3, sz: 10 }))));
      assert.ok(a.activeVoices() <= VOICE_CAP, `frame ${f}: ${a.activeVoices()} voices`);
    }
    assert.equal(a.activeVoices(), VOICE_CAP, 'the flood fills the world voices');
    stats.ctx.currentTime += 0.02;
    a.onEvents([{ type: 'alert', kind: 'misc', level: 'bad' }]);
    assert.ok(a.activeVoices() > VOICE_CAP && a.activeVoices() <= VOICE_CAP + 4, `alert voice: ${a.activeVoices()}`);
  });
});

test('with Web Audio: stereo pan follows the rotated camera', async () => {
  await withMock(async (a, stats) => {
    // The renderer puts the camera at (sin yaw, cos yaw) from the target, so screen-right is (cos yaw, −sin yaw).
    for (const yaw of [Math.PI / 4, Math.PI / 4 + Math.PI / 2]) {
      a.setListener({ x: 10, z: 10, zoom: 1.5, yaw });
      const right = [Math.cos(yaw), -Math.sin(yaw)], fwd = [-Math.sin(yaw), -Math.cos(yaw)];
      const panAt = (dx, dz) => {
        stats.ctx.currentTime += 1;
        const n = stats.panners.length;
        a.onEvents([{ type: 'explode', x: 10 + dx, z: 10 + dz, r: 2, kind: 'shell' }]);
        return stats.panners[n].pan.value;
      };
      assert.ok(panAt(right[0] * 8, right[1] * 8) > 0.3, 'screen-right sounds pan right');
      assert.ok(panAt(-right[0] * 8, -right[1] * 8) < -0.3, 'screen-left sounds pan left');
      assert.ok(Math.abs(panAt(fwd[0] * 8, fwd[1] * 8)) < 0.05, 'sounds straight ahead stay centred');
    }
  });
});

test('with Web Audio: rain ambience starts, patters and stops with valid parameters', async () => {
  await withMock(async (a, stats) => {
    stats.ctx.currentTime = 200;
    for (let f = 0; f < 30; f++) { stats.ctx.currentTime += 0.05; a.update(0.05, { threat: 0.3, rain: false }); }
    const dry = stats.nodes;
    for (let f = 0; f < 30; f++) { stats.ctx.currentTime += 0.05; a.update(0.05, { threat: 0.3, rain: true }); }
    const wet = stats.nodes - dry;
    for (let f = 0; f < 30; f++) { stats.ctx.currentTime += 0.05; a.update(0.05, { threat: 0.3, rain: true, paused: true }); }
    for (let f = 0; f < 30; f++) { stats.ctx.currentTime += 0.05; a.update(0.05, { threat: 0.3, rain: false }); }
    assert.ok(wet > 20, `raining for 1.5 s created only ${wet} nodes (no drops?)`);
  });
});

// ---- the score's sequencer (sequencer.js on worlds, songs and the director) ----

// Run the engine for `seconds` of audio time in frames of `dt`.
function advance(a, stats, seconds, info = {}, dt = 0.1) {
  for (let f = 0; f < Math.round(seconds / dt); f++) {
    stats.ctx.currentTime += dt;
    a.update(dt, info);
  }
}
// Collect the score's step trace, melody notes and reactions while `fn` runs; the engine fills them only when they
// exist.
async function traced(fn) {
  const tr = (globalThis.__scoreTrace = []);
  const mt = (globalThis.__melodyTrace = []);
  const rt = (globalThis.__reactionTrace = []);
  try {
    await fn(tr, mt, rt);
  } finally {
    delete globalThis.__scoreTrace;
    delete globalThis.__melodyTrace;
    delete globalThis.__reactionTrace;
  }
}
// The fastest a glide moves: the widest mood change (Hopeful 112 ↔ Dire 94) over one phrase of 128 steps.
const MAX_GLIDE = 18 / 128 + 1e-9;
// The grid: every step lands exactly one step (at its own tempo) after the one before, the swing offsets aside;
// no played step lands in the past; swing delays only odd steps, by a tenth of a step; the tempo never jumps.
function checkGrid(tr, maxGlide = MAX_GLIDE) {
  for (let i = 0; i < tr.length; i++) {
    const x = tr[i], where = `bar ${x.bar} step ${x.step}`;
    assert.ok(Math.abs(x.stepLen - 60 / x.tempo / 4) < 1e-12, `${where}: step length ${x.stepLen} at ${x.tempo} bpm`);
    assert.ok(x.swing === 0 || (x.step % 2 === 1 && Math.abs(x.swing - 0.1 * x.stepLen) < 1e-12), `${where}: swing ${x.swing}`);
    if (!x.skipped) assert.ok(x.t >= x.now, `${where}: late by ${x.now - x.t}`);
    if (!i) continue;
    const p = tr[i - 1];
    assert.ok(Math.abs((x.t - x.swing) - (p.t - p.swing) - p.stepLen) < 1e-9, `${where}: off the grid`);
    assert.ok(Math.abs(x.tempo - p.tempo) <= maxGlide, `${where}: tempo jump ${p.tempo} → ${x.tempo}`);
  }
}
// Trace entries grouped by the phrase they belong to.
const byPhrase = (tr) => Object.values(Object.groupBy(tr, (x) => Math.floor(x.bar / 8)));

test('with Web Audio: every value of every score switch plays, and random combinations, at every forced level', async () => {
  const { STYLE_OPTIONS, DEFAULT_STYLE } = await import('../js/audio/style.js');
  await withMock(async (a, stats) => {
    stats.ctx.currentTime = 300;
    let seed = 9;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const combos = [];
    for (const [k, opts] of Object.entries(STYLE_OPTIONS)) for (const [v] of opts) combos.push({ ...DEFAULT_STYLE, [k]: v });
    for (let n = 0; n < 40; n++) combos.push(Object.fromEntries(Object.entries(STYLE_OPTIONS).map(([k, opts]) => [k, opts[Math.floor(rand() * opts.length)][0]])));
    await traced(async (tr) => {
      combos.forEach((combo, n) => {
        assert.deepEqual(a.setScoreStyle(combo), combo);
        a.setLevelOverride((n % 5) - 1);
        // Two bars per combination, so every melody section and both chord halves get scheduled.
        for (let f = 0; f < 50; f++) { stats.ctx.currentTime += 0.1; a.update(0.1, { threat: 0.3, night: n % 2 === 0 }); }
      });
      checkGrid(tr);
    });
    a.setLevelOverride(2);
    for (let f = 0; f < 60; f++) { stats.ctx.currentTime += 0.05; a.update(0.05, { threat: 0 }); }
    assert.equal(a.scoreInfo().level, 2, 'a forced level holds whatever the threat');
    a.setLevelOverride(null);
    assert.equal(a.scoreInfo().auto, true);
  });
});

test('with Web Audio: the director darkens the mood one step at a time, and a pinned mood applies at once', async () => {
  await withMock(async (a, stats) => {
    stats.ctx.currentTime = 500;
    a.setScoreStyle({ mood: 'auto' });
    const run = (seconds, info) => advance(a, stats, seconds, info);
    run(5, { threat: 0, dire: 0 });
    assert.equal(a.scoreInfo().mood, 'hopeful');
    run(45, { threat: 0, dire: 0.9 });
    assert.equal(a.scoreInfo().mood, 'uneasy', 'two phrases of a collapsing country: one step darker');
    run(35, { threat: 0, dire: 0.9 });
    assert.equal(a.scoreInfo().mood, 'dire', 'two more: dire');
    a.setScoreStyle({ mood: 'hopeful' });
    assert.equal(a.scoreInfo().mood, 'hopeful');
    a.setScoreStyle({ mood: 'auto' });
    const melodies = new Set();
    for (let k = 0; k < 6; k++) { run(19, { threat: 0, dire: 0 }); melodies.add(`${a.scoreInfo().kind}/${a.scoreInfo().lead}`); }
    assert.ok(melodies.size >= 2, `the director varies the melody: ${[...melodies]}`);
  });
});

test('with Web Audio: the score plays every world and level without errors, with one tempo per phrase line except glides', async () => {
  const { WORLDS } = await import('../js/audio/worlds.js');
  for (const [mood, world] of Object.entries(WORLDS)) {
    await withMock(async (a, stats) => {
      a.setScoreStyle({ mood });
      stats.ctx.currentTime = 50;
      await traced(async (tr) => {
        for (const level of [-1, 0, 1, 2, 3]) {
          a.setLevelOverride(level);
          advance(a, stats, 6, { threat: 0.5, night: level % 2 === 0 });
        }
        checkGrid(tr);
        assert.ok(tr.every((x) => x.tempo === world.tempo), `${mood}: ${world.tempo} bpm throughout`);
        assert.deepEqual([...new Set(tr.map((x) => x.level))], [-1, 0, 1, 2, 3]);
        assert.ok(tr.every((x) => x.band === world.band && x.groove === world.groove), `${mood}: its own band and groove`);
        assert.equal(tr.some((x) => x.swing > 0), world.groove === 'bounce', `${mood}: swing only in the bounce`);
      });
    });
  }
  // A country sliding into collapse and back: each phrase holds one tempo or glides in one straight line.
  await withMock(async (a, stats) => {
    stats.ctx.currentTime = 50;
    await traced(async (tr) => {
      advance(a, stats, 5, { dire: 0, threat: 0.3 });
      advance(a, stats, 90, { dire: 0.9, threat: 0.3 });
      advance(a, stats, 100, { dire: 0, threat: 0.3 });
      checkGrid(tr);
      let glides = 0;
      for (const ph of byPhrase(tr)) {
        assert.deepEqual([ph[0].bar % 8, ph[0].step], [0, 0], 'phrases start on the phrase line');
        const d = ph.slice(1).map((x, i) => x.tempo - ph[i].tempo);
        assert.ok(d.every((v) => Math.abs(v - d[0]) < 1e-9), `bar ${ph[0].bar}: one tempo or one straight glide`);
        if (Math.abs(d[0]) > 1e-9) glides++;
      }
      assert.ok(glides >= 3, `${glides} glides`);
    });
  });
});

test('with Web Audio: a mood change glides the tempo over one phrase and crossfades the bands', async () => {
  await withMock(async (a, stats) => {
    stats.ctx.currentTime = 10;
    advance(a, stats, 5, { dire: 0.4 });
    assert.deepEqual(['mood', 'tempo', 'band'].map((k) => a.scoreInfo()[k]), ['uneasy', 104, 'synth']);
    const limiter = stats.created.find((n) => n.kind === 'compressor' && n.threshold.value === -8);
    // Each band's own gain: silent at first, straight into the limiter (the reverb returns sit at 0.6).
    const [warm, synth, dark] = stats.created.filter((n) => n.kind === 'gain' && n.outs.includes(limiter) && n.gain.value === 0);
    assert.ok(warm && synth && dark, 'three bands');
    const mark = stats.events.length;
    const tempos = [];
    for (let f = 0; f < 700; f++) { stats.ctx.currentTime += 0.1; a.update(0.1, { dire: 0.9 }); tempos.push(a.scoreInfo().tempo); }
    assert.ok(tempos.some((x) => x > 94 && x < 104), 'the tempo passes through the glide');
    assert.ok(tempos.every((x, i) => !i || x <= tempos[i - 1]), 'steadily down');
    assert.equal(tempos.at(-1), 94);
    assert.deepEqual(['mood', 'band', 'groove'].map((k) => a.scoreInfo()[k]), ['dire', 'dark', 'heavy']);
    const moves = (node) => stats.events.slice(mark).filter((e) => e.param === node.gain);
    const out = moves(synth).find((e) => e.v === 0 && ['target', 'linear'].includes(e.kind));
    const inn = moves(dark).find((e) => e.v === 1);
    assert.ok(out && inn, 'the synth band fades out as the dark band comes in');
    assert.ok(Math.abs(out.t - inn.t) < 0.2, 'together, at the phrase line');
    // Over four bars at the outgoing tempo (a time constant of a third of that).
    assert.ok(Math.abs(out.c - (4 * 16 * 60 / 104 / 4) / 3) < 0.01, `fade time constant ${out.c}`);
    assert.equal(moves(warm).length, 0, 'the warm band is left alone');
  });
});

test('with Web Audio: menu to game flows Anthem → Act I without restarting', async () => {
  await withMock(async (a, stats) => {
    stats.ctx.currentTime = 10;
    advance(a, stats, 20, { menu: true, act: 1, threat: 0.9, dire: 0 });
    const menu = a.scoreInfo();
    assert.deepEqual([menu.song, menu.mood], ['anthem', 'hopeful']);
    assert.ok(menu.level <= 1, `the title music stays out of a fight (level ${menu.level})`);
    const verbs = stats.created.filter((n) => n.kind === 'convolver').length;
    await traced(async (tr) => {
      advance(a, stats, 20, { menu: false, act: 1, threat: 0, dire: 0 });
      checkGrid(tr);
      assert.ok(tr[0].bar === menu.bar || tr[0].bar === menu.bar + 1, 'the score runs on from where it was');
    });
    const game = a.scoreInfo();
    assert.deepEqual([game.song, game.band], ['act1', 'warm']);
    assert.equal(stats.created.filter((n) => n.kind === 'convolver').length, verbs, 'no second score');
  });
});

test('with Web Audio: a lab pin during a glide retargets from the current tempo', async () => {
  await withMock(async (a, stats) => {
    a.setScoreStyle({ mood: 'uneasy' });
    stats.ctx.currentTime = 10;
    await traced(async (tr) => {
      advance(a, stats, 3);
      assert.equal(a.scoreInfo().tempo, 104);
      a.setScoreStyle({ mood: 'dire' });
      assert.deepEqual(['mood', 'band', 'tempoTo'].map((k) => a.scoreInfo()[k]), ['dire', 'synth', 94], 'the mood at once; the band at the next phrase line');
      advance(a, stats, 6);
      const mid = a.scoreInfo().tempo;
      assert.ok(mid > 94 && mid < 104, `gliding: ${mid}`);
      // A switch that keeps the mood leaves the glide as it is.
      const slope = tr.at(-1).tempo - tr.at(-2).tempo;
      let at = tr.length;
      a.setScoreStyle({ melody: 'riff' });
      advance(a, stats, 1);
      assert.ok(tr.slice(at - 1).every((x, i, xs) => !i || Math.abs(x.tempo - xs[i - 1].tempo - slope) < 1e-9), 'a new melody leaves the glide alone');
      at = tr.length;
      a.setScoreStyle({ mood: 'hopeful' });
      assert.equal(a.scoreInfo().tempoTo, 112);
      advance(a, stats, 60);
      checkGrid(tr);
      const after = tr.slice(at).map((x) => x.tempo);
      assert.ok(Math.abs(after[0] - tr[at - 1].tempo) <= MAX_GLIDE, 'from the tempo it was at');
      assert.ok(after.every((x, i) => !i || x >= after[i - 1]), 'turning back up without a dip');
      assert.equal(after.at(-1), 112, 'landing on the new tempo');
      assert.deepEqual(['mood', 'band'].map((k) => a.scoreInfo()[k]), ['hopeful', 'warm']);
    });
  });
});

test('with Web Audio: a mood pinned mid-phrase keeps the tune playing, hook and all', async () => {
  await withMock(async (a, stats) => {
    a.setScoreStyle({ mood: 'hopeful' });
    stats.ctx.currentTime = 10;
    // Into section B (bar 33), after an A phrase with its own hook.
    for (let k = 0; k < 1000 && a.scoreInfo()?.bar !== 33; k++) advance(a, stats, 0.1);
    const was = a.scoreInfo();
    assert.deepEqual([was.section, was.bar], ['B', 33]);
    a.setScoreStyle({ mood: 'uneasy' });
    const now = a.scoreInfo();
    assert.equal(now.mood, 'uneasy');
    assert.deepEqual(['kind', 'lead', 'hook', 'riff'].map((k) => now[k]), ['kind', 'lead', 'hook', 'riff'].map((k) => was[k]));
  });
});

test('with Web Audio: a stalled frame loop resyncs without a burst', async () => {
  await withMock(async (a, stats) => {
    a.setScoreStyle({ mood: 'hopeful' });
    stats.ctx.currentTime = 10;
    await traced(async (tr, mt) => {
      advance(a, stats, 8, { threat: 0.5 });
      // Swung, and gliding toward Uneasy, when the frames stop for two seconds.
      a.setScoreStyle({ mood: 'uneasy' });
      advance(a, stats, 2, { threat: 0.5 });
      const at = tr.length, notes = mt.length, starts = stats.starts.length;
      stats.ctx.currentTime += 2;
      a.update(2, { threat: 0.5 });
      const now = stats.ctx.currentTime;
      const played = tr.slice(at).filter((x) => !x.skipped);
      assert.ok(played.length <= 4, `${played.length} steps scheduled after the stall`);
      assert.ok(tr.slice(at).filter((x) => x.skipped).length >= 10, 'the missed steps are passed over');
      assert.ok(stats.starts.slice(starts).every((t) => t >= now), 'nothing starts in the past');
      assert.ok(mt.slice(notes).every((n) => n.t >= now), 'no catch-up melody');
      advance(a, stats, 5, { threat: 0.5 });
      checkGrid(tr);
    });
  });
});

test('with Web Audio: every melody kind plays on every band lead; call answers in a second voice; the anthem sings its notes', async () => {
  const { BANDS } = await import('../js/audio/worlds.js');
  const { anthemNotes } = await import('../js/audio/songs.js');
  const { STYLE_OPTIONS } = await import('../js/audio/style.js');
  const pinnable = new Set(STYLE_OPTIONS.lead.map(([v]) => v));
  await withMock(async (a, stats) => {
    stats.ctx.currentTime = 10;
    a.setScoreStyle({ shape: 'off' });
    advance(a, stats, 1);
    for (const [band, { leads }] of Object.entries(BANDS)) {
      for (const lead of leads.filter((l) => pinnable.has(l))) {
        for (const kind of ['hooks', 'riff', 'call', 'anthem']) {
          await traced(async (tr, mt) => {
            a.setScoreStyle({ band, melody: kind, lead });
            advance(a, stats, 5, { threat: 0.3 });
            const label = `${kind} on ${lead} (${band})`;
            assert.ok(mt.length >= 4, `${label}: ${mt.length} notes`);
            assert.ok(mt.every((n) => n.melody === kind && (n.voice !== 'lead' || n.lead === lead)), label);
            assert.ok(mt.every((n) => n.midi <= 81), `${label}: nothing above A5`);
            assert.equal(new Set(mt.map((n) => n.voice)).size, kind === 'call' ? 2 : 1, `${label}: voices`);
            const sung = new Set(anthemNotes(a.scoreInfo().mood).map((n) => n.midi));
            if (kind === 'anthem') assert.ok(mt.every((n) => sung.has(n.midi)), `${label}: the anthem's own notes`);
          });
        }
      }
    }
  });
});

test('with Web Audio: Dire sings its composed melodies an octave below the other worlds (the shrill rule)', async () => {
  const { WORLDS } = await import('../js/audio/worlds.js');
  assert.deepEqual(['hopeful', 'uneasy', 'dire'].map((m) => WORLDS[m].shift), [12, 12, 0]);
  const heard = {};
  for (const mood of ['uneasy', 'dire']) {
    await withMock(async (a, stats) => {
      a.setScoreStyle({ mood, melody: 'hooks', lead: 'choir', shape: 'off' });
      stats.ctx.currentTime = 10;
      await traced(async (tr, mt) => {
        advance(a, stats, 20, { threat: 0.3 });
        heard[mood] = mt.map((n) => n.midi);
      });
    });
  }
  const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(heard.dire.length > 20 && avg(heard.dire) <= avg(heard.uneasy) - 7, `Dire ${avg(heard.dire)} vs Uneasy ${avg(heard.uneasy)}`);
});

test('with Web Audio: night darkens every band, the dark band most; day brings it back', async () => {
  await withMock(async (a, stats) => {
    stats.ctx.currentTime = 10;
    const targets = (from) => new Set(stats.events.slice(from).filter((e) => e.kind === 'target' && e.param.owner.kind === 'biquad').map((e) => e.v));
    advance(a, stats, 1, { night: false });
    let mark = stats.events.length;
    advance(a, stats, 1, { night: true });
    const night = targets(mark);
    // Chords and pad 650, arp 1300, lead 1600 (today's night); the dark band 30% lower; drums 4500, bass 450.
    for (const f of [650, 1300, 1600, 455, 910, 1120, 4500, 450]) assert.ok(night.has(f), `night ${f} Hz`);
    mark = stats.events.length;
    advance(a, stats, 1, { night: false });
    const day = targets(mark);
    for (const f of [1400, 2200, 2600, 9000, 700]) assert.ok(day.has(f), `day ${f} Hz`);
  });
});

test('with Web Audio: crashes only on a song or mood arrival, braams in the dark band at most every second phrase, kicks duck, the heavy snare is big, a new groove enters sparsely', async () => {
  await withMock(async (a, stats) => {
    stats.ctx.currentTime = 10;
    await traced(async (tr) => {
      const mark = stats.events.length;
      advance(a, stats, 5, { dire: 0, threat: 0.5 });
      advance(a, stats, 200, { dire: 0.9, threat: 0.5 });
      checkGrid(tr);
      const has = (x, inst) => x.insts.includes(inst);
      // A new section is no arrival: no crash every 32 bars.
      const changed = (x, p) => !!p && ['song', 'mood'].some((k) => x[k] !== p[k]);
      let lastBraam = -Infinity;
      tr.forEach((x, i) => {
        const p = tr[i - 1], line = x.step === 0 && x.bar % 8 === 0, where = `bar ${x.bar} step ${x.step}`;
        assert.equal(has(x, 'crash'), line && changed(x, p) && x.level >= 0, `${where}: a crash only on an arrival`);
        if (has(x, 'braam')) {
          assert.ok(line && x.band === 'dark' && changed(x, p), `${where}: a braam on a dark arrival`);
          assert.ok(x.bar - lastBraam >= 16, `${where}: at most every second phrase`);
          lastBraam = x.bar;
        }
        assert.ok(x.groove === 'heavy' ? !has(x, 'snare') : !has(x, 'bigSnare'), `${where}: the heavy groove's snare is the big one`);
      });
      assert.ok(tr.some((x) => has(x, 'crash')) && lastBraam > 0, 'arrivals and braams happen');
      assert.ok(tr.some((x, i) => x.step === 0 && x.bar % 8 === 0 && i && x.section !== tr[i - 1].section && !changed(x, tr[i - 1])), 'a section changed on its own');
      assert.ok(tr.some((x) => has(x, 'bigSnare')), 'the big snare plays');
      // Each kick dips the pads and bass of all three bands.
      const kicks = tr.filter((x) => has(x, 'kick')).length;
      const dips = stats.events.slice(mark).filter((e) => e.kind === 'target' && e.v === 0.65).length;
      assert.equal(dips, 3 * kicks);
      // After a groove change: kick and bass only in the first bar, hats join in the second, complete from the third.
      const SPARSE = [['kick', 'bass', 'crash', 'braam'], ['kick', 'bass', 'hat', 'ohat', 'shaker']];
      let entries = 0;
      for (const ph of byPhrase(tr)) {
        const p = tr[tr.indexOf(ph[0]) - 1];
        if (!p || p.groove === ph[0].groove) continue;
        entries++;
        for (const x of ph.filter((y) => y.bar % 8 < 2)) {
          assert.ok(x.insts.every((n) => SPARSE[x.bar % 8].includes(n)), `bar ${x.bar} step ${x.step}: ${x.insts}`);
        }
        // (A breath phrase is thin all through by design.)
        if (ph[0].bar % 32 >= 8) assert.ok(ph.some((x) => x.bar % 8 >= 2 && x.insts.some((n) => !SPARSE[1].includes(n))), 'complete from the third bar');
      }
      assert.ok(entries >= 2, `${entries} groove changes`);
    });
  });
});

test('arpeggios: warm and synth in eighths up to tension and sixteenths in a fight; dark none when calm, quarters with tension, eighths in a fight; never above A5', async () => {
  const { arpAt, arpMidi } = await import('../js/audio/sequencer.js');
  const { CHORDS } = await import('../js/audio/harmony.js');
  const steps = (band, level) => Array.from({ length: 16 }, (_, s) => s).filter((s) => arpAt(band, level, s));
  for (const band of ['warm', 'synth']) {
    for (const level of [-1, 0, 1]) assert.deepEqual(steps(band, level), [0, 2, 4, 6, 8, 10, 12, 14], `${band} level ${level}`);
    for (const level of [2, 3]) assert.equal(steps(band, level).length, 16, `${band} level ${level}`);
  }
  assert.deepEqual([-1, 0].map((l) => steps('dark', l).length), [0, 0]);
  assert.deepEqual(steps('dark', 1), [0, 4, 8, 12]);
  for (const level of [2, 3]) assert.deepEqual(steps('dark', level), [0, 2, 4, 6, 8, 10, 12, 14]);
  for (const band of ['warm', 'synth', 'dark']) for (const level of [-1, 0, 1, 2, 3]) for (let s = 0; s < 16; s++) {
    const n = arpAt(band, level, s);
    if (!n) continue;
    assert.ok([1, 2, 3].includes(n.idx) && n.vel > 0 && n.vel <= 1, `${band} ${level} ${s}`);
    for (const chord of Object.keys(CHORDS)) {
      const m = arpMidi(band, chord, n);
      assert.ok(m <= 81, `${band} ${level} ${s} over ${chord}: ${m}`);
      assert.equal(m % 12, CHORDS[chord][n.idx] % 12, 'still the chord tone');
    }
  }
});

// ---- the score answering the game: reactions, the hush, the endings ----

// [lab button, the reaction it plays, its grid: 4 = the next beat, 16 = the next downbeat].
const ANSWERS = [['hordeArrived', 'hit', 16], ['fall', 'fall', 16], ['hordeDestroyed', 'lift', 4], ['breakout', 'pulse', 4]];
// The first step played from trace index `from` on that lands on the grid: every 4 steps a beat, 16 a downbeat.
const nextOn = (tr, from, every) => tr.slice(from).find((x) => !x.skipped && x.step % every === 0);
// Which step of `steps` a note at time `t` starts on.
const stepOf = (steps, t) => steps.findIndex((x) => Math.abs(x.t - t) < 1e-9);
// The three bands' own gains (silent at first, straight into the music limiter).
function bandGains(stats) {
  const limiter = stats.created.find((n) => n.kind === 'compressor' && n.threshold.value === -8);
  const [warm, synth, dark] = stats.created.filter((n) => n.kind === 'gain' && n.outs.includes(limiter) && n.gain.value === 0);
  return { warm, synth, dark };
}

test('with Web Audio: the score answers each event on the next beat or downbeat, on the band\'s own instruments', async () => {
  const { BANDS } = await import('../js/audio/worlds.js');
  const { anthemNotes } = await import('../js/audio/songs.js');
  for (const mood of ['hopeful', 'uneasy', 'dire']) {
    await withMock(async (a, stats) => {
      a.setScoreStyle({ mood, shape: 'off' });
      a.setLevelOverride(1);
      stats.ctx.currentTime = 10;
      await traced(async (tr, mt, rt) => {
        advance(a, stats, 3);
        const b = BANDS[a.scoreInfo().band];
        for (const [type, kind, every] of [...ANSWERS, ['hordeContact', 'stab', 16]]) {
          // A sighting in a fight is answered by the stab, never the hush.
          if (type === 'hordeContact') a.setLevelOverride(2);
          const from = tr.length, seen = rt.length, notes = mt.length;
          a.labEvent(type);
          advance(a, stats, 14);
          const label = `${mood} ${type}`;
          assert.deepEqual(rt.slice(seen).map((r) => r.kind), [kind], label);
          const r = rt[seen], on = nextOn(tr, from, every), i = tr.indexOf(on);
          assert.deepEqual([r.t, r.bar, r.step], [on.t, on.bar, on.step], `${label}: on the next ${every === 16 ? 'downbeat' : 'beat'}`);
          const answer = (k) => tr[i + k].answer;
          if (kind === 'hit') {
            assert.ok([...on.insts, ...on.answer].includes('crash') && on.answer.includes('kick'), `${label}: crash and kick`);
            assert.equal(on.answer.includes('braam'), mood !== 'hopeful', `${label}: a braam in Uneasy and Dire`);
            assert.ok(on.answer.filter((n) => n === b.chords).length >= (mood === 'hopeful' ? 6 : 3), `${label}: the band's chord, doubled in Hopeful`);
          }
          if (kind === 'stab') assert.deepEqual(on.answer, [b.chords, b.chords, b.chords], label);
          if (kind === 'lift') assert.deepEqual([0, 1, 2, 3, 4].map((k) => answer(k).length), [1, 1, 1, 1, 3], `${label}: a run into a chord`);
          if (kind === 'pulse') {
            assert.deepEqual(Array.from({ length: 16 }, (_, k) => answer(k).length), Array.from({ length: 16 }, (_, k) => (k % 2 ? 0 : 2)), `${label}: a dyad on every eighth for a bar`);
            assert.ok(answer(0).every((n) => n === b.arp), label);
          }
          if (kind === 'fall') {
            const quote = mt.slice(notes).filter((n) => n.voice === 'quote');
            const theme = anthemNotes(mood).filter((n) => n.s < 32);
            assert.deepEqual(quote.map((n) => n.midi), theme.map((n) => n.midi), `${label}: the anthem's first two bars`);
            assert.deepEqual(quote.map((n) => stepOf(tr, n.t) - i), theme.map((n) => 2 * n.s), `${label}: at half speed`);
            assert.ok(mt.slice(notes).every((n) => n.voice === 'quote' || n.t >= tr[i + 64].t || n.t < on.t), `${label}: alone for its four bars`);
            const dips = stats.events.filter((e) => e.kind === 'target' && Math.abs(e.t - on.t) < 1e-9 && e.param.owner.kind === 'gain');
            assert.ok(dips.length >= 21, `${label}: every band part but the lead dips (${dips.length})`);
          }
          if (type === 'hordeContact') assert.equal(a.scoreInfo().hush, false, 'no hush in a fight');
        }
      });
    });
  }
});

test('with Web Audio: reactions never pile up: events together merge into the strongest, and each type waits 30 s', async () => {
  await withMock(async (a, stats) => {
    a.setScoreStyle({ mood: 'uneasy' });
    a.setLevelOverride(1);
    stats.ctx.currentTime = 10;
    await traced(async (tr, mt, rt) => {
      advance(a, stats, 3);
      a.onEvents([{ type: 'alert', kind: 'breakout', level: 'bad' }, { type: 'alert', kind: 'hordeDestroyed', level: 'good' }]);
      // Still waiting for its beat when the horde crosses: one answer, the strongest.
      a.onEvents([{ type: 'alert', kind: 'hordeArrived', level: 'bad' }]);
      advance(a, stats, 5);
      assert.deepEqual(rt.map((r) => r.kind), ['hit']);
      a.labEvent('hordeArrived');
      advance(a, stats, 10);
      a.labEvent('breakout');
      advance(a, stats, 5);
      assert.deepEqual(rt.map((r) => r.kind), ['hit'], 'nothing answered twice within 30 s');
      advance(a, stats, 20);
      a.labEvent('hordeArrived');
      advance(a, stats, 4);
      assert.deepEqual(rt.map((r) => r.kind), ['hit', 'hit']);
    });
  });
});

test('with Web Audio: a sighting in the calm brings the hush, a heartbeat over the world\'s drone or pad, and the band returns after 16 bars', async () => {
  const KEEPS = { hopeful: ['warmPad'], uneasy: ['stab'], dire: ['subDrone'] };
  for (const mood of Object.keys(KEEPS)) {
    await withMock(async (a, stats) => {
      a.setScoreStyle({ mood, shape: 'off' });
      a.setLevelOverride(0);
      stats.ctx.currentTime = 10;
      await traced(async (tr, mt, rt) => {
        advance(a, stats, 3);
        const from = tr.length;
        a.labEvent('hordeContact');
        advance(a, stats, 4);
        assert.equal(a.scoreInfo().hush, true, `${mood}: hushed`);
        advance(a, stats, 50);
        checkGrid(tr);
        const [h, back] = rt;
        assert.deepEqual([h.kind, back?.kind], ['hush', 'return'], mood);
        const on = nextOn(tr, from, 16);
        assert.deepEqual([h.t, h.bar], [on.t, on.bar], `${mood}: from the next downbeat`);
        assert.equal(back.bar, h.bar + 16, `${mood}: it holds 16 bars`);
        // The band thins over the hush's first bar; then only a heartbeat on 1 and 3 and the drone or pad.
        const held = tr.filter((x) => x.bar > h.bar && x.bar < back.bar);
        for (const x of held) {
          const where = `${mood} bar ${x.bar} step ${x.step}`;
          assert.deepEqual(x.insts, x.step % 8 === 0 ? ['kick'] : [], `${where}: ${x.insts}`);
          assert.ok(x.tones.every((n) => KEEPS[mood].includes(n)) && !x.answer.length, `${where}: ${x.tones}`);
        }
        assert.ok(held.some((x) => x.tones.length), `${mood}: the ${KEEPS[mood]} holds`);
        assert.equal(mt.filter((n) => n.t >= h.t && n.t < back.t).length, 0, `${mood}: no melody in the hush`);
        // The band returns over two bars as a groove enters (kick and bass, then the hats); the melody resumes.
        const ret = tr.filter((x) => x.bar >= back.bar);
        assert.ok(ret.filter((x) => x.bar === back.bar).every((x) => x.insts.every((n) => ['kick', 'bass'].includes(n))), `${mood}: kick and bass first`);
        assert.ok(ret.some((x) => x.bar >= back.bar + 2 && x.insts.some((n) => !['kick', 'bass'].includes(n))), `${mood}: then the whole groove`);
        assert.ok(mt.some((n) => n.t >= back.t), `${mood}: the melody returns`);
        assert.equal(a.scoreInfo().hush, false);
        // Another sighting within four minutes: a stab, not a second hush.
        a.labEvent('hordeContact');
        advance(a, stats, 3);
        assert.deepEqual(rt.slice(2).map((r) => r.kind), ['stab']);
      });
    });
  }
});

test('with Web Audio: the hush ends with the hit when the fight starts', async () => {
  await withMock(async (a, stats) => {
    a.setScoreStyle({ mood: 'dire', shape: 'off' });
    a.setLevelOverride(0);
    stats.ctx.currentTime = 10;
    await traced(async (tr, mt, rt) => {
      advance(a, stats, 3);
      a.labEvent('hordeContact');
      advance(a, stats, 6);
      assert.equal(a.scoreInfo().hush, true);
      const from = tr.length;
      a.setLevelOverride(2);
      advance(a, stats, 4);
      assert.deepEqual(rt.map((r) => r.kind), ['hush', 'hit']);
      const on = nextOn(tr, from, 16);
      assert.equal(rt[1].t, on.t, 'on the next downbeat');
      assert.ok(on.answer.includes('braam') && [...on.insts, ...on.answer].includes('crash'), `${on.insts} ${on.answer}`);
      assert.equal(a.scoreInfo().hush, false);
      assert.ok(tr.slice(tr.indexOf(on) + 1).some((x) => x.insts.some((n) => n !== 'kick')), 'the full band is back');
    });
  });
});

test('with Web Audio: a hit on a chord change plays the new chord, on a phrase line into a new mood too', async () => {
  const { CHORDS } = await import('../js/audio/harmony.js');
  const { BANDS } = await import('../js/audio/worlds.js');
  // Frame by frame until the last step scheduled is `ready`; then `before()`, the hit, and its downbeat (with the
  // step before it).
  function hitWhen(a, stats, tr, rt, ready, before = () => {}) {
    for (let k = 0; k < 5000 && !(tr.length && ready(tr.at(-1))); k++) advance(a, stats, 0.01, {}, 0.01);
    assert.ok(ready(tr.at(-1)), 'the moment to send the hit came');
    before();
    const from = tr.length, seen = rt.length;
    a.labEvent('hordeArrived');
    advance(a, stats, 3);
    const on = nextOn(tr, from, 16), i = tr.indexOf(on);
    assert.deepEqual(rt.slice(seen).map((r) => [r.kind, r.t]), [['hit', on.t]], 'the hit on the next downbeat');
    return [on, tr[i - 1]];
  }
  // The hit plays the chord that starts on its downbeat: the band's chords instrument on that chord's upper voices,
  // and every pitch it plays (bass, braam, the doubled chord, the pad) one of that chord's notes.
  function playsNew(on, prev, label) {
    assert.notEqual(on.chord, prev.chord, `${label}: the chord changes on this downbeat`);
    const notes = CHORDS[on.chord], pcs = new Set(notes.map((m) => m % 12));
    const struck = on.pitches.filter((m, k) => on.answer[k] === BANDS[on.band].chords);
    assert.ok(notes.slice(1).every((m) => struck.includes(m)), `${label}: the band's chord is ${on.chord} ${notes.slice(1)}, not ${prev.chord}: ${struck}`);
    const pitched = on.pitches.filter((m) => m !== undefined);
    assert.ok(pitched.length >= 4 && pitched.every((m) => pcs.has(m % 12)), `${label}: every pitch of the hit is in ${on.chord}: ${pitched}`);
  }
  // Inside a phrase: sent in an odd bar, so the hit lands on the bar a new chord starts.
  await withMock(async (a, stats) => {
    a.setScoreStyle({ mood: 'uneasy', shape: 'off' });
    a.setLevelOverride(1);
    stats.ctx.currentTime = 10;
    await traced(async (tr, mt, rt) => {
      advance(a, stats, 3);
      const [on, prev] = hitWhen(a, stats, tr, rt, (x) => [1, 3, 5].includes(x.bar % 8));
      assert.ok([2, 4, 6].includes(on.bar % 8), `bar ${on.bar}: a chord line inside the phrase`);
      playsNew(on, prev, 'a chord change');
    });
  });
  // On a phrase line into a new mood: Dire pinned with the line next to schedule, so the new phrase (its band, its
  // loop) and the hit arrive together.
  await withMock(async (a, stats) => {
    a.setScoreStyle({ mood: 'hopeful', shape: 'off' });
    a.setLevelOverride(1);
    stats.ctx.currentTime = 10;
    await traced(async (tr, mt, rt) => {
      advance(a, stats, 3);
      const [on, prev] = hitWhen(a, stats, tr, rt, (x) => x.bar % 8 === 7 && x.step === 15, () => a.setScoreStyle({ mood: 'dire' }));
      assert.deepEqual([on.bar % 8, prev.mood, on.mood, on.band], [0, 'hopeful', 'dire', 'dark'], 'a phrase line into a new mood');
      playsNew(on, prev, 'a phrase line into Dire');
    });
  });
});

test('with Web Audio: game over during a hush or a transition starts the ending cleanly on the next downbeat (Review Focus 4)', async () => {
  // During a hush: the hush is cleared and the defeat begins.
  await withMock(async (a, stats) => {
    a.setScoreStyle({ mood: 'uneasy', shape: 'off' });
    a.setLevelOverride(0);
    stats.ctx.currentTime = 10;
    await traced(async (tr, mt, rt) => {
      advance(a, stats, 3);
      a.labEvent('hordeContact');
      advance(a, stats, 5);
      assert.equal(a.scoreInfo().hush, true);
      const from = tr.length;
      a.onEvents([{ type: 'over', won: false }]);
      advance(a, stats, 8, { over: true, paused: true });
      checkGrid(tr, 24 / 128 + 1e-9);
      const on = nextOn(tr, from, 16);
      assert.deepEqual(rt.map((r) => r.kind), ['hush', 'defeat']);
      assert.deepEqual([rt[1].t, rt[1].bar], [on.t, on.bar], 'on the next downbeat');
      assert.ok(tr.slice(from, tr.indexOf(on)).every((x) => x.mood === 'uneasy' && x.song === 'act1'), 'nothing changes before it');
      assert.ok(tr.slice(tr.indexOf(on)).every((x) => x.song === 'anthem' && x.mood === 'dire' && x.band === 'dark'));
      const info = a.scoreInfo();
      assert.deepEqual([info.hush, info.ending, info.song, info.mood, info.band], [false, 'defeat', 'anthem', 'dire', 'dark']);
      assert.ok(mt.some((n) => n.t >= on.t), 'the anthem sings: the hush is over');
    });
  });
  // During a crossfade into Dire: the victory opens the warm band again and fades the dark one.
  await withMock(async (a, stats) => {
    a.setScoreStyle({ mood: 'hopeful', shape: 'off' });
    a.setLevelOverride(1);
    stats.ctx.currentTime = 10;
    await traced(async (tr, mt, rt) => {
      advance(a, stats, 3);
      const { warm, dark } = bandGains(stats);
      a.setScoreStyle({ mood: 'dire' });
      for (let k = 0; k < 60 && a.scoreInfo().band !== 'dark'; k++) advance(a, stats, 0.5);
      advance(a, stats, 3);
      const from = tr.length, mark = stats.events.length;
      a.labEvent('victory');
      advance(a, stats, 6);
      checkGrid(tr);
      const on = nextOn(tr, from, 16);
      assert.deepEqual(rt.map((r) => r.kind), ['victory']);
      assert.equal(rt[0].t, on.t, 'on the next downbeat');
      const moves = (node) => stats.events.slice(mark).filter((e) => e.param === node.gain);
      assert.ok(moves(warm).some((e) => e.v === 1 && Math.abs(e.t - on.t) < 0.06), 'the warm band opens for the victory');
      assert.ok(moves(dark).some((e) => e.v === 0 && Math.abs(e.t - on.t) < 0.06), 'the dark band fades');
      assert.deepEqual(['ending', 'mood', 'band', 'song'].map((k) => a.scoreInfo()[k]), ['victory', 'hopeful', 'warm', 'anthem']);
    });
  });
});

test('with Web Audio: victory: the anthem in Hopeful with the full band, then again with its last two bars broadened, a held tonic, then a quiet loop (F9)', async () => {
  const { anthemNotes } = await import('../js/audio/songs.js');
  // In grid steps from the first downbeat: the second pass, its broadening, the landing and the quiet loop.
  const AGAIN = 128, BROADEN = 224, LANDS = 272, LOOP = 320;
  await withMock(async (a, stats) => {
    a.setScoreStyle({ mood: 'uneasy' });
    stats.ctx.currentTime = 10;
    await traced(async (tr, mt, rt) => {
      advance(a, stats, 3, { threat: 0.3 });
      const from = tr.length;
      a.onEvents([{ type: 'over', won: true }]);
      advance(a, stats, 65, { over: true, paused: true });
      checkGrid(tr);
      const start = tr.indexOf(nextOn(tr, from, 16)), end = tr.slice(start);
      assert.deepEqual([rt[0].kind, rt[0].t], ['victory', end[0].t]);
      // The tempo glides from Uneasy's 104 to Hopeful's 112 over the first phrase.
      assert.deepEqual([end[0].tempo, end[128].tempo], [104, 112]);
      assert.ok(end.slice(128).every((x) => x.tempo === 112));
      // Twice through: the anthem at speed, then again at speed to its last two bars, which run at half speed.
      const theme = anthemNotes('hopeful');
      const sung = mt.filter((n) => n.t >= end[0].t && n.t < end[LOOP].t);
      assert.deepEqual(sung.map((n) => n.midi), [...theme, ...theme].map((n) => n.midi));
      assert.deepEqual(sung.map((n) => stepOf(end, n.t)), [
        ...theme.map((n) => n.s), ...theme.map((n) => AGAIN + (n.s < 96 ? n.s : 96 + 2 * (n.s - 96)))]);
      assert.ok(end[0].insts.includes('crash') && end.slice(0, BROADEN).some((x) => x.insts.includes('clap')), 'the full band arrives');
      assert.ok(!end.slice(1, LANDS).some((x) => x.insts.includes('crash')), 'no crash until the landing: the second pass is no arrival');
      assert.ok(end.slice(AGAIN, BROADEN).some((x) => x.insts.includes('clap')), 'the full band plays the second pass');
      assert.ok(end.slice(BROADEN, LANDS).every((x, k) => k % 2 === 0 || !x.insts.length), 'the drums at half speed too');
      // The tonic lands under a crash and holds for three bars.
      assert.ok(['crash', 'kick', 'bass'].every((n) => end[LANDS].insts.includes(n)), `${end[LANDS].insts}`);
      assert.ok(end[LANDS].tones.filter((n) => n === 'piano').length === 3 && end[LANDS].tones.filter((n) => n === 'warmPad').length === 3, `${end[LANDS].tones}`);
      assert.ok(end.slice(LANDS + 1, LOOP).every((x) => !x.insts.length && !x.tones.length), 'held');
      // About 30–45 s before the quiet loop (spec 5.9).
      const secs = end.slice(0, LOOP).reduce((sum, x) => sum + x.stepLen, 0);
      assert.ok(secs >= 30 && secs <= 45, `the victory lasts ${secs.toFixed(1)} s`);
      // Then the anthem loops quietly: no drums, the melody again from its first note.
      assert.ok(end.slice(LOOP).every((x) => !x.insts.length) && end.slice(LOOP).some((x) => x.tones.length));
      const again = mt.filter((n) => n.t >= end[LOOP].t);
      assert.deepEqual(again.slice(0, 6).map((n) => [n.midi, stepOf(end, n.t) - LOOP]), theme.slice(0, 6).map((n) => [n.midi, n.s]));
      // A lab switch brings the score back from the ending at the next downbeat.
      a.setScoreStyle({ mood: 'dire' });
      advance(a, stats, 4, { over: true, paused: true });
      assert.equal(a.scoreInfo().ending, null);
    });
  });
});

test('with Web Audio: defeat: the anthem in Dire on the low piano over the choir, slowing to 80 bpm, then again sparser over the drone, left on the dominant; the drone fades to silence; a retry brings the score back (F9)', async () => {
  const { anthemNotes } = await import('../js/audio/songs.js');
  const PASS = 128;
  await withMock(async (a, stats) => {
    a.setScoreStyle({ mood: 'dire' });
    stats.ctx.currentTime = 10;
    await traced(async (tr, mt, rt) => {
      advance(a, stats, 3, { threat: 0.3 });
      const from = tr.length;
      a.onEvents([{ type: 'over', won: false }]);
      advance(a, stats, 90, { over: true, paused: true });
      checkGrid(tr);
      const start = tr.indexOf(nextOn(tr, from, 16)), end = tr.slice(start);
      assert.deepEqual([rt[0].kind, rt[0].t], ['defeat', end[0].t]);
      assert.deepEqual([end[0].tempo, end[PASS].tempo], [94, 80], 'slowing to 80 over the anthem');
      assert.ok(end.slice(PASS).every((x) => x.tempo === 80));
      // Twice, solo on the low piano: the first time home on the tonic, the second left hanging on the dominant.
      const home = anthemNotes('dire', false), hanging = anthemNotes('dire');
      const sung = mt.filter((n) => n.t >= end[0].t);
      assert.deepEqual(sung.map((n) => [n.midi, n.lead]), [...home, ...hanging].map((n) => [n.midi, 'lowPiano']), 'twice, solo');
      assert.deepEqual(sung.map((n) => stepOf(end, n.t)), [...home.map((n) => n.s), ...hanging.map((n) => PASS + n.s)]);
      assert.deepEqual([sung[home.length - 1].midi, sung.at(-1).midi], [57, 64], 'home the first time, on the dominant the second');
      assert.ok(end.every((x) => !x.insts.length), 'no drums');
      // The choir holds the chords the first time, closing on the tonic chord under the tonic.
      assert.ok(end.slice(0, PASS).every((x) => x.tones.every((n) => n === 'choir')) && end[0].tones.length === 3, 'the choir holds the chords');
      assert.deepEqual([0, 32, 64, 96].map((k) => end[k].chord), ['Am', 'Dm', 'Bb', 'Am']);
      // The second time sparser: the drone alone under the melody, struck once.
      assert.deepEqual(end[PASS].tones, ['subDrone']);
      assert.ok(end.slice(PASS + 1).every((x) => !x.tones.length), 'one drone, no choir, nothing repeating');
      assert.ok(mt.every((n) => n.t < end[2 * PASS].t), 'nothing sung after the second pass');
      // The drone holds through the second pass, then fades to silence over about eight bars (3 s each at 80 bpm).
      const drone = stats.created.filter((n) => n.kind === 'osc' && Math.abs(n.at - end[PASS].t) < 1e-9 && n.frequency.events[0]?.v === 55);
      assert.equal(drone.length, 1, 'the drone\'s body');
      const fade = drone[0].until - end[2 * PASS].t;
      assert.ok(fade >= 6 * 3 && fade <= 10 * 3, `the drone fades over ${(fade / 3).toFixed(1)} bars`);
      // About 30–45 s of music before the drone's fade (spec 5.9).
      const secs = end.slice(0, 2 * PASS).reduce((sum, x) => sum + x.stepLen, 0);
      assert.ok(secs >= 30, `the defeat lasts ${secs.toFixed(1)} s`);
      // A retry: the game runs again and the score comes back on the next downbeat as a fresh phrase.
      const back = tr.length;
      advance(a, stats, 25, { over: false, threat: 0.3 });
      checkGrid(tr);
      assert.equal(a.scoreInfo().ending, null);
      const first = nextOn(tr, back, 16);
      assert.deepEqual([first.bar % 8, first.song, first.mood], [0, 'act1', 'dire'], 'a new phrase of the act song');
      assert.ok(tr.slice(tr.indexOf(first)).some((x) => x.insts.length), 'the band plays again');
    });
  });
});

test('with Web Audio: back from an ending before its glide is done, the tempo glides on from where it is', async () => {
  const { WORLDS } = await import('../js/audio/worlds.js');
  // The steepest glide the score takes: a defeat from Uneasy, 104 → 80 over a phrase.
  const GLIDE = 24 / 128;
  // [the mood before (pinned), won, how the game leaves the ending]: a retry after a defeat, the menu after a victory.
  for (const [mood, won, leave] of [['uneasy', false, { over: false, threat: 0.3 }], ['dire', true, { menu: true }]]) {
    await withMock(async (a, stats) => {
      a.setScoreStyle({ mood, shape: 'off' });
      stats.ctx.currentTime = 10;
      await traced(async (tr, mt, rt) => {
        const label = `${mood} → ${won ? 'victory' : 'defeat'}`;
        advance(a, stats, 3, { threat: 0.3 });
        a.onEvents([{ type: 'over', won }]);
        // Two bars into the ending, its glide not yet half done, the game goes on.
        for (let k = 0; k < 5000 && !(rt.length && tr.at(-1).bar >= rt[0].bar + 2); k++) advance(a, stats, 0.01, { over: true, paused: true }, 0.01);
        assert.deepEqual(rt.map((r) => r.kind), [won ? 'victory' : 'defeat'], label);
        advance(a, stats, 25, leave);
        checkGrid(tr, GLIDE + 1e-9);
        assert.equal(a.scoreInfo().ending, null, label);
        // The step the score comes back on (the mood before, after the ending's own) and the last step of the ending.
        const start = tr.findIndex((x) => x.t === rt[0].t);
        const j = tr.findIndex((x, i) => i > start && x.mood === mood);
        const [last, first] = [tr[j - 1], tr[j]];
        const world = WORLDS[mood].tempo, target = won ? 112 : 80;
        assert.ok(Math.abs(last.tempo - world) > 3 && Math.abs(last.tempo - target) > 3, `${label}: left mid-glide (${last.tempo})`);
        assert.deepEqual([first.bar % 8, first.step], [0, 0], `${label}: a fresh phrase on a phrase line`);
        assert.equal(first.tempo, last.tempo, `${label}: the new phrase starts where the tempo is (${last.tempo} → ${first.tempo})`);
        // Then one straight glide to the mood's own tempo, landing on it at the next phrase line.
        const ph = tr.slice(j, j + 129).map((x) => x.tempo);
        const d = ph.slice(1, 128).map((x, i) => x - ph[i]);
        assert.ok(d.every((v) => Math.abs(v - d[0]) < 1e-9 && Math.abs(v) <= GLIDE), `${label}: one straight glide`);
        assert.equal(ph[128], world, `${label}: landing on ${world}`);
      });
    });
  }
});

// ---- the score's instruments and the music mix (instruments.js on synth.js) ----

const BAND_NAMES = ['warm', 'synth', 'dark'];
const ROLE_NAMES = ['drums', 'perc', 'bass', 'chords', 'pad', 'arp', 'lead', 'fx'];
const KIT = ['kick', 'snare', 'bigSnare', 'hat', 'ohat', 'clap', 'shaker', 'tamb', 'tom', 'taiko', 'clang', 'crash', 'riser'];
const TONAL = ['piano', 'lowPiano', 'celesta', 'pluck', 'stab', 'warmPad', 'choir', 'braam', 'subDrone', 'sawBass', 'pluckBass', 'subBass'];
// The melody sounds; `answer` is today's mellow answering voice for call and answer.
const LEADS = ['soft', 'bell', 'synth', 'celesta', 'piano', 'dist', 'choir', 'answer'];
const INSTRUMENTS = [...new Set([...KIT, ...TONAL, ...LEADS])];
const SUSTAINED = ['warmPad', 'choir', 'braam', 'subDrone', 'dist'];
// [midi, vel, len, hold]: low, soft and short; middle with a hold; high, loud and long.
const RANGE = [[33, 0.3, 0.12], [57, 0.7, 0.6, 0.3], [84, 1, 4]];

async function withInstruments(fn) {
  const { createSynth } = await import('../js/audio/synth.js');
  const { createMusicMix, createInstruments } = await import('../js/audio/instruments.js');
  const stats = installMock();
  try {
    const ctx = new globalThis.AudioContext();
    const bus = ctx.createGain();
    const synth = createSynth(ctx);
    const mix = createMusicMix(ctx, bus, synth.makeImpulse);
    await fn({ bus, mix, inst: createInstruments(synth, mix), stats });
  } finally {
    delete globalThis.AudioContext;
  }
}

// Graph walks over the mock's recorded connections. `reaches`: can `node` get to one of `ends` without passing a
// node where `stop` holds? Parameters (LFO targets) have no outputs, so modulators never reach anything.
function reaches(node, ends, stop = () => false, seen = new Set()) {
  if (ends.has(node)) return true;
  if (!node.outs || seen.has(node) || stop(node)) return false;
  seen.add(node);
  return node.outs.some((n) => reaches(n, ends, stop, seen));
}
function downstream(node, seen = new Set()) {
  for (const n of node.outs || []) if (!seen.has(n)) { seen.add(n); downstream(n, seen); }
  return seen;
}
// The highest frequency a parameter is ever set or ramped to.
const highest = (param) => Math.max(param.value, ...param.events.map((e) => e.v));
const darkLowpass = (n) => n.kind === 'biquad' && n.type === 'lowpass' && highest(n.frequency) <= 2000;
const isSource = (n) => n.kind === 'osc' || n.kind === 'buffer';

test('instruments: every instrument plays across its range with valid parameters', async () => {
  const { BANDS, GROOVES } = await import('../js/audio/worlds.js');
  await withInstruments(({ inst, stats }) => {
    // Every instrument a band or a groove names exists (the heavy groove's snare plays as bigSnare).
    const named = Object.values(BANDS).flatMap((b) => [b.chords, b.pad, b.arp, b.bass, b.drone, ...b.leads]);
    const drums = Object.values(GROOVES).flatMap((g) => Object.keys(g.patterns)).filter((n) => n !== 'bass');
    for (const n of [...named, ...drums]) if (n) assert.ok(INSTRUMENTS.includes(n), `${n} has no instrument`);
    let t = 1;
    for (const band of BAND_NAMES) {
      for (const name of INSTRUMENTS) {
        for (const [midi, vel, len, hold] of RANGE) {
          t += 0.5;
          const before = stats.nodes;
          const end = inst.play(name, band, t, { midi, vel, len, hold });
          assert.ok(Number.isFinite(end) && end > t, `${name} in ${band} at ${midi}: end ${end}`);
          assert.ok(stats.nodes > before, `${name} in ${band} at ${midi} made no sound`);
        }
      }
    }
    // By frequency, with today's arp bite, and in another part of the band.
    assert.ok(inst.play('tom', 'synth', t += 1, { f: 146, vel: 0.8 }) > t);
    assert.ok(inst.play('pluck', 'synth', t += 1, { midi: 69, vel: 0.9, len: 0.28, bite: true }) > t);
    assert.ok(inst.play('piano', 'warm', t += 1, { midi: 64, vel: 0.6, len: 0.3, role: 'arp' }) > t);
    assert.equal(inst.play('kazoo', 'warm', t += 1, { midi: 60 }), null, 'an unknown instrument plays nothing');
  });
});

test('instruments: no instrument note uses more than six nodes', async () => {
  await withInstruments(({ inst, stats }) => {
    let t = 1;
    const count = (name, band, [midi, vel, len, hold]) => {
      const before = stats.nodes;
      inst.play(name, band, t += 0.5, { midi, vel, len, hold, bite: true });
      return stats.nodes - before;
    };
    for (const band of BAND_NAMES) {
      for (const name of INSTRUMENTS) {
        // A band's first choir note also builds the shared formant body (once per band and part); every later
        // note is the recipe alone.
        const first = count(name, band, RANGE[1]);
        const notes = RANGE.map((r) => count(name, band, r));
        assert.ok(notes.every((n) => n <= 6), `${name} in ${band}: ${notes} nodes per note`);
        assert.ok(first <= 6 + 4, `${name} in ${band}: the first note made ${first} nodes`);
      }
    }
  });
});

test('instruments: sustained instruments are low-passed at or below 2 kHz', async () => {
  await withInstruments(({ inst, mix, stats }) => {
    const routes = new Set(BAND_NAMES.flatMap((b) => ROLE_NAMES.map((r) => mix.route(b, r))));
    let t = 1;
    for (const band of BAND_NAMES) {
      for (const name of SUSTAINED) {
        // In the instrument's own part and as a melody (the dark band's leads include choir and dist).
        for (const role of [undefined, 'lead']) {
          for (const [midi, vel, len, hold] of RANGE) {
            const from = stats.created.length;
            inst.play(name, band, t += 0.5, { midi, vel, len, hold, role });
            const sources = stats.created.slice(from).filter(isSource);
            const where = `${name} in ${band} (${role ?? 'own part'}) at ${midi}`;
            assert.ok(sources.some((s) => reaches(s, routes)), `${where}: nothing reaches the mix`);
            for (const s of sources) assert.ok(!reaches(s, routes, darkLowpass), `${where}: a ${s.type} reaches the mix without a low-pass ≤ 2 kHz`);
          }
        }
      }
    }
    // The distorted lead saturates through a tanh curve: odd, bounded, steep in the middle.
    const from = stats.created.length;
    inst.play('dist', 'dark', t += 1, { midi: 69, vel: 1, len: 1 });
    const shaper = stats.created.slice(from).find((n) => n.kind === 'shaper');
    assert.ok(shaper?.curve, 'dist has a WaveShaper with a curve');
    const c = shaper.curve, mid = (c.length - 1) / 2;
    assert.ok(Math.abs(c[0] + 1) < 0.01 && Math.abs(c[c.length - 1] - 1) < 0.01, 'full scale stays full scale');
    assert.ok(c.every((v, i) => Math.abs(v + c[c.length - 1 - i]) < 1e-6), 'the curve is odd');
    assert.ok(c[Math.round(mid + c.length / 8)] > 0.5, 'a quarter of full scale is driven past half');
  });
});

test('instruments: the choir sings "ooh" through formants near 350 and 750 Hz under a 1.2 kHz low-pass', async () => {
  await withInstruments(({ inst, mix, stats }) => {
    const routes = new Set(BAND_NAMES.flatMap((b) => ROLE_NAMES.map((r) => mix.route(b, r))));
    const soft = (n) => n.kind === 'biquad' && n.type === 'lowpass' && highest(n.frequency) <= 1200;
    let t = 1;
    for (const band of BAND_NAMES) {
      for (const role of [undefined, 'lead']) {
        const from = stats.created.length;
        inst.play('choir', band, t += 1, { midi: 69, vel: 1, len: 2, role });
        const made = stats.created.slice(from);
        const formants = made.filter((n) => n.kind === 'biquad' && n.type === 'bandpass').map((n) => n.frequency.value).sort((a, b) => a - b);
        assert.equal(formants.length, 2, `${band} ${role ?? 'pad'}: two formants`);
        assert.ok(Math.abs(formants[0] - 350) <= 50 && Math.abs(formants[1] - 750) <= 50, `formants ${formants}`);
        for (const s of made.filter(isSource)) assert.ok(!reaches(s, routes, soft), `${band}: a choir ${s.type} escapes the 1.2 kHz low-pass`);
      }
    }
  });
});

test('mix: the dip lowers every part but the lead in every band, and lifts it back', async () => {
  await withInstruments(({ mix, stats }) => {
    const mark = stats.events.length;
    mix.dip(0.4, 30, 0.05);
    mix.dip(1, 34, 0.5);
    const moves = stats.events.slice(mark);
    for (const band of BAND_NAMES) {
      for (const role of ROLE_NAMES) {
        const below = downstream(mix.route(band, role));
        const down = moves.find((e) => e.t === 30 && below.has(e.param.owner));
        const up = moves.find((e) => e.t === 34 && e.param === down?.param);
        if (role === 'lead') { assert.equal(down, undefined, `${band}: the lead is left alone`); continue; }
        assert.ok(down && up, `${band} ${role} dips and returns`);
        assert.ok(Math.abs(down.v - 0.4 * up.v) < 1e-9 && up.v > 0, `${band} ${role}: to 40% of its level, then back`);
      }
    }
  });
});

test('mix: bands crossfade; one reverb per world, fed by every band and opened by the mood (F5)', async () => {
  const { WORLDS } = await import('../js/audio/worlds.js');
  await withInstruments(({ mix, stats }) => {
    const convolvers = stats.created.filter((n) => n.kind === 'convolver');
    assert.equal(convolvers.length, 3, 'three reverbs');
    // One reverb per world, as long as its space, behind its own gate; every band's parts reach all three.
    const gates = {};
    for (const [mood, w] of Object.entries(WORLDS)) {
      const verb = convolvers.find((c) => Math.abs(c.buffer.duration - w.reverb.seconds) < 0.01);
      assert.ok(verb, `${mood}: a ${w.reverb.seconds} s reverb`);
      gates[mood] = stats.created.find((n) => n.kind === 'gain' && n.outs.includes(verb));
      assert.equal(gates[mood].gain.value, 0, `${mood}: closed until the mood opens it`);
      for (const band of BAND_NAMES) assert.ok(downstream(mix.route(band, 'pad')).has(verb), `${band} feeds the ${mood} reverb`);
    }
    let mark = stats.events.length;
    mix.setReverb('hopeful', 20, 1.5);
    const opened = stats.events.slice(mark);
    for (const [mood, gate] of Object.entries(gates)) {
      const e = opened.find((x) => x.param === gate.gain);
      assert.deepEqual([e?.v, e?.t, e?.c], [mood === 'hopeful' ? 1 : 0, 20, 1.5], `${mood}'s reverb ${mood === 'hopeful' ? 'opens' : 'closes'}`);
    }
    mark = stats.events.length;
    mix.setBand('synth', 0, 12, 1.5);
    mix.setBand('dark', 1, 12, 1.5);
    const moves = stats.events.slice(mark);
    const ramp = (e, gain) => e.v === gain && e.t === 12 && ['target', 'linear', 'exponential'].includes(e.kind);
    assert.ok(!moves.some((e) => Object.values(gates).some((g) => e.param === g.gain)), 'a band leaves the reverbs\' gates alone');
    for (const [band, gain] of [['synth', 0], ['dark', 1]]) {
      const verb = convolvers[0];
      const afterAll = (node) => ROLE_NAMES.every((r) => downstream(mix.route(band, r)).has(node));
      // The band's own gain (after every part, not feeding the reverb) and its reverb send move together.
      const level = moves.find((e) => ramp(e, gain) && afterAll(e.param.owner) && !downstream(e.param.owner).has(verb));
      const send = moves.find((e) => ramp(e, gain) && downstream(e.param.owner).has(verb) && downstream(mix.route(band, 'pad')).has(e.param.owner));
      assert.ok(level, `${band}: no gain ramp toward ${gain} on the band`);
      assert.ok(send, `${band}: no ramp toward ${gain} on its reverb send`);
    }
    const warm = new Set(ROLE_NAMES.flatMap((r) => [...downstream(mix.route('warm', r))]));
    const others = new Set(['synth', 'dark'].flatMap((b) => ROLE_NAMES.flatMap((r) => [...downstream(mix.route(b, r))])));
    assert.ok(!moves.some((e) => warm.has(e.param.owner) && !others.has(e.param.owner)), 'the warm band is left alone');
  });
});

test('mix: parts pan where the spec puts them, kicks duck pads and bass, and a limiter guards the music bus', async () => {
  await withInstruments(({ mix, stats, bus }) => {
    const [limiter] = stats.created.filter((n) => n.kind === 'compressor');
    assert.deepEqual(['threshold', 'knee', 'ratio', 'attack', 'release'].map((k) => limiter[k].value), [-8, 3, 12, 0.003, 0.12]);
    assert.ok(limiter.outs.includes(bus));
    const busSet = new Set([bus]);
    for (const band of BAND_NAMES) {
      for (const role of ROLE_NAMES) {
        assert.ok(reaches(mix.route(band, role), busSet), `${band} ${role} reaches the music bus`);
        assert.ok(!reaches(mix.route(band, role), busSet, (n) => n === limiter), `${band} ${role} passes the limiter`);
      }
    }
    // Centre: drums, bass, lead; a little right: perc; a little left: arp and chords; wide: pad and fx.
    const pans = (role) => [...downstream(mix.route('warm', role))].filter((n) => n.kind === 'panner').map((p) => p.pan.value).sort((a, b) => a - b);
    for (const role of ['drums', 'bass', 'lead']) assert.ok(pans(role).every((p) => p === 0), `${role} centred: ${pans(role)}`);
    assert.deepEqual(pans('perc'), [0.25]);
    assert.deepEqual(pans('arp'), [-0.25]);
    assert.deepEqual(pans('chords'), [-0.1]);
    assert.deepEqual(pans('pad'), [-0.5, 0.5]);
    assert.deepEqual(pans('fx'), [-0.5, 0.5]);

    const mark = stats.events.length;
    mix.duck(20);
    const moves = stats.events.slice(mark);
    const dips = moves.filter((e) => e.v === 0.65 && e.t >= 20 && e.t < 20.01);
    const ducked = new Set(dips.map((e) => e.param.owner));
    for (const band of BAND_NAMES) {
      for (const role of ROLE_NAMES) {
        const hit = [...ducked].some((n) => downstream(mix.route(band, role)).has(n));
        assert.equal(hit, role === 'pad' || role === 'bass', `${band} ${role} ${hit ? 'ducks' : 'does not duck'}`);
      }
    }
    for (const dip of dips) {
      const back = moves.find((e) => e.param === dip.param && e.v === 1 && e.t > dip.t);
      assert.ok(back && back.t + 3 * (back.c ?? 0) <= 20.13, 'back to full within ~120 ms');
    }
  });
});

// ---- final-review fixes: the anthem's settings, the songs' identity, pivots, fades, the mood's reverb, new games ----

// Each world's reverb gate: the gain feeding its convolver (told apart by its length).
async function reverbGates(stats) {
  const { WORLDS } = await import('../js/audio/worlds.js');
  const out = {};
  for (const [mood, w] of Object.entries(WORLDS)) {
    const verb = stats.created.find((n) => n.kind === 'convolver' && Math.abs(n.buffer.duration - w.reverb.seconds) < 0.01);
    out[mood] = stats.created.find((n) => n.kind === 'gain' && n.outs.includes(verb));
  }
  return out;
}
const lastMove = (stats, node) => stats.events.filter((e) => e.param === node.gain).at(-1);
// A step's drums and bass, without the arrival accents.
const drumsOf = (x) => x.insts.filter((n) => n !== 'crash' && n !== 'braam');

test('with Web Audio: the anthem in each mood: Hopeful\'s full band under a bright lead the piano doubles; Uneasy thinner and softer; Dire sparse (F1)', async () => {
  const { hitsFor, BANDS } = await import('../js/audio/worlds.js');
  const { altBar } = await import('../js/audio/director.js');
  const pattern = (groove, level, x) => hitsFor(groove, level, x.step, x.bar % 8, { alt: altBar(x.bar) }).map((h) => h.inst).sort();
  for (const mood of ['hopeful', 'uneasy', 'dire']) {
    await withMock(async (a, stats) => {
      // The Anthem song on its section A sings the anthem every phrase; in a fight, so a thinner setting shows.
      a.setScoreStyle({ mood, song: 'anthem', section: 'A', shape: 'off' });
      a.setLevelOverride(2);
      stats.ctx.currentTime = 10;
      await traced(async (tr, mt) => {
        advance(a, stats, 45);
        const played = tr.filter((x) => !x.skipped);
        assert.ok(played.every((x) => x.song === 'anthem' && x.mood === mood && x.level === 2), mood);
        const sung = played.filter((x) => x.leads.length);
        const leads = new Set(sung.map((x) => x.leads[0]));
        const label = `${mood}: ${[...leads]}`;
        assert.ok(sung.length >= 20 && mt.length === sung.length && mt.every((n) => n.melody === 'anthem'), `${mood}: ${sung.length} melody steps`);
        if (mood === 'hopeful') {
          assert.ok(sung.every((x) => x.leads.length === 2 && ['bell', 'celesta'].includes(x.leads[0]) && x.leads[1] === 'piano'), label);
          assert.ok(mt.every((n) => n.double === n.midi - 12), 'the piano an octave below (the shrill rule)');
          assert.equal(leads.size, 2, 'bell and celesta take turns');
          assert.ok(played.filter((x) => x.arp !== null).length >= 100, 'the arpeggio plays');
          for (const x of played) assert.deepEqual(drumsOf(x).sort(), pattern('bounce', 2, x), `hopeful bar ${x.bar} step ${x.step}: the full band`);
          assert.ok(mt.every((n) => n.vel === 1));
        }
        if (mood === 'uneasy') {
          assert.ok(sung.every((x) => x.leads.length === 1 && [...BANDS.synth.leads, 'bell'].includes(x.leads[0])), label);
          assert.ok(played.every((x) => x.arp === null), 'no arpeggio');
          for (const x of played) assert.deepEqual(drumsOf(x).sort(), pattern('standard', 1, x), `uneasy bar ${x.bar} step ${x.step}: tension's drums`);
          assert.ok(mt.every((n) => n.vel === 0.75 && n.double === null), `the melody at three quarters, alone: ${[...new Set(mt.map((n) => n.vel))]}`);
        }
        if (mood === 'dire') {
          assert.ok(sung.every((x) => x.leads.length === 1 && ['lowPiano', 'choir'].includes(x.leads[0])), label);
          assert.ok(played.every((x) => x.arp === null), 'no arpeggio');
          assert.ok(played.every((x) => drumsOf(x).every((n) => n === 'bass' || (n === 'kick' && x.step === 0))), 'only the downbeat kick and the bass');
          assert.ok(played.filter((x) => x.step === 0).every((x) => x.insts.includes('kick')) && played.some((x) => x.insts.includes('bass')));
          assert.ok(played.some((x) => x.tones.includes('subDrone')) && played.some((x) => x.tones.includes('choir')), 'the drone and the choir as usual');
          assert.ok(mt.every((n) => n.vel === 1));
        }
      });
    });
  }
});

test('with Web Audio: a song\'s percussion overlay plays from tension up, never when calm, in a breath or in a hush (F2)', async () => {
  await withMock(async (a, stats) => {
    a.setScoreStyle({ mood: 'hopeful', song: 'act1' });
    a.setLevelOverride(1);
    stats.ctx.currentTime = 10;
    await traced(async (tr, mt, rt) => {
      advance(a, stats, 72);
      const tamb = (x) => x.insts.includes('tamb');
      // Act I's tambourine on steps 6 and 14 of every bar but the breath's (the cycle's first eight).
      const cycle = tr.filter((x) => !x.skipped && x.bar < 32);
      assert.ok(cycle.some((x) => x.bar === 31), 'a whole cycle');
      for (const x of cycle) assert.equal(tamb(x), x.bar % 32 >= 8 && [6, 14].includes(x.step), `bar ${x.bar} step ${x.step}`);
      // Calm: none, once the bar the level falls in (where the old layers fade out) is over.
      a.setLevelOverride(0);
      let from = tr.length;
      advance(a, stats, 10);
      const calm = tr.slice(from).filter((x) => !x.skipped);
      const fell = calm.find((x) => x.level === 0).bar;
      assert.ok(calm.filter((x) => x.bar > fell).every((x) => !tamb(x)), 'none when calm');
      // A hush at tension: none through it.
      a.setLevelOverride(1);
      advance(a, stats, 3);
      from = tr.length;
      a.labEvent('hordeContact');
      advance(a, stats, 25);
      const h = rt.find((r) => r.kind === 'hush');
      assert.ok(h, 'the sighting hushes');
      const hushed = tr.slice(from).filter((x) => !x.skipped && x.bar >= h.bar && x.bar < h.bar + 8);
      assert.ok(hushed.length === 128 && hushed.every((x) => !tamb(x)), 'none in a hush');
    });
  });
});

test('with Web Audio: into a mood change the phrase closes on a chord both moods share (F3)', async () => {
  const { sharedChords } = await import('../js/audio/worlds.js');
  await withMock(async (a, stats) => {
    // Act II's section B in Dire closes on E, which Uneasy does not have.
    a.setScoreStyle({ song: 'act2', section: 'B', shape: 'off' });
    a.setLevelOverride(1);
    stats.ctx.currentTime = 10;
    await traced(async (tr) => {
      advance(a, stats, 3, { dire: 0.9 });
      advance(a, stats, 45, { dire: 0.1 });
      checkGrid(tr);
      const at = (bar) => tr.filter((x) => x.bar === bar && !x.skipped);
      assert.ok([0, 8].every((b) => at(b).every((x) => x.mood === 'dire')) && at(16).every((x) => x.mood === 'uneasy'), 'Dire, then Uneasy');
      assert.ok([6, 7].flatMap(at).every((x) => x.chord === 'E'), 'no change coming: the loop as written');
      const closing = [14, 15].flatMap(at).map((x) => x.chord);
      assert.ok(closing.length === 32 && closing.every((c) => c === 'Am' && sharedChords('dire', 'uneasy').includes(c)), `closes on ${[...new Set(closing)]}`);
    });
  });
});

test('with Web Audio: a fall in intensity fades the higher level\'s extra layers out over a bar (F4)', async () => {
  await withMock(async (a, stats) => {
    a.setScoreStyle({ mood: 'uneasy', melody: 'hooks', shape: 'off' });
    a.setLevelOverride(2);
    stats.ctx.currentTime = 10;
    await traced(async (tr) => {
      advance(a, stats, 6);
      a.setLevelOverride(1);
      const from = tr.length;
      advance(a, stats, 8);
      checkGrid(tr);
      const after = tr.slice(from).filter((x) => !x.skipped);
      const fell = after.find((x) => x.level === 1).bar;
      const [bar1, bar2] = [fell, fell + 1].map((b) => after.filter((x) => x.bar === b));
      assert.ok(bar1.length === 16 && bar2.length === 16, 'two whole bars');
      const vel = (x, inst) => x.vels[x.insts.indexOf(inst)];
      // The fight's sixteenth hats and arpeggio on the odd steps, fading from full to nothing over the bar.
      const odd = bar1.filter((x) => x.step % 2);
      const hats = odd.map((x) => vel(x, 'hat')), arps = odd.map((x) => x.arp);
      assert.ok(hats.every((v) => v > 0) && arps.every((v) => v > 0), `the old layers play: hats ${hats}, arp ${arps}`);
      odd.forEach((x, i) => {
        assert.ok(Math.abs(hats[i] - 0.7 * (1 - x.step / 16)) < 1e-9, `step ${x.step}: hat ${hats[i]}`);
        assert.ok(Math.abs(arps[i] - 0.8 * (1 - x.step / 16)) < 1e-9, `step ${x.step}: arp ${arps[i]}`);
      });
      // Tension's own layers play as usual; from the next bar the old ones are gone.
      assert.deepEqual([vel(bar1[0], 'hat'), vel(bar1[4], 'hat')], [1, 1]);
      assert.ok(bar2.filter((x) => x.step % 2).every((x) => !x.insts.includes('hat') && x.arp === null), 'gone from the second bar');
    });
  });
});

test('with Web Audio: the reverb follows the mood, not the band: Band Dark under Mood Hopeful keeps Hopeful\'s room (F5)', async () => {
  await withMock(async (a, stats) => {
    a.setScoreStyle({ mood: 'hopeful', band: 'dark' });
    stats.ctx.currentTime = 10;
    advance(a, stats, 5);
    assert.deepEqual(['mood', 'band'].map((k) => a.scoreInfo()[k]), ['hopeful', 'dark']);
    const gates = await reverbGates(stats);
    assert.deepEqual(['hopeful', 'uneasy', 'dire'].map((m) => lastMove(stats, gates[m])?.v), [1, 0, 0], 'the hopeful reverb\'s send up, the others down');
    // The mood turning crossfades the rooms over the bands' four bars; the pinned band stays.
    a.setScoreStyle({ mood: 'dire' });
    advance(a, stats, 25);
    assert.deepEqual(['mood', 'band'].map((k) => a.scoreInfo()[k]), ['dire', 'dark']);
    const [up, down] = [lastMove(stats, gates.dire), lastMove(stats, gates.hopeful)];
    assert.deepEqual([up.v, down.v], [1, 0]);
    assert.ok(up.t === down.t && up.c === down.c && up.c > 320 / 112 - 0.01 && up.c < 320 / 94 + 0.01, `over four bars (${up.c})`);
  });
});

test('with Web Audio: a retry after a defeat starts in the new country\'s mood, gliding on from the ending\'s tempo (F10)', async () => {
  await withMock(async (a, stats) => {
    stats.ctx.currentTime = 10;
    await traced(async (tr) => {
      advance(a, stats, 3, { dire: 0.9, threat: 0.3 });
      assert.equal(a.scoreInfo().mood, 'dire');
      a.onEvents([{ type: 'over', won: false }]);
      advance(a, stats, 30, { over: true, paused: true, dire: 0.9 });
      assert.equal(a.scoreInfo().ending, 'defeat');
      const back = tr.length;
      advance(a, stats, 30, { over: false, dire: 0, threat: 0.3 });
      // The steepest glide here: from the defeat's 80 bpm up to Hopeful's 112 over one phrase.
      checkGrid(tr, 32 / 128 + 1e-9);
      assert.equal(a.scoreInfo().ending, null);
      const first = nextOn(tr, back, 16), i = tr.indexOf(first);
      assert.deepEqual([first.bar % 8, first.song, first.mood], [0, 'act1', 'hopeful'], 'straight to Hopeful, no walk from Dire');
      assert.equal(first.tempo, tr[i - 1].tempo, 'from the tempo the ending had');
      assert.equal(tr[i + 128].tempo, 112, 'landing on Hopeful\'s');
    });
  });
});

test('with Web Audio: the score reports whether it swings, as the steps play (F11)', async () => {
  await withMock(async (a, stats) => {
    stats.ctx.currentTime = 10;
    await traced(async (tr) => {
      const cases = [[{ mood: 'hopeful' }, true], [{ mood: 'uneasy' }, false], [{ swing: 'on' }, true], [{ mood: 'hopeful', swing: 'off' }, false], [{ swing: 'auto' }, true]];
      for (const [style, want] of cases) {
        a.setScoreStyle(style);
        advance(a, stats, 25);
        const label = JSON.stringify(a.scoreStyle());
        assert.equal(a.scoreInfo().swing, want, label);
        assert.equal(tr.slice(-16).some((x) => x.swing > 0), want, `${label}: as the steps play`);
      }
    });
  });
});

test('with Web Audio: the alarm and the ping are short and low (the shrill rule); the ping waits 4 s, both are counted', async () => {
  await withMock(async (a, stats) => {
    stats.ctx.currentTime = 10;
    for (const kind of ['alarm', 'ping']) {
      stats.ctx.currentTime += 5;
      const from = stats.created.length, t0 = stats.ctx.currentTime;
      a.ui(kind);
      const oscs = stats.created.slice(from).filter((n) => n.kind === 'osc');
      assert.ok(oscs.length > 0, kind);
      const freqs = oscs.flatMap((n) => [n.frequency.value, ...n.frequency.events.map((e) => e.v)]);
      assert.ok(freqs.every((f) => f < 900), `${kind}: ${freqs.join(', ')} Hz`);
      const end = Math.max(...oscs.map((n) => n.until));
      assert.ok(end - t0 < 0.8, `${kind} lasts ${(end - t0).toFixed(2)} s`);
    }
    assert.deepEqual(a.uiPlayed(), { alarm: 1, ping: 1 });
    stats.ctx.currentTime += 2;
    a.ui('ping');
    assert.equal(a.uiPlayed().ping, 1, 'a second ping within 4 s is dropped');
    stats.ctx.currentTime += 2.1;
    a.ui('ping');
    assert.equal(a.uiPlayed().ping, 2);
  });
});
