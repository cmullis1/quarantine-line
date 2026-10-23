// Bottom-left panel describing the current selection: units, a building, or a town. Its orders sit on a command
// card: a grid of buttons, each with an icon, a label and its key in the top-right corner, saying on the button why
// it cannot be used.
import { $, $$, costHtml, needHtml, tipOn, esc, fmt, hours, reach } from './dom.js';
import { BUILDINGS, WEAPONS } from '../config/buildings.js';
import { UNITS } from '../config/units.js';
import { SPECIALTIES } from '../config/world.js';
import { TOWN_ACTIONS } from '../config/actions.js';
import { REFUGEES, SPREAD } from '../config/balance.js';
import { detection, containment, breakoutThreshold } from '../sim/systems/towns.js';
import { townOutputFactor } from '../sim/systems/economy.js';
import { compass } from '../sim/systems/world.js';
import { isUnlocked, unitUnlocked } from '../sim/commands.js';
import { RESEARCH_BY_ID } from '../config/research.js';

// One command-card button: `attrs` names what it does (data-cmd or data-town), `sub` adds a line under the label.
const cbtn = (attrs, icon, label, key, { cls = '', sub = '' } = {}) =>
  `<button class="cbtn${cls ? ' ' + cls : ''}" ${attrs}><span class="ci">${icon}</span><span class="cl">${label}</span>${sub}${key ? `<kbd>${key}</kbd>` : ''}</button>`;

const CMD_TIPS = {
  stop: '<b>Stop</b> <kbd>T</kbd><br>Drop the current order where they stand.',
  hold: '<b>Hold</b> <kbd>H</kbd><br>Stay on this spot and fire from it. Again to release.',
  amove: '<b>Attack-move</b> <kbd>Shift</kbd>+right-click<br>Arms the next right-click: they go there and stop to fight anything in range on the way.',
  alltype: '<b>All of type</b> (double-click a unit)<br>Select every unit of these types on screen.',
  upgradeLine: '<b>Upgrade line</b> <kbd>Shift+U</kbd><br>Upgrade every wall section joined to this one, as far as the funds go.',
  toggle: '<b>Switch on / off</b> <kbd>I</kbd><br>Off, it costs no upkeep and does nothing.',
  demolish: '<b>Demolish</b> <kbd>Del</kbd><br>You get back half the cost, scaled by its condition.',
};

// Why an upgrade cannot be bought now: the research it waits for, or the resources it is short of.
const upgradeWhy = (sim, up) => (!isUnlocked(sim, up) ? `🔒 ${RESEARCH_BY_ID[BUILDINGS[up].unlock].name}` : needHtml(BUILDINGS[up].cost, sim.state.res));
// Why a unit cannot be trained now: the same, for its `requires`.
const trainWhy = (sim, t) => (!unitUnlocked(sim, t) ? `🔒 ${RESEARCH_BY_ID[UNITS[t].requires].name}` : needHtml(UNITS[t].cost, sim.state.res));

// An MG team's set-up as its panel says it: on the move, setting up (how far along), or ready to fire.
function setupText(u) {
  const d = UNITS[u.type];
  if (u.moving) return 'On the move';
  return u.setup >= d.setup ? 'Ready' : `Setting up ${Math.floor((u.setup / d.setup) * 100)}%`;
}

export class Selection {
  constructor(app) {
    this.app = app;
    this.sig = '';
  }

  signature() {
    const sel = this.app.sel, sim = this.app.sim;
    if (sel.units.length) return 'u' + sel.units.join() + '|' + sel.units.map((id) => sim.byId(id)?.order).join();
    if (sel.building) { const b = sim.byId(sel.building); return b ? `b${b.id}|${b.type}|${b.built}|${b.queue.join()}|${b.on}|${sim.canAfford({ funds: 0 })}|${sim.state.research.done.length}` : 'none'; }
    if (sel.town != null) { const t = sim.state.towns[sel.town]; return `t${sel.town}|${t.status}|${t.quarantine}|${t.sacrifice}|${t.reclaimT > 0}|${sim.state.laws.length}`; }
    return 'none';
  }

