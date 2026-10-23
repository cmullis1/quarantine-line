// The score's songs as data: the Valdmark anthem for the menu and four act songs for the acts. Each song is two
// 8-bar sections (A and B), each mood gets four chords over them, one per two bars. The anthem's melody is shared
// by every mood and realised in that mood's key. Pure data and functions (no Web Audio) so they can be tested.
//
// A song's identity carries across its moods: its own bass line (`bass`, at levels 0–1), the lead it features in
// each mood (`featured`, the director's pick at least every second phrase) and its own percussion over the groove
// (`overlay`: [instrument, step] once per bar from tension up, played through the current band).

// Degrees 1–7 of the scale above the tonic, in semitones: C major for Hopeful, A natural minor for Uneasy and Dire.
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const SCALE_STEPS = { hopeful: MAJOR, uneasy: MINOR, dire: MINOR };

export const ANTHEM = {
  notes: [
    [0, 5, 6], [6, 3, 2], [8, 1, 4], [12, 3, 4], [16, 5, 8], [24, 8, 8],
    [32, 8, 6], [38, 7, 2], [40, 6, 4], [44, 5, 4], [48, 6, 8], [56, 4, 8],
    [64, 5, 6], [70, 6, 2], [72, 7, 4], [76, 8, 4], [80, 9, 8], [88, 7, 8],
    [96, 8, 6], [102, 7, 2], [104, 6, 4], [108, 5, 4], [112, 3, 4], [116, 2, 4], [120, 1, 8],
  ],
  // C4 and A3: the melody stays below A5 in every mood (the shrill rule); Dire shares Uneasy's register.
  tonic: { hopeful: 60, uneasy: 57, dire: 57 },
  harmony: { hopeful: ['C', 'F', 'G', 'C'], uneasy: ['Am', 'Dm', 'Em', 'Am'], dire: ['Am', 'Dm', 'Bb', 'E'] },
};

export const SONGS = {
  anthem: { name: 'Valdmark', hooks: [0, 7], riff: 2, bass: null,
    featured: { hopeful: 'piano', uneasy: 'bell', dire: 'lowPiano' }, overlay: [], sections: {
    A: { hopeful: ['C', 'F', 'G', 'C'], uneasy: ['Am', 'Dm', 'Em', 'Am'], dire: ['Am', 'Dm', 'Bb', 'E'] },
    B: { hopeful: ['Am', 'F', 'C', 'G'], uneasy: ['F', 'Dm', 'Am', 'Em'], dire: ['Dm', 'Bb', 'Am', 'E'] } } },
  // Light and curious: a tambourine answering the backbeat.
  act1: { name: 'First Reports', hooks: [0, 5], riff: 0, bass: [[0, 0], [6, 7], [8, 0], [12, 12]],
    featured: { hopeful: 'celesta', uneasy: 'bell', dire: 'lowPiano' }, overlay: [['tamb', 6], ['tamb', 14]], sections: {
    A: { hopeful: ['C', 'G', 'Am', 'F'], uneasy: ['Am', 'F', 'Dm', 'Em'], dire: ['Am', 'Bb', 'Am', 'Em'] },
    B: { hopeful: ['F', 'C', 'G', 'G'], uneasy: ['F', 'Dm', 'Am', 'Em'], dire: ['Dm', 'Bb', 'Am', 'Am'] } } },
  // Driving: a pickup kick and offbeat hats.
  act2: { name: 'Holding the Line', hooks: [3, 6], riff: 1, bass: [[0, 0], [2, 0], [4, 12], [8, 0], [10, 0], [12, 12]],
    featured: { hopeful: 'piano', uneasy: 'synth', dire: 'dist' }, overlay: [['kick', 14], ['hat', 3], ['hat', 7], ['hat', 11], ['hat', 15]], sections: {
    A: { hopeful: ['Am', 'F', 'C', 'G'], uneasy: ['Am', 'Am', 'F', 'Em'], dire: ['Am', 'Dm', 'Bb', 'Am'] },
    B: { hopeful: ['F', 'G', 'C', 'C'], uneasy: ['Dm', 'Em', 'F', 'Em'], dire: ['Bb', 'Am', 'Bdim', 'E'] } } },
  // Heavy: war drums pushing into each half bar.
  act3: { name: 'The Long Night', hooks: [2, 4], riff: 3, bass: [[0, 0], [4, 0], [7, 0], [8, 0], [12, 0]],
    featured: { hopeful: 'soft', uneasy: 'soft', dire: 'choir' }, overlay: [['taiko', 6], ['taiko', 14]], sections: {
    A: { hopeful: ['Am', 'F', 'C', 'Em'], uneasy: ['Am', 'Dm', 'Em', 'Am'], dire: ['Am', 'Bb', 'Am', 'Bb'] },
    B: { hopeful: ['F', 'C', 'G', 'Am'], uneasy: ['F', 'Em', 'Dm', 'Em'], dire: ['Am', 'Bdim', 'Bb', 'E'] } } },
  // Broad: one open hat lifting the end of the bar.
  act4: { name: 'Last Light', hooks: [7, 1], riff: 2, bass: [[0, 0], [8, 7], [12, 0]],
    featured: { hopeful: 'bell', uneasy: 'piano', dire: 'lowPiano' }, overlay: [['ohat', 12]], sections: {
    A: { hopeful: ['F', 'G', 'C', 'Am'], uneasy: ['Dm', 'Am', 'F', 'Em'], dire: ['Dm', 'Bb', 'E', 'Am'] },
    B: { hopeful: ['C', 'G', 'F', 'F'], uneasy: ['F', 'Dm', 'Em', 'Am'], dire: ['Am', 'Bb', 'Dm', 'E'] } } },
};

// The anthem's notes in a mood's key: [{ s, midi, len }], one per entry of ANTHEM.notes. A degree counts up the
// mood's diatonic scale from its tonic (8 is the tonic an octave up, 9 the second above that). Dire's last note
// is the dominant (degree 5) instead of the tonic, so the anthem stops unresolved there; `hanging` false resolves
// it (the defeat's first pass).
export function anthemNotes(mood, hanging = mood === 'dire') {
  const tonic = ANTHEM.tonic[mood];
  const steps = SCALE_STEPS[mood];
  const midiOf = (d) => tonic + 12 * Math.floor((d - 1) / 7) + steps[(d - 1) % 7];
  const last = ANTHEM.notes.length - 1;
  return ANTHEM.notes.map(([s, d, len], i) => ({ s, midi: midiOf(i === last && hanging ? 5 : d), len }));
}

// Which song plays: the menu always plays the anthem; each act plays its own.
export const songFor = ({ act, menu = false }) => (menu ? 'anthem' : `act${act}`);
