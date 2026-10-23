// The data behind the command tabs (FORCES, ECONOMY) and the map overlays: pure functions of the sim, so Node tests
// can check them.
import { UNITS } from '../config/units.js';
import { BUILDINGS, WEAPONS } from '../config/buildings.js';
import { SPECIALTIES } from '../config/world.js';
import { trainSpeed } from '../sim/systems/buildings.js';
import { effectiveRange } from '../sim/systems/combat.js';
import { placeName } from '../sim/places.js';
import { STAFF_ORDER, workforce, buildingOutput, producerLabel, computeRates, townOutputFactor, townWorkers } from '../sim/systems/economy.js';

// Where a squad is, in the words a player uses (js/sim/places.js; the alerts name places the same way).
export { placeName };

const TYPES = Object.keys(UNITS);

// A unit at 0 HP is removed on the next tick; it is no longer part of the army.
const army = (sim) => sim.state.ents.units.filter((u) => !u.gone && u.hp > 0);

const shortName = (type) => UNITS[type].name.replace(/ (Squad|Team)$/, '');

export function squadStatus(u) {
  if (u.order === 'hold') return 'Holding';
  if (u.target) return 'Fighting';
  if (u.path?.length) return 'Moving';
  if (u.setup !== undefined && u.setup < (UNITS[u.type]?.setup ?? 1)) return 'Setting up';
  return 'Idle';
}

// One row per unit type on the map or in a training queue, in UNITS order.
export function forcesSummary(sim) {
  const rows = {};
  const row = (t) => (rows[t] ||= { type: t, name: UNITS[t].name, icon: UNITS[t].icon, count: 0, hp: 0, maxHp: 0, idle: 0, queued: 0 });
  for (const u of army(sim)) {
    const r = row(u.type);
    r.count++;
    r.hp += u.hp;
    r.maxHp += u.maxHp;
    if (squadStatus(u) === 'Idle') r.idle++;
  }
  for (const b of sim.state.ents.buildings) for (const t of b.queue || []) row(t).queued++;
  return TYPES.filter((t) => rows[t]).map((t) => rows[t]);
}

// Every squad, grouped by type in UNITS order and numbered per type in id order ("Infantry 3"). groups is the
// control-group table (number → ids); a squad shows the lowest group it belongs to.
export function squadList(sim, groups = {}) {
  const groupOf = new Map();
  for (const n of Object.keys(groups).map(Number).sort((a, b) => a - b)) for (const id of groups[n] || []) if (!groupOf.has(id)) groupOf.set(id, n);
  const byType = {};
  for (const u of army(sim)) (byType[u.type] ||= []).push(u);
  const out = [];
  for (const t of TYPES) {
    if (!byType[t]) continue;
    byType[t].sort((a, b) => a.id - b.id).forEach((u, k) => out.push({
      id: u.id, type: t, label: `${shortName(t)} ${k + 1}`, hp: u.hp, maxHp: u.maxHp, vet: u.vet,
      status: squadStatus(u), place: placeName(sim, u.x, u.z), group: groupOf.get(u.id) ?? null,
    }));
  }
  return out;
}

// Each training queue: the unit in training (a UNITS key), game hours until it is ready, and how many wait behind it.
export function trainingList(sim) {
  const out = [];
  for (const b of sim.state.ents.buildings) {
    if (!b.queue?.length) continue;
    const unit = b.queue[0];
    out.push({ buildingId: b.id, building: BUILDINGS[b.type].name, unit, hoursLeft: Math.max(0, UNITS[unit].train - b.trainT) / trainSpeed(sim, b), behind: b.queue.length - 1 });
  }
  return out;
}

// Funds per hour the troops cost.
export function armyUpkeep(sim) {
  let f = 0;
  for (const u of army(sim)) f += UNITS[u.type].upkeep.funds || 0;
  return f;
}

// ---- ECONOMY ----

// One colour per producer type, and red for producers standing idle: the workers bar, the producer rows and the
// economy overlay all use these.
export const PRODUCER_COLORS = { farm: '#6fb85a', munitions: '#e0883a', lab: '#a77ad8', factory: '#4a8ad8', idle: '#e04a3a' };

