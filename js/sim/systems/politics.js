// Research, scripted decisions, letters, cabinet requests, the news wire, acts, and the end of the game.
import { WIN_DAY } from '../../config/balance.js';
import { DECISIONS, DECISION_BY_ID, ACTS, ENDINGS, scoreOf } from '../../config/campaign.js';
import { LETTERS, LETTER_BY_ID } from '../../config/letters.js';
import { REQUESTS, REQUEST_BY_ID, MINISTERS } from '../../config/cabinet.js';
import { NEWS } from '../../config/news.js';
import { RESEARCH_BY_ID } from '../../config/research.js';
import { ALERT_RULES } from '../../config/alerts.js';
import { hitTrust, changeTrust, withCause } from './economy.js';

// ---- Research --------------------------------------------------------------------------

function researchTick(sim, dt) {
  const r = sim.state.research;
  if (!r.active) return;
  const spend = Math.min(sim.state.res.research, dt * 25);
  sim.state.res.research -= spend;
  r.progress[r.active] = (r.progress[r.active] || 0) + spend;
  const tech = RESEARCH_BY_ID[r.active];
  if (r.progress[r.active] >= tech.cost) {
    r.done.push(r.active);
    r.active = null;
    if (tech.id === 'e4') for (const b of sim.state.ents.buildings) if (b.type === 'wall' || b.type === 'highwall' || b.type === 'gate') { b.maxHp *= 1.5; b.hp *= 1.5; }
    sim.alert('tech', `Research complete: ${tech.name}.`, null, null, 'good');
    sim.emit('tech', { id: tech.id });
    sim.emit('policy', {});
  }
}

// ---- Scripted decisions (modal) --------------------------------------------------------

function decisionTick(sim) {
  const s = sim.state, ev = s.events;
  if (s.mode === 'tutorial') return;
  for (const d of DECISIONS) {
    if (ev.fired.includes(d.id) || d.day > sim.day || !d.modes.includes(s.mode)) continue;
    if (d.when && !d.when(sim)) { if (d.day < sim.day - 1) ev.fired.push(d.id); continue; }
    ev.fired.push(d.id);
    ev.queue.push(d.id);
  }
  if (!ev.decision && ev.queue.length) {
    ev.decision = ev.queue.shift();
    sim.emit('decision', { id: ev.decision });
  }
}

export function runDecision(sim, choice) {
  const ev = sim.state.events;
  const d = DECISION_BY_ID[ev.decision];
  if (!d) return { ok: false, why: 'No decision pending' };
  const c = d.choices[choice];
  if (!c) return { ok: false, why: 'No such choice' };
  ev.decision = null;
  (ev.history || (ev.history = [])).push({ id: d.id, choice, day: sim.day });
  withCause(sim, `decision: ${d.title.split(': ')[1] || d.title}`, () => c.run(sim));
  sim.emit('policy', {});
  return { ok: true };
}

// ---- Letters (non-blocking) --------------------------------------------------------------

function letterTick(sim) {
  const s = sim.state, ev = s.events;
  if (s.mode === 'tutorial') return;
  if (s.time >= ev.nextRandom) {
    ev.nextRandom = s.time + sim.range(60, 100);
    const open = new Set(ev.letters.map((l) => l.defId));
    const pool = LETTERS.filter((l) => !open.has(l.id) && (!l.when || l.when(sim)));
    for (let tries = 0; tries < 6 && pool.length; tries++) {
      const def = sim.pick(pool);
      const p = def.params ? def.params(sim) : {};
      if (!p) continue;
      const letter = { id: sim.newId(), defId: def.id, p, until: s.time + 24 };
      ev.letters.push(letter);
      sim.emit('letter', { id: letter.id });
      break;
    }
  }
  for (const l of [...ev.letters]) if (s.time >= l.until) resolveLetter(sim, l.id, LETTER_BY_ID[l.defId].default ?? 0, true);
}

export function resolveLetter(sim, id, choice, expired = false) {
  const ev = sim.state.events;
  const l = ev.letters.find((x) => x.id === id);
  if (!l) return { ok: false, why: 'No such letter' };
  const def = LETTER_BY_ID[l.defId];
  const c = def.choices[choice];
  if (!c) return { ok: false, why: 'No such choice' };
  ev.letters.splice(ev.letters.indexOf(l), 1);
  withCause(sim, `letter: ${def.title}`, () => c.run(sim, l.p));
  if (expired) sim.alert('letterExpired', `${def.title}: no answer, so "${c.label}".`, null, null, 'info');
  return { ok: true };
}

