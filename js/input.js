// Mouse and keyboard: camera, selection, orders, placement, control groups, actions.
import { BUILDINGS } from './config/buildings.js';
import { ACTIONS } from './config/actions.js';
import { canPlace } from './sim/commands.js';
import { line4 } from './sim/mapgen.js';
import { clamp } from './util.js';
import { uiScale } from './ui/dom.js';

export class Input {
  constructor(app) {
    this.app = app;
    this.keys = new Set();
    this.buildType = null;
    this.actionId = null;
    this.attackArmed = false; // the command card's attack-move: the next right-click attack-moves
    this.wallStart = null;
    this.ground = null; // the ground point under the cursor, for the placement ghost
    this.hover = null; // what a click would select there: { kind: 'unit' | 'building' | 'town', id }
    this.mouse = { x: 0, y: 0, down: false, sx: 0, sy: 0, mid: false, lx: 0, ly: 0 };
    this.groups = {};
    this.lastTap = { n: 0, t: 0 };
    this.lastClick = { id: 0, t: 0 };
    this.canvas = document.getElementById('view');
    this.ghostMsg = document.getElementById('ghost-msg');
    this.selbox = document.getElementById('selbox');
    this.bindEvents();
  }

  get sim() { return this.app.sim; }
  get view() { return this.app.view; }

  // ---------------------------------------------------------------- modes

  setBuild(type) {
    this.disarm();
    this.actionId = null;
    this.wallStart = null;
    this.buildType = type;
    if (type) this.setHover(null);
    this.app.overlays?.setGhost(type);
    this.canvas.classList.toggle('build', !!type);
    this.canvas.classList.remove('target');
    this.ghostMsg.style.display = 'none';
    if (type) { this.app.select(null); this.app.ui.lesson('build'); this.updateGhost(); }
  }

  useAction(id) {
    const a = ACTIONS[id];
    if (a.target === 'none') { this.app.cmd('action', id); return; }
    this.setBuild(null);
    this.actionId = this.actionId === id ? null : id;
    this.canvas.classList.toggle('target', !!this.actionId);
    if (this.actionId) { this.setHover(null); this.app.ui.lesson('actions'); }
  }

  // The command card's attack-move: arms the next right-click (Shift+right-click does it at once).
  armAttack() {
    if (!this.app.sel.units.length) return;
    this.attackArmed = !this.attackArmed;
    this.canvas.classList.toggle('target', this.attackArmed);
  }

  disarm() {
    if (!this.attackArmed) return;
    this.attackArmed = false;
    if (!this.actionId) this.canvas.classList.remove('target');
  }

  command(name) {
    const app = this.app, sel = app.sel;
    if (name === 'stop' && sel.units.length) app.cmd('stop', sel.units);
    else if (name === 'hold' && sel.units.length) app.cmd('hold', sel.units);
    else if (name === 'amove' && sel.units.length) this.armAttack();
    else if (name === 'alltype' && sel.units.length) this.selectAllOfType(sel.units.map((id) => this.sim.byId(id)?.type));
    else if (name === 'upgrade' && sel.building) app.cmd('upgrade', sel.building);
    else if (name === 'upgradeLine' && sel.building) { const r = app.cmd('upgradeLine', sel.building); if (r.ok) app.toast(`${r.count} wall sections upgrading`); }
    else if (name === 'toggle' && sel.building) app.cmd('toggle', sel.building);
    else if (name === 'demolish' && sel.building) app.ui.modals.confirm('Demolish this building?', 'You get back half the cost, scaled by its condition.', () => app.cmd('demolish', sel.building));
  }

  // ---------------------------------------------------------------- ghost

  anchorFor(type, x, z) {
    const s = BUILDINGS[type].size;
    return s === 2 ? [Math.round(x) - 1, Math.round(z) - 1] : [Math.floor(x), Math.floor(z)];
  }

  showMsg(text, bad) {
    const m = this.ghostMsg;
    m.textContent = text;
    m.style.display = text ? 'block' : 'none';
    m.style.background = bad ? 'rgba(120,20,20,0.88)' : 'rgba(20,80,30,0.88)';
    // The message is zoomed by the interface scale, like the tooltip.
    const z = uiScale();
    m.style.left = (this.mouse.x + 16) / z + 'px';
    m.style.top = (this.mouse.y + 18) / z + 'px';
  }

