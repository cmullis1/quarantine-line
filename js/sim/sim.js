// The simulation: plain-data state, a fixed-step update, a commands API and an event queue.
// No rendering or DOM here: Node runs this for tests and bot play.
import { SIM_STEP_HOURS, START, DIFFICULTY, HOURS_PER_DAY, WEATHER } from '../config/balance.js';
import { BUILDINGS } from '../config/buildings.js';
import { weightOf, ALERT_RULES } from '../config/alerts.js';
import { atPlace } from './places.js';
import { generateMap } from './mapgen.js';
import { Nav, BLK } from './nav.js';
import { SpatialHash } from '../util.js';
import { COMMANDS } from './commands.js';
import { setupScenario } from './systems/scenario.js';
import { worldSystem } from './systems/world.js';
import { economySystem } from './systems/economy.js';
import { townSystem } from './systems/towns.js';
import { deadSystem } from './systems/dead.js';
import { refugeeSystem } from './systems/refugees.js';
import { unitSystem, vehicleSystem } from './systems/units.js';
import { buildingSystem } from './systems/buildings.js';
import { politicsSystem } from './systems/politics.js';
import { fogSystem, recomputeVision } from './systems/fog.js';

// 2: the 144² map (R15.4): a 112² save no longer matches the map rebuilt from its seed.
export const SAVE_VERSION = 2;

function createState({ seed, mode, difficulty, map }) {
  return {
    v: SAVE_VERSION, seed, mode, difficulty,
    rng: (seed * 2654435761) >>> 0,
    time: START.hour,
    res: { ...START.res },
    rates: { funds: 0, food: 0, ammo: 0, manpower: 0, authority: 0, research: 0 },
    trust: START.trust, order: START.order, trustRate: 0, orderRate: 0,
    worldInf: 0,
    border: 'open',
    laws: [],
    research: { active: null, progress: {}, done: [] },
    cooldowns: {},
    towns: map.towns.map((t) => ({
      id: t.id, pop: t.pop, pop0: t.pop, infected: 0, reported: 0, hist: [], alerted: false,
      status: 'ok', quarantine: false, sacrifice: false, evacUntil: 0, residual: 0, spawnAcc: 0,
      reclaimT: 0, fireT: 0, outbreaks: 0, deaths: 0,
    })),
    ents: { units: [], dead: [], refugees: [], buildings: [], vehicles: [], shells: [], strikes: [] },
    nextId: 1,
    hordes: [], hordeT: 0, pending: [], noises: [], fogT: 0,
    fog: { seen: new Array(map.N * map.N).fill(0) },
    recon: [],
    cabinet: { requests: [], nextAt: 0, history: [] },
    events: { fired: [], decision: null, queue: [], nextRandom: 0, letters: [] },
    news: { fired: [] },
    lessons: { fired: [] },
    stats: {
      killed: 0, unitsLost: 0, admitted: 0, turnedAway: 0, shot: 0, refugeesTurned: 0,
      deadPeople: 0, reportedDeaths: 0, townsLost: 0, townsReclaimed: 0, evacuated: 0, promisesKept: 0,
      promisesBroken: 0, peakDead: 0, ammoSpent: 0,
    },
    flags: {},
    log: [],
    // Game hour of the last "under attack" alert per map square (Sim.underAttack).
    attackT: {},
    tutorial: null,
    over: null,
  };
}

export class Sim {
  constructor(opts = {}, restored = null) {
    const seed = restored ? restored.seed : (opts.seed ?? 1);
    const mode = restored ? restored.mode : (opts.mode ?? 'campaign');
    const difficulty = restored ? restored.difficulty : (opts.difficulty ?? 'veteran');
    this.map = generateMap({ seed, scenario: mode === 'sandbox' ? 'sandbox' : 'campaign' });
    this.nav = new Nav(this.map);
    this.N = this.map.N;
    this.diff = DIFFICULTY[difficulty];
    this.out = [];
    this.bgrid = new Int32Array(this.N * this.N);
    this.vis = new Uint8Array(this.N * this.N);
    this.deadHash = new SpatialHash(this.N, 2);
    this.liveHash = new SpatialHash(this.N, 2);
    this.index = new Map();
    this.flowDirty = true;
    this.state = restored || createState({ seed, mode, difficulty, map: this.map });
    if (!restored) setupScenario(this, opts);
    this.rebuildDerived();
  }

