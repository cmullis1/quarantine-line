// The score's sequencer: plays the director's phrases (director.js) in the mood worlds (worlds.js) and songs
// (songs.js) through the bands' instruments and the music mix (instruments.js), and answers the game: reactions on
// the beat, the hush before a horde, the victory and defeat endings. It decides nothing musical beyond arranging
// the parts; the pure modules decide what plays.
//
// Timing: each sixteenth is scheduled a little ahead of the audio clock, one step after the last at the tempo the
// director's glide gives that step, so the grid bends smoothly and never breaks. Swing delays the odd sixteenths of
// every part alike. If the frame loop stalls, the missed steps pass silently on the grid: no catch-up burst.

import { STEPS, BARS_PER_CHORD, PHRASE_BARS, nextLevel } from './score.js';
import { CHORDS, chordTone, foldDown, melodySection } from './harmony.js';
import { WORLDS, BANDS, GROOVES, hitsFor, swingDelay } from './worlds.js';
import { SONGS, ANTHEM, anthemNotes } from './songs.js';
import {
  nextPhrase, tempoAt, fillInto, closingChord, altBar, shapeOf, shapeHitsFor, withOverlay, melodyRests, reaction,
  mergeReactions, hushStep,
} from './director.js';
import { createMusicMix, createInstruments } from './instruments.js';

// Steps are scheduled once they start within this many seconds.
const LOOKAHEAD = 0.3;
const PHRASE_STEPS = PHRASE_BARS * STEPS;
// An outgoing band fades over this many bars while the incoming band's sustained parts swell in.
const CROSSFADE_BARS = 4;
// What marks a beat, besides the bass.
const BEAT = new Set(['kick', 'snare', 'clap', 'taiko']);
// A new groove enters with kick and bass, its hats join in the second bar, and it is complete from the third.
const ENTRY = [new Set(['kick', 'bass']), new Set(['kick', 'bass', 'hat', 'ohat', 'shaker'])];
// The parts' low-passes at night (by day, the mix's own): chords, pad, arp and lead as the score has always had
// them at night, the dark band's 30% lower still; drums and bass as before.
const NIGHT = { drums: 4500, perc: 4500, bass: 450, chords: 650, pad: 650, arp: 1300, lead: 1600 };
const DARKER = new Set(['chords', 'pad', 'arp', 'lead']);
// Arpeggio: a chord-tone index (1–3, the upper voices) per eighth, and per sixteenth in a fight.
const ARP8 = [1, 2, 3, 2, 1, 3, 2, 3];
const ARP16 = [1, 2, 3, 2, 3, 1, 2, 3, 1, 2, 3, 2, 3, 2, 1, 3];
// Steps between arpeggio notes per level (−1 … 3), 0 for none: the warm and synth bands run eighths up to tension
// and sixteenths in a fight; the dark band waits out the calm, then plays quarters, then eighths.
const ARP_EVERY = { warm: [2, 2, 2, 1, 1], synth: [2, 2, 2, 1, 1], dark: [0, 0, 4, 2, 2] };
// The arpeggio's lift above the chord voicing (the dark band's low piano drops an octave by itself).
const ARP_SHIFT = { warm: 12, synth: 12, dark: 0 };
// The chord instruments' loudness against one another.
const CHORD_VEL = { piano: 0.6, stab: 1, choir: 0.8 };
// The dark band's drone: a low A under everything.
const DRONE = 33;
// The switches that change a phrase's plan. Band and groove wait for the next phrase line; swing and shape apply
// step by step.
const PLAN = ['song', 'section', 'mood', 'melody', 'lead'];

// Reactions land on the next beat (every 4 steps) or the next downbeat (16): a sighting's hush or stab, the hit and
// the fall on the downbeat.
const ON = { hit: STEPS, fall: STEPS, hush: STEPS, stab: STEPS, lift: 4, pulse: 4 };
// The hush keeps a heartbeat kick on beats 1 and 3 and the world's drone or pad: the warm band's pad, the synth
// band's held chord (its only sustained part), the dark band's drone alone.
const HUSH_KEEPS = { warm: 'pad', synth: 'chords', dark: 'none' };
const HEARTBEAT = 0.7;
// The breakout's pulse: a low semitone the world's key owns (E–F in C major and A minor, A–B♭ in Dire).
const PULSE = { hopeful: [52, 53], uneasy: [52, 53], dire: [57, 58] };
// The lift's bright sound; the fall's lone voice (in the dark band, the choir far off in its hall).
const BRIGHT = { warm: 'celesta', synth: 'bell', dark: 'bell' };
const LONE = { warm: 'piano', synth: 'piano', dark: 'choir' };
// Under the fall's quote the band drops to 40% for two bars.
const DIP = 0.4;
// The endings (about 30–45 s), in grid steps from their first downbeat. Victory: the anthem at speed, then again at
// speed until its last two bars, which run at half speed (every note and drum twice as long) until the final tonic
// lands; that holds three bars, then the anthem loops quietly. Defeat: the anthem slowing to 80 bpm over the choir,
// home on the tonic; again, sparser, over the drone alone and left on the dominant; then the drone fades to silence
// over eight bars.
const AGAIN = PHRASE_STEPS, BROADEN = AGAIN + 96, LANDS = AGAIN + 144, LOOP = AGAIN + 192;
const DEFEAT_TEMPO = 80, FADE_BARS = 8;
// Hopeful's anthem in a game: its bright lead doubled by the piano an octave below, which keeps the piano's upper
// partial out of the shrill band (score-probe: in unison it lifts the band's 95th percentile above −60 dB).
const DOUBLE = { lead: 'piano', vel: 0.7, shift: -12 };
// The victory's melody: the bell, doubled by the piano.
const VICTORY_LEADS = [['bell', 1], ['piano', 0.7]];
// Uneasy's anthem sings softer.
const UNEASY_ANTHEM = 0.75;

