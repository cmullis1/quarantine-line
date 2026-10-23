// Same seed, same commands, same game, including under a big horde (the sim's hot path: dead loop, spatial hashes).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../js/sim/sim.js';
import { spawnDead, spawnUnit, makeBuilding } from '../js/sim/entities.js';

function run(seed) {
  const sim = new Sim({ seed });
  sim.state.time = 22;
  sim.state.res.ammo = 1e5;
  const cap = sim.map.towns.find((t) => t.capital);
  for (let i = -5; i <= 5; i++) makeBuilding(sim, 'wall', Math.floor(cap.x) + i, Math.floor(cap.z) - 8, { instant: true });
  for (let k = 0; k < 6; k++) spawnUnit(sim, 'infantry', cap.x - 3 + k, cap.z - 5);
  const types = ['walker', 'walker', 'runner', 'brute', 'howler'];
  for (let k = 0; k < 400; k++) spawnDead(sim, types[k % 5], cap.x + ((k * 37) % 25) - 12, cap.z - 10 - ((k * 53) % 14));
  for (let h = 0; h < 72; h++) {
    if (sim.state.events.decision) sim.cmd('decide', 0);
    sim.step(1);
    sim.drainEvents();
  }
  return { hash: sim.hash(), json: JSON.stringify(sim.state) };
}

test('two runs of one seed agree to the byte after 3 days under a horde', () => {
  const a = run(11), b = run(11);
  assert.equal(a.hash, b.hash);
  assert.equal(a.json, b.json);
});

test('a different seed gives a different game', () => {
  assert.notEqual(run(11).hash, run(12).hash);
});
