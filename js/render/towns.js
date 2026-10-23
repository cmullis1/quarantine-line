// Towns: houses whose windows light up at night in proportion to how many people are left,
// a landmark for each town's specialty, and the visible states of a town's fate.
import * as THREE from 'three';
import { createRng } from '../sim/rng.js';
import { makeHouse, makeApartment, makeLandmark, mat } from './models.js';

// Burnt versions keep a trace of the original colour so a dead town still reads as houses.
const burntCache = new Map();
function burnt(material, f) {
  const key = `${material.uuid}:${f}`;
  let m = burntCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: material.color.clone().multiplyScalar(f).lerp(new THREE.Color(0x2a2420), 0.35), flatShading: true });
    burntCache.set(key, m);
  }
  return m;
}

function landmarkSpot(map, info) {
  // Best 2×2 block of town tiles (no road) closest to the centre.
  const N = map.N, own = new Set(info.tiles);
  let best = null, bd = Infinity;
  for (const k of info.tiles) {
    const i = k % N, j = (k / N) | 0;
    const ks = [k, k + 1, k + N, k + N + 1];
    if (!ks.every((q) => own.has(q) && !map.road[q])) continue;
    const d = Math.hypot(i + 1 - info.x, j + 1 - info.z);
    if (d < bd) { bd = d; best = [i, j, ks]; }
  }
  return best;
}

export class Towns {
  constructor(scene, map) {
    this.scene = scene;
    this.map = map;
    this.towns = map.towns.map((info) => {
      const r = createRng(info.id * 7919 + 11);
      const t = { info, houses: [], status: 'ok', landmark: null, smoke: [] };
      const spot = landmarkSpot(map, info);
      const used = new Set(spot ? spot[2] : []);
      if (spot) {
        const winMat = mat(0x2a3a4e).clone();
        const g = makeLandmark(info.specialty, winMat);
        g.position.set(spot[0] + 1, 0, spot[1] + 1);
        scene.add(g);
        t.landmark = { g, winMat };
        if (g.userData.smoke) t.smoke.push(...g.userData.smoke.map((v) => v.clone().add(g.position)));
      }
      // Density follows population: bigger towns are packed, small ones leave gaps.
      const fill = Math.min(0.92, 0.45 + info.pop / 350000);
      for (const k of info.tiles) {
        if (map.road[k] || used.has(k)) continue;
        const i = k % map.N, j = (k / map.N) | 0;
        const d = Math.hypot(i + 0.5 - info.x, j + 0.5 - info.z);
        if (r.next() > fill) continue;
        const winMat = new THREE.MeshLambertMaterial({ color: 0x2a3a4e, emissive: 0xffc870, emissiveIntensity: 0 });
        const g = info.capital && d < 2.6 ? makeApartment(() => r.next(), winMat) : makeHouse(() => r.next(), winMat);
        g.position.set(i + 0.5 + (r.next() - 0.5) * 0.12, 0, j + 0.5 + (r.next() - 0.5) * 0.12);
        g.rotation.y = Math.floor(r.next() * 4) * (Math.PI / 2);
        const originals = [];
        g.traverse((o) => { if (o.isMesh) originals.push([o, o.material]); });
        scene.add(g);
        // rank decides the order in which houses go dark as the town empties
        t.houses.push({ g, winMat, rank: r.next(), originals, burnt: false });
      }
      t.houses.sort((a, b) => a.rank - b.rank);
      return t;
    });
  }

  setState(t, status, fx) {
    if (t.status === status) return;
    const prev = t.status;
    t.status = status;
    if (status === 'fallen' || status === 'scorched') {
      const f = status === 'scorched' ? 0.22 : 0.42;
      for (const h of t.houses) {
        for (const [o, m] of h.originals) if (m !== h.winMat) o.material = burnt(m, f);
        if (status === 'scorched' || Math.random() < 0.35) h.g.scale.y = 0.45 + Math.random() * 0.25;
        h.burnt = true;
      }
      if (t.landmark) t.landmark.g.traverse((o) => { if (o.isMesh && o.material !== t.landmark.winMat) o.material = burnt(o.material, f); });
    } else if (status === 'ok' && (prev === 'fallen' || prev === 'scorched')) {
      // Reclaimed: the first houses get repaired; the rest wait for people to come back.
      t.houses.forEach((h, n) => {
        if (n % 3 !== 0) return;
        for (const [o, m] of h.originals) o.material = m;
        h.g.scale.y = 1;
        h.burnt = false;
      });
    }
  }

  update(sim, night, fx, dt) {
    for (const t of this.towns) {
      const st = sim.state.towns[t.info.id];
      this.setState(t, st.status, fx);
      const frac = st.status === 'ok' ? Math.max(0, Math.min(1, st.pop / st.pop0)) : 0;
      const lit = Math.round(t.houses.length * frac * (st.quarantine ? 0.7 : 1));
      t.houses.forEach((h, n) => {
        const on = n < lit && !h.burnt;
        h.winMat.emissiveIntensity = on ? night * 0.95 : 0;
      });
      if (t.landmark) {
        t.landmark.winMat.emissive = t.landmark.winMat.emissive || new THREE.Color();
        t.landmark.winMat.emissive.setHex(st.status === 'ok' ? 0xffd890 : 0x000000);
        t.landmark.winMat.emissiveIntensity = st.status === 'ok' ? night * 0.9 : 0;
      }
      if (st.status === 'ok' && t.smoke.length && Math.random() < dt * 4) {
        const p = t.smoke[Math.floor(Math.random() * t.smoke.length)];
        fx.smoke(p.x, p.y, p.z, false);
      }
      if (st.status !== 'ok' && t.houses.length) {
        if (Math.random() < dt * (st.fireT > 0 ? 14 : 3)) {
          const h = t.houses[Math.floor(Math.random() * t.houses.length)];
          fx.smoke(h.g.position.x, 0.6, h.g.position.z, true, 1.3);
          if (st.fireT > 0) fx.fire(h.g.position.x, 0.3, h.g.position.z);
        }
      }
    }
  }
}
