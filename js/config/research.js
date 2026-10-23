// Four branches, four tiers. Each tier needs the previous one in its branch.

export const BRANCHES = [
  { id: 'medicine', label: 'Medicine', color: '#9fd6a8' },
  { id: 'military', label: 'Military', color: '#e0a060' },
  { id: 'engineering', label: 'Engineering', color: '#9fb8e0' },
  { id: 'civic', label: 'Civic', color: '#e0c860' },
];

export const RESEARCH = [
  { id: 'm1', branch: 'medicine', tier: 1, name: 'Rapid Screening', cost: 30, desc: 'Checkpoints catch 92% of infected refugees (was 60%) and screen 50% faster.' },
  { id: 'm2', branch: 'medicine', tier: 2, name: 'Field Test Kits', cost: 50, desc: 'Detection +15% everywhere. Quarantine Teams contain 50% faster.' },
  { id: 'm3', branch: 'medicine', tier: 3, name: 'Outbreak Protocols', cost: 80, desc: 'Infection spreads 20% slower. Breakouts start at 400 cases instead of 300.' },
  { id: 'm4', branch: 'medicine', tier: 4, name: 'Camouflage Serum', cost: 260, desc: 'The dead barely notice the treated: their aggro range drops 70% against troops, refugees and buses.' },

  { id: 'k1', branch: 'military', tier: 1, name: 'Headshot Doctrine', cost: 35, desc: 'All troops and defences deal +30% damage.' },
  { id: 'k2', branch: 'military', tier: 2, name: 'Field Doctrine', cost: 55, desc: 'Cheap close-quarters tools: troops out of ammo fight at 60% (was 25%), and every shot costs 25% less ammo.' },
  { id: 'k3', branch: 'military', tier: 3, name: 'Minefields', cost: 60, desc: 'Unlocks Minefields.' },
  { id: 'k4', branch: 'military', tier: 4, name: 'Artillery', cost: 100, desc: 'Unlocks the Artillery Battery.' },

  { id: 'e1', branch: 'engineering', tier: 1, name: 'Floodlights', cost: 30, desc: 'Unlocks Floodlights: no night penalty nearby.' },
  { id: 'e2', branch: 'engineering', tier: 2, name: 'High Walls', cost: 50, desc: 'Walls can be upgraded to High Walls (22 bodies to pile over, almost double health).' },
  { id: 'e3', branch: 'engineering', tier: 3, name: 'Sound Lures', cost: 60, desc: 'Unlocks the Sound Lure.' },
  { id: 'e4', branch: 'engineering', tier: 4, name: 'Coastal Barrier', cost: 90, desc: 'All walls +50% health. Walls can be built in shallow water next to the shore.' },

  { id: 'c1', branch: 'civic', tier: 1, name: 'Radio Network', cost: 30, desc: '+0.15 authority/h. Emergency Broadcast costs half.' },
  { id: 'c2', branch: 'civic', tier: 2, name: 'Rationing Science', cost: 45, desc: 'Food use −20%.' },
  { id: 'c3', branch: 'civic', tier: 3, name: 'Mass Shelters', cost: 60, desc: 'Refugee Camps hold twice as many people.' },
  { id: 'c4', branch: 'civic', tier: 4, name: 'Reconstruction', cost: 90, desc: 'Reclaimed towns resettle three times faster.' },
];

export const RESEARCH_BY_ID = Object.fromEntries(RESEARCH.map((r) => [r.id, r]));

export function researchPrereq(id) {
  const r = RESEARCH_BY_ID[id];
  if (!r || r.tier === 1) return null;
  return RESEARCH.find((x) => x.branch === r.branch && x.tier === r.tier - 1).id;
}
