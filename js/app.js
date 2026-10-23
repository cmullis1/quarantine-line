// The client application: owns the sim, the 3D view, UI, audio and input; runs the frame loop;
// handles new games, saves (manual + autosave at dawn), settings and speed.
import { Sim } from './sim/sim.js';
import { REAL_SECONDS_PER_DAY, HOURS_PER_DAY } from './config/balance.js';
import { View } from './render/renderer.js';
import { Terrain } from './render/terrain.js';
import { Towns } from './render/towns.js';
import { Entities } from './render/entities.js';
import { Crowd } from './render/crowd.js';
import { FX } from './render/fx.js';
import { Ambient } from './render/ambient.js';
import { Overlays } from './render/overlays.js';
import { BUILDINGS, WEAPONS } from './config/buildings.js';
import { UNITS } from './config/units.js';
import { workforce } from './sim/systems/economy.js';
import { effectiveRange } from './sim/systems/combat.js';
import { unitVision } from './sim/systems/fog.js';
import { OVERLAY_MODES } from './ui/overview.js';
import { UI } from './ui/ui.js';
import { Modals } from './ui/modals.js';
import { Input } from './input.js';
import { Tutorial } from './ui/tutorial.js';
import { createAudio, DEFAULT_VOLUME } from './audio/audio.js';
import { direness } from './audio/director.js';
import { BOTS } from './ai/bots.js';
import { MusicLab } from './ui/musiclab.js';
import { $ } from './ui/dom.js';

const HOURS_PER_SECOND = HOURS_PER_DAY / REAL_SECONDS_PER_DAY;

const DEFAULT_SETTINGS = {
  pixel: 3, uiScale: 0, hints: true, pauseOnContact: false, edgePan: false, shake: true, muted: false,
  volume: { ...DEFAULT_VOLUME },
};

class Saves {
  key(slot) { return `ql.save.${slot}`; }
  write(slot, sim) {
    try {
      localStorage.setItem(this.key(slot), sim.serialize());
      const s = sim.state;
      const meta = `${s.mode} · ${s.difficulty} · Day ${sim.day} ${String(Math.floor(sim.hour)).padStart(2, '0')}:00 · ${new Date().toLocaleString()}`;
      localStorage.setItem(this.key(slot) + '.meta', meta);
      return true;
    } catch (err) {
      console.warn('Save failed', err);
      return false;
    }
  }
  read(slot) { try { return localStorage.getItem(this.key(slot)); } catch { return null; } }
  meta(slot) { try { return localStorage.getItem(this.key(slot) + '.meta'); } catch { return null; } }
}

