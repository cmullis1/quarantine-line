// The score's musical primitives on absolute chords: voicings, composed hooks and riffs, and how they become
// notes over whichever chord is playing. Pure data and functions (no Web Audio) so they can be tested.
// Each mood world (worlds.js) supplies its scale (pitch classes) and the melody's octave shift.

import { STEPS } from './score.js';

// Chord voicings, MIDI: bass root first, then the three upper voices. Named absolutely so the three worlds'
// keys (C major, A minor, darkened A minor) can share chords and pivot through them.
export const CHORDS = {
  Am: [45, 57, 60, 64], Dm: [38, 57, 62, 65], Em: [40, 55, 59, 64], F: [41, 57, 60, 65], C: [48, 55, 60, 64],
  G: [43, 55, 59, 62], Bb: [46, 58, 62, 65], Bdim: [47, 59, 62, 65], E: [40, 56, 59, 64],
};

// ---- Composed melodies: hooks, riffs, call and answer -------------------------------------------------------
// Notes are [step, ref, length] over two bars (steps 0–31, one chord). `ref` is either a chord tone (1–3 the
// chord's upper voices, 4–6 the same an octave up) or a string '+n' / '-n': n scale steps from the previous note.
// Chord tones sit on the strong beats, so a hook lands on whatever chord is playing and follows the harmony.

// Hand-written two-bar hooks, each with its own rhythm and shape.
export const HOOKS = [
  // 1. Rising call: climbs to the top, falls back by step.
  [[0, 1, 4], [4, 2, 2], [6, '+1', 2], [8, 3, 6], [14, '-1', 2], [16, 2, 4], [20, '-1', 2], [22, '-1', 2], [24, 1, 8]],
  // 2. Short-short-long, twice, then home.
  [[0, 3, 2], [2, 3, 2], [4, 2, 4], [8, 3, 2], [10, 3, 2], [12, 4, 4], [16, 3, 6], [22, 2, 2], [24, 1, 8]],
  // 3. Lament: starts high and sighs down.
  [[0, 5, 6], [6, '-1', 2], [8, 3, 6], [14, '-1', 2], [16, 2, 4], [20, '-1', 4], [24, 1, 8]],
  // 4. Tresillo (3+3+2) push, then a held answer.
  [[0, 1, 3], [3, 2, 3], [6, 3, 2], [8, 4, 8], [16, 3, 3], [19, 2, 3], [22, 1, 2], [24, 2, 8]],
  // 5. Pedal and leap: repeated note, a jump, a stepwise return.
  [[0, 1, 2], [2, 1, 2], [4, 4, 4], [8, 3, 2], [10, 2, 2], [12, 1, 4], [16, 1, 2], [18, 1, 2], [20, 5, 4], [24, 4, 8]],
  // 6. Question: a rising line left hanging, answered a step down.
  [[0, 2, 4], [4, 3, 4], [8, 4, 4], [12, '+1', 4], [16, 3, 8], [24, 2, 4], [28, 1, 4]],
  // 7. Steady march.
  [[0, 1, 2], [2, 1, 2], [4, 2, 2], [6, 3, 2], [8, 4, 6], [14, '-1', 2], [16, 3, 4], [20, 2, 4], [24, 1, 8]],
  // 8. Broad: long notes, room to breathe.
  [[0, 3, 8], [8, 4, 4], [12, '-1', 4], [16, 2, 8], [24, 1, 8]],
];

// One-bar riff shapes in chord tones, one per eighth note (8 per bar).
export const RIFFS = [
  [1, 4, 3, 4, 2, 4, 3, 2],
  [1, 3, 4, 3, 5, 3, 4, 3],
  [1, 2, 3, 1, 4, 3, 2, 3],
  [4, 1, 3, 1, 2, 1, 3, 5],
];

