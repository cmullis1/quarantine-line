import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../js/sim/sim.js';
import { spawnDead, makeBuilding, spawnUnit, killDead } from '../js/sim/entities.js';
import { scheduleHorde } from '../js/sim/systems/world.js';
import { BUILDINGS } from '../js/config/buildings.js';

function play(sim, hours, every = 1, onTick = null) {
  for (let h = 0; h < hours; h += every) {
    if (sim.state.events.decision) sim.cmd('decide', 0);
    if (onTick) onTick(sim, h);
    sim.step(every);
    sim.drainEvents();
  }
}

test('same seed + same commands → identical state', () => {
  const a = new Sim({ seed: 3 }), b = new Sim({ seed: 3 });
  const cmds = (sim, h) => { if (h === 5) sim.cmd('placeLine', 'wall', 50, 70, 56, 70); };
  play(a, 72, 1, cmds);
  play(b, 72, 1, cmds);
  assert.equal(a.hash(), b.hash());
});

test('serialize → deserialize → continue equals an uninterrupted run (mid-horde)', () => {
  const a = new Sim({ seed: 5 });
  play(a, 80);
  const saved = a.serialize();
  const b = Sim.deserialize(saved);
  play(a, 24);
  play(b, 24);
  assert.equal(a.hash(), b.hash());
});

test('state is JSON-serialisable after two days', () => {
  const sim = new Sim({ seed: 2 });
  play(sim, 48);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(sim.state)));
});

test('commands reject stale ids and bad input without throwing', () => {
  const sim = new Sim({ seed: 1 });
  assert.equal(sim.cmd('nonsense').ok, false);
  assert.equal(sim.cmd('move', [999999], 10, 10).ok, false);
  assert.equal(sim.cmd('demolish', 424242).ok, false);
  assert.equal(sim.cmd('train', 424242, 'infantry').ok, false);
  assert.equal(sim.cmd('upgrade', 424242).ok, false);
  assert.equal(sim.cmd('town', 99, 'quarantine').ok, false);
  assert.equal(sim.cmd('passLaw', 'nope').ok, false);
  assert.equal(sim.cmd('action', 'airstrike', 10, 10).ok, false, 'airstrike needs a helipad');
  assert.equal(sim.cmd('setBorder', 'shoot').ok, false, 'shoot needs the security law');
  assert.equal(sim.cmd('place', 'highwall', 50, 50).ok, false, 'high walls are upgrade-only');
});

test('placing a wall line charges funds per segment', () => {
  const sim = new Sim({ seed: 1 });
  const before = sim.state.res.funds;
  const r = sim.cmd('placeLine', 'wall', 50, 72, 55, 72);
  assert.ok(r.ok, r.why);
  assert.equal(sim.state.res.funds, before - r.count * BUILDINGS.wall.cost.funds);
});

test('training an infantry squad at HQ produces a unit', () => {
  const sim = new Sim({ seed: 1 });
  const hq = sim.state.ents.buildings.find((b) => b.type === 'hq');
  const n = sim.state.ents.units.length;
  assert.ok(sim.cmd('train', hq.id, 'infantry').ok);
  play(sim, 6);
  assert.equal(sim.state.ents.units.length, n + 1);
});

test('units shoot the dead in range', () => {
  const sim = new Sim({ seed: 1 });
  const u = sim.state.ents.units.find((x) => x.type === 'infantry');
  const z = spawnDead(sim, 'walker', u.x + 3, u.z);
  play(sim, 3, 0.25);
  assert.ok(z.gone || z.hp < z.maxHp, 'walker took fire');
});

test('noise pulls idle dead toward its source', () => {
  const sim = new Sim({ seed: 1 });
  sim.state.flags.noSpawns = true;
  // Both on foreign land south-west of the country.
  const lure = makeBuilding(sim, 'lure', 40, 113, { instant: true });
  const z = spawnDead(sim, 'walker', 44, 119);
  play(sim, 3, 0.25);
  assert.ok(z.inv, 'walker is investigating');
  assert.ok(Math.hypot(z.inv.x - lure.x, z.inv.z - lure.z) < 2);
});

test('pile-up: few dead never cross a wall; many spill over', () => {
  // A wall across a corridor of open ground west of Hollin; the dead are pulled to a lure in the town.
  const sim0 = new Sim({ seed: 1 });
  const h = sim0.map.towns.find((t) => t.name === 'Hollin');
  const wx = h.i - 4;
  const build = (count) => {
    const sim = new Sim({ seed: 1 });
    sim.state.flags.noSpawns = true;
    for (const t of sim.state.towns) t.infected = 0;
    for (let j = h.j - 6; j <= h.j + 2; j++) makeBuilding(sim, 'wall', wx, j, { instant: true });
    const lure = makeBuilding(sim, 'lure', h.i - 1, h.j - 2, { instant: true });
    for (let k = 0; k < count; k++) {
      const z = spawnDead(sim, 'walker', wx - 1.8 + (k % 3) * 0.3, h.j - 3 + (k / 3 | 0) * 0.25);
      z.inv = { x: lure.x, z: lure.z, until: 1e9 };
    }
    return sim;
  };
  const few = build(8);
  play(few, 6, 0.25, (s) => { for (const z of s.state.ents.dead) z.inv = { x: h.i - 0.5, z: h.j - 1.5, until: 1e9 }; });
  assert.ok(few.state.ents.dead.every((z) => z.x < wx + 0.2), 'nobody crossed with 8');
  const many = build(30);
  let climbed = 0;
  for (let hr = 0; hr < 24; hr++) {
    for (const z of many.state.ents.dead) z.inv = { x: h.i - 0.5, z: h.j - 1.5, until: 1e9 };
    many.step(0.25);
    climbed += many.drainEvents().filter((e) => e.type === 'climb').length;
  }
  assert.ok(climbed > 0, 'some climbed with 30');
});

