// Procedural Web Audio engine: weapons, explosions, zombies, alerts, UI, ambience and an adaptive score.
// Everything is synthesised; nothing touches window or AudioContext until createAudio() is called.

import { DEFAULT_STYLE, validStyle } from './style.js';
import { createSynth } from './synth.js';
import { createSequencer } from './sequencer.js';
import { weightOf } from '../config/alerts.js';

const WEAPONS = {
  rifle: 0.55, mg: 0.6, hmg: 0.65, pistol: 0.4, carbine: 0.5, sniper: 0.9, flamer: 0.65, tower: 0.55,
  checkpoint: 0.5, hq: 0.6, gunship: 0.8, melee: 0.4, baton: 0.4,
};
const EXPLOSIONS = { shell: 1, mortar: 0.8, napalm: 0.9, mine: 0.85, blast: 0.8 };
const DEATHS = { dead: 0.35, unit: 0.6, refugee: 0.5, bus: 0.85 };
const ALERT_LEVELS = { info: 0.4, warn: 0.55, bad: 0.65, good: 0.5 };
// The alert kinds with a tone of their own.
const ALERT_KINDS = new Set([
  'outbreak', 'breakout', 'hordeRumour', 'pileup', 'unitLost', 'built', 'trained', 'tech', 'promiseKept', 'promiseBroken',
]);
// The stingers the score's answer replaces (sequencer.js), so they are not heard twice: the sighting, the fall, the
// act change (the song change) and game over (the endings); the sighting and the fall also arrive as alerts. Every
// other alert keeps its tone, those the score also answers on the beat (the horde crossing, a horde destroyed, a
// breakout) too.
const SCORED = new Set(['hordeContact', 'fall', 'act', 'over']);
const SCORED_ALERTS = new Set(['hordeContact', 'fall']);
const ANSWERED_ALERTS = new Set(['hordeArrived', 'hordeDestroyed', 'breakout']);

// The one sound an alert makes: its kind's own tone when it has one; else, by the kind's weight (js/config/alerts.js),
// the alarm for a critical alert or the ping for an important one (UI sounds: the alert feed plays them through ui());
// else its level's tone. null for the alerts the score answers instead.
export function alertSound(a) {
  if (!a || SCORED_ALERTS.has(a.kind)) return null;
  if (ALERT_KINDS.has(a.kind)) return `alert.${a.kind}`;
  const weight = a.weight || weightOf(a.kind);
  if (weight === 'critical') return 'ui.alarm';
  if (weight === 'important') return 'ui.ping';
  return `alert.${ALERT_LEVELS[a.level] !== undefined ? a.level : 'info'}`;
}

