/**
 * The taps of a Gaussian blur along one axis: offsets in texels from the centre, ascending, and
 * the weight of each. A tap may sit between two texels, so that one bilinear read weighs both
 * (RTR 12.1).
 *
 * Exercise B of the arena by the book, written by the owner against
 * `test/scene-blur-kernel.test.ts`.
 */
export interface Taps {
  offsets: Float32Array;
  weights: Float32Array;
}

export function gaussianTaps(sigma: number): Taps {
  throw new Error(`gaussianTaps(${sigma}): exercise B, RTR 12.1, is not written yet`);
}
