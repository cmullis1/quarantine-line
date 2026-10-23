// mulberry32 with an exposed state so the generator can be saved and restored.
export function createRng(seed) {
  const r = {
    state: seed >>> 0,
    next() {
      r.state = (r.state + 0x6d2b79f5) >>> 0;
      let t = r.state;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    range(a, b) { return a + r.next() * (b - a); },
    int(a, b) { return a + Math.floor(r.next() * (b - a + 1)); },
    pick(arr) { return arr[Math.floor(r.next() * arr.length)]; },
    chance(p) { return r.next() < p; },
  };
  return r;
}

// Smooth 2D value noise in [0, 1], deterministic for a seed.
export function valueNoise(seed) {
  const hash = (x, y) => {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const tx = smooth(x - xi), ty = smooth(y - yi);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

export function fbm(noise, x, y, octaves = 3) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < octaves; o++) { v += noise(x * f, y * f) * amp; norm += amp; amp *= 0.5; f *= 2; }
  return v / norm;
}
