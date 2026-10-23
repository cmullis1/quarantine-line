import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHORDS, HOOKS, RIFFS, HOOK_FORM, MELODY_TOP, chordTone, foldDown, realise, melodySection } from '../js/audio/harmony.js';

// The worlds' scales as pitch classes: C major / A natural minor (one set), and A minor with B-flat and G-sharp.
const NATURAL = [0, 2, 4, 5, 7, 9, 11];
const DARK = [9, 10, 0, 2, 4, 5, 8];
const OPTIONS = [{ scale: NATURAL }, { scale: DARK, shift: 0 }];
const everyChord = Object.keys(CHORDS);
const pcsOf = (chord) => new Set(CHORDS[chord].slice(1).map((m) => m % 12));

test('chords are absolute: bass root, then three upper voices', () => {
  assert.deepEqual(CHORDS, {
    Am: [45, 57, 60, 64], Dm: [38, 57, 62, 65], Em: [40, 55, 59, 64], F: [41, 57, 60, 65], C: [48, 55, 60, 64],
    G: [43, 55, 59, 62], Bb: [46, 58, 62, 65], Bdim: [47, 59, 62, 65], E: [40, 56, 59, 64],
  });
});

test('chord tones: 1-3 the upper voices, 4-6 an octave up, shifted an octave by default', () => {
  assert.deepEqual([1, 2, 3, 4].map((k) => chordTone('Am', k)), [69, 72, 76, 81]);
  assert.deepEqual([1, 2, 3, 4].map((k) => chordTone('Am', k, 0)), [57, 60, 64, 69]);
});

test('realise walks the given scale on +n/-n and folds out-of-range notes by octaves', () => {
  assert.deepEqual(realise([[0, 1, 4], [4, '+1', 4]], 'Am', NATURAL), [[0, 69, 4], [4, 71, 4]]);
  assert.deepEqual(realise([[0, 1, 4], [4, '+1', 4]], 'Am', DARK), [[0, 69, 4], [4, 70, 4]]);
  assert.deepEqual(realise([[0, 1, 4], [4, '-1', 4]], 'E', DARK, 0), [[0, 56, 4], [4, 53, 4]]);
  assert.deepEqual(realise([[0, 6, 4]], 'Bb', NATURAL), [[0, 65 + 12, 4]], '89 folds down to 77');
});

test('the melody never climbs above A5: anything higher folds down by octaves', () => {
  assert.equal(MELODY_TOP, 81);
  assert.deepEqual([81, 82, 88, 94, 60].map((m) => foldDown(m)), [81, 70, 76, 70, 60]);
  assert.deepEqual(realise([[0, 5, 4], [4, 4, 4]], 'C', NATURAL), [[0, 72, 4], [4, 79, 4]], '84 folds to 72; 79 stays');
  assert.deepEqual(realise([[0, 4, 4], [4, '+1', 4]], 'Am', NATURAL), [[0, 81, 4], [4, 71, 4]], 'a step past A5 folds an octave down');
});

test('eight hooks and four riffs', () => {
  assert.equal(HOOKS.length, 8);
  assert.equal(RIFFS.length, 4);
});

test('hooks land on the chord: every bar downbeat and beat 3 is a chord tone', () => {
  for (const opts of OPTIONS) for (let h = 0; h < HOOKS.length; h++) for (const chord of everyChord) for (const pb of [0, 2, 4, 6]) {
    const notes = melodySection('hooks', { hook: h, riff: 0 }, pb, chord, 1, opts);
    for (const n of notes) {
      assert.ok(n.midi >= 52 && n.midi <= 81, `range ${n.midi}`);
      if (n.s % 8 === 0) assert.ok(pcsOf(chord).has(n.midi % 12), `hook ${h + 1} ${chord} bar ${pb} step ${n.s}`);
    }
    notes.forEach((n, i) => { assert.ok(n.s >= 0 && n.s < 32 && n.len > 0); if (i) assert.ok(n.s > notes[i - 1].s); });
  }
});

test('a hook phrase is statement, repeat, twist, resolution', () => {
  assert.deepEqual(HOOK_FORM, ['A', 'A', 'B', 'R']);
  const opts = { scale: NATURAL };
  for (let h = 0; h < HOOKS.length; h++) {
    const sec = (pb) => melodySection('hooks', { hook: h, riff: 0 }, pb, 'Am', 1, opts);
    assert.deepEqual(sec(0), sec(2), 'the repeat is the statement again');
    assert.notDeepEqual(sec(4).map((n) => n.midi), sec(0).map((n) => n.midi), 'the twist changes the line');
    const end = sec(6).at(-1);
    assert.equal(end.midi, chordTone('Am', 1), 'the resolution comes home');
    assert.equal(end.s + end.len, 32, 'and holds to the end of the phrase');
  }
});

test('the riff drives: quarters when calm, eighths with tension, sixteenths in combat, on chord tones', () => {
  const opts = { scale: NATURAL };
  for (let r = 0; r < RIFFS.length; r++) {
    const count = (level) => melodySection('riff', { hook: 0, riff: r }, 0, 'Am', level, opts).length;
    assert.deepEqual([count(0), count(1), count(2)], [8, 16, 32]);
    for (const n of melodySection('riff', { hook: 0, riff: r }, 0, 'Am', 1, opts)) assert.ok(pcsOf('Am').has(n.midi % 12), `riff ${r + 1} step ${n.s}`);
  }
});

test('call and answer: the call in bar one, a lower answer in bar two ending on a chord tone', () => {
  for (const opts of OPTIONS) for (let h = 0; h < HOOKS.length; h++) for (const chord of everyChord) {
    const notes = melodySection('call', { hook: h, riff: 0 }, 0, chord, 1, opts);
    const call = notes.filter((n) => n.voice === 'lead'), ans = notes.filter((n) => n.voice === 'answer');
    assert.ok(call.length && ans.length);
    assert.ok(call.every((n) => n.s < 16) && ans.every((n) => n.s >= 16));
    const avg = (xs) => xs.reduce((a, n) => a + n.midi, 0) / xs.length;
    assert.ok(avg(ans) < avg(call), 'the answer is lower');
    assert.ok(pcsOf(chord).has(ans.at(-1).midi % 12), `hook ${h + 1} answer over ${chord} ends on a chord tone`);
  }
});

test('the melody shift moves the whole line by octaves; other kinds are not composed here', () => {
  const hi = melodySection('hooks', { hook: 0, riff: 0 }, 0, 'Am', 1, { scale: NATURAL });
  const lo = melodySection('hooks', { hook: 0, riff: 0 }, 0, 'Am', 1, { scale: NATURAL, shift: 0 });
  assert.deepEqual(hi.map((n) => n.midi - 12), lo.map((n) => n.midi));
  assert.deepEqual(melodySection('anthem', { hook: 0, riff: 0 }, 0, 'Am', 1, { scale: NATURAL }), []);
});
