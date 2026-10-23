// New units (R15.8): the Machine-Gun Team sets up before it fires and only into the arc it faces, the Medic Team
// heals squads around it, the Scout sees twice as far as a squad and runs from the dead, the Mortar Team shells
// crowds 3–12 tiles off once Field Doctrine is researched. Where they are trained, set-up across a save,
// attack-moves, who a shell's kills go to, and the lesson the first of each brings up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../js/sim/sim.js';
import { spawnUnit, removeUnit, spawnDead, makeBuilding, killDead } from '../js/sim/entities.js';
import { recomputeVision } from '../js/sim/systems/fog.js';
import { UNITS } from '../js/config/units.js';
import { BUILDINGS, WEAPONS } from '../js/config/buildings.js';
import { COMBAT } from '../js/config/balance.js';
import { LESSONS, MANUAL_ORDER } from '../js/config/lessons.js';
import { squadStatus } from '../js/ui/overview.js';

// A day-time sim with no starting army, so only the units a test spawns act.
function quiet(seed = 1) {
  const sim = new Sim({ seed }), s = sim.state;
  s.time = 12;
  for (const u of [...s.ents.units]) removeUnit(sim, u, false);
  s.res.ammo = 1e4;
  return sim;
}

// An open, home-territory tile with land all around, `off` tiles from the HQ.
function openSpot(sim, off = 12) {
  const hq = sim.state.ents.buildings.find((b) => b.type === 'hq');
  for (let r = off; r < off + 20; r++) {
    for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
      const x = Math.floor(hq.x + dx) + 0.5, z = Math.floor(hq.z + dz) + 0.5;
      let ok = true;
      for (let j = -5; j <= 5 && ok; j++) for (let i = -5; i <= 5 && ok; i++) {
        const k = Math.floor(z + j) * sim.N + Math.floor(x + i);
        if (!sim.map.owner[k] || !sim.nav.unitPass(k)) ok = false;
      }
      if (ok) return { x, z };
    }
  }
  throw new Error('no open spot');
}

// A tough walker held in place, so the shooter's facing alone decides whether it fires.
function pinnedDead(sim, x, z) {
  const d = spawnDead(sim, 'walker', x, z);
  d.rise = 0;
  const pin = { d, x, z, hold() { d.x = pin.x; d.z = pin.z; d.hp = d.maxHp = 1e6; } };
  return pin;
}

// A home-territory strip (always in sight) running `len` tiles east of the returned spot, open ground, beyond the
// reach of the HQ's gun.
function homeRow(sim, len = 14) {
  const N = sim.N, hq = sim.state.ents.buildings.find((b) => b.type === 'hq');
  for (let j = 3; j < N - 3; j++) for (let i = 3; i < N - len - 3; i++) {
    if (Math.hypot(i - hq.x, j - hq.z) < len + 10) continue;
    let ok = true;
    for (let dj = -2; dj <= 2 && ok; dj++) for (let t = -1; t <= len && ok; t++) {
      const k = (j + dj) * N + i + t;
      if (!sim.map.owner[k] || !sim.nav.unitPass(k)) ok = false;
    }
    if (ok) return { x: i + 0.5, z: j + 0.5 };
  }
  throw new Error('no home row');
}

// `n` walkers packed within 0.4 tiles of (x, z), rooted to the spot and too tough to die, so a test can read the
// damage each one takes.
function crowd(sim, x, z, n = 5) {
  const at = [], ds = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2, r = k ? 0.4 : 0;
    const d = spawnDead(sim, 'walker', x + Math.cos(a) * r, z + Math.sin(a) * r);
    d.rise = 0; d.speed = 0; d.hp = d.maxHp = 1e4;
    at.push([d.x, d.z]);
    ds.push(d);
  }
  return { ds, hold() { ds.forEach((d, k) => { [d.x, d.z] = at[k]; }); } };
}

// Steps `hours` and counts the shells fired (by anyone: the tests that count them have one gun).
function shells(sim, hours, each = () => {}) {
  let n = 0;
  for (let h = 0; h < hours - 1e-9; h += 0.05) {
    each();
    sim.step(0.05);
    n += sim.drainEvents().filter((e) => e.type === 'artillery').length;
  }
  return n;
}