// Workers at each producer type, in staffing order, and how many the idle producers want.
export function workerSegments(sim) {
  const work = workforce(sim), used = {};
  let idleNeed = 0;
  for (const b of sim.state.ents.buildings) {
    const w = BUILDINGS[b.type].workers;
    if (!w || !b.built) continue;
    if (work.idle.has(b.id)) idleNeed += w;
    else used[b.type] = (used[b.type] || 0) + w;
  }
  return { have: work.have, segments: STAFF_ORDER.map((type) => ({ type, used: used[type] || 0 })), idleNeed };
}

const PRODUCERS = ['farm', 'factory', 'munitions', 'lab', 'hq'];

export function buildingStatus(b, work) {
  if (!b.built) return 'under construction';
  if (work.idle.has(b.id)) return 'idle';
  return b.hp < b.maxHp * 0.5 ? 'damaged' : 'working';
}

// What a building's status marker says, or null when there is nothing to say. One thing at a time, the most
// urgent first: still being built (or upgraded), idle for want of workers, below half HP, training. Walls speak
// only of damage: a line of 🔨 over every tile would bury the rest. The wording follows the hover card.
// → null | { icon, text, level ('' | 'warn' | 'bad') }
export function buildingMarker(sim, b) {
  const def = BUILDINGS[b.type];
  if (!b.built && !def.wall) return { icon: '🔨', text: `${Math.floor(b.progress * 100)}%`, level: '' };
  if (b.idle) return { icon: '💤', text: 'no workers', level: 'warn' };
  if (b.hp < b.maxHp * 0.5) return { icon: '⚠', text: 'damaged', level: b.hp < b.maxHp * 0.25 ? 'bad' : 'warn' };
  if (b.queue?.length) return { icon: UNITS[b.queue[0]].icon, text: `×${b.queue.length}`, level: '' };
  return null;
}

const addOutput = (sum, out) => {
  for (const [k, v] of Object.entries(out)) sum[k] = (sum[k] || 0) + v;
  return sum;
};

// One row per producing type you have (farms, factories, munitions plants, labs, the HQ), each listing its
// buildings, then one row per living town's specialty. Outputs are what computeRates counts.
export function producerRows(sim) {
  const s = sim.state, m = sim.map, work = workforce(sim);
  const rows = [];
  for (const type of PRODUCERS) {
    const bs = s.ents.buildings.filter((b) => b.type === type);
    if (!bs.length) continue;
    const items = bs.map((b) => ({ id: b.id, place: placeName(sim, b.x, b.z), status: buildingStatus(b, work), output: buildingOutput(sim, b, work) }));
    rows.push({
      kind: 'building', type, name: producerLabel(type), icon: BUILDINGS[type].icon, count: bs.length,
      staffed: bs.filter((b) => b.built && !work.idle.has(b.id)).length, idle: bs.filter((b) => work.idle.has(b.id)).length,
      building: bs.filter((b) => !b.built).length, output: items.reduce((sum, it) => addOutput(sum, it.output), {}), items,
    });
  }
  for (const t of s.towns) {
    const spec = SPECIALTIES[m.towns[t.id].specialty];
    if (t.status !== 'ok' || !spec) continue;
    const { factor: f, output } = townSpecialty(sim, t);
    rows.push({
      kind: 'specialty', type: m.towns[t.id].specialty, town: t.id, name: `${m.towns[t.id].name} ${spec.label}`, icon: spec.icon,
      count: 1, staffed: f > 0 ? 1 : 0, idle: f > 0 ? 0 : 1, building: 0, factor: f, output, items: [],
    });
  }
  return rows;
}

// A town's specialty: its icon and what it makes per hour at the town's output factor (nothing while quarantined,
// a sacrifice zone, fallen or scorched). → { icon, label, factor, output: { res: perHour }, spec }
export function townSpecialty(sim, t) {
  const spec = SPECIALTIES[sim.map.towns[t.id].specialty], f = townOutputFactor(sim, t);
  return { icon: spec.icon, label: spec.label, factor: f, output: f > 0 ? Object.fromEntries(Object.entries(spec.produce).map(([k, v]) => [k, v * f])) : {}, spec };
}

