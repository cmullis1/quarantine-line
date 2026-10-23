// Producing buildings need workers from the living towns, so income cannot be multiplied without limit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../js/sim/sim.js';
import { makeBuilding } from '../js/sim/entities.js';
import { BUILDINGS } from '../js/config/buildings.js';
import { canPlace } from '../js/sim/commands.js';
import { computeRates, economySystem, workforce } from '../js/sim/systems/economy.js';

// Instantly built factories in rings around the HQ.
function factories(sim, n) {
  const hq = sim.state.ents.buildings.find((b) => b.type === 'hq');
  const out = [];
  for (let r = 4; r < 40 && out.length < n; r++) for (let a = 0; a < 32 && out.length < n; a++) {
    const i = Math.round(hq.x + Math.cos((a / 32) * Math.PI * 2) * r), j = Math.round(hq.z + Math.sin((a / 32) * Math.PI * 2) * r);
    if (canPlace(sim, 'factory', i, j, { free: true }).ok) out.push(makeBuilding(sim, 'factory', i, j, { instant: true }));
  }
  assert.equal(out.length, n);
  return out;
}

test('factory income stops growing once the workforce is used up', () => {
  const sim = new Sim({ seed: 4 });
  const { have } = workforce(sim);
  const fit = Math.floor((have - workforce(sim).need) / 2);
  factories(sim, fit);
  const full = computeRates(sim).rates.funds;
  factories(sim, 20);
  const spam = computeRates(sim).rates.funds;
  assert.ok(Math.abs(spam - full) < 1e-9, `rate with ${fit} factories ${full}, with ${fit + 20}: ${spam}`);
});

test('the newest factories are the ones left idle', () => {
  const sim = new Sim({ seed: 4 });
  const fit = Math.floor((workforce(sim).have - workforce(sim).need) / 2);
  const all = factories(sim, fit + 3);
  economySystem(sim, 0.05);
  assert.deepEqual(all.map((b) => b.idle), [...Array(fit).fill(false), true, true, true]);
  assert.ok(sim.state.workforce.need > sim.state.workforce.have);
});

test('quarantining a town takes most of its workers off the job', () => {
  const sim = new Sim({ seed: 4 });
  const before = workforce(sim).have;
  const t = [...sim.state.towns].sort((a, b) => b.pop - a.pop)[0];
  t.quarantine = true;
  const after = workforce(sim).have;
  assert.ok(after < before - (t.pop / 1e5) * 0.5, `${before} → ${after}`);
});

test('an idle munitions plant costs no upkeep', () => {
  const sim = new Sim({ seed: 4 });
  const hq = sim.state.ents.buildings.find((b) => b.type === 'hq');
  const plants = [];
  for (let r = 6; r < 40 && plants.length < 14; r++) for (let a = 0; a < 32 && plants.length < 14; a++) {
    const i = Math.round(hq.x + Math.cos((a / 32) * Math.PI * 2) * r), j = Math.round(hq.z + Math.sin((a / 32) * Math.PI * 2) * r);
    if (canPlace(sim, 'munitions', i, j, { free: true }).ok) plants.push(makeBuilding(sim, 'munitions', i, j, { instant: true }));
  }
  const { idle } = workforce(sim);
  const working = plants.filter((b) => !idle.has(b.id)).length;
  assert.ok(working < plants.length, 'some plants are idle');
  const base = computeRates(new Sim({ seed: 4 })).rates.funds;
  const funds = computeRates(sim).rates.funds;
  assert.ok(Math.abs(funds - (base - working * BUILDINGS.munitions.upkeep.funds)) < 1e-9, `funds ${funds}, base ${base}, ${working} working`);
});

test('farms are staffed before factories, whatever was built first', () => {
  const sim = new Sim({ seed: 4 });
  const free = workforce(sim).have - workforce(sim).need;
  const fit = Math.floor(free / 2);
  factories(sim, fit);
  const hq = sim.state.ents.buildings.find((b) => b.type === 'hq');
  const place = (type) => {
    for (let r = 10; r < 40; r++) for (let a = 0; a < 32; a++) {
      const i = Math.round(hq.x + Math.cos((a / 32) * Math.PI * 2) * r), j = Math.round(hq.z + Math.sin((a / 32) * Math.PI * 2) * r);
      if (canPlace(sim, type, i, j, { free: true }).ok) return makeBuilding(sim, type, i, j, { instant: true });
    }
    return null;
  };
  // A lab takes an odd worker the two-worker factories leave, so the farm only fits if a factory gives way.
  if (free - fit * 2 >= BUILDINGS.lab.workers) place('lab');
  assert.equal(workforce(sim).idle.size, 0, 'every factory staffed before the farm');
  const farm = place('farm');
  const { idle } = workforce(sim);
  assert.ok(!idle.has(farm.id), 'the new farm is staffed');
  assert.equal([...idle].length, 1, 'one factory gave up its workers');
});
