// Bot strategies drive the sim through the same commands the UI uses. They are balance probes
// (tools/balance.mjs) and the attract-mode player behind the main menu, not AI opponents: each plays a
// recognisable style so we can see what the numbers reward.
import { BUILDINGS } from '../config/buildings.js';
import { UNITS } from '../config/units.js';
import { canPlace } from '../sim/commands.js';
import { DECISION_BY_ID } from '../config/campaign.js';
import { sealPlan } from './seal.js';
import { TER } from '../config/world.js';
import { workforce } from '../sim/systems/economy.js';

function placeNear(sim, type, x, z, minR = 0, maxR = 8) {
  const s = BUILDINGS[type].size;
  for (let r = minR; r <= maxR; r++) {
    for (let a = 0; a < 16; a++) {
      const i = Math.round(x + Math.cos((a / 16) * Math.PI * 2) * r - (s - 1) / 2);
      const j = Math.round(z + Math.sin((a / 16) * Math.PI * 2) * r - (s - 1) / 2);
      if (canPlace(sim, type, i, j).ok) return sim.cmd('place', type, i, j);
    }
  }
  return { ok: false };
}

const count = (sim, type) => sim.state.ents.buildings.filter((b) => b.type === type).length;
const units = (sim, type) => sim.state.ents.units.filter((u) => !type || u.type === type);
const hq = (sim) => sim.state.ents.buildings.find((b) => b.type === 'hq');
// Where to build: the HQ, or the capital once the HQ has been destroyed.
const home = (sim) => hq(sim) ?? sim.map.towns.find((t) => t.capital);
const trainers = (sim, type) => sim.state.ents.buildings.filter((b) => b.built && BUILDINGS[b.type].trains?.includes(type) && b.queue.length < 2);

function train(sim, type) {
  const b = trainers(sim, type)[0];
  return b ? sim.cmd('train', b.id, type) : { ok: false };
}

function answerDecision(sim, prefs, decide) {
  const id = sim.state.events.decision;
  if (!id) return;
  const pick = decide ? decide(sim, id) : prefs[id] ?? 0;
  sim.cmd('decide', Math.min(pick, DECISION_BY_ID[id].choices.length - 1));
}

// Close the whole border with the cheapest wall line (seal.js), nearest the coming horde first. The plan is
// recomputed twice a day, so walls the dead tear down are replaced; river gaps get towers instead. Where the dead
// press against the line, towers go up behind it and the walls are raised to High Walls.
function sealBorder(sim, memory) {
  const s = sim.state;
  if (!memory.seal || s.time - memory.seal.t >= 12) memory.seal = { t: s.time, ...sealPlan(sim) };
  const plan = memory.seal;
  if (!plan.sealed) return;
  const threat = s.hordes.find((h) => h.phase !== 'rumour');
  const at = threat ?? home(sim);
  const d = (p) => Math.hypot(p.i - at.x, p.j - at.z);
  plan.tiles = plan.tiles.filter((t) => !sim.buildingAt(t.i, t.j)).sort((a, b) => d(a) - d(b));
  for (const t of plan.tiles) {
    if (s.res.funds < BUILDINGS[t.type].cost.funds + 80) break;
    sim.cmd('place', t.type, t.i, t.j);
  }
  for (const g of plan.gaps) {
    const towers = s.ents.buildings.filter((x) => x.type === 'tower' && Math.hypot(x.x - g.i, x.z - g.j) < 6).length;
    if (towers < 2 && s.res.funds > 100) placeNear(sim, 'tower', g.i, g.j, 2, 5);
  }
  const pressed = s.ents.buildings.filter((b) => b.press > 0.2 && BUILDINGS[b.type].wall).sort((a, b) => b.press - a.press);
  for (const w of pressed.slice(0, 3)) {
    const towers = s.ents.buildings.filter((x) => x.type === 'tower' && Math.hypot(x.x - w.x, x.z - w.z) < 6).length;
    if (towers >= 3 || s.res.funds < 100) continue;
    // Behind the wall: a step toward home.
    const h = home(sim), len = Math.hypot(h.x - w.x, h.z - w.z) || 1;
    placeNear(sim, 'tower', w.x + ((h.x - w.x) / len) * 3, w.z + ((h.z - w.z) / len) * 3, 0, 3);
  }
  // Raising the line is the last call on money: only a surplus the rest of the plan leaves untouched.
  if (sim.hasTech('e2')) {
    const walls = s.ents.buildings.filter((b) => b.type === 'wall' && b.built);
    const order = [...pressed.filter((b) => b.type === 'wall'), ...walls.sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))];
    for (const w of order) {
      if (s.res.funds < BUILDINGS.highwall.cost.funds + 650) break;
      if (w.built) sim.cmd('upgrade', w.id);
    }
  }
}

