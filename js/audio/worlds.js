// The three mood worlds the score moves between: Hopeful (C major, bright and bouncy), Uneasy (A minor, today's
// synth band) and Dire (darkened A minor, heavy half-time). Each world has its own key, scale, tempo, groove,
// band, reverb space and melody register (`shift`: semitones above the chord voicing; Dire sings an octave below
// the others, low and heavy, which keeps its sustained choir and distorted lead out of the shrill band). Pure data
// and functions (no Web Audio) so the patterns can be tested.
//
// Grooves keep the score's rules at every level: all four beats are marked (kick, snare, clap, taiko or bass),
// accents on hats and shakers fall only on the beat, and the drive rises with the level.

import { PHRASE_BARS } from './score.js';

export const WORLDS = {
  hopeful: { key: 'C', scale: [0, 2, 4, 5, 7, 9, 11], tempo: 112, groove: 'bounce', band: 'warm', reverb: { seconds: 1.2, damp: 2.5 }, shift: 12 },
  uneasy: { key: 'Am', scale: [9, 11, 0, 2, 4, 5, 7], tempo: 104, groove: 'standard', band: 'synth', reverb: { seconds: 1.8, damp: 3 }, shift: 12 },
  // A minor with B-flat (the Phrygian dread) and G-sharp (the harmonic leading note).
  dire: { key: 'Am', scale: [9, 10, 0, 2, 4, 5, 8], tempo: 94, groove: 'heavy', band: 'dark', reverb: { seconds: 3.5, damp: 4.5 }, shift: 0 },
};

// The chords each world's loops draw on. Neighbouring worlds share several, so the harmony can pivot.
const CHORD_SETS = {
  hopeful: ['C', 'G', 'Am', 'F', 'Dm', 'Em'],
  uneasy: ['Am', 'Dm', 'Em', 'F', 'C', 'G'],
  dire: ['Am', 'Dm', 'Em', 'Bb', 'Bdim', 'E', 'F'],
};
export const chordsOf = (mood) => CHORD_SETS[mood];
export const sharedChords = (a, b) => chordsOf(a).filter((c) => chordsOf(b).includes(c));

// Drum lines: one string per level (0–3), a character per step: '.' rest, 'x' hit, 'X' accent.
// Bass lines: per level, [step, semitones above the chord root].
// `swing` delays odd sixteenths by that fraction of a step.
export const GROOVES = {
  bounce: { swing: 0.1, patterns: {
    kick: ['x.......x.......', 'x.....x.x.......', 'x.....x.x..x....', 'x.x...x.x.x...x.'],
    clap: ['................', '....x.......x...', '....x.......x...', '....x.......x.x.'],
    shaker: ['..x...x...x...x.', 'X.x.X.x.X.x.X.x.', 'XxxxXxxxXxxxXxxx', 'XxxxXxxxXxxxXxxx'],
    tamb: ['................', '................', '....x.......x...', '..x...x...x...x.'],
    bass: [[[0, 0], [4, 12], [8, 7], [12, 12]], [[0, 0], [3, 12], [4, 0], [8, 7], [11, 12], [12, 0]],
      [[0, 0], [2, 12], [4, 0], [6, 12], [8, 7], [10, 12], [12, 0], [14, 12]],
      [[0, 0], [1, 12], [2, 0], [4, 12], [6, 0], [8, 7], [9, 12], [10, 7], [12, 0], [14, 12], [15, 7]]],
  } },
  standard: { swing: 0, patterns: {
    kick: ['x.......x.......', 'x.......x.x.....', 'x.....x.x.......', 'x...x...x...x.x.'],
    snare: ['................', '....x.......x...', '....x.......x...', '....x.......x.xx'],
    hat: ['..x...x...x...x.', 'X.x.X.x.X.x.X.x.', 'XxxxXxxxXxxxXxxx', 'XxxxXxxxXxxxXxxx'],
    ohat: ['................', '................', '..............x.', '..x...x...x...x.'],
    bass: [
      [[0, 0], [4, 0], [8, 7], [12, 0]],
      [[0, 0], [2, 0], [4, 12], [6, 0], [8, 7], [10, 0], [12, 12], [14, 0]],
      [[0, 0], [2, 0], [3, 0], [4, 12], [6, 0], [8, 7], [10, 0], [11, 0], [12, 12], [14, 0]],
      [[0, 0], [1, 0], [2, 0], [3, 0], [4, 12], [5, 0], [6, 0], [7, 0], [8, 7], [9, 0], [10, 0], [11, 0], [12, 12], [13, 0], [14, 7], [15, 0]],
    ],
  } },
  heavy: { swing: 0, patterns: {
    kick: ['x...............', 'x.....x.........', 'x.....x...x.....', 'x.x...x.x.x...x.'],
    snare: ['................', '........x.......', '........x.......', '........x.....x.'],
    taiko: ['........x.......', '............x...', '....x.......x.xx', 'x...x...x.x.xxxx'],
    clang: ['................', '................', '..............x.', '......x.......x.'],
    hat: ['................', '..x...x...x...x.', 'x.x.x.x.x.x.x.x.', 'XxxxXxxxXxxxXxxx'],
    // Root on every beat, pushing to the half-step above (the dread) at the end of the bar.
    bass: [[[0, 0], [4, 0], [8, 0], [12, 0]], [[0, 0], [4, 0], [6, 0], [8, 0], [12, 0], [14, 1]],
      [[0, 0], [2, 0], [4, 0], [6, 0], [8, 0], [10, 0], [12, 0], [14, 1]],
      [...Array.from({ length: 14 }, (_, s) => [s, 0]), [14, 1], [15, 1]]],
  } },
};

