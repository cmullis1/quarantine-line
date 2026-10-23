// Starting conditions for each mode.
import { HORDE } from '../../config/balance.js';
import { canPlace } from '../commands.js';
import { makeBuilding, spawnUnit } from '../entities.js';

export function findSpot(sim, type, ci, cj, minR, maxR = 20, prefer = null) {
  let best = null, bs = -Infinity;
  for (let r = minR; r <= maxR; r++) {
    for (let a = 0; a < 48; a++) {
      const i = Math.round(ci + Math.cos((a / 48) * Math.PI * 2) * r), j = Math.round(cj + Math.sin((a / 48) * Math.PI * 2) * r);
      if (!canPlace(sim, type, i, j, { free: true }).ok) continue;
      const score = prefer ? prefer(i, j) - r * 0.01 : -r;
      if (score > bs) { bs = score; best = [i, j]; }
    }
    if (best && !prefer) return best;
    if (best && prefer && r > minR + 4) return best;
  }
  return best;
}

export function setupScenario(sim, opts = {}) {
  const s = sim.state;
  const m = sim.map;
  const cap = m.towns.find((t) => t.capital);
  const hq = findSpot(sim, 'hq', cap.i, cap.j, Math.ceil(cap.r) + 2);
  const hqb = makeBuilding(sim, 'hq', hq[0], hq[1], { instant: true });
  const farmScore = (i, j) => {
    let f = 0;
    for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) f += m.farmland[(j + dj) * m.N + i + di];
    return f;
  };
  const farm = findSpot(sim, 'farm', cap.i, cap.j, Math.ceil(cap.r) + 3, 16, farmScore);
  if (farm) makeBuilding(sim, 'farm', farm[0], farm[1], { instant: true });

  const sx = hqb.x, sz = hqb.z + 2;
  for (let k = 0; k < 3; k++) spawnUnit(sim, 'infantry', sx - 1.2 + k * 1.2, sz);
  spawnUnit(sim, 'hazmat', sx + 2.2, sz + 1);
  spawnUnit(sim, 'engineers', sx - 2.2, sz + 1);
  for (const u of s.ents.units) {
    const p = sim.nav.nearestPassable(Math.floor(u.x), Math.floor(u.z));
    if (p) { u.x = p[0] + 0.5 + (u.x % 1) * 0.2; u.z = p[1] + 0.5; }
  }

  s.hordeT = HORDE.firstHour;
  s.events.nextRandom = 5 * 24 + sim.range(0, 30);
  s.cabinet.nextAt = 2 * 24 + 8;

  if (s.mode === 'tutorial') {
    s.tutorial = { step: 0, done: [] };
    s.flags.noSpawns = true;
    s.hordeT = Infinity;
    return;
  }
  // Patient zero: the campaign's Kessel, or in a sandbox the town closest to a foreign city.
  let pz = m.towns.find((t) => t.name === 'Kessel');
  if (!pz) {
    let bd = Infinity;
    for (const t of m.towns) {
      if (t.capital) continue;
      for (const site of m.sites) {
        const d = Math.hypot(site.i - t.i, site.j - t.j);
        if (d < bd) { bd = d; pz = t; }
      }
    }
  }
  s.towns[pz.id].infected = 6;
  s.flags.patientZero = pz.id;
}
