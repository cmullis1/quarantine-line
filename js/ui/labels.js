// Floating labels over the world: towns, border crossings, hordes in contact, and status markers over buildings.
import { $, fmt, RES_META, uiScale } from './dom.js';
import { SPECIALTIES } from '../config/world.js';
import { BUILDINGS } from '../config/buildings.js';
import { SPREAD } from '../config/balance.js';
import { breakoutThreshold } from '../sim/systems/towns.js';
import { buildingMarker, townSpecialty, PRODUCER_COLORS } from './overview.js';

const STANCE_ICON = { open: '🟢', screened: '🟡', closed: '🔴', shoot: '☠' };
// More markers than this is noise, and DOM work every frame.
const MAX_MARKERS = 80;

// Each resource in the colour of the producer that makes it (food is the farms' green, funds the factories' blue).
const RES_COLOR = {};
for (const [type, c] of Object.entries(PRODUCER_COLORS)) for (const k of Object.keys(BUILDINGS[type]?.produce || {})) RES_COLOR[k] ||= c;

// Under the economy overlay a living town's label says what its specialty makes now, edged in the colour of what
// it makes first; a quarantined town's says it has stopped. A rail yard always speeds training (any living town).
function specialtyLine(sim, t) {
  const sp = townSpecialty(sim, t), out = Object.entries(sp.output);
  const body = sp.spec.trainBonus ? `trains +${Math.round(sp.spec.trainBonus * 100)}%`
    : out.length ? out.map(([k, v]) => `+${+v.toFixed(2)} ${RES_META[k].icon}/h`).join(' ') : 'stopped';
  const edge = out.length ? RES_COLOR[out[0][0]] || '' : body === 'stopped' ? PRODUCER_COLORS.idle : '';
  return `<span class="econ${body === 'stopped' ? ' off' : ''}"${edge ? ` style="border-color:${edge}"` : ''}><span class="sp">${sp.icon}</span>${body}</span>`;
}

// Above both the building's HP bar and whatever is drawn there (a crane over a site stands taller than the bar).
const markerY = (app, b) => Math.max(app.entities.barY(b), app.entities.topOf(b)) + 0.3;

export class Labels {
  constructor(app) {
    this.app = app;
    const box = $('#labels');
    box.innerHTML = '';
    const sim = app.sim;
    this.towns = sim.map.towns.map((info) => {
      const el = document.createElement('div');
      el.className = 'clabel' + (info.capital ? ' cap' : '');
      el.dataset.town = info.id;
      el.addEventListener('click', () => app.select({ town: info.id }));
      box.appendChild(el);
      return el;
    });
    this.cross = sim.map.crossings.map(() => {
      const el = document.createElement('div');
      el.className = 'xlabel';
      box.appendChild(el);
      return el;
    });
    // Foreign cities: where the roads, the refugees and the dead come from.
    this.sites = sim.map.sites.map(() => {
      const el = document.createElement('div');
      el.className = 'slabel';
      box.appendChild(el);
      return el;
    });
    this.hordes = [];
    this.marks = [];
    this.markW = new Map(); // building id → its marker's last measured width, in screen pixels
    this.box = box;
    this.z = 1;
  }

  place(el, x, y, z, html) {
    const [sx, sy, vis] = this.app.view.project(x, y, z);
    this.put(el, sx, sy, vis && this.fits(sx, sy, (el.offsetWidth || 160) * this.z), html);
  }

  // A label is centred on its anchor, so it would hang off the screen within half its width of an edge: hide it
  // there rather than let it overflow.
  fits(sx, sy, w) { return sx > w / 2 && sx < innerWidth - w / 2 && sy > 0; }

  // The layer is zoomed by the interface scale, so the screen point is divided by it.
  put(el, sx, sy, show, html) {
    el.style.display = show ? '' : 'none';
    if (!show) return false;
    el.style.transform = `translate(${Math.round(sx) / this.z}px, ${Math.round(sy) / this.z}px) translate(-50%, -100%)`;
    if (el._h === html) return false;
    el.innerHTML = html; el._h = html;
    return true;
  }

