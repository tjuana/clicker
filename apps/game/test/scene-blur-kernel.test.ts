import { describe, expect, it } from 'vitest';
import { gaussianTaps } from '../src/client/scene/blur-kernel';

/** From a hair to a wide smear, in texels. */
const SIGMAS = [1, 1.5, 2, 3, 5, 8, 13];

/**
 * Every tap spread onto the two texels a bilinear read blends: the kernel the GPU actually sums.
 * A tap on a whole texel stays on it.
 */
function texels(sigma: number): Map<number, number> {
  const { offsets, weights } = gaussianTaps(sigma);
  const kernel = new Map<number, number>();
  const add = (texel: number, weight: number): void => {
    kernel.set(texel, (kernel.get(texel) ?? 0) + weight);
  };
  offsets.forEach((offset, i) => {
    const weight = weights[i] as number;
    const low = Math.floor(offset);
    const f = offset - low;
    add(low, weight * (1 - f));
    if (f > 0) add(low + 1, weight * f);
  });
  return kernel;
}

// Exercise B of the arena by the book (docs/superpowers/specs/2026-10-27-arena-by-the-book-design.md,
// §3 B). Each test names a way a blur kernel goes wrong; all six were first seen failing against
// a stub that threw.
describe('the floor blur kernel', () => {
  it('neither brightens nor darkens what it blurs', () => {
    for (const sigma of SIGMAS) {
      const { weights } = gaussianTaps(sigma);
      expect(weights.reduce((sum, w) => sum + w, 0)).toBeCloseTo(1, 5);
    }
  });

  it('does not slide the reflection sideways', () => {
    for (const sigma of SIGMAS) {
      const { offsets, weights } = gaussianTaps(sigma);
      const n = offsets.length;
      for (let i = 0; i < n; i += 1) {
        expect(offsets[i]).toBeCloseTo(-(offsets[n - 1 - i] as number), 5);
        expect(weights[i]).toBeCloseTo(weights[n - 1 - i] as number, 5);
      }
    }
  });

  // drei's blur left gaps between its taps wider than anything in the picture, and the floor
  // showed a row of copies of every bike; the prototype's three-texel steps showed as bands.
  it('leaves no gap between taps for copies to show through', () => {
    for (const sigma of SIGMAS) {
      const { offsets } = gaussianTaps(sigma);
      for (let i = 1; i < offsets.length; i += 1) {
        const gap = (offsets[i] as number) - (offsets[i - 1] as number);
        expect(gap).toBeGreaterThan(0);
        expect(gap).toBeLessThanOrEqual(2);
      }
    }
  });

  // Within a tenth: a sound kernel sampled per texel, integrated over each texel or cut at 2.5σ
  // lands inside, and so does three's own bloom blur. A bilinear fraction swapped or dropped lands
  // far outside, and so does a cut at 2σ — Figure 12.2's five taps, carried past σ = 1 — as a
  // blur narrower than the one asked for.
  it('is the Gaussian it was asked for', () => {
    for (const sigma of SIGMAS) {
      let variance = 0;
      for (const [texel, weight] of texels(sigma)) variance += weight * texel * texel;
      expect(variance / (sigma * sigma)).toBeGreaterThan(0.9);
      expect(variance / (sigma * sigma)).toBeLessThan(1.1);
    }
  });

  // Two copies at the right distance keep the variance, and zero-weight taps between them close
  // every gap: what a double image or a comb cannot do is fall off steadily from the centre.
  it('falls off from the centre, so nothing is printed twice', () => {
    for (const sigma of SIGMAS) {
      const kernel = texels(sigma);
      const reach = Math.max(...[...kernel.keys()].map(Math.abs));
      for (let texel = 1; texel <= reach; texel += 1) {
        for (const side of [1, -1]) {
          const inner = kernel.get(side * (texel - 1)) ?? 0;
          const outer = kernel.get(side * texel) ?? 0;
          expect(outer).toBeLessThanOrEqual(inner + 1e-6);
        }
      }
    }
  });

  // RTR 12.1: a separable filter reads 2d texels where a square one reads d². Ten times wider
  // costs about ten times the reads; a hundred would mean a square kernel in disguise.
  it('reads the texture a number of times that grows with the width, not its square', () => {
    const ratio = gaussianTaps(20).offsets.length / gaussianTaps(2).offsets.length;
    expect(ratio).toBeGreaterThan(4);
    expect(ratio).toBeLessThan(20);
  });
});