// Steps `hours` and counts the shots `id` fired.
function run(sim, hours, id, each = () => {}) {
  let shots = 0;
  for (let h = 0; h < hours - 1e-9; h += 0.05) {
    each();
    sim.step(0.05);
    shots += sim.drainEvents().filter((e) => e.type === 'shot' && e.shooter === id).length;
  }
  return shots;
}

test('new unit and weapon values are the design table\'s', () => {
  assert.deepEqual(UNITS.mg, {
    name: 'Machine-Gun Team', icon: '🔫', figs: 2, hp: 60, speed: 2.6, weapon: 'hmg', contain: 2, setup: 1, arc: 100,
    upkeep: { funds: 0.2 }, train: 5, cost: { funds: 45, manpower: 8, food: 5 },
    desc: 'Sets up in 1 h when it stops, then pours fire into a 100° arc. Cannot fire on the move. Hungry and loud.',
  });
  assert.deepEqual(UNITS.medic, {
    name: 'Medic Team', icon: '⛑️', figs: 2, hp: 50, speed: 3, weapon: 'pistol', contain: 2, heal: { radius: 3, rate: 10 },
    upkeep: { funds: 0.15 }, train: 4, cost: { funds: 30, manpower: 6, food: 10 },
    desc: 'Heals every squad within 3 tiles by 10 HP/h. Keep it behind the line.',
  });
  assert.deepEqual(UNITS.scout, {
    name: 'Scout', icon: '🏍️', figs: 0, hp: 40, speed: 7, weapon: 'carbine', contain: 1, vision: 12, evade: { radius: 4, run: 6 },
    upkeep: { funds: 0.08 }, train: 2, cost: { funds: 20, manpower: 4 },
    desc: 'Motorbike scout: the fastest thing on the ground, with more than twice a squad\'s sight. It runs from fights.',
  });
  assert.deepEqual(WEAPONS.hmg, { range: 5.5, dmg: 7, rof: 0.1, ammo: 0.12, noise: 8, color: 0xffd060 });
  assert.deepEqual(WEAPONS.pistol, { range: 3, dmg: 6, rof: 0.7, ammo: 0.05, noise: 2, color: 0xffe08a });
  assert.deepEqual(WEAPONS.carbine, { range: 4, dmg: 8, rof: 0.7, ammo: 0.1, noise: 3, color: 0xffe08a });
  assert.deepEqual(UNITS.mortar, {
    name: 'Mortar Team', icon: '💥', figs: 2, hp: 50, speed: 2.6, weapon: 'mortar', contain: 1, requires: 'k2',
    upkeep: { funds: 0.2 }, train: 5, cost: { funds: 55, manpower: 8, food: 5 },
    desc: 'Lobs shells 3–12 tiles over walls into the thickest crowd it can see. Helpless up close.',
  });
  assert.deepEqual(WEAPONS.mortar, { range: 12, minRange: 3, dmg: 40, rof: 2.5, ammo: 1.5, noise: 14, radius: 1.5, flight: 0.8 });
  assert.ok(BUILDINGS.barracks.trains.includes('mortar') && !BUILDINGS.hq.trains.includes('mortar'), 'mortars come from a Barracks');
});

test('HQ trains medics and scouts; the Barracks trains all three', () => {
  for (const t of ['medic', 'scout']) assert.ok(BUILDINGS.hq.trains.includes(t), `HQ trains ${t}`);
  assert.ok(!BUILDINGS.hq.trains.includes('mg'), 'MG teams need a Barracks');
  for (const t of ['mg', 'medic', 'scout']) assert.ok(BUILDINGS.barracks.trains.includes(t), `Barracks trains ${t}`);

  const sim = quiet(), s = sim.state;
  Object.assign(s.res, { funds: 1e4, manpower: 1e4, food: 1e4 });
  const hq = s.ents.buildings.find((b) => b.type === 'hq');
  const p = openSpot(sim);
  const bar = makeBuilding(sim, 'barracks', Math.floor(p.x), Math.floor(p.z), { instant: true });
  assert.equal(sim.cmd('train', hq.id, 'medic').ok, true);
  assert.equal(sim.cmd('train', hq.id, 'scout').ok, true);
  assert.equal(sim.cmd('train', hq.id, 'mg').ok, false);
  for (const t of ['mg', 'medic', 'scout']) assert.equal(sim.cmd('train', bar.id, t).ok, true, t);
  sim.step(20);
  for (const t of ['mg', 'medic', 'scout']) assert.ok(s.ents.units.some((u) => u.type === t), `${t} trained`);
});

