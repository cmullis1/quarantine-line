// Build menu (tabs + grid hotkeys) and government actions bar (F1–F4). Closed, the build menu folds to its tab
// strip; B or a tab opens the grid, B, Esc or its fold button folds it again, and placing leaves it open. The ARMY
// tab trains units without hunting for the right building: a click queues one at the least busy building that trains
// it (shift-click: five).
// A button that cannot be used says why on itself: 🔒 and what unlocks it, a red chip for each resource short, or
// (actions) a ring with the hours of cooldown left.
import { $, $$, costHtml, needHtml, tipOn, esc, reach, setText } from './dom.js';
import { BUILDINGS, TABS, GRID_KEYS, WEAPONS } from '../config/buildings.js';
import { UNITS } from '../config/units.js';
import { ACTIONS } from '../config/actions.js';
import { RESEARCH_BY_ID } from '../config/research.js';
import { isUnlocked, unitUnlocked } from '../sim/commands.js';

const MENU_TABS = [...TABS, { id: 'army', label: 'Army' }];
const ARMY = Object.keys(UNITS);
const QUEUE_MAX = 5;

const trainersOf = (sim, type) => sim.state.ents.buildings.filter((b) => BUILDINGS[b.type].trains?.includes(type));
const trainedAt = (type) => Object.keys(BUILDINGS).filter((t) => BUILDINGS[t].trains?.includes(type)).map((t) => BUILDINGS[t].name);
const researchFor = (type) => RESEARCH_BY_ID[UNITS[type].requires].name;

// The reason strip, rewritten only when it changes.
function why(b, html) {
  const el = b.querySelector('.why');
  if (el._h !== html) { el.innerHTML = html; el._h = html; }
}

export class BuildBar {
  constructor(app) {
    this.app = app;
    this.tab = 'defense';
    this.open = false;
    this.render();
    this.renderActions();
  }

  items(tab) {
    return Object.entries(BUILDINGS).filter(([, d]) => d.tab === tab).sort((a, b) => a[1].grid - b[1].grid);
  }

  render() {
    const el = $('#build');
    const grid = this.tab === 'army'
      ? ARMY.map((type, k) => `<button class="bbtn" data-unit="${type}"><span class="bi">${UNITS[type].icon}</span><span class="bn">${UNITS[type].name}</span><kbd>${GRID_KEYS[k]}</kbd><i class="qn"></i><span class="why"></span></button>`).join('')
      : this.items(this.tab).map(([type, d]) => `<button class="bbtn" data-type="${type}"><span class="bi">${d.icon}</span><span class="bn">${d.name}</span><kbd>${GRID_KEYS[d.grid]}</kbd><span class="why"></span></button>`).join('');
    const hint = this.open ? '<kbd>B</kbd> <kbd>Esc</kbd> close · <kbd>Tab</kbd> next tab' : '<kbd>B</kbd> build menu';
    el.innerHTML = `<div class="btabs">${MENU_TABS.map((t) => `<button data-tab="${t.id}" class="${this.open && t.id === this.tab ? 'on' : ''}">${t.label.toUpperCase()}</button>`).join('')}<span class="hint">${hint}</span>${this.open ? '<button class="fold" data-fold title="Fold the build menu (B or Esc)">▾</button>' : ''}</div>
      ${this.open ? `<div class="bgrid">${grid}</div>` : ''}`;
    $$('[data-tab]', el).forEach((b) => b.addEventListener('click', () => { this.tab = b.dataset.tab; this.setOpen(true); }));
    $('[data-fold]', el)?.addEventListener('click', () => { this.setOpen(false); if (this.app.input.buildType) this.app.input.setBuild(null); });
    $$('[data-unit]', el).forEach((b) => {
      const type = b.dataset.unit, d = UNITS[type];
      b.addEventListener('click', (e) => this.train(type, e.shiftKey ? 5 : 1));
      tipOn(b, () => {
        const sim = this.app.sim, w = WEAPONS[d.weapon];
        const ready = trainersOf(sim, type).some((x) => x.built);
        const where = `Trained at: ${trainedAt(type).join(', ')}`;
        const lock = unitUnlocked(sim, type) ? '' : `<br><span class="bad">Requires ${researchFor(type)}</span>`;
        return `<b>${d.name}</b> <kbd>${GRID_KEYS[ARMY.indexOf(type)]}</kbd><br>${esc(d.desc)}<br><span class="hint">HP ${d.hp} · range ${reach(w)} · speed ${d.speed} · train ${d.train} h</span><br><span class="${ready ? 'hint' : 'bad'}">${where}${ready ? '' : ': build one first'}</span>${lock}<div class="tipcost">${costHtml(d.cost, sim.state.res)} · upkeep ${costHtml(d.upkeep)}/h</div><span class="hint">Click: train one · Shift-click: five</span>`;
      });
    });
    $$('[data-type]', el).forEach((b) => {
      const type = b.dataset.type, d = BUILDINGS[type];
      b.addEventListener('click', () => this.app.input.setBuild(this.app.input.buildType === type ? null : type));
      tipOn(b, () => {
        const sim = this.app.sim;
        const lock = !isUnlocked(sim, type) ? `<br><span class="bad">Requires ${RESEARCH_BY_ID[d.unlock].name}</span>` : '';
        const w = d.weapon ? WEAPONS[d.weapon] : null;
        const stats = [`HP ${d.hp}`, `build ${d.build} h`, w ? `range ${w.range}` : null, d.size === 2 ? '2×2' : null].filter(Boolean).join(' · ');
        return `<b>${d.name}</b> <kbd>${GRID_KEYS[d.grid]}</kbd><br>${esc(d.desc)}<br><span class="hint">${stats}</span>${lock}<div class="tipcost">${costHtml(d.cost, sim.state.res)}${d.upkeep ? ` · upkeep ${costHtml(d.upkeep)}/h` : ''}</div>`;
      });
    });
  }

