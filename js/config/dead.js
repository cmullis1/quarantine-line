// The dead. Speeds in tiles per game hour; `wallDmg` is damage/h to structures.

export const DEAD = {
  walker: { name: 'Walker', hp: 30, speed: [0.7, 1.05], dps: 7, wallDmg: 3, scale: 1 },
  runner: { name: 'Runner', hp: 20, speed: [2.3, 2.9], dps: 6, wallDmg: 2, scale: 0.95 },
  brute: { name: 'Brute', hp: 160, speed: [0.6, 0.75], dps: 14, wallDmg: 12, scale: 1.45 },
  howler: { name: 'Howler', hp: 40, speed: [0.9, 1.1], dps: 5, wallDmg: 2, scale: 1.05, scream: { radius: 13, cooldown: 6 } },
  drowned: { name: 'Drowned', hp: 35, speed: [0.75, 0.85], waterSpeed: 1.1, dps: 7, wallDmg: 3, scale: 1 },
};

// Share of each horde by act (index = act - 1). Remainder is walkers.
export const HORDE_MIX = [
  {},
  { runner: 0.15, brute: 0.03 },
  { runner: 0.18, brute: 0.06, howler: 0.04 },
  { runner: 0.2, brute: 0.08, howler: 0.06 },
];
