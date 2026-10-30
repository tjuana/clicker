import { ColorManagement, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  BIKE_COLOURS,
  BLOOM,
  CYCLE_BODY,
  CYCLE_GLOW,
  CYCLE_RIM,
  CYCLE_STRIPE,
  CYCLE_SURFACE_MAX,
  DIM_COLOURS,
  PULSE,
  RIM,
  WALL_COLOURS,
} from '../src/client/scene/look';

/**
 * Three's bloom keys on luminance (LuminosityHighPassShader: luminance(texel.xyz)), the linear
 * Rec. 709 weights, not on the brightest channel: a saturated blue is 0xff in one channel and still
 * dim. The same coefficients three uses, applied to the colours the meshes are actually painted in
 * (levels included), so a table built from the wrong colours fails here.
 */
const WEIGHTS = ColorManagement.getLuminanceCoefficients(new Vector3());
const luminance = (c: { r: number; g: number; b: number }) =>
  c.r * WEIGHTS.x + c.g * WEIGHTS.y + c.b * WEIGHTS.z;
const lit = BIKE_COLOURS.map(luminance);
const dim = DIM_COLOURS.map(luminance);
const wall = WALL_COLOURS.map(luminance);

describe('the bikes and the bloom threshold', () => {
  it('a bike that is not laying its wall never blooms, whatever the surface does', () => {
    for (const lum of dim) expect(CYCLE_SURFACE_MAX * lum).toBeLessThan(BLOOM.threshold);
  });

  it('a bike body never blooms, lit or not, even at a grazing edge', () => {
    for (const lum of lit) expect((CYCLE_BODY + CYCLE_RIM) * lum).toBeLessThan(BLOOM.threshold);
  });

  it("every slot's lit rims and stripe bloom", () => {
    // Not the brightest slot only: with raw colours half the palette (every blue, violet, magenta
    // and red) stayed under the threshold and those bikes looked switched off.
    for (const lum of lit) {
      for (const level of [CYCLE_GLOW, CYCLE_STRIPE]) {
        expect(level * lum).toBeGreaterThan(BLOOM.threshold);
      }
    }
  });

  it('every slot glows equally bright, lit, unlit and as a wall', () => {
    // The walls' raw colours pass the bloom ceiling above (0.59 against 0.6), so this is the test
    // that sees a table built from the wrong colours.
    for (const table of [lit, dim, wall]) {
      for (const lum of table) expect(lum).toBeCloseTo(table[0] as number, 6);
    }
  });
});

describe('the walls and the bloom threshold', () => {
  it("every slot's wall body stays dark, even at the rim and the pulse's crest", () => {
    for (const lum of wall) expect(lum * (1 + RIM + PULSE)).toBeLessThan(BLOOM.threshold);
  });
});
