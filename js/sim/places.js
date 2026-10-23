// Naming a spot on the map the way a player would. Shared by the sim (alert text) and the UI (the command tabs).

// The town it stands in, the crossing it guards, the nearest town, or "abroad" past the border (and off the map,
// where gunships can stray).
export function placeName(sim, x, z) {
  const m = sim.map, N = sim.N;
  const i = Math.floor(x), j = Math.floor(z);
  const inside = i >= 0 && j >= 0 && i < N && j < N && m.owner[j * N + i] > 0;
  if (inside) {
    let town = null, best = Infinity;
    for (const t of m.towns) {
      const d = Math.hypot(t.x - x, t.z - z) - (t.r + 1.5);
      if (d <= 0 && d < best) { best = d; town = t; }
    }
    if (town) return `in ${town.name}`;
  }
  let cross = null, cd = 4;
  for (const c of m.crossings) {
    const d = Math.hypot(c.x - x, c.z - z);
    if (d <= cd) { cd = d; cross = c; }
  }
  if (cross) return `${m.sites[cross.siteId].name} crossing`;
  if (!inside) return 'abroad';
  let near = m.towns[0], nd = Infinity;
  for (const t of m.towns) {
    const d = Math.hypot(t.x - x, t.z - z);
    if (d < nd) { nd = d; near = t; }
  }
  return `near ${near.name}`;
}

// The same place as it follows a verb: "under attack in Kirsk", "… at the Tarn crossing", "… abroad".
export function atPlace(sim, x, z) {
  const p = placeName(sim, x, z);
  return p.endsWith(' crossing') ? `at the ${p}` : p;
}
