// Towns: hidden infection, delayed and imperfect reporting, breakouts, falls, spread along roads,
// evacuation, sterilisation and reclamation.
import { SPREAD, POLITICS } from '../../config/balance.js';
import { BUILDINGS } from '../../config/buildings.js';
import { UNITS } from '../../config/units.js';
import { TOWN_ACTIONS } from '../../config/actions.js';
import { spawnDead, spawnBus, killDead } from '../entities.js';
import { hitTrust, changeTrust, changeOrder } from './economy.js';

export function breakoutThreshold(sim) {
  return SPREAD.breakout + (sim.hasTech('m3') ? 100 : 0);
}

function hospitalNear(sim, info) {
  return sim.state.ents.buildings.some((b) => b.type === 'hospital' && b.built && Math.hypot(b.x - info.x, b.z - info.z) < BUILDINGS.hospital.radius);
}

export function detection(sim, t) {
  const s = sim.state, info = sim.map.towns[t.id];
  let d = SPREAD.detectBase;
  if (s.flags.public) d += SPREAD.detectPublic;
  if (s.flags.suppressed) d += SPREAD.detectSuppressed;
  if (sim.hasLaw('testing')) d += 0.15;
  if (s.flags.kesselNurses && info.name === 'Kessel') d += 0.15;
  if (sim.hasTech('m2')) d += 0.15;
  if (hospitalNear(sim, info)) d += SPREAD.detectHospital;
  if (s.ents.units.some((u) => UNITS[u.type].detect && Math.hypot(u.x - info.x, u.z - info.z) < info.r + 3)) d += SPREAD.detectHazmat;
  if (s.trust < 30) d += SPREAD.detectLowTrust;
  else if (s.trust >= 70) d += SPREAD.detectHighTrust;
  return Math.max(0.05, Math.min(1, d));
}

export function containment(sim, info) {
  let c = 0;
  for (const u of sim.state.ents.units) {
    if (Math.hypot(u.x - info.x, u.z - info.z) >= info.r + 2.5) continue;
    let v = UNITS[u.type].contain;
    if (u.type === 'hazmat' && sim.hasTech('m2')) v *= 1.5;
    c += v;
  }
  if (sim.hasLaw('detention')) c *= 1.5;
  return c;
}

function growthRate(sim, t, info) {
  let g = SPREAD.growth * sim.diff.spread;
  if (t.quarantine) g *= SPREAD.quarantine;
  if (sim.hasLaw('curfew')) g *= SPREAD.curfew;
  if (sim.hasLaw('martial')) g *= 0.9;
  if (sim.hasLaw('mercy')) g *= 0.75;
  if (sim.hasTech('m3')) g *= 0.8;
  if (hospitalNear(sim, info)) g *= 0.7;
  return g;
}

export function fallTown(sim, t) {
  const s = sim.state, info = sim.map.towns[t.id];
  t.status = 'fallen';
  t.residual = Math.round((SPREAD.residualBase + t.pop * SPREAD.residualPerPop) * sim.diff.horde * (sim.hasLaw('scorched') ? 0.5 : 1));
  s.stats.deadPeople += t.pop;
  t.deaths += t.pop;
  t.pop = 0; t.infected = 0; t.alerted = false; t.quarantine = false; t.sacrifice = false; t.reclaimT = 0;
  t.fireT = 40;
  s.stats.townsLost++;
  sim.flowDirty = true;
  if (!info.capital) hitTrust(sim, POLITICS.fallenTrust, 'fallen towns');
  sim.alert('fall', `${info.name.toUpperCase()} HAS FALLEN.`, info.x, info.z, 'bad');
  sim.emit('fall', { town: t.id });
  sim.lesson('fall');
}

