// Alert feed (typed icons, weight bars, merged repeats, click to jump, a clear button), the alarm and the ping,
// minimap pings, the screen-edge flash and edge-of-screen arrows (threats, and critical alerts not yet looked at).
import { $, esc, uiScale, setStyle, setClass, setText } from './dom.js';
import { placeName } from '../sim/places.js';
import { alertSound } from '../audio/audio.js';

const ICONS = {
  outbreak: '☣️', breakout: '☣️', fall: '💀', hordeRumour: '📡', hordeContact: '⚠️', hordeArrived: '⚠️', hordeDestroyed: '✔️',
  pileup: '🧱', unitLost: '✖', built: '🏗️', trained: '🎖️', tech: '🧪', promiseKept: '🤝', promiseBroken: '💔', request: '📨',
  starving: '🍞', broke: '💰', ammo: '🔸', law: '⚖️', border: '🚧', quarantine: '🚫', evacuate: '🚌', sterilise: '🔥',
  airstrike: '🔥', reclaim: '🏳️', day: '☀️', scandal: '📰', busLost: '🚌', campTurn: '🏕️', promoted: '︽', contained: '✔️',
  brigade: '🎖️', showOfForce: '📺', sacrifice: '⚰️', broadcast: '📻', conscription: '📋', hq: '🏛️', letterExpired: '✉️',
  destroyed: '💥', underAttack: '⚔️', hqAttack: '🏛️', danger: '🚨', deadline: '⏳',
};
const LEVEL_COLOR = { bad: '#ff5a48', warn: '#e9b23a', good: '#7cc46a', info: '#8ab0c8' };
const KEEP = 20;
const FADE_MS = 16000;
const FLASH_MS = 1200;
// How far inside the open view (between the HUD panels) an edge arrow sits.
const INSET = 34;

export class Alerts {
  constructor(app) {
    this.app = app;
    this.pings = [];
    this.nodes = new Map();
    // Critical alerts whose spot the camera has not looked at yet; each keeps an edge arrow.
    this.pinned = [];
    this.flashT = {};
    this.boundsAt = -1e9;
    $('#alerts-clear').onclick = () => this.clear();
  }

  // `replay`: a line restored from the log when a game is loaded, so no sound, flash or arrow.
  push(a, replay = false) {
    const box = $('#alerts');
    const weight = a.weight || 'routine', crit = weight === 'critical';
    let el = this.nodes.get(a.id);
    if (a.merged && el) {
      el.querySelector('.cnt').textContent = `×${a.count}`;
      el.querySelector('.cnt').hidden = false;
      el.classList.remove('old');
      box.prepend(el);
    } else {
      el = document.createElement('div');
      el.className = `alert ${a.level} w-${weight}`;
      el._id = a.id;
      const day = Math.floor(a.t / 24) + 1, hr = String(Math.floor(a.t % 24)).padStart(2, '0');
      el.innerHTML = `<span class="ai">${ICONS[a.kind] || '•'}</span><span class="at"><small>D${day} ${hr}:00</small> ${esc(a.text)}</span><span class="cnt" hidden></span>`;
      if (a.x !== null) el.classList.add('jump');
      el.addEventListener('click', () => { this.ack(el); if (a.x !== null) this.app.jumpTo(a.x, a.z); });
      box.prepend(el);
      this.nodes.set(a.id, el);
      while (box.children.length > KEEP) this.drop(box.lastChild);
    }
    // A critical line stays at full strength until it is clicked or jumped to.
    if (crit && !replay) { el.classList.add('live'); clearTimeout(el._t); } else this.fade(el);
    if (a.x !== null && a.level !== 'info') this.pings.push({ x: a.x, z: a.z, t: 0, color: LEVEL_COLOR[a.level] });
    if (replay) return;
    // The alarm or the ping, for a critical or important kind without a tone of its own (the tones are the world's).
    const sound = alertSound(a);
    if (sound === 'ui.alarm' || sound === 'ui.ping') this.app.audio.ui(sound.slice(3));
    if (crit) {
      const side = a.x === null ? 'all' : this.offSide(a.x, a.z);
      if (side) this.flash(side);
      if (side && a.x !== null) this.pinned.push({ x: a.x, z: a.z, label: `${ICONS[a.kind] || '!'} ${placeName(this.app.sim, a.x, a.z).replace(/^(in|near) /, '')}` });
    }
  }

