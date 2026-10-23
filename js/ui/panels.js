// Right-hand panel. COMMAND: Forces (army overview), Economy. GOVERNMENT: Policy (border + laws), Research (tree),
// Cabinet (requests), News.
import { $, $$, esc, tipOn, hours, trueTrust, RES_META, rateHtml, fmt, setStyle, setText, ceilHours } from './dom.js';
import { trustLossMult, computeRates } from '../sim/systems/economy.js';
import { CHAINS, LAWS, LAW_BY_ID, lawPrereq, lawEffects, BORDER_STANCES } from '../config/laws.js';
import { BRANCHES, RESEARCH, RESEARCH_BY_ID, researchPrereq } from '../config/research.js';
import { REQUEST_BY_ID, MINISTERS } from '../config/cabinet.js';
import { UNITS } from '../config/units.js';
import { BUILDINGS } from '../config/buildings.js';
import { SPECIALTIES } from '../config/world.js';
import { forcesSummary, squadList, trainingList, armyUpkeep, PRODUCER_COLORS, workerSegments, producerRows, flows, townRows } from './overview.js';

const TAB_ROWS = [
  ['COMMAND', [['forces', 'FORCES'], ['economy', 'ECONOMY']]],
  ['GOVERNMENT', [['policy', 'POLICY'], ['research', 'RESEARCH'], ['cabinet', 'CABINET'], ['news', 'NEWS']]],
];

// HP as the bars draw it, in 2% steps, so a bar that would not visibly move does not rebuild the list.
const pct = (hp, max) => (max > 0 ? Math.round(Math.max(0, Math.min(1, hp / max)) * 50) * 2 : 0);
// Below half HP a squad is tinted, below a quarter it is red.
const hurt = (hp, max) => (hp < max * 0.25 ? 'dying' : hp < max * 0.5 ? 'hurt' : '');
// Per-hour amounts as ECONOMY prints them: two decimals below 1, one above.
const per = (v) => Math.abs(v).toFixed(Math.abs(v) < 1 ? 2 : 1);
const outText = (out) => Object.entries(out).map(([k, v]) => `+${per(v)} ${RES_META[k].icon}`).join(' ');
const WORKER_LABEL = { farm: 'Farms', munitions: 'Munitions', lab: 'Labs', factory: 'Factories' };

// A request that names one place (a crossing or a town) gets a button that takes the camera there.
function placeButton(sim, p) {
  const at = p.crossing != null ? sim.map.crossings[p.crossing] : p.town != null ? sim.map.towns[p.town] : null;
  if (!at) return '';
  const name = p.crossing != null ? `${sim.map.sites[at.siteId].name} crossing` : at.name;
  return ` <button class="jump" data-jump="${at.x},${at.z}" title="Show ${esc(name)} on the map">📍 ${esc(name)}</button>`;
}

export class Panels {
  constructor(app) {
    this.app = app;
    this.tab = 'forces';
    this.sig = '';
    this.lastPick = { key: '', t: 0 };
    // ECONOMY producer rows the player has expanded, by type; kept while the tab re-renders.
    this.open = new Set();
    $('#right').innerHTML = `<div class="tabs">${TAB_ROWS.map(([label, tabs]) => `<div class="tabrow"><span class="tg">${label}</span>${tabs.map(([id, l]) => `<button data-t="${id}">${l}<span class="dot" hidden></span></button>`).join('')}</div>`).join('')}</div><div class="tabbody" id="tabbody"></div>`;
    $$('#right .tabs button').forEach((b) => b.addEventListener('click', () => this.show(b.dataset.t)));
    tipOn($('#right .tabs [data-t="forces"]'), '<b>Forces</b> <kbd>F5</kbd><br>Every squad: how many, their condition, what they are doing and where.');
    tipOn($('#right .tabs [data-t="economy"]'), '<b>Economy</b> <kbd>F6</kbd><br>Workers, producers, where funds, food and ammo come from and go, and the towns.');
    // Rows act on press, so a list rebuilt between press and release (HP ticking down in a fight) never eats a click.
    $('#tabbody').addEventListener('mousedown', (e) => {
      const el = e.button === 0 && e.target.closest('[data-pick]');
      if (el) this.pick(el, e.shiftKey);
    });
    this.show('forces');
  }

