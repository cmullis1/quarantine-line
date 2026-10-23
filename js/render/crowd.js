// Instanced humanoids. Soldiers, police, hazmat crews, engineers, snipers, civilians, refugees and every
// type of the dead share one InstancedMesh per body part (~12 draw calls for everyone on screen).
//
// A figure: { x, y, z, rot, phase, moving, kind, skin, shirt, pants, helmet, helmetColor, gun, gunLen,
//   pack, packColor, band, shield, aim, dying, rising, climb, scale, bulk, scream, hidden, recolor,
//   prop, deployed, kneel, cross }
// Props a few squads carry get one small instanced mesh each, drawn only for the figures that have them: `prop`
// 'tripod' (a machine gun on its tripod) or 'tube' (a mortar on its baseplate) on the ground in front of a
// `deployed` figure, and a medic's red `cross` on the helmet and the bag. A `kneel`ing figure drops to one knee.
// Each frame only figures in (or casting a shadow into) the camera's view are drawn, a figure keeps its slot while it
// is, and only slots whose pose changed are rewritten and sent to the GPU. Colours are written only when a figure
// takes a slot: code that changes a live figure's look must set `recolor` or the change will not show.
import * as THREE from 'three';
import { sincos, SC } from './trig.js';

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

// Part indices into PARTS.
const LEG_L = 0, LEG_R = 1, TORSO = 2, HEAD = 3, ARM_L = 4, ARM_R = 5, HELMET = 6, GUN = 7, PACK = 8, BAND = 9, EYES = 10, SHIELD = 11;
// The numbers a slot was last posed from. A figure whose numbers all match is not rewritten; one where only the
// nod differs (the dead idling) rewrites just its head, helmet and eyes.
const KEY = 16;
const GUN_C = Math.cos(0.1), GUN_S = Math.sin(0.1);

// Scratch affine matrices, 12 numbers each: the three columns of the 3×3, then the translation (Matrix4's elements
// without the fixed bottom row). The products are Matrix4.multiply's term for term, so poses come out as before.
const W = new Float64Array(72);
const B = 0, T = 12, H = 24, AL = 36, AR = 48, O = 60;

// W[d] = W[p] × (a turn about x by the angle sincos last took, moved to (jx, jy, jz)). d may be p.
function rx(d, p, jx, jy, jz) {
  const s = SC[0], c = SC[1];
  const a0 = W[p], a1 = W[p + 1], a2 = W[p + 2], a4 = W[p + 3], a5 = W[p + 4], a6 = W[p + 5];
  const a8 = W[p + 6], a9 = W[p + 7], a10 = W[p + 8], a12 = W[p + 9], a13 = W[p + 10], a14 = W[p + 11];
  W[d] = a0; W[d + 1] = a1; W[d + 2] = a2;
  W[d + 3] = a4 * c + a8 * s; W[d + 4] = a5 * c + a9 * s; W[d + 5] = a6 * c + a10 * s;
  W[d + 6] = a8 * c - a4 * s; W[d + 7] = a9 * c - a5 * s; W[d + 8] = a10 * c - a6 * s;
  W[d + 9] = a0 * jx + a4 * jy + a8 * jz + a12;
  W[d + 10] = a1 * jx + a5 * jy + a9 * jz + a13;
  W[d + 11] = a2 * jx + a6 * jy + a10 * jz + a14;
}

// rx, and a move with no turn, written straight into instance i of a matrix array: for parts nothing hangs from.
function rxPut(a, i, p, jx, jy, jz) {
  const s = SC[0], c = SC[1], o = i * 16;
  const a0 = W[p], a1 = W[p + 1], a2 = W[p + 2], a4 = W[p + 3], a5 = W[p + 4], a6 = W[p + 5];
  const a8 = W[p + 6], a9 = W[p + 7], a10 = W[p + 8];
  a[o] = a0; a[o + 1] = a1; a[o + 2] = a2; a[o + 3] = 0;
  a[o + 4] = a4 * c + a8 * s; a[o + 5] = a5 * c + a9 * s; a[o + 6] = a6 * c + a10 * s; a[o + 7] = 0;
  a[o + 8] = a8 * c - a4 * s; a[o + 9] = a9 * c - a5 * s; a[o + 10] = a10 * c - a6 * s; a[o + 11] = 0;
  a[o + 12] = a0 * jx + a4 * jy + a8 * jz + W[p + 9];
  a[o + 13] = a1 * jx + a5 * jy + a9 * jz + W[p + 10];
  a[o + 14] = a2 * jx + a6 * jy + a10 * jz + W[p + 11];
  a[o + 15] = 1;
}

