// Instanced humanoids. Soldiers, police, hazmat crews, engineers, snipers, civilians, refugees and every
// type of the dead share one InstancedMesh per body part (~12 draw calls for everyone on screen).
//
// A figure: { x, y, z, rot, phase, moving, kind, skin, shirt, pants, helmet, helmetColor, gun, gunLen,
//   pack, packColor, band, shield, aim, dying, rising, climb, scale, bulk, scream, hidden, recolor,
//   prop, deployed, kneel, cross }
// Props a few squads carry get one small instanced mesh each, drawn only for the figures that have them: `prop`
// 'tripod' (a machine gun on its tripod) or 'tube' (a mortar on its baseplate) on the ground in front of a
// `deployed` figure, and a medic's red `cross` on the helmet and the bag. A `kneel`ing figure drops to one knee.
import * as THREE from 'three';

const PARTS = ['legL', 'legR', 'torso', 'head', 'armL', 'armR', 'helmet', 'gun', 'pack', 'band', 'eyes', 'shield'];
const DEAD_KINDS = new Set(['walker', 'runner', 'brute', 'howler', 'drowned']);
const PROP_CAP = 160;
const KNEEL_DROP = 0.11;

function geo(w, h, d, ty, tz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, ty, tz);
  return g;
}

// One geometry of coloured boxes, each [w, h, d, x, y, z, color, rx = 0, rz = 0]: centred at (x, y, z), turned rx
// about x then rz about z. The colours ride on the vertices, so one draw call paints the whole prop.
function painted(boxes) {
  const pos = [], nor = [], col = [], c = new THREE.Color(), m = new THREE.Matrix4(), e = new THREE.Euler();
  for (const [w, h, d, x, y, z, color, rx = 0, rz = 0] of boxes) {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.applyMatrix4(m.makeRotationFromEuler(e.set(rx, 0, rz)).setPosition(x, y, z));
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    c.setHex(color);
    for (let k = 0; k < g.attributes.position.count; k++) col.push(c.r, c.g, c.b);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

const PROP_GEOS = {
  // Origin on the ground under the gun; it points +z. Three splayed legs, the gun and its barrel, an ammo box.
  tripod: () => painted([
    [0.022, 0.22, 0.022, 0, 0.095, 0.07, 0x2a2d28, -0.55],
    [0.022, 0.22, 0.022, -0.06, 0.095, -0.05, 0x2a2d28, 0.5, 0.45],
    [0.022, 0.22, 0.022, 0.06, 0.095, -0.05, 0x2a2d28, 0.5, -0.45],
    [0.065, 0.065, 0.22, 0, 0.205, 0.01, 0x1c1c1c],
    [0.03, 0.03, 0.26, 0, 0.215, 0.24, 0x2c2c2c],
    [0.02, 0.05, 0.02, 0, 0.255, -0.06, 0x1c1c1c],
    [0.08, 0.065, 0.1, 0.1, 0.0325, -0.02, 0x4a5a32],
  ]),
  // Origin at the baseplate's centre; the tube leans toward +z on its bipod, a crate of bombs beside it.
  tube: () => painted([
    [0.17, 0.025, 0.17, 0, 0.0125, 0, 0x3a3a34],
    [0.055, 0.34, 0.055, 0, 0.16, 0.096, 0x3d4828, 0.6],
    [0.07, 0.035, 0.07, 0, 0.3, 0.19, 0x262a20, 0.6],
    [0.018, 0.2, 0.018, -0.05, 0.09, 0.17, 0x2a2d28, -0.3, -0.25],
    [0.018, 0.2, 0.018, 0.05, 0.09, 0.17, 0x2a2d28, -0.3, 0.25],
    [0.09, 0.055, 0.11, -0.12, 0.0275, -0.04, 0x6a5a3a],
  ]),
  // Flat, centred on the origin.
  cross: () => painted([[0.09, 0.012, 0.028, 0, 0, 0, 0xd0201c], [0.028, 0.012, 0.09, 0, 0, 0, 0xd0201c]]),
};

export class Crowd {
  constructor(scene, capacity) {
    this.capacity = capacity;
    const eyes = new THREE.BufferGeometry();
    {
      const a = new THREE.BoxGeometry(0.03, 0.025, 0.02); a.translate(-0.028, 0.07, 0.062);
      const b = new THREE.BoxGeometry(0.03, 0.025, 0.02); b.translate(0.028, 0.07, 0.062);
      const pa = a.attributes.position.array, pb = b.attributes.position.array;
      const na = a.attributes.normal.array, nb = b.attributes.normal.array;
      const ia = a.index.array, ib = b.index.array;
      const pos = new Float32Array(pa.length + pb.length); pos.set(pa); pos.set(pb, pa.length);
      const nor = new Float32Array(na.length + nb.length); nor.set(na); nor.set(nb, na.length);
      const idx = new Uint16Array(ia.length + ib.length); idx.set(ia); for (let k = 0; k < ib.length; k++) idx[ia.length + k] = ib[k] + pa.length / 3;
      eyes.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      eyes.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      eyes.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    const geos = {
      legL: geo(0.075, 0.24, 0.085, -0.12),
      legR: geo(0.075, 0.24, 0.085, -0.12),
      torso: geo(0.2, 0.23, 0.12, 0.115),
      head: geo(0.12, 0.12, 0.12, 0.06),
      armL: geo(0.06, 0.21, 0.065, -0.1),
      armR: geo(0.06, 0.21, 0.065, -0.1),
      helmet: geo(0.15, 0.06, 0.15, 0.03),
      gun: geo(0.035, 0.28, 0.045, -0.14),
      pack: geo(0.16, 0.17, 0.08, 0.085),
      band: geo(0.07, 0.05, 0.075, -0.06),
      eyes,
      shield: geo(0.03, 0.26, 0.16, -0.13, 0.04),
    };
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xff6a20 });
    this.meshes = {};
    const white = new THREE.Color(0xffffff);
    for (const p of PARTS) {
      const material = p === 'eyes' ? this.eyeMat : new THREE.MeshLambertMaterial({ color: 0xffffff });
      const m = new THREE.InstancedMesh(geos[p], material, capacity);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (p !== 'eyes') for (let i = 0; i < capacity; i++) m.setColorAt(i, white);
      m.count = 0;
      m.castShadow = p !== 'eyes' && p !== 'band';
      m.frustumCulled = false;
      scene.add(m);
      this.meshes[p] = m;
    }
    this.slotFig = new Array(capacity).fill(null);
    this._base = new THREE.Matrix4();
    this._torso = new THREE.Matrix4();
    this._head = new THREE.Matrix4();
    this._armR = new THREE.Matrix4();
    this._armL = new THREE.Matrix4();
    this._tmp = new THREE.Matrix4();
    this._s = new THREE.Matrix4();
    this._out = new THREE.Matrix4();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this._rx = new THREE.Matrix4();
    this._c = new THREE.Color();
    this._ground = new THREE.Matrix4();
    this._back = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    this.props = {};
    const propMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (const [p, make] of Object.entries(PROP_GEOS)) {
      const m = new THREE.InstancedMesh(make(), propMat, PROP_CAP);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.castShadow = p !== 'cross';
      m.frustumCulled = false;
      scene.add(m);
      this.props[p] = m;
    }
  }

  // One more of a prop, at `parent` moved by (x, y, z) and then turned by `turn` (a matrix) if given.
  _prop(p, parent, x, y, z, turn = null) {
    const m = this.props[p];
    if (m.count >= PROP_CAP) return;
    this._out.multiplyMatrices(parent, this._tmp.makeTranslation(x, y, z));
    if (turn) this._out.multiply(turn);
    m.setMatrixAt(m.count++, this._out);
  }

  setNight(f) {
    // Eyes glow brighter as it gets darker.
    this.eyeMat.color.setRGB(0.55 + 0.45 * f, 0.18 + 0.2 * f, 0.05);
  }

  _set(part, i, parent, jx, jy, jz, ax, sx = 1) {
    const t = this._tmp.makeRotationX(ax);
    t.setPosition(jx, jy, jz);
    this._out.multiplyMatrices(parent, t);
    if (sx !== 1) this._out.multiply(this._s.makeScale(sx, 1, sx));
    this.meshes[part].setMatrixAt(i, this._out);
    return this._out;
  }

  _colors(i, f) {
    const c = this._c, M = this.meshes;
    const set = (p, hex) => M[p].setColorAt(i, c.setHex(hex));
    const bare = DEAD_KINDS.has(f.kind) || f.kind === 'civ';
    set('legL', f.pants); set('legR', f.pants);
    set('torso', f.shirt);
    set('head', f.skin);
    set('armL', bare ? f.skin : f.shirt);
    set('armR', bare ? f.skin : f.shirt);
    set('helmet', f.helmetColor || 0x3f4d2a);
    set('gun', f.gunColor || 0x1c1c1c);
    set('pack', f.packColor || 0x6a5a3a);
    set('band', f.bandColor || 0xf2c335);
    set('shield', 0x9ab0c8);
  }

  render(lists, time) {
    const M = this.meshes;
    for (const p in this.props) this.props[p].count = 0;
    let i = 0;
    const base = this._base, rx = this._rx;
    for (const list of lists) {
      for (const f of list) {
        if (f.hidden) continue;
        if (i >= this.capacity) break;
        if (this.slotFig[i] !== f || f.recolor) { this._colors(i, f); this.slotFig[i] = f; f.recolor = false; }
        const dead = DEAD_KINDS.has(f.kind);
        const ph = f.phase || 0;
        const walk = f.moving ? Math.sin(ph) : 0;
        let fall = 0, sink = 0;
        if (f.dying > 0) { fall = Math.min(1, f.dying * 2.2) * (Math.PI / 2) * (f.fallDir || 1); sink = Math.max(0, f.dying - 12) * 0.02; }
        const sc = f.scale || 1;
        const kneel = f.kneel && !(f.dying > 0);
        base.makeRotationY(f.rot);
        if (fall) base.multiply(rx.makeRotationX(fall));
        if (f.rising > 0) base.multiply(rx.makeRotationX(-f.rising * Math.PI / 2));
        if (sc !== 1) base.multiply(this._s.makeScale(sc, sc, sc));
        const bob = f.moving ? Math.abs(Math.cos(ph)) * 0.025 * sc : 0;
        base.setPosition(f.x, (f.y || 0) + bob - sink - (kneel ? KNEEL_DROP : 0), f.z);
        // A deployed prop stands on the ground in front of its crewman; it goes when he falls.
        if (f.prop && f.deployed && !(f.dying > 0)) {
          this._ground.makeRotationY(f.rot).setPosition(f.x, f.y || 0, f.z);
          if (f.prop === 'tripod') this._prop('tripod', this._ground, 0, 0, 0.2);
          else this._prop('tube', this._ground, 0.06, 0, 0.16);
        }

        const runner = f.kind === 'runner';
        const legAmp = runner ? 0.95 : dead ? 0.45 : 0.7;
        // Kneeling: the left thigh forward, the right leg down to a knee on the ground (its shin sinks out of sight).
        this._set('legL', i, base, -0.048, 0.24, 0, kneel ? -1.2 : walk * legAmp + (f.limp ? 0.25 : 0));
        this._set('legR', i, base, 0.048, 0.24, 0, kneel ? 0.5 : -walk * legAmp);
        let lean = 0;
        if (dead) lean = runner ? 0.55 : f.kind === 'brute' ? 0.35 : 0.28 + Math.sin(ph * 0.5) * 0.06;
        else if (f.aim) lean = 0.08;
        if (f.climb) lean = -0.15;
        this._torso.copy(this._set('torso', i, base, 0, 0.24, 0, lean, f.bulk || 1));
        let nod = dead ? Math.sin(time * 2 + f.x * 3) * 0.25 - 0.1 : 0;
        if (f.scream > 0) nod = -0.9;
        this._head.copy(this._set('head', i, this._torso, 0, 0.235, 0, nod));

        let aL, aR;
        if (f.climb) { aL = -2.8 + Math.sin(ph * 2) * 0.3; aR = -2.8 + Math.cos(ph * 2) * 0.3; }
        else if (f.scream > 0) { aL = -2.2; aR = -2.2; }
        else if (runner) { aL = 0.9 + walk * 0.6; aR = 0.9 - walk * 0.6; }
        else if (f.kind === 'brute') { aL = -0.3 + walk * 0.3; aR = -0.3 - walk * 0.3; }
        else if (dead) { aL = -1.35 + Math.sin(ph + 1) * 0.15; aR = -1.45 + Math.sin(ph) * 0.15; }
        else if (f.aim) { aL = -1.25; aR = -1.4; }
        else { aL = -walk * 0.6; aR = walk * 0.6; }
        const spread = f.scream > 0 ? 0.04 : 0;
        const bx = 0.135 * (f.bulk || 1);
        this._armL.copy(this._set('armL', i, this._torso, -bx - spread, 0.2, 0, aL));
        this._armR.copy(this._set('armR', i, this._torso, bx + spread, 0.2, 0, aR));

        if (f.helmet) this._set('helmet', i, this._head, 0, 0.11, 0, 0);
        else M.helmet.setMatrixAt(i, this._zero);
        if (f.cross && !(f.dying > 0)) {
          if (f.helmet) this._prop('cross', this._head, 0, 0.177, 0);
          if (f.pack) this._prop('cross', this._torso, 0, 0.125, -0.146, this._back);
        }
        if (f.gun) {
          const t = this._tmp.makeRotationX(0.1);
          t.setPosition(0, -0.1, 0.05);
          this._out.multiplyMatrices(this._armR, t);
          this._out.multiply(this._s.makeScale(1, f.gunLen || 1, 1));
          M.gun.setMatrixAt(i, this._out);
        } else M.gun.setMatrixAt(i, this._zero);
        if (f.pack) this._set('pack', i, this._torso, 0, 0.04, -0.1, 0);
        else M.pack.setMatrixAt(i, this._zero);
        if (f.band) this._set('band', i, this._armL, 0, -0.02, 0, 0);
        else M.band.setMatrixAt(i, this._zero);
        if (dead) this._set('eyes', i, this._head, 0, 0, 0, 0);
        else M.eyes.setMatrixAt(i, this._zero);
        if (f.shield) this._set('shield', i, this._armL, -0.04, 0, 0.06, 0);
        else M.shield.setMatrixAt(i, this._zero);
        i++;
      }
    }
    for (const p of PARTS) {
      const m = M[p];
      m.count = i;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    // No draw call (or shadow pass) for a prop nobody carries.
    for (const p in this.props) {
      const m = this.props[p];
      m.visible = m.count > 0;
      if (m.visible) m.instanceMatrix.needsUpdate = true;
    }
    return i;
  }
}
