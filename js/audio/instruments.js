// The score's instruments and its mix. Each band of worlds.js (warm for Hopeful, synth for Uneasy, dark for Dire)
// has its own bus: a chain per part (drums, perc, bass, chords, pad, arp, lead, fx) with its own low-pass, level,
// place in the stereo field and reverb send, and a gain the engine crossfades. Each mood world has its own reverb,
// sized to its space; every band sends to all three and the mood opens its own, so the space follows the mood, not
// the band. All bands and reverbs meet in one limiter before the engine's music bus.
//
// Every recipe uses at most six nodes per note, and the sustained ones (pads, choir, drone, brass, the distorted
// lead) are low-passed at or below 2 kHz so that nothing shrill holds.

import { BANDS, WORLDS } from './worlds.js';
import { mtof } from './synth.js';

// Each part: its low-pass (the engine lowers it at night), level, reverb send and pan. `wide` parts spread over
// two panners; `duck` parts dip under the kick. Drums, bass, pad, arp and lead keep today's score chains; perc and
// chords borrow the drums' and the pad's; fx is new.
const ROLES = {
  drums: { f: 9000, level: 0.7, wet: 0.08, pan: 0 },
  perc: { f: 9000, level: 0.7, wet: 0.08, pan: 0.25 },
  bass: { f: 700, level: 0.6, wet: 0, pan: 0, duck: true },
  chords: { f: 1400, q: 0.5, level: 0.5, wet: 0.35, pan: -0.1 },
  pad: { f: 1400, q: 0.5, level: 0.5, wet: 0.35, wide: true, duck: true },
  arp: { f: 2200, level: 0.5, wet: 0.4, pan: -0.25 },
  lead: { f: 2600, level: 0.6, wet: 0.35, pan: 0 },
  fx: { f: 9000, level: 0.7, wet: 0.25, wide: true },
};
// The pads and bass under a kick: about −3.7 dB.
const DUCK = 0.65;
// How late the right side of a wide part runs, so the two sides differ and the part sounds wide.
const SPREAD = 0.012;
// The reverbs' colour: a bright room, a plainer one, a dark hall.
const REVERB_TONE = { hopeful: 6000, uneasy: 4000, dire: 2000 };

export function createMusicMix(ctx, musicBus, makeImpulse) {
  const amp = (v, to) => {
    const g = ctx.createGain();
    g.gain.value = v;
    if (to) g.connect(to);
    return g;
  };
  const panner = (p, to) => {
    const n = ctx.createStereoPanner();
    n.pan.value = p;
    n.connect(to);
    return n;
  };
  const lowpass = (f, q) => {
    const n = ctx.createBiquadFilter();
    n.type = 'lowpass';
    n.frequency.value = f;
    if (q) n.Q.value = q;
    return n;
  };

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 3;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.12;
  limiter.connect(musicBus);

  // One part: low-pass → level → pan → (duck) → band, the level also feeding the band's reverb send. Returns its
  // low-pass and its level.
  function part(r, to, send) {
    const flt = lowpass(r.f, r.q);
    // An equal-power panner leaves a mono part 3 dB down against the centre; make that up so the balance holds.
    const k = r.pan ? Math.SQRT2 : 1;
    const lvl = amp(r.level * k);
    flt.connect(lvl);
    if (r.wide) {
      const late = ctx.createDelay(0.05);
      late.delayTime.value = SPREAD;
      lvl.connect(panner(-0.5, to));
      lvl.connect(late);
      late.connect(panner(0.5, to));
    } else if (r.pan) lvl.connect(panner(r.pan, to));
    else lvl.connect(to);
    if (r.wet) lvl.connect(amp(r.wet / k, send));
    return { flt, lvl };
  }

  // One reverb per world behind its gate, closed until the mood opens it.
  const gates = {};
  for (const [mood, { reverb: { seconds, damp } }] of Object.entries(WORLDS)) {
    const gate = amp(0);
    const verb = ctx.createConvolver();
    verb.buffer = makeImpulse(seconds, damp);
    const colour = lowpass(REVERB_TONE[mood]);
    gate.connect(verb);
    verb.connect(colour);
    colour.connect(amp(0.6, limiter));
    gates[mood] = gate;
  }

  const bands = {};
  // Every part's level but the lead's, with its own setting: what the fall's dip lowers.
  const dips = [];
  for (const band of Object.keys(BANDS)) {
    // Silent until the engine brings the band in; its reverb send fades with it.
    const out = amp(0, limiter);
    const send = amp(0);
    for (const gate of Object.values(gates)) send.connect(gate);
    const duck = amp(1, out);
    const routes = {};
    for (const [role, r] of Object.entries(ROLES)) {
      const { flt, lvl } = part(r, r.duck ? duck : out, send);
      routes[role] = flt;
      if (role !== 'lead') dips.push({ g: lvl.gain, base: lvl.gain.value });
    }
    bands[band] = { out, send, duck, routes };
  }

  return {
    // A part's input: its low-pass, whose frequency the engine may lower.
    route: (band, role) => bands[band].routes[role],
    // Fade a band and its reverb send toward `gain` from `at`; `lag` is the glide's time constant in seconds.
    setBand(band, gain, at, lag) {
      for (const p of [bands[band].out.gain, bands[band].send.gain]) p.setTargetAtTime(gain, at, lag);
    },
    // Open the mood's reverb and close the others from `at` (time constant `lag`).
    setReverb(mood, at, lag) {
      for (const [m, gate] of Object.entries(gates)) gate.gain.setTargetAtTime(m === mood ? 1 : 0, at, lag);
    },
    // Under a lone voice (the fall's anthem quote): every band's parts but the lead, dry and wet, toward `gain` of
    // their level from `at` (time constant `lag`); dip(1, …) brings them back.
    dip(gain, at, lag) {
      for (const { g, base } of dips) g.setTargetAtTime(base * gain, at, lag);
    },
    // A kick's pulse: every band's pads and bass dip at `at` and are back within ~120 ms.
    duck(at) {
      for (const { duck } of Object.values(bands)) {
        duck.gain.setTargetAtTime(DUCK, at, 0.005);
        duck.gain.setTargetAtTime(1, at + 0.04, 0.025);
      }
    },
  };
}

