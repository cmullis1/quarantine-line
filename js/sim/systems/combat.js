// Shooting: shared by units and armed structures. Ammo, noise, night, melee fallback, veterancy.
import { COMBAT, WEATHER } from '../../config/balance.js';
import { WEAPONS, BUILDINGS } from '../../config/buildings.js';
import { UNITS } from '../../config/units.js';
import { killDead } from '../entities.js';
import { makeNoise } from './dead.js';
import { hyp } from '../../util.js';

export function promote(sim, u) {
  const [v1, v2] = COMBAT.vetKills;
  const vet = u.kills >= v2 ? 2 : u.kills >= v1 ? 1 : 0;
  if (vet > u.vet) {
    u.vet = vet;
    sim.emit('promoted', { id: u.id, vet });
    sim.alert('promoted', `${UNITS[u.type].name} promoted to ${vet === 2 ? 'Elite' : 'Veteran'}.`, u.x, u.z, 'good');
  }
}

// Kills go to whoever fired: a squad or vehicle counts them toward promotion, a structure on its own tally. A
// shooter gone by the time its shell lands gets nothing.
export function credit(sim, id, kills) {
  const e = kills > 0 && id ? sim.byId(id) : null;
  if (!e || e.gone) return;
  e.kills = (e.kills || 0) + kills;
  if (e.vet !== undefined) promote(sim, e);
}

export function litAt(sim, x, z) {
  for (const b of sim.state.ents.buildings) if (b.type === 'floodlight' && b.built && hyp(b.x - x, b.z - z) < BUILDINGS.floodlight.radius) return true;
  return false;
}

export function effectiveRange(sim, w, x, z) {
  let r = WEAPONS[w].range;
  if (sim.night && !litAt(sim, x, z)) r *= COMBAT.nightRange;
  const wx = sim.weather;
  if (wx.fog) r *= WEATHER.fogRange;
  else if (wx.rain) r *= WEATHER.rainRange;
  return r;
}

function depotNear(sim, x, z) {
  for (const b of sim.state.ents.buildings) if (b.type === 'depot' && b.built && hyp(b.x - x, b.z - z) < BUILDINGS.depot.radius) return true;
  return false;
}

// Pick a visible target in range. Snipers prefer howlers, then brutes. `accept` narrows the choice (a firing arc).
export function findTarget(sim, x, z, range, priority, accept = null) {
  let best = null, score = Infinity;
  sim.deadHash.query(x, z, range, (d, d2) => {
    if (d.gone || d.rise > 0 || !sim.visible(d.x, d.z) || (accept && !accept(d))) return;
    let sc = d2;
    if (priority === 'howler') sc -= d.type === 'howler' ? 1e4 : d.type === 'brute' ? 5e3 : 0;
    if (sc < score) { score = sc; best = d; }
  });
  return best;
}

// Indirect fire (artillery, mortars) aims at the thickest visible crowd of the dead within W.range of (x, z) and
// beyond W.minRange: the one with the most of the dead within W.radius of it, if that is at least 3.
export function crowdTarget(sim, x, z, W) {
  let best = null, bc = 0, n = 0;
  sim.deadHash.query(x, z, W.range, (d) => {
    if (n++ > 60 || d.gone || !sim.visible(d.x, d.z)) return;
    if (hyp(d.x - x, d.z - z) < W.minRange) return;
    let c = 0;
    sim.deadHash.query(d.x, d.z, W.radius, () => { c++; });
    if (c > bc) { bc = c; best = d; }
  });
  return bc >= 3 ? best : null;
}

