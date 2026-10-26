import { describe, expect, it } from 'vitest';
import { cos, ONE, sin, TURN } from '../src/modes/race/fixed';

describe('the race sine table', () => {
  it('agrees with Math.sin to the nearest unit at every heading', () => {
    const wrong: number[] = [];
    for (let h = 0; h < TURN; h += 1) {
      if (sin(h) !== Math.round(Math.sin((2 * Math.PI * h) / TURN) * ONE)) wrong.push(h);
    }
    expect(wrong).toEqual([]);
  });

  it('keeps sin² + cos² at one', () => {
    for (let h = 0; h < TURN; h += 1) {
      expect(Math.abs((sin(h) ** 2 + cos(h) ** 2) / ONE - ONE)).toBeLessThanOrEqual(2);
    }
  });

  it('has the symmetries of a sine', () => {
    for (let h = 0; h < TURN; h += 1) {
      expect(sin(TURN / 2 - h)).toBe(sin(h));
      expect(sin(h + TURN / 2)).toBe(0 - sin(h));
      expect(cos(h)).toBe(sin(h + TURN / 4));
    }
  });

  it('takes any integer heading, negative or past a full turn, as the same direction', () => {
    expect(sin(-1)).toBe(sin(TURN - 1));
    expect(cos(5 * TURN + 7)).toBe(cos(7));
  });

  it('has the exact values at the quarter turns', () => {
    expect([sin(0), sin(TURN / 4), sin(TURN / 2), sin((3 * TURN) / 4)]).toEqual([0, ONE, 0, -ONE]);
  });
});