  updateGhost() {
    const type = this.buildType, sim = this.sim, ov = this.app.overlays;
    if (!type || !this.ground || !ov) return;
    if (BUILDINGS[type].line && this.wallStart) {
      const [ei, ej] = this.anchorFor(type, this.ground.x, this.ground.z);
      const tiles = line4(this.wallStart[0], this.wallStart[1], ei, ej).slice(0, 80);
      let funds = sim.state.res.funds, n = 0;
      const oks = tiles.map(([i, j]) => {
        const v = canPlace(sim, type, i, j, { free: true }).ok && funds >= BUILDINGS[type].cost.funds;
        if (v) { funds -= BUILDINGS[type].cost.funds; n++; }
        return v;
      });
      ov.placeLine(type, tiles, (k) => oks[k]);
      this.showMsg(`${n} × ${BUILDINGS[type].name.toLowerCase()} · 💰${n * BUILDINGS[type].cost.funds}${n < tiles.length ? ` · ${tiles.length - n} blocked` : ''}`, n < tiles.length);
      return;
    }
    const [i, j] = this.anchorFor(type, this.ground.x, this.ground.z);
    const res = canPlace(sim, type, i, j);
    ov.placeGhost(type, i, j, res.ok);
    if (!res.ok) this.showMsg(res.why, true);
    else if (type === 'checkpoint') {
      const cross = sim.map.crossings.some((c) => c.i === i && c.j === j);
      this.showMsg(cross ? 'Border crossing ✓: screens refugees' : 'Not a crossing: guards the road only', !cross);
    } else if (type === 'farm') {
      let fl = 0;
      for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) fl += sim.map.farmland[(j + dj) * sim.N + i + di] || 0;
      this.showMsg(fl ? `Farmland ${fl}/4 tiles: +${Math.round((fl / 4) * 50)}% food` : 'No farmland here', false);
    } else this.showMsg('', false);
  }

  // ---------------------------------------------------------------- picking

  unitAt(mx, my) {
    let best = null, bd = 22 * 22;
    for (const u of this.sim.state.ents.units) {
      const [sx, sy] = this.view.project(u.x, (u.air ? u.alt : 0) + 0.3, u.z);
      const d = (sx - mx) ** 2 + (sy - my) ** 2;
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }

  // Select control group n (its key or its HUD badge); a second recall within 350 ms moves the camera to it.
  recallGroup(n) {
    const app = this.app;
    const ids = (this.groups[n] || []).filter((id) => this.sim.byId(id));
    if (!ids.length) return;
    const now = performance.now();
    if (this.lastTap.n === n && now - this.lastTap.t < 350) { const u = this.sim.byId(ids[0]); app.jumpTo(u.x, u.z); }
    app.select({ units: ids });
    this.lastTap = { n, t: now };
  }

  // What a click at the cursor selects: a unit near it, else the building or the town on the tile under it.
  pickAt(mx, my) {
    const sim = this.sim;
    const u = this.unitAt(mx, my);
    if (u) return { kind: 'unit', id: u.id };
    const p = this.view.groundAt(mx, my);
    if (!p) return null;
    const i = Math.floor(p.x), j = Math.floor(p.z);
    const b = sim.buildingAt(i, j);
    if (b) return { kind: 'building', id: b.id };
    if (i >= 0 && j >= 0 && i < sim.N && j < sim.N) {
      const tid = sim.map.townId[j * sim.N + i];
      if (tid >= 0) return { kind: 'town', id: tid };
    }
    return null;
  }

  // Every unit of these types on screen (a double-click on a unit, or the command card).
  selectAllOfType(types) {
    const want = new Set(types);
    this.app.select({ units: this.sim.state.ents.units.filter((x) => want.has(x.type) && this.view.project(x.x, 0, x.z)[2]).map((x) => x.id) });
  }

  clickSelect(mx, my, additive) {
    const app = this.app, sim = this.sim;
    const hit = this.pickAt(mx, my);
    if (hit?.kind === 'unit') {
      const u = sim.byId(hit.id), now = performance.now();
      if (this.lastClick.id === u.id && now - this.lastClick.t < 350) this.selectAllOfType([u.type]);
      else app.select({ units: [u.id] }, additive);
      this.lastClick = { id: u.id, t: now };
      return;
    }
    app.select(hit ? { [hit.kind]: hit.id } : null);
  }

  // The thing under the cursor lights up (towns have their label) and turns the cursor into a pointer.
  setHover(h) {
    const cur = this.hover;
    if (h === cur || (h && cur && h.kind === cur.kind && h.id === cur.id)) return;
    this.hover = h;
    this.canvas.classList.toggle('pick', !!h);
    this.app.entities?.setHover(h && h.kind !== 'town' ? h.kind : null, h ? h.id : null);
  }

  // ---------------------------------------------------------------- events

  bindEvents() {
    const c = this.canvas;
    addEventListener('keydown', (e) => this.onKey(e));
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('mousedown', (e) => this.onDown(e));
    addEventListener('mousemove', (e) => this.onMove(e));
    addEventListener('mouseup', (e) => this.onUp(e));
    // Leaving the window leaves nothing hovered.
    addEventListener('mouseout', (e) => { if (!e.relatedTarget) this.setHover(null); });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const v = this.view.view;
      v.zoomT = clamp(v.zoomT * (e.deltaY > 0 ? 0.87 : 1.15), 0.5, 4.5);
    }, { passive: false });
  }

  onKey(e) {
    const app = this.app;
    // The music lab folds from anywhere, the menu included.
    if (e.key === 'F9' && app.musicLab) { e.preventDefault(); app.musicLab.toggle(); return; }
    // F5 is the FORCES tab in a game; with a card open it must still never reach the browser (a reload loses the day).
    if ((e.key === 'F5' || e.key === 'F6') && app.sim && !app.demo) e.preventDefault();
    if (!app.sim || app.demo || app.ui.modals.open) {
      // Escape works like the open card's own dismiss button, so it returns wherever that button would.
      if (e.key === 'Escape' && app.ui.modals.open) app.ui.modals.el.querySelector('[data-a="back"], [data-a="close"], [data-a="no"], [data-a="resume"]')?.click();
      return;
    }
    if (e.target && e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    const sel = app.sel;
    // Build grid takes letter keys while the build menu is open.
    if (app.ui.build.open && k.length === 1 && 'qwerasdfzxcv'.includes(k)) { e.preventDefault(); app.ui.build.hotkey(k); return; }
    if (e.key === 'Tab') { e.preventDefault(); if (app.ui.build.open) app.ui.build.nextTab(); return; }
    if (e.key === 'Backspace') { e.preventDefault(); app.ui.alerts.latestJump(); return; }
    if (/^F[1-4]$/.test(e.key)) { e.preventDefault(); const id = Object.keys(ACTIONS).find((a) => ACTIONS[a].key === e.key); if (id) this.useAction(id); return; }
    if (e.key === 'F10') { e.preventDefault(); app.ui.modals.manual(); return; }
    if (e.key === 'F5' || e.key === 'F6') { e.preventDefault(); app.ui.panels.show(e.key === 'F5' ? 'forces' : 'economy'); return; }
    if (/^[1-9]$/.test(e.key)) {
      const n = +e.key;
      if (e.ctrlKey) { e.preventDefault(); if (sel.units.length) { this.groups[n] = [...sel.units]; app.toast(`Group ${n} set (${sel.units.length})`); } return; }
      this.recallGroup(n);
      return;
    }
    this.keys.add(k);
    switch (k) {
      case ' ': e.preventDefault(); app.setSpeed(app.paused ? app.lastSpeed : 0); break;
      case '+': case '=': app.setSpeed(app.paused ? 1 : Math.min(4, app.speed * 2)); break;
      case '-': case '_': app.setSpeed(app.speed <= 1 ? 0 : app.speed / 2); break;
      case 'escape':
        if (this.attackArmed) this.disarm();
        else if (this.buildType || this.actionId || app.ui.build.open) { this.setBuild(null); this.actionId = null; this.canvas.classList.remove('target'); app.ui.build.setOpen(false); }
        else if (sel.units.length || sel.building || sel.town != null) app.select(null);
        else app.ui.modals.pauseMenu();
        break;
      case 'b': app.ui.build.setOpen(!app.ui.build.open); if (!app.ui.build.open) this.setBuild(null); break;
      case 'q': this.view.view.yawT -= Math.PI / 2; break;
      case 'e': this.view.view.yawT += Math.PI / 2; break;
      case 'h': if (sel.units.length) this.command('hold'); break;
      case 't': if (sel.units.length) this.command('stop'); break;
      case 'u': this.command(e.shiftKey ? 'upgradeLine' : 'upgrade'); break;
      case 'i': this.command('toggle'); break;
      case 'delete': this.command('demolish'); break;
      case '.': {
        const idle = this.sim.state.ents.units.filter((u) => !u.path && !u.attack && u.order !== 'hold');
        if (idle.length) { this.idleIdx = ((this.idleIdx || 0) + 1) % idle.length; const u = idle[this.idleIdx]; app.select({ units: [u.id] }); app.jumpTo(u.x, u.z); }
        break;
      }
      case 'home': { const cap = this.sim.map.towns.find((t) => t.capital); app.jumpTo(cap.x, cap.z); break; }
      case 'o': app.cycleOverlay(); break;
      case 'p': app.settings.pixelSize = this.view.cyclePixel(); app.saveSettings(); break;
      case 'm': app.toggleMute(); break;
      default: break;
    }
  }

  onDown(e) {
    const app = this.app;
    if (!app.sim || app.demo || app.ui.modals.open) return;
    if (e.button === 1) { this.mouse.mid = true; this.mouse.lx = e.clientX; this.mouse.ly = e.clientY; this.setHover(null); e.preventDefault(); return; }
    const p = this.view.groundAt(e.clientX, e.clientY);
    if (e.button === 2) {
      if (this.buildType || this.actionId) { this.setBuild(null); this.actionId = null; this.disarm(); this.canvas.classList.remove('target'); return; }
      if (!p) return;
      if (app.sel.units.length) {
        const attack = e.shiftKey || this.attackArmed;
        this.disarm();
        const r = app.cmd('move', app.sel.units, p.x, p.z, attack ? 'attack' : 'move');
        if (r.ok) { app.fx.marker(p.x, p.z, attack ? 0xff6040 : 0x7cff8a); app.audio.ui('order'); app.ui.lesson('controls'); }
      } else if (app.sel.building) {
        const b = app.sim.byId(app.sel.building);
        if (b && BUILDINGS[b.type].trains) { app.cmd('rally', b.id, p.x, p.z); app.fx.marker(p.x, p.z, 0xe8c547); }
      }
      return;
    }
    if (e.button !== 0) return;
    if (this.actionId) {
      if (p && app.cmd('action', this.actionId, p.x, p.z).ok) { this.actionId = null; this.canvas.classList.remove('target'); }
      return;
    }
    if (this.buildType) {
      if (!p) return;
      if (BUILDINGS[this.buildType].line) { this.wallStart = this.anchorFor(this.buildType, p.x, p.z); this.updateGhost(); return; }
      const [i, j] = this.anchorFor(this.buildType, p.x, p.z);
      if (app.cmd('place', this.buildType, i, j).ok) { app.audio.ui('place'); if (!e.shiftKey) this.setBuild(null); }
      return;
    }
    this.mouse.down = true; this.mouse.sx = e.clientX; this.mouse.sy = e.clientY;
  }

  onMove(e) {
    this.mouse.x = e.clientX; this.mouse.y = e.clientY;
    this.mouse.overCanvas = e.target === this.canvas;
    if (!this.app.sim) return;
    if (this.mouse.mid) {
      const a = this.view.groundAt(this.mouse.lx, this.mouse.ly), b = this.view.groundAt(e.clientX, e.clientY);
      const v = this.view.view;
      if (a && b) { v.x = clamp(v.x + a.x - b.x, 0, this.sim.N); v.z = clamp(v.z + a.z - b.z, 0, this.sim.N); this.view.updateCamera(); }
      this.mouse.lx = e.clientX; this.mouse.ly = e.clientY;
      return;
    }
    if (e.target === this.canvas) {
      const p = this.view.groundAt(e.clientX, e.clientY);
      this.ground = p ? { x: p.x, z: p.z } : null;
      this.updateGhost();
      if (this.actionId && p) this.app.overlays.showRange(p.x, p.z, ACTIONS[this.actionId].radius || 12, this.actionId === 'airstrike' ? 0xff5030 : 0x80c8ff);
    }
    // Placing or targeting, nothing is hovered; over the HUD only a town label is.
    const app = this.app;
    if (app.demo || app.ui.modals.open || this.buildType || this.actionId) this.setHover(null);
    else if (e.target === this.canvas) this.setHover(this.pickAt(e.clientX, e.clientY));
    else {
      const lab = e.target.closest?.('.clabel');
      this.setHover(lab ? { kind: 'town', id: +lab.dataset.town } : null);
    }
    if (this.mouse.down) {
      const x0 = Math.min(this.mouse.sx, e.clientX), y0 = Math.min(this.mouse.sy, e.clientY);
      const w = Math.abs(e.clientX - this.mouse.sx), h = Math.abs(e.clientY - this.mouse.sy);
      if (w + h > 6) Object.assign(this.selbox.style, { display: 'block', left: x0 + 'px', top: y0 + 'px', width: w + 'px', height: h + 'px' });
    }
  }

  onUp(e) {
    const app = this.app;
    if (!app.sim || app.demo) return;
    if (e.button === 1) { this.mouse.mid = false; return; }
    if (e.button !== 0) return;
    if (this.buildType && this.wallStart) {
      const p = this.ground;
      if (p) {
        const [ei, ej] = this.anchorFor(this.buildType, p.x, p.z);
        const r = app.cmd('placeLine', this.buildType, this.wallStart[0], this.wallStart[1], ei, ej);
        if (r.ok) app.audio.ui('place');
      }
      this.wallStart = null;
      if (!e.shiftKey) this.setBuild(null); else { this.app.overlays.setGhost(this.buildType); this.updateGhost(); }
      return;
    }
    if (!this.mouse.down) return;
    this.mouse.down = false;
    this.selbox.style.display = 'none';
    const w = Math.abs(e.clientX - this.mouse.sx), h = Math.abs(e.clientY - this.mouse.sy);
    if (w + h > 6) {
      const x0 = Math.min(this.mouse.sx, e.clientX), x1 = Math.max(this.mouse.sx, e.clientX);
      const y0 = Math.min(this.mouse.sy, e.clientY), y1 = Math.max(this.mouse.sy, e.clientY);
      const picked = this.sim.state.ents.units.filter((u) => {
        const [sx, sy] = this.view.project(u.x, (u.air ? u.alt : 0) + 0.3, u.z);
        return sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1;
      }).map((u) => u.id);
      app.select(picked.length ? { units: picked } : null, e.shiftKey);
      return;
    }
    this.clickSelect(e.clientX, e.clientY, e.shiftKey);
  }

  // Camera panning from held keys and screen edges.
  // Things move under a still cursor (a squad walks off, the camera pans): pick again a few times a second.
  refreshHover(rdt) {
    this.hoverT = (this.hoverT || 0) - rdt;
    if (this.hoverT > 0 || !this.mouse.overCanvas) return;
    this.hoverT = 0.2;
    const app = this.app;
    if (app.demo || app.ui.modals.open || this.buildType || this.actionId || this.mouse.mid) return;
    this.setHover(this.pickAt(this.mouse.x, this.mouse.y));
  }

  pan(rdt) {
    const v = this.view.view, k = this.keys;
    const buildOpen = this.app.ui.build?.open;
    let px = 0, pz = 0;
    if (k.has('arrowup') || (!buildOpen && k.has('w'))) pz -= 1;
    if (k.has('arrowdown') || (!buildOpen && k.has('s'))) pz += 1;
    if (k.has('arrowleft') || (!buildOpen && k.has('a'))) px -= 1;
    if (k.has('arrowright') || (!buildOpen && k.has('d'))) px += 1;
    if (this.app.settings.edgePan && document.hasFocus()) {
      const m = this.mouse, E = 4;
      if (m.x <= E) px -= 1; else if (m.x >= innerWidth - E) px += 1;
      if (m.y <= E) pz -= 1; else if (m.y >= innerHeight - E) pz += 1;
    }
    if (!px && !pz) return;
    const sp = (20 / v.zoom) * rdt;
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
    v.x = clamp(v.x + (rx * px - fx * pz) * sp, 0, this.sim.N);
    v.z = clamp(v.z + (rz * px - fz * pz) * sp, 0, this.sim.N);
  }
}

