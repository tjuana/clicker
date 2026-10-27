import type { CarInfo } from './model';

/** The slot whose car carries a public id, or -1. `info` changes only with a full. */
export function slotOfId(info: ReadonlyMap<number, CarInfo>, id: string | null): number {
  if (id === null) return -1;
  for (const [slot, car] of info) if (car.id === id) return slot;
  return -1;
}

/** 1-based place of a slot in the order of the race, or 0 when it is not on the field. */
export function placeOf(order: readonly number[], slot: number): number {
  return order.indexOf(slot) + 1;
}

/** `m:ss.t` from ticks; a tick is `tickMs` long. Null (no time yet) reads as nothing. */
export function formatTicks(ticks: number | null, tickMs: number): string {
  if (ticks === null || ticks < 0) return '';
  const tenths = Math.floor((ticks * tickMs) / 100);
  const seconds = Math.floor(tenths / 10);
  const m = Math.floor(seconds / 60);
  return `${m}:${String(seconds % 60).padStart(2, '0')}.${tenths % 10}`;
}

/**
 * The lap being driven, 1…laps. The rules count crossings of the line: 0 on the grid, 1 on the
 * first lap, more than `laps` when the car is done.
 */
export function lapShown(lap: number, laps: number): number {
  return Math.min(laps, Math.max(1, lap));
}

/**
 * The best lap after a car crossed the line at `tick` to start lap `lap`, given the tick its
 * previous lap began on. A lap cut short has no start (-1) and so no time, and the first crossing
 * ends no lap at all.
 */
export function bestAfterLap(
  best: number | null,
  lapStart: number,
  tick: number,
  lap: number,
): number | null {
  if (lap < 2 || lapStart < 0) return best;
  const time = tick - lapStart;
  return best === null || time < best ? time : best;
}