// A generalised competent player with knobs for style.
function strategist(sim, style) {
  const s = sim.state;
  const memory = { posts: new Set(), lastHour: -1, broken: new Set() };
  const prefs = style.decisions;
  return {
    memory,
    tick() {
      answerDecision(sim, prefs, style.decide);
      for (const l of [...s.events.letters]) sim.cmd('letter', l.id, 0);
      const hour = Math.floor(s.time);
      if (hour === memory.lastHour) return;
      memory.lastHour = hour;

      // Cabinet: accept what this style can plausibly deliver, and stop promising what it has failed to
      // deliver before (as a player learns which ministers ask for the impossible).
      for (const r of s.cabinet.requests) if (r.status === 'broken') memory.broken.add(r.defId);
      for (const r of s.cabinet.requests) {
        if (r.status !== 'offered') continue;
        const want = style.accept ? style.accept(sim, r) : style.accepts.includes(r.defId);
        sim.cmd('request', r.id, want && !memory.broken.has(r.defId));
      }

      // Border stance
      if (sim.day >= 2 && s.border !== style.border && (style.border !== 'shoot' || sim.hasLaw('security'))) sim.cmd('setBorder', style.border);

      // Laws in the style's order when affordable
      // Order collapsing: even a liberal government imposes a curfew.
      if (s.order < 35 && !sim.hasLaw('curfew')) sim.cmd('passLaw', 'curfew');
      // Every style stops signing laws when trust runs low, as a player watching the meter would.
      if (s.trust > Math.max(35, style.lawTrustFloor ?? 0)) for (const l of style.laws) if (!sim.hasLaw(l) && sim.cmd('passLaw', l).ok) break;

      const rates = s.rates;
      // Economy upkeep: keep food, funds and ammo positive.
      if (rates.food < 0.4 && s.res.food < 400 && s.res.funds > 60) placeNear(sim, 'farm', home(sim).x, home(sim).z, 3, 14);
      // Workers left for another producer (counting ones still being built).
      const { have, need } = workforce(sim);
      const spare = have - need;
      if (rates.funds < 2 && count(sim, 'factory') < 6 && spare >= BUILDINGS.factory.workers && s.res.funds > 90) placeNear(sim, 'factory', home(sim).x, home(sim).z, 3, 14);
      if (s.res.ammo < 150 && count(sim, 'munitions') < 1 + Math.floor(sim.day / 10) && s.res.funds > 100) placeNear(sim, 'munitions', home(sim).x, home(sim).z, 3, 14);
      if (count(sim, 'lab') < (sim.day < 8 ? 1 : 2) && s.res.funds > 140) placeNear(sim, 'lab', home(sim).x, home(sim).z, 3, 14);
      if (sim.day >= 3 && count(sim, 'barracks') < 1 && s.res.funds > 120) placeNear(sim, 'barracks', home(sim).x, home(sim).z, 3, 14);

      // Research: walk the style's research order.
      if (!s.research.active) for (const t of style.research) if (!sim.hasTech(t) && sim.cmd('research', t).ok) break;

      if (style.seal) sealBorder(sim, memory);
      // Border posts: checkpoint on each crossing (if screening) and towers around it.
      for (const c of sim.map.crossings) {
        const b = sim.buildingAt(c.i, c.j);
        if (style.checkpoints && !b && s.res.funds > 50) sim.cmd('place', 'checkpoint', c.i, c.j);
        const towersNear = s.ents.buildings.filter((x) => x.type === 'tower' && Math.hypot(x.x - c.x, x.z - c.z) < 6).length;
        if (towersNear < style.towersPerCrossing && s.res.funds > 60) placeNear(sim, 'tower', c.x - c.dx * 2, c.z - c.dz * 2, 1, 4);
        if (style.walls && s.res.funds > 120 && !memory.posts.has(c.id)) {
          // Seal around the crossing with a short wall arc, leaving the crossing tile itself (checkpoint/gate).
          const px = -c.dz, pz = c.dx;
          for (let k = -4; k <= 4; k++) if (k) { const i = Math.round(c.i + px * k), j = Math.round(c.j + pz * k); if (canPlace(sim, 'wall', i, j).ok) sim.cmd('place', 'wall', i, j); }
          if (!b && !style.checkpoints) sim.cmd('place', 'gate', c.i, c.j);
          memory.posts.add(c.id);
        }
      }
      if (style.camps && count(sim, 'camp') < Math.min(sim.map.crossings.length, 1 + Math.floor(sim.day / 4)) && s.res.funds > 120) {
        const c = sim.map.crossings[count(sim, 'camp') % sim.map.crossings.length];
        placeNear(sim, 'camp', c.x - c.dx * 6, c.z - c.dz * 6, 0, 6);
      }
      if (sim.day >= 4 && count(sim, 'hospital') < 1 && s.res.funds > 120) placeNear(sim, 'hospital', home(sim).x, home(sim).z, 4, 16);

      // Spend down: a competent player turns surplus into defence where the dead actually come from.
      memory.threat = memory.threat || {};
      for (const h of s.hordes) if (h.phase !== 'rumour' && !h.sea) {
        let best = null, bd = Infinity;
        for (const c of sim.map.crossings) { const d = Math.hypot(c.x - h.x, c.z - h.z); if (d < bd) { bd = d; best = c; } }
        if (best) memory.threat[best.id] = (memory.threat[best.id] || 0) + 1;
      }
      if (s.res.funds > 250 && sim.day >= 5) {
        const hot = [...sim.map.crossings].sort((a, b) => (memory.threat[b.id] || 0) - (memory.threat[a.id] || 0))[0];
        const towersNear = s.ents.buildings.filter((x) => x.type === 'tower' && Math.hypot(x.x - hot.x, x.z - hot.z) < 8).length;
        if (towersNear < 6) placeNear(sim, 'tower', hot.x - hot.dx * 3, hot.z - hot.dz * 3, 1, 5);
        if (sim.hasTech('e2')) { const w = s.ents.buildings.find((x) => x.type === 'wall' && x.built && Math.hypot(x.x - hot.x, x.z - hot.z) < 6); if (w) sim.cmd('upgrade', w.id); }
        if (sim.hasTech('e1') && count(sim, 'floodlight') < sim.map.crossings.length) placeNear(sim, 'floodlight', hot.x - hot.dx * 3, hot.z - hot.dz * 3, 1, 4);
        if (count(sim, 'depot') < 2) placeNear(sim, 'depot', hot.x - hot.dx * 8, hot.z - hot.dz * 8, 0, 6);
        if (sim.hasTech('k4') && count(sim, 'artillery') < 2) placeNear(sim, 'artillery', hot.x - hot.dx * 10, hot.z - hot.dz * 10, 0, 6);
        if (count(sim, 'radar') < 1) placeNear(sim, 'radar', home(sim).x, home(sim).z, 4, 14);
      }
      if (s.res.funds > 400) train(sim, 'infantry');
      if (s.res.funds > 600 && sim.day >= 10 && units(sim, 'apc').length < 4) train(sim, 'apc');

      // Army
      const alerted = s.towns.filter((t) => t.status === 'ok' && t.alerted);
      if (units(sim, 'hazmat').length < Math.min(6, 1 + alerted.length) && s.res.funds > 40) train(sim, 'hazmat');
      if (units(sim, 'infantry').length < style.infantry(sim) && s.res.funds > 40 && s.res.manpower > 15) train(sim, 'infantry');
      if (sim.day >= 8 && units(sim, 'sniper').length < 2 && s.res.funds > 60) train(sim, 'sniper');
      if (sim.day >= 6 && units(sim, 'engineers').length < 2 && s.res.funds > 40) train(sim, 'engineers');

      // Hazmat teams go to the worst reported outbreaks.
      const haz = units(sim, 'hazmat');
      const sorted = [...alerted].sort((a, b) => b.reported - a.reported);
      haz.forEach((u, n) => {
        const t = sorted[n % Math.max(1, sorted.length)];
        if (!t) return;
        const info = sim.map.towns[t.id];
        if (Math.hypot(u.x - info.x, u.z - info.z) > info.r + 1.5 && !u.path) sim.cmd('move', [u.id], info.x, info.z);
      });
      for (const t of alerted) if (t.breakout && !t.quarantine) sim.cmd('town', t.id, 'quarantine');
      // Lift quarantines once a town is clean again: every quarantined hour costs trust.
      for (const t of s.towns) if (t.quarantine && t.status === 'ok' && !t.alerted && !t.breakout) sim.cmd('town', t.id, 'quarantine');

      // Infantry respond to horde contact: go to the town the lead walker is heading for.
      const inf = units(sim, 'infantry');
      for (const h of s.hordes.filter((x) => x.phase === 'contact')) {
        const lead = s.ents.dead.find((z) => z.horde === h.id && !z.gone);
        if (!lead) continue;
        let best = null, bd = Infinity;
        for (const t of s.towns) if (t.status === 'ok') { const i = sim.map.towns[t.id]; const d = Math.hypot(i.x - lead.x, i.z - lead.z); if (d < bd) { bd = d; best = i; } }
        if (!best) continue;
        const free = inf.filter((u) => !u.path).slice(0, 4);
        if (free.length) sim.cmd('move', free.map((u) => u.id), (best.x * 2 + lead.x) / 3, (best.z * 2 + lead.z) / 3, 'attack');
      }
      // Dead inside the country: send the nearest idle squads.
      for (const z of s.ents.dead) {
        if (z.gone || !sim.map.owner[Math.floor(z.z) * sim.N + Math.floor(z.x)]) continue;
        const near = inf.filter((u) => !u.path && Math.hypot(u.x - z.x, u.z - z.z) < 25 && Math.hypot(u.x - z.x, u.z - z.z) > 4).slice(0, 2);
        if (near.length) sim.cmd('move', near.map((u) => u.id), z.x, z.z, 'attack');
        break;
      }
      if (s.trust < 35 && sim.cmd('action', 'broadcast').ok) return;
    },
  };
}

