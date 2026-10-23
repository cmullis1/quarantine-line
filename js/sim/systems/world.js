// Time of day, world infection, and everything that arrives from outside: refugees, the trickle of
// the dead, telegraphed hordes and sea hordes.
import { WORLD, HORDE, REFUGEES } from '../../config/balance.js';
import { HORDE_MIX } from '../../config/dead.js';
import { TER } from '../../config/world.js';
import { spawnDead, spawnRefugee } from '../entities.js';

const DIR_NAMES = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];

// The compass point of the direction (dx, dz): +x is east, +z south.
export function compass(dx, dz) {
  return DIR_NAMES[((Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) % 8) + 8) % 8];
}

export function directionName(sim, x, z) {
  const c = sim.map.towns.find((t) => t.capital);
  return compass(x - c.x, z - c.z);
}

function composition(sim, size, sea) {
  const mix = sea ? { drowned: 0.85 } : HORDE_MIX[sim.act - 1];
  const comp = {};
  let rest = size;
  for (const [type, f] of Object.entries(mix)) { const n = Math.round(size * f); if (n > 0) { comp[type] = n; rest -= n; } }
  if (rest > 0) comp.walker = (comp.walker || 0) + rest;
  return comp;
}

function seaSpawnPoint(sim) {
  const N = sim.N, m = sim.map;
  if (!sim.seaEdge) {
    sim.seaEdge = [];
    for (let k = 0; k < N; k++) for (const [i, j] of [[k, 0], [k, N - 1], [0, k], [N - 1, k]]) {
      if (m.terrain[j * N + i] === TER.SEA) sim.seaEdge.push([i, j]);
    }
  }
  if (!sim.seaEdge.length) return null;
  return sim.pick(sim.seaEdge);
}

// Plan a horde: announce the rumour now, spawn it `lead` hours later.
export function scheduleHorde(sim, { size, siteId = null, sea = false, lead = HORDE.rumourLead, label = null, comp = null }) {
  const s = sim.state;
  let x, z, name;
  if (sea) {
    const p = seaSpawnPoint(sim);
    if (!p) return null;
    [x, z] = [p[0] + 0.5, p[1] + 0.5];
    name = 'the sea';
  } else {
    const site = sim.map.sites[siteId ?? Math.floor(sim.rand() * sim.map.sites.length)];
    x = site.x; z = site.z; name = site.name;
  }
  const h = {
    id: sim.newId(), size, comp: comp || composition(sim, size, sea), x, z, sea, name, label,
    phase: 'rumour', spawnAt: s.time + lead, members: 0, spawned: 0, contactAt: 0,
  };
  s.hordes.push(h);
  const dir = directionName(sim, x, z);
  sim.alert('hordeRumour', label ? `${label}: reports of the dead massing near ${name} (${dir}).` : `Reports of the dead massing near ${name}, to the ${dir}.`, x, z, 'warn');
  sim.emit('hordeRumour', { id: h.id, x, z });
  sim.lesson('horde');
  return h;
}

function onNewDay(sim, day) {
  sim.emit('dawn', { day });
  if (day > 1) sim.alert('day', `Day ${day}. World infection ${sim.state.worldInf.toFixed(1)}%.`, null, null, 'info');
  if (day >= 3) sim.state.flags.sitesFallen = true;
}

export function worldSystem(sim, dt) {
  const s = sim.state;
  const day = sim.day;
  if (s.flags.lastDay !== day) { s.flags.lastDay = day; onNewDay(sim, day); }
  s.worldInf = Math.min(100, WORLD.infStart * Math.exp((WORLD.infGrowth * s.time) / 24));
  const wi = s.worldInf;
  const wx = sim.weather;
  const tag = (wx.fog ? 'fog' : '') + (wx.rain ? 'rain' : '');
  if (tag !== (s.flags.weather || '')) {
    if (wx.fog && !s.flags.weather?.includes('fog')) sim.alert('weather', 'Fog is rolling in: sight and weapon range sharply reduced.', null, null, 'warn');
    else if (wx.rain && !s.flags.weather?.includes('rain')) sim.alert('weather', 'Rain: shorter sight and range; gunfire carries less far.', null, null, 'info');
    s.flags.weather = tag;
  }
  if (!s.flags.noSpawns) automaticSpawns(sim, dt, day, wi);
  advanceHordes(sim, dt);
}

// Refugees, the trickle of the dead and scheduled hordes. Off in training scenarios.
function automaticSpawns(sim, dt, day, wi) {
  const s = sim.state;

  // Refugees
  if (s.time > REFUGEES.startHour) {
    let rate = Math.min(REFUGEES.rateCap, REFUGEES.baseRate + wi * REFUGEES.ratePerWorldInf);
    if (wi > 70) rate *= Math.max(0.15, 1 - (wi - 70) / 35);
    if (sim.chance(rate * dt)) {
      const sites = sim.map.sites.filter((x) => x.crossingId >= 0);
      if (sites.length) spawnRefugee(sim, sim.pick(sites).id);
    }
  }

  // The trickle of the dead
  if (s.time > WORLD.trickleStart && sim.chance(Math.min(WORLD.trickleCap, WORLD.trickleBase + wi * WORLD.trickleWorld) * sim.diff.horde * dt)) {
    const site = sim.pick(sim.map.sites);
    const n = 1 + Math.floor(sim.rand() * 3);
    for (let k = 0; k < n; k++) {
      const type = sim.act >= 2 && sim.chance(0.15) ? 'runner' : 'walker';
      spawnDead(sim, type, site.x + sim.range(-3, 3), site.z + sim.range(-3, 3));
    }
  }

  // Scheduled hordes
  s.hordeT -= dt;
  if (s.hordeT <= 0) {
    const size = Math.round(Math.min(HORDE.sizeCap, HORDE.sizeBase + day * HORDE.sizePerDay + wi * HORDE.sizePerWorldInf) * sim.diff.horde);
    const sea = day >= HORDE.seaFromDay && sim.chance(HORDE.seaChance);
    scheduleHorde(sim, { size, sea });
    s.hordeT = sim.range(HORDE.interval[0], HORDE.interval[1]) * Math.max(0.6, 1 - day * HORDE.intervalDecay);
  }

}

// Hordes move from rumour to spawning, and queued spawns drip into the world.
function advanceHordes(sim, dt) {
  const s = sim.state;
  for (const h of s.hordes) {
    if (h.phase === 'rumour' && s.time >= h.spawnAt) {
      h.phase = 'moving';
      const list = [];
      for (const [type, n] of Object.entries(h.comp)) for (let k = 0; k < n; k++) list.push(type);
      s.pending.push({ horde: h.id, x: h.x, z: h.z, list, acc: 0, spread: h.sea ? 4 : 3.5 });
    }
  }

  // Drip-feed queued spawns so hordes stream in rather than pop.
  for (let n = s.pending.length - 1; n >= 0; n--) {
    const p = s.pending[n];
    p.acc += dt * HORDE.spawnPerHour;
    while (p.acc >= 1 && p.list.length) {
      p.acc -= 1;
      const type = p.list.pop();
      const x = Math.min(sim.N - 0.5, Math.max(0.5, p.x + sim.range(-p.spread, p.spread)));
      const z = Math.min(sim.N - 0.5, Math.max(0.5, p.z + sim.range(-p.spread, p.spread)));
      const d = spawnDead(sim, type, x, z, { horde: p.horde });
      const h = s.hordes.find((q) => q.id === p.horde);
      if (d && h) h.spawned++;
    }
    if (!p.list.length) s.pending.splice(n, 1);
  }
}
