// Control-group badges above the build bar: which number keys hold which squads. Click a badge to select the
// group (as its number key does); the group matching the current selection is highlighted.
import { UNITS } from '../config/units.js';
import { $, esc } from './dom.js';

export class Groups {
  constructor(app) {
    this.app = app;
    this.el = $('#groups');
    this.t = 0;
    this.key = '';
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-g]');
      if (b) this.app.input.recallGroup(+b.dataset.g);
    });
  }

  update(rdt) {
    this.t -= rdt;
    if (this.t > 0) return;
    this.t = 0.25;
    const { input, sim, sel } = this.app;
    if (!sim) return;
    const live = [];
    for (let n = 1; n <= 9; n++) {
      const units = (input.groups[n] || []).map((id) => sim.byId(id)).filter(Boolean);
      if (units.length) live.push([n, units]);
    }
    const selected = [...sel.units].sort().join();
    const key = live.map(([n, us]) => `${n}:${us.map((u) => u.id).join('.')}`).join('|') + `#${selected}`;
    if (key === this.key) return;
    this.key = key;
    this.el.innerHTML = live.map(([n, units]) => {
      // The group's most common unit type stands for it.
      const counts = {};
      for (const u of units) counts[u.type] = (counts[u.type] || 0) + 1;
      const main = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      const on = units.map((u) => u.id).sort().join() === selected;
      return `<button data-g="${n}" class="${on ? 'on' : ''}" title="Group ${n}: ${esc(Object.entries(counts).map(([t, c]) => `${c} ${UNITS[t].name}`).join(', '))}"><kbd>${n}</kbd>${UNITS[main].icon}<b>${units.length}</b></button>`;
    }).join('');
  }
}
