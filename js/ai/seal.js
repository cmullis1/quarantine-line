// The cheapest wall line that seals the country: a minimum vertex cut between the land beyond the border and the
// living towns, taken in a band along the border. A bot that builds it leaves the dead no way round, so every
// horde has to claw through or pile over (bots.js). Existing structures cost nothing, so recomputing after a wall
// falls plans only the gap. Water cannot be walled before Coastal Barrier, so a river that runs into the country is
// left as a gap for towers to cover, priced high enough that the line goes round it when that is cheaper.
import { canPlace } from '../sim/commands.js';
import { BLK } from '../sim/nav.js';
import { TER } from '../config/world.js';

const BAND = 3; // own tiles this close (Chebyshev) to foreign land may carry the line
const INF = 1e9;
const COST = { wall: 5, gate: 18, gap: 150 };

// Dinic's max flow on a flat edge list.
class Flow {
  constructor(n, cap) {
    this.n = n;
    this.head = new Int32Array(n).fill(-1);
    this.to = new Int32Array(cap);
    this.cap = new Float64Array(cap);
    this.nxt = new Int32Array(cap);
    this.m = 0;
  }
  add(a, b, c) {
    const { to, cap, nxt, head } = this;
    to[this.m] = b; cap[this.m] = c; nxt[this.m] = head[a]; head[a] = this.m++;
    to[this.m] = a; cap[this.m] = 0; nxt[this.m] = head[b]; head[b] = this.m++;
  }
  bfs(s, t) {
    const level = (this.level ||= new Int32Array(this.n));
    level.fill(-1);
    const q = (this.q ||= new Int32Array(this.n));
    let h = 0, e = 0;
    q[e++] = s; level[s] = 0;
    while (h < e) {
      const a = q[h++];
      for (let x = this.head[a]; x >= 0; x = this.nxt[x]) {
        const b = this.to[x];
        if (this.cap[x] > 0 && level[b] < 0) { level[b] = level[a] + 1; q[e++] = b; }
      }
    }
    return level[t] >= 0;
  }
  // Iterative blocking-flow DFS (the graph is too deep for recursion).
  augment(s, t) {
    const { level, head, nxt, to, cap } = this;
    const it = Int32Array.from(head);
    const stack = new Int32Array(this.n), via = new Int32Array(this.n);
    let total = 0;
    for (;;) {
      let d = 0, a = s;
      stack[0] = s;
      while (a !== t) {
        let x = it[a];
        while (x >= 0 && !(cap[x] > 0 && level[to[x]] === level[a] + 1)) x = nxt[x];
        it[a] = x;
        if (x < 0) {
          if (d === 0) return total;
          level[a] = -1; // dead end
          a = stack[--d];
          continue;
        }
        via[d] = x; stack[++d] = to[x]; a = to[x];
      }
      let f = Infinity;
      for (let q = 0; q < d; q++) f = Math.min(f, cap[via[q]]);
      for (let q = 0; q < d; q++) { cap[via[q]] -= f; cap[via[q] ^ 1] += f; }
      total += f;
      if (total >= INF) return total;
    }
  }
  run(s, t) {
    let total = 0;
    while (total < INF && this.bfs(s, t)) total += this.augment(s, t);
    return total;
  }
}

// → { sealed, cost, tiles: [{i, j, type}], gaps: [{i, j}], side }: the tiles still to build (existing structures
// are already part of the line), the water tiles left open, and which side of the line every tile is on (`side[k]`:
// 0 the home side, 1 on the line, 2 beyond it). sealed is false when no line inside the band can close the country
// (then both lists are empty and there is no side).
export function sealPlan(sim) {
  const N = sim.N, m = sim.map, NN = N * N;
  // canPlace builds sim.forward (where building beyond the border is allowed) on first use.
  if (!sim.forward) canPlace(sim, 'wall', 0, 0, { free: true });
  // Distance (Chebyshev, capped) from foreign land, for the band.
  const near = new Uint8Array(NN).fill(255);
  const q = [];
  for (let k = 0; k < NN; k++) if (!m.owner[k]) { near[k] = 0; q.push(k); }
  for (let h = 0; h < q.length; h++) {
    const k = q[h], i = k % N, j = (k / N) | 0;
    if (near[k] >= BAND) continue;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const nk = nj * N + ni;
      if (near[nk] > near[k] + 1) { near[nk] = near[k] + 1; q.push(nk); }
    }
  }
  const living = new Set(sim.state.towns.filter((t) => t.status === 'ok').map((t) => t.id));
  const S = 2 * NN, T = 2 * NN + 1;
  const g = new Flow(2 * NN + 2, NN * 12 + 8);
  const kind = new Uint8Array(NN); // 0 none · 1 wall · 2 gate · 3 gap
  for (let k = 0; k < NN; k++) {
    if (m.terrain[k] === TER.MOUNTAIN) continue;
    const i = k % N, j = (k / N) | 0;
    let c = INF;
    const blk = sim.nav.blk[k];
    const band = m.owner[k] ? near[k] <= BAND : sim.forward[k] === 1;
    if (blk !== BLK.NONE) c = 0;
    else if (band && canPlace(sim, 'wall', i, j, { free: true }).ok) {
      kind[k] = m.road[k] ? 2 : 1;
      c = kind[k] === 2 ? COST.gate : COST.wall;
    } else if (band && sim.nav.water(k)) {
      kind[k] = 3;
      c = COST.gap;
    }
    g.add(2 * k, 2 * k + 1, c);
    // 4-neighbours suffice: the dead cannot cut a corner past a structure (Nav.cornerBlocked).
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      const ni = i + di, nj = j + dj;
      if (ni >= N || nj >= N) continue;
      const nk = nj * N + ni;
      if (m.terrain[nk] === TER.MOUNTAIN) continue;
      g.add(2 * k + 1, 2 * nk, INF);
      g.add(2 * nk + 1, 2 * k, INF);
    }
    if (!m.owner[k] && sim.forward[k] !== 1) g.add(S, 2 * k, INF);
    if (m.townId[k] >= 0 && living.has(m.townId[k])) g.add(2 * k + 1, T, INF);
  }
  const flow = g.run(S, T);
  if (flow >= INF) return { sealed: false, cost: 0, tiles: [], gaps: [] };
  // The cut: tiles whose entry is reachable from the outside in the residual graph and whose exit is not.
  g.bfs(S, T);
  const tiles = [], gaps = [], side = new Uint8Array(NN);
  for (let k = 0; k < NN; k++) {
    side[k] = g.level[2 * k] < 0 ? 0 : g.level[2 * k + 1] < 0 ? 1 : 2;
    if (!kind[k] || g.level[2 * k] < 0 || g.level[2 * k + 1] >= 0) continue;
    const at = { i: k % N, j: (k / N) | 0 };
    if (kind[k] === 3) gaps.push(at);
    else tiles.push({ ...at, type: kind[k] === 2 ? 'gate' : 'wall' });
  }
  return { sealed: true, cost: flow, tiles, gaps, side };
}
