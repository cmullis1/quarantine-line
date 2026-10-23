// Headless runner: play the sim with a bot and print daily metrics.
//   node tools/headless.mjs --bot idle --days 20 --seed 1 --difficulty veteran --mode campaign --runs 1
import { Sim } from '../js/sim/sim.js';
import { BOTS } from '../js/ai/bots.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const days = +(args.days || 20), runs = +(args.runs || 1), botName = args.bot || 'idle';
const quiet = args.quiet !== undefined;
const results = [];
for (let run = 0; run < runs; run++) {
  const seed = +(args.seed || 1) + run;
  const sim = new Sim({ seed, mode: args.mode || 'campaign', difficulty: args.difficulty || 'veteran' });
  const bot = BOTS[botName](sim);
  const t0 = Date.now();
  let lastDay = 0;
  while (sim.day <= days && !sim.state.over) {
    bot.tick();
    sim.step(1);
    sim.drainEvents();
    if (sim.day !== lastDay && !quiet) {
      lastDay = sim.day;
      const s = sim.state;
      const towns = s.towns.map((t) => (t.status === 'ok' ? (t.alerted ? '!' : '.') : t.status === 'fallen' ? 'X' : 'S')).join('');
      console.log(`D${String(sim.day).padStart(2)} towns ${towns} pop ${(s.population / 1e3).toFixed(0)}k dead ${String(s.ents.dead.length).padStart(3)} ref ${String(s.ents.refugees.length).padStart(3)} units ${String(s.ents.units.length).padStart(2)} bld ${String(s.ents.buildings.length).padStart(3)} | $${s.res.funds.toFixed(0)} food ${s.res.food.toFixed(0)} ammo ${s.res.ammo.toFixed(0)} mp ${s.res.manpower.toFixed(0)} auth ${s.res.authority.toFixed(0)} | trust ${s.trust.toFixed(0)} order ${s.order.toFixed(0)} | killed ${s.stats.killed}`);
    }
  }
  const s = sim.state;
  const res = { seed, bot: botName, day: sim.day, over: s.over ? `${s.over.won ? 'WON' : 'LOST'}:${s.over.reason}:${s.over.ending}` : 'running', towns: s.towns.filter((t) => t.status === 'ok').length, killed: s.stats.killed, ms: Date.now() - t0 };
  results.push(res);
  console.log(JSON.stringify(res));
}
