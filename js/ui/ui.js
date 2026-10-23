// UI coordinator: owns the HUD modules and routes sim events to them.
import { $, $$, esc, trueTrust, dropOrphanTip } from './dom.js';
import { trustLossMult } from '../sim/systems/economy.js';
import { Hud } from './hud.js';
import { Panels } from './panels.js';
import { BuildBar } from './buildbar.js';
import { Selection } from './selection.js';
import { Alerts } from './alerts.js';
import { Minimap } from './minimap.js';
import { Groups } from './groups.js';
import { Labels } from './labels.js';
import { HoverCard } from './hovercard.js';
import { LESSONS } from '../config/lessons.js';
import { LETTER_BY_ID } from '../config/letters.js';

export class UI {
  constructor(app) {
    this.app = app;
    this.modals = app.modals;
    this.t = 0;
    this.mmT = 0;
    this.lessonQueue = [];
    this.lessonT = 0;
  }

  // (Re)build every HUD module for the current sim.
  bind() {
    const app = this.app;
    $('#hud').hidden = false;
    $('#alerts').innerHTML = '';
    $('#letters').innerHTML = '';
    this.hud = new Hud(app);
    this.panels = new Panels(app);
    this.build = new BuildBar(app);
    this.selection = new Selection(app);
    this.alerts = new Alerts(app);
    this.minimap = new Minimap(app);
    this.labels = new Labels(app);
    this.groups = new Groups(app);
    this.hovercard = new HoverCard(app);
    this.letterSig = '';
    for (const a of [...app.sim.state.log].reverse().slice(-20)) this.alerts.push(a, true);
  }

  hide() { $('#hud').hidden = true; $('#labels').innerHTML = ''; $('#arrows').innerHTML = ''; this.hovercard?.hide(); }

  onEvents(events) {
    const app = this.app;
    for (const e of events) {
      switch (e.type) {
        case 'alert': this.alerts.push(e); break;
        case 'lesson': this.lesson(e.key); break;
        case 'act': this.modals.act(e); break;
        case 'over': this.modals.over(app.sim.state.over); break;
        case 'hordeContact': if (app.settings.pauseOnContact) app.paused = true; break;
        default: break;
      }
    }
  }

  lesson(key, force = false) {
    if (!LESSONS[key] || this.app.sim?.state.mode === 'tutorial') return;
    if (!force && !this.app.settings.hints) return;
    if (this.app.sim) {
      const f = this.app.sim.state.lessons.fired;
      if (!f.includes(key)) f.push(key);
    }
    if (this.current === key || this.lessonQueue.includes(key)) return;
    this.lessonQueue.push(key);
  }

  showLesson(key) {
    const l = LESSONS[key], el = $('#lesson');
    this.current = key;
    el.innerHTML = `<h4><span>📘 ${esc(l.title)}</span><button class="x" title="Dismiss">✕</button></h4><p>${esc(l.text)}</p>${l.do ? `<p style="margin-top:4px"><b>${esc(l.do)}</b></p>` : ''}`;
    el.classList.add('show');
    $('.x', el).addEventListener('click', () => this.dismissLesson());
    this.lessonT = 22;
  }

  dismissLesson() { $('#lesson').classList.remove('show'); this.current = null; this.lessonT = 0; }

  renderLetters() {
    const s = this.app.sim.state;
    const sig = s.events.letters.map((l) => l.id).join();
    if (sig === this.letterSig) {
      for (const l of s.events.letters) { const el = document.querySelector(`[data-letter="${l.id}"] small.left`); if (el) el.textContent = `${Math.max(0, Math.ceil(l.until - s.time))} h`; }
      return;
    }
    this.letterSig = sig;
    const sim = this.app.sim;
    $('#letters').innerHTML = s.events.letters.map((l) => {
      const def = LETTER_BY_ID[l.defId];
      const text = def.text(sim, l.p);
      return `<div class="letter" data-letter="${l.id}"><h4>${esc(def.title)} <small class="left">${Math.ceil(l.until - s.time)} h</small></h4><p>${esc(text)}</p>
        ${def.choices.map((c, k) => `<button data-l="${l.id}" data-c="${k}">${esc(c.label)}${(def.default ?? 0) === k ? ' (default)' : ''}<small>${esc(trueTrust(typeof c.effect === 'function' ? c.effect(sim, l.p) : c.effect, trustLossMult(sim)))}</small></button>`).join('')}</div>`;
    }).join('');
    $$('[data-l]').forEach((b) => b.addEventListener('click', () => this.app.cmd('letter', +b.dataset.l, +b.dataset.c)));
  }

  update(rdt) {
    if (!this.hud) return;
    this.t -= rdt;
    this.mmT -= rdt;
    if (this.lessonT > 0) { this.lessonT -= rdt; if (this.lessonT <= 0) this.dismissLesson(); }
    if (!this.current && this.lessonQueue.length) this.showLesson(this.lessonQueue.shift());
    this.labels.update();
    this.groups.update(rdt);
    this.hovercard.update(rdt);
    this.alerts.updateArrows();
    if (this.t <= 0) {
      this.t = 0.12;
      this.hud.update();
      this.panels.render();
      this.build.update();
      this.selection.render();
      this.renderLetters();
      dropOrphanTip();
    }
    if (this.mmT <= 0) { this.mmT = 0.15; this.minimap.draw(0.15); }
    $('#pausebanner').style.display = this.app.paused && !this.modals.open && !this.app.tutorial ? 'block' : 'none';
  }
}