  fade(el) {
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('old'), FADE_MS);
  }

  ack(el) {
    if (!el.classList.contains('live')) return;
    el.classList.remove('live');
    this.fade(el);
  }

  drop(el) {
    clearTimeout(el._t);
    this.nodes.delete(el._id);
    el.remove();
  }

  clear() {
    for (const el of [...$('#alerts').children]) this.drop(el);
  }

  // Backspace: the newest critical line not yet looked at, else the newest alert with a place.
  latestJump() {
    const log = this.app.sim.state.log;
    const a = log.find((l) => l.x !== null && this.nodes.get(l.id)?.classList.contains('live')) || log.find((l) => l.x !== null);
    if (!a) return;
    const el = this.nodes.get(a.id);
    if (el) this.ack(el);
    this.app.jumpTo(a.x, a.z);
  }

  // The open part of the view, between the HUD panels; measured twice a second (panels move with the UI scale).
  bounds() {
    const now = performance.now();
    if (now - this.boundsAt < 500) return this.b;
    this.boundsAt = now;
    const r = (sel) => document.querySelector(sel)?.getBoundingClientRect();
    const left = r('#left'), right = r('#right'), bottom = r('#bottom'), top = r('#ticker');
    this.b = {
      l: (left ? left.right : 0) + INSET,
      r: (right && right.width ? right.left : innerWidth) - INSET,
      t: (top ? top.bottom : 0) + INSET,
      b: (bottom && bottom.height ? bottom.top : innerHeight) - INSET,
    };
    return this.b;
  }

  // Where a map point lies against the open view: null when it is on screen, else the edge toward it.
  offSide(x, z) {
    const [sx, sy] = this.app.view.project(x, 0, z), b = this.bounds();
    if (sx > b.l && sx < b.r && sy > b.t && sy < b.b) return null;
    const dx = (sx - (b.l + b.r) / 2) / ((b.r - b.l) / 2), dy = (sy - (b.t + b.b) / 2) / ((b.b - b.t) / 2);
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'b' : 't');
  }

  flash(side) {
    for (const s of side === 'all' ? ['l', 'r', 't', 'b'] : [side]) {
      const el = document.querySelector(`#edgeflash .${s}`);
      if (!el) continue;
      el.classList.remove('on');
      void el.offsetWidth;
      el.classList.add('on');
      clearTimeout(this.flashT[s]);
      this.flashT[s] = setTimeout(() => el.classList.remove('on'), FLASH_MS);
    }
  }

  // Threats that deserve an arrow when off-screen: hordes that have been seen or have crossed, breakouts, and the
  // spots of critical alerts the camera has not yet looked at (folded into a threat arrow when one is already there).
  threats() {
    const sim = this.app.sim, s = sim.state, m = sim.map, out = [];
    for (const h of s.hordes) {
      if (h.phase !== 'contact' && !(h.arrived && h.phase !== 'destroyed')) continue;
      let lead = null;
      for (const z of s.ents.dead) {
        if (z.horde !== h.id || z.gone) continue;
        if (!lead) lead = z;
        // A horde over the border is pointed at by a member inside it.
        if (!h.arrived || m.owner[Math.floor(z.z) * sim.N + Math.floor(z.x)]) { lead = z; break; }
      }
      if (lead) out.push({ x: lead.x, z: lead.z, label: `${h.members}`, cls: '' });
    }
    for (const t of s.towns) if (t.status === 'ok' && t.breakout) { const i = m.towns[t.id]; out.push({ x: i.x, z: i.z, label: i.name, cls: 'warn' }); }
    this.pinned = this.pinned.filter((p) => this.offSide(p.x, p.z));
    for (const p of this.pinned) {
      const near = out.find((t) => Math.hypot(t.x - p.x, t.z - p.z) < 4);
      if (near) near.cls += ' pin';
      else out.push({ x: p.x, z: p.z, label: p.label, cls: 'pin' });
    }
    return out;
  }

  updateArrows() {
    const el = $('#arrows');
    const threats = this.threats();
    while (el.children.length < threats.length) {
      const a = document.createElement('div');
      a.className = 'edge';
      a.innerHTML = '<div class="tri"></div><div class="lbl"></div>';
      a._tri = a.firstChild; a._lbl = a.lastChild;
      a.addEventListener('click', () => this.app.jumpTo(a._x, a._z));
      el.appendChild(a);
    }
    const b = this.bounds(), cx = (b.l + b.r) / 2, cy = (b.t + b.b) / 2, zoom = uiScale();
    // Every write is skipped when it would not change what is shown (the arrows are placed every frame).
    for (let n = 0; n < el.children.length; n++) {
      const a = el.children[n], t = threats[n];
      if (!t) { setStyle(a, 'display', 'none'); continue; }
      const [sx, sy] = this.app.view.project(t.x, 0, t.z);
      if (sx > b.l && sx < b.r && sy > b.t && sy < b.b) { setStyle(a, 'display', 'none'); continue; }
      const ang = Math.atan2(sy - cy, sx - cx);
      const k = Math.min((b.r - b.l) / 2 / Math.abs(Math.cos(ang) || 1e-6), (b.b - b.t) / 2 / Math.abs(Math.sin(ang) || 1e-6));
      setStyle(a, 'display', 'block');
      // The arrows' layer is zoomed by the interface scale.
      setStyle(a, 'left', Math.round(cx + Math.cos(ang) * k) / zoom + 'px');
      setStyle(a, 'top', Math.round(cy + Math.sin(ang) * k) / zoom + 'px');
      setClass(a, `edge ${t.cls}${Math.cos(ang) > 0.2 ? ' east' : ''}`);
      setStyle(a._tri, 'transform', `rotate(${ang.toFixed(3)}rad)`);
      setText(a._lbl, t.label);
      a._x = t.x; a._z = t.z;
    }
  }
}
