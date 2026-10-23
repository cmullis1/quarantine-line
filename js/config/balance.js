// Every tunable number in the game. Rates are per game hour unless noted.

export const MAP_SIZE = 144;
export const REAL_SECONDS_PER_DAY = 36;
export const HOURS_PER_DAY = 24;
export const SIM_STEP_HOURS = 0.05;
export const WIN_DAY = 50;
export const MAX_DEAD = 1400;

export const START = {
  hour: 7,
  res: { funds: 300, food: 150, ammo: 220, manpower: 80, authority: 20, research: 0 },
  trust: 60,
  order: 60,
};

// firstHorde: hours from the start to the first horde's rumour. relaxHours: the guaranteed calm after a peak.
// spacing: multiplies the time between hordes. peakPace: how fast the horde clock and the trickle run during a fight
// (1 = as in build; 0 = a fight holds them, so peaks never chain).
export const DIFFICULTY = {
  recruit: { horde: 0.7, spread: 0.75, income: 1.2, refugeeInfected: 0.7, deadHp: 0.85, politics: 0.75, firstHorde: 120, relaxHours: 36, spacing: 1.6, peakPace: 0, label: 'Recruit' },
  veteran: { horde: 1.7, spread: 1, income: 0.95, refugeeInfected: 1, deadHp: 1.15, politics: 1, firstHorde: 84, relaxHours: 20, spacing: 1.2, peakPace: 0.25, label: 'Veteran' },
  nightmare: { horde: 2.0, spread: 1.25, income: 0.85, refugeeInfected: 1.3, deadHp: 1.3, politics: 1.25, firstHorde: 62, relaxHours: 8, spacing: 1.0, peakPace: 0.5, label: 'Nightmare' },
};
// Why (PC1b, B14): with the quiet spells every style won Veteran 12/12 and the expert Nightmare 12/12, so the fights
// got harder instead of the calm shorter.
//   veteran horde 1.7, deadHp 1.15: bigger, tougher hordes (they alone still left the balanced bot 11/12);
//   veteran income 0.95: the last step to balanced 9/12 (0.9 dropped it to 6/12), quiet kept at 20.8%;
//   nightmare horde 2.0, deadHp 1.3: expert 4/12, balanced 0/12, quiet 9.2%. Its dead now reach the MAX_DEAD cap,
//   so a bigger Nightmare horde changes little: tune it with deadHp or politics from here on.

// The pacing director (world.js): build → peak (a fight) → relax (guaranteed calm) → build.
export const PACE = {
  peakDead: 8,               // dead inside the border that make a peak
  calmDead: 3,               // a peak ends at or below this many inside (and no horde in contact or crossed)
  disperse: 0.15,            // a fully spawned horde with this share of its dead left breaks up into stragglers
  strayHours: 6,             // unseen this long, a straggler outside the border turns back toward its site in relax
  strayRelax: 12,            // ...and is gone once unseen this long during relax
  strayGone: 36,             // ...or this long at any other time
  cardHold: 12,              // most hours a non-urgent card waits for a peak to end
  cardGap: 6,                // fewest hours between two new cards
};

export const ECONOMY = {
  taxPer100k: 0.22,          // funds/h per 100k people, scaled by trust factor
  trustTaxBase: 0.5,         // income factor = base + trust/100
  quarantineIncome: 0.35,
  hqFunds: 1,
  foodPerMillion: 2.4,
  foodPerUnit: 0.1,
  foodPerCampGroup: 0.02,
  manpowerPerMillion: 0.5,
  authorityBase: 0.22,
  authorityPerTrust: 0.002,  // extra authority/h per trust point
  farmlandBonus: 0.5,
  workersPer100k: 1.5,       // staff the towns can spare for farms, factories, plants and labs
  starvationDeathsPer100k: 40, // people/h per 100k when food is 0
  shortageTrust: 0.25,
  shortageOrder: 0.3,
  unpaidOrder: 0.25,
  highTrustManpower: 1.25,   // trust >= 70
  highOrderProduction: 1.1,  // order >= 70
};

export const SPREAD = {
  growth: 0.03,              // logistic growth rate of hidden cases
  quarantine: 0.35,
  curfew: 0.85,
  deathRate: 0.01,           // infected that die per hour
  breakout: 300,             // cases at which the sick turn in the streets
  breakoutRateCap: 4,        // visible dead per hour per town
  breakoutPer: 400,          // cases per spawn-per-hour
  spawnCost: 60,             // cases (and people) consumed per spawned dead
  fallFraction: 0.25,
  minPop: 2000,
  deadInTownBites: 4,        // cases/h each dead adds in a living town
  deadInTownKills: 4,
  travel: 0.0035,            // inter-town seeding factor
  quarantineTravel: 0.15,
  lowOrderTravel: 2,         // order < 30 multiplies travel (people flee)
  reportDelay: 12,           // hours
  detectBase: 0.3,
  detectPublic: 0.1,
  detectSuppressed: -0.15,
  detectHazmat: 0.45,
  detectHospital: 0.2,
  detectLowTrust: -0.2,      // trust < 30
  detectHighTrust: 0.1,      // trust >= 70
  outbreakReported: 5,       // reported cases that make an outbreak public
  residualBase: 20,
  residualPerPop: 1 / 6000,
  residualRate: 1.2,         // spawns per hour from a fallen town
  reclaimHours: 12,
  resettleRate: 0.01,        // of original pop per day
};

