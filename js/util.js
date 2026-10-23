export function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const pick = (arr, r = Math.random) => arr[Math.floor(r() * arr.length)];
export const rnd = (a, b) => a + Math.random() * (b - a);

export function fmt(n) {
  n = Math.max(0, n);
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e4) return Math.round(n / 1e3) + 'k';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return Math.round(n) + '';
}

export function angleTo(dx, dz) {
  return Math.atan2(dx, dz);
}

export function turnToward(cur, target, maxStep) {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}

// Uniform grid bucket hash over the map, rebuilt every sim step.
export class SpatialHash {
  constructor(size, cell) {
    this.cell = cell;
    this.n = Math.ceil(size / cell) + 1;
    this.buckets = Array.from({ length: this.n * this.n }, () => []);
  }
  clear() {
    for (const b of this.buckets) b.length = 0;
  }
  key(x, z) {
    const cx = clamp(Math.floor(x / this.cell), 0, this.n - 1);
    const cz = clamp(Math.floor(z / this.cell), 0, this.n - 1);
    return cz * this.n + cx;
  }
  insert(o) {
    this.buckets[this.key(o.x, o.z)].push(o);
  }
  // Calls fn(obj, distSq) for every object within r of (x, z).
  query(x, z, r, fn) {
    const c = this.cell, n = this.n;
    const x0 = clamp(Math.floor((x - r) / c), 0, n - 1), x1 = clamp(Math.floor((x + r) / c), 0, n - 1);
    const z0 = clamp(Math.floor((z - r) / c), 0, n - 1), z1 = clamp(Math.floor((z + r) / c), 0, n - 1);
    const r2 = r * r;
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const b = this.buckets[cz * n + cx];
        for (let i = 0; i < b.length; i++) {
          const o = b[i];
          const dx = o.x - x, dz = o.z - z;
          const d2 = dx * dx + dz * dz;
          if (d2 <= r2) fn(o, d2);
        }
      }
    }
  }
  nearest(x, z, r, filter) {
    let best = null, bd = Infinity;
    this.query(x, z, r, (o, d2) => {
      if (d2 < bd && (!filter || filter(o))) { bd = d2; best = o; }
    });
    return best;
  }
}

export class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length > 0) {
      let i = 0;
      const n = k.length;
      while (true) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}
