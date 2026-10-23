// Static world geometry built from the map: terrain blocks, mountains, water, bridges, forests,
// farmland, border line, foreign ruins. Also owns the fog-of-war tint.
import * as THREE from 'three';
import { TER } from '../config/world.js';
import { createRng } from '../sim/rng.js';
import { makeBridge, makeRuin, makeHouse, mat } from './models.js';

const SLAB = 1.6;
const GRASS = [0x5f8f3e, 0x679845, 0x5a873b, 0x6b9a4a];
const FOREIGN = [0x8a8656, 0x7f7b4f, 0x8f8a5c, 0x77744c];
const FARM = [0xa7a050, 0x8fae4a, 0xb8a85a, 0x7f9e44];
const MOUNTAIN = [0x8a8478, 0x7a756c, 0x96907f];

export class Terrain {
  constructor(scene, map) {
    this.scene = scene;
    this.map = map;
    const N = map.N, r = createRng(map.seed * 17 + 3);
    this.N = N;
    this.base = new Float32Array(N * N * 3);
    this.fogF = new Float32Array(N * N).fill(-1);
    const terrain = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), N * N);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    this.tops = new Float32Array(N * N);
    let caps = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, t = map.terrain[k];
      let top = 0;
      if (t === TER.SEA) top = -0.62;
      else if (t === TER.RIVER || t === TER.LAKE) top = -0.48;
      else if (t === TER.MOUNTAIN) top = 0.15 + map.height[k] * 0.24 + r.next() * 0.1;
      this.tops[k] = top;
      const h = SLAB + top;
      m.makeScale(1, h, 1);
      m.setPosition(i + 0.5, top - h / 2, j + 0.5);
      terrain.setMatrixAt(k, m);
      let col;
      if (t === TER.SEA) col = 0x23476a;
      else if (t === TER.RIVER || t === TER.LAKE) col = 0x2c5878;
      else if (t === TER.MOUNTAIN) col = MOUNTAIN[Math.floor(r.next() * 3)];
      else if (map.road[k]) col = 0x6e6c66;
      else if (map.sand[k]) col = 0xcdbb88;
      else if (map.farmland[k]) col = FARM[(i + j * 3) % 4];
      else if (map.owner[k]) col = GRASS[Math.floor(r.next() * 4)];
      else col = FOREIGN[Math.floor(r.next() * 4)];
      c.setHex(col);
      if (t === TER.LAND && !map.road[k]) c.offsetHSL(0, 0, (r.next() - 0.5) * 0.03);
      this.base[k * 3] = c.r; this.base[k * 3 + 1] = c.g; this.base[k * 3 + 2] = c.b;
      terrain.setColorAt(k, c);
      if (t === TER.MOUNTAIN) caps.push([i, j, top, map.height[k], r.next()]);
    }
    terrain.receiveShadow = true;
    terrain.castShadow = true;
    terrain.frustumCulled = false;
    scene.add(terrain);
    this.mesh = terrain;

    // Peaks: a rocky pyramid on every mountain tile, snow-tipped on the highest.
    if (caps.length) {
      const pyr = new THREE.ConeGeometry(0.72, 1, 4);
      pyr.rotateY(Math.PI / 4 + 0.001);
      pyr.translate(0, 0.5, 0);
      const peaks = new THREE.InstancedMesh(pyr, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), caps.length);
      const q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
      caps.forEach(([i, j, top, h, rr], n) => {
        const ph = 0.35 + h * 0.28 + rr * 0.35;
        q.setFromAxisAngle(v.set(0, 1, 0), Math.floor(rr * 4) * (Math.PI / 2));
        m.compose(v.set(i + 0.5 + (rr - 0.5) * 0.2, top, j + 0.5 + (rr - 0.5) * 0.2), q, sc.set(1, ph, 1));
        peaks.setMatrixAt(n, m);
        c.setHex(h >= 4 ? 0xe8ecf0 : h >= 3 && rr > 0.5 ? 0xb8b6ae : MOUNTAIN[Math.floor(rr * 3)]);
        peaks.setColorAt(n, c);
      });
      peaks.castShadow = true; peaks.receiveShadow = true; peaks.frustumCulled = false;
      scene.add(peaks);
    }

    this.buildWater();
    this.buildBorder();
    this.buildTrees(r);
    this.buildFarmRows(r);
    this.buildBridges();
    this.buildRuins(r);
  }

  buildWater() {
    const N = this.N;
    // One wave vertex every two tiles, whatever the map size.
    const geo = new THREE.PlaneGeometry(N + 40, N + 40, (N + 40) / 2, (N + 40) / 2);
    geo.rotateX(-Math.PI / 2);
    const material = new THREE.MeshLambertMaterial({ color: 0x3a7ab0, transparent: true, opacity: 0.78, flatShading: true });
    this.waterTime = { value: 0 };
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.waterTime;
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp = modelMatrix * vec4(transformed, 1.0);
        transformed.y += sin(wp.x * 0.9 + uTime * 1.3) * 0.045 + cos(wp.z * 0.7 + uTime * 0.9) * 0.04;`);
    };
    const water = new THREE.Mesh(geo, material);
    water.position.set(N / 2, -0.16, N / 2);
    water.receiveShadow = true;
    this.scene.add(water);
    this.water = water;
  }

  buildBorder() {
    const map = this.map, N = this.N, edges = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (!map.border[k]) continue;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const nk = nj * N + ni;
        if (!map.owner[nk] && map.terrain[nk] !== TER.SEA) edges.push([i + 0.5 + di * 0.5, j + 0.5 + dj * 0.5, di !== 0, Math.max(this.tops[k], this.tops[nk])]);
      }
    }
    const bm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xf0c94a }), edges.length * 2);
    const m = new THREE.Matrix4();
    let n = 0;
    for (const [x, z, vertical, top] of edges) for (const off of [-0.25, 0.25]) {
      if (vertical) { m.makeScale(0.08, 0.04, 0.32); m.setPosition(x, Math.max(0, top) + 0.02, z + off); }
      else { m.makeScale(0.32, 0.04, 0.08); m.setPosition(x + off, Math.max(0, top) + 0.02, z); }
      bm.setMatrixAt(n++, m);
    }
    bm.frustumCulled = false;
    this.scene.add(bm);
    this.borderMesh = bm;
  }

  buildTrees(r) {
    const map = this.map, N = this.N, spots = [];
    for (let k = 0; k < N * N; k++) {
      if (!map.forest[k]) continue;
      const i = k % N, j = (k / N) | 0;
      const cnt = 1 + Math.floor(r.next() * 2.4);
      for (let q = 0; q < cnt; q++) spots.push([k, i + 0.15 + r.next() * 0.7, j + 0.15 + r.next() * 0.7, 0.65 + r.next() * 0.7, map.owner[k], r.next() < 0.3]);
    }
    // Scattered single trees in open country.
    for (let k = 0; k < N * N; k++) {
      if (map.forest[k] || map.road[k] || map.townId[k] >= 0 || map.terrain[k] !== TER.LAND || map.sand[k] || map.farmland[k]) continue;
      if (r.next() < 0.035) spots.push([k, (k % N) + 0.2 + r.next() * 0.6, ((k / N) | 0) + 0.2 + r.next() * 0.6, 0.6 + r.next() * 0.5, map.owner[k], true]);
    }
    const pine = new THREE.ConeGeometry(0.26, 0.75, 5); pine.translate(0, 0.55, 0);
    const leafy = new THREE.IcosahedronGeometry(0.28, 0); leafy.translate(0, 0.52, 0);
    const trunk = new THREE.BoxGeometry(0.08, 0.28, 0.08); trunk.translate(0, 0.14, 0);
    const nPine = spots.filter((s) => !s[5]).length, nLeafy = spots.length - nPine;
    this.pines = new THREE.InstancedMesh(pine, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), Math.max(1, nPine));
    this.leafy = new THREE.InstancedMesh(leafy, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), Math.max(1, nLeafy));
    this.trunks = new THREE.InstancedMesh(trunk, new THREE.MeshLambertMaterial({ color: 0x5a4028 }), Math.max(1, spots.length));
    this.treeAt = new Map();
    this.treeBase = [];
    const m = new THREE.Matrix4(), c = new THREE.Color(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
    let ip = 0, il = 0;
    spots.forEach(([k, x, z, sc, home, isLeafy], n) => {
      q.setFromAxisAngle(v.set(0, 1, 0), r.next() * 6.28);
      m.compose(v.set(x, 0, z), q, s.set(sc, sc * (0.9 + r.next() * 0.3), sc));
      this.trunks.setMatrixAt(n, m);
      const mesh = isLeafy ? this.leafy : this.pines, idx = isLeafy ? il++ : ip++;
      mesh.setMatrixAt(idx, m);
      const col = home ? (isLeafy ? [0x4f8a3a, 0x5e9a40, 0x6a9a3a][n % 3] : [0x2f6b34, 0x3a7a3a, 0x2a5e30][n % 3]) : (isLeafy ? [0x7a7a4a, 0x6a6a42][n % 2] : [0x5e6040, 0x55573a, 0x6a6448][n % 3]);
      c.setHex(col);
      mesh.setColorAt(idx, c);
      const rec = { k, mesh, idx, trunk: n, matrix: m.clone(), color: col };
      this.treeBase.push(rec);
      (this.treeAt.get(k) || this.treeAt.set(k, []).get(k)).push(rec);
    });
    for (const im of [this.pines, this.leafy, this.trunks]) { im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; this.scene.add(im); }
  }

  clearTrees(k) {
    const list = this.treeAt.get(k);
    if (!list) return;
    const z = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const t of list) { t.mesh.setMatrixAt(t.idx, z); this.trunks.setMatrixAt(t.trunk, z); t.cut = true; }
    this.pines.instanceMatrix.needsUpdate = this.leafy.instanceMatrix.needsUpdate = this.trunks.instanceMatrix.needsUpdate = true;
    this.treeAt.delete(k);
  }

  buildFarmRows(r) {
    const map = this.map, N = this.N, rows = [];
    for (let k = 0; k < N * N; k++) if (map.farmland[k] && !map.road[k]) {
      const i = k % N, j = (k / N) | 0, horiz = ((i >> 2) + (j >> 2)) % 2 === 0;
      for (let q = 0; q < 3; q++) rows.push([i, j, horiz, q, FARM[(i * 7 + j) % 4]]);
    }
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, rows.length));
    const m = new THREE.Matrix4(), c = new THREE.Color();
    rows.forEach(([i, j, horiz, q, col], n) => {
      if (horiz) { m.makeScale(0.9, 0.06, 0.12); m.setPosition(i + 0.5, 0.03, j + 0.2 + q * 0.3); }
      else { m.makeScale(0.12, 0.06, 0.9); m.setPosition(i + 0.2 + q * 0.3, 0.03, j + 0.5); }
      mesh.setMatrixAt(n, m);
      c.setHex(col).offsetHSL(0, 0.05, -0.08);
      mesh.setColorAt(n, c);
    });
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  buildBridges() {
    const map = this.map, N = this.N;
    for (let k = 0; k < N * N; k++) {
      if (!map.bridge[k]) continue;
      const i = k % N, j = (k / N) | 0;
      const horiz = (i > 0 && map.road[k - 1]) || (i < N - 1 && map.road[k + 1]);
      const b = makeBridge(horiz);
      b.position.set(i + 0.5, 0.05, j + 0.5);
      this.scene.add(b);
    }
  }

  buildRuins(r) {
    this.ruins = [];
    for (const s of this.map.sites) {
      for (let q = 0; q < 18; q++) {
        const a = r.next() * Math.PI * 2, d = r.next() * 3.4;
        const i = Math.round(s.i + Math.cos(a) * d), j = Math.round(s.j + Math.sin(a) * d);
        if (i < 0 || j < 0 || i >= this.N || j >= this.N) continue;
        const k = j * this.N + i;
        if (this.map.road[k] || this.map.terrain[k] !== TER.LAND) continue;
        const g = r.next() < 0.45 ? makeHouse(() => r.next(), mat(0x2a3a4e)) : makeRuin(() => r.next());
        g.position.set(i + 0.5, 0, j + 0.5);
        g.rotation.y = Math.floor(r.next() * 4) * (Math.PI / 2);
        this.scene.add(g);
        this.ruins.push({ g, k, siteId: s.id });
      }
    }
  }

  // Fog of war: darken foreign tiles that aren't visible; remembered tiles are dimmer than visible ones.
  updateFog(vis, seen) {
    const N = this.N, map = this.map, c = new THREE.Color();
    let dirty = false;
    for (let k = 0; k < N * N; k++) {
      if (map.owner[k]) continue;
      const f = vis[k] ? 1 : seen[k] ? 0.62 : 0.36;
      if (this.fogF[k] === f) continue;
      this.fogF[k] = f;
      c.setRGB(this.base[k * 3] * f, this.base[k * 3 + 1] * f, this.base[k * 3 + 2] * (f + (1 - f) * 0.35));
      this.mesh.setColorAt(k, c);
      dirty = true;
    }
    if (dirty) this.mesh.instanceColor.needsUpdate = true;
    for (const ru of this.ruins) ru.g.visible = seen[ru.k] === 1;
  }

  update(t) { this.waterTime.value = t; }
}