// The written variation for alternate bars, per groove: [instrument, step to drop, step to add].
const ALT = { bounce: ['kick', null, 14], standard: ['kick', 10, 11], heavy: ['taiko', null, 6] };
// The phrase-closing fill (last bar, steps 12–15): a tom run, or a clap roll in the bounce groove.
const FILL = { bounce: 'clap', standard: 'tom', heavy: 'tom' };
const THINS = new Set(['hat', 'shaker']);

// Drum and bass hits for one step of a groove. `phraseBar` counts from the start of the phrase (0–7);
// `night` thins the plain hats and shakers below level 2; `alt` plays the alternate bar; `fill` closes the
// phrase. Level -1 (paused) drops the drums and bass entirely.
export function hitsFor(groove, level, step, phraseBar, { night = false, alt = false, fill = false } = {}) {
  if (level < 0) return [];
  const L = Math.min(3, level);
  const { patterns } = GROOVES[groove];
  const filling = fill && phraseBar === PHRASE_BARS - 1 && step >= 12;
  const out = [];
  for (const [inst, lines] of Object.entries(patterns)) {
    if (inst === 'bass') continue;
    let c = lines[L][step];
    if (alt && ALT[groove][0] === inst) {
      if (step === ALT[groove][1]) c = '.';
      if (step === ALT[groove][2] && c === '.') c = 'x';
    }
    // The fill's own instrument plays the roll instead of its pattern.
    if (filling && FILL[groove] === inst) continue;
    if (c === '.' || (night && THINS.has(inst) && c === 'x' && L < 2)) continue;
    out.push({ inst, vel: (c === 'X' ? 1 : 0.7) * (L === 0 ? 0.55 : 1) });
  }
  if (filling) out.push({ inst: FILL[groove], vel: 0.6 + (step - 12) * 0.12, n: step - 12 });
  for (const [s, deg] of patterns.bass[L]) if (s === step) out.push({ inst: 'bass', deg, vel: L === 0 ? 0.6 : 0.85 });
  return out;
}

// How late an odd sixteenth lands under the groove's swing, in seconds.
export const swingDelay = (groove, step, stepLen) => (step % 2 === 1 ? GROOVES[groove].swing * stepLen : 0);

// Instrument names for each band's parts (the recipes live in the audio engine). `leads` are the melody sounds
// the director picks from; `braam` marks the band that plays low brass hits.
export const BANDS = {
  warm: { chords: 'piano', pad: 'warmPad', arp: 'piano', bass: 'pluckBass', drone: null, braam: false, leads: ['bell', 'celesta', 'piano'] },
  synth: { chords: 'stab', pad: null, arp: 'pluck', bass: 'sawBass', drone: null, braam: false, leads: ['soft', 'bell', 'synth'] },
  dark: { chords: 'choir', pad: null, arp: 'lowPiano', bass: 'subBass', drone: 'subDrone', braam: true, leads: ['dist', 'choir', 'lowPiano'] },
};