  // Queue n of a unit, each at the trainer with the shortest queue.
  train(type, n = 1) {
    const sim = this.app.sim;
    const all = trainersOf(sim, type);
    if (!unitUnlocked(sim, type)) {
      this.app.toast(`${UNITS[type].name}: research ${researchFor(type)} first.`, true);
      this.app.audio.ui('error');
      return;
    }
    if (!all.some((b) => b.built)) {
      this.app.toast(`${UNITS[type].name}: build a ${trainedAt(type).join(' or ')} first.`, true);
      this.app.audio.ui('error');
      return;
    }
    for (let q = 0; q < n; q++) {
      const open = all.filter((b) => b.built && b.queue.length < QUEUE_MAX).sort((a, b) => a.queue.length - b.queue.length || a.id - b.id);
      if (!open.length) { this.app.toast('Every training queue is full.', true); return; }
      if (!this.app.cmd('train', open[0].id, type).ok) return;
    }
  }

  setOpen(open) { this.open = open; this.render(); }
  nextTab() { const i = MENU_TABS.findIndex((t) => t.id === this.tab); this.tab = MENU_TABS[(i + 1) % MENU_TABS.length].id; this.render(); }
  hotkey(key) {
    const k = GRID_KEYS.indexOf(key.toUpperCase());
    if (k < 0) return false;
    if (this.tab === 'army') {
      if (!ARMY[k]) return false;
      this.train(ARMY[k]);
      return true;
    }
    const item = this.items(this.tab).find(([, d]) => d.grid === k);
    if (!item) return false;
    this.app.input.setBuild(item[0]);
    return true;
  }

  renderActions() {
    const el = $('#actions');
    el.innerHTML = Object.entries(ACTIONS).map(([id, a]) => `<button class="abtn" data-act="${id}"><kbd>${a.key}</kbd><span class="bi">${a.icon}</span><span class="cd"><b></b></span><span class="bn">${a.name}</span><span class="why"></span></button>`).join('');
    $$('[data-act]', el).forEach((b) => {
      const id = b.dataset.act, a = ACTIONS[id];
      b.addEventListener('click', () => this.app.input.useAction(id));
      tipOn(b, () => {
        const s = this.app.sim.state;
        const cd = Math.max(0, (s.cooldowns[id] || 0) - s.time);
        return `<b>${a.name}</b> <kbd>${a.key}</kbd><br>${esc(a.desc)}<div class="tipcost">${costHtml(a.cost, s.res)} · cooldown ${a.cooldown} h${cd > 0 ? ` <span class="warn">(${Math.ceil(cd)} h left)</span>` : ''}</div>${a.requires ? `<span class="hint">Requires a ${BUILDINGS[a.requires].name}.</span>` : ''}`;
      });
    });
  }

  update() {
    const sim = this.app.sim, s = sim.state, inp = this.app.input;
    $$('#build [data-type]').forEach((b) => {
      const type = b.dataset.type, d = BUILDINGS[type];
      const open = isUnlocked(sim, type), afford = sim.canAfford(d.cost);
      b.classList.toggle('on', inp.buildType === type);
      b.classList.toggle('locked', !open);
      b.classList.toggle('short', open && !afford);
      why(b, !open ? `🔒 ${RESEARCH_BY_ID[d.unlock].name}` : afford ? '' : needHtml(d.cost, s.res));
    });
    $$('#build [data-unit]').forEach((b) => {
      const type = b.dataset.unit, all = trainersOf(sim, type);
      const queued = all.reduce((n, x) => n + x.queue.filter((t) => t === type).length, 0);
      const ready = all.some((x) => x.built), open = unitUnlocked(sim, type), afford = sim.canAfford(UNITS[type].cost);
      b.classList.toggle('locked', !ready || !open);
      b.classList.toggle('short', ready && open && !afford);
      // Research first: a building alone will not unlock it.
      why(b, !open ? `🔒 ${researchFor(type)}` : !ready ? `🔒 ${trainedAt(type)[0]}` : afford ? '' : needHtml(UNITS[type].cost, s.res));
      setText(b.querySelector('.qn'), queued ? `+${queued}` : '');
    });
    $$('#actions .abtn').forEach((b) => {
      const id = b.dataset.act, a = ACTIONS[id];
      const cd = Math.max(0, (s.cooldowns[id] || 0) - s.time);
      const missing = !!a.requires && !s.ents.buildings.some((x) => x.type === a.requires && x.built);
      const afford = sim.canAfford(a.cost);
      // The ring empties as the cooldown runs out; the hours left sit inside it.
      const ring = b.querySelector('.cd'), deg = cd > 0 ? Math.round((cd / a.cooldown) * 360) : 0;
      if (ring._d !== deg) { ring.style.setProperty('--cd', `${deg}deg`); ring._d = deg; }
      const left = cd > 0 ? `${Math.ceil(cd)}h` : '';
      if (ring.firstChild.textContent !== left) ring.firstChild.textContent = left;
      b.classList.toggle('cool', cd > 0);
      b.classList.toggle('locked', missing);
      b.classList.toggle('short', !missing && !afford);
      b.classList.toggle('on', inp.actionId === id);
      why(b, missing ? `🔒 ${BUILDINGS[a.requires].name}` : afford ? '' : needHtml(a.cost, s.res));
    });
  }
}
