import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as score from '../js/audio/score.js';
import { STEPS, BARS_PER_CHORD, PHRASE_BARS, nextLevel, targetLevel } from '../js/audio/score.js';

test('the grid: sixteen steps a bar, a chord every two bars, eight-bar phrases; nothing retired is left', () => {
  assert.deepEqual([STEPS, BARS_PER_CHORD, PHRASE_BARS], [16, 2, 8]);
  assert.deepEqual(Object.keys(score).sort(), ['BARS_PER_CHORD', 'PHRASE_BARS', 'STEPS', 'nextLevel', 'targetLevel']);
});

test('intensity rises on the next bar but falls only after four calmer bars', () => {
  assert.equal(nextLevel(0, 0.9, 0, false).level, 3);
  let st = { level: 3, calmBars: 0 };
  const seen = [];
  for (let b = 0; b < 8; b++) { st = nextLevel(st.level, 0.05, st.calmBars, false); seen.push(st.level); }
  assert.deepEqual(seen, [3, 3, 3, 2, 2, 2, 2, 1]);
  assert.equal(nextLevel(2, 0.9, 0, true).level, -1);
  assert.deepEqual([0, 0.2, 0.5, 0.8].map(targetLevel), [0, 1, 2, 3]);
});