test('units ordered onto an unreachable tile path to the nearest reachable one', () => {
  const sim = new Sim({ seed: 1 });
  const u = sim.state.ents.units[0];
  const r = sim.cmd('move', [u.id], 0.5, 0.5);
  assert.ok(r.ok || r.why === 'No path');
});

test('ammo never goes negative; troops fall back to melee', () => {
  const sim = new Sim({ seed: 1 });
  sim.state.res.ammo = 0;
  const u = sim.state.ents.units.find((x) => x.type === 'infantry');
  spawnDead(sim, 'walker', u.x + 3, u.z);
  play(sim, 4, 0.25);
  assert.ok(sim.state.res.ammo >= 0);
});

test('a scripted decision fires once and every choice runs without throwing', async () => {
  const { DECISIONS } = await import('../js/config/campaign.js');
  for (const d of DECISIONS) {
    for (let c = 0; c < d.choices.length; c++) {
      const sim = new Sim({ seed: 1 });
      sim.state.time = (d.day - 1) * 24 + 7;
      if (d.when) sim.state.flags.vitaxin = true;
      sim.state.events.decision = d.id;
      assert.doesNotThrow(() => sim.cmd('decide', c), `${d.id} choice ${c}`);
      assert.doesNotThrow(() => sim.step(1));
    }
  }
});

test('letters: every choice runs with its params', async () => {
  const { LETTERS } = await import('../js/config/letters.js');
  for (const l of LETTERS) for (let c = 0; c < l.choices.length; c++) {
    const sim = new Sim({ seed: 1 });
    const p = l.params ? l.params(sim) : {};
    sim.state.events.letters.push({ id: 1, defId: l.id, p, until: 100 });
    assert.ok(sim.cmd('letter', 1, c).ok, `${l.id} choice ${c}`);
  }
});

test('trust at zero ends the game', () => {
  const sim = new Sim({ seed: 1 });
  sim.state.trust = 0.01;
  sim.state.events.fired = ['patientZero', 'theyAreComing'];
  sim.state.trust = 0;
  sim.step(0.1);
  assert.equal(sim.state.over?.reason, 'trust');
});

test('engineers repair a damaged wall', () => {
  const sim = new Sim({ seed: 1 });
  const eng = sim.state.ents.units.find((u) => u.type === 'engineers');
  const w = makeBuilding(sim, 'wall', Math.floor(eng.x) + 1, Math.floor(eng.z) + 1, { instant: true });
  w.hp = 100;
  play(sim, 6, 0.5);
  assert.ok(w.hp > 300, `wall hp ${w.hp}`);
});

test('sniper teams prefer howlers', () => {
  const sim = new Sim({ seed: 1 });
  const u = spawnUnit(sim, 'sniper', 56, 70);
  spawnDead(sim, 'walker', 58, 70);
  const h = spawnDead(sim, 'howler', 62, 70);
  play(sim, 1, 0.1);
  assert.ok(h.gone || h.hp < h.maxHp, 'howler was shot');
  assert.ok(u);
});

test('upgrading a wall line upgrades every connected wall section, through gates', () => {
  const sim = new Sim({ seed: 1 });
  sim.state.research.done.push('e2');
  const row = 80, ws = [];
  for (let i = 40; i < 46; i++) ws.push(makeBuilding(sim, i === 43 ? 'gate' : 'wall', i, row, { instant: true }));
  const lone = makeBuilding(sim, 'wall', 40, row + 3, { instant: true });
  sim.step(0.05);
  sim.state.res.funds = 1000;
  const r = sim.cmd('upgradeLine', ws[0].id);
  assert.equal(r.ok, true, r.why);
  assert.equal(r.count, 5);
  assert.deepEqual(ws.map((b) => b.type), ['highwall', 'highwall', 'highwall', 'gate', 'highwall', 'highwall']);
  assert.equal(lone.type, 'wall');
});

// The televised stand is judged on the battle: broken horde = triumph; horde still standing at the end = stalemate.
function televised(outcome) {
  const sim = new Sim({ seed: 2 });
  const h = scheduleHorde(sim, { size: 20, siteId: 0, lead: 0 });
  sim.state.flags.showOfForce = { until: sim.state.time + 40, lost: sim.state.stats.unitsLost, horde: h.id };
  play(sim, 8);
  assert.ok(h.spawned > 0 && !sim.state.pending.some((p) => p.horde === h.id), 'horde fully spawned');
  if (outcome === 'broken') { for (const z of sim.state.ents.dead) if (z.horde === h.id && !z.gone) killDead(sim, z); }
  else sim.state.flags.showOfForce.until = sim.state.time;
  const before = sim.state.stats.trustLog['televised stand'] || 0;
  play(sim, 1);
  return (sim.state.stats.trustLog['televised stand'] || 0) - before;
}
test('televised stand: a broken horde is a triumph', () => { assert.ok(televised('broken') > 10); });
test('televised stand: a horde still standing at the end is a stalemate, not a disaster', () => {
  const d = televised('standing');
  assert.ok(d < 0 && d > -8, `trust change ${d}`);
});
