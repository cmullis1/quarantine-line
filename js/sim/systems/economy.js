// Resource flows, shortages, and the drift of Trust and Order.
import { ECONOMY, POLITICS, REFUGEES } from '../../config/balance.js';
import { BUILDINGS } from '../../config/buildings.js';
import { UNITS } from '../../config/units.js';
import { SPECIALTIES } from '../../config/world.js';
import { LAW_BY_ID } from '../../config/laws.js';

const RES = ['funds', 'food', 'ammo', 'manpower', 'authority', 'research'];

export function townOutputFactor(sim, t) {
  if (t.status !== 'ok' || t.quarantine || t.sacrifice) return 0;
  return Math.min(1.2, t.pop / t.pop0);
}

function near(b, x, z, r) {
  return Math.hypot(b.x - x, b.z - z) < r;
}

// Who gets workers first: food keeps people alive, ammo keeps the line, then research, then money. Within a type
// the oldest building is staffed first.
export const STAFF_ORDER = ['farm', 'munitions', 'lab', 'factory'];

// Workers one town can spare: none from a fallen town or a sacrifice zone, far fewer from a quarantined one.
export function townWorkers(t) {
  if (t.status !== 'ok' || t.sacrifice) return 0;
  return (t.pop / 1e5) * ECONOMY.workersPer100k * (t.quarantine ? ECONOMY.quarantineIncome : 1);
}

// Workers the living towns can spare, and which producing buildings they staff. When people die or a town is
// quarantined, the producers lowest in STAFF_ORDER fall idle first. need counts buildings still under construction
// (what the plan will need); only finished ones are staffed. → {have, need, used, idle: Set of building ids}
export function workforce(sim) {
  const s = sim.state;
  let have = 0;
  for (const t of s.towns) have += townWorkers(t);
  let need = 0, used = 0;
  const idle = new Set();
  for (const b of s.ents.buildings) need += BUILDINGS[b.type].workers || 0;
  const staffed = s.ents.buildings.filter((b) => BUILDINGS[b.type].workers && b.built);
  staffed.sort((a, b) => STAFF_ORDER.indexOf(a.type) - STAFF_ORDER.indexOf(b.type) || a.id - b.id);
  for (const b of staffed) {
    const w = BUILDINGS[b.type].workers;
    if (used + w <= have + 1e-9) used += w;
    else idle.add(b.id);
  }
  return { have, need, used, idle };
}

// What one building makes per hour: its produce, raised by high order, farmland and the war economy, scaled by
// the difficulty's income (research excepted). Unfinished, unstaffed and non-producing buildings make nothing.
// work is a workforce() result when the caller already has one. → { res: perHour }
export function buildingOutput(sim, b, work = workforce(sim)) {
  const def = BUILDINGS[b.type], m = sim.map, out = {};
  if (!b.built || !def.produce || work.idle.has(b.id)) return out;
  const orderBonus = sim.state.order >= 70 ? ECONOMY.highOrderProduction : 1;
  for (const [k, v] of Object.entries(def.produce)) {
    let amt = v * orderBonus;
    if (k !== 'research') amt *= sim.diff.income;
    if (b.type === 'farm') {
      let fl = 0;
      for (let dj = 0; dj < b.size; dj++) for (let di = 0; di < b.size; di++) fl += m.farmland[(b.j + dj) * m.N + b.i + di];
      amt *= 1 + ECONOMY.farmlandBonus * (fl / (b.size * b.size));
    }
    if ((b.type === 'factory' || b.type === 'munitions') && sim.hasLaw('wareconomy')) amt *= 1.5;
    out[k] = amt;
  }
  return out;
}

// A producer type as the breakdown names it: "Farms", "Factories", "HQ".
export function producerLabel(type) {
  return type === 'hq' ? 'HQ' : BUILDINGS[type].name.replace(/y$/, 'ie') + 's';
}

