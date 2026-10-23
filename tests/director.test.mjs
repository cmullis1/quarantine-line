import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  direness, nextMood, MOODS, shapeOf, melodyRests,
  nextPhrase, pickForPhrase, tempoAt, fillInto, altBar, reaction, mergeReactions, hushStep, shapeHitsFor,
  withOverlay, moodTurn, closingChord,
} from '../js/audio/director.js';
import { WORLDS, BANDS, GROOVES, hitsFor, sharedChords } from '../js/audio/worlds.js';
import { SONGS } from '../js/audio/songs.js';

const ok = (n) => Array.from({ length: n }, () => ({ status: 'ok', alerted: false, breakout: false }));
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
// Plan one phrase per bar in `bars` from `prev`, with the same inputs.
const plan = (prev, bars, inputs, rand = seeded(5)) => bars.map((bar) => (prev = nextPhrase(prev, { ...inputs, bar }, rand)));
const phraseBars = (n, from = 0) => Array.from({ length: n }, (_, k) => from + k * 8);

test('a fresh country is hopeful; a collapsing one is dire', () => {
  const fresh = direness({ towns: ok(8), trust: 60, order: 70, act: 1 });
  assert.ok(fresh < 0.3, `fresh ${fresh}`);
  const towns = [...ok(4), ...Array.from({ length: 4 }, () => ({ status: 'fallen' }))];
  towns[0].breakout = true; towns[1].alerted = true; towns[2].breakout = true;
  const collapsing = direness({ towns, trust: 20, order: 35, act: 3 });
  assert.ok(collapsing > 0.65, `collapsing ${collapsing}`);
  const strained = direness({ towns: ok(8).map((t, i) => ({ ...t, alerted: i < 3 })), trust: 40, order: 55, act: 2 });
  assert.ok(strained >= 0.3 && strained < 0.5, `strained ${strained}`);
  assert.ok(direness({ towns: ok(8), trust: 65, order: 70, act: 4 }) < 0.2, 'the act alone keeps a well-run country hopeful');
});

test('the mood changes only after two phrases ask for it, with hysteresis at each boundary', () => {
  let st = nextMood('hopeful', 0.9);
  assert.deepEqual(st, { mood: 'hopeful', pending: 'uneasy' });
  st = nextMood(st.mood, 0.9, st.pending);
  assert.equal(st.mood, 'uneasy');
  assert.equal(nextMood('dire', 0.52).mood, 'dire', 'just under the line does not lift a dire mood');
  assert.equal(nextMood('hopeful', 0.28).pending, null, 'just over the line does not darken a hopeful one');
  st = nextMood('uneasy', 0.9);
  assert.deepEqual(st, { mood: 'uneasy', pending: 'dire' });
  st = nextMood(st.mood, 0.1, st.pending);
  assert.deepEqual(st, { mood: 'uneasy', pending: 'hopeful' }, 'a different second answer restarts the wait');
});

test('the mood moves one step at a time', () => {
  const walk = (mood, dire, n) => {
    let st = { mood, pending: null };
    return Array.from({ length: n }, () => (st = nextMood(st.mood, dire, st.pending)).mood);
  };
  assert.deepEqual(walk('hopeful', 0.9, 4), ['hopeful', 'uneasy', 'uneasy', 'dire']);
  assert.deepEqual(walk('dire', 0, 4), ['dire', 'uneasy', 'uneasy', 'hopeful']);
  // The same through the phrase planner: never from bright to grim in one go.
  const start = nextPhrase(null, { bar: 0, dire: 0, act: 1, level: 0 }, seeded(1));
  assert.equal(start.mood, 'hopeful');
  const moods = plan(start, phraseBars(4, 8), { dire: 0.9, act: 1, level: 0 }).map((p) => p.mood);
  assert.deepEqual(moods, ['hopeful', 'uneasy', 'uneasy', 'dire']);
});

test('one transition when song, section and mood change together', () => {
  const rand = seeded(2);
  let p = null;
  for (const bar of [0, 8, 16]) p = nextPhrase(p, { bar, dire: 0, act: 1, level: 0 }, rand);
  p = nextPhrase(p, { bar: 24, dire: 0.4, act: 1, level: 0 }, rand);
  assert.deepEqual([p.song, p.section, p.mood, p.moodPending], ['act1', 'A', 'hopeful', 'uneasy']);
  assert.deepEqual([p.tempoFrom, p.tempoTo, p.crossfade], [112, 112, null]);
  assert.equal(p.fillInto, true, 'a fill leads into the change');
  const turn = nextPhrase(p, { bar: 32, dire: 0.4, act: 2, level: 0 }, rand);
  assert.deepEqual([turn.song, turn.section, turn.mood, turn.cycle], ['act2', 'B', 'uneasy', 1]);
  assert.deepEqual(turn.crossfade, { from: 'warm', to: 'synth' }, 'one crossfade');
  assert.deepEqual([turn.tempoFrom, turn.tempoTo], [112, 104], 'one glide');
  assert.deepEqual([turn.band, turn.groove, turn.world], ['synth', 'standard', WORLDS.uneasy]);
  assert.deepEqual([turn.pick.kind, turn.quote], ['anthem', true], 'the new song opens on the anthem');
  const after = nextPhrase(turn, { bar: 40, dire: 0.4, act: 2, level: 0 }, rand);
  assert.equal(after.crossfade, null);
  assert.deepEqual([after.tempoFrom, after.tempoTo], [104, 104], 'the glide has landed');
  assert.equal(after.quote, false);
});