  show(tab) {
    this.tab = tab;
    this.sig = '';
    $$('#right .tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    if (tab === 'laws' || tab === 'policy') this.app.ui.lesson('laws');
    if (tab === 'research') this.app.ui.lesson('research');
    this.render();
  }

  signature() {
    const s = this.app.sim.state, sim = this.app.sim;
    if (this.tab === 'forces') { this.forcesNow = this.forcesData(); return this.forcesNow.sig; }
    if (this.tab === 'economy') { this.economyNow = this.economyData(); return this.economyNow.sig; }
    if (this.tab === 'policy') return `${s.border}|${s.laws.join()}|${Math.floor(s.res.authority)}|${sim.day}|${Math.max(0, ceilHours((s.cooldowns.border || 0) - s.time))}`;
    if (this.tab === 'research') return `${s.research.active}|${s.research.done.join()}`;
    if (this.tab === 'cabinet') return s.cabinet.requests.map((r) => `${r.id}${r.status}`).join() + '|' + Math.floor(s.time);
    return (s.news.feed || []).map((n) => n.id).join();
  }

  render() {
    const sig = this.signature();
    if (sig !== this.sig) {
      this.sig = sig;
      const body = $('#tabbody');
      const top = body.scrollTop;
      body.innerHTML = this[this.tab]();
      body.scrollTop = top;
      this.bind(body);
    }
    this.live();
  }

  // Everything FORCES shows, rounded as it is shown; sig changes only when something visible does.
  forcesData() {
    const sim = this.app.sim;
    const summary = forcesSummary(sim).map((r) => ({ ...r, pct: pct(r.hp, r.maxHp), tint: hurt(r.hp, r.maxHp) }));
    const squads = squadList(sim, this.app.input.groups).map((q) => ({ ...q, pct: pct(q.hp, q.maxHp), tint: hurt(q.hp, q.maxHp) }));
    const training = trainingList(sim).map((t) => ({ ...t, left: hours(t.hoursLeft) }));
    const upkeep = armyUpkeep(sim).toFixed(2);
    const sig = [
      summary.map((r) => `${r.type}:${r.count}:${r.pct}:${r.tint}:${r.idle}:${r.queued}`).join(),
      squads.map((q) => `${q.id}:${q.label}:${q.group}:${q.pct}:${q.tint}:${q.vet}:${q.status}:${q.place}`).join(),
      training.map((t) => `${t.buildingId}:${t.unit}:${t.left}:${t.behind}`).join(),
      upkeep,
    ].join('|');
    return { summary, squads, training, upkeep, sig };
  }

  forces() {
    const { summary, squads, training, upkeep } = this.forcesNow;
    const units = squads.length, idle = summary.reduce((n, r) => n + r.idle, 0);
    let html = `<div class="forces"><h3>FORCES <span class="hn">${units} unit${units === 1 ? '' : 's'}</span></h3>`;
    if (!summary.length) html += '<p class="hint">No troops. Train them at the HQ or a barracks: ARMY tab of the build menu (B).</p>';
    html += summary.map((r) => `<div class="frow ${r.count ? '' : 'none'}" ${r.count ? `data-pick="${r.type}" data-type="${r.type}"` : ''}>
      <span class="bi">${r.icon}</span><span class="fn"><b>${r.name}</b> <span class="fc">×${r.count}</span></span>
      <span class="fs">${[r.idle ? `${r.idle} idle` : '', r.queued ? `${r.queued} queued` : ''].filter(Boolean).join(' · ')}</span>
      ${r.count ? `<div class="hp ${r.tint}"><i style="width:${r.pct}%"></i></div>` : '<span class="fs fq">in training</span>'}</div>`).join('');
    if (squads.length) {
      html += '<h3>SQUADS</h3>';
      html += squads.map((q, k) => `<div class="sq ${q.tint} ${k && squads[k - 1].type !== q.type ? 'ng' : ''}" data-pick="u${q.id}" data-id="${q.id}">
        <span class="bi">${UNITS[q.type].icon}</span><span class="sn">${q.label}${q.group != null ? ` <kbd>${q.group}</kbd>` : ''}${q.vet ? ` <span class="chev">${'︽'.repeat(q.vet)}</span>` : ''}</span>
        <span class="st st-${q.status.replace(' ', '-').toLowerCase()}">${q.status}</span>
        <div class="hp ${q.tint}"><i style="width:${q.pct}%"></i></div><span class="pl">${esc(q.place)}</span></div>`).join('');
    }
    html += '<h3>TRAINING</h3>';
    html += training.length
      ? training.map((t) => `<div class="trq"><span class="bi">${UNITS[t.unit].icon}</span><span><b>${UNITS[t.unit].name}</b><br><span class="pl">${t.building}</span></span><span class="tl">${t.left}${t.behind ? `<br><span class="pl">+${t.behind} behind</span>` : ''}</span></div>`).join('')
      : '<p class="hint">Nothing in training.</p>';
    html += `<div class="ffoot">Upkeep 💰 ${upkeep}/h · ${units} unit${units === 1 ? '' : 's'}${idle ? ` · ${idle} idle (<kbd>.</kbd> cycles them)` : ''}</div></div>`;
    return html;
  }

  // Everything ECONOMY shows, rounded as it is shown; sig changes only when something visible does.
  economyData() {
    const sim = this.app.sim;
    const { rates, parts } = computeRates(sim);
    const w = workerSegments(sim);
    const have = Math.floor(w.have + 1e-9), segs = w.segments.filter((g) => g.used).map((g) => [g.type, g.used]);
    const used = segs.reduce((n, [, u]) => n + u, 0);
    const workers = { have, used, free: Math.max(0, have - used), idle: w.idleNeed, segs };
    const towns = townRows(sim).map((t) => ({ id: t.id, name: t.name, pop: fmt(t.pop), workers: t.workers.toFixed(1), factor: t.factor.toFixed(2), status: t.status }));
    const status = Object.fromEntries(towns.map((t) => [t.id, t.status]));
    const rows = producerRows(sim).map((r) => {
      const spec = r.kind === 'specialty' && SPECIALTIES[r.type];
      // A specialty says something only when it is not simply producing: stopped, or a bonus with no output.
      const sub = spec
        ? (spec.trainBonus ? `units train ${Math.round(spec.trainBonus * 100)}% faster nearby` : r.factor > 0 ? '' : `<span class="bad">stopped: ${status[r.town]}</span>`)
        : [BUILDINGS[r.type].workers && r.staffed ? `${r.staffed} staffed` : '', r.idle ? `<span class="bad">${r.idle} idle: no workers</span>` : '', r.building ? `${r.building} being built` : ''].filter(Boolean).join(' · ');
      return {
        kind: r.kind, type: r.type, town: r.town, name: r.name, icon: r.icon, count: r.count, sub, out: outText(r.output),
        items: r.items.map((it) => ({ id: it.id, place: it.place, status: it.status, out: outText(it.output) })),
      };
    });
    const money = ['funds', 'food', 'ammo'].map((k) => {
      const f = flows(sim, k, parts), shown = ([l, v]) => [l, Math.abs(v).toFixed(2)];
      return { k, rate: rates[k].toFixed(2), sources: f.sources.map(shown), costs: f.costs.map(shown) };
    });
    const data = { workers, rows, money, towns, open: [...this.open] };
    return { ...data, sig: JSON.stringify(data) };
  }

  economy() {
    const { workers: w, rows, money, towns } = this.economyNow;
    let html = `<div class="economy"><h3>WORKERS <span class="hn">${w.used} at work · ${w.have} available</span></h3>`;
    if (w.have + w.idle) {
      // Segment widths are worker counts, so the bar reads left to right: staffed by type, free, then the red
      // overflow of what idle producers want beyond the towns' supply.
      const seg = (n, cls, color) => (n ? `<i class="${cls}" style="flex:${n}${color ? `;background:${color}` : ''}">${n}</i>` : '');
      html += `<div class="wbar">${w.segs.map(([t, n]) => seg(n, `w-${t}`, PRODUCER_COLORS[t])).join('')}${seg(w.free, 'w-free')}${seg(w.idle, 'w-idle', PRODUCER_COLORS.idle)}</div>`;
      const key = (color, text, cls = '') => `<span class="${cls}"><i style="background:${color}"></i>${text}</span>`;
      html += `<div class="wleg">${w.segs.map(([t, n]) => key(PRODUCER_COLORS[t], `${WORKER_LABEL[t]} ${n}`)).join('')}${w.free ? key('#3a403a', `free ${w.free}`) : ''}${w.idle ? key(PRODUCER_COLORS.idle, `${w.idle} more wanted`, 'bad') : ''}</div>`;
    } else html += '<p class="hint">No workers: every town is lost, locked down or a sacrifice zone.</p>';

    html += '<h3>PRODUCERS</h3>';
    for (const r of rows) {
      // Farms, factories, plants and labs expand into their buildings; the HQ and a town specialty act at once.
      const many = r.kind === 'building' && r.type !== 'hq';
      const open = many && this.open.has(r.type);
      const act = many ? `data-pick="o${r.type}" data-open="${r.type}"` : r.kind === 'specialty' ? `data-pick="t${r.town}" data-town="${r.town}"` : `data-pick="b${r.items[0].id}" data-bid="${r.items[0].id}"`;
      const color = PRODUCER_COLORS[r.type];
      html += `<div class="frow prow" ${act}${color ? ` style="border-left-color:${color}"` : ''}>
        <span class="bi">${r.icon}</span><span class="fn">${many ? `<span class="tw">${open ? '▾' : '▸'}</span> ` : ''}<b>${esc(r.name)}</b>${many ? ` <span class="fc">×${r.count}</span>` : ''}</span>
        <span class="eo">${r.out || '-'}</span>${r.sub ? `<span class="fs">${r.sub}</span>` : ''}</div>`;
      if (open) html += r.items.map((it) => `<div class="pitem" data-pick="b${it.id}" data-bid="${it.id}"><span class="pl">${esc(it.place)}</span><span class="ps ps-${it.status.replace(' ', '-')}">${it.status}</span><span class="eo">${it.out || '-'}</span></div>`).join('');
    }

    html += '<h3>FLOWS <span class="hn">biggest, per hour</span></h3>';
    const lines = (list, sign, cls) => list.map(([l, v]) => `<div class="fl"><span>${esc(l)}</span><b class="${cls}">${sign}${v}</b></div>`).join('') || '<div class="fl none">none</div>';
    html += money.map((m) => `<div class="flow"><div class="fh"><span>${RES_META[m.k].icon} ${RES_META[m.k].label}</span>${rateHtml(+m.rate, 2)}</div>
      <div class="fcols"><div>${lines(m.sources, '+', 'good')}</div><div>${lines(m.costs, '−', 'bad')}</div></div></div>`).join('');

    html += '<h3>TOWNS</h3>';
    html += towns.length
      ? towns.map((t) => `<div class="town" data-pick="t${t.id}" data-town="${t.id}"><span class="tn">${esc(t.name)}</span><span class="ts ts-${t.status.replace(' ', '-')}">${t.status}</span>
        <span class="pl">${t.pop} people · ${t.workers} workers · output ×${t.factor}</span></div>`).join('')
      : '<p class="hint">No living towns.</p>';
    return html + '</div>';
  }

  // A FORCES or ECONOMY row, on press. Units and buildings: click selects (Shift adds units), a second press on the
  // same row within 350 ms also moves the camera. A town jumps at once. A producer type expands or folds (a
  // double-click counts once).
  pick(el, additive) {
    const app = this.app, sim = app.sim, d = el.dataset;
    const now = performance.now(), key = d.pick;
    const dbl = this.lastPick.key === key && now - this.lastPick.t < 350;
    this.lastPick = { key, t: dbl ? -1e9 : now };
    if (d.open) {
      if (dbl) return;
      if (this.open.has(d.open)) this.open.delete(d.open); else this.open.add(d.open);
      this.render();
      return;
    }
    if (d.town != null) {
      const t = sim.map.towns[+d.town];
      app.select({ town: +d.town });
      app.jumpTo(t.x, t.z);
      return;
    }
    if (d.bid) {
      const b = sim.byId(+d.bid);
      if (!b || b.gone) return;
      app.select({ building: b.id });
      if (dbl) app.jumpTo(b.x, b.z);
      return;
    }
    const us = d.type ? sim.state.ents.units.filter((u) => u.type === d.type && u.hp > 0) : [sim.byId(+d.id)].filter(Boolean);
    if (!us.length) return;
    app.select({ units: us.map((u) => u.id) }, additive);
    if (!dbl) return;
    // A type spread over the map has an empty middle; go to the unit nearest it.
    const mx = us.reduce((s, u) => s + u.x, 0) / us.length, mz = us.reduce((s, u) => s + u.z, 0) / us.length;
    const u = us.reduce((a, b) => (Math.hypot(b.x - mx, b.z - mz) < Math.hypot(a.x - mx, a.z - mz) ? b : a));
    app.jumpTo(u.x, u.z);
  }

  policy() {
    const sim = this.app.sim, s = sim.state;
    const cd = Math.max(0, (s.cooldowns.border || 0) - s.time);
    let html = `<h3>BORDER ${cd > 0 ? `<small>change in ${Math.ceil(cd)} h</small>` : ''}</h3><div class="seg">${Object.entries(BORDER_STANCES).map(([id, st]) => `<button data-border="${id}" data-p="${id}" class="${s.border === id ? 'on' : ''}" ${st.law && !sim.hasLaw(st.law) ? 'disabled' : ''}>${st.law && !sim.hasLaw(st.law) ? '🔒 ' : ''}${st.label}</button>`).join('')}</div>
      <p class="hint">${BORDER_STANCES[s.border].desc}</p>
      <h3>LAWS <small>⚖️ ${Math.floor(s.res.authority)} authority</small></h3>`;
    for (const ch of CHAINS) {
      html += `<div class="chain">${ch.label}</div>`;
      for (const l of LAWS.filter((x) => x.chain === ch.id)) {
        const passed = sim.hasLaw(l.id);
        const pre = lawPrereq(l.id);
        const locked = (pre && !sim.hasLaw(pre)) || sim.day < l.day;
        const next = !passed && !locked;
        if (!passed && !next) { html += `<div class="law locked"><span class="ln">${l.name}</span><span class="lc">${pre && !sim.hasLaw(pre) ? 'after ' + LAW_BY_ID[pre].name : 'Day ' + l.day}</span></div>`; continue; }
        const fx = lawEffects(l, sim.diff.politics);
        html += `<div class="law ${passed ? 'passed' : ''}"><span class="ln">${passed ? '✔ ' : ''}${l.name}</span><span class="lc">${passed ? 'LAW' : `⚖️ ${l.cost}`}</span>
          <div class="pros">${fx.pros.map((p) => '+ ' + esc(p)).join('<br>')}</div><div class="cons">${fx.cons.map((p) => '− ' + esc(p)).join('<br>')}</div>
          ${passed ? '' : `<button data-law="${l.id}" ${s.res.authority < l.cost ? 'disabled' : ''}>${s.res.authority < l.cost ? `NEEDS ⚖️ ${l.cost}` : 'SIGN INTO LAW'}</button>`}</div>`;
      }
    }
    return html;
  }

  research() {
    const sim = this.app.sim, s = sim.state;
    let html = `<h3>RESEARCH <small id="rs-pts"></small></h3><div class="tree">${BRANCHES.map((b) => `<div class="bh" style="color:${b.color}">${b.label}</div>`).join('')}`;
    for (let tier = 1; tier <= 4; tier++) for (const b of BRANCHES) {
      const t = RESEARCH.find((r) => r.branch === b.id && r.tier === tier);
      const done = sim.hasTech(t.id);
      const pre = researchPrereq(t.id);
      const locked = pre && !sim.hasTech(pre);
      html += `<div class="tech ${done ? 'done' : ''} ${s.research.active === t.id ? 'active' : ''} ${locked ? 'locked' : ''}" data-tech="${t.id}"><span>${done ? '✔ ' : locked ? '🔒 ' : ''}${t.name}</span><span class="tc">${done ? 'done' : t.cost}</span><div class="tb"><i data-prog="${t.id}"></i></div></div>`;
    }
    html += '</div><p class="hint">Click a project to research it. Hover for details. Labs and the university produce points.</p>';
    return html;
  }

  cabinet() {
    const sim = this.app.sim, s = sim.state;
    const list = [...s.cabinet.requests].reverse().slice(0, 10);
    if (!list.length) return '<p class="hint">No requests yet. Your ministers will come to you.</p>';
    return `<h3>REQUESTS <small>kept ${s.stats.promisesKept} · broken ${s.stats.promisesBroken}</small></h3>` + list.map((r) => {
      const def = REQUEST_BY_ID[r.defId], m = MINISTERS[r.minister];
      const reward = Object.entries(def.reward).map(([k, v]) => `+${v} ${k}`).join(' · ') + (def.trustReward ? ` · +${def.trustReward} trust` : '');
      const timer = r.status === 'offered' ? `answer within ${hours(r.until - s.time)}` : r.status === 'accepted' ? `${def.hold ? 'hold for' : 'due in'} ${hours(r.until - s.time)}` : r.status;
      return `<div class="req ${r.status}" style="border-left-color:${m.color}"><div class="who"><span>${m.name}</span><span class="timer">${timer}</span></div>
        <div class="what">“${esc(def.text(sim, r.p))}”${placeButton(sim, r.p)}</div><div class="rw">Reward: ${reward}</div><div class="rw cost">${trueTrust('Break it: trust −6', trustLossMult(sim))} · authority −5</div>
        ${r.status === 'offered' ? `<div class="row"><button data-req="${r.id}" data-acc="1">Promise</button><button data-req="${r.id}" data-acc="0">Decline (−2 auth)</button></div>` : ''}</div>`;
    }).join('');
  }

  news() {
    const s = this.app.sim.state;
    const feed = s.news.feed || [];
    if (!feed.length) return '<p class="hint">The wire is quiet.</p>';
    return feed.map((n) => `<div class="news">${esc(n.text)}<small>Day ${Math.floor(n.t / 24) + 1}</small></div>`).join('');
  }

  bind(body) {
    const app = this.app;
    $$('[data-jump]', body).forEach((b) => b.addEventListener('click', () => { const [x, z] = b.dataset.jump.split(',').map(Number); app.jumpTo(x, z); }));
    $$('[data-border]', body).forEach((b) => b.addEventListener('click', () => app.cmd('setBorder', b.dataset.border)));
    $$('[data-law]', body).forEach((b) => b.addEventListener('click', () => app.ui.modals.confirm(`Sign ${LAW_BY_ID[b.dataset.law].name} into law?`, 'Laws cannot be repealed.', () => app.cmd('passLaw', b.dataset.law))));
    $$('[data-tech]', body).forEach((el) => {
      const t = RESEARCH_BY_ID[el.dataset.tech];
      el.addEventListener('click', () => app.cmd('research', t.id));
      const pre = researchPrereq(t.id);
      tipOn(el, () => `<b>${t.name}</b> (${t.cost} pts)<br>${t.desc}${pre && !app.sim.hasTech(pre) ? `<br><span class="bad">Requires ${RESEARCH_BY_ID[pre].name}</span>` : ''}`);
    });
    $$('[data-req]', body).forEach((b) => b.addEventListener('click', () => app.cmd('request', +b.dataset.req, b.dataset.acc === '1')));
  }

  // Cheap per-frame bits that don't rebuild the DOM.
  live() {
    const sim = this.app.sim, s = sim.state;
    if (this.tab === 'research') {
      $$('[data-prog]').forEach((el) => {
        const t = RESEARCH_BY_ID[el.dataset.prog];
        setStyle(el, 'width', Math.min(100, ((s.research.progress[t.id] || 0) / t.cost) * 100).toFixed(1) + '%');
      });
      const pts = $('#rs-pts');
      if (pts) setText(pts, `${Math.floor(s.res.research)} pts · +${s.rates.research.toFixed(1)}/h`);
    }
    const offered = s.cabinet.requests.some((r) => r.status === 'offered');
    const dot = $('#right .tabs button[data-t="cabinet"] .dot'), hide = !offered || this.tab === 'cabinet';
    if (dot.hidden !== hide) dot.hidden = hide;
  }
}
