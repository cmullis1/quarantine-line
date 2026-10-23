// Structures: construction, training, armed defences, artillery, lures, minefields, airstrikes.
import { COMBAT } from '../../config/balance.js';
import { BUILDINGS, WEAPONS } from '../../config/buildings.js';
import { UNITS } from '../../config/units.js';
import { ACTIONS } from '../../config/actions.js';
import { SPECIALTIES } from '../../config/world.js';
import { removeBuilding, spawnUnit } from '../entities.js';
import { LESSONS } from '../../config/lessons.js';
import { findTarget, fire, effectiveRange, explode, crowdTarget, lobShell, credit } from './combat.js';
import { makeNoise } from './dead.js';

function engineersNear(sim, b) {
  for (const u of sim.state.ents.units) if (UNITS[u.type].engineer && Math.hypot(u.x - b.x, u.z - b.z) < COMBAT.engineerRadius + b.size / 2) return true;
  return false;
}

export function trainSpeed(sim, b) {
  let m = sim.hasLaw('mobilisation') ? 1 / 0.7 : 1;
  for (const t of sim.state.towns) {
    if (t.status !== 'ok') continue;
    const info = sim.map.towns[t.id], spec = SPECIALTIES[info.specialty];
    if (spec.trainBonus && Math.hypot(info.x - b.x, info.z - b.z) < spec.radius) m *= 1 + spec.trainBonus;
  }
  return m;
}

function exitPoint(sim, b) {
  const tries = [[b.x, b.z + b.size / 2 + 0.6], [b.x + b.size / 2 + 0.6, b.z], [b.x, b.z - b.size / 2 - 0.6], [b.x - b.size / 2 - 0.6, b.z]];
  for (const [x, z] of tries) if (sim.nav.unitPass(Math.floor(z) * sim.N + Math.floor(x))) return [x, z];
  const p = sim.nav.nearestPassable(Math.floor(b.x), Math.floor(b.z));
  return p ? [p[0] + 0.5, p[1] + 0.5] : [b.x, b.z];
}

export function buildingSystem(sim, dt) {
  const s = sim.state;
  for (const b of [...s.ents.buildings]) {
    if (b.gone) continue;
    if (b.hp <= 0) { removeBuilding(sim, b, true); continue; }
    const def = BUILDINGS[b.type];
    if (!b.built) {
      b.progress += (dt / def.build) * (engineersNear(sim, b) ? COMBAT.engineerBuildMult : 1);
      if (b.progress >= 1) {
        b.built = true;
        b.progress = 1;
        sim.emit('built', { id: b.id, btype: b.type });
        if (!def.wall) sim.alert('built', `${def.name} complete.`, b.x, b.z, 'good');
      }
      continue;
    }

    if (b.queue.length) {
      b.trainT += dt * trainSpeed(sim, b);
      const type = b.queue[0];
      if (b.trainT >= UNITS[type].train) {
        b.trainT = 0;
        b.queue.shift();
        const [x, z] = exitPoint(sim, b);
        const u = spawnUnit(sim, type, x, z);
        if (b.rally) {
          const path = u.air ? [b.rally] : sim.nav.path(u.x, u.z, b.rally[0], b.rally[1]);
          if (path) { u.path = path; u.order = 'move'; }
        }
        sim.alert('trained', `${UNITS[type].name} ready.`, u.x, u.z, 'good');
        // The new units (machine guns, mortars, medics, scouts) each have a Field Manual lesson for the first one.
        if (LESSONS[type]) sim.lesson(type);
      }
    }

    if (def.weapon === 'artillery') {
      const W = WEAPONS.artillery;
      b.cd -= dt;
      if (b.cd <= 0) {
        const t = crowdTarget(sim, b.x, b.z, W);
        b.cd = t && lobShell(sim, b.x, b.z, 'artillery', t, b.id) ? W.rof : 0.5;
      }
    } else if (def.weapon) {
      b.cd -= dt;
      b.scan -= dt;
      const range = effectiveRange(sim, def.weapon, b.x, b.z);
      if (b.scan <= 0) { b.scan = 0.3; const t = findTarget(sim, b.x, b.z, range); b.target = t ? t.id : 0; }
      const t = b.target ? sim.byId(b.target) : null;
      if (t && !t.gone && b.cd <= 0) {
        b.cd = WEAPONS[def.weapon].rof * sim.range(0.85, 1.15);
        const y = b.type === 'tower' ? 1.75 : b.type === 'hq' ? 1.1 : 0.6;
        const r = fire(sim, { x: b.x, z: b.z, y }, def.weapon, t, { shooter: b.id });
        if (typeof r === 'number') b.kills += r;
      }
    }

    if (b.type === 'lure' && b.on) {
      b.timer += dt;
      if (b.timer >= def.period) {
        b.timer = 0;
        makeNoise(sim, b.x, b.z, def.noise);
        sim.emit('siren', { id: b.id, x: b.x, z: b.z, r: def.noise });
      }
    }

    if (def.mine) {
      let hit = false;
      sim.deadHash.query(b.x, b.z, 0.6, () => { hit = true; });
      if (hit) {
        removeBuilding(sim, b, false);
        explode(sim, b.x, b.z, def.mine.radius, def.mine.dmg, { friendly: 0.3, noise: 10, kind: 'mine' });
      }
    }
  }

  // Shells in flight, from batteries and mortar teams: each bursts as its weapon does, a team's harder by its rank,
  // and its kills go to whoever fired it. (A shell saved before mortars existed names no weapon, shooter or rank; it
  // was an artillery shell.)
  for (let n = s.ents.shells.length - 1; n >= 0; n--) {
    const sh = s.ents.shells[n];
    sh.t += dt;
    if (sh.t >= sh.flight) {
      const w = sh.w ?? 'artillery', W = WEAPONS[w];
      const dmg = W.dmg * COMBAT.vetBonus[sh.vet || 0];
      const kills = explode(sim, sh.x, sh.z, W.radius, dmg, { friendly: 0.5, noise: W.noise, kind: w === 'mortar' ? 'mortar' : 'shell' });
      credit(sim, sh.by, kills);
      s.ents.shells.splice(n, 1);
    }
  }

  // Airstrikes
  const A = ACTIONS.airstrike;
  for (let n = s.ents.strikes.length - 1; n >= 0; n--) {
    const st = s.ents.strikes[n];
    st.t -= dt;
    if (st.t <= 0) {
      explode(sim, st.x, st.z, A.radius, A.dmg, { friendly: 1, structDmg: A.structDmg, noise: A.noise, kind: 'napalm' });
      s.ents.strikes.splice(n, 1);
    }
  }
}