const STYLES = {
  balanced: {
    border: 'screened', checkpoints: true, towersPerCrossing: 2, walls: true, camps: true,
    laws: ['testing', 'curfew', 'broadcasts', 'rationing'],
    research: ['m1', 'k1', 'm2', 'e1', 'c1', 'k2', 'e2', 'm3', 'c2', 'e3', 'k3', 'c3', 'k4', 'e4', 'c4', 'm4'],
    decisions: { patientZero: 0, theyAreComing: 1, clinicStrike: 0, vitaxin: 1, children: 0, brigade: 0, freshOnes: 0, panicBuying: 0, showOfForce: 1, brutes: 0, citadel: 1, fishermen: 0, greatHorde: 0, coastWatch: 0, howlers: 0, lastBroadcast: 0, steelStrike: 0, turningTide: 0, survivors: 0, lastPush: 0 },
    accepts: ['towers', 'infantry', 'hazmat', 'hospital', 'contain', 'testingLaw', 'checkpoint', 'medResearch', 'food', 'cull'],
    infantry: (sim) => 3 + Math.floor(sim.day / 3),
  },
  turtle: {
    border: 'closed', checkpoints: false, towersPerCrossing: 3, walls: true, camps: false,
    laws: ['curfew', 'security', 'rationing', 'martial'],
    research: ['k1', 'e1', 'e2', 'k2', 'e3', 'k3', 'e4', 'k4', 'm1', 'm2', 'm3', 'c1', 'c2', 'c3', 'c4', 'm4'],
    decisions: { theyAreComing: 2, citadel: 0, vitaxin: 1, showOfForce: 1 },
    accepts: ['towers', 'infantry', 'martial', 'cull'],
    infantry: (sim) => 4 + Math.floor(sim.day / 3),
  },
  hawk: {
    border: 'shoot', checkpoints: false, towersPerCrossing: 2, walls: true, camps: false,
    laws: ['security', 'curfew', 'broadcasts', 'managed', 'martial', 'censorship', 'testing', 'detention', 'mercy'], lawTrustFloor: 45,
    research: ['k1', 'k2', 'e1', 'e2', 'm1', 'k3', 'k4', 'e3', 'm2', 'm3', 'c1', 'c2', 'e4', 'c3', 'c4', 'm4'],
    decisions: { patientZero: 0, theyAreComing: 2, clinicStrike: 1, vitaxin: 1, children: 1, brigade: 0, panicBuying: 0, showOfForce: 0, citadel: 0, fishermen: 1, steelStrike: 1, survivors: 1 },
    accepts: ['towers', 'infantry', 'martial', 'cull', 'checkpoint'],
    infantry: (sim) => 5 + Math.floor(sim.day / 2.5),
  },
  dove: {
    border: 'open', checkpoints: false, towersPerCrossing: 1, walls: false, camps: true,
    laws: ['broadcasts', 'testing', 'rationing'],
    research: ['m1', 'm2', 'c1', 'm3', 'c2', 'c3', 'k1', 'e1', 'k2', 'e2', 'c4', 'm4', 'e3', 'k3', 'k4', 'e4'],
    decisions: { patientZero: 0, theyAreComing: 0, clinicStrike: 0, vitaxin: 1, children: 0, brigade: 0, panicBuying: 1, showOfForce: 1, citadel: 1, fishermen: 0, lastBroadcast: 0, survivors: 0, lastPush: 0 },
    accepts: ['hazmat', 'hospital', 'contain', 'testingLaw', 'keepOpen', 'admit', 'food', 'liftQuarantine', 'address', 'noLaws', 'medResearch'],
    infantry: (sim) => 3 + Math.floor(sim.day / 4),
  },
};

