// Low-poly assets assembled from primitives. Every model faces +Z, sits on y = 0, and is centred on
// its footprint (1×1 spans ±0.5, 2×2 spans ±1). Animated parts are exposed on `userData`.
import * as THREE from 'three';

export const PALETTE = {
  blue: 0x2b4c9b, gold: 0xf2c335, olive: 0x56653a, olive2: 0x45522d, concrete: 0xa9a8a0, concrete2: 0x8e8d85,
  dark: 0x2a2d30, steel: 0x7d848c, brick: 0x9a4a3a, roofRed: 0xa8432f, roofBrown: 0x7a3a28, roofSlate: 0x5a5a62,
  white: 0xece8de, glass: 0x2a3a4e, warn: 0xd8b030, red: 0xc0302a,
};

const matCache = new Map();
export function mat(color, opts = null) {
  const key = opts ? `${color}:${JSON.stringify(opts)}` : color;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true, ...(opts || {}) });
    matCache.set(key, m);
  }
  return m;
}
export const glowMat = (color) => mat(color, { emissive: color, emissiveIntensity: 1 });

const BOX = new THREE.BoxGeometry(1, 1, 1);
const geoCache = new Map();
function cached(key, make) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}

function prismGeo(w, h, d) {
  return cached(`prism${w}_${h}_${d}`, () => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.lineTo(-w / 2, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
    g.translate(0, 0, -d / 2);
    return g;
  });
}

function add(g, mesh, x, y, z, shadow = true) {
  mesh.position.set(x, y, z);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}

export function box(g, w, h, d, color, x = 0, y = 0, z = 0, ry = 0, material = null) {
  const m = add(g, new THREE.Mesh(BOX, material || mat(color)), x, y + h / 2, z);
  m.scale.set(w, h, d);
  m.rotation.y = ry;
  return m;
}

