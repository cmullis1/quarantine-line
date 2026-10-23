// Every difficulty modifier reaches the systems it is meant to (audit 2026-10-22).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../js/sim/sim.js';
import { DIFFICULTY } from '../js/config/balance.js';
import { economySystem } from '../js/sim/systems/economy.js';

const sims = () => Object.keys(DIFFICULTY).map((difficulty) => new Sim({ seed: 5, difficulty }));

test('a fallen town leaves more dead on harder difficulties', async () => {
  const { fallTown } = await import('../js/sim/systems/towns.js');
  const residual = sims().map((sim) => {
    const t = sim.state.towns.find((x, i) => !sim.map.towns[i].capital);
    fallTown(sim, t);
    return t.residual;
  });
  assert.ok(residual[0] < residual[1] && residual[1] < residual[2], `recruit/veteran/nightmare: ${residual}`);
});

test('order losses are sharpened by the politics setting, like trust losses', () => {
  const rates = sims().map((sim) => {
    sim.state.order = 50; sim.state.trust = 20; // low trust → an order loss
    economySystem(sim, 0.05);
    return sim.state.orderParts.find(([label]) => label === 'low trust')[1];
  });
  const [r, v, n] = rates;
  assert.ok(Math.abs(r / v - DIFFICULTY.recruit.politics) < 1e-9 && Math.abs(n / v - DIFFICULTY.nightmare.politics) < 1e-9, `rates ${rates}`);
});

test('the trickle of stray dead comes faster on harder difficulties', () => {
  const counts = Object.keys(DIFFICULTY).map((difficulty) => {
    let total = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const sim = new Sim({ seed, difficulty, mode: 'sandbox' });
      sim.state.flags.noHordes = true;
      sim.state.hordeT = 1e9; // no scheduled hordes: only the trickle spawns
      for (let h = 0; h < 120; h++) { sim.step(1); sim.drainEvents(); }
      total += sim.state.stats.spawned ?? sim.state.ents.dead.length;
    }
    return total;
  });
  assert.ok(counts[0] < counts[1] && counts[1] < counts[2], `recruit/veteran/nightmare: ${counts}`);
});
