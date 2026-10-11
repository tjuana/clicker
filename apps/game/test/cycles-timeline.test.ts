import { describe, expect, it } from 'vitest';
import type { Head } from '../src/client/cycles/model';
import { createTimeline, renderDelay, type Step } from '../src/client/cycles/timeline';

const TICK_MS = 125;
/** The delay the scene draws behind the server; the same figure the timeline is built around. */
const DELAY_MS = renderDelay(TICK_MS);

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

/** The `full` of a tick: everything laid at once, the scene clears before it. */
function reset(tick: number): Step {
  return { ...step(tick), walls: [{ kind: 'put', cell: tick, slot: 1, from: -1 }], reset: true };
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

  it('releases the ticks that fell due while the network held them together, in order, and the rest as each falls due', () => {
    const { timeline, arrival } = afterBurst();

    // Tick 14 was stepped just now. Ticks 10 to 12 were due while the network held them; 13 and 14
    // wait for the moment each was stepped plus the delay, a tick apart.
    expect(timeline.release(arrival).map((each) => each.tick)).toEqual([10, 11, 12]);
    expect(timeline.release(arrival + DELAY_MS - TICK_MS - 1)).toEqual([]);
    expect(timeline.release(arrival + DELAY_MS - TICK_MS).map((each) => each.tick)).toEqual([13]);
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

describe('a scene that draws while the ticks are still arriving', () => {
  const FRAME_MS = 16;
  const LATENCY_MS = 40;
  const origin = 10_000;
  const SECONDS = 30;

  /** A late arrival in [0, max] ms without a random generator: a fixed walk that does not repeat soon. */
  const late = (tick: number, max: number): number => (((tick * 7919) % 101) / 100) * max;

  /**
   * The bike of the arena's scene, frame by frame: a message is handed over when its time has come,
   * then the frame takes what the clock has reached and samples as the scene does. Arrivals and
   * frames are interleaved because a timeline that is given every arrival first is never short of
   * a tick, whatever delay it draws at. The bike rides one cell a tick, so its place is its cell.
   */
  function ride(speed: number, jitter: number) {
    const tickMs = 1000 / speed;
    const timeline = createTimeline(tickMs);
    const places: number[] = [];
    let held = 0;
    let next = 0;
    for (let now = origin; now < origin + SECONDS * 1000; now += FRAME_MS) {
      while (origin + next * tickMs + LATENCY_MS + late(next, jitter) <= now) {
        const arrival = origin + next * tickMs + LATENCY_MS + late(next, jitter);
        timeline.arrive(step(next), arrival);
        next += 1;
      }
      timeline.release(now, 1);
      const sample = timeline.sample(now);
      // The first seconds are the clock finding the schedule; what is asked is the steady state.
      if (sample === null || now < origin + 5_000) continue;
      const from = sample.from.get(1)?.cell as number;
      const to = sample.to.get(1)?.cell as number;
      if (from === to) held += 1;
      places.push(from + (to - from) * sample.alpha);
    }
    return { places, held, smooth: FRAME_MS / tickMs };
  }

  const cases = [8, 12, 16, 20].flatMap((speed) =>
    [0, 30, 57].map((jitter) => ({ speed, jitter })),
  );

  it.each(cases)(
    'never freezes the bike at speed $speed with arrivals up to $jitter ms late',
    ({ speed, jitter }) => {
      const { places, held } = ride(speed, jitter);

      expect(places.length).toBeGreaterThan(1_000);
      expect(held).toBe(0);
    },
  );

  it.each(cases)(
    'moves the bike smoothly at speed $speed with arrivals up to $jitter ms late',
    ({ speed, jitter }) => {
      const { places, smooth } = ride(speed, jitter);

      const steps = places.slice(1).map((place, index) => place - (places[index] as number));
      // Never backwards, never more than two frames' worth at once, and never standing still.
      expect(Math.min(...steps)).toBeGreaterThan(smooth / 2);
      expect(Math.max(...steps)).toBeLessThan(smooth * 2);
    },
  );
});

describe('a full that comes long before the first delta', () => {
  const FRAME_MS = 16;
  const LATENCY_MS = 40;
  const COUNTDOWN_MS = 3_000;
  const origin = 10_000;
  const goAt = origin + COUNTDOWN_MS;

  /**
   * What the room sends: the full of tick 0 as the countdown starts, then the first delta a tick
   * after the countdown ends. Frames run from the countdown on; each gives the scene what it
   * takes and notes whether the bike is between two ticks or held on one.
   */
  function countdown(speed: number) {
    const tickMs = 1000 / speed;
    const timeline = createTimeline(tickMs);
    timeline.arrive(reset(0), origin + LATENCY_MS);
    const frames: Array<{
      now: number;
      delta: number;
      released: number[];
      place: number;
      held: boolean;
    }> = [];
    let next = 1;
    for (let now = origin + LATENCY_MS; now < goAt + 20_000; now += FRAME_MS) {
      while (goAt + next * tickMs + LATENCY_MS <= now) {
        timeline.arrive(step(next), goAt + next * tickMs + LATENCY_MS);
        next += 1;
      }
      const released = timeline.release(now, 1).map((each) => each.tick);
      const sample = timeline.sample(now);
      if (sample === null) continue;
      const from = sample.from.get(1)?.cell as number;
      const to = sample.to.get(1)?.cell as number;
      frames.push({
        now,
        delta: next - 1,
        released,
        place: from + (to - from) * sample.alpha,
        held: from === to,
      });
    }
    return { frames, smooth: FRAME_MS / tickMs };
  }

  it('lays the spawn walls at once, during the countdown, not when a clock says so', () => {
    const { frames } = countdown(12);

    expect(frames[0]?.released).toEqual([0]);
    expect(frames[0]?.now).toBeLessThan(goAt);
  });

  it.each([8, 12, 16, 20])('rides smoothly from the third delta on at speed %i', (speed) => {
    const { frames, smooth } = countdown(speed);

    const riding = frames.filter((frame) => frame.delta >= 3);
    expect(riding.length).toBeGreaterThan(1_000);
    expect(riding.filter((frame) => frame.held)).toEqual([]);
    const steps = riding.slice(1).map((frame, index) => frame.place - (riding[index]?.place ?? 0));
    expect(Math.min(...steps)).toBeGreaterThan(smooth / 2);
    expect(Math.max(...steps)).toBeLessThan(smooth * 2);
  });
});

describe('a server that stalls for a long time', () => {
  const FRAME_MS = 16;
  const LATENCY_MS = 40;
  const STALL_MS = 10_000;
  const origin = 10_000;

  it('is found again within a second of the first tick after it, not after sixty-four of them', () => {
    const timeline = createTimeline(TICK_MS);
    const resumeAt = origin + 40 * TICK_MS + STALL_MS + LATENCY_MS;
    const arrival = (tick: number) =>
      origin + tick * TICK_MS + LATENCY_MS + (tick < 40 ? 0 : STALL_MS);
    const places: Array<{ now: number; place: number; held: boolean }> = [];
    let next = 0;
    for (let now = origin; now < resumeAt + 15_000; now += FRAME_MS) {
      while (arrival(next) <= now) {
        timeline.arrive(step(next), arrival(next));
        next += 1;
      }
      timeline.release(now, 1);
      const sample = timeline.sample(now);
      if (sample === null || now < resumeAt + 1_000) continue;
      const from = sample.from.get(1)?.cell as number;
      const to = sample.to.get(1)?.cell as number;
      places.push({ now, place: from + (to - from) * sample.alpha, held: from === to });
    }

    expect(places.length).toBeGreaterThan(800);
    expect(places.filter((each) => each.held)).toEqual([]);
    const steps = places.slice(1).map((each, index) => each.place - (places[index]?.place ?? 0));
    expect(Math.min(...steps)).toBeGreaterThan(FRAME_MS / TICK_MS / 2);
    expect(Math.max(...steps)).toBeLessThan((FRAME_MS / TICK_MS) * 2);
  });
});
