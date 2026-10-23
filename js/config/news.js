// The news wire: narrative only, no mechanical effect. Each item fires once when its condition holds,
// often echoing an earlier decision so consequences are felt rather than computed.

const town = (sim, name) => sim.state.towns[sim.map.towns.findIndex((t) => t.name === name)];

export const NEWS = [
  { id: 'n1', when: (sim) => sim.day >= 2, text: () => 'Pharmacies report a run on painkillers and face masks.' },
  { id: 'n2', when: (sim) => sim.state.flags.suppressed && sim.day >= 3, text: () => 'Kessel residents say ambulances have been "coming and going all night".' },
  { id: 'n3', when: (sim) => sim.state.flags.public && sim.day >= 3, text: () => 'Volunteers queue around the block at army recruitment offices.' },
  { id: 'n4', when: (sim) => sim.state.stats.admitted >= 10, text: () => 'Church halls in the border towns fill with refugee families.' },
  { id: 'n5', when: (sim) => sim.state.stats.turnedAway >= 5, text: () => 'Screening officers describe "the look" of a family member being refused.' },
  { id: 'n6', when: (sim) => sim.state.border === 'closed' && sim.day >= 4, text: () => 'Crowds at the border have built shelters out of their own cars.' },
  { id: 'n7', when: (sim) => sim.state.stats.shot >= 1, text: () => 'An anonymous soldier: "We were told they were all infected. They weren\'t."' },
  { id: 'n8', when: (sim) => sim.state.flags.vitaxin && sim.day >= 6, text: () => 'Vitaxin queues stretch for kilometres. Some people are taking second doses.' },
  { id: 'n9', when: (sim) => sim.state.stats.townsLost >= 1, text: () => 'Survivors from the fallen town describe neighbours turning in their sleep.' },
  { id: 'n10', when: (sim) => sim.state.flags.citadel && sim.day >= 15, text: () => 'Outer-town residents sealed under Citadel ask why the capital gets the soldiers.' },
  { id: 'n11', when: (sim) => sim.hasLaw('martial'), text: () => 'Tanks at intersections. Children wave at them on the way to school.' },
  { id: 'n12', when: (sim) => sim.hasLaw('censorship'), text: () => 'The evening news now runs forty minutes of weather and sport.' },
  { id: 'n13', when: (sim) => sim.state.stats.killed >= 500, text: () => 'Bulldozers are digging trenches outside every town for the bodies.' },
  { id: 'n14', when: (sim) => sim.state.res.food < 30, text: () => 'Bakeries close by noon. Bread now comes with a ration stamp.' },
  { id: 'n15', when: (sim) => sim.state.order < 35, text: () => 'Looters strip a pharmacy in broad daylight; police watch from their cars.' },
  { id: 'n16', when: (sim) => sim.state.trust > 75, text: () => 'Polls show record confidence in the government\'s handling of the crisis.' },
  { id: 'n17', when: (sim) => sim.state.trust < 30, text: () => 'Graffiti in the capital: "THEY KNEW ON DAY ONE".' },
  { id: 'n18', when: (sim) => sim.state.stats.evacuated > 5000, text: () => 'Evacuees from the outer towns sleep in the capital\'s metro stations.' },
  { id: 'n19', when: (sim) => sim.state.stats.townsReclaimed >= 1, text: () => 'The first families return to a reclaimed town. They bring paint.' },
  { id: 'n20', when: (sim) => sim.hasLaw('mercy'), text: () => 'A doctor resigns rather than carry out the Mercy Protocol. Her letter is shared a million times.' },
  { id: 'n21', when: (sim) => sim.state.towns.some((t) => t.sacrifice), text: () => 'A town on the edge of the map says its soldiers left in the night.' },
  { id: 'n22', when: (sim) => sim.state.stats.peakDead >= 400, text: () => 'Pilots describe the dead at the border as "a grey tide".' },
  { id: 'n23', when: (sim) => sim.state.stats.unitsLost >= 5, text: () => 'Funerals for soldiers are held in groups now.' },
  { id: 'n24', when: (sim) => { const k = town(sim, 'Kessel'); return k && k.status === 'ok' && sim.day >= 20; }, text: () => 'The Kessel steelworks are making wall sections around the clock.' },
  { id: 'n25', when: (sim) => sim.hasTech('m4'), text: () => 'Troops with the serum walk through a crowd of the dead untouched. The footage is everywhere.' },
  { id: 'n26', when: (sim) => sim.state.stats.refugeesTurned >= 10, text: () => 'Border guards say they can hear the crowds turning at night.' },
];
