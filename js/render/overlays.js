// Overlays: placement ghosts with range rings, wall-line previews, rally flags, projected horde paths, and the map
// overlays O cycles: infection discs, economy plates, defence rings (walls take their HP colour in entities.js).
import * as THREE from 'three';
import { BUILDINGS, WEAPONS } from '../config/buildings.js';
import { PRODUCER_COLORS, INFECTION_COLORS, DEFENCE_COLORS, economyPlates, defenceRings } from '../ui/overview.js';
import { makeGhost } from './models.js';

// A shown overlay looks this often (real seconds) for a change in what it draws, and rebuilds its meshes only then.
const RECHECK = 0.25;
// Map overlays lie just above the crop rows on farmland (0.06 high), which they would otherwise flicker against.
const OVER_Y = 0.07;
// A selection's range lies between the heights solid flat things use near the ground (plates 0.02, bridge decks and
// some model bases 0.03, border line 0.035, model bases 0.04 and 0.05, crop rows 0.06), so it never shares a plane
// with one (unit rings share the fill's; neither writes depth, so they do not fight).
const RANGE_FILL_Y = 0.045, RANGE_Y = 0.055;
// Economy plates: a band this wide around a producer's gold-rimmed plate, and a fill inside the rim.
const PLATE_BAND = 0.22;

// Flat triangles at a height, gathered into one geometry per material. UVs are world x, z, so a pattern (the idle
// hatch) runs across every plate at one scale.
class Flat {
  constructor() { this.pos = []; }
  quad(x0, z0, x1, z1, y) { this.pos.push(x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0); }
  square(x, z, h, y) { this.quad(x - h, z - h, x + h, z + h, y); }
  // The band between two squares about (x, z), half-sides a < b.
  frame(x, z, a, b, y) {
    this.quad(x - b, z - b, x + b, z - a, y); this.quad(x - b, z + a, x + b, z + b, y);
    this.quad(x - b, z - a, x - a, z + a, y); this.quad(x + a, z - a, x + b, z + a, y);
  }
  ring(x, z, r0, r1, y) {
    const n = Math.max(32, Math.min(160, Math.round(r1 * 8)));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, b = ((k + 1) / n) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
      this.pos.push(x + ca * r0, y, z + sa * r0, x + ca * r1, y, z + sa * r1, x + cb * r1, y, z + sb * r1);
      this.pos.push(x + ca * r0, y, z + sa * r0, x + cb * r1, y, z + sb * r1, x + cb * r0, y, z + sb * r0);
    }
  }
  // A firing arc: `arc` degrees of the band between radii r0 < r1 centred on the facing `rot` (the sim's angle, so
  // straight ahead is (sin rot, cos rot)), and its two straight sides `w` wide.
  sector(x, z, r0, r1, rot, arc, y, w = r1 - r0) {
    const half = (arc * Math.PI) / 360, n = Math.max(8, Math.round(r1 * arc / 40));
    const at = (a, r) => [x + Math.sin(a) * r, z + Math.cos(a) * r];
    for (let k = 0; k < n; k++) {
      const a = rot - half + (2 * half * k) / n, b = rot - half + (2 * half * (k + 1)) / n;
      const [ax0, az0] = at(a, r0), [ax1, az1] = at(a, r1), [bx0, bz0] = at(b, r0), [bx1, bz1] = at(b, r1);
      this.pos.push(ax0, y, az0, ax1, y, az1, bx1, y, bz1, ax0, y, az0, bx1, y, bz1, bx0, y, bz0);
    }
    for (const a of [rot - half, rot + half]) {
      const nx = Math.cos(a) * (w / 2), nz = -Math.sin(a) * (w / 2), [ex, ez] = at(a, r1);
      this.pos.push(x - nx, y, z - nz, ex - nx, y, ez - nz, ex + nx, y, ez + nz, x - nx, y, z - nz, ex + nx, y, ez + nz, x + nx, y, z + nz);
    }
  }
  // The area a firing arc covers, out to r.
  fan(x, z, r, rot, arc, y) {
    const half = (arc * Math.PI) / 360, n = Math.max(8, Math.round(r * arc / 40));
    for (let k = 0; k < n; k++) {
      const a = rot - half + (2 * half * k) / n, b = rot - half + (2 * half * (k + 1)) / n;
      this.pos.push(x, y, z, x + Math.sin(a) * r, y, z + Math.cos(a) * r, x + Math.sin(b) * r, y, z + Math.cos(b) * r);
    }
  }
  disc(x, z, r, y) {
    const n = Math.max(24, Math.min(96, Math.round(r * 6)));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, b = ((k + 1) / n) * Math.PI * 2;
      this.pos.push(x, y, z, x + Math.cos(a) * r, y, z + Math.sin(a) * r, x + Math.cos(b) * r, y, z + Math.sin(b) * r);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry(), uv = [];
    for (let k = 0; k < this.pos.length; k += 3) uv.push(this.pos[k], this.pos[k + 2]);
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return g;
  }
}

