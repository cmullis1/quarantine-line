// Alert weights and the alerts added for noticing what happens (spec D): under attack, building destroyed,
// government in danger, a cabinet promise running out of time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../js/sim/sim.js';
import { makeBuilding, spawnDead, spawnUnit, spawnRefugee } from '../js/sim/entities.js';
import { ALERT_WEIGHT, ALERT_RULES, weightOf } from '../js/config/alerts.js';
import { UNITS } from '../js/config/units.js';

const alertsOf = (events, kind) => events.filter((e) => e.type === 'alert' && e.kind === kind);
const play = (sim, hours, every = 0.5) => {
  const out = [];
  for (let h = 0; h < hours - 1e-9; h += every) {
    if (sim.state.events.decision) sim.cmd('decide', 0);
    sim.step(every);
    out.push(...sim.drainEvents());
  }
  return out;
};

test('alert weights: the spec\'s critical and important kinds; everything else is routine', () => {
  for (const k of ['hordeArrived', 'breakout', 'fall', 'hq', 'hqAttack', 'danger']) assert.equal(weightOf(k), 'critical', k);
  for (const k of ['hordeContact', 'outbreak', 'destroyed', 'unitLost', 'pileup', 'starving', 'ammo', 'deadline', 'underAttack']) {
    assert.equal(weightOf(k), 'important', k);
  }
  for (const k of ['built', 'trained', 'tech', 'law', 'day', 'request', 'promoted', 'hordeRumour', 'nonsense']) assert.equal(weightOf(k), 'routine', k);
  assert.ok(Object.values(ALERT_WEIGHT).every((w) => w === 'critical' || w === 'important'));
});

test('every alert carries its weight, merged repeats too', () => {
  const sim = new Sim({ seed: 1 });
  sim.alert('breakout', 'BREAKOUT in X', 10, 10, 'bad');
  sim.alert('built', 'Farm complete.', 10, 10, 'good');
  sim.alert('built', 'Farm complete.', 10, 10, 'good');
  const ev = sim.drainEvents().filter((e) => e.type === 'alert');
  assert.deepEqual(ev.map((e) => e.weight), ['critical', 'routine', 'routine']);
  assert.ok(ev[2].merged);
  assert.equal(sim.state.log[1].weight, 'critical');
});

test('a wall clawed for 12 game hours by many dead raises at most two "under attack" alerts for its area', () => {
  const sim = new Sim({ seed: 1, mode: 'sandbox' });
  const hq = sim.state.ents.buildings.find((b) => b.type === 'hq');
  // A box of unbreakable high walls inside one map square, the dead shut inside it.
  const c = ALERT_RULES.attackCell;
  const i0 = Math.floor((hq.x + 20) / c) * c + 3, j0 = Math.floor(hq.z / c) * c + 3;
  const walls = [];
  for (let d = 0; d < 6; d++) for (const [i, j] of [[i0 + d, j0], [i0 + d, j0 + 5], [i0, j0 + d], [i0 + 5, j0 + d]]) {
    if (sim.buildingAt(i, j)) continue;
    const b = makeBuilding(sim, 'highwall', i, j, { instant: true });
    b.hp = b.maxHp = 1e9;
    walls.push(b);
  }
  for (let k = 0; k < 60; k++) spawnDead(sim, 'walker', i0 + 1.5 + (k % 3), j0 + 1.5 + (Math.floor(k / 3) % 3));
  const events = play(sim, 12);
  assert.ok(walls.filter((b) => b.hitT).length > 0, 'the dead clawed the walls');
  const square = (a) => Math.floor(a.x / c) === Math.floor((i0 + 1) / c) && Math.floor(a.z / c) === Math.floor((j0 + 1) / c);
  const hits = alertsOf(events, 'underAttack').filter(square);
  assert.ok(hits.length >= 1 && hits.length <= 2, `${hits.length} under-attack alerts: ${hits.map((a) => a.text).join(' | ')}`);
  assert.match(hits[0].text, /^High Wall under attack /);
  assert.equal(hits[0].weight, 'important');
});

