// Campaign structure: acts, scripted decisions, endings, score.
// Decision choices: `effect` is the text shown on the button; `run(sim)` applies it.
// Every option costs something visible: no free answers.
import { hitTrust } from '../sim/systems/economy.js';
import { scheduleHorde } from '../sim/systems/world.js';
import { spawnUnit, spawnRefugee } from '../sim/entities.js';

export const ACTS = [
  { n: 1, day: 1, title: 'Act I: Patient Zero', sub: 'Something is spreading. Today it reached us.' },
  { n: 2, day: 7, title: 'Act II: The Great Panic', sub: 'Our neighbours are falling. Their people are at our door.' },
  { n: 3, day: 19, title: 'Act III: The Siege', sub: 'The world has gone quiet. The dead have not.' },
  { n: 4, day: 35, title: 'Act IV: Turning the Tide', sub: 'Hold. Then take it back.' },
];

const town = (sim, name) => sim.map.towns.find((t) => t.name === name);
const crossingTo = (sim, siteName) => {
  const site = sim.map.sites.find((s) => s.name === siteName) || sim.map.sites[0];
  return sim.map.crossings[site.crossingId];
};

export const DECISIONS = [
  {
    id: 'patientZero', day: 1, modes: ['campaign', 'sandbox'],
    title: 'Day 1: Patient Zero',
    text: (sim) => `Health officials across the border report a "severe rabies-like illness". This morning a feverish truck driver in ${sim.map.towns[sim.state.flags.patientZero].name.toUpperCase()} bit two paramedics before he was restrained. He had no pulse when they sedated him.\n\nThe press has not caught on yet.`,
    choices: [
      { label: 'Go public. Mobilise.', effect: 'Trust −6 · Manpower +40 · Detection +10% everywhere', run: (sim) => { hitTrust(sim, 6); sim.state.res.manpower += 40; sim.state.flags.public = true; } },
      { label: 'Suppress it. Avoid panic.', effect: 'Funds +80 · Detection −15% · If it leaks: Trust −12', run: (sim) => { sim.state.res.funds += 80; sim.state.flags.suppressed = true; } },
    ],
  },
  {
    id: 'theyAreComing', day: 2, modes: ['campaign', 'sandbox'],
    title: 'Day 2: They Are Coming',
    text: () => 'Thousands of people from the neighbouring countries are walking toward our crossings. Some are carrying wounded. Our border posts ask for orders.\n\nYou can change the stance later in the Policy panel.',
    choices: [
      { label: 'Open the border', effect: 'People and manpower flow in · Trust + · Some are infected', run: (sim) => sim.cmd('setBorder', 'open') },
      { label: 'Screen arrivals', effect: 'Only crossings with a Checkpoint admit · Catches 60% of the infected', run: (sim) => sim.cmd('setBorder', 'screened') },
      { label: 'Close the border', effect: 'Nobody gets in · Crowds gather · Trust drains while closed', run: (sim) => sim.cmd('setBorder', 'closed') },
    ],
  },
  {
    id: 'clinicStrike', day: 3, modes: ['campaign'],
    title: 'Day 3: The Nurses of Kessel',
    text: () => 'Nurses at Kessel General have walked out. Two of their colleagues are "missing" from the isolation ward. They want hazard pay and real protective gear before they go back in.',
    choices: [
      { label: 'Pay them', effect: 'Funds −60 · Kessel detection +15% for good', run: (sim) => { sim.state.res.funds -= 60; sim.state.flags.kesselNurses = true; } },
      { label: 'Order them back to work', effect: 'Order +4 · Trust −5', run: (sim) => { sim.state.order += 4; hitTrust(sim, 5); } },
    ],
  },
  {
    id: 'vitaxin', day: 4, modes: ['campaign'],
    title: 'Day 4: Vitaxin',
    text: () => 'Halcyon Pharma offers its new vaccine, VITAXIN, for national distribution. Clinical trials were "accelerated". The public is desperate for good news.',
    choices: [
      { label: 'Approve Vitaxin', effect: 'Funds −40 · Trust +12 now', run: (sim) => { sim.state.res.funds -= 40; sim.state.trust += 12; sim.state.flags.vitaxin = true; } },
      { label: 'Refuse it', effect: 'Trust −4 · Authority +4', run: (sim) => { hitTrust(sim, 4); sim.state.res.authority += 4; } },
    ],
  },
  {
    id: 'children', day: 5, modes: ['campaign'],
    title: 'Day 5: The Children\'s Train',
    text: () => 'Drovno\'s last mayor asks us to take a column of children and their teachers. They are walking toward the Osterby crossing. He swears none of them has been bitten.',
    choices: [
      { label: 'Let them in', effect: '6 refugee groups arrive at Osterby · Trust +6 · He might be wrong', run: (sim) => {
        const c = crossingTo(sim, 'Drovno');
        for (let k = 0; k < 6; k++) { const r = spawnRefugee(sim, c.siteId); r.infected = sim.chance(0.08); r.vip = true; }
        sim.state.trust += 6;
      } },
      { label: 'Turn them away', effect: 'Trust −5 · No risk', run: (sim) => hitTrust(sim, 5) },
    ],
  },
  {
    id: 'brigade', day: 6, modes: ['campaign'],
    title: 'Day 6: Drovnia Has Fallen',
    text: () => 'The Drovnian government has stopped transmitting. Remnants of its 3rd Rifle Brigade are at the Osterby crossing asking to fight under our flag. Our medics cannot check them all.',
    choices: [
      { label: 'Take them in', effect: '+3 Infantry squads · 60% chance of infection seeded in Osterby', run: (sim) => {
        const c = crossingTo(sim, 'Drovno');
        for (let k = 0; k < 3; k++) {
          const p = sim.nav.nearestPassable(Math.floor(c.x - c.dx * (2 + k)), Math.floor(c.z - c.dz * (2 + k)));
          if (p) spawnUnit(sim, 'infantry', p[0] + 0.5, p[1] + 0.5).foreign = true;
        }
        if (sim.chance(0.6)) sim.state.towns[town(sim, 'Osterby').id].infected += 40;
        sim.alert('brigade', 'The Drovnian 3rd Rifle Brigade joins our forces.', c.x, c.z, 'good');
      } },
      { label: 'Turn them away', effect: 'Trust −3 · They may come back hungry', run: (sim) => { hitTrust(sim, 3); scheduleHorde(sim, { size: Math.round(12 * sim.diff.horde), siteId: crossingTo(sim, 'Drovno').siteId, lead: 30, label: 'Deserters turned' }); } },
    ],
  },
  {
    id: 'freshOnes', day: 8, modes: ['campaign'],
    title: 'Day 8: The Fresh Ones',
    text: () => 'Patrols report dead that RUN: the recently turned, fast for a few days before they stiffen. General Arkov wants more firepower at the crossings.',
    choices: [
      { label: 'Emergency arms purchase', effect: 'Funds −70 · Ammo +120', run: (sim) => { sim.state.res.funds -= 70; sim.state.res.ammo += 120; } },
      { label: 'Raise town militias', effect: 'Manpower +50 · Trust −3', run: (sim) => { sim.state.res.manpower += 50; hitTrust(sim, 3); } },
    ],
  },
  {
    id: 'panicBuying', day: 9, modes: ['campaign', 'sandbox'],
    title: 'Day 9: Panic Buying',
    text: () => 'Supermarkets have been stripped bare. Fights are breaking out at fuel stations.',
    choices: [
      { label: 'Troops to the stores', effect: 'Requires Curfew → enacts it free · Order +5 · Trust −3', run: (sim) => { if (!sim.hasLaw('curfew')) sim.state.laws.push('curfew'); sim.state.order += 5; hitTrust(sim, 3); } },
      { label: 'Let it burn out', effect: 'Food −40 · Order −6', run: (sim) => { sim.state.res.food = Math.max(0, sim.state.res.food - 40); sim.state.order -= 6; } },
    ],
  },
  {
    id: 'vitaxinFails', day: 11, modes: ['campaign'], when: (sim) => sim.state.flags.vitaxin,
    title: 'Day 11: Vitaxin Was Water',
    text: () => 'Vitaxin does nothing. Millions who took it stopped taking precautions. Halcyon Pharma\'s directors have left the country.',
    choices: [
      { label: 'Take responsibility', effect: 'Trust −18 · Hidden infections +50%', run: (sim) => { hitTrust(sim, 18); for (const t of sim.state.towns) t.infected *= 1.5; } },
      { label: 'Blame Halcyon', effect: 'Trust −8 · Authority −10 · Hidden infections +50%', run: (sim) => { hitTrust(sim, 8); sim.state.res.authority = Math.max(0, sim.state.res.authority - 10); for (const t of sim.state.towns) t.infected *= 1.5; } },
    ],
  },
  {
    id: 'showOfForce', day: 12, modes: ['campaign'],
    title: 'Day 12: A Show of Force',
    text: () => 'General Arkov wants a televised stand at the Kirsk crossing: the army against the next horde, live, to show the nation we can win. Cameras, armour, artillery: the works.',
    choices: [
      { label: 'Approve the broadcast', effect: 'A large horde hits Kirsk in 30 h · Break it losing ≤1 unit: Trust +15 · Lose more: Trust −20 · Stalemate: Trust −5', run: (sim) => {
        const c = crossingTo(sim, 'Kirsk');
        const h = scheduleHorde(sim, { size: Math.round(70 * sim.diff.horde), siteId: c.siteId, lead: 30, label: 'The televised battle' });
        sim.state.flags.showOfForce = { until: sim.state.time + 30 + 40, lost: sim.state.stats.unitsLost, horde: h ? h.id : 0 };
        sim.state.res.ammo += 60;
      } },
      { label: 'No cameras. No theatre.', effect: 'Authority +6 · Trust −3', run: (sim) => { sim.state.res.authority += 6; hitTrust(sim, 3); } },
    ],
  },
  {
    id: 'brutes', day: 13, modes: ['campaign'],
    title: 'Day 13: The Big Ones',
    text: () => 'Something new walked out of Ulmar: huge, swollen dead that tear through concrete. The Science Ministry wants a specimen.',
    choices: [
      { label: 'Fund the study', effect: 'Funds −50 · Research +35', run: (sim) => { sim.state.res.funds -= 50; sim.state.res.research += 35; } },
      { label: 'Just kill them', effect: 'Ammo +40 · Research nothing', run: (sim) => { sim.state.res.ammo += 40; } },
    ],
  },
  {
    id: 'citadel', day: 14, modes: ['campaign'],
    title: 'Day 14: Operation Citadel',
    text: () => 'The General Staff propose pulling back to defend the capital. Outer towns would be sealed under permanent quarantine and 40% of their people moved to Valdgrad. Those left behind will keep the dead busy.\n\nIt is cold arithmetic. It may also be correct.',
    choices: [
      { label: 'Execute Citadel', effect: 'Outer towns quarantined · Capital +pop · Manpower +80 · Trust −15', run: (sim) => {
        const cap = sim.map.towns.find((t) => t.capital);
        let moved = 0;
        for (const t of sim.state.towns) {
          if (t.status !== 'ok' || t.id === cap.id) continue;
          const m = t.pop * 0.4; t.pop -= m; moved += m; t.quarantine = true;
        }
        sim.state.towns[cap.id].pop += moved;
        sim.state.res.manpower += 80;
        hitTrust(sim, 15);
        sim.state.flags.citadel = true;
        sim.flowDirty = true;
      } },
      { label: 'We defend everyone', effect: 'Trust +5 · Authority −5', run: (sim) => { sim.state.trust += 5; sim.state.res.authority = Math.max(0, sim.state.res.authority - 5); } },
    ],
  },
  {
    id: 'fishermen', day: 16, modes: ['campaign'],
    title: 'Day 16: The Fishing Fleet',
    text: () => 'Tiravik\'s fishermen want to load their families on the boats and sail for the northern islands. Without them, the harbour stops feeding anyone.',
    choices: [
      { label: 'Let them sail', effect: 'Tiravik −15,000 people · Trust +4', run: (sim) => { const t = sim.state.towns[town(sim, 'Tiravik').id]; t.pop = Math.max(2500, t.pop - 15000); sim.state.trust += 4; } },
      { label: 'Requisition the boats', effect: 'Food +70 · Trust −6', run: (sim) => { sim.state.res.food += 70; hitTrust(sim, 6); } },
    ],
  },
  {
    id: 'greatHorde', day: 18, modes: ['campaign'],
    title: 'Day 18: The Great Horde',
    text: () => 'Satellite passes show a mass of the dead, tens of thousands strong, moving east out of Ulmar. At its pace it reaches our western river line tomorrow.',
    choices: [
      { label: 'Allied airstrike', effect: 'Funds −150 · The horde arrives at 60% strength', run: (sim) => { sim.state.res.funds -= 150; scheduleHorde(sim, { size: Math.round(260 * 0.6 * sim.diff.horde), siteId: sim.map.sites.find((s) => s.name === 'Ulmar').id, lead: 20, label: 'The Great Horde' }); } },
      { label: 'Brace for impact', effect: 'The full horde arrives tomorrow', run: (sim) => { scheduleHorde(sim, { size: Math.round(260 * sim.diff.horde), siteId: sim.map.sites.find((s) => s.name === 'Ulmar').id, lead: 20, label: 'The Great Horde' }); } },
    ],
  },
  {
    id: 'coastWatch', day: 20, modes: ['campaign'],
    title: 'Day 20: Bells Under the Water',
    text: () => 'Fishermen say they hear the church bells of drowned villages, and see shapes walking on the seabed toward our beaches.',
    choices: [
      { label: 'Fund a coastal watch', effect: 'Funds −80 · You see 6 tiles out to sea along the whole coast', run: (sim) => { sim.state.res.funds -= 80; sim.state.flags.coastWatch = true; sim.staticVis = null; } },
      { label: 'We can\'t afford to', effect: 'Nothing changes', run: () => {} },
    ],
  },
  {
    id: 'howlers', day: 22, modes: ['campaign'],
    title: 'Day 22: The Howlers',
    text: () => 'A new kind of dead screams when it sees the living, and everything within earshot comes running. Our marksmen think they can reach them first.',
    choices: [
      { label: 'Form sniper teams', effect: 'Two free Sniper Teams at HQ · Funds −30', run: (sim) => {
        sim.state.res.funds -= 30;
        const hq = sim.state.ents.buildings.find((b) => b.type === 'hq');
        if (hq) for (let k = 0; k < 2; k++) spawnUnit(sim, 'sniper', hq.x + k - 0.5, hq.z + 1.8);
      } },
      { label: 'Ear protectors and prayers', effect: 'Trust +2 · Research +15', run: (sim) => { sim.state.trust += 2; sim.state.res.research += 15; } },
    ],
  },
  {
    id: 'lastBroadcast', day: 25, modes: ['campaign', 'sandbox'],
    title: 'Day 25: Last Broadcast',
    text: () => 'The last international news service has gone dark. As far as we can tell, we are one of the few governments still standing.',
    choices: [
      { label: 'Address the nation', effect: 'Trust +10 · Authority −5', run: (sim) => { sim.state.trust += 10; sim.state.res.authority = Math.max(0, sim.state.res.authority - 5); } },
      { label: 'Say nothing', effect: 'Research +20 · Trust −2', run: (sim) => { sim.state.res.research += 20; hitTrust(sim, 2); } },
    ],
  },
  {
    id: 'steelStrike', day: 28, modes: ['campaign'], when: (sim) => sim.state.towns[town(sim, 'Kessel').id].status === 'ok',
    title: 'Day 28: Strike at the Steelworks',
    text: () => 'Kessel\'s steelworkers have downed tools. Twelve-hour shifts, no protection, and a foreman who was bitten and hid it.',
    choices: [
      { label: 'Meet their demands', effect: 'Funds −80 · Trust +5', run: (sim) => { sim.state.res.funds -= 80; sim.state.trust += 5; } },
      { label: 'Break the strike', effect: 'Order +5 · Trust −8', run: (sim) => { sim.state.order += 5; hitTrust(sim, 8); } },
    ],
  },
  {
    id: 'turningTide', day: 35, modes: ['campaign'],
    title: 'Day 35: Turning the Tide',
    text: () => 'For the first time in a month, the dead at our borders are fewer than the day before. The General Staff ask: do we dig in, or start taking our country back?',
    choices: [
      { label: 'Take it back', effect: 'Authority +20 · Field Doctrine researched · Reclaim fallen towns', run: (sim) => {
        sim.state.res.authority += 20;
        for (const id of ['k1', 'k2']) if (!sim.hasTech(id)) sim.state.research.done.push(id);
      } },
      { label: 'Hold what we have', effect: 'Trust +6 · Food +60', run: (sim) => { sim.state.trust += 6; sim.state.res.food += 60; } },
    ],
  },
  {
    id: 'survivors', day: 40, modes: ['campaign'],
    title: 'Day 40: Voices from Drovno',
    text: () => 'A ham radio operator in Drovno has kept forty people alive in a school gymnasium. They can walk to our border if we keep the way open.',
    choices: [
      { label: 'Bring them home', effect: '5 groups walk to the Osterby crossing (they must be let in) · Trust +8 on arrival', run: (sim) => {
        const c = crossingTo(sim, 'Drovno');
        for (let k = 0; k < 5; k++) { const r = spawnRefugee(sim, c.siteId); r.infected = false; r.vip = true; }
        sim.state.flags.survivors = true;
      } },
      { label: 'We can\'t risk it', effect: 'Trust −6', run: (sim) => hitTrust(sim, 6) },
    ],
  },
  {
    id: 'lastPush', day: 46, modes: ['campaign'],
    title: 'Day 46: The Last Push',
    text: () => 'Every horde left on the continent seems to be turning toward the last lights still on: ours. Three columns. They arrive in two days.',
    choices: [
      { label: 'Every town holds', effect: 'Trust +5 · Three hordes on Day 48', run: (sim) => { sim.state.trust += 5; lastPush(sim); } },
      { label: 'Pull the outer towns back', effect: '30% of outer populations move to the capital · Trust −6 · Three hordes on Day 48', run: (sim) => {
        const cap = sim.map.towns.find((t) => t.capital);
        for (const t of sim.state.towns) if (t.status === 'ok' && t.id !== cap.id) { const m = t.pop * 0.3; t.pop -= m; sim.state.towns[cap.id].pop += m; }
        hitTrust(sim, 6);
        lastPush(sim);
      } },
    ],
  },
];

