// Visual mirror of sim entities, keyed by id. Reads sim state; never mutates it.
import * as THREE from 'three';
import { BUILDINGS } from '../config/buildings.js';
import { UNITS } from '../config/units.js';
import { DEAD } from '../config/dead.js';
import { HP_COLORS, hpBand } from '../ui/overview.js';
import { BUILDING_MODELS, makeScaffold, makePlate, makeAPC, makeGunship, makeMotorbike, makeBus, PALETTE, partsOf, mergeParts } from './models.js';

const SKIN = [0xe0b48f, 0xc68e66, 0x8d5a3b, 0xf1c9a5, 0xa8714a];
const ZSKIN = [0x8aa37a, 0x7b9070, 0x9aa88a, 0x6f8566, 0x8f9c80];
const CLOTH = [0x9b3b3b, 0x3b5b9b, 0x7a6a4a, 0x4a7a5a, 0xb08a3a, 0x6a4a7a, 0xc8c0b0, 0x3a3a3a, 0x8a5a7a, 0x5a8aa0];
const PANTS = [0x2f3a55, 0x4a4a4a, 0x5a4a3a, 0x2a2a2a, 0x3a4a5a];

// What hovering adds to a model's own glow: a faint wash of the selection colour (stronger washes out the model).
const SELECT_COLOR = 0x7cff8a;
const TOP = new THREE.Box3();
const HOVER_GLOW = new THREE.Color(SELECT_COLOR).multiplyScalar(0.16);
// HP bars and, under the defence overlay, walls: green, amber, red.
const HP_HEX = HP_COLORS.map((c) => new THREE.Color(c));
// Unit rings: over plates (0.02), bridge decks (0.03), the border line (0.035) and most model bases (0.04), and on
// none of their planes.
const RING_Y = 0.045;

// Walls, high walls, gates and minefields come by the dozen in long lines: each type is one InstancedMesh (a gate's
// door a second one, so it can open), not ~10 meshes per tile, each drawn again for the shadow map. Per instance
// the shader mixes in what material clones gave a single model: the defence overlay's HP-band colour (70% of the
// way to it, plus a quarter of it as glow so it reads at night) and the hover glow.
const BATCHED = new Set(['wall', 'highwall', 'gate', 'minefield']);
const batchMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
batchMat.onBeforeCompile = (shader) => {
  shader.vertexShader = 'attribute vec4 iTint;\nattribute vec3 iGlow;\nvarying vec3 vGlow;\n' + shader.vertexShader.replace('#include <color_vertex>', `#include <color_vertex>
    vColor.rgb = mix(vColor.rgb, iTint.rgb, iTint.a);
    vGlow = iGlow;`);
  shader.fragmentShader = 'varying vec3 vGlow;\n' + shader.fragmentShader.replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive + vGlow;');
};
const _m = new THREE.Matrix4(), _door = new THREE.Matrix4(), _glow = new THREE.Color();

// One building type's instances. A view's slot is its index in every mesh; removing one moves the last into its slot.
class Batch {
  constructor(scene, type) {
    this.scene = scene;
    const tpl = BUILDING_MODELS[type]();
    this.ud = tpl.userData;
    this.top = TOP.setFromObject(tpl).max.y;
    const door = tpl.userData.door;
    if (door) tpl.remove(door);
    this.geos = [mergeParts(partsOf(tpl))];
    if (door) this.geos.push(mergeParts(partsOf(door)));
    this.views = [];
    this.meshes = [];
    this.grow(32);
  }

