/**
 * Multisampling for the arena's composer target, by the screen's pixel density.
 * Measured on an M2 Pro at 1280x760, dpr 2, twenty riders, GPU median: 2 samples 5.05 ms,
 * 4 samples 6.39 ms, none 2.78 ms. The half-float target's samples were half the arena's GPU
 * time, and two keep most of that. On a dense screen a pixel is half a CSS pixel, so the
 * stair-step left without them is too fine to see at full size; the grid and the bikes' seams
 * are antialiased in their shaders and do not depend on this (RTR 5.4.2: multisampling's cost
 * is the storage of its samples).
 */
export function composerSamples(dpr: number): number {
  return dpr >= 2 ? 0 : 4;
}