// The arpeggio note on one step of a band at a level: { idx, vel, oct, steps } (steps: until the next one), or null.
export function arpAt(band, level, step) {
  const every = ARP_EVERY[band][Math.max(-1, Math.min(3, level)) + 1];
  if (!every || step % every) return null;
  if (every === 1) return { idx: ARP16[step], vel: 0.8, oct: level >= 3 ? 12 : 0, steps: 1 };
  return { idx: ARP8[step / 2], vel: level < 0 ? 0.5 : 0.75, oct: 0, steps: every };
}
// Its pitch over a chord: the chord tone lifted for the band, never above A5 (the shrill rule).
export const arpMidi = (band, chord, n) => foldDown(CHORDS[chord][n.idx] + ARP_SHIFT[band] + n.oct);

// The song's own bass line (its identity) in place of the groove's at levels 0–1. A beat it leaves unmarked keeps
// the groove's bass there, so the pulse is never in doubt.
function withIdentity(hits, song, level, step) {
  const line = SONGS[song].bass;
  if (!line || level < 0 || level > 1) return hits;
  const rest = hits.filter((h) => h.inst !== 'bass');
  const own = line.filter(([s]) => s === step).map(([, deg]) => ({ inst: 'bass', deg, vel: level === 0 ? 0.6 : 0.85 }));
  if (own.length || step % 4 || rest.some((h) => BEAT.has(h.inst))) return [...rest, ...own];
  return hits;
}

const barSeconds = (tempo) => (STEPS * 60) / tempo / 4;
const pinsOf = (st) => ({ song: st.song, section: st.section, mood: st.mood, band: st.band, groove: st.groove, melody: st.melody, lead: st.lead });

