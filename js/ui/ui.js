// UI coordinator: owns the HUD modules and routes sim events to them.
import { $, $$, esc, trueTrust, dropOrphanTip, setStyle, setText, ceilHours } from './dom.js';
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

// A lesson card fades after this many seconds, or at once when the next lesson arrives; the Field Manual keeps every
// lesson learned and can pin one back up (a pinned card stays until dismissed, and later lessons wait behind it).
const LESSON_S = 20;
const FADE_S = 0.6;

export class UI {
  constructor(app) {
    this.app = app;
    this.modals = app.modals;
    this.t = 0;
    this.mmT = 0;
    this.lessonQueue = [];
    this.lessonT = 0;
    this.fadeT = 0;
    this.pinned = false;
  }

  // (Re)build every HUD module for the current sim.
  bind() {
    const app = this.app;
    $('#hud').hidden = false;
    $('#alerts').innerHTML = '';
    $('#letters').innerHTML = '';
    // A card from the last game (a pinned one would never leave) goes with it.
    this.dismissLesson();
    this.lessonQueue = [];
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

  showLesson(key, pinned = false) {
    const l = LESSONS[key], el = $('#lesson');
    this.current = key;
    this.pinned = pinned;
    el.innerHTML = `<h4><span>📘 ${esc(l.title)}${pinned ? ' <small>📌</small>' : ''}</span><button class="x" title="Dismiss">✕</button></h4><p>${esc(l.text)}</p>${l.do ? `<p style="margin-top:4px"><b>${esc(l.do)}</b></p>` : ''}`;
    el.classList.remove('fade');
    el.classList.add('show');
    $('.x', el).addEventListener('click', () => this.dismissLesson());
    this.lessonT = LESSON_S;
    this.fadeT = 0;
  }

  // From the Field Manual: the lesson back on screen until dismissed.
  pinLesson(key) {
    this.lessonQueue = this.lessonQueue.filter((k) => k !== key);
    this.showLesson(key, true);
  }

  fadeLesson() { $('#lesson').classList.add('fade'); this.current = null; this.pinned = false; this.fadeT = FADE_S; }

  dismissLesson() { $('#lesson').classList.remove('show', 'fade'); this.current = null; this.pinned = false; this.lessonT = 0; this.fadeT = 0; }

  renderLetters() {
    const s = this.app.sim.state;
    const sig = s.events.letters.map((l) => l.id).join();
    if (sig === this.letterSig) {
      for (const l of s.events.letters) { const el = document.querySelector(`[data-letter="${l.id}"] small.left`); if (el) setText(el, `${Math.max(0, ceilHours(l.until - s.time))} h`); }
      return;
    }
    this.letterSig = sig;
    const sim = this.app.sim;
    $('#letters').innerHTML = s.events.letters.map((l) => {
      const def = LETTER_BY_ID[l.defId];
      const text = def.text(sim, l.p);
      return `<div class="letter" data-letter="${l.id}"><h4>${esc(def.title)} <small class="left">${Math.max(0, ceilHours(l.until - s.time))} h</small></h4><p>${esc(text)}</p>
        ${def.choices.map((c, k) => `<button data-l="${l.id}" data-c="${k}">${esc(c.label)}${(def.default ?? 0) === k ? ' (default)' : ''}<small>${esc(trueTrust(typeof c.effect === 'function' ? c.effect(sim, l.p) : c.effect, trustLossMult(sim)))}</small></button>`).join('')}</div>`;
    }).join('');
    $$('#letters [data-l]').forEach((b) => b.addEventListener('click', () => this.app.cmd('letter', +b.dataset.l, +b.dataset.c)));
  }

  update(rdt) {
    if (!this.hud) return;
    this.t -= rdt;
    this.mmT -= rdt;
    if (this.current && !this.pinned) {
      this.lessonT -= rdt;
      if (this.lessonT <= 0 || this.lessonQueue.length) this.fadeLesson();
    }
    if (this.fadeT > 0) { this.fadeT -= rdt; if (this.fadeT <= 0) this.dismissLesson(); }
    if (!this.current && this.fadeT <= 0 && this.lessonQueue.length) this.showLesson(this.lessonQueue.shift());
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
    setStyle($('#pausebanner'), 'display', this.app.paused && !this.modals.open && !this.app.tutorial ? 'block' : 'none');
  }
}