  // ---- Derived (non-saved) data ------------------------------------------

  rebuildDerived() {
    this.bgrid.fill(0);
    this.nav.blk.fill(0);
    for (const b of this.state.ents.buildings) this.occupy(b, true);
    this.rebuildIndex();
    this.flowDirty = true;
    recomputeVision(this);
  }

  rebuildIndex() {
    const idx = this.index;
    idx.clear();
    const e = this.state.ents;
    for (const list of [e.units, e.dead, e.refugees, e.buildings, e.vehicles]) for (const o of list) idx.set(o.id, o);
  }

  occupy(b, on) {
    const def = BUILDINGS[b.type];
    // Gates and checkpoints let the living through; minefields are walkable by everyone.
    const blk = def.gate || b.type === 'checkpoint' ? BLK.GATE : b.type === 'minefield' ? BLK.NONE : BLK.SOLID;
    for (let dj = 0; dj < b.size; dj++) for (let di = 0; di < b.size; di++) {
      const k = (b.j + dj) * this.N + (b.i + di);
      this.bgrid[k] = on ? b.id : 0;
      this.nav.setBlock(k, on ? blk : BLK.NONE);
    }
    this.flowDirty = true;
  }

  // ---- Helpers used by systems and commands -----------------------------------

  get day() { return Math.floor(this.state.time / HOURS_PER_DAY) + 1; }
  get hour() { return this.state.time % HOURS_PER_DAY; }
  get act() { const d = this.day; return d <= 6 ? 1 : d <= 18 ? 2 : d <= 34 ? 3 : 4; }
  get night() { const h = this.hour; return h < 5.5 || h >= 20.5; }

