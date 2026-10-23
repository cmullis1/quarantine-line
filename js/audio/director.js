// The music director: plans the score one 8-bar phrase at a time. Pure functions; the engine asks at each phrase
// line and plays the answer.
//
//  - Song: the act's song (the Anthem in the menu), sections A and B alternating every 32-bar cycle, the anthem
//    quoted when a song opens and once every second cycle.
//  - Mood (hopeful / uneasy / dire) follows a slow 'how dire is it' score: towns lost, trust, order, the act,
//    outbreaks and breakouts; it moves one step at a time. Moment-to-moment danger drives the intensity level.
//  - Each mood is a world (worlds.js): key, tempo, groove, band. Any mix of song, section and mood changes on one
//    phrase line becomes one transition: one tempo glide, one band crossfade, the loop pivoting on a shared chord.
//  - Melody and lead rotate per phrase, suited to the intensity and never the same pick twice in a row, except that
//    the tune playing carries into a new mood for one phrase. The song's featured lead for the mood plays at least
//    every second phrase; the anthem keeps to its mood's leads.
//  - Shape: every 32 bars a breath phrase (thin drums, the melody rests for four bars), a build (the timekeeper
//    tightens and a riser sweeps into the next phrase), then two full phrases.
//  - Reactions to game events and the hush before a horde.
import { STEPS, PHRASE_BARS } from './score.js';
import { WORLDS, BANDS, sharedChords } from './worlds.js';
import { SONGS, songFor } from './songs.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// 0 = all is well, 1 = the country is collapsing. `s`: { towns: [{ status, alerted, breakout }], trust, order, act }.
export function direness(s) {
  const towns = s.towns || [];
  const total = Math.max(1, towns.length);
  const lost = towns.filter((t) => t.status !== 'ok').length / total;
  const alerted = towns.filter((t) => t.status === 'ok' && t.alerted).length;
  const breakouts = towns.filter((t) => t.status === 'ok' && t.breakout).length;
  return clamp01(
    0.35 * clamp01(lost / 0.5)
    + 0.2 * clamp01((65 - (s.trust ?? 65)) / 45)
    + 0.1 * clamp01((65 - (s.order ?? 65)) / 45)
    + 0.15 * clamp01(((s.act ?? 1) - 1) / 3)
    + 0.2 * clamp01((alerted + 2 * breakouts) / 4),
  );
}

export const MOODS = ['hopeful', 'uneasy', 'dire'];
// The mood a dire score asks for: boundaries at 0.25 and 0.55, each widened by 0.05 in favour of the current
// mood (no current mood: the plain boundaries). Calibration: a fresh country ≈ 0.02; three towns in outbreak at
// trust 40 in Act II ≈ 0.33 (uneasy); half the towns lost with trust at 20 ≈ 0.9 (dire). The act alone (Act IV,
// all well) only reaches 0.15.
function moodFor(dire, current) {
  const toDire = current === 'dire' ? 0.5 : current ? 0.6 : 0.55;
  const toUneasy = current === 'hopeful' ? 0.3 : current ? 0.2 : 0.25;
  if (dire >= toDire) return 'dire';
  if (dire >= toUneasy) return 'uneasy';
  return 'hopeful';
}
// Called once per phrase. The mood moves one step (hopeful ↔ uneasy ↔ dire) toward the one the score asks for,
// and only after two phrases in a row ask for that same step, so it never lurches from bright to grim.
export function nextMood(current, dire, pending = null) {
  const want = moodFor(dire, current);
  if (want === current) return { mood: current, pending: null };
  const i = MOODS.indexOf(current);
  const step = MOODS[i + Math.sign(MOODS.indexOf(want) - i)];
  if (pending === step) return { mood: step, pending: null };
  return { mood: current, pending: step };
}

