// The dead: follow the flow field to living towns, chase the living they notice, investigate noise,
// claw at structures, pile up against walls until they spill over.
import { COMBAT, NOISE, PILEUP, SPREAD, WEATHER } from '../../config/balance.js';
import { DEAD } from '../../config/dead.js';
import { BUILDINGS } from '../../config/buildings.js';
import { UNITS } from '../../config/units.js';
import { TER } from '../../config/world.js';
import { angleTo, turnToward } from '../../util.js';

// Noise is collected during a tick and resolved here; nearby sources merge.
export function makeNoise(sim, x, z, r) {
  if (r <= 0) return;
  if (sim.weather.rain) r *= WEATHER.rainNoise;
  const list = sim.state.noises;
  for (const n of list) if (Math.abs(n.x - x) < 2 && Math.abs(n.z - z) < 2) { n.r = Math.max(n.r, r); return; }
  list.push({ x, z, r });
  if (r >= 8) sim.emit('noise', { x, z, r });
}

function resolveNoise(sim) {
  const list = sim.state.noises;
  if (!list.length) return;
  const s = sim.state;
  for (const n of list) {
    sim.deadHash.query(n.x, n.z, n.r, (z) => {
      if (z.state === 'chase' || z.state === 'attack' || z.gone) return;
      if (z.inv && z.inv.until > s.time && Math.hypot(z.inv.x - z.x, z.inv.z - z.z) < Math.hypot(n.x - z.x, n.z - z.z)) return;
      z.inv = { x: n.x + sim.range(-1, 1), z: n.z + sim.range(-1, 1), until: s.time + NOISE.investigateHours };
    });
  }
  list.length = 0;
}

function aggroRange(sim, target) {
  let r = COMBAT.deadAggro * (sim.night ? COMBAT.nightAggro : 1);
  if (sim.hasTech('m4') && (target.kind === 'bus' || target.mode || target.type)) r *= 0.3;
  return r;
}

function reachOf(t) {
  if (t.kind === 'bus') return COMBAT.deadReach.bus;
  if (t.mode) return COMBAT.deadReach.refugee;
  return t.type === 'apc' ? COMBAT.deadReach.apc : COMBAT.deadReach.unit;
}

