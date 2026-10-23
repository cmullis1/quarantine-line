// The data behind the map overlays (O cycles them): the modes, the economy plates, the defence rings at the range
// a weapon fires now, the wall HP bands, and what a town's specialty makes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../js/sim/sim.js';
import { spawnUnit, makeBuilding } from '../js/sim/entities.js';
import { canPlace } from '../js/sim/commands.js';
import { WEAPONS } from '../js/config/buildings.js';
import { UNITS } from '../js/config/units.js';
import { SPECIALTIES } from '../js/config/world.js';
import { COMBAT } from '../js/config/balance.js';
import { workforce, economySystem, townOutputFactor } from '../js/sim/systems/economy.js';
import { effectiveRange } from '../js/sim/systems/combat.js';
import { OVERLAY_MODES, PRODUCER_COLORS, economyPlates, defenceRings, hpBand, townSpecialty } from '../js/ui/overview.js';

// One building of a type in rings around the HQ, at least r0 tiles out: finished, or (instant false) just placed.
function place(sim, type, r0 = 4, instant = true) {
  const hq = sim.state.ents.buildings.find((b) => b.type === 'hq');
  for (let r = r0; r < 40; r++) for (let a = 0; a < 32; a++) {
    const i = Math.round(hq.x + Math.cos((a / 32) * Math.PI * 2) * r), j = Math.round(hq.z + Math.sin((a / 32) * Math.PI * 2) * r);
    if (canPlace(sim, type, i, j, { free: true }).ok) return makeBuilding(sim, type, i, j, { instant });
  }
  throw new Error(`no room for a ${type}`);
}

test('O cycles none, infection, economy, defence', () => {
  assert.deepEqual(OVERLAY_MODES, ['none', 'infection', 'economy', 'defence']);
});

test('economy plates: one per producer in its type\'s colour, idle ones flagged; nothing else gets one', () => {
  const sim = new Sim({ seed: 1 });
  const farm = place(sim, 'farm'), mun = place(sim, 'munitions'), lab = place(sim, 'lab'), site = place(sim, 'factory', 4, false);
  place(sim, 'tower'); place(sim, 'wall');
  let last = null;
  while (workforce(sim).need <= workforce(sim).have) last = place(sim, 'factory');
  last = place(sim, 'factory');
  economySystem(sim, 0);
  assert.equal(last.idle, true, 'the factory past the workforce stands idle');
  const plates = economyPlates(sim);
  const producers = sim.state.ents.buildings.filter((b) => PRODUCER_COLORS[b.type] && b.type !== 'idle');
  assert.deepEqual(plates.map((p) => p.id), producers.map((b) => b.id), 'every producer, in building order, and nothing else');
  for (const p of plates) {
    const b = sim.byId(p.id);
    assert.deepEqual([p.type, p.x, p.z, p.size, p.color, p.idle], [b.type, b.x, b.z, b.size, PRODUCER_COLORS[b.type], !!b.idle]);
  }
  const by = (b) => plates.find((p) => p.id === b.id);
  assert.equal(by(farm).color, PRODUCER_COLORS.farm);
  assert.equal(by(mun).color, PRODUCER_COLORS.munitions);
  assert.equal(by(lab).color, PRODUCER_COLORS.lab);
  assert.equal(by(site).idle, false, 'a factory still being built is not idle');
  assert.equal(by(last).idle, true);
  assert.deepEqual(plates.filter((p) => p.idle).map((p) => p.id), sim.state.ents.buildings.filter((b) => b.idle).map((b) => b.id));
});

test('defence rings: finished towers, checkpoints, the HQ and artillery, at the range they fire at now', () => {
  const sim = new Sim({ seed: 1 }), s = sim.state;
  s.time = 12; // noon on day 1: no rain or fog yet
  s.research.done.push('k4');
  const tower = place(sim, 'tower', 6), cp = place(sim, 'checkpoint', 8), art = place(sim, 'artillery', 10);
  const unbuilt = place(sim, 'tower', 12, false);
  const hq = s.ents.buildings.find((b) => b.type === 'hq');
  const ring = (b) => defenceRings(sim).find((r) => r.id === b.id);
  assert.equal(ring(unbuilt), undefined, 'a tower still being built covers nothing');
  assert.deepEqual(defenceRings(sim).map((r) => r.id).sort((a, b) => a - b), [hq.id, tower.id, cp.id, art.id].sort((a, b) => a - b));
  assert.deepEqual([ring(tower).r, ring(cp).r, ring(hq).r], [WEAPONS.tower.range, WEAPONS.checkpoint.range, WEAPONS.hq.range]);
  assert.deepEqual([ring(tower).x, ring(tower).z, ring(tower).min, ring(tower).kind], [tower.x, tower.z, 0, 'gun']);
  assert.deepEqual([ring(art).r, ring(art).min, ring(art).kind], [WEAPONS.artillery.range, WEAPONS.artillery.minRange, 'artillery']);

  // Night shortens the guns (not under a floodlight); artillery keeps its reach, as the sim fires it.
  s.time = 22;
  assert.ok(sim.night);
  assert.equal(ring(tower).r, WEAPONS.tower.range * COMBAT.nightRange);
  assert.equal(ring(tower).r, effectiveRange(sim, 'tower', tower.x, tower.z));
  assert.equal(ring(art).r, WEAPONS.artillery.range);
  makeBuilding(sim, 'floodlight', Math.floor(tower.x) + 1, Math.floor(tower.z), { instant: true });
  assert.equal(ring(tower).r, WEAPONS.tower.range, 'a floodlit tower keeps its full range at night');
});

