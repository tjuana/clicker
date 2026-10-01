/**
 * Where the cars stand and how far the camera has to be. Pure arithmetic: no React, no three,
 * nothing to render. It lives apart from the scene because it is the part that can be reasoned
 * about and tested, and because hand-tuned constants buried in JSX are how the field ended up
 * overlapping three times in a row.
 *
 * Every distance is derived from the car's own measured size, so swapping the model changes the
 * layout automatically instead of silently invalidating a pile of numbers.
 */

export interface CarSize {
  /** Along the track. */
  length: number;
  /** Across the track. */
  width: number;
}

export interface Grid {
  lanes: number;
  /** Centre-to-centre distance between neighbouring lanes. */
  laneGap: number;
  /** How far back each successive row starts. */
  rowGap: number;
  /** Total width occupied by the lanes. */
  width: number;
}

/** Cars keep a fifth of their own size as clear air; touching bodies read as a single blob. */
const CLEARANCE = 1.2;

/**
 * Lanes are capped because a lane per player becomes a stadium: at some point the field is
 * either off-frame or so distant that nobody can be told apart.
 */
export function gridFor(count: number, car: CarSize, maxLanes = 10): Grid {
  const lanes = Math.max(1, Math.min(Math.max(0, Math.trunc(count)), maxLanes));
  const laneGap = car.width * CLEARANCE;
  return { lanes, laneGap, rowGap: car.length * CLEARANCE, width: lanes * laneGap };
}

export interface Slot {
  /** Sideways offset from the centre line. */
  z: number;
  /** How far back of its true score the car sits, to clear the row in front. */
  back: number;
}

/**
 * Index to a place on the grid. A second row starts a car-length back, which is the only way
 * two players on the same score can share a lane: a score is one point on the track, and no
 * sideways offset separates two cars standing on it.
 */
export function slotFor(index: number, grid: Grid): Slot {
  const lane = index % grid.lanes;
  const row = Math.floor(index / grid.lanes);
  return { z: (lane - (grid.lanes - 1) / 2) * grid.laneGap, back: row * grid.rowGap };
}

/**
 * The distance at which a field of the given size fits inside a perspective frustum.
 *
 * Exact rather than guessed: for a vertical field of view `fovDeg` and viewport `aspect`,
 * half the visible width at distance d is `d · tan(fov/2) · aspect`, so fitting a half-width W
 * needs `d = W / (tan(fov/2) · aspect)`. The same holds vertically without the aspect term.
 * The larger of the two requirements wins.
 */
export function distanceToFit(
  field: { width: number; length: number },
  lens: { fovDeg: number; aspect: number },
  minimum = 6,
): number {
  const halfV = Math.tan((lens.fovDeg * Math.PI) / 360);
  const halfH = halfV * Math.max(0.1, lens.aspect);

  const forWidth = field.width / 2 / halfH;
  const forLength = field.length / 2 / halfV;

  return Math.max(minimum, forWidth, forLength);
}