// Rates per hour, also used by the HUD. Returns {rates, pop, work, parts}: parts lists, per resource, every
// [label, perHour] that makes up its rate (same labels summed), for the ECONOMY tab's flows.
export function computeRates(sim) {
  const s = sim.state, m = sim.map;
  const rates = Object.fromEntries(RES.map((k) => [k, 0]));
  const parts = Object.fromEntries(RES.map((k) => [k, []]));
  const part = (k, label, v) => {
    const p = parts[k].find((e) => e[0] === label);
    if (p) p[1] += v; else parts[k].push([label, v]);
  };
  const add = (k, v, label) => { rates[k] += v; part(k, label, v); };
  const trustFactor = ECONOMY.trustTaxBase + s.trust / 100;
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
    add('funds', tax, 'taxes');
    const spec = SPECIALTIES[m.towns[t.id].specialty];
    const f = townOutputFactor(sim, t);
    if (spec && f > 0) for (const [k, v] of Object.entries(spec.produce)) add(k, v * f, `${m.towns[t.id].name} ${spec.label}`);
  }
  for (const b of s.ents.buildings) {
    const def = BUILDINGS[b.type];
    if (work.idle.has(b.id)) continue;
    if (def.upkeep && (b.built || b.type === 'lure') && !(def.toggle && !b.on)) for (const [k, v] of Object.entries(def.upkeep)) add(k, -v, `${def.name} upkeep`);
    for (const [k, v] of Object.entries(buildingOutput(sim, b, work))) add(k, v, producerLabel(b.type));
  }
  for (const u of s.ents.units) for (const [k, v] of Object.entries(UNITS[u.type].upkeep)) add(k, -v, 'troop upkeep');
  const camps = s.ents.refugees.filter((r) => r.camp).length;
  let foodUse = (pop / 1e6) * ECONOMY.foodPerMillion + s.ents.units.length * ECONOMY.foodPerUnit;
  foodUse += camps * ECONOMY.foodPerCampGroup;
  if (sim.hasLaw('rationing')) foodUse *= 0.7;
  if (sim.hasTech('c2')) foodUse *= 0.8;
  rates.food -= foodUse;
  // The breakdown splits the same total by who eats it.
  const eat = (sim.hasLaw('rationing') ? 0.7 : 1) * (sim.hasTech('c2') ? 0.8 : 1);
  part('food', 'people', -(pop / 1e6) * ECONOMY.foodPerMillion * eat);
  part('food', 'troops', -s.ents.units.length * ECONOMY.foodPerUnit * eat);
  if (camps) part('food', 'camps', -camps * ECONOMY.foodPerCampGroup * eat);
  let mp = (pop / 1e6) * ECONOMY.manpowerPerMillion;
  mp *= sim.hasLaw('mobilisation') ? 2.5 : sim.hasLaw('martial') ? 1.6 : 1;
  if (s.trust >= 70) mp *= ECONOMY.highTrustManpower;
  add('manpower', mp, 'population');
  add('authority', ECONOMY.authorityBase + s.trust * ECONOMY.authorityPerTrust + (sim.hasLaw('broadcasts') ? 0.1 : 0) + (sim.hasTech('c1') ? 0.15 : 0), 'government');
  if (sim.hasLaw('broadcasts')) add('funds', -0.2, 'broadcasts');
  const hq = s.ents.buildings.find((b) => b.type === 'hq');
  if (!hq) add('authority', -0.1, 'no HQ');
  return { rates, pop, work, parts };
}

export function economySystem(sim, dt) {
  const s = sim.state;
  const { rates, pop, work } = computeRates(sim);
  s.rates = rates;
  s.population = pop;
  s.workforce = { have: work.have, need: work.need, used: work.used };
  for (const b of s.ents.buildings) if (BUILDINGS[b.type].workers) b.idle = work.idle.has(b.id);
  if (work.idle.size) sim.lesson('workers');
  for (const k of RES) s.res[k] += rates[k] * dt;

  const starving = s.res.food <= 0;
  const broke = s.res.funds <= 0;
  if (starving) {
    s.res.food = 0;
    for (const t of s.towns) {
      if (t.status !== 'ok') continue;
      const d = (t.pop / 1e5) * ECONOMY.starvationDeathsPer100k * dt;
      t.pop -= d; t.deaths += d; s.stats.deadPeople += d;
    }
    if (!s.flags.starving) { s.flags.starving = true; sim.alert('starving', 'Food has run out. People are starving.', null, null, 'bad'); sim.lesson('food'); }
  } else s.flags.starving = false;
  if (broke) {
    s.res.funds = 0;
    if (!s.flags.broke) { s.flags.broke = true; sim.alert('broke', 'The treasury is empty: troops are going unpaid.', null, null, 'bad'); }
  } else s.flags.broke = false;
  for (const k of ['ammo', 'manpower', 'authority', 'research']) if (s.res[k] < 0) s.res[k] = 0;
  if (s.res.ammo < 5 && !s.flags.lowAmmo) { s.flags.lowAmmo = true; sim.lesson('ammo'); sim.alert('ammo', 'Ammunition is almost gone. Troops will fight hand to hand.', null, null, 'bad'); }
  if (s.res.ammo > 30) s.flags.lowAmmo = false;

  // ---- Trust and order: each term is recorded so the HUD can explain the trend --------
  const living = s.towns.filter((t) => t.status === 'ok');
  const tParts = [], oParts = [];
  const tp = (label, v) => { if (v) tParts.push([label, v]); };
  const op = (label, v) => { if (v) oParts.push([label, v]); };
  tp(starving ? 'starvation' : 'normal life', starving ? -ECONOMY.shortageTrust : POLITICS.baseTrust);
  tp('outbreaks', -living.filter((t) => t.alerted).length * POLITICS.outbreakTrust);
  tp('quarantines', -living.filter((t) => t.quarantine).length * POLITICS.quarantineTrust);
  let lt = 0;
  for (const l of s.laws) lt += LAW_BY_ID[l].drift?.trust || 0;
  tp('laws', lt);
  // Safety earns trust: no outbreaks and no dead inside the country.
  let insideDead = 0;
  for (const z of s.ents.dead) if (!z.gone && sim.map.owner[Math.floor(z.z) * sim.N + Math.floor(z.x)]) insideDead++;
  if (!living.some((t) => t.alerted) && insideDead === 0) tp('safety', POLITICS.safetyTrust);
  // Information control mutes discontent; so does fear while order is high.
  const muted = sim.hasLaw('censorship') ? 0.5 : sim.hasLaw('managed') ? 0.8 : 1;
  for (const p of tParts) if (p[1] < 0) p[1] *= sim.diff.politics * (s.order >= 70 ? POLITICS.orderShield : 1) * muted;

  op('normal life', POLITICS.baseOrder);
  let lo = 0;
  for (const l of s.laws) lo += LAW_BY_ID[l].drift?.order || 0;
  op('laws', lo);
  const policeMult = sim.hasLaw('martial') ? 2 : 1;
  let police = 0, troops = 0, sick = 0;
  for (const t of living) {
    const info = sim.map.towns[t.id];
    for (const b of s.ents.buildings) if (b.type === 'police' && b.built && near(b, info.x, info.z, BUILDINGS.police.radius)) police += POLITICS.policeOrder * policeMult;
    for (const u of s.ents.units) if (near(u, info.x, info.z, info.r + 2.5)) troops += (UNITS[u.type].order || POLITICS.troopsInTownOrder) * (u.type === 'police' ? policeMult : 1);
    if (t.infected > 300) sick -= 0.05;
  }
  op('police stations', police);
  op('troops in towns', troops);
  op('breakouts', sick);
  op('public fear', -Math.min(POLITICS.fearCap, (sim.act - 1) * POLITICS.fearPerAct + insideDead * POLITICS.fearPerDead));
  if (s.trust < 30) op('low trust', -POLITICS.lowTrustOrder);
  if (starving) op('hunger', -ECONOMY.shortageOrder);
  if (broke) op('unpaid troops', -ECONOMY.unpaidOrder);
  const queued = s.ents.refugees.filter((r) => r.mode === 'waiting').length;
  if (queued > 6) op('crowds at the border', -(queued - 6) * REFUGEES.queueUnrest);
  if (s.order < 30 && s.res.food > 0) s.res.food = Math.max(0, s.res.food - POLITICS.lowOrderLoot * dt);

  // Difficulty sharpens order losses the way it sharpens trust losses (both meters can end the game).
  for (const p of oParts) if (p[1] < 0) p[1] *= sim.diff.politics;
  s.trustParts = tParts;
  s.orderParts = oParts;
  s.trustRate = tParts.reduce((a, p) => a + p[1], 0);
  s.orderRate = oParts.reduce((a, p) => a + p[1], 0);
  for (const [label, v] of tParts) changeTrust(sim, v * dt, label);
  for (const [label, v] of oParts) changeOrder(sim, v * dt, label);
}

