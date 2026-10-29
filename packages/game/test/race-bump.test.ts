import { describe, expect, it } from 'vitest';
import { bump } from '../src/modes/race/bump';
import type { Car } from '../src/modes/race/car';
import { RACE } from '../src/modes/race/config';
import { TILE } from '../src/modes/race/fixed';
import { axisDistance } from './race-body';

const bounds = { x: 0, y: 0, width: 10, height: 10 };

function car(slot: number, x: number, y: number, over: Partial<Car> = {}): Car {
  return {
    slot,
    publicId: `p${slot}`,
    bot: false,
    out: false,
    abandoned: false,
    x,
    y,
    heading: 0,
    speed: 0,
    piece: 0,
    lap: 0,
    keys: 0,
    finish: null,
    best: null,
    lapStart: 0,
    pace: 100,
    wall: 0,
    touch: 0,
    ...over,
  };
}

const touching = 2 * RACE.radius;
const mid = 5 * TILE + TILE / 2;

describe('separation', () => {
  it('leaves overlapping cars at least two radii apart', () => {
    const cases: [number, number, number, number][] = [
      [0, 410, 0, 0], // side by side, parallel
      [0, 300, 0, 2000], // nose to tail, a lane apart
      [0, 0, 1024, 1024], // crossing at a right angle through one point
      [0, 250, 200, 3950], // slanted a little each way
    ];
    for (const [dx, dy, headA, headB] of cases) {
      const a = car(0, mid, mid, { heading: headA });
      const b = car(1, mid + dx, mid + dy, { heading: headB });
      bump([a, b], bounds, RACE);
      expect(axisDistance(a, b)).toBeGreaterThanOrEqual(touching - 1);
    }
  });

  it('leaves cars that were clear exactly where they were', () => {
    const a = car(0, mid, mid);
    const b = car(1, mid, mid + 2700);
    bump([a, b], bounds, RACE);
    expect([a.x, a.y, b.x, b.y]).toEqual([mid, mid, mid, mid + 2700]);
  });

  it('separates a car lying exactly on another', () => {
    const a = car(0, mid, mid);
    const b = car(1, mid, mid);
    bump([a, b], bounds, RACE);
    expect(axisDistance(a, b)).toBeGreaterThanOrEqual(touching - 1);
  });

  it('separates a pile of cars pushed by several neighbours', () => {
    const cars = [0, 1, 2, 3, 4].map((slot) => car(slot, mid + slot * 80, mid + (slot % 2) * 90));
    // Five cars inside 400 units is more than any tick of play produces; a few ticks clear it.
    for (let tick = 0; tick < 5; tick += 1) bump(cars, bounds, RACE);
    for (let i = 0; i < cars.length; i += 1) {
      for (let j = i + 1; j < cars.length; j += 1) {
        expect(axisDistance(cars[i] as Car, cars[j] as Car)).toBeGreaterThanOrEqual(touching - 1);
      }
    }
  });

  // B points at the middle of A with its nose `depth` units inside A's body: the waist that two
  // circles per car leave between them.
  it.each([20, 60, 100, 150, 200])('separates a nose pushed %i deep into the middle', (depth) => {
    const a = car(0, mid, mid);
    const b = car(1, mid, mid + RACE.reach + touching - depth, { heading: 3072 });
    bump([a, b], bounds, RACE);
    expect(axisDistance(a, b)).toBeGreaterThanOrEqual(touching - 1);
  });

  describe.each([256, 512, 1024, 1536, 2048])('axes crossing, headings %i apart', (apart) => {
    it.each([-200, 0, 200])('separates them with the crossing %i along the axis', (along) => {
      const a = car(0, mid, mid);
      const b = car(1, mid + along, mid, { heading: apart });
      bump([a, b], bounds, RACE);
      expect(axisDistance(a, b)).toBeGreaterThanOrEqual(touching - 1);
    });
  });

  // Axes that cross at a fractional point have a closest-point distance of rounding noise, not
  // zero (here about 4e-12). That must still count as crossing: the noise has no direction, and
  // pushing along it would throw the cars across the track. Found by search; the pair is fixed.
  it('pushes axes that cross at a fractional point along the line between the centres', () => {
    const a = car(0, mid, mid);
    const b = car(1, mid + 85, mid + 90, { heading: 309 });
    bump([a, b], bounds, RACE);
    const [ax, ay, bx, by] = [a.x - mid, a.y - mid, b.x - mid - 85, b.y - mid - 90];
    // Each car moved, in opposite directions, along (85, 90): a cross product of the move with
    // that line, over its length and the move's, is the sine of the angle between them.
    const sine = (x: number, y: number) =>
      (x * 90 - y * 85) / Math.hypot(85, 90) / Math.hypot(x, y);
    expect(Math.hypot(ax, ay)).toBeGreaterThan(0);
    expect(Math.abs(sine(ax, ay))).toBeLessThan(0.05);
    expect(Math.abs(sine(bx, by))).toBeLessThan(0.05);
    expect(ax * bx + ay * by).toBeLessThan(0);
    expect(Math.hypot(ax, ay)).toBeLessThan(touching);
    expect(axisDistance(a, b)).toBeGreaterThanOrEqual(touching - 1);
  });

  it('separates every overlapping pair of a sweep of positions and headings', () => {
    const samples = 201;
    let overlapping = 0;
    const failures: string[] = [];
    for (let dx = -600; dx <= 600; dx += 150) {
      for (let dy = -600; dy <= 600; dy += 150) {
        for (let heading = 0; heading < 4096; heading += 256) {
          const a = car(0, mid, mid);
          const b = car(1, mid + dx, mid + dy, { heading });
          if (axisDistance(a, b, samples) >= touching) continue;
          overlapping += 1;
          bump([a, b], bounds, RACE);
          const left = axisDistance(a, b, samples);
          if (left < touching - 1)
            failures.push(`(${dx}, ${dy}) at ${heading}: ${left.toFixed(0)}`);
        }
      }
    }
    expect(overlapping).toBeGreaterThan(1000);
    // The first few say which pairs; the count says how many.
    expect({ left: failures.length, first: failures.slice(0, 5) }).toEqual({ left: 0, first: [] });
  });
});