// ---- Cabinet requests ------------------------------------------------------------------

function cabinetTick(sim) {
  const s = sim.state, cab = s.cabinet;
  if (s.mode === 'tutorial') return;
  const active = cab.requests.filter((r) => r.status === 'offered' || r.status === 'accepted');
  if (s.time >= cab.nextAt && active.length < 2) {
    cab.nextAt = s.time + sim.range(36, 60);
    const order = ['defence', 'health', 'interior'];
    const start = cab.rot || 0;
    for (let n = 0; n < 3; n++) {
      const minister = order[(start + n) % 3];
      const pool = REQUESTS.filter((r) => r.minister === minister && !active.some((a) => a.defId === r.id));
      const def = pool.length ? sim.pick(pool) : null;
      const p = def ? def.make(sim) : null;
      if (!p) continue;
      cab.rot = (start + n + 1) % 3;
      const req = { id: sim.newId(), defId: def.id, minister, p, status: 'offered', offeredAt: s.time, until: s.time + 12 };
      cab.requests.push(req);
      sim.emit('request', { id: req.id });
      sim.alert('request', `${MINISTERS[minister].name} has a request.`, null, null, 'info');
      sim.lesson('cabinet');
      break;
    }
  }
  for (const req of cab.requests) {
    if (req.status === 'offered' && s.time >= req.until) { req.status = 'ignored'; s.res.authority = Math.max(0, s.res.authority - 2); }
    if (req.status !== 'accepted') continue;
    const def = REQUEST_BY_ID[req.defId];
    if (def.hold) {
      if (def.broken(sim, req)) finishRequest(sim, req, false);
      else if (s.time >= req.until) finishRequest(sim, req, true);
    } else if (def.check(sim, req)) finishRequest(sim, req, true);
    else if (s.time >= req.until) finishRequest(sim, req, false);
    else if (!req.warned && req.until - s.time <= ALERT_RULES.deadlineHours) {
      req.warned = true;
      sim.alert('deadline', `${Math.ceil(req.until - s.time)} h left on your promise to ${MINISTERS[req.minister].name}.`, null, null, 'warn');
    }
  }
  if (cab.requests.length > 30) cab.requests = cab.requests.filter((r) => r.status === 'offered' || r.status === 'accepted' || s.time - r.offeredAt < 96);
}

function finishRequest(sim, req, ok) {
  const s = sim.state, def = REQUEST_BY_ID[req.defId], m = MINISTERS[req.minister];
  req.status = ok ? 'kept' : 'broken';
  req.doneAt = s.time;
  if (ok) {
    sim.gain(def.reward);
    if (def.trustReward) changeTrust(sim, def.trustReward, 'promises kept');
    s.stats.promisesKept++;
    sim.alert('promiseKept', `Promise kept: ${m.name} is satisfied.`, null, null, 'good');
  } else {
    hitTrust(sim, 6, 'promises broken');
    s.res.authority = Math.max(0, s.res.authority - 5);
    s.stats.promisesBroken++;
    sim.alert('promiseBroken', `Promise broken: ${m.name} will remember this.`, null, null, 'bad');
  }
  sim.emit('requestDone', { id: req.id, ok });
}

export function answerRequest(sim, id, accept) {
  const req = sim.state.cabinet.requests.find((r) => r.id === id);
  if (!req || req.status !== 'offered') return { ok: false, why: 'No such request' };
  const def = REQUEST_BY_ID[req.defId];
  if (accept) { req.status = 'accepted'; req.until = sim.state.time + def.hours; }
  else { req.status = 'declined'; sim.state.res.authority = Math.max(0, sim.state.res.authority - 2); }
  return { ok: true };
}

// ---- Hourly: news, scandals, set pieces, acts ---------------------------------------------

