// The hover card: a small note beside the cursor naming what is under it (one of your buildings, a squad or a
// town) with its HP, what it is doing and, for producers, what it makes. It replaces nothing and goes when the
// cursor moves off.
import { BUILDINGS } from '../config/buildings.js';
import { UNITS } from '../config/units.js';
import { SPECIALTIES } from '../config/world.js';
import { workforce, buildingOutput } from '../sim/systems/economy.js';
import { squadStatus, buildingStatus, HP_COLORS, hpBand } from './overview.js';
import { $, esc, fmt, RES_META, uiScale } from './dom.js';

function townStatus(t) {
  if (t.status === 'fallen') return ['Fallen', 'bad'];
  if (t.status === 'scorched') return ['Scorched', 'bad'];
  if (t.sacrifice) return ['Sacrifice zone', 'bad'];
  if (t.quarantine) return ['Quarantined', 'warn'];
  if (t.alerted) return ['Outbreak', 'bad'];
  return ['Safe', ''];
}

function buildingLine(b, work) {
  const st = buildingStatus(b, work);
  if (st === 'under construction') return [`${b.progress > 0 && BUILDINGS[b.type].upgradeOf ? 'Upgrading' : 'Under construction'} ${Math.floor(b.progress * 100)}%`, 'warn'];
  if (st === 'idle') return ['Idle: no workers', 'bad'];
  if (st === 'damaged') return ['Damaged', 'bad'];
  if (BUILDINGS[b.type].toggle && !b.on) return ['Switched off', 'warn'];
  return ['Working', ''];
}

// What the card says about hover ({ kind: 'unit' | 'building' | 'town', id }), or null when that thing is gone.
// → { title, icon, hp, maxHp, status, tone ('' | 'warn' | 'bad'), output (per hour, buildings only), pop (towns) }
export function hoverInfo(sim, hover) {
  if (!hover) return null;
  if (hover.kind === 'town') {
    const info = sim.map.towns[hover.id], t = sim.state.towns[hover.id];
    if (!info || !t) return null;
    const [status, tone] = townStatus(t);
    return { title: `${info.capital ? '★ ' : ''}${info.name}`, icon: SPECIALTIES[info.specialty]?.icon || '', hp: null, maxHp: null, status, tone, output: null, pop: t.status === 'ok' ? t.pop : 0 };
  }
  const e = sim.byId(hover.id);
  // A squad at 0 HP is removed on the next tick.
  if (!e || e.gone || e.hp <= 0) return null;
  const hp = Math.ceil(e.hp), maxHp = Math.round(e.maxHp);
  if (hover.kind === 'unit') return { title: UNITS[e.type].name, icon: UNITS[e.type].icon, hp, maxHp, status: squadStatus(e), tone: '', output: null, pop: null };
  const work = workforce(sim);
  const [status, tone] = buildingLine(e, work);
  return { title: BUILDINGS[e.type].name, icon: BUILDINGS[e.type].icon, hp, maxHp, status, tone, output: buildingOutput(sim, e, work), pop: null };
}

function cardHtml(c) {
  const out = c.output ? Object.entries(c.output).map(([k, v]) => `<span>+${v.toFixed(1)} ${RES_META[k].icon}/h</span>`).join('') : '';
  const f = c.hp != null ? c.hp / c.maxHp : 0;
  return `<h4><span class="ic">${c.icon}</span>${esc(c.title)}</h4>`
    + (c.hp != null ? `<div class="hp"><i style="width:${(f * 100).toFixed(0)}%;background:${HP_COLORS[hpBand(f)]}"></i></div><p class="num">HP ${c.hp} / ${c.maxHp}</p>` : '')
    + (c.pop != null ? `<p class="num">👥 ${fmt(c.pop)}</p>` : '')
    + `<p class="${c.tone}">${esc(c.status)}</p>`
    + (out ? `<p class="out">${out}</p>` : '');
}

export class HoverCard {
  constructor(app) {
    this.app = app;
    this.el = $('#hovercard');
    this.t = 0;
    this.key = '';
    this.html = '';
    app.input.setHover(null);
    this.hide();
  }

  hide() { this.el.style.display = 'none'; this.key = ''; }

  update(rdt) {
    const { input, sim } = this.app;
    const h = input.hover;
    if (!sim || !h || input.buildType || input.actionId || this.app.ui.modals.open) { if (this.key) this.hide(); return; }
    // The text refreshes on the HUD's cadence, or at once when the cursor reaches something new.
    const key = `${h.kind}:${h.id}`;
    this.t -= rdt;
    if (key !== this.key || this.t <= 0) {
      this.t = 0.12;
      const c = hoverInfo(sim, h);
      if (!c) { input.setHover(null); this.hide(); return; }
      const html = cardHtml(c), shown = !!this.key;
      this.key = key;
      if (html !== this.html || !shown) {
        if (html !== this.html) { this.el.innerHTML = html; this.html = html; }
        this.el.style.display = 'block';
        this.w = this.el.offsetWidth; this.h = this.el.offsetHeight;
      }
    }
    // Beside the cursor, flipped to its other side near the right and bottom edges. The card is zoomed by the
    // interface scale: its size grows by it and the screen position is divided by it.
    const m = input.mouse, z = uiScale(), w = this.w * z, hh = this.h * z;
    let x = m.x + 16, y = m.y + 16;
    if (x + w > innerWidth - 4) x = m.x - 16 - w;
    if (y + hh > innerHeight - 4) y = m.y - 16 - hh;
    this.el.style.left = Math.max(4, x) / z + 'px';
    this.el.style.top = Math.max(4, y) / z + 'px';
  }
}