export function cyl(g, rt, rb, h, seg, color, x = 0, y = 0, z = 0, material = null) {
  const geo = cached(`cyl${rt}_${rb}_${h}_${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
  return add(g, new THREE.Mesh(geo, material || mat(color)), x, y + h / 2, z);
}

export function roof(g, w, h, d, color, x = 0, y = 0, z = 0, ry = 0) {
  const m = add(g, new THREE.Mesh(prismGeo(w, h, d), mat(color)), x, y, z);
  m.rotation.y = ry;
  return m;
}

function pyramid(g, w, h, color, x = 0, y = 0, z = 0) {
  const geo = cached(`pyr${w}_${h}`, () => { const c = new THREE.ConeGeometry(w * Math.SQRT1_2, h, 4); c.rotateY(Math.PI / 4); return c; });
  return add(g, new THREE.Mesh(geo, mat(color)), x, y + h / 2, z);
}

function dome(g, r, color, x, y, z, material = null) {
  const geo = cached(`dome${r}`, () => new THREE.SphereGeometry(r, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2));
  return add(g, new THREE.Mesh(geo, material || mat(color)), x, y, z);
}

function sandbags(g, x, z, len, ry = 0) {
  const s = new THREE.Group();
  for (let i = 0; i < len; i++) box(s, 0.2, 0.1, 0.14, i % 2 ? 0xb39f72 : 0xa8946a, -len * 0.1 + i * 0.2 + 0.1, 0, 0);
  for (let i = 0; i < len - 1; i++) box(s, 0.2, 0.1, 0.14, 0xb8a679, -len * 0.1 + i * 0.2 + 0.2, 0.1, 0);
  s.position.set(x, 0, z);
  s.rotation.y = ry;
  g.add(s);
}

// Valdmark flag: blue / gold / blue. Returns the cloth group so it can wave.
export function flag(g, x, z, h, colors = [PALETTE.blue, PALETTE.gold, PALETTE.blue]) {
  cyl(g, 0.02, 0.02, h, 4, 0xcccccc, x, 0, z);
  const f = new THREE.Group();
  f.position.set(x + 0.01, h - 0.32, z);
  colors.forEach((c, i) => box(f, 0.02, 0.1, 0.42, c, 0, 0.2 - i * 0.1, 0.22));
  g.add(f);
  (g.userData.flags || (g.userData.flags = [])).push(f);
  return f;
}

function stripe(g, w, d, y, x = 0, z = 0) {
  box(g, w, 0.05, d, PALETTE.gold, x, y, z);
}

function windows(g, w, h, d, rows, cols, y0, mat_, color = PALETTE.glass) {
  // Small window boxes on the front and back faces; `mat_` is the per-town window material.
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = -w / 2 + (c + 0.5) * (w / cols);
    const y = y0 + r * (h / rows);
    for (const zf of [d / 2 + 0.01, -d / 2 - 0.01]) box(g, w / cols * 0.45, h / rows * 0.4, 0.02, color, x, y, zf, 0, mat_);
  }
}

// ---------------------------------------------------------------- defences

export function makeWall() {
  const g = new THREE.Group();
  box(g, 1.0, 1.0, 1.0, PALETTE.concrete);
  box(g, 1.02, 0.07, 1.02, 0x7c7b74, 0, 1.0, 0);
  box(g, 1.02, 0.05, 1.02, PALETTE.concrete2, 0, 0.32, 0);
  for (let i = 0; i < 3; i++) box(g, 0.06, 0.07, 0.06, 0x3a3a3a, -0.33 + i * 0.33, 1.07, 0.18);
  box(g, 0.9, 0.025, 0.025, 0x555555, 0, 1.12, 0.18);
  g.userData.height = 1;
  return g;
}

export function makeHighWall() {
  const g = new THREE.Group();
  box(g, 1.0, 1.85, 1.0, 0xb2b1a8);
  for (let k = 0; k < 3; k++) box(g, 1.02, 0.05, 1.02, PALETTE.concrete2, 0, 0.45 + k * 0.5, 0);
  box(g, 1.04, 0.1, 1.04, 0x6f6e68, 0, 1.85, 0);
  for (let i = 0; i < 4; i++) box(g, 0.16, 0.14, 0.16, 0x6f6e68, -0.38 + i * 0.25, 1.95, 0.35);
  for (let i = 0; i < 5; i++) box(g, 0.05, 0.09, 0.05, 0x3a3a3a, -0.4 + i * 0.2, 1.95, -0.2);
  stripe(g, 1.03, 1.03, 1.2);
  g.userData.height = 1.9;
  return g;
}

export function makeGate() {
  const g = new THREE.Group();
  box(g, 0.22, 1.25, 1.0, PALETTE.concrete, -0.39, 0, 0);
  box(g, 0.22, 1.25, 1.0, PALETTE.concrete, 0.39, 0, 0);
  box(g, 1.0, 0.18, 1.0, 0x7c7b74, 0, 1.08, 0);
  const door = new THREE.Group();
  box(door, 0.56, 0.95, 0.12, 0x4a5568, 0, 0, 0);
  for (let i = 0; i < 4; i++) box(door, 0.58, 0.05, 0.13, 0x2e3644, 0, 0.12 + i * 0.22, 0);
  box(door, 0.56, 0.08, 0.13, PALETTE.gold, 0, 0.88, 0);
  g.add(door);
  g.userData.door = door;
  g.userData.height = 1.2;
  return g;
}

export function makeTower() {
  const g = new THREE.Group();
  for (const [x, z] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) box(g, 0.07, 1.5, 0.07, 0x6a5a40, x, 0, z);
  for (const y of [0.45, 0.95]) {
    box(g, 0.56, 0.04, 0.04, 0x5a4a30, 0, y, 0.25); box(g, 0.56, 0.04, 0.04, 0x5a4a30, 0, y, -0.25);
    box(g, 0.04, 0.04, 0.56, 0x5a4a30, 0.25, y, 0); box(g, 0.04, 0.04, 0.56, 0x5a4a30, -0.25, y, 0);
  }
  box(g, 0.72, 0.07, 0.72, 0x7a6a4a, 0, 1.5, 0);
  for (const [x, z, w, d] of [[0, -0.34, 0.72, 0.04], [0, 0.34, 0.72, 0.04], [-0.34, 0, 0.04, 0.72], [0.34, 0, 0.04, 0.72]]) box(g, w, 0.22, d, 0x5a4a30, x, 1.57, z);
  sandbags(g, 0, 0.27, 3);
  pyramid(g, 0.86, 0.36, PALETTE.olive2, 0, 1.97, 0);
  for (const [x, z] of [[-0.31, -0.31], [0.31, -0.31], [-0.31, 0.31], [0.31, 0.31]]) box(g, 0.04, 0.4, 0.04, 0x5a4a30, x, 1.57, z);
  const lamp = new THREE.Group();
  box(lamp, 0.12, 0.1, 0.16, 0x333333, 0, 0, 0);
  box(lamp, 0.1, 0.08, 0.02, 0xfff2b0, 0, 0.01, 0.09, 0, glowMat(0xfff2b0));
  lamp.position.set(0.2, 1.65, 0.2);
  g.add(lamp);
  g.userData.lamp = lamp;
  g.userData.muzzle = new THREE.Vector3(0, 1.75, 0);
  flag(g, -0.3, -0.3, 2.6);
  return g;
}

export function makeCheckpoint() {
  const g = new THREE.Group();
  box(g, 0.32, 0.42, 0.32, PALETTE.white, -0.32, 0, -0.3);
  box(g, 0.36, 0.05, 0.36, PALETTE.blue, -0.32, 0.42, -0.3);
  box(g, 0.33, 0.12, 0.33, PALETTE.glass, -0.32, 0.24, -0.3);
  const boom = new THREE.Group();
  for (let i = 0; i < 5; i++) box(boom, 0.16, 0.045, 0.045, i % 2 ? 0xffffff : PALETTE.red, 0.08 + i * 0.16, 0, 0);
  boom.position.set(-0.14, 0.34, -0.02);
  g.add(boom);
  box(g, 0.07, 0.36, 0.07, 0x444444, -0.16, 0, -0.02);
  sandbags(g, 0.26, 0.36, 3);
  box(g, 0.38, 0.22, 0.16, 0xb5b5ad, -0.3, 0, 0.36);
  for (let i = 0; i < 2; i++) box(g, 0.12, 0.08, 0.02, PALETTE.gold, -0.4 + i * 0.2, 0.1, 0.45);
  g.userData.boom = boom;
  g.userData.muzzle = new THREE.Vector3(0.25, 0.4, 0.35);
  return g;
}

export function makeFloodlight() {
  const g = new THREE.Group();
  box(g, 0.3, 0.06, 0.3, 0x555555);
  cyl(g, 0.04, 0.05, 1.6, 5, 0x666666, 0, 0, 0);
  const head = new THREE.Group();
  box(head, 0.36, 0.2, 0.14, 0x3a3a3a, 0, 0, 0);
  for (let i = 0; i < 3; i++) box(head, 0.09, 0.12, 0.02, 0xfff6c0, -0.11 + i * 0.11, 0.04, 0.08, 0, glowMat(0xfff6c0));
  head.position.set(0, 1.6, 0);
  head.rotation.x = 0.5;
  g.add(head);
  g.userData.head = head;
  return g;
}

export function makeLure() {
  const g = new THREE.Group();
  box(g, 0.34, 0.25, 0.34, 0x5a5a5a);
  cyl(g, 0.04, 0.05, 1.1, 5, 0x777777, 0, 0.25, 0);
  const sp = new THREE.Group();
  for (const r of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const horn = new THREE.Mesh(cached('horn', () => { const c = new THREE.CylinderGeometry(0.12, 0.04, 0.26, 6, 1, true); c.rotateX(Math.PI / 2); c.translate(0, 0, 0.13); return c; }), mat(0xd8d8d0, { side: THREE.DoubleSide }));
    horn.rotation.y = r;
    horn.castShadow = true;
    sp.add(horn);
  }
  sp.position.y = 1.3;
  g.add(sp);
  box(g, 0.1, 0.06, 0.02, PALETTE.red, 0, 0.12, 0.18, 0, glowMat(0xff3030));
  g.userData.speaker = sp;
  return g;
}

export function makeMinefield() {
  const g = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const a = i * 1.7, r = 0.18 + (i % 3) * 0.1;
    cyl(g, 0.07, 0.08, 0.04, 6, 0x4a4a3a, Math.cos(a) * r, 0, Math.sin(a) * r);
  }
  box(g, 0.03, 0.3, 0.03, 0x6a5a40, 0.4, 0, 0.4);
  box(g, 0.18, 0.12, 0.01, PALETTE.red, 0.4, 0.22, 0.41);
  return g;
}

export function makeArtillery() {
  const g = new THREE.Group();
  box(g, 2, 0.05, 2, 0x7a7356);
  for (const [x, z] of [[-0.5, -0.4], [0.5, -0.4]]) {
    const gun = new THREE.Group();
    box(gun, 0.42, 0.18, 0.5, PALETTE.olive, 0, 0.1, 0);
    cyl(gun, 0.12, 0.12, 0.1, 8, 0x222222, -0.24, 0.12, 0);
    cyl(gun, 0.12, 0.12, 0.1, 8, 0x222222, 0.24, 0.12, 0);
    const barrel = new THREE.Group();
    box(barrel, 0.08, 0.08, 0.9, PALETTE.olive2, 0, 0, 0.42);
    barrel.position.set(0, 0.32, 0);
    barrel.rotation.x = -0.6;
    gun.add(barrel);
    gun.position.set(x, 0, z);
    g.add(gun);
    (g.userData.barrels || (g.userData.barrels = [])).push(barrel);
  }
  sandbags(g, 0, 0.55, 8);
  for (let i = 0; i < 4; i++) box(g, 0.14, 0.14, 0.32, 0x5a5a3a, -0.7 + i * 0.2, 0.05, 0.75);
  flag(g, 0.85, 0.85, 1.4);
  g.userData.muzzle = new THREE.Vector3(0, 0.7, 0);
  return g;
}

// ---------------------------------------------------------------- economy

export function makeFarm() {
  const g = new THREE.Group();
  box(g, 2, 0.04, 2, 0x7a5a36);
  const crops = [];
  for (let i = 0; i < 6; i++) crops.push(box(g, 0.14, 0.12, 1.2, i % 3 === 2 ? 0xc9b24a : 0x7fae45, -0.85 + i * 0.22, 0.04, 0.3));
  box(g, 0.6, 0.42, 0.5, 0xa33b2e, 0.55, 0.04, -0.55);
  roof(g, 0.66, 0.28, 0.54, 0x5a3a2a, 0.55, 0.46, -0.55);
  box(g, 0.16, 0.24, 0.02, 0xeeeeee, 0.55, 0.04, -0.29);
  cyl(g, 0.16, 0.16, 0.8, 8, 0xd7d7d0, -0.2, 0.04, -0.6);
  dome(g, 0.16, 0x9a9a9a, -0.2, 0.84, -0.6);
  const tractor = new THREE.Group();
  box(tractor, 0.16, 0.12, 0.26, 0x3a7a3a, 0, 0.06, 0);
  box(tractor, 0.12, 0.12, 0.1, 0x2a5a2a, 0, 0.16, -0.05);
  cyl(tractor, 0.07, 0.07, 0.04, 6, 0x222222, 0.1, 0.03, -0.07);
  tractor.position.set(-0.2, 0.04, 0.3);
  g.add(tractor);
  g.userData.tractor = tractor;
  g.userData.crops = crops;
  return g;
}

export function makeFactory() {
  const g = new THREE.Group();
  box(g, 2, 0.04, 2, 0x77756f);
  box(g, 1.5, 0.55, 1.1, 0x8a8478, -0.15, 0.04, -0.1);
  for (let i = 0; i < 3; i++) roof(g, 0.5, 0.25, 1.1, 0x5a5850, -0.65 + i * 0.5, 0.59, -0.1);
  for (let i = 0; i < 3; i++) box(g, 0.3, 0.06, 1.12, 0x9fb8c8, -0.7 + i * 0.5, 0.66, -0.1, 0, glowMat(0x506070));
  cyl(g, 0.11, 0.14, 1.5, 6, 0xb0463a, 0.75, 0.04, 0.6);
  box(g, 0.25, 0.08, 0.25, 0xeeeeee, 0.75, 1.1, 0.6);
  box(g, 0.25, 0.08, 0.25, 0xeeeeee, 0.75, 0.8, 0.6);
  box(g, 0.5, 0.3, 0.3, 0x6a6458, -0.4, 0.04, 0.7);
  box(g, 0.4, 0.3, 0.02, PALETTE.dark, -0.15, 0.04, 0.46);
  g.userData.smoke = [new THREE.Vector3(0.75, 1.6, 0.6)];
  return g;
}

export function makeMunitions() {
  const g = new THREE.Group();
  box(g, 2, 0.04, 2, 0x6f6c5a);
  box(g, 1.3, 0.45, 0.8, 0x6b6a4a, -0.25, 0.04, -0.4);
  roof(g, 0.86, 0.3, 1.32, 0x4a4a32, -0.25, 0.49, -0.4, Math.PI / 2);
  for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) box(g, 0.22, 0.16, 0.3, PALETTE.olive2, 0.3 + i * 0.25, 0.04 + k * 0.17, 0.55);
  for (let i = 0; i < 3; i++) box(g, 0.05, 0.05, 0.31, PALETTE.gold, 0.3 + i * 0.25, 0.13, 0.55);
  cyl(g, 0.09, 0.1, 1.0, 6, 0x777066, 0.75, 0.04, -0.6);
  box(g, 0.1, 0.1, 0.02, 0xd02020, -0.25, 0.3, 0.01, 0, glowMat(0xff3a2a));
  sandbags(g, -0.6, 0.6, 3, Math.PI / 2);
  g.userData.smoke = [new THREE.Vector3(0.75, 1.1, -0.6)];
  return g;
}

export function makeDepot() {
  const g = new THREE.Group();
  box(g, 2, 0.04, 2, 0x7a7766);
  box(g, 1.2, 0.5, 0.9, 0x7e8a6a, -0.3, 0.04, -0.4);
  for (let k = 0; k < 4; k++) roof(g, 0.92, 0.18, 0.3, 0x5a6a4a, -0.3 - 0.45 + k * 0.3, 0.54, -0.4, Math.PI / 2);
  box(g, 0.5, 0.36, 0.02, PALETTE.dark, -0.3, 0.04, 0.06);
  for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) box(g, 0.24, 0.2, 0.24, i % 2 ? 0x8a6a40 : 0x9a7a4a, 0.4 + k * 0.28, 0.04 + i * 0.2, 0.45);
  box(g, 0.6, 0.18, 0.3, PALETTE.olive, 0.55, 0.04, -0.55);
  stripe(g, 1.21, 0.91, 0.42, -0.3, -0.4);
  return g;
}

// ---------------------------------------------------------------- civic

export function makeHQ() {
  const g = new THREE.Group();
  box(g, 2, 0.06, 2, 0x8d8d86);
  box(g, 1.3, 0.75, 1.0, 0x9aa0a6, -0.2, 0.06, -0.25);
  box(g, 1.34, 0.08, 1.04, 0x5d636a, -0.2, 0.81, -0.25);
  for (let i = 0; i < 3; i++) box(g, 1.32, 0.05, 1.02, PALETTE.glass, -0.2, 0.22 + i * 0.2, -0.25, 0, i === 1 ? glowMat(0x34506a) : null);
  stripe(g, 1.35, 1.05, 0.7, -0.2, -0.25);
  box(g, 0.5, 0.35, 0.4, 0x8a9096, -0.2, 0.89, -0.25);
  const dish = new THREE.Group();
  const dg = cached('dish', () => new THREE.ConeGeometry(0.2, 0.1, 8, 1, true));
  const dm = new THREE.Mesh(dg, mat(0xf4f4f4, { side: THREE.DoubleSide }));
  dm.rotation.x = Math.PI * 0.75;
  dish.add(dm);
  dish.position.set(-0.45, 1.35, -0.35);
  g.add(dish);
  cyl(g, 0.015, 0.015, 0.5, 4, 0x333333, 0.05, 1.24, -0.3);
  cyl(g, 0.42, 0.42, 0.03, 12, 0x4a4a4a, 0.5, 0.06, 0.55);
  box(g, 0.06, 0.04, 0.3, 0xeeeeee, 0.42, 0.08, 0.55); box(g, 0.06, 0.04, 0.3, 0xeeeeee, 0.58, 0.08, 0.55); box(g, 0.16, 0.04, 0.06, 0xeeeeee, 0.5, 0.08, 0.55);
  flag(g, -0.8, 0.6, 1.5);
  sandbags(g, -0.3, 0.75, 4);
  g.userData.dish = dish;
  g.userData.muzzle = new THREE.Vector3(-0.3, 1.1, 0.4);
  return g;
}

export function makeBarracks() {
  const g = new THREE.Group();
  box(g, 2, 0.04, 2, 0x8f8a6a);
  for (const z of [-0.5, 0.35]) {
    box(g, 1.6, 0.42, 0.55, 0x6b7a4a, -0.1, 0.04, z);
    roof(g, 0.62, 0.25, 1.64, 0x4a5530, -0.1, 0.46, z, Math.PI / 2);
    for (let i = 0; i < 4; i++) box(g, 0.1, 0.12, 0.57, 0x2c3320, -0.6 + i * 0.35, 0.22, z);
  }
  flag(g, 0.85, 0.85, 1.3);
  sandbags(g, 0.75, -0.1, 2, Math.PI / 2);
  for (let i = 0; i < 3; i++) box(g, 0.05, 0.3, 0.05, 0x6a5a40, 0.85, 0, -0.9 + i * 0.12);
  return g;
}

export function makePolice() {
  const g = new THREE.Group();
  box(g, 2, 0.04, 2, 0x8a8a88);
  box(g, 1.4, 0.6, 0.9, 0xd8d4c8, -0.1, 0.04, -0.35);
  box(g, 1.44, 0.12, 0.94, PALETTE.blue, -0.1, 0.64, -0.35);
  box(g, 0.4, 0.4, 0.02, PALETTE.glass, -0.1, 0.04, 0.11);
  for (let i = 0; i < 4; i++) box(g, 0.18, 0.16, 0.02, PALETTE.glass, -0.65 + i * 0.36, 0.34, 0.11);
  const car = new THREE.Group();
  box(car, 0.24, 0.12, 0.44, 0xffffff, 0, 0.05, 0);
  box(car, 0.22, 0.1, 0.24, PALETTE.blue, 0, 0.17, -0.02);
  const lights = box(car, 0.14, 0.04, 0.05, 0xff2020, 0, 0.27, -0.02, 0, glowMat(0xff2020));
  car.position.set(0.55, 0.04, 0.55);
  g.add(car);
  g.userData.siren = lights;
  flag(g, -0.85, 0.75, 1.2);
  return g;
}

export function makeHospital() {
  const g = new THREE.Group();
  box(g, 2, 0.03, 2, 0x9a9a88);
  for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45]]) {
    roof(g, 0.75, 0.45, 0.7, 0xe8e8e0, x, 0.03, z);
    box(g, 0.2, 0.03, 0.05, PALETTE.red, x, 0.33, z + 0.36);
    box(g, 0.06, 0.15, 0.05, PALETTE.red, x, 0.27, z + 0.36);
  }
  box(g, 0.5, 0.3, 0.4, 0xffffff, 0.45, 0.03, 0.45);
  box(g, 0.24, 0.02, 0.07, PALETTE.red, 0.45, 0.33, 0.45);
  box(g, 0.07, 0.02, 0.24, PALETTE.red, 0.45, 0.33, 0.45);
  for (let i = 0; i < 8; i++) cyl(g, 0.015, 0.015, 0.3, 4, 0x666666, -0.95 + i * 0.27, 0, 0.95);
  const amb = new THREE.Group();
  box(amb, 0.22, 0.18, 0.4, 0xf0f0f0, 0, 0.04, 0);
  box(amb, 0.23, 0.04, 0.41, PALETTE.red, 0, 0.12, 0);
  box(amb, 0.08, 0.03, 0.04, 0x3080ff, 0, 0.23, 0.08, 0, glowMat(0x3080ff));
  amb.position.set(0.8, 0, -0.1);
  g.add(amb);
  return g;
}

export function makeCamp() {
  const g = new THREE.Group();
  box(g, 2, 0.03, 2, 0x9a9070);
  const colors = [0x4a6a8a, 0x6a8aaa, 0x8a6a4a, 0x5a7a5a];
  for (let i = 0; i < 6; i++) {
    const x = -0.6 + (i % 3) * 0.6, z = -0.45 + Math.floor(i / 3) * 0.8;
    roof(g, 0.42, 0.3, 0.5, colors[i % 4], x, 0.03, z);
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    cyl(g, 0.015, 0.015, 0.35, 4, 0x777777, Math.cos(a) * 0.97, 0, Math.sin(a) * 0.97);
  }
  box(g, 0.5, 0.25, 0.3, 0xeeeeee, 0.7, 0.03, 0.75);
  box(g, 0.2, 0.06, 0.02, 0x2a6ad0, 0.7, 0.2, 0.91);
  const fire = new THREE.Group();
  box(fire, 0.14, 0.04, 0.14, 0x3a3020, 0, 0, 0);
  fire.position.set(0, 0.03, 0.3);
  g.add(fire);
  g.userData.smoke = [new THREE.Vector3(0, 0.15, 0.3)];
  g.userData.smokeSoft = true;
  return g;
}

export function makeLab() {
  const g = new THREE.Group();
  box(g, 2, 0.04, 2, 0x9a9a95);
  box(g, 1.5, 0.6, 0.9, 0xe9ecef, -0.1, 0.04, -0.3);
  box(g, 1.52, 0.1, 0.92, 0x4a8ab0, -0.1, 0.36, -0.3, 0, glowMat(0x2a5a7a));
  dome(g, 0.35, 0xd5d8dc, -0.35, 0.64, -0.3);
  const dish = new THREE.Group();
  const dm = new THREE.Mesh(cached('dish', () => new THREE.ConeGeometry(0.2, 0.1, 8, 1, true)), mat(0xf4f4f4, { side: THREE.DoubleSide }));
  dm.rotation.x = Math.PI * 0.8;
  dish.add(dm);
  dish.position.set(0.6, 0.85, 0.5);
  g.add(dish);
  cyl(g, 0.03, 0.03, 0.7, 4, 0x888888, 0.6, 0.04, 0.5);
  box(g, 0.12, 0.3, 0.12, 0xaabbcc, 0.3, 0.04, 0.6);
  g.userData.dish = dish;
  return g;
}

export function makeRadar() {
  const g = new THREE.Group();
  box(g, 2, 0.04, 2, 0x8a8a84);
  box(g, 0.8, 0.45, 0.6, 0xdedad0, -0.45, 0.04, -0.45);
  box(g, 0.82, 0.06, 0.62, PALETTE.blue, -0.45, 0.49, -0.45);
  for (const [x, z] of [[0.15, 0.15], [0.65, 0.15], [0.15, 0.65], [0.65, 0.65]]) box(g, 0.05, 0.9, 0.05, 0x777777, x, 0, z);
  box(g, 0.6, 0.06, 0.6, 0x666666, 0.4, 0.9, 0.4);
  const spin = new THREE.Group();
  box(spin, 0.06, 0.2, 0.06, 0x555555, 0, 0, 0);
  const arr = box(spin, 0.9, 0.3, 0.06, 0xe8e8e8, 0, 0.2, 0.05);
  arr.rotation.x = -0.25;
  spin.position.set(0.4, 0.96, 0.4);
  g.add(spin);
  box(g, 0.06, 0.06, 0.06, 0xff4030, 0.4, 1.55, 0.4, 0, glowMat(0xff4030));
  g.userData.spin = spin;
  return g;
}

export function makeHelipad() {
  const g = new THREE.Group();
  box(g, 2, 0.05, 2, 0x55585c);
  cyl(g, 0.82, 0.82, 0.02, 16, 0x3e4044, 0, 0.05, 0);
  const ring = cyl(g, 0.84, 0.84, 0.015, 16, PALETTE.gold, 0, 0.05, 0);
  ring.scale.set(1, 1, 1);
  box(g, 0.1, 0.03, 0.6, 0xeeeeee, -0.2, 0.07, 0); box(g, 0.1, 0.03, 0.6, 0xeeeeee, 0.2, 0.07, 0); box(g, 0.3, 0.03, 0.1, 0xeeeeee, 0, 0.07, 0);
  for (const [x, z] of [[-0.92, -0.92], [0.92, -0.92], [-0.92, 0.92], [0.92, 0.92]]) box(g, 0.08, 0.08, 0.08, 0x40ff60, x, 0.05, z, 0, glowMat(0x40ff60));
  box(g, 0.4, 0.4, 0.3, 0x6a6e72, 0.75, 0.05, -0.8);
  cyl(g, 0.012, 0.012, 0.5, 4, 0x999999, 0.9, 0.45, -0.8);
  const sock = box(g, 0.05, 0.05, 0.2, 0xff7020, 0.9, 0.92, -0.7);
  g.userData.sock = sock;
  return g;
}

export const BUILDING_MODELS = {
  hq: makeHQ, wall: makeWall, highwall: makeHighWall, gate: makeGate, tower: makeTower, checkpoint: makeCheckpoint,
  floodlight: makeFloodlight, lure: makeLure, minefield: makeMinefield, artillery: makeArtillery,
  farm: makeFarm, factory: makeFactory, munitions: makeMunitions, depot: makeDepot,
  barracks: makeBarracks, police: makePolice, hospital: makeHospital, camp: makeCamp, lab: makeLab, radar: makeRadar, helipad: makeHelipad,
};

export function makeGhost(type) {
  const g = BUILDING_MODELS[type]();
  const m = new THREE.MeshBasicMaterial({ color: 0x66ff88, transparent: true, opacity: 0.45, depthWrite: false });
  g.traverse((o) => { if (o.isMesh) { o.material = m; o.castShadow = false; o.receiveShadow = false; } });
  g.userData.ghostMat = m;
  return g;
}

export function makeScaffold(size) {
  const g = new THREE.Group();
  const s = size * 0.98, h = size === 1 ? 1.1 : 0.9;
  const m = mat(0xc8a040);
  for (const [x, z] of [[-s / 2, -s / 2], [s / 2, -s / 2], [-s / 2, s / 2], [s / 2, s / 2]]) box(g, 0.04, h, 0.04, 0, x, 0, z, 0, m);
  for (const y of [h * 0.5, h]) {
    box(g, s, 0.03, 0.03, 0, 0, y, s / 2, 0, m); box(g, s, 0.03, 0.03, 0, 0, y, -s / 2, 0, m);
    box(g, 0.03, 0.03, s, 0, s / 2, y, 0, 0, m); box(g, 0.03, 0.03, s, 0, -s / 2, y, 0, 0, m);
  }
  const crane = new THREE.Group();
  box(crane, 0.05, h + 0.6, 0.05, 0xd8a020, 0, 0, 0);
  box(crane, s * 0.9, 0.05, 0.05, 0xd8a020, s * 0.35, h + 0.55, 0);
  crane.position.set(-s / 2 + 0.1, 0, -s / 2 + 0.1);
  if (size > 1) g.add(crane);
  g.userData.crane = crane;
  return g;
}

// The plate under every player building but the wall lines, so your buildings read as yours and town houses do
// not: the footprint plus 0.15, 0.04 high, a dark slab rimmed in the gold of the border line.
const PLATE_GOLD = new THREE.MeshBasicMaterial({ color: 0xf0c94a });
const PLATE_RIM = 0.06;
export function makePlate(size) {
  const g = new THREE.Group();
  const s = size + 0.15, inner = s - PLATE_RIM * 2;
  box(g, inner, 0.04, inner, 0x23272a).castShadow = false;
  const rim = cached(`plate${size}`, () => {
    const outline = new THREE.Shape([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => new THREE.Vector2((x * s) / 2, (y * s) / 2)));
    outline.holes.push(new THREE.Path([[-1, -1], [-1, 1], [1, 1], [1, -1]].map(([x, y]) => new THREE.Vector2((x * inner) / 2, (y * inner) / 2))));
    const geo = new THREE.ExtrudeGeometry(outline, { depth: 0.04, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    return geo;
  });
  g.add(new THREE.Mesh(rim, PLATE_GOLD));
  return g;
}

// ---------------------------------------------------------------- towns

export function makeHouse(r, winMat) {
  const g = new THREE.Group();
  const bodies = [0xece6d6, 0xdccfa8, 0xe6d58f, 0xb9cbd6, 0xd6b6a0, 0xf2f2ec, 0xc9b8a0];
  const roofs = [PALETTE.roofRed, PALETTE.roofBrown, PALETTE.roofSlate, 0x8a5a3a];
  const w = 0.5 + r() * 0.22, d = 0.45 + r() * 0.2, h = 0.32 + r() * 0.18;
  box(g, w, h, d, bodies[Math.floor(r() * bodies.length)]);
  roof(g, w + 0.08, 0.24 + r() * 0.08, d + 0.06, roofs[Math.floor(r() * roofs.length)], 0, h, 0);
  box(g, 0.1, 0.18, 0.02, 0x5a3a2a, -w / 4, 0, d / 2 + 0.005);
  box(g, 0.1, 0.08, 0.02, PALETTE.glass, w / 4, h * 0.5, d / 2 + 0.005, 0, winMat);
  box(g, 0.1, 0.08, 0.02, PALETTE.glass, -w / 4, h * 0.5, -d / 2 - 0.005, 0, winMat);
  if (r() < 0.4) box(g, 0.08, 0.16, 0.08, 0x8a5a4a, w / 4, h + 0.08, -d / 6);
  return g;
}

export function makeApartment(r, winMat) {
  const g = new THREE.Group();
  const cols = [0xb8b4aa, 0xc9c1ac, 0x9fa4a8, 0xd2c8b4];
  const floors = 3 + Math.floor(r() * 4);
  const fh = 0.32, w = 0.74, d = 0.74;
  box(g, w, floors * fh + 0.06, d, cols[Math.floor(r() * cols.length)]);
  windows(g, w, floors * fh, d, floors, 3, 0.12, winMat);
  box(g, w + 0.04, 0.05, d + 0.04, 0x6a6a6a, 0, floors * fh + 0.06, 0);
  box(g, 0.18, 0.12, 0.14, 0x888888, 0.15, floors * fh + 0.11, -0.1);
  return g;
}

export function makeRuin(r) {
  const g = new THREE.Group();
  const w = 0.5 + r() * 0.25, d = 0.45 + r() * 0.2;
  box(g, w, 0.18 + r() * 0.2, d, 0x5e5850);
  box(g, w * 0.4, 0.34, 0.06, 0x4a4540, -w * 0.25, 0, d / 2);
  if (r() < 0.5) box(g, 0.4, 0.06, 0.5, 0x2a2622, 0.2, 0.2, 0, 0.6);
  return g;
}

// Town specialty landmarks (2×2, centred).
export function makeLandmark(kind, winMat) {
  const g = new THREE.Group();
  if (kind === 'capital') {
    box(g, 1.8, 0.1, 1.4, 0xbab4a4);
    box(g, 1.5, 0.6, 1.0, 0xe0dccf, 0, 0.1, -0.1);
    for (let i = 0; i < 6; i++) cyl(g, 0.05, 0.05, 0.55, 6, 0xf4f0e6, -0.62 + i * 0.25, 0.1, 0.45);
    roof(g, 1.55, 0.25, 0.3, 0xd0ccbe, 0, 0.7, 0.45);
    box(g, 1.52, 0.08, 1.02, 0xc8c2b0, 0, 0.7, -0.1);
    cyl(g, 0.32, 0.36, 0.3, 10, 0xd8d2c0, 0, 0.78, -0.15);
    dome(g, 0.34, 0x5a8a7a, 0, 1.08, -0.15);
    windows(g, 1.5, 0.5, 1.0, 2, 6, 0.2, winMat);
    flag(g, 0, -0.15, 2.0);
  } else if (kind === 'port') {
    box(g, 2, 0.08, 0.5, 0x6a5a48, 0, 0, 0.75);
    for (let i = 0; i < 5; i++) cyl(g, 0.04, 0.04, 0.3, 5, 0x4a3a2a, -0.9 + i * 0.45, -0.2, 0.98);
    box(g, 0.8, 0.45, 0.6, 0x8a9aa8, -0.5, 0, -0.4);
    roof(g, 0.86, 0.22, 0.64, 0x5a6a78, -0.5, 0.45, -0.4);
    const crane = new THREE.Group();
    box(crane, 0.1, 1.4, 0.1, PALETTE.red, 0, 0, 0);
    box(crane, 0.08, 0.08, 1.1, PALETTE.red, 0, 1.35, 0.35);
    box(crane, 0.02, 0.5, 0.02, 0x333333, 0, 0.85, 0.8);
    crane.position.set(0.5, 0, 0.3);
    g.add(crane);
    const boat = new THREE.Group();
    box(boat, 0.3, 0.14, 0.7, PALETTE.white, 0, 0, 0);
    box(boat, 0.22, 0.16, 0.24, 0x3a5a8a, 0, 0.14, -0.1);
    cyl(boat, 0.015, 0.015, 0.5, 4, 0x888888, 0, 0.14, 0.15);
    boat.position.set(-0.2, -0.12, 1.3);
    g.add(boat);
    g.userData.boat = boat;
    g.userData.crane = crane;
  } else if (kind === 'industry') {
    box(g, 1.9, 0.05, 1.9, 0x6a665e);
    box(g, 1.2, 0.8, 0.8, 0x6a5a52, -0.3, 0.05, -0.4);
    for (let i = 0; i < 3; i++) roof(g, 0.4, 0.22, 0.8, 0x4a4440, -0.7 + i * 0.4, 0.85, -0.4);
    cyl(g, 0.3, 0.38, 1.0, 8, 0x5a4a44, 0.55, 0.05, 0.35);
    cyl(g, 0.12, 0.15, 1.9, 6, 0x8a3a30, 0.6, 0.05, -0.65);
    cyl(g, 0.1, 0.13, 1.6, 6, 0x8a3a30, 0.85, 0.05, -0.35);
    box(g, 0.4, 0.2, 0.3, 0xff8030, -0.3, 0.05, 0.02, 0, glowMat(0xff6020));
    g.userData.smoke = [new THREE.Vector3(0.6, 2.0, -0.65), new THREE.Vector3(0.85, 1.7, -0.35)];
  } else if (kind === 'farmland') {
    box(g, 1.9, 0.04, 1.9, 0x8a6a40);
    for (let i = 0; i < 4; i++) {
      cyl(g, 0.22, 0.22, 1.3 - i * 0.1, 10, 0xd8d6cc, -0.6 + i * 0.4, 0.04, -0.4);
      dome(g, 0.22, 0x9a9a92, -0.6 + i * 0.4, 1.34 - i * 0.1, -0.4);
    }
    box(g, 1.5, 0.08, 0.08, 0x777777, 0, 1.0, -0.4);
    box(g, 0.8, 0.4, 0.5, 0xa33b2e, 0.3, 0.04, 0.45);
    roof(g, 0.86, 0.26, 0.54, 0x5a3a2a, 0.3, 0.44, 0.45);
  } else if (kind === 'university') {
    box(g, 1.7, 0.55, 1.1, 0xb8946a, 0, 0, -0.2);
    roof(g, 1.75, 0.3, 1.14, 0x4a5a6a, 0, 0.55, -0.2);
    windows(g, 1.7, 0.45, 1.1, 2, 7, 0.1, winMat);
    box(g, 0.4, 1.3, 0.4, 0xc8a47a, 0, 0, 0.55);
    pyramid(g, 0.5, 0.4, 0x4a5a6a, 0, 1.3, 0.55);
    cyl(g, 0.12, 0.12, 0.02, 12, 0xf4f0e0, 0, 1.0, 0.76).rotation.x = Math.PI / 2;
  } else if (kind === 'railyard') {
    box(g, 2, 0.04, 2, 0x6a6458);
    for (const z of [-0.45, 0, 0.45]) {
      box(g, 2, 0.03, 0.04, 0x444444, 0, 0.04, z - 0.08);
      box(g, 2, 0.03, 0.04, 0x444444, 0, 0.04, z + 0.08);
      for (let i = 0; i < 9; i++) box(g, 0.05, 0.02, 0.26, 0x5a4030, -0.9 + i * 0.22, 0.03, z);
    }
    const train = new THREE.Group();
    box(train, 0.6, 0.3, 0.22, PALETTE.blue, 0, 0.07, 0);
    box(train, 0.18, 0.2, 0.2, 0x333333, 0.25, 0.37, 0);
    for (let i = 1; i < 3; i++) box(train, 0.55, 0.26, 0.22, 0x7a5a3a, -0.62 * i, 0.07, 0);
    train.position.set(0.4, 0, 0);
    g.add(train);
    box(g, 0.5, 0.5, 0.4, 0x8a7a6a, -0.6, 0.04, -0.85);
    g.userData.train = train;
  } else if (kind === 'market') {
    box(g, 1.8, 0.05, 1.4, 0xb0a890);
    box(g, 1.5, 0.45, 0.8, 0xd8c8a0, 0, 0.05, -0.2);
    roof(g, 0.9, 0.3, 1.55, 0x8a3a2a, 0, 0.5, -0.2, Math.PI / 2);
    const stalls = [0xc03030, 0x3060c0, 0x30a050, 0xd0a020];
    for (let i = 0; i < 4; i++) {
      box(g, 0.3, 0.2, 0.25, 0x8a6a4a, -0.6 + i * 0.4, 0.05, 0.5);
      roof(g, 0.36, 0.12, 0.3, stalls[i], -0.6 + i * 0.4, 0.25, 0.5);
    }
  } else if (kind === 'mine') {
    box(g, 1.9, 0.04, 1.9, 0x5e5850);
    // Headframe over the shaft: four posts, braces and the winding wheel on top.
    for (const [x, z] of [[-0.8, -0.75], [-0.3, -0.75], [-0.8, -0.25], [-0.3, -0.25]]) box(g, 0.07, 1.5, 0.07, 0x3a3a3c, x, 0.04, z);
    for (const y of [0.55, 1.05, 1.5]) { box(g, 0.57, 0.05, 0.05, 0x3a3a3c, -0.55, y, -0.75); box(g, 0.57, 0.05, 0.05, 0x3a3a3c, -0.55, y, -0.25); }
    cyl(g, 0.24, 0.24, 0.05, 12, 0x8a3a30, -0.55, 1.42, -0.5).rotation.z = Math.PI / 2;
    box(g, 0.75, 0.45, 0.55, 0x8a5a44, 0.35, 0.04, -0.55);
    roof(g, 0.8, 0.22, 0.6, 0x4a4440, 0.35, 0.49, -0.55);
    // Spoil heap and an ore cart on its rails.
    pyramid(g, 1.0, 0.55, 0x3e3a36, 0.45, 0.04, 0.5);
    box(g, 1.2, 0.02, 0.04, 0x444444, -0.3, 0.04, 0.32);
    box(g, 1.2, 0.02, 0.04, 0x444444, -0.3, 0.04, 0.48);
    box(g, 0.3, 0.18, 0.22, 0x6a5040, -0.5, 0.06, 0.4);
  }
  return g;
}

export function makeBridge(dirX) {
  const g = new THREE.Group();
  box(g, 1.02, 0.12, 0.9, 0x8a7a64, 0, -0.06, 0);
  box(g, 1.02, 0.12, 0.06, 0x6a5a48, 0, 0.06, 0.45);
  box(g, 1.02, 0.12, 0.06, 0x6a5a48, 0, 0.06, -0.45);
  box(g, 0.14, 0.6, 0.14, 0x7a6a54, 0, -0.62, 0);
  g.rotation.y = dirX ? 0 : Math.PI / 2;
  return g;
}

// ---------------------------------------------------------------- vehicles

export function makeAPC() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  box(body, 0.6, 0.3, 0.95, PALETTE.olive, 0, 0.13, 0);
  const front = box(body, 0.6, 0.18, 0.3, PALETTE.olive2, 0, 0.25, 0.45);
  front.rotation.x = 0.6;
  box(body, 0.62, 0.02, 0.3, 0x3d4828, 0, 0.3, -0.3);
  box(body, 0.61, 0.06, 0.2, PALETTE.blue, 0, 0.32, -0.05);
  box(body, 0.1, 0.06, 0.2, PALETTE.gold, 0.26, 0.33, -0.05);
  const turret = new THREE.Group();
  box(turret, 0.3, 0.14, 0.32, PALETTE.olive2, 0, 0, 0);
  box(turret, 0.05, 0.05, 0.42, 0x222222, 0, 0.07, 0.3);
  turret.position.set(0, 0.43, -0.05);
  body.add(turret);
  g.add(body);
  const wheelGeo = cached('wheel', () => { const c = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 8); c.rotateZ(Math.PI / 2); return c; });
  const wheels = [];
  for (const z of [-0.32, 0, 0.32]) for (const x of [-0.31, 0.31]) wheels.push(add(g, new THREE.Mesh(wheelGeo, mat(0x1e1e1e)), x, 0.12, z));
  g.userData.turret = turret;
  g.userData.wheels = wheels;
  g.userData.body = body;
  g.userData.muzzle = new THREE.Vector3(0, 0.5, 0.55);
  return g;
}

export function makeGunship() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  box(body, 0.34, 0.32, 0.8, 0x3d4a3a, 0, -0.16, 0);
  box(body, 0.28, 0.2, 0.22, 0x1d2c40, 0, -0.08, 0.42);
  box(body, 0.1, 0.1, 0.8, 0x3d4a3a, 0, -0.05, -0.7);
  box(body, 0.04, 0.26, 0.16, 0x3d4a3a, 0, -0.05, -1.05);
  box(body, 0.8, 0.04, 0.16, 0x2f3a2d, 0, -0.14, 0.05);
  box(body, 0.35, 0.06, 0.2, PALETTE.blue, 0, -0.02, -0.15);
  for (const x of [-0.36, 0.36]) box(body, 0.09, 0.09, 0.26, 0x222222, x, -0.2, 0.08);
  for (const x of [-0.18, 0.18]) box(body, 0.03, 0.03, 0.8, 0x222222, x, -0.4, 0);
  cyl(body, 0.03, 0.03, 0.12, 4, 0x222222, 0, 0.16, 0);
  const spot = box(body, 0.08, 0.06, 0.06, 0xfff2c0, 0, -0.34, 0.45, 0, glowMat(0xfff2c0));
  g.add(body);
  const rotor = new THREE.Group();
  box(rotor, 1.8, 0.02, 0.07, 0x1a1a1a);
  box(rotor, 0.07, 0.02, 1.8, 0x1a1a1a);
  rotor.position.y = 0.28;
  g.add(rotor);
  const tail = new THREE.Group();
  box(tail, 0.02, 0.4, 0.05, 0x1a1a1a, 0, -0.2, 0);
  tail.position.set(0.04, -0.05, -1.05);
  g.add(tail);
  g.userData.rotor = rotor;
  g.userData.tail = tail;
  g.userData.body = body;
  g.userData.spot = spot;
  g.userData.muzzle = new THREE.Vector3(0, -0.25, 0.5);
  return g;
}

// The scout: a trail bike and its rider, a carbine across his back. `rider` leans forward on the move; `spot` is
// the headlamp's glow, lit at night.
export function makeMotorbike() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  box(body, 0.07, 0.07, 0.34, 0x2a2d30, 0, 0.12, -0.01);
  box(body, 0.13, 0.09, 0.15, PALETTE.olive, 0, 0.19, 0.07);
  box(body, 0.131, 0.025, 0.15, PALETTE.blue, 0, 0.245, 0.07);
  box(body, 0.11, 0.045, 0.17, 0x1e1e1e, 0, 0.21, -0.08);
  box(body, 0.1, 0.03, 0.12, PALETTE.olive2, 0, 0.19, -0.2);
  box(body, 0.04, 0.04, 0.17, PALETTE.steel, 0.075, 0.09, -0.1);
  const fork = box(body, 0.03, 0.24, 0.03, PALETTE.steel, 0, 0.07, 0.2);
  fork.rotation.x = -0.35;
  box(body, 0.24, 0.025, 0.025, 0x1e1e1e, 0, 0.33, 0.15);
  box(body, 0.06, 0.05, 0.035, 0xd8d4c0, 0, 0.27, 0.23);
  const spot = box(body, 0.05, 0.04, 0.02, 0xfff2c0, 0, 0.275, 0.25, 0, glowMat(0xfff2c0));
  g.add(body);
  const wheelGeo = cached('bikeWheel', () => { const c = new THREE.CylinderGeometry(0.1, 0.1, 0.05, 10); c.rotateZ(Math.PI / 2); return c; });
  const wheels = [];
  for (const z of [-0.2, 0.22]) wheels.push(add(g, new THREE.Mesh(wheelGeo, mat(0x1a1a1a)), 0, 0.1, z));
  // The rider sits on the seat, thighs forward, hands on the bars.
  const rider = new THREE.Group();
  for (const x of [-0.065, 0.065]) {
    box(rider, 0.06, 0.06, 0.17, PALETTE.olive2, x, 0.22, -0.02);
    box(rider, 0.055, 0.17, 0.06, PALETTE.olive2, x * 1.15, 0.07, 0.06);
  }
  const torso = box(rider, 0.17, 0.21, 0.1, PALETTE.olive, 0, 0.24, -0.08);
  torso.rotation.x = 0.35;
  box(rider, 0.1, 0.1, 0.1, 0xd0a07a, 0, 0.45, -0.01);
  box(rider, 0.125, 0.06, 0.125, 0x37422a, 0, 0.53, -0.01);
  box(rider, 0.13, 0.03, 0.03, 0x1a1a1a, 0, 0.5, 0.05);
  for (const x of [-0.1, 0.1]) {
    const arm = box(rider, 0.05, 0.05, 0.2, PALETTE.olive, x, 0.36, 0.05);
    arm.rotation.x = 0.55;
  }
  box(rider, 0.052, 0.04, 0.06, PALETTE.gold, -0.1, 0.37, 0.0);
  const carbine = box(rider, 0.3, 0.03, 0.03, 0x1c1c1c, 0, 0.32, -0.15);
  carbine.rotation.z = 0.7;
  g.add(rider);
  g.userData.wheels = wheels;
  g.userData.body = body;
  g.userData.rider = rider;
  g.userData.spot = spot;
  g.userData.muzzle = new THREE.Vector3(0, 0.4, 0.2);
  return g;
}

export function makeBus() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  box(body, 0.42, 0.36, 1.1, 0xe0b030, 0, 0.12, 0);
  box(body, 0.43, 0.12, 1.0, PALETTE.glass, 0, 0.3, -0.02);
  box(body, 0.43, 0.04, 1.11, 0x2a2a2a, 0, 0.12, 0);
  box(body, 0.3, 0.06, 0.02, 0xfff6c0, 0, 0.2, 0.56, 0, glowMat(0xfff6c0));
  g.add(body);
  const wheelGeo = cached('wheel', () => { const c = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 8); c.rotateZ(Math.PI / 2); return c; });
  const wheels = [];
  for (const z of [-0.35, 0.35]) for (const x of [-0.22, 0.22]) wheels.push(add(g, new THREE.Mesh(wheelGeo, mat(0x1e1e1e)), x, 0.11, z));
  g.userData.wheels = wheels;
  g.userData.body = body;
  g.scale.setScalar(0.72);
  return g;
}

export function makePlane() {
  const g = new THREE.Group();
  box(g, 0.16, 0.14, 1.0, 0x8a9098, 0, 0, 0);
  box(g, 1.4, 0.03, 0.22, 0x7a8088, 0, 0.02, 0.05);
  box(g, 0.5, 0.03, 0.14, 0x7a8088, 0, 0.04, -0.42);
  box(g, 0.03, 0.22, 0.14, 0x7a8088, 0, 0.1, -0.42);
  box(g, 0.1, 0.06, 0.12, PALETTE.blue, 0.5, 0.04, 0.05);
  box(g, 0.1, 0.06, 0.12, PALETTE.blue, -0.5, 0.04, 0.05);
  return g;
}

export function makeCar(color) {
  const g = new THREE.Group();
  box(g, 0.2, 0.1, 0.36, color, 0, 0.04, 0);
  box(g, 0.18, 0.08, 0.18, PALETTE.glass, 0, 0.14, -0.02);
  return g;
}
