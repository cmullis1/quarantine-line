// Entity factories and removal. Entities are plain objects in `state.ents.*`.
import { BUILDINGS } from '../config/buildings.js';
import { UNITS } from '../config/units.js';
import { DEAD } from '../config/dead.js';
import { REFUGEES, COMBAT, MAX_DEAD } from '../config/balance.js';
import { changeTrust } from './systems/economy.js';

export function buildingMaxHp(sim, type) {
  const def = BUILDINGS[type];
  return def.hp * (def.wall && sim.hasTech('e4') ? 1.5 : 1);
}

export function makeBuilding(sim, type, i, j, { instant = false } = {}) {
  const def = BUILDINGS[type];
  const s = def.size;
  const b = {
    id: sim.newId(), type, i, j, size: s, x: i + s / 2, z: j + s / 2,
    hp: buildingMaxHp(sim, type), maxHp: buildingMaxHp(sim, type),
    built: instant, progress: instant ? 1 : 0,
    queue: [], trainT: 0, rally: null, cd: 0, target: 0, scan: 0, on: true, timer: 0, spillT: 0, kills: 0,
  };
  sim.state.ents.buildings.push(b);
  sim.index.set(b.id, b);
  sim.occupy(b, true);
  sim.emit('placed', { id: b.id, btype: type });
  return b;
}

export function removeBuilding(sim, b, destroyed) {
  const list = sim.state.ents.buildings;
  const k = list.indexOf(b);
  if (k < 0) return;
  list.splice(k, 1);
  sim.index.delete(b.id);
  sim.occupy(b, false);
  b.gone = true;
  sim.emit(destroyed ? 'destroyed' : 'removed', { id: b.id, btype: b.type, x: b.x, z: b.z, size: b.size });
  if (destroyed && b.type === 'hq') {
    changeTrust(sim, -20, 'HQ overrun');
    sim.alert('hq', 'National HQ has been overrun!', b.x, b.z, 'bad');
  } else if (destroyed) sim.alert('destroyed', `${BUILDINGS[b.type].name} destroyed`, b.x, b.z, 'bad');
}

export function spawnUnit(sim, type, x, z) {
  const def = UNITS[type];
  const u = {
    id: sim.newId(), type, x, z, rot: Math.PI, hp: def.hp, maxHp: def.hp, path: null, order: 'idle',
    target: 0, cd: sim.range(0, 0.4), scan: 0, kills: 0, vet: 0, air: !!def.air, alt: def.air ? 2.4 : 0,
    moving: false, fire: 0, attack: false,
  };
  // Set-up weapons: hours stood still, and the way it was last sent (it digs in facing that way).
  if (def.setup) { u.setup = 0; u.face = u.rot; }
  sim.state.ents.units.push(u);
  sim.index.set(u.id, u);
  sim.emit('unit', { id: u.id, utype: type });
  return u;
}

export function removeUnit(sim, u, killed) {
  const list = sim.state.ents.units;
  const k = list.indexOf(u);
  if (k < 0) return;
  list.splice(k, 1);
  sim.index.delete(u.id);
  u.gone = true;
  if (killed) {
    sim.state.stats.unitsLost++;
    sim.emit('death', { kind: 'unit', utype: u.type, id: u.id, x: u.x, z: u.z });
    sim.alert('unitLost', `${UNITS[u.type].name} lost`, u.x, u.z, 'bad');
    if (!sim.hasLaw('mercy')) {
      const figs = UNITS[u.type].figs || 1;
      for (let n = 0; n < figs; n++) if (sim.chance(COMBAT.riseChance * (UNITS[u.type].figs ? 1 : 0.5))) {
        spawnDead(sim, 'walker', u.x + sim.range(-0.3, 0.3), u.z + sim.range(-0.3, 0.3), { rise: true, soldier: u.type !== 'police' && u.type !== 'hazmat' });
      }
    }
  }
}

