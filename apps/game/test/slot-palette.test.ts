import { describe, expect, it } from 'vitest';
import { SLOT_HEX } from '../src/client/slots';

type Lab = [number, number, number];

/** sRGB hex to OKLab, with Björn Ottosson's matrices: a distance in it tracks what an eye sees. */
function oklab(hex: string): Lab {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

describe('the slot palette', () => {
  it('no two slots are closer than ΔE 0.09 in OKLab', () => {
    const labs = SLOT_HEX.map(oklab);
    for (let a = 0; a < labs.length; a++) {
      for (let b = a + 1; b < labs.length; b++) {
        const [p, q] = [labs[a], labs[b]] as [Lab, Lab];
        const distance = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        expect(distance, `${SLOT_HEX[a]} and ${SLOT_HEX[b]}`).toBeGreaterThanOrEqual(0.09);
      }
    }
  });
});
