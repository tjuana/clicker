import type { Car } from './car';
import { TILE } from './fixed';
import type { Track } from './track';

export interface Bins {
  width: number;
  height: number;
  /** The bin of each car, as `y × width + x` inside the track's bounding box. */
  bin: Int32Array;
  /** The first car in each bin, or -1; `next` chains the rest. */
  head: Int32Array;
  next: Int32Array;
}

/**
 * Cars binned by the tile they stand in. Two cars close enough to touch, or to matter to a
 * bot, are never more than a tile apart, so a car and the eight bins round it see them all.
 * The bins are an array over the track's bounding box, which is small and bounded: indexing it
 * needs no hash.
 */
export function binCars(cars: Car[], bounds: Track['bounds']): Bins {
  const { width, height } = bounds;
  const bin = new Int32Array(cars.length);
  const head = new Int32Array(width * height).fill(-1);
  const next = new Int32Array(cars.length);
  for (let i = 0; i < cars.length; i += 1) {
    const car = cars[i] as Car;
    // A car can only be nudged past the box by a hair; the edge bin is then the right one.
    const bx = Math.min(width - 1, Math.max(0, Math.floor(car.x / TILE) - bounds.x));
    const by = Math.min(height - 1, Math.max(0, Math.floor(car.y / TILE) - bounds.y));
    bin[i] = by * width + bx;
    next[i] = head[bin[i] as number] as number;
    head[bin[i] as number] = i;
  }
  return { width, height, bin, head, next };
}
