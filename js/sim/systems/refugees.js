// Refugees walk from fallen neighbours to the border crossings. What happens there is the border policy.
import { REFUGEES, COMBAT } from '../../config/balance.js';
import { BUILDINGS } from '../../config/buildings.js';
import { spawnDead, removeRefugee } from '../entities.js';
import { hitTrust, changeTrust, changeOrder } from './economy.js';

function walk(r, tx, tz, dt, speed = r.speed) {
  const dx = tx - r.x, dz = tz - r.z, d = Math.hypot(dx, dz);
  const step = speed * dt;
  r.moving = true;
  if (d > 0.01) r.rot = Math.atan2(dx, dz);
  if (d <= step) { r.x = tx; r.z = tz; return true; }
  r.x += (dx / d) * step; r.z += (dz / d) * step;
  return false;
}

function followPath(r, dt) {
  if (!r.path || !r.path.length) return true;
  if (walk(r, r.path[0][0], r.path[0][1], dt)) r.path.shift();
  return !r.path.length;
}

function turn(sim, r) {
  removeRefugee(sim, r);
  sim.state.stats.refugeesTurned++;
  spawnDead(sim, 'walker', r.x, r.z, { rise: true });
  sim.emit('turn', { x: r.x, z: r.z });
}

function campFor(sim, cross) {
  const s = sim.state;
  const cap = REFUGEES.campCapacity * (sim.hasTech('c3') ? 2 : 1);
  let best = null, bd = Infinity;
  for (const b of s.ents.buildings) {
    if (b.type !== 'camp' || !b.built) continue;
    const d = Math.hypot(b.x - cross.x, b.z - cross.z);
    if (d > BUILDINGS.camp.radius || d >= bd) continue;
    const used = s.ents.refugees.filter((r) => r.camp === b.id || r.campBound === b.id).length;
    if (used >= cap) continue;
    bd = d; best = b;
  }
  return best;
}

export function nearestTownFor(sim, x, z) {
  const s = sim.state;
  let best = null, bd = Infinity;
  for (const t of s.towns) {
    if (t.status !== 'ok') continue;
    const info = sim.map.towns[t.id];
    const d = Math.hypot(info.x - x, info.z - z) * (t.quarantine || t.sacrifice ? 3 : 1);
    if (d < bd) { bd = d; best = info; }
  }
  return best;
}

function admit(sim, r) {
  const cross = sim.map.crossings[r.crossId];
  const camp = campFor(sim, cross);
  if (camp) {
    const p = sim.nav.path(r.x, r.z, camp.x + sim.range(-0.8, 0.8), camp.z + sim.range(-0.8, 0.8));
    if (p) { r.mode = 'toCamp'; r.path = p; r.campBound = camp.id; return; }
  }
  const town = nearestTownFor(sim, cross.x, cross.z);
  if (!town) { r.mode = 'leaving'; return; }
  const p = sim.nav.path(r.x, r.z, town.x + sim.range(-1, 1), town.z + sim.range(-1, 1));
  if (!p) { r.mode = 'waiting'; r.blocked = true; return; }
  r.mode = 'entering'; r.path = p; r.townId = town.id;
}

function absorb(sim, r) {
  const s = sim.state, t = s.towns[r.townId];
  if (!t || t.status !== 'ok') { admitInland(sim, r); return; }
  t.pop += REFUGEES.groupSize;
  s.res.manpower += REFUGEES.manpowerPerGroup * (sim.hasLaw('labour') ? 4 : 1);
  if (sim.hasLaw('labour')) s.res.food += 2;
  if (r.infected) t.infected += REFUGEES.infectedSeed;
  changeTrust(sim, REFUGEES.openTrustPerGroup, 'refugees welcomed');
  s.stats.admitted++;
  if (r.vip) changeTrust(sim, 1.6, 'families rescued');
  removeRefugee(sim, r);
}

function admitInland(sim, r) {
  const town = nearestTownFor(sim, r.x, r.z);
  if (!town) { removeRefugee(sim, r); return; }
  r.townId = town.id;
  r.path = sim.nav.path(r.x, r.z, town.x, town.z) || [];
  r.mode = 'entering';
}

// A group that waited at the border and was never let in walks away. The public counts these, whatever
// kept them out: a closed border, a wall across the road, or screening with no checkpoint built.
function giveUp(sim, r) {
  r.mode = 'leaving';
  sim.state.stats.turnedAway++;
  hitTrust(sim, REFUGEES.turnAwayTrust, 'refugees turned away');
}

function shooter(sim, cross) {
  const s = sim.state;
  for (const u of s.ents.units) if (!u.air && Math.hypot(u.x - cross.x, u.z - cross.z) < 7 && u.type !== 'police') return { x: u.x, z: u.z, y: 0.42 };
  for (const b of s.ents.buildings) if (b.built && BUILDINGS[b.type].weapon && BUILDINGS[b.type].weapon !== 'artillery' && Math.hypot(b.x - cross.x, b.z - cross.z) < 7) return { x: b.x, z: b.z, y: 1.6 };
  return null;
}