export function startEvacuation(sim, townId) {
  const s = sim.state, t = s.towns[townId], info = sim.map.towns[townId];
  const a = TOWN_ACTIONS.evacuate;
  if (t.status !== 'ok') return { ok: false, why: 'Town is not inhabited' };
  if (info.capital) return { ok: false, why: 'The capital is where people evacuate to' };
  if (s.time < t.evacUntil) return { ok: false, why: `Buses busy for ${Math.ceil(t.evacUntil - s.time)} h` };
  if (!sim.canAfford(a.cost)) return { ok: false, why: 'Not enough funds' };
  const dest = sim.map.towns.find((x) => x.capital && s.towns[x.id].status === 'ok');
  if (!dest) return { ok: false, why: 'Nowhere safe to go' };
  sim.pay(a.cost);
  t.evacUntil = s.time + a.cooldown;
  for (let n = 0; n < a.buses; n++) {
    const pax = Math.min(a.perBus, t.pop * 0.12);
    if (pax < 200) break;
    const infCases = t.infected * (pax / t.pop);
    t.pop -= pax; t.infected -= infCases;
    spawnBus(sim, townId, dest.id, pax, infCases);
  }
  sim.alert('evacuate', `Evacuation of ${info.name} under way.`, info.x, info.z, 'warn');
  sim.lesson('evacuate');
  return { ok: true };
}

export function sterilise(sim, townId) {
  const s = sim.state, t = s.towns[townId], info = sim.map.towns[townId];
  const a = TOWN_ACTIONS.sterilise;
  if (t.status !== 'ok') return { ok: false, why: 'Nothing left to sterilise' };
  if (info.capital) return { ok: false, why: 'Not the capital' };
  const cost = { authority: sim.hasLaw('scorched') ? a.cost.authority / 2 : a.cost.authority };
  if (!sim.canAfford(cost)) return { ok: false, why: 'Not enough authority' };
  sim.pay(cost);
  for (const z of s.ents.dead) if (Math.hypot(z.x - info.x, z.z - info.z) < info.r + 1.5) killDead(sim, z, 'fire');
  const survivors = t.pop * a.survivors * Math.max(0, 1 - t.infected / Math.max(1, t.pop));
  const killed = t.pop - survivors;
  s.stats.deadPeople += killed;
  t.deaths += killed;
  const cap = sim.map.towns.find((x) => x.capital);
  if (s.towns[cap.id].status === 'ok') s.towns[cap.id].pop += survivors;
  t.pop = 0; t.infected = 0; t.alerted = false; t.quarantine = false; t.status = 'scorched'; t.residual = 0; t.fireT = 30;
  hitTrust(sim, -a.trust, 'sterilisation');
  changeOrder(sim, a.order, 'sterilisation');
  sim.flowDirty = true;
  sim.alert('sterilise', `${info.name} has been sterilised.`, info.x, info.z, 'bad');
  sim.emit('sterilise', { town: townId, x: info.x, z: info.z, r: info.r });
  return { ok: true };
}

export function startReclaim(sim, townId) {
  const t = sim.state.towns[townId];
  if (t.status !== 'fallen' && t.status !== 'scorched') return { ok: false, why: 'Town is not lost' };
  if (t.reclaimT > 0) return { ok: false, why: 'Already reclaiming' };
  t.reclaimT = 0.001;
  sim.lesson('reclaim');
  return { ok: true };
}

function reclaimTick(sim, t, info, dt) {
  const s = sim.state;
  const held = s.ents.units.some((u) => !u.air && Math.hypot(u.x - info.x, u.z - info.z) < info.r + 1);
  let clear = true;
  sim.deadHash.query(info.x, info.z, info.r + 3, () => { clear = false; });
  if (held && clear) t.reclaimT += dt; else t.reclaimT = Math.max(0.001, t.reclaimT - dt * 2);
  if (t.reclaimT >= SPREAD.reclaimHours) {
    t.status = 'ok';
    t.reclaimT = 0;
    t.residual = 0;
    t.pop = t.pop0 * 0.05;
    t.reclaimed = true;
    s.stats.townsReclaimed++;
    changeTrust(sim, 8, 'reclaimed towns');
    sim.flowDirty = true;
    sim.alert('reclaim', `${info.name} has been reclaimed. People are coming home.`, info.x, info.z, 'good');
    sim.emit('reclaim', { town: t.id });
  }
}

