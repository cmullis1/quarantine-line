// Player (and bot) commands. Each validates against current state and returns {ok, why?, ...}.
// Commands never throw on stale ids or bad input.
import { BUILDINGS } from '../config/buildings.js';
import { UNITS } from '../config/units.js';
import { LAW_BY_ID, lawPrereq, BORDER_STANCES } from '../config/laws.js';
import { RESEARCH_BY_ID, researchPrereq } from '../config/research.js';
import { ACTIONS, TOWN_ACTIONS } from '../config/actions.js';
import { TER } from '../config/world.js';
import { line4 } from './mapgen.js';
import { makeBuilding, removeBuilding, buildingMaxHp } from './entities.js';
import { runDecision, answerRequest, resolveLetter } from './systems/politics.js';
import { changeTrust, changeOrder } from './systems/economy.js';
import { startEvacuation, sterilise, startReclaim } from './systems/towns.js';

const fail = (why) => ({ ok: false, why });
const LINE_TYPES = new Set(['wall', 'highwall', 'gate']);

export function footprint(type, i, j) {
  const s = BUILDINGS[type].size, out = [];
  for (let dj = 0; dj < s; dj++) for (let di = 0; di < s; di++) out.push([i + di, j + dj]);
  return out;
}

export function isUnlocked(sim, type) {
  const def = BUILDINGS[type];
  return !def.unlock || sim.hasTech(def.unlock);
}

// Whether a unit type's research (`requires`) is done, so it can be trained.
export function unitUnlocked(sim, type) {
  const r = UNITS[type].requires;
  return !r || sim.hasTech(r);
}

function shallowWater(sim, k) {
  const m = sim.map;
  if (m.terrain[k] !== TER.SEA && m.terrain[k] !== TER.LAKE && m.terrain[k] !== TER.RIVER) return false;
  const i = k % sim.N, j = (k / sim.N) | 0;
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const ni = i + di, nj = j + dj;
    if (ni < 0 || nj < 0 || ni >= sim.N || nj >= sim.N) continue;
    const nk = nj * sim.N + ni;
    if (m.terrain[nk] === TER.LAND && m.owner[nk]) return true;
  }
  return false;
}

// Foreign tiles within two tiles of Valdmark can hold forward defences, so passes and crossings that sit
// on the border line can actually be closed.
function forwardOk(sim, k) {
  if (!sim.forward) {
    const N = sim.N, m = sim.map, f = new Uint8Array(N * N);
    for (let q = 0; q < N * N; q++) {
      if (m.owner[q]) { f[q] = 1; continue; }
      const i = q % N, j = (q / N) | 0;
      outer: for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const ni = i + di, nj = j + dj;
        if (ni >= 0 && nj >= 0 && ni < N && nj < N && m.owner[nj * N + ni]) { f[q] = 1; break outer; }
      }
    }
    sim.forward = f;
  }
  return sim.forward[k] === 1;
}

export function canPlace(sim, type, i, j, { free = false } = {}) {
  const def = BUILDINGS[type];
  if (!def || (def.tab === undefined && !free)) return fail('Cannot be built');
  if (!isUnlocked(sim, type)) return fail(`Requires ${RESEARCH_BY_ID[def.unlock].name}`);
  const m = sim.map;
  for (const [ti, tj] of footprint(type, i, j)) {
    if (ti < 0 || tj < 0 || ti >= sim.N || tj >= sim.N) return fail('Off the map');
    const k = tj * sim.N + ti;
    if (sim.bgrid[k]) return fail('Occupied');
    if (m.townId[k] >= 0) return fail('Inside a town');
    const t = m.terrain[k];
    if (t === TER.MOUNTAIN) return fail('Mountains');
    const water = (t === TER.SEA || t === TER.RIVER || t === TER.LAKE) && !m.bridge[k];
    if (water) {
      if (!(def.wall && sim.hasTech('e4') && shallowWater(sim, k))) return fail(def.wall ? 'Water (needs Coastal Barrier)' : 'Water');
    } else if (!forwardOk(sim, k)) return fail('Too far beyond the border');
    if (def.road && !m.road[k]) return fail('Must be on a road');
    if (m.road[k] && !def.road && !def.wall && type !== 'minefield') return fail('Keep roads clear');
  }
  if (!free && !sim.canAfford(def.cost)) return fail('Not enough resources');
  return { ok: true };
}

