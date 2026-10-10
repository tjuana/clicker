import type { Trail } from './state';

export function emptyTrail(capacity: number): Trail {
  return { cells: new Int32Array(capacity), start: 0, size: 0 };
}

/** A copy the caller may write to: the step owns its copy, the previous state stays untouched. */
export function copyTrail(trail: Trail): Trail {
  return { cells: trail.cells.slice(), start: trail.start, size: trail.size };
}

export function oldestCell(trail: Trail): number {
  return trail.size === 0 ? -1 : (trail.cells[trail.start] ?? -1);
}

/** Drops the oldest cell of a trail the caller owns. O(1): the ring only moves its start. */
export function dropOldest(trail: Trail): void {
  if (trail.size === 0) return;
  trail.start = (trail.start + 1) % trail.cells.length;
  trail.size -= 1;
}

/** Appends the newest cell of a trail the caller owns. */
export function pushNewest(trail: Trail, cell: number): void {
  trail.cells[(trail.start + trail.size) % trail.cells.length] = cell;
  trail.size += 1;
}

export function forEachCell(trail: Trail, visit: (cell: number) => void): void {
  for (let offset = 0; offset < trail.size; offset += 1) {
    visit(trail.cells[(trail.start + offset) % trail.cells.length] ?? -1);
  }
}
