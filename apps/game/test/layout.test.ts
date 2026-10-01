import { describe, expect, it } from 'vitest';
import { distanceToFit, gridFor, slotFor } from '../src/client/scene/layout';

/** Roughly the formula car at its scene scale. */
const CAR = { length: 0.94, width: 0.43 };

describe('gridFor', () => {
  it('gives one lane to a lone player', () => {
    expect(gridFor(1, CAR).lanes).toBe(1);
  });

  it('gives a lane each while the field is small', () => {
    expect(gridFor(6, CAR).lanes).toBe(6);
  });

  it('stops widening once the cap is reached', () => {
    expect(gridFor(20, CAR, 10).lanes).toBe(10);
    expect(gridFor(50, CAR, 10).lanes).toBe(10);
  });

  it('survives an empty room without producing a zero-lane grid', () => {
    expect(gridFor(0, CAR).lanes).toBe(1);
  });

  it('spaces lanes and rows wider than the car itself', () => {
    const grid = gridFor(10, CAR);
    expect(grid.laneGap).toBeGreaterThan(CAR.width);
    expect(grid.rowGap).toBeGreaterThan(CAR.length);
  });
});

describe('slotFor', () => {
  const grid = gridFor(10, CAR);

  it('centres the field on the track', () => {
    const left = slotFor(0, grid).z;
    const right = slotFor(grid.lanes - 1, grid).z;
    expect(left).toBeCloseTo(-right);
  });

  it('keeps the front row level with its own score', () => {
    expect(slotFor(3, grid).back).toBe(0);
  });

  it('sets the next row back by a full row gap', () => {
    expect(slotFor(grid.lanes, grid).back).toBeCloseTo(grid.rowGap);
    expect(slotFor(grid.lanes * 2, grid).back).toBeCloseTo(grid.rowGap * 2);
  });

  it('never puts two players in the same place, however full the room', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 50; index += 1) {
      const slot = slotFor(index, grid);
      const key = `${slot.z.toFixed(3)}:${slot.back.toFixed(3)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('separates lane neighbours by more than the car is wide', () => {
    const gap = Math.abs(slotFor(1, grid).z - slotFor(0, grid).z);
    expect(gap).toBeGreaterThan(CAR.width);
  });

  it('separates players sharing a lane by more than the car is long', () => {
    const ahead = slotFor(0, grid);
    const behind = slotFor(grid.lanes, grid);
    expect(ahead.z).toBeCloseTo(behind.z);
    expect(behind.back - ahead.back).toBeGreaterThan(CAR.length);
  });
});

describe('distanceToFit', () => {
  it('matches the frustum it is derived from', () => {
    // At this distance the visible half-width must equal the field's half-width exactly.
    const lens = { fovDeg: 42, aspect: 1.5 };
    const field = { width: 6, length: 0 };

    const d = distanceToFit(field, lens, 0);
    const visibleHalfWidth = d * Math.tan((lens.fovDeg * Math.PI) / 360) * lens.aspect;

    expect(visibleHalfWidth).toBeCloseTo(field.width / 2);
  });

  it('pulls back further for a wider field', () => {
    const lens = { fovDeg: 42, aspect: 1.5 };
    const near = distanceToFit({ width: 4, length: 0 }, lens, 0);
    const far = distanceToFit({ width: 12, length: 0 }, lens, 0);
    expect(far).toBeGreaterThan(near);
  });

  it('pulls back further for a longer field', () => {
    const lens = { fovDeg: 42, aspect: 1.5 };
    const near = distanceToFit({ width: 0, length: 4 }, lens, 0);
    const far = distanceToFit({ width: 0, length: 20 }, lens, 0);
    expect(far).toBeGreaterThan(near);
  });

  it('needs less room on a wider viewport', () => {
    const field = { width: 6, length: 0 };
    const narrow = distanceToFit(field, { fovDeg: 42, aspect: 0.6 }, 0);
    const wide = distanceToFit(field, { fovDeg: 42, aspect: 2 }, 0);
    expect(wide).toBeLessThan(narrow);
  });

  it('never comes closer than the floor it is given', () => {
    expect(distanceToFit({ width: 0, length: 0 }, { fovDeg: 42, aspect: 1.5 }, 6)).toBe(6);
  });
});
