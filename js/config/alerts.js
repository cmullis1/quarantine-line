// How hard each alert kind asks for attention (spec D, "Noticing what happens").
// critical: the alarm, a flash on the screen edge toward it, an edge arrow pinned until the camera has looked there.
// important: a soft ping, at most one every 4 s. Any kind not listed is routine: a line in the feed and its level's tone.
// A kind with a tone of its own plays that tone instead of the alarm or the ping (alertSound in js/audio/audio.js).
export const ALERT_WEIGHT = {
  hordeArrived: 'critical', breakout: 'critical', fall: 'critical', hq: 'critical', hqAttack: 'critical', danger: 'critical',
  hordeContact: 'important', outbreak: 'important', destroyed: 'important', unitLost: 'important', busLost: 'important',
  pileup: 'important', starving: 'important', ammo: 'important', broke: 'important', deadline: 'important',
  promiseBroken: 'important', underAttack: 'important',
};

export const weightOf = (kind) => ALERT_WEIGHT[kind] || 'routine';

export const ALERT_RULES = {
  // "<Thing> under attack …": once per `hours` of game time per `cell`-tile square of the map.
  attackCell: 12, attackHours: 6,
  // "Government in danger" when trust or order falls below `danger`; it can sound again once back above `rearm`.
  danger: 15, rearm: 20,
  // A promise to a minister that is still unmet this many hours before its deadline.
  deadlineHours: 6,
};