function unitsOf(sim, ids) {
  return (Array.isArray(ids) ? ids : [ids]).map((id) => sim.byId(id)).filter((u) => u && !u.gone && UNITS[u.type]);
}

export const COMMANDS = {
  place(sim, type, i, j) {
    const v = canPlace(sim, type, i, j);
    if (!v.ok) return v;
    sim.pay(BUILDINGS[type].cost);
    const b = makeBuilding(sim, type, i, j);
    return { ok: true, id: b.id };
  },

  placeLine(sim, type, i0, j0, i1, j1) {
    if (!BUILDINGS[type]?.line) return fail('Not a line structure');
    let n = 0, why = null;
    for (const [i, j] of line4(i0, j0, i1, j1).slice(0, 80)) {
      const v = canPlace(sim, type, i, j);
      if (!v.ok) { why = why || v.why; if (v.why === 'Not enough resources') break; continue; }
      sim.pay(BUILDINGS[type].cost);
      makeBuilding(sim, type, i, j);
      n++;
    }
    return n ? { ok: true, count: n, why } : fail(why || 'Nothing placed');
  },

  upgrade(sim, id) {
    const b = sim.byId(id);
    if (!b || !BUILDINGS[b.type]) return fail('No such building');
    const to = Object.keys(BUILDINGS).find((t) => BUILDINGS[t].upgradeOf === b.type);
    if (!to) return fail('Cannot be upgraded');
    if (!isUnlocked(sim, to)) return fail(`Requires ${RESEARCH_BY_ID[BUILDINGS[to].unlock].name}`);
    if (!b.built) return fail('Still under construction');
    if (!sim.canAfford(BUILDINGS[to].cost)) return fail('Not enough resources');
    sim.pay(BUILDINGS[to].cost);
    const frac = b.hp / b.maxHp;
    b.type = to;
    b.maxHp = buildingMaxHp(sim, to);
    b.hp = frac * b.maxHp;
    b.built = false;
    b.progress = 0;
    sim.emit('upgraded', { id: b.id, btype: to });
    return { ok: true };
  },

  // Upgrade every wall connected to this one (4-neighbour, through gates and finished high walls),
  // nearest first, as far as funds allow.
  upgradeLine(sim, id) {
    const start = sim.byId(id);
    if (!start || !LINE_TYPES.has(start.type)) return fail('Select a wall');
    const seen = new Set([start.id]), queue = [start], line = [];
    while (queue.length) {
      const b = queue.shift();
      line.push(b);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = sim.buildingAt(b.i + di, b.j + dj);
        if (n && LINE_TYPES.has(n.type) && !seen.has(n.id)) { seen.add(n.id); queue.push(n); }
      }
    }
    let n = 0, why = null;
    for (const b of line) {
      if (b.type !== 'wall') continue;
      const r = COMMANDS.upgrade(sim, b.id);
      if (r.ok) n++;
      else { why = r.why; if (r.why === 'Not enough resources') break; }
    }
    return n ? { ok: true, count: n } : fail(why || 'Nothing upgraded');
  },

  demolish(sim, id) {
    const b = sim.byId(id);
    if (!b || !BUILDINGS[b.type]) return fail('No such building');
    if (b.type === 'hq') return fail('Cannot demolish the HQ');
    const frac = b.hp / b.maxHp;
    for (const [k, v] of Object.entries(BUILDINGS[b.type].cost)) sim.state.res[k] += Math.floor(v * 0.5 * frac);
    removeBuilding(sim, b, false);
    return { ok: true };
  },

  toggle(sim, id) {
    const b = sim.byId(id);
    if (!b || !BUILDINGS[b.type]?.toggle) return fail('Cannot be toggled');
    b.on = !b.on;
    return { ok: true, on: b.on };
  },

  train(sim, bid, type) {
    const b = sim.byId(bid);
    const def = UNITS[type];
    if (!b || !def || !BUILDINGS[b.type]?.trains?.includes(type)) return fail('Cannot train that here');
    if (!unitUnlocked(sim, type)) return fail(`Requires ${RESEARCH_BY_ID[def.requires].name}`);
    if (!b.built) return fail('Still under construction');
    if (b.queue.length >= 5) return fail('Queue full');
    if (!sim.canAfford(def.cost)) return fail('Not enough resources');
    sim.pay(def.cost);
    b.queue.push(type);
    return { ok: true };
  },

  cancelTrain(sim, bid, index) {
    const b = sim.byId(bid);
    if (!b || !b.queue || index < 0 || index >= b.queue.length) return fail('Nothing to cancel');
    const [type] = b.queue.splice(index, 1);
    sim.gain(UNITS[type].cost);
    if (index === 0) b.trainT = 0;
    return { ok: true };
  },

  rally(sim, bid, x, z) {
    const b = sim.byId(bid);
    if (!b || !BUILDINGS[b.type]?.trains) return fail('No rally point here');
    b.rally = [x, z];
    return { ok: true };
  },

  move(sim, ids, x, z, mode = 'move') {
    const us = unitsOf(sim, ids);
    if (!us.length) return fail('No units');
    const n = us.length, cols = Math.ceil(Math.sqrt(n));
    let moved = 0;
    us.forEach((u, k) => {
      const gx = Math.min(sim.N - 0.5, Math.max(0.5, x + ((k % cols) - (cols - 1) / 2) * 1.1));
      const gz = Math.min(sim.N - 0.5, Math.max(0.5, z + (Math.floor(k / cols) - (Math.ceil(n / cols) - 1) / 2) * 1.1));
      const path = u.air ? [[gx, gz]] : sim.nav.path(u.x, u.z, gx, gz);
      if (path) { u.path = path; u.order = mode === 'attack' ? 'amove' : 'move'; u.resume = null; moved++; }
    });
    return moved ? { ok: true, moved } : fail('No path');
  },

  stop(sim, ids) {
    for (const u of unitsOf(sim, ids)) { u.path = null; u.order = 'idle'; u.resume = null; }
    return { ok: true };
  },

  hold(sim, ids) {
    const us = unitsOf(sim, ids);
    const on = !us.every((u) => u.order === 'hold');
    for (const u of us) { u.path = null; u.order = on ? 'hold' : 'idle'; u.resume = null; }
    return { ok: true, hold: on };
  },

  setBorder(sim, stance) {
    const st = BORDER_STANCES[stance];
    if (!st) return fail('No such stance');
    if (st.law && !sim.hasLaw(st.law)) return fail(`Requires ${LAW_BY_ID[st.law].name}`);
    if (sim.state.border === stance) return { ok: true };
    const cd = sim.state.cooldowns.border || 0;
    if (sim.state.time < cd) return fail(`Border orders can change again in ${Math.ceil(cd - sim.state.time)} h`);
    sim.state.border = stance;
    sim.state.cooldowns.border = sim.state.time + 6;
    sim.alert('border', `Border ${st.label}.`, null, null, stance === 'open' ? 'info' : 'warn');
    sim.emit('policy', {});
    return { ok: true };
  },

  passLaw(sim, id) {
    const law = LAW_BY_ID[id];
    if (!law) return fail('No such law');
    if (sim.hasLaw(id)) return fail('Already law');
    const pre = lawPrereq(id);
    if (pre && !sim.hasLaw(pre)) return fail(`Requires ${LAW_BY_ID[pre].name}`);
    if (sim.day < law.day) return fail(`Available from Day ${law.day}`);
    if (sim.state.res.authority < law.cost) return fail('Not enough authority');
    sim.state.res.authority -= law.cost;
    sim.state.laws.push(id);
    if (law.once) {
      if (law.once.trust) changeTrust(sim, law.once.trust * (law.once.trust < 0 ? sim.diff.politics : 1), 'laws');
      if (law.once.order) changeOrder(sim, law.once.order, 'laws');
    }
    sim.alert('law', `${law.name} is now law.`, null, null, 'warn');
    sim.emit('policy', {});
    return { ok: true };
  },

  research(sim, id) {
    const r = RESEARCH_BY_ID[id];
    if (!r) return fail('No such project');
    if (sim.hasTech(id)) return fail('Already researched');
    const pre = researchPrereq(id);
    if (pre && !sim.hasTech(pre)) return fail(`Requires ${RESEARCH_BY_ID[pre].name}`);
    sim.state.research.active = id;
    sim.emit('policy', {});
    return { ok: true };
  },

  action(sim, id, x, z) {
    const a = ACTIONS[id];
    if (!a) return fail('No such action');
    const cd = sim.state.cooldowns[id] || 0;
    if (sim.state.time < cd) return fail(`Ready in ${Math.ceil(cd - sim.state.time)} h`);
    if (a.requires && !sim.state.ents.buildings.some((b) => b.type === a.requires && b.built)) return fail(`Requires a ${BUILDINGS[a.requires].name}`);
    const half = id === 'airstrike' && sim.hasLaw('scorched');
    const cost = { ...a.cost };
    if (half) for (const k in cost) cost[k] = Math.ceil(cost[k] / 2);
    if (id === 'broadcast' && sim.hasTech('c1')) cost.authority = Math.ceil(cost.authority / 2);
    if (!sim.canAfford(cost)) return fail('Not enough resources');
    if (a.target === 'map' && (typeof x !== 'number' || typeof z !== 'number')) return fail('Needs a target');
    sim.pay(cost);
    sim.state.cooldowns[id] = sim.state.time + a.cooldown;
    const s = sim.state;
    if (id === 'recon') {
      s.recon.push({ x, z, until: s.time + 24 });
      sim.emit('recon', { x, z });
    } else if (id === 'airstrike') {
      s.ents.strikes.push({ id: sim.newId(), x, z, t: a.delay });
      sim.emit('strikeCalled', { x, z });
      sim.alert('airstrike', 'Airstrike inbound: one hour.', x, z, 'warn');
    } else if (id === 'broadcast') {
      changeTrust(sim, a.trust, 'broadcasts'); changeOrder(sim, a.order, 'broadcasts');
      sim.alert('broadcast', 'The President addresses the nation.', null, null, 'good');
    } else if (id === 'conscription') {
      s.res.manpower += a.manpower; changeTrust(sim, a.trust * sim.diff.politics, 'conscription');
      sim.alert('conscription', 'Reservists called up.', null, null, 'warn');
    }
    return { ok: true };
  },

  town(sim, townId, action) {
    const t = sim.state.towns[townId];
    if (!t) return fail('No such town');
    const info = sim.map.towns[townId];
    if (action === 'quarantine') {
      if (t.status !== 'ok') return fail('Town is not inhabited');
      t.quarantine = !t.quarantine;
      sim.alert('quarantine', `${info.name}: quarantine ${t.quarantine ? 'imposed' : 'lifted'}.`, info.x, info.z, 'info');
      sim.flowDirty = true;
      return { ok: true, on: t.quarantine };
    }
    if (action === 'evacuate') return startEvacuation(sim, townId);
    if (action === 'sterilise') return sterilise(sim, townId);
    if (action === 'reclaim') return startReclaim(sim, townId);
    if (action === 'sacrifice') {
      if (!sim.hasLaw('sacrifice')) return fail('Requires Sacrifice Zones');
      if (t.status !== 'ok' || info.capital) return fail('Not possible here');
      if (t.sacrifice) return fail('Already a sacrifice zone');
      t.sacrifice = true;
      changeTrust(sim, TOWN_ACTIONS.sacrifice.trust * sim.diff.politics, 'sacrifice zones');
      sim.flowDirty = true;
      sim.alert('sacrifice', `${info.name} designated a sacrifice zone.`, info.x, info.z, 'bad');
      return { ok: true };
    }
    return fail('Unknown town action');
  },

  decide(sim, choice) { return runDecision(sim, choice); },

  request(sim, reqId, accept) { return answerRequest(sim, reqId, accept); },

  letter(sim, id, choice) { return resolveLetter(sim, id, choice); },
};
