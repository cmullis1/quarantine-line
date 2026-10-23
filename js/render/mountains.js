// Mountains as one sculpted, faceted mesh instead of a pyramid per tile. A vertex grid (SUB cells per tile) is lifted
// from the map's mountain tiles: it falls to ground level along every edge of the range (so it meets the ground
// without a seam), rises toward the crest by distance from that edge, takes its mass from the map's tile heights,
// and is cut into crests and separate summits by ridged noise and into ledges by a soft terrace. Faces are flat
// shaded and coloured by height, slope and strata band; the highest, flattest faces are snow.
import * as THREE from 'three';
import { TER } from '../config/world.js';
import { valueNoise, fbm } from '../sim/rng.js';

const SUB = 2;                     // cells per tile side
const VERTS_PER_TILE = SUB * SUB * 6;
const LEDGE = 0.3;                 // terrace step in world units
const SNOW_LINE = 2.15;

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const hash = (x, y, s) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const ROCK_LOW = new THREE.Color(0x84775f), ROCK_MID = new THREE.Color(0x726a60), ROCK_HIGH = new THREE.Color(0x626268);
const CLIFF = new THREE.Color(0x544d47), SCREE = new THREE.Color(0x6f7048), SNOW = new THREE.Color(0xeef2f6), SNOW_SHADE = new THREE.Color(0xc4ccd6);