function trPut(a, i, p, jx, jy, jz) {
  const o = i * 16;
  const a0 = W[p], a1 = W[p + 1], a2 = W[p + 2], a4 = W[p + 3], a5 = W[p + 4], a6 = W[p + 5];
  const a8 = W[p + 6], a9 = W[p + 7], a10 = W[p + 8];
  a[o] = a0; a[o + 1] = a1; a[o + 2] = a2; a[o + 3] = 0;
  a[o + 4] = a4; a[o + 5] = a5; a[o + 6] = a6; a[o + 7] = 0;
  a[o + 8] = a8; a[o + 9] = a9; a[o + 10] = a10; a[o + 11] = 0;
  a[o + 12] = a0 * jx + a4 * jy + a8 * jz + W[p + 9];
  a[o + 13] = a1 * jx + a5 * jy + a9 * jz + W[p + 10];
  a[o + 14] = a2 * jx + a6 * jy + a10 * jz + W[p + 11];
  a[o + 15] = 1;
}

// W[d] × a scale of (sx, sy, sz).
function scale(d, sx, sy, sz) {
  W[d] *= sx; W[d + 1] *= sx; W[d + 2] *= sx;
  W[d + 3] *= sy; W[d + 4] *= sy; W[d + 5] *= sy;
  W[d + 6] *= sz; W[d + 7] *= sz; W[d + 8] *= sz;
}

// W[d] into instance i of a matrix array.
function put(a, i, d) {
  const o = i * 16;
  a[o] = W[d]; a[o + 1] = W[d + 1]; a[o + 2] = W[d + 2]; a[o + 3] = 0;
  a[o + 4] = W[d + 3]; a[o + 5] = W[d + 4]; a[o + 6] = W[d + 5]; a[o + 7] = 0;
  a[o + 8] = W[d + 6]; a[o + 9] = W[d + 7]; a[o + 10] = W[d + 8]; a[o + 11] = 0;
  a[o + 12] = W[d + 9]; a[o + 13] = W[d + 10]; a[o + 14] = W[d + 11]; a[o + 15] = 1;
}

// A part the figure does not have: scaled to nothing.
function zero(a, i) {
  const o = i * 16;
  a.fill(0, o, o + 15);
  a[o + 15] = 1;
}

