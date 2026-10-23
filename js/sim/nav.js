// Navigation on the tile grid.
// - The dead follow a multi-source Dijkstra flow field toward living towns. Structures are passable at a
//   high cost: the horde detours if a gap exists and otherwise walks up to the wall and claws at it.
// - Units and refugees use A* (roads are cheaper, so they prefer them).
// - Buses and traffic keep to the roads (roadPath), joining them at the nearest road tile.
import { TER } from '../config/world.js';
import { MinHeap } from '../util.js';

const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export const BLK = { NONE: 0, SOLID: 1, GATE: 2 };
export const STRUCTURE_COST = 40;
export const WATER_COST = 2.5;
const ROAD_COST = 0.75;

export class Nav {
  constructor(map) {
    this.map = map;
    this.N = map.N;
    this.blk = new Uint8Array(this.N * this.N);
    this.dist = new Float32Array(this.N * this.N);
    this.next = new Int32Array(this.N * this.N);
  }

  inside(i, j) { return i >= 0 && j >= 0 && i < this.N && j < this.N; }
  idx(i, j) { return j * this.N + i; }

  setBlock(k, v) { this.blk[k] = v; }

  water(k) {
    const t = this.map.terrain[k];
    return (t === TER.SEA || t === TER.RIVER || t === TER.LAKE) && !this.map.bridge[k];
  }

  // Units, refugees and buses.
  unitPass(k) {
    if (this.map.terrain[k] === TER.MOUNTAIN) return false;
    if (this.water(k)) return false;
    return this.blk[k] !== BLK.SOLID;
  }

  // The dead treat every structure (gates included) as something to go around or through.
  deadSolid(k) { return this.blk[k] !== BLK.NONE; }
  deadBlocked(k) { return this.map.terrain[k] === TER.MOUNTAIN; }

  deadCost(k) {
    if (this.map.terrain[k] === TER.MOUNTAIN) return Infinity;
    if (this.blk[k]) return STRUCTURE_COST;
    if (this.water(k)) return WATER_COST;
    return 1;
  }

  // sources: [{k, bias}], where bias is a starting distance; lower bias attracts more.
  flow(sources) {
    const N = this.N, dist = this.dist, next = this.next;
    dist.fill(Infinity);
    const heap = new MinHeap();
    for (const s of sources) if (s.bias < dist[s.k]) { dist[s.k] = s.bias; heap.push(s.bias, s.k); }
    while (heap.size) {
      const k = heap.pop();
      const d = dist[k];
      const i = k % N, j = (k / N) | 0;
      for (let q = 0; q < 8; q++) {
        const ni = i + DIRS8[q][0], nj = j + DIRS8[q][1];
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const nk = nj * N + ni;
        if (q >= 4 && this.cornerBlocked(i, j, ni, nj)) continue;
        // Cost of stepping from nk into k (the dead walk toward the sources).
        const c = this.deadCost(k) * (q >= 4 ? 1.414 : 1);
        if (!isFinite(c) || this.deadBlocked(nk)) continue;
        const nd = d + c;
        if (nd < dist[nk]) { dist[nk] = nd; heap.push(nd, nk); }
      }
    }
    for (let k = 0; k < N * N; k++) {
      const i = k % N, j = (k / N) | 0;
      let best = -1, bd = dist[k];
      for (let q = 0; q < 8; q++) {
        const ni = i + DIRS8[q][0], nj = j + DIRS8[q][1];
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        if (q >= 4 && this.cornerBlocked(i, j, ni, nj)) continue;
        const nk = nj * N + ni;
        if (dist[nk] < bd - 1e-6) { bd = dist[nk]; best = nk; }
      }
      next[k] = best;
    }
  }

  cornerBlocked(i, j, ni, nj) {
    const a = j * this.N + ni, b = nj * this.N + i;
    return this.blk[a] !== BLK.NONE || this.blk[b] !== BLK.NONE || this.deadBlocked(a) || this.deadBlocked(b);
  }

  unitCorner(i, j, ni, nj) {
    return !this.unitPass(j * this.N + ni) || !this.unitPass(nj * this.N + i);
  }