describe('the car behind', () => {
  it('ends no faster than the car it ran into', () => {
    const slow = car(1, mid + 500, mid, { speed: 90 });
    const fast = car(0, mid, mid, { speed: 200 });
    bump([fast, slow], bounds, RACE);
    expect(fast.speed).toBeLessThanOrEqual(90);
    expect(slow.speed).toBe(90);
  });

  it('is not slowed by a car it is beside or ahead of', () => {
    const a = car(0, mid, mid, { speed: 200 });
    const b = car(1, mid, mid + 410, { speed: 90 });
    bump([a, b], bounds, RACE);
    expect([a.speed, b.speed]).toEqual([200, 90]);
  });

  it('is not slowed by a car it is not touching', () => {
    const a = car(0, mid, mid, { speed: 200 });
    const b = car(1, mid + 2000, mid, { speed: 90 });
    bump([a, b], bounds, RACE);
    expect(a.speed).toBe(200);
  });

  it('does not cap a train of cars at the speed of the one at its tail', () => {
    // Each car runs into the next at 5 units more than it: the cap is the car in front, once,
    // and never a factor compounding down the line.
    const cars = [0, 1, 2, 3].map((slot) =>
      car(slot, mid + slot * 700, mid, { speed: 200 - slot * 5 }),
    );
    bump(cars, bounds, RACE);
    // Two passes let the slowest speed travel two cars up the line; none goes below it.
    expect(cars.map((c) => c.speed)).toEqual([190, 185, 185, 185]);
  });
});

describe('order', () => {
  it('gives the same result whatever order twenty cars are listed in', () => {
    const make = () =>
      Array.from({ length: 20 }, (_, slot) =>
        car(slot, mid + ((slot * 137) % 700), mid + ((slot * 251) % 600), {
          heading: (slot * 613) % 4096,
          speed: (slot * 37) % 200,
        }),
      );
    const reference = make();
    bump(reference, bounds, RACE);

    const shuffled = make();
    // A fixed shuffle: reversed, then rotated.
    const order = [...shuffled].reverse();
    order.push(...order.splice(0, 7));
    bump(order, bounds, RACE);

    for (const c of order) {
      const same = reference[c.slot] as Car;
      expect([c.x, c.y, c.speed]).toEqual([same.x, same.y, same.speed]);
    }
  });
});

describe('bins', () => {
  it('compares a pair once, in the same or a neighbouring tile', () => {
    const a = car(0, mid, mid);
    const b = car(1, mid + TILE, mid + TILE); // diagonal neighbour
    expect(bump([a, b], bounds, RACE)).toBe(2); // one pair, two passes
    expect(bump([car(0, mid, mid), car(1, mid + 100, mid)], bounds, RACE)).toBe(2);
  });

  it('never compares cars in tiles that are not neighbours', () => {
    const cars = [car(0, mid, mid), car(1, mid + 2 * TILE, mid), car(2, mid, mid - 2 * TILE)];
    expect(bump(cars, bounds, RACE)).toBe(0);
  });
});