// The 32-bar shape: which part of the cycle a bar is in.
export const SHAPE = ['breath', 'build', 'full', 'full'];
const CYCLE = SHAPE.length * PHRASE_BARS;
export const shapeOf = (bar) => SHAPE[Math.floor((bar % CYCLE) / PHRASE_BARS)];
// What keeps time in each groove: it carries on through a breath and runs in sixteenths through a build.
const TIMEKEEPER = { bounce: 'shaker', standard: 'hat', heavy: 'hat' };
const BREATH_DROPS = new Set(['snare', 'clap', 'ohat', 'tamb', 'taiko', 'clang']);
// The shape for any groove's hits. Breath: kick only on the downbeat, the bass and the timekeeper carry on, the
// backbeat and colour drop out. Build: in its last two bars the timekeeper runs in sixteenths and a riser starts
// on the first step of bar 7.
export function shapeHitsFor(hits, shape, phraseBar, step, level, groove) {
  if (level < 0 || shape === 'full') return hits;
  if (shape === 'breath') return hits.filter((h) => (h.inst === 'kick' ? step === 0 : !BREATH_DROPS.has(h.inst)));
  const tk = TIMEKEEPER[groove];
  const out = [...hits];
  if (phraseBar >= 6 && !out.some((h) => h.inst === tk)) out.push({ inst: tk, vel: step % 4 === 0 ? 1 : 0.55 });
  if (phraseBar === 6 && step === 0) out.push({ inst: 'riser', vel: 1, bars: 2 });
  return out;
}
// The song's own percussion over a groove's hits ([inst, step] per bar): from tension up, an extra plain hit where
// the groove has none of that instrument on the step; never in a breath, and thinned at night like the groove's
// hats and shakers.
const OVERLAY_VEL = 0.7;
const NIGHT_THINS = new Set(['hat', 'shaker']);
export function withOverlay(hits, overlay, level, step, { shape = 'full', night = false } = {}) {
  if (level < 1 || shape === 'breath') return hits;
  const add = overlay.filter(([inst, s]) => s === step && !hits.some((h) => h.inst === inst) && !(night && level < 2 && NIGHT_THINS.has(inst)));
  return add.length ? [...hits, ...add.map(([inst]) => ({ inst, vel: OVERLAY_VEL }))] : hits;
}
// Whether the melody rests on this bar (the first half of a breath phrase).
export const melodyRests = (shape, phraseBar) => shape === 'breath' && phraseBar < 4;

// ---- Phrases ---------------------------------------------------------------------------------------------------

// A lab switch left on Auto (or not given) leaves the choice to the director.
const pinned = (v) => v != null && v !== 'auto';
// Intensity bands in order: calm (level ≤ 0), tension (1), combat (≥ 2).
const rank = (level) => Math.max(0, Math.min(2, level));
const bandOf = (level) => ['calm', 'tension', 'combat'][rank(level)];
const wantedSong = ({ act = 1, menu = false, pins = {} }) => (pinned(pins.song) ? pins.song : songFor({ act, menu }));
const sectionAt = (bar, pins = {}) => (pinned(pins.section) ? pins.section : Math.floor(bar / CYCLE) % 2 ? 'B' : 'A');
const samePick = (a, b) => !!a && !!b && a.kind === b.kind && a.lead === b.lead;

// The melody kinds each intensity plays: [kind, whether a hook is layered over it]. Leads come from the band; a
// layered hook takes the band's next lead so the two lines keep apart.
const PHRASE_KINDS = {
  calm: [['hooks', false], ['call', false]],
  tension: [['call', false], ['riff', false], ['hooks', false]],
  combat: [['riff', true], ['riff', false], ['call', false]],
};
// Between its anthem phrases the Anthem song plays call and answer.
const ANTHEM_KINDS = [['call', false]];
// The anthem's leads per mood (spec 5.5): a bright one in Hopeful (the piano doubles it), the low piano or the choir
// far off in Dire; in Uneasy the band's own.
const ANTHEM_LEADS = { hopeful: ['bell', 'celesta'], dire: ['lowPiano', 'choir'] };
// The band's leads, and the song's featured lead with them when the band has none of it.
const withFeatured = (leads, featured) => (featured && !leads.includes(featured) ? [...leads, featured] : leads);
// After a phrase without the featured lead, the next one plays it: it is heard at least every second phrase.
const owesFeatured = (featured, options, prev) => !!featured && options.includes(featured) && prev?.lead !== featured;

// The melody and lead for a phrase: { kind, lead, over } with over = { kind: 'hooks', lead } or null. Never the
// same kind and lead as `prev`; `featured` (the song's lead for the mood, or null) whenever `prev` was without it.
// A layered hook takes the band's next lead after the melody's (its first for a lead from outside the band).
export function pickForPhrase(level, song, band, prev, rand = Math.random, featured = null) {
  const leads = BANDS[band].leads;
  const pool = withFeatured(leads, featured);
  const kinds = song === 'anthem' ? ANTHEM_KINDS : PHRASE_KINDS[bandOf(level)];
  let options = kinds.flatMap(([kind, layered]) => pool.map((lead) =>
    ({ kind, lead, over: layered ? { kind: 'hooks', lead: leads[(leads.indexOf(lead) + 1) % leads.length] } : null })))
    .filter((p) => !samePick(p, prev));
  if (owesFeatured(featured, pool, prev)) options = options.filter((p) => p.lead === featured);
  return options[Math.floor(rand() * options.length)];
}
// A lead for a melody kind the director did not choose (the anthem, a pinned melody): the pinned lead, or one that
// does not repeat the last pick: the anthem's from its mood's leads, any other from the band's and the featured.
function leadFor(kind, band, mood, pinnedLead, prev, rand, featured) {
  if (pinned(pinnedLead)) return pinnedLead;
  const pool = (kind === 'anthem' && ANTHEM_LEADS[mood]) || withFeatured(BANDS[band].leads, featured);
  let options = pool.filter((lead) => !samePick({ kind, lead }, prev));
  if (owesFeatured(featured, pool, prev)) options = [featured];
  return options[Math.floor(rand() * options.length)];
}
// A layered hook under a pinned lead: kept in its own sound, another of the band's leads than the pinned one.
function layerBeside(over, band, lead, rand) {
  if (over.lead !== lead) return over;
  const options = BANDS[band].leads.filter((l) => l !== lead);
  return { ...over, lead: options[Math.floor(rand() * options.length)] };
}
// Turn a loop to start on a chord both moods share, so the harmony pivots into the new world. No shared chord:
// the loop stays as written.
function pivot(loop, shared) {
  const k = loop.findIndex((c) => shared.includes(c));
  return k <= 0 ? loop : [...loop.slice(k), ...loop.slice(0, k)];
}

