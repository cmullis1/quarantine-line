// Units. `figs` > 0 means an infantry-style squad rendered as figures; otherwise a vehicle model.
// `setup`: hours standing still before it can fire, then only into the `arc` degrees ahead. `heal`: an aura for
// squads around it. `vision`: sight radius in tiles (default VISION.unit). `requires`: the research that must be done
// before it can be trained. `evade`: with any of the dead within `radius` tiles, it drives `run` tiles away (unless
// holding or attack-moving).

export const UNITS = {
  infantry: {
    name: 'Infantry Squad', icon: '⚔️', figs: 3, hp: 80, speed: 3, weapon: 'rifle', contain: 6, order: 0.005,
    upkeep: { funds: 0.12 }, train: 4, cost: { funds: 25, manpower: 12, food: 5 },
    desc: 'Three riflemen. The backbone.',
  },
  police: {
    name: 'Riot Police', icon: '🛡️', figs: 3, hp: 90, speed: 3, weapon: 'baton', contain: 4, order: 0.05,
    upkeep: { funds: 0.1 }, train: 3, cost: { funds: 20, manpower: 10 },
    desc: 'Shields and batons. Keeps order in a town (+0.05/h). Uses no ammo; weak against the dead.',
  },
  hazmat: {
    name: 'Quarantine Team', icon: '☣️', figs: 2, hp: 55, speed: 2.8, weapon: 'flamer', contain: 30, detect: true,
    upkeep: { funds: 0.15 }, train: 5, cost: { funds: 30, manpower: 8, food: 10 },
    desc: 'Hazmat crew with a flamer. Station in a town to find and burn out infection.',
  },
  engineers: {
    name: 'Engineers', icon: '🔧', figs: 2, hp: 55, speed: 3, weapon: 'rifle', contain: 1, engineer: true,
    upkeep: { funds: 0.12 }, train: 4, cost: { funds: 25, manpower: 8 },
    desc: 'Repair damaged structures nearby and speed up construction ×2.5 within 4 tiles.',
  },
  sniper: {
    name: 'Sniper Team', icon: '🎯', figs: 2, hp: 45, speed: 2.8, weapon: 'sniper', contain: 1,
    upkeep: { funds: 0.15 }, train: 5, cost: { funds: 35, manpower: 6, food: 5 },
    desc: 'Long range, almost silent. Picks off Howlers first.',
  },
  mg: {
    name: 'Machine-Gun Team', icon: '🔫', figs: 2, hp: 60, speed: 2.6, weapon: 'hmg', contain: 2, setup: 1, arc: 100,
    upkeep: { funds: 0.2 }, train: 5, cost: { funds: 45, manpower: 8, food: 5 },
    desc: 'Sets up in 1 h when it stops, then pours fire into a 100° arc. Cannot fire on the move. Hungry and loud.',
  },
  mortar: {
    name: 'Mortar Team', icon: '💥', figs: 2, hp: 50, speed: 2.6, weapon: 'mortar', contain: 1, requires: 'k2',
    upkeep: { funds: 0.2 }, train: 5, cost: { funds: 55, manpower: 8, food: 5 },
    desc: 'Lobs shells 3–12 tiles over walls into the thickest crowd it can see. Helpless up close.',
  },
  medic: {
    name: 'Medic Team', icon: '⛑️', figs: 2, hp: 50, speed: 3, weapon: 'pistol', contain: 2, heal: { radius: 3, rate: 10 },
    upkeep: { funds: 0.15 }, train: 4, cost: { funds: 30, manpower: 6, food: 10 },
    desc: 'Heals every squad within 3 tiles by 10 HP/h. Keep it behind the line.',
  },
  scout: {
    name: 'Scout', icon: '🏍️', figs: 0, hp: 40, speed: 7, weapon: 'carbine', contain: 1, vision: 12, evade: { radius: 4, run: 6 },
    upkeep: { funds: 0.08 }, train: 2, cost: { funds: 20, manpower: 4 },
    desc: 'Motorbike scout: the fastest thing on the ground, with more than twice a squad\'s sight. It runs from fights.',
  },
  apc: {
    name: 'APC', icon: '🚙', figs: 0, hp: 300, speed: 5, weapon: 'mg', contain: 8, armored: true,
    upkeep: { funds: 0.3 }, train: 8, cost: { funds: 70, manpower: 6, food: 15 },
    desc: 'Armoured carrier with a heavy machine gun. Bites barely scratch it. Loud.',
  },
  gunship: {
    name: 'Gunship', icon: '🚁', figs: 0, hp: 180, speed: 8, weapon: 'gunship', contain: 0, air: true,
    upkeep: { funds: 0.7 }, train: 12, cost: { funds: 140, manpower: 4, food: 25 },
    desc: 'Flies over walls and rivers. Very loud, very hungry.',
  },
};
