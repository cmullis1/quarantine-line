// Units: orders, movement, fighting, healing, engineering. Vehicles: evacuation buses.
import { COMBAT } from '../../config/balance.js';
import { UNITS } from '../../config/units.js';
import { BUILDINGS, WEAPONS } from '../../config/buildings.js';
import { removeUnit, removeVehicle, spawnDead } from '../entities.js';
import { angleTo, hyp, turnToward } from '../../util.js';
import { findTarget, fire, effectiveRange, crowdTarget, lobShell, promote } from './combat.js';

const ROAD_SPEED = 1.35;

function speedAt(sim, x, z, base) {
  const k = Math.floor(z) * sim.N + Math.floor(x);
  return base * (sim.map.road[k] ? ROAD_SPEED : 1);
}

// Is `t` within the `arc` degrees centred on the unit's facing?
function inArc(u, arc, t) {
  const d = angleTo(t.x - u.x, t.z - u.z) - u.rot;
  return Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) <= (arc * Math.PI) / 360;
}

// How far (up to `len` tiles, in half-tile steps) a unit at (x, z) can go along the unit vector (dx, dz) before
// ground it cannot cross.
function openRun(sim, x, z, dx, dz, len) {
  let r = 0;
  for (let t = 0.5; t <= len + 1e-9; t += 0.5) {
    const i = Math.floor(x + dx * t), j = Math.floor(z + dz * t);
    if (!sim.nav.inside(i, j) || !sim.nav.unitPass(j * sim.N + i)) break;
    r = t;
  }
  return r;
}

// A unit that evades (the scout): with any of the dead within E.radius (risen ones) it drives E.run tiles straight
// away from the nearest, as far as open ground goes; where that is blocked within 2 tiles, toward the HQ instead.
// A run that breaks off a move order remembers where it was going (`u.resume`), and once the run is over and no
// dead are within E.radius it sets off there again. Any order the player gives replaces that (commands.js).
function evade(sim, u, E) {
  let near = null, nd = Infinity;
  sim.deadHash.query(u.x, u.z, E.radius, (d, d2) => { if (!d.gone && !(d.rise > 0) && d2 < nd) { nd = d2; near = d; } });
  if (!near) {
    if (u.resume && !u.path) {
      const to = u.resume.to;
      u.resume = null;
      const path = to && sim.nav.path(u.x, u.z, to[0], to[1]);
      if (path) { u.path = path; u.order = 'move'; }
    }
    return;
  }
  const hq = sim.state.ents.buildings.find((b) => b.type === 'hq');
  const ways = [[u.x - near.x, u.z - near.z]];
  if (hq) ways.push([hq.x - u.x, hq.z - u.z]);
  for (const [wx, wz] of ways) {
    const len = hyp(wx, wz);
    if (len < 1e-6) continue;
    const dx = wx / len, dz = wz / len, r = openRun(sim, u.x, u.z, dx, dz, E.run);
    if (r < 2) continue;
    const path = sim.nav.path(u.x, u.z, u.x + dx * r, u.z + dz * r);
    if (path) {
      // The first run off a move order keeps its destination; a run off a run keeps the one already kept.
      if (!u.resume) u.resume = { to: u.order === 'move' && u.path?.length ? [...u.path[u.path.length - 1]] : null };
      u.path = path; u.order = 'move';
      return;
    }
  }
}

