/**
 * The soundtrack as data: which notes sound in a stretch of the round. Nothing here knows about
 * WebAudio or a clock; `synth.ts` plays whatever this returns. The music is the player's own
 * (a minor-key bass arpeggio over four chords, a kick on every beat, a soft pad), not borrowed.
 *
 * The tempo is 120 BPM and rises to 132 over the last 30 seconds of the round. A tempo that
 * changes means a note's time cannot be `step × length`: it is the inverse of the beats counted
 * so far, which `beatAt` and `timeOfBeat` give in closed form. A window is then found in constant
 * time wherever it lies, instead of by walking the round from its start.
 */

export type Voice = 'bass' | 'kick' | 'pad';

export interface Note {
  /** Seconds from the start of the round. */
  at: number;
  /** Seconds. */
  dur: number;
  voice: Voice;
  /** MIDI note number (69 is A4, 440 Hz). The kick has no pitch and carries 0. */
  midi: number;
}

export const SLOW_BPM = 120;
export const FAST_BPM = 132;
/** The tempo rises over this much of the end of a round. */
export const RAMP_SECONDS = 30;

/** Beats per second. */
const SLOW = SLOW_BPM / 60;
const FAST = FAST_BPM / 60;

/** Sixteenth notes: the grid every voice sits on. */
const STEPS_PER_BEAT = 4;
const STEPS_PER_BAR = 16;

/** Where the ramp starts, and how long it is. A round shorter than the ramp is all ramp. */
function ramp(length: number): { from: number; seconds: number } {
  const seconds = Math.max(0, Math.min(RAMP_SECONDS, length));
  return { from: length - seconds, seconds };
}

/** The tempo at `t` seconds into a round `length` long. */
export function bpmAt(t: number, length: number): number {
  const { from, seconds } = ramp(length);
  if (seconds === 0) return t < length ? SLOW_BPM : FAST_BPM;
  const into = Math.min(Math.max(t - from, 0), seconds);
  return SLOW_BPM + (FAST_BPM - SLOW_BPM) * (into / seconds);
}

/** Beats played by `t`: the area under the tempo curve, flat, then a trapezoid, then flat again. */
export function beatAt(t: number, length: number): number {
  if (t <= 0) return 0;
  const { from, seconds } = ramp(length);
  const slope = seconds === 0 ? 0 : (FAST - SLOW) / seconds;
  const into = Math.min(Math.max(t - from, 0), seconds);
  return (
    SLOW * Math.min(t, from) +
    SLOW * into +
    0.5 * slope * into * into +
    FAST * Math.max(t - length, 0)
  );
}

/** The time at which `beat` falls: `beatAt` run backwards. */
export function timeOfBeat(beat: number, length: number): number {
  if (beat <= 0) return 0;
  const { from, seconds } = ramp(length);
  const slope = seconds === 0 ? 0 : (FAST - SLOW) / seconds;
  const beforeRamp = SLOW * from;
  if (beat <= beforeRamp) return beat / SLOW;
  const left = beat - beforeRamp;
  const inRamp = ((SLOW + FAST) / 2) * seconds;
  if (left > inRamp) return length + (left - inRamp) / FAST;
  // 0.5·slope·s² + SLOW·s = left, in the form that does not lose its digits when slope is small.
  return from + (2 * left) / (SLOW + Math.sqrt(SLOW * SLOW + 2 * slope * left));
}

/** Semitones above the bar's root for each sixteenth; `null` is a rest. */
const RIFF: ReadonlyArray<number | null> = [
  0,
  null,
  12,
  0,
  7,
  null,
  12,
  0,
  0,
  null,
  12,
  7,
  12,
  0,
  7,
  null,
];
/** The last bar of the four runs up the chord instead, so the loop leans back into its first bar. */
const RUN: ReadonlyArray<number | null> = [
  0,
  null,
  7,
  12,
  0,
  null,
  7,
  12,
  0,
  4,
  7,
  12,
  16,
  12,
  7,
  4,
];

/** A minor, F, C, E: the bass's root for each bar of the loop (A1, F1, C2, E2). */
const ROOTS = [33, 29, 36, 40];
/** The same chords as the pad plays them, each a step from the one before. */
const PAD = [
  [57, 60, 64],
  [53, 57, 60],
  [55, 60, 64],
  [56, 59, 64],
];

/** A kick is a sound of its own length, not of the tempo's. */
const KICK_SECONDS = 0.3;
/** A bass note stops short of the next step, so the one oscillator that plays them can re-pitch. */
const BASS_GATE = 0.85;

/** What sounds at sixteenth number `n`, which falls at `at`. */
function stepNotes(n: number, at: number, length: number, out: Note[]): void {
  const slot = n % STEPS_PER_BAR;
  const chord = Math.floor(n / STEPS_PER_BAR) % ROOTS.length;

  if (slot % STEPS_PER_BEAT === 0) out.push({ at, dur: KICK_SECONDS, voice: 'kick', midi: 0 });

  const offset = (chord === ROOTS.length - 1 ? RUN : RIFF)[slot] ?? null;
  if (offset !== null) {
    const next = timeOfBeat((n + 1) / STEPS_PER_BEAT, length);
    out.push({
      at,
      dur: (next - at) * BASS_GATE,
      voice: 'bass',
      midi: (ROOTS[chord] ?? 0) + offset,
    });
  }

  if (slot === 0) {
    const end = timeOfBeat((n + STEPS_PER_BAR) / STEPS_PER_BEAT, length);
    for (const midi of PAD[chord] ?? []) out.push({ at, dur: end - at, voice: 'pad', midi });
  }
}

/**
 * Every note that starts in `[from, to)` seconds of a round `length` seconds long, in time order.
 * The window is half-open, so windows laid end to end hand out each note exactly once; nothing
 * sounds before the round or at its end. The notes are appended to `out`, which a timer firing
 * forty times a second can empty and hand back in instead of getting a new array each time.
 */
export function notesIn(from: number, to: number, length: number, out: Note[] = []): Note[] {
  const end = Math.min(to, length);
  if (!(length > 0) || !(from < end)) return out;

  // One step early, because the two directions of the tempo curve agree only to rounding; the
  // comparison against the real time of each step is what decides, so the extra step is skipped.
  let n = Math.max(0, Math.floor(beatAt(from, length) * STEPS_PER_BEAT) - 1);
  for (; ; n += 1) {
    const at = timeOfBeat(n / STEPS_PER_BEAT, length);
    if (at >= end) break;
    if (at >= from) stepNotes(n, at, length, out);
  }
  return out;
}
