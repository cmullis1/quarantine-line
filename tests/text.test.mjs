import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trueTrust, ceilHours, hours } from '../js/ui/dom.js';
import { LAW_BY_ID, lawEffects } from '../js/config/laws.js';

test('trust costs on cards are shown as they will land', () => {
  assert.equal(trueTrust('Trust −20 · Authority +6', 1.25), 'Trust −25 · Authority +6');
  assert.equal(trueTrust('Break it: trust −6', 0.75), 'Break it: trust −5');
  assert.equal(trueTrust('Trust +15 · Trust −0.02/h', 1.25), 'Trust +15 · Trust −0.02/h');
  assert.equal(trueTrust('Trust −20', 1), 'Trust −20');
});

test('law cards are generated from the same numbers the sim uses', () => {
  const curfew = lawEffects(LAW_BY_ID.curfew, 1);
  assert.ok(curfew.pros.includes('Order +10 now') && curfew.pros.includes('Order +0.03/h'));
  assert.ok(curfew.cons.includes('Trust −0.02/h'));
  const mercy = lawEffects(LAW_BY_ID.mercy, 1.25);
  assert.ok(mercy.cons.includes('Trust −19 now'), mercy.cons.join());
  assert.ok(lawEffects(LAW_BY_ID.broadcasts, 1).pros.includes('Trust +0.02/h'));
});

test('countdowns round whole hours up without the clock step\'s float noise', () => {
  let t = 7, worst = 0;
  for (let i = 0; i < 400; i++) { t += 0.05; worst = Math.max(worst, ceilHours(t + 14 - t)); }
  assert.equal(worst, 14);
  assert.equal(ceilHours(13.2), 14);
  assert.equal(hours(14.000000000000002), '14h');
});
