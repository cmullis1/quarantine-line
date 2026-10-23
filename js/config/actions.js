// Government actions (map-targeted or global) and town actions. Cooldowns in game hours.

export const ACTIONS = {
  recon: {
    name: 'Recon Flight', icon: '🛩️', key: 'F1', target: 'map', cost: { authority: 5 }, cooldown: 12,
    desc: 'Reveal a 12-tile radius for a day. Shows what is coming.',
  },
  airstrike: {
    name: 'Airstrike', icon: '🔥', key: 'F2', target: 'map', cost: { authority: 12, funds: 40, ammo: 4 }, cooldown: 8,
    requires: 'helipad', delay: 1, radius: 3, dmg: 220, structDmg: 80, noise: 22,
    desc: 'Napalm a 3-tile radius after 1 h. Kills almost everything there, including your own.',
  },
  broadcast: {
    name: 'Emergency Broadcast', icon: '📻', key: 'F3', target: 'none', cost: { authority: 10 }, cooldown: 48,
    trust: 6, order: 3,
    desc: 'The President addresses the nation. Trust +6, order +3.',
  },
  conscription: {
    name: 'Conscription Drive', icon: '📋', key: 'F4', target: 'none', cost: { authority: 12 }, cooldown: 72,
    manpower: 60, trust: -6,
    desc: 'Call up the reserves. Manpower +60, trust −6.',
  },
};

export const TOWN_ACTIONS = {
  quarantine: { name: 'Quarantine', desc: 'Spread −65% and travel −85%. Income −65%, trust drains slowly.' },
  evacuate: { name: 'Evacuate', cost: { funds: 40 }, cooldown: 24, buses: 4, perBus: 2500,
    desc: 'Four buses carry people to the capital. Buses can be caught on the road.' },
  sterilise: { name: 'Sterilise', cost: { authority: 30 }, survivors: 0.3, trust: -25, order: 5,
    desc: 'Napalm the town. Every dead thing and every case inside dies, and most of the people. 30% are pulled out first.' },
  reclaim: { name: 'Reclaim', desc: 'Hold a fallen town with troops and no dead nearby for 12 h. People slowly return.' },
  sacrifice: { name: 'Sacrifice Zone', law: 'sacrifice', trust: -20,
    desc: 'The dead will be drawn here first. The town pays no taxes. Its people are not told.' },
};
