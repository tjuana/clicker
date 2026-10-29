/**
 * The taps of a Gaussian blur along one axis: offsets in texels from the centre, ascending, and
 * the weight of each. A tap may sit between two texels, so that one bilinear read weighs both
 * (RTR 12.1).
 *
 * The Gaussian is sampled at whole texels out to R = ceil(3 sigma), where it has fallen to a
 * hundredth, and normalised to sum 1. Outwards from the centre, texels are merged in pairs
 * (1,2), (3,4), ...: one read at the weighted mean position, with the summed weight, gives the
 * bilinear filter exactly the two weights it was to blend. That is half the reads of the plain
 * kernel for the identical picture. A last texel with no partner keeps a tap of its own.
 */
export interface Taps {
  offsets: Float32Array;
  weights: Float32Array;
}

export function gaussianTaps(sigma: number): Taps {
  const reach = Math.ceil(3 * sigma);
  const w = new Float64Array(reach + 1);
  let total = 0;
  for (let k = 0; k <= reach; k += 1) {
    const weight = Math.exp((-k * k) / (2 * sigma * sigma));
    w[k] = weight;
    total += k === 0 ? weight : 2 * weight;
  }
  const pairs = Math.ceil(reach / 2);
  const n = 2 * pairs + 1;
  const offsets = new Float32Array(n);
  const weights = new Float32Array(n);
  weights[pairs] = (w[0] as number) / total;
  for (let p = 0; p < pairs; p += 1) {
    const k = 2 * p + 1;
    const a = w[k] as number;
    const b = k + 1 <= reach ? (w[k + 1] as number) : 0;
    const weight = (a + b) / total;
    const offset = (k * a + (k + 1) * b) / (a + b);
    offsets[pairs + 1 + p] = offset;
    weights[pairs + 1 + p] = weight;
    offsets[pairs - 1 - p] = -offset;
    weights[pairs - 1 - p] = weight;
  }
  return { offsets, weights };
}