test('an MG team fires only after an hour standing still, never behind it, and moving resets it', () => {
  const sim = quiet(), p = openSpot(sim);
  const mg = spawnUnit(sim, 'mg', p.x, p.z);
  assert.equal(mg.setup, 0);
  // Spawned units face −z; a walker 3 tiles in front, well inside its range.
  const front = pinnedDead(sim, p.x, p.z - 3);
  assert.equal(run(sim, 0.9, mg.id, front.hold), 0, 'no fire while setting up');
  assert.ok(mg.setup > 0.85 && mg.setup < 1, `setting up: ${mg.setup}`);
  assert.ok(run(sim, 0.4, mg.id, front.hold) > 0, 'fires once set up');
  assert.equal(mg.setup, UNITS.mg.setup, 'set-up is capped');

  // The same walker behind it: the team does not swing round to it.
  const rot = mg.rot;
  const back = front;
  back.z = p.z + 3;
  assert.equal(run(sim, 1.5, mg.id, back.hold), 0, 'never fires behind its arc');
  assert.equal(mg.rot, rot, 'its facing holds');

  // Ordered east: set-up drops to zero on the move, and once it stops it faces east and sets up again.
  assert.equal(sim.cmd('move', [mg.id], p.x + 3, p.z).ok, true);
  run(sim, 0.1, mg.id, back.hold);
  assert.equal(mg.setup, 0, 'moving resets set-up');
  const fired = run(sim, 0.5, mg.id, back.hold);
  assert.equal(fired, 0, 'no fire on the move or straight after');
  assert.ok(Math.abs(mg.rot - Math.PI / 2) < 0.2, `faces the way it was sent: ${mg.rot}`);
});

test('a loaded game keeps an MG team\'s set-up and facing', () => {
  const sim = quiet(), p = openSpot(sim);
  const mg = spawnUnit(sim, 'mg', p.x, p.z);
  sim.cmd('move', [mg.id], p.x + 3, p.z);
  sim.step(3);
  assert.equal(mg.setup, 1);
  const loaded = Sim.deserialize(sim.serialize());
  const m2 = loaded.byId(mg.id);
  assert.deepEqual([m2.setup, m2.rot, m2.face], [mg.setup, mg.rot, mg.face]);
  // Set up as saved: it fires at once at a walker in its arc.
  const ahead = pinnedDead(loaded, m2.x + 3, m2.z);
  loaded.drainEvents();
  assert.ok(run(loaded, 0.3, m2.id, ahead.hold) > 0, 'fires straight after loading');
});

test('a medic heals squads within 3 tiles by 10 HP/h, takes the max with a depot, never heals an APC', () => {
  const sim = quiet(), p = openSpot(sim, 20);
  const medic = spawnUnit(sim, 'medic', p.x, p.z);
  const inf = spawnUnit(sim, 'infantry', p.x + 2, p.z);
  const apc = spawnUnit(sim, 'apc', p.x - 2, p.z);
  const far = spawnUnit(sim, 'infantry', p.x, p.z + 4.5);
  inf.hp = 30; apc.hp = 100; far.hp = 30; medic.hp = 20;
  sim.step(1);
  assert.ok(Math.abs(inf.hp - 40) < 1e-6, `infantry: ${inf.hp}`);
  assert.ok(Math.abs(medic.hp - 30) < 1e-6, `the medic heals itself: ${medic.hp}`);
  assert.equal(apc.hp, 100, 'vehicles are not patched up');
  assert.equal(far.hp, 30, 'out of reach');

  // Beside a depot (15 HP/h) the medic adds nothing: healing takes the best source.
  const depot = makeBuilding(sim, 'depot', Math.floor(p.x) - 1, Math.floor(p.z) - 3, { instant: true });
  assert.ok(Math.hypot(depot.x - inf.x, depot.z - inf.z) < BUILDINGS.depot.radius);
  inf.hp = 30;
  sim.step(1);
  assert.ok(Math.abs(inf.hp - (30 + COMBAT.healDepot)) < 1e-6, `with a depot: ${inf.hp}`);
});

