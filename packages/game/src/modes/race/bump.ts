import type { Car } from './car';
import type { RaceConfig } from './config';
import { cos, ONE, sin, TILE } from './fixed';
import type { Track } from './track';

type Bounds = Track['bounds'];

/**
 * One round of simultaneous pushes. Every push is worked out from the positions before any car
 * moves and then applied together, and a pair is always worked out from its lower slot, so the
 * answer does not depend on the order of `cars`. Cars are binned by tile; two cars close enough
 * to touch are never more than one tile apart, so only a bin and its eight neighbours are
 * compared. The bins are an array over the track's bounding box, which is small and bounded:
 * indexing it needs no hash.
 * Returns how many pairs of cars were compared.
 */
function pass(cars: Car[], bounds: Bounds, config: RaceConfig): number {
  const count = cars.length;
  const { width, height } = bounds;
  const px = new Int32Array(count);
  const py = new Int32Array(count);
  const pushX = new Int32Array(count);
  const pushY = new Int32Array(count);
  const limit = new Float64Array(count);
  const slot = new Int32Array(count);
  const heading = new Int32Array(count);
  // The two circles of car i: front at 2i, rear at 2i + 1.
  const circleX = new Int32Array(2 * count);
  const circleY = new Int32Array(2 * count);
  const bin = new Int32Array(count);
  const head = new Int32Array(width * height).fill(-1);
  const next = new Int32Array(count);

  for (let i = 0; i < count; i += 1) {
    const car = cars[i] as Car;
    px[i] = car.x;
    py[i] = car.y;
    slot[i] = car.slot;
    heading[i] = car.heading;
    // A car can only be nudged past the box by a hair; the edge bin is then the right one.
    const bx = Math.min(width - 1, Math.max(0, Math.floor(car.x / TILE) - bounds.x));
    const by = Math.min(height - 1, Math.max(0, Math.floor(car.y / TILE) - bounds.y));
    bin[i] = by * width + bx;
    next[i] = head[bin[i] as number] as number;
    head[bin[i] as number] = i;
    // Nobody is slowed by a car it is not behind.
    limit[i] = Number.MAX_SAFE_INTEGER;
    const ox = Math.trunc((config.reach * cos(car.heading)) / ONE);
    const oy = Math.trunc((config.reach * sin(car.heading)) / ONE);
    circleX[2 * i] = car.x + ox;
    circleY[2 * i] = car.y + oy;
    circleX[2 * i + 1] = car.x - ox;
    circleY[2 * i + 1] = car.y - oy;
  }

  const touching = 2 * config.radius;
  let pairs = 0;
  for (let i = 0; i < count; i += 1) {
    const bx = (bin[i] as number) % width;
    const by = Math.floor((bin[i] as number) / width);
    for (let ny = Math.max(0, by - 1); ny <= Math.min(height - 1, by + 1); ny += 1) {
      for (let nx = Math.max(0, bx - 1); nx <= Math.min(width - 1, bx + 1); nx += 1) {
        for (let j = head[ny * width + nx] as number; j >= 0; j = next[j] as number) {
          if ((slot[j] as number) <= (slot[i] as number)) continue;
          pairs += 1;
          compare(i, j);
        }
      }
    }
  }

  function compare(i: number, j: number): void {
    for (let a = 2 * i; a < 2 * i + 2; a += 1) {
      for (let b = 2 * j; b < 2 * j + 2; b += 1) {
        let dx = (circleX[b] as number) - (circleX[a] as number);
        const dy = (circleY[b] as number) - (circleY[a] as number);
        let dist = Math.round(Math.sqrt(dx * dx + dy * dy));
        if (dist >= touching) continue;
        if (dist === 0) {
          // Exactly on top of each other: the lower slot is pushed west, deterministically.
          dx = 1;
          dist = 1;
        }
        const share = (touching - dist) / (2 * dist);
        const sx = Math.trunc(dx * share);
        const sy = Math.trunc(dy * share);
        pushX[i] = (pushX[i] as number) - sx;
        pushY[i] = (pushY[i] as number) - sy;
        pushX[j] = (pushX[j] as number) + sx;
        pushY[j] = (pushY[j] as number) + sy;
        // The car whose nose points at the other is the one behind; it can go no faster than
        // the one in front. The cap is that car's own speed, not a fraction of it: a factor
        // compounds down a queue and slows the whole train to a crawl.
        const iAim = (cos(heading[i] as number) * dx + sin(heading[i] as number) * dy) / dist;
        const jAim = -(cos(heading[j] as number) * dx + sin(heading[j] as number) * dy) / dist;
        if (iAim > config.aim) limit[i] = Math.min(limit[i] as number, (cars[j] as Car).speed);
        if (jAim > config.aim) limit[j] = Math.min(limit[j] as number, (cars[i] as Car).speed);
      }
    }
  }

  for (let i = 0; i < count; i += 1) {
    const car = cars[i] as Car;
    car.x = (px[i] as number) + (pushX[i] as number);
    car.y = (py[i] as number) + (pushY[i] as number);
    if (car.speed > 0) car.speed = Math.min(car.speed, Math.max(0, limit[i] as number));
  }
  return pairs;
}

/**
 * Separates overlapping cars and slows the one behind. Two passes, the second from the
 * positions the first left: a car pushed by several neighbours at once is otherwise still inside
 * one of them. Mutates the cars, which are the step's own copies.
 */
export function bump(cars: Car[], bounds: Bounds, config: RaceConfig): number {
  return pass(cars, bounds, config) + pass(cars, bounds, config);
}
