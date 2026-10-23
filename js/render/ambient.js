// Ambient life that tells the story without numbers: civilians in living towns, traffic that thins as the
// country panics, abandoned cars, crows over fallen towns, rain. Purely visual and not saved.
import * as THREE from 'three';
import { createRng } from '../sim/rng.js';
import { makeCar, PALETTE } from './models.js';

const SKIN = [0xe0b48f, 0xc68e66, 0x8d5a3b, 0xf1c9a5];
const CLOTH = [0x9b3b3b, 0x3b5b9b, 0x7a6a4a, 0x4a7a5a, 0xb08a3a, 0x6a4a7a, 0xc8c0b0, 0x5a8aa0];
const CAR_COLORS = [0xb03030, 0x3050a0, 0xd0d0d0, 0x303030, 0x2a7a4a, 0xd0a030];

export class Ambient {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.r = createRng(sim.state.seed * 13 + 5);
    this.civs = [];
    this.cars = [];
    this.wrecks = [];
    this.wreckDay = 0;
    // Crows: one instanced mesh of tiny flapping birds.
    this.crowMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.02, 0.06), new THREE.MeshBasicMaterial({ color: 0x111111 }), 120);
    this.crowMesh.frustumCulled = false;
    this.crowMesh.count = 0;
    scene.add(this.crowMesh);
    // Rain: slanted streaks, and splashes that flick up where drops land. `wet` eases 0–1 as a shower rolls in.
    const n = 1600;
    this.rainPos = new Float32Array(n * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xb4c6da, transparent: true, opacity: 0 }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    scene.add(this.rain);
    this.rainDrops = Array.from({ length: n }, () => ({ x: 0, y: -1, z: 0 }));
    const sn = 500;
    this.splashPos = new Float32Array(sn * 3);
    this.splashCol = new Float32Array(sn * 3);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.splashPos, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('color', new THREE.BufferAttribute(this.splashCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.splashes = new THREE.Points(sg, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.splashes.frustumCulled = false;
    this.splashes.visible = false;
    scene.add(this.splashes);
    this.splashLife = new Float32Array(sn);
    this.splashNext = 0;
    this.wet = 0;
    this._m = new THREE.Matrix4();
  }

  spawnCiv(info) {
    const r = this.r;
    const k = info.tiles[Math.floor(r.next() * info.tiles.length)];
    const x = (k % this.sim.N) + 0.5, z = ((k / this.sim.N) | 0) + 0.5;
    this.civs.push({
      town: info.id, kind: 'civ', x, z, y: 0, rot: r.next() * 6.28, phase: r.next() * 6, moving: true,
      skin: SKIN[Math.floor(r.next() * SKIN.length)], shirt: CLOTH[Math.floor(r.next() * CLOTH.length)], pants: 0x2f3a55,
      tx: x, tz: z, wait: 0, scale: r.next() < 0.15 ? 0.72 : 1,
    });
  }

  update(dt, time, night, view, realDt = dt) {
    const sim = this.sim, s = sim.state, r = this.r;
    // Civilians: fewer at night, fewer in quarantined or panicking towns, none in dead towns.
    for (const t of s.towns) {
      const info = sim.map.towns[t.id];
      let want = t.status === 'ok' ? Math.round(Math.min(10, 2 + t.pop / 60000)) : 0;
      if (t.quarantine) want = Math.ceil(want * 0.3);
      if (t.breakout || t.alerted) want = Math.ceil(want * 0.5);
      want = Math.round(want * (1 - night * 0.8));
      const have = this.civs.filter((c) => c.town === t.id);
      if (have.length < want && r.next() < dt * 2) this.spawnCiv(info);
      if (have.length > want && r.next() < dt * 2) this.civs.splice(this.civs.indexOf(have[0]), 1);
    }
    for (const c of this.civs) {
      const info = sim.map.towns[c.town];
      if (c.wait > 0) { c.wait -= dt; c.moving = false; continue; }
      const dx = c.tx - c.x, dz = c.tz - c.z, d = Math.hypot(dx, dz);
      if (d < 0.1) {
        c.wait = r.next() * 3;
        const a = r.next() * 6.28, rr = r.next() * info.r;
        c.tx = info.x + Math.cos(a) * rr; c.tz = info.z + Math.sin(a) * rr;
        continue;
      }
      const sp = 0.5 * dt;
      c.x += (dx / d) * Math.min(sp, d); c.z += (dz / d) * Math.min(sp, d);
      c.rot = Math.atan2(dx, dz);
      c.moving = true;
      c.phase += dt * 7;
    }

    // Traffic between living towns; thins with each act and stops when order collapses.
    const living = s.towns.filter((t) => t.status === 'ok' && !t.quarantine);
    const wantCars = s.order < 30 ? 0 : Math.max(0, 14 - sim.act * 3);
    if (this.cars.length < wantCars && living.length > 1 && r.next() < dt * 1.5) {
      const a = sim.map.towns[living[Math.floor(r.next() * living.length)].id];
      const b = sim.map.towns[living[Math.floor(r.next() * living.length)].id];
      if (a !== b) {
        // Traffic keeps to the roads; towns with no road between them get none.
        const path = sim.nav.roadPath(a.x, a.z, b.x, b.z);
        if (path && path.length) {
          const g = makeCar(CAR_COLORS[Math.floor(r.next() * CAR_COLORS.length)]);
          g.position.set(a.x, 0, a.z);
          this.scene.add(g);
          this.cars.push({ g, path, speed: 2.2 + r.next() * 1.2 });
        }
      }
    }
    for (let k = this.cars.length - 1; k >= 0; k--) {
      const c = this.cars[k];
      const p = c.g.position;
      if (!c.path.length) { this.scene.remove(c.g); this.cars.splice(k, 1); continue; }
      const [tx, tz] = c.path[0];
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      const step = c.speed * dt;
      if (d <= step) { p.x = tx; p.z = tz; c.path.shift(); } else { p.x += (dx / d) * step; p.z += (dz / d) * step; }
      if (d > 0.01) c.g.rotation.y = Math.atan2(dx, dz);
    }

    // Abandoned cars accumulate on the roads after Act I.
    if (sim.day !== this.wreckDay) {
      this.wreckDay = sim.day;
      const want = sim.act <= 1 ? 0 : Math.min(40, (sim.day - 6) * 2);
      const m = sim.map;
      for (let tries = 0; this.wrecks.length < want && tries < 200; tries++) {
        const k = Math.floor(r.next() * m.N * m.N);
        if (!m.road[k] || m.townId[k] >= 0 || m.bridge[k]) continue;
        const g = makeCar(CAR_COLORS[Math.floor(r.next() * CAR_COLORS.length)]);
        g.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.55); } });
        g.position.set((k % m.N) + 0.25 + r.next() * 0.5, 0, ((k / m.N) | 0) + 0.25 + r.next() * 0.5);
        g.rotation.y = r.next() * 6.28;
        this.scene.add(g);
        this.wrecks.push(g);
      }
    }

    // Crows circle fallen towns and fresh battlefields.
    let n = 0;
    const m = this._m;
    for (const t of s.towns) {
      if (t.status === 'ok') continue;
      const info = sim.map.towns[t.id];
      for (let b = 0; b < 12 && n < 120; b++) {
        const a = time * (0.4 + (b % 3) * 0.12) + b * 0.52 + t.id;
        const rr = 1.5 + (b % 4) * 0.7;
        m.makeRotationY(-a);
        m.multiply(new THREE.Matrix4().makeRotationZ(Math.sin(time * 9 + b) * 0.5));
        m.setPosition(info.x + Math.cos(a) * rr, 2.6 + (b % 5) * 0.25 + Math.sin(time + b) * 0.15, info.z + Math.sin(a) * rr);
        this.crowMesh.setMatrixAt(n++, m);
      }
    }
    this.crowMesh.count = n;
    this.crowMesh.instanceMatrix.needsUpdate = true;

    // Rain rolls in and out over a few seconds of real time.
    const raining = sim.weather.rain;
    this.raining = raining;
    this.foggy = sim.weather.fog;
    this.wet += ((raining ? 1 : 0) - this.wet) * Math.min(1, realDt * 0.35);
    const showing = this.wet > 0.02;
    this.rain.visible = this.splashes.visible = showing;
    if (showing) {
      this.rain.material.opacity = 0.6 * this.wet;
      const cx = view.x, cz = view.z, R = 26 / Math.max(0.7, view.zoom);
      const pos = this.rainPos, sp = this.splashPos, sc = this.splashCol, life = this.splashLife;
      const active = Math.floor(this.rainDrops.length * this.wet);
      this.rainDrops.forEach((d, i) => {
        if (i >= active) { d.y = -1; pos.fill(0, i * 6, i * 6 + 6); return; }
        d.y -= dt * 16;
        d.x -= dt * 2.4;
        if (d.y < 0) {
          // A splash where the drop came down, then a new drop somewhere above the view.
          if (d.x || d.z) {
            const k = this.splashNext = (this.splashNext + 1) % life.length;
            sp[k * 3] = d.x; sp[k * 3 + 1] = 0.05; sp[k * 3 + 2] = d.z; life[k] = 1;
          }
          d.x = cx + (r.next() - 0.5) * R * 2 + 3; d.z = cz + (r.next() - 0.5) * R * 2; d.y = 6 + r.next() * 6;
        }
        const o = i * 6;
        pos[o] = d.x; pos[o + 1] = d.y; pos[o + 2] = d.z;
        pos[o + 3] = d.x + 0.09; pos[o + 4] = d.y - 0.6; pos[o + 5] = d.z + 0.02;
      });
      for (let k = 0; k < life.length; k++) {
        life[k] = Math.max(0, life[k] - dt * 5);
        const c = life[k] * 0.55 * this.wet;
        sc[k * 3] = c * 0.8; sc[k * 3 + 1] = c * 0.88; sc[k * 3 + 2] = c;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.splashes.geometry.attributes.position.needsUpdate = true;
      this.splashes.geometry.attributes.color.needsUpdate = true;
    }
  }

  figures() { return this.civs; }
}