test('a scout sees 12 tiles (an infantry squad 5): tiles 12 out are revealed, 13 out are not', () => {
  const sim = quiet(), N = sim.N;
  recomputeVision(sim);
  // A tile nobody can see, with its neighbours 12 and 13 tiles east just as dark.
  let at = null;
  for (let j = 2; j < N - 2 && !at; j++) for (let i = 2; i < N - 16 && !at; i++) {
    const k = j * N + i;
    if (!sim.vis[k] && !sim.vis[k + 12] && !sim.vis[k + 13]) at = { i, j };
  }
  assert.ok(at, 'a dark tile');
  const k = at.j * N + at.i;
  const inf = spawnUnit(sim, 'infantry', at.i + 0.5, at.j + 0.5);
  recomputeVision(sim);
  assert.equal(sim.vis[k], 1);
  assert.equal(sim.vis[k + 12], 0, 'a squad does not see 12 tiles');
  removeUnit(sim, inf, false);
  spawnUnit(sim, 'scout', at.i + 0.5, at.j + 0.5);
  recomputeVision(sim);
  assert.equal(sim.vis[k + 12], 1, '12 tiles out');
  assert.equal(sim.vis[k + 13], 0, '13 tiles out');
});

// Steps until a shell is in the air and then until it lands: a copy of the shell, and its burst.
function firstBurst(sim, hold) {
  let shell = null, burst = null;
  for (let h = 0; h < 4 && !burst; h += 0.05) {
    hold();
    sim.step(0.05);
    for (const e of sim.drainEvents()) if (e.type === 'explode' && shell) burst = e;
    if (!shell && sim.state.ents.shells.length) shell = { ...sim.state.ents.shells[0] };
  }
  return { shell, burst };
}

// What each walker lost to a burst at (x, z): the weapon's damage, less with distance, inside its radius only.
function assertBurst(ds, at, W) {
  for (const d of ds) {
    const dist = Math.hypot(d.x - at.x, d.z - at.z);
    const want = dist <= W.radius ? W.dmg * (1 - dist / (W.radius * 1.5)) : 0;
    assert.ok(Math.abs(1e4 - d.hp - want) < 1e-6, `${dist.toFixed(2)} tiles from the burst: lost ${1e4 - d.hp}, want ${want}`);
  }
}

test('a mortar team shells a crowd 3–12 tiles off, never one closer or farther', () => {
  for (const [off, fires] of [[2.4, false], [8, true], [12.6, false]]) {
    const sim = quiet(), r = homeRow(sim);
    spawnUnit(sim, 'mortar', r.x, r.z);
    const c = crowd(sim, r.x + off, r.z);
    const n = shells(sim, 3, c.hold);
    assert.equal(n > 0, fires, `a crowd ${off} tiles off: ${n} shells`);
  }
});

test('a mortar team does not shell dead it cannot see, and does once a recon flight shows them', () => {
  const sim = quiet(), s = sim.state, N = sim.N;
  recomputeVision(sim);
  // Out of everyone's sight: tiles 7–9 east of the team, and the rows either side.
  let at = null;
  for (let j = 2; j < N - 2 && !at; j++) for (let i = 2; i < N - 12 && !at; i++) {
    let dark = true;
    for (let dj = -1; dj <= 1; dj++) for (let t = 7; t <= 9; t++) if (sim.vis[(j + dj) * N + i + t]) dark = false;
    if (dark) at = { x: i + 0.5, z: j + 0.5 };
  }
  assert.ok(at, 'a dark strip');
  spawnUnit(sim, 'mortar', at.x, at.z);
  const c = crowd(sim, at.x + 8, at.z);
  recomputeVision(sim);
  assert.ok(c.ds.every((d) => !sim.visible(d.x, d.z)), 'the crowd is out of sight');
  assert.equal(shells(sim, 3, c.hold), 0, 'no shells into the dark');
  s.recon.push({ x: at.x + 8, z: at.z, until: s.time + 24 });
  assert.ok(shells(sim, 1, c.hold) > 0, 'shells the crowd once it is seen');
});

