// The adaptive score's grid and intensity. Pure functions (no Web Audio) so they can be tested.
//
// Structure: 16-step bars, chords change every 2 bars, a 4-chord loop makes an 8-bar phrase (the worlds, songs and
// director build on this grid; see worlds.js, songs.js, director.js). Intensity changes only on a bar line: it
// rises at once and falls one level after 4 calmer bars.

export const STEPS = 16;
export const BARS_PER_CHORD = 2;
export const PHRASE_BARS = 8;

// Level -1 = paused (a breakdown: drums drop out); 0 watchful; 1 tension; 2 combat; 3 crisis.
// The level to play for the next bar. Rises at once; falls one level after `calmBars` (≥ 4) calmer bars.
export function targetLevel(threat) {
  return threat < 0.15 ? 0 : threat < 0.4 ? 1 : threat < 0.7 ? 2 : 3;
}
export function nextLevel(current, threat, calmBars, paused) {
  if (paused) return { level: -1, calmBars: 0 };
  const want = targetLevel(threat);
  if (current < 0 || want >= current) return { level: want, calmBars: 0 };
  if (calmBars + 1 >= 4) return { level: current - 1, calmBars: 0 };
  return { level: current, calmBars: calmBars + 1 };
}
