// The data behind the command tabs: squad status, where a squad is, the per-type summary, the squad list,
// training queues and army upkeep (FORCES); the workers bar, producers, flows and towns (ECONOMY).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../js/sim/sim.js';
import { spawnUnit, makeBuilding, removeBuilding } from '../js/sim/entities.js';
import { canPlace } from '../js/sim/commands.js';
import { BUILDINGS } from '../js/config/buildings.js';
import { UNITS } from '../js/config/units.js';
import { SPECIALTIES } from '../js/config/world.js';
import { ECONOMY } from '../js/config/balance.js';
import { computeRates, workforce, buildingOutput, townOutputFactor, STAFF_ORDER, economySystem } from '../js/sim/systems/economy.js';
import { squadStatus, placeName, forcesSummary, squadList, trainingList, armyUpkeep, PRODUCER_COLORS, workerSegments, producerRows, flows, townRows, buildingMarker } from '../js/ui/overview.js';

// A fresh game with no troops at all.
function emptyArmy(seed = 1) {
  const sim = new Sim({ seed });
  for (const u of sim.state.ents.units) sim.index.delete(u.id);
  sim.state.ents.units.length = 0;
  return sim;
}

const dist = (a, x, z) => Math.hypot(a.x - x, a.z - z);

// The first tile centre that satisfies fn, scanning the whole map.
function findTile(sim, fn) {
  for (let j = 0; j < sim.N; j++) for (let i = 0; i < sim.N; i++) if (fn(i + 0.5, j + 0.5, sim.map.owner[j * sim.N + i])) return [i + 0.5, j + 0.5];
  return null;
}

test('squad status follows its orders: hold, then fighting, then moving, then setting up', () => {
  const sim = emptyArmy();
  const u = spawnUnit(sim, 'infantry', 60, 60);
  assert.equal(squadStatus(u), 'Idle');
  u.path = [[1, 1]];
  assert.equal(squadStatus(u), 'Moving');
  u.path = [];
  assert.equal(squadStatus(u), 'Idle', 'an empty path is not moving');
  u.target = 5;
  assert.equal(squadStatus(u), 'Fighting');
  u.order = 'hold';
  assert.equal(squadStatus(u), 'Holding');
  const mg = spawnUnit(sim, 'infantry', 60, 60);
  mg.setup = 0.4;
  assert.equal(squadStatus(mg), 'Setting up');
  mg.setup = 1;
  assert.equal(squadStatus(mg), 'Idle');
});

test('place names: in a town, near the nearest town, at a crossing, abroad', () => {
  const sim = emptyArmy(), m = sim.map;
  const cap = m.towns.find((t) => t.capital);
  assert.equal(placeName(sim, cap.x, cap.z), `in ${cap.name}`);

  const farCross = (x, z) => m.crossings.every((c) => dist(c, x, z) > 6);
  const home = findTile(sim, (x, z, own) => own && farCross(x, z) && m.towns.every((t) => dist(t, x, z) > t.r + 3));
  const nearest = [...m.towns].sort((a, b) => dist(a, ...home) - dist(b, ...home))[0];
  assert.equal(placeName(sim, ...home), `near ${nearest.name}`);

  const c = m.crossings[0];
  assert.equal(placeName(sim, c.x + 1, c.z), `${m.sites[c.siteId].name} crossing`);

  const foreign = findTile(sim, (x, z, own) => !own && farCross(x, z));
  assert.equal(placeName(sim, ...foreign), 'abroad');
  assert.equal(placeName(sim, -6, -6), 'abroad', 'off the map');
  assert.equal(placeName(sim, sim.N + 3, 10), 'abroad', 'off the map');
});

test('an empty army has an empty summary, no squads and no upkeep', () => {
  const sim = emptyArmy();
  assert.deepEqual(forcesSummary(sim), []);
  assert.deepEqual(squadList(sim, {}), []);
  assert.deepEqual(trainingList(sim), []);
  assert.equal(armyUpkeep(sim), 0);
});

