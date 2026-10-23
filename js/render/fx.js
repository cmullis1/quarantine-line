// Pooled visual effects driven by sim events: tracers, particles (smoke, fire, blood, sparks, debris,
// flame), ground decals (blood, scorch), shockwave rings, artillery shells in flight, flyovers, rain.
import * as THREE from 'three';
import { makePlane } from './models.js';

const MAX_TRACERS = 384;
const MAX_PARTICLES = 2400;
const MAX_DECALS = 700;
const MAX_RINGS = 24;

const WEAPON_COLOR = {
  rifle: 0xffe08a, tower: 0xffe08a, checkpoint: 0xffe08a, hq: 0xffe08a, mg: 0xffc050, hmg: 0xffc050, gunship: 0xffb040,
  sniper: 0xffffff, flamer: 0xff8020, melee: 0, baton: 0,
};

export class FX {
  constructor(scene) {
    this.scene = scene;
    // Tracers
    this.tPos = new Float32Array(MAX_TRACERS * 6);
    this.tCol = new Float32Array(MAX_TRACERS * 6);
    this.tLife = new Float32Array(MAX_TRACERS);
    this.tNext = 0;
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.tPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(this.tCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracers = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 }));
    this.tracers.frustumCulled = false;
    scene.add(this.tracers);

    // Particles
    this.parts = [];
    for (let i = 0; i < MAX_PARTICLES; i++) this.parts.push({ life: 0 });
    this.pNext = 0;
    this.pMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_PARTICLES);
    this.pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < MAX_PARTICLES; i++) this.pMesh.setColorAt(i, white);
    this.pMesh.frustumCulled = false;
    this.pMesh.count = 0;
    scene.add(this.pMesh);

    // Decals
    const dg = new THREE.CircleGeometry(0.5, 7);
    dg.rotateX(-Math.PI / 2);
    this.dMesh = new THREE.InstancedMesh(dg, new THREE.MeshLambertMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), MAX_DECALS);
    this.dMesh.receiveShadow = true;
    this.dMesh.frustumCulled = false;
    for (let i = 0; i < MAX_DECALS; i++) this.dMesh.setColorAt(i, white);
    this.dMesh.count = 0;
    this.dNext = 0;
    scene.add(this.dMesh);

    // Expanding rings (move orders, shockwaves, screams, sirens, recon)
    this.rings = [];
    const rg = new THREE.RingGeometry(0.955, 1, 48);
    rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_RINGS; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false;
      m.renderOrder = 5;
      scene.add(m);
      this.rings.push({ mesh: m, t: 0, dur: 1, r0: 0.3, r1: 1 });
    }
    this.rNext = 0;

    // Artillery shells in flight
    this.shells = [];
    this.shellGeo = new THREE.SphereGeometry(0.09, 6, 4);
    this.shellMat = new THREE.MeshBasicMaterial({ color: 0x302a20 });

    // Flyovers
    this.planes = [];

    this.shake = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    this._c2 = new THREE.Color();
  }

  tracer(ax, ay, az, bx, by, bz, color = 0xffe08a, life = 0.07) {
    const i = this.tNext; this.tNext = (i + 1) % MAX_TRACERS;
    const p = this.tPos, o = i * 6;
    const t = 0.3;
    p[o] = ax + (bx - ax) * t; p[o + 1] = ay + (by - ay) * t; p[o + 2] = az + (bz - az) * t;
    p[o + 3] = bx; p[o + 4] = by; p[o + 5] = bz;
    this._c.setHex(color);
    for (let k = 0; k < 2; k++) { this.tCol[o + k * 3] = this._c.r; this.tCol[o + k * 3 + 1] = this._c.g; this.tCol[o + k * 3 + 2] = this._c.b; }
    this.tLife[i] = life;
  }

  particle(x, y, z, o) {
    const p = this.parts[this.pNext];
    this.pNext = (this.pNext + 1) % MAX_PARTICLES;
    p.x = x; p.y = y; p.z = z;
    p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
    p.g = o.g || 0; p.drag = o.drag || 0;
    p.life = p.max = o.life || 1;
    p.size = o.size || 0.1; p.grow = o.grow || 0;
    p.color = o.color; p.color2 = o.color2 ?? o.color;
    p.spin = o.spin || 0;
    return p;
  }

  flash(x, y, z, size = 0.1, color = 0xfff1a0) { this.particle(x, y, z, { life: 0.05, size, color }); }

  blood(x, z, n = 5, y = 0.35) {
    for (let i = 0; i < n; i++) this.particle(x, y, z, { vx: (Math.random() - 0.5) * 1.8, vy: 1 + Math.random() * 1.6, vz: (Math.random() - 0.5) * 1.8, g: -8, life: 0.55, size: 0.05, color: 0x7a0c0c, color2: 0x3a0606 });
  }

  headpop(x, y, z) {
    for (let i = 0; i < 7; i++) this.particle(x, y + 0.5, z, { vx: (Math.random() - 0.5) * 2.4, vy: 1.4 + Math.random() * 1.4, vz: (Math.random() - 0.5) * 2.4, g: -9, life: 0.6, size: 0.04 + Math.random() * 0.03, color: 0x8a1010, color2: 0x2a0505 });
  }

  dust(x, z, n = 3, y = 0.4) {
    for (let i = 0; i < n; i++) this.particle(x, y, z, { vx: (Math.random() - 0.5) * 0.8, vy: 0.5 + Math.random() * 0.4, vz: (Math.random() - 0.5) * 0.8, g: -2, life: 0.6, size: 0.07, grow: 0.06, color: 0xa09a88, color2: 0x7a756a });
  }

  sparks(x, y, z, n = 4) {
    for (let i = 0; i < n; i++) this.particle(x, y, z, { vx: (Math.random() - 0.5) * 2.5, vy: Math.random() * 2, vz: (Math.random() - 0.5) * 2.5, g: -6, life: 0.3, size: 0.03, color: 0xffd060, color2: 0xff6020 });
  }

  smoke(x, y, z, dark = false, big = 1) {
    const c = dark ? 0x3e3c3a : 0x9a9a9a;
    this.particle(x + (Math.random() - 0.5) * 0.12, y, z + (Math.random() - 0.5) * 0.12, { vx: 0.18 + Math.random() * 0.1, vy: 0.45 + Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.12, life: 3.2, size: 0.09 * big, grow: 0.15 * big, color: c, color2: dark ? 0x6a6866 : 0xc8c8c8 });
  }

  fire(x, y, z, spread = 0.4) {
    this.particle(x + (Math.random() - 0.5) * spread, y, z + (Math.random() - 0.5) * spread, { vy: 0.8 + Math.random() * 0.7, life: 0.65, size: 0.16, grow: -0.15, color: 0xffc030, color2: 0xb02a0a });
  }

  flame(ax, ay, az, bx, bz) {
    // Flamer stream: a short-lived cone of fire toward the target.
    for (let i = 0; i < 6; i++) {
      const t = Math.random();
      this.particle(ax + (bx - ax) * t, ay - 0.1 * t, az + (bz - az) * t, { vx: (bx - ax) * 1.5, vz: (bz - az) * 1.5, vy: 0.4, life: 0.25 + Math.random() * 0.15, size: 0.08 + t * 0.12, grow: 0.2, color: 0xfff060, color2: 0xd03010 });
    }
  }

  explosion(x, z, scale = 1, kind = 'shell') {
    const n = Math.round(22 * scale);
    for (let i = 0; i < n; i++) this.particle(x, 0.3, z, { vx: (Math.random() - 0.5) * 3.5 * scale, vy: Math.random() * 3.2 * scale, vz: (Math.random() - 0.5) * 3.5 * scale, g: -4, life: 0.65, size: 0.18 * scale, grow: -0.2, color: kind === 'napalm' ? 0xffa020 : 0xffd060, color2: 0x502010 });
    for (let i = 0; i < Math.round(10 * scale); i++) this.particle(x, 0.2, z, { vx: (Math.random() - 0.5) * 5 * scale, vy: 1.5 + Math.random() * 3, vz: (Math.random() - 0.5) * 5 * scale, g: -9, life: 1.1, size: 0.06, color: 0x3a3a34, spin: 1 });
    for (let i = 0; i < Math.round(8 * scale); i++) this.smoke(x + (Math.random() - 0.5) * scale, 0.4, z + (Math.random() - 0.5) * scale, true, 1 + scale * 0.5);
    this.decal(x, z, 0x3a3228, 1.0 * scale + 0.3);
    this.ring(x, z, 0xffe0a0, 0.3, 1.6 * scale + 0.6, 0.45);
    this.shake = Math.max(this.shake, 0.15 * scale);
  }

  napalm(x, z, r) {
    this.explosion(x, z, 1.6, 'napalm');
    this.fires = this.fires || [];
    this.fires.push({ x, z, r, t: 6 });
    for (let k = 0; k < 6; k++) this.decal(x + (Math.random() - 0.5) * r * 1.5, z + (Math.random() - 0.5) * r * 1.5, 0x2e2822, 1.1);
  }

  decal(x, z, color = 0x5a0a0a, size = 0.5) {
    const i = this.dNext; this.dNext = (i + 1) % MAX_DECALS;
    this._q.setFromAxisAngle(this._v.set(0, 1, 0), Math.random() * 6.28);
    const s = size * (0.7 + Math.random() * 0.6);
    this._m.compose(this._v.set(x, 0.012 + (i % 7) * 0.0006, z), this._q, this._s.set(s, 1, s * (0.7 + Math.random() * 0.5)));
    this.dMesh.setMatrixAt(i, this._m);
    this.dMesh.setColorAt(i, this._c.setHex(color));
    this.dMesh.count = Math.max(this.dMesh.count, i + 1);
    this.dMesh.instanceMatrix.needsUpdate = true;
    this.dMesh.instanceColor.needsUpdate = true;
  }

  ring(x, z, color, r0, r1, dur, y = 0.05, alpha = 0.55) {
    const r = this.rings[this.rNext]; this.rNext = (this.rNext + 1) % MAX_RINGS;
    r.mesh.position.set(x, y, z);
    r.mesh.material.color.setHex(color);
    r.mesh.visible = true;
    r.t = 0; r.dur = dur; r.r0 = r0; r.r1 = r1; r.alpha = alpha;
  }

  marker(x, z, color = 0x7cff8a) { this.ring(x, z, color, 0.9, 0.25, 0.5, 0.03, 1); }

  shell(x0, z0, x1, z1, dur) {
    const m = new THREE.Mesh(this.shellGeo, this.shellMat);
    this.scene.add(m);
    this.shells.push({ m, x0, z0, x1, z1, t: 0, dur, h: 3 + Math.hypot(x1 - x0, z1 - z0) * 0.25 });
  }

  flyover(x, z, kind = 'recon') {
    const g = makePlane();
    g.scale.setScalar(kind === 'jet' ? 0.9 : 0.7);
    const a = Math.random() * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    this.scene.add(g);
    this.planes.push({ g, x0: x - dx * 40, z0: z - dz * 40, x1: x + dx * 40, z1: z + dz * 40, t: 0, dur: kind === 'jet' ? 2.2 : 4, y: kind === 'jet' ? 4 : 6 });
  }

  update(dt) {
    // Tracers
    let any = false;
    for (let i = 0; i < MAX_TRACERS; i++) {
      if (this.tLife[i] > 0) {
        this.tLife[i] -= dt;
        any = true;
        if (this.tLife[i] <= 0) { const o = i * 6; for (let k = 0; k < 6; k++) this.tPos[o + k] = 0; }
      }
    }
    if (any) { this.tracers.geometry.attributes.position.needsUpdate = true; this.tracers.geometry.attributes.color.needsUpdate = true; }

    // Lingering napalm fires
    if (this.fires) for (let k = this.fires.length - 1; k >= 0; k--) {
      const f = this.fires[k];
      f.t -= dt;
      if (Math.random() < dt * 30) this.fire(f.x + (Math.random() - 0.5) * f.r * 1.6, 0.1, f.z + (Math.random() - 0.5) * f.r * 1.6, 0.3);
      if (Math.random() < dt * 6) this.smoke(f.x + (Math.random() - 0.5) * f.r, 0.5, f.z + (Math.random() - 0.5) * f.r, true, 1.5);
      if (f.t <= 0) this.fires.splice(k, 1);
    }

    // Particles
    let n = 0;
    const m = this._m, c = this._c, mesh = this.pMesh;
    for (const p of this.parts) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy += p.g * dt;
      if (p.drag) { p.vx *= 1 - p.drag * dt; p.vz *= 1 - p.drag * dt; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.02 && p.g < 0) { p.y = 0.02; p.vx = p.vz = p.vy = 0; }
      const k = 1 - p.life / p.max;
      const s = Math.max(0.01, p.size + p.grow * k);
      m.makeScale(s, s, s);
      m.setPosition(p.x, p.y, p.z);
      mesh.setMatrixAt(n, m);
      c.setHex(p.color);
      if (p.color2 !== p.color) c.lerp(this._c2.setHex(p.color2), k);
      mesh.setColorAt(n, c);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.t += dt;
      const k = Math.min(1, r.t / r.dur);
      const s = r.r0 + (r.r1 - r.r0) * k;
      r.mesh.scale.set(s, 1, s);
      r.mesh.material.opacity = (1 - k) * r.alpha;
      if (k >= 1) r.mesh.visible = false;
    }

    for (let k = this.shells.length - 1; k >= 0; k--) {
      const s = this.shells[k];
      s.t += dt;
      const u = Math.min(1, s.t / s.dur);
      s.m.position.set(s.x0 + (s.x1 - s.x0) * u, 0.6 + Math.sin(u * Math.PI) * s.h, s.z0 + (s.z1 - s.z0) * u);
      if (Math.random() < 0.6) this.particle(s.m.position.x, s.m.position.y, s.m.position.z, { life: 0.4, size: 0.05, grow: 0.08, color: 0xbbbbbb, color2: 0x777777 });
      if (u >= 1) { this.scene.remove(s.m); this.shells.splice(k, 1); }
    }

    for (let k = this.planes.length - 1; k >= 0; k--) {
      const p = this.planes[k];
      p.t += dt;
      const u = p.t / p.dur;
      p.g.position.set(p.x0 + (p.x1 - p.x0) * u, p.y, p.z0 + (p.z1 - p.z0) * u);
      p.g.rotation.y = Math.atan2(p.x1 - p.x0, p.z1 - p.z0);
      if (u >= 1) { this.scene.remove(p.g); this.planes.splice(k, 1); }
    }

    this.shake = Math.max(0, this.shake - dt * 0.6);
  }

  // Consume sim events. `view` provides figure positions for squad shooters.
  onEvents(events, view) {
    for (const e of events) {
      switch (e.type) {
        case 'shot': {
          if (e.w === 'melee' || e.w === 'baton') { if (e.hit) this.blood(e.tx, e.tz, 2); break; }
          const from = view.muzzleFor(e) || { x: e.sx, y: e.sy, z: e.sz };
          if (e.w === 'flamer') { this.flame(from.x, from.y, from.z, e.tx, e.tz); break; }
          const tx = e.hit ? e.tx : e.tx + (Math.random() - 0.5) * 0.8, tz = e.hit ? e.tz : e.tz + (Math.random() - 0.5) * 0.8;
          this.tracer(from.x, from.y, from.z, tx, e.ty, tz, WEAPON_COLOR[e.w] || 0xffe08a, e.w === 'sniper' ? 0.12 : 0.07);
          this.flash(from.x, from.y, from.z, e.w === 'sniper' || e.w === 'gunship' ? 0.16 : 0.1);
          if (e.hit) this.blood(e.tx, e.tz, e.w === 'mg' || e.w === 'hmg' ? 1 : 2);
          else this.dust(tx, tz, 1, 0.05);
          break;
        }
        case 'death':
          if (e.kind === 'dead') {
            if (e.cause === 'fire') { for (let k = 0; k < 4; k++) this.fire(e.x, 0.3, e.z, 0.2); this.decal(e.x, e.z, 0x1a1410, 0.4); }
            else { this.headpop(e.x, e.y || 0, e.z); this.decal(e.x, e.z, Math.random() < 0.5 ? 0x4a0a0a : 0x3a2a12, 0.45); }
          } else if (e.kind === 'unit') { this.blood(e.x, e.z, 10); this.decal(e.x, e.z, 0x5a0a0a, 0.7); }
          else if (e.kind === 'refugee') { this.blood(e.x, e.z, 5); this.decal(e.x, e.z, 0x5a0a0a, 0.5); }
          else if (e.kind === 'bus') this.explosion(e.x, e.z, 0.8);
          break;
        case 'explode':
          if (e.kind === 'napalm') this.napalm(e.x, e.z, e.r);
          else this.explosion(e.x, e.z, e.kind === 'mine' || e.kind === 'mortar' ? 0.8 : 1.1, e.kind);
          break;
        case 'artillery': {
          // A mortar team's tube fires from the ground with a smaller flash and puff; a battery's gun from its barrels.
          const m = e.w === 'mortar';
          this.shell(e.x, e.z, e.tx, e.tz, view.hoursToSeconds(e.flight));
          this.flash(e.x, m ? 0.4 : 0.9, e.z, m ? 0.2 : 0.35, 0xffe0a0);
          this.smoke(e.x, m ? 0.4 : 0.8, e.z, false, m ? 0.9 : 1.5);
          this.shake = Math.max(this.shake, m ? 0.02 : 0.05);
          break;
        }
        case 'destroyed': this.explosion(e.x, e.z, e.size > 1 ? 1.4 : 0.7); break;
        case 'scream': this.ring(e.x, e.z, 0xff3020, 0.3, e.r, 1.1, 0.4, 0.7); break;
        case 'siren': this.ring(e.x, e.z, 0xffd040, 0.5, e.r, 2.2, 0.3, 0.45); break;
        case 'noise': this.ring(e.x, e.z, 0xffffff, 0.3, Math.min(e.r, 12), 0.8, 0.2, 0.2); break;
        case 'climb': this.dust(e.fromX, e.fromZ, 4, 1); break;
        case 'claw': if (Math.random() < 0.5) this.dust(e.x, e.z, 1, 0.5); else this.sparks(e.x, 0.5, e.z, 2); break;
        case 'bite': this.blood(e.x, e.z, 2); break;
        case 'turn': this.blood(e.x, e.z, 4); break;
        case 'recon': this.flyover(e.x, e.z, 'recon'); this.ring(e.x, e.z, 0x80c8ff, 1, 12, 2.5, 0.1); break;
        case 'strikeCalled': this.ring(e.x, e.z, 0xff4020, 3.2, 3, 3, 0.06, 0.9); break;
        case 'sterilise': for (let k = 0; k < 6; k++) this.napalm(e.x + (Math.random() - 0.5) * e.r * 1.6, e.z + (Math.random() - 0.5) * e.r * 1.6, 2); this.flyover(e.x, e.z, 'jet'); break;
        case 'rejected': this.ring(e.x, e.z, 0xff5050, 0.2, 0.8, 0.6, 0.05); break;
        case 'placed': this.dust(view.buildingPos(e.id)?.x ?? 0, view.buildingPos(e.id)?.z ?? 0, 6, 0.1); break;
        default: break;
      }
    }
  }
}
