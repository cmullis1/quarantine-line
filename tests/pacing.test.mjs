// The pacing director (R16): peaks, guaranteed quiet spells, stragglers that drift away, cards that wait for a breath.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../js/sim/sim.js';
import { spawnDead } from '../js/sim/entities.js';
import { scheduleHorde } from '../js/sim/systems/world.js';
import { DIFFICULTY, HORDE, PACE, MAX_DEAD } from '../js/config/balance.js';
import { DECISIONS } from '../js/config/campaign.js';
import { TER } from '../js/config/world.js';

const step = (sim, hours, every = 0.25) => { for (let h = 0; h < hours - 1e-9; h += every) { sim.step(every); sim.drainEvents(); } };

// A land tile well inside the border, away from the towns, and one well outside it that no one can see.
function insideTile(sim) {
  const m = sim.map, N = sim.N;
  for (let k = 0; k < N * N; k++) {
    const i = k % N, j = (k / N) | 0;
    if (i < 3 || j < 3 || i >= N - 3 || j >= N - 3) continue;
    let all = true;
    for (let dj = -2; dj <= 2 && all; dj++) for (let di = -2; di <= 2; di++) { const q = k + dj * N + di; if (!m.owner[q] || m.terrain[q] !== TER.LAND) { all = false; break; } }
    if (!all || m.townId[k] >= 0) continue;
    if (m.towns.every((t) => Math.hypot(t.x - i, t.z - j) > t.r + 4)) return [i - 0.3, j - 0.3];
  }
}
function outsideTile(sim, far = 10) {
  const m = sim.map, N = sim.N;
  for (let k = 0; k < N * N; k++) {
    const i = k % N, j = (k / N) | 0;
    if (m.owner[k] || m.terrain[k] !== TER.LAND || i < far || j < far || i >= N - far || j >= N - far) continue;
    let near = false;
    for (let dj = -far; dj <= far && !near; dj++) for (let di = -far; di <= far; di++) if (m.owner[(j + dj) * N + i + di]) { near = true; break; }
    if (!near && m.sites.every((s) => Math.hypot(s.x - i, s.z - j) > 6)) return [i + 0.5, j + 0.5];
  }
}
// Dead that stand still, so the test decides where they are.
function rooted(sim, [x, z], n = 1) {
  const out = [];
  for (let k = 0; k < n; k++) { const d = spawnDead(sim, 'walker', x + (k % 4) * 0.3, z + Math.floor(k / 4) * 0.3); d.speed = 0; d.hp = d.maxHp = 1e6; out.push(d); }
  return out;
}
// A horde in contact that never finishes arriving (its spawn queue never drips): the director sees a fight.
const fight = (sim) => {
  const h = { id: sim.newId(), phase: 'contact', comp: { walker: 50 }, spawned: 0, members: 0, x: 0, z: 0, name: 'test', sea: false, label: null, spawnAt: 0, contactAt: 0 };
  sim.state.hordes.push(h);
  sim.state.pending.push({ horde: h.id, x: 0, z: 0, list: ['walker'], acc: -1e9, spread: 0 });
  return h;
};
const quietSim = (o = {}) => { const sim = new Sim({ seed: 3, difficulty: 'recruit', ...o }); sim.state.hordeT = 1e9; sim.state.flags.noSpawns = true; return sim; };

test('every difficulty sets its first horde, relax spell and horde spacing', () => {
  const want = { recruit: [120, 36, 1.6, 0], veteran: [84, 20, 1.2, 0.25], nightmare: [62, 8, 1.0, 0.5] };
  for (const [k, [first, relax, spacing, peakPace]] of Object.entries(want)) {
    const d = DIFFICULTY[k];
    assert.deepEqual([d.firstHorde, d.relaxHours, d.spacing, d.peakPace], [first, relax, spacing, peakPace], k);
    const sim = new Sim({ seed: 2, difficulty: k });
    assert.equal(sim.state.hordeT, first, `${k} first horde`);
    assert.equal(sim.state.pace.phase, 'build');
  }
});