test('a new mood starts on a shared chord', () => {
  const isRotation = (loop, of) => of.some((_, k) => loop.every((c, i) => c === of[(i + k) % of.length]));
  const songs = Object.keys(SONGS);
  let turned = null;
  for (const from of MOODS) for (const to of MOODS) for (const prevSong of songs) for (const song of songs) for (const section of ['A', 'B']) {
    const prev = nextPhrase(null, { bar: 0, pins: { song: prevSong, section, mood: from } }, seeded(3));
    const next = nextPhrase(prev, { bar: 8, pins: { song, section, mood: to } }, seeded(3));
    const own = SONGS[song].sections[section][to];
    const shared = sharedChords(from, to);
    const label = `${prevSong}→${song} ${section} ${from}→${to}: ${next.loop}`;
    assert.equal(next.loop.length, 4, label);
    assert.ok(isRotation(next.loop, own), `the loop is the section's own, turned: ${label}`);
    if (own.some((c) => shared.includes(c))) assert.ok(shared.includes(next.loop[0]), label);
    if (prevSong === song && from === to) assert.deepEqual(next.loop, own, `nothing changed: ${label}`);
    if (next.loop[0] !== own[0]) turned = { next, pins: { song, section, mood: to } };
  }
  assert.ok(turned, 'at least one loop had to turn to reach a shared chord');
  // The turned loop keeps turning that way until something changes.
  const again = nextPhrase(turned.next, { bar: 16, pins: turned.pins }, seeded(3));
  assert.deepEqual(again.loop, turned.next.loop);
  // A section change alone plays the new section's loop as written.
  const a = nextPhrase(null, { bar: 24, act: 1, dire: 0 }, seeded(3));
  const b = nextPhrase(a, { bar: 32, act: 1, dire: 0 }, seeded(3));
  assert.deepEqual(b.loop, SONGS.act1.sections.B.hopeful);
});

test('the melody carries into a new mood, re-harmonised, and the director moves on from the phrase after', () => {
  const rand = seeded(7);
  const [open, before] = plan(null, [0, 8], { act: 2, level: 1, pins: { mood: 'hopeful' } }, rand);
  assert.equal(open.pick.kind, 'anthem', 'the song opens on the anthem');
  assert.notEqual(before.pick.kind, 'anthem');
  const turn = nextPhrase(before, { bar: 16, act: 2, level: 1, pins: { mood: 'uneasy' } }, rand);
  assert.equal(turn.mood, 'uneasy');
  assert.deepEqual(turn.crossfade, { from: 'warm', to: 'synth' });
  assert.deepEqual([turn.pick, turn.mel, turn.quote], [before.pick, before.mel, false], 'the same tune, kind, hook, riff and lead');
  assert.notDeepEqual(turn.loop, before.loop, 'over the new world\'s chords');
  const after = nextPhrase(turn, { bar: 24, act: 2, level: 1, pins: { mood: 'uneasy' } }, rand);
  assert.ok(after.pick.kind !== turn.pick.kind || after.pick.lead !== turn.pick.lead, 'then the director moves on');
  // The same when the country turns the mood (Auto), and across a section change: the hook it was playing goes on.
  const start = nextPhrase(null, { bar: 0, act: 2, level: 1, dire: 0 }, seeded(9));
  const ps = [start, ...plan(start, phraseBars(4, 8), { act: 2, level: 1, dire: 0.9 }, seeded(9))];
  assert.deepEqual(ps.map((p) => p.mood), ['hopeful', 'hopeful', 'uneasy', 'uneasy', 'dire']);
  for (const k of [2, 4]) assert.deepEqual([ps[k].pick, ps[k].mel], [ps[k - 1].pick, ps[k - 1].mel], `the turn at bar ${8 * k}`);
  const crossing = nextPhrase(before, { bar: 32, act: 2, level: 1, pins: { mood: 'dire' } }, rand);
  assert.equal(crossing.section, 'B');
  assert.deepEqual([crossing.pick, crossing.mel], [before.pick, before.mel], 'section A\'s hook carries into B');
  // A new song still opens on the anthem; the anthem itself is never carried into a second phrase.
  const song = nextPhrase(before, { bar: 16, act: 3, level: 1, pins: { mood: 'uneasy' } }, rand);
  assert.deepEqual([song.song, song.pick.kind, song.quote], ['act3', 'anthem', true]);
  const past = nextPhrase(open, { bar: 8, act: 2, level: 1, pins: { mood: 'uneasy' } }, rand);
  assert.notEqual(past.pick.kind, 'anthem');
});

