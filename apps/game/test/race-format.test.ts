import { describe, expect, it } from 'vitest';
import { bestAfterLap, formatTicks, lapShown, placeOf, slotOfId } from '../src/client/race/format';

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

  it('improves the best lap on a crossing, but not on the first or a cut-short lap', () => {
    expect(bestAfterLap(null, 0, 900, 1)).toBeNull();
    expect(bestAfterLap(null, 100, 900, 2)).toBe(800);
    expect(bestAfterLap(800, 900, 1800, 3)).toBe(800);
    expect(bestAfterLap(800, 900, 1600, 3)).toBe(700);
    expect(bestAfterLap(800, -1, 1600, 3)).toBe(800);
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