  render() {
    const sig = this.signature();
    if (sig !== this.sig) {
      this.sig = sig;
      const el = $('#selection');
      const sel = this.app.sel;
      el.innerHTML = sel.units.length ? this.unitsHtml() : sel.building ? this.buildingHtml() : sel.town != null ? this.townHtml() : '';
      this.bind(el);
    }
    this.live();
  }

  unitsHtml() {
    const sim = this.app.sim;
    const us = this.app.sel.units.map((id) => sim.byId(id)).filter(Boolean);
    if (!us.length) return '';
    const groups = {};
    for (const u of us) (groups[u.type] ||= []).push(u);
    const rows = Object.entries(groups).map(([t, g]) => `<div class="urow"><span class="bi">${UNITS[t].icon}</span><b>${g.length}× ${UNITS[t].name}</b><span class="chev">${'︽'.repeat(Math.max(...g.map((u) => u.vet)))}</span><div class="hp" style="grid-column:2/4"><i data-hp="${t}"></i></div></div>`).join('');
    let detail = '';
    if (us.length === 1) {
      const u = us[0], d = UNITS[u.type], w = WEAPONS[d.weapon];
      detail = `<p class="hint">${esc(d.desc)}</p><div class="kv"><span>Weapon</span><b>${d.weapon} · range ${reach(w)}</b></div>`;
      if (d.setup) detail += `<div class="kv"><span>Set-up</span><b id="sel-setup">${setupText(u)}</b></div><div class="kv"><span>Facing</span><b id="sel-face"></b></div>`;
      detail += `<div class="kv"><span>Kills</span><b id="sel-kills">${u.kills}</b></div><div class="kv"><span>Rank</span><b>${['Recruit', 'Veteran', 'Elite'][u.vet]}</b></div><div class="kv"><span>Upkeep</span><b>${costHtml(d.upkeep)}/h</b></div>`;
    }
    const hold = us.every((u) => u.order === 'hold');
    const card = [
      cbtn('data-cmd="stop"', '⏹️', 'Stop', 'T'),
      cbtn('data-cmd="hold"', '✋', 'Hold', 'H', { cls: hold ? 'on' : '' }),
      cbtn('data-cmd="amove"', '🗡️', 'Attack-move', '⇧ RMB', { cls: this.app.input.attackArmed ? 'on' : '' }),
      cbtn('data-cmd="alltype"', '👥', 'All of type', 'Dbl-click'),
    ];
    return `<h2>${us.length === 1 ? UNITS[us[0].type].name : us.length + ' units'}</h2>${rows}${detail}
      <div class="ccard">${card.join('')}</div>
      <p class="hint">Right-click moves them (they fire on the way). Troops in a town keep order and contain infection.</p>`;
  }

