// Pacing probe: what lands on the player each game day (hordes, outbreaks, decision cards, letters, cabinet
// requests, refugee groups, dead inside the border) in one game played by a bot.
//   node tools/pacing.mjs [difficulty=recruit] [seed=101] [bot=balanced] [days=30]
// Summary over seeds 101, 202, … per difficulty (quiet-hour share Days 7–30, first contact, dead peak by Day 20,
// cards a day), games run in parallel worker threads:
//   node tools/pacing.mjs --seeds 6 [--diffs recruit,veteran,nightmare] [--bot balanced] [--days 30] [--each]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const R = new URL('../js/', import.meta.url).href;
const KEYS = ['hordes', 'contact', 'crossed', 'outbreaks', 'breakouts', 'decisions', 'letters', 'requests', 'alertsBad', 'alertsAll', 'insidePeak', 'deadPeak', 'quietHours'];

// One game: a row per finished game day. A quiet hour has no dead inside the border, no horde in contact and no
// town with an outbreak.
async function play(diff, seed, botName, days) {
  const { Sim } = await import(R + 'sim/sim.js');
  const { BOTS } = await import(R + 'ai/bots.js');
  const sim = new Sim({ seed, difficulty: diff });
  const bot = BOTS[botName](sim), s = sim.state;
  const day = () => ({ hordes: 0, contact: 0, crossed: 0, outbreaks: 0, breakouts: 0, decisions: 0, letters: 0, requests: 0, refugees: 0, alertsBad: 0, alertsAll: 0, insidePeak: 0, deadPeak: 0, quietHours: 0, hours: 0 });
  const log = [];
  let d = day(), cur = sim.day, seenDecision = null;
  const seenLetters = new Set();
  const close = () => { d.refugees = s.ents.refugees.length; log.push({ day: cur, ...d }); d = day(); cur = sim.day; };
  while (!s.over && sim.day <= days) {
    bot.tick(); sim.step(0.25);
    if (s.events.decision && s.events.decision !== seenDecision) { seenDecision = s.events.decision; d.decisions++; }
    for (const l of s.events.letters) if (!seenLetters.has(l.id)) { seenLetters.add(l.id); d.letters++; }
    let inside = 0;
    for (const z of s.ents.dead) if (!z.gone && sim.map.owner[Math.floor(z.z) * sim.N + Math.floor(z.x)]) inside++;
    d.insidePeak = Math.max(d.insidePeak, inside);
    d.deadPeak = Math.max(d.deadPeak, s.ents.dead.length);
    const busy = inside > 0 || s.hordes.some((h) => h.phase === 'contact') || s.towns.some((t) => t.alerted);
    for (const e of sim.drainEvents()) {
      if (e.type === 'request') d.requests++;
      if (e.type !== 'alert') continue;
      d.alertsAll++;
      if (e.level === 'bad') d.alertsBad++;
      if (e.kind === 'hordeRumour') d.hordes++;
      if (e.kind === 'hordeContact') d.contact++;
      if (e.kind === 'hordeArrived') d.crossed++;
      if (e.kind === 'outbreak') d.outbreaks++;
      if (e.kind === 'breakout') d.breakouts++;
    }
    d.hours += 0.25;
    if (!busy) d.quietHours += 0.25;
    if (sim.day !== cur) close();
  }
  if (d.hours > 0 && cur <= days) close();
  return { log, end: s.over ? (s.over.won ? 'WON' : 'lost: ' + s.over.reason) : 'running', day: sim.day };
}

function summarise(log) {
  const span = log.filter((r) => r.day >= 7 && r.day <= 30);
  const quiet = span.reduce((a, r) => a + r.quietHours, 0), hours = span.reduce((a, r) => a + r.hours, 0);
  const contact = log.find((r) => r.contact > 0);
  const cards = log.reduce((a, r) => a + r.decisions + r.letters + r.requests, 0);
  return {
    quiet: hours ? quiet / hours : 0,
    contact: contact ? contact.day : null,
    peak20: Math.max(0, ...log.filter((r) => r.day <= 20).map((r) => r.deadPeak)),
    peakDay: log.filter((r) => r.day <= 20).reduce((b, r) => (r.deadPeak > (b?.deadPeak ?? -1) ? r : b), null)?.day ?? null,
    cards: cards / Math.max(1, log.length),
    alerts: log.reduce((a, r) => a + r.alertsAll, 0) / Math.max(1, log.length),
  };
}