// Returns { mesh, tileIndex } where tileIndex[k] is the mountain tile's slot in the mesh (or -1), or null if the map has no mountains.
export function buildMountains(map) {
  const N = map.N, G = SUB * N + 1, seed = map.seed | 0;
  const isM = (i, j) => i >= 0 && j >= 0 && i < N && j < N && map.terrain[j * N + i] === TER.MOUNTAIN;
  const tileIndex = new Int32Array(N * N).fill(-1);
  const tiles = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (isM(i, j)) { tileIndex[j * N + i] = tiles.length; tiles.push([i, j]); }
  if (!tiles.length) return null;

  // Distance (in tiles) from the range's edge, per vertex: 0 on and outside the edge.
  const dist = new Float32Array(G * G);
  for (let b = 0; b < G; b++) for (let a = 0; a < G; a++) {
    // A vertex on a tile boundary touches two tiles per axis; one inside a tile touches only that tile.
    const ta = a % SUB === 0 ? [a / SUB - 1, a / SUB] : [Math.floor(a / SUB)], tb = b % SUB === 0 ? [b / SUB - 1, b / SUB] : [Math.floor(b / SUB)];
    const inner = ta.every((i) => tb.every((j) => isM(i, j)));
    dist[b * G + a] = inner ? 1e9 : 0;
  }
  const step = 1 / SUB, diag = Math.SQRT2 / SUB;
  const relax = (a, b, da, db, w) => {
    const x = a + da, y = b + db;
    if (x < 0 || y < 0 || x >= G || y >= G) return;
    const v = dist[y * G + x] + w;
    if (v < dist[b * G + a]) dist[b * G + a] = v;
  };
  for (let b = 0; b < G; b++) for (let a = 0; a < G; a++) {
    relax(a, b, -1, 0, step); relax(a, b, 0, -1, step); relax(a, b, -1, -1, diag); relax(a, b, 1, -1, diag);
  }
  for (let b = G - 1; b >= 0; b--) for (let a = G - 1; a >= 0; a--) {
    relax(a, b, 1, 0, step); relax(a, b, 0, 1, step); relax(a, b, 1, 1, diag); relax(a, b, -1, 1, diag);
  }

  // Mass from the map's tile heights (1..4), blurred over about a tile and a half so summits are broad, not per-tile.
  const mass = (x, z) => {
    let s = 0, w = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = Math.floor(x) + di, j = Math.floor(z) + dj;
      if (!isM(i, j)) continue;
      const d = Math.hypot(i + 0.5 - x, j + 0.5 - z), wt = Math.max(0.05, 1.6 - d);
      s += map.height[j * N + i] * wt; w += wt;
    }
    return w ? s / w : 0;
  };
  const nA = valueNoise(seed * 31 + 7), nB = valueNoise(seed * 57 + 11);

  const vx = new Float32Array(G * G), vy = new Float32Array(G * G), vz = new Float32Array(G * G);
  for (let b = 0; b < G; b++) for (let a = 0; a < G; a++) {
    const k = b * G + a;
    let x = a / SUB, z = b / SUB, y = 0;
    const d = dist[k];
    if (d > 0) {
      // Interior vertices wander a little so the facets are not a lattice; edge vertices stay put to meet the ground.
      x += (hash(a, b, seed) - 0.5) * 0.3; z += (hash(a, b, seed + 1) - 0.5) * 0.3;
      const ridged = 1 - Math.abs(2 * fbm(nA, x * 0.3, z * 0.3, 3) - 1);
      const crest = 0.5 + 0.9 * Math.pow(ridged, 1.3);
      const profile = smooth(Math.min(1, d / 2.4));
      y = profile * (0.45 + 0.58 * mass(x, z)) * crest;
      // Ledges: pull part of the way to the nearest terrace, which flattens shelves and steepens the risers between.
      const t = y / LEDGE, f = Math.floor(t);
      y = y + ((f + smooth((t - f - 0.25) / 0.5)) * LEDGE - y) * 0.4 * profile;
      y += (hash(a, b, seed + 2) - 0.5) * 0.08 * profile;
    }
    vx[k] = x; vy[k] = Math.max(0, y); vz[k] = z;
  }

  const pos = new Float32Array(tiles.length * VERTS_PER_TILE * 3), col = new Float32Array(pos.length);
  const tri = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
  const c = new THREE.Color(), tmp = new THREE.Color();
  let o = 0;
  const face = (p, q, r) => {
    tri[0].set(vx[p], vy[p], vz[p]); tri[1].set(vx[q], vy[q], vz[q]); tri[2].set(vx[r], vy[r], vz[r]);
    e1.subVectors(tri[1], tri[0]); e2.subVectors(tri[2], tri[0]);
    nrm.crossVectors(e1, e2).normalize();
    const cx = (tri[0].x + tri[1].x + tri[2].x) / 3, cy = (tri[0].y + tri[1].y + tri[2].y) / 3, cz = (tri[0].z + tri[1].z + tri[2].z) / 3;
    colour(c, cx, cy, cz, nrm.y);
    for (const t of tri) {
      pos[o] = t.x; pos[o + 1] = t.y; pos[o + 2] = t.z;
      col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
      o += 3;
    }
  };
  const colour = (out, x, y, z, ny) => {
    // Rock darkens and cools with height; steep faces are dark cliff.
    out.copy(ROCK_LOW).lerp(ROCK_MID, smooth(y / 1.1)).lerp(ROCK_HIGH, smooth((y - 1.0) / 1.5));
    out.lerp(CLIFF, smooth((0.78 - ny) / 0.3) * 0.85);
    // Strata: each band has its own tone, warm or cool, wobbling with the terrain so bands are not level lines.
    const band = Math.floor((y + (fbm(nB, x * 0.5, z * 0.5, 2) - 0.5) * 0.35) / (LEDGE * 0.8));
    const bh = hash(band, 3, seed);
    out.offsetHSL((bh - 0.5) * 0.045, 0, (bh - 0.5) * 0.1 + (hash(Math.floor(x * 4), Math.floor(z * 4) + band, seed) - 0.5) * 0.04);
    // The foot of the slope dissolves into the ground's colour.
    out.lerp(SCREE, smooth((0.4 - y) / 0.4) * 0.55 * smooth((ny - 0.35) / 0.4));
    // Snow on the high, not-too-steep faces; the line wanders.
    const line = SNOW_LINE + (fbm(nA, x * 0.7 + 40, z * 0.7, 2) - 0.5) * 0.7;
    const snow = smooth((y - line) / 0.25) * smooth((ny - 0.42) / 0.22);
    if (snow > 0) out.lerp(tmp.copy(SNOW).lerp(SNOW_SHADE, smooth((0.8 - ny) / 0.5) * 0.7), snow);
  };

  // Each tile's cells, split along the diagonal whose ends are closer in height (follows the ridge lines).
  for (const [i, j] of tiles) {
    for (let cj = 0; cj < SUB; cj++) for (let ci = 0; ci < SUB; ci++) {
      const a = i * SUB + ci, b = j * SUB + cj;
      const p00 = b * G + a, p10 = p00 + 1, p01 = p00 + G, p11 = p01 + 1;
      if (Math.abs(vy[p00] - vy[p11]) < Math.abs(vy[p10] - vy[p01])) { face(p00, p01, p11); face(p00, p11, p10); }
      else { face(p00, p01, p10); face(p10, p01, p11); }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const colAttr = new THREE.BufferAttribute(col.slice(), 3);
  geo.setAttribute('color', colAttr);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  return { mesh, tileIndex, baseColors: col, colAttr };
}

// Fog of war on one mountain tile: same tint as the ground tile under it.
export function fogMountainTile(m, slot, f) {
  const base = m.baseColors, out = m.colAttr.array;
  const lo = slot * VERTS_PER_TILE * 3, hi = lo + VERTS_PER_TILE * 3;
  for (let q = lo; q < hi; q += 3) {
    out[q] = base[q] * f; out[q + 1] = base[q + 1] * f; out[q + 2] = base[q + 2] * (f + (1 - f) * 0.35);
  }
}
