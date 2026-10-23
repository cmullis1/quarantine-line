// The score's style: switches the music lab (?musiclab) can flip while it plays. 'auto' leaves the choice to
// the director (song from the act, section, mood from how the country is doing, the world's band and groove,
// a melody and lead mix); any other value pins that part so it can be heard on its own.
export const DEFAULT_STYLE = { song: 'auto', section: 'auto', mood: 'auto', band: 'auto', groove: 'auto', swing: 'auto', melody: 'auto', lead: 'auto', shape: 'on' };
const AUTO = ['auto', 'Auto'];
export const STYLE_OPTIONS = {
  song: [AUTO, ['anthem', 'Anthem'], ['act1', 'Act I'], ['act2', 'Act II'], ['act3', 'Act III'], ['act4', 'Act IV']],
  section: [AUTO, ['A', 'A'], ['B', 'B']],
  mood: [['auto', 'Follow the game'], ['hopeful', 'Hopeful'], ['uneasy', 'Uneasy'], ['dire', 'Dire']],
  band: [AUTO, ['warm', 'Warm'], ['synth', 'Synth'], ['dark', 'Dark']],
  groove: [AUTO, ['bounce', 'Bounce'], ['standard', 'Standard'], ['heavy', 'Heavy']],
  swing: [AUTO, ['on', 'On'], ['off', 'Off']],
  melody: [AUTO, ['hooks', 'Hooks'], ['riff', 'Riff'], ['call', 'Call and answer'], ['anthem', 'Anthem']],
  lead: [AUTO, ['soft', 'Soft lead'], ['bell', 'Glassy bell'], ['synth', 'Thick synth'], ['celesta', 'Celesta'], ['piano', 'Piano'], ['dist', 'Distorted lead'], ['choir', 'Choir'], ['lowPiano', 'Low piano']],
  shape: [['on', 'Breath, build, full'], ['off', 'Steady']],
};
export const validStyle = (st) => Object.fromEntries(Object.entries(DEFAULT_STYLE).map(([k, d]) =>
  [k, STYLE_OPTIONS[k].some(([v]) => v === st?.[k]) ? st[k] : d]));
