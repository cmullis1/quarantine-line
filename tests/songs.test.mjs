import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SONGS, ANTHEM, anthemNotes, songFor } from '../js/audio/songs.js';
import { chordsOf } from '../js/audio/worlds.js';

const MOODS = ['hopeful', 'uneasy', 'dire'];

test('every song has A and B in every mood, using only that mood\'s chords', () => {
  for (const [id, song] of Object.entries(SONGS)) {
    for (const mood of MOODS) {
      for (const section of ['A', 'B']) {
        const chords = song.sections[section][mood];
        assert.equal(chords.length, 4, `${id} ${section} ${mood} has four chords`);
        for (const c of chords) assert.ok(chordsOf(mood).includes(c), `${id} ${section} ${mood} uses ${c}`);
      }
    }
  }
});

test('songFor: the menu plays the anthem; acts 1–4 play their songs', () => {
  assert.equal(songFor({ menu: true }), 'anthem');
  assert.equal(songFor({ act: 3 }), 'act3');
  for (const act of [1, 2, 3, 4]) assert.equal(songFor({ act }), `act${act}`);
});

test('the anthem is singable: mostly stepwise, one leap, ends home', () => {
  const hopeful = anthemNotes('hopeful').map((n) => n.midi);
  assert.ok(Math.max(...hopeful) - Math.min(...hopeful) <= 15, 'range within a fifteenth');
  const intervals = hopeful.slice(1).map((m, i) => Math.abs(m - hopeful[i]));
  const steps = intervals.filter((d) => d <= 2).length;
  assert.ok(steps / intervals.length >= 0.6, `${steps} of ${intervals.length} intervals are steps`);
  const leaps = intervals.filter((d) => d > 4).length;
  assert.ok(leaps <= 1, `${leaps} intervals wider than a third`);
  assert.equal(hopeful.at(-1), 60, 'ends on the tonic in Hopeful');
});

test('the anthem sings below A5 in every mood (the shrill rule)', () => {
  assert.deepEqual(ANTHEM.tonic, { hopeful: 60, uneasy: 57, dire: 57 });
  for (const mood of MOODS) assert.ok(Math.max(...anthemNotes(mood).map((n) => n.midi)) <= 81, mood);
});

test('every mood plays the same anthem; only Dire\'s last note differs', () => {
  const sequence = (mood) => anthemNotes(mood).map(({ s, len }) => [s, len]);
  for (const mood of MOODS) assert.deepEqual(sequence(mood), sequence('hopeful'), `${mood} keeps the rhythm`);
  const dire = anthemNotes('dire');
  assert.equal(dire.at(-1).midi, 64, 'Dire rests on the dominant, E');
  assert.equal(ANTHEM.notes.at(-1)[1], 1, 'the shared melody ends on the tonic');
  // Dire shares Uneasy's register (A minor from A3); only its last note differs.
  const uneasy = anthemNotes('uneasy');
  assert.deepEqual(dire.slice(0, -1), uneasy.slice(0, -1));
  assert.notEqual(dire.at(-1).midi, uneasy.at(-1).midi);
});

test('each act song has its own hooks and riff', () => {
  const acts = ['act1', 'act2', 'act3', 'act4'].map((id) => SONGS[id].hooks);
  const all = acts.flat();
  assert.equal(new Set(all).size, all.length, 'the four hook pairs are pairwise disjoint');
  const riffs = ['act1', 'act2', 'act3', 'act4'].map((id) => SONGS[id].riff);
  assert.equal(new Set(riffs).size, riffs.length, 'each act has its own riff');
});

test('each song carries its identity: a featured lead per mood and its own percussion over the groove (F2)', () => {
  const ids = Object.keys(SONGS);
  assert.deepEqual(Object.fromEntries(ids.map((id) => [id, SONGS[id].featured])), {
    anthem: { hopeful: 'piano', uneasy: 'bell', dire: 'lowPiano' },
    act1: { hopeful: 'celesta', uneasy: 'bell', dire: 'lowPiano' },
    act2: { hopeful: 'piano', uneasy: 'synth', dire: 'dist' },
    act3: { hopeful: 'soft', uneasy: 'soft', dire: 'choir' },
    act4: { hopeful: 'bell', uneasy: 'piano', dire: 'lowPiano' },
  });
  assert.deepEqual(Object.fromEntries(ids.map((id) => [id, SONGS[id].overlay])), {
    anthem: [],
    act1: [['tamb', 6], ['tamb', 14]],
    act2: [['kick', 14], ['hat', 3], ['hat', 7], ['hat', 11], ['hat', 15]],
    act3: [['taiko', 6], ['taiko', 14]],
    act4: [['ohat', 12]],
  });
});

test('the anthem can resolve in Dire too: the same notes, the tonic last (F9, the defeat\'s first pass)', () => {
  const resolved = anthemNotes('dire', false), hanging = anthemNotes('dire');
  assert.deepEqual(resolved.slice(0, -1), hanging.slice(0, -1));
  assert.deepEqual([resolved.at(-1).midi, hanging.at(-1).midi], [57, 64]);
  assert.deepEqual(resolved, anthemNotes('uneasy'), 'Dire resolved is Uneasy\'s anthem note for note');
});