test('sections alternate every 32 bars; the anthem is quoted once every second cycle and opens a new song', () => {
  const bars = phraseBars(24);
  const ps = plan(null, bars, { dire: 0, act: 1, level: 0 });
  assert.equal(ps.map((p) => p.section).join(''), 'AAAABBBBAAAABBBBAAAABBBB');
  assert.deepEqual(ps.map((p) => p.cycle), bars.map((b) => Math.floor(b / 32)));
  assert.deepEqual(ps.flatMap((p, i) => (p.quote ? [bars[i]] : [])), [0, 48, 112, 176], 'bar 16 of every odd cycle, and the start');
  assert.ok(ps.every((p) => (p.pick.kind === 'anthem') === p.quote), 'the anthem plays only as a quote');
  for (const p of ps) {
    assert.deepEqual(p.mel, { hook: SONGS.act1.hooks[p.section === 'A' ? 0 : 1], riff: SONGS.act1.riff }, 'A uses the first hook, B the second');
    assert.deepEqual(p.loop, SONGS.act1.sections[p.section].hopeful);
  }
  const act2 = plan(ps.at(-1), [192, 200], { dire: 0, act: 2, level: 0 });
  assert.deepEqual(act2.map((p) => [p.song, p.pick.kind === 'anthem', p.quote]), [['act2', true, true], ['act2', false, false]]);
});

test('the menu plays the Anthem and starting a game moves to Act I', () => {
  const menu = plan(null, phraseBars(8), { dire: 0, menu: true, level: 1 });
  assert.ok(menu.every((p) => p.song === 'anthem'));
  assert.equal(menu[0].quote, true);
  assert.ok(menu.slice(0, 4).every((p) => p.section === 'A' && p.pick.kind === 'anthem'), 'section A sings the anthem every phrase');
  assert.ok(menu.slice(4).every((p) => p.section === 'B' && p.pick.kind === 'call' && p.mel.hook === SONGS.anthem.hooks[0]),
    'section B is call and answer on the first hook');
  for (let k = 1; k < menu.length; k++) {
    const [a, b] = [menu[k - 1].pick, menu[k].pick];
    assert.ok(a.kind !== b.kind || a.lead !== b.lead, 'never the same pick twice');
    assert.ok(BANDS[menu[k].band].leads.includes(b.lead));
  }
  const game = nextPhrase(menu.at(-1), { bar: 64, dire: 0, menu: false, act: 1, level: 0 }, seeded(4));
  assert.deepEqual([game.song, game.quote, game.pick.kind], ['act1', true, 'anthem']);
  assert.equal(game.crossfade, null, 'same mood: the band plays on');
  assert.equal(game.tempoFrom, game.tempoTo);
});

test('tempo glides linearly and lands exactly', () => {
  const uneasy = nextPhrase(null, { bar: 0, pins: { mood: 'uneasy' } }, seeded(1));
  const glide = nextPhrase(uneasy, { bar: 8, pins: { mood: 'dire' } }, seeded(1));
  const next = nextPhrase(glide, { bar: 16, pins: { mood: 'dire' } }, seeded(1));
  assert.deepEqual([glide.tempoFrom, glide.tempoTo], [104, 94]);
  assert.equal(tempoAt(glide, 0, 0), 104);
  assert.equal(tempoAt(glide, 4, 0), 99);
  assert.equal(tempoAt(glide, 8, 0), 94);
  assert.equal(tempoAt(next, 0, 0), 94, 'the next phrase starts where the glide landed');
  const curve = Array.from({ length: 129 }, (_, k) => tempoAt(glide, Math.floor(k / 16), k % 16));
  for (let k = 1; k < curve.length; k++) {
    assert.ok(curve[k] < curve[k - 1], `monotonic at step ${k}`);
    assert.ok(Math.abs(curve[k - 1] - curve[k] - 10 / 128) < 1e-9, `linear at step ${k}`);
  }
  assert.ok(Array.from({ length: 128 }, (_, k) => tempoAt(next, Math.floor(k / 16), k % 16)).every((t) => t === 94), 'a settled phrase holds its tempo');
});

