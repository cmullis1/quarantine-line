// Pure map generation. The campaign map is hand-shaped with fixed parameters; sandbox maps are
// generated from a seed with the same building blocks. No rendering here.
import { MAP_SIZE } from '../config/balance.js';
import { TER, CAMPAIGN, SANDBOX_TOWN_NAMES, SANDBOX_SITE_NAMES, SANDBOX_SPECIALTIES } from '../config/world.js';
import { createRng, valueNoise, fbm } from './rng.js';
import { Nav } from './nav.js';

const N = MAP_SIZE;
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const idx = (i, j) => j * N + i;
const inside = (i, j) => i >= 0 && j >= 0 && i < N && j < N;

export function generateMap({ seed = 1, scenario = 'campaign' } = {}) {
  if (scenario !== 'sandbox') return buildMap(campaignParams());
  // Sandbox maps are re-rolled until they are fair: every town reachable, at least four crossings,
  // and every foreign city able to walk to its crossing.
  for (let attempt = 0; attempt < 12; attempt++) {
    const map = buildMap(sandboxParams(seed + attempt * 7777));
    map.seed = seed;
    if (validMap(map)) return map;
  }
  return buildMap(campaignParams());
}

export function validMap(map) {
  const nav = new Nav(map);
  const cap = map.towns.find((t) => t.capital);
  if (map.crossings.length < 4) return false;
  for (const t of map.towns) if (!t.tiles.length || !nav.path(cap.x, cap.z, t.x, t.z)) return false;
  for (const c of map.crossings) {
    const s = map.sites[c.siteId];
    if (!nav.path(s.x, s.z, c.oi + 0.5, c.oj + 0.5) || !nav.path(c.x, c.z, cap.x, cap.z)) return false;
  }
  return true;
}

function campaignParams() {
  const c = CAMPAIGN;
  const nameToTown = Object.fromEntries(c.towns.map((t, k) => [t.name, k]));
  // The geography keeps its first drawing (112² map, centre (56, 58)), scaled ×K about c.center: each shape is the
  // old function read at the old point that lands here, so coast, ridge and river keep their exact outlines.
  const K = 1.2, [cx, cz] = c.center;
  const oldI = (i) => 56 + (i - cx) / K, oldJ = (j) => 58 + (j - cz) / K;
  const newI = (i) => cx + (i - 56) * K, newJ = (j) => cz + (j - 58) * K;
  return {
    seed: c.seed,
    center: c.center,
    radius: (th) => K * (33 + 3 * Math.sin(3 * th + 0.7) + 2 * Math.sin(5 * th + 2) + 1.2 * Math.sin(9 * th + 0.3)),
    // The country reaches the coast in the east and spans the river in the west.
    bulges: [{ angle: 0, amount: 13 * K }, { angle: Math.PI, amount: 7 * K }],
    isSea: (i, j) => { const u = oldI(i), v = oldJ(j); return u > 92 + 4 * Math.sin(v * 0.09) + 2 * Math.sin(v * 0.05 + 1) + (v < 18 ? (18 - v) * 1.3 : 0); },
    ridge: {
      axis: 'x', from: newI(8), to: newI(96),
      pos: (x) => { const u = oldI(x); return newJ(25 + 2.5 * Math.sin(u * 0.08) + 1.5 * Math.sin(u * 0.21)); },
      width: (x) => K * (1.8 + 1.4 * (0.5 + 0.5 * Math.sin(oldI(x) * 0.13 + 1))),
    },
    river: { axis: 'z', pos: (z) => { const v = oldJ(z); return newI(30 + 4 * Math.sin(v * 0.07) + 2 * Math.sin(v * 0.17 + 2)); } },
    lake: { i: newI(63), j: newJ(74), r: 3.4 * K },
    towns: c.towns.map((t) => ({ ...t })),
    sites: c.sites.map((s) => ({ name: s.name, i: s.i, j: s.j, town: nameToTown[s.town] })),
    roads: c.roads.map(([a, b]) => [nameToTown[a], nameToTown[b]]),
  };
}