function toM4(m, d) {
  const e = m.elements;
  e[0] = W[d]; e[1] = W[d + 1]; e[2] = W[d + 2]; e[3] = 0;
  e[4] = W[d + 3]; e[5] = W[d + 4]; e[6] = W[d + 5]; e[7] = 0;
  e[8] = W[d + 6]; e[9] = W[d + 7]; e[10] = W[d + 8]; e[11] = 0;
  e[12] = W[d + 9]; e[13] = W[d + 10]; e[14] = W[d + 11]; e[15] = 1;
  return m;
}

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
    this.parts = PARTS.map((p) => this.meshes[p]);
    this.mats = this.parts.map((m) => m.instanceMatrix.array);
    this.cols = this.parts.map((m) => m.instanceColor?.array || null);
    // Each figure drawn keeps its slot (`f._cs`) from frame to frame; slots 0..n-1 are in use, with no gaps.
    this.n = 0;
    this.slotFig = new Array(capacity).fill(null);
    this.seen = new Uint32Array(capacity); // the frame a slot's figure was last met in
    this.fresh = new Uint8Array(capacity); // 1: a figure new to its slot; 2: moved in with its colours
    this.frame = 0;
    this.key = new Float64Array(capacity * KEY);
    this.nod = new Float64Array(capacity);
    this.torso = new Float64Array(capacity * 12);
    this.incoming = [];
    this.planes = new Float64Array(24);
    this._frustum = new THREE.Frustum();
    this._pv = new THREE.Matrix4();
    this._tmp = new THREE.Matrix4();
    this._out = new THREE.Matrix4();
    this._head = new THREE.Matrix4();
    this._torso = new THREE.Matrix4();
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

  _tint(p, s, hex) {
    const c = this._c.setHex(hex), a = this.cols[p], o = s * 3;
    a[o] = c.r; a[o + 1] = c.g; a[o + 2] = c.b;
  }

  _colors(s, f) {
    const bare = DEAD_KINDS.has(f.kind) || f.kind === 'civ';
    this._tint(LEG_L, s, f.pants); this._tint(LEG_R, s, f.pants);
    this._tint(TORSO, s, f.shirt);
    this._tint(HEAD, s, f.skin);
    this._tint(ARM_L, s, bare ? f.skin : f.shirt);
    this._tint(ARM_R, s, bare ? f.skin : f.shirt);
    this._tint(HELMET, s, f.helmetColor || 0x3f4d2a);
    this._tint(GUN, s, f.gunColor || 0x1c1c1c);
    this._tint(PACK, s, f.packColor || 0x6a5a3a);
    this._tint(BAND, s, f.bandColor || 0xf2c335);
    this._tint(SHIELD, s, 0x9ab0c8);
    if (s < this.clo) this.clo = s;
    if (s > this.chi) this.chi = s;
  }

  // `camera`: figures outside its view, with a margin for the shadows they cast into it, are not drawn.
  render(lists, time, camera = null) {
    const frame = ++this.frame, seen = this.seen, slotFig = this.slotFig, fresh = this.fresh, incoming = this.incoming;
    const cap = this.capacity, P = this.planes;
    this.lo = this.hlo = this.clo = Infinity;
    this.hi = this.hhi = this.chi = -1;
    if (camera) {
      const planes = this._frustum.setFromProjectionMatrix(this._pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)).planes;
      for (let k = 0; k < 6; k++) { const pl = planes[k]; P[k * 4] = pl.normal.x; P[k * 4 + 1] = pl.normal.y; P[k * 4 + 2] = pl.normal.z; P[k * 4 + 3] = pl.constant; }
    }
    // Who is drawn this frame: figures with a slot keep it; the rest wait for one.
    incoming.length = 0;
    let total = 0;
    outer: for (let l = 0; l < lists.length; l++) {
      const list = lists[l];
      for (let k = 0; k < list.length; k++) {
        const f = list[k];
        if (f.hidden) continue;
        if (camera) {
          // A sphere around the figure, wider the higher it stands (its shadow falls further out).
          const x = f.x, z = f.z, y = f.y > 0 ? f.y : 0, cy = y + 0.4, r = 2 + 2 * y;
          if (P[0] * x + P[1] * cy + P[2] * z + P[3] < -r || P[4] * x + P[5] * cy + P[6] * z + P[7] < -r
            || P[8] * x + P[9] * cy + P[10] * z + P[11] < -r || P[12] * x + P[13] * cy + P[14] * z + P[15] < -r
            || P[16] * x + P[17] * cy + P[18] * z + P[19] < -r || P[20] * x + P[21] * cy + P[22] * z + P[23] < -r) continue;
        }
        if (total >= cap) break outer;
        total++;
        const s = f._cs;
        if (s !== undefined && slotFig[s] === f && seen[s] !== frame) seen[s] = frame;
        else incoming.push(f);
      }
    }
    // Slots of figures gone from view are filled by newcomers, then by the last slots, so 0..n-1 stay full.
    let end = this.n, s = 0, inc = 0;
    for (;;) {
      while (s < end && seen[s] === frame) s++;
      if (s >= end) break;
      if (inc < incoming.length) { this._place(incoming[inc++], s, frame); s++; continue; }
      while (end > s && seen[end - 1] !== frame) slotFig[--end] = null;
      if (end <= s) break;
      const f = slotFig[--end];
      slotFig[end] = null;
      for (const a of this.cols) if (a) a.copyWithin(s * 3, end * 3, end * 3 + 3);
      if (s < this.clo) this.clo = s;
      if (s > this.chi) this.chi = s;
      slotFig[s] = f; f._cs = s; seen[s] = frame; fresh[s] = 2;
      s++;
    }
    while (inc < incoming.length) this._place(incoming[inc++], end++, frame);
    this.n = end;
    incoming.length = 0;

    for (const p in this.props) this.props[p].count = 0;
    for (let i = 0; i < end; i++) { this._pose(slotFig[i], i, time, fresh[i]); fresh[i] = 0; }

    const lo = this.lo, hi = this.hi;
    for (let p = 0; p < PARTS.length; p++) {
      const m = this.parts[p];
      m.count = end;
      let a = lo, b = hi;
      if (p === HEAD || p === HELMET || p === EYES) { if (this.hlo < a) a = this.hlo; if (this.hhi > b) b = this.hhi; }
      // Only the slots written this frame go to the GPU.
      if (b >= a) { m.instanceMatrix.addUpdateRange(a * 16, (b - a + 1) * 16); m.instanceMatrix.needsUpdate = true; }
      if (m.instanceColor && this.chi >= this.clo) { m.instanceColor.addUpdateRange(this.clo * 3, (this.chi - this.clo + 1) * 3); m.instanceColor.needsUpdate = true; }
    }
    // No draw call (or shadow pass) for a prop nobody carries.
    for (const p in this.props) {
      const m = this.props[p];
      m.visible = m.count > 0;
      if (m.visible) m.instanceMatrix.needsUpdate = true;
    }
    return end;
  }

  _place(f, s, frame) {
    this.slotFig[s] = f; f._cs = s; this.seen[s] = frame; this.fresh[s] = 1;
  }

  // Poses figure f in slot s. `fr`: the slot is new to it (1) or it moved in (2), so everything is written.
  _pose(f, s, time, fr) {
    if (fr === 1 || f.recolor) { this._colors(s, f); f.recolor = false; }
    const kind = f.kind, dead = DEAD_KINDS.has(kind), runner = kind === 'runner';
    const ph = f.phase || 0, moving = f.moving, dying = f.dying > 0;
    sincos(ph);
    const sinPh = SC[0], cosPh = SC[1];
    const walk = moving ? sinPh : 0;
    let fall = 0, sink = 0;
    if (dying) { fall = Math.min(1, f.dying * 2.2) * (Math.PI / 2) * (f.fallDir || 1); sink = Math.max(0, f.dying - 12) * 0.02; }
    const sc = f.scale || 1;
    const kneel = f.kneel && !dying;
    const fx = f.x, fz = f.z, rot = f.rot;
    const rise = f.rising > 0 ? -f.rising * Math.PI / 2 : 0;
    const bob = moving ? Math.abs(cosPh) * 0.025 * sc : 0;
    const y = (f.y || 0) + bob - sink - (kneel ? KNEEL_DROP : 0);
    // A deployed prop stands on the ground in front of its crewman; it goes when he falls.
    if (f.prop && f.deployed && !dying) {
      this._ground.makeRotationY(rot).setPosition(fx, f.y || 0, fz);
      if (f.prop === 'tripod') this._prop('tripod', this._ground, 0, 0, 0.2);
      else this._prop('tube', this._ground, 0.06, 0, 0.16);
    }

    const legAmp = runner ? 0.95 : dead ? 0.45 : 0.7;
    // Kneeling: the left thigh forward, the right leg down to a knee on the ground (its shin sinks out of sight).
    const legL = kneel ? -1.2 : walk * legAmp + (f.limp ? 0.25 : 0);
    const legR = kneel ? 0.5 : -walk * legAmp;
    const climb = f.climb, scream = f.scream > 0;
    let lean = 0;
    if (dead) {
      if (runner) lean = 0.55;
      else if (kind === 'brute') lean = 0.35;
      else { sincos(ph * 0.5); lean = 0.28 + SC[0] * 0.06; }
    } else if (f.aim) lean = 0.08;
    if (climb) lean = -0.15;
    const bulk = f.bulk || 1;
    let nod = 0;
    if (dead) { sincos(time * 2 + fx * 3); nod = SC[0] * 0.25 - 0.1; }
    if (scream) nod = -0.9;
    let aL, aR;
    if (climb) { sincos(ph * 2); aL = -2.8 + SC[0] * 0.3; aR = -2.8 + SC[1] * 0.3; }
    else if (scream) { aL = -2.2; aR = -2.2; }
    else if (runner) { aL = 0.9 + walk * 0.6; aR = 0.9 - walk * 0.6; }
    else if (kind === 'brute') { aL = -0.3 + walk * 0.3; aR = -0.3 - walk * 0.3; }
    else if (dead) { sincos(ph + 1); aL = -1.35 + SC[0] * 0.15; aR = -1.45 + sinPh * 0.15; }
    else if (f.aim) { aL = -1.25; aR = -1.4; }
    else { aL = -walk * 0.6; aR = walk * 0.6; }
    const spread = scream ? 0.04 : 0;
    const bx = 0.135 * bulk;
    const flags = (f.helmet ? 1 : 0) | (f.gun ? 2 : 0) | (f.pack ? 4 : 0) | (f.band ? 8 : 0) | (dead ? 16 : 0) | (f.shield ? 32 : 0);
    const gunLen = f.gunLen || 1;
    // A medic's crosses are drawn from his head and torso each frame, so he is always posed in full.
    const cross = f.cross && !dying;
    const K = this.key, k = s * KEY, M = this.mats;

    if (!fr && !cross && K[k] === fx && K[k + 1] === y && K[k + 2] === fz && K[k + 3] === rot && K[k + 4] === fall
      && K[k + 5] === rise && K[k + 6] === sc && K[k + 7] === legL && K[k + 8] === legR && K[k + 9] === lean
      && K[k + 10] === bulk && K[k + 11] === aL && K[k + 12] === aR && K[k + 13] === bx + spread && K[k + 14] === flags
      && K[k + 15] === gunLen) {
      if (this.nod[s] === nod) return;
      // Only the head moved: hang it, its helmet and its eyes from the torso the slot was last posed with.
      this.nod[s] = nod;
      const tc = this.torso, t0 = s * 12;
      for (let q = 0; q < 12; q++) W[T + q] = tc[t0 + q];
      sincos(nod); rx(H, T, 0, 0.235, 0); put(M[HEAD], s, H);
      if (flags & 1) trPut(M[HELMET], s, H, 0, 0.11, 0);
      if (dead) put(M[EYES], s, H);
      if (s < this.hlo) this.hlo = s;
      if (s > this.hhi) this.hhi = s;
      return;
    }
    K[k] = fx; K[k + 1] = y; K[k + 2] = fz; K[k + 3] = rot; K[k + 4] = fall; K[k + 5] = rise; K[k + 6] = sc; K[k + 7] = legL;
    K[k + 8] = legR; K[k + 9] = lean; K[k + 10] = bulk; K[k + 11] = aL; K[k + 12] = aR; K[k + 13] = bx + spread;
    K[k + 14] = flags; K[k + 15] = gunLen;
    this.nod[s] = nod;

    sincos(rot);
    W[0] = SC[1]; W[1] = 0; W[2] = -SC[0]; W[3] = 0; W[4] = 1; W[5] = 0; W[6] = SC[0]; W[7] = 0; W[8] = SC[1]; W[9] = 0; W[10] = 0; W[11] = 0;
    if (fall) { sincos(fall); rx(B, B, 0, 0, 0); }
    if (rise) { sincos(rise); rx(B, B, 0, 0, 0); }
    if (sc !== 1) scale(B, sc, sc, sc);
    W[9] = fx; W[10] = y; W[11] = fz;

    sincos(legL); rxPut(M[LEG_L], s, B, -0.048, 0.24, 0);
    sincos(legR); rxPut(M[LEG_R], s, B, 0.048, 0.24, 0);
    sincos(lean); rx(T, B, 0, 0.24, 0);
    if (bulk !== 1) scale(T, bulk, 1, bulk);
    put(M[TORSO], s, T);
    const tc = this.torso, t0 = s * 12;
    for (let q = 0; q < 12; q++) tc[t0 + q] = W[T + q];
    sincos(nod); rx(H, T, 0, 0.235, 0); put(M[HEAD], s, H);
    sincos(aL); rx(AL, T, -bx - spread, 0.2, 0); put(M[ARM_L], s, AL);
    sincos(aR); rx(AR, T, bx + spread, 0.2, 0); put(M[ARM_R], s, AR);

    if (flags & 1) trPut(M[HELMET], s, H, 0, 0.11, 0); else zero(M[HELMET], s);
    if (cross) {
      if (f.helmet) this._prop('cross', toM4(this._head, H), 0, 0.177, 0);
      if (f.pack) this._prop('cross', toM4(this._torso, T), 0, 0.125, -0.146, this._back);
    }
    if (flags & 2) { SC[0] = GUN_S; SC[1] = GUN_C; rx(O, AR, 0, -0.1, 0.05); scale(O, 1, gunLen, 1); put(M[GUN], s, O); } else zero(M[GUN], s);
    if (flags & 4) trPut(M[PACK], s, T, 0, 0.04, -0.1); else zero(M[PACK], s);
    if (flags & 8) trPut(M[BAND], s, AL, 0, -0.02, 0); else zero(M[BAND], s);
    if (dead) put(M[EYES], s, H); else zero(M[EYES], s);
    if (flags & 32) trPut(M[SHIELD], s, AL, -0.04, 0, 0.06); else zero(M[SHIELD], s);
    if (s < this.lo) this.lo = s;
    if (s > this.hi) this.hi = s;
  }
}
