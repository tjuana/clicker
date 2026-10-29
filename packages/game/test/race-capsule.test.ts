import { describe, expect, it } from 'vitest';
import { closest, type Segment } from '../src/modes/race/capsule';

/** A small deterministic generator: the same segments on every run and every engine. */
function lcg(seed: number): (low: number, high: number) => number {
  let state = seed >>> 0;
  return (low, high) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return low + (state % (high - low + 1));
  };
}

const at = (a: Segment, u: number) => [a.x + a.dx * u, a.y + a.dy * u] as const;

/** The distance between the points `closest` picked, worked out here from `s` and `t`. */
function distance(a: Segment, b: Segment): number {
  const { s, t } = closest(a, b);
  const [ax, ay] = at(a, s);
  const [bx, by] = at(b, t);
  return Math.hypot(bx - ax, by - ay);
}

/** The shortest distance over `n` evenly spaced points on each segment. */
function sampled(a: Segment, b: Segment, n = 401): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < n; i += 1) {
    const [ax, ay] = at(a, i / (n - 1));
    for (let j = 0; j < n; j += 1) {
      const [bx, by] = at(b, j / (n - 1));
      best = Math.min(best, (bx - ax) ** 2 + (by - ay) ** 2);
    }
  }
  return Math.sqrt(best);
}

/** Segments up to 400 units long, so 401 samples are a unit apart or closer. */
function randomSegments(count: number, seed: number): [Segment, Segment][] {
  const next = lcg(seed);
  const one = (): Segment => ({
    x: next(-600, 600),
    y: next(-600, 600),
    dx: next(-280, 280),
    dy: next(-280, 280),
  });
  return Array.from({ length: count }, () => [one(), one()]);
}

const pairs = randomSegments(120, 20261029);

describe('the closest points of two segments', () => {
  it('stay on the segments', () => {
    for (const [a, b] of pairs) {
      const { s, t } = closest(a, b);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
    }
  });

  it('are as far apart whichever segment is asked first', () => {
    for (const [a, b] of pairs) {
      expect(distance(b, a)).toBeCloseTo(distance(a, b), 6);
    }
  });

  it('are never further apart than any pair of ends', () => {
    for (const [a, b] of pairs) {
      const ends = [0, 1].flatMap((u) =>
        [0, 1].map((v) => Math.hypot(at(b, v)[0] - at(a, u)[0], at(b, v)[1] - at(a, u)[1])),
      );
      expect(distance(a, b)).toBeLessThanOrEqual(Math.min(...ends) + 1e-6);
    }
  });

  it('are as close as a brute-force search over sampled points finds', () => {
    for (const [a, b] of pairs) {
      const found = distance(a, b);
      const brute = sampled(a, b);
      // The sampled points lie on the segments, so the true minimum is no larger than the
      // sampled one; and a unit of spacing cannot hide more than a unit.
      expect(found).toBeLessThanOrEqual(brute + 1e-6);
      expect(found).toBeGreaterThanOrEqual(brute - 1);
    }
  });

  it('are the same point when the segments cross', () => {
    const next = lcg(77);
    for (let n = 0; n < 60; n += 1) {
      // Two lines through one integer point, extended a whole number of steps each way.
      const px = next(-500, 500);
      const py = next(-500, 500);
      const d1 = { x: next(-40, 40), y: next(-40, 40) };
      const d2 = { x: next(-40, 40), y: next(-40, 40) };
      if (d1.x * d2.y - d1.y * d2.x === 0) continue;
      const k = () => next(1, 5);
      const [a1, a2, b1, b2] = [k(), k(), k(), k()];
      const a: Segment = {
        x: px - a1 * d1.x,
        y: py - a1 * d1.y,
        dx: (a1 + a2) * d1.x,
        dy: (a1 + a2) * d1.y,
      };
      const b: Segment = {
        x: px - b1 * d2.x,
        y: py - b1 * d2.y,
        dx: (b1 + b2) * d2.x,
        dy: (b1 + b2) * d2.y,
      };
      expect(distance(a, b)).toBeLessThan(1e-6);
    }
  });

  it('are the width of the gap when the segments run side by side', () => {
    // Direction (3, 4) and its perpendicular (-4, 3): an offset of m steps is 5m units.
    const next = lcg(5);
    for (let n = 0; n < 40; n += 1) {
      const len = next(2, 60);
      const offset = next(1, 80);
      const slide = next(-len + 1, len - 1); // the other segment overlaps this one's extent
      const a: Segment = { x: next(-300, 300), y: next(-300, 300), dx: 3 * len, dy: 4 * len };
      const reversed = n % 2 === 1;
      const bx = a.x - 4 * offset + 3 * slide;
      const by = a.y + 3 * offset + 4 * slide;
      const b: Segment = reversed
        ? { x: bx + 3 * len, y: by + 4 * len, dx: -3 * len, dy: -4 * len }
        : { x: bx, y: by, dx: 3 * len, dy: 4 * len };
      expect(distance(a, b)).toBeCloseTo(5 * offset, 6);
      expect(distance(b, a)).toBeCloseTo(5 * offset, 6);
    }
  });

  it('work for a segment of no length, which is a point', () => {
    const segment: Segment = { x: -100, y: 0, dx: 300, dy: 0 };
    const cases: [Segment, number][] = [
      [{ x: 50, y: 70, dx: 0, dy: 0 }, 70], // beside the middle
      [{ x: 300, y: 0, dx: 0, dy: 0 }, 100], // past the far end
      [{ x: -130, y: 40, dx: 0, dy: 0 }, 50], // past the near end
      [{ x: 0, y: 0, dx: 0, dy: 0 }, 0], // on it
    ];
    for (const [point, expected] of cases) {
      expect(distance(point, segment)).toBeCloseTo(expected, 6);
      expect(distance(segment, point)).toBeCloseTo(expected, 6);
    }
    const here: Segment = { x: 3, y: 4, dx: 0, dy: 0 };
    expect(distance(here, { x: 0, y: 0, dx: 0, dy: 0 })).toBeCloseTo(5, 6);
  });
});