  // Weather for a day, derived from the seed (not the RNG stream, so it never perturbs the sim).
  weatherOf(day) {
    let h = Math.imul(this.state.seed ^ 0x5bd1e995, 0x27d4eb2d) ^ Math.imul(day, 0x165667b1);
    const rnd = () => { h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); return ((h ^ (h >>> 15)) >>> 0) / 4294967296; };
    const rain = day > 1 && rnd() < WEATHER.rainChance;
    const start = 6 + rnd() * 10, len = WEATHER.rainHours[0] + rnd() * (WEATHER.rainHours[1] - WEATHER.rainHours[0]);
    const fog = day > 1 && rnd() < WEATHER.fogChance;
    return { rain, start, end: start + len, fog };
  }
  get weather() {
    const key = Math.floor(this.state.time * 4);
    if (this._wxKey === key) return this._wx;
    const w = this.weatherOf(this.day), h = this.hour;
    this._wxKey = key;
    this._wx = { rain: w.rain && h >= w.start && h < w.end, fog: w.fog && h >= WEATHER.fogStart && h < WEATHER.fogEnd };
    return this._wx;
  }

  rand() {
    let t = (this.state.rng = (this.state.rng + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + this.rand() * (b - a); }
  chance(p) { return this.rand() < p; }
  pick(arr) { return arr[Math.floor(this.rand() * arr.length)]; }
  newId() { return this.state.nextId++; }
  byId(id) { return this.index.get(id); }

  emit(type, data = {}) { this.out.push({ ...data, type }); }
  drainEvents() { const o = this.out; this.out = []; return o; }

  alert(kind, text, x = null, z = null, level = 'info') {
    const a = { kind, text, x, z, level, weight: weightOf(kind), t: this.state.time, id: this.newId() };
    const log = this.state.log;
    // Merge a repeat of the same alert kind+text within 6 h into a counter instead of a new line.
    const prev = log.find((l) => l.kind === kind && l.text === text && this.state.time - l.t < 6);
    if (prev) { prev.count = (prev.count || 1) + 1; prev.t = this.state.time; this.emit('alert', { ...prev, merged: true }); return; }
    log.unshift(a);
    if (log.length > 80) log.pop();
    this.emit('alert', a);
  }

  // A player building, unit or bus took damage from the dead. Throttled per map square in game time, so a horde
  // clawing a wall raises one line every few hours, not one per bite; the HQ has its own, critical, line.
  underAttack(x, z, what, kind = 'underAttack') {
    const s = this.state, c = ALERT_RULES.attackCell;
    // A number, not a string: this runs for every claw and bite. 0 is the HQ; squares are offset past the map's edge.
    const key = kind === 'hqAttack' ? 0 : 1 + (Math.floor(z / c) + 64) * 512 + Math.floor(x / c) + 64;
    const at = s.attackT || (s.attackT = {});
    if (at[key] !== undefined && s.time - at[key] < ALERT_RULES.attackHours) return;
    at[key] = s.time;
    this.alert(kind, `${what} under attack ${atPlace(this, x, z)}.`, x, z, 'bad');
  }

  lesson(key) {
    const f = this.state.lessons.fired;
    if (f.includes(key)) return;
    f.push(key);
    this.emit('lesson', { key });
  }

  hasLaw(id) { return this.state.laws.includes(id); }
  hasTech(id) { return this.state.research.done.includes(id); }

  canAfford(cost) {
    for (const k in cost) if ((this.state.res[k] ?? 0) < cost[k]) return false;
    return true;
  }
  pay(cost, mult = 1) { for (const k in cost) this.state.res[k] -= cost[k] * mult; }
  gain(res, mult = 1) { for (const k in res) this.state.res[k] = (this.state.res[k] ?? 0) + res[k] * mult; }

  buildingAt(i, j) {
    if (i < 0 || j < 0 || i >= this.N || j >= this.N) return null;
    const id = this.bgrid[j * this.N + i];
    return id ? this.index.get(id) : null;
  }

  townInfo(id) { return this.map.towns[id]; }
  livingTowns() { return this.state.towns.filter((t) => t.status === 'ok'); }

  visible(x, z) {
    const i = Math.floor(x), j = Math.floor(z);
    if (i < 0 || j < 0 || i >= this.N || j >= this.N) return false;
    return this.vis[j * this.N + i] === 1;
  }

  // ---- Stepping ---------------------------------------------------------------

  step(hours) {
    let rem = hours;
    while (rem > 1e-9 && !this.state.over) {
      const dt = Math.min(SIM_STEP_HOURS, rem);
      this.tick(dt);
      rem -= dt;
    }
  }

  tick(dt) {
    const s = this.state;
    s.time += dt;
    this.rebuildIndex();
    worldSystem(this, dt);
    if (this.flowDirty) { this.computeFlow(); this.flowDirty = false; }
    this.deadHash.clear();
    for (const z of s.ents.dead) if (!z.rise) this.deadHash.insert(z);
    this.liveHash.clear();
    for (const u of s.ents.units) if (!u.air) this.liveHash.insert(u);
    for (const r of s.ents.refugees) if (!r.camp) this.liveHash.insert(r);
    for (const v of s.ents.vehicles) this.liveHash.insert(v);
    recomputeVision(this);
    s.fogT = (s.fogT || 0) - dt;
    if (s.fogT <= 0) { s.fogT = 0.25; fogSystem(this); }
    economySystem(this, dt);
    townSystem(this, dt);
    deadSystem(this, dt);
    refugeeSystem(this, dt);
    unitSystem(this, dt);
    vehicleSystem(this, dt);
    buildingSystem(this, dt);
    politicsSystem(this, dt);
  }

  computeFlow() {
    const sources = [];
    for (const t of this.state.towns) {
      if (t.status !== 'ok') continue;
      const info = this.map.towns[t.id];
      // Bigger towns pull harder; sacrifice zones pull hardest.
      const bias = t.sacrifice ? 0 : 14 - Math.min(10, Math.log10(Math.max(10, t.pop)) * 2);
      for (const k of info.tiles) sources.push({ k, bias });
    }
    this.nav.flow(sources);
  }

  // ---- Commands -------------------------------------------------------------

  cmd(name, ...args) {
    const fn = COMMANDS[name];
    if (!fn) return { ok: false, why: `Unknown command ${name}` };
    if (this.state.over && name !== 'decide') return { ok: false, why: 'Game over' };
    this.rebuildIndex();
    return fn(this, ...args) || { ok: true };
  }

  // ---- Save / load ------------------------------------------------------------

  serialize() { return JSON.stringify(this.state); }

  static deserialize(str) {
    const state = JSON.parse(str);
    if (state.v !== SAVE_VERSION) throw new Error(`Save version ${state.v} is not supported`);
    return new Sim({}, state);
  }

  hash() {
    // FNV-1a over the serialised state: cheap and stable for determinism tests.
    const str = this.serialize();
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16);
  }
}