// tanh saturation for the distorted lead, scaled so full scale stays full scale.
const TANH = (() => {
  const n = 1024, drive = 3, c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.tanh(drive * ((i / (n - 1)) * 2 - 1)) / Math.tanh(drive);
  return c;
})();

// Chord notes lean opposite ways in pitch, alternating by semitone (the stab plays one note at a time now).
const odd = (f) => Math.abs(Math.round(12 * Math.log2(f / 440))) % 2 === 1;

// The instruments, playing into `mix`. play(name, band, t, opts) starts one note on that band at time t and returns
// its end time (null for an unknown name). opts: { midi | f, vel (0–1, default 1), len (the note's length in
// seconds), hold (seconds a sustained sound holds before its release), role (the band part to play into when not
// the instrument's own, e.g. the piano as the arp or the choir as the melody), bite (the arp's combat square) }.
export function createInstruments(synth, mix) {
  const { ctx, tone, noise, env, whiteBuf } = synth;

  const filter = (type, f, q = 0.7) => {
    const n = ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = f;
    n.Q.value = q;
    return n;
  };

  // Oscillators [type, f, detune] through one chain of nodes into one envelope: cheaper than a tone() for each.
  // o: { a, hold, d, peak, vib: [rate, depth in Hz] }
  function stack(dest, t, voices, chain, o) {
    const hold = o.hold ?? 0, end = t + o.a + hold + o.d;
    const g = ctx.createGain();
    env(g.gain, t, o.a, o.peak, o.d, hold);
    const line = [...chain, g];
    for (let i = 1; i < line.length; i++) line[i - 1].connect(line[i]);
    g.connect(dest);
    const srcs = voices.map(([type, f, detune = 0]) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f;
      osc.detune.value = detune;
      osc.connect(line[0]);
      return osc;
    });
    if (o.vib) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = o.vib[0];
      const depth = ctx.createGain();
      depth.gain.value = o.vib[1];
      lfo.connect(depth);
      for (const s of srcs) depth.connect(s.frequency);
      srcs.push(lfo);
      line.push(depth);
    }
    for (const s of srcs) {
      s.start(t);
      s.stop(end + 0.02);
    }
    srcs[0].onended = () => { for (const n of [...srcs, ...line]) n.disconnect(); };
    return end;
  }

  // Noise through a chain of filters into one gain whose envelope `shape(param)` draws, until `end`.
  function burst(dest, t, chain, end, shape) {
    const src = ctx.createBufferSource();
    src.buffer = whiteBuf;
    src.loop = true;
    const g = ctx.createGain();
    shape(g.gain);
    const line = [src, ...chain, g];
    for (let i = 1; i < line.length; i++) line[i - 1].connect(line[i]);
    g.connect(dest);
    src.start(t, Math.random() * 2);
    src.stop(end + 0.02);
    src.onended = () => { for (const n of line) n.disconnect(); };
    return end;
  }

  // Three hand claps 11 ms apart in one band-passed burst, the last ringing out into the room.
  function clap(dest, t, peak) {
    const p = Math.max(peak, 0.0002), end = t + 0.022 + 0.15;
    return burst(dest, t, [filter('bandpass', 1200, 1.1)], end, (g) => {
      g.setValueAtTime(0.0001, t);
      for (const dt of [0, 0.011]) {
        g.exponentialRampToValueAtTime(p, t + dt + 0.001);
        g.exponentialRampToValueAtTime(p * 0.15, t + dt + 0.009);
      }
      g.exponentialRampToValueAtTime(p, t + 0.022);
      g.exponentialRampToValueAtTime(0.0001, end);
    });
  }

  // A struck string: a triangle body and its second partial, which dies sooner, with a tiny hammer click. Longer
  // notes ring longer, as if the key were held. `low` is the dark band's piano: an octave down, longer, darker. The
  // partial is kept soft: a sixteenth-note arpeggio re-strikes it often enough to hold near 1 kHz (the shrill rule).
  function piano(dest, t, f, o, low) {
    const ring = Math.min(low ? 4 : 3, (0.35 + (o.len ?? 0.5) * 1.2) * (low ? 1.4 : 1)), v = o.vel;
    return Math.max(
      tone(dest, t, { type: 'triangle', f, a: 0.002, d: ring, peak: 0.08 * v }),
      tone(dest, t, { f: f * 2, a: 0.002, d: ring * 0.4, peak: (low ? 0.02 : 0.022) * v }),
      tone(dest, t, { f: Math.min(low ? 1200 : 2600, f * 6), a: 0.001, d: 0.015, peak: (low ? 0.008 : 0.014) * v }),
    );
  }

  // The choir's mouth: formant band-passes for an 'ooh' (~350 Hz, and a narrow ~750 Hz) under an 800 Hz low-pass, so
  // the saws' upper harmonics never hold near 1 kHz. One per band part, built on its first choir note and shared by
  // every note after.
  const mouths = new Map();
  function mouth(dest) {
    if (!mouths.has(dest)) {
      const input = ctx.createGain();
      const lp = filter('lowpass', 800);
      for (const [f, q] of [[350, 2], [750, 6]]) {
        const bp = filter('bandpass', f, q);
        input.connect(bp);
        bp.connect(lp);
      }
      lp.connect(dest);
      mouths.set(dest, input);
    }
    return mouths.get(dest);
  }

  // name: [the part it plays into, (dest, t, o) => end time]
  const R = {
    // ---- drums and percussion: today's kit, then the warm and dark bands' own ----
    kick: ['drums', (d, t, o) => Math.max(
      tone(d, t, { f: 120, f2: 42, a: 0.002, d: 0.3, peak: 0.6 * o.vel }),
      noise(d, t, { type: 'highpass', f: 2500, a: 0.001, d: 0.012, peak: 0.06 * o.vel }))],
    snare: ['drums', (d, t, o) => Math.max(
      noise(d, t, { type: 'bandpass', f: 1900, q: 0.7, a: 0.001, d: 0.17, peak: 0.3 * o.vel }),
      tone(d, t, { f: 220, f2: 150, a: 0.001, d: 0.08, peak: 0.2 * o.vel }))],
    hat: ['perc', (d, t, o) => noise(d, t, { type: 'highpass', f: 7500, q: 0.7, a: 0.001, d: 0.035, peak: 0.08 * o.vel })],
    ohat: ['perc', (d, t, o) => noise(d, t, { type: 'highpass', f: 6500, q: 0.7, a: 0.002, d: 0.2, peak: 0.06 * o.vel })],
    tom: ['drums', (d, t, o) => tone(d, t, { f: o.f ?? 190, f2: 90, a: 0.002, d: 0.22, peak: 0.4 * o.vel })],
    // The build's sweep into the next phrase: noise rising in pitch and level over `len` seconds.
    riser: ['fx', (d, t, o) => {
      const len = o.len ?? 2;
      return noise(d, t, { type: 'bandpass', f: 300, f2: 5000, q: 1.2, a: len * 0.95, d: 0.15, peak: 0.06 * o.vel });
    }],
    // The heavy groove's snare on beat 3: lower, longer and heavier, left to ring in the hall.
    bigSnare: ['drums', (d, t, o) => Math.max(
      noise(d, t, { type: 'bandpass', f: 1300, q: 0.6, a: 0.002, d: 0.38, peak: 0.36 * o.vel }),
      tone(d, t, { f: 180, f2: 100, a: 0.001, d: 0.16, peak: 0.32 * o.vel }))],
    clap: ['drums', (d, t, o) => clap(d, t, 0.3 * o.vel)],
    // Beads: bright noise with a soft edge.
    shaker: ['perc', (d, t, o) => noise(d, t, { type: 'bandpass', f: 6500, q: 0.9, a: 0.012, d: 0.05, peak: 0.07 * o.vel })],
    // Jingles ringing over a short slap.
    tamb: ['perc', (d, t, o) => Math.max(
      noise(d, t, { type: 'bandpass', f: 8200, q: 4, a: 0.002, d: 0.16, peak: 0.06 * o.vel }),
      noise(d, t, { type: 'highpass', f: 5000, a: 0.001, d: 0.03, peak: 0.05 * o.vel }))],
    // War drum: a deep body that drops into its pitch, and the slap of the skin.
    taiko: ['drums', (d, t, o) => {
      const f = o.f ?? 62;
      return Math.max(
        tone(d, t, { path: [[0, f * 1.6], [0.05, f], [0.7, f * 0.9]], a: 0.004, d: 0.7, peak: 0.75 * o.vel }),
        noise(d, t, { type: 'bandpass', f: 1100, q: 0.8, a: 0.001, d: 0.05, peak: 0.2 * o.vel }));
    }],
    // Struck metal: two squares at an inharmonic ratio, band-passed, gone within a quarter second.
    clang: ['perc', (d, t, o) => {
      const f = o.f ?? 420;
      return Math.max(
        tone(d, t, { type: 'square', f, a: 0.001, d: 0.26, peak: 0.05 * o.vel, flt: ['bandpass', 2200, 1.8] }),
        tone(d, t, { type: 'square', f: f * 1.4837, a: 0.001, d: 0.16, peak: 0.04 * o.vel, flt: ['bandpass', 3100, 2] }));
    }],
    // Cymbal: high noise under an 8 kHz low-pass, quiet, gone within 1.6 s.
    crash: ['fx', (d, t, o) => burst(d, t, [filter('highpass', 3000), filter('lowpass', 8000)], t + 1.503,
      (g) => env(g, t, 0.003, 0.05 * o.vel, 1.5))],

    // ---- chords, pads, arps and bass ----
    piano: ['chords', (d, t, o) => piano(d, t, o.f, o, false)],
    lowPiano: ['arp', (d, t, o) => piano(d, t, o.f / 2, o, true)],
    // Music box: bright bell partials that fade fast, the highest first.
    celesta: ['lead', (d, t, o) => {
      const ring = Math.min(1.8, 0.5 + (o.len ?? 0.5));
      return Math.max(...[[1, 1, 1], [2, 0.3, 0.45], [3.93, 0.12, 0.2]]
        .map(([m, p, k]) => tone(d, t, { f: o.f * m, a: 0.001, d: ring * k, peak: 0.05 * p * o.vel })));
    }],
    // Today's arp: a triangle pluck (`len` its decay); `bite` adds the short square it gets in combat.
    pluck: ['arp', (d, t, o) => Math.max(
      tone(d, t, { type: 'triangle', f: o.f, a: 0.003, d: o.len ?? 0.28, peak: 0.055 * o.vel }),
      o.bite ? tone(d, t, { type: 'square', f: o.f, a: 0.003, d: 0.12, peak: 0.012 * o.vel }) : t)],
    // Today's chord stab, one note of it: a triangle swell and a quiet detuned saw, held for the chord's `len`.
    stab: ['chords', (d, t, o) => {
      const len = o.len ?? 4;
      return Math.max(
        tone(d, t, { type: 'triangle', f: o.f, a: 0.03, hold: len * 0.55, d: len * 0.5, peak: 0.03 * o.vel }),
        tone(d, t, { type: 'sawtooth', f: o.f, detune: odd(o.f) ? 6 : -6, a: 0.03, hold: len * 0.4, d: len * 0.4, peak: 0.008 * o.vel }));
    }],
    // Soft detuned triangles over a sine an octave down, swelling in slowly under a 1.6 kHz low-pass.
    warmPad: ['pad', (d, t, o) => {
      const len = o.len ?? 4;
      return stack(d, t, [['triangle', o.f, -7], ['triangle', o.f, 7], ['sine', o.f / 2]], [filter('lowpass', 1600)],
        { a: Math.min(0.8, len * 0.3), hold: o.hold ?? len * 0.55, d: len * 0.5, peak: 0.022 * o.vel });
    }],
    // 'Ooh': three detuned saws with a slow vibrato, sung through the formant mouth.
    choir: ['pad', (d, t, o) => {
      const len = o.len ?? 4;
      return stack(mouth(d), t, [['sawtooth', o.f, -9], ['sawtooth', o.f], ['sawtooth', o.f, 9]], [],
        { a: Math.min(0.6, len * 0.3), hold: o.hold ?? len * 0.55, d: len * 0.5, peak: 0.06 * o.vel, vib: [5, o.f * 0.006] });
    }],
    // Low brass swell: root, the octave below and the fifth on saws, the low-pass opening from 200 Hz to 1.6 kHz
    // and closing to 400 Hz over 2.5 s. A near-centre hit, not a wide pad.
    braam: ['chords', (d, t, o) => {
      const lp = filter('lowpass', 200, 3);
      lp.frequency.setValueAtTime(200, t);
      lp.frequency.exponentialRampToValueAtTime(1600, t + 0.9);
      lp.frequency.exponentialRampToValueAtTime(400, t + 2.5);
      return stack(d, t, [['sawtooth', o.f], ['sawtooth', o.f / 2], ['sawtooth', o.f * 1.5, 3]], [lp],
        { a: 0.35, hold: 0.45, d: 1.9, peak: 0.07 * o.vel });
    }],
    // Low sine weight, with a quiet triangle an octave up so small speakers hear it, both under low low-passes.
    // `release`: seconds it takes to fade after its hold.
    subDrone: ['bass', (d, t, o) => {
      const len = o.len ?? 8, a = Math.min(1.5, len * 0.25), hold = o.hold ?? len * 0.45, dd = o.release ?? len * 0.45;
      return Math.max(
        tone(d, t, { f: o.f, a, hold, d: dd, peak: 0.16 * o.vel, flt: ['lowpass', 300] }),
        tone(d, t, { type: 'triangle', f: o.f * 2, a, hold, d: dd, peak: 0.03 * o.vel, flt: ['lowpass', 500] }));
    }],
    // Today's bass (`len` is a step): a saw and a sine an octave below.
    sawBass: ['bass', (d, t, o) => {
      const len = o.len ?? 0.144;
      return Math.max(
        tone(d, t, { type: 'sawtooth', f: o.f, a: 0.004, d: len * 1.8, peak: 0.2 * o.vel }),
        tone(d, t, { type: 'sine', f: o.f / 2, a: 0.004, d: len * 2, peak: 0.22 * o.vel }));
    }],
    // A plucked string bass: a quick saw pick on a round triangle and sine body.
    pluckBass: ['bass', (d, t, o) => {
      const len = o.len ?? 0.134;
      return Math.max(
        tone(d, t, { type: 'sawtooth', f: o.f, a: 0.001, d: 0.05, peak: 0.08 * o.vel }),
        tone(d, t, { type: 'triangle', f: o.f, a: 0.002, d: len * 2.6, peak: 0.26 * o.vel }),
        tone(d, t, { f: o.f, a: 0.002, d: len * 3, peak: 0.16 * o.vel }));
    }],
    // Dark sub bass: a sine that drops into its pitch (a soft thump), with a little triangle for small speakers.
    subBass: ['bass', (d, t, o) => {
      const len = o.len ?? 0.16;
      return Math.max(
        tone(d, t, { path: [[0, o.f * 1.5], [0.03, o.f]], a: 0.003, d: len * 3, peak: 0.34 * o.vel }),
        tone(d, t, { type: 'triangle', f: o.f, a: 0.003, d: len * 2, peak: 0.06 * o.vel }));
    }],

    // ---- melody sounds (also celesta, piano and choir above); today's leads ring for 90% of `len` ----
    // Soft lead: saw and triangle, a touch of vibrato on notes of four steps or more (≥ 0.5 s at every tempo).
    soft: ['lead', (d, t, o) => {
      const len = o.len ?? 0.5, n = len * 0.9;
      return Math.max(
        tone(d, t, { type: 'sawtooth', f: o.f, a: 0.015, hold: n * 0.4, d: n * 0.8, peak: 0.03 * o.vel, vib: len >= 0.5 ? [[5.5, 4]] : undefined }),
        tone(d, t, { type: 'triangle', f: o.f, a: 0.01, hold: n * 0.4, d: n * 0.8, peak: 0.035 * o.vel }));
    }],
    // Glassy bell: struck partials that ring on a little past the note. Today's minus its two highest partials
    // (5.4× and 8.9×, mostly cut by the lead's low-pass anyway), to fit six nodes; the upper two softer than today's,
    // so a held melody does not ring on above 1 kHz (the shrill rule).
    bell: ['lead', (d, t, o) => {
      const ring = Math.min(2.2, (o.len ?? 0.5) * 0.9 * 1.6 + 0.3);
      return Math.max(...[[1, 1], [2, 0.4], [2.76, 0.25]]
        .map(([m, p], i) => tone(d, t, { f: o.f * m, a: 0.002, d: ring / (1 + i * 0.6), peak: 0.05 * o.vel * p })));
    }],
    // Thick synth: two detuned saws through one resonant low-pass (the same sound as a filter each), and a square
    // an octave below.
    synth: ['lead', (d, t, o) => {
      const n = (o.len ?? 0.5) * 0.9;
      return Math.max(
        stack(d, t, [['sawtooth', o.f, -11], ['sawtooth', o.f, 11]], [filter('lowpass', 3400, 2.5)], { a: 0.008, hold: n * 0.5, d: n * 0.6, peak: 0.024 * o.vel }),
        tone(d, t, { type: 'square', f: o.f / 2, a: 0.008, hold: n * 0.5, d: n * 0.5, peak: 0.012 * o.vel }));
    }],
    // Distorted lead: two saws driven through tanh, then low-passed at 1.2 kHz so its grit stays below the shrill band.
    dist: ['lead', (d, t, o) => {
      const n = (o.len ?? 0.5) * 0.9;
      const shaper = ctx.createWaveShaper();
      shaper.curve = TANH;
      shaper.oversample = '2x';
      return stack(d, t, [['sawtooth', o.f, -8], ['sawtooth', o.f, 8]], [shaper, filter('lowpass', 1200)],
        { a: 0.01, hold: n * 0.5, d: n * 0.6, peak: 0.03 * o.vel });
    }],
    // Today's answering voice in call and answer: a mellow triangle with a sine an octave below.
    answer: ['lead', (d, t, o) => {
      const n = (o.len ?? 0.5) * 0.9;
      return Math.max(
        tone(d, t, { type: 'triangle', f: o.f, a: 0.02, hold: n * 0.45, d: n * 0.8, peak: 0.045 * o.vel }),
        tone(d, t, { type: 'sine', f: o.f / 2, a: 0.02, hold: n * 0.4, d: n * 0.7, peak: 0.02 * o.vel }));
    }],
  };

  return {
    play(name, band, t, opts = {}) {
      const r = R[name];
      if (!r) return null;
      const f = opts.f ?? (opts.midi === undefined ? undefined : mtof(opts.midi));
      return r[1](mix.route(band, opts.role ?? r[0]), t, { ...opts, f, vel: opts.vel ?? 1 });
    },
  };
}
