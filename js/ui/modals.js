// Modal screens: decisions, act banners, the ending + record, main/pause menus, settings, confirm, manual.
import { $, $$, esc, fmt, trueTrust, reach } from './dom.js';
import { DEFAULT_VOLUME } from '../audio/audio.js';
import { trustLossMult } from '../sim/systems/economy.js';
import { DECISION_BY_ID, ENDINGS } from '../config/campaign.js';
import { LESSONS, MANUAL_ORDER } from '../config/lessons.js';
import { UNITS } from '../config/units.js';
import { BUILDINGS, WEAPONS } from '../config/buildings.js';
import { DEAD } from '../config/dead.js';
import { LAW_BY_ID } from '../config/laws.js';
import { DIFFICULTY, WIN_DAY } from '../config/balance.js';

const CONTROLS = [
  ['WASD / arrows · middle-drag', 'Pan the camera (arrows only while the build menu is open)'],
  ['Mouse wheel · Q / E', 'Zoom · rotate'],
  ['Left click / drag', 'Select a unit, building or town · box-select (Shift adds)'],
  ['Double-click a unit', 'Select all of that type on screen (or All of type on the command card)'],
  ['Right click', 'Move (troops fire on the way) · rally point for a selected HQ/Barracks/Helipad'],
  ['Shift + right click', 'Attack-move: stop to fight anything in range (or Attack-move on the command card, then right-click)'],
  ['H · T · .', 'Hold position · stop · next idle unit'],
  ['Ctrl+1–9 · 1–9', 'Save control group · recall (double-tap to jump there)'],
  ['B · Tab · QWER/ASDF/ZXCV', 'Build menu · next build tab · pick a building'],
  ['ARMY tab (in the build menu)', 'Train units: click queues one at the HQ, Barracks or Helipad · Shift-click five'],
  ['U · Shift+U · I · Del', 'Upgrade the selected wall · its whole line · switch a lure on or off · demolish the selected building'],
  ['F1–F4', 'Recon · Airstrike · Broadcast · Conscription'],
  ['F5 · F6', 'FORCES tab (your army at a glance) · ECONOMY tab (producers, workers, flows)'],
  ['Space · + / −', 'Pause · faster / slower'],
  ['O · Home · Backspace', 'Cycle overlay (infection, economy, defence) · jump to capital · jump to the newest unseen critical alert, else the latest'],
  ['P · M · F10 · Esc', 'Pixel size · mute · Field Manual · menu'],
];

export class Modals {
  constructor(app) {
    this.app = app;
    this.el = $('#modal');
    this.open = false;
    this.kind = null;
  }

  show(html, kind) {
    this.el.innerHTML = html;
    this.el.classList.add('show');
    this.open = true;
    this.kind = kind;
    this.app.audio?.ui('open');
  }

  close() {
    if (this.open) this.app.audio?.ui('close');
    this.el.classList.remove('show');
    this.el.innerHTML = '';
    this.open = false;
    this.kind = null;
  }

  decision(id) {
    const d = DECISION_BY_ID[id], sim = this.app.sim;
    if (!d) return;
    this.show(`<div class="card event"><div class="stamp">PRIORITY CABLE</div><h1>${esc(d.title)}</h1>
      <p>${esc(d.text(sim)).replace(/\n/g, '<br>')}</p>
      <div class="choices">${d.choices.map((c, k) => `<button data-k="${k}"><b>${esc(c.label)}</b><small>${esc(trueTrust(c.effect, trustLossMult(this.app.sim)))}</small></button>`).join('')}</div></div>`, 'decision');
    $$('button[data-k]', this.el).forEach((b) => b.addEventListener('click', () => {
      this.close();
      this.app.cmd('decide', +b.dataset.k);
    }));
  }

  act(a) {
    const el = $('#banner');
    el.innerHTML = `<h1>${esc(a.title.split(': ')[1] || a.title).toUpperCase()}</h1><div class="line"></div><p>${esc(a.title.split(': ')[0])} · ${esc(a.sub)}</p>`;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }

  over(o) {
    const r = o.record, ending = ENDINGS.find((e) => e.id === o.ending);
    const decisions = r.decisions.map((d) => { const def = DECISION_BY_ID[d.id]; return def ? `Day ${d.day}: ${def.title.split(': ')[1] || def.title} → ${def.choices[d.choice].label}` : ''; }).join('<br>');
    const hasAuto = !!this.app.saves.read('auto');
    this.show(`<div class="card over ${o.won ? 'won' : 'lost'}"><div class="stamp">${o.won ? 'VALDMARK ENDURES' : 'DEFEAT'}</div><h1>${esc(ending.title)}</h1>
      <p>${esc(ending.text)}</p>
      <div class="record">
        <div><b>${r.days}</b><span>days</span></div><div><b>${r.towns}/${r.townsTotal}</b><span>towns standing</span></div>
        <div><b>${fmt(r.popSaved)}</b><span>people alive</span></div><div><b>${fmt(r.deaths)}</b><span>dead (true count)</span></div>
        <div><b>${r.admitted}</b><span>refugee groups admitted</span></div><div><b>${r.turnedAway}</b><span>turned away</span></div>
        <div><b>${r.shot}</b><span>shot at the border</span></div><div><b>${fmt(r.killed)}</b><span>of the dead put down</span></div>
        <div><b>${r.unitsLost}</b><span>units lost</span></div><div><b>${r.reclaimed}</b><span>towns reclaimed</span></div>
        <div><b>${r.promisesKept}/${r.promisesKept + r.promisesBroken}</b><span>promises kept</span></div><div><b>${fmt(o.score)}</b><span>score</span></div>
      </div>
      <p style="font-size:13px"><b>Laws you signed:</b> ${r.laws.length ? r.laws.map((l) => LAW_BY_ID[l].name).join(', ') : 'none'}.</p>
      <div class="decisions">${decisions || 'No decisions recorded.'}</div>
      <div class="choices">${!o.won && hasAuto ? '<button data-a="retry"><b>Retry from dawn</b><small>Load the autosave from the start of the day</small></button>' : ''}
        <button data-a="menu"><b>Main menu</b></button></div></div>`, 'over');
    $$('[data-a]', this.el).forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.a === 'retry') { this.close(); this.app.loadGame('auto'); }
      else { this.close(); this.app.mainMenu(); }
    }));
  }

  mainMenu() {
    const app = this.app, saves = app.saves;
    const auto = saves.meta('auto'), manual = saves.meta('manual');
    let mode = 'campaign', diff = 'veteran';
    const render = () => {
      this.show(`<div class="card menu"><div class="stamp">REPUBLIC OF VALDMARK · MINISTRY OF DEFENCE</div>
        <h1>QUARANTINE <span>LINE</span></h1>
        <p>Something is spreading across the continent. Today it reached us. Govern Valdmark from the first case to Day ${WIN_DAY}: walls and checkpoints, who gets in, what people are told, which towns are saved.</p>
        <div class="opts">
          <button data-mode="tutorial" class="${mode === 'tutorial' ? 'on' : ''}">Basic Training<small>~12 min, every system</small></button>
          <button data-mode="campaign" class="${mode === 'campaign' ? 'on' : ''}">Campaign<small>Valdmark, 50 days</small></button>
          <button data-mode="sandbox" class="${mode === 'sandbox' ? 'on' : ''}">Sandbox<small>random country, endless</small></button>
        </div>
        ${mode === 'tutorial' ? '' : `<div class="opts">${Object.entries(DIFFICULTY).map(([k, d]) => `<button data-diff="${k}" class="${diff === k ? 'on' : ''}">${d.label}<small>${k === 'recruit' ? 'forgiving' : k === 'veteran' ? 'intended' : 'merciless'}</small></button>`).join('')}</div>`}
        ${mode === 'sandbox' ? '<label class="row">Map seed <input id="seed" type="number" value="' + Math.floor(Math.random() * 9999 + 1) + '" style="width:100px"></label>' : ''}
        <label class="row"><input type="checkbox" id="hints" ${app.settings.hints ? 'checked' : ''}> Show Field Manual hints as things happen</label>
        <div class="choices">
          <button data-a="new"><b>${mode === 'tutorial' ? 'Begin training' : 'Take command'}</b><small>${mode === 'campaign' ? 'Day 1, 07:00' : mode === 'sandbox' ? 'A country you have never seen' : 'A guided first week'}</small></button>
          ${auto ? `<button data-a="auto"><b>Continue</b><small class="slot">${esc(auto)}</small></button>` : ''}
          ${manual ? `<button data-a="manual"><b>Load saved game</b><small class="slot">${esc(manual)}</small></button>` : ''}
          <button data-a="settings"><b>Settings</b></button>
        </div></div>`, 'menu');
      $$('[data-mode]', this.el).forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; render(); }));
      $$('[data-diff]', this.el).forEach((b) => b.addEventListener('click', () => { diff = b.dataset.diff; render(); }));
      $$('[data-a]', this.el).forEach((b) => b.addEventListener('click', () => {
        const a = b.dataset.a;
        app.settings.hints = $('#hints', this.el).checked;
        app.saveSettings();
        if (a === 'new') { const seed = mode === 'sandbox' ? +$('#seed', this.el).value || 1 : 1; this.close(); app.newGame({ mode, difficulty: mode === 'tutorial' ? 'recruit' : diff, seed }); }
        else if (a === 'auto' || a === 'manual') { this.close(); app.loadGame(a); }
        else if (a === 'settings') this.settings(() => render());
      }));
    };
    render();
  }

  // `resumeTo` carries the paused state from before the menu opened through its sub-cards.
  pauseMenu(resumeTo = this.app.paused) {
    const app = this.app;
    if (!app.sim) return;
    const wasPaused = resumeTo;
    app.paused = true;
    this.show(`<div class="card menu"><div class="stamp">PAUSED</div><h1>Cabinet Room</h1>
      <div class="choices">
        <button data-a="resume"><b>Resume</b></button>
        <button data-a="save"><b>Save game</b><small>Overwrites the manual slot</small></button>
        ${app.saves.meta('manual') ? `<button data-a="load"><b>Load saved game</b><small>${esc(app.saves.meta('manual'))}</small></button>` : ''}
        ${app.saves.meta('auto') ? `<button data-a="auto"><b>Retry from dawn</b><small>${esc(app.saves.meta('auto'))}</small></button>` : ''}
        <button data-a="manual-book"><b>Field Manual</b></button>
        <button data-a="settings"><b>Settings</b></button>
        <button data-a="quit"><b>Quit to main menu</b></button>
      </div></div>`, 'pause');
    $$('[data-a]', this.el).forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.a;
      if (a === 'resume') { this.close(); app.paused = wasPaused; }
      else if (a === 'save') { app.saveGame('manual'); this.close(); app.paused = wasPaused; app.toast('Game saved.'); }
      else if (a === 'load') { this.close(); app.loadGame('manual'); }
      else if (a === 'auto') { this.close(); app.loadGame('auto'); }
      else if (a === 'manual-book') this.manual('welcome', () => this.pauseMenu(wasPaused));
      else if (a === 'settings') this.settings(() => this.pauseMenu(wasPaused));
      else if (a === 'quit') { this.close(); app.mainMenu(); }
    }));
  }

  settings(back) {
    const app = this.app, st = app.settings;
    const vol = (k, label) => `<label>${label}<input type="range" min="0" max="100" value="${Math.round(st.volume[k] * 100)}" data-vol="${k}"></label>`;
    this.show(`<div class="card menu settings"><div class="stamp">SETTINGS</div><h1>Settings</h1>
      <label>Interface size<select id="s-ui">${[[0, 'Automatic'], [0.9, '90%'], [1, '100%'], [1.15, '115%'], [1.3, '130%'], [1.5, '150%']].map(([v, l]) => `<option value="${v}" ${st.uiScale === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Pixel size (low-res look)<select id="s-pixel">${[1, 2, 3, 4].map((p) => `<option value="${p}" ${st.pixel === p ? 'selected' : ''}>${p}×${p === 3 ? ' (default)' : ''}</option>`).join('')}</select></label>
      ${vol('master', 'Master volume')}${vol('sfx', 'Effects')}${vol('music', 'Music')}${vol('ambient', 'Ambience')}${vol('ui', 'Interface')}
      <label>Field Manual hints<input type="checkbox" id="s-hints" ${st.hints ? 'checked' : ''}></label>
      <label>Pause when a horde is sighted<input type="checkbox" id="s-pausehorde" ${st.pauseOnContact ? 'checked' : ''}></label>
      <label>Edge-of-screen panning<input type="checkbox" id="s-edge" ${st.edgePan ? 'checked' : ''}></label>
      <label>Screen shake<input type="checkbox" id="s-shake" ${st.shake ? 'checked' : ''}></label>
      <div class="choices"><button data-a="resetvol"><b>Reset sound levels</b></button><button data-a="back"><b>Done</b></button></div></div>`, 'settings');
    $$('[data-vol]', this.el).forEach((r) => r.addEventListener('input', () => { st.volume[r.dataset.vol] = r.value / 100; app.applySettings(); }));
    $('#s-pixel', this.el).addEventListener('change', (e) => { st.pixel = +e.target.value; app.applySettings(); });
    $('#s-ui', this.el).addEventListener('change', (e) => { st.uiScale = +e.target.value; app.applySettings(); });
    $('#s-hints', this.el).addEventListener('change', (e) => { st.hints = e.target.checked; });
    $('#s-pausehorde', this.el).addEventListener('change', (e) => { st.pauseOnContact = e.target.checked; });
    $('#s-edge', this.el).addEventListener('change', (e) => { st.edgePan = e.target.checked; });
    $('#s-shake', this.el).addEventListener('change', (e) => { st.shake = e.target.checked; });
    $('[data-a="back"]', this.el).addEventListener('click', () => { app.saveSettings(); this.close(); back?.(); });
    $('[data-a="resetvol"]', this.el).addEventListener('click', () => { st.volume = { ...DEFAULT_VOLUME }; st.muted = false; app.applySettings(); app.saveSettings(); this.settings(back); });
  }

  confirm(title, text, ok) {
    const wasPaused = this.app.paused;
    this.app.paused = true;
    this.show(`<div class="card"><div class="stamp">CONFIRM</div><h1>${esc(title)}</h1><p>${esc(text)}</p>
      <div class="choices"><button data-a="yes"><b>Yes, do it</b></button><button data-a="no"><b>No</b></button></div></div>`, 'confirm');
    $('[data-a="yes"]', this.el).addEventListener('click', () => { this.close(); this.app.paused = wasPaused; ok(); });
    $('[data-a="no"]', this.el).addEventListener('click', () => { this.close(); this.app.paused = wasPaused; });
  }

  manual(key = 'welcome', back = null) {
    const app = this.app;
    const wasPaused = app.paused;
    app.paused = true;
    const seen = new Set(app.sim ? app.sim.state.lessons.fired : []);
    const ref = {
      controls: () => `<table>${CONTROLS.map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`).join('')}</table>`,
      units: () => `<table>${Object.values(UNITS).map((u) => `<tr><td>${u.icon} <b>${u.name}</b></td><td>${esc(u.desc)}<br><small>HP ${u.hp} · ${u.weapon} (range ${reach(WEAPONS[u.weapon])}, ${WEAPONS[u.weapon].dmg} dmg) · speed ${u.speed}</small></td></tr>`).join('')}</table>`,
      buildings: () => `<table>${Object.values(BUILDINGS).filter((b) => b.tab).map((b) => `<tr><td>${b.icon} <b>${b.name}</b></td><td>${esc(b.desc)}</td></tr>`).join('')}</table>`,
      dead: () => `<table>${Object.entries(DEAD).map(([, d]) => `<tr><td><b>${d.name}</b></td><td>HP ${d.hp} · speed ${d.speed[0]}–${d.speed[1]} · bite ${d.dps}/h · walls ${d.wallDmg}/h${d.scream ? ' · screams' : ''}</td></tr>`).join('')}</table>`,
    };
    const render = (k) => {
      const body = ref[k] ? ref[k]() : `<h2 style="margin-bottom:6px">${esc(LESSONS[k].title)}</h2><p>${esc(LESSONS[k].text)}</p>${LESSONS[k].do ? `<p><b>${esc(LESSONS[k].do)}</b></p>` : ''}`;
      this.show(`<div class="card manual"><div class="stamp">FIELD MANUAL</div><h1>Field Manual</h1>
        <div class="cols"><div class="idx">${['controls', 'units', 'buildings', 'dead'].map((x) => `<button data-k="${x}" class="${x === k ? 'on' : ''}">${x[0].toUpperCase() + x.slice(1)}</button>`).join('')}<hr>
        ${MANUAL_ORDER.map((x) => `<button data-k="${x}" class="${x === k ? 'on' : ''} ${seen.has(x) ? '' : 'unseen'}">${esc(LESSONS[x].title)}</button>`).join('')}</div>
        <div>${body}</div></div>
        <div class="choices"><button data-a="close"><b>Close</b></button></div></div>`, 'manual');
      $$('[data-k]', this.el).forEach((b) => b.addEventListener('click', () => render(b.dataset.k)));
      $('[data-a="close"]', this.el).addEventListener('click', () => { this.close(); if (back) back(); else app.paused = wasPaused; });
    };
    render(key);
  }
}