test('a mortar team holds fire short of the 1.5 ammo a shell takes', () => {
  const sim = quiet(), s = sim.state, r = homeRow(sim);
  spawnUnit(sim, 'mortar', r.x, r.z);
  const c = crowd(sim, r.x + 8, r.z);
  assert.equal(shells(sim, 3, () => { c.hold(); s.res.ammo = 1; }), 0, 'no shells on 1 ammo');
  s.res.ammo = 100;
  const spent = s.stats.ammoSpent;
  const n = shells(sim, 1, c.hold);
  assert.equal(n, 1, 'one shell once supplied');
  assert.ok(Math.abs(s.stats.ammoSpent - spent - WEAPONS.mortar.ammo) < 1e-9, 'it costs 1.5 ammo');
});

test('a mortar shell carries its weapon and bursts with mortar damage within 1.5 tiles', () => {
  const sim = quiet(), r = homeRow(sim);
  spawnUnit(sim, 'mortar', r.x, r.z);
  const c = crowd(sim, r.x + 8, r.z);
  // Just beyond the burst of a shell landing anywhere in the crowd (an artillery shell would reach it).
  const side = crowd(sim, r.x + 8, r.z + 1.95, 1);
  const { shell, burst } = firstBurst(sim, () => { c.hold(); side.hold(); });
  assert.ok(shell && burst, 'a shell landed');
  assert.equal(shell.w, 'mortar');
  assert.deepEqual([burst.x, burst.z, burst.r], [shell.x, shell.z, WEAPONS.mortar.radius]);
  assertBurst([...c.ds, ...side.ds], shell, WEAPONS.mortar);
  assert.ok(c.ds.some((d) => 1e4 - d.hp === WEAPONS.mortar.dmg), 'the walker it aimed at takes the full 40');
  assert.equal(side.ds[0].hp, 1e4, 'nothing beyond 1.5 tiles');
});

// U4: a team's shells take its rank bonus as a rifle's shots do (a battery has no rank: the next test holds its 90).
test('a Veteran or Elite mortar team\'s shells hit harder by its rank bonus', () => {
  for (const vet of [1, 2]) {
    const sim = quiet(), r = homeRow(sim);
    const mortar = spawnUnit(sim, 'mortar', r.x, r.z);
    mortar.vet = vet;
    const c = crowd(sim, r.x + 8, r.z);
    const { shell, burst } = firstBurst(sim, c.hold);
    assert.ok(shell && burst, 'a shell landed');
    const W = { ...WEAPONS.mortar, dmg: WEAPONS.mortar.dmg * COMBAT.vetBonus[vet] };
    assertBurst(c.ds, shell, W);
    assert.ok(c.ds.some((d) => Math.abs(1e4 - d.hp - W.dmg) < 1e-9), `rank ${vet}: the walker it aimed at takes ${W.dmg}`);
  }
});

test('an artillery battery still shells with its own weapon: range, damage and burst', () => {
  const sim = quiet(), r = homeRow(sim);
  const art = makeBuilding(sim, 'artillery', Math.floor(r.x), Math.floor(r.z) - 1, { instant: true });
  const c = crowd(sim, art.x + 10, art.z);
  const { shell, burst } = firstBurst(sim, c.hold);
  assert.ok(shell && burst, 'a shell landed');
  assert.deepEqual([shell.w, shell.x0, shell.z0, shell.flight], ['artillery', art.x, art.z, WEAPONS.artillery.flight]);
  assert.equal(burst.r, WEAPONS.artillery.radius);
  assertBurst(c.ds, shell, WEAPONS.artillery);
  assert.ok(c.ds.some((d) => 1e4 - d.hp === WEAPONS.artillery.dmg), 'the walker it aimed at takes the full 90');
});

