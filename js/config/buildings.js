// Buildings. `grid` is the build-menu slot (row-major QWER / ASDF / ZXCV) within its tab.
// `unlock` names the research that enables it. Rates are per game hour.

export const TABS = [
  { id: 'defense', label: 'Defence', key: 'Z' },
  { id: 'economy', label: 'Economy', key: 'X' },
  { id: 'civic', label: 'Civic', key: 'C' },
];

export const GRID_KEYS = ['Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F', 'Z', 'X', 'C', 'V'];

export const BUILDINGS = {
  wall: {
    name: 'Wall', icon: '🧱', tab: 'defense', grid: 0, size: 1, hp: 600, build: 0.6,
    cost: { funds: 5 }, line: true, wall: true, height: 1,
    desc: 'Concrete barrier. Drag to lay a line. The dead detour if they can. Otherwise they claw through, or pile up and climb over (10 bodies).',
  },
  highwall: {
    name: 'High Wall', icon: '🏯', size: 1, hp: 1100, build: 2, upgradeOf: 'wall',
    cost: { funds: 12 }, wall: true, height: 1.9, unlock: 'e2',
    desc: 'Taller, thicker wall. Takes 22 bodies to pile over. Upgrade a Wall to build one.',
  },
  gate: {
    name: 'Gate', icon: '🚪', tab: 'defense', grid: 1, size: 1, hp: 700, build: 2,
    cost: { funds: 18 }, wall: true, gate: true, height: 1,
    desc: 'A wall your units, refugees and buses can pass through. The dead cannot.',
  },
  tower: {
    name: 'Watchtower', icon: '🗼', tab: 'defense', grid: 2, size: 1, hp: 300, build: 4,
    cost: { funds: 35, manpower: 5 }, weapon: 'tower', vision: 8,
    desc: 'Armed lookout. Fires at any of the dead in range. Range shrinks at night unless a Floodlight is near.',
  },
  checkpoint: {
    name: 'Checkpoint', icon: '🚧', tab: 'defense', grid: 3, size: 1, hp: 360, build: 5,
    cost: { funds: 40, manpower: 10 }, road: true, weapon: 'checkpoint', vision: 6, passable: true,
    desc: 'Gate on a road. On a border crossing it screens refugees when the border is Screened.',
  },
  floodlight: {
    name: 'Floodlight', icon: '💡', tab: 'defense', grid: 4, size: 1, hp: 120, build: 1.5,
    cost: { funds: 20 }, radius: 7, vision: 7, unlock: 'e1',
    desc: 'Lights 7 tiles at night: towers and troops nearby keep full range.',
  },
  lure: {
    name: 'Sound Lure', icon: '📢', tab: 'defense', grid: 5, size: 1, hp: 150, build: 2,
    cost: { funds: 30 }, noise: 16, period: 2, upkeep: { funds: 0.2 }, unlock: 'e3', toggle: true,
    desc: 'Loudspeaker that plays a siren every 2 h. Pulls the dead within 16 tiles toward it. Build it where you want them.',
  },
  minefield: {
    name: 'Minefield', icon: '💣', tab: 'defense', grid: 6, size: 1, hp: 50, build: 1,
    cost: { funds: 15, ammo: 6 }, passable: true, mine: { radius: 1.8, dmg: 140 }, unlock: 'k3',
    desc: 'Explodes when the dead walk over it (radius 1.8, heavy damage). One use.',
  },
  artillery: {
    name: 'Artillery Battery', icon: '🎯', tab: 'defense', grid: 7, size: 2, hp: 400, build: 10,
    cost: { funds: 140, manpower: 20 }, weapon: 'artillery', unlock: 'k4',
    desc: 'Shells the thickest visible crowd of the dead within 24 tiles. Devastating, loud, ammo-hungry.',
  },

  farm: {
    name: 'Farm', icon: '🌾', tab: 'economy', grid: 0, size: 2, hp: 160, build: 6,
    cost: { funds: 40 }, produce: { food: 1.6 }, workers: 1,
    desc: '+1.6 food/h. +50% on farmland. Needs 1 worker.',
  },
  factory: {
    name: 'Factory', icon: '🏭', tab: 'economy', grid: 1, size: 2, hp: 220, build: 8,
    cost: { funds: 70, food: 10 }, produce: { funds: 1.8 }, workers: 2,
    desc: '+1.8 funds/h. Needs 2 workers.',
  },
  munitions: {
    name: 'Munitions Plant', icon: '🧨', tab: 'economy', grid: 2, size: 2, hp: 220, build: 8,
    cost: { funds: 80 }, produce: { ammo: 3 }, upkeep: { funds: 0.3 }, workers: 2,
    desc: '+3 ammo/h (costs 0.3 funds/h). Needs 2 workers.',
  },
  depot: {
    name: 'Supply Depot', icon: '📦', tab: 'economy', grid: 3, size: 2, hp: 240, build: 6,
    cost: { funds: 50, food: 10 }, radius: 6,
    desc: 'Troops within 6 tiles heal 15 HP/h and use half the ammo.',
  },

  hq: {
    name: 'National HQ', icon: '🏛️', size: 2, hp: 1200, build: 0, cost: {},
    trains: ['infantry', 'police', 'hazmat', 'engineers', 'medic', 'scout'], produce: { funds: 1 }, weapon: 'hq', vision: 7,
    desc: 'Seat of government. Trains infantry, riot police, quarantine teams, engineers, medics and scouts.',
  },
  barracks: {
    name: 'Barracks', icon: '🎖️', tab: 'civic', grid: 0, size: 2, hp: 360, build: 8,
    cost: { funds: 80, food: 10 }, trains: ['infantry', 'police', 'hazmat', 'engineers', 'sniper', 'mg', 'mortar', 'medic', 'scout', 'apc'],
    desc: 'Trains every ground unit, including snipers and APCs.',
  },
  police: {
    name: 'Police Station', icon: '🚓', tab: 'civic', grid: 1, size: 2, hp: 240, build: 6,
    cost: { funds: 50 }, radius: 9,
    desc: 'Towns within 9 tiles: order +0.06/h each. Order keeps quarantines holding and people at home.',
  },
  hospital: {
    name: 'Field Hospital', icon: '⛺', tab: 'civic', grid: 2, size: 2, hp: 180, build: 6,
    cost: { funds: 70, food: 20 }, radius: 9,
    desc: 'Towns within 9 tiles: spread −30%, detection +20%. Troops within 5 heal 25 HP/h.',
  },
  camp: {
    name: 'Refugee Camp', icon: '🏕️', tab: 'civic', grid: 3, size: 2, hp: 200, build: 6,
    cost: { funds: 60, food: 20 }, radius: 14,
    desc: 'Refugees admitted at crossings within 14 tiles wait here 2 days before moving on. The infected turn here, not in your towns.',
  },
  lab: {
    name: 'Research Lab', icon: '🔬', tab: 'civic', grid: 4, size: 2, hp: 180, build: 10,
    cost: { funds: 100 }, produce: { research: 1 }, workers: 1,
    desc: '+1 research/h. Needs 1 worker.',
  },
  radar: {
    name: 'Radar Station', icon: '📡', tab: 'civic', grid: 5, size: 2, hp: 200, build: 8,
    cost: { funds: 90 }, vision: 18, upkeep: { funds: 0.2 },
    desc: 'Sees 18 tiles in every direction: hordes are spotted far earlier.',
  },
  helipad: {
    name: 'Helipad', icon: '🚁', tab: 'civic', grid: 6, size: 2, hp: 260, build: 10,
    cost: { funds: 120, manpower: 10 }, trains: ['gunship'],
    desc: 'Trains gunships and enables airstrikes.',
  },
};

