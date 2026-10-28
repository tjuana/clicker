import { describe, expect, it } from 'vitest';
import {
  BIKE_LEVEL,
  BLOOM,
  CYCLE_BODY,
  CYCLE_GLOW,
  CYCLE_SEAM,
  CYCLE_STRIPE,
  CYCLE_SURFACE_MAX,
  DIM_LEVEL,
  SLOT_COLOURS,
} from '../src/client/scene/look';

/** The brightest channel any slot colour has: bloom keys on the brightest channel. */
const BRIGHTEST_CHANNEL = Math.max(...SLOT_COLOURS.map((c) => Math.max(c.r, c.g, c.b)));

describe('the bikes and the bloom threshold', () => {
  it('a bike that is not laying its wall never blooms, whatever the surface does', () => {
    expect(CYCLE_SURFACE_MAX * DIM_LEVEL * BRIGHTEST_CHANNEL).toBeLessThan(BLOOM.threshold);
  });

  it('a lit bike blooms at its rims, seams and stripe but not on the flat of its body', () => {
    for (const level of [CYCLE_GLOW, CYCLE_SEAM, CYCLE_STRIPE]) {
      expect(level * BIKE_LEVEL * BRIGHTEST_CHANNEL).toBeGreaterThan(BLOOM.threshold);
    }
    expect(CYCLE_BODY * BIKE_LEVEL * BRIGHTEST_CHANNEL).toBeLessThan(BLOOM.threshold);
  });
});
