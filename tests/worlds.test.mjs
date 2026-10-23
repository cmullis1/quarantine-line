import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLDS, GROOVES, BANDS, hitsFor, swingDelay, sharedChords, chordsOf } from '../js/audio/worlds.js';
import { CHORDS } from '../js/audio/harmony.js';
import { STEPS, PHRASE_BARS } from '../js/audio/score.js';
import { DEFAULT_STYLE, STYLE_OPTIONS, validStyle } from '../js/audio/style.js';

const GROOVE_NAMES = ['bounce', 'standard', 'heavy'];
const bar = (groove, level, phraseBar = 0, opts = {}) =>
  Array.from({ length: STEPS }, (_, s) => hitsFor(groove, level, s, phraseBar, opts));
const stepsWith = (hits, inst) => hits.flatMap((h, s) => (h.some((x) => x.inst === inst) ? [s] : []));
const DRUMS = (h) => h.inst !== 'bass';

test('the three grooves exist and every world names a groove and a band that exist', () => {
  assert.deepEqual(Object.keys(GROOVES).sort(), [...GROOVE_NAMES].sort());
  for (const w of Object.values(WORLDS)) { assert.ok(GROOVES[w.groove], w.groove); assert.ok(BANDS[w.band], w.band); }
});

test('every beat is marked in every groove at every level', () => {
  for (const g of GROOVE_NAMES) for (const level of [0, 1, 2, 3]) for (const opts of [{}, { alt: true }, { night: true }]) {
    const hits = bar(g, level, 0, opts);
    for (const s of [0, 4, 8, 12]) {
      assert.ok(hits[s].some((h) => ['kick', 'snare', 'clap', 'taiko', 'bass'].includes(h.inst)), `${g} level ${level} step ${s} ${JSON.stringify(opts)}`);
    }
  }
});

test('accents only on the beat', () => {
  for (const g of GROOVE_NAMES) for (const level of [0, 1, 2, 3]) {
    bar(g, level).forEach((hits, s) => {
      for (const h of hits) if (h.vel >= 1 && ['hat', 'shaker'].includes(h.inst)) assert.equal(s % 4, 0, `${g} level ${level} ${h.inst} accent on step ${s}`);
    });
  }
});

test('bounce claps on 2 and 4 from tension up; heavy puts the snare on beat 3', () => {
  for (const level of [1, 2]) {
    assert.deepEqual(stepsWith(bar('bounce', level), 'clap'), [4, 12]);
    assert.deepEqual(stepsWith(bar('heavy', level), 'snare'), [8]);
  }
});

test('energy rises with the level in every groove', () => {
  for (const g of GROOVE_NAMES) {
    const count = (level) => bar(g, level).flat().filter(DRUMS).length;
    for (let l = 1; l <= 3; l++) assert.ok(count(l) >= count(l - 1), `${g} level ${l}: ${count(l)} < ${count(l - 1)}`);
  }
});

test('paused is silent: the drums and bass drop out', () => {
  for (const g of GROOVE_NAMES) assert.deepEqual(bar(g, -1).flat(), []);
});

test('hitsFor returns drums and bass only; the standard groove is today\'s kit', () => {
  const insts = new Set(GROOVE_NAMES.flatMap((g) => [0, 1, 2, 3].flatMap((l) => bar(g, l).flat().map((h) => h.inst))));
  assert.ok(!insts.has('arp'));
  assert.deepEqual(stepsWith(bar('standard', 0), 'kick'), [0, 8]);
  assert.deepEqual(stepsWith(bar('standard', 1), 'snare'), [4, 12]);
  assert.deepEqual(bar('standard', 0)[4].find((h) => h.inst === 'bass'), { inst: 'bass', deg: 0, vel: 0.6 });
});

test('night thins the plain hats and shakers below level 2', () => {
  for (const [g, inst] of [['bounce', 'shaker'], ['standard', 'hat']]) {
    assert.equal(stepsWith(bar(g, 0, 0, { night: true }), inst).length, 0);
    assert.deepEqual(stepsWith(bar(g, 1, 0, { night: true }), inst), [0, 4, 8, 12], `${g} keeps its accents`);
    assert.deepEqual(stepsWith(bar(g, 2, 0, { night: true }), inst), stepsWith(bar(g, 2), inst));
  }
});

test('swing delays only odd steps of the bounce groove by a tenth of a step', () => {
  assert.ok(Math.abs(swingDelay('bounce', 1, 0.134) - 0.0134) < 1e-12);
  assert.ok(Math.abs(swingDelay('bounce', 15, 0.134) - 0.0134) < 1e-12);
  assert.equal(swingDelay('bounce', 2, 0.134), 0);
  assert.equal(swingDelay('standard', 1, 0.134), 0);
  assert.equal(swingDelay('heavy', 1, 0.134), 0);
});

