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
  SLOT_GLOW,
} from '../src/client/scene/look';

/**
 * Three's bloom keys on luminance (LuminosityHighPassShader: luminance(texel.xyz)), the linear
 * Rec. 709 weights, not on the brightest channel: a saturated blue is 0xff in one channel and still
 * dim. The same coefficients three uses, applied to the same linear working-space colours.
 */
const WEIGHTS = ColorManagement.getLuminanceCoefficients(new Vector3());
const luminances = SLOT_GLOW.map((c) => c.r * WEIGHTS.x + c.g * WEIGHTS.y + c.b * WEIGHTS.z);

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

  it("every slot's lit rims and stripe bloom", () => {
    // Not the brightest slot only: with raw colours half the palette (every blue, violet, magenta
    // and red) stayed under the threshold and those bikes looked switched off.
    for (const lum of luminances) {
      for (const level of [CYCLE_GLOW, CYCLE_STRIPE]) {
        expect(level * BIKE_LEVEL * lum).toBeGreaterThan(BLOOM.threshold);
      }
    }
  });

  it('every slot glows equally bright', () => {
    for (const lum of luminances) expect(lum).toBeCloseTo(luminances[0] as number, 6);
  });
});
