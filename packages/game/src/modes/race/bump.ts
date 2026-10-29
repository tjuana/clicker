import { binCars } from './bins';
import { closest, type Segment } from './capsule';
import type { Car } from './car';
import type { RaceConfig } from './config';
import { cos, ONE, sin } from './fixed';
import type { Track } from './track';

type Bounds = Track['bounds'];

// Away from zero, so a pair is never left short of `touching` by rounding: truncating lost up to
// a unit per car, and the second pass's small leftover truncated to nothing.
function outward(v: number): number {
  return v < 0 ? -Math.ceil(-v) : Math.ceil(v);
}

/**
 * One round of simultaneous pushes. Every push is worked out from the positions before any car
 * moves and then applied together, and a pair is always worked out from its lower slot, so the
 * answer does not depend on the order of `cars`. Cars are binned by tile; two cars close enough
 * to touch are never more than one tile apart, so only a bin and its eight neighbours are
 * compared (see `binCars`). A car is one capsule, its axis swept by the radius; a pair is one
 * segment test, and crossing axes, which give no direction, push along the line between centres.
 * Returns how many pairs of cars were compared.
 */
function pass(cars: Car[], bounds: Bounds, config: RaceConfig): number {
  const count = cars.length;
  const { width, height, bin, head, next } = binCars(cars, bounds);
  const px = new Int32Array(count);
  const py = new Int32Array(count);
  const pushX = new Int32Array(count);
  const pushY = new Int32Array(count);
  const limit = new Float64Array(count);
  const slot = new Int32Array(count);
  // Who each car overlapped this pass, as a bitmask over slots (see `Car.touch`).
  const touched = new Int32Array(count);
  const heading = new Int32Array(count);
  // The two ends of car i's axis: front at 2i, rear at 2i + 1. The body is that segment swept by
  // the radius, a capsule; two circles left a waist in the middle that a nose could enter.
  const endX = new Int32Array(2 * count);
  const endY = new Int32Array(2 * count);

  for (let i = 0; i < count; i += 1) {
    const car = cars[i] as Car;
    px[i] = car.x;
    py[i] = car.y;
    slot[i] = car.slot;
    heading[i] = car.heading;
    // Nobody is slowed by a car it is not behind.
    limit[i] = Number.MAX_SAFE_INTEGER;
    const ox = Math.trunc((config.reach * cos(car.heading)) / ONE);
    const oy = Math.trunc((config.reach * sin(car.heading)) / ONE);
    endX[2 * i] = car.x + ox;
    endY[2 * i] = car.y + oy;
    endX[2 * i + 1] = car.x - ox;
    endY[2 * i + 1] = car.y - oy;
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
    // Axes run from the rear end to the front end.
    const a: Segment = {
      x: endX[2 * i + 1] as number,
      y: endY[2 * i + 1] as number,
      dx: (endX[2 * i] as number) - (endX[2 * i + 1] as number),
      dy: (endY[2 * i] as number) - (endY[2 * i + 1] as number),
    };
    const b: Segment = {
      x: endX[2 * j + 1] as number,
      y: endY[2 * j + 1] as number,
      dx: (endX[2 * j] as number) - (endX[2 * j + 1] as number),
      dy: (endY[2 * j] as number) - (endY[2 * j + 1] as number),
    };
    const { s, t } = closest(a, b);
    let dx = b.x + b.dx * t - (a.x + a.dx * s);
    let dy = b.y + b.dy * t - (a.y + a.dy * s);
    let dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= touching) return;
    let need = touching - dist;
    if (dist < 1) {
      // The axes cross, so the closest points coincide and give no direction. Push along the
      // line between the centres (west if they coincide, deterministically), far enough that the
      // axes' shadows on that line are two radii apart.
      dx = (px[j] as number) - (px[i] as number);
      dy = (py[j] as number) - (py[i] as number);
      dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) {
        dx = 1;
        dy = 0;
        dist = 1;
      }
      const hA = Math.abs(a.dx * dx + a.dy * dy) / dist / 2;
      const hB = Math.abs(b.dx * dx + b.dy * dy) / dist / 2;
      need = hA + hB + touching - dist;
    }
    const share = need / (2 * dist);
    const sx = outward(dx * share);
    const sy = outward(dy * share);
    touched[i] = (touched[i] as number) | (1 << (slot[j] as number));
    touched[j] = (touched[j] as number) | (1 << (slot[i] as number));
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

  for (let i = 0; i < count; i += 1) {
    const car = cars[i] as Car;
    car.x = (px[i] as number) + (pushX[i] as number);
    car.y = (py[i] as number) + (pushY[i] as number);
    car.touch |= touched[i] as number;
    if (car.speed > 0) car.speed = Math.min(car.speed, Math.max(0, limit[i] as number));
  }
  return pairs;
}

/**
 * Separates overlapping cars and slows the one behind. Two passes, the second from the
 * positions the first left: a car pushed by several neighbours at once is otherwise still inside
 * one of them. Mutates the cars, which are the step's own copies; each car's `touch` is left as
 * the set of cars it overlapped in either pass.
 */
export function bump(cars: Car[], bounds: Bounds, config: RaceConfig): number {
  for (const car of cars) car.touch = 0;
  return pass(cars, bounds, config) + pass(cars, bounds, config);
}
