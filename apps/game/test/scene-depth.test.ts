import { TRACKS } from '@clicker/game';
import type { Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { expect, it } from 'vitest';
import corner2 from '../public/race/roadCornerLarge.glb?inline';
import corner3 from '../public/race/roadCornerLarger.glb?inline';
import corner1 from '../public/race/roadCornerSmall.glb?inline';
import straight from '../public/race/roadStraight.glb?inline';
import { CHASE, GROUND_Y, OVERVIEW } from '../src/client/scene/race-look';
import { bake, bounds, type ModelName, placements, walk } from '../src/client/scene/ring-track';

// The depth buffer the scene models: 24 bits. gl.DEPTH_BITS reports 24, but that is only the
// format Chrome asked for; on the M2, ANGLE's Metal appears to store float32 (a probe showed
// reversed depth removing fighting that standard depth had at an offset of 1e-4, which a 24-bit
// unorm buffer could not do). Near depth 1 a float32 step is also 2^-24, so the formula holds for
// standard depth either way. WebGL guarantees only 16 bits; desktop Chrome requests 24.
const DEPTH_BITS = 24;

// RTR 4.7.2: at view distance z, a perspective camera with near n and far f resolves depth in
// steps of about z^2 (f - n) / (f n 2^bits). Two surfaces closer than that fight (z-fight).
function depthStep(z: number): number {
  const { near, far } = OVERVIEW;
  return (z * z * (far - near)) / (far * near * 2 ** DEPTH_BITS);
}

async function load(url: string): Promise<Object3D> {
  const bytes = Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0));
  return (await new GLTFLoader().parseAsync(bytes.buffer, '')).scene;
}

const models = {
  straight: await load(straight),
  corner1: await load(corner1),
  corner2: await load(corner2),
  corner3: await load(corner3),
} satisfies Record<ModelName, Object3D>;

it("the ground sits below the tiles' grass by twice the depth step at the farthest tile a camera sees", () => {
  const ring = TRACKS.ring;
  if (!ring) throw new Error('no ring track');
  const pieces = walk(ring);

  // The lowest grass vertex of the baked ring, as the scene draws it (TILE_LIFT included): the
  // gap to the ground is smallest there. Signed, so a ground above the grass fails too.
  const position = bake(models, placements(pieces)).grass.getAttribute('position');
  let grassY = Number.POSITIVE_INFINITY;
  for (let i = 0; i < position.count; i++) grassY = Math.min(grassY, position.getY(i));

  // The overview's rectangle is the client's own bounds; it stands at its centre plus the offset.
  const box = bounds(pieces);
  const centre = box.getCenter(box.min.clone());
  const [ox, oy, oz] = OVERVIEW.offset;
  let overview = 0;
  for (const x of [box.min.x, box.max.x]) {
    for (const z of [box.min.z, box.max.z]) {
      overview = Math.max(overview, Math.hypot(x - (centre.x + ox), oy, z - (centre.z + oz)));
    }
  }
  // Chase: can be anywhere over the track, up to `behind` outside it; bound by the diagonal.
  const diagonal = Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z);
  const chase = Math.hypot(diagonal + CHASE.behind, CHASE.above);
  const farthest = Math.max(overview, chase);

  expect(grassY - GROUND_Y).toBeGreaterThanOrEqual(2 * depthStep(farthest));
});