// type → [id, gain, throttle, spatial]. Stingers that also arrive as alerts share a 'sting.*' throttle.
const SIMPLE = {
  artillery: ['artillery', 0.8, 'artillery', true],
  scream: ['scream', 0.8, 'scream', true],
  siren: ['siren', 0.7, 'siren', true],
  climb: ['climb', 0.35, 'climb', true],
  claw: ['claw', 0.35, 'claw', true],
  bite: ['bite', 0.45, 'bite', true],
  placed: ['placed', 0.5, 'placed', true],
  destroyed: ['destroyed', 0.8, 'destroyed', true],
  rejected: ['rejected', 0.5, 'rejected', true],
  turn: ['turn', 0.45, 'turn', true],
  built: ['alert.built', 0.5, 'sting.built', false],
  upgraded: ['upgraded', 0.5, 'sting.upgraded', false],
  decision: ['decision', 0.6, 'sting.decision', false],
  letter: ['letter', 0.5, 'sting.letter', false],
  request: ['request', 0.5, 'sting.request', false],
  news: ['news', 0.45, 'sting.news', false],
  tech: ['alert.tech', 0.6, 'sting.tech', false],
  promoted: ['promoted', 0.55, 'sting.promoted', false],
  hordeRumour: ['alert.hordeRumour', 0.65, 'sting.hordeRumour', false],
  recon: ['recon', 0.5, 'sting.recon', false],
  strikeCalled: ['strikeCalled', 0.55, 'sting.strikeCalled', false],
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function soundFor(event) {
  if (!event || typeof event.type !== 'string') return null;
  const t = event.type;
  if (SCORED.has(t)) return null;
  if (t === 'shot') {
    const w = WEAPONS[event.w] !== undefined ? event.w : 'rifle';
    return { id: `shot.${w}`, gain: WEAPONS[w], throttle: `shot.${w}`, spatial: true };
  }
  // A mortar team's launch: the battery's path with a lighter voice of its own.
  if (t === 'artillery' && event.w === 'mortar') return { id: 'artillery.mortar', gain: 0.6, throttle: 'artillery.mortar', spatial: true };
  if (t === 'explode') {
    const k = EXPLOSIONS[event.kind] !== undefined ? event.kind : 'blast';
    const r = Number.isFinite(event.r) ? event.r : 2;
    return { id: `explode.${k}`, gain: clamp(EXPLOSIONS[k] * (0.75 + r * 0.08), 0, 1), throttle: `explode.${k}`, spatial: true };
  }
  if (t === 'death') {
    const k = DEATHS[event.kind] !== undefined ? event.kind : 'dead';
    return { id: `death.${k}`, gain: DEATHS[k], throttle: `death.${k}`, spatial: true };
  }
  if (t === 'alert') {
    const id = alertSound(event);
    // The alarm and the ping are the alert feed's (ui()), not a world sound.
    if (!id || !id.startsWith('alert.')) return null;
    const base = ALERT_KINDS.has(event.kind)
      ? { id, gain: 0.65, throttle: `sting.${event.kind}` }
      : { id, gain: ALERT_LEVELS[id.slice(6)], throttle: id };
    if (event.merged) base.gain *= 0.35;
    return { ...base, spatial: false };
  }
  const s = SIMPLE[t];
  if (!s) return null;
  return { id: s[0], gain: s[1], throttle: s[2], spatial: s[3] };
}

// The game event the score answers (director.js `reaction`), by type: 'hordeContact' | 'hordeArrived' | 'fall' |
// 'hordeDestroyed' | 'breakout', or 'victory' / 'defeat' for the endings; null for anything else.
export function scoreEvent(event) {
  if (!event) return null;
  if (event.type === 'hordeContact' || event.type === 'fall') return event.type;
  if (event.type === 'alert' && ANSWERED_ALERTS.has(event.kind)) return event.kind;
  if (event.type === 'over') return event.won ? 'victory' : 'defeat';
  return null;
}
// The music lab's event buttons, as the game itself would send them.
const LAB_EVENTS = {
  hordeContact: { type: 'hordeContact' },
  hordeArrived: { type: 'alert', kind: 'hordeArrived', level: 'bad' },
  fall: { type: 'fall' },
  hordeDestroyed: { type: 'alert', kind: 'hordeDestroyed', level: 'good' },
  breakout: { type: 'alert', kind: 'breakout', level: 'bad' },
  victory: { type: 'over', won: true },
  defeat: { type: 'over', won: false },
};

const CHANNELS = ['master', 'sfx', 'ui', 'music', 'ambient'];
export const DEFAULT_VOLUME = { master: 0.8, sfx: 0.85, ui: 0.7, music: 0.6, ambient: 0.6 };
// alarm: a critical alert; ping: an important one (at most one every 4 s); only for kinds without a tone of their own
// (alertSound).
const UI_KINDS = ['click', 'hover', 'place', 'error', 'open', 'close', 'select', 'order', 'alarm', 'ping'];

function noopAudio() {
  const vol = { ...DEFAULT_VOLUME };
  return {
    unlock: () => Promise.resolve(),
    setListener() {},
    activeVoices: () => 0,
    setScoreStyle: () => ({ ...DEFAULT_STYLE }),
    scoreStyle: () => ({ ...DEFAULT_STYLE }),
    setLevelOverride() {},
    scoreInfo: () => null,
    contextState: () => 'unavailable',
    onEvents() {},
    labEvent() {},
    update() {},
    ui() {},
    uiPlayed: () => ({}),
    setVolume(channel, v) { if (CHANNELS.includes(channel)) vol[channel] = clamp(+v || 0, 0, 1); },
    getVolume: (channel) => vol[channel] ?? 0,
  };
}

export const VOICE_CAP = 28;
const UI_CAP = 8;
const GROAN_CAP = 5;
const HEAR_RANGE = 45;
const MIN_GAIN = 0.012;

// Minimum seconds between two plays of one throttle key; exact key first, then the prefix before '.'.
const THROTTLE = {
  'shot.mg': 0.24, 'shot.hmg': 0.22, 'shot.pistol': 0.06, 'shot.carbine': 0.05, 'shot.rifle': 0.045, 'shot.tower': 0.07, 'shot.checkpoint': 0.07, 'shot.hq': 0.09,
  'shot.sniper': 0.12, 'shot.flamer': 0.3, 'shot.gunship': 0.45, 'shot.melee': 0.07, 'shot.baton': 0.07,
  explode: 0.06, artillery: 0.25, 'death.dead': 0.06, 'death.unit': 0.2, 'death.refugee': 0.2, 'death.bus': 0.5,
  scream: 0.45, siren: 1.9, climb: 0.2, claw: 0.1, bite: 0.09, sting: 0.8, alert: 0.35, destroyed: 0.2,
  placed: 0.05, rejected: 0.6, turn: 0.5, 'ui.hover': 0.05, 'ui.ping': 4, 'ui.alarm': 1.2, ui: 0.03,
};
const WET = {
  'shot.sniper': 0.5, 'shot.gunship': 0.3, shot: 0.18, explode: 0.45, artillery: 0.55, whistle: 0.25,
  death: 0.15, scream: 0.55, siren: 0.45, groan: 0.55, destroyed: 0.35, ui: 0, alert: 0.12,
};

function lookup(table, id, fallback) {
  if (table[id] !== undefined) return table[id];
  const head = id.split('.')[0];
  return table[head] !== undefined ? table[head] : fallback;
}

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function createAudio() {
  const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctor) return noopAudio();

  const vol = { ...DEFAULT_VOLUME };
  const listener = { x: 56, z: 56, zoom: 1 };
  const last = new Map();
  let voices = [];
  let uiVoices = [];
  // UI sounds actually played, by kind (Eyes reads it: a routine alert must leave it alone).
  const uiPlayed = {};
  let groans = [];
  let ctx = null;
  // The synthesis primitives (synth.js), bound to the context in build().
  let synth = null;
  let whiteBuf = null;
  let tone = null;
  let noise = null;
  let master = null;
  let reverb = null;
  const bus = {};
  const send = {};
  // Wind, rain and groans; the score's sequencer. Both start with the first update after the sound unlocks.
  let amb = null;
  let score = null;
  // The score's lab switches (style.js; 'auto' ones are decided by director.js each phrase);
  // `levelOverride` pins the intensity level for the music lab.
  let style = { ...DEFAULT_STYLE };
  let levelOverride = null;

  const ready = () => ctx !== null && ctx.state === 'running';
  const volGain = (c) => vol[c] * vol[c];

  function build() {
    synth = createSynth(ctx);
    ({ whiteBuf, tone, noise } = synth);
    master = ctx.createGain();
    master.gain.value = volGain('master');
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    master.connect(comp);
    comp.connect(ctx.destination);
    reverb = ctx.createConvolver();
    reverb.buffer = synth.makeImpulse(2.4, 3);
    const ret = ctx.createGain();
    ret.gain.value = 0.6;
    reverb.connect(ret);
    ret.connect(master);
    for (const c of ['sfx', 'ui', 'music', 'ambient']) {
      bus[c] = ctx.createGain();
      bus[c].gain.value = volGain(c);
      bus[c].connect(master);
      send[c] = ctx.createGain();
      send[c].gain.value = volGain(c);
      send[c].connect(reverb);
    }
  }

  // ---- synthesis primitives (each returns its absolute end time) ----

  const kick = (o, t, f, f2, d, peak) => tone(o, t, { f, f2, a: 0.003, d, peak });
  const seq = (o, t, base, notes) => Math.max(...notes.map(([dt, f, d, peak]) => tone(o, t + dt, { ...base, f, d, peak })));
  const ticks = (o, t, n, span, f0, f1, peak) => {
    let end = t;
    for (let i = 0; i < n; i++) {
      end = Math.max(end, noise(o, t + Math.random() * span, { type: 'bandpass', f: rnd(f0, f1), q: 2, a: 0.001, d: rnd(0.01, 0.03), peak: peak * rnd(0.5, 1) }));
    }
    return end;
  };
  const bell = (o, t, f, d, peak) => Math.max(...[[1, 1], [2, 0.6], [2.76, 0.4], [5.4, 0.22], [8.93, 0.1]]
    .map(([m, p], i) => tone(o, t, { f: f * m, a: 0.002, d: d / (1 + i * 0.6), peak: peak * p })));
  const squelch = (o, t, peak) => noise(o, t, { type: 'bandpass', f: 2000, q: 1, a: 0.003, d: 0.1, peak });

  function rifleLike(o, t, crack, body, bodyD, thump, thumpPeak) {
    const v = rnd(0.92, 1.08);
    return Math.max(
      noise(o, t, { type: 'highpass', f: crack * v, a: 0.001, d: 0.05, peak: 0.9 }),
      noise(o, t, { type: 'bandpass', f: body * v, q: 1.2, a: 0.001, d: bodyD, peak: 0.6 }),
      tone(o, t, { f: thump * v, f2: 50, a: 0.001, d: 0.1, peak: thumpPeak }),
    );
  }

  function swish(o, t) {
    return noise(o, t, { type: 'bandpass', f: 700, f2: 2400, q: 1.5, a: 0.03, d: 0.06, peak: 0.2 });
  }

  function cry(o, t, f0, f1, len) {
    const path = [[0, f0], [0.08, f0 * 1.2], [len, f1]];
    return Math.max(
      tone(o, t, { type: 'sawtooth', path, a: 0.02, hold: len * 0.2, d: len * 0.8, peak: 0.35, flt: ['bandpass', 1000, 2], vib: [[6, 12]] }),
      tone(o, t, { type: 'sawtooth', path, a: 0.02, hold: len * 0.2, d: len * 0.8, peak: 0.15, flt: ['bandpass', 2400, 3], vib: [[6, 12]] }),
    );
  }

  function thud(o, t, peak = 0.6) {
    return Math.max(
      noise(o, t, { type: 'lowpass', f: 350, a: 0.001, d: 0.12, peak }),
      kick(o, t, 110, 50, 0.12, peak * 0.7),
    );
  }

  const S = {
    'shot.rifle': (o, t) => rifleLike(o, t, 1800, 650, 0.13, 150, 0.55),
    'shot.tower': (o, t) => Math.max(
      rifleLike(o, t, 1500, 520, 0.16, 135, 0.6),
      noise(o, t + 0.07, { type: 'bandpass', f: 1200, q: 2, a: 0.001, d: 0.06, peak: 0.25 }),
    ),
    'shot.checkpoint': (o, t) => Math.max(
      rifleLike(o, t, 2100, 800, 0.1, 170, 0.45),
      tone(o, t, { f: 2400, a: 0.001, d: 0.03, peak: 0.08 }),
    ),
    'shot.hq': (o, t) => Math.max(
      rifleLike(o, t, 1400, 420, 0.18, 120, 0.7),
      noise(o, t + 0.09, { type: 'bandpass', f: 900, q: 1.5, a: 0.001, d: 0.08, peak: 0.25 }),
    ),
    'shot.mg': (o, t) => {
      let end = t, at = t;
      const n = 5;
      for (let i = 0; i < n; i++) {
        const p = rnd(0.75, 1);
        end = Math.max(end,
          noise(o, at, { type: 'bandpass', f: rnd(850, 1000), q: 0.5, a: 0.001, d: 0.05, peak: 0.8 * p }),
          tone(o, at, { f: 120, f2: 50, a: 0.001, d: 0.05, peak: 0.45 * p }));
        at += rnd(0.052, 0.062);
      }
      return end;
    },
    // The machine-gun team's heavy gun: rounds closer together than the APC's and a lower, heavier body, kept under
    // 900 Hz so a long burst never reads as shrill.
    'shot.hmg': (o, t) => {
      let end = t, at = t;
      for (let i = 0; i < 5; i++) {
        const p = rnd(0.8, 1);
        end = Math.max(end,
          noise(o, at, { type: 'bandpass', f: rnd(480, 600), q: 0.6, a: 0.001, d: 0.065, peak: 0.85 * p }),
          tone(o, at, { f: 100, f2: 38, a: 0.001, d: 0.075, peak: 0.6 * p }));
        at += rnd(0.04, 0.047);
      }
      return end;
    },
    // A medic's pistol: a short, light pop. A scout's carbine: a rifle's crack with less body.
    'shot.pistol': (o, t) => Math.max(
      noise(o, t, { type: 'highpass', f: 2600 * rnd(0.92, 1.08), a: 0.001, d: 0.025, peak: 0.6 }),
      noise(o, t, { type: 'bandpass', f: 1300, q: 2, a: 0.001, d: 0.05, peak: 0.5 }),
      tone(o, t, { f: 240, f2: 110, a: 0.001, d: 0.04, peak: 0.35 }),
    ),
    'shot.carbine': (o, t) => rifleLike(o, t, 2300, 900, 0.08, 185, 0.4),
    'shot.sniper': (o, t) => Math.max(
      noise(o, t, { type: 'highpass', f: 2600, a: 0.001, d: 0.03, peak: 1 }),
      noise(o, t, { type: 'lowpass', f: 1400, f2: 300, a: 0.001, d: 0.45, peak: 0.9 }),
      kick(o, t, 90, 32, 0.45, 0.9),
      noise(o, t + 0.28, { type: 'bandpass', f: 500, q: 0.8, a: 0.01, d: 0.35, peak: 0.25 }),
      noise(o, t + 0.62, { type: 'bandpass', f: 420, q: 0.8, a: 0.02, d: 0.5, peak: 0.12 }),
    ),
    'shot.flamer': (o, t) => Math.max(
      noise(o, t, { type: 'lowpass', path: [[0, 300], [0.12, 1600], [0.75, 700]], q: 0.8, a: 0.06, hold: 0.25, d: 0.44, peak: 0.8 }),
      noise(o, t, { type: 'lowpass', f: 180, a: 0.05, hold: 0.3, d: 0.4, peak: 0.7 }),
      noise(o, t, { type: 'highpass', f: 3000, a: 0.03, hold: 0.2, d: 0.3, peak: 0.15 }),
      ticks(o, t + 0.05, 5, 0.6, 2500, 5000, 0.2),
    ),
    'shot.gunship': (o, t) => {
      let end = t;
      for (let i = 0; i < 8; i++) {
        end = Math.max(end, noise(o, t + i * 0.07, { type: 'lowpass', f: 320, a: 0.005, d: 0.05, peak: 0.5 }));
      }
      end = Math.max(end, tone(o, t, { f: 1900, f2: 2000, a: 0.1, hold: 0.4, d: 0.2, peak: 0.04 }));
      for (const dt of [0.02, 0.13, 0.24]) {
        end = Math.max(end,
          kick(o, t + dt, 100, 40, 0.13, 0.8),
          noise(o, t + dt, { type: 'bandpass', f: 600, a: 0.001, d: 0.1, peak: 0.6 }),
          noise(o, t + dt, { type: 'highpass', f: 2000, a: 0.001, d: 0.02, peak: 0.4 }));
      }
      return end;
    },
    'shot.melee': (o, t) => Math.max(
      swish(o, t),
      kick(o, t + 0.07, 130, 60, 0.08, 0.6),
      noise(o, t + 0.07, { type: 'lowpass', f: 500, a: 0.001, d: 0.06, peak: 0.5 }),
    ),
    'shot.baton': (o, t) => Math.max(
      swish(o, t),
      noise(o, t + 0.07, { type: 'bandpass', f: 1600, q: 3, a: 0.001, d: 0.03, peak: 0.6 }),
      kick(o, t + 0.07, 160, 80, 0.07, 0.5),
    ),

    'explode.shell': (o, t) => Math.max(
      kick(o, t, 70, 25, 1.1, 1),
      noise(o, t, { type: 'lowpass', f: 1600, f2: 180, a: 0.002, d: 1.4, peak: 1 }),
      noise(o, t, { type: 'highpass', f: 1500, a: 0.001, d: 0.06, peak: 0.6 }),
      ticks(o, t + 0.2, 6, 0.8, 2000, 4000, 0.1),
    ),
    // A mortar bomb: the shell's burst, smaller and shorter.
    'explode.mortar': (o, t) => Math.max(
      kick(o, t, 85, 32, 0.6, 0.9),
      noise(o, t, { type: 'lowpass', f: 1300, f2: 200, a: 0.002, d: 0.8, peak: 0.85 }),
      noise(o, t, { type: 'highpass', f: 1600, a: 0.001, d: 0.05, peak: 0.5 }),
      ticks(o, t + 0.15, 4, 0.5, 2000, 4000, 0.08),
    ),
    'explode.napalm': (o, t) => Math.max(
      noise(o, t, { type: 'lowpass', path: [[0, 250], [0.25, 2400], [1.9, 400]], a: 0.12, hold: 0.4, d: 1.4, peak: 0.9 }),
      noise(o, t, { type: 'lowpass', f: 160, a: 0.1, hold: 0.5, d: 1.2, peak: 0.8 }),
      kick(o, t, 60, 35, 0.5, 0.7),
      ticks(o, t + 0.1, 10, 1.5, 2500, 5000, 0.15),
    ),
    'explode.mine': (o, t) => Math.max(
      noise(o, t, { type: 'highpass', f: 1200, a: 0.001, d: 0.04, peak: 0.9 }),
      kick(o, t, 95, 30, 0.6, 1),
      noise(o, t, { type: 'bandpass', f: 1800, q: 0.8, a: 0.01, d: 0.5, peak: 0.3 }),
      noise(o, t, { type: 'lowpass', f: 900, f2: 150, a: 0.002, d: 0.8, peak: 0.7 }),
    ),
    'explode.blast': (o, t) => Math.max(
      kick(o, t, 80, 32, 0.7, 0.9),
      noise(o, t, { type: 'lowpass', f: 1200, f2: 200, a: 0.002, d: 0.9, peak: 0.8 }),
      noise(o, t, { type: 'highpass', f: 1800, a: 0.001, d: 0.04, peak: 0.5 }),
    ),
    artillery: (o, t) => Math.max(
      kick(o, t, 55, 30, 1.2, 0.8),
      noise(o, t, { type: 'lowpass', f: 350, f2: 120, a: 0.005, d: 1.4, peak: 0.9 }),
      noise(o, t, { type: 'bandpass', f: 900, a: 0.001, d: 0.08, peak: 0.3 }),
    ),
    // A mortar team's launch: a hollow thunk, lighter and shorter than the battery's boom, and no whistle after it.
    'artillery.mortar': (o, t) => Math.max(
      kick(o, t, 120, 55, 0.35, 0.8),
      noise(o, t, { type: 'bandpass', f: 380, q: 1.2, a: 0.002, d: 0.25, peak: 0.6 }),
      noise(o, t, { type: 'lowpass', f: 250, f2: 100, a: 0.003, d: 0.5, peak: 0.5 }),
    ),
    whistle: (o, t) => tone(o, t, { path: [[0, 2200], [1.1, 750]], a: 0.6, hold: 0.3, d: 0.2, peak: 0.25, vib: [[7, 15]] }),

    'death.dead': (o, t) => Math.max(
      thud(o, t, 0.6),
      noise(o, t, { type: 'bandpass', f: 900, a: 0.001, d: 0.06, peak: 0.3 }),
      tone(o, t, { type: 'sawtooth', f: rnd(85, 105), f2: 55, a: 0.02, d: 0.3, peak: 0.2, flt: ['lowpass', 400] }),
    ),
    'death.unit': (o, t) => Math.max(thud(o, t + 0.1, 0.5), cry(o, t, rnd(360, 400), 230, 0.5)),
    'death.refugee': (o, t) => Math.max(thud(o, t + 0.1, 0.4), cry(o, t, rnd(500, 560), 280, 0.42)),
    'death.bus': (o, t) => Math.max(
      noise(o, t, { type: 'bandpass', f: 900, q: 0.7, a: 0.002, d: 0.9, peak: 0.9 }),
      ...[340, 517, 781, 1130].map((f) => tone(o, t, { f, a: 0.002, d: rnd(0.8, 1.3), peak: 0.15 })),
      kick(o, t, 70, 35, 0.4, 0.8),
      noise(o, t, { type: 'highpass', f: 4000, a: 0.002, d: 0.3, peak: 0.25 }),
      ticks(o, t + 0.05, 8, 0.6, 3000, 6000, 0.15),
    ),

    scream: (o, t) => {
      let end = t;
      for (const [m, det, peak] of [[1, 0, 0.35], [1.059, 7, 0.25], [1.5, -12, 0.15]]) {
        const path = [[0, 520 * m], [0.12, 1350 * m], [0.7, 1100 * m], [1.25, 600 * m]];
        end = Math.max(end, tone(o, t, {
          type: 'sawtooth', path, detune: det, a: 0.04, hold: 0.6, d: 0.65, peak,
          flt: ['bandpass', 1700, 3], vib: [[13, 45 * m], [31, 25 * m]],
        }));
      }
      return Math.max(end, noise(o, t, { type: 'highpass', f: 2500, a: 0.05, hold: 0.5, d: 0.6, peak: 0.25 }));
    },
    siren: (o, t) => {
      const path = [[0, 450], [0.95, 1050], [1.9, 450]];
      return Math.max(
        tone(o, t, { type: 'sawtooth', path, a: 0.15, hold: 1.6, d: 0.35, peak: 0.3, flt: ['lowpass', 2800] }),
        tone(o, t, { type: 'sawtooth', path, detune: 12, a: 0.15, hold: 1.6, d: 0.35, peak: 0.3, flt: ['lowpass', 2800] }),
        tone(o, t, { type: 'square', path: path.map(([dt, f]) => [dt, f / 2]), a: 0.15, hold: 1.6, d: 0.35, peak: 0.08, flt: ['lowpass', 1200] }),
      );
    },
    climb: (o, t) => Math.max(
      noise(o, t, { type: 'bandpass', f: 900, f2: 1500, q: 3, a: 0.04, hold: 0.1, d: 0.2, peak: 0.5 }),
      tone(o, t, { type: 'sawtooth', f: 85, a: 0.03, d: 0.3, peak: 0.15, flt: ['lowpass', 350] }),
    ),
    claw: (o, t) => Math.max(...[0, 0.07, 0.15].map((dt) =>
      noise(o, t + dt, { type: 'bandpass', f: rnd(2500, 4000), q: 4, a: 0.005, d: 0.05, peak: 0.5 }))),
    bite: (o, t) => Math.max(
      noise(o, t, { type: 'bandpass', f: 1400, q: 1.5, a: 0.001, d: 0.07, peak: 0.6 }),
      ticks(o, t, 4, 0.08, 2500, 3500, 0.3),
      noise(o, t, { type: 'lowpass', f: 300, a: 0.002, d: 0.12, peak: 0.5 }),
      tone(o, t, { type: 'sawtooth', f: 70, a: 0.02, d: 0.25, peak: 0.2, flt: ['lowpass', 300] }),
    ),
    groan: (o, t) => {
      const f = rnd(60, 125), len = rnd(1, 2.2);
      const path = [[0, f], [len * 0.4, f * 1.15], [len, f * 0.8]];
      const vib = [[rnd(4, 7), f * 0.03]];
      return Math.max(
        tone(o, t, { type: 'sawtooth', path, a: 0.3, hold: len * 0.3, d: len * 0.6, peak: 0.4, flt: ['bandpass', rnd(420, 650), 2.5], vib }),
        tone(o, t, { type: 'sawtooth', path, a: 0.3, hold: len * 0.3, d: len * 0.6, peak: 0.12, flt: ['bandpass', 1100, 3], vib }),
        noise(o, t, { type: 'lowpass', f: 600, a: 0.3, hold: len * 0.3, d: len * 0.5, peak: 0.08 }),
      );
    },

    'alert.info': (o, t) => Math.max(
      tone(o, t, { type: 'triangle', f: 880, d: 0.18, peak: 0.35 }),
      tone(o, t, { f: 1760, d: 0.12, peak: 0.08 }),
    ),
    'alert.warn': (o, t) => seq(o, t, { type: 'square', flt: ['lowpass', 1800] }, [[0, 740, 0.1, 0.18], [0.14, 740, 0.1, 0.18]]),
    'alert.bad': (o, t) => seq(o, t, { type: 'sawtooth', flt: ['lowpass', 1400] }, [[0, 440, 0.25, 0.2], [0.18, 415, 0.4, 0.2]]),
    'alert.good': (o, t) => seq(o, t, { type: 'triangle' }, [[0, 523, 0.3, 0.3], [0.1, 659, 0.3, 0.3], [0.2, 784, 0.35, 0.3]]),
    'alert.outbreak': (o, t) => Math.max(
      tone(o, t, { type: 'sawtooth', f: 110, a: 0.35, hold: 0.4, d: 1.2, peak: 0.18, flt: ['lowpass', 500] }),
      tone(o, t, { type: 'sawtooth', f: 116.5, a: 0.35, hold: 0.4, d: 1.2, peak: 0.18, flt: ['lowpass', 500] }),
      bell(o, t + 0.1, 880, 1.4, 0.1),
      bell(o, t + 0.1, 1244, 1.2, 0.07),
      kick(o, t, 60, 35, 0.5, 0.5),
    ),
    'alert.breakout': (o, t) => seq(o, t, { type: 'square', a: 0.01, hold: 0.14, flt: ['lowpass', 2000] },
      [[0, 520, 0.05, 0.14], [0.22, 390, 0.05, 0.14], [0.44, 520, 0.05, 0.14], [0.66, 390, 0.05, 0.14]]),
    'alert.hordeRumour': (o, t) => Math.max(
      noise(o, t, { type: 'lowpass', f: 140, a: 0.8, hold: 0.6, d: 1.5, peak: 0.6 }),
      tone(o, t, { f: 55, a: 0.8, hold: 0.5, d: 1.5, peak: 0.25 }),
      tone(o, t, { f: 65.4, a: 0.8, hold: 0.5, d: 1.5, peak: 0.12 }),
    ),
    'alert.pileup': (o, t) => Math.max(
      seq(o, t, { type: 'square', flt: ['lowpass', 1200] }, [[0, 294, 0.12, 0.12], [0.1, 311, 0.12, 0.12], [0.2, 330, 0.12, 0.12], [0.3, 349, 0.2, 0.12]]),
      S.groan(o, t + 0.1),
    ),
    'alert.unitLost': (o, t) => seq(o, t, { type: 'triangle', flt: ['lowpass', 2000] }, [[0, 392, 0.3, 0.28], [0.25, 349, 0.3, 0.28], [0.5, 311, 0.8, 0.28]]),
    'alert.built': (o, t) => Math.max(
      noise(o, t, { type: 'bandpass', f: 900, q: 8, a: 0.001, d: 0.05, peak: 0.7 }),
      noise(o, t + 0.12, { type: 'bandpass', f: 900, q: 8, a: 0.001, d: 0.05, peak: 0.7 }),
      tone(o, t + 0.22, { type: 'triangle', f: 1047, d: 0.5, peak: 0.18 }),
    ),
    'alert.trained': (o, t) => {
      let end = t;
      for (let i = 0; i < 6; i++) end = Math.max(end, noise(o, t + i * 0.035, { type: 'highpass', f: 1800, a: 0.001, d: 0.03, peak: 0.1 + i * 0.03 }));
      return Math.max(end, seq(o, t, { type: 'triangle' }, [[0.22, 523, 0.15, 0.25], [0.38, 784, 0.45, 0.25]]));
    },
    'alert.tech': (o, t) => seq(o, t, {}, [[0, 784, 0.35, 0.18], [0.07, 988, 0.35, 0.18], [0.14, 1175, 0.35, 0.18], [0.21, 1568, 0.5, 0.18]]),
    'alert.promiseKept': (o, t) => seq(o, t, { type: 'triangle', a: 0.08, hold: 0.3 }, [[0, 262, 0.9, 0.12], [0, 330, 0.9, 0.12], [0, 392, 0.9, 0.12], [0.05, 523, 0.9, 0.12]]),
    'alert.promiseBroken': (o, t) => Math.max(
      tone(o, t, { type: 'sawtooth', f: 311, f2: 293, a: 0.05, hold: 0.2, d: 0.7, peak: 0.12, flt: ['lowpass', 900] }),
      tone(o, t, { type: 'sawtooth', f: 440, f2: 415, a: 0.05, hold: 0.2, d: 0.7, peak: 0.12, flt: ['lowpass', 900] }),
      kick(o, t, 70, 40, 0.3, 0.4),
    ),

    placed: (o, t) => Math.max(
      tone(o, t, { f: 200, f2: 120, a: 0.002, d: 0.1, peak: 0.5 }),
      noise(o, t, { type: 'lowpass', f: 900, a: 0.001, d: 0.06, peak: 0.4 }),
    ),
    destroyed: (o, t) => Math.max(
      noise(o, t, { type: 'lowpass', f: 700, f2: 150, a: 0.02, hold: 0.3, d: 1.2, peak: 0.8 }),
      kick(o, t, 70, 35, 0.5, 0.8),
      ticks(o, t + 0.1, 12, 1.4, 600, 2500, 0.12),
    ),
    upgraded: (o, t) => Math.max(
      noise(o, t, { type: 'bandpass', f: 900, q: 8, a: 0.001, d: 0.05, peak: 0.5 }),
      seq(o, t, { type: 'triangle' }, [[0.05, 523, 0.3, 0.2], [0.15, 784, 0.35, 0.2]]),
    ),
    decision: (o, t) => Math.max(bell(o, t, 196, 2.2, 0.35), tone(o, t, { f: 294, a: 0.02, d: 1.5, peak: 0.1 })),
    letter: (o, t) => Math.max(
      noise(o, t, { type: 'bandpass', f: 3500, q: 0.8, a: 0.02, d: 0.12, peak: 0.25 }),
      noise(o, t + 0.15, { type: 'bandpass', f: 3000, q: 0.8, a: 0.02, d: 0.12, peak: 0.2 }),
      tone(o, t + 0.3, { type: 'triangle', f: 1175, d: 0.2, peak: 0.15 }),
    ),
    request: (o, t) => seq(o, t, { type: 'triangle' }, [[0, 660, 0.12, 0.25], [0.12, 880, 0.25, 0.25]]),
    news: (o, t) => Math.max(
      ticks(o, t, 7, 0.4, 2300, 2700, 0.35),
      seq(o, t, {}, [[0.45, 1000, 0.1, 0.12], [0.6, 1000, 0.1, 0.12]]),
    ),
    promoted: (o, t) => seq(o, t, { type: 'triangle' }, [[0, 523, 0.12, 0.2], [0.12, 659, 0.12, 0.2], [0.24, 784, 0.5, 0.2], [0.24, 1047, 0.5, 0.15]]),
    recon: (o, t) => Math.max(
      squelch(o, t, 0.3),
      tone(o, t + 0.1, { type: 'sawtooth', f: 95, f2: 85, a: 0.4, hold: 0.6, d: 0.8, peak: 0.12, flt: ['lowpass', 500], vib: [[22, 3]] }),
    ),
    strikeCalled: (o, t) => Math.max(
      squelch(o, t, 0.3),
      seq(o, t, { type: 'square', flt: ['lowpass', 2500] }, [[0.12, 1200, 0.08, 0.1], [0.25, 1500, 0.08, 0.1]]),
      squelch(o, t + 0.4, 0.2),
    ),
    rejected: (o, t) => Math.max(
      ...[180, 210, 240, 260].map((f) => tone(o, t + rnd(0, 0.1), { type: 'sawtooth', f, f2: f * 0.8, a: 0.1, hold: 0.2, d: 0.5, peak: 0.06, flt: ['bandpass', 800, 2] })),
      noise(o, t, { type: 'bandpass', f: 500, q: 1.5, a: 0.1, hold: 0.3, d: 0.5, peak: 0.2 }),
    ),
    turn: (o, t) => tone(o, t, { path: [[0, 2600], [0.25, 2400]], a: 0.01, hold: 0.25, d: 0.1, peak: 0.2, vib: [[28, 120]] }),

    'ui.click': (o, t) => Math.max(
      tone(o, t, { type: 'triangle', f: 1400, a: 0.001, d: 0.03, peak: 0.25 }),
      noise(o, t, { type: 'highpass', f: 4000, a: 0.001, d: 0.01, peak: 0.1 }),
    ),
    'ui.hover': (o, t) => tone(o, t, { f: 2200, a: 0.002, d: 0.02, peak: 0.06 }),
    'ui.place': (o, t) => Math.max(
      tone(o, t, { f: 200, f2: 120, a: 0.002, d: 0.1, peak: 0.35 }),
      noise(o, t, { type: 'lowpass', f: 900, a: 0.001, d: 0.06, peak: 0.25 }),
    ),
    'ui.error': (o, t) => seq(o, t, { type: 'square', flt: ['lowpass', 1200] }, [[0, 200, 0.09, 0.15], [0.1, 160, 0.14, 0.15]]),
    'ui.open': (o, t) => Math.max(
      tone(o, t, { f: 520, f2: 880, a: 0.005, d: 0.1, peak: 0.2 }),
      tone(o, t + 0.05, { type: 'triangle', f: 1320, d: 0.08, peak: 0.06 }),
    ),
    'ui.close': (o, t) => tone(o, t, { f: 880, f2: 520, a: 0.005, d: 0.1, peak: 0.2 }),
    'ui.select': (o, t) => seq(o, t, { type: 'triangle' }, [[0, 990, 0.05, 0.15], [0.04, 1320, 0.08, 0.15]]),
    // Low and short, so neither reads as shrill. The alarm: three blasts (392, 294, 392 Hz) shut under 820 Hz and
    // doubled an octave down, 0.7 s in all. The ping: one soft D5.
    'ui.alarm': (o, t) => Math.max(
      seq(o, t, { type: 'sawtooth', a: 0.012, hold: 0.1, flt: ['lowpass', 820] }, [[0, 392, 0.08, 0.3], [0.2, 294, 0.08, 0.3], [0.4, 392, 0.16, 0.3]]),
      seq(o, t, { a: 0.012, hold: 0.1 }, [[0, 196, 0.08, 0.22], [0.2, 147, 0.08, 0.22], [0.4, 196, 0.16, 0.22]]),
    ),
    'ui.ping': (o, t) => Math.max(
      tone(o, t, { type: 'triangle', f: 587, a: 0.004, d: 0.32, peak: 0.24 }),
      tone(o, t, { f: 880, a: 0.004, d: 0.16, peak: 0.05 }),
    ),
    'ui.order': (o, t) => Math.max(
      noise(o, t, { type: 'bandpass', f: 1800, a: 0.002, d: 0.05, peak: 0.15 }),
      seq(o, t, { type: 'square', flt: ['lowpass', 2200] }, [[0.03, 880, 0.05, 0.08], [0.08, 1175, 0.07, 0.08]]),
    ),
  };

  // ---- voices, spatialisation, throttling ----

  function attenuate(x, z) {
    const d = Math.hypot(x - listener.x, z - listener.z);
    if (d >= HEAR_RANGE) return 0;
    if (d <= 4) return 1;
    const k = (HEAR_RANGE - d) / (HEAR_RANGE - 4);
    return k * k;
  }
  const zoomGain = () => (listener.zoom < 1 ? 0.6 : 1);
  // Pan by the screen-right component of the offset, so left/right follow the rotated camera.
  const panFor = (x, z) => { const y = listener.yaw ?? Math.PI / 4; return clamp(((x - listener.x) * Math.cos(y) - (z - listener.z) * Math.sin(y)) / 18, -1, 1) * 0.85; };

  function posOf(ev) {
    const x = ev.type === 'shot' ? ev.sx : ev.x;
    const z = ev.type === 'shot' ? ev.sz : ev.z;
    return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null;
  }

  function prune(now) {
    const keep = (list) => list.filter((v) => {
      if (v.end + 0.3 > now) return true;
      for (const n of v.nodes) n.disconnect();
      return false;
    });
    voices = keep(voices);
    uiVoices = keep(uiVoices);
    groans = keep(groans);
  }

  function play(id, g, pos, channel, delay = 0) {
    const synth = S[id];
    if (!synth) return null;
    const t = ctx.currentTime + 0.005 + delay;
    const vg = ctx.createGain();
    vg.gain.value = g;
    const pan = ctx.createStereoPanner();
    pan.pan.value = pos ? panFor(pos.x, pos.z) : 0;
    vg.connect(pan);
    pan.connect(bus[channel]);
    const nodes = [vg, pan];
    const dist = pos ? Math.hypot(pos.x - listener.x, pos.z - listener.z) : 0;
    const wet = lookup(WET, id, 0.15) + (pos ? (dist / HEAR_RANGE) * 0.35 : 0);
    if (wet > 0) {
      const sg = ctx.createGain();
      sg.gain.value = wet;
      pan.connect(sg);
      sg.connect(send[channel]);
      nodes.push(sg);
    }
    return { end: synth(vg, t), nodes };
  }

  function throttled(key, now) {
    if (!key) return false;
    const gap = lookup(THROTTLE, key, 0.1);
    if (now - (last.get(key) ?? -1e9) < gap) return true;
    last.set(key, now);
    return false;
  }

  function onEvents(events) {
    if (!ready() || !events || !events.length) return;
    const now = ctx.currentTime;
    // The score answers its events on the beat; before the score starts there is nothing to answer with.
    const answered = events.map(scoreEvent).filter(Boolean);
    if (answered.length) score?.react(answered);
    prune(now);
    const cands = [];
    const counts = new Map();
    for (const ev of events) {
      const s = soundFor(ev);
      if (!s) continue;
      const pos = s.spatial ? posOf(ev) : null;
      const g = pos ? s.gain * attenuate(pos.x, pos.z) * zoomGain() : s.gain;
      if (g < MIN_GAIN && !(s.id === 'artillery' && Number.isFinite(ev.tx))) continue;
      const key = s.throttle;
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
      cands.push({ s, ev, pos, g, key, pri: g + (pos ? 0 : 10) });
    }
    cands.sort((a, b) => b.pri - a.pri);
    for (const c of cands) {
      // Alerts and stingers (non-spatial) get a few reserved voices so a big fight can't drown them.
      if (voices.length >= VOICE_CAP + (c.pos ? 0 : 4)) { if (c.pos) break; continue; }
      if (throttled(c.key, now)) continue;
      const boost = c.key ? Math.min(1.35, 1 + 0.05 * (counts.get(c.key) - 1)) : 1;
      if (c.g >= MIN_GAIN) {
        const v = play(c.s.id, Math.min(1, c.g * boost), c.pos, 'sfx');
        if (v) voices.push(v);
      }
      if (c.s.id === 'artillery' && Number.isFinite(c.ev.tx) && Number.isFinite(c.ev.tz)) {
        const tg = c.s.gain * attenuate(c.ev.tx, c.ev.tz) * zoomGain();
        if (tg >= MIN_GAIN && voices.length < VOICE_CAP) {
          const v = play('whistle', tg, { x: c.ev.tx, z: c.ev.tz }, 'sfx', 1.2);
          if (v) voices.push(v);
        }
      }
    }
  }

  function ui(kind) {
    if (!ready() || !UI_KINDS.includes(kind)) return;
    const now = ctx.currentTime;
    prune(now);
    if (uiVoices.length >= UI_CAP) return;
    if (throttled(`ui.${kind}`, now)) return;
    const v = play(`ui.${kind}`, 1, null, 'ui');
    if (v) { uiVoices.push(v); uiPlayed[kind] = (uiPlayed[kind] || 0) + 1; }
  }

  // ---- ambience and the score (the score's sequencer is sequencer.js) ----

  function startAmbience() {
    const now = ctx.currentTime;
    const amb = { groanTimer: 2, windTimer: 0, night: false };

    const wind = ctx.createBufferSource();
    wind.buffer = whiteBuf;
    wind.loop = true;
    const windLp = ctx.createBiquadFilter();
    windLp.type = 'lowpass';
    windLp.frequency.value = 520;
    amb.windBp = ctx.createBiquadFilter();
    amb.windBp.type = 'bandpass';
    amb.windBp.frequency.value = 400;
    amb.windBp.Q.value = 0.5;
    amb.windGain = ctx.createGain();
    amb.windGain.gain.value = 0;
    wind.connect(windLp);
    windLp.connect(amb.windBp);
    amb.windBp.connect(amb.windGain);
    amb.windGain.connect(bus.ambient);
    amb.whistleBp = ctx.createBiquadFilter();
    amb.whistleBp.type = 'bandpass';
    amb.whistleBp.frequency.value = 900;
    amb.whistleBp.Q.value = 12;
    amb.whistleGain = ctx.createGain();
    amb.whistleGain.gain.value = 0;
    wind.connect(amb.whistleBp);
    amb.whistleBp.connect(amb.whistleGain);
    amb.whistleGain.connect(bus.ambient);
    wind.start(now);

    // Rain: a bright hiss over a soft low wash, faded in and out with the weather, plus scattered drops.
    amb.rainGain = ctx.createGain();
    amb.rainGain.gain.value = 0;
    amb.rainGain.connect(bus.ambient);
    const rainSend = ctx.createGain();
    rainSend.gain.value = 0.25;
    amb.rainGain.connect(rainSend);
    rainSend.connect(send.ambient);
    for (const [type, f, q, level] of [['bandpass', 3600, 0.4, 0.55], ['lowpass', 800, 0.7, 0.45]]) {
      const src = ctx.createBufferSource();
      src.buffer = whiteBuf;
      src.loop = true;
      const flt = ctx.createBiquadFilter();
      flt.type = type;
      flt.frequency.value = f;
      flt.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = level;
      src.connect(flt);
      flt.connect(g);
      g.connect(amb.rainGain);
      src.start(now, Math.random() * 2);
    }
    amb.rain = 0;
    amb.dropT = 0;
    return amb;
  }

  function update(dt, info = {}) {
    if (!ready()) return;
    if (!amb) {
      amb = startAmbience();
      score = createSequencer(ctx, synth, bus.music, { style, levelOverride });
    }
    const now = ctx.currentTime;
    const step = clamp(+dt || 0, 0, 0.25);
    const threat = clamp(+info.threat || 0, 0, 1);
    const night = !!info.night;
    const paused = !!info.paused;
    const dead = Math.max(0, Math.floor(+info.deadNearby || 0));
    const raining = !!info.rain;
    prune(now);

    score.update({ threat, night, paused, dire: clamp(+info.dire || 0, 0, 1), act: info.act, menu: !!info.menu, over: !!info.over });

    if (night !== amb.night) {
      amb.night = night;
      amb.windTimer = 0;
    }

    // Rain fades in over a few seconds, out a little slower; drops patter while it falls.
    const rainTarget = raining ? (paused ? 0.06 : 0.12) : 0;
    if (Math.abs(rainTarget - amb.rain) > 0.001) {
      amb.rain = rainTarget;
      amb.rainGain.gain.setTargetAtTime(rainTarget, now, raining ? 2 : 3);
    }
    if (raining && !paused) {
      amb.dropT -= step;
      while (amb.dropT <= 0) {
        noise(bus.ambient, now + Math.random() * 0.1, { type: 'bandpass', f: rnd(2500, 6500), q: 3, a: 0.001, d: rnd(0.01, 0.04), peak: rnd(0.02, 0.06) });
        amb.dropT += rnd(0.04, 0.16);
      }
    }

    amb.windTimer -= step;
    if (amb.windTimer <= 0) {
      const dim = paused ? 0.5 : 1;
      amb.windBp.frequency.setTargetAtTime(rnd(180, 480) * (night ? 0.75 : 1), now, 3);
      amb.windGain.gain.setTargetAtTime(rnd(0.05, 0.12) * (night ? 1.2 : 1) * dim, now, 3.5);
      amb.whistleBp.frequency.setTargetAtTime(rnd(600, 1400) * (night ? 0.8 : 1), now, 3);
      amb.whistleGain.gain.setTargetAtTime(rnd(0, 0.012) * dim, now, 3);
      amb.windTimer = rnd(2.5, 6);
    }

    if (!paused && dead > 0) {
      amb.groanTimer -= step;
      if (amb.groanTimer <= 0) {
        if (groans.length < GROAN_CAP) {
          const g = rnd(0.15, 0.4) * Math.min(1, 0.4 + dead / 40);
          const v = play('groan', g, { x: listener.x + rnd(-16, 16), z: listener.z }, 'ambient');
          if (v) groans.push(v);
        }
        const rate = Math.min(2.5, 0.15 + dead * 0.04) * (night ? 1.2 : 1);
        amb.groanTimer = -Math.log(1 - Math.random()) / rate;
      }
    }
  }

  return {
    async unlock() {
      if (!ctx) {
        ctx = new Ctor();
        build();
      }
      if (ctx.state !== 'running') await ctx.resume();
    },
    setListener({ x, z, zoom, yaw } = {}) {
      if (Number.isFinite(yaw)) listener.yaw = yaw;
      if (Number.isFinite(x)) listener.x = x;
      if (Number.isFinite(z)) listener.z = z;
      if (Number.isFinite(zoom)) listener.zoom = zoom;
    },
    onEvents,
    // The music lab's event buttons (hordeContact, hordeArrived, fall, hordeDestroyed, breakout, victory, defeat):
    // each goes through onEvents exactly as the game's own event would.
    labEvent(type) {
      if (Object.hasOwn(LAB_EVENTS, type)) onEvents([LAB_EVENTS[type]]);
    },
    update,
    ui,
    uiPlayed: () => ({ ...uiPlayed }),
    // Sound-effect voices currently alive (the cap is VOICE_CAP for the world, +4 reserved for alerts).
    activeVoices: () => voices.length,
    contextState: () => ctx?.state ?? 'locked',
    // Music lab: switch the score's style while it plays. Song, section, mood, melody and lead apply at once (the
    // tempo turning toward a new mood's); band and groove at the next phrase line; swing and shape at the next step.
    setScoreStyle(partial = {}) {
      style = validStyle({ ...style, ...partial });
      score?.restyle(style);
      return { ...style };
    },
    scoreStyle: () => ({ ...style }),
    setLevelOverride(level) {
      levelOverride = Number.isInteger(level) && level >= -1 && level <= 3 ? level : null;
      score?.setLevelOverride(levelOverride);
    },
    // { song, section, mood, dire, tempo, tempoTo, band, groove, swing, kind, lead, over, shape, level, bar, chord,
    // hook, riff, hush, ending, auto }, or null before the score starts.
    scoreInfo: () => score?.info() ?? null,
    setVolume(channel, v) {
      if (!CHANNELS.includes(channel)) return;
      vol[channel] = clamp(+v || 0, 0, 1);
      if (!ctx) return;
      const target = volGain(channel);
      const now = ctx.currentTime;
      if (channel === 'master') master.gain.setTargetAtTime(target, now, 0.05);
      else {
        bus[channel].gain.setTargetAtTime(target, now, 0.05);
        send[channel].gain.setTargetAtTime(target, now, 0.05);
      }
    },
    getVolume: (channel) => vol[channel] ?? 0,
  };
}