test('under attack: throttled per map square in game time, saved with the game; squads named, refugees not', () => {
  const sim = new Sim({ seed: 1 });
  const c = ALERT_RULES.attackCell;
  sim.underAttack(5, 5, 'Farm');
  sim.underAttack(6, 7, 'Farm');
  sim.underAttack(5 + c, 5, 'Farm');
  assert.equal(alertsOf(sim.drainEvents(), 'underAttack').length, 2, 'one per square');
  const copy = Sim.deserialize(sim.serialize());
  copy.underAttack(5, 5, 'Farm');
  assert.equal(alertsOf(copy.drainEvents(), 'underAttack').length, 0, 'the throttle survives a save');
  copy.state.time += ALERT_RULES.attackHours;
  copy.underAttack(5, 5, 'Farm');
  assert.equal(alertsOf(copy.drainEvents(), 'underAttack').length, 1, 'and lifts after its hours');

  const live = new Sim({ seed: 1, mode: 'sandbox' });
  const hq = live.state.ents.buildings.find((b) => b.type === 'hq');
  const u = spawnUnit(live, 'infantry', hq.x + 30, hq.z + 0.5);
  u.hp = u.maxHp = 1e9;
  const z = spawnDead(live, 'walker', u.x + 0.4, u.z);
  z.rise = 0;
  const ev = play(live, 1, 0.05);
  const hit = alertsOf(ev, 'underAttack');
  assert.ok(hit.some((a) => a.text.startsWith(`${UNITS.infantry.name} under attack`)), hit.map((a) => a.text).join(' | ') || 'none');

  const camp = new Sim({ seed: 1, mode: 'sandbox' });
  const r = spawnRefugee(camp, 0);
  r.path = null; r.mode = 'wait'; r.hp = 1e9;
  const d = spawnDead(camp, 'walker', r.x + 0.4, r.z);
  d.rise = 0;
  const near = (a) => Math.hypot(a.x - r.x, a.z - r.z) < 3;
  assert.equal(alertsOf(play(camp, 1, 0.05), 'underAttack').filter(near).length, 0, "refugees are not the player's");
  assert.ok(r.hitT, 'the dead did bite the refugee');
});

test('a destroyed building raises "<Name> destroyed"; a demolished one raises nothing', () => {
  const sim = new Sim({ seed: 1 });
  const hq = sim.state.ents.buildings.find((b) => b.type === 'hq');
  const farm = makeBuilding(sim, 'farm', Math.floor(hq.x) + 8, Math.floor(hq.z) + 8, { instant: true });
  const other = makeBuilding(sim, 'farm', Math.floor(hq.x) - 10, Math.floor(hq.z) + 8, { instant: true });
  sim.drainEvents();
  farm.hp = 0;
  sim.step(0.05);
  const gone = alertsOf(sim.drainEvents(), 'destroyed');
  assert.deepEqual(gone.map((a) => a.text), ['Farm destroyed']);
  assert.equal(gone[0].weight, 'important');
  assert.ok(sim.cmd('demolish', other.id).ok);
  sim.step(0.05);
  assert.equal(alertsOf(sim.drainEvents(), 'destroyed').length, 0);
});

test('government in danger: once each time trust or order falls below the line', () => {
  const sim = new Sim({ seed: 1 });
  const at = (trust, order) => { sim.state.trust = trust; sim.state.order = order; sim.step(0.05); return alertsOf(sim.drainEvents(), 'danger'); };
  assert.equal(at(40, 40).length, 0);
  const first = at(ALERT_RULES.danger - 1, 40);
  assert.equal(first.length, 1);
  assert.equal(first[0].weight, 'critical');
  assert.match(first[0].text, /trust/);
  assert.equal(at(ALERT_RULES.danger - 2, 40).length, 0, 'not again while it stays low');
  assert.equal(at(ALERT_RULES.danger + 1, 40).length, 0);
  assert.equal(at(ALERT_RULES.danger - 1, 40).length, 0, 'hovering at the line does not repeat it');
  assert.equal(at(ALERT_RULES.rearm + 1, ALERT_RULES.danger - 1).length, 1, 'order has its own line');
  assert.equal(at(ALERT_RULES.danger - 1, ALERT_RULES.danger - 1).length, 1, 'back clear of the line, then down again');
});

test('a promise still unmet near its deadline raises one warning', () => {
  const sim = new Sim({ seed: 1 });
  const cab = sim.state.cabinet;
  cab.nextAt = 1e9;
  cab.requests.push({ id: sim.newId(), defId: 'infantry', minister: 'defence', p: { base: 999 }, status: 'accepted', offeredAt: sim.state.time, until: sim.state.time + ALERT_RULES.deadlineHours + 1 });
  assert.equal(alertsOf(play(sim, 0.5, 0.05), 'deadline').length, 0);
  const warn = alertsOf(play(sim, 3, 0.05), 'deadline');
  assert.equal(warn.length, 1);
  assert.match(warn[0].text, /left on your promise to General Arkov/);
});