export function unitSystem(sim, dt) {
  const s = sim.state;
  // Living medic teams, gathered once a tick rather than for every wounded squad.
  const medics = s.ents.units.filter((m) => UNITS[m.type].heal && !m.gone && m.hp > 0);
  for (const u of [...s.ents.units]) {
    if (u.gone) continue;
    if (u.hp <= 0) { removeUnit(sim, u, true); continue; }
    const def = UNITS[u.type], w = def.weapon, W = WEAPONS[w];

    // Movement
    u.moving = false;
    let target = u.target ? sim.byId(u.target) : null;
    if (target && (target.gone || target.hp <= 0)) target = null;
    // A unit that fires only from a standstill (set-up weapons, indirect fire) is not halted by a fight on an
    // attack-move: it goes where it was sent.
    const engaged = target && u.order === 'amove' && !def.setup && !W.flight;
    if (u.path && u.path.length && u.order !== 'hold' && !engaged) {
      const [tx, tz] = u.path[0];
      const dx = tx - u.x, dz = tz - u.z, d = hyp(dx, dz);
      const step = (u.air ? def.speed : speedAt(sim, u.x, u.z, def.speed)) * dt;
      if (d <= step) { u.x = tx; u.z = tz; u.path.shift(); }
      else { u.x += (dx / d) * step; u.z += (dz / d) * step; }
      if (d > 0.01) {
        const a = angleTo(dx, dz);
        u.rot = turnToward(u.rot, a, 8 * dt);
        if (def.setup) u.face = a;
      }
      u.moving = true;
      if (!u.path.length) { u.path = null; if (u.order !== 'hold') u.order = 'idle'; }
    }
    // Squads nudge apart so they don't stack.
    if (!u.air) {
      sim.liveHash.query(u.x, u.z, 0.75, (o, d2) => {
        if (o === u || !o.type || o.air || d2 < 1e-6) return;
        const d = Math.sqrt(d2), push = (0.75 - d) * dt * 2;
        const nx = u.x + ((u.x - o.x) / d) * push, nz = u.z + ((u.z - o.z) / d) * push;
        if (sim.nav.unitPass(Math.floor(nz) * sim.N + Math.floor(nx))) { u.x = nx; u.z = nz; }
      });
    }

    // Set-up weapons dig in for `def.setup` hours once stopped, turning to face the way they were sent.
    // Any move starts it over.
    if (def.setup) {
      if (u.moving) u.setup = 0;
      else if (u.setup < def.setup) {
        u.setup = Math.min(def.setup, u.setup + dt);
        u.rot = turnToward(u.rot, u.face, 8 * dt);
      }
    }
    const ready = !def.setup || u.setup >= def.setup;
    const arcOk = def.arc ? (d) => inArc(u, def.arc, d) : null;

    // Combat
    u.cd -= dt;
    if (W.flight) {
      // Indirect fire, only from a standstill: a shell into the thickest crowd in sight, as artillery aims. The crowd
      // it last shelled stays its target (it is "Fighting") until it moves or that one of the dead is gone.
      if (u.moving || !target) { u.target = 0; u.attack = false; }
      if (!u.moving && u.cd <= 0) {
        const t = crowdTarget(sim, u.x, u.z, W);
        const shot = !!t && lobShell(sim, u.x, u.z, w, t, u.id, u.vet);
        u.cd = shot ? W.rof : 0.5;
        u.target = shot ? t.id : 0;
        u.attack = shot;
        if (shot) u.rot = turnToward(u.rot, angleTo(t.x - u.x, t.z - u.z), 6);
      }
    } else {
      u.scan -= dt;
      const range = effectiveRange(sim, w, u.x, u.z);
      if (u.scan <= 0) {
        u.scan = 0.25;
        if (def.evade && u.order !== 'amove' && u.order !== 'hold') evade(sim, u, def.evade);
        const t = ready ? findTarget(sim, u.x, u.z, range, w === 'sniper' ? 'howler' : null, arcOk) : null;
        u.target = t ? t.id : 0;
        target = t;
      }
      if (target && (!ready || hyp(target.x - u.x, target.z - u.z) > range + 0.4 || (arcOk && !arcOk(target)))) {
        target = null; u.target = 0;
      }
      u.attack = !!target;
      if (target && u.cd <= 0) {
        u.cd = W.rof * sim.range(0.85, 1.15) * (u.moving ? 1.4 : 1);
        const from = { x: u.x, z: u.z, y: u.air ? u.alt - 0.2 : 0.42 };
        const r = fire(sim, from, w, target, { vet: u.vet, shooter: u.id });
        if (typeof r === 'number' && r > 0) { u.kills += r; promote(sim, u); }
        // A team with a firing arc keeps the facing it set up with.
        if (!u.moving && !def.arc) u.rot = turnToward(u.rot, angleTo(target.x - u.x, target.z - u.z), 6);
      }
    }

    // Healing at depots, hospitals, (for gunships) helipads and (for squads, not vehicles) beside a medic team,
    // which patches itself up too. The best source counts; they do not add up.
    if (u.hp < u.maxHp) {
      let heal = 0;
      for (const b of s.ents.buildings) {
        if (!b.built) continue;
        const d = hyp(b.x - u.x, b.z - u.z);
        if (b.type === 'depot' && d < BUILDINGS.depot.radius) heal = Math.max(heal, COMBAT.healDepot);
        if (b.type === 'hospital' && d < 5) heal = Math.max(heal, COMBAT.healHospital);
        if (b.type === 'helipad' && u.air && d < 3) heal = Math.max(heal, COMBAT.healHospital);
      }
      if (def.figs) {
        for (const m of medics) {
          const aura = UNITS[m.type].heal;
          if (hyp(m.x - u.x, m.z - u.z) <= aura.radius) heal = Math.max(heal, aura.rate);
        }
      }
      u.hp = Math.min(u.maxHp, u.hp + heal * dt);
    }

    // Engineers repair what's around them when they are not walking.
    if (def.engineer && !u.moving) {
      let best = null, bd = 3.2;
      for (const b of s.ents.buildings) {
        if (!b.built || b.hp >= b.maxHp) continue;
        const d = hyp(b.x - u.x, b.z - u.z) - b.size / 2;
        if (d < bd) { bd = d; best = b; }
      }
      if (best && s.res.funds > 0) {
        const amt = Math.min(best.maxHp - best.hp, COMBAT.repairRate * dt);
        best.hp += amt;
        s.res.funds -= amt * 0.02;
        u.repairing = best.id;
      } else u.repairing = 0;
    }
  }
}