test('a Mortar Team cannot be trained until Field Doctrine (k2) is researched', () => {
  const sim = quiet(), s = sim.state;
  Object.assign(s.res, { funds: 1e4, manpower: 1e4, food: 1e4 });
  const p = openSpot(sim);
  const bar = makeBuilding(sim, 'barracks', Math.floor(p.x), Math.floor(p.z), { instant: true });
  const res = { ...s.res };
  assert.deepEqual(sim.cmd('train', bar.id, 'mortar'), { ok: false, why: 'Requires Field Doctrine' });
  assert.deepEqual([bar.queue, s.res], [[], res], 'nothing queued or spent');
  s.research.done.push('k2');
  assert.equal(sim.cmd('train', bar.id, 'mortar').ok, true);
  sim.step(6);
  assert.ok(s.ents.units.some((u) => u.type === 'mortar'), 'a mortar team trained');
});

test('an attack-move takes MG and mortar teams where they were sent; a rifle squad stops to fight', () => {
  {
    const sim = quiet(), p = openSpot(sim, 20);
    const mg = spawnUnit(sim, 'mg', p.x, p.z), inf = spawnUnit(sim, 'infantry', p.x - 1, p.z);
    const front = pinnedDead(sim, p.x, p.z - 3);
    assert.ok(run(sim, 1.3, mg.id, front.hold) > 0, 'the MG team set up and firing');
    assert.ok(mg.target && inf.target, 'both fighting the walker');
    sim.cmd('move', [mg.id], p.x + 4, p.z, 'attack');
    sim.cmd('move', [inf.id], p.x - 5, p.z, 'attack');
    run(sim, 3, mg.id, front.hold);
    assert.ok(Math.hypot(mg.x - (p.x + 4), mg.z - p.z) < 0.6, `the MG team went: ${(mg.x - p.x).toFixed(2)} tiles`);
    assert.ok(Math.hypot(inf.x - (p.x - 1), inf.z - p.z) < 0.6, 'the rifle squad stayed to fight');
  }
  {
    const sim = quiet(), r = homeRow(sim);
    const mortar = spawnUnit(sim, 'mortar', r.x, r.z);
    const c = crowd(sim, r.x + 9, r.z);
    assert.ok(shells(sim, 0.5, c.hold) > 0 && mortar.target, 'shelling the crowd');
    sim.cmd('move', [mortar.id], r.x + 3, r.z, 'attack');
    mortar.cd = 0; // a shell is due the moment it sets off
    let fired = 0, onTheMove = 0;
    for (let h = 0; h < 3; h += 0.05) {
      c.hold();
      sim.step(0.05);
      const n = sim.drainEvents().filter((e) => e.type === 'artillery').length;
      fired += n;
      if (n && mortar.moving) onTheMove += n;
    }
    assert.ok(Math.hypot(mortar.x - (r.x + 3), mortar.z - r.z) < 0.6, `the mortar team went: ${(mortar.x - r.x).toFixed(2)} tiles`);
    assert.equal(onTheMove, 0, 'never fires on the move');
    assert.ok(fired > 0, 'fires again once it stops');
  }
});

// A scout runs from the dead (U3): when any are within 4 tiles and it is not holding or attack-moving, it drives
// 6 tiles straight away from the nearest, as far as open ground goes, else toward the HQ.
test('a scout runs 6 tiles straight away from the dead within 4 tiles; a held or attack-moving one stands', () => {
  {
    const sim = quiet(), r = homeRow(sim, 16);
    const scout = spawnUnit(sim, 'scout', r.x + 9, r.z);
    const far = pinnedDead(sim, r.x + 14, r.z);
    run(sim, 1, scout.id, far.hold);
    assert.ok(Math.hypot(scout.x - (r.x + 9), scout.z - r.z) < 0.3, 'a walker 5 tiles off does not move it');
    far.x = r.x + 12; // now 3 tiles east
    run(sim, 1.5, scout.id, far.hold);
    assert.ok(Math.hypot(scout.x - (r.x + 3), scout.z - r.z) < 0.6, `6 tiles west: ${(scout.x - r.x).toFixed(2)}, ${(scout.z - r.z).toFixed(2)}`);
    assert.equal(scout.order, 'idle', 'and stops there, 9 tiles off');
  }
  {
    const sim = quiet(), r = homeRow(sim, 16);
    const scout = spawnUnit(sim, 'scout', r.x + 9, r.z);
    sim.cmd('hold', [scout.id]);
    const near = pinnedDead(sim, r.x + 12, r.z);
    run(sim, 1, scout.id, near.hold);
    assert.ok(Math.hypot(scout.x - (r.x + 9), scout.z - r.z) < 0.3, 'held: it stands');
  }
  {
    const sim = quiet(), r = homeRow(sim, 16);
    const scout = spawnUnit(sim, 'scout', r.x + 9, r.z);
    const near = pinnedDead(sim, r.x + 12, r.z + 1);
    sim.cmd('move', [scout.id], r.x + 15, r.z, 'attack');
    assert.ok(run(sim, 1, scout.id, near.hold) > 0, 'attack-moving: it stops to fight');
    assert.ok(scout.x > r.x + 9 && scout.order === 'amove', `and does not run (${(scout.x - r.x).toFixed(2)})`);
  }
});