test('fills only into a change; alternates only in bars 28–31', () => {
  const inputs = { dire: 0, act: 1, level: 0 };
  const ps = plan(null, phraseBars(5), inputs);
  assert.deepEqual(ps.map((p) => p.fillInto), [false, false, false, true, false], 'into the next section');
  const [p] = ps;
  assert.equal(fillInto(p, inputs), false, 'nothing changes');
  assert.equal(fillInto(p, { ...inputs, act: 2 }), true, 'a new song');
  assert.equal(fillInto(p, { ...inputs, act: 2, pins: { song: 'act1' } }), false, 'a pinned song stays');
  assert.equal(fillInto(p, { ...inputs, menu: true }), true, 'back to the menu anthem');
  assert.equal(fillInto(p, { ...inputs, level: 1 }), true, 'rising into tension');
  assert.equal(fillInto(p, { ...inputs, level: 3 }), true, 'rising into a fight');
  assert.equal(fillInto({ ...p, level: 2 }, { ...inputs, level: 3 }), false, 'still a fight');
  assert.equal(fillInto({ ...p, level: 2 }, inputs), false, 'calming down is no fill');
  assert.equal(fillInto({ ...p, moodPending: 'uneasy' }, inputs), true, 'a mood about to change');
  assert.equal(fillInto(p, { ...inputs, pins: { mood: 'dire' } }), true, 'a newly pinned mood');
  assert.equal(fillInto(p, { ...inputs, pins: { mood: 'hopeful' } }), false, 'the pinned mood is already playing');
  assert.equal(fillInto(ps[3], { ...inputs, pins: { section: 'A' } }), false, 'a pinned section does not change');
  assert.deepEqual(Array.from({ length: 32 }, (_, b) => b).filter(altBar), [28, 29, 30, 31]);
});

test('lab pins: a pinned mood applies at the next phrase; band, groove, melody and lead swap only their part', () => {
  const rand = seeded(6);
  const start = nextPhrase(null, { bar: 0, dire: 0, act: 1, level: 2 }, rand);
  const dire = nextPhrase(start, { bar: 8, dire: 0, act: 1, level: 2, pins: { mood: 'dire' } }, rand);
  assert.deepEqual([dire.mood, dire.moodPending, dire.band, dire.groove, dire.tempoTo], ['dire', null, 'dark', 'heavy', 94]);
  assert.deepEqual(dire.crossfade, { from: 'warm', to: 'dark' });
  const mixed = nextPhrase(dire, { bar: 16, dire: 0, act: 1, level: 2, pins: { mood: 'hopeful', band: 'dark', groove: 'heavy' } }, rand);
  assert.deepEqual([mixed.mood, mixed.band, mixed.groove, mixed.tempoTo, mixed.world], ['hopeful', 'dark', 'heavy', 112, WORLDS.hopeful]);
  assert.equal(mixed.crossfade, null, 'the pinned band plays on');
  assert.deepEqual(mixed.loop, ['Am', 'F', 'C', 'G'], "the mood's harmony, entered on a chord Dire shares");
  const melody = nextPhrase(mixed, { bar: 24, dire: 0, act: 1, level: 2, pins: { melody: 'riff', lead: 'piano' } }, rand);
  assert.deepEqual(melody.pick, { kind: 'riff', lead: 'piano', over: null }, 'a pinned melody plays alone');
  const song = nextPhrase(melody, { bar: 32, dire: 0, act: 1, level: 2, pins: { song: 'act3', section: 'A' } }, rand);
  assert.deepEqual([song.song, song.section, song.quote], ['act3', 'A', true]);
  const auto = nextPhrase(song, { bar: 40, dire: 0.9, act: 1, level: 2, pins: { mood: 'auto', song: 'auto' } }, rand);
  assert.deepEqual([auto.song, auto.mood, auto.moodPending], ['act1', 'hopeful', 'uneasy'], 'back on Auto the director steps from where it is');
});

test('the director picks melodies from the band to suit the intensity and never repeats a pick', () => {
  const rand = seeded(3);
  const KINDS = [['hooks', 'call'], ['call', 'riff', 'hooks'], ['riff', 'call'], ['riff', 'call']];
  for (const band of Object.keys(BANDS)) {
    const leads = BANDS[band].leads;
    KINDS.forEach((kinds, level) => {
      let prev = null;
      let layered = 0;
      const seen = new Set();
      for (let k = 0; k < 40; k++) {
        const p = pickForPhrase(level, 'act2', band, prev, rand);
        assert.ok(kinds.includes(p.kind), `${band} level ${level}: ${p.kind}`);
        assert.ok(leads.includes(p.lead), `${band}: ${p.lead}`);
        if (prev) assert.ok(p.kind !== prev.kind || p.lead !== prev.lead, 'no immediate repeat');
        if (p.over) {
          layered++;
          assert.equal(p.over.kind, 'hooks');
          assert.ok(leads.includes(p.over.lead) && p.over.lead !== p.lead, 'the layer has its own sound');
        }
        seen.add(`${p.kind}/${p.lead}`);
        prev = p;
      }
      assert.ok(seen.size >= 3, `${band} level ${level} uses at least three picks`);
      assert.equal(layered > 0, level >= 2, 'only a fight layers a hook over the melody');
    });
  }
  let prev = null;
  for (let k = 0; k < 12; k++) {
    const p = pickForPhrase(k % 4, 'anthem', 'warm', prev, rand);
    assert.equal(p.kind, 'call', "the anthem song's own picks are call and answer");
    if (prev) assert.notEqual(p.lead, prev.lead);
    prev = p;
  }
});