  grow(cap) {
    const old = this.meshes;
    this.meshes = this.geos.map((src) => {
      const g = src.clone();
      g.setAttribute('iTint', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
      g.setAttribute('iGlow', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
      const m = new THREE.InstancedMesh(g, batchMat, cap);
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
      return m;
    });
    this.cap = cap;
    for (let k = 0; k < this.views.length; k++) this.write(k);
    this.count();
    for (const m of old) { this.scene.remove(m); m.geometry.dispose(); m.dispose(); }
  }

  count() { for (const m of this.meshes) { m.count = this.views.length; m.boundingSphere = null; } }

  add(v) {
    if (this.views.length === this.cap) this.grow(this.cap * 2);
    v.slot = this.views.length;
    this.views.push(v);
    this.write(v.slot);
    this.count();
  }

  remove(v) {
    const last = this.views.pop();
    if (last !== v) { this.views[v.slot] = last; last.slot = v.slot; this.write(last.slot); }
    v.slot = -1;
    this.count();
  }

  // A view's placement (built height sy, door height doorY), HP band and hover into its slot.
  write(k) {
    const v = this.views[k];
    // Trim bands overhang the tile, so neighbours in a line overlap there in the same planes, which fight when their
    // tints differ (HP bands, hover): every other tile is drawn 0.1% larger, off its neighbours' planes.
    const g = Math.floor(v.x + v.z) & 1 ? 1.001 : 1;
    _m.makeScale(g, v.sy * g, g).setPosition(v.x, 0, v.z);
    this.meshes[0].setMatrixAt(k, _m);
    if (this.meshes[1]) this.meshes[1].setMatrixAt(k, _door.makeTranslation(0, v.doorY, 0).premultiply(_m));
    const tint = v.band >= 0 ? HP_HEX[v.band] : null;
    _glow.setRGB(0, 0, 0);
    if (tint) _glow.copy(tint).multiplyScalar(0.25);
    if (v.hot) _glow.add(HOVER_GLOW);
    for (const m of this.meshes) {
      const t = m.geometry.attributes.iTint, gl = m.geometry.attributes.iGlow;
      if (tint) t.setXYZW(k, tint.r, tint.g, tint.b, 0.7); else t.setXYZW(k, 0, 0, 0, 0);
      gl.setXYZ(k, _glow.r, _glow.g, _glow.b);
      t.needsUpdate = gl.needsUpdate = m.instanceMatrix.needsUpdate = true;
      m.boundingSphere = null;
    }
  }

  // Frees the instance buffers at once; View.newScene also disposes every InstancedMesh, and a second call is a no-op.
  dispose() { for (const m of this.meshes) m.dispose(); }
}

const SQUAD_SLOTS = {
  3: [[0, 0.22], [-0.24, -0.16], [0.24, -0.16]],
  2: [[-0.16, 0], [0.16, 0]],
};

function hashPick(seed, arr, salt) {
  let h = (seed ^ (salt * 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  return arr[h % arr.length];
}

function dim(hex, f) {
  const c = new THREE.Color(hex);
  return c.multiplyScalar(f).getHex();
}

function deadLook(type, look, soldier) {
  const f = {
    kind: type, skin: hashPick(look, ZSKIN, 1), shirt: dim(hashPick(look, CLOTH, 2), 0.6), pants: dim(hashPick(look, PANTS, 3), 0.8),
    helmet: soldier, helmetColor: 0x3f4d2a, pack: !soldier && (look & 7) === 0, packColor: 0x4a3f30, limp: (look & 15) === 3,
    scale: DEAD[type].scale, bulk: type === 'brute' ? 1.45 : type === 'runner' ? 0.85 : 1,
  };
  if (soldier) f.shirt = dim(PALETTE.olive, 0.7);
  if (type === 'runner') { f.skin = 0xa8a08a; f.shirt = dim(f.shirt, 1.2); }
  if (type === 'brute') { f.skin = 0x7a8a68; f.shirt = 0x4a4038; f.pants = 0x3a342e; }
  if (type === 'howler') { f.skin = 0xc8c8b8; f.shirt = 0x5a5a5a; }
  if (type === 'drowned') { f.skin = 0x6a8a8a; f.shirt = 0x3a5a6a; f.pants = 0x2a3a44; }
  return f;
}

// Figure k of a squad. MG and mortar teams: the first carries the weapon (set down in front of him when the team
// stops), the second its ammunition. Medics: white helmets, armbands and bags, each with a red cross.
function unitLook(type, seed, k) {
  const skin = hashPick(seed, SKIN, 4);
  const base = { skin, band: true, bandColor: PALETTE.gold, helmet: true, gun: true };
  switch (type) {
    case 'police': return { ...base, kind: 'soldier', shirt: 0x1e2c4a, pants: 0x1a2236, helmetColor: 0x1a2a4a, gunLen: 0.55, gunColor: 0x222222, shield: true };
    case 'hazmat': return { ...base, kind: 'soldier', skin: 0xe2dcc0, shirt: 0xd9c234, pants: 0xd9c234, helmetColor: 0xf2f2f2, pack: true, packColor: 0xdedede, gunLen: 0.85, gunColor: 0x555555 };
    case 'engineers': return { ...base, kind: 'soldier', shirt: 0xd87820, pants: 0x3a3a3a, helmetColor: 0xf0d020, pack: true, packColor: 0x7a6a3a, gunLen: 0.8 };
    case 'sniper': return { ...base, kind: 'soldier', shirt: 0x5a5a3a, pants: 0x4a4a32, helmetColor: 0x4a4a30, gunLen: 1.55 };
    case 'mg': return { ...base, kind: 'soldier', shirt: 0x4b5a34, pants: 0x3a4428, helmetColor: 0x37422a, ...(k ? { pack: true, packColor: 0x4a5a32, gunLen: 0.8 } : { prop: 'tripod', gunLen: 1.35, gunColor: 0x141414 }) };
    case 'mortar': return { ...base, kind: 'soldier', shirt: 0x6a6440, pants: 0x4c4832, helmetColor: 0x4a4a30, pack: true, gunLen: 0.8, ...(k ? { packColor: 0x6a5a3a } : { prop: 'tube', packColor: 0x3d4828 }) };
    case 'medic': return { ...base, kind: 'soldier', shirt: PALETTE.olive, pants: PALETTE.olive2, helmetColor: 0xeeeeea, bandColor: 0xf4f4f0, pack: true, packColor: 0xe6e4dc, cross: true, gunLen: 0.45 };
    default: return { ...base, kind: 'soldier', shirt: PALETTE.olive, pants: PALETTE.olive2, helmetColor: 0x3f4d2a, gunLen: 1 };
  }
}

// Vehicle units' models by type; any other vehicle is an APC.
const VEHICLE_MODELS = { gunship: makeGunship, scout: makeMotorbike, apc: makeAPC };

export class Entities {
  constructor(scene, sim, terrain) {
    this.scene = scene;
    this.sim = sim;
    this.terrain = terrain;
    this.buildings = new Map();
    this.units = new Map();
    this.vehicles = new Map();
    this.dead = new Map();
    this.refugees = new Map();
    this.corpses = [];
    this.deadFigs = []; this.refFigs = []; this.unitFigs = [];
    this.screams = new Map();
    this.sirens = new Map();
    this.selected = new Set();
    this.selBuilding = null;
    this.stamp = 0; // bumped each sync; what is met that frame carries it, and what does not is dropped
    this.lists = [this.unitFigs, this.deadFigs, this.refFigs, this.corpses, null];
    const rg = new THREE.RingGeometry(0.42, 0.5, 20); rg.rotateX(-Math.PI / 2);
    this.ringGeo = rg;
    this.ringMat = new THREE.MeshBasicMaterial({ color: SELECT_COLOR, transparent: true, opacity: 0.9, depthWrite: false });
    this.rings = [];
    this.hoverKind = null; this.hoverId = null;
    this.hot = { objs: [], swaps: [], clones: [], inst: null };
    this.wallTint = false;
    this.batches = new Map(); // building type → its Batch, made when the first one is placed
    this.hoverRing = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: SELECT_COLOR, transparent: true, opacity: 0.45, depthWrite: false }));
    this.hoverRing.visible = false;
    scene.add(this.hoverRing);
    this.barGeo = new THREE.PlaneGeometry(1, 0.09);
    const sq = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 0.02, 1));
    this.selBox = new THREE.LineSegments(sq, new THREE.LineBasicMaterial({ color: SELECT_COLOR }));
    this.selBox.visible = false;
    scene.add(this.selBox);
    for (const b of sim.state.ents.buildings) for (let dj = 0; dj < b.size; dj++) for (let di = 0; di < b.size; di++) terrain.clearTrees((b.j + dj) * sim.N + b.i + di);
  }

  makeBar(width) {
    const g = new THREE.Group();
    const bg = new THREE.Mesh(this.barGeo, new THREE.MeshBasicMaterial({ color: 0x111111, depthTest: false }));
    const fg = new THREE.Mesh(this.barGeo, new THREE.MeshBasicMaterial({ color: 0x5ee05e, depthTest: false }));
    bg.scale.x = width; fg.scale.x = width;
    fg.position.z = 0.001;
    bg.renderOrder = 998; fg.renderOrder = 999;
    g.add(bg, fg);
    g.userData = { fg, width };
    g.visible = false;
    this.scene.add(g);
    return g;
  }

  setBar(bar, frac, show, x, y, z, camQ) {
    bar.visible = show;
    if (!show) return;
    bar.position.set(x, y, z);
    bar.quaternion.copy(camQ);
    const { fg, width } = bar.userData;
    fg.scale.x = Math.max(0.001, frac) * width;
    fg.position.x = -(1 - frac) * width / 2;
    fg.material.color.copy(HP_HEX[hpBand(frac)]);
  }

  buildingPos(id) { const b = this.sim.byId(id); return b ? { x: b.x, z: b.z } : null; }

  // Shots from squads come from one of the squad's figures.
  muzzleFor(e) {
    if (!e.shooter) return null;
    const u = this.units.get(e.shooter);
    if (u && u.figs.length) {
      // A machine gun set down on its tripod fires from its barrel.
      const gun = u.figs.find((f) => f.prop === 'tripod' && f.deployed && !f.hidden);
      if (gun) return { x: gun.x + Math.sin(gun.rot) * 0.56, y: 0.215, z: gun.z + Math.cos(gun.rot) * 0.56 };
      const alive = u.figs.filter((f) => !f.hidden);
      const f = alive[(u.shot = (u.shot || 0) + 1) % Math.max(1, alive.length)];
      if (f) return { x: f.x + Math.sin(f.rot) * 0.2, y: 0.42, z: f.z + Math.cos(f.rot) * 0.2 };
    }
    const b = this.buildings.get(e.shooter);
    if (b && b.ud.muzzle) {
      const m = b.ud.muzzle;
      return { x: b.g.position.x + m.x, y: m.y, z: b.g.position.z + m.z };
    }
    return null;
  }

  onEvents(events, fx) {
    for (const e of events) {
      if (e.type === 'death' && e.kind === 'dead') {
        const v = this.dead.get(e.id);
        const look = v ? { ...v } : { ...deadLook(e.dtype || 'walker', e.look || 1, e.soldier), x: e.x, z: e.z, rot: e.rot || 0 };
        look.x = e.x; look.z = e.z; look.y = Math.max(0, e.y || 0);
        look.dying = 0.001; look.moving = false; look.scream = 0; look.climb = false; look.recolor = true;
        look.fallDir = Math.random() < 0.5 ? 1 : -1;
        this.corpses.push(look);
        if (this.corpses.length > 260) this.corpses.shift();
      } else if (e.type === 'death' && e.kind === 'refugee') {
        const v = this.refugees.get(e.id);
        if (v) { const c = { ...v, dying: 0.001, moving: false, recolor: true, hidden: false }; this.corpses.push(c); }
      } else if (e.type === 'scream') this.screams.set(e.id, 1.2);
      else if (e.type === 'siren') this.sirens.set(e.id, 2);
      else if (e.type === 'placed') {
        const b = this.sim.byId(e.id);
        if (b) for (let dj = 0; dj < b.size; dj++) for (let di = 0; di < b.size; di++) this.terrain.clearTrees((b.j + dj) * this.sim.N + b.i + di);
      } else if (e.type === 'destroyed') {
        fx.decal(e.x, e.z, 0x3a3630, e.size > 1 ? 2 : 1.1);
      }
    }
  }

  sync(rdt, vdt, time, nightF, camQ) {
    const sim = this.sim, s = sim.state;
    this.stamp++;
    this.syncBuildings(s, vdt, time, nightF, camQ);
    this.syncUnits(s, vdt, time, nightF, camQ);
    this.syncHover();
    this.syncVehicles(s, vdt);
    this.syncDead(s, vdt);
    this.syncRefugees(s, vdt);
    for (const c of this.corpses) c.dying += vdt;
    while (this.corpses.length && this.corpses[0].dying > 26) this.corpses.shift();
    for (const [id, t] of this.screams) { if (t - vdt <= 0) this.screams.delete(id); else this.screams.set(id, t - vdt); }
    for (const [id, t] of this.sirens) { if (t - vdt <= 0) this.sirens.delete(id); else this.sirens.set(id, t - vdt); }
  }

  syncBuildings(s, dt, time, nightF, camQ) {
    const st = this.stamp;
    let met = 0;
    for (const b of s.ents.buildings) {
      let v = this.buildings.get(b.id);
      if (!v || v.type !== b.type) {
        if (v) this.dropBuilding(v);
        v = this.makeView(b);
        this.buildings.set(b.id, v);
      }
      v.met = st; met++;
      const g = v.g;
      let dirty = false; // a batched view's slot needs writing
      if (!b.built) {
        if (!v.scaffold) { v.scaffold = makeScaffold(b.size); v.scaffold.position.set(b.x, 0, b.z); this.scene.add(v.scaffold); v.scaffTop = TOP.setFromObject(v.scaffold).max.y; }
        if (v.scaffold.userData.crane) v.scaffold.userData.crane.rotation.y = time * 0.6;
      } else if (v.scaffold) { this.scene.remove(v.scaffold); v.scaffold = null; }
      const sy = b.built ? 1 : 0.06 + 0.94 * b.progress;
      if (g) g.scale.y = sy;
      else if (v.sy !== sy) { v.sy = sy; dirty = true; }
      const ud = v.ud;
      if (ud.flags) for (const f of ud.flags) f.rotation.y = Math.sin(time * 2.4 + v.phase) * 0.35;
      if (ud.spin) ud.spin.rotation.y = time * 1.6;
      if (ud.dish) ud.dish.rotation.y = Math.sin(time * 0.3 + v.phase) * 0.8;
      if (ud.lamp) { ud.lamp.rotation.y = nightF > 0.3 ? Math.sin(time * 0.8 + v.phase) * 1.2 : 0; }
      if (ud.head) ud.head.rotation.y = Math.sin(time * 0.4 + v.phase) * 0.5;
      if (ud.speaker) ud.speaker.rotation.y += dt * (this.sirens.has(b.id) ? 8 : 0.3);
      if (ud.siren) ud.siren.material.color.setHex(Math.sin(time * 10) > 0 ? 0xff2020 : 0x2040ff);
      if (ud.tractor && b.built) { ud.tractor.position.z = 0.3 + Math.sin(time * 0.5 + v.phase) * 0.45; ud.tractor.rotation.y = Math.cos(time * 0.5 + v.phase) > 0 ? 0 : Math.PI; }
      if (ud.barrels && b.target) for (const br of ud.barrels) br.rotation.x = -0.6 - Math.max(0, Math.sin(time * 3)) * 0.05;
      if (ud.door || ud.boom) {
        let open = false;
        this.sim.liveHash.query(b.x, b.z, 1.4, () => { open = true; });
        // Doors belong to gates, which are batched: the door's height is the view's, snapped once it is there.
        if (ud.door) {
          const to = open ? 0.9 : 0;
          let y = v.doorY + (to - v.doorY) * Math.min(1, dt * 6);
          if (Math.abs(to - y) < 0.002) y = to;
          if (y !== v.doorY) { v.doorY = y; dirty = true; }
        }
        if (ud.boom) ud.boom.rotation.z += ((open ? 1.2 : 0) - ud.boom.rotation.z) * Math.min(1, dt * 6);
      }
      if (b.built && b.hp < b.maxHp * 0.5 && Math.random() < dt * (b.hp < b.maxHp * 0.25 ? 10 : 3)) {
        this.fx.smoke(b.x + (Math.random() - 0.5) * b.size * 0.6, 0.8, b.z + (Math.random() - 0.5) * b.size * 0.6, true);
        if (b.hp < b.maxHp * 0.25) this.fx.fire(b.x, 0.5, b.z, b.size * 0.5);
      }
      if (ud.smoke && b.built && !b.idle && Math.random() < dt * (ud.smokeSoft ? 1.5 : 3)) {
        const p = ud.smoke[Math.floor(Math.random() * ud.smoke.length)];
        this.fx.smoke(b.x + p.x, p.y, b.z + p.z, false, ud.smokeSoft ? 0.6 : 1);
      }
      // Under the defence overlay a wall wears its HP band's colour.
      if (BUILDINGS[b.type].wall) {
        const band = this.wallTint ? hpBand(b.hp / b.maxHp) : -1;
        if (band !== v.band) { v.band = band; dirty = true; }
      }
      if (dirty) v.batch.write(v.slot);
      const h = this.barY(b);
      this.setBar(v.bar, b.hp / b.maxHp, b.hp < b.maxHp - 0.5 || this.selBuilding === b.id, b.x, h, b.z, camQ);
    }
    if (met !== this.buildings.size) for (const [id, v] of this.buildings) if (v.met !== st) { this.dropBuilding(v); this.buildings.delete(id); }
    const sb = this.selBuilding ? this.sim.byId(this.selBuilding) : null;
    this.selBox.visible = !!sb;
    if (sb) { this.selBox.position.set(sb.x, 0.05, sb.z); this.selBox.scale.set(sb.size + 0.15, 1, sb.size + 0.15); }
  }

  // A building's view: its own model, or a slot in its type's batch (no model; userData and top from the batch's).
  makeView(b) {
    // Wall lines, gates and minefields go without plates: a plate per tile of a line would read as noise.
    const v = { g: null, batch: null, slot: -1, ud: null, type: b.type, scaffold: null, plate: null, bar: this.makeBar(b.size === 2 ? 1.2 : 0.8), phase: Math.random() * 6, top: 0, band: -1, met: 0 };
    if (BATCHED.has(b.type)) {
      let batch = this.batches.get(b.type);
      if (!batch) this.batches.set(b.type, (batch = new Batch(this.scene, b.type)));
      Object.assign(v, { batch, ud: batch.ud, top: batch.top, x: b.x, z: b.z, sy: 1, doorY: 0, hot: false });
      batch.add(v);
      return v;
    }
    v.g = BUILDING_MODELS[b.type]();
    v.g.position.set(b.x, 0, b.z);
    this.scene.add(v.g);
    v.ud = v.g.userData;
    v.top = TOP.setFromObject(v.g).max.y;
    v.plate = makePlate(b.size);
    v.plate.position.set(b.x, 0, b.z);
    this.scene.add(v.plate);
    return v;
  }

  // The hover clones and the batches' instance buffers; their geometries go with the scene.
  dispose() {
    this.unlight();
    for (const batch of this.batches.values()) batch.dispose();
  }

  // Height of a building's HP bar.
  barY(b) {
    const ud = this.buildings.get(b.id)?.ud || {};
    return (BUILDINGS[b.type].wall ? (ud.height || 1) : b.type === 'tower' ? 2.5 : 1.4) + 0.25;
  }

  // Highest point of what is drawn for a building now: the model as far as it is built, or the crane over a site.
  topOf(b) {
    const v = this.buildings.get(b.id);
    if (!v) return 0;
    return b.built ? v.top : Math.max(v.scaffTop || 0, v.top * (0.06 + 0.94 * b.progress));
  }

  dropBuilding(v) {
    if (v.batch) {
      if (this.hot.inst === v) this.unlight();
      v.batch.remove(v);
    } else this.scene.remove(v.g);
    this.scene.remove(v.bar);
    if (v.scaffold) this.scene.remove(v.scaffold);
    if (v.plate) this.scene.remove(v.plate);
  }

  // The building or unit under the cursor (kind 'building' | 'unit' | null) glows in the selection colour at half
  // strength (a batched building through its slot); squads, drawn as shared instanced figures, get a half-strength
  // ring under them instead.
  setHover(kind, id) { this.hoverKind = kind || null; this.hoverId = kind ? id : null; }

  // Re-lights whenever the hovered model changes: another target, a model rebuilt by an upgrade, a scaffold
  // coming or going, or the thing gone.
  syncHover() {
    const kind = this.hoverKind, id = this.hoverId, hot = this.hot;
    let objs = [], inst = null;
    if (kind === 'building') {
      const v = this.buildings.get(id);
      if (v) { if (v.batch) inst = v; else objs.push(v.g); if (v.scaffold) objs.push(v.scaffold); }
    } else if (kind === 'unit') { const v = this.units.get(id); if (v?.mesh) objs = [v.mesh]; }
    if (inst !== hot.inst || objs.length !== hot.objs.length || objs.some((o, k) => o !== hot.objs[k])) {
      this.unlight();
      for (const o of objs) this.light(o);
      hot.objs = objs;
      if (inst) { inst.hot = true; inst.batch.write(inst.slot); hot.inst = inst; }
    }
    const u = kind === 'unit' ? this.sim.byId(id) : null;
    this.hoverRing.visible = !!u;
    if (u) {
      const rs = u.type === 'gunship' ? 1.7 : u.type === 'apc' ? 1.3 : 1;
      this.hoverRing.scale.set(rs, 1, rs);
      this.hoverRing.position.set(u.x, RING_Y, u.z);
    }
  }

  // Lit meshes get their own clones of their materials; the shared palette materials are never touched, and
  // unlight puts the originals back.
  light(obj) {
    const hot = this.hot, clones = new Map();
    obj.traverse((o) => {
      const m = o.material;
      if (!o.isMesh || !m?.emissive) return;
      let c = clones.get(m);
      if (!c) {
        c = m.clone();
        c.emissive.copy(m.emissive).multiplyScalar(m.emissiveIntensity).add(HOVER_GLOW);
        c.emissiveIntensity = 1;
        clones.set(m, c);
        hot.clones.push(c);
      }
      hot.swaps.push([o, m]);
      o.material = c;
    });
  }

  unlight() {
    const hot = this.hot;
    for (const [o, m] of hot.swaps) o.material = m;
    for (const c of hot.clones) c.dispose();
    if (hot.inst) { hot.inst.hot = false; hot.inst.batch.write(hot.inst.slot); }
    hot.objs = []; hot.swaps = []; hot.clones = []; hot.inst = null;
  }

  syncUnits(s, dt, time, nightF, camQ) {
    const st = this.stamp;
    let met = 0;
    this.unitFigs.length = 0;
    let ri = 0;
    for (const u of s.ents.units) {
      const def = UNITS[u.type];
      let v = this.units.get(u.id);
      if (!v) {
        v = { figs: [], mesh: null, bar: this.makeBar(0.7), chev: [], met: 0 };
        if (def.figs) {
          for (let k = 0; k < def.figs; k++) v.figs.push({ ...unitLook(u.type, u.id * 7 + k, k), x: u.x, y: 0, z: u.z, rot: u.rot, phase: Math.random() * 6, moving: false });
        } else {
          v.mesh = (VEHICLE_MODELS[u.type] || makeAPC)();
          this.scene.add(v.mesh);
        }
        for (let c = 0; c < 2; c++) {
          const ch = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.05), new THREE.MeshBasicMaterial({ color: PALETTE.gold, depthTest: false }));
          ch.renderOrder = 999; ch.visible = false;
          this.scene.add(ch);
          v.chev.push(ch);
        }
        this.units.set(u.id, v);
      }
      v.met = st; met++;
      const target = u.target ? this.sim.byId(u.target) : null;
      if (def.figs) {
        const slots = SQUAD_SLOTS[def.figs];
        const alive = Math.ceil((u.hp / u.maxHp) * def.figs);
        const cs = Math.cos(u.rot), sn = Math.sin(u.rot);
        for (let k = 0; k < v.figs.length; k++) {
          const f = v.figs[k];
          if (k >= alive) {
            if (!f.hidden) { f.hidden = true; this.corpses.push({ ...f, dying: 0.001, moving: false, recolor: true, hidden: false, aim: false }); }
            continue;
          }
          f.hidden = false;
          const ox = slots[k][0], oz = slots[k][1];
          const sx = u.x + ox * cs + oz * sn, sz = u.z - ox * sn + oz * cs;
          const dx = sx - f.x, dz = sz - f.z, d = Math.hypot(dx, dz);
          const step = def.speed * 1.4 * dt;
          if (d > step) { f.x += (dx / d) * step; f.z += (dz / d) * step; } else { f.x = sx; f.z = sz; }
          f.moving = u.moving || d > 0.05;
          if (f.moving) f.phase += dt * 11;
          f.aim = !!target && !u.moving;
          f.rot = target ? Math.atan2(target.x - f.x, target.z - f.z) : f.moving ? u.rot : f.rot;
          // The crew weapon goes down in front of its gunner once the team stands still, and he kneels at it once
          // it is ready (an MG team set up, a mortar at once); the machine gun leaves his hands for its tripod.
          if (f.prop) {
            f.deployed = !f.moving;
            f.kneel = f.deployed && (!def.setup || u.setup >= def.setup);
            f.gun = !(f.deployed && f.prop === 'tripod');
            if (!f.moving && !target) f.rot = u.rot;
          }
          this.unitFigs.push(f);
        }
      } else {
        const g = v.mesh, ud = g.userData;
        g.position.set(u.x, u.air ? u.alt + Math.sin(time * 2 + u.id) * 0.1 : 0, u.z);
        g.rotation.y = u.rot;
        if (ud.wheels && u.moving) for (const w of ud.wheels) w.rotation.x += dt * 8;
        if (ud.turret && target) ud.turret.rotation.y = Math.atan2(target.x - u.x, target.z - u.z) - u.rot;
        if (ud.rotor) { ud.rotor.rotation.y += dt * 30; ud.tail.rotation.x += dt * 40; ud.body.rotation.x = u.moving ? 0.18 : 0; }
        if (ud.rider) ud.rider.rotation.x = u.moving ? 0.12 : 0;
        if (ud.spot) ud.spot.visible = nightF > 0.3;
      }
      const sel = this.selected.has(u.id);
      if (sel) {
        let ring = this.rings[ri];
        if (!ring) { ring = new THREE.Mesh(this.ringGeo, this.ringMat); this.scene.add(ring); this.rings.push(ring); }
        ring.visible = true;
        const rs = u.type === 'gunship' ? 1.7 : u.type === 'apc' ? 1.3 : 1;
        ring.scale.set(rs, 1, rs);
        ring.position.set(u.x, RING_Y, u.z);
        ri++;
      }
      const top = (u.air ? u.alt : 0) + (u.type === 'gunship' ? 0.6 : 0.95);
      this.setBar(v.bar, u.hp / u.maxHp, sel || u.hp < u.maxHp - 0.5, u.x, top, u.z, camQ);
      for (let c = 0; c < v.chev.length; c++) {
        const ch = v.chev[c];
        ch.visible = u.vet > c;
        if (ch.visible) { ch.position.set(u.x, top + 0.12 + c * 0.07, u.z); ch.quaternion.copy(camQ); }
      }
    }
    for (let k = ri; k < this.rings.length; k++) this.rings[k].visible = false;
    if (met !== this.units.size) for (const [id, v] of this.units) if (v.met !== st) {
      if (v.mesh) this.scene.remove(v.mesh);
      this.scene.remove(v.bar);
      for (const ch of v.chev) this.scene.remove(ch);
      this.units.delete(id);
    }
  }

  syncVehicles(s, dt) {
    const st = this.stamp;
    for (const veh of s.ents.vehicles) {
      let v = this.vehicles.get(veh.id);
      if (!v) { v = { g: makeBus(), met: 0 }; this.scene.add(v.g); this.vehicles.set(veh.id, v); }
      v.met = st;
      v.g.position.set(veh.x, 0, veh.z);
      v.g.rotation.y = veh.rot;
      if (veh.moving) for (const w of v.g.userData.wheels) w.rotation.x += dt * 10;
    }
    for (const [id, v] of this.vehicles) if (v.met !== st) { this.scene.remove(v.g); this.vehicles.delete(id); }
  }

  syncDead(s, dt) {
    const sim = this.sim, st = this.stamp;
    let met = 0;
    this.deadFigs.length = 0;
    for (const z of s.ents.dead) {
      if (z.gone) continue;
      let f = this.dead.get(z.id);
      if (!f) { f = { ...deadLook(z.type, z.look, z.soldier), x: z.x, z: z.z, rot: z.rot, phase: (z.look % 100) / 16 }; this.dead.set(z.id, f); }
      f.met = st; met++;
      f.x = z.x; f.z = z.z; f.rot = z.rot;
      f.moving = z.moving;
      f.rising = z.rise;
      f.climb = z.stack > 0;
      const wall = z.stack > 0 && z.wall > 0 ? this.buildings.get(z.wall) : null;
      const wallH = wall ? (wall.ud.height || 1) : 1;
      const targetY = z.drop > 0 ? z.drop * wallH : z.stack > 0 ? z.stack * wallH * 0.85 : z.y;
      f.y = (f.y ?? 0) + (targetY - (f.y ?? 0)) * Math.min(1, dt * 8);
      f.scream = this.screams.get(z.id) || 0;
      const sp = DEAD[z.type].speed[1];
      if (f.moving || f.climb) f.phase += dt * sp * (z.type === 'runner' ? 4 : 7);
      else if (z.state === 'attack') f.phase += dt * 5;
      f.hidden = !sim.visible(z.x, z.z);
      this.deadFigs.push(f);
    }
    if (met !== this.dead.size) for (const [id, f] of this.dead) if (f.met !== st) this.dead.delete(id);
  }

  syncRefugees(s, dt) {
    const sim = this.sim, st = this.stamp;
    let met = 0;
    this.refFigs.length = 0;
    for (const r of s.ents.refugees) {
      let f = this.refugees.get(r.id);
      if (!f) {
        f = { kind: 'civ', skin: hashPick(r.look, SKIN, 5), shirt: hashPick(r.look, CLOTH, 6), pants: hashPick(r.look, PANTS, 7), pack: (r.look & 3) !== 0, packColor: hashPick(r.look, [0x6a5a3a, 0x3a4a6a, 0x7a2a2a, 0x4a6a3a], 8), phase: (r.look % 100) / 16, scale: (r.look & 7) === 0 ? 0.72 : 1 };
        this.refugees.set(r.id, f);
      }
      f.met = st; met++;
      f.x = r.x; f.z = r.z; f.rot = r.rot; f.y = 0;
      f.moving = r.moving;
      if (f.moving) f.phase += dt * 8;
      f.hidden = !!r.camp || !sim.visible(r.x, r.z);
      this.refFigs.push(f);
    }
    if (met !== this.refugees.size) for (const [id, f] of this.refugees) if (f.met !== st) this.refugees.delete(id);
  }

  // The crowd's lists, in one array kept from frame to frame; `extra` is one more list (the towns' civilians).
  figureLists(extra = []) { this.lists[4] = extra; return this.lists; }
}
