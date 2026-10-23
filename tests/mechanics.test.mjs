// Mechanics that the play-tests never exercised on their own: the dead rising (and Mercy Protocol stopping
// it), veterancy, healing, refugee camps, sterilise and reclaim, and censored case reports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../js/sim/sim.js';
import { spawnUnit, removeUnit, makeBuilding, spawnRefugee, spawnDead } from '../js/sim/entities.js';
import { COMBAT, SPREAD, REFUGEES } from '../js/config/balance.js';

const play = (sim, hours, every = 0.5) => {
  for (let h = 0; h < hours; h += every) { if (sim.state.events.decision) sim.cmd('decide', 0); sim.step(every); sim.drainEvents(); }
};
const risen = (sim) => sim.state.ents.dead.filter((z) => z.rise > 0).length;

test('killed soldiers rise as the dead; Mercy Protocol stops it', () => {
  for (const mercy of [false, true]) {
    const sim = new Sim({ seed: 4 });
    if (mercy) sim.state.laws.push('mercy');
    const before = sim.state.ents.dead.length;
    for (let k = 0; k < 20; k++) removeUnit(sim, spawnUnit(sim, 'infantry', 53 + k * 0.5, 52), true);
    const rose = sim.state.ents.dead.length - before;
    if (mercy) assert.equal(rose, 0);
    else assert.ok(rose >= 20, `only ${rose} rose from 20 squads`);
  }
});

test('veterancy: kills promote a unit and raise its damage', () => {
  const sim = new Sim({ seed: 1 });
  const u = spawnUnit(sim, 'infantry', 72, 72);
  // One kill short of each rank, then a weak dead beside the squad to finish it.
  for (const [rank, need] of COMBAT.vetKills.entries()) {
    u.kills = need - 1;
    const z = spawnDead(sim, 'walker', u.x + 1.2, u.z);
    z.hp = 1; z.rise = 0;
    for (let h = 0; h < 3 && u.vet <= rank; h += 0.25) { sim.step(0.25); sim.drainEvents(); }
    assert.equal(u.vet, rank + 1, `rank after ${u.kills} kills`);
  }
  assert.ok(COMBAT.vetBonus[2] > COMBAT.vetBonus[1] && COMBAT.vetBonus[1] > COMBAT.vetBonus[0]);
});

test('wounded units heal beside a depot and a hospital, not in the open', () => {
  const sim = new Sim({ seed: 1 });
  const hq = sim.state.ents.buildings.find((b) => b.type === 'hq');
  const depot = makeBuilding(sim, 'depot', Math.floor(hq.x) + 8, Math.floor(hq.z) + 8, { instant: true });
  const hosp = makeBuilding(sim, 'hospital', Math.floor(hq.x) - 10, Math.floor(hq.z) + 8, { instant: true });
  const near = spawnUnit(sim, 'infantry', depot.x + 1, depot.z);
  const ward = spawnUnit(sim, 'infantry', hosp.x + 1, hosp.z);
  const far = spawnUnit(sim, 'infantry', depot.x + 30, depot.z);
  near.hp = ward.hp = far.hp = near.maxHp * 0.3;
  const farHp = far.hp;
  play(sim, 5);
  assert.ok(near.hp > near.maxHp * 0.9, `near depot: ${near.hp}/${near.maxHp}`);
  assert.ok(ward.hp > ward.maxHp * 0.9, `at the hospital: ${ward.hp}/${ward.maxHp}`);
  assert.ok(far.hp <= farHp + 1e-9, `in the open: ${far.hp}`);
});