export function vehicleSystem(sim, dt) {
  const s = sim.state;
  for (const v of [...s.ents.vehicles]) {
    if (v.gone) continue;
    if (v.hp <= 0) {
      s.stats.deadPeople += v.pax;
      sim.alert('busLost', 'An evacuation bus was overrun.', v.x, v.z, 'bad');
      const n = 2 + Math.floor(sim.rand() * 3);
      for (let k = 0; k < n; k++) spawnDead(sim, 'walker', v.x + sim.range(-0.5, 0.5), v.z + sim.range(-0.5, 0.5), { rise: true });
      removeVehicle(sim, v, true);
      continue;
    }
    const dest = s.towns[v.to];
    if (dest.status !== 'ok') {
      const alt = s.towns.find((t) => t.status === 'ok' && sim.map.towns[t.id].capital) || s.towns.find((t) => t.status === 'ok');
      if (!alt) { removeVehicle(sim, v, false); continue; }
      v.to = alt.id;
      const info = sim.map.towns[alt.id];
      v.path = sim.nav.roadPath(v.x, v.z, info.x, info.z) || sim.nav.path(v.x, v.z, info.x, info.z) || [];
    }
    v.moving = false;
    if (v.path && v.path.length) {
      const [tx, tz] = v.path[0];
      const dx = tx - v.x, dz = tz - v.z, d = hyp(dx, dz);
      const step = speedAt(sim, v.x, v.z, 4) * dt;
      if (d <= step) { v.x = tx; v.z = tz; v.path.shift(); } else { v.x += (dx / d) * step; v.z += (dz / d) * step; }
      if (d > 0.01) v.rot = turnToward(v.rot, angleTo(dx, dz), 6 * dt);
      v.moving = true;
    } else {
      const t = s.towns[v.to];
      t.pop += v.pax;
      t.infected += v.infected;
      s.stats.evacuated += v.pax;
      removeVehicle(sim, v, false);
    }
  }
}
