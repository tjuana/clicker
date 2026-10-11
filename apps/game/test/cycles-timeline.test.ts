import { describe, expect, it } from 'vitest';
import type { Head } from '../src/client/cycles/model';
import { createTimeline, type Step } from '../src/client/cycles/timeline';

const TICK_MS = 125;
/** The delay the scene draws behind the server; the same figure the timeline is built around. */
const DELAY_MS = 100;

function head(cell: number): Map<number, Head> {
  return new Map([[1, { slot: 1, cell, dir: 0, rubber: 3, cooldown: 0 }]]);
}

function step(tick: number): Step {
  return {
    tick,
    walls: [{ kind: 'put', cell: tick, slot: 1, from: tick - 1 }],
    heads: head(tick),
    events: [],
    reset: false,
  };
}

/** Jitter without a random generator: a fixed walk through [-30, 30] that never repeats at once. */
function jitter(tick: number): number {
  return ((tick * 37) % 61) - 30;
}

describe('the timeline of a steady stream with jittery arrival', () => {
  const origin = 10_000;
  const trueRender = (now: number) => (now - origin - DELAY_MS) / TICK_MS;

  /** Plays 120 ticks, a frame every 16 ms, and hands each frame to `onFrame` in time order. */
  function play(onFrame: (now: number, timeline: ReturnType<typeof createTimeline>) => void) {
    const timeline = createTimeline(TICK_MS);
    let next = 0;
    for (let now = origin; now < origin + 120 * TICK_MS; now += 16) {
      while (next < 120 && origin + next * TICK_MS + jitter(next) <= now) {
        timeline.arrive(step(next), origin + next * TICK_MS + jitter(next));
        next += 1;
      }
      onFrame(now, timeline);
    }
  }

  it('advances the render tick monotonically and within one tick of the true schedule', () => {
    let previous = Number.NEGATIVE_INFINITY;
    let frames = 0;
    play((now, timeline) => {
      const render = timeline.renderTick(now);
      if (!Number.isFinite(render)) return;
      frames += 1;
      expect(render).toBeGreaterThanOrEqual(previous);
      expect(Math.abs(render - trueRender(now))).toBeLessThan(1);
      previous = render;
    });
    expect(frames).toBeGreaterThan(900);
  });

  it('releases the ticks in order, each once, and never one the render tick has not reached', () => {
    const released: number[] = [];
    play((now, timeline) => {
      for (const each of timeline.release(now)) {
        expect(each.tick).toBeLessThanOrEqual(timeline.renderTick(now));
        released.push(each.tick);
      }
    });
    // The newest ticks are still within the delay when the run ends.
    expect(released.length).toBeGreaterThan(105);
    expect(released).toEqual(released.map((_, index) => index));
  });
});

describe('releasing a tick early', () => {
  it('lays the walls of the next tick while the bike still rides towards it, and no sooner', () => {
    const origin = 7_000;
    const timeline = createTimeline(TICK_MS);
    for (let tick = 0; tick < 8; tick += 1) timeline.arrive(step(tick), origin + tick * TICK_MS);

    // The render clock sits exactly on tick 3: a lead of one tick takes tick 4, not tick 5.
    const at = origin + 3 * TICK_MS + DELAY_MS;
    expect(timeline.release(at, 1).map((each) => each.tick)).toEqual([0, 1, 2, 3, 4]);
    expect(timeline.release(at, 1)).toEqual([]);
    expect(timeline.release(at + TICK_MS, 1).map((each) => each.tick)).toEqual([5]);
  });
});

describe('a burst of deltas', () => {
  /** Ten ticks on time, then ticks 10-14 held back and delivered together as tick 14 is stepped. */
  function afterBurst() {
    const origin = 50_000;
    const timeline = createTimeline(TICK_MS);
    for (let tick = 0; tick < 10; tick += 1) timeline.arrive(step(tick), origin + tick * TICK_MS);
    const arrival = origin + 14 * TICK_MS;
    timeline.release(origin + 9 * TICK_MS + DELAY_MS);
    for (let tick = 10; tick < 15; tick += 1) timeline.arrive(step(tick), arrival);
    return { timeline, arrival };
  }

  it('is released on the schedule the ticks were stepped on, not all at once on arrival', () => {
    const { timeline, arrival } = afterBurst();

    // Tick 14 was stepped just now; ticks 10 to 13 were due while the network held them.
    expect(timeline.release(arrival).map((each) => each.tick)).toEqual([10, 11, 12, 13]);
    expect(timeline.release(arrival + DELAY_MS - 1)).toEqual([]);
    expect(timeline.release(arrival + DELAY_MS).map((each) => each.tick)).toEqual([14]);
  });

  it('does not rewind the render tick when the late ticks pull the estimate around', () => {
    const { timeline, arrival } = afterBurst();
    const before = timeline.renderTick(arrival - 1);

    expect(timeline.renderTick(arrival)).toBeGreaterThanOrEqual(before);
  });
});

describe('the heads the scene draws between two ticks', () => {
  const origin = 1_000;

  function running(until: number) {
    const timeline = createTimeline(TICK_MS);
    for (let tick = 0; tick <= until; tick += 1) {
      timeline.arrive(step(tick), origin + tick * TICK_MS);
    }
    return timeline;
  }

  it('interpolates between the tick the render clock is in and the next one', () => {
    const timeline = running(20);
    // Render tick 10.5: 100 ms behind the stepping of tick 10.5.
    const now = origin + 10.5 * TICK_MS + DELAY_MS;

    const sample = timeline.sample(now);

    expect(sample?.from.get(1)?.cell).toBe(10);
    expect(sample?.to.get(1)?.cell).toBe(11);
    expect(sample?.alpha).toBeCloseTo(0.5);
  });

  it('holds the newest heads when the render clock is ahead of what has arrived', () => {
    const timeline = running(10);

    const sample = timeline.sample(origin + 14 * TICK_MS);

    expect(sample?.from.get(1)?.cell).toBe(10);
    expect(sample?.to.get(1)?.cell).toBe(10);
    expect(sample?.alpha).toBe(0);
  });

  it('keeps answering correctly long after the old ticks were dropped', () => {
    const timeline = running(200);

    for (let now = origin; now < origin + 190 * TICK_MS; now += 16) {
      timeline.release(now);
      const sample = timeline.sample(now);
      const at = timeline.renderTick(now);
      if (!Number.isFinite(at) || at < 0) continue;
      expect(sample?.from.get(1)?.cell).toBe(Math.floor(at));
      expect(sample?.to.get(1)?.cell).toBe(Math.floor(at) + 1);
    }
  });

  it('has nothing to draw before the first message', () => {
    expect(createTimeline(TICK_MS).sample(origin)).toBeNull();
    expect(createTimeline(TICK_MS).release(origin)).toEqual([]);
  });
});