function sandboxParams(seed) {
  const r = createRng(seed * 7919 + 13);
  // Every distance is a fraction of the map (first tuned on 112², hence `scale`).
  const scale = N / 112;
  const cx = Math.round(N / 2 + r.range(-0.054 * N, 0.054 * N)), cz = Math.round(N / 2 + r.range(-0.054 * N, 0.054 * N));
  const base = r.range(0.26 * N, 0.3 * N);
  const ph = [r.range(0, 6), r.range(0, 6), r.range(0, 6)];
  const radius = (th) => base + 3 * Math.sin(3 * th + ph[0]) + 2 * Math.sin(5 * th + ph[1]) + 1.2 * Math.sin(9 * th + ph[2]);
  const sides = ['east', 'west', 'south', 'north'];
  const seaSide = r.chance(0.8) ? r.pick(sides) : null;
  const sp = r.range(0, 6);
  const coast = (t) => 4 * Math.sin(t * 0.09 + sp) + 2 * Math.sin(t * 0.05 + sp * 2);
  const isSea = (i, j) => {
    if (seaSide === 'east') return i > N - 19 * scale + coast(j);
    if (seaSide === 'west') return i < 18 * scale + coast(j);
    if (seaSide === 'south') return j > N - 19 * scale + coast(i);
    if (seaSide === 'north') return j < 18 * scale + coast(i);
    return false;
  };
  const ridgeSide = r.pick(sides.filter((s) => s !== seaSide));
  const rp = r.range(0, 6);
  const ridgeOff = ridgeSide === 'north' || ridgeSide === 'west' ? -1 : 1;
  const ridgeAxis = ridgeSide === 'north' || ridgeSide === 'south' ? 'x' : 'z';
  const ridgeCenter = (ridgeAxis === 'x' ? cz : cx) + ridgeOff * (base - 1);
  const ridge = r.chance(0.85) ? {
    axis: ridgeAxis, from: 10, to: N - 10,
    pos: (t) => ridgeCenter + 3 * Math.sin(t * 0.08 + rp) + 1.5 * Math.sin(t * 0.21 + rp),
    width: (t) => 1.5 + 1.2 * (0.5 + 0.5 * Math.sin(t * 0.13 + rp)),
  } : null;
  const riverAxis = r.chance(0.5) ? 'z' : 'x';
  const rv = r.range(0, 6);
  const riverBase = (riverAxis === 'z' ? cx : cz) + (r.chance(0.5) ? -1 : 1) * r.range(base * 0.35, base * 0.6);
  const river = r.chance(0.65) ? { axis: riverAxis, pos: (t) => riverBase + 4 * Math.sin(t * 0.07 + rv) + 2 * Math.sin(t * 0.17 + rv) } : null;
  const la = r.range(0, Math.PI * 2), ld = r.range(0.1 * N, 0.15 * N);
  const lake = r.chance(0.5) ? { i: Math.round(cx + Math.cos(la) * ld), j: Math.round(cz + Math.sin(la) * ld), r: r.range(2.5, 4) } : null;

  const terrainOk = (i, j) => {
    if (isSea(i, j)) return false;
    if (river) { const t = river.axis === 'z' ? j : i, p = river.pos(t), v = river.axis === 'z' ? i : j; if (Math.abs(v - p) < 4.5) return false; }
    if (ridge) { const t = ridge.axis === 'x' ? i : j, v = ridge.axis === 'x' ? j : i; if (Math.abs(v - ridge.pos(t)) < ridge.width(t) + 5) return false; }
    if (lake && Math.hypot(i - lake.i, j - lake.j) < lake.r + 5) return false;
    return true;
  };

  const names = [...SANDBOX_TOWN_NAMES];
  const takeName = (list) => list.splice(Math.floor(r.next() * list.length), 1)[0];
  const towns = [{ name: takeName(names), i: cx, j: cz, r: 4.4, pop: Math.round(r.range(520, 700)) * 1000, capital: true, specialty: 'capital' }];
  const want = r.int(7, 9);
  // Specialties are dealt from a shuffled deck so every map has a varied economy.
  const deck = [...SANDBOX_SPECIALTIES];
  for (let k = deck.length - 1; k > 0; k--) { const q = Math.floor(r.next() * (k + 1)); [deck[k], deck[q]] = [deck[q], deck[k]]; }
  for (let tries = 0; towns.length < want + 1 && tries < 4000; tries++) {
    const a = r.range(0, Math.PI * 2), d = r.range(10, base * 0.8);
    const i = Math.round(cx + Math.cos(a) * d), j = Math.round(cz + Math.sin(a) * d);
    if (!inside(i, j) || !terrainOk(i, j)) continue;
    if (towns.some((t) => Math.hypot(t.i - i, t.j - j) < 16)) continue;
    const big = r.next();
    towns.push({ name: takeName(names), i, j, r: big > 0.6 ? 3 : 2.6, pop: Math.round(big > 0.6 ? r.range(110, 170) : r.range(55, 100)) * 1000, specialty: deck[(towns.length - 1) % deck.length] });
  }
  if (seaSide) {
    // A port needs a coast: give the specialty to the town nearest the sea.
    let best = 1, bd = Infinity;
    for (let k = 1; k < towns.length; k++) {
      const t = towns[k];
      let d = Infinity;
      for (let s = 1; s < 30 * scale; s++) {
        const [dx, dz] = { east: [1, 0], west: [-1, 0], south: [0, 1], north: [0, -1] }[seaSide];
        if (isSea(t.i + dx * s, t.j + dz * s)) { d = s; break; }
      }
      if (d < bd) { bd = d; best = k; }
    }
    if (bd < 22 * scale) towns[best].specialty = 'port';
  }

  // Road network: minimum spanning tree plus the shortest few extra links.
  const roads = [];
  const inTree = new Set([0]);
  while (inTree.size < towns.length) {
    let best = null, bd = Infinity;
    for (const a of inTree) for (let b = 0; b < towns.length; b++) {
      if (inTree.has(b)) continue;
      const d = Math.hypot(towns[a].i - towns[b].i, towns[a].j - towns[b].j);
      if (d < bd) { bd = d; best = [a, b]; }
    }
    roads.push(best);
    inTree.add(best[1]);
  }
  const extras = [];
  for (let a = 0; a < towns.length; a++) for (let b = a + 1; b < towns.length; b++) {
    if (roads.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) continue;
    extras.push([Math.hypot(towns[a].i - towns[b].i, towns[a].j - towns[b].j), a, b]);
  }
  extras.sort((p, q) => p[0] - q[0]);
  for (const [, a, b] of extras.slice(0, 3)) roads.push([a, b]);

  const seaAngle = { east: 0, south: Math.PI / 2, west: Math.PI, north: -Math.PI / 2 }[seaSide];
  const bulges = seaSide ? [{ angle: seaAngle, amount: 14 * scale }] : [];
  const outline = (th) => bulges.reduce((R, b) => R + b.amount * Math.max(0, Math.cos(th - b.angle)) ** 2, radius(th));

  // Foreign cities spaced around the country, each linked to the nearest town.
  const siteNames = [...SANDBOX_SITE_NAMES];
  const sites = [];
  const nSites = r.int(4, 5);
  const a0 = r.range(0, Math.PI * 2);
  for (let k = 0; k < 80 && sites.length < nSites; k++) {
    const a = k < nSites ? a0 + (k / nSites) * Math.PI * 2 + r.range(-0.25, 0.25) : r.range(0, Math.PI * 2);
    const d = base + r.range(14, 20) * scale;
    const i = Math.round(Math.min(N - 5, Math.max(4, cx + Math.cos(a) * d)));
    const j = Math.round(Math.min(N - 5, Math.max(4, cz + Math.sin(a) * d)));
    if (isSea(i, j) || sites.some((s) => Math.hypot(s.i - i, s.j - j) < 18 * scale)) continue;
    // Clamped to the map edge, a city can land on (or just off) a country that bulges to the coast: the dead need
    // foreign land to walk through.
    if (Math.hypot(i - cx, j - cz) < outline(Math.atan2(j - cz, i - cx)) + 10 * scale) continue;
    let town = 1, bd = Infinity;
    for (let t = 1; t < towns.length; t++) {
      const dd = Math.hypot(towns[t].i - i, towns[t].j - j);
      if (dd < bd) { bd = dd; town = t; }
    }
    sites.push({ name: takeName(siteNames), i, j, town });
  }

  return { seed, center: [cx, cz], radius, bulges, isSea, ridge, river, lake, towns, sites, roads };
}