test('a fight is a peak (no trickle, horde clock stopped); then relaxHours of calm, then build with spaced hordes', () => {
  for (const mode of ['campaign', 'sandbox']) {
    const sim = quietSim({ mode });
    step(sim, 1);
    assert.equal(sim.state.pace.phase, 'build', mode);
    const inside = rooted(sim, insideTile(sim), 8);
    step(sim, 0.5);
    assert.equal(sim.state.pace.phase, 'peak', `${mode}: 8 dead inside the border`);
    for (const d of inside.slice(0, 5)) d.hp = 0;
    step(sim, 0.5);
    assert.equal(sim.state.pace.phase, 'relax', `${mode}: 3 dead left inside`);
    const t0 = sim.state.pace.t;
    sim.state.hordeT = 0.01;
    step(sim, DIFFICULTY.recruit.relaxHours - 1);
    assert.equal(sim.state.pace.phase, 'relax');
    assert.ok(!sim.state.hordes.length, 'no new horde starts during relax');
    step(sim, 1.5);
    assert.equal(sim.state.pace.phase, 'build');
    assert.ok(sim.state.pace.t - t0 >= DIFFICULTY.recruit.relaxHours - 0.3);
    const min = HORDE.interval[0] * Math.max(0.6, 1 - sim.day * HORDE.intervalDecay) * DIFFICULTY.recruit.spacing;
    assert.ok(sim.state.hordeT >= min - 0.5, `next horde in ${sim.state.hordeT} h, at least ${min}`);
    const h = fight(sim);
    step(sim, 0.5);
    assert.equal(sim.state.pace.phase, 'peak', `${mode}: a horde in contact`);
    const clock = sim.state.hordeT, dead = sim.state.ents.dead.length;
    sim.state.flags.noSpawns = false;
    sim.state.time = 24 * 12; // well into the trickle
    step(sim, 6);
    assert.equal(sim.state.hordeT, clock, `${mode}: the horde clock stops mid-fight`);
    assert.ok(sim.state.ents.dead.length <= dead, `${mode}: no trickle mid-fight`);
    h.phase = 'destroyed';
  }
});

test('on Nightmare the horde clock keeps running mid-fight, at peakPace', () => {
  const sim = quietSim({ difficulty: 'nightmare' });
  sim.state.hordeT = 100;
  sim.state.flags.noSpawns = false;
  fight(sim);
  step(sim, 0.5);
  assert.equal(sim.state.pace.phase, 'peak');
  const clock = sim.state.hordeT;
  step(sim, 4);
  assert.ok(Math.abs(clock - sim.state.hordeT - 4 * DIFFICULTY.nightmare.peakPace) < 1e-6, `${clock} → ${sim.state.hordeT}`);
});

test('relax: the trickle stops, a pending rumour waits, a scripted set piece keeps its hour', () => {
  const sim = new Sim({ seed: 4, difficulty: 'recruit' });
  sim.state.time = 24 * 8;
  sim.state.hordeT = 1e9;
  sim.state.pace = { ...sim.state.pace, phase: 'peak', t: sim.state.time };
  const rumour = scheduleHorde(sim, { size: 20, lead: 4 });
  const great = scheduleHorde(sim, { size: 20, lead: 4, label: 'The Great Horde' });
  step(sim, 0.5);
  assert.equal(sim.state.pace.phase, 'relax');
  const end = sim.state.pace.t + DIFFICULTY.recruit.relaxHours;
  assert.ok(rumour.spawnAt >= end - 1e-9, 'the rumour waits for the relax spell to end');
  const before = sim.state.ents.dead.filter((z) => !z.horde).length;
  step(sim, 6);
  assert.notEqual(great.phase, 'rumour', 'the set piece spawned on time');
  assert.equal(rumour.phase, 'rumour');
  const strays = sim.state.ents.dead.filter((z) => !z.horde).length;
  assert.ok(strays <= before, `no trickle during relax (${before} → ${strays})`);
});

test('stragglers: unseen 6 h during relax they head home and are gone by 12 h; outside relax by 36 h', () => {
  const sim = quietSim();
  const spot = outsideTile(sim);
  assert.ok(spot, 'an unseen tile outside the border');
  const [walker] = rooted(sim, spot);
  walker.speed = 0.8;
  const home = sim.map.sites.reduce((b, s) => (Math.hypot(s.x - spot[0], s.z - spot[1]) < Math.hypot(b.x - spot[0], b.z - spot[1]) ? s : b));
  const far = Math.hypot(home.x - walker.x, home.z - walker.z);
  sim.state.pace = { ...sim.state.pace, phase: 'relax', t: sim.state.time };
  walker.seenT = sim.state.time - 7;
  const [still] = rooted(sim, [spot[0] + 1, spot[1]]);
  step(sim, 2);
  assert.ok(Math.hypot(home.x - walker.x, home.z - walker.z) < far - 0.5, 'a straggler turns back toward its site');
  assert.ok(!still.gone, 'not yet: seen within the last 12 h');
  step(sim, 11);
  assert.ok(still.gone && !sim.state.ents.dead.includes(still), 'removed after 12 h unseen during relax');
  assert.equal(sim.state.stats.killed, 0, 'drifting away is not a kill');

  const b = quietSim();
  const [lone] = rooted(b, outsideTile(b));
  const h = fight(b);
  const [member] = rooted(b, [lone.x + 1, lone.z]);
  member.horde = h.id;
  step(b, 30);
  assert.equal(b.state.pace.phase, 'peak');
  assert.ok(!lone.gone, 'outside relax a straggler stays for 36 h');
  step(b, 7);
  assert.ok(lone.gone, 'and is removed after 36 h unseen');
  assert.ok(!member.gone, 'a member of a horde in contact is not a straggler');
});