// ---- The expert: a strong player who reads the situation and changes approach --------------------------------
// It plays the balanced style, but every hour it looks at its weakest point and leans away from it (trust sliding
// → gentler: screen rather than close, broadcast, no harsh laws; order sliding → curfew; the border breaking →
// heavier defence where the hordes come), answers decisions by the costs printed on each card, promises only what
// it can deliver and then delivers it, and uses the crisis tools (airstrikes, evacuation, reclaiming towns).

const COST_KEYS = ['trust', 'order', 'funds', 'food', 'ammo', 'manpower', 'authority', 'research'];
// The stated effects of a card: "Trust −20 · Order +4 · If it leaks: Trust −12" → { trust: -26, order: 4 }
// (a risk counts at half; "Trust +" without a number counts as 3).
export function effectCosts(text) {
  const out = {};
  for (const part of String(text).split('·')) {
    const risk = /^\s*if\b/i.test(part) ? 0.5 : 1;
    for (const m of part.matchAll(/(Trust|Order|Funds|Food|Ammo|Manpower|Authority|Research)\s*([+−-])\s*(\d+)?/gi)) {
      const k = m[1].toLowerCase(), sign = m[2] === '+' ? 1 : -1, n = m[3] ? +m[3] : 3;
      out[k] = (out[k] || 0) + sign * n * risk;
    }
  }
  return out;
}

