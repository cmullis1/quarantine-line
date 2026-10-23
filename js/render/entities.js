// Visual mirror of sim entities, keyed by id. Reads sim state; never mutates it.
import * as THREE from 'three';
import { BUILDINGS } from '../config/buildings.js';
import { UNITS } from '../config/units.js';
import { DEAD } from '../config/dead.js';
import { HP_COLORS, hpBand } from '../ui/overview.js';
import { BUILDING_MODELS, makeScaffold, makePlate, makeAPC, makeGunship, makeMotorbike, makeBus, PALETTE } from './models.js';

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
const TINT_GLOW = new THREE.Color();

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
    const rg = new THREE.RingGeometry(0.42, 0.5, 20); rg.rotateX(-Math.PI / 2);
    this.ringGeo = rg;
    this.ringMat = new THREE.MeshBasicMaterial({ color: SELECT_COLOR, transparent: true, opacity: 0.9, depthWrite: false });
    this.rings = [];
    this.hoverKind = null; this.hoverId = null;
    this.hot = { objs: [], swaps: [], clones: [] };
    this.wallTint = false;
    this.tints = new Map(); // palette material → its clone per HP band, while walls wear them
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

  // Under the defence overlay a wall wears its HP band's colour: clones of its materials, one per material and band,
  // shared by every wall in that band. The palette materials are never touched, and each mesh gets its own back.
  tintWall(b, v) {
    const band = this.wallTint ? hpBand(b.hp / b.maxHp) : -1;
    if (v.band === band) return;
    // The hover glow is cloned from what the wall wore: take it off first, and syncHover relights the new materials.
    if (this.hot.objs.includes(v.g)) this.unlight();
    for (const [o, m] of v.tinted) o.material = m;
    v.tinted = [];
    if (band >= 0) v.g.traverse((o) => {
      if (!o.isMesh || !o.material?.color) return;
      v.tinted.push([o, o.material]);
      o.material = this.tintMat(o.material, band);
    });
    v.band = band;
  }

  tintMat(m, band) {
    let row = this.tints.get(m);
    if (!row) this.tints.set(m, (row = []));
    if (!row[band]) {
      const c = m.clone(), col = HP_HEX[band];
      c.color.lerp(col, 0.7);
      // A little of the band's own light, so the colour still reads at night.
      if (c.emissive) { c.emissive.copy(m.emissive).multiplyScalar(m.emissiveIntensity).add(TINT_GLOW.copy(col).multiplyScalar(0.25)); c.emissiveIntensity = 1; }
      row[band] = c;
    }
    return row[band];
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
    if (b && b.g.userData.muzzle) {
      const m = b.g.userData.muzzle;
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
    const seen = new Set();
    for (const b of s.ents.buildings) {
      seen.add(b.id);
      let v = this.buildings.get(b.id);
      if (!v || v.type !== b.type) {
        if (v) this.dropBuilding(v);
        const g = BUILDING_MODELS[b.type]();
        g.position.set(b.x, 0, b.z);
        this.scene.add(g);
        // Wall lines, gates and minefields go without: a plate per tile of a line would read as noise.
        const plate = BUILDINGS[b.type].wall || b.type === 'minefield' ? null : makePlate(b.size);
        if (plate) { plate.position.set(b.x, 0, b.z); this.scene.add(plate); }
        v = { g, type: b.type, scaffold: null, plate, bar: this.makeBar(b.size === 2 ? 1.2 : 0.8), phase: Math.random() * 6, top: TOP.setFromObject(g).max.y, band: -1, tinted: [] };
        this.buildings.set(b.id, v);
      }
      const g = v.g;
      if (!b.built) {
        if (!v.scaffold) { v.scaffold = makeScaffold(b.size); v.scaffold.position.set(b.x, 0, b.z); this.scene.add(v.scaffold); v.scaffTop = TOP.setFromObject(v.scaffold).max.y; }
        g.scale.y = 0.06 + 0.94 * b.progress;
        if (v.scaffold.userData.crane) v.scaffold.userData.crane.rotation.y = time * 0.6;
      } else {
        if (v.scaffold) { this.scene.remove(v.scaffold); v.scaffold = null; }
        g.scale.y = 1;
      }
      const ud = g.userData;
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
        if (ud.door) ud.door.position.y += ((open ? 0.9 : 0) - ud.door.position.y) * Math.min(1, dt * 6);
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
      if (BUILDINGS[b.type].wall) this.tintWall(b, v);
      const h = this.barY(b);
      this.setBar(v.bar, b.hp / b.maxHp, b.hp < b.maxHp - 0.5 || this.selBuilding === b.id, b.x, h, b.z, camQ);
    }
    for (const [id, v] of this.buildings) if (!seen.has(id)) { this.dropBuilding(v); this.buildings.delete(id); }
    // Every wall has its own materials back: the band clones can go.
    if (!this.wallTint && this.tints.size) {
      for (const row of this.tints.values()) for (const c of row) c?.dispose();
      this.tints.clear();
    }
    const sb = this.selBuilding ? this.sim.byId(this.selBuilding) : null;
    this.selBox.visible = !!sb;
    if (sb) { this.selBox.position.set(sb.x, 0.05, sb.z); this.selBox.scale.set(sb.size + 0.15, 1, sb.size + 0.15); }
  }

  disposeTints() {
    for (const row of this.tints.values()) for (const c of row) c?.dispose();
    this.tints.clear();
  }

  // Height of a building's HP bar.
  barY(b) {
    const ud = this.buildings.get(b.id)?.g.userData || {};
    return (BUILDINGS[b.type].wall ? (ud.height || 1) : b.type === 'tower' ? 2.5 : 1.4) + 0.25;
  }

  // Highest point of what is drawn for a building now: the model as far as it is built, or the crane over a site.
  topOf(b) {
    const v = this.buildings.get(b.id);
    if (!v) return 0;
    return b.built ? v.top : Math.max(v.scaffTop || 0, v.top * (0.06 + 0.94 * b.progress));
  }

  dropBuilding(v) {
    this.scene.remove(v.g); this.scene.remove(v.bar);
    if (v.scaffold) this.scene.remove(v.scaffold);
    if (v.plate) this.scene.remove(v.plate);
  }

  // The building or unit under the cursor (kind 'building' | 'unit' | null) glows in the selection colour at half
  // strength; squads, drawn as shared instanced figures, get a half-strength ring under them instead.
  setHover(kind, id) { this.hoverKind = kind || null; this.hoverId = kind ? id : null; }

  // Re-lights whenever the hovered model changes: another target, a model rebuilt by an upgrade, a scaffold
  // coming or going, or the thing gone.
  syncHover() {
    const kind = this.hoverKind, id = this.hoverId, hot = this.hot;
    let objs = [];
    if (kind === 'building') { const v = this.buildings.get(id); if (v) objs = v.scaffold ? [v.g, v.scaffold] : [v.g]; }
    else if (kind === 'unit') { const v = this.units.get(id); if (v?.mesh) objs = [v.mesh]; }
    if (objs.length !== hot.objs.length || objs.some((o, k) => o !== hot.objs[k])) {
      this.unlight();
      for (const o of objs) this.light(o);
      hot.objs = objs;
    }
    const u = kind === 'unit' ? this.sim.byId(id) : null;
    this.hoverRing.visible = !!u;
    if (u) {
      const rs = u.type === 'gunship' ? 1.7 : u.type === 'apc' ? 1.3 : 1;
      this.hoverRing.scale.set(rs, 1, rs);
      this.hoverRing.position.set(u.x, 0.03, u.z);
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
    hot.objs = []; hot.swaps = []; hot.clones = [];
  }

  syncUnits(s, dt, time, nightF, camQ) {
    const seen = new Set();
    this.unitFigs.length = 0;
    let ri = 0;
    for (const u of s.ents.units) {
      seen.add(u.id);
      const def = UNITS[u.type];
      let v = this.units.get(u.id);
      if (!v) {
        v = { figs: [], mesh: null, bar: this.makeBar(0.7), chev: [] };
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
      const target = u.target ? this.sim.byId(u.target) : null;
      if (def.figs) {
        const slots = SQUAD_SLOTS[def.figs];
        const alive = Math.ceil((u.hp / u.maxHp) * def.figs);
        const cs = Math.cos(u.rot), sn = Math.sin(u.rot);
        v.figs.forEach((f, k) => {
          if (k >= alive) {
            if (!f.hidden) { f.hidden = true; this.corpses.push({ ...f, dying: 0.001, moving: false, recolor: true, hidden: false, aim: false }); }
            return;
          }
          f.hidden = false;
          const [ox, oz] = slots[k];
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
        });
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
        ring.position.set(u.x, 0.03, u.z);
        ri++;
      }
      const top = (u.air ? u.alt : 0) + (u.type === 'gunship' ? 0.6 : 0.95);
      this.setBar(v.bar, u.hp / u.maxHp, sel || u.hp < u.maxHp - 0.5, u.x, top, u.z, camQ);
      v.chev.forEach((ch, c) => {
        ch.visible = u.vet > c;
        if (ch.visible) { ch.position.set(u.x, top + 0.12 + c * 0.07, u.z); ch.quaternion.copy(camQ); }
      });
    }
    for (let k = ri; k < this.rings.length; k++) this.rings[k].visible = false;
    for (const [id, v] of this.units) if (!seen.has(id)) {
      if (v.mesh) this.scene.remove(v.mesh);
      this.scene.remove(v.bar);
      for (const ch of v.chev) this.scene.remove(ch);
      this.units.delete(id);
    }
  }

  syncVehicles(s, dt) {
    const seen = new Set();
    for (const veh of s.ents.vehicles) {
      seen.add(veh.id);
      let v = this.vehicles.get(veh.id);
      if (!v) { v = { g: makeBus() }; this.scene.add(v.g); this.vehicles.set(veh.id, v); }
      v.g.position.set(veh.x, 0, veh.z);
      v.g.rotation.y = veh.rot;
      if (veh.moving) for (const w of v.g.userData.wheels) w.rotation.x += dt * 10;
    }
    for (const [id, v] of this.vehicles) if (!seen.has(id)) { this.scene.remove(v.g); this.vehicles.delete(id); }
  }

  syncDead(s, dt) {
    const sim = this.sim;
    const seen = new Set();
    this.deadFigs.length = 0;
    for (const z of s.ents.dead) {
      if (z.gone) continue;
      seen.add(z.id);
      let f = this.dead.get(z.id);
      if (!f) { f = { ...deadLook(z.type, z.look, z.soldier), x: z.x, z: z.z, rot: z.rot, phase: (z.look % 100) / 16 }; this.dead.set(z.id, f); }
      f.x = z.x; f.z = z.z; f.rot = z.rot;
      f.moving = z.moving;
      f.rising = z.rise;
      f.climb = z.stack > 0;
      const wall = z.stack > 0 && z.wall > 0 ? this.buildings.get(z.wall) : null;
      const wallH = wall ? (wall.g.userData.height || 1) : 1;
      const targetY = z.drop > 0 ? z.drop * wallH : z.stack > 0 ? z.stack * wallH * 0.85 : z.y;
      f.y = (f.y ?? 0) + (targetY - (f.y ?? 0)) * Math.min(1, dt * 8);
      f.scream = this.screams.get(z.id) || 0;
      const sp = DEAD[z.type].speed[1];
      if (f.moving || f.climb) f.phase += dt * sp * (z.type === 'runner' ? 4 : 7);
      else if (z.state === 'attack') f.phase += dt * 5;
      f.hidden = !sim.visible(z.x, z.z);
      this.deadFigs.push(f);
    }
    for (const id of this.dead.keys()) if (!seen.has(id)) this.dead.delete(id);
  }

  syncRefugees(s, dt) {
    const sim = this.sim;
    const seen = new Set();
    this.refFigs.length = 0;
    for (const r of s.ents.refugees) {
      seen.add(r.id);
      let f = this.refugees.get(r.id);
      if (!f) {
        f = { kind: 'civ', skin: hashPick(r.look, SKIN, 5), shirt: hashPick(r.look, CLOTH, 6), pants: hashPick(r.look, PANTS, 7), pack: (r.look & 3) !== 0, packColor: hashPick(r.look, [0x6a5a3a, 0x3a4a6a, 0x7a2a2a, 0x4a6a3a], 8), phase: (r.look % 100) / 16, scale: (r.look & 7) === 0 ? 0.72 : 1 };
        this.refugees.set(r.id, f);
      }
      f.x = r.x; f.z = r.z; f.rot = r.rot; f.y = 0;
      f.moving = r.moving;
      if (f.moving) f.phase += dt * 8;
      f.hidden = !!r.camp || !sim.visible(r.x, r.z);
      this.refFigs.push(f);
    }
    for (const id of this.refugees.keys()) if (!seen.has(id)) this.refugees.delete(id);
  }

  figureLists(extra = []) { return [this.unitFigs, this.deadFigs, this.refFigs, this.corpses, ...extra]; }
}