test('no anthem twice in a row: a song opening just before the quote slot skips it', () => {
  const rand = seeded(8);
  const before = plan(null, phraseBars(5), { dire: 0, act: 1, level: 0 }, rand);
  const bars = phraseBars(10, 40);
  const ps = plan(before.at(-1), bars, { dire: 0, act: 2, level: 0 }, rand);
  assert.deepEqual(ps.flatMap((p, i) => (p.quote ? [bars[i]] : [])), [40, 112], 'the new song opens on it; the slot at 48 passes');
  ps.forEach((p, i) => assert.ok(!i || p.pick.kind !== 'anthem' || ps[i - 1].pick.kind !== 'anthem', `anthem twice at ${bars[i]}`));
});

test('a pinned lead keeps the layered hook in another of the band\'s sounds', () => {
  const rand = seeded(12);
  for (const band of Object.keys(BANDS)) {
    for (const lead of [...BANDS[band].leads, 'soft']) {
      let prev = null;
      let layered = 0;
      for (let k = 0; k < 40; k++) {
        prev = nextPhrase(prev, { bar: 8 * k, dire: 0, act: 2, level: 3, pins: { band, lead } }, rand);
        assert.equal(prev.pick.lead, lead, `${band}: the pinned lead plays`);
        if (!prev.pick.over) continue;
        layered++;
        assert.notEqual(prev.pick.over.lead, lead, `${band}: the layer is not the pinned lead`);
        assert.ok(BANDS[band].leads.includes(prev.pick.over.lead), `${band}: the layer is one of the band's leads`);
      }
      assert.ok(layered > 0, `${band} with ${lead}: a fight layers a hook`);
    }
  }
});

test("the old engine's picks, style resolution and shape are retired", async () => {
  const director = await import('../js/audio/director.js');
  for (const k of ['MOOD_STYLE', 'PICKS', 'pickMelody', 'resolveStyle', 'shapeHits']) assert.ok(!(k in director), k);
});

test('reactions answer only their own event types, never inherited names', () => {
  for (const type of ['toString', 'constructor', 'hasOwnProperty', '__proto__', 'valueOf']) {
    assert.deepEqual(reaction(type, 100, {}, 0), { kind: null, state: {} }, type);
  }
});

test('reactions: hush only when calm, once per 4 minutes; cooldowns; merge priority', () => {
  const s0 = {};
  let s = s0;
  const fire = (type, now, level) => {
    const r = reaction(type, now, s, level);
    s = r.state;
    return r.kind;
  };
  assert.equal(fire('hordeContact', 100, 0), 'hush');
  assert.equal(fire('hordeContact', 120, 0), null, '30 s cooldown');
  assert.equal(fire('hordeContact', 200, 0), 'stab', 'a hush less than 240 s ago');
  assert.equal(fire('hordeContact', 400, 0), 'hush');
  assert.equal(fire('hordeContact', 700, 2), 'stab', 'never a hush in a fight');
  assert.deepEqual(s0, {}, 'the state passed in is left alone');

  s = {};
  assert.equal(fire('hordeContact', 0, 1), 'hush', 'tension still allows a hush');
  s = {};
  assert.equal(fire('breakout', 0, 0), 'pulse');
  assert.equal(fire('hordeContact', 20, 0), 'stab', 'another reaction in the last 30 s');
  assert.equal(fire('hordeContact', 60, 0), 'hush');
  assert.equal(fire('hordeArrived', 61, 2), 'hit');
  assert.equal(fire('hordeArrived', 71, 2), null);
  assert.equal(fire('hordeArrived', 91, 2), 'hit', 'the cooldown is exactly 30 s');
  assert.equal(fire('fall', 92, 2), 'fall');
  assert.equal(fire('hordeDestroyed', 93, 2), 'lift');
  assert.equal(fire('breakout', 94, 2), 'pulse');
  assert.equal(fire('somethingElse', 95, 2), null);

  assert.equal(mergeReactions(['pulse', 'hit', 'lift']), 'hit');
  assert.equal(mergeReactions(['hush', 'fall']), 'fall');
  assert.equal(mergeReactions(['stab', 'hush']), 'hush');
  assert.equal(mergeReactions(['lift', 'stab']), 'stab');
  assert.equal(mergeReactions(['pulse', null, 'lift']), 'lift');
  assert.equal(mergeReactions([null, 'pulse']), 'pulse');
  assert.equal(mergeReactions([]), null);
});

