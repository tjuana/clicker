import type { CyclesConfig } from './config';
import { DX, DY } from './state';

/** k·√n, so each participant gets k² cells. `Math.sqrt` is exactly rounded by IEEE 754. */
export function sideFor(participants: number, config: CyclesConfig): number {
  return Math.max(config.minSide, Math.round(config.sidePerRootPlayer * Math.sqrt(participants)));
}

/** Free cells straight ahead of (x, y) in `dir`, counting up to `limit`. */
export function freeRun(
  field: Uint16Array,
  side: number,
  x: number,
  y: number,
  dir: number,
  limit: number,
): number {
  const dx = DX[dir as 0] ?? 0;
  const dy = DY[dir as 0] ?? 0;
  let run = 0;
  let cx = x + dx;
  let cy = y + dy;
  while (
    run < limit &&
    cx >= 0 &&
    cy >= 0 &&
    cx < side &&
    cy < side &&
    field[cy * side + cx] === 0
  ) {
    run += 1;
    cx += dx;
    cy += dy;
  }
  return run;
}

/** The direction with the longest free run from (x, y); a tie goes to the lowest direction. */
export function openestDirection(field: Uint16Array, side: number, x: number, y: number): number {
  let dir = 0;
  let longest = -1;
  for (let candidate = 0; candidate < 4; candidate += 1) {
    const run = freeRun(field, side, x, y, candidate, side);
    if (run > longest) {
      longest = run;
      dir = candidate;
    }
  }
  return dir;
}
