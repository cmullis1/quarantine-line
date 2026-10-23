// Towns: houses whose windows light up at night in proportion to how many people are left,
// a landmark for each town's specialty, and the visible states of a town's fate.
// Each town is baked into one mesh, rebuilt only when it falls or is reclaimed; windows light from a per-vertex
// rank against the town's lit count, so emptying a town costs no rebuild.
import * as THREE from 'three';
import { createRng } from '../sim/rng.js';
import { makeHouse, makeApartment, makeLandmark, mat, mergeParts, bakedMesh } from './models.js';

const ASH = new THREE.Color(0x2a2420);
// Burnt versions keep a trace of the original colour so a dead town still reads as houses.
const burnt = (c, f) => c.clone().multiplyScalar(f).lerp(ASH, 0.35);

const HOUSE_EMIT = new THREE.Color(0xffc870).multiplyScalar(0.95), LANDMARK_EMIT = new THREE.Color(0xffd890).multiplyScalar(0.9);
const NONE = [0, 0, 0];
// aN: a house window's rank (lit while rank < uLit), -1 a landmark window (lit while the town lives),
// GLOW a part that always glows, NEVER a window that stays dark.
const GLOW = -1e6, NEVER = 1e6;

function townShader(shader) {
  shader.uniforms.uLit = this.userData.lit;
  shader.uniforms.uNight = this.userData.night;
  shader.vertexShader = 'attribute vec3 aEmit;\nattribute float aN;\nuniform float uLit;\nuniform float uNight;\nvarying vec3 vEmit;\n'
    + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vEmit = aEmit * (aN < -1000.0 ? 1.0 : step(aN + 0.5, uLit) * uNight);`);
  shader.fragmentShader = 'varying vec3 vEmit;\n' + shader.fragmentShader.replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive + vEmit;');
}

function townMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  m.userData.lit = { value: -1 };
  m.userData.night = { value: 0 };
  m.onBeforeCompile = townShader;
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

const glows = (m) => m.emissive && m.emissiveIntensity > 0 && (m.emissive.r || m.emissive.g || m.emissive.b);

export class Towns {
  constructor(scene, map) {
    this.scene = scene;
    this.map = map;
    this.towns = map.towns.map((info) => {
      const r = createRng(info.id * 7919 + 11);
      const t = { info, houses: [], status: 'ok', landmark: null, smoke: [], mat: townMaterial(), mesh: null };
      const spot = landmarkSpot(map, info);
      const used = new Set(spot ? spot[2] : []);
      if (spot) {
        const winMat = mat(0x2a3a4e).clone();
        const g = makeLandmark(info.specialty, winMat);
        g.position.set(spot[0] + 1, 0, spot[1] + 1);
        // burns: the burn factor of each fall, applied in turn (a landmark is not repaired on reclaim)
        t.landmark = { g, winMat, burns: [] };
        if (g.userData.smoke) t.smoke.push(...g.userData.smoke.map((v) => v.clone().add(g.position)));
      }
      // Density follows population: bigger towns are packed, small ones leave gaps.
      const fill = Math.min(0.92, 0.45 + info.pop / 350000);
      for (const k of info.tiles) {
        if (map.road[k] || used.has(k)) continue;
        const i = k % map.N, j = (k / map.N) | 0;
        const d = Math.hypot(i + 0.5 - info.x, j + 0.5 - info.z);
        if (r.next() > fill) continue;
        const winMat = new THREE.MeshLambertMaterial({ color: 0x2a3a4e });
        const g = info.capital && d < 2.6 ? makeApartment(() => r.next(), winMat) : makeHouse(() => r.next(), winMat);
        g.position.set(i + 0.5 + (r.next() - 0.5) * 0.12, 0, j + 0.5 + (r.next() - 0.5) * 0.12);
        g.rotation.y = Math.floor(r.next() * 4) * (Math.PI / 2);
        // rank decides the order in which houses go dark as the town empties; f is the burn factor (0 = intact)
        t.houses.push({ g, winMat, rank: r.next(), burnt: false, f: 0, sy: 1 });
      }
      t.houses.sort((a, b) => a.rank - b.rank);
      this.build(t);
      return t;
    });
  }

  // Bake the town's houses and landmark as they now stand into its one mesh.
  build(t) {
    const parts = [];
    const part = (o, color, emit, n) => parts.push({ geo: o.geometry, m: o.matrixWorld, color, emit, n });
    t.houses.forEach((h, n) => {
      h.g.scale.y = h.sy;
      h.g.updateMatrixWorld(true);
      h.g.traverse((o) => {
        if (!o.isMesh) return;
        if (o.material === h.winMat) part(o, o.material.color, HOUSE_EMIT, h.burnt ? NEVER : n);
        else part(o, h.burnt ? burnt(o.material.color, h.f) : o.material.color, NONE, GLOW);
      });
    });
    if (t.landmark) {
      const { g, winMat, burns } = t.landmark;
      g.updateMatrixWorld(true);
      g.traverse((o) => {
        if (!o.isMesh) return;
        if (o.material === winMat) return part(o, winMat.color, LANDMARK_EMIT, -1);
        let c = o.material.color;
        for (const f of burns) c = burnt(c, f);
        const e = !burns.length && glows(o.material) ? o.material.emissive.clone().multiplyScalar(o.material.emissiveIntensity) : NONE;
        part(o, c, e, GLOW);
      });
    }
    const rgb = (c) => (c === NONE ? NONE : [c.r, c.g, c.b]);
    const geo = mergeParts(parts, { aEmit: [3, (p) => rgb(p.emit)], aN: [1, (p) => [p.n]] });
    if (t.mesh) { t.mesh.geometry.dispose(); t.mesh.geometry = geo; return; }
    t.mesh = bakedMesh(geo, t.mat);
    this.scene.add(t.mesh);
  }

  setState(t, status) {
    if (t.status === status) return;
    const prev = t.status;
    t.status = status;
    if (status === 'fallen' || status === 'scorched') {
      const f = status === 'scorched' ? 0.22 : 0.42;
      for (const h of t.houses) {
        h.f = f;
        if (status === 'scorched' || Math.random() < 0.35) h.sy = 0.45 + Math.random() * 0.25;
        h.burnt = true;
      }
      if (t.landmark) t.landmark.burns.push(f);
      this.build(t);
    } else if (status === 'ok' && (prev === 'fallen' || prev === 'scorched')) {
      // Reclaimed: the first houses get repaired; the rest wait for people to come back.
      t.houses.forEach((h, n) => {
        if (n % 3 !== 0) return;
        h.f = 0;
        h.sy = 1;
        h.burnt = false;
      });
      this.build(t);
    }
  }

  // Each town's own material (its lit count and night are uniforms on it).
  dispose() {
    for (const t of this.towns) t.mat.dispose();
  }

  update(sim, night, fx, dt) {
    for (const t of this.towns) {
      const st = sim.state.towns[t.info.id];
      this.setState(t, st.status);
      const frac = st.status === 'ok' ? Math.max(0, Math.min(1, st.pop / st.pop0)) : 0;
      const lit = Math.round(t.houses.length * frac * (st.quarantine ? 0.7 : 1));
      // A lost town's landmark windows go dark with its houses.
      t.mat.userData.lit.value = st.status === 'ok' ? lit : -1;
      t.mat.userData.night.value = night;
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