const flatMat = (color, opacity, map = null) => new THREE.MeshBasicMaterial({ color: map ? 0xffffff : color, map, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });

// Idle producers' plates: red diagonal stripes on a dark red-brown, three to a tile.
function hatch(color) {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d'), img = ctx.createImageData(32, 32);
  const on = new THREE.Color(color).convertLinearToSRGB(), off = [42, 16, 13];
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const stripe = (x + y) % 16 < 7, k = (y * 32 + x) * 4;
    img.data.set(stripe ? [on.r * 255, on.g * 255, on.b * 255, 255] : [...off, 255], k);
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.5, 1.5);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Overlays {
  constructor(scene) {
    this.scene = scene;
    this.ghost = null;
    this.ghostType = null;
    this.lineGhosts = [];
    const rg = new THREE.RingGeometry(0.97, 1, 64); rg.rotateX(-Math.PI / 2);
    this.rangeRing = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.55, depthWrite: false }));
    this.rangeRing.visible = false;
    const fg = new THREE.CircleGeometry(1, 48); fg.rotateX(-Math.PI / 2);
    this.rangeFill = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.08, depthWrite: false }));
    this.rangeFill.visible = false;
    // The minimum range of indirect fire, inside the range ring.
    this.minRing = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.55, depthWrite: false }));
    this.minRing.visible = false;
    scene.add(this.rangeRing, this.rangeFill, this.minRing);
    // A selected MG team's firing arc: one mesh for the area, one for the outline, rebuilt only when the range or the
    // arc changes; it is turned to the team's facing.
    this.arcMat = flatMat(0xffd27a, 0.1);
    this.arcEdgeMat = flatMat(0xffd27a, 0.75);
    this.arcFill = new THREE.Mesh(new THREE.BufferGeometry(), this.arcMat);
    this.arcEdge = new THREE.Mesh(new THREE.BufferGeometry(), this.arcEdgeMat);
    this.arcFill.visible = this.arcEdge.visible = false;
    this.arcKey = '';
    scene.add(this.arcFill, this.arcEdge);
    // Horde path arrows: a dashed line per horde
    this.paths = [];
    // Rally flag
    this.rally = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.8, 0.03), new THREE.MeshBasicMaterial({ color: 0xdddddd }));
    pole.position.y = 0.4;
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.18, 0.3), new THREE.MeshBasicMaterial({ color: 0xf2c335 }));
    cloth.position.set(0, 0.7, 0.15);
    this.rally.add(pole, cloth);
    this.rally.visible = false;
    scene.add(this.rally);
    // Infection overlay discs per town
    this.discs = [];
    // Economy and defence overlays: a few merged meshes each, rebuilt when what they show changes.
    this.econ = { key: null, t: 0, meshes: [] };
    this.defence = { key: null, t: 0, meshes: [] };
    const tex = hatch(PRODUCER_COLORS.idle);
    this.econMats = Object.fromEntries(Object.entries(PRODUCER_COLORS).map(([k, c]) => [k, k === 'idle' ? flatMat(0, 0.92, tex) : flatMat(c, 0.9)]));
    this.ringMats = {
      gun: flatMat(DEFENCE_COLORS.gun, 0.8), fill: flatMat(DEFENCE_COLORS.gun, 0.07), artillery: flatMat(DEFENCE_COLORS.artillery, 0.8),
    };
  }

  dispose() {
    for (const m of [...Object.values(this.econMats), ...Object.values(this.ringMats), this.arcMat, this.arcEdgeMat]) { m.map?.dispose(); m.dispose(); }
    this.arcFill.geometry.dispose();
    this.arcEdge.geometry.dispose();
  }

  setGhost(type) {
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    for (const g of this.lineGhosts) this.scene.remove(g);
    this.lineGhosts = [];
    this.ghostType = type;
    this.rangeRing.visible = this.rangeFill.visible = this.minRing.visible = false;
    if (!type) return;
    this.ghost = makeGhost(type);
    this.scene.add(this.ghost);
  }

  placeGhost(type, i, j, ok) {
    if (!this.ghost) return;
    const s = BUILDINGS[type].size;
    this.ghost.visible = true;
    this.ghost.position.set(i + s / 2, 0, j + s / 2);
    this.ghost.userData.ghostMat.color.setHex(ok ? 0x66ff88 : 0xff5544);
    const def = BUILDINGS[type];
    const r = def.weapon ? WEAPONS[def.weapon].range : def.radius || def.vision || 0;
    this.showRange(r ? i + s / 2 : null, j + s / 2, r);
  }

  // A range ring about (x, z), filled faintly, and with `min` an inner ring where indirect fire starts to reach.
  showRange(x, z, r, color = 0x9fd6ff, min = 0) {
    const on = x !== null && r > 0;
    this.rangeRing.visible = this.rangeFill.visible = on;
    this.minRing.visible = on && min > 0;
    if (!on) return;
    this.rangeRing.position.set(x, RANGE_Y, z); this.rangeRing.scale.set(r, 1, r);
    this.rangeFill.position.set(x, RANGE_FILL_Y, z); this.rangeFill.scale.set(r, 1, r);
    this.rangeRing.material.color.setHex(color);
    if (min > 0) { this.minRing.position.set(x, RANGE_Y, z); this.minRing.scale.set(min, 1, min); this.minRing.material.color.setHex(color); }
  }

  // A firing arc ({ x, z, r, rot, arc, ready }) or none (null). Faint until the team is ready to fire.
  showArc(a) {
    this.arcFill.visible = this.arcEdge.visible = !!a;
    if (!a) return;
    const key = `${a.r.toFixed(2)}:${a.arc}`;
    if (key !== this.arcKey) {
      this.arcKey = key;
      const fill = new Flat(), edge = new Flat();
      fill.fan(0, 0, a.r, 0, a.arc, 0);
      edge.sector(0, 0, a.r - 0.07, a.r + 0.07, 0, a.arc, 0.002);
      this.arcFill.geometry.dispose(); this.arcFill.geometry = fill.geometry();
      this.arcEdge.geometry.dispose(); this.arcEdge.geometry = edge.geometry();
    }
    for (const m of [this.arcFill, this.arcEdge]) { m.position.set(a.x, RANGE_FILL_Y, a.z); m.rotation.y = a.rot; }
    this.arcMat.opacity = a.ready ? 0.1 : 0.04;
    this.arcEdgeMat.opacity = a.ready ? 0.75 : 0.3;
  }

  placeLine(type, tiles, okFn) {
    if (this.ghost) this.ghost.visible = false;
    while (this.lineGhosts.length < tiles.length) { const g = makeGhost(type); this.scene.add(g); this.lineGhosts.push(g); }
    this.lineGhosts.forEach((g, n) => {
      if (n >= tiles.length) { g.visible = false; return; }
      const [i, j] = tiles[n];
      g.visible = true;
      g.position.set(i + 0.5, 0, j + 0.5);
      g.userData.ghostMat.color.setHex(okFn(n) ? 0x66ff88 : 0xff5544);
    });
  }

  setRally(pos) {
    this.rally.visible = !!pos;
    if (pos) this.rally.position.set(pos[0], 0, pos[1]);
  }

  // Projected horde paths: follow the flow field from each contacted horde's lead walker.
  updateHordes(sim, time) {
    const s = sim.state, N = sim.N, nav = sim.nav;
    const lines = [];
    for (const h of s.hordes) {
      if (h.phase !== 'contact' && h.phase !== 'moving') continue;
      let lead = null;
      for (const z of s.ents.dead) if (z.horde === h.id && !z.gone && sim.visible(z.x, z.z)) { lead = z; break; }
      if (!lead) continue;
      const pts = [];
      let k = Math.floor(lead.z) * N + Math.floor(lead.x);
      for (let step = 0; step < 60 && k >= 0; step++) {
        pts.push(new THREE.Vector3((k % N) + 0.5, 0.15, ((k / N) | 0) + 0.5));
        const nk = nav.next[k];
        if (nk < 0 || nk === k) break;
        k = nk;
      }
      if (pts.length > 2) lines.push(pts);
    }
    while (this.paths.length < lines.length) {
      const g = new THREE.BufferGeometry();
      const l = new THREE.Line(g, new THREE.LineDashedMaterial({ color: 0xff4a3a, dashSize: 0.5, gapSize: 0.35, transparent: true, opacity: 0.9 }));
      l.frustumCulled = false;
      this.scene.add(l);
      this.paths.push(l);
    }
    this.paths.forEach((l, n) => {
      l.visible = n < lines.length;
      if (!l.visible) return;
      l.geometry.setFromPoints(lines[n]);
      l.computeLineDistances();
      l.material.opacity = 0.55 + Math.sin(time * 4) * 0.3;
    });
  }

  // Infection overlay: a coloured disc per town sized by reported cases.
  updateInfection(sim, show) {
    const towns = sim.state.towns;
    while (this.discs.length < towns.length) {
      const g = new THREE.CircleGeometry(1, 32); g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.25, depthWrite: false }));
      m.renderOrder = 3;
      this.scene.add(m);
      this.discs.push(m);
    }
    towns.forEach((t, n) => {
      const d = this.discs[n], info = sim.map.towns[t.id];
      d.visible = show;
      if (!show) return;
      const sev = t.status !== 'ok' ? 1 : Math.min(1, t.reported / 300);
      d.position.set(info.x, OVER_Y, info.z);
      const r = info.r + 1 + sev * 4;
      d.scale.set(r, 1, r);
      d.material.color.set(t.status !== 'ok' ? INFECTION_COLORS.lost : t.reported >= 5 ? INFECTION_COLORS.cases : INFECTION_COLORS.clear);
      d.material.opacity = t.status !== 'ok' ? 0.4 : 0.15 + sev * 0.3;
    });
  }

  // Economy overlay: every producer's plate in its type's colour, a band around the gold rim and a fill inside it
  // (the model stands on the fill); idle ones hatched red.
  updateEconomy(sim, show, rdt) {
    const L = this.econ;
    if (!this.due(L, show, rdt)) return;
    const plates = economyPlates(sim);
    const key = plates.map((p) => `${p.id}:${p.type}:${p.idle ? 1 : 0}`).join();
    if (key === L.key) return;
    this.clear(L);
    L.key = key;
    const flats = {};
    for (const p of plates) {
      const f = (flats[p.idle ? 'idle' : p.type] ||= new Flat()), rim = (p.size + 0.15) / 2;
      f.frame(p.x, p.z, rim, rim + PLATE_BAND, OVER_Y);
      f.square(p.x, p.z, rim - 0.06, 0.05);
    }
    for (const [k, f] of Object.entries(flats)) this.add(L, f, this.econMats[k]);
  }

  // Defence overlay: a ring at the range each defence fires at now, with a faint fill that brightens where they
  // overlap; artillery gets its reach and its minimum, unfilled.
  updateDefence(sim, show, rdt) {
    const L = this.defence;
    if (!this.due(L, show, rdt)) return;
    const rings = defenceRings(sim);
    const key = rings.map((r) => `${r.kind}:${r.x.toFixed(2)}:${r.z.toFixed(2)}:${r.r.toFixed(2)}:${r.min}${r.arc ? `:${r.arc}@${r.rot.toFixed(2)}` : ''}`).join();
    if (key === L.key) return;
    this.clear(L);
    L.key = key;
    const gun = new Flat(), fill = new Flat(), art = new Flat();
    for (const r of rings) {
      if (r.kind === 'artillery') { art.ring(r.x, r.z, r.r - 0.11, r.r + 0.11, OVER_Y + 0.01); art.ring(r.x, r.z, r.min - 0.08, r.min + 0.08, OVER_Y + 0.01); }
      else if (r.arc) { gun.sector(r.x, r.z, r.r - 0.08, r.r + 0.08, r.rot, r.arc, OVER_Y + 0.01); fill.fan(r.x, r.z, r.r, r.rot, r.arc, OVER_Y); }
      else { gun.ring(r.x, r.z, r.r - 0.08, r.r + 0.08, OVER_Y + 0.01); fill.disc(r.x, r.z, r.r, OVER_Y); }
    }
    this.add(L, fill, this.ringMats.fill);
    this.add(L, gun, this.ringMats.gun);
    this.add(L, art, this.ringMats.artillery);
  }

  // Whether a layer should look for changes now: at once when it is switched on, then every RECHECK s. Switched
  // off, it drops its meshes.
  due(L, show, rdt) {
    if (!show) { if (L.key !== null) this.clear(L); return false; }
    if (L.key !== null && (L.t -= rdt) > 0) return false;
    L.t = RECHECK;
    return true;
  }

  add(L, flat, mat) {
    if (!flat.pos.length) return;
    const m = new THREE.Mesh(flat.geometry(), mat);
    m.renderOrder = 2;
    this.scene.add(m);
    L.meshes.push(m);
  }

  clear(L) {
    for (const m of L.meshes) { this.scene.remove(m); m.geometry.dispose(); }
    L.meshes = [];
    L.key = null;
  }
}
