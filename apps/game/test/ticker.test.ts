import { describe, expect, it } from 'vitest';
import { MAX_CATCH_UP, owedSteps, Ticker } from '../src/worker/ticker';

const TICK = 50;

describe('owedSteps', () => {
  it('owes nothing before the deadline and leaves the deadline where it was', () => {
    expect(owedSteps(999, 1000, TICK, MAX_CATCH_UP)).toEqual({ owed: 0, nextStepAt: 1000 });
  });

  it('owes one step on the deadline itself', () => {
    expect(owedSteps(1000, 1000, TICK, MAX_CATCH_UP)).toEqual({ owed: 1, nextStepAt: 1050 });
  });

  it('owes one step a hair before the next one is due', () => {
    expect(owedSteps(1049, 1000, TICK, MAX_CATCH_UP)).toEqual({ owed: 1, nextStepAt: 1050 });
  });

  it('owes three steps after a pause of three periods', () => {
    expect(owedSteps(1100, 1000, TICK, MAX_CATCH_UP)).toEqual({ owed: 3, nextStepAt: 1150 });
  });

  it('runs the cap and forgets the rest after a long stall', () => {
    // 101 steps are due; ten are run, and the deadline lands after `now`, not 91 steps behind it.
    const result = owedSteps(6000, 1000, TICK, MAX_CATCH_UP);

    expect(result.owed).toBe(MAX_CATCH_UP);
    expect(result.nextStepAt).toBe(6050);
  });

  it('is not caught up by a stall of exactly the cap', () => {
    expect(owedSteps(1450, 1000, TICK, MAX_CATCH_UP)).toEqual({ owed: 10, nextStepAt: 1500 });
  });
});

/** workerd has no fake clock, so the ticker takes its clock and its timers as parameters. */
function rig(stepKeepsGoing = true) {
  let now = 1000;
  const intervals = new Map<number, { wake: () => void; ms: number }>();
  let next = 1;
  const stepsAt: number[] = [];
  const ticker = new Ticker<number>({
    now: () => now,
    setInterval: (wake, ms) => {
      intervals.set(next, { wake, ms });
      return next++;
    },
    clearInterval: (handle) => {
      intervals.delete(handle);
    },
    step: (at) => {
      stepsAt.push(at);
      return stepKeepsGoing;
    },
  });
  return {
    ticker,
    intervals,
    stepsAt,
    /** The clock moves, then the one timer that is armed fires — as the runtime would do it. */
    wakeAt(time: number) {
      now = time;
      for (const { wake } of [...intervals.values()]) wake();
    },
    setNow(time: number) {
      now = time;
    },
  };
}

describe('Ticker', () => {
  it('arms one interval of the tick length when the round starts, and not a second on repeat', () => {
    const { ticker, intervals } = rig();

    ticker.sync(true, TICK);
    ticker.sync(true, TICK);

    expect([...intervals.values()].map((interval) => interval.ms)).toEqual([TICK]);
  });

  it('runs no step before the first period is over', () => {
    const { ticker, stepsAt, wakeAt } = rig();
    ticker.sync(true, TICK);

    wakeAt(1000 + TICK - 1);

    expect(stepsAt).toEqual([]);
  });

  it('runs every step the clock says is owed when it wakes late', () => {
    const { ticker, stepsAt, wakeAt } = rig();
    ticker.sync(true, TICK);

    wakeAt(1000 + 3 * TICK);

    expect(stepsAt).toHaveLength(3);
  });

  it('runs the cap after a long stall, and the next period owes one step again', () => {
    const { ticker, stepsAt, wakeAt } = rig();
    ticker.sync(true, TICK);

    wakeAt(1000 + 5000);
    expect(stepsAt).toHaveLength(MAX_CATCH_UP);

    wakeAt(1000 + 5000 + TICK);
    expect(stepsAt).toHaveLength(MAX_CATCH_UP + 1);
  });

  it('hands each step the time of the wake-up', () => {
    const { ticker, stepsAt, wakeAt } = rig();
    ticker.sync(true, TICK);

    wakeAt(1000 + 2 * TICK);

    expect(stepsAt).toEqual([1100, 1100]);
  });

  it('stops catching up as soon as a step says the round is over', () => {
    const { ticker, stepsAt, wakeAt } = rig(false);
    ticker.sync(true, TICK);

    wakeAt(1000 + 3 * TICK);

    expect(stepsAt).toHaveLength(1);
  });

  it('clears the interval when the round stops, so an idle room can sleep', () => {
    const { ticker, intervals } = rig();
    ticker.sync(true, TICK);

    ticker.sync(false, TICK);

    expect(intervals.size).toBe(0);
  });

  it('does not run when the mode has no tick of its own', () => {
    const { ticker, intervals } = rig();

    ticker.sync(true, null);

    expect(intervals.size).toBe(0);
  });

  it('starts the next round on a fresh schedule, with no burst for the time in between', () => {
    const { ticker, stepsAt, wakeAt, setNow } = rig();
    ticker.sync(true, TICK);
    wakeAt(1000 + TICK);
    ticker.sync(false, TICK);
    stepsAt.length = 0;

    setNow(60_000);
    ticker.sync(true, TICK);
    wakeAt(60_000 + TICK);

    expect(stepsAt).toHaveLength(1);
  });
});
