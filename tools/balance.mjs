// Balance matrix: bots × difficulties × seeds, run in parallel worker threads.
//   node tools/balance.mjs --bots idle,balanced,turtle,hawk,dove --diffs recruit,veteran,nightmare --seeds 4 --days 50
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

if (isMainThread) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
  const bots = (args.bots || 'idle,balanced,turtle,hawk,dove').split(',');
  const diffs = (args.diffs || 'veteran').split(',');
  const seeds = +(args.seeds || 3);
  const days = +(args.days || 50);
  const mode = args.mode || 'campaign';
  const jobs = [];
  for (const bot of bots) for (const diff of diffs) for (let s = 1; s <= seeds; s++) jobs.push({ bot, diff, seed: s * 101, days, mode });
  const threads = Math.min(jobs.length, Math.max(1, os.cpus().length - 2));
  const results = [];
  let next = 0;
  const t0 = Date.now();
  await new Promise((done) => {
    let active = 0;
    const launch = () => {
      if (next >= jobs.length) { if (!active) done(); return; }
      const job = jobs[next++];
      active++;
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: job });
      w.on('message', (r) => results.push(r));
      w.on('error', (e) => { results.push({ ...job, error: String(e) }); });
      w.on('exit', () => { active--; launch(); });
    };
    for (let k = 0; k < threads; k++) launch();
  });
  results.sort((a, b) => (a.bot + a.diff).localeCompare(b.bot + b.diff) || a.seed - b.seed);
  const table = {};
  for (const r of results) {
    const key = `${r.bot.padEnd(9)} ${r.diff.padEnd(9)}`;
    (table[key] ||= []).push(r);
  }
  console.log(`\n${results.length} runs in ${((Date.now() - t0) / 1000).toFixed(0)} s (${threads} threads)\n`);
  console.log('bot       diff      | won | avg end day | towns | reasons              | peak dead | killed | trust | order');
  for (const [k, rs] of Object.entries(table)) {
    const won = rs.filter((r) => r.won).length;
    const avg = (f) => (rs.reduce((a, r) => a + (r[f] || 0), 0) / rs.length);
    const reasons = {};
    for (const r of rs) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
    console.log(`${k} | ${won}/${rs.length} | ${avg('day').toFixed(1).padStart(11)} | ${avg('towns').toFixed(1).padStart(5)} | ${Object.entries(reasons).map(([a, b]) => `${a}:${b}`).join(' ').padEnd(20)} | ${avg('peakDead').toFixed(0).padStart(9)} | ${avg('killed').toFixed(0).padStart(6)} | ${avg('trust').toFixed(0).padStart(5)} | ${avg('order').toFixed(0).padStart(5)}`);
  }
  for (const r of results) if (r.error) console.log('ERROR', r.bot, r.diff, r.seed, r.error);
  if (args.why !== undefined) {
    for (const [k, rs] of Object.entries(table)) {
      for (const key of ['trustLog', 'orderLog']) {
        const sum = {};
        for (const r of rs) for (const [c, v] of Object.entries(r[key] || {})) sum[c] = (sum[c] || 0) + v / rs.length;
        const top = Object.entries(sum).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 9).map(([c, v]) => `${c} ${v >= 0 ? '+' : ''}${v.toFixed(1)}`).join(' · ');
        console.log(`${k} ${key === 'trustLog' ? 'TRUST' : 'ORDER'}: ${top}`);
      }
    }
  }
  if (args.json) console.log(JSON.stringify(results));
} else {
  const { Sim } = await import('../js/sim/sim.js');
  const { BOTS } = await import('../js/ai/bots.js');
  const job = workerData;
  const sim = new Sim({ seed: job.seed, mode: job.mode, difficulty: job.diff });
  const bot = BOTS[job.bot](sim);
  const daily = [];
  let lastDay = 0;
  while (sim.day <= job.days && !sim.state.over) {
    bot.tick();
    sim.step(0.5);
    sim.drainEvents();
    if (sim.day !== lastDay) {
      lastDay = sim.day;
      const s = sim.state;
      daily.push({ d: sim.day, units: s.ents.units.length, towers: s.ents.buildings.filter((b) => b.type === 'tower').length, walls: s.ents.buildings.filter((b) => b.type === 'wall').length, killed: s.stats.killed, towns: s.towns.filter((t) => t.status === 'ok').length, dead: s.ents.dead.length, funds: Math.round(s.res.funds), food: Math.round(s.res.food), ammo: Math.round(s.res.ammo), trust: Math.round(s.trust), order: Math.round(s.order) });
    }
  }
  const s = sim.state;
  parentPort.postMessage({
    ...job, day: sim.day, won: !!s.over?.won, reason: s.over ? s.over.reason : 'alive',
    towns: s.towns.filter((t) => t.status === 'ok').length, peakDead: s.stats.peakDead, killed: s.stats.killed,
    trust: s.trust, order: s.order, unitsLost: s.stats.unitsLost, admitted: s.stats.admitted, daily,
    trustLog: s.stats.trustLog || {}, orderLog: s.stats.orderLog || {},
  });
}
