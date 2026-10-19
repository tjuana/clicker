import { describe, expect, it } from 'vitest';
import { sideFor } from '../src/modes/cycles/field';
import {
  copyTrail,
  dropOldest,
  emptyTrail,
  forEachCell,
  oldestCell,
  pushNewest,
} from '../src/modes/cycles/trail';
import { cyclesConfig } from './cycles-support';

function cells(trail: ReturnType<typeof emptyTrail>): number[] {
  const out: number[] = [];
  forEachCell(trail, (cell) => out.push(cell));
  return out;
}

describe('the trail ring', () => {
  it('keeps cells oldest first across the wrap of its buffer', () => {
    const trail = emptyTrail(3);
    for (const cell of [10, 11, 12]) pushNewest(trail, cell);
    dropOldest(trail);
    pushNewest(trail, 13);
    expect(cells(trail)).toEqual([11, 12, 13]);
    expect(oldestCell(trail)).toBe(11);
  });

  it('copies into a buffer of its own', () => {
    const trail = emptyTrail(3);
    pushNewest(trail, 5);
    const copy = copyTrail(trail);
    pushNewest(copy, 6);
    expect(cells(trail)).toEqual([5]);
  });
});

describe('the field size', () => {
  it('gives every participant the same share of cells', () => {
    const config = cyclesConfig();
    expect(sideFor(20, config)).toBe(128);
    expect(sideFor(1, config)).toBe(config.minSide);
    const share = (n: number) => sideFor(n, config) ** 2 / n;
    expect(Math.abs(share(20) - share(10)) / share(20)).toBeLessThan(0.02);
  });
});
