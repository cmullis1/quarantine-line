// Cabinet requests: ministers ask for something with a deadline. Accepting makes it a promise.
// make(sim) → params or null (not applicable now). check(sim, req) → true when fulfilled.
// `hold` requests succeed at the deadline unless broken earlier (broken(sim, req) → true).

export const MINISTERS = {
  defence: { name: 'General Arkov', title: 'Minister of Defence', color: '#c8a050' },
  health: { name: 'Dr. Ilse Lind', title: 'Minister of Health', color: '#80c8a0' },
  interior: { name: 'Teodor Sora', title: 'Minister of the Interior', color: '#8fb0e0' },
};

const countBuilt = (sim, type, x, z, r) => sim.state.ents.buildings.filter((b) => b.type === type && b.built && (x == null || Math.hypot(b.x - x, b.z - z) < r)).length;
const unitsOf = (sim, type) => sim.state.ents.units.filter((u) => u.type === type).length;

export const REQUESTS = [
  {
    id: 'towers', minister: 'defence', hours: 48, reward: { authority: 10 }, trustReward: 3,
    make: (sim) => { const c = sim.pick(sim.map.crossings); return { crossing: c.id, base: countBuilt(sim, 'tower', c.x, c.z, 7) }; },
    text: (sim, p) => `Build two more watchtowers at the ${sim.map.sites[sim.map.crossings[p.crossing].siteId].name} crossing.`,
    check: (sim, req) => { const c = sim.map.crossings[req.p.crossing]; return countBuilt(sim, 'tower', c.x, c.z, 7) >= req.p.base + 2; },
  },
  {
    id: 'infantry', minister: 'defence', hours: 48, reward: { authority: 8, ammo: 40 },
    make: (sim) => ({ base: unitsOf(sim, 'infantry') }),
    text: () => 'Field three more infantry squads.',
    check: (sim, req) => unitsOf(sim, 'infantry') >= req.p.base + 3,
  },
  {
    id: 'cull', minister: 'defence', hours: 48, reward: { authority: 10 }, trustReward: 3,
    make: (sim) => (sim.day >= 4 ? { base: sim.state.stats.killed } : null),
    text: () => 'Put down 150 of the dead.',
    check: (sim, req) => sim.state.stats.killed >= req.p.base + 150,
  },
  {
    id: 'martial', minister: 'defence', hours: 72, reward: { authority: 12, manpower: 40 },
    make: (sim) => (sim.day >= 5 && !sim.hasLaw('martial') && sim.hasLaw('curfew') ? {} : null),
    text: () => 'Declare Martial Law. The army needs a free hand.',
    check: (sim) => sim.hasLaw('martial'),
  },
  {
    id: 'checkpoint', minister: 'defence', hours: 48, reward: { authority: 8 }, trustReward: 2,
    make: (sim) => {
      const open = sim.map.crossings.filter((c) => { const b = sim.buildingAt(c.i, c.j); return !b || b.type !== 'checkpoint'; });
      return open.length ? { crossing: sim.pick(open).id } : null;
    },
    text: (sim, p) => `Put a checkpoint on the ${sim.map.sites[sim.map.crossings[p.crossing].siteId].name} crossing.`,
    check: (sim, req) => { const c = sim.map.crossings[req.p.crossing]; const b = sim.buildingAt(c.i, c.j); return !!b && b.type === 'checkpoint' && b.built; },
  },
  {
    id: 'hazmat', minister: 'health', hours: 24, reward: { authority: 8 }, trustReward: 4,
    make: (sim) => { const t = sim.state.towns.filter((x) => x.alerted && x.status === 'ok'); return t.length ? { town: sim.pick(t).id } : null; },
    text: (sim, p) => `Station a Quarantine Team in ${sim.map.towns[p.town].name}.`,
    check: (sim, req) => { const info = sim.map.towns[req.p.town]; return sim.state.ents.units.some((u) => u.type === 'hazmat' && Math.hypot(u.x - info.x, u.z - info.z) < info.r + 2.5); },
  },
  {
    id: 'hospital', minister: 'health', hours: 72, reward: { authority: 8, research: 15 },
    make: (sim) => (countBuilt(sim, 'hospital') === 0 ? {} : null),
    text: () => 'Build a Field Hospital.',
    check: (sim) => countBuilt(sim, 'hospital') > 0,
  },
  {
    id: 'contain', minister: 'health', hours: 72, reward: { authority: 12 }, trustReward: 5,
    make: (sim) => { const t = sim.state.towns.filter((x) => x.alerted && x.status === 'ok'); return t.length ? { town: sim.pick(t).id } : null; },
    text: (sim, p) => `Contain the outbreak in ${sim.map.towns[p.town].name}.`,
    check: (sim, req) => !sim.state.towns[req.p.town].alerted && sim.state.towns[req.p.town].status === 'ok',
  },
  {
    id: 'testingLaw', minister: 'health', hours: 72, reward: { authority: 6, research: 20 },
    make: (sim) => (!sim.hasLaw('testing') ? {} : null),
    text: () => 'Make testing mandatory.',
    check: (sim) => sim.hasLaw('testing'),
  },
  {
    id: 'medResearch', minister: 'health', hours: 96, reward: { authority: 10 },
    make: (sim) => { const next = ['m1', 'm2', 'm3', 'm4'].find((id) => !sim.hasTech(id)); return next && next !== 'm4' ? { tech: next } : null; },
    text: (sim, p) => `Complete research into ${({ m1: 'Rapid Screening', m2: 'Field Test Kits', m3: 'Outbreak Protocols' })[p.tech]}.`,
    check: (sim, req) => sim.hasTech(req.p.tech),
  },
  {
    id: 'keepOpen', minister: 'interior', hours: 48, hold: true, reward: { authority: 10 }, trustReward: 5,
    make: (sim) => (sim.state.border === 'open' ? {} : null),
    text: () => 'Keep the border open for two more days. People are watching how we treat them.',
    broken: (sim) => sim.state.border !== 'open',
  },
  {
    id: 'admit', minister: 'interior', hours: 72, reward: { authority: 8, manpower: 30 }, trustReward: 3,
    make: (sim) => (sim.state.border !== 'closed' && sim.state.border !== 'shoot' ? { base: sim.state.stats.admitted } : null),
    text: () => 'Admit fifteen more refugee groups.',
    check: (sim, req) => sim.state.stats.admitted >= req.p.base + 15,
  },
  {
    id: 'food', minister: 'interior', hours: 48, hold: true, reward: { authority: 8 }, trustReward: 4,
    make: (sim) => (sim.state.res.food > 110 ? {} : null),
    text: () => 'Keep food stocks above 100 for two days.',
    broken: (sim) => sim.state.res.food < 100,
  },
  {
    id: 'noLaws', minister: 'interior', hours: 72, hold: true, reward: { authority: 6 }, trustReward: 6,
    make: (sim) => ({ base: sim.state.laws.length }),
    text: () => 'Pass no new emergency laws for three days. Parliament is nervous.',
    broken: (sim, req) => sim.state.laws.length > req.p.base,
  },
  {
    id: 'liftQuarantine', minister: 'interior', hours: 24, reward: { authority: 6 }, trustReward: 5,
    make: (sim) => { const t = sim.state.towns.filter((x) => x.quarantine && x.status === 'ok'); return t.length ? { town: sim.pick(t).id } : null; },
    text: (sim, p) => `Lift the quarantine on ${sim.map.towns[p.town].name}. Its people have done nothing wrong.`,
    check: (sim, req) => !sim.state.towns[req.p.town].quarantine,
  },
  {
    id: 'address', minister: 'interior', hours: 48, reward: { authority: 4 }, trustReward: 2,
    make: (sim) => ({ base: sim.state.cooldowns.broadcast || 0 }),
    text: () => 'Address the nation. They need to hear from you.',
    check: (sim, req) => (sim.state.cooldowns.broadcast || 0) > req.p.base,
  },
];

export const REQUEST_BY_ID = Object.fromEntries(REQUESTS.map((r) => [r.id, r]));