// Plan the phrase starting at `inputs.bar` (a phrase line) after `prev` (null for the first).
// inputs = { bar, dire, act, menu, level, pins, restart }; pins = the lab switches { song, section, mood, band,
// groove, melody, lead }, 'auto' or missing for the director's choice. A pinned mood applies at once; band and
// groove follow the mood unless pinned; the tempo always follows the mood. `restart` (back from an ending, a new
// game) starts in the mood the country asks for, as the first phrase does, gliding on from `prev`'s tempo.
// The phrase: { bar, song, section, mood, moodPending, cycle, level, pick, mel, loop, world, groove, band,
// tempoFrom, tempoTo, crossfade, fillInto, quote }. `mel` = { hook, riff } for melodySection; `world` = WORLDS[mood].
export function nextPhrase(prev, inputs, rand = Math.random) {
  const { bar = 0, dire = 0, level = 0, pins = {} } = inputs;
  const cycle = Math.floor(bar / CYCLE);
  const song = wantedSong(inputs);
  const section = sectionAt(bar, pins);
  let mood = pinned(pins.mood) ? pins.mood : null;
  let moodPending = null;
  // Nothing playing yet, or a new game: start in the mood the country asks for.
  if (!mood && (!prev || inputs.restart)) mood = moodFor(dire, null);
  if (!mood) ({ mood, pending: moodPending } = nextMood(prev.mood, dire, prev.moodPending));
  const songChanged = !prev || prev.song !== song;
  const moodChanged = !!prev && prev.mood !== mood;
  const world = WORLDS[mood];
  const band = pinned(pins.band) ? pins.band : world.band;
  const groove = pinned(pins.groove) ? pins.groove : world.groove;
  const featured = pinned(pins.lead) ? null : SONGS[song].featured[mood];

  // The anthem opens every song, and act songs quote it in the first full phrase of every second cycle (unless it
  // has just played: never twice in a row).
  const last = prev?.pick ?? null;
  const quoteHere = songChanged
    || (song !== 'anthem' && cycle % 2 === 1 && bar % CYCLE === 2 * PHRASE_BARS && last?.kind !== 'anthem');
  // Into a new mood the tune playing carries on (same kind, hook, riff and lead) over the new world's chords; the
  // director moves on from the phrase after. The anthem is a whole statement and is not carried.
  const carry = moodChanged && !songChanged && last.kind !== 'anthem';
  let pick, carried = false;
  const lead = (kind) => leadFor(kind, band, mood, pins.lead, last, rand, featured);
  if (pinned(pins.melody)) pick = { kind: pins.melody, lead: lead(pins.melody), over: null };
  else if (quoteHere || (song === 'anthem' && section === 'A')) pick = { kind: 'anthem', lead: lead('anthem'), over: null };
  else {
    carried = carry;
    pick = carry ? last : pickForPhrase(level, song, band, last, rand, featured);
    if (pinned(pins.lead)) pick = { ...pick, lead: pins.lead, over: pick.over && layerBeside(pick.over, band, pins.lead, rand) };
  }
  const { hooks, riff } = SONGS[song];
  // Act songs use one hook per section; the Anthem's section B answers on its first hook. A carried tune keeps its
  // own hook and riff, across a section change too.
  const mel = carried ? prev.mel : { hook: hooks[section === 'B' && song !== 'anthem' ? 1 : 0], riff };

  // Same song, section and mood: the loop carries on as it was (turned or not).
  let loop = prev && !songChanged && !moodChanged && prev.section === section ? prev.loop : SONGS[song].sections[section][mood];
  if (prev && (songChanged || moodChanged)) loop = pivot(loop, sharedChords(prev.mood, mood));

  const tempoTo = world.tempo;
  const phrase = {
    bar, song, section, mood, moodPending, cycle, level, pick, mel, loop, world, groove, band,
    tempoFrom: prev ? prev.tempoTo : tempoTo, tempoTo,
    crossfade: prev && prev.band !== band ? { from: prev.band, to: band } : null,
    fillInto: false, quote: quoteHere && pick.kind === 'anthem',
  };
  phrase.fillInto = fillInto(phrase, inputs);
  return phrase;
}