test('worlds are far apart: major key and 112 bpm, minor 104, dark minor 94', () => {
  assert.equal(WORLDS.hopeful.key, 'C'); assert.equal(WORLDS.hopeful.tempo, 112);
  assert.equal(WORLDS.uneasy.key, 'Am'); assert.equal(WORLDS.uneasy.tempo, 104);
  assert.equal(WORLDS.dire.key, 'Am'); assert.equal(WORLDS.dire.tempo, 94);
  assert.ok(chordsOf('dire').includes('Bb'));
  for (const c of ['C', 'G', 'F']) assert.ok(chordsOf('hopeful').includes(c), c);
  assert.ok(!chordsOf('hopeful').includes('Bb'));
  for (const m of Object.keys(WORLDS)) for (const c of chordsOf(m)) assert.ok(CHORDS[c], `${m} ${c}`);
  assert.deepEqual([...WORLDS.hopeful.scale].sort((a, b) => a - b), [0, 2, 4, 5, 7, 9, 11]);
  assert.deepEqual([...WORLDS.uneasy.scale].sort((a, b) => a - b), [0, 2, 4, 5, 7, 9, 11]);
  assert.deepEqual([...WORLDS.dire.scale].sort((a, b) => a - b), [0, 2, 4, 5, 8, 9, 10]);
  assert.deepEqual(WORLDS.hopeful.reverb, { seconds: 1.2, damp: 2.5 });
  assert.deepEqual(WORLDS.uneasy.reverb, { seconds: 1.8, damp: 3 });
  assert.deepEqual(WORLDS.dire.reverb, { seconds: 3.5, damp: 4.5 });
});

test('moods share pivot chords', () => {
  const ha = sharedChords('hopeful', 'uneasy'), ud = sharedChords('uneasy', 'dire');
  for (const c of ['Am', 'C', 'F', 'G', 'Dm']) assert.ok(ha.includes(c), c);
  for (const c of ['Am', 'Dm', 'F']) assert.ok(ud.includes(c), c);
  assert.ok(!ud.includes('Bb') && !ud.includes('C'));
});

test('the bands: warm piano, synth stabs, dark choir with a drone and braams', () => {
  assert.deepEqual(BANDS.warm, { chords: 'piano', pad: 'warmPad', arp: 'piano', bass: 'pluckBass', drone: null, braam: false, leads: ['bell', 'celesta', 'piano'] });
  assert.deepEqual(BANDS.synth, { chords: 'stab', pad: null, arp: 'pluck', bass: 'sawBass', drone: null, braam: false, leads: ['soft', 'bell', 'synth'] });
  assert.deepEqual(BANDS.dark, { chords: 'choir', pad: null, arp: 'lowPiano', bass: 'subBass', drone: 'subDrone', braam: true, leads: ['dist', 'choir', 'lowPiano'] });
});

test('the alternate bar and fills are written, not random', () => {
  for (const g of GROOVE_NAMES) for (const l of [0, 1, 2, 3]) for (let s = 0; s < STEPS; s++) {
    assert.deepEqual(hitsFor(g, l, s, 3, { alt: true }), hitsFor(g, l, s, 3, { alt: true }));
  }
  assert.ok(stepsWith(bar('bounce', 1, 3, { alt: true }), 'kick').includes(14));
  assert.deepEqual(stepsWith(bar('standard', 1, 3, { alt: true }), 'kick'), [0, 8, 11]);
  assert.ok(stepsWith(bar('heavy', 1, 3, { alt: true }), 'taiko').includes(6));
  const last = PHRASE_BARS - 1;
  for (const [g, inst] of [['standard', 'tom'], ['heavy', 'tom'], ['bounce', 'clap']]) for (const l of [1, 2, 3]) {
    const plain = bar(g, l, last), filled = bar(g, l, last, { fill: true });
    for (let s = 0; s < 12; s++) assert.deepEqual(filled[s], plain[s], `${g} step ${s} untouched`);
    for (let s = 12; s < 16; s++) assert.equal(filled[s].filter((h) => h.inst === inst).length, 1, `${g} level ${l} ${inst} on step ${s}`);
    assert.deepEqual(bar(g, l, 3, { fill: true }), bar(g, l, 3), `${g}: a fill only closes the phrase`);
  }
  assert.equal(stepsWith(bar('standard', 2, last), 'tom').length, 0, 'no fill unless asked');
});

test('style switches: every switch has its options; unknown values fall back to the default', () => {
  assert.deepEqual(DEFAULT_STYLE, { song: 'auto', section: 'auto', mood: 'auto', band: 'auto', groove: 'auto', swing: 'auto', melody: 'auto', lead: 'auto', shape: 'on' });
  for (const k of Object.keys(DEFAULT_STYLE)) assert.ok(STYLE_OPTIONS[k].some(([v]) => v === DEFAULT_STYLE[k]), k);
  for (const k of ['band', 'groove']) for (const [v] of STYLE_OPTIONS[k].slice(1)) assert.ok((k === 'band' ? BANDS : GROOVES)[v], `${k} ${v}`);
  assert.deepEqual(validStyle({ mood: 'dire', groove: 'nonsense' }), { ...DEFAULT_STYLE, mood: 'dire' });
  assert.deepEqual(validStyle(null), DEFAULT_STYLE);
});