// Three fronts at once, named so a new site in the list cannot pull them onto one side: north-west, north-east, south.
function lastPush(sim) {
  const picks = ['Drovno', 'Vesk', 'Peshta'].map((name) => sim.map.sites.find((s) => s.name === name));
  for (const s of picks) scheduleHorde(sim, { size: Math.round(140 * sim.diff.horde), siteId: s.id, lead: 44, label: 'The Last Push' });
}

export const DECISION_BY_ID = Object.fromEntries(DECISIONS.map((d) => [d.id, d]));

// Endings are judged from the record, never from a morality score.
export const ENDINGS = [
  { id: 'lighthouse', title: 'The Lighthouse', test: (r) => r.won && r.trust >= 55 && r.towns >= 5, text: 'Valdmark came through with its towns standing and its people still believing in the government that led them. When the world finally starts calling again, it is our lights they see.' },
  { id: 'iron', title: 'The Iron Republic', test: (r) => r.won && r.order >= 60 && r.trust < 40, text: 'Valdmark survives: ordered, fenced and silent. The checkpoints never came down. Children growing up behind the walls have never known anything else.' },
  { id: 'fortress', title: 'The Fortress', test: (r) => r.won && r.towns <= 2, text: 'Valdgrad stands, a walled island in a dead country. Everyone left lives within sight of the capital\'s towers.' },
  { id: 'endured', title: 'The Line Held', test: (r) => r.won, text: 'It cost more than anyone will admit, but on the fiftieth morning the line still held.' },
  { id: 'capital', title: 'Valdgrad Has Fallen', test: (r) => r.reason === 'capital', text: 'The capital went dark at night. By morning, the dead walked the ministry corridors.' },
  { id: 'trust', title: 'The Government Is Removed', test: (r) => r.reason === 'trust', text: 'Nobody believed us any more. Parliament met in a cellar and voted the government out. Whoever leads now inherits what we left.' },
  { id: 'order', title: 'Collapse', test: (r) => r.reason === 'order', text: 'Orders stopped being followed. Towns barricaded themselves against the army as much as against the dead.' },
];

export function scoreOf(record) {
  return Math.round(
    record.days * 100 + record.popSaved / 1000 + record.towns * 1500 + record.admitted * 40 + record.killed * 2 +
    record.reclaimed * 2000 - record.shot * 30 - record.promisesBroken * 300 + (record.won ? 5000 : 0),
  );
}