test('the hush ends with a hit when the fight starts, or returns after 16 bars', () => {
  const h = { active: true, start: 40 };
  const step = (level, bar) => {
    const r = hushStep(h, { level, bar });
    return [r.active, r.ending];
  };
  assert.deepEqual(step(1, 41), [true, null]);
  assert.deepEqual(step(2, 44), [false, 'hit']);
  assert.deepEqual(step(3, 50), [false, 'hit']);
  assert.deepEqual(step(0, 55), [true, null]);
  assert.deepEqual(step(0, 56), [false, 'return']);
  assert.deepEqual(hushStep({ active: false }, { level: 3, bar: 0 }).ending, null, 'no hush, nothing to end');
  let hush = { active: true, start: 0 };
  let held = 0;
  for (let bar = 0; bar < 40; bar++) {
    hush = hushStep(hush, { level: 0, bar });
    if (hush.active) held++;
  }
  assert.equal(held, 16, 'it holds 16 bars');
});

test('every 32 bars: breath, build, full, full; the melody rests in the first half of a breath', () => {
  assert.deepEqual([0, 8, 16, 24, 32].map(shapeOf), ['breath', 'build', 'full', 'full', 'breath']);
  assert.ok(melodyRests('breath', 0) && melodyRests('breath', 3) && !melodyRests('breath', 4) && !melodyRests('full', 0));
});

test('every 32 bars in every groove: a thin breath, a build on its own timekeeper, then full', () => {
  const TIMEKEEPER = { bounce: 'shaker', standard: 'hat', heavy: 'hat' };
  const GONE = ['snare', 'clap', 'ohat', 'tamb', 'taiko', 'clang'];
  for (const groove of Object.keys(GROOVES)) {
    const tk = TIMEKEEPER[groove];
    const bar = (shape, phraseBar, level) => Array.from({ length: 16 }, (_, s) => shapeHitsFor(hitsFor(groove, level, s, phraseBar), shape, phraseBar, s, level, groove));
    const breath = bar('breath', 0, 2);
    assert.deepEqual(breath.flatMap((h, s) => (h.some((x) => x.inst === 'kick') ? [s] : [])), [0], `${groove}: the kick only on the downbeat`);
    assert.ok(breath.flat().every((h) => !GONE.includes(h.inst)), `${groove}: no backbeat or colour in a breath`);
    assert.ok(breath.flat().some((h) => h.inst === 'bass'), `${groove}: the bass keeps going`);
    assert.ok(breath.flat().some((h) => h.inst === tk), `${groove}: the ${tk} keeps time`);
    const build = bar('build', 6, 1);
    assert.ok(build.every((h) => h.filter((x) => x.inst === tk).length === 1), `${groove}: sixteenth ${tk}s in the last bars of the build`);
    build.forEach((h, s) => {
      if (hitsFor(groove, 1, s, 6).some((x) => x.inst === tk)) return;
      assert.equal(h.find((x) => x.inst === tk).vel, s % 4 === 0 ? 1 : 0.55, `${groove}: added ${tk}s accent only the beat`);
    });
    assert.deepEqual(build.flatMap((h, s) => (h.some((x) => x.inst === 'riser') ? [s] : [])), [0], `${groove}: one riser`);
    assert.deepEqual(build[0].find((x) => x.inst === 'riser'), { inst: 'riser', vel: 1, bars: 2 });
    assert.deepEqual(bar('build', 5, 1), Array.from({ length: 16 }, (_, s) => hitsFor(groove, 1, s, 5)), `${groove}: the build waits for its last two bars`);
    assert.deepEqual(bar('full', 0, 2), Array.from({ length: 16 }, (_, s) => hitsFor(groove, 2, s, 0)), `${groove}: full is as written`);
  }
});

// ---- final-review fixes ----