export function deadSystem(sim, dt) {
  const s = sim.state, N = sim.N, nav = sim.nav, map = sim.map;
  const D = s.ents.dead;
  resolveNoise(sim);
  for (let n = D.length - 1; n >= 0; n--) {
    if (D[n].gone || D[n].hp <= 0) {
      const z = D[n];
      if (!z.gone) { z.gone = true; s.stats.killed++; sim.emit('death', { kind: 'dead', dtype: z.type, id: z.id, x: z.x, z: z.z, y: z.y, rot: z.rot, look: z.look, soldier: z.soldier }); }
      D[n] = D[D.length - 1]; D.pop();
      sim.index.delete(z.id);
    }
  }
  const press = new Map(); // wall building id -> [dead]
  const rainy = sim.weather.rain;

  for (const z of D) {
    z.stack = 0;
    z.stalled = false;
    z.pileOf = 0;
    z.cool = Math.max(0, z.cool - dt);
    if (z.rise > 0) { z.rise = Math.max(0, z.rise - dt * 0.7); z.moving = false; continue; }
    if (z.drop > 0) { z.drop = Math.max(0, z.drop - dt * 2); z.moving = false; continue; }
    const def = DEAD[z.type];
    const ti = Math.min(N - 1, Math.max(0, Math.floor(z.x))), tj = Math.min(N - 1, Math.max(0, Math.floor(z.z)));
    const k = tj * N + ti;
    const tid = map.townId[k];
    if (tid >= 0) {
      const t = s.towns[tid];
      if (t.status === 'ok') { t.infected += SPREAD.deadInTownBites * dt; t.pop -= SPREAD.deadInTownKills * dt; t.deaths += SPREAD.deadInTownKills * dt; s.stats.deadPeople += SPREAD.deadInTownKills * dt; }
    }

    // Notice the living.
    z.scan -= dt;
    if (z.scan <= 0) {
      z.scan = sim.range(0.35, 0.7);
      const t = sim.liveHash.nearest(z.x, z.z, COMBAT.deadAggro * COMBAT.nightAggro, (h) => !h.gone && h.hp > 0 && Math.hypot(h.x - z.x, h.z - z.z) <= aggroRange(sim, h));
      z.target = t ? t.id : 0;
      if (t && def.scream && z.cool <= 0) {
        z.cool = def.scream.cooldown;
        makeNoise(sim, z.x, z.z, def.scream.radius);
        sim.emit('scream', { id: z.id, x: z.x, z: z.z, r: def.scream.radius });
        sim.lesson('howler');
      }
    }

    let dx = 0, dz = 0;
    const tg = z.target ? sim.byId(z.target) : null;
    z.state = 'path';
    if (tg && !tg.gone && tg.hp > 0) {
      const ex = tg.x - z.x, ez = tg.z - z.z, d = Math.hypot(ex, ez);
      if (d < reachOf(tg)) {
        let dmg = def.dps * dt;
        if (tg.type === 'apc') dmg *= COMBAT.apcArmor;
        tg.hp -= dmg;
        tg.hitT = s.time;
        // Refugees are not the player's; squads and evacuation buses are.
        const what = tg.kind === 'bus' ? 'Evacuation bus' : UNITS[tg.type]?.name;
        if (what) sim.underAttack(tg.x, tg.z, what);
        z.rot = angleTo(ex, ez);
        z.state = 'attack';
        z.moving = false;
        if (sim.chance(dt * 4)) sim.emit('bite', { x: tg.x, z: tg.z });
        continue;
      }
      if (d < 7) { dx = ex / d; dz = ez / d; z.state = 'chase'; } else z.target = 0;
    }
    if (!dx && !dz && z.inv && z.inv.until > s.time) {
      const ex = z.inv.x - z.x, ez = z.inv.z - z.z, d = Math.hypot(ex, ez);
      if (d > 0.6) { dx = ex / d; dz = ez / d; z.state = 'investigate'; } else z.inv = null;
    }
    if (!dx && !dz) {
      const nk = nav.next[k];
      if (nk >= 0) {
        dx = (nk % N) + 0.5 - z.x; dz = ((nk / N) | 0) + 0.5 - z.z;
      } else {
        z.wanderT -= dt;
        if (!z.wander || z.wanderT <= 0) {
          z.wanderT = sim.range(2, 5);
          const info = tid >= 0 ? map.towns[tid] : null;
          z.wander = info ? [info.x + sim.range(-info.r, info.r), info.z + sim.range(-info.r, info.r)] : [z.x + sim.range(-2, 2), z.z + sim.range(-2, 2)];
        }
        dx = z.wander[0] - z.x; dz = z.wander[1] - z.z;
        if (Math.hypot(dx, dz) < 0.2) dx = dz = 0;
      }
      const l = Math.hypot(dx, dz);
      if (l > 0) { dx /= l; dz /= l; }
    }
    if (!dx && !dz) { z.moving = false; continue; }

    const ox = z.x, oz = z.z;
    const inWater = nav.water(k);
    const sp = (inWater ? (def.waterSpeed || z.speed * 0.6) : z.speed) * (rainy ? WEATHER.rainDeadSpeed : 1);
    let nx = z.x + dx * sp * dt, nz = z.z + dz * sp * dt;
    const ni = Math.floor(nx), nj = Math.floor(nz);
    z.rot = turnToward(z.rot, angleTo(dx, dz), 5 * dt);
    const b = ni >= 0 && nj >= 0 && ni < N && nj < N ? sim.buildingAt(ni, nj) : null;
    if (b && b.type !== 'minefield') {
      b.hp -= def.wallDmg * dt;
      b.hitT = s.time;
      sim.underAttack(b.x, b.z, BUILDINGS[b.type].name, b.type === 'hq' ? 'hqAttack' : 'underAttack');
      z.state = 'attack';
      z.moving = false;
      z.wall = b.id;
      z.pdx = dx; z.pdz = dz;
      if (BUILDINGS[b.type].wall || b.type === 'checkpoint') {
        let list = press.get(b.id);
        if (!list) press.set(b.id, (list = []));
        list.push(z);
      }
      if (sim.chance(dt * 1.5)) sim.emit('claw', { x: nx, z: nz });
      continue;
    }
    if (ni < 0 || nj < 0 || ni >= N || nj >= N || map.terrain[nj * N + ni] === TER.MOUNTAIN) { z.moving = false; z.wander = null; continue; }
    // Separation from neighbours
    sim.deadHash.query(nx, nz, 0.3, (o, d2) => {
      if (o === z || d2 < 1e-6) return;
      const d = Math.sqrt(d2), push = (0.3 - d) * 0.5;
      nx += ((nx - o.x) / d) * push; nz += ((nz - o.z) / d) * push;
    });
    const fi = Math.floor(nx), fj = Math.floor(nz);
    if (fi >= 0 && fj >= 0 && fi < N && fj < N) {
      const fb = sim.buildingAt(fi, fj);
      if ((!fb || fb.type === 'minefield') && map.terrain[fj * N + fi] !== TER.MOUNTAIN) { z.x = nx; z.z = nz; }
    }
    z.wall = -1;
    z.moving = true;
    // Barely moved despite wanting to: part of a crush (counts toward a pile-up if it's at a wall).
    z.stalled = Math.hypot(z.x - ox, z.z - oz) < sp * dt * 0.35;
    z.pdx = dx; z.pdz = dz;
    const wk = Math.floor(z.z) * N + Math.floor(z.x);
    z.y = nav.water(wk) ? -0.62 : 0;
  }

  pileup(sim, press, dt);
}