test('defence rings: a unit that sets up (MG teams) gets one only once it has set up', () => {
  const sim = new Sim({ seed: 1 }), s = sim.state;
  s.time = 12;
  UNITS.testmg = { ...UNITS.infantry, weapon: 'mg', setup: 1 };
  try {
    const hq = s.ents.buildings.find((b) => b.type === 'hq');
    const mg = spawnUnit(sim, 'testmg', hq.x + 3, hq.z + 3);
    const inf = spawnUnit(sim, 'infantry', hq.x - 3, hq.z + 3);
    inf.setup = 5;
    const ring = () => defenceRings(sim).find((r) => r.id === mg.id);
    assert.equal(ring(), undefined, 'just arrived');
    mg.setup = 0.5;
    assert.equal(ring(), undefined, 'still setting up');
    mg.setup = 1;
    assert.deepEqual([ring().x, ring().z, ring().r, ring().kind], [mg.x, mg.z, effectiveRange(sim, 'mg', mg.x, mg.z), 'gun']);
    assert.equal(defenceRings(sim).find((r) => r.id === inf.id), undefined, 'units that never set up get no ring');
  } finally {
    delete UNITS.testmg;
  }
});

test('defence rings: a set-up MG team covers its firing arc; a standing mortar team its 3–12 ring', () => {
  const sim = new Sim({ seed: 1 }), s = sim.state;
  s.time = 12;
  const hq = s.ents.buildings.find((b) => b.type === 'hq');
  const mg = spawnUnit(sim, 'mg', hq.x + 3, hq.z + 3);
  const mortar = spawnUnit(sim, 'mortar', hq.x - 3, hq.z + 3);
  const ring = (u) => defenceRings(sim).find((r) => r.id === u.id);
  assert.equal(ring(mg), undefined, 'not set up yet');
  mg.setup = 1; mg.rot = 0.7;
  assert.deepEqual([ring(mg).r, ring(mg).kind, ring(mg).arc, ring(mg).rot], [effectiveRange(sim, 'hmg', mg.x, mg.z), 'gun', UNITS.mg.arc, 0.7]);
  assert.deepEqual([ring(mortar).x, ring(mortar).z, ring(mortar).r, ring(mortar).min, ring(mortar).kind], [mortar.x, mortar.z, WEAPONS.mortar.range, WEAPONS.mortar.minRange, 'artillery']);
  mortar.moving = true;
  assert.equal(ring(mortar), undefined, 'a mortar on the move fires at nothing');
});

test('wall HP bands follow the HP bar: green above 60%, amber above 30%, red below', () => {
  assert.deepEqual([1, 0.61, 0.6, 0.31, 0.3, 0.05, 0].map(hpBand), [0, 0, 1, 1, 2, 2, 2]);
});

test('town specialty: its icon and what it makes per hour at the town\'s output factor, or stopped', () => {
  const sim = new Sim({ seed: 1 }), s = sim.state, m = sim.map;
  s.towns[0].pop = s.towns[0].pop0 * 0.5;
  for (const t of s.towns) {
    const spec = SPECIALTIES[m.towns[t.id].specialty], f = townOutputFactor(sim, t), sp = townSpecialty(sim, t);
    assert.equal(sp.icon, spec.icon);
    assert.equal(sp.factor, f);
    assert.deepEqual(sp.output, Object.fromEntries(Object.entries(spec.produce).map(([k, v]) => [k, v * f])));
  }
  assert.equal(townSpecialty(sim, s.towns[0]).factor, 0.5);
  const q = s.towns.find((t) => Object.keys(SPECIALTIES[m.towns[t.id].specialty].produce).length);
  q.quarantine = true;
  assert.deepEqual([townSpecialty(sim, q).factor, townSpecialty(sim, q).output], [0, {}], 'a quarantined town makes nothing');
});