test('a horde whose spawn is done and of which ≤ 15% is left disperses into stragglers', () => {
  const sim = quietSim();
  const h = fight(sim);
  h.comp = { walker: 20 }; h.spawned = 20;
  sim.state.pending = sim.state.pending.filter((p) => p.horde !== h.id);
  const left = rooted(sim, outsideTile(sim), 3);
  for (const z of left) z.horde = h.id;
  step(sim, 0.5);
  assert.equal(h.phase, 'dispersed');
  assert.ok(left.every((z) => z.horde === 0), 'its last few belong to no horde');
  assert.notEqual(sim.state.pace.phase, 'peak');
});

test('a horde cut short at the dead cap (its queue empty, fewer spawned than planned) still ends, and the calm follows', () => {
  const sim = quietSim();
  const s = sim.state;
  const [x, z] = outsideTile(sim);
  // The world is all but full: room for 5 of the horde's 20.
  for (let k = s.ents.dead.length; k < MAX_DEAD - 5; k++) {
    const d = spawnDead(sim, 'walker', x + (k % 40) * 0.02, z + Math.floor(k / 40) * 0.02);
    d.speed = 0; d.hp = d.maxHp = 1e6;
  }
  const h = scheduleHorde(sim, { size: 20, lead: 0.25 });
  step(sim, 0.5);
  assert.notEqual(h.phase, 'rumour');
  h.phase = 'contact';
  step(sim, 3);
  assert.ok(!s.pending.some((p) => p.horde === h.id), 'its spawn queue has run out');
  assert.equal(h.spawned, 5, 'only 5 fitted under the cap');
  assert.equal(s.pace.phase, 'peak', 'a fight while its 5 stand');
  for (const d of s.ents.dead) if (d.horde === h.id) d.hp = 0;
  step(sim, 1);
  assert.ok(h.phase === 'destroyed' || h.phase === 'dispersed', `the horde ends (${h.phase})`);
  assert.equal(s.pace.phase, 'relax', 'and the calm begins');
});

test('the director counts a horde as a fight only while any of it is alive or still to come', () => {
  const sim = quietSim();
  const s = sim.state;
  const h = { id: sim.newId(), phase: 'contact', comp: { walker: 10 }, spawned: 4, members: 0, x: 0, z: 0, name: 'test', sea: false, label: null, spawnAt: 0, contactAt: 0 };
  s.hordes.push(h);
  step(sim, 0.5);
  assert.notEqual(s.pace.phase, 'peak', 'no members and nothing left to spawn: no fight');
  assert.equal(h.phase, 'destroyed');
});