export const REFUGEES = {
  startHour: 30,
  baseRate: 0.6,
  ratePerWorldInf: 0.05,
  rateCap: 4,
  infectedBase: 0.08,
  infectedPerWorldInf: 0.004,
  infectedCap: 0.45,
  incubation: [10, 36],
  groupSize: 300,
  manpowerPerGroup: 1.5,
  infectedSeed: 25,
  screenHours: 0.8,
  screenDetect: 0.6,
  screenDetectResearch: 0.92,
  screenFood: 0.3,
  waitScreened: 36,
  waitClosed: 20,
  waitBlocked: 30,
  turnAwayTrust: 0.03,       // trust per group that waits at the border and leaves without being let in
  shootTrust: 0.3,           // trust per group shot (softens as the nation grows numb: ÷ 1 + shot/30)
  shootOrder: 0.1,
  campHours: 48,
  campCapacity: 40,
  queueUnrest: 0.004,        // order/h per queued group beyond 6
  openTrustPerGroup: 0.05,
};

export const WORLD = {
  infStart: 0.6,
  infGrowth: 0.26,           // per day, exponential
  trickleStart: 60,
  trickleBase: 0.15,
  trickleWorld: 0.012,
  trickleCap: 1.2,
};

export const HORDE = {
  sizeBase: 8,
  sizePerDay: 2.0,
  sizePerWorldInf: 0.25,
  sizeCap: 180,
  interval: [30, 46],
  intervalDecay: 0.015,      // per day, floored at 60%
  seaFromDay: 19,
  seaChance: 0.25,
  spawnPerHour: 12,
  rumourLead: 6,             // hours between rumour and first spawn
};

export const COMBAT = {
  hitChance: 0.8,
  meleeFraction: 0.25,
  meleeRange: 0.8,
  fieldDoctrineMelee: 0.6,
  fieldDoctrineRange: 1.2,
  nightRange: 0.7,
  nightAggro: 1.3,
  deadAggro: 3.5,
  deadReach: { unit: 0.5, apc: 0.6, refugee: 0.32, bus: 0.6 },
  apcArmor: 0.35,
  vetKills: [10, 30],
  vetBonus: [1, 1.2, 1.4],
  riseChance: 0.5,
  depotAmmo: 0.5,
  healDepot: 15,
  healHospital: 25,
  repairRate: 40,
  engineerBuildMult: 2.5,
  engineerRadius: 4,
};

// Weather: deterministic per day from the seed. Rain mutes noise and shortens sight; morning fog blinds.
export const WEATHER = {
  rainChance: 0.25, rainHours: [4, 14],
  fogChance: 0.3, fogStart: 4, fogEnd: 9.5,
  rainRange: 0.85, rainVision: 0.75, rainNoise: 0.7, rainDeadSpeed: 0.9,
  fogRange: 0.6, fogVision: 0.5,
};

export const NOISE = {
  investigateHours: 6,
};

export const PILEUP = {
  wall: 10,
  highWall: 22,
  spillHours: 0.4,
  pressRange: 2.6,        // stalled dead this close behind a pressing wall count toward its pile
};

export const POLITICS = {
  baseTrust: 0.03,
  outbreakTrust: 0.06,
  quarantineTrust: 0.015,
  fallenTrust: 12,
  containedTrust: 1,
  baseOrder: 0.02,
  lowTrustOrder: 0.04,       // order/h lost while trust < 30
  policeOrder: 0.06,
  troopsInTownOrder: 0.01,
  lowOrderLoot: 0.5,         // food/h lost while order < 30
  fearPerAct: 0.015,         // order/h lost per act after the first (the country is frightened)
  fearPerDead: 0.0008,       // order/h per dead thing inside the country
  fearCap: 0.25,
  safetyTrust: 0.05,         // trust/h while no town is in outbreak and no dead are inside the country
  orderShield: 0.6,          // negative trust drift × this while order >= 70 (fear keeps people in line)
};

export const VISION = {
  unit: 5,
  building: 4,
  tower: 8,
  radar: 18,
  borderReach: 3,            // home border tiles see this far out
  recon: 12,
  reconHours: 24,
};
