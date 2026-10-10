import { describe, expect, it } from 'vitest';
import { random, randomBelow } from '../src/modes/cycles/random';

describe('the seeded generator', () => {
  it('draws the same sequence from the same seed', () => {
    const draw = (seed: number) => {
      const values: number[] = [];
      let current = seed;
      for (let i = 0; i < 5; i += 1) {
        const next = random(current);
        values.push(next.value);
        current = next.seed;
      }
      return values;
    };
    expect(draw(42)).toEqual(draw(42));
    expect(draw(42)).not.toEqual(draw(43));
  });

  it('stays in [0, 1) and spreads evenly enough to be fair', () => {
    const buckets = [0, 0, 0, 0];
    let seed = 1;
    for (let i = 0; i < 4000; i += 1) {
      const next = randomBelow(seed, 4);
      seed = next.seed;
      expect(next.value).toBeGreaterThanOrEqual(0);
      expect(next.value).toBeLessThan(4);
      buckets[next.value] = (buckets[next.value] ?? 0) + 1;
    }
    for (const count of buckets) expect(Math.abs(count - 1000)).toBeLessThan(120);
  });
});