  nearestPassable(i, j, maxR = 8) {
    if (this.inside(i, j) && this.unitPass(this.idx(i, j))) return [i, j];
    for (let rad = 1; rad <= maxR; rad++) {
      let best = null, bd = Infinity;
      for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== rad) continue;
        const ni = i + di, nj = j + dj;
        if (!this.inside(ni, nj) || !this.unitPass(this.idx(ni, nj))) continue;
        const d = di * di + dj * dj;
        if (d < bd) { bd = d; best = [ni, nj]; }
      }
      if (best) return best;
    }
    return null;
  }

  // A* from world point to world point. Returns waypoints [[x, z], ...] or null when unreachable.
  path(sx, sz, tx, tz) {
    const N = this.N;
    let si = Math.floor(sx), sj = Math.floor(sz);
    if (!this.inside(si, sj)) return null;
    let ti = Math.floor(tx), tj = Math.floor(tz);
    const exact = this.inside(ti, tj) && this.unitPass(this.idx(ti, tj));
    if (!exact) {
      const alt = this.nearestPassable(Math.max(0, Math.min(N - 1, ti)), Math.max(0, Math.min(N - 1, tj)));
      if (!alt) return null;
      [ti, tj] = alt;
    }
    const start = this.idx(si, sj), goal = this.idx(ti, tj);
    if (start === goal) return [exact ? [tx, tz] : [ti + 0.5, tj + 0.5]];
    const g = new Map([[start, 0]]), came = new Map();
    const heap = new MinHeap();
    const h = (i, j) => { const a = Math.abs(i - ti), b = Math.abs(j - tj); return (Math.max(a, b) + 0.414 * Math.min(a, b)) * ROAD_COST; };
    heap.push(h(si, sj), start);
    const closed = new Set();
    let found = false;
    for (let iter = 0; heap.size && iter < 20000; iter++) {
      const k = heap.pop();
      if (k === goal) { found = true; break; }
      if (closed.has(k)) continue;
      closed.add(k);
      const i = k % N, j = (k / N) | 0;
      for (let q = 0; q < 8; q++) {
        const ni = i + DIRS8[q][0], nj = j + DIRS8[q][1];
        if (!this.inside(ni, nj)) continue;
        const nk = nj * N + ni;
        if (!this.unitPass(nk)) continue;
        if (q >= 4 && this.unitCorner(i, j, ni, nj)) continue;
        const step = (this.map.road[nk] ? ROAD_COST : 1) * (q >= 4 ? 1.414 : 1);
        const ng = g.get(k) + step;
        if (ng < (g.get(nk) ?? Infinity)) { g.set(nk, ng); came.set(nk, k); heap.push(ng + h(ni, nj), nk); }
      }
    }
    if (!found) return null;
    const pts = [];
    for (let k = goal; k !== start; k = came.get(k)) pts.push([k % N + 0.5, ((k / N) | 0) + 0.5]);
    pts.reverse();
    if (exact) pts[pts.length - 1] = [tx, tz];
    return this.smooth(sx, sz, pts);
  }

  // The nearest road tile a vehicle can reach from (x, z) without crossing anything impassable.
  nearestRoad(x, z, limit = 600) {
    const N = this.N, i0 = Math.floor(x), j0 = Math.floor(z);
    if (!this.inside(i0, j0)) return -1;
    const start = this.idx(i0, j0), seen = new Set([start]), q = [start];
    for (let h = 0; h < q.length && h < limit; h++) {
      const k = q[h];
      if (this.map.road[k] && this.unitPass(k)) return k;
      const i = k % N, j = (k / N) | 0;
      for (const [di, dj] of DIRS8.slice(0, 4)) {
        const ni = i + di, nj = j + dj;
        if (!this.inside(ni, nj)) continue;
        const nk = nj * N + ni;
        if (!seen.has(nk) && this.unitPass(nk)) { seen.add(nk); q.push(nk); }
      }
    }
    return -1;
  }

  // A route on roads only (gates and checkpoints pass), from the road nearest the start to the road nearest the
  // target, with straight runs merged. Null when the road network does not connect them.
  roadPath(sx, sz, tx, tz) {
    const N = this.N, road = this.map.road;
    const start = this.nearestRoad(sx, sz), goal = this.nearestRoad(tx, tz);
    if (start < 0 || goal < 0) return null;
    const ti = goal % N, tj = (goal / N) | 0;
    const h = (i, j) => { const a = Math.abs(i - ti), b = Math.abs(j - tj); return Math.max(a, b) + 0.414 * Math.min(a, b); };
    const g = new Map([[start, 0]]), came = new Map(), closed = new Set(), heap = new MinHeap();
    heap.push(h(start % N, (start / N) | 0), start);
    let found = start === goal;
    while (heap.size && !found) {
      const k = heap.pop();
      if (k === goal) { found = true; break; }
      if (closed.has(k)) continue;
      closed.add(k);
      const i = k % N, j = (k / N) | 0;
      for (let q = 0; q < 8; q++) {
        const ni = i + DIRS8[q][0], nj = j + DIRS8[q][1];
        if (!this.inside(ni, nj)) continue;
        const nk = nj * N + ni;
        if (!road[nk] || !this.unitPass(nk)) continue;
        // A diagonal step must turn through road, not across a grass corner; it costs more than the two straight
        // steps, so it is taken only where the road itself joins diagonally.
        if (q >= 4 && !road[j * N + ni] && !road[nj * N + i]) continue;
        const ng = g.get(k) + (q >= 4 ? 2.1 : 1);
        if (ng < (g.get(nk) ?? Infinity)) { g.set(nk, ng); came.set(nk, k); heap.push(ng + h(ni, nj), nk); }
      }
    }
    if (!found) return null;
    const tiles = [];
    for (let k = goal; k !== start; k = came.get(k)) tiles.push(k);
    tiles.push(start);
    tiles.reverse();
    const pts = [];
    for (let n = 0; n < tiles.length; n++) {
      const k = tiles[n], prev = tiles[n - 1], next = tiles[n + 1];
      // Keep only the tiles where the road turns.
      if (prev !== undefined && next !== undefined && k - prev === next - k) continue;
      pts.push([k % N + 0.5, ((k / N) | 0) + 0.5]);
    }
    pts.push([tx, tz]);
    return pts;
  }

  // Skip waypoints a straight walk can cut, looking a few steps ahead so road-following survives.
  smooth(sx, sz, pts) {
    const out = [];
    let ax = sx, az = sz, k = 0;
    while (k < pts.length) {
      let far = k;
      for (let q = Math.min(pts.length - 1, k + 6); q > k; q--) {
        if (this.clearLine(ax, az, pts[q][0], pts[q][1])) { far = q; break; }
      }
      out.push(pts[far]);
      [ax, az] = pts[far];
      k = far + 1;
    }
    return out;
  }

  clearLine(ax, az, bx, bz) {
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) * 3);
    for (let s = 1; s <= n; s++) {
      const t = s / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      for (const [ox, oz] of [[0.22, 0.22], [-0.22, 0.22], [0.22, -0.22], [-0.22, -0.22]]) {
        const i = Math.floor(x + ox), j = Math.floor(z + oz);
        if (!this.inside(i, j) || !this.unitPass(this.idx(i, j))) return false;
      }
    }
    return true;
  }
}
