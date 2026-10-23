// What the hover card says about the thing under the cursor: a building's name, HP, status and output, a squad's
// status, a town's people and state, and nothing once the thing is gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../js/sim/sim.js';
import { spawnUnit, makeBuilding, removeBuilding } from '../js/sim/entities.js';
import { canPlace } from '../js/sim/commands.js';
import { BUILDINGS } from '../js/config/buildings.js';
import { UNITS } from '../js/config/units.js';
import { buildingOutput } from '../js/sim/systems/economy.js';
import { squadStatus } from '../js/ui/overview.js';
import { hoverInfo } from '../js/ui/hovercard.js';

// n buildings of a type in rings around the HQ: finished, or (instant false) just placed.
function build(sim, type, n, instant = true) {
  const hq = sim.state.ents.buildings.find((b) => b.type === 'hq');
  const out = [];
  for (let r = 4; r < 40 && out.length < n; r++) for (let a = 0; a < 32 && out.length < n; a++) {
    const i = Math.round(hq.x + Math.cos((a / 32) * Math.PI * 2) * r), j = Math.round(hq.z + Math.sin((a / 32) * Math.PI * 2) * r);
    if (canPlace(sim, type, i, j, { free: true }).ok) out.push(makeBuilding(sim, type, i, j, { instant }));
  }
  assert.equal(out.length, n);
  return out;
}

const card = (sim, kind, id) => hoverInfo(sim, { kind, id });

test('nothing under the cursor, or a thing that is gone, has no card', () => {
  const sim = new Sim({ seed: 1 });
  assert.equal(hoverInfo(sim, null), null);
  assert.equal(card(sim, 'building', 99999), null);
  assert.equal(card(sim, 'unit', 99999), null);
  assert.equal(card(sim, 'town', 999), null);
  const [f] = build(sim, 'factory', 1);
  removeBuilding(sim, f, true);
  assert.equal(card(sim, 'building', f.id), null, 'a destroyed building');
  const u = sim.state.ents.units[0];
  u.hp = 0;
  assert.equal(card(sim, 'unit', u.id), null, 'a squad at 0 HP is being removed');
});

test('a staffed producer: name, HP, working, and what it makes per hour', () => {
  const sim = new Sim({ seed: 1 });
  const farm = sim.state.ents.buildings.find((b) => b.type === 'farm');
  farm.hp = farm.maxHp - 10.4;
  const c = card(sim, 'building', farm.id);
  assert.deepEqual([c.title, c.icon, c.hp, c.maxHp, c.status, c.tone], ['Farm', BUILDINGS.farm.icon, Math.ceil(farm.hp), Math.round(farm.maxHp), 'Working', '']);
  assert.deepEqual(c.output, buildingOutput(sim, farm));
  assert.ok(c.output.food > 0);
  const hq = card(sim, 'building', sim.state.ents.buildings.find((b) => b.type === 'hq').id);
  assert.deepEqual([hq.title, hq.status, Object.keys(hq.output)], ['National HQ', 'Working', ['funds']]);
});

test('building status: under construction with progress, idle for want of workers, damaged, switched off', () => {
  const sim = new Sim({ seed: 1 });
  for (const t of sim.state.towns) t.pop = 0;
  sim.state.towns[0].pop = 3e5; // 4.5 workers: the farm and one factory are staffed, the next factory is not
  const [lab] = build(sim, 'lab', 1, false);
  lab.progress = 0.437;
  const l = card(sim, 'building', lab.id);
  assert.deepEqual([l.status, l.tone, l.output], ['Under construction 43%', 'warn', {}]);
  const [f1, f2] = build(sim, 'factory', 2);
  assert.equal(card(sim, 'building', f1.id).status, 'Working');
  const idle = card(sim, 'building', f2.id);
  assert.deepEqual([idle.status, idle.tone, idle.output], ['Idle: no workers', 'bad', {}]);
  f1.hp = f1.maxHp * 0.4;
  const dmg = card(sim, 'building', f1.id);
  assert.deepEqual([dmg.status, dmg.tone], ['Damaged', 'bad']);
  assert.ok(dmg.output.funds > 0, 'a damaged producer still produces');
  const [tower, spot] = build(sim, 'tower', 2);
  assert.deepEqual(card(sim, 'building', tower.id).output, {}, 'a tower makes nothing');
  // The lure is locked behind research, so it takes a tower's spot.
  removeBuilding(sim, spot);
  const lure = makeBuilding(sim, 'lure', spot.i, spot.j, { instant: true });
  assert.equal(card(sim, 'building', lure.id).status, 'Working');
  lure.on = false;
  assert.deepEqual([card(sim, 'building', lure.id).status, card(sim, 'building', lure.id).tone], ['Switched off', 'warn']);
});

test('a squad: its type, HP and what it is doing', () => {
  const sim = new Sim({ seed: 1 });
  const u = spawnUnit(sim, 'infantry', 60, 60);
  u.hp = u.maxHp * 0.55 - 0.3;
  const c = card(sim, 'unit', u.id);
  assert.deepEqual([c.title, c.icon, c.hp, c.maxHp, c.status, c.output], [UNITS.infantry.name, UNITS.infantry.icon, Math.ceil(u.hp), Math.round(u.maxHp), squadStatus(u), null]);
  u.order = 'hold';
  assert.equal(card(sim, 'unit', u.id).status, 'Holding');
});

test('a town: its name, people and state', () => {
  const sim = new Sim({ seed: 1 }), s = sim.state, m = sim.map;
  const cap = m.towns.findIndex((t) => t.capital);
  const c = card(sim, 'town', cap);
  assert.deepEqual([c.title, c.pop, c.status, c.tone, c.hp], [`★ ${m.towns[cap].name}`, s.towns[cap].pop, 'Safe', '', null]);
  const other = m.towns.findIndex((t) => !t.capital);
  assert.equal(card(sim, 'town', other).title, m.towns[other].name);
  s.towns[other].alerted = true;
  assert.deepEqual([card(sim, 'town', other).status, card(sim, 'town', other).tone], ['Outbreak', 'bad']);
  s.towns[other].quarantine = true;
  assert.equal(card(sim, 'town', other).status, 'Quarantined');
  s.towns[other].sacrifice = true;
  assert.equal(card(sim, 'town', other).status, 'Sacrifice zone');
  s.towns[other].status = 'fallen';
  const fallen = card(sim, 'town', other);
  assert.deepEqual([fallen.status, fallen.tone, fallen.pop], ['Fallen', 'bad', 0]);
});