test('admitted refugees go to a camp near their crossing, wait there, then move inland', () => {
  const sim = new Sim({ seed: 1 });
  sim.state.border = 'open';
  const c = sim.map.crossings[0];
  // A camp just inside the crossing.
  let camp = null;
  for (let r = 3; r < 9 && !camp; r++) for (let a = 0; a < 16 && !camp; a++) {
    const i = Math.round(c.x - c.dx * r + Math.cos(a) * 2), j = Math.round(c.z - c.dz * r + Math.sin(a) * 2);
    if (sim.cmd('place', 'camp', i, j).ok) camp = sim.state.ents.buildings.at(-1);
  }
  assert.ok(camp, 'room for a camp');
  camp.built = true; camp.hp = camp.maxHp;
  const r = spawnRefugee(sim, c.siteId);
  r.crossId = c.id ?? 0; r.infected = false;
  r.x = c.x + c.dx; r.z = c.z + c.dz; r.mode = 'waiting'; r.wait = 0; r.path = [];
  let sawCamp = false;
  for (let h = 0; h < 6 && !sawCamp; h += 0.25) { sim.step(0.25); sim.drainEvents(); sawCamp = r.mode === 'toCamp' || r.mode === 'camp'; }
  assert.ok(sawCamp, `refugee mode ${r.mode}`);
  for (let h = 0; h < 24 && r.mode !== 'camp'; h += 0.5) { sim.step(0.5); sim.drainEvents(); }
  assert.equal(r.mode, 'camp');
  const until = r.campUntil;
  assert.ok(until - sim.state.time > REFUGEES.campHours - 25, 'held for the camp period');
  for (let h = 0; h < REFUGEES.campHours + 2 && r.mode === 'camp'; h += 1) { sim.step(1); sim.drainEvents(); }
  assert.notEqual(r.mode, 'camp');
});

test('sterilise burns a town, saves some survivors to the capital, costs trust', () => {
  const sim = new Sim({ seed: 1 });
  const id = sim.map.towns.findIndex((t) => !t.capital);
  const t = sim.state.towns[id], info = sim.map.towns[id];
  const cap = sim.state.towns[sim.map.towns.findIndex((x) => x.capital)];
  t.infected = t.pop * 0.5;
  sim.state.res.authority = 100;
  for (let k = 0; k < 10; k++) spawnDead(sim, 'walker', info.x + 0.5, info.z);
  const pop = t.pop, capPop = cap.pop, trust = sim.state.trust;
  assert.equal(sim.cmd('town', id, 'sterilise').ok, true);
  assert.equal(t.status, 'scorched');
  assert.equal(t.pop, 0);
  assert.ok(Math.abs(cap.pop - capPop - pop * 0.3 * 0.5) < 1, 'survivors (30% of the healthy) reach the capital');
  assert.ok(sim.state.trust < trust - 20, `trust ${trust} → ${sim.state.trust}`);
  assert.equal(sim.state.ents.dead.filter((z) => !z.gone && Math.hypot(z.x - info.x, z.z - info.z) < info.r).length, 0);
  assert.equal(sim.cmd('town', sim.map.towns.findIndex((x) => x.capital), 'sterilise').ok, false);
});

test('reclaim: troops holding a lost town with no dead nearby bring it back after 12 h', () => {
  const sim = new Sim({ seed: 1 });
  const id = sim.map.towns.findIndex((t) => !t.capital);
  const t = sim.state.towns[id], info = sim.map.towns[id];
  t.status = 'fallen'; t.pop = 0; t.residual = 0;
  assert.equal(sim.cmd('town', id, 'reclaim').ok, true);
  play(sim, 4);
  assert.equal(t.status, 'fallen', 'not without troops');
  for (let k = 0; k < 3; k++) spawnUnit(sim, 'infantry', info.x + k * 0.4, info.z);
  for (const z of sim.state.ents.dead) if (Math.hypot(z.x - info.x, z.z - info.z) < info.r + 4) z.gone = true;
  sim.state.ents.dead = sim.state.ents.dead.filter((z) => !z.gone);
  sim.rebuildIndex();
  play(sim, SPREAD.reclaimHours + 2);
  assert.equal(t.status, 'ok');
  assert.ok(t.reclaimed && t.pop > 0);
});

test('censorship makes case reports late and unreliable', () => {
  const runs = [false, true].map((censor) => {
    const sim = new Sim({ seed: 7 });
    if (censor) sim.state.laws.push('censorship');
    const t = sim.state.towns.find((x, i) => !sim.map.towns[i].capital);
    const ratios = [];
    for (let h = 0; h < 72; h++) {
      t.infected = 200 + h * 10; t.alerted = true;
      sim.step(1); sim.drainEvents();
      if (h > 30) ratios.push(t.reported / Math.max(1, t.infected));
    }
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const spread = Math.sqrt(ratios.reduce((a, b) => a + (b - mean) ** 2, 0) / ratios.length);
    return { mean, spread };
  });
  assert.ok(runs[1].spread > runs[0].spread * 2, `spread ${runs[0].spread.toFixed(3)} vs censored ${runs[1].spread.toFixed(3)}`);
});