// The tempo at a step of a phrase: a straight line from tempoFrom to tempoTo over its 128 steps, landing on
// tempoTo exactly at the next phrase line.
export function tempoAt(phrase, barInPhrase, step) {
  const k = (barInPhrase * STEPS + step) / (PHRASE_BARS * STEPS);
  return phrase.tempoFrom + (phrase.tempoTo - phrase.tempoFrom) * k;
}

// The mood the next phrase line turns to, or null: a pinned mood not yet playing, else the step pending.
export function moodTurn(phrase, { pins = {} } = {}) {
  if (pinned(pins.mood)) return pins.mood !== phrase.mood ? pins.mood : null;
  return phrase.moodPending ?? null;
}

// Whether the phrase closes with a fill: only into a change at the next phrase line (a new section, a mood
// about to turn, a new song, a rise in intensity). The engine asks at the start of the phrase's last bar.
export function fillInto(phrase, inputs) {
  const { level = 0, pins = {} } = inputs;
  return sectionAt(phrase.bar + PHRASE_BARS, pins) !== phrase.section || !!moodTurn(phrase, inputs)
    || wantedSong(inputs) !== phrase.song || rank(level) > rank(phrase.level);
}

// The chord of the phrase's last two bars. Into a mood change it pivots: the loop's last chord if both moods share
// it, else the loop's earliest chord they share, else Am. The engine asks at the start of bar 6, its chord line.
export function closingChord(phrase, inputs) {
  const last = phrase.loop.at(-1), to = moodTurn(phrase, inputs);
  if (!to) return last;
  const shared = sharedChords(phrase.mood, to);
  if (shared.includes(last)) return last;
  return phrase.loop.find((c) => shared.includes(c)) ?? 'Am';
}

// The groove's alternate bar: only in the second half of a cycle's last full phrase (bars 28–31), so never in
// two phrases in a row.
export const altBar = (cycleBar) => cycleBar % CYCLE >= CYCLE - PHRASE_BARS / 2;

// ---- Reactions and the hush --------------------------------------------------------------------------------------

const COOLDOWN = 30;
const HUSH_GAP = 240;
const HUSH_BARS = 16;
const ANSWERS = { hordeArrived: 'hit', fall: 'fall', hordeDestroyed: 'lift', breakout: 'pulse' };
// How the score answers a game event at `now` (real seconds): { kind, state }, kind one of 'hush' | 'hit' |
// 'stab' | 'fall' | 'lift' | 'pulse' | null. state = { lastHush, lastAny, last: { [type]: seconds } }; anything
// missing counts as never. Each event type answers at most once per 30 s.
export function reaction(type, now, state, level) {
  const { lastHush = -Infinity, lastAny = -Infinity, last = {} } = state;
  if (type !== 'hordeContact' && !Object.hasOwn(ANSWERS, type)) return { kind: null, state };
  if (now - (last[type] ?? -Infinity) < COOLDOWN) return { kind: null, state };
  // A sighting starts the hush only outside a fight, at most every 4 minutes, and not right after another answer.
  const kind = type === 'hordeContact'
    ? (level <= 1 && now - lastHush >= HUSH_GAP && now - lastAny >= COOLDOWN ? 'hush' : 'stab')
    : ANSWERS[type];
  return { kind, state: { lastHush: kind === 'hush' ? now : lastHush, lastAny: now, last: { ...last, [type]: now } } };
}
// Reactions landing together merge into the strongest.
const PRIORITY = ['hit', 'fall', 'hush', 'stab', 'lift', 'pulse'];
export const mergeReactions = (kinds) => PRIORITY.find((k) => kinds.includes(k)) ?? null;

// The hush at each bar line. hush = { active, start } (start: the bar it began). A fight ends it with the hit;
// otherwise after 16 bars the band returns. Returns the hush with `ending`: 'hit' | 'return' | null.
export function hushStep(hush, { level, bar }) {
  if (!hush.active) return { ...hush, active: false, ending: null };
  if (level >= 2) return { ...hush, active: false, ending: 'hit' };
  if (bar - hush.start >= HUSH_BARS) return { ...hush, active: false, ending: 'return' };
  return { ...hush, active: true, ending: null };
}