function hourly(sim) {
  const s = sim.state;
  for (const n of NEWS) {
    if (s.news.fired.includes(n.id) || !n.when(sim)) continue;
    s.news.fired.push(n.id);
    const item = { id: n.id, text: n.text(sim), t: s.time };
    (s.news.feed || (s.news.feed = [])).unshift(item);
    if (s.news.feed.length > 12) s.news.feed.pop();
    sim.emit('news', item);
    break;
  }
  if (sim.hasLaw('managed') && Math.floor(sim.hour) === 12 && sim.chance(0.03)) {
    changeTrust(sim, -15, 'news scandal');
    sim.alert('scandal', 'SCANDAL: a leaked memo shows the news is being managed.', null, null, 'bad');
  }
  const sof = s.flags.showOfForce;
  if (sof) {
    // Judged on what the cameras saw: the horde broken (85% of it put down) for at most one unit lost is
    // a triumph; losing more units is a disaster the moment it happens; a horde still standing when the
    // broadcast ends is an embarrassing stalemate.
    const h = s.hordes.find((x) => x.id === sof.horde);
    const arriving = h && (h.phase === 'rumour' || s.pending.some((p) => p.horde === h.id));
    const broken = !h || h.phase === 'destroyed' || (!arriving && h.spawned > 0 && h.members <= h.spawned * 0.15);
    const lost = s.stats.unitsLost - sof.lost;
    if (lost > 1) {
      s.flags.showOfForce = null;
      hitTrust(sim, 20, 'televised stand');
      sim.alert('showOfForce', 'The televised battle was a disaster, broadcast live: soldiers dying on camera.', null, null, 'bad');
    } else if (broken) {
      s.flags.showOfForce = null;
      changeTrust(sim, 15, 'televised stand');
      sim.alert('showOfForce', 'The televised stand was a triumph. The nation cheers.', null, null, 'good');
    } else if (s.time >= sof.until) {
      s.flags.showOfForce = null;
      hitTrust(sim, 5, 'televised stand');
      sim.alert('showOfForce', 'The broadcast ended with the dead still standing at Kirsk. Commentators call it a stalemate.', null, null, 'warn');
    }
  }
  if (s.mode !== 'tutorial' && s.flags.act !== sim.act) {
    s.flags.act = sim.act;
    const a = ACTS[sim.act - 1];
    sim.emit('act', { n: a.n, title: a.title, sub: a.sub });
  }
}

// ---- Government in danger -------------------------------------------------------------

// [state key, flag, words]
const DANGER = [['trust', 'dangerTrust', 'public trust'], ['order', 'dangerOrder', 'public order']];

// Once each time trust or order falls below the line; it can sound again only after climbing back clear of it.
function dangerTick(sim) {
  const s = sim.state, f = s.flags;
  for (const [key, flag, words] of DANGER) {
    if (!f[flag] && s[key] < ALERT_RULES.danger) {
      f[flag] = true;
      sim.alert('danger', `Government in danger: ${words} below ${ALERT_RULES.danger}.`, null, null, 'bad');
    } else if (f[flag] && s[key] >= ALERT_RULES.rearm) f[flag] = false;
  }
}

// ---- The end ------------------------------------------------------------------------------

export function record(sim, won, reason) {
  const s = sim.state;
  const living = s.towns.filter((t) => t.status === 'ok');
  return {
    won, reason, days: sim.day, trust: Math.round(s.trust), order: Math.round(s.order),
    towns: living.length, townsTotal: s.towns.length, popSaved: Math.round(living.reduce((a, t) => a + t.pop, 0)),
    deaths: Math.round(s.stats.deadPeople), reportedCases: s.towns.reduce((a, t) => a + t.reported, 0),
    admitted: s.stats.admitted, turnedAway: s.stats.turnedAway, shot: s.stats.shot, killed: s.stats.killed,
    unitsLost: s.stats.unitsLost, reclaimed: s.stats.townsReclaimed, laws: [...s.laws],
    promisesKept: s.stats.promisesKept, promisesBroken: s.stats.promisesBroken, evacuated: Math.round(s.stats.evacuated),
    decisions: (s.events.history || []).map((h) => ({ ...h })),
  };
}

function end(sim, won, reason) {
  const rec = record(sim, won, reason);
  const ending = ENDINGS.find((e) => e.test(rec));
  sim.state.over = { won, reason, ending: ending.id, record: rec, score: scoreOf(rec) };
  sim.emit('over', { won, reason, ending: ending.id });
}

function endCheck(sim) {
  const s = sim.state;
  if (s.over || s.mode === 'tutorial') return;
  const cap = sim.map.towns.find((t) => t.capital);
  if (s.towns[cap.id].status !== 'ok') return end(sim, false, 'capital');
  if (s.trust <= 0.5) return end(sim, false, 'trust');
  if (s.order <= 0.5) return end(sim, false, 'order');
  if (s.mode === 'campaign' && s.time >= (WIN_DAY - 1) * 24 + 7) return end(sim, true, 'survived');
}

export function politicsSystem(sim, dt) {
  const s = sim.state;
  researchTick(sim, dt);
  decisionTick(sim);
  letterTick(sim);
  cabinetTick(sim);
  dangerTick(sim);
  if (Math.floor(s.time) !== Math.floor(s.time - dt)) hourly(sim);
  endCheck(sim);
}
