import { TILE } from '@clicker/game';
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

/** A distance in units of the rules as tiles of the track, to a tenth. */
export function formatTiles(units: number): string {
  return (units / TILE).toFixed(1);
}

/**
 * The lap being driven, 1…laps. The rules count crossings of the line: 0 on the grid, 1 on the
 * first lap, more than `laps` when the car is done.
 */
export function lapShown(lap: number, laps: number): number {
  return Math.min(laps, Math.max(1, lap));
}

/**
 * The best lap after a tick's events. The lap event carries the best the rules hold for the car,
 * so the latest one for this slot is the answer; a tick without one changes nothing.
 */
export function bestAfterEvents(
  best: number | null,
  events: readonly { type: string; slot: number; best?: number | null }[],
  slot: number,
): number | null {
  let result = best;
  for (const event of events) {
    if (event.type === 'lap' && event.slot === slot) result = event.best ?? null;
  }
  return result;
}
