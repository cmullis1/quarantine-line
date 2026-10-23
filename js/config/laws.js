// Laws: permanent once passed. Five chains of three; each needs the previous link.
// Effects are read by systems through `hasLaw`; `once` applies immediately when passed; `drift` is the
// law's standing trust/order change per hour (read by the economy). `pros` / `cons` describe everything
// else; lawEffects() adds the `once` and `drift` numbers so the card can never disagree with the sim.

export const CHAINS = [
  { id: 'order', label: 'Public Order' },
  { id: 'health', label: 'Health' },
  { id: 'info', label: 'Information' },
  { id: 'econ', label: 'Economy' },
  { id: 'defence', label: 'Defence' },
];

export const LAWS = [
  { id: 'curfew', chain: 'order', tier: 1, name: 'Curfew', cost: 8, day: 1,
    pros: ['Infection spreads 15% slower'], cons: [],
    once: { order: 10 }, drift: { trust: -0.02, order: 0.03 } },
  { id: 'martial', chain: 'order', tier: 2, name: 'Martial Law', cost: 15, day: 5,
    pros: ['Manpower ×1.6', 'Spread −10%', 'Police twice as effective'], cons: [], drift: { trust: -0.035, order: 0.06 } },
  { id: 'mobilisation', chain: 'order', tier: 3, name: 'Total Mobilisation', cost: 25, day: 15,
    pros: ['Manpower ×2.5 (replaces Martial Law bonus)', 'Training 30% faster'], cons: ['Town taxes −25%'], drift: { trust: -0.04 } },

  { id: 'testing', chain: 'health', tier: 1, name: 'Mandatory Testing', cost: 8, day: 1,
    pros: ['Detection +15% everywhere'], cons: [], once: { trust: -5 } },
  { id: 'detention', chain: 'health', tier: 2, name: 'Detention of the Infected', cost: 15, day: 6,
    pros: ['Containment ×1.5'], cons: [], drift: { trust: -0.04, order: 0.02 } },
  { id: 'mercy', chain: 'health', tier: 3, name: 'Mercy Protocol', cost: 25, day: 12,
    pros: ['The killed no longer rise', 'Town spread −25%'], cons: [], once: { trust: -15 }, drift: { trust: -0.03 } },

  { id: 'broadcasts', chain: 'info', tier: 1, name: 'Emergency Broadcasts', cost: 6, day: 1,
    pros: ['Authority +0.1/h'], cons: ['Funds −0.2/h'], drift: { trust: 0.02 } },
  { id: 'managed', chain: 'info', tier: 2, name: 'Managed News', cost: 12, day: 4,
    pros: ['Trust losses from events ×0.6, slow drift ×0.8'], cons: ['3% daily chance of a scandal (trust −15)'] },
  { id: 'censorship', chain: 'info', tier: 3, name: 'Total Censorship', cost: 20, day: 10,
    pros: ['Trust losses from events ×0.3, slow drift ×0.5'], cons: ['Your own case reports become unreliable (±60%, 24 h late)'], drift: { order: 0.03 } },

  { id: 'rationing', chain: 'econ', tier: 1, name: 'Rationing', cost: 8, day: 1,
    pros: ['Food use −30%'], cons: [], drift: { trust: -0.02 } },
  { id: 'wareconomy', chain: 'econ', tier: 2, name: 'War Economy', cost: 15, day: 7,
    pros: ['Factories and Munitions ×1.5'], cons: ['Town taxes −20%'] },
  { id: 'labour', chain: 'econ', tier: 3, name: 'Refugee Labour', cost: 20, day: 10,
    pros: ['Each admitted refugee group gives +6 manpower and +2 food'], cons: [], drift: { trust: -0.03 } },

  { id: 'security', chain: 'defence', tier: 1, name: 'Border Security Act', cost: 10, day: 3,
    pros: ['Unlocks the SHOOT ON SIGHT border stance', 'Checkpoints screen 50% faster'], cons: [], once: { trust: -4 } },
  { id: 'sacrifice', chain: 'defence', tier: 2, name: 'Sacrifice Zones', cost: 25, day: 14,
    pros: ['Designate a town as bait: the dead go there first'], cons: ['Each designation: trust −20, the town pays no taxes'] },
  { id: 'scorched', chain: 'defence', tier: 3, name: 'Scorched Earth', cost: 25, day: 18,
    pros: ['Sterilise and airstrikes cost half', 'Fallen towns leave 50% fewer dead'], cons: [], once: { trust: -10 } },
];

export const LAW_BY_ID = Object.fromEntries(LAWS.map((l) => [l.id, l]));

const signed = (v) => `${v > 0 ? '+' : '−'}${+Math.abs(v).toFixed(3)}`;

// The full pros and cons for a law card. Trust losses are shown as this difficulty applies them.
export function lawEffects(law, politics = 1) {
  const pros = [...law.pros], cons = [...law.cons];
  const line = (label, v, suffix, scale) => {
    if (!v) return;
    let x = v < 0 && scale ? v * politics : v;
    if (suffix === ' now') x = Math.round(x);
    (x > 0 ? pros : cons).push(`${label} ${signed(x)}${suffix}`);
  };
  line('Order', law.once?.order, ' now', false);
  line('Trust', law.once?.trust, ' now', true);
  line('Order', law.drift?.order, '/h', false);
  line('Trust', law.drift?.trust, '/h', true);
  return { pros, cons };
}

export function lawPrereq(id) {
  const l = LAW_BY_ID[id];
  if (!l || l.tier === 1) return null;
  return LAWS.find((x) => x.chain === l.chain && x.tier === l.tier - 1).id;
}

export const BORDER_STANCES = {
  open: { label: 'OPEN', desc: 'Everyone walks in. More people and manpower, and some of them are infected. Trust +.' },
  screened: { label: 'SCREENED', desc: 'Only crossings with a built Checkpoint admit refugees, after screening. Groups left waiting where there is none give up, and that costs trust.' },
  closed: { label: 'CLOSED', desc: 'Crowds wait outside, then give up. The infected turn where they stand. Every group turned away costs trust.' },
  shoot: { label: 'SHOOT', desc: 'Troops fire on anyone at the border. Nothing gets in. Trust collapses.', law: 'security' },
};