// How much each meter matters right now: a sliding meter matters a lot.
function weights(sim) {
  const s = sim.state;
  const meter = (v) => (v < 30 ? 4 : v < 45 ? 2.5 : v < 60 ? 1.2 : 0.6);
  return {
    trust: meter(s.trust), order: meter(s.order), funds: s.res.funds < 150 ? 0.08 : 0.03, food: s.res.food < 150 ? 0.08 : 0.02,
    ammo: s.res.ammo < 150 ? 0.08 : 0.02, manpower: 0.04, authority: 0.15, research: 0.05,
  };
}
export function decideByCosts(sim, id) {
  const w = weights(sim);
  let best = 0, bestScore = -Infinity;
  DECISION_BY_ID[id].choices.forEach((c, k) => {
    const text = typeof c.effect === 'function' ? c.effect(sim) : c.effect;
    const costs = effectCosts(text);
    // A horde a card sends at you is a cost too: the full horde counts like a heavy trust hit, a weakened one less.
    const pct = /(\d+)% strength/i.exec(text);
    const horde = /full horde/i.test(text) ? 1 : pct ? +pct[1] / 100 : 0;
    const score = COST_KEYS.reduce((a, key) => a + (costs[key] || 0) * w[key], 0) - horde * 30;
    if (score > bestScore) { bestScore = score; best = k; }
  });
  return best;
}

// Whether a cabinet request can be delivered with what the country has (the expert then acts on it).
function canDeliver(sim, r) {
  const s = sim.state, p = r.p || {};
  switch (r.defId) {
    case 'towers': return s.res.funds > 140;
    case 'infantry': return s.res.funds > 140 && s.res.manpower > 50;
    case 'checkpoint': return s.res.funds > 80;
    case 'hazmat': return units(sim, 'hazmat').length > 0;
    case 'hospital': return count(sim, 'hospital') > 0 || s.res.funds > 160;
    case 'testingLaw': return sim.hasLaw('testing') || s.res.authority > 12;
    case 'contain': return units(sim, 'hazmat').length > 1 && (s.towns[p.town]?.reported ?? 99) < 40;
    case 'keepOpen': case 'admit': return s.border === 'open';
    case 'food': return s.res.food > 300;
    case 'liftQuarantine': return !s.towns[p.town]?.alerted;
    case 'address': return true;
    case 'medResearch': return sim.hasTech(p.tech) || s.research.active === p.tech;
    default: return false; // cull, martial, noLaws: outside our control or against the plan
  }
}
// Deliver what was promised.
function deliver(sim) {
  const s = sim.state;
  for (const r of s.cabinet.requests) {
    if (r.status !== 'accepted') continue;
    const p = r.p || {};
    if (r.defId === 'towers') { const c = sim.map.crossings[p.crossing]; placeNear(sim, 'tower', c.x - c.dx * 2, c.z - c.dz * 2, 1, 5); }
    else if (r.defId === 'infantry') train(sim, 'infantry');
    else if (r.defId === 'checkpoint') { const c = sim.map.crossings[p.crossing]; if (!sim.buildingAt(c.i, c.j)) sim.cmd('place', 'checkpoint', c.i, c.j); }
    else if (r.defId === 'hazmat') { const u = units(sim, 'hazmat')[0], t = sim.map.towns[p.town]; if (u && t) sim.cmd('move', [u.id], t.x, t.z); }
    else if (r.defId === 'hospital' && !count(sim, 'hospital')) placeNear(sim, 'hospital', home(sim).x, home(sim).z, 4, 16);
    else if (r.defId === 'testingLaw') sim.cmd('passLaw', 'testing');
    else if (r.defId === 'liftQuarantine' && s.towns[p.town]?.quarantine) sim.cmd('town', p.town, 'quarantine');
    else if (r.defId === 'address') sim.cmd('action', 'broadcast');
    else if (r.defId === 'medResearch' && !s.research.active) sim.cmd('research', p.tech);
  }
}