// The melody's range. Its top is A5: nothing composed sustains above it (the shrill rule); the bells' decaying
// partials keep the sparkle.
export const MELODY_TOP = 81;
const RANGE = [52, MELODY_TOP];
// A note above A5 moved down by octaves, so it keeps its place in the harmony.
export const foldDown = (midi) => {
  let m = midi;
  while (m > MELODY_TOP) m -= 12;
  return m;
};
// Every MIDI note in the scale's pitch classes, a little past the melody range so steps can walk off its edge
// and be folded back.
const scaleNotes = (scale) => {
  const pcs = new Set(scale);
  const out = [];
  for (let m = RANGE[0] - 12; m <= RANGE[1] + 12; m++) if (pcs.has(m % 12)) out.push(m);
  return out;
};
export function chordTone(chord, k, shift = 12) {
  const v = CHORDS[chord];
  return v[((k - 1) % 3) + 1] + 12 * Math.floor((k - 1) / 3) + shift;
}
function scaleMove(midi, n, notes) {
  let i = notes.reduce((b, m, k) => (Math.abs(m - midi) < Math.abs(notes[b] - midi) ? k : b), 0);
  i = Math.max(0, Math.min(notes.length - 1, i + n));
  return notes[i];
}
// Turn [step, ref, len] notes into [step, midi, len] over one chord.
export function realise(notes, chord, scale, shift = 12) {
  const sc = scaleNotes(scale);
  let prev = chordTone(chord, 1, shift);
  return notes.map(([st, ref, len]) => {
    let midi = typeof ref === 'number' ? chordTone(chord, ref, shift) : scaleMove(prev, +ref, sc);
    // Out of range: move by octaves, never clamp, so the note keeps its place in the harmony.
    midi = foldDown(midi);
    while (midi < RANGE[0]) midi += 12;
    prev = midi;
    return [st, midi, len];
  });
}

// Phrase shapes for a hook over 8 bars (four 2-bar sections): statement, repeat, twist, resolution.
const firstBar = (h) => h.filter(([st]) => st < STEPS);
function twist(h) {
  // The first bar, then the same bar again a chord tone higher: a rising sequence instead of the old ending.
  const up = firstBar(h).map(([st, ref, len]) => [st + STEPS, typeof ref === 'number' ? Math.min(6, ref + 1) : ref, len]);
  return [...firstBar(h), ...up.slice(0, -1), [up.at(-1)[0], up.at(-1)[1], 2 * STEPS - up.at(-1)[0]]];
}
function resolve(h) {
  const last = h.at(-1);
  return [...h.slice(0, -1), [last[0], 1, 2 * STEPS - last[0]]];
}
export const HOOK_FORM = ['A', 'A', 'B', 'R'];

// Riff over two bars: quarters when calm, eighths with tension, sixteenths (with an octave pulse) from combat.
// The fourth bar of every four ends with a two-note climb into the next chord.
function riffNotes(riff, level, fill) {
  const out = [];
  for (let bar = 0; bar < 2; bar++) {
    for (let e = 0; e < 8; e++) {
      const st = bar * STEPS + e * 2;
      if (level <= 0 && e % 2) continue;
      if (fill && bar === 1 && e >= 6) { out.push([st, '+1', 2]); continue; }
      const len = level <= 0 ? 3 : level >= 2 ? 1 : 2;
      out.push([st, riff[e], len]);
      if (level >= 2) out.push([st + 1, 4, 1]);
    }
  }
  return out;
}

// Call and answer: the hook's first bar as the call (lead voice), then the answer in the second bar from a lower
// voice: same rhythm, the chord tones mirrored, always ending on a chord tone (held to the end of the phrase).
function callAnswer(h, last) {
  const call = firstBar(h);
  const ans = call.map(([st, ref, len]) => [st + STEPS, typeof ref === 'number' ? Math.max(1, 4 - ref) : ref, len]);
  const end = ans.at(-1);
  ans[ans.length - 1] = [end[0], 1, last ? 2 * STEPS - end[0] : end[2]];
  return { call, ans };
}

// The melody for one 2-bar section (phraseBar 0, 2, 4 or 6) as notes { s, midi, len, voice }, for
// kind 'hooks' | 'riff' | 'call'; any other kind is not composed here and gives no notes.
// `mel` picks the hook and riff ({ hook, riff }); hooks/call use the same hook through a phrase.
// `scale` is the world's pitch classes; `shift` lifts the melody (12 = an octave above the chord voicing).
export function melodySection(kind, mel, phraseBar, chord, level, { scale, shift = 12 }) {
  const sec = Math.floor(phraseBar / 2) % 4;
  const hook = HOOKS[mel.hook % HOOKS.length];
  const toNotes = (notes, voice, down = 0) => realise(notes, chord, scale, shift).map(([s, midi, len]) => ({ s, midi: midi + down, len, voice }));
  if (kind === 'hooks') {
    const form = HOOK_FORM[sec];
    return toNotes(form === 'B' ? twist(hook) : form === 'R' ? resolve(hook) : hook, 'lead');
  }
  if (kind === 'riff') return toNotes(riffNotes(RIFFS[mel.riff % RIFFS.length], level, sec % 2 === 1), 'lead', -12);
  if (kind === 'call') {
    const { call, ans } = callAnswer(hook, sec === 3);
    return [...toNotes(call, 'lead'), ...toNotes(ans, 'answer', -12)];
  }
  return [];
}
