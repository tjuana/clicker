import { ColorManagement, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  BIKE_LEVEL,
  BLOOM,
  CYCLE_BODY,
  CYCLE_GLOW,
  CYCLE_RIM,
  CYCLE_STRIPE,
  CYCLE_SURFACE_MAX,
  DIM_LEVEL,
  SLOT_COLOURS,
} from '../src/client/scene/look';

/**
 * Three's bloom keys on luminance (LuminosityHighPassShader: luminance(texel.xyz)), the linear
 * Rec. 709 weights, not on the brightest channel: a saturated blue is 0xff in one channel and still
 * dim. The same coefficients three uses, applied to the same linear working-space colours.
 */
const WEIGHTS = ColorManagement.getLuminanceCoefficients(new Vector3());
const luminances = SLOT_COLOURS.map((c) => c.r * WEIGHTS.x + c.g * WEIGHTS.y + c.b * WEIGHTS.z);
const BRIGHTEST = Math.max(...luminances);

describe('the bikes and the bloom threshold', () => {
  it('a bike that is not laying its wall never blooms, whatever the surface does', () => {
    for (const lum of luminances) {
      expect(CYCLE_SURFACE_MAX * DIM_LEVEL * lum).toBeLessThan(BLOOM.threshold);
    }
  });

  it('a bike body never blooms, lit or not, even at a grazing edge', () => {
    for (const lum of luminances) {
      expect((CYCLE_BODY + CYCLE_RIM) * BIKE_LEVEL * lum).toBeLessThan(BLOOM.threshold);
    }
  });

  it('a lit bike glows at all: the rims and stripe of the brightest slot bloom', () => {
    for (const level of [CYCLE_GLOW, CYCLE_STRIPE]) {
      expect(level * BIKE_LEVEL * BRIGHTEST).toBeGreaterThan(BLOOM.threshold);
    }
  });
});