  // One marker per building with something to say, on the screen, nearest the middle first. The pool only grows,
  // and a marker's width is measured only when its text changes.
  markers() {
    const view = this.app.view, cx = innerWidth / 2, cy = innerHeight / 2;
    const list = [];
    for (const b of this.app.sim.state.ents.buildings) {
      if (b.gone) continue;
      const m = buildingMarker(this.app.sim, b);
      if (!m) continue;
      const [sx, sy, vis] = view.project(b.x, markerY(this.app, b), b.z);
      // The edge test comes before the cap, so a marker that would be hidden never takes one of its places.
      if (vis && sy < innerHeight && this.fits(sx, sy, this.markW.get(b.id) || 64)) list.push({ id: b.id, m, sx, sy, d: (sx - cx) ** 2 + (sy - cy) ** 2 });
    }
    if (list.length > MAX_MARKERS) { list.sort((a, b) => a.d - b.d); list.length = MAX_MARKERS; }
    while (this.marks.length < list.length) {
      const el = document.createElement('div'); el.className = 'bmark'; el._w = 64; this.box.appendChild(el); this.marks.push(el);
    }
    this.marks.forEach((el, n) => {
      const it = list[n];
      if (!it) { if (el.style.display !== 'none') el.style.display = 'none'; return; }
      const { id, m, sx, sy } = it;
      if (el._id !== id) { el.dataset.b = id; el._id = id; }
      if (el._lv !== m.level) { el.className = 'bmark' + (m.level ? ' ' + m.level : ''); el._lv = m.level; }
      if (this.put(el, sx, sy, true, `<span class="ic">${m.icon}</span>${m.text}`)) this.markW.set(id, el.offsetWidth * this.z);
    });
  }

  update() {
    const sim = this.app.sim, s = sim.state;
    // A new scale changes every measured width.
    if (uiScale() !== this.z) { this.z = uiScale(); this.markW.clear(); }
    const thr = breakoutThreshold(sim), econ = this.app.overlay === 'economy';
    sim.map.towns.forEach((info, k) => {
      const t = s.towns[k];
      let st = '';
      if (t.status === 'fallen') st = t.reclaimT > 0 ? `<span class="st rec">RECLAIMING ${Math.floor((t.reclaimT / SPREAD.reclaimHours) * 100)}%</span>` : '<span class="st fallen">☠ FALLEN</span>';
      else if (t.status === 'scorched') st = t.reclaimT > 0 ? `<span class="st rec">RECLAIMING ${Math.floor((t.reclaimT / SPREAD.reclaimHours) * 100)}%</span>` : '<span class="st fallen">SCORCHED</span>';
      else if (t.infected > thr && t.alerted) st = `<span class="st bad">☣ BREAKOUT ~${fmt(t.reported)}</span>`;
      else if (t.alerted) st = `<span class="st warn">☣ OUTBREAK ~${fmt(t.reported)}</span>`;
      else if (t.sacrifice) st = '<span class="st sac">SACRIFICE ZONE</span>';
      else if (t.quarantine) st = '<span class="st q">QUARANTINE</span>';
      const spec = SPECIALTIES[info.specialty], line = econ && t.status === 'ok' ? specialtyLine(sim, t) : '';
      const html = `<b>${line ? '' : `<span class="sp">${spec.icon}</span>`}${info.capital ? '★ ' : ''}${info.name}</b><span class="pop">${t.status === 'ok' ? fmt(t.pop) : ''}</span>${line}${st}`;
      this.place(this.towns[k], info.x, 2, info.z, html);
      this.towns[k].classList.toggle('sel', this.app.sel.town === k);
    });
    sim.map.crossings.forEach((c, k) => {
      const el = this.cross[k];
      const waiting = s.ents.refugees.filter((r) => r.crossId === c.id && (r.mode === 'waiting')).length;
      // Every crossing carries its name, so a minister's "the Orsk crossing" can be found on the map.
      this.place(el, c.oi + 0.5 + c.dx * 2, 0.6, c.oj + 0.5 + c.dz * 2, `${sim.map.sites[c.siteId].name} crossing${waiting ? ` · ${STANCE_ICON[s.border]} ${waiting} waiting` : ''}`);
    });
    sim.map.sites.forEach((site, k) => {
      this.place(this.sites[k], site.x, 1.2, site.z, `${s.flags.sitesFallen ? '☠' : '🏚'} ${site.name}`);
    });
    const contacts = s.hordes.filter((h) => h.phase === 'contact');
    while (this.hordes.length < contacts.length) {
      const el = document.createElement('div'); el.className = 'hlabel'; this.box.appendChild(el); this.hordes.push(el);
    }
    this.hordes.forEach((el, n) => {
      const h = contacts[n];
      if (!h) { el.style.display = 'none'; return; }
      let lead = null;
      for (const z of s.ents.dead) if (z.horde === h.id && !z.gone && sim.visible(z.x, z.z)) { lead = z; break; }
      if (!lead) { el.style.display = 'none'; return; }
      this.place(el, lead.x, 1.4, lead.z, `⚠ ${h.label ? h.label.toUpperCase() + ' · ' : ''}${h.members} DEAD`);
    });
    this.markers();
  }
}