// The three biggest sources and the three biggest costs of a resource per hour, from computeRates' breakdown
// (pass parts to reuse one computeRates call for several resources). Costs are negative.
export function flows(sim, res, parts = computeRates(sim).parts) {
  const list = parts[res].filter(([, v]) => Math.abs(v) >= 0.005);
  return {
    sources: list.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3),
    costs: list.filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]).slice(0, 3),
  };
}

// Every living town: its people, the workers it supplies, its specialty's output factor and what is wrong with it.
export function townRows(sim) {
  return sim.state.towns.filter((t) => t.status === 'ok').map((t) => ({
    id: t.id, name: sim.map.towns[t.id].name, pop: t.pop, workers: townWorkers(t), factor: townOutputFactor(sim, t),
    status: t.sacrifice ? 'sacrifice zone' : t.quarantine ? 'quarantined' : t.alerted ? 'outbreak' : 'ok',
  }));
}

// ---- OVERLAYS ----

// What O cycles through, in order.
export const OVERLAY_MODES = ['none', 'infection', 'economy', 'defence'];

// The infection overlay's discs: towns with reported cases, towns with none, towns lost.
export const INFECTION_COLORS = { cases: '#ff3030', clear: '#40c060', lost: '#222222' };
// The defence overlay: direct fire rings in the placement ring's blue, artillery (far, and nothing up close) in
// orange, and walls in the HP bar's three bands.
export const DEFENCE_COLORS = { gun: '#9fd6ff', artillery: '#ffa040' };
export const HP_COLORS = ['#5ee05e', '#e0c040', '#e04040'];

// An HP fraction's band: 0 green above 60%, 1 amber above 30%, 2 red.
export const hpBand = (frac) => (frac > 0.6 ? 0 : frac > 0.3 ? 1 : 2);

// One plate per producer (farm, munitions plant, lab, factory), finished or not, in its type's colour; the ones
// standing idle for want of workers are flagged. → [{ id, type, x, z, size, color, idle }]
export function economyPlates(sim) {
  const out = [];
  for (const b of sim.state.ents.buildings) {
    if (!BUILDINGS[b.type].workers || !PRODUCER_COLORS[b.type]) continue;
    out.push({ id: b.id, type: b.type, x: b.x, z: b.z, size: b.size, color: PRODUCER_COLORS[b.type], idle: !!b.idle });
  }
  return out;
}

// What each defence covers now: every finished armed building, every unit that must set up (MG teams) once it has,
// and every standing mortar team. Guns reach their effectiveRange (shorter at night unless floodlit, in fog and in
// rain); a gun with a firing arc covers only that arc, `arc` degrees about its facing `rot`. Artillery and mortars
// keep their full reach and their minimum, as the sim fires them.
// → [{ id, x, z, r, min, kind: 'gun' | 'artillery', arc?, rot? }]
export function defenceRings(sim) {
  const out = [];
  for (const b of sim.state.ents.buildings) {
    const w = BUILDINGS[b.type].weapon;
    if (!w || !b.built) continue;
    const W = WEAPONS[w];
    if (w === 'artillery') out.push({ id: b.id, x: b.x, z: b.z, r: W.range, min: W.minRange, kind: 'artillery' });
    else out.push({ id: b.id, x: b.x, z: b.z, r: effectiveRange(sim, w, b.x, b.z), min: 0, kind: 'gun' });
  }
  for (const u of sim.state.ents.units) {
    const def = UNITS[u.type], W = WEAPONS[def.weapon];
    if (u.gone) continue;
    if (W.flight) { if (!u.moving) out.push({ id: u.id, x: u.x, z: u.z, r: W.range, min: W.minRange, kind: 'artillery' }); continue; }
    if (!def.setup || !(u.setup >= def.setup)) continue;
    const ring = { id: u.id, x: u.x, z: u.z, r: effectiveRange(sim, def.weapon, u.x, u.z), min: 0, kind: 'gun' };
    if (def.arc) Object.assign(ring, { arc: def.arc, rot: u.rot });
    out.push(ring);
  }
  return out;
}
