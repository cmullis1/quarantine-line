// The sealing planner (js/ai/seal.js) used by the expert bot: its line must really close the country to the dead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../js/sim/sim.js';
import { makeBuilding } from '../js/sim/entities.js';
import { sealPlan } from '../js/ai/seal.js';
import { STRUCTURE_COST } from '../js/sim/nav.js';
import { TER } from '../js/config/world.js';

// Build the plan instantly, then ask the dead's own flow field how far the outside is from the towns: every route
// must cross a structure (or a planned river gap, which costs water only).
function sealedDistance(sim, plan) {
  for (const t of plan.tiles) makeBuilding(sim, t.type, t.i, t.j, { instant: true });
  const N = sim.N, m = sim.map, gaps = new Set(plan.gaps.map((g) => g.j * N + g.i));
  const sources = [];
  for (let k = 0; k < N * N; k++) if (m.townId[k] >= 0) sources.push({ k, bias: 0 });
  sim.nav.flow(sources);
  let min = Infinity;
  for (let k = 0; k < N * N; k++) {
    if (m.owner[k] || sim.forward[k] === 1 || gaps.has(k)) continue;
    min = Math.min(min, sim.nav.dist[k]);
  }
  return min;
}

for (const [mode, seed] of [['campaign', 1], ['sandbox', 2], ['sandbox', 3]]) {
  test(`the planned line leaves the dead no way round (${mode} ${seed})`, () => {
    const sim = new Sim({ seed, mode });
    const plan = sealPlan(sim);
    assert.ok(plan.sealed && plan.tiles.length > 50, `${plan.tiles.length} tiles`);
    if (plan.gaps.length) return; // a river gap is open by design; the sandbox maps check the closed case
    assert.ok(sealedDistance(sim, plan) >= STRUCTURE_COST, 'some route reaches a town without crossing a wall');
  });
}

test('a destroyed wall is planned again, and nothing else is', () => {
  const sim = new Sim({ seed: 2, mode: 'sandbox' });
  const plan = sealPlan(sim);
  const built = plan.tiles.map((t) => makeBuilding(sim, t.type, t.i, t.j, { instant: true }));
  assert.equal(sealPlan(sim).tiles.length, 0);
  const lost = built[Math.floor(built.length / 2)];
  sim.cmd('demolish', lost.id);
  const again = sealPlan(sim).tiles;
  assert.equal(again.length, 1);
  assert.deepEqual([again[0].i, again[0].j], [lost.i, lost.j]);
});

test('roads through the line get gates so people and buses can still pass', () => {
  const sim = new Sim({ seed: 1, mode: 'campaign' });
  for (const t of sealPlan(sim).tiles) assert.equal(t.type, sim.map.road[t.j * sim.N + t.i] ? 'gate' : 'wall');
});

// The expert posts its field teams by this (bots.js): 0 the home side, 1 on the line, 2 beyond it.
test('the plan tells the home side from the far side: towns behind the line, foreign land beyond it', () => {
  const sim = new Sim({ seed: 2, mode: 'sandbox' });
  const plan = sealPlan(sim), N = sim.N, m = sim.map;
  for (const t of plan.tiles) assert.equal(plan.side[t.j * N + t.i], 1, 'a planned tile is on the line');
  let home = 0, beyond = 0;
  for (let k = 0; k < N * N; k++) {
    if (m.townId[k] >= 0) { assert.equal(plan.side[k], 0, 'a town tile is on the home side'); home++; }
    else if (!m.owner[k] && sim.forward[k] !== 1 && m.terrain[k] !== TER.MOUNTAIN) { assert.equal(plan.side[k], 2, 'foreign land is beyond'); beyond++; }
  }
  assert.ok(home > 0 && beyond > 0);
});