test('a scout with its back to a wall runs toward the HQ instead', () => {
  const sim = quiet(), p = openSpot(sim, 20);
  const hq = sim.state.ents.buildings.find((b) => b.type === 'hq');
  // Home is along one axis; the walker comes from one side across it, and a wall stands on the other side.
  const hx = Math.sign(Math.round(hq.x - p.x)), hz = Math.sign(Math.round(hq.z - p.z));
  const sx = -hz, sz = hx;
  for (let t = -2; t <= 2; t++) makeBuilding(sim, 'wall', Math.floor(p.x - sx * 1.5 + hx * t), Math.floor(p.z - sz * 1.5 + hz * t), { instant: true });
  const scout = spawnUnit(sim, 'scout', p.x, p.z);
  const near = pinnedDead(sim, p.x + sx * 3, p.z + sz * 3);
  const before = Math.hypot(hq.x - scout.x, hq.z - scout.z);
  run(sim, 1.5, scout.id, near.hold);
  const after = Math.hypot(hq.x - scout.x, hq.z - scout.z);
  assert.ok(before - after > 3, `it ran home: ${before.toFixed(1)} → ${after.toFixed(1)} tiles from the HQ`);
});

test('a scout does not run from the dead still rising', () => {
  const sim = quiet(), r = homeRow(sim, 16);
  const scout = spawnUnit(sim, 'scout', r.x + 9, r.z);
  const near = pinnedDead(sim, r.x + 12, r.z);
  run(sim, 1, scout.id, () => { near.hold(); near.d.rise = 1; });
  assert.ok(Math.hypot(scout.x - (r.x + 9), scout.z - r.z) < 0.3, 'a corpse getting up 3 tiles off does not move it');
  near.d.rise = 0;
  run(sim, 1.5, scout.id, near.hold);
  assert.ok(scout.x < r.x + 4, `once it is up, the scout runs: ${(scout.x - r.x).toFixed(2)}`);
});

// Sends a scout east along a home row toward a walker pinned in its way, and steps until it has turned and run.
function runFromAhead(sim, r) {
  const scout = spawnUnit(sim, 'scout', r.x, r.z);
  const ahead = pinnedDead(sim, r.x + 9, r.z);
  assert.equal(sim.cmd('move', [scout.id], r.x + 15, r.z).ok, true);
  let px = scout.x, ran = false;
  for (let h = 0; h < 2 && !ran; h += 0.05) {
    ahead.hold();
    sim.step(0.05);
    ran = scout.x < px - 1e-6;
    px = scout.x;
  }
  assert.ok(ran, 'the scout turned and ran');
  return { scout, ahead };
}

test('after a run a scout drives on to where it was sent, once no dead are within 4 tiles', () => {
  const sim = quiet(), r = homeRow(sim, 16);
  const { scout, ahead } = runFromAhead(sim, r);
  killDead(sim, ahead.d);
  sim.step(3);
  assert.ok(Math.hypot(scout.x - (r.x + 15), scout.z - r.z) < 0.6, `it got there: ${(scout.x - r.x).toFixed(2)}, ${(scout.z - r.z).toFixed(2)}`);
  assert.equal(scout.order, 'idle');
});