export function refugeeSystem(sim, dt) {
  const s = sim.state;
  const detect = sim.hasTech('m1') ? REFUGEES.screenDetectResearch : REFUGEES.screenDetect;
  const screenTime = REFUGEES.screenHours / ((sim.hasTech('m1') ? 1.5 : 1) * (sim.hasLaw('security') ? 1.5 : 1));
  const queues = new Map();
  for (const r of [...s.ents.refugees]) {
    if (r.gone) continue;
    if (r.hp <= 0) { turn(sim, r); continue; }
    if (r.infected) {
      r.incub -= dt;
      if (r.incub <= 0) {
        if (r.camp) {
          // Turning inside a camp: some of the others are bitten before the guards react.
          for (const o of s.ents.refugees) if (o.camp === r.camp && o !== r && !o.infected && sim.chance(0.2)) { o.infected = true; o.incub = sim.range(4, 10); }
          sim.alert('campTurn', 'Someone turned inside a refugee camp.', r.x, r.z, 'warn');
        }
        turn(sim, r);
        continue;
      }
    }
    r.moving = false;
    const cross = sim.map.crossings[r.crossId];
    if (r.mode === 'travel') {
      if (followPath(r, dt)) { r.mode = 'waiting'; r.wait = 0; }
    } else if (r.mode === 'waiting') {
      r.wait += dt;
      const gate = sim.buildingAt(cross.i, cross.j);
      const blockedGate = gate && gate.type !== 'checkpoint' && !BUILDINGS[gate.type].gate;
      const st = s.border;
      if (st === 'shoot') {
        const sh = shooter(sim, cross);
        if (sh && sim.chance(dt * 2)) {
          sim.emit('shot', { sx: sh.x, sy: sh.y, sz: sh.z, tx: r.x, ty: 0.4, tz: r.z, w: 'rifle', hit: true });
          s.stats.shot++;
          hitTrust(sim, REFUGEES.shootTrust / (1 + s.stats.shot / 30), 'border shootings');
          changeOrder(sim, REFUGEES.shootOrder, 'border shootings');
          removeRefugee(sim, r);
          sim.emit('death', { kind: 'refugee', id: r.id, x: r.x, z: r.z, look: r.look });
          if (r.infected && !sim.hasLaw('mercy') && sim.chance(COMBAT.riseChance)) spawnDead(sim, 'walker', r.x, r.z, { rise: true });
          sim.lesson('shoot');
          continue;
        }
        if (r.wait > REFUGEES.waitClosed) giveUp(sim, r);
      } else if (blockedGate) {
        if (r.wait > REFUGEES.waitBlocked) giveUp(sim, r);
      } else if (st === 'open') {
        // A group with no route inland (walls everywhere) retries every couple of hours, not every tick.
        if (!r.retryAt || s.time >= r.retryAt) { admit(sim, r); if (r.mode === 'waiting') r.retryAt = s.time + 2; }
        if (r.mode === 'waiting' && r.wait > REFUGEES.waitBlocked) giveUp(sim, r);
      } else if (st === 'screened') {
        if (gate && gate.type === 'checkpoint' && gate.built) {
          let q = queues.get(cross.id);
          if (!q) queues.set(cross.id, (q = s.ents.refugees.filter((o) => o.crossId === cross.id && o.mode === 'waiting').sort((a, b) => a.id - b.id)));
          if (q[0] === r) {
            r.proc += dt;
            if (r.proc >= screenTime) {
              s.res.food = Math.max(0, s.res.food - REFUGEES.screenFood);
              q.shift();
              if (r.infected && sim.chance(detect)) {
                r.mode = 'leaving';
                s.stats.turnedAway++;
                sim.emit('rejected', { x: cross.x, z: cross.z });
              } else admit(sim, r);
            }
          }
        } else if (r.wait > REFUGEES.waitScreened) giveUp(sim, r);
      } else if (r.wait > REFUGEES.waitClosed) giveUp(sim, r);
      if (r.mode === 'waiting' && sim.chance(dt * 0.5)) r.rot += sim.range(-1, 1);
    } else if (r.mode === 'toCamp') {
      const camp = sim.byId(r.campBound);
      if (!camp) { admitInland(sim, r); continue; }
      if (followPath(r, dt)) { r.mode = 'camp'; r.camp = camp.id; r.campUntil = s.time + REFUGEES.campHours; sim.lesson('camp'); }
    } else if (r.mode === 'camp') {
      const camp = sim.byId(r.camp);
      if (!camp || s.time >= r.campUntil) { r.camp = 0; r.campBound = 0; admitInland(sim, r); }
    } else if (r.mode === 'entering') {
      const t = s.towns[r.townId];
      if (!t || t.status !== 'ok') { admitInland(sim, r); continue; }
      if (followPath(r, dt)) absorb(sim, r);
    } else if (r.mode === 'leaving') {
      const site = sim.map.sites[r.siteId];
      if (!r.leavingPath) { r.leavingPath = true; r.path = sim.nav.path(r.x, r.z, site.x, site.z) || [[site.x, site.z]]; }
      if (followPath(r, dt)) removeRefugee(sim, r);
    }
  }
}