test('the anthem\'s lead suits the mood: bright in Hopeful, the band\'s in Uneasy, low piano or choir in Dire (F1)', () => {
  const ALLOWED = { hopeful: ['bell', 'celesta'], uneasy: [...BANDS.synth.leads], dire: ['lowPiano', 'choir'] };
  for (const song of Object.keys(SONGS)) {
    for (const mood of MOODS) {
      // The song pinned with its section A: the Anthem sings every phrase; an act song opens on it and quotes it.
      const ps = plan(null, phraseBars(16), { dire: 0, act: 1, level: 1, pins: { song, section: 'A', mood } }, seeded(21));
      const anthems = ps.filter((p) => p.pick.kind === 'anthem');
      assert.ok(anthems.length >= (song === 'anthem' ? 16 : 2), `${song} ${mood}: ${anthems.length} anthem phrases`);
      const allowed = mood === 'uneasy' ? [...ALLOWED.uneasy, SONGS[song].featured.uneasy] : ALLOWED[mood];
      for (const p of anthems) assert.ok(allowed.includes(p.pick.lead), `${song} ${mood}: the anthem on ${p.pick.lead}`);
    }
  }
  // A pinned melody of the anthem keeps to the mood's leads too; a pinned lead is the lab's own choice.
  const pinnedMelody = plan(null, phraseBars(6), { dire: 0, act: 2, level: 1, pins: { mood: 'dire', melody: 'anthem' } }, seeded(4));
  assert.ok(pinnedMelody.every((p) => ['lowPiano', 'choir'].includes(p.pick.lead)), `${pinnedMelody.map((p) => p.pick.lead)}`);
  const pinnedLead = nextPhrase(null, { bar: 0, pins: { mood: 'dire', melody: 'anthem', lead: 'dist' } }, seeded(4));
  assert.equal(pinnedLead.pick.lead, 'dist');
});

test('the song\'s featured lead plays at least every second phrase the director picks, never the same pick twice (F2)', () => {
  for (const song of ['act1', 'act2', 'act3', 'act4', 'anthem']) {
    for (const mood of MOODS) {
      const featured = SONGS[song].featured[mood];
      // Through the levels, so every intensity's kinds are picked; the anthem's phrases keep their own leads (F1).
      const ps = [];
      let prev = null;
      for (let k = 0; k < 48; k++) ps.push(prev = nextPhrase(prev, { bar: 8 * k, dire: 0, level: (k >> 2) % 4, pins: { song, mood } }, seeded(31 + k)));
      const picked = ps.filter((p) => p.pick.kind !== 'anthem');
      assert.ok(picked.length >= 12, `${song} ${mood}: ${picked.length} picks`);
      ps.forEach((p, k) => {
        const q = ps[k - 1];
        if (!q) return;
        assert.ok(p.pick.kind !== q.pick.kind || p.pick.lead !== q.pick.lead, `${song} ${mood} phrase ${k}: the same pick twice`);
        if (p.pick.kind === 'anthem' || q.pick.kind === 'anthem') return;
        assert.ok(p.pick.lead === featured || q.pick.lead === featured, `${song} ${mood} phrases ${k - 1}–${k}: ${q.pick.lead}, ${p.pick.lead} without ${featured}`);
      });
      const share = picked.filter((p) => p.pick.lead === featured).length / picked.length;
      assert.ok(share >= 0.4, `${song} ${mood}: ${featured} on ${Math.round(share * 100)}% of the picks`);
    }
  }
  // pickForPhrase: a featured lead from outside the band (Act III's soft lead in the warm band) still plays, its
  // layered hook in one of the band's own sounds.
  const rand = seeded(5);
  let prev = { kind: 'riff', lead: 'bell', over: null };
  for (let k = 0; k < 30; k++) {
    const p = pickForPhrase(2, 'act3', 'warm', prev, rand, 'soft');
    if (prev.lead !== 'soft') assert.equal(p.lead, 'soft', 'after a phrase without it, the featured lead');
    assert.ok(p.kind !== prev.kind || p.lead !== prev.lead);
    if (p.over) assert.ok(BANDS.warm.leads.includes(p.over.lead) && p.over.lead !== p.lead, `layer ${p.over.lead}`);
    prev = p;
  }
});

