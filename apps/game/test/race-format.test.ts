import { describe, expect, it } from 'vitest';
import {
  bestAfterEvents,
  formatTicks,
  lapShown,
  placeOf,
  slotOfId,
} from '../src/client/race/format';

describe('race HUD arithmetic', () => {
  it('reads the place off the order, from one, and 0 when the car is not on the field', () => {
    expect(placeOf([4, 2, 7], 4)).toBe(1);
    expect(placeOf([4, 2, 7], 7)).toBe(3);
    expect(placeOf([4, 2, 7], 9)).toBe(0);
  });

  it('turns ticks into minutes, seconds and tenths with the tick length given', () => {
    expect(formatTicks(0, 50)).toBe('0:00.0');
    expect(formatTicks(25, 50)).toBe('0:01.2');
    expect(formatTicks(1200, 50)).toBe('1:00.0');
    expect(formatTicks(1599, 50)).toBe('1:19.9');
    expect(formatTicks(null, 50)).toBe('');
  });

  it('shows the lap being driven, never past the last or before the first', () => {
    expect(lapShown(0, 3)).toBe(1);
    expect(lapShown(2, 3)).toBe(2);
    expect(lapShown(4, 3)).toBe(3);
  });

  it('takes the best lap from the latest lap event of the own slot, as the rules reported it', () => {
    const lap = (slot: number, best: number | null) => ({
      type: 'lap',
      slot,
      lap: 2,
      time: 900,
      best,
    });
    expect(bestAfterEvents(null, [lap(1, null)], 1)).toBeNull();
    expect(bestAfterEvents(null, [lap(1, 800)], 1)).toBe(800);
    // The figure on the wire is the rules' own: the client does not take a minimum of its own.
    expect(bestAfterEvents(800, [lap(1, 650)], 1)).toBe(650);
    expect(bestAfterEvents(800, [lap(1, 700), lap(1, 650)], 1)).toBe(650);
    expect(bestAfterEvents(800, [lap(2, 100), { type: 'bump', slot: 1 }], 1)).toBe(800);
  });

  it('finds the slot of a public id', () => {
    const info = new Map([
      [0, { id: 'a', bot: false, finish: null, best: null, lapStart: 0 }],
      [3, { id: 'b', bot: true, finish: null, best: null, lapStart: 0 }],
    ]);
    expect(slotOfId(info, 'b')).toBe(3);
    expect(slotOfId(info, 'z')).toBe(-1);
    expect(slotOfId(info, null)).toBe(-1);
  });
});