// All trust/order changes go through these so every change has a recorded cause.
// `sim.cause` (set while a decision or letter runs) overrides the cause label.
function logChange(sim, key, d, cause) {
  const s = sim.state;
  const log = s.stats[key] || (s.stats[key] = {});
  const c = sim.cause || cause;
  log[c] = (log[c] || 0) + d;
  if (key === 'trustLog') sim.loggedT = (sim.loggedT || 0) + d; else sim.loggedO = (sim.loggedO || 0) + d;
}

// Run `fn` (a decision or letter effect that may edit trust/order directly) and attribute everything it
// changed (including direct edits) to `cause`.
export function withCause(sim, cause, fn) {
  const s = sim.state;
  const t0 = s.trust, o0 = s.order;
  sim.cause = cause; sim.loggedT = 0; sim.loggedO = 0;
  try { fn(); } finally {
    s.trust = Math.max(0, Math.min(100, s.trust));
    s.order = Math.max(0, Math.min(100, s.order));
    const dt = s.trust - t0 - sim.loggedT, dO = s.order - o0 - sim.loggedO;
    if (dt) { const l = s.stats.trustLog || (s.stats.trustLog = {}); l[cause] = (l[cause] || 0) + dt; }
    if (dO) { const l = s.stats.orderLog || (s.stats.orderLog = {}); l[cause] = (l[cause] || 0) + dO; }
    sim.cause = null;
  }
}

export function changeTrust(sim, d, cause) {
  const s = sim.state;
  const before = s.trust;
  s.trust = Math.max(0, Math.min(100, s.trust + d));
  if (s.trust !== before) logChange(sim, 'trustLog', s.trust - before, cause);
}

export function changeOrder(sim, d, cause) {
  const s = sim.state;
  const before = s.order;
  s.order = Math.max(0, Math.min(100, s.order + d));
  if (s.order !== before) logChange(sim, 'orderLog', s.order - before, cause);
}

// Event-driven trust loss, scaled by difficulty and softened by information laws.
// How hard one-off events hit trust right now: difficulty, softened by controlling the news.
export function trustLossMult(sim) {
  return sim.diff.politics * (sim.hasLaw('censorship') ? 0.3 : sim.hasLaw('managed') ? 0.6 : 1);
}

export function hitTrust(sim, amount, cause = 'events') {
  changeTrust(sim, -amount * trustLossMult(sim), cause);
}
