import { TRACKS } from '@clicker/game';
import { expect, it } from 'vitest';
import { buildTrack } from '../../../packages/game/src/modes/race/track';
import { CHASE, GROUND_Y, OVERVIEW } from '../src/client/scene/race-look';

// The canvas's depth buffer is 24-bit fixed point (measured on the real GPU, not assumed).
const DEPTH_BITS = 24;

// RTR 4.7.2: at view distance z, a perspective camera with near n and far f resolves depth in
// steps of about z^2 (f - n) / (f n 2^bits). Two surfaces closer than that fight (z-fight).
function depthStep(z: number): number {
  const { near, far } = OVERVIEW;
  return (z * z * (far - near)) / (far * near * 2 ** DEPTH_BITS);
}

it("the ground's offset clears the depth step at the farthest tile a camera sees, twice over", () => {
  const ring = TRACKS.ring;
  if (!ring) throw new Error('no ring track');
  const { width, height } = buildTrack(ring).bounds; // tiles
  const [ox, oy, oz] = OVERVIEW.offset;
  // Overview: stands over the rectangle's centre, so its farthest tile is a corner.
  const overview = Math.hypot(width / 2 + ox, oy, height / 2 + oz);
  // Chase: can be anywhere over the track, up to `behind` outside it; bound by the diagonal.
  const chase = Math.hypot(Math.hypot(width, height) + CHASE.behind, CHASE.above);
  const farthest = Math.max(overview, chase);
  expect(Math.abs(GROUND_Y)).toBeGreaterThanOrEqual(2 * depthStep(farthest));
});