test('the summary has one row per type in UNITS order, with summed HP, idle and queued counts', () => {
  const sim = emptyArmy();
  const hq = sim.state.ents.buildings.find((b) => b.type === 'hq');
  const g = spawnUnit(sim, 'gunship', hq.x, hq.z);
  const a = spawnUnit(sim, 'infantry', hq.x + 2, hq.z);
  const b = spawnUnit(sim, 'infantry', hq.x + 3, hq.z);
  a.hp = 30;
  b.order = 'hold';
  hq.queue.push('infantry');
  let spot = null;
  for (let r = 4; r < 30 && !spot; r++) for (let q = 0; q < 32 && !spot; q++) {
    const i = Math.round(hq.x + Math.cos((q / 32) * Math.PI * 2) * r), j = Math.round(hq.z + Math.sin((q / 32) * Math.PI * 2) * r);
    if (canPlace(sim, 'barracks', i, j, { free: true }).ok) spot = [i, j];
  }
  const bar = makeBuilding(sim, 'barracks', ...spot, { instant: true });
  bar.queue.push('sniper');

  const rows = forcesSummary(sim);
  assert.deepEqual(rows.map((r) => r.type), ['infantry', 'sniper', 'gunship']);
  const inf = rows[0];
  assert.equal(inf.name, 'Infantry Squad');
  assert.equal(inf.icon, '⚔️');
  assert.equal(inf.count, 2);
  assert.equal(inf.hp, 30 + 80);
  assert.equal(inf.maxHp, 160);
  assert.equal(inf.idle, 1, 'the holding squad is not idle');
  assert.equal(inf.queued, 1);
  assert.deepEqual({ count: rows[1].count, queued: rows[1].queued, hp: rows[1].hp, maxHp: rows[1].maxHp }, { count: 0, queued: 1, hp: 0, maxHp: 0 });
  assert.equal(rows[2].count, 1);
  assert.equal(rows[2].hp, g.maxHp);
});

test('squads are numbered per type in id order, with place, status and the lowest control group', () => {
  const sim = emptyArmy(), cap = sim.map.towns.find((t) => t.capital);
  const h = spawnUnit(sim, 'hazmat', cap.x, cap.z);
  const i1 = spawnUnit(sim, 'infantry', cap.x, cap.z);
  const i2 = spawnUnit(sim, 'infantry', cap.x + 1, cap.z);
  const s1 = spawnUnit(sim, 'sniper', cap.x, cap.z);
  i2.order = 'hold';
  i1.vet = 2;
  const list = squadList(sim, { 3: [i2.id, h.id], 1: [i2.id], 7: [] });
  assert.deepEqual(list.map((s) => s.label), ['Infantry 1', 'Infantry 2', 'Quarantine 1', 'Sniper 1']);
  assert.deepEqual(list.map((s) => s.id), [i1.id, i2.id, h.id, s1.id]);
  assert.deepEqual(list.map((s) => s.group), [null, 1, 3, null]);
  assert.deepEqual(list.map((s) => s.status), ['Idle', 'Holding', 'Idle', 'Idle']);
  assert.equal(list[0].place, `in ${cap.name}`);
  assert.equal(list[0].vet, 2);
  assert.deepEqual([list[3].hp, list[3].maxHp], [45, 45]);
  assert.deepEqual(squadList(sim).map((s) => s.group), [null, null, null, null], 'groups are optional');
});

test('training lists each queue with the hours left on its current unit and the count behind it', () => {
  const sim = emptyArmy();
  const hq = sim.state.ents.buildings.find((b) => b.type === 'hq');
  hq.queue.push('infantry', 'hazmat', 'police');
  hq.trainT = 1;
  assert.deepEqual(trainingList(sim), [{ buildingId: hq.id, building: 'National HQ', unit: 'infantry', hoursLeft: 3, behind: 2 }]);
  sim.state.laws.push('mobilisation');
  assert.ok(Math.abs(trainingList(sim)[0].hoursLeft - 3 * 0.7) < 1e-9, 'mobilisation trains faster');
});