  buildingHtml() {
    const sim = this.app.sim, b = sim.byId(this.app.sel.building);
    if (!b) return '';
    const d = BUILDINGS[b.type];
    let html = `<h2>${d.icon} ${d.name} <small>${Math.round(b.hp)}/${Math.round(b.maxHp)}</small></h2><div class="hp big"><i id="sel-bhp"></i></div><p class="hint">${esc(d.desc)}</p>`;
    if (!b.built) html += `<div class="kv"><span>${b.progress > 0 && d.upgradeOf ? 'Upgrading' : 'Under construction'}</span><b id="sel-prog"></b></div>`;
    if (b.built && d.trains) {
      html += `<div class="train">${d.trains.map((t) => `<button class="tbtn" data-train="${t}"><span class="bi">${UNITS[t].icon}</span><span class="tn">${UNITS[t].name}</span><span class="why"></span></button>`).join('')}</div><div class="queue" id="sel-queue"></div><p class="hint">Right-click the map to set a rally point. Click a queued unit to cancel it.</p>`;
    }
    if (b.type === 'checkpoint') html += `<p class="hint" id="sel-cp"></p>`;
    if (b.type === 'camp') html += `<div class="kv"><span>Sheltering</span><b id="sel-camp"></b></div>`;
    if (d.weapon && WEAPONS[d.weapon]) html += `<div class="kv"><span>Kills</span><b id="sel-kills">${b.kills || 0}</b></div>`;
    if (d.wall) html += `<div class="kv"><span>Pile-up</span><b id="sel-press"></b></div>`;
    if (d.workers && b.built) html += `<div class="kv"><span>Workers</span><b id="sel-work"></b></div>`;
    const cmds = [];
    const up = Object.keys(BUILDINGS).find((t) => BUILDINGS[t].upgradeOf === b.type);
    const locked = up && !isUnlocked(sim, up) ? ' disabled' : '';
    if (up) cmds.push(cbtn(`data-cmd="upgrade" data-up="${up}"${locked}`, '⬆️', 'Upgrade', 'U', { sub: `<span class="cs">→ ${BUILDINGS[up].name} ${costHtml(BUILDINGS[up].cost)}</span><span class="why"></span>` }));
    if (up && b.type === 'wall') cmds.push(cbtn(`data-cmd="upgradeLine" data-up="${up}"${locked}`, '⏫', 'Upgrade line', '⇧U', { sub: '<span class="cs">every joined section</span><span class="why"></span>' }));
    if (d.toggle) cmds.push(cbtn('data-cmd="toggle"', '🔌', b.on ? 'Switch off' : 'Switch on', 'I', { cls: b.on ? 'on' : '' }));
    if (b.type !== 'hq') cmds.push(cbtn('data-cmd="demolish"', '🗑️', 'Demolish', 'Del', { cls: 'danger' }));
    return html + (cmds.length ? `<div class="ccard">${cmds.join('')}</div>` : '');
  }

  townHtml() {
    const sim = this.app.sim, id = this.app.sel.town, t = sim.state.towns[id], info = sim.map.towns[id];
    const spec = SPECIALTIES[info.specialty];
    let html = `<h2>${info.capital ? '★ ' : ''}${info.name} <small>${spec.icon} ${spec.label}</small></h2><p class="hint">${esc(spec.desc)}</p><div id="sel-town"></div>`;
    // Town orders have no keys; they take the card's look all the same.
    const btn = (action, icon, label, opts) => cbtn(`data-town="${action}"`, icon, label, '', opts);
    const cmds = [];
    if (t.status === 'ok') {
      cmds.push(btn('quarantine', '🚫', t.quarantine ? 'Lift quarantine' : 'Quarantine', { cls: t.quarantine ? 'on' : '' }));
      if (!info.capital) cmds.push(btn('evacuate', '🚌', 'Evacuate', { sub: `<span class="cs">${costHtml(TOWN_ACTIONS.evacuate.cost, sim.state.res)}</span>` }));
      if (!info.capital) cmds.push(btn('sterilise', '🔥', 'Sterilise…', { cls: 'danger' }));
      if (sim.hasLaw('sacrifice') && !info.capital && !t.sacrifice) cmds.push(btn('sacrifice', '⚰️', 'Sacrifice zone…', { cls: 'danger' }));
    } else if (t.reclaimT <= 0) cmds.push(btn('reclaim', '🏳️', 'Reclaim'));
    return html + (cmds.length ? `<div class="ccard">${cmds.join('')}</div>` : '');
  }

