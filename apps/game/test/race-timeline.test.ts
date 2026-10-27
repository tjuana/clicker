import { TURN } from '@clicker/game';
import { PROTOCOL_VERSION, type RaceDeltaMessage, type RaceFullMessage } from '@clicker/protocol';
import { describe, expect, it } from 'vitest';
import { renderDelay } from '../src/client/clock-estimate';
import { applyDelta, fromFull, type RaceModel } from '../src/client/race/model';
import { clearRace, feedRace, RACE_RESYNC_RETRY_MS, useRace } from '../src/client/race/store';
import { createRaceTimeline, RING_TICKS, turnBetween } from '../src/client/race/timeline';

const TICK_MS = 50;
const DELAY_MS = renderDelay(TICK_MS);

function full(slots: number[], tick = 0): RaceFullMessage {
  return {
    v: PROTOCOL_VERSION,
    type: 'full',
    mode: 'race',
    tick,
    tickMs: TICK_MS,
    track: 'ring',
    laps: 3,
    cars: slots.map((slot) => ({
      slot,
      id: String(slot + 1),
      bot: false,
      x: 0,
      y: 0,
      heading: 0,
      speed: 0,
      lap: 0,
      finish: null,
      best: null,
      lapStart: 0,
    })),
  };
}

/** A model at `tick` with one car per `[slot, x, heading]`, in the given order. */
function modelAt(tick: number, cars: [number, number, number][]): RaceModel {
  const start = fromFull(full(cars.map(([slot]) => slot)));
  const delta: RaceDeltaMessage = {
    v: PROTOCOL_VERSION,
    type: 'delta',
    mode: 'race',
    t: tick,
    cars: cars.flatMap(([slot, x, heading]) => [slot, x, 0, heading, 10, 0, 0]),
    events: [],
  };
  const result = applyDelta({ ...start, tick: tick - 1 }, delta);
  if (result === null) throw new Error('refused');
  return result.model;
}

describe('turnBetween', () => {
  it('goes the short way round the wrap', () => {
    expect(turnBetween(TURN - 1, 1)).toBe(2);
    expect(turnBetween(1, TURN - 1)).toBe(-2);
    expect(turnBetween(100, 300)).toBe(200);
  });
});