// ---- The new units (B11) ------------------------------------------------------------------------------------------
// Where the dead press on the wall line, two machine-gun teams dig in behind each pressed section facing out, the
// mortar teams (after Field Doctrine) stand further back behind the hottest section, a medic team stays with every
// four squads posted there, and one scout holds a lookout behind the crossing the hordes come for.

const SECTION_R = 6;      // pressed walls this close together are one section
const ACTIVE_H = 72;      // a section pressed within this many hours still wants its teams
// Tiles behind the wall (MG teams side by side ±MG_SIDE, the medic within 3 tiles of both, mortars beyond 3 of the
// pile), and how far back an MG team starts its last stretch so that it digs in facing out.
const BACK = { mg: 3.5, medic: 4.5, mortar: 6, scout: 5 }, MG_SIDE = 1.5, STAGE = 2;
// Funds a team leaves over when it is trained: enough for the walls the dead tear down, and for MG teams the towers
// behind pressed walls too (bought from 100), since an MG team bought before them costs the expert days (B11).
const RESERVE = { mg: 100, mortar: 40, medic: 40, scout: 40 };

// A free tile on the home side of the wall line (`side`, seal.js) near (x, z) that a unit can stand on, at least a
// tile behind `at` (x, z, outward ox, oz).
function standAt(sim, side, at, x, z, taken) {
  const N = sim.N;
  for (let r = 0; r <= 2; r++) {
    const n = r ? 8 * r : 1;
    for (let a = 0; a < n; a++) {
      const i = Math.floor(x + Math.cos((a / n) * Math.PI * 2) * r), j = Math.floor(z + Math.sin((a / n) * Math.PI * 2) * r);
      if (i < 1 || j < 1 || i >= N - 1 || j >= N - 1) continue;
      const k = j * N + i;
      if (taken.has(k) || side[k] || !sim.nav.unitPass(k) || sim.buildingAt(i, j)) continue;
      if ((i + 0.5 - at.x) * at.ox + (j + 0.5 - at.z) * at.oz > -1) continue;
      taken.add(k);
      return [i + 0.5, j + 0.5];
    }
  }
  return null;
}

// Pressed wall sections: each starts where a wall is first pressed, facing out across the line there (from the home
// side to the far side, within 3 tiles); its heat is the press on its walls, cooling by a tenth an hour.
function pressedSections(sim, mem, side) {
  const s = sim.state, N = sim.N;
  for (const c of mem.secs) c.heat *= 0.9;
  for (const b of s.ents.buildings) {
    if (!BUILDINGS[b.type].wall || !(b.press > 0.2) || s.time - (b.hitT ?? -1e9) > 1.5) continue;
    let sec = mem.secs.find((c) => Math.hypot(c.x - b.x, c.z - b.z) < SECTION_R);
    if (!sec) {
      let ox = 0, oz = 0;
      for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
        const i = b.i + di, j = b.j + dj;
        if (i < 0 || j < 0 || i >= N || j >= N || di * di + dj * dj > 9) continue;
        // Mountains are outside the plan's graph (side 0 by default): they say nothing about which way is out.
        if (sim.map.terrain[j * N + i] === TER.MOUNTAIN) continue;
        const w = side[j * N + i] === 2 ? 1 : side[j * N + i] === 0 ? -1 : 0;
        ox += di * w; oz += dj * w;
      }
      const len = Math.hypot(ox, oz);
      if (len < 1e-6) continue;
      sec = { id: mem.secs.length, x: b.x, z: b.z, ox: ox / len, oz: oz / len, heat: 0, last: 0 };
      mem.secs.push(sec);
    }
    sec.heat += b.press;
    sec.last = s.time;
  }
  return mem.secs.filter((c) => s.time - c.last < ACTIVE_H).sort((a, b) => b.heat - a.heat);
}

// Sends a posted unit on to its spot (an MG team by way of its stage behind it); once there, a lookout holds.
function walk(sim, u, p) {
  if (u.path) return;
  const near = (q) => Math.hypot(u.x - q[0], u.z - q[1]) < 0.8;
  if (near(p.spot)) { if (p.hold && u.order !== 'hold') sim.cmd('hold', [u.id]); return; }
  if (p.stage && !p.staged && near(p.stage)) p.staged = true;
  const [x, z] = p.stage && !p.staged ? p.stage : p.spot;
  if (!sim.cmd('move', [u.id], x, z).ok) {
    if (p.stage && !p.staged) p.staged = true;
    else p.lost = true;
  }
}