test('a scout given a new order mid-run forgets where it was going', () => {
  const sim = quiet(), r = homeRow(sim, 16);
  const { scout, ahead } = runFromAhead(sim, r);
  sim.cmd('stop', [scout.id]);
  const x = scout.x;
  killDead(sim, ahead.d);
  sim.step(3);
  assert.ok(Math.abs(scout.x - x) < 0.3, `it stays stopped: ${(scout.x - x).toFixed(2)}`);
  assert.equal(scout.order, 'idle');
});

// Walkers rooted at (x, z) with 5 HP each: a mortar shell or an artillery shell kills them all at once.
function frail(sim, x, z, n) {
  return crowd(sim, x, z, n).ds.map((d) => { d.hp = 5; return d; });
}

test('kills by a mortar shell go to the team that fired it, and promote it; a battery\'s go on its tally', () => {
  {
    const sim = quiet(), r = homeRow(sim);
    const mortar = spawnUnit(sim, 'mortar', r.x, r.z);
    const ds = frail(sim, r.x + 8, r.z, 12);
    const promoted = [];
    for (let h = 0; h < 2 && ds.some((d) => !d.gone); h += 0.05) {
      sim.step(0.05);
      promoted.push(...sim.drainEvents().filter((e) => e.type === 'promoted'));
    }
    assert.ok(ds.every((d) => d.gone), 'one shell killed them all');
    assert.equal(mortar.kills, 12);
    assert.equal(mortar.vet, 1, 'a Veteran after 10 kills');
    assert.deepEqual(promoted.map((e) => [e.id, e.vet]), [[mortar.id, 1]]);
  }
  {
    const sim = quiet(), r = homeRow(sim);
    const art = makeBuilding(sim, 'artillery', Math.floor(r.x), Math.floor(r.z) - 1, { instant: true });
    const ds = frail(sim, art.x + 10, art.z, 6);
    for (let h = 0; h < 3 && ds.some((d) => !d.gone); h += 0.05) sim.step(0.05);
    assert.ok(ds.every((d) => d.gone));
    assert.equal(art.kills, 6, 'the battery\'s Kills');
  }
});

test('a mortar team drops its target as soon as the crowd it shelled is gone', () => {
  const sim = quiet(), r = homeRow(sim);
  const mortar = spawnUnit(sim, 'mortar', r.x, r.z);
  const c = crowd(sim, r.x + 8, r.z);
  assert.ok(shells(sim, 0.5, c.hold) > 0 && mortar.target, 'shelling the crowd');
  assert.equal(squadStatus(mortar), 'Fighting');
  for (const d of c.ds) killDead(sim, d);
  sim.step(0.05);
  assert.deepEqual([mortar.target, mortar.attack], [0, false]);
  assert.notEqual(squadStatus(mortar), 'Fighting');
});

test('the first of each new unit trained brings up its Field Manual lesson, once', () => {
  const sim = quiet(), s = sim.state;
  Object.assign(s.res, { funds: 1e4, manpower: 1e4, food: 1e4 });
  s.research.done.push('k2');
  const p = openSpot(sim);
  const bar = makeBuilding(sim, 'barracks', Math.floor(p.x), Math.floor(p.z), { instant: true });
  for (const t of ['infantry', 'mg', 'mortar', 'medic', 'scout']) assert.equal(sim.cmd('train', bar.id, t).ok, true, t);
  const lessons = [];
  for (let h = 0; h < 40; h += 0.5) {
    if (h === 10) assert.equal(sim.cmd('train', bar.id, 'mg').ok, true, 'a second MG team');
    sim.step(0.5);
    lessons.push(...sim.drainEvents().filter((e) => e.type === 'lesson').map((e) => e.key));
  }
  assert.equal(s.ents.units.filter((u) => u.type === 'mg').length, 2, 'both MG teams trained');
  assert.deepEqual(lessons.filter((k) => UNITS[k]), ['mg', 'mortar', 'medic', 'scout']);
  for (const k of ['mg', 'mortar', 'medic', 'scout']) assert.ok(LESSONS[k] && MANUAL_ORDER.includes(k), `${k} is in the Field Manual`);
});
