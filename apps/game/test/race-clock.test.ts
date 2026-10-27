import { PROTOCOL_VERSION, type RaceDeltaMessage, type RaceFullMessage } from '@clicker/protocol';
import { describe, expect, it } from 'vitest';
import { applyDelta, fromFull, type RaceModel } from '../src/client/race/model';
import { createRaceTimeline } from '../src/client/race/timeline';

const TICK_MS = 1000 / 30;
type Trouble = 'none' | 'stall' | 'shift';

function modelAt(tick: number): RaceModel {
  const start: RaceFullMessage = {
    v: PROTOCOL_VERSION,
    type: 'full',
    mode: 'race',
    tick: tick - 1,
    tickMs: TICK_MS,
    track: 'ring',
    laps: 3,
    cars: [
      {
        slot: 0,
        id: 'a',
        bot: false,
        x: 0,
        y: 0,
        heading: 0,
        speed: 0,
        lap: 0,
        finish: null,
        best: null,
        lapStart: 0,
      },
    ],
  };
  const delta: RaceDeltaMessage = {
    v: PROTOCOL_VERSION,
    type: 'delta',
    mode: 'race',
    t: tick,
    cars: [0, tick * 100, 0, 0, 10, 0, 0],
    events: [],
  };
  const result = applyDelta(fromFull(start), delta);
  if (result === null) throw new Error('refused');
  return result.model;
}

/** When the server's tick reaches the client: 20 ms of network, and a stall the ticker caught up. */
function arrival(tick: number, trouble: Trouble): number {
  const lag = 20;
  // The route changes at tick 60 and every message is 300 ms later from then on.
  if (trouble === 'shift') return tick * TICK_MS + lag + (tick > 60 ? 300 : 0);
  if (trouble === 'none' || tick <= 90) return tick * TICK_MS + lag;
  // A stall of a second after tick 90; the ticker catches up ten steps at once (its limit), so
  // from then on the tick numbers run 20 ticks behind the wall.
  if (tick <= 100) return 4000 + lag;
  return 4000 + lag + (tick - 100) * TICK_MS;
}

/** Plays frames of 60 Hz over eight seconds; returns the render tick of every frame. */
function play(trouble: Trouble): { at: number; render: number; x: number }[] {
  const timeline = createRaceTimeline(TICK_MS);
  const frames: { at: number; render: number; x: number }[] = [];
  let next = 1;
  for (let now = 0; now < 8000; now += 1000 / 60) {
    while (arrival(next, trouble) <= now) {
      timeline.arrive(modelAt(next), arrival(next, trouble), true);
      next += 1;
    }
    const sample = timeline.sample(now);
    frames.push({ at: now, render: timeline.renderTick(now), x: sample?.cars[0]?.x ?? Number.NaN });
  }
  return frames;
}

describe('the race clock', () => {
  it('draws a smoothly moving car on a steady stream', () => {
    const frames = play('none').filter((f) => f.at > 1000);
    const still = frames.filter((f, i) => i > 0 && f.x === (frames[i - 1] as { x: number }).x);
    expect(still.length).toBe(0);
  });

  it('moves the car again soon after a stall the ticker could only part catch up', () => {
    const frames = play('stall').filter((f) => f.at > 4600);
    const still = frames.filter((f, i) => i > 0 && f.x === (frames[i - 1] as { x: number }).x);
    expect(still.length).toBe(0);
  });

  it('never draws a tick earlier than it already drew, when the clock turns out to be early', () => {
    const frames = play('shift');
    for (let i = 1; i < frames.length; i += 1) {
      expect((frames[i] as { render: number }).render).toBeGreaterThanOrEqual(
        (frames[i - 1] as { render: number }).render,
      );
    }
  });

  it('never draws past the newest tick there is, however far the clock runs ahead', () => {
    const timeline = createRaceTimeline(TICK_MS);
    for (let t = 1; t <= 10; t += 1) timeline.arrive(modelAt(t), t * TICK_MS, true);
    expect(timeline.renderTick(60_000)).toBe(10);
  });
});