describe('the race timeline', () => {
  const origin = 10_000;

  it('draws a car between its two ticks, a tick and the jitter allowance behind the server', () => {
    const timeline = createRaceTimeline(TICK_MS);
    for (let t = 1; t <= 10; t += 1) {
      timeline.arrive(modelAt(t, [[2, t * 100, 0]]), origin + t * TICK_MS, true);
    }
    // Render time 4.5: halfway between ticks 4 and 5.
    const now = origin + 4.5 * TICK_MS + DELAY_MS;
    const sample = timeline.sample(now);
    expect(sample?.count).toBe(1);
    expect(sample?.cars[0]?.slot).toBe(2);
    expect(sample?.cars[0]?.x).toBeCloseTo(450);
    expect(sample?.alpha).toBeCloseTo(0.5);
  });

  it('turns the heading the short way round, from 4095 to 1', () => {
    const timeline = createRaceTimeline(TICK_MS);
    timeline.arrive(modelAt(1, [[0, 0, TURN - 1]]), origin + TICK_MS, true);
    timeline.arrive(modelAt(2, [[0, 0, 1]]), origin + 2 * TICK_MS, true);
    timeline.arrive(modelAt(3, [[0, 0, 1]]), origin + 3 * TICK_MS, true);
    // A quarter of the way from tick 1 to tick 2.
    const sample = timeline.sample(origin + 1.25 * TICK_MS + DELAY_MS);
    const heading = sample?.cars[0]?.heading as number;
    expect(heading).toBeCloseTo(TURN - 0.5);
    const half = timeline.sample(origin + 1.5 * TICK_MS + DELAY_MS);
    // Halfway is the wrap itself, 0, and never the 2048 of the long way.
    expect(
      Math.min(half?.cars[0]?.heading as number, TURN - (half?.cars[0]?.heading as number)),
    ).toBeLessThan(0.01);
  });

  it('draws a car that the older tick did not have where the newer one has it', () => {
    const timeline = createRaceTimeline(TICK_MS);
    timeline.arrive(modelAt(1, [[0, 0, 0]]), origin + TICK_MS, true);
    const base = fromFull(full([0, 1]));
    const next = applyDelta(
      { ...base, tick: 1 },
      {
        v: PROTOCOL_VERSION,
        type: 'delta',
        mode: 'race',
        t: 2,
        cars: [0, 100, 0, 0, 0, 0, 0, 1, 500, 0, 0, 0, 0, 0],
        events: [],
      },
    );
    timeline.arrive(next?.model as RaceModel, origin + 2 * TICK_MS, true);
    timeline.arrive(
      next?.model ? { ...next.model, tick: 3 } : (null as never),
      origin + 3 * TICK_MS,
      true,
    );
    const sample = timeline.sample(origin + 1.5 * TICK_MS + DELAY_MS);
    const second = sample?.cars.slice(0, sample.count).find((c) => c.slot === 1);
    expect(second?.x).toBe(500);
    expect(second?.alpha).toBe(1);
  });

  it('interpolates across a gap in the ticks by their numbers', () => {
    const timeline = createRaceTimeline(TICK_MS);
    timeline.arrive(modelAt(1, [[0, 0, 0]]), origin + TICK_MS, true);
    timeline.arrive(modelAt(5, [[0, 400, 0]]), origin + 5 * TICK_MS, true);
    timeline.arrive(modelAt(6, [[0, 500, 0]]), origin + 6 * TICK_MS, true);
    const sample = timeline.sample(origin + 3 * TICK_MS + DELAY_MS);
    expect(sample?.cars[0]?.x).toBeCloseTo(200);
  });

  it('shows the grid as the full has it before any delta places the clock', () => {
    const timeline = createRaceTimeline(TICK_MS);
    timeline.arrive(modelAt(0, [[0, 77, 0]]), origin, false);
    expect(timeline.sample(origin + 1)?.cars[0]?.x).toBe(77);
  });

  it('holds a fixed number of ticks however long the race runs', () => {
    const timeline = createRaceTimeline(TICK_MS);
    const cars: [number, number, number][] = [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ];
    for (let t = 1; t <= 6000; t += 1) {
      const model = modelAt(
        t,
        cars.map(([s, , h]) => [s, t * 3, h]),
      );
      timeline.arrive(model, origin + t * TICK_MS, true);
      expect(timeline.held()).toBeLessThanOrEqual(RING_TICKS);
    }
    expect(timeline.held()).toBe(RING_TICKS);
    // Still right after the ring has wrapped hundreds of times.
    const sample = timeline.sample(origin + 5990.5 * TICK_MS + DELAY_MS);
    expect(sample?.cars[0]?.x).toBeCloseTo(5990.5 * 3);
  });

  it('reuses its sample, so a frame allocates nothing', () => {
    const timeline = createRaceTimeline(TICK_MS);
    for (let t = 1; t <= 5; t += 1) {
      timeline.arrive(modelAt(t, [[0, t, 0]]), origin + t * TICK_MS, true);
    }
    const a = timeline.sample(origin + 3 * TICK_MS + DELAY_MS);
    const b = timeline.sample(origin + 3.5 * TICK_MS + DELAY_MS);
    expect(b).toBe(a);
    expect(b?.cars[0]).toBe(a?.cars[0]);
  });
});

describe('feeding the race store', () => {
  const delta = (t: number, slots: number[]): RaceDeltaMessage => ({
    v: PROTOCOL_VERSION,
    type: 'delta',
    mode: 'race',
    t,
    cars: slots.flatMap((slot) => [slot, t, 0, 0, 0, 0, 0]),
    events: [],
  });

  it('takes a gap without a word and asks for the race when a slot is unknown', () => {
    clearRace();
    feedRace(full([0, 1]), 1000);
    expect(feedRace(delta(30, [0, 1]), 1100)).toBeNull();
    expect(useRace.getState().model?.tick).toBe(30);

    expect(feedRace(delta(31, [0, 1, 7]), 1150)).toBe('resync');
    // Awaiting the answer: dropped, not asked again at once.
    expect(feedRace(delta(32, [0, 1]), 1200)).toBeNull();
    expect(useRace.getState().model?.tick).toBe(30);
    // A lost ask is repeated after the retry time.
    expect(feedRace(delta(33, [0, 1]), 1150 + RACE_RESYNC_RETRY_MS)).toBe('resync');
    // The full answers it.
    feedRace(full([0, 1, 7], 40), 5000);
    expect(useRace.getState().askedAt).toBeNull();
    expect(feedRace(delta(41, [0, 1, 7]), 5050)).toBeNull();
    expect(useRace.getState().model?.tick).toBe(41);
  });

  it('ignores an old tick', () => {
    clearRace();
    feedRace(full([0], 20), 1000);
    expect(feedRace(delta(10, [0]), 1100)).toBeNull();
    expect(useRace.getState().model?.tick).toBe(20);
  });

  it('keeps the clock when the same race is sent again, and starts over for another', () => {
    clearRace();
    feedRace(full([0], 0), 1000);
    const first = useRace.getState().timeline;
    feedRace(delta(1, [0]), 1050);
    feedRace(full([0, 1], 2), 1100);
    expect(useRace.getState().timeline).toBe(first);
    feedRace(full([0, 1], 0), 1200);
    expect(useRace.getState().timeline).not.toBe(first);
  });
});