test('army upkeep is the funds per hour of every unit', () => {
  const sim = new Sim({ seed: 1 });
  // The starting force: three infantry, a quarantine team and engineers.
  assert.ok(Math.abs(armyUpkeep(sim) - (3 * 0.12 + 0.15 + 0.12)) < 1e-9);
  spawnUnit(sim, 'gunship', 60, 60);
  assert.ok(Math.abs(armyUpkeep(sim) - (3 * 0.12 + 0.15 + 0.12 + 0.7)) < 1e-9);
});

// ---- ECONOMY --------------------------------------------------------------------------------------------------

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

// Seed 1 (which starts with the HQ and one farm) with every town emptied but one of 300k people: 4.5 workers,
// room for four.
function smallCountry() {
  const sim = new Sim({ seed: 1 });
  for (const t of sim.state.towns) t.pop = 0;
  sim.state.towns[0].pop = 3e5;
  return sim;
}

const part = (parts, res, label) => parts[res].find(([l]) => l === label)?.[1];

test('producer colours: one CSS colour per producer type and for idle', () => {
  assert.deepEqual(Object.keys(PRODUCER_COLORS).sort(), ['factory', 'farm', 'idle', 'lab', 'munitions']);
  for (const c of Object.values(PRODUCER_COLORS)) assert.match(c, /^#[0-9a-f]{6}$/);
});

test('the workers bar: staffed workers per producer type in staffing order, and what idle producers want', () => {
  const sim = smallCountry();
  build(sim, 'farm', 1);
  build(sim, 'factory', 3);
  const w = workerSegments(sim);
  assert.equal(w.have, 4.5);
  assert.deepEqual(w.segments, [{ type: 'farm', used: 2 }, { type: 'munitions', used: 0 }, { type: 'lab', used: 0 }, { type: 'factory', used: 2 }]);
  assert.deepEqual(w.segments.map((g) => g.type), STAFF_ORDER);
  assert.equal(w.idleNeed, 2 * BUILDINGS.factory.workers, 'two idle factories want two workers each');
  build(sim, 'lab', 1, false);
  assert.equal(workerSegments(sim).idleNeed, 4, 'a lab still being built wants no one yet');
});

test('producer rows: count, staffed, idle and building per type; each building with its place, status and output', () => {
  const sim = smallCountry();
  build(sim, 'farm', 1);
  const before = computeRates(sim).rates.funds;
  const fs = build(sim, 'factory', 3);
  const { rates, parts } = computeRates(sim);
  const rows = producerRows(sim);
  assert.deepEqual(rows.filter((r) => r.kind === 'building').map((r) => r.type), ['farm', 'factory', 'hq'], 'only the types present, then the HQ');
  const fac = rows.find((r) => r.type === 'factory');
  assert.deepEqual([fac.name, fac.icon, fac.count, fac.staffed, fac.idle, fac.building], ['Factories', '🏭', 3, 1, 2, 0]);
  assert.ok(Math.abs(fac.output.funds - (rates.funds - before)) < 1e-9, `row ${fac.output.funds}, rate grew ${rates.funds - before}`);
  assert.equal(fac.output.funds, part(parts, 'funds', 'Factories'));
  assert.deepEqual(fac.items.map((it) => [it.id, it.status]), [[fs[0].id, 'working'], [fs[1].id, 'idle'], [fs[2].id, 'idle']], 'the oldest factory is staffed');
  assert.deepEqual(fac.items.map((it) => it.output), [{ funds: BUILDINGS.factory.produce.funds * sim.diff.income }, {}, {}]);
  assert.equal(fac.items[0].place, placeName(sim, fs[0].x, fs[0].z));
  const farms = rows.find((r) => r.type === 'farm');
  assert.deepEqual([farms.name, farms.count, farms.staffed, farms.idle], ['Farms', 2, 2, 0]);
  assert.equal(farms.output.food, part(parts, 'food', 'Farms'));
  const hq = rows.find((r) => r.type === 'hq');
  assert.deepEqual([hq.name, hq.count, hq.staffed, hq.output], ['HQ', 1, 1, { funds: part(parts, 'funds', 'HQ') }]);

  // A plant still being built, and a staffed factory below half its HP.
  build(sim, 'munitions', 1, false);
  fs[0].hp = fs[0].maxHp * 0.4;
  const later = producerRows(sim);
  assert.deepEqual(later.filter((r) => r.kind === 'building').map((r) => r.type), ['farm', 'factory', 'munitions', 'hq']);
  const mun = later.find((r) => r.type === 'munitions');
  assert.deepEqual([mun.name, mun.count, mun.staffed, mun.idle, mun.building, mun.items[0].status, mun.output], ['Munitions Plants', 1, 0, 0, 1, 'under construction', {}]);
  assert.equal(later.find((r) => r.type === 'factory').items[0].status, 'damaged');
});

test('town specialties are producer rows for every living town, at the town\'s output factor', () => {
  const sim = new Sim({ seed: 1 }), s = sim.state, m = sim.map;
  s.towns[1].quarantine = true;
  s.towns[3].status = 'fallen';
  s.towns[0].pop = s.towns[0].pop0 * 0.5;
  const { parts } = computeRates(sim);
  const rows = producerRows(sim).filter((r) => r.kind === 'specialty');
  assert.deepEqual(rows.map((r) => r.town), s.towns.filter((t) => t.status === 'ok').map((t) => t.id));
  for (const r of rows) {
    const info = m.towns[r.town], spec = SPECIALTIES[info.specialty], f = townOutputFactor(sim, s.towns[r.town]);
    assert.deepEqual([r.type, r.name, r.icon, r.factor], [info.specialty, `${info.name} ${spec.label}`, spec.icon, f]);
    assert.deepEqual(Object.keys(r.output), f > 0 ? Object.keys(spec.produce) : []);
    for (const [k, v] of Object.entries(r.output)) assert.equal(v, part(parts, k, r.name), `${r.name} ${k}`);
  }
  const cap = rows.find((r) => r.town === 0);
  assert.equal(cap.factor, 0.5);
  assert.deepEqual(rows.find((r) => r.town === 1).output, {}, 'a quarantined town produces nothing');
});

test('flows: the three biggest sources and the three biggest costs, from computeRates\' breakdown', () => {
  const sim = new Sim({ seed: 1 }), s = sim.state;
  const hq = s.ents.buildings.find((b) => b.type === 'hq');
  for (let k = 0; k < 4; k++) spawnUnit(sim, 'infantry', hq.x + k, hq.z + 2);
  build(sim, 'munitions', 1);
  build(sim, 'radar', 2);
  s.laws.push('broadcasts');
  const f = flows(sim, 'funds');
  const troops = s.ents.units.reduce((a, u) => a + UNITS[u.type].upkeep.funds, 0);
  assert.ok(f.sources.some(([l]) => l === 'taxes'), JSON.stringify(f.sources));
  assert.deepEqual(f.costs.map(([l]) => l), ['troop upkeep', 'Radar Station upkeep', 'Munitions Plant upkeep'], 'broadcasts (0.2) is the fourth cost');
  assert.ok(Math.abs(f.costs[0][1] + troops) < 1e-9);
  assert.ok(f.sources.length <= 3);
  for (let k = 1; k < f.sources.length; k++) assert.ok(f.sources[k - 1][1] >= f.sources[k][1], 'sources biggest first');
  const food = flows(sim, 'food');
  assert.deepEqual(food.costs.map(([l]) => l).sort(), ['people', 'troops']);
  // Every ammo producer on this map: the plant plus each town specialty that makes ammo (steelworks, mines).
  const ammoTowns = sim.map.towns.filter((t) => SPECIALTIES[t.specialty].produce.ammo).map((t) => `${t.name} ${SPECIALTIES[t.specialty].label}`);
  assert.deepEqual(flows(sim, 'ammo').sources.map(([l]) => l).sort(), ['Munitions Plants', ...ammoTowns].sort());
});

test('building output: what one building adds per hour, and nothing while idle, unfinished or not a producer', () => {
  const sim = smallCountry(), s = sim.state;
  build(sim, 'farm', 1);
  const fs = build(sim, 'factory', 3);
  assert.deepEqual(buildingOutput(sim, fs[0]), { funds: BUILDINGS.factory.produce.funds * sim.diff.income });
  assert.deepEqual(buildingOutput(sim, fs[2]), {}, 'an idle factory');
  assert.deepEqual(buildingOutput(sim, build(sim, 'lab', 1, false)[0]), {}, 'a lab being built');
  assert.deepEqual(buildingOutput(sim, build(sim, 'depot', 1)[0]), {}, 'a depot');
  s.order = 80;
  s.laws.push('wareconomy');
  assert.ok(Math.abs(buildingOutput(sim, fs[0]).funds - BUILDINGS.factory.produce.funds * ECONOMY.highOrderProduction * 1.5 * sim.diff.income) < 1e-9, 'high order and the war economy');
  const farm = s.ents.buildings.find((b) => b.type === 'farm');
  let fl = 0;
  for (let dj = 0; dj < farm.size; dj++) for (let di = 0; di < farm.size; di++) fl += sim.map.farmland[(farm.j + dj) * sim.N + farm.i + di];
  assert.ok(Math.abs(buildingOutput(sim, farm).food - BUILDINGS.farm.produce.food * ECONOMY.highOrderProduction * (1 + ECONOMY.farmlandBonus * (fl / 4)) * sim.diff.income) < 1e-9, 'farmland');
  const rich = new Sim({ seed: 1, difficulty: 'recruit' });
  const lab = build(rich, 'lab', 1)[0], hq = rich.state.ents.buildings.find((b) => b.type === 'hq');
  assert.deepEqual([buildingOutput(rich, lab), buildingOutput(rich, hq)], [{ research: 1 }, { funds: rich.diff.income }], 'difficulty scales income, not research');
});

// computeRates as it was before it returned a breakdown and before buildingOutput was factored out of it (CI2).
// It reads the same config, so it stays a fair reference when the map or balance changes.
function ratesBefore(sim) {
  const s = sim.state, m = sim.map;
  const rates = { funds: 0, food: 0, ammo: 0, manpower: 0, authority: 0, research: 0 };
  const add = (k, v) => { rates[k] += v; };
  const trustFactor = ECONOMY.trustTaxBase + s.trust / 100;
  const orderBonus = s.order >= 70 ? ECONOMY.highOrderProduction : 1;
  let pop = 0;
  const work = workforce(sim);
  for (const t of s.towns) {
    if (t.status !== 'ok') continue;
    pop += t.pop;
    let tax = (t.pop / 1e5) * ECONOMY.taxPer100k * trustFactor * sim.diff.income;
    if (t.quarantine) tax *= ECONOMY.quarantineIncome;
    if (t.sacrifice) tax = 0;
    if (sim.hasLaw('mobilisation')) tax *= 0.75;
    if (sim.hasLaw('wareconomy')) tax *= 0.8;
    add('funds', tax);
    const spec = SPECIALTIES[m.towns[t.id].specialty];
    const f = townOutputFactor(sim, t);
    if (spec && f > 0) for (const [k, v] of Object.entries(spec.produce)) add(k, v * f);
  }
  for (const b of s.ents.buildings) {
    const def = BUILDINGS[b.type];
    if (work.idle.has(b.id)) continue;
    if (def.upkeep && (b.built || b.type === 'lure') && !(def.toggle && !b.on)) for (const [k, v] of Object.entries(def.upkeep)) add(k, -v);
    if (!b.built || !def.produce) continue;
    for (const [k, v] of Object.entries(def.produce)) {
      let amt = v * orderBonus;
      if (k !== 'research') amt *= sim.diff.income;
      if (b.type === 'farm') {
        let fl = 0;
        for (let dj = 0; dj < b.size; dj++) for (let di = 0; di < b.size; di++) fl += m.farmland[(b.j + dj) * m.N + b.i + di];
        amt *= 1 + ECONOMY.farmlandBonus * (fl / (b.size * b.size));
      }
      if ((b.type === 'factory' || b.type === 'munitions') && sim.hasLaw('wareconomy')) amt *= 1.5;
      add(k, amt);
    }
  }
  for (const u of s.ents.units) for (const [k, v] of Object.entries(UNITS[u.type].upkeep)) add(k, -v);
  let foodUse = (pop / 1e6) * ECONOMY.foodPerMillion + s.ents.units.length * ECONOMY.foodPerUnit;
  foodUse += s.ents.refugees.filter((r) => r.camp).length * ECONOMY.foodPerCampGroup;
  if (sim.hasLaw('rationing')) foodUse *= 0.7;
  if (sim.hasTech('c2')) foodUse *= 0.8;
  add('food', -foodUse);
  let mp = (pop / 1e6) * ECONOMY.manpowerPerMillion;
  mp *= sim.hasLaw('mobilisation') ? 2.5 : sim.hasLaw('martial') ? 1.6 : 1;
  if (s.trust >= 70) mp *= ECONOMY.highTrustManpower;
  add('manpower', mp);
  add('authority', ECONOMY.authorityBase + s.trust * ECONOMY.authorityPerTrust + (sim.hasLaw('broadcasts') ? 0.1 : 0) + (sim.hasTech('c1') ? 0.15 : 0));
  if (sim.hasLaw('broadcasts')) add('funds', -0.2);
  if (!s.ents.buildings.find((b) => b.type === 'hq')) add('authority', -0.1);
  return rates;
}

// Seed 1 on Recruit with every kind of flow: farms, eight factories (two left idle), a plant, a lab, a radar,
// a factory site, troops, a camp, high order and trust, laws and techs, a quarantined town and a sacrifice zone.
function busyEconomy() {
  const sim = new Sim({ seed: 1, difficulty: 'recruit' }), s = sim.state;
  build(sim, 'farm', 2);
  build(sim, 'factory', 8);
  build(sim, 'munitions', 1);
  build(sim, 'lab', 1);
  build(sim, 'radar', 1);
  build(sim, 'factory', 1, false);
  const hq = s.ents.buildings.find((b) => b.type === 'hq');
  spawnUnit(sim, 'infantry', hq.x + 2, hq.z);
  spawnUnit(sim, 'gunship', hq.x, hq.z + 2);
  s.ents.refugees.push({ id: sim.newId(), camp: true });
  s.order = 75;
  s.trust = 72;
  s.laws.push('wareconomy', 'broadcasts', 'rationing');
  s.research.done.push('c1', 'c2');
  s.towns[1].quarantine = true;
  s.towns[2].sacrifice = true;
  return sim;
}

test('computeRates: the same rates as before the breakdown, and every rate is the sum of its parts', () => {
  const busy = busyEconomy();
  assert.ok(workforce(busy).idle.size > 0, 'some factories idle');
  const noHq = busyEconomy();
  removeBuilding(noHq, noHq.state.ents.buildings.find((b) => b.type === 'hq'));
  for (const [name, sim] of [['seed 1', new Sim({ seed: 1 })], ['seed 7', new Sim({ seed: 7, mode: 'sandbox' })], ['busy', busy], ['no HQ', noHq]]) {
    const { rates, parts } = computeRates(sim);
    assert.deepEqual(rates, ratesBefore(sim), name);
    for (const k of Object.keys(rates)) {
      const sum = parts[k].reduce((a, [, v]) => a + v, 0);
      assert.ok(Math.abs(rates[k] - sum) < 1e-9, `${name} ${k}: rate ${rates[k]}, parts ${sum} ${JSON.stringify(parts[k])}`);
    }
  }
  const { parts } = computeRates(busy);
  const labels = (k) => parts[k].map(([l]) => l);
  for (const l of ['taxes', 'Factories', 'HQ', 'troop upkeep', 'Munitions Plant upkeep', 'Radar Station upkeep', 'broadcasts']) assert.ok(labels('funds').includes(l), `funds has ${l}: ${labels('funds')}`);
  for (const l of ['Farms', 'people', 'troops', 'camps']) assert.ok(labels('food').includes(l), `food has ${l}: ${labels('food')}`);
  assert.ok(labels('authority').includes(`${busy.map.towns.find((t) => t.capital).name} Ministries`));
  assert.ok(!labels('authority').includes('no HQ'));
  assert.ok(computeRates(noHq).parts.authority.some(([l]) => l === 'no HQ'), 'losing the HQ costs authority');
});

test('town rows: every living town with its people, the workers it supplies, its output factor and status', () => {
  const sim = new Sim({ seed: 1 }), s = sim.state;
  s.towns[1].quarantine = true;
  s.towns[2].alerted = true;
  s.towns[3].status = 'fallen';
  s.towns[4].sacrifice = true;
  const rows = townRows(sim);
  assert.deepEqual(rows.map((r) => r.id), s.towns.filter((t) => t.status === 'ok').map((t) => t.id));
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual([by[0].name, by[0].pop, by[0].factor, by[0].status], [sim.map.towns[0].name, s.towns[0].pop, 1, 'ok']);
  assert.deepEqual([by[1].status, by[2].status, by[4].status, by[4].workers, by[4].factor], ['quarantined', 'outbreak', 'sacrifice zone', 0, 0]);
  assert.ok(Math.abs(by[0].workers - (s.towns[0].pop / 1e5) * ECONOMY.workersPer100k) < 1e-9);
  assert.ok(Math.abs(by[1].workers - (s.towns[1].pop / 1e5) * ECONOMY.workersPer100k * ECONOMY.quarantineIncome) < 1e-9);
  assert.ok(Math.abs(rows.reduce((a, r) => a + r.workers, 0) - workforce(sim).have) < 1e-9, 'the towns supply the whole workforce');
});

test('building markers: construction, then idle, then damage, then training; walls only for damage', () => {
  const sim = smallCountry(), s = sim.state;
  const hq = s.ents.buildings.find((b) => b.type === 'hq');
  assert.equal(buildingMarker(sim, hq), null, 'nothing to say about a sound, staffed HQ');

  const fs = build(sim, 'factory', 3);
  economySystem(sim, 0);
  assert.equal(buildingMarker(sim, fs[0]), null, 'a staffed factory');
  assert.deepEqual(buildingMarker(sim, fs[1]), { icon: '💤', text: 'no workers', level: 'warn' });

  const [mun] = build(sim, 'munitions', 1, false);
  mun.progress = 0.437;
  assert.deepEqual(buildingMarker(sim, mun), { icon: '🔨', text: '43%', level: '' });
  mun.hp = mun.maxHp * 0.1;
  assert.equal(buildingMarker(sim, mun).icon, '🔨', 'construction comes before damage');

  fs[0].hp = fs[0].maxHp * 0.4;
  assert.deepEqual(buildingMarker(sim, fs[0]), { icon: '⚠', text: 'damaged', level: 'warn' });
  fs[0].hp = fs[0].maxHp * 0.2;
  assert.deepEqual(buildingMarker(sim, fs[0]), { icon: '⚠', text: 'damaged', level: 'bad' });
  fs[0].hp = fs[0].maxHp * 0.5;
  assert.equal(buildingMarker(sim, fs[0]), null, 'half HP is not yet damaged');
  fs[1].hp = fs[1].maxHp * 0.2;
  assert.equal(buildingMarker(sim, fs[1]).icon, '💤', 'idle comes before damage');

  hq.queue.push('infantry', 'hazmat');
  assert.deepEqual(buildingMarker(sim, hq), { icon: UNITS.infantry.icon, text: '×2', level: '' }, 'the unit in training and the queue length');
  hq.hp = hq.maxHp * 0.3;
  assert.equal(buildingMarker(sim, hq).icon, '⚠', 'damage comes before training');

  const [wall] = build(sim, 'wall', 1, false);
  wall.progress = 0.5;
  assert.equal(buildingMarker(sim, wall), null, 'a wall being built says nothing');
  wall.hp = wall.maxHp * 0.2;
  assert.equal(buildingMarker(sim, wall).level, 'bad', 'but a damaged one, still building or upgrading, does');
  wall.hp = wall.maxHp;
  wall.built = true; wall.progress = 1;
  wall.hp = wall.maxHp * 0.3;
  assert.deepEqual(buildingMarker(sim, wall), { icon: '⚠', text: 'damaged', level: 'warn' });
});
