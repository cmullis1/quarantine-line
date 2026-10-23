// Music lab (open the game with ?musiclab): pin each part of the score while the music plays and hear the
// difference by ear, pin an intensity level, set off the game's events and endings, and copy the chosen
// combination. Choices persist in this browser only while the lab is open; without ?musiclab the game always
// plays DEFAULT_STYLE. Hide (or F9) folds the panel to a small tab that keeps the choices playing.
import { STYLE_OPTIONS, DEFAULT_STYLE, validStyle } from '../audio/style.js';
import { HOOKS, RIFFS } from '../audio/harmony.js';
import { SONGS } from '../audio/songs.js';
import { esc } from './dom.js';

const KEY = 'ql.musiclab';
const LABELS = { song: 'Song', section: 'Section', mood: 'Mood', band: 'Band', groove: 'Groove', swing: 'Swing', melody: 'Melody', lead: 'Lead', shape: 'Shape' };
const LEVELS = [['auto', 'Follow the game'], ['-1', 'Paused'], ['0', 'Watchful'], ['1', 'Tension'], ['2', 'Combat'], ['3', 'Crisis']];
const LEVEL_NAME = Object.fromEntries(LEVELS.slice(1));
// The engine's labEvent types, as the game would send them.
const EVENTS = [['hordeContact', 'Horde sighted'], ['hordeArrived', 'Horde crosses'], ['fall', 'Town falls'], ['hordeDestroyed', 'Horde destroyed'], ['breakout', 'Breakout']];
const ENDINGS = [['victory', 'Victory'], ['defeat', 'Defeat']];
const MELODY_NAME = { hooks: 'hook', riff: 'riff', call: 'call and answer', anthem: 'anthem' };
const LEAD_NAME = { soft: 'soft lead', bell: 'glassy bell', synth: 'thick synth', celesta: 'celesta', piano: 'piano', dist: 'distorted lead', choir: 'choir', lowPiano: 'low piano' };

export class MusicLab {
  constructor(app) {
    this.app = app;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* storage unavailable: start from the default */ }
    this.style = validStyle(saved.style);
    this.level = LEVELS.some(([v]) => v === saved.level) ? saved.level : 'auto';
    this.hidden = saved.hidden === true;
    this.apply();
    this.el = document.createElement('div');
    this.el.id = 'musiclab';
    document.body.appendChild(this.el);
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.render();
    setInterval(() => this.showNow(), 250);
  }

  apply() {
    this.app.audio.setScoreStyle(this.style);
    this.app.audio.setLevelOverride(this.level === 'auto' ? null : +this.level);
    try { localStorage.setItem(KEY, JSON.stringify({ style: this.style, level: this.level, hidden: this.hidden })); } catch { /* not saved */ }
  }

  toggle() {
    this.hidden = !this.hidden;
    this.apply();
    this.render();
  }

  summary() { return Object.keys(DEFAULT_STYLE).map((k) => `${k}=${this.style[k]}`).join(' · '); }

  onClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    // An event changes no switch: the score answers it as it would in a game.
    if (b.dataset.ev) {
      this.app.audio.labEvent(b.dataset.ev);
      return;
    }
    if (b.dataset.k) this.style = { ...this.style, [b.dataset.k]: b.dataset.v };
    else if (b.dataset.level) this.level = b.dataset.level;
    else if (b.dataset.a === 'hide' || b.dataset.a === 'show') { this.toggle(); return; }
    else if (b.dataset.a === 'reset') { this.style = { ...DEFAULT_STYLE }; this.level = 'auto'; }
    else if (b.dataset.a === 'copy') {
      navigator.clipboard?.writeText(this.summary()).then(() => { b.textContent = 'Copied'; }, () => { b.textContent = 'Select the line above'; });
      return;
    }
    this.apply();
    this.render();
  }

  render() {
    this.el.classList.toggle('folded', this.hidden);
    if (this.hidden) {
      this.el.innerHTML = `<button data-a="show" class="ml-tab" title="Show the music lab (F9)">♪ Music lab</button>`;
      return;
    }
    const row = (label, buttons) => `<div class="ml-row"><span>${label}</span><div>${buttons}</div></div>`;
    const style = (k) => row(LABELS[k], STYLE_OPTIONS[k].map(([v, label]) =>
      `<button data-k="${k}" data-v="${v}" class="${this.style[k] === v ? 'on' : ''}${DEFAULT_STYLE[k] === v ? ' def' : ''}">${esc(label)}</button>`).join(''));
    const fire = (list) => list.map(([ev, label]) => `<button data-ev="${ev}" class="ev">${label}</button>`).join('');
    this.el.innerHTML = `<h3>Music lab <button data-a="hide" title="Fold the lab away (F9)">Hide</button></h3>
      <p class="ml-hint">Switch one thing at a time and listen for a few bars. ● marks the current game default. Each event answers at most once per 30 s, as in a game; an ending holds until you flip any switch.</p>
      ${Object.keys(DEFAULT_STYLE).map(style).join('')}
      ${row('Intensity', LEVELS.map(([v, label]) => `<button data-level="${v}" class="${this.level === v ? 'on' : ''}${v === 'auto' ? ' def' : ''}">${label}</button>`).join(''))}
      ${row('Events', fire(EVENTS))}
      ${row('Ending', fire(ENDINGS))}
      <div class="ml-now"></div>
      <div class="ml-sum"><code>${esc(this.summary())}</code><button data-a="copy">Copy</button><button data-a="reset">Back to default</button></div>`;
    this.showNow();
  }

  showNow() {
    const i = this.app.audio.scoreInfo();
    const el = this.el.querySelector('.ml-now');
    if (!el) return;
    if (!i) {
      el.textContent = 'Click anywhere in the game to start the sound.';
      return;
    }
    const tempo = Math.round(i.tempo);
    const lines = [
      `Now: ${SONGS[i.song].name} ${i.section} · ${i.mood} (country ${Math.round(i.dire * 100)}% dire) · ${tempo}${tempo !== Math.round(i.tempoTo) ? ` → ${i.tempoTo}` : ''} bpm`
        + ` · ${LEVEL_NAME[i.level] ?? i.level}${i.auto ? '' : ' (pinned)'} · ${i.shape} · bar ${i.bar % 8 + 1} of 8 · chord ${i.chord}`,
      `Band ${i.band} · groove ${i.groove}${i.swing ? ' (swung)' : ''} · melody: ${MELODY_NAME[i.kind]}`
        + (i.kind === 'hooks' || i.kind === 'call' ? ` ${i.hook} of ${HOOKS.length}` : '')
        + (i.kind === 'riff' ? ` ${i.riff} of ${RIFFS.length}` : '')
        + ` on ${LEAD_NAME[i.lead]}` + (i.over ? ` + ${MELODY_NAME[i.over.kind]} ${i.hook} on ${LEAD_NAME[i.over.lead]}` : ''),
    ];
    if (i.hush) lines.push('Hush: heartbeat and drone only, until the horde crosses or 16 bars pass');
    if (i.ending) lines.push(`${i.ending === 'victory' ? 'Victory' : 'Defeat'} ending: flip any switch to bring the score back`);
    el.textContent = lines.join('\n');
  }
}
