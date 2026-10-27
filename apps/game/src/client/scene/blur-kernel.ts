/**
 * The taps of a Gaussian blur along one axis: offsets in texels from the centre, ascending, and
 * the weight of each. A tap may sit between two texels, so that one bilinear read weighs both
 * (RTR 12.1).
 *
 * Exercise B of the arena by the book, written by the owner against
 * `test/scene-blur-kernel.test.ts`. It asks for weights that sum to 1, mirror each other, fall
 * off from the centre and come from taps at most two texels apart, and a variance within a tenth
 * of σ². That last one wants the kernel to reach out about 2.5σ: Figure 12.2's five taps pass at
 * σ = 1, but cut at 2σ for wider blurs they come out narrower than asked for.
 */
export interface Taps {
  offsets: Float32Array;
  weights: Float32Array;
}

export function gaussianTaps(sigma: number): Taps {
  throw new Error(`gaussianTaps(${sigma}): exercise B, RTR 12.1, is not written yet`);
}