// Bodies stack against a wall; once the pile reaches the wall's threshold, the top of it spills over.
function pileup(sim, press, dt) {
  const s = sim.state, N = sim.N, nav = sim.nav;
  for (const b of s.ents.buildings) if (!press.has(b.id)) b.spillT = Math.max(0, (b.spillT || 0) - dt);
  for (const [bid, front] of press) {
    const b = sim.byId(bid);
    if (!b) continue;
    // The pile is the front row plus the stalled crowd behind it that is heading into this wall.
    const set = new Set(front);
    sim.deadHash.query(b.x, b.z, PILEUP.pressRange, (z) => {
      if (set.has(z) || !z.stalled || z.gone || z.pileOf) return;
      const wx = b.x - z.x, wz = b.z - z.z, d = Math.hypot(wx, wz) || 1;
      if ((wx * z.pdx + wz * z.pdz) / d < 0.4) return;
      z.pileOf = bid;
      set.add(z);
    });
    const list = [...set];
    const threshold = b.type === 'highwall' ? PILEUP.highWall : PILEUP.wall;
    list.sort((a, c) => a.id - c.id);
    list.forEach((z, n) => { z.stack = Math.min(n + 1, threshold) / threshold; });
    b.press = list.length / threshold;
    if (list.length < threshold) { b.spillT = Math.max(0, b.spillT - dt); continue; }
    b.spillT += dt;
    while (b.spillT >= PILEUP.spillHours) {
      b.spillT -= PILEUP.spillHours;
      const z = list.pop();
      if (!z) break;
      let ax = z.pdx || 0, az = z.pdz || 0;
      if (Math.abs(ax) > Math.abs(az)) { ax = Math.sign(ax); az = 0; } else { az = Math.sign(az); ax = 0; }
      let landed = false;
      for (let step = 1; step <= 2 && !landed; step++) {
        const li = b.i + ax * step, lj = b.j + az * step;
        if (li < 0 || lj < 0 || li >= N || lj >= N) break;
        const lk = lj * N + li;
        if (nav.blk[lk] || nav.deadBlocked(lk)) continue;
        const fromX = z.x, fromZ = z.z;
        z.x = li + 0.5 + sim.range(-0.3, 0.3);
        z.z = lj + 0.5 + sim.range(-0.3, 0.3);
        z.drop = 1;
        z.stack = 0;
        landed = true;
        sim.emit('climb', { id: z.id, x: z.x, z: z.z, fromX, fromZ });
      }
      if (landed) {
        sim.lesson('pileup');
        if (!b.spillWarned || s.time - b.spillWarned > 6) {
          b.spillWarned = s.time;
          sim.alert('pileup', 'The dead are piling over a wall!', b.x, b.z, 'bad');
        }
      }
    }
  }
}
