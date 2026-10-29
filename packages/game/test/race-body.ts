import type { Car } from '../src/modes/race/car';
import { RACE } from '../src/modes/race/config';
import { cos, ONE, sin } from '../src/modes/race/fixed';

/**
 * How far apart the bodies of two cars are, measured the way the tests see them and sharing no
 * code with `src`: a body is its axis (+-reach along the heading) swept by the radius, so this is
 * the distance between the two axes, from `samples` points on each. Two bodies touch when it is
 * under two radii. Pairs whose centres are too far apart to touch are answered with a lower bound
 * on the distance (the centres' distance less both half-axes) instead of being sampled.
 */
export function axisDistance(a: Car, b: Car, samples = 201): number {
  const centres = Math.hypot(b.x - a.x, b.y - a.y);
  if (centres > 2 * RACE.reach + 2 * RACE.radius) return centres - 2 * RACE.reach;
  const point = (c: Car, i: number): [number, number] => {
    const u = ((2 * i) / (samples - 1) - 1) * RACE.reach;
    return [c.x + (u * cos(c.heading)) / ONE, c.y + (u * sin(c.heading)) / ONE];
  };
  const pa = Array.from({ length: samples }, (_, i) => point(a, i));
  const pb = Array.from({ length: samples }, (_, i) => point(b, i));
  let best = Number.POSITIVE_INFINITY;
  for (const p of pa) {
    for (const q of pb) best = Math.min(best, (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2);
  }
  return Math.sqrt(best);
}

/** How deep two bodies sink into each other; zero or less when they are clear. */
export function bodyOverlap(a: Car, b: Car, samples = 201): number {
  return 2 * RACE.radius - axisDistance(a, b, samples);
}