export const WEAPONS = {
  rifle: { range: 4.5, dmg: 11, rof: 0.6, ammo: 0.2, noise: 5, color: 0xffe08a },
  mg: { range: 5, dmg: 6, rof: 0.15, ammo: 0.1, noise: 7, color: 0xffd060 },
  hmg: { range: 5.5, dmg: 7, rof: 0.1, ammo: 0.12, noise: 8, color: 0xffd060 },
  pistol: { range: 3, dmg: 6, rof: 0.7, ammo: 0.05, noise: 2, color: 0xffe08a },
  carbine: { range: 4, dmg: 8, rof: 0.7, ammo: 0.1, noise: 3, color: 0xffe08a },
  sniper: { range: 9, dmg: 46, rof: 1.6, ammo: 0.5, noise: 1.5, color: 0xffffff, priority: 'howler' },
  flamer: { range: 2.5, dmg: 22, rof: 0.5, ammo: 0.3, noise: 2, color: 0xff8020, area: 0.8 },
  baton: { range: 0.8, dmg: 6, rof: 0.5, ammo: 0, noise: 0, melee: true },
  gunship: { range: 7, dmg: 14, rof: 0.35, ammo: 0.3, noise: 12, color: 0xffd060 },
  tower: { range: 6.5, dmg: 12, rof: 0.6, ammo: 0.15, noise: 5, color: 0xffe08a },
  checkpoint: { range: 4, dmg: 8, rof: 0.8, ammo: 0.12, noise: 4, color: 0xffe08a },
  hq: { range: 5, dmg: 10, rof: 0.6, ammo: 0.12, noise: 4, color: 0xffe08a },
  artillery: { range: 24, minRange: 5, dmg: 90, rof: 3, ammo: 4, noise: 18, radius: 2.5, flight: 1.2 },
  mortar: { range: 12, minRange: 3, dmg: 40, rof: 2.5, ammo: 1.5, noise: 14, radius: 1.5, flight: 0.8 },
};