// Lobs a shell of weapon `w` from (x, z) at `t`'s spot; it lands `flight` hours later with that weapon's damage and
// burst (buildingSystem), its kills credited to `by` (the battery's or the team's id) and its damage raised by the
// rank `vet` of a team that fired it, as a rifle's is (a battery has none). Returns false, firing nothing, when the
// ammunition for it is short.
export function lobShell(sim, x, z, w, t, by, vet = 0) {
  const s = sim.state, W = WEAPONS[w];
  if (s.res.ammo < W.ammo) return false;
  s.res.ammo -= W.ammo;
  s.stats.ammoSpent += W.ammo;
  s.ents.shells.push({ id: sim.newId(), w, by, vet, x0: x, z0: z, x: t.x, z: t.z, t: 0, flight: W.flight });
  makeNoise(sim, x, z, W.noise);
  sim.emit('artillery', { x, z, tx: t.x, tz: t.z, flight: W.flight, w });
  return true;
}

// Returns true if a shot (or blow) was made.
export function fire(sim, from, w, target, { vet = 0, shooter = null } = {}) {
  const s = sim.state, W = WEAPONS[w];
  let dmg = W.dmg * COMBAT.vetBonus[vet] * (sim.hasTech('k1') ? 1.3 : 1);
  const dist = hyp(target.x - from.x, target.z - from.z);
  let melee = !!W.melee;
  if (!melee && W.ammo > 0) {
    let cost = W.ammo * (sim.hasTech('k2') ? 0.75 : 1);
    if (depotNear(sim, from.x, from.z)) cost *= COMBAT.depotAmmo;
    if (s.res.ammo >= cost) {
      s.res.ammo -= cost;
      s.stats.ammoSpent += cost;
    } else {
      // Out of ammunition: close-quarters only.
      const reach = sim.hasTech('k2') ? COMBAT.fieldDoctrineRange : COMBAT.meleeRange;
      if (dist > reach) return false;
      melee = true;
      dmg *= sim.hasTech('k2') ? COMBAT.fieldDoctrineMelee : COMBAT.meleeFraction;
    }
  }
  if (melee && dist > Math.max(W.range, COMBAT.meleeRange) + 0.2) return false;
  const hit = sim.chance(COMBAT.hitChance + (melee ? 0.1 : 0));
  sim.emit('shot', {
    sx: from.x, sy: from.y ?? 0.42, sz: from.z, tx: target.x, ty: 0.42 + (target.y || 0), tz: target.z,
    w: melee ? 'melee' : w, hit, shooter,
  });
  if (!melee) makeNoise(sim, from.x, from.z, W.noise);
  if (!hit) return true;
  const victims = W.area ? [] : [target];
  if (W.area) sim.deadHash.query(target.x, target.z, W.area, (d) => { if (!d.gone) victims.push(d); });
  let kills = 0;
  for (const v of victims) {
    v.hp -= dmg;
    if (v.hp <= 0 && !v.gone) { killDead(sim, v, w === 'flamer' ? 'fire' : 'shot'); kills++; }
  }
  return kills || true;
}

// Returns how many of the dead it killed.
export function explode(sim, x, z, radius, dmg, { friendly = 0.5, structDmg = 0, noise = 0, kind = 'shell' } = {}) {
  const s = sim.state;
  let kills = 0;
  sim.deadHash.query(x, z, radius, (d, d2) => {
    if (d.gone) return;
    d.hp -= dmg * (1 - Math.sqrt(d2) / (radius * 1.5));
    if (d.hp <= 0) { killDead(sim, d, kind === 'napalm' ? 'fire' : 'blast'); kills++; }
  });
  if (friendly) for (const u of s.ents.units) {
    const dd = hyp(u.x - x, u.z - z);
    if (dd < radius && !u.air) u.hp -= dmg * friendly * (1 - dd / (radius * 1.5));
  }
  if (friendly) for (const r of s.ents.refugees) if (hyp(r.x - x, r.z - z) < radius) r.hp = 0;
  if (structDmg) for (const b of s.ents.buildings) if (hyp(b.x - x, b.z - z) < radius + b.size / 2) b.hp -= structDmg;
  if (noise) makeNoise(sim, x, z, noise);
  sim.emit('explode', { x, z, r: radius, kind });
  return kills;
}
