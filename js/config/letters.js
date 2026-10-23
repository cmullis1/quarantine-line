// Random letters: minor, non-blocking decisions. They sit in the side stack and resolve to their
// default choice if ignored for a day. `when(sim)` gates availability; `params(sim)` returns plain data
// (saved with the letter) that `text`, `effect` and `run` receive as their second argument.
import { hitTrust } from '../sim/systems/economy.js';
import { spawnUnit } from '../sim/entities.js';

const livingTown = (sim, filter = () => true) => {
  const list = sim.state.towns.filter((t) => t.status === 'ok' && filter(t));
  return list.length ? sim.map.towns[sim.pick(list).id] : null;
};

export const LETTERS = [
  {
    id: 'aid', title: 'Foreign Aid Ship',
    when: (sim) => sim.map.towns.some((t) => t.specialty === 'port' && sim.state.towns[t.id].status === 'ok') && sim.state.worldInf < 80,
    text: () => 'A freighter flying an allied flag has docked with medicine, flour and cash.',
    choices: [{ label: 'Unload it', effect: 'Funds +80 · Food +50', run: (sim) => { sim.state.res.funds += 80; sim.state.res.food += 50; } }],
  },
  {
    id: 'deserters', title: 'Deserters',
    text: () => 'Soldiers are slipping away from their units to find their families.',
    default: 1,
    choices: [
      { label: 'Make an example', effect: 'Manpower −10 · Trust −5 · Order +3', run: (sim) => { sim.state.res.manpower = Math.max(0, sim.state.res.manpower - 10); hitTrust(sim, 5); sim.state.order += 3; } },
      { label: 'Let them go', effect: 'Manpower −30', run: (sim) => { sim.state.res.manpower = Math.max(0, sim.state.res.manpower - 30); } },
    ],
  },
  {
    id: 'riot', title: 'Riot',
    params: (sim) => { const t = livingTown(sim); return t ? { town: t.id } : null; },
    text: (sim, p) => `A crowd in ${sim.map.towns[p.town].name.toUpperCase()} is storming the town hall, demanding to be let out of the country.`,
    default: 1,
    choices: [
      { label: 'Send riot police', effect: 'Funds −20 · Order +2', run: (sim) => { sim.state.res.funds -= 20; sim.state.order += 2; } },
      { label: 'Let it run its course', effect: (sim, p) => `Order −6 · Infection risk in ${sim.map.towns[p.town].name}`, run: (sim, p) => { sim.state.order -= 6; sim.state.towns[p.town].infected += 15; } },
    ],
  },
  {
    id: 'cure', title: 'Miracle Cure Rumour',
    text: () => 'Social media claims raw garlic and bleach cure the infection. People are poisoning themselves.',
    default: 1,
    choices: [
      { label: 'Debunk it publicly', effect: 'Trust −2 · Research +10', run: (sim) => { hitTrust(sim, 2); sim.state.res.research += 10; } },
      { label: 'Leave it', effect: 'Trust +3 · Food −10', run: (sim) => { sim.state.trust += 3; sim.state.res.food = Math.max(0, sim.state.res.food - 10); } },
    ],
  },
  {
    id: 'ambush', title: 'Convoy Ambushed',
    text: () => 'A supply convoy was overrun on a back road. The drivers did not make it.',
    choices: [{ label: 'Understood', effect: 'Food −25 · Ammo −20', run: (sim) => { sim.state.res.food = Math.max(0, sim.state.res.food - 25); sim.state.res.ammo = Math.max(0, sim.state.res.ammo - 20); } }],
  },
  {
    id: 'blackMarket', title: 'Black Market Arms',
    text: () => 'A man with a southern accent and no surname offers crates of rifle ammunition, cash only, no questions.',
    default: 1,
    choices: [
      { label: 'Buy', effect: 'Funds −50 · Ammo +90 · Order −2', run: (sim) => { sim.state.res.funds -= 50; sim.state.res.ammo += 90; sim.state.order -= 2; } },
      { label: 'Arrest him', effect: 'Order +2', run: (sim) => { sim.state.order += 2; } },
    ],
  },
  {
    id: 'volunteers', title: 'Volunteer Brigade', when: (sim) => sim.state.trust >= 55,
    text: () => 'Retired soldiers and hunters have formed a volunteer brigade and ask for a sector to hold.',
    choices: [{ label: 'Welcome them', effect: '+1 Infantry Squad · Food −10', run: (sim) => {
      sim.state.res.food = Math.max(0, sim.state.res.food - 10);
      const hq = sim.state.ents.buildings.find((b) => b.type === 'hq');
      if (hq) spawnUnit(sim, 'infantry', hq.x, hq.z + 1.8);
    } }],
  },
  {
    id: 'press', title: 'Foreign Journalists',
    text: () => 'Two journalists want to film our border defences for the outside world.',
    default: 1,
    choices: [
      { label: 'Give them access', effect: 'Trust +4, or −6 if any town is in outbreak', run: (sim) => { if (sim.state.towns.some((t) => t.alerted)) hitTrust(sim, 6); else sim.state.trust += 4; } },
      { label: 'Deny access', effect: 'Authority +2', run: (sim) => { sim.state.res.authority += 2; } },
    ],
  },
  {
    id: 'farmers', title: 'Farmers\' Petition', when: (sim) => sim.hasLaw('rationing'),
    text: () => 'Farmers say rationing quotas are taking the seed grain they need for next season.',
    default: 1,
    choices: [
      { label: 'Exempt the seed grain', effect: 'Food −30 · Trust +3', run: (sim) => { sim.state.res.food = Math.max(0, sim.state.res.food - 30); sim.state.trust += 3; } },
      { label: 'Quotas stand', effect: 'Trust −3', run: (sim) => hitTrust(sim, 3) },
    ],
  },
  {
    id: 'defector', title: 'A Scientist Crosses Over',
    text: () => 'A virologist from a fallen neighbour has reached a checkpoint with a laptop full of autopsy data.',
    choices: [{ label: 'Bring her in', effect: 'Research +40', run: (sim) => { sim.state.res.research += 40; } }],
  },
  {
    id: 'faith', title: 'The Congregation of the Last Days',
    text: () => 'A preacher draws thousands to open-air services, saying the dead are a judgement. Crowds mean contact.',
    default: 0,
    choices: [
      { label: 'Ban gatherings', effect: 'Order +3 · Trust −4', run: (sim) => { sim.state.order += 3; hitTrust(sim, 4); } },
      { label: 'Let them pray', effect: 'Trust +3 · Infection risk in the capital', run: (sim) => { sim.state.trust += 3; const cap = sim.map.towns.find((t) => t.capital); sim.state.towns[cap.id].infected += 10; } },
    ],
  },
  {
    id: 'blackout', title: 'Power Station Fire',
    text: () => 'A fire at the Lenz substation has cut power to half the country for the night.',
    choices: [{ label: 'Repair crews out', effect: 'Funds −30 · Research −10', run: (sim) => { sim.state.res.funds -= 30; sim.state.res.research = Math.max(0, sim.state.res.research - 10); } }],
  },
  {
    id: 'hoarders', title: 'Hoarders Exposed',
    params: (sim) => { const t = livingTown(sim, (x) => !sim.map.towns[x.id].capital); return t ? { town: t.id } : null; },
    text: (sim, p) => `Police in ${sim.map.towns[p.town].name} found a warehouse of food hoarded by a supermarket chain.`,
    choices: [
      { label: 'Seize it', effect: 'Food +60 · Funds −10', run: (sim) => { sim.state.res.food += 60; sim.state.res.funds -= 10; } },
      { label: 'Fine them', effect: 'Funds +60', run: (sim) => { sim.state.res.funds += 60; } },
    ],
  },
  {
    id: 'mutiny', title: 'Mutiny at the Border', when: (sim) => sim.state.border === 'shoot',
    text: () => 'A platoon at the border refused orders to fire on a crowd of families. Their lieutenant is under arrest.',
    default: 1,
    choices: [
      { label: 'Court-martial them', effect: 'Order +4 · Trust −6', run: (sim) => { sim.state.order += 4; hitTrust(sim, 6); } },
      { label: 'Quietly reassign them', effect: 'Authority −6', run: (sim) => { sim.state.res.authority = Math.max(0, sim.state.res.authority - 6); } },
    ],
  },
  {
    id: 'orphans', title: 'The Orphanage', when: (sim) => sim.state.stats.townsLost > 0,
    text: () => 'Hundreds of children orphaned by the fallen towns are sleeping in a gymnasium in the capital.',
    choices: [
      { label: 'Fund proper homes', effect: 'Funds −40 · Trust +5', run: (sim) => { sim.state.res.funds -= 40; sim.state.trust += 5; } },
      { label: 'They have a roof', effect: 'Trust −2', run: (sim) => hitTrust(sim, 2) },
    ],
  },
];

export const LETTER_BY_ID = Object.fromEntries(LETTERS.map((l) => [l.id, l]));