  bind(el) {
    const app = this.app;
    $$('[data-cmd]', el).forEach((b) => {
      b.addEventListener('click', () => app.input.command(b.dataset.cmd));
      const c = b.dataset.cmd;
      if (c === 'upgrade') tipOn(b, () => `<b>Upgrade to ${BUILDINGS[b.dataset.up].name}</b> <kbd>U</kbd><br>${esc(BUILDINGS[b.dataset.up].desc)}<div class="tipcost">${costHtml(BUILDINGS[b.dataset.up].cost, app.sim.state.res)}</div>`);
      else if (CMD_TIPS[c]) tipOn(b, CMD_TIPS[c]);
    });
    $$('[data-train]', el).forEach((b) => {
      const t = b.dataset.train;
      b.addEventListener('click', () => app.cmd('train', app.sel.building, t));
      tipOn(b, () => {
        const d = UNITS[t], w = WEAPONS[d.weapon];
        const lock = unitUnlocked(app.sim, t) ? '' : `<br><span class="bad">Requires ${RESEARCH_BY_ID[d.requires].name}</span>`;
        return `<b>${d.name}</b><br>${esc(d.desc)}<br><span class="hint">HP ${d.hp} · ${d.weapon} range ${reach(w)} · speed ${d.speed} · train ${d.train} h</span>${lock}<div class="tipcost">${costHtml(d.cost, app.sim.state.res)} · upkeep ${costHtml(d.upkeep)}/h</div>`;
      });
    });
    $$('[data-town]', el).forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.town, id = app.sel.town, name = app.sim.map.towns[id].name;
      if (a === 'sterilise') app.ui.modals.confirm(`Sterilise ${name}?`, TOWN_ACTIONS.sterilise.desc + ` Costs ${app.sim.hasLaw('scorched') ? 15 : 30} authority. Trust −25.`, () => app.cmd('town', id, a));
      else if (a === 'sacrifice') app.ui.modals.confirm(`Make ${name} a sacrifice zone?`, TOWN_ACTIONS.sacrifice.desc + ' Trust −20.', () => app.cmd('town', id, a));
      else app.cmd('town', id, a);
    }));
  }

  live() {
    const sim = this.app.sim, sel = this.app.sel, s = sim.state;
    if (sel.units.length) {
      const am = $('#selection [data-cmd="amove"]');
      if (am) am.classList.toggle('on', !!this.app.input.attackArmed);
      $$('#selection [data-hp]').forEach((el) => {
        const us = sel.units.map((id) => sim.byId(id)).filter((u) => u && u.type === el.dataset.hp);
        const hp = us.reduce((a, u) => a + u.hp, 0), max = us.reduce((a, u) => a + u.maxHp, 0);
        el.style.width = max ? (hp / max) * 100 + '%' : '0';
      });
      const k = $('#sel-kills'); const u = sim.byId(sel.units[0]); if (k && u) k.textContent = u.kills;
      // An MG team's set-up, and the way it faces (once set up) or will face (setting up, or on the way there).
      const su = $('#sel-setup'); if (su && u) su.textContent = setupText(u);
      const fc = $('#sel-face'); if (fc && u) { const a = u.setup >= UNITS[u.type].setup ? u.rot : u.face; fc.textContent = compass(Math.sin(a), Math.cos(a)); }
    }
    if (sel.building) {
      const b = sim.byId(sel.building);
      if (!b) return;
      const hp = $('#sel-bhp'); if (hp) hp.style.width = (b.hp / b.maxHp) * 100 + '%';
      // Reasons on the card: an upgrade or a unit waiting for research or short of funds.
      $$('#selection [data-up]').forEach((x) => {
        const why = upgradeWhy(sim, x.dataset.up), w = x.querySelector('.why');
        x.classList.toggle('short', !x.disabled && !!why);
        if (w._h !== why) { w.innerHTML = why; w._h = why; }
      });
      $$('#selection [data-train]').forEach((x) => {
        const t = x.dataset.train, open = unitUnlocked(sim, t), why = trainWhy(sim, t), w = x.querySelector('.why');
        x.classList.toggle('locked', !open);
        x.classList.toggle('short', open && !!why);
        if (w._h !== why) { w.innerHTML = why; w._h = why; }
      });
      const p = $('#sel-prog'); if (p) p.textContent = Math.floor(b.progress * 100) + '%';
      const q = $('#sel-queue');
      if (q) {
        const html = b.queue.map((t, k) => `<span class="qi" data-q="${k}" title="Cancel">${UNITS[t].icon}${k === 0 ? `<i style="width:${(b.trainT / UNITS[t].train) * 100}%"></i>` : ''}</span>`).join('') || '<span class="hint">Queue empty</span>';
        if (q.innerHTML !== html) { q.innerHTML = html; $$('[data-q]', q).forEach((x) => x.addEventListener('click', () => this.app.cmd('cancelTrain', b.id, +x.dataset.q))); }
      }
      const cp = $('#sel-cp');
      if (cp) {
        const cross = sim.map.crossings.find((c) => c.i === b.i && c.j === b.j);
        const waiting = cross ? s.ents.refugees.filter((r) => r.crossId === cross.id && r.mode === 'waiting').length : 0;
        cp.textContent = cross ? `Crossing to ${sim.map.sites[cross.siteId].name}: ${waiting} groups waiting. Caught ${s.stats.turnedAway} infected so far. Screening only happens while the border is SCREENED.` : 'Not on a border crossing: it guards the road but screens no one.';
      }
      const camp = $('#sel-camp');
      if (camp) camp.textContent = `${s.ents.refugees.filter((r) => r.camp === b.id).length} / ${REFUGEES.campCapacity * (sim.hasTech('c3') ? 2 : 1)} groups`;
      const k = $('#sel-kills'); if (k) k.textContent = b.kills || 0;
      const pr = $('#sel-press'); if (pr) pr.textContent = b.press ? `${Math.round(b.press * 100)}% of the climb` : 'none';
      const wk = $('#sel-work');
      if (wk) { wk.textContent = b.idle ? 'Idle: no workers' : `${BUILDINGS[b.type].workers} at work`; wk.className = b.idle ? 'bad' : ''; }
    }
    if (sel.town != null) {
      const el = $('#sel-town');
      if (!el) return;
      const t = s.towns[sel.town], info = sim.map.towns[sel.town];
      let html;
      if (t.status !== 'ok') {
        html = `<p class="bad"><b>${t.status === 'scorched' ? 'SCORCHED' : 'FALLEN'}</b>: ${t.status === 'fallen' ? `the dead hold this town${t.residual > 0 ? ` (~${t.residual} more will crawl out)` : ''}` : 'nothing lives here now'}.</p>`;
        if (t.reclaimT > 0) html += `<div class="kv"><span>Reclaiming</span><b>${Math.floor((t.reclaimT / SPREAD.reclaimHours) * 100)}%, needs troops inside and no dead within 3 tiles</b></div>`;
      } else {
        const det = detection(sim, t), cont = containment(sim, info);
        const near = s.ents.units.filter((u) => Math.hypot(u.x - info.x, u.z - info.z) < info.r + 2.5);
        const status = t.breakout ? '<span class="bad">BREAKOUT</span>' : t.alerted ? '<span class="warn">OUTBREAK</span>' : t.quarantine ? 'Quarantined' : t.sacrifice ? '<span class="bad">Sacrifice zone</span>' : 'Calm';
        const out = Object.entries(SPECIALTIES[info.specialty].produce).map(([k, v]) => `${(v * townOutputFactor(sim, t)).toFixed(1)} ${k}`).join(', ') || '-';
        html = `<div class="kv"><span>Population</span><b>${fmt(t.pop)} / ${fmt(t.pop0)}</b></div>
          <div class="kv"><span>Reported cases</span><b class="${t.reported >= 5 ? 'bad' : ''}">${t.reported < 1 ? 'none' : '~' + fmt(t.reported)}</b></div>
          <div class="kv"><span>Detection</span><b>${Math.round(det * 100)}%${sim.hasLaw('censorship') ? ' (censored)' : ''}</b></div>
          <div class="kv"><span>Containment</span><b>${cont > 0 ? cont.toFixed(0) + ' cases/h' : 'none'}</b></div>
          <div class="kv"><span>Units in town</span><b>${near.length}${near.some((u) => u.type === 'hazmat') ? ' ☣️' : ''}</b></div>
          <div class="kv"><span>Output</span><b>${out}/h</b></div>
          <div class="kv"><span>Status</span><b>${status}</b></div>`;
        if (t.alerted) html += `<p class="hint">Reports lag ${sim.hasLaw('censorship') ? 24 : SPREAD.reportDelay} h. Breakout begins around ${breakoutThreshold(sim)} true cases.</p>`;
        if (s.time < t.evacUntil) html += `<p class="hint">Buses on the road. Next evacuation in ${hours(t.evacUntil - s.time)}.</p>`;
      }
      if (el.innerHTML !== html) el.innerHTML = html;
    }
  }
}
