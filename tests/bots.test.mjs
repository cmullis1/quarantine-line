import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../js/sim/sim.js';
import { BOTS, effectCosts, decideByCosts } from '../js/ai/bots.js';
import { DECISION_BY_ID } from '../js/config/campaign.js';

test('the expert reads a card\'s stated costs, counting risks at half', () => {
  assert.deepEqual(effectCosts('Trust −6 · Manpower +40 · Detection +10% everywhere'), { trust: -6, manpower: 40 });
  assert.deepEqual(effectCosts('Funds +80 · Detection −15% · If it leaks: Trust −12'), { funds: 80, trust: -6 });
  assert.deepEqual(effectCosts('People and manpower flow in · Trust + · Some are infected'), { trust: 3 });
});

test('when trust is low the expert avoids the choice that costs trust', () => {
  const sim = new Sim({ seed: 1 });
  const id = Object.keys(DECISION_BY_ID).find((k) => DECISION_BY_ID[k].choices.some((c) => /Trust −\d+/.test(c.effect)) && DECISION_BY_ID[k].choices.some((c) => !/Trust −/.test(c.effect)));
  sim.state.trust = 25;
  const pick = DECISION_BY_ID[id].choices[decideByCosts(sim, id)];
  assert.ok(!/Trust −\d+/.test(pick.effect), `${id}: picked "${pick.effect}"`);
});

test('the expert plays a week without errors and keeps the country running', () => {
  const sim = new Sim({ seed: 3, difficulty: 'veteran' });
  const bot = BOTS.expert(sim);
  for (let h = 0; h < 24 * 7 && !sim.state.over; h++) { bot.tick(); sim.step(1); sim.drainEvents(); }
  assert.ok(!sim.state.over, `lost on day ${sim.day}: ${sim.state.over?.reason}`);
  assert.ok(sim.state.ents.buildings.length > 10 && sim.state.ents.units.length > 4);
});