// 4-connected line so roads are continuous on the grid.
export function line4(i0, j0, i1, j1) {
  const pts = [[i0, j0]];
  let i = i0, j = j0, ei = 0, ej = 0;
  const di = Math.abs(i1 - i0), dj = Math.abs(j1 - j0);
  const si = Math.sign(i1 - i0), sj = Math.sign(j1 - j0);
  while (i !== i1 || j !== j1) {
    const ti = di ? (ei + 1) / di : Infinity;
    const tj = dj ? (ej + 1) / dj : Infinity;
    if (ti <= tj) { i += si; ei++; } else { j += sj; ej++; }
    pts.push([i, j]);
  }
  return pts;
}

function roadPath(a, b, rng) {
  // One jittered midpoint keeps roads from looking ruler-straight.
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const px = -(b[1] - a[1]) / (len || 1), pz = (b[0] - a[0]) / (len || 1);
  const off = rng.range(-0.1, 0.1) * len;
  const m = [Math.round(mx + px * off), Math.round(mz + pz * off)];
  const p1 = line4(a[0], a[1], m[0], m[1]);
  const p2 = line4(m[0], m[1], b[0], b[1]);
  return p1.concat(p2.slice(1)).filter(([i, j]) => inside(i, j));
}

function buildMap(P) {
  const rng = createRng(P.seed * 31 + 7);
  const noise = valueNoise(P.seed);
  const noise2 = valueNoise(P.seed + 101);
  const terrain = new Uint8Array(N * N);
  const owner = new Uint8Array(N * N);
  const road = new Uint8Array(N * N);
  const bridge = new Uint8Array(N * N);
  const forest = new Uint8Array(N * N);
  const farmland = new Uint8Array(N * N);
  const sand = new Uint8Array(N * N);
  const border = new Uint8Array(N * N);
  const height = new Uint8Array(N * N);
  const townId = new Int8Array(N * N).fill(-1);
  const [cx, cz] = P.center;

  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = idx(i, j);
    const th = Math.atan2(j - cz, i - cx);
    let R = P.radius(th);
    for (const b of P.bulges || []) R += b.amount * Math.max(0, Math.cos(th - b.angle)) ** 2;
    let home = Math.hypot(i - cx, j - cz) < R;
    for (const t of P.towns) if (Math.hypot(i - t.i, j - t.j) < t.r + 3) home = true;
    owner[k] = home ? 1 : 0;
    if (P.isSea(i, j)) { terrain[k] = TER.SEA; owner[k] = 0; continue; }
    if (P.ridge) {
      const t = P.ridge.axis === 'x' ? i : j, v = P.ridge.axis === 'x' ? j : i;
      if (t >= P.ridge.from && t <= P.ridge.to) {
        // Roughness only ever widens the ridge, so it stays a continuous wall broken only by road passes.
        const rough = Math.max(0, (fbm(noise, i * 0.25, j * 0.25) - 0.45) * 2.4);
        if (Math.abs(v - P.ridge.pos(t)) < Math.max(1.3, P.ridge.width(t)) + rough) {
          terrain[k] = TER.MOUNTAIN;
          height[k] = 1 + Math.min(3, Math.floor(fbm(noise2, i * 0.3, j * 0.3) * 4.5));
        }
      }
    }
    if (P.river) {
      const t = P.river.axis === 'z' ? j : i, v = P.river.axis === 'z' ? i : j;
      const w = fbm(noise2, t * 0.08, 3) > 0.55 ? 1.1 : 0.6;
      if (Math.abs(v - P.river.pos(t)) < w) { terrain[k] = TER.RIVER; height[k] = 0; }
    }
    if (P.lake && Math.hypot(i - P.lake.i, j - P.lake.j) < P.lake.r + (fbm(noise, i * 0.4, j * 0.4) - 0.5) * 1.6) {
      terrain[k] = TER.LAKE; height[k] = 0;
    }
  }

  // The river is carved per tile, so where its centre drifts sideways between two rows the water steps diagonally and
  // the pieces touch only at corners. Fill each step so consecutive rows share an edge: one continuous channel.
  if (P.river) {
    const zAxis = P.river.axis === 'z';
    const span = (t) => {
      const c = P.river.pos(t), w = fbm(noise2, t * 0.08, 3) > 0.55 ? 1.1 : 0.6;
      return [Math.floor(c - w) + 1, Math.ceil(c + w) - 1];
    };
    const put = (t, v) => {
      const i = zAxis ? v : t, j = zAxis ? t : v;
      if (!inside(i, j)) return;
      const k = idx(i, j);
      if (terrain[k] === TER.SEA || terrain[k] === TER.LAKE) return;
      terrain[k] = TER.RIVER; height[k] = 0;
    };
    for (let t = 0; t < N - 1; t++) {
      const [a, b] = span(t), [c, d] = span(t + 1);
      if (b < c) for (let v = b; v < c; v++) put(t + 1, v);
      else if (d < a) for (let v = d + 1; v <= a; v++) put(t + 1, v);
    }
  }

  // Towns: clear their ground and claim tiles.
  const towns = P.towns.map((t, id) => ({
    id, name: t.name, i: t.i, j: t.j, x: t.i + 0.5, z: t.j + 0.5, r: t.r, pop: t.pop,
    capital: !!t.capital, specialty: t.specialty, tiles: [],
  }));
  for (const t of towns) {
    for (let j = Math.floor(t.j - t.r - 1); j <= Math.ceil(t.j + t.r + 1); j++) for (let i = Math.floor(t.i - t.r - 1); i <= Math.ceil(t.i + t.r + 1); i++) {
      if (!inside(i, j)) continue;
      const k = idx(i, j), d = Math.hypot(i - t.i, j - t.j);
      if (d <= t.r + 1 && (terrain[k] === TER.MOUNTAIN || terrain[k] === TER.LAKE)) { terrain[k] = TER.LAND; height[k] = 0; }
      if (d <= t.r && terrain[k] === TER.LAND && owner[k]) { townId[k] = t.id; t.tiles.push(k); }
    }
  }

  // Roads
  const carve = (path) => {
    for (const [i, j] of path) {
      const k = idx(i, j);
      if (terrain[k] === TER.SEA) continue;
      road[k] = 1;
      if (terrain[k] === TER.RIVER || terrain[k] === TER.LAKE) bridge[k] = 1;
      if (terrain[k] === TER.MOUNTAIN) { terrain[k] = TER.LAND; height[k] = 0; }
      for (const [di, dj] of DIRS4) {
        const ni = i + di, nj = j + dj;
        if (inside(ni, nj) && terrain[idx(ni, nj)] === TER.MOUNTAIN) { terrain[idx(ni, nj)] = TER.LAND; height[idx(ni, nj)] = 0; }
      }
    }
  };
  const roadEdges = [];
  for (const [a, b] of P.roads) {
    const path = roadPath([towns[a].i, towns[a].j], [towns[b].i, towns[b].j], rng);
    carve(path);
    roadEdges.push({ a, b, length: path.length });
  }

  const sites = [];
  const crossings = [];
  P.sites.forEach((s, id) => {
    const t = towns[s.town];
    const path = roadPath([t.i, t.j], [s.i, s.j], rng);
    carve(path);
    const site = { id, name: s.name, i: s.i, j: s.j, x: s.i + 0.5, z: s.j + 0.5, townId: t.id, crossingId: -1 };
    for (let k = 1; k < path.length; k++) {
      const [pi, pj] = path[k - 1], [i, j] = path[k];
      if (owner[idx(pi, pj)] && !owner[idx(i, j)]) {
        const len = Math.hypot(i - pi, j - pj);
        const c = {
          id: crossings.length, i: pi, j: pj, x: pi + 0.5, z: pj + 0.5, oi: i, oj: j,
          dx: (i - pi) / len, dz: (j - pj) / len, siteId: id, townId: t.id,
        };
        crossings.push(c);
        site.crossingId = c.id;
        break;
      }
    }
    sites.push(site);
  });

  // A road that steps diagonally across the river leaves single land tiles between its bridge tiles; deck those too
  // so the crossing is one run (the deck there rests on the bank; units already walk it as road). So `bridge` marks
  // decked road, which is usually over water but can stand on a bank tile.
  for (let again = true; again;) {
    again = false;
    for (let k = 0; k < N * N; k++) {
      if (!road[k] || bridge[k]) continue;
      const i = k % N, j = (k / N) | 0;
      let n = 0;
      for (const [di, dj] of DIRS4) if (inside(i + di, j + dj) && bridge[idx(i + di, j + dj)]) n++;
      if (n >= 2) { bridge[k] = 1; again = true; }
    }
  }

  // Border, beach, forest, farmland
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = idx(i, j);
    if (terrain[k] === TER.SEA) continue;
    for (const [di, dj] of DIRS4) {
      const ni = i + di, nj = j + dj;
      if (!inside(ni, nj)) continue;
      const nk = idx(ni, nj);
      if (owner[k] && !owner[nk] && terrain[nk] !== TER.SEA) border[k] = 1;
      if (terrain[k] === TER.LAND && terrain[nk] === TER.SEA) sand[k] = 1;
    }
  }
  const nearTown = (i, j, pad) => towns.some((t) => Math.hypot(i - t.i, j - t.j) < t.r + pad);
  const nearSite = (i, j, pad) => sites.some((s) => Math.abs(s.i - i) <= pad && Math.abs(s.j - j) <= pad);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = idx(i, j);
    if (terrain[k] !== TER.LAND || road[k] || townId[k] >= 0 || sand[k]) continue;
    const f = fbm(noise, i * 0.09, j * 0.09);
    if (f > (owner[k] ? 0.56 : 0.6) && !nearTown(i, j, 2) && !nearSite(i, j, 4)) { forest[k] = 1; continue; }
    if (owner[k] && nearTown(i, j, 6) && !nearTown(i, j, 1) && fbm(noise2, i * 0.18, j * 0.18) > 0.56) farmland[k] = 1;
  }

  return {
    N, seed: P.seed, terrain, owner, road, bridge, forest, farmland, sand, border, height, townId,
    towns, sites, crossings, roadEdges,
  };
}

export function isWater(map, k) {
  const t = map.terrain[k];
  return t === TER.SEA || t === TER.RIVER || t === TER.LAKE;
}
