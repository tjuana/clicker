import { openestDirection } from './field';
import { randomBelow } from './random';

/**
 * Distance from every cell to the nearest obstacle — an occupied cell or the edge of the field.
 *
 * One breadth-first search seeded from every occupied cell at once, so the whole field costs
 * O(cells) however many trails there are; a search per trail would multiply that by the number
 * of players. The edge is folded in afterwards: the distance to it is plain arithmetic.
 */
export function clearance(field: Uint16Array, side: number): Int32Array {
  const cells = side * side;
  const distance = new Int32Array(cells).fill(-1);
  const queue = new Int32Array(cells);
  let head = 0;
  let tail = 0;

  for (let cell = 0; cell < cells; cell += 1) {
    if (field[cell] !== 0) {
      distance[cell] = 0;
      queue[tail] = cell;
      tail += 1;
    }
  }

  const reach = (neighbour: number, next: number): void => {
    if (distance[neighbour] !== -1) return;
    distance[neighbour] = next;
    queue[tail] = neighbour;
    tail += 1;
  };
  while (head < tail) {
    const cell = queue[head] ?? 0;
    head += 1;
    const x = cell % side;
    const next = (distance[cell] ?? 0) + 1;
    if (x + 1 < side) reach(cell + 1, next);
    if (x > 0) reach(cell - 1, next);
    if (cell + side < cells) reach(cell + side, next);
    if (cell >= side) reach(cell - side, next);
  }

  for (let cell = 0; cell < cells; cell += 1) {
    const x = cell % side;
    const y = (cell - x) / side;
    const toEdge = Math.min(x + 1, y + 1, side - x, side - y);
    const toTrail = distance[cell] ?? -1;
    distance[cell] = toTrail === -1 ? toEdge : Math.min(toTrail, toEdge);
  }
  return distance;
}

export interface Spot {
  x: number;
  y: number;
  dir: number;
}

/**
 * The free cell furthest from every obstacle, facing the longest open run. `null` when the field
 * has no free cell at all: the caller tries again next tick rather than spawning into a wall.
 */
export function pickSpawn(
  field: Uint16Array,
  side: number,
  seed: number,
): { spot: Spot | null; seed: number } {
  const distance = clearance(field, side);
  let best = 0;
  const candidates: number[] = [];
  for (let cell = 0; cell < distance.length; cell += 1) {
    const d = distance[cell] ?? 0;
    if (field[cell] !== 0 || d < best) continue;
    if (d > best) {
      best = d;
      candidates.length = 0;
    }
    candidates.push(cell);
  }
  if (best === 0) return { spot: null, seed };

  const drawn = randomBelow(seed, candidates.length);
  const cell = candidates[drawn.value] ?? 0;
  const x = cell % side;
  const y = (cell - x) / side;

  const dir = openestDirection(field, side, x, y);
  return { spot: { x, y, dir }, seed: drawn.seed };
}
