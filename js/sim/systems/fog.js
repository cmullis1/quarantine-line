// Fog of war. Home territory is always visible (civilians report sightings). Abroad, you see what your
// units, structures, border posts, radar and recon flights can see. `state.fog.seen` remembers tiles.
import { VISION, WEATHER } from '../../config/balance.js';
import { BUILDINGS } from '../../config/buildings.js';
import { UNITS } from '../../config/units.js';

function stamp(vis, N, x, z, r) {
  const r2 = r * r;
  const i0 = Math.max(0, Math.floor(x - r)), i1 = Math.min(N - 1, Math.floor(x + r));
  const j0 = Math.max(0, Math.floor(z - r)), j1 = Math.min(N - 1, Math.floor(z + r));
  for (let j = j0; j <= j1; j++) {
    const dz = j + 0.5 - z;
    for (let i = i0; i <= i1; i++) {
      const dx = i + 0.5 - x;
      if (dx * dx + dz * dz <= r2) vis[j * N + i] = 1;
    }
  }
}

function staticVision(sim) {
  if (sim.staticVis) return sim.staticVis;
  const N = sim.N, m = sim.map, v = new Uint8Array(N * N);
  const coast = sim.state.flags.coastWatch;
  for (let k = 0; k < N * N; k++) {
    if (m.owner[k]) v[k] = 1;
    if (m.border[k]) stamp(v, N, (k % N) + 0.5, ((k / N) | 0) + 0.5, VISION.borderReach);
    if (coast && m.sand[k] && m.owner[k]) stamp(v, N, (k % N) + 0.5, ((k / N) | 0) + 0.5, 6);
  }
  sim.staticVis = v;
  return v;
}

// How much of a unit's or structure's sight is left now: less at night, in fog and in rain.
function sightFactor(sim) {
  const wx = sim.weather;
  return (sim.night ? 0.75 : 1) * (wx.fog ? WEATHER.fogVision : wx.rain ? WEATHER.rainVision : 1);
}

// How far a unit sees now, in tiles (`f`: the sight left now, if already known).
export function unitVision(sim, u, f = sightFactor(sim)) {
  const def = UNITS[u.type];
  return (def.vision ?? (def.air ? 8 : VISION.unit)) * f;
}

export function recomputeVision(sim) {
  const N = sim.N, s = sim.state, vis = sim.vis;
  vis.set(staticVision(sim));
  const night = sightFactor(sim);
  for (const u of s.ents.units) stamp(vis, N, u.x, u.z, unitVision(sim, u, night));
  for (const b of s.ents.buildings) {
    if (!b.built) continue;
    const def = BUILDINGS[b.type];
    const r = def.vision || VISION.building;
    stamp(vis, N, b.x, b.z, b.type === 'radar' ? r : r * night);
  }
  s.recon = s.recon.filter((r) => r.until > s.time);
  for (const r of s.recon) stamp(vis, N, r.x, r.z, VISION.recon);
  const seen = s.fog.seen;
  for (let k = 0; k < N * N; k++) if (vis[k]) seen[k] = 1;
}

export function fogSystem(sim) {
  // Horde contact: the first time any member is seen, report size, composition and ETA.
  const s = sim.state;
  for (const h of s.hordes) {
    if (h.phase === 'rumour' || h.phase === 'destroyed') continue;
    let seen = null, members = 0, best = Infinity, inside = null;
    for (const z of s.ents.dead) {
      if (z.horde !== h.id || z.gone) continue;
      members++;
      if (!seen && sim.visible(z.x, z.z)) seen = z;
      const k = Math.floor(z.z) * sim.N + Math.floor(z.x);
      if (!inside && sim.map.owner[k]) inside = z;
      if (sim.nav.dist[k] < best) best = sim.nav.dist[k];
    }
    h.members = members;
    const total = Object.values(h.comp).reduce((a, b) => a + b, 0);
    if (h.spawned >= total && members === 0) {
      h.phase = 'destroyed';
      sim.alert('hordeDestroyed', `The horde from ${h.name} has been destroyed.`, h.x, h.z, 'good');
      continue;
    }
    if (inside && !h.arrived) {
      h.arrived = true;
      sim.alert('hordeArrived', `The horde from ${h.name} has crossed into Valdmark.`, inside.x, inside.z, 'bad');
    }
    if (h.phase === 'moving' && seen) {
      h.phase = 'contact';
      h.contactAt = s.time;
      const eta = isFinite(best) ? Math.max(1, Math.round(best / 0.9)) : null;
      const parts = Object.entries(h.comp).map(([t, n]) => `${n} ${t}${n > 1 ? 's' : ''}`).join(', ');
      sim.alert('hordeContact', `CONTACT: ${members} dead (${parts}).${eta ? ` ETA ~${eta} h.` : ''}`, seen.x, seen.z, 'bad');
      sim.emit('hordeContact', { id: h.id, x: seen.x, z: seen.z });
    }
  }
  s.hordes = s.hordes.filter((h) => h.phase !== 'destroyed' || s.time - h.spawnAt < 48);
}