// `seal` is the strategist's wall plan: while it still has walls to build, the teams wait (the line comes first).
function fieldTeams(sim, mem, seal) {
  const s = sim.state;
  if (!seal?.side) return;
  const lineOpen = seal.tiles.some((t) => !sim.buildingAt(t.i, t.j));
  mem.secs ||= [];
  mem.posts ||= new Map();
  const active = pressedSections(sim, mem, seal.side);
  for (const [id, p] of mem.posts) if (!sim.byId(id) || p.lost) mem.posts.delete(id);
  const taken = new Set([...mem.posts.values()].map((p) => Math.floor(p.spot[1]) * sim.N + Math.floor(p.spot[0])));
  const postedAt = (sec, role) => [...mem.posts.values()].filter((p) => p.sec === sec && p.role === role);
  const queued = (type) => s.ents.buildings.reduce((a, b) => a + (b.queue ? b.queue.filter((q) => q === type).length : 0), 0);
  // Units of a type free to post: new ones first, then ones at a section no longer pressed.
  const free = (type) => {
    const posted = new Set([...mem.posts.keys()]);
    const fresh = units(sim, type).filter((u) => !posted.has(u.id));
    const stale = units(sim, type).filter((u) => posted.has(u.id) && mem.posts.get(u.id).sec && !active.includes(mem.posts.get(u.id).sec));
    return [...fresh, ...stale];
  };
  const post = (u, sec, role, spot, extra = {}) => {
    const old = mem.posts.get(u.id);
    if (old) taken.delete(Math.floor(old.spot[1]) * sim.N + Math.floor(old.spot[0]));
    mem.posts.set(u.id, { sec, role, spot, ...extra });
  };
  // Teams are trained only once the line is closed, and only while they leave their RESERVE over.
  const afford = (type) => !lineOpen && s.res.funds > UNITS[type].cost.funds + RESERVE[type];
  const behind = (sec, back, flank = 0) => [sec.x - sec.ox * back - sec.oz * flank, sec.z - sec.oz * back + sec.ox * flank];

  // One or two mortar teams behind the hottest section, moving only when the one they cover has gone quiet. They
  // come first: one shell into a pile kills more than an MG team does in hours.
  const hottest = active[0];
  if (hottest && sim.hasTech('k2')) {
    const want = Math.min(2, active.length);
    const mortars = units(sim, 'mortar');
    for (const u of mortars) {
      const p = mem.posts.get(u.id);
      if (p && active.includes(p.sec) && s.time - p.sec.last < 6) continue;
      if (p && p.sec === hottest) continue;
      const n = postedAt(hottest, 'mortar').length;
      const spot = standAt(sim, seal.side, hottest, ...behind(hottest, BACK.mortar, n ? MG_SIDE : 0), taken);
      if (spot) post(u, hottest, 'mortar', spot);
    }
    if (mortars.length + queued('mortar') < want && afford('mortar')) train(sim, 'mortar');
  }

  // Two MG teams behind every pressed section, side by side, facing out.
  let mgShort = 0;
  const mgPool = free('mg');
  for (const sec of active) {
    const flanks = postedAt(sec, 'mg').map((p) => p.flank);
    for (const flank of [-MG_SIDE, MG_SIDE]) {
      if (flanks.includes(flank)) continue;
      const u = mgPool.shift();
      if (!u) { mgShort++; continue; }
      const spot = standAt(sim, seal.side, sec, ...behind(sec, BACK.mg, flank), taken);
      if (!spot) continue;
      post(u, sec, 'mg', spot, { flank, stage: [spot[0] - sec.ox * STAGE, spot[1] - sec.oz * STAGE] });
    }
  }
  if (mgShort > queued('mg') && afford('mg')) train(sim, 'mg');

  // A medic team for every four squads at the pressed sections, with the section that has most squads per medic.
  if (active.length) {
    const squadsAt = (sec) => postedAt(sec, 'mg').length + postedAt(sec, 'mortar').length
      + units(sim, 'infantry').filter((u) => Math.hypot(u.x - sec.x, u.z - sec.z) < 8).length;
    const total = active.reduce((a, sec) => a + squadsAt(sec), 0);
    const medics = units(sim, 'medic');
    const want = Math.floor(total / 4);
    for (const u of free('medic')) {
      const sec = [...active].sort((a, b) => squadsAt(b) / (1 + postedAt(b, 'medic').length) - squadsAt(a) / (1 + postedAt(a, 'medic').length))[0];
      if (!squadsAt(sec)) break;
      const spot = standAt(sim, seal.side, sec, ...behind(sec, BACK.medic), taken);
      if (spot) post(u, sec, 'medic', spot);
    }
    if (medics.length + queued('medic') < want && afford('medic')) train(sim, 'medic');
  }

  // One scout on Hold behind the crossing nearest the horde on its way (so it watches rather than runs).
  const horde = s.hordes.find((h) => h.phase !== 'rumour' && !h.sea);
  if (horde) {
    let best = null, bd = Infinity;
    for (const c of sim.map.crossings) { const d = Math.hypot(c.x - horde.x, c.z - horde.z); if (d < bd) { bd = d; best = c; } }
    mem.watch = best;
  }
  if (mem.watch) {
    const c = mem.watch, at = { x: c.x, z: c.z, ox: c.dx, oz: c.dz };
    const scouts = units(sim, 'scout');
    const u = scouts[0];
    const p = u && mem.posts.get(u.id);
    if (u && (!p || p.crossing !== c.id)) {
      const spot = standAt(sim, seal.side, at, c.x - c.dx * BACK.scout, c.z - c.dz * BACK.scout, taken);
      if (spot) post(u, null, 'scout', spot, { hold: true, crossing: c.id });
    }
    if (!scouts.length && !queued('scout') && afford('scout')) train(sim, 'scout');
  }

  for (const [id, p] of mem.posts) walk(sim, sim.byId(id), p);
}

