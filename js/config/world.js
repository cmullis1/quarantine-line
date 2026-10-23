// World content: campaign geography, town specialties, foreign sites.

export const TER = { LAND: 0, SEA: 1, MOUNTAIN: 2, RIVER: 3, LAKE: 4 };

// Town specialties: output per hour at full population, scaled by pop / pop0.
// Stops while the town is quarantined, evacuating to empty, fallen or scorched.
export const SPECIALTIES = {
  capital: { label: 'Ministries', icon: '🏛️', produce: { authority: 0.15 }, desc: 'Seat of government: +0.15 authority/h.' },
  port: { label: 'Harbour', icon: '⚓', produce: { food: 0.8 }, desc: 'Fishing fleet: +0.8 food/h. Foreign aid arrives here.' },
  industry: { label: 'Steelworks', icon: '🏭', produce: { funds: 1.2, ammo: 0.8 }, desc: '+1.2 funds/h, +0.8 ammo/h.' },
  farmland: { label: 'Grain Co-op', icon: '🌾', produce: { food: 0.6 }, desc: '+0.6 food/h.' },
  university: { label: 'University', icon: '🎓', produce: { research: 0.6 }, desc: '+0.6 research/h.' },
  railyard: { label: 'Rail Yard', icon: '🚂', produce: {}, trainBonus: 0.25, radius: 20, desc: 'Units trained within 20 tiles train 25% faster.' },
  market: { label: 'Market Hall', icon: '🏪', produce: { funds: 1 }, desc: '+1 funds/h.' },
  mine: { label: 'Mine', icon: '⛏️', produce: { ammo: 0.6, funds: 0.4 }, desc: '+0.6 ammo/h, +0.4 funds/h.' },
};

// The country was first drawn on a 112² map about (56, 58). On the 144² map it is 1.2× larger about `center`:
// towns sit at 72 + (i − 56) × 1.2, 74 + (j − 58) × 1.2 (rounded), and foreign cities lie out along the same rays,
// 4 tiles inside the map edge, so the dead walk a long way through foreign land to the border.
export const CAMPAIGN = {
  seed: 1931,
  center: [72, 74],
  towns: [
    { name: 'Valdgrad', i: 72, j: 72, r: 4.6, pop: 640000, capital: true, specialty: 'capital' },
    { name: 'Osterby', i: 53, j: 50, r: 3, pop: 150000, specialty: 'farmland' },
    { name: 'Kessel', i: 90, j: 48, r: 3, pop: 130000, specialty: 'industry' },
    { name: 'Marnow', i: 29, j: 74, r: 3, pop: 110000, specialty: 'farmland' },
    { name: 'Tiravik', i: 103, j: 78, r: 3, pop: 170000, specialty: 'port' },
    { name: 'Hollin', i: 65, j: 105, r: 2.8, pop: 80000, specialty: 'market' },
    { name: 'Brask', i: 94, j: 99, r: 2.8, pop: 90000, specialty: 'railyard' },
    { name: 'Lenz', i: 49, j: 88, r: 2.5, pop: 60000, specialty: 'university' },
    // Placed by rule on the scaled map, then fixed here: the owned land tile nearest (72, 106) at least 14 from every
    // town and 6 from foreign land; and nearest (70, 44) at least 14 from every town and 5 from the mountains.
    { name: 'Sorrel', i: 79, j: 105, r: 2.8, pop: 100000, specialty: 'farmland' },
    { name: 'Harn', i: 70, j: 44, r: 2.6, pop: 70000, specialty: 'mine' },
  ],
  sites: [
    { name: 'Drovno', i: 4, j: 5, town: 'Osterby' },
    { name: 'Kirsk', i: 80, j: 4, town: 'Kessel' },
    { name: 'Vesk', i: 135, j: 4, town: 'Kessel' },
    { name: 'Ulmar', i: 4, j: 98, town: 'Marnow' },
    { name: 'Peshta', i: 59, j: 139, town: 'Hollin' },
    // On the ray from the centre through Sorrel turned 35° west, at the edge.
    { name: 'Orsk', i: 106, j: 139, town: 'Sorrel' },
  ],
  // Internal road network (town names). Site roads are added from `sites`.
  roads: [
    ['Valdgrad', 'Osterby'], ['Valdgrad', 'Kessel'], ['Valdgrad', 'Tiravik'], ['Valdgrad', 'Hollin'],
    ['Valdgrad', 'Brask'], ['Valdgrad', 'Lenz'], ['Valdgrad', 'Marnow'], ['Osterby', 'Kessel'],
    ['Lenz', 'Marnow'], ['Lenz', 'Hollin'], ['Hollin', 'Brask'], ['Brask', 'Tiravik'], ['Tiravik', 'Kessel'],
    ['Sorrel', 'Hollin'], ['Sorrel', 'Brask'], ['Harn', 'Osterby'], ['Harn', 'Valdgrad'],
  ],
};

export const SANDBOX_TOWN_NAMES = [
  'Arvik', 'Belmont', 'Corran', 'Dunhal', 'Esker', 'Fennick', 'Galt', 'Harrow', 'Isel', 'Jarnby',
  'Korvel', 'Lisk', 'Morrow', 'Nessa', 'Orland', 'Pell', 'Quarry', 'Rook', 'Stave', 'Tolben',
];
export const SANDBOX_SITE_NAMES = ['Varn', 'Holt', 'Sedra', 'Mirov', 'Castel', 'Oberg', 'Tamsk', 'Lyr'];
export const SANDBOX_SPECIALTIES = ['farmland', 'industry', 'university', 'railyard', 'market', 'farmland', 'mine'];
