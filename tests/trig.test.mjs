// The crowd's sincos agrees with Math.sin and Math.cos (PF2: one reduction for both, inline, instead of two calls).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sincos, SC } from '../js/render/trig.js';

function worst(xs) {
  let ds = 0, dc = 0;
  for (const x of xs) {
    sincos(x);
    ds = Math.max(ds, Math.abs(SC[0] - Math.sin(x)));
    dc = Math.max(dc, Math.abs(SC[1] - Math.cos(x)));
  }
  return [ds, dc];
}

test('sincos matches Math.sin and Math.cos over the angles a pose uses', () => {
  // Limb and body angles (a few radians either way), every quadrant and its edges.
  const small = [];
  for (let k = -4000; k <= 4000; k++) small.push(k * 0.0017);
  for (let q = -8; q <= 8; q++) for (const e of [-1e-12, 0, 1e-12]) small.push(q * Math.PI / 4 + e);
  const [ds, dc] = worst(small);
  assert.ok(ds <= 2.3e-16 && dc <= 2.3e-16, `small angles: sin off by ${ds}, cos by ${dc}`);
});

test('sincos stays accurate for the walk phase and clock after a long game', () => {
  // A figure's phase grows ~11 per second it walks; the nod uses seconds since the page loaded × 2.
  const big = [];
  let s = 12345;
  for (let k = 0; k < 20000; k++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; big.push((s / 2 ** 32 - 0.5) * 4e5); }
  const [ds, dc] = worst(big);
  assert.ok(ds <= 4.5e-16 && dc <= 4.5e-16, `large angles: sin off by ${ds}, cos by ${dc}`);
});

test('sincos is exact at zero and passes NaN through', () => {
  sincos(0);
  assert.equal(SC[0], 0);
  assert.equal(SC[1], 1);
  sincos(NaN);
  assert.ok(Number.isNaN(SC[0]) && Number.isNaN(SC[1]));
});
