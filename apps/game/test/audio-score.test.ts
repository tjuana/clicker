import { describe, expect, it } from 'vitest';
import {
  beatAt,
  bpmAt,
  FAST_BPM,
  type Note,
  notesIn,
  RAMP_SECONDS,
  SLOW_BPM,
  timeOfBeat,
} from '../src/client/audio/score';

/** The light cycles' round: three minutes. */
const LENGTH = 180;
/** The ramp starts here. */
const RAMP_FROM = LENGTH - RAMP_SECONDS;

const kicks = (notes: Note[]) => notes.filter((note) => note.voice === 'kick');
const bass = (notes: Note[]) => notes.filter((note) => note.voice === 'bass');

/** Gaps between neighbours: the tempo, heard as the spacing of the kick. */
function gaps(notes: Note[]): number[] {
  return notes.slice(1).map((note, i) => note.at - (notes[i] as Note).at);
}

describe('the tempo of a round', () => {
  it('holds 120 until the last half minute, then rises to 132 by the end', () => {
    expect(bpmAt(0, LENGTH)).toBe(SLOW_BPM);
    expect(bpmAt(RAMP_FROM, LENGTH)).toBe(SLOW_BPM);
    expect(bpmAt(RAMP_FROM + RAMP_SECONDS / 2, LENGTH)).toBeCloseTo(126, 9);
    expect(bpmAt(LENGTH, LENGTH)).toBe(FAST_BPM);
    expect(SLOW_BPM).toBe(120);
    expect(FAST_BPM).toBe(132);
  });

  it('never drops and never overshoots', () => {
    let before = 0;
    for (let t = 0; t <= LENGTH + 5; t += 0.25) {
      const bpm = bpmAt(t, LENGTH);
      expect(bpm).toBeGreaterThanOrEqual(before);
      expect(bpm).toBeLessThanOrEqual(FAST_BPM);
      before = bpm;
    }
  });

  it('is heard in the music: the kick is closer together at the end than at the start', () => {
    const start = gaps(kicks(notesIn(0, 10, LENGTH)));
    const end = gaps(kicks(notesIn(LENGTH - 10, LENGTH, LENGTH)));

    for (const gap of start) expect(gap).toBeCloseTo(0.5, 9);
    // The tempo is still rising inside the last ten seconds, so it is the last gap that is checked
    // against the final tempo, and every gap is checked against the one before it.
    expect(end.at(-1)).toBeLessThan(60 / 130);
    expect(end.at(-1)).toBeGreaterThan(60 / FAST_BPM - 1e-9);
    for (let i = 1; i < end.length; i += 1) {
      expect(end[i]).toBeLessThan(end[i - 1] as number);
    }
  });

  it('keeps the beat count and the clock inverse to each other', () => {
    for (let t = 0; t <= LENGTH; t += 1.7) {
      expect(timeOfBeat(beatAt(t, LENGTH), LENGTH)).toBeCloseTo(t, 7);
    }
    // At 120 for 150 s that is 300 beats, then 30 s at the mean of 120 and 132.
    expect(beatAt(RAMP_FROM, LENGTH)).toBeCloseTo(300, 9);
    expect(beatAt(LENGTH, LENGTH)).toBeCloseTo(300 + 63, 9);
  });

  it('rises over the whole of a round shorter than the ramp, and ends at 132', () => {
    expect(bpmAt(0, 10)).toBe(SLOW_BPM);
    expect(bpmAt(10, 10)).toBe(FAST_BPM);
    const notes = notesIn(0, 10, 10);
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      expect(Number.isFinite(note.at)).toBe(true);
      expect(Number.isFinite(note.dur)).toBe(true);
    }
  });
});

describe('the notes in a window', () => {
  it('starts on a kick at the very start and has a kick on every beat', () => {
    const first = notesIn(0, 2, LENGTH);

    expect(first[0]).toMatchObject({ at: 0, voice: 'kick' });
    expect(kicks(first).map((note) => note.at)).toEqual([0, 0.5, 1, 1.5]);
  });

  it('plays nothing before the round starts and nothing once it is over', () => {
    expect(notesIn(-5, 0, LENGTH)).toEqual([]);
    expect(notesIn(LENGTH, LENGTH + 5, LENGTH)).toEqual([]);
    expect(notesIn(LENGTH - 0.3, LENGTH + 5, LENGTH).every((note) => note.at < LENGTH)).toBe(true);
    expect(notesIn(0, 5, 0)).toEqual([]);
    expect(notesIn(5, 1, LENGTH)).toEqual([]);
  });

  it('gives each voice a pitch it can be played at, and a length', () => {
    const notes = notesIn(0, 30, LENGTH);
    const voices = new Set(notes.map((note) => note.voice));
    expect(voices).toEqual(new Set(['bass', 'kick', 'pad']));

    for (const note of bass(notes)) {
      // A sawtooth below A1 is mud, and one above A3 is no longer a bass.
      expect(note.midi).toBeGreaterThanOrEqual(28);
      expect(note.midi).toBeLessThan(60);
    }
    for (const note of notes) expect(note.dur).toBeGreaterThan(0);
  });

  it('never lets one bass note run into the next, which one oscillator could not play', () => {
    // The whole round, across the ramp where the steps get shorter.
    const line = bass(notesIn(0, LENGTH, LENGTH));
    expect(line.length).toBeGreaterThan(500);
    for (let i = 1; i < line.length; i += 1) {
      const before = line[i - 1] as Note;
      expect((line[i] as Note).at).toBeGreaterThanOrEqual(before.at + before.dur);
    }
  });

  it('repeats its four bars while the tempo is steady', () => {
    // Four bars of four beats at two beats a second: eight seconds.
    const once = notesIn(0, 8, LENGTH);
    const again = notesIn(8, 16, LENGTH).map((note) => ({ ...note, at: note.at - 8 }));

    expect(again.length).toBe(once.length);
    for (let i = 0; i < once.length; i += 1) {
      expect(again[i]).toMatchObject({ ...once[i], at: expect.closeTo(once[i]?.at ?? 0, 9) });
    }
  });

  it('is the same slice of the round wherever the window is cut', () => {
    // The whole round once; every window then has to be exactly its part of it.
    const whole = notesIn(0, LENGTH, LENGTH);
    // Windows that start anywhere, including in the ramp and on the last second.
    const cuts: Array<[number, number]> = [
      [0.01, 0.12],
      [3.3, 3.4],
      [87.31, 87.41],
      [RAMP_FROM - 0.05, RAMP_FROM + 0.05],
      [RAMP_FROM + 11.17, RAMP_FROM + 11.27],
      [LENGTH - 0.1, LENGTH],
      [LENGTH - 0.1, LENGTH + 10],
    ];

    for (const [from, to] of cuts) {
      expect(notesIn(from, to, LENGTH)).toEqual(
        whole.filter((note) => note.at >= from && note.at < to),
      );
    }
  });

  it('hands out every note once when a round is scheduled window by window', () => {
    const whole = notesIn(0, LENGTH, LENGTH);

    // Windows the way a timer makes them: each starts where the last ended. One set ends exactly
    // on the sixteenths of the steady tempo, where a note sits on a seam; the other ends nowhere.
    for (const width of [0.125, 0.1, 0.037]) {
      const joined: Note[] = [];
      let from = 0;
      for (let k = 1; from < LENGTH; k += 1) {
        const to = k * width;
        joined.push(...notesIn(from, to, LENGTH));
        from = to;
      }
      expect(joined).toEqual(whole);
    }
  });
});