test('a song\'s percussion overlay plays from tension up, never in a breath; every beat stays marked, accents on the beat (F2)', () => {
  const beatMarkers = ['kick', 'snare', 'clap', 'taiko', 'bass'];
  for (const [id, song] of Object.entries(SONGS)) {
    for (const groove of Object.keys(GROOVES)) {
      for (const level of [-1, 0, 1, 2, 3]) {
        for (const shape of ['full', 'build', 'breath']) {
          for (const night of [false, true]) {
            const label = `${id} ${groove} level ${level} ${shape}${night ? ' night' : ''}`;
            const bar = Array.from({ length: 16 }, (_, s) => {
              const plain = hitsFor(groove, level, s, 0, { night });
              const hits = withOverlay(plain, song.overlay, level, s, { shape, night });
              assert.deepEqual(hits.slice(0, plain.length), plain, `${label}: the overlay only adds`);
              const extra = hits.slice(plain.length);
              const due = song.overlay.filter(([inst, at]) => at === s && !plain.some((h) => h.inst === inst)
                && !(night && level < 2 && ['hat', 'shaker'].includes(inst)));
              assert.deepEqual(extra.map((h) => h.inst), level >= 1 && shape !== 'breath' ? due.map(([inst]) => inst) : [], `${label} step ${s}`);
              assert.ok(extra.every((h) => h.vel > 0 && h.vel < 1), `${label}: overlay hits are plain, not accents`);
              return hits;
            });
            if (level < 0) continue;
            for (const s of [0, 4, 8, 12]) assert.ok(bar[s].some((h) => beatMarkers.includes(h.inst)), `${label}: beat ${s} marked`);
            bar.forEach((hits, s) => hits.forEach((h) => assert.ok(!(h.vel >= 1 && ['hat', 'shaker'].includes(h.inst)) || s % 4 === 0, `${label}: accent on ${s}`)));
          }
        }
      }
    }
  }
  // Act II's hats between the standard groove's at tension; nothing extra where the groove already has the instrument.
  const at = (s, level) => withOverlay(hitsFor('standard', level, s, 0), SONGS.act2.overlay, level, s).map((h) => h.inst);
  assert.ok(at(3, 1).includes('hat') && !at(3, 0).includes('hat'));
  assert.equal(at(14, 3).filter((n) => n === 'kick').length, 1, 'the groove\'s own kick on 14 is not doubled');
});

test('the outgoing phrase closes on a chord both moods share (F3)', () => {
  const bad = new Set(['E', 'Bb', 'Bdim']);
  const shared = sharedChords('dire', 'uneasy');
  let turned = 0;
  for (const [id, song] of Object.entries(SONGS)) {
    for (const section of ['A', 'B']) {
      const p = { ...nextPhrase(null, { bar: 0, pins: { song: id, section, mood: 'dire' } }, seeded(2)), moodPending: 'uneasy' };
      const loop = song.sections[section].dire;
      assert.deepEqual(p.loop, loop);
      const c = closingChord(p, {});
      assert.ok(!bad.has(c) && shared.includes(c), `${id} ${section}: Dire → Uneasy closes on ${c}`);
      if (shared.includes(loop.at(-1))) assert.equal(c, loop.at(-1), `${id} ${section}: a shared last chord stays`);
      else {
        turned++;
        assert.equal(c, loop.find((x) => shared.includes(x)), `${id} ${section}: the loop's earliest shared chord`);
      }
      const steady = { ...p, moodPending: null };
      assert.equal(closingChord(steady, {}), loop.at(-1), `${id} ${section}: no change coming, the loop as written`);
      // A pinned mood not yet playing turns it too; the mood already playing does not.
      assert.equal(moodTurn(steady, { pins: { mood: 'hopeful' } }), 'hopeful');
      assert.ok(sharedChords('dire', 'hopeful').includes(closingChord(steady, { pins: { mood: 'hopeful' } })), `${id} ${section}: into Hopeful`);
      assert.equal(closingChord(p, { pins: { mood: 'dire' } }), loop.at(-1), `${id} ${section}: pinned where it is`);
    }
  }
  assert.ok(turned >= 3, `${turned} loops had to close on another chord`);
  assert.equal(closingChord({ mood: 'dire', moodPending: 'hopeful', loop: ['Bb', 'E', 'Bdim', 'E'] }, {}), 'Am', 'nothing shared: Am');
  assert.equal(moodTurn({ mood: 'uneasy', moodPending: null }, {}), null);
});

test('back from an ending, the new game starts in the mood its country asks for (F10)', () => {
  const ending = { ...nextPhrase(null, { bar: 0, pins: { song: 'anthem', mood: 'dire' } }, seeded(3)), tempoTo: 86 };
  const retry = nextPhrase(ending, { bar: 8, dire: 0, act: 1, level: 0, restart: true }, seeded(3));
  assert.deepEqual([retry.mood, retry.moodPending, retry.song, retry.pick.kind], ['hopeful', null, 'act1', 'anthem']);
  assert.deepEqual([retry.tempoFrom, retry.tempoTo], [86, 112], 'gliding on from where the tempo is');
  assert.deepEqual(retry.crossfade, { from: 'dark', to: 'warm' });
  const walk = nextPhrase(ending, { bar: 8, dire: 0, act: 1, level: 0 }, seeded(3));
  assert.deepEqual([walk.mood, walk.moodPending], ['dire', 'uneasy'], 'without a restart the mood walks one step at a time');
  const pinned = nextPhrase(ending, { bar: 8, dire: 0, act: 1, level: 0, restart: true, pins: { mood: 'uneasy' } }, seeded(3));
  assert.equal(pinned.mood, 'uneasy', 'a pinned mood still wins');
});