export function spawnDead(sim, type, x, z, o = {}) {
  const s = sim.state;
  if (s.ents.dead.length >= MAX_DEAD) return null;
  const def = DEAD[type];
  const z0 = {
    id: sim.newId(), type, x, z, y: 0, rot: sim.range(0, 6.28),
    hp: def.hp * sim.diff.deadHp, maxHp: def.hp * sim.diff.deadHp,
    speed: sim.range(def.speed[0], def.speed[1]), state: 'path', target: 0, scan: sim.range(0, 0.5),
    inv: null, rise: o.rise ? 1 : 0, wall: -1, stack: 0, wander: null, wanderT: 0, look: Math.floor(sim.rand() * 1e9),
    soldier: !!o.soldier, horde: o.horde || 0, cool: 0, drop: 0, moving: false,
  };
  s.ents.dead.push(z0);
  sim.index.set(z0.id, z0);
  s.stats.peakDead = Math.max(s.stats.peakDead, s.ents.dead.length);
  return z0;
}

export function killDead(sim, z, cause = 'shot') {
  if (z.gone) return;
  z.gone = true;
  z.hp = 0;
  sim.state.stats.killed++;
  sim.emit('death', { kind: 'dead', dtype: z.type, id: z.id, x: z.x, z: z.z, y: z.y, rot: z.rot, look: z.look, soldier: z.soldier, cause });
}

export function spawnRefugee(sim, siteId) {
  const site = sim.map.sites[siteId];
  const c = sim.map.crossings[site.crossingId];
  const wi = sim.state.worldInf;
  const inf = Math.min(REFUGEES.infectedCap, REFUGEES.infectedBase + wi * REFUGEES.infectedPerWorldInf) * sim.diff.refugeeInfected;
  // Waiting spot: a little outside the crossing, spread sideways.
  const px = -c.dz, pz = c.dx;
  const out = sim.range(1.2, 3.4), side = sim.range(-2, 2);
  const r = {
    id: sim.newId(), x: site.x + sim.range(-2, 2), z: site.z + sim.range(-2, 2), rot: 0, hp: 10,
    infected: sim.chance(inf), incub: sim.range(REFUGEES.incubation[0], REFUGEES.incubation[1]),
    mode: 'travel', siteId, crossId: c.id, wait: 0, proc: 0, path: null, townId: -1, camp: 0, campUntil: 0,
    speed: sim.range(0.9, 1.25), look: Math.floor(sim.rand() * 1e9), moving: false,
    gx: c.oi + 0.5 + c.dx * out + px * side, gz: c.oj + 0.5 + c.dz * out + pz * side,
  };
  r.path = sim.nav.path(r.x, r.z, r.gx, r.gz) || [[r.gx, r.gz]];
  sim.state.ents.refugees.push(r);
  sim.index.set(r.id, r);
  return r;
}

export function removeRefugee(sim, r) {
  const list = sim.state.ents.refugees;
  const k = list.indexOf(r);
  if (k >= 0) { list[k] = list[list.length - 1]; list.pop(); }
  sim.index.delete(r.id);
  r.gone = true;
}

export function spawnBus(sim, fromTown, toTown, pax, infected) {
  const a = sim.map.towns[fromTown], b = sim.map.towns[toTown];
  const v = {
    id: sim.newId(), kind: 'bus', x: a.x + sim.range(-1, 1), z: a.z + sim.range(-1, 1), rot: 0, hp: 80, maxHp: 80,
    from: fromTown, to: toTown, pax, infected, path: null, moving: true,
  };
  v.path = sim.nav.roadPath(v.x, v.z, b.x, b.z) || sim.nav.path(v.x, v.z, b.x, b.z) || [];
  sim.state.ents.vehicles.push(v);
  sim.index.set(v.id, v);
  sim.emit('vehicle', { id: v.id, kind: 'bus' });
  return v;
}

export function removeVehicle(sim, v, destroyed) {
  const list = sim.state.ents.vehicles;
  const k = list.indexOf(v);
  if (k >= 0) list.splice(k, 1);
  sim.index.delete(v.id);
  v.gone = true;
  if (destroyed) sim.emit('death', { kind: 'bus', id: v.id, x: v.x, z: v.z });
}