export function townSystem(sim, dt) {
  const s = sim.state;
  const hourTick = Math.floor(s.time) !== Math.floor(s.time - dt);
  const threshold = breakoutThreshold(sim);
  for (const t of s.towns) {
    const info = sim.map.towns[t.id];
    if (t.status !== 'ok') {
      t.fireT = Math.max(0, t.fireT - dt);
      if (t.status === 'fallen' && t.residual > 0 && sim.chance(SPREAD.residualRate * dt)) {
        const k = sim.pick(info.tiles);
        spawnDead(sim, sim.act >= 2 && sim.chance(0.25) ? 'runner' : 'walker', (k % sim.N) + 0.5, ((k / sim.N) | 0) + 0.5);
        t.residual--;
      }
      if (t.reclaimT > 0) reclaimTick(sim, t, info, dt);
      continue;
    }

    if (t.infected > 0) {
      t.infected += t.infected * growthRate(sim, t, info) * Math.max(0, 1 - t.infected / t.pop) * dt;
      t.infected = Math.max(0, t.infected - containment(sim, info) * dt);
      const died = t.infected * SPREAD.deathRate * dt;
      t.infected -= died; t.pop -= died; t.deaths += died; s.stats.deadPeople += died;
      if (t.infected > threshold) {
        t.spawnAcc += Math.min(SPREAD.breakoutRateCap, t.infected / SPREAD.breakoutPer) * dt;
        while (t.spawnAcc >= 1) {
          t.spawnAcc--;
          const k = sim.pick(info.tiles);
          // The freshly turned are fast.
          const type = sim.act >= 2 && sim.chance(0.35) ? 'runner' : 'walker';
          spawnDead(sim, type, (k % sim.N) + 0.5, ((k / sim.N) | 0) + 0.5, { rise: true });
          t.infected -= SPREAD.spawnCost; t.pop -= SPREAD.spawnCost;
        }
        if (!t.breakout) { t.breakout = true; sim.alert('breakout', `BREAKOUT in ${info.name}: the sick are turning in the streets!`, info.x, info.z, 'bad'); sim.lesson('breakout'); }
      } else t.breakout = false;
    }
    if (t.reclaimed && t.pop < t.pop0 * 0.6) t.pop += (t.pop0 * SPREAD.resettleRate * (sim.hasTech('c4') ? 3 : 1) * dt) / 24;

    if (hourTick) {
      t.hist.push(t.infected);
      if (t.hist.length > 25) t.hist.shift();
      const censored = sim.hasLaw('censorship');
      const delay = censored ? 24 : SPREAD.reportDelay;
      const past = t.hist[Math.max(0, t.hist.length - 1 - delay)] ?? 0;
      let rep = past * detection(sim, t);
      if (censored) rep *= 0.4 + sim.rand() * 1.2;
      t.reported = rep < 1 ? 0 : Math.round(rep);
    }
    if (!t.alerted && t.reported >= SPREAD.outbreakReported) {
      t.alerted = true;
      t.outbreaks++;
      sim.alert('outbreak', `Outbreak confirmed in ${info.name}. Send a Quarantine Team.`, info.x, info.z, 'bad');
      sim.lesson('outbreak');
      if (s.flags.suppressed && !s.flags.exposed) {
        s.flags.exposed = true;
        hitTrust(sim, 12, 'cover-up exposed');
        sim.alert('scandal', 'The Kessel cover-up has leaked to the press.', null, null, 'bad');
      }
    } else if (t.alerted && t.infected < 0.5) {
      t.alerted = false;
      t.infected = 0;
      t.reported = 0;
      t.hist = [];
      changeTrust(sim, POLITICS.containedTrust, 'contained outbreaks');
      sim.alert('contained', `${info.name}: outbreak contained.`, info.x, info.z, 'good');
    }
    if (t.pop < SPREAD.minPop || t.infected > t.pop * SPREAD.fallFraction) fallTown(sim, t);
  }

  // Seeding along the road network: travellers carry the infection between towns.
  if (hourTick) {
    const order = s.order;
    for (const e of sim.map.roadEdges) {
      for (const [a, b] of [[e.a, e.b], [e.b, e.a]]) {
        const ta = s.towns[a], tb = s.towns[b];
        if (ta.status !== 'ok' || tb.status !== 'ok' || ta.infected < 1) continue;
        let flow = ta.infected * SPREAD.travel * sim.diff.spread;
        if (ta.quarantine) flow *= SPREAD.quarantineTravel;
        if (tb.quarantine) flow *= 0.5;
        if (sim.hasLaw('curfew')) flow *= 0.5;
        if (order < 30) flow *= SPREAD.lowOrderTravel;
        tb.infected += flow;
      }
    }
  }
}