// The sequencer on `musicBus`, starting a fifth of a second from now. lab = { style, levelOverride }: the lab's
// switches (style.js) and pinned level (null for the game's own).
export function createSequencer(ctx, synth, musicBus, lab) {
  const mix = createMusicMix(ctx, musicBus, synth.makeImpulse);
  const inst = createInstruments(synth, mix);
  let { style, levelOverride } = lab;
  // Every band part's low-pass with its daytime frequency, for night.
  const filters = Object.keys(BANDS).flatMap((band) => Object.keys(NIGHT).map((role) => {
    const f = mix.route(band, role);
    return { band, role, f, day: f.frequency.value };
  }));
  const sc = {
    // The phrase playing, the one before it, and how many have started.
    phrase: null, before: null, phrases: 0,
    // The next step to schedule, its time, and the tempo and length of the last one scheduled; steps so far.
    bar: 0, step: 0, nextStep: ctx.currentTime + 0.2, tempo: 0, stepLen: 0, n: 0,
    // Intensity, and the level before a rise or a fall in this bar (null when it did not).
    level: 0, calmBars: 0, rise: null, fall: null,
    // The chord and the melody notes of the current two bars; whether this phrase closes with a fill.
    chord: 'Am', notes: [], fill: false,
    // This phrase arrived with a new song or mood; brings a new groove; fades out a band.
    arrival: false, entering: false, outgoing: null,
    // The phrase count at the last braam; on the step being scheduled, the accents (crash, braam), the tonal parts
    // started, the reaction's notes and their pitches, the melody's instruments and the arpeggio's loudness (all for
    // the trace).
    braam: -Infinity, accents: [], tones: [], answer: [], pitches: [], leads: [], arpVel: null,
    // The mood whose reverb is open.
    verb: null,
    // The game's state, from update().
    night: false, threat: 0, paused: false, dire: 0, act: 1, menu: false, over: false,
    // Reactions: the director's memory of them, the one waiting for its beat, the one playing ({ start, notes,
    // end, solo, dip }).
    react: {}, pending: null, voice: null,
    // The hush before a horde ({ active, start }, null while none is held) and the band's return after it ({ bar },
    // for two bars).
    hush: null, back: null,
    // The ending playing ({ won, bar }), one asked for at the next downbeat, a return to the score asked for, and the
    // new game's first phrase to plan from its own mood.
    ending: null, endAsk: null, resume: false, restart: false,
  };

  const inputs = (bar, pins = pinsOf(style)) => ({ bar, dire: sc.dire, act: sc.act, menu: sc.menu, level: sc.level, pins });
  // Reactions, the hush and the endings as they start, for tests (inert unless a test creates the array).
  const trace = (kind, t) => globalThis.__reactionTrace?.push({ t, bar: sc.bar, step: sc.step, kind, mood: sc.phrase.mood, band: sc.phrase.band });

  // A tonal part's note (named in the trace).
  function sound(name, band, t, opts) {
    inst.play(name, band, t, opts);
    sc.tones.push(name);
  }
  function accent(name, band, t, opts) {
    inst.play(name, band, t, opts);
    sc.accents.push(name);
  }

  // The mood's reverb (spec 5.13: a pinned band keeps it): opened at once with the first phrase, then crossfaded
  // over the bands' four bars as the mood turns.
  function verbTo(mood, t, tempo) {
    if (sc.verb === mood) return;
    const lag = sc.verb ? (barSeconds(tempo) * CROSSFADE_BARS) / 3 : 0.01;
    mix.setReverb(mood, Math.max(ctx.currentTime, sc.verb ? t : t - 0.05), lag);
    sc.verb = mood;
  }
  // The anthem's setting (spec 5.5), outside the endings: the mood it plays in, or null for any other melody.
  const anthemIn = () => (sc.phrase.pick.kind === 'anthem' ? sc.phrase.mood : null);
  // The groove whose swing plays: the phrase's own on Auto, the bounce's pinned on, none pinned off.
  const swingGroove = (p) => (style.swing === 'off' ? null : style.swing === 'on' ? 'bounce' : p.groove);

  // ---- phrase, bar and chord lines ----

  function phraseLine(t, silent) {
    const prev = sc.phrase;
    const p = nextPhrase(prev, { ...inputs(sc.bar), restart: sc.restart });
    sc.restart = false;
    sc.before = prev;
    sc.phrase = p;
    sc.phrases++;
    verbTo(p.mood, t, p.tempoFrom);
    // A new section is no arrival: big accents come with a new song or mood.
    sc.arrival = !!prev && (prev.song !== p.song || prev.mood !== p.mood);
    sc.entering = !!prev && prev.groove !== p.groove;
    // The incoming band has been silent, so it opens at once (its parts enter sparsely and swell); the outgoing
    // one fades over four bars while its sustained parts play on.
    if (!prev || p.crossfade) mix.setBand(p.band, 1, Math.max(ctx.currentTime, t - 0.05), 0.01);
    sc.outgoing = null;
    if (p.crossfade) {
      mix.setBand(p.crossfade.from, 0, Math.max(ctx.currentTime, t), (barSeconds(p.tempoFrom) * CROSSFADE_BARS) / 3);
      sc.outgoing = { band: p.crossfade.from, until: sc.bar + CROSSFADE_BARS };
    }
    if (silent) return;
    const band = BANDS[p.band];
    if (band.drone) {
      const len = barSeconds(p.tempoFrom) * PHRASE_BARS;
      sound(band.drone, p.band, t, { midi: DRONE, len, hold: len, vel: 0.7 });
    }
    // Big accents only on an arrival, while the drums play and no hush holds: a crash, and the dark band's braam,
    // which never comes in two phrases running.
    if (!sc.arrival || sc.level < 0 || sc.hush) return;
    accent('crash', p.band, t, { vel: 1 });
    if (band.braam && sc.phrases - sc.braam >= 2) {
      accent('braam', p.band, t, { midi: CHORDS[p.loop[0]][0], vel: 1 });
      sc.braam = sc.phrases;
    }
  }

  function barLine(t, silent) {
    const n = nextLevel(sc.level, sc.threat, sc.calmBars, sc.paused);
    // The title music stays out of a fight; a level pinned in the lab plays as pinned.
    const level = levelOverride ?? (sc.menu ? Math.min(1, n.level) : n.level);
    sc.rise = level > sc.level ? sc.level : null;
    sc.fall = level < sc.level ? sc.level : null;
    sc.level = level;
    sc.calmBars = n.calmBars;
    // Back from an ending: the director's next phrase starts on this downbeat (the count moves on to its line), in
    // the mood the country asks for now, gliding on from where the ending's tempo has got to.
    if (sc.resume) {
      sc.resume = false;
      if (sc.ending) {
        sc.ending = null;
        sc.restart = true;
        sc.phrase.tempoTo = sc.tempo;
        sc.bar = Math.ceil(sc.bar / PHRASE_BARS) * PHRASE_BARS;
      }
    }
    if (sc.endAsk && sc.phrase) startEnding(t, silent);
    if (sc.ending) return;
    if (sc.back && sc.bar - sc.back.bar >= 2) sc.back = null;
    if (sc.hush) hushLine(t, silent);
    const pb = sc.bar % PHRASE_BARS;
    if (pb === 0) phraseLine(t, silent);
    // A fill closes the phrase only into a change, only once there is a beat to fill, and never in a hush.
    if (pb === PHRASE_BARS - 1) sc.fill = sc.level >= 1 && !sc.hush && fillInto(sc.phrase, inputs(sc.bar));
    // A reaction due on this downbeat plays the bar's chord, and starts before the chord line, so a hush beginning
    // here already holds it. The phrase's last chord pivots into a mood change (director.js closingChord).
    const chordBar = sc.bar % BARS_PER_CHORD === 0;
    if (chordBar) sc.chord = pb === PHRASE_BARS - BARS_PER_CHORD ? closingChord(sc.phrase, inputs(sc.bar)) : sc.phrase.loop[pb / BARS_PER_CHORD];
    if (!silent) fire(t);
    if (chordBar) {
      if (!silent) chordLine(t, pb);
      sections();
    }
  }

  // Each chord's sustained parts: the band's chords and pad and, through a crossfade, the outgoing band's as well
  // (its bus fading) while the incoming band's swell in. A hush keeps only the world's pad.
  function chordLine(t, pb) {
    const p = sc.phrase;
    const len = barSeconds(tempoAt(p, pb, 0)) * BARS_PER_CHORD;
    sustain(p.band, t, len, p.crossfade && pb < CROSSFADE_BARS ? 0.5 + (0.5 * pb) / CROSSFADE_BARS : 1, sc.hush ? HUSH_KEEPS[p.band] : null);
    if (sc.outgoing && sc.bar < sc.outgoing.until && !sc.hush) sustain(sc.outgoing.band, t, len, 1);
  }

  // `only`: 'chords' or 'pad' to play just that part, 'none' for neither.
  function sustain(band, t, len, k, only = null) {
    const b = BANDS[band];
    const [root, ...upper] = CHORDS[sc.chord];
    for (const m of upper) {
      if (b.chords && (!only || only === 'chords')) sound(b.chords, band, t, { midi: m, len, vel: (CHORD_VEL[b.chords] ?? 1) * k });
      if (b.pad && (!only || only === 'pad')) sound(b.pad, band, t, { midi: m, len, vel: k });
    }
    // At night the dark band keeps a sub root under its chords, as the score's pad always had.
    if (sc.night && band === 'dark') sound('subDrone', band, t, { midi: root - 12, len, vel: 0.3 * k, role: 'pad' });
  }

  // The melody for the current two bars: the director's pick (with a hook layered over it in a fight) composed
  // over the chord in the world's scale, or the stretch of the anthem these two bars carry.
  function sections() {
    const p = sc.phrase;
    const pb = sc.bar % PHRASE_BARS, first = pb - (pb % BARS_PER_CHORD);
    const { kind, lead, over } = p.pick;
    if (kind === 'anthem') {
      const from = first * STEPS, to = from + BARS_PER_CHORD * STEPS;
      sc.notes = anthemNotes(p.mood).filter((n) => n.s >= from && n.s < to).map((n) => ({ ...n, s: n.s - from, voice: 'lead', lead }));
      return;
    }
    const opts = { scale: p.world.scale, shift: p.world.shift };
    const main = melodySection(kind, p.mel, first, sc.chord, sc.level, opts).map((n) => ({ ...n, lead: n.voice === 'answer' ? 'answer' : lead }));
    const layer = over ? melodySection(over.kind, p.mel, first, sc.chord, sc.level, opts).map((n) => ({ ...n, voice: 'lead', lead: over.lead })) : [];
    sc.notes = [...main, ...layer];
  }

  // ---- reactions and the hush ----

  // The hush at a bar line: held; ended by a fight with the hit (on this downbeat); or over after 16 bars, the
  // band coming back over two.
  function hushLine(t, silent) {
    const h = hushStep(sc.hush, { level: sc.level, bar: sc.bar });
    sc.hush = h.active ? { active: true, start: h.start } : null;
    if (h.ending === 'hit') sc.pending = { kind: mergeReactions([sc.pending?.kind, 'hit']) };
    if (h.ending === 'return') {
      sc.back = { bar: sc.bar };
      if (!silent) trace('return', t);
    }
  }

  // A reaction waiting for this beat (or downbeat) starts here.
  function fire(at) {
    const want = sc.pending;
    if (!want || sc.step % ON[want.kind]) return;
    sc.pending = null;
    // A sighting never hushes a fight, and the fight may have started while it waited.
    const kind = want.kind === 'hush' && sc.level >= 2 ? 'stab' : want.kind;
    trace(kind, at);
    if (kind === 'hush') {
      sc.hush = { active: true, start: sc.bar };
      sc.back = null;
      return;
    }
    // The hit is the full band again: it ends a hush at once. A new answer cuts short the one playing.
    if (kind === 'hit') sc.hush = sc.back = null;
    if (sc.voice?.dip) mix.dip(1, at, 0.02);
    const v = answer(kind, at);
    sc.voice = { start: sc.n, end: Math.max(v.solo ?? 0, ...v.notes.map((x) => x.o)), ...v };
  }

  // What a reaction plays, in the current key on the band's own instruments: notes { o (steps from its start),
  // name, midi, vel, len (steps), role, quote }, and for the fall a solo span (the melody rests) and the dip.
  function answer(kind, at) {
    const p = sc.phrase, b = BANDS[p.band], [root, ...upper] = CHORDS[sc.chord];
    const note = (o, name, midi, vel, len, extra) => ({ o, name, midi, vel, len, ...extra });
    // A low chord, struck once.
    if (kind === 'stab') return { notes: upper.map((m) => note(0, b.chords, m - 12, 1, 3)) };
    // The hit: kick, bass, the band's chord, a crash, and a braam (Uneasy, Dire) or the chord doubled an octave up
    // (Hopeful); no second crash or braam when the phrase line just played one.
    if (kind === 'hit') {
      const notes = [note(0, 'kick', undefined, 1, 1), note(0, b.bass, root, 1, 4), ...upper.map((m) => note(0, b.chords, m, 1, STEPS))];
      if (!sc.accents.includes('crash')) notes.push(note(0, 'crash', undefined, 1, 0));
      if (p.mood === 'hopeful') notes.push(...upper.map((m) => note(0, b.chords, m + 12, 0.8, STEPS)));
      else if (!sc.accents.includes('braam')) notes.push(note(0, 'braam', root, 1, 0));
      if (b.pad) notes.push(...upper.map((m) => note(0, b.pad, m, 1, STEPS)));
      return { notes };
    }
    // The fall: the anthem's first two bars at half speed on one voice, the band dipped under it for two bars.
    if (kind === 'fall') {
      const bar = barSeconds(sc.tempo);
      mix.dip(DIP, at, 0.05);
      mix.dip(1, at + 2 * bar, bar / 3);
      const notes = anthemNotes(p.mood).filter((x) => x.s < BARS_PER_CHORD * STEPS)
        .map((x) => note(2 * x.s, LONE[p.band], x.midi, 0.9, 2 * x.len, { role: 'lead', quote: true }));
      return { notes, solo: 2 * BARS_PER_CHORD * STEPS, dip: true };
    }
    // The lift: a rising run of chord tones in sixteenths into the chord an octave up, on a bright sound.
    if (kind === 'lift') {
      const run = [1, 2, 3, 4].map((k, i) => note(i, BRIGHT[p.band], chordTone(sc.chord, k, 0), 0.6 + 0.1 * i, 2));
      const top = [1, 2, 3].map((k) => note(4, BRIGHT[p.band], foldDown(chordTone(sc.chord, k)), 0.9, STEPS));
      return { notes: [...run, ...top] };
    }
    // The pulse: a low semitone struck together on every eighth for a bar, on the band's arpeggio sound.
    const notes = [];
    for (let o = 0; o < STEPS; o += 2) for (const m of PULSE[p.mood]) notes.push(note(o, b.arp, m, o % 4 ? 0.6 : 0.9, 2, { role: 'arp' }));
    return { notes };
  }

  // The reaction playing: its notes due on this step.
  function voice(at) {
    const v = sc.voice;
    if (!v) return;
    const o = sc.n - v.start, band = sc.phrase.band;
    for (const x of v.notes) {
      if (x.o !== o) continue;
      if (x.name === 'kick') mix.duck(at);
      inst.play(x.name, band, at, { midi: x.midi, vel: x.vel, len: x.len * sc.stepLen, role: x.role });
      if (x.quote) globalThis.__melodyTrace?.push({ t: at, midi: x.midi, voice: 'quote', melody: 'fall', lead: x.name }); // tests only
      else {
        sc.answer.push(x.name);
        sc.pitches.push(x.midi);
      }
    }
    if (o >= v.end) sc.voice = null;
  }

  // How far the band has come back after a hush: from half strength to full over two bars (1 when not returning).
  const swell = () => (sc.back ? 0.5 + (0.5 * ((sc.bar - sc.back.bar) * STEPS + sc.step)) / (2 * STEPS) : 1);

  // The hush: a heartbeat kick on beats 1 and 3; over its first bar the rest of the drums fade away under it.
  function hushed(hits, s) {
    const beat = sc.level >= 0 && s % 8 === 0 ? [{ inst: 'kick', vel: HEARTBEAT }] : [];
    if (sc.bar !== sc.hush.start) return beat;
    const k = 1 - s / STEPS;
    return [...beat, ...hits.filter((h) => h.inst !== 'riser' && !(beat.length && h.inst === 'kick')).map((h) => ({ ...h, vel: h.vel * k }))];
  }

  // ---- the endings ----

  // The ending asked for begins on this downbeat, wherever the phrase is: the anthem in Hopeful (victory) or Dire
  // (defeat) on that world's band, any other band fading, the tempo gliding over a phrase from where it is. Nothing
  // of the moment before carries in: no hush, no reaction, no fading band's chords.
  function startEnding(t, silent) {
    const { won } = sc.endAsk;
    const prev = sc.phrase, mood = won ? 'hopeful' : 'dire', world = WORLDS[mood], band = world.band;
    sc.endAsk = null;
    sc.ending = { won, bar: sc.bar };
    sc.before = prev;
    sc.phrase = {
      ...prev, bar: sc.bar, song: 'anthem', section: 'A', mood, moodPending: null, world, band, groove: world.groove,
      loop: ANTHEM.harmony[mood], pick: { kind: 'anthem', lead: won ? VICTORY_LEADS[0][0] : 'lowPiano', over: null },
      tempoFrom: sc.tempo, tempoTo: won ? world.tempo : DEFEAT_TEMPO,
      crossfade: prev.band === band ? null : { from: prev.band, to: band }, fillInto: false, quote: true,
    };
    if (sc.voice?.dip) mix.dip(1, t, 0.05);
    Object.assign(sc, { hush: null, back: null, pending: null, voice: null, fill: false, entering: false, rise: null, fall: null });
    mix.setBand(band, 1, Math.max(ctx.currentTime, t - 0.05), 0.01);
    verbTo(mood, t, sc.tempo);
    for (const other of new Set([prev.band, sc.outgoing?.band])) {
      if (other && other !== band) mix.setBand(other, 0, Math.max(ctx.currentTime, t), (barSeconds(sc.tempo) * CROSSFADE_BARS) / 3);
    }
    sc.outgoing = null;
    if (!silent) trace(won ? 'victory' : 'defeat', t);
  }

  // One step of the ending: the drum hits it played.
  function endingStep(at) {
    const g = (sc.bar - sc.ending.bar) * STEPS + sc.step;
    return sc.ending.won ? victory(at, g) : defeat(at, g);
  }

  function victory(at, g) {
    if (g === LANDS) return landing(at);
    if (g > LANDS && g < LOOP) return [];
    const loop = g >= LOOP, half = !loop && g >= BROADEN;
    if (half && (g - BROADEN) % 2) return [];
    const pos = loop ? (g - LOOP) % PHRASE_STEPS : half ? BROADEN - AGAIN + (g - BROADEN) / 2 : g % PHRASE_STEPS;
    return anthemStep(at, pos, half ? 2 : 1, loop ? -1 : 2, g === 0);
  }

  // One step of the anthem with the full band at `level` (−1: no drums): its chord every two bars, drums, bass,
  // arpeggio and the melody. `stretch` 2 plays it at half speed on the grid: every length doubled.
  function anthemStep(at, pos, stretch, level, arrive) {
    const p = sc.phrase, s = pos % STEPS, bar = Math.floor(pos / STEPS);
    if (s === 0 && bar % BARS_PER_CHORD === 0) {
      sc.chord = p.loop[bar / BARS_PER_CHORD];
      // In the broadening the chord holds until the final tonic lands.
      sustain(p.band, at, (stretch === 2 ? LANDS - BROADEN : BARS_PER_CHORD * STEPS) * sc.stepLen, 1);
    }
    if (arrive) accent('crash', p.band, at, { vel: 1 });
    const hits = hitsFor(p.groove, level, s, bar % PHRASE_BARS);
    for (const h of hits) hit(h, at);
    const n = arpAt(p.band, level, s);
    if (n) sound(BANDS[p.band].arp, p.band, at, { midi: arpMidi(p.band, sc.chord, n), vel: n.vel, len: sc.stepLen * n.steps * stretch, role: 'arp' });
    for (const x of anthemNotes(p.mood)) if (x.s === pos) sing(x.midi, at, x.len * stretch, level < 0 ? 0.65 : 1, VICTORY_LEADS);
    return hits;
  }

  // The final tonic: the anthem's last note on the tonic chord under a crash, held until the loop.
  function landing(at) {
    const p = sc.phrase, len = (LOOP - LANDS) * sc.stepLen;
    sc.chord = p.loop.at(-1);
    sustain(p.band, at, len, 1);
    accent('crash', p.band, at, { vel: 1 });
    const hits = [{ inst: 'kick', vel: 1 }, { inst: 'bass', deg: 0, vel: 1 }];
    for (const h of hits) hit(h, at);
    sing(anthemNotes(p.mood).at(-1).midi, at, LOOP - LANDS, 1, VICTORY_LEADS);
    return hits;
  }

  function defeat(at, g) {
    const p = sc.phrase, second = g >= PHRASE_STEPS, pos = g % PHRASE_STEPS;
    if (g >= 2 * PHRASE_STEPS) return [];
    // The first time the choir holds the anthem's chords, closing on the tonic chord under the melody's tonic.
    if (!second && pos % (BARS_PER_CHORD * STEPS) === 0) {
      const k = pos / (BARS_PER_CHORD * STEPS);
      sc.chord = k === p.loop.length - 1 ? p.loop[0] : p.loop[k];
      const len = BARS_PER_CHORD * STEPS * sc.stepLen;
      for (const m of CHORDS[sc.chord].slice(1)) sound('choir', p.band, at, { midi: m, len, vel: CHORD_VEL.choir });
    }
    // The second time the drone alone holds under it, then fades to silence over eight bars.
    if (g === PHRASE_STEPS) {
      const len = PHRASE_STEPS * sc.stepLen;
      sound(BANDS[p.band].drone, p.band, at, { midi: DRONE, len, hold: len, release: barSeconds(sc.tempo) * FADE_BARS, vel: 0.7 });
    }
    for (const x of anthemNotes(p.mood, second)) if (x.s === pos) sing(x.midi, at, x.len, 1, [['lowPiano', 1]]);
    return [];
  }

  // An ending's melody note, `steps` long, on [[lead, loudness], ...] together.
  function sing(midi, at, steps, vel, leads) {
    const p = sc.phrase;
    for (const [lead, k] of leads) inst.play(lead, p.band, at, { midi, len: sc.stepLen * steps, vel: vel * k, role: 'lead' });
    globalThis.__melodyTrace?.push({ t: at, midi, voice: 'lead', melody: 'anthem', lead: leads[0][0] }); // tests only
  }

  // ---- one step ----

  // The drums and bass a level plays on this step: the groove's pattern, the song's overlay (from tension up, not in
  // a breath or a hush), the shape and the song's bass line, in the anthem's setting: an Uneasy anthem keeps to
  // tension's pattern without the overlay, a Dire one to the kick on the downbeat and the bass.
  function layerAt(level, s, pb, opts) {
    const p = sc.phrase, anthem = anthemIn(), shape = style.shape === 'on' ? shapeOf(sc.bar) : 'full';
    const L = anthem === 'uneasy' ? Math.min(1, level) : level;
    let hits = hitsFor(p.groove, L, s, pb, opts);
    if (!sc.hush && (!anthem || anthem === 'hopeful')) hits = withOverlay(hits, SONGS[p.song].overlay, L, s, { shape, night: sc.night });
    if (style.shape === 'on') hits = shapeHitsFor(hits, shape, pb, s, L, p.groove);
    hits = withIdentity(hits, p.song, L, s);
    return anthem === 'dire' ? hits.filter((h) => h.inst === 'bass' || (h.inst === 'kick' && s === 0)) : hits;
  }

  function hitsNow() {
    const p = sc.phrase;
    const pb = sc.bar % PHRASE_BARS, s = sc.step;
    const opts = { night: sc.night, alt: altBar(sc.bar), fill: sc.fill };
    let hits = layerAt(sc.level, s, pb, opts);
    // The bar after a fall: the old level's layers this one leaves out fade from full to nothing.
    if (sc.fall !== null) {
      const has = new Set(hits.map((h) => h.inst)), k = 1 - s / STEPS;
      hits = [...hits, ...layerAt(sc.fall, s, pb, opts).filter((h) => !has.has(h.inst)).map((h) => ({ ...h, vel: h.vel * k }))];
    }
    if (sc.entering && pb < ENTRY.length) hits = hits.filter((h) => ENTRY[pb].has(h.inst));
    // The bar after a rise: the new layers come in from half strength.
    if (sc.rise !== null) {
      const had = new Set(layerAt(sc.rise, s, pb, opts).map((h) => h.inst));
      const k = 0.5 + (0.5 * s) / STEPS;
      hits = hits.map((h) => (had.has(h.inst) ? h : { ...h, vel: h.vel * k }));
    }
    // A hush leaves the heartbeat; after it the band returns as a new groove enters, swelling.
    if (sc.hush) hits = hushed(hits, s);
    else if (sc.back) {
      const k = swell();
      hits = hits.filter((h) => ENTRY[sc.bar - sc.back.bar].has(h.inst)).map((h) => ({ ...h, vel: h.vel * k }));
    }
    // The heavy groove's snare on beat 3 is the big one.
    return p.groove === 'heavy' ? hits.map((h) => (h.inst === 'snare' ? { ...h, inst: 'bigSnare' } : h)) : hits;
  }

  function hit(h, at) {
    const band = sc.phrase.band;
    if (h.inst === 'kick') mix.duck(at);
    if (h.inst === 'bass') inst.play(BANDS[band].bass, band, at, { midi: CHORDS[sc.chord][0] + h.deg, vel: h.vel, len: sc.stepLen });
    else if (h.inst === 'tom') inst.play('tom', band, at, { f: 190 - h.n * 22, vel: h.vel });
    else if (h.inst === 'riser') inst.play('riser', band, at, { vel: h.vel, len: sc.stepLen * STEPS * h.bars });
    else inst.play(h.inst, band, at, { vel: h.vel });
  }

  function arp(at) {
    const band = sc.phrase.band;
    // The anthem keeps its arpeggio only in Hopeful's full band.
    const anthem = anthemIn();
    if (anthem && anthem !== 'hopeful') return;
    let n = arpAt(band, sc.level, sc.step), fade = 1;
    // The bar after a fall: the old level's notes this one leaves out fade from full to nothing.
    if (!n && sc.fall !== null) {
      n = arpAt(band, sc.fall, sc.step);
      fade = 1 - sc.step / STEPS;
    }
    if (!n) return;
    // In a hush the arpeggio fades out over its first bar; after it, it swells back with the band.
    let k = swell();
    if (sc.hush) {
      if (sc.bar !== sc.hush.start) return;
      k = 1 - sc.step / STEPS;
    }
    const name = BANDS[band].arp;
    const fresh = sc.rise !== null && !arpAt(band, sc.rise, sc.step);
    sc.arpVel = n.vel * k * fade * (fresh ? 0.5 + (0.5 * sc.step) / STEPS : 1);
    sound(name, band, at, {
      midi: arpMidi(band, sc.chord, n),
      vel: sc.arpVel,
      // Today's pluck takes its decay; the pianos ring for the note's length.
      len: name === 'pluck' ? (sc.night ? 0.45 : 0.28) : sc.stepLen * n.steps,
      bite: sc.level >= 2,
      role: 'arp',
    });
  }

  function melody(at) {
    const p = sc.phrase;
    // The melody rests through a hush and under the fall's quote.
    if (sc.hush || (sc.voice?.solo && sc.n - sc.voice.start < sc.voice.solo)) return;
    // The first half of a breath rests; the anthem is never cut short.
    if (p.pick.kind !== 'anthem' && style.shape === 'on' && melodyRests(shapeOf(sc.bar), sc.bar % PHRASE_BARS)) return;
    const pos = (sc.bar % BARS_PER_CHORD) * STEPS + sc.step;
    // The anthem sings softer in Uneasy; in Hopeful the piano doubles its bright lead an octave below.
    const anthem = anthemIn();
    const vel = (sc.level < 0 ? 0.65 : 1) * (anthem === 'uneasy' ? UNEASY_ANTHEM : 1);
    for (const n of sc.notes) {
      if (n.s !== pos) continue;
      const len = sc.stepLen * n.len;
      inst.play(n.lead, p.band, at, { midi: n.midi, len, vel, role: 'lead' });
      sc.leads.push(n.lead);
      const double = anthem === 'hopeful' && n.lead !== DOUBLE.lead ? n.midi + DOUBLE.shift : null;
      if (double !== null) {
        inst.play(DOUBLE.lead, p.band, at, { midi: double, len, vel: vel * DOUBLE.vel, role: 'lead' });
        sc.leads.push(DOUBLE.lead);
      }
      globalThis.__melodyTrace?.push({ t: at, midi: n.midi, vel, double, voice: n.voice, melody: p.pick.kind, lead: n.voice === 'answer' ? null : n.lead }); // tests only
    }
  }

  function step(t, silent) {
    sc.accents = [];
    sc.tones = [];
    sc.answer = [];
    sc.pitches = [];
    sc.leads = [];
    sc.arpVel = null;
    if (sc.step === 0) barLine(t, silent);
    const p = sc.phrase;
    // An ending glides from where the tempo was over its first phrase, then holds.
    const pb = sc.ending ? Math.min(sc.bar - sc.ending.bar, PHRASE_BARS) : sc.bar % PHRASE_BARS;
    sc.tempo = tempoAt(p, pb, pb === PHRASE_BARS ? 0 : sc.step);
    sc.stepLen = 60 / sc.tempo / 4;
    const sg = swingGroove(p);
    const swing = sg ? swingDelay(sg, sc.step, sc.stepLen) : 0;
    const at = t + swing;
    let hits = [];
    if (!silent && sc.ending) hits = endingStep(at);
    else if (!silent) {
      if (sc.step) fire(at);
      hits = hitsNow();
      for (const h of hits) hit(h, at);
      arp(at);
      melody(at);
      voice(at);
    }
    // Timing trace for tests (Eyes score-timing.mjs); inert unless a test creates the array.
    globalThis.__scoreTrace?.push({
      t: at, now: ctx.currentTime, bar: sc.bar, step: sc.step, level: sc.level, tempo: sc.tempo, stepLen: sc.stepLen, swing,
      song: p.song, section: p.section, mood: p.mood, band: p.band, groove: p.groove, chord: sc.chord,
      insts: [...hits.map((h) => h.inst), ...sc.accents], vels: hits.map((h) => h.vel), tones: sc.tones, leads: sc.leads, arp: sc.arpVel,
      answer: sc.answer, pitches: sc.pitches, ...(silent && { skipped: true }),
    });
    sc.nextStep = t + sc.stepLen;
    sc.n++;
    if (++sc.step === STEPS) {
      sc.step = 0;
      sc.bar++;
    }
  }

  // ---- lab switches ----

  // A switch flipped mid-phrase re-plans it at once. Song, section and mood left on Auto hold where the director
  // put them until the next phrase line, where the band and groove change too; the tune carries on unless the
  // melody, lead or song changed; the tempo turns from where it is toward the new mood's, no faster than a glide.
  function replan(before) {
    const cur = sc.phrase;
    const held = (k) => (style[k] === 'auto' ? cur[k] : style[k]);
    const p = nextPhrase(sc.before, inputs(cur.bar, { ...pinsOf(style), song: held('song'), section: held('section'), mood: held('mood') }));
    if (style.mood === 'auto') p.moodPending = cur.moodPending;
    // Keeping the tune keeps its hook too (a new mood would carry the phrase before's); only a new section brings
    // that section's hook.
    if (['melody', 'lead', 'song'].every((k) => before[k] === style[k])) {
      Object.assign(p, { pick: cur.pick, quote: cur.quote, mel: p.section === cur.section ? cur.mel : p.mel });
    }
    Object.assign(p, { band: cur.band, groove: cur.groove, crossfade: cur.crossfade, tempoFrom: cur.tempoFrom, tempoTo: cur.tempoTo });
    // A new target tempo: a straight line through the last step scheduled that would reach it in one phrase.
    if (p.world.tempo !== cur.world.tempo) {
      const done = (sc.bar - cur.bar) * STEPS + sc.step - 1;
      const slope = (p.world.tempo - sc.tempo) / PHRASE_STEPS;
      Object.assign(p, { tempoFrom: sc.tempo - slope * done, tempoTo: sc.tempo + slope * (PHRASE_STEPS - done) });
    }
    sc.phrase = p;
    verbTo(p.mood, ctx.currentTime, sc.tempo);
    sections();
  }

  function darken(now) {
    for (const { band, role, f, day } of filters) {
      const night = Math.round(NIGHT[role] * (band === 'dark' && DARKER.has(role) ? 0.7 : 1));
      f.frequency.setTargetAtTime(sc.night ? night : day, now, 4);
    }
  }

  return {
    // info = { threat, night, paused, dire, act, menu, over } (already checked by the engine).
    update({ threat, night, paused, dire, act, menu, over }) {
      // An ending holds until the game goes on (a retry) or back to the menu.
      if ((sc.ending || sc.endAsk) && ((sc.over && !over) || (!sc.menu && menu))) {
        sc.endAsk = null;
        sc.resume = !!sc.ending;
      }
      Object.assign(sc, { threat, paused, dire, act, menu, over });
      const now = ctx.currentTime;
      if (night !== sc.night) {
        sc.night = night;
        darken(now);
      }
      while (sc.nextStep < now + LOOKAHEAD) step(sc.nextStep, sc.nextStep < now);
    },
    // Game events the score answers (audio.js scoreEvent). A reaction waits for its beat, merged with any already
    // waiting into the strongest (director.js); 'victory' / 'defeat' start the ending on the next downbeat, and
    // until the game goes on nothing else is answered.
    react(types) {
      const kinds = [sc.pending?.kind];
      for (const type of types) {
        if (type === 'victory' || type === 'defeat') {
          sc.endAsk = { won: type === 'victory' };
          continue;
        }
        if (sc.ending || sc.endAsk) continue;
        const r = reaction(type, ctx.currentTime, sc.react, sc.level);
        sc.react = r.state;
        kinds.push(r.kind);
      }
      const kind = sc.ending || sc.endAsk ? null : mergeReactions(kinds);
      sc.pending = kind ? { kind } : null;
    },
    restyle(next) {
      const before = style;
      style = next;
      // A lab switch during an ending brings the score back at the next downbeat, on the new switches.
      if (sc.ending) {
        sc.resume = true;
        return;
      }
      // A phrase line not yet played brings the new plan with it.
      if (!sc.phrase || (sc.step === 0 && sc.bar % PHRASE_BARS === 0) || PLAN.every((k) => before[k] === next[k])) return;
      replan(before);
    },
    setLevelOverride(level) { levelOverride = level; },
    info() {
      const p = sc.phrase;
      if (!p) return null;
      return {
        song: p.song, section: p.section, mood: p.mood, dire: +sc.dire.toFixed(2), tempo: +sc.tempo.toFixed(2),
        tempoTo: sc.ending ? p.tempoTo : p.world.tempo,
        band: p.band, groove: p.groove, swing: GROOVES[swingGroove(p)]?.swing > 0, kind: p.pick.kind, lead: p.pick.lead, over: p.pick.over,
        shape: style.shape === 'on' ? shapeOf(sc.bar) : 'steady', level: sc.level, bar: sc.bar, chord: sc.chord,
        hook: p.mel.hook + 1, riff: p.mel.riff + 1, hush: !!sc.hush?.active,
        ending: sc.ending ? (sc.ending.won ? 'victory' : 'defeat') : null, auto: levelOverride === null,
      };
    },
  };
}