test('a long peak: four cards due at once each come at most 12 h after they fell due, one per 6 h, in due order', () => {
  const sim = quietSim();
  const s = sim.state, ev = s.events;
  fight(sim);
  step(sim, 0.5);
  assert.equal(s.pace.phase, 'peak');
  // Nothing else falls due: every scripted decision has fired. Two decisions queued, a letter and a request due, now.
  const t0 = s.time;
  ev.decision = null; ev.fired = DECISIONS.map((d) => d.id); ev.queue = ['panicBuying', 'lastBroadcast'];
  ev.dueAt = { panicBuying: t0, lastBroadcast: t0 };
  ev.nextRandom = t0; s.cabinet.nextAt = t0; ev.letters = []; s.cabinet.requests = []; s.pace.card = null;
  const shown = [];
  for (let t = 0; t < 48; t += 0.25) {
    sim.step(0.25);
    for (const e of sim.drainEvents()) if (e.type === 'decision' || e.type === 'letter' || e.type === 'request') shown.push({ type: e.type, id: e.id, at: s.time - t0 });
    if (ev.decision) sim.cmd('decide', 0);
  }
  assert.equal(s.pace.phase, 'peak', 'the fight never ended');
  assert.deepEqual(shown.map((c) => c.type), ['decision', 'decision', 'letter', 'request'], 'all four, each once');
  assert.deepEqual(shown.slice(0, 2).map((c) => c.id), ['panicBuying', 'lastBroadcast'], 'decisions in queue order');
  shown.forEach((c, k) => {
    assert.ok(c.at >= PACE.cardHold - 1e-9, `card ${k + 1} held 12 h (${c.at})`);
    assert.ok(c.at <= PACE.cardHold + k * PACE.cardGap + 0.25 + 1e-9, `card ${k + 1} at most 12 h + spacing (${c.at})`);
    if (k) assert.ok(c.at - shown[k - 1].at >= PACE.cardGap - 1e-9, 'one card per 6 h');
  });

  // Due order across kinds: a letter due 2 h before a decision goes first when both have waited out the hold.
  const o = quietSim();
  const os = o.state, oev = os.events;
  fight(o);
  step(o, 0.5);
  const t1 = os.time;
  oev.decision = null; oev.fired = DECISIONS.map((d) => d.id); oev.queue = [];
  oev.nextRandom = t1; os.cabinet.nextAt = 1e9; oev.letters = []; os.pace.card = null;
  step(o, 2);
  oev.queue.push('panicBuying'); oev.dueAt.panicBuying = os.time;
  step(o, 6);
  os.pace.card = os.time; // a set piece's card, shown now: the next gap opens when both have waited 12 h or more
  const seen = [];
  for (let t = 0; t < 14; t += 0.25) {
    o.step(0.25);
    for (const e of o.drainEvents()) if (e.type === 'decision' || e.type === 'letter') seen.push({ type: e.type, at: os.time - t1 });
    if (oev.decision) o.cmd('decide', 0);
  }
  assert.deepEqual(seen.map((c) => c.type), ['letter', 'decision'], 'the earlier-due card goes first');
  assert.ok(Math.abs(seen[0].at - 14) <= 0.25 && Math.abs(seen[1].at - 20) <= 0.25, JSON.stringify(seen));
});

test('cards wait during a peak (at most 12 h), urgent set pieces do not, and come at most one per 6 h', () => {
  const sim = quietSim();
  const s = sim.state;
  fight(sim);
  step(sim, 0.5);
  assert.equal(s.pace.phase, 'peak');
  // Start clean: Day 1's own card may have come before the fight began.
  s.events.decision = null; s.events.queue = []; s.pace.card = null;
  s.cabinet.nextAt = s.time; s.events.nextRandom = s.time;
  s.events.queue.push('panicBuying');
  const offered = () => s.cabinet.requests.length + s.events.letters.length + (s.events.decision ? 1 : 0);
  step(sim, 11);
  assert.equal(offered(), 0, 'nothing lands mid-fight');
  step(sim, 1.5);
  assert.equal(offered(), 1, 'one card after 12 h of waiting');
  step(sim, 5);
  assert.equal(offered(), 1, 'the next waits 6 h');

  const u = quietSim();
  fight(u);
  step(u, 0.5);
  u.state.events.decision = null; u.state.events.queue = ['panicBuying', 'greatHorde'];
  step(u, 0.25);
  assert.equal(u.state.events.decision, 'greatHorde', 'the Great Horde card is not held');
});

test('tutorial: the director stays out of the way', () => {
  const sim = new Sim({ seed: 1, mode: 'tutorial' });
  rooted(sim, insideTile(sim), 10);
  const [lone] = rooted(sim, outsideTile(sim));
  step(sim, 40);
  assert.equal(sim.state.pace.phase, 'build');
  assert.ok(!lone.gone, 'no stragglers removed in the tutorial');
});

test('save and load keep the pace and straggler clocks; an old save gets defaults', () => {
  const sim = quietSim();
  const [lone] = rooted(sim, outsideTile(sim));
  sim.state.pace = { ...sim.state.pace, phase: 'relax', t: sim.state.time, card: 3 };
  step(sim, 1);
  const back = Sim.deserialize(sim.serialize());
  assert.deepEqual(back.state.pace, sim.state.pace);
  assert.equal(back.byId(lone.id).seenT, lone.seenT);

  const old = JSON.parse(sim.serialize());
  delete old.pace;
  for (const z of old.ents.dead) { delete z.seenT; delete z.drift; }
  const loaded = Sim.deserialize(JSON.stringify(old));
  assert.equal(loaded.state.pace.phase, 'build');
  assert.ok(loaded.state.ents.dead.every((z) => z.seenT === old.time && z.drift === -1));
  loaded.step(1);
});

test('the director uses only the seeded stream: one seed, one game', () => {
  const run = () => { const sim = new Sim({ seed: 7, difficulty: 'recruit' }); for (let h = 0; h < 24 * 7; h++) { if (sim.state.events.decision) sim.cmd('decide', 0); sim.step(1); sim.drainEvents(); } return sim.hash(); };
  assert.equal(run(), run());
  assert.ok(PACE.cardGap === 6 && PACE.cardHold === 12);
});