function expert(sim) {
  const s = sim.state;
  const style = { ...STYLES.balanced, walls: false, seal: true, infantry: (sm) => 4 + Math.floor(sm.day / 3), decide: decideByCosts, accept: canDeliver };
  const base = strategist(sim, style);
  const field = {};
  let lastHour = -1;
  return {
    tick() {
      const hour = Math.floor(s.time), newHour = hour !== lastHour;
      if (newHour) {
        lastHour = hour;
        // Lean away from the weakest point.
        const insideDead = s.ents.dead.filter((z) => !z.gone && sim.map.owner[Math.floor(z.z) * sim.N + Math.floor(z.x)]).length;
        const lost = s.towns.filter((t) => t.status !== 'ok').length;
        const pressed = insideDead > 15 || lost > 0 || s.hordes.some((h) => h.phase === 'contact');
        style.border = s.trust >= 45 && s.res.manpower < 60 ? 'open' : 'screened';
        style.laws = s.trust < 50 ? (s.order < 40 ? ['curfew'] : []) : ['testing', 'curfew', 'broadcasts', 'rationing'];
        style.towersPerCrossing = pressed ? 3 : 2;
        deliver(sim);
        // Crisis tools: an airstrike on a big horde at the border, evacuate a town about to fall, reclaim when strong.
        for (const h of s.hordes) {
          if (h.phase !== 'contact' || (h.members || 0) < 40) continue;
          const lead = s.ents.dead.find((z) => z.horde === h.id && !z.gone);
          if (lead && sim.cmd('action', 'airstrike', lead.x, lead.z).ok) break;
        }
        for (const t of s.towns) {
          if (t.status === 'ok' && t.breakout && !sim.map.towns[t.id].capital && t.infected / Math.max(1, t.pop) > 0.3) sim.cmd('town', t.id, 'evacuate');
        }
        const calm = !s.hordes.some((h) => h.phase === 'contact') && insideDead < 5;
        if (calm && s.res.funds > 300 && units(sim, 'infantry').length >= 8) {
          const fallen = s.towns.find((t) => t.status === 'fallen' && !(t.reclaimT > 0));
          if (fallen && sim.cmd('town', fallen.id, 'reclaim').ok) {
            const info = sim.map.towns[fallen.id];
            sim.cmd('move', units(sim, 'infantry').slice(0, 3).map((u) => u.id), info.x, info.z, 'attack');
          }
        }
        if (s.trust < 45) sim.cmd('action', 'broadcast');
      }
      base.tick();
      // The new units are bought from what the strategist's hour leaves (B11: bought first, they cost it days).
      if (newHour) fieldTeams(sim, field, base.memory.seal);
    },
  };
}

export const BOTS = {
  idle(sim) {
    return {
      tick() {
        const s = sim.state;
        if (s.events.decision) sim.cmd('decide', 0);
        for (const r of s.cabinet.requests) if (r.status === 'offered') sim.cmd('request', r.id, false);
      },
    };
  },
  ...Object.fromEntries(Object.entries(STYLES).map(([k, st]) => [k, (sim) => strategist(sim, st)])),
  expert,
};
