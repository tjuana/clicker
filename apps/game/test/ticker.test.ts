import { describe, expect, it } from 'vitest';
import { MAX_CATCH_UP, owedSteps } from '../src/worker/ticker';

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