if (!isMainThread) {
  const { diff, seed, bot, days } = workerData;
  const r = await play(diff, seed, bot, days);
  parentPort.postMessage({ diff, seed, end: r.end, ...summarise(r.log) });
} else {
  const argv = process.argv.slice(2);
  const flags = Object.fromEntries(argv.reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
  if (flags.seeds) {
    const diffs = (flags.diffs || 'recruit,veteran,nightmare').split(','), bot = flags.bot || 'balanced';
    const days = +(flags.days || 30), seeds = +flags.seeds;
    const jobs = [];
    for (const diff of diffs) for (let k = 1; k <= seeds; k++) jobs.push({ diff, seed: k * 101, bot, days });
    const results = [];
    let next = 0;
    const threads = Math.min(jobs.length, Math.max(1, os.cpus().length - 2));
    await new Promise((done) => {
      let active = 0;
      const launch = () => {
        if (next >= jobs.length) { if (!active) done(); return; }
        const job = jobs[next++];
        active++;
        const w = new Worker(fileURLToPath(import.meta.url), { workerData: job });
        w.on('message', (r) => results.push(r));
        w.on('error', (e) => results.push({ ...job, error: String(e) }));
        w.on('exit', () => { active--; launch(); });
      };
      for (let k = 0; k < threads; k++) launch();
    });
    const avg = (rs, f) => rs.reduce((a, r) => a + r[f], 0) / rs.length;
    console.log(`${bot}, ${seeds} seeds, ${days} days`);
    console.log('diff      | quiet D7-30 | first contact (min) | dead peak by D20 | cards/day | alerts/day | ends');
    for (const diff of diffs) {
      const rs = results.filter((r) => r.diff === diff && !r.error);
      const contacts = rs.map((r) => r.contact).filter((c) => c !== null);
      const first = contacts.length ? `${(contacts.reduce((a, b) => a + b, 0) / contacts.length).toFixed(1)} (${Math.min(...contacts)})` : '-';
      const ends = rs.map((r) => r.end).filter((e) => e !== 'running').join(', ') || '-';
      console.log(`${diff.padEnd(9)} | ${(avg(rs, 'quiet') * 100).toFixed(1).padStart(10)}% | ${first.padStart(19)} | ${avg(rs, 'peak20').toFixed(0).padStart(16)} | ${avg(rs, 'cards').toFixed(2).padStart(9)} | ${avg(rs, 'alerts').toFixed(1).padStart(10)} | ${ends}`);
    }
    if (argv.includes('--each')) {
      for (const r of [...results].sort((a, b) => a.diff.localeCompare(b.diff) || a.seed - b.seed)) {
        if (!r.error) console.log(`  ${r.diff.padEnd(9)} seed ${String(r.seed).padEnd(4)} quiet ${(r.quiet * 100).toFixed(1).padStart(5)}%  contact Day ${r.contact ?? '-'}  peak by D20 ${r.peak20} (Day ${r.peakDay})  ${r.end}`);
      }
    }
    for (const r of results) if (r.error) console.log('ERROR', r.diff, r.seed, r.error);
  } else {
    const [diff = 'recruit', seed = '101', botName = 'balanced', days = '30'] = argv;
    const r = await play(diff, +seed, botName, +days);
    console.log(`${diff} seed ${seed} ${botName}: ${r.end} at day ${r.day}`);
    console.log('day ' + KEYS.map((k) => k.slice(0, 7).padStart(8)).join(''));
    for (const row of r.log) console.log(String(row.day).padStart(3) + ' ' + KEYS.map((k) => String(Math.round(row[k] * 10) / 10).padStart(8)).join(''));
  }
}
