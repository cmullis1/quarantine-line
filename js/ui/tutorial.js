// Basic Training controller: shows the current objective, highlights its target, advances when done.
import { $, esc } from './dom.js';
import { TUTORIAL } from '../config/tutorial.js';

export class Tutorial {
  constructor(app) {
    this.app = app;
    this.i = -1;
    this.mem = {};
    this.ringT = 0;
    this.el = document.createElement('div');
    this.el.id = 'tutorial';
    this.el.className = 'panel';
    document.getElementById('hud').appendChild(this.el);
    this.hl = document.createElement('div');
    this.hl.id = 'tut-hl';
    document.body.appendChild(this.hl);
    this.next();
  }

  get step() { return TUTORIAL[this.i]; }

  next() {
    this.i++;
    this.mem = {};
    const st = this.step;
    if (!st) { this.finish(); return; }
    this.app.sim.state.tutorial = { step: this.i };
    if (st.setup) st.setup(this.app, this.mem);
    this.render();
    this.app.audio.ui('open');
  }

  render() {
    const st = this.step;
    const keys = (st.keys || []).map((k) => `<kbd>${esc(k)}</kbd>`).join(' ');
    this.el.innerHTML = `<div class="tut-head"><span>BASIC TRAINING · ${this.i + 1}/${TUTORIAL.length}</span><span class="tut-bar"><i style="width:${(this.i / TUTORIAL.length) * 100}%"></i></span></div>
      <h3>${esc(st.title)}</h3><p>${esc(st.text)}</p>${keys ? `<div class="tut-keys">${keys}</div>` : ''}
      <div class="tut-btns">${st.info ? '<button data-t="continue" class="primary">Continue</button>' : ''}<button data-t="skip">Skip step</button><button data-t="end">End training</button></div>`;
    this.el.querySelector('[data-t="skip"]').onclick = () => this.next();
    this.el.querySelector('[data-t="end"]').onclick = () => this.finish(true);
    const c = this.el.querySelector('[data-t="continue"]');
    if (c) c.onclick = () => this.next();
  }

  finish(early = false) {
    this.hl.style.display = 'none';
    this.el.remove();
    this.hl.remove();
    this.app.tutorial = null;
    const m = this.app.ui.modals;
    m.show(`<div class="card"><div class="stamp">${early ? 'TRAINING ENDED' : 'TRAINING COMPLETE'}</div><h1>${early ? 'Ready when you are' : 'You are ready'}</h1>
      <p>${early ? 'You can return to Basic Training from the main menu at any time.' : 'You have built, screened, quarantined, legislated, researched, promised and held a pass. The real thing will not wait for you to read the manual.'}</p>
      <div class="choices"><button data-a="campaign"><b>Begin the campaign</b><small>Veteran · Day 1, 07:00</small></button><button data-a="menu"><b>Main menu</b></button></div></div>`, 'tutorialDone');
    m.el.querySelector('[data-a="campaign"]').onclick = () => { m.close(); this.app.newGame({ mode: 'campaign', difficulty: 'veteran', seed: 1 }); };
    m.el.querySelector('[data-a="menu"]').onclick = () => { m.close(); this.app.mainMenu(); };
  }

  update(rdt) {
    const st = this.step;
    if (!st) return;
    if (!st.info && st.done && st.done(this.app, this.mem)) {
      this.app.toast(`✔ ${st.title}`);
      this.next();
      return;
    }
    // Highlight
    const t = st.target;
    let shown = false;
    if (t?.dom) {
      const el = document.querySelector(t.dom);
      if (el && el.offsetParent !== null) {
        const r = el.getBoundingClientRect();
        Object.assign(this.hl.style, { display: 'block', left: r.left - 4 + 'px', top: r.top - 4 + 'px', width: r.width + 8 + 'px', height: r.height + 8 + 'px' });
        shown = true;
      }
    }
    if (!shown) this.hl.style.display = 'none';
    if (t?.world) {
      this.ringT -= rdt;
      const p = t.world(this.app.sim);
      if (p && this.ringT <= 0) { this.ringT = 1.1; this.app.fx.ring(p[0], p[1], 0xf2c335, 2.4, 0.4, 1, 0.08, 0.95); }
    }
  }
}