export class App {
  constructor() {
    this.settings = this.loadSettings();
    this.saves = new Saves();
    this.speed = 1;
    this.lastSpeed = 1;
    this.paused = true;
    this.sel = { units: [], building: null, town: null };
    this.sim = null;
    this.overlay = 'none'; // one of OVERLAY_MODES
    this.audio = createAudio();
    this.musicLab = new URLSearchParams(location.search).has('musiclab') ? new MusicLab(this) : null;
    this.modals = new Modals(this);
    this.ui = new UI(this);
    this.input = new Input(this);
    this.canvas = document.getElementById('view');
    this.view = null;
    addEventListener('resize', () => { this.view?.resize(); this.applySettings(); });
    this.applySettings();
    const unlock = () => { this.audio.unlock(); this.applySettings(); removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
    // Every button clicks and ticks on hover, wherever it lives in the page.
    document.addEventListener('click', (e) => { if (e.target.closest?.('button:not(:disabled)')) this.audio.ui('click'); }, true);
    document.addEventListener('pointerover', (e) => {
      const b = e.target.closest?.('button:not(:disabled)');
      if (b && !b.contains(e.relatedTarget)) this.audio.ui('hover');
    });
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------------------------------------------------------- settings

  loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('ql.settings') || '{}');
      return { ...DEFAULT_SETTINGS, ...s, volume: { ...DEFAULT_SETTINGS.volume, ...(s.volume || {}) } };
    } catch { return structuredClone(DEFAULT_SETTINGS); }
  }
  saveSettings() { try { localStorage.setItem('ql.settings', JSON.stringify(this.settings)); } catch { /* storage unavailable */ } }
  applySettings() {
    const st = this.settings;
    for (const [k, v] of Object.entries(st.volume)) this.audio.setVolume(k, k === 'master' && st.muted ? 0 : v);
    if (this.view && this.view.pixel !== st.pixel) this.view.setPixel(st.pixel);
    // 0 = automatic: a little larger on wide screens (from 2100 CSS px, which takes in a 4K screen at 175%).
    const ui = st.uiScale || (innerWidth >= 2100 ? 1.15 : innerWidth >= 1700 ? 1.05 : 1);
    document.documentElement.style.setProperty('--ui', ui);
    this.uiZoom = ui;
    this.fitPanels();
  }
  // Panel heights in zoomed CSS pixels so they stop above the bottom bar at any interface size; the alerts start
  // below the minimap panel, whose overlay key changes its height.
  fitPanels() {
    const h = innerHeight / this.uiZoom;
    const right = document.getElementById('right');
    if (right) right.style.maxHeight = `${h - 86 - 108}px`;
    const alerts = document.getElementById('alerts');
    if (alerts) alerts.style.maxHeight = `${Math.max(120, h - 86 - (document.getElementById('mm-wrap')?.offsetHeight || 250) - 300)}px`;
  }
  toggleMute() { this.settings.muted = !this.settings.muted; this.applySettings(); this.saveSettings(); this.toast(this.settings.muted ? 'Muted' : 'Sound on'); }

  // ---------------------------------------------------------------- lifecycle

  mainMenu() {
    this.teardown();
    this.startDemo();
    this.modals.mainMenu();
  }

  // Attract mode: a random sandbox country played by the balanced bot behind the main menu,
  // fast-forwarded past the quiet opening, with the map revealed and a slow orbiting camera.
  startDemo() {
    const sim = new Sim({ mode: 'sandbox', seed: 1 + Math.floor(Math.random() * 9999), difficulty: 'recruit' });
    const bot = BOTS.balanced(sim);
    for (let h = 0; h < 24 * 4 && !sim.state.over; h++) { bot.tick(); sim.step(1); sim.drainEvents(); }
    sim.state.fog.seen.fill(1);
    this.start(sim, { demo: true });
    this.demo = { bot, t: 0 };
  }

  // The defended building with the most visible dead around it, or the capital when all is quiet.
  demoFocus(sim) {
    let best = sim.map.towns.find((t) => t.capital), most = 4;
    for (const b of sim.state.ents.buildings) {
      if (!b.built || !['tower', 'checkpoint', 'wall', 'highwall', 'gate'].includes(b.type)) continue;
      let n = 0;
      sim.deadHash.query(b.x, b.z, 8, (z) => { if (!z.gone && sim.visible(z.x, z.z)) n++; });
      if (n > most) { most = n; best = b; }
    }
    return { x: best.x, z: best.z };
  }

  teardown() {
    this.demo = null;
    this.ui.hide();
    $('#banner').classList.remove('show');
    if (this.tutorial) { this.tutorial.el.remove(); this.tutorial.hl.remove(); this.tutorial = null; }
    this.sim = null;
    this.sel = { units: [], building: null, town: null };
    this.input.buildType = null;
    this.input.actionId = null;
    // Unit ids restart in every game: groups from the last one would point at strangers.
    this.input.groups = {};
    this.input.lastTap = { n: 0, t: 0 };
    this.input.setHover(null);
    this.input.disarm();
    this.canvas.classList.remove('target');
    // Each game opens on the plain map.
    this.overlay = 'none';
  }

  newGame(opts) {
    this.teardown();
    this.start(new Sim(opts));
    this.saveGame('auto');
  }

  loadGame(slot) {
    const data = this.saves.read(slot);
    if (!data) { this.toast('No saved game.'); return; }
    try {
      const sim = Sim.deserialize(data);
      this.teardown();
      this.start(sim);
      this.toast(`Loaded: ${this.saves.meta(slot)}`);
    } catch (err) {
      console.error(err);
      this.toast('That save could not be loaded.');
    }
  }

  saveGame(slot) { if (this.sim && !this.demo && !this.sim.state.over && this.sim.state.mode !== 'tutorial') this.saves.write(slot, this.sim); }

  start(sim, { demo = false } = {}) {
    this.sim = sim;
    // The last game's overlay materials and wall-tint clones are not in its scene, so replacing the scene misses them.
    this.overlays?.dispose();
    this.entities?.disposeTints();
    if (!this.view) { this.view = new View(this.canvas, sim.N); }
    else this.view.newScene(sim.N);
    this.view.pixel = this.settings.pixel;
    this.view.resize();
    const scene = this.view.scene;
    this.terrain = new Terrain(scene, sim.map);
    this.towns = new Towns(scene, sim.map);
    this.crowd = new Crowd(scene, 2600);
    this.fx = new FX(scene);
    this.entities = new Entities(scene, sim, this.terrain);
    this.entities.fx = this.fx;
    this.ambient = new Ambient(scene, sim);
    this.overlays = new Overlays(scene);
    const cap = sim.map.towns.find((t) => t.capital);
    const hq = sim.state.ents.buildings.find((b) => b.type === 'hq');
    this.view.view.x = hq ? hq.x : cap.x; this.view.view.z = hq ? hq.z + 2 : cap.z;
    this.view.view.zoom = this.view.view.zoomT = 1.5;
    if (demo) { this.paused = false; this.speed = 2; this.applySettings(); return; }
    this.ui.bind();
    this.applySettings();
    this.paused = false;
    this.speed = 1;
    this.tutorial = sim.state.mode === 'tutorial' ? new Tutorial(this) : null;
    if (sim.state.time < 8 && !this.tutorial) this.ui.lesson('welcome');
    this.applySettings();
  }

  // ---------------------------------------------------------------- helpers used by the UI

  cmd(name, ...args) {
    if (!this.sim) return { ok: false };
    const r = this.sim.cmd(name, ...args);
    if (!r.ok && r.why) { this.toast(r.why, true); this.audio.ui('error'); }
    else if (r.ok) this.audio.ui('click');
    if (r.ok && name === 'place') this.warnWorkers(args[0]);
    this.ui.panels?.render();
    return r;
  }

  // Placing a producer the towns cannot staff is allowed (people may be freed later), but say so at once.
  warnWorkers(type) {
    const w = BUILDINGS[type].workers;
    if (!w) return;
    const { have, need } = workforce(this.sim);
    if (need > have + 1e-9) this.toast(`Not enough workers: this ${BUILDINGS[type].name} will stand idle (👷 ${Math.round(need)}/${Math.floor(have)}).`, true);
  }

  select(what, additive = false) {
    const prev = this.sel;
    if (!what) this.sel = { units: [], building: null, town: null };
    else if (what.units) this.sel = { units: additive ? [...new Set([...prev.units, ...what.units])] : what.units, building: null, town: null };
    else if (what.building) this.sel = { units: [], building: what.building, town: null };
    else if (what.town != null) this.sel = { units: [], building: null, town: what.town };
    if (this.entities) { this.entities.selected = new Set(this.sel.units); this.entities.selBuilding = this.sel.building; }
    if (what) this.audio.ui('select');
    // An attack-move armed from the command card belongs to the squads it was armed for.
    this.input?.disarm();
    if (this.sel.town != null) {
      const t = this.sim.state.towns[this.sel.town];
      if (t.alerted) this.ui.lesson('outbreak');
    }
  }

  setSpeed(s) {
    if (s === 0) { this.paused = true; return; }
    this.speed = s; this.lastSpeed = s; this.paused = false;
  }

  jumpTo(x, z) { if (this.view) { this.view.view.x = Math.max(0, Math.min(this.sim.N, x)); this.view.view.z = Math.max(0, Math.min(this.sim.N, z)); } }

  cycleOverlay() {
    this.overlay = OVERLAY_MODES[(OVERLAY_MODES.indexOf(this.overlay) + 1) % OVERLAY_MODES.length];
    this.ui.minimap?.setOverlay(this.overlay);
    this.fitPanels();
  }

  toast(text, bad = false) {
    const el = document.createElement('div');
    el.className = `alert toast ${bad ? 'bad' : 'info'}`;
    el.innerHTML = `<span class="at">${text}</span>`;
    el.style.cssText = 'position:fixed;left:50%;top:110px;transform:translateX(-50%);z-index:70;pointer-events:none';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  // Hooks the effects system uses to find squad muzzles and building positions.
  muzzleFor(e) { return this.entities.muzzleFor(e); }
  buildingPos(id) { return this.entities.buildingPos(id); }
  hoursToSeconds(h) { return (h / (HOURS_PER_SECOND * this.speed)) * Math.min(this.speed, 2); }

  // ---------------------------------------------------------------- frame

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const rdt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const sim = this.sim;
    if (!sim || !this.view) { if (this.view) this.view.render(); return; }
    if (this.demo) {
      // Slow orbit around wherever the fighting is (else the capital) while the bot plays.
      const d = this.demo;
      d.t += rdt;
      if (!d.focus || (d.refocus -= rdt) <= 0) { d.focus = this.demoFocus(sim); d.refocus = 18; }
      d.x = d.x == null ? d.focus.x : d.x + (d.focus.x - d.x) * Math.min(1, rdt * 0.4);
      d.z = d.z == null ? d.focus.z : d.z + (d.focus.z - d.z) * Math.min(1, rdt * 0.4);
      const v = this.view.view;
      v.x = d.x + Math.cos(d.t * 0.05) * 4; v.z = d.z + Math.sin(d.t * 0.05) * 4;
      v.yawT = Math.PI / 4 + this.demo.t * 0.04; v.zoomT = 1.25;
      d.bot.tick();
      if (!sim.state.over) sim.step(rdt * 2 * HOURS_PER_SECOND);
      // A demo country that falls gives way to a new one after a moment.
      else if ((d.overT = (d.overT ?? 6) - rdt) <= 0) { this.startDemo(); return; }
    }
    const running = !this.demo && !this.paused && !this.modals.open && !sim.state.over && !sim.state.events.decision;
    if (running) sim.step(rdt * this.speed * HOURS_PER_SECOND);
    // A pending decision always opens its card (e.g. after loading a save).
    if (sim.state.events.decision && !this.demo && !this.modals.open && sim.state.mode !== 'tutorial') this.modals.decision(sim.state.events.decision);
    const events = sim.drainEvents();
    for (const e of events) if (e.type === 'dawn') this.saveGame('auto');
    const vdt = this.demo ? rdt * 2 : running ? rdt * Math.min(this.speed, 2) : 0;
    this.fx.onEvents(events, this);
    this.entities.onEvents(events, this.fx);
    if (!this.demo) { this.audio.onEvents(events); this.ui.onEvents(events); }

    this.input.pan(rdt);
    this.input.refreshHover(rdt);
    const v = this.view.view;
    v.yaw += (v.yawT - v.yaw) * Math.min(1, rdt * 10);
    v.zoom += (v.zoomT - v.zoom) * Math.min(1, rdt * 12);
    this.view.shake = this.settings.shake ? this.fx.shake : 0;
    this.view.updateCamera();
    const t = now / 1000;
    const light = this.view.lighting(sim.hour, this.ambient.wet);
    this.crowd.setNight(light.night);
    this.view.setFog(this.ambient.foggy ? 1 : 0, this.ambient.wet);
    // The menu's demo country shows no overlay.
    const overlay = this.demo ? 'none' : this.overlay;
    this.entities.wallTint = overlay === 'defence';
    this.entities.sync(rdt, vdt, t, light.night, this.view.cam.quaternion);
    this.towns.update(sim, light.night, this.fx, vdt);
    this.ambient.update(vdt, t, light.night, v, rdt);
    this.terrain.update(t);
    this.fogT = (this.fogT || 0) - rdt;
    if (this.fogT <= 0) { this.fogT = 0.2; this.terrain.updateFog(sim.vis, sim.state.fog.seen); }
    for (const site of sim.map.sites) if (sim.state.flags.sitesFallen && Math.random() < vdt * 3 && sim.state.fog.seen[site.j * sim.N + site.i]) this.fx.smoke(site.x + (Math.random() - 0.5) * 4, 0.5, site.z + (Math.random() - 0.5) * 4, true, 1.4);
    this.overlays.updateHordes(sim, t);
    this.overlays.updateInfection(sim, overlay === 'infection');
    this.overlays.updateEconomy(sim, overlay === 'economy', rdt);
    this.overlays.updateDefence(sim, overlay === 'defence', rdt);
    const sb = this.sel.building ? sim.byId(this.sel.building) : null;
    this.overlays.setRally(sb && sb.rally ? sb.rally : null);
    let arc = null;
    if (!this.input.buildType && !this.input.actionId) {
      const def = sb ? sb : null;
      const su = this.sel.units.length === 1 ? sim.byId(this.sel.units[0]) : null;
      if (def && def.built) {
        const B = def.type;
        // Guns show the range they fire at now (night, fog and rain shrink it), as the defence overlay does.
        const gun = BUILDINGS[B].weapon && B !== 'artillery' ? effectiveRange(sim, BUILDINGS[B].weapon, def.x, def.z) : 0;
        const range = gun || { artillery: 24, radar: 18, floodlight: 7, police: 9, hospital: 9, camp: 14, lure: 16, depot: 6 }[B];
        this.overlays.showRange(range ? def.x : null, def.z, range || 0, undefined, B === 'artillery' ? WEAPONS.artillery.minRange : 0);
      } else if (su) {
        // One unit on its own shows what it covers: a mortar team its reach and minimum, a scout how far it sees
        // now, an MG team its firing arc (where it faces once set up; faint until then).
        const U = UNITS[su.type], W = WEAPONS[U.weapon];
        if (U.arc) arc = { x: su.x, z: su.z, r: effectiveRange(sim, U.weapon, su.x, su.z), rot: su.setup >= U.setup ? su.rot : su.face, arc: U.arc, ready: su.setup >= U.setup };
        if (W.flight) this.overlays.showRange(su.x, su.z, W.range, undefined, W.minRange);
        else if (U.vision) this.overlays.showRange(su.x, su.z, unitVision(sim, su), 0xf2e6a0);
        else this.overlays.showRange(null, 0, 0);
      } else this.overlays.showRange(null, 0, 0);
    }
    this.overlays.showArc(arc);
    this.crowd.render(this.entities.figureLists([this.ambient.figures()]), t);
    this.fx.update(vdt);
    this.audio.setListener({ x: v.x, z: v.z, zoom: v.zoom, yaw: v.yaw });
    let deadNearby = 0;
    sim.deadHash.query(v.x, v.z, 18, () => { deadNearby++; });
    const threat = Math.min(1, deadNearby / 60 + sim.state.towns.filter((tw) => tw.breakout).length * 0.15 + (sim.state.hordes.some((h) => h.phase === 'contact') ? 0.25 : 0));
    // The menu demo is never 'paused' for the score: its music follows the demo's own danger.
    // How the country is doing sets the music's mood (the menu demo's country included).
    const ss = sim.state;
    const dire = direness({ towns: ss.towns, trust: ss.trust, order: ss.order, act: sim.act });
    // The act picks the score's song; the menu demo plays the title anthem (Basic Training is in Act I). Game over
    // holds the score's ending until the game goes on (a retry) or back to the menu.
    this.audio.update(rdt, { threat, night: light.night > 0.5, deadNearby, paused: !running && !this.demo, rain: this.ambient.raining, dire, act: sim.act, menu: !!this.demo, over: !!sim.state.over });
    if (!this.demo) this.ui.update(rdt);
    this.tutorial?.update(rdt);
    this.view.render();
  }
}
