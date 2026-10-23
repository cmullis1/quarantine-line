// The synthesis primitives, bound to one AudioContext: a white-noise buffer and reverb impulses, envelopes and
// sweeps, and the two voices everything is built from (filtered noise and an oscillator), each returning its
// absolute end time. Shared by the effects in audio.js and the score's instruments (instruments.js).

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function createSynth(ctx) {
  function makeNoise(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function makeImpulse(seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  const whiteBuf = makeNoise(3);

  function env(param, t, a, peak, d, hold = 0) {
    const p = Math.max(peak, 0.0002);
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(p, t + a);
    if (hold > 0) param.setValueAtTime(p, t + a + hold);
    param.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
  }

  function sweep(param, t, f, f2, span, path) {
    if (path) {
      param.setValueAtTime(path[0][1], t);
      for (let i = 1; i < path.length; i++) param.exponentialRampToValueAtTime(path[i][1], t + path[i][0]);
    } else {
      param.setValueAtTime(f, t);
      if (f2) param.exponentialRampToValueAtTime(f2, t + span);
    }
  }

  // o: { type, f, f2, path, q, a, d, hold, peak }
  function noise(dest, t, o) {
    const a = o.a ?? 0.002, hold = o.hold ?? 0, d = o.d ?? 0.1;
    const end = t + a + hold + d;
    const src = ctx.createBufferSource();
    src.buffer = whiteBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    sweep(f.frequency, t, o.f, o.f2, a + hold + d, o.path);
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    env(g.gain, t, a, o.peak ?? 1, d, hold);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t, Math.random() * 2);
    src.stop(end + 0.02);
    src.onended = () => { src.disconnect(); g.disconnect(); };
    return end;
  }

  // o: { type, f, f2, path, a, d, hold, peak, detune, flt: [type, freq, q], vib: [[rate, depth], ...] }
  function tone(dest, t, o) {
    const a = o.a ?? 0.005, hold = o.hold ?? 0, d = o.d ?? 0.2;
    const end = t + a + hold + d;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    sweep(osc.frequency, t, o.f, o.f2, a + hold + d, o.path);
    if (o.detune) osc.detune.value = o.detune;
    let node = osc;
    if (o.flt) {
      const f = ctx.createBiquadFilter();
      f.type = o.flt[0];
      f.frequency.value = o.flt[1];
      f.Q.value = o.flt[2] ?? 0.7;
      node.connect(f);
      node = f;
    }
    const lfos = [];
    for (const [rate, depth] of o.vib || []) {
      const l = ctx.createOscillator();
      l.frequency.value = rate;
      const lg = ctx.createGain();
      lg.gain.value = depth;
      l.connect(lg);
      lg.connect(osc.frequency);
      l.start(t);
      l.stop(end + 0.02);
      l.onended = () => l.disconnect();
      lfos.push(lg);
    }
    const g = ctx.createGain();
    env(g.gain, t, a, o.peak ?? 1, d, hold);
    node.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(end + 0.02);
    osc.onended = () => { osc.disconnect(); g.disconnect(); for (const lg of lfos) lg.disconnect(); };
    return end;
  }

  return { ctx, tone, noise, env, sweep, whiteBuf, makeImpulse };
}
